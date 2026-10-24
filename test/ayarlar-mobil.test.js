'use strict';

/**
 * Ayarlar sayfasında mobil bildirimler (o-61): src/ayarlar.js, sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 * Kayıt/itme/düğme mantığı test/mobil-kayit.test.js'te, ana süreç bağlantısı test/ana-surec.test.js'tedir; burada yalnız sayfa davranışı sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');
const SOZLUK = require('../src/lib/ceviri/ayarlar');
const ANA_SOZLUK = require('../src/lib/ceviri/ana');
const { kayitGovdesi } = require('../src/lib/mobil-kayit');

const AD = {
  kutu: 'mobilBildirimler',
  cihazAdi: 'mobilCihazAdi',
  kaydol: 'btnMobilKaydol',
  kaydiSil: 'btnMobilKaydiSil',
  durum: 'mobilDurum',
  bolum: 'bolumMobil',
};
const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: { ...AYAR_D3, ...(ek.ayar ?? {}) }, cihazlar: CIHAZLAR_D3, aracYaniti: ek.aracYaniti, koprudenKaldir: ek.koprudenKaldir });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};
const durumYaniti = (ek = {}) => ({ ok: true, kayitli: false, etkin: false, kanal: 'kayitsiz', kayitSuruyor: false, sonBildirim: null, dusenBildirim: 0, canliAcik: true, sifrelemeVar: true, cihazAdi: '', ...ek });
const gorunur = (oge) => oge.style.display !== 'none';

test('varsayılan: kutu işaretsiz, "Kaydol" görünür, "Kaydı sil" gizli, durum "kayıtlı değil"; açılışta kayıt/silme istenmez', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge(AD.kutu).checked, false);
  assert.equal(sayfa.oge(AD.cihazAdi).value, '');
  assert.equal(gorunur(sayfa.oge(AD.kaydol)), true);
  assert.equal(gorunur(sayfa.oge(AD.kaydiSil)), false);
  assert.equal(sayfa.oge(AD.kaydol).disabled, false);
  assert.equal(sayfa.oge(AD.durum).textContent, 'Bu bilgisayar Home Assistant’a kayıtlı değil.');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'mobilKaydol' || c[0] === 'mobilKaydiSil'), false);
});

test('kayıtlı ve dinliyor: "Kaydı sil" görünür, "Kaydol" gizli, cihaz adı kilitli; son bildirim saati ve düşen sayısı yazılır', async () => {
  const sayfa = await sayfaAc({
    ayar: { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' },
    aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor', sonBildirim: 1_760_000_000_000, dusenBildirim: 3 }) },
  });
  assert.equal(sayfa.oge(AD.kutu).checked, true);
  assert.equal(sayfa.oge(AD.cihazAdi).value, 'Salon PC');
  assert.equal(gorunur(sayfa.oge(AD.kaydol)), false);
  assert.equal(gorunur(sayfa.oge(AD.kaydiSil)), true);
  assert.equal(sayfa.oge(AD.cihazAdi).disabled, true);
  const metin = sayfa.oge(AD.durum).textContent;
  assert.match(metin, /^Kayıtlı; bildirimler dinleniyor\. Son bildirim: .+\. Çok sık geldiği için 3 bildirim gösterilmedi\.$/);
});

test('kanal durumları: bekliyor, kapalı, HA kaydı tanımıyor, yetkisiz, destek yok ve canlı bağlantı kapalı notu', async () => {
  const beklenen = {
    bekliyor: 'ayar.mobil.kanal.bekliyor',
    kapali: 'ayar.mobil.kanal.kapali',
    'kayit-yok': 'ayar.mobil.kanal.kayitYok',
    yetkisiz: 'ayar.mobil.kanal.yetkisiz',
    'destek-yok': 'ayar.mobil.kanal.destekYok',
  };
  for (const [kanal, anahtar] of Object.entries(beklenen)) {
    const sayfa = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kayitli: kanal !== 'kayit-yok', kanal }) } });
    assert.equal(sayfa.oge(AD.durum).textContent, SOZLUK.tr[anahtar], kanal);
    assert.ok(SOZLUK.tr[anahtar].length > 10);
  }
  const kapaliCanli = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'bekliyor', canliAcik: false }) } });
  assert.match(kapaliCanli.oge(AD.durum).textContent, /Canlı bağlantı kapalı olduğu için bildirim gelmez\./);
  const bilinmeyen = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kanal: 'tuhaf' }) } });
  assert.equal(bilinmeyen.oge(AD.durum).textContent, 'Bu bilgisayar Home Assistant’a kayıtlı değil.', 'bilinmeyen kanal genel metne düşer');
});

test('şifreleme yoksa kaydolunamaz: düğme pasif ve neden yazılır', async () => {
  const sayfa = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ sifrelemeVar: false }) } });
  assert.equal(sayfa.oge(AD.kaydol).disabled, true);
  assert.match(sayfa.oge(AD.durum).textContent, /safeStorage/);
});

test('kutu işaretliyken kayıt yoksa "önce kaydol" notu çıkar; kutuyu işaretlemek kayıt YAPMAZ ve formu kirli yapar', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge(AD.kutu).checked = true;
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' });
  assert.match(sayfa.oge(AD.durum).textContent, /önce “Home Assistant’a kaydol”a bas\.$/);
  assert.notEqual(sayfa.oge('kirliGosterge').style.display, 'none');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'mobilKaydol'), false);
});

test('kaydedilince yükte iki alan gider; sunucudaki değerler yansır', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge(AD.kutu).checked = true;
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' });
  sayfa.oge(AD.cihazAdi).value = '  Çalışma Odası  ';
  sayfa.oge(AD.cihazAdi).dispatchEvent({ type: 'input' });
  await tikla(sayfa, 'btnAyarlariKaydet');
  const yuk = sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet')[1];
  assert.equal(yuk.mobilBildirimler, true);
  assert.equal(yuk.mobilCihazAdi, 'Çalışma Odası', 'baştaki/sondaki boşluk atılır');
});

test('Kaydol: cihaz adı köprüye (kırpılmış) gider; başarıda kutu işaretlenir, kayıt yok sayılmaz, kirli göstergesi çıkmaz, "Kaydı sil" görünür', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge(AD.cihazAdi).value = '  Salon PC ';
  await tikla(sayfa, AD.kaydol);
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'mobilKaydol'), [['mobilKaydol', 'Salon PC']]);
  assert.equal(sayfa.oge(AD.kutu).checked, true, 'ana süreç ayarı açtı: kutu yansır');
  assert.equal(sayfa.oge(AD.cihazAdi).value, 'Salon PC');
  assert.equal(gorunur(sayfa.oge(AD.kaydiSil)), true);
  assert.equal(gorunur(sayfa.oge(AD.kaydol)), false);
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none', 'kendiliğinden kaydedilen değişiklik kirli sayılmaz');
  assert.match(sayfa.oge(AD.durum).textContent, /Kaydoldun; HA’nın bildirimleri artık burada görünür\.$/);
  assert.equal(sayfa.oge(AD.kaydol).disabled, false);
});

test('Kaydol: vazgeçilirse not düşer, durum değişmez; hata ana süreçten gelen metinle yazılır (ham adres/kimlik yok)', async () => {
  const vazgec = await sayfaAc({ aracYaniti: { mobilKaydol: { ...durumYaniti(), ok: true, sonuc: 'vazgecildi' } } });
  await tikla(vazgec, AD.kaydol);
  assert.match(vazgec.oge(AD.durum).textContent, /Vazgeçildi\.$/);
  assert.equal(vazgec.oge(AD.kutu).checked, false);
  assert.equal(gorunur(vazgec.oge(AD.kaydol)), true);

  const hata = await sayfaAc({ aracYaniti: { mobilKaydol: { ...durumYaniti(), ok: false, hata: 'Home Assistant’ta Mobile App entegrasyonu yok.' } } });
  await tikla(hata, AD.kaydol);
  assert.match(hata.oge(AD.durum).textContent, /Home Assistant’ta Mobile App entegrasyonu yok\.$/);
  assert.equal(hata.oge(AD.kutu).checked, false);

  const patlayan = await sayfaAc({ aracYaniti: { mobilKaydol: () => { throw new Error('köprü koptu 192.168.1.10'); } } });
  await tikla(patlayan, AD.kaydol);
  assert.match(patlayan.oge(AD.durum).textContent, /İşlem tamamlanamadı\.$/);
  assert.doesNotMatch(patlayan.oge(AD.durum).textContent, /192\.168|köprü/);
  assert.equal(patlayan.oge(AD.kaydol).disabled, false, 'yeniden denenebilir');
});

test('Kaydol/Kaydı sil sürerken ikinci tıklama yok sayılır (tek istek)', async () => {
  let coz;
  const bekleyen = new Promise((c) => {
    coz = c;
  });
  const sayfa = await sayfaAc({ aracYaniti: { mobilKaydol: () => bekleyen } });
  sayfa.oge(AD.kaydol).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  sayfa.oge(AD.kaydol).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'mobilKaydol').length, 1);
  assert.equal(sayfa.oge(AD.kaydol).disabled, true);
  coz({ ...durumYaniti(), ok: true, sonuc: 'vazgecildi' });
  await akit();
  assert.equal(sayfa.oge(AD.kaydol).disabled, false);
});

test('Kaydı sil: köprüyü çağırır; başarıda kutu kapanır, "Kaydol" geri gelir ve HA\'dan elle kaldırma notu yazılır', async () => {
  const sayfa = await sayfaAc({
    ayar: { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' },
    aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor' }) },
  });
  assert.equal(gorunur(sayfa.oge(AD.kaydiSil)), true);
  await tikla(sayfa, AD.kaydiSil);
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'mobilKaydiSil'), [['mobilKaydiSil']]);
  assert.equal(sayfa.oge(AD.kutu).checked, false);
  assert.equal(gorunur(sayfa.oge(AD.kaydol)), true);
  assert.equal(gorunur(sayfa.oge(AD.kaydiSil)), false);
  assert.equal(sayfa.oge(AD.cihazAdi).disabled, false);
  assert.match(sayfa.oge(AD.durum).textContent, /Kayıt silindi\. HA’daki cihaz girdisini HA’dan kaldırmayı unutma\.$/);
});

test('ana süreç "mobil:degisti" itince durum yazılır; kutu yalnız HA kaydı tanımayıp ayarı kapattığında değişir (kullanıcının seçimi ezilmez)', async () => {
  const sayfa = await sayfaAc({ ayar: { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' }, aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor' }) } });
  // kullanıcı kutuyu kaydetmeden kapattı; yeni bildirim durumu geldi
  sayfa.oge(AD.kutu).checked = false;
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' });
  await sayfa.mobilDegisti({ ...durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor', sonBildirim: 1_760_000_000_000 }), mobilBildirimler: true });
  assert.match(sayfa.oge(AD.durum).textContent, /Son bildirim: /);
  assert.equal(sayfa.oge(AD.kutu).checked, false, 'kullanıcının kaydedilmemiş seçimi korunur');
  // HA kaydı tanımadı: ana süreç ayarı kapattı
  await sayfa.mobilDegisti({ ...durumYaniti({ kayitli: false, etkin: false, kanal: 'kayit-yok' }), mobilBildirimler: false });
  assert.equal(sayfa.oge(AD.kutu).checked, false);
  assert.match(sayfa.oge(AD.durum).textContent, /^Home Assistant bu kaydı tanımıyor/);
  assert.equal(gorunur(sayfa.oge(AD.kaydol)), true);
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none', 'ana sürecin kendi değişikliği kirli sayılmaz');
  // geçersiz itme yok sayılır
  await sayfa.mobilDegisti({ ok: false });
  await sayfa.mobilDegisti(null);
  assert.match(sayfa.oge(AD.durum).textContent, /^Home Assistant bu kaydı tanımıyor/);
});

test('"bolumMobil" bölümünü açmayı ana süreç isteyebilir (bildirim tıklaması)', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge(AD.bolum).open, false);
  await sayfa.bolumIste(AD.bolum);
  assert.equal(sayfa.oge(AD.bolum).open, true);
  await sayfa.bolumIste('bolumBilinmeyen');
});

test('köprüde mobil işlevleri yoksa (eski preload) sayfa çökmez; düğmeler zararsızdır', async () => {
  // Eski bir preload mobilDurumu / mobilKaydol / mobilKaydiSil / onMobilDegisti açmaz: işlevler sahte köprüden GERÇEKTEN çıkarılır.
  const sayfa = await sayfaAc({ koprudenKaldir: ['mobilDurumu', 'mobilKaydol', 'mobilKaydiSil', 'onMobilDegisti'] });
  assert.equal(sayfa.oge(AD.durum).textContent, '', 'durum okunamadı: ne "kayıtlı değil" ne başka bir metin uydurulur');
  await tikla(sayfa, AD.kaydol);
  await tikla(sayfa, AD.kaydiSil);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'mobilKaydol' || c[0] === 'mobilKaydiSil'), false, 'olmayan işlev çağrılmaz');
  assert.equal(sayfa.oge(AD.kaydol).disabled, false, 'düğme meşgul kalmaz');
  assert.equal(sayfa.oge(AD.durum).textContent, '');
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' }); // kutuyu değiştirmek de zararsız
  await akit();
  assert.equal(sayfa.oge(AD.durum).textContent, '');
});

test('dil değişince mobil metinleri yeni dilde yeniden yazılır (durum satırı dahil)', async () => {
  const sayfa = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor' }) } });
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge(AD.durum).textContent, 'Registered; listening for notifications.');
  assert.equal(sayfa.oge(AD.kaydiSil).textContent, 'Delete registration');
  await sayfa.dilDegisti('de');
  assert.equal(sayfa.oge(AD.durum).textContent, 'Registriert; Benachrichtigungen werden empfangen.');
  await sayfa.dilDegisti('fr');
  assert.equal(sayfa.oge(AD.durum).textContent, 'Enregistré ; à l’écoute des notifications.');
  await sayfa.dilDegisti('es');
  assert.equal(sayfa.oge(AD.durum).textContent, 'Registrado; escuchando notificaciones.');
});

test('düşen bildirim sayısı 1 iken her dilde tekil, 2 iken çoğul yazılır ("1 notification was not shown")', async () => {
  const beklenen = {
    en: ['1 notification was not shown because it arrived too quickly.', '2 notifications were not shown because they arrived too quickly.'],
    de: ['1 Benachrichtigung wurde nicht angezeigt, weil sie zu schnell eintraf.', '2 Benachrichtigungen wurden nicht angezeigt, weil sie zu schnell eintrafen.'],
    fr: ['1 notification n’a pas été affichée car elle est arrivée trop vite.', '2 notifications n’ont pas été affichées car elles sont arrivées trop vite.'],
    es: ['No se mostró 1 notificación porque llegó demasiado rápido.', 'No se mostraron 2 notificaciones porque llegaron demasiado rápido.'],
  };
  const sayfa = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor', dusenBildirim: 1 }) } });
  assert.match(sayfa.oge(AD.durum).textContent, /Çok sık geldiği için 1 bildirim gösterilmedi.$/);
  for (const [dil, [bir, iki]] of Object.entries(beklenen)) {
    await sayfa.dilDegisti(dil);
    assert.ok(sayfa.oge(AD.durum).textContent.endsWith(bir), `${dil}: ${sayfa.oge(AD.durum).textContent}`);
    const cok = await sayfaAc({ aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor', dusenBildirim: 2 }) } });
    await cok.dilDegisti(dil);
    assert.ok(cok.oge(AD.durum).textContent.endsWith(iki), `${dil}: ${cok.oge(AD.durum).textContent}`);
  }
});

test('HTML: kutu etiketli, düğmeler type=button, durum satırı role=status; satır içi betik/innerHTML yok; bölüm katlı', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  assert.match(html, /<details class="bolum" id="bolumMobil">/);
  assert.match(html, /<input type="checkbox" id="mobilBildirimler">/);
  assert.match(html, /<button class="buton buton-birincil" id="btnMobilKaydol" type="button"/);
  assert.match(html, /<button class="buton buton-ikincil" id="btnMobilKaydiSil" type="button"/);
  assert.match(html, /id="mobilDurum" role="status" aria-live="polite"/);
  assert.match(html, /<label for="mobilCihazAdi"/);
  assert.match(html, /id="mobilCihazAdi" maxlength="40"/);
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.js'), 'utf8');
  const mobilBolumu = kaynak.slice(kaynak.indexOf('// --- Mobil bildirimler (o-61)'), kaynak.indexOf('// --- Odadan başla (o-44)'));
  assert.ok(mobilBolumu.length > 500);
  const kodYalnizca = mobilBolumu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(kodYalnizca, /innerHTML|insertAdjacentHTML|eval\(|webhook|fetch\(|localStorage/i);
});

test('B91: "Son bildirim" saati sistem yerel ayarına değil arayüz diline göre biçimlenir (tr/de 24 saat, en 12 saat)', async () => {
  const sayfa = await sayfaAc({
    ayar: { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' },
    aracYaniti: { mobilDurumu: durumYaniti({ kayitli: true, etkin: true, kanal: 'dinliyor', sonBildirim: 1_760_000_000_000 }) },
  });
  const durum = () => sayfa.oge(AD.durum).textContent;
  assert.match(durum(), /Son bildirim: \d{2}:\d{2}\./, 'tr 24 saat');
  await sayfa.dilDegisti('en');
  assert.match(durum(), /Last notification: \d{1,2}:\d{2} (AM|PM)\./, 'en 12 saat');
  await sayfa.dilDegisti('de');
  assert.match(durum(), /: \d{2}:\d{2}\./, 'de 24 saat');
  assert.doesNotMatch(durum(), /AM|PM/);
});

test('kayıt metinleri gerçeği söyler: cihaz adı, uygulama sürümü ve Windows sürümü gider; "cihaz bilgisi gönderilmez" denmez (5 dil, iki sözlük)', () => {
  // Kayıt gövdesi gerçekte bu alanları taşır; onay iletisi ve Ayarlar açıklaması bunu gizlememeli.
  const govde = kayitGovdesi({ cihazAdi: 'Salon PC', kimlik: { uygulamaKimligi: 'ev-paneli', uygulamaAdi: 'Ev Paneli', surum: '1.2.3', osSurumu: 'Windows 10.0.1' } });
  for (const alan of ['device_name', 'app_version', 'os_version']) assert.ok(govde[alan], alan);
  const yasak = {
    tr: /cihaz bilgisi/i,
    en: /device information/i,
    de: /Geräteinformationen/,
    fr: /information sur l’appareil/,
    es: /información del dispositivo/,
  };
  const olmali = {
    tr: /cihaz adı, uygulama sürümü ve Windows sürümü/,
    en: /device name, app version and Windows version/,
    de: /Gerätename, App-Version und Windows-Version/,
    fr: /nom de l’appareil, la version de l’application et la version de Windows/,
    es: /nombre del dispositivo, la versión de la aplicación y la versión de Windows/,
  };
  for (const dil of Object.keys(yasak)) {
    for (const [ad, metin] of [['mobil.kaydolAyrinti', ANA_SOZLUK[dil]['mobil.kaydolAyrinti']], ['ayar.mobil.aciklama', SOZLUK[dil]['ayar.mobil.aciklama']]]) {
      assert.doesNotMatch(metin, yasak[dil], `${dil} ${ad}: eski "cihaz bilgisi gönderilmez" cümlesi kalmış`);
      assert.match(metin, olmali[dil], `${dil} ${ad}: gönderilen alanlar anılmıyor`);
    }
  }
});
