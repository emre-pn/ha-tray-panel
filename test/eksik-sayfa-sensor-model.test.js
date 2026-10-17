'use strict';

/**
 * Ana süreç modeli (özel sayfalarda sensör favorileri): sensör üyesi hem sayfa kimlikleri listesinde kalır hem de bilgi bölümünde
 * taşınır; renderer ikisini birleştirir (test/eksik-sayfa-sensor.test.js). Kapı Kuralı'ndan geçmeyen sensör ikisinden de düşer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { yuzeyModeliOlustur, rendererModeli } = require('../src/lib/yuzey-modeli');
const { bilgiBolumunuEkle } = require('../src/lib/bilgi-modeli');

test('sensör favorisi sayfa kimlikleri listesinde kalır ve bilgi.sensorler içinde taşınır', () => {
  const durumlar = {
    'sensor.salon_sicaklik': { entity_id: 'sensor.salon_sicaklik', state: '21.4', attributes: { unit_of_measurement: '°C', device_class: 'temperature', friendly_name: 'Salon sıcaklık' } },
    'light.ampul': { entity_id: 'light.ampul', state: 'on', attributes: { friendly_name: 'Ampul' } },
  };
  const model = yuzeyModeliOlustur({
    favoriler: [{ entity_id: 'sensor.salon_sicaklik', ad: 'Salon sıcaklık' }, { entity_id: 'light.ampul', ad: 'Ampul' }],
    durumAl: (k) => durumlar[k],
    sayfalar: [{ id: 'salon', ad: 'Salon', varliklar: ['sensor.salon_sicaklik', 'light.ampul'] }],
  });
  bilgiBolumunuEkle(model, { ayarlar: {}, durumAl: (k) => durumlar[k] });
  assert.ok(model.gruplar.every((g) => g.kod !== 'sensor'), 'sensör grubu genel gruplardan çıkarılır');
  assert.deepEqual(model.sayfalar[0].kimlikler, ['sensor.salon_sicaklik', 'light.ampul']);
  assert.deepEqual(model.bilgi.sensorler.map((k) => k.id), ['sensor.salon_sicaklik']);
  const renderer = rendererModeli(model);
  assert.deepEqual(renderer.sayfalar[0].kimlikler, ['sensor.salon_sicaklik', 'light.ampul']);
  assert.deepEqual(renderer.bilgi.sensorler.map((k) => k.id), ['sensor.salon_sicaklik']);
});

test('kapı sözcüklü sensör hem sayfa listesinden hem bilgi bölümünden düşer', () => {
  const durumlar = { 'sensor.garaj_kapisi_sicaklik': { entity_id: 'sensor.garaj_kapisi_sicaklik', state: '10', attributes: { friendly_name: 'Garaj kapısı' } } };
  const model = yuzeyModeliOlustur({
    favoriler: [{ entity_id: 'sensor.garaj_kapisi_sicaklik', ad: 'Garaj kapısı' }],
    durumAl: (k) => durumlar[k],
    sayfalar: [{ id: 'garaj', ad: 'Garaj', varliklar: ['sensor.garaj_kapisi_sicaklik'] }],
  });
  bilgiBolumunuEkle(model, { ayarlar: {}, durumAl: (k) => durumlar[k] });
  assert.deepEqual(model.sayfalar[0].kimlikler, []);
  assert.deepEqual(model.bilgi.sensorler, []);
});
