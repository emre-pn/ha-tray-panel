'use strict';

/**
 * Panel sayfaları (src/lib/sayfalar.js, o-24): doğrulama ve model. Sayfa yalnız bir KAYITTIR: hiçbir yeni eylem yolu açmaz; sayfa adı
 * ve varlık kimlikleri kapı kuralından geçer; sayfadaki varlık panelde karo olarak ancak favori ve süzgeçten geçmişse görünür.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/sayfalar');
const { alanTipleri, ekGirdiDogrula, ekAyarlariUygula, ekAyarOzeti, aktarilanAlanlar, alanlariDuzelt } = require('../src/lib/ayar-alanlari');
const { TR } = require('../src/lib/ceviri-varsayilan');
const { yuzeyModeliOlustur, rendererModeli } = require('../src/lib/yuzey-modeli');

const sayfa = (id, ad, varliklar) => ({ id, ad, varliklar });

test('sayfalariDuzelt: dizi değilse undefined; geçerli sayfa aynen korunur', () => {
  assert.equal(S.sayfalariDuzelt(undefined), undefined);
  assert.equal(S.sayfalariDuzelt('x'), undefined);
  assert.equal(S.sayfalariDuzelt({}), undefined);
  assert.deepEqual(S.sayfalariDuzelt([]), []);
  const girdi = [sayfa('abc', 'Işıklar', ['light.a', 'switch.priz'])];
  assert.deepEqual(S.sayfalariDuzelt(girdi), girdi);
  assert.notEqual(S.sayfalariDuzelt(girdi)[0], girdi[0], 'derin kopya');
});

test('sayfalariDuzelt: geçersiz sayfa kimliği, yinelenen kimlik ve 12 sayfa sınırı', () => {
  const ham = [
    sayfa('abc', 'A', []), sayfa('abc', 'Aynı', []), sayfa('A!', 'Kötü', []), sayfa('ab', 'Kısa', []), sayfa('x'.repeat(20), 'Uzun', []),
    null, 5, 'x', [], { ad: 'kimliksiz' }, { id: 5 },
  ];
  assert.deepEqual(S.sayfalariDuzelt(ham).map((s) => s.id), ['abc']);
  const cok = Array.from({ length: 20 }, (_, i) => sayfa(`sa${String(i).padStart(2, '0')}`, `S${i}`, []));
  assert.equal(S.sayfalariDuzelt(cok).length, 12);
});

test('sayfalariDuzelt: varlıklar — yinelenen, geçersiz biçim, karo olamayan alan ve kapı kuralı elenir; en çok 100', () => {
  const ham = [sayfa('abc', 'A', [
    'light.a', 'light.a', 'LIGHT.B', 'light', 5, null, 'lock.on_kapi', 'cover.perde', 'camera.salon', 'alarm_control_panel.ev', 'siren.korna',
    'light.garaj_isigi', 'switch.kapi_prizi', 'scene.film', 'sensor.sicaklik', 'binary_sensor.hareket', 'automation.x', 'sun.sun',
  ])];
  assert.deepEqual(S.sayfalariDuzelt(ham)[0].varliklar, ['light.a', 'scene.film', 'sensor.sicaklik', 'binary_sensor.hareket']);
  const yuzlerce = [sayfa('abc', 'A', Array.from({ length: 150 }, (_, i) => `light.l${i}`))];
  assert.equal(S.sayfalariDuzelt(yuzlerce)[0].varliklar.length, 100);
});

test('sayfa adı: kısaltılır; kapı kuralına takılan ad sayfayı düşürmez, adsız bırakır', () => {
  assert.equal(S.sayfaAdiDuzelt('Oturma Odası'), 'Oturma Odası');
  assert.equal(S.sayfaAdiDuzelt('x'.repeat(100)).length, 24);
  for (const yasak of ['Kapı', 'Garaj kapısı', 'Alarm', 'Kilitler', 'Front Door', 'Bariyer', 'Kepenk', 'K a p ı'.replace(/ /g, '­')]) {
    assert.equal(S.sayfaAdiDuzelt(yasak), '', `"${yasak}" sayfa adı olamaz`);
  }
  for (const kotu of [null, 5, undefined, {}, 'y'.repeat(500)]) assert.equal(S.sayfaAdiDuzelt(kotu), '');
  const duz = S.sayfalariDuzelt([sayfa('abc', 'Garaj kapısı', ['light.a'])]);
  assert.deepEqual(duz, [sayfa('abc', '', ['light.a'])], 'sayfa ve varlıkları korunur');
});

test('adiEngellenenSayisi: yalnız dolu ad boş çıktıysa sayılır', () => {
  const istenen = [sayfa('abc', 'Kapı', []), sayfa('def', '', []), sayfa('ghi', 'Işık', []), sayfa('jkl', 'Alarm', [])];
  const sonuc = S.sayfalariDuzelt(istenen);
  assert.equal(S.adiEngellenenSayisi(istenen, sonuc), 2);
  assert.equal(S.adiEngellenenSayisi(null, sonuc), 0);
  assert.equal(S.adiEngellenenSayisi(istenen, null), 0);
});

test('sayfalariBuda: favori olmayan varlıklar atılır; sayfalar ve sıra korunur', () => {
  const l = [sayfa('abc', 'A', ['light.a', 'light.b']), sayfa('def', 'B', ['light.b'])];
  assert.deepEqual(S.sayfalariBuda(l, new Set(['light.b'])), [sayfa('abc', 'A', ['light.b']), sayfa('def', 'B', ['light.b'])]);
  assert.deepEqual(S.sayfalariBuda(l, ['light.a']).map((s) => s.varliklar), [['light.a'], []]);
  assert.deepEqual(S.sayfalariBuda(null, []), []);
});

test('sayfalariModele: yalnız modelde karosu olan varlıklar; adsız sayfaya sıra numaralı ad', () => {
  const l = [sayfa('abc', 'A', ['light.a', 'light.gizli', 'light.b']), sayfa('def', '', ['light.b'])];
  const m = S.sayfalariModele(l, new Set(['light.a', 'light.b']), (n) => `Sayfa ${n}`);
  assert.deepEqual(m, [{ id: 'abc', ad: 'A', kimlikler: ['light.a', 'light.b'] }, { id: 'def', ad: 'Sayfa 2', kimlikler: ['light.b'] }]);
  assert.deepEqual(S.sayfalariModele(undefined, new Set(), () => ''), []);
  assert.equal(S.sayfalariModele([sayfa('abc', '', [])], new Set())[0].ad, '1', 'adsiz verilmezse sıra numarası');
});

test('ayar alanı: sayfalar tabloda; varsayılan boş; kaydet doğrulaması, uygulama, özet ve dışa aktarma', () => {
  assert.equal(alanTipleri().sayfalar, 'dizi');
  assert.ok(aktarilanAlanlar().includes('sayfalar'));
  assert.deepEqual(alanlariDuzelt({}, {}).sayfalar, []);
  assert.deepEqual(alanlariDuzelt({ sayfalar: 'bozuk' }, {}).sayfalar, [], 'bozuk dosya varsayılana düşer');
  const girdi = { sayfalar: [sayfa('abc', 'Kapı', ['light.a', 'lock.on_kapi']), sayfa('abc', 'Yinelenen', [])] };
  const d = ekGirdiDogrula(girdi, TR);
  assert.deepEqual(d.yeni.sayfalar, [sayfa('abc', '', ['light.a'])]);
  const kotu = ekGirdiDogrula({ sayfalar: 'x' }, TR);
  assert.equal(kotu.yeni.sayfalar, undefined);
  assert.equal(kotu.uyarilar[0].alan, 'sayfalar');
  const ayarlar = { sayfalar: [] };
  const degisen = ekAyarlariUygula(ayarlar, d.yeni);
  assert.equal(degisen.length, 1);
  assert.equal(degisen[0].ad, 'sayfalar');
  assert.deepEqual(ekAyarOzeti(ayarlar).sayfalar, [sayfa('abc', '', ['light.a'])]);
  assert.deepEqual(ekAyarlariUygula(ayarlar, d.yeni), [], 'aynı değer yeniden uygulanınca değişiklik yok');
});

test('ayarGirdisiniDogrula: adı kapı kuralına takılan sayfa için kullanıcıya uyarı verilir', () => {
  const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');
  const mevcut = {};
  const r = ayarGirdisiniDogrula({ sayfalar: [sayfa('abc', 'Garaj kapısı', []), sayfa('def', 'Salon', [])] }, mevcut, { t: TR });
  assert.deepEqual(r.yeni.sayfalar.map((s) => s.ad), ['', 'Salon']);
  assert.equal(r.uyarilar.filter((u) => u.alan === 'sayfalar').length, 1);
  assert.match(r.uyarilar.find((u) => u.alan === 'sayfalar').mesaj, /1/);
  const temiz = ayarGirdisiniDogrula({ sayfalar: [sayfa('abc', 'Salon', [])] }, mevcut, { t: TR });
  assert.equal(temiz.uyarilar.filter((u) => u.alan === 'sayfalar').length, 0);
});

test('yüzey modeli: sayfalar modele girer; canlı durumda süzgeçten geçmeyen karo sayfada görünmez; renderer kopyası yalnız kimlik listesi taşır', () => {
  const durumlar = {
    'light.salon': { entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Salon' } },
    'light.kapi_isigi': { entity_id: 'light.kapi_isigi', state: 'on', attributes: { friendly_name: 'Kapı ışığı' } },
  };
  const favoriler = [{ entity_id: 'light.salon', ad: 'Salon' }, { entity_id: 'light.kapi_isigi', ad: 'Kapı ışığı' }];
  const sayfalar = [sayfa('abc', 'Akşam', ['light.kapi_isigi', 'light.salon', 'light.hayalet'])];
  const model = yuzeyModeliOlustur({ favoriler, durumAl: (k) => durumlar[k], sayfalar });
  assert.deepEqual(model.sayfalar, [{ id: 'abc', ad: 'Akşam', kimlikler: ['light.salon'] }]);
  const r = rendererModeli(model);
  assert.deepEqual(r.sayfalar, [{ id: 'abc', ad: 'Akşam', kimlikler: ['light.salon'] }]);
  assert.deepEqual(yuzeyModeliOlustur({ favoriler, durumAl: (k) => durumlar[k] }).sayfalar, [], 'sayfa yoksa boş liste');
});
