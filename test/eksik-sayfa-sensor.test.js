'use strict';

/**
 * Özel sayfalarda (sekmeler; o-24) sensör favorileri: sensör karoları genel gruplardan çıkarılıp bilgi bölümüne taşındığı için
 * sayfa üyesi olan bir sensör sayfada kayboluyordu. Sayfa artık sensör üyelerini de sayfanın sırasıyla çizer (aynı sensör karosu:
 * değer, gösterge, mini grafik, dikkat vurgusu; tıklayınca geçmiş açılır). Sensör eylem düğmesi değildir: servis çağrısı yoktur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, modelYap, panelAc, akit, sinifli, bulSinif } = require('./eksik-yuzey-sahte');

const SICAKLIK = karo('sensor.salon_sicaklik', 'Salon sıcaklık', { alan: 'sensor', grup: 'sensor', ozellik: { deger: '21.4', sayi: 21.4, birim: '°C', sinif: 'temperature', hassasiyet: 1, enAz: null, enCok: null } });
const PIL = karo('sensor.kumanda_pil', 'Kumanda pil', { alan: 'sensor', grup: 'sensor', ozellik: { deger: '12', sayi: 12, birim: '%', sinif: 'battery', hassasiyet: null, enAz: null, enCok: null } });
const HAREKET = karo('binary_sensor.salon_hareket', 'Salon hareket', { alan: 'binary_sensor', grup: 'sensor', ozellik: { acik: true, sinif: 'motion' } });
const AMPUL = karo('light.ampul', 'Ampul', { grup: 'isik', grupEtiketi: 'Işık' });
const PRIZ = karo('switch.priz', 'Priz');

const AYAR = { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 };
const bilgiYap = (sensorler) => ({ ayar: AYAR, kartlar: [], serit: [], sensorler, takvimler: [], listeler: [], hizliListe: '' });

function modelOlustur(sayfalar, sensorler = [SICAKLIK, PIL, HAREKET]) {
  return {
    ...modelYap(AMPUL, PRIZ),
    sayfalar,
    bilgi: bilgiYap(sensorler),
  };
}

const sekmeBul = (sayfa, ad) => sayfa.oge('sekmeler').children.find((s) => s.textContent === ad);
const karoEtiketleri = (sayfa) => bulSinif(sayfa, 'karo-etiket').map((o) => o.textContent);

test('sayfa üyesi sensör favorisi özel sayfada görünür ve sayfanın sırasıyla çizilir', async () => {
  const sayfa = await panelAc({
    model: modelOlustur([{ id: 'salon', ad: 'Salon', kimlikler: ['sensor.salon_sicaklik', 'light.ampul', 'binary_sensor.salon_hareket'] }]),
  });
  sekmeBul(sayfa, 'Salon').gonder('click');
  await akit();
  assert.deepEqual(karoEtiketleri(sayfa), ['Salon sıcaklık', 'Ampul', 'Salon hareket'], 'sayfanın kendi sırası: sensör, ışık, ikili sensör');
  const sensor = bulSinif(sayfa, 'sensor-karo');
  assert.equal(sensor.length, 2);
  assert.match(sensor[0].textContent, /21,4 °C/, 'değer biçimlenmiş yazılır');
  assert.match(sensor[1].textContent, /Hareket/i, 'ikili sensör sınıfına uygun sözcük');
});

test('"Tümü" görünümü bozulmaz: sensörler kendi "Sensör" bölümünde, sayfa üyeliği onları çoğaltmaz', async () => {
  const sayfa = await panelAc({ model: modelOlustur([{ id: 'salon', ad: 'Salon', kimlikler: ['sensor.salon_sicaklik'] }]) });
  assert.deepEqual(karoEtiketleri(sayfa).filter((e) => e.startsWith('Salon') || e.startsWith('Kumanda')), ['Salon sıcaklık', 'Kumanda pil', 'Salon hareket']);
  assert.equal(bulSinif(sayfa, 'grup-sensor').length, 1);
  sekmeBul(sayfa, 'Salon').gonder('click');
  await akit();
  assert.equal(bulSinif(sayfa, 'grup-sensor').length, 0, 'özel sayfada ayrı sensör bölümü yoktur');
  assert.deepEqual(karoEtiketleri(sayfa), ['Salon sıcaklık']);
});

test('sayfadaki sensöre tıklayınca geçmiş görünümü açılır; sensör hiçbir servis çağrısı yapmaz', async () => {
  const sayfa = await panelAc({
    model: modelOlustur([{ id: 'salon', ad: 'Salon', kimlikler: ['sensor.salon_sicaklik'] }]),
    okuYaniti: (istek) => (istek.tur === 'gecmis' ? { ok: true, veri: Object.fromEntries(istek.kimlikler.map((k) => [k, []])) } : { ok: true, veri: [] }),
  });
  sekmeBul(sayfa, 'Salon').gonder('click');
  await akit();
  const sensor = bulSinif(sayfa, 'sensor-karo')[0];
  sensor.gonder('click');
  await akit();
  assert.ok(bulSinif(sayfa, 'bilgi-detay').length > 0, 'geçmiş görünümü açıldı');
  assert.deepEqual(sayfa.calistirmalar(), [], 'sensör karosu eylem göndermez');
});

test('modelde olmayan sensör kimliği sayfada çizilmez; sayfada yalnız sensör olsa da "sayfa boş" yazılmaz', async () => {
  const sayfa = await panelAc({
    model: modelOlustur([
      { id: 'sayfa1', ad: 'Yalnız sensör', kimlikler: ['sensor.kumanda_pil'] },
      { id: 'sayfa2', ad: 'Eksik', kimlikler: ['sensor.silinmis'] },
    ]),
  });
  sekmeBul(sayfa, 'Yalnız sensör').gonder('click');
  await akit();
  assert.deepEqual(karoEtiketleri(sayfa), ['Kumanda pil']);
  assert.equal(bulSinif(sayfa, 'bos').length, 0);
  assert.ok(sinifli(bulSinif(sayfa, 'sensor-karo')[0], 'dikkat'), 'pili azalan sensör sayfada da vurgulanır');
  sekmeBul(sayfa, 'Eksik').gonder('click');
  await akit();
  assert.deepEqual(karoEtiketleri(sayfa), []);
  assert.equal(bulSinif(sayfa, 'bos').length, 1, 'üyesi çizilemeyen sayfa boş açıklamasını gösterir');
});

test('üst kartlar ve sensör şeridi sayfada da durur; bilgi bölümü yoksa (eski model) sayfa eskisi gibi çalışır', async () => {
  const model = modelOlustur([{ id: 'salon', ad: 'Salon', kimlikler: ['light.ampul'] }]);
  model.bilgi.serit = [SICAKLIK];
  const sayfa = await panelAc({ model });
  sekmeBul(sayfa, 'Salon').gonder('click');
  await akit();
  assert.equal(bulSinif(sayfa, 'sensor-serit').length, 1);
  assert.deepEqual(karoEtiketleri(sayfa), ['Ampul']);

  const eski = await panelAc({ model: { ...modelOlustur([{ id: 'salon', ad: 'Salon', kimlikler: ['light.ampul', 'sensor.salon_sicaklik'] }]), bilgi: null } });
  sekmeBul(eski, 'Salon').gonder('click');
  await akit();
  assert.deepEqual(karoEtiketleri(eski), ['Ampul'], 'bilgi modeli yoksa sensör üyesi sessizce atlanır');
});
