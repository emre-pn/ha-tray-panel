'use strict';

/**
 * Ayarlar sayfasının "Bilgi kartları ve sensörler" bölümü (src/ayarlar.html #bolumBilgi + src/ayarlar.js bilgi bölümü): o-04, o-07,
 * o-08, o-09, o-10, o-11. Sahte DOM ve sahte ana süreç köprüsü (test/ayarlar-sahte.js); gerçek pencere ve Home Assistant YOK.
 * Sınananlar: HTML yapısı, açılış değerleri, seçeneklerin yalnız izinli alanlardan kurulması (Kapı Kuralı sınırı), ekle/kaldır ve sınırlar,
 * kirli durum, kayıt yükü (sayılar sayı), reddedilen alanın işaretlenmesi, yüklenmemiş varlıklarda kayıtlı seçimin korunması, dil değişimi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const AYARLAR = require('../src/lib/ceviri/ayarlar');
const { AYAR_ALANLARI: TUM_AYAR_ALANLARI } = require('../src/lib/ayar-alanlari');

// Bu dosya yalnız bilgi grubunun alanlarını sınar (birleşik tabloda başka gruplar da var).
const BILGI_ALAN_ADLARI = [
  'sensorSeridi', 'sensorGrafik', 'sensorGrafikSaat', 'pilEsigi', 'sensorTepsiIpucu', 'ustKart1', 'ustKart2', 'havaVarligi',
  'saatBicimi', 'tarihBicimi', 'takvimler', 'takvimGunSayisi', 'yapilacakListeleri', 'hizliListe',
];
const AYAR_ALANLARI = TUM_AYAR_ALANLARI.filter((a) => BILGI_ALAN_ADLARI.includes(a.ad));
const { HTML, BETIK, AYAR, CIHAZLAR, akit, duzles, acilmisSayfa } = require('./ayarlar-sahte');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const secenekler = (kimlik, sayfa) => sayfa.oge(kimlik).children.map((o) => [o.value, o.textContent]);
const degerler = (kimlik, sayfa) => secenekler(kimlik, sayfa).map(([d]) => d);
const bilgiSatirlari = (sayfa, kap) => sayfa.oge(kap).children.filter((c) => c.className === 'bilgi-satir');
const satirAdi = (satir) => satir.bul((o) => o.className === 'bilgi-satir-ad')[0].textContent;
const kaldirDugmesi = (satir) => satir.bul((o) => o.etiket === 'button')[0];
const gecersizMi = (oge) => oge.classList.contains('gecersiz');

/** Sensör ekle: seçim kutusunda kimliği seç, değişiklik olayını gönder, ekle düğmesine bas. */
function ekle(sayfa, ekleKutusu, dugme, kimlik) {
  sayfa.oge(ekleKutusu).value = kimlik;
  sayfa.oge(ekleKutusu).dispatchEvent({ type: 'change' });
  sayfa.oge(dugme).dispatchEvent({ type: 'click' });
}

const SENSORLER = Array.from({ length: 8 }, (_, i) => ({
  entity_id: `sensor.oda_${i + 1}`,
  ad: `Oda ${i + 1}`,
  alan: 'sensor',
  alanEtiketi: 'Sensörler',
  durum: '21',
  onayZorunlu: false,
  varsayilanOnay: false,
  kisayolUygun: false,
  gizli: false,
}));

/** cihazlar:getir yanıtı: sensör, ikili sensör, hava, gizli aday, sızmış kilit/kapak; bilgiVarliklari: takvim, yapılacaklar, sızmış alarm. */
const BILGI_CIHAZLAR = {
  ...CIHAZLAR,
  cihazlar: [
    ...CIHAZLAR.cihazlar,
    { entity_id: 'sensor.salon_sicaklik', ad: 'Salon Sıcaklık', alan: 'sensor', alanEtiketi: 'Sensörler', durum: '21,4', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
    { entity_id: 'sensor.gizli_olcum', ad: 'Gizli Ölçüm', alan: 'sensor', alanEtiketi: 'Sensörler', durum: '3', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: true },
    { entity_id: 'binary_sensor.hareket', ad: 'Hareket', alan: 'binary_sensor', alanEtiketi: 'İkili sensörler', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
    { entity_id: 'weather.ev', ad: 'Ev Hava', alan: 'weather', alanEtiketi: 'Hava', durum: 'güneşli', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
    // Ana süreç bunları listeye hiç koymaz; sayfa yine de yalnız izinli alanlardan seçenek kurar (savunma katmanı).
    { entity_id: 'lock.on_kapi', ad: 'Ön Kapı', alan: 'lock', alanEtiketi: 'Kilit', durum: 'kilitli', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
    { entity_id: 'cover.garaj', ad: 'Garaj', alan: 'cover', alanEtiketi: 'Kapak', durum: 'kapalı', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
  ],
  bilgiVarliklari: [
    { entity_id: 'calendar.aile', ad: 'Aile', alan: 'calendar', alanEtiketi: 'Takvim' },
    { entity_id: 'calendar.is', ad: 'İş', alan: 'calendar', alanEtiketi: 'Takvim' },
    { entity_id: 'todo.alisveris', ad: 'Alışveriş', alan: 'todo', alanEtiketi: 'Yapılacaklar' },
    { entity_id: 'todo.is_listesi', ad: 'İş Listesi', alan: 'todo', alanEtiketi: 'Yapılacaklar' },
    { entity_id: 'alarm_control_panel.ev', ad: 'Ev Alarmı', alan: 'alarm_control_panel', alanEtiketi: 'Alarm', durum: '' },
  ],
};

// ---------------------------------------------------------------------------
// HTML yapısı
// ---------------------------------------------------------------------------

test('bilgi bölümü: katlanır bölüm, form alanları ve sınırlar ayar tablosuyla uyumlu', () => {
  assert.match(HTML, /<details class="bolum" id="bolumBilgi">/);
  const bolum = HTML.slice(HTML.indexOf('id="bolumBilgi"'), HTML.indexOf('id="bolumBaslangic"'));
  for (const kimlik of [
    'sensorSeridiEkle', 'sensorSeridiListesi', 'btnSensorSeridiEkle', 'sensorGrafik', 'sensorGrafikSaat', 'pilEsigi', 'pilEsigiHata',
    'sensorTepsiIpucu', 'ustKart1', 'ustKart2', 'havaVarligi', 'saatBicimi', 'tarihBicimi', 'takvimlerEkle', 'takvimlerListesi',
    'btnTakvimlerEkle', 'takvimGunSayisi', 'takvimGunHata', 'yapilacakListeleriEkle', 'yapilacakListeleriListesi',
    'btnYapilacakListeleriEkle', 'hizliListe', 'bilgiYuklemeIpucu',
  ]) assert.match(bolum, new RegExp(`id="${kimlik}"`), `#${kimlik} bölümde yok`);
  // sayı kutularının sınırı ayar tablosundaki aralıkla aynı
  const alan = (ad) => AYAR_ALANLARI.find((a) => a.ad === ad);
  assert.deepEqual([alan('pilEsigi').duzelt(4), alan('pilEsigi').duzelt(5), alan('pilEsigi').duzelt(50), alan('pilEsigi').duzelt(51)], [undefined, 5, 50, undefined]);
  assert.match(bolum, /id="pilEsigi" min="5" max="50"/);
  assert.deepEqual([alan('takvimGunSayisi').duzelt(0), alan('takvimGunSayisi').duzelt(1), alan('takvimGunSayisi').duzelt(14), alan('takvimGunSayisi').duzelt(15)], [undefined, 1, 14, undefined]);
  assert.match(bolum, /id="takvimGunSayisi" min="1" max="14"/);
  // sabit seçenekler ayar tablosundaki değerlerle aynı
  const secenekDegerleri = (kimlik) => [...new RegExp(`<select id="${kimlik}">([\\s\\S]*?)</select>`).exec(bolum)[1].matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(secenekDegerleri('sensorGrafikSaat'), ['1', '6', '24']);
  assert.deepEqual(secenekDegerleri('saatBicimi'), ['sistem', '24', '12']);
  assert.deepEqual(secenekDegerleri('tarihBicimi'), ['orta', 'kisa', 'uzun', 'yok']);
  for (const v of [1, 6, 24]) assert.equal(alan('sensorGrafikSaat').duzelt(v), v);
  // ekleme düğmeleri bağlı oldukları etiketle adlandırılır; etiketsiz giriş yok
  assert.match(bolum, /id="btnSensorSeridiEkle"[^>]*aria-labelledby="btnSensorSeridiEkle sensorSeridiEtiket"/);
  assert.match(bolum, /<label for="sensorSeridiEkle" id="sensorSeridiEtiket"/);
  assert.match(bolum, /<label for="hizliListe"/);
});

test('bilgi bölümü: betik yalnız textContent ile yazar, sayfaya yeni betik dosyası eklenmez, sözlükteki her ayar.bilgi.* anahtarı kullanılır', () => {
  const bolum = BETIK.slice(BETIK.indexOf('--- Bilgi kartları'), BETIK.indexOf('--- Kısayol yakalama'));
  assert.ok(bolum.length > 3000, 'bilgi bölümü bulunamadı');
  assert.doesNotMatch(bolum, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
  assert.match(bolum, /textContent/);
  assert.match(HTML, /<script src="ayarlar\.js"><\/script>\s*<\/body>/);
  // sözlükteki her ayar.bilgi.* anahtarı HTML'de ya da betikte kullanılıyor
  for (const anahtar of Object.keys(AYARLAR.tr).filter((k) => k.startsWith('ayar.bilgi.'))) {
    assert.ok(HTML.includes(`"${anahtar}"`) || BETIK.includes(`'${anahtar}'`), `${anahtar} kullanılmıyor`);
  }
});

// ---------------------------------------------------------------------------
// Açılış ve varsayılanlar
// ---------------------------------------------------------------------------

test('açılış: bilgi alanı olmayan ayar özeti varsayılanlarla yüklenir, kirli sayılmaz, kayıt yükü varsayılanları taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('sensorGrafik').checked, true);
  assert.equal(sayfa.oge('sensorGrafikSaat').value, '6');
  assert.equal(sayfa.oge('pilEsigi').value, '20');
  assert.equal(sayfa.oge('sensorTepsiIpucu').checked, false);
  assert.equal(sayfa.oge('ustKart1').value, 'yok');
  assert.equal(sayfa.oge('ustKart2').value, 'yok');
  assert.equal(sayfa.oge('havaVarligi').value, '');
  assert.equal(sayfa.oge('saatBicimi').value, 'sistem');
  assert.equal(sayfa.oge('tarihBicimi').value, 'orta');
  assert.equal(sayfa.oge('takvimGunSayisi').value, '3');
  assert.equal(sayfa.oge('hizliListe').value, '');
  assert.equal(bilgiSatirlari(sayfa, 'sensorSeridiListesi').length, 0);
  assert.match(sayfa.oge('sensorSeridiListesi').textContent, /Henüz seçilmedi/);
  assert.equal(kirliMi(sayfa), false);

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual(
    { sensorSeridi: yuk.sensorSeridi, sensorGrafik: yuk.sensorGrafik, sensorGrafikSaat: yuk.sensorGrafikSaat, pilEsigi: yuk.pilEsigi, sensorTepsiIpucu: yuk.sensorTepsiIpucu },
    { sensorSeridi: [], sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20, sensorTepsiIpucu: false },
  );
  assert.deepEqual(
    { ustKart1: yuk.ustKart1, ustKart2: yuk.ustKart2, havaVarligi: yuk.havaVarligi, saatBicimi: yuk.saatBicimi, tarihBicimi: yuk.tarihBicimi },
    { ustKart1: 'yok', ustKart2: 'yok', havaVarligi: '', saatBicimi: 'sistem', tarihBicimi: 'orta' },
  );
  assert.deepEqual(
    { takvimler: yuk.takvimler, takvimGunSayisi: yuk.takvimGunSayisi, yapilacakListeleri: yuk.yapilacakListeleri, hizliListe: yuk.hizliListe },
    { takvimler: [], takvimGunSayisi: 3, yapilacakListeleri: [], hizliListe: '' },
  );
  // yalnızca ayar tablosundaki bilgi alanları gider
  const bilgiAdlari = AYAR_ALANLARI.map((a) => a.ad);
  for (const ad of bilgiAdlari) assert.ok(ad in yuk, `${ad} yükte yok`);
});

test('açılış: kayıtlı bilgi ayarları alanlara yazılır; varlıklar yüklenmeden de kayıtlı kimlikler görünür ve kirli sayılmaz', async () => {
  const ayar = {
    ...AYAR,
    sensorSeridi: ['sensor.salon_sicaklik', 'binary_sensor.hareket'],
    sensorGrafik: false,
    sensorGrafikSaat: 24,
    pilEsigi: 35,
    sensorTepsiIpucu: true,
    ustKart1: 'saat',
    ustKart2: 'sensor.salon_sicaklik',
    havaVarligi: 'weather.ev',
    saatBicimi: '12',
    tarihBicimi: 'uzun',
    takvimler: ['calendar.aile'],
    takvimGunSayisi: 7,
    yapilacakListeleri: ['todo.alisveris'],
    hizliListe: 'todo.alisveris',
  };
  // Varlık listesi alınamıyor (HA'ya ulaşılamıyor): kayıtlı seçimler yine de görünür ve korunur.
  const sayfa = await acilmisSayfa({ ayar, cihazlar: { ok: false, hata: 'bağlanılamadı' } });
  assert.equal(sayfa.oge('sensorGrafik').checked, false);
  assert.equal(sayfa.oge('sensorGrafikSaat').value, '24');
  assert.equal(sayfa.oge('pilEsigi').value, '35');
  assert.equal(sayfa.oge('sensorTepsiIpucu').checked, true);
  assert.equal(sayfa.oge('ustKart1').value, 'saat');
  assert.equal(sayfa.oge('ustKart2').value, 'sensor.salon_sicaklik');
  assert.deepEqual(degerler('ustKart2', sayfa), ['yok', 'saat', 'hava', 'medya', 'sensor.salon_sicaklik'], 'kayıtlı kimlik seçenek olarak eklenir');
  assert.equal(sayfa.oge('havaVarligi').value, 'weather.ev');
  assert.equal(sayfa.oge('saatBicimi').value, '12');
  assert.equal(sayfa.oge('tarihBicimi').value, 'uzun');
  assert.equal(sayfa.oge('takvimGunSayisi').value, '7');
  assert.equal(sayfa.oge('hizliListe').value, 'todo.alisveris');
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['sensor.salon_sicaklik', 'binary_sensor.hareket'], 'ad bilinmiyorsa kimlik yazılır');
  assert.deepEqual(bilgiSatirlari(sayfa, 'takvimlerListesi').map(satirAdi), ['calendar.aile']);
  assert.deepEqual(bilgiSatirlari(sayfa, 'yapilacakListeleriListesi').map(satirAdi), ['todo.alisveris']);
  assert.equal(sayfa.oge('bilgiYuklemeIpucu').style.display, 'block', 'seçenekler yüklenemediği söylenir');
  assert.equal(sayfa.oge('sensorSeridiEkle').disabled, true, 'aday yokken ekleme kutusu kapalı');
  assert.equal(kirliMi(sayfa), false);

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual(yuk.sensorSeridi, ['sensor.salon_sicaklik', 'binary_sensor.hareket'], 'yüklenemeyen seçenekler kayıtlı seçimi silmez');
  assert.equal(yuk.sensorGrafikSaat, 24);
  assert.equal(yuk.pilEsigi, 35);
  assert.equal(yuk.takvimGunSayisi, 7);
  assert.equal(yuk.ustKart2, 'sensor.salon_sicaklik');
  assert.equal(yuk.hizliListe, 'todo.alisveris');
});

// ---------------------------------------------------------------------------
// Varlık seçenekleri (Kapı Kuralı sınırı)
// ---------------------------------------------------------------------------

test('seçenekler: yalnız sensör/ikili sensör, hava, takvim ve yapılacaklar alanlarından; gizli aday, kilit, kapak ve alarm sunulmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: BILGI_CIHAZLAR });
  assert.deepEqual(degerler('sensorSeridiEkle', sayfa), ['', 'sensor.salon_sicaklik', 'binary_sensor.hareket']);
  assert.deepEqual(degerler('ustKart1', sayfa), ['yok', 'saat', 'hava', 'medya', 'sensor.salon_sicaklik', 'binary_sensor.hareket']);
  assert.deepEqual(degerler('havaVarligi', sayfa), ['', 'weather.ev']);
  assert.deepEqual(degerler('takvimlerEkle', sayfa), ['', 'calendar.aile', 'calendar.is']);
  assert.deepEqual(degerler('yapilacakListeleriEkle', sayfa), ['', 'todo.alisveris', 'todo.is_listesi']);
  assert.deepEqual(degerler('hizliListe', sayfa), ['', 'todo.alisveris', 'todo.is_listesi']);
  const tumu = ['sensorSeridiEkle', 'ustKart1', 'ustKart2', 'havaVarligi', 'takvimlerEkle', 'yapilacakListeleriEkle', 'hizliListe']
    .flatMap((k) => degerler(k, sayfa));
  for (const yasak of ['lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'sensor.gizli_olcum', 'light.salon_lambasi', 'script.kendi_scriptim']) {
    assert.ok(!tumu.includes(yasak), `${yasak} seçenek olarak sunulmamalı`);
  }
  assert.equal(secenekler('sensorSeridiEkle', sayfa)[1][1], 'Salon Sıcaklık (sensor.salon_sicaklik)', 'ad ve kimlik birlikte yazılır');
  assert.equal(secenekler('ustKart1', sayfa)[1][1], 'Saat ve tarih');
  assert.equal(secenekler('ustKart1', sayfa)[0][1], 'Boş');
  assert.equal(sayfa.oge('bilgiYuklemeIpucu').style.display, 'none');
});

test('seçili kayıtlı gizli aday listede yine görünür ve seçili sensör ekleme kutusundan düşer', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, sensorSeridi: ['sensor.gizli_olcum', 'sensor.salon_sicaklik'] }, cihazlar: BILGI_CIHAZLAR });
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['Gizli Ölçüm', 'Salon Sıcaklık'], 'ad yüklenince satır adı yazılır');
  assert.deepEqual(degerler('sensorSeridiEkle', sayfa), ['', 'binary_sensor.hareket']);
});

// ---------------------------------------------------------------------------
// Ekle, kaldır, sınırlar
// ---------------------------------------------------------------------------

test('sensör ekle ve kaldır: sıra korunur, kirli durum doğru, kayıt yükü seçilen sırayla gider, geri alınınca kirli kalmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: BILGI_CIHAZLAR });
  assert.equal(sayfa.oge('btnSensorSeridiEkle').disabled, true, 'seçim yokken düğme kapalı');
  sayfa.oge('sensorSeridiEkle').value = 'binary_sensor.hareket';
  sayfa.oge('sensorSeridiEkle').dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge('btnSensorSeridiEkle').disabled, false);
  sayfa.oge('btnSensorSeridiEkle').dispatchEvent({ type: 'click' });
  ekle(sayfa, 'sensorSeridiEkle', 'btnSensorSeridiEkle', 'sensor.salon_sicaklik');
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['Hareket', 'Salon Sıcaklık']);
  assert.deepEqual(degerler('sensorSeridiEkle', sayfa), [''], 'eklenenler kutudan düşer');
  assert.match(secenekler('sensorSeridiEkle', sayfa)[0][1], /başka varlık yok/);
  assert.equal(kirliMi(sayfa), true);

  await kaydet(sayfa);
  assert.deepEqual(sonKayitYuku(sayfa).sensorSeridi, ['binary_sensor.hareket', 'sensor.salon_sicaklik']);
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra temiz');
  assert.deepEqual(sayfa.sunucu.sensorSeridi, ['binary_sensor.hareket', 'sensor.salon_sicaklik']);

  // iki kez aynı kimlik eklenmez; kaldırınca satır gider, kutuya geri döner
  const ilk = bilgiSatirlari(sayfa, 'sensorSeridiListesi')[0];
  assert.match(kaldirDugmesi(ilk).getAttribute('aria-label'), /Hareket öğesini kaldır/);
  kaldirDugmesi(ilk).dispatchEvent({ type: 'click' });
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['Salon Sıcaklık']);
  assert.ok(degerler('sensorSeridiEkle', sayfa).includes('binary_sensor.hareket'));
  assert.equal(kirliMi(sayfa), true);
  assert.equal(sayfa.sonOdak(), sayfa.oge('sensorSeridiEkle'), 'kaldırınca odak ekleme kutusuna döner');
  ekle(sayfa, 'sensorSeridiEkle', 'btnSensorSeridiEkle', 'binary_sensor.hareket'); // eski sıraya dönmez: sona eklenir
  assert.equal(kirliMi(sayfa), true, 'sıra değiştiği için kirli');
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['Salon Sıcaklık', 'Hareket']);
});

test('sensör şeridi en çok 6, takvim ve yapılacaklar en çok 4: sınır dolunca ekleme kapanır ve nedeni yazılır; kaldırınca açılır', async () => {
  const cihazlar = { ...CIHAZLAR, cihazlar: [...CIHAZLAR.cihazlar, ...SENSORLER], bilgiVarliklari: [] };
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar });
  for (let i = 1; i <= 6; i += 1) ekle(sayfa, 'sensorSeridiEkle', 'btnSensorSeridiEkle', `sensor.oda_${i}`);
  assert.equal(bilgiSatirlari(sayfa, 'sensorSeridiListesi').length, 6);
  assert.equal(sayfa.oge('sensorSeridiEkle').disabled, true);
  assert.equal(sayfa.oge('btnSensorSeridiEkle').disabled, true);
  assert.equal(secenekler('sensorSeridiEkle', sayfa)[0][1], 'En fazla 6 öğe seçilebilir');
  assert.deepEqual(degerler('sensorSeridiEkle', sayfa), ['']);
  // sınır dolu iken zorla eklemeye çalışmak yükü büyütmez
  sayfa.oge('sensorSeridiEkle').value = 'sensor.oda_7';
  sayfa.oge('btnSensorSeridiEkle').dispatchEvent({ type: 'click' });
  assert.equal(bilgiSatirlari(sayfa, 'sensorSeridiListesi').length, 6);
  assert.equal(sayfa.sonOdak(), bilgiSatirlari(sayfa, 'sensorSeridiListesi')[0].bul((o) => o.etiket === 'button')[0], 'kutu kapanınca odak ilk kaldır düğmesine gider');
  kaldirDugmesi(bilgiSatirlari(sayfa, 'sensorSeridiListesi')[2]).dispatchEvent({ type: 'click' });
  assert.equal(bilgiSatirlari(sayfa, 'sensorSeridiListesi').length, 5);
  assert.equal(sayfa.oge('sensorSeridiEkle').disabled, false);
  await kaydet(sayfa);
  assert.deepEqual(sonKayitYuku(sayfa).sensorSeridi, ['sensor.oda_1', 'sensor.oda_2', 'sensor.oda_4', 'sensor.oda_5', 'sensor.oda_6']);

  const bilgi = { ...CIHAZLAR, bilgiVarliklari: Array.from({ length: 6 }, (_, i) => ({ entity_id: `todo.liste_${i + 1}`, ad: `Liste ${i + 1}`, alan: 'todo', alanEtiketi: 'Yapılacaklar' })).concat(
    Array.from({ length: 6 }, (_, i) => ({ entity_id: `calendar.takvim_${i + 1}`, ad: `Takvim ${i + 1}`, alan: 'calendar', alanEtiketi: 'Takvim' }))) };
  const sayfa2 = await acilmisSayfa({ ayar: AYAR, cihazlar: bilgi });
  for (let i = 1; i <= 6; i += 1) {
    ekle(sayfa2, 'yapilacakListeleriEkle', 'btnYapilacakListeleriEkle', `todo.liste_${i}`);
    ekle(sayfa2, 'takvimlerEkle', 'btnTakvimlerEkle', `calendar.takvim_${i}`);
  }
  assert.equal(bilgiSatirlari(sayfa2, 'yapilacakListeleriListesi').length, 4);
  assert.equal(bilgiSatirlari(sayfa2, 'takvimlerListesi').length, 4);
  assert.equal(secenekler('takvimlerEkle', sayfa2)[0][1], 'En fazla 4 öğe seçilebilir');
  await kaydet(sayfa2);
  assert.deepEqual(sonKayitYuku(sayfa2).yapilacakListeleri, ['todo.liste_1', 'todo.liste_2', 'todo.liste_3', 'todo.liste_4']);
  assert.deepEqual(sonKayitYuku(sayfa2).takvimler, ['calendar.takvim_1', 'calendar.takvim_2', 'calendar.takvim_3', 'calendar.takvim_4']);
});

// ---------------------------------------------------------------------------
// Kirli durum ve kayıt
// ---------------------------------------------------------------------------

test('kirli durum: her bilgi alanındaki değişiklik göstergeyi açar, eski değere dönünce kapatır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: BILGI_CIHAZLAR });
  const dene = (kimlik, yeni, olay) => {
    const oge = sayfa.oge(kimlik);
    const eski = kimlik === 'sensorGrafik' || kimlik === 'sensorTepsiIpucu' ? oge.checked : oge.value;
    if (typeof eski === 'boolean') oge.checked = yeni;
    else oge.value = yeni;
    oge.dispatchEvent({ type: olay });
    assert.equal(kirliMi(sayfa), true, `${kimlik} değişince kirli`);
    if (typeof eski === 'boolean') oge.checked = eski;
    else oge.value = eski;
    oge.dispatchEvent({ type: olay });
    assert.equal(kirliMi(sayfa), false, `${kimlik} geri alınınca temiz`);
  };
  dene('sensorGrafik', false, 'change');
  dene('sensorTepsiIpucu', true, 'change');
  dene('sensorGrafikSaat', '24', 'change');
  dene('pilEsigi', '30', 'input');
  dene('ustKart1', 'saat', 'change');
  dene('ustKart2', 'hava', 'change');
  dene('havaVarligi', 'weather.ev', 'change');
  dene('saatBicimi', '24', 'change');
  dene('tarihBicimi', 'yok', 'change');
  dene('takvimGunSayisi', '10', 'input');
  dene('hizliListe', 'todo.is_listesi', 'change');
});

test('kayıt: bilgi alanları sunucuya gider, ardından alanlar sunucudaki değerlerle yeniden yazılır; sayılar sayıdır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: BILGI_CIHAZLAR });
  sayfa.oge('sensorGrafik').checked = false;
  sayfa.oge('sensorGrafikSaat').value = '24';
  sayfa.oge('pilEsigi').value = '35';
  sayfa.oge('sensorTepsiIpucu').checked = true;
  sayfa.oge('ustKart1').value = 'saat';
  sayfa.oge('ustKart2').value = 'sensor.salon_sicaklik';
  sayfa.oge('havaVarligi').value = 'weather.ev';
  sayfa.oge('saatBicimi').value = '12';
  sayfa.oge('tarihBicimi').value = 'kisa';
  sayfa.oge('takvimGunSayisi').value = '9';
  sayfa.oge('hizliListe').value = 'todo.is_listesi';
  ekle(sayfa, 'takvimlerEkle', 'btnTakvimlerEkle', 'calendar.is');
  ekle(sayfa, 'yapilacakListeleriEkle', 'btnYapilacakListeleriEkle', 'todo.is_listesi');
  ekle(sayfa, 'yapilacakListeleriEkle', 'btnYapilacakListeleriEkle', 'todo.alisveris');
  await kaydet(sayfa);

  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.sensorGrafik, false);
  assert.strictEqual(yuk.sensorGrafikSaat, 24);
  assert.strictEqual(yuk.pilEsigi, 35);
  assert.equal(yuk.sensorTepsiIpucu, true);
  assert.equal(yuk.ustKart1, 'saat');
  assert.equal(yuk.ustKart2, 'sensor.salon_sicaklik');
  assert.equal(yuk.havaVarligi, 'weather.ev');
  assert.equal(yuk.saatBicimi, '12');
  assert.equal(yuk.tarihBicimi, 'kisa');
  assert.strictEqual(yuk.takvimGunSayisi, 9);
  assert.deepEqual(yuk.takvimler, ['calendar.is']);
  assert.deepEqual(yuk.yapilacakListeleri, ['todo.is_listesi', 'todo.alisveris']);
  assert.equal(yuk.hizliListe, 'todo.is_listesi');
  assert.equal(kirliMi(sayfa), false);
  assert.equal(sayfa.oge('pilEsigi').value, '35');
  assert.equal(sayfa.oge('ustKart2').value, 'sensor.salon_sicaklik');
  assert.equal(sayfa.oge('hizliListe').value, 'todo.is_listesi');
  assert.match(sayfa.oge('genelBildirim').textContent, /^Ayarlar kaydedildi/);
  // yük, ayar tablosunun doğruladığı değerlerle uyumlu (ana süreç bunları kabul eder)
  for (const alan of AYAR_ALANLARI) {
    assert.notEqual(alan.duzelt(yuk[alan.ad]), undefined, `${alan.ad}: ana süreç değeri reddederdi (${JSON.stringify(yuk[alan.ad])})`);
  }
});

test('kayıt: sayıya benzemeyen eşik metni olduğu gibi gider; ana süreç reddedince alan işaretlenir, bölüm açılır, yazılan değer kalır', async () => {
  const uyari = [{ alan: 'pilEsigi', mesaj: 'Bu ayar için geçersiz değer.' }, { alan: 'takvimGunSayisi', mesaj: 'Bu ayar için geçersiz değer.' }];
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, pilEsigi: 20, takvimGunSayisi: 3 },
    cihazlar: BILGI_CIHAZLAR,
    ayarKaydetYaniti: () => ({ ok: true, uyarilar: uyari }),
  });
  sayfa.oge('pilEsigi').value = 'abc';
  sayfa.oge('pilEsigi').dispatchEvent({ type: 'input' });
  sayfa.oge('takvimGunSayisi').value = '99';
  sayfa.oge('takvimGunSayisi').dispatchEvent({ type: 'input' });
  assert.equal(sayfa.oge('bolumBilgi').open, false);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.strictEqual(yuk.pilEsigi, 'abc', 'sayı olmayan metin sayıya çevrilmeden gider');
  assert.strictEqual(yuk.takvimGunSayisi, 99);
  assert.equal(sayfa.oge('pilEsigi').value, 'abc', 'reddedilen değer silinmez');
  assert.equal(sayfa.oge('takvimGunSayisi').value, '99');
  assert.equal(gecersizMi(sayfa.oge('pilEsigi')), true);
  assert.equal(gecersizMi(sayfa.oge('takvimGunSayisi')), true);
  assert.equal(sayfa.oge('pilEsigiHata').style.display, 'block');
  assert.match(sayfa.oge('pilEsigiHata').textContent, /geçersiz değer/);
  assert.equal(sayfa.oge('bolumBilgi').open, true, 'hatalı alanın bölümü açılır');
  assert.equal(kirliMi(sayfa), true, 'kayıt tamamlanmadı: kirli kalır');
  // yazmaya başlayınca işaret kalkar
  sayfa.oge('pilEsigi').value = '25';
  sayfa.oge('pilEsigi').dispatchEvent({ type: 'input' });
  assert.equal(gecersizMi(sayfa.oge('pilEsigi')), false);
  assert.equal(sayfa.oge('pilEsigiHata').style.display, 'none');
});

test('kayıt: yanıttaki kimlik listesi kısaltılmışsa (ana süreç geçersizleri eler) ekran sunucudaki listeye döner', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: BILGI_CIHAZLAR,
    ayarKaydetYaniti: (yuk, sunucu) => {
      sunucu.sensorSeridi = yuk.sensorSeridi.filter((k) => k !== 'sensor.salon_sicaklik'); // ana süreç bu kimliği kabul etmedi
      return { ok: true, uyarilar: [] };
    },
  });
  ekle(sayfa, 'sensorSeridiEkle', 'btnSensorSeridiEkle', 'sensor.salon_sicaklik');
  ekle(sayfa, 'sensorSeridiEkle', 'btnSensorSeridiEkle', 'binary_sensor.hareket');
  await kaydet(sayfa);
  assert.deepEqual(bilgiSatirlari(sayfa, 'sensorSeridiListesi').map(satirAdi), ['Hareket']);
  assert.equal(kirliMi(sayfa), false);
});

// ---------------------------------------------------------------------------
// Dil
// ---------------------------------------------------------------------------

test('dil değişimi: seçenek adları, ipuçları ve satır düğmeleri yeni dilde yeniden yazılır; seçimler ve kirli durum bozulmaz', async () => {
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, sensorSeridi: ['sensor.salon_sicaklik'], ustKart1: 'saat', dilAyari: 'tr', sistemDili: 'tr' },
    cihazlar: BILGI_CIHAZLAR,
  });
  ekle(sayfa, 'takvimlerEkle', 'btnTakvimlerEkle', 'calendar.aile');
  assert.equal(kirliMi(sayfa), true);
  assert.equal(secenekler('ustKart1', sayfa)[1][1], 'Saat ve tarih');
  assert.equal(secenekler('takvimlerEkle', sayfa)[0][1], 'Listeden seç…');
  assert.equal(kaldirDugmesi(bilgiSatirlari(sayfa, 'sensorSeridiListesi')[0]).textContent, 'Kaldır');

  await sayfa.dilDegisti('en');
  assert.equal(secenekler('ustKart1', sayfa)[1][1], 'Clock and date');
  assert.equal(secenekler('ustKart1', sayfa)[0][1], 'Empty');
  assert.equal(secenekler('havaVarligi', sayfa)[0][1], 'Not selected');
  assert.equal(secenekler('hizliListe', sayfa)[0][1], 'First list');
  assert.equal(secenekler('takvimlerEkle', sayfa)[0][1], 'Choose from the list…');
  assert.equal(kaldirDugmesi(bilgiSatirlari(sayfa, 'sensorSeridiListesi')[0]).textContent, 'Remove');
  assert.equal(kaldirDugmesi(bilgiSatirlari(sayfa, 'sensorSeridiListesi')[0]).getAttribute('aria-label'), 'Remove Salon Sıcaklık');
  assert.equal(sayfa.oge('ustKart1').value, 'saat', 'seçim korunur');
  assert.equal(kirliMi(sayfa), true, 'kaydedilmemiş ekleme korunur');
  assert.deepEqual(bilgiSatirlari(sayfa, 'takvimlerListesi').map(satirAdi), ['Aile']);
  assert.equal(sayfa.oge('sensorSeridiEtiket').textContent, 'Add a sensor to the strip');
  assert.equal(sayfa.oge('btnSensorSeridiEkle').textContent, 'Add');
});

// ---------------------------------------------------------------------------
// Güvenlik: yeni bölüm sır, kapı kuralı ya da dış istek eklemez
// ---------------------------------------------------------------------------

test('güvenlik: bilgi bölümü yeni köprü işlevi, ağ isteği ya da depolama kullanmaz; kuralın açıklaması bölümde yazılı', () => {
  const bolum = BETIK.slice(BETIK.indexOf('--- Bilgi kartları'), BETIK.indexOf('--- Kısayol yakalama'));
  assert.ok(bolum.length > 3000, 'bilgi bölümü bulunamadı');
  assert.doesNotMatch(bolum, /window\.evPaneli\.|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|navigator\./);
  assert.match(HTML, /data-i18n="ayar\.bilgi\.guvenlik"/);
  assert.match(AYARLAR.tr['ayar.bilgi.guvenlik'], /kilit, alarm, kapı, garaj kapısı, bariyer ve kepenk/);
  assert.match(AYARLAR.en['ayar.bilgi.guvenlik'], /locks, alarms, doors, garage doors, gates and shutters/);
});

test('B83: HA ulaşılamazken listenin son öğesi kaldırılınca odak listenin kendisine gider (boşluğa düşmez)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, takvimler: ['calendar.aile'] }, cihazlar: { ok: false, hata: 'bağlanılamadı' } });
  const liste = sayfa.oge('takvimlerListesi');
  assert.equal(sayfa.oge('takvimlerEkle').disabled, true, 'aday yokken seçici pasif');
  assert.equal(liste.tabIndex, -1, 'liste programla odaklanabilir');

  const once = liste.odaklanma;
  kaldirDugmesi(bilgiSatirlari(sayfa, 'takvimlerListesi')[0]).dispatchEvent({ type: 'click' });
  assert.equal(bilgiSatirlari(sayfa, 'takvimlerListesi').length, 0);
  assert.equal(liste.odaklanma, once + 1, 'odak listeye verildi');
  assert.equal(sayfa.sonOdak(), liste);
});
