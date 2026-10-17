'use strict';

/**
 * Bağlantı katmanı (o-55..o-58) yapısal güvenceleri. Hiçbir şey çalıştırılmaz; yalnız kaynak dosyalar okunur.
 * Amaç: sertifika doğrulamasının sessizce gevşetilememesi, özel üstbilgilerin yeni bir yoldan sızamaması,
 * saf modüllerin Electron'a bağlanmaması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const SRC = path.join(KOK, 'src');

function jsDosyalari(dizin, sonuc = []) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) jsDosyalari(tam, sonuc);
    else if (girdi.name.endsWith('.js')) sonuc.push(tam);
  }
  return sonuc;
}
const oku = (...parca) => fs.readFileSync(path.join(KOK, ...parca), 'utf8');
const goreli = (tam) => path.relative(KOK, tam).split(path.sep).join('/');
const SRC_DOSYALARI = jsDosyalari(SRC);

test('bağlantı: özel WebSocket istemcisini yalnız bağlantı yöneticisi yükler; main.js ve diğer modüller doğrudan kullanmaz', () => {
  const yukleyenler = SRC_DOSYALARI.filter((d) => /require\(['"][^'"]*ws-istemci['"]\)/.test(fs.readFileSync(d, 'utf8'))).map(goreli);
  assert.deepEqual(yukleyenler, ['src/baglanti-yoneticisi.js']);
});

test('bağlantı: özel WebSocket sınıfı yalnız canlı bağlantı kurucusuna (haWsOlustur) verilir', () => {
  const main = oku('src', 'main.js');
  const kullanimlar = main.split('\n').filter((satir) => /baglantiYoneticisi\.webSocketSinifi/.test(satir));
  assert.equal(kullanimlar.length, 1);
  assert.match(kullanimlar[0], /^\s*WebSocketSinifi:\s*baglantiYoneticisi\.webSocketSinifi/);
});

test('bağlantı: HA yolları ham net.fetch kullanmaz; main.js içinde net.fetch yalnız bağlantı yöneticisinin temel fetch işlevinde ve sürüm denetleyicisinde (HA dışı) geçer', () => {
  const main = oku('src', 'main.js');
  const netFetchler = main.split(/\r?\n/).filter((satir) => /\bnet\.fetch\(/.test(satir));
  assert.equal(netFetchler.length, 2);
  assert.match(netFetchler[0], /fetchTemel:/);
  assert.match(main, /surumDenetleyicisiOlustur\(\{\s*fetch: \(url, secenekler\) => net\.fetch\(url, secenekler\),/);
  assert.match(main, /haIstemcisi[\s\S]{0,400}fetch: \(url, secenekler\) => baglantiYoneticisi\.fetch\(url, secenekler\)/);
  assert.match(main, /adresSinayiciOlustur\(\{ fetch: \(url, secenekler\) => baglantiYoneticisi\.fetch\(url, secenekler\)/);
});

test('bağlantı: sertifika doğrulaması yalnız parmak izi modunda ve yalnız özel istemcide gevşetilir; ortam değişkeni ile kapatma yok', () => {
  for (const dosya of SRC_DOSYALARI) {
    const metin = fs.readFileSync(dosya, 'utf8');
    assert.equal(/NODE_TLS_REJECT_UNAUTHORIZED/.test(metin), false, `${goreli(dosya)}: NODE_TLS_REJECT_UNAUTHORIZED kullanılmaz`);
    if (/rejectUnauthorized/.test(metin)) {
      assert.ok(['src/lib/ws-istemci.js', 'src/lib/sertifika-oku.js'].includes(goreli(dosya)), `${goreli(dosya)}: rejectUnauthorized yalnız özel WebSocket istemcisinde ve sertifika okuyucuda geçebilir`);
    }
  }
  const ws = oku('src', 'lib', 'ws-istemci.js');
  const satirlar = ws.split('\n');
  const sira = satirlar.findIndex((s) => /rejectUnauthorized\s*=\s*false/.test(s));
  assert.ok(sira > 0, 'parmak izi modu için tek gevşetme noktası var');
  assert.match(satirlar[sira], /^\s*if \(yaprakDenetle\) /, 'gevşetme yalnız yaprak denetimi (parmak izi) verilmişken');
  assert.equal(ws.match(/rejectUnauthorized/g).length, 1, 'yalnız tek gevşetme noktası; başka kullanım yok');
});

test('bağlantı: ws-istemci ve ozel-ustbilgi saf kalır (yalnız node: yerleşikleri ve ./ modülleri); kimlik üstbilgisi eklemez', () => {
  for (const ad of ['ws-istemci.js', 'ozel-ustbilgi.js']) {
    const metin = oku('src', 'lib', ad);
    for (const m of metin.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), `${ad}: izin verilmeyen bağımlılık ${m[1]}`);
    }
    assert.equal(/\belectron\b/.test(metin.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false, `${ad}: Electron'a bağlı değil`);
  }
  const ws = oku('src', 'lib', 'ws-istemci.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.equal(/Authorization/i.test(ws), false, 'WebSocket yükseltme isteğine kimlik üstbilgisi eklenmez (HA kimliği ileti içinde gider)');
});

test('bağlantı: üstbilgi değeri günlüğe yazılmaz (gunluk çağrılarında deger / ustbilgi değerleri yok)', () => {
  for (const ad of ['src/baglanti-yoneticisi.js', 'src/lib/ozel-ustbilgi.js', 'src/lib/ws-istemci.js']) {
    const metin = oku(...ad.split('/'));
    for (const m of metin.matchAll(/gunluk\(([^;]*)\);/g)) {
      assert.equal(/\bdeger\b|\.deger\b|requestHeaders|ustbilgi\[/.test(m[1]), false, `${ad}: günlük çağrısı değer taşıyor: ${m[0]}`);
    }
  }
});

test('bağlantı: Ayarlar sayfası betiği WebSocket / ağ / HTML ekleme kullanmaz ve değeri sayfada tutmaz', () => {
  const metin = oku('src', 'ayarlar-baglanti.js');
  assert.equal(/WebSocket|fetch\(|innerHTML|require\(|localStorage|sessionStorage/.test(metin), false);
});

test('bağlantı: yeni IPC kanalları bağlantı yöneticisinde ayarlardan(olay) koruması ile kaydedilir', () => {
  const metin = oku('src', 'baglanti-yoneticisi.js');
  assert.match(metin, /ayarlardan\(olay\)\s*\?\s*isleyici\(\.\.\.args\)\s*:\s*izinYok\(\)/);
  for (const kanal of ['baglanti:durum', 'baglanti:ustbilgi-kaydet', 'baglanti:ustbilgi-sil', 'baglanti:ustbilgi-dene']) {
    assert.ok(metin.includes(`'${kanal}'`), `${kanal} kayıtlı`);
  }
});

test('bağlantı: sertifika okuyucu yalnız el sıkışır: sokete veri yazmaz, istek göndermez; gevşetme tek satırdır', () => {
  const metin = oku('src', 'lib', 'sertifika-oku.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.equal(metin.match(/rejectUnauthorized/g).length, 1);
  assert.equal(/\.(write|end|cork|pipe|setEncoding)\s*\(/.test(metin), false, 'soket yazma/bitirme çağrısı yok (destroy ile kesilir)');
  assert.equal(/\bfetch\b|http|Authorization|ustbilgi/i.test(metin), false);
  // Yalnız sertifika yöneticisi kullanır; başka hiçbir src dosyası yüklemez.
  const yukleyenler = SRC_DOSYALARI.filter((d) => /require\(['"][^'"]*sertifika-oku['"]\)/.test(fs.readFileSync(d, 'utf8'))).map(goreli);
  assert.deepEqual(yukleyenler, ['src/sertifika-yoneticisi.js']);
});

// ---------------------------------------------------------------------------
// o-58: klasör tabanlı ayar eşitleme
// ---------------------------------------------------------------------------

const ESITLEME_DOSYALARI = ['src/lib/ayar-esitleme.js', 'src/lib/esitleme-bolumleri.js', 'src/lib/esitleme-sifre.js', 'src/esitleme-yoneticisi.js'];
const yorumsuz = (metin) => metin.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

test('eşitleme (o-58): çekirdek modüller ve yönetici yalnız fs/path/crypto ve yerel modülleri kullanır; ağ, Electron, alt süreç yok', () => {
  for (const ad of ESITLEME_DOSYALARI) {
    const metin = oku(...ad.split('/'));
    for (const m of metin.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const gecerli = m[1].startsWith('./') || ['node:fs', 'node:fs/promises', 'node:path', 'node:crypto'].includes(m[1]);
      assert.ok(gecerli, `${ad}: izin verilmeyen bağımlılık ${m[1]}`);
    }
    assert.equal(/\belectron\b|\bfetch\s*\(|WebSocket|XMLHttpRequest|\bnet\.|child_process|node:(?:http|https|net|tls|dgram|dns)/.test(yorumsuz(metin)), false, `${ad}: ağ/Electron/alt süreç`);
  }
});

test('eşitleme (o-58): günlüğe yalnız sabit metin ve sayı yazılır (yol, ad, parola, hata iletisi yok)', () => {
  const yonetici = oku('src', 'esitleme-yoneticisi.js');
  const cagrilar = [...yonetici.matchAll(/gunlugeYaz\(([^;]*)\);/g)];
  assert.ok(cagrilar.length >= 10, 'günlük çağrıları bulunamadı');
  for (const m of cagrilar) {
    for (const d of m[1].matchAll(/\$\{([^}]*)\}/g)) assert.match(d[1], /^\w+\.length$/, `günlükte yalnız sayı olabilir: ${m[0]}`);
    const degiskenler = m[1].replace(/'[^']*'|`[^`]*`/g, '');
    assert.equal(/message|stack|parola|klasor|yol|\.code|err\b|hata/i.test(degiskenler), false, `günlük çağrısı sır/yol/hata taşıyor: ${m[0]}`);
  }
  // Dosya adları, sır ve parola yalnız saf modüllerden geçen sabit nedenlerle raporlanır: günlük işlevine doğrudan parola geçilmez.
  assert.equal(/gunluk\([^)]*parola/i.test(yonetici), false);
});

test('eşitleme (o-58): IPC kanalları bağlantı yöneticisinin ayardan(olay) korumasıyla kaydedilir; main.js doğrudan kanal açmaz', () => {
  const main = oku('src', 'main.js');
  assert.match(main, /baglantiYoneticisi\.ipcKaydet\(\{[^}]*ek: \[[^\]]*esitlemeYoneticisi\.ipcIsleyicileri\(\)/);
  assert.equal(/ipcMain\.(?:handle|on)\(\s*'esitleme:/.test(main), false, 'esitleme: kanalları doğrudan kaydedilmez');
  const yonetici = oku('src', 'esitleme-yoneticisi.js');
  for (const kanal of ['esitleme:durum', 'esitleme:klasor-sec', 'esitleme:ayarla', 'esitleme:simdi', 'esitleme:parola-koy', 'esitleme:parola-sil']) {
    assert.ok(yonetici.includes(`'${kanal}'`), `${kanal} tanımlı`);
  }
  const preload = oku('src', 'preload.js');
  for (const kanal of ['esitleme:durum', 'esitleme:klasor-sec', 'esitleme:ayarla', 'esitleme:simdi', 'esitleme:parola-koy', 'esitleme:parola-sil']) {
    assert.ok(preload.includes(`'${kanal}'`), `${kanal} preload'da`);
  }
});

test('eşitleme (o-58): main.js klasörü yalnız diyalogla seçtirir, içe aktarma hattını ve yasak klasör listesini kullanır, parolayı safeStorage dosyasında tutar, ayar yazımında tetikler', () => {
  const main = oku('src', 'main.js');
  assert.match(main, /properties: \['openDirectory', 'createDirectory'\]/);
  assert.match(main, /iceAktar: ayarlariIceAktarUygula,/, 'klasörden gelen bölümler içe aktarmayla AYNI hattan (kapı süzgeci dahil) uygulanır');
  assert.match(main, /yasakKlasorler: ciktiYasakKlasorleri/);
  assert.match(main, /esitleme-parola\.dat/);
  assert.match(main, /etiket: 'Esitleme parolasi'/);
  assert.match(main, /if \(esitlemeYoneticisi\) esitlemeYoneticisi\.yerelDegisti\(\)/);
  assert.match(main, /esitlemeYoneticisi\.baslat\(\)/);
  assert.match(main, /esitlemeYoneticisi\.kapat\(\)/);
  assert.equal(/ayarlaraEsitlemeDegistiBildir[\s\S]{0,200}webContents\.send\('ayarlar:esitleme-degisti'\)/.test(main), true);
});

test('eşitleme (o-58): Ayarlar sayfası betiği yol göndermez, parolayı saklamaz ve ağ/HTML ekleme kullanmaz', () => {
  const metin = oku('src', 'ayarlar-esitleme.js');
  assert.equal(/WebSocket|fetch\(|innerHTML|require\(|localStorage|sessionStorage|eval\(/.test(yorumsuz(metin)), false);
  assert.match(metin, /kopru\.esitlemeKlasoruSec\(\)/, 'klasör seçimi argümansız: yolu ana süreç diyaloğu belirler');
  assert.equal(/\.klasor\s*=[^=]|esitlemeKlasoru\s*[:=]/.test(yorumsuz(metin)), false, 'sayfa klasör yolu yazmaz');
  assert.match(metin, /parolaGirdisi\.value = ''/, 'parola alanı hemen temizlenir');
});

test('bağlantı: oturum doğrulama kancası yalnız sertifika yöneticisinde; yönetici HA dışı ana bilgisayarda Chromium sonucunu bırakır (-3)', () => {
  const kancali = SRC_DOSYALARI.filter((d) => /setCertificateVerifyProc/.test(fs.readFileSync(d, 'utf8'))).map(goreli);
  assert.deepEqual(kancali, ['src/sertifika-yoneticisi.js']);
  const y = oku('src', 'sertifika-yoneticisi.js');
  assert.match(y, /if \(!anaBilgisayar \|\| !haAdresleri\(\)\.has\(anaBilgisayar\)\) return -3;/);
  // Yalnız "yetkili geçersiz" sonucu özel kökle kurtarılabilir.
  assert.match(y, /istek\.verificationResult !== 'net::ERR_CERT_AUTHORITY_INVALID'\) return -3;/);
});
