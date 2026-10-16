'use strict';

/**
 * Ayar alanı kaydı (src/lib/ayar-alanlari.js) — şema 6. Özellik ajanları kendi alanlarını AYAR_ALANLARI'na ekler; bu dosya
 * yardımcıları ve akışı kendi örnek listesiyle sınar (kalıp: alanlariDuzelt / ekGirdiDogrula / ekAyarlariUygula).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { SEMA_SURUMU, ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { TR } = require('../src/lib/ceviri-varsayilan');

const ORNEK = [
  A.mantiksalAlan('panelHerZamanUstte', false),
  A.secenekAlan('saatBicimi', ['24', '12'], '24'),
  A.tamsayiAlan('metinOlcegi', 100, 150, 100),
  A.metinAlan('notMetni', { enUzun: 20 }),
  A.metinAlan('havaVarligi', { enUzun: 120, desen: /^weather\.[a-z0-9_]+$/ }),
  A.kimlikAlan('yapilacakListesi', { alanlar: ['todo'] }),
  A.kimlikListesiAlan('seritSensorleri', { enCok: 3, alanlar: ['sensor', 'binary_sensor'] }),
  A.nesneAlan('kurallar', { varsayilan: [], duzelt: (ham) => (Array.isArray(ham) && ham.every((k) => typeof k === 'string') ? [...ham] : undefined) }),
  A.mantiksalAlan('yerelGizli', true, { aktarilir: false, ozette: false }),
];

test('şema sürümü 6; kayıt şimdilik boş ve dondurulmuş; göç 6 tanımlı', () => {
  assert.equal(SEMA_SURUMU, 6);
  assert.equal(A.GUNCEL_EK_SURUM, 6);
  assert.ok(Object.isFrozen(A.AYAR_ALANLARI));
  assert.ok(A.GOCLER.some((g) => g.surum === 6));
});

test('tanım: geçersiz ya da korunan ad, listede olmayan varsayılan, duzelt\'siz nesne alanı fırlatır', () => {
  for (const ad of ['__proto__', 'constructor', 'semaSurumu', 'Buyuk', 'a', 'ad-tire', '', 5]) {
    assert.throws(() => A.mantiksalAlan(ad), /invalid field name/, String(ad));
  }
  assert.throws(() => A.secenekAlan('saatBicimi', ['24'], '12'));
  assert.throws(() => A.nesneAlan('kurallar', { varsayilan: [] }));
  const alan = ORNEK[0];
  assert.ok(Object.isFrozen(alan));
  assert.deepEqual([alan.tip, alan.surum, alan.aktarilir, alan.ozette], ['mantiksal', 6, true, true]);
});

test('alanlariDuzelt: geçerli değer korunur; geçersiz ya da eksik değer varsayılana düşer; varsayılan dosyası ikinci sırada', () => {
  const ham = {
    panelHerZamanUstte: 'evet',
    saatBicimi: '12',
    metinOlcegi: '125',
    notMetni: '  Merhaba dünya, bu çok uzun bir not  ',
    havaVarligi: 'sensor.x',
    yapilacakListesi: 'todo.alisveris',
    seritSensorleri: ['sensor.a', 'sensor.a', 'binary_sensor.on_kapi', 'lock.x', 'light.b', 'sensor.b', 'sensor.c', 'sensor.d'],
    kurallar: [1],
  };
  const sonuc = A.alanlariDuzelt(ham, { panelHerZamanUstte: true }, ORNEK);
  assert.deepEqual(sonuc, {
    panelHerZamanUstte: true,
    saatBicimi: '12',
    metinOlcegi: 125,
    notMetni: 'Merhaba dünya, bu ço',
    havaVarligi: '',
    yapilacakListesi: 'todo.alisveris',
    seritSensorleri: ['sensor.a', 'sensor.b', 'sensor.c'],
    kurallar: [],
    yerelGizli: true,
  });
  assert.deepEqual(A.alanlariDuzelt(null, null, ORNEK).metinOlcegi, 100);
  assert.deepEqual(A.alanlariDuzelt({ metinOlcegi: 151 }, {}, ORNEK).metinOlcegi, 100);
  assert.deepEqual(A.alanlariDuzelt({ metinOlcegi: 120.5 }, {}, ORNEK).metinOlcegi, 100);
});

test('KAPI KURALI: kimlik alanlarına kapı/kilit kimliği ya da kapı sözcüklü metin yazılamaz', () => {
  const s = A.alanlariDuzelt(
    { yapilacakListesi: 'todo.kapi_isleri', seritSensorleri: ['binary_sensor.garaj', 'sensor.front_door_temp', 'sensor.ok'], notMetni: 'Garaj kapısı' },
    {},
    ORNEK,
  );
  assert.equal(s.yapilacakListesi, '');
  assert.deepEqual(s.seritSensorleri, ['sensor.ok']);
  assert.equal(s.notMetni, '');
  assert.equal(A.alanlariDuzelt({ yapilacakListesi: 'calendar.ev' }, {}, ORNEK).yapilacakListesi, '', 'alan listesi dışı');
});

test('duzelt fırlatırsa varsayılana düşülür; varsayılan nesneleri kopyalanır (paylaşılmaz)', () => {
  const liste = [A.nesneAlan('kurallar', { varsayilan: [], duzelt: () => { throw new Error('x'); } })];
  const a = A.alanlariDuzelt({ kurallar: [1] }, {}, liste);
  assert.deepEqual(a, { kurallar: [] });
  a.kurallar.push('degisti');
  assert.deepEqual(A.alanlariDuzelt({}, {}, liste).kurallar, []);
});

test('ekGirdiDogrula: yalnız gönderilen alanlar; geçersiz değer mevcut olanı korur ve çevrilmiş uyarı verir', () => {
  const { yeni, uyarilar } = A.ekGirdiDogrula({ saatBicimi: '12', metinOlcegi: 999, seritSensorleri: ['sensor.a'], bilinmeyen: 1 }, TR, ORNEK);
  assert.deepEqual(yeni, { saatBicimi: '12', seritSensorleri: ['sensor.a'] });
  assert.deepEqual(uyarilar, [{ alan: 'metinOlcegi', mesaj: TR('kaydet.ekAlanGecersiz') }]);
  assert.deepEqual(A.ekGirdiDogrula(null, TR, ORNEK), { yeni: {}, uyarilar: [] });
});

test('ekAyarlariUygula: yalnız değişenleri yazar ve eski/yeni ile bildirir', () => {
  const ayarlar = { saatBicimi: '24', metinOlcegi: 100, seritSensorleri: ['sensor.a'] };
  const degisen = A.ekAyarlariUygula(ayarlar, { saatBicimi: '12', metinOlcegi: 100, seritSensorleri: ['sensor.a'] }, ORNEK);
  assert.deepEqual(degisen, [{ ad: 'saatBicimi', eski: '24', yeni: '12' }]);
  assert.equal(ayarlar.saatBicimi, '12');
  assert.deepEqual(A.ekAyarlariUygula(ayarlar, null, ORNEK), []);
});

test('tipler, aktarılanlar ve özet: aktarilir/ozette bayrakları uyulur', () => {
  assert.deepEqual(A.alanTipleri(ORNEK), {
    panelHerZamanUstte: 'mantiksal',
    saatBicimi: 'metin',
    metinOlcegi: 'sayi',
    notMetni: 'metin',
    havaVarligi: 'metin',
    yapilacakListesi: 'metin',
    seritSensorleri: 'dizi',
    kurallar: 'dizi',
    yerelGizli: 'mantiksal',
  });
  assert.ok(!A.aktarilanAlanlar(ORNEK).includes('yerelGizli'));
  assert.ok(A.aktarilanAlanlar(ORNEK).includes('seritSensorleri'));
  const ozet = A.ekAyarOzeti({ saatBicimi: '12' }, ORNEK);
  assert.equal(ozet.saatBicimi, '12');
  assert.equal(ozet.metinOlcegi, 100, 'ayarda yoksa varsayılan');
  assert.equal(Object.hasOwn(ozet, 'yerelGizli'), false);
  // boş kayıtla bugünkü uygulama: hiçbir ek alan yok
  assert.deepEqual(A.alanTipleri([]), {});
  assert.deepEqual(A.aktarilanAlanlar([]), []);
  assert.deepEqual(A.ekAyarOzeti({}, []), {});
});

test('gocleriUygula: yalnız kayıtlı sürümden yeni göçler, sürüm sırasıyla', () => {
  const sira = [];
  const gocler = [
    { surum: 8, uygula: (a) => sira.push(['8', a.x]) },
    { surum: 6, uygula: (a, ham, notlar) => (sira.push(['6', ham.eski]), notlar.push('goc6'), (a.x = 1)) },
    { surum: 7, uygula: (a) => (sira.push(['7', a.x]), (a.x = 2)) },
  ];
  const ayarlar = {};
  const notlar = [];
  A.gocleriUygula(ayarlar, { eski: 'e' }, 5, notlar, gocler);
  assert.deepEqual(sira, [['6', 'e'], ['7', 1], ['8', 2]]);
  assert.deepEqual(notlar, ['goc6']);
  sira.length = 0;
  A.gocleriUygula({}, {}, 7, [], gocler);
  assert.deepEqual(sira.map((s) => s[0]), ['8']);
});

test('ayar-sema: v5 dosyası 6\'ya yükselir, kullanıcı değerleri ve favoriler korunur', () => {
  const ham = { semaSurumu: 5, favoriler: [{ entity_id: 'light.a', ad: 'A' }], tema: 'koyu' };
  const { ayarlar } = ayarlariDuzelt(ham);
  assert.equal(ayarlar.semaSurumu, 6);
  assert.deepEqual(ayarlar.favoriler.map((f) => f.entity_id), ['light.a']);
});
