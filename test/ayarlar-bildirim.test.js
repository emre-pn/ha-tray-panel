'use strict';

/**
 * Ayarlar penceresinin "Bildirim merkezi ve uyarı kuralları" bölümü (1.4.0; o-36, o-37, o-39): src/ayarlar.html + src/ayarlar.js.
 * Sahte DOM (test/ayarlar-sahte.js): gerçek tarayıcı/Electron yok. Sunucu davranışı gerçek doğrulayıcıyla (uyari-kurallari.js
 * kurallariDuzelt) taklit edilir, böylece "kayıtlı kural forma eksiksiz geri döner" ve "sunucu kuralı düşürürse yazılanlar silinmez"
 * gerçeğe yakın sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { kurallariDuzelt } = require('../src/lib/uyari-kurallari');
const AYARLAR = require('../src/lib/ceviri/ayarlar');
const { HTML, BETIK, AYAR_D3, CIHAZLAR_D3, akit, duzles, acilmisSayfa } = require('./ayarlar-sahte');

const KOK = path.join(__dirname, '..');

const KURAL_ESIK = {
  id: 'u1',
  acik: true,
  varlik: 'sensor.salon_sicaklik',
  kosul: { tur: 'esik', yon: 'ustunde', deger: 30.5 },
  metin: '{ad} {durum} oldu',
  sure: 300,
  bekleme: 600,
  sessizSaatler: { baslangic: '22:00', bitis: '07:00' },
  windows: true,
};
const KURAL_GECIS = {
  id: 'u2',
  acik: false,
  varlik: 'media_player.salon',
  kosul: { tur: 'gecis', den: 'playing', ye: '' },
  metin: '',
  sure: 0,
  bekleme: 300,
  sessizSaatler: null,
  windows: false,
};
const KURAL_ULASILAMIYOR = {
  id: 'u3',
  acik: true,
  varlik: 'sensor.camasir_durumu',
  kosul: { tur: 'ulasilamiyor' },
  metin: 'Çamaşır sensörü gitti',
  sure: 60,
  bekleme: 3600,
  sessizSaatler: null,
  windows: false,
};

const AYAR_B = {
  ...AYAR_D3,
  bildirimKalici: true,
  bildirimPil: true,
  bildirimPilEsigi: 20,
  bildirimGuncelleme: false,
  bildirimMasaustu: true,
  uyariKurallari: [KURAL_ESIK, KURAL_GECIS, KURAL_ULASILAMIYOR],
};
const uygunCihaz = (kimlik, ad, alan, oneriler, simge) => ({
  entity_id: kimlik,
  ad,
  alan,
  alanEtiketi: alan,
  durum: '',
  onayZorunlu: false,
  varsayilanOnay: false,
  kisayolUygun: false,
  gizli: false,
  uyariUygun: true,
  durumOnerileri: oneriler,
  uyariSimgesi: simge,
});
const CIHAZLAR_B = {
  ...CIHAZLAR_D3,
  cihazlar: [
    ...CIHAZLAR_D3.cihazlar,
    uygunCihaz('sensor.salon_sicaklik', 'Salon Sıcaklığı', 'sensor', ['unavailable', 'unknown'], '📈'),
    uygunCihaz('media_player.salon', 'Salon Hoparlörü', 'media_player', ['idle', 'playing', 'paused', 'off', 'on', 'unavailable', 'unknown'], '🎵'),
    uygunCihaz('sensor.camasir_durumu', 'Çamaşır Durumu', 'sensor', ['unavailable', 'unknown'], '📈'),
    uygunCihaz('input_select.mod', 'Ev Modu', 'input_select', ['evde', 'disarida', 'unavailable', 'unknown'], '▾'),
  ],
};

/** Sunucu: bildirim alanlarını ve kuralları gerçek doğrulayıcıdan geçirerek uygular. */
const sunucuUygula = (yuk, sunucu) => {
  for (const a of ['bildirimKalici', 'bildirimPil', 'bildirimGuncelleme', 'bildirimMasaustu']) sunucu[a] = yuk[a];
  sunucu.bildirimPilEsigi = Number(yuk.bildirimPilEsigi);
  sunucu.uyariKurallari = kurallariDuzelt(yuk.uyariKurallari);
  return { ok: true, uyarilar: [] };
};

const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: AYAR_B, cihazlar: CIHAZLAR_B, ayarKaydetYaniti: sunucuUygula, ...ek });
const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const kayitSayisi = (sayfa) => sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').length;
const sonYuk = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const sec = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'change' });
};
const kartlar = (sayfa) => sayfa.oge('kuralListesi').bul((o) => o.className === 'kural');
const alan = (kart, etiket) => kart.bul((o) => (o.etiket === 'input' || o.etiket === 'select') && o.attributes['aria-label'] === etiket)[0];
const n1 = (ek) => `Uyarı kuralı 1 ${ek}`;
const gecersizMi = (oge) => oge.classList.contains('gecersiz');
const kartHatasi = (kart) => kart.bul((o) => o.className === 'kural-hata')[0].textContent;

// ---------------------------------------------------------------------------
// Açılış ve kirli durum
// ---------------------------------------------------------------------------

test('açılış: bildirim ayarları ve kayıtlı kurallar forma eksiksiz yazılır; kaydedilmemiş değişiklik göstergesi çıkmaz', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge('bildirimKalici').checked, true);
  assert.equal(sayfa.oge('bildirimPil').checked, true);
  assert.equal(sayfa.oge('bildirimPilEsigi').value, '20');
  assert.equal(sayfa.oge('bildirimGuncelleme').checked, false);
  assert.equal(sayfa.oge('bildirimMasaustu').checked, true);
  const k = kartlar(sayfa);
  assert.equal(k.length, 3);
  const ilk = k[0];
  assert.equal(alan(ilk, n1('cihazı')).value, 'sensor.salon_sicaklik');
  assert.equal(ilk.bul((o) => o.className === 'kural-ad')[0].textContent, '📈 Salon Sıcaklığı');
  assert.equal(alan(ilk, n1('koşulu')).value, 'esik');
  assert.equal(alan(ilk, n1('yönü')).value, 'ustunde');
  assert.equal(alan(ilk, n1('eşik değeri')).value, '30.5');
  assert.equal(alan(ilk, n1('cümlesi')).value, '{ad} {durum} oldu');
  assert.equal(alan(ilk, n1('süresi')).value, '300');
  assert.equal(alan(ilk, n1('bekleme süresi')).value, '600');
  assert.equal(alan(ilk, n1('sessiz saatleri')).checked, true);
  assert.equal(alan(ilk, n1('sessiz saat başlangıcı')).value, '22:00');
  assert.equal(alan(ilk, n1('sessiz saat bitişi')).value, '07:00');
  assert.equal(alan(ilk, n1('Windows bildirimi')).checked, true);
  assert.equal(alan(k[1], 'Uyarı kuralı 2 önceki durumu').value, 'playing');
  assert.equal(alan(k[1], 'Uyarı kuralı 2 yeni durumu').value, '');
  assert.equal(alan(k[1], 'Etkin: Uyarı kuralı 2').checked, false);
  assert.equal(alan(k[2], 'Uyarı kuralı 3 koşulu').value, 'ulasilamiyor');
  assert.equal(kirliMi(sayfa), false, 'sunucudan gelen kurallar formda aynı biçimde karşılaştırılır');
  assert.equal(sayfa.oge('kuralBos').textContent, '');
  assert.equal(sayfa.oge('btnKuralEkle').disabled, false);
  assert.equal(sayfa.oge('btnKuralCihazlar').style.display, 'none');
  assert.equal(sayfa.oge('kuralCihazIpucu').textContent, '');
});

test('açılış: eski ayar (bildirim alanları yok) çökmez; varsayılanlar gösterilir ve yükte aynen gider', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, ayarKaydetYaniti: sunucuUygula });
  assert.equal(sayfa.oge('bildirimKalici').checked, true);
  assert.equal(sayfa.oge('bildirimPil').checked, true);
  assert.equal(sayfa.oge('bildirimPilEsigi').value, '20');
  assert.equal(sayfa.oge('bildirimGuncelleme').checked, false);
  assert.equal(sayfa.oge('bildirimMasaustu').checked, true);
  assert.equal(kartlar(sayfa).length, 0);
  assert.equal(sayfa.oge('kuralBos').textContent, 'Henüz kural yok.');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.deepEqual(
    [yuk.bildirimKalici, yuk.bildirimPil, yuk.bildirimPilEsigi, yuk.bildirimGuncelleme, yuk.bildirimMasaustu, yuk.uyariKurallari],
    [true, true, '20', false, true, []],
  );
});

test('kayıt yükü: kutular ve eşik yükte gider; değiştirmek kirli yapar, geri almak temizler', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge('bildirimGuncelleme').tikla();
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('bildirimGuncelleme').tikla();
  assert.equal(kirliMi(sayfa), false);
  for (const kimlik of ['bildirimKalici', 'bildirimPil', 'bildirimMasaustu', 'bildirimGuncelleme']) sayfa.oge(kimlik).tikla();
  yaz(sayfa.oge('bildirimPilEsigi'), '35');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.deepEqual([yuk.bildirimKalici, yuk.bildirimPil, yuk.bildirimPilEsigi, yuk.bildirimGuncelleme, yuk.bildirimMasaustu], [false, false, '35', true, false]);
  assert.equal(sayfa.sunucu.bildirimPilEsigi, 35);
  assert.equal(kirliMi(sayfa), false, 'kaydedilince temiz');
  assert.match(sayfa.oge('genelBildirim').textContent, /^Ayarlar kaydedildi\./);
});

test('kural alanını değiştirmek kirli yapar, eşdeğer yazım ve geri alma temizler (virgüllü ondalık dahil)', async () => {
  const sayfa = await sayfaAc();
  const esik = alan(kartlar(sayfa)[0], n1('eşik değeri'));
  yaz(esik, '31');
  assert.equal(kirliMi(sayfa), true);
  yaz(esik, '30,5');
  assert.equal(kirliMi(sayfa), false, '30,5 = 30.5');
  yaz(esik, ' 30.50 ');
  assert.equal(kirliMi(sayfa), false);
  const windows = alan(kartlar(sayfa)[0], n1('Windows bildirimi'));
  windows.tikla();
  assert.equal(kirliMi(sayfa), true);
  windows.tikla();
  assert.equal(kirliMi(sayfa), false);
  yaz(alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 önceki durumu'), 'paused');
  assert.equal(kirliMi(sayfa), true);
});

// ---------------------------------------------------------------------------
// Kural ekleme, silme, tür değişimi
// ---------------------------------------------------------------------------

test('kural ekle: yeni satır açılır ve cihaz kutusuna odaklanır; doldurulup kaydedilince sunucu kimlik atar ve form sunucudan döner', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge('btnKuralEkle').tikla();
  const k = kartlar(sayfa);
  assert.equal(k.length, 4);
  assert.equal(sayfa.sonOdak(), alan(k[3], 'Uyarı kuralı 4 cihazı'), 'yeni satırın cihaz kutusu odaklanır');
  assert.equal(kirliMi(sayfa), true);
  yaz(alan(k[3], 'Uyarı kuralı 4 cihazı'), 'input_select.mod');
  sec(alan(k[3], 'Uyarı kuralı 4 koşulu'), 'durum');
  const yeni = kartlar(sayfa)[3];
  yaz(alan(yeni, 'Uyarı kuralı 4 durumu'), 'disarida');
  yaz(alan(yeni, 'Uyarı kuralı 4 cümlesi'), 'Ev modu değişti');
  yaz(alan(yeni, 'Uyarı kuralı 4 süresi'), '60');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).uyariKurallari[3], {
    id: '',
    acik: true,
    varlik: 'input_select.mod',
    kosul: { tur: 'durum', deger: 'disarida' },
    metin: 'Ev modu değişti',
    sure: 60,
    bekleme: 300,
    sessizSaatler: null,
    windows: false,
  });
  assert.equal(sayfa.sunucu.uyariKurallari.length, 4);
  assert.equal(sayfa.sunucu.uyariKurallari[3].id, 'u4');
  assert.equal(kartlar(sayfa).length, 4);
  assert.equal(alan(kartlar(sayfa)[3], 'Uyarı kuralı 4 durumu').value, 'disarida');
  assert.equal(kirliMi(sayfa), false);
});

test('kural sil: satır kalkar, kirli olur, Kural Ekle düğmesine odaklanır; kaydedilince yükte yoktur', async () => {
  const sayfa = await sayfaAc();
  const sil = kartlar(sayfa)[1].bul((o) => o.etiket === 'button' && o.attributes['aria-label'] === 'Uyarı kuralı 2 kuralını sil')[0];
  sil.tikla();
  assert.equal(kartlar(sayfa).length, 2);
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnKuralEkle'));
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).uyariKurallari.map((x) => x.id), ['u1', 'u3']);
  assert.equal(kirliMi(sayfa), false);
});

test('koşul türü değişince ilgili alanlar gelir ve gider; odak koşul kutusunda kalır; eski türün değeri yükte gitmez', async () => {
  const sayfa = await sayfaAc();
  const tur = alan(kartlar(sayfa)[0], n1('koşulu'));
  sec(tur, 'durum');
  let ilk = kartlar(sayfa)[0];
  assert.ok(alan(ilk, n1('durumu')), 'durum alanı geldi');
  assert.equal(alan(ilk, n1('eşik değeri')), undefined);
  assert.equal(alan(ilk, n1('yönü')), undefined);
  assert.equal(sayfa.sonOdak(), alan(ilk, n1('koşulu')));
  sec(alan(ilk, n1('koşulu')), 'gecis');
  ilk = kartlar(sayfa)[0];
  assert.ok(alan(ilk, n1('önceki durumu')) && alan(ilk, n1('yeni durumu')));
  sec(alan(ilk, n1('koşulu')), 'bilinmiyor');
  ilk = kartlar(sayfa)[0];
  assert.equal(alan(ilk, n1('durumu')), undefined);
  assert.equal(alan(ilk, n1('önceki durumu')), undefined);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).uyariKurallari[0].kosul, { tur: 'bilinmiyor' });
});

test('en çok 20 kural: 20. satırdan sonra Kural Ekle kapanır', async () => {
  const yirmi = Array.from({ length: 20 }, (_, i) => ({ ...KURAL_ULASILAMIYOR, id: `u${i + 1}` }));
  const sayfa = await sayfaAc({ ayar: { ...AYAR_B, uyariKurallari: yirmi } });
  assert.equal(kartlar(sayfa).length, 20);
  assert.equal(sayfa.oge('btnKuralEkle').disabled, true);
  kartlar(sayfa)[0].bul((o) => o.etiket === 'button')[0].tikla();
  assert.equal(sayfa.oge('btnKuralEkle').disabled, false);
});

test('sessiz saatler kutusu saat girdilerini açıp kapatır; kapalıyken yükte sessizSaatler null olur', async () => {
  const sayfa = await sayfaAc();
  const sessiz = alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 sessiz saatleri');
  const saatler = alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 sessiz saat başlangıcı');
  assert.equal(sessiz.checked, false);
  sessiz.tikla();
  assert.equal(kirliMi(sayfa), true);
  yaz(saatler, '23:30');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).uyariKurallari[1].sessizSaatler, { baslangic: '23:30', bitis: '07:00' });
  alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 sessiz saatleri').tikla();
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).uyariKurallari[1].sessizSaatler, null);
});

// ---------------------------------------------------------------------------
// Cihaz seçimi ve Kapı Kuralı
// ---------------------------------------------------------------------------

test('cihaz seçicisi yalnız uygun cihazları listeler; durum önerileri cihaza göre gelir ve cihaz değişince tazelenir', async () => {
  const sayfa = await sayfaAc();
  const secenekler = sayfa.oge('kuralVarliklari').children.map((o) => o.value);
  assert.deepEqual(secenekler.sort(), ['input_select.mod', 'media_player.salon', 'sensor.camasir_durumu', 'sensor.salon_sicaklik']);
  assert.ok(!secenekler.includes('button.pc_bilgisayari_kapat'), 'uygun olmayan alanlar seçicide yok');
  const oneriler = (kart) => kart.bul((o) => o.etiket === 'datalist')[0].children.map((o) => o.value);
  assert.deepEqual(oneriler(kartlar(sayfa)[1]), ['idle', 'playing', 'paused', 'off', 'on', 'unavailable', 'unknown']);
  const varlik = alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 cihazı');
  yaz(varlik, 'input_select.mod');
  assert.deepEqual(oneriler(kartlar(sayfa)[1]), ['evde', 'disarida', 'unavailable', 'unknown']);
  assert.equal(kartlar(sayfa)[1].bul((o) => o.className === 'kural-ad')[0].textContent, '▾ Ev Modu');
  assert.equal(alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 önceki durumu').attributes.list, kartlar(sayfa)[1].bul((o) => o.etiket === 'datalist')[0].id);
});

test('cihaz adı yazılıp kutudan çıkılınca tek eşleşen cihazın kimliğine çevrilir; belirsiz ad olduğu gibi kalır', async () => {
  const sayfa = await sayfaAc();
  const varlik = alan(kartlar(sayfa)[1], 'Uyarı kuralı 2 cihazı');
  sec(varlik, 'ev modu');
  assert.equal(varlik.value, 'input_select.mod');
  sec(varlik, 'Bilinmeyen Ad');
  assert.equal(varlik.value, 'Bilinmeyen Ad');
  assert.equal(kirliMi(sayfa), true);
});

test('Kapı Kuralı: listede olmayan (kilit, kapı vb.) ya da uygun olmayan cihaz seçilemez; kayıt hiç gönderilmez', async () => {
  for (const kimlik of ['lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'binary_sensor.kapi_sensoru', 'button.pc_bilgisayari_kapat', 'light.yok_boyle']) {
    const sayfa = await sayfaAc();
    yaz(alan(kartlar(sayfa)[0], n1('cihazı')), kimlik);
    await kaydet(sayfa);
    assert.equal(kayitSayisi(sayfa), 0, `${kimlik}: kayıt gönderilmemeli`);
    assert.equal(kartHatasi(kartlar(sayfa)[0]), 'Bu cihaz listede yok ya da kural kurulamaz.', kimlik);
    assert.ok(gecersizMi(alan(kartlar(sayfa)[0], n1('cihazı'))));
  }
});

test('kayıtlı kuralın cihazı Home Assistant’ta artık yoksa değiştirilmediği sürece kayıt engellenmez', async () => {
  const eski = { ...KURAL_ULASILAMIYOR, varlik: 'sensor.silinmis_cihaz' };
  const sayfa = await sayfaAc({ ayar: { ...AYAR_B, uyariKurallari: [eski] } });
  await kaydet(sayfa);
  assert.equal(kayitSayisi(sayfa), 1);
  assert.equal(sonYuk(sayfa).uyariKurallari[0].varlik, 'sensor.silinmis_cihaz');
});

test('cihaz listesi yüklenmeden (anahtar yok) Kural Ekle kapalıdır, "Cihaz listesini yükle" görünür; yükleyince açılır ve satır adları dolar', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_B, anahtarVar: false } });
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'cihazlariGetir'), false);
  assert.equal(sayfa.oge('btnKuralEkle').disabled, true);
  assert.equal(sayfa.oge('btnKuralCihazlar').style.display, 'inline-flex');
  assert.equal(sayfa.oge('kuralCihazIpucu').textContent, 'Yeni kural için önce cihaz listesi yüklenmeli.');
  assert.equal(kartlar(sayfa).length, 3, 'kayıtlı kurallar yine görünür');
  assert.equal(kartlar(sayfa)[0].bul((o) => o.className === 'kural-ad')[0].textContent, '');
  sayfa.oge('btnKuralCihazlar').tikla();
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length, 1);
  assert.equal(sayfa.oge('btnKuralEkle').disabled, false);
  assert.equal(sayfa.oge('btnKuralCihazlar').style.display, 'none');
  assert.equal(sayfa.oge('kuralCihazIpucu').textContent, '');
  assert.equal(kartlar(sayfa)[0].bul((o) => o.className === 'kural-ad')[0].textContent, '📈 Salon Sıcaklığı');
  assert.equal(sayfa.oge('kuralVarliklari').children.length, 4);
});

// ---------------------------------------------------------------------------
// Kayıt öncesi denetim
// ---------------------------------------------------------------------------

// [ad, kural sırası, bozucu, hatalı girdinin etiketi, beklenen ileti, düzeltici]
const DENETIMLER = [
  ['cihaz boş', 0, (k) => yaz(alan(k, n1('cihazı')), ''), n1('cihazı'), 'Listeden bir cihaz seç.', 'sensor.salon_sicaklik'],
  ['cihaz kimlik biçiminde değil', 0, (k) => yaz(alan(k, n1('cihazı')), 'Salon'), n1('cihazı'), 'Listeden bir cihaz seç.', 'sensor.salon_sicaklik'],
  ['eşik sayı değil', 0, (k) => yaz(alan(k, n1('eşik değeri')), 'abc'), n1('eşik değeri'), 'Eşik için bir sayı yaz.', '10'],
  ['eşik boş', 0, (k) => yaz(alan(k, n1('eşik değeri')), ''), n1('eşik değeri'), 'Eşik için bir sayı yaz.', '10'],
  ['eşik çok büyük', 0, (k) => yaz(alan(k, n1('eşik değeri')), '1e12'), n1('eşik değeri'), 'Eşik için bir sayı yaz.', '10'],
  ['süre negatif', 0, (k) => yaz(alan(k, n1('süresi')), '-1'), n1('süresi'), 'Süre 0 ile 86400 arasında bir tam sayı olmalı.', '5'],
  ['süre ondalık', 0, (k) => yaz(alan(k, n1('süresi')), '1.5'), n1('süresi'), 'Süre 0 ile 86400 arasında bir tam sayı olmalı.', '5'],
  ['süre çok büyük', 0, (k) => yaz(alan(k, n1('süresi')), '86401'), n1('süresi'), 'Süre 0 ile 86400 arasında bir tam sayı olmalı.', '5'],
  ['bekleme boş', 0, (k) => yaz(alan(k, n1('bekleme süresi')), ''), n1('bekleme süresi'), 'Bekleme 0 ile 86400 arasında bir tam sayı olmalı.', '5'],
  ['sessiz saatler aynı', 0, (k) => yaz(alan(k, n1('sessiz saat bitişi')), '22:00'), n1('sessiz saat başlangıcı'), 'Sessiz saatler için iki farklı saat seç.', '21:00'],
  ['sessiz saat boş', 0, (k) => yaz(alan(k, n1('sessiz saat başlangıcı')), ''), n1('sessiz saat başlangıcı'), 'Sessiz saatler için iki farklı saat seç.', '21:00'],
  ['cümle çok uzun', 0, (k) => yaz(alan(k, n1('cümlesi')), 'a'.repeat(101)), n1('cümlesi'), 'Cümle en çok 100 karakter olabilir.', 'kısa'],
];

for (const [ad, sira, bozucu, etiket, mesaj, duzeltme] of DENETIMLER) {
  test(`kayıt öncesi denetim: ${ad} → kayıt gitmez, satır işaretlenir, bölüm açılır, düzenleyince işaret kalkar`, async () => {
    const sayfa = await sayfaAc();
    bozucu(kartlar(sayfa)[sira]);
    await kaydet(sayfa);
    assert.equal(kayitSayisi(sayfa), 0);
    const kart = kartlar(sayfa)[sira];
    assert.equal(kartHatasi(kart), mesaj);
    const girdi = alan(kart, etiket);
    assert.ok(gecersizMi(girdi), 'hatalı girdi işaretli');
    assert.equal(sayfa.oge('bolumBildirimler').open, true);
    assert.equal(sayfa.oge('genelBildirim').textContent, 'Uyarı kurallarında düzeltilecek yerler var; kırmızı alanlara bak.');
    assert.match(sayfa.oge('genelBildirim').className, /bildirim-hata/);
    assert.equal(sayfa.oge('kuralHata').textContent, 'Uyarı kurallarında düzeltilecek yerler var; kırmızı alanlara bak.');
    assert.equal(sayfa.sonOdak(), girdi, 'ilk hatalı alana odaklanır');
    yaz(girdi, duzeltme);
    assert.equal(gecersizMi(girdi), false, 'düzenleyince işaret kalkar');
    assert.equal(kartHatasi(kartlar(sayfa)[sira]), '');
  });
}

test('kayıt öncesi denetim: boş durum ve geçiş çakışması', async () => {
  const bos = await sayfaAc();
  sec(alan(kartlar(bos)[2], 'Uyarı kuralı 3 koşulu'), 'durum');
  await kaydet(bos);
  assert.equal(kayitSayisi(bos), 0);
  assert.equal(kartHatasi(kartlar(bos)[2]), 'Bir durum yaz.');
  assert.ok(gecersizMi(alan(kartlar(bos)[2], 'Uyarı kuralı 3 durumu')));

  const gecis = await sayfaAc();
  yaz(alan(kartlar(gecis)[1], 'Uyarı kuralı 2 yeni durumu'), 'playing');
  await kaydet(gecis);
  assert.equal(kayitSayisi(gecis), 0);
  assert.equal(kartHatasi(kartlar(gecis)[1]), 'Önceki ve yeni durum aynı olamaz.');
});

test('pil eşiği 5-50 tam sayı olmalı; geçersizse kayıt gitmez ve alan işaretlenir; geçerli değer yükte gider', async () => {
  for (const kotu of ['', 'abc', '4', '51', '20.5', '-3']) {
    const sayfa = await sayfaAc();
    yaz(sayfa.oge('bildirimPilEsigi'), kotu);
    await kaydet(sayfa);
    assert.equal(kayitSayisi(sayfa), 0, `"${kotu}" kaydedilmemeli`);
    assert.ok(gecersizMi(sayfa.oge('bildirimPilEsigi')));
    assert.equal(sayfa.oge('bildirimPilEsigiHata').textContent, 'Eşik 5 ile 50 arasında bir tam sayı olmalı.');
    assert.equal(sayfa.oge('bolumBildirimler').open, true);
    assert.equal(sayfa.sonOdak(), sayfa.oge('bildirimPilEsigi'));
    yaz(sayfa.oge('bildirimPilEsigi'), '25');
    assert.equal(gecersizMi(sayfa.oge('bildirimPilEsigi')), false, 'yazınca işaret kalkar');
  }
  const gecerli = await sayfaAc();
  for (const iyi of ['5', '50', ' 30 ']) {
    yaz(gecerli.oge('bildirimPilEsigi'), iyi);
    await kaydet(gecerli);
    assert.equal(sonYuk(gecerli).bildirimPilEsigi, iyi.trim());
  }
});

test('sunucu pil eşiğini reddederse yazılan değer kalır, alan işaretlenir ve kaydedilmemiş sayılır', async () => {
  const sayfa = await sayfaAc({
    ayarKaydetYaniti: () => ({ ok: true, uyarilar: [{ alan: 'bildirimPilEsigi', mesaj: 'Bu ayarın değeri geçersiz; önceki değer korundu.' }] }),
  });
  yaz(sayfa.oge('bildirimPilEsigi'), '30');
  await kaydet(sayfa);
  assert.equal(sayfa.oge('bildirimPilEsigi').value, '30', 'yazılan değer silinmez');
  assert.ok(gecersizMi(sayfa.oge('bildirimPilEsigi')));
  assert.equal(sayfa.oge('bildirimPilEsigiHata').textContent, 'Bu ayarın değeri geçersiz; önceki değer korundu.');
  assert.equal(kirliMi(sayfa), true);
});

test('sunucu bir kuralı düşürürse (güvenlik kuralı) yazılanlar silinmez, kaç kuralın kaydedilmediği söylenir ve kirli kalır', async () => {
  const sayfa = await sayfaAc();
  yaz(alan(kartlar(sayfa)[2], 'Uyarı kuralı 3 cümlesi'), 'Ön kapı açıldı');
  await kaydet(sayfa);
  assert.equal(kayitSayisi(sayfa), 1, 'renderer cümledeki kapı sözcüğünü bilmez; sunucu düşürür');
  assert.equal(sayfa.sunucu.uyariKurallari.length, 2);
  assert.equal(kartlar(sayfa).length, 3, 'form yazılanla kalır');
  assert.equal(alan(kartlar(sayfa)[2], 'Uyarı kuralı 3 cümlesi').value, 'Ön kapı açıldı');
  assert.match(sayfa.oge('genelBildirim').textContent, /1 uyarı kuralı kaydedilmedi/);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
  assert.equal(kirliMi(sayfa), true);
  // düzeltip kaydedince tamam
  yaz(alan(kartlar(sayfa)[2], 'Uyarı kuralı 3 cümlesi'), 'Sensör gitti');
  await kaydet(sayfa);
  assert.equal(sayfa.sunucu.uyariKurallari.length, 3);
  assert.equal(kirliMi(sayfa), false);
});

// ---------------------------------------------------------------------------
// Güvenlik: metinler, dil, kaynak
// ---------------------------------------------------------------------------

test('zararlı cihaz adı ve kural cümlesi yalnız textContent / value olarak yazılır; etiket çocuğu oluşmaz', async () => {
  const kotu = '<img src=x onerror=alert(1)>';
  const cihazlar = { ...CIHAZLAR_B, cihazlar: [uygunCihaz('sensor.salon_sicaklik', kotu, 'sensor', [kotu, 'unknown'], '<b>'), ...CIHAZLAR_B.cihazlar.slice(0, 2)] };
  const sayfa = await sayfaAc({ cihazlar, ayar: { ...AYAR_B, uyariKurallari: [{ ...KURAL_ESIK, metin: kotu }] } });
  const kart = kartlar(sayfa)[0];
  assert.equal(kart.bul((o) => o.className === 'kural-ad')[0].textContent, '<b> ' + kotu);
  assert.equal(alan(kart, n1('cümlesi')).value, kotu);
  assert.equal(kart.bul((o) => o.etiket === 'img' || o.etiket === 'b').length, 0);
  assert.equal(sayfa.oge('kuralVarliklari').children[0].textContent, kotu);
});

const gorunurTopla = (oge, sonuc = []) => {
  if (oge._metin) sonuc.push(oge._metin);
  for (const ad of ['aria-label', 'placeholder', 'title']) if (oge.attributes[ad]) sonuc.push(oge.attributes[ad]);
  if (oge.placeholder) sonuc.push(oge.placeholder);
  oge.children.forEach((c) => gorunurTopla(c, sonuc));
  return sonuc;
};

test('dil en: bölümün sabit ve dinamik metinleri İngilizce; Türkçe harf kalmaz; dil çalışma anında değişince satırlar yeniden yazılır', async () => {
  const cihazlar = {
    ...CIHAZLAR_B,
    cihazlar: CIHAZLAR_B.cihazlar.filter((c) => !c.uyariUygun).concat([uygunCihaz('sensor.salon_sicaklik', 'Living Room Temperature', 'sensor', ['unavailable', 'unknown'], '📈')]),
  };
  const kural = { ...KURAL_ESIK, metin: '{ad} is {durum}' };
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR_B, dil: 'en', dilAyari: 'en', sistemDili: 'en', favoriler: [], uyariKurallari: [kural] },
    cihazlar,
    ayarKaydetYaniti: sunucuUygula,
  });
  const baslik = sayfa.ceviriOgeleri.find((o) => o.getAttribute('data-i18n') === 'ayar.bm.baslik');
  assert.equal(baslik.textContent, 'Notification center and alert rules');
  assert.equal(sayfa.oge('btnKuralEkle').textContent, 'Add Rule');
  for (const oge of sayfa.ceviriOgeleri) {
    const anahtar = oge.getAttribute('data-i18n');
    if (anahtar && (anahtar.startsWith('ayar.bm.') || anahtar.startsWith('ayar.kural.'))) assert.equal(oge.textContent, AYARLAR.en[anahtar], anahtar);
  }
  const kart = kartlar(sayfa)[0];
  assert.ok(alan(kart, 'Condition of alert rule 1'));
  assert.equal(alan(kart, 'Condition of alert rule 1').children[2].textContent, 'When the number crosses a threshold');
  assert.equal(alan(kart, 'Direction of alert rule 1').children[0].textContent, 'When the value rises above the threshold');
  assert.ok(alan(kart, 'Quiet hours of alert rule 1'));
  const gorunen = gorunurTopla(sayfa.oge('kuralListesi'));
  assert.ok(gorunen.length > 20);
  assert.deepEqual(gorunen.filter((m) => /[çğıöşüÇĞİÖŞÜ]/.test(m)), [], 'satırlarda Türkçe harfli görünür metin yok');

  // çalışma anında Türkçe'ye dönüş: satır etiketleri yeni dilde, form değerleri korunur
  yaz(alan(kart, 'Sentence of alert rule 1'), '{ad} oldu');
  await sayfa.dilDegisti('tr');
  const trKart = kartlar(sayfa)[0];
  assert.ok(alan(trKart, n1('koşulu')), 'etiketler Türkçe');
  assert.equal(alan(trKart, n1('cümlesi')).value, '{ad} oldu', 'yazılan değer dil değişince kaybolmaz');
  assert.equal(sayfa.oge('btnKuralEkle').textContent, 'Kural Ekle');
});

test('bildirim bölümü HTML ve betik: yalnız yeni kimlikler, innerHTML yok, kimlik çakışması yok, bölüm kapalı katlanır ve "Geri bildirim" sonrasında', () => {
  assert.doesNotMatch(BETIK, /innerHTML|outerHTML|insertAdjacentHTML/);
  const idler = [...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(idler).size, idler.length, 'yinelenen kimlik yok');
  const bolum = HTML.slice(HTML.indexOf('id="bolumBildirimler"'), HTML.indexOf('id="bolumBaslangic"'));
  assert.match(HTML, /<details class="bolum" id="bolumBildirimler">/, 'katlanabilir ve varsayılan kapalı');
  assert.ok(HTML.indexOf('id="bolumGeriBildirim"') < HTML.indexOf('id="bolumBildirimler"'));
  for (const kimlik of ['bildirimKalici', 'bildirimPil', 'bildirimPilEsigi', 'bildirimGuncelleme', 'bildirimMasaustu', 'kuralListesi', 'btnKuralEkle', 'btnKuralCihazlar', 'kuralVarliklari']) {
    assert.match(bolum, new RegExp(`id="${kimlik}"`), kimlik);
  }
  assert.match(bolum, /<label for="bildirimPilEsigi"/, 'eşik kutusunun etiketi var');
  assert.match(bolum, /role="alert"/, 'kural hata kutusu duyurulur');
  assert.doesNotMatch(bolum, /<script|onclick=|onerror=/i);
});

test('sözlük: bölümün Türkçe metinlerinde "siz" hitabı ve düz kesme işareti yok; İngilizcede Türkçe harf yok', () => {
  const anahtarlar = Object.keys(AYARLAR.tr).filter((k) => k.startsWith('ayar.bm.') || k.startsWith('ayar.kural.'));
  assert.ok(anahtarlar.length >= 60, `bölüm anahtarları bulundu (${anahtarlar.length})`);
  for (const k of anahtarlar) {
    assert.doesNotMatch(AYARLAR.tr[k], /'/, `${k}: düz kesme işareti`);
    assert.doesNotMatch(AYARLAR.tr[k], /(?<![\p{L}])(?:siz|sizin|sizi)(?![\p{L}])|[\p{L}]*(?:ınız|iniz|unuz|ünüz)(?![\p{L}])/iu, `${k}: siz hitabı`);
    assert.doesNotMatch(AYARLAR.en[k], /[çğıöşüÇĞİÖŞÜ]/, `${k}: İngilizcede Türkçe harf`);
  }
});

test('ana süreç sözleşmesi: ayar alanları tablosu bu bölümün gönderdiği alanları kabul eder (adlar ve tipler)', () => {
  const { alanTipleri } = require('../src/lib/ayar-alanlari');
  const tipler = alanTipleri();
  const metin = fs.readFileSync(path.join(KOK, 'src', 'ayarlar.js'), 'utf8');
  const gonderilen = ['bildirimKalici', 'bildirimPil', 'bildirimPilEsigi', 'bildirimGuncelleme', 'bildirimMasaustu', 'uyariKurallari'];
  for (const ad of gonderilen) {
    assert.ok(Object.hasOwn(tipler, ad), `${ad}: ayar-alanlari.js tablosunda yok`);
    assert.match(metin, new RegExp(`${ad}: a\\.${ad}`), `${ad}: genelYuku göndermiyor`);
  }
});
