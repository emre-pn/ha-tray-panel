'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  katlaKarakter,
  katlaDizi,
  altDiziEsles,
  eslestir,
  ara,
  sorguCoz,
  bosSorguListesi,
  paletSorgusu,
  ALAKA_ORANI,
  PARLAKLIK_YAKINLIGI,
  SON_SAYISI,
} = require('../src/lib/arama');

const kat = (m) => katlaDizi(m).join('');

test('Türkçe harf katlama: Işık, IŞIK, işık, İSİK hepsi "isik"; ç ğ ö ş ü ı karşılıklarına iner', () => {
  for (const m of ['Işık', 'IŞIK', 'işık', 'İŞİK', 'isik', 'ışık']) assert.equal(kat(m), 'isik', m);
  assert.equal(kat('Çalışma'), 'calisma');
  assert.equal(kat('Gece lambası'), 'gece lambasi');
  assert.equal(kat('Ağız Öğüt'), 'agiz ogut');
});

test('katlama kod noktası başına TEK karakter üretir (vurgu konumu kaymaz): vekil çift, ligatür, birleştirici işaret', () => {
  assert.equal(katlaKarakter('ﬁ'), 'f');
  assert.equal(katlaKarakter('😀'), '😀');
  assert.equal(katlaDizi('a😀b').length, 3);
  assert.equal(katlaDizi('ǆ').length, 1);
  assert.equal(katlaDizi('é').length, 1);
  assert.equal(katlaDizi('́').length, 1, 'tek başına birleştirici işaret de TEK karakter kalır');
  for (const m of ['Işık', 'Ş', 'İ', 'ı', 'ß', 'ø']) assert.equal(katlaDizi(m).length, Array.from(m).length, m);
  assert.deepEqual(katlaDizi(null), []);
});

test('altDiziEsles: harfler sırayla geçmeli; yoksa null', () => {
  assert.deepEqual(altDiziEsles(katlaDizi('flm'), katlaDizi('Film')), [0, 2, 3]);
  assert.deepEqual(altDiziEsles(katlaDizi('gl'), katlaDizi('Gece lambası')), [0, 5]);
  assert.equal(altDiziEsles(katlaDizi('xyz'), katlaDizi('Film')), null);
  assert.equal(altDiziEsles(katlaDizi('mlf'), katlaDizi('Film')), null, 'sıra önemli');
});

test('eslestir: ardışık eşleşme konumları, katlamalı; boş sorgu her şeyle eşleşir; eşleşmeyen null', () => {
  assert.deepEqual(eslestir('isik', 'Işık').konumlar, [0, 1, 2, 3]);
  assert.deepEqual(eslestir('lam', 'Gece lambası').konumlar, [5, 6, 7]);
  assert.deepEqual(eslestir('flm', 'Film').konumlar, [0, 2, 3]);
  assert.deepEqual(eslestir('', 'Film'), { puan: 0, konumlar: [] });
  assert.equal(eslestir('xyz', 'Film'), null);
});

test('eslestir: her sözcük eşleşmeli (VE); sözcük başı ve ön ek eşleşmesi daha yüksek puan alır', () => {
  assert.ok(eslestir('gece lam', 'Gece lambası'));
  assert.equal(eslestir('gece xyz', 'Gece lambası'), null);
  assert.ok(eslestir('film', 'Film').puan > eslestir('film', 'Eski film izle').puan, 'ön ek > sözcük başı');
  assert.ok(eslestir('lam', 'Gece lambası').puan > eslestir('lam', 'Aşırı alamet').puan, 'sözcük başı > ortada');
});

const OGELER = [
  { etiket: 'LED şerit', grupEtiketi: 'Işık', parlaklikKontrol: true },
  { etiket: 'Ampul', grupEtiketi: 'Işık', parlaklikKontrol: false },
  { etiket: 'Film', grupEtiketi: 'Sahne' },
  { etiket: 'Gece lambası', grupEtiketi: 'Sahne' },
  { etiket: 'Çalışma', grupEtiketi: 'Sahne' },
];

test('ara: "isik" grup adı üzerinden ışıkları bulur; konumlar yalnız etikete sığar', () => {
  const s = ara('isik', OGELER);
  assert.deepEqual(s.map((r) => r.oge.etiket), ['LED şerit', 'Ampul']);
  for (const r of s) assert.ok(r.konumlar.every((k) => k < Array.from(r.oge.etiket).length));
});

test('ara: "film" ilk sırada, "gl" Gece lambası\'nı bulur, "xyz" hiçbir şey; boş sorgu hepsini özgün sırayla döndürür', () => {
  assert.equal(ara('film', OGELER)[0].oge.etiket, 'Film');
  assert.deepEqual(ara('gl', OGELER).map((r) => r.oge.etiket), ['Gece lambası']);
  assert.deepEqual(ara('xyz', OGELER), []);
  assert.deepEqual(ara('', OGELER).map((r) => r.oge.etiket), OGELER.map((o) => o.etiket));
  assert.deepEqual(ara('CALISMA', OGELER).map((r) => r.oge.etiket), ['Çalışma']);
});

test('ara: eşit puanda parlaklık kontrollü öğe öne geçer', () => {
  const ogeler = [
    { etiket: 'Ampul', grupEtiketi: 'Işık', parlaklikKontrol: false },
    { etiket: 'LED şerit', grupEtiketi: 'Işık', parlaklikKontrol: true },
  ];
  // "isik" yalnız grup adında geçer; iki öğe de benzer puan alır, kısa etiketli öne geçer ya da eşitlik kırılır.
  const sonuc = ara('isik', ogeler);
  assert.equal(sonuc.length, 2);
  assert.equal(sonuc[0].oge.etiket, 'LED şerit');
});

test('sorguCoz: sondaki 1-100 tam sayı parlaklıktır; 101, "4x", ondalık, yalnız sayı metin kalır', () => {
  assert.deepEqual(sorguCoz('ışık 40'), { metin: 'ışık', parlaklik: 40 });
  assert.deepEqual(sorguCoz('  led şerit   100 '), { metin: 'led şerit', parlaklik: 100 });
  assert.deepEqual(sorguCoz('ışık 1'), { metin: 'ışık', parlaklik: 1 });
  for (const q of ['ışık 101', 'ışık 4x', 'ışık 40.5', '40', 'ışık -5', 'ışık 040x', 'ışık 1000', '%40', '40%', 'ışık 150%', 'ışık %101']) {
    assert.deepEqual(sorguCoz(q), { metin: q.trim(), parlaklik: null }, q);
  }
  assert.deepEqual(sorguCoz(undefined), { metin: '', parlaklik: null });
});

test('sorguCoz (h-23, k-08): "%40", "40%", "% 40", "40 %" aynı parlaklıktır; sondaki 0 "kapat" demektir', () => {
  for (const q of ['ışık %40', 'ışık 40%', 'ışık % 40', 'ışık 40 %', '  ışık   %40  ']) {
    assert.deepEqual(sorguCoz(q), { metin: 'ışık', parlaklik: 40 }, q);
  }
  assert.deepEqual(sorguCoz('led şerit 100%'), { metin: 'led şerit', parlaklik: 100 });
  for (const q of ['ışık 0', 'ışık %0', 'ışık 0%']) {
    assert.deepEqual(sorguCoz(q), { metin: 'ışık', parlaklik: null, kapat: true }, q);
  }
  assert.equal('kapat' in sorguCoz('ışık 40'), false, 'eski şekil: kapat yalnız doğruyken yazılır');
});

test('paletSorgusu: "ışık 40" yalnız en iyi eşleşme parlaklık kontrollü ışıksa parlaklık olur', () => {
  const s = paletSorgusu('ışık 40', OGELER);
  assert.equal(s.parlaklik, 40);
  assert.equal(s.sonuclar[0].oge.etiket, 'LED şerit');

  // 1. sıradaki aday parlaklık desteklemiyorsa ama sonraki destekliyorsa, parlaklık destekleyen 1. sıraya çekilir.
  const karisik = [
    { etiket: 'Işık Açma', grupEtiketi: 'Işık', parlaklikKontrol: false },
    { etiket: 'Işık Dimmer', grupEtiketi: 'Işık', parlaklikKontrol: true },
  ];
  const sKarisik = paletSorgusu('ışık 50', karisik);
  assert.equal(sKarisik.parlaklik, 50);
  assert.equal(sKarisik.sonuclar[0].oge.etiket, 'Işık Dimmer');
  assert.equal(sKarisik.sonuclar[1].oge.etiket, 'Işık Açma');

  // Ampul (parlaklıksız) tek ışıksa sayı arama metnine döner; "ampul 40" eşleşmezse aday korunur, parlaklık null olur.
  const yalnizAmpul = paletSorgusu('ampul 40', [{ etiket: 'Ampul', grupEtiketi: 'Işık', parlaklikKontrol: false }]);
  assert.equal(yalnizAmpul.parlaklik, null);
  assert.equal(yalnizAmpul.sonuclar.length, 1);
  assert.equal(yalnizAmpul.sonuclar[0].oge.etiket, 'Ampul');

  // Sahne için de sayı parlaklık olmaz; aday korunur.
  const sahne = paletSorgusu('film 40', OGELER);
  assert.equal(sahne.parlaklik, null);
  assert.equal(sahne.sonuclar[0].oge.etiket, 'Film');

  assert.equal(paletSorgusu('film', OGELER).parlaklik, null);
  // Aralık dışı: "ışık 101" metin; hiçbir şeyle eşleşmez.
  const dis = paletSorgusu('ışık 101', OGELER);
  assert.equal(dis.parlaklik, null);
  assert.deepEqual(dis.sonuclar, []);
});

// Gerçeğe yakın palet envanteri: medya düğmeleri, ışıklar, sahneler.
const ENVANTER = [
  { etiket: 'LED şerit', grupEtiketi: 'Işık', parlaklikKontrol: true },
  { etiket: 'Ampul', grupEtiketi: 'Işık', parlaklikKontrol: false },
  { etiket: 'Fırın lambası', grupEtiketi: 'Işık', parlaklikKontrol: true },
  { etiket: 'Film', grupEtiketi: 'Sahne', parlaklikKontrol: false },
  { etiket: 'Ses +', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'Ses −', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'Hoparlör', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'Kulaklık', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'Oynat/Duraklat', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'Sonraki parça', grupEtiketi: 'Medya', parlaklikKontrol: false },
  { etiket: 'PC kapat', grupEtiketi: 'PC', parlaklikKontrol: false },
];
const etiketleri = (sonuclar) => sonuclar.map((r) => r.oge.etiket);

test('h-02: "ses 40" LED şeridi %40 yapmaz (zayıf eşleşen parlaklıklı aday öne alınmaz); "led 40" çalışmaya devam eder', () => {
  const ses = paletSorgusu('ses 40', ENVANTER);
  assert.equal(ses.parlaklik, null);
  assert.deepEqual(etiketleri(ses.sonuclar), ['Ses +', 'Ses −']);
  assert.ok(ses.sonuclar.every((r) => r.parlaklik === null), 'hiçbir satıra seviye yazılmaz');

  const film = paletSorgusu('film 40', ENVANTER);
  assert.equal(film.parlaklik, null, '"film 40" Fırın lambasını kısmaz');
  assert.equal(film.sonuclar[0].oge.etiket, 'Film');

  const led = paletSorgusu('led 40', ENVANTER);
  assert.equal(led.parlaklik, 40);
  assert.equal(led.sonuclar[0].oge.etiket, 'LED şerit');
});

test('h-02: orta uzaklıktaki parlaklıklı aday (puan en iyinin %80\'inden az) öne alınmaz ama seçilirse seviyesini taşır', () => {
  const ogeler = [
    { etiket: 'Ses +', grupEtiketi: 'Medya', parlaklikKontrol: false },
    { etiket: 'Oda sesli lamba', grupEtiketi: 'Işık', parlaklikKontrol: true },
  ];
  const s = paletSorgusu('ses 40', ogeler);
  assert.deepEqual(etiketleri(s.sonuclar), ['Ses +', 'Oda sesli lamba']);
  assert.ok(s.sonuclar[1].puan < s.sonuclar[0].puan * PARLAKLIK_YAKINLIGI);
  assert.equal(s.parlaklik, null, 'üst düzey alan ilk satırı anlatır');
  assert.equal(s.parlaklikDesteklenmiyor, true);
  assert.equal(s.sonuclar[1].parlaklik, 40);
  assert.equal(s.sonuclar[1].parlaklikDesteklenmiyor, false);

  // Eşit puanda ise (aynı sözcük başı) parlaklıklı aday öne geçer.
  const esit = paletSorgusu('ses 40', [ogeler[0], { etiket: 'Sesli lamba', grupEtiketi: 'Işık', parlaklikKontrol: true }]);
  assert.equal(esit.sonuclar[0].oge.etiket, 'Sesli lamba');
  assert.equal(esit.parlaklik, 40);
});

test('h-13: parlaklık desteklemeyen öğede sayı sessizce atılmaz; satır "desteklenmiyor" işaretlenir (şekil geriye uyumlu)', () => {
  const s = paletSorgusu('ampul 40', ENVANTER);
  assert.deepEqual(etiketleri(s.sonuclar), ['Ampul']);
  assert.equal(s.parlaklik, null);
  assert.equal(s.kapat, false);
  assert.equal(s.parlaklikDesteklenmiyor, true);
  assert.equal(s.sonuclar[0].parlaklikDesteklenmiyor, true);
  assert.equal(s.sonuclar[0].parlaklik, null);
  // Eski şekil korunur: oge/puan/konumlar hâlâ var.
  assert.ok(Array.isArray(s.sonuclar[0].konumlar) && typeof s.sonuclar[0].puan === 'number');

  // Sayı silinince satır normaldir.
  const duz = paletSorgusu('ampul', ENVANTER);
  assert.equal(duz.parlaklikDesteklenmiyor, false);
  assert.equal(duz.sonuclar[0].parlaklikDesteklenmiyor, undefined);

  // Sahne ve yıkıcı eylem de aynı: "pc kapat 50" PC kapat satırını "desteklenmiyor" yapar.
  assert.equal(paletSorgusu('film 40', ENVANTER).sonuclar[0].parlaklikDesteklenmiyor, true);
  assert.equal(paletSorgusu('pc kapat 50', ENVANTER).sonuclar[0].parlaklikDesteklenmiyor, true);

  // Karışık listede (ışık 50) kısılamayan satırlar işaretlenir, kısılabilenler seviyeyi taşır.
  const karisik = paletSorgusu('ışık 50', ENVANTER);
  assert.equal(karisik.parlaklik, 50);
  for (const r of karisik.sonuclar) {
    if (r.oge.parlaklikKontrol) assert.deepEqual([r.parlaklik, r.parlaklikDesteklenmiyor], [50, false], r.oge.etiket);
    else assert.deepEqual([r.parlaklik, r.parlaklikDesteklenmiyor], [null, true], r.oge.etiket);
  }
});

test('h-13: sayı bir adın parçası olarak eşleşiyorsa ("oda 2" -> "Oda 2 Lambası") ad parçası kalır, desteklenmiyor denmez', () => {
  const ogeler = [{ etiket: 'Oda 2 Lambası', grupEtiketi: 'Sahne', parlaklikKontrol: false }];
  const s = paletSorgusu('oda 2', ogeler);
  assert.equal(s.parlaklikDesteklenmiyor, false);
  assert.deepEqual(etiketleri(s.sonuclar), ['Oda 2 Lambası']);
  assert.equal(s.parlaklik, null);
  assert.deepEqual(paletSorgusu('yok yok 40', ENVANTER).sonuclar, []);
});

test('h-23: tam adı sorgu olan öğe varsa sondaki sayı ad parçasıdır ("salon 2" -> Salon 2 sahnesi, Salon ışığı %2 değil)', () => {
  const ogeler = [
    { etiket: 'Salon', grupEtiketi: 'Işık', parlaklikKontrol: true },
    { etiket: 'Salon 2', grupEtiketi: 'Sahne', parlaklikKontrol: false },
  ];
  const s = paletSorgusu('salon 2', ogeler);
  assert.equal(s.parlaklik, null);
  assert.equal(s.parlaklikDesteklenmiyor, false);
  assert.equal(s.sonuclar[0].oge.etiket, 'Salon 2');
  assert.equal(paletSorgusu('  SALON   2 ', ogeler).sonuclar[0].oge.etiket, 'Salon 2', 'katlama ve boşluk');
  // Tam ad olmayan sayı seviye kalır.
  const seviye = paletSorgusu('salon 30', ogeler);
  assert.equal(seviye.parlaklik, 30);
  assert.equal(seviye.sonuclar[0].oge.etiket, 'Salon');
});

test('h-23, k-08: "led %40" ve "led 40%" parlaklık; "led 0" kapat anlamına gelir (yalnız kısılabilir ışıkta)', () => {
  for (const q of ['led %40', 'led 40%']) {
    const s = paletSorgusu(q, ENVANTER);
    assert.equal(s.parlaklik, 40, q);
    assert.equal(s.sonuclar[0].oge.etiket, 'LED şerit', q);
  }
  const kapat = paletSorgusu('led 0', ENVANTER);
  assert.equal(kapat.kapat, true);
  assert.equal(kapat.parlaklik, null);
  assert.equal(kapat.parlaklikDesteklenmiyor, false);
  assert.equal(kapat.sonuclar[0].oge.etiket, 'LED şerit');
  assert.equal(kapat.sonuclar[0].kapat, true);
  // Kısılamayan öğede "0" kapat sayılmaz: satır desteklenmiyor olur, aç/kapat çalışmaz.
  const ampul = paletSorgusu('ampul 0', ENVANTER);
  assert.equal(ampul.kapat, false);
  assert.equal(ampul.parlaklikDesteklenmiyor, true);
});

test('k-07: en iyi puanın %25\'inin altındaki alakasız sonuçlar gösterilmez ("led" -> yalnız LED şerit)', () => {
  assert.deepEqual(etiketleri(ara('led', ENVANTER)), ['LED şerit']);
  assert.deepEqual(etiketleri(ara('ses', ENVANTER)), ['Ses +', 'Ses −']);
  assert.deepEqual(etiketleri(ara('pc', ENVANTER)), ['PC kapat']);
  assert.deepEqual(etiketleri(paletSorgusu('led', ENVANTER).sonuclar), ['LED şerit']);
  // Hiç ardışık eşleşme yoksa kısaltma yazımı çalışır: "flm" -> Film (zayıf ama en iyi sonuçlar kalır).
  assert.equal(ara('flm', ENVANTER)[0].oge.etiket, 'Film');
  assert.deepEqual(etiketleri(ara('flm', [{ etiket: 'Film' }, { etiket: 'Ampul' }])), ['Film']);
  // Eşik kapatılabilir; sıralama değişmez.
  const hepsi = ara('led', ENVANTER, { alakaOrani: 0 });
  assert.ok(hepsi.length > 1);
  assert.equal(hepsi[0].oge.etiket, 'LED şerit');
  assert.equal(ALAKA_ORANI, 0.25);
  // Süzülen her sonuç eşiğin üstündedir.
  for (const q of ['a', 'ses', 'ışık', 'pa', 'k']) {
    const s = ara(q, ENVANTER);
    if (s.length > 0) for (const r of s) assert.ok(r.puan >= s[0].puan * ALAKA_ORANI, `${q}: ${r.oge.etiket}`);
  }
});

test('h-21: "Ses +" ve "Ses −" ayrışır: "+", "-", "arti", "eksi" yazımları doğru düğmeyi bulur', () => {
  const kim = (q) => etiketleri(ara(q, ENVANTER));
  assert.deepEqual(kim('ses +'), ['Ses +']);
  assert.deepEqual(kim('ses -'), ['Ses −'], 'ASCII tire eksi işaretini (U+2212) bulur');
  assert.deepEqual(kim('ses −'), ['Ses −']);
  assert.deepEqual(kim('ses arti'), ['Ses +']);
  assert.deepEqual(kim('ses eksi'), ['Ses −']);
  assert.deepEqual(kim('ses'), ['Ses +', 'Ses −']);
  assert.equal(katlaKarakter('−'), '-');
  assert.equal(katlaKarakter('–'), '-');
  assert.equal(katlaDizi('Ses −').length, 5, 'konum kayması yok: kod noktası başına tek karakter');
  // Sözcükte gerçekten "arti"/"eksi" geçiyorsa takma ad devreye girmeden normal eşleşir.
  assert.deepEqual(etiketleri(ara('arti', [{ etiket: 'Artı video', parlaklikKontrol: false }])), ['Artı video']);
  // Nesne özellikleri ("constructor") takma ad tablosuna sızmaz.
  assert.deepEqual(ara('constructor', ENVANTER), []);
  // Vurgu konumu özgün etikete denk gelir ("Ses −": 4. dizin).
  assert.deepEqual(ara('ses -', ENVANTER)[0].konumlar, [0, 1, 2, 4]);
});

test('dil: İngilizce etiketlerde de "+" / "−" sözcükle bulunur ("volume plus", "volume minus"); Türkçe takma adlar aynen çalışır', () => {
  const ingilizce = [
    { etiket: 'Volume +', parlaklikKontrol: false },
    { etiket: 'Volume −', parlaklikKontrol: false },
    { etiket: 'Mute', parlaklikKontrol: false },
  ];
  const kim = (q, ogeler = ingilizce) => etiketleri(ara(q, ogeler));
  assert.deepEqual(kim('volume plus'), ['Volume +']);
  assert.deepEqual(kim('volume minus'), ['Volume −']);
  assert.deepEqual(kim('volume +'), ['Volume +']);
  assert.deepEqual(kim('volume -'), ['Volume −']);
  assert.deepEqual(kim('volume'), ['Volume +', 'Volume −']);
  // Takma ad yalnız sözcük hedefte yoksa devreye girer: etikette gerçekten "plus" geçiyorsa normal eşleşir.
  assert.deepEqual(kim('plus', [{ etiket: 'Plus channel', parlaklikKontrol: false }]), ['Plus channel']);
  // Türkçe takma adlar İngilizce etiketlerde de, İngilizce takma adlar Türkçe etiketlerde de çalışır (arama dilden bağımsızdır).
  assert.deepEqual(kim('volume arti'), ['Volume +']);
  assert.deepEqual(kim('ses plus', ENVANTER), ['Ses +']);
  assert.deepEqual(kim('ses minus', ENVANTER), ['Ses −']);
});

test('k-08: eşit puanda son kullanılan öne geçer; aksi hâlde sıralama eskisi gibi', () => {
  const ogeler = [
    { etiket: 'Salon lambası', grupEtiketi: 'Işık', parlaklikKontrol: false },
    { etiket: 'Salon perde', grupEtiketi: 'Diğer', parlaklikKontrol: false },
    { etiket: 'Salon müzik', grupEtiketi: 'Medya', parlaklikKontrol: false },
  ];
  assert.deepEqual(etiketleri(ara('salon', ogeler)), ['Salon perde', 'Salon müzik', 'Salon lambası'], 'sonSira yok: kısa etiket, sonra özgün sıra');
  const son = ogeler.map((o, i) => ({ ...o, sonSira: i === 2 ? 0 : i === 0 ? 1 : -1 })); // -1 = hiç kullanılmadı
  assert.deepEqual(etiketleri(ara('salon', son)), ['Salon müzik', 'Salon lambası', 'Salon perde']);
  // Puan farkı sonSira'dan önce gelir: ön ek eşleşmesi, son kullanılan ama zayıf eşleşmeyi geçer.
  const farkli = [
    { etiket: 'Eski film izle', grupEtiketi: 'Sahne', sonSira: 0 },
    { etiket: 'Film', grupEtiketi: 'Sahne' },
  ];
  assert.equal(ara('film', farkli)[0].oge.etiket, 'Film');
});

test('k-08: seviye bütün kısılabilir eşleşmelere yazılır, sadece ilk satıra değil', () => {
  const ogeler = [
    { etiket: 'Tavan ışığı', grupEtiketi: 'Işık', parlaklikKontrol: true },
    { etiket: 'Masa ışığı', grupEtiketi: 'Işık', parlaklikKontrol: true },
    { etiket: 'Ampul', grupEtiketi: 'Işık', parlaklikKontrol: false },
  ];
  const s = paletSorgusu('ışık 70', ogeler);
  const kisilabilir = s.sonuclar.filter((r) => r.oge.parlaklikKontrol);
  assert.equal(kisilabilir.length, 2);
  for (const r of kisilabilir) assert.equal(r.parlaklik, 70, r.oge.etiket);
  assert.equal(s.sonuclar.find((r) => !r.oge.parlaklikKontrol).parlaklik, null);
  assert.equal(s.parlaklik, 70, 'üst düzey alan (eski arayüz) ilk satırı anlatır');
});

test('k-08: boş aramada son kullanılanların altında bütün favoriler gelir; yinelenen satır yok', () => {
  const ogeler = ENVANTER.map((o, i) => ({ ...o, sonSira: i === 3 ? 0 : i === 0 ? 1 : i === 5 ? 2 : -1 }));
  const b = paletSorgusu('', ogeler);
  assert.equal(b.parlaklik, null);
  assert.equal(b.kapat, false);
  assert.equal(b.parlaklikDesteklenmiyor, false);
  assert.equal(b.sonuclar.length, ENVANTER.length, 'her öğe tam bir kez');
  assert.deepEqual(etiketleri(b.sonuclar).slice(0, 3), ['Film', 'LED şerit', 'Ses −'], 'son kullanılanlar sonSira sırasıyla');
  assert.deepEqual(b.sonuclar.map((r) => r.bolum).slice(0, 4), ['son', 'son', 'son', 'favori']);
  assert.deepEqual(etiketleri(b.sonuclar).slice(3), ENVANTER.map((o) => o.etiket).filter((e) => !['Film', 'LED şerit', 'Ses −'].includes(e)), 'kalanlar özgün sırada');
  assert.equal(new Set(etiketleri(b.sonuclar)).size, ENVANTER.length);

  // En çok SON_SAYISI (5) kadar son kullanılan ayrılır; fazlası "favori" bölümüne düşer.
  const cok = ENVANTER.map((o, i) => ({ ...o, sonSira: i }));
  const c = bosSorguListesi(cok);
  assert.equal(c.filter((r) => r.bolum === 'son').length, SON_SAYISI);
  assert.equal(c.length, ENVANTER.length);

  // sonSira hiç yoksa: hepsi özgün sırada ve 'favori'.
  const duz = bosSorguListesi(ENVANTER);
  assert.deepEqual(etiketleri(duz), ENVANTER.map((o) => o.etiket));
  assert.ok(duz.every((r) => r.bolum === 'favori'));
  assert.deepEqual(bosSorguListesi(undefined), []);
});

test('arama modülü require kullanmaz (renderer\'da <script> ile de yüklenir)', () => {
  const kaynak = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'arama.js'), 'utf8');
  assert.ok(!/require\s*\(/.test(kaynak));
});
