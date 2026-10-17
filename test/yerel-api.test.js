'use strict';

// 1.4.0 dis grubu (o-52): yerel API. Sahte istek/yanıt nesneleriyle ve 127.0.0.1'de gerçek bir node:http sunucusuyla (yalnız geri
// döngü; HA ya da internet yok) sınanır.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { yerelApiOlustur, jetonUret, jetonGecerliMi, jetonEsitMi, govdeDogrula, hostGecerliMi, HIZ, KILIT, GOVDE_SINIRI } = require('../src/lib/yerel-api');

const JETON = jetonUret(() => Buffer.alloc(32, 7));

function sahteIstek({ yontem = 'POST', yol = '/eylem', basliklar = {}, govde = '{"ad":"Salon"}', adres = '127.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.method = yontem;
  req.url = yol;
  req.headers = { host: '127.0.0.1:48123', 'content-type': 'application/json', authorization: `Bearer ${JETON}`, ...basliklar };
  for (const [k, v] of Object.entries(req.headers)) if (v === undefined) delete req.headers[k];
  req.socket = { remoteAddress: adres, destroy: () => (req.yokEdildi = true) };
  req.pause = () => {};
  setImmediate(() => {
    if (govde !== null) req.emit('data', Buffer.from(govde));
    req.emit('end');
  });
  return req;
}

function sahteYanit() {
  const res = { kod: null, basliklar: null, govde: null, headersSent: false, writableEnded: false };
  res.writeHead = (kod, b) => {
    res.kod = kod;
    res.basliklar = b;
    res.headersSent = true;
  };
  res.end = (m) => {
    res.govde = m ? JSON.parse(m) : null;
    res.writableEnded = true;
  };
  return res;
}

function ortam({ jeton = JETON, isle } = {}) {
  let an = 1_000_000;
  const cagrilar = [];
  const gunlukler = [];
  const api = yerelApiOlustur({
    jetonAl: async () => jeton,
    isle:
      isle ??
      (async (yol, govde) => {
        cagrilar.push([yol, govde]);
        return { ok: true, ad: govde.ad ?? null };
      }),
    gunluk: (m) => gunlukler.push(m),
    simdi: () => an,
  });
  // istekIsle port'u baslat'tan alır; sahte testlerde de 48123 kurulsun diye sunucu oluşturucu sahte verilir
  return { api, cagrilar, gunlukler, ileri: (ms) => (an += ms) };
}

async function sahteSunucuyla(o) {
  // gerçek dinleme yapmadan port'u ayarlamak için sahte sunucu
  const sahte = new EventEmitter();
  sahte.listen = (_s, cb) => cb();
  sahte.close = (cb) => cb();
  const api = yerelApiOlustur({ jetonAl: o.jetonAl, isle: o.isle, simdi: o.simdi, gunluk: () => {}, sunucuOlustur: () => sahte });
  await api.baslat(48123);
  return api;
}

async function istek(api, secenek) {
  const res = sahteYanit();
  await api.istekIsle(sahteIstek(secenek), res);
  return res;
}

test('jeton: 32 bayt base64url; sabit zamanlı karşılaştırma; biçim dışı jeton geçersiz', () => {
  const j = jetonUret();
  assert.equal(jetonGecerliMi(j), true);
  assert.notEqual(jetonUret(), j);
  assert.equal(jetonEsitMi(j, j), true);
  assert.equal(jetonEsitMi(`${j}x`, j), false);
  assert.equal(jetonEsitMi(j.slice(1), j), false);
  assert.equal(jetonEsitMi(undefined, j), false);
  assert.equal(jetonEsitMi(j, 'kisa'), false);
  assert.equal(jetonGecerliMi('a b'), false);
});

test('gövde şeması sıkı: bilinmeyen alan, çift değiştirici, sınır dışı değer reddedilir', () => {
  assert.deepEqual(govdeDogrula('/eylem', { ad: 'Salon' }), { ad: 'Salon' });
  assert.deepEqual(govdeDogrula('/eylem', { ad: 'Salon', parlaklik: 40 }), { ad: 'Salon', parlaklik: 40 });
  assert.deepEqual(govdeDogrula('/eylem', { ad: 'Salon', islem: 'kapat' }), { ad: 'Salon', islem: 'kapat' });
  assert.deepEqual(govdeDogrula('/eylem', { ad: 'Salon', adim: -10 }), { ad: 'Salon', adim: -10 });
  assert.deepEqual(govdeDogrula('/durum', { ad: 'Salon' }), { ad: 'Salon' });
  assert.deepEqual(govdeDogrula('/liste', {}), {});
  for (const [yol, g] of [
    ['/eylem', { ad: 'Salon', kimlik: 'light.salon' }],
    ['/eylem', { ad: 'Salon', parlaklik: 40, islem: 'ac' }],
    ['/eylem', { ad: 'Salon', parlaklik: 101 }],
    ['/eylem', { ad: 'Salon', parlaklik: '40' }],
    ['/eylem', { ad: 'Salon', adim: 0 }],
    ['/eylem', { ad: 'Salon', islem: 'sil' }],
    ['/eylem', { ad: '' }],
    ['/eylem', { ad: 'x'.repeat(61) }],
    ['/eylem', { ad: 'a\u0000' }],
    ['/eylem', ['Salon']],
    ['/eylem', null],
    ['/durum', { ad: 'Salon', islem: 'ac' }],
    ['/liste', { ad: 'x' }],
  ]) {
    assert.equal(govdeDogrula(yol, g), null, JSON.stringify(g));
  }
  assert.equal(hostGecerliMi('127.0.0.1:48123', 48123), true);
  assert.equal(hostGecerliMi('LOCALHOST:48123', 48123), true);
  assert.equal(hostGecerliMi('127.0.0.1', 48123), false);
  assert.equal(hostGecerliMi('evil.example:48123', 48123), false);
  assert.equal(hostGecerliMi(undefined, 48123), false);
});

test('istek kapısı: Origin, Sec-Fetch, yanlış Host, POST dışı yöntem, bilinmeyen yol, yanlış içerik türü reddedilir; CORS başlığı yok', async () => {
  let an = 0;
  const cagrilar = [];
  const api = await sahteSunucuyla({ jetonAl: async () => JETON, isle: async (y, g) => (cagrilar.push(g), { ok: true }), simdi: () => an });
  const durumlar = [];
  for (const s of [
    { basliklar: { origin: 'https://kotu.example' } },
    { basliklar: { origin: 'null' } },
    { basliklar: { 'sec-fetch-site': 'cross-site' } },
    { basliklar: { 'sec-fetch-mode': 'no-cors' } },
    { basliklar: { host: 'kotu.example:48123' } },
    { basliklar: { host: undefined } },
    { yontem: 'OPTIONS' },
    { yontem: 'GET' },
    { yol: '/eylem?ad=Salon' },
    { yol: '/ayarlar' },
    { basliklar: { 'content-type': 'text/plain' } },
    { basliklar: { 'content-type': 'application/x-www-form-urlencoded' } },
  ]) {
    const res = await istek(api, s);
    durumlar.push(res.kod);
    assert.equal(Object.keys(res.basliklar).some((b) => /^access-control/i.test(b)), false);
  }
  assert.deepEqual(durumlar, [403, 403, 403, 403, 403, 403, 405, 405, 404, 404, 415, 415]);
  assert.deepEqual(cagrilar, []);
  // geri döngü dışı bağlantı hemen kapatılır, yanıt bile verilmez
  const req = sahteIstek({ adres: '192.168.1.5' });
  const res = sahteYanit();
  await api.istekIsle(req, res);
  assert.equal(res.kod, null);
  assert.equal(req.yokEdildi, true);
  an += 1;
});

test('yetki: jeton yoksa 503, yanlış jeton 401; art arda yanlış deneme geçici kilit getirir (doğru jeton da beklemeli)', async () => {
  let an = 0;
  let jeton = null;
  const api = await sahteSunucuyla({ jetonAl: async () => jeton, isle: async () => ({ ok: true }), simdi: () => an });
  assert.equal((await istek(api, {})).kod, 503);
  jeton = JETON;
  const yanlis = { basliklar: { authorization: `Bearer ${jetonUret()}` } };
  assert.equal((await istek(api, { basliklar: { authorization: undefined } })).kod, 401);
  assert.equal((await istek(api, { basliklar: { authorization: `Basic ${JETON}` } })).kod, 401);
  for (let i = 0; i < KILIT.deneme - 2; i += 1) assert.equal((await istek(api, yanlis)).kod, 401);
  assert.equal((await istek(api, {})).kod, 429, 'kilitliyken doğru jeton da reddedilir');
  an += KILIT.sureMs;
  const res = await istek(api, {});
  assert.equal(res.kod, 200);
  assert.doesNotMatch(JSON.stringify(res.govde), new RegExp(JETON));
});

test('gövde: sınırı aşan 413, bozuk JSON 400, şema dışı 400; geçerli istek kapıya gider ve sonuç türü HTTP koduna çevrilir', async () => {
  const sonuclar = [{ ok: true, ad: 'Salon' }, { ok: false, tur: 'bulunamadi' }, { ok: false, tur: 'belirsiz' }, { ok: false, tur: 'kaynak-izinsiz' }, { ok: false, tur: 'kapali' }, { ok: false, tur: 'ha-hatasi' }, { ok: false, tur: 'cok-sik' }];
  const giden = [];
  const api = await sahteSunucuyla({ jetonAl: async () => JETON, isle: async (y, g) => (giden.push([y, g]), sonuclar.shift()), simdi: () => 0 });
  assert.equal((await istek(api, { govde: `{"ad":"${'x'.repeat(GOVDE_SINIRI)}"}` })).kod, 413);
  assert.equal((await istek(api, { basliklar: { 'content-length': String(GOVDE_SINIRI + 1) } })).kod, 413);
  assert.equal((await istek(api, { govde: '{"ad":' })).kod, 400);
  assert.equal((await istek(api, { govde: '{"ad":"Salon","x":1}' })).kod, 400);
  assert.equal((await istek(api, { govde: '{"__proto__":{"ad":"x"}}' })).kod, 400);
  assert.deepEqual(giden, []);
  const kodlar = [];
  for (let i = 0; i < 7; i += 1) kodlar.push((await istek(api, { basliklar: { 'content-type': 'application/json; charset=utf-8' } })).kod);
  assert.deepEqual(kodlar, [200, 404, 409, 403, 503, 502, 429]);
  assert.deepEqual(giden[0], ['/eylem', { ad: 'Salon' }]);
  const liste = await istek(api, { yol: '/liste', govde: '{}' });
  assert.equal(liste.basliklar['Cache-Control'], 'no-store');
  assert.equal(liste.basliklar['X-Content-Type-Options'], 'nosniff');
});

test('genel hız sınırı: pencere dolunca 429', async () => {
  let an = 0;
  const api = await sahteSunucuyla({ jetonAl: async () => JETON, isle: async () => ({ ok: true }), simdi: () => an });
  for (let i = 0; i < HIZ.enCok; i += 1) assert.equal((await istek(api, {})).kod, 200);
  assert.equal((await istek(api, {})).kod, 429);
  an += HIZ.pencereMs;
  assert.equal((await istek(api, {})).kod, 200);
});

test('isle hata fırlatırsa 502; ayrıntı yanıta girmez', async () => {
  const api = await sahteSunucuyla({ jetonAl: async () => JETON, isle: async () => { throw new Error('http://192.168.1.10:8123 gizli'); }, simdi: () => 0 });
  const res = await istek(api, {});
  assert.equal(res.kod, 502);
  assert.doesNotMatch(JSON.stringify(res.govde), /192\.168|gizli/);
});

test('baslat: geçersiz port reddedilir; kullanımdaki port "port-kullanimda"; durdur sunucuyu kapatır', async () => {
  const o = ortam();
  assert.deepEqual(await o.api.baslat(80), { ok: false, hata: 'port-gecersiz' });
  assert.deepEqual(await o.api.baslat(70000), { ok: false, hata: 'port-gecersiz' });
  const engel = http.createServer();
  const port = await new Promise((coz) => engel.listen(0, '127.0.0.1', () => coz(engel.address().port)));
  try {
    if (port >= 1024) {
      assert.deepEqual(await o.api.baslat(port), { ok: false, hata: 'port-kullanimda' });
      assert.equal(o.api.durum().calisiyor, false);
    }
  } finally {
    await new Promise((coz) => engel.close(coz));
  }
});

test('gerçek sunucu (yalnız 127.0.0.1): jetonlu POST çalışır, Origin\'li istek 403; durdurunca bağlantı reddedilir', async (t) => {
  const o = ortam();
  let port = null;
  for (let deneme = 0; deneme < 10 && port === null; deneme += 1) {
    const aday = 40000 + Math.floor(Math.random() * 20000);
    if ((await o.api.baslat(aday)).ok) port = aday;
  }
  if (port === null) {
    t.skip('boş port bulunamadı');
    return;
  }
  const gonder = (basliklar, govde = '{"ad":"Salon"}', yol = '/eylem') =>
    new Promise((coz, reddet) => {
      const r = http.request({ host: '127.0.0.1', port, path: yol, method: 'POST', headers: { 'Content-Type': 'application/json', ...basliklar } }, (yanit) => {
        let veri = '';
        yanit.on('data', (p) => (veri += p));
        yanit.on('end', () => coz({ kod: yanit.statusCode, basliklar: yanit.headers, govde: veri ? JSON.parse(veri) : null }));
      });
      r.on('error', reddet);
      r.end(govde);
    });
  try {
    const iyi = await gonder({ Authorization: `Bearer ${JETON}` });
    assert.equal(iyi.kod, 200);
    assert.deepEqual(iyi.govde, { ok: true, ad: 'Salon' });
    assert.equal(iyi.basliklar['access-control-allow-origin'], undefined);
    assert.equal((await gonder({ Authorization: `Bearer ${JETON}`, Origin: 'https://kotu.example' })).kod, 403);
    assert.equal((await gonder({})).kod, 401);
    assert.deepEqual(o.cagrilar, [['/eylem', { ad: 'Salon' }]]);
    assert.equal(o.api.durum().port, port);
  } finally {
    await o.api.durdur();
  }
  assert.equal(o.api.durum().calisiyor, false);
  await assert.rejects(gonder({ Authorization: `Bearer ${JETON}` }));
  assert.equal(o.gunlukler.some((g) => g.includes(JETON)), false);
});
