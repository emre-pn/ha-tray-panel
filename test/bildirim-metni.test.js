'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AD_SINIRI,
  ANAHTAR_SILME_ONAY_METNI,
  ANAHTAR_SILINDI_METNI,
  basariMetni,
  gonderildiMetni,
  hataBildirimiMetni,
} = require('../src/lib/bildirim-metni');
const { kisalt } = require('../src/lib/metin');

test('basariMetni: sahne, script ve düğme', () => {
  assert.equal(basariMetni('scene', 'Film', 'unknown', 'unknown'), 'Sahne etkinleştirildi: Film');
  assert.equal(basariMetni('script', 'Telefonu bul', 'off', 'off'), 'Script çalıştırıldı: Telefonu bul');
  assert.equal(basariMetni('button', 'Ses +', 'unknown', 'unknown'), 'Düğmeye basıldı: Ses +');
  assert.equal(basariMetni('input_button', 'X', undefined, undefined), 'Düğmeye basıldı: X');
});

test('basariMetni: açılıp kapanan varlıklarda yanıttan türetilen durum', () => {
  assert.equal(basariMetni('light', 'LED şerit', 'off', 'on'), 'LED şerit açıldı');
  assert.equal(basariMetni('light', 'LED şerit', 'on', 'off'), 'LED şerit kapatıldı');
});

test('basariMetni: durum yanıttan bilinmiyorsa "komut gönderildi"', () => {
  assert.equal(basariMetni('light', 'LED şerit', 'on', undefined), 'LED şerit: kapatma komutu gönderildi');
  assert.equal(basariMetni('switch', 'Kahve', 'off', undefined), 'Kahve: açma komutu gönderildi');
  assert.equal(basariMetni('light', 'LED', 'on', 'on'), 'LED: kapatma komutu gönderildi');
  assert.equal(gonderildiMetni('Işık'), 'Işık: komut gönderildi');
});

test('uzun ad en çok 100 karaktere kısaltılır, boşluklar teke iner', () => {
  const uzun = 'Çok '.repeat(80);
  const metin = basariMetni('scene', uzun, '', '');
  assert.ok(metin.startsWith('Sahne etkinleştirildi: '));
  assert.ok(Array.from(metin.replace('Sahne etkinleştirildi: ', '')).length <= AD_SINIRI);
  assert.ok(Array.from(gonderildiMetni(uzun)).length <= AD_SINIRI + ': komut gönderildi'.length);
  assert.equal(kisalt('a   b\n c', 10), 'a b c');
  assert.equal(kisalt('😀'.repeat(5), 3), '😀😀😀'); // vekil çiftleri bölünmez
});

test('hataBildirimiMetni', () => {
  assert.equal(hataBildirimiMetni('bağlantı yok'), 'Yapılamadı: bağlantı yok');
  assert.ok(Array.from(hataBildirimiMetni('x'.repeat(300))).length <= AD_SINIRI + 'Yapılamadı: '.length);
});

test('anahtar silme metinleri: yalnız yerel silme, HA\'dan da iptal etme uyarısı; "güvenli silindi" iddiası yok', () => {
  for (const m of [ANAHTAR_SILME_ONAY_METNI, ANAHTAR_SILINDI_METNI]) {
    assert.match(m, /iptal/);
    assert.match(m, /Home Assistant/);
    assert.doesNotMatch(m, /güvenli şekilde silindi/i);
  }
  assert.match(ANAHTAR_SILINDI_METNI, /bu bilgisayardan silindi/);
});

test('Dalga 2 denetimi: bekleyen onay, ayar yazılamadı, bozuk ayar dosyası ve http anahtar uyarısı metinleri', () => {
  const {
    AYAR_YAZILAMADI_METNI,
    HTTP_ANAHTAR_GUNLUK_SATIRI,
    HTTP_ANAHTAR_UYARISI,
    ONAY_BEKLIYOR_METNI,
    ayarDosyasiBozukMetni,
  } = require('../src/lib/bildirim-metni');
  assert.match(ONAY_BEKLIYOR_METNI, /onay penceresi/);
  assert.match(AYAR_YAZILAMADI_METNI, /diske yazılamadı/);
  assert.match(ayarDosyasiBozukMetni('ayarlar.bozuk-123.json'), /ayarlar\.bozuk-123\.json/);
  assert.match(ayarDosyasiBozukMetni('ayarlar.bozuk-123.json'), /varsayılan ayarlar/);
  assert.doesNotMatch(ayarDosyasiBozukMetni(''), /adıyla/, 'yedek alınamadıysa yedek adı iddia edilmez');
  assert.match(HTTP_ANAHTAR_UYARISI, /şifresiz/);
  assert.match(HTTP_ANAHTAR_UYARISI, /HTTPS/);
  assert.match(HTTP_ANAHTAR_GUNLUK_SATIRI, /şifresiz/);
  // Hiçbiri anahtar, IP adresi ya da dosya yolu içermez (günlüğe ve bildirime sabit metin gider).
  for (const m of [ONAY_BEKLIYOR_METNI, AYAR_YAZILAMADI_METNI, HTTP_ANAHTAR_UYARISI, HTTP_ANAHTAR_GUNLUK_SATIRI]) assert.doesNotMatch(m, /\d+\.\d+\.\d+\.\d+|Bearer|[A-Z]:\\/);
});

// --- 1.2.0 (g-14, h-10, h-11, h-32, h-33, h-37, k-10, k-20): yeni metinler ve üslup kuralları ---------------------------------

const metinler = require('../src/lib/bildirim-metni');

/** Kullanıcıya giden TÜM sabit metinler ve işlev çıktıları (örnek argümanlarla). */
function butunKullaniciMetinleri() {
  const sabitler = Object.entries(metinler)
    .filter(([ad, deger]) => typeof deger === 'string' && /^[A-ZÇĞİÖŞÜ_0-9]+$/.test(ad))
    .map(([ad, deger]) => [ad, deger]);
  const uretilen = [
    ['basariMetni', metinler.basariMetni('light', 'Salon', 'off', 'on')],
    ['gonderildiMetni', metinler.gonderildiMetni('Salon')],
    ['hataBildirimiMetni', metinler.hataBildirimiMetni('bağlantı yok')],
    ['ayarDosyasiBozukMetni', metinler.ayarDosyasiBozukMetni('ayarlar.bozuk-1.json')],
    ['ayarDosyasiBozukMetni(bak)', metinler.ayarDosyasiBozukMetni('ayarlar.bozuk-1.json', true)],
    ['alanlarSifirlandiMetni', metinler.alanlarSifirlandiMetni(['favoriler', 'panolar'], 'ayarlar.hatali-1.json')],
    ['semaDahaYeniMetni', metinler.semaDahaYeniMetni(9, 'ayarlar.v9-yedek.json')],
    ['kisayolSifirlandiMetni(ana)', metinler.kisayolSifirlandiMetni('ana', 'Ctrl+Alt+H')],
    ['kisayolSifirlandiMetni(palet)', metinler.kisayolSifirlandiMetni('palet', 'Ctrl+Alt+P')],
    ['anaKisayolAlinamadiMetni', metinler.anaKisayolAlinamadiMetni('Ctrl+Alt+H')],
    ['ekKisayollarUygulanamadiMetni', metinler.ekKisayollarUygulanamadiMetni(2)],
    ['ikinciOnayMetni(bütçe)', metinler.ikinciOnayMetni('hata-butcesi', 3, 'okunamadi')],
    ['ikinciOnayMetni(kayıt)', metinler.ikinciOnayMetni('kayit-okunamadi', 0, null)],
  ];
  return [...sabitler, ...uretilen];
}

test('g-14: kullanıcıya giden metinlerde tek hitap "sen" kullanılır ("siz" kalıpları yok; anahtar silme metinleri dahil)', () => {
  const sizKalibi = /\b(?:siz|sizin|\w*(?:ınız|iniz|unuz|ünüz|sınız|siniz|sunuz|sünüz)\w*)\b/i;
  for (const [ad, metin] of butunKullaniciMetinleri()) {
    assert.doesNotMatch(metin, sizKalibi, `${ad}: "siz" hitabı`);
  }
});

test('g-14: kesme işareti kıvrık (’); düz tırnak (\') ve bozuk karakter kullanılmaz', () => {
  for (const [ad, metin] of butunKullaniciMetinleri()) {
    assert.ok(!metin.includes("'"), `${ad}: düz kesme işareti`);
    assert.ok(!metin.includes('�'), `${ad}: bozuk karakter`);
  }
  assert.match(metinler.ANAHTAR_REDDEDILDI_BILDIRIMI, /Ayarlar’dan/);
});

test('g-14: hiçbir metin anahtar, IP adresi ya da dosya yolu taşımaz ("Bearer", 1.2.3.4, C:\\...)', () => {
  for (const [ad, metin] of butunKullaniciMetinleri()) assert.doesNotMatch(metin, /\d+\.\d+\.\d+\.\d+|Bearer|[A-Z]:\\|eyJ[A-Za-z0-9_-]{10,}/, ad);
});

test('g-14: Ayarlar\'daki düğme her metinde aynı yazılır (“Yeniden Dene”); “geri gelmeyebilir” yerine “kaybolabilir” denir', () => {
  for (const [ad, metin] of butunKullaniciMetinleri()) {
    assert.doesNotMatch(metin, /[“"']yeniden dene[”"']/, `${ad}: düğme adı büyük harfle “Yeniden Dene” yazılmalı`);
    assert.doesNotMatch(metin, /geri gelmeyebilir/, ad);
  }
  assert.match(metinler.AYAR_YAZILAMADI_METNI, /kaybolabilir/);
  assert.match(metinler.ANAHTAR_DOGRULANAMADI_BILDIRIMI, /“Yeniden Dene”/);
});

test('h-10: ayar dosyası okunamadı bildirimi, dosyanın üzerine yazılmayacağını ve ne yapılacağını söyler; "bozuk" demez', () => {
  const m = metinler.AYAR_OKUNAMADI_BILDIRIMI;
  assert.match(m, /okunamadı/);
  assert.match(m, /üzerine yazılmayacak/);
  assert.match(m, /yeniden aç/);
  assert.doesNotMatch(m, /bozuk/i);
});

test('h-32: bozuk ayar dosyası metni son iyi kopyadan geri yüklemeyi (ve kaybolabilecek son değişiklikleri) söyler; kopya yoksa varsayılanları söyler', () => {
  const geriYuklenen = metinler.ayarDosyasiBozukMetni('ayarlar.bozuk-7.json', true);
  assert.match(geriYuklenen, /son iyi kopyadan geri yüklendi/);
  assert.match(geriYuklenen, /son değişiklikler kaybolmuş olabilir/);
  assert.match(geriYuklenen, /"ayarlar\.bozuk-7\.json"/);
  const varsayilan = metinler.ayarDosyasiBozukMetni('ayarlar.bozuk-7.json');
  assert.match(varsayilan, /^Ayar dosyası okunamadı/, 'mevcut testlerin ve bildirim aramalarının dayandığı başlangıç');
  assert.match(varsayilan, /varsayılan ayarlar/);
  assert.doesNotMatch(varsayilan, /son iyi kopya/);
  assert.doesNotMatch(metinler.ayarDosyasiBozukMetni('', true), /adıyla/, 'yedek alınamadıysa yedek adı iddia edilmez');
});

test('h-33: geçersiz alanlar metni en çok ilk 5 alanı sayar, fazlası için … koyar, yedek adını verir ve değer içermez', () => {
  const az = metinler.alanlarSifirlandiMetni(['favoriler', 'panolar'], 'ayarlar.hatali-5.json');
  assert.match(az, /favoriler, panolar\./);
  assert.match(az, /"ayarlar\.hatali-5\.json" adıyla saklandı/);
  const cok = metinler.alanlarSifirlandiMetni(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
  assert.match(cok, /a1, a2, a3, a4, a5…/);
  assert.doesNotMatch(cok, /a6|a7/);
  assert.doesNotMatch(cok, /adıyla/, 'yedek yoksa yedek iddiası yok');
});

test('h-11: daha yeni şema metni sürümü, korunan ayarları ve yedek adını söyler', () => {
  const m = metinler.semaDahaYeniMetni(9, 'ayarlar.v9-yedek.json');
  assert.match(m, /daha yeni bir Ev Paneli/);
  assert.match(m, /şema 9/);
  assert.match(m, /korunuyor/);
  assert.match(m, /"ayarlar\.v9-yedek\.json"/);
  assert.doesNotMatch(metinler.semaDahaYeniMetni(9), /adıyla/);
});

test('h-33: kısayol sıfırlama metni ana ve palet için ayrı söylenir ve yeni değeri gösterir', () => {
  assert.equal(metinler.kisayolSifirlandiMetni('ana', 'Ctrl+Alt+H'), 'Kayıtlı kısayol geçerli değildi; Ctrl+Alt+H olarak sıfırlandı. Ayarlar’dan değiştirebilirsin.');
  assert.match(metinler.kisayolSifirlandiMetni('palet', 'Ctrl+Alt+P'), /^Kayıtlı palet kısayolu geçerli değildi; Ctrl\+Alt\+P olarak sıfırlandı/);
});

test('k-10: kısayol bildirim metinleri Ayarlar\'a yönlendirir (bildirime tıklayınca açılan yer)', () => {
  assert.match(metinler.anaKisayolAlinamadiMetni('Ctrl+Alt+H'), /^Ctrl\+Alt\+H kısayolu alınamadı; başka bir uygulama kullanıyor olabilir\. Ayarlar’dan değiştirebilirsin\.$/);
  assert.match(metinler.ekKisayollarUygulanamadiMetni(3), /^3 kısayol uygulanamadı .* Ayarlar’dan bak\.$/);
});

test('h-37: Ayarlar çökme ve açılış hatası metinleri kullanıcıya ne olduğunu ve ne yapacağını söyler; ayrıntı (hata iletisi) taşımaz', () => {
  assert.match(metinler.AYARLAR_COKTU_BILDIRIMI, /yeniden açılıyor/);
  assert.match(metinler.AYARLAR_ART_ARDA_COKTU_BILDIRIMI, /Tepsi menüsünden Ayarlar’ı seçerek/);
  assert.match(metinler.ACILIS_HATASI_BILDIRIMI, /günlük dosyasında/);
  for (const m of [metinler.AYARLAR_COKTU_BILDIRIMI, metinler.AYARLAR_ART_ARDA_COKTU_BILDIRIMI, metinler.ACILIS_HATASI_BILDIRIMI]) assert.ok(m.length < 160, 'bildirim kısa');
});

test('k-20: dış bağlantı bilgisi kısa, “HA panosu”ndan ayrı bir iş olduğunu karıştırmaz', () => {
  assert.equal(metinler.TARAYICIDA_ACILDI_METNI, 'Tarayıcıda açıldı');
  assert.equal(metinler.EPOSTA_ACILDI_METNI, 'E-posta uygulamasında açıldı');
});
