'use strict';

/**
 * 1.4.0 cihaz kartları ve palet / komut satırı servis komutları: eylem katmanı (src/eylem.js) uçtan uca, sahte HA ile.
 * Ağ yok: haIstek sahtedir. Her servis ÇAĞRISI tek güvenli hattan (src/lib/eylem-hatti.js) geçer; bu dosya kartların ve komutların
 * gönderdiği yüklerin hatta nasıl karşılandığını sınar: izin listesi, cihaz sınırları, onay (basılı tutma), yüzey izni.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemKatmaniOlustur } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');

const varlik = (kimlik, state, nitelikler) => ({ entity_id: kimlik, state, attributes: nitelikler });
const SUNUCU = {
  'climate.salon': varlik('climate.salon', 'cool', { friendly_name: 'Salon klima', hvac_modes: ['off', 'cool', 'heat', 'auto'], min_temp: 16, max_temp: 30, target_temp_step: 0.5, temperature: 24, current_temperature: 26 }),
  'light.masa': varlik('light.masa', 'on', { friendly_name: 'Masa', supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, brightness: 150 }),
  'light.tavan': varlik('light.tavan', 'on', { friendly_name: 'Tavan', supported_color_modes: ['brightness'], brightness: 100 }),
  'media_player.tv': varlik('media_player.tv', 'playing', { friendly_name: 'Salon TV', volume_level: 0.3, is_volume_muted: false, source: 'HDMI 1', source_list: ['HDMI 1', 'HDMI 2', 'Kapı kamerası'] }),
  'fan.vantilator': varlik('fan.vantilator', 'on', { friendly_name: 'Vantilatör', percentage: 50, percentage_step: 25, preset_modes: ['Uyku', 'Turbo'] }),
  'humidifier.nem': varlik('humidifier.nem', 'on', { friendly_name: 'Nem alıcı', humidity: 50, min_humidity: 30, max_humidity: 80 }),
  'vacuum.supurge': varlik('vacuum.supurge', 'docked', { friendly_name: 'Süpürge', battery_level: 90 }),
  'input_select.ev_modu': varlik('input_select.ev_modu', 'Ev', { friendly_name: 'Ev modu', options: ['Ev', 'Dışarıda', 'Uyku'] }),
  'input_number.esik': varlik('input_number.esik', '5', { friendly_name: 'Eşik', min: 0, max: 10, step: 1 }),
  'timer.mutfak': varlik('timer.mutfak', 'idle', { friendly_name: 'Mutfak', duration: '0:05:00' }),
  'climate.kapi_odasi': varlik('climate.kapi_odasi', 'cool', { friendly_name: 'Kapı odası klima', hvac_modes: ['off', 'cool'], min_temp: 16, max_temp: 30 }),
  'input_select.kapi_modu': varlik('input_select.kapi_modu', 'Kapalı', { friendly_name: 'Mod', options: ['Kapalı', 'Kapı açık'] }),
};
const FAVORILER = [
  { entity_id: 'climate.salon', ad: 'Salon klima' },
  { entity_id: 'light.masa', ad: 'Masa' },
  { entity_id: 'light.tavan', ad: 'Tavan' },
  { entity_id: 'media_player.tv', ad: 'Salon TV' },
  { entity_id: 'fan.vantilator', ad: 'Vantilatör' },
  { entity_id: 'humidifier.nem', ad: 'Nem alıcı' },
  { entity_id: 'vacuum.supurge', ad: 'Süpürge' },
  { entity_id: 'input_select.ev_modu', ad: 'Ev modu' },
  { entity_id: 'input_number.esik', ad: 'Eşik' },
  { entity_id: 'timer.mutfak', ad: 'Mutfak' },
  { entity_id: 'climate.kapi_odasi', ad: 'Klima' },
  { entity_id: 'input_select.kapi_modu', ad: 'Mod' },
];

function ortam({ favoriler = FAVORILER, sunucu = SUNUCU, zamanSimdi = () => 1000 } = {}) {
  const istekler = [];
  const bildirimler = [];
  const sonlar = [];
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ({ favoriler }),
    depo,
    canliMi: () => false,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
      const e = /^\/api\/states\/(.+)$/.exec(yol);
      if (e) {
        if (!sunucu[e[1]]) throw Object.assign(new Error('x'), { tur: 'bulunamadi' });
        return sunucu[e[1]];
      }
      return [];
    },
    son: { ekle: (k) => sonlar.push(k) },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {},
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: () => yuzeyModeliOlustur({ favoriler, durumAl: (k) => sunucu[k] }).gruplar.flatMap((g) => g.karolar),
    gunluk: () => {},
    zaman: { setTimeout: () => 0 },
    simdi: zamanSimdi,
  });
  const postlar = () => istekler.filter((i) => i.yontem === 'POST');
  return { katman, istekler, postlar, bildirimler, sonlar };
}

/** Basılı tutma sınaması için ana sürecin saati elle ilerletilir (onay için en az ~0,8 sn gerekir). */
function basiliOrtam(secenek) {
  let t = 0;
  const o = ortam({ ...secenek, zamanSimdi: () => t });
  o.ilerle = (ms) => {
    t += ms;
  };
  return o;
}

const hata = (o) => o.bildirimler.filter((b) => b.tur === 'hata').map((b) => b.metin);

// --- panel / palet: servis eylemi ---------------------------------------------------------------------------------

test('klima: set_temperature cihazın sınırı ve adımı içinde tek POST olur; bildirim "komut gönderildi", "Son" listesine yazılmaz', async () => {
  const o = ortam();
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24.5 }, sonDeger: true });
  assert.equal(s.ok, true);
  assert.deepEqual(o.postlar(), [{ yol: '/api/services/climate/set_temperature', yontem: 'POST', govde: { entity_id: 'climate.salon', temperature: 24.5 } }]);
  assert.equal(o.bildirimler.length, 1);
  assert.equal(o.bildirimler[0].tur, 'ok');
  assert.deepEqual(o.sonlar, [], 'servis eylemi tek tıklamayla yinelenemez: Son listesine girmez');
});

test('klima: aralık dışı ya da adıma uymayan sıcaklık HA\'ya GİTMEZ; hata "değer cihazın izin verdiği aralıkta değil" der', async () => {
  const o = ortam();
  for (const sicaklik of [31, 15.5, 24.2, -5, 1e9, NaN]) {
    const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: sicaklik } });
    assert.equal(s.ok, false, String(sicaklik));
  }
  assert.deepEqual(o.postlar(), []);
  assert.match(hata(o)[0], /aralıkta değil/);
  const tur = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: '24' } });
  assert.deepEqual([tur.ok, tur.tur], [false, 'gecersiz']);
});

test('klima: ısıt/soğut aralığı, fan modu ve ön ayar tek güvenli hattan geçer; geçersiz aralık ya da listede olmayan seçenek HA yoluna GİTMEZ', async () => {
  const aralikli = varlik('climate.aralik', 'heat_cool', { friendly_name: 'Aralıklı', hvac_modes: ['off', 'heat_cool'], min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 427, target_temp_low: 20, target_temp_high: 24, fan_modes: ['auto', 'low'], preset_modes: ['eco', 'away'] });
  const o = ortam({ sunucu: { ...SUNUCU, 'climate.aralik': aralikli }, favoriler: [...FAVORILER, { entity_id: 'climate.aralik', ad: 'Aralıklı' }] });
  const calis = (servis, veri) => o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.aralik', servis, veri, sonDeger: true });
  assert.equal((await calis('set_temperature', { target_temp_low: 21, target_temp_high: 25.5 })).ok, true);
  assert.equal((await calis('set_fan_mode', { fan_mode: 'low' })).ok, true);
  assert.equal((await calis('set_preset_mode', { preset_mode: 'away' })).ok, true);
  assert.deepEqual(o.postlar().map((p) => [p.yol, p.govde]), [
    ['/api/services/climate/set_temperature', { entity_id: 'climate.aralik', target_temp_low: 21, target_temp_high: 25.5 }],
    ['/api/services/climate/set_fan_mode', { entity_id: 'climate.aralik', fan_mode: 'low' }],
    ['/api/services/climate/set_preset_mode', { entity_id: 'climate.aralik', preset_mode: 'away' }],
  ]);
  const once = o.postlar().length;
  for (const [servis, veri] of [
    ['set_temperature', { target_temp_low: 25, target_temp_high: 22 }],
    ['set_temperature', { target_temp_low: 22, target_temp_high: 22 }],
    ['set_temperature', { target_temp_low: 22 }],
    ['set_temperature', { temperature: 22, target_temp_low: 20, target_temp_high: 24 }],
    ['set_temperature', { target_temp_low: 10, target_temp_high: 24 }],
    ['set_fan_mode', { fan_mode: 'turbo' }],
    ['set_preset_mode', { preset_mode: 'Garaj kapısı' }],
  ]) assert.equal((await calis(servis, veri)).ok, false, servis + ' ' + JSON.stringify(veri));
  // aralık bildirmeyen cihaz (supported_features bit 2 yok): alt/üst gönderilemez
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { target_temp_low: 20, target_temp_high: 24 } })).ok, false);
  assert.equal(o.postlar().length, once);
});

test('klima: mod değişimi (onaylı servis) basılı tutma olmadan çalışmaz; ana sürecin saati dolmadan basılı tutma da yetmez', async () => {
  const o = basiliOrtam();
  const yok = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' } });
  assert.deepEqual([yok.ok, yok.tur], [false, 'onay-gerekli']);
  const sahte = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, basili: true });
  assert.deepEqual([sahte.ok, sahte.tur], [false, 'onay-gerekli'], 'renderer "basılı tuttum" demekle onay veremez');
  assert.deepEqual(o.postlar(), []);

  assert.equal(o.katman.basiliBasla('climate.salon'), true);
  o.ilerle(200);
  const erken = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, basili: true });
  assert.equal(erken.ok, false, '0,8 sn dolmadan onay yok');
  o.katman.basiliBasla('climate.salon');
  o.ilerle(900);
  const tamam = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, basili: true });
  assert.equal(tamam.ok, true);
  assert.deepEqual(o.postlar().map((p) => p.govde), [{ entity_id: 'climate.salon', hvac_mode: 'heat' }]);
});

test('klima: cihazın listesinde olmayan mod, bilinmeyen servis ve fazladan parametre reddedilir (basılı tutma olsa bile)', async () => {
  const o = basiliOrtam({ favoriler: [{ entity_id: 'climate.salon', ad: 'Salon klima', onay: false }] });
  for (const yuk of [
    { servis: 'set_hvac_mode', veri: { hvac_mode: 'dry' } },
    { servis: 'set_hvac_mode', veri: { hvac_mode: 'heat', fan_mode: 'high' } },
    { servis: 'set_temperature', veri: { temperature: 24, hvac_mode: 'heat' } },
    { servis: 'set_fan_mode', veri: { fan_mode: 'high' } },
    { servis: 'set_temperature' },
    { servis: 'unlock', veri: {} },
  ]) {
    const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', ...yuk });
    assert.equal(s.ok, false, JSON.stringify(yuk));
  }
  assert.deepEqual(o.postlar(), []);
  const iyi = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' } });
  assert.equal(iyi.ok, true, 'favoride onay:false ise mod değişimi onaysız');
});

test('klima: kapı sözcüğü taşıyan klima ve onun hiçbir servisi çalışmaz (Kapı Kuralı hatta yeniden uygulanır)', async () => {
  const o = ortam();
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.kapi_odasi', servis: 'set_temperature', veri: { temperature: 20 } });
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  assert.deepEqual(o.postlar(), []);
});

test('klima: tek tıklama eylemi yok: tepsi, kısayol ve yalın panel isteği servis göndermez; palet "klima" yalın isteği de göndermez', async () => {
  const o = ortam();
  await o.katman.tepsiTikla('climate.salon');
  await o.katman.kisayolla('climate.salon');
  const yalin = await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon' });
  assert.equal(yalin.ok, false);
  assert.deepEqual(o.postlar(), []);
});

test('ışık rengi: kelvin cihazın aralığına kırpılır, rgb yalnız renk destekleyen ışıkta gider; renk desteklemeyen ışığa renk gitmez', async () => {
  const o = ortam();
  const mutlak = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 900 } });
  assert.equal(mutlak.ok, false, '1000 K altı mutlak sınırın dışında');
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 25000 } })).ok, false, '20000 K üstü mutlak sınırın dışında');
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 1500 } });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 9000 } });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { rgb_color: [255, 0, 0] } });
  assert.deepEqual(o.postlar().map((p) => p.govde), [
    { entity_id: 'light.masa', color_temp_kelvin: 2200 },
    { entity_id: 'light.masa', color_temp_kelvin: 6500 },
    { entity_id: 'light.masa', rgb_color: [255, 0, 0] },
  ]);
  const renksiz = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.tavan', servis: 'turn_on', veri: { color_temp_kelvin: 3000 } });
  const renksiz2 = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.tavan', servis: 'turn_on', veri: { rgb_color: [1, 2, 3] } });
  assert.deepEqual([renksiz.ok, renksiz2.ok], [false, false]);
  assert.equal(o.postlar().length, 3);
  const ikisi = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { rgb_color: [1, 2, 3], color_temp_kelvin: 3000 } });
  assert.equal(ikisi.ok, false, 'kelvin ve rgb birlikte verilemez');
  const kotu = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.masa', servis: 'turn_on', veri: { rgb_color: [256, 0, 0] } });
  assert.equal(kotu.ok, false);
});

test('medya: ses 0-1 aralığındadır (ani yüksek ses yok), kaynak cihazın listesinden ve süzgeçten geçmiş olmalı; kapatma onaylıdır', async () => {
  const o = basiliOrtam();
  const iyi = await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.4 }, sonDeger: true });
  assert.equal(iyi.ok, true);
  for (const ses of [1.5, -0.1, 30]) {
    assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: ses } })).ok, false, String(ses));
  }
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'select_source', veri: { source: 'HDMI 2' } })).ok, true);
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'select_source', veri: { source: 'USB' } })).ok, false, 'listede olmayan kaynak');
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'select_source', veri: { source: 'Kapı kamerası' } })).ok, false, 'kapı sözcüklü kaynak seçilemez');
  const kapat = await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'turn_off' });
  assert.deepEqual([kapat.ok, kapat.tur], [false, 'onay-gerekli']);
  o.katman.basiliBasla('media_player.tv');
  o.ilerle(900);
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'media_player.tv', servis: 'turn_off', basili: true })).ok, true);
  assert.deepEqual(o.postlar().map((p) => p.yol), [
    '/api/services/media_player/volume_set',
    '/api/services/media_player/select_source',
    '/api/services/media_player/turn_off',
  ]);
});

test('vantilatör / nem alıcı / süpürge: izinli servisler cihazın sınırlarında çalışır; sınır dışı ve yabancı servis reddedilir', async () => {
  const o = ortam();
  const dene = (kimlik, servis, veri) => o.katman.yuzeydenCalistir('panel', { kimlik, servis, ...(veri ? { veri } : {}) });
  assert.equal((await dene('fan.vantilator', 'set_percentage', { percentage: 75 })).ok, true);
  assert.equal((await dene('fan.vantilator', 'set_percentage', { percentage: 101 })).ok, false);
  assert.equal((await dene('fan.vantilator', 'set_percentage', { percentage: 60 })).ok, true, 'vantilatör adımı cihazda bildirilse de yüzde 0-100 tamsayıdır');
  assert.equal((await dene('fan.vantilator', 'set_preset_mode', { preset_mode: 'Turbo' })).ok, true);
  assert.equal((await dene('fan.vantilator', 'set_preset_mode', { preset_mode: 'Yok' })).ok, false);
  assert.equal((await dene('humidifier.nem', 'set_humidity', { humidity: 65 })).ok, true);
  assert.equal((await dene('humidifier.nem', 'set_humidity', { humidity: 20 })).ok, false, 'cihazın alt sınırının altı');
  assert.equal((await dene('humidifier.nem', 'set_humidity', { humidity: 90 })).ok, false);
  for (const servis of ['start', 'pause', 'return_to_base', 'stop']) assert.equal((await dene('vacuum.supurge', servis)).ok, true, servis);
  assert.equal((await dene('vacuum.supurge', 'clean_spot')).ok, false);
  assert.equal((await dene('vacuum.supurge', 'send_command', { command: 'x' })).ok, false);
  assert.deepEqual(o.postlar().map((p) => p.yol.replace('/api/services/', '')), [
    'fan/set_percentage',
    'fan/set_percentage',
    'fan/set_preset_mode',
    'humidifier/set_humidity',
    'vacuum/start',
    'vacuum/pause',
    'vacuum/return_to_base',
    'vacuum/stop',
  ]);
});

test('seçici / sayı / zamanlayıcı varsayılan onaylıdır: basılı tutmadan gitmez; seçenek listede, sayı cihazın aralığında olmalı', async () => {
  const o = basiliOrtam();
  const gonder = (kimlik, servis, veri, basili) => o.katman.yuzeydenCalistir('panel', { kimlik, servis, ...(veri ? { veri } : {}), ...(basili ? { basili: true } : {}) });
  for (const [kimlik, servis, veri] of [
    ['input_select.ev_modu', 'select_option', { option: 'Uyku' }],
    ['input_number.esik', 'set_value', { value: 7 }],
    ['timer.mutfak', 'start'],
    ['timer.mutfak', 'cancel'],
  ]) {
    const s = await gonder(kimlik, servis, veri);
    assert.deepEqual([s.ok, s.tur], [false, 'onay-gerekli'], `${kimlik} ${servis}`);
  }
  assert.deepEqual(o.postlar(), []);

  const tut = async (kimlik, servis, veri) => {
    o.katman.basiliBasla(kimlik);
    o.ilerle(900);
    return gonder(kimlik, servis, veri, true);
  };
  assert.equal((await tut('input_select.ev_modu', 'select_option', { option: 'Uyku' })).ok, true);
  assert.equal((await tut('input_select.ev_modu', 'select_option', { option: 'Bilinmeyen' })).ok, false);
  assert.equal((await tut('input_number.esik', 'set_value', { value: 7 })).ok, true);
  assert.equal((await tut('input_number.esik', 'set_value', { value: 11 })).ok, false);
  assert.equal((await tut('input_number.esik', 'set_value', { value: -1 })).ok, false);
  assert.equal((await tut('timer.mutfak', 'start')).ok, true);
  assert.equal((await tut('timer.mutfak', 'finish')).ok, false, 'izinli servis listesinde olmayan');
  assert.equal(o.postlar().length, 3);
});

test('seçici: seçenek listesinde kapı sözcüğü olan yardımcı değişkenin kendisi hiçbir yüzeyde çalışmaz', async () => {
  const o = ortam();
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'input_select.kapi_modu', servis: 'select_option', veri: { option: 'Kapalı' } });
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  assert.deepEqual(o.postlar(), []);
});

test('renderer yükü: servis, parlaklık ve kapat birlikte verilemez; servis adı ve veri biçimi denetlenir; araDeger sessizdir', async () => {
  const o = ortam();
  const kotu = [
    { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24 }, parlaklik: 50 },
    { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24 }, kapat: true },
    { kimlik: 'climate.salon', servis: 'SET TEMP', veri: {} },
    { kimlik: 'climate.salon', servis: 'set_temperature', veri: [24] },
    { kimlik: 'climate.salon', servis: 'set_temperature', veri: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 } },
    { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24, x: 'a'.repeat(3000) } },
  ];
  for (const yuk of kotu) assert.deepEqual(await o.katman.yuzeydenCalistir('panel', yuk), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(o.postlar(), []);
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 23 }, araDeger: true });
  assert.equal(o.postlar().length, 1);
  assert.equal(o.bildirimler.length, 0, 'ara değer bildirim üretmez');
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 23.5 }, sonDeger: true });
  assert.equal(o.bildirimler.length, 1, 'son değer bildirim verir');
});

test('saf servisCalistir (ana süreç): aynı hat, kaynak ve servis biçimi denetlenir', async () => {
  const o = ortam();
  assert.deepEqual(await o.katman.servisCalistir({ kimlik: 'climate.salon', kaynak: 'palet', servis: 'Büyük' }), { ok: false, tur: 'gecersiz' });
  assert.equal((await o.katman.servisCalistir({ kimlik: 'climate.salon', kaynak: 'palet', servis: 'set_temperature', veri: { temperature: 22 } })).ok, true);
  assert.equal((await o.katman.servisCalistir({ kimlik: 'climate.salon', kaynak: 'yabanci', servis: 'turn_off' })).ok, false);
});

// --- komut satırı --------------------------------------------------------------------------------------------------

test('komut satırı: "salon klima 24" ve "masa sicak" hat üzerinden tek POST olur; ölçülü değerler cihaza göre kırpılır / doğrulanır', async () => {
  const o = ortam();
  const klima = await o.katman.komutSatirindan('salon klima 24');
  assert.equal(klima.ok, true);
  const masa = await o.katman.komutSatirindan('masa sicak');
  assert.equal(masa.ok, true);
  const mavi = await o.katman.komutSatirindan('masa mavi');
  assert.equal(mavi.ok, true);
  const ses = await o.katman.komutSatirindan('salon tv ses 30');
  assert.equal(ses.ok, true);
  const hiz = await o.katman.komutSatirindan('vantilator 75');
  assert.equal(hiz.ok, true);
  const nem = await o.katman.komutSatirindan('nem alici 55');
  assert.equal(nem.ok, true);
  const sup = await o.katman.komutSatirindan('supurge basla');
  assert.equal(sup.ok, true);
  assert.deepEqual(o.postlar().map((p) => [p.yol.replace('/api/services/', ''), p.govde]), [
    ['climate/set_temperature', { entity_id: 'climate.salon', temperature: 24 }],
    ['light/turn_on', { entity_id: 'light.masa', color_temp_kelvin: 2700 }],
    ['light/turn_on', { entity_id: 'light.masa', rgb_color: [30, 90, 255] }],
    ['media_player/volume_set', { entity_id: 'media_player.tv', volume_level: 0.3 }],
    ['fan/set_percentage', { entity_id: 'fan.vantilator', percentage: 75 }],
    ['humidifier/set_humidity', { entity_id: 'humidifier.nem', humidity: 55 }],
    ['vacuum/start', { entity_id: 'vacuum.supurge' }],
  ]);
  assert.deepEqual(o.sonlar, []);
});

test('komut satırı: aralık dışı değer "sinir", desteklenmeyen işlem "desteklenmiyor" olur; HA\'ya hiçbir şey gitmez; ileti nedeni söyler', async () => {
  const o = ortam();
  assert.deepEqual(await o.katman.komutSatirindan('salon klima 45'), { ok: false, tur: 'sinir' });
  assert.deepEqual(await o.katman.komutSatirindan('tavan sicak'), { ok: false, tur: 'desteklenmiyor' });
  assert.deepEqual(await o.katman.komutSatirindan('nem alici 5'), { ok: false, tur: 'sinir' });
  assert.deepEqual(await o.katman.komutSatirindan('salon tv ses 500'), { ok: false, tur: 'sinir' });
  assert.deepEqual(o.postlar(), []);
  assert.match(hata(o)[0], /aralıkta değil/);
  assert.match(hata(o)[1], /desteklemiyor/);
});

test('komut satırı: onaylı servisler (klima modu, TV kapatma, seçici, sayı, zamanlayıcı) çalışmaz — "kaynak-izinsiz"; onay:false ise çalışır', async () => {
  const o = ortam();
  for (const ad of ['salon klima isit', 'salon tv kapat', 'ev modu uyku', 'esik 7', 'mutfak basla']) {
    const s = await o.katman.komutSatirindan(ad);
    assert.deepEqual([ad, s.ok, s.tur], [ad, false, 'kaynak-izinsiz']);
  }
  assert.deepEqual(o.postlar(), []);
  const serbest = ortam({
    favoriler: FAVORILER.map((f) => (['climate.salon', 'media_player.tv', 'input_select.ev_modu'].includes(f.entity_id) ? { ...f, onay: false } : f)),
  });
  assert.equal((await serbest.katman.komutSatirindan('salon klima isit')).ok, true);
  assert.equal((await serbest.katman.komutSatirindan('salon tv kapat')).ok, true);
  assert.equal((await serbest.katman.komutSatirindan('ev modu uyku')).ok, true);
});

test('komut satırı: komutsuz ad (tek tıklama eylemi olmayan karo) "komut gerekli" der; belirsiz ad çalıştırmaz; kapı sözcüklü klima bulunamaz', async () => {
  const o = ortam();
  assert.deepEqual(await o.katman.komutSatirindan('salon klima'), { ok: false, tur: 'komutGerekli' });
  assert.match(hata(o)[0], /tek tıklama eylemi yok/);
  assert.deepEqual(await o.katman.komutSatirindan('salon tv'), { ok: false, tur: 'komutGerekli' });
  assert.deepEqual(await o.katman.komutSatirindan('klima 22'), { ok: false, tur: 'bulunamadi' }, 'kapı sözcüklü klima karo olarak da yok; "Salon klima" adı "klima" tam adı değil');
  assert.deepEqual(o.postlar(), []);
});

test('komut satırı: Türkçe harfsiz yazım ve sayı biçimleri ("23,5", "%40") ve İngilizce komut sözcükleri çözülür', async () => {
  const o = ortam();
  assert.equal((await o.katman.komutSatirindan('Salon Klima 23,5')).ok, true);
  assert.equal((await o.katman.komutSatirindan('salon tv volume 40')).ok, true);
  assert.equal((await o.katman.komutSatirindan('masa warm')).ok, true);
  assert.equal((await o.katman.komutSatirindan('vantilator %50')).ok, true);
  assert.deepEqual(o.postlar().map((p) => p.govde), [
    { entity_id: 'climate.salon', temperature: 23.5 },
    { entity_id: 'media_player.tv', volume_level: 0.4 },
    { entity_id: 'light.masa', color_temp_kelvin: 2700 },
    { entity_id: 'fan.vantilator', percentage: 50 },
  ]);
});
