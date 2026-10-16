'use strict';

/**
 * Eski sürümün bıraktığı yedekten kayıp bilgilerin geri alınması (src/lib/yedek-kurtarma.js).
 *
 * Bulgu: 1.4.0 ayarlarını (şema 6) AYNI klasörde (taşınabilir derleme kurulu sürümle klasör paylaşır) 1.3.0 açarsa dosyayı
 * ayarlar.v6-yedek.json olarak yedekler ve üzerine yazar: tek tıklamalı olmayan favoriler (iklim, medya, sensör...), kalan favorilerin
 * simge/renk/boyut/tepsi/kısayol eylemi alanları ve Almanca/Fransızca/İspanyolca dil seçimi düşer. Dönüşte kendiliğinden geri gelmez;
 * 1.3.0 var olan yedeği ezmediği için ikinci gidişte yeni durum yedeklenmez. Sınama gerçek geçici klasörde yapılır (%APPDATA% değil).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { yedekDosyaAdi, yedekleriListele, yedekAdiGecerliMi, EN_COK_ZAMANLI_YEDEK } = require('../src/lib/ayar-yedegi');
const { eskiSurumYedeginiOku, eskiSurumKaybiniTamamla, eskiSurumYedeginiKenaraAl, eskiSurumYedeginiDevral } = require('../src/lib/yedek-kurtarma');
const varsayilan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));

const YEDEK_AD = yedekDosyaAdi(SEMA_SURUMU);

/** 1.4.0'ın kaydettiği ayar dosyası (yedeğin içeriği). */
const dortSifirDosyasi = () => ({
  semaSurumu: SEMA_SURUMU,
  yerelAdres: 'http://192.168.1.50:8123',
  dil: 'de',
  favoriler: [
    { entity_id: 'light.salon', ad: 'Salon', simge: 'ikon:isik', renk: 'sari', boyut: 'genis', tepsi: true, kisayol: 'Ctrl+Alt+1', kisayolEylemi: 'kapat' },
    { entity_id: 'climate.salon', ad: 'Klima', simge: 'ikon:gunes', renk: 'mavi' },
    { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Ctrl+Alt+2' },
    { entity_id: 'sensor.sicaklik', ad: 'Sicaklik', boyut: 'genis' },
    { entity_id: 'humidifier.oda', ad: 'Nem', kisayol: 'Ctrl+Alt+3' },
    { entity_id: 'media_player.tv', ad: 'TV' },
  ],
});

/**
 * 1.3.0'ın o dosyayı açıp yazdığı hal (bulguda ölçülen davranış): tek tıklamalı olmayan favoriler düştü ("alan" nedeniyle
 * engellenenlere yazıldı), kalan favorilerin yeni alanları silindi, dil 'sistem'e döndü; kullanıcı orada bir ışık ekledi ve bir prizi sildi.
 */
const uconSifirSonrasi = () => ({
  semaSurumu: SEMA_SURUMU,
  yerelAdres: 'http://192.168.1.50:8123',
  dil: 'sistem',
  favoriler: [
    { entity_id: 'light.salon', ad: 'Salon', kisayol: 'Ctrl+Alt+1' },
    { entity_id: 'light.mutfak', ad: 'Mutfak', kisayol: 'Ctrl+Alt+3' },
  ],
  engellenenFavoriler: [
    { entity_id: 'climate.salon', neden: 'alan' },
    { entity_id: 'sensor.sicaklik', neden: 'alan' },
    { entity_id: 'light.kapi_lambasi', neden: 'guvenlik' },
  ],
});

const yukle = (ham) => ayarlariDuzelt(ham, { varsayilan }).ayarlar;
const kimlikler = (ayarlar) => ayarlar.favoriler.map((f) => f.entity_id);

function gecici(govde) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-kurtarma-test-'));
  try {
    return govde(dizin);
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
}
const yaz = (dizin, ad, icerik) => fs.writeFileSync(path.join(dizin, ad), typeof icerik === 'string' ? icerik : JSON.stringify(icerik), 'utf8');
const oku = (dizin, ad) => JSON.parse(fs.readFileSync(path.join(dizin, ad), 'utf8'));

/** 1.3.0'ın davranışı: yedek adı boşsa ayarlar.json'u COPYFILE_EXCL ile yedekler (var olan yedeği ezmez), sonra dosyanın üzerine yazar. */
function eskiSurumGidisi(dizin, yeniIcerik) {
  let yedeklendi = true;
  try {
    fs.copyFileSync(path.join(dizin, 'ayarlar.json'), path.join(dizin, YEDEK_AD), fs.constants.COPYFILE_EXCL);
  } catch (hata) {
    if (hata.code !== 'EEXIST') throw hata;
    yedeklendi = false;
  }
  yaz(dizin, 'ayarlar.json', yeniIcerik);
  return yedeklendi;
}

test('bulgu: 1.3.0 gidiş-dönüşünde düşen favoriler yedekten ÖZGÜN SIRAYLA geri gelir; kalan favorilerin simge/renk/boyut/tepsi/kısayol eylemi dolar; dil geri gelir', () => {
  const mevcut = yukle(uconSifirSonrasi());
  assert.deepEqual(kimlikler(mevcut), ['light.salon', 'light.mutfak'], 'öncesi: iklim, sensör, medya, nem yok');
  assert.equal(mevcut.favoriler[0].simge, undefined);
  assert.equal(mevcut.dil, 'sistem');

  const sonuc = eskiSurumKaybiniTamamla(mevcut, dortSifirDosyasi(), { varsayilan });
  assert.equal(sonuc.degisti, true);
  assert.deepEqual(sonuc.geriAlinanFavoriler, ['climate.salon', 'sensor.sicaklik', 'humidifier.oda', 'media_player.tv']);
  assert.deepEqual(sonuc.doldurulanFavoriler, ['light.salon']);
  assert.equal(sonuc.dilGeriAlindi, true);
  // sıra: light.salon'un hemen arkasına yedekteki sırayla; 1.3.0'da eklenen light.mutfak sonda kalır
  assert.deepEqual(kimlikler(sonuc.ayarlar), ['light.salon', 'climate.salon', 'sensor.sicaklik', 'humidifier.oda', 'media_player.tv', 'light.mutfak']);
  const salon = sonuc.ayarlar.favoriler[0];
  assert.deepEqual({ simge: salon.simge, renk: salon.renk, boyut: salon.boyut, tepsi: salon.tepsi, kisayolEylemi: salon.kisayolEylemi }, { simge: 'ikon:isik', renk: 'sari', boyut: 'genis', tepsi: true, kisayolEylemi: 'kapat' });
  assert.equal(salon.kisayol, mevcut.favoriler[0].kisayol, 'var olan kısayola dokunulmaz');
  assert.deepEqual({ simge: sonuc.ayarlar.favoriler[1].simge, renk: sonuc.ayarlar.favoriler[1].renk }, { simge: 'ikon:gunes', renk: 'mavi' });
  assert.equal(sonuc.ayarlar.favoriler.find((f) => f.entity_id === 'sensor.sicaklik').boyut, 'genis');
  assert.equal(sonuc.ayarlar.dil, 'de');
  // eski sürümün "alan" nedeniyle yazdığı engel kayıtları geri alınanlar için silinir; gerçek (güvenlik) engeli kalır
  assert.deepEqual(sonuc.ayarlar.engellenenFavoriler, [{ entity_id: 'light.kapi_lambasi', neden: 'guvenlik' }]);
});

test('kullanıcı eski sürümde BİLEREK sildiği favori geri gelmez: eski sürümün tanıdığı alandaki (switch.priz) eksik favori yedekte olsa da alınmaz', () => {
  const mevcut = yukle(uconSifirSonrasi());
  assert.ok(!kimlikler(mevcut).includes('switch.priz'));
  const sonuc = eskiSurumKaybiniTamamla(mevcut, dortSifirDosyasi(), { varsayilan });
  assert.ok(!kimlikler(sonuc.ayarlar).includes('switch.priz'));
  // 1.3.0'ın tanıdığı her alan için aynı kural
  for (const alan of ['light', 'switch', 'fan', 'input_boolean', 'scene', 'script', 'button', 'input_button']) {
    const yedek = { ...dortSifirDosyasi(), dil: 'tr', favoriler: [{ entity_id: `${alan}.silinen`, ad: 'Silinen' }] };
    assert.equal(eskiSurumKaybiniTamamla(yukle({ ...uconSifirSonrasi(), favoriler: [] }), yedek, { varsayilan }).degisti, false, alan);
  }
});

test('kısayol çakışması: geri alınan favorinin kısayolu mevcut bir kısayolu ele geçirmez (humidifier.oda "Ctrl+Alt+3" mutfak lambasında); kısayolsuz geri gelir', () => {
  const mevcut = yukle(uconSifirSonrasi());
  const sonuc = eskiSurumKaybiniTamamla(mevcut, dortSifirDosyasi(), { varsayilan });
  const nem = sonuc.ayarlar.favoriler.find((f) => f.entity_id === 'humidifier.oda');
  assert.ok(nem, 'favori geri geldi');
  assert.equal(nem.kisayol, undefined, 'çakışan kısayol atıldı');
  assert.equal(sonuc.ayarlar.favoriler.find((f) => f.entity_id === 'light.mutfak').kisayol, mevcut.favoriler[1].kisayol, 'mutfak lambasının kısayolu yerinde');
  // çakışma yoksa kısayol da geri gelir
  const serbest = yukle({ ...uconSifirSonrasi(), favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }] });
  const geri = eskiSurumKaybiniTamamla(serbest, dortSifirDosyasi(), { varsayilan });
  assert.equal(geri.ayarlar.favoriler.find((f) => f.entity_id === 'humidifier.oda').kisayol, 'Control+Alt+3');
  // ana/palet kısayoluyla çakışma da engellenir
  const anaKisayol = { ...serbest, kisayol: 'Ctrl+Alt+3' };
  const cakisan = eskiSurumKaybiniTamamla(yukle({ ...anaKisayol, favoriler: serbest.favoriler }), dortSifirDosyasi(), { varsayilan });
  assert.equal(cakisan.ayarlar.favoriler.find((f) => f.entity_id === 'humidifier.oda').kisayol, undefined);
});

test('işlem tekrarlanırsa değişmez (idempotent) ve girdiler değiştirilmez; yedekte yeni bir şey yoksa ayarlar nesnesi aynen döner', () => {
  const mevcut = yukle(uconSifirSonrasi());
  const mevcutOnce = JSON.stringify(mevcut);
  const yedek = dortSifirDosyasi();
  const yedekOnce = JSON.stringify(yedek);
  const bir = eskiSurumKaybiniTamamla(mevcut, yedek, { varsayilan });
  assert.equal(JSON.stringify(mevcut), mevcutOnce, 'mevcut ayarlar değişmedi');
  assert.equal(JSON.stringify(yedek), yedekOnce, 'yedek değişmedi');
  const iki = eskiSurumKaybiniTamamla(bir.ayarlar, yedek, { varsayilan });
  assert.equal(iki.degisti, false);
  assert.equal(iki.ayarlar, bir.ayarlar, 'değişmediyse aynı nesne');
  assert.deepEqual(iki.geriAlinanFavoriler, []);
});

test('dil: yalnız eski sürümün tanımadığı dil (de/fr/es) ve yalnız şimdiki "sistem" iken geri alınır; açık seçim ya da tr/en yedeği dokunulmaz', () => {
  const dilli = (dil) => ({ ...dortSifirDosyasi(), dil, favoriler: [] });
  const sistemde = yukle({ ...uconSifirSonrasi(), favoriler: [], dil: 'sistem' });
  for (const dil of ['de', 'fr', 'es']) assert.equal(eskiSurumKaybiniTamamla(sistemde, dilli(dil), { varsayilan }).ayarlar.dil, dil, dil);
  for (const dil of ['tr', 'en', 'sistem']) assert.equal(eskiSurumKaybiniTamamla(sistemde, dilli(dil), { varsayilan }).degisti, false, `${dil}: 1.3.0 zaten korurdu`);
  const acik = yukle({ ...uconSifirSonrasi(), favoriler: [], dil: 'en' });
  assert.equal(eskiSurumKaybiniTamamla(acik, dilli('de'), { varsayilan }).degisti, false, 'kullanıcı sonradan açıkça İngilizce seçmiş');
  assert.equal(eskiSurumKaybiniTamamla(sistemde, dilli('klingon'), { varsayilan }).degisti, false, 'geçersiz dil alınmaz');
});

test('Kapı Kuralı geri almada da geçerli: yedekteki kapı/kilit/garaj/Almanca-Fransızca-İspanyolca kapı adlı favoriler ve yasak alanlar geri gelmez', () => {
  const yedek = {
    ...dortSifirDosyasi(),
    favoriler: [
      { entity_id: 'climate.garaj', ad: 'Garaj ısıtıcı' },
      { entity_id: 'sensor.haustur_temperatur', ad: 'Haustür Temperatur' },
      { entity_id: 'sensor.puerta_entrada', ad: 'Puerta entrada' },
      { entity_id: 'media_player.portail', ad: 'Portail' },
      { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
      { entity_id: 'cover.perde', ad: 'Perde' },
      { entity_id: 'sensor.mutfak_sicaklik', ad: 'Mutfak sıcaklığı' },
    ],
  };
  const sonuc = eskiSurumKaybiniTamamla(yukle({ ...uconSifirSonrasi(), favoriler: [] }), yedek, { varsayilan });
  assert.deepEqual(sonuc.geriAlinanFavoriler, ['sensor.mutfak_sicaklik']);
  assert.deepEqual(kimlikler(sonuc.ayarlar), ['sensor.mutfak_sicaklik']);
});

test('sınır: favori üst sınırı (200) doluysa geri alınanlar sığdığı kadar alınır; VAR OLAN favoriler asla düşmez, sığmayanlar "geri alındı" sayılmaz', () => {
  const dolu = Array.from({ length: 199 }, (_, i) => ({ entity_id: `light.l${i}`, ad: `Lamba ${i}` }));
  const mevcut = yukle({ ...uconSifirSonrasi(), favoriler: dolu });
  assert.equal(mevcut.favoriler.length, 199);
  const sonuc = eskiSurumKaybiniTamamla(mevcut, dortSifirDosyasi(), { varsayilan });
  assert.equal(sonuc.ayarlar.favoriler.length, 200);
  assert.deepEqual(sonuc.geriAlinanFavoriler, ['climate.salon'], 'yedek sırasındaki ilk, sığan bir favori');
  for (const f of dolu) assert.ok(kimlikler(sonuc.ayarlar).includes(f.entity_id), `${f.entity_id} düşmemeli`);
  // sınır tamamen doluysa hiçbir şey geri alınmaz, ayarlar aynen kalır
  const tam = yukle({ ...uconSifirSonrasi(), favoriler: [...dolu, { entity_id: 'light.son', ad: 'Son' }], dil: 'tr' });
  const hicbiri = eskiSurumKaybiniTamamla(tam, { ...dortSifirDosyasi(), dil: 'tr' }, { varsayilan });
  assert.equal(hicbiri.degisti, false);
  assert.equal(hicbiri.ayarlar, tam);
});

test('kısayollu favori sınırı: sınır doluysa geri alınan favori kısayolsuz gelir', () => {
  const kisayollu = ['1', '2', '3', '4', '5'].map((n) => ({ entity_id: `switch.k${n}`, ad: `Priz ${n}`, kisayol: `Ctrl+Shift+${n}` }));
  const mevcut = yukle({ ...uconSifirSonrasi(), favoriler: kisayollu });
  assert.equal(mevcut.favoriler.filter((f) => f.kisayol).length, 5);
  const sonuc = eskiSurumKaybiniTamamla(mevcut, dortSifirDosyasi(), { varsayilan });
  assert.equal(sonuc.ayarlar.favoriler.find((f) => f.entity_id === 'humidifier.oda').kisayol, undefined);
  assert.equal(sonuc.ayarlar.favoriler.filter((f) => f.kisayol).length, 5);
});

test('eskiSurumYedeginiOku: yoksa, bu şemanın dosyası değilse, nesne değilse, bozuksa ya da çok büyükse null', () => {
  gecici((dizin) => {
    assert.equal(eskiSurumYedeginiOku({ dizin }), null, 'dosya yok');
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const okunan = eskiSurumYedeginiOku({ dizin });
    assert.equal(okunan.ad, YEDEK_AD);
    assert.equal(okunan.ham.dil, 'de');
    for (const kotu of [{ ...dortSifirDosyasi(), semaSurumu: SEMA_SURUMU - 1 }, { ...dortSifirDosyasi(), semaSurumu: SEMA_SURUMU + 1 }, { ...dortSifirDosyasi(), semaSurumu: String(SEMA_SURUMU) }, [1], 'metin', null, 5, { favoriler: [] }]) {
      yaz(dizin, YEDEK_AD, kotu);
      assert.equal(eskiSurumYedeginiOku({ dizin }), null, JSON.stringify(kotu).slice(0, 40));
    }
    yaz(dizin, YEDEK_AD, '{bozuk');
    assert.equal(eskiSurumYedeginiOku({ dizin }), null);
    yaz(dizin, YEDEK_AD, JSON.stringify({ semaSurumu: SEMA_SURUMU, dolgu: 'x'.repeat(600 * 1024) }));
    assert.equal(eskiSurumYedeginiOku({ dizin }), null, '512 KB sınırı');
  });
});

test('eskiSurumYedeginiKenaraAl: kanonik yedek zaman damgalı adla saklanır (silinmez), eski sürüm adı yeniden boş bulur; hata fırlatılmaz', () => {
  gecici((dizin) => {
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const ad = eskiSurumYedeginiKenaraAl({ dizin, fs, simdi: 1_760_000_000_123 });
    assert.equal(ad, yedekDosyaAdi(SEMA_SURUMU, 1_760_000_000_123));
    assert.equal(fs.existsSync(path.join(dizin, YEDEK_AD)), false);
    assert.deepEqual(oku(dizin, ad), dortSifirDosyasi(), 'içerik aynen saklandı');
    // yeniden adlandırılacak dosya yok: null, günlüğe yalnız hata kodu
    const satirlar = [];
    assert.equal(eskiSurumYedeginiKenaraAl({ dizin, fs, simdi: 1_760_000_000_456, gunluk: (m) => satirlar.push(m) }), null);
    assert.equal(satirlar.length, 1);
    assert.match(satirlar[0], /^Eski sürüm yedeği kenara alınamadı \(ENOENT\); açılış yine de sürüyor\.$/);
    assert.ok(!satirlar[0].includes(dizin), 'günlüğe yol girmez');
  });
});

test('eskiSurumYedeginiKenaraAl: en yeni EN_COK_ZAMANLI_YEDEK zaman damgalı yedek tutulur; kanonik ad, başka şemaların ve başka türden dosyalar silinmez', () => {
  gecici((dizin) => {
    const zamanlar = Array.from({ length: EN_COK_ZAMANLI_YEDEK + 3 }, (_, i) => 1_700_000_000_000 + i);
    for (const z of zamanlar) yaz(dizin, yedekDosyaAdi(SEMA_SURUMU, z), { z });
    yaz(dizin, yedekDosyaAdi(SEMA_SURUMU + 1, 1_600_000_000_000), '{}');
    yaz(dizin, yedekDosyaAdi(SEMA_SURUMU - 1, 1_600_000_000_000), '{}');
    yaz(dizin, 'ayarlar.hatali-1600000000000.json', '{}');
    yaz(dizin, 'ayarlar.bozuk-1600000000000.json', '{}');
    yaz(dizin, 'ayarlar.json', '{}');
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const ad = eskiSurumYedeginiKenaraAl({ dizin, fs, simdi: 1_760_000_000_000 });
    const kalan = fs.readdirSync(dizin).filter((a) => a.startsWith(`ayarlar.v${SEMA_SURUMU}-yedek-`)).sort();
    assert.equal(kalan.length, EN_COK_ZAMANLI_YEDEK);
    assert.ok(kalan.includes(ad), 'yeni alınan yedek tutulur');
    assert.deepEqual(kalan, [ad, ...zamanlar.slice(-(EN_COK_ZAMANLI_YEDEK - 1)).map((z) => yedekDosyaAdi(SEMA_SURUMU, z))].sort());
    for (const dokunulmaz of [yedekDosyaAdi(SEMA_SURUMU + 1, 1_600_000_000_000), yedekDosyaAdi(SEMA_SURUMU - 1, 1_600_000_000_000), 'ayarlar.hatali-1600000000000.json', 'ayarlar.bozuk-1600000000000.json', 'ayarlar.json']) {
      assert.ok(fs.existsSync(path.join(dizin, dokunulmaz)), `${dokunulmaz} silinmemeli`);
    }
  });
});

test('saat geriye alınmış olsa da yeni alınan yedek budanmaz', () => {
  gecici((dizin) => {
    for (let i = 0; i < EN_COK_ZAMANLI_YEDEK + 2; i += 1) yaz(dizin, yedekDosyaAdi(SEMA_SURUMU, 1_900_000_000_000 + i), '{}');
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const ad = eskiSurumYedeginiKenaraAl({ dizin, fs, simdi: 1_700_000_000_000 }); // bütün öncekilerden ESKİ bir zaman
    assert.ok(fs.existsSync(path.join(dizin, ad)));
  });
});

test('yeniden adlandırma başarısızsa (EPERM) yedek yerinde kalır, hata fırlatılmaz, günlüğe yalnız hata kodu yazılır', () => {
  gecici((dizin) => {
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const satirlar = [];
    const kilitli = { ...fs, renameSync() { throw Object.assign(new Error(`EPERM: ${dizin} TEST_ANAHTAR_000`), { code: 'EPERM' }); } };
    assert.equal(eskiSurumYedeginiKenaraAl({ dizin, fs: kilitli, gunluk: (m) => satirlar.push(m) }), null);
    assert.ok(fs.existsSync(path.join(dizin, YEDEK_AD)));
    assert.deepEqual(satirlar, ['Eski sürüm yedeği kenara alınamadı (EPERM); açılış yine de sürüyor.']);
  });
});

test('eskiSurumYedeginiDevral: ayar dosyası okunamadıysa/bozuksa (ham null) ya da şema eskiyse (göç sürüyor) yedeğe HİÇ bakılmaz ve dokunulmaz', () => {
  gecici((dizin) => {
    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const mevcut = yukle({ ...uconSifirSonrasi(), favoriler: [] });
    for (const ham of [null, undefined, [], 'metin', { ...uconSifirSonrasi(), semaSurumu: SEMA_SURUMU - 1 }, {}]) {
      const devir = eskiSurumYedeginiDevral({ dizin, ayarlar: mevcut, ham, varsayilan, fs });
      assert.equal(devir.ayarlar, mevcut, JSON.stringify(ham));
      assert.equal(devir.geriAlindi, false);
      assert.equal(devir.yedek, null);
      assert.equal(devir.tuket(), null);
      assert.ok(fs.existsSync(path.join(dizin, YEDEK_AD)), 'yedek yerinde');
    }
  });
});

test('eskiSurumYedeginiDevral: yedek yoksa ya da geçersizse etkisiz; geçerliyse birleşir, günlüğe yalnız sayılar yazılır, tuket yedeği kenara alır', () => {
  gecici((dizin) => {
    const ham = uconSifirSonrasi();
    const mevcut = yukle(ham);
    const yok = eskiSurumYedeginiDevral({ dizin, ayarlar: mevcut, ham, varsayilan, fs });
    assert.equal(yok.geriAlindi, false);
    assert.equal(yok.yedek, null);
    yaz(dizin, YEDEK_AD, '{bozuk');
    assert.equal(eskiSurumYedeginiDevral({ dizin, ayarlar: mevcut, ham, varsayilan, fs }).geriAlindi, false);
    assert.ok(fs.existsSync(path.join(dizin, YEDEK_AD)), 'geçersiz yedek de silinmez');

    yaz(dizin, YEDEK_AD, dortSifirDosyasi());
    const satirlar = [];
    const devir = eskiSurumYedeginiDevral({ dizin, ayarlar: mevcut, ham, varsayilan, fs, gunluk: (m) => satirlar.push(m), simdi: () => 1_760_000_000_999 });
    assert.equal(devir.geriAlindi, true);
    assert.equal(devir.yedek, YEDEK_AD);
    assert.equal(kimlikler(devir.ayarlar).length, 6);
    assert.deepEqual(satirlar, ['Eski sürümün bıraktığı yedekten geri alındı: 4 favori, 1 favorinin görünüm alanları, dil seçimi.']);
    assert.ok(fs.existsSync(path.join(dizin, YEDEK_AD)), 'tuket çağrılana kadar (ayarlar kaydedilene kadar) yedek yerinde');
    assert.equal(devir.tuket(), yedekDosyaAdi(SEMA_SURUMU, 1_760_000_000_999));
    assert.equal(fs.existsSync(path.join(dizin, YEDEK_AD)), false);
  });
});

test('GİDİŞ-DÖNÜŞ: eski sürüm var olan yedeği ezmez (ikinci gidişte yeni durum yedeksiz kalırdı); yedek tüketilince ikinci gidiş de yedeklenir ve ikinci dönüşte de kurtarılır', () => {
  gecici((dizin) => {
    // 1) 1.4.0 dosyası; 1.3.0 açar: yedek alır ve üzerine yazar
    yaz(dizin, 'ayarlar.json', dortSifirDosyasi());
    assert.equal(eskiSurumGidisi(dizin, uconSifirSonrasi()), true, 'ilk gidiş yedeklendi');
    // 2) 1.4.0 geri döner: kurtarır, kaydeder, yedeği tüketir
    const ham = oku(dizin, 'ayarlar.json');
    const devir = eskiSurumYedeginiDevral({ dizin, ayarlar: yukle(ham), ham, varsayilan, fs, simdi: () => 1_760_000_100_000 });
    assert.equal(devir.geriAlindi, true);
    yaz(dizin, 'ayarlar.json', { ...devir.ayarlar, favoriler: [...devir.ayarlar.favoriler, { entity_id: 'fan.yeni_vantilator', ad: 'Yeni vantilatör' }, { entity_id: 'sensor.yeni_nem', ad: 'Yeni nem' }] }); // kullanıcı 1.4.0'da yeni favoriler ekledi
    devir.tuket();
    // 3) ikinci gidiş: 1.3.0 yedek adını BOŞ bulur, o günkü durumu yedekler (tüketilmeseydi 'zaten-var' deyip yedeksiz üzerine yazardı)
    assert.equal(eskiSurumGidisi(dizin, { ...uconSifirSonrasi(), favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }, { entity_id: 'fan.yeni_vantilator', ad: 'Yeni vantilatör' }] }), true, 'ikinci gidiş de yedeklendi');
    assert.ok(oku(dizin, YEDEK_AD).favoriler.some((f) => f.entity_id === 'sensor.yeni_nem'), 'yedek yeni durumu taşır');
    // 4) ikinci dönüş: 1.4.0 sonradan eklenen sensör favorisini de kurtarır
    const ham2 = oku(dizin, 'ayarlar.json');
    const devir2 = eskiSurumYedeginiDevral({ dizin, ayarlar: yukle(ham2), ham: ham2, varsayilan, fs, simdi: () => 1_760_000_200_000 });
    assert.equal(devir2.geriAlindi, true);
    assert.ok(kimlikler(devir2.ayarlar).includes('sensor.yeni_nem'), 'ikinci gidiş-dönüşte eklenen favori de kurtarıldı');
    assert.ok(kimlikler(devir2.ayarlar).includes('climate.salon'));
    devir2.tuket();
    // iki tüketilmiş yedek de saklı ve "Yedekten geri dön" listesinde görünür
    const liste = yedekleriListele({ dizin, fs });
    assert.deepEqual(liste.map((y) => y.ad).sort(), [yedekDosyaAdi(SEMA_SURUMU, 1_760_000_100_000), yedekDosyaAdi(SEMA_SURUMU, 1_760_000_200_000)]);
    assert.deepEqual(liste.map((y) => y.zaman), [1_760_000_200_000, 1_760_000_100_000], 'en yeni önce; zaman adın içindeki damga');
    assert.ok(liste.every((y) => y.tur === 'goc' && y.surum === SEMA_SURUMU && y.okunabilir));
    for (const y of liste) assert.equal(yedekAdiGecerliMi(y.ad), true);
  });
});

test('ESKİ davranış gösterimi: yedek tüketilmezse eski sürümün ikinci gidişi yedek alamaz (COPYFILE_EXCL) — tüketme adımının gerekçesi', () => {
  gecici((dizin) => {
    yaz(dizin, 'ayarlar.json', dortSifirDosyasi());
    assert.equal(eskiSurumGidisi(dizin, uconSifirSonrasi()), true);
    yaz(dizin, 'ayarlar.json', { ...dortSifirDosyasi(), favoriler: [...dortSifirDosyasi().favoriler, { entity_id: 'sensor.yeni', ad: 'Yeni' }] });
    assert.equal(eskiSurumGidisi(dizin, uconSifirSonrasi()), false, 'yedek adı dolu: ikinci gidiş yedeklenmedi');
    assert.ok(!oku(dizin, YEDEK_AD).favoriler.some((f) => f.entity_id === 'sensor.yeni'), 'yeni favori hiçbir yedekte yok');
  });
});
