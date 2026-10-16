'use strict';

/**
 * Arayüz dili: çevrimdışı sayfası (src/offline.js), köşe bildirimi sayfası (src/kose-sayfa.js) ve yüzey sözlüğü (src/lib/ceviri/yuzey.js).
 * Sahte bir DOM'la çalışır: gerçek tarayıcı, Electron ya da pencere YOK. Sahte DOM sayfanın HTML'inden kurulur (kimlikler ve data-i18n
 * işaretleri gerçek dosyadan okunur), böylece lib/dil.js sayfayiCevir gerçek sayfadaki gibi çalışır. Hızlı panel / palet için
 * İngilizce ve dil değişimi testleri test/yuzey-sayfa.test.js içindedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const YUZEY = require('../src/lib/ceviri/yuzey');
const ANA = require('../src/lib/ceviri/ana');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
// Almanca ve Fransızca da ç/ö/ü kullanır; yalnız Türkçeye özgü harfler (ğ, ı, İ, ş) o dillerde kalıntı sayılır.
const TURKCE_OZEL_HARF = /[ğıİşĞŞ]/;
const YENI_DILLER = ['de', 'fr', 'es'];
const BES_DIL = ['tr', 'en', 'de', 'fr', 'es'];
const SAYFALAR = [
  ['src/yuzey.html', 'src/yuzey-sayfa.js'],
  ['src/yuzey.html', 'src/yuzey-duzen.js'], // 1.4.0 düzen: sayfa sekmeleri ve ayrıntı bölmesi (aynı sayfa, ayrı betik)
  ['src/kose-bildirim.html', 'src/kose-sayfa.js'],
  ['src/offline.html', 'src/offline.js'],
  ['src/masaustu-karo.html', 'src/masaustu-karo-sayfa.js'], // 1.4.0 (o-33): masaüstü karosu
];
// Sayfa betiğinin yanında sözlük kullanan yardımcı renderer betikleri (1.4.0 cihaz kartları; yuzey.html bunları yükler).
// yuzey-bilgi.js: hızlı panelin bilgi bölümleri (sensörler, yapılacaklar, takvim, grafik).
const EK_BETIKLER = ['src/yuzey-kartlar.js', 'src/yuzey-bilgi.js'];

// --- sözlük ve sayfa yapısı -------------------------------------------------------------------------------

test('yüzey sözlüğü: sayfa betiklerinde ve HTML işaretlerinde kullanılan her anahtar tanımlı; tanımlı her anahtar kullanılıyor', () => {
  const kullanilan = new Set();
  for (const dosya of EK_BETIKLER) {
    for (const m of oku(dosya).matchAll(/'((?:yuzey|offline|kose)\.[A-Za-z0-9_.]+)'/g)) {
      if (!m[1].endsWith('.')) kullanilan.add(m[1]);
      else {
        // dinamik anahtar ailesi ('yuzey.klima.mod.' + mod): ön ekle başlayan her sözlük satırı kullanılmış sayılır (en az biri olmalı)
        const aile = Object.keys(YUZEY.tr).filter((k) => k.startsWith(m[1]));
        assert.ok(aile.length > 0, `${dosya}: '${m[1]}' ön ekli anahtar ailesi sözlükte yok`);
        for (const k of aile) kullanilan.add(k);
      }
    }
  }
  for (const [html, betik] of SAYFALAR) {
    for (const m of oku(betik).matchAll(/'((?:yuzey|offline|kose|masaustu)\.[A-Za-z0-9_.]+)'/g)) kullanilan.add(m[1]);
    for (const m of oku(html).matchAll(/\bdata-i18n="([^"]+)"/g)) kullanilan.add(m[1]);
    for (const m of oku(html).matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
      for (const parca of m[1].split(';')) kullanilan.add(parca.slice(parca.indexOf(':') + 1).trim());
    }
  }
  assert.ok(kullanilan.size > 60, `çok az anahtar bulundu (${kullanilan.size}): düzenli ifade bozulmuş olabilir`);
  for (const anahtar of kullanilan) {
    assert.ok(Object.hasOwn(YUZEY.tr, anahtar), `${anahtar}: sözlükte (tr) yok`);
    for (const dil of BES_DIL.slice(1)) assert.ok(Object.hasOwn(YUZEY[dil], anahtar), `${anahtar}: sözlükte (${dil}) yok`);
  }
  const kullanilmayan = Object.keys(YUZEY.tr).filter((k) => !kullanilan.has(k));
  assert.deepEqual(kullanilmayan, [], 'sözlükte olup hiçbir sayfada kullanılmayan anahtarlar');
});

test('yüzey sözlüğü: uygulama adı ve pencere başlıkları ana süreç sözlüğüyle (pencere başlığı) aynı; yabancı dillerde ad "Home Panel"', () => {
  for (const dil of BES_DIL) {
    assert.equal(YUZEY[dil]['yuzey.uygulamaAdi'], ANA[dil]['uygulama.ad'], dil);
    assert.equal(YUZEY[dil]['yuzey.sayfaBasligi'], ANA[dil]['uygulama.yuzeyBaslik'], dil);
    for (const anahtar of ['offline.sayfaBasligi', 'kose.sayfaBasligi']) {
      assert.ok(YUZEY[dil][anahtar].startsWith(`${ANA[dil]['uygulama.ad']} — `), `${dil} ${anahtar}`);
    }
  }
  for (const dil of ['en', ...YENI_DILLER]) assert.equal(YUZEY[dil]['yuzey.uygulamaAdi'], 'Home Panel', dil);
  assert.equal(YUZEY.tr['yuzey.uygulamaAdi'], 'Ev Paneli');
});

test('yüzey sözlüğü: tutarlı terimler (Try again, Settings, home/external address) ve basılı tutarak onay metinleri korunur', () => {
  assert.equal(YUZEY.en['offline.tekrarDene'], 'Try again');
  assert.equal(YUZEY.en['offline.ayarlar'], 'Settings');
  assert.equal(YUZEY.en['yuzey.alt.ayarlar'], 'Settings');
  assert.equal(YUZEY.en['offline.adres.evIci'], 'Home address:');
  assert.equal(YUZEY.en['offline.adres.dis'], 'External address:');
  assert.match(YUZEY.en['yuzey.alt.haAc'], /HA dashboard/);
  assert.match(YUZEY.en['yuzey.bos.anahtarYokAlt'], /access token/);
  assert.match(YUZEY.en['yuzey.paletSerit'], /Hold Enter to confirm/);
  assert.match(YUZEY.en['yuzey.karo.basiliTut'], /hold to confirm/);
  // Türkçe düğme adı "Tekrar Dene" açıklamalarda anılıyorsa İngilizcesi de düğmenin adıyla anılır
  for (const [anahtar, metin] of Object.entries(YUZEY.tr)) {
    if (metin.includes('“Tekrar Dene”')) assert.ok(YUZEY.en[anahtar].includes('“Try again”'), `${anahtar}: düğme adı`);
  }
});

test('dört yerel sayfa (çevrimdışı, köşe, hızlı panel, masaüstü karosu) lib/dil.js ve lib/ceviri/yuzey.js betiklerini sayfa betiğinden ÖNCE yükler; <title> çevrilir; <html lang> varsayılanı tr', () => {
  for (const [html, betik] of SAYFALAR) {
    const kaynak = oku(html);
    const sira = [...kaynak.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    const dil = sira.indexOf('lib/dil.js');
    const sozluk = sira.indexOf('lib/ceviri/yuzey.js');
    const sayfa = sira.indexOf(path.basename(betik));
    assert.ok(dil >= 0 && sozluk > dil && sayfa > sozluk, `${html}: betik sırası ${JSON.stringify(sira)}`);
    assert.match(kaynak, /<html lang="tr">/, `${html}: varsayılan dil Türkçe`);
    assert.match(kaynak, /<title data-i18n="[^"]+">/, `${html}: <title> çevrilmeli`);
    assert.doesNotMatch(kaynak, /<script>|<script [^>]*>[^<]/, `${html}: satır içi betik yok`);
  }
});

// --- HTML'den kurulan sahte DOM -----------------------------------------------------------------------------

class SahteOge {
  constructor(etiket, nitelikler = {}) {
    this.etiket = etiket;
    this.id = nitelikler.id ?? null;
    this.attributes = { ...nitelikler };
    this._metin = '';
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.odakSayisi = 0;
    this.dinleyiciler = {};
    this.siniflar = new Set();
    this.classList = {
      add: (c) => this.siniflar.add(c),
      remove: (c) => this.siniflar.delete(c),
      contains: (c) => this.siniflar.has(c),
      toggle: (c, acik) => (acik ? this.siniflar.add(c) : this.siniflar.delete(c)),
    };
  }

  /** Gerçek DOM gibi atanan değer metne çevrilir (sayı atamak '15' yazar). */
  get textContent() {
    return this._metin;
  }

  set textContent(deger) {
    this._metin = String(deger);
  }

  getAttribute(ad) {
    return this.attributes[ad] ?? null;
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  addEventListener(ad, isleyici) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
  }

  focus() {
    this.odakSayisi += 1;
  }

  tikla() {
    for (const isleyici of this.dinleyiciler.click ?? []) isleyici({ type: 'click' });
  }
}

/** HTML dosyasındaki kimlikli ve data-i18n işaretli öğelerden sahte bir belge kurar; i18n öğelerinin metni HTML'deki Türkçe varsayılandır. */
function sahteBelge(htmlDosyasi) {
  const html = oku(htmlDosyasi);
  const ogeler = new Map();
  const tumu = [];
  for (const [, etiket, nitelikMetni, icMetin] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\w+)\b([^>]*)>([^<]*)/g)) {
    if (!/\b(?:id|data-i18n|data-i18n-attr)=/.test(nitelikMetni)) continue;
    const nitelikler = Object.fromEntries([...nitelikMetni.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const oge = new SahteOge(etiket, nitelikler);
    if ('data-i18n' in nitelikler) oge.textContent = icMetin.trim();
    if (nitelikler.id) ogeler.set(nitelikler.id, oge);
    tumu.push(oge);
  }
  const kok = { dataset: {}, nitelikler: {}, setAttribute: (ad, deger) => (kok.nitelikler[ad] = deger) };
  const belge = {
    nodeType: 9,
    documentElement: kok,
    activeElement: null,
    body: null,
    getElementById: (kimlik) => {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `${htmlDosyasi} içinde #${kimlik} yok`);
      return oge;
    },
    querySelectorAll: (secici) => tumu.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
  };
  return {
    belge,
    kok,
    oge: (kimlik) => ogeler.get(kimlik),
    /** data-i18n="anahtar" taşıyan ilk öğe */
    anahtarOgesi: (anahtar) => tumu.find((o) => o.attributes['data-i18n'] === anahtar),
    baslik: () => tumu.find((o) => o.etiket === 'title'),
    /** Görünür olabilecek bütün metinler ve erişilebilirlik öznitelikleri */
    metinler: () => tumu.flatMap((o) => [o.textContent, o.attributes.title, o.attributes['aria-label'], o.attributes.placeholder].filter(Boolean)),
  };
}

/** Sayfa betiğini sözlük betikleriyle birlikte (HTML'deki sırayla) sahte belgede çalıştırır. */
function betikCalistir(sayfa, betik, window, { sozlukYukle = true } = {}) {
  const zamanlayicilar = [];
  const sandbox = {
    document: sayfa.belge,
    window,
    URLSearchParams,
    setInterval: (fn) => zamanlayicilar.push({ fn }) && zamanlayicilar.length,
    clearInterval() {},
    setTimeout: (fn, ms) => zamanlayicilar.push({ fn, ms }) && zamanlayicilar.length,
    clearTimeout() {},
  };
  vm.createContext(sandbox);
  if (sozlukYukle) {
    for (const lib of ['src/lib/dil.js', 'src/lib/ceviri/yuzey.js']) vm.runInContext(oku(lib), sandbox, { filename: lib });
    Object.assign(window, { EvDil: sandbox.EvDil, EvCeviriYuzey: sandbox.EvCeviriYuzey });
  }
  vm.runInContext(oku(betik), sandbox, { filename: betik });
  return zamanlayicilar;
}

// --- offline.js -----------------------------------------------------------------------------------------------

function offlineKur(sorgu) {
  const sayfa = sahteBelge('src/offline.html');
  const cagrilar = { tekrarDene: 0, ayarlariAc: 0 };
  const dinleyiciler = {};
  const evPaneli = {
    tekrarDene: () => (cagrilar.tekrarDene += 1),
    ayarlariAc: () => (cagrilar.ayarlariAc += 1),
    onBaglantiDurum: (cb) => (dinleyiciler.durum = cb),
    onDilDegisti: (cb) => (dinleyiciler.dil = cb),
  };
  const zamanlayicilar = betikCalistir(sayfa, 'src/offline.js', { location: { search: sorgu }, evPaneli });
  return { ...sayfa, zamanlayicilar, cagrilar, durumGonder: (yuk) => dinleyiciler.durum(yuk), dilGonder: (yuk) => dinleyiciler.dil(yuk) };
}

const turkceKalan = (sayfa) => sayfa.metinler().filter((m) => TURKCE_HARF.test(m));

test('offline.js ?dil=en: başlık, açıklama, ham hata kodu, düğmeler, adres etiketleri, sayfa başlığı ve <html lang> İngilizce; Türkçe harf kalmaz', () => {
  const s = offlineKur('?durum=cevrimdisi&dil=en&sn=0&hata=ERR_NAME_NOT_RESOLVED&yerel=http%3A%2F%2F192.168.1.5%3A8123');
  assert.equal(s.kok.nitelikler.lang, 'en');
  assert.equal(s.baslik().textContent, 'Home Panel — Connection');
  assert.equal(s.oge('baslik').textContent, 'Could not connect to the home server');
  assert.equal(s.oge('aciklama').textContent, 'The home server’s address could not be found. Check the address and your network (DNS) settings.');
  assert.equal(s.oge('hataKodu').textContent, 'Error code: ERR_NAME_NOT_RESOLVED');
  assert.equal(s.oge('hataKodu').hidden, false);
  assert.equal(s.oge('btnDeneMetin').textContent, 'Try again');
  assert.equal(s.oge('btnAyarlar').textContent, 'Settings');
  assert.equal(s.anahtarOgesi('offline.adres.evIci').textContent, 'Home address:');
  assert.equal(s.anahtarOgesi('offline.adres.dis').textContent, 'External address:');
  assert.equal(s.oge('yerelAdresDeger').textContent, 'http://192.168.1.5:8123');
  assert.equal(s.oge('disAdresDeger').textContent, '(not set)');
  assert.deepEqual(turkceKalan(s), []);
});

test('offline.js: dil yoksa, geçersizse ya da tr ise Türkçe', () => {
  for (const sorgu of ['?durum=cevrimdisi&sn=0', '?durum=cevrimdisi&sn=0&dil=it', '?durum=cevrimdisi&sn=0&dil=DE', '?durum=cevrimdisi&sn=0&dil=de-DE', '?durum=cevrimdisi&sn=0&dil=EN', '?durum=cevrimdisi&sn=0&dil=tr']) {
    const s = offlineKur(sorgu);
    assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılamadı', sorgu);
    assert.equal(s.oge('btnDeneMetin').textContent, 'Tekrar Dene', sorgu);
    assert.equal(s.oge('btnAyarlar').textContent, 'Ayarlar', sorgu);
    assert.equal(s.baslik().textContent, 'Ev Paneli — Bağlantı', sorgu);
  }
});

test('offline.js en: her Chromium hata kodunun, çökmenin ve HTTP hatalarının açıklaması İngilizce; Türkçe harf yok; Türkçeden farklı', () => {
  const kodlar = [
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_CONNECTION_RESET',
    'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_CHANGED', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID', 'HTTP_403', 'HTTP_502', 'HTTP_503', 'COKME', 'HATA_-105', '',
  ];
  const gorulen = new Set();
  for (const kod of kodlar) {
    const en = offlineKur(`?durum=cevrimdisi&dil=en&sn=0&hata=${encodeURIComponent(kod)}`);
    const tr = offlineKur(`?durum=cevrimdisi&dil=tr&sn=0&hata=${encodeURIComponent(kod)}`);
    assert.deepEqual(turkceKalan(en), [], kod);
    assert.notEqual(en.oge('aciklama').textContent, tr.oge('aciklama').textContent, `${kod}: çevrilmiş olmalı`);
    assert.ok(en.oge('aciklama').textContent.length > 30, kod);
    // ham kod satırı yalnız açıklaması olan kodlarda; Türkçe ile aynı kurala uyar
    assert.equal(en.oge('hataKodu').hidden, tr.oge('hataKodu').hidden, `${kod}: ham kod satırı`);
    if (!en.oge('hataKodu').hidden) assert.equal(en.oge('hataKodu').textContent, `Error code: ${kod}`);
    gorulen.add(en.oge('aciklama').textContent);
  }
  assert.match(offlineKur('?dil=en&sn=0&hata=HTTP_503').oge('aciklama').textContent, /^Server error \(503\)\./);
  assert.match(offlineKur('?dil=en&sn=0&hata=HATA_-105').oge('aciklama').textContent, /\(HATA_-105\)/);
  assert.match(offlineKur('?dil=en&sn=0&hata=COKME').oge('aciklama').textContent, /“Try again”/);
  assert.ok(gorulen.size >= 12, 'her kod grubunun kendi açıklaması var');
});

test('offline.js en: bağlanılıyor görünümü ve geri sayım (çoğul / tekil) İngilizce; sayı vurgulu öğesinde kalır', () => {
  const baglaniyor = offlineKur('?durum=baglaniyor&dil=en&sn=0');
  assert.equal(baglaniyor.oge('baslik').textContent, 'Connecting to the home server…');
  assert.equal(baglaniyor.oge('aciklama').textContent, 'Checking the home address and the external address.');
  assert.equal(baglaniyor.oge('btnDeneMetin').textContent, 'Connecting…');
  assert.equal(baglaniyor.oge('btnDene').disabled, true);
  assert.deepEqual(turkceKalan(baglaniyor), []);

  const s = offlineKur('?durum=cevrimdisi&dil=en&sn=3&hata=HTTP_502');
  assert.equal(s.oge('sayacKutusu').style.display, 'inline-block');
  assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], ['Retrying in ', '3', ' seconds…']);
  s.zamanlayicilar[0].fn();
  s.zamanlayicilar[0].fn();
  assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], ['Retrying in ', '1', ' second…'], 'tekil');
  s.zamanlayicilar[0].fn();
  assert.equal(s.oge('btnDeneMetin').textContent, 'Connecting…', 'süre bitince bağlanılıyor görünümü');
  assert.equal(s.cagrilar.tekrarDene, 0, 'sayfa kendi başına denemez (hata-05)');

  const tr = offlineKur('?durum=cevrimdisi&sn=30');
  assert.deepEqual([tr.oge('sayacOn').textContent, tr.oge('kalanSaniye').textContent, tr.oge('sayacSon').textContent], ['', '30', ' saniye içinde yeniden denenecek…']);
});

test('offline.js: sayfa açıkken dil değişince (onDilDegisti) metinler çevrilir; geri sayım, düğme durumu ve hata kodu bozulmaz; geçersiz yük yok sayılır', () => {
  const s = offlineKur('?durum=cevrimdisi&sn=20&hata=HTTP_502&yerel=http%3A%2F%2Fa');
  assert.equal(s.zamanlayicilar.length, 1);
  for (let i = 0; i < 5; i += 1) s.zamanlayicilar[0].fn();
  assert.equal(s.oge('kalanSaniye').textContent, '15');
  s.dilGonder({ dil: 'en' });
  assert.equal(s.kok.nitelikler.lang, 'en');
  assert.equal(s.baslik().textContent, 'Home Panel — Connection');
  assert.equal(s.oge('baslik').textContent, 'Could not connect to the home server');
  assert.match(s.oge('aciklama').textContent, /^Server error \(502\)/);
  assert.equal(s.oge('hataKodu').textContent, 'Error code: HTTP_502');
  assert.equal(s.oge('btnDeneMetin').textContent, 'Try again');
  assert.equal(s.oge('disAdresDeger').textContent, '(not set)');
  assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], ['Retrying in ', '15', ' seconds…'], 'geri sayım kaldığı yerden');
  assert.equal(s.zamanlayicilar.length, 1, 'zamanlayıcı yeniden kurulmadı');
  assert.equal(s.oge('sayacKutusu').style.display, 'inline-block');
  assert.equal(s.oge('btnDene').disabled, false);
  assert.deepEqual(turkceKalan(s), []);
  s.zamanlayicilar[0].fn();
  assert.equal(s.oge('kalanSaniye').textContent, '14', 'sayaç İngilizce görünümde de işler');
  // geçersiz yükler dili bozmaz
  for (const yuk of [null, 'en', 42, {}, { dil: 'it' }, { dil: 'EN' }, { dil: 'de-DE' }]) s.dilGonder(yuk);
  assert.equal(s.oge('baslik').textContent, 'Could not connect to the home server');
  // Türkçeye dönüş
  s.dilGonder({ dil: 'tr' });
  assert.equal(s.kok.nitelikler.lang, 'tr');
  assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılamadı');
  assert.match(s.oge('aciklama').textContent, /^Sunucu hatası \(502\)/);
  assert.equal(s.oge('hataKodu').textContent, 'Hata kodu: HTTP_502');
  assert.equal(s.oge('disAdresDeger').textContent, '(tanımlı değil)');
  assert.equal(s.oge('kalanSaniye').textContent, '14');
});

test('offline.js: bağlanılıyor görünümündeyken dil değişirse bağlanılıyor metinleri yeni dille yazılır (düğme pasif kalır)', () => {
  const s = offlineKur('?durum=cevrimdisi&sn=20');
  s.oge('btnDene').tikla();
  assert.equal(s.oge('btnDeneMetin').textContent, 'Bağlanılıyor…');
  s.dilGonder({ dil: 'en' });
  assert.equal(s.oge('baslik').textContent, 'Connecting to the home server…');
  assert.equal(s.oge('btnDeneMetin').textContent, 'Connecting…');
  assert.equal(s.oge('btnDene').disabled, true);
  assert.equal(s.oge('hataKodu').hidden, true);
  assert.equal(s.oge('sayacKutusu').style.display, 'none');
  assert.equal(s.oge('btnAyarlar').textContent, 'Settings');
});

test('offline.js: ana sürecin yerinde güncellemesindeki dil (onBaglantiDurum yükü) uygulanır; yük dili yoksa mevcut dil korunur', () => {
  const s = offlineKur('?durum=cevrimdisi&sn=5&dil=tr');
  s.durumGonder({ durum: 'cevrimdisi', sn: 8, hata: 'ERR_CONNECTION_REFUSED', yerel: 'http://a', dis: 'https://b', dil: 'en' });
  assert.equal(s.kok.nitelikler.lang, 'en');
  assert.equal(s.oge('btnAyarlar').textContent, 'Settings');
  assert.match(s.oge('aciklama').textContent, /^The server refused the connection\./);
  assert.equal(s.oge('hataKodu').textContent, 'Error code: ERR_CONNECTION_REFUSED');
  assert.equal(s.oge('kalanSaniye').textContent, '8');
  assert.equal(s.oge('sayacOn').textContent, 'Retrying in ');
  s.durumGonder({ durum: 'baglaniyor', dil: 'en' });
  assert.equal(s.oge('baslik').textContent, 'Connecting to the home server…');
  s.durumGonder({ durum: 'cevrimdisi', sn: 0, hata: 'COKME', yerel: 'http://a', dis: 'https://b' }); // dil yok
  assert.match(s.oge('aciklama').textContent, /^The page crashed repeatedly/);
  s.durumGonder('deneniyor');
  assert.equal(s.oge('btnDeneMetin').textContent, 'Connecting…');
  s.durumGonder({ durum: 'cevrimdisi', sn: 0, dil: 'tr' });
  assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılamadı');
});

test('offline.js: köprüde onDilDegisti yoksa (eski preload) çökmez', () => {
  const sayfa = sahteBelge('src/offline.html');
  const evPaneli = { tekrarDene() {}, ayarlariAc() {}, onBaglantiDurum() {} };
  assert.doesNotThrow(() => betikCalistir(sayfa, 'src/offline.js', { location: { search: '?dil=en' }, evPaneli }));
  assert.equal(sayfa.oge('btnDeneMetin').textContent, 'Try again');
});

const turkceOzelKalan = (sayfa) => sayfa.metinler().filter((m) => TURKCE_OZEL_HARF.test(m));

test('offline.js de/fr/es: başlık, açıklama, ham hata kodu, düğmeler, adres etiketleri, sayfa başlığı ve <html lang> o dilde; Türkçeye özgü harf kalmaz', () => {
  const beklenen = {
    de: { baslik: 'Verbindung zum Heimserver nicht möglich', baslikTitle: 'Home Panel — Verbindung', kod: 'Fehlercode: ERR_CONNECTION_REFUSED', dene: 'Erneut versuchen', ayarlar: 'Einstellungen', evIci: 'Heimnetz-Adresse:', tanimsiz: '(nicht festgelegt)' },
    fr: { baslik: 'Impossible de se connecter au serveur domestique', baslikTitle: 'Home Panel — Connexion', kod: 'Code d’erreur\u00A0: ERR_CONNECTION_REFUSED', dene: 'Réessayer', ayarlar: 'Paramètres', evIci: 'Adresse locale\u00A0:', tanimsiz: '(non définie)' },
    es: { baslik: 'No se pudo conectar con el servidor doméstico', baslikTitle: 'Home Panel — Conexión', kod: 'Código de error: ERR_CONNECTION_REFUSED', dene: 'Reintentar', ayarlar: 'Configuración', evIci: 'Dirección local:', tanimsiz: '(sin definir)' },
  };
  for (const [dil, b] of Object.entries(beklenen)) {
    const s = offlineKur(`?durum=cevrimdisi&dil=${dil}&sn=0&hata=ERR_CONNECTION_REFUSED&yerel=http%3A%2F%2F192.168.1.5%3A8123`);
    assert.equal(s.kok.nitelikler.lang, dil);
    assert.equal(s.baslik().textContent, b.baslikTitle, dil);
    assert.equal(s.oge('baslik').textContent, b.baslik, dil);
    assert.equal(s.oge('hataKodu').textContent, b.kod, dil);
    assert.equal(s.oge('hataKodu').hidden, false, dil);
    assert.equal(s.oge('btnDeneMetin').textContent, b.dene, dil);
    assert.equal(s.oge('btnAyarlar').textContent, b.ayarlar, dil);
    assert.equal(s.anahtarOgesi('offline.adres.evIci').textContent, b.evIci, dil);
    assert.equal(s.oge('yerelAdresDeger').textContent, 'http://192.168.1.5:8123', dil);
    assert.equal(s.oge('disAdresDeger').textContent, b.tanimsiz, dil);
    assert.deepEqual(turkceOzelKalan(s), [], `${dil}: Türkçeye özgü harf kalmamalı`);
    // Türkçe HTML varsayılanı bırakılmadı: görünür başlıklar ve düğmeler Türkçeden farklı
    assert.notEqual(s.oge('baslik').textContent, YUZEY.tr['offline.baslik.cevrimdisi'], dil);
  }
});

test('offline.js de/fr/es: her Chromium hata kodunun, çökmenin ve HTTP hatalarının açıklaması çevrilmiş; Türkçe ve İngilizceden farklı', () => {
  const kodlar = [
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_CONNECTION_RESET',
    'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_CHANGED', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID', 'HTTP_403', 'HTTP_502', 'HTTP_503', 'COKME', 'HATA_-105', '',
  ];
  for (const dil of YENI_DILLER) {
    const gorulen = new Set();
    for (const kod of kodlar) {
      const s = offlineKur(`?durum=cevrimdisi&dil=${dil}&sn=0&hata=${encodeURIComponent(kod)}`);
      const tr = offlineKur(`?durum=cevrimdisi&dil=tr&sn=0&hata=${encodeURIComponent(kod)}`);
      const en = offlineKur(`?durum=cevrimdisi&dil=en&sn=0&hata=${encodeURIComponent(kod)}`);
      assert.deepEqual(turkceOzelKalan(s), [], `${dil} ${kod}`);
      assert.notEqual(s.oge('aciklama').textContent, tr.oge('aciklama').textContent, `${dil} ${kod}: Türkçeden farklı`);
      assert.notEqual(s.oge('aciklama').textContent, en.oge('aciklama').textContent, `${dil} ${kod}: İngilizceden farklı`);
      assert.ok(s.oge('aciklama').textContent.length > 30, `${dil} ${kod}`);
      assert.equal(s.oge('hataKodu').hidden, tr.oge('hataKodu').hidden, `${dil} ${kod}: ham kod satırı Türkçe kuralla aynı`);
      if (!s.oge('hataKodu').hidden) assert.ok(s.oge('hataKodu').textContent.endsWith(kod), `${dil} ${kod}: ham kod olduğu gibi yazılır`);
      gorulen.add(s.oge('aciklama').textContent);
    }
    assert.ok(gorulen.size >= 12, `${dil}: her kod grubunun kendi açıklaması var`);
  }
  // {kod} yer tutucusu doldurulur, ham HTTP kodu açıklamada görünür
  assert.match(offlineKur('?durum=cevrimdisi&dil=de&sn=0&hata=HTTP_503').oge('aciklama').textContent, /^Serverfehler \(503\)\./);
  assert.match(offlineKur('?durum=cevrimdisi&dil=fr&sn=0&hata=HTTP_503').oge('aciklama').textContent, /^Erreur du serveur \(503\)\./);
  assert.match(offlineKur('?durum=cevrimdisi&dil=es&sn=0&hata=HTTP_503').oge('aciklama').textContent, /^Error del servidor \(503\)\./);
  for (const dil of YENI_DILLER) assert.match(offlineKur(`?durum=cevrimdisi&dil=${dil}&sn=0&hata=HATA_-105`).oge('aciklama').textContent, /\(HATA_-105\)/, dil);
  // çökme açıklaması düğmenin yeni dildeki adını anar
  assert.match(offlineKur('?dil=de&sn=0&hata=COKME').oge('aciklama').textContent, /„Erneut versuchen“/);
  assert.match(offlineKur('?dil=fr&sn=0&hata=COKME').oge('aciklama').textContent, /«\u00A0Réessayer\u00A0»/);
  assert.match(offlineKur('?dil=es&sn=0&hata=COKME').oge('aciklama').textContent, /“Reintentar”/);
});

test('offline.js de/fr/es: bağlanılıyor görünümü ve geri sayım (çoğul / tekil) o dilde; sayı vurgulu öğesinde kalır', () => {
  const beklenen = {
    de: { baslik: 'Verbindung zum Heimserver wird hergestellt…', dene: 'Verbindung wird hergestellt…', cogul: ['Neuer Versuch in ', '3', ' Sekunden…'], tekil: ['Neuer Versuch in ', '1', ' Sekunde…'] },
    fr: { baslik: 'Connexion au serveur domestique…', dene: 'Connexion…', cogul: ['Nouvelle tentative dans ', '3', ' secondes…'], tekil: ['Nouvelle tentative dans ', '1', ' seconde…'] },
    es: { baslik: 'Conectando con el servidor doméstico…', dene: 'Conectando…', cogul: ['Reintentando en ', '3', ' segundos…'], tekil: ['Reintentando en ', '1', ' segundo…'] },
  };
  for (const [dil, b] of Object.entries(beklenen)) {
    const baglaniyor = offlineKur(`?durum=baglaniyor&dil=${dil}&sn=0`);
    assert.equal(baglaniyor.oge('baslik').textContent, b.baslik, dil);
    assert.equal(baglaniyor.oge('btnDeneMetin').textContent, b.dene, dil);
    assert.equal(baglaniyor.oge('btnDene').disabled, true, dil);
    assert.deepEqual(turkceOzelKalan(baglaniyor), [], dil);

    const s = offlineKur(`?durum=cevrimdisi&dil=${dil}&sn=3&hata=HTTP_502`);
    assert.equal(s.oge('sayacKutusu').style.display, 'inline-block', dil);
    assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], b.cogul, dil);
    s.zamanlayicilar[0].fn();
    s.zamanlayicilar[0].fn();
    assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], b.tekil, `${dil}: tekil`);
    s.zamanlayicilar[0].fn();
    assert.equal(s.oge('btnDeneMetin').textContent, b.dene, `${dil}: süre bitince bağlanılıyor görünümü`);
    assert.equal(s.cagrilar.tekrarDene, 0, 'sayfa kendi başına denemez (hata-05)');
  }
});

test('offline.js: sayfa açıkken diller arasında geçilir (tr -> de -> fr -> es -> en); geri sayım ve hata kodu bozulmaz', () => {
  const s = offlineKur('?durum=cevrimdisi&sn=20&hata=HTTP_502&yerel=http%3A%2F%2Fa');
  for (let i = 0; i < 5; i += 1) s.zamanlayicilar[0].fn();
  s.dilGonder({ dil: 'de' });
  assert.equal(s.kok.nitelikler.lang, 'de');
  assert.equal(s.oge('baslik').textContent, 'Verbindung zum Heimserver nicht möglich');
  assert.equal(s.oge('hataKodu').textContent, 'Fehlercode: HTTP_502');
  assert.deepEqual([s.oge('sayacOn').textContent, s.oge('kalanSaniye').textContent, s.oge('sayacSon').textContent], ['Neuer Versuch in ', '15', ' Sekunden…']);
  s.dilGonder({ dil: 'fr' });
  assert.equal(s.kok.nitelikler.lang, 'fr');
  assert.equal(s.oge('btnDeneMetin').textContent, 'Réessayer');
  assert.equal(s.oge('kalanSaniye').textContent, '15');
  s.dilGonder({ dil: 'es' });
  assert.equal(s.kok.nitelikler.lang, 'es');
  assert.equal(s.oge('btnAyarlar').textContent, 'Configuración');
  s.dilGonder({ dil: 'en' });
  assert.equal(s.oge('btnAyarlar').textContent, 'Settings');
  assert.equal(s.zamanlayicilar.length, 1, 'zamanlayıcı yeniden kurulmadı');
  assert.equal(s.oge('btnDene').disabled, false);
  // ana sürecin yerinde güncellemesi yeni dilleri de taşıyabilir
  s.durumGonder({ durum: 'cevrimdisi', sn: 8, hata: 'ERR_CONNECTION_REFUSED', yerel: 'http://a', dis: 'https://b', dil: 'fr' });
  assert.equal(s.kok.nitelikler.lang, 'fr');
  assert.match(s.oge('aciklama').textContent, /^Le serveur a refusé la connexion\./);
});

// --- kose-sayfa.js --------------------------------------------------------------------------------------------

function koseKur({ sozlukYukle = true } = {}) {
  const sayfa = sahteBelge('src/kose-bildirim.html');
  const dinleyiciler = {};
  const evKose = { onGoster: (cb) => (dinleyiciler.goster = cb), onDilDegisti: (cb) => (dinleyiciler.dil = cb) };
  const zamanlayicilar = betikCalistir(sayfa, 'src/kose-sayfa.js', { evKose }, { sozlukYukle });
  return { ...sayfa, zamanlayicilar, gonder: (yuk) => dinleyiciler.goster(yuk), dilGonder: (yuk) => dinleyiciler.dil(yuk) };
}

test('kose-sayfa.js: dil:degisti sayfa başlığını ve <html lang> değerini çevirir; bildirim metnine (ana süreçte yazılmış) dokunmaz', () => {
  const s = koseKur();
  assert.equal(s.baslik().textContent, 'Ev Paneli — Bildirim');
  s.gonder({ tur: 'ok', metin: 'Living room light turned on' });
  s.dilGonder({ dil: 'en' });
  assert.equal(s.kok.nitelikler.lang, 'en');
  assert.equal(s.baslik().textContent, 'Home Panel — Notification');
  assert.equal(s.oge('metin').textContent, 'Living room light turned on');
  assert.equal(s.oge('isaret').textContent, '✓');
  assert.deepEqual(turkceKalan(s), [], 'İngilizcede kalan Türkçe sayfa metni yok');
  s.dilGonder({ dil: 'tr' });
  assert.equal(s.kok.nitelikler.lang, 'tr');
  assert.equal(s.baslik().textContent, 'Ev Paneli — Bildirim');
  // geçersiz yükler yok sayılır
  for (const yuk of [null, 'en', 7, {}, { dil: 'it' }, { dil: 'FR' }]) s.dilGonder(yuk);
  assert.equal(s.kok.nitelikler.lang, 'tr');
});

test('kose-sayfa.js: dil:degisti Almanca, Fransızca ve İspanyolca sayfa başlığını ve <html lang> değerini çevirir; bildirim metnine dokunmaz', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'Licht im Wohnzimmer eingeschaltet' });
  for (const [dil, baslik] of [['de', 'Home Panel — Benachrichtigung'], ['fr', 'Home Panel — Notification'], ['es', 'Home Panel — Notificación']]) {
    s.dilGonder({ dil });
    assert.equal(s.kok.nitelikler.lang, dil);
    assert.equal(s.baslik().textContent, baslik, dil);
    assert.equal(s.oge('metin').textContent, 'Licht im Wohnzimmer eingeschaltet', dil);
    assert.deepEqual(turkceOzelKalan(s), [], dil);
  }
});

test('kose-sayfa.js: çeviri betikleri yüklenemese bile bildirim görünür (çeviri yalnız sayfa başlığı içindir)', () => {
  const s = koseKur({ sozlukYukle: false });
  s.gonder({ tur: 'hata', metin: 'Could not turn on the light' });
  assert.equal(s.oge('metin').textContent, 'Could not turn on the light');
  assert.equal(s.oge('bildirim').classList.contains('gorunur'), true);
  assert.doesNotThrow(() => s.dilGonder({ dil: 'en' }));
});
