'use strict';

/**
 * src/lib/sertifika-deposu.js (o-56): güvenilen kök CA'lar ve ana bilgisayara bağlı parmak izleri; dosya sertifika-guveni.json.
 * Gerçek geçici klasör kullanılır (userData'ya dokunulmaz); sertifikalar bellekte üretilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sertifikaDeposuOlustur } = require('../src/lib/sertifika-deposu');
const { kokBilgisi } = require('../src/lib/sertifika');
const { sertifikaUret } = require('./sertifika-uret');

const HEX_A = 'a1'.repeat(32);
const HEX_B = 'b2'.repeat(32);

function geciciKlasor() {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-sert-'));
  return { klasor, yol: path.join(klasor, 'sertifika-guveni.json'), temizle: () => fs.rmSync(klasor, { recursive: true, force: true }) };
}

const kokUret = (cn) => {
  const s = sertifikaUret({ cn, ca: true });
  return kokBilgisi(s.pem);
};

async function depoAc(yol, ek = {}) {
  const gunluk = [];
  const depo = sertifikaDeposuOlustur({ dosyaYolu: yol, fs, gunluk: (m) => gunluk.push(m), ...ek });
  await depo.yukle();
  return { depo, gunluk };
}

test('dosya yokken boş açılır; kök ve sabitleme kalıcı yazılır, yeni örnek aynı veriyi okur', async () => {
  const g = geciciKlasor();
  try {
    const { depo, gunluk } = await depoAc(g.yol);
    assert.equal(depo.hazirMi(), true);
    assert.equal(depo.bos(), true);
    assert.deepEqual(gunluk, [], 'dosya olmaması hata değil');

    const k1 = kokUret('Kok Bir');
    assert.deepEqual(await depo.kokEkle([k1]), { ok: true, eklenen: 1 });
    assert.deepEqual(await depo.kokEkle([k1]), { ok: true, eklenen: 0 }, 'aynı kök iki kez eklenmez');
    assert.deepEqual(await depo.sabitle('HA.Example.com', HEX_A), { ok: true });
    assert.equal(depo.bos(), false);

    const yeni = (await depoAc(g.yol)).depo;
    assert.deepEqual(yeni.kokler().map((k) => k.parmak), [k1.parmak]);
    assert.deepEqual(yeni.sabitler().map((s) => [s.anaBilgisayar, s.parmak]), [['ha.example.com', HEX_A]]);
    assert.equal(yeni.sabitBul('ha.example.com').parmak, HEX_A);
    assert.equal(yeni.sabitBul('baska'), null);
    assert.equal(fs.existsSync(`${g.yol}.tmp`), false, 'geçici dosya kalmaz');
  } finally {
    g.temizle();
  }
});

test('sabitleme aynı ana bilgisayarda öncekinin yerine geçer; sil ve olmayanı silme; sınırlar', async () => {
  const g = geciciKlasor();
  try {
    const { depo } = await depoAc(g.yol);
    await depo.sabitle('a.test', HEX_A);
    await depo.sabitle('a.test', HEX_B);
    assert.deepEqual(depo.sabitler().map((s) => s.parmak), [HEX_B]);
    assert.deepEqual(await depo.sabitSil('a.test'), { ok: true });
    assert.deepEqual(await depo.sabitSil('a.test'), { ok: false, neden: 'yok' });

    assert.deepEqual(await depo.sabitle('', HEX_A), { ok: false, neden: 'ad-gecersiz' });
    assert.deepEqual(await depo.sabitle('a b', HEX_A), { ok: false, neden: 'ad-gecersiz' });
    assert.deepEqual(await depo.sabitle('a.test', 'kisa'), { ok: false, neden: 'parmak-gecersiz' });
    assert.deepEqual(await depo.sabitle('a.test', HEX_A.toUpperCase()), { ok: false, neden: 'parmak-gecersiz' }, 'kayıt biçimi küçük harfli 64 hane');
    for (let i = 0; i < 4; i += 1) assert.equal((await depo.sabitle(`h${i}.test`, HEX_A)).ok, true);
    assert.deepEqual(await depo.sabitle('h5.test', HEX_A), { ok: false, neden: 'cok-fazla' });
    assert.equal(depo.sabitler().length, 4, 'sınır aşımı kaydı değiştirmez');

    for (let i = 0; i < 4; i += 1) assert.equal((await depo.kokEkle([kokUret(`K${i}`)])).ok, true);
    assert.deepEqual(await depo.kokEkle([kokUret('K9')]), { ok: false, neden: 'cok-fazla' });
    assert.equal(depo.kokler().length, 4);
    const ilk = depo.kokler()[0].parmak;
    assert.deepEqual(await depo.kokSil(ilk), { ok: true });
    assert.deepEqual(await depo.kokSil(ilk), { ok: false, neden: 'yok' });
  } finally {
    g.temizle();
  }
});

test('özet PEM içermez; kokPemleri güvenilen kökleri verir', async () => {
  const g = geciciKlasor();
  try {
    const { depo } = await depoAc(g.yol);
    const k = kokUret('Ev Kok');
    await depo.kokEkle([k]);
    await depo.sabitle('a.test', HEX_A);
    const ozet = depo.ozet();
    assert.equal(JSON.stringify(ozet).includes('BEGIN CERTIFICATE'), false);
    assert.deepEqual(ozet.ca.map((c) => [c.parmak, c.ad]), [[k.parmak, 'Ev Kok']]);
    assert.deepEqual(ozet.sabit.map((s) => [s.anaBilgisayar, s.parmak]), [['a.test', HEX_A]]);
    assert.equal(depo.kokPemleri().length, 1);
    assert.match(depo.kokPemleri()[0], /BEGIN CERTIFICATE/);
  } finally {
    g.temizle();
  }
});

test('yükleme dosyayı yeniden doğrular: bozuk JSON boş sayılır; sahte/CA olmayan/süresi dolmuş kök ve geçersiz parmak izi atılır', async () => {
  const g = geciciKlasor();
  try {
    fs.writeFileSync(g.yol, '{bozuk', 'utf8');
    const bozuk = await depoAc(g.yol);
    assert.equal(bozuk.depo.bos(), true);
    assert.equal(bozuk.gunluk.length, 1, 'okunamayan dosya günlüğe düşer');
    assert.equal(fs.readFileSync(`${g.yol}.bozuk`, 'utf8'), '{bozuk', 'bozuk içerik .bozuk adıyla kenara alındı');

    const iyi = kokUret('Iyi Kok');
    const caOlmayan = sertifikaUret({ cn: 'Yaprak', san: ['x.test'] });
    const dolmus = sertifikaUret({ cn: 'Eski', ca: true, baslangic: new Date(Date.now() - 800 * 86400000), bitis: new Date(Date.now() - 86400000) });
    fs.writeFileSync(g.yol, JSON.stringify({
      surum: 1,
      ca: [
        { parmak: 'ff'.repeat(32), ad: 'Elle yazilmis parmak izi', pem: iyi.pem }, // parmak izi dosyadan DEĞİL PEM'den hesaplanır
        { parmak: 'x', ad: 'bozuk', pem: 'bozuk pem' },
        { parmak: 'y', ad: 'ca degil', pem: caOlmayan.pem },
        { parmak: 'z', ad: 'suresi dolmus', pem: dolmus.pem },
        null,
        { ad: 'pem yok' },
      ],
      sabit: [
        { anaBilgisayar: 'ha.test', parmak: HEX_A },
        { anaBilgisayar: 'ha.test', parmak: HEX_B }, // yinelenen ana bilgisayar atılır
        { anaBilgisayar: 'kotu parmak.test', parmak: 'abc' },
        { anaBilgisayar: 'buyuk.test', parmak: HEX_A.toUpperCase() },
        { anaBilgisayar: 'a b', parmak: HEX_A },
      ],
    }), 'utf8');
    const { depo } = await depoAc(g.yol);
    assert.deepEqual(depo.kokler().map((k) => k.parmak), [iyi.parmak], 'yalnız geçerli kök kalır, parmak izi PEM\'den yeniden hesaplanır');
    assert.deepEqual(depo.sabitler().map((s) => [s.anaBilgisayar, s.parmak]), [['ha.test', HEX_A]]);
  } finally {
    g.temizle();
  }
});

test('yazma başarısız olursa bellekteki değişiklik geri alınır ve dinleyici çağrılmaz', async () => {
  const g = geciciKlasor();
  try {
    const sahteFs = {
      readFileSync: fs.readFileSync,
      promises: {
        mkdir: fs.promises.mkdir,
        rm: fs.promises.rm,
        rename: fs.promises.rename,
        writeFile: async () => {
          throw new Error('disk dolu');
        },
      },
    };
    const gunluk = [];
    const depo = sertifikaDeposuOlustur({ dosyaYolu: g.yol, fs: sahteFs, gunluk: (m) => gunluk.push(m) });
    await depo.yukle();
    let bildirim = 0;
    depo.degistiDinle(() => {
      bildirim += 1;
    });
    const once = bildirim;
    assert.deepEqual(await depo.sabitle('a.test', HEX_A), { ok: false, neden: 'yazilamadi' });
    assert.equal(depo.sabitler().length, 0);
    assert.deepEqual(await depo.kokEkle([kokUret('K')]), { ok: false, neden: 'yazilamadi' });
    assert.equal(depo.kokler().length, 0);
    assert.equal(bildirim, once);
    assert.equal(gunluk.length, 2);
    assert.equal(gunluk.some((m) => /[0-9a-f]{16}/.test(m)), false, 'günlükte parmak izi yok');
  } finally {
    g.temizle();
  }
});

test('dinleyici yükleme ve her değişiklikte çağrılır; dinleyici hatası kaydı bozmaz; yazmalar sıralıdır', async () => {
  const g = geciciKlasor();
  try {
    const depo = sertifikaDeposuOlustur({ dosyaYolu: g.yol, fs, gunluk: () => {} });
    const olaylar = [];
    depo.degistiDinle(() => {
      olaylar.push(depo.hazirMi());
      throw new Error('dinleyici patladi');
    });
    assert.equal(depo.hazirMi(), false);
    await depo.yukle();
    assert.deepEqual(olaylar, [true]);
    await Promise.all([depo.sabitle('a.test', HEX_A), depo.sabitle('b.test', HEX_B), depo.sabitle('c.test', HEX_A)]);
    assert.equal(olaylar.length, 4);
    const dosya = JSON.parse(fs.readFileSync(g.yol, 'utf8'));
    assert.deepEqual(dosya.sabit.map((s) => s.anaBilgisayar).sort(), ['a.test', 'b.test', 'c.test']);
    assert.equal(dosya.surum, 1);
  } finally {
    g.temizle();
  }
});

/** readFileSync'i ilk `basarisiz` çağrıda `kod` hatasıyla düşüren, yazmaları kaydeden gerçek-dosya sarmalayıcısı. */
function geciciOkumaHataliFs({ basarisiz = 1, kod = 'EBUSY' } = {}) {
  let okuma = 0;
  const yazilanlar = [];
  return {
    yazilanlar,
    okumaSayisi: () => okuma,
    fs: {
      readFileSync: (...a) => {
        okuma += 1;
        if (okuma <= basarisiz) throw Object.assign(new Error(`${kod}: resource busy or locked`), { code: kod });
        return fs.readFileSync(...a);
      },
      writeFileSync: fs.writeFileSync,
      promises: {
        mkdir: fs.promises.mkdir,
        rm: fs.promises.rm,
        rename: fs.promises.rename,
        writeFile: async (...a) => {
          yazilanlar.push(a[0]);
          return fs.promises.writeFile(...a);
        },
      },
    },
  };
}

test('B45: dosya okunamazsa (EBUSY) kayıt boş yüklenir ama dosyanın üzerine YAZILMAZ: hâlâ okunamıyorsa yazilamadi, okunabiliyorsa eski kayıtlar korunarak yazılır', async () => {
  const g = geciciKlasor();
  try {
    fs.writeFileSync(g.yol, JSON.stringify({ surum: 1, ca: [], sabit: [{ anaBilgisayar: 'ha.ornek.com', parmak: HEX_A }] }), 'utf8');
    const once = fs.readFileSync(g.yol, 'utf8');

    // 1) kilit sürüyor: açılışta ve ilk değişiklikte okunamıyor
    const kilitli = geciciOkumaHataliFs({ basarisiz: 2 });
    const gunluk = [];
    const depo = sertifikaDeposuOlustur({ dosyaYolu: g.yol, fs: kilitli.fs, gunluk: (m) => gunluk.push(m) });
    await depo.yukle();
    assert.equal(depo.bos(), true);
    assert.deepEqual(await depo.sabitle('baska.ornek.com', HEX_B), { ok: false, neden: 'yazilamadi' });
    assert.deepEqual(kilitli.yazilanlar, [], 'okunamayan dosyanın üzerine yazılmadı');
    assert.equal(fs.readFileSync(g.yol, 'utf8'), once, 'diskteki sabitleme duruyor');
    assert.equal(fs.existsSync(`${g.yol}.bozuk`), false, 'okuma hatası bozuk dosya sayılmaz');

    // 2) kilit kalktı: dosya yeniden okunur, eski sabitleme korunur
    assert.deepEqual(await depo.sabitle('baska.ornek.com', HEX_B), { ok: true });
    assert.deepEqual(depo.sabitler().map((x) => x.anaBilgisayar).sort(), ['baska.ornek.com', 'ha.ornek.com']);
    const sonra = JSON.parse(fs.readFileSync(g.yol, 'utf8'));
    assert.deepEqual(sonra.sabit.map((x) => x.anaBilgisayar).sort(), ['baska.ornek.com', 'ha.ornek.com'], 'eski sabitleme ezilmedi');
  } finally {
    g.temizle();
  }
});

test('B46: başarısız yazmanın geri alması, kuyrukta sonra gelen başarılı işlemin bellek durumunu ezmez; bellek ve disk aynı kalır', async () => {
  const g = geciciKlasor();
  try {
    let yazma = 0;
    const sahteFs = {
      readFileSync: fs.readFileSync,
      promises: {
        mkdir: fs.promises.mkdir,
        rm: fs.promises.rm,
        rename: fs.promises.rename,
        writeFile: async (...a) => {
          yazma += 1;
          if (yazma === 1) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
          return fs.promises.writeFile(...a);
        },
      },
    };
    const depo = sertifikaDeposuOlustur({ dosyaYolu: g.yol, fs: sahteFs, gunluk: () => {} });
    await depo.yukle();
    let bildirim = 0;
    depo.degistiDinle(() => {
      bildirim += 1;
    });
    const [a, b] = await Promise.all([depo.sabitle('a.test', HEX_A), depo.sabitle('b.test', HEX_B)]);
    assert.deepEqual(a, { ok: false, neden: 'yazilamadi' });
    assert.deepEqual(b, { ok: true });
    assert.deepEqual(depo.sabitler().map((x) => x.anaBilgisayar), ['b.test'], 'bellek yalnız başarılı işlemi içerir');
    const disk = JSON.parse(fs.readFileSync(g.yol, 'utf8'));
    assert.deepEqual(disk.sabit.map((x) => x.anaBilgisayar), ['b.test'], 'disk bellekle aynı');
    assert.equal(bildirim, 1, 'dinleyici yalnız başarılı işlem için çağrıldı');
  } finally {
    g.temizle();
  }
});
