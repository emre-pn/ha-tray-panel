'use strict';

/**
 * Test yardımcısı: bellekte, her çalıştırmada yeni X.509 sertifikaları üretir (ECDSA P-256, el ile DER). Depoya özel anahtar ya da
 * sertifika dosyası konmaz; openssl gerekmez. YALNIZ testler içindir ve üretilen sertifikalar hiçbir yere yazılmaz.
 */

const crypto = require('node:crypto');

const uzunluk = (n) => {
  if (n < 128) return Buffer.from([n]);
  if (n < 256) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, n >> 8, n & 255]);
};
const tlv = (etiket, ...parcalar) => {
  const veri = Buffer.concat(parcalar);
  return Buffer.concat([Buffer.from([etiket]), uzunluk(veri.length), veri]);
};
const dizi = (...p) => tlv(0x30, ...p);
const kume = (...p) => tlv(0x31, ...p);
const tamsayi = (b) => {
  let g = Buffer.isBuffer(b) ? b : Buffer.from([b]);
  if (g[0] & 0x80) g = Buffer.concat([Buffer.from([0]), g]);
  return tlv(0x02, g);
};
const mantik = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const sekizli = (b) => tlv(0x04, b);
const bitDizisi = (b, kullanilmayan = 0) => tlv(0x03, Buffer.from([kullanilmayan]), b);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const oid = (metin) => {
  const a = metin.split('.').map(Number);
  const bayt = [a[0] * 40 + a[1]];
  for (const n of a.slice(2)) {
    const parca = [n & 0x7f];
    let kalan = n >>> 7;
    while (kalan > 0) {
      parca.unshift((kalan & 0x7f) | 0x80);
      kalan >>>= 7;
    }
    bayt.push(...parca);
  }
  return tlv(0x06, Buffer.from(bayt));
};
const iki = (n) => String(n).padStart(2, '0');
const zaman = (d) => {
  const yil = d.getUTCFullYear();
  const govde = `${iki(d.getUTCMonth() + 1)}${iki(d.getUTCDate())}${iki(d.getUTCHours())}${iki(d.getUTCMinutes())}${iki(d.getUTCSeconds())}Z`;
  if (yil < 2050) return tlv(0x17, Buffer.from(`${iki(yil % 100)}${govde}`));
  return tlv(0x18, Buffer.from(`${yil}${govde}`));
};
const ad = (cn) => dizi(kume(dizi(oid('2.5.4.3'), utf8(cn))));
const uzanti = (kimlik, kritik, deger) => dizi(oid(kimlik), ...(kritik ? [mantik(true)] : []), sekizli(deger));

let seriSayaci = 1;

/**
 * @param {object} secenek
 * @param {string} secenek.cn konu adı
 * @param {Array<string>} [secenek.san] DNS adları ya da IPv4 metinleri
 * @param {boolean} [secenek.ca] CA sertifikası mı
 * @param {{cn: string, privateKey: import('node:crypto').KeyObject}|null} [secenek.veren] verilmezse kendinden imzalı
 * @param {Date} [secenek.baslangic]
 * @param {Date} [secenek.bitis]
 * @returns {{ pem: string, der: Buffer, cn: string, privateKey: import('node:crypto').KeyObject, privateKeyPem: string, parmakIzi: string, x509: import('node:crypto').X509Certificate }}
 */
function sertifikaUret({ cn, san = [], ca = false, veren = null, baslangic = null, bitis = null }) {
  const simdi = Date.now();
  const bas = baslangic ?? new Date(simdi - 24 * 3600 * 1000);
  const son = bitis ?? new Date(simdi + 3650 * 24 * 3600 * 1000);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const imzaAlg = dizi(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const uzantilar = [];
  uzantilar.push(uzanti('2.5.29.19', true, ca ? dizi(mantik(true)) : dizi())); // basicConstraints
  uzantilar.push(uzanti('2.5.29.15', true, ca ? bitDizisi(Buffer.from([0x06]), 1) : bitDizisi(Buffer.from([0x80]), 7))); // keyUsage
  if (!ca) uzantilar.push(uzanti('2.5.29.37', false, dizi(oid('1.3.6.1.5.5.7.3.1')))); // serverAuth
  if (san.length > 0) {
    const adlar = san.map((s) => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? tlv(0x87, Buffer.from(s.split('.').map(Number))) : tlv(0x82, Buffer.from(s, 'ascii'))));
    uzantilar.push(uzanti('2.5.29.17', false, dizi(...adlar)));
  }
  seriSayaci += 1;
  const seri = Buffer.concat([Buffer.from([seriSayaci & 0x7f]), crypto.randomBytes(8)]);
  const verenAdi = veren ? veren.cn : cn;
  const tbs = dizi(
    tlv(0xa0, tamsayi(2)),
    tamsayi(seri),
    imzaAlg,
    ad(verenAdi),
    dizi(zaman(bas), zaman(son)),
    ad(cn),
    spki,
    tlv(0xa3, dizi(...uzantilar)),
  );
  const imzalayan = veren ? veren.privateKey : privateKey;
  const imza = crypto.sign('sha256', tbs, imzalayan);
  const der = dizi(tbs, imzaAlg, bitDizisi(imza));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
  const x509 = new crypto.X509Certificate(pem);
  return {
    pem,
    der,
    cn,
    privateKey,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    parmakIzi: crypto.createHash('sha256').update(der).digest('hex'),
    x509,
  };
}

/** Bir CA + o CA'nın imzaladığı, verilen adlar için sunucu sertifikası. */
function zincirUret({ caAdi = 'Test Kok CA', sunucuAdi = 'ha.test', san = ['ha.test'], ...ek } = {}) {
  const ca = sertifikaUret({ cn: caAdi, ca: true });
  const sunucu = sertifikaUret({ cn: sunucuAdi, san, veren: ca, ...ek });
  return { ca, sunucu };
}

module.exports = { sertifikaUret, zincirUret };
