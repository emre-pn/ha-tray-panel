'use strict';

/**
 * Tanılama raporu (o-41): src/lib/tanilama.js. Saf modül; günlük okuması gerçek geçici dosyalarla sınanır.
 * Ana süreç tarafı (IPC, pano, klasörde göster) test/ana-surec.test.js'tedir; Ayarlar sayfası test/ayarlar-tanilama.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SINIRLAR, adresSinifi, adresSinifiMetni, satiriTemizle, sonSatirlar, gunlukSonSatirlari, raporOlustur } = require('../src/lib/tanilama');
const { gunlukOlustur } = require('../src/lib/gunluk');

// Gerçek biçimde ama sahte değerler (testte gerçek anahtar yok): çalışma zamanında kurulur.
const SAHTE_ANAHTAR = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJpc3MiOiJ0ZXN0In0', '.', 'c2FobmUtaW16YQ'].join('');
const UZUN_ANAHTAR = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0';

const TEMEL = {
  simdi: new Date('2026-10-16T10:00:00.000Z'),
  uygulamaSurumu: '1.3.0',
  paketTuru: 'kurulu',
  surumler: { electron: '41.0.0', chrome: '142.0.7444.1', node: '24.1.0' },
  isletimSistemi: { platform: 'win32', surum: '10.0.26300', mimari: 'x64' },
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://evim.ornek-alan.com',
  baglantiTuru: 'yerel',
  canli: true,
  anahtarVar: true,
  yetkiDurumu: null,
  hataliDeneme: 0,
  yetkiKaydiSorunu: null,
  sonBasari: Date.parse('2026-10-16T09:55:00.000Z'),
  gunlukSatirlari: [],
};

test('adresSinifi: özel IP, yerel ad, genel ad, genel IP, boş ve geçersiz adresler; adresin kendisi hiç dönmez', () => {
  const durumlar = [
    ['http://192.168.1.10:8123', 'ozel-ip', 'http'],
    ['http://10.0.0.5', 'ozel-ip', 'http'],
    ['http://172.20.1.1:8123', 'ozel-ip', 'http'],
    ['http://100.101.1.1:8123', 'ozel-ip', 'http'], // Tailscale (CGNAT)
    ['http://[fd00::1]:8123', 'ozel-ip', 'http'],
    ['http://[fe80::1]:8123', 'ozel-ip', 'http'],
    ['https://203.0.113.5', 'genel-ip', 'https'],
    ['https://[2001:db8::1]', 'genel-ip', 'https'],
    ['http://homeassistant.local:8123', 'yerel-ad', 'http'],
    ['http://ha.lan:8123', 'yerel-ad', 'http'],
    ['http://homeassistant:8123', 'yerel-ad', 'http'],
    ['http://localhost:8123', 'yerel-ad', 'http'],
    ['https://evim.ornek-alan.com', 'genel-ad', 'https'],
    ['https://abc123.ui.nabu.casa', 'genel-ad', 'https'],
  ];
  for (const [adres, sinif, sema] of durumlar) {
    const s = adresSinifi(adres);
    assert.deepEqual(s, { sinif, sema }, adres);
    assert.equal(JSON.stringify(s).includes(new URL(adres).hostname.replace(/^\[|\]$/g, '')), false, `${adres}: ana bilgisayar sonuca sızmamalı`);
  }
  for (const bos of ['', '   ', null, undefined, 5, {}]) assert.deepEqual(adresSinifi(bos), { sinif: 'yok', sema: null });
  for (const bozuk of ['x', 'ftp://192.168.1.10', 'javascript:alert(1)', 'http://']) assert.deepEqual(adresSinifi(bozuk), { sinif: 'gecersiz', sema: null }, bozuk);
});

test('adresSinifiMetni: okunur sınıf + http/https; ana bilgisayar, IP ve port metne girmez', () => {
  assert.equal(adresSinifiMetni('http://192.168.1.10:8123'), 'private IP, http');
  assert.equal(adresSinifiMetni('http://homeassistant.local:8123'), 'local name (.local, .lan or single label), http');
  assert.equal(adresSinifiMetni('https://evim.ornek-alan.com'), 'public name, https');
  assert.equal(adresSinifiMetni('https://203.0.113.5'), 'public IP, https');
  assert.equal(adresSinifiMetni(''), 'not set');
  assert.equal(adresSinifiMetni('saçma'), 'invalid');
  for (const adres of ['http://192.168.1.10:8123', 'http://homeassistant.local:8123', 'https://evim.ornek-alan.com:8443']) {
    assert.doesNotMatch(adresSinifiMetni(adres), /192|homeassistant|ornek|8123|8443/);
  }
});

test('satiriTemizle: anahtar, JWT, Bearer, URL, IP, yerel ad, kullanıcı klasörü, varlık kimliği ve parmak izi maskelenir; saat damgası ve sıradan metin kalır', () => {
  const satir = satiriTemizle(
    `2026-10-16T09:00:02.123Z Hata ${SAHTE_ANAHTAR} Bearer ${UZUN_ANAHTAR} http://192.168.1.10:8123/lovelace?token=xyz https://evim.ornek-alan.com/api/webhook/gizli-kimlik ` +
      'ev.local 192.168.1.5:8123 fe80::1 C:\\Users\\emres\\AppData\\x /home/emre/x light.salon_lambasi switch.priz_1 parmak izi=ab12cd34 son',
  );
  for (const sizinti of [SAHTE_ANAHTAR, UZUN_ANAHTAR, '192.168.1.10', '192.168.1.5', 'ornek-alan', 'ev.local', 'fe80', 'emres', '/home/emre', 'salon_lambasi', 'priz_1', 'ab12cd34', 'gizli-kimlik', 'token=xyz']) {
    assert.equal(satir.includes(sizinti), false, `${sizinti} günlük satırında kaldı: ${satir}`);
  }
  assert.match(satir, /^2026-10-16T09:00:02\.123Z Hata /, 'saat damgası korunur');
  assert.match(satir, /\[url\]/);
  assert.match(satir, /light\.\[entity\]/);
  assert.match(satir, /C:\\Users\\\[user\]/);
  assert.match(satir, / son$/);
  assert.equal(satiriTemizle('Sayfa süreci kapandı (crashed); 5 sn sonra yeniden bağlanılacak.'), 'Sayfa süreci kapandı (crashed); 5 sn sonra yeniden bağlanılacak.');
  assert.equal(satiriTemizle('12:30:45 öğle'), '12:30:45 öğle', 'saat IPv6 sanılmaz');
});

test('satiriTemizle: satır tek satırdır, kontrol karakteri yoktur, uzun satır kısalır; metin olmayan girdi boş satır olur', () => {
  const s = satiriTemizle(`bir\r\niki\u0000üç${'x '.repeat(400)}`);
  assert.doesNotMatch(s, /[\r\n\u0000]/);
  assert.ok(s.length <= SINIRLAR.satirUzunlugu + 1);
  for (const girdi of [null, undefined, 5, {}, []]) assert.equal(satiriTemizle(girdi), '');
});

test('sonSatirlar: boş satırlar atılır, yalnız son N satır kalır; metin olmayan girdi boş liste', () => {
  assert.deepEqual(sonSatirlar('a\n\nb\r\nc\n', 2), ['b', 'c']);
  assert.deepEqual(sonSatirlar('a\nb', 10), ['a', 'b']);
  assert.deepEqual(sonSatirlar(null, 3), []);
  assert.deepEqual(sonSatirlar('', 3), []);
});

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-tanilama-'));
}

test('gunlukSonSatirlari: gerçek günlük dosyasının son satırları okunur; az ise bir önceki dönüş dosyasından tamamlanır; eksik ya da okunamayan dosya çökertmez', () => {
  const dizin = gecici();
  try {
    let an = Date.parse('2026-10-16T08:00:00Z');
    const g = gunlukOlustur({ dizin, enFazlaBayt: 2000, simdi: () => new Date((an += 1000)) });
    for (let i = 1; i <= 80; i += 1) g.yaz(`olay ${i}`);
    assert.ok(fs.existsSync(g.eskiYol), 'günlük döndü (eski dosya var)');
    const son = gunlukSonSatirlari({ fs, yol: g.yol, eskiYol: g.eskiYol, enFazla: 30 });
    assert.equal(son.length, 30);
    assert.match(son.at(-1), / olay 80$/);
    assert.match(son[0], / olay 51$/, 'eskiden yeniye sıralı, kesintisiz');
    // yeni dosya boşken eski dosyadan tamamlanır
    fs.writeFileSync(g.yol, '');
    const eskiden = gunlukSonSatirlari({ fs, yol: g.yol, eskiYol: g.eskiYol, enFazla: 5 });
    assert.equal(eskiden.length, 5);
    // olmayan ya da geçersiz yollar
    assert.deepEqual(gunlukSonSatirlari({ fs, yol: path.join(dizin, 'yok.log'), eskiYol: null }), []);
    assert.deepEqual(gunlukSonSatirlari({ fs, yol: null, eskiYol: null }), []);
    assert.deepEqual(gunlukSonSatirlari({ fs, yol: dizin, eskiYol: undefined }), [], 'klasör dosya sayılmaz');
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
});

test('gunlukSonSatirlari: çok büyük dosyanın yalnız sonu okunur (bellek sınırlı)', () => {
  const dizin = gecici();
  try {
    const yol = path.join(dizin, 'buyuk.log');
    const satir = `${'y'.repeat(200)}\n`;
    fs.writeFileSync(yol, satir.repeat(5000) + 'SON SATIR\n'); // yaklaşık 1 MB
    assert.ok(fs.statSync(yol).size > SINIRLAR.okunacakBayt);
    const son = gunlukSonSatirlari({ fs, yol, enFazla: 3 });
    assert.equal(son.at(-1), 'SON SATIR');
    assert.equal(son.length, 3);
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
});

test('raporOlustur: tüm alanlar yazılır; adres yalnız sınıf olarak, anahtar hiç; bölümler ve sıra sabittir', () => {
  const { metin, gunlukSatiri } = raporOlustur({
    ...TEMEL,
    gunlukSatirlari: ['2026-10-16T09:00:01.000Z Sayfa yüklenemedi: ERR_CONNECTION_REFUSED', '2026-10-16T09:00:02.000Z Yetki kesici: 0 reddedilmiş anahtar kaydı yüklendi.'],
  });
  assert.equal(gunlukSatiri, 2);
  assert.equal(
    metin,
    [
      'Ev Paneli / Home Panel diagnostics report',
      'Created: 2026-10-16T10:00:00.000Z',
      'App version: 1.3.0 (installed build)',
      'Electron: 41.0.0, Chrome: 142.0.7444.1, Node: 24.1.0',
      'System: Windows 10.0.26300, x64',
      '',
      'Home address: private IP, http',
      'External address: public name, https',
      'Connection: home network',
      'Live updates (WebSocket): connected',
      'Access key: added (the key itself is never included)',
      'Key status: ok',
      'Failed sign-in attempts counted: 0',
      'Breaker record: ok',
      'Last successful contact: 2026-10-16T09:55:00.000Z (5 min ago)',
      '',
      'Recent log lines (2; secrets, addresses and device names masked):',
      '2026-10-16T09:00:01.000Z Sayfa yüklenemedi: ERR_CONNECTION_REFUSED',
      '2026-10-16T09:00:02.000Z Yetki kesici: 0 reddedilmiş anahtar kaydı yüklendi.',
      '',
    ].join('\n'),
  );
  for (const sizinti of ['192.168.1.10', 'ornek-alan', '8123']) assert.equal(metin.includes(sizinti), false, `${sizinti} rapora girdi`);
});

test('raporOlustur: yetki kesici durumları, hatalı deneme sayısı, kayıt sorunu, bağlantı kipi ve paket türü okunur biçimde yazılır', () => {
  const rapor = (ek) => raporOlustur({ ...TEMEL, ...ek }).metin;
  assert.match(rapor({ yetkiDurumu: 'reddedildi', hataliDeneme: 3 }), /Key status: rejected by Home Assistant\nFailed sign-in attempts counted: 3\n/);
  assert.match(rapor({ yetkiDurumu: 'dogrulanamadi' }), /Key status: could not be verified/);
  assert.match(rapor({ yetkiDurumu: 'kayit-onayi' }), /Key status: waiting for confirmation/);
  assert.match(rapor({ yetkiDurumu: 'yerel-yasak' }), /Key status: home address blocked \(HTTP 403\)/);
  assert.match(rapor({ yetkiDurumu: 'bilinmeyen-bir-durum' }), /Key status: unknown/);
  assert.match(rapor({ anahtarVar: false }), /Access key: not added[^\n]*\nKey status: no key added/);
  assert.match(rapor({ yetkiKaydiSorunu: 'yazilamadi' }), /Breaker record: record not writable/);
  assert.match(rapor({ yetkiKaydiSorunu: 'okunamadi' }), /Breaker record: record not readable/);
  assert.match(rapor({ baglantiTuru: 'dis', canli: false }), /Connection: external address\nLive updates \(WebSocket\): not connected/);
  assert.match(rapor({ baglantiTuru: null }), /Connection: none/);
  assert.match(rapor({ paketTuru: 'tasinabilir' }), /\(portable build\)/);
  assert.match(rapor({ paketTuru: 'gelistirme' }), /\(development build\)/);
  assert.match(rapor({ paketTuru: 'garip' }), /\(unknown build\)/);
  assert.match(rapor({ sonBasari: null }), /Last successful contact: never in this session/);
  assert.match(rapor({ sonBasari: Date.parse('2026-10-16T10:05:00Z') }), /\(0 min ago\)/, 'gelecek zaman negatif yazılmaz');
  assert.match(rapor({ yerelAdres: '', disAdres: null }), /Home address: not set\nExternal address: not set/);
});

test('raporOlustur: bozuk girdiler (sürüm, platform, sayaç, günlük) güvenli yedeklerle yazılır; rapor yine üretilir', () => {
  const { metin, gunlukSatiri } = raporOlustur({
    simdi: new Date('2026-10-16T10:00:00Z'),
    uygulamaSurumu: '1.3.0 <script>x</script>',
    paketTuru: 'kurulu',
    surumler: { electron: { x: 1 }, chrome: null },
    isletimSistemi: { platform: 'linux', surum: '6.1', mimari: 7 },
    hataliDeneme: -4,
    gunlukSatirlari: 'bu bir liste değil',
  });
  assert.match(metin, /App version: unknown \(installed build\)/);
  assert.match(metin, /Electron: unknown, Chrome: unknown, Node: unknown/);
  assert.match(metin, /System: linux 6\.1, unknown/);
  assert.match(metin, /Failed sign-in attempts counted: 0/);
  assert.match(metin, /\(log is empty or unreadable\)/);
  assert.equal(gunlukSatiri, 0);
  assert.doesNotThrow(() => raporOlustur({}));
});

test('raporOlustur: günlük satırları rapora girmeden maskelenir; en çok SINIRLAR.gunlukSatiri satır girer (son satırlar)', () => {
  const satirlar = Array.from({ length: 100 }, (_, i) => `2026-10-16T09:00:00.000Z olay ${i} http://10.0.0.${i % 250}:8123/x ${i === 99 ? SAHTE_ANAHTAR : ''}`);
  const { metin, gunlukSatiri } = raporOlustur({ ...TEMEL, gunlukSatirlari: satirlar });
  assert.equal(gunlukSatiri, SINIRLAR.gunlukSatiri);
  assert.match(metin, /olay 99 \[url\]/);
  assert.doesNotMatch(metin, /olay 59 \[url\]/);
  assert.match(metin, /olay 60 \[url\]/);
  assert.equal(metin.includes(SAHTE_ANAHTAR), false);
  assert.equal(/10\.0\.0\./.test(metin), false);
});

test('raporOlustur: erişim anahtarı değeri hiçbir girdiden rapora geçmez; modül anahtar alanı kabul etmez', () => {
  const { metin } = raporOlustur({ ...TEMEL, anahtar: UZUN_ANAHTAR, erisimAnahtari: UZUN_ANAHTAR, token: SAHTE_ANAHTAR });
  assert.equal(metin.includes(UZUN_ANAHTAR), false);
  assert.equal(metin.includes(SAHTE_ANAHTAR), false);
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'tanilama.js'), 'utf8');
  assert.doesNotMatch(kaynak, /anahtarAl|anahtarDeposu|safeStorage|require\('electron'\)|require\('\.\/ha-/, 'modül anahtara ve elektrona erişmez');
});

test('rapor metni sabit İngilizcedir: ayarlar dili değişse de değişmez (sorun kaydı dili)', () => {
  const { metin } = raporOlustur(TEMEL);
  assert.doesNotMatch(metin, /[ğüşıöçĞÜŞİÖÇ]/, 'başlık ve alan adlarında Türkçe karakter yok');
});
