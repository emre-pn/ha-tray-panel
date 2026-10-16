'use strict';

/**
 * 1.4.0 palet servis komutları (sayfa tarafı): "salon klima 24", "masa sicak", "tv ses 30", "ev modu uyku".
 * Sözlük ve çözümleme test/arama-komut.test.js'te; burada palet satırı, rozetler, Enter / tıklama davranışı ve onay (basılı tutma)
 * yolu sahte DOM ile sınanır. Kural: komut yalnız bir öneridir; onay isteyen servis YALNIZ basılı tutmayla gider, geçersiz komut
 * (aralık dışı, desteklenmiyor) hiçbir şey göndermez ve basılı tutmayı bile başlatmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, paletAc, sorguYaz, enter, paletSatirlari, akit } = require('./yuzey-kartlar-sahte');

const KLIMA = karo('climate.salon', 'Salon klima', {
  grup: 'iklim',
  grupEtiketi: 'İklim',
  varsayilanEylem: false,
  onayliServisler: ['set_hvac_mode'],
  ozellik: { mod: 'cool', modlar: ['off', 'cool', 'heat', 'auto'], hedefSicaklik: 24, enAz: 16, enCok: 30, adim: 0.5, mevcutSicaklik: 26, hvacEylemi: null, mevcutNem: null },
});
const TV = karo('media_player.tv', 'Salon TV', {
  grup: 'medya',
  grupEtiketi: 'Medya',
  varsayilanEylem: false,
  onayliServisler: ['turn_off'],
  ozellik: { durum: 'playing', baslik: 'Film', sanatci: null, ses: 0.3, sessiz: false, kaynak: 'HDMI 1', kaynaklar: ['HDMI 1', 'HDMI 2'], sure: null, konum: null, konumZamani: null },
});
const MASA = karo('light.masa', 'Masa', {
  grup: 'isik',
  grupEtiketi: 'Işık',
  durum: 'acik',
  yuzde: 60,
  ozellik: { renkModlari: ['color_temp', 'hs'], enAzKelvin: 2200, enCokKelvin: 6500, renkSicakligi: null, rgb: null },
});
const LED = karo('light.led_serit', 'LED şerit', { grup: 'isik', grupEtiketi: 'Işık', durum: 'acik', yuzde: 60, parlaklikKontrol: true, ozellik: { renkModlari: ['brightness'], enAzKelvin: null, enCokKelvin: null, renkSicakligi: null, rgb: null } });
const EV_MODU = karo('input_select.ev_modu', 'Ev modu', {
  grup: 'yardimci',
  grupEtiketi: 'Yardımcılar',
  sinif: 'yikici',
  varsayilanEylem: false,
  onayliServisler: ['select_option'],
  ozellik: { secenek: 'Ev', secenekler: ['Ev', 'Dışarıda', 'Uyku'] },
});
const SENSOR = karo('sensor.sicaklik', 'Oda sıcaklığı', { varsayilanEylem: false, ozellik: { deger: '21.5', sayi: 21.5, birim: '°C', sinif: 'temperature', durumSinifi: null, hassasiyet: null } });
const SAHNE = karo('scene.film', 'Film', { grup: 'sahne', grupEtiketi: 'Sahne', durum: 'notr' });

const MODEL = {
  gruplar: [
    { kod: 'isik', etiket: 'Işık', karolar: [MASA, LED] },
    { kod: 'iklim', etiket: 'İklim', karolar: [KLIMA] },
    { kod: 'sahne', etiket: 'Sahne', karolar: [SAHNE] },
    { kod: 'medya', etiket: 'Medya', karolar: [TV] },
    { kod: 'yardimci', etiket: 'Yardımcılar', karolar: [EV_MODU] },
    { kod: 'diger', etiket: 'Diğer', karolar: [SENSOR] },
  ],
  sonlar: [],
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null },
};

const satirMetni = (sayfa, sira = 0) => paletSatirlari(sayfa)[sira].textContent;

test('boş sorgu: tek tıklama eylemi olmayan karolar da listelenir ve durum özetleri görünür (iklim, medya, seçici)', async () => {
  const sayfa = await paletAc({ model: MODEL });
  const metin = paletSatirlari(sayfa).map((s) => s.textContent).join('|');
  assert.match(metin, /Salon klima.*Soğut · 24°/);
  assert.match(metin, /Salon TV.*Film/);
  assert.match(metin, /Ev modu.*Ev/);
});

test('"salon klima 24": satır "24°" rozeti taşır; Enter servisi ve değeri son değer olarak yollar (onay yok), palet yanıtla kapanır', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima 24');
  assert.equal(paletSatirlari(sayfa).length, 1);
  assert.match(satirMetni(sayfa), /Salon klima/);
  assert.match(satirMetni(sayfa), /24°/);
  assert.doesNotMatch(satirMetni(sayfa), /basılı tut/);
  enter(sayfa);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 24 }, sonDeger: true }]);
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1);
});

test('"salon klima 23,5" ve "salon klima 40": ondalık virgül kabul edilir; aralık dışı değer rozetle işaretlenir, Enter ipucu verir ve HİÇBİR şey göndermez', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima 23,5');
  enter(sayfa);
  assert.deepEqual(sayfa.calistirmalar().map((y) => y.veri), [{ temperature: 23.5 }]);

  const disari = await paletAc({ model: MODEL });
  sorguYaz(disari, 'salon klima 40');
  assert.match(satirMetni(disari), /Aralık dışı/);
  enter(disari);
  disari.zaman.ilerle(3000);
  assert.deepEqual(disari.calistirmalar(), []);
  assert.deepEqual(disari.basiliBaslamalar(), []);
  assert.match(disari.ipucu() || '', /^$/, 'ipucu süre sonunda silinir');
  enter(disari);
  assert.match(disari.ipucu(), /aralığı dışında/);
  assert.equal(disari.cagrilar.filter((c) => c[0] === 'kapat').length, 0, 'palet kapanmaz: kullanıcı düzeltebilsin');
});

test('"salon klima isit": mod değişimi onaylıdır; satır "Basılı tut" der, Enter basılı tutmayı başlatır, ~0,8 sn sonra servis basili:true ile gider', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima isit');
  assert.match(satirMetni(sayfa), /Isıt/);
  assert.match(satirMetni(sayfa), /basılı tut/);
  enter(sayfa);
  assert.deepEqual(sayfa.basiliBaslamalar(), ['climate.salon']);
  sayfa.zaman.ilerle(799);
  assert.deepEqual(sayfa.calistirmalar(), []);
  sayfa.zaman.ilerle(2);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, basili: true }]);
});

test('onaylı komut: fareyle satıra düz tıklamak göndermez; basılı tutmak gönderir; erken bırakmak iptal eder', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima isit');
  const satir = paletSatirlari(sayfa)[0];
  satir.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), []);
  satir.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(300);
  satir.gonder('pointerup');
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  paletSatirlari(sayfa)[0].gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(900);
  assert.deepEqual(sayfa.calistirmalar().map((y) => y.servis), ['set_hvac_mode']);
});

test('klima yalnız adı yazılınca: komut yok, tek tıklama eylemi yok; Enter örnek komutu söyler ve hiçbir şey göndermez', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima');
  assert.match(satirMetni(sayfa), /Salon klima 24/, 'satırda örnek komut');
  enter(sayfa);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.match(sayfa.ipucu(), /tek tıklama eylemi yok/);
  assert.match(sayfa.ipucu(), /Salon klima 24/);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0);
});

test('salt okunur karo (sensör) palette bulunur ama örnek komut / ipucu üretmez; Enter hiçbir şey yapmaz', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'oda sicakligi');
  assert.equal(paletSatirlari(sayfa).length, 1);
  assert.match(satirMetni(sayfa), /Oda sıcaklığı/);
  assert.doesNotMatch(satirMetni(sayfa), /Oda sıcaklığı \d|örn/);
  enter(sayfa);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(sayfa.ipucu(), '');
});

test('medya komutları: "tv ses 30" ses düzeyini 0-1 olarak yollar; "tv sessiz", "tv hdmi 2" tek adımda gider; "tv kapat" onaylıdır', async () => {
  const ses = await paletAc({ model: MODEL });
  sorguYaz(ses, 'salon tv ses 30');
  assert.match(satirMetni(ses), /Ses %30/);
  enter(ses);
  assert.deepEqual(ses.calistirmalar(), [{ kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.3 }, sonDeger: true }]);

  const sessiz = await paletAc({ model: MODEL });
  sorguYaz(sessiz, 'salon tv sessiz');
  enter(sessiz);
  assert.deepEqual(sessiz.calistirmalar().map((y) => [y.servis, y.veri]), [['volume_mute', { is_volume_muted: true }]]);

  const kaynak = await paletAc({ model: MODEL });
  sorguYaz(kaynak, 'salon tv hdmi 2');
  assert.match(satirMetni(kaynak), /Kaynak: HDMI 2/);
  enter(kaynak);
  assert.deepEqual(kaynak.calistirmalar().map((y) => y.veri), [{ source: 'HDMI 2' }]);

  const kapat = await paletAc({ model: MODEL });
  sorguYaz(kapat, 'salon tv kapat');
  assert.match(satirMetni(kapat), /basılı tut/);
  enter(kapat);
  assert.deepEqual(kapat.calistirmalar(), []);
  kapat.zaman.ilerle(900);
  assert.deepEqual(kapat.calistirmalar(), [{ kimlik: 'media_player.tv', servis: 'turn_off', basili: true }]);

  const buyuk = await paletAc({ model: MODEL });
  sorguYaz(buyuk, 'salon tv ses 130');
  assert.match(satirMetni(buyuk), /Aralık dışı/);
  enter(buyuk);
  assert.deepEqual(buyuk.calistirmalar(), []);
});

test('ışık rengi komutları: "masa sicak" kelvin, "masa mavi" rgb yollar; parlaklık söz dizimi ("led 40") ve "ses 40" kuralı bozulmaz', async () => {
  const sicak = await paletAc({ model: MODEL });
  sorguYaz(sicak, 'masa sicak');
  assert.match(satirMetni(sicak), /Sıcak beyaz · 2700 K/);
  enter(sicak);
  assert.deepEqual(sicak.calistirmalar(), [{ kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 2700 }, sonDeger: true }]);

  const mavi = await paletAc({ model: MODEL });
  sorguYaz(mavi, 'masa mavi');
  enter(mavi);
  assert.deepEqual(mavi.calistirmalar().map((y) => y.veri), [{ rgb_color: [30, 90, 255] }]);

  const led = await paletAc({ model: MODEL });
  sorguYaz(led, 'led 40');
  enter(led);
  assert.deepEqual(led.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 40, sonDeger: true }]);

  const renksiz = await paletAc({ model: MODEL });
  sorguYaz(renksiz, 'led sicak');
  assert.match(satirMetni(renksiz), /desteklemiyor|desteklenmiyor/i);
  enter(renksiz);
  assert.deepEqual(renksiz.calistirmalar(), [], 'rengi desteklemeyen ışığa renk komutu gitmez');
});

test('seçici komutu: "ev modu uyku" varsayılan onaylıdır (basılı tut); listede olmayan seçenek satır üretmez', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'ev modu uyku');
  assert.match(satirMetni(sayfa), /Uyku/);
  assert.match(satirMetni(sayfa), /basılı tut/);
  enter(sayfa);
  sayfa.zaman.ilerle(900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'input_select.ev_modu', servis: 'select_option', veri: { option: 'Uyku' }, basili: true }]);

  const yok = await paletAc({ model: MODEL });
  sorguYaz(yok, 'ev modu kapi acik');
  enter(yok);
  yok.zaman.ilerle(2000);
  assert.deepEqual(yok.calistirmalar(), []);
  assert.deepEqual(yok.basiliBaslamalar(), []);
});

test('geçersiz komut satırına fareyle tıklamak da hiçbir şey göndermez ve basılı tutmayı başlatmaz', async () => {
  const sayfa = await paletAc({ model: MODEL });
  sorguYaz(sayfa, 'salon klima 99');
  const satir = paletSatirlari(sayfa)[0];
  satir.gonder('click', { detail: 1 });
  satir.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.deepEqual(sayfa.basiliBaslamalar(), []);
});

test('düz sahne eşleşmesi komuttan önce gelir: adı sorgunun kendisi olan karo varsa komut aranmaz', async () => {
  const ozel = karo('scene.salon_24', 'Salon 24', { grup: 'sahne', grupEtiketi: 'Sahne', durum: 'notr' });
  const sayfa = await paletAc({ model: { ...MODEL, gruplar: [...MODEL.gruplar, { kod: 'sahne2', etiket: 'S', karolar: [ozel] }] } });
  sorguYaz(sayfa, 'salon 24');
  enter(sayfa);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'scene.salon_24' }]);
});

test('İngilizce arayüzde palet rozetleri ve ipucu İngilizcedir', async () => {
  const sayfa = await paletAc({ model: MODEL, dil: 'en' });
  sorguYaz(sayfa, 'salon klima 99');
  assert.match(satirMetni(sayfa), /Out of range/);
  enter(sayfa);
  assert.match(sayfa.ipucu(), /outside the device/);
  const ornek = await paletAc({ model: MODEL, dil: 'en' });
  sorguYaz(ornek, 'salon tv hdmi 2');
  assert.match(satirMetni(ornek), /Source: HDMI 2/);
  const bos = await paletAc({ model: MODEL, dil: 'en' });
  sorguYaz(bos, 'salon klima');
  enter(bos);
  assert.match(bos.ipucu(), /no one-click action/);
});
