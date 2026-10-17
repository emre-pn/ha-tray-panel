'use strict';

/**
 * src/lib/sertifika.js (o-56): parmak izi, PEM/DER ayrıştırma, kök CA denetimi, sabitleme ve zincir doğrulama.
 * Sertifikalar test/sertifika-uret.js ile bellekte üretilir (depoda özel anahtar ya da sertifika dosyası yok).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/lib/sertifika');
const { sertifikaUret, zincirUret } = require('./sertifika-uret');

const GUN = 24 * 60 * 60 * 1000;
const SIMDI = Date.now();

test('parmak izi çözümleme: iki nokta, boşluk, tire, SHA256 öneki ve büyük/küçük harf kabul edilir; geçersizi null', () => {
  const hex = 'ab12'.repeat(16);
  const bicimli = parmakIziniBicimle(hex);
  assert.match(bicimli, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(parmakIziniCoz(bicimli), hex);
  assert.equal(parmakIziniCoz(hex.toUpperCase()), hex);
  assert.equal(parmakIziniCoz(bicimli.replace(/:/g, ' ')), hex);
  assert.equal(parmakIziniCoz(bicimli.replace(/:/g, '-')), hex);
  assert.equal(parmakIziniCoz(`SHA256 Fingerprint=${bicimli}`), hex);
  assert.equal(parmakIziniCoz(`sha-256: ${hex}`), hex);
  assert.equal(parmakIziniCoz(`  ${hex}  `), hex);
  for (const kotu of ['', 'abc', hex.slice(1), `${hex}0`, `${hex.slice(0, 63)}g`, null, undefined, 42, 'x'.repeat(300), `${hex}${hex}`]) {
    assert.equal(parmakIziniCoz(kotu), null, `geçersiz: ${String(kotu).slice(0, 20)}`);
  }
  assert.equal(parmakIziniBicimle('kisa'), '');
});

test('ana bilgisayar çözümleme: adresten küçük harfli ad; IPv6 köşeli parantezsiz; geçersiz null; tlsAdresiCoz yalnız https/wss', () => {
  assert.equal(anaBilgisayarCoz('https://HA.Example.com:8123/x'), 'ha.example.com');
  assert.equal(anaBilgisayarCoz('http://192.168.1.5:8123'), '192.168.1.5');
  assert.equal(anaBilgisayarCoz('https://[::1]:8123'), '::1');
  assert.equal(anaBilgisayarCoz('Ev.Local'), 'ev.local');
  for (const kotu of ['', 'ftp://x.com', 'a b', 'a/b', 'user@host', null, 5, 'x'.repeat(400)]) assert.equal(anaBilgisayarCoz(kotu), null);
  assert.deepEqual(tlsAdresiCoz('https://ha.example.com'), { anaBilgisayar: 'ha.example.com', kapi: 443 });
  assert.deepEqual(tlsAdresiCoz('https://192.168.1.5:8123/'), { anaBilgisayar: '192.168.1.5', kapi: 8123 });
  assert.deepEqual(tlsAdresiCoz('wss://ha.example.com/api/websocket'), { anaBilgisayar: 'ha.example.com', kapi: 443 });
  for (const duz of ['http://192.168.1.5:8123', 'ws://x', 'ha.example.com', '', null, undefined]) assert.equal(tlsAdresiCoz(duz), null, String(duz));
});

test('sertifika ayırma: PEM metin ve DER; özel anahtar içeren dosya HİÇ okunmaz; boş/çok büyük/sertifikasız/çok fazla reddedilir', () => {
  const a = sertifikaUret({ cn: 'A', ca: true });
  const b = sertifikaUret({ cn: 'B', ca: true });
  const tek = sertifikalariAyir(a.pem);
  assert.equal(tek.ok, true);
  assert.equal(tek.pemler.length, 1);
  assert.equal(sertifikaParmagi(tek.pemler[0]), a.parmakIzi);
  const iki = sertifikalariAyir(`${a.pem}\n${b.pem}\n`);
  assert.deepEqual(iki.pemler.map((p) => sertifikaParmagi(p)), [a.parmakIzi, b.parmakIzi]);
  const der = sertifikalariAyir(a.der);
  assert.equal(der.ok, true);
  assert.equal(sertifikaParmagi(der.pemler[0]), a.parmakIzi);

  // özel anahtar: sertifika ile birlikte olsa bile bütün dosya reddedilir
  assert.deepEqual(sertifikalariAyir(`${a.pem}\n${a.privateKeyPem}`), { ok: false, neden: 'ozel-anahtar' });
  assert.deepEqual(sertifikalariAyir(a.privateKeyPem), { ok: false, neden: 'ozel-anahtar' });
  assert.deepEqual(sertifikalariAyir('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'), { ok: false, neden: 'ozel-anahtar' });

  assert.deepEqual(sertifikalariAyir(''), { ok: false, neden: 'dosyada-yok' });
  assert.deepEqual(sertifikalariAyir(Buffer.alloc(0)), { ok: false, neden: 'dosyada-yok' });
  assert.deepEqual(sertifikalariAyir('merhaba, sertifika degil'), { ok: false, neden: 'dosyada-yok' });
  assert.deepEqual(sertifikalariAyir(Buffer.alloc(70 * 1024, 65)), { ok: false, neden: 'cok-buyuk' });
  const bes = Array.from({ length: 5 }, (_, i) => sertifikaUret({ cn: `C${i}`, ca: true }).pem).join('\n');
  assert.deepEqual(sertifikalariAyir(bes), { ok: false, neden: 'cok-fazla' });
  assert.deepEqual(sertifikalariAyir('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'), { ok: false, neden: 'pem-gecersiz' });
  assert.deepEqual(sertifikalariAyir(Buffer.from([0x30, 0x03, 1, 2, 3])), { ok: false, neden: 'pem-gecersiz' });
});

test('kök CA denetimi: yalnız kendinden imzalı, CA bayraklı, tarihi içinde sertifika; ad/parmak izi/bitiş döner', () => {
  const kok = sertifikaUret({ cn: 'Ev Kok CA', ca: true, bitis: new Date(SIMDI + 400 * GUN) });
  const bilgi = kokBilgisi(kok.pem, { simdi: SIMDI });
  assert.equal(bilgi.ok, true);
  assert.equal(bilgi.parmak, kok.parmakIzi);
  assert.equal(bilgi.ad, 'Ev Kok CA');
  assert.equal(new Date(bilgi.bitis).getTime() > SIMDI, true);
  assert.equal(typeof bilgi.pem, 'string');

  const sunucu = sertifikaUret({ cn: 'ha.test', san: ['ha.test'] });
  assert.deepEqual(kokBilgisi(sunucu.pem, { simdi: SIMDI }), { ok: false, neden: 'ca-degil' });
  const ara = sertifikaUret({ cn: 'Ara CA', ca: true, veren: kok });
  assert.deepEqual(kokBilgisi(ara.pem, { simdi: SIMDI }), { ok: false, neden: 'kok-degil' });
  const dolmus = sertifikaUret({ cn: 'Eski Kok', ca: true, baslangic: new Date(SIMDI - 400 * GUN), bitis: new Date(SIMDI - 10 * GUN) });
  assert.deepEqual(kokBilgisi(dolmus.pem, { simdi: SIMDI }), { ok: false, neden: 'suresi-doldu' });
  const gelecek = sertifikaUret({ cn: 'Yeni Kok', ca: true, baslangic: new Date(SIMDI + 10 * GUN), bitis: new Date(SIMDI + 400 * GUN) });
  assert.deepEqual(kokBilgisi(gelecek.pem, { simdi: SIMDI }), { ok: false, neden: 'henuz-gecerli-degil' });
  assert.deepEqual(kokBilgisi('bozuk', { simdi: SIMDI }), { ok: false, neden: 'pem-gecersiz' });
});

test('görünen ad: CN tercih edilir, denetim karakterleri atılır, kısaltılır', () => {
  assert.equal(gorunenAd('C=TR\nO=Ev\nCN=Ev Kok CA'), 'Ev Kok CA');
  assert.equal(gorunenAd('O=Yalniz Kurum'), 'Yalniz Kurum');
  assert.equal(gorunenAd('CN=A\u0007B'), 'AB');
  assert.equal(gorunenAd(`CN=${'x'.repeat(200)}`).length, 80);
  assert.equal(gorunenAd(undefined), '');
});

test('sertifika özeti: parmak izi, ad, veren, SAN, tarihler ve kendinden imzalı bayrağı; bozuk girdi null', () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.test', san: ['ha.test', '192.168.1.50'] });
  const ozet = sertifikaOzeti(sunucu.pem);
  assert.equal(ozet.parmak, sunucu.parmakIzi);
  assert.equal(ozet.ad, 'ha.test');
  assert.equal(ozet.veren, 'Test Kok CA');
  assert.deepEqual(ozet.sanlar, ['ha.test', '192.168.1.50']);
  assert.equal(ozet.kendindenImzali, false);
  assert.equal(typeof ozet.baslangic, 'string');
  assert.equal(sertifikaOzeti(ca.pem).kendindenImzali, true);
  assert.equal(sertifikaOzeti('bozuk'), null);
});

test('sertifika parmak izi: PEM ve DER aynı değeri verir; bozuk girdi null', () => {
  const s = sertifikaUret({ cn: 'x', san: ['x.test'] });
  assert.equal(sertifikaParmagi(s.pem), s.parmakIzi);
  assert.equal(sertifikaParmagi(s.der), s.parmakIzi);
  assert.equal(sertifikaParmagi('bozuk'), null);
});

test('parmak izi sabitleme: yalnız birebir eşleşen ve tarihi içindeki yaprak kabul edilir; süresi dolmuş sabit sertifika reddedilir', () => {
  const s = sertifikaUret({ cn: 'ha.test', san: ['ha.test'] });
  const baska = sertifikaUret({ cn: 'ha.test', san: ['ha.test'] });
  assert.equal(sabitlemeUyuyor(s.parmakIzi, s.der), true);
  assert.equal(sabitlemeUyuyor(s.parmakIzi, s.pem), true);
  assert.equal(sabitlemeUyuyor(s.parmakIzi, baska.der), false, 'aynı ad, başka sertifika');
  assert.equal(sabitlemeUyuyor(baska.parmakIzi, s.der), false);
  for (const kotu of ['', 'abc', null, undefined, s.parmakIzi.toUpperCase(), s.parmakIzi.slice(2)]) assert.equal(sabitlemeUyuyor(kotu, s.der), false);
  assert.equal(sabitlemeUyuyor(s.parmakIzi, Buffer.from('bozuk')), false);
  const dolmus = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], baslangic: new Date(SIMDI - 400 * GUN), bitis: new Date(SIMDI - GUN) });
  assert.equal(sabitlemeUyuyor(dolmus.parmakIzi, dolmus.der, { simdi: SIMDI }), false, 'sabitlense de süresi dolmuşsa kabul edilmez');
  assert.equal(sabitlemeUyuyor(dolmus.parmakIzi, dolmus.der, { simdi: SIMDI - 100 * GUN }), true, 'tarih içindeyken kabul');
});

test('zincir doğrulama: doğrudan kök imzası, ara sertifikalı zincir ve kök dahil gönderen sunucu kabul edilir', () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.test', san: ['ha.test', '192.168.1.50'] });
  const ortak = { kokPemler: [ca.pem], simdi: SIMDI };
  assert.deepEqual(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: 'ha.test', ...ortak }), { ok: true });
  assert.deepEqual(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: '192.168.1.50', ...ortak }), { ok: true }, 'IP SAN');

  const ara = sertifikaUret({ cn: 'Ara CA', ca: true, veren: ca });
  const yaprak = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], veren: ara });
  assert.deepEqual(zincirDogrula({ yaprakPem: yaprak.pem, araPemler: [ara.pem], anaBilgisayar: 'ha.test', ...ortak }), { ok: true });
  assert.deepEqual(zincirDogrula({ yaprakPem: yaprak.pem, araPemler: [ara.pem, ca.pem], anaBilgisayar: 'ha.test', ...ortak }), { ok: true }, 'sunucu kökü de yollarsa');
  assert.deepEqual(zincirDogrula({ yaprakPem: yaprak.pem, anaBilgisayar: 'ha.test', ...ortak }), { ok: false, neden: 'zincir-eksik' }, 'ara sertifika yoksa');
});

test('zincir doğrulama: yanlış ad, süresi dolmuş/henüz geçerli olmayan yaprak, başka kök, CA olmayan ara ve sahte imza reddedilir', () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.test', san: ['ha.test'] });
  const ortak = { kokPemler: [ca.pem], simdi: SIMDI };
  assert.deepEqual(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: 'baska.test', ...ortak }), { ok: false, neden: 'ad-uymuyor' });
  assert.deepEqual(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: '10.0.0.1', ...ortak }), { ok: false, neden: 'ad-uymuyor' });

  const dolmus = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], veren: ca, baslangic: new Date(SIMDI - 400 * GUN), bitis: new Date(SIMDI - GUN) });
  assert.deepEqual(zincirDogrula({ yaprakPem: dolmus.pem, anaBilgisayar: 'ha.test', ...ortak }), { ok: false, neden: 'suresi-doldu' });
  const gelecek = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], veren: ca, baslangic: new Date(SIMDI + 5 * GUN), bitis: new Date(SIMDI + 90 * GUN) });
  assert.deepEqual(zincirDogrula({ yaprakPem: gelecek.pem, anaBilgisayar: 'ha.test', ...ortak }), { ok: false, neden: 'henuz-gecerli-degil' });

  const digerKok = sertifikaUret({ cn: 'Baska Kok', ca: true });
  assert.equal(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: 'ha.test', kokPemler: [digerKok.pem], simdi: SIMDI }).ok, false, 'güvenilmeyen kök');
  assert.deepEqual(zincirDogrula({ yaprakPem: sunucu.pem, anaBilgisayar: 'ha.test', kokPemler: [], simdi: SIMDI }), { ok: false, neden: 'kok-yok' });

  // Aynı adı taşıyan sahte CA: ad aynı, imza farklı -> doğrulanamaz
  const sahteKok = sertifikaUret({ cn: 'Test Kok CA', ca: true });
  const sahteYaprak = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], veren: sahteKok });
  assert.equal(zincirDogrula({ yaprakPem: sahteYaprak.pem, anaBilgisayar: 'ha.test', ...ortak }).ok, false, 'ad benzerliği güven sağlamaz');

  // CA olmayan sertifika ara halka olarak kabul edilmez
  const caOlmayanAra = sertifikaUret({ cn: 'Ara', ca: false, veren: ca });
  const altYaprak = sertifikaUret({ cn: 'ha.test', san: ['ha.test'], veren: caOlmayanAra });
  assert.deepEqual(zincirDogrula({ yaprakPem: altYaprak.pem, araPemler: [caOlmayanAra.pem], anaBilgisayar: 'ha.test', ...ortak }), { ok: false, neden: 'zincir-eksik' });

  assert.deepEqual(zincirDogrula({ yaprakPem: 'bozuk', anaBilgisayar: 'ha.test', ...ortak }), { ok: false, neden: 'pem-gecersiz' });
});

test('zincir doğrulama: jokerli ad yalnız tek etiketi karşılar; süresi dolmuş kök güven sağlamaz', () => {
  const kok = sertifikaUret({ cn: 'Kok', ca: true });
  const joker = sertifikaUret({ cn: '*.ev.test', san: ['*.ev.test'], veren: kok });
  const ortak = { kokPemler: [kok.pem], simdi: SIMDI };
  assert.equal(zincirDogrula({ yaprakPem: joker.pem, anaBilgisayar: 'ha.ev.test', ...ortak }).ok, true);
  assert.equal(zincirDogrula({ yaprakPem: joker.pem, anaBilgisayar: 'a.b.ev.test', ...ortak }).ok, false);
  assert.equal(zincirDogrula({ yaprakPem: joker.pem, anaBilgisayar: 'ev.test', ...ortak }).ok, false);
  assert.equal(zincirDogrula({ yaprakPem: joker.pem, anaBilgisayar: 'ha.ev.test', kokPemler: [kok.pem], simdi: SIMDI + 5000 * GUN }).ok, false, 'çok ileri tarihte yaprak/kök süresi dolmuş');
});
