'use strict';

/**
 * Karo görünümü (src/lib/karo-gorunum.js, o-31): simge / renk / boyut doğrulaması. Bu dosya favori kaydının, ana süreç modelinin ve
 * iki renderer sayfasının ortak doğrulayıcısıdır; kapı / kilit temalı simge hiçbir yoldan karoya giremez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/lib/karo-gorunum');

test('simgeCoz: çizgi ikon, tek emoji, boş; geçersiz ve çoklu metin null', () => {
  assert.equal(G.simgeCoz('ikon:isik').tur, 'ikon');
  assert.equal(G.simgeCoz('ikon:isik').yol, G.IKONLAR.isik);
  assert.deepEqual(G.simgeCoz('💡'), { tur: 'emoji', metin: '💡' });
  assert.deepEqual(G.simgeCoz('1️⃣'), { tur: 'emoji', metin: '1️⃣' });
  assert.deepEqual(G.simgeCoz('🇹🇷'), { tur: 'emoji', metin: '🇹🇷' });
  assert.deepEqual(G.simgeCoz('👨‍👩‍👧'), { tur: 'emoji', metin: '👨‍👩‍👧' });
  for (const kotu of ['', '   ', 'abc', 'a💡', '💡💡', 'ikon:yok', 'ikon:', 'ikon:__proto__', 'ikon:constructor', '<svg>', 'x'.repeat(40), null, undefined, 5, {}, []]) {
    assert.equal(G.simgeCoz(kotu), null, `${JSON.stringify(kotu)} simge olamaz`);
  }
});

test('KAPI KURALI: kapı, kilit, anahtar, siren, bariyer ve pencere emojileri simge olamaz', () => {
  for (const yasak of ['🚪', '🔒', '🔓', '🔐', '🔏', '🔑', '🗝️', '🚨', '🚧', '🪟', '⛩️']) {
    assert.equal(G.simgeCoz(yasak), null, `${yasak} simge olamaz`);
    assert.equal(G.simgeDuzelt(yasak), null);
  }
  // tek başına yasak olmayan, ama ZWJ dizisiyle yasak emoji taşıyan metin de reddedilir
  assert.equal(G.simgeCoz('👨‍🔑'), null);
  for (const iyi of ['💡', '🛋️', '🎬', '☀️', '⭐', '🌡️', '🔥']) assert.ok(G.simgeCoz(iyi), `${iyi} serbest`);
});

test('çizgi ikon seti: her yol yalnız güvenli SVG yol komutları ve sayılardır (betik / özellik enjeksiyonu yok)', () => {
  assert.ok(G.IKON_ADLARI.length >= 10);
  for (const ad of G.IKON_ADLARI) {
    assert.match(G.IKONLAR[ad], /^[MmLlHhVvCcSsAaZz0-9 .,\-]+$/, `${ad}: yol verisi`);
    assert.doesNotMatch(ad, /kapi|door|kilit|lock|alarm|garaj|garage|bariyer|gate|siren|cover|window|pencere/i, `${ad}: kapı kuralı sözcüğü yok`);
  }
  assert.ok(Object.isFrozen(G.IKONLAR));
});

test('simgeDuzelt: kayda yazılacak biçim (boş = temizle, geçersiz = null)', () => {
  assert.equal(G.simgeDuzelt(''), '');
  assert.equal(G.simgeDuzelt('  '), '');
  assert.equal(G.simgeDuzelt(' ikon:ev '), 'ikon:ev');
  assert.equal(G.simgeDuzelt(' 💡 '), '💡');
  assert.equal(G.simgeDuzelt('abc'), null);
  assert.equal(G.simgeDuzelt(3), null);
});

test('renkDuzelt ve boyutDuzelt: yalnız hazır değerler; serbest renk metni ya da CSS kabul edilmez', () => {
  assert.equal(G.renkDuzelt(''), '');
  assert.equal(G.renkDuzelt('mavi'), 'mavi');
  assert.equal(G.renkDuzelt(' yesil '), 'yesil');
  for (const kotu of ['#ff0000', 'red', 'rgb(1,2,3)', 'mavi;background:url(x)', 'MAVI', null, 3]) assert.equal(G.renkDuzelt(kotu), null, JSON.stringify(kotu));
  assert.equal(G.boyutDuzelt(''), 'normal');
  assert.equal(G.boyutDuzelt('normal'), 'normal');
  for (const iyi of ['kucuk', 'genis', 'buyuk']) assert.equal(G.boyutDuzelt(iyi), iyi);
  for (const kotu of ['dev', 'span 9', null, 4]) assert.equal(G.boyutDuzelt(kotu), null);
  assert.deepEqual(G.BOYUT_SUTUNU, { kucuk: 1, normal: 1, genis: 2, buyuk: 3 });
});

test('renderer kopyası: dosya require kullanmaz ve window.EvKaroGorunum olarak aynı değerleri verir', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'karo-gorunum.js'), 'utf8');
  assert.doesNotMatch(kaynak, /require\s*\(/);
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(kaynak, sandbox);
  assert.ok(sandbox.EvKaroGorunum);
  assert.equal(JSON.stringify(sandbox.EvKaroGorunum.simgeCoz('ikon:ev')), JSON.stringify(G.simgeCoz('ikon:ev')));
  assert.equal(sandbox.EvKaroGorunum.simgeCoz('🔒'), null);
});
