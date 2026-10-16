'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { kisici, tekrarlayici, basiliTutma, KISMA_MS, BASILI_TUTMA_MS } = require('../src/lib/kaydirici');

/** Elle ilerletilen sahte saat: setTimeout/clearTimeout/simdi. */
function sahteZaman() {
  let t = 1000;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    simdi: () => t,
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    ilerle(ms) {
      const hedef = t + ms;
      for (;;) {
        const siradaki = [...bekleyenler.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, b) => a[1].bitis - b[1].bitis)[0];
        if (!siradaki) break;
        t = siradaki[1].bitis;
        bekleyenler.delete(siradaki[0]);
        siradaki[1].fn();
      }
      t = hedef;
    },
    bekleyen: () => bekleyenler.size,
  };
}

test('kisici: sürüklerken 200 ms içinde en çok 1 çağrı (ilk hemen, sonuncusu pencere sonunda); sürükleme başına ~5 çağrı/sn', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d, son) => cagrilar.push([d, son]), { zaman });
  for (let i = 1; i <= 50; i += 1) {
    k.cagir(i); // her 20 ms'de bir değişim: 1 sn boyunca 50 olay
    zaman.ilerle(20);
  }
  assert.ok(cagrilar.length <= 6, `1 sn'de en çok ~5 çağrı olmalı: ${cagrilar.length}`);
  assert.ok(cagrilar.length >= 4);
  assert.deepEqual(cagrilar[0], [1, false], 'ilk değer hemen gider');
  assert.ok(cagrilar.every(([, son]) => son === false));
  assert.ok(cagrilar.every(([d], i) => i === 0 || d > cagrilar[i - 1][0]), 'değerler sırayla artar');
});

test('kisici: bırakınca son değer HER ZAMAN ve beklemeden gönderilir; bekleyen ara değer atılır', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d, son) => cagrilar.push([d, son]), { zaman });
  k.cagir(10); // hemen
  zaman.ilerle(50);
  k.cagir(20); // bekleyen
  k.cagir(30); // bekleyenin yerine
  k.son(40);
  assert.deepEqual(cagrilar, [[10, false], [40, true]]);
  assert.equal(zaman.bekleyen(), 0, 'zamanlayıcı kalmaz');
  zaman.ilerle(1000);
  assert.equal(cagrilar.length, 2, 'bırakmadan sonra ek çağrı yok');
});

test('kisici: tek bir çağrı hemen gider; pencere dışı sonraki çağrı yine hemen gider; aralıklı son() çağrıları hep beklemeden gider', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d, son) => cagrilar.push([d, son]), { zaman });
  k.cagir(1);
  zaman.ilerle(KISMA_MS + 1);
  k.cagir(2);
  assert.deepEqual(cagrilar, [[1, false], [2, false]]);
  k.son(3);
  zaman.ilerle(KISMA_MS + 1);
  k.son(4);
  assert.deepEqual(cagrilar.filter(([, s]) => s), [[3, true], [4, true]]);
});

test('kisici: 200 ms içinde ardışık son() (ok tuşu basılı tutulan kaydırıcı) tek gönderimde birleşir; en SON değer mutlaka gider, eski değer yenisini ezmez', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d, son) => cagrilar.push([d, son]), { zaman });
  // ok tuşu basılı: her ~33 ms'de input (cagir) + change (son); 1 sn boyunca 30 adım
  for (let i = 1; i <= 30; i += 1) {
    k.cagir(i);
    k.son(i);
    zaman.ilerle(33);
  }
  zaman.ilerle(KISMA_MS + 1);
  const gidenler = cagrilar.filter(([, s]) => s);
  assert.ok(gidenler.length <= 6, `1 sn'de en çok ~5 son gönderim olmalı: ${gidenler.length}`);
  assert.deepEqual(cagrilar.at(-1), [30, true], 'son gönderim en güncel değerle');
  assert.ok(gidenler.every(([d], i) => i === 0 || d > gidenler[i - 1][0]), 'değerler sırayla artar, geri dönmez');
  assert.equal(zaman.bekleyen(), 0, 'zamanlayıcı kalmaz');
});

test('kisici: bekleyen "son" varken gelen ara değer onun değerini günceller; iptal bekleyen son gönderimi de atar', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d, son) => cagrilar.push([d, son]), { zaman });
  k.son(10); // hemen
  k.son(20); // 200 ms içinde: bekler
  k.cagir(25); // bekleyen son artık 25'i taşır
  assert.deepEqual(cagrilar, [[10, true]]);
  zaman.ilerle(KISMA_MS + 1);
  assert.deepEqual(cagrilar, [[10, true], [25, true]]);
  k.son(30);
  k.son(40);
  k.iptal();
  zaman.ilerle(1000);
  assert.deepEqual(cagrilar, [[10, true], [25, true]], 'iptal edilen bekleyen son (30/40) gönderilmez');
});

test('kisici: iptal bekleyen çağrıyı atar', () => {
  const zaman = sahteZaman();
  const cagrilar = [];
  const k = kisici((d) => cagrilar.push(d), { zaman });
  k.cagir(1);
  k.cagir(2);
  k.iptal();
  zaman.ilerle(1000);
  assert.deepEqual(cagrilar, [1]);
});

test('tekrarlayici: ilk basış hemen, 400 ms sonra 250 ms aralıkla (~4/sn); dur() keser', () => {
  const zaman = sahteZaman();
  let n = 0;
  const t = tekrarlayici(() => (n += 1), { zaman });
  t.basla();
  assert.equal(n, 1);
  zaman.ilerle(399);
  assert.equal(n, 1);
  zaman.ilerle(1);
  assert.equal(n, 2);
  zaman.ilerle(250);
  assert.equal(n, 3);
  zaman.ilerle(1000);
  assert.equal(n, 7, "1 sn'de 4 basış");
  t.dur();
  zaman.ilerle(5000);
  assert.equal(n, 7);
  assert.equal(zaman.bekleyen(), 0);
  t.basla();
  assert.equal(n, 8, 'yeniden başlatılabilir');
  t.basla(); // zaten çalışıyor: ikinci kez sayılmaz
  assert.equal(n, 8);
  t.dur();
});

test('basiliTutma: süre dolunca bir kez tamam; önce bırakılırsa iptal; tamamlanınca bırakma etkisiz', () => {
  const zaman = sahteZaman();
  const olaylar = [];
  const b = basiliTutma({ tamam: () => olaylar.push('tamam'), basladi: () => olaylar.push('basladi'), iptal: () => olaylar.push('iptal'), zaman });
  assert.equal(BASILI_TUTMA_MS, 800);
  assert.equal(b.basla(), true);
  assert.equal(b.basla(), false, 'zaten basılı');
  zaman.ilerle(799);
  b.birak();
  assert.deepEqual(olaylar, ['basladi', 'iptal']);
  zaman.ilerle(5000);
  assert.deepEqual(olaylar, ['basladi', 'iptal'], 'iptal sonrası tamam gelmez');

  olaylar.length = 0;
  b.basla();
  zaman.ilerle(800);
  assert.deepEqual(olaylar, ['basladi', 'tamam']);
  b.birak();
  assert.deepEqual(olaylar, ['basladi', 'tamam'], 'tamamlandıktan sonra bırakma iptal sayılmaz');
  assert.equal(b.tutuyorMu(), false);
  b.basla();
  b.birak();
  assert.equal(olaylar.at(-1), 'iptal');
});

test("kaydirici modülü require kullanmaz (renderer'da <script> ile de yüklenir)", () => {
  const kaynak = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'kaydirici.js'), 'utf8');
  assert.ok(!/require\s*\(/.test(kaynak));
});
