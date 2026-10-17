'use strict';

/**
 * 1.4.0 cihaz grubunun ayar satırları (src/lib/ayar-alanlari.js): o-48 kameraIzinleri / kameraBulanik / kameraYenilemeSn.
 * Gerçek tablo kullanılır: doğrulama, dışa aktarma kapsamı ve gizlilik varsayılanları uçtan uca denenir.
 * Gizlilik kuralı: hiçbir kamera kendiliğinden açılmaz (varsayılan boş liste) ve izin listesi dışa/içe aktarılmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AKTARILAN_ALANLAR, ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');

const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const duzelt = (ad, ham) => alan(ad).duzelt(ham);

test('üç kamera satırı kayıtlı; varsayılanlar: izin listesi boş, görüntü bulanık, otomatik yenileme kapalı', () => {
  assert.deepEqual(alan('kameraIzinleri').varsayilan, []);
  assert.equal(alan('kameraBulanik').varsayilan, true);
  assert.equal(alan('kameraYenilemeSn').varsayilan, 0);
  assert.equal(new Set(A.AYAR_ALANLARI.map((a) => a.ad)).size, A.AYAR_ALANLARI.length, 'çift ad yok');
});

test('kameraIzinleri dışa/içe aktarılmaz ve özette de yoktur; kameraBulanik ve kameraYenilemeSn taşınabilir tercihtir', () => {
  assert.equal(alan('kameraIzinleri').aktarilir, false);
  assert.equal(AKTARILAN_ALANLAR.includes('kameraIzinleri'), false);
  assert.equal(alan('kameraBulanik').aktarilir, true);
  assert.equal(alan('kameraYenilemeSn').aktarilir, true);
  assert.equal(AKTARILAN_ALANLAR.includes('kameraBulanik'), true);
  assert.equal(AKTARILAN_ALANLAR.includes('kameraYenilemeSn'), true);
});

test('dışa aktarma dosyasında kamera izin listesi yoktur; içe aktarılan dosya kamerayı kendiliğinden açamaz', () => {
  const ayarlar = ayarlariDuzelt({ semaSurumu: 6, favoriler: [{ entity_id: 'light.a', ad: 'A' }], kameraIzinleri: ['camera.salon'], kameraBulanik: false, kameraYenilemeSn: 30 }, { varsayilan: {} }).ayarlar;
  assert.deepEqual(ayarlar.kameraIzinleri, ['camera.salon'], 'ayar dosyasında yerel olarak tutulur');
  const disa = ayarlariDisaAktar(ayarlar);
  assert.equal(disa.ok, true);
  assert.doesNotMatch(disa.metin, /kameraIzinleri|camera\.salon/);
  assert.match(disa.metin, /"kameraBulanik": false/);
  assert.match(disa.metin, /"kameraYenilemeSn": 30/);

  // Başkasından gelen dosya izin listesi taşısa bile alınmaz.
  const dosya = { bicim: JSON.parse(disa.metin).bicim, aktarimSurumu: JSON.parse(disa.metin).aktarimSurumu, semaSurumu: 6, ayarlar: { favoriler: [{ entity_id: 'light.a', ad: 'A' }], kameraIzinleri: ['camera.salon', 'camera.balkon'], kameraBulanik: false } };
  const ice = ayarYedeginiCoz(dosya);
  assert.equal(ice.ok, true);
  assert.equal(Object.hasOwn(ice.ayarlar, 'kameraIzinleri'), false);
  assert.equal(ice.alanlar.includes('kameraIzinleri'), false);
  assert.equal(ice.ayarlar.kameraBulanik, false);
  // ayar dosyası biçimindeki yedek (ayarlar.v1-yedek.json) de izin listesini geri getirmez
  const yedek = ayarYedeginiCoz({ semaSurumu: 6, favoriler: [{ entity_id: 'light.a', ad: 'A' }], kameraIzinleri: ['camera.salon'] });
  assert.equal(yedek.ok, true);
  assert.equal(Object.hasOwn(yedek.ayarlar, 'kameraIzinleri'), false);
});

test('kameraIzinleri: geçerli camera.* kimlikleri, tekrarsız, en çok 8; kapı/zil/giriş kamerası, başka alan ve bozuk öğe düşer; dizi değilse reddedilir', () => {
  assert.deepEqual(duzelt('kameraIzinleri', ['camera.salon', 'camera.balkon']), ['camera.salon', 'camera.balkon']);
  assert.deepEqual(duzelt('kameraIzinleri', ['camera.salon', 'camera.on_kapi', 'camera.zil', 'camera.giris', 'light.salon', 'lock.on_kapi', 'camera.Salon', 5, null, 'camera.salon']), ['camera.salon']);
  const cok = Array.from({ length: 12 }, (_, i) => `camera.k${i}`);
  assert.deepEqual(duzelt('kameraIzinleri', cok), cok.slice(0, 8));
  assert.deepEqual(duzelt('kameraIzinleri', []), []);
  for (const kotu of ['camera.salon', null, undefined, {}, 5, true]) assert.equal(duzelt('kameraIzinleri', kotu), undefined, JSON.stringify(kotu));
});

test('kameraBulanik yalnız true/false; kameraYenilemeSn yalnız 0, 5, 10, 30, 60 (sayı ya da sayı metni)', () => {
  assert.equal(duzelt('kameraBulanik', true), true);
  assert.equal(duzelt('kameraBulanik', false), false);
  for (const kotu of ['false', 0, 1, null, undefined, {}, []]) assert.equal(duzelt('kameraBulanik', kotu), undefined, JSON.stringify(kotu));
  for (const sn of [0, 5, 10, 30, 60]) assert.equal(duzelt('kameraYenilemeSn', sn), sn, String(sn));
  for (const kotu of [1, 4, 15, 61, 600, -5, 5.5, NaN, Infinity, '', 'a', null, undefined, {}, []]) assert.equal(duzelt('kameraYenilemeSn', kotu), undefined, JSON.stringify(kotu));
});

test('alanlariDuzelt: bozuk kamera değerleri varsayılana düşer (kamera kapalı, bulanık, elle yenileme); geçerli olanlar korunur', () => {
  const bozuk = A.alanlariDuzelt({ kameraIzinleri: 'camera.salon', kameraBulanik: 'hayır', kameraYenilemeSn: 7 }, {});
  assert.deepEqual(bozuk.kameraIzinleri, []);
  assert.equal(bozuk.kameraBulanik, true);
  assert.equal(bozuk.kameraYenilemeSn, 0);
  const iyi = A.alanlariDuzelt({ kameraIzinleri: ['camera.salon', 'camera.zil'], kameraBulanik: false, kameraYenilemeSn: 60 }, {});
  assert.deepEqual(iyi.kameraIzinleri, ['camera.salon']);
  assert.equal(iyi.kameraBulanik, false);
  assert.equal(iyi.kameraYenilemeSn, 60);
  assert.notEqual(A.alanlariDuzelt({}, {}).kameraIzinleri, alan('kameraIzinleri').varsayilan, 'varsayılan dizi paylaşılmaz');
});

test('ayarlariDuzelt (uçtan uca): eski ayar dosyası kamerasız yükselir (hiçbir kamera açılmaz); kapı kamerası izin listesine yazılamaz', () => {
  const eski = ayarlariDuzelt({ semaSurumu: 5, favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }] }, { varsayilan: {} }).ayarlar;
  assert.deepEqual(eski.kameraIzinleri, []);
  assert.equal(eski.kameraBulanik, true);
  assert.equal(eski.kameraYenilemeSn, 0);
  const yeni = ayarlariDuzelt({ semaSurumu: 6, favoriler: [], kameraIzinleri: ['camera.on_kapi', 'camera.bebek'] }, { varsayilan: {} }).ayarlar;
  assert.deepEqual(yeni.kameraIzinleri, ['camera.bebek']);
});
