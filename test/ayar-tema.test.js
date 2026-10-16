'use strict';

/**
 * Grup "tema" ayar alanları (o-25 metin boyutu / yüksek karşıtlık, o-29 panel teması, o-34 animasyonlar): gerçek AYAR_ALANLARI satırları,
 * ayar şemasından okuma, kayıt doğrulaması, dışa/içe aktarma ve Ayarlar özeti. Diğer grupların satırlarından bağımsızdır (adlara bakılır).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');
const { ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');
const { TR } = require('../src/lib/ceviri-varsayilan');

const TEMA_ADLARI = ['metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelArkaPlani', 'animasyonlar', 'animasyonGecisleri', 'havaEfekti', 'mevsimEfekti', 'hareketiAzalt'];
const VARSAYILANLAR = {
  metinOlcegi: 100,
  yuksekKarsitlik: false,
  panelTemasi: 'varsayilan',
  panelVurguRengi: '',
  panelArkaPlani: '',
  animasyonlar: false,
  animasyonGecisleri: true,
  havaEfekti: 'otomatik',
  mevsimEfekti: 'yok',
  hareketiAzalt: false,
};
const alan = (ad) => A.AYAR_ALANLARI.find((a) => a.ad === ad);
const kayit = (ek = {}) => ({ yerelAdres: 'http://192.168.1.10:8123', kisayol: 'Control+Alt+H', ...ek });

test('tablo: tema alanlarının hepsi kayıtlı, dondurulmuş ve beklenen tipte; ad çakışması yok', () => {
  const adlar = A.AYAR_ALANLARI.map((a) => a.ad);
  assert.equal(new Set(adlar).size, adlar.length, 'yinelenen alan adı yok');
  for (const ad of TEMA_ADLARI) {
    const a = alan(ad);
    assert.ok(a, `${ad} kayıtlı`);
    assert.ok(Object.isFrozen(a));
    assert.equal(a.surum, 6);
    assert.equal(a.aktarilir, true, `${ad} dışa aktarılır`);
    assert.equal(a.ozette, true, `${ad} Ayarlar özetine girer`);
  }
  assert.deepEqual(['metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'animasyonlar'].map((ad) => alan(ad).tip), ['sayi', 'mantiksal', 'metin', 'metin', 'mantiksal']);
});

test('varsayılanlar: kozmetik animasyonlar KAPALI, hareketi azaltma kapalı, metin %100, yüksek karşıtlık kapalı, tema varsayılan', () => {
  for (const [ad, deger] of Object.entries(VARSAYILANLAR)) assert.deepEqual(alan(ad).varsayilan, deger, ad);
  const { ayarlar } = ayarlariDuzelt({});
  for (const [ad, deger] of Object.entries(VARSAYILANLAR)) assert.deepEqual(ayarlar[ad], deger, `ayar şemasından: ${ad}`);
  assert.equal(ayarlar.animasyonlar, false, 'animasyonlar varsayılan KAPALI');
  // eski dosyadan (alan yok) yükseltme: kullanıcının mevcut değerleri korunur, yeni alanlar varsayılanla gelir
  const eski = ayarlariDuzelt({ semaSurumu: 5, temaZorla: 'sistem', vurguRengi: '#0f75e0', favoriler: [{ entity_id: 'light.a', ad: 'A' }] });
  assert.equal(eski.ayarlar.temaZorla, 'sistem');
  assert.equal(eski.ayarlar.vurguRengi, '#0f75e0');
  assert.equal(eski.ayarlar.animasyonlar, false);
  assert.equal(eski.ayarlar.favoriler.length, 1);
});

test('okuma: geçerli değerler korunur (sayı metni ve büyük harfli renk dahil); geçersiz değerler varsayılana düşer', () => {
  const gecerli = ayarlariDuzelt({
    metinOlcegi: '130', yuksekKarsitlik: true, panelTemasi: 'okyanus', panelVurguRengi: '#FF0066', panelArkaPlani: '  #112233 ',
    animasyonlar: true, animasyonGecisleri: false, havaEfekti: 'yagmur', mevsimEfekti: 'kis', hareketiAzalt: true, temaZorla: 'acik',
  }).ayarlar;
  assert.deepEqual(
    TEMA_ADLARI.map((ad) => gecerli[ad]),
    [130, true, 'okyanus', '#ff0066', '#112233', true, false, 'yagmur', 'kis', true],
  );
  assert.equal(gecerli.temaZorla, 'acik', 'temaZorla "acik" artık geçerli');
  const bozuk = ayarlariDuzelt({
    metinOlcegi: 125, yuksekKarsitlik: 'evet', panelTemasi: 'kasirga', panelVurguRengi: 'kırmızı', panelArkaPlani: '#12', animasyonlar: 1,
    animasyonGecisleri: 'hayir', havaEfekti: 'dolu', mevsimEfekti: 'bahar', hareketiAzalt: 'x',
  }).ayarlar;
  for (const ad of TEMA_ADLARI) assert.deepEqual(bozuk[ad], VARSAYILANLAR[ad], `bozuk değer varsayılana düşer: ${ad}`);
  assert.equal(ayarlariDuzelt({ temaZorla: 'mor' }).ayarlar.temaZorla, 'koyu');
});

test('metin ölçeği: yalnız 100/115/130/150 kabul edilir', () => {
  for (const n of [100, 115, 130, 150]) assert.equal(alan('metinOlcegi').duzelt(n), n);
  for (const n of ['100', '115', ' 150 ']) assert.equal(alan('metinOlcegi').duzelt(n), Number(n));
  for (const kotu of [0, 99, 120, 200, -115, 115.5, NaN, '', 'a', null, undefined, {}, [], true]) assert.equal(alan('metinOlcegi').duzelt(kotu), undefined, String(kotu));
});

test('renk alanları: boş geçerli ("temanın rengi"); #rrggbb küçük harfe çevrilir; CSS enjeksiyonu ve kısa/uzun biçim reddedilir', () => {
  for (const ad of ['panelVurguRengi', 'panelArkaPlani']) {
    assert.equal(alan(ad).duzelt(''), '');
    assert.equal(alan(ad).duzelt('#ABCDEF'), '#abcdef');
    for (const kotu of ['#abc', 'abcdef', '#abcdefa', 'red', 'rgb(1,2,3)', '#abcdef; background:red', 'url(x)', '</style>', null, undefined, 5, {}, []]) {
      assert.equal(alan(ad).duzelt(kotu), undefined, `${ad}: ${String(kotu)}`);
    }
  }
});

test('seçenek alanları: hazır tema, hava ve mevsim değerleri sabit kümeden', () => {
  assert.deepEqual(['varsayilan', 'okyanus', 'orman', 'gunbatimi', 'lavanta', 'grafit'].map((d) => alan('panelTemasi').duzelt(d)), ['varsayilan', 'okyanus', 'orman', 'gunbatimi', 'lavanta', 'grafit']);
  assert.deepEqual(['yok', 'otomatik', 'yagmur', 'kar', 'gunes', 'firtina'].map((d) => alan('havaEfekti').duzelt(d)), ['yok', 'otomatik', 'yagmur', 'kar', 'gunes', 'firtina']);
  assert.deepEqual(['yok', 'otomatik', 'ilkbahar', 'yaz', 'sonbahar', 'kis'].map((d) => alan('mevsimEfekti').duzelt(d)), ['yok', 'otomatik', 'ilkbahar', 'yaz', 'sonbahar', 'kis']);
  for (const ad of ['panelTemasi', 'havaEfekti', 'mevsimEfekti']) {
    for (const kotu of ['__proto__', 'constructor', 'toString', '', null, 5, {}]) assert.equal(alan(ad).duzelt(kotu), undefined, `${ad}: ${String(kotu)}`);
  }
});

test('kayıt: geçerli tema alanları uygulanır; geçersiz değer mevcut olanı korur ve alan adıyla uyarı verir', () => {
  const mevcut = { kisayol: 'Control+Alt+H', ...VARSAYILANLAR, metinOlcegi: 115, panelVurguRengi: '#112233' };
  const iyi = ayarGirdisiniDogrula(kayit({ metinOlcegi: 150, animasyonlar: true, havaEfekti: 'kar', panelVurguRengi: '#ABCDEF', temaZorla: 'acik' }), mevcut);
  assert.deepEqual(iyi.uyarilar, []);
  assert.equal(iyi.yeni.metinOlcegi, 150);
  assert.equal(iyi.yeni.animasyonlar, true);
  assert.equal(iyi.yeni.havaEfekti, 'kar');
  assert.equal(iyi.yeni.panelVurguRengi, '#abcdef');
  assert.equal(iyi.yeni.temaZorla, 'acik');

  const kotu = ayarGirdisiniDogrula(kayit({ metinOlcegi: 140, panelVurguRengi: 'kırmızı', havaEfekti: 'dolu', temaZorla: 'mor' }), mevcut);
  assert.deepEqual(kotu.hatalar, [], 'tema alanları kaydı engellemez');
  assert.deepEqual(kotu.uyarilar.map((u) => u.alan).sort(), ['havaEfekti', 'metinOlcegi', 'panelVurguRengi']);
  for (const u of kotu.uyarilar) assert.equal(u.mesaj, TR('kaydet.ekAlanGecersiz'));
  assert.equal(Object.hasOwn(kotu.yeni, 'metinOlcegi'), false, 'geçersiz alan yeniye girmez: mevcut değer korunur');
  assert.equal(Object.hasOwn(kotu.yeni, 'panelVurguRengi'), false);
  assert.equal(Object.hasOwn(kotu.yeni, 'temaZorla'), false, 'geçersiz tema mevcut olanı korur');
  // boş renk geçerlidir (temanın rengine dönüş)
  assert.equal(ayarGirdisiniDogrula(kayit({ panelVurguRengi: '' }), mevcut).yeni.panelVurguRengi, '');
});

test('kayıt: değişen alanlar ekAyarlariUygula ile bildirilir (main.js dinleyicileri için)', () => {
  const ayarlar = { ...VARSAYILANLAR };
  const degisen = A.ekAyarlariUygula(ayarlar, { metinOlcegi: 130, yuksekKarsitlik: false, panelTemasi: 'orman' });
  assert.deepEqual(degisen.map((d) => d.ad), ['metinOlcegi', 'panelTemasi'], 'aynı değer değişiklik sayılmaz');
  assert.equal(ayarlar.metinOlcegi, 130);
});

test('dışa/içe aktarma: tema alanları yedeğe girer ve geri yüklenir; sır içermez', () => {
  const ayarlar = { ...VARSAYILANLAR, yerelAdres: 'http://192.168.1.10:8123', kisayol: 'Control+Alt+H', metinOlcegi: 150, panelTemasi: 'lavanta', panelArkaPlani: '#101020', animasyonlar: true, mevsimEfekti: 'otomatik', favoriler: [] };
  const disa = ayarlariDisaAktar(ayarlar);
  assert.equal(disa.ok, true);
  const dosya = JSON.parse(disa.metin);
  for (const ad of TEMA_ADLARI) assert.deepEqual(dosya.ayarlar[ad], ayarlar[ad], `dışa aktarılan: ${ad}`);
  assert.doesNotMatch(JSON.stringify(dosya.ayarlar), /token|anahtar|parola|password|webhook/i, 'ayarlar bölümünde sır yok');
  const ice = ayarYedeginiCoz(dosya);
  assert.equal(ice.ok, true);
  for (const ad of TEMA_ADLARI) assert.deepEqual(ice.ayarlar[ad], ayarlar[ad], `içe aktarılan: ${ad}`);
  // bozuk içe aktarma değeri varsayılana düşer, dosya reddedilmez
  const bozuk = ayarYedeginiCoz({ ...dosya, ayarlar: { ...dosya.ayarlar, metinOlcegi: 999, animasyonlar: 'x', panelVurguRengi: 'javascript:1' } });
  assert.equal(bozuk.ok, true);
  assert.equal(bozuk.ayarlar.metinOlcegi, 100);
  assert.equal(bozuk.ayarlar.animasyonlar, false);
  assert.equal(bozuk.ayarlar.panelVurguRengi, '');
});

test('Ayarlar özeti: tema alanları ayarda yoksa varsayılanla, varsa kayıtlı değerle gider', () => {
  const ozet = A.ekAyarOzeti({ metinOlcegi: 130, animasyonlar: true });
  assert.equal(ozet.metinOlcegi, 130);
  assert.equal(ozet.animasyonlar, true);
  for (const ad of TEMA_ADLARI.filter((a) => a !== 'metinOlcegi' && a !== 'animasyonlar')) assert.deepEqual(ozet[ad], VARSAYILANLAR[ad], ad);
});
