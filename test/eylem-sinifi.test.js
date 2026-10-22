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

// --- 1.6.0 sonrası: sahne/grup üyeleri (yalnız sıkılaştırma) ---------------------------------------------------------------------

const uyeli = (uyeler, kimlik = 'scene.bahce', ad = 'Bahçe') => ({ entity_id: kimlik, state: 'unknown', attributes: { friendly_name: ad, entity_id: uyeler } });
const ZORUNLU_UYELER = [
  'valve.ana_vana',
  'automation.sulama',
  'button.pc_bilgisayari_kapat',
  'switch.oyun_bilgisayari',
  'script.iyi_geceler',
  'switch.modem_yeniden_baslat',
  'switch.router_reset',
  'input_boolean.sunucu_kapat',
  'script.nas_reboot',
];

test('1.6.0 sonrası: zorunlu onaylı üyesi (vana, otomasyon, açık yıkıcı liste, ipucu) olan sahne ya da grup zorunlu onaylıdır; onay:false kapatamaz', () => {
  for (const uye of ZORUNLU_UYELER) {
    for (const favori of [undefined, {}, { onay: false }, { onay: true }]) {
      assert.deepEqual(eylemSinifi(uyeli(['light.salon', uye]), favori), { sinif: SINIF.YIKICI, zorunlu: true, neden: 'uye' }, `${uye} ${JSON.stringify(favori)}`);
    }
    assert.equal(eylemSinifi(uyeli(uye)).zorunlu, true, `tek metin üye: ${uye}`);
    assert.equal(eylemSinifi(uyeli(['switch.priz', uye], 'switch.tum_prizler', 'Tüm prizler'), { onay: false }).zorunlu, true, `anahtar grubu: ${uye}`);
    for (const kaynak of KAYNAKLAR) {
      assert.equal(kaynakIzni(eylemSinifi(uyeli([uye]), { onay: false }).sinif, kaynak).izin, ['tepsi-menu', 'panel', 'palet'].includes(kaynak), `${uye} ${kaynak}`);
    }
  }
});

test('1.6.0 sonrası: zararsız üyeli sahne değişmez; ipucu üyenin KENDİ alanında aranır; sahnenin kendi adı bilerek taranmaz', () => {
  assert.deepEqual(eylemSinifi(uyeli(['light.salon', 'switch.priz', 'media_player.tv', 'climate.salon'])), { sinif: SINIF.ZARARSIZ, zorunlu: false, neden: 'alan-varsayilani' });
  assert.deepEqual(eylemSinifi(uyeli(['light.salon']), { onay: true }), { sinif: SINIF.YIKICI, zorunlu: false, neden: 'favori-ayari' });
  // ışık/vantilatör üyesi adında "kapat" geçse de kendi başına yıkıcı değildir; açık zararsız listedeki üye ipucuya takılmaz
  assert.equal(eylemSinifi(uyeli(['light.salon_kapat', 'fan.reset_fan', 'button.pc_ekran_kapat'])).sinif, SINIF.ZARARSIZ);
  // "Işıkları kapat" gibi masum sahneler kısayolda kalsın: sahnenin ne yaptığını üyeleri söyler
  assert.equal(eylemSinifi(uyeli(['light.salon'], 'scene.bilgisayari_kapat', 'PC Kapat')).sinif, SINIF.ZARARSIZ);
  assert.equal(eylemSinifi(uyeli(['light.salon', 'valve.ana_vana'], 'scene.isiklari_kapat', 'Işıkları kapat')).zorunlu, true);
});

test('1.6.0 sonrası: vanalı sahne panelde, palette ve tepsi menüsünde aynı sınıfı alır; tek güvenli hat kısayol, komut satırı, masaüstü, ertelenen ve dış kaynakları reddeder', async () => {
  const { eylemHattiOlustur, hizSiniriOlustur } = require('../src/lib/eylem-hatti');
  const { karoOlustur } = require('../src/lib/yuzey-modeli');
  const durum = uyeli(['light.bahce', 'valve.ana_vana']);
  const favori = { entity_id: 'scene.bahce', ad: 'Bahçe', onay: false };
  const karo = karoOlustur(favori, durum);
  assert.equal(karo.sinif, 'yikici', 'panel/palet karosu basılı tutma ister');
  assert.ok(karo.onayliServisler.includes('turn_on'));
  const kur = (basili) => {
    const postlar = [];
    const hat = eylemHattiOlustur({
      favoriAl: (k) => (k === favori.entity_id ? favori : undefined),
      guncelDurum: async (k) => (k === durum.entity_id ? durum : null),
      haIstek: async (yol) => {
        postlar.push(yol);
        return [];
      },
      basiliOnayi: () => basili,
      hizSiniri: hizSiniriOlustur({ simdi: () => 1000 }),
    });
    return { hat, postlar };
  };
  for (const kaynak of KAYNAKLAR.filter((k) => !['tepsi-menu', 'panel', 'palet'].includes(k))) {
    const { hat, postlar } = kur(true);
    const s = await hat({ kimlik: 'scene.bahce', kaynak, onay: 'basili' });
    assert.deepEqual([s.ok, s.tur], [false, 'kaynak-izinsiz'], kaynak);
    assert.equal(postlar.length, 0, kaynak);
  }
  for (const kaynak of ['panel', 'palet']) {
    const onaysiz = kur(false);
    assert.equal((await onaysiz.hat({ kimlik: 'scene.bahce', kaynak, onay: 'basili' })).tur, 'onay-gerekli', kaynak);
    assert.equal(onaysiz.postlar.length, 0);
    const basili = kur(true);
    assert.equal((await basili.hat({ kimlik: 'scene.bahce', kaynak, onay: 'basili' })).ok, true, kaynak);
    assert.deepEqual(basili.postlar, ['/api/services/scene/turn_on']);
  }
  const tepsi = kur(false);
  assert.equal((await tepsi.hat({ kimlik: 'scene.bahce', kaynak: 'tepsi-menu' })).tur, 'onay-gerekli');
  assert.equal((await tepsi.hat({ kimlik: 'scene.bahce', kaynak: 'tepsi-menu', onay: 'diyalog' })).ok, true);
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
  assert.equal(kaynakIzni(SINIF.YIKICI, 'masaustu').izin, false, '1.4.0 (o-33): masaüstü karosu onay/basılı tutma sunmaz: yıkıcı eylem çalışmaz');
  assert.deepEqual(kaynakIzni(SINIF.YIKICI, 'masaustu'), { izin: false, onayTuru: null });
  assert.deepEqual(kaynakIzni(SINIF.ZARARSIZ, 'masaustu'), { izin: true, onayTuru: null });
  assert.equal(kaynakIzni(SINIF.YASAK, 'masaustu').izin, false);
  assert.equal(KAYNAKLAR.includes('masaustu'), true);
  assert.equal(kaynakIzni(SINIF.ZARARSIZ, 'bilinmeyen').izin, false);
  assert.equal(kaynakIzni('baska', 'panel').izin, false);
  assert.equal(kaynakIzni(undefined, 'panel').izin, false);
});

test('onayAciklamasi: bilinen kimlikler için açıklama, bilinmeyen için genel metin', () => {
  assert.match(onayAciklamasi('button.pc_bilgisayari_kapat'), /kapatır/);
  assert.match(onayAciklamasi('script.iyi_geceler'), /2 dakika/);
  assert.match(onayAciklamasi('button.yeni'), /etkileyebilir/);
});
