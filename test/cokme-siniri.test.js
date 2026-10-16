'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COKME_PENCERESI_MS,
  EN_COK_COKME,
  cokmeSayilirMi,
  cokmeNedeniMetni,
  cokmeKarari,
} = require('../src/lib/cokme-siniri');

const SIMDI = 10_000_000;

test('ilk çökmelerde artan bekleme: 1, 2, 4, 8 sn', () => {
  const beklenen = [1000, 2000, 4000, 8000];
  for (let n = 1; n <= 4; n += 1) {
    const zamanlar = Array.from({ length: n }, (_, i) => SIMDI - (n - 1 - i) * 1000);
    assert.deepEqual(cokmeKarari(zamanlar, SIMDI), { dur: false, bekleMs: beklenen[n - 1], sayi: n });
  }
});

test('10 dakikada 5 çökmede otomatik yeniden yükleme durur', () => {
  const zamanlar = Array.from({ length: EN_COK_COKME }, (_, i) => SIMDI - i * 5000);
  const karar = cokmeKarari(zamanlar, SIMDI);
  assert.equal(karar.dur, true);
  assert.equal(karar.sayi, EN_COK_COKME);
  assert.equal(karar.bekleMs, 0);
  assert.equal(cokmeKarari([...zamanlar, SIMDI - 100], SIMDI).dur, true);
});

test('pencere dışındaki eski çökmeler sayılmaz', () => {
  const eskiler = Array.from({ length: 10 }, (_, i) => SIMDI - COKME_PENCERESI_MS - 1000 - i);
  assert.deepEqual(cokmeKarari([...eskiler, SIMDI], SIMDI), { dur: false, bekleMs: 1000, sayi: 1 });
  // tam sınırdaki çökme hâlâ sayılır
  assert.equal(cokmeKarari([SIMDI - COKME_PENCERESI_MS, SIMDI], SIMDI).sayi, 2);
});

test('özel sınırlar ve bozuk girdi güvenle işlenir', () => {
  assert.equal(cokmeKarari([SIMDI, SIMDI], SIMDI, { enCok: 2 }).dur, true);
  assert.deepEqual(cokmeKarari(null, SIMDI), { dur: false, bekleMs: 1000, sayi: 0 });
  assert.deepEqual(cokmeKarari([NaN, 'x', undefined, SIMDI + 5000], SIMDI), { dur: false, bekleMs: 1000, sayi: 0 }); // gelecekteki zaman geçersiz
  assert.equal(cokmeKarari([SIMDI], NaN).sayi, 0);
});

test('clean-exit çökme sayılmaz; bilinmeyen neden günlüğe "bilinmeyen" olarak girer', () => {
  assert.equal(cokmeSayilirMi('clean-exit'), false);
  for (const neden of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction']) {
    assert.equal(cokmeSayilirMi(neden), true, neden);
    assert.equal(cokmeNedeniMetni(neden), neden);
  }
  assert.equal(cokmeNedeniMetni('Bearer abc'), 'bilinmeyen');
  assert.equal(cokmeNedeniMetni(undefined), 'bilinmeyen');
});
