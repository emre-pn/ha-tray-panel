'use strict';

/**
 * Uygulama içi güncelleme (o-51): src/lib/guncelleme.js. electron-updater, ağ ve saat sahtedir; gerçek istek gitmez, hiçbir şey kurulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  HAZIRLAMA_BASLIGI,
  KURULUM_BEKLEME_MS,
  destekDurumu,
  dosyaAdiGecerliMi,
  bilgiyiDogrula,
  dosyaSha512,
  ozetlerEsitMi,
  hataSinifla,
  guncellemeYoneticisiOlustur,
} = require('../src/lib/guncelleme');
const { DENETIM_ARALIGI_MS, ELLE_ARALIK_MS } = require('../src/lib/surum-denetimi');

const T0 = 1_800_000_000_000;
const ICERIK = 'kurucu-icerigi';
const SHA = crypto.createHash('sha512').update(ICERIK).digest('base64');
const SHA_DIGER = crypto.createHash('sha512').update('baska').digest('base64');
const AD = 'Ev-Paneli-Kurulum-1.5.0.exe';
const BILGI = (ek = {}) => ({
  version: '1.5.0',
  files: [{ url: AD, sha512: SHA, size: ICERIK.length }],
  path: AD,
  sha512: SHA,
  releaseDate: '2026-10-01T00:00:00.000Z',
  ...ek,
});

test('sabitler: sha512 örneği 88 karakter (86 + "=="); gizli bilgi taşımayan sabit başlık', () => {
  assert.match(SHA, /^[A-Za-z0-9+/]{86}==$/);
  assert.equal(HAZIRLAMA_BASLIGI['x-user-staging-id'], 'yok');
  assert.doesNotMatch(JSON.stringify(HAZIRLAMA_BASLIGI), /\d+\.\d+\.\d+|Bearer|token/i);
});

test('destekDurumu: yalnız kurulu (paketli, taşınabilir olmayan) Windows sürümü desteklenir', () => {
  assert.equal(destekDurumu({ paketli: true, tasinabilir: false, platform: 'win32' }), 'tamam');
  assert.equal(destekDurumu({ paketli: true, tasinabilir: true, platform: 'win32' }), 'tasinabilir');
  assert.equal(destekDurumu({ paketli: false, tasinabilir: false, platform: 'win32' }), 'paketsiz');
  assert.equal(destekDurumu({ paketli: true, tasinabilir: false, platform: 'linux' }), 'platform');
});

test('dosyaAdiGecerliMi: düz .exe adı; adres, dizin, üst dizin ve alternatif akış reddedilir', () => {
  assert.equal(dosyaAdiGecerliMi(AD), true);
  assert.equal(dosyaAdiGecerliMi('Ev Paneli Kurulum 1.5.0.EXE'), true);
  for (const kotu of ['', 'a.msi', '../a.exe', 'a/b.exe', 'a\\b.exe', 'C:a.exe', 'https://evil.example/a.exe', 'a.exe:zone', ' a.exe', 'a.exe ', '.exe..exe', 'x'.repeat(130) + '.exe', null, 5, undefined, 'a\0.exe']) {
    assert.equal(dosyaAdiGecerliMi(kotu), false, String(kotu));
  }
});

test('bilgiyiDogrula: geçerli bilgi kabul edilir; sürüm "v" önekini atar; ilk dosya kurucudur', () => {
  const s = bilgiyiDogrula(BILGI({ version: 'v1.5.0' }), { mevcutSurum: '1.4.0' });
  assert.deepEqual(s, { ok: true, surum: '1.5.0', onSurum: false, dosyaAdi: AD, sha512: SHA, boyut: ICERIK.length });
});

test('bilgiyiDogrula: sha512 yoksa/bozuksa REDDEDİLİR (electron-updater yokluğunda denetimi atlar)', () => {
  const dene = (dosya) => bilgiyiDogrula(BILGI({ files: [dosya] }), { mevcutSurum: '1.4.0' });
  assert.deepEqual(dene({ url: AD, size: 10 }), { ok: false, neden: 'ozet' });
  assert.deepEqual(dene({ url: AD, size: 10, sha512: '' }), { ok: false, neden: 'ozet' });
  assert.deepEqual(dene({ url: AD, size: 10, sha512: SHA.slice(0, 80) }), { ok: false, neden: 'ozet' });
  assert.deepEqual(dene({ url: AD, size: 10, sha512: crypto.createHash('sha512').update('x').digest('hex') }), { ok: false, neden: 'ozet' }, 'onaltılık gösterim kabul edilmez');
  assert.deepEqual(dene({ url: AD, size: 10, sha512: 5 }), { ok: false, neden: 'ozet' });
  assert.deepEqual(bilgiyiDogrula(BILGI({ sha512: 'kisa' }), { mevcutSurum: '1.4.0' }), { ok: false, neden: 'ozet' }, 'üst düzey sha512 de biçimli olmalı');
});

test('bilgiyiDogrula: dosya adı/boyut/sayı kısıtları', () => {
  const dene = (ek) => bilgiyiDogrula(BILGI(ek), { mevcutSurum: '1.4.0' });
  assert.deepEqual(dene({ files: [{ url: 'https://evil.example/a.exe', sha512: SHA, size: 10 }] }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ files: [{ url: '../a.exe', sha512: SHA, size: 10 }] }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ files: [{ url: 'a.zip', sha512: SHA, size: 10 }] }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ files: [] }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ files: undefined }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ files: Array.from({ length: 9 }, () => ({ url: AD, sha512: SHA, size: 10 })) }), { ok: false, neden: 'dosya' });
  assert.deepEqual(dene({ path: 'baska.exe' }), { ok: false, neden: 'dosya' }, 'path, files içinde olmalı');
  for (const boyut of [0, -1, 1.5, '10', 400 * 1024 * 1024 + 1, Number.NaN, undefined]) {
    assert.deepEqual(dene({ files: [{ url: AD, sha512: SHA, size: boyut }] }), { ok: false, neden: 'boyut' }, String(boyut));
  }
  assert.deepEqual(dene({ files: ['a.exe'] }), { ok: false, neden: 'bicim' });
  for (const kotu of [null, [], 'metin', 5]) assert.deepEqual(bilgiyiDogrula(kotu, { mevcutSurum: '1.4.0' }), { ok: false, neden: 'bicim' });
});

test('bilgiyiDogrula: yalnız ileri gider (eşit/eski/bozuk sürüm reddedilir); ön sürüm yalnız seçenek açıkken', () => {
  const dene = (version, secenek = {}) => bilgiyiDogrula(BILGI({ version }), { mevcutSurum: '1.4.0', ...secenek });
  assert.equal(dene('1.4.0').neden, 'eski');
  assert.equal(dene('1.3.9').neden, 'eski');
  assert.equal(dene('1.4.0-beta.1').neden, 'on-surum');
  assert.equal(dene('1.4.0-beta.1', { onSurumler: true }).neden, 'eski', '1.4.0-beta.1 < 1.4.0');
  assert.equal(dene('x.y').neden, 'surum');
  assert.equal(dene(undefined).neden, 'surum');
  assert.equal(dene('1.5.0-beta.1').neden, 'on-surum');
  const on = dene('1.5.0-beta.1', { onSurumler: true });
  assert.equal(on.ok, true);
  assert.equal(on.onSurum, true);
  assert.equal(on.surum, '1.5.0-beta.1');
  assert.equal(bilgiyiDogrula(BILGI({ version: '1.5.0' }), { mevcutSurum: '1.5.0-beta.2' }).ok, true, 'ön sürümden kararlıya geçilir');
  assert.equal(bilgiyiDogrula(BILGI({ version: '1.5.0-beta.3' }), { mevcutSurum: '1.5.0-beta.2', onSurumler: true }).ok, true);
  assert.equal(bilgiyiDogrula(BILGI({ version: '1.5.0-beta.10' }), { mevcutSurum: '1.5.0-beta.9', onSurumler: true }).ok, true, 'sayısal ön ek parçası sayısal karşılaştırılır');
});

test('ozetlerEsitMi / dosyaSha512: gerçek dosyada sha512 ve boyut doğru hesaplanır', async () => {
  assert.equal(ozetlerEsitMi(SHA, SHA), true);
  assert.equal(ozetlerEsitMi(SHA, SHA_DIGER), false);
  assert.equal(ozetlerEsitMi(SHA, 'kisa'), false);
  assert.equal(ozetlerEsitMi(undefined, SHA), false);
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-gunc-'));
  try {
    const yol = path.join(klasor, AD);
    fs.writeFileSync(yol, ICERIK);
    assert.deepEqual(await dosyaSha512(yol), { sha512: SHA, boyut: ICERIK.length });
    await assert.rejects(() => dosyaSha512(path.join(klasor, 'yok.exe')));
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
  }
});

test('hataSinifla: yalnız sınıf döner; ileti/adres/yol dışarı sızmaz', () => {
  assert.equal(hataSinifla(Object.assign(new Error('sha512 checksum mismatch, expected X, got Y'), { code: 'ERR_CHECKSUM_MISMATCH' })), 'ozet');
  assert.equal(hataSinifla(Object.assign(new Error('x'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })), 'dosya-yok');
  assert.equal(hataSinifla(Object.assign(new Error('HTTP 404'), { statusCode: 404 })), 'dosya-yok');
  assert.equal(hataSinifla(Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), {})), 'ag');
  assert.equal(hataSinifla(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), 'ag');
  assert.equal(hataSinifla(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), 'zaman');
  assert.equal(hataSinifla(Object.assign(new Error('x'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })), 'imza');
  assert.equal(hataSinifla(Object.assign(new Error('x'), { code: 'ERR_UPDATER_NO_CHECKSUM' })), 'butunluk');
  assert.equal(hataSinifla(new Error('C:\\Users\\biri\\gizli https://x.example/y')), 'bilinmiyor');
  assert.equal(hataSinifla(null), 'bilinmiyor');
});

// ---------------------------------------------------------------------------
// Yönetici (durum makinesi)
// ---------------------------------------------------------------------------

/** Sahte electron-updater: olay yayar, çağrıları kaydeder. */
function sahteGuncelleyici({ kontrol, indirme } = {}) {
  const g = new EventEmitter();
  g.cagrilar = [];
  g.checkForUpdates = async () => {
    g.cagrilar.push('checkForUpdates');
    return typeof kontrol === 'function' ? kontrol(g) : kontrol;
  };
  g.downloadUpdate = async () => {
    g.cagrilar.push('downloadUpdate');
    if (typeof indirme === 'function') return indirme(g);
    g.emit('download-progress', { percent: 40.7 });
    g.emit('download-progress', { percent: 100 });
    g.emit('update-downloaded', { ...BILGI(), downloadedFile: path.join('C:', 'onbellek', AD) });
    return [path.join('C:', 'onbellek', AD)];
  };
  g.quitAndInstall = (...arg) => g.cagrilar.push(['quitAndInstall', ...arg]);
  return g;
}

function kur({ acik = true, onSurumler = false, destek = 'tamam', mevcut = '1.4.0', kayitli = null, kontrol, indirme, ozet, kurulumHatasi = false } = {}) {
  const ortam = { saat: T0, olaylar: [], gunlukler: [], yazilan: [], kayit: kayitli, hazirlik: 0, birakma: 0, zamanlayicilar: [], ozetCagrilari: [] };
  const dis = { acik, onSurumler, destek };
  const g = sahteGuncelleyici({
    kontrol: kontrol ?? (async () => ({ isUpdateAvailable: true, updateInfo: BILGI() })),
    indirme,
  });
  if (kurulumHatasi) g.quitAndInstall = () => { throw new Error('kurulamadı'); };
  const yonetici = guncellemeYoneticisiOlustur({
    guncelleyiciAl: () => g,
    acikMi: () => dis.acik,
    onSurumlerMi: () => dis.onSurumler,
    destekMi: () => dis.destek,
    mevcutSurum: mevcut,
    depo: { oku: () => ortam.kayit, yaz: (d) => { ortam.kayit = JSON.parse(JSON.stringify(d)); ortam.yazilan.push(ortam.kayit); } },
    dosyaOzeti: async (yol) => {
      ortam.ozetCagrilari.push(yol);
      return ozet ? ozet() : { sha512: SHA, boyut: ICERIK.length };
    },
    kurulumaHazirlan: () => { ortam.hazirlik += 1; },
    kurulumuBirak: () => { ortam.birakma += 1; },
    zamanlayici: (fn, ms) => { ortam.zamanlayicilar.push({ fn, ms }); return {}; },
    simdi: () => ortam.saat,
    gunluk: (m) => ortam.gunlukler.push(m),
    degisti: (d) => ortam.olaylar.push(d),
  });
  return { ortam, dis, g, yonetici };
}

test('KAPALI iken hiçbir şey olmaz: güncelleyici hiç yüklenmez/çağrılmaz (denetim, indirme, kurma); depoya yazılmaz', async () => {
  let yuklendi = 0;
  const g = sahteGuncelleyici();
  const yonetici = guncellemeYoneticisiOlustur({
    guncelleyiciAl: () => { yuklendi += 1; return g; },
    acikMi: () => false,
    destekMi: () => 'tamam',
    mevcutSurum: '1.4.0',
    depo: { oku: () => null, yaz: () => assert.fail('yazılmamalı') },
  });
  assert.deepEqual(await yonetici.denetle(), { sonuc: 'kapali' });
  assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'kapali' });
  assert.deepEqual(await yonetici.indir(), { sonuc: 'kapali' });
  assert.deepEqual(await yonetici.kur(), { sonuc: 'kapali' });
  assert.equal(yuklendi, 0);
  assert.deepEqual(g.cagrilar, []);
  assert.equal(yonetici.durum().acik, false);
});

test('desteklenmeyen ortamda (taşınabilir/paketsiz) güncelleyici hiç çağrılmaz', async () => {
  for (const destek of ['tasinabilir', 'paketsiz', 'platform']) {
    const { g, yonetici } = kur({ destek });
    assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'desteklenmiyor', neden: destek });
    assert.deepEqual(await yonetici.indir(), { sonuc: 'desteklenmiyor', neden: destek });
    assert.deepEqual(await yonetici.kur(), { sonuc: 'desteklenmiyor', neden: destek });
    assert.deepEqual(g.cagrilar, []);
    assert.equal(yonetici.durum().destek, destek);
  }
});

test('güncelleyici güvenli kurulur: otomatik indirme/çıkışta kurma/eski sürüme dönüş/farklı kurucu kapalı; kimlik başlığı sabit', async () => {
  const { g, yonetici, dis } = kur({ onSurumler: true });
  g.allowDowngrade = true; // electron-updater allowPrerelease açınca bunu açar: yönetici geri kapatmalı
  g.autoDownload = true;
  g.autoInstallOnAppQuit = true;
  await yonetici.denetle({ elle: true });
  assert.equal(g.autoDownload, false);
  assert.equal(g.autoInstallOnAppQuit, false);
  assert.equal(g.allowPrerelease, true);
  assert.equal(g.allowDowngrade, false);
  assert.equal(g.disableDifferentialDownload, true);
  assert.equal(g.disableWebInstaller, true);
  assert.equal(g.forceDevUpdateConfig, false);
  assert.equal(g.logger, null);
  assert.deepEqual(g.requestHeaders, HAZIRLAMA_BASLIGI);
  // ayar kapanınca bir sonraki denetimde allowPrerelease de kapanır
  dis.onSurumler = false;
  await yonetici.denetle({ elle: true }).catch(() => {});
  assert.equal(g.allowPrerelease, true, 'elle denetim dakikada bir: ikinci çağrı güncelleyiciye varmadı');
  const ikinci = kur({ onSurumler: false });
  await ikinci.yonetici.denetle({ elle: true });
  assert.equal(ikinci.g.allowPrerelease, false);
  assert.equal(ikinci.g.allowDowngrade, false);
});

test('denetle -> yeni: bilgi doğrulanır, durum yeni olur, bildirim yalnız bir kez gerekir; görünümde adres/yol/ham hata yok', async () => {
  const { ortam, yonetici } = kur();
  const s = await yonetici.denetle({ elle: true });
  assert.deepEqual(s, { sonuc: 'yeni', surum: '1.5.0', onSurum: false, boyut: ICERIK.length, bildirimGerek: true });
  const d = yonetici.durum();
  assert.equal(d.durum, 'yeni');
  assert.equal(d.surum, '1.5.0');
  assert.equal(d.boyut, ICERIK.length);
  assert.equal(d.sonDenetim, T0);
  assert.doesNotMatch(JSON.stringify(d), /http|C:|onbellek|\.exe|sha512|\\\\/i);
  assert.equal(ortam.kayit.sonSurum, '1.5.0');
  yonetici.bildirildi('1.5.0');
  ortam.saat += 2 * ELLE_ARALIK_MS;
  const ikinci = await yonetici.denetle({ elle: true });
  assert.equal(ikinci.bildirimGerek, false, 'aynı sürüm için bildirim bir kez');
});

test('denetle -> güncel: durum bosta, kayıtlı "yeni sürüm" bilgisi silinir', async () => {
  const { ortam, yonetici } = kur({ kayitli: { sonDenetim: 0, sonSurum: '1.5.0', bildirilen: null }, kontrol: async () => ({ isUpdateAvailable: false, updateInfo: BILGI({ version: '1.4.0' }) }) });
  assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'guncel' });
  assert.equal(yonetici.durum().durum, 'bosta');
  assert.equal(ortam.kayit.sonSurum, null);
});

test('doğrulamayı geçmeyen bilgi (sha512 yok / eski sürüm / dış adres) "hata: butunluk" olur ve indirilemez', async () => {
  for (const kotuBilgi of [
    BILGI({ files: [{ url: AD, size: 10 }] }),
    BILGI({ version: '1.4.0' }),
    BILGI({ files: [{ url: 'https://evil.example/' + AD, sha512: SHA, size: 10 }] }),
    BILGI({ version: '9.9.9-beta.1' }),
  ]) {
    const { g, yonetici } = kur({ kontrol: async () => ({ isUpdateAvailable: true, updateInfo: kotuBilgi }) });
    assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'hata', neden: 'butunluk' });
    assert.equal(yonetici.durum().durum, 'bosta');
    assert.equal(yonetici.durum().hata, 'butunluk');
    assert.deepEqual(await yonetici.indir(), { sonuc: 'gecersiz' });
    assert.ok(!g.cagrilar.includes('downloadUpdate'), 'doğrulanmamış bilgi indirilmez');
  }
});

test('günde en çok bir otomatik denetim; elle denetim dakikada bir; sürerken ikinci çağrı aynı denetimi paylaşır', async () => {
  const { ortam, g, yonetici } = kur({ kontrol: async () => ({ isUpdateAvailable: false }) });
  const a = yonetici.denetle();
  const b = yonetici.denetle();
  assert.equal(a, b);
  assert.equal((await a).sonuc, 'guncel');
  assert.equal(g.cagrilar.filter((x) => x === 'checkForUpdates').length, 1);
  ortam.saat += DENETIM_ARALIGI_MS - 1;
  assert.deepEqual(await yonetici.denetle(), { sonuc: 'erken' });
  assert.equal((await yonetici.denetle({ elle: true })).sonuc, 'guncel');
  assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'cok-sik' });
  ortam.saat += ELLE_ARALIK_MS;
  assert.equal((await yonetici.denetle({ elle: true })).sonuc, 'guncel');
  ortam.saat += DENETIM_ARALIGI_MS;
  assert.equal((await yonetici.denetle()).sonuc, 'guncel');
});

test('denetim hatası: durum geri alınır, neden sınıflandırılır, günlüğe ham ileti/adres girmez; deneme yine sayılır', async () => {
  const { ortam, yonetici } = kur({ kontrol: async () => { throw Object.assign(new Error('GET https://github.com/x -> C:\\gizli'), { code: 'ENOTFOUND' }); } });
  assert.deepEqual(await yonetici.denetle(), { sonuc: 'hata', neden: 'ag' });
  assert.equal(yonetici.durum().durum, 'bosta');
  assert.equal(yonetici.durum().hata, 'ag');
  assert.doesNotMatch(ortam.gunlukler.join('\n'), /github|gizli|https/);
  assert.deepEqual(await yonetici.denetle(), { sonuc: 'erken' }, 'başarısız deneme de günlük sınırı sayar');
  const bos = kur({ kontrol: async () => null });
  assert.deepEqual(await bos.yonetici.denetle({ elle: true }), { sonuc: 'hata', neden: 'etkin-degil' });
});

test('indir: yalnız doğrulanmış "yeni" durumundan; ilerleme tamsayı yüzdeyle yayılır; dosya sha512/boyut/ad ile doğrulanınca "indirildi"', async () => {
  const { ortam, g, yonetici } = kur();
  assert.deepEqual(await yonetici.indir(), { sonuc: 'gecersiz' }, 'önce denetim gerekir');
  await yonetici.denetle({ elle: true });
  const s = await yonetici.indir();
  assert.deepEqual(s, { sonuc: 'indirildi', surum: '1.5.0' });
  assert.deepEqual(g.cagrilar.filter((x) => x === 'downloadUpdate'), ['downloadUpdate']);
  const yuzdeler = ortam.olaylar.filter((o) => o.durum === 'indiriliyor').map((o) => o.ilerleme);
  assert.deepEqual([...new Set(yuzdeler)], [0, 40, 100]);
  assert.equal(yonetici.durum().durum, 'indirildi');
  assert.equal(yonetici.durum().ilerleme, 100);
  assert.equal(ortam.ozetCagrilari.length, 1);
  assert.deepEqual(await yonetici.indir(), { sonuc: 'indirildi', surum: '1.5.0' }, 'ikinci çağrı yeniden indirmez');
  assert.equal(g.cagrilar.filter((x) => x === 'downloadUpdate').length, 1);
});

test('indirilen dosya doğrulanamazsa (özet/boyut/ad uyuşmaz, okunamaz) "indirildi" OLMAZ ve kurulamaz', async () => {
  const durumlar = [
    { ad: 'özet', ozet: () => ({ sha512: SHA_DIGER, boyut: ICERIK.length }) },
    { ad: 'boyut', ozet: () => ({ sha512: SHA, boyut: ICERIK.length + 1 }) },
    { ad: 'okunamaz', ozet: () => { throw new Error('EBUSY'); } },
  ];
  for (const d of durumlar) {
    const { g, yonetici } = kur({ ozet: d.ozet });
    await yonetici.denetle({ elle: true });
    assert.deepEqual(await yonetici.indir(), { sonuc: 'hata', neden: 'ozet' }, d.ad);
    assert.equal(yonetici.durum().durum, 'yeni', 'indirme yeniden denenebilir');
    assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' });
    assert.ok(!g.cagrilar.some((c) => Array.isArray(c) && c[0] === 'quitAndInstall'));
  }
  const yanlisAd = kur({ indirme: async (g) => { g.emit('update-downloaded', { downloadedFile: path.join('C:', 'onbellek', 'baska.exe') }); return []; } });
  await yanlisAd.yonetici.denetle({ elle: true });
  assert.deepEqual(await yanlisAd.yonetici.indir(), { sonuc: 'hata', neden: 'ozet' }, 'beklenen kurucu adı değil');
  const yolsuz = kur({ indirme: async () => [] });
  await yolsuz.yonetici.denetle({ elle: true });
  assert.deepEqual(await yolsuz.yonetici.indir(), { sonuc: 'hata', neden: 'indirme' });
});

test('indirme hatası: ağ/sha512 uyuşmazlığı sınıflanır, durum "yeni"ye döner, yeniden denenebilir', async () => {
  let deneme = 0;
  const { yonetici } = kur({ indirme: async () => { deneme += 1; throw Object.assign(new Error('sha512 checksum mismatch, expected A, got B'), { code: 'ERR_CHECKSUM_MISMATCH' }); } });
  await yonetici.denetle({ elle: true });
  assert.deepEqual(await yonetici.indir(), { sonuc: 'hata', neden: 'ozet' });
  assert.equal(yonetici.durum().durum, 'yeni');
  assert.deepEqual(await yonetici.indir(), { sonuc: 'hata', neden: 'ozet' });
  assert.equal(deneme, 2);
});

test('kur: yalnız "indirildi" durumunda; dosya KURMADAN hemen önce yeniden doğrulanır; quitAndInstall(sessiz, yeniden aç)', async () => {
  const { ortam, g, yonetici } = kur();
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' });
  await yonetici.denetle({ elle: true });
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' }, 'indirmeden kurulmaz');
  await yonetici.indir();
  assert.equal(ortam.ozetCagrilari.length, 1);
  const s = await yonetici.kur();
  assert.deepEqual(s, { sonuc: 'kuruluyor', surum: '1.5.0' });
  assert.equal(ortam.ozetCagrilari.length, 2, 'kurmadan önce ikinci doğrulama');
  assert.deepEqual(g.cagrilar.filter((c) => Array.isArray(c)), [['quitAndInstall', true, true]]);
  assert.equal(ortam.hazirlik, 1);
  assert.equal(yonetici.durum().durum, 'kuruluyor');
  assert.equal(ortam.zamanlayicilar.length, 1);
  assert.equal(ortam.zamanlayicilar[0].ms, KURULUM_BEKLEME_MS);
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' }, 'kurulum sürerken ikinci çağrı yok sayılır');
});

test('kur: indirme ile kurma arasında dosya değişirse kurulmaz', async () => {
  let cagri = 0;
  const { g, ortam, yonetici } = kur({ ozet: () => (++cagri === 1 ? { sha512: SHA, boyut: ICERIK.length } : { sha512: SHA_DIGER, boyut: ICERIK.length }) });
  await yonetici.denetle({ elle: true });
  await yonetici.indir();
  assert.deepEqual(await yonetici.kur(), { sonuc: 'hata', neden: 'ozet' });
  assert.ok(!g.cagrilar.some((c) => Array.isArray(c)));
  assert.equal(ortam.hazirlik, 0, 'çıkış bayrağı kurulmadı');
  assert.equal(yonetici.durum().durum, 'yeni');
});

test('kur: quitAndInstall hata verirse bayrak geri alınır; sessizce başarısız olursa zaman aşımı durumu geri alır', async () => {
  const hatali = kur({ kurulumHatasi: true });
  await hatali.yonetici.denetle({ elle: true });
  await hatali.yonetici.indir();
  assert.deepEqual(await hatali.yonetici.kur(), { sonuc: 'hata', neden: 'kurulum' });
  assert.equal(hatali.ortam.birakma, 1);
  assert.equal(hatali.yonetici.durum().durum, 'indirildi', 'yeniden denenebilir');

  const sessiz = kur();
  await sessiz.yonetici.denetle({ elle: true });
  await sessiz.yonetici.indir();
  await sessiz.yonetici.kur();
  sessiz.ortam.zamanlayicilar[0].fn();
  assert.equal(sessiz.ortam.birakma, 1);
  assert.equal(sessiz.yonetici.durum().durum, 'indirildi');
  assert.equal(sessiz.yonetici.durum().hata, 'kurulum');
});

test('seçenek indirmeden sonra kapanırsa kurulmaz; kapandi() sürüm bilgisini atar (indirme/kurulum sürerken dokunmaz)', async () => {
  const { dis, g, yonetici } = kur();
  await yonetici.denetle({ elle: true });
  await yonetici.indir();
  dis.acik = false;
  assert.deepEqual(await yonetici.kur(), { sonuc: 'kapali' });
  assert.ok(!g.cagrilar.some((c) => Array.isArray(c)));
  yonetici.kapandi();
  assert.equal(yonetici.durum().durum, 'bosta');
  assert.equal(yonetici.durum().surum, null);
  dis.acik = true;
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' });
});

test('indirme sürerken denetim "mesgul", indirildikten sonra ağa çıkmadan "indirildi" döner', async () => {
  let bitir;
  const bekle = new Promise((r) => { bitir = r; });
  const { g, ortam, yonetici } = kur({ indirme: async (gg) => { await bekle; gg.emit('update-downloaded', { downloadedFile: path.join('C:', 'onbellek', AD) }); return []; } });
  await yonetici.denetle({ elle: true });
  const indiriyor = yonetici.indir();
  assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'mesgul' });
  assert.equal(yonetici.durum().durum, 'indiriliyor');
  bitir();
  assert.equal((await indiriyor).sonuc, 'indirildi');
  const onceki = g.cagrilar.length;
  ortam.saat += 5 * DENETIM_ARALIGI_MS;
  assert.deepEqual(await yonetici.denetle({ elle: true }), { sonuc: 'indirildi', surum: '1.5.0' });
  assert.equal(g.cagrilar.length, onceki, 'yeni istek yok');
});

test('ön sürüm: seçenek açıkken ön sürüm önerilir ve işaretlenir; kapalıyken (güncelleyici yanlışlıkla verse bile) reddedilir', async () => {
  const onBilgi = BILGI({ version: '1.5.0-beta.1', files: [{ url: 'Ev-Paneli-Kurulum-1.5.0-beta.1.exe', sha512: SHA, size: ICERIK.length }], path: 'Ev-Paneli-Kurulum-1.5.0-beta.1.exe' });
  const acik = kur({ onSurumler: true, kontrol: async () => ({ isUpdateAvailable: true, updateInfo: onBilgi }) });
  const s = await acik.yonetici.denetle({ elle: true });
  assert.equal(s.sonuc, 'yeni');
  assert.equal(s.onSurum, true);
  assert.equal(acik.yonetici.durum().onSurum, true);
  const kapali = kur({ onSurumler: false, kontrol: async () => ({ isUpdateAvailable: true, updateInfo: onBilgi }) });
  assert.deepEqual(await kapali.yonetici.denetle({ elle: true }), { sonuc: 'hata', neden: 'butunluk' });
});

test('güncelleyicinin "error" olayı dinlenir: dinleyicisiz EventEmitter fırlatırdı (quitAndInstall sonrası söz zincirinde işlenmemiş reddedilme); günlüğe yalnız sınıf yazılır', async () => {
  const { g, ortam, yonetici } = kur();
  await yonetici.denetle({ elle: true });
  assert.ok(g.listenerCount('error') >= 1, 'error dinleyicisi var');
  assert.doesNotThrow(() => g.emit('error', Object.assign(new Error('GET https://github.com/gizli -> C:\gizli'), { code: 'ENOTFOUND' }), 'yığın izi'));
  assert.doesNotThrow(() => g.emit('error', 'metin hata'));
  assert.ok(ortam.gunlukler.some((m) => /Güncelleyici hata bildirdi \(ag\)/.test(m)));
  assert.doesNotMatch(ortam.gunlukler.join('\n'), /github|gizli|https|yığın/);
  assert.equal(yonetici.durum().durum, 'yeni', 'olay tek başına durumu bozmaz');
});

test('indirme sürerken ayar kapanırsa sonuç "indirildi" olmaz: bilgi/dosya atılır, yeniden açılsa da kurulamaz', async () => {
  let bitir;
  const bekle = new Promise((r) => { bitir = r; });
  const { dis, g, ortam, yonetici } = kur({ indirme: async (gg) => { await bekle; gg.emit('update-downloaded', { downloadedFile: path.join('C:', 'onbellek', AD) }); return []; } });
  await yonetici.denetle({ elle: true });
  const indiriyor = yonetici.indir();
  dis.acik = false;
  yonetici.kapandi(); // main.js ayar kapanınca çağırır; indiriliyor durumunda etkisizdir
  assert.equal(yonetici.durum().durum, 'indiriliyor');
  bitir();
  assert.deepEqual(await indiriyor, { sonuc: 'kapali' });
  assert.equal(yonetici.durum().durum, 'bosta');
  assert.equal(yonetici.durum().surum, null);
  assert.ok(!ortam.olaylar.some((o) => o.durum === 'indirildi'));
  assert.deepEqual(await yonetici.kur(), { sonuc: 'kapali' });
  dis.acik = true;
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' });
  assert.ok(!g.cagrilar.some((c) => Array.isArray(c)));
});

test('indirme sürerken ön sürüm izni kalkarsa inen ön sürüm "indirildi" olmaz ve kurulmaz; kararlı sürümü etkilemez', async () => {
  const onAd = 'Ev-Paneli-Kurulum-1.5.0-beta.1.exe';
  const onBilgi = BILGI({ version: '1.5.0-beta.1', files: [{ url: onAd, sha512: SHA, size: ICERIK.length }], path: onAd });
  let bitir;
  const bekle = new Promise((r) => { bitir = r; });
  const { dis, g, yonetici } = kur({
    onSurumler: true,
    kontrol: async () => ({ isUpdateAvailable: true, updateInfo: onBilgi }),
    indirme: async (gg) => { await bekle; gg.emit('update-downloaded', { downloadedFile: path.join('C:', 'onbellek', onAd) }); return []; },
  });
  await yonetici.denetle({ elle: true });
  const indiriyor = yonetici.indir();
  dis.onSurumler = false;
  yonetici.kapandi(); // indiriliyor durumunda etkisiz
  bitir();
  assert.deepEqual(await indiriyor, { sonuc: 'gecersiz' });
  assert.equal(yonetici.durum().durum, 'bosta');
  assert.equal(yonetici.durum().onSurum, false);
  assert.deepEqual(await yonetici.kur(), { sonuc: 'gecersiz' });
  assert.ok(!g.cagrilar.some((c) => Array.isArray(c)));
  // kararlı sürüm: ön sürüm izni kapalıyken de normal biter
  const kararli = kur({ onSurumler: false });
  await kararli.yonetici.denetle({ elle: true });
  assert.equal((await kararli.yonetici.indir()).sonuc, 'indirildi');
});

test('kur: inmiş ön sürümün izni sonradan kalkarsa (kapandi çağrılmasa bile) kurulmaz; doğrulama sürerken ayar kapanırsa quitAndInstall çağrılmaz', async () => {
  const onAd = 'Ev-Paneli-Kurulum-1.5.0-beta.1.exe';
  const onBilgi = BILGI({ version: '1.5.0-beta.1', files: [{ url: onAd, sha512: SHA, size: ICERIK.length }], path: onAd });
  const bilgisi = { onSurumler: true, kontrol: async () => ({ isUpdateAvailable: true, updateInfo: onBilgi }), indirme: async (gg) => { gg.emit('update-downloaded', { downloadedFile: path.join('C:', 'onbellek', onAd) }); return []; } };
  const a = kur(bilgisi);
  await a.yonetici.denetle({ elle: true });
  assert.equal((await a.yonetici.indir()).sonuc, 'indirildi');
  a.dis.onSurumler = false;
  assert.deepEqual(await a.yonetici.kur(), { sonuc: 'gecersiz' });
  assert.equal(a.ortam.hazirlik, 0, 'çıkış bayrağı kurulmadı');
  assert.ok(!a.g.cagrilar.some((c) => Array.isArray(c)));
  assert.equal(a.yonetici.durum().durum, 'bosta');

  let ozetCagri = 0;
  const b = kur({ ozet: () => { if (++ozetCagri === 2) b.dis.acik = false; return { sha512: SHA, boyut: ICERIK.length }; } }); // 2. doğrulama = kurmadan önceki
  await b.yonetici.denetle({ elle: true });
  assert.equal((await b.yonetici.indir()).sonuc, 'indirildi');
  assert.deepEqual(await b.yonetici.kur(), { sonuc: 'kapali' });
  assert.equal(b.ortam.hazirlik, 0);
  assert.ok(!b.g.cagrilar.some((c) => Array.isArray(c)));
  assert.equal(b.yonetici.durum().durum, 'bosta');
  assert.equal(b.ortam.zamanlayicilar.length, 0, 'kurulum zaman aşımı kurulmadı');
});

test('modül kaynağı: ağ/electron yok; yalnız node: yerlilerini ve ./ modüllerini kullanır; güncelleyici kapatma ayarları sabit', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'guncelleme.js'), 'utf8');
  for (const e of kaynak.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) assert.ok(e[1].startsWith('node:') || e[1].startsWith('./'), e[1]);
  assert.doesNotMatch(kaynak, /(?<![\w.])fetch\s*\(|require\(\s*['"](?:node:)?(?:https?|net|tls|dns|dgram|child_process)['"]\s*\)/);
  assert.match(kaynak, /g\.autoDownload = false/);
  assert.match(kaynak, /g\.autoInstallOnAppQuit = false/);
  assert.match(kaynak, /g\.allowDowngrade = false/);
  assert.match(kaynak, /quitAndInstall\(true, true\)/);
});
