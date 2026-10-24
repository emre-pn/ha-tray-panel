'use strict';

/**
 * Bağlantı (çevrimdışı) sayfasının betiği (src/offline.js) ve köşe bildirimi sayfasının betiği (src/kose-sayfa.js)
 * minik bir SAHTE DOM ile çalıştırılır: gerçek tarayıcı, Electron ya da pencere YOK. Satır içi betikten dosyaya taşınan
 * (hata-17) kodun çalışma zamanı davranışını ve "yalnız textContent" kuralını sınar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');

class SahteOge {
  constructor(kimlik) {
    this.id = kimlik;
    this.children = [];
    this.dinleyiciler = {};
    // CSS özel özelliği (--sure gibi) setProperty ile yazılır; okunurken style['--ad'] (sayılamaz: style karşılaştırmalarını bozmaz)
    this.style = Object.defineProperty({}, 'setProperty', { value(ad, deger) { this[ad] = String(deger); } });
    this.disabled = false;
    this.attributes = {};
    this.siniflar = new Set();
    this._metin = '';
    const o = this;
    this.classList = {
      add: (c) => o.siniflar.add(c),
      remove: (c) => o.siniflar.delete(c),
      contains: (c) => o.siniflar.has(c),
      toggle: (c, acik) => {
        if (acik) o.siniflar.add(c);
        else o.siniflar.delete(c);
      },
    };
  }

  get textContent() {
    return this._metin;
  }

  set textContent(deger) {
    this._metin = String(deger);
    this.children = [];
  }

  addEventListener(ad, isleyici) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  tikla() {
    for (const isleyici of this.dinleyiciler.click ?? []) isleyici({ type: 'click' });
  }

  appendChild(cocuk) {
    this.children.push(cocuk);
    return cocuk;
  }

  replaceChildren(...cocuklar) {
    this.children = cocuklar;
    this._metin = cocuklar.map((c) => c.textContent).join('');
  }
}

function betikCalistir(dosya, htmlDosyasi, ek) {
  const html = oku(htmlDosyasi);
  const ogeler = new Map();
  for (const [, kimlik] of html.matchAll(/\bid="([^"]+)"/g)) ogeler.set(kimlik, new SahteOge(kimlik));
  const zamanlayicilar = [];
  const kok = { dataset: {} }; // <html>: data-malzeme (gorunum-11)
  const sandbox = {
    document: {
      documentElement: kok,
      createElement: (ad) => Object.assign(new SahteOge(''), { tagName: ad }),
      createElementNS: (ns, ad) => Object.assign(new SahteOge(''), { ns, tagName: ad }),
      getElementById(kimlik) {
        const oge = ogeler.get(kimlik);
        assert.ok(oge, `${htmlDosyasi} içinde #${kimlik} yok`);
        return oge;
      },
    },
    URLSearchParams,
    setInterval: (fn) => zamanlayicilar.push({ tur: 'aralik', fn }) && zamanlayicilar.length,
    clearInterval() {},
    setTimeout: (fn, ms) => zamanlayicilar.push({ tur: 'zaman', fn, ms }) && zamanlayicilar.length,
    clearTimeout() {},
    ...ek,
  };
  // Sayfanın <script src="lib/dil.js"> ve <script src="lib/ceviri/yuzey.js"> etiketleri sayfa betiğinden ÖNCE yüklenir
  vm.createContext(sandbox);
  for (const lib of ['src/lib/dil.js', 'src/lib/ceviri/yuzey.js']) vm.runInContext(oku(lib), sandbox, { filename: lib });
  if (sandbox.window) Object.assign(sandbox.window, { EvDil: sandbox.EvDil, EvCeviriYuzey: sandbox.EvCeviriYuzey });
  vm.runInContext(oku(dosya), sandbox, { filename: dosya });
  return { oge: (k) => ogeler.get(k), zamanlayicilar, kok };
}

// --- offline.js ---------------------------------------------------------------------

function offlineKur(sorgu, { baglanti = true } = {}) {
  const cagrilar = { tekrarDene: 0, ayarlariAc: 0 };
  let durumDinleyicisi = null;
  const evPaneli = {
    tekrarDene: () => (cagrilar.tekrarDene += 1),
    ayarlariAc: () => (cagrilar.ayarlariAc += 1),
    onBaglantiDurum: (cb) => {
      durumDinleyicisi = cb;
      return () => {};
    },
  };
  const sayfa = betikCalistir('src/offline.js', 'src/offline.html', {
    window: { location: { search: sorgu }, evPaneli: baglanti ? evPaneli : undefined },
  });
  return { ...sayfa, cagrilar, durumGonder: (yuk) => durumDinleyicisi(yuk) };
}

test('offline.js: çökme (COKME, sn=0) -> açıklama çökmeyi söyler, geri sayım ve zamanlayıcı yok', () => {
  const s = offlineKur('?durum=cevrimdisi&hata=COKME&sn=0');
  assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılamadı');
  assert.match(s.oge('aciklama').textContent, /art arda çöktü; otomatik yeniden deneme durduruldu/);
  assert.equal(s.oge('sayacKutusu').style.display, 'none');
  assert.equal(s.zamanlayicilar.length, 0);
  assert.equal(s.oge('btnDeneMetin').textContent, 'Tekrar Dene');
});

test('offline.js: sunucu hatası kodu açıklanır, geri sayım başlar ama kendi başına "tekrar dene" ÇAĞIRMAZ (hata-05)', () => {
  const s = offlineKur('?durum=cevrimdisi&hata=HTTP_502&sn=3');
  assert.match(s.oge('aciklama').textContent, /Sunucu hatası \(502\)/);
  assert.equal(s.oge('sayacKutusu').style.display, 'inline-block');
  assert.equal(s.oge('kalanSaniye').textContent, '3');
  assert.equal(s.zamanlayicilar.length, 1);
  for (let i = 0; i < 5; i += 1) s.zamanlayicilar[0].fn();
  assert.equal(s.cagrilar.tekrarDene, 0, 'ana süreçteki zamanlayıcı dener, sayfa değil');
  assert.equal(s.oge('btnDeneMetin').textContent, 'Bağlanılıyor…', 'süre bitince bağlanılıyor görünümü');
});

test('offline.js: "Tekrar Dene" ve "Ayarlar" düğmeleri köprüyü çağırır; köprü yoksa (hata) çökmez', () => {
  const s = offlineKur('?durum=cevrimdisi');
  s.oge('btnDene').tikla();
  s.oge('btnAyarlar').tikla();
  assert.deepEqual(s.cagrilar, { tekrarDene: 1, ayarlariAc: 1 });
  assert.equal(s.oge('btnDene').disabled, true);
  const koprusuz = offlineKur('?durum=cevrimdisi', { baglanti: false });
  assert.doesNotThrow(() => {
    koprusuz.oge('btnDene').tikla();
    koprusuz.oge('btnAyarlar').tikla();
  });
});

test('offline.js: adresler ve hata kodu yalnız textContent ile yazılır (adres etiket olmaz)', () => {
  const kotu = '<img src=x onerror=alert(1)>';
  const s = offlineKur(`?durum=cevrimdisi&yerel=${encodeURIComponent(kotu)}&dis=${encodeURIComponent('https://ha.example.com')}&hata=${encodeURIComponent(kotu)}`);
  assert.equal(s.oge('yerelAdresDeger').textContent, kotu);
  assert.equal(s.oge('yerelAdresDeger').children.length, 0);
  assert.equal(s.oge('adresKutusu').style.display, 'block');
  assert.ok(s.oge('aciklama').textContent.includes(kotu) && s.oge('aciklama').children.length === 0);
});

test('offline.js: ana süreçten gelen durum güncellemeleri (deneniyor / nesne) yerinde uygulanır', () => {
  const s = offlineKur('?durum=cevrimdisi&sn=30');
  s.durumGonder('deneniyor');
  assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılıyor…');
  s.durumGonder({ durum: 'cevrimdisi', sn: 0, hata: 'COKME', yerel: 'http://a', dis: 'https://b' });
  assert.equal(s.oge('baslik').textContent, 'Ev sunucusuna bağlanılamadı');
  assert.match(s.oge('aciklama').textContent, /art arda çöktü/);
  assert.equal(s.oge('sayacKutusu').style.display, 'none');
  assert.equal(s.oge('yerelAdresDeger').textContent, 'http://a');
  s.durumGonder(null);
  s.durumGonder(42); // geçersiz yükler yok sayılır
  assert.match(s.oge('aciklama').textContent, /art arda çöktü/);
});

test('offline.js: uygulamanın "Hareketi azalt" ayarı (hareket=azalt) <html data-hareket> yazar; alan yoksa ya da başka değerse işaret kalkar', () => {
  const sorgulu = offlineKur('?durum=cevrimdisi&hareket=azalt');
  assert.equal(sorgulu.kok.dataset.hareket, 'azalt', 'sayfa yüklenirken sorgudan');
  const yok = offlineKur('?durum=cevrimdisi');
  assert.equal('hareket' in yok.kok.dataset, false, 'ayar kapalıyken işaret yok');
  assert.equal('hareket' in offlineKur('?durum=cevrimdisi&hareket=baska').kok.dataset, false, 'bilinmeyen değer yok sayılır');
  // yerinde güncelleme (ayar sayfa açıkken değişebilir)
  yok.durumGonder({ durum: 'cevrimdisi', sn: 5, hata: '', hareket: 'azalt' });
  assert.equal(yok.kok.dataset.hareket, 'azalt');
  yok.durumGonder('deneniyor');
  assert.equal(yok.kok.dataset.hareket, 'azalt', 'dize güncellemesi (deneniyor) işarete dokunmaz');
  yok.durumGonder({ durum: 'baglaniyor' });
  assert.equal('hareket' in yok.kok.dataset, false, 'yükte alan yoksa işaret kalkar');
  sorgulu.durumGonder({ durum: 'cevrimdisi', sn: 5, hata: '', hareket: 'azalt' });
  assert.equal(sorgulu.kok.dataset.hareket, 'azalt');
});

test('offline.js (ekran okuyucu): "Tekrar Dene" bağlanılıyor başlığını, ardından gelen hatayı #duyuru canlı bölgesine yazar; otomatik turlar ve aynı hata tekrar duyurulmaz', () => {
  const html = oku('src/offline.html');
  assert.match(html, /<div[^>]*\bid="duyuru"[^>]*\brole="status"[^>]*\baria-live="polite"/);
  const s = offlineKur('?durum=cevrimdisi&hata=HTTP_502&sn=3');
  const duyuru = () => s.oge('duyuru').textContent;
  assert.equal(duyuru(), '', 'sayfa yüklenişi duyurulmaz');
  // ana sürecin otomatik denemesi: bağlanılıyor + aynı hata yeniden (kullanıcı bir şey yapmadı)
  s.durumGonder('deneniyor');
  s.durumGonder({ durum: 'cevrimdisi', sn: 4, hata: 'HTTP_502' });
  assert.equal(duyuru(), '', 'otomatik tur duyurulmaz');
  // kullanıcı Tekrar Dene'ye basar
  s.oge('btnDene').tikla();
  assert.equal(duyuru(), 'Ev sunucusuna bağlanılıyor…');
  s.durumGonder({ durum: 'cevrimdisi', sn: 4, hata: 'HTTP_502' });
  assert.match(duyuru(), /^Ev sunucusuna bağlanılamadı\. .*Sunucu hatası \(502\)/);
  // aynı hata otomatik turlarda yeniden gelir: bölge değişmez (sentinel ezilmez)
  s.oge('duyuru').textContent = 'SENTINEL';
  s.durumGonder('deneniyor');
  s.durumGonder({ durum: 'cevrimdisi', sn: 8, hata: 'HTTP_502' });
  assert.equal(duyuru(), 'SENTINEL', 'aynı hata ikinci kez duyurulmaz');
  // farklı bir hata yeni bilgidir
  s.durumGonder({ durum: 'cevrimdisi', sn: 8, hata: 'ERR_CONNECTION_REFUSED' });
  assert.match(duyuru(), /^Ev sunucusuna bağlanılamadı\. /);
  assert.notEqual(duyuru(), 'SENTINEL');
});

test('offline.js (ekran okuyucu): dil değişimi duyurulmaz; köprü olmasa da duyuru bölgesi kullanılır', () => {
  const s = offlineKur('?durum=cevrimdisi&hata=HTTP_502&sn=3&dil=tr');
  s.oge('btnDene').tikla();
  s.oge('duyuru').textContent = 'SENTINEL';
  s.durumGonder({ durum: 'cevrimdisi', sn: 4, hata: 'HTTP_502', dil: 'en' }); // dil değişti + ilk hata sonucu: yeni anahtar
  assert.match(s.oge('duyuru').textContent, /^Could not connect to the home server\. /);
  s.oge('duyuru').textContent = 'SENTINEL';
  s.durumGonder({ durum: 'cevrimdisi', sn: 4, hata: 'HTTP_502', dil: 'de' }); // yalnız dil değişti
  assert.equal(s.oge('duyuru').textContent, 'SENTINEL', 'aynı durum başka dilde yeniden duyurulmaz');
  const koprusuz = offlineKur('?durum=cevrimdisi', { baglanti: false });
  assert.doesNotThrow(() => koprusuz.oge('btnDene').tikla());
  assert.equal(koprusuz.oge('duyuru').textContent, 'Ev sunucusuna bağlanılıyor…');
});

// --- kose-sayfa.js ----------------------------------------------------------------------

function koseKur() {
  let dinleyici = null;
  const sayfa = betikCalistir('src/kose-sayfa.js', 'src/kose-bildirim.html', {
    window: { evKose: { onGoster: (cb) => (dinleyici = cb) } },
  });
  return { ...sayfa, gonder: (yuk) => dinleyici(yuk) };
}

test('kose-sayfa.js: başarı bildirimi metni textContent ile yazar ve görünür yapar; süre sonunda gizlemeyi ana sürece bırakır (1.6.1)', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'Salon Lambası açıldı', sureMs: 1500 });
  assert.equal(s.oge('metin').textContent, 'Salon Lambası açıldı');
  assert.equal(s.oge('bildirim').classList.contains('gorunur'), true);
  assert.equal(s.oge('bildirim').classList.contains('hata'), false);
  assert.equal(s.oge('sure').style['--sure'], '1500ms', 'kalan süre çizgisi bildirimin süresince erir');
  // Sayfa kendi zamanlayıcısıyla içeriği soldurmaz: akrilik zemin bir an boş kutu olarak kalırdı. Pencere ana süreçte solup gizlenir.
  assert.equal(s.zamanlayicilar.length, 0);
  assert.equal(s.oge('bildirim').classList.contains('gorunur'), true);
});

test('kose-sayfa.js: hata görünümü, metin 200 karaktere kısalır, süre 0,5-10 sn aralığına sıkıştırılır, geçersiz yük yok sayılır', () => {
  const s = koseKur();
  s.gonder({ tur: 'hata', metin: 'x'.repeat(500), sureMs: 99_999 });
  assert.equal(s.oge('metin').textContent.length, 200);
  assert.equal(s.oge('bildirim').classList.contains('hata'), true);
  assert.equal(s.oge('sure').style['--sure'], '10000ms');
  s.gonder({ tur: 'ok', metin: 'a', sureMs: 1 });
  assert.equal(s.oge('sure').style['--sure'], '500ms');
  s.gonder({ tur: 'ok', metin: 'b', sureMs: Number.NaN });
  assert.equal(s.oge('sure').style['--sure'], '1500ms');
  const once = s.oge('metin').textContent;
  s.gonder(null);
  s.gonder('metin');
  assert.equal(s.oge('metin').textContent, once);
});

test('kose-sayfa.js: başarıda ✓, hatada ! simgesi (renge ek, g-09); hata "alert", başarı "status" olarak duyurulur (k-16)', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'Salon açıldı' });
  assert.equal(s.oge('isaret').textContent, '✓');
  assert.equal(s.oge('bildirim').attributes.role, 'status');
  assert.equal(s.oge('bildirim').attributes['aria-live'], 'polite');
  s.gonder({ tur: 'hata', metin: 'Yapılamadı' });
  assert.equal(s.oge('isaret').textContent, '!');
  assert.equal(s.oge('bildirim').attributes.role, 'alert');
  assert.equal(s.oge('bildirim').attributes['aria-live'], 'assertive');
  s.gonder({ tur: 'ok', metin: 'Tekrar' });
  assert.equal(s.oge('isaret').textContent, '✓', 'hatadan sonra başarıda simge geri döner');
  assert.equal(s.oge('bildirim').attributes.role, 'status');
  // süs simgesi ekran okuyucuya girmez
  assert.match(oku('src/kose-bildirim.html'), /id="isaret"[^>]*aria-hidden="true"/);
});

test('kose-sayfa.js: zararlı metin etiket olmaz', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: '<img src=x onerror=alert(1)>' });
  assert.equal(s.oge('metin').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(s.oge('metin').children.length, 0);
});

test('kose-sayfa.js: malzeme "acrylic" ya da "mica" ise <html> data-malzeme alır; "yok", eksik ya da bilinmeyen değerde öznitelik kalkar (opak)', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'a', malzeme: 'acrylic' });
  assert.equal(s.kok.dataset.malzeme, 'acrylic');
  s.gonder({ tur: 'ok', metin: 'b', malzeme: 'mica' });
  assert.equal(s.kok.dataset.malzeme, 'mica');
  s.gonder({ tur: 'ok', metin: 'c', malzeme: 'yok' });
  assert.equal('malzeme' in s.kok.dataset, false);
  s.gonder({ tur: 'ok', metin: 'd', malzeme: 'acrylic' });
  s.gonder({ tur: 'ok', metin: 'e' });
  assert.equal('malzeme' in s.kok.dataset, false, 'malzeme bildirilmediyse opak');
  s.gonder({ tur: 'ok', metin: 'f', malzeme: 'acrylic' });
  s.gonder({ tur: 'ok', metin: 'g', malzeme: '"><script>' });
  assert.equal('malzeme' in s.kok.dataset, false, 'bilinmeyen değer özniteliğe yazılmaz');
  assert.equal(s.oge('metin').textContent, 'g');
});

test('kose-sayfa.js (1.6.0): eylem özeti iki satırdır; cihaz simgesi svg ile çizilir, ✓ köşedeki rozete geçer', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'Ampul: %80', ozet: { baslik: 'Ampul', alt: 'Parlaklık %80', alan: 'light', acik: true } });
  assert.equal(s.oge('metin').textContent, 'Ampul');
  assert.equal(s.oge('alt').textContent, 'Parlaklık %80');
  assert.equal(s.oge('alt').hidden, false);
  const kutu = s.oge('bildirim');
  for (const sinif of ['ikili', 'simgeli', 'acik', 'gorunur']) assert.equal(kutu.classList.contains(sinif), true, sinif);
  const [svg, rozet] = s.oge('isaret').children;
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
  assert.equal(svg.children[0].tagName, 'path');
  assert.ok(svg.children[0].attributes.d.length > 10);
  assert.equal(rozet.className, 'rozet');
  assert.equal(rozet.textContent, '✓');
});

test('kose-sayfa.js (1.6.0): hatalı eylemde rozet !, daire dolu çizilmez; bilinmeyen alan simgesiz kalır', () => {
  const s = koseKur();
  s.gonder({ tur: 'hata', metin: 'x', ozet: { baslik: 'Kahve makinesi', alt: 'Yapılamadı: bağlantı yok', alan: 'switch', acik: true } });
  assert.equal(s.oge('isaret').children[1].textContent, '!');
  assert.equal(s.oge('bildirim').classList.contains('acik'), false, 'hata açık görünmez');
  assert.equal(s.oge('bildirim').classList.contains('hata'), true);
  s.gonder({ tur: 'ok', metin: 'x', ozet: { baslik: 'Kapı', alt: 'Açıldı', alan: 'lock' } });
  assert.equal(s.oge('isaret').textContent, '✓');
  assert.equal(s.oge('isaret').children.length, 0);
  assert.equal(s.oge('bildirim').classList.contains('simgeli'), false);
  assert.equal(s.oge('bildirim').classList.contains('ikili'), true);
});

test('kose-sayfa.js (1.6.0): özetsiz ya da bilgi bildirimi tek satıra döner; özet metni etiket olmaz', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'a', ozet: { baslik: 'Ampul', alt: 'Açıldı', alan: 'light' } });
  s.gonder({ tur: 'bilgi', metin: 'Çamaşır bitti', simge: 'i', ozet: { baslik: 'x', alt: 'y', alan: 'light' } });
  assert.equal(s.oge('metin').textContent, 'Çamaşır bitti');
  assert.equal(s.oge('alt').hidden, true);
  assert.equal(s.oge('alt').textContent, '');
  assert.equal(s.oge('bildirim').classList.contains('ikili'), false);
  assert.equal(s.oge('bildirim').classList.contains('simgeli'), false);
  assert.equal(s.oge('isaret').textContent, 'i');
  const kotu = '<img src=x onerror=alert(1)>';
  s.gonder({ tur: 'ok', metin: 'a', ozet: { baslik: kotu, alt: kotu, alan: 'fan' } });
  assert.equal(s.oge('metin').textContent, kotu);
  assert.equal(s.oge('alt').textContent, kotu);
  assert.equal(s.oge('metin').children.length + s.oge('alt').children.length, 0);
});
