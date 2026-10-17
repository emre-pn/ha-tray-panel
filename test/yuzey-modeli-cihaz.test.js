'use strict';

/**
 * 1.4.0 cihaz grubu: yüzey modeli (src/lib/yuzey-modeli.js) — perde, vana, otomasyon karoları ve kamera bölümü.
 *  - cover karosu YALNIZ HA'daki canlı durumla görünür (cihaz sınıfı kayıttan bilinemez).
 *  - vana ve otomasyon "yıkıcı" (zorunlu onay); otomasyon tek tıklama eylemi olduğundan "Onaylı" satırına girer, vana kendi grubunda kalır.
 *  - kamera bölümü renderer'a yalnız { liste: [{id, etiket, kullanilabilir}], bulanik, yenilemeSn } olarak gider; görüntü/adres/token yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karoOlustur, yuzeyModeliOlustur, rendererKamera, rendererModeli, rendererKaro, RENDERER_KARO_ALANLARI } = require('../src/lib/yuzey-modeli');

const perde = (ek = {}, state = 'open', sinif = 'curtain') => ({
  entity_id: 'cover.salon',
  state,
  attributes: { friendly_name: 'Salon perde', device_class: sinif, current_position: 40, supported_features: 15, ...ek },
});
const vana = (state = 'open') => ({ entity_id: 'valve.su', state, attributes: { friendly_name: 'Bahçe suyu' } });
const oto = (state = 'on') => ({ entity_id: 'automation.gece', state, attributes: { friendly_name: 'Gece modu', last_triggered: '2026-10-16T22:00:00+00:00' } });
const FAV = {
  perde: { entity_id: 'cover.salon', ad: 'Salon perde' },
  vana: { entity_id: 'valve.su', ad: 'Bahçe suyu' },
  oto: { entity_id: 'automation.gece', ad: 'Gece modu' },
};

test('perde karosu: perde grubu, zararsız, konum ve destek özelliği; tek tıklama servisi yok', () => {
  const karo = karoOlustur(FAV.perde, perde());
  assert.equal(karo.grup, 'perde');
  assert.equal(karo.grupEtiketi, 'Perde');
  assert.equal(karo.alan, 'cover');
  assert.equal(karo.sinif, 'zararsiz');
  assert.equal(karo.durum, 'acik');
  assert.equal(karo.varsayilanEylem, false);
  assert.deepEqual(karo.onayliServisler, []);
  assert.deepEqual(karo.ozellik, { durum: 'open', konum: 40, sinif: 'curtain', destek: 15 });
  assert.equal(karoOlustur(FAV.perde, perde({}, 'closed')).durum, 'kapali');
  assert.equal(karoOlustur(FAV.perde, perde({}, 'unavailable')).ulasilamiyor, true);
});

test('perde karosu: canlı durum yoksa HİÇ görünmez (sınıf doğrulanamaz); garaj/sınıfsız/kapı adlı cover görünmez', () => {
  assert.equal(karoOlustur(FAV.perde, undefined), null);
  assert.equal(karoOlustur(FAV.perde, null), null);
  assert.equal(karoOlustur(FAV.perde, perde({}, 'open', 'garage')), null);
  assert.equal(karoOlustur(FAV.perde, { entity_id: 'cover.salon', state: 'open', attributes: { friendly_name: 'Salon perde' } }), null, 'sınıfsız cover');
  assert.equal(karoOlustur(FAV.perde, perde({ friendly_name: 'Ön kapı perdesi' })), null);
  assert.equal(karoOlustur({ entity_id: 'cover.salon', ad: 'Kapı' }, perde()), null, 'kayıtlı ad kapı sözcüğü taşıyorsa');
});

test('vana karosu: yıkıcı (zorunlu onay), tek tıklama eylemi yok, onaylı servisleri açık/kapat', () => {
  const karo = karoOlustur(FAV.vana, vana());
  assert.equal(karo.sinif, 'yikici');
  assert.equal(karo.alan, 'valve');
  assert.equal(karo.varsayilanEylem, false);
  assert.deepEqual(karo.onayliServisler, ['open_valve', 'close_valve']);
  assert.equal(karo.durum, 'acik');
  assert.equal(karoOlustur(FAV.vana, vana('closed')).durum, 'kapali');
  assert.equal(karoOlustur({ ...FAV.vana, onay: false }, vana()).sinif, 'yikici', 'onay:false etkisiz');
});

test('otomasyon karosu: yıkıcı, tek tıklama eylemi tetiklemedir, servisleri trigger/turn_on/turn_off', () => {
  const karo = karoOlustur({ ...FAV.oto, onay: false }, oto());
  assert.equal(karo.sinif, 'yikici', 'onay:false etkisiz');
  assert.equal(karo.varsayilanEylem, true);
  assert.deepEqual(karo.onayliServisler, ['trigger', 'turn_on', 'turn_off']);
  assert.deepEqual(karo.ozellik, { acik: true, sonTetik: '2026-10-16T22:00:00+00:00' });
  assert.equal(karoOlustur(FAV.oto, oto('off')).durum, 'kapali');
});

test('yuzeyModeliOlustur: perde kendi grubunda, otomasyon "Onaylı" satırında, vana kendi grubunda (Onaylı satırına çıkmaz)', () => {
  const durumlar = { 'cover.salon': perde(), 'valve.su': vana(), 'automation.gece': oto(), 'light.a': { entity_id: 'light.a', state: 'on', attributes: {} } };
  const model = yuzeyModeliOlustur({ favoriler: [FAV.perde, FAV.vana, FAV.oto, { entity_id: 'light.a', ad: 'A' }], durumAl: (k) => durumlar[k] });
  assert.deepEqual(model.gruplar.map((g) => [g.kod, g.karolar.map((k) => k.id)]), [
    ['isik', ['light.a']],
    ['perde', ['cover.salon']],
    ['diger', ['valve.su']],
    ['onayli', ['automation.gece']],
  ]);
  assert.equal(model.kamera, null, 'kamera verilmediyse bölüm yok');
});

test('yuzeyModeliOlustur: kamera ham olarak modele geçer; rendererModeli süzer (görüntü, adres, token düşer)', () => {
  const kamera = { liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true, resim: 'data:image/png;base64,AAAA', url: 'http://x/y', token: 'GIZLI' }], bulanik: true, yenilemeSn: 0, token: 'GIZLI' };
  const model = yuzeyModeliOlustur({ favoriler: [], durumAl: () => undefined, kamera });
  const r = rendererModeli(model);
  assert.deepEqual(r.kamera, { liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }], bulanik: true, yenilemeSn: 0 });
  assert.doesNotMatch(JSON.stringify(r), /GIZLI|data:image|http:\/\/x/);
});

test('rendererKamera: kapı/zil/giriş kamerası, tekrar ve geçersiz öğe elenir; en çok 8; liste boşsa null', () => {
  const r = rendererKamera({
    liste: [
      { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true },
      { id: 'camera.zil', etiket: 'Zil' },
      { id: 'camera.salon', etiket: 'Yine' },
      { id: 'camera.b', etiket: 'Ön kapı' },
      { id: 'light.a', etiket: 'Işık' },
      { id: 5, etiket: 'x' },
      null,
      'camera.c',
    ],
    bulanik: false,
    yenilemeSn: 30,
  });
  assert.deepEqual(r, { liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }], bulanik: false, yenilemeSn: 30 });
  const cok = rendererKamera({ liste: Array.from({ length: 12 }, (_, i) => ({ id: `camera.k${i}`, etiket: `K ${i}` })) });
  assert.equal(cok.liste.length, 8);
  for (const bos of [{ liste: [] }, { liste: [{ id: 'camera.zil', etiket: 'Zil' }] }, {}, null, undefined, 'x', 5, { liste: 'camera.salon' }]) assert.equal(rendererKamera(bos), null, JSON.stringify(bos));
});

test('rendererKamera: bulanık varsayılan açık (yalnız açıkça false kapalı); yenileme yalnız 0/5/10/30/60; kullanilabilir yalnız true', () => {
  const liste = [{ id: 'camera.salon', etiket: 'Salon' }];
  assert.equal(rendererKamera({ liste }).bulanik, true);
  for (const deger of [undefined, null, 0, '', 'false', 'hayır']) assert.equal(rendererKamera({ liste, bulanik: deger }).bulanik, true, String(deger));
  assert.equal(rendererKamera({ liste, bulanik: false }).bulanik, false);
  for (const sn of [0, 5, 10, 30, 60]) assert.equal(rendererKamera({ liste, yenilemeSn: sn }).yenilemeSn, sn);
  for (const sn of [1, 7, 61, -5, '30', null, NaN, Infinity, undefined]) assert.equal(rendererKamera({ liste, yenilemeSn: sn }).yenilemeSn, 0, String(sn));
  assert.equal(rendererKamera({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: 'evet' }] }).liste[0].kullanilabilir, false);
});

test('rendererKamera: uzun etiket kısaltılır; etiket yoksa kimlik gösterilir', () => {
  const r = rendererKamera({ liste: [{ id: 'camera.salon', etiket: 'U'.repeat(300) }, { id: 'camera.balkon', etiket: '   ' }] });
  assert.ok(r.liste[0].etiket.length <= 40);
  assert.equal(r.liste[1].etiket, 'camera.balkon');
});

test('rendererKaro: perde karosunun renderer\'a giden alanları beyaz listededir ve canlı HA adı/konum sızmaz', () => {
  const karo = rendererKaro(karoOlustur(FAV.perde, perde({ entity_picture: '/x?token=GIZLI', latitude: 41 })));
  for (const anahtar of Object.keys(karo)) assert.ok(RENDERER_KARO_ALANLARI.includes(anahtar), anahtar);
  assert.doesNotMatch(JSON.stringify(karo), /GIZLI|latitude/);
  assert.equal(karo.ozellik.konum, 40);
});
