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

// --- Fare tekerleği (1.4.0, o-20) -----------------------------------------------------------------------------------------

const { tekerlekCentigi, tekerlekKapisi, tekerlekDegeri, TEKERLEK_ADIMI, TEKERLEK_BOS_MS, TEKERLEK_BITIS_MS } = require('../src/lib/kaydirici');

test('tekerlek çentiği: piksel 100, satır 3, sayfa 1; geçersiz değer 0', () => {
  assert.equal(TEKERLEK_ADIMI, 5);
  assert.equal(tekerlekCentigi(100, 0), 1);
  assert.equal(tekerlekCentigi(-100, 0), -1);
  assert.equal(tekerlekCentigi(3, 1), 1);
  assert.equal(tekerlekCentigi(1, 2), 1);
  assert.equal(tekerlekCentigi(25, 0), 0.25);
  for (const gecersiz of ['x', NaN, Infinity, null, undefined, {}]) assert.equal(tekerlekCentigi(gecersiz, 0), 0, String(gecersiz));
});

test('tekerlek değeri: ±5, [en az, en çok] içinde; bilinmeyen değer ya da kesirli adım null', () => {
  assert.equal(tekerlekDegeri(50, 1, 1, 100), 55);
  assert.equal(tekerlekDegeri(50, -2, 1, 100), 40);
  assert.equal(tekerlekDegeri(98, 1, 1, 100), 100, 'üst sınırda kırpılır');
  assert.equal(tekerlekDegeri(3, -1, 1, 100), 1, 'alt sınırda kırpılır (ışık 0 olmaz: kapatmak tekerleğin işi değil)');
  for (const mevcut of [null, undefined, 'x', NaN, Infinity]) assert.equal(tekerlekDegeri(mevcut, 1, 0, 100), null, String(mevcut));
  assert.equal(tekerlekDegeri(50, 0.5, 0, 100), null);
  assert.equal(tekerlekDegeri(50, NaN, 0, 100), null);
});

test('tekerlek kapısı: boşta ve izinliyse dizi başlar; yukarı (deltaY < 0) artırır, aşağı azaltır', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  const sahip = {};
  assert.deepEqual(kapi.dene(sahip, -100, 0, true), { ele: true, adim: 1 });
  zaman.ilerle(50);
  assert.deepEqual(kapi.dene(sahip, -100, 0, true), { ele: true, adim: 1 });
  zaman.ilerle(50);
  assert.deepEqual(kapi.dene(sahip, 100, 0, true), { ele: true, adim: -1 });
});

test('tekerlek kapısı: izin yoksa (kaydırılabilir panelde kaydırıcı dışı) olay ele alınmaz ve sayfa kayar', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  assert.deepEqual(kapi.dene({}, -100, 0, false), { ele: false, adim: 0 });
  assert.deepEqual(kapi.dene({}, -100, 0, undefined), { ele: false, adim: 0 }, 'izinli yalnız true olabilir');
});

test('tekerlek kapısı: kaydırma sürerken (400 ms dolmadan) bir karo dizi BAŞLATAMAZ; sayfa kaydırmaya devam eder', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  const karo = {};
  for (let i = 0; i < 6; i += 1) {
    assert.deepEqual(kapi.dene(null, 100, 0, false), { ele: false, adim: 0 }, 'sayfa kaydırılıyor');
    zaman.ilerle(100);
  }
  assert.deepEqual(kapi.dene(karo, 100, 0, true), { ele: false, adim: 0 }, 'fare karonun üstünden geçti ama kaydırma henüz durmadı');
  zaman.ilerle(TEKERLEK_BOS_MS - 1);
  assert.deepEqual(kapi.dene(karo, 100, 0, true), { ele: false, adim: 0 }, 'önceki olaydan beri 400 ms dolmadı');
  zaman.ilerle(TEKERLEK_BOS_MS);
  assert.deepEqual(kapi.dene(karo, 100, 0, true), { ele: true, adim: -1 }, 'boşta: dizi başlar');
});

test('tekerlek kapısı: dizi başladığı karoda kalır; başka karo devralamaz, boşta kalınca yeni dizi başlatabilir', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  const a = {};
  const b = {};
  assert.equal(kapi.dene(a, -100, 0, true).ele, true);
  zaman.ilerle(100);
  assert.equal(kapi.dene(b, -100, 0, true).ele, false, 'dizi a karosundayken b karosu işlemez');
  zaman.ilerle(100);
  assert.equal(kapi.dene(a, -100, 0, true).ele, false, 'b olayı diziyi bozdu: sayfa kaydırması varsayılır');
  zaman.ilerle(TEKERLEK_BOS_MS + 1);
  assert.equal(kapi.dene(b, -100, 0, true).ele, true, 'boşta sonra b karosu yeni dizi başlatır');
});

test('tekerlek kapısı: küçük (dokunmatik yüzey) olaylar birikir, tam çentikte adım üretir; büyük olay çok adım üretir', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  const s = {};
  const adimlar = [];
  for (let i = 0; i < 10; i += 1) {
    adimlar.push(kapi.dene(s, -25, 0, true).adim);
    zaman.ilerle(16);
  }
  assert.deepEqual(adimlar, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0], '10 x 0,25 çentik: her dördüncüde bir adım, 0,5 çentik birikmiş kalır');
  assert.deepEqual(kapi.dene(s, -300, 0, true), { ele: true, adim: 3 }, 'kalan 0,5 + 3 çentik = 3 tam adım');
});

test('tekerlek kapısı: sifirla sahibi ve birikimi unutur; son değer bekleme süresi yeni dizi bekleme süresinden kısadır', () => {
  const zaman = sahteZaman();
  const kapi = tekerlekKapisi({ zaman });
  const a = {};
  assert.deepEqual(kapi.dene(a, -50, 0, true), { ele: true, adim: 0 });
  kapi.sifirla();
  assert.deepEqual(kapi.dene(a, -50, 0, true), { ele: true, adim: 0 }, 'birikim sıfırlandı: yarım çentik yarım kaldı, yeni dizi başladı');
  assert.ok(TEKERLEK_BITIS_MS < TEKERLEK_BOS_MS, 'son değer gönderimi yeni dizi başlamadan önce olur');
});
