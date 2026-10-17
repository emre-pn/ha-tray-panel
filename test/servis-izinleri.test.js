'use strict';

/**
 * Servis izin listesi ve parametre doğrulama (src/lib/servis-izinleri.js) — 1.4.0.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/servis-izinleri');

const v = (kimlik, attributes = {}, state = 'on') => ({ entity_id: kimlik, state, attributes });
const ret = (sonuc) => (sonuc.ok ? 'ok' : sonuc.neden);

test('KAPI KURALI: kilit/kapı/kepenk/alarm/siren servisleri ve alanları izin tablosunda hiç yok; cover/valve/automation yalnız bilinçli eklenen servisleriyle', () => {
  const yasakServisler = /lock|unlock|alarm|arm|disarm|siren|gate|garage|door/;
  // cover (perde/jaluzi), valve ve automation servisleri 1.4.0 cihaz grubunda BİLİNÇLİ eklendi; başka alanda açma/kapama/tetikleme servisi yok.
  const CIHAZ_ALANLARI = { cover: ['close_cover', 'open_cover', 'set_cover_position', 'stop_cover'], valve: ['close_valve', 'open_valve'], automation: ['trigger', 'turn_off', 'turn_on'] };
  const cihazServisi = /^(open|close|stop)_(cover|valve)$|^set_cover_position$|^trigger$/;
  for (const [alan, servisler] of Object.entries(S.SERVIS_IZINLERI)) {
    for (const servis of Object.keys(servisler)) {
      assert.doesNotMatch(servis, yasakServisler, `${alan}.${servis}`);
      if (cihazServisi.test(servis)) assert.ok(Object.hasOwn(CIHAZ_ALANLARI, alan), `${alan}.${servis}: açma/kapama/tetikleme servisi yalnız cover, valve, automation alanında`);
    }
  }
  for (const [alan, servisler] of Object.entries(CIHAZ_ALANLARI)) assert.deepEqual([...S.izinliServisler(alan)].sort(), servisler, alan);
  for (const alan of ['lock', 'alarm_control_panel', 'siren', 'camera', 'homeassistant', 'shell_command', 'rest_command', 'notify', 'persistent_notification']) {
    assert.deepEqual(S.izinliServisler(alan), [], alan);
    assert.equal(ret(S.servisDogrula(alan, 'turn_on', {}, v(`${alan}.x`))), 'servis', alan);
  }
});

test('1.4.0 cihaz grubu: cover servisleri zararsız; konum 0-100 tamsayı; valve ve automation servisleri HEPSİ yıkıcı (zorunlu onay)', () => {
  const perde = v('cover.salon', { device_class: 'curtain', current_position: 40 }, 'open');
  for (const servis of ['open_cover', 'close_cover', 'stop_cover']) {
    assert.deepEqual(S.servisDogrula('cover', servis, undefined, perde), { ok: true, govde: { entity_id: 'cover.salon' }, sinif: 'zararsiz' }, servis);
    assert.equal(ret(S.servisDogrula('cover', servis, { position: 5 }, perde)), 'parametre', `${servis}: parametresiz`);
  }
  assert.deepEqual(S.servisDogrula('cover', 'set_cover_position', { position: 40 }, perde).govde, { entity_id: 'cover.salon', position: 40 });
  assert.equal(S.servisDogrula('cover', 'set_cover_position', { position: 0 }, perde).ok, true);
  assert.equal(S.servisDogrula('cover', 'set_cover_position', { position: 100 }, perde).ok, true);
  assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', { position: 101 }, perde)), 'sinir');
  assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', { position: -1 }, perde)), 'sinir');
  assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', { position: 40.5 }, perde)), 'parametre', 'tamsayı olmalı');
  assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', {}, perde)), 'eksik');
  for (const kotu of ['40', NaN, Infinity, null, true]) assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', { position: kotu }, perde)), 'parametre', String(kotu));
  assert.equal(ret(S.servisDogrula('cover', 'set_cover_position', { position: 40, tilt_position: 50 }, perde)), 'parametre', 'eğim konumu yok');
  for (const [alan, servisler] of [['valve', ['open_valve', 'close_valve']], ['automation', ['trigger', 'turn_on', 'turn_off']]]) {
    for (const servis of servisler) {
      const sonuc = S.servisDogrula(alan, servis, undefined, v(`${alan}.x`));
      assert.equal(sonuc.ok, true, `${alan}.${servis}`);
      assert.equal(sonuc.sinif, 'yikici', `${alan}.${servis} yıkıcı`);
      assert.equal(S.servisSinifi(alan, servis), 'yikici');
      assert.equal(ret(S.servisDogrula(alan, servis, { x: 1 }, v(`${alan}.x`))), 'parametre', `${alan}.${servis}: parametresiz`);
    }
  }
  // automation: turn_on/turn_off dışında HA'nın başka otomasyon servisi (reload, toggle) yok; valve: konum ve toggle servisi yok
  for (const servis of ['reload', 'toggle']) assert.equal(ret(S.servisDogrula('automation', servis, {}, v('automation.x'))), 'servis', servis);
  for (const servis of ['set_valve_position', 'toggle', 'stop_valve']) assert.equal(ret(S.servisDogrula('valve', servis, {}, v('valve.x'))), 'servis', servis);
});

test('1.4.0 dış tetik yasağının TEK kaynağı eylem-sinifi.js disKaynakIzni işlevidir: servis-izinleri.js ikinci bir dış tetik işlevi / listesi taşımaz', () => {
  assert.equal(S.disTetigeUygunServisMi, undefined);
  const { disKaynakIzni } = require('../src/lib/eylem-sinifi');
  assert.equal(disKaynakIzni('light', 'turn_on'), true);
  assert.equal(disKaynakIzni('climate', 'set_hvac_mode'), false);
  assert.equal(disKaynakIzni('valve', 'open_valve'), false);
  assert.equal(disKaynakIzni('automation', 'trigger'), false);
  assert.equal(disKaynakIzni('camera', 'snapshot'), false);
  assert.equal(disKaynakIzni('cover', 'open_cover'), false, 'perde dış tetikten çalışmaz');
});

test('izin listesinde olmayan servis, prototip adları ve büyük harf reddedilir', () => {
  const lamba = v('light.a');
  for (const servis of ['unlock', 'open_cover', 'reload', '__proto__', 'constructor', 'toString', 'TURN_ON', 'turn_on ', '', null, 5]) {
    assert.equal(ret(S.servisDogrula('light', servis, {}, lamba)), 'servis', String(servis));
  }
  assert.equal(S.servisSemasi('light', 'hasOwnProperty'), null);
  assert.equal(S.servisSinifi('light', 'nope'), null);
});

test('parametresiz servis: parametre verilirse reddedilir; gövde yalnız entity_id', () => {
  assert.deepEqual(S.servisDogrula('switch', 'toggle', undefined, v('switch.a')), { ok: true, govde: { entity_id: 'switch.a' }, sinif: 'zararsiz' });
  assert.deepEqual(S.servisDogrula('switch', 'toggle', {}, v('switch.a')).govde, { entity_id: 'switch.a' });
  assert.equal(ret(S.servisDogrula('switch', 'toggle', { entity_id: 'lock.on_kapi' }, v('switch.a'))), 'parametre', 'gövdede başka kimlik gönderilemez');
  assert.equal(ret(S.servisDogrula('vacuum', 'start', { x: 1 }, v('vacuum.a'))), 'parametre');
});

test('vacuum: başlat, duraklat, durdur, aç, kapat, şarja dön, yerini bildir parametresiz ve zararsız; temizlik noktası ve ham komut yok', () => {
  for (const servis of ['start', 'pause', 'stop', 'turn_on', 'turn_off', 'return_to_base', 'locate']) {
    const s = S.servisDogrula('vacuum', servis, {}, v('vacuum.robot', {}, 'docked'));
    assert.deepEqual([s.ok, s.sinif, s.govde], [true, 'zararsiz', { entity_id: 'vacuum.robot' }], servis);
    assert.equal(ret(S.servisDogrula('vacuum', servis, { x: 1 }, v('vacuum.robot'))), 'parametre', servis);
  }
  for (const servis of ['clean_spot', 'send_command', 'set_fan_speed', 'toggle']) assert.equal(ret(S.servisDogrula('vacuum', servis, {}, v('vacuum.robot'))), 'servis', servis);
});

test('veri biçimi: düz nesne olmalı, en çok 8 anahtar; varlık gerekli', () => {
  const k = v('climate.salon', { min_temp: 7, max_temp: 35 });
  for (const kotu of [null, [], 'x', 5, new Date(), Object.create({ temperature: 20 })]) {
    assert.equal(S.servisDogrula('climate', 'set_temperature', kotu, k).ok, false, String(kotu));
  }
  const cok = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, 1]));
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', cok, k)), 'parametre');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 20 }, null)), 'parametre');
});

test('climate.set_temperature: cihaz aralığı mutlak aralığı yalnız DARALTIR; adım cihazın target_temp_step\'i', () => {
  const k = v('climate.salon', { min_temp: 16, max_temp: 30, target_temp_step: 0.5 }, 'heat');
  assert.deepEqual(S.servisDogrula('climate', 'set_temperature', { temperature: 21.5 }, k).govde, { entity_id: 'climate.salon', temperature: 21.5 });
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 15.5 }, k)), 'sinir');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 30.5 }, k)), 'sinir');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 21.3 }, k)), 'adim');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', {}, k)), 'eksik');
  for (const kotu of ['21', NaN, Infinity, null, true]) assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: kotu }, k)), 'parametre', String(kotu));
  // cihaz absürt geniş aralık bildirse de mutlak sınır (-50..100) geçerli
  const genis = v('climate.x', { min_temp: -1000, max_temp: 1000 });
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 150 }, genis)), 'sinir');
  // kayan nokta artığı adıma yuvarlanır
  const ondalik = v('climate.y', { min_temp: 5, max_temp: 35, target_temp_step: 0.1 });
  assert.equal(S.servisDogrula('climate', 'set_temperature', { temperature: 0.1 + 0.2 + 20 }, ondalik).govde.temperature, 20.3);
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 20, target_temp_low: 18 }, ondalik)), 'parametre', 'tek hedef ile aralık birlikte verilemez');
});

test('climate.set_temperature: ısıt/soğut aralığı; alt ve üst BİRLİKTE, alt < üst, cihaz aralığı bildirmeli (supported_features bit 2) ve sınır/adım içinde', () => {
  const aralikli = v('climate.salon', { min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 3 }, 'heat_cool');
  const iyi = S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20, target_temp_high: 24.5 }, aralikli);
  assert.deepEqual([iyi.ok, iyi.sinif, iyi.govde], [true, 'zararsiz', { entity_id: 'climate.salon', target_temp_low: 20, target_temp_high: 24.5 }]);
  assert.deepEqual([ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20 }, aralikli)), S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20 }, aralikli).parametre], ['eksik', 'target_temp_high']);
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_high: 24 }, aralikli)), 'eksik');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', {}, aralikli)), 'eksik', 'hiçbiri verilmedi');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 24, target_temp_high: 24 }, aralikli)), 'sinir', 'eşit olamaz');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 25, target_temp_high: 20 }, aralikli)), 'sinir', 'alt üstten büyük');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 15.5, target_temp_high: 22 }, aralikli)), 'sinir', 'cihaz alt sınırının altı');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20, target_temp_high: 30.5 }, aralikli)), 'sinir', 'cihaz üst sınırının üstü');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20.2, target_temp_high: 24 }, aralikli)), 'adim');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 21, target_temp_high: 24 }, aralikli)), 'parametre', 'tek hedef ile aralık karışmaz');
  for (const kotu of ['20', NaN, null, true, [20]]) assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: kotu, target_temp_high: 24 }, aralikli)), 'parametre', String(kotu));
  // Cihaz aralığı desteklemiyor (bit 2 yok) ya da supported_features / min_temp / max_temp bildirmiyor: aralık gönderilmez.
  const tekHedef = v('climate.tek', { min_temp: 16, max_temp: 30, supported_features: 1 }, 'heat');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20, target_temp_high: 24 }, tekHedef)), 'desteklenmiyor');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20, target_temp_high: 24 }, v('climate.bit_yok', { min_temp: 16, max_temp: 30 }))), 'desteklenmiyor');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { target_temp_low: 20, target_temp_high: 24 }, v('climate.sinirsiz', { supported_features: 2 }))), 'desteklenmiyor', 'sınırı bilinmeyen aralık ayarlanmaz');
  assert.equal(ret(S.servisDogrula('climate', 'set_temperature', { temperature: 20 }, tekHedef)), 'ok', 'tek hedef bit istemez');
});

test('climate.set_fan_mode / set_preset_mode: değer cihazın listesinde ve kapı süzgecinden geçmeli; zararsız sınıf', () => {
  const k = v('climate.salon', { fan_modes: ['auto', 'low', 'high', 'Kapı kilidi'], preset_modes: ['eco', 'away', 'boost', 'Garaj kapısı'] }, 'cool');
  const fan = S.servisDogrula('climate', 'set_fan_mode', { fan_mode: 'low' }, k);
  assert.deepEqual([fan.ok, fan.sinif, fan.govde], [true, 'zararsiz', { entity_id: 'climate.salon', fan_mode: 'low' }]);
  const on = S.servisDogrula('climate', 'set_preset_mode', { preset_mode: 'eco' }, k);
  assert.deepEqual([on.ok, on.sinif, on.govde], [true, 'zararsiz', { entity_id: 'climate.salon', preset_mode: 'eco' }]);
  assert.equal(ret(S.servisDogrula('climate', 'set_fan_mode', { fan_mode: 'turbo' }, k)), 'parametre', 'cihazda yok');
  assert.equal(ret(S.servisDogrula('climate', 'set_fan_mode', { fan_mode: 'Kapı kilidi' }, k)), 'parametre', 'süzgeçten geçmeyen seçenek seçilemez');
  assert.equal(ret(S.servisDogrula('climate', 'set_preset_mode', { preset_mode: 'Garaj kapısı' }, k)), 'parametre');
  assert.equal(ret(S.servisDogrula('climate', 'set_fan_mode', {}, k)), 'eksik');
  assert.equal(ret(S.servisDogrula('climate', 'set_fan_mode', { fan_mode: 'low' }, v('climate.z'))), 'desteklenmiyor', 'fan_modes yok');
  assert.equal(ret(S.servisDogrula('climate', 'set_preset_mode', { preset_mode: 'eco' }, v('climate.z'))), 'desteklenmiyor', 'preset_modes yok');
  assert.equal(ret(S.servisDogrula('climate', 'set_fan_mode', { fan_mode: 'low', x: 1 }, k)), 'parametre');
  assert.deepEqual(S.secilebilirListe('climate', 'set_fan_mode', 'fan_mode', k), ['auto', 'low', 'high']);
  assert.deepEqual(S.secilebilirListe('climate', 'set_preset_mode', 'preset_mode', k), ['eco', 'away', 'boost']);
});

test('climate.set_hvac_mode: onaylı sınıf; değer cihazın hvac_modes\'unda VE sabit listede olmalı', () => {
  const k = v('climate.salon', { hvac_modes: ['off', 'heat', 'cool', 'weird_mode'] }, 'heat');
  const s = S.servisDogrula('climate', 'set_hvac_mode', { hvac_mode: 'cool' }, k);
  assert.deepEqual([s.ok, s.sinif, s.govde.hvac_mode], [true, 'onayli', 'cool']);
  assert.equal(ret(S.servisDogrula('climate', 'set_hvac_mode', { hvac_mode: 'auto' }, k)), 'parametre', 'cihazda yok');
  assert.equal(ret(S.servisDogrula('climate', 'set_hvac_mode', { hvac_mode: 'weird_mode' }, k)), 'parametre', 'sabit listede yok');
  assert.equal(ret(S.servisDogrula('climate', 'set_hvac_mode', { hvac_mode: 'heat' }, v('climate.z'))), 'desteklenmiyor', 'hvac_modes yok');
  assert.equal(S.servisSinifi('climate', 'set_hvac_mode'), 'onayli');
  assert.equal(S.servisSinifi('climate', 'set_temperature'), 'zararsiz');
  assert.deepEqual(S.secilebilirListe('climate', 'set_hvac_mode', 'hvac_mode', k), ['off', 'heat', 'cool']);
});

test('light.turn_on renk: color_temp_kelvin cihaz aralığına kırpılır; renk modu yoksa desteklenmiyor; rgb ile birlikte olmaz', () => {
  const renkli = v('light.a', { supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 });
  assert.equal(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 2000 }, renkli).govde.color_temp_kelvin, 2700);
  assert.equal(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 9000 }, renkli).govde.color_temp_kelvin, 6500);
  assert.equal(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 4000 }, renkli).govde.color_temp_kelvin, 4000);
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 50000 }, renkli)), 'sinir', 'mutlak sınır dışı kırpılmaz');
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 4000.5 }, renkli)), 'parametre');
  assert.deepEqual(S.servisDogrula('light', 'turn_on', { rgb_color: [255, 0, 10] }, renkli).govde.rgb_color, [255, 0, 10]);
  for (const kotu of [[256, 0, 0], [1, 2], [-1, 0, 0], [1.5, 0, 0], '255,0,0']) assert.equal(ret(S.servisDogrula('light', 'turn_on', { rgb_color: kotu }, renkli)), 'parametre', String(kotu));
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 3000, rgb_color: [1, 2, 3] }, renkli)), 'parametre');
  const yalnizParlaklik = v('light.b', { supported_color_modes: ['brightness'] });
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { color_temp_kelvin: 3000 }, yalnizParlaklik)), 'desteklenmiyor');
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { rgb_color: [1, 2, 3] }, yalnizParlaklik)), 'desteklenmiyor');
  assert.equal(ret(S.servisDogrula('light', 'turn_on', { brightness: 255 }, renkli)), 'parametre', 'ham brightness yolu yok (parlaklık ayrı yoldan)');
});

test('fan: yüzde 0..100 tamsayı, salınım mantıksal, ön ayar cihaz listesinden ve süzgeçten', () => {
  const f = v('fan.salon', { preset_modes: ['auto', 'sleep', 'Kapı modu'] });
  assert.equal(S.servisDogrula('fan', 'set_percentage', { percentage: 40 }, f).govde.percentage, 40);
  for (const kotu of [-1, 101, 40.5, '40']) assert.equal(S.servisDogrula('fan', 'set_percentage', { percentage: kotu }, f).ok, false, String(kotu));
  assert.equal(S.servisDogrula('fan', 'oscillate', { oscillating: true }, f).ok, true);
  assert.equal(ret(S.servisDogrula('fan', 'oscillate', { oscillating: 'true' }, f)), 'parametre');
  assert.equal(S.servisDogrula('fan', 'set_preset_mode', { preset_mode: 'sleep' }, f).ok, true);
  assert.equal(ret(S.servisDogrula('fan', 'set_preset_mode', { preset_mode: 'Kapı modu' }, f)), 'parametre', 'süzgeçten geçmeyen seçenek seçilemez');
  assert.equal(ret(S.servisDogrula('fan', 'set_preset_mode', { preset_mode: 'turbo' }, f)), 'parametre');
  assert.deepEqual(S.secilebilirListe('fan', 'set_preset_mode', 'preset_mode', f), ['auto', 'sleep']);
});

test('media_player: ses 0..1, sessiz mantıksal, kaynak listeden ve süzgeçten', () => {
  const m = v('media_player.tv', { source_list: ['HDMI 1', 'Garage camera', 'Spotify'] }, 'playing');
  assert.equal(S.servisDogrula('media_player', 'volume_set', { volume_level: 0.35 }, m).govde.volume_level, 0.35);
  assert.equal(ret(S.servisDogrula('media_player', 'volume_set', { volume_level: 1.2 }, m)), 'sinir');
  assert.equal(S.servisDogrula('media_player', 'volume_mute', { is_volume_muted: false }, m).ok, true);
  assert.equal(S.servisDogrula('media_player', 'select_source', { source: 'Spotify' }, m).ok, true);
  assert.equal(ret(S.servisDogrula('media_player', 'select_source', { source: 'Garage camera' }, m)), 'parametre');
  for (const s of ['media_play_pause', 'media_next_track', 'media_previous_track', 'turn_on', 'turn_off']) assert.equal(S.servisDogrula('media_player', s, {}, m).ok, true, s);
  for (const s of ['play_media', 'shuffle_set', 'join']) assert.equal(ret(S.servisDogrula('media_player', s, {}, m)), 'servis', s);
});

test('media_player.media_seek: konum 0..media_duration; cihaz SEEK bitini (2) ve parça süresini bildirmeli; zararsız sınıf', () => {
  const m = v('media_player.tv', { supported_features: 2 | 4 | 16, media_duration: 200, media_position: 30 }, 'playing');
  const iyi = S.servisDogrula('media_player', 'media_seek', { seek_position: 90 }, m);
  assert.deepEqual([iyi.ok, iyi.sinif, iyi.govde], [true, 'zararsiz', { entity_id: 'media_player.tv', seek_position: 90 }]);
  assert.equal(S.servisDogrula('media_player', 'media_seek', { seek_position: 0 }, m).ok, true);
  assert.equal(S.servisDogrula('media_player', 'media_seek', { seek_position: 200 }, m).ok, true);
  assert.equal(S.servisDogrula('media_player', 'media_seek', { seek_position: 12.5 }, m).govde.seek_position, 12.5);
  for (const kotu of [-1, 200.5, 1e9]) assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: kotu }, m)), 'sinir', String(kotu));
  for (const kotu of ['10', NaN, Infinity, null, true]) assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: kotu }, m)), 'parametre', String(kotu));
  assert.equal(ret(S.servisDogrula('media_player', 'media_seek', {}, m)), 'eksik');
  assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: 5, x: 1 }, m)), 'parametre');
  assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: 5 }, v('media_player.a', { supported_features: 4, media_duration: 200 }))), 'desteklenmiyor', 'SEEK biti yok');
  assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: 5 }, v('media_player.b', { media_duration: 200 }))), 'desteklenmiyor', 'supported_features yok');
  assert.equal(ret(S.servisDogrula('media_player', 'media_seek', { seek_position: 5 }, v('media_player.c', { supported_features: 2 }))), 'desteklenmiyor', 'parça süresi bilinmiyor');
});

test('humidifier: nem cihaz aralığında tamsayı', () => {
  const h = v('humidifier.oda', { min_humidity: 30, max_humidity: 70 });
  assert.equal(S.servisDogrula('humidifier', 'set_humidity', { humidity: 50 }, h).ok, true);
  assert.equal(ret(S.servisDogrula('humidifier', 'set_humidity', { humidity: 80 }, h)), 'sinir');
  assert.equal(ret(S.servisDogrula('humidifier', 'set_humidity', { humidity: 50.5 }, h)), 'parametre');
});

test('input_number / number: min ve max öznitelikleri zorunlu; adım cihazın step\'i (taban min)', () => {
  const n = v('input_number.hedef', { min: 5, max: 95, step: 10 }, '25');
  assert.equal(S.servisDogrula('input_number', 'set_value', { value: 35 }, n).govde.value, 35);
  assert.equal(S.servisDogrula('input_number', 'set_value', { value: 30 }, n).ok, true, 'sıfır tabanından da adıma uyar');
  assert.equal(ret(S.servisDogrula('input_number', 'set_value', { value: 32 }, n)), 'adim', 'ne 0 ne 5 tabanından 10 adıma uyar');
  assert.equal(ret(S.servisDogrula('input_number', 'set_value', { value: 105 }, n)), 'sinir');
  assert.equal(ret(S.servisDogrula('number', 'set_value', { value: 3 }, v('number.x', { max: 10 }))), 'desteklenmiyor', 'min yoksa ayarlanmaz');
  assert.equal(ret(S.servisDogrula('number', 'set_value', { value: 3 }, v('number.x', {}))), 'desteklenmiyor');
  assert.equal(S.servisDogrula('number', 'set_value', { value: 0.25 }, v('number.y', { min: 0, max: 1, step: 0.05 })).govde.value, 0.25);
});

test('seçiciler: seçenek cihaz listesinde ve süzgeçten geçmeli', () => {
  const s = v('input_select.mod', { options: ['Ev', 'Dışarı', 'Tatil'] }, 'Ev');
  assert.equal(S.servisDogrula('input_select', 'select_option', { option: 'Tatil' }, s).ok, true);
  assert.equal(ret(S.servisDogrula('input_select', 'select_option', { option: 'Yok' }, s)), 'parametre');
  assert.equal(ret(S.servisDogrula('select', 'select_option', { option: 'Ev' }, v('select.x', {}))), 'desteklenmiyor');
  assert.equal(ret(S.servisDogrula('select', 'select_option', {}, s)), 'eksik');
  for (const s2 of ['select_next', 'select_previous', 'set_options']) assert.equal(ret(S.servisDogrula('input_select', s2, {}, s)), 'servis', s2);
});

test('timer: başlat/duraklat/iptal parametresiz; süre verilemez', () => {
  const z = v('timer.firin', {}, 'idle');
  for (const s of ['start', 'pause', 'cancel']) assert.equal(S.servisDogrula('timer', s, {}, z).ok, true, s);
  assert.equal(ret(S.servisDogrula('timer', 'start', { duration: '00:10:00' }, z)), 'parametre');
  assert.equal(ret(S.servisDogrula('timer', 'finish', {}, z)), 'servis');
});

test('todo: metin süzgeçten geçer ve kısaltılır; durum sabit listeden; silme YIKICI', () => {
  const t = v('todo.alisveris', {}, '3');
  assert.deepEqual(S.servisDogrula('todo', 'add_item', { item: '  Süt  ' }, t).govde, { entity_id: 'todo.alisveris', item: 'Süt' });
  assert.equal(ret(S.servisDogrula('todo', 'add_item', { item: 'Garaj kapısını kapat' }, t)), 'guvenlik');
  assert.equal(ret(S.servisDogrula('todo', 'add_item', { item: 'Kilidi değiştir' }, t)), 'guvenlik');
  assert.equal(ret(S.servisDogrula('todo', 'add_item', { item: '   ' }, t)), 'parametre');
  assert.equal(ret(S.servisDogrula('todo', 'add_item', { item: 'x'.repeat(201) }, t)), 'parametre');
  assert.equal(ret(S.servisDogrula('todo', 'add_item', { item: 'x'.repeat(5000) }, t)), 'parametre');
  assert.equal(S.servisDogrula('todo', 'update_item', { item: 'Süt', status: 'completed' }, t).ok, true);
  assert.equal(ret(S.servisDogrula('todo', 'update_item', { item: 'Süt', status: 'done' }, t)), 'parametre');
  assert.equal(ret(S.servisDogrula('todo', 'update_item', { item: 'Süt', rename: 'Ekmek', status: 'completed' }, t)), 'parametre');
  assert.equal(S.servisSinifi('todo', 'remove_item'), 'yikici');
  assert.equal(S.servisDogrula('todo', 'remove_item', { item: 'Süt' }, t).sinif, 'yikici');
});

test('her şema tutarlı: bilinen tür ve sınıf; sayı şemalarında min <= max', () => {
  for (const [alan, servisler] of Object.entries(S.SERVIS_IZINLERI)) {
    for (const [servis, sema] of Object.entries(servisler)) {
      assert.ok(Object.isFrozen(sema), `${alan}.${servis}`);
      assert.ok(['zararsiz', 'onayli', 'yikici'].includes(S.servisSinifi(alan, servis)));
      for (const [ad, p] of Object.entries(sema.parametreler ?? {})) {
        assert.ok(['sayi', 'mantiksal', 'secenek', 'metin', 'rgb'].includes(p.tur), `${alan}.${servis}.${ad}`);
        if (p.tur === 'sayi') assert.ok(p.min <= p.max, `${alan}.${servis}.${ad}`);
      }
      for (const kural of ['birlikteOlmaz', 'enAzBiri', 'birlikteGerekli', 'kucukOlmali']) {
        for (const grup of sema[kural] ?? []) {
          assert.ok(Object.isFrozen(grup), `${alan}.${servis}.${kural}`);
          for (const ad of grup) assert.ok(Object.hasOwn(sema.parametreler ?? {}, ad), `${alan}.${servis}.${kural}: ${ad} tanımlı parametre olmalı`);
        }
      }
    }
  }
});
