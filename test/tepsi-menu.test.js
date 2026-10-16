'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tepsiMenuPlani, menuOgesi, acikIsikSayisi, ipucuMetni, IPUCU_SINIRI, UST_SAYISI } = require('../src/lib/tepsi-menu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');
const { HAZIR_LISTE } = require('../src/lib/favoriler');

const karolar = () =>
  yuzeyModeliOlustur({
    favoriler: HAZIR_LISTE.map((h) => ({ entity_id: h.kimlik, ad: h.etiket, etiket: h.etiket, ...(h.parlaklik ? { parlaklik: true } : {}) })),
    durumAl: () => undefined,
  }).gruplar.flatMap((g) => g.karolar);

test('plan: ilk 8 zararsız üstte, kalan zararsızlar "Diğer favoriler"de, yıkıcılar ayrı', () => {
  const plan = tepsiMenuPlani(karolar());
  assert.equal(plan.ust.length, UST_SAYISI);
  assert.equal(plan.ust.length + plan.alt.length, 16);
  assert.deepEqual(plan.yikici.map((o) => o.kimlik).sort(), ['button.pc_bilgisayari_kapat', 'script.iyi_geceler']);
  assert.ok(plan.ust.every((o) => !o.yikici) && plan.alt.every((o) => !o.yikici));
  assert.ok(plan.yikici.every((o) => o.yikici && o.checkbox === false && o.label.endsWith('onay ister')));
});

test('1.4.0 plan: tek tıklama eylemi olmayan karolar (iklim, sensör, seçici) menüye girmez; nem cihazı aç/kapa olarak girer', () => {
  const m = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'climate.salon', ad: 'Klima' },
      { entity_id: 'sensor.sicaklik', ad: 'Sıcaklık' },
      { entity_id: 'input_select.mod', ad: 'Mod' },
      { entity_id: 'humidifier.oda', ad: 'Nem' },
    ],
    durumAl: (k) => ({ entity_id: k, state: k.startsWith('climate') ? 'heat' : 'on', attributes: {} }),
  }).gruplar.flatMap((g) => g.karolar);
  const plan = tepsiMenuPlani(m);
  assert.deepEqual([...plan.ust, ...plan.alt, ...plan.yikici].map((o) => o.kimlik), ['humidifier.oda']);
  assert.equal(plan.ust[0].checkbox, true);
});

test('plan: az favoride alt boş; hiç favori yoksa hepsi boş', () => {
  const plan = tepsiMenuPlani(karolar().slice(0, 3));
  assert.deepEqual([plan.ust.length, plan.alt.length, plan.yikici.length], [3, 0, 0]);
  assert.deepEqual(tepsiMenuPlani([]), { ust: [], alt: [], yikici: [] });
  assert.deepEqual(tepsiMenuPlani(undefined), { ust: [], alt: [], yikici: [] });
  assert.equal(tepsiMenuPlani(karolar(), { ustSayi: 3 }).ust.length, 3);
});

test('menuOgesi: aç/kapa onay kutusu, yüzde, ulaşılamıyor; sahne/düğme tür etiketi', () => {
  const taban = { id: 'light.a', etiket: 'LED', alan: 'light', sinif: 'zararsiz', kullanilabilir: true, ulasilamiyor: false };
  const acik = menuOgesi({ ...taban, durum: 'acik', yuzde: 50 });
  assert.deepEqual([acik.label, acik.checkbox, acik.checked], ['LED  ·  %50', true, true]);
  const kapali = menuOgesi({ ...taban, durum: 'kapali', yuzde: null });
  assert.deepEqual([kapali.label, kapali.checked], ['LED', false]);
  const yok = menuOgesi({ ...taban, durum: 'yok', yuzde: null, kullanilabilir: false, ulasilamiyor: true });
  assert.ok(yok.label.endsWith('(ulaşılamıyor)'));
  const bilinmiyor = menuOgesi({ ...taban, durum: 'yok', yuzde: null, kullanilabilir: false, ulasilamiyor: false });
  assert.equal(bilinmiyor.label, 'LED', 'durum henüz yoksa "ulaşılamıyor" yazılmaz');
  assert.equal(menuOgesi({ id: 'scene.film', etiket: 'Film', alan: 'scene', sinif: 'zararsiz', durum: 'notr', yuzde: null, kullanilabilir: true }).label, 'Film  ·  sahne');
  assert.equal(menuOgesi({ id: 'button.x', etiket: 'Ses +', alan: 'button', sinif: 'zararsiz', durum: 'notr', yuzde: null, kullanilabilir: true }).label, 'Ses +  ·  düğme');
});

test('KAPI KURALI: kapı adlı favoriler modelden geçemediği için menü planında hiç yoktur', () => {
  const m = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
      { entity_id: 'switch.garaj_kapisi', ad: 'Garaj kapısı' },
      { entity_id: 'light.salon', ad: 'Salon' },
    ],
    durumAl: () => undefined,
  });
  const plan = tepsiMenuPlani(m.gruplar.flatMap((g) => g.karolar));
  assert.deepEqual(plan.ust.map((o) => o.kimlik), ['light.salon']);
});

// --- detay-18: tepsi ipucu ---------------------------------------------------------------

test('ipucuMetni: açık ışık sayısı yazılır; 0 ya da bilinmiyorsa ekleme yapılmaz', () => {
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 1 }), 'Ev Paneli — Ev ağı — 1 ışık açık');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 3 }), 'Ev Paneli — Ev ağı — 3 ışık açık');
  assert.equal(ipucuMetni({ durum: 'İnternet üzerinden', acikIsik: 12 }), 'Ev Paneli — İnternet üzerinden — 12 ışık açık');
  for (const yok of [0, null, undefined, -1, 1.5, '2', NaN]) {
    assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: yok }), 'Ev Paneli — Ev ağı', String(yok));
  }
});

test('ipucuMetni: canlı bağlantı yokken sayı "(son bilinen)" notuyla gelir; canlıyken ya da sayı yokken not düşülmez', () => {
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 2, canli: false }), 'Ev Paneli — Ev ağı — 2 ışık açık (son bilinen)');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 2, canli: true }), 'Ev Paneli — Ev ağı — 2 ışık açık');
  assert.equal(ipucuMetni({ durum: 'Bağlantı yok', acikIsik: 0, canli: false }), 'Ev Paneli — Bağlantı yok');
});

test('ipucuMetni: geliştirme sürümü başlıkta ayrılır (kurulu sürümle karışmasın)', () => {
  assert.equal(ipucuMetni({ durum: 'Ev ağı', gelistirme: true }), 'Ev Paneli [geliştirme] — Ev ağı');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 1, gelistirme: true }), 'Ev Paneli [geliştirme] — Ev ağı — 1 ışık açık');
  assert.equal(ipucuMetni({ durum: 'Bağlanıyor…', gelistirme: false }), 'Ev Paneli — Bağlanıyor…');
});

test('ipucuMetni: Windows sınırına (120 karakter) kırpılır; kod noktası bölünmez', () => {
  assert.equal(IPUCU_SINIRI, 120);
  const uzun = ipucuMetni({ durum: 'x'.repeat(400), acikIsik: 4, canli: false, gelistirme: true });
  assert.equal(Array.from(uzun).length, 120);
  const emojili = ipucuMetni({ durum: '😀'.repeat(200) });
  const harfler = Array.from(emojili);
  assert.equal(harfler.length, 120);
  assert.ok(harfler.slice(-3).every((c) => c === '😀'), 'son kod noktası bütün (vekil çifti bölünmedi)');
  assert.ok(ipucuMetni({ durum: 'İnternet üzerinden', acikIsik: 99, canli: false, gelistirme: true }).length <= 120, 'normal metinler sınıra takılmaz');
});

test('acikIsikSayisi: yalnız favori ışık karolarından AÇIK olanlar sayılır (anahtar, sahne, düğme sayılmaz)', () => {
  const karo = (alan, durum) => ({ id: `${alan}.x`, alan, durum });
  assert.equal(acikIsikSayisi([karo('light', 'acik'), karo('light', 'acik'), karo('light', 'kapali'), karo('light', 'yok')]), 2);
  assert.equal(acikIsikSayisi([karo('switch', 'acik'), karo('scene', 'notr'), karo('button', 'notr'), karo('fan', 'acik')]), 0);
  assert.equal(acikIsikSayisi([]), 0);
  assert.equal(acikIsikSayisi(undefined), 0);
  assert.equal(acikIsikSayisi(null), 0);
});

test('acikIsikSayisi: gerçek karo modeliyle; kapı ışığı karo olamadığı için SAYILMAZ (kapı kuralı)', () => {
  const durumlar = new Map([
    ['light.masa_led_serit', { entity_id: 'light.masa_led_serit', state: 'on', attributes: { brightness: 200, friendly_name: 'Masa LED Şerit' } }],
    ['light.smart_multicolor_bulb', { entity_id: 'light.smart_multicolor_bulb', state: 'off', attributes: { friendly_name: 'Ampul' } }],
    ['light.garaj_kapisi_durum_led', { entity_id: 'light.garaj_kapisi_durum_led', state: 'on', attributes: { friendly_name: 'Garaj Kapısı Durum LED' } }],
  ]);
  const m = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit' },
      { entity_id: 'light.smart_multicolor_bulb', ad: 'Ampul' },
      { entity_id: 'light.garaj_kapisi_durum_led', ad: 'Garaj Kapısı Durum LED' },
    ],
    durumAl: (k) => durumlar.get(k),
  });
  const karolar = m.gruplar.flatMap((g) => g.karolar);
  assert.equal(karolar.some((k) => k.id.includes('kapi')), false);
  assert.equal(acikIsikSayisi(karolar), 1);
});

test('ipucuMetni: yetki kesici uyarısı durumdan hemen sonra gelir; 120 karakter sınırı aşılmaz', () => {
  assert.equal(ipucuMetni({ durum: 'Ev ağı', uyari: 'Erişim anahtarı reddedildi' }), 'Ev Paneli — Ev ağı — Erişim anahtarı reddedildi');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', uyari: 'Erişim anahtarı reddedildi', acikIsik: 2, canli: false }), 'Ev Paneli — Ev ağı — Erişim anahtarı reddedildi — 2 ışık açık (son bilinen)');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', uyari: null }), 'Ev Paneli — Ev ağı');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', uyari: '' }), 'Ev Paneli — Ev ağı');
  assert.ok(Array.from(ipucuMetni({ durum: 'İnternet üzerinden', uyari: 'u'.repeat(300), gelistirme: true })).length <= IPUCU_SINIRI);
});

test('ipucuMetni (o-04): sensör uyarısı sayısı en sona eklenir; 0 ya da geçersiz sayı eklenmez; İngilizce çoğul; 120 sınırı', () => {
  const { cevirmen } = require('../src/lib/dil');
  const ANA = require('../src/lib/ceviri/ana');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', sensorUyari: 1 }), 'Ev Paneli — Ev ağı — 1 sensör uyarısı');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', sensorUyari: 3 }), 'Ev Paneli — Ev ağı — 3 sensör uyarısı');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 2, sensorUyari: 1 }), 'Ev Paneli — Ev ağı — 2 ışık açık — 1 sensör uyarısı');
  assert.equal(ipucuMetni({ durum: 'Ev ağı', acikIsik: 2, canli: false, sensorUyari: 2 }), 'Ev Paneli — Ev ağı — 2 ışık açık (son bilinen) — 2 sensör uyarısı');
  for (const yok of [0, -1, 1.5, null, undefined, '2', NaN]) assert.equal(ipucuMetni({ durum: 'Ev ağı', sensorUyari: yok }), 'Ev Paneli — Ev ağı', String(yok));
  const en = cevirmen('en', ANA);
  assert.equal(ipucuMetni({ durum: 'Home network', sensorUyari: 1, t: en }), 'Home Panel — Home network — 1 sensor alert');
  assert.equal(ipucuMetni({ durum: 'Home network', sensorUyari: 4, t: en }), 'Home Panel — Home network — 4 sensor alerts');
  assert.ok(Array.from(ipucuMetni({ durum: 'İnternet üzerinden', uyari: 'u'.repeat(300), acikIsik: 4, sensorUyari: 9, gelistirme: true })).length <= IPUCU_SINIRI);
});
