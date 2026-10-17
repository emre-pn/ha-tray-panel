'use strict';

/**
 * Panel modelinin "eylem" bölümü (src/lib/eylem-modeli.js): ana süreçten renderer'a yalnız beyaz listeli, doğrulanmış alanlar gider.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { rendererEylem, geriAlOzeti, degisenOzeti, EN_COK_GERI_AL, EN_COK_DEGISEN } = require('../src/lib/eylem-modeli');
const { rendererModeli } = require('../src/lib/yuzey-modeli');

test('geri al özeti: adet 1..5, kısa ad, mutlak bitiş; fazla alan ve bozuk değerler atılır', () => {
  assert.deepEqual(geriAlOzeti({ adet: 2, ad: 'Salon', bitis: 1_700_000_000_000, kimlik: 'light.salon', adimlar: [1] }), { adet: 2, ad: 'Salon', bitis: 1_700_000_000_000 });
  assert.equal(geriAlOzeti({ adet: 9, ad: 'x', bitis: 5 }).adet, EN_COK_GERI_AL);
  assert.equal(geriAlOzeti({ adet: 1, ad: 'x'.repeat(200), bitis: 5 }).ad.length, 60);
  assert.equal(geriAlOzeti({ adet: 1, bitis: 5 }).ad, '');
  assert.equal(geriAlOzeti({ adet: 1, ad: 'x', bitis: 5.9 }).bitis, 5);
  for (const kotu of [null, undefined, 'x', 5, [], {}, { adet: 0, bitis: 5 }, { adet: 1.5, bitis: 5 }, { adet: 1, bitis: -1 }, { adet: 1, bitis: NaN }, { adet: 1, bitis: 'yarın' }]) {
    assert.equal(geriAlOzeti(kotu), null, JSON.stringify(kotu));
  }
});

test('rendererEylem: bölüm yoksa ya da bozuksa geri al yok; girdi değiştirilmez', () => {
  assert.deepEqual(rendererEylem(undefined), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  assert.deepEqual(rendererEylem({ geriAl: 'x', gecikmeli: 'x', baska: { gizli: 1 } }), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  const girdi = { geriAl: { adet: 1, ad: 'Salon', bitis: 10 }, gizli: 'sizmamali' };
  const kopya = structuredClone(girdi);
  assert.deepEqual(rendererEylem(girdi), { geriAl: { adet: 1, ad: 'Salon', bitis: 10 }, gecikmeli: [], degisenler: [], degisenAcik: false });
  assert.deepEqual(girdi, kopya);
});

test('rendererModeli: eylem bölümü beyaz listeden geçerek gider (modelde olmayan bölüm = geri al yok)', () => {
  const model = { gruplar: [], sonlar: [], sayfalar: [], ust: {}, eylem: { geriAl: { adet: 3, ad: 'Film', bitis: 99, adimlar: ['kimlik'] }, gizli: 1 } };
  assert.deepEqual(rendererModeli(model).eylem, { geriAl: { adet: 3, ad: 'Film', bitis: 99 }, gecikmeli: [], degisenler: [], degisenAcik: false });
  assert.deepEqual(rendererModeli({ gruplar: [], sonlar: [] }).eylem, { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
});

// --- son değişenler (o-18) ---------------------------------------------------------------------------------

test('degisenOzeti: beyaz liste, en yeni üstte, en çok 20; bilinmeyen alan/tür, bozuk kimlik/zaman ve kapı kuralından geçmeyen ad düşer', () => {
  const iyi = (k, ek = {}) => ({ kimlik: k, ad: 'Ad', alan: k.split('.')[0], tur: 'acildi', zaman: 100, ...ek });
  const sonuc = degisenOzeti([
    iyi('light.a', { zaman: 100, gizli: 'sizmamali' }),
    iyi('switch.b', { zaman: 300.8 }),
    iyi('scene.c', { zaman: 200, tur: 'calisti' }),
    iyi('climate.d', { tur: 'degisti', zaman: 50 }),
    iyi('media_player.e', { tur: 'kapandi', zaman: 40 }),
    iyi('sensor.f'),
    iyi('lock.g', { alan: 'lock' }),
    iyi('light.h', { alan: 'switch' }),
    iyi('light.i', { tur: 'patladi' }),
    iyi('light.j', { zaman: -1 }),
    iyi('light.k', { zaman: 'dün' }),
    iyi('Light.L'),
    iyi('light.kapi_isigi', { ad: 'Kapı ışığı' }),
    iyi('light.m', { ad: 'Garaj kapısı' }),
    null,
    5,
    'x',
  ]);
  assert.deepEqual(sonuc.map((o) => o.kimlik), ['switch.b', 'scene.c', 'light.a', 'climate.d', 'media_player.e']);
  assert.equal(sonuc[0].zaman, 300);
  assert.deepEqual(Object.keys(sonuc[2]).sort(), ['ad', 'alan', 'kimlik', 'tur', 'zaman']);
  const cok = degisenOzeti(Array.from({ length: 40 }, (_, i) => iyi(`light.l_${i}`, { zaman: i + 1 })));
  assert.equal(cok.length, EN_COK_DEGISEN);
  assert.equal(degisenOzeti('x').length, 0);
  assert.equal(degisenOzeti(undefined).length, 0);
  assert.equal(degisenOzeti([iyi('light.uzun', { ad: 'x'.repeat(200) })])[0].ad.length, 60);
});

test('rendererEylem: degisenler ve degisenAcik beyaz listeden geçer; degisenAcik yalnız true ile açılır', () => {
  const girdi = { degisenler: [{ kimlik: 'light.a', ad: 'A', alan: 'light', tur: 'acildi', zaman: 5, gizli: 1 }], degisenAcik: true, baska: 'x' };
  const kopya = structuredClone(girdi);
  assert.deepEqual(rendererEylem(girdi).degisenler, [{ kimlik: 'light.a', ad: 'A', alan: 'light', tur: 'acildi', zaman: 5 }]);
  assert.equal(rendererEylem(girdi).degisenAcik, true);
  assert.deepEqual(girdi, kopya, 'girdi değiştirilmez');
  assert.equal(rendererEylem({ degisenAcik: 1 }).degisenAcik, false);
  assert.equal(rendererEylem({ degisenAcik: 'true' }).degisenAcik, false);
});
