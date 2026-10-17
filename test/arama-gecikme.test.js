'use strict';

/**
 * Palet gecikmeli eylem söz dizimi (o-15, src/lib/arama.js gecikmeCoz + paletSorgusu): "salon 10 dk sonra kapat", "fan 30dk", "fan 2sa".
 * Çözümleme yalnız ayrıştırır; doğrulama ana süreçtedir (test/gecikmeli-eylem.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { gecikmeCoz, paletSorgusu, GECIKME_ALANLARI, EN_AZ_GECIKME_DK, EN_COK_GECIKME_DK } = require('../src/lib/arama');

const OGELER = [
  { etiket: 'Salon lambası', grupEtiketi: 'Işık', alan: 'light', parlaklikKontrol: true },
  { etiket: 'Fan', grupEtiketi: 'Diğer', alan: 'fan' },
  { etiket: 'Masa prizi', grupEtiketi: 'Diğer', alan: 'switch' },
  { etiket: 'Film', grupEtiketi: 'Sahne', alan: 'scene' },
  { etiket: 'PC kapat', grupEtiketi: 'PC', alan: 'button', yikici: true },
  { etiket: 'Oyun priz', grupEtiketi: 'Diğer', alan: 'switch', yikici: true },
  { etiket: 'Bozuk lamba', grupEtiketi: 'Işık', alan: 'light', kullanilabilir: false },
  { etiket: 'Klima', grupEtiketi: 'Diğer', alan: 'climate' },
];

test('gecikmeCoz: "<ad> <süre> sonra <fiil>" (Türkçe) ve "<ad> <fiil> in <süre>" (İngilizce)', () => {
  assert.deepEqual(gecikmeCoz('salon 10 dk sonra kapat'), { metin: 'salon', dakika: 10, yon: 'kapat' });
  assert.deepEqual(gecikmeCoz('salon 10dk sonra kapat'), { metin: 'salon', dakika: 10, yon: 'kapat' });
  assert.deepEqual(gecikmeCoz('Salon Lambası 2 sa sonra aç'), { metin: 'Salon Lambası', dakika: 120, yon: 'ac' });
  assert.deepEqual(gecikmeCoz('salon 1saat sonra yak'), { metin: 'salon', dakika: 60, yon: 'ac' });
  assert.deepEqual(gecikmeCoz('salon 5 dakika sonra söndür'), { metin: 'salon', dakika: 5, yon: 'kapat' });
  assert.deepEqual(gecikmeCoz('salon off in 10 min'), { metin: 'salon', dakika: 10, yon: 'kapat' });
  assert.deepEqual(gecikmeCoz('lamp on in 2 hours'), { metin: 'lamp', dakika: 120, yon: 'ac' });
  assert.deepEqual(gecikmeCoz('lamp 5 minutes later off'), { metin: 'lamp', dakika: 5, yon: 'kapat' });
  assert.deepEqual(gecikmeCoz('SALON 10 DK SONRA KAPAT'), { metin: 'SALON', dakika: 10, yon: 'kapat' });
});

test('gecikmeCoz: "<ad> <süre>" süreli (şimdi aç, süre sonra kapat); bileşik ve ondalık süreler', () => {
  assert.deepEqual(gecikmeCoz('fan 30dk'), { metin: 'fan', dakika: 30, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('fan 30 dk'), { metin: 'fan', dakika: 30, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('fan 2sa'), { metin: 'fan', dakika: 120, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('fan 1sa30dk'), { metin: 'fan', dakika: 90, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('fan 1,5 sa'), { metin: 'fan', dakika: 90, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('fan 1.5h'), { metin: 'fan', dakika: 90, yon: 'sureli' });
  assert.deepEqual(gecikmeCoz('masa prizi 45min'), { metin: 'masa prizi', dakika: 45, yon: 'sureli' });
});

test('gecikmeCoz: sınırlar 1 dk - 24 saat; dışı "sinir" hatası taşır', () => {
  assert.equal(EN_AZ_GECIKME_DK, 1);
  assert.equal(EN_COK_GECIKME_DK, 1440);
  assert.equal(gecikmeCoz('fan 1dk').hata, undefined);
  assert.equal(gecikmeCoz('fan 24sa').hata, undefined);
  assert.equal(gecikmeCoz('fan 1440dk').hata, undefined);
  for (const sorgu of ['fan 0dk', 'fan 1441dk', 'fan 25sa', 'fan 0,1dk', 'fan 9999dk']) assert.equal(gecikmeCoz(sorgu).hata, 'sinir', sorgu);
});

test('gecikmeCoz: birimsiz sayı, birimsiz süre, ad ya da fiil eksik, rastgele metin süre sayılmaz', () => {
  for (const sorgu of ['led 40', 'oda 2', 'ışık %40', 'salon 10 dk sonra', 'salon sonra kapat', '10dk', 'dk', '30 dk', 'sonra kapat', 'salon kapat', 'fan 30 sn', 'fan x30dk', 'fan 30dkx', '', '   ', 'a b c d e f g h i j k l m 10dk']) {
    assert.equal(gecikmeCoz(sorgu), null, JSON.stringify(sorgu));
  }
  assert.equal(gecikmeCoz(undefined), null);
  assert.equal(gecikmeCoz(null), null);
  assert.equal(gecikmeCoz(5), null);
});

test('ertelenebilir alanlar: ışık, priz, vantilatör, input_boolean, nem alıcı; sahne/düğme/iklim/kilit/kapı/kepenk/alarm/kamera/vana/otomasyon yok', () => {
  assert.deepEqual([...GECIKME_ALANLARI].sort(), ['fan', 'humidifier', 'input_boolean', 'light', 'switch']);
});

test('paletSorgusu: gecikmeli satırlar yalnız ertelenebilir, yıkıcı olmayan, kullanılabilir ve adı AYNEN geçen öğelerden gelir', () => {
  const s = paletSorgusu('fan 30dk', OGELER);
  assert.deepEqual(s.sonuclar.map((r) => [r.oge.etiket, r.gecikme, r.eylem, r.komutHatasi]), [['Fan', { dakika: 30, yon: 'sureli' }, null, undefined]]);
  const kapat = paletSorgusu('salon 10 dk sonra kapat', OGELER);
  assert.deepEqual(kapat.sonuclar.map((r) => [r.oge.etiket, r.gecikme.yon, r.gecikme.dakika]), [['Salon lambası', 'kapat', 10]]);
  assert.equal(kapat.sonuclar[0].parlaklik, null);
  assert.equal(kapat.sonuclar[0].kapat, false);
  assert.equal(kapat.parlaklik, null);
  // sahne, düğme, yıkıcı priz, kullanılamayan lamba, iklim: gecikmeli satır olmaz
  for (const sorgu of ['film 10dk', 'pc 10 dk sonra kapat', 'oyun 10dk', 'bozuk 10dk', 'klima 10 dk sonra kapat']) {
    assert.ok(paletSorgusu(sorgu, OGELER).sonuclar.every((r) => r.gecikme === undefined), sorgu);
  }
});

test('paletSorgusu: dağınık harf eşleşmesi gecikmeli satır üretmez ("ses 10dk" LED şeridi zamanlamaz); sözcükler adın içinde geçer', () => {
  const ogeler = [{ etiket: 'LED şerit', grupEtiketi: 'Işık', alan: 'light' }, { etiket: 'Ses +', grupEtiketi: 'Medya', alan: 'button' }];
  assert.ok(paletSorgusu('ses 10dk', ogeler).sonuclar.every((r) => r.gecikme === undefined));
  assert.equal(paletSorgusu('led 10dk', ogeler).sonuclar[0].gecikme.dakika, 10);
  assert.equal(paletSorgusu('şerit 10dk', ogeler).sonuclar[0].gecikme.dakika, 10, 'Türkçe harf katlama');
  assert.equal(paletSorgusu('serit 10dk', ogeler).sonuclar[0].gecikme.dakika, 10);
  assert.ok(paletSorgusu('lxd 10dk', ogeler).sonuclar.every((r) => r.gecikme === undefined));
});

test('paletSorgusu: süre aralık dışıysa satır komutHatasi "sinir" taşır ve eylemi yoktur', () => {
  const s = paletSorgusu('fan 5000 dk sonra kapat', OGELER);
  assert.equal(s.sonuclar.length, 1);
  assert.deepEqual([s.sonuclar[0].komutHatasi, s.sonuclar[0].eylem, s.sonuclar[0].gecikme.dakika], ['sinir', null, 5000]);
});

test('paletSorgusu: tam adı sorgu olan öğe varsa gecikme aranmaz; parlaklık ve servis komutları bozulmaz', () => {
  const ogeler = [{ etiket: 'Fan 30dk', grupEtiketi: 'Diğer', alan: 'fan' }, ...OGELER];
  assert.ok(paletSorgusu('fan 30dk', ogeler).sonuclar.every((r) => r.gecikme === undefined));
  const led = paletSorgusu('salon 40', OGELER);
  assert.equal(led.sonuclar[0].parlaklik, 40);
  assert.equal(led.sonuclar[0].gecikme, undefined);
  const klima = paletSorgusu('klima 24', [{ etiket: 'Klima', grupEtiketi: 'Diğer', alan: 'climate', ozellik: { enAz: 16, enCok: 30 } }]);
  assert.equal(klima.sonuclar[0].eylem.servis, 'set_temperature');
});
