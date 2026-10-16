'use strict';

/**
 * Ayarlar'da arama (o-26): src/lib/ayar-arama.js, GERÇEK src/ayarlar.html ağacı üzerinde (test/mini-dom.js). Tarayıcı yok; görünürlük
 * `arama-gizli` sınıfı ve `details.open` ile sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { htmlAgaci } = require('./mini-dom');
const { katlaDizi } = require('../src/lib/arama');
const Arama = require('../src/lib/ayar-arama');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
const yeniSayfa = () => {
  const belge = htmlAgaci(HTML);
  return { belge, arama: Arama.olustur({ belge, katla: katlaDizi }) };
};
const gizliMi = (oge) => oge.classList.contains(Arama.GIZLI_SINIF);
const kimlikli = (belge, kimlik) => belge.getElementById(kimlik);
const gorunenBolumler = (belge) => belge.querySelectorAll('.bolum').filter((b) => !gizliMi(b)).map((b) => b.id);
const grupOgesi = (belge, girdiKimligi) => kimlikli(belge, girdiKimligi).closest('.form-grubu');

test('sorguSozcukleri / eslesirMi: Türkçe katlama, VE mantığı, alt dizge; boş sorgu eşleşmez', () => {
  const katla = Arama.katlamaOlustur(katlaDizi);
  assert.deepEqual(Arama.sorguSozcukleri('  Işık   ÇALIŞMA ', katla), ['isik', 'calisma']);
  assert.deepEqual(Arama.sorguSozcukleri('', katla), []);
  assert.deepEqual(Arama.sorguSozcukleri(null, katla), []);
  assert.equal(Arama.sorguSozcukleri('x'.repeat(500), katla)[0].length, Arama.EN_COK_SORGU);
  const metin = katla('Pencere boyutu: Hızlı (dar) ya da Geniş');
  assert.equal(Arama.eslesirMi(['pencere', 'genis'], metin), true);
  assert.equal(Arama.eslesirMi(['pencere', 'yok'], metin), false);
  assert.equal(Arama.eslesirMi(['boyut'], metin), true, 'alt dizge');
  assert.equal(Arama.eslesirMi([], metin), false);
  assert.equal(Arama.eslesirMi(['hizli'], metin), true, 'ı -> i katlaması');
});

test('sayfa yapısı: her ayar kümesi bir bölümün içindedir; arama kutusu, durum satırı ve temizle düğmesi HTML\'de var', () => {
  const belge = htmlAgaci(HTML);
  const bolumler = belge.querySelectorAll('.bolum');
  assert.ok(bolumler.length >= 9, 'bölümler bulundu');
  for (const k of belge.querySelectorAll('.form-grubu')) assert.ok(k.closest('.bolum'), 'form kümesi bir bölümde');
  for (const kimlik of ['ayarAra', 'ayarAramaDurum', 'btnAyarAraTemizle']) assert.ok(belge.getElementById(kimlik), `#${kimlik} yok`);
  assert.equal(belge.getElementById('ayarAra').tagName, 'INPUT');
  assert.match(HTML, /<script src="lib\/ayar-arama\.js"><\/script>/);
  assert.ok(HTML.indexOf('lib/arama.js') < HTML.indexOf('lib/ayar-arama.js') && HTML.indexOf('lib/ayar-arama.js') < HTML.indexOf('src="ayarlar.js"'), 'betik sırası: arama.js, ayar-arama.js, ayarlar.js');
  assert.match(HTML, /\.arama-gizli\s*\{\s*display:\s*none\s*!important/, 'gizleme sınıfı CSS\'te tanımlı');
});

test('arama: ayar etiketine göre süzer; yalnız eşleşen ayar kümesi kalır, kapalı (details) bölüm açılır, diğer bölümler gizlenir', () => {
  const { belge, arama } = yeniSayfa();
  const sonuc = arama.uygula('tepsi simgesine');
  assert.equal(sonuc.aktif, true);
  assert.equal(sonuc.bolumSayisi, 1);
  assert.deepEqual(gorunenBolumler(belge), ['bolumPencere']);
  assert.equal(kimlikli(belge, 'bolumPencere').open, true, 'katlanmış bölüm açıldı');
  assert.equal(gizliMi(grupOgesi(belge, 'tepsiSolTik')), false);
  assert.equal(gizliMi(grupOgesi(belge, 'pencereBoyutu')), true, 'eşleşmeyen ayar kümesi gizli');
  assert.equal(gizliMi(grupOgesi(belge, 'anaPanoyaDonDk')), true);
  assert.equal(sonuc.ilk, grupOgesi(belge, 'tepsiSolTik'));
  assert.equal(gizliMi(belge.querySelector('.grup-baslik')), false, '"Diğer ayarlar" başlığı görünür');
});

test('arama: yardım metnine ve seçenek adına göre de eşleşir (Türkçe harf katlamasıyla)', () => {
  const { belge, arama } = yeniSayfa();
  arama.uygula('ISIK'); // "ışık" geçen metinler
  assert.ok(gorunenBolumler(belge).length >= 1);
  arama.uygula('Mica'); // Görünüm'de yalnız <option> metni; Pencere bölümünün opaklık açıklaması da Mica'yı anar
  assert.deepEqual(gorunenBolumler(belge), ['bolumGorunum', 'bolumPencere']);
  assert.equal(gizliMi(grupOgesi(belge, 'yeniPencereMalzemesi')), false);
  assert.equal(gizliMi(grupOgesi(belge, 'temaZorla')), true);
  arama.uygula('akrilik');
  assert.equal(gizliMi(grupOgesi(belge, 'yeniPencereMalzemesi')), false);
  arama.uygula('sadece yardim metninde olmayan');
  assert.deepEqual(gorunenBolumler(belge), []);
});

test('arama: bölüm başlığı ya da açıklaması eşleşirse bölümün TÜM ayarları görünür; başlık sözcüğü ayar sözcüğüyle birlikte yazılabilir', () => {
  const { belge, arama } = yeniSayfa();
  arama.uygula('geri bildirim'); // Bildirim merkezi bölümünün ipucu da "Geri bildirim bölümü"nü anar
  assert.deepEqual(gorunenBolumler(belge), ['bolumGeriBildirim', 'bolumBildirimler']);
  assert.equal(gizliMi(grupOgesi(belge, 'koseBildirimi')), false);
  assert.equal(gizliMi(grupOgesi(belge, 'bipSesi')), false);
  arama.uygula('görünüm language'); // "Görünüm" bölüm başlığı + yalnız dil ayarında geçen sözcük
  assert.equal(gizliMi(grupOgesi(belge, 'dilSecimi')), false);
  assert.equal(gizliMi(grupOgesi(belge, 'vurguRengi')), true);
  assert.deepEqual(gorunenBolumler(belge), ['bolumGorunum']);
  arama.uygula('görünüm tema'); // sözcükler bölüm açıklamasında da geçer: bölüm düzeyinde eşleşme, tüm ayarlar görünür
  assert.equal(gizliMi(grupOgesi(belge, 'temaZorla')), false);
  assert.equal(gizliMi(grupOgesi(belge, 'vurguRengi')), false);
});

test('arama: sorgu silinince sayfa AYNEN eski haline döner (gizlemeler kalkar, açık/kapalı bölümler arama öncesine döner)', () => {
  const { belge, arama } = yeniSayfa();
  const detaylar = belge.querySelectorAll('details.bolum');
  assert.ok(detaylar.length >= 4);
  detaylar[1].open = true; // kullanıcı bir bölümü elle açmış
  const onceki = detaylar.map((d) => d.open);
  arama.uygula('bip');
  arama.uygula('bip sesi');
  assert.equal(kimlikli(belge, 'bolumGeriBildirim').open, true);
  assert.ok(belge.querySelectorAll('.bolum').some(gizliMi));
  const sonuc = arama.uygula('   ');
  assert.deepEqual(sonuc, { aktif: false, bolumSayisi: 0, ilk: null });
  for (const sinif of ['.bolum', '.form-grubu', '.grup-baslik']) {
    for (const oge of belge.querySelectorAll(sinif)) assert.equal(gizliMi(oge), false, `${sinif} hâlâ gizli`);
  }
  assert.deepEqual(detaylar.map((d) => d.open), onceki, 'açık/kapalı durum arama öncesine döndü');
  arama.temizle(); // ikinci temizlik zararsız
  assert.deepEqual(detaylar.map((d) => d.open), onceki);
});

test('arama: sayfanın kendi satır içi stiline (display) dokunmaz; yalnız sınıf ve open değişir', () => {
  const { belge, arama } = yeniSayfa();
  const uyari = kimlikli(belge, 'anahtarReddedildiUyari');
  const oncekiStil = uyari.getAttribute('style');
  arama.uygula('anahtar');
  arama.uygula('bip');
  arama.temizle();
  assert.equal(uyari.getAttribute('style'), oncekiStil);
  assert.equal(kimlikli(belge, 'btnAnahtarSil').getAttribute('style'), 'display: none;');
});

test('arama: eşleşme yoksa hiçbir bölüm görünmez ve "Diğer ayarlar" başlığı da gizlenir; ardışık yazışta durum sızmaz', () => {
  const { belge, arama } = yeniSayfa();
  const sonuc = arama.uygula('qwxzy');
  assert.equal(sonuc.aktif, true);
  assert.equal(sonuc.bolumSayisi, 0);
  assert.equal(sonuc.ilk, null);
  assert.deepEqual(gorunenBolumler(belge), []);
  assert.equal(gizliMi(belge.querySelector('.grup-baslik')), true);
  arama.uygula('vurgu rengi');
  assert.deepEqual(gorunenBolumler(belge), ['bolumGorunum']);
  assert.equal(gizliMi(belge.querySelector('.grup-baslik')), true, 'katlanır bölüm eşleşmedikçe "Diğer ayarlar" gizli');
  arama.uygula('kısayol');
  assert.ok(gorunenBolumler(belge).includes('bolumPencere'), 'açıklamasında kısayol geçen katlanır bölüm');
  assert.equal(gizliMi(belge.querySelector('.grup-baslik')), false);
  arama.uygula('qwxzy');
  arama.uygula('');
  assert.deepEqual(gorunenBolumler(belge).length, belge.querySelectorAll('.bolum').length);
});

test('arama: kurulum listesi ve ayar dışı alanlar (üst şerit, kaydet çubuğu) aramadan etkilenmez', () => {
  const { belge, arama } = yeniSayfa();
  arama.uygula('qwxzy');
  for (const kimlik of ['kurulumListesi', 'ustSerit', 'kaydetCubugu', 'btnAyarlariKaydet']) assert.equal(gizliMi(kimlikli(belge, kimlik)), false, kimlik);
});
