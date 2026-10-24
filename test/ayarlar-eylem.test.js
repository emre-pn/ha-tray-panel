'use strict';

/**
 * Ayarlar sayfasının eylem bölümü (src/ayarlar-eylem.js): etkinlik geçmişi (o-17) ve eylem ayar alanları; sahte DOM ve sahte köprü
 * (test/ayarlar-sahte.js). Ana süreç tarafı test/ana-surec.test.js ve test/eylem-ekleri.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const AYARLAR = require('../src/lib/ceviri/ayarlar');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa, EYLEM_BETIK } = require('./ayarlar-sahte');

const EVENTLER = { liste: 'etkinlikListesi', durum: 'etkinlikDurum', yenile: 'btnEtkinlikYenile', temizle: 'btnEtkinlikTemizle', tut: 'etkinlikGecmisi' };
const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: ek.ayar ?? { ...AYAR_D3 }, cihazlar: CIHAZLAR_D3, eylemYaniti: ek.eylemYaniti, ...(ek.onayYaniti === undefined ? {} : { onayYaniti: ek.onayYaniti }) });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display === 'inline';
const satirlar = (sayfa) => sayfa.oge(EVENTLER.liste).children.map((s) => s.textContent);

const KAYITLAR = [
  { zaman: 1_700_000_100_000, kaynak: 'palet', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'turn_off', sonuc: 'ok' },
  { zaman: 1_700_000_000_000, kaynak: 'gecikmeli', kimlik: 'switch.priz', ad: 'Masa prizi', islem: 'turn_off', sonuc: 'hata', neden: 'ha-hatasi/ag' },
  { zaman: 1_699_999_000_000, kaynak: 'baska-modul', kimlik: 'light.yatak', islem: 'ozel_islem', sonuc: 'atlandi' },
];

test('açılışta etkinlik geçmişi okunur ve satırlar çizilir: ad, kaynak, işlem, sonuç; bilinmeyen kaynak/işlem kodu olduğu gibi yazılır', async () => {
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: KAYITLAR } } });
  const s = satirlar(sayfa);
  assert.equal(s.length, 3);
  assert.match(s[0], /Salon lambası/);
  assert.match(s[0], /Palet/);
  assert.match(s[0], /Kapatıldı/);
  assert.match(s[0], /Başarılı/);
  assert.match(s[1], /Gecikmeli eylem/);
  assert.match(s[1], /ha-hatasi\/ag/);
  assert.match(s[1], /Hata/);
  assert.match(s[2], /light\.yatak/, 'adı olmayan kayıtta kimlik yazılır');
  assert.match(s[2], /baska-modul/);
  assert.match(s[2], /ozel_islem/);
  assert.match(s[2], /Atlandı/);
  assert.equal(sayfa.oge(EVENTLER.durum).textContent, '3 kayıt (en yeni üstte).');
  assert.equal(sayfa.oge(EVENTLER.temizle).disabled, false);
});

const DIS_KAYITLAR = [
  { zaman: 1_700_000_900_000, kaynak: 'protokol', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'onay-bekliyor' },
  { zaman: 1_700_000_800_000, kaynak: 'yerel-api', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'kapali' },
  { zaman: 1_700_000_700_000, kaynak: 'pc-olayi', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'kaynak-izinsiz' },
  { zaman: 1_700_000_600_000, kaynak: 'toplanti', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'anlik-yok' },
  { zaman: 1_700_000_500_000, kaynak: 'jumplist', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'bulunamadi' },
  { zaman: 1_700_000_400_000, kaynak: 'kisayol-dosyasi', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'belirsiz' },
  { zaman: 1_700_000_300_000, kaynak: 'protokol', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'dis-tetik', sonuc: 'iptal', neden: 'reddedildi' },
  { zaman: 1_700_000_200_000, kaynak: 'yerel-api', islem: 'dis-tetik', sonuc: 'atlandi', neden: 'anahtar-yok' },
  { zaman: 1_700_000_100_000, kaynak: 'bildirim', islem: 'bildirim-dugme', sonuc: 'hata', neden: 'hata' },
  { zaman: 1_700_000_000_000, kaynak: 'bildirim', islem: 'bildirim-dugme', sonuc: 'ok' },
];
const HAM_KODLAR = ['protokol', 'yerel-api', 'pc-olayi', 'toplanti', 'jumplist', 'kisayol-dosyasi', 'bildirim', 'bildirim-dugme', 'dis-tetik', 'kapali', 'kaynak-izinsiz', 'onay-bekliyor', 'anlik-yok', 'anahtar-yok', 'bulunamadi', 'belirsiz', 'reddedildi'];
// satır metni: ad + zaman, sonra ' · ' ile kaynak, işlem, neden (sonuç rozeti sona yapışık); ham kod bir parçanın başında durur
const hamKodVar = (satir) => satir.split(' · ').slice(1).some((parca) => HAM_KODLAR.some((kod) => parca === kod || (parca.startsWith(kod) && /^[A-ZÇĞİÖŞÜ]/.test(parca.slice(kod.length)))));

test('dış tetik ve bildirim düğmesi kayıtları ham kodla değil, arayüz dilindeki etiketlerle çizilir (5 dil); bilinmeyen kod olduğu gibi kalır', async () => {
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: DIS_KAYITLAR } } });
  const tr = satirlar(sayfa);
  assert.equal(tr.length, DIS_KAYITLAR.length);
  assert.match(tr[0], /evpaneli:\/\/ bağlantısı · Dış tetik · izin bekleniyor/);
  assert.match(tr[1], /Yerel API · Dış tetik · Ayarlar’da kapalı/);
  assert.match(tr[8], /Bildirim · Bildirim düğmesi · hata/);
  assert.match(tr[9], /Bildirim · Bildirim düğmesi$|Bildirim · Bildirim düğmesiBaşarılı$/);
  for (const s of tr) assert.equal(hamKodVar(s), false, s);

  for (const dil of ['en', 'de', 'fr', 'es']) {
    await sayfa.dilDegisti(dil);
    const sozluk = AYARLAR[dil];
    const satirMetinleri = satirlar(sayfa);
    assert.equal(satirMetinleri.length, DIS_KAYITLAR.length);
    assert.ok(satirMetinleri[0].includes(`${sozluk['ayar.etkinlik.kaynak.protokol']} · ${sozluk['ayar.etkinlik.islem.disTetik']} · ${sozluk['ayar.etkinlik.neden.onayBekliyor']}`), dil);
    assert.ok(satirMetinleri[8].includes(`${sozluk['ayar.etkinlik.kaynak.bildirim']} · ${sozluk['ayar.etkinlik.islem.bildirimDugme']} · ${sozluk['ayar.etkinlik.neden.hata']}`), dil);
    for (const s of satirMetinleri) assert.equal(hamKodVar(s), false, `${dil}: ${s}`);
  }
});

test('kayıt yokken durum satırı söyler ve "Geçmişi temizle" kapalıdır; okuma hatası kısa bir iletiyle gösterilir', async () => {
  const bos = await sayfaAc();
  assert.equal(bos.oge(EVENTLER.durum).textContent, 'Henüz kayıt yok.');
  assert.equal(bos.oge(EVENTLER.temizle).disabled, true);
  const hata = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: false } } });
  assert.equal(hata.oge(EVENTLER.durum).textContent, 'Etkinlik geçmişi alınamadı.');
  const patlayan = await sayfaAc({
    eylemYaniti: {
      etkinlikListesi: () => {
        throw new Error('ipc');
      },
    },
  });
  assert.equal(patlayan.oge(EVENTLER.durum).textContent, 'Etkinlik geçmişi alınamadı.');
});

test('"Yenile" listeyi yeniden okur; "Geçmişi temizle" ana sürece sorar, tabloyu boşaltır ve söyler', async () => {
  let kayitlar = KAYITLAR.slice(0, 2);
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: () => ({ ok: true, acik: true, kayitlar }), etkinlikTemizle: () => ({ ok: true }) } });
  assert.equal(satirlar(sayfa).length, 2);
  kayitlar = KAYITLAR;
  await tikla(sayfa, EVENTLER.yenile);
  assert.equal(satirlar(sayfa).length, 3);
  await tikla(sayfa, EVENTLER.temizle);
  assert.equal(sayfa.sorular.at(-1), AYARLAR.tr['ayar.etkinlik.temizleOnay'], 'silmeden önce onay sorulur');
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'etkinlikTemizle').length, 1);
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.oge(EVENTLER.durum).textContent, 'Etkinlik geçmişi temizlendi.');
  assert.equal(sayfa.oge(EVENTLER.temizle).disabled, true);
});

test('"Geçmişi temizle" onay verilmezse hiçbir şey silmez: köprü çağrılmaz, tablo ve düğme olduğu gibi kalır', async () => {
  const sayfa = await sayfaAc({ onayYaniti: false, eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: KAYITLAR }, etkinlikTemizle: () => ({ ok: true }) } });
  await tikla(sayfa, EVENTLER.temizle);
  assert.equal(sayfa.sorular.at(-1), AYARLAR.tr['ayar.etkinlik.temizleOnay']);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'etkinlikTemizle').length, 0);
  assert.equal(satirlar(sayfa).length, 3);
  assert.equal(sayfa.oge(EVENTLER.temizle).disabled, false);
  assert.notEqual(sayfa.oge(EVENTLER.durum).textContent, AYARLAR.tr['ayar.etkinlik.temizlendi']);
});

test('temizleme başarısızsa tablo korunur ve hata söylenir', async () => {
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: KAYITLAR }, etkinlikTemizle: { ok: false } } });
  await tikla(sayfa, EVENTLER.temizle);
  assert.equal(satirlar(sayfa).length, 3);
  assert.equal(sayfa.oge(EVENTLER.durum).textContent, 'Etkinlik geçmişi alınamadı.');
  assert.equal(sayfa.oge(EVENTLER.temizle).disabled, false);
});

test('satır metinleri yalnız textContent ile yazılır: kayıttaki ad HTML olarak yorumlanmaz', async () => {
  const kotu = [{ zaman: 1, kaynak: 'panel', kimlik: 'light.salon', ad: '<img src=x onerror=alert(1)>', islem: 'toggle', sonuc: 'ok' }];
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: kotu } } });
  assert.match(satirlar(sayfa)[0], /<img src=x onerror=alert\(1\)>/);
  assert.equal(sayfa.oge(EVENTLER.liste).children[0].children.length, 2, 'bilgi + sonuç; ek düğüm yok');
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(EYLEM_BETIK), 'betikte HTML ataması / eval yok');
  assert.ok(!/require\s*\(|fetch\(|XMLHttpRequest/.test(EYLEM_BETIK), 'betikte require/ağ yok');
});

test('etkinlik geçmişi onay kutusu: ayardan gelir, kirli yapar ve Kaydet yükünde etkinlikGecmisi alanı gider', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, etkinlikGecmisi: true } });
  const kutu = sayfa.oge(EVENTLER.tut);
  assert.equal(kutu.checked, true);
  assert.equal(kirliMi(sayfa), false, 'temiz: kaydedilecek bir şey yok');
  kutu.tikla();
  await akit();
  assert.equal(kutu.checked, false);
  assert.equal(kirliMi(sayfa), true, 'kirli');
  await tikla(sayfa, 'btnAyarlariKaydet');
  const kayit = sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet');
  assert.ok(kayit, 'kaydet çağrıldı');
  assert.equal(kayit[1].etkinlikGecmisi, false);
  assert.equal(sayfa.sunucu.etkinlikGecmisi, false);
});

test('alan yoksa (eski sunucu özeti) varsayılan açıktır', async () => {
  const eski = { ...AYAR_D3 };
  delete eski.etkinlikGecmisi;
  const sayfa = await sayfaAc({ ayar: eski });
  assert.equal(sayfa.oge(EVENTLER.tut).checked, true);
});

test('dil değişince tablo yeni dilde yeniden yazılır', async () => {
  const sayfa = await sayfaAc({ eylemYaniti: { etkinlikListesi: { ok: true, acik: true, kayitlar: KAYITLAR.slice(0, 1) } } });
  assert.match(satirlar(sayfa)[0], /Başarılı/);
  await sayfa.dilDegisti('en');
  assert.match(satirlar(sayfa)[0], /Success/);
  assert.match(satirlar(sayfa)[0], /Palette/);
  assert.equal(sayfa.oge(EVENTLER.durum).textContent, '1 entry.');
});

// --- geri al (o-12) ayar alanları ---------------------------------------------------------------------

const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const gecersizMi = (oge) => oge.classList.contains('gecersiz') && oge.getAttribute('aria-invalid') === 'true';
const kayitYuku = (sayfa) => sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet')[1];

test('geri al alanları ayardan gelir: açık, 10 dk, kısayol kısa biçimde (Ctrl+Alt+Z); temizken kaydedilecek bir şey yok', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, geriAl: true, geriAlSureDk: 10, geriAlKisayolu: 'Control+Alt+Z' } });
  assert.equal(sayfa.oge('geriAl').checked, true);
  assert.equal(sayfa.oge('geriAlSureDk').value, '10');
  assert.equal(sayfa.oge('geriAlKisayolu').value, 'Ctrl+Alt+Z');
  assert.equal(kirliMi(sayfa), false);
  assert.equal(sayfa.oge('geriAlKisayolUyarilari').style.display, 'none');
});

test('alan yoksa (eski sunucu özeti) geri al varsayılanları gösterilir', async () => {
  const eski = { ...AYAR_D3 };
  for (const ad of ['geriAl', 'geriAlSureDk', 'geriAlKisayolu']) delete eski[ad];
  const sayfa = await sayfaAc({ ayar: eski });
  assert.deepEqual([sayfa.oge('geriAl').checked, sayfa.oge('geriAlSureDk').value, sayfa.oge('geriAlKisayolu').value], [true, '10', 'Ctrl+Alt+Z']);
  assert.equal(kirliMi(sayfa), false);
});

test('geri al alanları düzenlenince kirli olur; kaydetme yükü sayıyı ve kısayolu kaydedilen biçimde taşır', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, geriAl: true, geriAlSureDk: 10, geriAlKisayolu: 'Control+Alt+Z' } });
  yaz(sayfa.oge('geriAlSureDk'), '25');
  assert.equal(kirliMi(sayfa), true);
  yaz(sayfa.oge('geriAlSureDk'), '10');
  assert.equal(kirliMi(sayfa), false, 'eski değere dönünce temiz');
  yaz(sayfa.oge('geriAlKisayolu'), 'ctrl alt j');
  assert.equal(kirliMi(sayfa), true);
  yaz(sayfa.oge('geriAlSureDk'), '25');
  sayfa.oge('geriAl').tikla();
  await akit();
  await tikla(sayfa, 'btnAyarlariKaydet');
  const yuk = kayitYuku(sayfa);
  assert.equal(yuk.geriAl, false);
  assert.equal(String(yuk.geriAlSureDk), '25');
  assert.equal(yuk.geriAlKisayolu, 'Control+Alt+J');
  assert.equal(sayfa.sunucu.geriAlKisayolu, 'Control+Alt+J');
});


test('geri alma süresi geçersizse (aralık dışı, boş, ondalık) kayıt yapılmaz: alan işaretlenir, odak alana gider, sunucudaki süre korunur; kirli göstergesi yanar', async () => {
  for (const gecersiz of ['90', '61', '0', '-5', '', '   ', '1e1', '2.5']) {
    const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, geriAlSureDk: 30 } });
    const alan = sayfa.oge('geriAlSureDk');
    assert.equal(alan.value, '30');
    yaz(alan, gecersiz);
    assert.equal(kirliMi(sayfa), true, `"${gecersiz}" varsayılana çevrilip gizlenmez: kirli`);
    await tikla(sayfa, 'btnAyarlariKaydet');
    assert.equal(sayfa.cagrilar.some((c) => c[0] === 'ayarlariKaydet'), false, `"${gecersiz}": kayıt yapılmadı`);
    assert.equal(sayfa.sunucu.geriAlSureDk, 30, 'sunucudaki süre 10 dakikaya düşmedi');
    assert.ok(gecersizMi(alan));
    assert.equal(sayfa.oge('geriAlSureHata').textContent, AYARLAR.tr['ayar.eylem.geriAl.sureHata']);
    assert.equal(sayfa.oge('geriAlSureHata').style.display, 'block');
    assert.equal(sayfa.sonOdak(), alan, 'odak hatalı alanda');
    assert.equal(sayfa.oge('genelBildirim').textContent, AYARLAR.tr['ayar.eylem.geriAl.sureHata']);
  }

  // işaret yazdıkça kalkar; geçerli değer kaydedilir
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, geriAlSureDk: 30 } });
  yaz(sayfa.oge('geriAlSureDk'), '90');
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.ok(gecersizMi(sayfa.oge('geriAlSureDk')));
  yaz(sayfa.oge('geriAlSureDk'), '45');
  assert.equal(gecersizMi(sayfa.oge('geriAlSureDk')), false);
  assert.equal(sayfa.oge('geriAlSureHata').style.display, 'none');
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(String(kayitYuku(sayfa).geriAlSureDk), '45');
  assert.equal(String(sayfa.sunucu.geriAlSureDk), '45');

  // kayıtlı değer 10 iken geçersiz yazı da fark edilir (eskiden her ikisi de "10" olup kirli göstergesi bile çıkmazdı)
  const varsayilan = await sayfaAc({ ayar: { ...AYAR_D3, geriAlSureDk: 10 } });
  yaz(varsayilan.oge('geriAlSureDk'), '90');
  assert.equal(kirliMi(varsayilan), true);
  await tikla(varsayilan, 'btnAyarlariKaydet');
  assert.equal(varsayilan.cagrilar.some((c) => c[0] === 'ayarlariKaydet'), false);
  assert.ok(gecersizMi(varsayilan.oge('geriAlSureDk')));
});
test('geri al kısayol kutusu boş bırakılabilir (kısayol yok) ve geçersiz/ayrılmış kısayol anında işaretlenir', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, geriAlKisayolu: 'Control+Alt+Z' } });
  yaz(sayfa.oge('geriAlKisayolu'), '');
  assert.equal(gecersizMi(sayfa.oge('geriAlKisayolu')), false);
  assert.equal(kirliMi(sayfa), true);
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(kayitYuku(sayfa).geriAlKisayolu, '');
  yaz(sayfa.oge('geriAlKisayolu'), 'Alt+F4');
  assert.ok(gecersizMi(sayfa.oge('geriAlKisayolu')));
  assert.match(sayfa.oge('geriAlKisayolUyarilari').textContent, /Windows/);
  assert.equal(sayfa.oge('geriAlKisayolUyarilari').style.display, 'block');
});

test('ana sürecin kısayol planındaki sorun (çakışma, kayıt edilemedi) geri alma kısayolunun altında gösterilir; sorun yoksa kutu gizli', async () => {
  const sorunlu = await sayfaAc({
    ayar: { ...AYAR_D3, kisayolDurumlari: [{ id: 'geri-al', tur: 'geri-al', kisayol: 'Control+Alt+Z', gecerli: false, neden: 'cakisma', durum: 'reddedildi', mesaj: 'Ctrl+Alt+Z başka bir kısayolla çakışıyor.' }] },
  });
  assert.equal(sorunlu.oge('geriAlKisayolUyarilari').textContent, 'Ctrl+Alt+Z başka bir kısayolla çakışıyor.');
  assert.equal(sorunlu.oge('geriAlKisayolUyarilari').style.display, 'block');
  const etkin = await sayfaAc({ ayar: { ...AYAR_D3, kisayolDurumlari: [{ id: 'geri-al', tur: 'geri-al', kisayol: 'Control+Alt+Z', gecerli: true, neden: null, durum: 'etkin', mesaj: '' }] } });
  assert.equal(etkin.oge('geriAlKisayolUyarilari').style.display, 'none');
  const baskasi = await sayfaAc({ ayar: { ...AYAR_D3, kisayolDurumlari: [{ id: 'pano:0', tur: 'pano', sira: 0, kisayol: 'Control+Alt+E', gecerli: false, durum: 'reddedildi', mesaj: 'başka' }] } });
  assert.equal(baskasi.oge('geriAlKisayolUyarilari').style.display, 'none', 'başka kısayolun sorunu buraya yazılmaz');
});

test('geri al metinleri dil değişince yeni dilde yazılır', async () => {
  const sayfa = await sayfaAc();
  await sayfa.dilDegisti('en');
  assert.match(sayfa.oge('geriAlSureIpucu').textContent, /^Between 1 and 60 minutes/);
  await sayfa.dilDegisti('de');
  assert.match(sayfa.oge('geriAlSureIpucu').textContent, /^Zwischen 1 und 60 Minuten/);
});

test('gecikmeli eylem kutusu (o-15): ayardan gelir (varsayılan açık), tıklayınca kirli olur, kaydetme yükü değeri taşır; alan yoksa açık görünür', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, gecikmeliEylem: true } });
  assert.equal(sayfa.oge('gecikmeliEylem').checked, true);
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('gecikmeliEylem').tikla();
  await akit();
  assert.equal(sayfa.oge('gecikmeliEylem').checked, false);
  assert.equal(kirliMi(sayfa), true);
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(kayitYuku(sayfa).gecikmeliEylem, false);
  assert.equal(sayfa.sunucu.gecikmeliEylem, false);

  const eski = { ...AYAR_D3 };
  delete eski.gecikmeliEylem;
  const eskiSayfa = await sayfaAc({ ayar: eski });
  assert.equal(eskiSayfa.oge('gecikmeliEylem').checked, true, 'eski sunucu özeti: varsayılan açık');
  assert.equal(kirliMi(eskiSayfa), false);
});

test('son değişenler kutusu (o-18): ayardan gelir (varsayılan açık), tıklayınca kirli olur, kaydetme yükü değeri taşır; alan yoksa açık görünür', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, sonDegisenler: true } });
  assert.equal(sayfa.oge('sonDegisenler').checked, true);
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('sonDegisenler').tikla();
  await akit();
  assert.equal(sayfa.oge('sonDegisenler').checked, false);
  assert.equal(kirliMi(sayfa), true);
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(kayitYuku(sayfa).sonDegisenler, false);
  assert.equal(sayfa.sunucu.sonDegisenler, false);

  const eski = { ...AYAR_D3 };
  delete eski.sonDegisenler;
  const eskiSayfa = await sayfaAc({ ayar: eski });
  assert.equal(eskiSayfa.oge('sonDegisenler').checked, true, 'eski sunucu özeti: varsayılan açık');
  assert.equal(kirliMi(eskiSayfa), false);
});

test('panel gruplaması seçimi (o-14): ayardan gelir (varsayılan tür), değişince kirli olur, kaydetme yükü değeri taşır; geçersiz sunucu değeri türe düşer', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, panelGruplama: 'tur' } });
  assert.equal(sayfa.oge('panelGruplama').value, 'tur');
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('panelGruplama').value = 'oda';
  sayfa.oge('panelGruplama').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(kayitYuku(sayfa).panelGruplama, 'oda');
  assert.equal(sayfa.sunucu.panelGruplama, 'oda');
  sayfa.oge('panelGruplama').value = 'tur';
  sayfa.oge('panelGruplama').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true, 'kaydedilmiş değerden farklı');

  const eski = { ...AYAR_D3 };
  delete eski.panelGruplama;
  const eskiSayfa = await sayfaAc({ ayar: eski });
  assert.equal(eskiSayfa.oge('panelGruplama').value, 'tur', 'eski sunucu özeti: varsayılan tür');
  assert.equal(kirliMi(eskiSayfa), false);
  const bozuk = await sayfaAc({ ayar: { ...AYAR_D3, panelGruplama: '<img>' } });
  assert.equal(bozuk.oge('panelGruplama').value, 'tur');
});

test('ayarlar.html (o-14): panel gruplaması bir <select> ve tam iki seçeneği var (tur, oda); Türkçe varsayılan metin data-i18n ile çevrilir', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  const secim = /<select id="panelGruplama">([\s\S]*?)<\/select>/.exec(html);
  assert.ok(secim, 'select var');
  const secenekler = [...secim[1].matchAll(/<option value="([^"]+)" data-i18n="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(secenekler, [['tur', 'ayar.eylem.oda.tur'], ['oda', 'ayar.eylem.oda.oda']]);
});

test('favori olmayan cihazlar kutusu (o-46): varsayılan KAPALI; tıklayınca kirli olur, kaydetme yükü değeri taşır; alan yoksa kapalı görünür', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_D3, paletDigerCihazlar: false } });
  assert.equal(sayfa.oge('paletDigerCihazlar').checked, false);
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('paletDigerCihazlar').tikla();
  await akit();
  assert.equal(sayfa.oge('paletDigerCihazlar').checked, true);
  assert.equal(kirliMi(sayfa), true);
  await tikla(sayfa, 'btnAyarlariKaydet');
  assert.equal(kayitYuku(sayfa).paletDigerCihazlar, true);
  assert.equal(sayfa.sunucu.paletDigerCihazlar, true);

  const eski = { ...AYAR_D3 };
  delete eski.paletDigerCihazlar;
  const eskiSayfa = await sayfaAc({ ayar: eski });
  assert.equal(eskiSayfa.oge('paletDigerCihazlar').checked, false, 'eski sunucu özeti: varsayılan kapalı');
  assert.equal(kirliMi(eskiSayfa), false);
});

test('ayarlar.html (o-46): "Favori olmayan cihazlar" bölümü bir onay kutusu içerir ve metinleri data-i18n ile çevrilir', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  assert.match(html, /<input type="checkbox" id="paletDigerCihazlar">/);
  for (const anahtar of ['ayar.eylem.diger.baslik', 'ayar.eylem.diger.aciklama', 'ayar.eylem.diger.tut']) assert.ok(html.includes(`data-i18n="${anahtar}"`), anahtar);
  assert.doesNotMatch(html, /id="paletDigerCihazlar"[^>]*\bchecked\b/, 'varsayılan işaretli değil');
});
