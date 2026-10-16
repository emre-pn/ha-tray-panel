'use strict';

/**
 * `--durum` / `--liste` çıktısı (o-19): durum belgesi, çıktı yolu doğrulaması ve atomik dosya yazımı. Gerçek kullanıcı klasörü
 * kullanılmaz; her test geçici bir "ev" klasörü kurar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BELGE_BICIMI, BELGE_SURUMU, EN_COK_KARO, durumBelgesiOlustur, ciktiYoluCoz, durumDosyasiYaz } = require('../src/lib/komut-durum');

const SIMDI = new Date('2026-10-16T12:00:00.000Z');
const karo = (id, etiket, ek = {}) => ({ id, etiket, alan: id.split('.')[0], durum: 'acik', yuzde: null, kullanilabilir: true, sinif: 'zararsiz', ...ek });

function gecici() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-durum-'));
  const ev = path.join(kok, 'ev');
  fs.mkdirSync(path.join(ev, 'AppData', 'Ev Paneli'), { recursive: true });
  fs.mkdirSync(path.join(ev, 'Belgeler'), { recursive: true });
  return { kok, ev, veri: path.join(ev, 'AppData', 'Ev Paneli'), temizle: () => fs.rmSync(kok, { recursive: true, force: true }) };
}

test('durumBelgesiOlustur: --durum belgesi sayıları ve bağlantı SINIFINI taşır; favori listesi yoktur', () => {
  const b = durumBelgesiOlustur({
    simdi: SIMDI,
    uygulamaSurumu: '1.4.0',
    baglantiTuru: 'yerel',
    canli: true,
    anahtarVar: true,
    anaPencere: 'gizli',
    karolar: [karo('light.masa', 'Masa', { yuzde: 40 }), karo('light.tavan', 'Tavan', { durum: 'kapali' }), karo('switch.priz', 'Priz')],
  });
  assert.equal(b.bicim, BELGE_BICIMI);
  assert.equal(b.surum, BELGE_SURUMU);
  assert.equal(b.tur, 'durum');
  assert.equal(b.zaman, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(b.uygulama, { surum: '1.4.0' });
  assert.deepEqual(b.baglanti, { tur: 'yerel', canli: true, anahtarVar: true });
  assert.deepEqual(b.pencere, { ana: 'gizli' });
  assert.equal(b.favoriSayisi, 3);
  assert.equal(b.acikIsikSayisi, 1);
  assert.equal('favoriler' in b, false);
});

test('durumBelgesiOlustur: --liste her karo için kimlik, ad, alan, durum, yüzde, kullanılabilirlik ve onay bilgisini yazar', () => {
  const b = durumBelgesiOlustur({
    liste: true,
    simdi: SIMDI,
    karolar: [karo('light.masa', 'Masa', { yuzde: 40 }), karo('button.pc_kapat', 'PC kapat', { sinif: 'yikici', durum: 'notr' }), karo('scene.film', 'Film', { durum: 'bilinmeyen-durum', kullanilabilir: false })],
  });
  assert.equal(b.tur, 'liste');
  assert.deepEqual(b.favoriler, [
    { kimlik: 'light.masa', ad: 'Masa', alan: 'light', durum: 'acik', yuzde: 40, kullanilabilir: true, onayli: false },
    { kimlik: 'button.pc_kapat', ad: 'PC kapat', alan: 'button', durum: 'notr', yuzde: null, kullanilabilir: true, onayli: true },
    { kimlik: 'scene.film', ad: 'Film', alan: 'scene', durum: 'yok', yuzde: null, kullanilabilir: false, onayli: false },
  ]);
});

test('durumBelgesiOlustur: yalnız beyaz listedeki alanlar yazılır; anahtar, adres, ham öznitelik ve HA adı belgeye girmez', () => {
  // JWT benzeri sahte değer çalışma anında kurulur: kaynakta JWT biçiminde sabit bulunmaz (test/yapi.test.js denetler).
  const sir = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'sahteSahteSahte', 'sahteSahteSahte'].join('.');
  const b = durumBelgesiOlustur({
    liste: true,
    simdi: SIMDI,
    baglantiTuru: 'http://192.168.1.10:8123', // adres verilse bile sınıf dışında değer kabul edilmez
    karolar: [{ ...karo('light.masa', 'Masa'), token: sir, attributes: { friendly_name: 'Gizli Ad' }, webhook_id: 'abc', adres: 'http://ha.local' }],
  });
  const metin = JSON.stringify(b);
  assert.equal(b.baglanti.tur, 'yok', 'bilinmeyen sınıf "yok" olur');
  for (const yasak of [sir, 'Gizli Ad', 'webhook', 'abc', 'ha.local', '192.168', 'token', 'attributes']) assert.ok(!metin.includes(yasak), `belgede ${yasak} yok`);
});

test('durumBelgesiOlustur: metinler kırpılır, denetim karakterleri atılır; karo sayısı sınırlıdır; bozuk girdiler çökertmez', () => {
  const b = durumBelgesiOlustur({
    liste: true,
    simdi: SIMDI,
    uygulamaSurumu: '1.4.0\u0000'.padEnd(60, 'x'),
    karolar: [karo('light.a', `Uzun\nAd${'x'.repeat(100)}`)],
  });
  assert.ok(b.uygulama.surum.length <= 20);
  assert.ok(b.favoriler[0].ad.length <= 40 && !b.favoriler[0].ad.includes('\n'));
  const cok = durumBelgesiOlustur({ simdi: SIMDI, karolar: Array.from({ length: EN_COK_KARO + 50 }, (_, i) => karo(`light.k${i}`, `K${i}`)) });
  assert.equal(cok.favoriSayisi, EN_COK_KARO);
  assert.doesNotThrow(() => durumBelgesiOlustur({ simdi: 'x', karolar: [null, 5, {}, { id: 3 }] }));
  assert.equal(durumBelgesiOlustur({ simdi: SIMDI, karolar: 'x' }).favoriSayisi, 0);
  assert.deepEqual(durumBelgesiOlustur({ simdi: SIMDI, anaPencere: 'bilinmez' }).pencere, { ana: 'yok' });
});

test('ciktiYoluCoz: kullanıcı klasörünün içinde .json yolu kabul edilir; göreli yol komutu veren klasöre göre çözülür', () => {
  const g = gecici();
  try {
    const yasak = [g.veri];
    const a = ciktiYoluCoz(path.join(g.ev, 'Belgeler', 'durum.json'), { ev: g.ev, yasakKlasorler: yasak });
    assert.deepEqual(a, { ok: true, yol: path.join(g.ev, 'Belgeler', 'durum.json') });
    const b = ciktiYoluCoz('durum.json', { dizin: path.join(g.ev, 'Belgeler'), ev: g.ev, yasakKlasorler: yasak });
    assert.equal(b.yol, path.join(g.ev, 'Belgeler', 'durum.json'));
    const c = ciktiYoluCoz('durum.json', { ev: g.ev, yasakKlasorler: yasak }); // çalışma klasörü yok: kullanıcı klasörü
    assert.equal(c.yol, path.join(g.ev, 'durum.json'));
    assert.equal(ciktiYoluCoz('DURUM.JSON', { ev: g.ev }).ok, true, 'uzantı büyük küçük harf fark etmez');
  } finally {
    g.temizle();
  }
});

test('ciktiYoluCoz: boş, .json olmayan, kullanıcı klasörü dışı, uygulama veri klasörü, ADS (dosya.json:akis), özel karakter ve aşırı uzun yol reddedilir', () => {
  const g = gecici();
  try {
    const ayar = { ev: g.ev, yasakKlasorler: [g.veri] };
    assert.deepEqual(ciktiYoluCoz('', ayar), { ok: false, neden: 'gerekli' });
    assert.deepEqual(ciktiYoluCoz(null, ayar), { ok: false, neden: 'gerekli' });
    assert.deepEqual(ciktiYoluCoz(undefined, ayar), { ok: false, neden: 'gerekli' });
    for (const kotu of [
      'durum.txt',
      'durum.json.exe',
      'durum',
      path.join(g.kok, 'baska', 'durum.json'), // ev dışı
      path.join(g.ev, '..', 'durum.json'),
      path.join(g.veri, 'ayarlar.json'), // uygulama veri klasörü
      path.join(g.veri, 'alt', 'x.json'),
      `${path.join(g.ev, 'durum.json')}:akis`,
      path.join(g.ev, 'dur|um.json'),
      path.join(g.ev, 'dur*um.json'),
      path.join(g.ev, 'dur\u0000um.json'),
      `${path.join(g.ev, 'a'.repeat(300))}.json`,
      g.ev, // klasörün kendisi
    ]) {
      const s = ciktiYoluCoz(kotu, ayar);
      assert.equal(s.ok, false, `reddedilmeli: ${kotu}`);
    }
    assert.equal(ciktiYoluCoz('durum.json', { ev: 'göreli/ev' }).ok, false, 'ev mutlak olmalı');
    assert.equal(ciktiYoluCoz('durum.json', {}).ok, false);
    assert.equal(ciktiYoluCoz(5, ayar).ok, false);
  } finally {
    g.temizle();
  }
});

test('durumDosyasiYaz: JSON yazar (geçici dosya kalmaz), var olan dosyayı değiştirir; klasör yoksa oluşturmaz', () => {
  const g = gecici();
  try {
    const belge = durumBelgesiOlustur({ simdi: SIMDI, karolar: [karo('light.masa', 'Masa')] });
    const yol = path.join(g.ev, 'Belgeler', 'durum.json');
    assert.deepEqual(durumDosyasiYaz(yol, belge, { ev: g.ev, yasakKlasorler: [g.veri] }), { ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(yol, 'utf8')), JSON.parse(JSON.stringify(belge)));
    assert.ok(fs.readFileSync(yol, 'utf8').endsWith('\n'));
    assert.deepEqual(fs.readdirSync(path.join(g.ev, 'Belgeler')), ['durum.json'], 'geçici dosya kalmadı');
    fs.writeFileSync(yol, 'eski', 'utf8');
    assert.equal(durumDosyasiYaz(yol, belge, { ev: g.ev }).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(yol, 'utf8')).favoriSayisi, 1);
    assert.deepEqual(durumDosyasiYaz(path.join(g.ev, 'yokKlasor', 'd.json'), belge, { ev: g.ev }), { ok: false, neden: 'yazilamadi' });
    assert.equal(fs.existsSync(path.join(g.ev, 'yokKlasor')), false, 'klasör oluşturulmaz');
  } finally {
    g.temizle();
  }
});

test('durumDosyasiYaz: hedef klasör ya da düz olmayan dosyaysa, ya da yasak klasördeyse yazılmaz', () => {
  const g = gecici();
  try {
    const belge = durumBelgesiOlustur({ simdi: SIMDI });
    fs.mkdirSync(path.join(g.ev, 'Belgeler', 'durum.json')); // hedef bir klasör
    assert.deepEqual(durumDosyasiYaz(path.join(g.ev, 'Belgeler', 'durum.json'), belge, { ev: g.ev }), { ok: false, neden: 'dosya-degil' });
    assert.deepEqual(durumDosyasiYaz(path.join(g.veri, 'x.json'), belge, { ev: g.ev, yasakKlasorler: [g.veri] }), { ok: false, neden: 'klasor' }, 'veri klasörüne yazılmaz');
    assert.equal(fs.existsSync(path.join(g.veri, 'x.json')), false);
    const baskaKok = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-disari-'));
    try {
      assert.equal(durumDosyasiYaz(path.join(baskaKok, 'x.json'), belge, { ev: g.ev }).ok, false, 'kullanıcı klasörü dışına yazılmaz');
    } finally {
      fs.rmSync(baskaKok, { recursive: true, force: true });
    }
  } finally {
    g.temizle();
  }
});

test('durumDosyasiYaz: yazma hatasında geçici dosya silinir ve hata ayrıntısı sızdırılmaz', () => {
  const g = gecici();
  try {
    const belge = durumBelgesiOlustur({ simdi: SIMDI });
    const yol = path.join(g.ev, 'Belgeler', 'durum.json');
    const sahteFs = { ...fs, renameSync: () => { throw Object.assign(new Error('C:\\gizli\\yol'), { code: 'EBUSY' }); } };
    const s = durumDosyasiYaz(yol, belge, { fs: sahteFs, ev: g.ev });
    assert.deepEqual(s, { ok: false, neden: 'yazilamadi' });
    assert.deepEqual(fs.readdirSync(path.join(g.ev, 'Belgeler')), [], 'geçici dosya temizlendi');
  } finally {
    g.temizle();
  }
});
