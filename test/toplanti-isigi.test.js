'use strict';

// 1.4.0 dis grubu (o-53): toplantı ışığı. Kayıt defteri SORGULANMAZ: `reg query` çıktısı sahtedir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { kullanimdaMi, anahtarlar, toplantiIzleyiciOlustur, AYGIT_ANAHTARLARI, BITIS_OKUMASI } = require('../src/lib/toplanti-isigi');

const KOK = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const cikti = (start, stop) =>
  [
    KOK,
    '    Value    REG_SZ    Allow',
    '',
    `${KOK}\\Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe`,
    '    Value    REG_SZ    Allow',
    '    LastUsedTimeStart    REG_QWORD    0x1d9a5b2c3d4e5f6',
    '    LastUsedTimeStop    REG_QWORD    0x1d9a5b2c3d4e5f9',
    '',
    `${KOK}\\NonPackaged`,
    '',
    `${KOK}\\NonPackaged\\C:#Program Files#Gizli Uygulama#app.exe`,
    `    LastUsedTimeStart    REG_QWORD    ${start}`,
    `    LastUsedTimeStop    REG_QWORD    ${stop}`,
    '',
  ].join('\r\n');

test('kullanimdaMi: Start > 0 ve Stop = 0 olan alt anahtar varsa kullanımda; yalnız boolean döner', () => {
  assert.equal(kullanimdaMi(cikti('0x1da0000000000001', '0x0')), true);
  assert.equal(kullanimdaMi(cikti('0x1da0000000000001', '0x1da0000000000002')), false);
  assert.equal(kullanimdaMi(cikti('0x0', '0x0')), false);
  assert.equal(kullanimdaMi(cikti('bozuk', '0x0')), false);
  assert.equal(kullanimdaMi(''), false);
  assert.equal(kullanimdaMi(null), false);
  // son blok da sayılır (dosya sonunda boş satır olmasa da)
  assert.equal(kullanimdaMi(`${KOK}\\x\n    LastUsedTimeStart    REG_QWORD    0x5\n    LastUsedTimeStop    REG_QWORD    0x0`), true);
  assert.equal(typeof kullanimdaMi(cikti('0x1', '0x0')), 'boolean');
});

test('anahtarlar: kaynak seçimine göre mikrofon, kamera ya da ikisi; yalnız HKCU ConsentStore', () => {
  assert.deepEqual(anahtarlar('mikrofon'), [AYGIT_ANAHTARLARI.mikrofon]);
  assert.deepEqual(anahtarlar('kamera'), [AYGIT_ANAHTARLARI.kamera]);
  assert.deepEqual(anahtarlar('ikisi'), [AYGIT_ANAHTARLARI.mikrofon, AYGIT_ANAHTARLARI.kamera]);
  for (const a of anahtarlar('ikisi')) assert.match(a, /^HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\(microphone|webcam)$/);
});

function izleyiciOrtami({ yanit } = {}) {
  const degisimler = [];
  const sorgular = [];
  const gunlukler = [];
  const zamanlayicilar = [];
  let durum = yanit ?? cikti('0x1', '0x5');
  const iz = toplantiIzleyiciOlustur({
    sorgula: async (anahtar) => {
      sorgular.push(anahtar);
      if (durum instanceof Error) throw durum;
      return durum;
    },
    kaynakAl: () => 'ikisi',
    aralikAl: () => 1000, // 5 sn'ye sıkıştırılır
    degisti: (k) => degisimler.push(k),
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: (fn, ms) => (zamanlayicilar.push({ fn, ms }), zamanlayicilar.length), clearTimeout: () => {} },
  });
  return { iz, degisimler, sorgular, gunlukler, zamanlayicilar, ayarla: (d) => (durum = d) };
}

test('izleyici: ilk kullanımda başladı, art arda iki boş okumada bitti (titreşim yok); aralık en az 5 sn', async () => {
  const o = izleyiciOrtami();
  o.iz.baslat();
  await new Promise(setImmediate);
  assert.deepEqual(o.degisimler, []);
  assert.equal(o.zamanlayicilar.at(-1).ms, 5000);
  o.ayarla(cikti('0x1', '0x0'));
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true]);
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true], 'sürüyor: yeniden bildirilmez');
  o.ayarla(cikti('0x1', '0x5'));
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true], 'tek boş okuma yetmez');
  o.ayarla(cikti('0x1', '0x0'));
  await o.iz.yokla();
  o.ayarla(cikti('0x1', '0x5'));
  for (let i = 0; i < BITIS_OKUMASI; i += 1) await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true, false]);
  assert.equal(o.iz.durum().toplantida, false);
});

test('izleyici: okunamayan kayıt durumu değiştirmez ve bir kez, uygulama adı olmadan günlüğe yazılır', async () => {
  const o = izleyiciOrtami({ yanit: new Error('erişim yok') });
  o.iz.baslat();
  await new Promise(setImmediate);
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, []);
  assert.equal(o.gunlukler.length, 1);
  o.ayarla(cikti('0x1', '0x0'));
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true]);
  assert.equal(o.gunlukler.some((g) => /Gizli Uygulama|app\.exe|NonPackaged/.test(g)), false);
});

test('izleyici: durdur toplantı bitişini bildirmez; duraklat/surdur uykuda yoklamayı durdurur', async () => {
  const o = izleyiciOrtami({ yanit: cikti('0x1', '0x0') });
  o.iz.baslat();
  await new Promise(setImmediate);
  assert.deepEqual(o.degisimler, [true]);
  o.iz.duraklat();
  assert.equal(o.iz.durum().duraklatildi, true);
  const once = o.zamanlayicilar.length;
  o.iz.surdur();
  assert.equal(o.zamanlayicilar.length, once + 1);
  o.iz.durdur();
  assert.deepEqual(o.degisimler, [true]);
  assert.equal(o.iz.durum().calisiyor, false);
  // durdurulduktan sonra gelen bayat yoklama sonucu yok sayılır
  await o.iz.yokla();
  assert.deepEqual(o.degisimler, [true]);
});

test('izleyici: yenile() yalnız zamanlayıcıyı yeni aralıkla kurar; toplantı durumu ve boş okuma sayacı korunur (devam eden toplantı yeniden başlamaz)', async () => {
  let aralik = 10_000;
  const degisimler = [];
  const zamanlayicilar = [];
  const silinen = [];
  let yanit = cikti('0x1', '0x0');
  const iz = toplantiIzleyiciOlustur({
    sorgula: async () => yanit,
    kaynakAl: () => 'mikrofon',
    aralikAl: () => aralik,
    degisti: (k) => degisimler.push(k),
    zaman: { setTimeout: (fn, ms) => (zamanlayicilar.push({ fn, ms }), zamanlayicilar.length), clearTimeout: (id) => silinen.push(id) },
  });
  iz.baslat();
  await new Promise(setImmediate);
  assert.deepEqual(degisimler, [true]);
  assert.equal(zamanlayicilar.at(-1).ms, 10_000);
  // bir boş okuma görüldü (bitiş için ikinci gerekir)
  yanit = cikti('0x1', '0x5');
  await iz.yokla();
  aralik = 30_000;
  iz.yenile();
  assert.equal(zamanlayicilar.at(-1).ms, 30_000, 'bekleyen zamanlayıcı yeni aralıkla kuruldu');
  assert.ok(silinen.length >= 1, 'eskisi bırakıldı');
  assert.deepEqual(degisimler, [true], 'yeniden "başladı" bildirilmedi');
  assert.equal(iz.durum().toplantida, true);
  await iz.yokla(); // sayaç korunduğu için bu ikinci boş okuma: bitiş
  assert.deepEqual(degisimler, [true, false]);

  // duraklatılmışken ya da durdurulmuşken zamanlayıcı kurmaz
  const once = zamanlayicilar.length;
  iz.duraklat();
  iz.yenile();
  assert.equal(zamanlayicilar.length, once);
  iz.durdur();
  iz.yenile();
  assert.equal(zamanlayicilar.length, once);
});

test('toplantı ışığı modülü kayıt defterine yazmaz ve ağ/dosya API\'si kullanmaz', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'toplanti-isigi.js'), 'utf8');
  assert.doesNotMatch(kaynak, /reg(\.exe)?['"]?\s*,\s*\[\s*['"](add|delete|import)|require\(/);
});
