'use strict';

/**
 * 1.4.0 etkileşim grubunun ayar satırları (src/lib/ayar-alanlari.js AYAR_ALANLARI): o-20 karoTekerlegi / tepsiOrtaTik, o-23 panelSabit,
 * o-60 kisayolBasiliTut, o-38 baglantiBildirimi / baglantiBildirimSn. Gerçek tablo kullanılır: doğrulama, dışa/içe aktarma ve Kapı
 * Kuralı uçtan uca denenir. Şema sürümü DEĞİŞMEZ (6): eski ayar dosyaları varsayılanlarla yükselir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AKTARILAN_ALANLAR, ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');
const { TR } = require('../src/lib/ceviri-varsayilan');

const ALANLAR = ['karoTekerlegi', 'tepsiOrtaTik', 'panelSabit', 'kisayolBasiliTut', 'baglantiBildirimi', 'baglantiBildirimSn'];
const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const duzelt = (ad, ham) => alan(ad).duzelt(ham);

test('etkileşim grubunun 6 satırı kayıtlı; kapalı olması gerekenler KAPALI (basılı tut, sabitleme, orta tık), yerel olanlar açık (tekerlek, bağlantı bildirimi)', () => {
  for (const ad of ALANLAR) assert.ok(alan(ad), ad);
  assert.deepEqual(Object.fromEntries(ALANLAR.map((ad) => [ad, alan(ad).varsayilan])), {
    karoTekerlegi: true,
    tepsiOrtaTik: '',
    panelSabit: false,
    kisayolBasiliTut: false,
    baglantiBildirimi: true,
    baglantiBildirimSn: 60,
  });
  assert.equal(new Set(A.AYAR_ALANLARI.map((a) => a.ad)).size, A.AYAR_ALANLARI.length, 'çift ad yok');
});

test('mantıksal alanlar yalnız true/false kabul eder', () => {
  for (const ad of ['karoTekerlegi', 'panelSabit', 'kisayolBasiliTut', 'baglantiBildirimi']) {
    assert.equal(duzelt(ad, true), true);
    assert.equal(duzelt(ad, false), false);
    for (const kotu of ['true', 1, 0, null, undefined, {}, []]) assert.equal(duzelt(ad, kotu), undefined, `${ad}: ${JSON.stringify(kotu)}`);
  }
});

test('tepsiOrtaTik: boş (kapalı) ya da orta tık alanındaki zararsız kimlik; kapı/kilit/alarm, yıkıcı ve görüntü alanları ASLA', () => {
  assert.equal(duzelt('tepsiOrtaTik', ''), '');
  for (const iyi of ['light.salon', 'switch.priz', 'fan.vantilator', 'input_boolean.misafir', 'scene.film', 'script.aksam', 'button.zil_degil', 'humidifier.nem']) {
    assert.equal(duzelt('tepsiOrtaTik', iyi), iyi, iyi);
  }
  for (const kotu of [
    'lock.on_kapi', 'alarm_control_panel.ev', 'siren.korna', 'cover.garaj', 'cover.perde', 'valve.su', 'automation.gece', 'camera.bahce', 'climate.oda', 'media_player.tv', 'water_heater.boyler',
    'light.garaj_kapisi', 'switch.kapi_acici', 'light.kilit_isigi',
    'Light.Salon', 'light', 'light.', '.salon', 'light.salon ', 'light.salon\n', '../x', 'light.salon/../lock.x', 5, null, undefined, {}, [], true,
  ]) {
    assert.equal(duzelt('tepsiOrtaTik', kotu), undefined, JSON.stringify(kotu));
  }
});

test('baglantiBildirimSn: 15-600 tam sayı (metin sayı da olur); sınır dışı, kesirli ve sayı olmayan reddedilir', () => {
  for (const [ham, beklenen] of [[15, 15], [60, 60], [600, 600], ['45', 45], [' 90 ', 90]]) assert.equal(duzelt('baglantiBildirimSn', ham), beklenen, JSON.stringify(ham));
  for (const kotu of [14, 601, 0, -60, 1.5, NaN, Infinity, '', ' ', 'abc', null, undefined, {}, [], true]) assert.equal(duzelt('baglantiBildirimSn', kotu), undefined, JSON.stringify(kotu));
});

test('grup dışa/içe aktarılır (taşınabilir tercihler); içe aktarmada kapı kimliği ve bozuk değer ayıklanır', () => {
  for (const ad of ALANLAR) {
    assert.equal(alan(ad).aktarilir, true, `${ad} aktarılır`);
    assert.equal(AKTARILAN_ALANLAR.includes(ad), true, ad);
    assert.equal(alan(ad).ozette, true, `${ad} Ayarlar özetinde`);
  }
  const ayarlar = {
    ...A.alanlariDuzelt({ karoTekerlegi: false, tepsiOrtaTik: 'light.salon', panelSabit: true, kisayolBasiliTut: true, baglantiBildirimi: false, baglantiBildirimSn: 120 }, {}),
    yerelAdres: 'http://192.168.1.10:8123',
    favoriler: [],
  };
  const disa = ayarlariDisaAktar(ayarlar, { simdi: new Date('2026-01-01T00:00:00Z') });
  assert.equal(disa.ok, true);
  const dosya = JSON.parse(disa.metin);
  assert.deepEqual(
    Object.fromEntries(ALANLAR.map((ad) => [ad, dosya.ayarlar[ad]])),
    { karoTekerlegi: false, tepsiOrtaTik: 'light.salon', panelSabit: true, kisayolBasiliTut: true, baglantiBildirimi: false, baglantiBildirimSn: 120 },
  );
  dosya.ayarlar.tepsiOrtaTik = 'lock.on_kapi';
  dosya.ayarlar.baglantiBildirimSn = 5;
  dosya.ayarlar.panelSabit = 'evet';
  const cozum = ayarYedeginiCoz(dosya, { varsayilan: {}, t: TR });
  assert.equal(cozum.ok, true);
  assert.equal(cozum.ayarlar.tepsiOrtaTik, '', 'kapı kilidi kimliği içe aktarmada ayıklanır');
  assert.equal(cozum.ayarlar.baglantiBildirimSn, 60);
  assert.equal(cozum.ayarlar.panelSabit, false);
  assert.equal(cozum.ayarlar.karoTekerlegi, false, 'geçerli alanlar korunur');
});

test('ayarlariDuzelt (uçtan uca): şema sürümü 6 kalır; eski dosya varsayılanlarla yükselir; bozuk/kapı değerleri varsayılana düşer', () => {
  const eski = ayarlariDuzelt({ semaSurumu: 5, favoriler: [], yerelAdres: 'http://192.168.1.10:8123' }, { varsayilan: {} }).ayarlar;
  assert.equal(eski.semaSurumu, 6, 'şema sürümü artmadı: 6');
  assert.deepEqual(
    Object.fromEntries(ALANLAR.map((ad) => [ad, eski[ad]])),
    { karoTekerlegi: true, tepsiOrtaTik: '', panelSabit: false, kisayolBasiliTut: false, baglantiBildirimi: true, baglantiBildirimSn: 60 },
  );
  const yeni = ayarlariDuzelt({ semaSurumu: 6, favoriler: [], tepsiOrtaTik: 'lock.on_kapi', baglantiBildirimSn: 9999, panelSabit: 'x', kisayolBasiliTut: true }, { varsayilan: {} }).ayarlar;
  assert.equal(yeni.tepsiOrtaTik, '');
  assert.equal(yeni.baglantiBildirimSn, 60);
  assert.equal(yeni.panelSabit, false);
  assert.equal(yeni.kisayolBasiliTut, true);
});

test('ekGirdiDogrula / ekAyarOzeti: geçersiz değer uyarı verir ve alan yeniye girmez; özet her alanı varsayılanıyla verir', () => {
  const t = (anahtar) => anahtar;
  const { yeni, uyarilar } = A.ekGirdiDogrula({ tepsiOrtaTik: 'cover.garaj', baglantiBildirimSn: '7', panelSabit: true }, t);
  assert.deepEqual(yeni, { panelSabit: true });
  assert.deepEqual(uyarilar.map((u) => u.alan).sort(), ['baglantiBildirimSn', 'tepsiOrtaTik']);
  const ozet = A.ekAyarOzeti({});
  for (const ad of ALANLAR) assert.equal(JSON.stringify(ozet[ad]), JSON.stringify(alan(ad).varsayilan), ad);
});
