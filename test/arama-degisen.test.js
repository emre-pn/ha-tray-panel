'use strict';

/**
 * Palet "@" öneki (o-18, src/lib/arama.js degisenSorgusu + degisenSatirlari): son değişenler listesi için önek çözümlemesi ve ad süzme.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { degisenSorgusu, degisenSatirlari, paletSorgusu } = require('../src/lib/arama');

const LISTE = [
  { kimlik: 'light.salon', ad: 'Salon lambası', alan: 'light', tur: 'acildi', zaman: 30 },
  { kimlik: 'switch.priz', ad: 'Masa prizi', alan: 'switch', tur: 'kapandi', zaman: 20 },
  { kimlik: 'scene.film', ad: 'Film', alan: 'scene', tur: 'calisti', zaman: 10 },
];

test('degisenSorgusu: "@" ile başlayan sorgu süzgeç metnini verir; başında boşluk olabilir; "@" ortada ya da sonda önek değildir', () => {
  assert.deepEqual(degisenSorgusu('@'), { metin: '' });
  assert.deepEqual(degisenSorgusu('@salon'), { metin: 'salon' });
  assert.deepEqual(degisenSorgusu('  @  salon lamba  '), { metin: 'salon lamba' });
  assert.deepEqual(degisenSorgusu('@@'), { metin: '@' });
  for (const degil of ['salon', 'salon @', 's@lon', '', '   ', undefined, null, 5, '*salon', '#']) assert.equal(degisenSorgusu(degil), null, JSON.stringify(degil));
});

test('degisenSatirlari: boş süzgeç listeyi kendi sırasıyla (en yeni üstte) verir; süzgeç ad üzerinde Türkçe katlamayla eşler', () => {
  assert.deepEqual(degisenSatirlari('', LISTE).map((r) => r.degisen.kimlik), ['light.salon', 'switch.priz', 'scene.film']);
  assert.deepEqual(degisenSatirlari('salon', LISTE).map((r) => r.degisen.kimlik), ['light.salon']);
  assert.deepEqual(degisenSatirlari('LAMBASI', LISTE).map((r) => r.degisen.kimlik), ['light.salon'], 'büyük harf');
  assert.deepEqual(degisenSatirlari('lambasi', LISTE).map((r) => r.degisen.kimlik), ['light.salon'], 'ı -> i katlaması');
  assert.deepEqual(degisenSatirlari('film', LISTE).map((r) => r.degisen.tur), ['calisti']);
  assert.deepEqual(degisenSatirlari('yokboyle', LISTE), []);
  const s = degisenSatirlari('sal', LISTE)[0];
  assert.deepEqual(s.konumlar, [0, 1, 2], 'vurgulanacak harf konumları');
  assert.equal(s.degisen, LISTE[0], 'öğe olduğu gibi döner');
});

test('degisenSatirlari: bozuk girdi çökertmez; adı olmayan ya da nesne olmayan öğeler atlanır', () => {
  for (const kotu of [undefined, null, 'x', 5, {}, [null, 5, 'x', {}, { ad: 5 }]]) assert.deepEqual(degisenSatirlari('a', kotu), [], JSON.stringify(kotu));
  assert.deepEqual(degisenSatirlari('', [null, { ad: 'A' }, { kimlik: 'x' }]).map((r) => r.degisen.ad), ['A']);
});

test('paletSorgusu "@" önekini bilmez (düz arama): önek yönlendirmesi arayüzün işidir ve normal sorguları etkilemez', () => {
  const ogeler = [{ etiket: 'Salon lambası', grupEtiketi: 'Işık', alan: 'light' }];
  assert.equal(paletSorgusu('salon', ogeler).sonuclar.length, 1);
  assert.equal(paletSorgusu('@salon', ogeler).sonuclar.length, 0, '"@" harf değildir; hiçbir öğeyle eşleşmez');
});
