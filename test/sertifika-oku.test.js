'use strict';

/**
 * src/lib/sertifika-oku.js (o-56): sunucu sertifikasını okuma. Yalnız 127.0.0.1 üzerindeki sahte TLS sunucusu; gerçek Home Assistant ya da
 * internet yok. Okuyucu bağlantıya HİÇBİR veri yazmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const { sunucuSertifikasiniOku } = require('../src/lib/sertifika-oku');
const { sertifikaUret } = require('./sertifika-uret');

function tlsSunucu(sertifika) {
  const gelenVeri = [];
  const baglantilar = [];
  const sunucu = tls.createServer({ key: sertifika.privateKeyPem, cert: sertifika.pem });
  sunucu.on('secureConnection', (soket) => {
    baglantilar.push(soket);
    soket.on('error', () => {});
    soket.on('data', (p) => gelenVeri.push(p));
  });
  return new Promise((coz) => {
    sunucu.listen(0, '127.0.0.1', () => coz({ sunucu, kapi: sunucu.address().port, gelenVeri, baglantilar, kapat: () => new Promise((k) => sunucu.close(() => k())) }));
  });
}

test('sertifika okuma: sunucunun yaprak sertifikası (DER) döner, sistem güvenmiyor bayrağı doğru; sokete hiçbir veri yazılmaz', async () => {
  const s = sertifikaUret({ cn: '127.0.0.1', san: ['127.0.0.1'] });
  const sunucu = await tlsSunucu(s);
  try {
    const sonuc = await sunucuSertifikasiniOku({ anaBilgisayar: '127.0.0.1', kapi: sunucu.kapi });
    assert.equal(sonuc.ok, true);
    assert.equal(Buffer.compare(sonuc.der, s.der), 0, 'sunulan sertifika birebir');
    assert.equal(sonuc.sistemGuveniyor, false, 'kendinden imzalı sertifika sistem tarafından güvenilmez');
    await new Promise((coz) => setTimeout(coz, 80));
    assert.equal(sunucu.gelenVeri.length, 0, 'uygulama verisi yok: istek, üstbilgi, anahtar gitmedi');
    assert.equal(sunucu.baglantilar.every((b) => b.destroyed || !b.writable || b.readyState !== 'open'), true, 'okuma sonrası bağlantı kesildi');
  } finally {
    await sunucu.kapat();
  }
});

test('sertifika okuma: ulaşılamayan kapı baglanamadi, TLS konuşmayan sunucu baglanamadi/zaman-asimi verir', async () => {
  const gecici = net.createServer();
  await new Promise((coz) => gecici.listen(0, '127.0.0.1', coz));
  const kapali = gecici.address().port;
  await new Promise((coz) => gecici.close(coz));
  assert.deepEqual(await sunucuSertifikasiniOku({ anaBilgisayar: '127.0.0.1', kapi: kapali, zamanAsimiMs: 3000 }), { ok: false, neden: 'baglanamadi' });

  // TLS el sıkışmasını hiç yanıtlamayan sunucu: zaman aşımı
  const sessiz = net.createServer((soket) => {
    soket.on('error', () => {});
    soket.resume(); // istemci kapanınca 'close' görülebilsin
  });
  await new Promise((coz) => sessiz.listen(0, '127.0.0.1', coz));
  try {
    const sonuc = await sunucuSertifikasiniOku({ anaBilgisayar: '127.0.0.1', kapi: sessiz.address().port, zamanAsimiMs: 150 });
    assert.deepEqual(sonuc, { ok: false, neden: 'zaman-asimi' });
  } finally {
    await new Promise((coz) => sessiz.close(coz));
  }

  // Düz metin yanıtlayıp kapatan sunucu: TLS hatası
  const duz = net.createServer((soket) => {
    soket.on('error', () => {});
    soket.resume();
    soket.end('HTTP/1.1 200 OK\r\n\r\n');
  });
  await new Promise((coz) => duz.listen(0, '127.0.0.1', coz));
  try {
    const sonuc = await sunucuSertifikasiniOku({ anaBilgisayar: '127.0.0.1', kapi: duz.address().port, zamanAsimiMs: 3000 });
    assert.deepEqual(sonuc, { ok: false, neden: 'baglanamadi' });
  } finally {
    await new Promise((coz) => duz.close(coz));
  }
});

test('sertifika okuma: tls.connect fırlatırsa baglanamadi döner (kapı değeri geçersiz)', async () => {
  const sahteTls = {
    connect() {
      throw new RangeError('geçersiz kapı');
    },
  };
  assert.deepEqual(await sunucuSertifikasiniOku({ anaBilgisayar: 'ha.test', kapi: 70000, tls: sahteTls }), { ok: false, neden: 'baglanamadi' });
});
