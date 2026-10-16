'use strict';

/**
 * Favori listesi yardımcıları (saf).
 *  - favorileriDuzelt: ayar dosyasındaki listeyi temizler. Süzgeçten (GÜVENLİK KURALI) geçmeyenler listeden
 *    çıkarılır AMA sessizce değil: `atilanlar` ile geri bildirilir, çağıran taraf bildirim/günlük yazar.
 *  - favorileriBirlestir: Ayarlar'dan gelen seçimi mevcut favorilerle birleştirir (hata-14): HA yeniden başlarken
 *    cihaz listesi eksik dönse bile listede o an görünmeyen favoriler sessizce silinmez.
 *  - onayiDuzelt: zorunlu onaylı eylemlerde "onay:false" kaydını atar (sunucu tarafı doğrulama, hata-04).
 *  - HAZIR_LISTE / hazirListeUygula: hazır ilk karolar (hiz-07); GRUP_TABLOSU: panel grupları (gorunum-12).
 *
 * Favori kaydı: { entity_id, ad, onay?, etiket?, kisayol?, parlaklik?, simge?, renk?, boyut?, tepsi? }
 *   etiket   yalnız görünen kısa ad (güvenlik her zaman HA'daki GÜNCEL friendly_name'e bakar; etiket de süzgeçten geçer)
 *   kisayol  eylem kısayolu (hiz-05; yalnız zararsız eylemlerde)
 *   parlaklik yalnız ışıkta: panelde hazır seviyeler ve kaydırıcı (hiz-09)
 *   simge, renk, boyut  karo görünümü (1.4.0, o-31): src/lib/karo-gorunum.js (çizgi ikon ya da emoji; hazır palet adı; kucuk/genis/buyuk)
 *   tepsi    true ise tepsi menüsünün üst düzeyinde (zararsız favoriler arasında) önce gelir (1.4.0, o-16 "tepsiye ekle")
 *
 * 1.4.0: favori olabilen alanlar src/lib/alan-kaydi.js karoAlaniMi ile belirlenir (iklim, medya, nem alıcı, süpürge, seçici,
 * sayı, zamanlayıcı, sensör, ikili sensör, hava eklendi). Kısayol yalnız tek tıklama eylemi olan (varsayilanServis) alanlarda
 * saklanır. Favori kaydına yeni alan ekleyen ajan: favoriOlustur'a doğrulamalı satır + ayar-yedegi.js FAVORI_ALANLARI listesi +
 * main.js ayarOzeti favoriler eşlemesi.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { YASAK_ALANLAR, alanAl, adGuvenliMi, guvenliVarlikMi } = require('./suzgec');
const { karoAlaniMi, varsayilanServis } = require('./alan-kaydi');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { EN_COK_FAVORI_KISAYOLU, kisayolDogrula, kisayolNormallestir } = require('./kisayol');
const { kisalt } = require('./metin');
const { simgeDuzelt, renkDuzelt, boyutDuzelt, VARSAYILAN_BOYUT } = require('./karo-gorunum');

const EN_COK_FAVORI = 200;
const EN_COK_KISAYOLLU_FAVORI = EN_COK_FAVORI_KISAYOLU;
const ETIKET_SINIRI = 40;

/** Panel grupları: sabit sıra (kullanım dağılımına göre: ışık, sahne, PC, medya, diğer). */
const GRUPLAR = Object.freeze([
  { kod: 'isik', etiket: 'Işık' },
  { kod: 'iklim', etiket: 'İklim' }, // 1.4.0: klima, nem alıcı, vantilatör
  { kod: 'sahne', etiket: 'Sahne' },
  { kod: 'pc', etiket: 'PC' },
  { kod: 'medya', etiket: 'Medya' },
  { kod: 'yardimci', etiket: 'Yardımcılar' }, // 1.4.0: seçici, sayı, zamanlayıcı
  { kod: 'sensor', etiket: 'Sensör' }, // 1.4.0: sensör ve ikili sensör karoları (salt okunur; src/yuzey-bilgi.js çizer)
  { kod: 'diger', etiket: 'Diğer' },
]);

/**
 * Hazır ilk karolar (hiz-07, soru-2): bugünkü 4 favori korunur; üstüne sahneler, ekranı kapat, oynat/duraklat,
 * ses -/+/sessiz, sonraki parça eklenir; kahve prizi ve telefonu bul 'Diğer'de; PC kapat ve 'İyi geceler' onaylı satırda.
 * Her kimlik GÜVENLİK KURALI'ndan geçmelidir (test/degismezler.test.js); kapı/kilit/alarm hiçbir zaman buraya girmez.
 * grup: panel grubu; yıkıcı eylemler (eylem-sinifi) grubundan bağımsız olarak "Onaylı" satırında gösterilir.
 */
const HAZIR_LISTE = Object.freeze([
  { kimlik: 'light.masa_led_serit', etiket: 'LED şerit', grup: 'isik', parlaklik: true },
  { kimlik: 'light.smart_multicolor_bulb', etiket: 'Ampul', grup: 'isik' },
  { kimlik: 'button.pc_ses_cikis_hoparlor', etiket: 'Hoparlör', grup: 'medya', altGrup: 'cikis' },
  { kimlik: 'button.pc_ses_cikis_kulaklik', etiket: 'Kulaklık', grup: 'medya', altGrup: 'cikis' },
  { kimlik: 'scene.calisma', etiket: 'Çalışma', grup: 'sahne' },
  { kimlik: 'scene.aksam', etiket: 'Akşam', grup: 'sahne' },
  { kimlik: 'scene.film', etiket: 'Film', grup: 'sahne' },
  { kimlik: 'scene.gece_lambasi', etiket: 'Gece lambası', grup: 'sahne' },
  { kimlik: 'button.pc_ekran_kapat', etiket: 'Ekranı kapat', grup: 'pc' },
  { kimlik: 'button.pc_mediaplaypause', etiket: 'Oynat/Duraklat', grup: 'medya', altGrup: 'oynat' },
  { kimlik: 'button.pc_mediavolumedown', etiket: 'Ses −', grup: 'medya', altGrup: 'ses', tekrar: true },
  { kimlik: 'button.pc_mediavolumeup', etiket: 'Ses +', grup: 'medya', altGrup: 'ses', tekrar: true },
  { kimlik: 'button.pc_mediamute', etiket: 'Sessiz', grup: 'medya', altGrup: 'ses' },
  { kimlik: 'button.pc_medianext', etiket: 'Sonraki parça', grup: 'medya', altGrup: 'oynat' },
  { kimlik: 'switch.smart_plug_mini', etiket: 'Kahve makinesi', grup: 'diger' },
  { kimlik: 'script.telefonu_bul', etiket: 'Telefonu bul', grup: 'diger' },
  { kimlik: 'button.pc_bilgisayari_kapat', etiket: 'PC kapat', grup: 'pc' },
  { kimlik: 'script.iyi_geceler', etiket: 'İyi geceler', grup: 'pc' },
]);
/** Hazır liste sürümü: ayarlardaki hazirListeSurumu bundan küçükse açılışta bir kez uygulanır (yeni karolar eklenince artırılır). */
const HAZIR_LISTE_SURUMU = 1;
const HAZIR_HARITA = new Map(HAZIR_LISTE.map((h) => [h.kimlik, h]));

/** 1.4.0 alan -> panel grubu (hazır listede olmayan kimlikler için). */
const ALAN_GRUPLARI = Object.freeze({
  light: 'isik',
  scene: 'sahne',
  climate: 'iklim',
  humidifier: 'iklim',
  fan: 'iklim',
  media_player: 'medya',
  input_select: 'yardimci',
  select: 'yardimci',
  input_number: 'yardimci',
  number: 'yardimci',
  timer: 'yardimci',
  sensor: 'sensor', // salt okunur; panelde şerit ve karo olarak src/yuzey-bilgi.js çizer
  binary_sensor: 'sensor',
});

/** Kimliğin panel grubu: hazır listedeki açık tablo, yoksa alan varsayılanı (ALAN_GRUPLARI; gerisi diger). */
function grupBul(kimlik) {
  const hazir = HAZIR_HARITA.get(kimlik);
  if (hazir) return hazir.grup;
  return ALAN_GRUPLARI[alanAl(kimlik)] ?? 'diger';
}

/** Medya satırındaki yeri: 'cikis' (ses çıkışı), 'ses' (-/+/sessiz), 'oynat' (oynat/duraklat/sonraki). Medya dışı için null. */
function altGrupBul(kimlik) {
  return HAZIR_HARITA.get(kimlik)?.altGrup ?? (grupBul(kimlik) === 'medya' ? 'oynat' : null);
}

/** Basılı tutunca tekrar eden düğmeler (ses -/+). */
function tekrarliMi(kimlik) {
  return HAZIR_HARITA.get(kimlik)?.tekrar === true;
}

/** Hazır listedeki açık etiket (varsa). */
function hazirEtiket(kimlik) {
  return HAZIR_HARITA.get(kimlik)?.etiket ?? null;
}

/**
 * Hazır karonun etiketi: `etiketAl(kimlik, varsayilan)` verilmişse (ana süreç, o anki arayüz dilinde: src/lib/ceviri/ana.js 'hazir.<kimlik>') onunla,
 * yoksa Türkçe varsayılanla. Etiket favori eklenirken ayara yazılır; sonradan dil değişse de kullanıcının favorisi değişmez.
 */
function hazirEtiketAl(hazir, etiketAl) {
  if (typeof etiketAl !== 'function') return hazir.etiket;
  const e = etiketAl(hazir.kimlik, hazir.etiket);
  return typeof e === 'string' && e ? e : hazir.etiket;
}

function etiketDuzelt(kimlik, etiket) {
  if (typeof etiket !== 'string') return null;
  const temiz = kisalt(etiket, ETIKET_SINIRI);
  if (!temiz || !adGuvenliMi(kimlik, temiz)) return null; // etiket de süzgeçten geçer: "Kapı" etiketi hiçbir yerde görünmez
  return temiz;
}

/**
 * Kısayol yalnız geçerli biçimde VE zararsız eylemde saklanır (yıkıcı/yasak eylem kısayola atanamaz, hiz-05).
 * @returns {string|null} normalleştirilmiş kısayol
 */
function kisayolDuzelt(kimlik, ad, onay, kisayol) {
  if (typeof kisayol !== 'string' || kisayol === '' || !kisayolDogrula(kisayol).gecerli) return null;
  if (varsayilanServis(alanAl(kimlik)) === null) return null; // 1.4.0: tek tıklama eylemi olmayan karo (iklim, sensör...) kısayol alamaz
  const s = eylemSinifi({ entity_id: kimlik, attributes: { friendly_name: ad } }, typeof onay === 'boolean' ? { onay } : {});
  return s.sinif === SINIF.ZARARSIZ ? kisayolNormallestir(kisayol) : null;
}

/**
 * Karo görünümü alanları (o-31): geçerli ve varsayılandan farklı değerler kayda girer; geçersiz / yasak (kapı-kilit emojisi...) değer atılır.
 * simge: '' ya da geçersiz = yok; renk: '' ya da geçersiz = varsayılan; boyut: 'normal' kayda yazılmaz.
 */
function gorunumAlanlari(ek) {
  const sonuc = {};
  const simge = simgeDuzelt(ek.simge);
  if (simge) sonuc.simge = simge;
  const renk = renkDuzelt(ek.renk);
  if (renk) sonuc.renk = renk;
  const boyut = boyutDuzelt(ek.boyut);
  if (boyut && boyut !== VARSAYILAN_BOYUT) sonuc.boyut = boyut;
  return sonuc;
}

/** ek: { onay?, etiket?, kisayol?, parlaklik?, simge?, renk?, boyut?, tepsi? } — geçersiz alanlar sessizce atılır (çağıran gerekiyorsa bildirir). */
function favoriOlustur(kimlik, ad, ek = {}) {
  const f = { entity_id: kimlik, ad };
  if (typeof ek.onay === 'boolean') f.onay = ek.onay;
  const etiket = etiketDuzelt(kimlik, ek.etiket);
  if (etiket) f.etiket = etiket;
  const kisayol = kisayolDuzelt(kimlik, ad, f.onay, ek.kisayol);
  if (kisayol) f.kisayol = kisayol;
  if (ek.parlaklik === true && alanAl(kimlik) === 'light') f.parlaklik = true;
  Object.assign(f, gorunumAlanlari(ek));
  if (ek.tepsi === true) f.tepsi = true;
  return f;
}

/**
 * @param {unknown} liste
 * @returns {{ favoriler: {entity_id:string, ad:string, onay?:boolean, etiket?:string, kisayol?:string, parlaklik?:boolean}[], atilanlar: {entity_id:string, neden:string}[] }}
 *   neden: 'gecersiz-kimlik' | 'tekrar' | 'alan' | 'guvenlik' | 'sinir'
 */
function favorileriDuzelt(liste) {
  const favoriler = [];
  const atilanlar = [];
  if (!Array.isArray(liste)) return { favoriler, atilanlar };
  const gorulen = new Set();
  for (const oge of liste) {
    const kimlik = typeof oge === 'string' ? oge : oge?.entity_id;
    const at = (neden) => atilanlar.push({ entity_id: typeof kimlik === 'string' ? kimlik.slice(0, 100) : '', neden });
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) {
      at('gecersiz-kimlik');
      continue;
    }
    if (gorulen.has(kimlik)) {
      at('tekrar');
      continue;
    }
    const alan = alanAl(kimlik);
    if (!karoAlaniMi(alan) || YASAK_ALANLAR.has(alan)) {
      at('alan');
      continue;
    }
    const ad = typeof oge?.ad === 'string' && oge.ad.trim() ? oge.ad.trim().slice(0, 100) : kimlik;
    if (!adGuvenliMi(kimlik, ad)) {
      at('guvenlik');
      continue;
    }
    if (favoriler.length >= EN_COK_FAVORI) {
      at('sinir');
      continue;
    }
    gorulen.add(kimlik);
    favoriler.push(favoriOlustur(kimlik, ad, oge && typeof oge === 'object' ? oge : {}));
  }
  return { favoriler, atilanlar };
}

/**
 * Kayıt sırasında favorinin ek alanları: yük (kullanıcının bu kayıtta değiştirdikleri) kayıttakinin üstüne yazar;
 * yükte olmayan alan MEVCUT kayıttan korunur. kisayol: '' = temizle; etiket (karo adı, k-06): '' = temizle (HA'daki ad görünür).
 * Yeni favoride etiket hazır listeden gelir.
 */
function ekAlanlariBirlestir(kimlik, oge, kayit) {
  const gelen = oge && typeof oge === 'object' ? oge : {};
  return {
    onay: typeof gelen.onay === 'boolean' ? gelen.onay : kayit?.onay,
    etiket: typeof gelen.etiket === 'string' ? gelen.etiket : kayit ? kayit.etiket : hazirEtiket(kimlik) ?? undefined,
    kisayol: typeof gelen.kisayol === 'string' ? gelen.kisayol : kayit?.kisayol,
    parlaklik: typeof gelen.parlaklik === 'boolean' ? gelen.parlaklik : kayit?.parlaklik,
    // 1.4.0 (o-31, o-16): '' = temizle / varsayılan; yükte olmayan alan kayıttan korunur.
    simge: typeof gelen.simge === 'string' ? gelen.simge : kayit?.simge,
    renk: typeof gelen.renk === 'string' ? gelen.renk : kayit?.renk,
    boyut: typeof gelen.boyut === 'string' ? gelen.boyut : kayit?.boyut,
    tepsi: typeof gelen.tepsi === 'boolean' ? gelen.tepsi : kayit?.tepsi,
  };
}

/**
 * Ayarlar penceresindeki "Favorileri Kaydet" sonucunu hesaplar.
 *  - Seçilen ve güvenli listede olan: güncel adıyla yazılır.
 *  - Seçilen, mevcut favori ve HA'da (tumKimlikler) o an YOK, kayıtlı adı hâlâ güvenli: AYNEN korunur (`eksik`).
 *  - Seçilen, mevcut favori ama HA'da var ve güvenli listede yok (adı sonradan "kapı" olmuş gibi): düşürülür (`engelli`).
 *  - Mevcut olmayan ve güvenli listede de olmayan kimlikler yok sayılır: yeni giriş YALNIZ güvenli listeden gelir.
 *  - Seçilmeyenler kullanıcının kararıyla çıkar.
 *  - Kısayol yalnız geçerli biçimde, zararsız eylemde ve en çok 5 favoride tutulur; reddedilenler `kisayolHatalari` ile bildirilir
 *    (favori yine kaydedilir, yalnız kısayol atılır).
 *  - Karo adı (etiket, k-06) kapı süzgecinden (adGuvenliMi) geçmelidir; geçmeyen ad `etiketHatalari` ile bildirilir, önceki ad korunur.
 *  - Karo görünümü (simge, renk, boyut; o-31): geçersiz ya da yasak değer `gorunumHatalari` ile bildirilir ve önceki değer korunur.
 *  - Sıra: yükteki sıra aynen yeni listenin sırasıdır (k-05); tepsi menüsü ve panel bu sırayı kullanır.
 * @param {{ mevcut: object[], secilen: unknown[], guvenliListe: Map<string,string>, tumKimlikler: Set<string> }} girdi
 *   secilen: kimlik metni ya da { entity_id, onay?, kisayol?, parlaklik?, simge?, renk?, boyut?, tepsi? }; guvenliListe: kimlik -> HA'daki güncel ad
 * @returns {{ yeni: object[], eksik: string[], engelli: {entity_id:string, ad:string}[], kisayolHatalari: {entity_id:string, neden:string}[],
 *   etiketHatalari: {entity_id:string, neden:string}[], gorunumHatalari: {entity_id:string, alan:'simge'|'renk'|'boyut'}[] }}
 *   kisayolHatalari.neden: 'gecersiz' | 'sinif' | 'sinir'; etiketHatalari.neden: 'guvenlik'
 */
function favorileriBirlestir({ mevcut, secilen, guvenliListe, tumKimlikler }) {
  const yeni = [];
  const eksik = [];
  const engelli = [];
  const kisayolHatalari = [];
  const etiketHatalari = [];
  const gorunumHatalari = [];
  const mevcutHarita = new Map((Array.isArray(mevcut) ? mevcut : []).map((f) => [f.entity_id, f]));
  const gorulen = new Set();
  let kisayollu = 0;

  function ekle(kimlik, ad, oge, kayit) {
    const ek = ekAlanlariBirlestir(kimlik, oge, kayit);
    let f = favoriOlustur(kimlik, ad, ek);
    const istenenAd = typeof oge?.etiket === 'string' ? oge.etiket.trim() : '';
    if (istenenAd !== '' && f.etiket === undefined) {
      // İstenen karo adı süzgeçten geçmedi (ör. "Kapı ışığı"): reddedilir ve bildirilir; önceki ad korunur, sessizce silinmez.
      etiketHatalari.push({ entity_id: kimlik, neden: 'guvenlik' });
      f = favoriOlustur(kimlik, ad, { ...ek, etiket: kayit ? kayit.etiket : hazirEtiket(kimlik) ?? undefined });
    }
    // Görünüm alanları (o-31): istenen değer geçersizse bildirilir ve önceki değer korunur.
    const gorunumDuzeltmesi = {};
    for (const alan of ['simge', 'renk', 'boyut']) {
      const istenen = typeof oge?.[alan] === 'string' ? oge[alan].trim() : '';
      if (istenen === '' || (alan === 'boyut' && istenen === VARSAYILAN_BOYUT) || f[alan] !== undefined) continue;
      gorunumHatalari.push({ entity_id: kimlik, alan });
      gorunumDuzeltmesi[alan] = kayit?.[alan];
    }
    if (Object.keys(gorunumDuzeltmesi).length > 0) f = favoriOlustur(kimlik, ad, { ...ek, ...f, ...gorunumDuzeltmesi, etiket: f.etiket, kisayol: f.kisayol });
    if (ek.kisayol && !f.kisayol) {
      kisayolHatalari.push({ entity_id: kimlik, neden: kisayolDogrula(ek.kisayol).gecerli ? 'sinif' : 'gecersiz' });
    } else if (f.kisayol) {
      if (kisayollu >= EN_COK_KISAYOLLU_FAVORI) {
        delete f.kisayol;
        kisayolHatalari.push({ entity_id: kimlik, neden: 'sinir' });
      } else {
        kisayollu += 1;
      }
    }
    yeni.push(f);
  }

  for (const oge of Array.isArray(secilen) ? secilen : []) {
    const kimlik = typeof oge === 'string' ? oge : oge?.entity_id;
    if (typeof kimlik !== 'string' || gorulen.has(kimlik)) continue;
    gorulen.add(kimlik);
    if (yeni.length >= EN_COK_FAVORI) break;
    const kayit = mevcutHarita.get(kimlik);
    if (guvenliListe.has(kimlik)) {
      const ad = String(guvenliListe.get(kimlik)).slice(0, 100) || kimlik;
      if (!adGuvenliMi(kimlik, ad)) continue;
      ekle(kimlik, ad, oge, kayit);
      continue;
    }
    if (!kayit) continue; // yeni giriş yalnız güvenli listeden gelir
    if (!tumKimlikler.has(kimlik) && adGuvenliMi(kimlik, kayit.ad)) {
      ekle(kimlik, kayit.ad, oge, kayit);
      eksik.push(kimlik);
      continue;
    }
    engelli.push({ entity_id: kimlik, ad: kayit.ad });
  }
  return { yeni, eksik, engelli, kisayolHatalari, etiketHatalari, gorunumHatalari };
}

/**
 * Hazır listedeki favorilerin eksik etiketini ve LED şeridin parlaklık kontrolünü tamamlar (şema göçü v4; idempotent).
 * Kullanıcının açıkça yazdığı değerler (parlaklik:false, kendi etiketi) korunur.
 */
function hazirEtiketleriniTamamla(favoriler) {
  return favoriler.map((f) => {
    const hazir = HAZIR_HARITA.get(f.entity_id);
    if (!hazir) return f;
    const sonuc = { ...f };
    if (sonuc.etiket === undefined) {
      const e = etiketDuzelt(f.entity_id, hazir.etiket);
      if (e) sonuc.etiket = e;
    }
    if (hazir.parlaklik === true && sonuc.parlaklik === undefined && alanAl(f.entity_id) === 'light') sonuc.parlaklik = true;
    return sonuc;
  });
}

/**
 * Hazır ilk karoları mevcut favorilerin SONUNA ekler (hiz-07). Mevcut favoriler ve sıraları değişmez, hiçbir şey silinmez.
 * Eklenmeyenler: HA'da olmayanlar ('yok') ve GÜVENLİK KURALI'ndan geçmeyenler ('guvenlik'). Zaten favori olanlar atlanır.
 * Üst sınır (EN_COK_FAVORI) aşılmaz.
 * @param {object[]} favoriler mevcut favoriler
 * @param {{entity_id:string, attributes?:object}[]} varliklar HA'daki tüm durumlar (yalnız okunur)
 * @param {{yalnizca?: string[]|null, etiketAl?: (kimlik: string, varsayilan: string) => string}} [secenek] yalnizca: yalnız bu kimlikler denenir
 *   (önceden bulunamayanların yeniden denemesi; kullanıcının çıkardığı karolar geri gelmesin diye diğerlerine bakılmaz);
 *   etiketAl: YENİ eklenen karoların etiketi (ana süreç o anki arayüz dilindeki adı verir; verilmezse Türkçe)
 * @returns {{ favoriler: object[], eklenenler: string[], atlananlar: {entity_id:string, neden:'yok'|'guvenlik'|'sinir'}[] }}
 */
function hazirListeUygula(favoriler, varliklar, { yalnizca = null, etiketAl = null } = {}) {
  const sonuc = hazirEtiketleriniTamamla(Array.isArray(favoriler) ? favoriler : []);
  const var_ = new Map((Array.isArray(varliklar) ? varliklar : []).filter((v) => v && typeof v.entity_id === 'string').map((v) => [v.entity_id, v]));
  const mevcutlar = new Set(sonuc.map((f) => f.entity_id));
  const eklenenler = [];
  const atlananlar = [];
  const secilen = Array.isArray(yalnizca) ? new Set(yalnizca) : null;
  for (const hazir of HAZIR_LISTE) {
    if (secilen && !secilen.has(hazir.kimlik)) continue; // yeniden deneme: yalnız önceden HA'da bulunamayanlar
    if (mevcutlar.has(hazir.kimlik)) continue;
    const varlik = var_.get(hazir.kimlik);
    if (!varlik) {
      atlananlar.push({ entity_id: hazir.kimlik, neden: 'yok' });
      continue;
    }
    const etiket = hazirEtiketAl(hazir, etiketAl);
    if (!guvenliVarlikMi(varlik) || !adGuvenliMi(hazir.kimlik, etiket)) {
      atlananlar.push({ entity_id: hazir.kimlik, neden: 'guvenlik' });
      continue;
    }
    if (sonuc.length >= EN_COK_FAVORI) {
      atlananlar.push({ entity_id: hazir.kimlik, neden: 'sinir' });
      continue;
    }
    const ad = kisalt(varlik.attributes?.friendly_name ?? '', 100) || hazir.kimlik;
    sonuc.push(favoriOlustur(hazir.kimlik, ad, { etiket, parlaklik: hazir.parlaklik === true }));
    eklenenler.push(hazir.kimlik);
  }
  return { favoriler: sonuc, eklenenler, atlananlar };
}

/**
 * Zorunlu onaylı eylemlerde (açık liste / ipucu belirteci) `onay:false` geçersizdir: alan atılır.
 * Böylece ayar dosyası elle ya da arayüzden bozulsa bile onay kapatılamaz.
 */
function onayiDuzelt(favoriler) {
  return favoriler.map((f) => {
    if (f.onay !== false) return f;
    const s = eylemSinifi({ entity_id: f.entity_id, attributes: { friendly_name: f.ad } }, { onay: false });
    if (!s.zorunlu) return f;
    const { onay: _onay, ...digerleri } = f;
    return digerleri;
  });
}

module.exports = {
  EN_COK_FAVORI,
  EN_COK_KISAYOLLU_FAVORI,
  GRUPLAR,
  HAZIR_LISTE,
  HAZIR_LISTE_SURUMU,
  grupBul,
  altGrupBul,
  tekrarliMi,
  hazirEtiket,
  favoriOlustur,
  favorileriDuzelt,
  favorileriBirlestir,
  hazirEtiketleriniTamamla,
  hazirListeUygula,
  onayiDuzelt,
};
