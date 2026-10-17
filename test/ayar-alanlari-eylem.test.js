'use strict';

/**
 * 1.4.0 eylem grubunun ayar satırları (src/lib/ayar-alanlari.js AYAR_ALANLARI): o-17 etkinlikGecmisi, o-12 geriAl / geriAlSureDk /
 * geriAlKisayolu. Gerçek tablo kullanılır; böylece doğrulama, eski dosyadan yükselme ve dışa aktarma kapsamı uçtan uca denenir.
 * Şema sürümü ARTMAZ (6): alanlar varsayılanlarla eklenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AKTARILAN_ALANLAR } = require('../src/lib/ayar-yedegi');
const { TR } = require('../src/lib/ceviri-varsayilan');

const ALANLAR = ['etkinlikGecmisi', 'geriAl', 'geriAlSureDk', 'geriAlKisayolu', 'gecikmeliEylem', 'sonDegisenler'];
const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const duzelt = (ad, ham) => alan(ad).duzelt(ham);

test('eylem grubu satırları kayıtlı; varsayılanlar: geçmiş açık, geri al açık, 10 dk, Control+Alt+Z; şema sürümü artmaz', () => {
  for (const ad of ALANLAR) assert.ok(alan(ad), ad);
  assert.deepEqual(Object.fromEntries(ALANLAR.map((ad) => [ad, alan(ad).varsayilan])), { etkinlikGecmisi: true, geriAl: true, geriAlSureDk: 10, geriAlKisayolu: 'Control+Alt+Z', gecikmeliEylem: true, sonDegisenler: true });
  assert.equal(A.VARSAYILAN_GERI_AL_KISAYOLU, 'Control+Alt+Z');
  assert.equal(A.GUNCEL_EK_SURUM, 6, 'şema sürümünü yalnız birleştirme ajanı artırır');
  assert.equal(new Set(A.AYAR_ALANLARI.map((a) => a.ad)).size, A.AYAR_ALANLARI.length, 'çift ad yok');
  for (const ad of ALANLAR) assert.ok(AKTARILAN_ALANLAR.includes(ad), `${ad}: taşınabilir tercih, dışa aktarılır`);
});

test('mantıksal alanlar yalnız true/false kabul eder', () => {
  for (const ad of ['etkinlikGecmisi', 'geriAl', 'gecikmeliEylem', 'sonDegisenler']) {
    assert.equal(duzelt(ad, true), true);
    assert.equal(duzelt(ad, false), false);
    for (const kotu of ['true', 1, 0, null, undefined, {}, []]) assert.equal(duzelt(ad, kotu), undefined, `${ad}: ${JSON.stringify(kotu)}`);
  }
});

test('geriAlSureDk: 1-60 tamsayı (metin sayı da olur); sınır dışı, kesirli ve sayı olmayan değer reddedilir', () => {
  for (const iyi of [1, 10, 60, '15', ' 30 ']) assert.equal(duzelt('geriAlSureDk', iyi), Number(iyi), String(iyi));
  for (const kotu of [0, 61, -1, 1.5, '', 'abc', null, undefined, {}, [5], NaN, Infinity]) assert.equal(duzelt('geriAlSureDk', kotu), undefined, JSON.stringify(kotu));
});

test('geriAlKisayolu: boş = kısayol yok; yazım normalleştirilir; Windows\'a ayrılmış, biçimsiz ve metin olmayan değer reddedilir', () => {
  assert.equal(duzelt('geriAlKisayolu', ''), '');
  assert.equal(duzelt('geriAlKisayolu', '   '), '');
  assert.equal(duzelt('geriAlKisayolu', 'Control+Alt+Z'), 'Control+Alt+Z');
  assert.equal(duzelt('geriAlKisayolu', 'ctrl alt j'), 'Control+Alt+J');
  assert.equal(duzelt('geriAlKisayolu', 'Ctrl+Shift+F5'), 'Control+Shift+F5');
  for (const kotu of ['Alt+F4', 'Control+C', 'Control+Alt+Delete', 'z', 'Control+', 'Control+Alt+AltGr', 'Control+Alt+Z+X', 5, null, {}, [], 'x'.repeat(200)]) {
    assert.equal(duzelt('geriAlKisayolu', kotu), undefined, JSON.stringify(kotu).slice(0, 40));
  }
  assert.equal(A.geriAlKisayoluDuzelt('Control+Alt+Z'), 'Control+Alt+Z');
  assert.equal(A.geriAlKisayoluDuzelt(undefined), undefined);
});

test('ayarlariDuzelt (uçtan uca): eski dosya (geri al alanları yok) varsayılanlarla yükselir ve favoriler değişmez; geçersiz değer varsayılana düşer', () => {
  const favoriler = [{ entity_id: 'light.salon', ad: 'Salon' }];
  for (const surum of [4, 5, 6]) {
    const eski = ayarlariDuzelt({ semaSurumu: surum, favoriler, yerelAdres: 'http://192.168.1.10:8123' }, { varsayilan: {} }).ayarlar;
    for (const ad of ALANLAR) assert.deepEqual(eski[ad], alan(ad).varsayilan, `${surum}: ${ad}`);
    assert.deepEqual(eski.favoriler.map((f) => f.entity_id), ['light.salon']);
  }
  const yeni = ayarlariDuzelt({ semaSurumu: 6, favoriler, geriAl: false, geriAlSureDk: 99, geriAlKisayolu: 'Alt+F4', gecikmeliEylem: false, sonDegisenler: false }, { varsayilan: {} }).ayarlar;
  assert.equal(yeni.geriAl, false);
  assert.equal(yeni.gecikmeliEylem, false);
  assert.equal(yeni.sonDegisenler, false);
  assert.equal(yeni.geriAlSureDk, 10, 'aralık dışı değer varsayılana');
  assert.equal(yeni.geriAlKisayolu, 'Control+Alt+Z', 'ayrılmış kısayol varsayılana');
  const kapali = ayarlariDuzelt({ semaSurumu: 6, favoriler, geriAlKisayolu: '' }, { varsayilan: {} }).ayarlar;
  assert.equal(kapali.geriAlKisayolu, '', 'kullanıcı kısayolu bilerek kapattıysa korunur');
});

test('ekGirdiDogrula: geçersiz eylem alanları mevcut değeri korur ve alan adıyla uyarı verir; ekAyarlariUygula yalnız değişenleri bildirir', () => {
  const { yeni, uyarilar } = A.ekGirdiDogrula({ geriAl: false, geriAlSureDk: '25', geriAlKisayolu: 'Alt+F4', etkinlikGecmisi: 'evet', gecikmeliEylem: 1, sonDegisenler: 'hayır' }, TR);
  assert.deepEqual(yeni, { geriAl: false, geriAlSureDk: 25 });
  assert.deepEqual(uyarilar.map((u) => u.alan).sort(), ['etkinlikGecmisi', 'gecikmeliEylem', 'geriAlKisayolu', 'sonDegisenler']);
  const ayarlar = { geriAl: true, geriAlSureDk: 10, geriAlKisayolu: 'Control+Alt+Z' };
  const degisenler = A.ekAyarlariUygula(ayarlar, { geriAl: false, geriAlSureDk: 10, geriAlKisayolu: 'Control+Alt+Z' });
  assert.deepEqual(degisenler.map((d) => d.ad), ['geriAl']);
  assert.equal(ayarlar.geriAl, false);
  assert.deepEqual(A.ekAyarOzeti({ geriAlSureDk: 5 }).geriAlSureDk, 5);
  assert.equal(A.ekAyarOzeti({}).geriAlKisayolu, 'Control+Alt+Z', 'özette yoksa varsayılan');
});

test('panelGruplama (o-14): yalnız "tur" ve "oda" kabul edilir, varsayılan "tur"; eski dosya varsayılanla yükselir; taşınabilir tercih olarak dışa aktarılır', () => {
  assert.equal(alan('panelGruplama').varsayilan, 'tur');
  assert.equal(duzelt('panelGruplama', 'tur'), 'tur');
  assert.equal(duzelt('panelGruplama', 'oda'), 'oda');
  for (const kotu of ['Oda', 'room', '', ' oda', 1, true, null, undefined, {}, ['oda']]) assert.equal(duzelt('panelGruplama', kotu), undefined, JSON.stringify(kotu));
  assert.ok(AKTARILAN_ALANLAR.includes('panelGruplama'));
  assert.equal(A.GUNCEL_EK_SURUM, 6, 'şema sürümü artmaz');
  const eski = ayarlariDuzelt({ semaSurumu: 5, favoriler: [] }, { varsayilan: {} }).ayarlar;
  assert.equal(eski.panelGruplama, 'tur');
  assert.equal(ayarlariDuzelt({ semaSurumu: 6, favoriler: [], panelGruplama: 'oda' }, { varsayilan: {} }).ayarlar.panelGruplama, 'oda');
  assert.equal(ayarlariDuzelt({ semaSurumu: 6, favoriler: [], panelGruplama: 'ev' }, { varsayilan: {} }).ayarlar.panelGruplama, 'tur', 'geçersiz değer varsayılana düşer');
  const { yeni, uyarilar } = A.ekGirdiDogrula({ panelGruplama: 'oda' }, TR);
  assert.deepEqual(yeni, { panelGruplama: 'oda' });
  assert.deepEqual(uyarilar, []);
  const kotu = A.ekGirdiDogrula({ panelGruplama: 'x' }, TR);
  assert.deepEqual(kotu.yeni, {});
  assert.deepEqual(kotu.uyarilar.map((u) => u.alan), ['panelGruplama']);
});

test('paletDigerCihazlar (o-46): mantıksal, varsayılan KAPALI (palet yalnız favorileri arar kuralını gevşettiği için); eski dosya varsayılanla yükselir; taşınabilir tercih olarak dışa aktarılır', () => {
  assert.equal(alan('paletDigerCihazlar').varsayilan, false);
  assert.equal(duzelt('paletDigerCihazlar', true), true);
  assert.equal(duzelt('paletDigerCihazlar', false), false);
  for (const kotu of ['true', 'evet', 1, 0, null, undefined, {}, []]) assert.equal(duzelt('paletDigerCihazlar', kotu), undefined, JSON.stringify(kotu));
  assert.ok(AKTARILAN_ALANLAR.includes('paletDigerCihazlar'));
  assert.equal(A.GUNCEL_EK_SURUM, 6, 'şema sürümü artmaz');
  assert.equal(ayarlariDuzelt({ semaSurumu: 5, favoriler: [] }, { varsayilan: {} }).ayarlar.paletDigerCihazlar, false);
  assert.equal(ayarlariDuzelt({ semaSurumu: 6, favoriler: [], paletDigerCihazlar: true }, { varsayilan: {} }).ayarlar.paletDigerCihazlar, true);
  assert.equal(ayarlariDuzelt({ semaSurumu: 6, favoriler: [], paletDigerCihazlar: 'evet' }, { varsayilan: {} }).ayarlar.paletDigerCihazlar, false, 'geçersiz değer varsayılana (kapalı) düşer');
  const { yeni, uyarilar } = A.ekGirdiDogrula({ paletDigerCihazlar: true }, TR);
  assert.deepEqual(yeni, { paletDigerCihazlar: true });
  assert.deepEqual(uyarilar, []);
  const kotu = A.ekGirdiDogrula({ paletDigerCihazlar: 'x' }, TR);
  assert.deepEqual(kotu.yeni, {});
  assert.deepEqual(kotu.uyarilar.map((u) => u.alan), ['paletDigerCihazlar']);
});
