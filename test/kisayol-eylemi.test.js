'use strict';

// o-13: favori kaydındaki `kisayolEylemi` (kısayola basınca kesin yön): kayıt, birleştirme, yükleme ve dışa/içe aktarma.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { favorileriDuzelt, favorileriBirlestir } = require('../src/lib/favoriler');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));

const guvenli = (...cift) => new Map(cift);
const hepsi = (...k) => new Set(k);

test('yükleme: geçerli kisayolEylemi korunur; kısayolsuz, geçersiz ya da yanlış alandaki atılır', () => {
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'light.led', ad: 'LED', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' },
    { entity_id: 'light.ampul', ad: 'Ampul', kisayol: 'Control+Alt+2', kisayolEylemi: 'ac' },
    { entity_id: 'light.salon', ad: 'Salon', kisayol: 'Control+Alt+3', kisayolEylemi: 'parlak+10' }, // parlaklık kontrolü yok
    { entity_id: 'light.mutfak', ad: 'Mutfak', parlaklik: true, kisayolEylemi: 'ac' }, // kısayol yok
    { entity_id: 'fan.vantilator', ad: 'Vantilatör', kisayol: 'Control+Alt+4', kisayolEylemi: 'hiz-20' },
    { entity_id: 'fan.salon', ad: 'Salon fan', kisayol: 'Control+Alt+5', kisayolEylemi: 'parlak+10' }, // yanlış alan
    { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Control+Alt+6', kisayolEylemi: 'toggle' }, // listede yok
    { entity_id: 'scene.film', ad: 'Film', kisayol: 'Control+Alt+7', kisayolEylemi: 'ac' }, // sahnede yön yok
  ]);
  const eylemi = Object.fromEntries(favoriler.map((f) => [f.entity_id, f.kisayolEylemi]));
  assert.deepEqual(eylemi, {
    'light.led': 'parlak+10',
    'light.ampul': 'ac',
    'light.salon': undefined,
    'light.mutfak': undefined,
    'fan.vantilator': 'hiz-20',
    'fan.salon': undefined,
    'switch.priz': undefined,
    'scene.film': undefined,
  });
});

test('yükleme: kisayolEylemi metin dışı değerlerde atılır (nesne, sayı, dizi)', () => {
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'light.a', ad: 'A', kisayol: 'Control+Alt+1', kisayolEylemi: { tur: 'ac' } },
    { entity_id: 'light.b', ad: 'B', kisayol: 'Control+Alt+2', kisayolEylemi: 5 },
    { entity_id: 'light.c', ad: 'C', kisayol: 'Control+Alt+3', kisayolEylemi: ['ac'] },
    { entity_id: 'light.d', ad: 'D', kisayol: 'Control+Alt+4', kisayolEylemi: '' },
  ]);
  assert.ok(favoriler.every((f) => !('kisayolEylemi' in f)));
});

test('kayıt: yükte gelen kisayolEylemi saklanır; yükte yoksa mevcut kayıttan korunur; "" temizler', () => {
  const mevcut = [{ entity_id: 'light.led', ad: 'LED', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' }];
  const kur = (oge) => favorileriBirlestir({ mevcut, secilen: [oge], guvenliListe: guvenli(['light.led', 'LED']), tumKimlikler: hepsi('light.led') });

  assert.equal(kur({ entity_id: 'light.led' }).yeni[0].kisayolEylemi, 'parlak+10', 'yükte yok: mevcut korunur');
  assert.equal(kur({ entity_id: 'light.led', kisayolEylemi: 'parlak-20' }).yeni[0].kisayolEylemi, 'parlak-20');
  assert.equal(kur({ entity_id: 'light.led', kisayolEylemi: 'kapat' }).yeni[0].kisayolEylemi, 'kapat');
  const temiz = kur({ entity_id: 'light.led', kisayolEylemi: '' });
  assert.equal('kisayolEylemi' in temiz.yeni[0], false, '"" aç-kapa\'ya döner');
  assert.equal(temiz.eylemHatalari, undefined, 'temizleme hata değildir');
  // Kısayol kaldırılınca eylemi de gider.
  const kisayolsuz = kur({ entity_id: 'light.led', kisayol: '' });
  assert.equal('kisayol' in kisayolsuz.yeni[0], false);
  assert.equal('kisayolEylemi' in kisayolsuz.yeni[0], false);
});

test('kayıt: geçersiz eylem atılır ve eylemHatalari ile bildirilir; favori ve kısayol yine kaydedilir', () => {
  const mevcut = [{ entity_id: 'light.led', ad: 'LED', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak+10' }];
  const sonuc = favorileriBirlestir({
    mevcut,
    secilen: [
      { entity_id: 'light.led', parlaklik: false }, // parlaklık kapatıldı: parlak+10 geçersiz
      { entity_id: 'light.ampul', kisayol: 'Control+Alt+2', kisayolEylemi: 'parlak+10' },
      { entity_id: 'switch.priz', kisayol: 'Control+Alt+3', kisayolEylemi: 'hiz+10' },
      { entity_id: 'fan.vantilator', kisayol: 'Control+Alt+4', kisayolEylemi: 'hiz+10' },
    ],
    guvenliListe: guvenli(['light.led', 'LED'], ['light.ampul', 'Ampul'], ['switch.priz', 'Priz'], ['fan.vantilator', 'Vantilatör']),
    tumKimlikler: hepsi('light.led', 'light.ampul', 'switch.priz', 'fan.vantilator'),
  });
  assert.deepEqual(sonuc.eylemHatalari, [
    { entity_id: 'light.led', neden: 'gecersiz' },
    { entity_id: 'light.ampul', neden: 'gecersiz' },
    { entity_id: 'switch.priz', neden: 'gecersiz' },
  ]);
  const harita = Object.fromEntries(sonuc.yeni.map((f) => [f.entity_id, f]));
  assert.equal(harita['light.led'].kisayol, 'Control+Alt+1');
  assert.equal(harita['light.led'].kisayolEylemi, undefined);
  assert.equal(harita['light.ampul'].kisayol, 'Control+Alt+2');
  assert.equal(harita['switch.priz'].kisayol, 'Control+Alt+3');
  assert.equal(harita['fan.vantilator'].kisayolEylemi, 'hiz+10');
  assert.deepEqual(sonuc.kisayolHatalari, []);
});

test('kayıt: kısayol sınırı aşılınca (en çok 5) kısayol da eylemi de atılır', () => {
  const secilen = Array.from({ length: 6 }, (_, i) => ({ entity_id: `light.l${i}`, kisayol: `Control+Alt+${i + 1}`, kisayolEylemi: 'ac' }));
  const sonuc = favorileriBirlestir({
    mevcut: [],
    secilen,
    guvenliListe: guvenli(...secilen.map((s) => [s.entity_id, s.entity_id])),
    tumKimlikler: hepsi(...secilen.map((s) => s.entity_id)),
  });
  const sonu = sonuc.yeni.at(-1);
  assert.equal('kisayol' in sonu, false);
  assert.equal('kisayolEylemi' in sonu, false);
  assert.deepEqual(sonuc.kisayolHatalari, [{ entity_id: 'light.l5', neden: 'sinir' }]);
  assert.equal(sonuc.yeni.filter((f) => f.kisayolEylemi === 'ac').length, 5);
});

test('kapı kuralı: kilit/kapı varlığına kisayolEylemi verilse de favori olmaz ve eylem yazılmaz', () => {
  const sonuc = favorileriBirlestir({
    mevcut: [],
    secilen: [
      { entity_id: 'lock.on_kapi', kisayol: 'Control+Alt+1', kisayolEylemi: 'ac' },
      { entity_id: 'light.kapi_lambasi', kisayol: 'Control+Alt+2', kisayolEylemi: 'ac' },
    ],
    guvenliListe: guvenli(), // güvenli listede yok: yeni giriş olamaz
    tumKimlikler: hepsi('lock.on_kapi', 'light.kapi_lambasi'),
  });
  assert.deepEqual(sonuc.yeni, []);
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'lock.on_kapi', ad: 'Ön kapı', kisayol: 'Control+Alt+1', kisayolEylemi: 'ac' },
    { entity_id: 'light.kapi_lambasi', ad: 'Kapı lambası', kisayol: 'Control+Alt+2', kisayolEylemi: 'ac' },
  ]);
  assert.deepEqual(favoriler, [], 'yükleme de kapı/kilit favorisini düşürür');
});

test('ayar şeması: kisayolEylemi ayarlar.json yüklemesinden ve dışa/içe aktarmadan geçer', () => {
  const ham = {
    favoriler: [
      { entity_id: 'light.led', ad: 'LED', parlaklik: true, kisayol: 'Control+Alt+1', kisayolEylemi: 'parlak-10' },
      { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Control+Alt+2', kisayolEylemi: 'kapat' },
      { entity_id: 'light.kotu', ad: 'Kötü', kisayol: 'Control+Alt+3', kisayolEylemi: 'parlak+10' },
    ],
  };
  const yuklenen = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN }).ayarlar;
  assert.deepEqual(yuklenen.favoriler.map((f) => f.kisayolEylemi), ['parlak-10', 'kapat', undefined]);

  const disa = ayarlariDisaAktar(yuklenen);
  assert.equal(disa.ok, true);
  const dosya = JSON.parse(disa.metin);
  assert.deepEqual(dosya.ayarlar.favoriler.map((f) => f.kisayolEylemi), ['parlak-10', 'kapat', undefined]);

  const ice = ayarYedeginiCoz(dosya, { varsayilan: VARSAYILAN });
  assert.equal(ice.ok, true);
  assert.deepEqual(ice.ayarlar.favoriler.map((f) => f.kisayolEylemi), ['parlak-10', 'kapat', undefined]);

  // İçe aktarılan dosyaya elle yazılmış geçersiz eylem içeri girmez.
  dosya.ayarlar.favoriler[1].kisayolEylemi = 'unlock';
  dosya.ayarlar.favoriler[0].kisayolEylemi = 'light.turn_on';
  const kotu = ayarYedeginiCoz(dosya, { varsayilan: VARSAYILAN });
  assert.equal(kotu.ok, true);
  assert.deepEqual(kotu.ayarlar.favoriler.map((f) => f.kisayolEylemi), [undefined, undefined, undefined]);
});
