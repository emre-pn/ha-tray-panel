'use strict';

/**
 * Gecikmeli eylem (o-15, src/lib/gecikmeli-eylem.js): doğrulama, bekleyen liste, zamanlayıcı, iptal, uyku/kaçırma ve güvenlik.
 * Gerçek eylem katmanı + sahte HA + sanal saat (test/eylem-sahte.js); ağ, Electron, pencere yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { gecikmeliEylemOlustur, EN_COK_BEKLEYEN, GEC_KALMA_TOLERANSI_MS } = require('../src/lib/gecikmeli-eylem');
const { eylemOrtami, TEMEL_VARLIKLAR, TEMEL_FAVORILER } = require('./eylem-sahte');

const DK = 60_000;

function kur(secenek, ek = {}) {
  const o = eylemOrtami(secenek);
  const bildirimler = [];
  const kayitlar = [];
  const sayac = { degisti: 0 };
  const g = gecikmeliEylemOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    bildir: (b) => bildirimler.push(b),
    degisti: () => {
      sayac.degisti += 1;
    },
    simdi: o.saat.simdi,
    zaman: o.saat,
    kaydet: (k) => kayitlar.push(k),
    saatMetni: (ms) => `T${ms}`,
    ...ek,
  });
  return { ...o, g, bildirimler, kayitlar, sayac, gelenler: o.bildirimler };
}

const govde = (o) => o.postlar().map((p) => [p.yol, p.govde.entity_id]);

test('kapat: planlanınca hemen bir şey gönderilmez, süre dolunca TEK kapatma gönderilir; liste boşalır', async () => {
  const o = kur();
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  assert.equal(s.ok, true);
  assert.deepEqual(o.postlar(), []);
  assert.equal(o.g.sayi(), 1);
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: `Salon lambası kapanacak: T${o.saat.simdi() + 10 * DK}` }]);
  await o.saat.ileri(9 * DK);
  assert.deepEqual(o.postlar(), [], '9 dk: henüz yok');
  await o.saat.ileri(DK + 5);
  assert.deepEqual(govde(o), [['/api/services/light/turn_off', 'light.salon']]);
  assert.equal(o.g.sayi(), 0);
  assert.deepEqual(o.g.ozet(), []);
  assert.equal(o.ha.durum.get('light.salon').state, 'off');
  assert.equal(o.saat.bekleyen(), 0);
});

test('aç: süre dolunca turn_on gider', async () => {
  const o = kur();
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'light.yatak', yon: 'ac', dakika: 5 });
  assert.equal(s.ok, true);
  await o.saat.ileri(5 * DK + 10);
  assert.deepEqual(govde(o), [['/api/services/light/turn_on', 'light.yatak']]);
});

test('süreli ("fan 30dk"): HEMEN açılır, süre dolunca kapatılır; açma başarısızsa hiçbir şey kurulmaz', async () => {
  const o = kur();
  o.ha.degistir('fan.vantilator', { state: 'off' });
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'fan.vantilator', yon: 'sureli', dakika: 30 });
  assert.equal(s.ok, true);
  assert.deepEqual(govde(o), [['/api/services/fan/turn_on', 'fan.vantilator']]);
  assert.equal(o.g.ozet()[0].yon, 'kapat', 'bekleyen işlem kapatmadır');
  assert.equal(o.bildirimler.length, 1, 'tek özet bildirimi');
  assert.equal(o.gelenler.length, 0, 'açma adımı sessiz');
  await o.saat.ileri(30 * DK + 10);
  assert.deepEqual(govde(o), [['/api/services/fan/turn_on', 'fan.vantilator'], ['/api/services/fan/turn_off', 'fan.vantilator']]);

  const hata = kur({ haSarmala: (haIstek) => async (yol, sec) => (sec?.yontem === 'POST' ? Promise.reject(Object.assign(new Error('x'), { tur: 'ag' })) : haIstek(yol, sec)) });
  const r = await hata.g.planla({ kaynak: 'palet', kimlik: 'fan.vantilator', yon: 'sureli', dakika: 30 });
  assert.equal(r.ok, false);
  assert.equal(hata.g.sayi(), 0);
  assert.equal(hata.saat.bekleyen(), 0);
  assert.equal(hata.bildirimler.at(-1).tur, 'hata');
});

test('ozet: en yakın önde; opak kimlik ve ad, yön ve bitiş var; varlık kimliği YOK', async () => {
  const o = kur();
  await o.g.planla({ kaynak: 'palet', kimlik: 'switch.priz', yon: 'kapat', dakika: 60 });
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 });
  const ozet = o.g.ozet();
  assert.deepEqual(ozet.map((x) => [x.ad, x.yon]), [['Salon lambası', 'kapat'], ['Masa prizi', 'kapat']]);
  assert.deepEqual(Object.keys(ozet[0]).sort(), ['ad', 'bitis', 'id', 'yon']);
  assert.match(ozet[0].id, /^g\d+$/);
  assert.equal(ozet[0].bitis, o.saat.simdi() + 5 * DK);
  assert.ok(!JSON.stringify(ozet).includes('light.salon'));
});

test('iptal: bekleyen çalışmaz, zamanlayıcı bırakılır, geçmişe "iptal" yazılır; bilinmeyen kimlik false', async () => {
  const o = kur();
  const { id } = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  assert.equal(o.g.iptal('yok'), false);
  assert.equal(o.g.iptal(5), false);
  assert.equal(o.g.iptal(id, 'tepsi-menu'), true);
  assert.equal(o.g.iptal(id), false, 'ikinci kez bulunamaz');
  assert.equal(o.saat.bekleyen(), 0);
  await o.saat.ileri(20 * DK);
  assert.deepEqual(o.postlar(), []);
  assert.deepEqual(o.kayitlar.map((k) => [k.kaynak, k.islem, k.sonuc]), [['palet', 'gecikmeli-kur', 'ok'], ['tepsi-menu', 'gecikmeli-iptal', 'iptal']]);
});

test('hepsiniIptal ve kapat: hepsi iptal olur; kapat geçmişe yazmaz ve zamanlayıcı bırakmaz', async () => {
  const o = kur();
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  await o.g.planla({ kaynak: 'palet', kimlik: 'switch.priz', yon: 'kapat', dakika: 20 });
  assert.equal(o.g.hepsiniIptal(), 2);
  assert.equal(o.g.sayi(), 0);
  assert.equal(o.kayitlar.filter((k) => k.islem === 'gecikmeli-iptal').length, 2);
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  const onceki = o.kayitlar.length;
  o.g.kapat();
  assert.equal(o.saat.bekleyen(), 0);
  assert.equal(o.kayitlar.length, onceki, 'çıkışta geçmişe yazılmaz');
  await o.saat.ileri(60 * DK);
  assert.deepEqual(o.postlar(), []);
});

test('doğrulama: ertelenemeyen alanlar, geçersiz kimlik/yön/süre/kaynak reddedilir ve hiçbir şey kurulmaz', async () => {
  const varliklar = {
    ...TEMEL_VARLIKLAR,
    'lock.on_kapi': { entity_id: 'lock.on_kapi', state: 'locked', attributes: { friendly_name: 'Ön kapı' } },
    'cover.perde': { entity_id: 'cover.perde', state: 'open', attributes: { friendly_name: 'Perde', device_class: 'curtain' } },
    'alarm_control_panel.ev': { entity_id: 'alarm_control_panel.ev', state: 'disarmed', attributes: { friendly_name: 'Alarm' } },
    'camera.bahce': { entity_id: 'camera.bahce', state: 'idle', attributes: { friendly_name: 'Bahçe' } },
    'automation.gece': { entity_id: 'automation.gece', state: 'on', attributes: { friendly_name: 'Gece' } },
    'valve.su': { entity_id: 'valve.su', state: 'open', attributes: { friendly_name: 'Su vanası' } },
  };
  const o = kur({ varliklar });
  for (const kimlik of ['scene.film', 'button.pc_bilgisayari_kapat', 'lock.on_kapi', 'cover.perde', 'alarm_control_panel.ev', 'camera.bahce', 'automation.gece', 'valve.su', 'sensor.x']) {
    const s = await o.g.planla({ kaynak: 'palet', kimlik, yon: 'kapat', dakika: 10 });
    assert.deepEqual([s.ok, s.tur, s.neden], [false, 'gecersiz', 'desteklenmiyor'], kimlik);
  }
  for (const [ad, yuk] of [
    ['kimlik biçimi', { kimlik: 'light.salon; drop', yon: 'kapat', dakika: 10 }],
    ['kimlik tipi', { kimlik: 5, yon: 'kapat', dakika: 10 }],
    ['yön', { kimlik: 'light.salon', yon: 'toggle', dakika: 10 }],
    ['süre sıfır', { kimlik: 'light.salon', yon: 'kapat', dakika: 0 }],
    ['süre 24 saatten uzun', { kimlik: 'light.salon', yon: 'kapat', dakika: 1441 }],
    ['süre ondalık', { kimlik: 'light.salon', yon: 'kapat', dakika: 1.5 }],
    ['süre metin', { kimlik: 'light.salon', yon: 'kapat', dakika: '10' }],
  ]) {
    const s = await o.g.planla({ kaynak: 'palet', ...yuk });
    assert.equal(s.ok, false, ad);
    assert.equal(s.tur, 'gecersiz', ad);
  }
  for (const kaynak of ['tepsi-menu', 'komut-satiri', 'kisayol', 'masaustu', 'gecikmeli', undefined, 'x']) {
    const s = await o.g.planla({ kaynak, kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
    assert.deepEqual([s.ok, s.tur], [false, 'gecersiz'], String(kaynak));
  }
  assert.equal(o.g.sayi(), 0);
  assert.equal(o.saat.bekleyen(), 0);
  assert.deepEqual(o.postlar(), []);
});

test('doğrulama: sınır değerleri (1 dk ve 1440 dk) kabul edilir', async () => {
  const o = kur();
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 1 })).ok, true);
  assert.equal((await o.g.planla({ kaynak: 'panel', kimlik: 'switch.priz', yon: 'kapat', dakika: 1440 })).ok, true);
});

test('Kapı Kuralı: HA\'daki adı kapıya benzeyen ışık planlanamaz; adı sonradan değişirse zamanı gelince de çalışmaz', async () => {
  const o = kur();
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'light.kapi_lambasi', yon: 'kapat', dakika: 10 });
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  // planlandıktan sonra ad değişir (ya da HA'da yeniden adlandırılır): hat zamanı gelince kuralı yeniden uygular
  const t = await o.g.planla({ kaynak: 'palet', kimlik: 'light.yatak', yon: 'ac', dakika: 10 });
  assert.equal(t.ok, true);
  o.ha.degistir('light.yatak', { attributes: { friendly_name: 'Garaj kapısı lambası' } });
  await o.saat.ileri(10 * DK + 5);
  assert.deepEqual(o.postlar(), [], 'hiçbir istek gitmedi');
  assert.equal(o.g.sayi(), 0);
});

test('onay isteyen (yıkıcı) eylem ertelenemez: PC prizi gibi açık listedeki varlık reddedilir', async () => {
  const varliklar = { ...TEMEL_VARLIKLAR, 'switch.oyun_bilgisayari': { entity_id: 'switch.oyun_bilgisayari', state: 'on', attributes: { friendly_name: 'Oyun bilgisayarı' } } };
  const o = kur({ varliklar, favoriler: [...TEMEL_FAVORILER, { entity_id: 'switch.oyun_bilgisayari', ad: 'Oyun bilgisayarı' }] });
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'switch.oyun_bilgisayari', yon: 'kapat', dakika: 10 });
  assert.deepEqual([s.ok, s.tur], [false, 'kaynak-izinsiz']);
  assert.equal(o.g.sayi(), 0);
  // "diğer cihazlar" yolundan gelen favori dışı kimlik de aynı sınıf denetiminden geçer
  const d = kur({ varliklar, favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async () => true });
  const r = await d.g.planla({ kaynak: 'palet', kimlik: 'switch.oyun_bilgisayari', yon: 'kapat', dakika: 10 });
  assert.deepEqual([r.ok, r.tur], [false, 'kaynak-izinsiz']);
});

test('varlık yok ya da HA\'ya ulaşılamıyor: bulunamadi / ulasilamiyor; hiçbir şey kurulmaz', async () => {
  const o = kur({ favoriler: [...TEMEL_FAVORILER, { entity_id: 'light.yok', ad: 'Yok' }] });
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.yok', yon: 'kapat', dakika: 10 })).tur, 'bulunamadi');
  const ag = kur({ canli: false, haSarmala: () => async () => Promise.reject(Object.assign(new Error('x'), { tur: 'ag' })) });
  assert.equal((await ag.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 })).tur, 'ulasilamiyor');
  assert.equal(o.g.sayi() + ag.g.sayi(), 0);
});

test('aynı varlık ve işlem yeniden planlanınca eskisinin yerine geçer; en çok 10 bekleyen', async () => {
  const o = kur();
  const a = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  const b = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 60 });
  assert.notEqual(a.id, b.id);
  assert.equal(o.g.sayi(), 1);
  assert.equal(o.saat.bekleyen(), 1);
  await o.saat.ileri(30 * DK);
  assert.deepEqual(o.postlar(), [], 'eski plan çalışmaz');
  // aç ve kapat aynı varlıkta ayrı planlardır
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'ac', dakika: 90 });
  assert.equal(o.g.sayi(), 2);

  const dolu = {};
  for (let i = 0; i < 12; i += 1) dolu[`light.l${i}`] = { entity_id: `light.l${i}`, state: 'on', attributes: { friendly_name: `Lamba ${i}` } };
  const p = kur({ varliklar: dolu, favoriler: Object.keys(dolu).map((k) => ({ entity_id: k, ad: k })) });
  for (let i = 0; i < EN_COK_BEKLEYEN; i += 1) assert.equal((await p.g.planla({ kaynak: 'palet', kimlik: `light.l${i}`, yon: 'kapat', dakika: 10 })).ok, true);
  const tasan = await p.g.planla({ kaynak: 'palet', kimlik: 'light.l10', yon: 'kapat', dakika: 10 });
  assert.deepEqual([tasan.ok, tasan.tur], [false, 'dolu']);
  assert.equal((await p.g.planla({ kaynak: 'palet', kimlik: 'light.l3', yon: 'kapat', dakika: 20 })).ok, true, 'var olanı yenilemek dolu listede de olur');
  assert.equal(p.g.sayi(), EN_COK_BEKLEYEN);
});

/** POST'u elle serbest bırakılan HA sarmalayıcısı: "açma HA yanıtını beklerken" araya giren planları sınamak için. */
function bekletenHA() {
  const bekleyenler = [];
  const durum = { tut: true }; // false: POST'lar doğrudan geçer
  return {
    bekleyenler,
    durum,
    sarmala: (haIstek) => (yol, secenek) => {
      if (secenek?.yontem !== 'POST' || !durum.tut) return haIstek(yol, secenek);
      return new Promise((coz, reddet) => bekleyenler.push({ birak: () => haIstek(yol, secenek).then(coz, reddet), hataVer: (h) => reddet(h) }));
    },
  };
}
const akit = () => new Promise((coz) => setImmediate(coz));
const lambalar = (adet) => Object.fromEntries(Array.from({ length: adet }, (_, i) => [`light.l${i}`, { entity_id: `light.l${i}`, state: 'off', attributes: { friendly_name: `Lamba ${i}` } }]));

test('süreli: aynı plan açma beklenirken iki kez istenirse TEK zamanlayıcı kalır (eski kayıt açmadan SONRA yeniden aranır); tek kapatma gider', async () => {
  const bek = bekletenHA();
  const o = kur({ haSarmala: bek.sarmala });
  const a = o.g.planla({ kaynak: 'palet', kimlik: 'fan.vantilator', yon: 'sureli', dakika: 30 });
  const b = o.g.planla({ kaynak: 'palet', kimlik: 'fan.vantilator', yon: 'sureli', dakika: 45 });
  await akit();
  assert.equal(bek.bekleyenler.length, 2, 'iki açma isteği HA yanıtını bekliyor');
  bek.bekleyenler[0].birak();
  assert.equal((await a).ok, true);
  bek.bekleyenler[1].birak();
  assert.equal((await b).ok, true);
  assert.equal(o.g.sayi(), 1, 'ikinci istek birincinin yerine geçti');
  assert.equal(o.saat.bekleyen(), 1, 'tek zamanlayıcı');
  assert.equal(o.g.ozet()[0].bitis, o.saat.simdi() + 45 * DK, 'son istek geçerli');
  bek.durum.tut = false;
  await o.saat.ileri(45 * DK + 10);
  assert.deepEqual(o.postlar().map((p) => p.yol.split('/').at(-1)), ['turn_on', 'turn_on', 'turn_off'], 'tek kapatma');
});

test('süreli: açma beklenirken yer ayrılır; liste araya giren planla dolarsa cihaz AÇILMADAN "dolu" döner, açılmış cihaz zamanlayıcısız kalmaz', async () => {
  const bek = bekletenHA();
  const dolu = lambalar(13);
  const o = kur({ varliklar: dolu, favoriler: Object.keys(dolu).map((k) => ({ entity_id: k, ad: k })), haSarmala: bek.sarmala });
  for (let i = 0; i < EN_COK_BEKLEYEN - 1; i += 1) assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: `light.l${i}`, yon: 'kapat', dakika: 10 })).ok, true);
  const surelisi = o.g.planla({ kaynak: 'palet', kimlik: 'light.l9', yon: 'sureli', dakika: 5 });
  await akit();
  assert.equal(bek.bekleyenler.length, 1, 'açma HA yanıtını bekliyor');
  // açma sürerken başka bir plan son yeri alamaz
  assert.deepEqual((await o.g.planla({ kaynak: 'palet', kimlik: 'light.l10', yon: 'kapat', dakika: 10 })).tur, 'dolu');
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.l3', yon: 'kapat', dakika: 20 })).ok, true, 'var olanı yenilemek yer istemez');
  bek.bekleyenler[0].birak();
  const sonuc = await surelisi;
  assert.equal(sonuc.ok, true);
  assert.equal(o.g.sayi(), EN_COK_BEKLEYEN);
  assert.equal(o.ha.durum.get('light.l9').state, 'on');
  // liste tam doluyken yeni süreli plan cihazı hiç açmaz
  const postlar = o.postlar().length;
  const tasan = await o.g.planla({ kaynak: 'palet', kimlik: 'light.l11', yon: 'sureli', dakika: 5 });
  assert.deepEqual([tasan.ok, tasan.tur], [false, 'dolu']);
  assert.equal(o.postlar().length, postlar, 'cihaz açılmadı');
  assert.equal(o.ha.durum.get('light.l11').state, 'off');
  bek.durum.tut = false;
  await o.saat.ileri(5 * DK + 10);
  assert.equal(o.ha.durum.get('light.l9').state, 'off', 'süre dolunca kapandı');
});

test('süreli: açma başarısız olunca ayrılan yer geri verilir (sonraki plan kabul edilir)', async () => {
  const bek = bekletenHA();
  const dolu = lambalar(12);
  const o = kur({ varliklar: dolu, favoriler: Object.keys(dolu).map((k) => ({ entity_id: k, ad: k })), haSarmala: bek.sarmala });
  for (let i = 0; i < EN_COK_BEKLEYEN - 1; i += 1) await o.g.planla({ kaynak: 'palet', kimlik: `light.l${i}`, yon: 'kapat', dakika: 10 });
  const surelisi = o.g.planla({ kaynak: 'palet', kimlik: 'light.l9', yon: 'sureli', dakika: 5 });
  await akit();
  assert.deepEqual((await o.g.planla({ kaynak: 'palet', kimlik: 'light.l10', yon: 'kapat', dakika: 10 })).tur, 'dolu');
  bek.bekleyenler[0].hataVer(Object.assign(new Error('x'), { tur: 'ag' }));
  assert.equal((await surelisi).ok, false);
  assert.equal(o.g.sayi(), EN_COK_BEKLEYEN - 1);
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.l10', yon: 'kapat', dakika: 10 })).ok, true, 'yer geri verildi');
});

test('favori olmayan varlık ERTELENEMEZ (serbest kimlikle eylem yok): HA isteği hiç gitmez; favori ise ayardaki kayıt kullanılır', async () => {
  const o = kur({ favoriler: [] });
  const s = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 });
  assert.deepEqual([s.ok, s.tur], [false, 'bilinmeyen-favori']);
  assert.equal(o.g.sayi(), 0);
  assert.equal(o.ha.istekler.length, 0, 'durum okuması bile yapılmaz');
  assert.equal(o.saat.bekleyen(), 0);
  const serbest = await o.g.planla({ kaynak: 'palet', kimlik: 'switch.isitici', yon: 'sureli', dakika: 600 });
  assert.deepEqual([serbest.ok, serbest.tur], [false, 'bilinmeyen-favori']);
  assert.deepEqual(o.postlar(), []);

  const f = kur();
  assert.equal((await f.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  await f.saat.ileri(5 * DK + 5);
  assert.deepEqual(govde(f), [['/api/services/light/turn_off', 'light.salon']]);
});

test('favori dışı kimlik yalnız "diğer cihazlar" listesinde VE paletDigerCihazlar açıkken kabul edilir; süre dolunca ayar kapanmışsa çalışmaz', async () => {
  const listede = new Set(['light.salon']);
  const o = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async (k) => listede.has(k) });
  assert.deepEqual((await o.g.planla({ kaynak: 'palet', kimlik: 'switch.priz', yon: 'kapat', dakika: 5 })).tur, 'bilinmeyen-favori', 'listede yok');
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  await o.saat.ileri(5 * DK + 5);
  assert.deepEqual(govde(o), [['/api/services/light/turn_off', 'light.salon']]);

  const kapali = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: false } }, { digerMi: async () => true });
  assert.equal((await kapali.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).tur, 'bilinmeyen-favori', 'ayar kapalıyken liste dikkate alınmaz');

  const sonra = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async () => true });
  assert.equal((await sonra.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  sonra.ayarlar.paletDigerCihazlar = false;
  await sonra.saat.ileri(5 * DK + 5);
  assert.deepEqual(sonra.postlar(), [], 'ayar kapandıktan sonra serbest kimlik çalışmaz');
  assert.deepEqual(sonra.kayitlar.at(-1), { kaynak: 'gecikmeli', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'turn_off', sonuc: 'atlandi', neden: 'favori-degil' });

  const hatali = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async () => { throw new Error('x'); } });
  assert.equal((await hatali.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).tur, 'bilinmeyen-favori', 'listeye bakılamazsa reddedilir');
});

test('fire anında favori dışı kimlik "diğer cihazlar" listesinde yeniden aranır: listeden düşmüşse ya da liste okunamazsa çalışmaz; listedeyse çalışır', async () => {
  const listede = new Set(['light.salon', 'switch.priz']);
  let hata = false;
  const o = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async (k) => (hata ? Promise.reject(new Error('x')) : listede.has(k)) });
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'switch.priz', yon: 'kapat', dakika: 5 })).ok, true);
  assert.equal((await o.g.planla({ kaynak: 'palet', kimlik: 'fan.vantilator', yon: 'sureli', dakika: 5 })).ok, false, 'listede olmayan hiç kurulmaz');
  listede.delete('light.salon'); // cihaz listeden düştü (kullanılamaz ya da güvenli değil artık)
  await o.saat.ileri(5 * DK + 5);
  assert.deepEqual(govde(o), [['/api/services/switch/turn_off', 'switch.priz']], 'yalnız hâlâ listedeki çalışır');
  assert.deepEqual(o.kayitlar.find((k) => k.sonuc === 'atlandi'), { kaynak: 'gecikmeli', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'turn_off', sonuc: 'atlandi', neden: 'favori-degil' });

  const h = kur({ favoriler: [], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async () => (hata ? Promise.reject(new Error('x')) : true) });
  assert.equal((await h.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  hata = true;
  await h.saat.ileri(5 * DK + 5);
  assert.deepEqual(h.postlar(), [], 'liste okunamıyorsa serbest kimlik çalışmaz');

  // favori olan, listeye bakılmadan çalışır
  const f = kur(undefined, { digerMi: async () => { throw new Error('çağrılmamalı'); } });
  assert.equal((await f.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true);
  await f.saat.ileri(5 * DK + 5);
  assert.equal(f.postlar().length, 1);
});

test('digerAyarDegisti: paletDigerCihazlar kapanınca favori olmayan bekleyenler iptal olur (geçmişe yazılır), favoriler ve açık ayar etkilenmez', async () => {
  const o = kur({ favoriler: [{ entity_id: 'light.salon', ad: 'Salon lambası' }], ayarlar: { paletDigerCihazlar: true } }, { digerMi: async (k) => k === 'switch.priz' });
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 5 });
  await o.g.planla({ kaynak: 'palet', kimlik: 'switch.priz', yon: 'kapat', dakika: 5 });
  assert.equal(o.g.sayi(), 2);
  o.g.digerAyarDegisti(); // ayar hâlâ açık
  assert.equal(o.g.sayi(), 2);
  o.ayarlar.paletDigerCihazlar = false;
  const once = o.sayac.degisti;
  o.g.digerAyarDegisti();
  assert.equal(o.g.sayi(), 1);
  assert.deepEqual(o.g.ozet().map((x) => x.ad), ['Salon lambası']);
  assert.equal(o.saat.bekleyen(), 1, 'iptal edilenin zamanlayıcısı bırakıldı');
  assert.ok(o.sayac.degisti > once, 'liste değişti bildirimi');
  assert.deepEqual(o.kayitlar.at(-1), { kaynak: 'panel', kimlik: 'switch.priz', ad: 'Masa prizi', islem: 'gecikmeli-iptal', sonuc: 'iptal' });
  await o.saat.ileri(5 * DK + 5);
  assert.deepEqual(govde(o), [['/api/services/light/turn_off', 'light.salon']]);
  o.g.digerAyarDegisti(); // bekleyen kalmadı: hata vermez, bildirim üretmez
});

test('uyku: bilgisayar uyurken süre geçerse eylem ÇALIŞTIRILMAZ, kullanıcıya söylenir ve geçmişe "atlandi" yazılır', async () => {
  const o = kur();
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  o.saat.uyku(3 * 60 * DK);
  await o.saat.uyanis();
  assert.deepEqual(o.postlar(), []);
  assert.equal(o.g.sayi(), 0);
  assert.equal(o.bildirimler.at(-1).tur, 'hata');
  assert.match(o.bildirimler.at(-1).metin, /Salon lambası/);
  assert.deepEqual(o.kayitlar.at(-1), { kaynak: 'gecikmeli', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'turn_off', sonuc: 'atlandi', neden: 'kacirildi' });
});

test('uyku: tolerans içinde (en çok 2 dk gecikme) eylem yine çalışır', async () => {
  const o = kur();
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  o.saat.uyku(10 * DK + GEC_KALMA_TOLERANSI_MS - 1000);
  await o.saat.uyanis();
  assert.equal(o.postlar().length, 1);
});

test('zamanlayıcı erken uyanırsa (saat farkı) eylem çalışmaz, yeniden kurulur ve vaktinde çalışır', async () => {
  const bekleyenler = [];
  const saat = { simdi: 1_700_000_000_000 };
  const o = kur(undefined, {
    simdi: () => saat.simdi,
    zaman: { setTimeout: (fn) => (bekleyenler.push(fn), bekleyenler.length), clearTimeout: () => {} },
  });
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  assert.equal(bekleyenler.length, 1);
  saat.simdi += 5 * DK; // zamanlayıcı 5 dk erken ateşlendi
  await bekleyenler[0]();
  assert.deepEqual(o.postlar(), []);
  assert.equal(o.g.sayi(), 1);
  assert.equal(bekleyenler.length, 2, 'yeniden kuruldu');
  saat.simdi += 5 * DK + 1;
  await bekleyenler[1]();
  assert.equal(o.postlar().length, 1);
});

test('ayar kapanınca bekleyenler iptal olur; kapalıyken planlanamaz ve özet boştur', async () => {
  const o = kur();
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  o.ayarlar.gecikmeliEylem = false;
  assert.deepEqual(o.g.ozet(), []);
  o.g.ayarDegisti();
  assert.equal(o.g.sayi(), 0);
  assert.equal(o.saat.bekleyen(), 0);
  assert.deepEqual(await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 }), { ok: false, tur: 'kapali' });
  await o.saat.ileri(20 * DK);
  assert.deepEqual(o.postlar(), []);
});

test('degisti: planlama, çalışma ve iptalde çağrılır; eylem sonucu geçmişe "gecikmeli" kaynağıyla yazılabilir (izleyici)', async () => {
  const o = kur();
  const gelen = [];
  o.katman.sonucDinle((b) => gelen.push([b.istek.kaynak, b.istek.islem, b.istek.servis, b.sonuc.ok]));
  const { id } = await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  const planSonrasi = o.sayac.degisti;
  assert.ok(planSonrasi >= 1);
  o.g.iptal(id);
  assert.ok(o.sayac.degisti > planSonrasi);
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  await o.saat.ileri(10 * DK + 5);
  assert.deepEqual(gelen, [['gecikmeli', 'gecikmeli', 'turn_off', true]]);
});

test('gecikmeli eylem geri al yığınına girmez', async () => {
  const { geriAlBaglayiciOlustur } = require('../src/lib/geri-al-baglayici');
  const o = kur();
  const geriAl = geriAlBaglayiciOlustur({ eylem: o.katman, ayarlarAl: () => o.ayarlar, simdi: o.saat.simdi, zaman: o.saat });
  await o.g.planla({ kaynak: 'palet', kimlik: 'light.salon', yon: 'kapat', dakika: 10 });
  await o.saat.ileri(10 * DK + 5);
  assert.equal(o.postlar().length, 1);
  assert.equal(geriAl.ozet(), null);
  geriAl.kapat();
});
