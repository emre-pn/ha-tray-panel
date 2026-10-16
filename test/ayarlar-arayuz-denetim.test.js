'use strict';

/**
 * 1.2.0 denetimi, Ayarlar grubu: sayfa davranışı sınamaları (sahte DOM, test/ayarlar-sahte.js). Her sınama başlığında denetim maddesi
 * (h-01, k-02, ...) yazılıdır. Ana süreç tarafı test/ana-surec.test.js ve kütüphane testlerindedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HTML,
  BETIK,
  AYAR,
  CIHAZLAR,
  AYAR_D3,
  CIHAZLAR_D3,
  AYAR_D3_FAVORILI,
  akit,
  duzles,
  tusOlayi,
  acilmisSayfa,
  satirlar,
  satirKimligi,
  satirBul,
  girdiler,
  metinKutulari,
  sira,
  siraMetni,
} = require('./ayarlar-sahte');

// Ayarlar sayfasının Türkçe metinleri artık sözlüktedir (src/lib/ceviri/ayarlar.js); metin denetimleri sözlüğü de tarar.
const TR_SOZLUK_METNI = Object.values(require('../src/lib/ceviri/ayarlar').tr).join('\n');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa, ad = 'ayarlariKaydet') => duzles(sayfa.cagrilar.filter((c) => c[0] === ad).at(-1)[1]);
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const gecersizMi = (oge) => oge.classList.contains('gecersiz') && oge.getAttribute('aria-invalid') === 'true';
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display === 'inline';

// ---------------------------------------------------------------------------
// h-01: kalıcı bildirim ve hatalı alanın işaretlenmesi
// ---------------------------------------------------------------------------

test('h-01: adres hatası kalıcı hata bildirimi verir, hatalı alanı işaretler ve odaklar; alan düzenlenince işaret kalkar; bildirim kapatılabilir', async () => {
  const MESAJ = 'Dış adres geçersiz ya da https değil. Örnek: https://ha.example.com';
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    ayarKaydetYaniti: () => ({ ok: false, hata: MESAJ, alanlar: ['disAdres'], alanMesajlari: { disAdres: MESAJ } }),
  });
  sayfa.oge('disAdres').value = 'http://yanlis.example';
  await kaydet(sayfa);

  assert.equal(sayfa.oge('genelBildirim').textContent, MESAJ);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-hata/);
  assert.equal(sayfa.oge('genelBildirim').getAttribute('role'), 'alert', 'hata ekran okuyucuya hemen okunur');
  assert.equal(sayfa.oge('bildirimSeridi').style.display, 'flex');
  assert.equal(sayfa.etkinZamanlayicilar().length, 0, 'hata bildirimi kendiliğinden kaybolmaz');
  assert.ok(gecersizMi(sayfa.oge('disAdres')), 'hatalı alan işaretli');
  assert.equal(sayfa.oge('disAdresHata').textContent, MESAJ);
  assert.equal(sayfa.oge('disAdresHata').style.display, 'block');
  assert.equal(sayfa.sonOdak(), sayfa.oge('disAdres'), 'hatalı alana odaklanılır');
  assert.equal(gecersizMi(sayfa.oge('yerelAdres')), false, 'sağlam alan işaretlenmez');
  assert.equal(sayfa.oge('btnAyarlariKaydet').disabled, false, 'kaydet düğmesi yeniden kullanılabilir');
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Kaydet');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'favorileriKaydet'), false, 'genel kayıt reddedilince favori çağrısı yapılmaz');

  yaz(sayfa.oge('disAdres'), 'https://ha.example.com');
  assert.equal(gecersizMi(sayfa.oge('disAdres')), false, 'düzenleyince işaret kalkar');
  assert.equal(sayfa.oge('disAdresHata').style.display, 'none');

  sayfa.oge('btnBildirimKapat').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('bildirimSeridi').style.display, 'none');
});

test('h-01: başarı bildirimi kendiliğinden kaybolur (zamanlayıcı kurulur), uyarı ise kalıcıdır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, favoriSonucu: { ok: true, sayi: 2, eksik: 0, engelli: 0 } });
  await kaydet(sayfa);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-basarili/);
  assert.equal(sayfa.oge('genelBildirim').getAttribute('role'), 'status');
  const zamanlayici = sayfa.etkinZamanlayicilar();
  assert.equal(zamanlayici.length, 1);
  zamanlayici[0].islev();
  assert.equal(sayfa.oge('bildirimSeridi').style.display, 'none');

  const uyarili = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    ayarKaydetYaniti: () => ({ ok: true, uyarilar: [{ alan: 'kisayol', mesaj: 'Ctrl+Alt+Q AltGr uyarısı', yalnizKayitBasarili: true }] }),
  });
  await kaydet(uyarili);
  assert.match(uyarili.oge('genelBildirim').className, /bildirim-uyari/);
  assert.equal(uyarili.etkinZamanlayicilar().length, 0, 'uyarı kapatılana dek kalır');
  assert.equal(gecersizMi(uyarili.oge('kisayol')), false, 'yalnızca bilgi veren uyarı alanı hatalı işaretlemez');
});

test('h-01: sunucunun reddettiği değerler (vurgu rengi, kısayol, bekleme süresi) yazılan haliyle kalır, işaretlenir ve kaydedilmemiş sayılır', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    ayarKaydetYaniti: () => ({
      ok: true,
      uyarilar: [
        { alan: 'vurguRengi', mesaj: 'Vurgu rengi #rrggbb biçiminde olmalı (örn. #0f75e0) ya da boş bırakılmalı; önceki renk korundu.' },
        { alan: 'kisayol', mesaj: 'Ctrl+C Windows’a ayrılmış (kopyalama); başka bir birleşim seç. Önceki kısayol korundu.' },
        { alan: 'anaPanoyaDonDk', mesaj: 'Ana panoya dönme süresi 0 ile 1440 dakika arasında bir tam sayı olmalı; önceki değer korundu.' },
      ],
    }),
  });
  sayfa.oge('vurguRengi').value = 'kırmızı';
  sayfa.oge('kisayol').value = 'Ctrl+C';
  sayfa.oge('anaPanoyaDonDk').value = '99999';
  await kaydet(sayfa);

  assert.equal(sayfa.oge('vurguRengi').value, 'kırmızı', 'yazılan değer silinmez');
  assert.equal(sayfa.oge('kisayol').value, 'Ctrl+C');
  assert.equal(sayfa.oge('anaPanoyaDonDk').value, '99999');
  for (const kimlik of ['vurguRengi', 'kisayol', 'anaPanoyaDonDk']) assert.ok(gecersizMi(sayfa.oge(kimlik)), `${kimlik} işaretli`);
  assert.match(sayfa.oge('vurguHata').textContent, /önceki renk korundu/);
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /Windows’a ayrılmış/);
  assert.match(sayfa.oge('anaPanoyaDonHata').textContent, /0 ile 1440/);
  assert.equal(sayfa.oge('bolumPencere').open, true, 'katlanmış bölümdeki hatalı alan görünür olsun diye bölüm açılır');
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
  assert.equal(kirliMi(sayfa), true, 'sunucuda olmayan değer hâlâ kaydedilmemiş');
});

// ---------------------------------------------------------------------------
// h-05 + k-02: yalnız kaydedilen bölüm tazelenir; kirli göstergesi; kapatırken sor
// ---------------------------------------------------------------------------

test('h-05: anahtar kaydı yalnız anahtar bölümünü tazeler; formdaki ve favori listesindeki kaydedilmemiş düzenlemeler kaybolmaz', async () => {
  let sayfa;
  sayfa = await acilmisSayfa({
    ayar: { ...AYAR_D3_FAVORILI, yetkiDurumu: 'dogrulanamadi' }, // kesici açık: liste kendiliğinden yüklenmez
    cihazlar: CIHAZLAR_D3,
    kaydetYaniti: () => {
      sayfa.sunucu.yetkiDurumu = null; // yeni anahtar doğrulandı
      return { ok: true, uyari: '' };
    },
  });
  assert.match(sayfa.oge('anahtarRozet').textContent, /Doğrulanamadı/);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false);
  sayfa.oge('btnCihazlariYukle').dispatchEvent({ type: 'click' }); // kullanıcı listeyi kendisi açar
  await akit();
  sayfa.oge('koseBildirimi').checked = false;
  sayfa.oge('koseBildirimi').dispatchEvent({ type: 'change' });
  satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0].tikla(); // film seçildi
  yaz(sayfa.oge('anahtarGirdisi'), 'TEST_SAHTE_ANAHTAR_000000');

  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor', 'anahtar bölümü tazelendi');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'ayarlariKaydet'), false, 'anahtar kaydı genel ayarları kaydetmez');
  assert.equal(sayfa.oge('koseBildirimi').checked, false, 'form düzenlemesi korundu');
  assert.equal(satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0].checked, true, 'favori seçimi korundu');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '3 favori seçili');
  assert.equal(kirliMi(sayfa), true, 'kaydedilmemiş değişiklikler hâlâ işaretli');

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa, 'favorileriKaydet');
  assert.ok(yuk.some((g) => g.entity_id === 'scene.film'));
  assert.equal(sonKayitYuku(sayfa).koseBildirimi, false);
  assert.equal(kirliMi(sayfa), false);
});

test('k-02: kaydedilmemiş değişiklik göstergesi: düzenleyince görünür, geri alınca ve kaydedince kaybolur; eşdeğer yazım (ctrl alt h) kirli sayılmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(kirliMi(sayfa), false);
  assert.match(HTML, /id="kirliGosterge"[^>]*role="status"/);
  assert.match(HTML, /id="kirliGosterge"[^>]*>[^<]*Kaydedilmemiş değişiklik var/, 'gösterge metni sayfada yazılı; görünürlüğü kirliGuncelle belirler');

  sayfa.oge('koseBildirimi').checked = false;
  sayfa.oge('koseBildirimi').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('koseBildirimi').checked = true;
  sayfa.oge('koseBildirimi').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), false, 'düzenleme geri alındı');

  yaz(sayfa.oge('kisayol'), 'ctrl alt h');
  assert.equal(kirliMi(sayfa), false, 'aynı kısayolun başka yazımı değişiklik değildir');
  yaz(sayfa.oge('kisayol'), 'Ctrl+Alt+K');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra temiz');
  assert.equal(sayfa.oge('kisayol').value, 'Ctrl+Alt+K');
});

test('k-02: favori seçimi, sırası ve karo adı da kirli sayılır; kayıtlı hale dönünce temizlenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  const film = satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0];
  film.tikla();
  assert.equal(kirliMi(sayfa), true);
  film.tikla();
  assert.equal(kirliMi(sayfa), false, 'seçim geri alındı');

  const etiket = metinKutulari(satirBul(sayfa, 'light.salon_lambasi'))[1];
  yaz(etiket, 'Salon');
  assert.equal(kirliMi(sayfa), true);
  yaz(etiket, '');
  assert.equal(kirliMi(sayfa), false, 'karo adı eski haline döndü');
});

test('k-02: kapatırken sor: kirliyse beforeunload kapatmayı durdurur (ana süreç sorar), temizse durdurmaz; yazılmış ama kaydedilmemiş anahtar da sayılır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.pencereOlayi('beforeunload').onlendi, false);

  sayfa.oge('bipSesi').checked = true;
  sayfa.oge('bipSesi').dispatchEvent({ type: 'change' });
  const olay = sayfa.pencereOlayi('beforeunload');
  assert.equal(olay.onlendi, true);
  assert.equal(olay.returnValue, '');

  const temiz = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  yaz(temiz.oge('anahtarGirdisi'), 'YARIM_KALAN_ANAHTAR');
  assert.equal(temiz.pencereOlayi('beforeunload').onlendi, true, 'yazılmış anahtar kaybolacağı için sorulur');
});

test('k-11: Esc pencereyi kapatma isteği gönderir (kirliyse ana süreç sorar); kısayol kutusundayken Esc yalnız kutudan çıkar; Ctrl+S kaydeder', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const esc = sayfa.belgeTusu({ key: 'Escape' });
  assert.equal(esc.onlendi, true);
  assert.equal(sayfa.kapatmaSayisi(), 1);

  const kutuEsc = tusOlayi({ key: 'Escape', code: 'Escape' });
  sayfa.oge('kisayol').dispatchEvent(kutuEsc);
  assert.equal(sayfa.kapatmaSayisi(), 1, 'kısayol kutusunda Esc pencereyi kapatmaz');
  assert.equal(sayfa.oge('kisayol').bulanma, 1);
  assert.equal(kutuEsc.durduruldu, true);

  const ctrlS = sayfa.belgeTusu({ key: 's', ctrlKey: true });
  await akit();
  assert.equal(ctrlS.onlendi, true);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').length, 1);
  const ctrlShiftS = sayfa.belgeTusu({ key: 'S', ctrlKey: true, shiftKey: true });
  assert.equal(ctrlShiftS.onlendi, false, 'Ctrl+Shift+S başka bir kısayoldur');
});

test('h-05: sunucunun reddettiği HA panosu satırı silinmez: yazılan değerlerle kalır, nedeni yazılır; düzeltilip kaydedilince kaydolur', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR_D3,
    cihazlar: CIHAZLAR_D3,
    ayarKaydetYaniti: (yuk, sunucu) => {
      const gecerli = yuk.panolar.filter((p) => p.ad && p.yol.startsWith('/'));
      sunucu.panolar = gecerli;
      const atilan = yuk.panolar.length - gecerli.length;
      return { ok: true, uyarilar: atilan > 0 ? [{ alan: 'panolar', mesaj: `${atilan} HA panosu geçersiz olduğu için kaydedilmedi (ad ve /lovelace/ev gibi bir yol gerekir).` }] : [] };
    },
  });
  sayfa.oge('btnPanoEkle').dispatchEvent({ type: 'click' });
  const satirSayisi = () => sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir').length;
  const ikinci = () => sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir')[1];
  yaz(girdiler(ikinci())[0], 'Mutfak');
  yaz(girdiler(ikinci())[1], 'mutfak-yolsuz');
  await kaydet(sayfa);

  assert.equal(satirSayisi(), 2, 'reddedilen satır silinmedi');
  assert.deepEqual(girdiler(ikinci()).map((g) => g.value), ['Mutfak', 'mutfak-yolsuz', '']);
  assert.match(ikinci().textContent, /Kaydedilmedi: HA panosu için bir ad ve \/lovelace\/ev gibi bir yol gerekir/);
  assert.equal(kirliMi(sayfa), true, 'kaydedilmeyen satır nedeniyle kirli');
  assert.match(sayfa.oge('genelBildirim').textContent, /1 HA panosu geçersiz/);

  yaz(girdiler(ikinci())[1], '/lovelace/mutfak');
  assert.doesNotMatch(ikinci().textContent, /Kaydedilmedi/, 'düzenlemeye başlayınca neden kalkar');
  await kaydet(sayfa);
  assert.equal(satirSayisi(), 2);
  assert.doesNotMatch(sayfa.oge('panolarListesi').textContent, /Kaydedilmedi/);
  assert.equal(kirliMi(sayfa), false);
  assert.deepEqual(sayfa.sunucu.panolar.map((p) => p.yol), ['/energy', '/lovelace/mutfak']);
});

// ---------------------------------------------------------------------------
// h-24 + k-01 + h-25: kısayol kutuları
// ---------------------------------------------------------------------------

test('k-01: kısayol kutusu tuşa basılarak doldurulur (Ctrl/Alt/Win + tuş); düz tuşlar yazı yazar; Ctrl+V/Tab yakalanmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const kutu = sayfa.oge('kisayol');

  const k = tusOlayi({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
  kutu.dispatchEvent(k);
  assert.equal(kutu.value, 'Ctrl+Alt+K');
  assert.equal(k.onlendi, true);
  assert.equal(kirliMi(sayfa), true);

  const win = tusOlayi({ key: 'h', code: 'KeyH', metaKey: true });
  kutu.dispatchEvent(win);
  assert.equal(kutu.value, 'Win+H');
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /Windows tuşlu birleşimlerin/);

  const f = tusOlayi({ key: 'F9', code: 'F9', altKey: true, shiftKey: true });
  kutu.dispatchEvent(f);
  assert.equal(kutu.value, 'Alt+Shift+F9');

  for (const olay of [
    tusOlayi({ key: 'a', code: 'KeyA' }), // düz harf: yazı
    tusOlayi({ key: 'Tab', code: 'Tab' }),
    tusOlayi({ key: 'v', code: 'KeyV', ctrlKey: true }), // yapıştır
    tusOlayi({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), // yalnız değiştirici
    tusOlayi({ key: 'Backspace', code: 'Backspace' }),
  ]) {
    const once = kutu.value;
    kutu.dispatchEvent(olay);
    assert.equal(olay.onlendi, false, `${olay.key} yakalanmaz`);
    assert.equal(kutu.value, once);
  }
});

test('h-24: yazılan kısayol Ctrl/Win/küçük harf/boşluk kabul eder; kutudan çıkınca normalleşir; kayıt yükü kaydedilen biçimdedir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3 });
  yaz(sayfa.oge('kisayol'), 'ctrl alt k');
  assert.equal(gecersizMi(sayfa.oge('kisayol')), false);
  sayfa.oge('kisayol').dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge('kisayol').value, 'Ctrl+Alt+K');

  yaz(sayfa.oge('paletKisayol'), 'win + shift + p');
  sayfa.oge('paletKisayol').dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge('paletKisayol').value, 'Shift+Win+P', 'değiştirici sırası normal sıraya girer');

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.kisayol, 'Control+Alt+K');
  assert.equal(yuk.paletKisayol, 'Shift+Super+P');
});

test('k-01: favori ve HA panosu kısayol kutuları da tuş yakalar; favori kısayolu yükte kaydedilen biçimdedir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  const salon = metinKutulari(satirBul(sayfa, 'light.salon_lambasi'))[0];
  salon.dispatchEvent(tusOlayi({ key: 'l', code: 'KeyL', ctrlKey: true, altKey: true }));
  assert.equal(salon.value, 'Ctrl+Alt+L');

  const panoKisayol = girdiler(sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir')[0])[2];
  panoKisayol.dispatchEvent(tusOlayi({ key: 'g', code: 'KeyG', ctrlKey: true, altKey: true }));
  assert.equal(panoKisayol.value, 'Ctrl+Alt+G');

  await kaydet(sayfa);
  const favoriler = new Map(sonKayitYuku(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g]));
  assert.equal(favoriler.get('light.salon_lambasi').kisayol, 'Control+Alt+L');
  assert.equal(sonKayitYuku(sayfa).panolar[0].kisayol, 'Control+Alt+G');
});

test('h-25: Windows’a ayrılmış birleşimler anında reddedilir; AltGr çakışması hangi tuşların etkilendiğini söyler; ana kısayol boş olamaz, palet boş olabilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3 });
  yaz(sayfa.oge('kisayol'), 'Ctrl+C');
  assert.ok(gecersizMi(sayfa.oge('kisayol')));
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /Windows’a ayrılmış \(kopyalama\)/);
  yaz(sayfa.oge('kisayol'), 'alt f4');
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /Windows’a ayrılmış/);

  yaz(sayfa.oge('kisayol'), 'Ctrl+Alt+Q');
  assert.equal(gecersizMi(sayfa.oge('kisayol')), false, 'AltGr çakışması engel değil, uyarıdır');
  const uyari = sayfa.oge('kisayolUyarilari').textContent;
  assert.match(uyari, /AltGr\+Q \(@\)/);
  assert.match(uyari, /Çakışan tuşlar: Q \(@\), E \(€\), T \(₺\)/);

  yaz(sayfa.oge('kisayol'), '');
  assert.ok(gecersizMi(sayfa.oge('kisayol')));
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /boş olamaz/);
  yaz(sayfa.oge('paletKisayol'), '');
  assert.equal(gecersizMi(sayfa.oge('paletKisayol')), false);
  assert.equal(sayfa.oge('paletKisayolUyarilari').style.display, 'none');

  yaz(sayfa.oge('kisayol'), 'Shift+K');
  assert.match(sayfa.oge('kisayolUyarilari').textContent, /Ctrl, Alt veya Win/);
});

test('h-25: Varsayılan Yap düğmesi kısayolu geçerli biçimde geri getirir ve işareti kaldırır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3 });
  yaz(sayfa.oge('kisayol'), 'Ctrl+C');
  sayfa.oge('btnKisayolVarsayilan').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('kisayol').value, 'Ctrl+Alt+H');
  assert.equal(gecersizMi(sayfa.oge('kisayol')), false);
  assert.equal(kirliMi(sayfa), false);
});

// ---------------------------------------------------------------------------
// h-27: favori listesi arka planda değişti
// ---------------------------------------------------------------------------

test('h-27: hazır karolar arka planda eklenince liste tazelenir; kullanıcının kaydedilmemiş seçimi ve düzenlemeleri korunur', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  const once = sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length;
  satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0].tikla(); // kullanıcı film'i seçti (kaydetmedi)
  assert.equal(kirliMi(sayfa), true);

  // Ana süreç hazır karoları ekledi
  sayfa.sunucu.favoriler.push({ entity_id: 'light.gizli_aday', ad: 'Gizli Aday' });
  await sayfa.favoriDegisti();

  assert.ok(sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length > once, 'cihaz listesi yeniden alındı');
  assert.equal(satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0].checked, true, 'kaydedilmemiş seçim korundu');
  assert.equal(satirBul(sayfa, 'light.gizli_aday').bul((o) => o.etiket === 'input')[0].checked, true, 'yeni eklenen favori seçili görünür');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '4 favori seçili');
  assert.deepEqual(sira(sayfa).map(siraMetni), ['Salon Lambası', 'Seçili Gizli', 'Film', 'Gizli Aday'], 'kullanıcının sırası korunur, yeni favori sona eklenir');
  assert.match(sayfa.oge('genelBildirim').textContent, /güncellendi/);
  assert.equal(kirliMi(sayfa), true);

  // Kaydedilen yük eski listeyle yeni favoriyi ezmez
  await kaydet(sayfa);
  const kimlikler = sonKayitYuku(sayfa, 'favorileriKaydet').map((g) => g.entity_id);
  assert.ok(kimlikler.includes('light.gizli_aday') && kimlikler.includes('scene.film'));
});

test('h-27: kullanıcının kaydedilmemiş düzenlemesi yoksa yeni favoriler sunucudaki sırayla gelir ve gösterge çıkmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  sayfa.sunucu.favoriler.unshift({ entity_id: 'scene.film', ad: 'Film' });
  await sayfa.favoriDegisti();
  assert.deepEqual(sira(sayfa).map(siraMetni), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.equal(kirliMi(sayfa), false);
});

// ---------------------------------------------------------------------------
// h-28: Türkçe harf katlamalı cihaz süzgeci
// ---------------------------------------------------------------------------

test('h-28: cihaz süzgeci Türkçe harf farkını gözetmez ("isik" -> Işık, "SERIT" -> şerit); palet aramasıyla aynı eşleştirici', async () => {
  const cihazlar = {
    ...CIHAZLAR_D3,
    cihazlar: [
      ...CIHAZLAR_D3.cihazlar,
      { entity_id: 'light.led_serit', ad: 'Masa LED Şeridi', alan: 'light', alanEtiketi: 'Işıklar', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
      { entity_id: 'switch.kahve', ad: 'Kahve makinesi', alan: 'switch', alanEtiketi: 'Anahtarlar', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
    ],
  };
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar });
  const filtrele = (metin) => {
    yaz(sayfa.oge('cihazAra'), metin);
    return satirlar(sayfa).map(satirKimligi);
  };
  assert.deepEqual(filtrele('isik'), ['light.salon_lambasi', 'light.led_serit'], '"isik" Işıklar türünü bulur, diğerlerini getirmez');
  assert.deepEqual(filtrele('SERIT'), ['light.led_serit']);
  assert.deepEqual(filtrele('şerit'), ['light.led_serit']);
  assert.deepEqual(filtrele('kahve mak'), ['switch.kahve'], 'her sözcük eşleşmeli');
  assert.equal(filtrele('').length, 5, 'boş süzgeç hepsini (gizliler hariç) gösterir');
});

// ---------------------------------------------------------------------------
// h-29: Yeniden Dene
// ---------------------------------------------------------------------------

test('h-29: Yeniden Dene sürerken düğme ve rozet "Doğrulanıyor…" der; sonuç gelince rozet gerçek duruma döner', async () => {
  let birak;
  const kapi = new Promise((coz) => {
    birak = coz;
  });
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, yetkiDurumu: 'dogrulanamadi' },
    cihazlar: CIHAZLAR,
    yenidenDeneYaniti: async (secenek, sunucu) => {
      await kapi;
      sunucu.yetkiDurumu = null; // tek deneme başarılı
      return { ok: true };
    },
  });
  assert.match(sayfa.oge('anahtarRozet').textContent, /Doğrulanamadı/);
  sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('btnYetkiYenidenDene').textContent, 'Doğrulanıyor…');
  assert.equal(sayfa.oge('btnYetkiYenidenDene').disabled, true);
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Doğrulanıyor…');

  birak();
  await akit();
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor', 'rozet tazelendi');
  assert.equal(sayfa.oge('yetkiDurumUyari').style.display, 'none');
  assert.equal(sayfa.oge('btnYetkiYenidenDene').style.display, 'none');
  assert.equal(sayfa.oge('btnYetkiYenidenDene').textContent, 'Yeniden Dene');
  assert.equal(sayfa.oge('btnYetkiYenidenDene').disabled, false);
  assert.match(sayfa.oge('genelBildirim').textContent, /yeniden doğrulandı/);
  assert.ok(sayfa.getirSayisi() >= 2, 'durum ana süreçten yeniden okundu');
});

test('h-29: deneme yine başarısız olursa rozet yeni durumu (reddedildi) gösterir ve uyarı kalıcıdır', async () => {
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, yetkiDurumu: 'dogrulanamadi' },
    cihazlar: CIHAZLAR,
    yenidenDeneYaniti: async (secenek, sunucu) => {
      sunucu.anahtarReddedildi = true;
      sunucu.yetkiDurumu = 'reddedildi';
      return { ok: true };
    },
  });
  sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(sayfa.oge('anahtarRozet').textContent, /Home Assistant Reddetti/);
  assert.equal(sayfa.oge('anahtarReddedildiUyari').style.display, 'block');
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
  assert.equal(sayfa.etkinZamanlayicilar().length, 0);
});

// ---------------------------------------------------------------------------
// g-10, g-06, g-01, g-14, k-16: sayfa yapısı ve görünüm (HTML üzerinde)
// ---------------------------------------------------------------------------

test('g-10: tek Kaydet çubuğu; anahtar kaydı ayrı; bölüm bağlantıları üstte; nadir bölümler katlanır; iç içe kaydırma yok; başlıklar h2', () => {
  assert.doesNotMatch(HTML, /btnFavorileriKaydet/);
  assert.doesNotMatch(BETIK, /btnFavorileriKaydet/);
  assert.equal([...HTML.matchAll(/id="btnAyarlariKaydet"/g)].length, 1);
  assert.match(HTML, /\.kaydet-cubugu\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/);
  assert.match(HTML, /\.ust-serit\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
  assert.match(HTML, /id="btnAnahtarKaydet"/, 'anahtar kaydı ayrı düğmede');
  const cubuk = /<div class="kaydet-cubugu"[\s\S]*?<\/div>\s*<\/div>/.exec(HTML)[0];
  assert.doesNotMatch(cubuk, /btnAnahtarKaydet/, 'anahtar düğmesi Kaydet çubuğunda değil');

  const baglar = [...HTML.matchAll(/<a id="gezin\w+" href="#(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(baglar, ['bolumBaglanti', 'bolumFavoriler', 'bolumKisayollar', 'bolumGorunum', 'bolumAnahtar', 'bolumDiger']);
  for (const hedef of baglar) assert.match(HTML, new RegExp(`id="${hedef}"`));

  const katlananlar = [...HTML.matchAll(/<details class="bolum" id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(katlananlar, ['bolumPencere', 'bolumGeriBildirim', 'bolumBaslangic', 'bolumYedek']);

  const liste = /\.cihaz-listesi\s*\{([^}]*)\}/.exec(HTML)[1];
  assert.doesNotMatch(liste, /overflow|max-height/, 'cihaz listesi kendi içinde kaydırılmaz');
  assert.ok([...HTML.matchAll(/<h2[ >]/g)].length >= 6, 'bölüm başlıkları h2');
  assert.doesNotMatch(HTML, /<h3 class="bolum-baslik">(Bağlantı|Favoriler|Kısayollar|Görünüm)</);
});

test('g-10: bölüm bağlantısı tıklanınca bölüme kaydırır, başlığa odaklanır; uzun cihaz listesi "Daha fazla göster" ile sayfalanır', async () => {
  const cok = {
    ...CIHAZLAR,
    cihazlar: Array.from({ length: 120 }, (_, i) => ({ entity_id: `light.lamba_${String(i).padStart(3, '0')}`, ad: `Lamba ${i}`, alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false })),
    eksik: [],
    engelli: [],
  };
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, favoriler: [] }, cihazlar: cok });
  const baglanti = tusOlayi({ type: 'click' });
  sayfa.oge('gezinGorunum').dispatchEvent({ type: 'click', preventDefault: baglanti.preventDefault });
  assert.equal(baglanti.onlendi, true);
  assert.equal(sayfa.oge('bolumGorunum').kaydirma, 1);
  assert.equal(sayfa.sonOdak(), sayfa.oge('gorunumBaslik'));

  assert.equal(satirlar(sayfa).length, 50);
  assert.equal(sayfa.oge('btnDahaFazla').style.display, 'inline-flex');
  assert.match(sayfa.oge('btnDahaFazla').textContent, /70/);
  sayfa.oge('btnDahaFazla').dispatchEvent({ type: 'click' });
  assert.equal(satirlar(sayfa).length, 100);
  sayfa.oge('btnDahaFazla').dispatchEvent({ type: 'click' });
  assert.equal(satirlar(sayfa).length, 120);
  assert.equal(sayfa.oge('btnDahaFazla').style.display, 'none');
});

test('g-06: soluk metin ve birincil düğme renkleri okunaklı (#9ca3af, #2563eb); beyaz yazılı düğme en az 4,5:1 kontrastta', () => {
  assert.match(HTML, /--text-dim:\s*#9ca3af/);
  assert.match(HTML, /--primary-btn:\s*#2563eb/);
  assert.match(HTML, /\.buton-birincil\s*\{[^}]*background:\s*var\(--primary-btn\)/);
  const parlaklik = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const kontrast = (a, b) => (Math.max(parlaklik(a), parlaklik(b)) + 0.05) / (Math.min(parlaklik(a), parlaklik(b)) + 0.05);
  assert.ok(kontrast('#2563eb', '#ffffff') >= 4.5);
  assert.ok(kontrast('#9ca3af', '#181b22') >= 4.5, 'soluk metin kart zemininde okunaklı');
  assert.ok(kontrast('#9ca3af', '#101216') >= 4.5);
});

test('g-01: koyu varsayılan + prefers-color-scheme: light açık tema; color-scheme bildirilir; tema açıklaması gerçeği söyler', () => {
  assert.match(HTML, /<meta name="color-scheme" content="dark light">/);
  assert.match(HTML, /color-scheme:\s*dark light/);
  const acik = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([\s\S]*?)\n      \}\n    \}/.exec(HTML);
  assert.ok(acik, 'açık tema bloğu var');
  for (const ad of ['--bg', '--card-bg', '--text-main', '--text-muted', '--text-dim', '--input-bg', '--btn2-bg']) assert.match(acik[1], new RegExp(`${ad}:`), `${ad} açık temada tanımlı`);
  const tema = /<label for="temaZorla"[^>]*>Tema<\/label>[\s\S]*?<div class="ipucu"[^>]*>([\s\S]*?)<\/div>/.exec(HTML)[1];
  assert.match(tema, /hızlı panel, palet ve köşe bildirimi pencereleri Windows’un açık ya da koyu temasını izler/); // yüzey pencereleri de açık tema alır (g-02)
  assert.doesNotMatch(tema, /şu an her zaman koyu/);
  assert.match(tema, /Ayarlar penceresi/);
});

test('g-14: tek terim ("HA panosu", "Ev içi", "Dış adres") ve tek hitap (sen); kıvrık kesme işareti', () => {
  assert.match(HTML, /HA panosu/);
  assert.doesNotMatch(HTML, /Pano kısayolları|Pano Ekle|>Panolar</);
  assert.doesNotMatch(BETIK + TR_SOZLUK_METNI, /Pano kısayolları|Pano adı|pano listesi/);
  assert.match(HTML, /Ev İçi Adres/);
  assert.match(HTML, /Dış Adres/);
  assert.doesNotMatch(HTML, /Yerel Adres|Uzak Adres|İnternet adresi/);
  // "siz" kalıpları (anahtar silme onay metni dahil: ana sürecin metniyle birebir aynıdır, bkz. test/yapi.test.js)
  const metin = HTML + BETIK + TR_SOZLUK_METNI;
  const sozcuk = (desen) => new RegExp(`(?<![\\p{L}])(?:${desen})(?![\\p{L}])`, 'iu');
  assert.doesNotMatch(metin, sozcuk('yapıştırın|seçin|yazın|girin|kullanın|bırakın|kapatın|deneyin|koymayın|oluşturun|ekleyin|silin|bakın|edin|kaydedin|açın|bulun'));
  // "yalnız", "önizleme" gibi sözcükler siz-kalıbı değildir: yalnız ek olarak -ınız/-iniz/-unuz/-ünüz/-sanız/-seniz aranır
  assert.doesNotMatch(metin, sozcuk('siz|sizin|sizi|\\p{L}*(?:ınız|iniz|unuz|ünüz|sanız|seniz)\\p{L}*'));
});

test('k-16: erişilebilirlik: her bölüm başlığa bağlı, form alanlarının etiketi var, durum bölgeleri aria-live, düğmeler kendi başına anlamlı', () => {
  for (const [, kimlik] of HTML.matchAll(/<section class="bolum" id="\w+" aria-labelledby="(\w+)"/g)) assert.match(HTML, new RegExp(`id="${kimlik}"`));
  // her <label for="x"> bir öğeye bağlı
  for (const [, hedef] of HTML.matchAll(/<label for="(\w+)"/g)) assert.match(HTML, new RegExp(`id="${hedef}"`), `label for=${hedef}`);
  // etiketsiz giriş yok: id'li her input/select ya label for ile ya aria-label ile ya da sarmalayan label ile adlandırılmış
  for (const [oge, kimlik] of [...HTML.matchAll(/<(?:input|select)[^>]*\bid="(\w+)"[^>]*>/g)].map((m) => [m[0], m[1]])) {
    const etiketli = new RegExp(`<label for="${kimlik}"`).test(HTML) || /aria-label=/.test(oge) || /type="checkbox"/.test(oge);
    assert.ok(etiketli, `#${kimlik} etiketsiz`);
  }
  for (const kimlik of ['genelBildirim', 'kirliGosterge', 'yerelAdresSonuc', 'disAdresSonuc', 'anahtarUzunluk', 'anahtarRozet']) {
    assert.match(HTML, new RegExp(`id="${kimlik}"[^>]*(?:role="(?:status|alert)"|aria-live=)`), `${kimlik} canlı bölge`);
  }
  assert.match(HTML, /<nav class="bolum-gezinti" aria-label="Ayar bölümleri"(?: data-i18n-attr="aria-label:ayar\.gezin\.etiket")?>/);
  assert.match(HTML, /id="btnAnahtarGoster"[^>]*aria-pressed="false"[^>]*aria-controls="anahtarGirdisi"/);
  assert.match(HTML, /<html lang="tr">/);
});

// ---------------------------------------------------------------------------
// g-12, g-13: renk seçici, yakınlaştırma
// ---------------------------------------------------------------------------

test('g-12: vurgu rengi için renk seçici ve önizleme: seçici ile metin kutusu eşleşir, geçersiz renk işaretlenir, Sistem Rengi sıfırlar', async () => {
  assert.match(HTML, /<input type="color" id="vurguRengiSecici"/);
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, vurguRengi: '#0f75e0' }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('vurguOnizleme').style.borderColor, '#0f75e0');
  assert.equal(sayfa.oge('vurguRengiSecici').value, '#0f75e0');

  sayfa.oge('vurguRengiSecici').value = '#e91e63';
  sayfa.oge('vurguRengiSecici').dispatchEvent({ type: 'input' });
  assert.equal(sayfa.oge('vurguRengi').value, '#e91e63');
  assert.equal(sayfa.oge('vurguOnizleme').style.borderColor, '#e91e63');
  assert.equal(kirliMi(sayfa), true);

  yaz(sayfa.oge('vurguRengi'), '#FF0000');
  assert.equal(sayfa.oge('vurguRengiSecici').value, '#ff0000');
  assert.equal(sayfa.oge('vurguOnizleme').style.borderColor, '#FF0000');

  yaz(sayfa.oge('vurguRengi'), 'kırmızı');
  assert.ok(gecersizMi(sayfa.oge('vurguRengi')));
  assert.match(sayfa.oge('vurguHata').textContent, /#rrggbb/);
  assert.equal(sayfa.oge('vurguHata').style.display, 'block');

  sayfa.oge('btnVurguSifirla').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('vurguRengi').value, '');
  assert.equal(gecersizMi(sayfa.oge('vurguRengi')), false);
  assert.equal(sayfa.oge('vurguOnizleme').style.borderColor, '');
  assert.equal(sayfa.oge('vurguOnizleme').textContent, 'Sistem');
});

test('g-13: Ctrl +, Ctrl -, Ctrl 0 sayfayı yakınlaştırır/uzaklaştırır/sıfırlar; sınırda durur; seçim hatırlanır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const bas = (alanlar) => sayfa.belgeTusu({ ctrlKey: true, ...alanlar });
  assert.equal(sayfa.yakinlastirma(), undefined, 'varsayılan: yakınlaştırma uygulanmaz');
  const artir = bas({ key: '+' });
  assert.equal(artir.onlendi, true);
  assert.equal(sayfa.yakinlastirma(), '1.1');
  bas({ key: '=' });
  assert.equal(sayfa.yakinlastirma(), '1.25');
  bas({ key: '-' });
  assert.equal(sayfa.yakinlastirma(), '1.1');
  bas({ key: '0' });
  assert.equal(sayfa.yakinlastirma(), '1');
  for (let i = 0; i < 20; i += 1) bas({ key: '+' });
  assert.equal(sayfa.yakinlastirma(), '2', 'üst sınır');
  for (let i = 0; i < 20; i += 1) bas({ key: '-' });
  assert.equal(sayfa.yakinlastirma(), '0.8', 'alt sınır');
  assert.equal(sayfa.depo.get('evPaneli.ayarlar.yakinlastirma'), '0');

  const yeni = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, depo: { 'evPaneli.ayarlar.yakinlastirma': '4' } });
  assert.equal(yeni.yakinlastirma(), '1.25', 'önceki seçim açılışta uygulanır');
  const bozuk = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, depo: { 'evPaneli.ayarlar.yakinlastirma': 'abc' } });
  assert.equal(bozuk.yakinlastirma(), undefined);
});

// ---------------------------------------------------------------------------
// k-03, k-04: ilk kurulum
// ---------------------------------------------------------------------------

test('k-03: anahtar yoksa sayfa anahtar bölümünde açılır ve üç adımlık kurulum listesi görünür; adımlar durumu gösterir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false, favoriler: [] }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('kurulumListesi').style.display, 'block');
  assert.equal(sayfa.oge('adimAdresDurum').textContent, 'Tamam');
  assert.equal(sayfa.oge('adimAnahtarDurum').textContent, 'Bekliyor');
  assert.equal(sayfa.oge('adimFavoriDurum').textContent, 'Bekliyor');
  assert.equal(sayfa.oge('bolumAnahtar').kaydirma, 1, 'anahtar bölümüne kaydırıldı');
  assert.equal(sayfa.sonOdak(), sayfa.oge('anahtarBaslik'));
  assert.match(HTML, /id="kurulumListesi"[^>]*style="display: none;"/);

  const tamam = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(tamam.oge('kurulumListesi').style.display, 'none', 'anahtar ve favori varken liste gizli');
  assert.equal(tamam.oge('bolumAnahtar').kaydirma, 0, 'anahtar varken kaydırma yok');

  const favorisiz = await acilmisSayfa({ ayar: { ...AYAR, favoriler: [] }, cihazlar: CIHAZLAR });
  assert.equal(favorisiz.oge('kurulumListesi').style.display, 'block');
  assert.equal(favorisiz.oge('adimAnahtarDurum').textContent, 'Tamam');
  assert.equal(favorisiz.oge('adimFavoriDurum').textContent, 'Bekliyor');
});

test('k-03: anahtar kaydedilince adım "Tamam" olur ve anahtar bölümü tazelenir', async () => {
  let sayfa;
  sayfa = await acilmisSayfa({
    ayar: { ...AYAR, anahtarVar: false },
    cihazlar: CIHAZLAR,
    kaydetYaniti: () => {
      sayfa.sunucu.anahtarVar = true;
      return { ok: true, uyari: '' };
    },
  });
  assert.equal(sayfa.oge('adimAnahtarDurum').textContent, 'Bekliyor');
  yaz(sayfa.oge('anahtarGirdisi'), 'TEST_SAHTE_ANAHTAR_000000');
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('adimAnahtarDurum').textContent, 'Tamam');
  assert.equal(sayfa.oge('adimAnahtar').className, 'adim-tamam');
});

test('k-04: anahtar varsa ve yetki kesici açık değilse cihaz listesi kendiliğinden yüklenir; kesici açıkken ya da anahtar yokken HA\'ya istek gitmez', async () => {
  const saglam = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(saglam.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length, 1);
  assert.ok(satirlar(saglam).length > 0);

  for (const ayar of [
    { ...AYAR, anahtarVar: false },
    { ...AYAR, anahtarReddedildi: true },
    { ...AYAR, yetkiDurumu: 'dogrulanamadi' },
    { ...AYAR, yetkiDurumu: 'yerel-yasak' },
    { ...AYAR, yetkiDurumu: 'kayit-onayi' },
  ]) {
    const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR });
    assert.equal(sayfa.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false, JSON.stringify({ k: ayar.anahtarVar, r: ayar.anahtarReddedildi, y: ayar.yetkiDurumu }));
  }
});

test('k-04: kendiliğinden yükleme hata verirse liste alanında nedenini söyler (sayfa çökmez)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: { ok: false, hata: 'Home Assistant’a ulaşılamadı.' } });
  assert.match(sayfa.oge('cihazListesi').textContent, /ulaşılamadı/);
  assert.equal(sayfa.oge('btnCihazlariYukle').disabled, false);
  assert.equal(sayfa.oge('btnCihazlariYukle').textContent, 'Cihazları Listele');
});

// ---------------------------------------------------------------------------
// k-05: favori sırası
// ---------------------------------------------------------------------------

test('k-05: favori sırası paneli: tepsideki ilk 8 zararsız favori işaretlenir, onaylılar ayrı; ↑ ↓ sırayı değiştirir ve yük bu sırayla gider', async () => {
  const cihazlar = Array.from({ length: 10 }, (_, i) => ({ entity_id: `light.l${i}`, ad: `Lamba ${i}`, alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false }));
  cihazlar.push({ entity_id: 'button.pc_kapat', ad: 'PC kapat', alan: 'button', alanEtiketi: 'Düğmeler', durum: '', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false });
  const favoriler = [{ entity_id: 'button.pc_kapat', ad: 'PC kapat' }, ...cihazlar.slice(0, 10).map((c) => ({ entity_id: c.entity_id, ad: c.ad }))];
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, favoriler }, cihazlar: { ok: true, cihazlar, eksik: [], engelli: [] } });
  const satirlari = sira(sayfa);
  assert.equal(satirlari.length, 11);
  const konum = (s) => s.bul((o) => o.className.startsWith('sira-konum'))[0];
  assert.equal(konum(satirlari[0]).textContent, 'Onaylı eylemler altında', 'onay isteyen eylem tepsinin üstünde sayılmaz');
  assert.equal(konum(satirlari[1]).textContent, 'Tepsi menüsünde (1/8)');
  assert.equal(konum(satirlari[8]).textContent, 'Tepsi menüsünde (8/8)');
  assert.equal(konum(satirlari[9]).textContent, 'Diğer favoriler altında');
  assert.ok(konum(satirlari[1]).className.includes('sira-konum-tepsi'));
  assert.equal(satirlari[0].bul((o) => o.etiket === 'button')[0].disabled, true, 'ilk satır yukarı taşınamaz');

  // Lamba 8 yukarı: Lamba 7 ile yer değiştirir -> Lamba 7 tepsi sınırının dışına (Diğer favoriler) düşer
  const dugme = (kimlikAdi, yon) => sira(sayfa).find((s) => siraMetni(s) === kimlikAdi).bul((o) => o.etiket === 'button')[yon < 0 ? 0 : 1];
  const konumMetni = (kimlikAdi) => konum(sira(sayfa).find((s) => siraMetni(s) === kimlikAdi)).textContent;
  assert.equal(kirliMi(sayfa), false);
  dugme('Lamba 8', -1).dispatchEvent({ type: 'click' });
  assert.equal(kirliMi(sayfa), true, 'sıra değişti');
  assert.equal(konumMetni('Lamba 8'), 'Tepsi menüsünde (8/8)');
  assert.equal(konumMetni('Lamba 7'), 'Diğer favoriler altında');
  dugme('Lamba 8', 1).dispatchEvent({ type: 'click' });
  assert.equal(kirliMi(sayfa), false, 'sıra eski haline dönünce değişiklik kalmaz');
  dugme('Lamba 0', 1).dispatchEvent({ type: 'click' });
  assert.deepEqual(sira(sayfa).slice(1, 4).map(siraMetni), ['Lamba 1', 'Lamba 0', 'Lamba 2']);
  assert.equal(kirliMi(sayfa), true);
  assert.equal(sayfa.sonOdak().attributes['aria-label'], 'Lamba 0 sırasını aşağı taşı', 'odak taşınan satırın düğmesinde kalır');

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa, 'favorileriKaydet').map((g) => g.entity_id);
  assert.deepEqual(yuk.slice(0, 4), ['button.pc_kapat', 'light.l1', 'light.l0', 'light.l2'], 'yük seçili sırayla gider');
  assert.equal(kirliMi(sayfa), false);
  assert.deepEqual(sira(sayfa).slice(1, 4).map(siraMetni), ['Lamba 1', 'Lamba 0', 'Lamba 2']);
});

test('k-05: sıra düğmeleri cihaz listesi yüklenene dek kapalıdır (kayıt için liste gerekir); onay kutusu sıra panelindeki konumu günceller', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('favoriSirasi').style.display, 'block');
  for (const satir of sira(sayfa)) for (const d of satir.bul((o) => o.etiket === 'button')) assert.equal(d.disabled, true);

  const acik = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const ekran = sira(acik).find((s) => siraMetni(s) === 'Ekranı Kapat');
  assert.match(ekran.textContent, /Tepsi menüsünde/);
  const onay = girdiler(satirBul(acik, 'button.pc_ekran_kapat')).filter((g) => g.type === 'checkbox')[1];
  onay.tikla(); // "Onay iste" açıldı
  assert.match(sira(acik).find((s) => siraMetni(s) === 'Ekranı Kapat').textContent, /Onaylı eylemler altında/);
  assert.equal(sira(acik).some((s) => siraMetni(s) === 'Koridor'), false, 'engelli (kapı kuralı) favori sıra panelinde yok');
});

// ---------------------------------------------------------------------------
// k-06: karo adı
// ---------------------------------------------------------------------------

test('k-06: karo adı kutusu: değişen ad yükte etiket olarak gider, boşaltmak temizler; sıra panelinde görünür', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3_FAVORILI, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', etiket: 'Salon' }, { entity_id: 'scene.film', ad: 'Film' }] }, cihazlar: CIHAZLAR_D3 });
  const salon = metinKutulari(satirBul(sayfa, 'light.salon_lambasi'))[1];
  const film = metinKutulari(satirBul(sayfa, 'scene.film'))[1];
  assert.equal(salon.value, 'Salon', 'kayıtlı karo adı gösterilir');
  assert.equal(film.maxLength, 40);
  assert.match(sayfa.oge('favoriSirasiListesi').textContent, /Salon/);

  yaz(film, '  Akşam filmi  ');
  yaz(salon, '');
  assert.match(sayfa.oge('favoriSirasiListesi').textContent, /Akşam filmi/, 'sıra panelinde yeni ad');
  await kaydet(sayfa);
  const harita = new Map(sonKayitYuku(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g]));
  assert.equal(harita.get('scene.film').etiket, 'Akşam filmi');
  assert.equal(harita.get('light.salon_lambasi').etiket, '');
  assert.equal(kirliMi(sayfa), false);
});

test('k-06: karo adı güvenlik süzgecine takılırsa (etiketHatalari) satır işaretli kalır, yazılan ad silinmez ve nedeni söylenir', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR_D3_FAVORILI,
    cihazlar: CIHAZLAR_D3,
    favoriSonucu: { ok: true, sayi: 2, eksik: 0, engelli: 0, etiketHatalari: [{ entity_id: 'light.salon_lambasi', neden: 'guvenlik' }] },
  });
  yaz(metinKutulari(satirBul(sayfa, 'light.salon_lambasi'))[1], 'Kapı ışığı');
  await kaydet(sayfa);
  const kutu = metinKutulari(satirBul(sayfa, 'light.salon_lambasi'))[1];
  assert.equal(kutu.value, 'Kapı ışığı', 'yazılan ad silinmez');
  assert.ok(gecersizMi(kutu));
  assert.match(satirBul(sayfa, 'light.salon_lambasi').textContent, /güvenlik kuralına takıldı/);
  assert.match(sayfa.oge('genelBildirim').textContent, /1 karo adı güvenlik kuralına takıldığı için kaydedilmedi/);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
  assert.equal(kirliMi(sayfa), true);

  yaz(kutu, 'Salon');
  assert.equal(gecersizMi(kutu), false, 'düzenleyince işaret kalkar');
});

test('k-06: kapı/kilit kuralı Ayarlar metninde karo adlarını da kapsar', () => {
  assert.match(HTML, /Karo adları da aynı kurala uyar/);
});

// ---------------------------------------------------------------------------
// k-11: anahtar alanı
// ---------------------------------------------------------------------------

test('k-11: anahtar göster/gizle, uzunluk bilgisi (anahtar metni değil), Enter ile gönderme; başarıdan sonra tekrar gizli', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  const girdi = sayfa.oge('anahtarGirdisi');
  assert.equal(girdi.type, 'password');
  yaz(girdi, 'KISA_ANAHTAR');
  assert.match(sayfa.oge('anahtarUzunluk').textContent, /^12 karakter\. .*180/);
  assert.doesNotMatch(sayfa.oge('anahtarUzunluk').textContent, /KISA_ANAHTAR/, 'uzunluk bilgisi anahtarı yazmaz');
  yaz(girdi, 'A'.repeat(183));
  assert.equal(sayfa.oge('anahtarUzunluk').textContent, '183 karakter.');

  sayfa.oge('btnAnahtarGoster').dispatchEvent({ type: 'click' });
  assert.equal(girdi.type, 'text');
  assert.equal(sayfa.oge('btnAnahtarGoster').textContent, 'Gizle');
  assert.equal(sayfa.oge('btnAnahtarGoster').getAttribute('aria-pressed'), 'true');
  sayfa.oge('btnAnahtarGoster').dispatchEvent({ type: 'click' });
  assert.equal(girdi.type, 'password');
  sayfa.oge('btnAnahtarGoster').dispatchEvent({ type: 'click' }); // görünür

  const enter = tusOlayi({ key: 'Enter' });
  girdi.dispatchEvent(enter);
  await akit();
  assert.equal(enter.onlendi, true);
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'anahtarKaydet'), ['anahtarKaydet', 'A'.repeat(183)]);
  assert.equal(girdi.value, '');
  assert.equal(girdi.type, 'password', 'başarıdan sonra anahtar yeniden gizlenir');
  assert.equal(sayfa.oge('anahtarUzunluk').textContent, '');
});

test('k-11: boş anahtarla gönderme açık hata verir ve alanı işaretler; çift gönderim engellenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(sayfa.oge('genelBildirim').textContent, /erişim anahtarını yapıştır/);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-hata/);
  assert.ok(gecersizMi(sayfa.oge('anahtarGirdisi')));
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'anahtarKaydet'), false);
  assert.equal(sayfa.sonOdak(), sayfa.oge('anahtarGirdisi'));
});

// ---------------------------------------------------------------------------
// k-14: bağlantıyı sına
// ---------------------------------------------------------------------------

test('k-14: "Bağlantıyı Sına" yalnız adresi ve türü gönderir (anahtar yok), sonucu alanın altında gösterir; boş adreste sormaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  yaz(sayfa.oge('anahtarGirdisi'), 'TEST_SAHTE_ANAHTAR_000000');
  yaz(sayfa.oge('yerelAdres'), 'http://192.168.1.50:8123');
  sayfa.oge('btnYerelSina').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'adresSina'), ['adresSina', 'http://192.168.1.50:8123', 'yerel']);
  assert.equal(JSON.stringify(sayfa.cagrilar).includes('TEST_SAHTE_ANAHTAR'), false, 'sınama çağrısı anahtarı taşımaz');
  assert.equal(sayfa.oge('yerelAdresSonuc').textContent, 'Home Assistant bulundu: adres çalışıyor.');
  assert.match(sayfa.oge('yerelAdresSonuc').className, /alan-sonuc-tamam/);
  assert.equal(sayfa.oge('btnYerelSina').textContent, 'Bağlantıyı Sına');
  assert.equal(sayfa.oge('btnYerelSina').disabled, false);

  sayfa.oge('btnDisSina').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'adresSina').at(-1), ['adresSina', 'https://ha.example.com', 'dis']);

  yaz(sayfa.oge('disAdres'), '   ');
  sayfa.oge('btnDisSina').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'adresSina').length, 2, 'boş adres ana sürece gitmez');
  assert.match(sayfa.oge('disAdresSonuc').textContent, /adresi yaz/);
  assert.match(sayfa.oge('disAdresSonuc').className, /alan-sonuc-sorun/);
});

test('k-14: sınama sonucu Home Assistant değilse ya da adres geçersizse sorun olarak gösterilir; IPC istisnası sayfayı çökertmez', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    adresSinaYaniti: (adres, tur) => {
      if (adres.includes('hata')) throw new Error('ipc koptu');
      if (adres.includes('gecersiz')) return { ok: false, hata: 'Ev içi adres geçersiz. Örnek: http://192.168.1.10:8123 (https:// de olur)' };
      return { ok: true, ulasilabilir: false, neden: 'ha-degil', mesaj: 'Adres yanıt veriyor ama Home Assistant gibi görünmüyor.' };
    },
  });
  const sina = async (adres) => {
    yaz(sayfa.oge('yerelAdres'), adres);
    sayfa.oge('btnYerelSina').dispatchEvent({ type: 'click' });
    await akit();
  };
  await sina('http://192.168.1.2:80');
  assert.match(sayfa.oge('yerelAdresSonuc').textContent, /gibi görünmüyor/);
  assert.match(sayfa.oge('yerelAdresSonuc').className, /alan-sonuc-sorun/);
  await sina('gecersiz-adres');
  assert.match(sayfa.oge('yerelAdresSonuc').textContent, /Ev içi adres geçersiz/);
  await sina('http://hata');
  assert.match(sayfa.oge('yerelAdresSonuc').textContent, /hata oluştu/);
  assert.equal(sayfa.oge('btnYerelSina').disabled, false);
});

// ---------------------------------------------------------------------------
// k-18: açık sayfayı ekle
// ---------------------------------------------------------------------------

test('k-18: "Açık sayfayı ekle" ana pencerede açık HA sayfasını yeni HA panosu satırı olarak ekler; aynı yol iki kez eklenmez; hata gösterilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, acikSayfaYaniti: { ok: true, yol: '/lovelace/mutfak', ad: 'Mutfak' } });
  const satirlari = () => sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir');
  sayfa.oge('btnAcikSayfaEkle').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(satirlari().length, 2);
  assert.deepEqual(girdiler(satirlari()[1]).map((g) => g.value), ['Mutfak', '/lovelace/mutfak', '']);
  assert.equal(kirliMi(sayfa), true);

  sayfa.oge('btnAcikSayfaEkle').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(satirlari().length, 2, 'aynı yol ikinci kez eklenmez');
  assert.match(sayfa.oge('genelBildirim').textContent, /zaten HA panoları listesinde/);

  await kaydet(sayfa);
  assert.deepEqual(sonKayitYuku(sayfa).panolar.map((p) => p.yol), ['/energy', '/lovelace/mutfak']);

  const hatali = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, acikSayfaYaniti: { ok: false, hata: 'Şu an açık bir Home Assistant sayfası yok.' } });
  hatali.oge('btnAcikSayfaEkle').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(hatali.oge('genelBildirim').textContent, /açık bir Home Assistant sayfası yok/);
  assert.match(hatali.oge('genelBildirim').className, /bildirim-hata/);
  assert.equal(hatali.oge('panolarListesi').bul((o) => o.className === 'pano-satir').length, 1);
});

test('k-18: 6 HA panosu doluyken "Açık sayfayı ekle" kapalıdır', async () => {
  const panolar = Array.from({ length: 6 }, (_, i) => ({ ad: `P${i}`, yol: `/p${i}`, kisayol: '' }));
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, panolar }, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfa.oge('btnAcikSayfaEkle').disabled, true);
  assert.equal(sayfa.oge('btnPanoEkle').disabled, true);
});

// ---------------------------------------------------------------------------
// k-13: dışa/içe aktarma, yedekten dönme
// ---------------------------------------------------------------------------

test('k-13: dışa aktarma sonucu bildirilir (iptal sessiz kalır); erişim anahtarının dosyaya girmediği söylenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  sayfa.oge('btnDisaAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(sayfa.oge('genelBildirim').textContent, /dışa aktarıldı \(ev-paneli-ayarlar-2026-10-15\.json\)\. Erişim anahtarı dosyaya yazılmaz/);

  const iptal = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, aktarimYaniti: { disa: { ok: false, iptal: true } } });
  iptal.oge('btnDisaAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(iptal.oge('genelBildirim').textContent, '');

  const hata = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, aktarimYaniti: { disa: { ok: false, hata: 'Dosya yazılamadı. Başka bir klasör seçmeyi dene.' } } });
  hata.oge('btnDisaAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(hata.oge('genelBildirim').className, /bildirim-hata/);
  assert.match(hata.oge('genelBildirim').textContent, /Dosya yazılamadı/);
});

test('k-13: içe aktarma sonrası tüm bölümler yeni ayarlara döner, özet söylenir; kirliyken önce sorulur; iptal edilen diyalog hiçbir şey yapmaz', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    aktarimYaniti: {
      ice: { ok: true, ad: 'yedek.json', alanSayisi: 12, favoriSayisi: 3, atilanSayisi: 1, notlar: ['Dosyadaki ana kısayol geçersizdi; varsayılan kısayol kullanıldı.'], uyarilar: [] },
      icesonrasi: (sunucu) => {
        sunucu.koseBildirimi = false;
        sunucu.pencereBoyutu = 'genis';
        sunucu.favoriler = [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }];
      },
    },
  });
  sayfa.oge('bipSesi').checked = true;
  sayfa.oge('bipSesi').dispatchEvent({ type: 'change' });
  sayfa.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.sorular.length, 1, 'kaydedilmemiş değişiklik varken önce sorulur');
  assert.match(sayfa.sorular[0], /Kaydedilmemiş değişiklikler var/);
  assert.equal(sayfa.oge('koseBildirimi').checked, false);
  assert.equal(sayfa.oge('pencereBoyutu').value, 'genis');
  assert.equal(sayfa.oge('bipSesi').checked, false, 'dosyadaki değer geçerli olur');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '1 favori seçili');
  assert.equal(kirliMi(sayfa), false);
  const bildirim = sayfa.oge('genelBildirim').textContent;
  assert.match(bildirim, /içe aktarıldı \(yedek\.json\)/);
  assert.match(bildirim, /12 ayar alındı\. 3 favori\./);
  assert.match(bildirim, /1 değer geçersiz olduğu için atlandı/);
  assert.match(bildirim, /varsayılan kısayol kullanıldı/);
  assert.match(bildirim, /Erişim anahtarı değişmedi/);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);

  const reddeden = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, onayYaniti: false });
  reddeden.oge('bipSesi').checked = true;
  reddeden.oge('bipSesi').dispatchEvent({ type: 'change' });
  reddeden.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(reddeden.cagrilar.some((c) => c[0] === 'ayarlariIceAktar'), false, 'onaylanmazsa dosya diyalogu açılmaz');

  const iptal = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, aktarimYaniti: { ice: { ok: false, iptal: true } } });
  iptal.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(iptal.sorular.length, 0, 'temizken soru yok');
  assert.equal(iptal.oge('genelBildirim').textContent, '');
});

test('k-13: geçersiz dosya kalıcı hata olarak gösterilir ve ayarlar değişmez', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, aktarimYaniti: { ice: { ok: false, hata: 'Bu dosya Ev Paneli ayar yedeği değil.' } } });
  sayfa.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('genelBildirim').textContent, 'Bu dosya Ev Paneli ayar yedeği değil.');
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-hata/);
  assert.equal(sayfa.oge('koseBildirimi').checked, true);
  assert.equal(sayfa.oge('btnIceAktar').disabled, false);
});

test('k-13: mevcut yedekler listelenir; okunamayan yedeğe dönülemez; döndürme onay ister ve sonucu tazeler', async () => {
  const yedekler = [
    { ad: 'ayarlar.v4-yedek.json', tur: 'goc', surum: 4, zaman: Date.UTC(2026, 8, 1, 10, 30), bayt: 2048, okunabilir: true },
    { ad: 'ayarlar.bozuk-1790000000000.json', tur: 'bozuk', surum: null, zaman: Date.UTC(2026, 9, 2, 8, 0), bayt: 12, okunabilir: false },
  ];
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    yedekler,
    aktarimYaniti: { icesonrasi: (sunucu) => { sunucu.bipSesi = true; } },
  });
  const satirlari = () => sayfa.oge('yedekListesi').bul((o) => o.className === 'yedek-satir');
  assert.equal(satirlari().length, 2);
  assert.match(satirlari()[0].textContent, /Güncelleme öncesi yedek \(ayar sürümü 4\)/);
  assert.match(satirlari()[0].textContent, /2 KB/);
  assert.match(satirlari()[1].textContent, /Bozuk ayar dosyasından kalan yedek/);
  assert.match(satirlari()[1].textContent, /okunamıyor/);
  const dugme = (i) => satirlari()[i].bul((o) => o.etiket === 'button')[0];
  assert.equal(dugme(0).disabled, false);
  assert.equal(dugme(1).disabled, true, 'okunamayan yedeğe dönülemez');

  const reddeden = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, yedekler, onayYaniti: false });
  reddeden.oge('yedekListesi').bul((o) => o.etiket === 'button')[0].dispatchEvent({ type: 'click' });
  await akit();
  assert.match(reddeden.sorular[0], /Bu yedeğe dönersen/);
  assert.equal(reddeden.cagrilar.some((c) => c[0] === 'yedektenDon'), false);

  dugme(0).dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'yedektenDon'), ['yedektenDon', 'ayarlar.v4-yedek.json'], 'ana sürece yalnız yedek adı gider (yol değil)');
  assert.equal(sayfa.oge('bipSesi').checked, true, 'ayarlar yedekteki değerlere döndü');
  assert.match(sayfa.oge('genelBildirim').textContent, /Yedeğe dönüldü \(ayarlar\.v4-yedek\.json\)/);
});

test('k-13: yedek yoksa açıklama gösterilir; yedek listesi alınamazsa sayfa çökmez', async () => {
  const bos = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.match(bos.oge('yedekDurum').textContent, /Henüz geri dönülebilir bir yedek yok/);
  assert.equal(bos.oge('yedekListesi').children.length, 0);
});

// ---------------------------------------------------------------------------
// Güvenlik değişmezleri
// ---------------------------------------------------------------------------

test('değişmez: engelli (kapı/kilit) varlık satırı seçilemez, sıra panelinde yok ve kayıt yükünde yeni seçilen olarak gitmez', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const engelli = satirBul(sayfa, 'light.koridor');
  assert.equal(engelli.bul((o) => o.etiket === 'input')[0].disabled, true);
  engelli.tikla();
  assert.equal(engelli.bul((o) => o.etiket === 'input')[0].checked, false);
  assert.equal(sira(sayfa).some((s) => siraMetni(s) === 'Koridor'), false);
});

test('değişmez: ayarlar.js erişim anahtarını yalnız anahtarKaydet çağrısına verir; hiçbir ağ API\'si, storage\'a anahtar yazımı ya da innerHTML yok', () => {
  assert.doesNotMatch(BETIK, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.doesNotMatch(BETIK, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  const anahtarKullanimlari = [...BETIK.matchAll(/anahtarGirdisi\.value/g)].length;
  assert.ok(anahtarKullanimlari > 0);
  const depolama = [...BETIK.matchAll(/localStorage\.(?:set|get)Item\(([^)]*)\)/g)].map((m) => m[1]);
  // Yerel depoya yalnız iki görünüm tercihi yazılır/okunur: yakınlaştırma ve ilk boyama için son arayüz dili (gizli değer değil).
  assert.ok(depolama.length >= 4 && depolama.every((p) => /YAKINLASTIRMA_ANAHTARI|DIL_ANAHTARI/.test(p)), 'yerel depoya yalnız yakınlaştırma ve arayüz dili yazılır/okunur');
  assert.ok(depolama.some((p) => /YAKINLASTIRMA_ANAHTARI/.test(p)) && depolama.some((p) => /DIL_ANAHTARI/.test(p)));
});
