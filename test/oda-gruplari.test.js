'use strict';

/**
 * Oda gruplaması ve "odayı kapat" adayları (o-14, src/lib/oda-gruplari.js): saf işlevler. Gerçek Home Assistant, ağ ya da pencere YOK.
 * Görünüm kuralı: karo kümesi değişmez (eklenmez, çıkarılmaz); Kapı Kuralı oda adına da uygulanır. Kapatma adayları: yalnız odadaki, AÇIK,
 * zararsız sınıftaki favoriler (ışık, priz, vantilatör, sanal anahtar, nem alıcı).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ozet8, odalariCikar, odaGruplari, odaBul, odaKapatUyeleri, EN_COK_ODA_UYESI, EN_COK_ODA, ODA_KODU_DESENI } = require('../src/lib/oda-gruplari');

const karo = (id, ek = {}) => ({ id, etiket: id, grup: 'isik', grupEtiketi: 'Işık', ...ek });
const ALANLAR = {
  alanlar: [
    { id: 'salon', ad: 'Salon' },
    { id: 'yatak_odasi', ad: 'Yatak odası' },
    { id: 'garaj', ad: 'Garaj' },
    { id: 'bos', ad: '' },
  ],
  varlikAlanlari: {
    'light.salon_lamba': 'salon',
    'switch.salon_priz': 'salon',
    'light.yatak': 'yatak_odasi',
    'light.garaj_lamba': 'garaj',
    'light.bilinmeyen_oda': 'olmayan',
  },
};
const GRUPLAR = () => [
  { kod: 'isik', etiket: 'Işık', karolar: [karo('light.salon_lamba'), karo('light.yatak'), karo('light.garaj_lamba'), karo('light.odasiz'), karo('light.bilinmeyen_oda')] },
  { kod: 'yardimci', etiket: 'Yardımcı', karolar: [karo('switch.salon_priz', { grup: 'yardimci', grupEtiketi: 'Yardımcı' }), karo('switch.baska')] },
];
const tumKimlikler = (gruplar) => gruplar.flatMap((g) => g.karolar.map((k) => k.id)).sort();

test('ozet8: 8 onaltılık hane, aynı girdi aynı sonuç, farklı girdi farklı sonuç', () => {
  assert.match(ozet8('salon'), /^[0-9a-f]{8}$/);
  assert.equal(ozet8('salon'), ozet8('salon'));
  assert.notEqual(ozet8('salon'), ozet8('yatak'));
});

test('odalariCikar: kodlar biçimli ve kimliğe göre SIRALI üretilir; adı süzgeçten geçmeyen (Garaj) ve adsız oda atılır', () => {
  const odalar = odalariCikar(ALANLAR);
  assert.deepEqual([...odalar.keys()], ['salon', 'yatak_odasi']);
  for (const o of odalar.values()) assert.match(o.kod, ODA_KODU_DESENI);
  assert.equal(odalar.get('salon').ad, 'Salon');
  // girdi sırası değişse de kodlar aynı
  const ters = odalariCikar({ alanlar: [...ALANLAR.alanlar].reverse() });
  assert.equal(ters.get('salon').kod, odalar.get('salon').kod);
  assert.deepEqual(odalariCikar(null).size, 0);
  assert.deepEqual(odalariCikar({ alanlar: 'x' }).size, 0);
});

test('odalariCikar: en çok 60 oda; bozuk girdiler atlanır', () => {
  const cok = { alanlar: Array.from({ length: 100 }, (_, i) => ({ id: `a${String(i).padStart(3, '0')}`, ad: `Oda ${i}` })) };
  assert.equal(odalariCikar(cok).size, EN_COK_ODA);
  assert.equal(odalariCikar({ alanlar: [null, 5, { id: 3 }, { ad: 'x' }, { id: 'tek', ad: 'Tek' }] }).size, 1);
});

test('odaGruplari: odası bilinen karolar oda grubuna, kalanlar kendi tür grubunda; karo kümesi AYNEN korunur', () => {
  const girdi = GRUPLAR();
  const sonuc = odaGruplari(girdi, ALANLAR);
  assert.deepEqual(tumKimlikler(sonuc), tumKimlikler(girdi), 'karo eklenmez, çıkarılmaz, tekrarlanmaz');
  const odalar = sonuc.filter((g) => g.oda === true);
  assert.deepEqual(odalar.map((g) => g.etiket), ['Salon', 'Yatak odası'], 'oda adına göre sıralı');
  assert.deepEqual(odalar[0].karolar.map((k) => k.id).sort(), ['light.salon_lamba', 'switch.salon_priz']);
  for (const g of odalar) assert.match(g.kod, ODA_KODU_DESENI);
  const tur = sonuc.filter((g) => g.oda !== true);
  assert.deepEqual(tur.map((g) => g.kod), ['isik', 'yardimci']);
  assert.deepEqual(tur[0].karolar.map((k) => k.id), ['light.garaj_lamba', 'light.odasiz', 'light.bilinmeyen_oda'], 'Garaj odası grup olmaz; karosu tür grubunda kalır');
  assert.deepEqual(tur[1].karolar.map((k) => k.id), ['switch.baska']);
});

test('odaGruplari: girdi değiştirilmez; boş kalan tür grubu düşer; oda kaydı yoksa girdi aynen döner', () => {
  const girdi = GRUPLAR();
  const kopya = structuredClone(girdi);
  odaGruplari(girdi, ALANLAR);
  assert.deepEqual(girdi, kopya);
  assert.equal(odaGruplari(girdi, null), girdi);
  assert.equal(odaGruplari(girdi, { alanlar: [], varlikAlanlari: {} }), girdi);
  assert.equal(odaGruplari(girdi, { alanlar: ALANLAR.alanlar, varlikAlanlari: {} }), girdi, 'hiçbir karonun odası bilinmiyorsa değişmez');
  const yalnizOda = odaGruplari([{ kod: 'isik', etiket: 'Işık', karolar: [karo('light.yatak')] }], ALANLAR);
  assert.deepEqual(yalnizOda.map((g) => g.etiket), ['Yatak odası'], 'tür grubu boşaldı');
  assert.deepEqual(odaGruplari('x', ALANLAR), []);
});

test('odaGruplari: prototip anahtarları ("__proto__", "constructor") eşlemede oda sayılmaz', () => {
  const girdi = [{ kod: 'isik', etiket: 'Işık', karolar: [karo('light.constructor'), karo('light.salon_lamba')] }];
  const veri = { alanlar: ALANLAR.alanlar, varlikAlanlari: JSON.parse('{"light.salon_lamba":"salon","__proto__":"salon"}') };
  const sonuc = odaGruplari(girdi, veri);
  assert.deepEqual(sonuc.find((g) => g.oda).karolar.map((k) => k.id), ['light.salon_lamba']);
});

test('odaBul: yalnız biçimce geçerli ve kayıtta olan kod bulunur', () => {
  const salon = odalariCikar(ALANLAR).get('salon');
  assert.deepEqual(odaBul(salon.kod, ALANLAR), salon);
  for (const kotu of ['oda-00000000', 'salon', '', 'oda-XYZ', 'oda-1234567', null, undefined, 5, {}]) assert.equal(odaBul(kotu, ALANLAR), null, String(kotu));
  assert.equal(odaBul(salon.kod, null), null);
});

const VARLIKLAR = {
  'light.salon_lamba': { entity_id: 'light.salon_lamba', state: 'on', attributes: { friendly_name: 'Salon lambası' } },
  'switch.salon_priz': { entity_id: 'switch.salon_priz', state: 'on', attributes: { friendly_name: 'Salon prizi' } },
  'fan.salon_fan': { entity_id: 'fan.salon_fan', state: 'on', attributes: { friendly_name: 'Fan' } },
  'light.salon_kapali': { entity_id: 'light.salon_kapali', state: 'off', attributes: { friendly_name: 'Kapalı lamba' } },
  'lock.salon_kilit': { entity_id: 'lock.salon_kilit', state: 'unlocked', attributes: { friendly_name: 'Kilit' } },
  'cover.salon_perde': { entity_id: 'cover.salon_perde', state: 'open', attributes: { friendly_name: 'Perde', device_class: 'curtain' } },
  'climate.salon_klima': { entity_id: 'climate.salon_klima', state: 'cool', attributes: { friendly_name: 'Klima' } },
  'scene.salon_film': { entity_id: 'scene.salon_film', state: 'unknown', attributes: { friendly_name: 'Film' } },
  'light.salon_kapi': { entity_id: 'light.salon_kapi', state: 'on', attributes: { friendly_name: 'Kapı lambası' } },
  'switch.oyun_bilgisayari': { entity_id: 'switch.oyun_bilgisayari', state: 'on', attributes: { friendly_name: 'Oyun bilgisayarı' } },
  'switch.salon_kapat_dugme': { entity_id: 'switch.salon_kapat_dugme', state: 'on', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'light.baska_oda': { entity_id: 'light.baska_oda', state: 'on', attributes: { friendly_name: 'Başka odadaki' } },
  'light.favori_degil': { entity_id: 'light.favori_degil', state: 'on', attributes: { friendly_name: 'Favori değil' } },
};
const ESLEME = Object.fromEntries(Object.keys(VARLIKLAR).filter((k) => k !== 'light.baska_oda').map((k) => [k, 'salon']));
ESLEME['light.baska_oda'] = 'yatak_odasi';
const SALON_VERISI = { alanlar: ALANLAR.alanlar, varlikAlanlari: ESLEME };
const favori = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: VARLIKLAR[kimlik].attributes.friendly_name, ...ek });
const durumAl = (kimlik) => VARLIKLAR[kimlik];
const FAVORILER = Object.keys(VARLIKLAR)
  .filter((k) => k !== 'light.favori_degil')
  .map((k) => favori(k));

test('odaKapatUyeleri: yalnız odadaki, açık, izinli alandaki, zararsız FAVORİLER adaydır', () => {
  const uyeler = odaKapatUyeleri({ favoriler: FAVORILER, durumAl, alanVerisi: SALON_VERISI, alanId: 'salon' });
  assert.deepEqual(uyeler.map((u) => u.kimlik).sort(), ['fan.salon_fan', 'light.salon_lamba', 'switch.salon_priz']);
  const lamba = uyeler.find((u) => u.kimlik === 'light.salon_lamba');
  assert.equal(lamba.ad, 'Salon lambası');
  assert.equal(lamba.kayit.entity_id, 'light.salon_lamba');
});

test('odaKapatUyeleri: kilit, perde, klima, sahne, kapı adlı ışık, yıkıcı sınıf (açık liste / "kapat" ipucu / onay isteyen favori) ve favori olmayan ASLA aday olmaz', () => {
  const uyeler = odaKapatUyeleri({ favoriler: FAVORILER, durumAl, alanVerisi: SALON_VERISI, alanId: 'salon' }).map((u) => u.kimlik);
  for (const yasak of ['lock.salon_kilit', 'cover.salon_perde', 'climate.salon_klima', 'scene.salon_film', 'light.salon_kapi', 'switch.oyun_bilgisayari', 'switch.salon_kapat_dugme', 'light.baska_oda', 'light.favori_degil', 'light.salon_kapali']) {
    assert.ok(!uyeler.includes(yasak), `${yasak} aday olmamalı`);
  }
  // kullanıcı "onay iste"yi işaretlediyse (yıkıcı sınıf) kapatma listesine girmez
  const onayli = FAVORILER.map((f) => (f.entity_id === 'switch.salon_priz' ? { ...f, onay: true } : f));
  assert.ok(!odaKapatUyeleri({ favoriler: onayli, durumAl, alanVerisi: SALON_VERISI, alanId: 'salon' }).some((u) => u.kimlik === 'switch.salon_priz'));
});

test('odaKapatUyeleri: durum ulaşılamıyor / bilinmiyor / kimliği uyuşmuyorsa aday olmaz; etiket adın önüne geçer; en çok 30', () => {
  const yok = (k) => (k === 'light.salon_lamba' ? undefined : VARLIKLAR[k]);
  assert.ok(!odaKapatUyeleri({ favoriler: FAVORILER, durumAl: yok, alanVerisi: SALON_VERISI, alanId: 'salon' }).some((u) => u.kimlik === 'light.salon_lamba'));
  const uyusmayan = (k) => (k === 'light.salon_lamba' ? { ...VARLIKLAR[k], entity_id: 'light.baska' } : VARLIKLAR[k]);
  assert.ok(!odaKapatUyeleri({ favoriler: FAVORILER, durumAl: uyusmayan, alanVerisi: SALON_VERISI, alanId: 'salon' }).some((u) => u.kimlik === 'light.salon_lamba'));
  const etiketli = FAVORILER.map((f) => (f.entity_id === 'light.salon_lamba' ? { ...f, etiket: 'Büyük lamba' } : f));
  assert.equal(odaKapatUyeleri({ favoriler: etiketli, durumAl, alanVerisi: SALON_VERISI, alanId: 'salon' }).find((u) => u.kimlik === 'light.salon_lamba').ad, 'Büyük lamba');

  const cok = {};
  const cokFavori = [];
  const cokEsleme = {};
  for (let i = 0; i < 50; i += 1) {
    const k = `light.lamba_${i}`;
    cok[k] = { entity_id: k, state: 'on', attributes: { friendly_name: `Lamba ${i}` } };
    cokFavori.push({ entity_id: k, ad: `Lamba ${i}` });
    cokEsleme[k] = 'salon';
  }
  const sonuc = odaKapatUyeleri({ favoriler: cokFavori, durumAl: (k) => cok[k], alanVerisi: { alanlar: ALANLAR.alanlar, varlikAlanlari: cokEsleme }, alanId: 'salon' });
  assert.equal(sonuc.length, EN_COK_ODA_UYESI);
});

test('odaKapatUyeleri: bozuk girdilerde çökmez, boş döner', () => {
  assert.deepEqual(odaKapatUyeleri({ favoriler: null, durumAl, alanVerisi: SALON_VERISI, alanId: 'salon' }), []);
  assert.deepEqual(odaKapatUyeleri({ favoriler: [null, 5, {}], durumAl, alanVerisi: null, alanId: 'salon' }), []);
  assert.deepEqual(odaKapatUyeleri({ favoriler: FAVORILER, durumAl, alanVerisi: SALON_VERISI, alanId: 'yok' }), []);
  const prototip = { favoriler: [{ entity_id: 'light.constructor', ad: 'x' }], durumAl: () => ({ entity_id: 'light.constructor', state: 'on', attributes: {} }), alanVerisi: { varlikAlanlari: {} }, alanId: 'salon' };
  assert.deepEqual(odaKapatUyeleri(prototip), []);
});
