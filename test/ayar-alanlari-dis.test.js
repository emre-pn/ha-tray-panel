'use strict';

// 1.4.0 dis grubu: dış tetik ayar alanları (src/lib/ayar-alanlari.js). Hepsi varsayılan kapalı, hiçbiri dışa/içe aktarılmaz.

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');

const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const DIS_ALANLARI = [
  'tetikJumpList', 'tetikMasaustu', 'tetikProtokol', 'tetikProtokolIzinleri', 'tetikYerelApi', 'tetikApiPortu', 'tetikApiBildirim',
  'tetikPcOlaylari', 'tetikPcAcma', 'tetikPcKurallari', 'tetikPcUyarisi', 'tetikToplanti', 'tetikToplantiKaynak', 'tetikToplantiFavori',
  'tetikToplantiBitis', 'tetikToplantiBitisFavori', 'tetikToplantiAralik',
];

test('dış tetik alanları: hepsi kayıtlı, şema 6, varsayılan kapalı/boş; hiçbiri dışa/içe aktarılmaz', () => {
  for (const ad of DIS_ALANLARI) {
    const a = alan(ad);
    assert.ok(a, ad);
    assert.equal(a.surum, 6, ad);
    assert.equal(a.aktarilir, false, `${ad}: dış tetik başkasının dosyasından açılamaz`);
  }
  for (const ad of ['tetikJumpList', 'tetikMasaustu', 'tetikProtokol', 'tetikYerelApi', 'tetikApiBildirim', 'tetikPcOlaylari', 'tetikPcAcma', 'tetikToplanti']) {
    assert.equal(alan(ad).varsayilan, false, ad);
  }
  const d = A.alanlariDuzelt({}, {});
  assert.deepEqual([d.tetikProtokolIzinleri, d.tetikPcKurallari, d.tetikApiPortu, d.tetikToplantiKaynak, d.tetikToplantiBitis, d.tetikToplantiAralik, d.tetikToplantiFavori], [[], [], 48123, 'ikisi', 'geriYukle', 10, '']);
  for (const ad of DIS_ALANLARI) assert.equal(A.aktarilanAlanlar().includes(ad), false, ad);
  // ana sürecin yazdığı alanlar Ayarlar özetine gitmez (sayfa onları geri göndermez, kaydetme onları ezmez)
  const ozet = A.ekAyarOzeti({});
  assert.equal(Object.hasOwn(ozet, 'tetikProtokolIzinleri'), false);
  assert.equal(Object.hasOwn(ozet, 'tetikPcUyarisi'), false);
  assert.equal(ozet.tetikYerelApi, false);
});

test('dış tetik alanları: doğrulama (port aralığı, kural listesi, kapı/kilit kimliği yazılamaz)', () => {
  const t = (k) => k;
  const { yeni, uyarilar } = A.ekGirdiDogrula(
    {
      tetikApiPortu: 80,
      tetikToplantiAralik: 3,
      tetikToplantiFavori: 'lock.on_kapi',
      tetikToplantiBitisFavori: 'light.kapi_lambasi',
      tetikToplantiKaynak: 'ekran',
      tetikPcKurallari: [{ olay: 'kilit', kimlik: 'light.salon' }, { olay: 'kilit', kimlik: 'cover.garaj' }],
      tetikProtokolIzinleri: ['light.salon', 'lock.kapi'],
      tetikYerelApi: 'evet',
    },
    t,
  );
  assert.deepEqual(uyarilar.map((u) => u.alan).sort(), ['tetikApiPortu', 'tetikToplantiAralik', 'tetikToplantiBitisFavori', 'tetikToplantiFavori', 'tetikToplantiKaynak', 'tetikYerelApi']);
  assert.deepEqual(yeni.tetikPcKurallari, [{ olay: 'kilit', kimlik: 'light.salon', islem: 'kapat' }]);
  assert.deepEqual(yeni.tetikProtokolIzinleri, ['light.salon']);
  const iyi = A.ekGirdiDogrula({ tetikApiPortu: '48200', tetikToplantiAralik: 30, tetikToplantiFavori: 'light.salon', tetikToplantiBitis: 'favori' }, t);
  assert.deepEqual(iyi.uyarilar, []);
  assert.deepEqual(iyi.yeni, { tetikApiPortu: 48200, tetikToplantiAralik: 30, tetikToplantiFavori: 'light.salon', tetikToplantiBitis: 'favori' });
});
