'use strict';

// o-13: kesin yönlü eylemler eylem katmanından (src/eylem.js) geçer: komut satırı ("led +10", "salon ac") ve eylem kısayolu.
// Tek güvenli hat, tek POST; hesap HA'daki GÜNCEL duruma bakar. Ağ yoktur; haIstek sahtedir.

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemKatmaniOlustur } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');

const varlik = (kimlik, state, nitelikler = {}) => ({ entity_id: kimlik, state, attributes: nitelikler });

function sunucuKur() {
  return {
    'light.led': varlik('light.led', 'on', { friendly_name: 'LED şerit', brightness: 128, supported_color_modes: ['brightness'] }),
    'light.salon': varlik('light.salon', 'off', { friendly_name: 'Salon', supported_color_modes: ['brightness'] }),
    'light.ampul': varlik('light.ampul', 'off', { friendly_name: 'Ampul', supported_color_modes: ['onoff'] }),
    'light.kapi_lambasi': varlik('light.kapi_lambasi', 'on', { friendly_name: 'Kapı lambası', brightness: 128 }),
    'fan.vantilator': varlik('fan.vantilator', 'on', { friendly_name: 'Vantilatör', percentage: 50, percentage_step: 1, supported_features: 1 }),
    'switch.priz': varlik('switch.priz', 'on', { friendly_name: 'Priz' }),
    'scene.film': varlik('scene.film', 'unknown', { friendly_name: 'Film' }),
    'lock.on_kapi': varlik('lock.on_kapi', 'locked', { friendly_name: 'Ön kapı' }),
  };
}

const FAVORILER = () => [
  { entity_id: 'light.led', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.salon', ad: 'Salon', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
  { entity_id: 'light.kapi_lambasi', ad: 'Lamba', parlaklik: true },
  { entity_id: 'fan.vantilator', ad: 'Vantilatör' },
  { entity_id: 'switch.priz', ad: 'Priz' },
  { entity_id: 'scene.film', ad: 'Film' },
];

function ortam({ sunucu = sunucuKur(), favoriler = FAVORILER(), durumHatasi = false, durumHataTuru = 'ag' } = {}) {
  const istekler = [];
  const bildirimler = [];
  const gunlukler = [];
  let saat = 1000;
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const ayarlar = { favoriler };
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ayarlar,
    depo,
    canliMi: () => false,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
      const e = /^\/api\/states\/(.+)$/.exec(yol);
      if (e) {
        if (durumHatasi) throw Object.assign(new Error('ag'), { tur: durumHataTuru });
        if (!sunucu[e[1]]) throw Object.assign(new Error('x'), { tur: 'bulunamadi' });
        return sunucu[e[1]];
      }
      return [];
    },
    son: { ekle: () => {} },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {},
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: () => yuzeyModeliOlustur({ favoriler, durumAl: (k) => sunucu[k] }).gruplar.flatMap((g) => g.karolar),
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: () => {} },
    simdi: () => (saat += 5000), // her çağrı yeni bir zaman: tekrar engeli aynı kimliğin ardışık çağrılarını kesmez
  });
  const postlar = () => istekler.filter((i) => i.yontem === 'POST');
  return { katman, sunucu, istekler, postlar, bildirimler, gunlukler, ayarlar };
}

test('komut satırı "led +10" / "led -10": HA\'daki güncel parlaklığa göre tek POST (brightness_pct)', async () => {
  const o = ortam();
  const artis = await o.katman.komutSatirindan('led +10');
  assert.equal(artis.ok, true);
  assert.deepEqual(o.postlar(), [{ yol: '/api/services/light/turn_on', yontem: 'POST', govde: { entity_id: 'light.led', brightness_pct: 60 } }]);
  const azalis = await o.katman.komutSatirindan('led -10');
  assert.equal(azalis.ok, true);
  assert.equal(o.postlar()[1].govde.brightness_pct, 40, '128/255 = %50; -10 = 40 (bellekteki eski değere değil, güncel duruma göre)');
  // Durum değişince hesap da değişir.
  o.sunucu['light.led'] = varlik('light.led', 'on', { friendly_name: 'LED şerit', brightness: 255 });
  await o.katman.komutSatirindan('led -20');
  assert.equal(o.postlar()[2].govde.brightness_pct, 80);
  assert.ok(o.bildirimler.every((b) => b.tur === 'ok'));
});

test('komut satırı: kapalı ışığa artı adım %N ile açar; eksi adım ve sınırdaki adım POST göndermez, "değişmedi" bildirir', async () => {
  const o = ortam();
  const ac = await o.katman.komutSatirindan('salon +10');
  assert.equal(ac.ok, true);
  assert.equal(o.postlar()[0].govde.brightness_pct, 10);
  const eksi = await o.katman.komutSatirindan('salon -10');
  assert.deepEqual([eksi.ok, eksi.degismedi], [true, true]);
  assert.equal(o.postlar().length, 1, 'kapalı ışıkta eksi adım bir şey göndermez');
  o.sunucu['light.led'] = varlik('light.led', 'on', { friendly_name: 'LED şerit', brightness: 255 });
  const tavan = await o.katman.komutSatirindan('led +10');
  assert.deepEqual([tavan.ok, tavan.degismedi], [true, true]);
  assert.equal(o.postlar().length, 1);
  assert.match(o.bildirimler.at(-1).metin, /LED şerit/);
  assert.equal(o.bildirimler.at(-1).tur, 'ok');
});

test('komut satırı: ışık durumu okunamazsa/ulaşılamazsa hata bildirilir, POST yok; parlaklık bildirmeyen ışıkta hesap yapılmaz', async () => {
  const yok = ortam({ durumHatasi: true });
  const s = await yok.katman.komutSatirindan('led +10');
  assert.deepEqual([s.ok, s.tur], [false, 'ha-hatasi']);
  assert.equal(yok.postlar().length, 0);
  assert.equal(yok.bildirimler.at(-1).tur, 'hata');

  const kapali = ortam();
  kapali.sunucu['light.led'] = varlik('light.led', 'unavailable', { friendly_name: 'LED şerit' });
  const u = await kapali.katman.komutSatirindan('led +10');
  assert.deepEqual([u.ok, u.tur], [false, 'ulasilamiyor']);
  assert.equal(kapali.postlar().length, 0);

  const bilinmez = ortam();
  bilinmez.sunucu['light.led'] = varlik('light.led', 'on', { friendly_name: 'LED şerit' }); // brightness yok
  const b = await bilinmez.katman.komutSatirindan('led +10');
  assert.deepEqual([b.ok, b.tur], [false, 'gecersiz']);
  assert.equal(bilinmez.postlar().length, 0);
});

test('komut satırı "vantilator +20" / "-10": fan.set_percentage ile 0..100 arasında kalan yüzde', async () => {
  const o = ortam();
  await o.katman.komutSatirindan('vantilator +20');
  assert.deepEqual(o.postlar()[0], { yol: '/api/services/fan/set_percentage', yontem: 'POST', govde: { entity_id: 'fan.vantilator', percentage: 70 } });
  await o.katman.komutSatirindan('vantilator -10');
  assert.equal(o.postlar()[1].govde.percentage, 40);
  o.sunucu['fan.vantilator'] = varlik('fan.vantilator', 'on', { friendly_name: 'Vantilatör', percentage: 95, percentage_step: 1, supported_features: 1 });
  await o.katman.komutSatirindan('vantilator +20');
  assert.equal(o.postlar()[2].govde.percentage, 100);
  o.sunucu['fan.vantilator'] = varlik('fan.vantilator', 'off', { friendly_name: 'Vantilatör', supported_features: 1 });
  await o.katman.komutSatirindan('vantilator +10');
  assert.equal(o.postlar()[3].govde.percentage, 10, 'kapalı vantilatör artı adımla o hızla açılır');
  const once = o.postlar().length;
  const eksi = await o.katman.komutSatirindan('vantilator -10');
  assert.equal(eksi.degismedi, true);
  assert.equal(o.postlar().length, once);
});

test('komut satırı "salon ac" / "salon kapat" / "salon degistir": sabit turn_on / turn_off / toggle, tek POST', async () => {
  const o = ortam();
  await o.katman.komutSatirindan('salon ac');
  await o.katman.komutSatirindan('salon kapat');
  await o.katman.komutSatirindan('salon degistir');
  await o.katman.komutSatirindan('priz kapat');
  await o.katman.komutSatirindan('vantilator kapat');
  await o.katman.komutSatirindan('ampul ac');
  assert.deepEqual(o.postlar().map((p) => [p.yol, p.govde]), [
    ['/api/services/light/turn_on', { entity_id: 'light.salon' }],
    ['/api/services/light/turn_off', { entity_id: 'light.salon' }],
    ['/api/services/light/toggle', { entity_id: 'light.salon' }],
    ['/api/services/switch/turn_off', { entity_id: 'switch.priz' }],
    ['/api/services/fan/turn_off', { entity_id: 'fan.vantilator' }],
    ['/api/services/light/turn_on', { entity_id: 'light.ampul' }],
  ]);
  assert.ok(o.postlar().every((p) => Object.keys(p.govde).length === 1 || p.govde.brightness_pct !== undefined));
});

test('yön desteklenmeyen öğede komut hiçbir şey çalıştırmaz (sahne "film ac", kısılamayan ışık "ampul +10", ad bulunamaz)', async () => {
  const o = ortam();
  for (const ad of ['film ac', 'film kapat', 'ampul +10', 'priz +10', 'olmayan ac']) {
    const s = await o.katman.komutSatirindan(ad);
    assert.equal(s.ok, false, ad);
  }
  assert.equal(o.postlar().length, 0);
  assert.equal(o.istekler.filter((i) => i.yontem === 'GET').length, 0, 'çözümlenemeyen komut HA\'ya hiç gitmez');
});

test('kapı kuralı: kapı lambası ve kilit yön komutuyla da çalışmaz (karo listesinde yok, hatta da yasak)', async () => {
  const o = ortam({ favoriler: [...FAVORILER(), { entity_id: 'lock.on_kapi', ad: 'Ön kapı' }] });
  for (const ad of ['kapi lambasi ac', 'lamba ac', 'lamba +10', 'on kapi ac', 'on kapi kapat', 'lock.on_kapi ac']) {
    const s = await o.katman.komutSatirindan(ad);
    assert.equal(s.ok, false, ad);
  }
  assert.equal(o.postlar().length, 0);
  // Hat yönlü eylemde de süzgeç uygular: kısayolu elle "ac" yapılmış kapı lambası favorisi çalışmaz.
  const k = ortam({ favoriler: [{ entity_id: 'light.kapi_lambasi', ad: 'Lamba', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'ac' }] });
  const s = await k.katman.kisayolla('light.kapi_lambasi');
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  assert.equal(k.postlar().length, 0);
  const g = ortam({ favoriler: [{ entity_id: 'light.kapi_lambasi', ad: 'Lamba', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' }] });
  const sg = await g.katman.kisayolla('light.kapi_lambasi');
  assert.deepEqual([sg.ok, sg.tur], [false, 'yasak']);
  assert.equal(g.postlar().length, 0);
});

test('eylem kısayolu: favoride kisayolEylemi varsa kesin yön uygulanır; yoksa varlığın kendi aç-kapa eylemi (eskisi gibi)', async () => {
  const eski = ortam();
  await eski.katman.kisayolla('light.salon');
  assert.equal(eski.postlar()[0].yol, '/api/services/light/toggle');

  const favoriler = [
    { entity_id: 'light.led', ad: 'LED şerit', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' },
    { entity_id: 'light.salon', ad: 'Salon', parlaklik: true, kisayol: 'Control+Alt+2', kisayolEylemi: 'ac' },
    { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Control+Alt+3', kisayolEylemi: 'kapat' },
    { entity_id: 'fan.vantilator', ad: 'Vantilatör', kisayol: 'Control+Alt+4', kisayolEylemi: 'hiz-20' },
  ];
  const o = ortam({ favoriler });
  assert.equal((await o.katman.kisayolla('light.led')).ok, true);
  assert.equal((await o.katman.kisayolla('light.salon')).ok, true);
  assert.equal((await o.katman.kisayolla('switch.priz')).ok, true);
  assert.equal((await o.katman.kisayolla('fan.vantilator')).ok, true);
  assert.deepEqual(o.postlar().map((p) => [p.yol, p.govde]), [
    ['/api/services/light/turn_on', { entity_id: 'light.led', brightness_pct: 60 }],
    ['/api/services/light/turn_on', { entity_id: 'light.salon' }],
    ['/api/services/switch/turn_off', { entity_id: 'switch.priz' }],
    ['/api/services/fan/set_percentage', { entity_id: 'fan.vantilator', percentage: 30 }],
  ]);
});

test('eylem kısayolu: bu favori için geçersiz eylem (parlaklık kontrolü kapalı, yanlış alan, bilinmeyen değer) sessizce aç-kapa yapmaz, hata bildirir', async () => {
  const gecersizler = [
    { entity_id: 'light.led', ad: 'LED şerit', parlaklik: false, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' },
    { entity_id: 'light.salon', ad: 'Salon', parlaklik: true, kisayol: 'Control+Alt+2', kisayolEylemi: 'hiz+10' },
    { entity_id: 'scene.film', ad: 'Film', kisayol: 'Control+Alt+3', kisayolEylemi: 'ac' },
    { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Control+Alt+4', kisayolEylemi: 'turn_off' },
    { entity_id: 'light.ampul', ad: 'Ampul', kisayol: 'Control+Alt+5', kisayolEylemi: 'parlak+7' },
  ];
  const o = ortam({ favoriler: gecersizler });
  for (const f of gecersizler) {
    const s = await o.katman.kisayolla(f.entity_id);
    assert.deepEqual([s.ok, s.tur], [false, 'gecersiz'], f.entity_id);
  }
  assert.equal(o.postlar().length, 0);
  assert.equal(o.bildirimler.length, gecersizler.length);
  assert.ok(o.bildirimler.every((b) => b.tur === 'hata'));
});

test('eylem kısayolu: hata ve günlük metinlerinde adres, anahtar ya da kimlik dışı ayrıntı yoktur', async () => {
  const o = ortam({ durumHatasi: true, favoriler: [{ entity_id: 'light.led', ad: 'LED şerit', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' }] });
  await o.katman.kisayolla('light.led');
  const hepsi = JSON.stringify([o.bildirimler, o.gunlukler]);
  assert.doesNotMatch(hepsi, /https?:\/\//);
  assert.doesNotMatch(hepsi, /Bearer|token|eyJ/i);
});

test('(bulgu 14) yönlü eylemde durum okuma hatası gerçek nedenle bildirilir: doğrudan eylemle ("led 40") AYNI hata metni', async () => {
  for (const neden of ['yetki', 'baglanti']) {
    const o = ortam({ durumHatasi: true, durumHataTuru: neden });
    const yonlu = await o.katman.komutSatirindan('led +10');
    const dogrudan = await o.katman.komutSatirindan('led 40');
    assert.deepEqual([yonlu.ok, yonlu.tur], [false, 'ha-hatasi'], neden);
    assert.deepEqual([dogrudan.ok, dogrudan.tur], [false, 'ha-hatasi'], neden);
    const hatalar = o.bildirimler.filter((b) => b.tur === 'hata');
    assert.equal(hatalar.length, 2);
    assert.equal(hatalar[0].metin, hatalar[1].metin, `${neden}: yönlü ve doğrudan eylem aynı metni verir`);
    assert.doesNotMatch(hatalar[0].metin, /ulaşılamıyor/, 'anahtar/ağ nedeni "cihaz ulaşılamıyor"a düzleşmez');
    assert.equal(o.postlar().length, 0);
  }
  const anahtar = ortam({ durumHatasi: true, durumHataTuru: 'yetki' });
  await anahtar.katman.komutSatirindan('led +10');
  assert.match(anahtar.bildirimler.at(-1).metin, /erişim anahtarı geçersiz/);
  assert.ok(anahtar.gunlukler.every((m) => !/token|anahtar=|Bearer/i.test(m)));
});
