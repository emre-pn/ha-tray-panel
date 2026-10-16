'use strict';

/**
 * 1.2.0 (k-21): electron-builder.yml Electron sertleştirme anahtarları (fuse). YALNIZ RunAsNode,
 * EnableNodeOptionsEnvironmentVariable ve EnableNodeCliInspectArguments kapatılır; çerez şifreleme, asar bütünlüğü,
 * OnlyLoadAppFromAsar, GrantFileProtocolExtraPrivileges ve V8 anlık görüntüsüne dokunulmaz. Derleme yapılmaz; yalnız metin okunur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');

/** Üst düzey `electronFuses:` bloğunun "anahtar: değer" satırları (yorumlar atılır). */
function sigortaBlogu(yml) {
  const satirlar = yml.split('\n');
  const bas = satirlar.findIndex((s) => /^electronFuses:\s*(#.*)?$/.test(s));
  if (bas < 0) return null;
  const blok = {};
  for (const satir of satirlar.slice(bas + 1)) {
    if (/^\S/.test(satir)) break; // sonraki üst düzey anahtar
    const e = /^\s+([A-Za-z0-9]+):\s*([^#\s]+)\s*(#.*)?$/.exec(satir);
    if (e) blok[e[1]] = e[2];
  }
  return blok;
}

test('k-21: electronFuses yalnız runAsNode, NODE_OPTIONS ve --inspect kapılarını kapatır', () => {
  const blok = sigortaBlogu(oku('electron-builder.yml'));
  assert.ok(blok, 'electronFuses bloğu var');
  assert.deepEqual(blok, {
    runAsNode: 'false',
    enableNodeOptionsEnvironmentVariable: 'false',
    enableNodeCliInspectArguments: 'false',
  });
  for (const dokunulmaz of ['enableCookieEncryption', 'enableEmbeddedAsarIntegrityValidation', 'onlyLoadAppFromAsar', 'grantFileProtocolExtraPrivileges', 'loadBrowserProcessSpecificV8Snapshot']) {
    assert.equal(Object.hasOwn(blok, dokunulmaz), false, `${dokunulmaz} ayarlanmamalı`);
  }
  assert.equal((oku('electron-builder.yml').match(/^electronFuses:/gm) ?? []).length, 1);
});

test('k-21: kurulu electron-builder (app-builder-lib) fuse desteğini taşıyor (@electron/fuses bağımlılığı); uygulama kapatılan özellikleri kullanmıyor', () => {
  const kilit = JSON.parse(oku('package-lock.json'));
  const abl = kilit.packages?.['node_modules/app-builder-lib'];
  assert.ok(abl, 'app-builder-lib kilit dosyasında');
  assert.match(abl.version, /^26\./);
  assert.ok(abl.dependencies?.['@electron/fuses'], 'app-builder-lib @electron/fuses kullanır (electronFuses ayarı)');
  // node_modules kuruluysa şemada anahtarın adı da doğrulanır (kurulu değilse bu adım atlanır).
  const sema = path.join(KOK, 'node_modules', 'app-builder-lib', 'scheme.json');
  if (fs.existsSync(sema)) assert.ok(fs.readFileSync(sema, 'utf8').includes('"electronFuses"'));
  for (const ad of fs.readdirSync(path.join(KOK, 'src'), { recursive: true })) {
    if (!String(ad).endsWith('.js')) continue;
    const icerik = oku(path.join('src', String(ad)));
    assert.doesNotMatch(icerik, /ELECTRON_RUN_AS_NODE|NODE_OPTIONS|--inspect/, `${ad}: kapatılan özelliğe bağımlılık`);
  }
});

/** Üst düzey `<ad>:` bloğunun "anahtar: değer" satırları (yorumlar atılır; tek düzey iç içe). */
function ustBlok(yml, ad) {
  const satirlar = yml.split('\n');
  const bas = satirlar.findIndex((s) => new RegExp(`^${ad}:\\s*(#.*)?$`).test(s));
  if (bas < 0) return null;
  const blok = {};
  for (const satir of satirlar.slice(bas + 1)) {
    if (/^\S/.test(satir)) break;
    const e = /^\s+([A-Za-z0-9]+):\s*(\S.*?)\s*(#.*)?$/.exec(satir);
    if (e) blok[e[1]] = e[2];
  }
  return blok;
}

test('o-45: taşınabilir derleme tanımlı (portable bloğu, ayrı dosya adı); varsayılan `npm run dist` yalnız kurucuyu üretir; betik sürüme dokunmaz', () => {
  const yml = oku('electron-builder.yml');
  const portable = ustBlok(yml, 'portable');
  assert.ok(portable, 'portable bloğu var');
  assert.equal(portable.artifactName, 'Ev-Paneli-Tasinabilir-${version}.${ext}');
  assert.equal(portable.requestExecutionLevel, 'user', 'yönetici izni istemez');
  assert.equal(portable.unpackDirName, 'false', 'her açılış kendi geçici klasörünü kullanır (eşzamanlı açılış çakışmaz)');
  assert.deepEqual(Object.keys(portable).sort(), ['artifactName', 'requestExecutionLevel', 'unpackDirName']);
  // win.target yalnız nsis: `npm run dist` değişmedi; kurucu adı da ayrı
  const winSatirlari = yml.slice(yml.indexOf('\nwin:') + 1).split('\n');
  const win = winSatirlari.slice(0, winSatirlari.findIndex((satir, i) => i > 0 && /^\S/.test(satir))).join('\n'); // bir sonraki üst düzey satıra (yorum dahil) kadar
  assert.match(win, /target:\n\s+- target: nsis\n/, 'win.target nsis ile başlar');
  assert.doesNotMatch(win, /portable/, 'portable win.target listesinde değil');
  assert.match(win, /artifactName: Ev-Paneli-Kurulum-\$\{version\}\.\$\{ext\}/);
  const paket = JSON.parse(oku('package.json'));
  assert.equal(paket.scripts.dist, 'electron-builder --win nsis --x64 --publish never');
  assert.equal(paket.scripts['dist:tasinabilir'], 'electron-builder --win portable --x64 --publish never');
  assert.equal(paket.version, '1.3.0', 'sürüme dokunulmadı');
});

test('o-45: portable bloğu electron-builder şemasına uyar (node_modules kuruluysa); CHANGELOG.md paketlenir', () => {
  const yml = oku('electron-builder.yml');
  assert.match(yml, /^files:\n(?:  - .*\n)*  - CHANGELOG\.md\b/m, 'Yenilikler (o-40) için not dosyası pakette');
  assert.ok(fs.existsSync(path.join(KOK, 'CHANGELOG.md')));
  const sema = path.join(KOK, 'node_modules', 'app-builder-lib', 'scheme.json');
  if (!fs.existsSync(sema)) return;
  const taslak = JSON.parse(fs.readFileSync(sema, 'utf8')).definitions.PortableOptions;
  const portable = ustBlok(yml, 'portable');
  const tip = (deger) => (deger === 'true' || deger === 'false' ? 'boolean' : 'string');
  for (const [ad, deger] of Object.entries(portable)) {
    const ozellik = taslak.properties[ad];
    assert.ok(ozellik, `${ad}: electron-builder portable seçeneği değil`);
    assert.ok([].concat(ozellik.type).includes(tip(deger)), `${ad}: tür uyuşmuyor`);
    if (ozellik.enum) assert.ok(ozellik.enum.includes(deger), `${ad}: geçersiz değer`);
  }
});

test('o-45: taşınabilir derlemede Windows açılışına yazılmaz ve veri klasörü kurulu sürümle ortaktır (kaynak denetimi)', () => {
  const main = oku('src/main.js');
  assert.match(main, /process\.env\.PORTABLE_EXECUTABLE_FILE/, 'electron-builder portable açılış yardımcısının ortam değişkeni');
  assert.match(main, /if \(!app\.isPackaged \|\| tasinabilirMi\(\)\) return;/, 'otomatikBaslatUygula taşınabilirde yazmaz');
  assert.match(main, /enabled: app\.isPackaged && !tasinabilirMi\(\)/, 'tepsi kutusu taşınabilirde kapalı');
  assert.match(main, /VERI_KLASORU = app\.isPackaged \? UYGULAMA_ADI/, 'veri klasörü kurulu sürümle aynı');
  const portableNsi = path.join(KOK, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi');
  if (fs.existsSync(portableNsi)) assert.match(fs.readFileSync(portableNsi, 'utf8'), /"PORTABLE_EXECUTABLE_FILE"/, 'ortam değişkeni adı electron-builder ile aynı');
});
