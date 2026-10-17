'use strict';

/**
 * o-61: ha-istemcisi.js webhookGonder (mobile_app bildirim eylemi). Sahte fetch ile; gerçek ağ, gerçek webhook kimliği ve gerçek anahtar yok.
 * Kurallar: Authorization yok, yönlendirme izlenmez, kimlik bilgisi yok, tek deneme, yalnız fire_event/mobile_app_notification_action,
 * yetki kesici ve ev ağı dışı düz http denetimi geçerli, webhook kimliği günlüğe/hata metnine girmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { HaHatasi, haIstemcisiOlustur } = require('../src/ha-istemcisi');
const { yetkiKesiciOlustur } = require('../src/lib/yetki-kesici');

const ANAHTAR = 'TEST_ANAHTAR_000';
const WEBHOOK = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // sahte 32 onaltılık karakter
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const YEREL = 'http://192.168.1.10:8123';
const AYAR = { yerelAdres: YEREL, disAdres: 'https://ha.example.com', yerelZamanAsimiMs: 3000, disZamanAsimiMs: 10000 };
const GOVDE = { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'TAMAM', tag: 'camasir' } } };
const manifestMi = (url) => url.endsWith('/manifest.json');

function kur({ webhook = () => new Response('{}', { status: 200 }), anahtar = ANAHTAR, ayar = AYAR, aktif = null, kesici = null } = {}) {
  const cagrilar = [];
  const gunlukler = [];
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, secenek });
      if (manifestMi(url)) return new Response(HA_MANIFEST);
      return webhook(url, secenek, cagrilar.length);
    },
    ayarlarAl: () => ayar,
    anahtarAl: async () => anahtar,
    aktifAdresAl: () => aktif,
    gunluk: (m) => gunlukler.push(m),
    ...(kesici ? { yetkiKesici: kesici } : {}),
  });
  return { istemci, cagrilar, gunlukler };
}

const webhookCagrilari = (cagrilar) => cagrilar.filter((c) => c.url.includes('/api/webhook/'));
const ham = (nesne) => JSON.stringify(nesne);

test('webhookGonder: tek POST /api/webhook/<kimlik>, Authorization yok, yönlendirme izlenmez, kimlik bilgisi yok, gövde aynen gider', async () => {
  const { istemci, cagrilar } = kur();
  assert.deepEqual(await istemci.webhookGonder(WEBHOOK, GOVDE), { durum: 200 });
  const wh = webhookCagrilari(cagrilar);
  assert.equal(wh.length, 1);
  assert.equal(wh[0].url, `${YEREL}/api/webhook/${WEBHOOK}`);
  assert.equal(wh[0].secenek.method, 'POST');
  assert.equal(wh[0].secenek.redirect, 'error');
  assert.equal(wh[0].secenek.credentials, 'omit');
  assert.deepEqual(JSON.parse(wh[0].secenek.body), GOVDE);
  const basliklar = Object.keys(wh[0].secenek.headers).map((b) => b.toLowerCase());
  assert.ok(!basliklar.includes('authorization'), 'webhook isteğinde Authorization yok');
  assert.ok(!ham(wh[0].secenek.headers).includes(ANAHTAR));
  assert.ok(!wh[0].secenek.body.includes(ANAHTAR));
  assert.ok(!wh[0].secenek.body.includes(WEBHOOK), 'webhook kimliği gövdede değil yalnız URL\'de');
  // adres yoklaması (varsa) anahtarsızdır
  for (const c of cagrilar.filter((x) => manifestMi(x.url))) assert.equal(c.secenek.headers, undefined);
});

test('webhookGonder: etiketsiz eylem de gider (tag alanı yok)', async () => {
  const { istemci, cagrilar } = kur();
  const govde = { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'TAMAM' } } };
  await istemci.webhookGonder(WEBHOOK, govde);
  assert.deepEqual(JSON.parse(webhookCagrilari(cagrilar)[0].secenek.body), govde);
});

test('webhookGonder: geçersiz webhook kimliği ve biçim dışı gövde HİÇ ağa çıkmaz (gecersiz)', async () => {
  const { istemci, cagrilar } = kur();
  const gecersizler = [
    // sensör / konum / çağrı / başka webhook türleri
    [WEBHOOK, { type: 'register_sensor', data: { name: 'x', unique_id: 'u', type: 'sensor', state: 1 } }],
    [WEBHOOK, { type: 'update_sensor_states', data: [{ unique_id: 'u', state: 1, type: 'sensor' }] }],
    [WEBHOOK, { type: 'update_location', data: { gps: [1, 2], gps_accuracy: 5 } }],
    [WEBHOOK, { type: 'call_service', data: { domain: 'light', service: 'turn_on', service_data: {} } }],
    [WEBHOOK, { type: 'render_template', data: { t: { template: '{{ 1 }}' } } }],
    [WEBHOOK, { type: 'get_config' }],
    [WEBHOOK, { type: 'update_registration', data: { device_name: 'x' } }],
    // başka olay türü / fazladan alan / eksik alan
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'baska_olay', event_data: { action: 'TAMAM' } } }],
    [WEBHOOK, { ...GOVDE, ek: 1 }],
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'TAMAM', ek: 1 } } }],
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: {} } }],
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action' } }],
    [WEBHOOK, { type: 'fire_event' }],
    // Kapı Kuralı: yasak sözcüklü eylem kimliği / etiket
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'KAPIYI_AC' } } }],
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'TAMAM', tag: 'door_open' } } }],
    [WEBHOOK, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'URI' } } }],
    // kimlik biçimi
    ['kisa', GOVDE],
    ['../../api/services/light/toggle_______', GOVDE],
    [`${WEBHOOK}/../x`, GOVDE],
    [`${WEBHOOK}?x=1`, GOVDE],
    ['', GOVDE],
    [null, GOVDE],
    [undefined, GOVDE],
    [5, GOVDE],
    [WEBHOOK, null],
    [WEBHOOK, undefined],
    [WEBHOOK, 'metin'],
    [WEBHOOK, []],
  ];
  for (const [kimlik, govde] of gecersizler) {
    await assert.rejects(() => istemci.webhookGonder(kimlik, govde), (h) => h instanceof HaHatasi && h.tur === 'gecersiz', ham(govde));
  }
  assert.equal(cagrilar.length, 0, 'hiçbir istek (yoklama dahil) yapılmadı');
});

test('webhookGonder: 410 (HA kaydı silmiş) -> bulunamadi/410; diğer 4xx/5xx -> sunucu; yeniden denenmez', async () => {
  for (const [durum, tur] of [[410, 'bulunamadi'], [404, 'sunucu'], [401, 'sunucu'], [403, 'sunucu'], [500, 'sunucu'], [502, 'sunucu'], [300, 'sunucu']]) {
    const { istemci, cagrilar } = kur({ webhook: () => new Response('', { status: durum }) });
    await assert.rejects(() => istemci.webhookGonder(WEBHOOK, GOVDE), (h) => h instanceof HaHatasi && h.tur === tur && h.durumKodu === durum, `${durum}`);
    assert.equal(webhookCagrilari(cagrilar).length, 1, `${durum}: tek deneme`);
  }
});

test('webhookGonder: başarılı kodlar (200, 201, 204) kabul edilir', async () => {
  for (const durum of [200, 201, 204]) {
    const { istemci } = kur({ webhook: () => new Response(null, { status: durum }) });
    assert.deepEqual(await istemci.webhookGonder(WEBHOOK, GOVDE), { durum });
  }
});

test('webhookGonder: ağ hatası ve yönlendirme hatası -> baglanti, TEK deneme (tekrar yok)', async () => {
  for (const hata of [new Error('ECONNRESET'), new TypeError('redirect mode is set to error'), new Error('net::ERR_FAILED')]) {
    const { istemci, cagrilar } = kur({
      webhook: () => {
        throw hata;
      },
    });
    await assert.rejects(() => istemci.webhookGonder(WEBHOOK, GOVDE), (h) => h instanceof HaHatasi && h.tur === 'baglanti');
    assert.equal(webhookCagrilari(cagrilar).length, 1);
  }
});

test('webhookGonder: zaman aşımı -> gecikti (olay HA\'ya ulaşmış olabilir), tekrar yok', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { istemci, cagrilar } = kur({ webhook: (_url, secenek) => new Promise((_coz, reddet) => secenek.signal.addEventListener('abort', () => reddet(new Error('iptal')))) });
  const soz = istemci.webhookGonder(WEBHOOK, GOVDE);
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(8000);
  await assert.rejects(soz, (h) => h instanceof HaHatasi && h.tur === 'gecikti');
  assert.equal(webhookCagrilari(cagrilar).length, 1);
});

test('webhookGonder: erişim anahtarı yoksa istek hiç yapılmaz (anahtar-yok)', async () => {
  const { istemci, cagrilar } = kur({ anahtar: null });
  await assert.rejects(() => istemci.webhookGonder(WEBHOOK, GOVDE), (h) => h.tur === 'anahtar-yok');
  assert.equal(cagrilar.length, 0);
});

test('webhookGonder: HA anahtarı reddetmişse (yetki kesici) webhook isteği de gitmez', async () => {
  const dosyalar = new Map();
  const fs = {
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => dosyalar.get(y),
    writeFileSync: (y, v) => dosyalar.set(y, String(v)),
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
    mkdirSync() {},
  };
  const kesici = yetkiKesiciOlustur({ dosyaYolu: 'C:\\sahte\\yetki-kesici.json', fs, simdi: () => 1_000_000 });
  kesici.yukle();
  kesici.reddet(kesici.parmakIzi(ANAHTAR));
  const { istemci, cagrilar } = kur({ kesici });
  await assert.rejects(() => istemci.webhookGonder(WEBHOOK, GOVDE), (h) => h instanceof HaHatasi && h.tur === 'reddedildi');
  assert.equal(cagrilar.length, 0, 'ne yoklama ne webhook');
});

test('webhookGonder: ev ağı dışındaki düz http adresine gitmez; webhook kimliği o adrese sızmaz', async () => {
  const { istemci, cagrilar, gunlukler } = kur({ ayar: { ...AYAR, yerelAdres: 'http://ha.example.com' }, aktif: 'http://ha.example.com' });
  await assert.rejects(() => istemci.webhookGonder(WEBHOOK, GOVDE), (h) => h instanceof HaHatasi && h.tur === 'baglanti');
  assert.ok(cagrilar.every((c) => !c.url.startsWith('http://ha.example.com')), 'düz http isteği hiç gitmedi');
  assert.equal(webhookCagrilari(cagrilar).length, 0);
  assert.ok(gunlukler.includes('Webhook kimliği ev ağı dışındaki http adresine gönderilmedi.'));
});

test('webhookGonder: dış https adrese de gider (ev dışı kullanım)', async () => {
  const { istemci, cagrilar } = kur({ ayar: { ...AYAR, yerelAdres: '' }, aktif: 'https://ha.example.com' });
  await istemci.webhookGonder(WEBHOOK, GOVDE);
  assert.equal(webhookCagrilari(cagrilar)[0].url, `https://ha.example.com/api/webhook/${WEBHOOK}`);
});

test('webhookGonder: webhook kimliği günlüğe ve hata metnine/özelliklerine girmez', async () => {
  const durumlar = [() => new Response('', { status: 410 }), () => new Response('', { status: 500 }), () => {
    throw new Error(`ağ hatası ${WEBHOOK}`);
  }];
  for (const webhook of durumlar) {
    const { istemci, gunlukler } = kur({ webhook });
    let yakalanan = null;
    try {
      await istemci.webhookGonder(WEBHOOK, GOVDE);
    } catch (hata) {
      yakalanan = hata;
    }
    assert.ok(yakalanan instanceof HaHatasi);
    assert.ok(!ham({ ad: yakalanan.name, ileti: yakalanan.message, tur: yakalanan.tur, kod: yakalanan.durumKodu, onay: yakalanan.onay }).includes(WEBHOOK));
    assert.ok(!String(yakalanan.stack).includes(WEBHOOK));
    assert.ok(gunlukler.every((m) => !m.includes(WEBHOOK) && !m.includes(ANAHTAR)));
  }
});

test('webhookGonder: istemci nesnesinde dışarı açıktır ve Authorization başlığını hiçbir yolla eklemez (kaynak denetimi)', () => {
  const { istemci } = kur();
  assert.equal(typeof istemci.webhookGonder, 'function');
  const fs = require('node:fs');
  const path = require('node:path');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'ha-istemcisi.js'), 'utf8');
  const baslangic = kaynak.indexOf('async function webhookGonder(');
  const bitis = kaynak.indexOf('async function anahtariDogrula(');
  assert.ok(baslangic > 0 && bitis > baslangic);
  const govde = kaynak.slice(baslangic, bitis);
  assert.doesNotMatch(govde, /Authorization|Bearer/i);
  assert.equal(govde.match(/\bfetch\(/g)?.length, 1, 'tek fetch');
  assert.match(govde, /redirect:\s*'error'/);
  assert.match(govde, /credentials:\s*'omit'/);
});
