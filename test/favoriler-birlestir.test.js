'use strict';

/**
 * hata-14: favori kaydı, HA'da o an görünmeyen favorileri sessizce silmez; hata-04: onay alanı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { favorileriDuzelt, favorileriBirlestir, onayiDuzelt } = require('../src/lib/favoriler');

const MEVCUT = [
  { entity_id: 'light.masa', ad: 'Masa' },
  { entity_id: 'light.ampul', ad: 'Ampul' },
  { entity_id: 'button.hoparlor', ad: 'Hoparlör', onay: false },
];
const guvenli = (...cift) => new Map(cift);

test('favorileriDuzelt: onay alanı yalnız boolean ise korunur', () => {
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'button.a', ad: 'A', onay: false },
    { entity_id: 'button.b', ad: 'B', onay: true },
    { entity_id: 'button.c', ad: 'C', onay: 'evet' },
    { entity_id: 'button.d', ad: 'D' },
  ]);
  assert.deepEqual(favoriler, [
    { entity_id: 'button.a', ad: 'A', onay: false },
    { entity_id: 'button.b', ad: 'B', onay: true },
    { entity_id: 'button.c', ad: 'C' },
    { entity_id: 'button.d', ad: 'D' },
  ]);
});

test('HA yeniden başlarken liste yarım: listede olmayan favoriler KORUNUR, eksik olarak bildirilir', () => {
  const { yeni, eksik, engelli } = favorileriBirlestir({
    mevcut: MEVCUT,
    secilen: ['light.masa', 'light.ampul', 'button.hoparlor'],
    guvenliListe: guvenli(['light.masa', 'Masa (HA)']),
    tumKimlikler: new Set(['light.masa']),
  });
  assert.deepEqual(yeni, [
    { entity_id: 'light.masa', ad: 'Masa (HA)' },
    { entity_id: 'light.ampul', ad: 'Ampul' },
    { entity_id: 'button.hoparlor', ad: 'Hoparlör', onay: false },
  ]);
  assert.deepEqual(eksik, ['light.ampul', 'button.hoparlor']);
  assert.deepEqual(engelli, []);
});

test('kullanıcı eksik satırın işaretini kaldırınca favori silinir (karar kullanıcıya ait)', () => {
  const { yeni } = favorileriBirlestir({
    mevcut: MEVCUT,
    secilen: ['light.masa'],
    guvenliListe: guvenli(['light.masa', 'Masa']),
    tumKimlikler: new Set(['light.masa']),
  });
  assert.deepEqual(yeni.map((f) => f.entity_id), ['light.masa']);
});

test('HA\'da var ama adı sonradan "kapı" olmuş favori düşer ve engelli olarak bildirilir', () => {
  const { yeni, eksik, engelli } = favorileriBirlestir({
    mevcut: MEVCUT,
    secilen: ['light.masa', 'light.ampul'],
    guvenliListe: guvenli(['light.masa', 'Masa']), // light.ampul HA'da var ama süzgeçten geçmedi
    tumKimlikler: new Set(['light.masa', 'light.ampul']),
  });
  assert.deepEqual(yeni.map((f) => f.entity_id), ['light.masa']);
  assert.deepEqual(eksik, []);
  assert.deepEqual(engelli, [{ entity_id: 'light.ampul', ad: 'Ampul' }]);
});

test('kayıtlı adı güvenli değilse eksik favori de korunmaz', () => {
  const { yeni, engelli } = favorileriBirlestir({
    mevcut: [{ entity_id: 'light.x', ad: 'Eski adı Kapı Lambası' }],
    secilen: ['light.x'],
    guvenliListe: new Map(),
    tumKimlikler: new Set(),
  });
  assert.deepEqual(yeni, []);
  assert.deepEqual(engelli.map((e) => e.entity_id), ['light.x']);
});

test('yeni giriş yalnız güvenli listeden gelir: mevcut olmayan, listede olmayan kimlik yok sayılır', () => {
  const { yeni } = favorileriBirlestir({
    mevcut: [],
    secilen: ['lock.on_kapi', 'light.kapi_lambasi', 'light.yeni', 'switch.bilinmeyen'],
    guvenliListe: guvenli(['light.yeni', 'Yeni']),
    tumKimlikler: new Set(['lock.on_kapi', 'light.kapi_lambasi', 'light.yeni']),
  });
  assert.deepEqual(yeni, [{ entity_id: 'light.yeni', ad: 'Yeni' }]);
});

test('güvenli listedeki ad süzgeçten geçmezse (savunma) yeni girişe alınmaz', () => {
  const { yeni } = favorileriBirlestir({
    mevcut: [],
    secilen: ['light.y'],
    guvenliListe: guvenli(['light.y', 'Garaj ışığı']),
    tumKimlikler: new Set(['light.y']),
  });
  assert.deepEqual(yeni, []);
});

test('seçim nesneleri onay değerini taşır; verilmezse mevcut onay korunur; yinelenenler tek kez', () => {
  const { yeni } = favorileriBirlestir({
    mevcut: MEVCUT,
    secilen: [
      { entity_id: 'light.masa', onay: true },
      { entity_id: 'light.masa', onay: false },
      { entity_id: 'button.hoparlor' },
      { entity_id: 'light.ampul', onay: 'x' },
      null,
      42,
    ],
    guvenliListe: guvenli(['light.masa', 'Masa'], ['button.hoparlor', 'Hoparlör'], ['light.ampul', 'Ampul']),
    tumKimlikler: new Set(['light.masa', 'button.hoparlor', 'light.ampul']),
  });
  assert.deepEqual(yeni, [
    { entity_id: 'light.masa', ad: 'Masa', onay: true },
    { entity_id: 'button.hoparlor', ad: 'Hoparlör', onay: false },
    { entity_id: 'light.ampul', ad: 'Ampul' },
  ]);
});

test('200 favori sınırı uygulanır', () => {
  const liste = Array.from({ length: 205 }, (_, i) => `light.l${i}`);
  const { yeni } = favorileriBirlestir({
    mevcut: [],
    secilen: liste,
    guvenliListe: new Map(liste.map((k) => [k, k])),
    tumKimlikler: new Set(liste),
  });
  assert.equal(yeni.length, 200);
});

test('bozuk girdiler çökmez', () => {
  const sonuc = favorileriBirlestir({ mevcut: null, secilen: 'x', guvenliListe: new Map(), tumKimlikler: new Set() });
  assert.deepEqual(sonuc, { yeni: [], eksik: [], engelli: [], kisayolHatalari: [], etiketHatalari: [] });
});

test('onayiDuzelt: zorunlu onaylı eylemde onay:false atılır; diğerleri korunur', () => {
  const duzeltilmis = onayiDuzelt([
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC bilgisayari_kapat', onay: false },
    { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'PC ses_cikis_hoparlor', onay: false },
    { entity_id: 'script.yeni', ad: 'Yeni', onay: false },
    { entity_id: 'script.isigi_kapat', ad: 'Işığı kapat', onay: false },
    { entity_id: 'light.a', ad: 'A', onay: true },
    { entity_id: 'light.b', ad: 'B' },
  ]);
  assert.deepEqual(duzeltilmis, [
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC bilgisayari_kapat' },
    { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'PC ses_cikis_hoparlor', onay: false },
    { entity_id: 'script.yeni', ad: 'Yeni', onay: false },
    { entity_id: 'script.isigi_kapat', ad: 'Işığı kapat' },
    { entity_id: 'light.a', ad: 'A', onay: true },
    { entity_id: 'light.b', ad: 'B' },
  ]);
});
