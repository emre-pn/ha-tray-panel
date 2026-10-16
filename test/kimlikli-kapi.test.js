'use strict';

/**
 * Kimlikli işlem kapısı (1.1.1, tur 3 K1): aynı anda EN ÇOK 1 kimlikli işlem; sıra korunur; kapı her durumda bırakılır
 * (asılı kalan kapı = uygulama donar). Saf modül: gerçek zamanlayıcı yok, sahte zaman kullanılır.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kapiOlustur, KAPI_TAVAN_MS } = require('../src/lib/kimlikli-kapi');

function sahteZaman() {
  let t = 0;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout: (id) => bekleyenler.delete(id),
    ilerle(ms) {
      t += ms;
      for (const [id, v] of [...bekleyenler]) {
        if (v.bitis <= t) {
          bekleyenler.delete(id);
          v.fn();
        }
      }
    },
    sayi: () => bekleyenler.size,
  };
}

const akit = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
};

test('kapı: aynı anda en çok 1 işlem; bekleyenler SIRAYLA (FIFO) girer', async () => {
  const kapi = kapiOlustur({ zaman: sahteZaman() });
  const sira = [];
  const birakmalar = [];
  const isler = [1, 2, 3].map((n) =>
    kapi.al().then((birak) => {
      sira.push(n);
      birakmalar.push(birak);
    }),
  );
  await akit();
  assert.deepEqual(sira, [1], 'yalnız ilki içeride');
  assert.deepEqual(kapi.durum(), { yolda: true, bekleyen: 2 });
  birakmalar[0]();
  await akit();
  assert.deepEqual(sira, [1, 2]);
  birakmalar[1]();
  await akit();
  birakmalar[2]();
  await Promise.all(isler);
  assert.deepEqual(sira, [1, 2, 3]);
  assert.deepEqual(kapi.durum(), { yolda: false, bekleyen: 0 });
});

test('kapı: bırakma işlevi ikinci kez çağrılsa sıradakini ERKEN içeri almaz', async () => {
  const kapi = kapiOlustur({ zaman: sahteZaman() });
  const birak1 = await kapi.al();
  const sira = [];
  const p2 = kapi.al().then((b) => {
    sira.push(2);
    return b;
  });
  const p3 = kapi.al().then((b) => {
    sira.push(3);
    return b;
  });
  birak1();
  birak1(); // yinelenen bırakma
  await akit();
  assert.deepEqual(sira, [2], 'ikinci bırakma üçüncüyü içeri sokmadı');
  (await p2)();
  await akit();
  assert.deepEqual(sira, [2, 3]);
  (await p3)();
});

test('kapı: bırakılmayan kapı bekçi süresi dolunca ZORLA bırakılır (kilitlenme yok); geç gelen bırakma yeni sahibi etkilemez', async () => {
  const zaman = sahteZaman();
  const uyarilar = [];
  const kapi = kapiOlustur({ zaman, zorlaBirakildi: () => uyarilar.push('zorla') });
  const asili = await kapi.al(); // asla bırakılmıyor
  let ikinciIcerde = false;
  const p2 = kapi.al().then((b) => {
    ikinciIcerde = true;
    return b;
  });
  await akit();
  assert.equal(ikinciIcerde, false);
  zaman.ilerle(KAPI_TAVAN_MS);
  const birak2 = await p2;
  assert.equal(ikinciIcerde, true);
  assert.deepEqual(uyarilar, ['zorla']);
  let ucuncuIcerde = false;
  const p3 = kapi.al().then((b) => {
    ucuncuIcerde = true;
    return b;
  });
  asili(); // eski sahibin GEÇ bırakması: ikinci sahibin hakkını bırakmamalı
  await akit();
  assert.equal(ucuncuIcerde, false, 'geç bırakma kapıyı açmadı');
  birak2();
  (await p3)();
});

test('kapı: normal bırakmada bekçi zamanlayıcısı temizlenir (zamanlayıcı sızıntısı yok)', async () => {
  const zaman = sahteZaman();
  const kapi = kapiOlustur({ zaman });
  const birak = await kapi.al();
  assert.equal(zaman.sayi(), 1);
  birak();
  assert.equal(zaman.sayi(), 0);
});

test('(tur4-O4) kapı: yüksek öncelikli işlem (eylem POST, WS auth, doğrulama) bekleyen normal işlemlerin ÖNÜNE geçer; sınır yine 1, her sınıfta sıra FIFO', async () => {
  const kapi = kapiOlustur({ zaman: sahteZaman() });
  const sira = [];
  const birinci = await kapi.al(); // yolda
  const gir = (ad, oncelik) =>
    kapi.al({ oncelik }).then((birak) => {
      sira.push(ad);
      assert.equal(kapi.durum().yolda, true);
      birak();
    });
  const bekleyenler = [gir('n1', 'normal'), gir('n2', 'normal'), gir('y1', 'yuksek'), gir('n3'), gir('y2', 'yuksek')];
  await akit();
  assert.deepEqual(sira, [], 'kapı dolu: kimse girmedi');
  assert.equal(kapi.durum().bekleyen, 5);
  birinci();
  await Promise.all(bekleyenler);
  assert.deepEqual(sira, ['y1', 'y2', 'n1', 'n2', 'n3']);
  assert.deepEqual(kapi.durum(), { yolda: false, bekleyen: 0 });
});
