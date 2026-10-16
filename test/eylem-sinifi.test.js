'use strict';

/**
 * Eylem sınıflandırması (hata-04), gerçek HA envanteriyle (test/veri/envanter.json).
 * Kapı/kilit/alarm YASAK'tır ve hiçbir yüzeyde çalışmaz; yıkıcı eylem kısayola ve komut satırına atanamaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SINIF,
  KAYNAKLAR,
  YIKICI_KIMLIKLER,
  ZARARSIZ_KIMLIKLER,
  eylemSinifi,
  kaynakIzni,
  onayAciklamasi,
} = require('../src/lib/eylem-sinifi');
const { guvenliVarlikMi } = require('../src/lib/suzgec');
const envanter = require('./veri/envanter.json');

const gercek = (kimlik) => {
  const o = envanter.find((e) => e.entity_id === kimlik);
  assert.ok(o, `${kimlik} envanterde yok`);
  return {
    entity_id: o.entity_id,
    state: o.state,
    attributes: { friendly_name: o.friendly_name, ...(o.device_class ? { device_class: o.device_class } : {}) },
  };
};
const sinif = (kimlik, favori) => eylemSinifi(gercek(kimlik), favori);
const sentetik = (entity_id, friendly_name) => ({ entity_id, state: 'off', attributes: { friendly_name } });

test('hazır liste zararsızları: sahneler, ekranı kapat, medya, kahve prizi, telefonu bul, ışıklar', () => {
  for (const kimlik of [
    'scene.calisma',
    'scene.aksam',
    'scene.film',
    'scene.gece_lambasi',
    'button.pc_ekran_kapat',
    'button.pc_ekran_ac',
    'button.pc_mediaplaypause',
    'button.pc_medianext',
    'button.pc_mediavolumeup',
    'button.pc_mediavolumedown',
    'button.pc_mediamute',
    'button.pc_ses_cikis_hoparlor',
    'button.pc_ses_cikis_kulaklik',
    'switch.smart_plug_mini',
    'script.telefonu_bul',
    'light.masa_led_serit',
    'light.smart_multicolor_bulb',
  ]) {
    const s = sinif(kimlik);
    assert.equal(s.sinif, SINIF.ZARARSIZ, kimlik);
    assert.equal(s.zorunlu, false, kimlik);
  }
});

test('PC kapat, yeniden başlat, uyut, PowerShell, İyi geceler, HA yeniden başlat ve oyun bilgisayarı yıkıcı ve zorunludur', () => {
  for (const kimlik of [
    'button.pc_bilgisayari_kapat',
    'button.pc_bilgisayari_yeniden_baslat',
    'button.pc_bilgisayari_uyut',
    'button.pc_powershell',
    'button.pc2_bilgisayari_kapat',
    'button.pc2_bilgisayari_yeniden_baslat',
    'button.homeassistant_restart',
    'button.homeassistant_reload',
    'script.pc_kapat',
    'script.iyi_geceler',
    'switch.oyun_bilgisayari',
    'switch.oyun_bilgisayari_akilli',
  ]) {
    const s = sinif(kimlik);
    assert.equal(s.sinif, SINIF.YIKICI, kimlik);
    assert.equal(s.zorunlu, true, kimlik);
  }
});

test('açık listeler birbirinden ayrık ve her kimlik gerçek adıyla GÜVENLİK KURALI süzgecinden geçer', () => {
  for (const kimlik of YIKICI_KIMLIKLER) assert.ok(!ZARARSIZ_KIMLIKLER.has(kimlik), kimlik);
  for (const kimlik of [...YIKICI_KIMLIKLER, ...ZARARSIZ_KIMLIKLER]) {
    assert.ok(guvenliVarlikMi(gercek(kimlik)), kimlik);
    assert.doesNotMatch(kimlik, /kapi|door|kilit|alarm|garaj|bariyer|gate|lock/);
  }
});

test('onay:false zorunlu eylemi zararsız yapamaz', () => {
  for (const kimlik of ['button.pc_bilgisayari_kapat', 'script.iyi_geceler', 'button.pc_powershell']) {
    const s = sinif(kimlik, { onay: false });
    assert.equal(s.sinif, SINIF.YIKICI, kimlik);
    assert.equal(s.zorunlu, true);
  }
});

test('yeni eklenen düğme ve script varsayılan onaylıdır; onay:false açıkça kapatabilir', () => {
  const dugme = sentetik('button.yeni_dugme', 'Yeni düğme');
  assert.deepEqual(eylemSinifi(dugme, {}), { sinif: SINIF.YIKICI, zorunlu: false, neden: 'varsayilan' });
  assert.equal(eylemSinifi(dugme, { onay: false }).sinif, SINIF.ZARARSIZ);
  const betik = sentetik('script.yeni', 'Yeni');
  assert.equal(eylemSinifi(betik).sinif, SINIF.YIKICI);
  assert.equal(eylemSinifi(betik, { onay: false }).sinif, SINIF.ZARARSIZ);
  assert.equal(eylemSinifi(sentetik('input_button.yeni', 'Yeni')).sinif, SINIF.YIKICI);
});

test('ışık, priz ve sahne varsayılan zararsızdır; onay:true açıkça onay ister', () => {
  const isik = sentetik('light.salon', 'Salon');
  assert.equal(eylemSinifi(isik).sinif, SINIF.ZARARSIZ);
  assert.deepEqual(eylemSinifi(isik, { onay: true }), { sinif: SINIF.YIKICI, zorunlu: false, neden: 'favori-ayari' });
  // Açık zararsız listedeki eylem de, kullanıcı isterse onay ister.
  assert.equal(sinif('button.pc_ekran_kapat', { onay: true }).sinif, SINIF.YIKICI);
  assert.equal(sinif('button.pc_ekran_kapat', { onay: true }).zorunlu, false);
});

test('ipucu belirteçleri: kapat, restart, reboot, shutdown, uyut, sıfırla, yeniden başlat yıkıcı ve zorunlu', () => {
  for (const [kimlik, ad] of [
    ['script.isigi_kapat', 'Işığı kapat'],
    ['button.x', 'Server restart'],
    ['button.x', 'Reboot'],
    ['script.x', 'Shutdown'],
    ['script.x', 'Hibernate'],
    ['button.x', 'Uyutma'],
    ['button.x', 'Router sıfırla'],
    ['button.x', 'Factory reset'],
    ['script.x', 'Yeniden Başlat'],
    ['button.x', 'Power off'],
    ['button.x', 'Shut down'],
    ['switch.x', 'Kapatıcı'],
    ['button.x', 'PowerShell çalıştır'],
  ]) {
    const s = eylemSinifi(sentetik(kimlik, ad), { onay: false });
    assert.equal(s.sinif, SINIF.YIKICI, `${kimlik} ${ad}`);
    assert.equal(s.zorunlu, true, `${kimlik} ${ad}`);
    assert.equal(s.neden, 'ipucu');
  }
});

test('ipucu belirteçleri belirteç BAŞI eşleşir ve ışık/sahne alanlarında aranmaz', () => {
  // "preset" içinde "reset" harfleri var ama belirteç başı değil.
  assert.equal(eylemSinifi(sentetik('switch.preset', 'Preset')).sinif, SINIF.ZARARSIZ);
  assert.equal(eylemSinifi(sentetik('button.preset_1', 'Preset 1'), { onay: false }).sinif, SINIF.ZARARSIZ);
  // Işık ve sahne adı "kapat" içerse bile ipucu uygulanmaz (muaf alanlar).
  assert.equal(eylemSinifi(sentetik('light.x', 'Salonu kapat lambası')).sinif, SINIF.ZARARSIZ);
  assert.equal(eylemSinifi(sentetik('scene.x', 'Hepsini kapat')).sinif, SINIF.ZARARSIZ);
  assert.equal(eylemSinifi(sentetik('fan.x', 'Vantilatör kapat')).sinif, SINIF.ZARARSIZ);
});

test('örnek envanter: kapı, kilit ve alarm varlıkları YASAK', () => {
  for (const kimlik of [
    'button.garaj_kapisi_ac',
    'button.garaj_kapisi_led_testi',
    'button.garaj_kapisi_yeniden_baslat',
    'light.garaj_kapisi_durum_led',
    'script.kapi_ac_onayli',
    'button.pc_bilgisayari_kilitle',
    'script.pc_kilitle_ekran_kapat',
    'input_boolean.gun_dogumu_alarmi',
  ]) {
    assert.equal(sinif(kimlik).sinif, SINIF.YASAK, kimlik);
    assert.equal(sinif(kimlik, { onay: false }).sinif, SINIF.YASAK, kimlik);
    assert.equal(sinif(kimlik, { onay: true }).sinif, SINIF.YASAK, kimlik);
    for (const kaynak of KAYNAKLAR) assert.equal(kaynakIzni(SINIF.YASAK, kaynak).izin, false, `${kimlik} ${kaynak}`);
  }
  assert.equal(eylemSinifi(sentetik('lock.on', 'Ön')).sinif, SINIF.YASAK);
  assert.equal(eylemSinifi(null).sinif, SINIF.YASAK);
});

test('kaynakIzni: zararsız her yerde onaysız; yıkıcı tepsi menüsünde diyalog, panel/palette basılı tutma', () => {
  for (const kaynak of KAYNAKLAR) assert.deepEqual(kaynakIzni(SINIF.ZARARSIZ, kaynak), { izin: true, onayTuru: null });
  assert.deepEqual(kaynakIzni(SINIF.YIKICI, 'tepsi-menu'), { izin: true, onayTuru: 'diyalog' });
  assert.deepEqual(kaynakIzni(SINIF.YIKICI, 'panel'), { izin: true, onayTuru: 'basili' });
  assert.deepEqual(kaynakIzni(SINIF.YIKICI, 'palet'), { izin: true, onayTuru: 'basili' });
});

test('kaynakIzni: yıkıcı eylem kısayola ve komut satırına asla izin vermez; bilinmeyen kaynak/sınıf reddedilir', () => {
  assert.equal(kaynakIzni(SINIF.YIKICI, 'kisayol').izin, false);
  assert.equal(kaynakIzni(SINIF.YIKICI, 'komut-satiri').izin, false);
  assert.equal(kaynakIzni(SINIF.ZARARSIZ, 'bilinmeyen').izin, false);
  assert.equal(kaynakIzni('baska', 'panel').izin, false);
  assert.equal(kaynakIzni(undefined, 'panel').izin, false);
});

test('onayAciklamasi: bilinen kimlikler için açıklama, bilinmeyen için genel metin', () => {
  assert.match(onayAciklamasi('button.pc_bilgisayari_kapat'), /kapatır/);
  assert.match(onayAciklamasi('script.iyi_geceler'), /2 dakika/);
  assert.match(onayAciklamasi('button.yeni'), /etkileyebilir/);
});
