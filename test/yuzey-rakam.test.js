'use strict';

/**
 * Hızlı panelin 2.0 hareketleri (src/yuzey-sayfa.js): dönen rakamlar ve ışık seviyesi dolgusu.
 * Sahte DOM'a bu dosyada yalnız hareket için gerekenler eklenir (üst öğe bağı, querySelectorAll, animate, createTextNode, hasAttribute);
 * gerçek tarayıcı, Electron ya da pencere YOK. Görsel sonuç (CSS) burada denenmez.
 *  - dönen rakamlar: animasyon sürerken yeniden çizim hedef metni okur ("21" -> "22" iken "212" değil); eşleşme DOM sırasına değil karoya bakar;
 *  - ışık dolgusu: yeni gösterimde eski seviyeden yayla kaymaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { SahteOge, karo, modelYap, sayfayiKur, akit } = require('./yuzey-kartlar-sahte');

const asilEkle = SahteOge.prototype.appendChild;
SahteOge.prototype.appendChild = function (cocuk) {
  cocuk.ustOge = this;
  return asilEkle.call(this, cocuk);
};
Object.defineProperty(SahteOge.prototype, 'parentNode', { get() { return this.ustOge || null; } });
SahteOge.prototype.animate = function (kareler, secenek) {
  (this.animasyonlar ??= []).push({ kareler, secenek });
  return {};
};

const RULO_SINIFLARI = ['karo-durum', 'kart-deger', 'kart-durum', 'sensor-deger', 'serit-deger', 'saat-deger', 'hava-sicaklik', 'bilgi-deger', 'istatistik-deger'];

/** Hareket açık sayfa: <html data-hareket> yok, ağaç gezintisi ve animasyon desteği var. */
async function hareketliSayfa(model) {
  const sayfa = sayfayiKur({ model });
  const belge = sayfa.sandbox.document;
  belge.documentElement.hasAttribute = (ad) => Object.hasOwn(belge.documentElement.nitelikler, ad);
  belge.createTextNode = (metin) => {
    const oge = new SahteOge('#text');
    oge.textContent = metin;
    return oge;
  };
  const icerik = sayfa.oge('icerik');
  icerik.querySelectorAll = (secici) => {
    const siniflar = secici.split(',').map((s) => s.trim().replace(/^\./, ''));
    assert.deepEqual(siniflar, RULO_SINIFLARI);
    return icerik.bul((o) => o.className.split(' ').some((c) => siniflar.includes(c)));
  };
  await akit();
  sayfa.goster('panel');
  return sayfa;
}

const durumOgeleri = (sayfa) => sayfa.bul((o) => o.sinifVar('karo-durum'));
const hucreler = (oge) => oge.bul((o) => o.sinifVar('rulo-hucre')).map((h) => [h.children[0].textContent, h.children[1].textContent]);
const priz = (id, yuzde) => karo(id, id, { durum: 'acik', yuzde });
const modelDe = (...karolar) => modelYap(...karolar);

test('dönen rakam: yuvarlanma sürerken gelen yeni çizim hedef metni okur ("22" iken "212" değil); yalnız değişen hane yuvarlanır', async () => {
  const sayfa = await hareketliSayfa(modelDe(priz('switch.a', 21)));
  assert.equal(durumOgeleri(sayfa)[0].textContent, '%21');
  sayfa.durum(modelDe(priz('switch.a', 22)));
  assert.deepEqual(hucreler(durumOgeleri(sayfa)[0]), [['1', '2']], '21 -> 22: yalnız son hane');
  assert.equal(durumOgeleri(sayfa)[0].textContent, '%212', 'yuvarlanma sürerken öğe giden + gelen haneyi birlikte taşır');
  sayfa.zaman.ilerle(100); // 350 ms dolmadı: yeni model geldi
  sayfa.durum(modelDe(priz('switch.a', 23)));
  assert.deepEqual(hucreler(durumOgeleri(sayfa)[0]), [['2', '3']], '22 -> 23 (hedef metin "%22" okundu)');
  sayfa.zaman.ilerle(1000);
  assert.equal(durumOgeleri(sayfa)[0].textContent, '%23', 'yuvarlanma bitince düz metne döner');
});

test('dönen rakam: aynı değerli yeniden çizim yuvarlanmayı keser ve öğe hedef metinle düz yazılır', async () => {
  const sayfa = await hareketliSayfa(modelDe(priz('switch.a', 21)));
  sayfa.durum(modelDe(priz('switch.a', 22)));
  sayfa.zaman.ilerle(100);
  sayfa.durum({ ...modelDe(priz('switch.a', 22)), ust: { ...modelDe().ust, medyaCaliyor: true } }); // başka bir alan değişti: yeniden çizim, aynı değer
  assert.deepEqual(hucreler(durumOgeleri(sayfa)[0]), []);
  assert.equal(durumOgeleri(sayfa)[0].textContent, '%22');
});

test('dönen rakam: eşleşme DOM sırasına değil karoya bakar; bir karo çıkınca kalan karo başka karonun eski değeriyle karşılaştırılmaz', async () => {
  const sayfa = await hareketliSayfa(modelDe(priz('switch.a', 21), priz('switch.b', 35)));
  assert.deepEqual(durumOgeleri(sayfa).map((o) => o.textContent), ['%21', '%35']);
  sayfa.durum(modelDe(priz('switch.b', 35))); // a çıktı: b artık birinci sırada
  const kalan = durumOgeleri(sayfa);
  assert.equal(kalan.length, 1);
  assert.deepEqual(hucreler(kalan[0]), [], 'b değişmedi: yuvarlanma yok');
  assert.equal(kalan[0].textContent, '%35');
  sayfa.durum(modelDe(priz('switch.b', 36)));
  assert.deepEqual(hucreler(durumOgeleri(sayfa)[0]), [['5', '6']], 'gerçekten değişen karo yine yuvarlanır');
});

test('ışık dolgusu: palette değişen seviye, panele dönüşte eski seviyeden yayla kaymaz; panelde değişim yine yayla kayar', async () => {
  const isik = (yuzde) => karo('light.a', 'Lamba', { alan: 'light', durum: 'acik', yuzde, parlaklikKontrol: true });
  const sayfa = await hareketliSayfa(modelDe(isik(40)));
  const dolgular = () => sayfa.bul((o) => o.sinifVar('karo-dolgu'));
  assert.equal(dolgular()[0].animasyonlar, undefined, 'ilk çizimde eski değer yok');
  sayfa.durum(modelDe(isik(60)));
  assert.equal(dolgular()[0].animasyonlar.length, 1, 'panelde değişim yayla kayar');
  assert.equal(JSON.stringify(dolgular()[0].animasyonlar[0].kareler), JSON.stringify([{ transform: 'scaleX(0.4)' }, { transform: 'scaleX(0.6)' }]));
  sayfa.goster('palet');
  sayfa.durum(modelDe(isik(90))); // palet açıkken seviye değişti: panel dolgusu çizilmedi
  sayfa.goster('panel');
  assert.equal(dolgular()[0].animasyonlar, undefined, 'yeni gösterim eski (0,6) değerinden 0,9\'a kaymaz');
  sayfa.durum(modelDe(isik(50)));
  assert.equal(dolgular()[0].animasyonlar.length, 1, 'gösterimden sonraki değişim yine yayla kayar');
});

test('hareketi azalt (ayar): görünüm modeli ilk çizimden ÖNCE <html data-hareket> olarak yazılır (görünüm betiği sayfa betiğinden sonra yüklenir)', async () => {
  const sayfa = sayfayiKur({ model: modelDe(priz('switch.a', 21)), temaRenk: true, gorunum: { hareketiAzalt: true } });
  const belge = sayfa.sandbox.document;
  let ilkCizimde = 'olculmedi';
  const asil = belge.createElement;
  belge.createElement = (...bag) => {
    if (ilkCizimde === 'olculmedi') ilkCizimde = belge.documentElement.nitelikler['data-hareket'] ?? null;
    return asil(...bag);
  };
  await akit();
  assert.equal(ilkCizimde, 'azalt', 'ilk karo oluşturulurken öznitelik hazır');
  assert.equal(belge.documentElement.nitelikler['data-hareket'], 'azalt');
});

test('hareketi azalt (ayar): öznitelik varken dönen rakam ve ışık dolgusu oynamaz', async () => {
  const isik = (yuzde) => karo('light.a', 'Lamba', { alan: 'light', durum: 'acik', yuzde, parlaklikKontrol: true });
  const sayfa = sayfayiKur({ model: modelDe(isik(40), priz('switch.a', 21)), temaRenk: true, gorunum: { hareketiAzalt: true } });
  const belge = sayfa.sandbox.document;
  belge.documentElement.hasAttribute = (ad) => Object.hasOwn(belge.documentElement.nitelikler, ad);
  const icerik = sayfa.oge('icerik');
  icerik.querySelectorAll = () => icerik.bul((o) => o.sinifVar('karo-durum'));
  await akit();
  sayfa.goster('panel');
  sayfa.durum(modelDe(isik(60), priz('switch.a', 22)));
  assert.deepEqual(durumOgeleri(sayfa).map((o) => hucreler(o)), [[], []], 'rakamlar yuvarlanmaz');
  assert.equal(sayfa.bul((o) => o.sinifVar('karo-dolgu'))[0].animasyonlar, undefined, 'dolgu yayla kaymaz');
});
