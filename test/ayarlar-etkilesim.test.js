'use strict';

/**
 * Ayarlar penceresinin 1.4.0 etkileşim denetimleri (src/ayarlar.html + src/ayarlar.js; sahte DOM: test/ayarlar-sahte.js):
 *  - o-20 "Fare tekerleği" ve "Tepsi simgesine orta tık" seçicisi (yalnız zararsız, onaysız, bulunan favoriler),
 *  - o-23 "Paneli sabitle" (yalnız DEĞİŞTİRİLDİYSE yükte gider),
 *  - o-60 "Kısayolu basılı tutunca göster" (varsayılan kapalı),
 *  - o-38 "Home Assistant koptu / geri geldi" bildirimi ve bekleme süresi (15-600 sn),
 *  - o-43 yönetici anahtarı uyarısı (anahtarYonetici özeti ve 'ayarlar:anahtar-yonetici' olayı).
 * Ana süreç tarafı test/ana-surec.test.js ve test/etkilesim-*.test.js içindedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const AYARLAR_SOZLUK = require('../src/lib/ceviri/ayarlar');
const { HTML, AYAR, CIHAZLAR, akit, duzles, acilmisSayfa } = require('./ayarlar-sahte');

const KIMLIKLER = ['kisayolBasiliTut', 'panelSabit', 'karoTekerlegi', 'tepsiOrtaTik', 'baglantiBildirimi', 'baglantiBildirimSn', 'baglantiBildirimSnHata', 'anahtarYoneticiUyari', 'anahtarYoneticiDegil'];
const DILLER = ['tr', 'en', 'de', 'fr', 'es'];
const ORTA_TIK_ALANLARI = ['light', 'switch', 'fan', 'input_boolean', 'scene', 'script', 'button', 'input_button', 'humidifier'];

/** AYAR + kapı kuralı/onay sınır örnekleri: zararsız ışık, onaysız düğme, onay zorunlu düğme ve (varsayılan onaylı) script. */
const AYAR_E = {
  ...AYAR,
  favoriler: [
    ...AYAR.favoriler,
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat' },
    { entity_id: 'script.kendi_scriptim', ad: 'Kendi Scriptim' },
  ],
  ortaTikAlanlari: ORTA_TIK_ALANLARI,
};
const CIHAZLAR_E = {
  ...CIHAZLAR,
  cihazlar: [
    ...CIHAZLAR.cihazlar,
  ],
};

const sayfaAc = (ayar = {}, ek = {}) => acilmisSayfa({ ayar: { ...AYAR_E, ...ayar }, cihazlar: CIHAZLAR_E, ...ek });
const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const kayitSayisi = (sayfa) => sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').length;
const sonYuk = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display === 'inline';
const secenekler = (sayfa) => sayfa.oge('tepsiOrtaTik').children.map((o) => [o.value, o.textContent]);
const secenekDegerleri = (sayfa) => secenekler(sayfa).map(([deger]) => deger);
const isaretle = (sayfa, kimlik, deger) => {
  const oge = sayfa.oge(kimlik);
  oge.checked = deger;
  oge.dispatchEvent({ type: 'change' });
};
const yaz = (sayfa, kimlik, deger) => {
  const oge = sayfa.oge(kimlik);
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const gorunur = (oge) => oge.style.display === 'block';

// --- HTML ve açılış -------------------------------------------------------------------------------------------------

test('HTML: yeni denetimlerin hepsi var; sayısal alan 15-600, yapılandırma yalnız yerel kimlik ve etiketlerle (satır içi betik yok)', () => {
  for (const kimlik of KIMLIKLER) assert.match(HTML, new RegExp(`id="${kimlik}"`), kimlik);
  assert.match(HTML, /id="baglantiBildirimSn"[^>]*min="15"[^>]*max="600"/);
  assert.match(HTML, /<select id="tepsiOrtaTik"/);
  assert.match(HTML, /<input type="checkbox" id="panelSabit">/);
  for (const kimlik of ['kisayolBasiliTut', 'panelSabit', 'karoTekerlegi', 'baglantiBildirimi']) {
    assert.doesNotMatch(HTML, new RegExp(`id="${kimlik}"[^>]*\\bchecked\\b`), `${kimlik} HTML'de işaretli gelmez; varsayılan ayar tablosundan`);
  }
  assert.doesNotMatch(HTML, /\son(click|change|input)=/i);
});

test('açılış: varsayılanlar — tekerlek ve bağlantı bildirimi AÇIK, sabitleme ve basılı tut KAPALI, bekleme 60 sn, orta tık "hiçbir şey"; yönetici notları gizli', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge('karoTekerlegi').checked, true);
  assert.equal(sayfa.oge('baglantiBildirimi').checked, true);
  assert.equal(sayfa.oge('panelSabit').checked, false);
  assert.equal(sayfa.oge('kisayolBasiliTut').checked, false);
  assert.equal(sayfa.oge('baglantiBildirimSn').value, '60');
  assert.equal(sayfa.oge('tepsiOrtaTik').value, '');
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none');
  assert.equal(sayfa.oge('anahtarYoneticiDegil').style.display, 'none');
  assert.equal(kirliMi(sayfa), false, 'açılışta kaydedilmemiş değişiklik yok');
});

test('açılış: kayıtlı değerler alanlara yazılır', async () => {
  const sayfa = await sayfaAc({
    kisayolBasiliTut: true,
    panelSabit: true,
    karoTekerlegi: false,
    baglantiBildirimi: false,
    baglantiBildirimSn: 120,
    tepsiOrtaTik: 'light.salon_lambasi',
  });
  assert.equal(sayfa.oge('kisayolBasiliTut').checked, true);
  assert.equal(sayfa.oge('panelSabit').checked, true);
  assert.equal(sayfa.oge('karoTekerlegi').checked, false);
  assert.equal(sayfa.oge('baglantiBildirimi').checked, false);
  assert.equal(sayfa.oge('baglantiBildirimSn').value, '120');
  assert.equal(sayfa.oge('tepsiOrtaTik').value, 'light.salon_lambasi');
  assert.equal(kirliMi(sayfa), false);
});

test('açılış: eski ana süreç (yeni alanlar hiç yok) çökmez, varsayılanlar gösterilir; bozuk değerler varsayılana düşer', async () => {
  const eski = { ...AYAR };
  const sayfa = await acilmisSayfa({ ayar: eski, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('karoTekerlegi').checked, true);
  assert.equal(sayfa.oge('baglantiBildirimSn').value, '60');
  assert.equal(sayfa.oge('tepsiOrtaTik').value, '');
  const bozuk = await sayfaAc({ baglantiBildirimSn: 'x', tepsiOrtaTik: 5, panelSabit: 'evet', karoTekerlegi: null });
  assert.equal(bozuk.oge('baglantiBildirimSn').value, '60');
  assert.equal(bozuk.oge('tepsiOrtaTik').value, '');
  assert.equal(bozuk.oge('panelSabit').checked, false);
  assert.equal(bozuk.oge('karoTekerlegi').checked, true);
});

// --- kirli durum ve kayıt yükü ---------------------------------------------------------------------------------------

test('kirli durum: her denetim değişince "kaydedilmemiş" göstergesi çıkar, değer geri alınınca söner', async () => {
  const sayfa = await sayfaAc();
  for (const kimlik of ['kisayolBasiliTut', 'panelSabit', 'karoTekerlegi', 'baglantiBildirimi']) {
    const ilk = sayfa.oge(kimlik).checked;
    isaretle(sayfa, kimlik, !ilk);
    assert.equal(kirliMi(sayfa), true, `${kimlik} değişti`);
    isaretle(sayfa, kimlik, ilk);
    assert.equal(kirliMi(sayfa), false, `${kimlik} geri alındı`);
  }
  yaz(sayfa, 'baglantiBildirimSn', '90');
  assert.equal(kirliMi(sayfa), true);
  yaz(sayfa, 'baglantiBildirimSn', '60');
  assert.equal(kirliMi(sayfa), false);
  const sec = sayfa.oge('tepsiOrtaTik');
  sec.value = 'light.salon_lambasi';
  sec.dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  sec.value = '';
  sec.dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), false);
});

test('kayıt yükü: etkileşim alanları gider (sayı metin olarak, ana süreç doğrular); değişmeyen panelSabit yükte YOK', async () => {
  const sayfa = await sayfaAc();
  isaretle(sayfa, 'kisayolBasiliTut', true);
  isaretle(sayfa, 'karoTekerlegi', false);
  isaretle(sayfa, 'baglantiBildirimi', false);
  yaz(sayfa, 'baglantiBildirimSn', ' 150 ');
  const sec = sayfa.oge('tepsiOrtaTik');
  sec.value = 'button.pc_ekran_kapat';
  sec.dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.equal(yuk.kisayolBasiliTut, true);
  assert.equal(yuk.karoTekerlegi, false);
  assert.equal(yuk.baglantiBildirimi, false);
  assert.equal(yuk.baglantiBildirimSn, '150', 'kırpılmış metin');
  assert.equal(yuk.tepsiOrtaTik, 'button.pc_ekran_kapat');
  assert.equal('panelSabit' in yuk, false, 'panelSabit değişmedi: panelin iğne düğmesiyle yapılan değişikliği eski form ezmesin');
  assert.equal(sayfa.sunucu.baglantiBildirimSn, 150);
  assert.equal(sayfa.sunucu.tepsiOrtaTik, 'button.pc_ekran_kapat');
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra gösterge söner');
});

test('kayıt yükü: panelSabit YALNIZ Ayarlar\'da değiştirildiyse gider ve ayar kalıcı olur; kayıttan sonra yeniden değişmeden gönderilmez', async () => {
  const sayfa = await sayfaAc();
  isaretle(sayfa, 'panelSabit', true);
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).panelSabit, true);
  assert.equal(sayfa.sunucu.panelSabit, true);
  isaretle(sayfa, 'karoTekerlegi', false);
  await kaydet(sayfa);
  assert.equal('panelSabit' in sonYuk(sayfa), false, 'ikinci kayıtta panelSabit değişmedi');
  isaretle(sayfa, 'panelSabit', false);
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).panelSabit, false);
  assert.equal(sayfa.sunucu.panelSabit, false);
});

test('kayıt yükü: kayıtlı sabitleme açıkken ve Ayarlar\'da dokunulmadıysa panelSabit gönderilmez (yalnız başka alan değişir)', async () => {
  const sayfa = await sayfaAc({ panelSabit: true });
  isaretle(sayfa, 'kisayolBasiliTut', true);
  await kaydet(sayfa);
  assert.equal('panelSabit' in sonYuk(sayfa), false);
  assert.equal(sayfa.sunucu.panelSabit, true, 'sunucudaki değer korunur');
});

// --- bağlantı bildirimi bekleme süresi -----------------------------------------------------------------------------------

test('bekleme süresi: sınır dışı, kesirli ve sayı olmayan değer kaydı DURDURUR, alan işaretlenir ve hata metni yazılır; yazınca işaret kalkar', async () => {
  const sayfa = await sayfaAc();
  const gecersizleri = ['14', '601', '0', '-60', '1.5', 'abc', '', '  ', '1e2', '99999'];
  for (const kotu of gecersizleri) {
    yaz(sayfa, 'baglantiBildirimSn', kotu);
    await kaydet(sayfa);
    assert.equal(kayitSayisi(sayfa), 0, `"${kotu}" ile kayıt yapılmadı`);
    assert.equal(sayfa.oge('baglantiBildirimSn').classList.contains('gecersiz'), true, `"${kotu}" işaretlendi`);
    assert.equal(sayfa.oge('baglantiBildirimSn').attributes['aria-invalid'], 'true');
    assert.match(sayfa.oge('baglantiBildirimSnHata').textContent, /15/);
    assert.match(sayfa.oge('baglantiBildirimSnHata').textContent, /600/);
    yaz(sayfa, 'baglantiBildirimSn', '45');
    assert.equal(sayfa.oge('baglantiBildirimSn').classList.contains('gecersiz'), false, 'yazınca işaret kalktı');
  }
  yaz(sayfa, 'baglantiBildirimSn', '15');
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).baglantiBildirimSn, '15');
  yaz(sayfa, 'baglantiBildirimSn', '600');
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).baglantiBildirimSn, '600');
  assert.equal(kayitSayisi(sayfa), 2);
});

test('bekleme süresi: sunucu değeri reddederse (uyarı) yazılan değer silinmez ve alan işaretli kalır', async () => {
  const sayfa = await sayfaAc({}, {
    ayarKaydetYaniti: () => ({ ok: true, uyarilar: [{ alan: 'baglantiBildirimSn', mesaj: 'Geçersiz değer' }] }),
  });
  yaz(sayfa, 'baglantiBildirimSn', '77');
  await kaydet(sayfa);
  assert.equal(sayfa.oge('baglantiBildirimSn').value, '77', 'yazılan değer korunur');
});

// --- orta tık seçicisi -------------------------------------------------------------------------------------------------

test('orta tık seçicisi: yalnız seçili, onay istemeyen, bulunan, zararsız alandaki favoriler (onaylı düğme/script, eksik ve engelli favori YOK)', async () => {
  const sayfa = await sayfaAc();
  assert.deepEqual(secenekDegerleri(sayfa), ['', 'light.salon_lambasi', 'button.pc_ekran_kapat']);
  assert.equal(secenekler(sayfa)[0][1], 'Hiçbir şey yapma');
  assert.equal(secenekler(sayfa)[1][1], 'Salon Lambası', 'görünen ad (textContent)');
  const degerler = secenekDegerleri(sayfa);
  for (const olmamali of ['button.pc_bilgisayari_kapat', 'script.kendi_scriptim', 'light.eski_lamba', 'light.koridor']) {
    assert.equal(degerler.includes(olmamali), false, olmamali);
  }
});

test('orta tık seçicisi: alanlar ana sürecin listesinden gelir (ayar özeti ortaTikAlanlari); dışındaki alan listelenmez', async () => {
  const sayfa = await sayfaAc({ ortaTikAlanlari: ['light'] });
  assert.deepEqual(secenekDegerleri(sayfa), ['', 'light.salon_lambasi']);
  const bos = await sayfaAc({ ortaTikAlanlari: [] });
  assert.deepEqual(secenekDegerleri(bos), ['']);
});

test('orta tık seçicisi: kapı/kilit/alarm/sirene/kepenk/garaj/klima/medya alanı ya da onay zorunlu olan, ana süreç listesinde olsa da aday olmaz', async () => {
  const ayar = {
    ...AYAR_E,
    favoriler: [
      { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
      { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' },
      { entity_id: 'cover.garaj', ad: 'Garaj' },
      { entity_id: 'climate.oda', ad: 'Oda' },
      { entity_id: 'media_player.tv', ad: 'TV' },
      { entity_id: 'camera.bahce', ad: 'Bahçe' },
      { entity_id: 'valve.su', ad: 'Su' },
      { entity_id: 'automation.gece', ad: 'Gece' },
    ],
  };
  const cihazlar = {
    ok: true,
    cihazlar: [
      { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light', alanEtiketi: 'Işıklar', durum: 'açık', onayZorunlu: false, varsayilanOnay: false },
      { entity_id: 'cover.garaj', ad: 'Garaj', alan: 'cover', alanEtiketi: 'Kapaklar', durum: '', onayZorunlu: false, varsayilanOnay: false },
      { entity_id: 'climate.oda', ad: 'Oda', alan: 'climate', alanEtiketi: 'İklim', durum: '', onayZorunlu: false, varsayilanOnay: false, tekTiklama: false },
      { entity_id: 'media_player.tv', ad: 'TV', alan: 'media_player', alanEtiketi: 'Medya', durum: '', onayZorunlu: false, varsayilanOnay: false, tekTiklama: false },
      { entity_id: 'valve.su', ad: 'Su', alan: 'valve', alanEtiketi: 'Vanalar', durum: '', onayZorunlu: true, varsayilanOnay: true },
      { entity_id: 'automation.gece', ad: 'Gece', alan: 'automation', alanEtiketi: 'Otomasyonlar', durum: '', onayZorunlu: true, varsayilanOnay: true },
    ],
    eksik: [],
    engelli: [],
  };
  const sayfa = await acilmisSayfa({ ayar, cihazlar });
  assert.deepEqual(secenekDegerleri(sayfa), ['', 'light.salon_lambasi']);
  // Ana süreç listesine bozuk biçimde alan eklense bile tekil tıklama eylemi olmayan (climate/media) ve onaylı olanlar elenir.
  const gevsek = await acilmisSayfa({ ayar: { ...ayar, ortaTikAlanlari: ['light', 'cover', 'climate', 'media_player', 'valve', 'automation'] }, cihazlar });
  const degerler = secenekDegerleri(gevsek);
  assert.equal(degerler.includes('climate.oda'), false);
  assert.equal(degerler.includes('media_player.tv'), false);
  assert.equal(degerler.includes('valve.su'), false);
  assert.equal(degerler.includes('automation.gece'), false);
});

test('orta tık seçicisi: kayıtlı seçim artık uygun değilse silinmez; "artık uygun değil" notuyla listede kalır ve kaydedince aynen gider', async () => {
  const sayfa = await sayfaAc({ tepsiOrtaTik: 'switch.eski_priz' });
  const secim = secenekler(sayfa).find(([deger]) => deger === 'switch.eski_priz');
  assert.ok(secim, 'kayıtlı seçim listede');
  assert.match(secim[1], /artık uygun değil/);
  assert.equal(sayfa.oge('tepsiOrtaTik').value, 'switch.eski_priz');
  assert.equal(kirliMi(sayfa), false);
  isaretle(sayfa, 'karoTekerlegi', false);
  await kaydet(sayfa);
  assert.equal(sonYuk(sayfa).tepsiOrtaTik, 'switch.eski_priz');
});

test('orta tık seçicisi: favori eksilince / eklenince liste güncellenir; seçili favori listeden çıkarılırsa seçim "artık uygun değil" olur, sessizce silinmez', async () => {
  const sayfa = await sayfaAc({ tepsiOrtaTik: 'button.pc_ekran_kapat' });
  assert.equal(sayfa.oge('tepsiOrtaTik').value, 'button.pc_ekran_kapat');
  // favori satırından seçimi kaldır
  const satir = sayfa.oge('cihazListesi').bul((o) => o.className.includes('cihaz-satir')).find((s) => s.bul((o) => o.className === 'cihaz-kimlik')[0].textContent === 'button.pc_ekran_kapat');
  const kutu = satir.bul((o) => o.etiket === 'input' && o.type === 'checkbox')[0];
  kutu.tikla();
  await akit();
  assert.equal(sayfa.oge('tepsiOrtaTik').value, 'button.pc_ekran_kapat', 'seçim korunur');
  const secim = secenekler(sayfa).find(([deger]) => deger === 'button.pc_ekran_kapat');
  assert.match(secim[1], /artık uygun değil/);
  kutu.tikla();
  await akit();
  assert.doesNotMatch(secenekler(sayfa).find(([deger]) => deger === 'button.pc_ekran_kapat')[1], /artık uygun değil/, 'yeniden seçilince normal ad');
});

test('orta tık seçicisi: seçenek metinleri yalnız textContent ile yazılır (zararlı ad etiket olmaz)', async () => {
  const kotuAd = '<img src=x onerror=alert(1)>';
  const sayfa = await sayfaAc({}, {
    cihazlar: { ...CIHAZLAR_E, cihazlar: CIHAZLAR_E.cihazlar.map((c) => (c.entity_id === 'light.salon_lambasi' ? { ...c, ad: kotuAd } : c)) },
  });
  const secim = secenekler(sayfa).find(([deger]) => deger === 'light.salon_lambasi');
  assert.ok(secim);
  assert.ok(secim[1].includes('<img'), 'metin düz metin olarak durur');
  assert.equal(sayfa.oge('tepsiOrtaTik').children.every((o) => o.children.length === 0), true, 'alt öğe (etiket) üretilmedi');
});

// --- yönetici anahtarı uyarısı (o-43) ---------------------------------------------------------------------------------

test('yönetici anahtarı: true = uyarı ve öneri görünür, olumlu not gizli; false = olumlu not; null/yok = ikisi de gizli', async () => {
  const yonetici = await sayfaAc({ anahtarYonetici: true });
  assert.equal(gorunur(yonetici.oge('anahtarYoneticiUyari')), true);
  assert.equal(yonetici.oge('anahtarYoneticiDegil').style.display, 'none');
  const degil = await sayfaAc({ anahtarYonetici: false });
  assert.equal(degil.oge('anahtarYoneticiUyari').style.display, 'none');
  assert.equal(gorunur(degil.oge('anahtarYoneticiDegil')), true);
  for (const bilinmeyen of [null, undefined, 'evet', 1]) {
    const sayfa = await sayfaAc({ anahtarYonetici: bilinmeyen });
    assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none', String(bilinmeyen));
    assert.equal(sayfa.oge('anahtarYoneticiDegil').style.display, 'none', String(bilinmeyen));
  }
});

test('yönetici anahtarı: anahtar yokken, Home Assistant reddettiyse ya da yetki sorunu varken uyarı gösterilmez (yanlış yönlendirme olmasın)', async () => {
  const yok = await sayfaAc({ anahtarYonetici: true, anahtarVar: false });
  assert.equal(yok.oge('anahtarYoneticiUyari').style.display, 'none');
  const reddedildi = await sayfaAc({ anahtarYonetici: true, anahtarReddedildi: true });
  assert.equal(reddedildi.oge('anahtarYoneticiUyari').style.display, 'none');
  for (const durum of ['dogrulanamadi', 'kayit-onayi', 'yerel-yasak']) {
    const yetki = await sayfaAc({ anahtarYonetici: true, yetkiDurumu: durum });
    assert.equal(yetki.oge('anahtarYoneticiUyari').style.display, 'none', durum);
    const olumlu = await sayfaAc({ anahtarYonetici: false, yetkiDurumu: durum });
    assert.equal(olumlu.oge('anahtarYoneticiDegil').style.display, 'none', durum);
  }
});

test('yönetici anahtarı: uyarı metni öneriyi söyler (yönetici olmayan kullanıcı + yeni uzun ömürlü anahtar) ve 5 dilde de vardır', () => {
  for (const dil of DILLER) {
    for (const anahtar of ['ayar.etk.yoneticiUyari', 'ayar.etk.yoneticiDegil']) {
      assert.ok(typeof AYARLAR_SOZLUK[dil][anahtar] === 'string' && AYARLAR_SOZLUK[dil][anahtar].length > 20, `${dil} ${anahtar}`);
    }
  }
  assert.match(AYARLAR_SOZLUK.tr['ayar.etk.yoneticiUyari'], /yönetici olmayan/);
  assert.match(AYARLAR_SOZLUK.en['ayar.etk.yoneticiUyari'], /non-admin/i);
});

test('yönetici anahtarı: "ayarlar:anahtar-yonetici" olayı uyarıyı anında günceller; null unutturur; bozuk yük güvenle yok sayılır', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none');
  await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: true });
  assert.equal(gorunur(sayfa.oge('anahtarYoneticiUyari')), true);
  assert.equal(sayfa.oge('anahtarYoneticiDegil').style.display, 'none');
  await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: false });
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none');
  assert.equal(gorunur(sayfa.oge('anahtarYoneticiDegil')), true);
  await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: null });
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none');
  assert.equal(sayfa.oge('anahtarYoneticiDegil').style.display, 'none');
  for (const bozuk of [undefined, null, 'x', 5, {}, { anahtarYonetici: 'true' }, []]) {
    await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: true });
    await sayfa.anahtarYoneticiOlayi(bozuk);
    assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none', `bozuk yük: ${JSON.stringify(bozuk)}`);
    assert.equal(sayfa.oge('anahtarYoneticiDegil').style.display, 'none');
  }
});

test('yönetici anahtarı: anahtar silinince uyarı kalkar ve olay anahtar yokken uyarı çıkarmaz', async () => {
  const sayfa = await sayfaAc({ anahtarYonetici: true });
  assert.equal(gorunur(sayfa.oge('anahtarYoneticiUyari')), true);
  sayfa.oge('btnAnahtarSil').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none', 'anahtar silindi');
  await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: true });
  assert.equal(sayfa.oge('anahtarYoneticiUyari').style.display, 'none', 'anahtar yok: geç gelen olay uyarı çıkarmaz');
});

test('yönetici anahtarı: yalnız bir doğru/yanlış bilgisi tutulur; sayfada kullanıcı adı ya da kimlik alanı yoktur', async () => {
  const sayfa = await sayfaAc({ anahtarYonetici: true });
  await sayfa.anahtarYoneticiOlayi({ anahtarYonetici: true, kullanici: 'emre', kimlik: 'abc123' });
  const metin = sayfa.tumOgeler().map((o) => o.textContent).join('\n');
  assert.doesNotMatch(metin, /emre|abc123/);
});

// --- erişilebilirlik ve etiketler --------------------------------------------------------------------------------------

test('etiketler: her yeni denetimin görünen etiketi ve açıklaması çevrilebilir (data-i18n) ve anahtarları 5 dilde sözlükte var', () => {
  const anahtarlar = ['ayar.etk.ortaTikEtiket', 'ayar.etk.ortaTikIpucu', 'ayar.etk.ortaTikYok', 'ayar.etk.ortaTikArtikYok', 'ayar.etk.baglantiSnEtiket', 'ayar.etk.baglantiSnIpucu', 'ayar.etk.baglantiSnHata', 'ayar.etk.yoneticiUyari', 'ayar.etk.yoneticiDegil'];
  for (const anahtar of anahtarlar) {
    for (const dil of DILLER) assert.ok(typeof AYARLAR_SOZLUK[dil][anahtar] === 'string' && AYARLAR_SOZLUK[dil][anahtar].length > 0, `${dil} ${anahtar}`);
  }
  for (const anahtar of ['ayar.etk.ortaTikEtiket', 'ayar.etk.baglantiSnEtiket', 'ayar.etk.yoneticiUyari', 'ayar.etk.yoneticiDegil']) {
    assert.match(HTML, new RegExp(`data-i18n="${anahtar.replace(/\./g, '\\.')}"`), `HTML ${anahtar}`);
  }
});

test('orta tık ipucu yalnız Windows\'ta çalıştığını ve gerçek tepsi simgesinde denenmediğini dürüstçe söyler; kapı/kilit/alarm\'ın asla çalışmadığını belirtir', () => {
  assert.match(AYARLAR_SOZLUK.tr['ayar.etk.ortaTikIpucu'], /Windows/);
  assert.match(AYARLAR_SOZLUK.tr['ayar.etk.ortaTikIpucu'], /kapı, kilit ve alarm/);
  assert.match(AYARLAR_SOZLUK.tr['ayar.etk.ortaTikIpucu'], /denenmedi/);
  assert.match(AYARLAR_SOZLUK.en['ayar.etk.ortaTikIpucu'], /Windows/);
  assert.match(AYARLAR_SOZLUK.en['ayar.etk.ortaTikIpucu'], /lock|door/i);
});
