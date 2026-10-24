'use strict';

// 1.4.0 (o-33): masaüstüne sabitlenen karolar — saf yardımcılar. Kapı Kuralı bu yüzeyde de yalnız sıkılaşır.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EN_COK_KARO,
  SABITLENEBILIR_ALANLAR,
  PARLAKLIK_ON_AYARLARI,
  KARO_BOYUTU,
  KARO_BOYUT_SINIRLARI,
  EN_COK_KONUM_KAYDI,
  sabitlenebilirKimlikMi,
  karoSiniriDuzelt,
  karoKonumlariniDuzelt,
  karoKonumKaydiHesapla,
  karoHedefi,
  karoYukunuDuzelt,
  sabitlenecekKarolar,
  tiklanabilirMi,
  parlaklikOnAyariVarMi,
  masaustuKaroModeli,
} = require('../src/lib/masaustu-karo');
const { ekranlariOzetle } = require('../src/lib/pencere-yerlesim');
const { karoOlustur } = require('../src/lib/yuzey-modeli');

const varlik = (kimlik, durum, nitelik = {}) => ({ entity_id: kimlik, state: durum, attributes: nitelik });
const favori = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: kimlik.split('.')[1], ...ek });
const durumlar = (liste) => {
  const harita = new Map(liste.map((v) => [v.entity_id, v]));
  return (kimlik) => harita.get(kimlik);
};
const ekranHam = (id, x, y, w, h) => ({ id, bounds: { x, y, width: w, height: h }, workArea: { x, y, width: w, height: h - 40 } });

// --- Sabitlenebilir alanlar ve Kapı Kuralı ------------------------------------------------------------------------------------------

test('sabit değerler: en çok 6 karo, 7 alan, parlaklık ön ayarları 25/50/100 (donmuş)', () => {
  assert.equal(EN_COK_KARO, 6);
  assert.deepEqual([...SABITLENEBILIR_ALANLAR], ['light', 'switch', 'fan', 'input_boolean', 'scene', 'sensor', 'binary_sensor']);
  assert.deepEqual([...PARLAKLIK_ON_AYARLARI], [25, 50, 100]);
  assert.ok(Object.isFrozen(SABITLENEBILIR_ALANLAR) && Object.isFrozen(PARLAKLIK_ON_AYARLARI) && Object.isFrozen(KARO_BOYUTU));
  assert.equal(EN_COK_KONUM_KAYDI, 24);
});

test('KAPI KURALI: kilit, alarm, siren, perde/kapı (cover), kamera ve yıkıcı alanlar sabitlenebilir alan listesinde YOK', () => {
  for (const yasak of ['lock', 'alarm_control_panel', 'siren', 'cover', 'camera', 'valve', 'garage_door', 'gate', 'script', 'button', 'input_button', 'media_player', 'vacuum', 'climate', 'select', 'input_select', 'number', 'automation', 'update', 'remote']) {
    assert.equal(SABITLENEBILIR_ALANLAR.includes(yasak), false, yasak);
    assert.equal(sabitlenebilirKimlikMi(`${yasak}.ornek`), false, `${yasak}.ornek`);
  }
});

test('sabitlenebilirKimlikMi: sabit alanlardaki zararsız kimlikler geçer', () => {
  for (const kimlik of ['light.salon', 'switch.priz', 'fan.vantilator', 'input_boolean.misafir', 'scene.film', 'sensor.salon_sicaklik', 'binary_sensor.hareket', 'light.indoor_lamp', 'light.outdoor_lamp']) {
    assert.equal(sabitlenebilirKimlikMi(kimlik), true, kimlik);
  }
});

test('KAPI KURALI: kapı/kilit/alarm/garaj/bariyer/kepenk/interkom/siren sözcüklü kimlik, biçimi bozuk girdi ve metin olmayan değer sabitlenemez', () => {
  for (const kimlik of [
    'light.kapi_lambasi', 'switch.garaj_kapisi', 'switch.garage_opener', 'light.front_door', 'light.frontdoor', 'switch.kilit_rolesi', 'switch.alarm_rolesi',
    'switch.bariyer', 'switch.main_gate', 'switch.kepenk_motoru', 'switch.interkom', 'switch.intercom', 'switch.diafon', 'switch.deadbolt', 'switch.shutter', 'sensor.kapi_sicaklik',
    'binary_sensor.kapi_sensoru', 'binary_sensor.window_contact_door', 'scene.kapiyi_ac', 'input_boolean.unlock_mode', 'light.pаdlock', // Kiril "а"
    'light.', 'light', 'Light.Salon', 'light.salon ', 'light.salon;x', 'light..x', '.salon', '', 'light.salon\n',
    null, undefined, 5, {}, [], ['light.salon'],
  ]) {
    assert.equal(sabitlenebilirKimlikMi(kimlik), false, JSON.stringify(kimlik));
  }
});

test('sabitlenecekKarolar: favori ve zararsız karolar seçim sırasıyla; ana süreç nesnesi { kimlik, favori, karo }', () => {
  const favoriler = [favori('light.salon', { parlaklik: true }), favori('switch.priz'), favori('sensor.sicaklik'), favori('scene.film')];
  const d = durumlar([varlik('light.salon', 'on', { brightness: 128 }), varlik('switch.priz', 'off'), varlik('sensor.sicaklik', '21.5', { unit_of_measurement: '°C' }), varlik('scene.film', 'scening')]);
  const sonuc = sabitlenecekKarolar({ secili: ['sensor.sicaklik', 'light.salon', 'scene.film', 'switch.priz'], favoriler, durumAl: d });
  assert.deepEqual(sonuc.map((s) => s.kimlik), ['sensor.sicaklik', 'light.salon', 'scene.film', 'switch.priz']);
  assert.equal(sonuc[1].favori, favoriler[0]);
  assert.equal(sonuc[1].karo.id, 'light.salon');
  assert.equal(sonuc[1].karo.sinif, 'zararsiz');
});

test('sabitlenecekKarolar: FAVORİ olmayan kimlik sabitlenmez (ayarda kimlik olsa da)', () => {
  const sonuc = sabitlenecekKarolar({ secili: ['light.salon', 'light.mutfak'], favoriler: [favori('light.salon')], durumAl: durumlar([varlik('light.salon', 'on'), varlik('light.mutfak', 'on')]) });
  assert.deepEqual(sonuc.map((s) => s.kimlik), ['light.salon']);
});

test('sabitlenecekKarolar: onay isteyen (yıkıcı) favori sabitlenmez; onayı kapatılmış zararsız favori sabitlenir', () => {
  const favoriler = [favori('switch.pc_priz', { onay: true }), favori('light.salon'), favori('scene.film', { onay: true })];
  const d = durumlar([varlik('switch.pc_priz', 'on'), varlik('light.salon', 'on'), varlik('scene.film', 'scening')]);
  const sonuc = sabitlenecekKarolar({ secili: ['switch.pc_priz', 'light.salon', 'scene.film'], favoriler, durumAl: d });
  assert.deepEqual(sonuc.map((s) => s.kimlik), ['light.salon']);
});

test('KAPI KURALI: kapı alanları, kapı sözcüklü kimlik ve HA\'daki GÜNCEL ad/sınıf kapı olan varlık sabitlenmez', () => {
  const favoriler = [
    favori('lock.on_kapi'), favori('cover.garaj'), favori('alarm_control_panel.ev'), favori('siren.ev'), favori('camera.kapi'),
    favori('light.kapi_lambasi'), favori('light.salon'), favori('binary_sensor.hareket'), favori('binary_sensor.pencere'), favori('binary_sensor.acik'), favori('sensor.sicaklik'),
  ];
  const d = durumlar([
    varlik('lock.on_kapi', 'locked'), varlik('cover.garaj', 'closed'), varlik('alarm_control_panel.ev', 'armed_home'), varlik('siren.ev', 'off'), varlik('camera.kapi', 'idle'),
    varlik('light.kapi_lambasi', 'on'),
    varlik('light.salon', 'on', { friendly_name: 'Ön kapı ışığı' }), // HA\'da yeniden adlandırılmış
    varlik('binary_sensor.hareket', 'on', { device_class: 'motion' }),
    varlik('binary_sensor.pencere', 'on', { device_class: 'window' }),
    varlik('binary_sensor.acik', 'on', { device_class: 'opening' }),
    varlik('sensor.sicaklik', '21', { device_class: 'temperature' }),
  ]);
  const secili = favoriler.map((f) => f.entity_id);
  const sonuc = sabitlenecekKarolar({ secili, favoriler, durumAl: d });
  assert.deepEqual(sonuc.map((s) => s.kimlik), ['binary_sensor.hareket', 'sensor.sicaklik']);
  for (const yasak of ['garage_door', 'door', 'lock', 'tamper', 'safety', 'gate', 'garage']) {
    const s = sabitlenecekKarolar({ secili: ['binary_sensor.x'], favoriler: [favori('binary_sensor.x')], durumAl: durumlar([varlik('binary_sensor.x', 'on', { device_class: yasak })]) });
    assert.deepEqual(s, [], `binary_sensor sınıfı ${yasak}`);
  }
});

test('KAPI KURALI: kapı/kilit üyesi olan sahne ve "Kapıyı aç" ad/etiketli favori sabitlenmez', () => {
  const favoriler = [favori('scene.gece', { etiket: 'Kapıyı aç' }), favori('scene.film'), favori('scene.misafir')];
  const d = durumlar([varlik('scene.gece', 'scening'), varlik('scene.film', 'scening', { entity_id: ['light.salon', 'lock.on_kapi'] }), varlik('scene.misafir', 'scening', { entity_id: ['light.salon', 'switch.priz'] })]);
  const sonuc = sabitlenecekKarolar({ secili: ['scene.gece', 'scene.film', 'scene.misafir'], favoriler, durumAl: d });
  assert.deepEqual(sonuc.map((s) => s.kimlik), ['scene.misafir']);
});

test('sabitlenecekKarolar: en çok 6, tekrarlar atılır, sabitlenemeyen kimlik sırayı bozmaz; sabitlenebilir olmayanlar sayıya girmez', () => {
  const kimlikler = ['light.a', 'light.b', 'light.c', 'light.d', 'light.e', 'light.f', 'light.g', 'light.h'];
  const favoriler = kimlikler.map((k) => favori(k));
  const d = durumlar(kimlikler.map((k) => varlik(k, 'on')));
  assert.deepEqual(sabitlenecekKarolar({ secili: kimlikler, favoriler, durumAl: d }).map((s) => s.kimlik), kimlikler.slice(0, 6));
  assert.deepEqual(sabitlenecekKarolar({ secili: ['light.a', 'light.a', 'lock.x', 'light.b', 'light.a'], favoriler, durumAl: d }).map((s) => s.kimlik), ['light.a', 'light.b']);
  assert.deepEqual(sabitlenecekKarolar({ secili: ['lock.x', 'cover.y', 'light.g'], favoriler, durumAl: d }).map((s) => s.kimlik), ['light.g']);
});

test('sabitlenecekKarolar: bozuk girdi boş döner, fırlatmaz; durum bilinmiyorsa karo kullanılamaz ama vardır', () => {
  for (const secili of [null, undefined, 'light.a', 5, {}]) assert.deepEqual(sabitlenecekKarolar({ secili, favoriler: [favori('light.a')], durumAl: () => undefined }), []);
  for (const favoriler of [null, undefined, 'x', {}, [null, 5, {}, { entity_id: 5 }]]) assert.deepEqual(sabitlenecekKarolar({ secili: ['light.a'], favoriler, durumAl: () => undefined }), []);
  const bilinmeyen = sabitlenecekKarolar({ secili: ['light.a'], favoriler: [favori('light.a')], durumAl: () => undefined });
  assert.equal(bilinmeyen.length, 1);
  assert.equal(bilinmeyen[0].karo.kullanilabilir, false);
});

// --- Pencere yükü ------------------------------------------------------------------------------------------------------------------

test('karoYukunuDuzelt: yalnız { tur: "tikla" } ve { parlaklik: 25|50|100 } kabul edilir', () => {
  assert.deepEqual(karoYukunuDuzelt({ tur: 'tikla' }), { tur: 'tikla' });
  for (const p of [25, 50, 100]) assert.deepEqual(karoYukunuDuzelt({ parlaklik: p }), { parlaklik: p });
});

test('karoYukunuDuzelt: kimlik, servis, başka alan, ön ayar dışı parlaklık ve yanlış tür reddedilir', () => {
  const yeni = Object.create({ tur: 'tikla' });
  for (const kotu of [
    null, undefined, 'tikla', 5, true, [], ['tikla'], {}, yeni,
    { tur: 'tikla', id: 'lock.on_kapi' }, { tur: 'tikla', kimlik: 'light.x' }, { tur: 'tikla', servis: 'unlock' }, { tur: 'ac' }, { tur: 'TIKLA' }, { tur: ['tikla'] },
    { parlaklik: 0 }, { parlaklik: 1 }, { parlaklik: 30 }, { parlaklik: 101 }, { parlaklik: '50' }, { parlaklik: 50.5 }, { parlaklik: null }, { parlaklik: NaN },
    { parlaklik: 50, tur: 'tikla' }, { parlaklik: 50, servis: 'x' }, { parlaklik: 50, kimlik: 'light.x' },
    { id: 'light.x' }, { servis: 'turn_on', veri: {} }, { __proto__: { tur: 'tikla' }, tur2: 1 },
  ]) {
    assert.equal(karoYukunuDuzelt(kotu), null, JSON.stringify(kotu));
  }
});

test('tiklanabilirMi: yalnız zararsız, kullanılabilir ve varsayılan eylemi olan karo; sensör ve sahne olmayan salt okunur karolar tıklanamaz', () => {
  const kur = (kimlik, durum, favoriEk) => karoOlustur(favori(kimlik, favoriEk), varlik(kimlik, durum));
  assert.equal(tiklanabilirMi(kur('light.salon', 'on')), true);
  assert.equal(tiklanabilirMi(kur('switch.priz', 'off')), true);
  assert.equal(tiklanabilirMi(kur('scene.film', 'scening')), true);
  assert.equal(tiklanabilirMi(kur('sensor.sicaklik', '21')), false, 'sensör salt okunur');
  assert.equal(tiklanabilirMi(kur('binary_sensor.hareket', 'on')), false);
  assert.equal(tiklanabilirMi(kur('light.salon', 'unavailable')), false, 'ulaşılamıyor');
  assert.equal(tiklanabilirMi(kur('switch.priz', 'on', { onay: true })), false, 'yıkıcı');
  assert.equal(tiklanabilirMi(null), false);
  assert.equal(tiklanabilirMi(undefined), false);
  assert.equal(tiklanabilirMi({}), false);
});

test('parlaklikOnAyariVarMi: yalnız parlaklığı açık, kullanılabilir ışık favorisi; hat parlaklığı başka türlü reddedeceği için düğme gösterilmez', () => {
  const kur = (kimlik, durum, favoriEk) => karoOlustur(favori(kimlik, favoriEk), varlik(kimlik, durum));
  assert.equal(parlaklikOnAyariVarMi(kur('light.salon', 'on', { parlaklik: true })), true);
  assert.equal(parlaklikOnAyariVarMi(kur('light.salon', 'on')), false, 'favoride parlaklık kapalı');
  assert.equal(parlaklikOnAyariVarMi(kur('light.salon', 'on', { parlaklik: false })), false);
  assert.equal(parlaklikOnAyariVarMi(kur('light.salon', 'unavailable', { parlaklik: true })), false);
  assert.equal(parlaklikOnAyariVarMi(kur('light.salon', 'on', { parlaklik: true, onay: true })), false, 'yıkıcı');
  assert.equal(parlaklikOnAyariVarMi(kur('switch.priz', 'on', { parlaklik: true })), false, 'ışık değil');
  assert.equal(parlaklikOnAyariVarMi({ alan: 'light', kullanilabilir: true, sinif: 'zararsiz' }), false, 'parlaklikKontrol yok');
  assert.equal(parlaklikOnAyariVarMi(null), false);
});

// --- Sayfaya giden model -----------------------------------------------------------------------------------------------------------

test('masaustuKaroModeli: alan beyaz listesi — yalnız bilinen alanlar, ham ad/grup/servis/anahtar gitmez', () => {
  const karo = karoOlustur(favori('light.salon', { parlaklik: true, etiket: 'Salon' }), varlik('light.salon', 'on', { brightness: 128, friendly_name: 'Salon', access_token: 'gizli-jeton', rgb_color: [1, 2, 3] }));
  const model = masaustuKaroModeli(karo, { canli: true, baglanti: 'ev' });
  assert.deepEqual(Object.keys(model).sort(), ['alan', 'baglanti', 'durum', 'etiket', 'id', 'kullanilabilir', 'ozellik', 'parlaklikOnAyarlari', 'tiklanabilir', 'ulasilamiyor', 'yuzde']);
  assert.deepEqual(model.baglanti, { canli: true, baglanti: 'ev' });
  assert.equal(model.id, 'light.salon');
  assert.equal(model.alan, 'light');
  assert.equal(model.durum, 'acik');
  assert.equal(model.ozellik, null, 'ışıkta öznitelik gitmez');
  assert.deepEqual(model.parlaklikOnAyarlari, [25, 50, 100]);
  assert.equal(model.tiklanabilir, true);
  assert.doesNotMatch(JSON.stringify(model), /gizli|token|rgb|friendly/i);
  assert.notEqual(model.parlaklikOnAyarlari, PARLAKLIK_ON_AYARLARI, 'donmuş sabit paylaşılmaz');
});

test('masaustuKaroModeli: sensörde güvenli öznitelik alt kümesi gider (kopya); salt okunur, parlaklık yok; bağlantı varsayılanı kapalı', () => {
  const karo = karoOlustur(favori('sensor.sicaklik'), varlik('sensor.sicaklik', '21.5', { unit_of_measurement: '°C', device_class: 'temperature', friendly_name: 'Salon', ham_alan: 'x' }));
  const model = masaustuKaroModeli(karo);
  assert.equal(model.tiklanabilir, false);
  assert.deepEqual(model.parlaklikOnAyarlari, []);
  assert.deepEqual(model.baglanti, { canli: false, baglanti: 'kapali' });
  assert.equal(model.ozellik.deger, '21.5');
  assert.equal(model.ozellik.birim, '°C');
  assert.doesNotMatch(JSON.stringify(model.ozellik), /ham_alan|friendly/);
  assert.notEqual(model.ozellik, karo.ozellik, 'derin kopya');
});

test('masaustuKaroModeli: etiket 40 karakterle kısılır; bozuk baglanti alanları varsayılana düşer; ulaşılamayan karo işaretlenir', () => {
  const karo = { ...karoOlustur(favori('switch.priz'), varlik('switch.priz', 'unavailable')), etiket: 'E'.repeat(100) };
  const model = masaustuKaroModeli(karo, { canli: 'evet', baglanti: 5 });
  assert.equal(model.etiket.length, 40);
  assert.deepEqual(model.baglanti, { canli: false, baglanti: 'kapali' });
  assert.equal(model.ulasilamiyor, true);
  assert.equal(model.kullanilabilir, false);
  assert.equal(model.tiklanabilir, false);
  assert.equal(masaustuKaroModeli({ ...karo, etiket: 5 }).etiket, '');
});

test('masaustuKaroModeli: etiket kod noktası sınırında kesilir; emoji (vekil çifti) ortadan bölünmez, yarım vekil kalmaz', () => {
  const karo = karoOlustur(favori('switch.priz'), varlik('switch.priz', 'on'));
  const yarimVekil = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  for (const etiket of ['a'.repeat(39) + '😀', 'a'.repeat(39) + '😀' + 'b', '😀'.repeat(60), 'a'.repeat(38) + '😀😀']) {
    const sonuc = masaustuKaroModeli({ ...karo, etiket }).etiket;
    assert.doesNotMatch(sonuc, yarimVekil, JSON.stringify(sonuc));
    assert.ok(Array.from(sonuc).length <= 40, sonuc);
    assert.equal(sonuc, Array.from(etiket).slice(0, 40).join(''));
  }
});

// --- Konum kaydı -------------------------------------------------------------------------------------------------------------------

test('karoSiniriDuzelt: tam sayıya yuvarlar, boyutu izinli aralığa kırpar; bozuk biçim null', () => {
  assert.deepEqual(karoSiniriDuzelt({ x: 10.4, y: -20.6, width: 200.2, height: 100.7 }), { x: 10, y: -21, width: 200, height: 101 });
  assert.deepEqual(karoSiniriDuzelt({ x: 0, y: 0, width: 10, height: 10 }), { x: 0, y: 0, ...KARO_BOYUT_SINIRLARI.en_az });
  assert.deepEqual(karoSiniriDuzelt({ x: 0, y: 0, width: 5000, height: 5000 }), { x: 0, y: 0, ...KARO_BOYUT_SINIRLARI.en_cok });
  for (const kotu of [null, undefined, 5, 'x', [], {}, { x: 0, y: 0, width: 200 }, { x: '0', y: 0, width: 200, height: 100 }, { x: NaN, y: 0, width: 200, height: 100 }, { x: 0, y: Infinity, width: 200, height: 100 }, { x: 1e9, y: 0, width: 200, height: 100 }]) {
    assert.equal(karoSiniriDuzelt(kotu), null, JSON.stringify(kotu));
  }
});

test('karoKonumlariniDuzelt: geçersiz kimlik (kapı kuralı dahil) ve sınır atılır; nesne değilse undefined; en çok 24 kayıt', () => {
  const sinir = { x: 1, y: 2, width: 200, height: 100 };
  assert.deepEqual(
    karoKonumlariniDuzelt({ 'light.salon': sinir, 'lock.on_kapi': sinir, 'light.kapi_lambasi': sinir, 'switch.priz': { x: 'a' }, 'cover.garaj': sinir, 'sensor.sicaklik': { ...sinir, ekstra: 1 } }),
    { 'light.salon': sinir, 'sensor.sicaklik': sinir },
  );
  for (const kotu of [null, undefined, 'x', 5, [], [sinir]]) assert.equal(karoKonumlariniDuzelt(kotu), undefined, JSON.stringify(kotu));
  assert.deepEqual(karoKonumlariniDuzelt({}), {});
  const cok = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`light.l${i}`, sinir]));
  const kirpilmis = karoKonumlariniDuzelt(cok);
  assert.equal(Object.keys(kirpilmis).length, 24);
  assert.ok('light.l0' in kirpilmis && !('light.l24' in kirpilmis), 'ilk 24 kalır');
});

test('karoKonumKaydiHesapla: yeni kayıt eklenir; aynı sınır null; taşınan karo sona geçer; sınır kırpılır', () => {
  const sinir = { x: 100, y: 200, width: 176, height: 112 };
  assert.deepEqual(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: sinir, mevcut: {} }), { 'light.salon': sinir });
  assert.equal(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: sinir, mevcut: { 'light.salon': sinir } }), null);
  assert.equal(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: { ...sinir, x: 100.3 }, mevcut: { 'light.salon': sinir } }), null, 'yuvarlanınca aynı');
  const iki = karoKonumKaydiHesapla({ kimlik: 'switch.priz', sinirlar: sinir, mevcut: { 'light.salon': { ...sinir, x: 0 } } });
  assert.deepEqual(Object.keys(iki), ['light.salon', 'switch.priz']);
  const tasindi = karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: { ...sinir, x: 300 }, mevcut: iki });
  assert.deepEqual(Object.keys(tasindi), ['switch.priz', 'light.salon'], 'güncellenen sona taşınır');
  assert.equal(tasindi['light.salon'].x, 300);
  const dolu = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`light.l${i}`, sinir]));
  const tasan = karoKonumKaydiHesapla({ kimlik: 'light.yeni', sinirlar: sinir, mevcut: dolu });
  assert.equal(Object.keys(tasan).length, 24);
  assert.ok(!('light.l0' in tasan) && 'light.yeni' in tasan && 'light.l1' in tasan, 'en eski düşer');
});

test('karoKonumKaydiHesapla: girdi nesnesi değişmez; sabitlenemeyen kimlik ve bozuk sınır null', () => {
  const sinir = { x: 1, y: 2, width: 200, height: 100 };
  const mevcut = { 'light.salon': { ...sinir } };
  const kopya = structuredClone(mevcut);
  karoKonumKaydiHesapla({ kimlik: 'switch.priz', sinirlar: sinir, mevcut });
  assert.deepEqual(mevcut, kopya);
  for (const kimlik of ['lock.on_kapi', 'cover.garaj', 'light.kapi', 'script.x', '', null, 5]) assert.equal(karoKonumKaydiHesapla({ kimlik, sinirlar: sinir, mevcut: {} }), null, String(kimlik));
  assert.equal(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: { x: 1 }, mevcut: {} }), null);
  assert.equal(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: null, mevcut: {} }), null);
  assert.deepEqual(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: sinir, mevcut: null }), { 'light.salon': sinir }, 'bozuk mevcut boş sayılır');
});

test('karoSiniriDuzelt: metin boyutu çarpanı (olcek) en az/en çok sınırı aynı oranda büyütür; geçersiz çarpan 1 sayılır', () => {
  const b = { x: 0, y: 0, width: 500, height: 350 };
  assert.deepEqual(karoSiniriDuzelt(b, 1.5), b, '%150: 540x390 sınırı içinde, korunur');
  assert.deepEqual(karoSiniriDuzelt(b), { x: 0, y: 0, width: 360, height: 260 }, 'çarpan yokken eski davranış: 360x260');
  assert.deepEqual(karoSiniriDuzelt(b, 1), { x: 0, y: 0, width: 360, height: 260 });
  assert.deepEqual(karoSiniriDuzelt({ x: 0, y: 0, width: 5000, height: 5000 }, 1.5), { x: 0, y: 0, width: 540, height: 390 });
  assert.deepEqual(karoSiniriDuzelt({ x: 0, y: 0, width: 5000, height: 5000 }, 2), { x: 0, y: 0, width: 720, height: 520 });
  assert.deepEqual(karoSiniriDuzelt({ x: 0, y: 0, width: 10, height: 10 }, 1.5), { x: 0, y: 0, width: 180, height: 132 }, 'en az da büyür');
  for (const gecersiz of ['kocaman', NaN, 0.5, 3, Infinity, null, undefined, {}]) {
    assert.deepEqual(karoSiniriDuzelt(b, gecersiz), { x: 0, y: 0, width: 360, height: 260 }, String(gecersiz));
  }
});

test('karoKonumlariniDuzelt (ayar şeması, ölçekten bağımsız): %150\'de büyütülmüş kayıt korunur; en çok ölçek 2 (720x520) sınırıyla kırpılır', () => {
  const sonuc = karoKonumlariniDuzelt({
    'light.salon': { x: 1, y: 2, width: 500, height: 350 },
    'switch.priz': { x: 1, y: 2, width: 5000, height: 5000 },
    'fan.vantilator': { x: 1, y: 2, width: 10, height: 10 },
  });
  assert.deepEqual(sonuc['light.salon'], { x: 1, y: 2, width: 500, height: 350 });
  assert.deepEqual(sonuc['switch.priz'], { x: 1, y: 2, width: 720, height: 520 });
  assert.deepEqual(sonuc['fan.vantilator'], { x: 1, y: 2, ...KARO_BOYUT_SINIRLARI.en_az }, 'en az ölçek 1');
});

test('karoKonumKaydiHesapla: olcek ile büyük boyut kaydedilir (360x260\'a inmez); diğer karoların büyük kayıtları yeni kayıtla kırpılmaz', () => {
  const buyuk = { x: 10, y: 20, width: 500, height: 350 };
  assert.deepEqual(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: buyuk, mevcut: {}, olcek: 1.5 }), { 'light.salon': buyuk });
  assert.deepEqual(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: buyuk, mevcut: {} }), { 'light.salon': { ...buyuk, width: 360, height: 260 } }, 'çarpan yok: eski davranış');
  const sonuc = karoKonumKaydiHesapla({ kimlik: 'switch.priz', sinirlar: { x: 0, y: 0, width: 200, height: 120 }, mevcut: { 'light.salon': buyuk }, olcek: 1 });
  assert.deepEqual(sonuc['light.salon'], buyuk, 'başka karonun %150 kaydı yeni kayıtla kırpılmaz');
  assert.equal(karoKonumKaydiHesapla({ kimlik: 'light.salon', sinirlar: buyuk, mevcut: { 'light.salon': buyuk }, olcek: 1.5 }), null, 'değişiklik yok');
});

// --- Açılış konumu -----------------------------------------------------------------------------------------------------------------

const tekEkran = ekranlariOzetle([ekranHam(1, 0, 0, 1920, 1080)], 1);
const ikiEkran = ekranlariOzetle([ekranHam(1, 0, 0, 1920, 1080), ekranHam(2, -1280, 0, 1280, 1024)], 1);

test('karoHedefi: kayıt yokken birincil ekranın sağ kenarında, sıra numarasına göre alta dizilir', () => {
  const h0 = karoHedefi({ sira: 0, ekranlar: tekEkran });
  assert.deepEqual(h0, { x: 1920 - 176 - 16, y: 16, width: 176, height: 112, kaynak: 'varsayilan' });
  const h1 = karoHedefi({ sira: 1, ekranlar: tekEkran });
  assert.equal(h1.x, h0.x);
  assert.equal(h1.y, 16 + 112 + 12);
  const h5 = karoHedefi({ sira: 5, ekranlar: tekEkran });
  assert.equal(h5.y, 16 + 5 * 124);
});

test('karoHedefi: sığmayan satır yeni bir sütun açar; hiçbir karo çalışma alanı dışına taşmaz ya da çakışmaz', () => {
  const kisa = ekranlariOzetle([ekranHam(1, 0, 0, 1920, 400)], 1); // çalışma alanı 360 yüksek: 2 satır
  const hedefler = Array.from({ length: 6 }, (_, sira) => karoHedefi({ sira, ekranlar: kisa }));
  assert.equal(new Set(hedefler.map((h) => `${h.x},${h.y}`)).size, 6, 'çakışma yok');
  assert.ok(hedefler.some((h) => h.x < 1920 - 176 - 16), 'ikinci sütun');
  for (const h of hedefler) {
    assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.width <= 1920 && h.y + h.height <= 360, JSON.stringify(h));
  }
});

test('karoHedefi: kayıt bağlı bir ekranda görünüyorsa kullanılır (sol monitörün negatif konumu dahil); sığmayan kayıt çalışma alanına sığdırılır', () => {
  const kayit = { x: -1000, y: 100, width: 176, height: 112 };
  assert.deepEqual(karoHedefi({ kayit, sira: 0, ekranlar: ikiEkran }), { ...kayit, kaynak: 'kayit' });
  const tasan = karoHedefi({ kayit: { x: 1850, y: 960, width: 176, height: 112 }, sira: 0, ekranlar: tekEkran });
  assert.equal(tasan.kaynak, 'kayit');
  assert.deepEqual({ x: tasan.x, y: tasan.y }, { x: 1920 - 176, y: 1040 - 112 }, 'çalışma alanına (görev çubuğu hariç) sığdırılır');
  assert.equal(karoHedefi({ kayit: { x: 1850, y: 1000, width: 176, height: 112 }, sira: 0, ekranlar: tekEkran }).kaynak, 'varsayilan', 'yalnız 40 piksel görünen karo kayıt sayılmaz');
});

test('karoHedefi: kaydın ekranı sökülmüşse varsayılana düşer (görünmez yerde açılmaz); kayıt silinmez, ekran dönünce yeniden geçerlidir', () => {
  const kayit = { x: -1000, y: 100, width: 176, height: 112 };
  const dusen = karoHedefi({ kayit, sira: 2, ekranlar: tekEkran });
  assert.equal(dusen.kaynak, 'varsayilan');
  assert.equal(dusen.y, 16 + 2 * 124);
  assert.equal(karoHedefi({ kayit, sira: 2, ekranlar: ikiEkran }).kaynak, 'kayit', 'aynı kayıt ekran dönünce geçerli');
  for (const bozuk of [{ x: 'a' }, { x: 1, y: 1 }, [], 'x', 5]) assert.equal(karoHedefi({ kayit: bozuk, sira: 0, ekranlar: tekEkran }).kaynak, 'varsayilan');
});

test('karoHedefi: olcek ile kayıtlı büyük boyut korunur (%150\'de 500x350); olcek 1\'de 360x260\'a kırpılır; geçersiz olcek 1 sayılır', () => {
  const kayit = { x: 300, y: 200, width: 500, height: 350 };
  const h = karoHedefi({ kayit, sira: 0, ekranlar: tekEkran, olcek: 1.5 });
  assert.deepEqual(h, { ...kayit, kaynak: 'kayit' });
  assert.deepEqual(karoHedefi({ kayit, sira: 0, ekranlar: tekEkran, olcek: 1 }), { x: 300, y: 200, width: 360, height: 260, kaynak: 'kayit' });
  assert.deepEqual(karoHedefi({ kayit, sira: 0, ekranlar: tekEkran }), { x: 300, y: 200, width: 360, height: 260, kaynak: 'kayit' });
  assert.equal(karoHedefi({ kayit, sira: 0, ekranlar: tekEkran, olcek: 'x' }).width, 360);
});

test('karoHedefi: varsayılan boyut metin boyutuyla ölçeklenir (%150 -> 264x168); olcek verilmezse ya da 1 ise eski 176x112', () => {
  assert.deepEqual(karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: 1.5 }), { x: 1920 - 264 - 16, y: 16, width: 264, height: 168, kaynak: 'varsayilan' });
  assert.deepEqual(karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: 2 }), { x: 1920 - 352 - 16, y: 16, width: 352, height: 224, kaynak: 'varsayilan' });
  assert.deepEqual(karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: 1 }), karoHedefi({ sira: 0, ekranlar: tekEkran }));
  for (const gecersiz of ['x', NaN, 0.5, 3, null]) assert.equal(karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: gecersiz }).width, KARO_BOYUTU.width, String(gecersiz));
  // ölçekli boyut CSS alanını tasarım boyutunda tutar: pencere / olcek = 176x112
  const h = karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: 1.5 });
  assert.deepEqual([h.width / 1.5, h.height / 1.5], [KARO_BOYUTU.width, KARO_BOYUTU.height]);
});

test('karoHedefi: %150 ve %200\'de ardışık varsayılan karolar çakışmaz, pencere en az boyutundan küçük olmaz ve çalışma alanında kalır', () => {
  const kesisir = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const ekranlar = [tekEkran, ekranlariOzetle([ekranHam(1, 0, 0, 1920, 400)], 1)]; // yüksek ve kısa (sütun açan) çalışma alanı
  for (const olcek of [1, 1.3, 1.5, 2]) {
    for (const liste of ekranlar) {
      if (olcek === 2 && liste !== tekEkran) continue; // %200 + 360 px yüksek çalışma alanı: altı sütun 1920 px'e sığmaz (gerçekçi olmayan birleşim)
      const alan = liste[0].calismaAlani;
      const hedefler = Array.from({ length: 6 }, (_, sira) => karoHedefi({ sira, ekranlar: liste, olcek }));
      const enAz = { width: Math.round(KARO_BOYUT_SINIRLARI.en_az.width * olcek), height: Math.round(KARO_BOYUT_SINIRLARI.en_az.height * olcek) };
      hedefler.forEach((h, i) => {
        assert.ok(h.width >= enAz.width && h.height >= enAz.height, 'Electron pencereyi büyütmesin (üst üste binme): ' + JSON.stringify([olcek, h]));
        assert.ok(h.x >= alan.x && h.y >= alan.y && h.x + h.width <= alan.x + alan.width && h.y + h.height <= alan.y + alan.height, 'çalışma alanında: ' + JSON.stringify([olcek, h]));
        for (let j = i + 1; j < hedefler.length; j += 1) assert.equal(kesisir(h, hedefler[j]), false, 'çakışma: ' + JSON.stringify([olcek, h, hedefler[j]]));
      });
    }
  }
  // dikey adım = ölçekli yükseklik + boşluk (eskiden 124 sabitti ve %150'de 132 yüksek pencereler 8 px örtüşürdü)
  const a0 = karoHedefi({ sira: 0, ekranlar: tekEkran, olcek: 1.5 });
  const a1 = karoHedefi({ sira: 1, ekranlar: tekEkran, olcek: 1.5 });
  assert.equal(a1.y - a0.y, a0.height + 12);
  assert.equal(karoHedefi({ sira: 1, ekranlar: tekEkran }).y - karoHedefi({ sira: 0, ekranlar: tekEkran }).y, 124, 'çarpan 1: eski adım');
});

test('karoHedefi: ekran listesi boş ya da bozuksa 1280x720 yedek alan; sıra geçersizse 0', () => {
  const yedek = karoHedefi({ sira: 0, ekranlar: [] });
  assert.deepEqual(yedek, { x: 1280 - 176 - 16, y: 16, width: 176, height: 112, kaynak: 'varsayilan' });
  assert.deepEqual(karoHedefi({ sira: 0, ekranlar: null }), yedek);
  assert.deepEqual(karoHedefi({}), yedek);
  for (const sira of [-1, 1.5, NaN, '2', null]) assert.equal(karoHedefi({ sira, ekranlar: tekEkran }).y, 16, String(sira));
});
