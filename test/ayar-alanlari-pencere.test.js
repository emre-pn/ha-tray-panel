'use strict';

/**
 * 1.4.0 pencere grubunun ayar satırları (src/lib/ayar-alanlari.js AYAR_ALANLARI): o-22 panelHerZamanUstte, o-32 pencereKonumu /
 * pencereKonumlari / tercihEkran / panelOpaklik, o-27 tepsiRozeti / tepsiRozetSensoru, o-33 masaustuKarolari / masaustuKaroKonumlari /
 * masaustuKaroUstte. Gerçek tablo kullanılır; böylece doğrulama, dışa aktarma kapsamı ve Kapı Kuralı uçtan uca denenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AKTARILAN_ALANLAR, ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');
const { TR } = require('../src/lib/ceviri-varsayilan');

const ALANLAR = ['panelHerZamanUstte', 'pencereKonumu', 'pencereKonumlari', 'tercihEkran', 'panelOpaklik', 'tepsiRozeti', 'tepsiRozetSensoru', 'masaustuKarolari', 'masaustuKaroKonumlari', 'masaustuKaroUstte'];
const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const duzelt = (ad, ham) => alan(ad).duzelt(ham);
const SINIR = { x: 100, y: 200, width: 176, height: 112 };

test('pencere grubunun 10 satırı kayıtlı ve her biri tanımlı; tüm varsayılanlar KAPALI/eski davranış (hiçbir özellik kendiliğinden açılmaz)', () => {
  for (const ad of ALANLAR) assert.ok(alan(ad), ad);
  const varsayilanlar = Object.fromEntries(ALANLAR.map((ad) => [ad, alan(ad).varsayilan]));
  assert.deepEqual(varsayilanlar, {
    panelHerZamanUstte: false,
    pencereKonumu: 'imlec',
    pencereKonumlari: {},
    tercihEkran: {},
    panelOpaklik: 100,
    tepsiRozeti: 'kapali',
    tepsiRozetSensoru: '',
    masaustuKarolari: [],
    masaustuKaroKonumlari: {},
    masaustuKaroUstte: false,
  });
  assert.equal(new Set(A.AYAR_ALANLARI.map((a) => a.ad)).size, A.AYAR_ALANLARI.length, 'çift ad yok');
});

test('makineye özgü konumlar dışa aktarılmaz (ve özette yok); taşınabilir tercihler aktarılır', () => {
  for (const ad of ['pencereKonumlari', 'tercihEkran', 'masaustuKaroKonumlari']) {
    assert.equal(alan(ad).aktarilir, false, `${ad} aktarılmaz`);
    assert.equal(AKTARILAN_ALANLAR.includes(ad), false, ad);
  }
  assert.equal(alan('pencereKonumlari').ozette, false);
  assert.equal(alan('masaustuKaroKonumlari').ozette, false);
  for (const ad of ['panelHerZamanUstte', 'pencereKonumu', 'panelOpaklik', 'tepsiRozeti', 'tepsiRozetSensoru', 'masaustuKarolari', 'masaustuKaroUstte']) {
    assert.equal(alan(ad).aktarilir, true, `${ad} aktarılır`);
    assert.equal(AKTARILAN_ALANLAR.includes(ad), true, ad);
  }
});

test('mantıksal alanlar yalnız true/false kabul eder', () => {
  for (const ad of ['panelHerZamanUstte', 'masaustuKaroUstte']) {
    assert.equal(duzelt(ad, true), true);
    assert.equal(duzelt(ad, false), false);
    for (const kotu of ['true', 1, 0, null, undefined, {}, []]) assert.equal(duzelt(ad, kotu), undefined, `${ad}: ${JSON.stringify(kotu)}`);
  }
});

test('pencereKonumu: imlec | hatirla; başka değer reddedilir', () => {
  assert.equal(duzelt('pencereKonumu', 'imlec'), 'imlec');
  assert.equal(duzelt('pencereKonumu', 'hatirla'), 'hatirla');
  for (const kotu of ['Hatirla', 'sabit', '', null, 1, {}]) assert.equal(duzelt('pencereKonumu', kotu), undefined, JSON.stringify(kotu));
});

test('panelOpaklik: 50..100 tam sayı ("70" de olur); aralık dışı, ondalık ve sayı olmayan reddedilir', () => {
  assert.equal(duzelt('panelOpaklik', 50), 50);
  assert.equal(duzelt('panelOpaklik', 100), 100);
  assert.equal(duzelt('panelOpaklik', '70'), 70);
  for (const kotu of [49, 101, 0, -10, 70.5, NaN, Infinity, '', 'a', null, {}, [70]]) assert.equal(duzelt('panelOpaklik', kotu), undefined, JSON.stringify(kotu));
});

test('tepsiRozeti: kapali | isik | sensor; başka değer reddedilir', () => {
  for (const d of ['kapali', 'isik', 'sensor']) assert.equal(duzelt('tepsiRozeti', d), d);
  for (const kotu of ['acik', 'Isik', '', null, true, 1]) assert.equal(duzelt('tepsiRozeti', kotu), undefined, JSON.stringify(kotu));
});

test('tepsiRozetSensoru: yalnız sensör alanındaki, kapı kuralından geçen kimlik ya da boş; kapı/kilit/alarm ve başka alanlar yazılamaz', () => {
  assert.equal(duzelt('tepsiRozetSensoru', 'sensor.salon_sicaklik'), 'sensor.salon_sicaklik');
  assert.equal(duzelt('tepsiRozetSensoru', ''), '');
  for (const kotu of [
    'light.salon', 'binary_sensor.hareket', 'lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'camera.bahce', 'sensor.kapi_sicakligi', 'sensor.garaj_nem', 'sensor.front_door',
    'sensor.', 'Sensor.x', 'sensor.x y', 'sensor.x;y', 'sensor.a'.repeat(30), null, undefined, 5, {}, ['sensor.x'],
  ]) {
    assert.equal(duzelt('tepsiRozetSensoru', kotu), undefined, JSON.stringify(kotu));
  }
});

test('masaustuKarolari: sabitlenebilir alandaki, kapı kuralından geçen, tekrarsız kimlikler; en çok 6; dizi değilse reddedilir', () => {
  assert.deepEqual(
    duzelt('masaustuKarolari', ['light.salon', 'lock.on_kapi', 'cover.garaj', 'switch.kapi_rolesi', 'light.salon', 'sensor.sicaklik', 'script.x', 'alarm_control_panel.ev', 'camera.k', 'binary_sensor.hareket', 'media_player.tv', 'scene.film']),
    ['light.salon', 'sensor.sicaklik', 'binary_sensor.hareket', 'scene.film'],
  );
  const cok = Array.from({ length: 12 }, (_, i) => `light.l${i}`);
  assert.deepEqual(duzelt('masaustuKarolari', cok), cok.slice(0, 6));
  assert.deepEqual(duzelt('masaustuKarolari', []), []);
  for (const kotu of ['light.salon', null, undefined, {}, 5]) assert.equal(duzelt('masaustuKarolari', kotu), undefined, JSON.stringify(kotu));
});

test('masaustuKaroKonumlari: geçerli kayıtlar korunur; kapı kimliği, sabitlenemeyen alan ve bozuk sınır atılır; nesne değilse reddedilir', () => {
  assert.deepEqual(
    duzelt('masaustuKaroKonumlari', { 'light.salon': SINIR, 'lock.on_kapi': SINIR, 'cover.garaj': SINIR, 'light.kapi': SINIR, 'switch.priz': { x: 'a' }, 'sensor.s': { ...SINIR, ek: 1 } }),
    { 'light.salon': SINIR, 'sensor.s': SINIR },
  );
  for (const kotu of [null, undefined, [], 'x', 5]) assert.equal(duzelt('masaustuKaroKonumlari', kotu), undefined, JSON.stringify(kotu));
});

test('pencereKonumlari ve tercihEkran: biçim doğrulanır, geçersiz değer reddedilir', () => {
  assert.deepEqual(duzelt('pencereKonumlari', { hizli: { x: -1280, y: 10 }, genis: { x: 'a', y: 0 }, baska: { x: 1, y: 1 } }), { hizli: { x: -1280, y: 10 } });
  assert.deepEqual(duzelt('pencereKonumlari', {}), {});
  for (const kotu of [null, [], 'x', 5]) assert.equal(duzelt('pencereKonumlari', kotu), undefined, JSON.stringify(kotu));
  const ekran = { id: 3, x: -1280, y: 0, genislik: 1280, yukseklik: 1024 };
  assert.deepEqual(duzelt('tercihEkran', ekran), ekran);
  assert.deepEqual(duzelt('tercihEkran', {}), {});
  for (const kotu of [null, [], 'x', 5, { id: 'a', x: 0, y: 0, genislik: 1, yukseklik: 1 }, { id: 1, x: 0, y: 0, genislik: 0, yukseklik: 1 }, { id: 1 }]) assert.equal(duzelt('tercihEkran', kotu), undefined, JSON.stringify(kotu));
});

test('alanlariDuzelt: eksik ya da bozuk değerler varsayılana düşer, geçerli olanlar korunur; çıktı kopyadır', () => {
  const sonuc = A.alanlariDuzelt({ panelOpaklik: 80, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'light.x', masaustuKarolari: ['light.a', 'lock.b'], pencereKonumu: 'hatirla', masaustuKaroUstte: 'evet' }, {});
  assert.equal(sonuc.panelOpaklik, 80);
  assert.equal(sonuc.tepsiRozeti, 'sensor');
  assert.equal(sonuc.tepsiRozetSensoru, '', 'geçersiz sensör varsayılana');
  assert.deepEqual(sonuc.masaustuKarolari, ['light.a']);
  assert.equal(sonuc.pencereKonumu, 'hatirla');
  assert.equal(sonuc.masaustuKaroUstte, false);
  assert.equal(sonuc.panelHerZamanUstte, false);
  assert.deepEqual(sonuc.pencereKonumlari, {});
  assert.notEqual(A.alanlariDuzelt({}, {}).masaustuKarolari, alan('masaustuKarolari').varsayilan, 'varsayılan dizi paylaşılmaz');
});

test('ayarlariDuzelt (uçtan uca): ayar dosyası yeni alanları doğrular; eski dosya varsayılanlarla yükselir ve favoriler değişmez', () => {
  const favoriler = [{ entity_id: 'light.salon', ad: 'Salon' }];
  const eski = ayarlariDuzelt({ semaSurumu: 5, favoriler, yerelAdres: 'http://192.168.1.10:8123' }, { varsayilan: {} }).ayarlar;
  for (const ad of ALANLAR) assert.deepEqual(eski[ad], alan(ad).varsayilan, ad);
  assert.deepEqual(eski.favoriler.map((f) => f.entity_id), ['light.salon']);
  const yeni = ayarlariDuzelt({ semaSurumu: 6, favoriler, masaustuKarolari: ['light.salon', 'lock.x'], panelOpaklik: 10, tercihEkran: { id: 1 } }, { varsayilan: {} }).ayarlar;
  assert.deepEqual(yeni.masaustuKarolari, ['light.salon']);
  assert.equal(yeni.panelOpaklik, 100, 'aralık dışı değer varsayılana');
  assert.deepEqual(yeni.tercihEkran, {});
});

test('ekGirdiDogrula: yalnız gönderilen alanlar; geçersiz değer mevcut olanı korur ve uyarı verir', () => {
  const { yeni, uyarilar } = A.ekGirdiDogrula({ panelOpaklik: 60, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'lock.on_kapi', masaustuKarolari: 'light.salon', pencereKonumu: 'hatirla' }, TR);
  assert.deepEqual(yeni, { panelOpaklik: 60, tepsiRozeti: 'sensor', pencereKonumu: 'hatirla' });
  assert.deepEqual(uyarilar.map((u) => u.alan).sort(), ['masaustuKarolari', 'tepsiRozetSensoru']);
  assert.ok(uyarilar.every((u) => typeof u.mesaj === 'string' && u.mesaj !== ''));
  assert.deepEqual(A.ekGirdiDogrula({}, TR), { yeni: {}, uyarilar: [] });
  assert.deepEqual(A.ekGirdiDogrula(null, TR), { yeni: {}, uyarilar: [] });
});

test('ekAyarlariUygula: yalnız değişen alanlar yazılır ve eski/yeni ile bildirilir (main.js dinleyicileri bunlarla çalışır)', () => {
  const ayarlar = A.alanlariDuzelt({}, {});
  const degisenler = A.ekAyarlariUygula(ayarlar, { panelOpaklik: 80, tepsiRozeti: 'kapali', masaustuKarolari: ['light.a'] });
  assert.deepEqual(degisenler.map((d) => d.ad).sort(), ['masaustuKarolari', 'panelOpaklik']);
  assert.deepEqual(degisenler.find((d) => d.ad === 'panelOpaklik'), { ad: 'panelOpaklik', eski: 100, yeni: 80 });
  assert.deepEqual(ayarlar.masaustuKarolari, ['light.a']);
  assert.deepEqual(A.ekAyarlariUygula(ayarlar, { panelOpaklik: 80 }), [], 'aynı değer değişiklik sayılmaz');
});

test('özet: Ayarlar sayfasına makineye özgü konum kayıtları gitmez; seçimler gider', () => {
  const ayarlar = A.alanlariDuzelt({ masaustuKarolari: ['light.a'], masaustuKaroKonumlari: { 'light.a': SINIR }, pencereKonumlari: { hizli: { x: 1, y: 2 } }, tepsiRozeti: 'isik' }, {});
  const ozet = A.ekAyarOzeti(ayarlar);
  assert.equal('masaustuKaroKonumlari' in ozet, false);
  assert.equal('pencereKonumlari' in ozet, false);
  assert.deepEqual(ozet.masaustuKarolari, ['light.a']);
  assert.equal(ozet.tepsiRozeti, 'isik');
  assert.equal(ozet.panelOpaklik, 100);
  assert.deepEqual(ozet.tercihEkran, {});
});

test('dışa aktarma: seçimler dosyaya girer, konum kayıtları ve tercih ekranı girmez; içe aktarma yeni alanları doğrulayarak alır', () => {
  const ayarlar = {
    ...A.alanlariDuzelt({ masaustuKarolari: ['light.a'], masaustuKaroKonumlari: { 'light.a': SINIR }, pencereKonumlari: { hizli: { x: 1, y: 2 } }, tercihEkran: { id: 2, x: 0, y: 0, genislik: 1920, yukseklik: 1080 }, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.x', panelOpaklik: 75, panelHerZamanUstte: true }, {}),
    yerelAdres: 'http://192.168.1.10:8123',
    favoriler: [],
  };
  const disa = ayarlariDisaAktar(ayarlar, { simdi: new Date('2026-01-01T00:00:00Z') });
  assert.equal(disa.ok, true);
  const dosya = JSON.parse(disa.metin);
  assert.deepEqual(
    { a: dosya.ayarlar.masaustuKarolari, b: dosya.ayarlar.tepsiRozeti, c: dosya.ayarlar.tepsiRozetSensoru, d: dosya.ayarlar.panelOpaklik, e: dosya.ayarlar.panelHerZamanUstte },
    { a: ['light.a'], b: 'sensor', c: 'sensor.x', d: 75, e: true },
  );
  for (const ad of ['masaustuKaroKonumlari', 'pencereKonumlari', 'tercihEkran']) assert.equal(ad in dosya.ayarlar, false, `${ad} dosyada yok`);
  // içe aktarma: kapı kimliği ve bozuk değer ayıklanır
  dosya.ayarlar.masaustuKarolari = ['light.a', 'lock.on_kapi'];
  dosya.ayarlar.panelOpaklik = 5;
  dosya.ayarlar.tepsiRozetSensoru = 'cover.garaj';
  const cozum = ayarYedeginiCoz(dosya, { varsayilan: {}, t: TR });
  assert.equal(cozum.ok, true);
  assert.deepEqual(cozum.ayarlar.masaustuKarolari, ['light.a']);
  assert.equal(cozum.ayarlar.panelOpaklik, 100);
  assert.equal(cozum.ayarlar.tepsiRozetSensoru, '');
});

test('tepsiRozetSensorleri: en çok 2 ek sensör; yalnız sensör alanı ve kapı kuralından geçenler, tekrarsız; dizi değilse reddedilir', () => {
  assert.deepEqual(duzelt('tepsiRozetSensorleri', ['sensor.pil', 'sensor.nem']), ['sensor.pil', 'sensor.nem']);
  assert.deepEqual(duzelt('tepsiRozetSensorleri', []), []);
  assert.deepEqual(duzelt('tepsiRozetSensorleri', ['sensor.pil', 'sensor.pil', 'lock.on_kapi', 'light.salon', 'sensor.kapi_sicakligi', 'sensor.nem', 'sensor.fazla']), ['sensor.pil', 'sensor.nem'], 'geçersizler düşer, sınır 2');
  assert.deepEqual(duzelt('tepsiRozetSensorleri', ['sensor.a', 'sensor.b', 'sensor.c']), ['sensor.a', 'sensor.b']);
  for (const kotu of ['sensor.pil', null, undefined, {}, 5, true]) assert.equal(duzelt('tepsiRozetSensorleri', kotu), undefined, JSON.stringify(kotu));
});
