'use strict';

/**
 * Klasör tabanlı ayar eşitlemenin (1.4.0, o-58) SAF çekirdeği: bölüm anlık görüntüsü, özet, dosya biçimi (düz ya da parolalı zarf), uzak bölümün
 * doğrulanması ve ZAMAN DAMGALI birleştirme kararı. Dosya sistemi, zamanlayıcı, Electron ve günlük yok (src/esitleme-yoneticisi.js bağlar).
 *
 * Model
 *  - Ayarlar BÖLÜMLERE ayrılır (esitleme-bolumleri.js: açık beyaz liste). Klasörde tek dosya durur (ev-paneli-esitleme.json); her bölüm kendi
 *    zaman damgası (zaman, ms), yazan bilgisayarın kimliği (aygit) ve içeriğinin özetiyle yazılır. Bölümler birbirinden bağımsız birleşir.
 *  - Karar bölüm başına: yerel içerik son eşitlemeden beri değiştiyse yerelin damgası "mantıksal saatle" ilerler (en az son görülen damga + 1;
 *    saat farkı olan bilgisayarlar birbirini ezmesin); iki içerik farklıysa DAMGASI BÜYÜK olan kazanır, eşitse aygit kimliği büyük olan (iki
 *    bilgisayar da aynı sonuca varır). Kayıtlı durumu olmayan bölümde (ilk eşitleme) klasördeki sürüm yerelin yerine geçer: kullanıcı açarken
 *    bunun için onay verir.
 *  - Klasörden gelen HER bölüm uygulanmadan önce içe aktarma ile AYNI hattan geçer (ayarYedeginiCoz: şema doğrulaması, kapı/kilit süzgeci,
 *    kısayol denetimi); bölümün dışındaki alanlar ve listede olmayan her şey atılır. Gelecekte (24 saatten ileri) damgalı bölüm geçersizdir
 *    (bozuk/kötü niyetli bir dosya sonsuza dek kazanamaz).
 *  - Dosyada SIR YOKTUR: erişim anahtarı, yenileme anahtarı, parola, üstbilgi değerleri, sertifika kayıtları ve HA adresleri bölümlerde yer
 *    almaz (beyaz liste). Savunma amaçlı olarak JWT benzeri bir değer bulunan dosya ne yazılır ne de okunur.
 *  - Parola verilirse dosya parolalı zarf olarak yazılır (esitleme-sifre.js); parola ayarlıyken düz dosya GÜVENİLMEZ (başkası klasöre düz dosya
 *    koyup bölümleri değiştiremesin).
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { SEMA_SURUMU } = require('./ayar-sema');
const { AKTARIM_BICIMI, AKTARIM_SURUMU, AKTARIM_BAYT_SINIRI, GIZLI_DEGER_DESENI, aktarilacakAyarlar, ayarYedeginiCoz } = require('./ayar-yedegi');
const { BOLUMLER, BOLUM_ADLARI, AYGIT_DESENI, klasorYoluDuzelt } = require('./esitleme-bolumleri');
const { BICIM, SURUM, zarfMi } = require('./esitleme-sifre');
const { TR } = require('./ceviri-varsayilan');

const DOSYA_ADI = 'ev-paneli-esitleme.json';
/** Ana dosya ve bulut hizmetlerinin çakışma kopyaları (Dropbox "(… conflicted copy …)", Syncthing ".sync-conflict-…", OneDrive "-BILGISAYAR", Drive "(1)"). */
const ADAY_DESENI = /^ev-paneli-esitleme(?:[ .\-_(][^/\\]{0,120})?\.json$/i;
const GECICI_ONEK = '.ev-paneli-esitleme.';
const EN_COK_ADAY = 5;
const ZAMAN_SAPMASI_MS = 24 * 60 * 60 * 1000; // gelecek damga toleransı
const BILINMEYEN_BOLUM_DESENI = /^[a-z][A-Za-z0-9]{1,30}$/;
const EN_COK_BILINMEYEN = 8;
const DOSYA_NOTU = 'Home Panel settings sync file. It never contains access tokens, passwords or Home Assistant addresses.';

const duzNesne = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/** Anahtarları sıralı kararlı JSON (aynı içerik her bilgisayarda aynı metni verir). */
function kararliYaz(d) {
  if (d === null || typeof d !== 'object') return JSON.stringify(d) ?? 'null';
  if (Array.isArray(d)) return `[${d.map(kararliYaz).join(',')}]`;
  return `{${Object.keys(d)
    .sort()
    .filter((k) => d[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${kararliYaz(d[k])}`)
    .join(',')}}`;
}

/** İçeriğin 32 onaltılık haneli özeti. */
const ozetle = (d) => crypto.createHash('sha256').update(kararliYaz(d), 'utf8').digest('hex').slice(0, 32);

/** Bu bilgisayarı eşitleme dosyasında tanıtan rastgele kimlik (16 onaltılık hane). */
const aygitUret = (rastgele = crypto.randomBytes) => rastgele(8).toString('hex');

/** Bölümün şimdiki yerel içeriği (aktarılan alanlar, yalnız bölümün beyaz listesi). */
function bolumAnlik(ayarlar, ad) {
  const tum = aktarilacakAyarlar(ayarlar);
  const sonuc = {};
  for (const alan of BOLUMLER[ad] ?? []) if (tum[alan] !== undefined) sonuc[alan] = tum[alan];
  return sonuc;
}

/** Damga karşılaştırması: a, b'den KESİN yeni mi? (önce zaman, eşitse aygit kimliği büyük olan) */
const yeniMi = (a, b) => a.zaman > b.zaman || (a.zaman === b.zaman && a.aygit > b.aygit);

/**
 * Parolasız eşitlemede klasöre yazabilen herkes dosyayı değiştirebilir; onay gevşetmesi (favoride `onay:false`: düğme/script/otomasyon gibi
 * eylemlerin "basılı tutarak onay" şartını kapatmak) bu yoldan KABUL EDİLMEZ. Uzak favoride `onay:false` yalnız yerelde zaten aynı favoride
 * `onay:false` ise (kullanıcının kendi kararı) korunur; aksi halde alan atılır (varsayılan sınıf geçerli kalır). `onay:true` (sıkılaştırma) olduğu gibi gelir.
 * Parolalı (şifreli zarf) dosya parolayı bilen bilgisayarlardan geldiği için güvenilir sayılır ve bu işlem yapılmaz.
 * @returns {{favoriler: object[], atilan: number}} atilan: yok sayılan gevşetme sayısı
 */
function onayGevsetmesiniEngelle(uzakFavoriler, yerelFavoriler) {
  if (!Array.isArray(uzakFavoriler)) return { favoriler: uzakFavoriler, atilan: 0 };
  const yerel = new Map((Array.isArray(yerelFavoriler) ? yerelFavoriler : []).filter((f) => duzNesne(f) && typeof f.entity_id === 'string').map((f) => [f.entity_id, f]));
  let atilan = 0;
  const favoriler = uzakFavoriler.map((f) => {
    if (!duzNesne(f) || f.onay !== false || yerel.get(f.entity_id)?.onay === false) return f;
    atilan += 1;
    const { onay: _onay, ...digerleri } = f;
    return digerleri;
  });
  return { favoriler, atilan };
}

/**
 * Uzak bölümü uygulanabilir hale getirir: yalnız bölümün alanları alınır ve içe aktarma hattından (şema doğrulaması, kapı/kilit süzgeci) geçer.
 * `parolasiz` ve `yerelFavoriler` verilirse parolasız dosyadaki onay gevşetmeleri atılır (onayGevsetmesiniEngelle).
 * @returns {{ok: true, cozum: object, anlik: object, ozet: string} | {ok: false, neden: 'bolum-gecersiz'}}
 *   cozum: ayarAktariciOlustur'un `uygula`sına verilen biçim; anlik/ozet: temizlenmiş içeriğin yerel biçimi ve özeti (karşılaştırma bununla yapılır)
 */
function uzakBolumTemizle(ad, ayarlarHam, { varsayilan = {}, t = TR, parolasiz = false, yerelFavoriler = null } = {}) {
  const gecersiz = { ok: false, neden: 'bolum-gecersiz' };
  if (!BOLUMLER[ad] || !duzNesne(ayarlarHam)) return gecersiz;
  const secilen = {};
  for (const alan of BOLUMLER[ad]) if (Object.hasOwn(ayarlarHam, alan)) secilen[alan] = ayarlarHam[alan];
  if (Object.keys(secilen).length === 0) return gecersiz;
  let onayAtilan = 0;
  if (parolasiz && Object.hasOwn(secilen, 'favoriler')) {
    const engel = onayGevsetmesiniEngelle(secilen.favoriler, yerelFavoriler);
    secilen.favoriler = engel.favoriler;
    onayAtilan = engel.atilan;
  }
  let cozum;
  try {
    cozum = ayarYedeginiCoz({ bicim: AKTARIM_BICIMI, aktarimSurumu: AKTARIM_SURUMU, semaSurumu: SEMA_SURUMU, ayarlar: secilen }, { varsayilan, t });
  } catch {
    return gecersiz;
  }
  if (!cozum.ok) return gecersiz;
  // Bölüm dışına taşan hiçbir alan uygulanmaz (savunma): ayarlar yalnız bölümün alanlarına indirilir.
  const ayarlar = {};
  for (const alan of BOLUMLER[ad]) if (cozum.ayarlar[alan] !== undefined) ayarlar[alan] = cozum.ayarlar[alan];
  if (Object.keys(ayarlar).length === 0) return gecersiz;
  const anlik = bolumAnlik(ayarlar, ad);
  return { ok: true, cozum: { ...cozum, ayarlar }, anlik, ozet: ozetle(anlik), onayAtilan };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dosya biçimi
// ---------------------------------------------------------------------------------------------------------------------------

function girdiyiDogrula(girdi, simdi) {
  if (!duzNesne(girdi) || !duzNesne(girdi.ayarlar)) return null;
  if (!Number.isSafeInteger(girdi.zaman) || girdi.zaman < 0 || girdi.zaman > simdi + ZAMAN_SAPMASI_MS) return null;
  if (typeof girdi.aygit !== 'string' || !AYGIT_DESENI.test(girdi.aygit)) return null;
  return { zaman: girdi.zaman, aygit: girdi.aygit, ayarlar: girdi.ayarlar };
}

/**
 * Dosya metnini çözer. Hata fırlatmaz.
 * @param {string} metin
 * @param {{parola?: string|null, sifreleyici?: object, simdi?: number}} [bag]
 * @returns {Promise<{ok: true, belge: {bolumler: object, bilinmeyen: object, gecersiz: number}} |
 *   {ok: false, neden: 'cok-buyuk'|'bozuk'|'parola-gerekli'|'parola-yanlis'|'sifresiz'|'daha-yeni'|'gizli-deger'}>}
 */
async function dosyayiCoz(metin, { parola = null, sifreleyici = null, simdi = Date.now() } = {}) {
  if (typeof metin !== 'string') return { ok: false, neden: 'bozuk' };
  if (metin.length > AKTARIM_BAYT_SINIRI) return { ok: false, neden: 'cok-buyuk' };
  let kok;
  try {
    kok = JSON.parse(metin.replace(/^﻿/, ''));
  } catch {
    return { ok: false, neden: 'bozuk' };
  }
  if (!duzNesne(kok) || kok.bicim !== BICIM) return { ok: false, neden: 'bozuk' };
  let belge = kok;
  if (zarfMi(kok)) {
    if (!parola) return { ok: false, neden: 'parola-gerekli' };
    if (!sifreleyici) return { ok: false, neden: 'bozuk' };
    let duz;
    try {
      duz = await sifreleyici.coz(kok, parola);
    } catch (hata) {
      const neden = hata?.neden;
      return { ok: false, neden: neden === 'dahaYeni' ? 'daha-yeni' : neden === 'zarf-gecersiz' ? 'bozuk' : 'parola-yanlis' };
    }
    if (duz.length > AKTARIM_BAYT_SINIRI) return { ok: false, neden: 'cok-buyuk' };
    try {
      belge = JSON.parse(duz);
    } catch {
      return { ok: false, neden: 'bozuk' };
    }
    if (!duzNesne(belge) || belge.bicim !== BICIM) return { ok: false, neden: 'bozuk' };
  } else if (parola) {
    return { ok: false, neden: 'sifresiz' }; // parola ayarlıyken düz dosya güvenilmez
  }
  if (!Number.isInteger(belge.surum) || belge.surum < 1) return { ok: false, neden: 'bozuk' };
  if (belge.surum > SURUM || (Number.isInteger(belge.semaSurumu) && belge.semaSurumu > SEMA_SURUMU)) return { ok: false, neden: 'daha-yeni' };
  if (!duzNesne(belge.bolumler)) return { ok: false, neden: 'bozuk' };
  if (GIZLI_DEGER_DESENI.test(JSON.stringify(belge))) return { ok: false, neden: 'gizli-deger' };
  const bolumler = {};
  const bilinmeyen = {};
  let gecersiz = 0;
  for (const ad of Object.keys(belge.bolumler)) {
    const girdi = girdiyiDogrula(belge.bolumler[ad], simdi);
    if (BOLUM_ADLARI.includes(ad)) {
      if (girdi) bolumler[ad] = girdi;
      else gecersiz += 1;
    } else if (BILINMEYEN_BOLUM_DESENI.test(ad) && girdi && Object.keys(bilinmeyen).length < EN_COK_BILINMEYEN) {
      bilinmeyen[ad] = girdi; // yeni sürümün bölümü: bilinmez ama yazarken korunur
    }
  }
  return { ok: true, belge: { bolumler, bilinmeyen, gecersiz } };
}

/**
 * Yazılacak dosya metni. bolumler: { <ad>: { zaman, aygit, ayarlar } } (özet burada hesaplanır); bilinmeyen: korunacak başka bölümler.
 * @returns {Promise<{ok: true, metin: string} | {ok: false, neden: 'gizli-deger'|'cok-buyuk'|'parola-gecersiz'}>}
 */
async function dosyaMetni({ bolumler, bilinmeyen = {}, parola = null, sifreleyici = null }) {
  const cikti = {};
  for (const ad of BOLUM_ADLARI) {
    const girdi = bolumler?.[ad];
    if (girdi) cikti[ad] = { zaman: girdi.zaman, aygit: girdi.aygit, ozet: ozetle(girdi.ayarlar), ayarlar: girdi.ayarlar };
  }
  for (const ad of Object.keys(bilinmeyen)) if (!BOLUM_ADLARI.includes(ad)) cikti[ad] = { zaman: bilinmeyen[ad].zaman, aygit: bilinmeyen[ad].aygit, ayarlar: bilinmeyen[ad].ayarlar };
  const belge = { bicim: BICIM, surum: SURUM, semaSurumu: SEMA_SURUMU, not: DOSYA_NOTU, bolumler: cikti };
  const duz = `${JSON.stringify(belge, null, 2)}\n`;
  if (GIZLI_DEGER_DESENI.test(duz)) return { ok: false, neden: 'gizli-deger' };
  let metin = duz;
  if (parola) {
    if (!sifreleyici) return { ok: false, neden: 'parola-gecersiz' };
    try {
      metin = `${JSON.stringify(await sifreleyici.sifrele(duz, parola), null, 2)}\n`;
    } catch {
      return { ok: false, neden: 'parola-gecersiz' };
    }
  }
  if (metin.length > AKTARIM_BAYT_SINIRI) return { ok: false, neden: 'cok-buyuk' };
  return { ok: true, metin };
}

/**
 * Birden çok dosyanın (ana dosya + çakışma kopyaları) bölümlerini birleştirir: her bölüm için en yeni damgalı sürüm.
 * @param {{bolumler: object, bilinmeyen: object}[]} belgeler
 */
function belgeleriBirlestir(belgeler) {
  const bolumler = {};
  const bilinmeyen = {};
  for (const belge of belgeler) {
    for (const [ad, girdi] of Object.entries(belge.bolumler)) if (!bolumler[ad] || yeniMi(girdi, bolumler[ad])) bolumler[ad] = girdi;
    for (const [ad, girdi] of Object.entries(belge.bilinmeyen)) if (!bilinmeyen[ad] || yeniMi(girdi, bilinmeyen[ad])) bilinmeyen[ad] = girdi;
  }
  return { bolumler, bilinmeyen };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Birleştirme kararı (bölüm başına)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Tek bölüm için ne yapılacağı.
 * @param {object} g
 * @param {{ozet: string, zaman: number, aygit: string}|null|undefined} g.durum bu bilgisayarın son eşitleme kaydı
 * @param {string} g.ozetL yerel içeriğin özeti
 * @param {{zaman: number, aygit: string}|null} g.uzak klasördeki en yeni sürümün damgası (yoksa null)
 * @param {string|null} g.ozetU uzak içeriğin (temizlenmiş) özeti; uzak geçersizse null
 * @param {number} g.simdi
 * @param {string} g.aygit bu bilgisayarın kimliği
 * @returns {{eylem: 'yok'|'yaz'|'uygula', durum: {ozet: string, zaman: number, aygit: string}}}
 *   uygula: uzak sürüm yerel ayarlara uygulanmalı (uygulanınca durum.ozet yeni yerel özetle güncellenir); yaz: yerel sürüm dosyaya yazılmalı
 */
function bolumKarari({ durum, ozetL, uzak, ozetU, simdi, aygit }) {
  let d = durum && typeof durum.ozet === 'string' ? { ozet: durum.ozet, zaman: durum.zaman, aygit: durum.aygit } : null;
  if (d && d.ozet !== ozetL) d = { ozet: ozetL, zaman: Math.max(simdi, d.zaman + 1), aygit }; // yerel içerik son eşitlemeden beri değişti
  if (!uzak || ozetU === null) {
    return { eylem: 'yaz', durum: d ?? { ozet: ozetL, zaman: simdi, aygit } };
  }
  if (ozetU === ozetL) {
    // İçerik aynı: damga uzaktakine yetişir (iki bilgisayarın damgası ayrışmasın)
    const benimki = d ?? { ozet: ozetL, zaman: 0, aygit: '' };
    return { eylem: 'yok', durum: yeniMi(uzak, benimki) ? { ozet: ozetL, zaman: uzak.zaman, aygit: uzak.aygit } : benimki };
  }
  if (!d || yeniMi(uzak, d)) return { eylem: 'uygula', durum: { ozet: ozetU, zaman: uzak.zaman, aygit: uzak.aygit } };
  return { eylem: 'yaz', durum: d };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Klasör
// ---------------------------------------------------------------------------------------------------------------------------

const normal = (yol) => path.resolve(yol).replace(/[\\/]+$/, '').toLowerCase();

/**
 * Seçilen klasör kullanılabilir mi: mutlak yol, uygulamanın kendi veri/kurulum klasörlerinin içinde olamaz (erişim anahtarı ve ayar dosyalarının yanına yazılmaz).
 * @returns {{ok: true, yol: string} | {ok: false, neden: 'yol-gecersiz'|'yasak-klasor'}}
 */
function klasorDogrula(yol, yasaklar = []) {
  const duzgun = klasorYoluDuzelt(yol);
  if (duzgun === undefined || duzgun === '') return { ok: false, neden: 'yol-gecersiz' };
  const aday = normal(duzgun);
  for (const yasak of yasaklar) {
    if (typeof yasak !== 'string' || yasak === '') continue;
    const y = normal(yasak);
    if (aday === y || aday.startsWith(`${y}${path.sep}`) || aday.startsWith(`${y}/`)) return { ok: false, neden: 'yasak-klasor' };
  }
  return { ok: true, yol: duzgun };
}

/** Klasördeki dosya adlarından eşitleme adaylarını (ana dosya + çakışma kopyaları) seçer; ana dosya önce. */
function adayAdlari(adlar) {
  const liste = (Array.isArray(adlar) ? adlar : []).filter((ad) => typeof ad === 'string' && !ad.startsWith(GECICI_ONEK) && ADAY_DESENI.test(ad));
  return liste.sort((a, b) => (a.toLowerCase() === DOSYA_ADI ? -1 : b.toLowerCase() === DOSYA_ADI ? 1 : 0));
}

module.exports = {
  DOSYA_ADI,
  ADAY_DESENI,
  GECICI_ONEK,
  EN_COK_ADAY,
  ZAMAN_SAPMASI_MS,
  kararliYaz,
  ozetle,
  aygitUret,
  bolumAnlik,
  yeniMi,
  onayGevsetmesiniEngelle,
  uzakBolumTemizle,
  dosyayiCoz,
  dosyaMetni,
  belgeleriBirlestir,
  bolumKarari,
  klasorDogrula,
  adayAdlari,
};
