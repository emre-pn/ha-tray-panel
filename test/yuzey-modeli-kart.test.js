'use strict';

/**
 * 1.4.0 cihaz kartları, ana süreç tarafı model: panel grupları (İklim, Yardımcılar), karo başına `ozellik` / `varsayilanEylem` /
 * `onayliServisler`, tepsi menüsünün tek tıklama eylemi olmayan karoları atlaması ve Ayarlar cihaz listesinin `tekTiklama` alanı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { yuzeyModeliOlustur, karoOlustur, rendererModeli } = require('../src/lib/yuzey-modeli');
const { GRUPLAR, grupBul } = require('../src/lib/favoriler');
const { tepsiMenuPlani } = require('../src/lib/tepsi-menu');
const { eylemSinifi } = require('../src/lib/eylem-sinifi');
const ANA = require('../src/lib/ceviri/ana');

const varlik = (kimlik, state, nitelikler = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: kimlik, ...nitelikler } });
const DEPO = {
  'light.masa': varlik('light.masa', 'on', { brightness: 128 }),
  'climate.salon': varlik('climate.salon', 'heat', { hvac_modes: ['off', 'heat', 'cool'], temperature: 22, min_temp: 16, max_temp: 30 }),
  'media_player.tv': varlik('media_player.tv', 'playing', { volume_level: 0.4, media_title: 'Film' }),
  'fan.v': varlik('fan.v', 'on', { percentage: 40, percentage_step: 20 }),
  'humidifier.n': varlik('humidifier.n', 'on', { min_humidity: 30, max_humidity: 70, humidity: 50 }),
  'vacuum.s': varlik('vacuum.s', 'docked', { battery_level: 77 }),
  'input_select.ev_modu': varlik('input_select.ev_modu', 'Ev', { options: ['Ev', 'Dışarıda'] }),
  'input_number.esik': varlik('input_number.esik', '4', { min: 0, max: 10, step: 1 }),
  'timer.mutfak': varlik('timer.mutfak', 'idle', { duration: '0:05:00' }),
  'scene.film': varlik('scene.film', 'unknown'),
  'button.pc_bilgisayari_kapat': varlik('button.pc_bilgisayari_kapat', 'unknown'),
  'sensor.sicaklik': varlik('sensor.sicaklik', '21.5', { unit_of_measurement: '°C' }),
};
const favori = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: DEPO[kimlik].attributes.friendly_name, ...ek });
const durumAl = (k) => DEPO[k];
const TUMU = Object.keys(DEPO).map((k) => favori(k));
const harita = (model) => new Map(model.gruplar.flatMap((g) => g.karolar.map((k) => [k.id, { ...k, grupKodu: g.kod }])));

test('grup tablosu: Işık, İklim, Perde, Sahne, PC, Medya, Yardımcılar, Sensör, Diğer sırası; her grubun iki dilde etiketi var', () => {
  assert.deepEqual(GRUPLAR.map((g) => g.kod), ['isik', 'iklim', 'perde', 'sahne', 'pc', 'medya', 'yardimci', 'sensor', 'diger']);
  for (const g of GRUPLAR) {
    const satir = ANA.satirlar?.find?.((s) => s[0] === `grup.${g.kod}`) ?? null;
    assert.ok(satir || ANA.tr?.[`grup.${g.kod}`], `grup.${g.kod} sözlükte`);
    assert.ok(ANA.tr[`grup.${g.kod}`] && ANA.en[`grup.${g.kod}`], `grup.${g.kod} tr + en`);
  }
});

test('grupBul: iklim, nem alıcı ve vantilatör "İklim"; medya oynatıcı "Medya"; seçici, sayı, zamanlayıcı "Yardımcılar"; sensör "Sensör"; eski gruplar korunur', () => {
  const beklenen = {
    'climate.x': 'iklim',
    'humidifier.x': 'iklim',
    'fan.x': 'iklim',
    'media_player.x': 'medya',
    'input_select.x': 'yardimci',
    'select.x': 'yardimci',
    'input_number.x': 'yardimci',
    'number.x': 'yardimci',
    'timer.x': 'yardimci',
    'sensor.x': 'sensor',
    'binary_sensor.x': 'sensor',
    'vacuum.x': 'diger',
    'light.x': 'isik',
    'scene.x': 'sahne',
    'switch.x': 'diger',
    'button.x': 'diger',
  };
  for (const [kimlik, grup] of Object.entries(beklenen)) assert.equal(grupBul(kimlik), grup, kimlik);
  assert.equal(grupBul('button.pc_bilgisayari_kapat'), 'pc', 'hazır listedeki açık tablo korunur');
});

test('panel modeli: gruplar sabit sırada, İklim ve Yardımcılar kendi gruplarında; onay isteyen yardımcı "Onaylı" satırına taşınmaz, PC kapat taşınır', () => {
  const model = yuzeyModeliOlustur({ favoriler: TUMU, durumAl });
  assert.deepEqual(model.gruplar.map((g) => g.kod), ['isik', 'iklim', 'sahne', 'medya', 'yardimci', 'sensor', 'diger', 'onayli'], 'boş grup (PC kapat onaylıya gittiği için PC) çizilmez');
  const k = harita(model);
  assert.equal(k.get('climate.salon').grupKodu, 'iklim');
  assert.equal(k.get('fan.v').grupKodu, 'iklim');
  assert.equal(k.get('humidifier.n').grupKodu, 'iklim');
  assert.equal(k.get('media_player.tv').grupKodu, 'medya');
  assert.equal(k.get('input_select.ev_modu').grupKodu, 'yardimci');
  assert.equal(k.get('input_number.esik').grupKodu, 'yardimci');
  assert.equal(k.get('timer.mutfak').grupKodu, 'yardimci');
  assert.equal(k.get('sensor.sicaklik').grupKodu, 'sensor');
  assert.equal(k.get('input_select.ev_modu').sinif, 'yikici', 'yeni yardımcı karolar varsayılan onaylı');
  assert.equal(k.get('button.pc_bilgisayari_kapat').grupKodu, 'onayli');
});

test('karo: ozellik güvenli alt kümedir (ham öznitelik yok), varsayilanEylem tek tıklama servisi olup olmadığını söyler', () => {
  const model = yuzeyModeliOlustur({ favoriler: TUMU, durumAl });
  const k = harita(model);
  const beklenenEylem = {
    'light.masa': true,
    'scene.film': true,
    'fan.v': true,
    'humidifier.n': true,
    'climate.salon': false,
    'media_player.tv': false,
    'vacuum.s': false,
    'input_select.ev_modu': false,
    'input_number.esik': false,
    'timer.mutfak': false,
    'sensor.sicaklik': false,
  };
  for (const [kimlik, deger] of Object.entries(beklenenEylem)) assert.equal(k.get(kimlik).varsayilanEylem, deger, kimlik);
  assert.deepEqual(k.get('climate.salon').ozellik.modlar, ['off', 'heat', 'cool']);
  assert.equal(k.get('climate.salon').ozellik.hedefSicaklik, 22);
  assert.equal(k.get('media_player.tv').ozellik.baslik, 'Film');
  assert.equal(k.get('fan.v').ozellik.adimYuzde, 20);
  assert.equal(k.get('vacuum.s').ozellik.pil, 77);
  assert.equal(JSON.stringify(model).includes('friendly_name'), false, 'ham öznitelikler modele girmez');
});

test('onayliServisler: klima modu, TV kapatma, seçici / sayı / zamanlayıcı servisleri varsayılan onaylıdır; favoride onay:false ise liste boşalır (yıkıcı servis hariç)', () => {
  const model = yuzeyModeliOlustur({ favoriler: TUMU, durumAl });
  const k = harita(model);
  assert.deepEqual(k.get('climate.salon').onayliServisler, ['set_hvac_mode']);
  assert.deepEqual(k.get('media_player.tv').onayliServisler, ['turn_off']);
  assert.deepEqual(k.get('input_select.ev_modu').onayliServisler, ['select_option']);
  assert.deepEqual(k.get('input_number.esik').onayliServisler, ['set_value']);
  assert.deepEqual(k.get('timer.mutfak').onayliServisler, ['start', 'pause', 'cancel']);
  assert.deepEqual(k.get('light.masa').onayliServisler, []);
  assert.deepEqual(k.get('vacuum.s').onayliServisler, []);

  const serbest = yuzeyModeliOlustur({
    favoriler: ['climate.salon', 'media_player.tv', 'input_select.ev_modu', 'timer.mutfak'].map((id) => favori(id, { onay: false })),
    durumAl,
  });
  const s = harita(serbest);
  for (const id of ['climate.salon', 'media_player.tv', 'input_select.ev_modu', 'timer.mutfak']) assert.deepEqual(s.get(id).onayliServisler, [], id);
  assert.equal(s.get('input_select.ev_modu').sinif, 'zararsiz');

  const zorunlu = yuzeyModeliOlustur({ favoriler: [favori('climate.salon', { onay: true })], durumAl });
  assert.deepEqual(harita(zorunlu).get('climate.salon').onayliServisler.sort(), ['set_fan_mode', 'set_hvac_mode', 'set_preset_mode', 'set_temperature', 'turn_off', 'turn_on'].sort(), 'kullanıcı "onay iste" dediyse bütün servisler onaylı');
});

test('eylemSinifi: klima modu ve TV kapatma onaylı servistir (yalın karo zararsız); seçici varsayılan onaylı ama onay kapatılabilir', () => {
  const klima = DEPO['climate.salon'];
  assert.equal(eylemSinifi(klima, {}).sinif, 'zararsiz');
  assert.equal(eylemSinifi(klima, {}, 'set_temperature').sinif, 'zararsiz');
  assert.equal(eylemSinifi(klima, {}, 'set_hvac_mode').sinif, 'yikici');
  assert.equal(eylemSinifi(klima, { onay: false }, 'set_hvac_mode').sinif, 'zararsiz');
  assert.equal(eylemSinifi(DEPO['media_player.tv'], {}, 'turn_off').sinif, 'yikici');
  assert.equal(eylemSinifi(DEPO['media_player.tv'], {}, 'volume_set').sinif, 'zararsiz');
  assert.equal(eylemSinifi(DEPO['input_select.ev_modu'], {}, 'select_option').zorunlu, false);
  assert.equal(eylemSinifi(DEPO['input_select.ev_modu'], { onay: false }, 'select_option').sinif, 'zararsiz');
});

test('tepsi menüsü: tek tıklama eylemi olmayan karolar (iklim, medya, süpürge, seçici, sayı, zamanlayıcı, sensör) hiçbir listede yoktur', () => {
  const karolar = yuzeyModeliOlustur({ favoriler: TUMU, durumAl }).gruplar.flatMap((g) => g.karolar);
  const plan = tepsiMenuPlani(karolar);
  const kimlikler = [...plan.ust, ...plan.alt, ...plan.yikici].map((o) => o.kimlik);
  for (const yok of ['climate.salon', 'media_player.tv', 'vacuum.s', 'input_select.ev_modu', 'input_number.esik', 'timer.mutfak', 'sensor.sicaklik']) {
    assert.equal(kimlikler.includes(yok), false, yok);
  }
  for (const var_ of ['light.masa', 'fan.v', 'humidifier.n', 'scene.film', 'button.pc_bilgisayari_kapat']) assert.equal(kimlikler.includes(var_), true, var_);
});

test('Kapı Kuralı: kapı sözcüklü ad ya da seçenek taşıyan yeni alan karoları modele hiç girmez', () => {
  const kapi = {
    'climate.kapi': varlik('climate.kapi', 'heat', { friendly_name: 'Kapı klima', hvac_modes: ['heat'] }),
    'media_player.garaj': varlik('media_player.garaj', 'on', { friendly_name: 'Garaj TV' }),
    'input_select.mod': varlik('input_select.mod', 'a', { friendly_name: 'Mod', options: ['a', 'Kapı açık'] }),
    'timer.interkom': varlik('timer.interkom', 'idle', { friendly_name: 'Interkom sayacı' }),
    'select.mod2': varlik('select.mod2', 'a', { friendly_name: 'Mod iki', options: ['x', 'Kilidi aç'] }),
    'input_number.kepenk': varlik('input_number.kepenk', '1', { friendly_name: 'Kepenk', min: 0, max: 3, step: 1 }),
    'cover.perde': varlik('cover.perde', 'open', { friendly_name: 'Perde' }),
    'camera.salon': varlik('camera.salon', 'idle', { friendly_name: 'Salon kamera' }),
    'climate.iyi': varlik('climate.iyi', 'heat', { friendly_name: 'Yatak klima', hvac_modes: ['heat'] }),
  };
  const model = yuzeyModeliOlustur({ favoriler: Object.keys(kapi).map((k) => ({ entity_id: k, ad: kapi[k].attributes.friendly_name })), durumAl: (k) => kapi[k] });
  assert.deepEqual([...harita(model).keys()], ['climate.iyi']);
});

test('medya başlığında kapı sözcüğü varsa başlık modele girmez (kart yine çizilir, başlık yok)', () => {
  const tv = varlik('media_player.tv', 'playing', { friendly_name: 'TV', media_title: 'Ön kapı zili çalıyor', media_artist: 'Sanatçı', source_list: ['HDMI', 'Kapı kamerası'] });
  const karo = karoOlustur({ entity_id: 'media_player.tv', ad: 'TV' }, tv);
  assert.equal(karo.ozellik.baslik, null);
  assert.equal(karo.ozellik.sanatci, 'Sanatçı');
  assert.deepEqual(karo.ozellik.kaynaklar, ['HDMI'], 'kapı sözcüklü kaynak listeden düşer');
});

test('rendererModeli: yeni alanlar kopyalanır, ana süreç nesnesiyle paylaşılmaz', () => {
  const model = yuzeyModeliOlustur({ favoriler: [favori('climate.salon')], durumAl });
  const r = rendererModeli(model);
  const asil = model.gruplar[0].karolar[0];
  const kopya = r.gruplar[0].karolar[0];
  assert.deepEqual(kopya.ozellik, asil.ozellik);
  assert.notEqual(kopya.ozellik, asil.ozellik);
  assert.notEqual(kopya.onayliServisler, asil.onayliServisler);
  assert.equal('ad' in kopya, false, 'HA adı renderer\'a gitmez');
});

test('main.js: Ayarlar cihaz listesi her cihaza tekTiklama alanını varsayilanServis\'e göre yazar; tek tıklama eylemi olmayan kısayola uygun değildir', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(kaynak, /tekTiklama: varsayilanServis\(alan\) !== null/);
  assert.match(kaynak, /kisayolUygun: siniflama\.sinif === SINIF\.ZARARSIZ && varsayilanServis\(alan\) !== null/);
});
