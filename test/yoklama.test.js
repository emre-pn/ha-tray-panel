'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { YOKLAMA_GOVDE_SINIRI_BAYT, manifestHaMi, sinirliOku, yoklamaDegerlendir, sayfaYanitiBozukMu } = require('../src/lib/yoklama');

// HA'nın /manifest.json yanıtına benzeyen örnek: yalnız name ("Home Assistant") ve id alanları gerçek yanıttan doğrulandı;
// diğer alanlar (açıklama, simgeler...) örnek amaçlıdır ve doğrulamayı etkilemez (yalnız name sınanır).
const HA_MANIFEST = JSON.stringify({
  background_color: '#FFFFFF',
  description: 'Home automation platform that puts local control and privacy first.',
  dir: 'ltr',
  display: 'standalone',
  icons: [{ src: '/static/icons/favicon-192x192.png', sizes: '192x192', type: 'image/png' }],
  id: '/?homescreen=1',
  lang: 'en-US',
  name: 'Home Assistant',
  short_name: 'Assistant',
  start_url: '/?homescreen=1',
});

test('2xx ulaşılabilir', () => {
  for (const durum of [200, 204, 299]) {
    assert.deepEqual(yoklamaDegerlendir({ durum }), { ulasilabilir: true, neden: 'tamam' }, String(durum));
  }
});

test('5xx sunucu hatası: Cloudflare hata sayfaları "bağlandı" sayılmaz (hata-02)', () => {
  for (const durum of [500, 502, 503, 504, 521, 522, 523, 524, 530]) {
    assert.deepEqual(yoklamaDegerlendir({ durum }), { ulasilabilir: false, neden: 'sunucu-hatasi' }, String(durum));
  }
});

test('403 erişim engelli', () => {
  assert.deepEqual(yoklamaDegerlendir({ durum: 403 }), { ulasilabilir: false, neden: 'erisim-engelli' });
});

test('yalnız 5xx ve 403 ulaşılamaz; 401, 404, 429, 3xx gibi diğer yanıtlar eskisi gibi ulaşılabilir (hata-02 kapsamı)', () => {
  for (const durum of [404, 401, 301, 302, 304, 400, 429, 418]) {
    assert.deepEqual(yoklamaDegerlendir({ durum }), { ulasilabilir: true, neden: 'tamam' }, String(durum));
  }
});

test('sayısal olmayan durum güvenle reddedilir', () => {
  for (const durum of [undefined, null, '200', NaN, 200.5]) {
    assert.equal(yoklamaDegerlendir({ durum }).ulasilabilir, false, String(durum));
  }
});

test('sayfaYanitiBozukMu: yalnız 5xx ve 403; HA’nın kendi 404 sayfası bozuk sayılmaz', () => {
  for (const kod of [403, 500, 502, 503, 521, 530]) assert.equal(sayfaYanitiBozukMu(kod), true, String(kod));
  for (const kod of [200, 204, 301, 304, 400, 401, 404, 429, -1, 0, undefined, null, '502']) {
    assert.equal(sayfaYanitiBozukMu(kod), false, String(kod));
  }
});

// --- hata-01: içerik doğrulaması ------------------------------------------------

test('manifestHaMi: gerçek HA manifest yanıtı kabul edilir', () => {
  assert.equal(manifestHaMi(HA_MANIFEST), true);
  assert.equal(manifestHaMi(JSON.stringify({ name: 'HOME ASSISTANT' })), true);
  assert.equal(manifestHaMi(JSON.stringify({ name: 'Home Assistant (Test)' })), true);
});

test('manifestHaMi: Cloudflare/yönlendirici HTML sayfası, farklı ürün, boş ve bozuk gövde reddedilir', () => {
  const html = '<!DOCTYPE html><html><head><title>Error 1033</title></head><body>Cloudflare Tunnel error</body></html>';
  for (const metin of [
    html,
    JSON.stringify({ name: 'Başka Ürün', short_name: 'X' }),
    JSON.stringify({ short_name: 'Assistant' }),
    JSON.stringify({ name: 42 }),
    JSON.stringify([{ name: 'Home Assistant' }]),
    JSON.stringify('Home Assistant'),
    'null',
    '',
    '{',
    null,
    undefined,
    42,
  ]) {
    assert.equal(manifestHaMi(metin), false, String(metin).slice(0, 40));
  }
  assert.equal(manifestHaMi(JSON.stringify({ name: 'Home Assistant', pad: 'x'.repeat(YOKLAMA_GOVDE_SINIRI_BAYT) })), false);
});

test('içerik doğrulamalı yoklama: HA manifest 200 -> ulaşılabilir', () => {
  assert.deepEqual(yoklamaDegerlendir({ durum: 200, metin: HA_MANIFEST, icerikDogrula: true }), { ulasilabilir: true, neden: 'tamam' });
});

test('içerik doğrulamalı yoklama: HTML hata sayfası 200 ise "ha-degil", 5xx ise "sunucu-hatasi"', () => {
  const html = '<html>Error</html>';
  assert.deepEqual(yoklamaDegerlendir({ durum: 200, metin: html, icerikDogrula: true }), { ulasilabilir: false, neden: 'ha-degil' });
  assert.deepEqual(yoklamaDegerlendir({ durum: 521, metin: html, icerikDogrula: true }), { ulasilabilir: false, neden: 'sunucu-hatasi' });
  assert.deepEqual(yoklamaDegerlendir({ durum: 403, metin: html, icerikDogrula: true }), { ulasilabilir: false, neden: 'erisim-engelli' });
});

test('içerik doğrulamalı yoklama: JSON ama farklı ürün, boş gövde ya da gövdesiz yanıt "ha-degil"', () => {
  for (const metin of [JSON.stringify({ name: 'Başka' }), '', null]) {
    assert.deepEqual(yoklamaDegerlendir({ durum: 200, metin, icerikDogrula: true }), { ulasilabilir: false, neden: 'ha-degil' });
  }
  assert.deepEqual(yoklamaDegerlendir({ durum: 200, icerikDogrula: true }), { ulasilabilir: false, neden: 'ha-degil' });
});

test('içerik doğrulamalı yoklama: 2xx dışı yanıtlar (404, 401, 429, 400) ulaşılamaz — rastgele cihaz anahtar almasın', () => {
  for (const durum of [404, 401, 429, 400, 199]) {
    assert.deepEqual(yoklamaDegerlendir({ durum, metin: HA_MANIFEST, icerikDogrula: true }), { ulasilabilir: false, neden: 'beklenmeyen-durum' }, String(durum));
  }
});

test('içerik doğrulamalı yoklama: 3xx "yonlendirme" nedeniyle ulaşılamaz (yönlendirilen yanıt ayardaki adresi doğrulamaz)', () => {
  for (const durum of [301, 302, 303, 307, 308]) {
    assert.deepEqual(yoklamaDegerlendir({ durum, metin: HA_MANIFEST, icerikDogrula: true }), { ulasilabilir: false, neden: 'yonlendirme' }, String(durum));
  }
});

test('içerik doğrulaması kapalıyken eski davranış değişmez (metin yok sayılır)', () => {
  assert.equal(yoklamaDegerlendir({ durum: 200, metin: '<html>', icerikDogrula: false }).ulasilabilir, true);
  assert.equal(yoklamaDegerlendir({ durum: 404 }).ulasilabilir, true);
});

const akis = (parcalar) => {
  let sira = 0;
  let iptal = 0;
  return {
    iptalSayisi: () => iptal,
    yanit: {
      body: {
        getReader: () => ({
          read: async () => (sira < parcalar.length ? { done: false, value: parcalar[sira++] } : { done: true }),
          cancel: async () => {
            iptal += 1;
          },
        }),
      },
    },
  };
};

test('sinirliOku: gövdeyi okur, akışı iptal eder', async () => {
  const { yanit, iptalSayisi } = akis([new TextEncoder().encode('{"name":'), new TextEncoder().encode('"Home Assistant"}')]);
  assert.equal(await sinirliOku(yanit), '{"name":"Home Assistant"}');
  assert.equal(iptalSayisi(), 1);
});

test('sinirliOku: devasa gövde sınırda kesilir (null) ve akış iptal edilir; gövdesiz yanıt null', async () => {
  const buyuk = new Uint8Array(40_000);
  const { yanit, iptalSayisi } = akis([buyuk, buyuk, buyuk, buyuk]);
  assert.equal(await sinirliOku(yanit, 65536), null);
  assert.equal(iptalSayisi(), 1);
  assert.equal(await sinirliOku({ body: null }), null);
  assert.equal(await sinirliOku(undefined), null);
});

test('sinirliOku: gerçek Response gövdesiyle çalışır (Node fetch API)', async () => {
  assert.equal(await sinirliOku(new Response(HA_MANIFEST, { status: 200 })), HA_MANIFEST);
  assert.equal(await sinirliOku(new Response('', { status: 200 })), '');
});

test('sinirliOku: Türkçe karakterler UTF-8 olarak çözülür', async () => {
  assert.equal(await sinirliOku(new Response('{"ad":"Işık ğüşiö"}')), '{"ad":"Işık ğüşiö"}');
});
