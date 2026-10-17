'use strict';

/**
 * Tarayıcıyla giriş (OAuth / IndieAuth, 1.4.0, o-57) için SAF yardımcılar: adres kurma, geri çağrı denetimi, jeton yanıtı doğrulama ve
 * oturum kaydının biçimi. Ağa, dosyaya ve Electron'a dokunmaz (testler doğrudan çağırır).
 *
 * Home Assistant akışı (IndieAuth):
 *  1. Tarayıcı `<HA>/auth/authorize?client_id=…&redirect_uri=…&state=…` adresini açar. client_id ve redirect_uri aynı şema + ana bilgisayar
 *     + kapıyı paylaşmalıdır; HA 127.0.0.1 (döngü) adreslerini kabul eder. Burada ikisi de geçici yerel dinleyicinin adresidir.
 *  2. Giriş bitince tarayıcı `redirect_uri?code=…&state=…` adresine yönlenir (yalnız bu bilgisayardaki dinleyici alır).
 *  3. `<HA>/auth/token` (form) ile kod değişir: erişim anahtarı (~30 dk) + yenileme anahtarı. Yenileme anahtarı DÖNMEZ (dönüşümlü değil) ve
 *     yalnız onu veren client_id ile yenilenebilir; bu yüzden client_id (kapıyla birlikte) oturumla birlikte saklanır.
 *
 * SIR: kod, erişim anahtarı ve yenileme anahtarı hiçbir günlüğe, hata iletisine ya da dışa aktarmaya girmez; bu dosya yalnız biçim denetler.
 */

const crypto = require('node:crypto');

const GIRIS_ZAMAN_ASIMI_MS = 5 * 60_000; // kullanıcı tarayıcıda girişi bu sürede bitirmezse dinleyici kapanır
const YENILEME_ONCESI_MS = 3 * 60_000; // erişim anahtarının bitimine bu kadar kala yenilenir
const EN_COK_GECERSIZ_GERI_CAGRI = 5; // yanlış state / bozuk kod ile gelen geri çağrı sayısı sınırı (aşılırsa giriş iptal edilir)
const ISTEMCI_YOLU = '/ev-paneli';
const GERI_CAGRI_YOLU = '/callback';
const STATE_BAYT = 32;
const VARSAYILAN_OMUR_SN = 1800; // HA erişim anahtarı ömrü (yanıtta expires_in yoksa)
const EN_AZ_OMUR_SN = 60;
const EN_COK_OMUR_SN = 86_400;
const OTURUM_SURUMU = 1;

/** HA jetonları JWT (erişim) ve onaltılık dize (yenileme): `anahtar:kaydet` ile aynı karakter kümesi (Authorization başlığına enjeksiyon olmaz). */
const JETON_DESENI = /^[A-Za-z0-9._-]{20,4096}$/;
const KOD_DESENI = /^[A-Za-z0-9._~-]{8,512}$/;
const DURUM_DESENI = /^[A-Za-z0-9_-]{43}$/; // 32 bayt -> base64url
const ISTEMCI_DESENI = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/ev-paneli$/;

/** state: tahmin edilemez, tek kullanımlık, 32 rastgele bayt. */
function durumUret(rastgele = crypto.randomBytes) {
  return rastgele(STATE_BAYT).toString('base64url');
}

const istemciKimligi = (kapi) => `http://127.0.0.1:${kapi}${ISTEMCI_YOLU}`;
const yonlendirmeAdresi = (kapi) => `http://127.0.0.1:${kapi}${GERI_CAGRI_YOLU}`;

/** HA'nın giriş sayfası adresi. taban: ayardaki HA kökeni (şema + ana bilgisayar + kapı). Geçersizse null. */
function girisAdresi({ taban, kapi, durum }) {
  let kok;
  try {
    kok = new URL(taban);
  } catch {
    return null;
  }
  if ((kok.protocol !== 'http:' && kok.protocol !== 'https:') || !Number.isInteger(kapi) || kapi < 1 || kapi > 65535 || !DURUM_DESENI.test(durum ?? '')) return null;
  const url = new URL('/auth/authorize', kok.origin);
  url.searchParams.set('client_id', istemciKimligi(kapi));
  url.searchParams.set('redirect_uri', yonlendirmeAdresi(kapi));
  url.searchParams.set('state', durum);
  return url.toString();
}

/** Sabit zamanlı karşılaştırma (uzunluk farkı hemen reddedilir; durum dizisinin uzunluğu sır değildir). */
function esitMi(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Dinleyiciye gelen isteği sınıflar. Hiçbir şey fırlatmaz.
 * @returns {{sinif: 'yok'} | {sinif: 'gecersiz', neden: string} | {sinif: 'iptal'} | {sinif: 'kod', kod: string}}
 *   yok: bu bir geri çağrı DEĞİL (yanlış yol/metot/ana bilgisayar başlığı: sayılmaz, 404 döner);
 *   gecersiz: geri çağrı gibi ama state/kod geçersiz (sayılır, giriş sürer);
 *   iptal: geçerli state ile `error=` geldi (kullanıcı HA'da vazgeçti);
 *   kod: geçerli state ve düzgün biçimli kod.
 */
function geriCagriSinifla({ metot, yol, anaBilgisayarBasligi, kapi, durum }) {
  if (metot !== 'GET') return { sinif: 'yok' };
  // DNS yeniden bağlama (rebinding) koruması: başlık tam olarak dinleyicinin adresi olmalı.
  if (anaBilgisayarBasligi !== `127.0.0.1:${kapi}`) return { sinif: 'yok' };
  let url;
  try {
    url = new URL(String(yol ?? ''), 'http://127.0.0.1');
  } catch {
    return { sinif: 'yok' };
  }
  if (url.pathname !== GERI_CAGRI_YOLU) return { sinif: 'yok' };
  const durumlar = url.searchParams.getAll('state');
  if (durumlar.length !== 1 || !esitMi(durumlar[0], durum)) return { sinif: 'gecersiz', neden: 'durum-uyusmuyor' };
  if (url.searchParams.has('error')) return { sinif: 'iptal' };
  const kodlar = url.searchParams.getAll('code');
  if (kodlar.length !== 1 || !KOD_DESENI.test(kodlar[0])) return { sinif: 'gecersiz', neden: 'kod-gecersiz' };
  return { sinif: 'kod', kod: kodlar[0] };
}

// ---- /auth/token istek gövdeleri (form) --------------------------------------------------------------------------------------------

const formYap = (alanlar) => new URLSearchParams(alanlar).toString();
const kodFormu = ({ kod, istemci }) => formYap({ grant_type: 'authorization_code', code: kod, client_id: istemci });
const yenilemeFormu = ({ yenileme, istemci }) => formYap({ grant_type: 'refresh_token', refresh_token: yenileme, client_id: istemci });
/** HA'da iptal: aynı uç, `action=revoke` (IndieAuth 6.3.5). */
const iptalFormu = ({ yenileme }) => formYap({ token: yenileme, action: 'revoke' });

/**
 * Jeton yanıtını doğrular. Başarılı yanıt: { access_token, token_type: 'Bearer', expires_in, refresh_token? }.
 * @param {unknown} govde ayrıştırılmış JSON
 * @param {{yenilemeGerekli?: boolean, simdi?: number}} [secenek]
 * @returns {{ok: true, erisim: string, yenileme: string|null, bitis: number, omurSn: number} | {ok: false, neden: string}}
 */
function jetonYaniti(govde, { yenilemeGerekli = false, simdi = Date.now() } = {}) {
  if (!govde || typeof govde !== 'object' || Array.isArray(govde)) return { ok: false, neden: 'yanit-gecersiz' };
  if (typeof govde.access_token !== 'string' || !JETON_DESENI.test(govde.access_token)) return { ok: false, neden: 'yanit-gecersiz' };
  if (govde.token_type !== undefined && String(govde.token_type).toLowerCase() !== 'bearer') return { ok: false, neden: 'yanit-gecersiz' };
  let yenileme = null;
  if (govde.refresh_token !== undefined) {
    if (typeof govde.refresh_token !== 'string' || !JETON_DESENI.test(govde.refresh_token)) return { ok: false, neden: 'yanit-gecersiz' };
    yenileme = govde.refresh_token;
  }
  if (yenilemeGerekli && !yenileme) return { ok: false, neden: 'yanit-gecersiz' };
  let omurSn = VARSAYILAN_OMUR_SN;
  if (govde.expires_in !== undefined) {
    if (!Number.isFinite(govde.expires_in) || govde.expires_in < EN_AZ_OMUR_SN) return { ok: false, neden: 'yanit-gecersiz' };
    omurSn = Math.min(Math.floor(govde.expires_in), EN_COK_OMUR_SN);
  }
  return { ok: true, erisim: govde.access_token, yenileme, bitis: simdi + omurSn * 1000, omurSn };
}

/**
 * Hata yanıtı (OAuth `error` alanı) -> oturumu bitiren kalıcı red mi, geçici sorun mu?
 * invalid_grant: yenileme anahtarı silinmiş/iptal; invalid_request: client_id uyuşmuyor; diğer kalıcı kodlar da oturumu bitirir.
 */
function kaliciRedMi(durum, govde) {
  if (durum !== 400 && durum !== 401) return false;
  const kod = govde && typeof govde === 'object' && typeof govde.error === 'string' ? govde.error : '';
  return ['invalid_grant', 'invalid_request', 'invalid_client', 'unauthorized_client', 'access_denied', 'unsupported_grant_type'].includes(kod);
}

// ---- Oturum kaydı (safeStorage ile şifreli dosyada) --------------------------------------------------------------------------------

const EN_COK_KOKEN = 4;

/** Köken listesini normalleştirir (yalnız http/https, tekrarsız, en çok 4); geçersiz öğe sessizce düşer. */
function kokenleriDuzelt(liste) {
  const sonuc = [];
  for (const ham of Array.isArray(liste) ? liste : []) {
    if (sonuc.length >= EN_COK_KOKEN || typeof ham !== 'string' || !ham) continue;
    try {
      const url = new URL(ham);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !sonuc.includes(url.origin)) sonuc.push(url.origin);
    } catch {
      /* geçersiz adres */
    }
  }
  return sonuc;
}

/**
 * Diske yazılan metin: HA kökeni, client_id, yenileme anahtarı ve (varsa) girişin yapıldığı anda ayarlı HA kökenleri. Erişim anahtarı ASLA
 * yazılmaz (bellekte tutulur). `kokenler`: yenileme ve iptal isteği YALNIZ bu kökenlerden birine gider (adres başka bir sunucuya çevrilse bile
 * yenileme anahtarı oraya gönderilmez).
 */
function oturumuYaz({ taban, istemci, yenileme, kokenler }) {
  const koken = kokenleriDuzelt([taban, ...(Array.isArray(kokenler) ? kokenler : [])]);
  return JSON.stringify({ surum: OTURUM_SURUMU, taban, istemci, yenileme, ...(Array.isArray(kokenler) ? { kokenler: koken } : {}) });
}

/** Kayıt metnini doğrular; bozuk ya da tanınmayan biçim null (oturum yok sayılır). */
function oturumuCoz(metin) {
  let kayit;
  try {
    kayit = JSON.parse(String(metin));
  } catch {
    return null;
  }
  if (!kayit || typeof kayit !== 'object' || kayit.surum !== OTURUM_SURUMU) return null;
  if (typeof kayit.yenileme !== 'string' || !JETON_DESENI.test(kayit.yenileme)) return null;
  if (typeof kayit.istemci !== 'string') return null;
  const eslesme = ISTEMCI_DESENI.exec(kayit.istemci);
  if (!eslesme || Number(eslesme[1]) > 65535) return null;
  let taban;
  try {
    const url = new URL(kayit.taban);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    taban = url.origin;
  } catch {
    return null;
  }
  return { taban, istemci: kayit.istemci, yenileme: kayit.yenileme, ...(Array.isArray(kayit.kokenler) ? { kokenler: kokenleriDuzelt([taban, ...kayit.kokenler]) } : {}) };
}

module.exports = {
  GIRIS_ZAMAN_ASIMI_MS,
  YENILEME_ONCESI_MS,
  EN_COK_GECERSIZ_GERI_CAGRI,
  ISTEMCI_YOLU,
  GERI_CAGRI_YOLU,
  STATE_BAYT,
  durumUret,
  istemciKimligi,
  yonlendirmeAdresi,
  girisAdresi,
  esitMi,
  geriCagriSinifla,
  kodFormu,
  yenilemeFormu,
  iptalFormu,
  jetonYaniti,
  kaliciRedMi,
  kokenleriDuzelt,
  oturumuYaz,
  oturumuCoz,
};
