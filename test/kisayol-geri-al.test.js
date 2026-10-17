'use strict';

/**
 * Genel kısayol planında "geri al" (o-12, src/lib/kisayol.js kisayolPlani geriAl): plana yalnız kısayol varsa girer, çakışmada mevcut
 * kısayollar kazanır (varsayılan Control+Alt+Z kullanıcının önceden atadığı bir kısayolu ezmez), geçersiz kısayol reddedilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { kisayolPlani } = require('../src/lib/kisayol');

const SALON = { entity_id: 'light.salon', ad: 'Salon' };

test('geriAl verilmezse ya da boşsa plana girmez; verilirse tur "geri-al" olarak en sonda ve geçerli', () => {
  assert.deepEqual(kisayolPlani({ ana: 'Control+Alt+H', palet: 'Control+Alt+P' }).map((o) => o.tur), ['ana', 'palet']);
  assert.deepEqual(kisayolPlani({ ana: 'Control+Alt+H', geriAl: '' }).map((o) => o.tur), ['ana']);
  assert.deepEqual(kisayolPlani({ ana: 'Control+Alt+H', geriAl: '   ' }).map((o) => o.tur), ['ana']);
  const plan = kisayolPlani({ ana: 'Control+Alt+H', palet: 'Control+Alt+P', favoriler: [{ ...SALON, kisayol: 'Control+Alt+L' }], panolar: [{ kisayol: 'Control+Alt+E' }], geriAl: 'ctrl alt z' });
  assert.deepEqual(plan.map((o) => o.tur), ['ana', 'palet', 'favori', 'pano', 'geri-al']);
  const geriAl = plan.at(-1);
  assert.deepEqual([geriAl.id, geriAl.kisayol, geriAl.gecerli, geriAl.neden], ['geri-al', 'Control+Alt+Z', true, null]);
});

test('çakışma: ana, palet, favori ve pano kısayolları geri almadan ÖNCE gelir ve kazanır; geri alma "cakisma" olur', () => {
  for (const [ad, girdi] of [
    ['ana', { ana: 'Control+Alt+Z' }],
    ['palet', { palet: 'Control+Alt+Z' }],
    ['favori', { favoriler: [{ ...SALON, kisayol: 'Control+Alt+Z' }] }],
    ['pano', { panolar: [{ kisayol: 'Control+Alt+Z' }] }],
  ]) {
    const plan = kisayolPlani({ ...girdi, geriAl: 'Control+Alt+Z' });
    const geriAl = plan.find((o) => o.tur === 'geri-al');
    assert.equal(geriAl.gecerli, false, ad);
    assert.equal(geriAl.neden, 'cakisma', ad);
    assert.ok(plan.filter((o) => o.tur !== 'geri-al').every((o) => o.gecerli), `${ad}: mevcut kısayol etkilenmez`);
  }
});

test('geçersiz ya da Windows\'a ayrılmış geri alma kısayolu reddedilir; geçerli diğer kısayollar etkilenmez', () => {
  const plan = kisayolPlani({ ana: 'Control+Alt+H', geriAl: 'Alt+F4' });
  assert.deepEqual(plan.map((o) => [o.tur, o.gecerli, o.neden]), [['ana', true, null], ['geri-al', false, 'gecersiz']]);
  assert.ok(plan.at(-1).mesaj.length > 0);
});

test('geri alma kısayolu favori sınırına sayılmaz', () => {
  const favoriler = Array.from({ length: 12 }, (_, i) => ({ entity_id: `light.l${i}`, ad: `L${i}`, kisayol: `Control+Alt+${String.fromCharCode(65 + i)}` }));
  const plan = kisayolPlani({ favoriler, geriAl: 'Control+Alt+1' });
  assert.equal(plan.at(-1).gecerli, true);
});
