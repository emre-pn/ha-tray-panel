'use strict';

/**
 * "eksik" grubu testleri için TAM hızlı panel sayfası: yuzey.html'deki bütün betikler (dil, sözlük, arama, kaydırıcı, kartlar, bilgi,
 * düzen, sayfa) sırayla yüklenir. test/yuzey-kartlar-sahte.js ile aynı yaklaşım (sahte DOM, sahte zaman, gerçek tarayıcı / Electron /
 * Home Assistant YOK); fark: köprüde oku / bildirimKapat / sagTik vardır ve bilgi + düzen modülleri de yüklüdür.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(KOK, 'src', 'yuzey.html'), 'utf8');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const BETIKLER = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1])
  .filter((ad) => !['lib/tema-renk.js', 'lib/efekt.js', 'yuzey-gorunum.js'].includes(ad)) // tema / efekt katmanı bu testlerin konusu değil
  .map((ad) => [ad, oku(`src/${ad}`)]);

class SahteOge {
  constructor(etiket = 'div', kimlik = null, odak = { aktif: null }) {
    this.etiket = etiket;
    this.id = kimlik;
    this.odak = odak;
    this.children = [];
    this.dinleyiciler = {};
    this.style = {};
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.offsetHeight = 0;
    this.scrollTop = 0;
    this.title = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.src = '';
    this.alt = '';
    this.tabIndex = 0;
    this._deger = '';
    this._metin = '';
    this.odakSayisi = 0;
    const kap = this;
    this.classList = {
      add: (c) => {
        if (!kap.className.split(' ').includes(c)) kap.className = `${kap.className} ${c}`.trim();
      },
      remove: (c) => {
        kap.className = kap.className.split(' ').filter((x) => x && x !== c).join(' ');
      },
      contains: (c) => kap.className.split(' ').includes(c),
    };
  }

  get value() {
    return this._deger;
  }

  set value(deger) {
    this._deger = String(deger);
  }

  get textContent() {
    return this._metin + this.children.map((c) => c.textContent).join('');
  }

  set textContent(deger) {
    this._metin = String(deger);
    this.children = [];
  }

  appendChild(cocuk) {
    this.children.push(cocuk);
    return cocuk;
  }

  replaceChildren(...cocuklar) {
    const eskiler = this.bul(() => true);
    if (this.odak.aktif && eskiler.includes(this.odak.aktif) && !cocuklar.some((c) => c === this.odak.aktif || c.bul((x) => x === this.odak.aktif).length)) this.odak.aktif = null;
    this._metin = '';
    this.children = [];
    this.scrollTop = 0;
    for (const c of cocuklar) this.appendChild(c);
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  getAttribute(ad) {
    return this.attributes[ad] ?? null;
  }

  removeAttribute(ad) {
    delete this.attributes[ad];
  }

  addEventListener(ad, isleyici) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
  }

  focus() {
    this.odakSayisi += 1;
    this.odak.aktif = this;
  }

  scrollIntoView() {}

  gonder(tip, ek = {}) {
    const olay = { type: tip, target: this, preventDefault() { this.onlendi = true; }, ...ek };
    for (const isleyici of this.dinleyiciler[tip] ?? []) isleyici(olay);
    return olay;
  }

  bul(kosul, sonuc = []) {
    for (const c of this.children) {
      if (kosul(c)) sonuc.push(c);
      c.bul(kosul, sonuc);
    }
    return sonuc;
  }

  sinifVar(sinif) {
    return this.className.split(' ').includes(sinif);
  }
}

function sahteZaman(baslangic = 1_000_000) {
  let t = baslangic;
  let sonId = 0;
  const bekleyenler = new Map();
  const SahteDate = class extends Date {
    static now() {
      return t;
    }
  };
  return {
    SahteDate,
    simdi: () => t,
    setTimeout(fn, ms = 0) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    ilerle(ms) {
      const hedef = t + ms;
      for (;;) {
        const sira = [...bekleyenler.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, b) => a[1].bitis - b[1].bitis)[0];
        if (!sira) break;
        t = sira[1].bitis;
        bekleyenler.delete(sira[0]);
        sira[1].fn();
      }
      t = hedef;
    },
  };
}

/** Bir karo modeli (ana sürecin yuzey-modeli.js rendererModeli çıktısı biçiminde). */
const karo = (id, etiket, ek = {}) => ({
  id,
  etiket,
  grup: 'diger',
  grupEtiketi: 'Diğer',
  altGrup: null,
  alan: id.split('.')[0],
  durum: 'kapali',
  yuzde: null,
  kullanilabilir: true,
  ulasilamiyor: false,
  sinif: 'zararsiz',
  parlaklikKontrol: false,
  tekrar: false,
  ozellik: null,
  varsayilanEylem: true,
  onayliServisler: [],
  simge: null,
  renk: null,
  boyut: 'normal',
  tepsi: false,
  ...ek,
});

const modelYap = (...karolar) => ({
  gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar }],
  sonlar: [],
  sayfalar: [],
  bilgi: null,
  bildirim: null,
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null },
});

/**
 * `okuYaniti`: (istek) => yanıt/söz ya da sabit yanıt. `calistirYaniti`: aynı. `dil`: durumAl yanıtındaki etkin arayüz dili.
 * Dönen nesne: oge(kimlik), cagrilar, zaman, durum(model), calistirmalar(), okumalar() ...
 */
function sayfayiKur({ model, mod = 'panel', calistirYaniti = { ok: true }, okuYaniti = { ok: true, veri: [] }, dil } = {}) {
  const odak = { aktif: null };
  const ogeler = new Map();
  for (const [, kimlik] of HTML.matchAll(/\bid="([^"]+)"/g)) {
    ogeler.set(kimlik, new SahteOge(new RegExp(`<(\\w+)[^>]*\\bid="${kimlik}"`).exec(HTML)?.[1] ?? 'div', kimlik, odak));
  }
  const ceviriOgeleri = [];
  for (const [, etiket, nitelikMetni, icMetin] of HTML.matchAll(/<(\w+)\b([^>]*\bdata-i18n(?:-attr)?="[^>]*)>([^<]*)/g)) {
    const nitelikler = Object.fromEntries([...nitelikMetni.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const oge = (nitelikler.id && ogeler.get(nitelikler.id)) || new SahteOge(etiket, nitelikler.id ?? null, odak);
    Object.assign(oge.attributes, nitelikler);
    if ('data-i18n' in nitelikler) oge.textContent = icMetin;
    ceviriOgeleri.push(oge);
  }
  const zaman = sahteZaman();
  const cagrilar = [];
  let durumDinleyici = null;
  let gosterDinleyici = null;
  let dilDinleyici = null;
  const kopru = {
    durumAl: async () => ({ ok: true, mod, model, ...(dil !== undefined ? { dil } : {}) }),
    onDurum: (cb) => {
      durumDinleyici = cb;
      return () => {};
    },
    onGoster: (cb) => {
      gosterDinleyici = cb;
      return () => {};
    },
    onDilDegisti: (cb) => {
      dilDinleyici = cb;
      return () => {};
    },
    calistir: async (yuk) => {
      cagrilar.push(['calistir', JSON.parse(JSON.stringify(yuk))]);
      return typeof calistirYaniti === 'function' ? calistirYaniti(yuk) : calistirYaniti;
    },
    oku: async (istek) => {
      cagrilar.push(['oku', JSON.parse(JSON.stringify(istek))]);
      return typeof okuYaniti === 'function' ? okuYaniti(istek) : okuYaniti;
    },
    bildirimKapat: async (anahtar) => {
      cagrilar.push(['bildirimKapat', anahtar]);
      return { ok: true };
    },
    basiliBasla: async (kimlik) => {
      cagrilar.push(['basiliBasla', kimlik]);
      return { ok: true };
    },
    basiliBirak: async (kimlik) => {
      cagrilar.push(['basiliBirak', kimlik]);
      return { ok: true };
    },
    sagTik: async (kimlik) => {
      cagrilar.push(['sagTik', kimlik]);
      return { ok: true };
    },
    kapat: () => cagrilar.push(['kapat']),
    boyut: (h) => cagrilar.push(['boyut', h]),
    haAc: async () => cagrilar.push(['haAc']),
    ayarlarAc: async () => cagrilar.push(['ayarlarAc']),
  };
  const belgeDinleyicileri = {};
  const pencereDinleyicileri = {};
  const govde = { className: '' };
  const kok = { dataset: {}, nitelikler: {}, setAttribute: (ad, deger) => (kok.nitelikler[ad] = deger) };
  const belge = {
    nodeType: 9,
    documentElement: kok,
    hidden: false,
    querySelectorAll: (secici) => ceviriOgeleri.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `yuzey.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket, null, odak),
    createElementNS: (ad, etiket) => {
      const oge = new SahteOge(etiket, null, odak);
      oge.namespaceURI = ad;
      return oge;
    },
    addEventListener: (ad, fn) => (belgeDinleyicileri[ad] ??= []).push(fn),
    get activeElement() {
      return odak.aktif;
    },
    body: govde,
  };
  const sandbox = {
    document: belge,
    setTimeout: (fn, ms) => zaman.setTimeout(fn, ms),
    clearTimeout: (id) => zaman.clearTimeout(id),
    Date: zaman.SahteDate,
    evYuzey: kopru,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (ad, fn) => (pencereDinleyicileri[ad] ??= []).push(fn);
  vm.createContext(sandbox);
  for (const [ad, kaynak] of BETIKLER) vm.runInContext(kaynak, sandbox, { filename: ad });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    zaman,
    govde,
    sandbox,
    durum: (yeniModel) => durumDinleyici(yeniModel),
    goster: (kip) => gosterDinleyici({ mod: kip }),
    dilDegisti: (yuk) => dilDinleyici(yuk),
    belgeOlayi: (tip, ek) => {
      const olay = { type: tip, preventDefault() { this.onlendi = true; }, ...ek };
      (belgeDinleyicileri[tip] ?? []).forEach((fn) => fn(olay));
      return olay;
    },
    pencereOlayi: (tip) => (pencereDinleyicileri[tip] ?? []).forEach((fn) => fn({ type: tip })),
    calistirmalar: () => cagrilar.filter((c) => c[0] === 'calistir').map((c) => c[1]),
    okumalar: () => cagrilar.filter((c) => c[0] === 'oku').map((c) => c[1]),
    bul: (kosul) => ogeler.get('icerik').bul(kosul),
    ipucu: () => ogeler.get('ipucu').textContent,
  };
}

const akit = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((coz) => setImmediate(coz));
};

async function panelAc(secenek) {
  const sayfa = sayfayiKur(secenek);
  await akit();
  sayfa.goster('panel');
  await akit();
  return sayfa;
}

const siniflar = (o) => `${o.className} ${o.attributes.class ?? ''}`.split(/\s+/).filter(Boolean);
const sinifli = (o, ad) => siniflar(o).includes(ad);
const bulSinif = (sayfa, ad) => sayfa.bul((o) => sinifli(o, ad));
const duz = (x) => JSON.parse(JSON.stringify(x)); // vm bağlamından gelen nesneler Node'un deepEqual'ında farklı prototipli sayılır

module.exports = { SahteOge, sahteZaman, karo, modelYap, sayfayiKur, akit, panelAc, siniflar, sinifli, bulSinif, duz };
