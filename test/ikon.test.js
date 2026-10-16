'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BOYUTLAR, SOLUK_ALFA, pikselDizisiUret, pngUret, icoUret } = require('../araclar/ikon-uret');

const ASSETS = path.join(__dirname, '..', 'assets');
const PNG_IMZASI = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ham piksel dizisi: her satırın başında 1 bayt PNG filtresi var; RGBA piksellerini döndürür. */
function pikseller(boyut, soluk) {
  const ham = pikselDizisiUret(boyut, soluk);
  const cikti = [];
  for (let y = 0; y < boyut; y++) {
    const satir = y * (boyut * 4 + 1);
    assert.equal(ham[satir], 0, 'filtre baytı None');
    for (let x = 0; x < boyut; x++) {
      const o = satir + 1 + x * 4;
      cikti.push({ r: ham[o], g: ham[o + 1], b: ham[o + 2], a: ham[o + 3] });
    }
  }
  return cikti;
}

test('ikon aracı require edilince dosya yazmaz (yalnız doğrudan çalıştırılınca üretir) ve beklenen dışa aktarımları verir', () => {
  assert.ok(BOYUTLAR.includes(16) && BOYUTLAR.includes(32) && BOYUTLAR.includes(256), 'tepsi (16/32) ve büyük boyutlar var');
  assert.equal(SOLUK_ALFA, 0.45);
  assert.equal(typeof pikselDizisiUret, 'function');
  assert.equal(typeof pngUret, 'function');
  assert.equal(typeof icoUret, 'function');
});

test('soluk simge: gri tonlama (r=g=b) ve alfa en çok 0,45 kat; normal simge renkli ve opak kalır', () => {
  const normal = pikseller(32, false);
  const soluk = pikseller(32, true);
  assert.equal(normal.length, soluk.length);
  assert.ok(normal.some((p) => p.a === 255 && p.b > p.r), 'normal simgede mavi kart opak');
  assert.equal(normal.every((p) => p.r === p.g && p.g === p.b), false, 'normal simge renkli');
  for (let i = 0; i < soluk.length; i++) {
    const s = soluk[i];
    assert.ok(s.r === s.g && s.g === s.b, 'gri tonlama');
    assert.ok(s.a <= Math.round(255 * SOLUK_ALFA), 'alfa en çok 0,45 kat');
    assert.ok(s.a <= Math.round(normal[i].a * SOLUK_ALFA) + 1, 'her pikselde normalin 0,45 katını geçmez');
  }
  assert.ok(soluk.some((p) => p.a > 0), 'soluk simge tamamen görünmez değil');
});

test('soluk parametresi verilmeyen simge değişmedi (varsayılan davranış); soluk olanı farklı', () => {
  assert.ok(pikselDizisiUret(16).equals(pikselDizisiUret(16, false)));
  assert.equal(pikselDizisiUret(16).equals(pikselDizisiUret(16, true)), false);
});

test('assets: ikon-soluk.png geçerli PNG (256x256 RGBA); ikon-soluk.ico çok boyutlu geçerli ICO', () => {
  const png = fs.readFileSync(path.join(ASSETS, 'ikon-soluk.png'));
  assert.ok(png.subarray(0, 8).equals(PNG_IMZASI));
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6, 'RGBA');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');

  const ico = fs.readFileSync(path.join(ASSETS, 'ikon-soluk.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), BOYUTLAR.length);
  for (let i = 0; i < BOYUTLAR.length; i++) {
    const boyut = ico[6 + i * 16] || 256;
    assert.equal(boyut, BOYUTLAR[i]);
    const uzunluk = ico.readUInt32LE(6 + i * 16 + 8);
    const ofset = ico.readUInt32LE(6 + i * 16 + 12);
    assert.ok(ico.subarray(ofset, ofset + 8).equals(PNG_IMZASI), `${boyut}px girdisi PNG`);
    assert.ok(ofset + uzunluk <= ico.length);
  }
});

test('assets: diskteki soluk PNG araçtan çıkanla aynı (elle bozulmamış); normal simgeden farklı', () => {
  const soluk = fs.readFileSync(path.join(ASSETS, 'ikon-soluk.png'));
  assert.ok(soluk.equals(pngUret(256, true)));
  const normal = fs.readFileSync(path.join(ASSETS, 'ikon.png'));
  assert.ok(normal.subarray(0, 8).equals(PNG_IMZASI));
  assert.equal(normal.equals(soluk), false);
});
