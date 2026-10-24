'use strict';

/**
 * Kamera anlık görüntüsü (o-48; src/lib/kamera.js ve ha-istemcisi.js ikili okuma seçeneği).
 * Güvenlik özellikleri: yalnız kullanıcının onayladığı + güvenli kameralar; 5 sn önbellek; dakikada en çok 20 çekim;
 * dosya imzası denetimi; boyut sınırı; bellekte tutma (diske yazma yok); sızıntı yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../src/lib/kamera');
const { HaHatasi, haIstemcisiOlustur } = require('../src/ha-istemcisi');

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const HTML = new TextEncoder().encode('<html><body>hata sayfası</body></html>');

const durum = (kimlik, ad, state = 'idle', ek = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: ad, ...ek } });

test('goruntuTuru: dosya imzasından tür (JPEG, PNG, GIF, WebP); bozuk, kısa ve HTML null', () => {
  assert.equal(K.goruntuTuru(JPEG), 'image/jpeg');
  assert.equal(K.goruntuTuru(PNG), 'image/png');
  assert.equal(K.goruntuTuru(GIF), 'image/gif');
  assert.equal(K.goruntuTuru(WEBP), 'image/webp');
  assert.equal(K.goruntuTuru(HTML), null);
  for (const kotu of [null, undefined, 5, 'metin', {}, new Uint8Array(0), Uint8Array.from([0xff, 0xd8, 0xff]), new Uint8Array(20)]) {
    assert.equal(K.goruntuTuru(kotu), null, String(kotu));
  }
  // WebP imzası RIFF + WEBP birlikte aranır (yalnız RIFF yetmez; ör. WAV)
  assert.equal(K.goruntuTuru(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1])), null);
});

test('kameraIzinleriniDuzelt: geçerli kamera kimlikleri, en çok 8, tekrarsız; yasak/bozuk öğe düşer; dizi değilse undefined', () => {
  assert.deepEqual(K.kameraIzinleriniDuzelt(['camera.salon', 'camera.balkon']), ['camera.salon', 'camera.balkon']);
  assert.deepEqual(K.kameraIzinleriniDuzelt(['camera.salon', 'camera.salon']), ['camera.salon']);
  assert.deepEqual(K.kameraIzinleriniDuzelt(['camera.salon', 'camera.on_kapi', 'camera.zil', 'light.salon', 5, null, {}, 'camera.Salon', 'camera.ring']), ['camera.salon']);
  assert.deepEqual(K.kameraIzinleriniDuzelt([]), []);
  const dokuz = Array.from({ length: 12 }, (_, i) => `camera.k${i}`);
  assert.deepEqual(K.kameraIzinleriniDuzelt(dokuz), dokuz.slice(0, K.EN_COK_KAMERA));
  assert.equal(K.EN_COK_KAMERA, 8);
  for (const kotu of [undefined, null, 'camera.salon', 5, {}, true]) assert.equal(K.kameraIzinleriniDuzelt(kotu), undefined, String(kotu));
});

test('kameraAdaylari: yalnız kamera alanı ve güvenli olanlar; ada göre sıralı; ad yoksa kimlik; kapı/zil kameraları listeye girmez', () => {
  const adaylar = K.kameraAdaylari([
    durum('camera.salon', 'Salon'),
    durum('camera.on_kapi', 'Ön kapı'),
    durum('camera.zil', 'Zil'),
    durum('camera.giris', 'Giriş'),
    durum('camera.balkon', 'Balkon'),
    durum('camera.adsiz', ''),
    durum('light.salon', 'Salon ışığı'),
    durum('camera.ring_marka', 'Bahçe', { brand: 'Ring' }),
    null,
    5,
    { entity_id: 5 },
  ]);
  assert.deepEqual(adaylar, [
    { entity_id: 'camera.balkon', ad: 'Balkon' },
    { entity_id: 'camera.adsiz', ad: 'camera.adsiz' },
    { entity_id: 'camera.salon', ad: 'Salon' },
  ]);
  for (const kotu of [undefined, null, {}, 'x', 5]) assert.deepEqual(K.kameraAdaylari(kotu), []);
});

test('B43: kameraAdaylari arayüz dilinin karşılaştırma kuralıyla sıralanır (de: Ofen, Öl, Oz; tr: Ofen, Oz, Öl); bilinmeyen dil tr sayılır', () => {
  const durumlar = [durum('camera.a', 'Oz'), durum('camera.b', 'Öl'), durum('camera.c', 'Ofen')];
  const adlar = (dil) => K.kameraAdaylari(durumlar, dil).map((k) => k.ad);
  assert.deepEqual(adlar('de'), ['Ofen', 'Öl', 'Oz']);
  assert.deepEqual(adlar('tr'), ['Ofen', 'Oz', 'Öl']);
  assert.deepEqual(adlar(undefined), ['Ofen', 'Oz', 'Öl'], 'varsayılan tr');
  assert.deepEqual(adlar('xx'), ['Ofen', 'Oz', 'Öl'], 'bilinmeyen dil tr');
  for (const dil of ['en', 'fr', 'es']) assert.equal(adlar(dil).length, 3, dil);
});

test('kameraAdaylari: ad kısaltılır ve görüntü/adres alanı içermez', () => {
  const [aday] = K.kameraAdaylari([durum('camera.uzun', 'U'.repeat(300), 'idle', { entity_picture: '/api/camera_proxy/camera.uzun?token=GIZLI', access_token: 'GIZLI' })]);
  assert.ok(aday.ad.length <= 40);
  assert.deepEqual(Object.keys(aday).sort(), ['ad', 'entity_id']);
  assert.doesNotMatch(JSON.stringify(aday), /GIZLI|token|entity_picture/);
});

test('kameraModeli: yalnız onaylı + canlı durumu güvenli + durumu bilinen kameralar; kullanilabilir unavailable değilse', () => {
  const durumlar = {
    'camera.salon': durum('camera.salon', 'Salon'),
    'camera.balkon': durum('camera.balkon', 'Balkon', 'unavailable'),
    'camera.on_kapi': durum('camera.on_kapi', 'Ön kapı'),
    'camera.bahce': durum('camera.bahce', 'Bahçe', 'idle', { brand: 'Ring' }),
    'camera.baskasi': durum('camera.baskasi', 'Başka'),
  };
  const durumAl = (k) => durumlar[k];
  const model = K.kameraModeli({ izinler: ['camera.salon', 'camera.balkon', 'camera.on_kapi', 'camera.bahce', 'camera.yok', 'light.x', 5], durumAl });
  assert.deepEqual(model, [
    { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true },
    { id: 'camera.balkon', etiket: 'Balkon', kullanilabilir: false },
  ]);
  assert.deepEqual(K.kameraModeli({ izinler: [], durumAl }), []);
  assert.deepEqual(K.kameraModeli({ izinler: undefined, durumAl }), []);
  assert.deepEqual(K.kameraModeli({ izinler: 'camera.salon', durumAl }), []);
  // durumdaki varlık kimliği istenenle uyuşmuyorsa (bozuk depo) görünmez
  assert.deepEqual(K.kameraModeli({ izinler: ['camera.salon'], durumAl: () => durum('camera.baska', 'Salon') }), []);
});

test('kameraModeli: model yalnız id, etiket, kullanilabilir taşır (görüntü, adres, token yok)', () => {
  const [m] = K.kameraModeli({ izinler: ['camera.salon'], durumAl: () => durum('camera.salon', 'Salon', 'idle', { entity_picture: '/api/camera_proxy/camera.salon?token=GIZLI', access_token: 'GIZLI' }) });
  assert.deepEqual(Object.keys(m).sort(), ['etiket', 'id', 'kullanilabilir']);
  assert.doesNotMatch(JSON.stringify(m), /GIZLI|token|proxy/);
});

test('kameraModeli: en çok 8 kamera', () => {
  const izinler = Array.from({ length: 12 }, (_, i) => `camera.k${i}`);
  const model = K.kameraModeli({ izinler, durumAl: (k) => durum(k, `K ${k.slice(-2)}`) });
  assert.equal(model.length, 8);
});

// --- servis ----------------------------------------------------------------------

function kur({ izinler = ['camera.salon'], durumlar, yanit = { icerikTuru: 'image/jpeg', baytlar: JPEG }, baslangic = 1_000_000 } = {}) {
  let zaman = baslangic;
  const cagrilar = [];
  const gunlukler = [];
  const tablo = durumlar ?? { 'camera.salon': durum('camera.salon', 'Salon') };
  let izinListesi = izinler;
  const servis = K.kameraServisiOlustur({
    ikiliIstek: async (yol) => {
      cagrilar.push(yol);
      if (typeof yanit === 'function') return yanit(yol, cagrilar.length);
      return yanit;
    },
    durumAl: (k) => tablo[k],
    izinlerAl: () => izinListesi,
    simdi: () => zaman,
    gunluk: (m) => gunlukler.push(m),
  });
  return { servis, cagrilar, gunlukler, tablo, ilerle: (ms) => (zaman += ms), izinleriDegistir: (yeni) => (izinListesi = yeni) };
}

test('servis: onaylı ve güvenli kamera için görüntü data: URL olarak döner; yol yalnız /api/camera_proxy/<kimlik>', async () => {
  const { servis, cagrilar } = kur();
  const r = await servis.al('camera.salon');
  assert.equal(r.ok, true);
  assert.equal(r.onbellek, false);
  assert.equal(r.yas, 0);
  assert.match(r.veri, /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(r.veri.split(',')[1], 'base64').equals(Buffer.from(JPEG)), true);
  assert.deepEqual(cagrilar, ['/api/camera_proxy/camera.salon']);
});

test('servis: PNG, WebP ve GIF de kabul edilir; tür dosya imzasından gelir (sunucunun bildirdiğinden değil)', async () => {
  for (const [baytlar, beklenen] of [[PNG, 'image/png'], [WEBP, 'image/webp'], [GIF, 'image/gif']]) {
    const { servis } = kur({ yanit: { icerikTuru: 'image/jpeg', baytlar } });
    const r = await servis.al('camera.salon');
    assert.equal(r.ok, true, beklenen);
    assert.ok(r.veri.startsWith(`data:${beklenen};base64,`), beklenen);
  }
  const { servis } = kur({ yanit: { icerikTuru: '', baytlar: JPEG } });
  assert.equal((await servis.al('camera.salon')).ok, true, 'içerik türü başlığı boş olabilir');
  const { servis: s2 } = kur({ yanit: { icerikTuru: 'application/octet-stream', baytlar: JPEG } });
  assert.equal((await s2.al('camera.salon')).ok, true);
});

test('servis: HTML/metin yanıt, imzasız içerik, boş ve 2 MB üstü içerik görüntü sayılmaz ("goruntu-yok")', async () => {
  const asiri = new Uint8Array(K.EN_BUYUK_GORUNTU_BAYT + 1);
  asiri.set(JPEG);
  const kotuler = [
    { icerikTuru: 'text/html', baytlar: HTML },
    { icerikTuru: 'image/jpeg', baytlar: HTML },
    { icerikTuru: 'text/html', baytlar: JPEG },
    { icerikTuru: 'application/json', baytlar: JPEG },
    { icerikTuru: 'image/jpeg', baytlar: new Uint8Array(0) },
    { icerikTuru: 'image/jpeg', baytlar: asiri },
    { icerikTuru: 'image/jpeg', baytlar: null },
    { icerikTuru: 'image/jpeg' },
    null,
  ];
  for (const yanit of kotuler) {
    const { servis } = kur({ yanit });
    assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'goruntu-yok' }, JSON.stringify(yanit?.icerikTuru));
    assert.equal(servis.onbellekSayisi(), 0, 'geçersiz içerik önbelleğe girmez');
  }
});

test('servis: tam 2 MB görüntü kabul edilir', async () => {
  const tam = new Uint8Array(K.EN_BUYUK_GORUNTU_BAYT);
  tam.set(JPEG);
  const { servis } = kur({ yanit: { icerikTuru: 'image/jpeg', baytlar: tam } });
  assert.equal((await servis.al('camera.salon')).ok, true);
});

test('servis: izin listesinde olmayan kamera için ağ isteği HİÇ gitmez ("izinsiz")', async () => {
  const { servis, cagrilar } = kur({
    izinler: ['camera.salon'],
    durumlar: { 'camera.salon': durum('camera.salon', 'Salon'), 'camera.balkon': durum('camera.balkon', 'Balkon') },
  });
  assert.deepEqual(await servis.al('camera.balkon'), { ok: false, tur: 'izinsiz' });
  assert.equal(cagrilar.length, 0);
  const { servis: bos, cagrilar: c2 } = kur({ izinler: [] });
  assert.deepEqual(await bos.al('camera.salon'), { ok: false, tur: 'izinsiz' });
  assert.equal(c2.length, 0);
});

test('servis: izin listesi bozuksa (dizi değil) hiçbir kamera çekilmez', async () => {
  for (const kotu of [null, 'camera.salon', {}, 5]) {
    const { servis, cagrilar } = kur({ izinler: kotu });
    assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'izinsiz' }, String(kotu));
    assert.equal(cagrilar.length, 0);
  }
});

test('servis: geçersiz kimlik ("gecersiz"): kamera olmayan alan, yol dolaşımı, büyük harf, uzun, metin değil', async () => {
  const { servis, cagrilar } = kur();
  for (const kotu of ['light.salon', 'camera.salon/../../config', 'camera.Salon', 'camera.', '', 'camera.' + 'a'.repeat(300), 5, null, undefined, {}, ['camera.salon'], '/api/camera_proxy/camera.salon']) {
    assert.deepEqual(await servis.al(kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu)?.slice(0, 40));
  }
  assert.equal(cagrilar.length, 0);
});

test('servis: onaylı olsa da kapı/zil/giriş kamerası çekilmez ("gecersiz": kimlik zaten kamera kuralından geçemez)', async () => {
  const durumlar = { 'camera.on_kapi': durum('camera.on_kapi', 'Ön kapı'), 'camera.zil': durum('camera.zil', 'Zil') };
  const { servis, cagrilar } = kur({ izinler: ['camera.on_kapi', 'camera.zil'], durumlar });
  assert.deepEqual(await servis.al('camera.on_kapi'), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(await servis.al('camera.zil'), { ok: false, tur: 'gecersiz' });
  assert.equal(cagrilar.length, 0);
});

test('servis: HA\'da sonradan kapı/zil olarak adlandırılan ya da marka/model kapı zili olan onaylı kamera çekilmez ("yasak") ve önbellek silinir', async () => {
  const { servis, cagrilar, tablo, ilerle } = kur();
  assert.equal((await servis.al('camera.salon')).ok, true);
  assert.equal(servis.onbellekSayisi(), 1);
  tablo['camera.salon'] = durum('camera.salon', 'Ön kapı zili');
  ilerle(1000);
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'yasak' });
  assert.equal(servis.onbellekSayisi(), 0, 'yasaklanan kameranın karesi bellekten silinir');
  tablo['camera.salon'] = durum('camera.salon', 'Salon', 'idle', { model_name: 'Video Doorbell' });
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'yasak' });
  tablo['camera.salon'] = durum('camera.salon', 'Salon', 'idle', { device_class: 'door' });
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'yasak' });
  assert.equal(cagrilar.length, 1, 'yasaklanınca hiç ağ isteği gitmedi');
});

test('servis: durumu bilinmeyen, kimliği uyuşmayan ya da unavailable kamera "ulasilamiyor"', async () => {
  const { servis, cagrilar, tablo } = kur({ durumlar: { 'camera.salon': durum('camera.salon', 'Salon', 'unavailable') } });
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'ulasilamiyor' });
  delete tablo['camera.salon'];
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'ulasilamiyor' });
  tablo['camera.salon'] = durum('camera.baska', 'Salon');
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'ulasilamiyor' });
  assert.equal(cagrilar.length, 0);
});

test('servis: 5 sn içindeki ikinci istek önbellekten gelir (aynı kare, onbellek true, yaş artar); 5 sn sonra yeniden çekilir', async () => {
  const { servis, cagrilar, ilerle } = kur();
  const ilk = await servis.al('camera.salon');
  ilerle(2000);
  const ikinci = await servis.al('camera.salon');
  assert.equal(ikinci.ok, true);
  assert.equal(ikinci.onbellek, true);
  assert.equal(ikinci.yas, 2000);
  assert.equal(ikinci.veri, ilk.veri);
  assert.equal(cagrilar.length, 1);
  ilerle(K.EN_AZ_YENILEME_MS - 2000 - 1);
  assert.equal((await servis.al('camera.salon')).onbellek, true, '4999 ms: hâlâ önbellekte');
  ilerle(1);
  const yeni = await servis.al('camera.salon');
  assert.equal(yeni.onbellek, false);
  assert.equal(yeni.yas, 0);
  assert.equal(cagrilar.length, 2);
});

test('servis: saat geriye giderse (negatif yaş) önbellek geçerli sayılmaz, yeniden çekilir', async () => {
  const { servis, cagrilar, ilerle } = kur();
  await servis.al('camera.salon');
  ilerle(-60_000);
  const r = await servis.al('camera.salon');
  assert.equal(r.ok, true);
  assert.equal(r.onbellek, false);
  assert.equal(cagrilar.length, 2);
});

test('servis: aynı kamera için süren istek paylaşılır (aynı anda iki istek tek çekim)', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const { servis, cagrilar } = kur({ yanit: async () => (await bekle, { icerikTuru: 'image/jpeg', baytlar: JPEG }) });
  const a = servis.al('camera.salon');
  const b = servis.al('camera.salon');
  coz();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(cagrilar.length, 1);
  assert.equal(ra.ok, true);
  assert.deepEqual(ra, rb);
});

test('servis: dakikada en çok 20 çekim; sınırda karesi olan kamera eski kareyi (onbellek true) alır, ağ isteği gitmez; bir dakika sonra yeniden açılır', async () => {
  const durumlar = {};
  const izinler = [];
  for (let i = 0; i < 8; i += 1) {
    const k = `camera.k${i}`;
    durumlar[k] = durum(k, `K ${i}`);
    izinler.push(k);
  }
  const { servis, cagrilar, ilerle } = kur({ izinler, durumlar });
  const sonuclar = [];
  // 3 tur x 8 kamera, turlar arası 6 sn (önbellek geçersiz): 24 istek, yalnız 20'si ağa gider
  for (let tur = 0; tur < 3; tur += 1) {
    for (const k of izinler) sonuclar.push(await servis.al(k));
    ilerle(6000);
  }
  assert.equal(cagrilar.length, K.DAKIKA_CEKIM_SINIRI);
  assert.ok(sonuclar.every((r) => r.ok === true), 'karesi olan kameralar sınırda eski kareyi alır');
  const eskiler = sonuclar.slice(20);
  assert.equal(eskiler.length, 4);
  assert.ok(eskiler.every((r) => r.onbellek === true && r.yas >= K.EN_AZ_YENILEME_MS), 'son dördü sınır nedeniyle eski kare');
  ilerle(61_000);
  const sonra = await servis.al('camera.k0');
  assert.equal(sonra.ok, true);
  assert.equal(sonra.onbellek, false);
  assert.equal(cagrilar.length, K.DAKIKA_CEKIM_SINIRI + 1);
});

test('servis: sınır dolu ve kameranın karesi hiç yoksa "cok-sik" (ağ isteği gitmez)', async () => {
  const durumlar = {};
  const izinler = [];
  for (let i = 0; i < 24; i += 1) {
    durumlar[`camera.k${i}`] = durum(`camera.k${i}`, `K ${i}`);
    izinler.push(`camera.k${i}`);
  }
  const { servis, cagrilar } = kur({ izinler, durumlar });
  const sonuclar = [];
  for (const k of izinler) sonuclar.push(await servis.al(k));
  assert.equal(cagrilar.length, K.DAKIKA_CEKIM_SINIRI);
  assert.equal(sonuclar.filter((r) => r.ok).length, 20);
  const reddedilen = sonuclar.filter((r) => !r.ok);
  assert.equal(reddedilen.length, 4);
  assert.ok(reddedilen.every((r) => r.tur === 'cok-sik'));
});

test('servis: ağ hatası "ha-hatasi", 404 "ulasilamiyor"; hata sonucu önbelleğe girmez; günlükte kimlik ve içerik yok', async () => {
  const { servis, gunlukler, cagrilar } = kur({ yanit: () => Promise.reject(new HaHatasi('baglanti')) });
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'ha-hatasi' });
  assert.equal(servis.onbellekSayisi(), 0);
  assert.equal(cagrilar.length, 1);
  const k2 = kur({ yanit: () => Promise.reject(new HaHatasi('bulunamadi', 404)) });
  assert.deepEqual(await k2.servis.al('camera.salon'), { ok: false, tur: 'ulasilamiyor' });
  const k3 = kur({ yanit: () => Promise.reject(new Error('camera.salon http://192.168.1.10 TEST_ANAHTAR')) });
  assert.deepEqual(await k3.servis.al('camera.salon'), { ok: false, tur: 'ha-hatasi' });
  for (const m of [...gunlukler, ...k2.gunlukler, ...k3.gunlukler]) assert.doesNotMatch(m, /camera\.|192\.168|TEST_ANAHTAR|data:/);
});

test('servis: temizle() bellekteki kareleri siler; temizlemeden ÖNCE başlayan çekim kareyi belleğe geri koymaz', async () => {
  const { servis, ilerle } = kur();
  await servis.al('camera.salon');
  assert.equal(servis.onbellekSayisi(), 1);
  servis.temizle();
  assert.equal(servis.onbellekSayisi(), 0);
  ilerle(10_000);

  let coz;
  const bekle = new Promise((c) => (coz = c));
  const k = kur({ yanit: async () => (await bekle, { icerikTuru: 'image/jpeg', baytlar: JPEG }) });
  const soz = k.servis.al('camera.salon');
  k.servis.temizle(); // çekim sürerken izin listesi değişti / panel gizlendi
  coz();
  const r = await soz;
  assert.equal(r.ok, true, 'çağıran yine de yanıtını alır');
  assert.equal(k.servis.onbellekSayisi(), 0, 'eski nesil kare belleğe girmedi');
});

test('servis: izin listesi sonradan daralırsa o kamera artık çekilmez (her çağrıda yeniden okunur)', async () => {
  const { servis, izinleriDegistir, cagrilar, ilerle } = kur();
  assert.equal((await servis.al('camera.salon')).ok, true);
  izinleriDegistir([]);
  ilerle(10_000);
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'izinsiz' });
  assert.equal(cagrilar.length, 1);
});

test('servis: önbellekteki kare izin kalkınca (temizle sonrası) bile dönmez; izinsiz kamera önbellekten de verilmez', async () => {
  const { servis, izinleriDegistir } = kur();
  await servis.al('camera.salon');
  izinleriDegistir([]);
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'izinsiz' }, 'önbellek varken bile izin yeniden denetlenir');
});

test('kaynak: kamera modülü diske yazmaz, dosya sistemi ya da ağ modülü yüklemez', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'kamera.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(kaynak, /require\(['"](node:)?(fs|net|http|https|child_process|dgram|tls)['"]\)/);
  assert.doesNotMatch(kaynak, /writeFile|appendFile|createWriteStream|\bfetch\(|XMLHttpRequest|WebSocket/);
});

// --- ha-istemcisi: ikili okuma seçeneği -----------------------------------------

const ANAHTAR = 'TEST_ANAHTAR_000';
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const AYAR = { yerelAdres: 'http://192.168.1.10:8123', disAdres: 'https://ha.example.com', yerelZamanAsimiMs: 3000, disZamanAsimiMs: 10000 };

function istemciKur(yanitla) {
  const cagrilar = [];
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push({ url, secenek });
      if (url.endsWith('/manifest.json')) return new Response(HA_MANIFEST, { status: 200 });
      return yanitla(url, secenek);
    },
    ayarlarAl: () => AYAR,
    anahtarAl: async () => ANAHTAR,
    aktifAdresAl: () => null,
    yenidenBaglan: () => {},
    gunluk: () => {},
  });
  return { istemci, cagrilar, apiCagrilari: () => cagrilar.filter((c) => !c.url.endsWith('/manifest.json')) };
}
const resim = (baytlar, tur = 'image/jpeg', ek = {}) => new Response(baytlar, { status: 200, headers: { 'content-type': tur, ...ek } });

test('haIstek ikili: görüntü baytları ve içerik türü döner; Accept yalnız resim türleri, Authorization yalnız doğrulanmış adrese', async () => {
  const { istemci, apiCagrilari } = istemciKur(() => resim(JPEG));
  const r = await istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 });
  assert.equal(r.icerikTuru, 'image/jpeg');
  assert.deepEqual([...r.bayt], [...JPEG]);
  const cagri = apiCagrilari().find((c) => c.url.endsWith('/api/camera_proxy/camera.salon'));
  assert.ok(cagri, 'istek gitti');
  assert.equal(cagri.secenek.method, 'GET');
  assert.equal(cagri.secenek.headers.Accept, 'image/jpeg, image/png, image/webp');
  assert.equal(cagri.secenek.redirect, 'error');
});

test('haIstek ikili: POST ya da geçersiz sınır reddedilir ve ağ isteği gitmez', async () => {
  const { istemci, cagrilar } = istemciKur(() => resim(JPEG));
  for (const secenek of [
    { yontem: 'POST', ikili: true, enCokBayt: 1024 },
    { ikili: true, enCokBayt: 0 },
    { ikili: true, enCokBayt: -5 },
    { ikili: true, enCokBayt: 1.5 },
    { ikili: true, enCokBayt: '1024' },
    { ikili: true },
  ]) {
    await assert.rejects(() => istemci.haIstek('/api/camera_proxy/camera.salon', secenek), (h) => h instanceof HaHatasi && h.tur === 'sunucu', JSON.stringify(secenek));
  }
  assert.equal(cagrilar.length, 0);
});

test('haIstek ikili: sınırı aşan gövde (Content-Length ya da akış) "sunucu" hatasıdır', async () => {
  const buyuk = new Uint8Array(4096);
  buyuk.set(JPEG);
  const a = istemciKur(() => resim(buyuk, 'image/jpeg', { 'content-length': '4096' }));
  await assert.rejects(() => a.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 }), (h) => h.tur === 'sunucu');
  // Content-Length yok ya da yalan: akış okunurken sınır aşılırsa bırakılır
  const b = istemciKur(() => new Response(new ReadableStream({ start(c) { c.enqueue(buyuk.slice(0, 2048)); c.enqueue(buyuk.slice(2048)); c.close(); } }), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(() => b.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 }), (h) => h.tur === 'sunucu');
  const tam = istemciKur(() => resim(buyuk));
  const r = await tam.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 4096 });
  assert.equal(r.bayt.length, 4096, 'sınırda (eşit) kabul');
});

test('haIstek ikili: 404, 401 ve 5xx hata verir; başarı gövdesi olmayan yanıt "sunucu" hatasıdır', async () => {
  const dort = istemciKur(() => new Response('yok', { status: 404 }));
  await assert.rejects(() => dort.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 }), (h) => h.tur === 'bulunamadi');
  const bes = istemciKur(() => new Response('x', { status: 500 }));
  await assert.rejects(() => bes.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 }), (h) => h instanceof HaHatasi);
  const yetki = istemciKur(() => new Response('', { status: 401 }));
  await assert.rejects(() => yetki.istemci.haIstek('/api/camera_proxy/camera.salon', { ikili: true, enCokBayt: 1024 }), (h) => h instanceof HaHatasi);
});

test('haIstek ikili: sonuç servisle birleşir; HTML hata sayfası görüntü olarak verilmez', async () => {
  const { istemci } = istemciKur(() => new Response('<html>giriş yapın</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  const servis = K.kameraServisiOlustur({
    ikiliIstek: async (yol) => {
      const y = await istemci.haIstek(yol, { ikili: true, enCokBayt: K.EN_BUYUK_GORUNTU_BAYT });
      return { icerikTuru: y.icerikTuru, baytlar: y.bayt };
    },
    durumAl: (k) => durum(k, 'Salon'),
    izinlerAl: () => ['camera.salon'],
  });
  assert.deepEqual(await servis.al('camera.salon'), { ok: false, tur: 'goruntu-yok' });
});
