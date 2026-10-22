'use strict';

/**
 * Hava kartı tahmin şeridi (günlük / saatlik): ayar alanı, model, biçimleyiciler ve panel modülü (src/yuzey-bilgi.js).
 * Okuma ucu ha-okuma.js'in `havaTahmini`si (test/ha-okuma.test.js); burada ctx.oku betiklenmiş sahtedir. Gerçek pencere, Electron,
 * ağ ya da Home Assistant YOK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const M = require('../src/lib/bilgi-modeli');
const Bicim = require('../src/lib/bilgi-bicim');
const Bilgi = require('../src/yuzey-bilgi');
const { TR } = require('../src/lib/ceviri-varsayilan');
const { akit, karo, HAVA, modelOlustur, ortamKur, bulSinif, metin, BASLANGIC, SAAT, AYAR } = require('./eksik-bilgi-sahte');

const saatDilimsiz = (gun, saat = 0) => `${gun}T${String(saat).padStart(2, '0')}:00:00+00:00`;
const GUNLUK = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((gun, i) => ({
  zaman: saatDilimsiz(gun),
  durum: i % 2 === 0 ? 'rainy' : 'sunny',
  sicaklik: 20 + i,
  enDusuk: 10 + i,
  yagisOlasiligi: i === 1 ? 80 : 0,
}));
const SAATLIK = Array.from({ length: 14 }, (_, k) => ({
  zaman: new Date(BASLANGIC + (k - 2) * SAAT).toISOString(), // -2 saat ... +11 saat
  durum: 'cloudy',
  sicaklik: 15 + k,
  enDusuk: null,
  yagisOlasiligi: k === 4 ? 40 : null,
}));
const tahminOkuma = (istek) => ({ ok: true, veri: istek.tahmin === 'hourly' ? SAATLIK : GUNLUK });
const ayarli = (havaTahmini, ek = {}) => modelOlustur({ ayar: { ...AYAR, havaTahmini }, ...ek });
// 1.7.0: tahmin hero'da, hava satırına tıklayınca açılır (heroParcalari); yardımcı kapalıysa açar, açıksa olduğu gibi bırakır
const tahminAc = (modul) => {
  const hava = bulSinif(modul.heroParcalari(), 'hero-hava')[0];
  if (hava && hava.getAttribute('aria-expanded') === 'false') hava.gonder('click');
};
const tahminBolumu = (modul) => {
  tahminAc(modul);
  return bulSinif(modul.heroParcalari(), 'bilgi-tahmin')[0];
};

// ---- ayar alanı ve model --------------------------------------------------------------------------------------------------

test('ayar alanı havaTahmini: varsayılan "gunluk"; yalnız kapali / gunluk / saatlik kabul edilir, bozuk değer reddedilir', () => {
  const alan = A.AYAR_ALANLARI.find((a) => a.ad === 'havaTahmini');
  assert.ok(alan);
  assert.equal(alan.varsayilan, 'gunluk');
  for (const iyi of ['kapali', 'gunluk', 'saatlik']) assert.equal(alan.duzelt(iyi), iyi);
  for (const kotu of ['hepsi', '', 5, null, undefined, ['gunluk'], { a: 1 }, 'GUNLUK']) assert.equal(alan.duzelt(kotu), undefined, JSON.stringify(kotu));
  assert.equal(A.alanlariDuzelt({}, {}).havaTahmini, 'gunluk');
  assert.equal(A.alanlariDuzelt({ havaTahmini: 'bozuk' }, {}).havaTahmini, 'gunluk', 'bozuk dosya değeri varsayılana düşer');
  const { yeni, uyarilar } = A.ekGirdiDogrula({ havaTahmini: 'saatlik' }, TR);
  assert.equal(yeni.havaTahmini, 'saatlik');
  assert.deepEqual(uyarilar, []);
  const kotu = A.ekGirdiDogrula({ havaTahmini: 'x' }, TR);
  assert.equal(Object.hasOwn(kotu.yeni, 'havaTahmini'), false, 'geçersiz değer mevcut olanı korur');
  assert.deepEqual(kotu.uyarilar.map((u) => u.alan), ['havaTahmini']);
  assert.ok(A.aktarilanAlanlar().includes('havaTahmini'), 'dışa aktarılan ayarlara girer (sır değil)');
});

test('bilgi modeli: ayar.havaTahmini ana süreç modelinde ve renderer beyaz listesinde taşınır; bozuk değer "gunluk"', () => {
  const durumAl = () => undefined;
  assert.equal(M.bilgiModeliOlustur({ ayarlar: { havaTahmini: 'saatlik' }, durumAl }).ayar.havaTahmini, 'saatlik');
  assert.equal(M.bilgiModeliOlustur({ ayarlar: { havaTahmini: 'kapali' }, durumAl }).ayar.havaTahmini, 'kapali');
  assert.equal(M.bilgiModeliOlustur({ ayarlar: {}, durumAl }).ayar.havaTahmini, 'gunluk');
  assert.equal(M.bilgiModeliOlustur({ ayarlar: { havaTahmini: 7 }, durumAl }).ayar.havaTahmini, 'gunluk');
  assert.equal(M.rendererBilgi({ ayar: { havaTahmini: 'kapali' } }).ayar.havaTahmini, 'kapali');
  assert.equal(M.rendererBilgi({ ayar: { havaTahmini: '<script>' } }).ayar.havaTahmini, 'gunluk');
});

test('renderer modelDuzelt: havaTahmini bilinen değerlerle kalır; alan hiç yoksa (eski model) "kapali" (tahmin şeridi çizilmez)', () => {
  assert.equal(Bilgi.modelDuzelt({ ayar: { havaTahmini: 'saatlik' } }).ayar.havaTahmini, 'saatlik');
  assert.equal(Bilgi.modelDuzelt({ ayar: { havaTahmini: 'gunluk' } }).ayar.havaTahmini, 'gunluk');
  assert.equal(Bilgi.modelDuzelt({ ayar: {} }).ayar.havaTahmini, 'kapali');
  assert.equal(Bilgi.modelDuzelt({ ayar: { havaTahmini: 'x' } }).ayar.havaTahmini, 'kapali');
});

// ---- biçimleyiciler -------------------------------------------------------------------------------------------------------

test('tahminGunKismi / tahminGunu: ISO tarih kısmı alınır (saat dilimi gün kaydırmaz); haftaiçi adı dile göre', () => {
  assert.equal(Bicim.tahminGunKismi('2026-10-17T00:00:00-07:00'), '2026-10-17');
  assert.equal(Bicim.tahminGunKismi('2026-10-17T23:30:00+14:00'), '2026-10-17');
  assert.equal(Bicim.tahminGunKismi('2026-10-17'), '2026-10-17');
  for (const kotu of ['', 'x', null, undefined, 5, '2026-13-01', '2026-10-32', '17.10.2026']) assert.equal(Bicim.tahminGunKismi(kotu), null, String(kotu));
  assert.equal(Bicim.tahminGunu('2026-10-17T00:00:00-07:00', { dil: 'tr' }), 'Cmt');
  assert.equal(Bicim.tahminGunu('2026-10-17', { dil: 'en' }), 'Sat');
  assert.equal(Bicim.tahminGunu('2026-10-17', { dil: 'de' }), 'Sa');
  assert.match(Bicim.tahminGunu('2026-10-17', { dil: 'fr' }), /^sam/i);
  assert.match(Bicim.tahminGunu('2026-10-17', { dil: 'es' }), /^s[aá]b/i);
  assert.equal(Bicim.tahminGunu('bozuk', { dil: 'tr' }), '');
  assert.equal(Bicim.tahminGunu('2026-10-17', { dil: 'xx' }), 'Cmt', 'bilinmeyen dil Türkçeye düşer');
});

// ---- panel: günlük görünüm ----------------------------------------------------------------------------------------------

test('günlük tahmin: ayar "gunluk" iken tek istek (daily), bugünden başlayan 5 gün; bugün "Bugün" yazılır, geçmiş gün atlanır', async () => {
  const { modul, kayit, zaman } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk'));
  assert.equal(tahminBolumu(modul).bul((o) => o.etiket === 'p')[0].textContent, 'Tahmin yükleniyor…', 'veri gelene kadar yükleniyor');
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'hava'), [{ tur: 'hava', kimlik: 'weather.ev', tahmin: 'daily' }]);
  zaman.ilerle(50);
  assert.ok(kayit.cizimler > 0, 'veri gelince yeniden çizim istenir');
  const bolum = tahminBolumu(modul);
  const ogeler = bulSinif(bolum, 'tahmin-oge');
  assert.equal(ogeler.length, 5);
  assert.deepEqual(bulSinif(bolum, 'tahmin-zaman').map((o) => o.textContent), ['Bugün', 'Cmt', 'Paz', 'Pzt', 'Sal']);
  assert.deepEqual(bulSinif(bolum, 'tahmin-sicaklik').map((o) => o.textContent), ['21°', '22°', '23°', '24°', '25°']);
  assert.deepEqual(bulSinif(bolum, 'tahmin-dusuk').map((o) => o.textContent), ['11°', '12°', '13°', '14°', '15°']);
  assert.deepEqual(bulSinif(bolum, 'tahmin-yagis').map((o) => o.textContent), ['☂ %80'], 'yalnız yağış ihtimali olan gün yağış yazar');
  assert.match(bolum.attributes['aria-label'], /Hava tahmini/);
  assert.match(ogeler[0].attributes['aria-label'], /^Bugün · Güneşli, sıcaklık 21°, en düşük 11°, yağış ihtimali %80$/);
  assert.equal(bulSinif(bolum, 'tahmin-liste')[0].className, 'tahmin-liste gunluk');
});

test('günlük tahmin: ham durum adı sızmaz (bilinmeyen koşul simge ve ad üretmez), metinler yalnız yazı olarak eklenir', async () => {
  const bozuk = [
    { zaman: saatDilimsiz('2026-10-16'), durum: '<img src=x onerror=alert(1)>', sicaklik: 18, enDusuk: null, yagisOlasiligi: null },
    { zaman: 'bozuk', durum: 'sunny', sicaklik: 1 },
    null,
    { zaman: saatDilimsiz('2026-10-17'), durum: 'exceptional', sicaklik: 'sıcak', enDusuk: 1e9, yagisOlasiligi: 0 },
  ];
  const { modul } = ortamKur({ okuma: { hava: () => ({ ok: true, veri: bozuk }) } });
  modul.ayarla(ayarli('gunluk'));
  await akit();
  const ogeler = bulSinif(tahminBolumu(modul), 'tahmin-oge');
  assert.equal(ogeler.length, 2, 'zamanı çözülemeyen ve boş satır düşer');
  assert.equal(bulSinif(ogeler[0], 'tahmin-simge')[0].textContent, '');
  assert.doesNotMatch(ogeler[0].attributes['aria-label'], /img|script|onerror/);
  assert.equal(bulSinif(ogeler[1], 'tahmin-sicaklik').length, 0, 'sayı olmayan sıcaklık yazılmaz');
});

// ---- panel: saatlik görünüm, geçiş, önbellek --------------------------------------------------------------------------

test('saatlik tahmin: ayar "saatlik" iken hourly istenir; şu andan başlayan 8 saat (geçmiş saat atlanır)', async () => {
  const { modul, kayit } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('saatlik'));
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'hava'), [{ tur: 'hava', kimlik: 'weather.ev', tahmin: 'hourly' }]);
  const bolum = tahminBolumu(modul);
  assert.deepEqual(bulSinif(bolum, 'tahmin-zaman').map((o) => o.textContent), ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'].map((_, k) => Bicim.saatMetni(BASLANGIC + k * SAAT, { saatBicimi: '24' })));
  assert.equal(bulSinif(bolum, 'tahmin-sicaklik')[0].textContent, '17°', 'k=2 satırı: şu andaki saat');
  assert.deepEqual(bulSinif(bolum, 'tahmin-yagis').map((o) => o.textContent), ['☂ %40']);
  assert.equal(bulSinif(bolum, 'tahmin-liste')[0].className, 'tahmin-liste saatlik');
  assert.equal(bulSinif(bolum, 'tahmin-dusuk').length, 0, 'saatlik satırda en düşük yok');
});

test('Günlük / Saatlik düğmesi: seçili olan işaretli; diğerine basınca yeni tür istenir, odak o düğmede kalır; aktif türe basmak bir şey yapmaz', async () => {
  const { modul, kayit } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk'));
  await akit();
  let dugmeler = bulSinif(tahminBolumu(modul), 'aralik-dugme');
  assert.deepEqual(dugmeler.map((d) => [d.textContent, d.attributes['aria-pressed']]), [['Günlük', 'true'], ['Saatlik', 'false']]);
  assert.equal(kayit.satirlar.at(-1).length, 2, 'ok tuşu gezintisine iki düğme de girer');
  dugmeler[0].gonder('click');
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 1, 'aktif türe basmak yeni istek atmaz');
  dugmeler[1].gonder('click');
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'hava').map((o) => o.tahmin), ['daily', 'hourly']);
  assert.ok(kayit.odakIstekleri.includes('bi:tahmin:saatlik'));
  dugmeler = bulSinif(tahminBolumu(modul), 'aralik-dugme');
  assert.deepEqual(dugmeler.map((d) => d.attributes['aria-pressed']), ['false', 'true']);
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-liste')[0].className, 'tahmin-liste saatlik');
  // geri dönüş: günlük veri önbellekte, yeni istek atılmaz
  dugmeler[0].gonder('click');
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 2);
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-liste')[0].className, 'tahmin-liste gunluk');
});

test('ayar değişince panelde yapılan geçici tür seçimi bırakılır; model aynı kalırsa korunur', async () => {
  const { modul } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk'));
  await akit();
  bulSinif(tahminBolumu(modul), 'aralik-dugme')[1].gonder('click');
  await akit();
  modul.ayarla(ayarli('gunluk'));
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-liste')[0].className, 'tahmin-liste saatlik', 'aynı ayar: seçim korunur');
  modul.ayarla(ayarli('saatlik'));
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-liste')[0].className, 'tahmin-liste gunluk', 'ayar değişti: seçim ayara döner');
});

test('önbellek ve yenileme: 10 dakika dolmadan yeni istek yok, dolunca bir istek; süren istek ikilenmez', async () => {
  const { modul, kayit, zaman } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk'));
  modul.ayarla(ayarli('gunluk')); // ilk yanıt gelmeden ikinci model
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 1);
  zaman.ilerle(599_000);
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 1);
  zaman.ilerle(2_000);
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 2);
});

// ---- hata, boş ve görünmeme durumları -------------------------------------------------------------------------------------

test('hata ve boş yanıt "Tahmin alınamadı" der; 30 saniye sonra yeniden denenir; ağ hatası fırlatmaz', async () => {
  let cevap = 'hata';
  const { modul, kayit, zaman } = ortamKur({
    okuma: {
      hava: () => {
        if (cevap === 'hata') throw new Error('ag');
        if (cevap === 'bos') return { ok: true, veri: [] };
        if (cevap === 'red') return { ok: false, tur: 'kayitsiz' };
        return { ok: true, veri: GUNLUK };
      },
    },
  });
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(bulSinif(tahminBolumu(modul), 'bilgi-not')[0].textContent, 'Tahmin alınamadı');
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-oge').length, 0);
  zaman.ilerle(10_000);
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 1, '30 saniye dolmadan yeniden denenmez');
  zaman.ilerle(21_000);
  cevap = 'bos';
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 2);
  assert.equal(bulSinif(tahminBolumu(modul), 'bilgi-not')[0].textContent, 'Tahmin alınamadı', 'boş liste de alınamadı sayılır');
  zaman.ilerle(31_000);
  cevap = 'red';
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(bulSinif(tahminBolumu(modul), 'bilgi-not')[0].textContent, 'Tahmin alınamadı', 'ana süreç reddi (kayıtsız) de alınamadı');
  zaman.ilerle(31_000);
  cevap = 'iyi';
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-oge').length, 5, 'düzelince veri gösterilir');
});

test('gosterildi(): hatalı tahmin kaydı atılır, panel yeniden açılınca hemen yeniden denenir', async () => {
  let cevap = 'hata';
  const { modul, kayit } = ortamKur({ okuma: { hava: () => (cevap === 'hata' ? { ok: false } : { ok: true, veri: GUNLUK }) } });
  modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 1);
  cevap = 'iyi';
  modul.gosterildi();
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'hava').length, 2);
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-oge').length, 5);
});

test('ayar "kapali", hava kartı yok / seçilmedi / ulaşılamıyor ya da panel kapalıyken: şerit ve istek yok', async () => {
  const kapali = ortamKur({ okuma: { hava: tahminOkuma } });
  kapali.modul.ayarla(ayarli('kapali'));
  await akit();
  assert.equal(tahminBolumu(kapali.modul), undefined);
  assert.equal(kapali.kayit.okumalar.filter((o) => o.tur === 'hava').length, 0);

  const kartsiz = ortamKur({ okuma: { hava: tahminOkuma } });
  kartsiz.modul.ayarla(ayarli('gunluk', { kartlar: [{ yuva: 1, tur: 'saat', karo: null, secilmedi: false }] }));
  await akit();
  assert.equal(tahminBolumu(kartsiz.modul), undefined, 'hava kartı seçili değil');
  assert.equal(kartsiz.kayit.okumalar.length, 0);

  const secilmedi = ortamKur({ okuma: { hava: tahminOkuma } });
  secilmedi.modul.ayarla(ayarli('gunluk', { kartlar: [{ yuva: 1, tur: 'hava', karo: null, secilmedi: true }] }));
  await akit();
  assert.equal(tahminBolumu(secilmedi.modul), undefined);

  const yok = ortamKur({ okuma: { hava: tahminOkuma } });
  yok.modul.ayarla(ayarli('gunluk', { kartlar: [{ yuva: 1, tur: 'hava', karo: { ...HAVA, ulasilamiyor: true }, secilmedi: false }] }));
  await akit();
  assert.equal(tahminBolumu(yok.modul), undefined, 'ulaşılamayan hava varlığı için tahmin istenmez');
  assert.equal(yok.kayit.okumalar.length, 0);

  const kapaliPanel = ortamKur({ okuma: { hava: tahminOkuma }, acik: false });
  kapaliPanel.modul.ayarla(ayarli('gunluk'));
  await akit();
  assert.equal(kapaliPanel.kayit.okumalar.length, 0, 'gizli pencere okuma istemez');
  assert.ok(tahminBolumu(kapaliPanel.modul), 'şerit "yükleniyor" olarak çizilir');
});

test('ilk kullanılabilir hava kartı için tek şerit: iki hava kartı olsa da ikinci istek atılmaz', async () => {
  const ikinci = karo('weather.yazlik', 'Yazlık', 'weather', { durum: 'sunny', sicaklik: 30, birim: '°C', nem: null, ruzgar: null, ruzgarBirim: null, basinc: null });
  const { modul, kayit } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk', { kartlar: [{ yuva: 1, tur: 'hava', karo: HAVA, secilmedi: false }, { yuva: 2, tur: 'hava', karo: ikinci, secilmedi: false }] }));
  await akit();
  assert.deepEqual(kayit.okumalar.map((o) => o.kimlik), ['weather.ev']);
  tahminAc(modul);
  assert.equal(bulSinif(modul.heroParcalari(), 'bilgi-tahmin').length, 1);
});

test('tahmin satırı sayısı sınırlıdır: 48+ satır gelse de günlükte 5, saatlikte 8 öğe çizilir; metin düğümleri yalnız yazı', async () => {
  const cok = Array.from({ length: 200 }, (_, k) => ({ zaman: new Date(BASLANGIC + k * SAAT).toISOString(), durum: 'sunny', sicaklik: k, enDusuk: null, yagisOlasiligi: null }));
  const { modul } = ortamKur({ okuma: { hava: () => ({ ok: true, veri: cok }) } });
  modul.ayarla(ayarli('saatlik'));
  await akit();
  assert.equal(bulSinif(tahminBolumu(modul), 'tahmin-oge').length, 8);
  assert.doesNotMatch(metin(tahminBolumu(modul)), /<|>/);
});

test('1.7.0: tahmin hero bölümünde saat / hava satırının altında açılır; kapalı başlar, havaya tıklayınca açılır, yeniden tıklayınca kapanır; panel yeniden gösterilince kapalı', async () => {
  const sicaklik = karo('sensor.salon', 'Salon', 'sensor', { deger: '21', sayi: 21, birim: '°C', sinif: 'temperature', hassasiyet: null, enAz: null, enCok: null });
  const { modul, kayit } = ortamKur({ okuma: { hava: tahminOkuma } });
  modul.ayarla(ayarli('gunluk', { serit: [sicaklik] }));
  await akit();
  const adlar = () => modul.heroParcalari().map((p) => p.className);
  const hava = () => bulSinif(modul.heroParcalari(), 'hero-hava')[0];
  assert.deepEqual(adlar(), ['hero-ust']);
  assert.equal(hava().etiket, 'button');
  assert.equal(hava().getAttribute('aria-expanded'), 'false');
  assert.deepEqual(modul.ustParcalar().map((p) => p.className), ['sensor-serit'], 'içerikte tahmin yok');
  const cizim = kayit.cizimler;
  hava().gonder('click');
  assert.ok(kayit.cizimler > cizim, 'tıklama yeniden çizim ister');
  assert.deepEqual(adlar(), ['hero-ust', 'bilgi-tahmin']);
  assert.equal(hava().getAttribute('aria-expanded'), 'true');
  assert.deepEqual(kayit.odakIstekleri.slice(-1), ['bi:hero:hava'], 'odak hava düğmesinde kalır');
  hava().gonder('click');
  assert.deepEqual(adlar(), ['hero-ust']);
  hava().gonder('click');
  modul.gosterildi();
  assert.deepEqual(adlar(), ['hero-ust'], 'panel yeniden açılınca tahmin kapalı başlar');
});
