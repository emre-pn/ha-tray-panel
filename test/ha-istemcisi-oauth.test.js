'use strict';

/**
 * HA REST istemcisinin tarayıcı girişi kancaları (o-57): oauthIstegi (/auth/token) ve yeniErisimAnahtari.
 * Sahte fetch; gerçek ağ ve gerçek Home Assistant yok. Yetki kesici gerçek modül (bellek içi sahte dosya sistemi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { HaHatasi, haIstemcisiOlustur } = require('../src/ha-istemcisi');
const { yetkiKesiciOlustur } = require('../src/lib/yetki-kesici');

const YEREL = 'http://192.168.1.10:8123';
const DIS = 'https://ha.example.com';
const AYAR = { yerelAdres: YEREL, disAdres: DIS, yerelZamanAsimiMs: 3000, disZamanAsimiMs: 10000 };
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const FORM = 'grant_type=refresh_token&refresh_token=YENILEME_TEST_DEGERI&client_id=http%3A%2F%2F127.0.0.1%3A41000%2Fev-paneli';
const ERISIM = `e1.${'x'.repeat(30)}.${'y'.repeat(12)}`;
const json = (govde, status = 200) => new Response(JSON.stringify(govde), { status });
const manifestMi = (url) => url.endsWith('/manifest.json');

function kur({ jeton, ayar = AYAR, anahtar = null, simdi = () => Date.now() } = {}) {
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
  const kesici = yetkiKesiciOlustur({ dosyaYolu: 'C:\\sahte\\yetki-kesici.json', fs, simdi });
  kesici.yukle();
  const cagrilar = [];
  const gunlukler = [];
  const durum = { yolda: 0, enCok: 0 };
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, yontem: secenek.method ?? 'GET', secenek });
      if (manifestMi(url)) return new Response(HA_MANIFEST);
      durum.yolda += 1;
      durum.enCok = Math.max(durum.enCok, durum.yolda);
      try {
        if (url.endsWith('/api/')) return json({ message: 'API running.' });
        return await jeton(url, secenek, cagrilar.length);
      } finally {
        durum.yolda -= 1;
      }
    },
    ayarlarAl: () => ayar,
    anahtarAl: async () => anahtar,
    aktifAdresAl: () => null,
    gunluk: (m) => gunlukler.push(m),
    simdi,
    yetkiKesici: kesici,
  });
  const tokenIstekleri = () => cagrilar.filter((c) => c.url.endsWith('/auth/token'));
  return { istemci, kesici, cagrilar, gunlukler, durum, tokenIstekleri };
}

const tamam = () => json({ access_token: ERISIM, token_type: 'Bearer', expires_in: 1800 });

test('oauthIstegi: /auth/token\'a form POST; Authorization yok; yönlendirme reddedilir; çerez yok; adres anahtarsız yoklamayla seçilir', async () => {
  const o = kur({ jeton: tamam });
  const yanit = await o.istemci.oauthIstegi({ form: FORM });
  assert.deepEqual(yanit, { durum: 200, govde: { access_token: ERISIM, token_type: 'Bearer', expires_in: 1800 }, taban: YEREL });
  assert.deepEqual(o.cagrilar.map((c) => `${c.yontem} ${c.url}`), [`GET ${YEREL}/manifest.json`, `POST ${YEREL}/auth/token`]);
  const istek = o.tokenIstekleri()[0].secenek;
  assert.equal(istek.body, FORM);
  assert.equal(istek.redirect, 'error');
  assert.equal(istek.credentials, 'omit');
  assert.equal(istek.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(istek.headers.Accept, 'application/json');
  assert.equal(istek.headers.Authorization, undefined);
  assert.equal(JSON.stringify(istek.headers).includes('Bearer'), false);
  assert.equal(o.cagrilar[0].secenek.headers, undefined, 'adres yoklaması anahtarsız ve gövdesiz');
  assert.equal(o.gunlukler.join('\n').includes('YENILEME_TEST_DEGERI'), false, 'form günlüğe girmez');
});

test('oauthIstegi: 400/401 OAuth hata yanıtları fırlatmaz, çağırana { durum, govde } olarak döner', async () => {
  for (const durum of [400, 401]) {
    const o = kur({ jeton: () => json({ error: 'invalid_grant' }, durum) });
    assert.deepEqual(await o.istemci.oauthIstegi({ form: FORM }), { durum, govde: { error: 'invalid_grant' }, taban: YEREL });
  }
  const bozuk = kur({ jeton: () => new Response('<html>hata</html>', { status: 400 }) });
  assert.deepEqual(await bozuk.istemci.oauthIstegi({ form: FORM }), { durum: 400, govde: null, taban: YEREL });
  const dizi = kur({ jeton: () => json([1, 2], 200) });
  assert.equal((await dizi.istemci.oauthIstegi({ form: FORM })).govde, null, 'nesne olmayan gövde yok sayılır');
  const buyuk = kur({ jeton: () => new Response(JSON.stringify({ access_token: 'x'.repeat(70_000) }), { status: 200 }) });
  assert.equal((await buyuk.istemci.oauthIstegi({ form: FORM })).govde, null, '64 KB üstü gövde reddedilir');
});

test('oauthIstegi: 5xx, 429, 404 ve ağ hataları HaHatasi fırlatır (jeton ucu geçici hatası oturumu bitirmez)', async () => {
  for (const durum of [404, 429, 500, 502, 503]) {
    const o = kur({ jeton: () => new Response('x', { status: durum }) });
    await assert.rejects(o.istemci.oauthIstegi({ form: FORM }), (h) => h instanceof HaHatasi && h.tur === 'sunucu' && h.durumKodu === durum, String(durum));
  }
  const ag = kur({ jeton: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } });
  await assert.rejects(ag.istemci.oauthIstegi({ form: FORM }), (h) => h instanceof HaHatasi && h.tur === 'baglanti');
  assert.equal(ag.kesici.reddedilenler().length, 0);
  assert.equal(ag.kesici.belirsizSayisi(ag.kesici.parmakIzi('x')), 0, 'jeton ucu isteği belirsiz deneme sayacına yazılmaz');
});

test('oauthIstegi: zaman aşımı "bağlantı" hatasıdır (belirsiz sayılmaz); yanıtsız istek kapıyı tutmaz', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const o = kur({ jeton: (_url, secenek) => new Promise((_coz, reddet) => secenek.signal.addEventListener('abort', () => reddet(new Error('iptal')))) });
  const soz = o.istemci.oauthIstegi({ form: FORM });
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(15_000);
  await assert.rejects(soz, (h) => h instanceof HaHatasi && h.tur === 'baglanti');
  const ikinci = o.istemci.oauthIstegi({ form: FORM });
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(15_000);
  await assert.rejects(ikinci, (h) => h.tur === 'baglanti', 'kapı bırakıldı: ikinci istek de ağa çıktı');
});

test('oauthIstegi: adres ayardaki köken olmalı ve anahtar/jeton için güvenli olmalı; aksi halde ağa HİÇ çıkılmaz', async () => {
  const o = kur({ jeton: tamam });
  await assert.rejects(o.istemci.oauthIstegi({ form: FORM, taban: 'https://evil.example.com' }), (h) => h.tur === 'kaynak-izinsiz');
  await assert.rejects(o.istemci.oauthIstegi({ form: FORM, taban: 'http://192.168.1.10:9999' }), (h) => h.tur === 'kaynak-izinsiz');
  assert.equal(o.cagrilar.length, 0);
  // ayarda herkese açık bir ada düz http yazılmış (elle düzenlenmiş ayar dosyası): jeton oraya gitmez
  const acik = kur({ jeton: tamam, ayar: { ...AYAR, yerelAdres: 'http://ha.example.org:8123' } });
  await assert.rejects(acik.istemci.oauthIstegi({ form: FORM, taban: 'http://ha.example.org:8123' }), (h) => h.tur === 'baglanti');
  assert.equal(acik.cagrilar.length, 0);
  // bozuk / boş / aşırı büyük form
  for (const form of ['', undefined, null, 5, 'x'.repeat(16_385)]) {
    await assert.rejects(o.istemci.oauthIstegi({ form, taban: YEREL }), (h) => h.tur === 'baglanti');
  }
  assert.equal(o.cagrilar.length, 0);
  // geçerli: açık taban verilince adres yoklaması yapılmaz
  assert.equal((await o.istemci.oauthIstegi({ form: FORM, taban: DIS })).taban, DIS);
  assert.deepEqual(o.cagrilar.map((c) => `${c.yontem} ${c.url}`), [`POST ${DIS}/auth/token`]);
});

test('oauthIstegi: 403 adresi 15 dk duraklatır (yetki kesici); duraklatılmış adrese ne jeton ucu ne anahtarlı istek gider', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const o = kur({ anahtar: 'TEST_ANAHTAR_000', jeton: (url) => (url.endsWith('/auth/token') ? new Response('yasak', { status: 403 }) : json({})) });
  await assert.rejects(o.istemci.oauthIstegi({ form: FORM, taban: YEREL }), (h) => h.tur === 'yasak-erisim' && h.durumKodu === 403);
  const once = o.cagrilar.length;
  await assert.rejects(o.istemci.oauthIstegi({ form: FORM, taban: YEREL }), (h) => h.tur === 'duraklatildi');
  await assert.rejects(o.istemci.haIstek('/api/states'), (h) => h.tur === 'duraklatildi', 'anahtarlı istek de aynı duraklatmaya uyar');
  assert.equal(o.cagrilar.filter((c) => !manifestMi(c.url)).length, once - o.cagrilar.slice(0, once).filter((c) => manifestMi(c.url)).length, 'duraklatma sürerken yeni jeton/anahtarlı istek yok');
  // diğer köken (dış adres) etkilenmez
  assert.equal((await kur({ jeton: tamam }).istemci.oauthIstegi({ form: FORM, taban: DIS })).durum, 200);
  t.mock.timers.tick(15 * 60_000 + 1000);
  const sonra = kur({ jeton: tamam });
  assert.equal((await sonra.istemci.oauthIstegi({ form: FORM, taban: YEREL })).durum, 200);
});

test('oauthIstegi: küresel kapı — jeton istekleri ve anahtarlı istekler aynı anda en çok 1 kimlikli işlem yürütür', async () => {
  const bekleyenler = [];
  const o = kur({
    anahtar: 'TEST_ANAHTAR_000',
    jeton: (url) => new Promise((coz) => bekleyenler.push(() => coz(url.endsWith('/auth/token') ? tamam() : json({ message: 'ok' })))),
  });
  const a = o.istemci.oauthIstegi({ form: FORM, taban: YEREL });
  const b = o.istemci.oauthIstegi({ form: FORM, taban: YEREL });
  const c = o.istemci.oauthIstegi({ form: FORM, taban: YEREL });
  for (let i = 0; i < 20 && bekleyenler.length === 0; i += 1) await new Promise((coz) => setImmediate(coz));
  assert.equal(bekleyenler.length, 1, 'ilk istek yolda, diğerleri kapıda bekliyor');
  assert.equal(o.durum.enCok, 1);
  for (let bitti = 0; bitti < 3; bitti += 1) {
    for (let i = 0; i < 20 && bekleyenler.length === 0; i += 1) await new Promise((coz) => setImmediate(coz));
    bekleyenler.shift()();
  }
  await Promise.all([a, b, c]);
  assert.equal(o.durum.enCok, 1, 'hiçbir anda ikiden fazla kimlikli işlem yolda olmadı');
  assert.equal(o.tokenIstekleri().length, 3);
});

test('yeniErisimAnahtari: HA\'nın verdiği anahtar doğrulanmış sayılır — ilk istek ayrıca GET /api/ doğrulaması göndermez; yetki kesici "iyi" işaretler', async () => {
  const o = kur({ anahtar: ERISIM, jeton: () => json({ entity_id: 'light.a' }) });
  const p = o.kesici.parmakIzi(ERISIM);
  assert.equal(o.kesici.iyiMi(p), false);
  o.istemci.yeniErisimAnahtari(YEREL, ERISIM);
  assert.equal(o.kesici.iyiMi(p), true);
  await o.istemci.haIstek('/api/states/light.a');
  assert.deepEqual(o.cagrilar.filter((c) => !manifestMi(c.url)).map((c) => `${c.yontem} ${new URL(c.url).pathname}`), ['GET /api/states/light.a'], 'doğrulama isteği atlandı');

  // karşılaştırma: bildirilmeyen anahtar önce tek doğrulamadan geçer
  const k = kur({ anahtar: ERISIM, jeton: () => json({ entity_id: 'light.a' }) });
  await k.istemci.haIstek('/api/states/light.a');
  assert.deepEqual(k.cagrilar.filter((c) => !manifestMi(c.url)).map((c) => new URL(c.url).pathname), ['/api/', '/api/states/light.a']);

  // geçersiz girdiler zararsız
  o.istemci.yeniErisimAnahtari(YEREL, '');
  o.istemci.yeniErisimAnahtari(YEREL, undefined);
  o.istemci.yeniErisimAnahtari(YEREL, 42);
});

test('yeniErisimAnahtari: reddedilmiş (401) bir erişim anahtarı yeniden "doğrulanmış" olsa bile kesici onu engellemeye devam eder', async () => {
  const o = kur({ anahtar: ERISIM, jeton: () => new Response('', { status: 401 }) });
  await assert.rejects(o.istemci.haIstek('/api/states'), (h) => h.tur === 'yetki');
  const p = o.kesici.parmakIzi(ERISIM);
  assert.equal(o.kesici.reddedildiMi(p), true);
  o.istemci.yeniErisimAnahtari(YEREL, ERISIM);
  const once = o.cagrilar.length;
  await assert.rejects(o.istemci.haIstek('/api/states'), (h) => h.tur === 'reddedildi');
  assert.equal(o.cagrilar.length, once, 'reddedilmiş anahtarla ağa çıkılmadı');
});
