'use strict';

/**
 * Ayarlar kategorileri (src/ayarlar-kategori.js, 1.6.0): bölüm–kategori eşlemesi ayarlar.html ile tutarlı, seçili kategori dışındaki
 * bölümler gizli, arama sürerken hepsi görünür, uzun yardım metni "Ayrıntı" düğmesiyle açılır. Minik sahte belgeyle, tarayıcı yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Kategori = require('../src/ayarlar-kategori');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');

class SahteOge {
  constructor(kimlik = '', ust = null) {
    this.id = kimlik;
    this.parentNode = ust;
    this.attributes = {};
    this.siniflar = new Set();
    this.dinleyiciler = {};
    this.hidden = false;
    this.textContent = '';
    this.sonrakiler = [];
    const o = this;
    this.classList = {
      add: (c) => o.siniflar.add(c),
      remove: (c) => o.siniflar.delete(c),
      contains: (c) => o.siniflar.has(c),
      toggle: (c) => {
        if (o.siniflar.has(c)) {
          o.siniflar.delete(c);
          return false;
        }
        o.siniflar.add(c);
        return true;
      },
    };
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  getAttribute(ad) {
    return ad in this.attributes ? this.attributes[ad] : null;
  }

  removeAttribute(ad) {
    delete this.attributes[ad];
  }

  addEventListener(ad, fn) {
    (this.dinleyiciler[ad] ??= []).push(fn);
  }

  tikla() {
    for (const fn of this.dinleyiciler.click ?? []) fn({ type: 'click' });
  }

  after(oge) {
    this.sonrakiler.push(oge);
  }
}

/** Her kategori bağlantısı (içinde data-i18n'li span), her bölüm ve kategori başlığı olan sahte belge. */
function belgeKur(ipuclari = []) {
  const ogeler = new Map();
  const ekle = (o) => (ogeler.set(o.id, o), o);
  for (const k of Kategori.KATEGORILER) {
    const bag = ekle(new SahteOge(k.baglanti));
    const etiket = new SahteOge('', bag);
    etiket.setAttribute('data-i18n', 'ayar.gezin.' + k.kod);
    etiket.textContent = k.kod.toUpperCase();
    bag.querySelector = () => etiket;
    for (const b of k.bolumler) ekle(new SahteOge(b));
  }
  ekle(new SahteOge('kategoriBaslik'));
  const belge = {
    body: { dataset: {} },
    getElementById: (k) => ogeler.get(k) ?? null,
    querySelectorAll: (secici) => (secici === '.form-grubu > .ipucu' ? ipuclari : []),
    createElement: (ad) => Object.assign(new SahteOge(''), { tagName: ad }),
  };
  return { belge, oge: (k) => ogeler.get(k) };
}

const gizli = (o) => o.classList.contains(Kategori.GIZLI_SINIF);

test('ayarlar kategorileri: ayarlar.html deki her bölüm tam bir kategoridedir, menü bağlantısı kategorinin ilk bölümüne gider', () => {
  const sayfadakiler = [...HTML.matchAll(/<(?:section|details) class="bolum" id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(sayfadakiler.length, 20);
  const eslenen = Kategori.KATEGORILER.flatMap((k) => k.bolumler);
  assert.equal(new Set(eslenen).size, eslenen.length, 'bir bölüm iki kategoride olamaz');
  assert.deepEqual([...eslenen].sort(), [...sayfadakiler].sort(), 'kategorisiz bölüm her kategoride görünür kalırdı');
  for (const k of Kategori.KATEGORILER) {
    assert.match(HTML, new RegExp(`<a id="${k.baglanti}" href="#${k.bolumler[0]}">`), k.kod);
    assert.match(HTML, new RegExp(`data-i18n="ayar\\.gezin\\.${k.kod}"`), k.kod + ' çeviri anahtarı');
  }
  assert.match(HTML, /<script src="ayarlar-kategori\.js"><\/script>\s*<script src="ayarlar\.js"><\/script>/, 'modül ayarlar.js ten önce yüklenir');
});

test('ayarlar kategorileri: kur ilk kategoriyi gösterir; sec yalnız seçilenin bölümlerini açar, başlığı ve aria-current u günceller', () => {
  const { belge, oge } = belgeKur();
  const k = Kategori.olustur({ belge });
  k.kur();
  assert.equal(k.secili(), 'baglanti');
  assert.equal(gizli(oge('bolumBaglanti')) || gizli(oge('bolumAnahtar')), false);
  assert.equal(gizli(oge('bolumSurum')), true);
  assert.equal(oge('gezinBaglanti').getAttribute('aria-current'), 'page');
  assert.equal(belge.body.dataset.kategori, 'baglanti');

  assert.equal(k.sec('bildirimler'), true);
  for (const b of ['bolumGeriBildirim', 'bolumBildirimler', 'bolumMobil']) assert.equal(gizli(oge(b)), false, b);
  assert.equal(gizli(oge('bolumBaglanti')), true);
  assert.equal(oge('gezinBaglanti').getAttribute('aria-current'), null);
  assert.equal(oge('gezinBildirimler').getAttribute('aria-current'), 'page');
  assert.equal(oge('kategoriBaslik').textContent, 'BILDIRIMLER');
  assert.equal(oge('kategoriBaslik').getAttribute('data-i18n'), 'ayar.gezin.bildirimler', 'dil değişince başlık da çevrilir');

  assert.equal(k.sec('yok'), false, 'bilinmeyen kategori yok sayılır');
  assert.equal(k.secili(), 'bildirimler');
});

test('ayarlar kategorileri: gizli kategorideki öğeye gidilince (hata, arama sonucu) o kategori açılır', () => {
  const { belge, oge } = belgeKur();
  const k = Kategori.olustur({ belge });
  k.kur();
  const alan = new SahteOge('kameraAdresi', new SahteOge('', oge('bolumKamera')));
  k.ogeyiGoster(alan);
  assert.equal(k.secili(), 'kartlar');
  assert.equal(gizli(oge('bolumKamera')), false);
  k.ogeyiGoster(new SahteOge('sahipsiz')); // kategorisi bulunamayan öğe seçimi değiştirmez
  assert.equal(k.secili(), 'kartlar');
});

test('ayarlar kategorileri: arama sürerken bütün bölümler görünür, başlık gizlenir; arama bitince seçili kategoriye dönülür', () => {
  const { belge, oge } = belgeKur();
  const k = Kategori.olustur({ belge });
  k.kur();
  k.sec('yedek');
  k.aramaAyarla(true);
  for (const kat of Kategori.KATEGORILER) for (const b of kat.bolumler) assert.equal(gizli(oge(b)), false, b);
  assert.equal(oge('kategoriBaslik').hidden, true);
  assert.equal(oge('gezinYedek').getAttribute('aria-current'), null);
  k.aramaAyarla(false);
  assert.equal(gizli(oge('bolumYedek')), false);
  assert.equal(gizli(oge('bolumBaglanti')), true);
  assert.equal(oge('kategoriBaslik').hidden, false);
  assert.equal(oge('gezinYedek').getAttribute('aria-current'), 'page');
});

test('ayarlar kategorileri: uzun yardım metni kısalır ve "Ayrıntı" düğmesi alır (aria-expanded); kısa metne dokunulmaz, ikinci çağrı çoğaltmaz', () => {
  const uzun = Object.assign(new SahteOge(''), { textContent: 'x'.repeat(Kategori.IPUCU_SINIRI + 1) });
  const kisa = Object.assign(new SahteOge('kisaIpucu'), { textContent: 'Kısa açıklama.' });
  const { belge } = belgeKur([uzun, kisa]);
  const k = Kategori.olustur({ belge, t: (a) => (a === 'ayar.ipucu.ayrinti' ? 'Ayrıntı' : a) });
  k.kur();
  assert.equal(uzun.classList.contains('ipucu-kisa'), true);
  assert.ok(uzun.id, 'düğmenin aria-controls u için kimlik verilir');
  assert.equal(uzun.sonrakiler.length, 1);
  const dugme = uzun.sonrakiler[0];
  assert.equal(dugme.tagName, 'button');
  assert.equal(dugme.type, 'button');
  assert.equal(dugme.textContent, 'Ayrıntı');
  assert.equal(dugme.getAttribute('aria-controls'), uzun.id);
  assert.equal(dugme.getAttribute('aria-expanded'), 'false');
  assert.equal(dugme.getAttribute('data-i18n'), 'ayar.ipucu.ayrinti');
  dugme.tikla();
  assert.equal(uzun.classList.contains('ipucu-kisa'), false);
  assert.equal(dugme.getAttribute('aria-expanded'), 'true');
  dugme.tikla();
  assert.equal(uzun.classList.contains('ipucu-kisa'), true);
  assert.equal(dugme.getAttribute('aria-expanded'), 'false');
  assert.equal(kisa.classList.contains('ipucu-kisa'), false);
  assert.equal(kisa.sonrakiler.length, 0);
  dugme.tikla(); // açık bırakılan metin de yeniden kısaltılmaz
  k.ipuclariniKisalt();
  assert.equal(uzun.sonrakiler.length, 1, 'düğmesi olan metne ikinci düğme eklenmez');
  assert.equal(uzun.classList.contains('ipucu-kisa'), false);
});
