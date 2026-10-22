'use strict';

/**
 * Yerel API (o-52, 1.4.0 dis grubu). Saf Node (node:http, node:crypto); Electron'a bağlı değildir.
 *
 * Aynı bilgisayardaki betiklerin (Stream Deck, AutoHotkey, PowerShell...) favori çalıştırması için çok dar bir HTTP ucu:
 *  - YALNIZ 127.0.0.1'de dinler (0.0.0.0 / ağ arabirimi yok); bağlanan adres de geri döngü olmalıdır.
 *  - Host başlığı tam olarak 127.0.0.1:<port> ya da localhost:<port> olmalıdır (DNS yeniden bağlama saldırısı).
 *  - Origin başlığı (ya da tarayıcının Sec-Fetch-* başlıkları) olan HER istek reddedilir: tarayıcıdaki bir sayfa API'yi kullanamaz.
 *    CORS başlığı HİÇ verilmez; ön uçuş (OPTIONS) dahil POST dışı her yöntem 405'tir.
 *  - Yalnız POST + Content-Type: application/json; gövde en çok GOVDE_SINIRI bayt, sıkı şema (bilinmeyen alan reddedilir).
 *  - Authorization: Bearer <jeton>. Jeton rastgele 32 bayttır, safeStorage ile saklanır (src/lib/anahtar-deposu.js), sabit zamanlı
 *    karşılaştırılır; art arda yanlış jeton denemesi geçici kilit (429) getirir. Jeton ASLA günlüğe, yanıta, hata iletisine yazılmaz.
 *  - Genel hız sınırı; asıl eylem yine src/lib/dis-tetik.js kapısından ve tek güvenli eylem hattından geçer.
 *
 * Uçlar (hepsi POST, gövde JSON):
 *   /eylem  { "ad": "Salon", "islem"?: "ac"|"kapat"|"degistir", "parlaklik"?: 0-100, "adim"?: ±1-100 }  -> { ok, ad }
 *   /durum  { "ad": "Salon" }                                                                   -> { ok, ad, alan, durum, yuzde }
 *   /liste  {}                                                                                  -> { ok, favoriler: [...] }
 */

const http = require('node:http');
const crypto = require('node:crypto');

const VARSAYILAN_PORT = 48123;
const YOLLAR = Object.freeze(['/eylem', '/durum', '/liste']);
const GOVDE_SINIRI = 1024;
const AD_SINIRI = 60;
const ISLEMLER = Object.freeze(['ac', 'kapat', 'degistir']);
const JETON_DESENI = /^[A-Za-z0-9_-]{43}$/; // 32 bayt base64url
const HIZ = Object.freeze({ enCok: 30, pencereMs: 10_000 });
const KILIT = Object.freeze({ deneme: 5, pencereMs: 60_000, sureMs: 60_000 });
const GERI_DONGU = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

/** Sonuç türü -> HTTP durum kodu. Listede olmayan tür 502'dir (ayrıntı verilmez). */
const DURUM_KODLARI = Object.freeze({
  gecersiz: 400,
  sinir: 400,
  yasak: 403,
  'kaynak-izinsiz': 403,
  'onay-gerekli': 403,
  bulunamadi: 404,
  belirsiz: 409,
  desteklenmiyor: 422,
  komutGerekli: 422,
  'cok-sik': 429,
  kapali: 503,
  'jeton-yok': 503,
});

/** Yeni rastgele jeton (base64url, 43 karakter). */
function jetonUret(rastgele = crypto.randomBytes) {
  return rastgele(32).toString('base64url');
}

function jetonGecerliMi(jeton) {
  return typeof jeton === 'string' && JETON_DESENI.test(jeton);
}

/** Sabit zamanlı karşılaştırma (uzunluk farkı da sızmasın diye özetler karşılaştırılır). */
function jetonEsitMi(verilen, beklenen) {
  if (typeof verilen !== 'string' || !jetonGecerliMi(beklenen)) return false;
  const a = crypto.createHash('sha256').update(verilen, 'utf8').digest();
  const b = crypto.createHash('sha256').update(beklenen, 'utf8').digest();
  return crypto.timingSafeEqual(a, b) && verilen.length === beklenen.length;
}

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d) && Object.getPrototypeOf(d) === Object.prototype;

/**
 * Gövde şeması (sıkı). Geçerliyse kapıya gidecek düz nesne, değilse null.
 * @param {string} yol
 * @param {unknown} govde
 */
function govdeDogrula(yol, govde) {
  if (!duzNesneMi(govde)) return null;
  const anahtarlar = Object.keys(govde);
  if (yol === '/liste') return anahtarlar.length === 0 ? {} : null;
  const izinli = yol === '/durum' ? ['ad'] : ['ad', 'islem', 'parlaklik', 'adim'];
  if (anahtarlar.some((k) => !izinli.includes(k))) return null;
  const { ad, islem, parlaklik, adim } = govde;
  if (typeof ad !== 'string' || ad.trim() === '' || ad.length > AD_SINIRI || /[\u0000-\u001F\u007F-\u009F]/.test(ad)) return null;
  const sonuc = { ad };
  if (yol === '/durum') return sonuc;
  if ([islem, parlaklik, adim].filter((d) => d !== undefined).length > 1) return null;
  if (islem !== undefined) {
    if (!ISLEMLER.includes(islem)) return null;
    sonuc.islem = islem;
  }
  if (parlaklik !== undefined) {
    if (!Number.isInteger(parlaklik) || parlaklik < 0 || parlaklik > 100) return null;
    sonuc.parlaklik = parlaklik;
  }
  if (adim !== undefined) {
    if (!Number.isInteger(adim) || adim === 0 || Math.abs(adim) > 100) return null;
    sonuc.adim = adim;
  }
  return sonuc;
}

/** Host başlığı tam olarak 127.0.0.1:<port> ya da localhost:<port> mu? */
function hostGecerliMi(host, port) {
  if (typeof host !== 'string') return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/**
 * @param {object} bag
 * @param {() => Promise<string|null>|string|null} bag.jetonAl geçerli jeton (yoksa null: her istek 503)
 * @param {(yol: '/eylem'|'/durum'|'/liste', govde: object) => Promise<object>|object} bag.isle kapıya iletir; { ok, tur?, ... } döner
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 * @param {Function} [bag.sunucuOlustur] (test) http.createServer yerine
 */
function yerelApiOlustur({ jetonAl, isle, gunluk = () => {}, simdi = () => Date.now(), sunucuOlustur = http.createServer }) {
  let sunucu = null;
  let port = null;
  let hata = null;
  const istekZamanlari = [];
  const yanlislar = [];
  let kilitBitis = 0;

  function yanitla(res, kod, govde, ek = {}) {
    if (res.headersSent || res.writableEnded) return;
    const metin = JSON.stringify(govde);
    res.writeHead(kod, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(metin),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'close',
      ...ek,
    });
    res.end(metin);
  }

  function hizIzni() {
    const an = simdi();
    while (istekZamanlari.length > 0 && an - istekZamanlari[0] >= HIZ.pencereMs) istekZamanlari.shift();
    if (istekZamanlari.length >= HIZ.enCok) return false;
    istekZamanlari.push(an);
    return true;
  }

  function kilitliMi() {
    return simdi() < kilitBitis;
  }

  function yanlisKaydet() {
    const an = simdi();
    while (yanlislar.length > 0 && an - yanlislar[0] >= KILIT.pencereMs) yanlislar.shift();
    yanlislar.push(an);
    if (yanlislar.length >= KILIT.deneme) {
      kilitBitis = an + KILIT.sureMs;
      yanlislar.length = 0;
      // Kilitliyken jeton denetimine inilmez (istekIsle 429 döner): yeni kilit ancak öncekinin bitiminden sonra açılır, yani her kilit
      // penceresi için tek satır yazılır (en çok dakikada bir); sonraki kilitler de günlükte görünür.
      gunluk('Yerel API: art arda yanlış jeton; geçici kilit.');
    }
  }

  function govdeOku(req) {
    return new Promise((coz) => {
      const parcalar = [];
      let boyut = 0;
      let bitti = false;
      const son = (sonuc) => {
        if (bitti) return;
        bitti = true;
        coz(sonuc);
      };
      req.on('data', (p) => {
        boyut += p.length;
        if (boyut > GOVDE_SINIRI) {
          req.pause?.(); // kalan veri okunmaz; 413 yanıtı "Connection: close" ile bağlantıyı kapatır
          son({ hata: 413 });
          return;
        }
        parcalar.push(p);
      });
      req.on('end', () => son({ metin: Buffer.concat(parcalar).toString('utf8') }));
      req.on('error', () => son({ hata: 400 }));
      req.on('aborted', () => son({ hata: 400 }));
    });
  }

  /** Tek istek (testler doğrudan çağırabilir). */
  async function istekIsle(req, res) {
    try {
      if (!GERI_DONGU.has(req.socket?.remoteAddress)) {
        req.socket?.destroy?.();
        return;
      }
      const b = req.headers ?? {};
      if (b.origin !== undefined || b['sec-fetch-site'] !== undefined || b['sec-fetch-mode'] !== undefined || b['sec-fetch-dest'] !== undefined) {
        return yanitla(res, 403, { ok: false, hata: 'yasak' });
      }
      if (!hostGecerliMi(b.host, port)) return yanitla(res, 403, { ok: false, hata: 'yasak' });
      if (req.method !== 'POST') return yanitla(res, 405, { ok: false, hata: 'yontem' }, { Allow: 'POST' });
      if (!YOLLAR.includes(req.url)) return yanitla(res, 404, { ok: false, hata: 'yol' });
      const tur = String(b['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (tur !== 'application/json') return yanitla(res, 415, { ok: false, hata: 'icerik-turu' });
      if (kilitliMi()) return yanitla(res, 429, { ok: false, hata: 'cok-sik' });
      const beklenen = await jetonAl();
      if (!jetonGecerliMi(beklenen)) return yanitla(res, 503, { ok: false, hata: 'jeton-yok' });
      const yetki = typeof b.authorization === 'string' ? /^Bearer ([^\s]+)$/.exec(b.authorization) : null;
      if (!yetki || !jetonEsitMi(yetki[1], beklenen)) {
        yanlisKaydet();
        return yanitla(res, 401, { ok: false, hata: 'yetki' }, { 'WWW-Authenticate': 'Bearer' });
      }
      if (!hizIzni()) return yanitla(res, 429, { ok: false, hata: 'cok-sik' });
      const uzunluk = Number(b['content-length']);
      if (Number.isFinite(uzunluk) && uzunluk > GOVDE_SINIRI) return yanitla(res, 413, { ok: false, hata: 'buyuk' });
      const okunan = await govdeOku(req);
      if (okunan.hata) return yanitla(res, okunan.hata, { ok: false, hata: okunan.hata === 413 ? 'buyuk' : 'gecersiz' });
      let ham;
      try {
        ham = JSON.parse(okunan.metin);
      } catch {
        return yanitla(res, 400, { ok: false, hata: 'gecersiz' });
      }
      const govde = govdeDogrula(req.url, ham);
      if (!govde) return yanitla(res, 400, { ok: false, hata: 'gecersiz' });
      let sonuc;
      try {
        sonuc = await isle(req.url, govde);
      } catch {
        sonuc = { ok: false, tur: 'ha-hatasi' };
      }
      if (sonuc?.ok) return yanitla(res, 200, sonuc);
      const kod = DURUM_KODLARI[sonuc?.tur] ?? 502;
      return yanitla(res, kod, { ok: false, hata: typeof sonuc?.tur === 'string' ? sonuc.tur : 'hata' });
    } catch {
      return yanitla(res, 500, { ok: false, hata: 'hata' });
    }
  }

  /**
   * Sunucuyu 127.0.0.1:port'ta başlatır (zaten çalışıyorsa önce durdurur).
   * @returns {Promise<{ok: boolean, hata?: 'port-kullanimda'|'port-gecersiz'|'baslatilamadi'}>}
   */
  async function baslat(yeniPort = VARSAYILAN_PORT) {
    await durdur();
    if (!Number.isInteger(yeniPort) || yeniPort < 1024 || yeniPort > 65535) {
      hata = 'port-gecersiz';
      return { ok: false, hata };
    }
    hata = null;
    port = yeniPort;
    const s = sunucuOlustur({ maxHeaderSize: 8192 }, (req, res) => {
      istekIsle(req, res);
    });
    s.headersTimeout = 5000;
    s.requestTimeout = 5000;
    s.keepAliveTimeout = 1000;
    s.maxHeadersCount = 30;
    s.maxConnections = 8;
    return new Promise((coz) => {
      const hataDinle = (e) => {
        hata = e?.code === 'EADDRINUSE' ? 'port-kullanimda' : 'baslatilamadi';
        gunluk(`Yerel API başlatılamadı: ${hata}`);
        sunucu = null;
        coz({ ok: false, hata });
      };
      s.once('error', hataDinle);
      s.listen({ port: yeniPort, host: '127.0.0.1', exclusive: true }, () => {
        s.off('error', hataDinle);
        s.on('error', () => {});
        sunucu = s;
        gunluk(`Yerel API 127.0.0.1:${yeniPort} üzerinde dinliyor.`);
        coz({ ok: true });
      });
    });
  }

  function durdur() {
    const s = sunucu;
    sunucu = null;
    if (!s) return Promise.resolve();
    return new Promise((coz) => {
      try {
        s.close(() => coz());
        s.closeAllConnections?.();
      } catch {
        coz();
      }
    });
  }

  return {
    baslat,
    durdur,
    istekIsle,
    durum: () => ({ calisiyor: sunucu !== null, port: sunucu ? port : null, hata }),
  };
}

module.exports = {
  VARSAYILAN_PORT,
  YOLLAR,
  GOVDE_SINIRI,
  DURUM_KODLARI,
  HIZ,
  KILIT,
  jetonUret,
  jetonGecerliMi,
  jetonEsitMi,
  govdeDogrula,
  hostGecerliMi,
  yerelApiOlustur,
};
