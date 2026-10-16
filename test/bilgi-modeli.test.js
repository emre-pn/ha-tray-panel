'use strict';

/**
 * Bilgi modeli (src/lib/bilgi-modeli.js): sensör şeridi, üst kartlar, takvim ve yapılacaklar satırları; izlenen/kayıtlı kimlikler;
 * renderer beyaz listesi; tepsi sensör uyarısı sayımı. Kapı Kuralı her yerde: kapı/kilit/garaj sensörleri hiçbir kalemde görünmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/lib/bilgi-modeli');
const { rendererModeli, RENDERER_KARO_ALANLARI, yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');
const { TR } = require('../src/lib/ceviri-varsayilan');

const durum = (kimlik, state, nitelikler = {}) => ({ entity_id: kimlik, state, attributes: nitelikler });
const DEPO = {
  'sensor.salon_sicaklik': durum('sensor.salon_sicaklik', '21.456', { friendly_name: 'Salon Sıcaklık', unit_of_measurement: '°C', device_class: 'temperature', suggested_display_precision: 1 }),
  'sensor.kumanda_pil': durum('sensor.kumanda_pil', '12', { friendly_name: 'Kumanda Pil', unit_of_measurement: '%', device_class: 'battery' }),
  'sensor.on_kapi_pil': durum('sensor.on_kapi_pil', '5', { friendly_name: 'Ön Kapı Pil', unit_of_measurement: '%', device_class: 'battery' }),
  'binary_sensor.salon_hareket': durum('binary_sensor.salon_hareket', 'on', { friendly_name: 'Salon Hareket', device_class: 'motion' }),
  'binary_sensor.mutfak_su': durum('binary_sensor.mutfak_su', 'on', { friendly_name: 'Mutfak Su', device_class: 'moisture' }),
  'binary_sensor.giris': durum('binary_sensor.giris', 'on', { friendly_name: 'Giriş', device_class: 'door' }),
  'weather.ev': durum('weather.ev', 'sunny', { temperature: 24, temperature_unit: '°C', humidity: 40 }),
  'calendar.ev': durum('calendar.ev', 'off', { friendly_name: 'Ev Takvimi' }),
  'todo.alisveris': durum('todo.alisveris', '3', { friendly_name: 'Alışveriş' }),
  'todo.diafon_isleri': durum('todo.diafon_isleri', '1', { friendly_name: 'Diafon İşleri' }),
};
const durumAl = (k) => DEPO[k];

const AYAR = Object.freeze({
  sensorSeridi: ['sensor.salon_sicaklik', 'sensor.kumanda_pil', 'binary_sensor.salon_hareket'],
  ustKart1: 'hava',
  ustKart2: 'saat',
  havaVarligi: 'weather.ev',
  takvimler: ['calendar.ev'],
  yapilacakListeleri: ['todo.alisveris'],
  hizliListe: '',
  saatBicimi: '24',
  tarihBicimi: 'kisa',
  takvimGunSayisi: 5,
  sensorGrafik: false,
  sensorGrafikSaat: 24,
  pilEsigi: 25,
});

test('yapilandirma ve bilgiKimlikleri: yalnız ayardaki kimlikler; hava varlığı yalnız hava kartı varsa; hızlı liste yedeği ilk liste', () => {
  const kimlikler = M.bilgiKimlikleri(AYAR);
  assert.deepEqual([...kimlikler].sort(), ['binary_sensor.salon_hareket', 'calendar.ev', 'sensor.kumanda_pil', 'sensor.salon_sicaklik', 'todo.alisveris', 'weather.ev']);
  assert.equal(M.yapilandirma(AYAR).hizliHedef, 'todo.alisveris', 'hızlı liste boşsa ilk yapılacaklar listesi');
  assert.equal(M.yapilandirma({ ...AYAR, hizliListe: 'todo.market' }).hizliHedef, 'todo.market');
  // hava kartı yoksa hava varlığı izlenmez
  assert.equal(M.bilgiKimlikleri({ ...AYAR, ustKart1: 'saat' }).has('weather.ev'), false);
  // üst kart varlık kimliği izlenir; 'yok' ve 'saat' kimlik değildir
  const k = M.bilgiKimlikleri({ ustKart1: 'sensor.dis_sicaklik', ustKart2: 'yok' });
  assert.deepEqual([...k], ['sensor.dis_sicaklik']);
  // boş / bozuk ayar
  for (const bos of [undefined, null, {}, 5, { sensorSeridi: 'sensor.a', takvimler: [1, 2] }]) assert.equal(M.bilgiKimlikleri(bos).size, 0, String(bos));
  // sınırlar ve tekrar
  const cok = M.bilgiKimlikleri({
    sensorSeridi: Array.from({ length: 10 }, (_, i) => `sensor.s${i}`),
    takvimler: Array.from({ length: 10 }, (_, i) => `calendar.c${i}`),
    yapilacakListeleri: ['todo.a', 'todo.a', 'todo.b'],
  });
  assert.equal([...cok].filter((x) => x.startsWith('sensor.')).length, M.EN_COK_SERIT);
  assert.equal([...cok].filter((x) => x.startsWith('calendar.')).length, M.EN_COK_TAKVIM);
  assert.equal([...cok].filter((x) => x.startsWith('todo.')).length, 2);
});

test('bilgiKaydi: ayardaki kimlik { entity_id, ad } döner, diğerleri (kapı kilit dahil) null', () => {
  let ayarlar = AYAR;
  const kaynak = M.bilgiKaydi(() => ayarlar);
  assert.deepEqual(kaynak('todo.alisveris'), { entity_id: 'todo.alisveris', ad: 'alisveris' });
  assert.deepEqual(kaynak('sensor.salon_sicaklik'), { entity_id: 'sensor.salon_sicaklik', ad: 'salon sicaklik' });
  for (const yok of ['lock.on_kapi', 'sensor.baska', 'todo.diafon_isleri', '', undefined, null, 5, {}]) assert.equal(kaynak(yok), null, String(yok));
  ayarlar = { ...AYAR, yapilacakListeleri: ['todo.diafon_isleri'] };
  assert.deepEqual(kaynak('todo.diafon_isleri'), { entity_id: 'todo.diafon_isleri', ad: 'diafon isleri' }, 'kaynak ayarı her çağrıda okur (kapı süzgecini hat uygular)');
  ayarlar = undefined;
  assert.equal(kaynak('todo.alisveris'), null, 'ayar yoksa kayıt yok');
});

test('bilgiModeliOlustur: şerit, kartlar, takvim, liste ve ayar; sayısal değerler güvenli öznitelikten gelir', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: AYAR, durumAl, t: TR });
  assert.deepEqual(m.serit.map((k) => k.id), ['sensor.salon_sicaklik', 'sensor.kumanda_pil', 'binary_sensor.salon_hareket']);
  assert.deepEqual(m.serit[0].ozellik, { deger: '21.456', sayi: 21.456, birim: '°C', sinif: 'temperature', durumSinifi: null, hassasiyet: 1, enAz: null, enCok: null });
  assert.equal(m.serit[0].etiket, 'Salon Sıcaklık');
  assert.equal(m.serit[2].ozellik.acik, true);
  assert.equal(m.serit.every((k) => k.varsayilanEylem === false && k.sinif === 'zararsiz'), true, 'sensörün tek tıklama eylemi yok');
  assert.deepEqual(m.kartlar.map((k) => [k.yuva, k.tur, k.karo?.id ?? null, k.secilmedi]), [[1, 'hava', 'weather.ev', false], [2, 'saat', null, false]]);
  assert.equal(m.kartlar[0].karo.ozellik.sicaklik, 24);
  assert.deepEqual(m.takvimler, [{ id: 'calendar.ev', etiket: 'Ev Takvimi', kullanilabilir: true, mesgul: false }]);
  assert.deepEqual(m.listeler, [{ id: 'todo.alisveris', etiket: 'Alışveriş', kullanilabilir: true, acikSayisi: 3 }]);
  assert.equal(m.hizliListe, 'todo.alisveris');
  assert.deepEqual(m.ayar, { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 5, sensorGrafik: false, sensorGrafikSaat: 24, pilEsigi: 25 });
});

test('bilgiModeliOlustur: boş ayar boş bölüm üretir, varsayılan ayarlar döner', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: {}, durumAl });
  assert.deepEqual(m, {
    ayar: { saatBicimi: 'sistem', tarihBicimi: 'orta', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 },
    kartlar: [],
    serit: [],
    sensorler: [],
    takvimler: [],
    listeler: [],
    hizliListe: '',
  });
  assert.doesNotThrow(() => M.bilgiModeliOlustur({ ayarlar: undefined, durumAl: () => undefined }));
});

test('hava kartı: varlık seçilmemişse secilmedi, varlık HA\'da yoksa karo kullanılamaz; durum henüz yokken (undefined) kart kullanılamaz değil bilinmiyor', () => {
  const secilmedi = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'hava', havaVarligi: '' }, durumAl });
  assert.deepEqual(secilmedi.kartlar, [{ yuva: 1, tur: 'hava', karo: null, secilmedi: true }]);
  const yok = M.bilgiModeliOlustur({ ayarlar: { ustKart2: 'hava', havaVarligi: 'weather.kayip' }, durumAl: () => null });
  assert.equal(yok.kartlar[0].yuva, 2);
  assert.equal(yok.kartlar[0].karo.kullanilabilir, false);
  assert.equal(yok.kartlar[0].secilmedi, false);
  // hava alanı olmayan varlık hava kartına giremez
  assert.equal(M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'hava', havaVarligi: 'sensor.salon_sicaklik' }, durumAl }).kartlar[0].karo, null);
});

test('varlık kartı: sensör ya da ikili sensör olabilir; başka alan ve kapı sensörü kart olmaz', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'sensor.salon_sicaklik', ustKart2: 'binary_sensor.giris' }, durumAl });
  assert.deepEqual(m.kartlar.map((k) => [k.yuva, k.tur, k.karo.id]), [[1, 'varlik', 'sensor.salon_sicaklik']]);
  assert.deepEqual(M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'light.salon' }, durumAl }).kartlar, []);
  assert.deepEqual(M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'lock.on_kapi', ustKart2: 'cover.garaj' }, durumAl }).kartlar, []);
});

test('KAPI KURALI: kapı sınıflı ikili sensör, kapı sözcüklü sensör ve kapı/kilit/garaj alanları hiçbir bilgi kaleminde görünmez', () => {
  const ayar = {
    sensorSeridi: ['binary_sensor.giris', 'sensor.on_kapi_pil', 'sensor.salon_sicaklik', 'lock.on_kapi', 'cover.garaj', 'camera.salon', 'alarm_control_panel.ev'],
    ustKart1: 'sensor.on_kapi_pil',
    ustKart2: 'binary_sensor.giris',
    takvimler: ['calendar.kapi_randevulari', 'calendar.ev'],
    yapilacakListeleri: ['todo.diafon_isleri', 'todo.alisveris', 'lock.todo'],
    hizliListe: 'todo.diafon_isleri',
  };
  const m = M.bilgiModeliOlustur({ ayarlar: ayar, durumAl });
  assert.deepEqual(m.serit.map((k) => k.id), ['sensor.salon_sicaklik']);
  assert.deepEqual(m.kartlar, []);
  assert.deepEqual(m.takvimler.map((k) => k.id), ['calendar.ev']);
  assert.deepEqual(m.listeler.map((k) => k.id), ['todo.alisveris']);
  assert.equal(m.hizliListe, '', 'kapı sözcüklü hızlı liste hedef olamaz');
  const metin = JSON.stringify(M.rendererBilgi(m));
  assert.doesNotMatch(metin, /kapi|kapı|diafon|garaj|lock\.|cover\.|camera\.|alarm/i);
});

test('canlı HA adı kapı sözcüğü içeriyorsa kalem düşer (ayardaki kimlik zararsız olsa da)', () => {
  const depo = { ...DEPO, 'todo.alisveris': durum('todo.alisveris', '3', { friendly_name: 'Garaj Kapısı İşleri' }), 'calendar.ev': durum('calendar.ev', 'off', { friendly_name: 'Front Door' }) };
  const m = M.bilgiModeliOlustur({ ayarlar: AYAR, durumAl: (k) => depo[k] });
  assert.deepEqual(m.listeler, []);
  assert.deepEqual(m.takvimler, []);
  assert.equal(m.hizliListe, '');
});

test('takvim ve liste satırı: ulaşılamayan kullanılamaz, HA\'da olmayan (null) kullanılamaz, henüz bilinmeyen (undefined) kullanılabilir; sayı yoksa null', () => {
  const ayar = { takvimler: ['calendar.a', 'calendar.b', 'calendar.c'], yapilacakListeleri: ['todo.a', 'todo.b', 'todo.c'] };
  const depo = {
    'calendar.a': durum('calendar.a', 'unavailable', {}),
    'calendar.b': null,
    'todo.a': durum('todo.a', 'unavailable', {}),
    'todo.b': null,
    'todo.c': durum('todo.c', 'metin', {}),
  };
  const m = M.bilgiModeliOlustur({ ayarlar: ayar, durumAl: (k) => depo[k] });
  assert.deepEqual(m.takvimler.map((k) => [k.id, k.kullanilabilir, k.mesgul]), [['calendar.a', false, null], ['calendar.b', false, null], ['calendar.c', true, null]]);
  assert.deepEqual(m.listeler.map((k) => [k.id, k.kullanilabilir, k.acikSayisi]), [['todo.a', false, null], ['todo.b', false, null], ['todo.c', true, null]]);
});

test('rendererBilgi: karolar RENDERER_KARO_ALANLARI ile süzülür (HA adı gitmez); bozuk girdi güvenli', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: AYAR, durumAl });
  assert.ok(m.serit.every((k) => Object.hasOwn(k, 'ad')), 'ana süreç karosunda HA adı var');
  const r = M.rendererBilgi(m);
  for (const karo of [...r.serit, r.kartlar[0].karo]) {
    assert.deepEqual(Object.keys(karo), [...RENDERER_KARO_ALANLARI]);
    assert.equal(Object.hasOwn(karo, 'ad'), false);
  }
  assert.deepEqual(Object.keys(r).sort(), ['ayar', 'hizliListe', 'kartlar', 'listeler', 'sensorler', 'serit', 'takvimler']);
  assert.deepEqual(Object.keys(r.kartlar[0]).sort(), ['karo', 'secilmedi', 'tur', 'yuva']);
  // ana süreç nesnesiyle paylaşılmaz
  r.serit[0].ozellik.sayi = 999;
  assert.equal(m.serit[0].ozellik.sayi, 21.456);
  // bozuk girdi
  const bos = M.rendererBilgi(null);
  assert.deepEqual(bos, { ayar: { saatBicimi: 'sistem', tarihBicimi: 'orta', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 }, kartlar: [], serit: [], sensorler: [], takvimler: [], listeler: [], hizliListe: '' });
  const kirli = M.rendererBilgi({ ayar: { saatBicimi: 'x', tarihBicimi: 5, sensorGrafikSaat: 99, pilEsigi: 'a', takvimGunSayisi: 2.5 }, kartlar: [{ yuva: 7, tur: 'kamera', karo: null }], serit: 'x', hizliListe: 5 });
  assert.deepEqual(kirli.ayar, { saatBicimi: 'sistem', tarihBicimi: 'orta', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 });
  assert.deepEqual(kirli.kartlar, [{ yuva: 1, tur: 'saat', karo: null, secilmedi: false }]);
  assert.equal(kirli.hizliListe, '');
});

test('rendererModeli (yuzey-modeli): bilgi bölümü beyaz listeden geçerek gider; yoksa null', () => {
  const temel = yuzeyModeliOlustur({ favoriler: [], durumAl });
  assert.equal(rendererModeli(temel).bilgi, null);
  const bilgi = M.bilgiModeliOlustur({ ayarlar: AYAR, durumAl });
  const r = rendererModeli({ ...temel, bilgi });
  assert.deepEqual(r.bilgi, M.rendererBilgi(bilgi));
  assert.equal(Object.hasOwn(r.bilgi.serit[0], 'ad'), false);
});

test('sensorUyariSayisi: eşiğin altındaki pil, açık sorun/su sensörü; ulaşılamayan, birimi % olmayan ve eşikteki pil sayılmaz; kimlik bir kez sayılır', () => {
  const karolar = M.bilgiModeliOlustur({
    ayarlar: { sensorSeridi: ['sensor.kumanda_pil', 'binary_sensor.salon_hareket', 'binary_sensor.mutfak_su', 'sensor.salon_sicaklik'] },
    durumAl,
  }).serit;
  assert.equal(M.sensorUyariSayisi(karolar, 20), 2, 'pil %12 ve su sensörü açık; hareket sınıfı uyarı değil');
  assert.equal(M.sensorUyariSayisi(karolar, 12), 1, 'eşiğe eşit pil uyarı değil');
  assert.equal(M.sensorUyariSayisi(karolar, 13), 2);
  assert.equal(M.sensorUyariSayisi([...karolar, ...karolar], 20), 2, 'tekrar eden kimlik bir kez');
  const pilVolt = { id: 'sensor.v', alan: 'sensor', ozellik: { sinif: 'battery', birim: 'V', sayi: 2.9 } };
  const ulasilamaz = { id: 'sensor.u', alan: 'sensor', ozellik: { sinif: 'battery', birim: '%', sayi: null } };
  const ikiliPil = { id: 'binary_sensor.p', alan: 'binary_sensor', ozellik: { sinif: 'battery', acik: true } };
  const ikiliPilKapali = { id: 'binary_sensor.q', alan: 'binary_sensor', ozellik: { sinif: 'battery', acik: false } };
  assert.equal(M.sensorUyariSayisi([pilVolt, ulasilamaz, ikiliPilKapali]), 0);
  assert.equal(M.sensorUyariSayisi([ikiliPil]), 1);
  for (const kotu of [undefined, null, 'x', [null, {}, { id: 5 }]]) assert.equal(M.sensorUyariSayisi(kotu), 0, String(kotu));
  assert.deepEqual(M.bilgiKarolari(null), []);
  assert.equal(M.bilgiKarolari(M.bilgiModeliOlustur({ ayarlar: AYAR, durumAl })).length, 4, 'şerit 3 + hava kartı');
});

test('bilgiBolumunuEkle: favori sensör karoları genel gruplardan çıkıp bilgi.sensorler olur; diğer gruplar ve sıra korunur', () => {
  const favoriler = [
    { entity_id: 'sensor.salon_sicaklik', ad: 'Salon' },
    { entity_id: 'binary_sensor.salon_hareket', ad: 'Hareket' },
  ];
  const temel = yuzeyModeliOlustur({ favoriler, durumAl });
  assert.ok(temel.gruplar.some((g) => g.kod === 'sensor'), 'önkoşul: sensör grubu var');
  const model = M.bilgiBolumunuEkle(temel, { ayarlar: {}, durumAl });
  assert.equal(model, temel, 'model yerinde değiştirilir');
  assert.equal(model.gruplar.some((g) => g.kod === 'sensor'), false, 'sensör grubu genel gruplarda kalmaz');
  assert.deepEqual(model.bilgi.sensorler.map((k) => k.id), ['sensor.salon_sicaklik', 'binary_sensor.salon_hareket']);
  assert.ok(model.bilgi.sensorler.every((k) => k.varsayilanEylem === false), 'sensörün tek tıklama eylemi yok');
  // renderer'a giderken karolar beyaz listeden geçer
  const r = rendererModeli(model);
  assert.equal(r.bilgi.sensorler.length, 2);
  assert.equal(r.bilgi.sensorler.every((k) => !Object.hasOwn(k, 'ad')), true);
});

test('bilgiBolumunuEkle: sensör grubu yoksa sensorler boş; bozuk girdi fırlatmaz; yalnız sensor/binary_sensor alanı kabul edilir', () => {
  const bos = M.bilgiBolumunuEkle({ gruplar: [], sonlar: [] }, { ayarlar: {}, durumAl });
  assert.deepEqual(bos.bilgi.sensorler, []);
  assert.doesNotThrow(() => M.bilgiBolumunuEkle({}, { ayarlar: undefined, durumAl: () => undefined }));
  assert.deepEqual(M.bilgiBolumunuEkle({}, { ayarlar: undefined, durumAl: () => undefined }).gruplar, []);
  const karisik = M.bilgiModeliOlustur({ ayarlar: {}, durumAl, sensorKarolari: [{ id: 'sensor.a', alan: 'sensor' }, { id: 'light.b', alan: 'light' }, null, { id: 'binary_sensor.c', alan: 'binary_sensor' }] });
  assert.deepEqual(karisik.sensorler.map((k) => k.id), ['sensor.a', 'binary_sensor.c']);
  assert.deepEqual(M.bilgiModeliOlustur({ ayarlar: {}, durumAl, sensorKarolari: 'x' }).sensorler, []);
});
