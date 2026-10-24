'use strict';

/**
 * Ayarlar > Bağlantı > Özel üstbilgiler (o-55; src/ayarlar-baglanti.js). Sahte DOM ve sahte köprü (test/ayarlar-sahte.js,
 * test/baglanti-sahte.js); gerçek ağ, Electron ya da şifreleme yok. Değerler sahte sınama metinleridir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, HTML, akit, acilmisSayfa, duzles, gorunurMetinler } = require('./ayarlar-sahte');
const AYARLAR = require('../src/lib/ceviri/ayarlar');

const GIZLI = 'GIZLI_TEST_DEGERI';

const ac = (baglantiYaniti, ayar = AYAR_D3) => acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3, baglantiYaniti });
const satirlar = (sayfa) => sayfa.oge('ustbilgiListesi').children;
const adGirdisi = (satir) => satir.children[0];
const degerGirdisi = (satir) => satir.children[1];
const kaldirDugmesi = (satir) => satir.children[2];
const hataKutusu = (satir) => satir.children[3];
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click' });
  await akit();
};
const ustCagrilari = (sayfa) => sayfa.cagrilar.filter((c) => c[0].startsWith('ustbilgileri'));

test('açılış: kayıtlı üstbilgilerin yalnız ADLARI satır olur; değer alanı boş, ad değiştirilemez; sayaç ve sil düğmesi görünür', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['CF-Access-Client-Id', 'CF-Access-Client-Secret'] });
  const s = satirlar(sayfa);
  assert.equal(s.length, 2);
  assert.equal(adGirdisi(s[0]).value, 'CF-Access-Client-Id');
  assert.equal(adGirdisi(s[0]).readOnly, true);
  assert.equal(degerGirdisi(s[0]).value, '');
  assert.equal(degerGirdisi(s[0]).type, 'password');
  assert.equal(degerGirdisi(s[0]).placeholder, AYARLAR.tr['ayar.baglanti.ust.degerKorunur']);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, '2 üstbilgi tanımlı');
  assert.equal(sayfa.oge('btnUstbilgiSil').style.display, '');
});

test('açılış: üstbilgi yoksa "tanımlı üstbilgi yok" yazar, sil düğmesi gizli, satır yok', async () => {
  const sayfa = await ac({});
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, 'Tanımlı üstbilgi yok.');
  assert.equal(sayfa.oge('btnUstbilgiSil').style.display, 'none');
});

test('tek üstbilgi: çoğul tabanı "bir" metniyle yazılır', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, '1 üstbilgi tanımlı');
});

test('ekle + kaydet: yeni satırın adı ve değeri gider; kayıtlı satırın boş değeri null (korunur) olarak gider; kayıttan sonra satırlar sunucudan tazelenir', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['CF-Access-Client-Id'] });
  await tikla(sayfa, 'btnUstbilgiEkle');
  const s = satirlar(sayfa);
  assert.equal(s.length, 2);
  assert.equal(adGirdisi(s[1]).readOnly, false);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.kirli'], 'kaydedilmemiş değişiklik uyarısı');
  yaz(adGirdisi(s[1]), ' CF-Access-Client-Secret ');
  yaz(degerGirdisi(s[1]), GIZLI);
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.deepEqual(ustCagrilari(sayfa), [['ustbilgileriKaydet', [{ ad: 'CF-Access-Client-Id', deger: null }, { ad: 'CF-Access-Client-Secret', deger: GIZLI }]]]);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.kaydedildi']);
  const yeni = satirlar(sayfa);
  assert.deepEqual(yeni.map((r) => adGirdisi(r).value), ['CF-Access-Client-Id', 'CF-Access-Client-Secret']);
  assert.ok(yeni.every((r) => degerGirdisi(r).value === ''), 'kayıttan sonra değerler sayfada tutulmaz');
  assert.ok(yeni.every((r) => adGirdisi(r).readOnly));
  // değerler sayfanın hiçbir görünür metninde yok
  assert.ok(!gorunurMetinler(sayfa).some(([, m]) => m.includes(GIZLI)));
});

test('kayıtlı satırda yeni değer yazılırsa o değer gider (null değil)', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'yeni_deger_1');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.deepEqual(ustCagrilari(sayfa)[0][1], [{ ad: 'X-Ek', deger: 'yeni_deger_1' }]);
});

test('sunucu doğrulama hatası ilgili satırda gösterilir; satır işaretlenir, durum hata olur, düzeltince işaret kalkar', async () => {
  const sayfa = await ac({});
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[0]), 'Authorization');
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'x');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  const satir = satirlar(sayfa)[0];
  assert.equal(hataKutusu(satir).textContent, AYARLAR.tr['ayar.baglanti.ust.hata.adYasak']);
  assert.ok(adGirdisi(satir).classList.contains('gecersiz'));
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.hata.adYasak']);
  assert.ok(sayfa.oge('ustbilgiDurum').className.includes('alan-sonuc-sorun'));
  // yazmaya başlayınca satırın hata işareti temizlenir: ekrandaki işaret hemen, model de (yeniden çizilince hata gelmez)
  yaz(adGirdisi(satir), 'X-Ek');
  assert.equal(adGirdisi(satir).classList.contains('gecersiz'), false, 'kırmızı çerçeve yazınca kalkar');
  assert.equal(hataKutusu(satir).style.display, 'none', 'hata kutusu yazınca gizlenir');
  await tikla(sayfa, 'btnUstbilgiEkle');
  const yenidenCizilen = satirlar(sayfa)[0];
  assert.equal(adGirdisi(yenidenCizilen).classList.contains('gecersiz'), false, 'model hatası da temizlendi');
  assert.equal(hataKutusu(yenidenCizilen).style.display, 'none');
  satirlar(sayfa)[1].children[2].dispatchEvent({ type: 'click' }); // eklenen boş satırı geri al
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.kaydedildi']);
});

test('kayıt reddedilirse (şifreleme yok) sunucunun hazır iletisi gösterilir; satırlar korunur', async () => {
  const sayfa = await ac({ ustbilgileriKaydet: async () => ({ ok: false, sifreleme: true, hata: 'Windows şifreleme hizmeti kullanılamıyor.' }) });
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[0]), 'X-Ek');
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'v');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, 'Windows şifreleme hizmeti kullanılamıyor.');
  assert.equal(satirlar(sayfa).length, 1);
  assert.equal(degerGirdisi(satirlar(sayfa)[0]).value, 'v');
});

test('köprü hata fırlatırsa genel hata iletisi gösterilir ve düğmeler yeniden etkinleşir', async () => {
  const sayfa = await ac({
    ustbilgileriKaydet: async () => {
      throw new Error('ipc');
    },
  });
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.hataGenel']);
  assert.equal(sayfa.oge('btnUstbilgiKaydet').disabled, false);
});

test('satırı kaldır: satır gider, kaydedilmemiş değişiklik uyarısı çıkar, kaydedince sunucuya boş liste gider', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  kaldirDugmesi(satirlar(sayfa)[0]).dispatchEvent({ type: 'click' });
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.kirli']);
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.deepEqual(ustCagrilari(sayfa)[0][1], []);
  assert.equal(sayfa.oge('btnUstbilgiSil').style.display, 'none');
});

test('en çok sınırı: sınır dolunca ekle düğmesi kapanır', async () => {
  const sayfa = await ac({ ustbilgiAdlari: Array.from({ length: 8 }, (_, i) => `X-Ad-${i}`) });
  assert.equal(sayfa.oge('btnUstbilgiEkle').disabled, true);
  kaldirDugmesi(satirlar(sayfa)[0]).dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('btnUstbilgiEkle').disabled, false);
});

test('tümünü sil: onay reddedilirse köprü çağrılmaz; onaylanırsa silinir ve iletisi gösterilir', async () => {
  const red = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, onayYaniti: false, baglantiYaniti: { ustbilgiAdlari: ['X-Ek'] } });
  await tikla(red, 'btnUstbilgiSil');
  assert.deepEqual(ustCagrilari(red), []);
  assert.deepEqual(red.sorular, [AYARLAR.tr['ayar.baglanti.ust.silOnay']]);
  assert.equal(satirlar(red).length, 1);

  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  await tikla(sayfa, 'btnUstbilgiSil');
  assert.deepEqual(ustCagrilari(sayfa), [['ustbilgileriSil']]);
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.silindi']);
  assert.equal(sayfa.oge('btnUstbilgiSil').style.display, 'none');
});

test('üstbilgileri dene: kayıtlı adres sonuçları yazılır; engel/yönlendirme olursa ipucu eklenir; sonuç dil değişince kalkar', async () => {
  const sayfa = await ac({
    ustbilgiAdlari: ['X-Ek'],
    ustbilgileriDene: async () => ({
      ok: true,
      sonuclar: [
        { tur: 'yerel', ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'Home Assistant bulundu: adres çalışıyor.' },
        { tur: 'dis', ok: true, ulasilabilir: false, neden: 'erisim-engelli', mesaj: 'Erişim engellendi.' },
      ],
    }),
  });
  await tikla(sayfa, 'btnUstbilgiDene');
  const kutu = sayfa.oge('ustbilgiDeneSonuc').children;
  assert.equal(kutu.length, 3);
  assert.equal(kutu[0].textContent, 'Ev içi adres: Home Assistant bulundu: adres çalışıyor.');
  assert.ok(kutu[0].className.includes('alan-sonuc-tamam'));
  assert.equal(kutu[1].textContent, 'Dış adres: Erişim engellendi.');
  assert.ok(kutu[1].className.includes('alan-sonuc-sorun'));
  assert.equal(kutu[2].textContent, AYARLAR.tr['ayar.baglanti.ust.deneIpucu']);
  assert.equal(sayfa.oge('btnUstbilgiDene').disabled, false);
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge('ustbilgiDeneSonuc').children.length, 0, 'eski dildeki sınama sonucu kalmaz');
});

test('üstbilgileri dene: başarılı sonuçta ipucu yok; kayıtlı adres yoksa yönlendirici ileti; köprü hatasında hata iletisi', async () => {
  const tamam = await ac({ ustbilgileriDene: async () => ({ ok: true, sonuclar: [{ tur: 'yerel', ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'm' }] }) });
  await tikla(tamam, 'btnUstbilgiDene');
  assert.equal(tamam.oge('ustbilgiDeneSonuc').children.length, 1);

  const bos = await ac({ ustbilgileriDene: async () => ({ ok: true, sonuclar: [] }) });
  await tikla(bos, 'btnUstbilgiDene');
  assert.equal(bos.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.deneYok']);

  const hata = await ac({
    ustbilgileriDene: async () => {
      throw new Error('ipc');
    },
  });
  await tikla(hata, 'btnUstbilgiDene');
  assert.equal(hata.oge('ustbilgiDurum').textContent, AYARLAR.tr['ayar.baglanti.ust.deneHata']);
});

test('dil değişince satır etiketleri, yer tutucular ve durum metni yeni dilde yeniden yazılır; girilen değerler kaybolmaz', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[1]), 'X-Yeni');
  yaz(degerGirdisi(satirlar(sayfa)[1]), 'deger_gizli');
  await sayfa.dilDegisti('en');
  const s = satirlar(sayfa);
  assert.equal(degerGirdisi(s[0]).placeholder, AYARLAR.en['ayar.baglanti.ust.degerKorunur']);
  assert.equal(degerGirdisi(s[1]).placeholder, AYARLAR.en['ayar.baglanti.ust.degerYerTutucu']);
  assert.equal(kaldirDugmesi(s[0]).textContent, 'Remove');
  assert.equal(kaldirDugmesi(s[1]).attributes['aria-label'], 'Remove header X-Yeni');
  assert.equal(adGirdisi(s[1]).value, 'X-Yeni');
  assert.equal(degerGirdisi(s[1]).value, 'deger_gizli');
  assert.equal(sayfa.oge('ustbilgiDurum').textContent, AYARLAR.en['ayar.baglanti.ust.kirli']);
});

test('sunucu yanıtı kayıt dışı değişirse (olay) kaydedilmemiş düzenleme ezilmez', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[1]), 'X-Yeni');
  sayfa.baglantiDeposu.ustbilgiAdlari = ['X-Ek', 'X-Baska'];
  await sayfa.favoriDegisti(); // başka bir yenileme tetikleyicisi: üstbilgi taslağına dokunmaz
  assert.equal(satirlar(sayfa).length, 2);
  assert.equal(adGirdisi(satirlar(sayfa)[1]).value, 'X-Yeni');
  assert.deepEqual(duzles(sayfa.baglantiDeposu.ustbilgiAdlari), ['X-Ek', 'X-Baska']);
});

test('B64: yazılmış ama kaydedilmemiş üstbilgi taslağı pencere kapanırken sorulur; kaydedince sorulmaz', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  assert.equal(sayfa.pencereOlayi('beforeunload').onlendi, false, 'temizken sormaz');

  yaz(degerGirdisi(satirlar(sayfa)[0]), GIZLI);
  const olay = sayfa.pencereOlayi('beforeunload');
  assert.equal(olay.onlendi, true, 'üstbilgi taslağı kaybolacağı için sorulur');
  assert.equal(olay.returnValue, '');

  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.equal(sayfa.pencereOlayi('beforeunload').onlendi, false, 'kaydedilince sorulmaz');
});

test('satırı kaldır: odak klavye kullanıcısının bağlamından çıkmaz (komşu satıra, satır kalmazsa "Üstbilgi ekle"ye)', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Bir', 'X-Iki', 'X-Uc'] });
  const ikinciKaldir = kaldirDugmesi(satirlar(sayfa)[1]);
  ikinciKaldir.focus();
  ikinciKaldir.dispatchEvent({ type: 'click' });
  const kalan = satirlar(sayfa);
  assert.equal(kalan.length, 2);
  assert.equal(sayfa.sonOdak(), adGirdisi(kalan[1]), 'silinen satırın yerine gelen satırın ad girdisi odaklanır');
  assert.equal(adGirdisi(kalan[1]).value, 'X-Uc');

  const sonKaldir = kaldirDugmesi(kalan[1]);
  sonKaldir.focus();
  sonKaldir.dispatchEvent({ type: 'click' });
  assert.equal(sayfa.sonOdak(), adGirdisi(satirlar(sayfa)[0]), 'son satır silinince önceki satıra geçer');

  const tekKaldir = kaldirDugmesi(satirlar(sayfa)[0]);
  tekKaldir.focus();
  tekKaldir.dispatchEvent({ type: 'click' });
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnUstbilgiEkle'));
});

test('tümünü sil: onaydan sonra gizlenen düğme yüzünden odak kaybolmaz ("Üstbilgi ekle"ye geçer); hatada düğme odağını korur', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  sayfa.oge('btnUstbilgiSil').focus();
  await tikla(sayfa, 'btnUstbilgiSil');
  assert.equal(sayfa.oge('btnUstbilgiSil').style.display, 'none');
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnUstbilgiEkle'));

  const hatali = await ac({ ustbilgiAdlari: ['X-Ek'], ustbilgileriSil: async () => ({ ok: false }) });
  hatali.oge('btnUstbilgiSil').focus();
  await tikla(hatali, 'btnUstbilgiSil');
  assert.equal(hatali.oge('btnUstbilgiSil').style.display, '');
  assert.equal(hatali.sonOdak(), hatali.oge('btnUstbilgiSil'), 'pasifleşip yeniden etkinleşen düğme odağı geri alır');

  const ret = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, onayYaniti: false, baglantiYaniti: { ustbilgiAdlari: ['X-Ek'] } });
  ret.oge('btnUstbilgiSil').focus();
  await tikla(ret, 'btnUstbilgiSil');
  assert.equal(ret.sonOdak(), ret.oge('btnUstbilgiSil'), 'onay reddedilirse odağa dokunulmaz');
});

test('"Kaydedildi" sonrası düzenleme: kaydedilmemiş uyarısı başarı (yeşil) rengiyle görünmez; hata iletisi renkli kalır', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'v1');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  const durum = sayfa.oge('ustbilgiDurum');
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.kaydedildi']);
  assert.ok(durum.className.includes('alan-sonuc-tamam'));
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'v2');
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.kirli']);
  assert.ok(!durum.className.includes('alan-sonuc-tamam'), 'uyarı başarı rengi taşımaz');
  assert.ok(!durum.className.includes('alan-sonuc-sorun'));

  // hata iletisi düzenleme sırasında hata renginde görünür kalır
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[1]), 'Authorization');
  yaz(degerGirdisi(satirlar(sayfa)[1]), 'x');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.hata.adYasak']);
  yaz(degerGirdisi(satirlar(sayfa)[1]), 'y');
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.hata.adYasak']);
  assert.ok(durum.className.includes('alan-sonuc-sorun'));
});

test('kaydedilmemiş değişiklik varken "Üstbilgileri dene": sınama sürerken "Sınanıyor…" görünür, bitince kirli uyarısına dönülür', async () => {
  let coz;
  const sayfa = await ac({
    ustbilgiAdlari: ['X-Ek'],
    ustbilgileriDene: () => new Promise((c) => { coz = c; }),
  });
  yaz(degerGirdisi(satirlar(sayfa)[0]), 'yeni_deger');
  const durum = sayfa.oge('ustbilgiDurum');
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.kirli']);
  sayfa.oge('btnUstbilgiDene').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('btnUstbilgiDene').disabled, true);
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.sinaniyor'], 'kirli iken de ilerleme iletisi görünür');
  coz({ ok: true, sonuclar: [{ tur: 'yerel', ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'm' }] });
  await akit();
  assert.equal(sayfa.oge('btnUstbilgiDene').disabled, false);
  assert.equal(durum.textContent, AYARLAR.tr['ayar.baglanti.ust.kirli']);
  assert.equal(sayfa.oge('ustbilgiDeneSonuc').children.length, 1);
});

test('kayıtlı satırın salt okunur adı nedenini title ile söyler; yeni satırda title yok; salt okunur girdi soluk gösterilir (CSS)', async () => {
  const sayfa = await ac({ ustbilgiAdlari: ['X-Ek'] });
  await tikla(sayfa, 'btnUstbilgiEkle');
  const s = satirlar(sayfa);
  assert.equal(adGirdisi(s[0]).readOnly, true);
  assert.equal(adGirdisi(s[0]).title, AYARLAR.tr['ayar.baglanti.ust.adSabit']);
  assert.equal(adGirdisi(s[1]).readOnly, false);
  assert.equal(adGirdisi(s[1]).title, '');
  await sayfa.dilDegisti('en');
  assert.equal(adGirdisi(satirlar(sayfa)[0]).title, AYARLAR.en['ayar.baglanti.ust.adSabit']);
  assert.match(HTML, /\.baglanti-satir input\[type="text"\]:read-only\s*\{[^}]*cursor: not-allowed/);
});

test('satır hatası sorunlu alanı işaretler: değer hatasında değer girdisi, ad hatasında ad girdisi (gecersiz + aria-invalid + aria-describedby); yazınca işaret kalkar', async () => {
  const sayfa = await ac({});
  await tikla(sayfa, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(sayfa)[0]), 'CF-Access-Client-Id');
  await tikla(sayfa, 'btnUstbilgiKaydet'); // değer boş: sunucu 'deger-yok' döner
  let satir = satirlar(sayfa)[0];
  assert.equal(hataKutusu(satir).textContent, AYARLAR.tr['ayar.baglanti.ust.hata.degerYok']);
  assert.ok(hataKutusu(satir).id, 'hata kutusunun kimliği var');
  assert.ok(degerGirdisi(satir).classList.contains('gecersiz'));
  assert.equal(degerGirdisi(satir).getAttribute('aria-invalid'), 'true');
  assert.equal(degerGirdisi(satir).getAttribute('aria-describedby'), hataKutusu(satir).id);
  assert.ok(!adGirdisi(satir).classList.contains('gecersiz'), 'doğru yazılmış ad işaretlenmez');
  assert.equal(adGirdisi(satir).getAttribute('aria-invalid'), null);

  // değeri yazınca işaret ve satır hata kutusu kalkar
  yaz(degerGirdisi(satir), 'x');
  assert.ok(!degerGirdisi(satir).classList.contains('gecersiz'));
  assert.equal(degerGirdisi(satir).getAttribute('aria-invalid'), null);
  assert.equal(degerGirdisi(satir).getAttribute('aria-describedby'), null);
  assert.equal(hataKutusu(satir).style.display, 'none');

  // ad hatası (yasak ad): ad girdisi işaretlenir
  yaz(adGirdisi(satir), 'Authorization');
  await tikla(sayfa, 'btnUstbilgiKaydet');
  satir = satirlar(sayfa)[0];
  assert.equal(hataKutusu(satir).textContent, AYARLAR.tr['ayar.baglanti.ust.hata.adYasak']);
  assert.ok(adGirdisi(satir).classList.contains('gecersiz'));
  assert.equal(adGirdisi(satir).getAttribute('aria-invalid'), 'true');
  assert.equal(adGirdisi(satir).getAttribute('aria-describedby'), hataKutusu(satir).id);
  assert.ok(!degerGirdisi(satir).classList.contains('gecersiz'));
  assert.equal(degerGirdisi(satir).getAttribute('aria-invalid'), null);

  // sunucu 'deger-gecersiz' dönerse de değer girdisi işaretlenir; hata kutusu role=alert taşımaz (durum satırı zaten canlı bölge)
  const gecersiz = await ac({ ustbilgileriKaydet: async () => ({ ok: false, hatalar: [{ sira: 0, neden: 'deger-gecersiz' }] }) });
  await tikla(gecersiz, 'btnUstbilgiEkle');
  yaz(adGirdisi(satirlar(gecersiz)[0]), 'X-Ek');
  yaz(degerGirdisi(satirlar(gecersiz)[0]), 'a\nb');
  await tikla(gecersiz, 'btnUstbilgiKaydet');
  const g = satirlar(gecersiz)[0];
  assert.equal(degerGirdisi(g).getAttribute('aria-invalid'), 'true');
  assert.equal(adGirdisi(g).getAttribute('aria-invalid'), null);
  assert.equal(hataKutusu(g).getAttribute('role'), null);
});
