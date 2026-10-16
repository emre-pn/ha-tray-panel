'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VARLIK_KIMLIGI_DESENI, kokenAl, adresNormallestir, tamsayi, ozelAgAdiMi, anahtarIcinGuvenliAdresMi } = require('../src/lib/dogrulama');

test('adresNormallestir: ev içi adres http ve https kabul eder (soru-7)', () => {
  assert.equal(adresNormallestir('http://192.168.1.10:8123'), 'http://192.168.1.10:8123');
  assert.equal(adresNormallestir('https://ha.ev.lan'), 'https://ha.ev.lan');
  assert.equal(adresNormallestir('  https://ha.ev.lan:8443/yol?x=1  '), 'https://ha.ev.lan:8443');
});

test('adresNormallestir: dış adres yalnız https', () => {
  assert.equal(adresNormallestir('https://ha.example.com', true), 'https://ha.example.com');
  assert.equal(adresNormallestir('http://ha.example.com', true), null);
});

test('adresNormallestir: geçersiz girdiler reddedilir', () => {
  for (const kotu of ['', '   ', 'ftp://x', 'javascript:alert(1)', 'file:///c:/x', 'ev.local', 'http://u:p@host', null, undefined, 42]) {
    assert.equal(adresNormallestir(kotu), null, String(kotu));
  }
  assert.equal(adresNormallestir(`http://${'a'.repeat(301)}.com`), null);
});

test('kokenAl: yalnız http(s) kökeni', () => {
  assert.equal(kokenAl('https://ha.example.com/lovelace/0'), 'https://ha.example.com');
  assert.equal(kokenAl('file:///c:/x.html'), null);
  assert.equal(kokenAl('bozuk'), null);
});

test('tamsayi: aralık dışı ve tam sayı olmayanlar varsayılana döner', () => {
  assert.equal(tamsayi(5, 1, 10, 3), 5);
  assert.equal(tamsayi('7', 1, 10, 3), 7);
  assert.equal(tamsayi(11, 1, 10, 3), 3);
  assert.equal(tamsayi(1.5, 1, 10, 3), 3);
  assert.equal(tamsayi(undefined, 1, 10, 3), 3);
});

test('VARLIK_KIMLIGI_DESENI', () => {
  assert.ok(VARLIK_KIMLIGI_DESENI.test('light.masa_lambasi'));
  assert.ok(!VARLIK_KIMLIGI_DESENI.test('Light.x'));
  assert.ok(!VARLIK_KIMLIGI_DESENI.test('light'));
  assert.ok(!VARLIK_KIMLIGI_DESENI.test('light.x/../y'));
});

const anaBilgisayar = (adres) => new URL(adres).hostname;

test('ozelAgAdiMi: özel IPv4 aralıkları, loopback ve link-local', () => {
  for (const adres of ['http://192.168.1.10:8123', 'http://10.0.0.1', 'http://10.255.255.255', 'http://172.16.0.1', 'http://172.31.255.255', 'http://127.0.0.1:8123', 'http://169.254.10.10']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), true, adres);
  }
  // 1.2.0 (k-19): 100.64.0.1 artık ev ağı sayılır (Tailscale CGNAT aralığı, aşağıdaki test); bu yüzden bu listeden çıkarıldı.
  for (const adres of ['http://8.8.8.8', 'http://172.32.0.1', 'http://172.15.255.255', 'http://192.169.0.1', 'http://11.0.0.1', 'http://169.255.0.1']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), false, adres);
  }
});

test('k-19: Tailscale (CGNAT 100.64.0.0/10) adresleri http ile ev içi adres sayılır; aralığın dışı ve Tailscale adları sayılmaz', () => {
  for (const adres of ['http://100.64.0.1', 'http://100.64.0.0:8123', 'http://100.100.100.100:8123', 'http://100.127.255.255', 'http://[::ffff:100.101.102.103]']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), true, adres);
    assert.equal(anahtarIcinGuvenliAdresMi(adres), true, adres);
  }
  for (const adres of ['http://100.63.255.255', 'http://100.128.0.1', 'http://100.0.0.1', 'http://100.255.0.1', 'http://101.64.0.1', 'http://99.64.0.1', 'http://ev.tail1234.ts.net', 'http://[::ffff:100.128.0.1]']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), false, adres);
    assert.equal(anahtarIcinGuvenliAdresMi(adres), false, adres);
  }
  assert.equal(anahtarIcinGuvenliAdresMi('https://ev.tail1234.ts.net'), true, 'https her zaman (değişmedi)');
});

test('ozelAgAdiMi: URL ayrıştırıcının normalleştirdiği IPv4 biçimleri de aynı kurala girer', () => {
  assert.equal(ozelAgAdiMi(anaBilgisayar('http://3232235777')), true); // 192.168.1.1
  assert.equal(ozelAgAdiMi(anaBilgisayar('http://0300.0250.0.1')), true);
  assert.equal(ozelAgAdiMi(anaBilgisayar('http://134744072')), false); // 8.8.8.8
});

test('ozelAgAdiMi: IPv6 loopback, fe80::/10, fc00::/7 ve IPv4-eşlemeli adresler', () => {
  for (const adres of ['http://[::1]:8123', 'http://[fe80::1]', 'http://[febf::1]', 'http://[fd00::5]', 'http://[fc00::1]', 'http://[::ffff:192.168.1.1]']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), true, adres);
  }
  for (const adres of ['http://[2001:db8::1]', 'http://[fec0::1]', 'http://[fe00::1]', 'http://[::ffff:8.8.8.8]', 'http://[::2]', 'http://[2606:4700::1111]']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), false, adres);
  }
});

test('ozelAgAdiMi: yerel ad uzantıları ve tek etiketli adlar; internet adları değil', () => {
  for (const adres of ['http://localhost:8123', 'http://ha.local', 'http://ha.local.', 'http://HA.LAN:8123', 'http://x.home.arpa', 'http://a.localhost', 'http://homeassistant:8123']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), true, adres);
  }
  for (const adres of ['http://ha.example.com', 'http://evlocal.com', 'http://example.lan.com', 'http://ha.local.example.org', 'http://nip.io']) {
    assert.equal(ozelAgAdiMi(anaBilgisayar(adres)), false, adres);
  }
  for (const kotu of ['', null, undefined, 42, '.']) assert.equal(ozelAgAdiMi(kotu), false, String(kotu));
});

test('anahtarIcinGuvenliAdresMi: https her zaman, http yalnız ev ağında; geçersiz adres güvensiz', () => {
  assert.equal(anahtarIcinGuvenliAdresMi('https://ha.example.com'), true);
  assert.equal(anahtarIcinGuvenliAdresMi('https://192.168.1.10:8123'), true);
  assert.equal(anahtarIcinGuvenliAdresMi('http://192.168.1.10:8123'), true);
  assert.equal(anahtarIcinGuvenliAdresMi('http://ha.local:8123'), true);
  assert.equal(anahtarIcinGuvenliAdresMi('http://ha.example.com'), false);
  assert.equal(anahtarIcinGuvenliAdresMi('http://8.8.8.8:8123'), false);
  for (const kotu of ['ftp://192.168.1.1', 'bozuk', '', null, undefined]) assert.equal(anahtarIcinGuvenliAdresMi(kotu), false, String(kotu));
});
