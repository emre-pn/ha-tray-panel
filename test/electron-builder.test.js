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
