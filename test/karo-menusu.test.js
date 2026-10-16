'use strict';

/**
 * Karo bağlam menüsü (src/lib/karo-menusu.js; o-16): plan YALNIZ düzenle / tepsi / sayfa / kaldır öğelerini içerir. Menüde HA'ya
 * eylem gönderen hiçbir öğe yoktur; yıkıcı eylemin basılı tutma onayı menüden değil panelden verilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karoMenuPlani, karoMenuIslemi } = require('../src/lib/karo-menusu');
const { EN } = { EN: require('../src/lib/ceviri/ana').en };
const { Dil } = { Dil: require('../src/lib/dil') };

const fav = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: kimlik, ...ek });
const sayfa = (id, ad, varliklar) => ({ id, ad, varliklar });
const kimlikler = (plan) => plan.flatMap((o) => (o.alt ? [o.id, ...o.alt.map((a) => a.id)] : o.id ? [o.id] : []));

test('plan: düzenle, tepsi, (sayfa varsa) sayfaya ekle, ayraç, kaldır — başka öğe yok', () => {
  const plan = karoMenuPlani({ karo: { id: 'light.a', sinif: 'zararsiz' }, favori: fav('light.a'), sayfalar: [] });
  assert.deepEqual(kimlikler(plan), ['duzenle', 'tepsi', 'kaldir']);
  assert.equal(plan[2].tur, 'ayirac');
  const sayfali = karoMenuPlani({ karo: { id: 'light.a' }, favori: fav('light.a'), sayfalar: [sayfa('aaa', 'A', ['light.a']), sayfa('bbb', '', [])] });
  assert.deepEqual(kimlikler(sayfali), ['duzenle', 'tepsi', 'sayfalar', 'sayfa:aaa', 'sayfa:bbb', 'kaldir']);
  const alt = sayfali.find((o) => o.id === 'sayfalar').alt;
  assert.deepEqual(alt.map((a) => a.checked), [true, false], 'üyelik işaretli');
  assert.equal(alt[1].label, 'Sayfa 2', 'adsız sayfa sıra numarasıyla');
  assert.ok(alt.every((a) => a.tur === 'checkbox'));
});

test('plan: tek tıklama eylemi olmayan karoda (klima, medya) tepsi öğesi yok; sayfa ve kaldır öğeleri durur', () => {
  const klima = karoMenuPlani({ karo: { id: 'climate.salon', sinif: 'zararsiz', varsayilanEylem: false }, favori: fav('climate.salon'), sayfalar: [sayfa('aaa', 'A', [])] });
  assert.deepEqual(kimlikler(klima), ['duzenle', 'sayfalar', 'sayfa:aaa', 'kaldir']);
  const isik = karoMenuPlani({ karo: { id: 'light.a', sinif: 'zararsiz', varsayilanEylem: true }, favori: fav('light.a'), sayfalar: [] });
  assert.deepEqual(kimlikler(isik), ['duzenle', 'tepsi', 'kaldir']);
});

test('plan: tepsi etiketi duruma göre; yıkıcı karoda tepsi öğesi yok; favori değilse plan boş', () => {
  const sabit = karoMenuPlani({ karo: { id: 'light.a' }, favori: fav('light.a', { tepsi: true }), sayfalar: [] });
  assert.equal(sabit.find((o) => o.id === 'tepsi').label, 'Tepsiden kaldır');
  const degil = karoMenuPlani({ karo: { id: 'light.a' }, favori: fav('light.a'), sayfalar: [] });
  assert.equal(degil.find((o) => o.id === 'tepsi').label, 'Tepsiye ekle');
  const yikici = karoMenuPlani({ karo: { id: 'button.pc_bilgisayari_kapat', sinif: 'yikici' }, favori: fav('button.pc_bilgisayari_kapat'), sayfalar: [] });
  assert.deepEqual(kimlikler(yikici), ['duzenle', 'kaldir']);
  assert.deepEqual(karoMenuPlani({ karo: { id: 'light.a' }, favori: undefined }), []);
  assert.deepEqual(karoMenuPlani({ karo: { id: 'light.a' }, favori: fav('light.b') }), [], 'karo ile favori eşleşmeli');
  assert.deepEqual(karoMenuPlani({ karo: null, favori: fav('light.a') }), []);
});

test('plan: İngilizce etiketler çevirmenle gelir, Türkçe karakter içermez', () => {
  const t = Dil.cevirmen('en', { en: EN });
  const plan = karoMenuPlani({ karo: { id: 'light.a' }, favori: fav('light.a'), sayfalar: [sayfa('aaa', '', [])], t });
  const etiketler = plan.flatMap((o) => [o.label, ...(o.alt ?? []).map((a) => a.label)]).filter(Boolean);
  assert.ok(etiketler.length >= 4);
  for (const e of etiketler) assert.doesNotMatch(e, /[çğıöşüÇĞİÖŞÜ]/, e);
  assert.ok(etiketler.includes('Edit…') && etiketler.includes('Page 1'));
});

test('işlem: duzenle ayarı değiştirmez; tepsi / sayfa / kaldır yeni liste üretir ve girdiyi bozmaz', () => {
  const favoriler = [fav('light.a'), fav('light.b', { tepsi: true })];
  const sayfalar = [sayfa('aaa', 'A', ['light.a', 'light.b'])];
  const once = JSON.stringify([favoriler, sayfalar]);
  assert.deepEqual(karoMenuIslemi({ islem: 'duzenle', kimlik: 'light.a', favoriler, sayfalar }), { tur: 'duzenle' });
  const t = karoMenuIslemi({ islem: 'tepsi', kimlik: 'light.a', favoriler, sayfalar });
  assert.equal(t.tur, 'degisti');
  assert.equal(t.neden, 'menu-tepsi');
  assert.equal(t.favoriler[0].tepsi, true);
  const t2 = karoMenuIslemi({ islem: 'tepsi', kimlik: 'light.b', favoriler, sayfalar });
  assert.equal('tepsi' in t2.favoriler[1], false);
  const s = karoMenuIslemi({ islem: 'sayfa:aaa', kimlik: 'light.a', favoriler, sayfalar });
  assert.equal(s.neden, 'menu-sayfa');
  assert.deepEqual(s.sayfalar[0].varliklar, ['light.b']);
  const k = karoMenuIslemi({ islem: 'kaldir', kimlik: 'light.a', favoriler, sayfalar });
  assert.equal(k.neden, 'menu-kaldir');
  assert.deepEqual(k.favoriler.map((f) => f.entity_id), ['light.b']);
  assert.deepEqual(k.sayfalar[0].varliklar, ['light.b']);
  assert.equal(JSON.stringify([favoriler, sayfalar]), once);
});

test('işlem: tanınmayan işlem, favori olmayan kimlik, olmayan sayfa ve değişiklik olmayan durum "yok" döner (HA çağrısı yapılamaz)', () => {
  const favoriler = [fav('light.a')];
  const sayfalar = [sayfa('aaa', 'A', [])];
  for (const islem of ['eylem', 'calistir', 'servis:light.turn_on', 'sayfa:', 'sayfa:../x', 'sayfa:A!', '', null, 5, { islem: 'tepsi' }, 'kapat']) {
    assert.deepEqual(karoMenuIslemi({ islem, kimlik: 'light.a', favoriler, sayfalar }), { tur: 'yok' }, JSON.stringify(islem));
  }
  assert.deepEqual(karoMenuIslemi({ islem: 'tepsi', kimlik: 'light.baska', favoriler, sayfalar }), { tur: 'yok' });
  assert.deepEqual(karoMenuIslemi({ islem: 'sayfa:zzz', kimlik: 'light.a', favoriler, sayfalar }), { tur: 'yok' }, 'sayfa yok');
  assert.deepEqual(karoMenuIslemi({ islem: 'tepsi', kimlik: 5, favoriler, sayfalar }), { tur: 'yok' });
  assert.deepEqual(karoMenuIslemi({ islem: 'tepsi', kimlik: 'light.a', favoriler: null, sayfalar }), { tur: 'yok' });
});
