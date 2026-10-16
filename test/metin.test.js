'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sadelestir, anahtarKatla, adAnahtari } = require('../src/lib/metin');

test('anahtarKatla (eski katlama): işaretler ayraçtır; "Ses +" ve "Ses −" aynı "ses" olur', () => {
  assert.equal(anahtarKatla('Gece lambası'), 'gece lambasi');
  assert.equal(anahtarKatla('GECE_LAMBASI'), 'gece lambasi');
  assert.equal(anahtarKatla('Ses +'), 'ses');
  assert.equal(anahtarKatla('Ses −'), 'ses');
});

test('adAnahtari (h-21): tek başına duran "+" ve "-" / "−" işaretleri "arti" / "eksi" sözcüğüne çevrilir', () => {
  assert.equal(adAnahtari('Ses +'), 'ses arti');
  assert.equal(adAnahtari('Ses -'), 'ses eksi');
  assert.equal(adAnahtari('Ses −'), 'ses eksi');
  assert.equal(adAnahtari('+'), 'arti');
  assert.equal(adAnahtari('  -  '), 'eksi');
  assert.equal(adAnahtari('Ses + 5'), 'ses arti 5');
  assert.equal(adAnahtari('+ - +'), 'arti eksi arti');
  assert.notEqual(adAnahtari('Ses +'), adAnahtari('Ses −'));
});

test('adAnahtari: sözcüğe bitişik işaretler ayraç kalır; "arti"/"eksi" yazımı aynı anahtarı üretir; diğer katlamalar anahtarKatla gibidir', () => {
  assert.equal(adAnahtari('gece-lambasi'), 'gece lambasi');
  assert.equal(adAnahtari('Ses+'), 'ses');
  assert.equal(adAnahtari('C++'), 'c');
  assert.equal(adAnahtari('Ses arti'), adAnahtari('Ses +'));
  assert.equal(adAnahtari('SES EKSİ'), adAnahtari('ses -'));
  // Tam genişlikli işaretler NFKD ile önce sadeleşir.
  assert.equal(adAnahtari('Ses ＋'), 'ses arti');
  assert.equal(adAnahtari('Ses －'), 'ses eksi');
  for (const m of ['Gece lambası', 'Ön Kapı', 'LED şerit 40', 'ｋａｐｉ', '', null, undefined]) {
    assert.equal(adAnahtari(m), anahtarKatla(m), String(m));
  }
  assert.equal(adAnahtari('!!!'), '');
  assert.equal(sadelestir('Ses +'), 'ses +', 'sadelestir işaretlere dokunmaz');
});
