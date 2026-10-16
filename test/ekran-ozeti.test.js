'use strict';

// 1.4.0 (o-32, o-33): Electron `screen` okuması savunmalıdır; eksik/bozuk bir screen karşısında asla fırlatmaz.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ekranOzetleriAl, birincilOlcekAl } = require('../src/lib/ekran-ozeti');

const ekran = (id, x, olcek = 1) => ({ id, bounds: { x, y: 0, width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 }, scaleFactor: olcek });

test('ekranOzetleriAl: birincil ekran önce gelir, kimlikler ve çalışma alanları taşınır', () => {
  const screen = { getAllDisplays: () => [ekran(5, 1920), ekran(2, 0)], getPrimaryDisplay: () => ekran(2, 0) };
  const ozet = ekranOzetleriAl(screen);
  assert.deepEqual(ozet.map((e) => [e.id, e.birincil]), [[2, true], [5, false]]);
  assert.deepEqual(ozet[1].calismaAlani, { x: 1920, y: 0, width: 1920, height: 1040 });
});

test('ekranOzetleriAl: getPrimaryDisplay yoksa ya da kimliği geçersizse hiçbiri birincil sayılmaz, soldan sağa sıralanır', () => {
  const ozet = ekranOzetleriAl({ getAllDisplays: () => [ekran(5, 1920), ekran(2, 0)] });
  assert.deepEqual(ozet.map((e) => [e.id, e.birincil]), [[2, false], [5, false]]);
  const gecersiz = ekranOzetleriAl({ getAllDisplays: () => [ekran(5, 1920), ekran(2, 0)], getPrimaryDisplay: () => ({ id: 'x' }) });
  assert.equal(gecersiz.every((e) => e.birincil === false), true);
});

test('ekranOzetleriAl: eksik, bozuk ya da fırlatan screen boş liste döner', () => {
  assert.deepEqual(ekranOzetleriAl(undefined), []);
  assert.deepEqual(ekranOzetleriAl(null), []);
  assert.deepEqual(ekranOzetleriAl({}), []);
  assert.deepEqual(ekranOzetleriAl({ getAllDisplays: () => 'x' }), []);
  assert.deepEqual(ekranOzetleriAl({ getAllDisplays: () => { throw new Error('ekran yok'); } }), []);
  assert.deepEqual(ekranOzetleriAl({ getAllDisplays: () => [ekran(1, 0)], getPrimaryDisplay: () => { throw new Error('boom'); } }), []);
});

test('birincilOlcekAl: ölçek çarpanı; okunamazsa, sıfır ya da sayı olmayansa 1', () => {
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({ scaleFactor: 1.5 }) }), 1.5);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({ scaleFactor: 2 }) }), 2);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({ scaleFactor: 0 }) }), 1);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({ scaleFactor: -1 }) }), 1);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({ scaleFactor: '2' }) }), 1);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => ({}) }), 1);
  assert.equal(birincilOlcekAl({}), 1);
  assert.equal(birincilOlcekAl(undefined), 1);
  assert.equal(birincilOlcekAl({ getPrimaryDisplay: () => { throw new Error('boom'); } }), 1);
});
