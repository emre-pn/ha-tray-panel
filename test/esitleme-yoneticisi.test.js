'use strict';

/**
 * Klasör tabanlı ayar eşitleme yöneticisi (o-58; src/esitleme-yoneticisi.js). Gerçek geçici klasör, sahte saat/zamanlayıcı/izleyici ve bellek içi
 * parola deposu (test/esitleme-sahte.js); iki "bilgisayar" aynı klasörü paylaşır. Ağ, Electron ve gerçek ayar klasörü yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ayarlarYap, geciciKlasor, sahteParolaDeposu, bilgisayarKur, BASLANGIC } = require('./esitleme-sahte');
const { DOSYA_ADI, ozetle } = require('../src/lib/ayar-esitleme');
const { BOLUMLER, BOLUM_ADLARI } = require('../src/lib/esitleme-bolumleri');
const { YOKLAMA_MS, KLASOR_OLAYI_BEKLEME_MS, DEGISIKLIK_BEKLEME_MS, ACILIS_BEKLEME_MS } = require('../src/esitleme-yoneticisi');

const AYGIT_A = 'aaaaaaaaaaaaaaaa';
const AYGIT_B = 'bbbbbbbbbbbbbbbb';
const SALON = { entity_id: 'light.salon', ad: 'Salon' };
const MUTFAK = { entity_id: 'light.mutfak', ad: 'Mutfak' };

const ortam = (govde) => async () => {
  const gecici = geciciKlasor();
  try {
    await govde(gecici.klasor);
  } finally {
    gecici.temizle();
  }
};
const dosyaBelgesi = (m) => JSON.parse(m.dosyaOku());
const yazBelge = (klasor, belge, ad = DOSYA_ADI) => fs.writeFileSync(path.join(klasor, ad), `${JSON.stringify(belge, null, 2)}\n`, 'utf8');
const bolumGirdisi = (ayarlar, zaman, aygit = AYGIT_B) => ({ zaman, aygit, ayarlar });
const belgeYap = (bolumler) => ({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, semaSurumu: 6, bolumler });

test(
  'varsayılan KAPALI: yönetici hiçbir şey izlemez, hiçbir dosya yazmaz; açıkça açılmadan eşitleme çalışmaz',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, acik: false });
    assert.equal(a.ayarlar.klasorEsitleme, false);
    a.yonetici.baslat();
    assert.equal(a.izle.kayitlar.length, 0);
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
    assert.equal(a.zaman.aralikSayisi(), 0);
    assert.deepEqual(await a.yonetici.esitle({}), { ok: false, neden: 'kapali' });
    a.yonetici.yerelDegisti();
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
    assert.deepEqual(fs.readdirSync(klasor), []);
    const d = await a.yonetici.durum();
    assert.equal(d.acik, false);
    assert.equal(d.asama, 'kapali');
  }),
);

test(
  'ilk bilgisayar: klasör boşsa yerel ayarlar bölüm bölüm yazılır; dosyada adres, anahtar, parola ve makineye özgü alan yok; yerel kayıt saklanır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({
      klasor,
      aygit: AYGIT_A,
      ayarEk: { yerelAdres: 'http://192.168.1.77:8123', disAdres: 'https://gizli-ev.example.org', temaZorla: 'acik', favoriler: [SALON, MUTFAK], kisayol: 'Control+Alt+J' },
    });
    const sonuc = await a.esitle();
    assert.equal(sonuc.ok, true);
    assert.equal(a.dosyaVarMi(), true);
    const metin = a.dosyaOku();
    const belge = JSON.parse(metin);
    assert.deepEqual(Object.keys(belge.bolumler).sort(), [...BOLUM_ADLARI].sort());
    assert.equal(belge.bolumler.gorunum.ayarlar.temaZorla, 'acik');
    assert.deepEqual(belge.bolumler.favoriler.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon', 'light.mutfak']);
    assert.equal(belge.bolumler.kisayollar.ayarlar.kisayol, 'Control+Alt+J');
    for (const yasak of ['192.168.1.77', 'gizli-ev.example.org', 'yerelAdres', 'disAdres', 'klasorEsitleme', 'esitlemeKlasoru', 'esitlemeDurumu', 'otomatikBaslat', 'pencereKonumlari']) {
      assert.equal(metin.includes(yasak), false, `dosyada ${yasak} var`);
    }
    for (const ad of BOLUM_ADLARI) {
      assert.equal(belge.bolumler[ad].aygit, AYGIT_A);
      assert.equal(belge.bolumler[ad].ozet, ozetle(belge.bolumler[ad].ayarlar));
      assert.equal(belge.bolumler[ad].zaman, a.saat.t);
      assert.deepEqual(Object.keys(belge.bolumler[ad].ayarlar).filter((k) => !BOLUMLER[ad].includes(k)), []);
    }
    assert.equal(a.durum.iceAktar.length, 0, 'ilk bilgisayar hiçbir şey uygulamadı');
    assert.equal(a.durum.yedek, 0);
    assert.equal(a.ayarlar.esitlemeDurumu.aygit, AYGIT_A);
    assert.deepEqual(Object.keys(a.ayarlar.esitlemeDurumu.bolumler).sort(), [...BOLUM_ADLARI].sort());
    assert.ok(a.durum.ayarYazimi >= 1, 'yerel kayıt ayar dosyasına yazıldı');
    assert.deepEqual(fs.readdirSync(klasor), [DOSYA_ADI], 'geçici dosya kalmadı');
    const d = await a.yonetici.durum();
    assert.equal(d.asama, 'tamam');
    assert.deepEqual(d.son, { zaman: a.saat.t, uygulanan: 0, yazilan: 5 });
    // ikinci tur: değişiklik yok -> dosyaya dokunulmaz
    const once = fs.statSync(a.dosyaYolu()).mtimeMs;
    const metinOnce = a.dosyaOku();
    await a.esitle();
    assert.equal(a.dosyaOku(), metinOnce);
    assert.equal(fs.statSync(a.dosyaYolu()).mtimeMs, once);
  }),
);

test(
  'ikinci bilgisayar: klasördeki bölümler alınır (önce ayar yedeği), adresler değişmez; sonraki turda dosyaya geri yazılmaz',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { yerelAdres: 'http://192.168.1.77:8123', temaZorla: 'acik', favoriler: [SALON, MUTFAK], bildirimPilEsigi: 35 } });
    await a.esitle();
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { yerelAdres: 'http://10.0.0.5:8123', temaZorla: 'koyu', favoriler: [] } });
    const metinOnce = b.dosyaOku();
    const sonuc = await b.esitle();
    assert.equal(sonuc.ok, true);
    assert.equal(b.ayarlar.temaZorla, 'acik');
    assert.deepEqual(b.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon', 'light.mutfak']);
    assert.equal(b.ayarlar.bildirimPilEsigi, 35);
    assert.equal(b.ayarlar.yerelAdres, 'http://10.0.0.5:8123', 'adres eşitlenmez');
    assert.equal(b.durum.yedek, 1, 'klasörden ilk uygulamadan önce yedek alındı');
    assert.deepEqual(b.durum.uygulandi, [['favoriler', 'gorunum', 'bildirim']], 'yalnız içeriği farklı olan bölümler uygulandı (kısayollar ve bilgi aynıydı)');
    assert.equal(b.dosyaOku(), metinOnce, 'tüm bölümler klasörden alındı: dosya aynı kaldı');
    assert.deepEqual(b.ayarlar.esitlemeDurumu.bolumler.gorunum, { ozet: ozetle(JSON.parse(metinOnce).bolumler.gorunum.ayarlar), zaman: JSON.parse(metinOnce).bolumler.gorunum.zaman, aygit: AYGIT_A });
    await b.esitle();
    assert.equal(b.durum.yedek, 1, 'yedek yalnız ilk uygulamadan önce');
    assert.equal(b.dosyaOku(), metinOnce);
  }),
);

test(
  'bölüm bazlı birleştirme: iki bilgisayar farklı bölümleri değiştirirse ikisi de korunur; aynı bölümde sonraki damga kazanır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu', favoriler: [SALON] } });
    await a.esitle();
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { favoriler: [] }, saat: a.saat });
    await b.esitle();
    assert.equal(b.ayarlar.temaZorla, 'koyu');

    // A favorileri, B temayı değiştirir (farklı bölümler)
    a.ayarlar.favoriler = [SALON, MUTFAK];
    a.ilerle(10_000);
    await a.esitle();
    b.ayarlar.temaZorla = 'acik';
    b.ilerle(10_000);
    await b.esitle();
    await a.esitle();
    await b.esitle();
    for (const m of [a, b]) {
      assert.equal(m.ayarlar.temaZorla, 'acik');
      assert.deepEqual(m.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon', 'light.mutfak']);
    }

    // Aynı bölümde çakışma: A önce, B sonra değiştirir; ikisi de çevrimdışıyken (klasöre yazmadan) -> sonraki damga (B) kazanır
    a.ayarlar.temaZorla = 'koyu';
    a.ilerle(1_000);
    await a.esitle({ elle: true }); // A damgasını klasöre yazar
    b.ilerle(5_000);
    b.ayarlar.temaZorla = 'sistem';
    await b.esitle(); // B daha yeni damgayla ezer
    await a.esitle();
    assert.equal(a.ayarlar.temaZorla, 'sistem');
    assert.equal(b.ayarlar.temaZorla, 'sistem');
    assert.equal(JSON.parse(a.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'sistem');
  }),
);

test(
  'saat farkı: geride kalan saatli bilgisayarın SONRAKİ değişikliği yine kazanır (damga son görülen damganın ardına geçer)',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu' }, saat: { t: BASLANGIC + 3_600_000 } }); // A'nın saati 1 saat ileri
    await a.esitle();
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' }, saat: { t: BASLANGIC } });
    await b.esitle();
    b.ayarlar.temaZorla = 'acik'; // B'nin saati geride, ama A'nın damgasını görmüş
    await b.esitle();
    assert.ok(JSON.parse(b.dosyaOku()).bolumler.gorunum.zaman > BASLANGIC + 3_600_000, 'B damgası A damgasının ardında');
    await a.esitle();
    assert.equal(a.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'klasörden gelen içerik içe aktarma hattından geçer: kapı/kilit/garaj/alarm/siren favorileri atılır, bölüm dışı alanlar (adres) ve geçersiz değerler alınmaz',
  ortam(async (klasor) => {
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { yerelAdres: 'http://10.0.0.5:8123', favoriler: [] } });
    const disAdresOnce = b.ayarlar.disAdres;
    yazBelge(
      klasor,
      belgeYap({
        favoriler: bolumGirdisi(
          {
            favoriler: [SALON, { entity_id: 'lock.on_kapi', ad: 'Ön kapı' }, { entity_id: 'cover.garaj_kapisi', ad: 'Garaj kapısı' }, { entity_id: 'alarm_control_panel.ev', ad: 'Alarm' }, { entity_id: 'siren.ev', ad: 'Siren' }, { entity_id: 'switch.kapi_zili', ad: 'Kapı zili' }],
            panolar: [],
            yerelAdres: 'http://evil.example:8123',
            disAdres: 'https://evil.example',
          },
          BASLANGIC - 1000,
          AYGIT_A,
        ),
        gorunum: bolumGirdisi({ temaZorla: 'acik', vurguRengi: 'KOTU', yerelAdres: 'http://evil.example:8123' }, BASLANGIC - 1000, AYGIT_A),
        kisayollar: bolumGirdisi({ kisayol: 'bu bir kisayol degil' }, BASLANGIC - 1000, AYGIT_A),
      }),
    );
    const sonuc = await b.esitle();
    assert.equal(sonuc.ok, true);
    assert.deepEqual(b.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
    assert.equal(b.ayarlar.yerelAdres, 'http://10.0.0.5:8123');
    assert.equal(b.ayarlar.disAdres, disAdresOnce, 'dış adres de eşitlenmez');
    assert.equal(b.ayarlar.temaZorla, 'acik');
    assert.equal(b.ayarlar.vurguRengi, '');
    assert.notEqual(b.ayarlar.kisayol, 'bu bir kisayol degil');
    for (const uygulanan of b.durum.iceAktar) {
      for (const yasak of ['yerelAdres', 'disAdres', 'klasorEsitleme']) assert.equal(Object.hasOwn(uygulanan, yasak), false, `${yasak} uygulanmadı`);
    }
    assert.equal(JSON.stringify(b.ayarlar).includes('evil.example'), false);
  }),
);

test(
  'kötü niyetli dosyalar: JWT benzeri değer, daha yeni sürüm, çok büyük dosya ve gelecek damgalı bölüm hiçbir şeyi değiştirmez; ana dosya ezilmez',
  ortam(async (klasor) => {
    const jeton = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
    const dene = async (icerik, beklenenNeden) => {
      const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
      fs.writeFileSync(path.join(klasor, DOSYA_ADI), icerik, 'utf8');
      const once = fs.readFileSync(path.join(klasor, DOSYA_ADI), 'utf8');
      const sonuc = await b.esitle();
      assert.equal(sonuc.ok, false);
      assert.equal(sonuc.neden, beklenenNeden);
      assert.equal(b.ayarlar.temaZorla, 'koyu', 'yerel ayar değişmedi');
      assert.equal(b.durum.iceAktar.length, 0);
      assert.equal(fs.readFileSync(path.join(klasor, DOSYA_ADI), 'utf8'), once, 'dosya ezilmedi');
      assert.equal((await b.yonetici.durum()).asama, 'hata');
    };
    await dene(JSON.stringify(belgeYap({ gorunum: bolumGirdisi({ vurguRengi: jeton }, BASLANGIC - 1) })), 'gizli-deger');
    await dene(JSON.stringify({ ...belgeYap({}), surum: 2 }), 'daha-yeni');
    await dene(JSON.stringify({ ...belgeYap({}), semaSurumu: 99 }), 'daha-yeni');
    await dene(`{"bicim":"ev-paneli-ayar-esitleme","surum":1,"bolumler":{},"dolgu":"${'x'.repeat(600 * 1024)}"}`, 'cok-buyuk');

    // Gelecek damga (24 saatten ileri): bölüm yok sayılır, yerel sürüm yazılır
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    yazBelge(klasor, belgeYap({ gorunum: bolumGirdisi({ temaZorla: 'acik' }, BASLANGIC + 30 * 24 * 3600 * 1000, AYGIT_A) }));
    await b.esitle();
    assert.equal(b.ayarlar.temaZorla, 'koyu');
    assert.equal(JSON.parse(b.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'koyu');
  }),
);

test(
  'bozuk ana dosya: kendiliğinden üzerine yazılmaz (yarım inmiş olabilir); "Şimdi eşitle" (elle) geçerli dosyayı yeniden yazar',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    fs.writeFileSync(a.dosyaYolu(), '{"bicim": "ev-paneli-ayar-es', 'utf8');
    const otomatik = await a.esitle();
    assert.equal(otomatik.neden, 'bozuk');
    assert.equal(a.dosyaOku(), '{"bicim": "ev-paneli-ayar-es');
    const elle = await a.yonetici.simdiEsitle();
    assert.equal(elle.ok, true);
    assert.equal(JSON.parse(a.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'çakışma kopyaları (Dropbox/Syncthing/OneDrive): en yeni bölümler birleştirilir ve ana dosyaya yazılır; kopyalar silinmez',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu', favoriler: [SALON] } });
    await a.esitle();
    const kopyaAdi = 'ev-paneli-esitleme (B bilgisayarinin conflicted copy 2026-10-17).json';
    const kopyaBelge = belgeYap({
      gorunum: bolumGirdisi({ temaZorla: 'acik' }, a.saat.t + 60_000, AYGIT_B),
      bilgi: bolumGirdisi({ saatBicimi: '24' }, a.saat.t + 60_000, AYGIT_B),
    });
    yazBelge(klasor, kopyaBelge, kopyaAdi);
    const kopyaOnce = fs.readFileSync(path.join(klasor, kopyaAdi), 'utf8');
    a.ilerle(120_000);
    await a.esitle();
    assert.equal(a.ayarlar.temaZorla, 'acik');
    assert.equal(a.ayarlar.saatBicimi, '24');
    const belge = dosyaBelgesi(a);
    assert.equal(belge.bolumler.gorunum.ayarlar.temaZorla, 'acik');
    assert.equal(belge.bolumler.bilgi.ayarlar.saatBicimi, '24');
    assert.equal(belge.bolumler.favoriler.aygit, AYGIT_A, 'kopyada olmayan bölüm yerinde kaldı');
    assert.equal(fs.readFileSync(path.join(klasor, kopyaAdi), 'utf8'), kopyaOnce, 'çakışma kopyasına dokunulmadı');
    assert.ok(fs.readdirSync(klasor).every((ad) => !ad.endsWith('.tmp')));
  }),
);

test(
  'bilinmeyen (yeni sürümün) bölümü yazarken korunur; eşitlenmeyen (seçilmemiş) bölümler klasörde aynen kalır',
  ortam(async (klasor) => {
    yazBelge(
      klasor,
      belgeYap({
        gelecek: { zaman: BASLANGIC - 10, aygit: AYGIT_B, ayarlar: { x: 1 } },
        gorunum: bolumGirdisi({ temaZorla: 'acik' }, BASLANGIC - 10, AYGIT_B),
      }),
    );
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu', favoriler: [SALON], esitlemeBolumleri: ['favoriler'] } });
    await a.esitle();
    const belge = dosyaBelgesi(a);
    assert.deepEqual(belge.bolumler.gelecek.ayarlar, { x: 1 });
    assert.equal(belge.bolumler.gorunum.ayarlar.temaZorla, 'acik', 'seçilmeyen bölüm dosyada korundu');
    assert.equal(a.ayarlar.temaZorla, 'koyu', 'seçilmeyen bölüm yerelde değişmedi');
    assert.deepEqual(belge.bolumler.favoriler.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
  }),
);

test(
  'uygulanamayan bölüm: hata bildirilir, kayıt ilerlemez, aynı sürüm tekrar tekrar denenmez; "Şimdi eşitle" yeniden dener; diğer bölümler uygulanır',
  ortam(async (klasor) => {
    yazBelge(
      klasor,
      belgeYap({
        gorunum: bolumGirdisi({ temaZorla: 'acik' }, BASLANGIC - 1000, AYGIT_A),
        bilgi: bolumGirdisi({ saatBicimi: '24' }, BASLANGIC - 1000, AYGIT_A),
      }),
    );
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    b.durum.iceAktarHatasi = true; // uygulamalar başarısız olur
    const sonuc = await b.esitle();
    assert.equal(sonuc.ok, false);
    assert.equal(sonuc.neden, 'bolum-uygulanamadi');
    assert.equal(b.ayarlar.temaZorla, 'koyu');
    assert.equal(b.durum.iceAktar.length, 2, 'iki bölüm denendi');
    await b.esitle();
    assert.equal(b.durum.iceAktar.length, 2, 'aynı klasör sürümü yeniden denenmez');
    b.durum.iceAktarHatasi = false;
    const elle = await b.yonetici.simdiEsitle();
    assert.equal(elle.ok, true);
    assert.equal(b.ayarlar.temaZorla, 'acik');
    assert.equal(b.ayarlar.saatBicimi, '24');
  }),
);

test(
  'klasör yok ya da yazılamıyor: hata nedeni bildirilir, yerel ayarlar korunur, kayıt ilerlemez; klasör gelince/yazma düzelince toparlanır',
  ortam(async (klasor) => {
    const eksik = path.join(klasor, 'yok-boyle-klasor');
    const a = bilgisayarKur({ klasor: eksik, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    const sonuc = await a.esitle();
    assert.equal(sonuc.neden, 'klasor-yok');
    assert.equal(a.ayarlar.temaZorla, 'acik');
    fs.mkdirSync(eksik);
    assert.equal((await a.esitle()).ok, true);
    assert.equal(JSON.parse(a.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'acik');

    // Yazma hatası: rename başarısız
    const fsp = require('node:fs/promises');
    let bozuk = true;
    const yazamayan = { ...fsp, rename: async (...args) => (bozuk ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' })) : fsp.rename(...args)) };
    const klasor2 = path.join(klasor, 'ikinci');
    fs.mkdirSync(klasor2);
    const b = bilgisayarKur({ klasor: klasor2, aygit: AYGIT_B, ayarEk: { temaZorla: 'acik' }, fsOzel: yazamayan });
    const hatali = await b.esitle();
    assert.equal(hatali.neden, 'yazilamadi');
    assert.deepEqual(fs.readdirSync(klasor2), [], 'geçici dosya temizlendi');
    assert.equal(b.ayarlar.temaZorla, 'acik');
    assert.equal(b.ayarlar.esitlemeDurumu.bolumler?.gorunum, undefined, 'yazılamayan bölümün kaydı ilerlemedi');
    bozuk = false;
    assert.equal((await b.esitle()).ok, true);
    assert.equal(JSON.parse(b.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'yerel değişiklik ilk eşitlemeden sonra korunur: yazma başarısız olsa bile değişiklik kaydı geri alınmaz, sonraki turda klasöre yazılır',
  ortam(async (klasor) => {
    const fsp = require('node:fs/promises');
    let bozuk = false;
    const sarmal = { ...fsp, rename: async (...args) => (bozuk ? Promise.reject(new Error('EPERM')) : fsp.rename(...args)) };
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu' }, fsOzel: sarmal });
    await a.esitle();
    a.ayarlar.temaZorla = 'acik';
    bozuk = true;
    assert.equal((await a.esitle()).neden, 'yazilamadi');
    // Başka bilgisayarın eski sürümü klasörde kalmışken yerel değişiklik KAYBOLMAMALI
    bozuk = false;
    await a.esitle();
    assert.equal(a.ayarlar.temaZorla, 'acik');
    assert.equal(JSON.parse(a.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'parola: dosya şifreli yazılır (içerik, parola, adres düz görünmez); başka bilgisayar parolasız "parola gerekli", yanlışsa "parola yanlış" alır ve dosya ezilmez; doğru parolayla alır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON], yerelAdres: 'http://192.168.1.77:8123' } });
    await a.esitle();
    const kur = await a.yonetici.parolaKoy('ortak-parola-123');
    assert.equal(kur.ok, true);
    assert.equal(kur.esitleme.parolaVar, true);
    const metin = a.dosyaOku();
    assert.equal(JSON.parse(metin).sifreli, true);
    for (const yasak of ['Salon', 'temaZorla', 'ortak-parola-123', '192.168.1.77', 'acik']) assert.equal(metin.includes(yasak), false, `şifreli dosyada ${yasak} görünüyor`);

    const parolasiz = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    const r1 = await parolasiz.esitle();
    assert.equal(r1.neden, 'parola-gerekli');
    assert.equal(parolasiz.dosyaOku(), metin, 'dosya ezilmedi');
    assert.equal(parolasiz.ayarlar.temaZorla, 'koyu');

    const yanlis = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    await yanlis.parolaDeposu.yaz('baska-parola-999');
    const r2 = await yanlis.esitle();
    assert.equal(r2.neden, 'parola-yanlis');
    assert.equal(yanlis.dosyaOku(), metin, 'yanlış parolayla dosya ezilmedi');

    const dogru = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    await dogru.parolaDeposu.yaz('ortak-parola-123');
    const r3 = await dogru.esitle();
    assert.equal(r3.ok, true);
    assert.equal(dogru.ayarlar.temaZorla, 'acik');
    assert.deepEqual(dogru.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
  }),
);

test(
  'parola ayarlıyken düz dosya güvenilmez (alınmaz) ve şifreli sürümle değiştirilir; parola kaldırılınca dosya parolasız yeniden yazılır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu' } });
    await a.parolaDeposu.yaz('ortak-parola-123');
    yazBelge(klasor, belgeYap({ gorunum: bolumGirdisi({ temaZorla: 'acik' }, BASLANGIC + 1000, AYGIT_B) }));
    await a.esitle();
    assert.equal(a.ayarlar.temaZorla, 'koyu', 'düz dosyadaki içerik alınmadı');
    assert.equal(JSON.parse(a.dosyaOku()).sifreli, true, 'dosya şifreli yeniden yazıldı');

    const kaldir = await a.yonetici.parolaSil();
    assert.equal(kaldir.ok, true);
    assert.equal(kaldir.esitleme.parolaVar, false);
    const belge = dosyaBelgesi(a);
    assert.equal(belge.sifreli, undefined);
    assert.equal(belge.bolumler.gorunum.ayarlar.temaZorla, 'koyu');
  }),
);

test(
  'parola koy/sil: dosya kayıtlı parolayla çözülmüyorsa (başka bilgisayarın parolası) üzerine yazılmaz; kayıtlı parola yerinde kalır, diğer bilgisayarın verisi korunur',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON] } });
    await a.esitle();
    assert.equal((await a.yonetici.parolaKoy('ortak-parola-123')).ok, true);
    const metin = a.dosyaOku();

    // (a) parolası olmayan B başka bir parola koyar: dosya A'nın parolasıyla şifreli, B'nin hiçbir parolası eskiyi açmaz
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu' } });
    const yanit = await b.yonetici.parolaKoy('yanlis-parola-9');
    assert.equal(yanit.esitleme.asama, 'hata');
    assert.equal(yanit.esitleme.neden, 'parola-yanlis');
    assert.equal(b.dosyaOku(), metin, 'dosya ezilmedi');
    assert.equal(b.parolaDeposu.oku(), 'yanlis-parola-9', 'kayıtlı parola yerinde kalır');
    assert.equal(b.ayarlar.temaZorla, 'koyu');

    // (d) kayıtlı parola zaten yanlışken parolaSil de dosyayı ezmez
    const sil = await b.yonetici.parolaSil();
    assert.equal(sil.esitleme.asama, 'hata');
    assert.equal(sil.esitleme.neden, 'parola-gerekli');
    assert.equal(b.dosyaOku(), metin, 'parolaSil dosyayı ezmedi');

    // (b) doğru parolayı kaydedince A'nın verisi B'ye gelir, B'nin boş ayarları A'ya uygulanmaz
    const dogru = await b.yonetici.parolaKoy('ortak-parola-123');
    assert.equal(dogru.ok, true);
    assert.equal(b.ayarlar.temaZorla, 'acik');
    assert.deepEqual(b.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
    assert.equal(a.ayarlar.temaZorla, 'acik');
    const belge = dosyaBelgesi(b);
    assert.equal(belge.sifreli, true);
  }),
);

test(
  'parola değiştirme meşru kalır: dosya eski parolayla çözülüyorsa yeni parolayla yeniden yazılır; parola kaldırılınca düz yazılır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON] } });
    await a.esitle();
    assert.equal((await a.yonetici.parolaKoy('parola-bir-123')).ok, true);
    // (c) parola-1 -> parola-2
    const degis = await a.yonetici.parolaKoy('parola-iki-456');
    assert.equal(degis.ok, true);
    assert.equal(degis.esitleme.asama, 'tamam');
    const c = bilgisayarKur({ klasor, aygit: AYGIT_B });
    await c.parolaDeposu.yaz('parola-iki-456');
    assert.equal((await c.esitle()).ok, true, 'dosya yeni parolayla çözülür');
    assert.equal(c.ayarlar.temaZorla, 'acik');
    const eski = bilgisayarKur({ klasor, aygit: AYGIT_B });
    await eski.parolaDeposu.yaz('parola-bir-123');
    assert.equal((await eski.esitle()).neden, 'parola-yanlis', 'eski parola artık açmaz');
    // (d) kayıtlı parolayla çözülen dosya parolasız yazılır
    const kaldir = await a.yonetici.parolaSil();
    assert.equal(kaldir.esitleme.asama, 'tamam');
    assert.equal(dosyaBelgesi(a).sifreli, undefined);
    assert.equal(dosyaBelgesi(a).bolumler.gorunum.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'parola değişimi eski parolayı paylaşan bilgisayarın henüz alınmamış bölümünü ezmez: dosya eski parolayla okunan içerikle birleşip yeni parolayla yazılır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON] } });
    await a.esitle();
    assert.equal((await a.yonetici.parolaKoy('parola-bir-123')).ok, true);
    // B aynı parolayı paylaşır, A'nın verisini alır, sonra temayı değiştirip eşitler
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B });
    await b.parolaDeposu.yaz('parola-bir-123');
    assert.equal((await b.esitle()).ok, true);
    b.ilerle(60_000);
    b.ayarlar.temaZorla = 'koyu';
    assert.equal((await b.esitle()).ok, true);
    // A, B'nin değişikliğini almadan parolayı değiştirir
    const degis = await a.yonetici.parolaKoy('parola-iki-456');
    assert.equal(degis.ok, true);
    assert.equal(degis.esitleme.asama, 'tamam');
    assert.equal(a.ayarlar.temaZorla, 'koyu', "B'nin yeni bölümü A'ya uygulandı");
    const c = bilgisayarKur({ klasor, aygit: 'cccccccccccccccc' });
    await c.parolaDeposu.yaz('parola-iki-456');
    assert.equal((await c.esitle()).ok, true, 'dosya yeni parolayla çözülür');
    assert.equal(c.ayarlar.temaZorla, 'koyu', "B'nin yeni bölümü dosyada kaldı");
    assert.deepEqual(c.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
  }),
);

test(
  'ilk parola konurken düz dosyadaki başka bilgisayarın henüz alınmamış bölümü atılmaz; dosya şifreli yeniden yazılır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    await a.esitle();
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B });
    assert.equal((await b.esitle()).ok, true);
    b.ilerle(60_000);
    b.ayarlar.temaZorla = 'koyu';
    assert.equal((await b.esitle()).ok, true);
    assert.equal((await a.yonetici.parolaKoy('parola-bir-123')).ok, true);
    assert.equal(a.ayarlar.temaZorla, 'koyu');
    assert.equal(dosyaBelgesi(a).sifreli, true);
    const c = bilgisayarKur({ klasor, aygit: 'cccccccccccccccc' });
    await c.parolaDeposu.yaz('parola-bir-123');
    assert.equal((await c.esitle()).ok, true);
    assert.equal(c.ayarlar.temaZorla, 'koyu');
  }),
);

test(
  'parola işlemleri: geçersiz/kısa parola ve şifreleme yokluğu reddedilir; parola hiçbir yanıtta, günlükte, ayar nesnesinde ya da dosyada geçmez',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    assert.deepEqual(await a.yonetici.parolaKoy('kisa'), { ok: false, neden: 'parola-gecersiz' });
    assert.deepEqual(await a.yonetici.parolaKoy(12345678), { ok: false, neden: 'parola-gecersiz' });
    const yok = bilgisayarKur({ klasor, aygit: AYGIT_A, parolaDeposu: sahteParolaDeposu({ sifrelemeVar: false }) });
    assert.deepEqual(await yok.yonetici.parolaKoy('yeterince-uzun-parola'), { ok: false, neden: 'sifreleme-yok' });
    assert.equal((await yok.yonetici.durum()).sifrelemeVar, false);

    const parola = 'cok-gizli-ortak-parola-xyz';
    const yanit = await a.yonetici.parolaKoy(parola);
    const durum = await a.yonetici.durum();
    const hepsi = JSON.stringify([yanit, durum, a.durum.gunluk, a.ayarlar, a.dosyaOku()]);
    assert.equal(hepsi.includes(parola), false);
    assert.equal(a.parolaDeposu.oku(), parola, 'parola yalnız güvenli depoda');
  }),
);

test(
  'günlük: yalnız sabit metin ve sayılar; klasör yolu, kullanıcı adı, içerik ve anahtar günlüğe girmez',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON] } });
    await a.yonetici.ayarla({ acik: true });
    await a.esitle();
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B });
    await b.esitle();
    await a.yonetici.parolaKoy('ortak-parola-123');
    for (const m of [a, b]) {
      const gunluk = m.durum.gunluk.join('\n');
      assert.ok(gunluk.length > 0);
      assert.equal(gunluk.includes(klasor), false, 'klasör yolu günlükte');
      assert.equal(gunluk.includes(path.basename(klasor)), false);
      assert.equal(/Salon|light\.salon|ortak-parola/.test(gunluk), false);
      for (const satir of m.durum.gunluk) assert.match(satir, /^Klasör eşitleme: [^\\/]*\.$/);
    }
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------
// Açma/kapama, klasör seçimi, IPC
// ---------------------------------------------------------------------------------------------------------------------------

test(
  'klasör seçimi: diyalogla seçilir, eşitleme kapatılır ve bölüm kayıtları sıfırlanır; iptal, göreli yol, uygulama klasörü ve olmayan klasör reddedilir',
  ortam(async (klasor) => {
    const veri = path.join(klasor, 'veri');
    fs.mkdirSync(veri);
    const hedef = path.join(klasor, 'dropbox');
    fs.mkdirSync(hedef);
    const a = bilgisayarKur({ klasor: hedef, aygit: AYGIT_A, yasak: [veri], ayarEk: { temaZorla: 'acik' } });
    await a.esitle();
    assert.ok(Object.keys(a.ayarlar.esitlemeDurumu.bolumler).length > 0);

    a.durum.diyalog = null;
    assert.deepEqual(await a.yonetici.klasorSec(), { ok: false, iptal: true });
    a.durum.diyalog = 'goreli\\klasor';
    assert.equal((await a.yonetici.klasorSec()).neden, 'yol-gecersiz');
    a.durum.diyalog = path.join(veri, 'alt');
    assert.equal((await a.yonetici.klasorSec()).neden, 'yasak-klasor');
    a.durum.diyalog = veri;
    assert.equal((await a.yonetici.klasorSec()).neden, 'yasak-klasor');
    a.durum.diyalog = path.join(klasor, 'yok-boyle');
    assert.equal((await a.yonetici.klasorSec()).neden, 'klasor-yok');
    a.durum.diyalog = path.join(hedef, DOSYA_ADI); // dosya, klasör değil
    assert.equal((await a.yonetici.klasorSec()).neden, 'yol-gecersiz');
    assert.equal(a.ayarlar.klasorEsitleme, true, 'reddedilen seçim durumu değiştirmedi');

    const yeni = path.join(klasor, 'onedrive');
    fs.mkdirSync(yeni);
    a.durum.diyalog = yeni;
    const yanit = await a.yonetici.klasorSec();
    assert.equal(yanit.ok, true);
    assert.equal(a.ayarlar.esitlemeKlasoru, yeni);
    assert.equal(a.ayarlar.klasorEsitleme, false, 'yeni klasörde eşitleme bilinçli yeniden açılır');
    assert.deepEqual(a.ayarlar.esitlemeDurumu, { aygit: AYGIT_A });
    assert.equal(a.izle.acik().length, 0, 'eski klasörün izleyicisi kapandı');
    assert.equal(yanit.esitleme.acik, false);
  }),
);

test(
  'açma/kapama: klasör seçilmeden açılamaz; bölüm seçimi doğrulanır; açılınca izleme ve yoklama kurulur, kapanınca temizlenir',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, acik: false, ayarEk: { esitlemeKlasoru: '' } });
    assert.equal((await a.yonetici.ayarla({ acik: true })).neden, 'klasor-yok');
    assert.equal((await a.yonetici.ayarla(null)).neden, 'girdi-gecersiz');
    assert.equal((await a.yonetici.ayarla({ acik: 'evet' })).neden, 'girdi-gecersiz');
    assert.equal((await a.yonetici.ayarla({ bolumler: 'hepsi' })).neden, 'girdi-gecersiz');

    a.ayarlar.esitlemeKlasoru = klasor;
    assert.equal((await a.yonetici.ayarla({ acik: true, bolumler: [] })).neden, 'bolum-yok');
    const acildi = await a.yonetici.ayarla({ acik: true, bolumler: ['gorunum', 'gorunum', 'kotu'] });
    assert.equal(acildi.ok, true);
    assert.deepEqual(a.ayarlar.esitlemeBolumleri, ['gorunum']);
    assert.equal(a.ayarlar.klasorEsitleme, true);
    assert.equal(acildi.esitleme.acik, true);
    assert.equal(a.izle.acik().length, 1);
    assert.equal(a.zaman.aralikSayisi(), 1);
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'ilk eşitleme planlandı');
    await a.zaman.tetikle();
    assert.deepEqual(Object.keys(dosyaBelgesi(a).bolumler), ['gorunum'], 'yalnız seçilen bölüm eşitlendi');

    const kapandi = await a.yonetici.ayarla({ acik: false });
    assert.equal(kapandi.esitleme.acik, false);
    assert.equal(a.ayarlar.klasorEsitleme, false);
    assert.equal(a.izle.acik().length, 0);
    assert.equal(a.zaman.aralikSayisi(), 0);
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
  }),
);

test(
  'ayar dosyası yazılamazsa (ayarlariYaz false) klasör seçimi ve açma/kapama başarı döndürmez: bellekteki alanlar eski haline döner, izleme ve zamanlayıcıya dokunulmaz',
  ortam(async (klasor) => {
    const eski = path.join(klasor, 'eski');
    const yeni = path.join(klasor, 'yeni');
    fs.mkdirSync(eski);
    fs.mkdirSync(yeni);
    const a = bilgisayarKur({ klasor: eski, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    await a.esitle();
    a.yonetici.baslat();
    const durumOnce = JSON.stringify(a.ayarlar.esitlemeDurumu);
    const izleyiciSayisi = a.izle.acik().length;
    assert.equal(izleyiciSayisi, 1);
    a.durum.ayarYazimiBasarili = false;

    // klasör seçimi
    a.durum.diyalog = yeni;
    assert.deepEqual(await a.yonetici.klasorSec(), { ok: false, neden: 'ayar-yazilamadi' });
    assert.equal(a.ayarlar.esitlemeKlasoru, eski);
    assert.equal(a.ayarlar.klasorEsitleme, true);
    assert.equal(JSON.stringify(a.ayarlar.esitlemeDurumu), durumOnce);
    assert.equal(a.izle.acik().length, izleyiciSayisi, 'eski klasörün izleyicisi kapanmadı');

    // kapatma
    assert.deepEqual(await a.yonetici.ayarla({ acik: false }), { ok: false, neden: 'ayar-yazilamadi' });
    assert.equal(a.ayarlar.klasorEsitleme, true);
    assert.equal(a.izle.acik().length, izleyiciSayisi);
    assert.equal(a.zaman.aralikSayisi(), 1);

    // açma + bölüm seçimi
    a.ayarlar.klasorEsitleme = false;
    a.yonetici.kapat();
    const bolumOnce = a.ayarlar.esitlemeBolumleri;
    assert.deepEqual(await a.yonetici.ayarla({ acik: true, bolumler: ['gorunum'] }), { ok: false, neden: 'ayar-yazilamadi' });
    assert.equal(a.ayarlar.klasorEsitleme, false, 'eşitleme açık görünmez');
    assert.deepEqual(a.ayarlar.esitlemeBolumleri, bolumOnce);
    assert.equal(a.izle.acik().length, 0);
    assert.equal((await a.yonetici.durum()).acik, false);

    // yazım düzelince aynı istek başarılı olur
    a.durum.ayarYazimiBasarili = true;
    assert.equal((await a.yonetici.ayarla({ acik: true })).ok, true);
    assert.equal(a.ayarlar.klasorEsitleme, true);
  }),
);

test(
  'izleme: klasör olayı bekletilerek tek eşitlemeye dönüşür, geçici dosya olayları yok sayılır; yerel değişiklik yalnız bölüm içeriği değişince planlanır; yoklama klasör imzası değişince eşitler; kapat her şeyi bırakır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu' } });
    a.yonetici.baslat();
    assert.equal(a.izle.acik().length, 1);
    assert.deepEqual(a.zaman.bekleyenler().filter((b) => !b.tekrarli).map((b) => b.ms), [ACILIS_BEKLEME_MS]);
    await a.zaman.tetikle();
    assert.equal(a.dosyaVarMi(), true);

    a.izle.olay('.ev-paneli-esitleme.abc123.tmp');
    assert.equal(a.zaman.zamanlayiciSayisi(), 0, 'geçici dosya olayı yok sayıldı');
    a.izle.olay();
    a.izle.olay('ev-paneli-esitleme (1).json');
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'olaylar tek zamanlayıcıda birleşir');
    assert.deepEqual(a.zaman.bekleyenler().filter((b) => !b.tekrarli).map((b) => b.ms), [KLASOR_OLAYI_BEKLEME_MS]);
    await a.zaman.tetikle();

    // Yerel ayar yazıldı ama bölümler değişmedi (örn. pencere boyutu) -> eşitleme planlanmaz
    a.yonetici.yerelDegisti();
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
    a.ayarlar.temaZorla = 'acik';
    a.yonetici.yerelDegisti();
    a.yonetici.yerelDegisti();
    assert.equal(a.zaman.zamanlayiciSayisi(), 1);
    assert.deepEqual(a.zaman.bekleyenler().filter((b) => !b.tekrarli).map((b) => b.ms), [DEGISIKLIK_BEKLEME_MS]);
    a.ilerle(10_000);
    await a.zaman.tetikle();
    assert.equal(JSON.parse(a.dosyaOku()).bolumler.gorunum.ayarlar.temaZorla, 'acik');

    // Yoklama: izleme kaçırsa da klasördeki dosya değişince eşitlenir
    const baska = bilgisayarKur({ klasor, aygit: AYGIT_B, saat: a.saat });
    await baska.esitle(); // ilk eşitleme: klasördeki sürüm alınır
    assert.equal(baska.ayarlar.temaZorla, 'acik');
    baska.ayarlar.temaZorla = 'sistem';
    baska.ilerle(120_000);
    await baska.esitle();
    assert.equal(a.ayarlar.temaZorla, 'acik');
    await a.zaman.araliklariTetikle();
    assert.equal(a.ayarlar.temaZorla, 'sistem', 'yoklama klasör değişimini yakaladı');
    assert.equal(YOKLAMA_MS, 60_000);

    // İzleyici düşerse yoklama yeniden kurar
    a.izle.kayitlar[0].hataDinleyicileri.forEach((f) => f());
    assert.equal(a.izle.acik().length, 0);
    await a.zaman.araliklariTetikle();
    assert.equal(a.izle.acik().length, 1);

    a.yonetici.kapat();
    assert.equal(a.izle.acik().length, 0);
    assert.equal(a.zaman.aralikSayisi(), 0);
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
  }),
);

test(
  'klasörden gelen bölüm uygulanınca kendi ayar yazımımız (yerelDegisti) ikinci bir eşitleme planlamaz; uygulama sürerken başka bir bölüm değişirse eşitleme yine planlanır ve değişiklik yazılır',
  ortam(async (klasor) => {
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { temaZorla: 'koyu', favoriler: [SALON] } });
    await b.esitle();
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [] }, yerelDegistiBagli: true });
    assert.equal((await a.esitle()).ok, true);
    assert.equal(a.ayarlar.temaZorla, 'koyu');
    assert.ok(a.durum.iceAktar.length > 0, 'klasördeki bölümler uygulandı');
    assert.equal(a.zaman.zamanlayiciSayisi(), 0, 'kendi uygulamamızın yankısı için ek eşitleme planlanmadı');
    a.yonetici.yerelDegisti();
    assert.equal(a.zaman.zamanlayiciSayisi(), 0, 'yerel içerik eşitlenen içerikle aynı');

    // B yeniden değiştirir; A uygularken kullanıcı başka bir bölümü (bildirim) değiştirir: değişiklik kaybolmaz
    b.ayarlar.temaZorla = 'acik';
    await b.esitle();
    const bip = !a.ayarlar.bipSesi;
    a.durum.iceAktarSirasinda = (ayarlar) => {
      ayarlar.bipSesi = bip;
    };
    assert.equal((await a.esitle()).ok, true);
    a.durum.iceAktarSirasinda = null;
    assert.equal(a.ayarlar.temaZorla, 'acik');
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'uygulama sırasındaki başka değişiklik için eşitleme planlandı');
    assert.deepEqual(a.zaman.bekleyenler().filter((x) => !x.tekrarli).map((x) => x.ms), [DEGISIKLIK_BEKLEME_MS]);
    await a.zaman.tetikle();
    assert.equal(dosyaBelgesi(a).bolumler.bildirim.ayarlar.bipSesi, bip, 'değişiklik klasöre yazıldı');
    assert.equal(a.zaman.zamanlayiciSayisi(), 0);
  }),
);

test(
  'izleme: izlenen klasörün kendisi silinince (Windows\'ta dosya adı yerine klasör yoluyla sonsuz "rename" olayı gelir) izleyici hemen bırakılır, "klasör yok" görünür; klasör dönünce yoklama yeniden kurar',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'koyu' } });
    a.yonetici.baslat();
    await a.zaman.tetikle();
    assert.equal(a.dosyaVarMi(), true);
    assert.equal(a.izle.acik().length, 1);

    // Klasör silindi: Node, dosya adı yerine klasörün tam yolunu veren olaylar üretir
    const yedek = fs.readFileSync(a.dosyaYolu(), 'utf8');
    fs.rmSync(klasor, { recursive: true, force: true });
    a.izle.olay(`\\\\?\\${klasor}`);
    assert.equal(a.izle.acik().length, 0, 'izleyici ilk yol benzeri olayda bırakıldı');
    a.izle.olay(`\\\\?\\${klasor}`);
    a.izle.olay(`\\\\?\\${klasor}`);
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'bırakılmış izleyicinin kuyruktaki olayları yok sayılır; tek eşitleme planlı');
    await a.zaman.tetikle();
    const d = await a.yonetici.durum();
    assert.equal(d.asama, 'hata');
    assert.equal(d.neden, 'klasor-yok');
    assert.equal(d.klasorVar, false);
    assert.equal(a.izle.acik().length, 0);

    // Klasör ve dosya geri gelir: yoklama izleyiciyi yeniden kurar ve eşitleme toparlanır
    fs.mkdirSync(klasor, { recursive: true });
    fs.writeFileSync(a.dosyaYolu(), yedek, 'utf8');
    await a.zaman.araliklariTetikle();
    assert.equal(a.izle.acik().length, 1);
    assert.equal((await a.yonetici.durum()).asama, 'tamam');
  }),
);

test(
  'izleme: olay fırtınası (bir saniyede 200\'den fazla olay) izleyiciyi bırakır; olağan yoğunluk (200 ve altı) bırakmaz',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A });
    a.yonetici.baslat();
    await a.zaman.tetikle();
    for (let i = 0; i < 200; i += 1) a.izle.olay('ev-paneli-esitleme.json');
    assert.equal(a.izle.acik().length, 1, '200 olay hâlâ olağan');
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'olaylar tek zamanlayıcıda birleşir');
    a.izle.olay('ev-paneli-esitleme.json');
    assert.equal(a.izle.acik().length, 0, '201. olayda izleyici bırakıldı');

    // Yeni pencerede (bir saniye sonra) sayaç sıfırlanır; yoklama izleyiciyi yeniden kurar
    a.ilerle(2000);
    await a.zaman.araliklariTetikle();
    assert.equal(a.izle.acik().length, 1);
    a.ilerle(2000);
    for (let i = 0; i < 150; i += 1) a.izle.olay('ev-paneli-esitleme.json');
    assert.equal(a.izle.acik().length, 1);
    a.yonetici.kapat();
  }),
);

test(
  'eş zamanlı istekler tek eşitlemede birleşir (çalışırken gelen istek en çok bir ek tur çalıştırır)',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' } });
    a.ilerle(10_000);
    const sonuclar = await Promise.all([a.yonetici.esitle({ elle: true }), a.yonetici.esitle({ elle: true }), a.yonetici.esitle({ elle: true })]);
    assert.ok(sonuclar.every((s) => s.ok));
    assert.equal(a.dosyaVarMi(), true);
    assert.deepEqual(fs.readdirSync(klasor), [DOSYA_ADI]);
  }),
);

test(
  'tur sınırına takılan katılımın "elle" izni sonraki otomatik tura taşınmaz: bozuk ana dosyanın üzerine yazılmaz; yerine olağan bir tur planlanır',
  ortam(async (klasor) => {
    const fsp = require('node:fs/promises');
    let katil = false;
    let a = null;
    // Her turda klasör okunurken bir "Şimdi eşitle" isteği çalışan tura katılır: üç tur dolunca son katılım koşmadan kalır
    const sarmal = { ...fsp, readdir: async (...args) => {
      if (katil) a.yonetici.esitle({ elle: true });
      return fsp.readdir(...args);
    } };
    a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik' }, fsOzel: sarmal });
    await a.esitle();
    katil = true;
    assert.equal((await a.esitle()).ok, true);
    katil = false;
    assert.equal(a.zaman.zamanlayiciSayisi(), 1, 'koşmadan kalan katılım için olağan tur planlandı');
    fs.writeFileSync(a.dosyaYolu(), '{"bicim": "ev-paneli-ayar', 'utf8'); // yarım inmiş dosya
    const otomatik = await a.esitle();
    assert.equal(otomatik.ok, false);
    assert.equal(otomatik.neden, 'bozuk');
    assert.equal(a.dosyaOku(), '{"bicim": "ev-paneli-ayar', 'bozuk dosyanın üzerine yazılmadı');
    await a.zaman.tetikle(); // planlanan olağan tur da elle izni taşımaz
    assert.equal(a.dosyaOku(), '{"bicim": "ev-paneli-ayar');
  }),
);

test(
  'çalışan (alt aralık beklemesindeki) tura katılan parola değişimi isteği seçeneklerini kaybetmez: dosya yeni parolayla yazılır, "parola yanlış" görünmez',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { temaZorla: 'acik', favoriler: [SALON] } });
    await a.esitle();
    assert.equal((await a.yonetici.parolaKoy('parola-bir-123')).ok, true);
    // arka plan turu başlar ama son çalışmadan beri alt aralık geçmediği için sahte zamanlayıcıda bekler
    const arkaPlan = a.yonetici.esitle({});
    await new Promise((coz) => setImmediate(coz));
    const degisim = a.yonetici.parolaKoy('parola-iki-456'); // çalışan tura katılır
    await new Promise((coz) => setImmediate(coz));
    await a.zaman.tetikle();
    await arkaPlan;
    const yanit = await degisim;
    assert.equal(yanit.ok, true);
    assert.equal(yanit.esitleme.asama, 'tamam');
    assert.equal(yanit.esitleme.neden, null);
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B });
    await b.parolaDeposu.yaz('parola-iki-456');
    assert.equal((await b.esitle()).ok, true, 'dosya yeni parolayla çözülür');
    assert.equal(b.ayarlar.temaZorla, 'acik');
  }),
);

test(
  'IPC işleyicileri: altı kanal, yanıtlar JSON olarak düzleştirilebilir, yol ve sır sızmaz; şimdi eşitle kapalıyken reddedilir',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, acik: false });
    const isleyiciler = Object.fromEntries(a.yonetici.ipcIsleyicileri());
    assert.deepEqual(Object.keys(isleyiciler).sort(), ['esitleme:ayarla', 'esitleme:durum', 'esitleme:klasor-sec', 'esitleme:parola-koy', 'esitleme:parola-sil', 'esitleme:simdi']);
    const d0 = await isleyiciler['esitleme:durum']();
    assert.equal(d0.ok, true);
    assert.equal(d0.esitleme.acik, false);
    assert.deepEqual(d0.esitleme.tumBolumler, [...BOLUM_ADLARI]);
    assert.equal(d0.esitleme.klasorVar, true);
    assert.equal(d0.esitleme.dosyaVar, false);
    assert.deepEqual(await isleyiciler['esitleme:simdi'](), { ok: false, neden: 'kapali' });
    const acik = await isleyiciler['esitleme:ayarla']({ acik: true, bolumler: ['gorunum', 'bilgi'] });
    assert.equal(acik.ok, true);
    const simdi = await isleyiciler['esitleme:simdi']();
    assert.equal(simdi.ok, true);
    assert.equal(simdi.esitleme.asama, 'tamam');
    assert.deepEqual(simdi.esitleme.son, { zaman: simdi.esitleme.son.zaman, uygulanan: 0, yazilan: 2 });
    JSON.stringify(simdi);
    assert.equal(d0.esitleme.dosyaVar, false);
    assert.equal((await isleyiciler['esitleme:durum']()).esitleme.dosyaVar, true);
    const parola = await isleyiciler['esitleme:parola-koy']('uzun-ve-guvenli-parola');
    assert.equal(parola.ok, true);
    assert.equal(JSON.stringify(parola).includes('uzun-ve-guvenli'), false);
    assert.equal((await isleyiciler['esitleme:parola-sil']()).esitleme.parolaVar, false);
  }),
);

test(
  'başlangıç: kayıtlı eşitleme açıksa izleme kurulur; ayar dosyasındaki durum kaydı bozuksa varsayılana düşer (yeni aygit kimliği üretilir)',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, ayarEk: { esitlemeDurumu: { aygit: 'yanlis', bolumler: { gorunum: { ozet: 'x', zaman: 'a', aygit: 5 } } } } });
    assert.deepEqual(a.ayarlar.esitlemeDurumu, {}, 'ayar şeması bozuk kaydı düşürdü');
    await a.esitle();
    assert.match(a.ayarlar.esitlemeDurumu.aygit, /^[0-9a-f]{16}$/);
    for (const ad of BOLUM_ADLARI) assert.equal(JSON.parse(a.dosyaOku()).bolumler[ad].aygit, a.ayarlar.esitlemeDurumu.aygit);
  }),
);

test('test ortamı kendi kendini sınar: geçici klasör silinir, iki bilgisayar farklı ayar nesnesi kullanır', () => {
  const g = geciciKlasor();
  const a = bilgisayarKur({ klasor: g.klasor });
  const b = bilgisayarKur({ klasor: g.klasor });
  a.ayarlar.temaZorla = 'acik';
  assert.notEqual(b.ayarlar.temaZorla, 'acik');
  g.temizle();
  assert.equal(fs.existsSync(g.klasor), false);
  assert.equal(typeof ayarlarYap().klasorEsitleme, 'boolean');
});

// --- onay gevşetmesi (parolasız dosya) -----------------------------------------------------------------------------------------

const BETIK = { entity_id: 'script.sulama', ad: 'Sulama' };

test(
  'parolasız eşitleme: klasördeki favoride onay:false (basılı tutma şartını kapatma) YOK SAYILIR; yerelde zaten onay:false ise korunur; onay:true gelir; dosya yazan bilgisayarın değeri ezilmez',
  ortam(async (klasor) => {
    // klasöre yazabilen biri (ya da başka bilgisayar) betik favorisine onay:false koydu
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { favoriler: [{ ...BETIK, onay: false }, { ...SALON, onay: true }] } });
    assert.equal(a.ayarlar.favoriler[0].onay, false, 'bilgisayar A: betikte onay kapalı (kendi kararı)');
    await a.esitle();
    assert.equal(dosyaBelgesi(a).bolumler.favoriler.ayarlar.favoriler[0].onay, false);

    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { favoriler: [] } });
    const r = await b.esitle();
    assert.equal(r.ok, true);
    assert.deepEqual(b.ayarlar.favoriler.map((f) => f.entity_id), ['script.sulama', 'light.salon'], 'favoriler alındı');
    assert.equal(b.ayarlar.favoriler[0].onay, undefined, 'onay:false atıldı: betik yine onay ister');
    assert.equal(b.ayarlar.favoriler[1].onay, true, 'sıkılaştırma (onay:true) gelir');
    assert.ok(b.durum.gunluk.some((m) => /onay gevşetmeleri yok sayıldı/.test(m)));
    // kararlı: sonraki turlarda B değişikliği geri yazmaz ve dosyadaki A değeri ezilmez
    const metin = a.dosyaOku();
    await b.esitle();
    await b.esitle();
    assert.equal(b.dosyaOku(), metin);
    assert.equal(b.ayarlar.favoriler[0].onay, undefined);

    // yerelde zaten onay:false olan kullanıcının kendi kararı korunur
    const c = bilgisayarKur({ klasor, aygit: 'cccccccccccccccc', ayarEk: { favoriler: [{ ...BETIK, onay: false }, { ...SALON, onay: true }] } });
    await c.esitle();
    assert.equal(c.ayarlar.favoriler[0].onay, false);
  }),
);

test(
  'parolasız eşitleme: yerelde onay:true olan ışık favorisi klasörden onaysız ya da onay:false (daha yeni damgayla) gelse de onay istemeye devam eder; dosyadaki değer ezilmez',
  ortam(async (klasor) => {
    const KORIDOR = { entity_id: 'light.koridor', ad: 'Koridor' };
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { favoriler: [{ ...SALON }, { ...MUTFAK }] } });
    await b.esitle();
    // A ilk kez eşitlenir: klasördeki sürüm alınır ama A'nın "Onay iste" kararı düşmez
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { favoriler: [{ ...SALON, onay: true }] } });
    assert.equal((await a.esitle()).ok, true);
    assert.deepEqual(a.ayarlar.favoriler.map((f) => [f.entity_id, f.onay]), [['light.salon', true], ['light.mutfak', undefined]]);
    assert.ok(a.durum.gunluk.some((m) => /onay gevşetmeleri yok sayıldı/.test(m)));
    // B daha sonra onay:false yazar (daha yeni damga): A yine onay ister, diğer değişiklik gelir
    b.ayarlar.favoriler = [{ ...SALON, onay: false }, { ...MUTFAK }, { ...KORIDOR }];
    await b.esitle();
    assert.equal(dosyaBelgesi(b).bolumler.favoriler.ayarlar.favoriler[0].onay, false);
    assert.equal((await a.esitle()).ok, true);
    assert.deepEqual(a.ayarlar.favoriler.map((f) => [f.entity_id, f.onay]), [['light.salon', true], ['light.mutfak', undefined], ['light.koridor', undefined]]);
    // kararlı: A sonraki turlarda dosyayı yeniden yazmaz, B'nin değeri dosyada kalır
    const metin = a.dosyaOku();
    await a.esitle();
    await a.esitle();
    assert.equal(a.dosyaOku(), metin);
    assert.equal(a.ayarlar.favoriler[0].onay, true);
  }),
);

test(
  'parolalı eşitleme güvenilir sayılır: parolayı bilen bilgisayardan gelen onay:false aynen uygulanır',
  ortam(async (klasor) => {
    const a = bilgisayarKur({ klasor, aygit: AYGIT_A, ayarEk: { favoriler: [{ ...BETIK, onay: false }] } });
    await a.esitle();
    assert.equal((await a.yonetici.parolaKoy('ortak-parola-123')).ok, true);
    const b = bilgisayarKur({ klasor, aygit: AYGIT_B, ayarEk: { favoriler: [] } });
    await b.parolaDeposu.yaz('ortak-parola-123');
    assert.equal((await b.esitle()).ok, true);
    assert.equal(b.ayarlar.favoriler[0].onay, false);
  }),
);

