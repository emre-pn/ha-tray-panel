'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PENCERE_BOYUTLARI,
  VARSAYILAN_BOYUTLAR,
  pencereBoyutuDuzelt,
  varsayilanBoyut,
  ortala,
  pencereKaydiHesapla,
  KOSE_BOYUTU,
  koseKonumu,
  PANEL_BOYUTU,
  PALET_BOYUTU,
  panelKonumu,
  yuzeyYuksekligiKirp,
  YAKINLASTIRMA_ADIMLARI,
  yakinlastirmaTusu,
  yakinlastirmaDegeri,
  yuzeyBoyutu,
} = require('../src/lib/pencere-yerlesim');

const icinde = (hedef, alan) =>
  hedef.x >= alan.x && hedef.y >= alan.y && hedef.x + hedef.width <= alan.x + alan.width && hedef.y + hedef.height <= alan.y + alan.height;

test('ortala: tek monitör, boyut sığıyorsa aynen ve ortada', () => {
  const alan = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(ortala(alan, { width: 560, height: 780 }), { x: 680, y: 130, width: 560, height: 780 });
});

test('ortala: ikinci monitör solda (workArea x negatif) — imleç o monitördeyse oradan çıkmaz', () => {
  const sol = { x: -1920, y: 0, width: 1920, height: 1040 };
  const hedef = ortala(sol, { width: 560, height: 780 });
  assert.deepEqual(hedef, { x: -1240, y: 130, width: 560, height: 780 });
  assert.ok(icinde(hedef, sol));
});

test('ortala: ikinci monitör üstte/sağda ve farklı çözünürlükte', () => {
  const sag = { x: 1920, y: -200, width: 2560, height: 1400 };
  const hedef = ortala(sag, { width: 1280, height: 820 });
  assert.ok(icinde(hedef, sag));
  assert.equal(hedef.x, 1920 + (2560 - 1280) / 2);
  assert.equal(hedef.y, -200 + (1400 - 820) / 2);
});

test('ortala: çok büyük kayıtlı boyut çalışma alanına sığacak şekilde kısılır (24 px kenar)', () => {
  const alan = { x: 0, y: 0, width: 1366, height: 728 };
  const hedef = ortala(alan, { width: 5000, height: 4000 });
  assert.deepEqual(hedef, { x: 24, y: 24, width: 1366 - 48, height: 728 - 48 });
  assert.ok(icinde(hedef, alan));
});

test('ortala: yüzde 125 ve 150 ölçekli küçük ekran (DIP çalışma alanı)', () => {
  // 1920x1080 @125% -> 1536x864 DIP, görev çubuğu ~32 DIP; 1920x1080 @150% -> 1280x720, ~27 DIP
  for (const alan of [
    { x: 0, y: 0, width: 1536, height: 832 },
    { x: 0, y: 0, width: 1280, height: 693 },
    { x: 0, y: 0, width: 1024, height: 548 },
  ]) {
    const hizli = ortala(alan, VARSAYILAN_BOYUTLAR.hizli);
    const genis = ortala(alan, VARSAYILAN_BOYUTLAR.genis);
    assert.ok(icinde(hizli, alan), JSON.stringify(alan));
    assert.ok(icinde(genis, alan), JSON.stringify(alan));
    assert.ok(hizli.width <= 560);
  }
});

test('ortala: ondalıklı çalışma alanı tamsayıya yuvarlanır; bozuk alanda bile en az 1 piksel', () => {
  const hedef = ortala({ x: 0.5, y: 0.5, width: 1000.5, height: 700.5 }, { width: 500, height: 400 });
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isInteger(hedef[k]), k);
  const minik = ortala({ x: 0, y: 0, width: 30, height: 30 }, { width: 560, height: 780 });
  assert.ok(minik.width >= 1 && minik.height >= 1);
});

test('hızlı boyut 870 pikselin altında kalır (HA dar düzene geçsin)', () => {
  assert.ok(VARSAYILAN_BOYUTLAR.hizli.width < 870);
  assert.ok(VARSAYILAN_BOYUTLAR.genis.width > 870);
  assert.deepEqual(PENCERE_BOYUTLARI, ['hizli', 'genis']);
});

test('varsayilanBoyut: çalışma alanına sığar (yükseklik <= workArea - 48)', () => {
  const buyuk = { x: 0, y: 0, width: 2560, height: 1400 };
  assert.deepEqual(varsayilanBoyut('hizli', buyuk), { width: 560, height: 780 });
  assert.deepEqual(varsayilanBoyut('genis', buyuk), { width: 1280, height: 820 });
  const kucuk = { x: 0, y: 0, width: 1366, height: 728 };
  assert.deepEqual(varsayilanBoyut('hizli', kucuk), { width: 560, height: 680 });
  assert.deepEqual(varsayilanBoyut('genis', kucuk), { width: 1280, height: 680 });
  assert.deepEqual(varsayilanBoyut('bilinmeyen', buyuk), { width: 560, height: 780 });
});

test('pencereBoyutuDuzelt: geçerli boyutu yuvarlar, geçersizi null yapar', () => {
  assert.deepEqual(pencereBoyutuDuzelt({ width: 560.4, height: 780.6 }), { width: 560, height: 781 });
  assert.deepEqual(pencereBoyutuDuzelt({ width: 1280, height: 820, maximized: true }, { maximized: true }), {
    width: 1280,
    height: 820,
    maximized: true,
  });
  assert.deepEqual(pencereBoyutuDuzelt({ width: 1280, height: 820 }, { maximized: true }), {
    width: 1280,
    height: 820,
    maximized: false,
  });
  // maximized yalnız istendiğinde saklanır
  assert.ok(!('maximized' in pencereBoyutuDuzelt({ width: 600, height: 700, maximized: true })));
  for (const kotu of [null, undefined, 5, 'x', {}, { width: 100, height: 700 }, { width: 600, height: 100 }, { width: NaN, height: 700 }, { width: 100_000, height: 700 }, { width: Infinity, height: 700 }]) {
    assert.equal(pencereBoyutuDuzelt(kotu), null, JSON.stringify(kotu));
  }
});

// --- pencereKaydiHesapla: hangi yuvaya ne yazılır ---------------------------

const kayitli = { hizli: { width: 560, height: 780 }, genis: { width: 1280, height: 820, maximized: false } };
const kaydet = (ek) =>
  pencereKaydiHesapla({
    fizikselMod: 'hizli',
    normalSinirlar: { width: 600, height: 700 },
    buyutulmus: false,
    hedef: null,
    mevcut: kayitli,
    ...ek,
  });

test('pencereKaydiHesapla: kullanıcı boyutu fiziksel pencerenin modunun yuvasına yazılır', () => {
  assert.deepEqual(kaydet({}), { yuva: 'hizli', kayit: { width: 600, height: 700 } });
  assert.deepEqual(kaydet({ fizikselMod: 'genis', normalSinirlar: { width: 1000, height: 650 }, buyutulmus: true }), {
    yuva: 'genis',
    kayit: { width: 1000, height: 650, maximized: true },
  });
});

test('pencereKaydiHesapla: yuva ayardaki etkin moda değil fiziksel moda bağlıdır (mod gizliyken değişince eski boyut yeni yuvayı ezmez)', () => {
  // Pencere hızlı boyutta (560x780) gizli; ayarda mod 'genis'e çevrildi. Kayıt hâlâ 'hizli' yuvasına gider.
  const sonuc = kaydet({ fizikselMod: 'hizli', normalSinirlar: { width: 560, height: 780 }, hedef: { mod: 'hizli', width: 560, height: 780 } });
  assert.equal(sonuc.yuva, 'hizli');
  assert.ok(!('maximized' in sonuc.kayit));
});

test('pencereKaydiHesapla: yalnız genis modda büyütülmüş durum saklanır', () => {
  assert.ok(!('maximized' in kaydet({ buyutulmus: true }).kayit));
  assert.equal(kaydet({ fizikselMod: 'genis', buyutulmus: false, normalSinirlar: { width: 900, height: 600 } }).kayit.maximized, false);
});

test('pencereKaydiHesapla: yerleştirme hedefinde kalan (kısılmış) boyut kullanıcının kayıtlı boyutunu ezmez', () => {
  const hedef = { mod: 'genis', width: 1280, height: 680 }; // 728 piksellik çalışma alanına kısıldı
  const sonuc = kaydet({ fizikselMod: 'genis', normalSinirlar: { width: 1280, height: 680 }, hedef });
  assert.deepEqual(sonuc, { yuva: 'genis', kayit: { width: 1280, height: 820, maximized: false } });
  // Büyütülmüş durum yine de güncellenir.
  assert.equal(kaydet({ fizikselMod: 'genis', normalSinirlar: { width: 1280, height: 680 }, hedef, buyutulmus: true }).kayit.maximized, true);
});

test('pencereKaydiHesapla: karma DPI yuvarlaması (en çok 2 DIP) yeniden boyutlandırma sayılmaz; fazlası sayılır', () => {
  const hedef = { mod: 'hizli', width: 560, height: 780 };
  assert.deepEqual(kaydet({ normalSinirlar: { width: 561, height: 779 }, hedef }).kayit, { width: 560, height: 780 });
  assert.deepEqual(kaydet({ normalSinirlar: { width: 563, height: 780 }, hedef }).kayit, { width: 563, height: 780 });
  assert.deepEqual(kaydet({ normalSinirlar: { width: 560, height: 700 }, hedef }).kayit, { width: 560, height: 700 });
});

test('pencereKaydiHesapla: hedef başka modun yerleştirmesindense kıyaslanmaz', () => {
  const hedef = { mod: 'genis', width: 600, height: 700 };
  assert.deepEqual(kaydet({ fizikselMod: 'hizli', normalSinirlar: { width: 600, height: 700 }, hedef }).kayit, { width: 600, height: 700 });
});

test('pencereKaydiHesapla: geçersiz girdilerde kayıt yok (null)', () => {
  assert.equal(kaydet({ fizikselMod: 'dev' }), null);
  assert.equal(kaydet({ fizikselMod: undefined }), null);
  assert.equal(kaydet({ normalSinirlar: { width: 100, height: 100 } }), null); // en az boyutun altı
  assert.equal(kaydet({ normalSinirlar: { width: NaN, height: 700 } }), null);
  assert.equal(kaydet({ normalSinirlar: null }), null);
});

test('pencereKaydiHesapla: kayıtlı boyut yoksa/bozuksa gerçek boyut yazılır', () => {
  const hedef = { mod: 'hizli', width: 560, height: 780 };
  assert.deepEqual(kaydet({ normalSinirlar: { width: 560, height: 780 }, hedef, mevcut: {} }).kayit, { width: 560, height: 780 });
  assert.deepEqual(kaydet({ normalSinirlar: { width: 560, height: 780 }, hedef, mevcut: undefined }).kayit, { width: 560, height: 780 });
});

test('koseKonumu: tek monitörde çalışma alanının sağ alt köşesi, 16 piksel boşlukla (hiz-04)', () => {
  const k = koseKonumu({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(k, { x: 1920 - 320 - 16, y: 1040 - 56 - 16, width: 320, height: 56 });
});

test('koseKonumu: ikinci monitör solda (negatif x) ve üstte (negatif y); görev çubuğu çalışma alanından hariç', () => {
  const sol = koseKonumu({ x: -1920, y: 0, width: 1920, height: 1050 });
  assert.deepEqual(sol, { x: -320 - 16, y: 1050 - 56 - 16, width: 320, height: 56 });
  const ust = koseKonumu({ x: 100, y: -1080, width: 1920, height: 1040 });
  assert.equal(ust.y, -1080 + 1040 - 56 - 16);
  assert.ok(icinde(ust, { x: 100, y: -1080, width: 1920, height: 1040 }));
});

test('koseKonumu: çalışma alanı pencereden küçükse alan dışına taşmaz; ondalıklı alan yuvarlanır', () => {
  const kucuk = koseKonumu({ x: 10, y: 20, width: 200, height: 40 });
  assert.equal(kucuk.x, 10);
  assert.equal(kucuk.y, 20);
  const ondalik = koseKonumu({ x: 0.4, y: 0.4, width: 1535.2, height: 800.6 });
  assert.ok(Number.isInteger(ondalik.x) && Number.isInteger(ondalik.y));
  assert.deepEqual({ w: ondalik.width, h: ondalik.height }, { w: KOSE_BOYUTU.width, h: KOSE_BOYUTU.height });
});

// --- g-09: köşe bildirimi açık panelle çakışmaz --------------------------------------------------

const ALAN = { x: 0, y: 0, width: 1920, height: 1040 };

test('koseKonumu (g-09): panel sağ alt köşede açıksa bildirim panelin ÜSTÜNE, 8 piksel boşlukla taşınır (x aynı kalır)', () => {
  // tepsi simgesinin yanında açılan gerçek panel konumu (görev çubuğu altta): alt kenarı çalışma alanının 8 piksel içinde
  const boyut = { width: PANEL_BOYUTU.width, height: 420 };
  const konum = panelKonumu({ x: 1880, y: 1045, width: 24, height: 24 }, ALAN, boyut, 8, { x: 0, y: 0, width: 1920, height: 1080 });
  const panel = { ...konum, ...boyut };
  const varsayilan = koseKonumu(ALAN);
  assert.ok(varsayilan.y + varsayilan.height > panel.y, 'varsayılan konum panelin alt kısmını örter (sorun)');
  const k = koseKonumu(ALAN, undefined, undefined, panel);
  assert.equal(k.y, panel.y - KOSE_BOYUTU.height - 8, 'panelin hemen üstünde');
  assert.equal(k.x, varsayilan.x);
  assert.ok(k.y + k.height <= panel.y, 'panelle kesişmez');
  assert.ok(icinde(k, ALAN));
});

test('koseKonumu (g-09): kesişme yoksa konum değişmez; engel geçersizse yok sayılır', () => {
  const sagAlt = koseKonumu(ALAN);
  assert.deepEqual(koseKonumu(ALAN, undefined, undefined, { x: 100, y: 100, width: 360, height: 420 }), sagAlt, 'panel sol üstte');
  assert.deepEqual(koseKonumu(ALAN, undefined, undefined, { x: 1500, y: 100, width: 360, height: 300 }), sagAlt, 'panel üstte, bildirim alanına inmiyor');
  for (const kotu of [null, undefined, {}, { x: 1, y: 1, width: 0, height: 5 }, { x: NaN, y: 0, width: 5, height: 5 }]) {
    assert.deepEqual(koseKonumu(ALAN, undefined, undefined, kotu), sagAlt, JSON.stringify(kotu));
  }
});

test('koseKonumu (g-09): üstte yer yoksa panelin soluna; ikisine de sığmıyorsa varsayılan konumda kalır (bildirim her zaman görünür)', () => {
  // panel çalışma alanının tepesinden tabana uzanıyor: üste sığmaz, sola sığar
  const uzun = { x: 1552, y: 8, width: 360, height: 1024 };
  const sol = koseKonumu(ALAN, undefined, undefined, uzun);
  assert.equal(sol.x, uzun.x - KOSE_BOYUTU.width - 8);
  assert.equal(sol.y, koseKonumu(ALAN).y);
  assert.ok(sol.x + sol.width <= uzun.x);
  // çalışma alanının tamamını kaplayan engel: varsayılan
  assert.deepEqual(koseKonumu(ALAN, undefined, undefined, { x: 0, y: 0, width: 1920, height: 1040 }), koseKonumu(ALAN));
  // ikinci monitör (negatif x): panel orada
  const ikinci = { x: -1920, y: 0, width: 1920, height: 1040 };
  const panelIkinci = { x: -400, y: 600, width: 360, height: 420 };
  const k = koseKonumu(ikinci, undefined, undefined, panelIkinci);
  assert.equal(k.y, 600 - 56 - 8);
  assert.ok(icinde(k, ikinci));
});

// --- g-13: panel ve palette yazı boyutu (yakınlaştırma) ------------------------------------------

test('yakinlastirmaTusu: Ctrl + / = / Add -> artir, Ctrl - / _ / Subtract -> azalt, Ctrl 0 -> sifirla; Ctrl\'süz, Alt/Meta\'lı ve tuş bırakma yok sayılır', () => {
  const k = (key, ek = {}) => ({ type: 'keyDown', control: true, key, ...ek });
  for (const key of ['+', '=', 'Add']) assert.equal(yakinlastirmaTusu(k(key)), 'artir', key);
  assert.equal(yakinlastirmaTusu(k('+', { shift: true })), 'artir', 'Türkçe Q klavyede + Shift ile üretilir');
  for (const key of ['-', '_', 'Subtract']) assert.equal(yakinlastirmaTusu(k(key)), 'azalt', key);
  assert.equal(yakinlastirmaTusu(k('0')), 'sifirla');
  assert.equal(yakinlastirmaTusu(k('+', { control: false })), null);
  assert.equal(yakinlastirmaTusu(k('+', { alt: true })), null);
  assert.equal(yakinlastirmaTusu(k('+', { meta: true })), null);
  assert.equal(yakinlastirmaTusu(k('+', { type: 'keyUp' })), null);
  assert.equal(yakinlastirmaTusu(k('a')), null);
  assert.equal(yakinlastirmaTusu(k('Enter')), null);
  for (const kotu of [null, undefined, 5, {}]) assert.equal(yakinlastirmaTusu(kotu), null);
});

test('yakinlastirmaDegeri: adımlar 1 .. 2 arasında sınırlıdır, sıfırla 1\'e döner, bilinmeyen değer 1 sayılır', () => {
  assert.deepEqual([...YAKINLASTIRMA_ADIMLARI], [1, 1.15, 1.3, 1.5, 1.75, 2]);
  let z = 1;
  const gezi = [];
  for (let i = 0; i < 8; i += 1) {
    z = yakinlastirmaDegeri(z, 'artir');
    gezi.push(z);
  }
  assert.deepEqual(gezi, [1.15, 1.3, 1.5, 1.75, 2, 2, 2, 2], 'en çok 2 kat');
  assert.equal(yakinlastirmaDegeri(2, 'azalt'), 1.75);
  assert.equal(yakinlastirmaDegeri(1, 'azalt'), 1, 'varsayılandan küçülmez');
  assert.equal(yakinlastirmaDegeri(1.75, 'sifirla'), 1);
  assert.equal(yakinlastirmaDegeri(7, 'artir'), 1.15);
  assert.equal(yakinlastirmaDegeri(1.3, 'bilinmeyen'), 1.3);
});

test('yuzeyBoyutu: ölçek 1 eski davranışla aynı; ölçekle genişlik ve yükseklik büyür, çalışma alanına sığacak biçimde kırpılır', () => {
  const alan = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 420, 1, alan), { width: 360, height: 420 });
  assert.deepEqual(yuzeyBoyutu(PALET_BOYUTU, 96, 1, alan), { width: 560, height: 120 }, 'palet yüksekliği en az 120');
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 420, 1.5, alan), { width: 540, height: 630 });
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 420, 2, alan), { width: 720, height: 840 });
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 500, 2, alan), { width: 720, height: 1000 }, 'en çok sınırı da ölçekle büyür (640 * 2)');
  assert.equal(yuzeyBoyutu(PANEL_BOYUTU, 600, 2, alan).height, 1024, 'çalışma alanından 16 piksel pay kalır');
  const dar = { x: 0, y: 0, width: 800, height: 600 };
  assert.deepEqual(yuzeyBoyutu(PALET_BOYUTU, 300, 2, dar), { width: 784, height: 584 }, 'genişlik çalışma alanına kırpılır');
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 420, 1.234, alan), { width: 360, height: 420 }, 'bilinmeyen ölçek 1 sayılır');
  assert.deepEqual(yuzeyBoyutu(PANEL_BOYUTU, 420, 1), { width: 360, height: 420 }, 'çalışma alanı olmadan da çalışır');
});

test('yuzeyYuksekligiKirp: ölçek verilmezse eski sınırlar (120..640); ölçek en çok sınırını büyütür, küçültmez', () => {
  const alan = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(yuzeyYuksekligiKirp(100), 120);
  assert.equal(yuzeyYuksekligiKirp(900), 640);
  assert.equal(yuzeyYuksekligiKirp(900, alan), 640);
  assert.equal(yuzeyYuksekligiKirp(900, alan, 1.5), 900);
  assert.equal(yuzeyYuksekligiKirp(2000, alan, 2), 1024);
  assert.equal(yuzeyYuksekligiKirp(900, alan, 0.5), 640, '1\'den küçük ölçek sınırı küçültmez');
  assert.equal(yuzeyYuksekligiKirp(NaN, alan, 2), null);
});
