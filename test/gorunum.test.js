'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TEMA_DEGERLERI, VARSAYILAN_TEMA, temaDuzelt, temaKaynagi, vurguRengiDuzelt } = require('../src/lib/gorunum');

test('temaKaynagi: koyu -> dark (zorla), sistem -> system; geçersiz değer varsayılan koyuya döner', () => {
  assert.deepEqual(TEMA_DEGERLERI, ['koyu', 'sistem']);
  assert.equal(VARSAYILAN_TEMA, 'koyu');
  assert.equal(temaKaynagi('koyu'), 'dark');
  assert.equal(temaKaynagi('sistem'), 'system');
  for (const kotu of ['light', 'dark', 'Koyu', '', null, undefined, 3]) assert.equal(temaKaynagi(kotu), 'dark', String(kotu));
});

test('temaDuzelt: geçerli korunur, geçersiz varsayılana (ya da verilen varsayılana) döner', () => {
  assert.equal(temaDuzelt('sistem'), 'sistem');
  assert.equal(temaDuzelt('x'), 'koyu');
  assert.equal(temaDuzelt('x', 'sistem'), 'sistem');
  assert.equal(temaDuzelt('x', 'bozuk'), 'koyu');
});

test('vurguRengiDuzelt: yalnız #rrggbb (küçük harfe çevrilir); boş = sistem rengi; başka her şey geçersiz (null)', () => {
  assert.equal(vurguRengiDuzelt('#0f75e0'), '#0f75e0');
  assert.equal(vurguRengiDuzelt('#0F75E0'), '#0f75e0');
  assert.equal(vurguRengiDuzelt('  #ABCDEF  '), '#abcdef');
  assert.equal(vurguRengiDuzelt(''), '');
  assert.equal(vurguRengiDuzelt('   '), '');
  for (const kotu of ['#fff', '0f75e0', '#0f75e', '#0f75e00', '#gggggg', 'red', 'rgb(1,2,3)', '#0f75e0; x', 'javascript:1', null, undefined, 5, true, {}, []]) {
    assert.equal(vurguRengiDuzelt(kotu), null, String(kotu));
  }
});
