'use strict';

/**
 * 1.4.0 cihaz grubu (o-48 kamera, o-49 otomasyon, o-50 perde, o-59 vana): Kapı Kuralı süzgeci ve eylem sınıfı.
 *  - cover YALNIZ curtain/blind/shade/awning cihaz sınıfıyla (tam, küçük harfli) ve kapı/garaj/kepenk adı taşımadan geçer.
 *  - kamera genel süzgeçten HİÇ geçmez; yalnız kameraGuvenliMi (kapı, zil, diafon, giriş adlı kameralar elenir).
 *  - vana ve otomasyon ZORUNLU onaylıdır (onay:false etkisiz); perde zararsızdır; hiçbiri kısayol/komut satırından çalışmaz (vana/otomasyon).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/suzgec');
const { SINIF, ZORUNLU_ONAYLI_ALANLAR, eylemSinifi, kaynakIzni } = require('../src/lib/eylem-sinifi');

const kapak = (entity_id, friendly_name, device_class, state = 'open') => ({
  entity_id,
  state,
  attributes: { friendly_name, ...(device_class === undefined ? {} : { device_class }) },
});
const kamera = (entity_id, friendly_name, ek = {}) => ({ entity_id, state: 'idle', attributes: { friendly_name, ...ek } });

test('perde: yalnız curtain, blind, shade, awning cihaz sınıfı geçer', () => {
  assert.deepEqual([...S.PERDE_SINIFLARI], ['curtain', 'blind', 'shade', 'awning']);
  for (const sinif of S.PERDE_SINIFLARI) assert.equal(S.guvenliVarlikMi(kapak('cover.salon', 'Salon perde', sinif)), true, sinif);
});

test('perde: garaj, kepenk, kapı, pencere, damper, boş ve bilinmeyen sınıf geçmez', () => {
  for (const sinif of ['garage', 'shutter', 'gate', 'door', 'window', 'damper', '', 'unknown', 'curtain_door']) {
    assert.equal(S.guvenliVarlikMi(kapak('cover.salon', 'Salon perde', sinif)), false, JSON.stringify(sinif));
  }
  assert.equal(S.guvenliVarlikMi(kapak('cover.salon', 'Salon perde', undefined)), false, 'sınıfsız cover');
});

test('perde: sınıf yazımı kesindir (büyük harf, boşluklu, tam genişlik, nesne) kabul edilmez', () => {
  for (const sinif of ['Curtain', 'CURTAIN', ' curtain', 'curtain ', 'ｃｕｒｔａｉｎ', 'curtain​', null, 5, {}, ['curtain']]) {
    const v = { entity_id: 'cover.salon', state: 'open', attributes: { friendly_name: 'Salon perde', device_class: sinif } };
    assert.equal(S.guvenliVarlikMi(v), false, JSON.stringify(sinif));
  }
});

test('perde: kapı/garaj/kepenk/kilit adı taşıyan "perde" sınıfı doğru olsa da elenir (ad ve kimlik)', () => {
  for (const ad of ['Ön kapı perdesi', 'Garaj', 'Gate opener', 'Front door', 'Kepenk', 'Bariyer', 'Kilidi aç', 'Rollladen', 'Volet', 'Persiana']) {
    assert.equal(S.guvenliVarlikMi(kapak('cover.x', ad, 'curtain')), false, ad);
  }
  for (const kimlik of ['cover.garaj_perde', 'cover.garage_door', 'cover.on_kapi', 'cover.gate']) {
    assert.equal(S.guvenliVarlikMi(kapak(kimlik, 'Perde', 'curtain')), false, kimlik);
  }
  for (const ad of ['Salon perdesi', 'Yatak odası jaluzi', 'Balkon tente', 'Living room curtain']) {
    assert.equal(S.guvenliVarlikMi(kapak('cover.x', ad, 'blind')), true, ad);
  }
});

test('perde: üyesi olan (grup/sahne benzeri) cover ve üyesinde cover bulunan sahne engellenir (üye sınıfı bilinmez)', () => {
  const uyeli = { entity_id: 'cover.grup', state: 'open', attributes: { friendly_name: 'Perdeler', device_class: 'curtain', entity_id: ['cover.a', 'lock.on_kapi'] } };
  assert.equal(S.guvenliVarlikMi(uyeli), false);
  const kapakUyeli = { entity_id: 'cover.grup', state: 'open', attributes: { friendly_name: 'Perdeler', device_class: 'curtain', entity_id: ['cover.a', 'cover.b'] } };
  assert.equal(S.guvenliVarlikMi(kapakUyeli), false, 'cover üye sınıfı sahne/grup niteliğinde yok: kepenk ile perde ayırt edilemez');
  const sahne = { entity_id: 'scene.film', state: 'scening', attributes: { friendly_name: 'Film', entity_id: ['light.salon', 'cover.perde'] } };
  assert.equal(S.guvenliVarlikMi(sahne), false);
  const duzSahne = { entity_id: 'scene.film', state: 'scening', attributes: { friendly_name: 'Film', entity_id: ['light.salon'] } };
  assert.equal(S.guvenliVarlikMi(duzSahne), true);
});

test('kamera: genel süzgeçten hiçbir zaman geçmez (ne kimlikle, ne cihaz sınıfıyla); ayrı yol kameraGuvenliMi', () => {
  assert.equal(S.guvenliVarlikMi(kamera('camera.salon', 'Salon')), false);
  assert.equal(S.guvenliVarlikMi(kamera('camera.balkon', 'Balkon', { device_class: 'curtain' })), false);
  assert.equal(S.kameraGuvenliMi(kamera('camera.salon', 'Salon')), true);
});

test('kamera: giriş, kapı, zil, diafon ve ziyaretçi adlı kameralar elenir', () => {
  const yasak = [
    ['camera.giris', 'Giriş'],
    ['camera.on_kapi', 'Ön kapı'],
    ['camera.entrance', 'Entrance'],
    ['camera.x', 'Doorbell'],
    ['camera.zil', 'Zil'],
    ['camera.ring_x', 'Ring cam'],
    ['camera.x1', 'Eingang'],
    ['camera.x2', 'Sonnette'],
    ['camera.x3', 'Timbre'],
    ['camera.x4', 'Entrada'],
    ['camera.diafon', 'Diafon'],
    ['camera.x5', 'Intercom'],
    ['camera.x6', 'Garaj'],
    ['camera.x7', 'Lobby'],
    ['camera.x8', 'Visitor cam'],
  ];
  for (const [kimlik, ad] of yasak) assert.equal(S.kameraGuvenliMi(kamera(kimlik, ad)), false, `${kimlik} ${ad}`);
});

test('kamera: bebek odası, balkon, bahçe, salon ve "spring/string" gibi masum adlar geçer', () => {
  for (const [kimlik, ad] of [
    ['camera.salon', 'Salon'],
    ['camera.bebek', 'Bebek odası'],
    ['camera.balkon', 'Balkon'],
    ['camera.bahce', 'Front yard'],
    ['camera.arka', 'Back garden'],
    ['camera.spring', 'Spring garden'],
    ['camera.string', 'String lights'],
  ]) {
    assert.equal(S.kameraGuvenliMi(kamera(kimlik, ad)), true, `${kimlik} ${ad}`);
  }
});

test('kamera: marka, model ve cihaz sınıfı da denetlenir; kapı zili markası/modeli elenir, sayı olmayan marka elenir', () => {
  assert.equal(S.kameraGuvenliMi(kamera('camera.a', 'Salon', { brand: 'Reolink' })), true);
  assert.equal(S.kameraGuvenliMi(kamera('camera.a', 'Salon', { brand: 'Ring' })), false);
  assert.equal(S.kameraGuvenliMi(kamera('camera.a', 'Salon', { model_name: 'Video Doorbell Pro' })), false);
  assert.equal(S.kameraGuvenliMi(kamera('camera.a', 'Salon', { brand: 5 })), false);
  assert.equal(S.kameraGuvenliMi(kamera('camera.a', 'Salon', { device_class: 'door' })), false);
});

test('kamera: kimlik denetimi (alan camera, desen, tür) ve bozuk girdiler', () => {
  assert.equal(S.kameraKimligiGuvenliMi('camera.salon'), true);
  for (const kotu of ['light.salon', 'camera.Salon', 'camera.', 'camera', 'camera.ring', 'camera.door_1', 'camera.a/b', 'camera.a b', '', 5, null, undefined, {}, ['camera.salon']]) {
    assert.equal(S.kameraKimligiGuvenliMi(kotu), false, JSON.stringify(kotu));
  }
  for (const kotu of [null, undefined, 5, 'camera.salon', {}, { entity_id: 5 }, { entity_id: 'camera.salon', attributes: 'x' }, { entity_id: 'camera.salon', attributes: [] }]) {
    // nitelik biçimi bozuksa varlık yine de yalnız kimlik/ad kurallarıyla değerlendirilir; hata fırlatmaz
    assert.doesNotThrow(() => S.kameraGuvenliMi(kotu));
  }
  assert.equal(S.kameraGuvenliMi(null), false);
  assert.equal(S.kameraGuvenliMi('camera.salon'), false);
});

test('eylem sınıfı: vana ve otomasyon zorunlu onaylı; onay:false etkisiz; her servisi yıkıcı', () => {
  assert.deepEqual([...ZORUNLU_ONAYLI_ALANLAR].sort(), ['automation', 'valve']);
  const vana = { entity_id: 'valve.su', state: 'open', attributes: { friendly_name: 'Bahçe suyu' } };
  const oto = { entity_id: 'automation.gece', state: 'on', attributes: { friendly_name: 'Gece modu' } };
  for (const varlik of [vana, oto]) {
    for (const favori of [undefined, {}, { onay: true }, { onay: false }]) {
      const s = eylemSinifi(varlik, favori);
      assert.equal(s.sinif, SINIF.YIKICI, JSON.stringify(favori));
      assert.equal(s.zorunlu, true, `${varlik.entity_id} ${JSON.stringify(favori)}: onay kapatılamaz`);
    }
  }
  for (const servis of ['open_valve', 'close_valve']) {
    const s = eylemSinifi(vana, { onay: false }, servis);
    assert.equal(s.sinif, SINIF.YIKICI, servis);
    assert.equal(s.zorunlu, true, servis);
  }
  for (const servis of ['trigger', 'turn_on', 'turn_off']) {
    const s = eylemSinifi(oto, { onay: false }, servis);
    assert.equal(s.sinif, SINIF.YIKICI, servis);
    assert.equal(s.zorunlu, true, servis);
  }
});

test('eylem sınıfı: perde servisleri zararsız; "Onay iste" işaretli favori yıkıcı olur, sınıfsız cover yasak kalır', () => {
  const perde = kapak('cover.salon', 'Salon perde', 'curtain');
  for (const servis of [undefined, 'open_cover', 'close_cover', 'stop_cover', 'set_cover_position']) {
    const s = eylemSinifi(perde, undefined, servis);
    assert.equal(s.sinif, SINIF.ZARARSIZ, String(servis));
    assert.equal(s.zorunlu, false, String(servis));
  }
  assert.equal(eylemSinifi(perde, { onay: true }, 'open_cover').sinif, SINIF.YIKICI);
  assert.equal(eylemSinifi(perde, { onay: true }, 'open_cover').zorunlu, false);
  assert.equal(eylemSinifi(kapak('cover.garaj', 'Garaj', 'garage'), undefined, 'open_cover').sinif, SINIF.YASAK);
  assert.equal(eylemSinifi(kapak('cover.x', 'Bir şey', undefined), undefined, 'open_cover').sinif, SINIF.YASAK);
  assert.equal(eylemSinifi(kamera('camera.salon', 'Salon'), undefined, 'turn_on').sinif, SINIF.YASAK, 'kamera eylem alanı değildir');
});

test('kaynak izni: vana ve otomasyon yalnız panel/palet (basılı tutma) ve tepsi menüsü (diyalog); kısayol, komut satırı ve karolardan çalışmaz', () => {
  const oto = eylemSinifi({ entity_id: 'automation.gece', state: 'on', attributes: { friendly_name: 'Gece modu' } });
  assert.deepEqual(kaynakIzni(oto.sinif, 'panel'), { izin: true, onayTuru: 'basili' });
  assert.deepEqual(kaynakIzni(oto.sinif, 'palet'), { izin: true, onayTuru: 'basili' });
  assert.deepEqual(kaynakIzni(oto.sinif, 'tepsi-menu'), { izin: true, onayTuru: 'diyalog' });
  assert.equal(kaynakIzni(oto.sinif, 'kisayol').izin, false);
  assert.equal(kaynakIzni(oto.sinif, 'komut-satiri').izin, false);
  const perde = eylemSinifi(kapak('cover.salon', 'Salon perde', 'curtain'), undefined, 'open_cover');
  for (const kaynak of ['panel', 'palet', 'tepsi-menu', 'kisayol', 'komut-satiri']) {
    assert.deepEqual(kaynakIzni(perde.sinif, kaynak), { izin: true, onayTuru: null }, `perde ${kaynak}`);
  }
});
