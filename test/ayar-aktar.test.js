'use strict';

/**
 * k-13: ayarları dışa/içe aktarma ve yedekten geri dönme (src/lib/ayar-yedegi.js + src/lib/ayar-aktar.js).
 * Geçici klasörde GERÇEK dosya sistemi, sahte diyalog; gerçek %APPDATA% ya da Home Assistant'a dokunulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AKTARIM_BICIMI, AKTARILAN_ALANLAR, ayarlariDisaAktar, ayarYedeginiCoz, yedekAdiGecerliMi, yedekleriListele } = require('../src/lib/ayar-yedegi');
const { ayarAktariciOlustur } = require('../src/lib/ayar-aktar');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));
// JWT benzeri sahte değer çalışma zamanında kurulur (araclar/kontrol.js depoda sabit JWT benzeri metin taşınmasını yasaklar).
const SAHTE_JWT = ['eyJ' + 'a'.repeat(20), 'b'.repeat(20), 'c'.repeat(12)].join('.');

function ayarlarKur(ek = {}) {
  return {
    ...ayarlariDuzelt({}, { varsayilan: VARSAYILAN }).ayarlar,
    yerelAdres: 'http://192.168.1.50:8123',
    disAdres: 'https://ev.example.org',
    favoriler: [
      { entity_id: 'light.masa', ad: 'Masa lambası', etiket: 'Masa', kisayol: 'Control+Alt+M', parlaklik: true },
      { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı kapat', onay: true },
    ],
    panolar: [{ ad: 'Enerji', yol: '/energy', kisayol: 'Control+Alt+E' }],
    ...ek,
  };
}

function gecici() {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-aktar-'));
  return { klasor, temizle: () => fs.rmSync(klasor, { recursive: true, force: true }) };
}

// --- dışa aktarma -------------------------------------------------------------------------------------

test('dışa aktarma: yalnız beyaz listedeki ayarlar yazılır; anahtar/token/gizli alanlar ve pencere ölçüleri ASLA girmez', () => {
  const ayarlar = ayarlarKur({
    anahtar: 'GIZLI_ANAHTAR_DEGERI',
    erisimAnahtari: 'GIZLI_ANAHTAR_DEGERI',
    token: 'GIZLI_TOKEN_DEGERI',
    yetki: { parmakIzi: 'abc' },
    safeStorage: 'x',
    engellenenFavoriler: [{ entity_id: 'lock.on_kapi', neden: 'guvenlik' }],
    hazirListeSurumu: 1,
  });
  ayarlar.favoriler[0].gizliAlan = 'GIZLI_ANAHTAR_DEGERI';
  const sonuc = ayarlariDisaAktar(ayarlar, { simdi: new Date('2026-10-15T10:00:00Z') });
  assert.equal(sonuc.ok, true);
  assert.ok(!sonuc.metin.includes('GIZLI_'), 'gizli değer dosyada yok');
  assert.ok(!/anahtar|token|parmakIzi|safeStorage|engellenen|hazirListe|pencere"/i.test(sonuc.metin.replace('Erişim anahtarı bu dosyaya yazılmaz; başka bir bilgisayarda Ayarlar’dan yeniden eklenmelidir.', '')), 'yasak alan adı yok');
  const dosya = JSON.parse(sonuc.metin);
  assert.equal(dosya.bicim, AKTARIM_BICIMI);
  assert.equal(dosya.semaSurumu, SEMA_SURUMU);
  assert.equal(dosya.tarih, '2026-10-15T10:00:00.000Z');
  for (const alan of Object.keys(dosya.ayarlar)) assert.ok(AKTARILAN_ALANLAR.includes(alan), alan);
  assert.deepEqual(Object.keys(dosya.ayarlar.favoriler[0]).sort(), ['ad', 'entity_id', 'etiket', 'kisayol', 'parlaklik']);
  assert.equal(sonuc.favoriSayisi, 2);
});

test('dışa aktarma: serbest metin alanına JWT benzeri bir değer sızmışsa reddedilir', () => {
  const sonuc = ayarlariDisaAktar(ayarlarKur({ panolar: [{ ad: SAHTE_JWT, yol: '/energy' }] }));
  assert.equal(sonuc.ok, false);
  assert.match(sonuc.hata, /erişim anahtarına benzeyen/);
  assert.equal(ayarlariDisaAktar(ayarlarKur({ favoriler: [{ entity_id: 'light.masa', ad: 'Masa', etiket: SAHTE_JWT }] })).ok, false);
});

test('dışa aktarılan dosya geri okunur: ayarlar aynen döner (yalnız dosyada bulunan alanlar)', () => {
  const ayarlar = ayarlarKur({ temaZorla: 'sistem', vurguRengi: '#0f75e0', yeniPencereMalzemesi: 'mica', paletKisayol: '', tepsiSolTik: 'pencere', canliBaglanti: false });
  const dosya = JSON.parse(ayarlariDisaAktar(ayarlar).metin);
  const cozum = ayarYedeginiCoz(dosya, { varsayilan: VARSAYILAN });
  assert.equal(cozum.ok, true);
  assert.equal(cozum.kaynak, 'aktarim');
  for (const alan of ['yerelAdres', 'disAdres', 'kisayol', 'paletKisayol', 'tepsiSolTik', 'canliBaglanti', 'temaZorla', 'vurguRengi', 'yeniPencereMalzemesi', 'pencereBoyutu', 'anaPanoyaDonDk']) {
    assert.deepEqual(cozum.ayarlar[alan], ayarlar[alan], alan);
  }
  assert.deepEqual(cozum.ayarlar.favoriler.map((f) => f.entity_id), ['light.masa', 'button.pc_bilgisayari_kapat']);
  assert.deepEqual(cozum.ayarlar.panolar, [{ ad: 'Enerji', yol: '/energy', kisayol: 'Control+Alt+E' }]);
});

// --- içe aktarma: şema doğrulaması ve kapı süzgeci --------------------------------------------------------

test('içe aktarma: kapı/kilit/alarm favorileri ve kapı adlı karo adı süzgeçten geçemez, atılanlar bildirilir', () => {
  const dosya = {
    bicim: AKTARIM_BICIMI,
    aktarimSurumu: 1,
    semaSurumu: SEMA_SURUMU,
    ayarlar: {
      yerelAdres: 'http://192.168.1.50:8123',
      favoriler: [
        { entity_id: 'light.salon', ad: 'Salon' },
        { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
        { entity_id: 'alarm_control_panel.ev', ad: 'Alarm' },
        { entity_id: 'light.kapi_isigi', ad: 'Işık' },
        { entity_id: 'light.bahce', ad: 'Garaj lambası' },
        { entity_id: 'switch.priz', ad: 'Priz', etiket: 'Kapı prizi' },
        { entity_id: 'cover.garaj_kapisi', ad: 'Garaj' },
        { entity_id: 'KOTU KIMLIK', ad: 'x' },
      ],
    },
  };
  const cozum = ayarYedeginiCoz(dosya, { varsayilan: VARSAYILAN });
  assert.equal(cozum.ok, true);
  const kimlikler = cozum.ayarlar.favoriler.map((f) => f.entity_id);
  assert.deepEqual(kimlikler, ['light.salon', 'switch.priz']);
  assert.equal('etiket' in cozum.ayarlar.favoriler[1], false, 'kapı adlı karo adı atılır');
  assert.ok(cozum.atilanlar.length >= 5);
  for (const yasak of ['lock.on_kapi', 'alarm_control_panel.ev', 'light.kapi_isigi', 'light.bahce', 'cover.garaj_kapisi']) {
    assert.ok(!kimlikler.includes(yasak), yasak);
  }
});

test('içe aktarma: bilinmeyen/gizli alanlar (anahtar, token) ve pencere ölçüleri alınmaz; dosyada olmayan alan çıktıda da yok', () => {
  const cozum = ayarYedeginiCoz(
    { bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar: { yerelAdres: 'http://192.168.1.50:8123', anahtar: 'X', token: 'Y', erisimAnahtari: 'Z', pencere: { hizli: { width: 1, height: 1 } }, bipSesi: true } },
    { varsayilan: VARSAYILAN },
  );
  assert.equal(cozum.ok, true);
  assert.deepEqual(Object.keys(cozum.ayarlar).sort(), ['bipSesi', 'yerelAdres']);
  assert.deepEqual(cozum.alanlar.sort(), ['bipSesi', 'yerelAdres']);
});

test('içe aktarma: şema doğrulaması geçersiz değerleri düzeltir (kısayol varsayılana döner ve not düşülür; tema/boyut varsayılan)', () => {
  const cozum = ayarYedeginiCoz(
    { bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar: { yerelAdres: 'http://192.168.1.50:8123', kisayol: 'Control+V', paletKisayol: 'F9', temaZorla: 'mor', pencereBoyutu: 'dev', anaPanoyaDonDk: 99999 } },
    { varsayilan: VARSAYILAN },
  );
  assert.equal(cozum.ok, true);
  assert.equal(cozum.ayarlar.kisayol, 'Control+Alt+H', 'Windows’a ayrılmış kısayol alınmaz');
  assert.equal(cozum.ayarlar.paletKisayol, 'Control+Alt+P');
  assert.equal(cozum.ayarlar.temaZorla, 'koyu');
  assert.equal(cozum.ayarlar.pencereBoyutu, 'hizli');
  assert.deepEqual(cozum.notlar.sort(), ['kisayol-varsayilana-donduruldu', 'palet-kisayol-varsayilana-donduruldu']);
});

test('içe aktarma: geçersiz adres sessizce varsayılana dönmez, tüm içe aktarma reddedilir', () => {
  for (const ayarlar of [
    { yerelAdres: 'abc', bipSesi: true },
    { yerelAdres: 'http://kullanici:parola@192.168.1.5:8123' },
    { yerelAdres: 'http://192.168.1.50:8123', disAdres: 'http://ev.example.org' },
  ]) {
    const cozum = ayarYedeginiCoz({ bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar }, { varsayilan: VARSAYILAN });
    assert.equal(cozum.ok, false, JSON.stringify(ayarlar));
    assert.match(cozum.hata, /adres geçersiz/);
  }
});

test('içe aktarma: yabancı dosya, boş ayar, daha yeni sürüm ve dizi/null reddedilir; ayar dosyası biçimi (yedekler) kabul edilir', () => {
  for (const ham of [null, [], 'metin', 42, {}, { foo: 1 }, { bicim: 'baska' }, { bicim: AKTARIM_BICIMI }, { bicim: AKTARIM_BICIMI, aktarimSurumu: 1 }, { bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar: {} }, { bicim: AKTARIM_BICIMI, aktarimSurumu: 99, ayarlar: { bipSesi: true } }, { bicim: AKTARIM_BICIMI, aktarimSurumu: 1, semaSurumu: 99, ayarlar: { bipSesi: true } }, { semaSurumu: 99, yerelAdres: 'http://192.168.1.5:8123' }]) {
    assert.equal(ayarYedeginiCoz(ham, { varsayilan: VARSAYILAN }).ok, false, JSON.stringify(ham));
  }
  const eski = ayarYedeginiCoz({ yerelAdres: 'http://192.168.1.77:8123', favoriler: [{ entity_id: 'light.salon' }], pencere: { x: 1, y: 2, width: 800, height: 600 } }, { varsayilan: VARSAYILAN });
  assert.equal(eski.ok, true);
  assert.equal(eski.kaynak, 'ayar-dosyasi');
  assert.deepEqual(Object.keys(eski.ayarlar).sort(), ['favoriler', 'yerelAdres']);
});

// --- yedek listesi ve geri dönme --------------------------------------------------------------------------

test('yedek listesi: yalnız beklenen adlar (göç yedeği, bozuk dosya kopyası) görünür; yol/ayar/anahtar dosyaları görünmez', () => {
  const { klasor, temizle } = gecici();
  try {
    fs.writeFileSync(path.join(klasor, 'ayarlar.v1-yedek.json'), JSON.stringify({ yerelAdres: 'http://192.168.1.5:8123' }));
    fs.writeFileSync(path.join(klasor, 'ayarlar.bozuk-1760000000000.json'), '{ bozuk');
    for (const ad of ['ayarlar.json', 'ayarlar.json.tmp', 'anahtar.dat', 'yetki-kesici.json', 'yetki-kesici.yedek.json', 'ayarlar.v1-yedek.json.bak', 'ayarlar.bozuk-abc.json', 'xayarlar.v1-yedek.json']) {
      fs.writeFileSync(path.join(klasor, ad), '{}');
    }
    fs.mkdirSync(path.join(klasor, 'ayarlar.v9-yedek.json')); // dizin: dosya değil
    const liste = yedekleriListele({ dizin: klasor });
    assert.deepEqual(liste.map((y) => y.ad).sort(), ['ayarlar.bozuk-1760000000000.json', 'ayarlar.v1-yedek.json']);
    const bozuk = liste.find((y) => y.tur === 'bozuk');
    const goc = liste.find((y) => y.tur === 'goc');
    assert.equal(bozuk.zaman, 1760000000000);
    assert.equal(bozuk.okunabilir, false);
    assert.equal(goc.surum, 1);
    assert.equal(goc.okunabilir, true);
    assert.deepEqual(yedekleriListele({ dizin: path.join(klasor, 'yok') }), [], 'klasör yoksa boş liste, hata yok');
  } finally {
    temizle();
  }
});

test('yedek adı doğrulaması: yol dizisi, ayar/anahtar dosyası ve rastgele ad geçersiz', () => {
  for (const iyi of ['ayarlar.v1-yedek.json', 'ayarlar.v4-yedek.json', 'ayarlar.bozuk-1760000000000.json']) assert.equal(yedekAdiGecerliMi(iyi), true, iyi);
  for (const kotu of ['ayarlar.json', 'anahtar.dat', '../ayarlar.v1-yedek.json', '..\\ayarlar.v1-yedek.json', 'C:\\ayarlar.v1-yedek.json', 'ayarlar.v1-yedek.json\n', 'ayarlar.vX-yedek.json', '', null, undefined, 42, {}]) {
    assert.equal(yedekAdiGecerliMi(kotu), false, JSON.stringify(kotu));
  }
});

function aktaricKur({ klasor, ayarlar = ayarlarKur(), diyalog = {}, uygulanan = [], uygulaSonucu = { ok: true, uyarilar: [], favoriSayisi: 2 }, ek = {}, simdi = () => new Date('2026-10-15T10:00:00Z') } = {}) {
  const dialog = {
    showSaveDialog: async (_pencere, secenek) => diyalog.kaydet?.(secenek) ?? { canceled: true },
    showOpenDialog: async (_pencere, secenek) => diyalog.ac?.(secenek) ?? { canceled: true },
    showMessageBox: async (...arg) => ({ response: diyalog.mesajCevabi?.(arg.at(-1)) ?? 1 }),
  };
  const gunlukler = [];
  const aktarici = ayarAktariciOlustur({
    dialog,
    ayarDizini: klasor,
    varsayilanKlasor: klasor,
    ayarlarAl: () => ayarlar,
    varsayilanAl: () => VARSAYILAN,
    uygula: async (cozum) => {
      uygulanan.push(cozum);
      return typeof uygulaSonucu === 'function' ? uygulaSonucu(cozum) : uygulaSonucu;
    },
    gunluk: (m) => gunlukler.push(m),
    simdi,
    ...ek,
  });
  return { aktarici, uygulanan, gunlukler };
}

test('dışa aktar: önerilen dosya adındaki tarih UTC değil yerel gündür (gece yarısından sonra önceki gün yazılmaz)', async () => {
  const { klasor, temizle } = gecici();
  try {
    for (const [an, beklenen] of [[new Date(2026, 9, 24, 1, 30), '2026-10-24'], [new Date(2026, 9, 24, 23, 45), '2026-10-24'], [new Date(2026, 0, 5, 0, 5), '2026-01-05']]) {
      const secenekler = [];
      const { aktarici } = aktaricKur({ klasor, simdi: () => an, diyalog: { kaydet: (s) => (secenekler.push(s), { canceled: true }) } });
      await aktarici.disaAktar(null);
      assert.match(secenekler[0].defaultPath, new RegExp(`ev-paneli-ayarlar-${beklenen}\.json$`));
    }
  } finally {
    temizle();
  }
});

test('dışa aktar: diyalogdan seçilen dosyaya yazar (.json eklenir), yalnız dosya adı döner; iptal ve hata güvenli', async () => {
  const { klasor, temizle } = gecici();
  try {
    const secenekler = [];
    const { aktarici, gunlukler } = aktaricKur({
      klasor,
      ayarlar: ayarlarKur({ anahtar: 'GIZLI_ANAHTAR_DEGERI' }),
      diyalog: { kaydet: (s) => (secenekler.push(s), { canceled: false, filePath: path.join(klasor, 'yedegim') }) },
    });
    const sonuc = await aktarici.disaAktar(null);
    assert.deepEqual(sonuc, { ok: true, ad: 'yedegim.json', favoriSayisi: 2 });
    assert.match(secenekler[0].defaultPath, /ev-paneli-ayarlar-2026-10-15\.json$/);
    const yazilan = fs.readFileSync(path.join(klasor, 'yedegim.json'), 'utf8');
    assert.ok(!yazilan.includes('GIZLI_ANAHTAR_DEGERI'));
    assert.equal(JSON.parse(yazilan).bicim, AKTARIM_BICIMI);
    assert.ok(gunlukler.every((m) => !m.includes(klasor)), 'günlükte yol yok');

    const iptal = await aktaricKur({ klasor }).aktarici.disaAktar(null);
    assert.deepEqual(iptal, { ok: false, iptal: true });

    const yazilamaz = await aktaricKur({ klasor, diyalog: { kaydet: () => ({ canceled: false, filePath: path.join(klasor, 'yok-klasor', 'a.json') }) } }).aktarici.disaAktar(null);
    assert.equal(yazilamaz.ok, false);
    assert.match(yazilamaz.hata, /yazılamadı/);

    const jwtli = await aktaricKur({ klasor, ayarlar: ayarlarKur({ panolar: [{ ad: SAHTE_JWT, yol: '/energy' }] }), diyalog: { kaydet: () => ({ canceled: false, filePath: path.join(klasor, 'x.json') }) } }).aktarici.disaAktar(null);
    assert.equal(jwtli.ok, false);
    assert.equal(fs.existsSync(path.join(klasor, 'x.json')), false, 'reddedilince dosya hiç yazılmaz');
  } finally {
    temizle();
  }
});

test('içe aktar: seçilen dosya doğrulanır ve uygulanır; geçersiz dosyada uygulama hiç çağrılmaz; sonuç özeti dosya adı ve sayılar taşır', async () => {
  const { klasor, temizle } = gecici();
  try {
    const iyi = path.join(klasor, 'iyi.json');
    fs.writeFileSync(iyi, ayarlariDisaAktar(ayarlarKur()).metin);
    const { aktarici, uygulanan } = aktaricKur({ klasor, diyalog: { ac: () => ({ canceled: false, filePaths: [iyi] }) } });
    const sonuc = await aktarici.iceAktar(null);
    assert.equal(sonuc.ok, true);
    assert.equal(sonuc.ad, 'iyi.json');
    assert.equal(sonuc.favoriSayisi, 2);
    assert.equal(uygulanan.length, 1);
    assert.ok(!JSON.stringify(sonuc).includes(klasor), 'yanıtta klasör yolu yok');

    const kotuler = { 'bozuk.json': '{ bozuk', 'yabanci.json': '{"a":1}', 'dizi.json': '[]', 'adres.json': JSON.stringify({ bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar: { yerelAdres: 'http://ev.example.org' } }) };
    for (const [ad, icerik] of Object.entries(kotuler)) {
      const dosya = path.join(klasor, ad);
      fs.writeFileSync(dosya, icerik);
      const k = aktaricKur({ klasor, diyalog: { ac: () => ({ canceled: false, filePaths: [dosya] }) } });
      const s = await k.aktarici.iceAktar(null);
      assert.equal(s.ok, false, ad);
      assert.ok(typeof s.hata === 'string' && s.hata.length > 5, ad);
      assert.equal(k.uygulanan.length, 0, `${ad}: hiçbir ayar uygulanmadı`);
    }
    const buyuk = path.join(klasor, 'buyuk.json');
    fs.writeFileSync(buyuk, JSON.stringify({ bicim: AKTARIM_BICIMI, aktarimSurumu: 1, ayarlar: { ad: 'x'.repeat(600 * 1024) } }));
    const kb = aktaricKur({ klasor, diyalog: { ac: () => ({ canceled: false, filePaths: [buyuk] }) } });
    assert.match((await kb.aktarici.iceAktar(null)).hata, /çok büyük/);
    assert.equal(kb.uygulanan.length, 0);

    assert.deepEqual(await aktaricKur({ klasor }).aktarici.iceAktar(null), { ok: false, iptal: true });
    const yok = aktaricKur({ klasor, diyalog: { ac: () => ({ canceled: false, filePaths: [path.join(klasor, 'yok.json')] }) } });
    assert.equal((await yok.aktarici.iceAktar(null)).ok, false);
  } finally {
    temizle();
  }
});

test('içe aktar: uygulama adımı hata verirse (ör. adres reddi) hata iletisi döner ve istisna sızmaz', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = path.join(klasor, 'a.json');
    fs.writeFileSync(dosya, ayarlariDisaAktar(ayarlarKur()).metin);
    const diyalog = { ac: () => ({ canceled: false, filePaths: [dosya] }) };
    const reddedilen = await aktaricKur({ klasor, diyalog, uygulaSonucu: { ok: false, hata: 'Ev içi adres geçersiz.' } }).aktarici.iceAktar(null);
    assert.deepEqual(reddedilen, { ok: false, hata: 'Ev içi adres geçersiz.' });
    const patlayan = await aktaricKur({ klasor, diyalog, uygulaSonucu: () => { throw new Error('GIZLI_ANAHTAR_DEGERI'); } }).aktarici.iceAktar(null);
    assert.equal(patlayan.ok, false);
    assert.ok(!JSON.stringify(patlayan).includes('GIZLI_'), 'istisna iletisi sızmaz');
  } finally {
    temizle();
  }
});

test('yedekten dön: yalnız listedeki yedek adları; yol dizileri ve ayar/anahtar dosyaları HİÇ okunmaz', async () => {
  const { klasor, temizle } = gecici();
  try {
    fs.writeFileSync(path.join(klasor, 'ayarlar.v1-yedek.json'), JSON.stringify({ yerelAdres: 'http://192.168.1.77:8123', favoriler: [{ entity_id: 'light.salon' }] }));
    fs.writeFileSync(path.join(klasor, 'ayarlar.bozuk-1760000000000.json'), '{ bozuk');
    fs.writeFileSync(path.join(klasor, 'ayarlar.json'), JSON.stringify({ yerelAdres: 'http://192.168.1.1:8123' }));
    fs.writeFileSync(path.join(klasor, 'anahtar.dat'), 'SIFRELI');
    const k = aktaricKur({ klasor });
    const liste = k.aktarici.yedekler();
    assert.equal(liste.ok, true);
    assert.deepEqual(liste.yedekler.map((y) => y.ad).sort(), ['ayarlar.bozuk-1760000000000.json', 'ayarlar.v1-yedek.json']);

    for (const kotu of ['ayarlar.json', 'anahtar.dat', '..\\ayarlar.v1-yedek.json', '../x', 'ayarlar.v7-yedek.json', null, 5]) {
      const s = await k.aktarici.yedektenDon(kotu);
      assert.equal(s.ok, false, String(kotu));
    }
    assert.equal(k.uygulanan.length, 0);

    const bozuk = await k.aktarici.yedektenDon('ayarlar.bozuk-1760000000000.json');
    assert.equal(bozuk.ok, false);
    assert.match(bozuk.hata, /JSON değil|bozuk/);

    const iyi = await k.aktarici.yedektenDon('ayarlar.v1-yedek.json');
    assert.equal(iyi.ok, true);
    assert.equal(iyi.ad, 'ayarlar.v1-yedek.json');
    assert.equal(k.uygulanan.length, 1);
    assert.equal(k.uygulanan[0].ayarlar.yerelAdres, 'http://192.168.1.77:8123');
    assert.deepEqual(k.uygulanan[0].ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
  } finally {
    temizle();
  }
});

// --- Anahtar sızdırma önlemi: ana makine değişikliği yerel onay ister ---------------------------------

/** Sahte iletişim kutulu (showMessageBox) içe aktarıcı. cevap: showMessageBox'ın döneceği response (ya da bir işlev). */
function onayliAktaricKur({ klasor, ayarlar = ayarlarKur(), anahtarVar = true, cevap = 0, t }) {
  const sorular = [];
  const uygulanan = [];
  const dialog = {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true }),
    showMessageBox: async (...arg) => {
      sorular.push(arg.at(-1));
      const c = typeof cevap === 'function' ? cevap() : cevap;
      return { response: c };
    },
  };
  const aktarici = ayarAktariciOlustur({
    dialog,
    ayarDizini: klasor,
    varsayilanKlasor: klasor,
    ayarlarAl: () => ayarlar,
    varsayilanAl: () => VARSAYILAN,
    uygula: async (cozum) => (uygulanan.push(cozum), { ok: true, uyarilar: [], favoriSayisi: 2 }),
    anahtarVarMi: () => anahtarVar,
    ...(t ? { t } : {}),
  });
  return { aktarici, sorular, uygulanan, dialog };
}

function dosyaYaz(klasor, ek) {
  const dosya = path.join(klasor, 'ice.json');
  fs.writeFileSync(dosya, ayarlariDisaAktar(ayarlarKur(ek)).metin);
  return dosya;
}

test('anahtar varken ana makine değişen içe aktarma onay ister: onaylanırsa uygulanır, vazgeçilirse HİÇBİR ayar uygulanmaz', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = dosyaYaz(klasor, { yerelAdres: 'http://192.168.1.99:8123' });
    for (const [cevap, uygulanmali] of [[0, true], [1, false]]) {
      const k = onayliAktaricKur({ klasor, cevap });
      k.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dosya] });
      const sonuc = await k.aktarici.iceAktar({ sahte: 'pencere' });
      assert.equal(k.sorular.length, 1, 'tek onay sorusu');
      assert.equal(k.sorular[0].type, 'warning');
      assert.equal(k.sorular[0].defaultId, 1, 'varsayılan düğme Vazgeç');
      assert.equal(k.sorular[0].cancelId, 1);
      assert.match(k.sorular[0].detail, /192\.168\.1\.50/, 'eski ana makine gösterilir');
      assert.match(k.sorular[0].detail, /192\.168\.1\.99/, 'yeni ana makine gösterilir');
      assert.equal(sonuc.ok, uygulanmali);
      assert.equal(k.uygulanan.length, uygulanmali ? 1 : 0);
      if (!uygulanmali) assert.match(sonuc.hata, /uygulanmadı|onaylanmadı/);
    }
  } finally {
    temizle();
  }
});

test('onay kutusu hata verirse ya da kapatılırsa uygulanmaz (güvenli yön); dış adresin ana makinesi değişince de sorulur', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = dosyaYaz(klasor, { disAdres: 'https://baska.example.net' });
    const k = onayliAktaricKur({ klasor, cevap: () => { throw new Error('kutu açılamadı'); } });
    k.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dosya] });
    const sonuc = await k.aktarici.iceAktar(null);
    assert.equal(sonuc.ok, false);
    assert.equal(k.uygulanan.length, 0);
    assert.equal(k.sorular.length, 1);
    assert.match(k.sorular[0].detail, /ev\.example\.org/);
    assert.match(k.sorular[0].detail, /baska\.example\.net/);
  } finally {
    temizle();
  }
});

test('anahtar yoksa ya da ana makine aynıysa onay sorulmaz (yol, kapı numarası ve büyük/küçük harf farkı yetmez)', async () => {
  const { klasor, temizle } = gecici();
  try {
    const degisen = dosyaYaz(klasor, { yerelAdres: 'http://192.168.1.99:8123' });
    const anahtarsiz = onayliAktaricKur({ klasor, anahtarVar: false });
    anahtarsiz.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [degisen] });
    assert.equal((await anahtarsiz.aktarici.iceAktar(null)).ok, true);
    assert.equal(anahtarsiz.sorular.length, 0, 'saklı anahtar yoksa sızacak bir şey yok');

    const ayni = dosyaYaz(klasor, { yerelAdres: 'http://192.168.1.50:9000/ev', disAdres: 'https://EV.example.org:8443/ev' });
    const k = onayliAktaricKur({ klasor });
    k.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [ayni] });
    assert.equal((await k.aktarici.iceAktar(null)).ok, true);
    assert.equal(k.sorular.length, 0, 'yalnız yol/kapı/şema değişti: ana makine aynı');
  } finally {
    temizle();
  }
});

test('yedekten dönmek de aynı onaya tabidir; kutu İngilizce çevirmenle İngilizce açılır', async () => {
  const { klasor, temizle } = gecici();
  try {
    fs.writeFileSync(path.join(klasor, 'ayarlar.v1-yedek.json'), JSON.stringify({ semaSurumu: 1, yerelAdres: 'http://10.9.9.9:8123', favoriler: [] }));
    const { anaCevirmen } = require('../src/lib/ceviri-varsayilan');
    const k = onayliAktaricKur({ klasor, cevap: 1, t: anaCevirmen('en') });
    const sonuc = await k.aktarici.yedektenDon('ayarlar.v1-yedek.json', { sahte: 'pencere' });
    assert.equal(sonuc.ok, false);
    assert.equal(k.uygulanan.length, 0);
    assert.equal(k.sorular.length, 1);
    assert.doesNotMatch(JSON.stringify(k.sorular[0]), /[çğıöşüÇĞİÖŞÜ]/, 'İngilizce kutuda Türkçe harf yok');
    assert.match(k.sorular[0].buttons[1], /Cancel/);

    const onayli = onayliAktaricKur({ klasor, cevap: 0 });
    assert.equal((await onayli.aktarici.yedektenDon('ayarlar.v1-yedek.json', null)).ok, true);
    assert.equal(onayli.uygulanan.length, 1);
  } finally {
    temizle();
  }
});

test('anaMakineDegisenler: boş/silinen adres ve aynı ana makine sayılmaz; ayrıştırılamayan adres değişim sayılır', () => {
  const { anaMakineDegisenler } = require('../src/lib/ayar-aktar');
  const mevcut = { yerelAdres: 'http://192.168.1.50:8123', disAdres: 'https://ev.example.org' };
  assert.deepEqual(anaMakineDegisenler({ yerelAdres: '', disAdres: '' }, mevcut), []);
  assert.deepEqual(anaMakineDegisenler({ yerelAdres: 'http://192.168.1.50:9', disAdres: 'https://EV.example.org/x' }, mevcut), []);
  assert.deepEqual(anaMakineDegisenler({ yerelAdres: 'http://10.0.0.1' }, mevcut).map((d) => d.alan), ['yerelAdres']);
  assert.equal(anaMakineDegisenler({ disAdres: 'bozuk adres' }, mevcut).length, 1);
  assert.equal(anaMakineDegisenler({ disAdres: 'https://yeni.example.org' }, {}).length, 1, 'mevcut adres yoksa da yeni ana makine sorulur');
});

// --- içe aktarma önizlemesi (1.4.0) --------------------------------------------------------------------------------------

const { ONIZLEME_BOLUMLERI } = require('../src/lib/ayar-aktar');

function onizlemeDosyasi(klasor, ek = {}, ad = 'onizle.json') {
  const dosya = path.join(klasor, ad);
  fs.writeFileSync(dosya, ayarlariDisaAktar(ayarlarKur(ek)).metin);
  return dosya;
}

test('önizleme: yalnız dosya adı, kapalı listeden değişen bölüm adları ve sayılar döner; hiçbir ayar uygulanmaz; adres/anahtar/değer sızmaz', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = onizlemeDosyasi(klasor, {
      yerelAdres: 'http://192.168.77.9:8123',
      koseBildirimi: false,
      kisayol: 'Control+Alt+K',
      favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }, { entity_id: 'lock.on_kapi', ad: 'Ön kapı' }, { entity_id: 'light.masa', ad: 'Masa lambası', etiket: 'Masa', kisayol: 'Control+Alt+M', parlaklik: true }],
    });
    const k = aktaricKur({ klasor, diyalog: { ac: () => ({ canceled: false, filePaths: [dosya] }) } });
    const sonuc = await k.aktarici.iceAktarOnizle(null);
    assert.equal(sonuc.ok, true);
    assert.equal(sonuc.ad, 'onizle.json');
    assert.deepEqual(sonuc.bolumler, ['favoriler', 'kisayollar', 'bildirim', 'baglanti'], 'değişen bölümler sabit sırada; değişmeyenler (görünüm, panolar...) yok');
    assert.ok(sonuc.bolumler.every((b) => ONIZLEME_BOLUMLERI.includes(b)), 'adlar kapalı listeden');
    assert.equal(sonuc.favoriSayisi, 2, 'kapı/kilit favorisi süzgeçte düşer, sayıya girmez');
    assert.equal(sonuc.atilanSayisi, 1);
    assert.equal(sonuc.eksikFavoriSayisi, null, 'cihaz listesi bilinmiyorsa sayı verilmez');
    assert.match(sonuc.onizlemeNo, /^[0-9a-f]{16}$/);
    assert.equal(k.uygulanan.length, 0, 'önizleme hiçbir ayarı uygulamaz');
    const metin = JSON.stringify(sonuc);
    for (const sizmamali of ['192.168', 'example.org', 'Control+Alt', 'Salon', 'light.', 'lock.', klasor]) assert.ok(!metin.includes(sizmamali), `önizleme ${sizmamali} içermemeli`);
  } finally {
    temizle();
  }
});

test('önizleme: dosya şu anki ayarlarla aynıysa değişen bölüm yoktur; anahtar sırası fark sayılmaz, tek alan farkı doğru bölüme düşer', async () => {
  const { klasor, temizle } = gecici();
  try {
    const mevcut = ayarlarKur();
    const ayni = onizlemeDosyasi(klasor, {}, 'ayni.json');
    const k = aktaricKur({ klasor, ayarlar: mevcut, diyalog: { ac: () => ({ canceled: false, filePaths: [ayni] }) } });
    const sonuc = await k.aktarici.iceAktarOnizle(null);
    assert.equal(sonuc.ok, true);
    assert.deepEqual(sonuc.bolumler, [], 'aynı içerik: değişiklik yok');
    assert.ok(sonuc.alanSayisi > 0);

    // mevcut ayardaki favori nesnesinin anahtar sırası farklı olsa da fark sayılmaz
    const tersSirali = ayarlarKur({ favoriler: ayarlarKur().favoriler.map((f) => Object.fromEntries(Object.entries(f).reverse())) });
    const k2 = aktaricKur({ klasor, ayarlar: tersSirali, diyalog: { ac: () => ({ canceled: false, filePaths: [ayni] }) } });
    assert.deepEqual((await k2.aktarici.iceAktarOnizle(null)).bolumler, []);

    const biri = onizlemeDosyasi(klasor, { bipSesi: !mevcut.bipSesi }, 'biri.json');
    const k3 = aktaricKur({ klasor, ayarlar: mevcut, diyalog: { ac: () => ({ canceled: false, filePaths: [biri] }) } });
    assert.deepEqual((await k3.aktarici.iceAktarOnizle(null)).bolumler, ['bildirim']);
  } finally {
    temizle();
  }
});

test('önizleme: bulunamayan favori sayısı bilinen kimliklerden hesaplanır; liste yoksa ya da okuma hata verirse sayı verilmez', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = onizlemeDosyasi(klasor);
    const diyalog = { ac: () => ({ canceled: false, filePaths: [dosya] }) };
    const sayi = async (bilinenKimlikler) => (await aktaricKur({ klasor, diyalog, ek: { bilinenKimlikler } }).aktarici.iceAktarOnizle(null)).eksikFavoriSayisi;
    assert.equal(await sayi(() => new Set(['light.masa', 'button.pc_bilgisayari_kapat'])), 0);
    assert.equal(await sayi(() => new Set(['light.masa'])), 1);
    assert.equal(await sayi(() => new Set()), 2);
    assert.equal(await sayi(() => null), null);
    assert.equal(await sayi(() => ['light.masa']), null, 'Set olmayan değer bilinmiyor sayılır');
    assert.equal(await sayi(() => { throw new Error('okunamadı'); }), null);
  } finally {
    temizle();
  }
});

test('önizleme: iptal, bozuk ve yabancı dosya hata/iptal döner; bekleyen kalmaz (eski numara da işe yaramaz)', async () => {
  const { klasor, temizle } = gecici();
  try {
    const iyi = onizlemeDosyasi(klasor, {}, 'iyi.json');
    const bozuk = path.join(klasor, 'bozuk.json');
    fs.writeFileSync(bozuk, '{ bozuk');
    const yabanci = path.join(klasor, 'yabanci.json');
    fs.writeFileSync(yabanci, '{"a":1}');
    let secilen = iyi;
    const k = aktaricKur({ klasor, diyalog: { ac: () => (secilen === null ? { canceled: true } : { canceled: false, filePaths: [secilen] }) } });
    const ilk = await k.aktarici.iceAktarOnizle(null);
    assert.equal(ilk.ok, true);
    secilen = bozuk;
    const b = await k.aktarici.iceAktarOnizle(null);
    assert.equal(b.ok, false);
    assert.match(b.hata, /geçerli bir JSON değil/);
    secilen = yabanci;
    assert.equal((await k.aktarici.iceAktarOnizle(null)).ok, false);
    secilen = null;
    assert.deepEqual(await k.aktarici.iceAktarOnizle(null), { ok: false, iptal: true });
    const gec = await k.aktarici.iceAktar(null, ilk.onizlemeNo);
    assert.equal(gec.ok, false, 'yeni önizleme denemesi eskisini geçersiz kılar');
    assert.equal(k.uygulanan.length, 0);
  } finally {
    temizle();
  }
});

test('önizlemeden sonra uygulama: numarayla ÖNİZLENEN içerik uygulanır (dosya sonradan değişse de), numara tek kullanımlıktır; yanlış, eski ve süresi dolmuş numara hiçbir şey uygulamaz', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = onizlemeDosyasi(klasor, { koseBildirimi: false });
    const baslangic = new Date('2026-10-15T10:00:00Z').getTime();
    let an = baslangic;
    let diyalogSayisi = 0;
    const k = aktaricKur({ klasor, simdi: () => new Date(an), diyalog: { ac: () => (diyalogSayisi++, { canceled: false, filePaths: [dosya] }) } });
    const on = await k.aktarici.iceAktarOnizle(null);
    assert.equal(on.ok, true);
    assert.equal(diyalogSayisi, 1);
    // önizlemeden sonra dosya kurcalanırsa uygulanan, kullanıcının gördüğü içeriktir
    fs.writeFileSync(dosya, ayarlariDisaAktar(ayarlarKur({ koseBildirimi: true, bipSesi: true })).metin);
    const sonuc = await k.aktarici.iceAktar(null, on.onizlemeNo);
    assert.equal(sonuc.ok, true);
    assert.equal(sonuc.ad, 'onizle.json');
    assert.equal(diyalogSayisi, 1, 'uygulama adımı ikinci kez dosya sormaz');
    assert.equal(k.uygulanan.length, 1);
    assert.equal(k.uygulanan[0].ayarlar.koseBildirimi, false, 'önizlenen içerik');
    // tek kullanım
    const yine = await k.aktarici.iceAktar(null, on.onizlemeNo);
    assert.equal(yine.ok, false);
    assert.match(yine.hata, /Önizleme süresi doldu ya da geçersiz/);
    assert.equal(k.uygulanan.length, 1);

    // yanlış numara, sayı, nesne, boş metin: uygulanmaz ve bekleyen de tüketilir
    for (const kotu of ['0000000000000000', 42, {}, '', [], true]) {
      const taze = await k.aktarici.iceAktarOnizle(null);
      assert.equal((await k.aktarici.iceAktar(null, kotu)).ok, false, JSON.stringify(kotu));
      assert.equal((await k.aktarici.iceAktar(null, taze.onizlemeNo)).ok, false, 'yanlış denemeden sonra bekleyen tüketilmiştir');
    }
    assert.equal(k.uygulanan.length, 1);

    // süre dolması: 10 dakikayı aşınca geçersiz, sınırda hâlâ geçerli
    const gecikecek = await k.aktarici.iceAktarOnizle(null);
    an = baslangic + 10 * 60 * 1000 + 1;
    assert.equal((await k.aktarici.iceAktar(null, gecikecek.onizlemeNo)).ok, false);
    assert.equal(k.uygulanan.length, 1);
    an = baslangic;
    const sinirda = await k.aktarici.iceAktarOnizle(null);
    an = baslangic + 10 * 60 * 1000;
    assert.equal((await k.aktarici.iceAktar(null, sinirda.onizlemeNo)).ok, true, 'süre sınırında hâlâ geçerli');
    assert.equal(k.uygulanan.length, 2);
  } finally {
    temizle();
  }
});

test('önizlemeden sonra uygulama da ana makine onayına tabidir; numarasız eski çağrı hâlâ dosyayı kendisi seçtirir', async () => {
  const { klasor, temizle } = gecici();
  try {
    const dosya = onizlemeDosyasi(klasor, { yerelAdres: 'http://192.168.1.99:8123' });
    const diyalog = (cevap) => ({ ac: () => ({ canceled: false, filePaths: [dosya] }), mesajCevabi: () => cevap });
    for (const [cevap, uygulanmali] of [[0, true], [1, false]]) {
      const k = aktaricKur({ klasor, diyalog: diyalog(cevap), ek: { anahtarVarMi: () => true } });
      const on = await k.aktarici.iceAktarOnizle(null);
      assert.ok(on.bolumler.includes('baglanti'));
      assert.equal(k.uygulanan.length, 0, 'önizleme sırasında uygulama yok');
      const s = await k.aktarici.iceAktar(null, on.onizlemeNo);
      assert.equal(s.ok, uygulanmali);
      assert.equal(k.uygulanan.length, uygulanmali ? 1 : 0);
    }
    const eski = aktaricKur({ klasor, diyalog: diyalog(1) });
    assert.equal((await eski.aktarici.iceAktar(null)).ok, true, 'numarasız çağrı: dosya seçtirilir ve uygulanır');
    assert.equal((await eski.aktarici.iceAktar(null, null)).ok, true, 'null numara da numarasız sayılır');
    assert.equal(eski.uygulanan.length, 2);
  } finally {
    temizle();
  }
});
