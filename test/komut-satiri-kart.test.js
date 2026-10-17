'use strict';

/**
 * 1.4.0 komut satırı (`--eylem=<ad>`) ve cihaz kartları: aynı komut sözlüğü (arama.js alanKomutu), tek tıklama eylemi olmayan
 * karoların düz adla ÇALIŞMAMASI ("komutGerekli"), belirsiz / sınır dışı / desteklenmeyen sonuçlar. Saf işlevler; ağ yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemAdiniCoz } = require('../src/lib/komut-satiri');
const { servisDogrula } = require('../src/lib/servis-izinleri');

const KLIMA = { id: 'climate.salon', etiket: 'Klima', alan: 'climate', varsayilanEylem: false, ozellik: { enAz: 16, enCok: 30, adim: 0.5, modlar: ['off', 'cool', 'heat'] } };
const YATAK = { id: 'climate.yatak', etiket: 'Yatak klima', alan: 'climate', varsayilanEylem: false, ozellik: { enAz: 16, enCok: 30, adim: 1, modlar: ['off', 'cool'] } };
const MASA = { id: 'light.masa', etiket: 'Masa', alan: 'light', parlaklikKontrol: true, varsayilanEylem: true, ozellik: { renkModlari: ['color_temp', 'hs'], enAzKelvin: 2200, enCokKelvin: 6500 } };
const TV = { id: 'media_player.tv', etiket: 'TV', alan: 'media_player', varsayilanEylem: false, ozellik: { kaynaklar: ['HDMI 1', 'HDMI 2'] } };
const MOD = { id: 'input_select.ev_modu', etiket: 'Ev modu', alan: 'input_select', varsayilanEylem: false, ozellik: { secenekler: ['Ev', 'Uyku'] } };
const SAYAC = { id: 'timer.mutfak', etiket: 'Mutfak', alan: 'timer', varsayilanEylem: false, ozellik: {} };
const ESIK = { id: 'input_number.esik', etiket: 'Eşik', alan: 'input_number', varsayilanEylem: false, ozellik: { enAz: 0, enCok: 10, adim: 1 } };
const FAN = { id: 'fan.vantilator', etiket: 'Vantilatör', alan: 'fan', varsayilanEylem: true, ozellik: { adimYuzde: 25, onAyarlar: ['Uyku'] } };
const SAHNE = { id: 'scene.film', etiket: 'Film', alan: 'scene', varsayilanEylem: true };
const KAROLAR = [KLIMA, YATAK, MASA, TV, MOD, SAYAC, ESIK, FAN, SAHNE];

test('servis komutu: klima sıcaklığı, modu ve kapatma aynı sözlükle çözülür (ondalık virgül dahil)', () => {
  assert.deepEqual(eylemAdiniCoz('klima 24', KAROLAR), { id: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24 } });
  assert.deepEqual(eylemAdiniCoz('klima 23,5', KAROLAR), { id: 'climate.salon', servis: 'set_temperature', veri: { temperature: 23.5 } });
  assert.deepEqual(eylemAdiniCoz('klima isit', KAROLAR), { id: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' } });
  assert.deepEqual(eylemAdiniCoz('klima kapat', KAROLAR), { id: 'climate.salon', servis: 'turn_off' });
  assert.deepEqual(eylemAdiniCoz('yatak klima 21', KAROLAR), { id: 'climate.yatak', servis: 'set_temperature', veri: { temperature: 21 } });
});

test('servis komutu: ışık beyaz tonu, medya sesi ve kaynağı, seçici, zamanlayıcı, sayı, vantilatör', () => {
  assert.deepEqual(eylemAdiniCoz('masa sicak', KAROLAR), { id: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 2700 } });
  assert.deepEqual(eylemAdiniCoz('tv ses 30', KAROLAR), { id: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.3 } });
  assert.deepEqual(eylemAdiniCoz('tv hdmi 2', KAROLAR), { id: 'media_player.tv', servis: 'select_source', veri: { source: 'HDMI 2' } });
  assert.deepEqual(eylemAdiniCoz('ev modu uyku', KAROLAR), { id: 'input_select.ev_modu', servis: 'select_option', veri: { option: 'Uyku' } });
  assert.deepEqual(eylemAdiniCoz('mutfak baslat', KAROLAR), { id: 'timer.mutfak', servis: 'start' });
  assert.deepEqual(eylemAdiniCoz('esik 7', KAROLAR), { id: 'input_number.esik', servis: 'set_value', veri: { value: 7 } });
  assert.deepEqual(eylemAdiniCoz('vantilator uyku', KAROLAR), { id: 'fan.vantilator', servis: 'set_preset_mode', veri: { preset_mode: 'Uyku' } });
});

test('sınır dışı değer "sinir", cihazın desteklemediği komut "desteklenmiyor"; ikisinde de eylem üretilmez', () => {
  assert.deepEqual(eylemAdiniCoz('klima 40', KAROLAR), { hata: 'sinir' });
  assert.deepEqual(eylemAdiniCoz('klima 10', KAROLAR), { hata: 'sinir' });
  assert.deepEqual(eylemAdiniCoz('tv ses 130', KAROLAR), { hata: 'sinir' });
  assert.deepEqual(eylemAdiniCoz('esik 11', KAROLAR), { hata: 'sinir' });
  assert.deepEqual(eylemAdiniCoz('yatak klima isit', KAROLAR), { hata: 'desteklenmiyor' }, 'yatak klima ısıtmayı desteklemiyor');
  assert.deepEqual(eylemAdiniCoz('tv hdmi', KAROLAR), { hata: 'bulunamadi' }, 'çıplak ön ek komut değildir');
});

test('belirsiz ad: birden çok cihaz komutu kabul ediyorsa hiçbiri çalışmaz', () => {
  const ikiKlima = [{ ...KLIMA, id: 'climate.a', etiket: 'Klima oda' }, { ...KLIMA, id: 'climate.b', etiket: 'Klima salon' }, MASA];
  assert.deepEqual(eylemAdiniCoz('klima 24', ikiKlima), { hata: 'belirsiz' });
  assert.deepEqual(eylemAdiniCoz('klima oda 24', ikiKlima), { id: 'climate.a', servis: 'set_temperature', veri: { temperature: 24 } });
});

test('komutGerekli: tek tıklama eylemi olmayan karo düz adla ÇALIŞMAZ ve "favoride yok" denmez; tek tıklamalılar eskisi gibi çalışır', () => {
  for (const ad of ['klima', 'tv', 'ev modu', 'mutfak', 'esik']) assert.deepEqual(eylemAdiniCoz(ad, KAROLAR), { hata: 'komutGerekli' }, ad);
  assert.deepEqual(eylemAdiniCoz('film', KAROLAR), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('masa', KAROLAR), { id: 'light.masa' });
  assert.deepEqual(eylemAdiniCoz('vantilator', KAROLAR), { id: 'fan.vantilator' });
  assert.deepEqual(eylemAdiniCoz('olmayan cihaz', KAROLAR), { hata: 'bulunamadi' });
});

test('düz ad ve parlaklık yalnız tek tıklama eylemi olan karolarda aranır: komutsuz ad, komutlu karonun "klima 24"ünü bozmaz', () => {
  assert.deepEqual(eylemAdiniCoz('masa 40', KAROLAR), { id: 'light.masa', parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('masa 0', KAROLAR), { id: 'light.masa', kapat: true });
  const adiKlima = [{ id: 'scene.klima_24', etiket: 'Klima 24', alan: 'scene', varsayilanEylem: true }, KLIMA];
  assert.deepEqual(eylemAdiniCoz('klima 24', adiKlima), { id: 'scene.klima_24' }, 'tam ad önceliği: sahne çalışır, sıcaklık değişmez');
});

test('eski karo kayıtları (varsayilanEylem / alan alanı yok) eskisi gibi çalışır; komut hiç denenmez', () => {
  const eski = [{ id: 'scene.film', etiket: 'Film', parlaklikKontrol: false }, { id: 'light.led', etiket: 'LED', parlaklikKontrol: true }];
  assert.deepEqual(eylemAdiniCoz('film', eski), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('led 30', eski), { id: 'light.led', parlaklik: 30 });
  assert.deepEqual(eylemAdiniCoz('film 24', eski), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('klima 24', []), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('klima 24', undefined), { hata: 'bulunamadi' });
});

test('çözülen her servis önerisi servis-izinleri doğrulamasından geçer (kuru geçiş); iklim modu onaysız sınıfta değildir', () => {
  const durumlar = {
    'climate.salon': { entity_id: 'climate.salon', attributes: { hvac_modes: ['off', 'cool', 'heat'], min_temp: 16, max_temp: 30, target_temp_step: 0.5 } },
    'light.masa': { entity_id: 'light.masa', attributes: { supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 } },
    'media_player.tv': { entity_id: 'media_player.tv', attributes: { source_list: ['HDMI 1', 'HDMI 2'] } },
    'input_select.ev_modu': { entity_id: 'input_select.ev_modu', attributes: { options: ['Ev', 'Uyku'] } },
    'timer.mutfak': { entity_id: 'timer.mutfak', attributes: {} },
    'input_number.esik': { entity_id: 'input_number.esik', attributes: { min: 0, max: 10, step: 1 } },
    'fan.vantilator': { entity_id: 'fan.vantilator', attributes: { percentage_step: 25, preset_modes: ['Uyku'] } },
  };
  const komutlar = ['klima 24', 'klima isit', 'klima kapat', 'masa sicak', 'tv ses 30', 'tv hdmi 2', 'ev modu uyku', 'mutfak baslat', 'esik 7', 'vantilator uyku'];
  for (const komut of komutlar) {
    const c = eylemAdiniCoz(komut, KAROLAR);
    assert.ok(c.id && c.servis, `${komut}: servis çözülmeli`);
    const alan = c.id.split('.')[0];
    const sonuc = servisDogrula(alan, c.servis, c.veri, durumlar[c.id]);
    assert.equal(sonuc.ok, true, `${komut}: ${JSON.stringify(sonuc)}`);
  }
  // Onay isteyen servislerin komut satırından reddi (kaynak izni) test/eylem-kart.test.js içindedir; burada yalnız sınıf denetlenir.
  assert.notEqual(servisDogrula('climate', 'set_hvac_mode', { hvac_mode: 'heat' }, durumlar['climate.salon']).sinif, 'zararsiz');
});

test('Kapı Kuralı: komut sözlüğü kapı / kilit / kepenk / alarm sözcüğüyle hiçbir servis üretmez (karo listesi zaten süzülmüş gelir, sözlük de bu alanlara komut vermez)', () => {
  const kapi = [
    { id: 'lock.on', etiket: 'Ön', alan: 'lock', varsayilanEylem: false },
    { id: 'alarm_control_panel.ev', etiket: 'Ev alarmı', alan: 'alarm_control_panel', varsayilanEylem: false },
    { id: 'siren.x', etiket: 'Siren', alan: 'siren', varsayilanEylem: false },
    { id: 'camera.x', etiket: 'Kamera', alan: 'camera', varsayilanEylem: false },
  ];
  // (cover: perde komutları 1.4.0'da var; garaj/kepenk/kapı cover'ı karo listesine hiç girmez ve eylem hattı sınıfı denetler, test/cihaz-suzgec.test.js)
  for (const komut of ['on ac', 'on kilitle', 'ev alarmi kapat', 'siren ac', 'kamera ac', 'on']) {
    const c = eylemAdiniCoz(komut, kapi);
    assert.equal(c.servis, undefined, komut);
    assert.equal(c.id, undefined, komut);
  }
});
