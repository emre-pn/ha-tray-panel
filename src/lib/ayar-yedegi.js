'use strict';

/**
 * Ayar dosyası yedekleri (saf; dosya sistemi ve günlük dışarıdan verilir, Electron'a bağlı değildir).
 *
 * 1) Göç öncesi yedek. Eski bir şema sürümünden gelen ayarlar.json, göçten sonra yeni biçimiyle ÜZERİNE yazılır. Bir şey ters
 *    giderse ya da kullanıcı eski sürüme dönerse özgün dosyaya dönülebilsin diye, üzerine yazılmadan ÖNCE aynı klasöre bayt
 *    bayt kopyalanır:  ayarlar.json (şema 1, yani 1.0.0'dan gelen) -> ayarlar.v1-yedek.json
 * 2) Daha yeni şemalı dosya (h-11). Kullanıcı yeni bir sürümden eski sürüme dönerse dosya bu uygulamanınkinden yeni bir şemada
 *    olur; bilinmeyen alanlar korunur (ayar-sema.js) ama yeni sürümün özgün dosyası da aynı kuralla yedeklenir:
 *    ayarlar.json (şema 6) -> ayarlar.v6-yedek.json
 * 3) Alan tipi hatası yedeği (h-33): tipi bozuk olduğu için varsayılana dönen alan varsa (ör. favoriler dizi değil) dosyanın özgün
 *    hali, üzerine yazılmadan önce zaman damgalı bir kopyaya alınır:  ayarlar.hatali-<zaman>.json
 *
 * Kurallar
 *  - Şema güncelse (ya da dosya boşsa) hiçbir şey yapılmaz.
 *  - Aynı sürümün yedeği zaten varsa ona DOKUNULMAZ (COPYFILE_EXCL: var olan dosya asla ezilmez).
 *  - Kopyalama başarısız olursa göç DURMAZ; günlüğe sırsız tek satır yazılır (yalnız hata kodu, yol/ileti yok).
 *  - Bozuk dosya buradan geçmez: ana süreçteki 'ayarlar.bozuk-<zaman>.json' yolu aynen kalır.
 */

const path = require('node:path');
const { constants } = require('node:fs');
const { SEMA_SURUMU, ayarlariDuzelt, gocGerekliMi, oncekiSemaSurumu, yeniSemaMi } = require('./ayar-sema');
const { adresNormallestir, anahtarIcinGuvenliAdresMi } = require('./dogrulama');
const { TR } = require('./ceviri-varsayilan');

const GUVENLI_HATA_KODU = /^[A-Z0-9_]{1,20}$/;

/** Örn. 1 -> 'ayarlar.v1-yedek.json'. */
const yedekDosyaAdi = (surum) => `ayarlar.v${surum}-yedek.json`;

/** Alan tipi hatası yedeğinin adı: 'ayarlar.hatali-<zaman>.json' (aynı saniyede ikinci çağrı da ezmez; zaman ms). */
const hataliYedekDosyaAdi = (zaman) => `ayarlar.hatali-${zaman}.json`;

/** Günlüğe yalnız 'EPERM' gibi kısa hata kodu girer; hata iletisi dosya yolu (kullanıcı adı) taşıyabilir. */
const hataKodu = (hata) => (typeof hata?.code === 'string' && GUVENLI_HATA_KODU.test(hata.code) ? hata.code : 'bilinmiyor');

/** Günlük yazılamasa da göç sürer. */
function gunlugeYaz(gunluk, mesaj) {
  try {
    gunluk(mesaj);
  } catch {
    /* günlük hatası göçü durdurmaz */
  }
}

/**
 * @param {{ dosya: string, ham: unknown, fs?: { copyFileSync: Function }, gunluk?: (mesaj: string) => void }} girdi
 *   dosya: ayarlar.json yolu; ham: dosyadan okunup ayrıştırılmış içerik (bozuk dosya için çağrılmaz)
 * @returns {{ durum: 'gerekmedi'|'alindi'|'zaten-var'|'alinamadi', yedek: string|null }}
 *   yedek: yedek dosyasının adı (klasörsüz). Bu işlev HİÇBİR ZAMAN hata fırlatmaz.
 */
function gocOncesiYedegiAl({ dosya, ham, fs = require('node:fs'), gunluk = () => {} } = {}) {
  const yeni = yeniSemaMi(ham);
  if (!yeni && !gocGerekliMi(ham)) return { durum: 'gerekmedi', yedek: null };
  const ad = yedekDosyaAdi(oncekiSemaSurumu(ham));
  try {
    fs.copyFileSync(dosya, path.join(path.dirname(dosya), ad), constants.COPYFILE_EXCL);
  } catch (hata) {
    if (hata?.code === 'EEXIST') return { durum: 'zaten-var', yedek: ad };
    gunlugeYaz(gunluk, `${yeni ? 'Daha yeni şemalı ayar dosyasının yedeği' : 'Göç öncesi ayar yedeği'} alınamadı (${hataKodu(hata)}); ${yeni ? 'açılış' : 'göç'} yine de sürüyor.`);
    return { durum: 'alinamadi', yedek: null };
  }
  gunlugeYaz(gunluk, yeni ? `Ayar dosyası daha yeni bir şemada (v${oncekiSemaSurumu(ham)}); üzerine yazılmadan önce yedeklendi: ${ad}` : `Ayar dosyası göçten önce yedeklendi: ${ad}`);
  return { durum: 'alindi', yedek: ad };
}

/**
 * Tipi bozuk alanları varsayılana dönen dosyanın özgün halini zaman damgalı bir kopyaya alır (h-33): "favoriler" dizi değilse
 * 0 favoriye inilir; kullanıcı elle düzeltebilsin diye özgün dosya saklanır. Bu işlev HİÇBİR ZAMAN hata fırlatmaz.
 * @param {{ dosya: string, fs?: { copyFileSync: Function }, gunluk?: Function, zaman?: number }} girdi
 * @returns {{ durum: 'alindi'|'alinamadi', yedek: string|null }}
 */
function hataliAlanYedegiAl({ dosya, fs = require('node:fs'), gunluk = () => {}, zaman = Date.now() } = {}) {
  const ad = hataliYedekDosyaAdi(zaman);
  try {
    fs.copyFileSync(dosya, path.join(path.dirname(dosya), ad), constants.COPYFILE_EXCL);
  } catch (hata) {
    gunlugeYaz(gunluk, `Hatalı alanlı ayar dosyasının yedeği alınamadı (${hataKodu(hata)}); açılış yine de sürüyor.`);
    return { durum: 'alinamadi', yedek: null };
  }
  gunlugeYaz(gunluk, `Tipi bozuk alanlı ayar dosyası üzerine yazılmadan önce yedeklendi: ${ad}`);
  return { durum: 'alindi', yedek: ad };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dışa/içe aktarma ve yedekten geri dönme (k-13). Dosya sistemi ve pencere diyalogları dışarıdan verilir (ayar-aktar.js).
// ---------------------------------------------------------------------------------------------------------------------------

const AKTARIM_BICIMI = 'ev-paneli-ayar-yedegi';
const AKTARIM_SURUMU = 1;
const AKTARIM_BAYT_SINIRI = 512 * 1024; // içe aktarılan/geri dönülen dosya için üst sınır
// Yedek listesinde yalnız bu adlar görünür ve geri dönülebilir: göç yedeği ve bozuk dosya kopyası (main.js ayarlariYukle).
const YEDEK_DOSYA_DESENI = /^ayarlar\.(?:v(\d{1,3})-yedek|bozuk-(\d{10,15}))\.json$/;
// Kullanıcının seçtiği ayarlar. Pencere ölçüleri, hazır liste sürümü, engellenen favoriler vb. aktarılmaz.
// Erişim anahtarı ayrı şifreli dosyada durur ve ASLA aktarılmaz: ayar nesnesine yanlışlıkla gizli bir alan girse bile
// bu BEYAZ LİSTE dışında kaldığı için dosyaya yazılmaz (ayrıca metin, JWT benzeri değer için taranır).
const AKTARILAN_ALANLAR = Object.freeze([
  'yerelAdres',
  'disAdres',
  'kisayol',
  'paletKisayol',
  'tepsiSolTik',
  'canliBaglanti',
  'otomatikBaslat',
  'pencereBoyutu',
  'odakKaybindaGizle',
  'anaPanoyaDonDk',
  'koseBildirimi',
  'bipSesi',
  'temaZorla',
  'vurguRengi',
  'yeniPencereMalzemesi',
  'favoriler',
  'panolar',
]);
const GIZLI_DEGER_DESENI = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/;
const FAVORI_ALANLARI = ['entity_id', 'ad', 'onay', 'etiket', 'kisayol', 'parlaklik'];

const duzNesne = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : null);

/** Aktarılacak ayar kümesi: beyaz listedeki alanlar, favoriler yalnız bilinen alanlarıyla. */
function aktarilacakAyarlar(ayarlar) {
  const g = duzNesne(ayarlar) ?? {};
  const sonuc = {};
  for (const alan of AKTARILAN_ALANLAR) {
    if (g[alan] === undefined) continue;
    if (alan === 'favoriler') {
      sonuc.favoriler = (Array.isArray(g.favoriler) ? g.favoriler : []).map((f) => {
        const kopya = {};
        for (const a of FAVORI_ALANLARI) if (f && f[a] !== undefined) kopya[a] = f[a];
        return kopya;
      });
    } else if (alan === 'panolar') {
      sonuc.panolar = (Array.isArray(g.panolar) ? g.panolar : []).map((p) => ({ ad: p?.ad, yol: p?.yol, ...(p?.kisayol ? { kisayol: p.kisayol } : {}) }));
    } else {
      sonuc[alan] = g[alan];
    }
  }
  return sonuc;
}

/**
 * Ayarları dışa aktarılacak JSON metnine çevirir. Erişim anahtarı/token dosyaya GİRMEZ (beyaz liste); JWT benzeri bir değer
 * yine de serbest metin alanlarından (karo adı, pano adı...) sızarsa dışa aktarma reddedilir.
 * @returns {{ ok: true, metin: string, ayarSayisi: number, favoriSayisi: number } | { ok: false, hata: string }}
 */
function ayarlariDisaAktar(ayarlar, { simdi = new Date(), t = TR } = {}) {
  const icerik = aktarilacakAyarlar(ayarlar);
  const dosya = {
    bicim: AKTARIM_BICIMI,
    aktarimSurumu: AKTARIM_SURUMU,
    semaSurumu: SEMA_SURUMU,
    tarih: simdi.toISOString(),
    not: t('yedek.not'),
    ayarlar: icerik,
  };
  const metin = `${JSON.stringify(dosya, null, 2)}\n`;
  if (GIZLI_DEGER_DESENI.test(metin)) {
    return { ok: false, hata: t('yedek.disaGizli') };
  }
  return { ok: true, metin, ayarSayisi: Object.keys(icerik).length, favoriSayisi: (icerik.favoriler ?? []).length };
}

/**
 * İçe aktarılan ya da yedekten dönülen ham içeriği doğrular ve temizler. İki biçim kabul edilir: bu uygulamanın dışa aktarma
 * dosyası ve ayarlar.json biçimindeki yedekler (ayarlar.v1-yedek.json, ayarlar.bozuk-*.json). İçerik ayar şemasından
 * (ayarlariDuzelt: değer doğrulama, göç, kapı/kilit süzgeci) geçer; bilinmeyen alanlar (anahtar, token...) alınmaz.
 * Yalnız DOSYADA BULUNAN alanlar döner; bulunmayanlar mevcut ayarda kalır.
 * @param {unknown} ham JSON.parse sonucu
 * @param {{ varsayilan?: object, t?: Function }} [secenek] t: çevirmen (hata iletileri o dilde; verilmezse Türkçe)
 * @returns {{ ok: true, ayarlar: object, alanlar: string[], notlar: string[], atilanlar: {entity_id:string, neden:string}[], kaynak: 'aktarim'|'ayar-dosyasi' } | { ok: false, hata: string }}
 */
function ayarYedeginiCoz(ham, { varsayilan = {}, t = TR } = {}) {
  const g = duzNesne(ham);
  if (!g) return { ok: false, hata: t('yedek.degil') };
  let ayarHam;
  let kaynak;
  if (g.bicim === AKTARIM_BICIMI) {
    if (!Number.isInteger(g.aktarimSurumu) || g.aktarimSurumu < 1) return { ok: false, hata: t('yedek.surumOkunamadi') };
    if (g.aktarimSurumu > AKTARIM_SURUMU) return { ok: false, hata: t('yedek.dahaYeniSurum') };
    ayarHam = duzNesne(g.ayarlar);
    kaynak = 'aktarim';
    if (!ayarHam) return { ok: false, hata: t('yedek.ayarYok') };
    if (Number.isInteger(g.semaSurumu) && g.semaSurumu > SEMA_SURUMU) return { ok: false, hata: t('yedek.dahaYeniBicim') };
    // Dışa aktarılan ayarlar şema sürümünü kökte taşır: ayar şeması göçü doğru sürümle çalışsın.
    ayarHam = { semaSurumu: Number.isInteger(g.semaSurumu) ? g.semaSurumu : SEMA_SURUMU, ...ayarHam };
  } else if (typeof g.yerelAdres === 'string' || Array.isArray(g.favoriler) || Number.isInteger(g.semaSurumu)) {
    ayarHam = g;
    kaynak = 'ayar-dosyasi';
    if (Number.isInteger(g.semaSurumu) && g.semaSurumu > SEMA_SURUMU) return { ok: false, hata: t('yedek.dahaYeniBicim') };
  } else {
    return { ok: false, hata: t('yedek.degil') };
  }
  // Geçersiz adres sessizce varsayılana dönmesin: içe aktarma açıkça reddedilir.
  if (Object.hasOwn(ayarHam, 'yerelAdres')) {
    const yerel = adresNormallestir(ayarHam.yerelAdres);
    if (yerel === null) return { ok: false, hata: t('yedek.yerelGecersiz') };
    if (!anahtarIcinGuvenliAdresMi(yerel)) return { ok: false, hata: t('yedek.yerelHttp') };
  }
  if (typeof ayarHam.disAdres === 'string' && ayarHam.disAdres.trim() !== '' && adresNormallestir(ayarHam.disAdres, true) === null) return { ok: false, hata: t('yedek.disGecersiz') };
  const sonuc = ayarlariDuzelt(ayarHam, { varsayilan });
  const ayarlar = {};
  const alanlar = [];
  for (const alan of AKTARILAN_ALANLAR) {
    if (!Object.hasOwn(ayarHam, alan) || sonuc.ayarlar[alan] === undefined) continue;
    ayarlar[alan] = sonuc.ayarlar[alan];
    alanlar.push(alan);
  }
  if (alanlar.length === 0) return { ok: false, hata: t('yedek.alinacakYok') };
  // Şema düzeltmesinin sessizce varsayılana çevirdiği alanlar kullanıcıya bildirilir.
  const notlar = sonuc.notlar.filter((n) => n === 'kisayol-varsayilana-donduruldu' || n === 'palet-kisayol-varsayilana-donduruldu');
  return { ok: true, ayarlar, alanlar, notlar, atilanlar: sonuc.atilanlar.filter((a) => a.neden !== 'tekrar'), kaynak };
}

/** Yedek dosya adı geçerli mi (yalnız bu klasördeki beklenen adlar; yol ayırıcı içeremez). */
const yedekAdiGecerliMi = (ad) => typeof ad === 'string' && YEDEK_DOSYA_DESENI.test(ad);

/** Dosyayı sınırlı boyutta okuyup JSON olarak çözer. @returns {{ok:true, ham: unknown}|{ok:false, hata:string}} Hata fırlatmaz. */
function jsonDosyasiniOku(dosya, fs = require('node:fs'), t = TR) {
  try {
    const bilgi = fs.statSync(dosya);
    if (!bilgi.isFile()) return { ok: false, hata: t('yedek.okunamadi') };
    if (bilgi.size > AKTARIM_BAYT_SINIRI) return { ok: false, hata: t('yedek.cokBuyuk') };
    return { ok: true, ham: JSON.parse(fs.readFileSync(dosya, 'utf8').replace(/^\uFEFF/, '')) };
  } catch (hata) {
    return { ok: false, hata: t(hata instanceof SyntaxError ? 'yedek.jsonDegil' : 'yedek.okunamadi') };
  }
}

/**
 * Ayar klasöründeki geri dönülebilir yedekler (en yeni önce). Hata fırlatmaz; klasör okunamazsa boş liste.
 * @returns {{ ad: string, tur: 'goc'|'bozuk', surum: number|null, zaman: number, bayt: number, okunabilir: boolean }[]}
 */
function yedekleriListele({ dizin, fs = require('node:fs') } = {}) {
  let adlar;
  try {
    adlar = fs.readdirSync(dizin);
  } catch {
    return [];
  }
  const sonuc = [];
  for (const ad of adlar) {
    const e = YEDEK_DOSYA_DESENI.exec(ad);
    if (!e) continue;
    const dosya = path.join(dizin, ad);
    let bilgi;
    try {
      bilgi = fs.statSync(dosya);
    } catch {
      continue;
    }
    if (!bilgi.isFile()) continue;
    const goc = e[1] !== undefined;
    const okunan = jsonDosyasiniOku(dosya, fs);
    sonuc.push({
      ad,
      tur: goc ? 'goc' : 'bozuk',
      surum: goc ? Number(e[1]) : null,
      zaman: goc ? Math.round(bilgi.mtimeMs) : Number(e[2]),
      bayt: bilgi.size,
      okunabilir: okunan.ok && !!duzNesne(okunan.ham),
    });
  }
  return sonuc.sort((a, b) => b.zaman - a.zaman);
}

module.exports = {
  AKTARIM_BICIMI,
  AKTARIM_SURUMU,
  AKTARIM_BAYT_SINIRI,
  AKTARILAN_ALANLAR,
  yedekDosyaAdi,
  hataliYedekDosyaAdi,
  gocOncesiYedegiAl,
  hataliAlanYedegiAl,
  ayarlariDisaAktar,
  ayarYedeginiCoz,
  yedekAdiGecerliMi,
  jsonDosyasiniOku,
  yedekleriListele,
};
