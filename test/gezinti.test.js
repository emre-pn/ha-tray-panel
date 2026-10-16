'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { yolGecerliMi, sayfaYolu, gizliKalmaAsildiMi, gecmisOffseti } = require('../src/lib/gezinti');

test('yolGecerliMi: geçerli yollar', () => {
  for (const yol of ['/', '/lovelace/ev', '/dashboard-pc/0#kart', '/lovelace/0', '/config/dashboard', '/a_b-c/d1']) {
    assert.ok(yolGecerliMi(yol), yol);
  }
});

test('yolGecerliMi (k-18): ? ile sorgu dizgesi kabul edilir; sorgu ve parça birlikte olabilir', () => {
  for (const yol of ['/lovelace/ev?x=1', '/lovelace/0?area=oturma_odasi&filtre=a.b', '/history?entity_id=light.salon&start_date=2026-10-15', '/map?x=1#kart', '/logbook?ara=%C4%B1%C5%9F%C4%B1k', '/x?a=1,2+3']) {
    assert.ok(yolGecerliMi(yol), yol);
  }
});

test('yolGecerliMi (k-18): sorgu şema, host, yol kaçışı ya da yasak yol açmaz', () => {
  for (const yol of [
    '/x?', // boş sorgu
    '/x?u=http://evil.com', // ":" ve "/" sorguda yok
    '/x?u=//evil.com',
    '/x?u=../a',
    '/x?a=b?c=d#y', // ikinci "?" sorguda yok (yol deseni "?" ile bir kez ayrılır)
    '/x?a b',
    '/x?a=1\\2',
    '/x?a=<b>',
    '/x?a=1#',
    '?x=1', // kök "/" ile başlamalı
    '/a.b?x=1', // yolda "." hâlâ yok
    '/api?x=1', // yasak önekler sorguyla da yasak
    '/api/x?y=1',
    '/auth?x=1',
    '/auth/authorize?client_id=1',
    '/local?x=1',
    '/hacsfiles?x=1',
    '/API?x=1',
    `/x?${'a'.repeat(121)}`,
  ]) {
    assert.ok(!yolGecerliMi(yol), yol);
  }
  assert.ok(yolGecerliMi(`/x?${'a'.repeat(120)}`));
  // Benzer ad sorguyla da geçerli kalır (tam bölüm eşleşmesi).
  assert.ok(yolGecerliMi('/apiary?x=1'));
});

test('sayfaYolu (k-18): ayardaki köken için yol + sorgu + parça döner; başka köken, geçersiz adres ve yasak yol null', () => {
  const koken = 'https://ha.example.com';
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev', koken), '/lovelace/ev');
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev?x=1#kart', koken), '/lovelace/ev?x=1#kart');
  assert.equal(sayfaYolu('https://ha.example.com/', koken), '/');
  assert.equal(sayfaYolu('https://ha.example.com', koken), '/');
  assert.equal(sayfaYolu('http://192.168.1.10:8123/energy?period=week', 'http://192.168.1.10:8123'), '/energy?period=week');
  assert.equal(sayfaYolu('https://baska.example.com/lovelace/ev', koken), null, 'başka köken');
  assert.equal(sayfaYolu('http://ha.example.com/lovelace/ev', koken), null, 'şema farklı');
  assert.equal(sayfaYolu('file:///C:/app/offline.html?durum=baglaniyor', koken), null);
  assert.equal(sayfaYolu('https://ha.example.com/api/states', koken), null, 'yasak yol');
  assert.equal(sayfaYolu('https://ha.example.com/auth/authorize?x=1', koken), null);
  assert.equal(sayfaYolu('bozuk adres', koken), null);
  assert.equal(sayfaYolu(null, koken), null);
  assert.equal(sayfaYolu('https://ha.example.com/x', ''), null);
  assert.equal(sayfaYolu('https://ha.example.com/x', undefined), null);
});

test('sayfaYolu (k-18): geçersiz parça ya da sorgu atılır, sayfa yolu korunur', () => {
  const koken = 'https://ha.example.com';
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev?x=1#a/b', koken), '/lovelace/ev?x=1', 'parça geçersizse atılır');
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev?x=%7Bsay%7D', koken), '/lovelace/ev?x=%7Bsay%7D', 'yüzde kodlu sorgu geçerli');
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev?x=a:b#kart', koken), '/lovelace/ev#kart', 'sorgu geçersizse (":") atılır, parça kalır');
  assert.equal(sayfaYolu('https://ha.example.com/lovelace/ev?x=a:b', koken), '/lovelace/ev');
  assert.equal(sayfaYolu('https://ha.example.com/config/hacs.xyz', koken), null, 'yolda "." olan sayfa pano yapılamaz');
  // Dönen her değer yolGecerliMi'den geçer.
  for (const url of ['https://ha.example.com/a?b=c#d', 'https://ha.example.com/a?b=c:d#e', 'https://ha.example.com/']) {
    const yol = sayfaYolu(url, koken);
    assert.ok(yol === null || yolGecerliMi(yol), url);
  }
});

test('yolGecerliMi: geçersiz yollar', () => {
  for (const yol of ['//evil.com', '/api/x', '/a/../b', 'http://x', '', 'lovelace', '/x y', '/a.b', '/..', '/%2e%2e/x', null, undefined, 42, {}]) {
    assert.ok(!yolGecerliMi(yol), String(yol));
  }
});

test('yolGecerliMi: çok uzun yol ve parça reddedilir', () => {
  assert.ok(!yolGecerliMi(`/${'a'.repeat(200)}`));
  assert.ok(yolGecerliMi(`/${'a'.repeat(120)}`));
  assert.ok(!yolGecerliMi(`/${'a'.repeat(121)}`));
  assert.ok(!yolGecerliMi(`/x#${'b'.repeat(81)}`));
  assert.ok(!yolGecerliMi('/x#'));
});

test('yolGecerliMi: HA\u2019nın API/kimlik/özel dosya yolları pano değildir', () => {
  for (const yol of ['/api', '/api/', '/api/states', '/auth', '/auth/authorize', '/local/x', '/hacsfiles/y', '/API/x', '/api#x']) {
    assert.ok(!yolGecerliMi(yol), yol);
  }
  // Önek değil tam bölüm eşleşmesi: benzer adlar geçerli
  assert.ok(yolGecerliMi('/apiary'));
  assert.ok(yolGecerliMi('/authors/ev'));
  assert.ok(yolGecerliMi('/localhost'));
});

test('gizliKalmaAsildiMi: sınırlar ve 0 = kapalı', () => {
  const dk = 60_000;
  const simdi = 1_000_000_000;
  assert.equal(gizliKalmaAsildiMi(simdi - 5 * dk - 1, simdi, 5), true);
  assert.equal(gizliKalmaAsildiMi(simdi - 5 * dk, simdi, 5), false); // tam sınır: aşılmadı
  assert.equal(gizliKalmaAsildiMi(simdi - 4 * dk, simdi, 5), false);
  assert.equal(gizliKalmaAsildiMi(simdi - 100 * dk, simdi, 0), false); // 0 = hiç
  assert.equal(gizliKalmaAsildiMi(simdi - 100 * dk, simdi, -1), false);
  assert.equal(gizliKalmaAsildiMi(0, simdi, 5), false); // hiç gizlenmedi
  assert.equal(gizliKalmaAsildiMi(null, simdi, 5), false);
  assert.equal(gizliKalmaAsildiMi(simdi - 100 * dk, simdi, NaN), false);
  assert.equal(gizliKalmaAsildiMi(simdi - 1441 * dk, simdi, 1440), true);
});

test('gecmisOffseti: file: durum sayfaları atlanır', () => {
  const ha = (n) => `https://ha.example.com/lovelace/${n}`;
  const durum = 'file:///C:/app/offline.html?durum=baglaniyor';
  // [durum, ha0, ha1] aktif 2: geri -> ha0 (1 geri)
  assert.equal(gecmisOffseti([durum, ha(0), ha(1)], 2, -1), -1);
  // [durum, ha0] aktif 1: geri -> yalnız durum sayfası var: gidilmez
  assert.equal(gecmisOffseti([durum, ha(0)], 1, -1), null);
  // [ha0, durum, ha1] aktif 2: geri -> durum atlanır, ha0'a 2 geri
  assert.equal(gecmisOffseti([ha(0), durum, ha(1)], 2, -1), -2);
  // ileri
  assert.equal(gecmisOffseti([ha(0), ha(1), ha(2)], 0, 1), 1);
  assert.equal(gecmisOffseti([ha(0), durum, ha(2)], 0, 1), 2);
  assert.equal(gecmisOffseti([ha(0), ha(1)], 1, 1), null);
  assert.equal(gecmisOffseti([ha(0)], 0, -1), null);
});

test('gecmisOffseti: geçersiz girdiler null döner', () => {
  assert.equal(gecmisOffseti(null, 0, -1), null);
  assert.equal(gecmisOffseti(['a'], 'x', -1), null);
  assert.equal(gecmisOffseti(['a', 'b'], 1, 0), null);
  assert.equal(gecmisOffseti(['a', 'b'], 1, 2), null);
  assert.equal(gecmisOffseti([null, 'b'], 1, -1), null);
});
