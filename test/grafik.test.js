'use strict';

/**
 * Grafik kütüphanesi (src/lib/grafik.js): saf hesaplar (özet, aralık, zaman işaretleri), betim üretimi (sparkline, gösterge,
 * karşılaştırma) ve DOM'a güvenli çeviri (svgOlustur: stil/olay öznitelikleri reddedilir). DOM sahtedir; ağ yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/lib/grafik');

const SAAT = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 0, 0);

function sahteBelge() {
  const olustur = (ad) => ({
    ad,
    oznitelikler: {},
    cocuklar: [],
    textContent: '',
    setAttribute(k, v) { this.oznitelikler[k] = v; },
    appendChild(c) { this.cocuklar.push(c); return c; },
  });
  return { createElementNS: (ns, ad) => Object.assign(olustur(ad), { ns }) };
}
const tumunuTopla = (oge, sonuc = []) => (sonuc.push(oge), oge.cocuklar.forEach((c) => tumunuTopla(c, sonuc)), sonuc);
const betimTopla = (b, sonuc = []) => (sonuc.push(b), (b.c ?? []).forEach((c) => betimTopla(c, sonuc)), sonuc);

test('temizle: sonlu olmayan zaman atılır, sayı olmayan değer kesinti olur, zamana göre sıralanır', () => {
  const t = G.temizle([{ t: 3, d: 1 }, { t: 1, d: 'on' }, { t: NaN, d: 5 }, null, { t: 2, d: NaN }, { t: 4, d: '7' }, { t: 5 }]);
  assert.deepEqual(t, [{ t: 1, d: null }, { t: 2, d: null }, { t: 3, d: 1 }, { t: 4, d: null }, { t: 5, d: null }]);
  assert.deepEqual(G.temizle('x'), []);
  assert.deepEqual(G.temizle(undefined), []);
  assert.equal(G.temizle(Array.from({ length: 3000 }, (_, i) => ({ t: i, d: i }))).length, 2000, 'nokta sayısı sınırlı');
});

test('ozet: en az/en çok/son; ortalama zaman ağırlıklıdır; kesinti dışarıda; sayısal nokta yoksa null', () => {
  // 0-1 saat: 10, 1-2 saat: 20 (doğrusal): ortalama (10+10)/2*1 + (10+20)/2*1 / 2 = 12.5; seyrek örnek yanıltmaz
  const o = G.ozet([{ t: T0, d: 10 }, { t: T0 + SAAT, d: 10 }, { t: T0 + 2 * SAAT, d: 20 }]);
  assert.equal(o.enAz, 10);
  assert.equal(o.enCok, 20);
  assert.equal(o.ortalama, 12.5);
  assert.equal(o.ilk, 10);
  assert.equal(o.son, 20);
  assert.equal(o.adet, 3);
  // yoğun nokta ortalamayı kaydırmaz: ilk saatte çok nokta (hepsi 10)
  const yogun = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ t: T0 + i * 60_000, d: 10 }));
  assert.equal(G.ozet([...yogun, { t: T0 + 10 * 60_000 + 50 * 60_000, d: 10 }, { t: T0 + 2 * SAAT, d: 20 }]).ortalama > 10, true);
  // kesinti (unavailable) iki parçayı bağlamaz
  const kesik = G.ozet([{ t: T0, d: 10 }, { t: T0 + SAAT, d: 10 }, { t: T0 + 2 * SAAT, d: 'unavailable' }, { t: T0 + 3 * SAAT, d: 30 }, { t: T0 + 4 * SAAT, d: 30 }]);
  assert.equal(kesik.ortalama, 20);
  assert.equal(kesik.enAz, 10);
  assert.equal(kesik.enCok, 30);
  // tek nokta: aritmetik ortalama
  assert.equal(G.ozet([{ t: T0, d: 7 }]).ortalama, 7);
  assert.equal(G.ozet([{ t: T0, d: 'on' }, { t: T0 + 1, d: null }]), null);
  assert.equal(G.ozet([]), null);
  assert.equal(G.ozet(null), null);
});

test('enYakin: zamana en yakın sayısal nokta; kesinti seçilmez', () => {
  const seri = [{ t: 0, d: 1 }, { t: 100, d: null }, { t: 200, d: 3 }];
  assert.deepEqual(G.enYakin(seri, 90), { t: 0, d: 1 });
  assert.deepEqual(G.enYakin(seri, 150), { t: 200, d: 3 });
  assert.equal(G.enYakin([], 5), null);
  assert.equal(G.enYakin(seri, NaN), null);
});

test('guzelAralik: düzgün işaretler, düz seri için pay, geçersiz girdide null', () => {
  const a = G.guzelAralik(18.3, 23.9);
  assert.ok(a.alt <= 18.3 && a.ust >= 23.9);
  assert.ok(a.isaretler.length >= 3 && a.isaretler.length <= 8);
  assert.deepEqual(a.isaretler, [...a.isaretler].sort((x, y) => x - y));
  assert.equal(a.isaretler[0], a.alt);
  assert.equal(a.isaretler.at(-1), a.ust);
  const yuzde = G.guzelAralik(0, 100);
  assert.deepEqual([yuzde.alt, yuzde.ust], [0, 100]);
  const duz = G.guzelAralik(21, 21);
  assert.ok(duz.alt < 21 && duz.ust > 21);
  const sifir = G.guzelAralik(0, 0);
  assert.ok(sifir.alt < 0 && sifir.ust > 0);
  assert.equal(G.guzelAralik(NaN, 5), null);
  assert.equal(G.guzelAralik('1', 5), null);
  assert.deepEqual(G.guzelAralik(30, 10).isaretler[0] <= 10, true, 'ters aralık düzeltilir');
});

test('zamanIsaretleri: yerel saat sınırlarına oturur, sayı sınırlıdır, geçersiz aralık boş', () => {
  const bir = G.zamanIsaretleri(T0 + 5 * 60_000, T0 + SAAT + 5 * 60_000, { kaymaMs: 0 });
  assert.ok(bir.length >= 2 && bir.length <= 5);
  assert.ok(bir.every((t) => t % (5 * 60_000) === 0 && t >= T0 + 5 * 60_000 && t <= T0 + SAAT + 5 * 60_000));
  const gun = G.zamanIsaretleri(T0 + 3 * SAAT, T0 + 27 * SAAT, { kaymaMs: 0 });
  assert.ok(gun.length >= 3 && gun.length <= 5);
  assert.ok(gun.every((t) => t % SAAT === 0));
  const hafta = G.zamanIsaretleri(T0, T0 + 7 * 24 * SAAT, { kaymaMs: 0 });
  assert.ok(hafta.length <= 5 && hafta.length >= 3);
  assert.ok(hafta.every((t) => t % (24 * SAAT) === 0), 'gün sınırı');
  // kayma: UTC+3 yerel gece yarısına oturur
  const yerel = G.zamanIsaretleri(T0, T0 + 7 * 24 * SAAT, { kaymaMs: 3 * SAAT });
  assert.ok(yerel.every((t) => (t + 3 * SAAT) % (24 * SAAT) === 0));
  assert.deepEqual(G.zamanIsaretleri(5, 5), []);
  assert.deepEqual(G.zamanIsaretleri(NaN, 5), []);
  assert.deepEqual(G.zamanIsaretleri(10, 5), []);
});

test('zamanIsaretleri: kayma işlevi yaz/kış saati geçişini hesaba katar; sabit kayma eski davranışı korur', () => {
  // Berlin 2026: 25 Ekim 01:00 UTC'de (03:00 CEST -> 02:00 CET) kayma +2 saatten +1 saate düşer
  const gecis = Date.UTC(2026, 9, 25, 1, 0);
  const berlin = (ms) => (ms < gecis ? 2 * SAAT : SAAT);
  const bit = Date.UTC(2026, 9, 27, 11, 0); // 27 Ekim 12:00 CET
  const bas = bit - 7 * 24 * SAAT;
  const gun = 24 * SAAT;
  const isaretler = G.zamanIsaretleri(bas, bit, { kaymaMs: berlin });
  assert.ok(isaretler.length >= 3 && isaretler.length <= 5);
  assert.ok(isaretler.every((t) => t >= bas && t <= bit));
  assert.ok(isaretler.every((t) => (t + berlin(t)) % gun === 0), 'her işaret kendi anındaki yerel gece yarısına oturur');
  const sonrasi = isaretler.filter((t) => t >= gecis);
  assert.ok(sonrasi.length >= 1);
  assert.ok(sonrasi.every((t) => new Date(t).getUTCHours() === 23), 'geçişten sonra yerel 00:00 = 23:00Z (eski kod 22:00Z verirdi)');
  // sabit kayma: her işarete aynı fark (eski davranış)
  const sabit = G.zamanIsaretleri(bas, bit, { kaymaMs: 2 * SAAT });
  assert.ok(sabit.every((t) => (t + 2 * SAAT) % gun === 0));
  // geçersiz dönüş değeri güvenli: kayma 0 sayılır
  const bozuk = G.zamanIsaretleri(bas, bit, { kaymaMs: () => NaN });
  assert.ok(bozuk.every((t) => t % gun === 0));
  // 24 saatlik pencerede geçiş geceyi kapsarsa saat işaretleri tam saatlere oturur
  const saatlik = G.zamanIsaretleri(Date.UTC(2026, 9, 24, 12, 0), Date.UTC(2026, 9, 25, 12, 0), { kaymaMs: berlin });
  assert.ok(saatlik.length >= 3);
  assert.ok(saatlik.every((t) => (t + berlin(t)) % SAAT === 0));
  // varsayılan (çalışma ortamının saat dilimi) de her işaretin kendi farkını kullanır
  const varsayilan = G.zamanIsaretleri(bas, bit);
  assert.ok(varsayilan.every((t) => (t - new Date(t).getTimezoneOffset() * 60_000) % gun === 0));
});

test('sparkline: çizgi + alan, sabit viewBox; az nokta ya da sıfır aralık null; düz seri çökmez', () => {
  const seri = [{ t: T0, d: 10 }, { t: T0 + SAAT, d: 20 }, { t: T0 + 2 * SAAT, d: 15 }];
  const s = G.sparkline(seri, { genislik: 100, yukseklik: 30, etiket: 'Sıcaklık' });
  assert.equal(s.e, 'svg');
  assert.equal(s.a.viewBox, '0 0 100 30');
  assert.equal(s.a.preserveAspectRatio, 'none');
  assert.equal(s.a.role, 'img');
  assert.equal(s.a['aria-label'], 'Sıcaklık');
  const cizgi = s.c.find((c) => c.a.class === 'sparkline-cizgi');
  assert.match(cizgi.a.d, /^M0 \S+L50 \S+L100 \S+$/, 'x zamana göre 0..100');
  assert.equal(cizgi.a['vector-effect'], 'non-scaling-stroke');
  assert.ok(s.c.some((c) => c.a.class === 'sparkline-alan'));
  assert.equal(G.sparkline(s.c.length ? seri.slice(0, 1) : [], {}), null);
  assert.equal(G.sparkline([{ t: 5, d: 1 }, { t: 5, d: 2 }]), null, 'zaman aralığı sıfır');
  assert.equal(G.sparkline(null), null);
  assert.equal(G.sparkline([{ t: 1, d: 'on' }, { t: 2, d: 'off' }]), null);
  // etiket yoksa süs: aria-hidden
  assert.equal(G.sparkline(seri).a['aria-hidden'], 'true');
  assert.equal(G.sparkline(seri).a.role, undefined);
  // düz seri
  const duz = G.sparkline([{ t: 0, d: 5 }, { t: 10, d: 5 }]);
  assert.ok(duz);
  assert.doesNotMatch(JSON.stringify(duz), /NaN|Infinity/);
  // verilen zaman aralığı x'i sabitler: seri yalnız yarısını kaplar
  const yari = G.sparkline([{ t: 0, d: 1 }, { t: 50, d: 2 }], { bas: 0, bitis: 100, genislik: 100 });
  assert.match(yari.c.find((c) => c.a.class === 'sparkline-cizgi').a.d, /L50 /);
});

test('sparkline: kesinti çizgiyi böler, tek kalan nokta görünür kalır', () => {
  const s = G.sparkline([{ t: 0, d: 1 }, { t: 10, d: 2 }, { t: 20, d: 'unavailable' }, { t: 30, d: 3 }, { t: 40, d: 'unavailable' }, { t: 50, d: 1 }, { t: 60, d: 2 }]);
  const d = s.c.find((c) => c.a.class === 'sparkline-cizgi').a.d;
  assert.equal((d.match(/M/g) ?? []).length, 3, 'üç parça');
  assert.doesNotMatch(d, /NaN/);
});

test('gostergeOrani ve gosterge: oran kırpılır; geçersiz aralık null; yay uçları doğru', () => {
  assert.equal(G.gostergeOrani(50, 0, 100), 0.5);
  assert.equal(G.gostergeOrani(150, 0, 100), 1);
  assert.equal(G.gostergeOrani(-5, 0, 100), 0);
  assert.equal(G.gostergeOrani(5, 10, 10), null);
  assert.equal(G.gostergeOrani(5, 10, 0), null);
  assert.equal(G.gostergeOrani(NaN, 0, 1), null);
  assert.equal(G.gostergeOrani('5', 0, 10), null);
  const g = G.gosterge(50, 0, 100, { boyut: 60, kalinlik: 6, durum: 'uyari', etiket: 'Pil' });
  assert.equal(g.a.class, 'gosterge');
  assert.equal(g.a['aria-label'], 'Pil');
  const deger = g.c.find((c) => c.a.class.startsWith('gosterge-deger'));
  assert.equal(deger.a.class, 'gosterge-deger uyari');
  // yarım değer: yay ucu üst orta (cx = 30, cy - r = 3)
  assert.match(deger.a.d, /A27 27 0 0 1 30 3$/);
  assert.equal(G.gosterge(0, 0, 100).c.length, 1, 'oran 0: yalnız arka yay');
  assert.equal(G.gosterge(100, 0, 100).c.length, 2);
  assert.equal(G.gosterge(1, 0, 0), null);
  assert.equal(G.gosterge(50, 0, 100, { durum: 'garip' }).c[1].a.class, 'gosterge-deger normal', 'bilinmeyen durum normal');
  assert.doesNotMatch(JSON.stringify(G.gosterge(33.3, 0, 100)), /NaN|Infinity/);
});

test('karsilastirma: ortak birimde ortak Y ekseni, ortak zaman ekseni, seri sınıfları', () => {
  const sonuc = G.karsilastirma(
    [
      { kimlik: 'sensor.a', birim: '°C', noktalar: [{ t: T0, d: 18 }, { t: T0 + 6 * SAAT, d: 24 }, { t: T0 + 12 * SAAT, d: 21 }] },
      { kimlik: 'sensor.b', birim: '°C', noktalar: [{ t: T0, d: 10 }, { t: T0 + 12 * SAAT, d: 15 }] },
    ],
    { genislik: 320, yukseklik: 180, yaziX: (t) => `x${new Date(t).getUTCHours()}`, yaziY: (v) => `y${v}`, etiket: 'Karşılaştırma', kaymaMs: 0 },
  );
  assert.equal(sonuc.kip, 'ortak');
  assert.equal(sonuc.bas, T0);
  assert.equal(sonuc.bitis, T0 + 12 * SAAT);
  assert.equal(sonuc.betim.a.viewBox, '0 0 320 180');
  assert.equal(sonuc.betim.a['aria-label'], 'Karşılaştırma');
  const hepsi = betimTopla(sonuc.betim);
  const cizgiler = hepsi.filter((b) => /(^| )cizgi( |$)/.test(b.a?.class ?? ''));
  assert.deepEqual(cizgiler.map((c) => c.a.class), ['cizgi seri-0', 'cizgi seri-1']);
  const yYazilar = hepsi.filter((b) => b.e === 'text' && b.a.class.includes('eksen-y')).map((b) => b.m);
  assert.ok(yYazilar.length >= 3 && yYazilar.every((m) => /^y-?\d/.test(m)), String(yYazilar));
  const xYazilar = hepsi.filter((b) => b.e === 'text' && b.a.class.includes('eksen-x')).map((b) => b.m);
  assert.ok(xYazilar.length >= 3 && xYazilar.every((m) => /^x\d+$/.test(m)));
  assert.equal(sonuc.seriler[0].ozet.enCok, 24);
  assert.equal(sonuc.seriler[1].ozet.enAz, 10);
  // ortak x: iki serinin son noktası aynı x'te (ikisi de T0+12h)
  const sonX = (c) => Number(c.a.d.split('L').at(-1).split(' ')[0]);
  assert.equal(sonX(cizgiler[0]), sonX(cizgiler[1]));
  assert.doesNotMatch(JSON.stringify(sonuc.betim), /NaN|Infinity|undefined/);
});

test('karsilastirma: farklı birimler bağımsız ölçeklenir, Y yazısı yoktur', () => {
  const sonuc = G.karsilastirma(
    [
      { kimlik: 'sensor.sicaklik', birim: '°C', noktalar: [{ t: 0, d: 20 }, { t: 100, d: 25 }] },
      { kimlik: 'sensor.nem', birim: '%', noktalar: [{ t: 0, d: 40 }, { t: 100, d: 60 }] },
    ],
    { kaymaMs: 0 },
  );
  assert.equal(sonuc.kip, 'bagimsiz');
  const hepsi = betimTopla(sonuc.betim);
  assert.equal(hepsi.filter((b) => b.e === 'text' && b.a.class.includes('eksen-y')).length, 0);
  // iki seri de kendi aralığında tam yükseklikte: ilk nokta altta, son nokta üstte
  const cizgiler = hepsi.filter((b) => /(^| )cizgi( |$)/.test(b.a?.class ?? ''));
  const y = (c) => c.a.d.split('L').map((p) => Number(p.replace('M', '').split(' ')[1]));
  assert.deepEqual(y(cizgiler[0]), y(cizgiler[1]));
  assert.ok(y(cizgiler[0])[0] > y(cizgiler[0])[1]);
});

test('karsilastirma: veri olmayan seri atlanır ama sıra korunur; hiç veri yoksa null; en çok 7 seri', () => {
  const sonuc = G.karsilastirma([
    { kimlik: 'sensor.bos', birim: '', noktalar: [] },
    { kimlik: 'sensor.var', birim: '', noktalar: [{ t: 0, d: 1 }, { t: 60_000, d: 2 }] },
    { kimlik: 'sensor.metin', birim: '', noktalar: [{ t: 0, d: 'on' }] },
  ]);
  assert.deepEqual(sonuc.seriler.map((s) => [s.kimlik, s.sira]), [['sensor.var', 1]]);
  assert.ok(betimTopla(sonuc.betim).some((b) => b.a?.class === 'cizgi seri-1'));
  assert.equal(G.karsilastirma([]), null);
  assert.equal(G.karsilastirma(null), null);
  assert.equal(G.karsilastirma([{ kimlik: 'sensor.x', noktalar: [] }]), null);
  const cok = G.karsilastirma(Array.from({ length: 10 }, (_, i) => ({ kimlik: `sensor.s${i}`, birim: '', noktalar: [{ t: 0, d: i }, { t: 10, d: i + 1 }] })));
  assert.equal(cok.seriler.length, 7);
  // 5. seriden sonra çizgi deseni (renk körlüğü)
  const cizgiler = betimTopla(cok.betim).filter((b) => /(^| )cizgi( |$)/.test(b.a?.class ?? ''));
  assert.equal(cizgiler[0].a['stroke-dasharray'], undefined);
  assert.ok(cizgiler[4].a['stroke-dasharray']);
});

test('karsilastirma: tek noktalı seri nokta olarak görünür; verilen aralık dışındaki noktalar çizilmez; imleç en yakın değeri verir', () => {
  const sonuc = G.karsilastirma(
    [
      { kimlik: 'sensor.a', birim: '', noktalar: [{ t: 0, d: 1 }, { t: 50, d: 2 }, { t: 100, d: 3 }, { t: 500, d: 99 }] },
      { kimlik: 'sensor.b', birim: '', noktalar: [{ t: 50, d: 7 }] },
    ],
    { bas: 0, bitis: 100, kaymaMs: 0 },
  );
  const hepsi = betimTopla(sonuc.betim);
  assert.ok(hepsi.some((b) => b.e === 'circle' && b.a.class === 'nokta seri-1'));
  assert.doesNotMatch(JSON.stringify(sonuc.betim), /99/, 'aralık dışı nokta çizilmedi');
  const { sol, genislik } = sonuc.bolge;
  const im = sonuc.imlec(sol + genislik / 2);
  assert.equal(im.t, 50);
  assert.deepEqual(im.degerler.map((d) => d.d), [2, 7]);
  assert.equal(im.x, sol + genislik / 2);
  // uçlar kırpılır
  assert.equal(sonuc.imlec(-50).t, 0);
  assert.equal(sonuc.imlec(10_000).t, 100);
  assert.equal(sonuc.zamanX(sonuc.xZaman(sol + 10)), sol + 10);
});

test('karsilastirma: pencere başından önceki başlangıç durumu t0\'a taşınır; değişmeyen seri yatay çizgi olur, istatistik aynı kalır', () => {
  const T1 = T0 + 24 * SAAT;
  const yol = (sonuc, sinif) => betimTopla(sonuc.betim).find((b) => b.e === 'path' && b.a.class === sinif);
  const yuvarla1 = (n) => Math.round(n * 10) / 10;
  const sayilar = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  // (a) pencere boyunca değişmeyen sensör: HA yalnız istek anındaki başlangıç durumunu döndürür (t0'dan 5 sn önce)
  const sabit = G.karsilastirma([{ kimlik: 'sensor.pil', birim: '%', noktalar: [{ t: T0 - 5000, d: 85 }] }], { bas: T0, bitis: T1, kaymaMs: 0 });
  const cizgi = yol(sabit, 'cizgi seri-0');
  assert.ok(cizgi, 'tek başlangıç noktası boş grafik bırakmaz');
  const sa = sayilar(cizgi.a.d);
  assert.equal(sa.length, 4);
  assert.equal(sa[0], yuvarla1(sabit.zamanX(T0)), 'sol kenardan başlar');
  assert.equal(sa[2], yuvarla1(sabit.zamanX(T1)), 'sağ kenara uzanır');
  assert.equal(sa[1], sa[3], 'yatay çizgi');
  assert.equal(sabit.seriler[0].ozet.enAz, 85, 'özet özgün noktalardan gelir');
  assert.equal(sabit.seriler[0].ozet.adet, 1);
  // (b) öncül + pencere içi nokta: çizgi sol kenardan başlar, öncül değeriyle
  const degisen = G.karsilastirma([{ kimlik: 'sensor.s', birim: '', noktalar: [{ t: T0 - 3 * SAAT, d: 10 }, { t: T0 + 6 * SAAT, d: 20 }] }], { bas: T0, bitis: T1, kaymaMs: 0 });
  const sb = sayilar(yol(degisen, 'cizgi seri-0').a.d);
  assert.equal(sb[0], yuvarla1(degisen.zamanX(T0)));
  assert.equal(sb[2], yuvarla1(degisen.zamanX(T0 + 6 * SAAT)));
  assert.ok(sb[1] > sb[3], 'başlangıç 10 (alçak, y büyük), sonraki 20 (yüksek)');
  // (c) öncül nokta kesinti (unavailable) ise taşınmaz
  const kesik = G.karsilastirma(
    [{ kimlik: 'sensor.k', birim: '', noktalar: [{ t: T0 - 2 * SAAT, d: 'unavailable' }, { t: T0 + 6 * SAAT, d: 20 }, { t: T0 + 8 * SAAT, d: 30 }] }],
    { bas: T0, bitis: T1, kaymaMs: 0 },
  );
  assert.equal(sayilar(yol(kesik, 'cizgi seri-0').a.d)[0], yuvarla1(kesik.zamanX(T0 + 6 * SAAT)), 'çizgi ilk gerçek noktadan başlar');
  const yalnizKesik = G.karsilastirma(
    [{ kimlik: 'sensor.k', birim: '', noktalar: [{ t: T0 - 2 * SAAT, d: 'unavailable' }, { t: T0 + 6 * SAAT, d: 20 }] }],
    { bas: T0, bitis: T1, kaymaMs: 0 },
  );
  assert.equal(yol(yalnizKesik, 'cizgi seri-0'), undefined);
  assert.ok(betimTopla(yalnizKesik.betim).some((b) => b.e === 'circle'), 'tek gerçek nokta daire olarak kalır');
  // (d) t0'da tam nokta varsa öncül onu ezmez; pencere içi noktalar değişmez
  const tam = G.karsilastirma([{ kimlik: 'sensor.t', birim: '', noktalar: [{ t: T0 - SAAT, d: 1 }, { t: T0, d: 5 }, { t: T0 + SAAT, d: 6 }] }], { bas: T0, bitis: T1, kaymaMs: 0 });
  assert.equal(sayilar(yol(tam, 'cizgi seri-0').a.d).length, 4, 'yalnız iki nokta: öncül eklenmedi');
});

test('svgOlustur: betimi DOM\'a çevirir; stil, olay ve href öznitelikleri ile izinsiz etiketler atlanır', () => {
  const belge = sahteBelge();
  const oge = G.svgOlustur(belge, {
    e: 'svg',
    a: { viewBox: '0 0 10 10', class: 'x', style: 'color:red', onload: 'x()', onclick: 'x()', href: 'javascript:x()', 'xlink:href': 'x', 'stroke-width': 2, kapali: false, yok: null },
    c: [
      { e: 'text', a: { x: 1 }, m: '<b>etiket</b>' },
      { e: 'script', a: {}, c: [] },
      { e: 'foreignObject', a: {} },
      { e: 'path', a: { d: 'M0 0L1 1' } },
    ],
  });
  assert.equal(oge.ad, 'svg');
  assert.equal(oge.ns, G.SVG_AD_ALANI);
  assert.deepEqual(oge.oznitelikler, { viewBox: '0 0 10 10', class: 'x', 'stroke-width': '2' });
  assert.deepEqual(oge.cocuklar.map((c) => c.ad), ['text', 'path'], 'script ve foreignObject eklenmedi');
  assert.equal(oge.cocuklar[0].textContent, '<b>etiket</b>', 'metin textContent ile (işaretleme yorumlanmaz)');
  assert.equal(G.svgOlustur(belge, null), null);
  assert.equal(G.svgOlustur(belge, { e: 'iframe' }), null);
  assert.equal(G.svgOlustur({}, { e: 'svg' }), null);
  assert.equal(G.svgOlustur(null, { e: 'svg' }), null);
});

test('svgOlustur: aşırı derin betim kesilir; tüm üretilen betimler izinli etiket ve özniteliklerle sınırlıdır', () => {
  const belge = sahteBelge();
  let derin = { e: 'g' };
  for (let i = 0; i < 20; i += 1) derin = { e: 'g', c: [derin] };
  const oge = G.svgOlustur(belge, derin);
  assert.ok(tumunuTopla(oge).length <= 8);
  const hepsi = [
    G.sparkline([{ t: 0, d: 1 }, { t: 10, d: 2 }], { etiket: 'a' }),
    G.gosterge(40, 0, 100, { etiket: 'b' }),
    G.karsilastirma([{ kimlik: 'sensor.a', birim: '', noktalar: [{ t: 0, d: 1 }, { t: 100, d: 2 }] }]).betim,
  ];
  for (const b of hepsi) {
    const dom = G.svgOlustur(belge, b);
    for (const o of tumunuTopla(dom)) {
      assert.ok(['svg', 'g', 'path', 'line', 'circle', 'rect', 'text', 'title'].includes(o.ad), o.ad);
      for (const ad of Object.keys(o.oznitelikler)) assert.doesNotMatch(ad, /^(on|style$|href$|xlink)/i, ad);
    }
  }
});

test('CSP uyumu: grafik.js betik içi stil/innerHTML/eval kullanmaz ve ağa çıkmaz', () => {
  const ham = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'grafik.js'), 'utf8');
  const kaynak = ham.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // yorumlar yasak sözcükleri anabilir
  for (const yasak of [/innerHTML/, /outerHTML/, /insertAdjacent/, /document\.write/, /\beval\s*\(/, /new Function/, /\.style\b/, /setAttribute\(\s*['"]style/, /fetch\(/, /XMLHttpRequest/, /require\(/]) {
    assert.doesNotMatch(kaynak, yasak, String(yasak));
  }
});

test('zamanIsaretleri: yaz saatine ileri/geri geçişte aynı an iki kez işaretlenmez (artan sıra)', () => {
  // Berlin 2026: 29 Mart 01:00Z'de 02:00 CET -> 03:00 CEST (yerel 02:00 yok); 25 Ekim 01:00Z'de 03:00 CEST -> 02:00 CET
  const ileri = Date.UTC(2026, 2, 29, 1, 0);
  const geri = Date.UTC(2026, 9, 25, 1, 0);
  const berlinIleri = (ms) => (ms < ileri ? SAAT : 2 * SAAT);
  const berlinGeri = (ms) => (ms < geri ? 2 * SAAT : SAAT);
  const artanMi = (d) => d.every((t, i) => i === 0 || t > d[i - 1]);
  for (const adim of [30 * 60_000, SAAT]) {
    const bas = Date.UTC(2026, 2, 29, 0, 0);
    const bit = bas + 4 * adim * 2;
    const a = G.zamanIsaretleri(bas, bit, { kaymaMs: berlinIleri, en: 24 });
    assert.ok(artanMi(a), 'ileri geçiş: artan, tekrarsız ' + a.map((t) => new Date(t).toISOString()));
    const b = G.zamanIsaretleri(Date.UTC(2026, 9, 25, 0, 0), Date.UTC(2026, 9, 25, 4, 0), { kaymaMs: berlinGeri, en: 24 });
    assert.ok(artanMi(b), 'geri geçiş: artan, tekrarsız ' + b.map((t) => new Date(t).toISOString()));
  }
  const saat = G.zamanIsaretleri(Date.UTC(2026, 2, 29, 0, 0), Date.UTC(2026, 2, 29, 4, 0), { kaymaMs: berlinIleri, en: 24 });
  assert.equal(new Set(saat).size, saat.length);
  assert.equal(saat.filter((t) => t === Date.UTC(2026, 2, 29, 1, 0)).length, 1, '01:00Z yalnız bir kez');
});
