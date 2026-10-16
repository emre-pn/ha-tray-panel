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
    this.style = {};
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

// --- kose-sayfa.js ----------------------------------------------------------------------

function koseKur() {
  let dinleyici = null;
  const sayfa = betikCalistir('src/kose-sayfa.js', 'src/kose-bildirim.html', {
    window: { evKose: { onGoster: (cb) => (dinleyici = cb) } },
  });
  return { ...sayfa, gonder: (yuk) => dinleyici(yuk) };
}

test('kose-sayfa.js: başarı bildirimi metni textContent ile yazar, görünür yapar ve süre sonunda gizler', () => {
  const s = koseKur();
  s.gonder({ tur: 'ok', metin: 'Salon Lambası açıldı', sureMs: 1500 });
  assert.equal(s.oge('metin').textContent, 'Salon Lambası açıldı');
  assert.equal(s.oge('bildirim').classList.contains('gorunur'), true);
  assert.equal(s.oge('bildirim').classList.contains('hata'), false);
  assert.equal(s.zamanlayicilar.at(-1).ms, 1500);
  s.zamanlayicilar.at(-1).fn();
  assert.equal(s.oge('bildirim').classList.contains('gorunur'), false);
});

test('kose-sayfa.js: hata görünümü, metin 200 karaktere kısalır, süre 0,5-10 sn aralığına sıkıştırılır, geçersiz yük yok sayılır', () => {
  const s = koseKur();
  s.gonder({ tur: 'hata', metin: 'x'.repeat(500), sureMs: 99_999 });
  assert.equal(s.oge('metin').textContent.length, 200);
  assert.equal(s.oge('bildirim').classList.contains('hata'), true);
  assert.equal(s.zamanlayicilar.at(-1).ms, 10_000);
  s.gonder({ tur: 'ok', metin: 'a', sureMs: 1 });
  assert.equal(s.zamanlayicilar.at(-1).ms, 500);
  s.gonder({ tur: 'ok', metin: 'b', sureMs: Number.NaN });
  assert.equal(s.zamanlayicilar.at(-1).ms, 1500);
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
