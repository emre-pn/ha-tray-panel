'use strict';

/**
 * Sertifika güveni için saf yardımcılar (1.4.0, o-56): parmak izi, PEM/DER ayrıştırma, kök sertifika (CA) denetimi ve zincir doğrulama.
 * Yalnız `node:` yerleşikleri kullanılır (Electron'a bağlı değildir); X509Certificate ve crypto testlerde verilebilir.
 *
 * Güvenlik duruşu
 *  - "Sertifika hatalarını yok say" diye bir mod YOKTUR. İki dar mod vardır, ikisi de yalnız Home Assistant ana bilgisayarına uygulanır:
 *      (1) özel kök CA: zincir bu CA'ya çıkıyor, ad ve tarihler tutuyorsa kabul;
 *      (2) parmak izi sabitleme: sunucunun yaprak sertifikasının SHA-256 parmak izi, kaydedilenle birebir aynı ve tarih içindeyse kabul;
 *          ayni ana bilgisayar için başka her sertifika (sistem güvense bile) reddedilir.
 *  - Özel anahtar içeren dosya HİÇ okunmaz (reddedilir). Yalnız genel sertifika kabul edilir.
 *  - Hiçbir işlev sertifika ya da parmak izini günlüğe yazmaz.
 */

const nodeCrypto = require('node:crypto');
const nodeNet = require('node:net');

const EN_COK_CA = 4;
const EN_COK_SABIT = 4;
const DOSYA_EN_COK_BAYT = 64 * 1024;
const DOSYA_EN_COK_SERTIFIKA = 4;
const ZINCIR_EN_COK_DERINLIK = 6;
const AD_EN_UZUN = 80;

const PEM_BLOK = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;

/**
 * Elle yazılan ya da panodan yapıştırılan SHA-256 parmak izini normalleştirir: "AA:BB:...", "aa bb ...", "SHA256 Fingerprint=AA:BB:..."
 * ve düz 64 onaltılık hane kabul edilir. Geçersizse null.
 * @returns {string|null} 64 küçük harfli onaltılık hane
 */
function parmakIziniCoz(girdi) {
  if (typeof girdi !== 'string' || girdi.length > 200) return null;
  const govde = girdi.replace(/^\s*(?:sha-?256\s*(?:fingerprint)?\s*[=:]?\s*)?/i, '').replace(/[\s:-]/g, '');
  return /^[0-9a-fA-F]{64}$/.test(govde) ? govde.toLowerCase() : null;
}

/** 64 haneli parmak izini "AA:BB:..." biçiminde gösterir. */
function parmakIziniBicimle(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) return '';
  return hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');
}

/**
 * Adresten (ya da ana bilgisayar adından) küçük harfli, köşeli parantezsiz ana bilgisayar adı. Yalnız http/https adresi ya da çıplak ad.
 * @returns {string|null}
 */
function anaBilgisayarCoz(girdi) {
  if (typeof girdi !== 'string' || girdi === '' || girdi.length > 300) return null;
  let ad = girdi.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ad)) {
    try {
      const u = new URL(ad);
      if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
      ad = u.hostname;
    } catch {
      return null;
    }
  }
  ad = ad.toLowerCase().replace(/^\[|\]$/g, '');
  if (ad === '' || /[\s/\\@?#]/.test(ad)) return null;
  return ad;
}

/** https: ya da wss: adresin ana bilgisayarı ve kapısı (TLS kullanan adresler); aksi halde null. */
function tlsAdresiCoz(adres) {
  if (typeof adres !== 'string') return null;
  try {
    const u = new URL(adres);
    if (u.protocol !== 'https:' && u.protocol !== 'wss:') return null;
    const anaBilgisayar = anaBilgisayarCoz(u.hostname);
    if (!anaBilgisayar) return null;
    return { anaBilgisayar, kapi: u.port ? Number(u.port) : 443 };
  } catch {
    return null;
  }
}

function tarihiCoz(metin, tarih) {
  if (tarih instanceof Date && !Number.isNaN(tarih.getTime())) return tarih.getTime();
  const ms = Date.parse(metin);
  return Number.isNaN(ms) ? null : ms;
}

function gecerlilikAraligi(x509) {
  return { baslangic: tarihiCoz(x509.validFrom, x509.validFromDate), bitis: tarihiCoz(x509.validTo, x509.validToDate) };
}

/** @returns {'tamam'|'henuz-gecerli-degil'|'suresi-doldu'|'tarih-gecersiz'} */
function tarihDurumu(x509, simdi) {
  const { baslangic, bitis } = gecerlilikAraligi(x509);
  if (baslangic === null || bitis === null) return 'tarih-gecersiz';
  if (simdi < baslangic) return 'henuz-gecerli-degil';
  if (simdi > bitis) return 'suresi-doldu';
  return 'tamam';
}

/** Konu alanından görünen ad (CN, yoksa ilk alan); denetim karakterleri atılır ve kısaltılır. */
function gorunenAd(konu) {
  const satirlar = String(konu ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cn = satirlar.find((s) => /^CN=/i.test(s));
  const ham = (cn ?? satirlar[0] ?? '').replace(/^[A-Za-z.]+=/, '');
  // eslint-disable-next-line no-control-regex
  return ham.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, AD_EN_UZUN);
}

function parmakHex(x509) {
  return String(x509.fingerprint256 ?? '')
    .replace(/:/g, '')
    .toLowerCase();
}

/**
 * Dosya içeriğinden (PEM metin ya da DER ikili) genel sertifikaları çıkarır. Özel anahtar içeren dosya reddedilir.
 * @param {Buffer|string} icerik
 * @param {{ X509Certificate?: Function }} [bag]
 * @returns {{ ok: true, pemler: string[] } | { ok: false, neden: 'cok-buyuk'|'ozel-anahtar'|'dosyada-yok'|'cok-fazla'|'pem-gecersiz' }}
 */
function sertifikalariAyir(icerik, { X509Certificate = nodeCrypto.X509Certificate } = {}) {
  const tampon = Buffer.isBuffer(icerik) ? icerik : Buffer.from(String(icerik ?? ''), 'utf8');
  if (tampon.length === 0 || tampon.length > DOSYA_EN_COK_BAYT) return { ok: false, neden: tampon.length === 0 ? 'dosyada-yok' : 'cok-buyuk' };
  // DER: ASN.1 SEQUENCE ile başlar ve tek sertifikadır.
  if (tampon[0] === 0x30) {
    try {
      return { ok: true, pemler: [new X509Certificate(tampon).toString().trim()] };
    } catch {
      return { ok: false, neden: 'pem-gecersiz' };
    }
  }
  const metin = tampon.toString('latin1');
  if (/PRIVATE KEY/.test(metin)) return { ok: false, neden: 'ozel-anahtar' };
  const bloklar = metin.match(PEM_BLOK) ?? [];
  if (bloklar.length === 0) return { ok: false, neden: 'dosyada-yok' };
  if (bloklar.length > DOSYA_EN_COK_SERTIFIKA) return { ok: false, neden: 'cok-fazla' };
  const pemler = [];
  for (const blok of bloklar) {
    try {
      pemler.push(new X509Certificate(blok).toString().trim());
    } catch {
      return { ok: false, neden: 'pem-gecersiz' };
    }
  }
  return { ok: true, pemler };
}

/**
 * Bir PEM'in güvenilen KÖK CA olarak eklenebilir olup olmadığını denetler: CA bayrağı, kendinden imzalı (kök), süresi içinde.
 * (Ara CA tek başına eklenemez: canlı bağlantıdaki Node doğrulaması kök arar; iki yol aynı kuralla çalışsın diye.)
 * @returns {{ ok: true, parmak: string, ad: string, pem: string, baslangic: string, bitis: string } | { ok: false, neden: string }}
 */
function kokBilgisi(pem, { simdi = Date.now(), X509Certificate = nodeCrypto.X509Certificate } = {}) {
  let x;
  try {
    x = new X509Certificate(pem);
  } catch {
    return { ok: false, neden: 'pem-gecersiz' };
  }
  if (x.ca !== true) return { ok: false, neden: 'ca-degil' };
  let kendindenImzali = false;
  try {
    kendindenImzali = x.checkIssued(x) && x.verify(x.publicKey);
  } catch {
    kendindenImzali = false;
  }
  if (!kendindenImzali) return { ok: false, neden: 'kok-degil' };
  const tarih = tarihDurumu(x, simdi);
  if (tarih !== 'tamam') return { ok: false, neden: tarih };
  const { baslangic, bitis } = gecerlilikAraligi(x);
  return {
    ok: true,
    parmak: parmakHex(x),
    ad: gorunenAd(x.subject),
    pem: x.toString().trim(),
    baslangic: new Date(baslangic).toISOString(),
    bitis: new Date(bitis).toISOString(),
  };
}

/** Sertifikanın (PEM ya da DER) SHA-256 parmak izi: 64 küçük harfli onaltılık hane; ayrıştırılamazsa null. */
function sertifikaParmagi(girdi, { crypto = nodeCrypto, X509Certificate = nodeCrypto.X509Certificate } = {}) {
  try {
    if (Buffer.isBuffer(girdi)) return crypto.createHash('sha256').update(girdi).digest('hex');
    return parmakHex(new X509Certificate(girdi));
  } catch {
    return null;
  }
}

/** Sertifikayı kullanıcıya göstermek için özetler (sır içermez). */
function sertifikaOzeti(girdi, { X509Certificate = nodeCrypto.X509Certificate } = {}) {
  try {
    const x = new X509Certificate(girdi);
    const { baslangic, bitis } = gecerlilikAraligi(x);
    return {
      parmak: parmakHex(x),
      ad: gorunenAd(x.subject),
      veren: gorunenAd(x.issuer),
      sanlar: String(x.subjectAltName ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^(DNS|IP Address):/i, ''))
        .filter(Boolean)
        .slice(0, 8),
      baslangic: baslangic === null ? null : new Date(baslangic).toISOString(),
      bitis: bitis === null ? null : new Date(bitis).toISOString(),
      kendindenImzali: (() => {
        try {
          return x.checkIssued(x) && x.verify(x.publicKey);
        } catch {
          return false;
        }
      })(),
    };
  } catch {
    return null;
  }
}

/**
 * Parmak izi sabitleme denetimi: yaprak sertifikanın SHA-256'sı sabitlenenle birebir aynı VE yaprak tarih içinde mi?
 * (Süresi dolmuş sertifika sabitlenmiş olsa da reddedilir; kullanıcı yeni parmak izini sabitler.)
 * @param {string} sabitHex kayıtlı parmak izi (64 küçük hane)
 * @param {Buffer|string} yaprak DER ya da PEM
 */
function sabitlemeUyuyor(sabitHex, yaprak, { simdi = Date.now(), crypto = nodeCrypto, X509Certificate = nodeCrypto.X509Certificate } = {}) {
  if (typeof sabitHex !== 'string' || !/^[0-9a-f]{64}$/.test(sabitHex)) return false;
  const parmak = sertifikaParmagi(yaprak, { crypto, X509Certificate });
  if (parmak === null) return false;
  // Sabit zaman karşılaştırması (parmak izi gizli değildir, ama alışkanlık olarak).
  const a = Buffer.from(parmak, 'hex');
  const b = Buffer.from(sabitHex, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return tarihDurumu(new X509Certificate(yaprak), simdi) === 'tamam';
  } catch {
    return false;
  }
}

function adUyuyor(x509, anaBilgisayar) {
  try {
    if (nodeNet.isIP(anaBilgisayar)) return !!x509.checkIP(anaBilgisayar);
    return !!x509.checkHost(anaBilgisayar, { subject: 'default', wildcards: true, partialWildcards: false });
  } catch {
    return false;
  }
}

/**
 * Özel kök CA ile zincir doğrulaması (Electron'un sistem doğrulaması "yetkili geçersiz" dediğinde, YALNIZ HA ana bilgisayarı için).
 *  - yaprak: ana bilgisayar adına (SAN/CN; IP için IP SAN) ve tarihe uymalı;
 *  - her halka bir üsttekinin imzasıyla doğrulanmalı (imza kontrolü), ara halkalar CA olmalı ve tarih içinde olmalı;
 *  - zincir güvenilen kök listesinden birinde bitmeli (imza ya da birebir parmak izi).
 * @param {object} bag
 * @param {string} bag.yaprakPem
 * @param {string[]} [bag.araPemler] sunucunun sunduğu ara sertifikalar (sıra önemsiz)
 * @param {string[]} bag.kokPemler güvenilen kök CA'lar
 * @param {string} bag.anaBilgisayar
 * @returns {{ ok: boolean, neden?: string }}
 */
function zincirDogrula({ yaprakPem, araPemler = [], kokPemler, anaBilgisayar, simdi = Date.now(), X509Certificate = nodeCrypto.X509Certificate }) {
  let yaprak;
  let kokler;
  let havuz;
  try {
    yaprak = new X509Certificate(yaprakPem);
    kokler = kokPemler.map((p) => new X509Certificate(p));
    havuz = araPemler.map((p) => new X509Certificate(p));
  } catch {
    return { ok: false, neden: 'pem-gecersiz' };
  }
  if (kokler.length === 0) return { ok: false, neden: 'kok-yok' };
  const tarih = tarihDurumu(yaprak, simdi);
  if (tarih !== 'tamam') return { ok: false, neden: tarih };
  if (!adUyuyor(yaprak, anaBilgisayar)) return { ok: false, neden: 'ad-uymuyor' };

  const imzaliMi = (alt, ust) => {
    try {
      return alt.checkIssued(ust) && alt.verify(ust.publicKey);
    } catch {
      return false;
    }
  };
  let simdikiHalka = yaprak;
  for (let derinlik = 0; derinlik < ZINCIR_EN_COK_DERINLIK; derinlik += 1) {
    const kok = kokler.find((k) => k.ca === true && tarihDurumu(k, simdi) === 'tamam' && (imzaliMi(simdikiHalka, k) || (derinlik > 0 && parmakHex(k) === parmakHex(simdikiHalka))));
    if (kok) return { ok: true };
    const ust = havuz.find(
      (a) => a.ca === true && parmakHex(a) !== parmakHex(simdikiHalka) && tarihDurumu(a, simdi) === 'tamam' && imzaliMi(simdikiHalka, a),
    );
    if (!ust) return { ok: false, neden: 'zincir-eksik' };
    simdikiHalka = ust;
  }
  return { ok: false, neden: 'zincir-cok-uzun' };
}

module.exports = {
  EN_COK_CA,
  EN_COK_SABIT,
  DOSYA_EN_COK_BAYT,
  parmakIziniCoz,
  parmakIziniBicimle,
  anaBilgisayarCoz,
  tlsAdresiCoz,
  sertifikalariAyir,
  kokBilgisi,
  sertifikaParmagi,
  sertifikaOzeti,
  sabitlemeUyuyor,
  zincirDogrula,
  gorunenAd,
};
