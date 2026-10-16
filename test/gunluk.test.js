'use strict';

/**
 * hata-06: sır içermeyen döngülü günlük. Sahte (bellek içi) dosya sistemi kullanılır; gerçek %APPDATA%'ya yazılmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SATIR_SINIRI, sirTemizle, gunlukOlustur } = require('../src/lib/gunluk');

function sahteFs({ yazmaHatasi = false } = {}) {
  const dosyalar = new Map();
  return {
    dosyalar,
    mkdirSync() {},
    statSync(yol) {
      if (!dosyalar.has(yol)) throw new Error('yok');
      return { size: Buffer.byteLength(dosyalar.get(yol)) };
    },
    appendFileSync(yol, veri) {
      if (yazmaHatasi) throw new Error('disk dolu');
      dosyalar.set(yol, (dosyalar.get(yol) ?? '') + veri);
    },
    rmSync(yol) {
      dosyalar.delete(yol);
    },
    renameSync(eski, yeni) {
      dosyalar.set(yeni, dosyalar.get(eski));
      dosyalar.delete(eski);
    },
  };
}

// Sahte JWT çalışma anında birleştirilir: kaynakta JWT biçiminde sabit bulunmaz (test/yapi.test.js denetler).
const SAHTE_JWT = ['eyJ' + 'TEST_HEADER', 'eyJ' + 'TEST_PAYLOAD', 'TEST_IMZA_000'].join('.');

test('sirTemizle: Bearer anahtarı, JWT ve uzun diziler gizlenir', () => {
  assert.equal(sirTemizle('Authorization: Bearer TEST_ANAHTAR_000'), 'Authorization: Bearer [gizli]');
  assert.equal(sirTemizle(`anahtar ${SAHTE_JWT} bitti`), 'anahtar [jwt] bitti');
  assert.equal(sirTemizle('bearer abc.def'), 'Bearer [gizli]');
  const uzun = 'A'.repeat(40);
  assert.equal(sirTemizle(`kod ${uzun} son`), 'kod [uzun-dizi] son');
});

test('sirTemizle: sorgu dizgesindeki token/anahtar/parola/webhook değerleri gizlenir', () => {
  assert.equal(sirTemizle('GET /x?access_token=TEST_ANAHTAR_000&a=1'), 'GET /x?access_token=[gizli]&a=1');
  assert.equal(sirTemizle('/y?a=1&token=abc'), '/y?a=1&token=[gizli]');
  assert.equal(sirTemizle('?api_key=k1&password=p2&secret=s3&webhook_id=w4'), '?api_key=[gizli]&password=[gizli]&secret=[gizli]&webhook_id=[gizli]');
  assert.equal(sirTemizle('POST /api/webhook/TEST_WEBHOOK_000 yapıldı'), 'POST /api/webhook/[gizli] yapıldı');
});

test('sirTemizle: URL içi kullanıcı:parola gizlenir', () => {
  assert.equal(sirTemizle('https://kullanici:TEST_PAROLA@ha.ev.lan/api'), 'https://[gizli]@ha.ev.lan/api');
});

test('sirTemizle: normal metin değişmez; satır sonları tek satıra iner; 400 karaktere kısalır', () => {
  assert.equal(sirTemizle('Sayfa yüklenemedi: ERR_CONNECTION_REFUSED'), 'Sayfa yüklenemedi: ERR_CONNECTION_REFUSED');
  assert.equal(sirTemizle('Ev ağı adresine bağlanılıyor.'), 'Ev ağı adresine bağlanılıyor.');
  assert.equal(sirTemizle('a\nb\r\nc'), 'a b c');
  assert.equal(sirTemizle('x'.repeat(10) + ' ' + 'y '.repeat(500)).length, SATIR_SINIRI + 1);
  assert.equal(sirTemizle(null), '');
  assert.equal(sirTemizle(undefined), '');
});

test('gunlukOlustur: satır zaman damgasıyla yazılır ve sır dosyaya düşmez', () => {
  const fs = sahteFs();
  const g = gunlukOlustur({ dizin: 'D', fs, simdi: () => new Date('2026-10-06T10:00:00.000Z') });
  g.yaz(`istek Bearer TEST_ANAHTAR_000 ve ${SAHTE_JWT}`);
  const icerik = fs.dosyalar.get(path.join('D', 'ev-paneli.log'));
  assert.equal(icerik, '2026-10-06T10:00:00.000Z istek Bearer [gizli] ve [jwt]\n');
  assert.ok(!icerik.includes('TEST_ANAHTAR_000'));
  assert.ok(!icerik.includes('eyJ'));
});

test('gunlukOlustur: dosya sınırı aşılınca .1.log\'a döner, tek yedek tutulur, boyut sınırda kalır', () => {
  const fs = sahteFs();
  const g = gunlukOlustur({ dizin: 'D', fs, enFazlaBayt: 200, simdi: () => new Date(0) });
  for (let i = 0; i < 40; i += 1) g.yaz(`satir numarasi ${i}`);
  const ana = fs.dosyalar.get(g.yol);
  const eski = fs.dosyalar.get(g.eskiYol);
  assert.ok(eski, 'döndürülmüş dosya olmalı');
  assert.ok(Buffer.byteLength(ana) <= 200);
  assert.ok(Buffer.byteLength(eski) <= 200);
  assert.ok(g.eskiYol.endsWith('ev-paneli.1.log'));
  assert.equal(fs.dosyalar.size, 2);
  assert.ok(ana.includes('satir numarasi 39'));
});

test('gunlukOlustur: mevcut dosyanın boyutu ilk yazımda diskten okunur (yeniden başlatmada sınır korunur)', () => {
  const fs = sahteFs();
  const yol = path.join('D', 'ev-paneli.log');
  fs.dosyalar.set(yol, 'x'.repeat(190));
  const g = gunlukOlustur({ dizin: 'D', fs, enFazlaBayt: 200, simdi: () => new Date(0) });
  g.yaz('yeni satir');
  assert.ok(fs.dosyalar.has(g.eskiYol));
  assert.ok(fs.dosyalar.get(yol).includes('yeni satir'));
});

test('gunlukOlustur: yazma hatası uygulamayı durdurmaz; dizin yoksa yalnız konsol', () => {
  const g = gunlukOlustur({ dizin: 'D', fs: sahteFs({ yazmaHatasi: true }) });
  assert.doesNotThrow(() => g.yaz('x'));
  const sessiz = gunlukOlustur({});
  assert.equal(sessiz.yol, null);
  assert.doesNotThrow(() => sessiz.yaz('x'));
});

test('gunlukOlustur: konsola da (sırsız) yazabilir', (t) => {
  const satirlar = [];
  t.mock.method(console, 'log', (m) => satirlar.push(m));
  gunlukOlustur({ konsol: true }).yaz('Bearer TEST_ANAHTAR_000');
  assert.deepEqual(satirlar, ['[Ev Paneli] Bearer [gizli]']);
});
