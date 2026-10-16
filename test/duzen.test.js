'use strict';

/**
 * Düzen değişiklikleri (src/lib/duzen.js; o-16, o-28, o-30): tepsiye sabitleme, favori kaldırma, sayfa üyeliği, kullanılamayan
 * favoriyi onarma ve geçmiş noktasını yeniden doğrulama. Saf işlevler; hiçbiri girdiyi değiştirmez ve hiçbiri yeni bir eylem yolu açmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/lib/duzen');

const fav = (kimlik, ad, ek = {}) => ({ entity_id: kimlik, ad, ...ek });
const sayfa = (id, ad, varliklar) => ({ id, ad, varliklar });
const FAVORILER = () => [fav('light.salon', 'Salon', { kisayol: 'Control+Alt+1', etiket: 'Salon lambası', simge: '💡', renk: 'sari', boyut: 'genis', tepsi: true, parlaklik: true }), fav('scene.film', 'Film'), fav('button.pc_bilgisayari_kapat', 'PC kapat', { onay: true })];
const SAYFALAR = () => [sayfa('aaa', 'A', ['light.salon', 'scene.film']), sayfa('bbb', 'B', ['light.salon'])];

test('tepsiDegistir: açar, kapatır, tersine çevirir; olmayan kimlik değişiklik yapmaz; girdi bozulmaz', () => {
  const f = FAVORILER();
  const once = JSON.stringify(f);
  const ac = D.tepsiDegistir(f, 'scene.film');
  assert.equal(ac.degisti, true);
  assert.equal(ac.deger, true);
  assert.equal(ac.favoriler[1].tepsi, true);
  const kapat = D.tepsiDegistir(f, 'light.salon');
  assert.equal(kapat.deger, false);
  assert.equal('tepsi' in kapat.favoriler[0], false, 'kapalı hâl kayda yazılmaz');
  assert.equal(D.tepsiDegistir(f, 'light.salon', true).degisti, false, 'zaten açık');
  assert.equal(D.tepsiDegistir(f, 'scene.film', false).degisti, false, 'zaten kapalı');
  assert.equal(D.tepsiDegistir(f, 'light.yok').degisti, false);
  assert.equal(JSON.stringify(f), once);
});

test('favoriyiKaldir: favori listeden ve bütün sayfalardan çıkar; olmayan kimlik değişiklik yapmaz', () => {
  const k = D.favoriyiKaldir(FAVORILER(), SAYFALAR(), 'light.salon');
  assert.equal(k.degisti, true);
  assert.deepEqual(k.favoriler.map((f) => f.entity_id), ['scene.film', 'button.pc_bilgisayari_kapat']);
  assert.deepEqual(k.sayfalar.map((s) => s.varliklar), [['scene.film'], []]);
  const yok = D.favoriyiKaldir(FAVORILER(), SAYFALAR(), 'light.yok');
  assert.equal(yok.degisti, false);
  assert.equal(yok.favoriler.length, 3);
  assert.deepEqual(D.favoriyiKaldir(null, null, 'x'), { favoriler: [], sayfalar: [], degisti: false });
});

test('sayfaUyeliginiDegistir: yalnız favori olan kimlik girer; ekle verilmezse tersine çevirir', () => {
  const ekle = D.sayfaUyeliginiDegistir(SAYFALAR(), FAVORILER(), 'bbb', 'scene.film');
  assert.equal(ekle.degisti, true);
  assert.equal(ekle.uye, true);
  assert.deepEqual(ekle.sayfalar[1].varliklar, ['light.salon', 'scene.film']);
  const cikar = D.sayfaUyeliginiDegistir(SAYFALAR(), FAVORILER(), 'aaa', 'scene.film');
  assert.equal(cikar.uye, false);
  assert.deepEqual(cikar.sayfalar[0].varliklar, ['light.salon']);
  assert.equal(D.sayfaUyeliginiDegistir(SAYFALAR(), FAVORILER(), 'aaa', 'light.salon', true).degisti, false);
  assert.equal(D.sayfaUyeliginiDegistir(SAYFALAR(), FAVORILER(), 'aaa', 'light.baska', true).degisti, false, 'favori değil: eklenmez');
  assert.equal(D.sayfaUyeliginiDegistir(SAYFALAR(), FAVORILER(), 'yok', 'scene.film', true).degisti, false);
});

test('favoriyiOnar: ayarlar ve sayfa üyelikleri yeni kimliğe taşınır; sıra korunur', () => {
  const s = D.favoriyiOnar({ favoriler: FAVORILER(), sayfalar: SAYFALAR(), eski: 'light.salon', yeni: 'light.salon_yeni', yeniAd: 'Salon (yeni)' });
  assert.equal(s.ok, true);
  assert.deepEqual(s.favoriler.map((f) => f.entity_id), ['light.salon_yeni', 'scene.film', 'button.pc_bilgisayari_kapat'], 'sıra aynı');
  assert.deepEqual(s.favoriler[0], { entity_id: 'light.salon_yeni', ad: 'Salon (yeni)', kisayol: 'Control+Alt+1', etiket: 'Salon lambası', simge: '💡', renk: 'sari', boyut: 'genis', tepsi: true, parlaklik: true });
  assert.deepEqual(s.sayfalar.map((x) => x.varliklar), [['light.salon_yeni', 'scene.film'], ['light.salon_yeni']]);
});

test('favoriyiOnar: reddedilen durumlar', () => {
  const dene = (ek) => D.favoriyiOnar({ favoriler: FAVORILER(), sayfalar: SAYFALAR(), eski: 'light.salon', yeni: 'light.yeni', yeniAd: 'Yeni', ...ek });
  assert.equal(dene({ eski: 'light.baska' }).neden, 'kayitsiz');
  assert.equal(dene({ yeni: 'light.salon' }).neden, 'gecersiz', 'aynı kimlik');
  assert.equal(dene({ yeni: 5 }).neden, 'gecersiz');
  assert.equal(dene({ eski: 5 }).neden, 'gecersiz');
  assert.equal(dene({ yeni: 'scene.film' }).neden, 'zaten-var');
  assert.equal(dene({ yeni: 'switch.priz' }).neden, 'alan', 'farklı alan');
  assert.equal(dene({ yeniAd: 'Kapı lambası' }).neden, 'guvenlik', 'yeni ad kapı kuralına takılır');
  assert.equal(dene({ yeni: 'light.garaj_kapisi' }).neden, 'guvenlik', 'yeni kimlik kapı kuralına takılır');
  assert.equal(dene({ yeni: 'light.kapi_isigi', yeniAd: 'Işık' }).neden, 'guvenlik');
});

test('favoriyiOnar: kısayol yeni varlıkta da zararsız eylem kuralından geçer; yıkıcı eyleme onay korunur', () => {
  // yıkıcı bir düğme onarılırsa onay zorunluluğu (onayiDuzelt) yeni kayıtta da sürer
  const f = [fav('button.pc_bilgisayari_kapat', 'PC kapat', { onay: true })];
  const s = D.favoriyiOnar({ favoriler: f, sayfalar: [], eski: 'button.pc_bilgisayari_kapat', yeni: 'button.pc_kapat_yeni', yeniAd: 'PC kapat' });
  assert.equal(s.ok, true);
  assert.equal(s.favoriler[0].entity_id, 'button.pc_kapat_yeni');
  assert.equal(s.favoriler[0].onay, true);
});

test('duzeniDogrula: geçmiş noktası şemadan yeniden geçer — kapı/kilit favorisi, geçersiz alan, yinelenen ve favori olmayan sayfa varlığı elenir', () => {
  const anlik = {
    favoriler: [fav('light.salon', 'Salon'), fav('lock.on_kapi', 'Ön kapı'), fav('cover.perde', 'Perde'), fav('light.salon', 'Yinelenen'), fav('light.kapi_isigi', 'Kapı ışığı'), fav('camera.x', 'Kamera'), 'sacma'],
    sayfalar: [sayfa('aaa', 'Garaj kapısı', ['light.salon', 'lock.on_kapi', 'scene.baska'])],
  };
  const d = D.duzeniDogrula(anlik);
  assert.deepEqual(d.favoriler.map((f) => f.entity_id), ['light.salon']);
  assert.deepEqual(d.sayfalar, [sayfa('aaa', '', ['light.salon'])]);
  assert.ok(d.atilanlar.length >= 4);
  assert.deepEqual(D.duzeniDogrula(null), { favoriler: [], sayfalar: [], atilanlar: [] });
});
