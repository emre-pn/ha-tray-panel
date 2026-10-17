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
const { SINIRLAR, adresSinifi, adresSinifiMetni, maskeKur, satiriTemizle, sonSatirlar, gunlukSonSatirlari, raporOlustur } = require('../src/lib/tanilama');
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

test('satiriTemizle: URL olmayan genel ana bilgisayar adları (FQDN) da maskelenir; dosya adları, sürümler ve saat damgası okunur kalır', () => {
  for (const host of ['ha.ornek-alan.com', 'homeassistant.duckdns.org', 'abc123.ui.nabu.casa', 'www.ornek.co.uk', 'evim.ornek-alan.com.tr']) {
    const satir = satiriTemizle(`getaddrinfo ENOTFOUND ${host} bağlantı kurulamadı`);
    assert.equal(satir, 'getaddrinfo ENOTFOUND [host] bağlantı kurulamadı', host);
    assert.equal(satiriTemizle(`${host}:8123 yanıt vermedi`), '[host] yanıt vermedi', `${host}: port da gider`);
  }
  assert.equal(satiriTemizle('ENOTFOUND HA.Ornek-Alan.COM'), 'ENOTFOUND [host]', 'büyük harf fark etmez');
  const korunan = [
    '2026-10-16T09:00:02.123Z Ayarlar yazıldı: ayarlar.json',
    'Yedek alındı: ayarlar.v6-yedek-1760000000123.json',
    'Günlük döndü: ev-paneli.log ve ev-paneli.log.1'.replace('.log.1', '.tmp'),
    'Ev Paneli 1.4.0 (Electron 41.0.0, Node 24.1.0, Windows 10.0.26300) main.js ve Ev Paneli.exe',
    'Işık 3.5 saniye bekledi, sürüm v1.4.0-beta.2',
  ];
  for (const satir of korunan) assert.equal(satiriTemizle(satir), satir, 'dosya adı/sürüm bozulmamalı');
  // Varlık kimliği hâlâ [entity], FQDN değil
  assert.equal(satiriTemizle('light.masa ha.ornek-alan.com'), 'light.[entity] [host]');
});

test('maskeKur + satiriTemizle: Windows kullanıcı adı (boşluklu olsa da) tam eşleşmeyle maskelenir; yol kuralı tek başına boşluktan sonrasını bırakırdı', () => {
  const satir = 'Ayarlar okunamadı: C:\\Users\\Emre Sav\\AppData\\Roaming\\x.json (hesap: Emre Sav, emre   sav)';
  const eski = satiriTemizle(satir); // maskesiz: yol kuralı "Emre"yi alır, " Sav" kalır
  assert.match(eski, /Sav/, 'maskesiz hâlde boşluklu ad sızıyordu');
  const maske = maskeKur({ kullaniciAdlari: ['Emre Sav', 'emres'] });
  const temiz = satiriTemizle(satir, maske);
  assert.equal(temiz, 'Ayarlar okunamadı: C:\\Users\\[user]\\AppData\\Roaming\\x.json (hesap: [user], [user])');
  assert.equal(/emre|sav/i.test(temiz), false);
  // büyük/küçük harf ve ikinci ad (klasör adı) da maskelenir
  assert.equal(satiriTemizle('Oturum: EMRES ve emres.', maske), 'Oturum: [user] ve [user].');
  // tam sözcük eşleşmesi: ad başka bir sözcüğün parçasıysa dokunulmaz
  assert.equal(satiriTemizle('emresin emresiz Memres', maske), 'emresin emresiz Memres');
  // Türkçe harfli ad
  assert.equal(satiriTemizle('Kullanıcı Şükrü Çelik girdi', maskeKur({ kullaniciAdlari: ['Şükrü Çelik'] })), 'Kullanıcı [user] girdi');
  // regex özel karakterleri düz metindir
  assert.equal(satiriTemizle('ad a.b+c(1) ve axb+c(1)', maskeKur({ kullaniciAdlari: ['a.b+c(1)'] })), 'ad [user] ve axb+c(1)');
});

test('maskeKur: çok kısa adlar, maske etiketi adları, metin olmayan girdiler ve bozuk adresler güvenle yok sayılır', () => {
  assert.equal(satiriTemizle('al ve ab sıradan sözcük', maskeKur({ kullaniciAdlari: ['al', 'ab', ' '] })), 'al ve ab sıradan sözcük', '3 harften kısa ad serbest metinde aranmaz');
  const etiket = maskeKur({ kullaniciAdlari: ['user', 'HOST', 'url'], adresler: ['http://url:8123'] });
  assert.equal(etiket.kullanici, null);
  assert.equal(etiket.anaBilgisayar, null);
  assert.equal(satiriTemizle('C:\\Users\\emre\\x [host] [url]', etiket), 'C:\\Users\\[user]\\x [host] [url]', 'etiketler yeniden maskelenip bozulmaz');
  assert.doesNotThrow(() => maskeKur());
  assert.doesNotThrow(() => maskeKur({ kullaniciAdlari: 'metin', adresler: 'metin' }));
  const bozuk = maskeKur({ kullaniciAdlari: [5, null, {}, undefined, 'Geçerli Ad'], adresler: [5, null, '', 'saçma', 'ftp://ftp.ornek.com', 'http://[fe80::1]:8123', 'http://192.168.1.10:8123'] });
  assert.equal(satiriTemizle('Geçerli Ad girdi', bozuk), '[user] girdi');
  assert.ok(bozuk.anaBilgisayar === null || !bozuk.anaBilgisayar.test('ftp.ornek.com'), 'ftp adresi ayar ana bilgisayarı sayılmaz');
  assert.equal(satiriTemizle('192.168.1.10 ve fe80::1', bozuk), '[ip] ve [ip6]', 'IP adresleri kendi kurallarıyla maskelenir');
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
      'Key user: not checked',
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

test('raporOlustur: anahtarın kullanıcı türü (o-43) yalnız yönetici / yönetici değil / denetlenmedi olarak yazılır; kullanıcı bilgisi rapora girmez', () => {
  const rapor = (ek) => raporOlustur({ ...TEMEL, ...ek }).metin;
  assert.match(rapor({ anahtarYonetici: true }), /\nKey user: administrator \(a non-administrator user is recommended\)\n/);
  assert.match(rapor({ anahtarYonetici: false }), /\nKey user: non-administrator \(recommended\)\n/);
  assert.match(rapor({ anahtarYonetici: null }), /\nKey user: not checked\n/);
  assert.match(rapor({}), /\nKey user: not checked\n/, 'alan verilmezse denetlenmedi');
  assert.match(rapor({ anahtarYonetici: 'evet' }), /\nKey user: not checked\n/, 'boolean olmayan değer yönetici sayılmaz');
  assert.match(rapor({ anahtarVar: false, anahtarYonetici: true }), /\nKey user: not applicable \(no key added\)\n/, 'anahtar yoksa kullanıcı türü anlamsızdır');
  assert.match(rapor({ anahtarYonetici: true }), /Last successful contact:[^\n]*\nKey user:/, 'satır sabit yerde: son başarılı temasın hemen altı');
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

test('raporOlustur: ayarlardaki ana bilgisayar adları (tek etiketli olsa da) ve Windows kullanıcı adı günlük satırlarından maskelenir', () => {
  const { metin } = raporOlustur({
    ...TEMEL,
    yerelAdres: 'http://nas:8123',
    disAdres: 'https://Evim.Ornek-Alan.com',
    kullaniciAdlari: ['Emre Sav', 'emres'],
    gunlukSatirlari: [
      '2026-10-16T09:00:01.000Z nas bağlantısı koptu (nas:8123)',
      '2026-10-16T09:00:02.000Z Dış adres evim.ornek-alan.com yanıt vermedi',
      '2026-10-16T09:00:03.000Z Dosya C:\\Users\\Emre Sav\\AppData\\Roaming\\Ev Paneli\\ayarlar.json okunamadı (Emre Sav)',
      '2026-10-16T09:00:04.000Z Yerel adres nasıl bulunur? Nashville değişmez',
    ],
  });
  for (const sizinti of ['nas:', 'ornek-alan', 'Evim', 'Emre', 'Sav', 'emres']) assert.equal(metin.includes(sizinti), false, `${sizinti} rapora girdi:\n${metin}`);
  assert.match(metin, /\[host\] bağlantısı koptu \(\[host\]\)/);
  assert.match(metin, /Dış adres \[host\] yanıt vermedi/);
  assert.match(metin, /C:\\Users\\\[user\]\\AppData\\Roaming\\Ev Paneli\\ayarlar\.json okunamadı \(\[user\]\)/);
  assert.match(metin, /Yerel adres nasıl bulunur\? Nashville değişmez/, 'ad başka sözcüğün parçasıysa dokunulmaz');
});

test('raporOlustur: kullaniciAdlari verilmese de genel kurallar çalışır (eski çağrılar bozulmaz)', () => {
  const { metin } = raporOlustur({ ...TEMEL, gunlukSatirlari: ['2026-10-16T09:00:01.000Z ENOTFOUND ha.ornek-alan.com C:\\Users\\emres\\x'] });
  assert.match(metin, /ENOTFOUND \[host\] C:\\Users\\\[user\]\\x/);
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

test('raporOlustur (1.4.0 dis grubu): dış tetikler satırı yalnız açık/kapalı ve sayı yazar; özetteki başka alan (jeton, ad, port) rapora geçmez', () => {
  assert.doesNotMatch(raporOlustur(TEMEL).metin, /External triggers/, 'özet verilmezse satır yok (eski çağrılar)');
  const { metin } = raporOlustur({
    ...TEMEL,
    disTetikler: {
      jumpList: true,
      masaustu: false,
      protokol: true,
      protokolIzinSayisi: 2,
      yerelApi: true,
      apiCalisiyor: true,
      pcOlaylari: true,
      pcKuralSayisi: 'çok',
      toplanti: 'evet',
      jeton: UZUN_ANAHTAR,
      port: 48123,
      ad: 'Salon Lambası',
      kimlik: 'light.salon',
    },
  });
  const satir = metin.split('\n').find((s) => s.startsWith('External triggers:'));
  assert.equal(
    satir,
    'External triggers: Jump List on, desktop shortcut off, evpaneli:// link on (2 allowed), local API on (running), PC events on (0 rules), meeting light off',
  );
  assert.doesNotMatch(metin, new RegExp(`${UZUN_ANAHTAR}|48123|Salon|light\\.salon`));
  assert.match(raporOlustur({ ...TEMEL, disTetikler: { yerelApi: true } }).metin, /local API on \(not running\)/);
});
