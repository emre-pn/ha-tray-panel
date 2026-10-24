'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { haWsOlustur, PING_ARALIGI_MS, PONG_BEKLEME_MS, KURULUM_ZAMAN_ASIMI_MS } = require('../src/ha-ws');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { kesintiMi } = require('../src/lib/baglanti-bildirimi');

const ANAHTAR = 'SAHTE-ERISIM-ANAHTARI-0123456789';

function sahteZaman() {
  let t = 0;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    ilerle(ms) {
      const hedef = t + ms;
      for (;;) {
        const sira = [...bekleyenler.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, b) => a[1].bitis - b[1].bitis)[0];
        if (!sira) break;
        t = sira[1].bitis;
        bekleyenler.delete(sira[0]);
        sira[1].fn();
      }
      t = hedef;
    },
    bekleyen: () => bekleyenler.size,
  };
}
const akit = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((coz) => setImmediate(coz));
};

function sahteOrtam(secenek = {}) {
  const soketler = [];
  class SahteSoket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.gonderilen = [];
      this.kapatildi = false;
      this.dinleyiciler = {};
      soketler.push(this);
    }

    addEventListener(ad, fn) {
      (this.dinleyiciler[ad] ??= []).push(fn);
    }

    send(metin) {
      this.gonderilen.push(JSON.parse(metin));
    }

    close() {
      this.kapatildi = true;
      this.readyState = 3;
    }

    // --- sunucu tarafı ---
    yayinla(ileti) {
      for (const fn of this.dinleyiciler.message ?? []) fn({ data: typeof ileti === 'string' ? ileti : JSON.stringify(ileti) });
    }

    kopar() {
      this.readyState = 3;
      for (const fn of this.dinleyiciler.close ?? []) fn({});
    }
  }
  const zaman = sahteZaman();
  const depo = durumDeposuOlustur({ zaman, gruplamaMs: 0 });
  const gunlukler = [];
  const durumlar = [];
  const ayar = { etkin: true, anahtar: ANAHTAR, adres: 'http://192.168.1.10:8123', izlenen: ['light.a', 'switch.b'], ...secenek };
  const ws = haWsOlustur({
    WebSocketSinifi: 'sinif' in secenek ? secenek.sinif : SahteSoket,
    adresAl: secenek.adresAl ?? (async () => ayar.adres),
    anahtarAl: async () => ayar.anahtar,
    izlenen: () => ayar.izlenen,
    depo,
    etkinMi: () => ayar.etkin,
    durumDegisti: (d) => durumlar.push(d.baglanti + (d.neden ? `:${d.neden}` : '')),
    gunluk: (m) => gunlukler.push(m),
    zaman,
    tavanSn: () => 30,
    yetki: secenek.yetki ?? null,
  });
  return { ws, soketler, zaman, depo, gunlukler, durumlar, ayar };
}

const varlik = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: {}, ...ek });

/** Bağlantıyı abone + anlık görüntü adımlarına kadar sürer. */
async function canliYap(o, { durumlar = [varlik('light.a', 'on'), varlik('switch.b', 'off'), varlik('light.baska', 'on')] } = {}) {
  o.ws.baslat();
  await akit();
  const s = o.soketler.at(-1);
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  const abone = s.gonderilen.find((m) => m.type === 'subscribe_trigger');
  s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  const iste = s.gonderilen.find((m) => m.type === 'get_states');
  s.yayinla({ id: iste.id, type: 'result', success: true, result: durumlar });
  return { s, aboneId: abone.id };
}

test('mutlu yol: auth -> subscribe_trigger -> get_states -> canlı; yalnız izlenenler depoya girer', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  assert.equal(s.url, 'ws://192.168.1.10:8123/api/websocket');
  assert.deepEqual(s.gonderilen[0], { type: 'auth', access_token: ANAHTAR });
  const abone = s.gonderilen.find((m) => m.type === 'subscribe_trigger');
  assert.deepEqual(abone.trigger, { platform: 'state', entity_id: ['light.a', 'switch.b'] });
  assert.equal(o.ws.canliMi(), true);
  assert.deepEqual(o.ws.durum(), { baglanti: 'canli', canli: true, neden: null });
  assert.equal(o.depo.al('light.a').state, 'on');
  assert.equal(o.depo.al('switch.b').state, 'off');
  assert.equal(o.depo.al('light.baska'), undefined, 'izlenmeyen varlık depoya girmez');
  assert.deepEqual(o.durumlar, ['baglaniyor', 'canli']);
});

test('GÜVENLİK: erişim anahtarı yalnız auth iletisinde; günlükte, durumda ve diğer iletilerde yok', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  o.ws.askiyaAl();
  await o.zaman.ilerle(1000);
  const anahtarli = s.gonderilen.filter((m) => JSON.stringify(m).includes(ANAHTAR));
  assert.equal(anahtarli.length, 1);
  assert.equal(anahtarli[0].type, 'auth');
  assert.ok(!JSON.stringify(o.gunlukler).includes(ANAHTAR));
  assert.ok(!JSON.stringify(o.durumlar).includes(ANAHTAR));
  assert.ok(!JSON.stringify(o.ws.durum()).includes(ANAHTAR));
});

test('olaylar: subscribe_trigger olayı depoya yazılır; eski olay ezmez; izlenmeyen yok sayılır; null durum kaldırır', async () => {
  const o = sahteOrtam();
  const { s, aboneId } = await canliYap(o, { durumlar: [varlik('light.a', 'on', { last_updated: '2026-10-06T10:00:05+00:00' }), varlik('switch.b', 'off')] });
  const olay = (kimlik, yeni) => s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: kimlik, to_state: yeni } } } });
  olay('light.a', varlik('light.a', 'off', { last_updated: '2026-10-06T10:00:09+00:00' }));
  assert.equal(o.depo.al('light.a').state, 'off');
  olay('light.a', varlik('light.a', 'on', { last_updated: '2026-10-06T10:00:01+00:00' }));
  assert.equal(o.depo.al('light.a').state, 'off', 'eski olay yeniyi ezmedi');
  olay('light.baska', varlik('light.baska', 'on'));
  assert.equal(o.depo.al('light.baska'), undefined);
  olay('switch.b', null);
  assert.equal(o.depo.al('switch.b'), null);
  s.yayinla({ id: aboneId + 99, type: 'event', event: { variables: { trigger: { entity_id: 'light.a', to_state: varlik('light.a', 'on') } } } });
  assert.equal(o.depo.al('light.a').state, 'off', 'başka abonelik kimliği yok sayılır');
});

test('trigger aboneliği reddedilirse subscribe_events (state_changed) denenir; olaylar istemcide süzülür', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  const trig = s.gonderilen.find((m) => m.type === 'subscribe_trigger');
  s.yayinla({ id: trig.id, type: 'result', success: false, error: { code: 'unknown_command' } });
  const olay = s.gonderilen.find((m) => m.type === 'subscribe_events');
  assert.equal(olay.event_type, 'state_changed');
  s.yayinla({ id: olay.id, type: 'result', success: true, result: null });
  const iste = s.gonderilen.find((m) => m.type === 'get_states');
  s.yayinla({ id: iste.id, type: 'result', success: true, result: [varlik('light.a', 'on')] });
  assert.equal(o.ws.canliMi(), true);
  s.yayinla({ id: olay.id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.a', new_state: varlik('light.a', 'off') } } });
  s.yayinla({ id: olay.id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'sensor.baska', new_state: varlik('sensor.baska', '5') } } });
  assert.equal(o.depo.al('light.a').state, 'off');
  assert.equal(o.depo.al('sensor.baska'), undefined);
});

test('iki abonelik de reddedilirse REST yedeğine geçilir ve yeniden denenmez', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: false });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_events').id, type: 'result', success: false });
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'abonelik-yok' });
  assert.equal(s.kapatildi, true);
  o.zaman.ilerle(120_000);
  await akit();
  assert.equal(o.soketler.length, 1, 'yeniden denenmez');
});

test('auth_invalid: yeniden denenmez (anahtar reddedildi), REST yedeği, günlükte anahtar yok', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_invalid', message: 'Invalid access token' });
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'yetki' });
  o.zaman.ilerle(300_000);
  await akit();
  assert.equal(o.soketler.length, 1);
  assert.ok(!JSON.stringify(o.gunlukler).includes(ANAHTAR));
  // anahtar yeniden kaydedilince (yenidenBaglan) yeniden denenir
  o.ws.yenidenBaglan();
  await akit();
  assert.equal(o.soketler.length, 2);
});

test('bağlantı kopunca 2, 4, 8 sn artan beklemeyle yeniden dener; 3 başarısızlıktan sonra yedek; başarıda canlı ve sayaç sıfır', async () => {
  const o = sahteOrtam();
  await canliYap(o);
  o.soketler[0].kopar();
  assert.equal(o.ws.durum().baglanti, 'baglaniyor');
  o.zaman.ilerle(1999);
  await akit();
  assert.equal(o.soketler.length, 1);
  o.zaman.ilerle(1);
  await akit();
  assert.equal(o.soketler.length, 2, '2 sn sonra');
  o.soketler[1].kopar();
  o.zaman.ilerle(3999);
  await akit();
  assert.equal(o.soketler.length, 2);
  o.zaman.ilerle(1);
  await akit();
  assert.equal(o.soketler.length, 3, '4 sn sonra');
  o.soketler[2].kopar();
  assert.equal(o.ws.durum().baglanti, 'yedek', '3 ardışık başarısızlık: REST yedeği');
  o.zaman.ilerle(8000);
  await akit();
  assert.equal(o.soketler.length, 4, '8 sn sonra');
  // başarılı bağlantı: canlı + sayaç sıfır
  const s = o.soketler[3];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [] });
  assert.equal(o.ws.canliMi(), true);
  s.kopar();
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 5, 'sayaç sıfırlandı: yine 2 sn');
});

test('eski soketin geç gelen olayları yeni bağlantıyı bozmaz', async () => {
  const o = sahteOrtam();
  const { s, aboneId } = await canliYap(o);
  s.kopar();
  o.zaman.ilerle(2000);
  await akit();
  s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { entity_id: 'light.a', to_state: varlik('light.a', 'off') } } } });
  s.kopar(); // ikinci kapanış olayı: ikinci yeniden deneme planlamaz
  o.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS - 1000); // yeni soketin kurulum bekçisi (zaman aşımı) dolmadan
  await akit();
  assert.equal(o.soketler.length, 2);
  assert.equal(o.depo.al('light.a').state, 'on');
});

test('ping: 25 sn sonra ping gider; pong gelirse sürer; 10 sn pong gelmezse bağlantı yeniden kurulur', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  o.zaman.ilerle(PING_ARALIGI_MS);
  const ping = s.gonderilen.filter((m) => m.type === 'ping');
  assert.equal(ping.length, 1);
  s.yayinla({ id: ping[0].id, type: 'pong' });
  o.zaman.ilerle(PONG_BEKLEME_MS + 1);
  assert.equal(o.ws.canliMi(), true, 'pong geldi: kopmadı');
  o.zaman.ilerle(PING_ARALIGI_MS - PONG_BEKLEME_MS - 1);
  const ping2 = s.gonderilen.filter((m) => m.type === 'ping');
  assert.equal(ping2.length, 2);
  o.zaman.ilerle(PONG_BEKLEME_MS);
  assert.equal(s.kapatildi, true, 'pong gelmedi: soket kapatıldı');
  assert.equal(o.ws.durum().baglanti, 'baglaniyor');
  assert.equal(o.ws.durum().neden, 'pong-yok');
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 2);
});

test('WebSocket yoksa REST yedeği (soket denenmez)', async () => {
  const o = sahteOrtam({ sinif: null }); // null: varsayılan globalThis.WebSocket'e düşmesin (gerçek ağ denemesi olmasın)
  await o.ws.baslat();
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'ws-yok' });
  assert.equal(o.soketler.length, 0);
});

test('anahtar yoksa soket açılmaz ve adres bile sorulmaz; ayar kapalıysa bağlanılmaz', async () => {
  const o = sahteOrtam({ anahtar: null });
  await o.ws.baslat();
  assert.deepEqual(o.ws.durum(), { baglanti: 'kapali', canli: false, neden: 'anahtar-yok' });
  assert.equal(o.soketler.length, 0);
  const k = sahteOrtam({ etkin: false });
  await k.ws.baslat();
  assert.equal(k.ws.durum().baglanti, 'kapali');
  assert.equal(k.soketler.length, 0);
});

test('GÜVENLİK: ev ağı dışındaki http adresine anahtar gönderilmez (soket bile açılmaz); https adresi wss olur', async () => {
  const o = sahteOrtam({ adres: 'http://ha.example.com' });
  await o.ws.baslat();
  assert.equal(o.soketler.length, 0);
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'adres-guvenli-degil' });
  const h = sahteOrtam({ adres: 'https://ha.example.com' });
  await h.ws.baslat();
  assert.equal(h.soketler[0].url, 'wss://ha.example.com/api/websocket');
});

test('adres alınamazsa (HA ulaşılamıyor) artan beklemeyle yeniden dener; yedek 3. başarısızlıktan sonra', async () => {
  const o = sahteOrtam({ adres: null });
  await o.ws.baslat();
  assert.equal(o.ws.durum().baglanti, 'baglaniyor');
  o.zaman.ilerle(2000);
  await akit();
  o.zaman.ilerle(4000);
  await akit();
  assert.equal(o.ws.durum().baglanti, 'yedek');
  assert.equal(o.soketler.length, 0);
});

test('askiyaAl soketi kapatır ve yeniden denemez; yenidenBaglan hemen bağlanır; durdur tümüyle durdurur', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  o.ws.askiyaAl();
  assert.equal(s.kapatildi, true);
  s.kopar();
  o.zaman.ilerle(120_000);
  await akit();
  assert.equal(o.soketler.length, 1, 'askıdayken yeniden deneme yok');
  o.ws.yenidenBaglan();
  await akit();
  assert.equal(o.soketler.length, 2, 'uyanışta hemen');
  o.ws.durdur();
  assert.equal(o.ws.durum().baglanti, 'kapali');
  o.soketler[1].kopar();
  o.zaman.ilerle(120_000);
  await akit();
  assert.equal(o.soketler.length, 2, 'durdurulunca yeniden deneme yok');
  assert.equal(o.zaman.bekleyen(), 0);
});

test('bozuk/aşırı büyük iletiler yok sayılır, bağlantı kopmaz', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  s.yayinla('{bozuk');
  s.yayinla('[]');
  s.yayinla('x'.repeat(5 * 1024 * 1024));
  s.yayinla({ type: 'bilinmeyen' });
  assert.equal(o.ws.canliMi(), true);
});

test('kurulum zaman aşımı: sessiz kalan sunucu/proxy (101 verip yanıt vermeyen) 15 sn sonra kesilir ve yeniden denenir; yedek 3. başarısızlıktan sonra', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 1);
  o.soketler[0].yayinla({ type: 'auth_required' }); // auth gider ama auth_ok hiç gelmez
  o.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS - 1);
  assert.equal(o.ws.durum().baglanti, 'baglaniyor');
  assert.equal(o.soketler[0].kapatildi, false);
  o.zaman.ilerle(1);
  assert.equal(o.soketler[0].kapatildi, true, 'soket kapatıldı');
  assert.equal(o.ws.durum().neden, 'zaman-asimi');
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 2, 'artan beklemeyle yeniden denendi');
  o.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS);
  o.zaman.ilerle(4000);
  await akit();
  o.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS);
  assert.equal(o.ws.durum().baglanti, 'yedek', '3 ardışık zaman aşımı: REST yedeği (denemeler sürer)');
});

test('kurulum zaman aşımı: get_states yanıtı hiç gelmezse (abonelik tamam) da kesilir; canlı olunca bekçi durur', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  o.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS);
  assert.equal(o.ws.durum().neden, 'zaman-asimi');

  const iyi = sahteOrtam();
  await canliYap(iyi);
  assert.equal(iyi.ws.canliMi(), true);
  iyi.zaman.ilerle(KURULUM_ZAMAN_ASIMI_MS + 1000); // ilk ping (25 sn) öncesinde, kurulum süresini aşan bir an
  assert.equal(iyi.ws.canliMi(), true, 'canlıyken kurulum bekçisi bağlantıyı kesmez');
  assert.equal(iyi.soketler.length, 1);
});

test('sınırı aşan get_states yanıtı (4 MB üstü) kurulum sırasında sessizce yutulmaz: bağlantı yeniden denenmez, REST yedeğine geçilir', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s.yayinla('x'.repeat(5 * 1024 * 1024)); // get_states yanıtı sınırı aştı
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'ileti-cok-buyuk' });
  assert.equal(s.kapatildi, true);
  assert.ok(o.gunlukler.some((m) => /boyut sınırını aştı/.test(m)));
  o.zaman.ilerle(120_000);
  await akit();
  assert.equal(o.soketler.length, 1, 'aynı yanıt yine gelecek: yeniden deneme yok');
  o.ws.yenidenBaglan(); // anahtar/adres/izlenen küme değişince yine denenir
  await akit();
  assert.equal(o.soketler.length, 2);
});

test('get_states bozuk dönerse bağlantı yeniden kurulur', async () => {
  const o = sahteOrtam();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: 'bozuk' });
  assert.equal(o.ws.canliMi(), false);
  assert.equal(o.ws.durum().neden, 'durumlar-hatasi');
});

test('izlenen küme boşsa abone olunmaz (yedek)', async () => {
  const o = sahteOrtam({ izlenen: [] });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  assert.equal(s.gonderilen.some((m) => m.type === 'subscribe_trigger'), false);
  assert.equal(o.ws.durum().baglanti, 'yedek');
});

test('abonelikYenile: canlı bağlantıda soketi kapatmadan eski aboneliği siler ve yeni kümeye abone olur', async () => {
  const o = sahteOrtam({ izlenen: ['light.a'] });
  const { s, aboneId } = await canliYap(o, { durumlar: [varlik('light.a', 'on')] });
  assert.equal(o.ws.canliMi(), true);
  assert.equal(o.soketler.length, 1);

  o.ayar.izlenen = ['light.a', 'light.b'];
  o.ws.abonelikYenile();
  assert.equal(o.soketler.length, 1, 'soket kapatılmadı, aynı soket kullanıldı');

  const sil = s.gonderilen.find((m) => m.type === 'unsubscribe_events');
  assert.ok(sil, 'eski abonelik silindi');
  assert.equal(sil.subscription, aboneId);

  const yeniAbone = s.gonderilen.filter((m) => m.type === 'subscribe_trigger').at(-1);
  assert.ok(yeniAbone, 'yeni trigger abonesi gönderildi');
  assert.deepEqual(yeniAbone.trigger.entity_id, ['light.a', 'light.b']);

  s.yayinla({ id: yeniAbone.id, type: 'result', success: true });
  const yeniDurumlar = s.gonderilen.filter((m) => m.type === 'get_states').at(-1);
  assert.ok(yeniDurumlar, 'yeni durumlar istendi');
  s.yayinla({ id: yeniDurumlar.id, type: 'result', success: true, result: [varlik('light.a', 'on'), varlik('light.b', 'off')] });
  assert.equal(o.depo.al('light.b')?.state, 'off');
});

test('abonelikYenile peş peşe (aynı turda): ilk yenilemenin aboneliği yanıtı gelince silinir, yalnız sonuncusu kalır (HA\'da sızıntı yok)', async () => {
  const o = sahteOrtam({ izlenen: ['light.a'] });
  const { s, aboneId } = await canliYap(o, { durumlar: [varlik('light.a', 'on')] });
  const sayim = (tur) => s.gonderilen.filter((m) => m.type === tur);
  const durumSayisi = sayim('get_states').length;

  o.ayar.izlenen = ['light.a', 'light.b'];
  o.ws.abonelikYenile();
  o.ayar.izlenen = ['light.a', 'light.b', 'light.c']; // aynı ayar kaydı birden çok izlenen alanı değiştirdi: ikinci çağrı yanıt gelmeden
  o.ws.abonelikYenile();
  const [b, c] = sayim('subscribe_trigger').slice(-2);
  assert.notEqual(b.id, c.id);
  assert.deepEqual(sayim('unsubscribe_events').map((m) => m.subscription), [aboneId], 'ilk çağrı eskiyi (canlıdaki) sildi; ikinci çağrıda silinecek kurulmuş abonelik yok');

  s.yayinla({ id: b.id, type: 'result', success: true, result: null });
  assert.deepEqual(sayim('unsubscribe_events').map((m) => m.subscription), [aboneId, b.id], 'yerini yenisine bırakan abonelik hemen silindi');
  assert.equal(sayim('get_states').length, durumSayisi, 'eski aboneliğin yanıtı durum istemez');

  s.yayinla({ id: c.id, type: 'result', success: true, result: null });
  assert.equal(sayim('get_states').length, durumSayisi + 1, 'yalnız sonuncunun yanıtı durum ister');
  assert.deepEqual(sayim('unsubscribe_events').map((m) => m.subscription), [aboneId, b.id], 'sonuncusu silinmedi');
  s.yayinla({ id: sayim('get_states').at(-1).id, type: 'result', success: true, result: [varlik('light.a', 'on'), varlik('light.b', 'off'), varlik('light.c', 'on')] });
  assert.equal(o.ws.canliMi(), true);
  assert.equal(o.soketler.length, 1);

  // olaylar yalnız son aboneliğin kimliğiyle işlenir
  s.yayinla({ id: c.id, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.c', to_state: varlik('light.c', 'off') } } } });
  assert.equal(o.depo.al('light.c').state, 'off');
  s.yayinla({ id: b.id, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.c', to_state: varlik('light.c', 'on') } } } });
  assert.equal(o.depo.al('light.c').state, 'off');
});

test('abonelikYenile: yanıtlar ters sırada gelse de eski abonelik silinir, sonuncusu aktif kalır; reddedilen eski abonelik olay aboneliğine geçirmez', async () => {
  const o = sahteOrtam({ izlenen: ['light.a'] });
  const { s } = await canliYap(o, { durumlar: [varlik('light.a', 'on')] });
  const sayim = (tur) => s.gonderilen.filter((m) => m.type === tur);
  o.ws.abonelikYenile();
  o.ws.abonelikYenile();
  const [b, c] = sayim('subscribe_trigger').slice(-2);
  s.yayinla({ id: c.id, type: 'result', success: true, result: null });
  const durumSayisi = sayim('get_states').length;
  s.yayinla({ id: b.id, type: 'result', success: true, result: null });
  assert.equal(sayim('unsubscribe_events').at(-1).subscription, b.id);
  assert.equal(sayim('get_states').length, durumSayisi);
  s.yayinla({ id: sayim('get_states').at(-1).id, type: 'result', success: true, result: [varlik('light.a', 'on')] });
  s.yayinla({ id: c.id, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.a', to_state: varlik('light.a', 'off') } } } });
  assert.equal(o.depo.al('light.a').state, 'off', 'sonuncu abonelik olay işler');

  // eski istek reddedilirse (ör. üç yenileme peş peşe) trigger->olay yedeğine geçilmez: sonuç yenisinin yanıtına bağlıdır
  o.ws.abonelikYenile();
  o.ws.abonelikYenile();
  const [d, e] = sayim('subscribe_trigger').slice(-2);
  s.yayinla({ id: d.id, type: 'result', success: false, error: { code: 'unknown_error', message: 'x' } });
  assert.equal(sayim('subscribe_events').length, 0, 'eski reddi olay aboneliği açmaz');
  s.yayinla({ id: e.id, type: 'result', success: true, result: null });
  assert.equal(o.ws.canliMi(), true);
  assert.equal(sayim('unsubscribe_events').some((m) => m.subscription === d.id), false, 'kurulmamış aboneliğin silinmesi istenmez');
});

test('h-17: auth_ok gelip get_states hep başarısız olursa bekleme büyür (2, 4, 8 sn) ve 3. denemede REST yedeğine geçilir', async () => {
  const o = sahteOrtam();
  const authSonrasiDus = (s) => {
    s.yayinla({ type: 'auth_required' });
    s.yayinla({ type: 'auth_ok' });
    s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
    s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: false });
  };
  o.ws.baslat();
  await akit();
  authSonrasiDus(o.soketler[0]);
  assert.equal(o.ws.durum().neden, 'durumlar-hatasi');
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 2, 'ilk yeniden deneme 2 sn sonra');
  authSonrasiDus(o.soketler[1]);
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 2, 'auth_ok sayacı sıfırlamadı: ikinci bekleme 2 sn DEĞİL');
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 3, 'ikinci bekleme 4 sn');
  authSonrasiDus(o.soketler[2]);
  assert.equal(o.ws.durum().baglanti, 'yedek', '3 ardışık başarısız kurulum: REST yedeği');
  o.zaman.ilerle(7999);
  await akit();
  assert.equal(o.soketler.length, 3);
  o.zaman.ilerle(1);
  await akit();
  assert.equal(o.soketler.length, 4, 'üçüncü bekleme 8 sn');
  // gerçekten canlı olunca sayaç sıfırlanır: sonraki kopmada yine 2 sn
  const s = o.soketler[3];
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [] });
  assert.equal(o.ws.canliMi(), true);
  s.kopar();
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 5, 'canlıya geçince sayaç sıfırlandı');
});

test('h-18: get_states tam listesinde bulunmayan izlenen varlık (HA\'dan silinmiş) daha önce bilinse de "yok" olur', async () => {
  const o = sahteOrtam({ izlenen: ['light.a', 'switch.b'] });
  const { s } = await canliYap(o, { durumlar: [varlik('light.a', 'on'), varlik('switch.b', 'on')] });
  assert.equal(o.depo.al('switch.b').state, 'on');
  // HA'da switch.b silinip yeniden başlatıldı: yeniden bağlanınca tam listede yok
  s.kopar();
  o.zaman.ilerle(2000);
  await akit();
  const s2 = o.soketler.at(-1);
  s2.yayinla({ type: 'auth_required' });
  s2.yayinla({ type: 'auth_ok' });
  s2.yayinla({ id: s2.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s2.yayinla({ id: s2.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [varlik('light.a', 'off'), varlik('sensor.baska', '1')] });
  assert.equal(o.depo.al('light.a').state, 'off');
  assert.equal(o.depo.al('switch.b'), null, 'silinen varlık eski durumuyla kalmaz');
});

test('h-18: get_states listesinde olup durumu bozuk biçimli izlenen varlık "yok" sayılmaz (bilinen durum korunur)', async () => {
  const o = sahteOrtam({ izlenen: ['light.a', 'switch.b'] });
  const { s } = await canliYap(o, { durumlar: [varlik('light.a', 'on'), varlik('switch.b', 'on')] });
  s.kopar();
  o.zaman.ilerle(2000);
  await akit();
  const s2 = o.soketler.at(-1);
  s2.yayinla({ type: 'auth_required' });
  s2.yayinla({ type: 'auth_ok' });
  s2.yayinla({ id: s2.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s2.yayinla({ id: s2.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [varlik('light.a', 'on'), { entity_id: 'switch.b' }] });
  assert.equal(o.depo.al('switch.b').state, 'on');
});

test('h-08: canlı bağlantı koptuğunda yetki köprüsüne "canlıydı" bilgisi verilir (adres seçimi unutulsun); kurulumda kopmada false', async () => {
  const koptular = [];
  const yetki = {
    parmakIzi: () => 'a'.repeat(16),
    reddedildiMi: () => false,
    engelliMi: () => false,
    gecit: async () => {},
    reddedildi: () => {},
    koptu: (canliydi) => koptular.push(canliydi),
  };
  const o = sahteOrtam({ yetki });
  o.ws.baslat();
  await akit();
  const s = o.soketler.at(-1);
  s.yayinla({ type: 'auth_required' });
  await akit();
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [] });
  assert.equal(o.ws.canliMi(), true);
  s.kopar();
  assert.deepEqual(koptular, [true], 'canlı bağlantı koptu');
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 2);
  o.soketler.at(-1).kopar(); // kurulum sırasında kopma: canlı değildi
  assert.deepEqual(koptular, [true, false]);
});

test('B3: kesici "dogrulanamadi" derken engelliMi de true ise kalıcı yedek olur: "duraklatildi" geri çekilme döngüsü, adres yoklaması ve kesinti sayımı yok', async () => {
  let adresIstegi = 0;
  const yetki = {
    parmakIzi: () => 'a'.repeat(16),
    reddedildiMi: () => false,
    dogrulanamadiMi: () => true,
    engelliMi: () => true, // gerçek kesici karar().izin:false'u da bekletme sayar
    gecit: async () => assert.fail('geçide girilmemeli'),
    reddedildi: () => {},
    koptu: () => {},
  };
  const o = sahteOrtam({ yetki, adresAl: async () => { adresIstegi += 1; return 'https://ha.example'; } });
  o.ws.baslat();
  await akit();
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'dogrulanamadi' });
  assert.equal(kesintiMi(o.ws.durum()), false);
  assert.equal(adresIstegi, 0, 'adres yoklaması yok');
  assert.equal(o.zaman.bekleyen(), 0, 'yeniden bağlanma zamanlayıcısı kurulmadı');
  o.zaman.ilerle(10 * 60_000);
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'dogrulanamadi' });
});

test('abonelikYenile: canlı değilken yenidenBaglan gibi davranır', async () => {
  const o = sahteOrtam({ izlenen: ['light.a'] });
  assert.equal(o.ws.canliMi(), false);
  o.ws.abonelikYenile();
  await akit();
  assert.equal(o.soketler.length, 1, 'soket açıldı');
});

// --- 1.4.0: okuma komutları (komut) ve okuma abonelikleri (abone) ----------------------------------------------

/** Kopan bağlantının 2 sn sonra açılan yeni soketini canlıya taşır. */
async function yenidenCanli(o) {
  o.zaman.ilerle(2000);
  await akit();
  const s = o.soketler.at(-1);
  s.yayinla({ type: 'auth_required' });
  s.yayinla({ type: 'auth_ok' });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'subscribe_trigger').id, type: 'result', success: true, result: null });
  s.yayinla({ id: s.gonderilen.find((m) => m.type === 'get_states').id, type: 'result', success: true, result: [] });
  return s;
}

test('komut: yalnız canlıyken ve yalnız izinli okuma komutu gönderilir; sonuç id ile eşleşir', async () => {
  const o = sahteOrtam();
  assert.deepEqual(await o.ws.komut({ type: 'config/area_registry/list' }), { ok: false, kod: 'baglanti-yok' }, 'canlı değilken ağa çıkmaz');
  const { s } = await canliYap(o);
  const kurulumIletisi = s.gonderilen.length;
  for (const kotu of [
    { type: 'call_service', domain: 'lock', service: 'unlock' },
    { type: 'execute_script' },
    { type: 'auth/current_user', id: 5 },
    { type: 'todo/item/list', entity_id: { x: 1 } },
    { type: 'todo/item/list', 'Bad-Key': 1 },
    { type: 'todo/item/list', entity_id: 'x'.repeat(2000) },
    { type: 'persistent_notification/subscribe' },
    null,
    'auth/current_user',
  ]) {
    assert.deepEqual(await o.ws.komut(kotu), { ok: false, kod: 'izinsiz-komut' }, JSON.stringify(kotu)?.slice(0, 60));
  }
  assert.equal(s.gonderilen.length, kurulumIletisi, 'izinsiz komut ağa çıkmadı');
  const soz = o.ws.komut({ type: 'todo/item/list', entity_id: 'todo.alisveris' });
  const giden = s.gonderilen.at(-1);
  assert.deepEqual(Object.keys(giden).sort(), ['entity_id', 'id', 'type']);
  s.yayinla({ id: giden.id + 50, type: 'result', success: true, result: { items: ['yanlis'] } });
  s.yayinla({ id: giden.id, type: 'result', success: true, result: { items: [] } });
  assert.deepEqual(await soz, { ok: true, sonuc: { items: [] } });
  const hata = o.ws.komut({ type: 'config/area_registry/list' });
  s.yayinla({ id: s.gonderilen.at(-1).id, type: 'result', success: false, error: { code: 'unauthorized', message: 'x' } });
  assert.deepEqual(await hata, { ok: false, kod: 'unauthorized' });
  assert.equal(o.ws.canliMi(), true, 'komut hatası bağlantıyı etkilemez');
  assert.ok(!JSON.stringify(s.gonderilen.filter((m) => m.type !== 'auth')).includes(ANAHTAR));
});

test('komut: zaman aşımında ve kopuşta söz asılı kalmaz; bekleyen sınırı aşılmaz', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  const zaman = o.ws.komut({ type: 'auth/current_user' }, { zamanAsimiMs: 500 });
  o.zaman.ilerle(600);
  assert.deepEqual(await zaman, { ok: false, kod: 'zaman-asimi' });
  const sozler = Array.from({ length: 16 }, () => o.ws.komut({ type: 'auth/current_user' }));
  assert.deepEqual(await o.ws.komut({ type: 'auth/current_user' }), { ok: false, kod: 'cok-sik' });
  s.kopar();
  for (const soz of sozler) assert.deepEqual(await soz, { ok: false, kod: 'koptu' });
});

test('abone: canlı olunca kurulur, olaylar dinleyiciye gider, yeniden bağlanınca yenilenir; bırakınca silinir', async () => {
  const o = sahteOrtam();
  const gelen = [];
  const birak = o.ws.abone({ type: 'persistent_notification/subscribe' }, (y) => gelen.push(y));
  assert.equal(typeof birak, 'function');
  const { s } = await canliYap(o);
  const abone = s.gonderilen.find((m) => m.type === 'persistent_notification/subscribe');
  assert.ok(abone, 'canlıya geçince gönderildi');
  s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  s.yayinla({ id: abone.id, type: 'event', event: { type: 'current', notifications: {} } });
  s.yayinla({ id: abone.id, type: 'event', event: 'bozuk' });
  assert.deepEqual(gelen, [{ olay: { type: 'current', notifications: {} } }]);
  s.kopar();
  const s2 = await yenidenCanli(o);
  assert.notEqual(s2, s);
  const abone2 = s2.gonderilen.find((m) => m.type === 'persistent_notification/subscribe');
  assert.ok(abone2, 'yeniden kuruldu');
  s2.yayinla({ id: abone2.id, type: 'event', event: { type: 'added', notifications: {} } });
  assert.equal(gelen.length, 2);
  birak();
  const sil = s2.gonderilen.at(-1);
  assert.deepEqual([sil.type, sil.subscription], ['unsubscribe_events', abone2.id]);
  s2.yayinla({ id: abone2.id, type: 'event', event: { type: 'added', notifications: {} } });
  assert.equal(gelen.length, 2, 'bırakılınca olay gelmez');
  birak();
});

test('abone: izinsiz tür etkisiz; unknown_command / unauthorized kalıcı olarak düşer ve dinleyiciye hata verir', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  const kurulumIletisi = s.gonderilen.length;
  o.ws.abone({ type: 'subscribe_events', event_type: 'call_service' }, () => {})();
  o.ws.abone({ type: 'config/area_registry/list' }, () => {});
  o.ws.abone({ type: 'persistent_notification/subscribe' }, 'dinleyici değil');
  assert.equal(s.gonderilen.length, kurulumIletisi);
  const gelen = [];
  o.ws.abone({ type: 'weather/subscribe_forecast', entity_id: 'weather.ev', forecast_type: 'daily' }, (y) => gelen.push(y));
  const abone = s.gonderilen.at(-1);
  assert.equal(abone.type, 'weather/subscribe_forecast');
  s.yayinla({ id: abone.id, type: 'result', success: false, error: { code: 'unknown_command' } });
  assert.deepEqual(gelen, [{ hata: 'unknown_command' }]);
  s.kopar();
  const s2 = await yenidenCanli(o);
  assert.equal(s2.gonderilen.some((m) => m.type === 'weather/subscribe_forecast'), false, 'kalıcı ret yeniden denenmez');
});

test('abone: dinleyici fırlatırsa bağlantı etkilenmez', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  o.ws.abone({ type: 'persistent_notification/subscribe' }, () => {
    throw new Error('dinleyici');
  });
  const abone = s.gonderilen.at(-1);
  s.yayinla({ id: abone.id, type: 'event', event: { type: 'current', notifications: {} } });
  assert.equal(o.ws.canliMi(), true);
});


test('o-61: mobile_app bildirim kanalı aboneliği kurulur, olay dinleyiciye gider, not_found hatası dinleyiciye bildirilir', async () => {
  const o = sahteOrtam();
  const { s } = await canliYap(o);
  const gelen = [];
  const birak = o.ws.abone({ type: 'mobile_app/push_notification_channel', webhook_id: 'ab12cd34ef56ab12cd34ef56ab12cd34', support_confirm: false }, (y) => gelen.push(y));
  const abone = s.gonderilen.at(-1);
  assert.deepEqual({ ...abone, id: 0 }, { id: 0, type: 'mobile_app/push_notification_channel', webhook_id: 'ab12cd34ef56ab12cd34ef56ab12cd34', support_confirm: false });
  s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  s.yayinla({ id: abone.id, type: 'event', event: { message: 'Merhaba', title: 'Başlık' } });
  assert.deepEqual(gelen, [{ olay: { message: 'Merhaba', title: 'Başlık' } }]);
  s.yayinla({ id: abone.id, type: 'event', event: [1, 2] });
  assert.equal(gelen.length, 1, 'nesne olmayan olay dinleyiciye gitmez');
  birak();
  s.yayinla({ id: abone.id, type: 'event', event: { message: 'bırakıldıktan sonra' } });
  assert.equal(gelen.length, 1);

  const hatalar = [];
  const birak2 = o.ws.abone({ type: 'mobile_app/push_notification_channel', webhook_id: 'ab12cd34ef56ab12cd34ef56ab12cd34', support_confirm: false }, (y) => hatalar.push(y));
  const abone2 = s.gonderilen.at(-1);
  s.yayinla({ id: abone2.id, type: 'result', success: false, error: { code: 'not_found', message: 'gizli ayrıntı webhook' } });
  assert.deepEqual(hatalar, [{ hata: 'not_found' }], 'hata iletisi (message) alınmaz');
  birak2();
});

test('izleniyorMu: yalnız aboneliğin izlenen kümesindeki kimlikler için true (eylem katmanı bayat depo kaydına güvenmesin)', async () => {
  const o = sahteOrtam();
  assert.equal(o.ws.izleniyorMu('light.a'), false, 'abone olmadan küme boş');
  await canliYap(o);
  assert.equal(o.ws.izleniyorMu('light.a'), true);
  assert.equal(o.ws.izleniyorMu('switch.b'), true);
  assert.equal(o.ws.izleniyorMu('light.baska'), false, 'izlenmeyen varlık: olayları depoya işlenmez');
  o.ayar.izlenen = ['light.a', 'light.baska'];
  o.ws.abonelikYenile();
  assert.equal(o.ws.izleniyorMu('light.baska'), true);
  assert.equal(o.ws.izleniyorMu('switch.b'), false);
});
