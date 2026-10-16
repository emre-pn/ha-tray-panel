'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sonKullanilanlarOlustur, kayitlariDuzelt, kimlikGecerliMi, EN_COK_KAYIT } = require('../src/lib/son-kullanilanlar');

function sahteFs(baslangic = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  const yazimlar = [];
  return {
    dosyalar,
    yazimlar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => {
      if (!dosyalar.has(y)) throw new Error('yok');
      return dosyalar.get(y);
    },
    mkdirSync: () => {},
    writeFileSync: (y, v) => {
      yazimlar.push(y);
      dosyalar.set(y, v);
    },
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
  };
}
function sahteZaman() {
  const bekleyen = new Map();
  let n = 0;
  return {
    setTimeout: (fn) => {
      n += 1;
      bekleyen.set(n, fn);
      return n;
    },
    clearTimeout: (id) => bekleyen.delete(id),
    atesle: () => {
      for (const [id, fn] of [...bekleyen]) {
        bekleyen.delete(id);
        fn();
      }
    },
    bekleyen: () => bekleyen.size,
  };
}
const YOL = 'C:\\veri\\son-kullanilanlar.json';

test('ekle: en öne alır, tekrarı siler, en çok 50 kayıt; güvensiz/geçersiz kimlik eklenmez', () => {
  const s = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs: sahteFs(), zaman: sahteZaman() });
  assert.equal(s.ekle('light.a'), true);
  assert.equal(s.ekle('scene.film'), true);
  assert.equal(s.ekle('light.a'), true);
  assert.deepEqual(s.en(), ['light.a', 'scene.film']);
  for (let i = 0; i < 70; i += 1) s.ekle(`switch.priz_${i}`);
  assert.equal(s.sayi(), EN_COK_KAYIT);
  assert.equal(s.en(1)[0], 'switch.priz_69');
  assert.equal(s.sonBes().length, 5);
  for (const kotu of ['lock.on_kapi', 'switch.kapi_isigi', 'cover.garaj', 'KÖTÜ', '', null, 5, 'alarm_control_panel.ev', 'light.garaj_isigi']) {
    assert.equal(s.ekle(kotu), false, String(kotu));
  }
  assert.ok(!s.en().some((k) => /kapi|lock|garaj|alarm/.test(k)));
});

test('yazma: gecikmeli ve atomik (önce .tmp, sonra yeniden adlandırma); bosalt hemen yazar; kirli değilse yazmaz', () => {
  const fs = sahteFs();
  const zaman = sahteZaman();
  const s = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs, zaman, simdi: () => 42 });
  s.ekle('light.a');
  s.ekle('light.b');
  assert.equal(fs.yazimlar.length, 0, 'gecikmeli');
  assert.equal(zaman.bekleyen(), 1, 'tek zamanlayıcı');
  zaman.atesle();
  assert.deepEqual(fs.yazimlar, [`${YOL}.tmp`]);
  assert.ok(fs.dosyalar.has(YOL) && !fs.dosyalar.has(`${YOL}.tmp`));
  const icerik = JSON.parse(fs.dosyalar.get(YOL));
  assert.deepEqual(icerik.kayitlar.map((k) => k.kimlik), ['light.b', 'light.a']);
  assert.equal(icerik.kayitlar[0].zaman, 42);
  s.bosalt();
  assert.equal(fs.yazimlar.length, 1, 'kirli değil: yazılmaz');
  s.ekle('light.c');
  s.bosalt();
  assert.equal(fs.yazimlar.length, 2);
});

test('yukle: kayıtlı listeyi okur; bozuk dosya, bozuk kayıt, yinelenen ve güvensiz kimlik temizlenir', () => {
  const ham = JSON.stringify({
    surum: 1,
    kayitlar: [
      { kimlik: 'light.a', zaman: 5 },
      { kimlik: 'lock.on_kapi', zaman: 4 },
      { kimlik: 'light.a', zaman: 3 },
      { kimlik: 5 },
      null,
      { kimlik: 'scene.film' },
    ],
  });
  const s = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs: sahteFs({ [YOL]: ham }), zaman: sahteZaman() });
  assert.equal(s.yukle(), 2);
  assert.deepEqual(s.en(), ['light.a', 'scene.film']);
  const bozuk = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs: sahteFs({ [YOL]: '{bozuk' }), zaman: sahteZaman(), gunluk: () => {} });
  assert.equal(bozuk.yukle(), 0);
  const yok = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs: sahteFs(), zaman: sahteZaman() });
  assert.equal(yok.yukle(), 0);
  assert.deepEqual(kayitlariDuzelt(null), []);
  assert.deepEqual(kayitlariDuzelt({ kayitlar: 'x' }), []);
});

test('buda: favori olmayanlar silinir; temizle hepsini; yazma hatası günlüğe yalnız sabit metin', () => {
  const fs = sahteFs();
  const gunlukler = [];
  const s = sonKullanilanlarOlustur({ dosyaYolu: YOL, fs, zaman: sahteZaman(), gunluk: (m) => gunlukler.push(m) });
  s.ekle('light.a');
  s.ekle('light.b');
  s.buda(new Set(['light.b']));
  assert.deepEqual(s.en(), ['light.b']);
  s.temizle();
  assert.equal(s.sayi(), 0);
  fs.writeFileSync = () => {
    throw new Error('C:\\gizli\\yol disk dolu');
  };
  s.ekle('light.z');
  assert.equal(s.bosalt(), false);
  assert.ok(gunlukler.length === 1 && !gunlukler[0].includes('gizli'));
});

test('kimlikGecerliMi: kapı/kilit/alarm kimlikleri geçersiz', () => {
  assert.equal(kimlikGecerliMi('light.salon'), true);
  assert.equal(kimlikGecerliMi('switch.kapi_priz'), false);
  assert.equal(kimlikGecerliMi('lock.x'), false);
  assert.equal(kimlikGecerliMi('sensor.x'), false);
});
