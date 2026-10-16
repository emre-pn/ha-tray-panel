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
  KONUM_MODLARI,
  OPAKLIK_SINIRI,
  konumDuzelt,
  konumlariDuzelt,
  tercihEkranDuzelt,
  ekranlariOzetle,
  tercihKaydiOlustur,
  tercihEkranBul,
  enCokKesisenEkran,
  alanaSigdir,
  yeterinceGorunurMu,
  anaPencereHedefi,
  pencereKonumKaydiHesapla,
  opaklikOrani,
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

test('yakinlastirmaDegeri: taban (Ayarlar > Metin boyutu) sıfırlamanın döneceği değerdir; taban altına inilebilir; geçersiz taban 1 sayılır (o-25)', () => {
  assert.equal(yakinlastirmaDegeri(1.75, 'sifirla', 1.3), 1.3);
  assert.equal(yakinlastirmaDegeri(1, 'sifirla', 1.5), 1.5);
  assert.equal(yakinlastirmaDegeri(1.15, 'sifirla'), 1, 'taban verilmezse 1');
  for (const kotu of [1.2, 0, -1, NaN, null, undefined, '1.3', 3]) assert.equal(yakinlastirmaDegeri(1.5, 'sifirla', kotu), 1, String(kotu));
  assert.equal(yakinlastirmaDegeri(1.3, 'azalt', 1.3), 1.15, 'taban 130 iken Ctrl − 115\'e iner');
  assert.equal(yakinlastirmaDegeri(1.3, 'artir', 1.3), 1.5);
  assert.equal(yakinlastirmaDegeri(2, 'artir', 1.5), 2, 'üst sınır tabandan bağımsız');
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

// ---------------------------------------------------------------------------
// 1.4.0 (o-32): konum kaydı, tercih edilen ekran, ekrana taşı, opaklık
// ---------------------------------------------------------------------------

const ekranBirinci = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
const ekranSol = { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, workArea: { x: -1280, y: 0, width: 1280, height: 984 }, scaleFactor: 1.25 };
const ekranlar2 = ekranlariOzetle([ekranSol, ekranBirinci], 1);

test('KONUM_MODLARI: yalnız imlec ve hatirla; OPAKLIK_SINIRI 50..100', () => {
  assert.deepEqual([...KONUM_MODLARI], ['imlec', 'hatirla']);
  assert.deepEqual({ ...OPAKLIK_SINIRI }, { en_az: 50, en_cok: 100 });
});

test('konumDuzelt: tam sayı konum geçerli (negatif de), ondalık yuvarlanır; bozuk değerler null', () => {
  assert.deepEqual(konumDuzelt({ x: 10, y: 20 }), { x: 10, y: 20 });
  assert.deepEqual(konumDuzelt({ x: -1280, y: -40 }), { x: -1280, y: -40 }, 'sol/üst monitör negatif konumdur');
  assert.deepEqual(konumDuzelt({ x: 10.6, y: 20.4 }), { x: 11, y: 20 });
  for (const kotu of [null, undefined, 5, 'x', [], {}, { x: 1 }, { y: 1 }, { x: '1', y: 2 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 1e9, y: 0 }]) {
    assert.equal(konumDuzelt(kotu), null, JSON.stringify(kotu));
  }
});

test('konumlariDuzelt: yalnız hizli/genis yuvaları, geçersiz yuva ve bilinmeyen anahtar atılır; çıktı yeni nesnedir', () => {
  assert.deepEqual(konumlariDuzelt({ hizli: { x: 1, y: 2 }, genis: { x: 'a', y: 2 }, baska: { x: 5, y: 5 } }), { hizli: { x: 1, y: 2 } });
  assert.deepEqual(konumlariDuzelt(null), {});
  assert.deepEqual(konumlariDuzelt([]), {});
  const girdi = { genis: { x: 3, y: 4, fazla: 1 } };
  const cikti = konumlariDuzelt(girdi);
  assert.deepEqual(cikti, { genis: { x: 3, y: 4 } }, 'yuva içindeki fazladan alan taşınmaz');
  assert.notEqual(cikti.genis, girdi.genis);
});

test('tercihEkranDuzelt: boş nesne = tercih yok; tam kayıt korunur; bozuk biçim undefined (ayar alanı reddeder)', () => {
  assert.deepEqual(tercihEkranDuzelt({}), {});
  assert.deepEqual(tercihEkranDuzelt({ id: 3, x: -1280, y: 0, genislik: 1280, yukseklik: 1024 }), { id: 3, x: -1280, y: 0, genislik: 1280, yukseklik: 1024 });
  assert.deepEqual(tercihEkranDuzelt({ id: 3, x: 1.4, y: 2.6, genislik: 800, yukseklik: 600, fazla: 'x' }), { id: 3, x: 1, y: 3, genislik: 800, yukseklik: 600 });
  for (const kotu of [null, undefined, 3, 'a', [], { id: -1, x: 0, y: 0, genislik: 1, yukseklik: 1 }, { id: 1.5, x: 0, y: 0, genislik: 1, yukseklik: 1 }, { id: '1', x: 0, y: 0, genislik: 1, yukseklik: 1 }, { id: 1, x: 0, y: 0, genislik: 0, yukseklik: 1 }, { id: 1, x: 0, y: 0, genislik: 1, yukseklik: 100001 }, { id: 1, x: 'a', y: 0, genislik: 1, yukseklik: 1 }, { id: 1 }]) {
    assert.equal(tercihEkranDuzelt(kotu), undefined, JSON.stringify(kotu));
  }
});

test('ekranlariOzetle: birincil önce, sonra soldan sağa; bozuk ekran atılır; en çok 16; calismaAlani yoksa sınırlar', () => {
  assert.deepEqual(
    ekranlar2.map((e) => [e.id, e.birincil]),
    [[1, true], [2, false]],
  );
  assert.deepEqual(ekranlar2[1].calismaAlani, { x: -1280, y: 0, width: 1280, height: 984 });
  const bozuk = ekranlariOzetle([null, { id: 'a', bounds: ekranBirinci.bounds }, { id: 4, bounds: { x: 0, y: 0, width: 0, height: 5 } }, { id: -2, bounds: ekranBirinci.bounds }, { id: 7, bounds: ekranBirinci.bounds }], 7);
  assert.deepEqual(bozuk.map((e) => e.id), [7]);
  assert.deepEqual(bozuk[0].calismaAlani, ekranBirinci.bounds, 'workArea bozuksa tüm alan');
  assert.deepEqual(ekranlariOzetle('x'), []);
  assert.deepEqual(ekranlariOzetle(undefined), []);
  const cok = Array.from({ length: 30 }, (_, i) => ({ id: i, bounds: { x: i * 100, y: 0, width: 100, height: 100 } }));
  assert.equal(ekranlariOzetle(cok).length, 16);
});

test('tercihKaydiOlustur + tercihEkranBul: kimlikle eşleşir; kimlik değişince aynı yer ve boyutla; yoksa null', () => {
  const sol = ekranlar2.find((e) => e.id === 2);
  const kayit = tercihKaydiOlustur(sol);
  assert.deepEqual(kayit, { id: 2, x: -1280, y: 0, genislik: 1280, yukseklik: 1024 });
  assert.deepEqual(tercihEkranDuzelt(kayit), kayit, 'oluşturulan kayıt doğrulamadan geçer');
  assert.equal(tercihEkranBul(ekranlar2, kayit).id, 2);
  assert.equal(tercihEkranBul(ekranlar2, { ...kayit, id: 99 }).id, 2, 'kimlik değişti, sınırlar aynı');
  assert.equal(tercihEkranBul(ekranlar2, { ...kayit, id: 99, genislik: 1024 }), null, 'sökülmüş ekran');
  assert.equal(tercihEkranBul(ekranlar2, {}), null);
  assert.equal(tercihEkranBul(ekranlar2, null), null);
  assert.equal(tercihEkranBul(null, kayit), null);
});

test('enCokKesisenEkran / alanaSigdir / yeterinceGorunurMu', () => {
  assert.equal(enCokKesisenEkran(ekranlar2, { x: -100, y: 0, width: 400, height: 300 }).id, 1, '300 piksel birincilde, 100 solda');
  assert.equal(enCokKesisenEkran(ekranlar2, { x: -900, y: 10, width: 400, height: 300 }).id, 2);
  assert.equal(enCokKesisenEkran(ekranlar2, { x: 5000, y: 5000, width: 100, height: 100 }), null);
  const alan = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(alanaSigdir({ x: 900, y: 700, width: 300, height: 300 }, alan), { x: 700, y: 500, width: 300, height: 300 }, 'taşan pencere içeri kaydırılır');
  assert.deepEqual(alanaSigdir({ x: -50, y: -50, width: 3000, height: 2000 }, alan), { x: 0, y: 0, width: 1000, height: 800 }, 'büyük pencere alana küçülür');
  const sol = ekranlar2.find((e) => e.id === 2);
  assert.equal(yeterinceGorunurMu({ x: -1200, y: 100, width: 400, height: 300 }, sol), true);
  assert.equal(yeterinceGorunurMu({ x: -10, y: 100, width: 400, height: 300 }, sol), false, 'yalnız 10 piksel girer');
});

test('anaPencereHedefi: varsayılan (imlec) imleç ekranında ortalar; tercih ekran bağlıysa orada ortalar', () => {
  const boyut = { width: 560, height: 780 };
  const imlecAlani = ekranBirinci.workArea;
  const a = anaPencereHedefi({ boyut, imlecAlani });
  assert.equal(a.kaynak, 'imlec');
  assert.deepEqual({ x: a.x, y: a.y, width: a.width, height: a.height }, { ...ortala(imlecAlani, boyut) });
  const sol = ekranlar2.find((e) => e.id === 2);
  const b = anaPencereHedefi({ boyut, imlecAlani, tercihEkran: sol, ekranlar: ekranlar2 });
  assert.equal(b.kaynak, 'tercih');
  assert.ok(icinde(b, sol.calismaAlani));
  assert.equal(b.x, Math.round(-1280 + (1280 - 560) / 2));
});

test('anaPencereHedefi: konum "hatirla" ve kayıt görünürse kayıt kullanılır; imlec modunda kayıt yok sayılır', () => {
  const boyut = { width: 560, height: 780 };
  const imlecAlani = ekranBirinci.workArea;
  const kayitli = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: 100, y: 50 }, ekranlar: ekranlar2, imlecAlani });
  assert.deepEqual({ x: kayitli.x, y: kayitli.y, kaynak: kayitli.kaynak }, { x: 100, y: 50, kaynak: 'kayit' });
  const imlecte = anaPencereHedefi({ boyut, konumModu: 'imlec', konum: { x: 100, y: 50 }, ekranlar: ekranlar2, imlecAlani });
  assert.equal(imlecte.kaynak, 'imlec');
  const solda = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: -1100, y: 20 }, ekranlar: ekranlar2, imlecAlani });
  assert.equal(solda.kaynak, 'kayit');
  assert.equal(solda.x, -1100, 'negatif konum (sol monitör) korunur');
});

test('anaPencereHedefi: kayıtlı konumun ekranı sökülmüşse (ya da çok az görünüyorsa) imleç/tercih ekranına düşer; kayıt taşırsa içeri alınır', () => {
  const boyut = { width: 560, height: 780 };
  const imlecAlani = ekranBirinci.workArea;
  const tekEkran = ekranlariOzetle([ekranBirinci], 1);
  const dusen = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: -1100, y: 20 }, ekranlar: tekEkran, imlecAlani });
  assert.equal(dusen.kaynak, 'imlec', 'sol ekran yok: pencere görünmez bir yerde açılmaz');
  assert.ok(icinde(dusen, imlecAlani));
  const azGorunen = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: 1900, y: 20 }, ekranlar: tekEkran, imlecAlani });
  assert.equal(azGorunen.kaynak, 'imlec', 'yalnız 20 piksel görünüyor');
  const tasan = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: 1700, y: 600 }, ekranlar: tekEkran, imlecAlani });
  assert.equal(tasan.kaynak, 'kayit');
  assert.ok(icinde(tasan, imlecAlani), 'çalışma alanına sığdırılır');
  const sol = ekranlar2.find((e) => e.id === 2);
  const baskaEkranda = anaPencereHedefi({ boyut, konumModu: 'hatirla', konum: { x: 100, y: 50 }, tercihEkran: sol, ekranlar: ekranlar2, imlecAlani });
  assert.equal(baskaEkranda.kaynak, 'tercih', 'tercih edilen ekran başkasıysa kayıt yok sayılır');
});

test('pencereKonumKaydiHesapla: yalnız "hatirla"; kullanıcı taşıdıysa yeni kayıt; hedefte kaldıysa ya da aynıysa null', () => {
  const temel = { konumModu: 'hatirla', fizikselMod: 'hizli', normalSinirlar: { x: 300, y: 120, width: 560, height: 780 }, hedef: { mod: 'hizli', x: 680, y: 130 }, mevcut: {} };
  assert.deepEqual(pencereKonumKaydiHesapla(temel), { hizli: { x: 300, y: 120 } });
  assert.equal(pencereKonumKaydiHesapla({ ...temel, konumModu: 'imlec' }), null);
  assert.equal(pencereKonumKaydiHesapla({ ...temel, fizikselMod: 'bilinmeyen' }), null);
  assert.equal(pencereKonumKaydiHesapla({ ...temel, normalSinirlar: { x: 681, y: 129, width: 560, height: 780 } }), null, 'hedefte kaldı (2 piksel tolerans)');
  assert.equal(pencereKonumKaydiHesapla({ ...temel, mevcut: { hizli: { x: 300, y: 120 } } }), null, 'aynı konum tekrar yazılmaz');
  assert.equal(pencereKonumKaydiHesapla({ ...temel, normalSinirlar: { x: NaN, y: 1 } }), null);
  assert.equal(pencereKonumKaydiHesapla({ ...temel, normalSinirlar: null }), null);
});

test('pencereKonumKaydiHesapla: diğer modun kaydı korunur; hedef başka moddaysa taşıma sayılır; bozuk mevcut yuva atılır', () => {
  const temel = { konumModu: 'hatirla', fizikselMod: 'genis', normalSinirlar: { x: -900, y: 40, width: 1280, height: 820 }, hedef: { mod: 'hizli', x: -900, y: 40 }, mevcut: { hizli: { x: 5, y: 6 }, genis: { x: 'a', y: 1 } } };
  assert.deepEqual(pencereKonumKaydiHesapla(temel), { hizli: { x: 5, y: 6 }, genis: { x: -900, y: 40 } });
  assert.equal(pencereKonumKaydiHesapla({ ...temel, hedef: null }) !== null, true);
});

test('opaklikOrani: 50..100 yüzde -> oran; aralık dışı ve sayı olmayan tam opak', () => {
  assert.equal(opaklikOrani(100), 1);
  assert.equal(opaklikOrani(75), 0.75);
  assert.equal(opaklikOrani(50), 0.5);
  assert.equal(opaklikOrani(74.6), 0.75, 'yuvarlanır');
  for (const kotu of [49, 101, 0, -5, NaN, Infinity, '80', null, undefined]) assert.equal(opaklikOrani(kotu), 1, String(kotu));
});
