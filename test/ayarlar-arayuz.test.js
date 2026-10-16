'use strict';

/**
 * Ayarlar sayfasının betiği (src/ayarlar.js) minik bir SAHTE DOM ile çalıştırılır (test/ayarlar-sahte.js): gerçek tarayıcı, Electron
 * ya da pencere YOK. Amaç: HTML'deki kimliklerle betiğin uyumu, satırların yalnız textContent ile kurulması, onay kutusu / bulunamadı /
 * engelli satırları, kayıt yükünün biçimi ve anahtar silme onayı gibi arayüz mantığındaki çalışma zamanı hatalarını
 * `node --check`in göremeyeceği yerde yakalamak. Görsel görünüm (CSS) burada denenmez; o elle denenir (README).
 * Denetim maddelerine (h-01, k-02, ...) özgü sınamalar test/ayarlar-arayuz-denetim.test.js içindedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ANAHTAR_SILME_ONAY_METNI, ANAHTAR_SILINDI_METNI } = require('../src/lib/bildirim-metni');
const {
  HTML,
  AYAR,
  CIHAZLAR,
  AYAR_D3,
  CIHAZLAR_D3,
  AYAR_D3_FAVORILI,
  akit,
  duzles,
  acilmisSayfa,
  satirlar,
  satirKimligi,
  satirBul,
  onayKutusu,
  girdiler,
  metinKutulari,
} = require('./ayarlar-sahte');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa, ad = 'ayarlariKaydet') => duzles(sayfa.cagrilar.filter((c) => c[0] === ad).at(-1)[1]);

test('açılış: ayarlar alanlara yazılır; geri bildirim kutuları ve anahtar durumu doğru; anahtar varken cihaz listesi kendiliğinden yüklenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, koseBildirimi: false, bipSesi: true }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('yerelAdres').value, 'http://192.168.1.10:8123');
  assert.equal(sayfa.oge('koseBildirimi').checked, false);
  assert.equal(sayfa.oge('bipSesi').checked, true);
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  assert.equal(sayfa.oge('btnAnahtarSil').style.display, 'inline-flex');
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none', 'açılışta kaydedilmemiş değişiklik yok');
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length, 1, 'k-04: anahtar var, kesici açık değil: liste kendiliğinden yüklenir');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '3 favori seçili', 'engelli favori sayıya katılmaz');
});

test('anahtar yokken liste yüklenmez: seçili sayısı kayıtlı favorilerden gelir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false);
  assert.equal(sayfa.oge('secilenSayisi').textContent, '4 favori seçili');
});

test('ayarları kaydet: geri bildirim ayarları ve adresler yükte gider', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  sayfa.oge('koseBildirimi').checked = false;
  sayfa.oge('bipSesi').checked = true;
  await kaydet(sayfa);
  const [ad, yuk] = sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet');
  assert.equal(ad, 'ayarlariKaydet');
  assert.equal(yuk.koseBildirimi, false);
  assert.equal(yuk.bipSesi, true);
  assert.equal(yuk.yerelAdres, 'http://192.168.1.10:8123');
  assert.equal(yuk.kisayol, 'Control+Alt+H', 'kısayol kaydedilen biçimle gider');
});

test('ev içi adres http:// iken ve anahtar kayıtlıyken uyarı çıkar; https ya da anahtarsızken çıkmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.match(sayfa.oge('yerelAdresUyari').textContent, /şifresiz/);
  assert.equal(sayfa.oge('yerelAdresUyari').style.display, 'block');
  sayfa.oge('yerelAdres').value = 'https://ev.local:8123';
  sayfa.oge('yerelAdres').dispatchEvent({ type: 'input' });
  assert.equal(sayfa.oge('yerelAdresUyari').style.display, 'none');
  const anahtarsiz = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  assert.equal(anahtarsiz.oge('yerelAdresUyari').style.display, 'none');
});

test('anahtar durumu: yetki kesici açıkken rozet "Home Assistant Reddetti" olur ve uyarı görünür; sağlam anahtarda uyarı gizli', async () => {
  const reddedilmis = await acilmisSayfa({ ayar: { ...AYAR, anahtarReddedildi: true }, cihazlar: CIHAZLAR });
  assert.match(reddedilmis.oge('anahtarRozet').textContent, /Home Assistant Reddetti/);
  assert.equal(reddedilmis.oge('anahtarReddedildiUyari').style.display, 'block');
  assert.match(HTML, /id="anahtarReddedildiUyari"[^>]*role="alert"/);
  assert.equal(reddedilmis.oge('btnAnahtarSil').style.display, 'inline-flex');
  assert.equal(reddedilmis.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false, 'kesici açıkken liste kendiliğinden yüklenmez (HA\'ya istek gitmez)');
  const saglam = await acilmisSayfa({ ayar: { ...AYAR, anahtarReddedildi: false }, cihazlar: CIHAZLAR });
  assert.equal(saglam.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  assert.equal(saglam.oge('anahtarReddedildiUyari').style.display, 'none');
  const anahtarsiz = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false, anahtarReddedildi: true }, cihazlar: CIHAZLAR });
  assert.equal(anahtarsiz.oge('anahtarRozet').textContent, 'Henüz Eklenmedi', 'anahtar yoksa reddedildi gösterilmez');
  assert.equal(anahtarsiz.oge('anahtarReddedildiUyari').style.display, 'none');
});

test('cihaz listesi: normal satırlar, "bulunamadı" (seçili, işareti kaldırılabilir) ve "engelli" (seçilemez) ayrı gösterilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  sayfa.oge('btnCihazlariYukle').dispatchEvent({ type: 'click' });
  await akit();

  const eksik = satirBul(sayfa, 'light.eski_lamba');
  assert.ok(eksik.className.includes('satir-bulunamadi'));
  assert.match(eksik.textContent, /bulunamadı/);
  const eksikKutu = eksik.bul((o) => o.etiket === 'input')[0];
  assert.deepEqual([eksikKutu.checked, eksikKutu.disabled], [true, false]);

  const engelli = satirBul(sayfa, 'light.koridor');
  assert.ok(engelli.className.includes('satir-engelli'));
  assert.match(engelli.textContent, /Güvenlik kuralı/);
  const engelliKutu = engelli.bul((o) => o.etiket === 'input')[0];
  assert.deepEqual([engelliKutu.checked, engelliKutu.disabled], [false, true]);

  assert.equal(sayfa.oge('secilenSayisi').textContent, '3 favori seçili', 'engelli favori sayıya katılmaz');
});

test('onay kutuları: zorunlu eylemde işaretli ve kapalı; yeni script varsayılan işaretli; ayardaki onay:false korunur; ışıkta kutu yok değil, işaretsiz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });

  const pc = onayKutusu(satirBul(sayfa, 'button.pc_bilgisayari_kapat'));
  assert.deepEqual([pc.checked, pc.disabled], [true, true], 'PC kapat: onay kapatılamaz');
  assert.match(satirBul(sayfa, 'button.pc_bilgisayari_kapat').textContent, /Onaylı \(zorunlu\)/);

  const betik = onayKutusu(satirBul(sayfa, 'script.kendi_scriptim'));
  assert.equal(betik.checked, true, 'yeni script varsayılan onaylı');
  assert.equal(betik.disabled, true, 'seçili değilken onay kutusu pasif');

  const ekran = onayKutusu(satirBul(sayfa, 'button.pc_ekran_kapat'));
  assert.deepEqual([ekran.checked, ekran.disabled], [false, false], 'ayardaki onay:false korunur');

  const isik = onayKutusu(satirBul(sayfa, 'light.salon_lambasi'));
  assert.equal(isik.checked, false);

  assert.match(satirBul(sayfa, 'script.kendi_scriptim').textContent, /İçinde kapı\/kilit çağıran bir script veya sahneyi favoriye koyma\./);
  assert.doesNotMatch(satirBul(sayfa, 'light.salon_lambasi').textContent, /kapı\/kilit/);
});

test('favori kaydı yükü: kimlikler seçili sırayla; onay YALNIZ kullanıcı değiştirdiyse gider; zorunlu eylemin onayı gönderilmez; eksik favori yükte kalır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });

  // Kullanıcı: yeni script'i seçer ve onayını kapatır; ekran kapat'ın onayını açar; PC kapat'ı seçer.
  const betikSatiri = satirBul(sayfa, 'script.kendi_scriptim');
  betikSatiri.bul((o) => o.etiket === 'input')[0].tikla(); // seç
  onayKutusu(betikSatiri).tikla(); // onayı kapat
  onayKutusu(satirBul(sayfa, 'button.pc_ekran_kapat')).tikla(); // onayı aç
  satirBul(sayfa, 'button.pc_bilgisayari_kapat').bul((o) => o.etiket === 'input')[0].tikla();
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'inline', 'seçim değişti: kaydedilmemiş değişiklik göstergesi');

  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa, 'favorileriKaydet');
  const harita = new Map(yuk.map((g) => [g.entity_id, g]));
  assert.deepEqual(harita.get('script.kendi_scriptim'), { entity_id: 'script.kendi_scriptim', onay: false });
  assert.deepEqual(harita.get('button.pc_ekran_kapat'), { entity_id: 'button.pc_ekran_kapat', onay: true });
  assert.deepEqual(harita.get('button.pc_bilgisayari_kapat'), { entity_id: 'button.pc_bilgisayari_kapat' }, 'zorunlu: onay alanı gönderilmez');
  assert.deepEqual(harita.get('light.salon_lambasi'), { entity_id: 'light.salon_lambasi' }, 'değişmeyen: yalnız kimlik');
  assert.ok(harita.has('light.eski_lamba'), 'HA\'da bulunamayan favori kullanıcı kaldırmadıkça yükte kalır');
  assert.deepEqual(yuk.map((g) => g.entity_id).slice(0, 4), ['light.salon_lambasi', 'button.pc_ekran_kapat', 'light.eski_lamba', 'light.koridor'], 'kayıtlı sıra korunur, yeni seçilenler sona eklenir');
  assert.match(sayfa.oge('genelBildirim').textContent, /1 tanesi Home Assistant’ta şu an bulunamadığı için olduğu gibi korundu/);
  assert.match(sayfa.oge('genelBildirim').textContent, /1 favori güvenlik kuralı nedeniyle çıkarıldı/);
});

test('bulunamadı satırının işareti kaldırılırsa yükten çıkar (silme kararı kullanıcının)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  satirBul(sayfa, 'light.eski_lamba').bul((o) => o.etiket === 'input')[0].tikla();
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa, 'favorileriKaydet');
  assert.equal(yuk.some((g) => g.entity_id === 'light.eski_lamba'), false);
});

test('filtre: kimlik ve ada göre süzer; boş sonuçta ileti çıkar; metinler textContent ile yazılır (zararlı ad etiket olmaz)', async () => {
  const zararli = { ...CIHAZLAR, cihazlar: [...CIHAZLAR.cihazlar, { entity_id: 'light.x', ad: '<img src=x onerror=alert(1)>', alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false }] };
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: zararli });
  const satir = satirBul(sayfa, 'light.x');
  assert.equal(satir.bul((o) => o.className === 'cihaz-ad')[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(satir.bul((o) => o.etiket === 'img').length, 0, 'ad etiket olarak yorumlanmaz');
  sayfa.oge('cihazAra').value = 'salon';
  sayfa.oge('cihazAra').dispatchEvent({ type: 'input' });
  assert.equal(satirlar(sayfa).length, 1);
  sayfa.oge('cihazAra').value = 'olmayan-bir-sey';
  sayfa.oge('cihazAra').dispatchEvent({ type: 'input' });
  assert.equal(sayfa.oge('cihazListesi').textContent, 'Eşleşen cihaz bulunamadı.');
});

test('anahtar silme: onay metni ana sürecin metniyle aynı; "İptal"de silinmez; onaylanınca silinir ve ileti HA anahtarının iptal edilmediğini söyler', async () => {
  const iptal = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, onayYaniti: false });
  iptal.oge('btnAnahtarSil').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(iptal.sorular, [ANAHTAR_SILME_ONAY_METNI]);
  assert.equal(iptal.cagrilar.some((c) => c[0] === 'anahtarSil'), false);

  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR, onayYaniti: true });
  sayfa.oge('btnAnahtarSil').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.sorular, [ANAHTAR_SILME_ONAY_METNI]);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'anahtarSil'), true);
  assert.equal(sayfa.oge('genelBildirim').textContent, ANAHTAR_SILINDI_METNI);
  assert.match(sayfa.oge('genelBildirim').textContent, /iptal etmeyi unutma/);
  assert.match(sayfa.oge('cihazListesi').textContent, /Erişim anahtarı silindi/, 'silince liste geçersiz: ileti gösterilir');
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Henüz Eklenmedi');
});

test('anahtar kaydı: girdi alanı başarıdan sonra boşaltılır (anahtar sayfada kalmaz)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false }, cihazlar: CIHAZLAR });
  sayfa.oge('anahtarGirdisi').value = 'TEST_SAHTE_ANAHTAR_000000';
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'anahtarKaydet'), ['anahtarKaydet', 'TEST_SAHTE_ANAHTAR_000000']);
  assert.equal(sayfa.oge('anahtarGirdisi').value, '');
});

// ---------------------------------------------------------------------------
// Dalga 3: hızlı panel/palet ayarları, canlı bağlantı, panolar, favori kısayolu/parlaklık, gizli adaylar, hazır liste
// ---------------------------------------------------------------------------

test('Dalga 3 açılış: tepsi sol tık, palet kısayolu, canlı bağlantı ve pano listesi alanlara yazılır; canlı durum metni gösterilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfa.oge('tepsiSolTik').value, 'panel');
  assert.equal(sayfa.oge('paletKisayol').value, 'Ctrl+Alt+P', 'kısayollar arayüzde Ctrl biçiminde gösterilir');
  assert.equal(sayfa.oge('canliBaglanti').checked, true);
  assert.match(sayfa.oge('canliDurumMetni').textContent, /anında gelir/);
  const pano = sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir');
  assert.equal(pano.length, 1);
  assert.deepEqual(girdiler(pano[0]).map((g) => g.value), ['Enerji', '/energy', 'Ctrl+Alt+E']);
  assert.match(sayfa.oge('hazirListeDurum').textContent, /uygulandı/);
});

test('Dalga 3 açılış: eski ayar (yeni alanlar yok) çökmez; varsayılanlar gösterilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('tepsiSolTik').value, 'panel');
  assert.equal(sayfa.oge('paletKisayol').value, 'Ctrl+Alt+P');
  assert.equal(sayfa.oge('canliBaglanti').checked, true);
  assert.equal(sayfa.oge('panolarListesi').children.length, 0);
});

test('Dalga 3: boş palet kısayolu "kapalı" olarak korunur ve yükte boş gider; tepsi sol tık "pencere" seçilebilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, paletKisayol: '', tepsiSolTik: 'pencere', canliBaglanti: false, canliDurum: 'kapali' }, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfa.oge('paletKisayol').value, '', 'kapalı palet kısayolu varsayılana dönmez');
  assert.equal(sayfa.oge('tepsiSolTik').value, 'pencere');
  assert.equal(sayfa.oge('canliBaglanti').checked, false);
  assert.match(sayfa.oge('canliDurumMetni').textContent, /kapalı/);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.paletKisayol, '');
  assert.equal(yuk.tepsiSolTik, 'pencere');
  assert.equal(yuk.canliBaglanti, false);
});

test('Dalga 3: "Varsayılan Yap" palet kısayolunu geri getirir; kaydedilen yük yeni alanları taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, paletKisayol: '' }, cihazlar: CIHAZLAR_D3 });
  sayfa.oge('btnPaletKisayolVarsayilan').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('paletKisayol').value, 'Ctrl+Alt+P');
  sayfa.oge('tepsiSolTik').value = 'pencere';
  sayfa.oge('canliBaglanti').checked = false;
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual([yuk.paletKisayol, yuk.tepsiSolTik, yuk.canliBaglanti], ['Control+Alt+P', 'pencere', false]);
  assert.deepEqual(yuk.panolar, [{ ad: 'Enerji', yol: '/energy', kisayol: 'Control+Alt+E' }]);
});

test('panolar: ekle/sil, en çok 6, boş satırlar yükten çıkar; metinler textContent ile yazılır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3 });
  const satirSayisi = () => sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir').length;
  for (let i = 0; i < 8; i += 1) sayfa.oge('btnPanoEkle').dispatchEvent({ type: 'click' });
  assert.equal(satirSayisi(), 6, 'en çok 6 HA panosu');
  assert.equal(sayfa.oge('btnPanoEkle').disabled, true);

  // Sil düğmesi satırı kaldırır (son satır) ve ekleme yeniden açılır
  const silDugmeleri = sayfa.oge('panolarListesi').bul((o) => o.etiket === 'button');
  silDugmeleri.at(-1).dispatchEvent({ type: 'click' });
  assert.equal(satirSayisi(), 5);
  assert.equal(sayfa.oge('btnPanoEkle').disabled, false);

  // 2. satırı doldur, diğer boş satırlar yükte olmasın
  const ikinci = sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir')[1];
  const [ad, yol, kisayol] = girdiler(ikinci);
  ad.value = '  Ses  ';
  ad.dispatchEvent({ type: 'input' });
  yol.value = '/lovelace/ses';
  yol.dispatchEvent({ type: 'input' });
  kisayol.value = ' Control+Alt+S ';
  kisayol.dispatchEvent({ type: 'input' });
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual(yuk.panolar, [
    { ad: 'Enerji', yol: '/energy', kisayol: 'Control+Alt+E' },
    { ad: 'Ses', yol: '/lovelace/ses', kisayol: 'Control+Alt+S' },
  ]);
});

test('panolar: reddedilen pano kısayolunun nedeni satırda görünür', async () => {
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR_D3, kisayolDurumlari: [{ id: 'pano:0', tur: 'pano', sira: 0, kisayol: 'Control+Alt+E', gecerli: false, durum: 'reddedildi', mesaj: 'Control+Alt+E başka bir kısayolla çakışıyor.' }] },
    cihazlar: CIHAZLAR_D3,
  });
  assert.match(sayfa.oge('panolarListesi').textContent, /çakışıyor/);
});

test('gizli adaylar: varsayılan gizli, sayaç doğru; seçili gizli aday görünür; "Gizlenenleri göster" hepsini açar', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  const kimlikler = () => satirlar(sayfa).map(satirKimligi);
  assert.equal(kimlikler().includes('light.gizli_aday'), false, 'gizli aday varsayılan görünmez');
  assert.equal(kimlikler().includes('light.gizli_ama_secili'), true, 'seçili olan gizli aday görünür kalır');
  assert.equal(sayfa.oge('gizlileriGosterMetin').textContent, 'Gizlenenleri göster (1)');
  sayfa.oge('gizlileriGoster').checked = true;
  sayfa.oge('gizlileriGoster').dispatchEvent({ type: 'change' });
  assert.equal(kimlikler().includes('light.gizli_aday'), true);
});

test('favori satırı: kısayol kutusu yalnız uygun (zararsız) eylemde, parlaklık kutusu yalnız ışıkta, karo adı her normal satırda; seçilmeyen satırda pasif; tıklama satır seçimini değiştirmez', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3_FAVORILI, cihazlar: CIHAZLAR_D3 });
  const onayKutulari = (kimlik) => girdiler(satirBul(sayfa, kimlik)).filter((g) => g.type === 'checkbox');
  const kutular = (kimlik) => metinKutulari(satirBul(sayfa, kimlik));

  // 1.4.0 düzen: her normal satırın sonunda karo görünümü grubu (tepsiye sabitle işaret kutusu ve simge için emoji kutusu) vardır.
  assert.equal(kutular('light.salon_lambasi').length, 3, 'ışık: kısayol + karo adı + emoji kutusu');
  assert.equal(onayKutulari('light.salon_lambasi').length, 4, 'ışık: seçim + onay + parlaklık ayarı + tepsiye sabitle');
  assert.equal(kutular('scene.film').length, 3, 'sahne: kısayol + karo adı + emoji kutusu');
  assert.equal(onayKutulari('scene.film').length, 3, 'sahne: parlaklık ayarı yok');
  assert.equal(kutular('button.pc_bilgisayari_kapat').length, 2, 'yıkıcı eylem: kısayol kutusu hiç yok, karo adı + emoji kutusu');
  assert.equal(onayKutulari('button.pc_bilgisayari_kapat').length, 3);
  assert.equal(kutular('scene.film')[0].disabled, true, 'seçilmemiş satırda pasif');
  assert.equal(kutular('light.salon_lambasi')[0].disabled, false);

  // Kısayol kutusuna tıklamak satırın seçimini değiştirmez
  const satir = satirBul(sayfa, 'light.salon_lambasi');
  const secim = girdiler(satir)[0];
  const once = secim.checked;
  kutular('light.salon_lambasi')[0].dispatchEvent({ type: 'click', stopPropagation() {} });
  const ek = satir.bul((o) => o.className === 'cihaz-ek')[0];
  ek.dispatchEvent({ type: 'click', target: ek, stopPropagation() {} });
  assert.equal(secim.checked, once);
});

test('favori kaydı yükü: kısayol ve parlaklık YALNIZ kullanıcı değiştirdiyse gider; boş kısayol (silme) gönderilir; değişiklik yoksa favori çağrısı hiç yapılmaz', async () => {
  const ayar = { ...AYAR_D3, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', kisayol: 'Control+Alt+L', parlaklik: true }, { entity_id: 'scene.film', ad: 'Film' }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const [isikKisayol] = metinKutulari(isik);
  const [, , isikParlaklik] = girdiler(isik).filter((g) => g.type === 'checkbox');
  assert.equal(isikKisayol.value, 'Ctrl+Alt+L', 'ayardaki kısayol gösterilir');
  assert.equal(isikParlaklik.checked, true, 'ayardaki parlaklık ayarı gösterilir');

  // Değişiklik yok: yalnız genel ayarlar kaydedilir, favori çağrısı yapılmaz
  await kaydet(sayfa);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'favorileriKaydet'), false);

  // Kullanıcı: ışığın kısayolunu siler, parlaklığı kapatır; sahneye kısayol yazar
  const sayfa2 = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  const isik2 = satirBul(sayfa2, 'light.salon_lambasi');
  const kutu = metinKutulari(isik2)[0];
  kutu.value = '  ';
  kutu.dispatchEvent({ type: 'input' });
  girdiler(isik2).filter((g) => g.type === 'checkbox')[2].tikla();
  const film = metinKutulari(satirBul(sayfa2, 'scene.film'))[0];
  film.value = 'ctrl alt f';
  film.dispatchEvent({ type: 'input' });
  await kaydet(sayfa2);
  const yuk = sonKayitYuku(sayfa2, 'favorileriKaydet');
  const harita = new Map(yuk.map((g) => [g.entity_id, g]));
  assert.deepEqual(harita.get('light.salon_lambasi'), { entity_id: 'light.salon_lambasi', kisayol: '', parlaklik: false });
  assert.deepEqual(harita.get('scene.film'), { entity_id: 'scene.film', kisayol: 'Control+Alt+F' }, 'serbest yazım kaydedilen biçime çevrilir');
});

test('favori kaydı sonucu: reddedilen kısayolların nedeni kullanıcıya söylenir (sessiz kalmaz)', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR_D3_FAVORILI,
    cihazlar: CIHAZLAR_D3,
    favoriSonucu: {
      ok: true,
      sayi: 3,
      eksik: 0,
      engelli: 0,
      kisayolHatalari: [{ entity_id: 'light.salon_lambasi', neden: 'cakisma' }],
      kisayolSorunlari: [{ id: 'favori:0', tur: 'favori', kimlik: 'light.salon_lambasi', kisayol: 'Control+Alt+H', neden: 'cakisma', mesaj: 'Control+Alt+H başka bir kısayolla çakışıyor.' }],
    },
  });
  satirBul(sayfa, 'scene.film').bul((o) => o.etiket === 'input')[0].tikla(); // favori listesi değişsin
  await kaydet(sayfa);
  assert.match(sayfa.oge('genelBildirim').textContent, /başka bir kısayolla çakışıyor/);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
});

test('hazır liste düğmesi: ana sürece tek çağrı gider, sonuç sayıları bildirilir ve mevcut favorilere dokunulmadığı söylenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, hazirListeGuncel: false }, cihazlar: CIHAZLAR_D3 });
  assert.match(sayfa.oge('hazirListeDurum').textContent, /henüz uygulanmadı/);
  sayfa.oge('btnHazirListe').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'hazirListeyiUygula').length, 1);
  assert.match(sayfa.oge('genelBildirim').textContent, /3 hazır karo eklendi; 2 tanesi Home Assistant’ta bulunamadığı için atlandı/);
  assert.match(sayfa.oge('genelBildirim').textContent, /dokunulmadı/);
});

// --- Dalga 4: Görünüm bölümü (malzeme, tema, vurgu rengi) ----------------------------------

const AYAR_D4 = { ...AYAR, yeniPencereMalzemesi: 'mica', malzemeDestekleniyor: true, temaZorla: 'sistem', vurguRengi: '#0f75e0' };

test('Görünüm: HTML kimlikleri var; malzeme ve tema seçenekleri beklenen değerleri sunar', () => {
  for (const kimlik of ['yeniPencereMalzemesi', 'malzemeUyari', 'temaZorla', 'vurguRengi', 'vurguRengiSecici', 'vurguOnizleme', 'btnVurguSifirla']) {
    assert.match(HTML, new RegExp(`id="${kimlik}"`), kimlik);
  }
  const secenekler = (kimlik) => [...new RegExp(`<select[^>]*id="${kimlik}"[^>]*>([\\s\\S]*?)</select>`).exec(HTML)[1].matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(secenekler('yeniPencereMalzemesi'), ['acrylic', 'mica', 'yok']);
  assert.deepEqual(secenekler('temaZorla'), ['koyu', 'sistem', 'acik']);
  assert.match(HTML, /id="vurguRengi"[^>]*maxlength="7"|maxlength="7"[^>]*id="vurguRengi"/);
});

test('Görünüm açılış: kayıtlı malzeme, tema ve vurgu rengi alanlara yazılır; destek varken uyarı gizli', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D4, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('yeniPencereMalzemesi').value, 'mica');
  assert.equal(sayfa.oge('temaZorla').value, 'sistem');
  assert.equal(sayfa.oge('vurguRengi').value, '#0f75e0');
  assert.equal(sayfa.oge('malzemeUyari').style.display, 'none');
});

test('Görünüm açılış: eski ayar (alanlar yok) çökmez; varsayılanlar (acrylic, koyu, sistem rengi) gösterilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('yeniPencereMalzemesi').value, 'acrylic');
  assert.equal(sayfa.oge('temaZorla').value, 'koyu');
  assert.equal(sayfa.oge('vurguRengi').value, '');
  const bozuk = await acilmisSayfa({ ayar: { ...AYAR, yeniPencereMalzemesi: 'cam', temaZorla: 7, vurguRengi: 42 }, cihazlar: CIHAZLAR });
  assert.equal(bozuk.oge('yeniPencereMalzemesi').value, 'acrylic');
  assert.equal(bozuk.oge('temaZorla').value, 'koyu');
  assert.equal(bozuk.oge('vurguRengi').value, '');
});

test('Görünüm: Windows sürümü malzemeyi desteklemiyorsa açıklayıcı uyarı çıkar (metin textContent ile)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D4, malzemeDestekleniyor: false }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('malzemeUyari').style.display, 'block');
  assert.match(sayfa.oge('malzemeUyari').textContent, /22H2/);
  assert.match(sayfa.oge('malzemeUyari').textContent, /düz görünür/);
});

test('Görünüm kaydı: malzeme, tema ve vurgu rengi yükte gider; "Sıfırla" rengi boşaltır (Windows rengi)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D4, cihazlar: CIHAZLAR });
  sayfa.oge('yeniPencereMalzemesi').value = 'yok';
  sayfa.oge('temaZorla').value = 'koyu';
  sayfa.oge('vurguRengi').value = '  #E91E63 ';
  await kaydet(sayfa);
  let yuk = sonKayitYuku(sayfa);
  assert.deepEqual([yuk.yeniPencereMalzemesi, yuk.temaZorla, yuk.vurguRengi], ['yok', 'koyu', '#E91E63']);

  sayfa.oge('btnVurguSifirla').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('vurguRengi').value, '');
  await kaydet(sayfa);
  yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.vurguRengi, '');
});

test('anahtar durumu: yetki kesici kaydı yazılamıyor/okunamıyorsa Ayarlar\'da açık uyarı görünür; sorun yoksa gizli', async () => {
  const yazilamadi = await acilmisSayfa({ ayar: { ...AYAR, anahtarReddedildi: true, yetkiKaydiSorunu: 'yazilamadi' }, cihazlar: CIHAZLAR });
  assert.equal(yazilamadi.oge('yetkiKaydiUyari').style.display, 'block');
  assert.match(yazilamadi.oge('yetkiKaydiUyari').textContent, /diske yazılamıyor/);
  assert.match(HTML, /id="yetkiKaydiUyari"[^>]*role="alert"/);
  const okunamadi = await acilmisSayfa({ ayar: { ...AYAR, yetkiKaydiSorunu: 'okunamadi' }, cihazlar: CIHAZLAR });
  assert.match(okunamadi.oge('yetkiKaydiUyari').textContent, /okunamadı/);
  const saglam = await acilmisSayfa({ ayar: { ...AYAR, yetkiKaydiSorunu: null }, cihazlar: CIHAZLAR });
  assert.equal(saglam.oge('yetkiKaydiUyari').style.display, 'none');
  assert.equal(saglam.oge('yetkiKaydiUyari').textContent, '');
});

test('anahtar durumu (tur 2): "doğrulanamadı" ve "ev içi 403" durumlarında uyarı + "Yeniden Dene" düğmesi görünür ve tek IPC çağrısı yapar; reddedildi/sağlam durumda düğme gizli', async () => {
  for (const [durum, rozet, uyari] of [
    ['dogrulanamadi', /Doğrulanamadı/, /yanıt vermedi/],
    ['kayit-onayi', /Güvenlik Kaydı Okunamadı/, /yetki-kesici\.json/],
    ['yerel-yasak', /Ev İçi Adres Engelledi \(403\)/, /403 verdi/],
  ]) {
    const sayfa = await acilmisSayfa({ ayar: { ...AYAR, yetkiDurumu: durum }, cihazlar: CIHAZLAR });
    assert.match(sayfa.oge('anahtarRozet').textContent, rozet);
    assert.equal(sayfa.oge('yetkiDurumUyari').style.display, 'block');
    assert.match(sayfa.oge('yetkiDurumUyari').textContent, uyari);
    assert.equal(sayfa.oge('btnYetkiYenidenDene').style.display, 'inline-flex');
    sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
    await akit();
    assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'yetkiYenidenDene'), [['yetkiYenidenDene']]);
  }
  assert.match(HTML, /id="yetkiDurumUyari"[^>]*role="alert"/);
  for (const ayar of [{ ...AYAR, yetkiDurumu: 'reddedildi', anahtarReddedildi: true }, { ...AYAR, yetkiDurumu: null }, { ...AYAR, anahtarVar: false, yetkiDurumu: 'dogrulanamadi' }]) {
    const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR });
    assert.equal(sayfa.oge('btnYetkiYenidenDene').style.display, 'none');
    assert.equal(sayfa.oge('yetkiDurumUyari').style.display, 'none');
  }
});

test('anahtar durumu (tur 2): anahtar dosyası kenara alındıysa (kayıt yazılamadı) Ayarlar nedenini söyler; anahtar yokken rozet "Henüz Eklenmedi"', async () => {
  const karantina = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false, anahtarKarantinada: true }, cihazlar: CIHAZLAR });
  assert.equal(karantina.oge('anahtarKarantinaUyari').style.display, 'block');
  assert.equal(karantina.oge('anahtarRozet').textContent, 'Henüz Eklenmedi');
  assert.match(HTML, /id="anahtarKarantinaUyari"[^>]*role="alert"/);
  const normal = await acilmisSayfa({ ayar: { ...AYAR, anahtarVar: false, anahtarKarantinada: false }, cihazlar: CIHAZLAR });
  assert.equal(normal.oge('anahtarKarantinaUyari').style.display, 'none');
});

test('açık ikinci onay (tur 3, K7): sunucu onayGerekli + bilet dönerse uyarı + onay kutusu görünür; işaretlenince anahtar kaydı ve Yeniden Dene o BİLETLE gider', async () => {
  const UYARI = 'Bu bilgisayardan son başarılı bağlantıdan beri 2 hatalı ya da yanıtsız deneme yapıldı. Home Assistant 5 hatalı denemede bu bilgisayarı engeller.';
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, yetkiDurumu: 'dogrulanamadi' },
    cihazlar: CIHAZLAR,
    kaydetYaniti: (secenek) => (secenek?.bilet === 'BILET_1' ? { ok: true, uyari: '' } : { ok: false, onayGerekli: true, hata: UYARI, bilet: 'BILET_1' }),
    yenidenDeneYaniti: (secenek) => (secenek?.bilet === 'BILET_1' ? { ok: true } : { ok: false, onayGerekli: true, hata: UYARI, bilet: 'BILET_1' }),
  });
  assert.notEqual(sayfa.oge('ikinciOnayKutusu').style.display, 'block', 'başta görünmez');
  assert.match(HTML, /id="ikinciOnayKutusu"[^>]*style="display: none;/);
  assert.match(HTML, /id="ikinciOnayKutusu"[^>]*role="alert"/);
  assert.match(HTML, /id="chkIkinciOnay"/);

  sayfa.oge('anahtarGirdisi').value = 'TEST_SAHTE_ANAHTAR_000000';
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'block');
  assert.equal(sayfa.oge('ikinciOnayMetni').textContent, UYARI);
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false);
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['anahtarKaydet', { bilet: null }], 'ilk deneme onaysız (bilet yok)');
  assert.equal(sayfa.oge('anahtarGirdisi').value, 'TEST_SAHTE_ANAHTAR_000000', 'onay bekleyen anahtar silinmedi');

  sayfa.oge('chkIkinciOnay').checked = true;
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['anahtarKaydet', { bilet: 'BILET_1' }]);
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'none', 'başarıdan sonra gizlenir');

  sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['yetkiYenidenDene', { bilet: null }]);
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'block');
  sayfa.oge('chkIkinciOnay').checked = true;
  sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['yetkiYenidenDene', { bilet: 'BILET_1' }]);
});

test('açık ikinci onay (tur 5, K7): onay yalnız BİR denemeye yeter: 401 (hata) sonrası kutu işaretsiz ve gizli; uyarıdaki N her yanıtta güncellenir; anahtar girdisi değişince temizlenir', async () => {
  let sayac = 2;
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    kaydetYaniti: (secenek) => {
      if (secenek?.bilet) {
        sayac += 1; // onaylı aday HA'dan 401 aldı
        return { ok: false, hata: 'Home Assistant bu anahtarı reddetti.' };
      }
      return { ok: false, onayGerekli: true, hata: `N=${sayac} uyarı`, bilet: `BILET_${sayac}` };
    },
  });
  const anahtarKaydet = async (deger) => {
    sayfa.oge('anahtarGirdisi').value = deger;
    sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
    await akit();
  };
  await anahtarKaydet('ADAY_ANAHTAR_BIR_0000000000');
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'block');
  assert.equal(sayfa.oge('ikinciOnayMetni').textContent, 'N=2 uyarı');
  sayfa.oge('chkIkinciOnay').checked = true;
  await anahtarKaydet('ADAY_ANAHTAR_BIR_0000000000');
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['anahtarKaydet', { bilet: 'BILET_2' }]);
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'none', '401 sonrası kutu gizlenir');
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false, '401 sonrası onay işareti KALMAZ');

  await anahtarKaydet('ADAY_ANAHTAR_IKI_0000000000');
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['anahtarKaydet', { bilet: null }], 'ikinci aday onaysız gider (eski onay taşınmaz)');
  assert.equal(sayfa.oge('ikinciOnayMetni').textContent, 'N=3 uyarı', 'uyarıdaki N güncellendi');
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false);

  // anahtar girdisi değişince onay ve bilet silinir
  sayfa.oge('chkIkinciOnay').checked = true;
  sayfa.oge('anahtarGirdisi').dispatchEvent({ type: 'input' });
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'none');
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false);
  await anahtarKaydet('ADAY_ANAHTAR_UC_000000000');
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['anahtarKaydet', { bilet: null }]);
});

test('açık ikinci onay (tur 5, K7): istisna (IPC hatası) sonrası da kutu işaretsiz ve gizli; Yeniden Dene 401/hata sonrası da onayı taşımaz', async () => {
  let yenidenDeneSayisi = 0;
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, yetkiDurumu: 'dogrulanamadi' },
    cihazlar: CIHAZLAR,
    yenidenDeneYaniti: (secenek) => {
      yenidenDeneSayisi += 1;
      if (yenidenDeneSayisi === 2) throw new Error('ipc koptu');
      if (secenek?.bilet) return { ok: false, hata: 'yeniden denenemedi' };
      return { ok: false, onayGerekli: true, hata: `N=${yenidenDeneSayisi + 1}`, bilet: `BILET_${yenidenDeneSayisi}` };
    },
  });
  const tikla = async () => {
    sayfa.oge('btnYetkiYenidenDene').dispatchEvent({ type: 'click' });
    await akit();
  };
  await tikla(); // 1: onayGerekli
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'block');
  sayfa.oge('chkIkinciOnay').checked = true;
  await tikla(); // 2: istisna
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'none');
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false);
  await tikla(); // 3: yeniden onayGerekli (bilet yok)
  assert.deepEqual(duzles(sayfa.secenekler.at(-1)), ['yetkiYenidenDene', { bilet: null }]);
  sayfa.oge('chkIkinciOnay').checked = true;
  await tikla(); // 4: onaylı, ama hata
  assert.equal(sayfa.oge('ikinciOnayKutusu').style.display, 'none');
  assert.equal(sayfa.oge('chkIkinciOnay').checked, false);
});

test('kaydettikten sonra değişiklik haritaları temizlenir: tekrar Kaydet basıldığında favori çağrısı gitmez', async () => {
  const ayar = { ...AYAR_D3, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', kisayol: 'Control+Alt+L', parlaklik: true }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const [, , isikParlaklik] = girdiler(isik).filter((g) => g.type === 'checkbox');
  isikParlaklik.tikla();

  await kaydet(sayfa);
  const ilkYuk = sonKayitYuku(sayfa, 'favorileriKaydet');
  assert.equal(ilkYuk[0].parlaklik, false);
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none', 'kayıttan sonra gösterge kapanır');

  const once = sayfa.cagrilar.filter((c) => c[0] === 'favorileriKaydet').length;
  await kaydet(sayfa);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'favorileriKaydet').length, once, 'değişiklik kalmadı: favori çağrısı gitmez');
  assert.equal(satirlar(sayfa).length > 0, true);
});
