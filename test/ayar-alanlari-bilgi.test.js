'use strict';

/**
 * Bilgi grubu ayar alanları (o-04 sensör şeridi, o-07 yapılacaklar, o-08 üst kartlar, o-09 grafik, o-10 takvim, o-11 geçmiş):
 * src/lib/ayar-alanlari.js tablosundaki gerçek satırlar. Varsayılanlar KAPALI/boş, kimlikler Kapı Kuralı'ndan geçer,
 * geçersiz değer varsayılana düşer, dışa aktarma ve Ayarlar özeti tablodan gelir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');
const { TR } = require('../src/lib/ceviri-varsayilan');

const BILGI_ALANLARI = [
  'sensorSeridi', 'sensorGrafik', 'sensorGrafikSaat', 'pilEsigi', 'sensorTepsiIpucu', 'ustKart1', 'ustKart2', 'havaVarligi',
  'saatBicimi', 'tarihBicimi', 'takvimler', 'takvimGunSayisi', 'yapilacakListeleri', 'hizliListe',
];

test('bilgi alanları tabloda; varsayılanlar: şerit/kart/takvim/liste boş, dış ağ seçeneği yok', () => {
  const adlar = A.AYAR_ALANLARI.map((a) => a.ad);
  for (const ad of BILGI_ALANLARI) assert.ok(adlar.includes(ad), ad);
  const varsayilan = A.alanlariDuzelt({}, {});
  assert.deepEqual(
    Object.fromEntries(BILGI_ALANLARI.map((a) => [a, varsayilan[a]])),
    {
      sensorSeridi: [],
      sensorGrafik: true,
      sensorGrafikSaat: 6,
      pilEsigi: 20,
      sensorTepsiIpucu: false,
      ustKart1: 'yok',
      ustKart2: 'yok',
      havaVarligi: '',
      saatBicimi: 'sistem',
      tarihBicimi: 'orta',
      takvimler: [],
      takvimGunSayisi: 3,
      yapilacakListeleri: [],
      hizliListe: '',
    },
  );
});

test('geçerli değerler korunur; sınır dışı ve yanlış türde değerler varsayılana düşer', () => {
  const iyi = A.alanlariDuzelt({
    sensorSeridi: ['sensor.salon_sicaklik', 'binary_sensor.salon_hareket', 'sensor.salon_sicaklik'],
    sensorGrafik: false,
    sensorGrafikSaat: 24,
    pilEsigi: '35',
    sensorTepsiIpucu: true,
    ustKart1: 'hava',
    ustKart2: 'sensor.dis_sicaklik',
    havaVarligi: 'weather.ev',
    saatBicimi: '12',
    tarihBicimi: 'uzun',
    takvimler: ['calendar.ev', 'calendar.is'],
    takvimGunSayisi: 14,
    yapilacakListeleri: ['todo.alisveris'],
    hizliListe: 'todo.alisveris',
  }, {});
  assert.deepEqual(iyi.sensorSeridi, ['sensor.salon_sicaklik', 'binary_sensor.salon_hareket'], 'tekrar atılır');
  assert.equal(iyi.sensorGrafik, false);
  assert.equal(iyi.sensorGrafikSaat, 24);
  assert.equal(iyi.pilEsigi, 35, 'metin sayı kabul edilir');
  assert.equal(iyi.ustKart1, 'hava');
  assert.equal(iyi.ustKart2, 'sensor.dis_sicaklik');
  assert.equal(iyi.saatBicimi, '12');
  assert.equal(iyi.takvimGunSayisi, 14);
  assert.deepEqual(iyi.takvimler, ['calendar.ev', 'calendar.is']);

  const kotu = A.alanlariDuzelt({
    sensorGrafik: 'evet',
    sensorGrafikSaat: 3,
    pilEsigi: 4,
    ustKart1: 'sicaklik',
    ustKart2: 42,
    havaVarligi: 'sensor.x',
    saatBicimi: '36',
    tarihBicimi: 'cok-uzun',
    takvimGunSayisi: 15,
    takvimler: 'calendar.ev',
    yapilacakListeleri: [1, 'todo.a'],
    hizliListe: 'light.x',
  }, {});
  assert.equal(kotu.sensorGrafik, true);
  assert.equal(kotu.sensorGrafikSaat, 6);
  assert.equal(kotu.pilEsigi, 20);
  assert.equal(kotu.ustKart1, 'yok');
  assert.equal(kotu.ustKart2, 'yok');
  assert.equal(kotu.havaVarligi, '');
  assert.equal(kotu.saatBicimi, 'sistem');
  assert.equal(kotu.tarihBicimi, 'orta');
  assert.equal(kotu.takvimGunSayisi, 3);
  assert.deepEqual(kotu.takvimler, []);
  assert.deepEqual(kotu.yapilacakListeleri, ['todo.a']);
  assert.equal(kotu.hizliListe, '');
});

test('seçilebilir alanlar sınırlıdır: şerit en çok 6, takvim ve liste en çok 4; alan türü zorunludur', () => {
  const s = A.alanlariDuzelt({
    sensorSeridi: Array.from({ length: 9 }, (_, i) => `sensor.s${i}`),
    takvimler: Array.from({ length: 9 }, (_, i) => `calendar.c${i}`),
    yapilacakListeleri: Array.from({ length: 9 }, (_, i) => `todo.l${i}`),
  }, {});
  assert.equal(s.sensorSeridi.length, 6);
  assert.equal(s.takvimler.length, 4);
  assert.equal(s.yapilacakListeleri.length, 4);
  const a = A.alanlariDuzelt({ sensorSeridi: ['light.x', 'calendar.ev', 'sensor.ok'], takvimler: ['sensor.x', 'calendar.ev'], yapilacakListeleri: ['calendar.x', 'todo.l'], hizliListe: 'calendar.ev' }, {});
  assert.deepEqual(a.sensorSeridi, ['sensor.ok']);
  assert.deepEqual(a.takvimler, ['calendar.ev']);
  assert.deepEqual(a.yapilacakListeleri, ['todo.l']);
  assert.equal(a.hizliListe, '');
});

test('KAPI KURALI: kapı/kilit/garaj kimlikleri hiçbir bilgi alanına yazılamaz; kart yuvası da süzülür', () => {
  const s = A.alanlariDuzelt({
    sensorSeridi: ['sensor.on_kapi_sicaklik', 'binary_sensor.garaj_hareket', 'sensor.front_door', 'sensor.salon'],
    ustKart1: 'sensor.garaj_sicaklik',
    ustKart2: 'lock.on_kapi',
    havaVarligi: 'weather.kapi_hava',
    takvimler: ['calendar.kapi_randevu', 'calendar.ev'],
    yapilacakListeleri: ['todo.diafon', 'todo.alisveris'],
    hizliListe: 'todo.kilit_isleri',
  }, {});
  assert.deepEqual(s.sensorSeridi, ['sensor.salon']);
  assert.equal(s.ustKart1, 'yok');
  assert.equal(s.ustKart2, 'yok');
  assert.equal(s.havaVarligi, '');
  assert.deepEqual(s.takvimler, ['calendar.ev']);
  assert.deepEqual(s.yapilacakListeleri, ['todo.alisveris']);
  assert.equal(s.hizliListe, '');
  // cover (perde dahil) ve kamera bu sürümde hiçbir bilgi alanında yok
  const c = A.alanlariDuzelt({ sensorSeridi: ['cover.perde'], ustKart1: 'cover.perde', ustKart2: 'camera.salon' }, {});
  assert.deepEqual(c.sensorSeridi, []);
  assert.equal(c.ustKart1, 'yok');
  assert.equal(c.ustKart2, 'yok');
});

test('ayar dosyası (şema): bilgi alanları ayarlariDuzelt çıktısında ve v5 dosyası varsayılanlarla yükselir', () => {
  const { ayarlar } = ayarlariDuzelt({ semaSurumu: 5, favoriler: [{ entity_id: 'light.a', ad: 'A' }] });
  for (const ad of BILGI_ALANLARI) assert.ok(Object.hasOwn(ayarlar, ad), ad);
  assert.deepEqual(ayarlar.sensorSeridi, []);
  assert.equal(ayarlar.ustKart1, 'yok');
  const { ayarlar: dolu } = ayarlariDuzelt({ semaSurumu: 6, sensorSeridi: ['sensor.a'], ustKart2: 'saat', takvimGunSayisi: 5 });
  assert.deepEqual(dolu.sensorSeridi, ['sensor.a']);
  assert.equal(dolu.ustKart2, 'saat');
  assert.equal(dolu.takvimGunSayisi, 5);
});

test('kayıt doğrulaması: geçersiz bilgi alanı mevcut değeri korur ve uyarı verir; geçerli değer kaydolur', () => {
  const { yeni, uyarilar } = A.ekGirdiDogrula({ ustKart1: 'saat', takvimGunSayisi: 99, sensorSeridi: ['sensor.a', 'lock.x'], saatBicimi: 'x' }, TR);
  assert.deepEqual(yeni, { ustKart1: 'saat', sensorSeridi: ['sensor.a'] });
  assert.deepEqual(uyarilar.map((u) => u.alan).sort(), ['saatBicimi', 'takvimGunSayisi']);
  // tam kayıt yolu (ayarlar:kaydet yükü): bilgi alanları adres/kısayol doğrulamasıyla birlikte geçer
  const sonuc = ayarGirdisiniDogrula(
    { yerelAdres: 'http://192.168.1.10:8123', disAdres: '', kisayol: 'Control+Alt+H', ustKart2: 'hava', pilEsigi: 30, hizliListe: 'lock.x', takvimler: ['calendar.ev'] },
    { kisayol: 'Control+Alt+H' },
  );
  assert.deepEqual(sonuc.hatalar, []);
  assert.equal(sonuc.yeni.ustKart2, 'hava');
  assert.equal(sonuc.yeni.pilEsigi, 30);
  assert.deepEqual(sonuc.yeni.takvimler, ['calendar.ev']);
  assert.equal(Object.hasOwn(sonuc.yeni, 'hizliListe'), false, 'kapı alanı kimliği reddedilir, mevcut değer korunur');
  assert.deepEqual(sonuc.uyarilar.map((u) => u.alan), ['hizliListe']);
});

test('dışa aktarma ve Ayarlar özeti: bilgi alanları aktarılır ve özete girer; sır taşıyan alan yok', () => {
  const aktarilan = A.aktarilanAlanlar();
  const ozet = A.ekAyarOzeti({ ustKart1: 'saat', sensorSeridi: ['sensor.a'] });
  for (const ad of BILGI_ALANLARI) {
    assert.ok(aktarilan.includes(ad), `${ad} aktarılır`);
    assert.ok(Object.hasOwn(ozet, ad), `${ad} özette`);
  }
  assert.equal(ozet.ustKart1, 'saat');
  assert.deepEqual(ozet.sensorSeridi, ['sensor.a']);
  assert.ok(!/anahtar|parola|token|webhook/i.test(JSON.stringify(BILGI_ALANLARI)), 'bilgi alanları sır içermez');
});

test('ayar uygulama: yalnız değişen bilgi alanları bildirilir', () => {
  const ayarlar = { ustKart1: 'yok', takvimGunSayisi: 3, sensorSeridi: [] };
  const degisen = A.ekAyarlariUygula(ayarlar, { ustKart1: 'saat', takvimGunSayisi: 3, sensorSeridi: ['sensor.a'] });
  assert.deepEqual(degisen.map((d) => d.ad).sort(), ['sensorSeridi', 'ustKart1']);
  assert.deepEqual(ayarlar.sensorSeridi, ['sensor.a']);
});
