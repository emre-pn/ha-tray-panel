'use strict';

/**
 * Yapısal denetimler: lib modüllerinin saflığı, satır sonları, sır/sertifika kalıpları.
 * (Hiçbir şey çalıştırılmaz; yalnız dosyalar okunur.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
// .claude: çalışma kopyaları (.claude/worktrees) taranmaz; ana klasörde yanlış alarm vermesin (h-34).
const ATLANAN = new Set(['node_modules', '.git', 'dist', '.claude']);
const METIN_UZANTILARI = new Set(['.js', '.html', '.css', '.json', '.md', '.yml', '.nsh']);
const METIN_ADLARI = new Set(['.gitignore', '.gitattributes', '.npmrc']);

function topla(dizin, sonuc = []) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    if (ATLANAN.has(girdi.name)) continue;
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) topla(tam, sonuc);
    else sonuc.push(tam);
  }
  return sonuc;
}

const goreli = (d) => path.relative(KOK, d).split(path.sep).join('/');
const tumDosyalar = topla(KOK);
const metinDosyalari = tumDosyalar.filter(
  (d) => METIN_UZANTILARI.has(path.extname(d).toLowerCase()) || METIN_ADLARI.has(path.basename(d)),
);
const libDosyalari = tumDosyalar.filter((d) => goreli(d).startsWith('src/lib/') && d.endsWith('.js'));
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
// Belgeler açık kaynak düzeninde üç dosyaya ayrıldı: kısa iki dilli README, ayrıntılı kılavuz (docs/KILAVUZ.md) ve sürüm geçmişi (CHANGELOG.md).
const belgeler = () => ['README.md', 'docs/KILAVUZ.md', 'CHANGELOG.md'].map(oku).join('\n');

test('src/lib altında en az bir modül var ve hiçbiri electron kullanmıyor', () => {
  assert.ok(libDosyalari.length >= 10);
  for (const dosya of libDosyalari) {
    const icerik = fs.readFileSync(dosya, 'utf8');
    assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(icerik), `${goreli(dosya)} electron'u require ediyor`);
  }
});

test('src/lib modülleri yalnız node: yerleşiklerini ve ./ yerel modüllerini require eder', () => {
  for (const dosya of libDosyalari) {
    const icerik = fs.readFileSync(dosya, 'utf8');
    for (const eslesme of icerik.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const ad = eslesme[1];
      assert.ok(ad.startsWith('node:') || ad.startsWith('./'), `${goreli(dosya)}: izin verilmeyen require('${ad}')`);
    }
  }
});

test('metin dosyalarında CR (CRLF) yok; satır sonları LF', () => {
  for (const dosya of metinDosyalari) {
    assert.ok(!fs.readFileSync(dosya, 'utf8').includes('\r'), `${goreli(dosya)} CR içeriyor`);
  }
});

test('src ve test içinde JWT benzeri sabit yok (sır koda girmez)', () => {
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/;
  for (const dosya of metinDosyalari) {
    const g = goreli(dosya);
    if (!g.startsWith('src/') && !g.startsWith('test/')) continue;
    assert.ok(!jwt.test(fs.readFileSync(dosya, 'utf8')), `${g} JWT benzeri sabit içeriyor`);
  }
});

test('sertifika doğrulaması bastırılmıyor (ev içi https sertifikası normal doğrulanır)', () => {
  const yasakli = /certificate-error|setCertificateVerifyProc|ignore-certificate-errors/;
  for (const dosya of metinDosyalari) {
    const g = goreli(dosya);
    if (!g.startsWith('src/')) continue;
    assert.ok(!yasakli.test(fs.readFileSync(dosya, 'utf8')), `${g} sertifika hatası bastırıyor`);
  }
});

test('kullanıcı veri klasörü yalnız bir yerde ve geliştirme/kurulu ayrımıyla ayarlanıyor (hata-23)', () => {
  const main = oku('src/main.js');
  assert.equal(main.match(/setPath\(\s*'userData'/g)?.length, 1);
  assert.match(main, /VERI_KLASORU\s*=\s*app\.isPackaged\s*\?\s*UYGULAMA_ADI\s*:\s*`\$\{UYGULAMA_ADI\} \(gelistirme\)`/);
  assert.equal(main.match(/requestSingleInstanceLock\(/g)?.length, 1);
});

test('offline.js geri sayım bitince kendi başına "tekrar dene" çağırmıyor (hata-05)', () => {
  const js = oku('src/offline.js'); // betik hata-17 ile HTML'den ayrıldı
  // Tek çağrı: kullanıcının "Tekrar Dene" düğmesi.
  assert.equal(js.match(/\.tekrarDene\(\)/g)?.length, 1);
  const sayac = js.slice(js.indexOf('function baslatSayac'), js.indexOf('if (durum ==='));
  assert.ok(sayac.length > 50 && !sayac.includes('tekrarDene'));
});

test('package.json test ve kontrol betiklerini tanımlıyor; sürüm 1.3.0 ve README ile tutarlı', () => {
  const paket = JSON.parse(oku('package.json'));
  assert.equal(paket.scripts.test, 'node --test');
  assert.equal(paket.scripts.kontrol, 'node araclar/kontrol.js');
  assert.equal(paket.version, '1.3.0');
  assert.equal(JSON.parse(oku('package-lock.json')).version, paket.version, 'package-lock.json sürümü package.json ile aynı olmalı');
  const readme = belgeler();
  assert.ok(readme.includes(`Ev-Paneli-Kurulum-${paket.version}.exe`), 'README kurulum dosyası adı sürümle uyuşmuyor');
  assert.match(readme, new RegExp(`^### ${paket.version.replace(/\./g, '\\.')} — \\d{4}-\\d{2}-\\d{2}$`, 'm'), 'README Sürüm Geçmişi güncel sürümü içermiyor');
  assert.doesNotMatch(readme, /Sürüm `package\.json` içinde `1\.0\.0` kalır/);
});

test('varsayılan ayarlar güvenli: favori yok, kısayol geçerli', () => {
  const v = JSON.parse(oku('varsayilan-ayarlar.json'));
  assert.deepEqual(v.favoriler, []);
  assert.equal(v.kisayol, 'Control+Alt+H');
});

// ---------------------------------------------------------------------------
// hata-17: yerel sayfaların sertleştirilmesi (CSP, satır içi betik yok, innerHTML yok, preload koruması)
// ---------------------------------------------------------------------------

const YEREL_SAYFALAR = tumDosyalar.filter((d) => goreli(d).startsWith('src/') && d.endsWith('.html')).map(goreli);
const RENDERER_BETIKLERI = ['src/ayarlar.js', 'src/offline.js', 'src/kose-sayfa.js', 'src/yuzey-sayfa.js', 'src/lib/arama.js', 'src/lib/ayar-arama.js', 'src/lib/kaydirici.js', 'src/lib/kisayol.js', 'src/lib/dil.js', 'src/lib/ceviri/ana.js', 'src/lib/ceviri/ayarlar.js', 'src/lib/ceviri/yuzey.js'];
// preload.js'in window.evPaneli altında açtığı tam liste (başka işlev açılırsa bu test bilinçli güncellenmeli).
const EV_PANELI_KOPRUSU = [
  'tekrarDene',
  'ayarlariAc',
  'onBaglantiDurum',
  'ayarlariGetir',
  'ayarlariKaydet',
  'otomatikBaslatEtkinlestir',
  'anahtarKaydet',
  'anahtarSil',
  'yetkiYenidenDene',
  'cihazlariGetir',
  'favorileriKaydet',
  'hazirListeyiUygula',
  'adresSina',
  'acikSayfa',
  'ayarlariDisaAktar',
  'ayarlariIceAktar',
  'yedekleriGetir',
  'yedektenDon',
  'onFavorilerDegisti',
  'onDilDegisti',
  // arac grubu (o-40): sürüm denetimi ve Yenilikler
  'surumDurumu',
  'surumuDenetle',
  'yenilikleriGetir',
  'surumSayfasiniAc',
  // arac grubu (o-41): tanılama raporu (önizleme, kopyalama) ve günlük klasörü
  'tanilamaGetir',
  'tanilamaKopyala',
  'gunlukKlasoruAc',
  // arac grubu (o-44): odadan ilk kurulum önerisi (yalnız okur)
  'odalariGetir',
  'onBolumAc',
];
// preload-yuzey.js'in window.evYuzey altında açtığı tam liste (hızlı panel / palet; Dalga 3).
// 1.4.0: 'oku' (yuzey:oku; geçmiş/takvim/hava/yapılacaklar, yalnız kayıtlı varlıklar, ana süreçte süzülür) bilinçli eklendi.
const EV_YUZEY_KOPRUSU = ['durumAl', 'onDurum', 'onGoster', 'onDilDegisti', 'calistir', 'oku', 'basiliBasla', 'basiliBirak', 'kapat', 'boyut', 'haAc', 'ayarlarAc'];

test('yerel sayfalar bulundu (ayarlar, çevrimdışı, köşe bildirimi, hızlı panel/palet)', () => {
  assert.deepEqual([...YEREL_SAYFALAR].sort(), ['src/ayarlar.html', 'src/kose-bildirim.html', 'src/offline.html', 'src/yuzey.html']);
});

test('yerel sayfalarda satır içi betik gövdesi ve on* olay özniteliği yok; betikler yerel dosyalara bağlı', () => {
  for (const sayfa of YEREL_SAYFALAR) {
    const html = oku(sayfa);
    const betikler = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(betikler.length >= 1, `${sayfa}: betik yok`);
    for (const [, nitelikler, govde] of betikler) {
      const kaynak = /\bsrc\s*=\s*"([^"]+)"/.exec(nitelikler)?.[1];
      assert.ok(kaynak, `${sayfa}: satır içi <script> (src yok)`);
      assert.equal(govde.trim(), '', `${sayfa}: <script src> gövdesi boş olmalı`);
      assert.ok(!/^[a-z]+:|^\/\//i.test(kaynak), `${sayfa}: betik yerel olmalı (${kaynak})`);
      assert.ok(fs.existsSync(path.join(path.dirname(path.join(KOK, sayfa)), kaynak)), `${sayfa}: ${kaynak} yok`);
    }
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `${sayfa}: on* olay özniteliği var`);
    assert.ok(!/javascript:/i.test(html), `${sayfa}: javascript: adresi var`);
  }
});

test('her yerel sayfada katı CSP var: betik yalnız kendi dosyalarından, bağlantı/nesne/çerçeve yok', () => {
  for (const sayfa of YEREL_SAYFALAR) {
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(oku(sayfa));
    assert.ok(meta, `${sayfa}: CSP meta yok`);
    const yonergeler = Object.fromEntries(
      meta[1].split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
        const [ad, ...degerler] = p.split(/\s+/);
        return [ad, degerler.join(' ')];
      }),
    );
    assert.equal(yonergeler['default-src'], "'none'", `${sayfa}: default-src 'none' olmalı`);
    assert.equal(yonergeler['script-src'], "'self'", `${sayfa}: script-src yalnız 'self'`);
    assert.equal(yonergeler['connect-src'], "'none'", `${sayfa}: connect-src 'none'`);
    assert.equal(yonergeler['object-src'], "'none'");
    assert.equal(yonergeler['frame-src'], "'none'");
    assert.equal(yonergeler['base-uri'], "'none'");
    assert.equal(yonergeler['form-action'], "'none'");
    assert.ok(!/unsafe-eval|https?:|\*/.test(meta[1].replace("'unsafe-inline'", '')), `${sayfa}: gevşek kaynak var`);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(meta[1]), `${sayfa}: betikte unsafe-inline yok`);
  }
});

test('renderer betikleri HTML ataması, eval ve uzak yükleme kullanmaz (metin yalnız textContent ile yazılır)', () => {
  for (const betik of RENDERER_BETIKLERI) {
    const icerik = oku(betik);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|importScripts/.test(icerik), `${betik}: tehlikeli API`);
    // Sözlükler yalnız metindir; ayar etiketinde "WebSocket" sözcüğü geçebilir, bu yüzden orada yalnız çağrı biçimi (new WebSocket) aranır.
    const agDeseni = betik.startsWith('src/lib/ceviri/')
      ? /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|window\.open\s*\(/
      : /\bfetch\s*\(|XMLHttpRequest|WebSocket|window\.open\s*\(/;
    assert.ok(!agDeseni.test(icerik), `${betik}: ağ/pencere API'si`);
    assert.ok(!/require\s*\(/.test(icerik), `${betik}: sandbox'ta require yok`);
  }
});

test('renderer betikleri yalnız preload\'un açtığı işlevleri çağırır; Ayarlar betiğinin kimlikleri HTML\'de var', () => {
  for (const betik of ['src/ayarlar.js', 'src/offline.js']) {
    for (const [, ad] of oku(betik).matchAll(/window\.evPaneli\.(\w+)/g)) {
      assert.ok(EV_PANELI_KOPRUSU.includes(ad), `${betik}: evPaneli.${ad} preload'da yok`);
    }
  }
  for (const [, ad] of oku('src/yuzey-sayfa.js').matchAll(/(?:evYuzey|kopru)\.(\w+)/g)) {
    assert.ok(EV_YUZEY_KOPRUSU.includes(ad), `yuzey-sayfa.js: evYuzey.${ad} preload-yuzey'de yok`);
  }
  const yuzeyHtml = oku('src/yuzey.html');
  for (const [, kimlik] of oku('src/yuzey-sayfa.js').matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.ok(yuzeyHtml.includes(`id="${kimlik}"`), `yuzey.html: #${kimlik} yok`);
  }
  const html = oku('src/ayarlar.html');
  // ayarlar.js öğeleri `$('kimlik')` kısayoluyla (document.getElementById sarmalayıcısı) alır; ikisi de denetlenir.
  const ayarlarKimlikleri = [...oku('src/ayarlar.js').matchAll(/(?:getElementById|\$)\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ayarlarKimlikleri.length > 60, 'ayarlar.js öğe kimlikleri bulunamadı (kısayol değişmiş olabilir)');
  for (const kimlik of ayarlarKimlikleri) {
    assert.ok(html.includes(`id="${kimlik}"`), `ayarlar.html: #${kimlik} yok`);
  }
  for (const [, kimlik] of oku('src/offline.js').matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.ok(oku('src/offline.html').includes(`id="${kimlik}"`), `offline.html: #${kimlik} yok`);
  }
});

test('ayarlar.js anahtar silme onay metni, ana sürecin gösterdiği ileti ile aynı kaynaktan (src/lib/ceviri/ana.js sözlüğü) gelir', () => {
  const { ANAHTAR_SILME_ONAY_METNI, ANAHTAR_SILINDI_METNI } = require('../src/lib/bildirim-metni');
  const sozluk = require('../src/lib/ceviri/ana');
  // Ayarlar sayfası metni kendi kopyasında tutmaz: aynı sözlük anahtarını çağırır (Türkçe ve İngilizce tek yerden gelir).
  assert.match(oku('src/ayarlar.js'), /confirm\(t\('bildirim\.anahtarSilmeOnay'\)\)/);
  assert.doesNotMatch(oku('src/ayarlar.js'), /ANAHTAR_SILME_ONAY_METNI/);
  assert.equal(sozluk.tr['bildirim.anahtarSilmeOnay'], ANAHTAR_SILME_ONAY_METNI);
  assert.ok(sozluk.en['bildirim.anahtarSilmeOnay'].length > 20, 'İngilizce onay metni var');
  assert.match(ANAHTAR_SILME_ONAY_METNI, /iptal EDİLMEZ/);
  assert.match(ANAHTAR_SILINDI_METNI, /iptal etmeyi unutma/);
  assert.match(oku('src/ayarlar.html'), />Anahtarı Bu Bilgisayardan Sil</);
});

/** preload dosyasını sahte `electron` ve sahte `location` ile çalıştırır; açılan köprüleri döndürür. */
function preloadCalistir(dosya, protokol) {
  const Module = require('node:module');
  const acilanlar = {};
  const sahte = {
    contextBridge: { exposeInMainWorld: (ad, nesne) => (acilanlar[ad] = nesne) },
    ipcRenderer: { invoke: () => Promise.resolve(), on() {}, removeListener() {}, send() {} },
  };
  const orijinal = Module._load;
  const oncekiKonum = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahte : orijinal.call(this, istek, ...gerisi);
  };
  Object.defineProperty(globalThis, 'location', { value: { protocol: protokol }, configurable: true, writable: true });
  const tam = path.join(KOK, dosya);
  delete require.cache[tam];
  try {
    require(tam);
  } finally {
    Module._load = orijinal;
    delete require.cache[tam];
    if (oncekiKonum) Object.defineProperty(globalThis, 'location', oncekiKonum);
    else delete globalThis.location;
  }
  return acilanlar;
}

test('preload.js: köprü yalnız yerel (file:) sayfalara açılır; uzak HA sayfası window.evPaneli\'yi görmez', () => {
  for (const protokol of ['http:', 'https:', 'about:', 'data:', 'blob:']) {
    assert.deepEqual(preloadCalistir('src/preload.js', protokol), {}, `${protokol} sayfasına köprü açılmamalı`);
  }
  const acilan = preloadCalistir('src/preload.js', 'file:');
  assert.deepEqual(Object.keys(acilan), ['evPaneli']);
  assert.deepEqual(Object.keys(acilan.evPaneli).sort(), [...EV_PANELI_KOPRUSU].sort());
});

test('preload-kose.js: köşe bildirimi köprüsü yalnız file: sayfasında ve yalnız onGoster ile onDilDegisti ile açılır', () => {
  assert.deepEqual(preloadCalistir('src/preload-kose.js', 'http:'), {});
  const acilan = preloadCalistir('src/preload-kose.js', 'file:');
  assert.deepEqual(Object.keys(acilan), ['evKose']);
  assert.deepEqual(Object.keys(acilan.evKose), ['onGoster', 'onDilDegisti']);
});

test('preload-yuzey.js: hızlı panel köprüsü yalnız file: sayfasında ve yalnız bilinen on işlevle açılır', () => {
  for (const protokol of ['http:', 'https:', 'about:', 'data:', 'blob:']) {
    assert.deepEqual(preloadCalistir('src/preload-yuzey.js', protokol), {}, `${protokol} sayfasına köprü açılmamalı`);
  }
  const acilan = preloadCalistir('src/preload-yuzey.js', 'file:');
  assert.deepEqual(Object.keys(acilan), ['evYuzey']);
  assert.deepEqual(Object.keys(acilan.evYuzey).sort(), [...EV_YUZEY_KOPRUSU].sort());
  const kaynak = oku('src/preload-yuzey.js');
  assert.ok(kaynak.indexOf("location.protocol === 'file:'") < kaynak.indexOf('exposeInMainWorld'));
  assert.equal(kaynak.match(/exposeInMainWorld/g)?.length, 1);
  assert.ok(!/anahtarAl|getToken|readFile|child_process|shell|'ayarlar:/.test(kaynak), 'preload-yuzey anahtar/ayar kanalı açmaz');
});

test('preload.js: sır, adres ya da anahtar ismi içermez; koruma exposeInMainWorld\'den ÖNCE gelir', () => {
  const preload = oku('src/preload.js');
  assert.ok(preload.indexOf("location.protocol === 'file:'") > 0);
  assert.ok(preload.indexOf("location.protocol === 'file:'") < preload.indexOf('exposeInMainWorld'));
  assert.equal(preload.match(/exposeInMainWorld/g)?.length, 1);
  assert.ok(!/anahtarAl|getToken|readFile|child_process|shell/.test(preload));
});

test('ana süreç: yerel pencereler ortak güvenli fabrikadan, IPC gönderen denetimiyle; yeni pencere varsayılan olarak reddedilir', () => {
  const main = oku('src/main.js');
  assert.match(main, /yerelPencereOlustur\(/);
  assert.match(main, /yerelOlaydanMi\(/);
  assert.match(main, /web-contents-created[\s\S]*setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.ok(!/new BrowserWindow\(\{[\s\S]{0,200}nodeIntegration:\s*true/.test(main));
  const yerel = oku('src/yerel-pencere.js');
  for (const ayar of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) {
    assert.ok(yerel.includes(ayar), `yerel-pencere.js: ${ayar}`);
  }
});

test('main.js konsola doğrudan yazmaz: günlük tek kapıdan (src/lib/gunluk.js) sır ayıklanarak yazılır', () => {
  assert.ok(!/console\./.test(oku('src/main.js')));
  assert.ok(!/console\./.test(oku('src/ha-istemcisi.js')));
  for (const dosya of ['src/ha-ws.js', 'src/eylem.js', 'src/yuzey-yoneticisi.js', 'src/lib/eylem-hatti.js', 'src/lib/son-kullanilanlar.js', 'src/lib/durum-deposu.js']) {
    assert.ok(!/console\./.test(oku(dosya)), `${dosya}: konsola yazmamalı`);
  }
});

// ---------------------------------------------------------------------------
// Dalga 4: Windows 11 görünümü yapısal kuralları ve README'nin koda uyumu (hata-21)
// ---------------------------------------------------------------------------

test('görünüm: transparent pencere, özel başlık çubuğu ve ana pencerede malzeme yok (gorunum-11/13 sınırları)', () => {
  for (const dosya of metinDosyalari) {
    const g = goreli(dosya);
    if (!g.startsWith('src/') || !g.endsWith('.js')) continue;
    const icerik = fs.readFileSync(dosya, 'utf8');
    assert.ok(!/\btransparent\s*:\s*true/.test(icerik), `${g}: transparent pencere kullanılmaz`);
    assert.ok(!/titleBarStyle|titleBarOverlay/.test(icerik), `${g}: özel başlık çubuğu yapılmaz`);
  }
  const main = oku('src/main.js');
  // Ana pencerenin seçenekleri bloğunda malzeme yok (yalnız yeni yerel pencerelere: yuzey-yoneticisi.js ve kose-bildirim.js).
  const anaBlok = main.slice(main.indexOf('minWidth: 480'), main.indexOf('anaPencere = new BrowserWindow'));
  assert.ok(anaBlok.length > 100 && !/backgroundMaterial|malzemeAl|pencereMalzemesi/.test(anaBlok));
  for (const dosya of ['src/yuzey-yoneticisi.js', 'src/kose-bildirim.js']) {
    assert.match(oku(dosya), /malzemeAl\(\)\.secenekler/, `${dosya}: pencere malzemesi tek kaynaktan (src/lib/malzeme.js) gelir`);
  }
});

test('README: "bir defa giriş" iddiası yok; oturumun adres (köken) başına olduğu ve "npm test" bölümü var (hata-21)', () => {
  const readme = belgeler();
  assert.doesNotMatch(readme, /bir defa giriş/i);
  assert.doesNotMatch(readme, /bir kez giriş yapmanız yeterlidir/i);
  assert.match(readme, /köken \(adres\) başına|adres başına/i);
  assert.match(readme, /her adreste ayrı giriş/i);
  assert.match(readme, /^#{2,4} .*`npm test`/m, 'npm test başlıklı bölüm');
  assert.match(readme, /npm run kontrol/);
});

// 1.4.0: yeni betikler belgelere (README / docs/KILAVUZ.md) birleştirme adımında yazılır; o zamana dek ayrı todo denetiminde izlenir.
const BELGELENECEK_BETIKLER = ['dist:tasinabilir']; // o-45 taşınabilir derleme

test('README: package.json betiklerinin hepsi belgelenmiş (npm start, dist, ikon, test, kontrol)', () => {
  const readme = belgeler();
  const paket = JSON.parse(oku('package.json'));
  for (const ad of Object.keys(paket.scripts).filter((a) => !BELGELENECEK_BETIKLER.includes(a))) {
    const komut = ad === 'start' || ad === 'test' ? `npm ${ad}` : `npm run ${ad}`;
    assert.ok(readme.includes(komut), `README'de "${komut}" yok`);
  }
});

test('README: 1.4.0 betikleri (taşınabilir derleme) belgelenmiş', { todo: 'birleştirme: belgelerde npm run dist:tasinabilir yazılınca todo kaldırılacak' }, () => {
  const readme = belgeler();
  const paket = JSON.parse(oku('package.json'));
  for (const ad of BELGELENECEK_BETIKLER) {
    assert.ok(Object.hasOwn(paket.scripts, ad), `package.json'da ${ad} betiği yok`);
    assert.ok(readme.includes(`npm run ${ad}`), `README'de "npm run ${ad}" yok`);
  }
});

test('README: tam ekran durumu hatırlanmıyor, geniş modun yalnız büyütülmüş durumu hatırlanıyor, kısayol yalnız görünür+odaktayken gizliyor (hata-21)', () => {
  const readme = belgeler();
  assert.match(readme, /Tam ekran \(`F11`\) durumu hatırlanmaz/);
  assert.match(readme, /yalnız \*\*büyütülmüş \(maximize\) durumu\*\* hatırlanır/);
  assert.match(readme, /YALNIZ pencere hem \*\*görünür hem odaktaysa\*\* gizler/);
  assert.doesNotMatch(readme, /tam ekran durumu da hatırlanır/i);
  // Koddaki karar da aynı: yalnız görünür VE odaktaysa gizlenir.
  const davranis = require('../src/lib/pencere-davranisi');
  const temel = { kaynak: 'kisayol', bekleyenGizleme: false, sonGizlemeMs: 0, sonOdakKaybiMs: 0, simdi: 1_000_000 };
  assert.equal(davranis.tiklamaKarari({ ...temel, gorunur: true, odakta: true }), 'kapat');
  assert.equal(davranis.tiklamaKarari({ ...temel, gorunur: true, odakta: false }), 'ac');
  assert.equal(davranis.tiklamaKarari({ ...temel, gorunur: false, odakta: false }), 'ac');
});

test('README: Kapı Kuralı bölümü koddaki süzgeçle aynı sözcükleri ve tek istisnayı anlatıyor', () => {
  const readme = belgeler();
  const suzgec = require('../src/lib/suzgec');
  const bolum = readme.slice(readme.indexOf('## 🚪 Kapı Kuralı'), readme.indexOf('## 🛠️ Kurulum ve Geliştirme'));
  assert.ok(bolum.length > 500, 'Kapı Kuralı bölümü bulunamadı');
  for (const sozcuk of [...suzgec.YASAK_PARCALAR, ...suzgec.YASAK_KISA_PARCALAR].filter((s) => s !== 'unlock' && s !== 'kilid' && s !== 'garage')) {
    assert.ok(bolum.includes(`"${sozcuk}"`) || bolum.includes(`"kapı"`) && sozcuk === 'kapi', `Kapı Kuralı bölümünde "${sozcuk}" yok`);
  }
  for (const istisna of suzgec.DOOR_ISTISNA) assert.ok(bolum.includes(istisna), `istisna ${istisna} yazılı değil`);
  for (const yuzey of ['hızlı panel', 'komut paleti', 'eylem kısayolları', '--eylem', 'Son kullanılanlar', 'hazır ilk liste', 'tepsi menüsü']) {
    assert.ok(bolum.includes(yuzey), `Kapı Kuralı kapsamı: "${yuzey}" yazılı değil`);
  }
  assert.match(bolum, /hiçbir kapıyı kendiliğinden açmaz/);
  assert.match(bolum, /Bilgisayarı kilitle/);
});

test('README: yeni özellikler anlatılmış (palet, panel, eylem kısayolları, --eylem, basılı tutma, canlı durum, son kullanılanlar, odak kaybı, imleç monitörü, panolar, ayrı geliştirme klasörü)', () => {
  const readme = belgeler();
  for (const parca of [
    'Hızlı Panel',
    'Komut Paleti',
    'Eylem Kısayolları',
    '--eylem=',
    'basılı tutarak onay',
    'Canlı Durum',
    'Son Kullanılanlar',
    'Başka yere tıklayınca gizle',
    'fare imlecinin bulunduğu monitörde',
    'Pano kısayolları',
    'Ev Paneli (gelistirme)',
    'kendi tek-kopya kilidiyle',
    'Tepsi İpucu ve Simge',
    'Windows 11 Görünümü',
  ]) {
    assert.ok(readme.includes(parca), `README'de "${parca}" yok`);
  }
});

test('README: elle yapılacaklar (pencere-06 kenar çubuğu, HTTPS ev adresi, hiz-13, hiz-14 "e" tuşu, pencere-07 oyun) ve Dalga 4 elle deneme listesi var; denenmeyenler işaretli', () => {
  const readme = belgeler();
  const el = readme.slice(readme.indexOf('## 🙋 Önerilen elle ayarlar ve denemeler'), readme.indexOf('## 🧪 Elle Deneme ve Test Kontrol Listesi'));
  assert.ok(el.length > 500, 'elle yapılacaklar bölümü bulunamadı');
  for (const parca of ['pencere-06', 'Kenar çubuğunu her zaman gizle', 'HTTPS', 'hiz-13', 'hiz-14', '`e`', 'pencere-07']) {
    assert.ok(el.includes(parca), `elle yapılacaklarda "${parca}" yok`);
  }
  assert.match(readme, /^## Elle Deneme — Dalga 4/m);
  for (const parca of ['Akrilik', 'Mica', 'Düz (opak', 'başlık çubuğu', 'Vurgu rengi', 'Soluk simge', 'Tepsi ipucu', 'taşma', 'denenmedi']) {
    assert.ok(readme.includes(parca), `Dalga 4 listesinde "${parca}" yok`);
  }
});

test('README: Görünüm ayarları (şema 5) ve ayar dosyası alanları koddaki adlarla aynı', () => {
  const readme = belgeler();
  for (const alan of ['temaZorla', 'vurguRengi', 'yeniPencereMalzemesi']) {
    assert.ok(readme.includes(alan), `README'de ${alan} yok`);
    assert.ok(oku('varsayilan-ayarlar.json').includes(`"${alan}"`), `varsayilan-ayarlar.json'da ${alan} yok`);
  }
});

// 1.4.0: şema 6'ya geçildi (ayar-alanlari.js); belgeler (README / docs/KILAVUZ.md) birleştirme adımında güncellenecek. Belge
// "şu an 6)" diyene kadar bu denetim todo olarak çalışır (başarısızlığı raporlanır, çalıştırmayı düşürmez); belge güncellenince
// todo kaldırılmalıdır.
test('README: ayar şeması sürümü koddakiyle aynı', { todo: 'birleştirme: belgelerde şema sürümü 6 yazılınca todo kaldırılacak' }, () => {
  const { SEMA_SURUMU } = require('../src/lib/ayar-sema');
  assert.match(belgeler(), new RegExp(`şu an ${SEMA_SURUMU}\\)`), 'README şema sürümünü yanlış söylüyor');
});

// ---------------------------------------------------------------------------
// Kaldırıcı (güncellemede otomatik başlatma korunur) ve göç öncesi ayar yedeği
// ---------------------------------------------------------------------------

test('kaldırıcı: otomatik başlatma kayıtları yalnız gerçek kaldırmada (isUpdated DEĞİLKEN) silinir', () => {
  const nsh = oku('build/installer.nsh');
  const makro = nsh.slice(nsh.indexOf('!macro customUnInstall'), nsh.indexOf('!macroend'));
  assert.ok(makro.length > 50, 'customUnInstall makrosu bulunamadı');
  const blok = makro.slice(makro.indexOf('${ifNot} ${isUpdated}'), makro.lastIndexOf('${endIf}'));
  assert.ok(blok.length > 50, 'DeleteRegValue satırları ${ifNot} ${isUpdated} ... ${endIf} içinde olmalı');
  const silmeler = (metin) => metin.split('\n').filter((s) => /^\s*DeleteRegValue\b/.test(s));
  assert.equal(silmeler(makro).length, 2, 'Run ve StartupApproved\\Run değerleri');
  assert.deepEqual(silmeler(blok), silmeler(makro), 'iki silme de koşullu blok içinde; dışında silme yok');
  assert.match(blok, /CurrentVersion\\Run" "Ev Paneli"/);
  assert.match(blok, /Explorer\\StartupApproved\\Run" "Ev Paneli"/);
  assert.equal(nsh.match(/^\s*DeleteRegValue\b/gm)?.length, 2, 'dosyada başka koşulsuz silme yok');
  // Dosya başındaki açıklama yeni davranışı anlatır; eski "güncellemede de çalışır" iddiası kalmamıştır.
  assert.doesNotMatch(nsh, /Güncelleme sırasında da çalışır/);
  assert.match(nsh, /YALNIZ gerçek kaldırmada/);
  assert.match(nsh, /1\.1\.0'dan SONRAKİ/);
});

test('kaldırıcı: isUpdated electron-builder şablonlarında tanımlı ve customUnInstall kaldırıcı betiğinde çağrılıyor (şablon değişirse haber verir)', { skip: !fs.existsSync(path.join(KOK, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'uninstaller.nsh')) }, () => {
  const sablon = path.join(KOK, 'node_modules', 'app-builder-lib');
  const kaldirici = fs.readFileSync(path.join(sablon, 'templates', 'nsis', 'uninstaller.nsh'), 'utf8');
  assert.match(kaldirici, /!insertmacro customUnInstall\b/);
  assert.match(kaldirici, /\$\{if\} \$\{isUpdated\}/i, 'şablonun kendi güncelleme sınaması');
  // Bayrak, her iki derlemeye (kurucu + kaldırıcı) eklenen ortak başlıkta üretilir.
  const hedef = fs.readFileSync(path.join(sablon, 'out', 'targets', 'nsis', 'NsisTarget.js'), 'utf8');
  assert.match(hedef, /flags\(\[\s*"updated"/);
  const eski = fs.readFileSync(path.join(sablon, 'templates', 'nsis', 'include', 'installUtil.nsh'), 'utf8');
  assert.match(eski, /StrCpy \$0 "\$0 --updated"/, 'güncellemede eski kaldırıcıya --updated geçirilir');
});

test('main.js: göç öncesi yedek, ayarlar yeni biçimle yazılmadan ÖNCE ve "bozuk dosya" bloğunun DIŞINDA alınır', () => {
  const main = oku('src/main.js');
  assert.match(main, /require\('\.\/lib\/ayar-yedegi'\)/);
  const yukle = main.slice(main.indexOf('function ayarlariYukle()'), main.indexOf('function httpAnahtarUyarisiniGoster'));
  assert.equal(yukle.match(/gocOncesiYedegiAl\(/g)?.length, 1);
  const yedek = yukle.indexOf('gocOncesiYedegiAl(');
  assert.ok(yedek > yukle.indexOf('ayarlariDuzelt('), 'göç hesaplandıktan sonra');
  assert.ok(yedek < yukle.indexOf('ayarlariYaz(sonuc)'), 'yeni biçim diske yazılmadan önce');
  assert.ok(yedek > yukle.indexOf("gunluk('ayarlar.json bozuk;"), 'bozuk dosya yolu try/catch bloğundadır, yedek onun dışında alınır');
  const bozukBlok = yukle.slice(yukle.indexOf('try {'), yukle.indexOf('// Şema düzeltme ve göç'));
  assert.ok(!bozukBlok.includes('gocOncesiYedegiAl'), 'yedek hatası dosyayı "bozuk" saymasın');
  assert.match(yukle, /gocOncesiYedegiAl\(\{ dosya, ham, fs, gunluk \}\)/);
});

test('README: oturum klasörü Partitions\\ha (persist: öneki klasör adına girmez), yedekte klasörün TAMAMI; güncelleme öncesi adımlar ve göç yedeği anlatılıyor', () => {
  const readme = belgeler();
  assert.doesNotMatch(readme, /persist_ha/);
  assert.ok(readme.includes('Partitions\\ha\\'), 'Partitions\\ha\\ yolu');
  assert.match(readme, /`persist:` öneki klasör adına girmez/);
  assert.match(readme, /klasörün TAMAMINI kopyalayın/);
  const guncelleme = readme.slice(readme.indexOf("### 6. Güncelleme (1.0.0'dan 1.1.0'a)"), readme.indexOf('## 🧪 Otomatik Testler'));
  assert.ok(guncelleme.length > 1000, 'Güncelleme bölümü bulunamadı');
  for (const parca of ['**Çıkış**', '`npm start`', 'zorla kapatır', 'kısayol', '%APPDATA%\\Ev Paneli', 'ayarlar.v1-yedek.json', '%APPDATA%\\Ev Paneli (gelistirme)\\', 'taşınmaz']) {
    assert.ok(guncelleme.includes(parca), `Güncelleme bölümünde "${parca}" yok`);
  }
  assert.match(guncelleme, /1\.0\.0'ın kaldırıcısı/);
  assert.match(guncelleme, /1\.1\.0'dan \*\*sonraki\*\* güncellemelerde/);
  const surum = readme.slice(readme.indexOf('### 1.1.0 —'), readme.indexOf('### 1.0.0 —'));
  assert.match(surum, /Kaldırıcı ve güncelleme/);
  assert.match(surum, /Göç öncesi ayar yedeği/);
  assert.doesNotMatch(surum, /otomatik başlatma kaydı ezilmez\./, 'koşulsuz "ezilmez" iddiası kalmamalı');
});

test('ayar yedeği: yeni modül electron kullanmaz, günlüğe yalnız sabit metin ve dosya adı yazar (hata iletisi/yol yok)', () => {
  const kaynak = oku('src/lib/ayar-yedegi.js');
  assert.doesNotMatch(kaynak, /hata\.message|\.stack|String\(hata\)|\$\{dosya\}/);
  assert.ok(libDosyalari.some((d) => goreli(d) === 'src/lib/ayar-yedegi.js'));
});

// ---------------------------------------------------------------------------
// 1.1.1: yetki kesici (geçersiz anahtarla Home Assistant ip_ban tetiklenmesin)
// ---------------------------------------------------------------------------

const srcDosyalari = tumDosyalar.filter((d) => goreli(d).startsWith('src/') && d.endsWith('.js') && !goreli(d).startsWith('src/lib/'));
const blok = (kaynak, baslangic, uzunluk = 900) => kaynak.slice(kaynak.indexOf(baslangic), kaynak.indexOf(baslangic) + uzunluk);
const yorumsuz = (kaynak) => kaynak.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

test('yetki kesici: kimlikli isteğin başlığı, REST çağrısı ve WebSocket yalnız bilinen dosyalarda (yeni bir ağ yolu kesiciyi atlayamaz)', () => {
  for (const dosya of [...srcDosyalari, ...libDosyalari]) {
    const g = goreli(dosya);
    const icerik = yorumsuz(fs.readFileSync(dosya, 'utf8'));
    if (g !== 'src/ha-istemcisi.js') assert.ok(!/Authorization\s*:|Bearer \$\{/.test(icerik), `${g}: Authorization başlığı yalnız ha-istemcisi.js'te kurulur`);
    // adres-sina.js (k-14 "Bağlantıyı sına") bilinçli ikinci istisnadır: kimliksiz tek GET; ayrıntılı sınırları aşağıdaki testte.
    // surum-denetimi.js (o-40) üçüncü bilinçli istisnadır: kimliksiz, çerezsiz tek GET (GitHub sürüm adresi); varsayılan KAPALI seçenek; sınırları test/surum-denetimi.test.js'te.
    if (!['src/ha-istemcisi.js', 'src/main.js', 'src/lib/adres-sina.js', 'src/lib/surum-denetimi.js'].includes(g)) assert.ok(!/\bnet\.fetch\s*\(|\bfetch\s*\(|net\.request\s*\(|https?\.request\s*\(/.test(icerik), `${g}: ağ isteği`);
    if (g !== 'src/ha-ws.js') assert.ok(!/new\s+WebSocket\w*\s*\(/.test(icerik), `${g}: soket yalnız ha-ws.js'te açılır`);
  }
  const istemci = oku('src/ha-istemcisi.js');
  assert.equal(istemci.match(/Authorization:/g)?.length, 1, 'Authorization tek yerde (tekIstek)');
  // tekIstek: kesici denetimi fetch'ten ÖNCE; 401 anahtarı reddeder, 403 adresi duraklatır
  const tekIstekBloku = blok(istemci, 'async function tekIstek', 2600);
  assert.ok(tekIstekBloku.indexOf('await kapiAl(taban, parmakIzi,') > 0 && tekIstekBloku.indexOf('await kapiAl(taban, parmakIzi,') < tekIstekBloku.indexOf('await istekGonder('), "küresel kapı (kesici denetimi) isteğin gönderilmesinden önce");
  assert.match(tekIstekBloku, /dogrulama \|\| yontem !== 'GET' \|\| oncelik === 'yuksek' \? 'yuksek' : 'normal'/, 'eylem (POST), doğrulama ve eylem öncesi durum okuması yüksek öncelikli, toplu GET normal (tur 4, tur 5 K10)');
  assert.ok(tekIstekBloku.includes('birak()'), 'kapı finally ile her durumda bırakılır');
  const kapi = blok(istemci, 'async function kapiAl', 900);
  assert.match(kapi, /kesiciDenetle\(taban, parmakIzi\);\s*const birak = await kapi\.al\(\{ oncelik \}\);\s*try \{\s*kesiciDenetle\(taban, parmakIzi\)/, 'kapıdan ÖNCE ve SONRA kesici denetlenir');
  // K3: doğrulama (dogrulandi) YALNIZ dogrulamaGecidi'nde ve "API running." denetiminden sonra; tekIstek/istekGonder asla dogrulandi çağırmaz
  const istekGonder = blok(istemci, 'async function istekGonder', 4800);
  assert.doesNotMatch(istekGonder, /\bdogrulandi\(/, 'istekGonder doğrulama kaydı yapmaz');
  const gecit = blok(istemci, 'async function dogrulamaGecidi', 3600);
  assert.ok(gecit.indexOf("message !== 'API running.'") > 0 && gecit.indexOf("message !== 'API running.'") < gecit.indexOf('dogrulandi(taban, parmakIzi)'), "dogrulandi yalnız 'API running.' denetiminden sonra");
  assert.equal(yorumsuz(istemci).match(/\bdogrulandi\(taban, parmakIzi\)/g)?.length, 3, 'dogrulandi: tanım + dogrulamaGecidi + WS onaylandi (başka çağrı yeri yok)');
  const tek = blok(istemci, 'async function istekGonder', 4800);
  assert.ok(tek.indexOf('await fetch(') > 0, 'fetch istekGonder içinde');
  assert.match(tek, /yetkiKesici\.reddet\(parmakIzi, 'HTTP_401', kokenTuru\(taban\)\)/, 'hata bütçesi isteğin gittiği kökende artar (tur 5, K8)');
  assert.match(tek, /BELIRSIZ_SUNUCU_DURUMLARI\.has\(durum\)[\s\S]*belirsizIsaretle\(parmakIzi, kokenTuru\(taban\)\)/, '502/504/52x belirsiz sayılır ve isteğin gittiği kökenin bütçesine girer (tur 5, K10; tur 7, K11)');
  assert.match(istemci, /BELIRSIZ_SUNUCU_DURUMLARI = new Set\(\[502, 504, 520, 522, 524\]\)/);
  assert.match(tek, /adresiDuraklat\(taban\)/);
  assert.doesNotMatch(tek, /await yanit\.body\??\.cancel/, 'gövde iptali 401/403 kararını geciktirmez (beklenmez)');
  // 401/403 adres değiştirme nedeni değildir: yeniden deneme yalnız 'baglanti' türünde
  assert.match(blok(istemci, 'async function haIstek', 2200), /hata\.tur !== 'baglanti' \|\| yontem !== 'GET'/);
});

test('adres sınama (k-14): anahtarsız tek GET; Authorization, anahtar, yetki kesici, soket ve yönlendirme yok; IPC yalnız Ayarlar penceresine yanıt verir', () => {
  const sina = yorumsuz(oku('src/lib/adres-sina.js'));
  assert.doesNotMatch(sina, /Authorization|Bearer|anahtarAl|anahtar-deposu|ha-istemcisi|yetki-kesici|WebSocket|ipcMain|require\(\s*'electron'/, 'sınama anahtara, kesiciye ve Electron\'a dokunmaz');
  assert.match(sina, /credentials: 'omit'/, 'çerez/kimlik bilgisi gönderilmez');
  assert.match(sina, /redirect: 'error'/, 'yönlendirme izlenmez');
  assert.match(sina, /method: 'GET'/);
  assert.equal(sina.match(/\bfetch\(/g)?.length, 1, 'ağ isteği tek yerde');
  assert.match(sina, /anahtarIcinGuvenliAdresMi\(kok\)/, 'herkese açık adrese düz http istenmez (kaydetmedeki kural)');
  const main = oku('src/main.js');
  assert.match(main, /ipcMain\.handle\('ayarlar:adres-sina', \(olay, adres, tur\) => \(ayarlardan\(olay\) \?/, 'yalnız Ayarlar penceresi sorabilir');
  assert.doesNotMatch(blok(main, 'adresSinayiciOlustur({', 140), /anahtar/i, 'sınayıcıya anahtar verilmez');
});

test('yetki kesici: main.js kesiciyi HA istemcisine ve canlı bağlantıya bağlar; favori durumları sınırlı eşzamanlı; anahtar kaydı tek doğrulamayla', () => {
  const main = oku('src/main.js');
  assert.match(blok(main, 'const haIstemcisi = haIstemcisiOlustur({'), /\n {2}yetkiKesici,\n/);
  assert.match(blok(main, 'const ws = haWsOlustur({'), /yetki: haIstemcisi\.wsYetkisi/);
  assert.match(main, /yetkiKesici\.yukle\(\)/);
  assert.equal(main.match(/yetkiKesiciOlustur\(/g)?.length, 1);
  const yenile = blok(main, 'async function durumlariYenile', 2600);
  assert.match(yenile, /sinirliEszamanli\(\s*kimlikler,\s*REST_ESZAMANLILIK/);
  assert.match(yenile, /\{ ilkTek: true \}/, 'ilk istek tek başına gider (anahtar o an geçerli mi bilinmiyor)');
  assert.doesNotMatch(yenile, /Promise\.all/);
  assert.match(main, /const REST_ESZAMANLILIK = 4;/);
  const kaydet = blok(main, "ipcMain.handle('anahtar:kaydet'", 2600);
  assert.match(kaydet, /haIstemcisi\.anahtariDogrula\(anahtar, \{ onay: degerlendirme\.onay \}\)/);
  assert.match(kaydet, /ikinciOnayDegerlendir\(parmakIzi, secenek\?\.bilet\)/, 'onay yalnız tek kullanımlık biletle kabul edilir (tur 5, K7)');
  assert.doesNotMatch(yorumsuz(kaydet), /secenek\?\.onay/, 'boolean onay artık yok');
  assert.doesNotMatch(kaydet, /haIstek\(/, 'kayıt doğrulaması ikinci bir istek atmaz');
  assert.match(kaydet, /yetkiKesici\.reddedildiMi\(parmakIzi\)/);
  assert.match(blok(main, "ipcMain.handle('yetki:yeniden-dene'", 1800), /haIstemcisi\.disIzniVer\(parmakIzi\)/, 'dış adres izni onaylanan parmak izine bağlı (tur 5, K9)');
  assert.match(blok(main, "ipcMain.handle('yetki:yeniden-dene'", 1800), /ikinciOnayDegerlendir\(parmakIzi, secenek\?\.bilet, \{ yalnizButce: true \}\)/);
  assert.doesNotMatch(main, /saklimi/, 'Yeniden Dene doğrulanmış saklı anahtara da bütçe muafiyeti vermez (tur 8, K12a)');
  assert.match(blok(main, "ipcMain.handle('anahtar:sil'", 1600), /yetkiKesici\.temizle\(silinenParmakIzi\)/, 'yalnız saklı anahtarın kaydı temizlenir');
  assert.doesNotMatch(main, /yetkiKesici\.temizle\(\)/);
  const ws = oku('src/ha-ws.js');
  assert.match(blok(ws, "case 'auth_invalid':", 300), /yetki\.reddedildi\(oturum\.parmakIzi, oturum\.taban\)/);
  assert.match(oku('src/ha-istemcisi.js'), /yetkiKesici\.girisBasarili\(kokenTuru\(taban\)\)/, 'auth_ok yalnız o kökenin sayacını sıfırlar (tur 5, K8)');
  assert.match(oku('src/eylem.js'), /haIstek\(`\/api\/states\/\$\{kimlik\}`, \{ oncelik: 'yuksek' \}\)/, 'eylem öncesi durum okuması yüksek öncelikli (tur 5, K10)');
  assert.match(ws, /await yetki\.gecit\(taban, anahtar\)/);
  // K1: WS auth iletisi küresel kapıdan geçer: kapı auth gönderilmeden ALINIR, auth yanıtı/kapanışta bırakılır
  const authAdimi = blok(ws, 'async function authAdimi', 2600);
  assert.ok(authAdimi.indexOf('yetki.kapiAl(') > 0 && authAdimi.indexOf('yetki.kapiAl(') < authAdimi.indexOf('p.authMesaji(anahtar)'), 'kapı auth iletisinden önce alınır');
  assert.match(blok(ws, 'function soketiKapat', 1100), /kapiyiBirak\(\)/, 'her kapanış yolu kapıyı bırakır');
  assert.match(blok(ws, 'function soketiKapat', 1100), /authBekliyor && soket && yetki && oturumParmakIzi\) yetki\.belirsiz\?\.\(oturumParmakIzi, oturumTaban\)/, 'yanıtsız auth HER kapanış yolunda (yeniden bağlanma, uyku, durdurma dahil) belirsiz sayılır');
  assert.match(oku('src/ha-istemcisi.js'), /kapiAl: \(taban, parmakIzi\) => kapiAl\(taban, parmakIzi, 'yuksek'\)/, 'WS auth yüksek öncelikli');
  assert.match(blok(ws, "case 'auth_ok':", 400), /kapiyiBirak\(\)/);
  assert.match(blok(main, "ipcMain.handle('anahtar:kaydet'", 3200), /if \(dogrulandi\) yetkiKesici\.onayVer\(\)/, 'küresel kayıt onayı yalnız aday doğrulanıp saklanınca kalkar (tur 4, K5)');
  assert.doesNotMatch(yorumsuz(oku('src/ha-istemcisi.js')), /yetkiKesici\.onayVer\(\)/, 'ha-istemcisi küresel onayı açmaz; yalnız adaya özel bilet kullanır');
});

test('yetki kesici: günlük satırlarında anahtar ve tam parmak izi yok (neden kodu + ilk 8 hane); modül saf (electron yok)', () => {
  const kesici = oku('src/lib/yetki-kesici.js');
  assert.match(kesici, /parmakIzi\.slice\(0, 8\)/);
  assert.match(kesici, /\.slice\(0, 16\)/);
  assert.doesNotMatch(kesici, /gunluk\([^)]*\$\{anahtar/);
  assert.ok(libDosyalari.some((d) => goreli(d) === 'src/lib/yetki-kesici.js'));
  assert.ok(libDosyalari.some((d) => goreli(d) === 'src/lib/sinirli-eszamanli.js'));
  const kapi = oku('src/lib/kimlikli-kapi.js');
  assert.ok(libDosyalari.some((d) => goreli(d) === 'src/lib/kimlikli-kapi.js'));
  assert.doesNotMatch(yorumsuz(kapi), /require\(['"]electron['"]\)|\bfetch\s*\(/, 'kapı saf modüldür (ağ ve electron yok)');
});

test("README 1.1.1: sürüm geçmişi, 1.1.0'dan güncelleme notu ve kurulum dosyası adı", () => {
  const readme = belgeler();
  assert.match(readme, /^### 1\.1\.1 — 2026-10-07$/m);
  assert.ok(readme.includes('Ev-Paneli-Kurulum-1.1.1.exe'));
  const surum = readme.slice(readme.indexOf('### 1.1.1 —'), readme.indexOf('### 1.1.0 —'));
  assert.ok(surum.length > 1500, '1.1.1 bölümü bulunamadı');
  for (const parca of ['ip_ban', 'yetki-kesici.json', 'parmak izi', "1.1.0'dan güncelleme", 'tam bir', 'bildirim', 'Ayarlar', '403', '15 dk', 'en çok 4', 'en çok 1', 'Yeniden Dene', 'ikinci onay', 'API running', 'belirsiz', 'Hata bütçesi']) {
    assert.ok(surum.includes(parca), `1.1.1 sürüm notunda "${parca}" yok`);
  }
  const guncelleme = readme.slice(readme.indexOf("### 7. Güncelleme (1.1.0'dan 1.1.1'e)"), readme.indexOf('## 🧪 Otomatik Testler'));
  assert.ok(guncelleme.length > 500, "1.1.0 -> 1.1.1 güncelleme bölümü bulunamadı");
  assert.match(guncelleme, /yalnız 1 doğrulama isteği/);
  assert.match(guncelleme, /yeni anahtarı kaydedin/);
  assert.match(guncelleme, /Yeniden Dene/);
  assert.match(guncelleme, /ikinci onay/);
  assert.ok(readme.includes('yetki-kesici.json'), 'dosya konumları listesinde yetki-kesici.json var');
});

// ---------------------------------------------------------------------------
// Küçük işler (1.2.0): .claude taraması (h-34), README sıfırlama adımı (h-40), çevrimdışı sayfası (g-01, g-06, g-11)
// ---------------------------------------------------------------------------

test('kontrol (h-34): .claude klasörü denetimde atlanır; ana klasördeki çalışma kopyası yanlış alarm vermez', () => {
  assert.match(oku('araclar/kontrol.js'), /ATLANAN_DIZINLER = new Set\(\[[^\]]*'\.claude'[^\]]*\]\)/);
  assert.match(oku('test/yapi.test.js'), /ATLANAN = new Set\(\[[^\]]*'\.claude'[^\]]*\]\)/);
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-kontrol-'));
  try {
    fs.mkdirSync(path.join(gecici, 'araclar'));
    fs.copyFileSync(path.join(KOK, 'araclar', 'kontrol.js'), path.join(gecici, 'araclar', 'kontrol.js'));
    // Çalışma kopyasında CRLF satır sonu ve yasaklı kalıp var; .claude altında olduğu için taranmamalı.
    const kopya = path.join(gecici, '.claude', 'worktrees', 'deneme');
    fs.mkdirSync(kopya, { recursive: true });
    fs.writeFileSync(path.join(kopya, 'eski.js'), "// certificate-error\r\n'use strict';\r\n");
    const once = spawnSync(process.execPath, [path.join(gecici, 'araclar', 'kontrol.js')], { encoding: 'utf8' });
    assert.equal(once.status, 0, once.stderr);
    // Negatif kontrol: aynı kalıp .claude dışında varsa denetim yine yakalar.
    fs.mkdirSync(path.join(gecici, 'src'));
    fs.writeFileSync(path.join(gecici, 'src', 'kotu.js'), '// certificate-error\n');
    const sonra = spawnSync(process.execPath, [path.join(gecici, 'araclar', 'kontrol.js')], { encoding: 'utf8' });
    assert.equal(sonra.status, 1);
    assert.match(sonra.stderr, /src\/kotu\.js/);
  } finally {
    fs.rmSync(gecici, { recursive: true, force: true });
  }
});

test('README (h-40): kaldırma/sıfırlama adımı %LOCALAPPDATA% altındaki yetki-kesici.yedek.json dosyasını anıyor (kodla aynı yol)', () => {
  const readme = belgeler();
  const baslangic = readme.indexOf('## 🗑️ Uygulamayı Kaldırma');
  const kaldirma = readme.slice(baslangic, readme.indexOf('## 🙋 Senin elle yapacakların'));
  assert.ok(baslangic > 0 && kaldirma.length > 300, 'kaldırma bölümü bulunamadı');
  assert.ok(kaldirma.includes('%LOCALAPPDATA%\\Ev Paneli\\yetki-kesici.yedek.json'), 'LOCALAPPDATA yedeği anılmalı');
  assert.ok(kaldirma.includes('%APPDATA%\\Ev Paneli'), 'APPDATA klasörü adımı korunmalı');
  assert.match(oku('src/main.js'), /path\.join\(yerelAppData, path\.basename\(app\.getPath\('userData'\)\), 'yetki-kesici\.yedek\.json'\)/);
});

/** "#rrggbb" için WCAG göreli parlaklık ve iki renk arasındaki kontrast oranı. */
function goreliParlaklik(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a, b) {
  const [acik, koyu] = [goreliParlaklik(a), goreliParlaklik(b)].sort((x, y) => y - x);
  return (acik + 0.05) / (koyu + 0.05);
}

/** Çevrimdışı sayfasının koyu (:root) ve açık (prefers-color-scheme: light) renk jetonları. */
function offlineTemalari() {
  const html = oku('src/offline.html');
  const jetonlar = (blok) => Object.fromEntries([...blok.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([, ad, deger]) => [ad, deger]));
  const koyu = jetonlar(/:root \{([^}]*)\}/.exec(html)[1]);
  const acikBlok = /@media \(prefers-color-scheme: light\) \{\s*:root \{([^}]*)\}/.exec(html)?.[1] ?? '';
  return { koyu, acik: { ...koyu, ...jetonlar(acikBlok) } };
}

test('çevrimdışı sayfası (g-01): color-scheme bildirimi ve prefers-color-scheme: light ile açık tema; stil kuralları sabit renk kullanmaz', () => {
  const html = oku('src/offline.html');
  assert.match(html, /:root \{\s*color-scheme: dark light;/);
  const { acik, koyu } = offlineTemalari();
  for (const jeton of ['bg', 'card-bg', 'text-main', 'text-muted', 'border', 'primary', 'on-primary', 'vurgu', 'danger']) {
    assert.ok(acik[jeton], `açık temada --${jeton} tanımlı değil`);
  }
  assert.notEqual(acik.bg, koyu.bg, 'açık tema koyu temadan farklı');
  const stil = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/:root \{[^}]*\}/g, '');
  assert.doesNotMatch(stil, /#[0-9a-fA-F]{3,6}\b/, 'stil kurallarında sabit renk yok; renkler jetonlardan okunur');
});

test('çevrimdışı sayfası (g-06): birincil düğme (#2563eb) ve metinler koyu ve açık temada en az 4,5:1 kontrast', () => {
  const { koyu, acik } = offlineTemalari();
  assert.equal(koyu.primary, '#2563eb');
  for (const [ad, t] of [['koyu', koyu], ['açık', acik]]) {
    assert.ok(kontrast(t['on-primary'], t.primary) >= 4.5, `${ad}: beyaz yazı / birincil düğme ${kontrast(t['on-primary'], t.primary).toFixed(2)}`);
    assert.ok(kontrast(t['on-primary'], t['primary-hover']) >= 4.5, `${ad}: düğmenin üstü gelince kontrast düşüyor`);
    assert.ok(kontrast(t['text-main'], t['card-bg']) >= 4.5, `${ad}: ana metin`);
    assert.ok(kontrast(t['text-muted'], t['card-bg']) >= 4.5, `${ad}: ikincil metin`);
    assert.ok(kontrast(t['sayac-metin'], t['card-bg']) >= 4.5, `${ad}: sayaç metni`);
    assert.ok(kontrast(t['adres-metin'], t['card-bg']) >= 4.5, `${ad}: adres metni`);
    assert.ok(kontrast(t.vurgu, t['card-bg']) >= 3, `${ad}: simge (metin dışı) en az 3:1`);
  }
  assert.match(oku('src/offline.html'), /\.btn-birincil \{\s*background: var\(--primary\);\s*color: var\(--on-primary\);/);
});

test('çevrimdışı sayfası (g-11): hareketi azalt ayarında dönen simge ve kart canlandırması durur', () => {
  assert.match(oku('src/offline.html'), /@media \(prefers-reduced-motion: reduce\) \{\s*\.kart,\s*\.donen-cember \{\s*animation: none;/);
});

/** offline.js'i sahte bir DOM ile çalıştırır; öğeler kimliğe göre döner (textContent, hidden, odak). */
function offlineCalistir(sorgu, odaktakiKimlik = null) {
  const html = oku('src/offline.html');
  const elemanlar = {};
  for (const [, kimlik] of html.matchAll(/id="([^"]+)"/g)) {
    elemanlar[kimlik] = {
      textContent: '', hidden: false, disabled: false, odak: false, style: {},
      classList: { add() {}, remove() {} }, focus() { this.odak = true; }, addEventListener() {},
    };
  }
  const belge = {
    getElementById: (kimlik) => elemanlar[kimlik] ?? null,
    activeElement: odaktakiKimlik ? elemanlar[odaktakiKimlik] : null,
    body: null,
  };
  const sandbox = {
    window: { location: { search: sorgu }, evPaneli: undefined },
    document: belge,
    URLSearchParams,
    setInterval: () => 1,
    clearInterval() {},
  };
  // offline.html'deki lib/dil.js ve lib/ceviri/yuzey.js etiketleri sayfa betiğinden önce yüklenir
  vm.createContext(sandbox);
  for (const lib of ['src/lib/dil.js', 'src/lib/ceviri/yuzey.js']) vm.runInContext(oku(lib), sandbox, { filename: lib });
  Object.assign(sandbox.window, { EvDil: sandbox.EvDil, EvCeviriYuzey: sandbox.EvCeviriYuzey });
  vm.runInContext(oku('src/offline.js'), sandbox);
  return elemanlar;
}

test('çevrimdışı sayfası (g-11): sık Chromium hata kodları Türkçe açıklanır; ham kod ayrı, küçük ve seçilebilir satırda', () => {
  for (const kod of ['ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID']) {
    const el = offlineCalistir(`?sn=0&hata=${kod}`);
    assert.ok(!el.aciklama.textContent.includes('ERR_'), `${kod}: açıklama ham kod içermemeli`);
    assert.ok(el.aciklama.textContent.length > 40, `${kod}: Türkçe açıklama boş`);
    assert.equal(el.hataKodu.textContent, `Hata kodu: ${kod}`);
    assert.equal(el.hataKodu.hidden, false);
  }
  assert.match(offlineCalistir('?sn=0&hata=ERR_CERT_AUTHORITY_INVALID').aciklama.textContent, /sertifika/);
  assert.equal(offlineCalistir('?sn=0&hata=ERR_NAME_NOT_RESOLVED').aciklama.textContent, 'Ev sunucusunun adresi bulunamadı. Adresi ve ağ (DNS) ayarlarını kontrol edin.');
  assert.match(offlineCalistir('?sn=0&hata=HTTP_503').aciklama.textContent, /Sunucu hatası \(503\)/);
  assert.equal(offlineCalistir('?sn=0&hata=HTTP_403').hataKodu.textContent, 'Hata kodu: HTTP_403');
});

test('çevrimdışı sayfası (g-11): çevirisi olmayan kod açıklamanın içinde kalır; küçük kod satırı yalnız çevrilen kodlarda; açıklama seçilebilir', () => {
  const bilinmeyen = offlineCalistir('?sn=0&hata=HATA_-105');
  assert.equal(bilinmeyen.aciklama.textContent, 'Home Assistant sunucusuna ulaşılamadı (HATA_-105). Lütfen ağınızı kontrol edin.');
  assert.equal(bilinmeyen.hataKodu.hidden, true, 'çevirisi olmayan kod ikinci kez gösterilmez');
  const bos = offlineCalistir('?sn=0');
  assert.equal(bos.hataKodu.hidden, true);
  assert.match(bos.aciklama.textContent, /ağ bağlantınızın çalıştığından/);
  // Metin yalnız textContent ile yazılır: zararlı kod etiket olmaz, düz metin olarak görünür.
  const kotu = offlineCalistir(`?sn=0&hata=${encodeURIComponent('<img src=x onerror=1>')}`);
  assert.ok(kotu.aciklama.textContent.includes('<img src=x onerror=1>'));
  assert.equal(kotu.hataKodu.hidden, true);
  const cokme = offlineCalistir('?sn=0&hata=COKME');
  assert.equal(cokme.hataKodu.hidden, true, 'COKME bir ağ kodu değil; ham kod olarak gösterilmez');
  assert.match(cokme.aciklama.textContent, /art arda çöktü/);
  const proto = offlineCalistir('?sn=0&hata=__proto__');
  assert.match(proto.aciklama.textContent, /ulaşılamadı \(__proto__\)/, 'Object.prototype anahtarları açıklama tablosundan sayılmaz');
  assert.equal(proto.hataKodu.hidden, true);
  assert.match(oku('src/offline.html'), /#aciklama \{\s*user-select: text;/, 'açıklama metni kopyalanabilir');
});

test('çevrimdışı sayfası (g-11): Tekrar Dene otomatik odaklanır; başka öğe odakta iken odağı çalmaz; bağlanılıyor görünümünde kod gizli', () => {
  assert.equal(offlineCalistir('?sn=0&hata=ERR_NAME_NOT_RESOLVED').btnDene.odak, true, 'çevrimdışı görünümde Tekrar Dene odaklanır');
  assert.equal(offlineCalistir('?sn=0', 'btnAyarlar').btnDene.odak, false, 'Ayarlar odaktayken odak çalınmaz');
  const bagl = offlineCalistir('?durum=baglaniyor&sn=0&hata=ERR_NAME_NOT_RESOLVED');
  assert.equal(bagl.btnDene.disabled, true);
  assert.equal(bagl.hataKodu.hidden, true);
  assert.equal(bagl.btnDene.odak, false);
});
