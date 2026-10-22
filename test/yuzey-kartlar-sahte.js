'use strict';

/**
 * Hızlı panel / palet sayfası (src/yuzey-sayfa.js) ve 1.4.0 cihaz kartları (src/yuzey-kartlar.js) için SAHTE DOM (test/yuzey-kartlar*.test.js).
 * test/yuzey-sayfa.test.js ile aynı yaklaşım: gerçek tarayıcı, Electron ya da pencere YOK; zamanlayıcılar ve Date sahtedir ("0,8 sn basılı
 * tut", "400 ms'de birleşen ± düğmeleri" gibi süreler milisaniye milisaniye sınanır). Fark: bu harness yuzey-kartlar.js'i de yükler.
 * Görsel görünüm (CSS) burada denenmez; o elle denenir.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(KOK, 'src', 'yuzey.html'), 'utf8');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const BETIKLER = [
  ['lib/dil.js', oku('src/lib/dil.js')],
  ['lib/ceviri/yuzey.js', oku('src/lib/ceviri/yuzey.js')],
  ['lib/arama.js', oku('src/lib/arama.js')],
  ['lib/kaydirici.js', oku('src/lib/kaydirici.js')],
  ['lib/ikon-seti.js', oku('src/lib/ikon-seti.js')], // 1.7.0 arayüz ikonları (yuzey.html'de kartlardan önce yüklenir)
  ['yuzey-kartlar.js', oku('src/yuzey-kartlar.js')],
  ['yuzey-kamera.js', oku('src/yuzey-kamera.js')], // 1.4.0 cihaz (o-48): sayfa bu modülü window.EvYuzeyKamera ile bulur
  ['yuzey-sayfa.js', oku('src/yuzey-sayfa.js')],
];
// 1.7.0: ışık satırında hazır seviyeler, kaydırıcı ve renkler yalnız ayrıntı bölmesindedir; ayrıntıyı "⋯" düğmesi açar. Bölme yuzey-duzen.js
// ile gelir; ama düzen modülü karoları sarar (karo-sarma, "⋯") ve öteki testleri değiştirir: yalnız `duzen: true` isteyen sayfa yükler.
const DUZEN_BETIKLERI = [
  ['lib/karo-gorunum.js', oku('src/lib/karo-gorunum.js')],
  ['yuzey-duzen.js', oku('src/yuzey-duzen.js')],
];

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
    this.tabIndex = 0;
    this._deger = '';
    this._metin = '';
    this.odakSayisi = 0;
    this.yakalayanlar = new Set();
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
    this.attributes[ad] = deger;
  }

  getAttribute(ad) {
    return this.attributes[ad] ?? null;
  }

  removeAttribute(ad) {
    delete this.attributes[ad];
  }

  addEventListener(ad, isleyici, secenek) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
    // Yakalama evresi dinleyicisi (üçüncü bağımsız değişken true ya da { capture: true }) gonder'de öğenin öteki dinleyicilerinden önce çalışır
    if (secenek === true || (secenek && secenek.capture === true)) this.yakalayanlar.add(isleyici);
  }

  focus() {
    this.odakSayisi += 1;
    this.odak.aktif = this;
  }

  scrollIntoView() {}

  gonder(tip, ek = {}) {
    const olay = { type: tip, target: this, preventDefault() { this.onlendi = true; }, stopImmediatePropagation() { this.durduruldu = true; }, ...ek };
    const hepsi = this.dinleyiciler[tip] ?? [];
    const sira = [...hepsi.filter((i) => this.yakalayanlar.has(i)), ...hepsi.filter((i) => !this.yakalayanlar.has(i))];
    for (const isleyici of sira) {
      if (olay.durduruldu) break;
      isleyici(olay);
    }
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
  ...ek,
});

const modelYap = (...karolar) => ({
  gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar }],
  sonlar: [],
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null },
});

/**
 * `dil`: durumAl yanıtındaki etkin dil. `calistirYaniti`: sabit yanıt ya da (yuk) => yanıt/söz.
 * Dönen nesne: oge(kimlik), cagrilar, zaman, durum(model), calistirmalar() ...
 */
function sayfayiKur({ model, mod = 'panel', calistirYaniti = { ok: true }, dil, kartlarYok = false, duzen = false, kameraYaniti = null, etkilesim, gorunum, temaRenk = false, sabitleYaniti = (istenen) => ({ ok: true, sabit: istenen }) } = {}) {
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
  let etkilesimDinleyici = null;
  const kopru = {
    durumAl: async () => ({ ok: true, mod, model, ...(dil !== undefined ? { dil } : {}), ...(etkilesim !== undefined ? { etkilesim } : {}), ...(gorunum !== undefined ? { gorunum } : {}) }),
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
    // 1.4.0 etkileşim (o-20, o-23): ayar değişti olayı ve iğne düğmesi (yuzey:sabitle)
    onEtkilesim: (cb) => {
      etkilesimDinleyici = cb;
      return () => {};
    },
    sabitle: async (istenen) => {
      cagrilar.push(['sabitle', istenen]);
      return typeof sabitleYaniti === 'function' ? sabitleYaniti(istenen) : sabitleYaniti;
    },
    calistir: async (yuk) => {
      cagrilar.push(['calistir', JSON.parse(JSON.stringify(yuk))]);
      return typeof calistirYaniti === 'function' ? calistirYaniti(yuk) : calistirYaniti;
    },
    basiliBasla: async (kimlik) => {
      cagrilar.push(['basiliBasla', kimlik]);
      return { ok: true };
    },
    basiliBirak: async (kimlik) => {
      cagrilar.push(['basiliBirak', kimlik]);
      return { ok: true };
    },
    // 1.4.0 (o-48): yuzey:kamera köprüsü; kameraYaniti verilmezse köprüde kamera yoktur (sayfa kamerasız çalışır)
    ...(kameraYaniti !== null
      ? {
          kamera: async (kimlik) => {
            cagrilar.push(['kamera', kimlik]);
            return typeof kameraYaniti === 'function' ? kameraYaniti(kimlik) : kameraYaniti;
          },
        }
      : {}),
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
    querySelectorAll: (secici) => ceviriOgeleri.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `yuzey.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket, null, odak),
    createElementNS: (adAlani, etiket) => new SahteOge(etiket, null, odak), // 1.7.0 svg ikonları (lib/ikon-seti.js)
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
  for (const [ad, kaynak] of BETIKLER) {
    if (kartlarYok && ad === 'yuzey-kartlar.js') continue;
    if (duzen && ad === 'yuzey-sayfa.js') for (const [duzenAd, duzenKaynak] of DUZEN_BETIKLERI) vm.runInContext(duzenKaynak, sandbox, { filename: duzenAd });
    vm.runInContext(kaynak, sandbox, { filename: ad });
  }
  // yuzey.html'de lib/tema-renk.js sayfa betiğinden SONRA yüklenir; ilk durum-al yanıtı gelmeden hazırdır (temaRenk: true)
  if (temaRenk) vm.runInContext(oku('src/lib/tema-renk.js'), sandbox, { filename: 'lib/tema-renk.js' });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    zaman,
    govde,
    sandbox,
    durum: (yeniModel) => durumDinleyici(yeniModel),
    goster: (kip) => gosterDinleyici({ mod: kip }),
    dilDegisti: (yuk) => dilDinleyici(yuk),
    /** Ana sürecin 'yuzey:etkilesim' iletisi ({ tekerlek, sabit }) */
    etkilesimDegisti: (yuk) => etkilesimDinleyici(yuk),
    sabitlemeler: () => cagrilar.filter((c) => c[0] === 'sabitle').map((c) => c[1]),
    belgeOlayi: (tip, ek) => {
      const olay = { type: tip, preventDefault() { this.onlendi = true; }, ...ek };
      (belgeDinleyicileri[tip] ?? []).forEach((fn) => fn(olay));
      return olay;
    },
    pencereOlayi: (tip) => (pencereDinleyicileri[tip] ?? []).forEach((fn) => fn({ type: tip })),
    calistirmalar: () => cagrilar.filter((c) => c[0] === 'calistir').map((c) => c[1]),
    basiliBaslamalar: () => cagrilar.filter((c) => c[0] === 'basiliBasla').map((c) => c[1]),
    kameraIstekleri: () => cagrilar.filter((c) => c[0] === 'kamera').map((c) => c[1]),
    /** İçerikte koşula uyan ilk / tüm öğeler */
    bul: (kosul) => ogeler.get('icerik').bul(kosul),
    ipucu: () => ogeler.get('ipucu').textContent,
  };
}

const akit = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
};

async function panelAc(secenek) {
  const sayfa = sayfayiKur(secenek);
  await akit();
  sayfa.goster('panel');
  return sayfa;
}

async function paletAc(secenek) {
  const sayfa = sayfayiKur({ ...secenek, mod: 'palet' });
  await akit();
  sayfa.goster('palet');
  return sayfa;
}

/** Palete sorgu yazar (input olayı). */
function sorguYaz(sayfa, metin) {
  const arama = sayfa.oge('arama');
  arama.value = metin;
  arama.gonder('input');
}

/** Palette Enter. */
const enter = (sayfa) => sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });

/** İlk düğme: sınıf adı ve/veya metne göre. */
const dugmeler = (sayfa, kosul = () => true) => sayfa.bul((o) => o.etiket === 'button' && kosul(o));
const dugmeAra = (sayfa, aria) => dugmeler(sayfa, (o) => o.attributes['aria-label'] === aria)[0];
const kartlar = (sayfa) => sayfa.bul((o) => o.sinifVar('kart'));
const paletSatirlari = (sayfa) => sayfa.bul((o) => o.sinifVar('palet-satir'));

/**
 * 1.7.0: ışık satırı kompakttır; hazır seviyeler, kaydırıcı ve renkler satırdaki "⋯" (karo-kontrol) düğmesiyle açılan ayrıntı bölmesindedir.
 * Bu yardımcı o düğmeye basar (`duzen: true` ile kurulmuş sayfa gerekir) ve ayrıntı bölmesini döner.
 */
function ayrintiAc(sayfa, etiket) {
  // Işığın satırı: adı `etiket` olan karo düğmesini taşıyan kapsayıcı (arayüz dili ne olursa olsun çalışsın diye ipucu metnine bakılmaz)
  const satir = sayfa.bul((o) => o.sinifVar('isik-karo') && o.bul((c) => c.sinifVar('karo-etiket') && c.textContent === etiket).length > 0)[0];
  const dugme = satir && satir.bul((o) => o.sinifVar('karo-kontrol'))[0];
  assert.ok(dugme, `${etiket}: "⋯" düğmesi yok (duzen: true ile kurulmuş mu?)`);
  dugme.gonder('click');
  const bolme = sayfa.bul((o) => o.sinifVar('ayrinti'))[0];
  assert.ok(bolme, `${etiket}: ayrıntı bölmesi açılmadı`);
  return bolme;
}

/** Basılı tutma: pointerdown, süre geçir, (bırakmadan) tamam. */
function basiliTut(sayfa, oge, ms = 900) {
  oge.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(ms);
}

module.exports = { SahteOge, sahteZaman, karo, modelYap, sayfayiKur, akit, panelAc, paletAc, sorguYaz, enter, dugmeler, dugmeAra, kartlar, paletSatirlari, basiliTut, ayrintiAc };
