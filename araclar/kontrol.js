'use strict';

/**
 * Statik denetim (Electron ÇALIŞTIRILMAZ, hiçbir pencere açılmaz).
 *  1. src/, test/ ve araclar/ altındaki her .js dosyası için `node --check`.
 *  2. src/*.html içindeki satır içi <script> gövdeleri için sözdizimi denetimi (kod çalıştırılmaz).
 *  3. Metin dosyalarında CR (CRLF) kalmadığı.
 *  4. Yasaklı kalıplar: sertifika hatası bastırma, JWT benzeri sabit.
 * Çıkış kodu: 0 = temiz, 1 = sorun var.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
// .claude: yerel araç klasörü (içindeki çalışma kopyaları) ana klasörde kopya kod olarak taranmasın (h-34).
const ATLANAN_DIZINLER = new Set(['node_modules', '.git', 'dist', '.claude']);
const METIN_UZANTILARI = new Set(['.js', '.html', '.css', '.json', '.md', '.yml', '.nsh']);
const METIN_ADLARI = new Set(['.gitignore', '.gitattributes', '.npmrc']);

const YASAKLI_KALIPLAR = [
  { ad: 'sertifika hatası bastırma', desen: /certificate-error|setCertificateVerifyProc|ignore-certificate-errors/ },
  { ad: 'JWT benzeri sabit', desen: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
];

const KALIP_TANIMLAYANLAR = new Set(['araclar/kontrol.js', 'test/yapi.test.js']);

function dosyalariTopla(dizin, sonuc = []) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    if (ATLANAN_DIZINLER.has(girdi.name)) continue;
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) dosyalariTopla(tam, sonuc);
    else sonuc.push(tam);
  }
  return sonuc;
}

const goreli = (dosya) => path.relative(KOK, dosya).split(path.sep).join('/');
const sorunlar = [];

const tumDosyalar = dosyalariTopla(KOK);
const metinDosyalari = tumDosyalar.filter(
  (d) => METIN_UZANTILARI.has(path.extname(d).toLowerCase()) || METIN_ADLARI.has(path.basename(d)),
);
// package-lock.json bağımlılık bütünlük özetleri içerir; yasaklı kalıp taramasına girmez.
const kalipTaramasinaGirenler = metinDosyalari.filter((d) => path.basename(d) !== 'package-lock.json');

// 1) node --check
const jsDosyalari = tumDosyalar.filter((d) => {
  if (path.extname(d) !== '.js') return false;
  const g = goreli(d);
  return g.startsWith('src/') || g.startsWith('test/') || (g.startsWith('araclar/') && !g.slice(8).includes('/'));
});
for (const dosya of jsDosyalari) {
  const sonuc = spawnSync(process.execPath, ['--check', dosya], { encoding: 'utf8' });
  if (sonuc.status !== 0) sorunlar.push(`node --check başarısız: ${goreli(dosya)}\n${(sonuc.stderr || '').trim()}`);
}

// 2) HTML içindeki satır içi betikler (yalnız sözdizimi; vm.Script çalıştırmaz)
const htmlDosyalari = tumDosyalar.filter((d) => goreli(d).startsWith('src/') && d.endsWith('.html'));
for (const dosya of htmlDosyalari) {
  const icerik = fs.readFileSync(dosya, 'utf8');
  const desen = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let eslesme;
  let sira = 0;
  while ((eslesme = desen.exec(icerik))) {
    sira += 1;
    try {
      new vm.Script(eslesme[1], { filename: `${goreli(dosya)}#betik${sira}` });
    } catch (hata) {
      sorunlar.push(`HTML betiği sözdizimi hatası: ${goreli(dosya)} (betik ${sira}): ${hata.message}`);
    }
  }
}

// 3) CR denetimi, 4) yasaklı kalıplar
for (const dosya of metinDosyalari) {
  if (fs.readFileSync(dosya, 'utf8').includes('\r')) sorunlar.push(`CR (CRLF) bulundu: ${goreli(dosya)}`);
}
for (const dosya of kalipTaramasinaGirenler) {
  const icerik = fs.readFileSync(dosya, 'utf8');
  for (const { ad, desen } of YASAKLI_KALIPLAR) {
    // Bu dosyalar kalıpların kendisini tanımlar.
    if (KALIP_TANIMLAYANLAR.has(goreli(dosya))) continue;
    if (desen.test(icerik)) sorunlar.push(`Yasaklı kalıp (${ad}): ${goreli(dosya)}`);
  }
}

if (sorunlar.length) {
  console.error(`Kontrol BAŞARISIZ (${sorunlar.length} sorun):`);
  for (const s of sorunlar) console.error(` - ${s}`);
  process.exit(1);
}
console.log(`Kontrol tamam: ${jsDosyalari.length} .js, ${htmlDosyalari.length} .html, ${metinDosyalari.length} metin dosyası.`);
