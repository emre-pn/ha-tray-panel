'use strict';

/**
 * Ayarlar sayfası "Bilgi kartları ve sensörler" bölümünün eksik grubu alanları: havaTahmini (hava tahmini şeridi). Sahte DOM ve
 * sahte ana süreç köprüsü (test/ayarlar-sahte.js); gerçek pencere ve Home Assistant YOK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { HTML, AYAR, CIHAZLAR, akit, duzles, acilmisSayfa } = require('./ayarlar-sahte');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';

test('hava tahmini: HTML seçeneği etiketli, üç değer, ipucuna bağlı', () => {
  assert.match(HTML, /<label for="havaTahmini" data-i18n="ayar\.bilgi\.tahmin\.etiket">/);
  const secim = /<select id="havaTahmini"[^>]*>([\s\S]*?)<\/select>/.exec(HTML);
  assert.ok(secim);
  assert.deepEqual([...secim[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]), ['gunluk', 'saatlik', 'kapali']);
  assert.match(HTML, /<select id="havaTahmini"[^>]*aria-describedby="havaTahminiIpucu"/);
  assert.match(HTML, /id="havaTahminiIpucu"/);
});

test('hava tahmini: ayar özetinde yoksa "gunluk" gösterilir, kirli sayılmaz, kayıt yükü değeri taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('havaTahmini').value, 'gunluk');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).havaTahmini, 'gunluk');
});

test('hava tahmini: kayıtlı değer alana yazılır; değişiklik kirli yapar, geri alınca temizler; kayıt yeni değeri gönderir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, havaTahmini: 'saatlik' }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('havaTahmini').value, 'saatlik');
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('havaTahmini').value = 'kapali';
  sayfa.oge('havaTahmini').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('havaTahmini').value = 'saatlik';
  sayfa.oge('havaTahmini').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('havaTahmini').value = 'kapali';
  sayfa.oge('havaTahmini').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).havaTahmini, 'kapali');
  assert.equal(kirliMi(sayfa), false);
});

test('hava tahmini: sunucudaki bozuk değer sayfada "gunluk" olarak görünür', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, havaTahmini: 'haftalik' }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('havaTahmini').value, 'gunluk');
});
