'use strict';

/**
 * Kozmetik efektler (src/lib/efekt.js, o-34): efekt seçimi, hareket kuralı, parçacık sınırları ve çizim. Canvas sahtedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/lib/efekt');
const { HAVA_DURUMLARI } = require('../src/lib/varlik-ozellik');

function rastgeleUret(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Çizim çağrılarını sayan sahte CanvasRenderingContext2D. */
function sahteBaglam() {
  const cagrilar = [];
  const kayit = (ad) => (...arg) => {
    cagrilar.push([ad, ...arg]);
  };
  const baglam = {
    cagrilar,
    stiller: [],
    clearRect: kayit('clearRect'),
    beginPath: kayit('beginPath'),
    moveTo: kayit('moveTo'),
    lineTo: kayit('lineTo'),
    stroke: kayit('stroke'),
    arc: kayit('arc'),
    fill: kayit('fill'),
    fillRect: kayit('fillRect'),
    ellipse: kayit('ellipse'),
    save: kayit('save'),
    restore: kayit('restore'),
    translate: kayit('translate'),
    rotate: kayit('rotate'),
    createRadialGradient: () => ({ addColorStop: kayit('addColorStop') }),
  };
  for (const ad of ['strokeStyle', 'fillStyle']) {
    Object.defineProperty(baglam, ad, {
      set(deger) {
        baglam.stiller.push([ad, deger]);
      },
    });
  }
  return baglam;
}

test('mevsimAdi: kuzey yarım küre takvimi; geçersiz ay null', () => {
  const beklenen = ['kis', 'kis', 'ilkbahar', 'ilkbahar', 'ilkbahar', 'yaz', 'yaz', 'yaz', 'sonbahar', 'sonbahar', 'sonbahar', 'kis'];
  beklenen.forEach((mevsim, ay) => assert.equal(E.mevsimAdi(ay), mevsim, `ay ${ay}`));
  for (const kotu of [-1, 12, 1.5, '3', null, undefined, NaN]) assert.equal(E.mevsimAdi(kotu), null, String(kotu));
});

test('efektSec: animasyon kapalıysa (null) ya da hareket azaltılmışsa hiçbir efekt seçilmez', () => {
  assert.equal(E.efektSec({ animasyon: null, havaDurumu: 'rainy', ay: 0 }), null);
  assert.equal(E.efektSec({}), null);
  assert.equal(E.efektSec(), null);
  assert.equal(E.efektSec({ animasyon: 'yagmur' }), null, 'nesne olmayan animasyon');
  for (const animasyon of [{ hava: 'yagmur', mevsim: 'kis' }, { hava: 'otomatik', mevsim: 'otomatik' }]) {
    assert.equal(E.efektSec({ animasyon, hareketAzalt: true, havaDurumu: 'rainy', ay: 6 }), null);
  }
});

test('efektSec: elle seçilen hava efekti öncelikli; otomatik hava durumu karosundan; sonra mevsim', () => {
  for (const hava of ['yagmur', 'kar', 'gunes', 'firtina']) assert.equal(E.efektSec({ animasyon: { hava, mevsim: 'yaz' }, havaDurumu: 'sunny', ay: 6 }), hava);
  const oto = { hava: 'otomatik', mevsim: 'yok' };
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'rainy' }), 'yagmur');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'pouring' }), 'yagmur');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'hail' }), 'yagmur');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'snowy' }), 'kar');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'snowy-rainy' }), 'kar');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'sunny' }), 'gunes');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'lightning' }), 'firtina');
  assert.equal(E.efektSec({ animasyon: oto, havaDurumu: 'lightning-rainy' }), 'firtina');
  for (const efektsiz of ['cloudy', 'fog', 'clear-night', 'windy', 'exceptional', 'partlycloudy', null, undefined, 5, '__proto__', 'constructor', 'toString']) {
    assert.equal(E.efektSec({ animasyon: oto, havaDurumu: efektsiz }), null, String(efektsiz));
  }
  // hava efekti "yok": hava kararı vermez, mevsime düşer
  assert.equal(E.efektSec({ animasyon: { hava: 'yok', mevsim: 'kis' }, havaDurumu: 'rainy' }), 'kar');
  // otomatik hava + durumsuz: mevsim efektine düşer
  assert.equal(E.efektSec({ animasyon: { hava: 'otomatik', mevsim: 'sonbahar' }, havaDurumu: 'cloudy' }), 'yaprak');
});

test('efektSec: mevsim efektleri (elle ve otomatik) ve geçersiz değerler', () => {
  const m = (mevsim, ay) => E.efektSec({ animasyon: { hava: 'yok', mevsim }, ay });
  assert.equal(m('ilkbahar'), 'cicek');
  assert.equal(m('yaz'), 'parilti');
  assert.equal(m('sonbahar'), 'yaprak');
  assert.equal(m('kis'), 'kar');
  assert.equal(m('otomatik', 0), 'kar');
  assert.equal(m('otomatik', 3), 'cicek');
  assert.equal(m('otomatik', 6), 'parilti');
  assert.equal(m('otomatik', 9), 'yaprak');
  assert.equal(m('otomatik', undefined), null, 'ay yoksa efekt yok');
  assert.equal(m('yok', 6), null);
  for (const kotu of ['__proto__', 'constructor', 'hasOwnProperty', 'bahar', '', null, 5]) assert.equal(m(kotu, 6), null, String(kotu));
});

test('HAVA_DURUMU_EFEKTI: yalnız çekirdeğin beyaz listeli hava durumlarını eşler', () => {
  for (const durum of Object.keys(E.HAVA_DURUMU_EFEKTI)) assert.ok(HAVA_DURUMLARI.includes(durum), `${durum} varlik-ozellik HAVA_DURUMLARI içinde`);
  for (const efekt of Object.values(E.HAVA_DURUMU_EFEKTI)) assert.ok(E.HAVA_EFEKTLERI.includes(efekt), efekt);
  assert.ok(Object.isFrozen(E.HAVA_DURUMU_EFEKTI) && Object.isFrozen(E.MEVSIM_EFEKTI) && Object.isFrozen(E.EFEKTLER));
});

test('havaDurumuBul: ilk hava karosunun beyaz listeli durumunu bulur; model bozuksa null', () => {
  const model = {
    gruplar: [
      { kod: 'isik', karolar: [{ alan: 'light', ozellik: { durum: 'on' } }] },
      { kod: 'bilgi', karolar: [{ alan: 'sensor', ozellik: { durum: 'x' } }, { alan: 'weather', ozellik: { durum: 'rainy' } }, { alan: 'weather', ozellik: { durum: 'sunny' } }] },
    ],
  };
  assert.equal(E.havaDurumuBul(model), 'rainy');
  assert.equal(E.havaDurumuBul({ gruplar: [{ karolar: [{ alan: 'weather', ozellik: {} }] }] }), null);
  assert.equal(E.havaDurumuBul({ gruplar: [{ karolar: [{ alan: 'weather' }] }] }), null);
  for (const kotu of [null, undefined, {}, { gruplar: 5 }, { gruplar: [null, { karolar: 'x' }, { karolar: [null, 5] }] }, 'x']) assert.equal(E.havaDurumuBul(kotu), null);
});

test('parcacikSayisi: pencere alanıyla orantılı, alt ve üst sınırlı; bilinmeyen tür 0', () => {
  const taban = E.parcacikSayisi('yagmur', 360, 420);
  assert.ok(taban >= 40 && taban <= E.EN_COK_PARCACIK);
  assert.ok(E.parcacikSayisi('yagmur', 10, 10) >= Math.round(taban * 0.6) - 1, 'alt sınır 0,6 kat');
  assert.ok(E.parcacikSayisi('yagmur', 100000, 100000) <= E.EN_COK_PARCACIK, 'üst sınır');
  assert.equal(E.parcacikSayisi('firtina', 100000, 100000) <= E.EN_COK_PARCACIK, true);
  assert.equal(E.parcacikSayisi('bilinmeyen', 360, 420), 0);
  assert.ok(E.parcacikSayisi('yagmur', 720, 840) > E.parcacikSayisi('yagmur', 360, 420));
});

test('olustur: her tür için parçacıklar pencere içinde başlar; bilinmeyen tür fırlatır', () => {
  const r = rastgeleUret(7);
  for (const tur of E.EFEKTLER) {
    const d = E.olustur(tur, 360, 420, r);
    assert.equal(d.tur, tur);
    assert.equal(d.parcaciklar.length, E.parcacikSayisi(tur, 360, 420));
    for (const p of d.parcaciklar) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${tur}: sonlu konum`);
      assert.ok(p.x >= 0 && p.x <= 360, `${tur}: x pencere içinde`);
      assert.ok(p.y >= 0 && p.y <= 420, `${tur}: y pencere içinde`);
    }
  }
  assert.throws(() => E.olustur('kasirga', 100, 100), /unknown kind/);
  assert.throws(() => E.olustur('__proto__', 100, 100), /unknown kind/);
  // sıfır/negatif boyut en az 1 piksele çekilir
  const kucuk = E.olustur('kar', 0, -5, r);
  assert.equal(kucuk.w, 1);
  assert.equal(kucuk.h, 1);
});

test('adim: parçacıklar düşer, ekrandan çıkan üstten yeniden doğar; uzun duraklama sıçratmaz; sayı hiç artmaz', () => {
  const r = rastgeleUret(11);
  for (const tur of E.EFEKTLER) {
    const d = E.olustur(tur, 360, 420, r);
    const sayi = d.parcaciklar.length;
    for (let i = 0; i < 600; i += 1) {
      E.adim(d, 33, r);
      for (const p of d.parcaciklar) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${tur}: sonlu`);
    }
    assert.equal(d.parcaciklar.length, sayi, `${tur}: parçacık sayısı sabit`);
    for (const p of d.parcaciklar) assert.ok(p.y >= -45 && p.y <= 420 + 25, `${tur}: y makul aralıkta (${p.y})`);
  }
  // 10 saniyelik tek adım, EN_COK_ADIM_MS'e kırpılır
  const d = E.olustur('yagmur', 360, 420, rastgeleUret(1));
  const once = d.t;
  E.adim(d, 10000, rastgeleUret(2));
  assert.ok(d.t - once <= E.EN_COK_ADIM_MS / 1000 + 1e-9);
  // bozuk dt
  E.adim(d, NaN, rastgeleUret(3));
  E.adim(d, -50, rastgeleUret(4));
  assert.ok(Number.isFinite(d.t));
});

test('fırtına şimşeği: en erken 7 sn sonra, nadir, yumuşak ve düşük parlaklıklı (saniyede 3 kez yanıp sönmenin çok altında)', () => {
  const r = rastgeleUret(5);
  const d = E.olustur('firtina', 360, 420, r);
  assert.ok(d.simsek.bekle >= E.SIMSEK_ARALIK_MS[0] && d.simsek.bekle <= E.SIMSEK_ARALIK_MS[1]);
  assert.equal(E.simsekAlfasi(d), 0, 'başta şimşek yok');
  let enCok = 0;
  let patlama = 0;
  let oncekiVar = false;
  let ilkPatlamaMs = null;
  for (let ms = 0; ms < 120000; ms += 33) {
    E.adim(d, 33, r);
    const a = E.simsekAlfasi(d);
    enCok = Math.max(enCok, a);
    const var_ = a > 0;
    if (var_ && !oncekiVar) {
      patlama += 1;
      if (ilkPatlamaMs === null) ilkPatlamaMs = ms;
    }
    oncekiVar = var_;
  }
  assert.ok(enCok <= E.SIMSEK_EN_COK_ALFA + 1e-9, `en çok alfa ${enCok}`);
  assert.ok(E.SIMSEK_EN_COK_ALFA <= 0.15, 'düşük parlaklık');
  assert.ok(ilkPatlamaMs >= 6900, `ilk şimşek ${ilkPatlamaMs} ms (en erken ~7 sn)`);
  assert.ok(patlama >= 6 && patlama <= 18, `120 sn'de ${patlama} şimşek`);
  // başka türde şimşek hiç olmaz
  const yagmur = E.olustur('yagmur', 360, 420, r);
  for (let i = 0; i < 2000; i += 1) E.adim(yagmur, 33, r);
  assert.equal(E.simsekAlfasi(yagmur), 0);
});

test('ciz: her tür çizer, tuvali önce temizler, iki şemada renk takımı değişir; açık temada beyaz kar yok', () => {
  const r = rastgeleUret(3);
  for (const tur of E.EFEKTLER) {
    for (const sema of ['koyu', 'acik']) {
      const d = E.olustur(tur, 360, 420, r);
      E.adim(d, 33, r);
      const b = sahteBaglam();
      E.ciz(b, d, sema);
      assert.deepEqual(b.cagrilar[0], ['clearRect', 0, 0, 360, 420], `${tur}/${sema}: önce temizlenir`);
      assert.ok(b.cagrilar.length > 1, `${tur}/${sema}: çizim yapıldı`);
      assert.ok(b.stiller.length > 0, `${tur}/${sema}: renk kullanıldı`);
      for (const [, renk] of b.stiller) {
        if (typeof renk === 'string') assert.match(renk, /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [01](?:\.\d+)?\)$/, `${tur}/${sema}: ${renk}`);
      }
    }
  }
  const kar = E.olustur('kar', 360, 420, r);
  const acik = sahteBaglam();
  E.ciz(acik, kar, 'acik');
  assert.ok(!acik.stiller.some(([, renk]) => /^rgba\(255, 255, 255,/.test(renk)), 'açık temada beyaz kar çizilmez');
  const koyu = sahteBaglam();
  E.ciz(koyu, kar, 'koyu');
  assert.ok(koyu.stiller.some(([, renk]) => /^rgba\(255, 255, 255,/.test(renk)), 'koyu temada beyaz kar');
  // bilinmeyen şema koyu sayılır
  const garip = sahteBaglam();
  assert.doesNotThrow(() => E.ciz(garip, kar, 'mor'));
});

test('ciz: efekt hiçbir ağ/IPC/DOM yan etkisi içermez (kaynak taraması): fetch, XMLHttpRequest, WebSocket, evYuzey, innerHTML, eval yok', () => {
  const kaynak = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'efekt.js'), 'utf8');
  assert.doesNotMatch(kaynak.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /\bfetch\s*\(|XMLHttpRequest|WebSocket|evYuzey|innerHTML|eval\s*\(|new Function|require\s*\(/);
});
