'use strict';

/**
 * Alan kaydı (src/lib/alan-kaydi.js) — 1.4.0. Tablo yalnız bilinçli olarak genişler: Kapı Kuralı alanları (kilit, alarm, siren)
 * ve bu sürümde hâlâ dışarıda bırakılanlar (camera — kendi izin listesiyle ayrı yoldadır —, çim biçme...) tabloya giremez.
 * 1.4.0 cihaz grubu: cover (yalnız perde/jaluzi sınıfı; suzgec.js), valve ve automation (ikisi ZORUNLU onaylı) bilinçli eklendi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/lib/alan-kaydi');
const ANA = require('../src/lib/ceviri/ana');
const { SERVIS_IZINLERI } = require('../src/lib/servis-izinleri');
const { FAVORI_ALANLARI, YASAK_ALANLAR } = require('../src/lib/suzgec');

const BEKLENEN = [
  'light',
  'switch',
  'fan',
  'input_boolean',
  'scene',
  'script',
  'button',
  'input_button',
  'climate',
  'media_player',
  'humidifier',
  'vacuum',
  'input_select',
  'select',
  'input_number',
  'number',
  'timer',
  'todo',
  'cover',
  'valve',
  'automation',
  'sensor',
  'binary_sensor',
  'weather',
  'calendar',
];

test('kayıt: tablo tam olarak beklenen alanlardır (yeni alan bilinçli eklenir)', () => {
  assert.deepEqual([...K.KAYITLI_ALANLAR], BEKLENEN);
  assert.deepEqual([...K.YENI_ALANLAR], BEKLENEN.slice(8));
  assert.ok(Object.isFrozen(K.ALAN_KAYDI));
  for (const a of BEKLENEN) assert.ok(Object.isFrozen(K.ALAN_KAYDI[a]), a);
});

test('KAPI KURALI: kilit, alarm, siren, kamera (kayıtta değil: kendi izin listesiyle ayrı yol), çim biçme kayıtta yok', () => {
  for (const a of ['lock', 'alarm_control_panel', 'siren', 'camera', 'lawn_mower', 'update', 'device_tracker', 'person', 'image', 'notify', 'remote', 'water_heater', 'event', 'text']) {
    assert.equal(K.kayitliAlanMi(a), false, a);
    assert.equal(K.karoAlaniMi(a), false, a);
    assert.equal(K.eylemAlaniMi(a), false, a);
    assert.equal(K.varsayilanServis(a), null, a);
  }
  for (const a of YASAK_ALANLAR) assert.equal(K.kayitliAlanMi(a), false, a);
});

test('bilinmeyen ya da garip girdi: hiçbir sorgu true dönmez, fırlatmaz', () => {
  for (const kotu of [undefined, null, '', 'LIGHT', '__proto__', 'constructor', 'toString', 42, {}, ['light']]) {
    assert.equal(K.alanBilgisi(kotu), null, String(kotu));
    assert.equal(K.kayitliAlanMi(kotu), false);
    assert.equal(K.karoAlaniMi(kotu), false);
    assert.equal(K.eylemAlaniMi(kotu), false);
    assert.equal(K.okunurAlanMi(kotu), false);
    assert.equal(K.onayVarsayilanMi(kotu), false);
    assert.equal(K.alanModeli(kotu), null);
  }
  assert.equal(K.alanSirasi('camera'), BEKLENEN.length, 'bilinmeyen alan en sona');
  assert.equal(K.alanSirasi('light'), 0);
});

test('1.3.0 favori alanları değişmedi: aynı tek tıklama servisi, eylem türü, karo', () => {
  for (const [alan, { servis }] of Object.entries(FAVORI_ALANLARI)) {
    assert.equal(K.varsayilanServis(alan), servis, alan);
    assert.equal(K.eylemAlaniMi(alan), true, alan);
    assert.equal(K.karoAlaniMi(alan), true, alan);
  }
});

test('okunur alanlar: sensor, binary_sensor, weather, calendar; hiçbir servisleri yok', () => {
  assert.deepEqual(BEKLENEN.filter(K.okunurAlanMi), ['sensor', 'binary_sensor', 'weather', 'calendar']);
  for (const a of BEKLENEN.filter(K.okunurAlanMi)) {
    assert.equal(K.eylemAlaniMi(a), false);
    assert.equal(K.varsayilanServis(a), null);
    assert.equal(Object.hasOwn(SERVIS_IZINLERI, a), false, `${a} için servis izni olamaz`);
  }
});

test('her eylem alanının servis izinleri var; varsayılan servis izin listesinde', () => {
  for (const a of BEKLENEN.filter(K.eylemAlaniMi)) {
    assert.ok(Object.hasOwn(SERVIS_IZINLERI, a), a);
    const v = K.varsayilanServis(a);
    if (v !== null) assert.ok(Object.hasOwn(SERVIS_IZINLERI[a], v), `${a}.${v}`);
  }
  // izin tablosunda kayıtta olmayan alan yok
  for (const a of Object.keys(SERVIS_IZINLERI)) assert.ok(K.eylemAlaniMi(a), a);
});

test('1.4.0 cihaz grubu: cover (perde) tek tıklama eylemi yok; valve ve automation zorunlu onaylı alan; üçü karo ve eylem alanı', () => {
  for (const a of ['cover', 'valve', 'automation']) {
    assert.equal(K.kayitliAlanMi(a), true, a);
    assert.equal(K.karoAlaniMi(a), true, a);
    assert.equal(K.eylemAlaniMi(a), true, a);
  }
  assert.equal(K.varsayilanServis('cover'), null, 'perde: düz tıklama servis göndermez (kendi kartı var)');
  assert.equal(K.varsayilanServis('valve'), null, 'vana: düz tıklama servis göndermez');
  assert.equal(K.varsayilanServis('automation'), 'trigger');
  assert.equal(K.onayVarsayilanMi('cover'), false);
  assert.equal(K.onayVarsayilanMi('valve'), true);
  assert.equal(K.onayVarsayilanMi('automation'), true);
});

test('dış tetik yasağı tek kaynakta (eylem-sinifi.js): alan kaydında ikinci liste yok; valve, automation, camera dış tetiklenemez', () => {
  assert.equal(K.DIS_TETIK_YASAK_ALANLAR, undefined);
  assert.equal(K.disTetikYasakAlanMi, undefined);
  const { DIS_YASAK_ALANLAR, disKaynakIzni } = require('../src/lib/eylem-sinifi');
  for (const a of ['valve', 'automation', 'camera']) assert.ok(DIS_YASAK_ALANLAR.includes(a), a);
  for (const a of ['light', 'switch', 'climate', 'script', 'scene']) assert.equal(DIS_YASAK_ALANLAR.includes(a), false, a);
  assert.ok(Object.isFrozen(DIS_YASAK_ALANLAR));
  for (const kotu of [undefined, null, '', 42, {}]) assert.equal(disKaynakIzni(kotu, 'turn_on'), false);
});

test('karo olmayanlar: todo ve calendar (yalnız kendi özelliğinin ayarıyla)', () => {
  assert.deepEqual(BEKLENEN.filter((a) => !K.karoAlaniMi(a)), ['todo', 'calendar']);
  assert.deepEqual([...K.KARO_ALAN_SIRASI], BEKLENEN.filter(K.karoAlaniMi));
});

test('varsayılan onay: düğme, sanal düğme, script, seçiciler, sayılar, zamanlayıcı', () => {
  assert.deepEqual(BEKLENEN.filter(K.onayVarsayilanMi), ['script', 'button', 'input_button', 'input_select', 'select', 'input_number', 'number', 'timer', 'valve', 'automation']);
});

test('her kayıtlı alanın tr ve en alan etiketi var (alan.<alan>), İngilizcede Türkçe harf yok', () => {
  for (const a of BEKLENEN) {
    const tr = ANA.tr[`alan.${a}`];
    const en = ANA.en[`alan.${a}`];
    assert.equal(typeof tr, 'string', `tr alan.${a}`);
    assert.equal(typeof en, 'string', `en alan.${a}`);
    assert.ok(tr.length > 0 && en.length > 0);
    assert.doesNotMatch(en, /[çğıöşüÇĞİÖŞÜ]/, a);
  }
});
