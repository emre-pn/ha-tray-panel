'use strict';

/**
 * Özel HTTP üstbilgileri (1.4.0, o-55; saf — Electron'a bağlı değildir).
 *
 * Neden var: Home Assistant'ı Cloudflare Access (ya da başka bir ters vekil / SSO katmanı) arkasında yayınlayanlar her isteğe bir servis
 * jetonu üstbilgisi (örn. CF-Access-Client-Id ve CF-Access-Client-Secret) eklemek zorundadır; yoksa REST, canlı bağlantı ve HA penceresi
 * katmandan geçemez. Kullanıcı bu çiftleri Ayarlar > Bağlantı'da tanımlar.
 *
 * Güvenlik (değerler anahtarla AYNI muameleyi görür):
 *  - Değerler yalnız şifreli depoda durur (anahtar-deposu.js, safeStorage/DPAPI; dosya `ozel-ustbilgiler.dat`). Ayar dosyasına, dışa
 *    aktarmaya, klasör eşitlemeye, günlüğe, hata iletisine ve tanılama raporuna GİRMEZ; Ayarlar sayfasına yalnız ADLAR gider.
 *  - Üstbilgiler yalnız ayardaki iki Home Assistant kökenine (ev içi + dış adres) ve yalnız anahtarIcinGuvenliAdresMi'den geçen bir köke
 *    eklenir: herkese açık bir ada düz http ile gitmez; yönlendirme izlenmez, bu yüzden başka bir ana bilgisayara sızmaz.
 *  - Kimlik ve gövde üstbilgileri (Authorization, Host, Content-Type, Cookie...) tanımlanamaz: kullanıcı üstbilgisi anahtarlı isteğin
 *    kimliğini ya da biçimini değiştiremez. Değer yalnız görünür ASCII olabilir (CR/LF ve denetim karakteri yok: üstbilgi enjeksiyonu olmaz).
 *  - 403 yanıtı yetki kesicinin 15 dakikalık adres duraklatmasını tetikleyebilir; üstbilgisi eksik/yanlış bir Cloudflare engelinin de
 *    görüntüsü budur (ha-istemcisi.js değişmedi): Ayarlar'daki "Üstbilgileri dene" düğmesi anahtarsız yoklamayla durumu ayırt eder.
 */

const { anahtarIcinGuvenliAdresMi } = require('./dogrulama');

const EN_COK_USTBILGI = 8;
const AD_EN_UZUN = 64;
const DEGER_EN_UZUN = 2048;
const AD_DESENI = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const DEGER_DESENI = /^[\x20-\x7E]+$/; // görünür ASCII ve boşluk; CR, LF, sekme ve denetim karakterleri dışarıda

/** Kullanıcının tanımlayamayacağı üstbilgi adları (küçük harf): kimlik, bağlantı, gövde ve yönlendirme. */
const YASAK_ADLAR = Object.freeze(
  new Set([
    'host',
    'connection',
    'keep-alive',
    'upgrade',
    'te',
    'trailer',
    'transfer-encoding',
    'content-length',
    'content-type',
    'content-encoding',
    'content-range',
    'expect',
    'accept',
    'accept-encoding',
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'origin',
    'referer',
    'user-agent',
    'range',
    'forwarded',
    'x-real-ip',
    'via',
    'date',
  ]),
);
/** Bu önekle başlayan adlar da yasaktır (tarayıcıya ve bağlantı katmanına ayrılmış / IP bilgisi taşıyan). */
const YASAK_ONEKLER = Object.freeze(['sec-', 'proxy-', 'x-forwarded-']);

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/** Üstbilgi adı yasak mı (büyük/küçük harf fark etmez)? */
function adYasakMi(ad) {
  const k = String(ad).toLowerCase();
  return YASAK_ADLAR.has(k) || YASAK_ONEKLER.some((onek) => k.startsWith(onek));
}

/**
 * Kullanıcı girdisi: [{ad, deger}] (deger null/undefined: "mevcut değeri koru", yalnız `mevcut` listesinde aynı adla varsa).
 * Hiçbir şey fırlatmaz.
 * @param {unknown} girdi
 * @param {{ mevcut?: {ad: string, deger: string}[] }} [secenek]
 * @returns {{ ok: boolean, liste: {ad: string, deger: string}[], hatalar: {sira: number, neden: 'ad-gecersiz'|'ad-yasak'|'deger-gecersiz'|'deger-yok'|'tekrar'|'cok-fazla'}[] }}
 */
function ustbilgileriDogrula(girdi, { mevcut = [] } = {}) {
  const liste = [];
  const hatalar = [];
  if (!Array.isArray(girdi)) return { ok: false, liste, hatalar: [{ sira: 0, neden: 'ad-gecersiz' }] };
  const mevcutDegerler = new Map((Array.isArray(mevcut) ? mevcut : []).filter((m) => typeof m?.ad === 'string' && typeof m?.deger === 'string').map((m) => [m.ad.toLowerCase(), m.deger]));
  const gorulen = new Set();
  girdi.forEach((oge, sira) => {
    if (!duzNesneMi(oge)) {
      hatalar.push({ sira, neden: 'ad-gecersiz' });
      return;
    }
    const ad = typeof oge.ad === 'string' ? oge.ad.trim() : '';
    if (ad === '' || ad.length > AD_EN_UZUN || !AD_DESENI.test(ad)) {
      hatalar.push({ sira, neden: 'ad-gecersiz' });
      return;
    }
    if (adYasakMi(ad)) {
      hatalar.push({ sira, neden: 'ad-yasak' });
      return;
    }
    if (gorulen.has(ad.toLowerCase())) {
      hatalar.push({ sira, neden: 'tekrar' });
      return;
    }
    if (liste.length >= EN_COK_USTBILGI) {
      hatalar.push({ sira, neden: 'cok-fazla' });
      return;
    }
    let deger;
    if (oge.deger === null || oge.deger === undefined) {
      deger = mevcutDegerler.get(ad.toLowerCase());
      if (deger === undefined) {
        hatalar.push({ sira, neden: 'deger-yok' });
        return;
      }
    } else {
      deger = typeof oge.deger === 'string' ? oge.deger.trim() : '';
      if (deger === '') {
        hatalar.push({ sira, neden: 'deger-yok' });
        return;
      }
      if (deger.length > DEGER_EN_UZUN || !DEGER_DESENI.test(deger)) {
        hatalar.push({ sira, neden: 'deger-gecersiz' });
        return;
      }
    }
    gorulen.add(ad.toLowerCase());
    liste.push({ ad, deger });
  });
  return { ok: hatalar.length === 0, liste, hatalar };
}

/** Depodan okunan ham JSON: geçersiz öğeler sessizce düşer (bozuk/elle değişmiş dosya uygulamayı durdurmaz). */
function depodanDuzelt(ham) {
  let veri = ham;
  if (typeof ham === 'string') {
    try {
      veri = JSON.parse(ham);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(veri)) return [];
  const sonuc = [];
  for (const oge of veri) {
    const d = ustbilgileriDogrula([oge]);
    if (d.ok && sonuc.length < EN_COK_USTBILGI && !sonuc.some((s) => s.ad.toLowerCase() === d.liste[0].ad.toLowerCase())) sonuc.push(d.liste[0]);
  }
  return sonuc;
}

/** Adres (ws/wss dahil) -> "http(s)://host[:port]" kökeni; geçersizse null. */
function kokenCoz(adres) {
  try {
    const u = new URL(adres);
    if (u.protocol === 'ws:') u.protocol = 'http:';
    else if (u.protocol === 'wss:') u.protocol = 'https:';
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Bu adrese (URL ya da ws/wss) gidecek istek için eklenecek üstbilgiler; ayardaki iki kökenden biri değilse, kök anahtar için güvenli
 * değilse ya da tanımlı üstbilgi yoksa null.
 * @param {string} adres
 * @param {{ liste: {ad: string, deger: string}[], izinliKokenler: Iterable<string> }} baglam
 * @returns {Record<string, string>|null}
 */
function adresIcinUstbilgi(adres, { liste, izinliKokenler }) {
  if (!Array.isArray(liste) || liste.length === 0) return null;
  const koken = kokenCoz(adres);
  if (!koken || !new Set(izinliKokenler).has(koken) || !anahtarIcinGuvenliAdresMi(koken)) return null;
  const nesne = {};
  for (const { ad, deger } of liste) nesne[ad] = deger;
  return nesne;
}

/**
 * fetch seçeneklerine üstbilgi ekler. Ekleme yoksa seçenek nesnesi AYNEN döner. Var olan üstbilgiler (Authorization, Content-Type...)
 * ASLA ezilmez (yasak adlar zaten tanımlanamaz; yine de çakışan ad atlanır).
 * @param {object} secenek fetch seçenekleri
 * @param {Record<string, string>|null} ekler
 */
function fetchSecenegineEkle(secenek, ekler) {
  if (!ekler || Object.keys(ekler).length === 0) return secenek;
  const temel = secenek ?? {};
  const mevcut = temel.headers;
  let basliklar;
  if (mevcut && typeof mevcut.entries === 'function' && !Array.isArray(mevcut)) basliklar = Object.fromEntries(mevcut.entries());
  else if (Array.isArray(mevcut)) basliklar = Object.fromEntries(mevcut.filter((c) => Array.isArray(c) && c.length === 2));
  else basliklar = { ...(duzNesneMi(mevcut) ? mevcut : {}) };
  const varOlanlar = new Set(Object.keys(basliklar).map((k) => k.toLowerCase()));
  for (const [ad, deger] of Object.entries(ekler)) {
    if (varOlanlar.has(ad.toLowerCase()) || adYasakMi(ad)) continue;
    basliklar[ad] = deger;
  }
  return { ...temel, headers: basliklar };
}

/**
 * Chromium webRequest.onBeforeSendHeaders için: istek üstbilgilerine ekleme yapar (aynı adlı varsa kullanıcının tanımı geçerlidir).
 * @param {Record<string, string>} istekUstbilgileri details.requestHeaders
 * @param {Record<string, string>|null} ekler
 * @returns {Record<string, string>} yeni nesne
 */
function istekUstbilgilerineEkle(istekUstbilgileri, ekler) {
  const sonuc = { ...(duzNesneMi(istekUstbilgileri) ? istekUstbilgileri : {}) };
  if (!ekler) return sonuc;
  for (const [ad, deger] of Object.entries(ekler)) {
    if (adYasakMi(ad)) continue;
    for (const k of Object.keys(sonuc)) if (k.toLowerCase() === ad.toLowerCase()) delete sonuc[k];
    sonuc[ad] = deger;
  }
  return sonuc;
}

/**
 * Şifreli depo üstüne üstbilgi listesi. `depo`: anahtarDeposuOlustur örneği (JSON metin saklar). Bellekte çözülmüş liste tutulur
 * (HA penceresi için eşzamanlı erişim gerekir); yalnız ana süreç içindir, dışarı verilmez.
 * @param {{ depo: { anahtarAl: Function, yaz: Function, sil: Function, varMi: Function }, gunluk?: Function }} girdi
 */
function ustbilgiDeposuOlustur({ depo, gunluk = () => {} }) {
  let liste = [];
  let yuklemeSozu = null;
  let yuklendi = false;
  const dinleyiciler = [];
  let yazmaSirasi = Promise.resolve();

  function degisti() {
    for (const d of dinleyiciler) {
      try {
        d();
      } catch {
        /* dinleyici hatası depoyu etkilemesin */
      }
    }
  }

  function siraya(is) {
    const sonuc = yazmaSirasi.then(is, is);
    yazmaSirasi = sonuc.catch(() => {});
    return sonuc;
  }

  return {
    /** Açılışta şifreli dosyayı okur (yoksa boş liste). Hata fırlatmaz. Çağrı sözü `hazir()` ile de beklenebilir. */
    yukle() {
      yuklemeSozu = (async () => {
        try {
          const metin = depo.varMi() ? await depo.anahtarAl() : null;
          liste = metin ? depodanDuzelt(metin) : [];
          if (metin && liste.length === 0) gunluk('Özel üstbilgi kaydı okunamadı ya da geçersizdi; boş sayıldı.');
        } catch {
          liste = [];
        }
        yuklendi = true;
        degisti();
        return liste.length;
      })();
      return yuklemeSozu;
    },
    /** İlk yükleme bitince çözülür (yukle() hiç çağrılmadıysa hemen). Ağ isteği atılmadan önce beklenir. */
    hazir: () => (yuklemeSozu ?? Promise.resolve()).then(() => undefined),
    /** Eşzamanlı sorgu: yükleme başlamadıysa ya da bittiyse true (liste güvenilir). */
    hazirMi: () => yuklemeSozu === null || yuklendi,
    /** Kopya: ad + değer (yalnız ana süreç içindir). */
    liste: () => liste.map((o) => ({ ...o })),
    /** Arayüze giden güvenli görünüm: yalnız adlar. */
    adlar: () => liste.map((o) => o.ad),
    sayi: () => liste.length,
    /**
     * Listeyi doğrular ve şifreli yazar (boş liste kaydı siler). deger null olan öğe mevcut değeri korur.
     * @returns {Promise<{ok: true, adlar: string[]} | {ok: false, hatalar: object[]} | {ok: false, sifreleme: true}>}
     */
    kaydet(girdi) {
      return siraya(async () => {
        const dogrulama = ustbilgileriDogrula(girdi, { mevcut: liste });
        if (!dogrulama.ok) return { ok: false, hatalar: dogrulama.hatalar };
        try {
          if (dogrulama.liste.length === 0) await depo.sil();
          else await depo.yaz(JSON.stringify(dogrulama.liste));
        } catch {
          return { ok: false, sifreleme: true };
        }
        liste = dogrulama.liste;
        degisti();
        return { ok: true, adlar: liste.map((o) => o.ad) };
      });
    },
    sil() {
      return siraya(async () => {
        try {
          await depo.sil();
        } catch {
          return { ok: false };
        }
        liste = [];
        degisti();
        return { ok: true };
      });
    },
    /** Liste değişince (kaydet/sil/yükle) çağrılır. */
    degistiDinle(dinleyici) {
      if (typeof dinleyici === 'function') dinleyiciler.push(dinleyici);
    },
  };
}

module.exports = {
  EN_COK_USTBILGI,
  AD_EN_UZUN,
  DEGER_EN_UZUN,
  YASAK_ADLAR,
  adYasakMi,
  ustbilgileriDogrula,
  depodanDuzelt,
  kokenCoz,
  adresIcinUstbilgi,
  fetchSecenegineEkle,
  istekUstbilgilerineEkle,
  ustbilgiDeposuOlustur,
};
