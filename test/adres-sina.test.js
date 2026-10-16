'use strict';

/**
 * k-14: "Bağlantıyı sına" (src/lib/adres-sina.js). Ağ yok: fetch sahtedir. Asıl güvence: istek ANAHTAR taşımaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { adresSinayiciOlustur, SONUC_METINLERI } = require('../src/lib/adres-sina');

const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant' });

function sinayici({ yanit, hata, zamanAsimiMs } = {}) {
  const istekler = [];
  const gunlukler = [];
  const fetch = async (url, secenek) => {
    istekler.push({ url, secenek });
    if (hata) throw hata;
    if (typeof yanit === 'function') return yanit(url, secenek);
    return new Response(HA_MANIFEST, { status: 200 });
  };
  return { ...adresSinayiciOlustur({ fetch, zamanAsimiMs, gunluk: (m) => gunlukler.push(m) }), istekler, gunlukler };
}

test('Home Assistant adresi: tek GET /manifest.json isteği gider; kimlik bilgisi, Authorization başlığı ve yönlendirme YOK', async () => {
  const s = sinayici();
  const sonuc = await s.sina('http://192.168.1.10:8123', 'yerel');
  assert.deepEqual(sonuc, { ok: true, ulasilabilir: true, neden: 'tamam', mesaj: SONUC_METINLERI.tamam });
  assert.equal(s.istekler.length, 1);
  assert.equal(s.istekler[0].url, 'http://192.168.1.10:8123/manifest.json');
  const { method, credentials, redirect, headers } = s.istekler[0].secenek;
  assert.equal(method, 'GET');
  assert.equal(credentials, 'omit');
  assert.equal(redirect, 'error');
  assert.equal(headers, undefined, 'hiçbir başlık (Authorization dahil) eklenmez');
  assert.ok(!JSON.stringify(s.istekler[0].secenek).toLowerCase().includes('authorization'));
});

test('adres yoluyla ya da sondaki eğik çizgiyle yazılsa da köke gider (sonuç ayarlardaki köken gibi)', async () => {
  const s = sinayici();
  await s.sina('  https://ha.example.com/lovelace/ev?x=1  ', 'dis');
  assert.equal(s.istekler[0].url, 'https://ha.example.com/manifest.json');
});

test('Home Assistant olmayan yanıt, 403, 5xx, beklenmeyen kod: ulaşılamaz sayılır ve nedeni söylenir', async () => {
  const durumlar = [
    [() => new Response('<html>yazıcı</html>', { status: 200 }), 'ha-degil'],
    [() => new Response('', { status: 403 }), 'erisim-engelli'],
    [() => new Response('', { status: 502 }), 'sunucu-hatasi'],
    [() => new Response('', { status: 404 }), 'beklenmeyen-durum'],
    [() => new Response('', { status: 302, headers: { location: 'https://baska.example' } }), 'yonlendirme'],
  ];
  for (const [yanit, neden] of durumlar) {
    const sonuc = await sinayici({ yanit }).sina('http://192.168.1.10:8123', 'yerel');
    assert.equal(sonuc.ok, true, neden);
    assert.equal(sonuc.ulasilabilir, false, neden);
    assert.equal(sonuc.neden, neden);
    assert.equal(sonuc.mesaj, SONUC_METINLERI[neden]);
  }
});

test('ağ hatası, yönlendirme hatası ve zaman aşımı: ulaşılamadı / yönlendirme; ayrıntı günlüğe yazılmaz', async () => {
  const ag = await sinayici({ hata: new TypeError('fetch failed: ECONNREFUSED 192.168.1.10') }).sina('http://192.168.1.10:8123', 'yerel');
  assert.deepEqual([ag.ok, ag.ulasilabilir, ag.neden], [true, false, 'ulasilamadi']);

  const yonlendirme = sinayici({ hata: new TypeError('Attempted to redirect to https://x') });
  const y = await yonlendirme.sina('http://192.168.1.10:8123', 'yerel');
  assert.equal(y.neden, 'yonlendirme');
  assert.ok(yonlendirme.gunlukler.every((m) => !m.includes('192.168') && !m.includes('redirect to')), 'günlükte adres/ayrıntı yok');

  const yavas = sinayici({
    zamanAsimiMs: 20,
    yanit: (_url, secenek) => new Promise((_coz, reddet) => secenek.signal.addEventListener('abort', () => reddet(new Error('aborted')))),
  });
  const z = await yavas.sina('http://192.168.1.10:8123', 'yerel');
  assert.deepEqual([z.ok, z.ulasilabilir, z.neden], [true, false, 'ulasilamadi']);
});

test('geçersiz adres sınanmaz (istek hiç gitmez): boş, şemasız, kimlik bilgili, herkese açık http, dışta http', async () => {
  const s = sinayici();
  for (const [adres, tur] of [
    ['', 'yerel'],
    ['192.168.1.10:8123', 'yerel'],
    ['ftp://192.168.1.10', 'yerel'],
    ['http://kullanici:parola@192.168.1.10:8123', 'yerel'],
    ['http://ha.example.com', 'yerel'],
    ['http://192.168.1.10:8123', 'dis'],
    ['http://ha.example.com', 'dis'],
    [null, 'yerel'],
    [42, 'dis'],
  ]) {
    const sonuc = await s.sina(adres, tur);
    assert.equal(sonuc.ok, false, `${adres} ${tur}`);
    assert.ok(typeof sonuc.hata === 'string' && sonuc.hata.length > 10);
  }
  assert.equal(s.istekler.length, 0, 'hiçbir geçersiz adrese istek gitmedi');
});

test('dış adres https ile sınanır; ev içi adres https de olabilir', async () => {
  const s = sinayici();
  assert.equal((await s.sina('https://ha.example.com', 'dis')).ulasilabilir, true);
  assert.equal((await s.sina('https://ev.local:8123', 'yerel')).ulasilabilir, true);
  assert.deepEqual(s.istekler.map((i) => i.url), ['https://ha.example.com/manifest.json', 'https://ev.local:8123/manifest.json']);
});
