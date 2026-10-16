'use strict';

/**
 * Yetki kesici (src/lib/yetki-kesici.js) ve sınırlı eşzamanlılık (src/lib/sinirli-eszamanli.js): saf modüller, bellek içi sahte fs.
 * Gerçek ağ, gerçek dosya ve gerçek anahtar yok; anahtarlar sahtedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DURAKLATMA_MS, EN_COK_BELIRSIZ, EN_COK_BELIRSIZ_IYI, EN_COK_KAYIT, HATA_BUTCESI_ESIGI, anahtarParmakIzi, kayitlariDuzelt, yetkiKesiciOlustur } = require('../src/lib/yetki-kesici');
const { sinirliEszamanli } = require('../src/lib/sinirli-eszamanli');

const ANAHTAR = 'SAHTE_ERISIM_ANAHTARI_ABCDEFGHIJ_0123456789';
const DOSYA = 'C:\\sahte\\yetki-kesici.json';
const TABAN = 'http://192.168.1.10:8123';
const DIS = 'https://ha.example.com';

function sahteFs(baslangic = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  return {
    dosyalar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => {
      if (!dosyalar.has(y)) throw new Error('yok');
      return dosyalar.get(y);
    },
    writeFileSync: (y, v) => dosyalar.set(y, String(v)),
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
    mkdirSync() {},
  };
}

function kur({ fs = sahteFs(), simdi = () => 1000 } = {}) {
  const gunlukler = [];
  const reddedilenler = [];
  let degisim = 0;
  const kesici = yetkiKesiciOlustur({
    dosyaYolu: DOSYA,
    fs,
    gunluk: (m) => gunlukler.push(m),
    simdi,
    reddedildi: (p, neden) => reddedilenler.push({ p, neden }),
    degisti: () => {
      degisim += 1;
    },
  });
  return { kesici, fs, gunlukler, reddedilenler, degisimSayisi: () => degisim };
}

test('parmak izi: SHA-256\'nın ilk 16 onaltılık hanesi; anahtarı içermez, deterministik, anahtara göre değişir', () => {
  const p = anahtarParmakIzi(ANAHTAR);
  assert.match(p, /^[0-9a-f]{16}$/);
  assert.equal(p, anahtarParmakIzi(ANAHTAR));
  assert.notEqual(p, anahtarParmakIzi(`${ANAHTAR}x`));
  assert.ok(!ANAHTAR.includes(p));
  // bilinen SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223...
  assert.equal(anahtarParmakIzi('abc'), 'ba7816bf8f01cfea');
});

test('reddet: kalıcı yazılır (dosyada yalnız parmak izi, anahtar yok); yeniden açılışta yüklenir ve aynı anahtar engelli kalır', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.deepEqual(o.kesici.karar({ taban: TABAN, parmakIzi: p }), { izin: true });
  assert.equal(o.kesici.reddet(p, 'HTTP_401'), true);
  assert.deepEqual(o.kesici.karar({ taban: TABAN, parmakIzi: p }), { izin: false, neden: 'reddedildi' });
  assert.deepEqual(o.kesici.karar({ taban: DIS, parmakIzi: p }), { izin: false, neden: 'reddedildi' }, 'hiçbir adrese gitmez');
  const dosya = o.fs.dosyalar.get(DOSYA);
  assert.ok(dosya.includes(p));
  assert.ok(!dosya.includes(ANAHTAR), 'anahtarın kendisi saklanmaz');
  assert.equal(o.fs.dosyalar.has(`${DOSYA}.tmp`), false, 'atomik yazma geçici dosya bırakmaz');

  // "uygulama yeniden başladı": yeni kesici aynı dosyayı yükler
  const yeniden = kur({ fs: o.fs });
  assert.equal(yeniden.kesici.yukle(), 1);
  assert.equal(yeniden.kesici.karar({ taban: TABAN, parmakIzi: p }).izin, false);
  assert.equal(yeniden.kesici.karar({ taban: TABAN, parmakIzi: anahtarParmakIzi(`${ANAHTAR}-yeni`) }).izin, true, 'farklı anahtar serbest');
});

test('reddet: geri çağrı yalnız İLK reddedişte çalışır (parmak izi başına tek bildirim); günlük tek satır, sırsız', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.reddet(p, 'HTTP_401'), true);
  assert.equal(o.kesici.reddet(p, 'WS_AUTH_INVALID'), false);
  assert.equal(o.kesici.reddet(p, 'HTTP_401'), false);
  assert.deepEqual(o.reddedilenler, [{ p, neden: 'HTTP_401' }]);
  assert.equal(o.gunlukler.length, 1);
  assert.match(o.gunlukler[0], /neden=HTTP_401/);
  assert.ok(o.gunlukler[0].includes(p.slice(0, 8)));
  assert.ok(!o.gunlukler[0].includes(p), 'günlükte yalnız ilk 8 hane');
  assert.ok(!o.gunlukler[0].includes(ANAHTAR));
  assert.equal(o.degisimSayisi(), 1);
});

test('reddet: geçersiz parmak izi ve bilinmeyen neden güvenli ele alınır', () => {
  const o = kur();
  assert.equal(o.kesici.reddet('kisa'), false);
  assert.equal(o.kesici.reddet(undefined), false);
  assert.equal(o.kesici.reddet(ANAHTAR), false, 'anahtar parmak izi diye verilse bile kaydedilmez');
  assert.deepEqual(o.kesici.reddedilenler(), []);
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.reddet(p, '<script>');
  assert.match(o.fs.dosyalar.get(DOSYA), /HTTP_401/);
});

test('temizle ("Anahtarı sil"): kayıt silinir, anahtar yeniden serbest; kayıt yoksa false', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.temizle(p), false);
  o.kesici.reddet(p);
  assert.equal(o.kesici.temizle(p), true);
  assert.equal(o.kesici.karar({ taban: TABAN, parmakIzi: p }).izin, true);
  assert.equal(kur({ fs: o.fs }).kesici.yukle(), 0, 'dosyada da temiz');
});

test('farklı parmak izli yeni anahtar serbesttir; eski reddedilen anahtar yine engelli kalır (aynı anahtarı yeniden kaydetmek sıfırlamaz)', () => {
  const o = kur();
  const eski = o.kesici.parmakIzi(ANAHTAR);
  const yeni = o.kesici.parmakIzi(`${ANAHTAR}-yeni`);
  o.kesici.reddet(eski);
  assert.equal(o.kesici.reddedildiMi(yeni), false);
  assert.equal(o.kesici.reddedildiMi(eski), true);
  o.kesici.reddet(yeni);
  assert.deepEqual(o.kesici.reddedilenler(), [eski, yeni]);
});

test('kayıt sayısı sınırlıdır (200); en eskiler EKLEME SIRASINA göre düşer, saat geri alınsa da yeni kayıt atılmaz', () => {
  assert.equal(EN_COK_KAYIT, 200);
  let t = 5000;
  const o = kur({ simdi: () => t });
  for (let i = 0; i < EN_COK_KAYIT + 3; i += 1) {
    t -= 1; // saat geri gidiyor: zamana göre sıralama yeni kaydı eski sanırdı
    o.kesici.reddet(anahtarParmakIzi(`anahtar-${i}`));
  }
  assert.equal(o.kesici.reddedilenler().length, EN_COK_KAYIT);
  assert.equal(o.kesici.reddedildiMi(anahtarParmakIzi('anahtar-0')), false);
  assert.equal(o.kesici.reddedildiMi(anahtarParmakIzi('anahtar-2')), false);
  assert.equal(o.kesici.reddedildiMi(anahtarParmakIzi('anahtar-3')), true);
  assert.equal(o.kesici.reddedildiMi(anahtarParmakIzi(`anahtar-${EN_COK_KAYIT + 2}`)), true, 'en yeni kayıt asla atılmaz');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.equal(yeniden.kesici.reddedildiMi(anahtarParmakIzi(`anahtar-${EN_COK_KAYIT + 2}`)), true);
});

test('(tur2-P4) saklı anahtarın parmak izi KORUNUR: 10 (hatta 250) aday anahtar reddedilse de saklı anahtarın kaydı düşmez', () => {
  const o = kur();
  const sakli = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.reddet(sakli);
  o.kesici.koru(sakli);
  for (let i = 0; i < 250; i += 1) o.kesici.reddet(anahtarParmakIzi(`aday-${i}`));
  assert.equal(o.kesici.reddedildiMi(sakli), true, 'korunan kayıt düşmedi');
  assert.equal(o.kesici.reddedilenler().length, EN_COK_KAYIT);
  // korumasız bile 10 aday saklı anahtarı düşürmez
  const b = kur();
  b.kesici.reddet(sakli);
  for (let i = 0; i < 10; i += 1) b.kesici.reddet(anahtarParmakIzi(`aday-${i}`));
  assert.equal(b.kesici.reddedildiMi(sakli), true);
});

test('yukle: bozuk dosya, bozuk kayıtlar, BOM güvenle ele alınır (çökmez)', () => {
  const bozuk = kur({ fs: sahteFs({ [DOSYA]: '{bozuk' }) });
  assert.equal(bozuk.kesici.yukle(), 0);
  assert.ok(bozuk.gunlukler.some((m) => /okunamadı/.test(m)));
  const p = anahtarParmakIzi(ANAHTAR);
  const karisik = JSON.stringify({ surum: 1, reddedilenler: [{ parmakIzi: p, zaman: 5, neden: 'HTTP_401' }, { parmakIzi: p }, { parmakIzi: 'XYZ' }, null, { parmakIzi: ANAHTAR }] });
  const o = kur({ fs: sahteFs({ [DOSYA]: `\uFEFF${karisik}` }) });
  assert.equal(o.kesici.yukle(), 1);
  assert.equal(o.kesici.reddedildiMi(p), true);
  assert.deepEqual(kayitlariDuzelt({ reddedilenler: 'x' }), []);
});

test('yazma başarısızsa kesici bellekte yine engeller ve günlüğe sırsız satır düşer', () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('disk dolu');
  };
  const o = kur({ fs });
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.reddet(p), true);
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, false);
  assert.ok(o.gunlukler.some((m) => /yazılamadı/.test(m)));
});

test('dosyaYolu verilmezse yalnız bellekte çalışır', () => {
  const kesici = yetkiKesiciOlustur();
  const p = kesici.parmakIzi(ANAHTAR);
  assert.equal(kesici.yukle(), 0);
  kesici.reddet(p);
  assert.equal(kesici.karar({ parmakIzi: p }).izin, false);
});

test('duraklat: o adrese 15 dk istek yok, diğer adres ve anahtar etkilenmez; süre dolunca açılır; tek günlük satırı', () => {
  let t = 5000;
  const o = kur({ simdi: () => t });
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.duraklat(TABAN, 'ev içi adres'), true);
  assert.equal(o.kesici.duraklat(TABAN, 'ev içi adres'), false, 'ikinci 403 süreyi uzatmaz ve günlüğü şişirmez');
  assert.equal(o.gunlukler.length, 1);
  const k = o.kesici.karar({ taban: TABAN, parmakIzi: p });
  assert.equal(k.izin, false);
  assert.equal(k.neden, 'duraklatildi');
  assert.equal(k.kalanMs, DURAKLATMA_MS);
  assert.equal(o.kesici.karar({ taban: `${TABAN}/`, parmakIzi: p }).izin, false, 'köken karşılaştırılır (sondaki / fark etmez)');
  assert.equal(o.kesici.karar({ taban: DIS, parmakIzi: p }).izin, true);
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, true, 'adres verilmezse yalnız anahtar denetlenir');
  t += DURAKLATMA_MS - 1;
  assert.equal(o.kesici.karar({ taban: TABAN, parmakIzi: p }).izin, false);
  t += 1;
  assert.equal(o.kesici.karar({ taban: TABAN, parmakIzi: p }).izin, true);
  assert.equal(DURAKLATMA_MS, 15 * 60 * 1000);
  assert.deepEqual(o.kesici.reddedilenler(), [], '403 anahtarı geçersiz saymaz');
});

test('sinirliEszamanli: en çok sinir kadar iş aynı anda; sonuçlar girdi sırasında', async () => {
  let ayni = 0;
  let enCok = 0;
  const sonuc = await sinirliEszamanli([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
    ayni += 1;
    enCok = Math.max(enCok, ayni);
    await new Promise((coz) => setImmediate(coz));
    ayni -= 1;
    return n * 10;
  });
  assert.deepEqual(sonuc, [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(enCok, 4);
  assert.deepEqual(await sinirliEszamanli([], 4, async () => 1), []);
  assert.deepEqual(await sinirliEszamanli([1, 2], 0, async (n) => n), [1, 2], 'geçersiz sınır 1 sayılır');
});

test('sinirliEszamanli: ilk hatada YENİ iş başlatılmaz, ilk hata fırlatılır', async () => {
  const baslayanlar = [];
  await assert.rejects(
    sinirliEszamanli([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
      baslayanlar.push(n);
      await new Promise((coz) => setImmediate(coz));
      if (n === 1) throw new Error('birinci hata');
      if (n === 2) throw new Error('ikinci hata');
      return n;
    }),
    /birinci hata/,
  );
  assert.deepEqual(baslayanlar, [1, 2, 3, 4], 'kalan 4 iş hiç başlatılmadı');
});

// ===========================================================================
// Tur 1 inceleme düzeltmeleri
// ===========================================================================

test('sinirliEszamanli ilkTek: ilk iş TEK başına çalışır; hata verirse hiçbir iş daha başlamaz, başarırsa kalanlar sınır kadar paralel', async () => {
  const baslayanlar = [];
  await assert.rejects(
    sinirliEszamanli([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
      baslayanlar.push(n);
      await new Promise((coz) => setImmediate(coz));
      throw new Error('ilk hata');
    }, { ilkTek: true }),
    /ilk hata/,
  );
  assert.deepEqual(baslayanlar, [1], 'yalnız ilk istek ağa çıktı');

  let ayni = 0;
  let enCok = 0;
  const sira = [];
  const sonuc = await sinirliEszamanli([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
    sira.push(n);
    ayni += 1;
    enCok = Math.max(enCok, ayni);
    await new Promise((coz) => setImmediate(coz));
    ayni -= 1;
    return n * 10;
  }, { ilkTek: true });
  assert.deepEqual(sonuc, [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(sira[0], 1);
  assert.equal(enCok, 4);
  assert.deepEqual(await sinirliEszamanli([], 4, async () => 1, { ilkTek: true }), []);
  assert.deepEqual(await sinirliEszamanli([5], 4, async (n) => n, { ilkTek: true }), [5]);
});

const YEDEK = 'C:\\sahte\\yetki-kesici.yedek.json';

function kurIkili({ fs = sahteFs(), simdi = () => 1000, yedek = YEDEK } = {}) {
  const gunlukler = [];
  const sorunlar = [];
  const kesici = yetkiKesiciOlustur({
    dosyaYolu: DOSYA,
    yedekYollar: [yedek],
    fs,
    gunluk: (m) => gunlukler.push(m),
    simdi,
    kayitSorunu: (tur) => sorunlar.push(tur),
  });
  return { kesici, fs, gunlukler, sorunlar, yedek };
}

test('kalıcı kayıt IKI yere yazılır: ana dosya yazılamazsa yedek dosya kalır ve yeniden başlatmada aynı anahtar yine engelli (HA\'ya ek deneme yok)', () => {
  const fs = sahteFs();
  const gercekYaz = fs.writeFileSync;
  fs.writeFileSync = (y, v) => {
    if (String(y).startsWith(DOSYA)) throw new Error('EPERM: ana dosya kilitli');
    return gercekYaz(y, v);
  };
  const ilk = kurIkili({ fs });
  const p = ilk.kesici.parmakIzi(ANAHTAR);
  ilk.kesici.reddet(p);
  assert.deepEqual(ilk.sorunlar, [], 'bir yere yazılabildi: kullanıcıya sorun bildirilmez');
  for (let i = 0; i < 5; i += 1) {
    const yeniden = kurIkili({ fs });
    assert.equal(yeniden.kesici.yukle(), 1);
    assert.equal(yeniden.kesici.reddedildiMi(p), true, `yeniden başlatma ${i + 1}`);
  }
});

test('hiçbir yere yazılamıyorsa kullanıcıya BİR kez görünür kılınır (yazilamadi); kesici bellekte yine engeller; yazma düzelirse sorun silinir', () => {
  const fs = sahteFs();
  const gercekYaz = fs.writeFileSync;
  let bozuk = true;
  fs.writeFileSync = (y, v) => {
    if (bozuk) throw new Error('EPERM');
    return gercekYaz(y, v);
  };
  const o = kurIkili({ fs });
  const p = o.kesici.parmakIzi(ANAHTAR);
  const p2 = o.kesici.parmakIzi(`${ANAHTAR}-2`);
  o.kesici.reddet(p);
  o.kesici.reddet(p2);
  assert.deepEqual(o.sorunlar, ['yazilamadi'], 'tek bildirim');
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, false);
  assert.equal(o.kesici.kayitSorunu(), 'yazilamadi');
  bozuk = false;
  o.kesici.reddet(o.kesici.parmakIzi(`${ANAHTAR}-3`));
  assert.equal(o.kesici.kayitSorunu(), null, 'yazma yeniden başarılı: sorun kalktı');
  assert.ok(![...o.gunlukler].join('\n').includes(ANAHTAR));
});

test('okuma hatası (kilitli dosya): eski kayıtlar yedekten gelir, sorun bildirilir ve yeni ret ana dosyanın ÜZERİNE YAZMAZ', () => {
  const eski = anahtarParmakIzi('eski-anahtar');
  const yeni = anahtarParmakIzi('yeni-anahtar');
  const icerik = JSON.stringify({ surum: 1, reddedilenler: [{ parmakIzi: eski, zaman: 1, neden: 'HTTP_401' }] });
  const fs = sahteFs({ [DOSYA]: icerik, [YEDEK]: icerik });
  const gercekOku = fs.readFileSync;
  fs.readFileSync = (y) => {
    if (y === DOSYA) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return gercekOku(y);
  };
  const yazilanlar = [];
  const gercekYaz = fs.writeFileSync;
  fs.writeFileSync = (y, v) => {
    yazilanlar.push(y);
    return gercekYaz(y, v);
  };
  const o = kurIkili({ fs });
  assert.equal(o.kesici.yukle(), 1);
  assert.equal(o.kesici.reddedildiMi(eski), true, 'yedekten yüklendi');
  assert.deepEqual(o.sorunlar, ['okunamadi']);
  o.kesici.reddet(yeni);
  assert.ok(!yazilanlar.some((y) => String(y).startsWith(DOSYA)), 'okunamayan ana dosyanın üzerine yazılmadı');
  const diske = JSON.parse(fs.dosyalar.get(YEDEK));
  assert.deepEqual(diske.reddedilenler.map((k) => k.parmakIzi).sort(), [eski, yeni].sort(), 'eski kayıt yedekte korunur, yenisi eklenir');
  assert.equal(fs.dosyalar.get(DOSYA), icerik, 'ana dosya olduğu gibi');
});

test('okuma geçici bir hataysa (ilk okuma kilitli, yazma anında açık) eski parmak izleri ana dosyaya BİRLEŞTİRİLEREK yazılır', () => {
  const eski = anahtarParmakIzi('eski-anahtar');
  const yeni = anahtarParmakIzi('yeni-anahtar');
  const fs = sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, reddedilenler: [{ parmakIzi: eski, zaman: 1, neden: 'HTTP_401' }] }) });
  const gercekOku = fs.readFileSync;
  let kilitli = true;
  fs.readFileSync = (y) => {
    if (y === DOSYA && kilitli) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return gercekOku(y);
  };
  const o = kurIkili({ fs });
  assert.equal(o.kesici.yukle(), 0);
  assert.deepEqual(o.sorunlar, ['okunamadi']);
  kilitli = false; // antivirüs kilidi kalktı
  o.kesici.reddet(yeni);
  const diske = JSON.parse(fs.dosyalar.get(DOSYA));
  assert.deepEqual(diske.reddedilenler.map((k) => k.parmakIzi).sort(), [eski, yeni].sort());
  assert.equal(o.kesici.reddedildiMi(eski), true);
  assert.equal(o.kesici.kayitSorunu(), null);
});

test('bozuk (JSON değil) kayıt dosyası ".bozuk" adıyla kenara alınır; sonraki yazma temiz dosya üretir; kayitSorunu() boş kalır ama kullanıcıya BİR kez bildirilir (onay bekler: tur 3, K5)', () => {
  const fs = sahteFs({ [DOSYA]: '{bozuk' });
  const o = kurIkili({ fs });
  assert.equal(o.kesici.yukle(), 0);
  assert.equal(fs.dosyalar.get(`${DOSYA}.bozuk`), '{bozuk');
  assert.equal(fs.dosyalar.has(DOSYA), false);
  o.kesici.reddet(o.kesici.parmakIzi(ANAHTAR));
  assert.equal(JSON.parse(fs.dosyalar.get(DOSYA)).reddedilenler.length, 1);
  assert.ok(o.gunlukler.some((m) => /bozuk/.test(m)));
  assert.equal(o.kesici.kayitSorunu(), null);
  assert.deepEqual(o.sorunlar, ['okunamadi'], 'bozuk dosya da kullanıcıya bildirilir (tek kez)');
});

test('temizle ("Anahtarı sil") her iki dosyayı da boşaltır', () => {
  const fs = sahteFs();
  const o = kurIkili({ fs });
  o.kesici.reddet(o.kesici.parmakIzi(ANAHTAR));
  assert.equal(o.kesici.temizle(o.kesici.parmakIzi(ANAHTAR)), true);
  assert.deepEqual(JSON.parse(fs.dosyalar.get(DOSYA)).reddedilenler, []);
  assert.deepEqual(JSON.parse(fs.dosyalar.get(o.yedek)).reddedilenler, []);
  const yeniden = kurIkili({ fs });
  assert.equal(yeniden.kesici.yukle(), 0);
});

// --- Tur 2 inceleme: belirsiz sayacı, kalıcılık, doğrulanmış anahtar, kalici bayrağı --------------------------------------

test('(tur3-K2) belirsiz (yanıtsız) deneme sayısı KALICI: hiç doğrulanmamış anahtarda İLK belirsizlikte "dogrulanamadi"; yeniden başlatma sıfırlamaz', () => {
  assert.equal(EN_COK_BELIRSIZ, 1);
  const bildirimler = [];
  const fs = sahteFs();
  const yap = () => {
    const gunlukler = [];
    const kesici = yetkiKesiciOlustur({ dosyaYolu: DOSYA, yedekYollar: [YEDEK], fs, gunluk: (m) => gunlukler.push(m), dogrulanamadi: (p, kalici) => bildirimler.push({ p, kalici }) });
    kesici.yukle();
    return { kesici, gunlukler };
  };
  const ilk = yap();
  const p = ilk.kesici.parmakIzi(ANAHTAR);
  assert.deepEqual(ilk.kesici.belirsizKaydet(p), { sayi: 1, sinirAsildi: true });
  assert.deepEqual(ilk.kesici.karar({ taban: TABAN, parmakIzi: p }), { izin: false, neden: 'dogrulanamadi' }, 'ilk belirsizlikte durur');
  const yeniden = yap(); // uygulama yeniden başladı: sayaç diskten gelir
  assert.equal(yeniden.kesici.belirsizSayisi(p), 1);
  assert.deepEqual(yeniden.kesici.karar({ taban: TABAN, parmakIzi: p }), { izin: false, neden: 'dogrulanamadi' });
  assert.deepEqual(yeniden.kesici.karar({ taban: DIS, parmakIzi: p }), { izin: false, neden: 'dogrulanamadi' }, 'hiçbir adrese');
  assert.deepEqual(bildirimler, [{ p, kalici: true }], 'tek bildirim');
  assert.equal(yeniden.kesici.reddedildiMi(p), false, 'anahtar "reddedilmiş" sayılmaz');
  assert.ok(ilk.gunlukler.some((m) => /doğrulanamadı/.test(m) && m.includes(p.slice(0, 8)) && !m.includes(p)));
  assert.ok(![...ilk.gunlukler].join('\n').includes(ANAHTAR));
  assert.ok(!fs.dosyalar.get(DOSYA).includes(ANAHTAR));
});

test('(tur3-K2) başarılı doğrulama belirsiz sayacını sıfırlar ve anahtarı "doğrulanmış" işaretler; doğrulanmış anahtar için sınır 2', () => {
  assert.equal(EN_COK_BELIRSIZ_IYI, 2);
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.belirsizKaydet(p);
  o.kesici.dogrulandi(p);
  assert.equal(o.kesici.belirsizSayisi(p), 0);
  assert.equal(o.kesici.iyiMi(p), true, 'daha önce başarıyla doğrulanmış');
  assert.deepEqual(o.kesici.belirsizKaydet(p), { sayi: 1, sinirAsildi: false });
  assert.deepEqual(o.kesici.belirsizKaydet(p), { sayi: 2, sinirAsildi: true }, 'doğrulanmış anahtar: ikinciye kadar');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.equal(yeniden.kesici.iyiMi(p), true, 'doğrulanmış parmak izi kalıcı');
  assert.equal(yeniden.kesici.karar({ parmakIzi: p }).neden, 'dogrulanamadi');
});

test('(tur3-K2) belirsizSifirla: doğrulama dışı başarılı REST yanıtı yalnız belirsiz sayacı siler; "doğrulanmış" işareti VERMEZ', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.dogrulandi(p);
  o.kesici.belirsizKaydet(p);
  o.kesici.belirsizSifirla(p);
  assert.equal(o.kesici.belirsizSayisi(p), 0);
  const q = o.kesici.parmakIzi(`${ANAHTAR}-2`);
  o.kesici.belirsizKaydet(q); // doğrulanmamış: durur
  o.kesici.yenidenDene();
  o.kesici.belirsizSifirla(q);
  assert.equal(o.kesici.iyiMi(q), false);
});

test('(tur3-K2) yenidenDene: kullanıcı onayıyla TEK yeni deneme hakkı verilir; başarısız olursa yine durur, başarırsa sayaç temizlenir', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.belirsizKaydet(p);
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, false);
  assert.equal(o.kesici.yenidenDene(), true);
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, true);
  assert.equal(o.kesici.belirsizKaydet(p).sinirAsildi, true, 'tek hak: yine belirsizse yeniden durur');
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, false);
  o.kesici.yenidenDene();
  o.kesici.dogrulandi(p);
  assert.equal(o.kesici.belirsizSayisi(p), 0);
  assert.equal(o.kesici.yenidenDene(), false, 'durdurulmuş anahtar yok');
});

test('(tur2-P3) reddet belirsiz sayacını ve doğrulanmış işaretini siler; temizle (parmak izi) o anahtarın hepsini siler', () => {
  const o = kur();
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.dogrulandi(p);
  o.kesici.belirsizKaydet(p);
  o.kesici.reddet(p);
  assert.equal(o.kesici.belirsizSayisi(p), 0);
  assert.equal(o.kesici.iyiMi(p), false);
  const q = o.kesici.parmakIzi(`${ANAHTAR}-2`);
  o.kesici.dogrulandi(q);
  o.kesici.belirsizKaydet(q);
  assert.equal(o.kesici.temizle(q), true);
  assert.equal(o.kesici.belirsizSayisi(q), 0);
  assert.equal(o.kesici.iyiMi(q), false);
  assert.equal(o.kesici.reddedildiMi(p), true, 'başka anahtarın kaydına dokunulmadı');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.equal(yeniden.kesici.iyiMi(q), false);
  assert.equal(yeniden.kesici.belirsizSayisi(q), 0);
  assert.equal(yeniden.kesici.reddedildiMi(p), true);
});

// --- Tur 3: hata bütçesi, güvenilmez kayıt, seçici temizleme ---------------------------------------------------------------

test('(tur3-K4) hata bütçesi: her 401/auth_invalid sayılır (aynı anahtar için de), kalıcıdır, dosyada yalnız sayı vardır; yalnız girisBasarili (WS auth_ok) sıfırlar', () => {
  assert.equal(HATA_BUTCESI_ESIGI, 2);
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  const b = o.kesici.parmakIzi('B'.repeat(30));
  const yeni = o.kesici.parmakIzi('C'.repeat(30));
  assert.equal(o.kesici.onayGerekliMi(yeni), null);
  o.kesici.reddet(a);
  assert.equal(o.kesici.onayGerekliMi(yeni), null, 'sayaç 1');
  o.kesici.reddet(b);
  assert.deepEqual(o.kesici.onayGerekliMi(yeni), { neden: 'hata-butcesi', sayi: 2 });
  o.kesici.reddet(b); // aynı anahtar yeniden reddedildi: HA bunu da saymıştır
  assert.equal(o.kesici.hataliDenemeSayisi(), 3);
  assert.deepEqual(JSON.parse(o.fs.dosyalar.get(DOSYA)).hataliKoken, { yerel: 3, dis: 3 }, 'kökeni bilinmeyen ret her iki kökene yazılır (muhafazakâr)');
  o.kesici.dogrulandi(yeni);
  assert.equal(o.kesici.onayGerekliMi(yeni)?.neden, 'hata-butcesi', 'doğrulanmış olsa da bütçeden muaf değildir: aday da, Yeniden Dene de (tur5-K8, tur8-K12a)');
  assert.equal(o.kesici.hataliDenemeSayisi(), 3, 'REST doğrulaması hata bütçesini sıfırlamaz');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.equal(yeniden.kesici.hataliDenemeSayisi(), 3, 'yeniden başlatmada kalıcı');
  yeniden.kesici.girisBasarili('yerel');
  yeniden.kesici.girisBasarili('dis');
  assert.equal(yeniden.kesici.hataliDenemeSayisi(), 0);
  assert.deepEqual(JSON.parse(yeniden.fs.dosyalar.get(DOSYA)).hataliKoken, { yerel: 0, dis: 0 });
  assert.equal(yeniden.kesici.onayGerekliMi(yeniden.kesici.parmakIzi('D'.repeat(30))), null);
});

test('(tur3-K4) hata bütçesi: bozuk sayaç değeri 0 sayılır; iki dosyadaki en yüksek değer geçerlidir', () => {
  const fs = sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, hataliDeneme: 'x' }), [YEDEK]: JSON.stringify({ surum: 1, hataliDeneme: 4 }) });
  const k = yetkiKesiciOlustur({ dosyaYolu: DOSYA, yedekYollar: [YEDEK], fs });
  k.yukle();
  assert.equal(k.hataliDenemeSayisi(), 4);
  const bozuk = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs: sahteFs({ [DOSYA]: JSON.stringify({ hataliDeneme: -5 }) }) });
  bozuk.yukle();
  assert.equal(bozuk.hataliDenemeSayisi(), 0);
});

test('(tur3-K5) kayıt dosyası bozuk ya da okunamıyorsa: onay bekler (her anahtar, doğrulanmış olsa bile); yenidenDene ya da onayVer kapıyı açar', () => {
  const fs = sahteFs({ [DOSYA]: '{bozuk' });
  const o = kurIkili({ fs });
  o.kesici.yukle();
  assert.equal(o.kesici.onayDurumu(), 'kayit-okunamadi');
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.deepEqual(o.kesici.karar({ parmakIzi: p }), { izin: false, neden: 'dogrulanamadi' });
  assert.deepEqual(o.kesici.onayGerekliMi(p), { neden: 'kayit-okunamadi' });
  assert.equal(o.kesici.dogrulanamadiMi(p), true);
  assert.equal(o.kesici.onayVer(), true);
  assert.equal(o.kesici.onayDurumu(), null);
  assert.equal(o.kesici.karar({ parmakIzi: p }).izin, true);
  assert.equal(o.kesici.onayVer(), false);

  const kilitli = sahteFs();
  kilitli.readFileSync = () => {
    throw new Error('EBUSY');
  };
  kilitli.dosyalar.set(DOSYA, '{}');
  const k = kurIkili({ fs: kilitli });
  k.kesici.yukle();
  assert.equal(k.kesici.onayDurumu(), 'kayit-okunamadi');
  assert.equal(k.kesici.yenidenDene(), true);
  assert.equal(k.kesici.onayDurumu(), null);
});

test('(tur3-K5) kayıt yok (ilk çalışma) güvenilmez DEĞİLDİR; yazılabilirlik denenir ama gerçek kayıt dosyası OLUŞTURULMAZ', () => {
  const fs = sahteFs();
  const o = kurIkili({ fs });
  o.kesici.yukle();
  assert.equal(o.kesici.onayDurumu(), null);
  assert.equal(fs.dosyalar.has(DOSYA), false);
  assert.equal(fs.dosyalar.has(o.yedek), false);
});

test('(tur3-K5) kayıt konumlarının HİÇBİRİNE yazılamıyorsa açılışta onay bekler (kayit-yazilamadi); biri yazılabiliyorsa beklemez', () => {
  const fs = sahteFs();
  const yaz = fs.writeFileSync;
  fs.writeFileSync = (y, v) => {
    if (String(y).startsWith(DOSYA)) throw new Error('EROFS');
    return yaz(y, v);
  };
  const bir = kurIkili({ fs });
  bir.kesici.yukle();
  assert.equal(bir.kesici.onayDurumu(), null, 'yedek konum yazılabiliyor');
  const hic = sahteFs();
  hic.writeFileSync = () => {
    throw new Error('EROFS');
  };
  const k = kurIkili({ fs: hic });
  k.kesici.yukle();
  assert.equal(k.kesici.onayDurumu(), 'kayit-yazilamadi');
  assert.equal(k.kesici.kayitSorunu(), 'yazilamadi');
  assert.deepEqual(k.kesici.onayGerekliMi(k.kesici.parmakIzi(ANAHTAR)), { neden: 'kayit-yazilamadi' });
});

test('(tur3-K5) temizle(parmakIzi): yalnız o anahtarın kaydı; geçersiz parmak izi false; okunamayan dosya ve hata bütçesi korunur', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  const b = o.kesici.parmakIzi('B'.repeat(30));
  o.kesici.reddet(a);
  o.kesici.reddet(b);
  assert.equal(o.kesici.temizle(undefined), false);
  assert.equal(o.kesici.temizle('zz'), false);
  assert.equal(o.kesici.temizle(a), true);
  assert.deepEqual(o.kesici.reddedilenler(), [b]);
  assert.equal(o.kesici.hataliDenemeSayisi(), 2);
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.deepEqual(yeniden.kesici.reddedilenler(), [b]);
  assert.equal(yeniden.kesici.hataliDenemeSayisi(), 2);
});

test('(tur2-P2) kayıt hiçbir yere yazılamıyorsa reddedildi/dogrulanamadi geri çağrıları kalici=false ile çağrılır (ana süreç anahtar dosyasını kenara alsın)', () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('ENOSPC');
  };
  const olaylar = [];
  const kesici = yetkiKesiciOlustur({
    dosyaYolu: DOSYA,
    yedekYollar: [YEDEK],
    fs,
    reddedildi: (p, neden, kalici) => olaylar.push(['reddedildi', neden, kalici]),
    dogrulanamadi: (p, kalici) => olaylar.push(['dogrulanamadi', kalici]),
  });
  kesici.yukle();
  kesici.reddet(kesici.parmakIzi(ANAHTAR), 'HTTP_401');
  const q = kesici.parmakIzi(`${ANAHTAR}-2`);
  kesici.belirsizKaydet(q);
  kesici.belirsizKaydet(q);
  assert.deepEqual(olaylar, [['reddedildi', 'HTTP_401', false], ['dogrulanamadi', false]]);
  // yazılabiliyorsa kalici=true
  const iyi = [];
  const k2 = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs: sahteFs(), reddedildi: (p, n, kalici) => iyi.push(kalici) });
  k2.yukle();
  k2.reddet(k2.parmakIzi(ANAHTAR));
  assert.deepEqual(iyi, [true]);
});

test('(tur4-K5) onayBileti(parmakIzi): küresel onayı AÇMAZ; yalnız o parmak izine geçici izin verir, bırakılınca kalkar; onay yalnız onayVer/yenidenDene ile temizlenir', () => {
  const fs = sahteFs({ [DOSYA]: '{bozuk' });
  const o = kurIkili({ fs });
  o.kesici.yukle();
  const aday = o.kesici.parmakIzi('ADAY_ANAHTAR_AAAAAAAAAAAAAAAAAAAA');
  const sakli = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.karar({ parmakIzi: aday }).izin, false);
  const birak = o.kesici.onayBileti(aday);
  assert.equal(o.kesici.onayDurumu(), 'kayit-okunamadi', 'küresel onay AÇILMADI');
  assert.equal(o.kesici.karar({ parmakIzi: aday }).izin, true, 'bilet sahibi aday geçer');
  assert.deepEqual(o.kesici.karar({ parmakIzi: sakli }), { izin: false, neden: 'dogrulanamadi' }, 'saklı anahtar hâlâ onay bekliyor');
  assert.equal(o.kesici.dogrulanamadiMi(sakli), true);
  birak();
  birak(); // ikinci çağrı etkisiz
  assert.equal(o.kesici.karar({ parmakIzi: aday }).izin, false, 'bilet bırakılınca kalkar');
  assert.equal(o.kesici.onayDurumu(), 'kayit-okunamadi');
  assert.equal(o.kesici.onayVer(), true);
  assert.equal(o.kesici.karar({ parmakIzi: sakli }).izin, true);
});


// --- Tur 5 (K8): köken başına hata bütçesi, kayıt + bütçe birlikte, aday muafiyeti yok ------------------------------------

test('(tur5-K8) hata bütçesi KÖKEN başına: dış kökende 2 hata + ev içi auth_ok -> dış kökende hâlâ 2; yalnız o kökenin başarısı o sayacı sıfırlar', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  const b = o.kesici.parmakIzi('B'.repeat(30));
  const aday = o.kesici.parmakIzi('C'.repeat(30));
  o.kesici.reddet(a, 'HTTP_401', 'dis');
  o.kesici.reddet(b, 'HTTP_401', 'dis');
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 2);
  assert.equal(o.kesici.hataliDenemeSayisi('yerel'), 0);
  assert.equal(o.kesici.hataliDenemeSayisi(), 2, 'köken verilmezse en yüksek');
  o.kesici.girisBasarili('yerel'); // evde WS auth_ok
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 2, 'ev içi başarı dış kökenin (evin internet IP) sayacını sıfırlamaz');
  assert.deepEqual(o.kesici.onayGerekliMi(aday, { koken: 'dis' }), { neden: 'hata-butcesi', sayi: 2 });
  assert.equal(o.kesici.onayGerekliMi(aday, { koken: 'yerel' }), null, 'ev içi köken temiz');
  assert.deepEqual(o.kesici.onayGerekliMi(aday), { neden: 'hata-butcesi', sayi: 2 }, 'köken bilinmiyorsa en yüksek sayaç');
  o.kesici.girisBasarili('dis');
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 0);
  o.kesici.reddet(a, 'HTTP_401', 'yerel');
  o.kesici.girisBasarili(undefined); // köken bilinmiyorsa HİÇBİR sayaç sıfırlanmaz
  assert.equal(o.kesici.hataliDenemeSayisi('yerel'), 1);
  // kalıcı: yeniden başlatmada köken başına
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.equal(yeniden.kesici.hataliDenemeSayisi('yerel'), 1);
  assert.equal(yeniden.kesici.hataliDenemeSayisi('dis'), 0);
});

test('(tur5-K8) eski tek sayaçlı kayıt (hataliDeneme: N) okunursa değer HER İKİ kökene yazılır (muhafazakâr göç); yeni biçim köken başına okunur', () => {
  const eski = kur({ fs: sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, hataliDeneme: 3 }) }) });
  eski.kesici.yukle();
  assert.equal(eski.kesici.hataliDenemeSayisi('yerel'), 3);
  assert.equal(eski.kesici.hataliDenemeSayisi('dis'), 3);
  const yeni = kur({ fs: sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, hataliKoken: { yerel: 0, dis: 2 } }) }) });
  yeni.kesici.yukle();
  assert.equal(yeni.kesici.hataliDenemeSayisi('yerel'), 0);
  assert.equal(yeni.kesici.hataliDenemeSayisi('dis'), 2);
  const bozuk = kur({ fs: sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, hataliKoken: { yerel: 'x', dis: -4 } }) }) });
  bozuk.kesici.yukle();
  assert.equal(bozuk.kesici.hataliDenemeSayisi(), 0);
});

test('(tur5-K8) onayGerekliMi kayıt ve bütçe nedenlerini BİRLİKTE döndürür (bozuk kayıt + bütçe 3); doğrulanmış anahtar da bütçeden muaf değil (K12a)', () => {
  const yedek = 'C:\sahte\yedek\yetki-kesici.json';
  const fs = sahteFs({ [DOSYA]: '{bozuk', [yedek]: JSON.stringify({ surum: 1, hataliKoken: { yerel: 3, dis: 0 } }) });
  const k = yetkiKesiciOlustur({ dosyaYolu: DOSYA, yedekYollar: [yedek], fs });
  k.yukle();
  assert.equal(k.onayDurumu(), 'kayit-okunamadi');
  assert.equal(k.hataliDenemeSayisi(), 3);
  const p = k.parmakIzi(ANAHTAR);
  assert.deepEqual(k.onayGerekliMi(p), { neden: 'hata-butcesi', sayi: 3, kayit: 'kayit-okunamadi' });
  assert.deepEqual(k.onayGerekliMi(p, { koken: 'dis' }), { neden: 'kayit-okunamadi' }, 'dış kökenin bütçesi boş: yalnız kayıt nedeni');
  k.dogrulandi(p);
  assert.deepEqual(k.onayGerekliMi(p), { neden: 'hata-butcesi', sayi: 3, kayit: 'kayit-okunamadi' }, 'doğrulanmış anahtar da bütçeden muaf değil (tur8-K12a)');
});

// --- Tur 9 (K14, K15, K16): belirsiz denemeler ASKIDA sayılır; geçerli anahtar kilitlenmez ----------------------------------------------

const butce = (kesici) => ({ yerel: kesici.hataliDenemeSayisi('yerel'), dis: kesici.hataliDenemeSayisi('dis') });
const diskte = (o) => JSON.parse(o.fs.dosyalar.get(DOSYA));

test('(tur9-K14) belirsiz deneme köken bütçesine ASKIDA girer; anahtar herhangi bir kökenden başarı alınca TÜM kökenlerdeki askıdakileri düşer (doğrulama, geçerli REST yanıtı)', () => {
  for (const basari of ['dogrulandi', 'belirsizSifirla']) {
    const o = kur();
    const p = o.kesici.parmakIzi('A'.repeat(30));
    o.kesici.belirsizKaydet(p, 'dis');
    o.kesici.belirsizKaydet(p, 'yerel');
    assert.deepEqual(butce(o.kesici), { yerel: 1, dis: 1 });
    assert.deepEqual(diskte(o).hataliKoken, { yerel: 0, dis: 0 }, 'kesin sayaçlara yazılmaz');
    assert.deepEqual(diskte(o).askida, [{ parmakIzi: p, yerel: 1, dis: 1 }], 'askıda: parmak izi + köken başına, kalıcı');
    o.kesici[basari](p);
    assert.deepEqual(butce(o.kesici), { yerel: 0, dis: 0 }, `${basari}: iki kökenin bütçesinden de düştü`);
    assert.deepEqual(diskte(o).askida, []);
    assert.equal(o.kesici.onayGerekliMi(o.kesici.parmakIzi('B'.repeat(30))), null);
  }
});

test('(tur9-K14) başka anahtarın başarısı askıdakileri düşürmez; kesin (401) sayaçlar başarıyla düşmez; kesinleşen askıdakiler bütçede kalır', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  const b = o.kesici.parmakIzi('B'.repeat(30));
  o.kesici.belirsizKaydet(a, 'yerel');
  o.kesici.belirsizKaydet(b, 'yerel');
  o.kesici.reddet(o.kesici.parmakIzi('C'.repeat(30)), 'HTTP_401', 'yerel'); // kesin 1
  assert.deepEqual(butce(o.kesici), { yerel: 3, dis: 0 });
  o.kesici.dogrulandi(b); // yalnız b'nin askıdakileri
  assert.deepEqual(butce(o.kesici), { yerel: 2, dis: 0 });
  o.kesici.belirsizSifirla(b);
  assert.deepEqual(butce(o.kesici), { yerel: 2, dis: 0 }, 'kesin 401 sayacı REST başarısıyla düşmez');
  // a anahtarı 401 alırsa askıdaki denemesi KESİNLEŞİR (bütçede kalır) + kendi 401'i
  o.kesici.reddet(a, 'HTTP_401', 'yerel');
  assert.deepEqual(butce(o.kesici), { yerel: 3, dis: 0 });
  assert.deepEqual(diskte(o).hataliKoken, { yerel: 3, dis: 0 });
  assert.deepEqual(diskte(o).askida, []);
  o.kesici.dogrulandi(a); // reddedilmiş: etkisiz
  assert.deepEqual(butce(o.kesici), { yerel: 3, dis: 0 });
});

test('(tur9-K14) kesin sayaçlar yalnız o kökenden WS auth_ok ile sıfırlanır (K8); auth_ok o kökenin HA sayacını sildiği için o kökenin askıdakileri de düşer, diğer köken değişmez', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  const b = o.kesici.parmakIzi('B'.repeat(30));
  o.kesici.reddet(b, 'HTTP_401', 'yerel');
  o.kesici.reddet(o.kesici.parmakIzi('D'.repeat(30)), 'HTTP_401', 'dis');
  o.kesici.belirsizKaydet(a, 'yerel');
  o.kesici.belirsizKaydet(a, 'dis');
  assert.deepEqual(butce(o.kesici), { yerel: 2, dis: 2 });
  o.kesici.girisBasarili('yerel');
  assert.deepEqual(butce(o.kesici), { yerel: 0, dis: 2 });
  assert.deepEqual(diskte(o).askida, [{ parmakIzi: a, yerel: 0, dis: 1 }]);
  o.kesici.girisBasarili(undefined); // köken bilinmiyorsa hiçbir şey sıfırlanmaz
  assert.deepEqual(butce(o.kesici), { yerel: 0, dis: 2 });
});

test('(tur9-K14) kalıcı kayıt: askıdakiler parmak izi + köken ile yüklenir; ESKİ biçim (yalnız hataliKoken + belirsiz) muhafazakâr KESİN sayılır ve başarıyla düşmez', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.belirsizKaydet(a, 'dis');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.deepEqual(butce(yeniden.kesici), { yerel: 0, dis: 1 });
  yeniden.kesici.dogrulandi(a);
  assert.deepEqual(butce(yeniden.kesici), { yerel: 0, dis: 0 }, 'yeniden başlatmadan sonra da askıda: başarıyla düşer');
  assert.deepEqual(diskte(yeniden).askida, []);

  const eski = kur({ fs: sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, belirsiz: [{ parmakIzi: a, sayi: 1 }], hataliKoken: { yerel: 1, dis: 1 }, dogrulananlar: [a] }) }) });
  eski.kesici.yukle();
  assert.deepEqual(butce(eski.kesici), { yerel: 1, dis: 1 });
  eski.kesici.dogrulandi(a);
  assert.deepEqual(butce(eski.kesici), { yerel: 1, dis: 1 }, 'eski biçim: kesin (askıda değil), başarı düşürmez');

  const bozuk = kur({ fs: sahteFs({ [DOSYA]: JSON.stringify({ surum: 1, askida: [{ parmakIzi: 'x', yerel: 1, dis: 1 }, { parmakIzi: a, yerel: 'x', dis: -3 }, { parmakIzi: a, yerel: 2, dis: 0 }, null] }) }) });
  bozuk.kesici.yukle();
  assert.deepEqual(butce(bozuk.kesici), { yerel: 2, dis: 0 }, 'bozuk askıda girdileri atılır');
});

test('(tur9-K14) artakalan "yolda" işareti açılışta askıda sayılır (kökeniyle); anahtar başarı alınca düşer', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.yoldaBaslat(a, 'dis');
  const yeniden = kur({ fs: o.fs });
  yeniden.kesici.yukle();
  assert.deepEqual(butce(yeniden.kesici), { yerel: 0, dis: 1 });
  assert.deepEqual(diskte(yeniden).askida, [{ parmakIzi: a, yerel: 0, dis: 1 }]);
  yeniden.kesici.dogrulandi(a);
  assert.deepEqual(butce(yeniden.kesici), { yerel: 0, dis: 0 });
});

test('(tur9-K14) "Anahtarı sil": o anahtarın askıdakileri KESİNLEŞİR (bütçede kalır; sayaçlara dokunulmaz, tur 3 kuralı)', () => {
  const o = kur();
  const a = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.belirsizKaydet(a, 'yerel');
  o.kesici.temizle(a);
  assert.deepEqual(butce(o.kesici), { yerel: 1, dis: 0 });
  assert.deepEqual(diskte(o).hataliKoken, { yerel: 1, dis: 0 });
  assert.deepEqual(diskte(o).askida, []);
});

test('(tur9-K15) K12b kaldırıldı: doğrulanmış anahtar, bütçe ne olursa olsun (kesin 4+ ya da askıda), yalnız belirsiz sınırıyla (K2) durur; karar() köken/bütçe bilmez', () => {
  const o = kur();
  const iyi = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.dogrulandi(iyi);
  for (let i = 0; i < 6; i += 1) o.kesici.reddet(o.kesici.parmakIzi(String(i).repeat(30)), 'HTTP_401', 'yerel');
  assert.equal(o.kesici.hataliDenemeSayisi('yerel'), 6);
  for (const koken of [undefined, 'yerel', 'dis']) {
    assert.deepEqual(o.kesici.karar({ parmakIzi: iyi, koken }), { izin: true }, `kesin sayaç 6: karar ${koken}`);
  }
  assert.equal(o.kesici.dogrulanamadiMi(iyi), false);
  assert.ok(!o.gunlukler.some((m) => /hata bütçesi sınırına/.test(m)));
  assert.equal(require('../src/lib/yetki-kesici').OTOMATIK_BUTCE_SINIRI, undefined, 'K12b sabiti kalktı');
  // K2: art arda 2 belirsiz -> durur; araya başarı girerse sayaç sıfırlanır
  o.kesici.belirsizKaydet(iyi, 'yerel');
  o.kesici.dogrulandi(iyi);
  o.kesici.belirsizKaydet(iyi, 'yerel');
  assert.equal(o.kesici.dogrulanamadiMi(iyi), false, 'araya başarı girdi: ardışık değil');
  o.kesici.belirsizKaydet(iyi, 'yerel');
  assert.equal(o.kesici.dogrulanamadiMi(iyi), true, 'iki ardışık belirsiz');
  assert.deepEqual(o.kesici.karar({ parmakIzi: iyi }), { izin: false, neden: 'dogrulanamadi' });
});

test('(tur9-K15) yenidenDene() doğrulanmış işaretini düşürmez (K12b geri alındı); durmuş anahtara TEK yeni hak verir', () => {
  const o = kur();
  const iyi = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.dogrulandi(iyi);
  for (let i = 0; i < 4; i += 1) o.kesici.reddet(o.kesici.parmakIzi(String(i).repeat(30)), 'HTTP_401', 'yerel');
  assert.equal(o.kesici.yenidenDene(), false, 'durmuş anahtar yok: işaret düşürülmedi');
  assert.equal(o.kesici.iyiMi(iyi), true);
  o.kesici.belirsizKaydet(iyi, 'yerel');
  o.kesici.belirsizKaydet(iyi, 'yerel');
  assert.equal(o.kesici.dogrulanamadiMi(iyi), true);
  assert.equal(o.kesici.yenidenDene(), true);
  assert.equal(o.kesici.iyiMi(iyi), true);
  assert.equal(o.kesici.dogrulanamadiMi(iyi), false, 'TEK yeni hak');
  o.kesici.belirsizKaydet(iyi, 'yerel');
  assert.equal(o.kesici.dogrulanamadiMi(iyi), true);
});

test('(tur9-K16) geçerli anahtarın tipik akışı: aralarında başarı olan belirsizler bütçeyi şişirmez, ikinci onay gerekmez', () => {
  const o = kur();
  const p = o.kesici.parmakIzi('A'.repeat(30));
  o.kesici.dogrulandi(p);
  for (let i = 0; i < 30; i += 1) {
    o.kesici.belirsizKaydet(p, i % 2 ? 'dis' : 'yerel');
    assert.equal(o.kesici.dogrulanamadiMi(p), false);
    assert.ok(o.kesici.hataliDenemeSayisi() <= 1);
    if (i % 3 === 0) o.kesici.belirsizSifirla(p);
    else o.kesici.dogrulandi(p);
  }
  assert.equal(o.kesici.onayGerekliMi(p), null);
  assert.deepEqual(butce(o.kesici), { yerel: 0, dis: 0 });
});
