'use strict';

/**
 * Kamera anlık görüntüsü (o-48, 1.4.0 cihaz grubu; saf — ağ ve Electron dışarıdan verilir).
 *
 * Yalnız ANA SÜREÇTE çalışır. Canlı akış, kayıt ve ses YOKTUR: yalnız "son anlık görüntü" (HA `GET /api/camera_proxy/<kamera>`).
 *
 * GİZLİLİK ve GÜVENLİK
 *  - Bir kamera YALNIZ kullanıcı Ayarlar'da onu tek tek onayladıysa (ayar `kameraIzinleri`) panelde görünür ve görüntü çekilir.
 *    Onaylı olması yetmez: HA'daki GÜNCEL durum her çekimde yeniden süzgeçten geçer (suzgec.js kameraGuvenliMi). Kapı, zil, diafon,
 *    giriş adlı kameralar (ve marka/model metni zil/kapı diyenler) Ayarlar'daki aday listesine bile gelmez ve onaylansa da çekilmez.
 *  - Görüntü ana süreçte anahtarlı (korumalı haIstek: yetki kesici, kimlikli kapı) çekilir ve renderer'a `data:` URL olarak verilir
 *    (CSP bozulmaz; yerel dosya ya da ağ adresi yok). DİSKE YAZILMAZ: yalnız bellekte, kamera başına tek kare, panel gizlenince
 *    ya da izin listesi değişince silinir. Erişim anahtarı, adres, entity_picture ve access_token renderer'a gitmez.
 *  - En sık 5 sn'de bir çekim (kamera başına): 5 sn içinde gelen ikinci istek önbellekten (aynı kare) döner. Aynı kamera için
 *    süren istek paylaşılır. Genel üst sınır: dakikada en çok 20 çekim. Görüntü en çok 2 MB; JPEG, PNG, WebP ya da GIF
 *    imzası taşımayan içerik reddedilir (kamera yanıtı HTML/metin ise ekrana verilmez).
 *  - Pencere ekran paylaşımından gizlenir (yuzey-yoneticisi.js setContentProtection) ve görüntü panelde varsayılan BULANIKTIR.
 *
 * API (ajanlar için):
 *   kameraIzinleriniDuzelt(ham)       -> string[] | undefined   ayar `kameraIzinleri` doğrulaması (kamera kimlikleri, en çok 8, tekrarsız)
 *   kameraAdaylari(durumlar)          -> {entity_id, ad}[]       /api/states yanıtından Ayarlar'daki aday listesi (süzgeçten geçenler)
 *   kameraModeli({ izinler, durumAl }) -> {id, etiket, kullanilabilir}[]   panele giden model (yalnız onaylı + güvenli + durumu bilinen)
 *   kameraServisiOlustur({ ikiliIstek, durumAl, izinlerAl, simdi?, gunluk? })
 *       -> { al(kimlik), temizle() }
 *      al: Promise<{ ok: true, veri: 'data:image/...;base64,...', yas: number(ms), onbellek: boolean }
 *                | { ok: false, tur: 'gecersiz'|'izinsiz'|'yasak'|'ulasilamiyor'|'cok-sik'|'ha-hatasi'|'goruntu-yok' }>
 *   goruntuTuru(baytlar) -> 'image/jpeg'|'image/png'|'image/webp'|'image/gif'|null   dosya imzasından tür
 */

const { alanAl, kameraGuvenliMi, kameraKimligiGuvenliMi } = require('./suzgec');
const { kisalt } = require('./metin');

const EN_COK_KAMERA = 8;
const EN_AZ_YENILEME_MS = 5000; // kamera başına iki çekim arası alt sınır
const YENILEME_SECENEKLERI = Object.freeze([0, 5, 10, 30, 60]); // saniye; 0 = yalnız elle (varsayılan)
const EN_BUYUK_GORUNTU_BAYT = 2 * 1024 * 1024;
const DAKIKA_CEKIM_SINIRI = 20;
const ETIKET_SINIRI = 40;
const GORUNTU_TURLERI = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Ayar `kameraIzinleri`: kamera kimlikleri listesi. Geçersiz/yasak/tekrar eden öğe sessizce düşer; dizi değilse undefined. */
function kameraIzinleriniDuzelt(ham) {
  if (!Array.isArray(ham)) return undefined;
  const sonuc = [];
  for (const kimlik of ham) {
    if (sonuc.length >= EN_COK_KAMERA) break;
    if (kameraKimligiGuvenliMi(kimlik) && !sonuc.includes(kimlik)) sonuc.push(kimlik);
  }
  return sonuc;
}

const nitelikler = (varlik) => (varlik?.attributes && typeof varlik.attributes === 'object' && !Array.isArray(varlik.attributes) ? varlik.attributes : {});

function canliAd(varlik) {
  const ad = nitelikler(varlik).friendly_name;
  return typeof ad === 'string' && ad.trim() ? kisalt(ad, ETIKET_SINIRI) : '';
}

/**
 * Ayarlar'daki kamera aday listesi: HA'daki tüm durumlardan, kamera Kapı Kuralı'ndan (kapı/zil/diafon/giriş elenir) geçenler, ada göre sıralı.
 * @param {unknown} durumlar GET /api/states yanıtı
 * @param {string} [dil] arayüz dili (tr, en, de, fr, es): sıralama o dilin karşılaştırma kuralıyla yapılır (cihaz listesiyle tutarlı); bilinmiyorsa 'tr'
 * @returns {{entity_id: string, ad: string}[]}
 */
function kameraAdaylari(durumlar, dil = 'tr') {
  if (!Array.isArray(durumlar)) return [];
  const sonuc = [];
  for (const v of durumlar) {
    if (!v || typeof v.entity_id !== 'string' || alanAl(v.entity_id) !== 'camera' || !kameraGuvenliMi(v)) continue;
    sonuc.push({ entity_id: v.entity_id, ad: canliAd(v) || v.entity_id });
  }
  const yerel = ['tr', 'en', 'de', 'fr', 'es'].includes(dil) ? dil : 'tr';
  return sonuc.sort((a, b) => a.ad.localeCompare(b.ad, yerel) || a.entity_id.localeCompare(b.entity_id));
}

/**
 * Panele giden kamera modeli. Yalnız onaylı, HA'daki güncel durumu süzgeçten geçen kameralar; durumu henüz bilinmeyen kamera görünmez.
 * `etiket` HA'daki ad (süzgeçten geçmiş, kısaltılmış). Görüntü ve adres modelde yoktur.
 * @returns {{id: string, etiket: string, kullanilabilir: boolean}[]}
 */
function kameraModeli({ izinler, durumAl }) {
  const sonuc = [];
  for (const kimlik of Array.isArray(izinler) ? izinler : []) {
    if (sonuc.length >= EN_COK_KAMERA) break;
    if (!kameraKimligiGuvenliMi(kimlik)) continue;
    const varlik = durumAl(kimlik);
    if (!varlik || typeof varlik !== 'object' || varlik.entity_id !== kimlik || !kameraGuvenliMi(varlik)) continue;
    sonuc.push({ id: kimlik, etiket: canliAd(varlik) || kimlik, kullanilabilir: varlik.state !== 'unavailable' });
  }
  return sonuc;
}

/** Dosya imzasından görüntü türü (JPEG FFD8FF, PNG 89504E47, GIF "GIF8", WebP "RIFF....WEBP"); tanınmazsa null. */
function goruntuTuru(baytlar) {
  const b = baytlar;
  if (!b || typeof b.length !== 'number' || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function dataUrlYap(tur, baytlar) {
  return `data:${tur};base64,${Buffer.from(baytlar).toString('base64')}`;
}

/**
 * @param {object} bag
 * @param {(yol: string) => Promise<{icerikTuru: string, baytlar: Uint8Array}>} bag.ikiliIstek korumalı GET (main.js: haIstek(yol, { ikili: { enCok } }))
 * @param {(kimlik: string) => object|null|undefined} bag.durumAl durum deposu okuyucu (HA'daki GÜNCEL durum)
 * @param {() => string[]} bag.izinlerAl kullanıcının onayladığı kamera kimlikleri (ayar kameraIzinleri)
 * @param {() => number} [bag.simdi]
 * @param {(m: string) => void} [bag.gunluk] yalnız sabit metin (kimlik ve içerik yazılmaz)
 */
function kameraServisiOlustur({ ikiliIstek, durumAl, izinlerAl, simdi = () => Date.now(), gunluk = () => {} }) {
  const onbellek = new Map(); // kimlik -> { zaman, veri }  (yalnız bellek)
  const surenler = new Map(); // kimlik -> Promise
  let cekimler = []; // son 60 sn'deki ağ çekimlerinin zamanları
  let nesil = 0; // temizle() her çağrıldığında artar: temizlemeden ÖNCE başlayan çekim kareyi belleğe geri koymaz

  function cekimHakkiVarMi() {
    const t = simdi();
    cekimler = cekimler.filter((z) => t - z < 60_000);
    if (cekimler.length >= DAKIKA_CEKIM_SINIRI) return false;
    cekimler.push(t);
    return true;
  }

  async function cek(kimlik) {
    const baslangicNesli = nesil;
    let yanit;
    try {
      yanit = await ikiliIstek(`/api/camera_proxy/${kimlik}`);
    } catch (hata) {
      gunluk(`Kamera görüntüsü alınamadı: ${typeof hata?.tur === 'string' ? hata.tur : 'bilinmeyen'}`);
      return { ok: false, tur: hata?.tur === 'bulunamadi' ? 'ulasilamiyor' : 'ha-hatasi' };
    }
    const baytlar = yanit?.baytlar;
    if (!baytlar || typeof baytlar.length !== 'number' || baytlar.length === 0 || baytlar.length > EN_BUYUK_GORUNTU_BAYT) return { ok: false, tur: 'goruntu-yok' };
    const tur = goruntuTuru(baytlar);
    const bildirilen = typeof yanit.icerikTuru === 'string' ? yanit.icerikTuru.split(';')[0].trim().toLowerCase() : '';
    // İçerik imzası belirleyicidir; sunucunun bildirdiği tür varsa görüntü (ya da genel ikili) olmalı: HTML/metin hata sayfası görüntü sayılmaz.
    if (!tur || !GORUNTU_TURLERI.includes(tur) || (bildirilen !== '' && !bildirilen.startsWith('image/') && bildirilen !== 'application/octet-stream')) {
      return { ok: false, tur: 'goruntu-yok' };
    }
    const veri = dataUrlYap(tur, baytlar);
    if (baslangicNesli === nesil) onbellek.set(kimlik, { zaman: simdi(), veri });
    return { ok: true, veri, yas: 0, onbellek: false };
  }

  return {
    /** Kamera için son anlık görüntüyü verir (gerekirse çeker). Yalnız onaylı ve güvenli kameralar. */
    async al(kimlik) {
      if (typeof kimlik !== 'string' || !kameraKimligiGuvenliMi(kimlik)) return { ok: false, tur: 'gecersiz' };
      const izinler = izinlerAl();
      if (!Array.isArray(izinler) || !izinler.includes(kimlik)) return { ok: false, tur: 'izinsiz' };
      const varlik = durumAl(kimlik);
      if (!varlik || typeof varlik !== 'object' || varlik.entity_id !== kimlik) return { ok: false, tur: 'ulasilamiyor' };
      if (!kameraGuvenliMi(varlik)) {
        onbellek.delete(kimlik);
        return { ok: false, tur: 'yasak' };
      }
      if (varlik.state === 'unavailable') return { ok: false, tur: 'ulasilamiyor' };
      const kayit = onbellek.get(kimlik);
      const gecen = kayit ? simdi() - kayit.zaman : Infinity;
      if (kayit && gecen >= 0 && gecen < EN_AZ_YENILEME_MS) return { ok: true, veri: kayit.veri, yas: gecen, onbellek: true }; // en sık 5 sn'de bir çekim
      if (surenler.has(kimlik)) return surenler.get(kimlik);
      if (!cekimHakkiVarMi()) return kayit ? { ok: true, veri: kayit.veri, yas: Math.max(0, gecen), onbellek: true } : { ok: false, tur: 'cok-sik' };
      const soz = cek(kimlik).finally(() => surenler.delete(kimlik));
      surenler.set(kimlik, soz);
      return soz;
    },
    /** Bellekteki kareleri siler (panel gizlendi, izin listesi değişti, anahtar silindi). */
    temizle() {
      nesil += 1;
      onbellek.clear();
    },
    /** Bellekte kare tutulan kamera sayısı (test/tanı). */
    onbellekSayisi: () => onbellek.size,
  };
}

module.exports = {
  EN_COK_KAMERA,
  EN_AZ_YENILEME_MS,
  YENILEME_SECENEKLERI,
  EN_BUYUK_GORUNTU_BAYT,
  DAKIKA_CEKIM_SINIRI,
  GORUNTU_TURLERI,
  kameraIzinleriniDuzelt,
  kameraAdaylari,
  kameraModeli,
  goruntuTuru,
  kameraServisiOlustur,
};
