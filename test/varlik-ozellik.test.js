'use strict';

/**
 * Karo modelinin güvenli öznitelik alt kümesi (src/lib/varlik-ozellik.js) — 1.4.0.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { guvenliOzellikler, sayiAl, isoAl } = require('../src/lib/varlik-ozellik');

const YASAK_ANAHTARLAR = ['entity_picture', 'media_image_url', 'entity_picture_local', 'access_token', 'latitude', 'longitude', 'friendly_name', 'ad'];
const v = (kimlik, state, attributes = {}) => ({ entity_id: kimlik, state, attributes });

function anahtarlar(nesne, yol = '') {
  if (!nesne || typeof nesne !== 'object') return [];
  return Object.entries(nesne).flatMap(([a, d]) => [yol + a, ...(Array.isArray(d) ? [] : anahtarlar(d, `${yol}${a}.`))]);
}

test('GÜVENLİK: resim, erişim anahtarı, konum ve canlı HA adı hiçbir modelde yok', () => {
  const zehirli = {
    friendly_name: 'Salon',
    entity_picture: '/api/media_player_proxy/media_player.tv?token=GIZLI',
    entity_picture_local: '/x',
    media_image_url: 'http://x/y.jpg',
    access_token: 'GIZLI',
    latitude: 41,
    longitude: 29,
  };
  for (const kimlik of ['light.a', 'switch.a', 'fan.a', 'climate.a', 'media_player.a', 'humidifier.a', 'vacuum.a', 'input_select.a', 'select.a', 'input_number.a', 'number.a', 'timer.a', 'todo.a', 'sensor.a', 'binary_sensor.a', 'weather.a', 'calendar.a']) {
    const o = guvenliOzellikler(v(kimlik, 'on', zehirli));
    const metin = JSON.stringify(o);
    assert.ok(!metin.includes('GIZLI'), kimlik);
    assert.ok(!metin.includes('Salon'), `${kimlik}: canlı HA adı modele girmez`);
    for (const a of anahtarlar(o)) assert.ok(!YASAK_ANAHTARLAR.includes(a.split('.').at(-1)), `${kimlik}: ${a}`);
  }
});

test('kayıtsız / Kapı Kuralı alanı ya da bozuk girdi: null', () => {
  for (const kotu of [null, undefined, 'light.a', {}, v('lock.a', 'locked'), v('cover.perde', 'open'), v('camera.a', 'idle'), { entity_id: 5 }]) {
    assert.equal(guvenliOzellikler(kotu), null, JSON.stringify(kotu));
  }
  assert.equal(guvenliOzellikler(v('switch.a', 'on')), null, 'aç/kapa için ek öznitelik yok');
  assert.equal(guvenliOzellikler(v('scene.a', 'on')), null);
});

test('medya: metinler süzgeçten geçer; kapı adı taşıyan başlık/kaynak düşer; ham nesne kopyalanmaz', () => {
  const nitelik = {
    media_title: 'Garage door chime',
    media_artist: 'Sanatçı',
    media_album_name: 'x'.repeat(300),
    volume_level: 0.4,
    is_volume_muted: false,
    source: 'Kapı kamerası',
    source_list: ['HDMI 1', 'Kapı kamerası', 'Spotify', 'HDMI 1', 42],
    media_duration: 200,
    media_position: 20,
    media_position_updated_at: '2026-10-16T10:00:00+00:00',
    extra: { gizli: 1 },
  };
  const o = guvenliOzellikler(v('media_player.tv', 'playing', nitelik));
  assert.equal(o.durum, 'playing');
  assert.equal(o.baslik, null);
  assert.equal(o.sanatci, 'Sanatçı');
  assert.equal(Array.from(o.album).length, 100);
  assert.equal(o.kaynak, null);
  assert.deepEqual(o.kaynaklar, ['HDMI 1', 'Spotify']);
  assert.equal(o.ses, 0.4);
  assert.equal(o.konumZamani, '2026-10-16T10:00:00+00:00');
  assert.equal(Object.hasOwn(o, 'extra'), false);
  assert.equal(guvenliOzellikler(v('media_player.tv', 'hacked', { volume_level: 5 })).durum, null);
  assert.equal(guvenliOzellikler(v('media_player.tv', 'on', { volume_level: 5 })).ses, null, 'aralık dışı ses');
});

test('iklim: sayılar aralıkta, mod ve modlar sabit kümeden', () => {
  const o = guvenliOzellikler(v('climate.salon', 'heat', { current_temperature: 21.5, temperature: '22', min_temp: 7, max_temp: 35, target_temp_step: 0.5, hvac_modes: ['off', 'heat', 'evil'], hvac_action: 'heating', current_humidity: 300 }));
  assert.deepEqual(o, { mevcutSicaklik: 21.5, hedefSicaklik: 22, hedefAlt: null, hedefUst: null, enAz: 7, enCok: 35, adim: 0.5, mod: 'heat', modlar: ['off', 'heat'], hvacEylemi: 'heating', mevcutNem: null });
});

test('seçici, sayı, zamanlayıcı, süpürge, ışık, fan', () => {
  assert.deepEqual(guvenliOzellikler(v('input_select.mod', 'Ev', { options: ['Ev', 'Tatil'] })), { secenek: 'Ev', secenekler: ['Ev', 'Tatil'] });
  assert.deepEqual(guvenliOzellikler(v('number.hedef', '12.5', { min: 0, max: 100, step: 0.5, unit_of_measurement: '%', mode: 'slider' })), { deger: 12.5, enAz: 0, enCok: 100, adim: 0.5, birim: '%', kip: 'slider' });
  assert.deepEqual(guvenliOzellikler(v('timer.firin', 'active', { duration: '0:10:00', remaining: '0:05:00', finishes_at: 'yarın' })), { durum: 'active', sure: '0:10:00', kalan: '0:05:00', bitis: null });
  assert.deepEqual(guvenliOzellikler(v('vacuum.robot', 'docked', { battery_level: 80 })), { durum: 'docked', pil: 80 });
  const isik = guvenliOzellikler(v('light.a', 'on', { color_temp_kelvin: 3000, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, rgb_color: [1, 2, 300], supported_color_modes: ['color_temp', 'bogus'] }));
  assert.deepEqual(isik, { renkSicakligi: 3000, enAzKelvin: 2000, enCokKelvin: 6500, rgb: null, renkModlari: ['color_temp'] });
  const fan = guvenliOzellikler(v('fan.a', 'on', { percentage: 33, oscillating: 'yes', preset_mode: 'Door mode', preset_modes: ['auto', 'Door mode'] }));
  assert.deepEqual(fan, { yuzde: 33, adimYuzde: null, salinim: null, onAyar: null, onAyarlar: ['auto'] });
});

test('sensör ve ikili sensör: değer metni süzülür; hava; takvim; yapılacaklar', () => {
  const s = guvenliOzellikler(v('sensor.sicaklik', '21.4', { unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement', suggested_display_precision: 1 }));
  assert.deepEqual(s, { deger: '21.4', sayi: 21.4, birim: '°C', sinif: 'temperature', durumSinifi: 'measurement', hassasiyet: 1 });
  assert.equal(guvenliOzellikler(v('sensor.son', 'Ön kapı açıldı')).deger, null, 'kapı metni taşıyan sensör değeri gösterilmez');
  assert.deepEqual(guvenliOzellikler(v('binary_sensor.hareket', 'on', { device_class: 'motion' })), { acik: true, sinif: 'motion' });
  assert.equal(guvenliOzellikler(v('binary_sensor.x', 'unavailable')).acik, null);
  const h = guvenliOzellikler(v('weather.ev', 'rainy', { temperature: 12, temperature_unit: '°C', humidity: 80, wind_speed: 10, wind_speed_unit: 'km/h', pressure: 1012, forecast: [{}] }));
  assert.deepEqual(h, { durum: 'rainy', sicaklik: 12, birim: '°C', nem: 80, ruzgar: 10, ruzgarBirim: 'km/h', basinc: 1012 });
  assert.deepEqual(guvenliOzellikler(v('calendar.ev', 'on', { message: 'Gizli toplantı' })), { mesgul: true });
  assert.deepEqual(guvenliOzellikler(v('todo.alisveris', '3')), { acikSayisi: 3 });
});

test('yardımcılar: sayiAl ve isoAl', () => {
  assert.equal(sayiAl('21.5'), 21.5);
  assert.equal(sayiAl(''), null);
  assert.equal(sayiAl('1e400'), null);
  assert.equal(sayiAl('x'.repeat(40)), null);
  assert.equal(sayiAl(5, { min: 0, max: 4 }), null);
  assert.equal(isoAl('2026-10-16T10:00:00Z'), '2026-10-16T10:00:00Z');
  assert.equal(isoAl('2026-13-40T99:00'), null);
  assert.equal(isoAl('dün'), null);
});
