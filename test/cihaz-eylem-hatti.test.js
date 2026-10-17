'use strict';

/**
 * 1.4.0 cihaz grubu (o-49 otomasyon, o-50 perde, o-59 vana): tek güvenli eylem hattı (eylem-hatti.js) uçtan uca.
 * Perde: zararsız, her yüzeyden (konum 0-100). Vana ve otomasyon: ZORUNLU onay (panel/palet basılı tutma, tepsi diyaloğu);
 * kısayol ve komut satırından çalışmaz; "onay: false" favori ayarı etkisizdir. Tek POST, doğru servis yolu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemHattiOlustur, hizSiniriOlustur } = require('../src/lib/eylem-hatti');
const { KAYNAKLAR, DIS_KAYNAKLAR } = require('../src/lib/eylem-sinifi');

const perde = (state = 'open', ek = {}) => ({ entity_id: 'cover.salon', state, attributes: { friendly_name: 'Salon perde', device_class: 'curtain', current_position: 70, ...ek } });
const DURUMLAR = {
  'cover.salon': perde(),
  'cover.garaj': { entity_id: 'cover.garaj', state: 'closed', attributes: { friendly_name: 'Depo', device_class: 'garage' } },
  'cover.sinifsiz': { entity_id: 'cover.sinifsiz', state: 'closed', attributes: { friendly_name: 'Bir şey' } },
  'cover.kapi_perde': { entity_id: 'cover.kapi_perde', state: 'open', attributes: { friendly_name: 'Ön kapı perdesi', device_class: 'curtain' } },
  'valve.su': { entity_id: 'valve.su', state: 'open', attributes: { friendly_name: 'Bahçe suyu' } },
  'automation.gece': { entity_id: 'automation.gece', state: 'on', attributes: { friendly_name: 'Gece modu' } },
  'automation.kapali': { entity_id: 'automation.kapali', state: 'unavailable', attributes: { friendly_name: 'Kapalı otomasyon' } },
  'camera.salon': { entity_id: 'camera.salon', state: 'idle', attributes: { friendly_name: 'Salon kamera' } },
};
const FAVORILER = [
  { entity_id: 'cover.salon', ad: 'Salon perde' },
  { entity_id: 'cover.garaj', ad: 'Depo' },
  { entity_id: 'cover.sinifsiz', ad: 'Bir şey' },
  { entity_id: 'cover.kapi_perde', ad: 'Perde' },
  { entity_id: 'valve.su', ad: 'Bahçe suyu' },
  { entity_id: 'automation.gece', ad: 'Gece modu', onay: false },
  { entity_id: 'automation.kapali', ad: 'Kapalı otomasyon' },
  { entity_id: 'camera.salon', ad: 'Salon kamera' },
];

function ortam({ durumlar = DURUMLAR, basili = () => false } = {}) {
  const cagrilar = [];
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async (k) => durumlar[k],
    haIstek: async (yol, secenek) => {
      cagrilar.push({ yol, ...secenek });
      return [];
    },
    basiliOnayi: basili,
    hizSiniri: hizSiniriOlustur({ simdi: () => 1000 }),
  });
  return { hat, cagrilar };
}

test('perde: aç, kapat, durdur servisleri uygulama içi her yüzeyden tek POST ile gider (zararsız); dış tetiklerden (Jump List, API, bağlantı, PC olayı...) çalışmaz', async () => {
  for (const [servis, yol] of [['open_cover', '/api/services/cover/open_cover'], ['close_cover', '/api/services/cover/close_cover'], ['stop_cover', '/api/services/cover/stop_cover']]) {
    for (const kaynak of KAYNAKLAR.filter((k) => !DIS_KAYNAKLAR.includes(k))) {
      const { hat, cagrilar } = ortam();
      const s = await hat({ kimlik: 'cover.salon', kaynak, eylem: { servis } });
      assert.equal(s.ok, true, `${servis} ${kaynak}`);
      assert.equal(s.sinif, 'zararsiz');
      assert.equal(s.servis, servis);
      assert.equal(cagrilar.length, 1);
      assert.deepEqual(cagrilar[0], { yol, yontem: 'POST', govde: { entity_id: 'cover.salon' } });
    }
    for (const kaynak of DIS_KAYNAKLAR) {
      const { hat, cagrilar } = ortam();
      const s = await hat({ kimlik: 'cover.salon', kaynak, eylem: { servis } });
      assert.equal(s.ok, false, `${servis} ${kaynak} dış tetikten çalışmaz`);
      assert.equal(cagrilar.length, 0, `${servis} ${kaynak}: POST yok`);
    }
  }
});

test('perde: konum 0-100 tamsayı; gövdede yalnız entity_id ve position', async () => {
  const { hat, cagrilar } = ortam();
  for (const konum of [0, 35, 100]) {
    const s = await hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis: 'set_cover_position', veri: { position: konum } }, sonDeger: true });
    assert.equal(s.ok, true, String(konum));
  }
  assert.deepEqual(cagrilar.map((c) => c.govde), [
    { entity_id: 'cover.salon', position: 0 },
    { entity_id: 'cover.salon', position: 35 },
    { entity_id: 'cover.salon', position: 100 },
  ]);
  assert.ok(cagrilar.every((c) => c.yol === '/api/services/cover/set_cover_position'));
  const sinir = ortam();
  for (const [konum, neden] of [[101, 'sinir'], [-1, 'sinir'], [40.5, 'parametre'], ['40', 'parametre'], [null, 'parametre'], [NaN, 'parametre']]) {
    const r = await sinir.hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis: 'set_cover_position', veri: { position: konum } } });
    assert.deepEqual([r.ok, r.tur, r.neden], [false, 'gecersiz', neden], String(konum));
  }
  const ek = await sinir.hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis: 'set_cover_position', veri: { position: 40, tilt_position: 10 } } });
  assert.equal(ek.ok, false, 'eğim konumu gibi fazladan anahtar reddedilir');
  assert.equal(sinir.cagrilar.length, 0, 'reddedilenlerde POST yok');
});

test('perde: servis belirtilmezse hiçbir şey gönderilmez (düz tıklama servisi yok)', async () => {
  const { hat, cagrilar } = ortam();
  const r = await hat({ kimlik: 'cover.salon', kaynak: 'panel' });
  assert.deepEqual([r.ok, r.tur, r.neden], [false, 'gecersiz', 'servis']);
  assert.equal(cagrilar.length, 0);
});

test('perde: izin listesinde olmayan servisler (toggle, tilt, kapı gibi) reddedilir', async () => {
  const { hat, cagrilar } = ortam();
  for (const servis of ['toggle', 'open_cover_tilt', 'set_cover_tilt_position', 'turn_on', 'lock', 'open']) {
    const r = await hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis } });
    assert.deepEqual([r.ok, r.tur], [false, 'gecersiz'], servis);
  }
  assert.equal(cagrilar.length, 0);
});

test('perde: garaj sınıfı, sınıfsız ve kapı adlı cover favoride olsa bile HA\'daki güncel duruma göre YASAK (ağ isteği yok)', async () => {
  const { hat, cagrilar } = ortam();
  for (const kimlik of ['cover.garaj', 'cover.sinifsiz', 'cover.kapi_perde']) {
    const r = await hat({ kimlik, kaynak: 'panel', eylem: { servis: 'open_cover' } });
    assert.deepEqual([r.ok, r.tur], [false, 'yasak'], kimlik);
  }
  assert.equal(cagrilar.length, 0);
});

test('perde: HA\'da sınıfı sonradan değişirse (curtain -> garage) eylem durur', async () => {
  const durumlar = { ...DURUMLAR, 'cover.salon': { ...perde(), attributes: { friendly_name: 'Salon perde', device_class: 'garage' } } };
  const { hat, cagrilar } = ortam({ durumlar });
  const r = await hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis: 'open_cover' } });
  assert.deepEqual([r.ok, r.tur], [false, 'yasak']);
  assert.equal(cagrilar.length, 0);
});

test('vana: basılı tutma onayı olmadan hiçbir yüzeyde çalışmaz; panel/palet yalnız ana sürecin doğruladığı basılı tutmayla', async () => {
  for (const servis of ['open_valve', 'close_valve']) {
    for (const kaynak of ['panel', 'palet']) {
      const o = ortam();
      assert.equal((await o.hat({ kimlik: 'valve.su', kaynak, eylem: { servis } })).tur, 'onay-gerekli', `${servis} ${kaynak}`);
      assert.equal((await o.hat({ kimlik: 'valve.su', kaynak, onay: 'basili', eylem: { servis } })).tur, 'onay-gerekli', 'istemci "basili" dese de ana süreç doğrulamadıysa çalışmaz');
      assert.equal(o.cagrilar.length, 0);
      const onayli = ortam({ basili: (k) => k === 'valve.su' });
      const s = await onayli.hat({ kimlik: 'valve.su', kaynak, onay: 'basili', eylem: { servis } });
      assert.equal(s.ok, true, `${servis} ${kaynak}`);
      assert.equal(s.sinif, 'yikici');
      assert.deepEqual(onayli.cagrilar, [{ yol: `/api/services/valve/${servis}`, yontem: 'POST', govde: { entity_id: 'valve.su' } }]);
    }
  }
});

test('vana: kısayol, komut satırı ve masaüstü karosu yasak; tepsi menüsü yalnız diyalog onayıyla', async () => {
  const { hat, cagrilar } = ortam({ basili: () => true });
  for (const kaynak of ['kisayol', 'komut-satiri', 'masaustu']) {
    for (const onay of [undefined, 'basili', 'diyalog']) {
      const r = await hat({ kimlik: 'valve.su', kaynak, onay, eylem: { servis: 'close_valve' } });
      assert.equal(r.tur, 'kaynak-izinsiz', `${kaynak} ${onay}`);
    }
  }
  assert.equal((await hat({ kimlik: 'valve.su', kaynak: 'tepsi-menu', eylem: { servis: 'close_valve' } })).tur, 'onay-gerekli');
  assert.equal((await hat({ kimlik: 'valve.su', kaynak: 'tepsi-menu', onay: 'basili', eylem: { servis: 'close_valve' } })).tur, 'onay-gerekli', 'tepsi basılı tutma kabul etmez');
  assert.equal((await hat({ kimlik: 'valve.su', kaynak: 'tepsi-menu', onay: 'diyalog', eylem: { servis: 'close_valve' } })).ok, true);
  assert.equal(cagrilar.length, 1);
});

test('vana: konum/toggle gibi servisler yok; yalnız open_valve ve close_valve', async () => {
  const { hat, cagrilar } = ortam({ basili: () => true });
  for (const servis of ['set_valve_position', 'toggle', 'stop_valve', 'turn_on', 'open_cover']) {
    const r = await hat({ kimlik: 'valve.su', kaynak: 'panel', onay: 'basili', eylem: { servis } });
    assert.equal(r.ok, false, servis);
  }
  const sade = await hat({ kimlik: 'valve.su', kaynak: 'panel', onay: 'basili' });
  assert.equal(sade.ok, false, 'servis verilmeden vana tek tıkla çalışmaz');
  assert.equal(cagrilar.length, 0);
});

test('otomasyon: tetikle, etkinleştir, devre dışı bırak zorunlu onaylıdır; favoride onay:false etkisizdir', async () => {
  for (const servis of ['trigger', 'turn_on', 'turn_off']) {
    const o = ortam();
    const r = await o.hat({ kimlik: 'automation.gece', kaynak: 'panel', eylem: { servis } });
    assert.equal(r.tur, 'onay-gerekli', `${servis}: favori onay:false olsa bile`);
    assert.equal(o.cagrilar.length, 0);
    const onayli = ortam({ basili: () => true });
    const s = await onayli.hat({ kimlik: 'automation.gece', kaynak: 'palet', onay: 'basili', eylem: { servis } });
    assert.equal(s.ok, true, servis);
    assert.equal(s.sinif, 'yikici');
    assert.deepEqual(onayli.cagrilar, [{ yol: `/api/services/automation/${servis}`, yontem: 'POST', govde: { entity_id: 'automation.gece' } }]);
  }
});

test('otomasyon: düz tıklama "trigger" olur (tek tıklama eylemi); onaysız çalışmaz; kısayol/komut satırı reddedilir', async () => {
  const o = ortam({ basili: () => true });
  assert.equal((await o.hat({ kimlik: 'automation.gece', kaynak: 'panel' })).tur, 'onay-gerekli');
  const s = await o.hat({ kimlik: 'automation.gece', kaynak: 'panel', onay: 'basili' });
  assert.equal(s.ok, true);
  assert.equal(s.servis, 'trigger');
  assert.equal(o.cagrilar[0].yol, '/api/services/automation/trigger');
  for (const kaynak of ['kisayol', 'komut-satiri', 'masaustu']) {
    assert.equal((await o.hat({ kimlik: 'automation.gece', kaynak, onay: 'basili' })).tur, 'kaynak-izinsiz', kaynak);
  }
  assert.equal(o.cagrilar.length, 1);
});

test('otomasyon: servis izin listesi yalnız trigger, turn_on, turn_off (reload, toggle ve parametreler reddedilir)', async () => {
  const { hat, cagrilar } = ortam({ basili: () => true });
  for (const servis of ['reload', 'toggle', 'press', 'delete']) {
    assert.equal((await hat({ kimlik: 'automation.gece', kaynak: 'panel', onay: 'basili', eylem: { servis } })).ok, false, servis);
  }
  const veri = await hat({ kimlik: 'automation.gece', kaynak: 'panel', onay: 'basili', eylem: { servis: 'trigger', veri: { skip_condition: false } } });
  assert.equal(veri.ok, false, 'trigger parametre kabul etmez');
  assert.equal(cagrilar.length, 0);
});

test('otomasyon: unavailable otomasyon çalışmaz', async () => {
  const { hat, cagrilar } = ortam({ basili: () => true });
  const r = await hat({ kimlik: 'automation.kapali', kaynak: 'panel', onay: 'basili', eylem: { servis: 'trigger' } });
  assert.equal(r.tur, 'ulasilamiyor');
  assert.equal(cagrilar.length, 0);
});

test('kamera: eylem hattından hiçbir servis çağrılamaz (camera servis alanı değil)', async () => {
  const { hat, cagrilar } = ortam({ basili: () => true });
  for (const servis of [undefined, 'turn_on', 'turn_off', 'snapshot', 'record', 'enable_motion_detection']) {
    const r = await hat({ kimlik: 'camera.salon', kaynak: 'panel', onay: 'basili', eylem: servis === undefined ? undefined : { servis } });
    assert.equal(r.ok, false, String(servis));
  }
  assert.equal(cagrilar.length, 0);
});

test('hız sınırı: aynı perdeye art arda konum isteği sınırlanır (sonDeger geçer), POST sayısı sınırı aşmaz', async () => {
  const { hat, cagrilar } = ortam();
  let reddedilen = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await hat({ kimlik: 'cover.salon', kaynak: 'panel', eylem: { servis: 'set_cover_position', veri: { position: i * 5 } } });
    if (!r.ok && r.tur === 'cok-sik') reddedilen += 1;
  }
  assert.ok(reddedilen > 0, 'sınırsız art arda POST yok');
  assert.ok(cagrilar.length < 12);
});
