'use strict';

/**
 * Bilgi biçimleyicileri (src/lib/bilgi-bicim.js): sayı, saat, tarih, gün farkı, etkinlik saati. Hepsi UTC saat diliminde sınanır
 * (makine ayarından bağımsız); sözcük içermez, geçersiz girdi fırlatmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/lib/bilgi-bicim');

const OCAK = Date.UTC(2026, 9, 14, 21, 5); // 14 Ekim 2026 Çarşamba 21:05 UTC

test('sayiBicimle: dilin ondalık ayracı, hassasiyet ve büyüklüğe göre basamak', () => {
  assert.equal(B.sayiBicimle(21.456, { hassasiyet: 1, dil: 'tr' }), '21,5');
  assert.equal(B.sayiBicimle(21.456, { hassasiyet: 1, dil: 'en' }), '21.5');
  assert.equal(B.sayiBicimle(21, { hassasiyet: 2, dil: 'en' }), '21.00', 'hassasiyet verilince sabit basamak');
  assert.equal(B.sayiBicimle(21.456, { hassasiyet: 0 }), '21');
  assert.equal(B.sayiBicimle(3.14159, { dil: 'en' }), '3.14', 'hassasiyet yoksa küçük sayıda 2 basamak');
  assert.equal(B.sayiBicimle(42.25, { dil: 'en' }), '42.3', 'orta büyüklükte 1 basamak');
  assert.equal(B.sayiBicimle(1234.5, { dil: 'en' }), '1,235', 'büyük sayıda tam sayı');
  assert.equal(B.sayiBicimle(5, { dil: 'en' }), '5', 'sondaki sıfırlar atılır');
  assert.equal(B.sayiBicimle(-0.5, { dil: 'en' }), '-0.5');
  for (const kotu of [NaN, Infinity, '12', null, undefined, {}]) assert.equal(B.sayiBicimle(kotu), '', String(kotu));
  assert.doesNotThrow(() => B.sayiBicimle(1, { hassasiyet: 99 }), 'aşırı hassasiyet sınırlanır');
});

test('saatMetni: 24 ve 12 saat, geçersiz zaman boş', () => {
  assert.equal(B.saatMetni(OCAK, { saatBicimi: '24', saatDilimi: 'UTC' }), '21:05');
  assert.match(B.saatMetni(OCAK, { saatBicimi: '12', saatDilimi: 'UTC' }), /^9:05\s?PM$/i);
  assert.equal(B.saatMetni(Date.UTC(2026, 9, 14, 0, 7), { saatBicimi: '24', saatDilimi: 'UTC' }), '00:07', 'gece yarısı 00 ile başlar');
  assert.match(B.saatMetni(Date.UTC(2026, 9, 14, 0, 7), { saatBicimi: '12', saatDilimi: 'UTC' }), /^12:07\s?AM$/i);
  assert.match(B.saatMetni(OCAK, { saatBicimi: 'sistem', saatDilimi: 'UTC' }), /\d{1,2}[:.]05/, 'sistem biçimi saat ve dakika taşır');
  for (const kotu of [NaN, Infinity, '1', null, undefined]) assert.equal(B.saatMetni(kotu), '');
});

test('saatMetni: geçersiz saat dilimi fırlatmaz, yerel dilime düşer', () => {
  assert.doesNotThrow(() => B.saatMetni(OCAK, { saatBicimi: '24', saatDilimi: 'Yok/Boyle' }));
  assert.match(B.saatMetni(OCAK, { saatBicimi: '24', saatDilimi: 'Yok/Boyle' }), /^\d{2}:\d{2}$/);
});

test('tarihMetni: kısa, orta, uzun ve yok', () => {
  const kisa = B.tarihMetni(OCAK, { tarihBicimi: 'kisa', dil: 'tr', saatDilimi: 'UTC' });
  assert.match(kisa, /14.10.2026/);
  const orta = B.tarihMetni(OCAK, { tarihBicimi: 'orta', dil: 'tr', saatDilimi: 'UTC' });
  assert.match(orta, /14/);
  assert.match(orta, /Eki/);
  const uzun = B.tarihMetni(OCAK, { tarihBicimi: 'uzun', dil: 'tr', saatDilimi: 'UTC' });
  assert.match(uzun, /Ekim/);
  assert.match(uzun, /2026/);
  assert.match(uzun, /Çarşamba/);
  assert.match(B.tarihMetni(OCAK, { tarihBicimi: 'uzun', dil: 'en', saatDilimi: 'UTC' }), /Wednesday/);
  assert.equal(B.tarihMetni(OCAK, { tarihBicimi: 'yok', saatDilimi: 'UTC' }), '');
  assert.equal(B.tarihMetni(NaN), '');
  assert.equal(B.tarihMetni('x'), '');
});

test('gunFarki: bugün/yarın/geçmiş; saat dilimine göre gün sınırı; tüm gün tarihi', () => {
  const simdi = Date.UTC(2026, 9, 14, 21, 5);
  assert.equal(B.gunFarki('2026-10-14T23:30:00Z', simdi, 'UTC'), 0);
  assert.equal(B.gunFarki('2026-10-15T00:30:00Z', simdi, 'UTC'), 1);
  assert.equal(B.gunFarki('2026-10-13T10:00:00Z', simdi, 'UTC'), -1);
  assert.equal(B.gunFarki('2026-10-20', simdi, 'UTC'), 6, 'tüm gün tarihi');
  assert.equal(B.gunFarki('2026-10-14', simdi, 'UTC'), 0);
  // saat dilimi: 21:05 UTC İstanbul'da (UTC+3) ertesi gün 00:05
  assert.equal(B.gunFarki('2026-10-15T08:00:00+03:00', simdi, 'Europe/Istanbul'), 0, 'yerel gün aynı');
  assert.equal(B.gunFarki('2026-10-15T08:00:00+03:00', simdi, 'UTC'), 1);
  // ay ve yıl sınırı
  assert.equal(B.gunFarki('2027-01-02', Date.UTC(2026, 11, 31, 12), 'UTC'), 2);
  assert.equal(B.gunFarki('x', simdi, 'UTC'), null);
  assert.equal(B.gunFarki(5, simdi, 'UTC'), null);
  assert.equal(B.gunFarki('2026-10-14', NaN, 'UTC'), null);
});

test('gunMetni: tüm gün tarihi saat diliminden etkilenmez; geçersiz boş', () => {
  const t = B.gunMetni('2026-10-20', { dil: 'tr', saatDilimi: 'Pacific/Kiritimati' });
  assert.match(t, /20/);
  assert.match(t, /Eki/);
  assert.match(B.gunMetni('2026-10-20T09:00:00Z', { dil: 'en', saatDilimi: 'UTC' }), /Oct/);
  assert.equal(B.gunMetni('yok'), '');
  assert.equal(B.gunMetni(undefined), '');
});

test('etkinlikSaati: tüm gün null; bitişle aralık; bozuk tarih null', () => {
  const ayar = { saatBicimi: '24', saatDilimi: 'UTC' };
  assert.equal(B.etkinlikSaati({ tumGun: true, baslangic: '2026-10-20' }, ayar), null);
  assert.equal(B.etkinlikSaati({ baslangic: '2026-10-20T09:00:00Z', bitis: '2026-10-20T10:30:00Z' }, ayar), '09:00–10:30');
  assert.equal(B.etkinlikSaati({ baslangic: '2026-10-20T09:00:00Z' }, ayar), '09:00');
  assert.equal(B.etkinlikSaati({ baslangic: '2026-10-20T09:00:00Z', bitis: '2026-10-20T08:00:00Z' }, ayar), '09:00', 'bitiş başlangıçtan önceyse yalnız başlangıç');
  assert.equal(B.etkinlikSaati({ baslangic: 'bozuk' }, ayar), null);
  assert.equal(B.etkinlikSaati(null, ayar), null);
  assert.equal(B.etkinlikSaati({}, ayar), null);
});

test('dikkatNedeni: pil eşiği, ikili sensör sınıfları; ulaşılamayan ve sayı olmayan değer uyarı değil', () => {
  const sensor = (ozellik) => ({ alan: 'sensor', ozellik });
  const ikili = (ozellik) => ({ alan: 'binary_sensor', ozellik });
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: 12 }), 20), 'pil');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: 20 }), 20), null, 'eşikte uyarı yok');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: 0 }), 20), 'pil', 'sıfır yüzde pil bitmiş demek');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: null, sayi: 3 }), 20), 'pil', 'birimsiz pil sensörü yüzde sayılır');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: 'V', sayi: 2.8 }), 20), null, 'volt yüzde değildir');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: null }), 20), null, 'değer yok (ulaşılamıyor)');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: -5 }), 20), null, 'saçma negatif değer');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'temperature', birim: '%', sayi: 3 }), 20), null, 'pil olmayan sensör');
  assert.equal(B.dikkatNedeni(sensor({ sinif: 'battery', birim: '%', sayi: 12 })), 'pil', 'eşik varsayılanı 20');
  for (const sinif of ['problem', 'smoke', 'gas', 'carbon_monoxide', 'moisture']) assert.equal(B.dikkatNedeni(ikili({ sinif, acik: true })), 'sorun', sinif);
  assert.equal(B.dikkatNedeni(ikili({ sinif: 'battery', acik: true })), 'pil');
  assert.equal(B.dikkatNedeni(ikili({ sinif: 'problem', acik: false })), null);
  assert.equal(B.dikkatNedeni(ikili({ sinif: 'problem', acik: null })), null);
  assert.equal(B.dikkatNedeni(ikili({ sinif: 'motion', acik: true })), null);
  // kapı/pencere/kilit sınıfları dikkat listesinde yok (zaten modelde de yok)
  for (const sinif of ['door', 'garage_door', 'opening', 'window', 'lock', 'tamper', 'safety']) assert.equal(B.DIKKAT_IKILI_SINIFLAR.includes(sinif), false, sinif);
  for (const kotu of [null, undefined, {}, { alan: 'sensor' }, { alan: 'light', ozellik: {} }, { alan: 'sensor', ozellik: 'x' }]) assert.equal(B.dikkatNedeni(kotu, 20), null);
});

test('sabitler dondurulmuş ve ayar alanlarıyla aynı seçenekleri taşır', () => {
  const A = require('../src/lib/ayar-alanlari');
  assert.ok(Object.isFrozen(B.SAAT_BICIMLERI));
  assert.ok(Object.isFrozen(B.TARIH_BICIMLERI));
  for (const s of B.SAAT_BICIMLERI) assert.equal(A.alanlariDuzelt({ saatBicimi: s }, {}).saatBicimi, s, `saat ${s}`);
  for (const t of B.TARIH_BICIMLERI) assert.equal(A.alanlariDuzelt({ tarihBicimi: t }, {}).tarihBicimi, t, `tarih ${t}`);
});
