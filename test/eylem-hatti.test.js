'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemHattiOlustur, basiliTutmaDeposu, hizSiniriOlustur, IZINLI_SERVISLER, ORAN_SINIRI, ORAN_SINIRI_DUGME, ORAN_SINIRI_SON } = require('../src/lib/eylem-hatti');
const { KAYNAKLAR } = require('../src/lib/eylem-sinifi');

const DURUMLAR = {
  'light.led': { entity_id: 'light.led', state: 'on', attributes: { friendly_name: 'LED şerit', brightness: 127 } },
  'light.ampul': { entity_id: 'light.ampul', state: 'off', attributes: { friendly_name: 'Ampul' } },
  'scene.film': { entity_id: 'scene.film', state: 'unknown', attributes: { friendly_name: 'Film' } },
  'button.pc_ses_cikis_hoparlor': { entity_id: 'button.pc_ses_cikis_hoparlor', state: 'unknown', attributes: { friendly_name: 'Hoparlör' } },
  'button.pc_mediavolumeup': { entity_id: 'button.pc_mediavolumeup', state: 'unknown', attributes: { friendly_name: 'Ses +' } },
  'button.pc_bilgisayari_kapat': { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'script.iyi_geceler': { entity_id: 'script.iyi_geceler', state: 'off', attributes: { friendly_name: 'İyi geceler' } },
  'switch.kapali_priz': { entity_id: 'switch.kapali_priz', state: 'unavailable', attributes: { friendly_name: 'Priz' } },
  'light.yeni_ad': { entity_id: 'light.yeni_ad', state: 'on', attributes: { friendly_name: 'Garaj kapısı lambası' } },
  'lock.on_kapi': { entity_id: 'lock.on_kapi', state: 'locked', attributes: { friendly_name: 'Ön kapı' } },
};
const FAVORILER = [
  { entity_id: 'light.led', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
  { entity_id: 'scene.film', ad: 'Film' },
  { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'Hoparlör' },
  { entity_id: 'button.pc_mediavolumeup', ad: 'Ses +' },
  { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat' },
  { entity_id: 'script.iyi_geceler', ad: 'İyi geceler' },
  { entity_id: 'switch.kapali_priz', ad: 'Priz' },
  { entity_id: 'light.yeni_ad', ad: 'Lamba' },
  { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
  { entity_id: 'switch.kapi_isigi', ad: 'Kapı ışığı' },
];

function ortam({ simdi = () => 1000, basili = () => false } = {}) {
  const cagrilar = [];
  const durumSorgulari = [];
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async (k) => {
      durumSorgulari.push(k);
      return DURUMLAR[k];
    },
    haIstek: async (yol, secenek) => {
      cagrilar.push({ yol, ...secenek });
      return [];
    },
    basiliOnayi: basili,
    hizSiniri: hizSiniriOlustur({ simdi }),
  });
  return { hat, cagrilar, durumSorgulari };
}

test('zararsız eylem: panel/palet/kısayol/komut satırı/tepsi aynı hattan tek POST ile geçer', async () => {
  for (const kaynak of KAYNAKLAR) {
    const { hat, cagrilar } = ortam();
    const s = await hat({ kimlik: 'light.ampul', kaynak });
    assert.equal(s.ok, true, kaynak);
    assert.equal(s.sinif, 'zararsiz');
    assert.equal(cagrilar.length, 1);
    assert.deepEqual(cagrilar[0], { yol: '/api/services/light/toggle', yontem: 'POST', govde: { entity_id: 'light.ampul' } });
  }
});

test('servis eşlemesi: sahne turn_on, düğme press; onaysız yıkıcı olmayan düğme çalışır', async () => {
  const { hat, cagrilar } = ortam();
  assert.equal((await hat({ kimlik: 'scene.film', kaynak: 'palet' })).ok, true);
  assert.equal((await hat({ kimlik: 'button.pc_ses_cikis_hoparlor', kaynak: 'panel' })).ok, true);
  assert.deepEqual(cagrilar.map((c) => c.yol), ['/api/services/scene/turn_on', '/api/services/button/press']);
});

test('parlaklık: yalnız parlaklık kontrollü ışıkta, 1-100 tam sayı; light.turn_on + brightness_pct', async () => {
  const { hat, cagrilar } = ortam();
  const s = await hat({ kimlik: 'light.led', kaynak: 'palet', eylem: { parlaklik: 40 } });
  assert.equal(s.ok, true);
  assert.equal(s.parlaklik, 40);
  assert.deepEqual(cagrilar[0], { yol: '/api/services/light/turn_on', yontem: 'POST', govde: { entity_id: 'light.led', brightness_pct: 40 } });
  for (const kotu of [0, 101, 40.5, '40', -3, null, NaN]) {
    const r = await hat({ kimlik: 'light.led', kaynak: 'panel', eylem: { parlaklik: kotu } });
    assert.deepEqual([r.ok, r.tur], [false, 'gecersiz'], String(kotu));
  }
  const kontrolsuz = await hat({ kimlik: 'light.ampul', kaynak: 'panel', eylem: { parlaklik: 40 } });
  assert.deepEqual([kontrolsuz.ok, kontrolsuz.tur], [false, 'gecersiz'], 'parlaklik:true olmayan ışığa parlaklık verilmez');
  const sahneye = await hat({ kimlik: 'scene.film', kaynak: 'panel', eylem: { parlaklik: 40 } });
  assert.equal(sahneye.tur, 'gecersiz');
  assert.equal(cagrilar.length, 1, 'reddedilenlerde POST yok');
});

test('servis izin listesi: bilinmeyen servis ve alan dışı servis reddedilir', async () => {
  const { hat, cagrilar } = ortam();
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel', eylem: { servis: 'turn_off' } })).ok, true);
  for (const servis of ['delete', 'turn_on_all', 'press', '', 5, 'light.toggle', '../x']) {
    const r = await hat({ kimlik: 'light.ampul', kaynak: 'panel', eylem: { servis } });
    assert.equal(r.ok, false, String(servis));
    assert.equal(r.tur, 'gecersiz');
  }
  assert.equal((await hat({ kimlik: 'scene.film', kaynak: 'panel', eylem: { servis: 'toggle' } })).tur, 'gecersiz');
  assert.equal(cagrilar.length, 1);
  assert.deepEqual(Object.keys(IZINLI_SERVISLER).sort(), ['button', 'fan', 'input_boolean', 'input_button', 'light', 'scene', 'script', 'switch']);
  assert.ok(!Object.values(IZINLI_SERVISLER).flat().some((s) => /lock|unlock|open|close|arm|disarm/.test(s)));
});

test('bilinmeyen favori / biçim hataları HA\'ya hiç gitmez', async () => {
  const { hat, cagrilar, durumSorgulari } = ortam();
  assert.equal((await hat({ kimlik: 'light.baska', kaynak: 'panel' })).tur, 'bilinmeyen-favori');
  assert.equal((await hat({ kimlik: 'KÖTÜ', kaynak: 'panel' })).tur, 'gecersiz');
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'tarayici' })).tur, 'gecersiz');
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel', onay: 'evet' })).tur, 'gecersiz');
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel', eylem: [] })).tur, 'gecersiz');
  assert.equal((await hat(null)).tur, 'gecersiz');
  assert.equal((await hat({})).tur, 'gecersiz');
  assert.deepEqual([cagrilar.length, durumSorgulari.length], [0, 0]);
});

test('KAPI/KİLİT KURALI: kapı adlı, kilit alanlı ya da HA\'da sonradan "kapı" olan varlık hiçbir yüzeyden çalışmaz', async () => {
  for (const kaynak of KAYNAKLAR) {
    for (const kimlik of ['lock.on_kapi', 'switch.kapi_isigi', 'light.yeni_ad']) {
      const { hat, cagrilar } = ortam();
      const s = await hat({ kimlik, kaynak, onay: 'diyalog' });
      assert.deepEqual([s.ok, s.tur], [false, 'yasak'], `${kaynak} ${kimlik}`);
      assert.equal(cagrilar.length, 0);
    }
  }
  // kayıtlı ad masum ama HA'daki güncel ad "kapı": ağdan gelen güncel ad kazanır, sorgu yapılır, POST yapılmaz
  const { hat, durumSorgulari } = ortam();
  await hat({ kimlik: 'light.yeni_ad', kaynak: 'panel' });
  assert.deepEqual(durumSorgulari, ['light.yeni_ad']);
});

test('ulaşılamayan cihaz ve HA\'da bulunamayan cihaz: POST yok', async () => {
  const { hat, cagrilar } = ortam();
  assert.equal((await hat({ kimlik: 'switch.kapali_priz', kaynak: 'panel' })).tur, 'ulasilamiyor');
  const bos = eylemHattiOlustur({ favoriAl: () => ({ entity_id: 'light.yok', ad: 'Yok' }), guncelDurum: async () => null, haIstek: async () => cagrilar.push('x') });
  assert.equal((await bos({ kimlik: 'light.yok', kaynak: 'panel' })).tur, 'bulunamadi');
  assert.equal(cagrilar.length, 0);
});

test('başka kimlikli durum dönerse (yanlış eşleşme) reddedilir', async () => {
  const cagrilar = [];
  const hat = eylemHattiOlustur({
    favoriAl: () => ({ entity_id: 'light.ampul', ad: 'Ampul' }),
    guncelDurum: async () => ({ entity_id: 'light.baska', state: 'on', attributes: {} }),
    haIstek: async () => cagrilar.push(1),
  });
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel' })).tur, 'yasak');
  assert.equal(cagrilar.length, 0);
});

test('yıkıcı eylem: kısayol ve komut satırından asla; panel/palet yalnız doğrulanmış basılı tutmayla; tepsi yalnız onay penceresiyle', async () => {
  for (const kaynak of ['kisayol', 'komut-satiri']) {
    for (const onay of [undefined, 'basili', 'diyalog']) {
      const { hat, cagrilar } = ortam({ basili: () => true });
      const s = await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak, onay });
      assert.deepEqual([s.ok, s.tur], [false, 'kaynak-izinsiz'], `${kaynak}/${onay}`);
      assert.equal(cagrilar.length, 0);
    }
  }
  for (const kaynak of ['panel', 'palet']) {
    // renderer 'basili' derse bile ana sürecin kaydı yoksa çalışmaz
    let { hat, cagrilar } = ortam({ basili: () => false });
    assert.equal((await hat({ kimlik: 'script.iyi_geceler', kaynak, onay: 'basili' })).tur, 'onay-gerekli');
    assert.equal((await hat({ kimlik: 'script.iyi_geceler', kaynak })).tur, 'onay-gerekli');
    assert.equal((await hat({ kimlik: 'script.iyi_geceler', kaynak, onay: 'diyalog' })).tur, 'onay-gerekli', 'panelde diyalog onayı geçmez');
    assert.equal(cagrilar.length, 0);
    ({ hat, cagrilar } = ortam({ basili: () => true }));
    const s = await hat({ kimlik: 'script.iyi_geceler', kaynak, onay: 'basili' });
    assert.deepEqual([s.ok, s.sinif], [true, 'yikici']);
    assert.equal(cagrilar.length, 1);
  }
  let { hat, cagrilar } = ortam();
  assert.equal((await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'tepsi-menu' })).tur, 'onay-gerekli');
  assert.equal((await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'tepsi-menu', onay: 'basili' })).tur, 'onay-gerekli');
  assert.equal(cagrilar.length, 0);
  assert.equal((await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'tepsi-menu', onay: 'diyalog' })).ok, true);
  assert.equal(cagrilar.length, 1);
});

test('yıkıcı eylemde "onay-gerekli" sonucu adı taşır (diyalog için), POST yok', async () => {
  const { hat, cagrilar } = ortam();
  const s = await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'tepsi-menu' });
  assert.equal(s.ad, 'Bilgisayarı kapat');
  assert.equal(cagrilar.length, 0);
});

test('hız sınırı: varlık başına saniyede 8 (düğmede 6); pencere kayınca yeniden açılır; sonDeger sınırı aşar; varlıklar bağımsız', async () => {
  let t = 1000;
  const { hat, cagrilar } = ortam({ simdi: () => t });
  const sonuclar = [];
  for (let i = 0; i < 10; i += 1) sonuclar.push((await hat({ kimlik: 'light.ampul', kaynak: 'panel' })).ok);
  assert.equal(sonuclar.filter(Boolean).length, ORAN_SINIRI);
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel' })).tur, 'cok-sik');
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel', sonDeger: true })).ok, true, 'son değer sınırı aşar');
  assert.equal((await hat({ kimlik: 'scene.film', kaynak: 'panel' })).ok, true, 'başka varlık etkilenmez');
  t += 1001;
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel' })).ok, true, 'pencere kaydı');
  const dugme = [];
  for (let i = 0; i < 9; i += 1) dugme.push((await hat({ kimlik: 'button.pc_mediavolumeup', kaynak: 'panel' })).ok);
  assert.equal(dugme.filter(Boolean).length, ORAN_SINIRI_DUGME);
  assert.ok(cagrilar.length > 0);
});

test('hız sınırı: sonDeger normal sınırı aşar ama KENDİ sınırı vardır (renderer beyanı sınırsız çağrı hakkı vermez); pencere kayınca yeniden açılır', async () => {
  let t = 1000;
  const { hat, cagrilar } = ortam({ simdi: () => t });
  const sonuclar = [];
  for (let i = 0; i < ORAN_SINIRI_SON + 5; i += 1) sonuclar.push(await hat({ kimlik: 'light.ampul', kaynak: 'panel', sonDeger: true }));
  assert.equal(sonuclar.filter((s) => s.ok).length, ORAN_SINIRI_SON, 'sonDeger çağrıları saniyede en çok ORAN_SINIRI_SON');
  assert.ok(sonuclar.slice(ORAN_SINIRI_SON).every((s) => s.tur === 'cok-sik'));
  assert.equal(cagrilar.length, ORAN_SINIRI_SON, 'reddedilenler için POST yok');
  assert.equal((await hat({ kimlik: 'scene.film', kaynak: 'panel', sonDeger: true })).ok, true, 'başka varlık etkilenmez');
  t += 1001;
  assert.equal((await hat({ kimlik: 'light.ampul', kaynak: 'panel', sonDeger: true })).ok, true, 'pencere kaydı');
});

test('reddedilen çağrılar hız sınırına sayılmaz (yalnız gerçekten giden POST sayılır)', async () => {
  const { hat } = ortam();
  for (let i = 0; i < 20; i += 1) await hat({ kimlik: 'script.iyi_geceler', kaynak: 'kisayol' });
  const { hat: hat2 } = ortam();
  for (let i = 0; i < 20; i += 1) assert.equal((await hat2({ kimlik: 'light.ampul', kaynak: 'panel', eylem: { parlaklik: 10 } })).tur, 'gecersiz');
  assert.equal((await hat2({ kimlik: 'light.ampul', kaynak: 'panel' })).ok, true);
});

test('HA hatası: POST tam bir kez denenir, yeniden denenmez; neden aktarılır', async () => {
  let sayac = 0;
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async (k) => DURUMLAR[k],
    haIstek: async () => {
      sayac += 1;
      const hata = new Error('x');
      hata.tur = 'baglanti';
      throw hata;
    },
  });
  const s = await hat({ kimlik: 'light.ampul', kaynak: 'panel' });
  assert.deepEqual([s.ok, s.tur, s.neden], [false, 'ha-hatasi', 'baglanti']);
  assert.equal(sayac, 1);
});

test('HA hatası: HTTP durum kodu varsa sonuca eklenir (yoksa eklenmez)', async () => {
  const kur = (hata) =>
    eylemHattiOlustur({
      favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
      guncelDurum: async (k) => DURUMLAR[k],
      haIstek: async () => {
        throw hata;
      },
    });
  const kodlu = await kur(Object.assign(new Error('x'), { tur: 'sunucu', durumKodu: 500 }))({ kimlik: 'light.ampul', kaynak: 'panel' });
  assert.deepEqual([kodlu.tur, kodlu.neden, kodlu.durumKodu], ['ha-hatasi', 'sunucu', 500]);
  const kodsuz = await kur(Object.assign(new Error('x'), { tur: 'baglanti' }))({ kimlik: 'light.ampul', kaynak: 'panel' });
  assert.equal('durumKodu' in kodsuz, false);
});

test('güncel durum alınamazsa (ağ) ha-hatasi; POST yok', async () => {
  const cagrilar = [];
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async () => {
      throw Object.assign(new Error('x'), { tur: 'yetki' });
    },
    haIstek: async () => cagrilar.push(1),
  });
  const s = await hat({ kimlik: 'light.ampul', kaynak: 'panel' });
  assert.deepEqual([s.ok, s.tur, s.neden], [false, 'ha-hatasi', 'yetki']);
  assert.equal(cagrilar.length, 0);
});

test('başarıda HA yanıtındaki yeni durum aktarılır', async () => {
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async (k) => DURUMLAR[k],
    haIstek: async () => [{ entity_id: 'light.ampul', state: 'on' }],
  });
  const s = await hat({ kimlik: 'light.ampul', kaynak: 'panel' });
  assert.deepEqual([s.ok, s.onceki, s.yeni, s.alan, s.servis], [true, 'off', 'on', 'light', 'toggle']);
});

test('basiliTutmaDeposu: 0,8 sn dolmadan onay yok; dolunca bir kez; ikinci kez yok; çok eski basış geçersiz; iptal', () => {
  let t = 0;
  const depo = basiliTutmaDeposu({ simdi: () => t });
  assert.equal(depo.tuket('script.iyi_geceler'), false, 'başlamamış');
  depo.basla('script.iyi_geceler');
  t = 300;
  assert.equal(depo.tuket('script.iyi_geceler'), false, 'erken');
  depo.basla('script.iyi_geceler');
  t = 300 + 800;
  assert.equal(depo.tuket('script.iyi_geceler'), true);
  assert.equal(depo.tuket('script.iyi_geceler'), false, 'tek kullanımlık');
  depo.basla('script.iyi_geceler');
  t += 60_000;
  assert.equal(depo.tuket('script.iyi_geceler'), false, 'unutulmuş basış');
  depo.basla('a.b');
  depo.iptal('a.b');
  t += 900;
  assert.equal(depo.tuket('a.b'), false);
  assert.equal(depo.basla(5), false);
});

test('hizSiniriOlustur: temizle sayaçları sıfırlar', () => {
  const h = hizSiniriOlustur({ simdi: () => 5 });
  for (let i = 0; i < ORAN_SINIRI; i += 1) assert.equal(h.dene('x.y'), true);
  assert.equal(h.dene('x.y'), false);
  h.temizle();
  assert.equal(h.dene('x.y'), true);
});

// --- 1.4.0: genel servis eylemi yolu (aynı hat, aynı tek POST) -------------------------------------------------

const YENI_DURUMLAR = {
  'climate.salon': { entity_id: 'climate.salon', state: 'heat', attributes: { friendly_name: 'Salon kliması', min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'heat', 'cool'] } },
  'media_player.tv': { entity_id: 'media_player.tv', state: 'playing', attributes: { source_list: ['HDMI 1', 'Kapı kamerası'] } },
  'input_select.mod': { entity_id: 'input_select.mod', state: 'Ev', attributes: { options: ['Ev', 'Tatil'] } },
  'input_select.kapi_modu': { entity_id: 'input_select.kapi_modu', state: 'Kapalı', attributes: { options: ['Kapalı', 'Açık'] } },
  'select.giris': { entity_id: 'select.giris', state: 'Normal', attributes: { options: ['Normal', 'Kapıyı aç'] } },
  'todo.alisveris': { entity_id: 'todo.alisveris', state: '2', attributes: {} },
  'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21', attributes: {} },
  'vacuum.robot': { entity_id: 'vacuum.robot', state: 'docked', attributes: { friendly_name: 'Garage vacuum' } },
  'timer.firin': { entity_id: 'timer.firin', state: 'idle', attributes: {} },
};
const YENI_FAVORILER = [
  { entity_id: 'climate.salon', ad: 'Klima' },
  { entity_id: 'media_player.tv', ad: 'TV' },
  { entity_id: 'input_select.mod', ad: 'Mod' },
  { entity_id: 'input_select.kapi_modu', ad: 'Mod 2' },
  { entity_id: 'select.giris', ad: 'Giriş' },
  { entity_id: 'todo.alisveris', ad: 'Alışveriş' },
  { entity_id: 'sensor.sicaklik', ad: 'Sıcaklık' },
  { entity_id: 'vacuum.robot', ad: 'Robot' },
  { entity_id: 'timer.firin', ad: 'Fırın', onay: false },
];

function servisOrtami({ basili = () => false, favoriler = YENI_FAVORILER } = {}) {
  const cagrilar = [];
  const hat = eylemHattiOlustur({
    favoriAl: (k) => favoriler.find((f) => f.entity_id === k),
    guncelDurum: async (k) => YENI_DURUMLAR[k],
    haIstek: async (yol, secenek) => {
      cagrilar.push({ yol, ...secenek });
      return [];
    },
    basiliOnayi: basili,
    hizSiniri: hizSiniriOlustur({ simdi: () => 1000 }),
  });
  return { hat, cagrilar };
}

test('servis eylemi: climate.set_temperature sınırlar HA\'daki güncel öznitelikten; tek POST, doğrulanmış gövde', async () => {
  const { hat, cagrilar } = servisOrtami();
  const s = await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem: { servis: 'set_temperature', veri: { temperature: 22.5 } } });
  assert.deepEqual([s.ok, s.servis, s.servisEylemi, s.sinif], [true, 'set_temperature', true, 'zararsiz']);
  assert.deepEqual(cagrilar, [{ yol: '/api/services/climate/set_temperature', yontem: 'POST', govde: { entity_id: 'climate.salon', temperature: 22.5 } }]);
  for (const [veri, neden] of [
    [{ temperature: 31 }, 'sinir'],
    [{ temperature: 22.3 }, 'adim'],
    [{}, 'eksik'],
    [{ temperature: 22, entity_id: 'lock.on_kapi' }, 'parametre'],
  ]) {
    const r = await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem: { servis: 'set_temperature', veri } });
    assert.deepEqual([r.ok, r.tur, r.neden], [false, 'gecersiz', neden], JSON.stringify(veri));
  }
  assert.equal(cagrilar.length, 1, 'reddedilenlerde POST yok');
});

test('servis eylemi: tek tıklama eylemi olmayan alanda servis açıkça verilmeli; izin listesi dışı servis reddedilir', async () => {
  const { hat, cagrilar } = servisOrtami();
  assert.deepEqual([(await hat({ kimlik: 'climate.salon', kaynak: 'panel' })).tur], ['gecersiz']);
  for (const servis of ['unlock', 'open_cover', 'reload', 'set_preset_mode', 'TURN_OFF', 'turn_off/../x', '__proto__']) {
    const r = await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem: { servis } });
    assert.equal(r.ok, false, servis);
    assert.equal(r.tur, 'gecersiz', servis);
  }
  for (const eylem of [{ servis: 'turn_on', veri: [] }, { servis: 'turn_on', veri: null }, { servis: 5 }, { veri: {}, parlaklik: 40 }]) {
    assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem })).tur, 'gecersiz', JSON.stringify(eylem));
  }
  assert.equal(cagrilar.length, 0);
});

test('servis eylemi: hvac mod değişimi varsayılan onay ister (panelde basılı tut, kısayolda asla); onay:false favori kapatır', async () => {
  let { hat, cagrilar } = servisOrtami();
  const eylem = { servis: 'set_hvac_mode', veri: { hvac_mode: 'cool' } };
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem })).tur, 'onay-gerekli');
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'kisayol', eylem })).tur, 'kaynak-izinsiz');
  assert.equal(cagrilar.length, 0);
  ({ hat, cagrilar } = servisOrtami({ basili: () => true }));
  const s = await hat({ kimlik: 'climate.salon', kaynak: 'panel', onay: 'basili', eylem });
  assert.deepEqual([s.ok, s.sinif], [true, 'yikici']);
  assert.deepEqual(cagrilar[0].govde, { entity_id: 'climate.salon', hvac_mode: 'cool' });
  ({ hat, cagrilar } = servisOrtami({ favoriler: [{ entity_id: 'climate.salon', ad: 'Klima', onay: false }] }));
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem })).ok, true);
  // aynı karoda sıcaklık ayarı onaysız
  ({ hat } = servisOrtami());
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'panel', eylem: { servis: 'set_temperature', veri: { temperature: 20 } } })).ok, true);
});

test('servis eylemi: seçici ve zamanlayıcı varsayılan onaylı; favoride onay:false ile kapatılabilir', async () => {
  const { hat, cagrilar } = servisOrtami();
  assert.equal((await hat({ kimlik: 'input_select.mod', kaynak: 'panel', eylem: { servis: 'select_option', veri: { option: 'Tatil' } } })).tur, 'onay-gerekli');
  const s = await hat({ kimlik: 'timer.firin', kaynak: 'panel', eylem: { servis: 'start' } });
  assert.equal(s.ok, true, 'onay:false favori');
  assert.deepEqual(cagrilar.map((c) => c.yol), ['/api/services/timer/start']);
});

test('servis eylemi: todo.remove_item zorunlu onaylı (favoride onay:false olsa da); add_item kapı metnini reddeder', async () => {
  const { hat, cagrilar } = servisOrtami({ favoriler: [{ entity_id: 'todo.alisveris', ad: 'Alışveriş', onay: false }] });
  assert.equal((await hat({ kimlik: 'todo.alisveris', kaynak: 'panel', eylem: { servis: 'remove_item', veri: { item: 'Süt' } } })).tur, 'onay-gerekli');
  assert.equal((await hat({ kimlik: 'todo.alisveris', kaynak: 'tepsi-menu', eylem: { servis: 'remove_item', veri: { item: 'Süt' } } })).tur, 'onay-gerekli');
  const r = await hat({ kimlik: 'todo.alisveris', kaynak: 'panel', eylem: { servis: 'add_item', veri: { item: 'Garaj kapısını kapat' } } });
  assert.deepEqual([r.tur, r.neden], ['gecersiz', 'guvenlik']);
  assert.equal((await hat({ kimlik: 'todo.alisveris', kaynak: 'panel', eylem: { servis: 'add_item', veri: { item: 'Süt' } } })).ok, true);
  assert.equal(cagrilar.length, 1);
});

test('KAPI KURALI (1.4.0): okunur alanda servis yok; kapı adlı ya da kapı seçenekli yeni alan varlığı çalışmaz; süzgeçten geçmeyen kaynak seçilemez', async () => {
  const { hat, cagrilar } = servisOrtami();
  assert.equal((await hat({ kimlik: 'sensor.sicaklik', kaynak: 'panel' })).tur, 'yasak');
  assert.equal((await hat({ kimlik: 'sensor.sicaklik', kaynak: 'panel', eylem: { servis: 'turn_on' } })).tur, 'yasak');
  assert.equal((await hat({ kimlik: 'input_select.kapi_modu', kaynak: 'panel', eylem: { servis: 'select_option', veri: { option: 'Açık' } } })).tur, 'yasak');
  assert.equal((await hat({ kimlik: 'select.giris', kaynak: 'panel', eylem: { servis: 'select_option', veri: { option: 'Normal' } } })).tur, 'yasak');
  assert.equal((await hat({ kimlik: 'vacuum.robot', kaynak: 'panel', eylem: { servis: 'start' } })).tur, 'yasak', 'HA adı sonradan "garage"');
  const r = await hat({ kimlik: 'media_player.tv', kaynak: 'panel', eylem: { servis: 'select_source', veri: { source: 'Kapı kamerası' } } });
  assert.deepEqual([r.tur, r.neden], ['gecersiz', 'parametre']);
  assert.equal(cagrilar.length, 0);
});
