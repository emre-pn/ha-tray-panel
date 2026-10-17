'use strict';

/**
 * Ayarlar > "Sıra ve tepsi": "Tepsi menüsünde (n/8)" sayacı GERÇEK tepsi sırasını izler. Tepsi menüsü (src/lib/tepsi-menu.js
 * tepsiMenuPlani) "tepsiye sabitle" (tepsi:true) açık zararsız favorileri önce koyar; sayaç da aynı sırayı saymalıdır.
 * Gerçek pencere / Electron / Home Assistant YOK: sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { acilmisSayfa, AYAR_D3, CIHAZLAR_D3, satirBul, girdiler, sira, siraMetni } = require('./ayarlar-sahte');
const { tepsiMenuPlani } = require('../src/lib/tepsi-menu');

const isikCihazi = (n) => ({
  entity_id: `light.lamba_${n}`,
  ad: `Lamba ${n}`,
  alan: 'light',
  alanEtiketi: 'Işıklar',
  durum: '',
  onayZorunlu: false,
  varsayilanOnay: false,
  kisayolUygun: true,
  tekTiklama: true,
  gizli: false,
});
const DOKUZ = Array.from({ length: 9 }, (_, i) => i + 1);
const CIHAZLAR = { ...CIHAZLAR_D3, cihazlar: DOKUZ.map(isikCihazi) };
const AYAR = { ...AYAR_D3, sayfalar: [], favoriler: DOKUZ.map((n) => ({ entity_id: `light.lamba_${n}`, ad: `Lamba ${n}` })) };

const konumMetni = (sayfa, ad) => {
  const satir = sira(sayfa).find((s) => siraMetni(s) === ad);
  assert.ok(satir, `${ad} sıra listesinde`);
  return satir.bul((o) => o.className.startsWith('sira-konum'))[0].textContent;
};
const tepsiKutusu = (sayfa, kimlik) => girdiler(satirBul(sayfa, kimlik)).filter((g) => g.type === 'checkbox').at(-1);

test('tepsi sayacı: sabitlenmiş favori yoksa sayaç favori sırasıdır (ilk 8 tepside, dokuzuncu "Diğer")', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(konumMetni(sayfa, 'Lamba 1'), 'Tepsi menüsünde (1/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 8'), 'Tepsi menüsünde (8/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 9'), 'Diğer favoriler altında');
});

test('tepsi sayacı: "tepsiye sabitle" açık favori sayaçta öne geçer, diğerleri kayar (tepsi menüsü planıyla aynı sıra)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  tepsiKutusu(sayfa, 'light.lamba_9').tikla();
  assert.equal(konumMetni(sayfa, 'Lamba 9'), 'Tepsi menüsünde (1/8)', 'sabitlenen dokuzuncu favori tepsinin başında');
  assert.equal(konumMetni(sayfa, 'Lamba 1'), 'Tepsi menüsünde (2/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 7'), 'Tepsi menüsünde (8/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 8'), 'Diğer favoriler altında', 'sabitleme sekizinciyi "Diğer favoriler"e iter');

  // aynı girdi için gerçek tepsi planı da aynı sırayı üretir
  const karolar = DOKUZ.map((n) => ({ id: `light.lamba_${n}`, etiket: `Lamba ${n}`, alan: 'light', durum: 'kapali', yuzde: null, kullanilabilir: true, ulasilamiyor: false, sinif: 'zararsiz', varsayilanEylem: true, tepsi: n === 9 }));
  const plan = tepsiMenuPlani(karolar);
  assert.equal(plan.ust[0].kimlik, 'light.lamba_9');
  assert.equal(plan.ust.length, 8);
  assert.equal(plan.alt[0].kimlik, 'light.lamba_8');
});

test('tepsi sayacı: sabitleme kaldırılınca sayaç eski sırasına döner; birden çok sabitlenen kendi favori sırasıyla öne gelir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  tepsiKutusu(sayfa, 'light.lamba_9').tikla();
  tepsiKutusu(sayfa, 'light.lamba_5').tikla();
  assert.equal(konumMetni(sayfa, 'Lamba 5'), 'Tepsi menüsünde (1/8)', 'sabitlenenler favori sırasıyla: 5, sonra 9');
  assert.equal(konumMetni(sayfa, 'Lamba 9'), 'Tepsi menüsünde (2/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 1'), 'Tepsi menüsünde (3/8)');
  tepsiKutusu(sayfa, 'light.lamba_9').tikla();
  tepsiKutusu(sayfa, 'light.lamba_5').tikla();
  assert.equal(konumMetni(sayfa, 'Lamba 1'), 'Tepsi menüsünde (1/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 9'), 'Diğer favoriler altında');
});

test('tepsi sayacı: kayıtlı (tepsi:true) favori sayfa açılışında da öne alınır; onaylı ve tek tıklamasız karolar sayaca girmez', async () => {
  const ayar = { ...AYAR, favoriler: AYAR.favoriler.map((f) => (f.entity_id === 'light.lamba_3' ? { ...f, tepsi: true } : f)) };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR });
  assert.equal(konumMetni(sayfa, 'Lamba 3'), 'Tepsi menüsünde (1/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 1'), 'Tepsi menüsünde (2/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 2'), 'Tepsi menüsünde (3/8)');
  assert.equal(konumMetni(sayfa, 'Lamba 4'), 'Tepsi menüsünde (4/8)');

  // klima gibi tek tıklama eylemi olmayan karo, sabitlenmiş görünse bile sayaca girmez
  const klima = { entity_id: 'climate.salon', ad: 'Salon klima', alan: 'climate', alanEtiketi: 'İklim', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, tekTiklama: false, gizli: false };
  const ayar2 = { ...AYAR, favoriler: [{ entity_id: 'climate.salon', ad: 'Salon klima', tepsi: true }, ...AYAR.favoriler] };
  const sayfa2 = await acilmisSayfa({ ayar: ayar2, cihazlar: { ...CIHAZLAR, cihazlar: [klima, ...CIHAZLAR.cihazlar] } });
  assert.equal(konumMetni(sayfa2, 'Salon klima'), 'Yalnız panel ve palette');
  assert.equal(konumMetni(sayfa2, 'Lamba 1'), 'Tepsi menüsünde (1/8)');
});
