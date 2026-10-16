'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { karoOlustur, karolariGrupla, yuzeyModeliOlustur, rendererModeli, RENDERER_KARO_ALANLARI, YARDIMCI_VARLIKLAR, MEDYA_CALIYOR_KIMLIGI, SES_CIKISI_KIMLIGI } = require('../src/lib/yuzey-modeli');
const { HAZIR_LISTE } = require('../src/lib/favoriler');
const { GRUPLAR } = require('../src/lib/favoriler');

const hazirFavoriler = () => HAZIR_LISTE.map((h) => ({ entity_id: h.kimlik, ad: h.etiket, etiket: h.etiket, ...(h.parlaklik ? { parlaklik: true } : {}) }));

function depo(durumlar = {}) {
  return (kimlik) => durumlar[kimlik];
}

test('karoOlustur: ışık açık %50 parlaklık, etiket ve grup', () => {
  const karo = karoOlustur(
    { entity_id: 'light.masa_led_serit', ad: 'Masa LED', etiket: 'LED şerit', parlaklik: true },
    { entity_id: 'light.masa_led_serit', state: 'on', attributes: { brightness: 127, friendly_name: 'Masa LED' } },
  );
  assert.equal(karo.etiket, 'LED şerit');
  assert.equal(karo.grup, 'isik');
  assert.equal(karo.durum, 'acik');
  assert.equal(karo.yuzde, 50);
  assert.equal(karo.parlaklikKontrol, true);
  assert.equal(karo.sinif, 'zararsiz');
  assert.equal(karo.kullanilabilir, true);
});

test('karoOlustur: parlaklikKontrol yalnız ışıkta ve işaretliyse', () => {
  const durum = (k) => ({ entity_id: k, state: 'off', attributes: {} });
  assert.equal(karoOlustur({ entity_id: 'light.a', ad: 'A' }, durum('light.a')).parlaklikKontrol, false);
  assert.equal(karoOlustur({ entity_id: 'switch.a', ad: 'A', parlaklik: true }, durum('switch.a')).parlaklikKontrol, false);
});

test('karoOlustur: yıkıcı eylemler sinif yikici; kısayol/palet için "Son"a uygun değildir', () => {
  const pc = karoOlustur({ entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat' }, { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: {} });
  assert.equal(pc.sinif, 'yikici');
  const iyi = karoOlustur({ entity_id: 'script.iyi_geceler', ad: 'İyi geceler' }, undefined);
  assert.equal(iyi.sinif, 'yikici');
  assert.equal(iyi.kullanilabilir, false, 'durum henüz bilinmiyor');
});

test('KAPI KURALI: kapı/kilit/alarm adı ya da alanı karo üretmez (kayıtlı ad, etiket ya da HA\'daki canlı ad)', () => {
  assert.equal(karoOlustur({ entity_id: 'lock.on_kapi', ad: 'Ön kapı' }, undefined), null);
  assert.equal(karoOlustur({ entity_id: 'switch.kapi_isigi', ad: 'Kapı ışığı' }, undefined), null);
  assert.equal(karoOlustur({ entity_id: 'light.salon', ad: 'Salon', etiket: 'Garaj kapısı' }, undefined), null);
  assert.equal(
    karoOlustur({ entity_id: 'light.salon', ad: 'Salon' }, { entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Garaj kapısı lambası' } }),
    null,
    'HA\'da sonradan yeniden adlandırılmış',
  );
  assert.equal(karoOlustur({ entity_id: 'alarm_control_panel.ev', ad: 'Alarm' }, undefined), null);
  assert.equal(karoOlustur({ entity_id: 'cover.garaj', ad: 'Garaj' }, undefined), null);
  assert.equal(karoOlustur(null, undefined), null);
  assert.equal(karoOlustur({ entity_id: 5 }, undefined), null);
});

test('karoOlustur: etiket yoksa canlı ad, o da yoksa kayıtlı ad; uzun etiket kısaltılır', () => {
  const k1 = karoOlustur({ entity_id: 'light.a', ad: 'Kayıtlı' }, { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'Canlı ad' } });
  assert.equal(k1.etiket, 'Canlı ad');
  assert.equal(k1.ad, 'Canlı ad');
  const k2 = karoOlustur({ entity_id: 'light.a', ad: 'Kayıtlı' }, undefined);
  assert.equal(k2.etiket, 'Kayıtlı');
  assert.equal(k2.ad, 'Kayıtlı');
  const k3 = karoOlustur({ entity_id: 'light.a', ad: 'x'.repeat(100) }, undefined);
  assert.ok(Array.from(k3.etiket).length <= 40);
  assert.ok(Array.from(k3.ad).length <= 40);
  const k4 = karoOlustur({ entity_id: 'light.a', ad: 'Kayıtlı', etiket: 'Özel Etiket' }, undefined);
  assert.equal(k4.etiket, 'Özel Etiket');
  assert.equal(k4.ad, 'Kayıtlı');
});

test('karoOlustur: renderer modelinde yalnız izinli alanlar (anahtar/adres/ham durum yok)', () => {
  const karo = karoOlustur({ entity_id: 'light.a', ad: 'A', kisayol: 'Control+Alt+1' }, { entity_id: 'light.a', state: 'on', attributes: { token: 'gizli', friendly_name: 'A' }, context: { id: 'x' } });
  assert.deepEqual(Object.keys(karo).sort(), ['ad', 'alan', 'altGrup', 'durum', 'etiket', 'grup', 'grupEtiketi', 'id', 'kullanilabilir', 'onayliServisler', 'ozellik', 'parlaklikKontrol', 'sinif', 'tekrar', 'ulasilamiyor', 'varsayilanEylem', 'yuzde']);
  assert.ok(!JSON.stringify(karo).includes('gizli'));
  assert.ok(!JSON.stringify(karo).toLowerCase().includes('control+alt'));
});

test('karolariGrupla: sabit sıra Işık, Sahne, PC, Medya, Diğer; yıkıcılar en alttaki Onaylı satırında (g-07)', () => {
  const durumlar = {};
  const modeli = yuzeyModeliOlustur({ favoriler: hazirFavoriler(), durumAl: depo(durumlar) });
  assert.deepEqual(modeli.gruplar.map((g) => g.kod), ['isik', 'sahne', 'pc', 'medya', 'diger', 'onayli']);
  assert.equal(modeli.gruplar.at(-1).etiket, 'Onaylı', "Onaylı satırı Diğer'in da altında");
  const pc = modeli.gruplar.find((g) => g.kod === 'pc');
  assert.deepEqual(pc.karolar.map((k) => k.id), ['button.pc_ekran_kapat']);
  const onayli = modeli.gruplar.find((g) => g.kod === 'onayli');
  assert.deepEqual(onayli.karolar.map((k) => k.id).sort(), ['button.pc_bilgisayari_kapat', 'script.iyi_geceler']);
  assert.ok(onayli.karolar.every((k) => k.sinif === 'yikici'));
  // 1.4.0: eski beş grup yerinde kalır; İklim, Yardımcılar ve Sensör grupları araya girer
  assert.deepEqual(GRUPLAR.map((g) => g.kod), ['isik', 'iklim', 'sahne', 'pc', 'medya', 'yardimci', 'sensor', 'diger']);
  const toplam = modeli.gruplar.reduce((n, g) => n + g.karolar.length, 0);
  assert.equal(toplam, HAZIR_LISTE.length, 'hiçbir karo kaybolmaz');
});

test('karolariGrupla: boş gruplar atlanır; grup içi sıra favori sırasıdır', () => {
  const m = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'light.b', ad: 'B' },
      { entity_id: 'light.a', ad: 'A' },
    ],
    durumAl: depo(),
  });
  assert.deepEqual(m.gruplar.map((g) => g.kod), ['isik']);
  assert.deepEqual(m.gruplar[0].karolar.map((k) => k.id), ['light.b', 'light.a']);
  assert.deepEqual(karolariGrupla([]), []);
});

test('Son satırı: yalnız zararsız, kullanılabilir ve karosu olan; sıra korunur', () => {
  const durumlar = {
    'light.ampul': { entity_id: 'light.ampul', state: 'on', attributes: {} },
    'scene.film': { entity_id: 'scene.film', state: 'unknown', attributes: {} },
    'script.iyi_geceler': { entity_id: 'script.iyi_geceler', state: 'off', attributes: {} },
  };
  const modeli = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'light.ampul', ad: 'Ampul' },
      { entity_id: 'scene.film', ad: 'Film' },
      { entity_id: 'script.iyi_geceler', ad: 'İyi geceler' },
      { entity_id: 'light.bilinmeyen', ad: 'Bilinmeyen' },
    ],
    durumAl: depo(durumlar),
    sonKimlikler: ['script.iyi_geceler', 'scene.film', 'light.hic_yok', 'light.bilinmeyen', 'light.ampul'],
  });
  assert.deepEqual(modeli.sonlar.map((k) => k.id), ['scene.film', 'light.ampul']);
});

test('üst şerit: canlı bağlantı, medya çalıyor, etkin ses çıkışı, kısaltılmış hata', () => {
  const durumlar = {
    [MEDYA_CALIYOR_KIMLIGI]: { entity_id: MEDYA_CALIYOR_KIMLIGI, state: 'on', attributes: {} },
    [SES_CIKISI_KIMLIGI]: { entity_id: SES_CIKISI_KIMLIGI, state: 'Kulaklık (USB)', attributes: {} },
  };
  const m = yuzeyModeliOlustur({ favoriler: [], durumAl: depo(durumlar), baglanti: { canli: true, baglanti: 'canli', hata: 'x'.repeat(500) } });
  assert.equal(m.ust.canli, true);
  assert.equal(m.ust.medyaCaliyor, true);
  assert.equal(m.ust.aktifCikis, 'kulaklik');
  assert.ok(m.ust.hata.length <= 100);
  const bos = yuzeyModeliOlustur({ favoriler: [], durumAl: depo() });
  assert.deepEqual(bos.ust, { canli: false, baglanti: 'kapali', medyaCaliyor: null, aktifCikis: null, hata: null, uyari: null, anahtarYok: false });
  // yetki kesici açıkken kısa uyarı gider (en çok 100 karakter); boş ya da metin olmayan değer null olur
  const uyarili = yuzeyModeliOlustur({ favoriler: [], durumAl: depo(), baglanti: { uyari: 'Erişim anahtarı reddedildi' } });
  assert.equal(uyarili.ust.uyari, 'Erişim anahtarı reddedildi');
  assert.ok(yuzeyModeliOlustur({ favoriler: [], durumAl: depo(), baglanti: { uyari: 'u'.repeat(500) } }).ust.uyari.length <= 100);
  for (const yok of ['', null, 5, {}]) assert.equal(yuzeyModeliOlustur({ favoriler: [], durumAl: depo(), baglanti: { uyari: yok } }).ust.uyari, null);
  assert.deepEqual(YARDIMCI_VARLIKLAR, [MEDYA_CALIYOR_KIMLIGI, SES_CIKISI_KIMLIGI]);
});

test('hazır liste modeli: 18 karo, hepsi güvenli; hoparlör/kulaklık çıkış alt grubunda', () => {
  const m = yuzeyModeliOlustur({ favoriler: hazirFavoriler(), durumAl: depo() });
  const tum = m.gruplar.flatMap((g) => g.karolar);
  assert.equal(tum.length, 18);
  const medya = m.gruplar.find((g) => g.kod === 'medya').karolar;
  assert.deepEqual(medya.filter((k) => k.altGrup === 'cikis').map((k) => k.etiket), ['Hoparlör', 'Kulaklık']);
  assert.equal(tum.find((k) => k.id === 'button.pc_mediavolumeup').tekrar, true);
});

// --- denetim düzeltmeleri (Dalga 3): karolariOlustur ---------------------------------

test('karolariOlustur: karolar FAVORİ SIRASINDA gelir (grup sırasında değil)', () => {
  const { karolariOlustur } = require('../src/lib/yuzey-modeli');
  const favoriler = [
    { entity_id: 'scene.film', ad: 'Film' },
    { entity_id: 'light.ampul', ad: 'Ampul' },
    { entity_id: 'switch.priz', ad: 'Priz' },
  ];
  const karolar = karolariOlustur(favoriler, depo());
  assert.deepEqual(karolar.map((k) => k.id), ['scene.film', 'light.ampul', 'switch.priz']);
  // gruplanmış model ise grup sırasını izler; favori sırası yalnız karolariOlustur'da korunur
  const gruplu = yuzeyModeliOlustur({ favoriler, durumAl: depo() }).gruplar.flatMap((g) => g.karolar.map((k) => k.id));
  assert.deepEqual([...gruplu].sort(), ['light.ampul', 'scene.film', 'switch.priz']);
});

// --- g-07, h-15, k-03 (panel ve palet arayüzü) ------------------------------------------------

test('karolariGrupla: yıkıcı karo hangi grupta olursa olsun Onaylı satırına gider; yalnız yıkıcı varsa Onaylı tek grup olur', () => {
  const k = (id, grup, sinif) => ({ id, grup, sinif });
  const gruplar = karolariGrupla([k('a', 'diger', 'zararsiz'), k('b', 'pc', 'yikici'), k('c', 'isik', 'zararsiz'), k('d', 'medya', 'yikici')]);
  assert.deepEqual(gruplar.map((g) => g.kod), ['isik', 'diger', 'onayli']);
  assert.deepEqual(gruplar.at(-1).karolar.map((x) => x.id), ['b', 'd'], 'Onaylı içinde favori sırası korunur');
  assert.deepEqual(karolariGrupla([k('x', 'pc', 'yikici')]).map((g) => g.kod), ['onayli']);
});

test('h-15: rendererModeli karodaki HA adını (ad) ve bilinmeyen ana-süreç alanlarını çıkarır; ana süreç karosunda ad kalır', () => {
  const m = yuzeyModeliOlustur({
    favoriler: [{ entity_id: 'light.a', ad: 'Salon (HA uzun adı)', etiket: 'Salon', parlaklik: true }],
    durumAl: depo({ 'light.a': { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'Salon (HA uzun adı)', brightness: 255 } } }),
    sonKimlikler: ['light.a'],
  });
  assert.equal(m.gruplar[0].karolar[0].ad, 'Salon (HA uzun adı)', 'komut satırı eşleşmesi için ana süreç modelinde durur');
  m.gruplar[0].karolar[0].gizliAlan = 'sızmamalı';
  const r = rendererModeli(m);
  const karolar = [...r.gruplar.flatMap((g) => g.karolar), ...r.sonlar];
  assert.equal(karolar.length, 2);
  for (const karo of karolar) {
    assert.deepEqual(Object.keys(karo).sort(), [...RENDERER_KARO_ALANLARI].sort());
    assert.equal('ad' in karo, false);
    assert.ok(!JSON.stringify(karo).includes('HA uzun'));
    assert.ok(!JSON.stringify(karo).includes('sızmamalı'));
  }
  assert.equal(r.gruplar[0].karolar[0].etiket, 'Salon');
  assert.equal(r.gruplar[0].kod, 'isik');
  assert.deepEqual(r.ust, m.ust);
  assert.equal(m.gruplar[0].karolar[0].ad, 'Salon (HA uzun adı)', 'girdi değiştirilmez');
});

test('h-15: rendererModeli bozuk girdide boş model verir', () => {
  for (const kotu of [null, undefined, {}, { gruplar: 'x', sonlar: 5 }]) {
    const r = rendererModeli(kotu);
    assert.deepEqual([r.gruplar, r.sonlar], [[], []]);
    assert.equal(typeof r.ust, 'object');
  }
});

test('k-03: ust.anahtarYok yalnız true ise true olur ("anahtar yok" ile "favori yok" ayrılır)', () => {
  const anahtarYok = (baglanti) => yuzeyModeliOlustur({ favoriler: [], durumAl: depo(), baglanti }).ust.anahtarYok;
  assert.equal(anahtarYok({ anahtarYok: true }), true);
  for (const yok of [undefined, false, 'evet', 1, null]) assert.equal(anahtarYok({ anahtarYok: yok }), false);
});

test('karolariOlustur: kapı/kilit/alarm/garaj favorileri süzülür, dizi olmayan girdi boş döner', () => {
  const { karolariOlustur } = require('../src/lib/yuzey-modeli');
  const favoriler = [
    { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
    { entity_id: 'cover.garaj_kapisi', ad: 'Garaj kapısı' },
    { entity_id: 'alarm_control_panel.ev', ad: 'Alarm' },
    { entity_id: 'light.ampul', ad: 'Ampul' },
    { entity_id: 'switch.kapi_acici', ad: 'Kapı açıcı' },
  ];
  assert.deepEqual(karolariOlustur(favoriler, depo()).map((k) => k.id), ['light.ampul']);
  assert.deepEqual(karolariOlustur(null, depo()), []);
  assert.deepEqual(karolariOlustur(undefined, depo()), []);
});

// --- 1.4.0: yeni alan karoları -----------------------------------------------------------------------------

test('1.4.0 karo: güvenli öznitelik alt kümesi (ozellik), tek tıklama eylemi ve onaylı servisler; renderer\'a resim/ad gitmez', () => {
  const durumlar = {
    'climate.salon': { entity_id: 'climate.salon', state: 'heat', attributes: { friendly_name: 'Salon kliması (HA)', hvac_modes: ['off', 'heat'], min_temp: 16, max_temp: 30, entity_picture: '/api/x?token=GIZLI' } },
    'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21', attributes: { unit_of_measurement: '°C' } },
    'binary_sensor.on_kapi': { entity_id: 'binary_sensor.on_kapi', state: 'off', attributes: { device_class: 'door' } },
    'media_player.tv': { entity_id: 'media_player.tv', state: 'playing', attributes: { media_title: 'Garage door', entity_picture: '/api/media_player_proxy/x?token=GIZLI' } },
    'light.a': { entity_id: 'light.a', state: 'on', attributes: {} },
  };
  const m = yuzeyModeliOlustur({
    favoriler: [
      { entity_id: 'climate.salon', ad: 'Klima', etiket: 'Klima' }, // etiketsiz favoride 1.3.0'dan beri canlı ad etiket olur (k1 testi)
      { entity_id: 'sensor.sicaklik', ad: 'Sıcaklık' },
      { entity_id: 'binary_sensor.on_kapi', ad: 'Sensör' },
      { entity_id: 'media_player.tv', ad: 'TV' },
      { entity_id: 'light.a', ad: 'A' },
      { entity_id: 'todo.alisveris', ad: 'Liste' },
      { entity_id: 'cover.perde', ad: 'Perde' },
    ],
    durumAl: depo(durumlar),
  });
  const karolar = m.gruplar.flatMap((g) => g.karolar);
  assert.deepEqual(karolar.map((k) => k.id).sort(), ['climate.salon', 'light.a', 'media_player.tv', 'sensor.sicaklik'], 'kapı sınıflı sensör, karo olmayan todo ve cover yok');
  const bul = (id) => karolar.find((k) => k.id === id);
  assert.equal(bul('climate.salon').varsayilanEylem, false);
  assert.deepEqual(bul('climate.salon').onayliServisler, ['set_hvac_mode']);
  assert.deepEqual(bul('climate.salon').ozellik.modlar, ['off', 'heat']);
  assert.equal(bul('sensor.sicaklik').ozellik.sayi, 21);
  assert.deepEqual(bul('sensor.sicaklik').onayliServisler, []);
  assert.equal(bul('media_player.tv').ozellik.baslik, null);
  assert.equal(bul('light.a').varsayilanEylem, true);
  const r = rendererModeli(m);
  const metin = JSON.stringify(r);
  assert.ok(!metin.includes('GIZLI'));
  assert.ok(!metin.includes('Salon kliması (HA)'));
  assert.ok(!metin.includes('entity_picture'));
  const rKlima = r.gruplar.flatMap((g) => g.karolar).find((k) => k.id === 'climate.salon');
  rKlima.ozellik.modlar.push('degisti');
  assert.deepEqual(bul('climate.salon').ozellik.modlar, ['off', 'heat'], 'renderer kopyası ana modeli değiştirmez');
});
