'use strict';

/**
 * HA okuma uçları (src/lib/ha-okuma.js) — 1.4.0. Gerçek HA'ya hiç gidilmez: sahte haIstek (REST), sahte ws.komut / ws.abone.
 *
 * sahteOkuma(): diğer özellik ajanları da bu kalıbı kopyalayabilir (sahte sunucu yanıtları `rest` / `wsYanit` tablolarıyla verilir).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { haOkumaOlustur, yuzeyOkumasi, DAKIKA_SINIRI, EN_COK_NOKTA } = require('../src/lib/ha-okuma');

const DURUMLAR = {
  'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21', attributes: { friendly_name: 'Salon sıcaklığı' } },
  'sensor.nem': { entity_id: 'sensor.nem', state: '40', attributes: {} },
  'binary_sensor.on_kapi': { entity_id: 'binary_sensor.on_kapi', state: 'off', attributes: { device_class: 'door' } },
  'binary_sensor.pencere': { entity_id: 'binary_sensor.pencere', state: 'off', attributes: { device_class: 'Window' } },
  'binary_sensor.hareket': { entity_id: 'binary_sensor.hareket', state: 'on', attributes: { device_class: 'motion' } },
  'sensor.garaj_sicaklik': { entity_id: 'sensor.garaj_sicaklik', state: '12', attributes: {} },
  'calendar.ev': { entity_id: 'calendar.ev', state: 'off', attributes: { friendly_name: 'Ev' } },
  'weather.ev': { entity_id: 'weather.ev', state: 'sunny', attributes: {} },
  'todo.alisveris': { entity_id: 'todo.alisveris', state: '2', attributes: {} },
  'lock.on_kapi': { entity_id: 'lock.on_kapi', state: 'locked', attributes: {} },
  'cover.perde': { entity_id: 'cover.perde', state: 'open', attributes: { device_class: 'curtain', friendly_name: 'Salon perde' } },
  'cover.garaj': { entity_id: 'cover.garaj', state: 'closed', attributes: { device_class: 'garage', friendly_name: 'Depo' } },
  'cover.sinifsiz': { entity_id: 'cover.sinifsiz', state: 'closed', attributes: { friendly_name: 'Bir şey' } },
};

const akit = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
};

function sahteZaman() {
  const bekleyenler = new Map();
  let sonId = 0;
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    hepsiniCalistir() {
      const liste = [...bekleyenler.values()];
      bekleyenler.clear();
      for (const b of liste) b.fn();
    },
    bekleyen: () => bekleyenler.size,
  };
}

function sahteOkuma({ rest = {}, wsYanit = {}, depo = true, wsYok = false } = {}) {
  let saat = Date.parse('2026-10-16T12:00:00Z');
  const istekler = [];
  const komutlar = [];
  const aboneler = [];
  const gunlukler = [];
  const zaman = sahteZaman();
  const haIstek = async (yol, secenek) => {
    istekler.push({ yol, ...secenek });
    for (const [desen, yanit] of Object.entries(rest)) {
      if (yol.startsWith(desen)) {
        if (typeof yanit === 'function') return yanit(yol);
        return structuredClone(yanit);
      }
    }
    const m = /^\/api\/states\/(.+)$/.exec(yol);
    if (m && DURUMLAR[m[1]]) return structuredClone(DURUMLAR[m[1]]);
    if (m) throw Object.assign(new Error('yok'), { tur: 'bulunamadi' });
    throw Object.assign(new Error('ağ'), { tur: 'ag' });
  };
  const ws = wsYok
    ? null
    : {
        async komut(ileti) {
          komutlar.push(ileti);
          const y = wsYanit[ileti.type];
          if (typeof y === 'function') return y(ileti);
          return y ?? { ok: false, kod: 'baglanti-yok' };
        },
        abone(ileti, dinleyici) {
          const kayit = { ileti, dinleyici, birakildi: false };
          aboneler.push(kayit);
          return () => {
            kayit.birakildi = true;
          };
        },
      };
  const okuma = haOkumaOlustur({
    haIstek,
    ws,
    durumAl: depo ? (k) => DURUMLAR[k] : () => undefined,
    simdi: () => saat,
    gunluk: (m) => gunlukler.push(m),
    zaman,
  });
  return {
    okuma,
    istekler,
    komutlar,
    aboneler,
    gunlukler,
    zaman,
    ilerle(ms) {
      saat += ms;
    },
    simdi: () => saat,
  };
}

const gecmisYaniti = [
  [
    { entity_id: 'sensor.sicaklik', state: '20.5', last_changed: '2026-10-16T10:00:00+00:00' },
    { state: '21', last_changed: '2026-10-16T11:00:00+00:00' },
    { state: 'unavailable', last_changed: '2026-10-16T11:30:00+00:00' },
    { state: 'Kapı açık', last_changed: '2026-10-16T11:40:00+00:00' },
    { state: 'x', last_changed: 'bozuk' },
  ],
  [{ entity_id: 'sensor.baska', state: '1', last_changed: '2026-10-16T10:00:00+00:00' }],
];

test('geçmiş: tek GET, sınırlı ve süzülmüş seri; istenmeyen varlık yanıtta olsa da dönmez', async () => {
  const o = sahteOkuma({ rest: { '/api/history/period/': gecmisYaniti } });
  const sonuc = await o.okuma.gecmis(['sensor.sicaklik'], { saat: 6 });
  assert.deepEqual(Object.keys(sonuc), ['sensor.sicaklik']);
  assert.deepEqual(sonuc['sensor.sicaklik'], [
    { t: Date.parse('2026-10-16T10:00:00+00:00'), d: 20.5 },
    { t: Date.parse('2026-10-16T11:00:00+00:00'), d: 21 },
    { t: Date.parse('2026-10-16T11:30:00+00:00'), d: null },
    { t: Date.parse('2026-10-16T11:40:00+00:00'), d: null },
  ]);
  assert.equal(o.istekler.length, 1);
  const { yol, yontem } = o.istekler[0];
  assert.equal(yontem, undefined, 'yalnız GET');
  assert.match(yol, /^\/api\/history\/period\/2026-10-16T06%3A00%3A00\.000Z\?filter_entity_id=sensor\.sicaklik&end_time=2026-10-16T12%3A00%3A00\.000Z&minimal_response&no_attributes&significant_changes_only$/);
});

test('geçmiş: en çok 7 varlık, en uzun 7 gün; 500 noktadan fazlası seyreltilir', async () => {
  const o = sahteOkuma({
    rest: {
      '/api/history/period/': () => [Array.from({ length: 2000 }, (_, i) => ({ entity_id: 'sensor.sicaklik', state: String(i), last_changed: new Date(Date.parse('2026-10-10T00:00:00Z') + i * 60_000).toISOString() }))],
    },
  });
  assert.deepEqual(await o.okuma.gecmis(Array.from({ length: 8 }, (_, i) => `sensor.s${i}`)), {});
  assert.deepEqual(await o.okuma.gecmis([]), {});
  assert.deepEqual(await o.okuma.gecmis('sensor.sicaklik'), {});
  assert.equal(o.istekler.length, 0);
  const sonuc = await o.okuma.gecmis(['sensor.sicaklik'], { saat: 24 * 30 });
  assert.equal(sonuc['sensor.sicaklik'].length, EN_COK_NOKTA);
  assert.equal(sonuc['sensor.sicaklik'].at(-1).d, 1999, 'son nokta korunur');
  assert.match(o.istekler[0].yol, /period\/2026-10-09T12%3A00%3A00\.000Z/, 'aralık 7 güne kırpıldı');
  assert.deepEqual(await o.okuma.gecmis(['sensor.sicaklik'], { baslangic: '2020-01-01T00:00:00Z', bitis: '2020-01-02T00:00:00Z' }), {}, 'bir yıldan eski aralık yok');
});

test('KAPI KURALI: kapı/pencere sınıflı ikili sensör, kapı adlı varlık, kilit ve kayıtsız alan okunamaz; ağa çıkılmaz', async () => {
  const o = sahteOkuma({ rest: { '/api/history/period/': gecmisYaniti, '/api/calendars/': [] } });
  for (const k of ['binary_sensor.on_kapi', 'binary_sensor.pencere', 'sensor.garaj_sicaklik', 'lock.on_kapi', 'camera.kapi', 'sensor.SICAKLIK', 'sensor.a/../../x']) {
    assert.deepEqual(await o.okuma.gecmis([k]), {}, k);
  }
  assert.deepEqual(await o.okuma.gecmis(['sensor.sicaklik', 'binary_sensor.on_kapi']), {}, 'bir yasak varlık bütün isteği düşürür');
  assert.deepEqual(await o.okuma.takvimEtkinlikleri('sensor.sicaklik'), [], 'takvim ucu yalnız calendar alanı');
  assert.deepEqual(await o.okuma.yapilacaklar('calendar.ev'), []);
  assert.equal(o.istekler.length, 0);
  assert.deepEqual(await o.okuma.gecmis(['binary_sensor.hareket']), { 'binary_sensor.hareket': [] }, 'hareket sensörü serbest (yanıtta yok: boş dönem)');
  assert.equal(o.istekler.length, 1);
});

test('1.4.0 cihaz grubu: cover geçmişi yalnız HA\'daki GÜNCEL perde sınıfıyla okunur; garaj sınıfı ve sınıfsız cover okunamaz', async () => {
  const o = sahteOkuma({ rest: { '/api/history/period/': gecmisYaniti } });
  for (const k of ['cover.garaj', 'cover.sinifsiz']) assert.deepEqual(await o.okuma.gecmis([k]), {}, k);
  assert.equal(o.istekler.filter((i) => i.yol.startsWith('/api/history/')).length, 0, 'yasak cover için geçmiş isteği hiç gitmez');
  const perde = await o.okuma.gecmis(['cover.perde']);
  assert.deepEqual(Object.keys(perde), ['cover.perde']);
});

test('geçmiş: boş dönem (başarılı ama kayıt yok) boş dizidir; hata ve hız sınırında anahtar hiç yoktur', async () => {
  const o = sahteOkuma({ rest: { '/api/history/period/': gecmisYaniti } });
  // yanıtta olmayan ama istenen (ve izinli) varlık: boş dizi; yanıttaki diğer seri yine döner
  const sonuc = await o.okuma.gecmis(['sensor.sicaklik', 'sensor.nem'], { saat: 6 });
  assert.deepEqual(Object.keys(sonuc).sort(), ['sensor.nem', 'sensor.sicaklik']);
  assert.deepEqual(sonuc['sensor.nem'], []);
  assert.ok(sonuc['sensor.sicaklik'].length > 0);
  // hata: anahtar yok (arayüz "alınamadı" der)
  const h = sahteOkuma({ rest: { '/api/history/period/': () => { throw Object.assign(new Error('x'), { tur: 'ag' }); } } });
  assert.deepEqual(await h.okuma.gecmis(['sensor.sicaklik']), {});
  // geçersiz yanıt (dizi değil) de hata sayılır
  const g = sahteOkuma({ rest: { '/api/history/period/': { message: 'x' } } });
  assert.deepEqual(await g.okuma.gecmis(['sensor.sicaklik']), {});
});

test('yapılacaklar: taze okuma önbelleği atlar (kullanıcı kendi değişikliğini hemen görür); hız sınırı geçerli kalır', async () => {
  let items = [{ uid: '1', summary: 'Süt', status: 'needs_action' }];
  const o = sahteOkuma({ wsYanit: { 'todo/item/list': () => ({ ok: true, sonuc: { items: structuredClone(items) } }) } });
  assert.equal((await o.okuma.yapilacaklar('todo.alisveris')).length, 1);
  items = [...items, { uid: '2', summary: 'Ekmek', status: 'needs_action' }];
  assert.equal((await o.okuma.yapilacaklar('todo.alisveris')).length, 1, 'TTL içinde önbellekten');
  assert.equal((await o.okuma.yapilacaklar('todo.alisveris', { taze: true })).length, 2, 'taze: önbellek atlanır');
  assert.equal((await o.okuma.yapilacaklar('todo.alisveris')).length, 2, 'taze sonuç önbelleğe yazılır');
  assert.equal(o.komutlar.length, 2);
  // taze de küresel dakika sınırına takılır: sınır dolunca önbellekteki son değer döner
  for (let i = 0; i < DAKIKA_SINIRI; i += 1) await o.okuma.yapilacaklar('todo.alisveris', { taze: true });
  assert.ok(o.komutlar.length <= DAKIKA_SINIRI, 'dakika sınırı aşılmaz');
});

test('güncel durum depoda yoksa REST ile alınır; HA\'da adı sonradan "kapı" olan varlık okunamaz', async () => {
  const o = sahteOkuma({ depo: false, rest: { '/api/states/sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '1', attributes: { friendly_name: 'Kapı sıcaklığı' } }, '/api/history/period/': gecmisYaniti } });
  assert.deepEqual(await o.okuma.gecmis(['sensor.sicaklik']), {});
  assert.deepEqual(o.istekler.map((i) => i.yol), ['/api/states/sensor.sicaklik']);
  assert.deepEqual(await o.okuma.gecmis(['sensor.yok']), {}, 'HA\'da bulunamayan varlık');
});

test('önbellek ve tek uçuş: aynı istek sürerken ve TTL içinde ikinci kez ağa çıkılmaz', async () => {
  let coz;
  const o = sahteOkuma({ rest: { '/api/history/period/': () => new Promise((c) => (coz = () => c(gecmisYaniti))) } });
  const a = o.okuma.gecmis(['sensor.sicaklik']);
  const b = o.okuma.gecmis(['sensor.sicaklik']);
  await akit();
  coz();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra, rb);
  assert.equal(o.istekler.length, 1);
  await o.okuma.gecmis(['sensor.sicaklik']);
  assert.equal(o.istekler.length, 1, 'TTL içinde önbellekten');
  o.ilerle(61_000);
  const c = o.okuma.gecmis(['sensor.sicaklik']);
  await akit();
  coz();
  await c;
  assert.equal(o.istekler.length, 2, 'TTL dolunca yeniden');
});

test('HA yanıt vermezse sessizce boş döner, hata önbelleğe yazılmaz; günlükte yalnız sabit metin', async () => {
  let hatali = true;
  const o = sahteOkuma({
    rest: {
      '/api/history/period/': () => {
        if (hatali) throw Object.assign(new Error('http://192.168.1.10:8123 Bearer GIZLI'), { tur: 'ag' });
        return gecmisYaniti;
      },
    },
  });
  assert.deepEqual(await o.okuma.gecmis(['sensor.sicaklik']), {});
  hatali = false;
  assert.deepEqual(Object.keys(await o.okuma.gecmis(['sensor.sicaklik'])), ['sensor.sicaklik']);
  assert.equal(o.istekler.length, 2);
  assert.ok(o.gunlukler.length >= 1);
  assert.ok(!JSON.stringify(o.gunlukler).includes('GIZLI'));
  assert.ok(!JSON.stringify(o.gunlukler).includes('192.168'));
});

test(`hız sınırı: dakikada en çok ${DAKIKA_SINIRI} ağ okuması; dakika dolunca açılır`, async () => {
  const o = sahteOkuma({ rest: { '/api/history/period/': gecmisYaniti } });
  for (let i = 0; i < DAKIKA_SINIRI; i += 1) await o.okuma.gecmis(['sensor.sicaklik'], { saat: i + 1 });
  assert.equal(o.istekler.length, DAKIKA_SINIRI);
  assert.deepEqual(await o.okuma.gecmis(['sensor.sicaklik'], { saat: 100 }), {}, 'sınırda boş');
  assert.equal(o.istekler.length, DAKIKA_SINIRI);
  o.ilerle(60_001);
  await o.okuma.gecmis(['sensor.sicaklik'], { saat: 101 });
  assert.equal(o.istekler.length, DAKIKA_SINIRI + 1);
});

test('takvim: başlık süzülür, tüm gün etkinliği, en çok 50; yalnız gerekli alanlar', async () => {
  const etkinlikler = [
    { summary: 'Dişçi', start: { dateTime: '2026-10-17T09:00:00+03:00' }, end: { dateTime: '2026-10-17T10:00:00+03:00' }, location: 'Gizli adres', description: 'x', uid: 'u' },
    { summary: 'Garaj kapısı tamiri', start: { dateTime: '2026-10-18T09:00:00+03:00' }, end: { dateTime: '2026-10-18T10:00:00+03:00' } },
    { summary: 'Tatil', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } },
    { summary: '', start: { date: '2026-10-20' } },
    { summary: 'Bozuk', start: { dateTime: 'yarın' } },
    ...Array.from({ length: 60 }, (_, i) => ({ summary: `E${i}`, start: { date: '2026-10-22' }, end: { date: '2026-10-23' } })),
  ];
  const o = sahteOkuma({ rest: { '/api/calendars/calendar.ev': etkinlikler } });
  const sonuc = await o.okuma.takvimEtkinlikleri('calendar.ev', { gun: 3 });
  assert.equal(sonuc.length, 50);
  assert.deepEqual(sonuc[0], { baslik: 'Dişçi', baslangic: '2026-10-17T09:00:00+03:00', bitis: '2026-10-17T10:00:00+03:00', tumGun: false });
  assert.deepEqual(sonuc[1], { baslik: 'Tatil', baslangic: '2026-10-20', bitis: '2026-10-21', tumGun: true });
  assert.ok(!JSON.stringify(sonuc).includes('Garaj'));
  assert.ok(!JSON.stringify(sonuc).includes('Gizli adres'));
  assert.equal(o.istekler[0].yol, '/api/calendars/calendar.ev?start=2026-10-16T12%3A00%3A00.000Z&end=2026-10-19T12%3A00%3A00.000Z');
  const uzun = sahteOkuma({ rest: { '/api/calendars/calendar.ev': [] } });
  await uzun.okuma.takvimEtkinlikleri('calendar.ev', { gun: 400 });
  assert.match(uzun.istekler[0].yol, /end=2026-11-16T12/, 'en uzun 31 gün');
});

test('hava tahmini: WS aboneliği, ilk olay alınır ve abonelik bırakılır; değerler doğrulanır', async () => {
  const o = sahteOkuma();
  const soz = o.okuma.havaTahmini('weather.ev', 'hourly');
  await akit();
  assert.equal(o.aboneler.length, 1);
  assert.deepEqual(o.aboneler[0].ileti, { type: 'weather/subscribe_forecast', entity_id: 'weather.ev', forecast_type: 'hourly' });
  o.aboneler[0].dinleyici({
    olay: {
      type: 'hourly',
      forecast: [
        { datetime: '2026-10-16T13:00:00+00:00', condition: 'rainy', temperature: 14, templow: 9, precipitation: 1.2, precipitation_probability: 80, humidity: 90, wind_speed: 12, entity_picture: 'x' },
        { datetime: 'bozuk', condition: 'lava', temperature: 9999 },
      ],
    },
  });
  const liste = await soz;
  assert.deepEqual(liste, [
    { zaman: '2026-10-16T13:00:00+00:00', durum: 'rainy', sicaklik: 14, enDusuk: 9, yagis: 1.2, yagisOlasiligi: 80, nem: 90, ruzgar: 12 },
    { zaman: null, durum: null, sicaklik: null, enDusuk: null, yagis: null, yagisOlasiligi: null, nem: null, ruzgar: null },
  ]);
  assert.equal(o.aboneler[0].birakildi, true);
  assert.equal(o.zaman.bekleyen(), 0, 'zaman aşımı temizlendi');
  await o.okuma.havaTahmini('weather.ev', 'hourly');
  assert.equal(o.aboneler.length, 1, 'önbellekten');
  assert.deepEqual(await o.okuma.havaTahmini('weather.ev', 'yearly'), []);
  assert.deepEqual(await o.okuma.havaTahmini('sensor.sicaklik'), []);
});

test('hava tahmini: yanıt gelmezse 10 sn sonra boş; unauthorized gelirse uç kapanır', async () => {
  const o = sahteOkuma();
  const soz = o.okuma.havaTahmini('weather.ev');
  await akit();
  o.zaman.hepsiniCalistir();
  assert.deepEqual(await soz, []);
  assert.equal(o.aboneler[0].birakildi, true);
  const soz2 = o.okuma.havaTahmini('weather.ev');
  await akit();
  o.aboneler[1].dinleyici({ hata: 'unauthorized' });
  assert.deepEqual(await soz2, []);
  assert.deepEqual(o.okuma.kapaliUclar(), ['hava']);
  await o.okuma.havaTahmini('weather.ev', 'twice_daily');
  assert.equal(o.aboneler.length, 2, 'kapalı uç bir daha denenmez');
  assert.deepEqual(await sahteOkuma({ wsYok: true }).okuma.havaTahmini('weather.ev'), [], 'WS yoksa boş');
});

test('alanlar: adı süzgeçten geçmeyen alan düşer; varlık alanı ya da cihaz alanı; kayıtsız alan varlıkları yok', async () => {
  const o = sahteOkuma({
    wsYanit: {
      'config/area_registry/list': { ok: true, sonuc: [{ area_id: 'salon', name: 'Salon', picture: 'x' }, { area_id: 'garaj', name: 'Garaj' }, { area_id: 'kotu id', name: 'Mutfak' }, { area_id: 'mutfak', name: 'Mutfak' }] },
      'config/entity_registry/list_for_display': {
        ok: true,
        sonuc: { entities: [{ ei: 'light.a', ai: 'salon' }, { ei: 'sensor.b', di: 'cihaz1' }, { ei: 'light.c', ai: 'garaj' }, { ei: 'lock.on', ai: 'salon' }, { ei: 'camera.kapi', ai: 'salon' }, { ei: 'cover.perde', ai: 'salon' }, { ei: 'light.d' }] },
      },
      'config/device_registry/list': { ok: true, sonuc: [{ id: 'cihaz1', area_id: 'mutfak' }] },
    },
  });
  assert.deepEqual(await o.okuma.alanlar(), {
    alanlar: [
      { id: 'salon', ad: 'Salon' },
      { id: 'mutfak', ad: 'Mutfak' },
    ],
    varlikAlanlari: { 'light.a': 'salon', 'sensor.b': 'mutfak', 'cover.perde': 'salon' }, // 1.4.0: cover kayıtlı alan (perde); kilit ve kamera kayıtsız
  });
  await o.okuma.alanlar();
  assert.equal(o.komutlar.length, 3, 'önbellekten');
});

test('alanlar: yönetici gerektiren komut unauthorized dönerse uç oturum boyunca kapanır; cihaz kaydı isteğe bağlı', async () => {
  const o = sahteOkuma({ wsYanit: { 'config/area_registry/list': { ok: false, kod: 'unauthorized' } } });
  assert.deepEqual(await o.okuma.alanlar(), { alanlar: [], varlikAlanlari: {} });
  o.ilerle(10 * 60_000);
  assert.deepEqual(await o.okuma.alanlar(), { alanlar: [], varlikAlanlari: {} });
  assert.equal(o.komutlar.length, 1);
  assert.deepEqual(o.okuma.kapaliUclar(), ['alanlar']);
  const b = sahteOkuma({
    wsYanit: {
      'config/area_registry/list': { ok: true, sonuc: [{ area_id: 'salon', name: 'Salon' }] },
      'config/entity_registry/list_for_display': { ok: true, sonuc: { entities: [{ ei: 'light.a', ai: 'salon' }] } },
      'config/device_registry/list': { ok: false, kod: 'unauthorized' },
    },
  });
  assert.deepEqual((await b.okuma.alanlar()).varlikAlanlari, { 'light.a': 'salon' });
  // bağlantı yoksa geçici: kapanmaz, sonra yeniden denenir
  const c = sahteOkuma();
  await c.okuma.alanlar();
  assert.deepEqual(c.okuma.kapaliUclar(), []);
});

test('yapılacaklar: başlık süzülür, tamamlandı bayrağı; yönetici bilgisi', async () => {
  const o = sahteOkuma({
    wsYanit: {
      'todo/item/list': (ileti) => ({ ok: true, sonuc: { items: [{ uid: '1', summary: 'Süt', status: 'needs_action', description: 'gizli' }, { uid: '2', summary: 'Kilidi yağla', status: 'needs_action' }, { uid: '3', summary: 'Ekmek', status: 'completed' }, { summary: 'uidsiz' }], ileti } }),
      'auth/current_user': { ok: true, sonuc: { is_admin: false, name: 'Emre', id: 'x' } },
    },
  });
  assert.deepEqual(await o.okuma.yapilacaklar('todo.alisveris'), [
    { uid: '1', baslik: 'Süt', tamamlandi: false },
    { uid: '3', baslik: 'Ekmek', tamamlandi: true },
  ]);
  assert.deepEqual(o.komutlar[0], { type: 'todo/item/list', entity_id: 'todo.alisveris' });
  assert.equal(await o.okuma.yoneticiMi(), false);
  assert.equal(await sahteOkuma().okuma.yoneticiMi(), null, 'bilinmiyorsa null');
});

test('bildirimler: kapı metni taşıyan bildirim hiç gösterilmez; ekle/güncelle/kaldır; unauthorized kapatır', () => {
  const o = sahteOkuma();
  const gelen = [];
  const birak = o.okuma.bildirimAboneOl((l) => gelen.push(l));
  assert.deepEqual(o.aboneler[0].ileti, { type: 'persistent_notification/subscribe' });
  const ver = (olay) => o.aboneler[0].dinleyici({ olay });
  ver({
    type: 'current',
    notifications: {
      a: { notification_id: 'a', title: 'Güncelleme', message: 'Yeni sürüm var', created_at: '2026-10-16T10:00:00+00:00' },
      b: { notification_id: 'b', title: null, message: 'Garaj kapısı açık kaldı', created_at: '2026-10-16T11:00:00+00:00' },
      c: { notification_id: 'c', title: 'Front door', message: 'ok', created_at: '2026-10-16T11:00:00+00:00' },
      'd e': { notification_id: 'd e', message: 'kötü kimlik' },
    },
  });
  assert.deepEqual(gelen.at(-1), [{ id: 'a', baslik: 'Güncelleme', metin: 'Yeni sürüm var', zaman: '2026-10-16T10:00:00+00:00' }]);
  ver({ type: 'added', notifications: { z: { notification_id: 'z', message: 'Pil zayıf', created_at: '2026-10-16T12:00:00+00:00' } } });
  assert.deepEqual(gelen.at(-1).map((b) => b.id), ['z', 'a'], 'en yeni önce');
  ver({ type: 'removed', notifications: { a: { notification_id: 'a' } } });
  assert.deepEqual(gelen.at(-1).map((b) => b.id), ['z']);
  ver({ type: 'bilinmeyen', notifications: {} });
  ver({ type: 'added', notifications: [] });
  assert.equal(gelen.length, 3, 'bozuk olay yok sayılır');
  birak();
  assert.equal(o.aboneler[0].birakildi, true);
  o.okuma.bildirimAboneOl(() => {});
  o.aboneler[1].dinleyici({ hata: 'unauthorized' });
  o.okuma.bildirimAboneOl(() => {});
  assert.equal(o.aboneler.length, 2, 'kapalı uç bir daha abone olmaz');
});

test('yuzeyOkumasi: tür ve kimlik doğrulanır; kayıtsız kimlik okunamaz; sınırlar uygulanır', async () => {
  const cagrilar = [];
  const okuma = {
    gecmis: async (k, s) => (cagrilar.push(['gecmis', k, s]), { ok: 1 }),
    takvimEtkinlikleri: async (k, s) => (cagrilar.push(['takvim', k, s]), []),
    havaTahmini: async (k, t) => (cagrilar.push(['hava', k, t]), []),
    yapilacaklar: async (k, s) => (cagrilar.push(['yapilacak', k, s]), []),
  };
  const kayitli = new Set(['sensor.sicaklik', 'calendar.ev', 'weather.ev', 'todo.alisveris']);
  const kayitliMi = (k) => kayitli.has(k);
  for (const kotu of [null, [], 'gecmis', { tur: 'servis' }, { tur: '__proto__' }, { tur: 'gecmis' }, { tur: 'gecmis', kimlikler: [] }, { tur: 'gecmis', kimlikler: Array(8).fill('sensor.sicaklik') }, { tur: 'takvim', kimlik: 'x' }, { tur: 'hava', kimlik: 5 }]) {
    assert.deepEqual(await yuzeyOkumasi(okuma, kotu, kayitliMi), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
  }
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'gecmis', kimlikler: ['sensor.sicaklik', 'sensor.baska'] }, kayitliMi), { ok: false, tur: 'kayitsiz' });
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'yapilacak', kimlik: 'todo.baska' }, kayitliMi), { ok: false, tur: 'kayitsiz' });
  assert.equal(cagrilar.length, 0);
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'gecmis', kimlikler: ['sensor.sicaklik'], saat: 1000 }, kayitliMi), { ok: true, veri: { ok: 1 } });
  await yuzeyOkumasi(okuma, { tur: 'takvim', kimlik: 'calendar.ev', gun: 3 }, kayitliMi);
  await yuzeyOkumasi(okuma, { tur: 'hava', kimlik: 'weather.ev', tahmin: 'evil' }, kayitliMi);
  await yuzeyOkumasi(okuma, { tur: 'yapilacak', kimlik: 'todo.alisveris' }, kayitliMi);
  await yuzeyOkumasi(okuma, { tur: 'yapilacak', kimlik: 'todo.alisveris', taze: true }, kayitliMi);
  await yuzeyOkumasi(okuma, { tur: 'yapilacak', kimlik: 'todo.alisveris', taze: 'evet' }, kayitliMi);
  assert.deepEqual(cagrilar, [
    ['gecmis', ['sensor.sicaklik'], { saat: 24 }],
    ['takvim', 'calendar.ev', { gun: 3 }],
    ['hava', 'weather.ev', 'daily'],
    ['yapilacak', 'todo.alisveris', { taze: false }],
    ['yapilacak', 'todo.alisveris', { taze: true }],
    ['yapilacak', 'todo.alisveris', { taze: false }],
  ]);
});
