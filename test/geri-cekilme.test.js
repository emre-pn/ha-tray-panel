'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DIZI_SN, bekleSn } = require('../src/lib/geri-cekilme');

const dizi = (tavan, adet) => Array.from({ length: adet }, (_, n) => bekleSn(n, tavan));

test('tavan 30: 2, 4, 8, 15, 30, 30', () => {
  assert.deepEqual(dizi(30, 6), [2, 4, 8, 15, 30, 30]);
});

test('tavan 10: 2, 4, 8, 10, 10', () => {
  assert.deepEqual(dizi(10, 5), [2, 4, 8, 10, 10]);
});

test('tavan 5: 2, 4, 5, 5', () => {
  assert.deepEqual(dizi(5, 4), [2, 4, 5, 5]);
});

test('tavan çok büyükse 15 sn sonra tavana çıkar', () => {
  assert.deepEqual(dizi(3600, 6), [2, 4, 8, 15, 3600, 3600]);
});

test('geçersiz n ve tavan güvenle ele alınır', () => {
  assert.equal(bekleSn(-3, 30), 2);
  assert.equal(bekleSn(NaN, 30), 2);
  assert.equal(bekleSn(undefined, 30), 2);
  assert.equal(bekleSn(1.5, 30), 2);
  assert.equal(bekleSn(0, NaN), 2);
  assert.equal(bekleSn(10, undefined), 30); // varsayılan tavan
  assert.equal(bekleSn(10, 0), 30);
  assert.equal(bekleSn(10, -5), 30);
});

test('dizi sabitleri', () => {
  assert.deepEqual(DIZI_SN, [2, 4, 8, 15]);
});
