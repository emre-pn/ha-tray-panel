'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { komutSatiriEylemi, eylemIstendiMi, eylemAdiniCoz, EN_COK_AD, EN_AZ_ONEK_HARFI } = require('../src/lib/komut-satiri');

const KAROLAR = [
  { id: 'light.masa_led_serit', etiket: 'LED şerit', parlaklikKontrol: true },
  { id: 'light.smart_multicolor_bulb', etiket: 'Ampul', parlaklikKontrol: false },
  { id: 'scene.film', etiket: 'Film', parlaklikKontrol: false },
  { id: 'scene.gece_lambasi', etiket: 'Gece lambası', parlaklikKontrol: false },
  { id: 'button.pc_mediavolumeup', etiket: 'Ses +', parlaklikKontrol: false },
  { id: 'button.pc_mediavolumedown', etiket: 'Ses −', parlaklikKontrol: false },
  { id: 'button.pc_ses_cikis_hoparlor', etiket: 'Hoparlör', parlaklikKontrol: false },
];

test('komutSatiriEylemi: --eylem=<ad> değerini alır; yoksa null', () => {
  assert.deepEqual(komutSatiriEylemi(['ev-paneli.exe', '--eylem=film']), { ad: 'film' });
  assert.deepEqual(komutSatiriEylemi(['x', '--gizli', '--eylem=gece lambası']), { ad: 'gece lambası' });
  assert.deepEqual(komutSatiriEylemi(['x', '--EYLEM=Film']), { ad: 'Film' });
  assert.equal(komutSatiriEylemi(['x', '--gizli']), null);
  assert.equal(komutSatiriEylemi([]), null);
  assert.equal(komutSatiriEylemi(undefined), null);
  assert.equal(komutSatiriEylemi('--eylem=film'), null);
});

test('komutSatiriEylemi: tırnaklar soyulur, denetim karakterleri atılır; boş/aşırı uzun/noktalama-only geçersiz', () => {
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem="film"']), { ad: 'film' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=fi\u0000lm\n']), { ad: 'film' });
  assert.equal(komutSatiriEylemi(['x', '--eylem=']), null);
  assert.equal(komutSatiriEylemi(['x', '--eylem=   ']), null);
  assert.equal(komutSatiriEylemi(['x', `--eylem=${'a'.repeat(EN_COK_AD + 1)}`]), null);
  assert.deepEqual(komutSatiriEylemi(['x', `--eylem=${'a'.repeat(EN_COK_AD)}`]).ad.length, EN_COK_AD);
  assert.equal(komutSatiriEylemi(['x', '--eylem=!!!']), null);
  assert.equal(komutSatiriEylemi(['x', 5, null]), null);
});

test('eylemAdiniCoz: Türkçe katlama ile tam etiket, nesne kimliği ve önek eşleşir', () => {
  assert.deepEqual(eylemAdiniCoz('film', KAROLAR), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('FİLM', KAROLAR), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('gece lambasi', KAROLAR), { id: 'scene.gece_lambasi' });
  assert.deepEqual(eylemAdiniCoz('Gece Lambası', KAROLAR), { id: 'scene.gece_lambasi' });
  assert.deepEqual(eylemAdiniCoz('hoparlor', KAROLAR), { id: 'button.pc_ses_cikis_hoparlor' });
  assert.deepEqual(eylemAdiniCoz('led serit', KAROLAR), { id: 'light.masa_led_serit' });
  assert.deepEqual(eylemAdiniCoz('pc_mediavolumeup', KAROLAR), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz('button.pc_mediavolumeup', KAROLAR), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz('amp', KAROLAR), { id: 'light.smart_multicolor_bulb' }, 'tekil önek');
});

test('eylemAdiniCoz: orijinal ad (ad) tam ve önek eşleşmesi', () => {
  const ozelKarolar = [
    { id: 'light.ozel_isik', ad: 'Orijinal Tavan Işığı', etiket: 'Tavan', parlaklikKontrol: true },
  ];
  assert.deepEqual(eylemAdiniCoz('Orijinal Tavan Işığı', ozelKarolar), { id: 'light.ozel_isik' });
  assert.deepEqual(eylemAdiniCoz('orijinal tavan', ozelKarolar), { id: 'light.ozel_isik' }, 'ad öneki');
  assert.deepEqual(eylemAdiniCoz('Orijinal Tavan Işığı 75', ozelKarolar), { id: 'light.ozel_isik', parlaklik: 75 });
});

test('eylemAdiniCoz: belirsiz eşleşme hiçbir şey seçmez; bulunamayan hata verir; serbest kimlik çözülmez', () => {
  assert.deepEqual(eylemAdiniCoz('ses', KAROLAR), { hata: 'belirsiz' });
  assert.deepEqual(eylemAdiniCoz('yok boyle bir sey', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('lock.on_kapi', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('film', []), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('film', null), { hata: 'bulunamadi' });
});

test('eylemAdiniCoz: "led 40" yalnız parlaklık kontrollü ışıkta parlaklık olur; ampul/sahnede sayı ad parçası kalır', () => {
  assert.deepEqual(eylemAdiniCoz('led 40', KAROLAR), { id: 'light.masa_led_serit', parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('led serit 100', KAROLAR), { id: 'light.masa_led_serit', parlaklik: 100 });
  assert.deepEqual(eylemAdiniCoz('ampul 40', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('led 0', KAROLAR), { id: 'light.masa_led_serit', kapat: true }, 'h-23: "led 0" kapat anlamına gelir (eskiden bulunamıyordu)');
  assert.deepEqual(eylemAdiniCoz('led 101', KAROLAR), { hata: 'bulunamadi' });
});

// --- 1.2.0: komut satırı düzeltmeleri (h-21, h-22, h-23) --------------------------------------

test('h-22: "--eylem <ad>" (eşittirsiz) ve tırnaksız ardışık argümanlar ada eklenir', () => {
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem', 'Salon']), { ad: 'Salon' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem', 'led', '40']), { ad: 'led 40' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '40']), { ad: 'led 40' });
  assert.deepEqual(komutSatiriEylemi(['x', '--EYLEM=Gece', 'lambası']), { ad: 'Gece lambası' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '40%']), { ad: 'led 40%' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=', 'led 40']), { ad: 'led 40' }, 'PowerShell boşluktan bölerse');
  // Tek başına duran + ve - ada aittir ("Ses +"); başka seçenekte ad durur.
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=Ses', '+']), { ad: 'Ses +' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=Ses', '-']), { ad: 'Ses -' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=film', '--gizli']), { ad: 'film' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem', 'film', '-gizli', 'baska']), { ad: 'film' });
  assert.deepEqual(komutSatiriEylemi(['x', '--gizli', '--eylem', '"gece lambası"']), { ad: 'gece lambası' });
  // Ad olmayan ya da sınırı aşan biçimler geçersizdir (null), ama "istendi" sayılır (aşağıdaki test).
  assert.equal(komutSatiriEylemi(['x', '--eylem']), null);
  assert.equal(komutSatiriEylemi(['x', '--eylem', '--gizli']), null);
  assert.equal(komutSatiriEylemi(['x', '--eylem', 'a'.repeat(EN_COK_AD), 'b']), null);
  assert.equal(komutSatiriEylemi(['x', '--eylemm=film']), null, 'yazım hatası eşittirli biçime benzemez');
});

test('h-22: eylemIstendiMi: ayrıştırılamasa bile --eylem ile başlayan argüman "istendi" sayılır (sessiz kalınmaz)', () => {
  assert.equal(eylemIstendiMi(['x', '--eylem=film']), true);
  assert.equal(eylemIstendiMi(['x', '--eylem']), true);
  assert.equal(eylemIstendiMi(['x', '--EYLEM=']), true);
  assert.equal(eylemIstendiMi(['x', '--eylemm=film']), true);
  assert.equal(eylemIstendiMi(['x', '--gizli']), false);
  assert.equal(eylemIstendiMi(['x', 'eylem']), false);
  assert.equal(eylemIstendiMi([]), false);
  assert.equal(eylemIstendiMi(undefined), false);
  assert.equal(eylemIstendiMi('--eylem=film'), false);
  assert.equal(eylemIstendiMi([5, null]), false);
});

test('h-22: önek eşleşmesi en az 2 harf ister (tek harf Film\'i çalıştırmaz); tam ad tek harfliyse yine çalışır', () => {
  assert.deepEqual(eylemAdiniCoz('f', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('fi', KAROLAR), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('g', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('a', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('x', [{ id: 'scene.x', etiket: 'X', parlaklikKontrol: false }]), { id: 'scene.x' }, 'tam etiket eşleşmesi tek harfte de olur');
  assert.equal(EN_AZ_ONEK_HARFI, 2);
});

test('h-21: "Ses +" ve "Ses −" komut satırında ayrışır ("+", "-", "−", "arti", "eksi"); "ses" belirsiz kalır', () => {
  assert.deepEqual(eylemAdiniCoz('Ses +', KAROLAR), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz('Ses −', KAROLAR), { id: 'button.pc_mediavolumedown' });
  assert.deepEqual(eylemAdiniCoz('ses -', KAROLAR), { id: 'button.pc_mediavolumedown' });
  assert.deepEqual(eylemAdiniCoz('ses arti', KAROLAR), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz('SES EKSİ', KAROLAR), { id: 'button.pc_mediavolumedown' });
  assert.deepEqual(eylemAdiniCoz('ses ar', KAROLAR), { id: 'button.pc_mediavolumeup' }, 'önek: "ses arti"');
  assert.deepEqual(eylemAdiniCoz('ses', KAROLAR), { hata: 'belirsiz' });
  assert.deepEqual(eylemAdiniCoz('ses *', KAROLAR), { hata: 'belirsiz' }, 'anlamsız işaret ikisini de seçmez');
  // Uçtan uca: argv -> ad -> karo.
  const ad = komutSatiriEylemi(['x', '--eylem=Ses', '+']).ad;
  assert.deepEqual(eylemAdiniCoz(ad, KAROLAR), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz(komutSatiriEylemi(['x', '--eylem=Ses −']).ad, KAROLAR), { id: 'button.pc_mediavolumedown' });
});

test('h-21: tireyle ayrılmış adlar işaretsiz yazılınca da bulunur ("Salon - Işık" -> "salon isik"); bitişik tire ayraç kalır', () => {
  const karolar = [
    { id: 'light.salon_isik', etiket: 'Salon - Işık', parlaklikKontrol: false },
    { id: 'light.gece_lambasi', etiket: 'Gece-lambası', parlaklikKontrol: false },
  ];
  assert.deepEqual(eylemAdiniCoz('Salon - Işık', karolar), { id: 'light.salon_isik' });
  assert.deepEqual(eylemAdiniCoz('salon isik', karolar), { id: 'light.salon_isik' });
  assert.deepEqual(eylemAdiniCoz('salon eksi isik', karolar), { id: 'light.salon_isik' });
  assert.deepEqual(eylemAdiniCoz('gece lambasi', karolar), { id: 'light.gece_lambasi' });
});

test('h-23: sondaki sayıdan önce tam ad denenir ("salon 2" adlı karo varsa Salon ışığı %2 olmaz)', () => {
  const karolar = [
    { id: 'light.salon', etiket: 'Salon', parlaklikKontrol: true },
    { id: 'scene.salon_2', etiket: 'Salon 2', parlaklikKontrol: false },
    { id: 'light.led', etiket: 'LED şerit', parlaklikKontrol: true },
  ];
  assert.deepEqual(eylemAdiniCoz('salon 2', karolar), { id: 'scene.salon_2' });
  assert.deepEqual(eylemAdiniCoz('Salon  2', karolar), { id: 'scene.salon_2' });
  assert.deepEqual(eylemAdiniCoz('salon 30', karolar), { id: 'light.salon', parlaklik: 30 }, 'tam ad olmayan sayı yine seviye');
  assert.deepEqual(eylemAdiniCoz('salon', karolar), { id: 'light.salon' });
  // Çift tam eşleşme belirsizdir.
  const cift = [...karolar, { id: 'script.salon_2', etiket: 'Salon 2', parlaklikKontrol: false }];
  assert.deepEqual(eylemAdiniCoz('salon 2', cift), { hata: 'belirsiz' });
});

test('h-23: "led %40" ve "led 40%" parlaklık verir; "led 0" kapat anlamına gelir (yalnız parlaklık kontrollü ışıkta)', () => {
  const led = 'light.masa_led_serit';
  assert.deepEqual(eylemAdiniCoz('led %40', KAROLAR), { id: led, parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('led 40%', KAROLAR), { id: led, parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('led % 40', KAROLAR), { id: led, parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('led serit 100%', KAROLAR), { id: led, parlaklik: 100 });
  assert.deepEqual(eylemAdiniCoz('led 0', KAROLAR), { id: led, kapat: true });
  assert.deepEqual(eylemAdiniCoz('led %0', KAROLAR), { id: led, kapat: true });
  assert.deepEqual(eylemAdiniCoz('led 0%', KAROLAR), { id: led, kapat: true });
  assert.equal('parlaklik' in eylemAdiniCoz('led 0', KAROLAR), false, 'kapat parlaklık 0 gibi taşınmaz');
  // Kısılamayan öğede 0 ve yüzde kapat/aç sayılmaz: ad bulunamaz.
  assert.deepEqual(eylemAdiniCoz('ampul 0', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('ampul %40', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('film 0', KAROLAR), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('led 101', KAROLAR), { hata: 'bulunamadi' });
});

// --- 1.4.0: kesin yön (o-13) -------------------------------------------------------------------

const YON_KAROLARI = [
  { id: 'light.salon', etiket: 'Salon', parlaklikKontrol: true },
  { id: 'light.masa_led_serit', etiket: 'LED şerit', parlaklikKontrol: true },
  { id: 'light.smart_multicolor_bulb', etiket: 'Ampul', parlaklikKontrol: false },
  { id: 'fan.vantilator', etiket: 'Vantilatör', parlaklikKontrol: false },
  { id: 'switch.priz', etiket: 'Priz', parlaklikKontrol: false },
  { id: 'scene.film', etiket: 'Film', parlaklikKontrol: false },
  { id: 'scene.ekran_sahnesi', etiket: 'Ekranı kapat sahnesi', parlaklikKontrol: false },
  { id: 'button.pc_bilgisayari_kapat', etiket: 'Bilgisayarı kapat', parlaklikKontrol: false },
  { id: 'button.pc_mediavolumeup', etiket: 'Ses +', parlaklikKontrol: false },
  { id: 'button.pc_mediavolumedown', etiket: 'Ses −', parlaklikKontrol: false },
];

test('o-13: "led +10" / "led -10" parlaklık kontrollü ışığa göreli adım olarak çözülür', () => {
  assert.deepEqual(eylemAdiniCoz('led +10', YON_KAROLARI), { id: 'light.masa_led_serit', yon: { tur: 'goreli', delta: 10 } });
  assert.deepEqual(eylemAdiniCoz('led -10', YON_KAROLARI), { id: 'light.masa_led_serit', yon: { tur: 'goreli', delta: -10 } });
  assert.deepEqual(eylemAdiniCoz('LED ŞERİT +5%', YON_KAROLARI), { id: 'light.masa_led_serit', yon: { tur: 'goreli', delta: 5 } });
  assert.deepEqual(eylemAdiniCoz('led −20', YON_KAROLARI), { id: 'light.masa_led_serit', yon: { tur: 'goreli', delta: -20 } });
  assert.deepEqual(eylemAdiniCoz('vantilator +20', YON_KAROLARI), { id: 'fan.vantilator', yon: { tur: 'goreli', delta: 20 } }, 'vantilatör hızı');
  assert.deepEqual(eylemAdiniCoz('salon -10', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'goreli', delta: -10 } });
});

test('o-13: "salon ac" / "salon kapat" yalnız aç-kapat destekleyen karolar arasında aranır', () => {
  assert.deepEqual(eylemAdiniCoz('salon ac', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'ac' } });
  assert.deepEqual(eylemAdiniCoz('SALON AÇ', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'ac' } });
  assert.deepEqual(eylemAdiniCoz('salon kapat', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'kapat' } });
  assert.deepEqual(eylemAdiniCoz('priz kapat', YON_KAROLARI), { id: 'switch.priz', yon: { tur: 'kapat' } });
  assert.deepEqual(eylemAdiniCoz('ampul ac', YON_KAROLARI), { id: 'light.smart_multicolor_bulb', yon: { tur: 'ac' } }, 'kısılamayan ışık da açılır');
  assert.deepEqual(eylemAdiniCoz('vantilator kapat', YON_KAROLARI), { id: 'fan.vantilator', yon: { tur: 'kapat' } });
  assert.deepEqual(eylemAdiniCoz('salon degistir', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'degistir' } });
  assert.deepEqual(eylemAdiniCoz('salon toggle', YON_KAROLARI), { id: 'light.salon', yon: { tur: 'degistir' } });
});

test('o-13: yön, desteklemeyen karoya (sahne, düğme, kısılamayan ışık) uygulanmaz; bulunamadı kalır', () => {
  // "film ac" Film sahnesini çalıştırmaz: sahnenin açma/kapatma yönü yoktur.
  assert.deepEqual(eylemAdiniCoz('film ac', YON_KAROLARI), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('film kapat', YON_KAROLARI), { hata: 'bulunamadi' });
  // Tam ad önce denenir: adı "Bilgisayarı kapat" olan düğme yalnız bu adla (katlanmış da olsa) çalışır; yön olarak yorumlanmaz.
  assert.deepEqual(eylemAdiniCoz('Bilgisayarı kapat', YON_KAROLARI), { id: 'button.pc_bilgisayari_kapat' }, 'tam ad önce denenir');
  assert.deepEqual(eylemAdiniCoz('bilgisayari kapat', YON_KAROLARI), { id: 'button.pc_bilgisayari_kapat' }, 'katlanmış tam ad da önce denenir');
  assert.deepEqual(eylemAdiniCoz('ekran kapat', YON_KAROLARI), { hata: 'bulunamadi' }, 'sahne "Ekranı kapat sahnesi" ile öneki tutmaz; yön sahneye uygulanmaz');
  assert.deepEqual(eylemAdiniCoz('ampul +10', YON_KAROLARI), { hata: 'bulunamadi' }, 'parlaklık kontrolü olmayan ışığa adım uygulanmaz');
  assert.deepEqual(eylemAdiniCoz('priz +10', YON_KAROLARI), { hata: 'bulunamadi' });
});

test('o-13: tam ad yönden önce gelir; "Ses +" ve "Ses −" yön olarak yorumlanmaz', () => {
  assert.deepEqual(eylemAdiniCoz('Ses +', YON_KAROLARI), { id: 'button.pc_mediavolumeup' });
  assert.deepEqual(eylemAdiniCoz('Ses −', YON_KAROLARI), { id: 'button.pc_mediavolumedown' });
  assert.deepEqual(eylemAdiniCoz('ses -', YON_KAROLARI), { id: 'button.pc_mediavolumedown' });
  assert.deepEqual(eylemAdiniCoz('ses +10', YON_KAROLARI), { hata: 'bulunamadi' }, 'ses düğmesi adım almaz');
  // Adı tam olarak yön gibi görünen karo (ör. "Salon aç" sahnesi) varsa o seçilir.
  const adli = [...YON_KAROLARI, { id: 'scene.salon_ac', etiket: 'Salon aç', parlaklikKontrol: false }];
  assert.deepEqual(eylemAdiniCoz('salon ac', adli), { id: 'scene.salon_ac' });
});

test('o-13: belirsiz ad hiçbir şeyi seçmez; önek eşleşmesi yönlü aramada da en az 2 harf ister', () => {
  const ikiIsik = [
    { id: 'light.salon_tavan', etiket: 'Salon tavan', parlaklikKontrol: true },
    { id: 'light.salon_lamba', etiket: 'Salon lamba', parlaklikKontrol: true },
  ];
  assert.deepEqual(eylemAdiniCoz('salon ac', ikiIsik), { hata: 'belirsiz' });
  assert.deepEqual(eylemAdiniCoz('salon +10', ikiIsik), { hata: 'belirsiz' });
  assert.deepEqual(eylemAdiniCoz('salon tavan ac', ikiIsik), { id: 'light.salon_tavan', yon: { tur: 'ac' } });
  assert.deepEqual(eylemAdiniCoz('salon tav +10', ikiIsik), { id: 'light.salon_tavan', yon: { tur: 'goreli', delta: 10 } });
  assert.deepEqual(eylemAdiniCoz('s ac', ikiIsik), { hata: 'bulunamadi' });
});

test('o-13: eski sözdizimi değişmez ("led 40", "led 0", düz ad, işaretsiz sayı)', () => {
  assert.deepEqual(eylemAdiniCoz('led 40', YON_KAROLARI), { id: 'light.masa_led_serit', parlaklik: 40 });
  assert.deepEqual(eylemAdiniCoz('led 0', YON_KAROLARI), { id: 'light.masa_led_serit', kapat: true });
  assert.deepEqual(eylemAdiniCoz('led', YON_KAROLARI), { id: 'light.masa_led_serit' });
  assert.deepEqual(eylemAdiniCoz('film', YON_KAROLARI), { id: 'scene.film' });
  assert.deepEqual(eylemAdiniCoz('led - 10', YON_KAROLARI), { id: 'light.masa_led_serit', parlaklik: 10 }, 'boşluklu eksi yön değildir: eski çözümleme (işaret atılır, %10)');
  assert.deepEqual(eylemAdiniCoz('led +101', YON_KAROLARI), { hata: 'bulunamadi' });
});

test('o-13: kapı kuralı — kapı/kilit karoları listede olmasa da çözümleme onları üretmez; yön yalnız aç-kapat alanlarına uygulanır', () => {
  // Çağıran (src/eylem.js) listeyi zaten güvenli süzülmüş verir; yön çözümü listede olmayan kimliği asla uydurmaz.
  assert.deepEqual(eylemAdiniCoz('kapi kilidi ac', YON_KAROLARI), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('lock.on_kapi ac', YON_KAROLARI), { hata: 'bulunamadi' });
  assert.deepEqual(eylemAdiniCoz('garaj kapisi kapat', YON_KAROLARI), { hata: 'bulunamadi' });
  // Alan olarak lock/cover/alarm/camera/siren verilse bile (hata durumunda) yön desteklenmez.
  const riskli = [
    { id: 'lock.on_kapi', etiket: 'On kapi', parlaklikKontrol: false },
    { id: 'cover.garaj', etiket: 'Garaj', parlaklikKontrol: false },
    { id: 'alarm_control_panel.ev', etiket: 'Alarm', parlaklikKontrol: false },
    { id: 'camera.bahce', etiket: 'Bahce', parlaklikKontrol: false },
    { id: 'siren.siren', etiket: 'Siren', parlaklikKontrol: false },
  ];
  for (const ad of ['on kapi ac', 'on kapi kapat', 'garaj ac', 'garaj kapat', 'alarm kapat', 'alarm ac', 'bahce ac', 'siren kapat', 'garaj +10']) {
    assert.deepEqual(eylemAdiniCoz(ad, riskli), { hata: 'bulunamadi' }, ad);
  }
});

test('o-13: argv — tırnaksız eksi adım ("--eylem=led -10") seçenek sayılmaz, ada eklenir', () => {
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '-10']), { ad: 'led -10' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem', 'led', '-10']), { ad: 'led -10' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '+10']), { ad: 'led +10' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '-10%']), { ad: 'led -10%' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=salon', 'ac']), { ad: 'salon ac' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led -10']), { ad: 'led -10' });
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '-gizli']), { ad: 'led' }, 'gerçek seçenek yine ayrılır');
  assert.deepEqual(komutSatiriEylemi(['x', '--eylem=led', '-1000']), { ad: 'led' }, 'üç basamaktan uzun sayı seçenek sayılır');
  const ad = komutSatiriEylemi(['x', '--eylem=led', '-10']).ad;
  assert.deepEqual(eylemAdiniCoz(ad, YON_KAROLARI), { id: 'light.masa_led_serit', yon: { tur: 'goreli', delta: -10 } });
});
