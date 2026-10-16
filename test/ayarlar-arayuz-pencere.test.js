'use strict';

/**
 * Ayarlar sayfasının 1.4.0 "pencere grubu" denetimleri (o-22 üstte tutma, o-32 konum/ekran/opaklık, o-27 tepsi rozeti, o-33 masaüstü
 * karoları) sahte DOM ile (test/ayarlar-sahte.js): kayıt yükü, kirli durum, ekran/sensör seçicileri ve karo listesinin süzgeci.
 * Ana süreçteki doğrulama (src/lib/ayar-alanlari.js) test/ayar-alanlari-pencere.test.js'tedir; burada yalnız sayfa davranışı sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { AYAR_D3, akit, duzles, acilmisSayfa, satirBul } = require('./ayarlar-sahte');

const EKRANLAR = [
  { id: 1, etiket: 'Ekran 1  ·  1920×1080  ·  ana ekran', x: 0, y: 0, genislik: 1920, yukseklik: 1080 },
  { id: 2, etiket: 'Ekran 2  ·  2560×1440', x: 1920, y: 0, genislik: 2560, yukseklik: 1440 },
];
const EKRAN_2_KAYDI = { id: 2, x: 1920, y: 0, genislik: 2560, yukseklik: 1440 };

const aygit = (kimlik, ad, alan, ek = {}) => ({ entity_id: kimlik, ad, alan, alanEtiketi: alan, durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false, ...ek });
const CIHAZLAR_P = {
  ok: true,
  cihazlar: [
    aygit('light.salon_lambasi', 'Salon Lambası', 'light'),
    aygit('light.onayli_isik', 'Onaylı Işık', 'light'),
    aygit('light.secilmemis', 'Seçilmemiş Işık', 'light'),
    aygit('scene.film', 'Film', 'scene'),
    aygit('sensor.salon_sicaklik', 'Salon sıcaklığı', 'sensor'),
    aygit('sensor.pil', 'Telefon pili', 'sensor'),
    aygit('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'button', { onayZorunlu: true, varsayilanOnay: true }),
  ],
  eksik: [],
  engelli: [],
};
const FAVORILER_P = [
  { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
  { entity_id: 'light.onayli_isik', ad: 'Onaylı Işık', onay: true },
  { entity_id: 'scene.film', ad: 'Film' },
  { entity_id: 'sensor.salon_sicaklik', ad: 'Salon sıcaklığı' },
  { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', onay: true },
];
const AYAR_P = {
  ...AYAR_D3,
  favoriler: FAVORILER_P,
  ekranlar: EKRANLAR,
  panelHerZamanUstte: false,
  pencereKonumu: 'imlec',
  tercihEkran: {},
  panelOpaklik: 100,
  tepsiRozeti: 'kapali',
  tepsiRozetSensoru: '',
  masaustuKarolari: [],
  masaustuKaroUstte: false,
};

const PENCERE_ALANLARI = ['panelHerZamanUstte', 'pencereKonumu', 'tercihEkran', 'panelOpaklik', 'tepsiRozeti', 'tepsiRozetSensoru', 'masaustuKarolari', 'masaustuKaroUstte'];
/** Ana süreç gibi: kaydedilen pencere alanları sunucu özetine yazılır (sahte köprü bu alanları kendiliğinden tanımaz). */
const kalici = (yuk, sunucu) => {
  for (const alan of PENCERE_ALANLARI) if (alan in yuk) sunucu[alan] = yuk[alan];
  return { ok: true, uyarilar: [] };
};

const ac = (ayar = {}, cihazlar = CIHAZLAR_P) => acilmisSayfa({ ayar: { ...AYAR_P, ...ayar }, cihazlar, ayarKaydetYaniti: kalici });
const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonYuk = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const degistir = (sayfa, kimlik, deger, tip = 'change') => {
  sayfa.oge(kimlik).value = deger;
  sayfa.oge(kimlik).dispatchEvent({ type: tip });
};
const secenekler = (sayfa, kimlik) => sayfa.oge(kimlik).children.map((c) => [c.value, c.textContent]);
const karoSatirlari = (sayfa) => sayfa.oge('masaustuKaroListesi').bul((o) => o.etiket === 'label');
const karoSatiri = (sayfa, ad) => karoSatirlari(sayfa).find((s) => s.textContent.startsWith(ad));
const karoKutusu = (satir) => satir.bul((o) => o.etiket === 'input')[0];
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display === 'inline';

test('açılış: pencere denetimleri ayardan dolar, opaklık yazısı görünür, kaydedilmemiş değişiklik göstergesi kapalı', async () => {
  const sayfa = await ac({ panelHerZamanUstte: true, pencereKonumu: 'hatirla', panelOpaklik: 70, tepsiRozeti: 'isik', masaustuKaroUstte: true });
  assert.equal(sayfa.oge('panelHerZamanUstte').checked, true);
  assert.equal(sayfa.oge('pencereKonumu').value, 'hatirla');
  assert.equal(sayfa.oge('panelOpaklik').value, '70');
  assert.equal(sayfa.oge('panelOpaklikDegeri').textContent, '%70');
  assert.equal(sayfa.oge('tepsiRozeti').value, 'isik');
  assert.equal(sayfa.oge('masaustuKaroUstte').checked, true);
  assert.equal(kirliMi(sayfa), false);
});

test('açılış: ayar özetinde bu alanlar yoksa (eski kayıt) güvenli varsayılanlar gelir: üstte kapalı, imleç, tam opak, rozet yok', async () => {
  const eski = { ...AYAR_P };
  for (const alan of PENCERE_ALANLARI) delete eski[alan];
  delete eski.ekranlar;
  const sayfa = await acilmisSayfa({ ayar: eski, cihazlar: CIHAZLAR_P, ayarKaydetYaniti: kalici });
  assert.equal(sayfa.oge('panelHerZamanUstte').checked, false);
  assert.equal(sayfa.oge('pencereKonumu').value, 'imlec');
  assert.equal(sayfa.oge('panelOpaklik').value, '100');
  assert.equal(sayfa.oge('tepsiRozeti').value, 'kapali');
  assert.deepEqual(secenekler(sayfa, 'tercihEkran').map((s) => s[0]), [''], 'ekran listesi yoksa yalnız "tercih yok"');
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.deepEqual(yuk.tercihEkran, {});
  assert.deepEqual(yuk.masaustuKarolari, []);
  assert.equal(yuk.panelOpaklik, 100);
  assert.equal(kirliMi(sayfa), false);
});

test('açılış: geçersiz opaklık ve bozuk değerler (50-100 dışı, metin) varsayılana düşer', async () => {
  const sayfa = await ac({ panelOpaklik: 5, pencereKonumu: 'baska', tepsiRozeti: 'cok', masaustuKarolari: [3, null, 'light.salon_lambasi'] });
  assert.equal(sayfa.oge('panelOpaklik').value, '100');
  assert.equal(sayfa.oge('pencereKonumu').value, 'imlec');
  assert.equal(sayfa.oge('tepsiRozeti').value, 'kapali');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).masaustuKarolari, ['light.salon_lambasi'], 'metin olmayan kimlikler elenir');
});

test('opaklık sürgüsü: kaydırınca yazı güncellenir, kirli göstergesi yanar, eski değere dönünce söner; yük sayı olarak gider', async () => {
  const sayfa = await ac();
  degistir(sayfa, 'panelOpaklik', '65', 'input');
  assert.equal(sayfa.oge('panelOpaklikDegeri').textContent, '%65');
  assert.equal(kirliMi(sayfa), true);
  degistir(sayfa, 'panelOpaklik', '100', 'input');
  assert.equal(kirliMi(sayfa), false);
  degistir(sayfa, 'panelOpaklik', '65', 'input');
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).panelOpaklik, 65);
  assert.equal(typeof sonYuk(sayfa).panelOpaklik, 'number');
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra gösterge kapanır');
  assert.equal(sayfa.oge('panelOpaklik').value, '65');
});

test('ekran seçici: tercih yok + bağlı ekranlar; seçim yükte sınırlarıyla gider, "tercih yok" boş nesne gönderir', async () => {
  const sayfa = await ac();
  assert.deepEqual(secenekler(sayfa, 'tercihEkran'), [['', 'Tercih yok (imlecin ekranı)'], ['1', EKRANLAR[0].etiket], ['2', EKRANLAR[1].etiket]]);
  assert.equal(sayfa.oge('tercihEkran').value, '');
  degistir(sayfa, 'tercihEkran', '2');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).tercihEkran, EKRAN_2_KAYDI);
  assert.equal(sayfa.oge('tercihEkran').value, '2');
  assert.equal(kirliMi(sayfa), false);
  degistir(sayfa, 'tercihEkran', '');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).tercihEkran, {});
});

test('ekran seçici: kayıtlı ekran şu an bağlı değilse ayrı bir seçenekle görünür; dokunulmazsa aynı kayıt aynen gider (tercih silinmez)', async () => {
  const sayfa = await ac({ tercihEkran: { id: 77, x: 3000, y: -200, genislik: 3840, yukseklik: 2160 } });
  assert.deepEqual(secenekler(sayfa, 'tercihEkran').map((s) => s[0]), ['', '1', '2', 'kayitli']);
  assert.equal(sayfa.oge('tercihEkran').value, 'kayitli');
  assert.match(secenekler(sayfa, 'tercihEkran').at(-1)[1], /şu an bağlı değil/);
  degistir(sayfa, 'panelOpaklik', '90', 'input'); // başka bir şeyi değiştir
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).tercihEkran, { id: 77, x: 3000, y: -200, genislik: 3840, yukseklik: 2160 });
});

test('ekran seçici: bozuk ekran girdileri (kimliksiz, sayı olmayan konum) listeye girmez', async () => {
  const sayfa = await ac({ ekranlar: [...EKRANLAR, { id: 'x', etiket: 'Kötü', x: 0, y: 0 }, { id: 3, etiket: 'Kötü 2', x: 'a', y: 0 }, null, { id: 4, etiket: 5, x: 0, y: 0 }] });
  assert.deepEqual(secenekler(sayfa, 'tercihEkran').map((s) => s[0]), ['', '1', '2']);
});

test('kayıt yükü: üstte tutma, konum modu, ekran, opaklık, rozet, sensör ve karo alanları birlikte gider', async () => {
  const sayfa = await ac();
  sayfa.oge('panelHerZamanUstte').tikla();
  degistir(sayfa, 'pencereKonumu', 'hatirla');
  degistir(sayfa, 'tercihEkran', '2');
  degistir(sayfa, 'panelOpaklik', '80', 'input');
  degistir(sayfa, 'tepsiRozeti', 'sensor');
  degistir(sayfa, 'tepsiRozetSensoru', 'sensor.salon_sicaklik');
  sayfa.oge('masaustuKaroUstte').tikla();
  karoKutusu(karoSatiri(sayfa, 'Film')).tikla();
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.equal(yuk.panelHerZamanUstte, true);
  assert.equal(yuk.pencereKonumu, 'hatirla');
  assert.deepEqual(yuk.tercihEkran, EKRAN_2_KAYDI);
  assert.equal(yuk.panelOpaklik, 80);
  assert.equal(yuk.tepsiRozeti, 'sensor');
  assert.equal(yuk.tepsiRozetSensoru, 'sensor.salon_sicaklik');
  assert.equal(yuk.masaustuKaroUstte, true);
  assert.deepEqual(yuk.masaustuKarolari, ['scene.film']);
  assert.equal(kirliMi(sayfa), false);
  assert.deepEqual(Object.keys(yuk).filter((a) => /konumlari|KaroKonumlari/i.test(a)), [], 'makineye özgü konum kayıtları sayfaya ve yüke girmez');
});

test('rozet sensörü seçici: yalnız "sensör" modunda etkin; yalnız sensör alanları listelenir (ışık, düğme, kapı yok)', async () => {
  const sayfa = await ac();
  assert.equal(sayfa.oge('tepsiRozetSensoru').disabled, true, 'rozet kapalı: sensör seçilemez');
  degistir(sayfa, 'tepsiRozeti', 'isik');
  assert.equal(sayfa.oge('tepsiRozetSensoru').disabled, true);
  degistir(sayfa, 'tepsiRozeti', 'sensor');
  assert.equal(sayfa.oge('tepsiRozetSensoru').disabled, false);
  assert.deepEqual(secenekler(sayfa, 'tepsiRozetSensoru'), [['', 'Sensör seç…'], ['sensor.salon_sicaklik', 'Salon sıcaklığı'], ['sensor.pil', 'Telefon pili']]);
  assert.equal(kirliMi(sayfa), true);
});

test('rozet sensörü seçici: ayardaki seçim cihaz listesi olmasa da seçenek olarak durur ve dokunulmadan kayıtta korunur', async () => {
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR_P, anahtarVar: false, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' },
    cihazlar: CIHAZLAR_P,
    ayarKaydetYaniti: kalici,
  });
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false, 'anahtar yok: liste yüklenmedi');
  assert.deepEqual(secenekler(sayfa, 'tepsiRozetSensoru').map((s) => s[0]), ['', 'sensor.salon_sicaklik']);
  assert.equal(sayfa.oge('tepsiRozetSensoru').value, 'sensor.salon_sicaklik');
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).tepsiRozetSensoru, 'sensor.salon_sicaklik');
});

test('masaüstü karo listesi: adaylar seçili favorilerden gelir; yalnız sabitlenebilir alanlar (ışık, sahne, sensör); düğme/script/kapı yok; onaylı ışık seçilemez', async () => {
  const sayfa = await ac();
  const adlar = karoSatirlari(sayfa).map((s) => s.textContent);
  assert.deepEqual(adlar, ['Salon Lambası', 'Onaylı Işık — onay ister, sabitlenemez', 'Film', 'Salon sıcaklığı']);
  assert.equal(karoKutusu(karoSatiri(sayfa, 'Onaylı Işık')).disabled, true);
  assert.equal(karoKutusu(karoSatiri(sayfa, 'Onaylı Işık')).checked, false);
  assert.equal(karoSatirlari(sayfa).some((s) => /Bilgisayarı Kapat|Seçilmemiş/.test(s.textContent)), false, 'onaylı düğme ve favori olmayan ışık aday değil');
});

test('masaüstü karo seçimi: işaretleme kirli yapar, yükte seçim sırasıyla gider, kayıttan sonra seçili kalır; kaldırınca söner', async () => {
  const sayfa = await ac();
  karoKutusu(karoSatiri(sayfa, 'Film')).tikla();
  assert.equal(kirliMi(sayfa), true);
  karoKutusu(karoSatiri(sayfa, 'Salon Lambası')).tikla();
  assert.equal(sayfa.oge('masaustuKaroListesi').bul((o) => o.etiket === 'input' && o.checked).length, 2);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).masaustuKarolari, ['scene.film', 'light.salon_lambasi']);
  assert.equal(kirliMi(sayfa), false);
  assert.equal(karoKutusu(karoSatiri(sayfa, 'Film')).checked, true, 'kayıttan sonra yeniden çizilen liste seçimi korur');
  karoKutusu(karoSatiri(sayfa, 'Salon Lambası')).tikla();
  assert.equal(kirliMi(sayfa), true);
  karoKutusu(karoSatiri(sayfa, 'Salon Lambası')).tikla();
  assert.equal(kirliMi(sayfa), false, 'geri alınan düzenleme kirli sayılmaz');
});

test('masaüstü karo seçimi: en çok 6; dolunca seçilmemiş satırlar kapanır ve nedeni yazar; birini bırakınca açılır', async () => {
  const kimlikler = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => `light.lamba_${k}`);
  const cihazlar = { ...CIHAZLAR_P, cihazlar: kimlikler.map((k, i) => aygit(k, `Lamba ${i + 1}`, 'light')) };
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR_P, favoriler: kimlikler.map((k, i) => ({ entity_id: k, ad: `Lamba ${i + 1}` })) },
    cihazlar,
    ayarKaydetYaniti: kalici,
  });
  assert.equal(karoSatirlari(sayfa).length, 8);
  for (let i = 1; i <= 6; i += 1) karoKutusu(karoSatiri(sayfa, `Lamba ${i}`)).tikla();
  const yedinci = karoSatiri(sayfa, 'Lamba 7');
  assert.equal(karoKutusu(yedinci).disabled, true);
  assert.match(yedinci.textContent, /en çok 6 karo seçilebilir/);
  assert.equal(karoKutusu(karoSatiri(sayfa, 'Lamba 1')).disabled, false, 'seçili satır hâlâ bırakılabilir');
  karoKutusu(karoSatiri(sayfa, 'Lamba 3')).tikla();
  assert.equal(karoKutusu(karoSatiri(sayfa, 'Lamba 7')).disabled, false);
  karoKutusu(karoSatiri(sayfa, 'Lamba 7')).tikla();
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).masaustuKarolari, ['light.lamba_a', 'light.lamba_b', 'light.lamba_d', 'light.lamba_e', 'light.lamba_f', 'light.lamba_g']);
});

test('masaüstü karo seçimi: ayarda kalmış ama artık aday olmayan kimlikler (kapı kilidi, favoriden çıkan, onaylı) kayıt yüküne GİRMEZ', async () => {
  const sayfa = await ac({ masaustuKarolari: ['lock.on_kapi', 'cover.garaj', 'light.secilmemis', 'button.pc_bilgisayari_kapat', 'light.onayli_isik', 'scene.film'] });
  assert.deepEqual(karoSatirlari(sayfa).map((s) => karoKutusu(s).checked), [false, false, true, false]);
  assert.equal(kirliMi(sayfa), false, 'açılışta ham liste baz alınır');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).masaustuKarolari, ['scene.film']);
  assert.doesNotMatch(JSON.stringify(sonYuk(sayfa).masaustuKarolari), /lock|cover|button/);
});

test('masaüstü karo seçimi: favoriden işaret kaldırılınca aday listeden düşer ve yükten çıkar; geri işaretlenince seçim geri gelir', async () => {
  const sayfa = await ac({ masaustuKarolari: ['light.salon_lambasi', 'scene.film'] });
  const favoriKutusu = (kimlik) => satirBul(sayfa, kimlik).bul((o) => o.etiket === 'input')[0];
  favoriKutusu('light.salon_lambasi').tikla();
  assert.equal(karoSatiri(sayfa, 'Salon Lambası'), undefined);
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).masaustuKarolari, ['scene.film']);
});

test('ana süreç karo listesini değiştirince (karonun × düğmesi): düzenlenmemiş liste sunucudakini alır; düzenlenmişse kullanıcının seçimi korunur', async () => {
  const temiz = await ac({ masaustuKarolari: ['light.salon_lambasi', 'scene.film'] });
  temiz.sunucu.masaustuKarolari = ['scene.film']; // × ile bir karo kapatıldı
  await temiz.favoriDegisti();
  assert.equal(karoKutusu(karoSatiri(temiz, 'Salon Lambası')).checked, false);
  assert.equal(karoKutusu(karoSatiri(temiz, 'Film')).checked, true);
  assert.equal(kirliMi(temiz), false);

  const duzenlenmis = await ac({ masaustuKarolari: ['light.salon_lambasi', 'scene.film'] });
  karoKutusu(karoSatiri(duzenlenmis, 'Salon sıcaklığı')).tikla(); // kullanıcı kayıt öncesi bir karo ekledi
  duzenlenmis.sunucu.masaustuKarolari = ['scene.film'];
  await duzenlenmis.favoriDegisti();
  assert.equal(karoKutusu(karoSatiri(duzenlenmis, 'Salon sıcaklığı')).checked, true, 'kaydedilmemiş seçim silinmedi');
  assert.equal(kirliMi(duzenlenmis), true);
});

test('masaüstü karo listesi: favori yokken açıklayıcı boş durum; satırlar yalnız textContent ile yazılır (HTML yorumlanmaz)', async () => {
  const bos = await ac({ favoriler: [] });
  assert.equal(karoSatirlari(bos).length, 0);
  assert.match(bos.oge('masaustuKaroListesi').textContent, /Önce Favoriler bölümünden/);

  const kotu = '<img src=x onerror=alert(1)>';
  const cihazlar = { ...CIHAZLAR_P, cihazlar: [aygit('light.kotu', kotu, 'light')] };
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_P, favoriler: [{ entity_id: 'light.kotu', ad: kotu }] }, cihazlar, ayarKaydetYaniti: kalici });
  assert.equal(karoSatirlari(sayfa)[0].textContent, kotu, 'metin olduğu gibi (etiket olarak değil) yazıldı');
  assert.equal(sayfa.oge('masaustuKaroListesi').bul((o) => o.etiket === 'img').length, 0);
});

test('dil değişince ekran/sensör seçenekleri ve opaklık yazısı yeni dilde kurulur, seçili değerler korunur', async () => {
  const sayfa = await ac({ tercihEkran: EKRAN_2_KAYDI, panelOpaklik: 60, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.pil' });
  assert.equal(sayfa.oge('tercihEkran').value, '2');
  await sayfa.dilDegisti('en');
  assert.equal(secenekler(sayfa, 'tercihEkran')[0][1], 'No preference (cursor’s screen)');
  assert.equal(sayfa.oge('tercihEkran').value, '2');
  assert.equal(sayfa.oge('tepsiRozetSensoru').value, 'sensor.pil');
  assert.equal(secenekler(sayfa, 'tepsiRozetSensoru')[0][1], 'Choose a sensor…');
  assert.equal(sayfa.oge('panelOpaklikDegeri').textContent, '60%');
});
