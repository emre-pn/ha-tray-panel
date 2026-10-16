'use strict';

/**
 * HA REST istemcisi (src/ha-istemcisi.js): sahte fetch ile. Gerçek ağ kullanılmaz; anahtar sahte bir değerdir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { HaHatasi, hataMetni, haIstemcisiOlustur } = require('../src/ha-istemcisi');

const ANAHTAR = 'TEST_ANAHTAR_000';
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const AYAR = {
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  yerelZamanAsimiMs: 3000,
  disZamanAsimiMs: 10000,
};
const json = (govde, status = 200) => new Response(JSON.stringify(govde), { status });

/** `yonlendirici(url, secenek, cagriNo)` Response döner ya da fırlatır. */
function kur({ yonlendirici, ayar = AYAR, aktif = null, anahtar = ANAHTAR }) {
  const cagrilar = [];
  const gunlukler = [];
  const baglanmalar = [];
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, secenek });
      return yonlendirici(url, secenek, cagrilar.length);
    },
    ayarlarAl: () => ayar,
    anahtarAl: async () => anahtar,
    aktifAdresAl: () => aktif,
    yenidenBaglan: (secim) => baglanmalar.push(secim),
    gunluk: (m) => gunlukler.push(m),
  });
  return { istemci, cagrilar, gunlukler, baglanmalar };
}

const manifestMi = (url) => url.endsWith('/manifest.json');
const apiCagrilari = (cagrilar) => cagrilar.filter((c) => !manifestMi(c.url));

// --- adres seçimi ve içerik doğrulaması (hata-01) -------------------------------

test('adresSec: ev içi adres gerçekten HA ise ev içi seçilir; yoklama anahtarsızdır', async () => {
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }) });
  assert.deepEqual(await istemci.adresSec(), { adres: 'http://192.168.1.10:8123', tur: 'yerel' });
  assert.equal(cagrilar.length, 1);
  assert.equal(cagrilar[0].url, 'http://192.168.1.10:8123/manifest.json');
  assert.equal(cagrilar[0].secenek.headers, undefined, 'yoklamada Authorization ya da başka başlık yok');
  assert.equal(cagrilar[0].secenek.credentials, 'omit');
});

test('hata-01: ev içi adres HTTP 200 dönen ama HA OLMAYAN bir cihazsa (HTML) seçilmez, dış adrese geçilir', async () => {
  const { istemci, cagrilar, gunlukler } = kur({
    yonlendirici: (url) => (url.startsWith('http://192.168') ? new Response('<html>Yönlendirici</html>', { status: 200 }) : new Response(HA_MANIFEST, { status: 200 })),
  });
  assert.deepEqual(await istemci.adresSec(), { adres: 'https://ha.example.com', tur: 'dis' });
  assert.equal(cagrilar.length, 2);
  assert.ok(gunlukler.includes('Yoklama ulaşılamaz saydı: ha-degil'));
});

test('hata-01: JSON ama başka ürün ya da 404 dönen cihaz HA sayılmaz', async () => {
  for (const yanit of [() => json({ name: 'Başka Ürün' }), () => new Response('yok', { status: 404 }), () => new Response('', { status: 200 })]) {
    const { istemci } = kur({ yonlendirici: yanit });
    assert.equal(await istemci.adresSec(), null);
  }
});

test('hata-02: Cloudflare hata sayfaları (5xx, 403) ve 200 HTML sayfası dış adreste de "bağlandı" sayılmaz', async () => {
  for (const yanit of [() => new Response('<html>Error 1033</html>', { status: 530 }), () => new Response('x', { status: 403 }), () => new Response('<html>Tunnel</html>', { status: 200 })]) {
    const { istemci } = kur({ yonlendirici: yanit });
    assert.equal(await istemci.adresSec(), null);
  }
});

test('soru-7: ev içi adres https:// olabilir; yoklama https adrese gider, sertifika bastırma seçeneği yok', async () => {
  const { istemci, cagrilar } = kur({
    ayar: { ...AYAR, yerelAdres: 'https://ha.ev.lan:8123' },
    yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }),
  });
  assert.deepEqual(await istemci.adresSec(), { adres: 'https://ha.ev.lan:8123', tur: 'yerel' });
  assert.equal(cagrilar[0].url, 'https://ha.ev.lan:8123/manifest.json');
  assert.deepEqual(Object.keys(cagrilar[0].secenek).sort(), ['credentials', 'method', 'redirect', 'signal']);
});

// --- yönlendirme ve düz http koruması (Dalga 2 denetimi) -------------------------

test('yoklama yönlendirmeyi izlemez (redirect: error) ve anahtarsızdır', async () => {
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }) });
  await istemci.adresSec();
  assert.equal(cagrilar[0].secenek.redirect, 'error');
  assert.equal(cagrilar[0].secenek.headers, undefined);
});

test('ev içi adres http->https yönlendiriyorsa seçilmez, nedeni günlüğe yazılır; dış adrese geçilir', async () => {
  // Gerçek net.fetch / undici redirect: 'error' ile yönlendirmeyi reddeder; sahte fetch aynısını taklit eder.
  const { istemci, cagrilar, gunlukler } = kur({
    yonlendirici: (url, secenek) => {
      if (url.startsWith('http://192.168') && secenek.redirect === 'error') {
        throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      }
      return new Response(HA_MANIFEST, { status: 200 });
    },
  });
  assert.deepEqual(await istemci.adresSec(), { adres: 'https://ha.example.com', tur: 'dis' });
  assert.equal(cagrilar.length, 2);
  assert.ok(gunlukler.includes('Yoklama ulaşılamaz saydı: yonlendirme'));
});

test('Electron biçimli yönlendirme hatası da "yonlendirme" olarak günlüğe yazılır; bağlantı hatası yazılmaz', async () => {
  const yonlendirme = kur({
    yonlendirici: (url) => {
      if (url.startsWith('http://192.168')) throw new Error("Attempted to redirect, but redirect policy was 'error'");
      return new Response(HA_MANIFEST, { status: 200 });
    },
  });
  await yonlendirme.istemci.adresSec();
  assert.ok(yonlendirme.gunlukler.includes('Yoklama ulaşılamaz saydı: yonlendirme'));
  const baglanti = kur({
    yonlendirici: (url) => {
      if (url.startsWith('http://192.168')) throw new TypeError('fetch failed');
      return new Response(HA_MANIFEST, { status: 200 });
    },
  });
  await baglanti.istemci.adresSec();
  assert.deepEqual(baglanti.gunlukler, []);
});

test('yoklama 3xx yanıt görürse ("manual" gibi) ev içi adres seçilmez, neden "yonlendirme"', async () => {
  const { istemci, gunlukler } = kur({
    yonlendirici: (url) => (url.startsWith('http://192.168') ? new Response('', { status: 301, headers: { location: 'https://x/' } }) : new Response(HA_MANIFEST)),
  });
  assert.deepEqual(await istemci.adresSec(), { adres: 'https://ha.example.com', tur: 'dis' });
  assert.ok(gunlukler.includes('Yoklama ulaşılamaz saydı: yonlendirme'));
});

test('k-19: 100.64.0.0/10 (CGNAT) http ev içi adres yalnız içerik doğrulamalı anahtarsız yoklamadan sonra kullanılır; HA olmayan cihaza anahtar gitmez', async () => {
  const CGNAT = 'http://100.101.102.103:8123';
  const ayar = { ...AYAR, yerelAdres: CGNAT };
  // Tailscale kapalı: aynı adres taşıyıcı ağındaki (HA olmayan) bir cihaza çıkıyor.
  const yabanci = kur({ ayar, yonlendirici: (url) => (url.startsWith(CGNAT) ? new Response('<html>Taşıyıcı ağı</html>', { status: 200 }) : new Response(HA_MANIFEST)) });
  assert.deepEqual(await yabanci.istemci.adresSec(), { adres: 'https://ha.example.com', tur: 'dis' });
  assert.deepEqual(yabanci.cagrilar.filter((c) => c.url.startsWith(CGNAT)).map((c) => `${c.secenek.method} ${c.url} ${c.secenek.headers === undefined}`), [`GET ${CGNAT}/manifest.json true`], 'yalnız anahtarsız yoklama gitti');
  // Tailscale açık ve gerçekten HA: seçilir.
  const ha = kur({ ayar, yonlendirici: () => new Response(HA_MANIFEST) });
  assert.deepEqual(await ha.istemci.adresSec(), { adres: CGNAT, tur: 'yerel' });
});

test('herkese açık bir ada http:// ev içi adres yoklanmaz ve seçilmez (anahtar düz http ile internete gitmesin)', async () => {
  const { istemci, cagrilar, gunlukler } = kur({
    ayar: { ...AYAR, yerelAdres: 'http://ha.example.com' },
    yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }),
  });
  assert.deepEqual(await istemci.adresSec(), { adres: 'https://ha.example.com', tur: 'dis' });
  assert.deepEqual(cagrilar.map((c) => c.url), ['https://ha.example.com/manifest.json']);
  assert.ok(gunlukler.includes('Yoklama atlandı: http adresi ev ağında değil.'));
});

test('ev ağı adresleri (özel IP, .local, tek etiket) http:// ile yoklanır', async () => {
  for (const adres of ['http://10.0.0.5:8123', 'http://ha.local:8123', 'http://homeassistant:8123', 'http://[fd00::5]:8123']) {
    const { istemci } = kur({ ayar: { ...AYAR, yerelAdres: adres }, yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }) });
    assert.deepEqual(await istemci.adresSec(), { adres, tur: 'yerel' }, adres);
  }
});

test('savunma derinliği: aktif adres herkese açık http olsa bile Authorization o adrese GİTMEZ', async () => {
  const ayar = { ...AYAR, yerelAdres: 'http://ha.example.com' }; // elle düzenlenmiş ayar dosyası
  const { istemci, cagrilar, gunlukler } = kur({
    ayar,
    aktif: 'http://ha.example.com',
    yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : json({ entity_id: 'light.a', state: 'on' })),
  });
  // GET: ilk deneme engellenir, adres yeniden seçilir (dış https) ve oradan başarılı olur.
  assert.deepEqual(await istemci.haIstek('/api/states/light.a'), { entity_id: 'light.a', state: 'on' });
  assert.ok(cagrilar.every((c) => !c.url.startsWith('http://ha.example.com')), 'düz http isteği hiç gitmedi');
  assert.deepEqual(apiCagrilari(cagrilar).map((c) => c.url), ['https://ha.example.com/api/states/light.a']);
  assert.ok(gunlukler.includes('Erişim anahtarı ev ağı dışındaki http adresine gönderilmedi.'));
  assert.ok(gunlukler.every((m) => !m.includes(ANAHTAR)));
});

test('savunma derinliği: POST de düz http herkese açık adrese gitmez ve tekrarlanmaz', async () => {
  const { istemci, cagrilar } = kur({
    ayar: { ...AYAR, yerelAdres: 'http://ha.example.com' },
    aktif: 'http://ha.example.com',
    yonlendirici: () => json({}),
  });
  await assert.rejects(() => istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } }), (h) => h.tur === 'baglanti');
  assert.equal(cagrilar.length, 0);
});

test('yoklama zaman aşımı: yanıt gelmeyen ev içi adres 3 sn sonra atlanır, dış adrese geçilir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { istemci } = kur({
    yonlendirici: (url, secenek) =>
      url.startsWith('http://192.168')
        ? new Promise((_coz, reddet) => secenek.signal.addEventListener('abort', () => reddet(new Error('iptal'))))
        : new Response(HA_MANIFEST, { status: 200 }),
  });
  const secim = istemci.adresSec();
  await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(3000);
  assert.deepEqual(await secim, { adres: 'https://ha.example.com', tur: 'dis' });
});

test('yoklama: devasa gövde sınırlı okunur ve HA sayılmaz', async () => {
  const { istemci } = kur({ yonlendirici: () => new Response('{"name":"Home Assistant","x":"' + 'a'.repeat(200_000) + '"}', { status: 200 }) });
  assert.equal(await istemci.adresSec(), null);
});

test('aynı anda gelen adresSec çağrıları tek yoklamayı paylaşır', async () => {
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response(HA_MANIFEST, { status: 200 }) });
  const [a, b] = await Promise.all([istemci.adresSec(), istemci.adresSec()]);
  assert.deepEqual(a, b);
  assert.equal(cagrilar.length, 1);
});

// --- API istekleri ---------------------------------------------------------------

test('haIstek: Authorization yalnız API isteğinde, yönlendirme izlenmez, kimlik bilgisi gönderilmez', async () => {
  const { istemci, cagrilar } = kur({
    yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : json({ entity_id: 'light.a', state: 'on' })),
  });
  assert.deepEqual(await istemci.haIstek('/api/states/light.a'), { entity_id: 'light.a', state: 'on' });
  const api = apiCagrilari(cagrilar);
  assert.equal(api.length, 1);
  assert.equal(api[0].secenek.headers.Authorization, `Bearer ${ANAHTAR}`);
  assert.equal(api[0].secenek.redirect, 'error');
  assert.equal(api[0].secenek.credentials, 'omit');
  assert.equal(api[0].url, 'http://192.168.1.10:8123/api/states/light.a');
  for (const c of cagrilar.filter((x) => manifestMi(x.url))) assert.equal(c.secenek.headers, undefined);
});

test('haIstek: anahtar yoksa istek hiç yapılmaz (anahtar-yok)', async () => {
  const { istemci, cagrilar } = kur({ anahtar: null, yonlendirici: () => json({}) });
  await assert.rejects(() => istemci.haIstek('/api/'), (h) => h instanceof HaHatasi && h.tur === 'anahtar-yok');
  assert.equal(cagrilar.length, 0);
});

test('haIstek: açıkça verilen anahtar (doğrulama) kullanılır', async () => {
  const { istemci, cagrilar } = kur({
    anahtar: null,
    yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : json({ message: 'API running.' })),
  });
  assert.deepEqual(await istemci.haIstek('/api/', { anahtar: 'TEST_BASKA_ANAHTAR_111' }), { message: 'API running.' });
  assert.equal(apiCagrilari(cagrilar)[0].secenek.headers.Authorization, 'Bearer TEST_BASKA_ANAHTAR_111');
});

test('haIstek hata türleri: 401 yetki, 403 yasak-erisim, 404 bulunamadi, 502/500 sunucu, bozuk JSON sunucu', async () => {
  const beklenen = [
    [401, 'yetki'],
    [403, 'yasak-erisim'],
    [404, 'bulunamadi'],
    [502, 'sunucu'],
    [500, 'sunucu'],
  ];
  for (const [durum, tur] of beklenen) {
    const { istemci } = kur({ yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : new Response('Gövdede ayrıntı', { status: durum })) });
    await assert.rejects(() => istemci.haIstek('/api/states/light.a'), (h) => h.tur === tur && h.durumKodu === durum, `${durum}`);
  }
  const { istemci } = kur({ yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : new Response('{bozuk', { status: 200 })) });
  await assert.rejects(() => istemci.haIstek('/api/'), (h) => h.tur === 'sunucu');
});

test('hata nesnesi ve metni yanıt gövdesini, anahtarı ya da URL\'yi taşımaz', async () => {
  const { istemci, gunlukler } = kur({
    yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : new Response(`gizli-ayrinti ${ANAHTAR}`, { status: 500 })),
  });
  let yakalanan;
  await istemci.haIstek('/api/states/light.a').catch((h) => {
    yakalanan = h;
  });
  assert.equal(yakalanan.message, 'sunucu');
  assert.ok(!hataMetni(yakalanan).includes(ANAHTAR));
  assert.ok(gunlukler.every((m) => !m.includes(ANAHTAR) && !m.includes('gizli-ayrinti')));
});

test('GET: ilk bağlantı hatasında adres yeniden seçilip BİR kez daha denenir', async () => {
  let apiDenemesi = 0;
  const { istemci, cagrilar } = kur({
    yonlendirici: (url) => {
      if (manifestMi(url)) return new Response(HA_MANIFEST);
      apiDenemesi += 1;
      if (apiDenemesi === 1) throw new TypeError('fetch failed');
      return json({ state: 'on' });
    },
  });
  assert.deepEqual(await istemci.haIstek('/api/states/light.a'), { state: 'on' });
  assert.equal(apiDenemesi, 2);
  assert.ok(cagrilar.filter((c) => manifestMi(c.url)).length >= 2, 'adres yeniden yoklandı');
});

test('GET: ikinci deneme de bağlantı hatasıyla bitince hata verilir (sonsuz döngü yok)', async () => {
  let apiDenemesi = 0;
  const { istemci } = kur({
    yonlendirici: (url) => {
      if (manifestMi(url)) return new Response(HA_MANIFEST);
      apiDenemesi += 1;
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(() => istemci.haIstek('/api/states'), (h) => h.tur === 'baglanti');
  assert.equal(apiDenemesi, 2);
});

test('POST (servis çağrısı) bağlantı hatasında ASLA tekrarlanmaz', async () => {
  let apiDenemesi = 0;
  const { istemci } = kur({
    yonlendirici: (url) => {
      if (manifestMi(url)) return new Response(HA_MANIFEST);
      apiDenemesi += 1;
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(() => istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } }), (h) => h.tur === 'baglanti');
  assert.equal(apiDenemesi, 1);
});

test('POST gövdesi JSON olarak gider', async () => {
  const { istemci, cagrilar } = kur({ yonlendirici: (url) => (manifestMi(url) ? new Response(HA_MANIFEST) : json([])) });
  await istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } });
  const api = apiCagrilari(cagrilar)[0];
  assert.equal(api.secenek.method, 'POST');
  assert.equal(api.secenek.body, '{"entity_id":"light.a"}');
});

test('ulaşılabilir adres yok: haIstek bağlantı hatası verir ve API isteği yapılmaz', async () => {
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response('<html>', { status: 200 }) });
  await assert.rejects(() => istemci.haIstek('/api/states'), (h) => h.tur === 'baglanti');
  assert.equal(apiCagrilari(cagrilar).length, 0);
});

// --- apiTabaniBul ------------------------------------------------------------------

test('apiTabaniBul: ana pencere izinli adreste açıksa o adres, yoklama yapılmaz', async () => {
  const { istemci, cagrilar } = kur({ aktif: 'https://ha.example.com', yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), 'https://ha.example.com');
  assert.equal(cagrilar.length, 0);
});

test('apiTabaniBul: izinli olmayan aktif adres yok sayılır', async () => {
  const { istemci } = kur({ aktif: 'http://baska.host:8123', yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123');
});

test('apiTabaniBul: seçim 60 sn önbelleklenir; secimiSifirla unutturur; zorla yeniden yoklar; seçim yenidenBaglan\'a bildirilir', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { istemci, cagrilar, baglanmalar } = kur({ yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123');
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123');
  assert.equal(cagrilar.length, 1);
  assert.deepEqual(baglanmalar, [{ adres: 'http://192.168.1.10:8123', tur: 'yerel' }]);
  t.mock.timers.tick(61_000);
  await istemci.apiTabaniBul();
  assert.equal(cagrilar.length, 2);
  istemci.secimiSifirla();
  await istemci.apiTabaniBul();
  assert.equal(cagrilar.length, 3);
  await istemci.apiTabaniBul(true);
  assert.equal(cagrilar.length, 4);
});

test('apiTabaniBul: başarısız seçim 15 sn boyunca tekrar denenmez; secimiAyarla seçimi dışarıdan bildirir', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response('<html>', { status: 503 }) });
  assert.equal(await istemci.apiTabaniBul(), null);
  const once = cagrilar.length;
  assert.equal(await istemci.apiTabaniBul(), null);
  assert.equal(cagrilar.length, once);
  t.mock.timers.tick(16_000);
  await istemci.apiTabaniBul();
  assert.ok(cagrilar.length > once);
  istemci.secimiAyarla('https://ha.example.com');
  assert.equal(await istemci.apiTabaniBul(), 'https://ha.example.com');
});

test('hataMetni: Türkçe açıklamalar', () => {
  assert.equal(hataMetni(new HaHatasi('baglanti')), 'bağlantı yok');
  assert.equal(hataMetni(new HaHatasi('yetki', 401)), 'erişim anahtarı geçersiz');
  assert.match(hataMetni(new HaHatasi('yasak-erisim', 403)), /403/);
  assert.equal(hataMetni(new HaHatasi('sunucu', 502)), 'sunucu hatası (502)');
  assert.equal(hataMetni(new HaHatasi('onay-gerekli')), 'onay gerekiyor');
  assert.match(hataMetni(new HaHatasi('kaynak-izinsiz')), /yoldan/);
  assert.equal(hataMetni(undefined), 'beklenmeyen hata');
});

// --- denetim düzeltmeleri (Dalga 3): sıfırlama sonrası aktif adres doğrulanana kadar kısayol sayılmaz ---

test('apiTabaniBul: secimiSifirla sonrası ana pencerenin eski adresi doğrulanmadan kısayol sayılmaz', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  // ana pencere hâlâ dış adreste; ağ değişti, ev içi adres yanıt veriyor
  const { istemci, cagrilar } = kur({
    aktif: 'https://ha.example.com',
    yonlendirici: (url) => (url.startsWith('http://192.168') ? new Response(HA_MANIFEST) : new Response('', { status: 503 })),
  });
  assert.equal(await istemci.apiTabaniBul(), 'https://ha.example.com', 'sıfırlamadan önce aktif adres doğrudan kullanılır');
  assert.equal(cagrilar.length, 0);
  istemci.secimiSifirla();
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123', 'doğrulanmamış aktif adres atlanır, yoklama yapılır');
  assert.ok(cagrilar.length >= 1);
  // sayfa seçilen adrese taşınırsa kısayol yeniden geçerli olur ve yoklama yapılmaz
  const { istemci: i2, cagrilar: c2 } = kur({
    aktif: 'http://192.168.1.10:8123',
    yonlendirici: () => new Response(HA_MANIFEST),
  });
  i2.secimiSifirla();
  assert.equal(await i2.apiTabaniBul(), 'http://192.168.1.10:8123');
  const yoklama = c2.length;
  assert.equal(await i2.apiTabaniBul(), 'http://192.168.1.10:8123');
  assert.equal(c2.length, yoklama, 'seçim doğrulandıktan sonra tekrar yoklanmaz');
});

test('hataMetni: yetki kesici türleri (reddedildi, duraklatildi) Türkçe ve sırsız', () => {
  assert.match(hataMetni(new HaHatasi('reddedildi')), /erişim anahtarı reddedildi.*Ayarlar/);
  assert.match(hataMetni(new HaHatasi('duraklatildi', 403)), /403.*durduruldu/);
  assert.ok(Array.from(hataMetni(new HaHatasi('reddedildi'))).length <= 100, 'panel üst şeridine sığar');
});

// --- 1.2.0: adres kısayolu süresi (h-08), ikinci seçim (h-19), ev içine dönüş (k-15), geciken servis çağrısı (h-09) -------

const YEREL = AYAR.yerelAdres;
const DIS = AYAR.disAdres;

test('h-08: ana pencere adresi süresiz kısayol değil; 5 dk sonra anahtarsız yoklamayla yeniden seçilir, onaylanınca yine kısayol', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { istemci, cagrilar, baglanmalar } = kur({ aktif: YEREL, yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), YEREL);
  assert.equal(cagrilar.length, 0, 'ilk 5 dk: yoklama yok');
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.equal(await istemci.apiTabaniBul(), YEREL);
  assert.equal(cagrilar.length, 0);
  t.mock.timers.tick(1);
  assert.equal(await istemci.apiTabaniBul(), YEREL);
  assert.deepEqual(cagrilar.map((c) => c.url), [`${YEREL}/manifest.json`], '5 dk dolunca anahtarsız yoklama');
  assert.equal(cagrilar[0].secenek.headers, undefined, 'yoklamada anahtar yok');
  assert.deepEqual(baglanmalar, [{ adres: YEREL, tur: 'yerel' }]);
  t.mock.timers.tick(4 * 60_000);
  assert.equal(await istemci.apiTabaniBul(), YEREL);
  assert.equal(cagrilar.length, 1, 'onaylanan adres yeniden 5 dk kısayol');
});

test('h-08: ağ uykusuz değişti, 5 dk sonra eski ev içi IP HA değil: anahtarlı istek eski adrese GİTMEZ, dış adres seçilir', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let agDegisti = false;
  const { istemci, cagrilar, baglanmalar } = kur({
    aktif: YEREL,
    yonlendirici: (url) => {
      if (manifestMi(url)) return url.startsWith(YEREL) && agDegisti ? new Response('<html>yazıcı</html>') : new Response(HA_MANIFEST);
      return json({ entity_id: 'light.a', state: 'on' });
    },
  });
  await istemci.haIstek('/api/states/light.a');
  agDegisti = true;
  t.mock.timers.tick(5 * 60_000);
  await istemci.haIstek('/api/states/light.a');
  const anahtarlilar = cagrilar.filter((c) => c.secenek.headers?.Authorization);
  assert.deepEqual(anahtarlilar.map((c) => c.url), [`${YEREL}/api/states/light.a`, `${DIS}/api/states/light.a`]);
  assert.deepEqual(baglanmalar.at(-1), { adres: DIS, tur: 'dis' }, 'ana pencere de taşınır (karar main.js\'te)');
});

test('h-19: HA kapalıyken her istek adresleri bir kez yoklar (iki kat değil); bekleme penceresi içinde yeniden yoklanmaz', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response('<html>', { status: 503 }) });
  await assert.rejects(() => istemci.haIstek('/api/states/light.a'), (h) => h.tur === 'baglanti');
  assert.deepEqual(cagrilar.map((c) => c.url), [`${YEREL}/manifest.json`, `${DIS}/manifest.json`], 'her adres tam bir kez');
  await assert.rejects(() => istemci.haIstek('/api/states/light.a'), (h) => h.tur === 'baglanti');
  assert.equal(cagrilar.length, 2, '15 sn içinde zorla ikinci seçim yok');
  t.mock.timers.tick(15_000);
  await assert.rejects(() => istemci.haIstek('/api/states/light.a'), (h) => h.tur === 'baglanti');
  assert.equal(cagrilar.length, 4, 'pencere dışında yeniden (bir kez) yoklanır');
  assert.equal(apiCagrilari(cagrilar).length, 0);
});

test('k-15: dış adresteyken YALNIZ ev içi adres anahtarsız yoklanır; ulaşılabilirse ev içi seçim döner ve API oraya geçer', async () => {
  const { istemci, cagrilar } = kur({ aktif: DIS, yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), DIS, 'dış adres kısayolu');
  assert.deepEqual(await istemci.yereleDonusYokla(), { adres: YEREL, tur: 'yerel' });
  assert.deepEqual(cagrilar.map((c) => c.url), [`${YEREL}/manifest.json`]);
  assert.equal(cagrilar[0].secenek.headers, undefined, 'anahtarsız');
  assert.equal(cagrilar[0].secenek.credentials, 'omit');
  assert.equal(await istemci.apiTabaniBul(), YEREL, 'pencere taşınana kadar da API ev içi adresi kullanır');
  assert.equal(cagrilar.length, 1);
});

test('k-15: ev içi adres hâlâ yoksa, pencere zaten ev içindeyse ya da tek adres varsa hiçbir şey değişmez', async () => {
  const yok = kur({ aktif: DIS, yonlendirici: (url) => (url.startsWith(YEREL) ? new Response('<html>', { status: 200 }) : new Response(HA_MANIFEST)) });
  assert.equal(await yok.istemci.yereleDonusYokla(), null);
  assert.equal(await yok.istemci.apiTabaniBul(), DIS, 'dış adreste kalınır');
  assert.equal(yok.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0, 'dış adres yoklanmaz');
  const evde = kur({ aktif: YEREL, yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await evde.istemci.yereleDonusYokla(), null);
  assert.equal(evde.cagrilar.length, 0);
  const tek = kur({ aktif: DIS, ayar: { ...AYAR, yerelAdres: '' }, yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await tek.istemci.yereleDonusYokla(), null);
  assert.equal(tek.cagrilar.length, 0);
  const yasak = kur({ aktif: DIS, yonlendirici: (url) => (url.startsWith(YEREL) ? new Response('', { status: 403 }) : new Response(HA_MANIFEST)) });
  assert.equal(await yasak.istemci.yereleDonusYokla(), null, 'ev içi 403: dönülmez');
});

test('hataMetni: h-09 geciken servis çağrısı metni', () => {
  assert.equal(hataMetni(new HaHatasi('gecikti')), 'komut gönderildi, yanıt gecikti');
});

/** Yetki kesicili istemci (h-08 köprüsü ve h-09 için): sahte fs, sahte saat. */
function kurKesicili({ ha, aktif = null, simdi = () => Date.now(), manifest = null, ayar = AYAR }) {
  const { yetkiKesiciOlustur } = require('../src/lib/yetki-kesici');
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
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, yontem: secenek.method, kimlikli: !!secenek.headers?.Authorization });
      if (manifestMi(url)) return manifest ? manifest(url, secenek) : new Response(HA_MANIFEST);
      return ha(url, secenek);
    },
    ayarlarAl: () => ayar,
    anahtarAl: async () => ANAHTAR,
    aktifAdresAl: () => aktif,
    gunluk: (m) => gunlukler.push(m),
    simdi,
    yetkiKesici: kesici,
  });
  return { istemci, kesici, cagrilar, gunlukler, p: kesici.parmakIzi(ANAHTAR) };
}

const asili = (secenek) => new Promise((_coz, reddet) => secenek.signal.addEventListener('abort', () => reddet(new Error('iptal'))));
const POST = { yontem: 'POST', govde: { entity_id: 'scene.uzun' } };

test('h-08: canlı bağlantı CANLIYKEN koparsa (wsYetkisi.koptu(true)) adres seçimi unutulur; kurulumdaki kopma seçimi korur', async () => {
  const o = kurKesicili({ aktif: YEREL, ha: () => json({ message: 'API running.' }) });
  assert.equal(await o.istemci.apiTabaniBul(), YEREL);
  assert.equal(o.cagrilar.length, 0);
  o.istemci.wsYetkisi.koptu(false);
  assert.equal(await o.istemci.apiTabaniBul(), YEREL);
  assert.equal(o.cagrilar.length, 0, 'canlı değildi: seçim korunur');
  o.istemci.wsYetkisi.koptu(true);
  assert.equal(await o.istemci.apiTabaniBul(), YEREL);
  assert.deepEqual(o.cagrilar.map((c) => c.url), [`${YEREL}/manifest.json`], 'canlı bağlantı koptu: önce anahtarsız yoklama');
});

test('h-09: anahtar tazeyken servis çağrısı zaman aşımı "gecikti" olur; 30 sn soğuma yok, sonraki eylem ÖNCE tek doğrulamayla hemen gider', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  let uzun = true;
  const o = kurKesicili({
    ha: (url, secenek) => {
      if (url.endsWith('/api/')) return json({ message: 'API running.' });
      if (secenek.method === 'POST' && uzun) return asili(secenek); // HA sahneyi çalıştırıyor, yanıt 8 sn'yi aşıyor
      return json([]);
    },
  });
  const soz = o.istemci.haIstek('/api/services/scene/turn_on', POST);
  await new Promise((coz) => setImmediate(coz));
  await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(8000);
  await assert.rejects(soz, (h) => h instanceof HaHatasi && h.tur === 'gecikti');
  assert.match(hataMetni(new HaHatasi('gecikti')), /komut gönderildi/);
  // güvence: deneme kesicide askıda sayıldı (anahtar başına sınır aynen işler), anahtar durmadı
  assert.equal(o.kesici.belirsizSayisi(o.p), 1);
  assert.equal(o.kesici.dogrulanamadiMi(o.p), false);
  uzun = false;
  const once = o.cagrilar.length;
  await o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } });
  assert.deepEqual(
    o.cagrilar.slice(once).map((c) => `${c.yontem} ${new URL(c.url).pathname}`),
    ['GET /manifest.json', 'GET /api/', 'POST /api/services/light/toggle'],
    'soğuma yok; önce anahtarsız adres yoklaması, sonra tek doğrulama, sonra komut',
  );
  assert.equal(o.kesici.belirsizSayisi(o.p), 0, 'başarılı doğrulama askıdakini düşürdü');
});

test('h-09: geciken servis çağrısından sonra adres ANAHTARSIZ yeniden yoklanır; aynı IP üzerinde HA olmayan cihaz varsa anahtar (doğrulama dahil) oraya gitmez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  let yabanci = false; // Wi-Fi değişti: ev içi IP'de artık HA olmayan bir cihaz var (uyanış/kilit olayı yok)
  const o = kurKesicili({
    aktif: YEREL, // ana pencere ev içi adreste: 5 dk'lık kısayol geçerli
    manifest: (url) => (yabanci && url.startsWith(YEREL) ? new Response('<html>Yönlendirici</html>', { status: 200 }) : new Response(HA_MANIFEST)),
    ha: (url, secenek) => {
      if (url.endsWith('/api/')) return json({ message: 'API running.' });
      if (secenek.method === 'POST' && !yabanci) return asili(secenek); // uzun sahne: yanıt 8 sn'yi aşıyor
      return json([]);
    },
  });
  await o.istemci.haIstek('/api/states/light.a'); // kısayol: yoklamasız, doğrulandı, anahtar taze
  assert.ok(o.cagrilar.every((c) => !manifestMi(c.url)), 'kısayol: şimdiye dek yoklama yok');
  const post = o.istemci.haIstek('/api/services/scene/turn_on', POST);
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
  yabanci = true; // POST havadayken ağ değişti
  t.mock.timers.tick(8000);
  await assert.rejects(post, (h) => h.tur === 'gecikti');
  const once = o.cagrilar.length;
  // Sonraki kimlikli istek (kullanıcı eylemi ya da otomatik durum tazeleme): kısayol/seçim önbelleği kullanılmaz.
  await o.istemci.haIstek('/api/states/light.a').catch(() => {});
  const sonra = o.cagrilar.slice(once);
  assert.equal(`${sonra[0].yontem} ${sonra[0].url}`, `GET ${YEREL}/manifest.json`, 'ilk istek anahtarsız yoklama');
  assert.equal(sonra[0].kimlikli, false);
  assert.deepEqual(sonra.filter((c) => c.kimlikli && c.url.startsWith(YEREL)), [], 'anahtar yabancı cihaza gitmedi');
  assert.ok(sonra.some((c) => c.kimlikli && c.url.startsWith(DIS)), 'doğrulama ve istek dış adrese (HA) gitti');
  assert.equal(o.kesici.dogrulanamadiMi(o.p), false, 'yabancı cihaz yüzünden anahtar "doğrulanamadı" durumuna düşmedi');
  assert.equal(o.kesici.reddedildiMi(o.p), false);
});

test('h-09: geciken servis çağrısından sonra ev içi adres hâlâ HA ise sonraki kimlikli istek yine ev içi adrese gider (yoklama + doğrulama + istek)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  let uzun = true;
  const o = kurKesicili({
    aktif: YEREL,
    ha: (url, secenek) => {
      if (url.endsWith('/api/')) return json({ message: 'API running.' });
      if (secenek.method === 'POST' && uzun) return asili(secenek);
      return json([]);
    },
  });
  await o.istemci.haIstek('/api/states/light.a');
  const post = o.istemci.haIstek('/api/services/scene/turn_on', POST);
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(8000);
  await assert.rejects(post, (h) => h.tur === 'gecikti');
  uzun = false;
  const once = o.cagrilar.length;
  await o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } });
  assert.deepEqual(
    o.cagrilar.slice(once).map((c) => `${c.yontem} ${c.url}`),
    [`GET ${YEREL}/manifest.json`, `GET ${YEREL}/api/`, `POST ${YEREL}/api/services/light/toggle`],
    'soğuma yok; hepsi ev içi adreste',
  );
  // Yoklama ana pencere adresini doğruladı: kısayol yeniden geçerli, ikinci istek yoklamasız gider.
  const ikinci = o.cagrilar.length;
  await o.istemci.haIstek('/api/states/light.a');
  assert.deepEqual(o.cagrilar.slice(ikinci).map((c) => `${c.yontem} ${new URL(c.url).pathname}`), ['GET /api/states/light.a']);
});

test('h-09: geciken servis çağrısı sırasında kapıda bekleyen (önceden doğrulanmış sayılan) istek gönderilmez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const o = kurKesicili({
    ha: (url, secenek) => {
      if (url.endsWith('/api/')) return json({ message: 'API running.' });
      if (secenek.method === 'POST') return asili(secenek);
      return json({ entity_id: 'light.a', state: 'on' });
    },
  });
  const post = o.istemci.haIstek('/api/services/scene/turn_on', POST);
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
  const get = o.istemci.haIstek('/api/states/light.a'); // anahtar taze: doğrulama geçidinden geçer, kapıda bekler
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(8000);
  await assert.rejects(post, (h) => h.tur === 'gecikti');
  await assert.rejects(get, (h) => h.tur === 'belirsiz');
  assert.equal(o.cagrilar.filter((c) => c.url.endsWith('/api/states/light.a')).length, 0, 'bekleyen istek ağa çıkmadı');
});

test('h-09 güvence: anahtar taze iken HA\'da iptal edilirse geciken servis çağrısı + sonraki denemeler HA\'ya en çok 2 hatalı deneme (doğrulanmış anahtar sınırı) gönderir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  for (const sonraki of ['yanitsiz', '401']) {
    let iptal = false;
    let hatali = 0; // sahte HA: geçersiz anahtarla gelen her kimlikli isteği GÖNDERİLDİĞİ anda sayar (yanıt kaybolsa da)
    let mod = 'yanitsiz';
    const o = kurKesicili({
      ha: (url, secenek) => {
        if (iptal) hatali += 1;
        if (iptal && mod === 'yanitsiz') return asili(secenek);
        if (iptal) return json({}, 401);
        return url.endsWith('/api/') ? json({ message: 'API running.' }) : json([]);
      },
    });
    await o.istemci.haIstek('/api/states/light.a'); // doğrulandı, taze
    iptal = true; // anahtar HA'da silindi; servis çağrısının yanıtı kayboluyor
    const post = o.istemci.haIstek('/api/services/scene/turn_on', POST);
    for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
    t.mock.timers.tick(8000);
    await assert.rejects(post, (h) => h.tur === 'gecikti');
    mod = sonraki;
    for (let tur = 0; tur < 6; tur += 1) {
      const istek = o.istemci.haIstek('/api/services/light/toggle', POST).catch((h) => h.tur);
      for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
      t.mock.timers.tick(31_000);
      await istek;
    }
    assert.equal(hatali, 2, `${sonraki}: HA ${hatali} hatalı deneme saydı (geciken çağrı + tek doğrulama)`);
    assert.ok(o.kesici.reddedildiMi(o.p) || o.kesici.dogrulanamadiMi(o.p), `${sonraki}: anahtar durduruldu`);
  }
});

test('h-09: GET zaman aşımı ve taze OLMAYAN anahtar eskisi gibi "belirsiz" (soğuma) kalır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const o = kurKesicili({
    ha: (url, secenek) => (url.endsWith('/api/') ? json({ message: 'API running.' }) : asili(secenek)),
  });
  const soz = o.istemci.haIstek('/api/states/light.a');
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz));
  t.mock.timers.tick(8000);
  await assert.rejects(soz, (h) => h.tur === 'belirsiz');
  const once = o.cagrilar.length;
  await assert.rejects(() => o.istemci.haIstek('/api/services/light/toggle', POST), (h) => h.tur === 'belirsiz');
  assert.equal(o.cagrilar.length, once, 'soğuma sürüyor: istek gitmedi');
});

test('apiTabaniBul: saat geri alındığında (yas < 0) bayat seçim önbelleği kullanılmaz', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { istemci, cagrilar } = kur({ yonlendirici: () => new Response(HA_MANIFEST) });
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123');
  assert.equal(cagrilar.length, 1);
  t.mock.timers.setTime(500_000);
  assert.equal(await istemci.apiTabaniBul(), 'http://192.168.1.10:8123');
  assert.equal(cagrilar.length, 2);
});

