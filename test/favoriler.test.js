'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EN_COK_FAVORI, favorileriDuzelt } = require('../src/lib/favoriler');

test('geçerli favoriler sırası ve adıyla korunur', () => {
  const { favoriler, atilanlar } = favorileriDuzelt([
    { entity_id: 'light.a', ad: '  A Lambası  ' },
    { entity_id: 'switch.b' },
    'script.c',
  ]);
  assert.deepEqual(favoriler, [
    { entity_id: 'light.a', ad: 'A Lambası' },
    { entity_id: 'switch.b', ad: 'switch.b' },
    { entity_id: 'script.c', ad: 'script.c' },
  ]);
  assert.deepEqual(atilanlar, []);
});

test('elenenler nedenleriyle geri bildirilir', () => {
  const { favoriler, atilanlar } = favorileriDuzelt([
    { entity_id: 'light.a', ad: 'A' },
    { entity_id: 'light.a', ad: 'A' },
    { entity_id: 'LIGHT.b', ad: 'B' },
    { entity_id: 42 },
    null,
    { entity_id: 'lawn_mower.s', ad: 'S' }, // 1.4.0: sensor artık karo olabilir; cover da (yalnız perde sınıfıyla); çim biçme kayıtsız
    { entity_id: 'lock.k', ad: 'K' },
    { entity_id: 'alarm_control_panel.a', ad: 'A' },
    { entity_id: 'light.kapi', ad: 'Kapı' },
    { entity_id: 'switch.x', ad: 'Door Relay' },
    { entity_id: 'switch.y', ad: 'Kilit Rölesi' },
    { entity_id: 'input_boolean.gun_dogumu_alarmi', ad: 'Alarm' },
  ]);
  assert.deepEqual(favoriler.map((f) => f.entity_id), ['light.a']);
  assert.deepEqual(
    atilanlar.map((a) => a.neden),
    ['tekrar', 'gecersiz-kimlik', 'gecersiz-kimlik', 'gecersiz-kimlik', 'alan', 'alan', 'alan', 'guvenlik', 'guvenlik', 'guvenlik', 'guvenlik'],
  );
});

test('200 favori sınırı aşılınca fazlası "sinir" olarak bildirilir (sessiz silinmez)', () => {
  const liste = Array.from({ length: EN_COK_FAVORI + 3 }, (_, i) => ({ entity_id: `light.l${i}`, ad: `L${i}` }));
  const { favoriler, atilanlar } = favorileriDuzelt(liste);
  assert.equal(favoriler.length, EN_COK_FAVORI);
  assert.deepEqual(atilanlar.map((a) => a.neden), ['sinir', 'sinir', 'sinir']);
  assert.equal(atilanlar[0].entity_id, `light.l${EN_COK_FAVORI}`);
});

test('dizi olmayan girdi boş döner', () => {
  for (const kotu of [null, undefined, 'x', 5, {}]) {
    assert.deepEqual(favorileriDuzelt(kotu), { favoriler: [], atilanlar: [] });
  }
});

test('çok uzun ad kısaltılır', () => {
  const { favoriler } = favorileriDuzelt([{ entity_id: 'light.a', ad: 'x'.repeat(300) }]);
  assert.equal(favoriler[0].ad.length, 100);
});

// --- denetim düzeltmeleri (Dalga 3): hazır liste yeniden denemesi ----------------------

test('hazirListeUygula: yalnizca verilirse yalnız o kimlikler denenir (kullanıcının çıkardıkları geri gelmez)', () => {
  const { HAZIR_LISTE, hazirListeUygula } = require('../src/lib/favoriler');
  const hepsi = HAZIR_LISTE.map((h) => ({ entity_id: h.kimlik, attributes: { friendly_name: h.etiket } }));
  const ilk = HAZIR_LISTE[0].kimlik;
  const ikinci = HAZIR_LISTE[1].kimlik;
  // ilk çağrı: ikinci kimlik HA'da yok
  const bir = hazirListeUygula([], hepsi.filter((v) => v.entity_id !== ikinci));
  assert.ok(bir.eklenenler.includes(ilk));
  assert.deepEqual(bir.atlananlar.filter((a) => a.neden === 'yok').map((a) => a.entity_id), [ikinci]);
  // kullanıcı ilk karoyu çıkardı; ikincisi sonradan HA'da göründü
  const kullanici = bir.favoriler.filter((f) => f.entity_id !== ilk);
  const tekrar = hazirListeUygula(kullanici, hepsi, { yalnizca: [ikinci] });
  assert.deepEqual(tekrar.eklenenler, [ikinci], 'yalnız önceden eksik olan eklenir');
  assert.equal(tekrar.favoriler.some((f) => f.entity_id === ilk), false, 'kullanıcının çıkardığı karo geri gelmedi');
  // yalnizca verilmezse eskisi gibi hepsi denenir
  const tam = hazirListeUygula(kullanici, hepsi);
  assert.ok(tam.eklenenler.includes(ilk));
  // boş dizi: hiçbir şey denenmez
  const bos = hazirListeUygula(kullanici, hepsi, { yalnizca: [] });
  assert.deepEqual(bos.eklenenler, []);
  assert.deepEqual(bos.atlananlar, []);
});
