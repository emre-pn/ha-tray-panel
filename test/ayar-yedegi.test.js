'use strict';

/**
 * Göç öncesi ayar yedeği (src/lib/ayar-yedegi.js). Sahte (bellek içi) dosya sistemi kullanılır; gerçek %APPDATA%'ya
 * dokunulmaz. Son test geçici bir klasörde GERÇEK dosya sistemiyle COPYFILE_EXCL davranışını doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SEMA_SURUMU, gocGerekliMi, oncekiSemaSurumu } = require('../src/lib/ayar-sema');
const { yedekDosyaAdi, hataliYedekDosyaAdi, gocOncesiYedegiAl, hataliAlanYedegiAl } = require('../src/lib/ayar-yedegi');

const KLASOR = path.join('K', 'Ev Paneli');
const DOSYA = path.join(KLASOR, 'ayarlar.json');

/** copyFileSync'i taklit eder: COPYFILE_EXCL ile var olan hedefi ezmez (EEXIST); hata verilirse o kodla düşer. */
function sahteFs(baslangic = {}, { kopyaHatasi = null } = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  const cagrilar = [];
  return {
    dosyalar,
    cagrilar,
    copyFileSync(kaynak, hedef, bayrak = 0) {
      cagrilar.push({ kaynak, hedef, bayrak });
      if (kopyaHatasi) throw Object.assign(new Error(`${kopyaHatasi}: copyfile '${kaynak}' -> '${hedef}' TEST_ANAHTAR_000`), { code: kopyaHatasi });
      if (!dosyalar.has(kaynak)) throw Object.assign(new Error('yok'), { code: 'ENOENT' });
      if (dosyalar.has(hedef) && (bayrak & fs.constants.COPYFILE_EXCL)) throw Object.assign(new Error('var'), { code: 'EEXIST' });
      dosyalar.set(hedef, dosyalar.get(kaynak));
    },
  };
}

const gunlukToplayici = () => {
  const satirlar = [];
  const gunluk = (mesaj) => satirlar.push(mesaj);
  gunluk.satirlar = satirlar;
  return gunluk;
};

// 1.0.0'dan gelen dosya: şema sürümü alanı yok (1 sayılır). Baytlar özgün kalmalı (BOM ve girinti dahil).
const V1_METIN = '\uFEFF{\n  "yerelAdres": "http://192.168.1.10:8123",\n  "favoriler": [{ "entity_id": "light.salon_lambasi" }]\n}\n';
const V1_HAM = { yerelAdres: 'http://192.168.1.10:8123', favoriler: [{ entity_id: 'light.salon_lambasi' }] };

test('sürüm yardımcıları: alan yoksa ya da tamsayı değilse 1; güncel/yeni sürüm ve boş nesne göç sayılmaz', () => {
  assert.equal(oncekiSemaSurumu(V1_HAM), 1);
  assert.equal(oncekiSemaSurumu({ semaSurumu: '3' }), 1, 'metin sürüm tamsayı değildir');
  assert.equal(oncekiSemaSurumu({ semaSurumu: 3 }), 3);
  assert.equal(oncekiSemaSurumu(null), 1);
  assert.equal(gocGerekliMi(V1_HAM), true);
  assert.equal(gocGerekliMi({ semaSurumu: SEMA_SURUMU - 1 }), true);
  assert.equal(gocGerekliMi({ semaSurumu: SEMA_SURUMU }), false);
  assert.equal(gocGerekliMi({ semaSurumu: SEMA_SURUMU + 1 }), false);
  assert.equal(gocGerekliMi({}), false, 'boş dosyada kullanıcıdan kalan bir şey yok');
  assert.equal(gocGerekliMi(null), false);
  assert.equal(gocGerekliMi([1, 2]), false);
});

test('yedek adı: ayarlar.v<eski-sürüm>-yedek.json', () => {
  assert.equal(yedekDosyaAdi(1), 'ayarlar.v1-yedek.json');
  assert.equal(yedekDosyaAdi(4), 'ayarlar.v4-yedek.json');
});

test('1.0.0 dosyası (sürüm alanı yok): aynı klasöre ayarlar.v1-yedek.json olarak bayt bayt kopyalanır, özgün dosya değişmez', () => {
  const fs0 = sahteFs({ [DOSYA]: V1_METIN });
  const gunluk = gunlukToplayici();
  const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: fs0, gunluk });
  assert.deepEqual(sonuc, { durum: 'alindi', yedek: 'ayarlar.v1-yedek.json' });
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.v1-yedek.json')), V1_METIN);
  assert.equal(fs0.dosyalar.get(DOSYA), V1_METIN, 'özgün dosyaya dokunulmaz (yeni biçim yazımı ayrı adımdır)');
  assert.deepEqual(gunluk.satirlar, ['Ayar dosyası göçten önce yedeklendi: ayarlar.v1-yedek.json']);
});

test('ara sürüm (şema 3): yedek adı eski sürümü taşır', () => {
  const metin = '{"semaSurumu":3,"favoriler":[]}';
  const fs0 = sahteFs({ [DOSYA]: metin });
  const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: { semaSurumu: 3, favoriler: [] }, fs: fs0, gunluk: gunlukToplayici() });
  assert.deepEqual(sonuc, { durum: 'alindi', yedek: 'ayarlar.v3-yedek.json' });
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.v3-yedek.json')), metin);
});

test('yedek zaten varsa üzerine yazılmaz: içerik ve günlük değişmez, kopyalama özel-oluşturma bayrağıyla istenir', () => {
  const yedekYolu = path.join(KLASOR, 'ayarlar.v1-yedek.json');
  const fs0 = sahteFs({ [DOSYA]: V1_METIN, [yedekYolu]: 'ESKI-YEDEK' });
  const gunluk = gunlukToplayici();
  const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: fs0, gunluk });
  assert.deepEqual(sonuc, { durum: 'zaten-var', yedek: 'ayarlar.v1-yedek.json' });
  assert.equal(fs0.dosyalar.get(yedekYolu), 'ESKI-YEDEK');
  assert.equal(fs0.cagrilar.length, 1);
  assert.ok(fs0.cagrilar[0].bayrak & fs.constants.COPYFILE_EXCL, 'var olan dosya ezilemesin diye COPYFILE_EXCL kullanılır');
  assert.deepEqual(gunluk.satirlar, [], 'zaten alınmış yedek için gürültü yok');
});

test('başka sürümün yedeği varsa o sürümün yedeği yine alınır (v1 yedeği v3 yedeğini engellemez)', () => {
  const fs0 = sahteFs({ [DOSYA]: '{"semaSurumu":3}', [path.join(KLASOR, 'ayarlar.v1-yedek.json')]: 'V1' });
  const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: { semaSurumu: 3 }, fs: fs0, gunluk: gunlukToplayici() });
  assert.equal(sonuc.durum, 'alindi');
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.v1-yedek.json')), 'V1');
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.v3-yedek.json')), '{"semaSurumu":3}');
});

test('şema güncelse (boşsa, nesne değilse) hiçbir şey yapılmaz: kopya yok, günlük yok', () => {
  const durumlar = [
    { semaSurumu: SEMA_SURUMU, favoriler: [] },
    {},
    null,
    [],
    'metin',
  ];
  for (const ham of durumlar) {
    const fs0 = sahteFs({ [DOSYA]: '{}' });
    const gunluk = gunlukToplayici();
    const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham, fs: fs0, gunluk });
    assert.deepEqual(sonuc, { durum: 'gerekmedi', yedek: null }, JSON.stringify(ham));
    assert.equal(fs0.cagrilar.length, 0, JSON.stringify(ham));
    assert.deepEqual([...fs0.dosyalar.keys()], [DOSYA], JSON.stringify(ham));
    assert.deepEqual(gunluk.satirlar, [], JSON.stringify(ham));
  }
});

test('kopyalama hatası göçü durdurmaz: hata fırlatılmaz, günlüğe sırsız TEK satır (yalnız hata kodu) yazılır, özgün dosya yerinde kalır', () => {
  for (const kod of ['EPERM', 'EACCES', 'ENOSPC', 'EBUSY']) {
    const fs0 = sahteFs({ [DOSYA]: V1_METIN }, { kopyaHatasi: kod });
    const gunluk = gunlukToplayici();
    const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: fs0, gunluk });
    assert.deepEqual(sonuc, { durum: 'alinamadi', yedek: null }, kod);
    assert.equal(gunluk.satirlar.length, 1, kod);
    assert.equal(gunluk.satirlar[0], `Göç öncesi ayar yedeği alınamadı (${kod}); göç yine de sürüyor.`);
    assert.ok(!gunluk.satirlar[0].includes('TEST_ANAHTAR_000'), 'hata iletisi günlüğe girmez');
    assert.ok(!gunluk.satirlar[0].includes('Ev Paneli'), 'yol günlüğe girmez');
    assert.equal(fs0.dosyalar.get(DOSYA), V1_METIN);
  }
});

test('beklenmedik hata biçimi: kod yoksa ya da güvensizse "bilinmiyor"; günlük işlevi fırlatsa da göç sürer', () => {
  const kodsuz = { copyFileSync() { throw new Error('C:\\Users\\kisi\\gizli yol'); } };
  const gunluk = gunlukToplayici();
  assert.deepEqual(gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: kodsuz, gunluk }), { durum: 'alinamadi', yedek: null });
  assert.deepEqual(gunluk.satirlar, ['Göç öncesi ayar yedeği alınamadı (bilinmiyor); göç yine de sürüyor.']);

  const guvensiz = { copyFileSync() { throw Object.assign(new Error('x'), { code: 'EPERM yol=C:\\Users\\kisi' }); } };
  const gunluk2 = gunlukToplayici();
  gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: guvensiz, gunluk: gunluk2 });
  assert.deepEqual(gunluk2.satirlar, ['Göç öncesi ayar yedeği alınamadı (bilinmiyor); göç yine de sürüyor.']);

  const fs0 = sahteFs({ [DOSYA]: V1_METIN });
  const patlayanGunluk = () => {
    throw new Error('günlük yazılamadı');
  };
  assert.deepEqual(gocOncesiYedegiAl({ dosya: DOSYA, ham: V1_HAM, fs: fs0, gunluk: patlayanGunluk }), { durum: 'alindi', yedek: 'ayarlar.v1-yedek.json' });
});

test('gerçek dosya sistemi (geçici klasör): ilk göçte yedek alınır, sonraki göçte var olan yedek ezilmez', () => {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-yedek-test-'));
  try {
    const dosya = path.join(gecici, 'ayarlar.json');
    fs.writeFileSync(dosya, V1_METIN, 'utf8');
    const gunluk = gunlukToplayici();
    assert.equal(gocOncesiYedegiAl({ dosya, ham: V1_HAM, fs, gunluk }).durum, 'alindi');
    const yedek = path.join(gecici, 'ayarlar.v1-yedek.json');
    assert.deepEqual(fs.readFileSync(yedek), fs.readFileSync(dosya), 'bayt bayt aynı (BOM dahil)');

    fs.writeFileSync(dosya, '{"yerelAdres":"http://10.0.0.5:8123"}', 'utf8'); // dosya sonradan değişti, yedek eski kalmalı
    assert.equal(gocOncesiYedegiAl({ dosya, ham: { yerelAdres: 'http://10.0.0.5:8123' }, fs, gunluk }).durum, 'zaten-var');
    assert.equal(fs.readFileSync(yedek, 'utf8'), V1_METIN);
    assert.equal(gunluk.satirlar.length, 1);

    fs.rmSync(dosya);
    fs.rmSync(yedek);
    assert.equal(gocOncesiYedegiAl({ dosya, ham: V1_HAM, fs, gunluk: gunlukToplayici() }).durum, 'alinamadi', 'özgün dosya yoksa kopya hatası: göç durmaz, hata fırlatılmaz');
  } finally {
    fs.rmSync(gecici, { recursive: true, force: true });
  }
});

// --- h-11: kendinden YENİ şemalı dosya (eski sürüme dönüş) ---

test('h-11: dosyanın şeması uygulamanınkinden yeniyse yedek ayarlar.v<N>-yedek.json olarak alınır; günlükte "daha yeni şema" yazar', () => {
  const metin = `{"semaSurumu":${SEMA_SURUMU + 1},"yeniAlan":{"a":1}}`;
  const fs0 = sahteFs({ [DOSYA]: metin });
  const gunluk = gunlukToplayici();
  const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham: { semaSurumu: SEMA_SURUMU + 1, yeniAlan: { a: 1 } }, fs: fs0, gunluk });
  assert.deepEqual(sonuc, { durum: 'alindi', yedek: yedekDosyaAdi(SEMA_SURUMU + 1) });
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, `ayarlar.v${SEMA_SURUMU + 1}-yedek.json`)), metin, 'özgün dosyanın aynısı');
  assert.equal(gunluk.satirlar.length, 1);
  assert.match(gunluk.satirlar[0], new RegExp(`daha yeni bir şemada \\(v${SEMA_SURUMU + 1}\\).*ayarlar\\.v${SEMA_SURUMU + 1}-yedek\\.json$`));
});

test('h-11: yeni şema yedeği zaten varsa ezilmez; kopyalama hatasında açılış sürer, günlükte yalnız hata kodu olur', () => {
  const ad = path.join(KLASOR, `ayarlar.v${SEMA_SURUMU + 2}-yedek.json`);
  const fs0 = sahteFs({ [DOSYA]: 'YENI', [ad]: 'ESKI-YEDEK' });
  assert.deepEqual(gocOncesiYedegiAl({ dosya: DOSYA, ham: { semaSurumu: SEMA_SURUMU + 2 }, fs: fs0, gunluk: gunlukToplayici() }), { durum: 'zaten-var', yedek: `ayarlar.v${SEMA_SURUMU + 2}-yedek.json` });
  assert.equal(fs0.dosyalar.get(ad), 'ESKI-YEDEK');

  const hatali = sahteFs({ [DOSYA]: 'YENI' }, { kopyaHatasi: 'EPERM' });
  const gunluk = gunlukToplayici();
  assert.deepEqual(gocOncesiYedegiAl({ dosya: DOSYA, ham: { semaSurumu: SEMA_SURUMU + 1 }, fs: hatali, gunluk }), { durum: 'alinamadi', yedek: null });
  assert.deepEqual(gunluk.satirlar, ['Daha yeni şemalı ayar dosyasının yedeği alınamadı (EPERM); açılış yine de sürüyor.']);
});

test('h-11: bozuk (tamsayı olmayan) sürüm alanı "yeni şema" sayılmaz', () => {
  for (const ham of [{ semaSurumu: '99', favoriler: [] }, { semaSurumu: 99.5 }, { semaSurumu: null }]) {
    const fs0 = sahteFs({ [DOSYA]: '{}' });
    const sonuc = gocOncesiYedegiAl({ dosya: DOSYA, ham, fs: fs0, gunluk: gunlukToplayici() });
    assert.equal(sonuc.yedek, 'ayarlar.v1-yedek.json', JSON.stringify(ham)); // bozuk sürüm "eski" sayılır (güvenli kopya, v1 adı); v99 adı kullanılmaz
  }
});

// --- h-33: tipi bozuk alan yedeği ---

test('h-33: hataliAlanYedegiAl özgün dosyayı zaman damgalı adla kopyalar; var olan kopya ezilmez; hata fırlatılmaz', () => {
  assert.equal(hataliYedekDosyaAdi(123), 'ayarlar.hatali-123.json');
  const fs0 = sahteFs({ [DOSYA]: '{"favoriler":"bozuk"}' });
  const gunluk = gunlukToplayici();
  assert.deepEqual(hataliAlanYedegiAl({ dosya: DOSYA, fs: fs0, gunluk, zaman: 777 }), { durum: 'alindi', yedek: 'ayarlar.hatali-777.json' });
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.hatali-777.json')), '{"favoriler":"bozuk"}');
  assert.deepEqual(gunluk.satirlar, ['Tipi bozuk alanlı ayar dosyası üzerine yazılmadan önce yedeklendi: ayarlar.hatali-777.json']);
  // Aynı adla ikinci çağrı ezmez (COPYFILE_EXCL) ve "alınamadı" sayılır.
  fs0.dosyalar.set(DOSYA, 'DEGISTI');
  assert.equal(hataliAlanYedegiAl({ dosya: DOSYA, fs: fs0, gunluk: gunlukToplayici(), zaman: 777 }).durum, 'alinamadi');
  assert.equal(fs0.dosyalar.get(path.join(KLASOR, 'ayarlar.hatali-777.json')), '{"favoriler":"bozuk"}');
  // Kopyalama hatası: sırsız tek satır, yalnız hata kodu.
  const hatali = sahteFs({ [DOSYA]: 'X' }, { kopyaHatasi: 'EBUSY' });
  const g2 = gunlukToplayici();
  assert.deepEqual(hataliAlanYedegiAl({ dosya: DOSYA, fs: hatali, gunluk: g2 }), { durum: 'alinamadi', yedek: null });
  assert.deepEqual(g2.satirlar, ['Hatalı alanlı ayar dosyasının yedeği alınamadı (EBUSY); açılış yine de sürüyor.']);
  assert.ok(!g2.satirlar[0].includes('TEST_ANAHTAR_000'));
});
