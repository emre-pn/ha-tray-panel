'use strict';

/**
 * Oda bağlayıcısı (o-14, src/lib/oda-baglayici.js): GERÇEK eylem katmanı + sahte HA + sanal saat. Alan (oda) kaydının arka planda okunması ve
 * önbelleği, ayar kapalıyken ağa çıkılmaması, "odayı kapat"ın AYNI güvenli hattan (kapı kuralı, sınıf, hız sınırı) geçmesi, kısmi başarısızlık,
 * meşgul/geçersiz istekler. Gerçek Home Assistant, ağ ya da pencere YOK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { odaBaglayiciOlustur, alanVerisiOzeti, YENILEME_MS, ETIKET } = require('../src/lib/oda-baglayici');
const { odalariCikar } = require('../src/lib/oda-gruplari');
const { eylemOrtami, TEMEL_VARLIKLAR, TEMEL_FAVORILER } = require('./eylem-sahte');

const ALAN_VERISI = {
  alanlar: [
    { id: 'salon', ad: 'Salon' },
    { id: 'yatak', ad: 'Yatak odası' },
  ],
  varlikAlanlari: {
    'light.salon': 'salon',
    'switch.priz': 'salon',
    'fan.vantilator': 'salon',
    'scene.film': 'salon',
    'button.pc_bilgisayari_kapat': 'salon',
    'light.kapi_lambasi': 'salon',
    'light.yatak': 'yatak',
  },
};
const SALON_KODU = odalariCikar(ALAN_VERISI).get('salon').kod;

function kur({ ayar = 'oda', alan = ALAN_VERISI, ek = {}, alanlarAl } = {}) {
  const o = eylemOrtami(ek);
  o.ayarlar.panelGruplama = ayar;
  const bildirimler = [];
  const olaylar = { degisti: 0, alanOkuma: 0, gunluk: [] };
  const b = odaBaglayiciOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    durumAl: (k) => o.depo.al(k),
    alanlarAl:
      alanlarAl ??
      (async () => {
        olaylar.alanOkuma += 1;
        return structuredClone(alan);
      }),
    bildir: (x) => bildirimler.push(x),
    degisti: () => {
      olaylar.degisti += 1;
    },
    simdi: o.saat.simdi,
    gunluk: (m) => olaylar.gunluk.push(m),
  });
  return { ...o, b, bildirimler, olaylar };
}

const MODEL_GRUPLARI = () => [
  { kod: 'isik', etiket: 'Işık', karolar: [{ id: 'light.salon' }, { id: 'light.yatak' }] },
  { kod: 'yardimci', etiket: 'Yardımcı', karolar: [{ id: 'switch.priz' }] },
];

test('ayar "tur" iken oda kaydı HİÇ okunmaz ve gruplar aynen döner', async () => {
  const o = kur({ ayar: 'tur' });
  const gruplar = MODEL_GRUPLARI();
  assert.equal(o.b.gruplar(gruplar), gruplar);
  await o.b.gruplar(gruplar);
  assert.equal(o.olaylar.alanOkuma, 0);
});

test('ayar "oda": ilk çağrı kaydı arka planda okutur (gruplar tür gruplu kalır), okununca panel yenilenir ve gruplar odalara göre döner', async () => {
  const o = kur();
  const gruplar = MODEL_GRUPLARI();
  assert.equal(o.b.gruplar(gruplar), gruplar, 'kayıt henüz yok: tür gruplu');
  await o.b.yenile();
  assert.equal(o.olaylar.alanOkuma, 1);
  assert.equal(o.olaylar.degisti, 1, 'oda kaydı geldi: panel yeniden çizilir');
  const sonuc = o.b.gruplar(MODEL_GRUPLARI());
  assert.deepEqual(sonuc.filter((g) => g.oda).map((g) => g.etiket), ['Salon', 'Yatak odası']);
  assert.equal(sonuc.find((g) => g.etiket === 'Salon').kod, SALON_KODU);
  // aynı kayıt yeniden okununca (değişiklik yok) panel boşuna yenilenmez
  await o.b.yenile();
  assert.equal(o.olaylar.degisti, 1);
});

test('önbellek: 5 dakika dolmadan yeniden okunmaz, dolunca arka planda tazelenir; eşzamanlı çağrılar tek okumayı paylaşır', async () => {
  const o = kur();
  const g = MODEL_GRUPLARI();
  const akit = () => new Promise((coz) => setImmediate(coz));
  o.b.gruplar(g);
  o.b.gruplar(g);
  o.b.gruplar(g);
  await akit();
  assert.equal(o.olaylar.alanOkuma, 1, 'üç eşzamanlı çağrı tek okuma');
  await o.saat.ileri(YENILEME_MS - 1000);
  o.b.gruplar(g);
  await akit();
  assert.equal(o.olaylar.alanOkuma, 1, 'süre dolmadı');
  await o.saat.ileri(2000);
  o.b.gruplar(g);
  await akit();
  assert.equal(o.olaylar.alanOkuma, 2, 'süre dolunca yeniden okundu');
});

test('oda kaydı okunamıyorsa (yönetici yetkisi yok / HA kapalı) panel tür gruplu kalır, hata yutulur ve 30 sn sonra yeniden denenir', async () => {
  let sayac = 0;
  const o = kur({
    alanlarAl: async () => {
      sayac += 1;
      throw new Error('yetki');
    },
  });
  const g = MODEL_GRUPLARI();
  o.b.gruplar(g);
  await o.b.yenile();
  assert.equal(o.b.gruplar(g), g);
  assert.equal(sayac, 1);
  assert.ok(o.olaylar.gunluk.some((m) => /Oda kaydı okunamadı/.test(m)));
  assert.equal(o.olaylar.gunluk.join('').includes('yetki'), false, 'hata ayrıntısı günlüğe yazılmaz');
  await o.saat.ileri(10_000);
  o.b.gruplar(g);
  assert.equal(sayac, 1, '30 sn dolmadı');
  await o.saat.ileri(21_000);
  o.b.gruplar(g);
  await o.b.yenile();
  assert.equal(sayac, 2, '30 sn sonra yeniden denendi');
});

test('boş alan kaydı (hiç oda tanımlı değil) tür gruplu bırakır ve kısa aralıkla yeniden dener', async () => {
  const o = kur({ alan: { alanlar: [], varlikAlanlari: {} } });
  const g = MODEL_GRUPLARI();
  o.b.gruplar(g);
  await o.b.yenile();
  assert.equal(o.b.gruplar(g), g);
  assert.equal(o.olaylar.alanOkuma, 1);
  await o.saat.ileri(10_000);
  o.b.gruplar(g);
  assert.equal(o.olaylar.alanOkuma, 1, '30 sn dolmadı');
  await o.saat.ileri(21_000);
  o.b.gruplar(g);
  await new Promise((coz) => setImmediate(coz));
  assert.equal(o.olaylar.alanOkuma, 2, '30 sn sonra yeniden okundu (5 dk beklenmez)');
});

test('ayarDegisti: oda açılınca kayıt hemen okunur, her durumda panel yenilenir', async () => {
  const o = kur({ ayar: 'tur' });
  o.b.ayarDegisti();
  assert.equal(o.olaylar.alanOkuma, 0);
  assert.equal(o.olaylar.degisti, 1);
  o.ayarlar.panelGruplama = 'oda';
  o.b.ayarDegisti();
  await o.b.yenile();
  assert.equal(o.olaylar.alanOkuma, 1);
  assert.ok(o.olaylar.degisti >= 2);
});

test('alanVerisiOzeti: yalnız düz kayıtlar kalır; 200 alan ve 5000 eşleme sınırı; bozuk girdi boş döner', () => {
  assert.deepEqual(alanVerisiOzeti(null), { alanlar: [], varlikAlanlari: {} });
  assert.deepEqual(alanVerisiOzeti({ alanlar: [{ id: 'a', ad: 'A', gizli: 'x' }, { id: 1, ad: 'B' }, null], varlikAlanlari: { 'light.a': 'a', 'light.b': 5 } }), { alanlar: [{ id: 'a', ad: 'A' }], varlikAlanlari: { 'light.a': 'a' } });
  const buyuk = alanVerisiOzeti({
    alanlar: Array.from({ length: 300 }, (_, i) => ({ id: `a${i}`, ad: `A${i}` })),
    varlikAlanlari: Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`light.l${i}`, 'a1'])),
  });
  assert.equal(buyuk.alanlar.length, 200);
  assert.equal(Object.keys(buyuk.varlikAlanlari).length, 5000);
});

// --- odayı kapat ---------------------------------------------------------------------------------

async function hazirKur(ek = {}) {
  const o = kur(ek);
  await o.b.yenile();
  return o;
}
const govdeler = (o) => o.postlar().map((p) => `${p.yol}:${[].concat(p.govde.entity_id).join(',')}`).sort();

test('odayı kapat: odadaki AÇIK zararsız favoriler turn_off alır; sahne, PC düğmesi, kapı lambası, kapalı ve başka odadaki cihaza DOKUNULMAZ; tek özet bildirimi', async () => {
  const o = await hazirKur();
  const s = await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.deepEqual(s, { ok: true, adet: 3, toplam: 3 });
  assert.deepEqual(govdeler(o), ['/api/services/fan/turn_off:fan.vantilator', '/api/services/light/turn_off:light.salon', '/api/services/switch/turn_off:switch.priz']);
  assert.equal(o.ha.durum.get('light.salon').state, 'off');
  assert.equal(o.ha.durum.get('light.kapi_lambasi').state, 'on', 'kapı kuralı: kapı lambasına dokunulmaz');
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: 'Salon: 3 cihaz kapatıldı' }], 'adımlar sessiz, tek özet');
  assert.ok(o.olaylar.degisti >= 2, 'geri al düğmesi için panel yenilenir');
});

test('odayı kapat: adımlar "Son kullanılanlar"a yazılmaz (ana süreç içi işlem)', async () => {
  const o = await hazirKur();
  await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.deepEqual(o.sonlar, []);
});

test('odayı kapat: yalnız PANEL kaynağı; palet, tepsi, kısayol ve bilinmeyen kaynak reddedilir; HA\'ya hiçbir şey gitmez', async () => {
  const o = await hazirKur();
  for (const kaynak of ['palet', 'tepsi-menu', 'kisayol', 'komut-satiri', 'masaustu', 'gecikmeli', undefined, 5]) {
    assert.deepEqual(await o.b.kapat({ kaynak, kod: SALON_KODU }), { ok: false, tur: 'gecersiz' }, String(kaynak));
  }
  assert.deepEqual(await o.b.kapat(), { ok: false, tur: 'gecersiz' });
  assert.equal(o.postlar().length, 0);
});

test('odayı kapat: geçersiz / bilinmeyen kod reddedilir (kod grup kodudur, kimlik ya da serbest metin değil)', async () => {
  const o = await hazirKur();
  for (const kod of ['oda-00000000', 'light.salon', 'salon', '', null, undefined, 'oda-zzzzzzzz', { kod: SALON_KODU }, 'oda-' + 'a'.repeat(9)]) {
    assert.deepEqual(await o.b.kapat({ kaynak: 'panel', kod }), { ok: false, tur: 'gecersiz' }, String(kod));
  }
  assert.equal(o.postlar().length, 0);
});

test('odayı kapat: ayar "tur" iken ya da oda kaydı henüz okunmamışken çalışmaz', async () => {
  const kapali = await hazirKur({ ayar: 'tur' });
  assert.deepEqual(await kapali.b.kapat({ kaynak: 'panel', kod: SALON_KODU }), { ok: false, tur: 'kapali' });
  const okunmamis = kur();
  assert.deepEqual(await okunmamis.b.kapat({ kaynak: 'panel', kod: SALON_KODU }), { ok: false, tur: 'gecersiz' });
  assert.equal(kapali.postlar().length + okunmamis.postlar().length, 0);
});

test('odayı kapat: odada açık cihaz yoksa "açık cihaz yok" der, HA\'ya bir şey göndermez', async () => {
  const o = await hazirKur();
  for (const k of ['light.salon', 'switch.priz', 'fan.vantilator']) o.ha.degistir(k, { state: 'off' });
  assert.deepEqual(await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU }), { ok: true, adet: 0, toplam: 0 });
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: 'Salon: açık cihaz yok' }]);
  assert.equal(o.postlar().length, 0);
});

test('odayı kapat: üyeler HER ZAMAN ana süreçte hesaplanır; favoriden çıkarılan ve onay isteyen cihaz kapatılmaz', async () => {
  const o = await hazirKur();
  o.ayarlar.favoriler = TEMEL_FAVORILER.filter((f) => f.entity_id !== 'switch.priz').map((f) => (f.entity_id === 'fan.vantilator' ? { ...f, onay: true } : f));
  const s = await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.deepEqual(s, { ok: true, adet: 1, toplam: 1 });
  assert.deepEqual(govdeler(o), ['/api/services/light/turn_off:light.salon']);
});

test('odayı kapat: bir adım başarısız olursa kalanı yine kapatılır; sonuç "kısmen" hatasıdır, ok yalnız en az biri başardıysa', async () => {
  const hataVer = (haIstek) => async (yol, secenek) => {
    if (yol === '/api/services/switch/turn_off') throw Object.assign(new Error('x'), { tur: 'sunucu' });
    return haIstek(yol, secenek);
  };
  const o = await hazirKur({ ek: { haSarmala: hataVer } });
  const s = await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.deepEqual(s, { ok: true, adet: 2, toplam: 3 });
  assert.deepEqual(o.bildirimler, [{ tur: 'hata', metin: 'Salon: 2 / 3 cihaz kapatıldı, kalanı kapatılamadı' }]);
  assert.equal(o.ha.durum.get('light.salon').state, 'off');
  assert.equal(o.ha.durum.get('switch.priz').state, 'on');

  const hepsi = (haIstek) => async (yol, secenek) => {
    if (yol.startsWith('/api/services/')) throw Object.assign(new Error('x'), { tur: 'sunucu' });
    return haIstek(yol, secenek);
  };
  const p = await hazirKur({ ek: { haSarmala: hepsi } });
  const sonuc = await p.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.tur, 'hata');
  assert.deepEqual(p.bildirimler, [{ tur: 'hata', metin: 'Salon: 0 / 3 cihaz kapatıldı, kalanı kapatılamadı' }]);
});

test('odayı kapat: sürerken ikinci istek "meşgul" döner (çift gönderim yok); bitince yeniden kapatılabilir', async () => {
  const o = await hazirKur();
  const ilk = o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.deepEqual(await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU }), { ok: false, tur: 'mesgul' });
  assert.equal((await ilk).ok, true);
  assert.equal(o.postlar().length, 3, 'her cihaza tam bir POST');
});

test('odayı kapat: her adım ETİKETLİ ("oda-kapat") ve tek parti olarak izleyicilere gider; parti adı oda adını taşır', async () => {
  const o = await hazirKur();
  const gelenler = [];
  o.katman.sonucDinle((bilgi) => gelenler.push(bilgi));
  await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU });
  assert.equal(gelenler.length, 3);
  assert.ok(gelenler.every((g) => g.istek.islem === ETIKET && g.istek.kaynak === 'panel'));
  const partiler = new Set(gelenler.map((g) => g.istek.parti?.id));
  assert.equal(partiler.size, 1, 'hepsi aynı parti');
  assert.equal(gelenler[0].istek.parti.ad, 'Oda: Salon');
  await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU }); // artık kapalı: yeni adım yok
  assert.equal(gelenler.length, 3);
});

test('odayı kapat: 5 dk sonra bile aynı kod yeni kayıtla çalışır (kayıt yenilendi, kod kararlı)', async () => {
  const o = await hazirKur();
  await o.saat.ileri(YENILEME_MS + 1000);
  o.b.gruplar(MODEL_GRUPLARI());
  await o.b.yenile();
  assert.equal(o.olaylar.alanOkuma, 2, 'kayıt gerçekten yenilendi');
  assert.equal(o.b.gruplar(MODEL_GRUPLARI()).find((g) => g.etiket === 'Salon').kod, SALON_KODU, 'bağlayıcının yenilenen kayıttan ürettiği kod aynı');
  assert.equal((await o.b.kapat({ kaynak: 'panel', kod: SALON_KODU })).ok, true);
});

test('çalışma zamanı: TEMEL_VARLIKLAR değişmez (testler birbirinden bağımsız)', () => {
  assert.equal(TEMEL_VARLIKLAR['light.salon'].state, 'on');
});
