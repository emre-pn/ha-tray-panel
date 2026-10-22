'use strict';

/**
 * Uygulama içi güncelleme (o-51) yapılandırması: electron-builder.yml `publish` bloğu, package.json bağımlılığı ve ana süreç bağlantı kuralları.
 * Derleme yapılmaz, ağa çıkılmaz; yalnız metin okunur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');

/** Üst düzey `<ad>:` altındaki "- anahtar: değer" liste öğelerinin (ilk düzey) anahtar/değerleri (yorumlar atılır). */
function ustListe(yml, ad) {
  const satirlar = yml.split('\n');
  const bas = satirlar.findIndex((s) => new RegExp(`^${ad}:\\s*(#.*)?$`).test(s));
  if (bas < 0) return null;
  const liste = [];
  for (const satir of satirlar.slice(bas + 1)) {
    if (/^\S/.test(satir)) break;
    const yeni = /^\s+-\s+([A-Za-z0-9]+):\s*(\S.*?)\s*(#.*)?$/.exec(satir);
    if (yeni) {
      liste.push({ [yeni[1]]: yeni[2] });
      continue;
    }
    const devam = /^\s+([A-Za-z0-9]+):\s*(\S.*?)\s*(#.*)?$/.exec(satir);
    if (devam && liste.length > 0) liste[liste.length - 1][devam[1]] = devam[2];
  }
  return liste;
}

test('o-51: publish yalnız bu deponun yayınlanmış sürümleri (app-update.yml); derleme hiçbir yere yüklemez', () => {
  const yml = oku('electron-builder.yml');
  assert.deepEqual(ustListe(yml, 'publish'), [{ provider: 'github', owner: 'emre-pn', repo: 'ha-tray-panel', releaseType: 'release' }]);
  const paket = JSON.parse(oku('package.json'));
  assert.match(paket.scripts.dist, /--publish never/, 'npm run dist hiçbir şey yüklemez');
  assert.match(paket.scripts['dist:tasinabilir'], /--publish never/);
  assert.equal(paket.repository.url, 'git+https://github.com/emre-pn/ha-tray-panel.git', 'publish deposu package.json deposuyla aynı');
  assert.doesNotMatch(yml, /^\s*(token|private|host|url|channel|publishAutoUpdate|vPrefixedTagName):/m, 'başka sağlayıcı/ayar ya da gizli bilgi yok');
});

test('o-51: publish bloğu electron-builder şemasına uyar (node_modules kuruluysa)', () => {
  const sema = path.join(KOK, 'node_modules', 'app-builder-lib', 'scheme.json');
  if (!fs.existsSync(sema)) return;
  const taslak = JSON.parse(fs.readFileSync(sema, 'utf8')).definitions.GithubOptions;
  const [yayin] = ustListe(oku('electron-builder.yml'), 'publish');
  for (const [ad, deger] of Object.entries(yayin)) {
    const ozellik = taslak.properties[ad];
    assert.ok(ozellik, `${ad}: electron-builder yayın seçeneği değil`);
    if (ozellik.enum) assert.ok(ozellik.enum.includes(deger), `${ad}: geçersiz değer`);
  }
});

test('o-51: electron-updater tam sürüme sabitli tek çalışma bağımlılığı; kilit dosyasında; yalnız main.js tembel yükler', () => {
  const paket = JSON.parse(oku('package.json'));
  assert.deepEqual(Object.keys(paket.dependencies), ['electron-updater']);
  assert.match(paket.dependencies['electron-updater'], /^\d+\.\d+\.\d+$/, '^ ya da ~ olmadan tam sürüm');
  assert.equal(paket.version, '1.4.2', 'bağımlılık eklemek sürümü değiştirmez');
  const kilit = JSON.parse(oku('package-lock.json'));
  assert.equal(kilit.packages['node_modules/electron-updater'].version, paket.dependencies['electron-updater']);
  assert.notEqual(kilit.packages['node_modules/electron-updater'].dev, true, 'paketlenen (çalışma) bağımlılık');
  assert.deepEqual(kilit.packages[''].dependencies, { 'electron-updater': paket.dependencies['electron-updater'] });
  const kaynaklar = fs.readdirSync(path.join(KOK, 'src'), { recursive: true }).map(String).filter((a) => a.endsWith('.js'));
  const yukleyenler = kaynaklar.filter((a) => /require\(\s*['"]electron-updater['"]\s*\)/.test(oku(path.join('src', a))));
  assert.deepEqual(yukleyenler, ['main.js'], 'electron-updater yalnız ana süreçte');
  const main = oku('src/main.js');
  assert.equal((main.match(/require\(\s*['"]electron-updater['"]\s*\)/g) ?? []).length, 1);
  assert.match(main, /guncelleyiciAl: \(\) => require\('electron-updater'\)\.autoUpdater/, 'tembel yükleme: seçenek kapalıyken modül yüklenmez');
  // Taşınabilir sürümde güncelleyici etkisiz: destek durumu paketli + taşınabilir olmayan Windows ister
  assert.match(main, /paketli: app\.isPackaged, tasinabilir: tasinabilirMi\(\), platform: process\.platform/);
});

test('o-51: ayarlar varsayılan KAPALI ve dışa/içe aktarmaya girmez (içe aktarılan dosya dış ağ seçeneğini açamaz)', () => {
  const { AYAR_ALANLARI, aktarilanAlanlar } = require('../src/lib/ayar-alanlari');
  for (const ad of ['uygulamaGuncelleme', 'onSurumler']) {
    const alan = AYAR_ALANLARI.find((a) => a.ad === ad);
    assert.ok(alan, ad);
    assert.equal(alan.tip, 'mantiksal');
    assert.equal(alan.varsayilan, false);
    assert.equal(alan.aktarilir, false);
    assert.equal(aktarilanAlanlar().includes(ad), false);
  }
});
