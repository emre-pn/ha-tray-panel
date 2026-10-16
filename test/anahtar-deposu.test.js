'use strict';

/**
 * hata-07: erişim anahtarı deposu. Sahte safeStorage ve bellek içi dosya sistemi kullanılır; gerçek anahtar
 * dosyasına (%APPDATA%) dokunulmaz. Testlerdeki anahtar sahte bir değerdir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { anahtarDeposuOlustur } = require('../src/lib/anahtar-deposu');

const ANAHTAR = 'TEST_ANAHTAR_000';
const YOL = 'D:/veri/anahtar.dat';
const ASENKRON = 'ASYNC:';
const SENKRON = 'SYNC:';
const ESKI = `${YOL}.eski`;

function sahteFs() {
  const dosyalar = new Map();
  return {
    dosyalar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync(y) {
      if (!dosyalar.has(y)) throw new Error('ENOENT');
      return Buffer.from(dosyalar.get(y));
    },
    writeFileSync: (y, v) => dosyalar.set(y, Buffer.from(v)),
    renameSync(e, y) {
      if (!dosyalar.has(e)) throw new Error('ENOENT');
      dosyalar.set(y, dosyalar.get(e));
      dosyalar.delete(e);
    },
    copyFileSync(e, y) {
      if (!dosyalar.has(e)) throw new Error('ENOENT');
      dosyalar.set(y, Buffer.from(dosyalar.get(e)));
    },
    rmSync: (y) => dosyalar.delete(y),
    mkdirSync() {},
  };
}

/** Eşzamanlı (SYNC:) ve asenkron (ASYNC:) biçimleri ayrı olan sahte safeStorage. */
function sahteSafe(ayar = {}) {
  const durum = {
    asenkronVar: true,
    senkronVar: true,
    yenidenSifrele: false,
    bozukSifreleme: false, // yeni şifrelenen veri geri çözülünce başka metin versin
    cozmeSayisi: 0,
    kapi: null, // asenkron çözmeyi geciktirmek için
    ...ayar,
  };
  const kodla = (oneki, metin) => Buffer.from(oneki + Buffer.from(metin).toString('base64'));
  const coz = (oneki, veri) => {
    const s = Buffer.from(veri).toString();
    if (!s.startsWith(oneki)) throw new Error('çözülemedi');
    return Buffer.from(s.slice(oneki.length), 'base64').toString();
  };
  const safe = {
    isAsyncEncryptionAvailable: async () => durum.asenkronVar,
    isEncryptionAvailable: () => durum.senkronVar,
    encryptStringAsync: async (metin) => kodla(ASENKRON, durum.bozukSifreleme ? 'BASKA_DEGER' : metin),
    decryptStringAsync: async (veri) => {
      durum.cozmeSayisi += 1;
      if (durum.kapi) await durum.kapi;
      return { shouldReEncrypt: durum.yenidenSifrele, result: coz(ASENKRON, veri) };
    },
    encryptString: (metin) => kodla(SENKRON, metin),
    decryptString: (veri) => coz(SENKRON, veri),
  };
  return { safe, durum, kodla };
}

function kur(safeAyar, baslangicDosyasi) {
  const fs = sahteFs();
  const s = sahteSafe(safeAyar);
  const gunlukler = [];
  if (baslangicDosyasi) fs.dosyalar.set(YOL, baslangicDosyasi(s.kodla));
  const depo = anahtarDeposuOlustur({ dosyaYolu: YOL, fs, safe: s.safe, gunluk: (m) => gunlukler.push(m) });
  return { fs, depo, durum: s.durum, kodla: s.kodla, gunlukler };
}

const bastan = (fs) => (fs.dosyalar.get(YOL) ? fs.dosyalar.get(YOL).toString() : null);

test('yaz -> anahtarAl gidiş-dönüş: asenkron biçimde saklanır, geçici dosya kalmaz', async () => {
  const { fs, depo } = kur();
  assert.equal(depo.varMi(), false);
  assert.equal(await depo.anahtarAl(), null);
  await depo.yaz(ANAHTAR);
  assert.equal(depo.varMi(), true);
  assert.ok(bastan(fs).startsWith(ASENKRON));
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
});

test('anahtar düz metin olarak dosyaya yazılmaz', async () => {
  const { fs, depo } = kur();
  await depo.yaz(ANAHTAR);
  assert.ok(!fs.dosyalar.get(YOL).toString().includes(ANAHTAR));
});

test('önbellek: ikinci okuma yeniden çözmez; aynı anda gelen okumalar tek okumayı paylaşır', async () => {
  const { depo, durum } = kur({}, (k) => k(ASENKRON, ANAHTAR));
  const [a, b, c] = await Promise.all([depo.anahtarAl(), depo.anahtarAl(), depo.anahtarAl()]);
  assert.deepEqual([a, b, c], [ANAHTAR, ANAHTAR, ANAHTAR]);
  assert.equal(durum.cozmeSayisi, 1);
  await depo.anahtarAl();
  assert.equal(durum.cozmeSayisi, 1);
});

test('eski (eşzamanlı) biçimde yazılmış dosya okunur ve yeni biçime DOĞRULAYARAK taşınır', async () => {
  const { fs, depo } = kur({}, (k) => k(SENKRON, ANAHTAR));
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.ok(bastan(fs).startsWith(ASENKRON), 'dosya yeni biçime geçmeli');
  assert.deepEqual([...fs.dosyalar.keys()].sort(), [YOL, ESKI], 'geçici dosya kalmamalı; göç öncesi yedek var');
  const ikinci = anahtarDeposuOlustur({
    dosyaYolu: YOL,
    fs,
    safe: sahteSafe().safe,
    gunluk: () => {},
  });
  assert.equal(await ikinci.anahtarAl(), ANAHTAR, 'taşınan dosya asenkron okunabilmeli');
});

test('shouldReEncrypt: anahtar yeniden şifrelenir', async () => {
  const { fs, depo } = kur({ yenidenSifrele: true }, (k) => k(ASENKRON, ANAHTAR));
  const once = bastan(fs);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.ok(bastan(fs).startsWith(ASENKRON));
  assert.ok(once.startsWith(ASENKRON));
  assert.deepEqual([...fs.dosyalar.keys()].sort(), [YOL, ESKI]);
  assert.equal(fs.dosyalar.get(ESKI).toString(), once, 'yedek özgün dosyanın kendisi');
});

test('göç doğrulaması başarısızsa özgün dosya KORUNUR, geçici dosya silinir, anahtar yine okunur', async () => {
  const { fs, depo, durum } = kur({}, (k) => k(SENKRON, ANAHTAR));
  durum.bozukSifreleme = true; // yeni şifrelenen veri geri çözülünce eşit çıkmaz
  const once = bastan(fs);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.equal(bastan(fs), once);
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
});

test('asenkron şifreleme yoksa eşzamanlıya düşülür (yaz ve oku)', async () => {
  const { fs, depo } = kur({ asenkronVar: false });
  await depo.yaz(ANAHTAR);
  assert.ok(bastan(fs).startsWith(SENKRON));
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.ok(bastan(fs).startsWith(SENKRON), 'asenkron yokken göç yapılmaz');
});

test('hiçbir şifreleme kullanılamıyorsa yaz hata verir ve dosya oluşmaz; kullanilabilirMi false', async () => {
  const { fs, depo } = kur({ asenkronVar: false, senkronVar: false });
  await assert.rejects(() => depo.yaz(ANAHTAR), /sifreleme-yok/);
  assert.equal(fs.dosyalar.size, 0);
  assert.equal(await depo.kullanilabilirMi(), false);
});

test('kullanilabilirMi: asenkron ya da eşzamanlıdan biri yeterli', async () => {
  assert.equal(await kur().depo.kullanilabilirMi(), true);
  assert.equal(await kur({ senkronVar: false }).depo.kullanilabilirMi(), true);
  assert.equal(await kur({ asenkronVar: false }).depo.kullanilabilirMi(), true);
});

test('yazma doğrulaması başarısızsa hata verilir, özgün dosya korunur, geçici dosya kalmaz', async () => {
  const { fs, depo, durum } = kur({}, (k) => k(ASENKRON, ANAHTAR));
  const once = bastan(fs);
  durum.bozukSifreleme = true;
  await assert.rejects(() => depo.yaz('TEST_BASKA_ANAHTAR_111'), /dogrulama-basarisiz/);
  assert.equal(bastan(fs), once);
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
});

test('çözülemeyen dosya: null döner, günlüğe anahtar içermeyen tek uyarı yazılır', async () => {
  const { depo, gunlukler } = kur({}, () => Buffer.from('ALAKASIZ-VERI'));
  assert.equal(await depo.anahtarAl(), null);
  assert.equal(await depo.anahtarAl(), null);
  assert.equal(gunlukler.length, 1);
  assert.match(gunlukler[0], /çözülemedi/);
});

test('sil: yerel dosya ve geçici dosyalar silinir, önbellek temizlenir, olmayan dosyada hata yok', async () => {
  const { fs, depo } = kur();
  await depo.yaz(ANAHTAR);
  fs.dosyalar.set(`${YOL}.tmp`, Buffer.from('x'));
  fs.dosyalar.set(`${YOL}.gocu.tmp`, Buffer.from('x'));
  assert.deepEqual(await depo.sil(), { silindi: true });
  assert.equal(fs.dosyalar.size, 0);
  assert.equal(depo.varMi(), false);
  assert.equal(await depo.anahtarAl(), null);
  assert.deepEqual(await depo.sil(), { silindi: true });
});

test('sil sonrası yaz: yeni anahtar okunur (eski önbellek kalmaz)', async () => {
  const { depo } = kur();
  await depo.yaz(ANAHTAR);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  await depo.sil();
  await depo.yaz('TEST_ANAHTAR_111');
  assert.equal(await depo.anahtarAl(), 'TEST_ANAHTAR_111');
});

test('dosya dışarıdan silinirse önbellek kullanılmaz', async () => {
  const { fs, depo } = kur();
  await depo.yaz(ANAHTAR);
  fs.dosyalar.delete(YOL);
  assert.equal(await depo.anahtarAl(), null);
});

test('süren bayat okuma, araya giren yaz ile ÖNBELLEĞİ ezemez', async () => {
  const { depo, durum, kodla, fs } = kur({}, (k) => k(ASENKRON, ANAHTAR));
  let ac;
  durum.kapi = new Promise((coz) => {
    ac = coz;
  });
  const bayat = depo.anahtarAl(); // eski anahtarı çözerken bekliyor
  durum.kapi = null;
  await depo.yaz('TEST_YENI_ANAHTAR_222');
  ac();
  assert.equal(await bayat, ANAHTAR); // bu çağrının kendi sonucu
  assert.equal(await depo.anahtarAl(), 'TEST_YENI_ANAHTAR_222');
  assert.equal(bastan(fs), kodla(ASENKRON, 'TEST_YENI_ANAHTAR_222').toString());
});

test('göç, araya giren yaz ile yeni anahtarı ESKİSİYLE ezmez', async () => {
  const { depo, durum, fs, kodla } = kur({}, (k) => k(SENKRON, ANAHTAR));
  let ac;
  const kapi = new Promise((coz) => {
    ac = coz;
  });
  // Göçün doğrulama adımındaki asenkron çözmeyi beklet.
  durum.kapi = kapi;
  const okuma = depo.anahtarAl();
  await new Promise((coz) => setImmediate(coz));
  durum.kapi = null;
  await depo.yaz('TEST_YENI_ANAHTAR_222');
  ac();
  await okuma;
  assert.equal(bastan(fs), kodla(ASENKRON, 'TEST_YENI_ANAHTAR_222').toString());
  assert.equal(await depo.anahtarAl(), 'TEST_YENI_ANAHTAR_222');
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
});

test('geçersiz anahtar yazılmaz', async () => {
  const { depo } = kur();
  for (const kotu of ['', null, undefined, 42]) await assert.rejects(() => depo.yaz(kotu), /gecersiz-anahtar/);
});

test('günlüğe anahtar hiç yazılmaz', async () => {
  const { depo, gunlukler } = kur({ asenkronVar: false });
  await depo.yaz(ANAHTAR);
  await depo.anahtarAl();
  await depo.sil();
  assert.ok(gunlukler.every((m) => !m.includes(ANAHTAR)));
});

// --- göç öncesi yedek (Dalga 2 denetimi) -----------------------------------------------------------------

test('göç öncesi özgün dosya .eski olarak yedeklenir; yedek özgün baytlardır', async () => {
  const { fs, depo, kodla } = kur({}, (k) => k(SENKRON, ANAHTAR));
  const once = bastan(fs);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.ok(bastan(fs).startsWith(ASENKRON));
  assert.equal(fs.dosyalar.get(ESKI).toString(), once);
  assert.equal(fs.dosyalar.get(ESKI).toString(), kodla(SENKRON, ANAHTAR).toString());
  // Aynı süreçte yeniden okuma yedeği silmez (başka bir açılışta doğrulanmadı).
  await depo.anahtarAl();
  assert.ok(fs.dosyalar.has(ESKI));
});

test('yedek alınamazsa göç YAPILMAZ: özgün dosya olduğu gibi kalır, anahtar yine okunur', async () => {
  const { fs, depo } = kur({}, (k) => k(SENKRON, ANAHTAR));
  const once = bastan(fs);
  fs.copyFileSync = () => {
    throw new Error('ENOSPC');
  };
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.equal(bastan(fs), once);
  assert.deepEqual([...fs.dosyalar.keys()], [YOL], 'geçici dosya da yedek de kalmaz');
});

test('yeni biçim BAŞKA bir açılışta sorunsuz okununca yedek silinir', async () => {
  const { fs, depo } = kur({}, (k) => k(SENKRON, ANAHTAR));
  await depo.anahtarAl(); // birinci açılış: göç + yedek
  assert.ok(fs.dosyalar.has(ESKI));
  const ikinciAcilis = anahtarDeposuOlustur({ dosyaYolu: YOL, fs, safe: sahteSafe().safe, gunluk: () => {} });
  assert.equal(await ikinciAcilis.anahtarAl(), ANAHTAR);
  assert.equal(fs.dosyalar.has(ESKI), false, 'yeni biçim doğrulandı: yedek gider');
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
});

test('yeni biçim sonraki açılışta ÇÖZÜLEMEZSE anahtar yedekten okunur, yedek silinmez, günlüğe anahtarsız not düşer', async () => {
  const { fs, depo, gunlukler } = kur({}, (k) => k(SENKRON, ANAHTAR));
  await depo.anahtarAl(); // göç: ana dosya ASYNC, yedek SYNC
  // Sonraki açılış: asenkron API yok, eşzamanlı API yeni biçimi çözemez.
  const ikinci = kur({ asenkronVar: false });
  ikinci.fs.dosyalar.set(YOL, fs.dosyalar.get(YOL));
  ikinci.fs.dosyalar.set(ESKI, fs.dosyalar.get(ESKI));
  assert.equal(await ikinci.depo.anahtarAl(), ANAHTAR);
  assert.ok(ikinci.fs.dosyalar.has(ESKI), 'ana dosya hâlâ çözülemiyor: yedek korunur');
  assert.equal(ikinci.gunlukler.length, 1);
  assert.match(ikinci.gunlukler[0], /yedekten okundu/);
  assert.ok([...ikinci.gunlukler, ...gunlukler].every((m) => !m.includes(ANAHTAR)));
});

test('ana dosya da yedek de çözülemezse null döner ve eski "çözülemedi" notu yazılır', async () => {
  const { fs, depo, gunlukler } = kur({}, () => Buffer.from('ALAKASIZ-VERI'));
  fs.dosyalar.set(ESKI, Buffer.from('BASKA-ALAKASIZ-VERI'));
  assert.equal(await depo.anahtarAl(), null);
  assert.equal(gunlukler.length, 1);
  assert.match(gunlukler[0], /çözülemedi/);
});

test('yaz yedeği siler: eski anahtarın yedeği yeni anahtarın yerine geçemez', async () => {
  const { fs, depo } = kur({}, (k) => k(SENKRON, ANAHTAR));
  await depo.anahtarAl();
  assert.ok(fs.dosyalar.has(ESKI));
  await depo.yaz('TEST_YENI_ANAHTAR_222');
  assert.equal(fs.dosyalar.has(ESKI), false);
  assert.equal(await depo.anahtarAl(), 'TEST_YENI_ANAHTAR_222');
});

test('sil yedeği de siler', async () => {
  const { fs, depo } = kur({}, (k) => k(SENKRON, ANAHTAR));
  await depo.anahtarAl();
  assert.ok(fs.dosyalar.has(ESKI));
  await depo.sil();
  assert.equal(fs.dosyalar.size, 0);
});

test('karantinayaAl (tur 2): anahtar dosyası ".reddedildi" adıyla kenara alınır (yeniden adlandırma), anahtar yok sayılır; yeni anahtar ya da sil kenardaki dosyayı kaldırır', async () => {
  const { fs, depo } = kur();
  assert.equal(depo.karantinayaAl(), false, 'dosya yok');
  await depo.yaz(ANAHTAR);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
  assert.equal(depo.karantinadaMi(), false);
  assert.equal(depo.karantinayaAl(), true);
  assert.equal(depo.varMi(), false);
  assert.equal(depo.karantinadaMi(), true);
  assert.ok(fs.dosyalar.has(`${YOL}.reddedildi`));
  assert.equal(await depo.anahtarAl(), null, 'önbellek de temizlendi: yeniden başlatmada da anahtar yok');
  await depo.yaz(`${ANAHTAR}-yeni`);
  assert.equal(depo.karantinadaMi(), false, 'yeni anahtar kaydedilince eski karantina silinir');
  assert.equal(await depo.anahtarAl(), `${ANAHTAR}-yeni`);
  depo.karantinayaAl();
  await depo.sil();
  assert.equal(depo.karantinadaMi(), false, '"Anahtarı sil" kenardaki dosyayı da siler');
});

test('h-38: aynı anda iki kayıt sıraya alınır: ikisi de başarılı, bellek ve disk son yazılan anahtarda, geçici dosya kalmaz', async () => {
  const { depo, durum, fs, kodla } = kur();
  let ac;
  durum.kapi = new Promise((coz) => {
    ac = coz;
  });
  const a = depo.yaz('TEST_ANAHTAR_A_111'); // doğrulama adımında bekliyor
  const b = depo.yaz('TEST_ANAHTAR_B_222');
  await new Promise((coz) => setImmediate(coz));
  assert.equal(fs.dosyalar.has(`${YOL}.tmp`), true);
  assert.equal(Buffer.from(fs.dosyalar.get(`${YOL}.tmp`)).toString(), kodla(ASENKRON, 'TEST_ANAHTAR_A_111').toString(), 'ikinci kayıt ilkinin geçici dosyasını ezmedi');
  durum.kapi = null;
  ac();
  await Promise.all([a, b]);
  assert.equal(bastan(fs), kodla(ASENKRON, 'TEST_ANAHTAR_B_222').toString());
  assert.equal(await depo.anahtarAl(), 'TEST_ANAHTAR_B_222', 'bellek de diskle aynı');
  assert.deepEqual([...fs.dosyalar.keys()], [YOL]);
});

test('h-38: süren kayıt sırasında "Anahtarı sil" beklenir: silinen anahtar geri gelmez; hatalı kayıt sırayı kilitlemez', async () => {
  const { depo, durum, fs } = kur();
  let ac;
  durum.kapi = new Promise((coz) => {
    ac = coz;
  });
  const y = depo.yaz(ANAHTAR);
  const s = depo.sil();
  await new Promise((coz) => setImmediate(coz));
  durum.kapi = null;
  ac();
  await y;
  assert.deepEqual(await s, { silindi: true });
  assert.equal(depo.varMi(), false);
  assert.equal(await depo.anahtarAl(), null);
  assert.deepEqual([...fs.dosyalar.keys()], []);
  await assert.rejects(() => depo.yaz(''), /gecersiz-anahtar/);
  await depo.yaz(ANAHTAR);
  assert.equal(await depo.anahtarAl(), ANAHTAR, 'önceki hata sırayı kilitlemedi');
});

test('karantinayaAl (tur 2): yeniden adlandırma başarısızsa false döner ve anahtar yerinde kalır', async () => {
  const { fs, depo } = kur();
  await depo.yaz(ANAHTAR);
  fs.renameSync = () => {
    throw new Error('EPERM');
  };
  assert.equal(depo.karantinayaAl(), false);
  assert.equal(depo.varMi(), true);
  assert.equal(await depo.anahtarAl(), ANAHTAR);
});
