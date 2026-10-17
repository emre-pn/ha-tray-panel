'use strict';

/**
 * Medya albüm kapağı, ana süreç tarafı: kapak yolu beyaz listesi, resim doğrulaması (tür, sihirli sayı, boyut), sınırlı bayt okuyucu,
 * haIstek'in ikili kipi, ha-okuma.js medyaKapagi (önbellek, tek uçuş, hız sınırı, Kapı Kuralı), yuzey:oku 'kapak' türü, karo modeli ve
 * ayar alanı. Gerçek ağ, Electron ya da Home Assistant YOK: sahte fetch / sahte haIstek.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../src/lib/medya-kapagi');
const { sinirliBaytOku } = require('../src/lib/yoklama');
const { haIstemcisiOlustur, HaHatasi } = require('../src/ha-istemcisi');
const { haOkumaOlustur, yuzeyOkumasi, DAKIKA_SINIRI } = require('../src/lib/ha-okuma');
const { guvenliOzellikler } = require('../src/lib/varlik-ozellik');
const A = require('../src/lib/ayar-alanlari');
const { TR } = require('../src/lib/ceviri-varsayilan');

// ---- sahte resim baytları --------------------------------------------------------------------------------------------------

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const png = (w = 8, h = 8) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0]), u32(0)]);
const jpeg = (w = 8, h = 8) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0'),
    Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xd9]),
  ]);
const webpTemel = (parca) => {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0);
  b.writeUInt32LE(24, 4);
  b.write('WEBP', 8);
  b.write(parca, 12);
  b.writeUInt32LE(12, 16);
  return b;
};
const webpX = (w = 8, h = 8) => {
  const b = webpTemel('VP8X');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};
const webpL = (w = 8, h = 8) => {
  const b = webpTemel('VP8L');
  b[20] = 0x2f;
  b.writeUInt32LE((((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)) >>> 0, 21);
  return b;
};
const webpLossy = (w = 8, h = 8) => {
  const b = webpTemel('VP8 ');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
};
const adres = (tur, bayt) => `data:${tur};base64,${bayt.toString('base64')}`;

const YOL = '/api/media_player_proxy/media_player.salon?token=abc123&cache=77';
const oynatici = (ek = {}, kimlik = 'media_player.salon') => ({
  entity_id: kimlik,
  state: 'playing',
  attributes: { friendly_name: 'Salon', entity_picture: YOL, ...ek },
});

// ---- kapak yolu beyaz listesi ----------------------------------------------------------------------------------------------

test('kapakYolu: yalnız HA\'nın kendi vekil yolu ve yalnız aynı oynatıcı için; entity_picture_local önce aranır', () => {
  assert.equal(K.kapakYolu(oynatici()), YOL);
  assert.equal(K.kapakYolu(oynatici(), 'media_player.salon'), YOL);
  const yerel = '/api/media_player_proxy/media_player.salon?token=yerel';
  assert.equal(K.kapakYolu(oynatici({ entity_picture_local: yerel })), yerel, 'yerel vekil öncelikli');
  assert.equal(K.kapakYolu(oynatici({ entity_picture_local: 'http://dis.example/x.jpg' })), YOL, 'yerel yol geçersizse entity_picture denenir');
  assert.equal(K.kapakYolu(oynatici({ entity_picture: '/api/media_player_proxy/media_player.salon' })), '/api/media_player_proxy/media_player.salon', 'sorgusuz yol da olur');
});

test('kapakYolu: mutlak adres, başka oynatıcı, yol atlatma, özel karakter ve aşırı uzun yol reddedilir (HA anahtarı dışarı gitmesin)', () => {
  const kotuler = [
    'http://dis.example/kapak.jpg',
    'https://cdn.example/x.png',
    '//dis.example/x.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '/api/media_player_proxy/media_player.baska?token=1',
    '/api/media_player_proxy/media_player.salon/../../states',
    '/api/media_player_proxy/media_player.salon?token=a b',
    '/api/media_player_proxy/media_player.salon?token=<x>',
    '/api/media_player_proxy/media_player.salon#parca',
    '/api/states/media_player.salon',
    '/api/media_player_proxy/media_player.salon?' + 'a'.repeat(400),
    '',
    5,
    null,
    ['/api/media_player_proxy/media_player.salon'],
  ];
  for (const kotu of kotuler) {
    assert.equal(K.kapakYolu(oynatici({ entity_picture: kotu })), null, JSON.stringify(kotu).slice(0, 80));
  }
  assert.equal(K.kapakYolu(oynatici({ entity_picture: undefined })), null);
  assert.equal(K.kapakYolu({ entity_id: 'media_player.salon', state: 'on' }), null, 'öznitelik yok');
  assert.equal(K.kapakYolu(null), null);
  assert.equal(K.kapakYolu(oynatici(), 'media_player.baska'), null, 'beklenen kimlik varlıkla uyuşmuyor');
});

test('kapakAnahtari: yol değişince değişir, sabit uzunlukta özettir ve jeton içermez', () => {
  const a = K.kapakAnahtari(YOL);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(K.kapakAnahtari(YOL), a);
  assert.notEqual(K.kapakAnahtari(YOL.replace('cache=77', 'cache=78')), a);
  assert.ok(!a.includes('abc123'));
  assert.equal(K.kapakAnahtari(null), null);
  assert.equal(K.kapakAnahtari(12), null);
});

// ---- resim doğrulaması -----------------------------------------------------------------------------------------------------

test('kapakVeriAdresi: jpeg / png / webp (VP8X, VP8L, VP8) geçerli baytlardan data adresi üretir; baytlar birebir korunur', () => {
  const ornekler = [
    ['image/png', png(640, 640)],
    ['image/jpeg', jpeg(300, 300)],
    ['image/webp', webpX(500, 500)],
    ['image/webp', webpL(500, 400)],
    ['image/webp', webpLossy(320, 240)],
  ];
  for (const [tur, bayt] of ornekler) {
    const sonuc = K.kapakVeriAdresi(tur, bayt);
    assert.equal(sonuc, adres(tur, bayt), tur);
    assert.match(sonuc, /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
    assert.deepEqual(Buffer.from(sonuc.split(',')[1], 'base64'), bayt);
  }
  assert.equal(K.kapakVeriAdresi('image/png', new Uint8Array(png())), adres('image/png', png()), 'Uint8Array de kabul edilir');
});

test('kapakVeriAdresi: SVG, gif, html, başlık-bayt uyuşmazlığı, boş / büyük gövde ve sınır dışı boyutlar reddedilir', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(K.kapakVeriAdresi('image/svg+xml', svg), null);
  assert.equal(K.kapakVeriAdresi('image/gif', Buffer.from('GIF89a......................')), null);
  assert.equal(K.kapakVeriAdresi('text/html', Buffer.from('<html></html>')), null);
  assert.equal(K.kapakVeriAdresi('', png()), null);
  assert.equal(K.kapakVeriAdresi(null, png()), null);
  assert.equal(K.kapakVeriAdresi('image/jpeg', png()), null, 'başlık jpeg, baytlar png');
  assert.equal(K.kapakVeriAdresi('image/png', jpeg()), null, 'başlık png, baytlar jpeg');
  assert.equal(K.kapakVeriAdresi('image/png', svg), null, 'başlık png, baytlar svg');
  assert.equal(K.kapakVeriAdresi('image/webp', Buffer.concat([png(), Buffer.alloc(20)])), null);
  assert.equal(K.kapakVeriAdresi('image/png', Buffer.alloc(0)), null);
  assert.equal(K.kapakVeriAdresi('image/png', null), null);
  assert.equal(K.kapakVeriAdresi('image/png', 'metin'), null);
  assert.equal(K.kapakVeriAdresi('image/png', Buffer.concat([png(), Buffer.alloc(K.KAPAK_EN_COK_BAYT)])), null, '600 KB aşılır');
  assert.notEqual(K.kapakVeriAdresi('image/png', Buffer.concat([png(), Buffer.alloc(K.KAPAK_EN_COK_BAYT - png().length)])), null, 'tam sınır kabul');
  assert.equal(K.kapakVeriAdresi('image/png', png(K.KENAR_SINIRI + 1, 10)), null, 'kenar sınırı');
  assert.equal(K.kapakVeriAdresi('image/png', png(10, K.KENAR_SINIRI + 1)), null);
  assert.equal(K.kapakVeriAdresi('image/png', png(4096, 4096)), null, '16,7 milyon piksel (sıkıştırma bombası)');
  assert.equal(K.kapakVeriAdresi('image/png', png(0, 10)), null);
  assert.equal(K.kapakVeriAdresi('image/jpeg', jpeg(0, 10)), null);
  assert.equal(K.kapakVeriAdresi('image/webp', webpX(5000, 10)), null);
  assert.equal(K.kapakVeriAdresi('image/jpeg', Buffer.from([0xff, 0xd8, 0xff])), null, 'kesik jpeg');
  assert.notEqual(K.kapakVeriAdresi('image/png', png(3000, 3000)), null, '9 milyon piksel sınırın içinde');
});

test('kapaklariKapat: yalnız media_player karolarının kapak bayrağı söner (grup, son ve üst kart); diğerlerine dokunulmaz', () => {
  const medya = (id) => ({ id, alan: 'media_player', ozellik: { durum: 'playing', kapak: true, kapakAnahtari: 'abcd1234' } });
  const model = {
    gruplar: [{ kod: 'medya', karolar: [medya('media_player.a'), { id: 'light.x', alan: 'light', ozellik: { kapak: true } }] }],
    sonlar: [medya('media_player.b')],
    bilgi: { kartlar: [{ tur: 'medya', karo: medya('media_player.c') }, { tur: 'saat', karo: null }, { tur: 'hava', karo: { id: 'weather.ev', alan: 'weather', ozellik: { durum: 'sunny' } } }] },
  };
  assert.equal(K.kapaklariKapat(model), model, 'model yerinde değişir');
  for (const k of [model.gruplar[0].karolar[0], model.sonlar[0], model.bilgi.kartlar[0].karo]) {
    assert.equal(k.ozellik.kapak, false);
    assert.equal(k.ozellik.kapakAnahtari, null);
    assert.equal(k.ozellik.durum, 'playing');
  }
  assert.equal(model.gruplar[0].karolar[1].ozellik.kapak, true, 'media_player olmayan karo dokunulmaz');
  assert.doesNotThrow(() => K.kapaklariKapat({}));
  assert.doesNotThrow(() => K.kapaklariKapat(null));
  assert.doesNotThrow(() => K.kapaklariKapat({ gruplar: [null, { karolar: [null, {}] }], sonlar: [null], bilgi: { kartlar: [null] } }));
});

// ---- sınırlı bayt okuyucu --------------------------------------------------------------------------------------------------

/** Bitmeyen akış: her çekişte 4 bayt verir. Okuyucu iptal ederse kaynağın cancel'ı çağrılır (iptalEdildi). */
const akisYaniti = (basliklar = {}) => {
  let iptal = false;
  const akis = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(4));
    },
    cancel() {
      iptal = true;
    },
  });
  const yanit = new Response(akis, { status: 200, headers: basliklar });
  return { yanit, iptalEdildi: () => iptal };
};

test('sinirliBaytOku: sınır içinde gövdeyi Buffer olarak döner; sınır aşılırsa null, bildirilen uzunluk büyükse hiç okunmaz', async () => {
  const ok = await sinirliBaytOku(new Response(Buffer.from('abcdef')), 10);
  assert.ok(Buffer.isBuffer(ok));
  assert.equal(ok.toString(), 'abcdef');
  assert.equal(await sinirliBaytOku(new Response(Buffer.from('abcdef')), 6).then((b) => b.toString()), 'abcdef', 'tam sınır');
  assert.equal(await sinirliBaytOku(new Response(Buffer.from('abcdefg')), 6), null);

  const akim = akisYaniti();
  assert.equal(await sinirliBaytOku(akim.yanit, 10), null, 'akış sınırı aşınca null (bitmeyen akış belleği şişirmez)');
  assert.equal(akim.iptalEdildi(), true, 'akış iptal edilir');

  const bildirilen = akisYaniti({ 'content-length': '999999' });
  assert.equal(await sinirliBaytOku(bildirilen.yanit, 100), null);
  assert.equal(bildirilen.iptalEdildi(), true, 'content-length büyükse gövde okunmadan iptal');

  assert.equal(await sinirliBaytOku(new Response(null), 10), null, 'gövde yok');
  assert.equal(await sinirliBaytOku(null, 10), null);
  for (const kotu of [0, -1, 1.5, NaN, undefined, '5']) assert.equal(await sinirliBaytOku(new Response(Buffer.from('a')), kotu), null, String(kotu));
});

// ---- haIstek ikili kipi ----------------------------------------------------------------------------------------------------

const ANAHTAR = 'TEST_ANAHTAR_000';
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const AYAR = { yerelAdres: 'http://192.168.1.10:8123', disAdres: 'https://ha.example.com', yerelZamanAsimiMs: 3000, disZamanAsimiMs: 10000 };
const manifestMi = (url) => url.endsWith('/manifest.json');

function istemciKur(yonlendirici) {
  const cagrilar = [];
  const gunlukler = [];
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, secenek });
      return yonlendirici(url, secenek);
    },
    ayarlarAl: () => AYAR,
    anahtarAl: async () => ANAHTAR,
    aktifAdresAl: () => null,
    yenidenBaglan: () => {},
    gunluk: (m) => gunlukler.push(m),
  });
  return { istemci, cagrilar, gunlukler, api: () => cagrilar.filter((c) => !manifestMi(c.url)) };
}
const resimYaniti = (bayt, tur = 'image/png', durum = 200, ek = {}) => new Response(bayt, { status: durum, headers: { 'content-type': tur, ...ek } });
const apiYaniti = (govde) => (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : govde(url));

test('haIstek ikili: Authorization gider, Accept yalnız resim türleri, JSON başlığı ve gövde yok; { icerikTuru, bayt } döner', async () => {
  const bayt = png(32, 32);
  const { istemci, api } = istemciKur(apiYaniti(() => resimYaniti(bayt, 'image/png; charset=binary')));
  const sonuc = await istemci.haIstek(YOL, { ikili: true, enCokBayt: K.KAPAK_EN_COK_BAYT });
  assert.equal(sonuc.icerikTuru, 'image/png', 'parametresiz ve küçük harf');
  assert.deepEqual(sonuc.bayt, bayt);
  const istek = api()[0];
  assert.equal(istek.url, `http://192.168.1.10:8123${YOL}`);
  assert.equal(istek.secenek.method, 'GET');
  assert.equal(istek.secenek.headers.Authorization, `Bearer ${ANAHTAR}`);
  assert.equal(istek.secenek.headers.Accept, 'image/jpeg, image/png, image/webp');
  assert.equal(istek.secenek.headers['Content-Type'], undefined);
  assert.equal(istek.secenek.body, undefined);
  assert.equal(istek.secenek.redirect, 'error');
  assert.equal(istek.secenek.credentials, 'omit');
});

test('haIstek ikili: içerik türü büyük harfle gelse de küçültülür; sınırı aşan gövde ve hata durumları HaHatasi olur, yanıt gövdesi sızmaz', async () => {
  const buyuk = istemciKur(apiYaniti(() => resimYaniti(png(), 'IMAGE/JPEG')));
  assert.equal((await buyuk.istemci.haIstek(YOL, { ikili: true, enCokBayt: 1000 })).icerikTuru, 'image/jpeg');

  const asan = istemciKur(apiYaniti(() => resimYaniti(Buffer.alloc(5000, 1))));
  await assert.rejects(() => asan.istemci.haIstek(YOL, { ikili: true, enCokBayt: 1000 }), (h) => h instanceof HaHatasi && h.tur === 'sunucu');

  const bildirilen = istemciKur(apiYaniti(() => resimYaniti(Buffer.alloc(10), 'image/png', 200, { 'content-length': '999999' })));
  await assert.rejects(() => bildirilen.istemci.haIstek(YOL, { ikili: true, enCokBayt: 1000 }), (h) => h.tur === 'sunucu');

  for (const [durum, tur] of [[401, 'yetki'], [403, 'yasak-erisim'], [404, 'bulunamadi'], [500, 'sunucu']]) {
    const { istemci } = istemciKur(apiYaniti(() => new Response('GIZLI-GOVDE ' + ANAHTAR, { status: durum })));
    await assert.rejects(
      () => istemci.haIstek(YOL, { ikili: true, enCokBayt: 1000 }),
      (h) => h.tur === tur && !String(h.message).includes('GIZLI-GOVDE') && !String(h.message).includes(ANAHTAR),
      String(durum),
    );
  }
});

test('haIstek ikili: yalnız GET ve yalnız pozitif bayt sınırıyla; geçersiz birleşimde ağa hiç çıkılmaz; JSON kipi değişmez', async () => {
  const { istemci, cagrilar } = istemciKur(apiYaniti(() => resimYaniti(png())));
  for (const secenek of [
    { ikili: true },
    { ikili: true, enCokBayt: 0 },
    { ikili: true, enCokBayt: -5 },
    { ikili: true, enCokBayt: 1.5 },
    { ikili: true, enCokBayt: '100' },
    { ikili: true, enCokBayt: 1000, yontem: 'POST', govde: {} },
    { ikili: true, enCokBayt: 1000, yontem: 'DELETE' },
  ]) {
    await assert.rejects(() => istemci.haIstek(YOL, secenek), (h) => h instanceof HaHatasi, JSON.stringify(secenek));
  }
  assert.equal(cagrilar.length, 0, 'hiçbir istek gitmedi');

  const json = istemciKur(apiYaniti(() => new Response(JSON.stringify({ entity_id: 'light.a', state: 'on' }), { status: 200 })));
  assert.deepEqual(await json.istemci.haIstek('/api/states/light.a'), { entity_id: 'light.a', state: 'on' });
  const baslik = json.api()[0].secenek.headers;
  assert.equal(baslik['Content-Type'], 'application/json');
  assert.equal(baslik.Accept, 'application/json');
});

// ---- ha-okuma medyaKapagi --------------------------------------------------------------------------------------------------

function kapakOkumasi({ durumlar, istek }) {
  let saat = Date.parse('2026-10-17T12:00:00Z');
  const istekler = [];
  const gunlukler = [];
  const okuma = haOkumaOlustur({
    haIstek: async (yol, secenek) => {
      istekler.push({ yol, secenek });
      return istek(yol, secenek);
    },
    ws: null,
    durumAl: (k) => durumlar[k],
    simdi: () => saat,
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  return { okuma, istekler, gunlukler, ilerle: (ms) => (saat += ms) };
}
const PNG = png(64, 64);
const tamam = async () => ({ icerikTuru: 'image/png', bayt: PNG });

test('medyaKapagi: vekil yolu ikili kipte çekilir, data adresi döner; ikinci çağrı önbellekten, 30 dk sonra yeniden', async () => {
  const o = kapakOkumasi({ durumlar: { 'media_player.salon': oynatici() }, istek: tamam });
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), adres('image/png', PNG));
  assert.equal(o.istekler.length, 1);
  assert.equal(o.istekler[0].yol, YOL);
  assert.deepEqual(o.istekler[0].secenek, { ikili: true, enCokBayt: K.KAPAK_EN_COK_BAYT });
  await o.okuma.medyaKapagi('media_player.salon');
  assert.equal(o.istekler.length, 1, 'önbellekten');
  o.ilerle(29 * 60_000);
  await o.okuma.medyaKapagi('media_player.salon');
  assert.equal(o.istekler.length, 1);
  o.ilerle(2 * 60_000);
  await o.okuma.medyaKapagi('media_player.salon');
  assert.equal(o.istekler.length, 2, '30 dk dolunca yeniden');
});

test('medyaKapagi: aynı anda gelen istekler tek çekimi paylaşır; parça değişince (yeni yol) yeniden çekilir', async () => {
  const durumlar = { 'media_player.salon': oynatici() };
  let coz;
  const o = kapakOkumasi({ durumlar, istek: () => new Promise((c) => (coz = () => c({ icerikTuru: 'image/png', bayt: PNG }))) });
  const a = o.okuma.medyaKapagi('media_player.salon');
  const b = o.okuma.medyaKapagi('media_player.salon');
  await new Promise((r) => setImmediate(r));
  coz();
  assert.equal(await a, await b);
  assert.equal(o.istekler.length, 1);

  durumlar['media_player.salon'] = oynatici({ entity_picture: '/api/media_player_proxy/media_player.salon?token=abc123&cache=78' });
  const c = o.okuma.medyaKapagi('media_player.salon');
  await new Promise((r) => setImmediate(r));
  coz();
  await c;
  assert.equal(o.istekler.length, 2, 'yeni yol = yeni kapak');
});

test('medyaKapagi: KAPI KURALI ve alan sınırı: media_player olmayan, kapı adlı ya da kilit varlığı için ağa çıkılmaz', async () => {
  const durumlar = {
    'media_player.kapi_zili': oynatici({ friendly_name: 'Kapı zili hoparlörü', entity_picture: '/api/media_player_proxy/media_player.kapi_zili?token=1' }, 'media_player.kapi_zili'),
    'media_player.garaj': oynatici({ friendly_name: 'Garaj kapısı müzik', entity_picture: '/api/media_player_proxy/media_player.garaj?token=1' }, 'media_player.garaj'),
    'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21', attributes: { entity_picture: '/api/media_player_proxy/media_player.salon?token=1' } },
    'lock.on_kapi': { entity_id: 'lock.on_kapi', state: 'locked', attributes: { entity_picture: YOL } },
    'camera.bahce': { entity_id: 'camera.bahce', state: 'idle', attributes: { entity_picture: '/api/camera_proxy/camera.bahce?token=1' } },
  };
  const o = kapakOkumasi({ durumlar, istek: tamam });
  for (const k of ['media_player.kapi_zili', 'media_player.garaj', 'sensor.sicaklik', 'lock.on_kapi', 'camera.bahce', 'media_player.yok', 'bozuk', '', null, 5, 'media_player.' + 'a'.repeat(100)]) {
    assert.equal(await o.okuma.medyaKapagi(k), null, String(k));
  }
  assert.deepEqual(o.istekler.filter((i) => i.yol.includes('media_player_proxy')), [], 'hiçbir kapak isteği gitmedi');
  assert.ok(o.istekler.every((i) => /^\/api\/states\/media_player\./.test(i.yol)), 'bilinmeyen oynatıcılar için yalnız durum okuması yapıldı');
});

test('medyaKapagi: mutlak entity_picture asla çekilmez; kapak olmayan oynatıcı boş döner', async () => {
  const durumlar = {
    'media_player.dis': oynatici({ entity_picture: 'https://cdn.example/albums/x.jpg' }, 'media_player.dis'),
    'media_player.bos': { entity_id: 'media_player.bos', state: 'idle', attributes: { friendly_name: 'Boş' } },
  };
  const o = kapakOkumasi({ durumlar, istek: tamam });
  assert.equal(await o.okuma.medyaKapagi('media_player.dis'), null);
  assert.equal(await o.okuma.medyaKapagi('media_player.bos'), null);
  assert.equal(o.istekler.length, 0);
});

test('medyaKapagi: geçersiz resim, SVG ve ağ hatası boş döner; hata 30 sn önbelleklenir, günlükte yalnız sabit metin', async () => {
  let mod = 'html';
  const gizli = 'http://192.168.1.10:8123 Bearer GIZLI';
  const o = kapakOkumasi({
    durumlar: { 'media_player.salon': oynatici() },
    istek: async () => {
      if (mod === 'ag') throw Object.assign(new Error(gizli), { tur: 'ag' });
      if (mod === 'html') return { icerikTuru: 'text/html', bayt: Buffer.from('<html>') };
      if (mod === 'svg') return { icerikTuru: 'image/svg+xml', bayt: Buffer.from('<svg/>') };
      return { icerikTuru: 'image/png', bayt: PNG };
    },
  });
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), null, 'html');
  assert.equal(o.istekler.length, 1);
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), null);
  assert.equal(o.istekler.length, 1, 'başarısız sonuç 30 sn önbellekte');
  o.ilerle(31_000);
  mod = 'svg';
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), null, 'svg reddedilir');
  o.ilerle(31_000);
  mod = 'ag';
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), null);
  assert.ok(o.gunlukler.length >= 1);
  assert.ok(!JSON.stringify(o.gunlukler).includes('GIZLI') && !JSON.stringify(o.gunlukler).includes('192.168'));
  o.ilerle(31_000);
  mod = 'iyi';
  assert.equal(await o.okuma.medyaKapagi('media_player.salon'), adres('image/png', PNG), 'sonra düzelirse kapak gelir');
});

test(`medyaKapagi: dakikada en çok ${DAKIKA_SINIRI} ağ okuması; bellekte en çok 6 kapak tutulur (en eskisi çıkar)`, async () => {
  const durumlar = {};
  for (let i = 0; i < DAKIKA_SINIRI + 6; i += 1) durumlar[`media_player.m${i}`] = oynatici({ entity_picture: `/api/media_player_proxy/media_player.m${i}?token=${i}` }, `media_player.m${i}`);
  const o = kapakOkumasi({ durumlar, istek: tamam });
  for (let i = 0; i < DAKIKA_SINIRI; i += 1) assert.ok(await o.okuma.medyaKapagi(`media_player.m${i}`), `m${i}`);
  assert.equal(o.istekler.length, DAKIKA_SINIRI);
  assert.equal(await o.okuma.medyaKapagi(`media_player.m${DAKIKA_SINIRI}`), null, 'sınırda boş');
  assert.equal(o.istekler.length, DAKIKA_SINIRI);
  // en eski kapak (m0) 6'dan fazla kapak yüzünden önbellekten çıkmıştır: dakika dolunca yeniden çekilir, m29 hâlâ önbellekte
  o.ilerle(61_000);
  const once = o.istekler.length;
  await o.okuma.medyaKapagi(`media_player.m${DAKIKA_SINIRI - 1}`);
  assert.equal(o.istekler.length, once, 'son kapaklar önbellekte');
  await o.okuma.medyaKapagi('media_player.m0');
  assert.equal(o.istekler.length, once + 1, 'en eski kapak çıkmıştı');
});

test('yuzey:oku "kapak" türü: kimlik doğrulanır, kayıtsız oynatıcı okunamaz, veri data adresi ya da null', async () => {
  const cagrilar = [];
  const okuma = { medyaKapagi: async (k) => (cagrilar.push(k), k === 'media_player.salon' ? 'data:image/png;base64,AAAA' : null) };
  const kayitli = new Set(['media_player.salon', 'media_player.yok']);
  const kayitliMi = (k) => kayitli.has(k);
  for (const kotu of [{ tur: 'kapak' }, { tur: 'kapak', kimlik: 5 }, { tur: 'kapak', kimlik: 'x' }, { tur: 'kapak', kimlik: 'MEDIA_PLAYER.A' }, { tur: 'kapak', kimlik: 'media_player.' + 'a'.repeat(200) }]) {
    assert.deepEqual(await yuzeyOkumasi(okuma, kotu, kayitliMi), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
  }
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'kapak', kimlik: 'media_player.baska' }, kayitliMi), { ok: false, tur: 'kayitsiz' });
  assert.equal(cagrilar.length, 0);
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'kapak', kimlik: 'media_player.salon' }, kayitliMi), { ok: true, veri: 'data:image/png;base64,AAAA' });
  assert.deepEqual(await yuzeyOkumasi(okuma, { tur: 'kapak', kimlik: 'media_player.yok' }, kayitliMi), { ok: true, veri: null });
  assert.deepEqual(cagrilar, ['media_player.salon', 'media_player.yok']);
});

// ---- karo modeli ve ayar ---------------------------------------------------------------------------------------------------

test('medya modeli: kapak bayrağı ve yol özeti vardır; yolun kendisi, jeton ve HA adresi renderer\'a gidecek modelde yoktur', () => {
  const o = guvenliOzellikler(oynatici({ media_title: 'Şarkı', media_artist: 'Sanatçı' }));
  assert.equal(o.kapak, true);
  assert.equal(o.kapakAnahtari, K.kapakAnahtari(YOL));
  const metin = JSON.stringify(o);
  for (const yasak of ['abc123', 'media_player_proxy', 'entity_picture', 'token', 'http']) assert.ok(!metin.includes(yasak), yasak);
  assert.deepEqual(Object.keys(o).filter((a) => /kapak|resim|picture|image/i.test(a)).sort(), ['kapak', 'kapakAnahtari']);

  const yok = guvenliOzellikler(oynatici({ entity_picture: 'https://cdn.example/x.jpg' }));
  assert.equal(yok.kapak, false);
  assert.equal(yok.kapakAnahtari, null);
  const bos = guvenliOzellikler({ entity_id: 'media_player.a', state: 'idle', attributes: {} });
  assert.equal(bos.kapak, false);
  assert.equal(bos.kapakAnahtari, null);
});

test('ayar alanı medyaKapagi: varsayılan true, yalnız mantıksal değer; bozuk dosya değeri varsayılana düşer, dışa aktarılır, şema 6 kalır', () => {
  const alan = A.AYAR_ALANLARI.find((a) => a.ad === 'medyaKapagi');
  assert.ok(alan);
  assert.equal(alan.varsayilan, true);
  assert.equal(alan.duzelt(true), true);
  assert.equal(alan.duzelt(false), false);
  for (const kotu of ['false', 0, 1, null, undefined, [], {}]) assert.equal(alan.duzelt(kotu), undefined, JSON.stringify(kotu));
  assert.equal(A.alanlariDuzelt({}, {}).medyaKapagi, true);
  assert.equal(A.alanlariDuzelt({ medyaKapagi: 'x' }, {}).medyaKapagi, true);
  assert.equal(A.alanlariDuzelt({ medyaKapagi: false }, {}).medyaKapagi, false);
  const { yeni, uyarilar } = A.ekGirdiDogrula({ medyaKapagi: false }, TR);
  assert.equal(yeni.medyaKapagi, false);
  assert.deepEqual(uyarilar, []);
  assert.deepEqual(A.ekGirdiDogrula({ medyaKapagi: 'evet' }, TR).uyarilar.map((u) => u.alan), ['medyaKapagi']);
  assert.ok(A.aktarilanAlanlar().includes('medyaKapagi'));
  const sema = require('../src/lib/ayar-sema');
  assert.equal(sema.SEMA_SURUMU, 6, 'şema sürümü yükseltilmedi');
});

test('main.js: kapak kapalıyken model kapaklariKapat\'tan geçer; medyaKapagi / havaTahmini / birincilMedya değişimleri paneli yeniler', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(kaynak, /ayarlar\?\.medyaKapagi === false \? kapaklariKapat\(model\) : model/);
  assert.match(kaynak, /'sensorTepsiIpucu', 'havaTahmini', 'medyaKapagi'\]/);
  assert.match(kaynak, /'havaVarligi', 'birincilMedya', 'takvimler'/);
  assert.match(kaynak, /require\('\.\/lib\/medya-kapagi'\)/);
});
