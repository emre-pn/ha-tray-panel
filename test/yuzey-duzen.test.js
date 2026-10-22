'use strict';

/**
 * Hızlı panel düzeni (1.4.0 düzen grubu; o-16, o-24, o-31): sayfa sekmeleri, karo ayrıntı bölmesi (uzun basma, Shift+Enter, "⋯"),
 * sağ tık (yalnız varlık kimliği ana sürece gider), karo görünümü (simge, renk, boyut) ve CSS kuralları.
 * Gerçek yuzey-sayfa.js + yuzey-duzen.js + lib/karo-gorunum.js, sahte DOM / sahte zaman ile çalıştırılır (GUI, ağ yok).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const HTML = oku('src/yuzey.html');
const CSS = oku('src/yuzey.css');
const DIL = oku('src/lib/dil.js');
const SOZLUK = oku('src/lib/ceviri/yuzey.js');
const ARAMA = oku('src/lib/arama.js');
const KAYDIRICI = oku('src/lib/kaydirici.js');
const GORUNUM = oku('src/lib/karo-gorunum.js');
const DUZEN = oku('src/yuzey-duzen.js');
const BETIK = oku('src/yuzey-sayfa.js');
const KaroGorunum = require('../src/lib/karo-gorunum');

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
    this.offsetHeight = 0;
    this.scrollTop = 0;
    this.title = '';
    this.type = '';
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
}

function sahteZaman() {
  let t = 1_000_000;
  let sonId = 0;
  const bekleyenler = new Map();
  const SahteDate = class extends Date {
    static now() {
      return t;
    }
  };
  return {
    SahteDate,
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
  ...ek,
});
const ISIK = karo('light.led_serit', 'LED şerit', { grup: 'isik', grupEtiketi: 'Işık', durum: 'acik', yuzde: 60, parlaklikKontrol: true });
const AMPUL = karo('light.ampul', 'Ampul', { grup: 'isik', grupEtiketi: 'Işık' });
const PRIZ = karo('switch.priz', 'Priz', { grup: 'diger', grupEtiketi: 'Diğer' });
const SAHNE = karo('scene.film', 'Film', { grup: 'sahne', grupEtiketi: 'Sahne', durum: 'notr' });
const SES_ARTIR = karo('button.pc_mediavolumeup', 'Ses +', { grup: 'medya', grupEtiketi: 'Medya', altGrup: 'ses', durum: 'notr', tekrar: true });
const PC_KAPAT = karo('button.pc_bilgisayari_kapat', 'PC kapat', { grup: 'pc', grupEtiketi: 'PC', sinif: 'yikici', durum: 'notr' });
const MODEL = () => ({
  gruplar: [
    { kod: 'isik', etiket: 'Işık', karolar: [ISIK, AMPUL] },
    { kod: 'sahne', etiket: 'Sahne', karolar: [SAHNE] },
    { kod: 'pc', etiket: 'PC', karolar: [PC_KAPAT] },
    { kod: 'medya', etiket: 'Medya', karolar: [SES_ARTIR] },
    { kod: 'diger', etiket: 'Diğer', karolar: [PRIZ] },
  ],
  sonlar: [SAHNE],
  sayfalar: [],
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null },
});
const SAYFALI = (ek = {}) => ({
  ...MODEL(),
  sayfalar: [
    { id: 'aksam', ad: 'Akşam', kimlikler: ['switch.priz', 'light.ampul', 'scene.film'] },
    { id: 'bos01', ad: 'Boş', kimlikler: [] },
  ],
  ...ek,
});

function sayfayiKur({ model = MODEL(), mod = 'panel', dil, sagTik = true, duzenYok = false, sagTikYaniti = { ok: true }, sayfaSec = true, sayfaSecYaniti = { ok: true } } = {}) {
  const odak = { aktif: null };
  const ogeler = new Map();
  for (const [, kimlik] of HTML.matchAll(/\bid="([^"]+)"/g)) {
    ogeler.set(kimlik, new SahteOge(new RegExp(`<(\\w+)[^>]*\\bid="${kimlik}"`).exec(HTML)?.[1] ?? 'div', kimlik, odak));
  }
  ogeler.get('sekmeler').hidden = /id="sekmeler"[^>]*\bhidden\b/.test(HTML);
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
    kapat: () => cagrilar.push(['kapat']),
    boyut: (h) => cagrilar.push(['boyut', h]),
    haAc: async () => cagrilar.push(['haAc']),
    ayarlarAc: async () => cagrilar.push(['ayarlarAc']),
    // palet "sayfa" satırı (o-24): ana süreç yanıtı; sayfaSec: false köprüde bu işlev yok demektir
    ...(sayfaSec
      ? {
          sayfaSec: async (kimlik) => {
            cagrilar.push(['sayfaSec', kimlik]);
            return typeof sayfaSecYaniti === 'function' ? sayfaSecYaniti(kimlik) : sayfaSecYaniti;
          },
        }
      : {}),
    ...(sagTik
      ? {
          sagTik: async (...arglar) => {
            cagrilar.push(['sagTik', ...arglar]);
            return sagTikYaniti;
          },
        }
      : {}),
  };
  const belgeDinleyicileri = {};
  const pencereDinleyicileri = {};
  const kokOge = { dataset: {}, setAttribute() {} };
  const belge = {
    nodeType: 9,
    documentElement: kokOge,
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
    body: { className: '' },
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
  vm.runInContext(DIL, sandbox, { filename: 'lib/dil.js' });
  vm.runInContext(SOZLUK, sandbox, { filename: 'lib/ceviri/yuzey.js' });
  vm.runInContext(ARAMA, sandbox, { filename: 'lib/arama.js' });
  vm.runInContext(KAYDIRICI, sandbox, { filename: 'lib/kaydirici.js' });
  if (!duzenYok) {
    vm.runInContext(GORUNUM, sandbox, { filename: 'lib/karo-gorunum.js' });
    vm.runInContext(DUZEN, sandbox, { filename: 'yuzey-duzen.js' });
  }
  const oncesi = { sandbox };
  vm.runInContext(BETIK, sandbox, { filename: 'yuzey-sayfa.js' });
  return {
    ...oncesi,
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    zaman,
    odakta: () => odak.aktif,
    odakVer: (oge) => oge.focus(),
    goster: (kip, ek = {}) => gosterDinleyici({ mod: kip, ...ek }),
    durum: (yeniModel) => durumDinleyici(yeniModel),
    dilDegisti: (yuk) => dilDinleyici(yuk),
    belgeOlayi: (tip, ek) => {
      const olay = { type: tip, preventDefault() { this.onlendi = true; }, ...ek };
      (belgeDinleyicileri[tip] ?? []).forEach((fn) => fn(olay));
      return olay;
    },
    calistirmalar: () => cagrilar.filter((c) => c[0] === 'calistir').map((c) => c[1]),
  };
}

const akit = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
};

async function panelAc(secenek) {
  const sayfa = sayfayiKur(secenek);
  await akit();
  sayfa.goster(secenek?.mod ?? 'panel');
  return sayfa;
}

/** Palete sorgu yazar ve satırları döner. */
const paletSorgula = (sayfa, metin) => {
  const arama = sayfa.oge('arama');
  arama.value = metin;
  arama.gonder('input');
  return sayfa.oge('icerik').bul((o) => sinifli(o, 'palet-satir'));
};
const paletEnter = (sayfa) => sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });

const duz = (x) => JSON.parse(JSON.stringify(x)); // vm bağlamından gelen nesneler Node'un deepEqual'ında farklı prototipli sayılır
const siniflar = (oge) => oge.className.split(' ').filter(Boolean);
const sinifli = (oge, sinif) => siniflar(oge).includes(sinif);
const icerik = (sayfa) => sayfa.oge('icerik');
/** Karo ana düğmesi (metni etiketle biter; simge varsa metnin başında olabilir). */
const dugmeBul = (sayfa, etiket) => icerik(sayfa).bul((o) => o.etiket === 'button' && sinifli(o, 'karo') && o.bul((c) => sinifli(c, 'karo-etiket') && c.textContent === etiket).length > 0)[0];
const sekmeler = (sayfa) => sayfa.oge('sekmeler').children;
const sekmeBul = (sayfa, ad) => sekmeler(sayfa).find((s) => s.textContent === ad);
const seciliSekme = (sayfa) => sekmeler(sayfa).find((s) => s.getAttribute('aria-selected') === 'true');
const karoEtiketleri = (sayfa) => icerik(sayfa).bul((o) => sinifli(o, 'karo-etiket')).map((o) => o.textContent);
const ayrintiVarMi = (sayfa) => icerik(sayfa).bul((o) => sinifli(o, 'ayrinti')).length > 0;
const kapatSayisi = (sayfa) => sayfa.cagrilar.filter((c) => c[0] === 'kapat').length;
const geriDugmesi = (sayfa) => icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-geri'))[0];

/** Basılı tutma: pointerdown (öğe + belge), süre, pointerup (öğe + belge). */
function basiliTut(sayfa, oge, ms, xy = { clientX: 10, clientY: 10 }) {
  oge.gonder('pointerdown', { button: 0, ...xy });
  sayfa.belgeOlayi('pointerdown', { button: 0, ...xy });
  sayfa.zaman.ilerle(ms);
}

function birak(sayfa, oge) {
  oge.gonder('pointerup', {});
  sayfa.belgeOlayi('pointerup', {});
}

// ---------------------------------------------------------------- saf işlevler

function modul() {
  const sandbox = { setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GORUNUM, sandbox);
  vm.runInContext(DUZEN, sandbox);
  return sandbox.EvYuzeyDuzen;
}

test('sayfalariDuzelt: geçersiz kimlik / yinelenen / bozuk kayıt düşer; ad ve varlık listesi sınırlanır', () => {
  const D = modul();
  const cok = Array.from({ length: 130 }, (_, i) => `light.l${i}`);
  const sonuc = D.sayfalariDuzelt([
    { id: 'abc', ad: 'x'.repeat(40), kimlikler: [...cok, 5, null, ''] },
    { id: 'abc', ad: 'yinelenen', kimlikler: [] },
    { id: 'A B', ad: 'geçersiz', kimlikler: [] },
    null,
    'metin',
    { id: 'tamam', kimlikler: 'liste-degil' },
  ]);
  assert.deepEqual(duz(sonuc.map((s) => s.id)), ['abc', 'tamam']);
  assert.equal(sonuc[0].ad.length, 24);
  assert.equal(sonuc[0].kimlikler.length, 100);
  assert.deepEqual(duz(sonuc[1]), { id: 'tamam', ad: '', kimlikler: [] });
  assert.deepEqual(duz(D.sayfalariDuzelt('x')), []);
  assert.equal(D.sayfalariDuzelt(Array.from({ length: 20 }, (_, i) => ({ id: `s${i}${i}${i}`, ad: 'a', kimlikler: [] }))).length, 12, 'en çok 12 sayfa');
});

test('sekme gezintisi: ok tuşları sarmalıdır, Home/End uçlara gider, bilinmeyen tuş null; silinmiş sayfa "Tümü"ne döner', () => {
  const D = modul();
  const sayfalar = [{ id: 'aaa' }, { id: 'bbb' }];
  assert.deepEqual(duz(D.sekmeKimlikleri(sayfalar)), ['tumu', 'aaa', 'bbb']);
  assert.equal(D.sekmeSec(sayfalar, 'tumu', 'ArrowRight'), 'aaa');
  assert.equal(D.sekmeSec(sayfalar, 'bbb', 'ArrowRight'), 'tumu');
  assert.equal(D.sekmeSec(sayfalar, 'tumu', 'ArrowLeft'), 'bbb');
  assert.equal(D.sekmeSec(sayfalar, 'aaa', 'End'), 'bbb');
  assert.equal(D.sekmeSec(sayfalar, 'bbb', 'Home'), 'tumu');
  assert.equal(D.sekmeSec(sayfalar, 'aaa', 'sonraki'), 'bbb');
  assert.equal(D.sekmeSec(sayfalar, 'aaa', 'onceki'), 'tumu');
  assert.equal(D.sekmeSec(sayfalar, 'aaa', 'Enter'), null);
  assert.equal(D.sayfaGecerli(sayfalar, 'aaa'), 'aaa');
  assert.equal(D.sayfaGecerli(sayfalar, 'silinmis'), 'tumu');
  assert.equal(D.sayfaGecerli([], 'aaa'), 'tumu');
});

test('sayfaKarolari: SAYFANIN sırası korunur; modelde olmayan ve yinelenen kimlikler atlanır', () => {
  const D = modul();
  const karolar = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(duz(D.sayfaKarolari({ kimlikler: ['c', 'x', 'a', 'c'] }, karolar).map((k) => k.id)), ['c', 'a']);
});

test('sutunSayisi ve kontrolDestekliMi: boyut sütunu 1/2/3; yıkıcı ve tekrarlayan karoda ayrıntı yoktur', () => {
  const D = modul();
  assert.deepEqual(['kucuk', 'normal', 'genis', 'buyuk', undefined].map((b) => D.sutunSayisi({ boyut: b })), [1, 1, 2, 3, 1]);
  assert.equal(D.kontrolDestekliMi({}), true);
  assert.equal(D.kontrolDestekliMi({ yikici: true }), false);
  assert.equal(D.kontrolDestekliMi({ tekrar: true }), false);
});

test('uzunBasmaOlustur: süre dolunca tamam; erken bırakma ve eşiği aşan hareket iptal eder', () => {
  const D = modul();
  const z = sahteZaman();
  let tamam = 0;
  const a = D.uzunBasmaOlustur({ zaman: z, tamam: () => (tamam += 1) });
  a.basla({ clientX: 0, clientY: 0 });
  z.ilerle(499);
  assert.equal(tamam, 0);
  assert.equal(a.aktifMi(), true);
  z.ilerle(1);
  assert.equal(tamam, 1);
  assert.equal(a.tetiklendiMi(), true);
  a.basla({ clientX: 0, clientY: 0 });
  z.ilerle(300);
  a.birak();
  z.ilerle(500);
  assert.equal(tamam, 1, 'bırakınca iptal');
  a.basla({ clientX: 0, clientY: 0 });
  a.hareket({ clientX: 6, clientY: 6 }); // ~8,5 px: eşik altı
  z.ilerle(500);
  assert.equal(tamam, 2, 'küçük titreme iptal etmez');
  a.basla({ clientX: 0, clientY: 0 });
  a.hareket({ clientX: 20, clientY: 0 });
  z.ilerle(600);
  assert.equal(tamam, 2, 'büyük hareket iptal eder');
});

// ---------------------------------------------------------------- sayfa sekmeleri (o-24)

test('sekmeler: sayfa yokken gizli ve panel bugünkü gibi sabit gruplarla çizilir', async () => {
  const sayfa = await panelAc();
  assert.equal(sayfa.oge('sekmeler').hidden, true);
  assert.equal(sayfa.oge('sekmeler').children.length, 0);
  assert.equal(icerik(sayfa).getAttribute('role'), null);
  assert.ok(karoEtiketleri(sayfa).includes('Ampul') && karoEtiketleri(sayfa).includes('PC kapat'));
});

test('sekmeler: "Tümü" + sayfalar tablist olarak çizilir; seçili sekme tek tab durağıdır; içerik tabpanel olur', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  const bar = sayfa.oge('sekmeler');
  assert.equal(bar.hidden, false);
  assert.equal(bar.getAttribute('role'), 'tablist');
  assert.ok(bar.getAttribute('aria-label'));
  assert.deepEqual(sekmeler(sayfa).map((s) => s.textContent), ['Tümü', 'Akşam', 'Boş']);
  assert.ok(sekmeler(sayfa).every((s) => s.getAttribute('role') === 'tab'));
  assert.deepEqual(sekmeler(sayfa).map((s) => s.tabIndex), [0, -1, -1]);
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü');
  assert.equal(icerik(sayfa).getAttribute('role'), 'tabpanel');
  assert.equal(icerik(sayfa).getAttribute('aria-labelledby'), 'sekme-tumu');
  assert.ok(karoEtiketleri(sayfa).includes('PC kapat'), 'Tümü: bugünkü sabit gruplar');
});

test('sekmeler: sayfa seçilince yalnız sayfanın karoları SAYFANIN sırasıyla görünür; palet kipinde sekme yok ve tüm karolar aranır', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  sekmeBul(sayfa, 'Akşam').gonder('click');
  assert.equal(seciliSekme(sayfa).textContent, 'Akşam');
  assert.equal(icerik(sayfa).getAttribute('aria-labelledby'), 'sekme-aksam');
  assert.deepEqual(karoEtiketleri(sayfa), ['Priz', 'Ampul', 'Film']);
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'bolum-baslik')).length, 0, 'sayfa görünümünde grup başlığı yok');
  sekmeBul(sayfa, 'Tümü').gonder('click');
  assert.ok(karoEtiketleri(sayfa).includes('LED şerit'));

  const palet = await panelAc({ model: SAYFALI(), mod: 'palet' });
  assert.equal(palet.oge('sekmeler').hidden, true);
  assert.equal(palet.oge('sekmeler').children.length, 0);
  assert.equal(icerik(palet).getAttribute('role'), 'listbox', 'palet listbox kalır');
});

test('palet: sayfa adı yazınca "sayfa" satırı çıkar; Enter servis çağırmaz, yalnız ana sürece sayfa kimliğini yollar; satırda "Sayfa" grubu ve "Sayfaya geç" yazar', async () => {
  const palet = await panelAc({ model: SAYFALI(), mod: 'palet' });
  const satirlar = paletSorgula(palet, 'aksam');
  assert.equal(satirlar.length, 1);
  assert.match(satirlar[0].textContent, /Akşam/);
  assert.match(satirlar[0].textContent, /Sayfa/);
  assert.match(satirlar[0].textContent, /Sayfaya geç/);
  assert.equal(satirlar[0].getAttribute('aria-selected'), 'true');
  paletEnter(palet);
  await akit();
  assert.deepEqual(palet.cagrilar.filter((c) => c[0] === 'sayfaSec'), [['sayfaSec', 'aksam']]);
  assert.deepEqual(palet.calistirmalar(), [], 'hiçbir servis çağrısı yok');
  assert.equal(palet.cagrilar.some((c) => c[0] === 'basiliBasla'), false);
  assert.equal(kapatSayisi(palet), 0, 'pencereyi ana süreç panele çevirir; sayfa kendiliğinden kapatmaz');
});

test('palet: "sayfa" yazınca Tümü ve bütün sayfalar listelenir; fare tıklaması da aynı yolu izler; cihaz satırları sayfa satırının önünde kalır', async () => {
  const palet = await panelAc({ model: SAYFALI(), mod: 'palet' });
  const hepsi = paletSorgula(palet, 'sayfa');
  assert.equal(hepsi.length, 3);
  for (const ad of ['Tümü', 'Akşam', 'Boş']) assert.equal(hepsi.filter((s) => s.textContent.includes(ad)).length, 1, ad);
  const bos = hepsi.find((s) => s.textContent.includes('Boş'));
  bos.gonder('click');
  await akit();
  assert.deepEqual(palet.cagrilar.filter((c) => c[0] === 'sayfaSec'), [['sayfaSec', 'bos01']]);

  const karisik = paletSorgula(palet, 'ampul');
  assert.match(karisik[0].textContent, /Ampul/);
  assert.equal(karisik.some((s) => /Sayfaya geç/.test(s.textContent)), false, 'ilgisiz sayfa satırı çıkmaz');
  assert.deepEqual(paletSorgula(palet, 'xyzxyz'), []);
});

test('palet: Shift+Enter sayfa satırında seviye menüsü açmaz; sayfa yoksa, boş sorguda ya da köprüde sayfaSec yoksa sayfa satırı çıkmaz', async () => {
  const palet = await panelAc({ model: SAYFALI(), mod: 'palet' });
  paletSorgula(palet, 'aksam');
  palet.oge('arama').gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false });
  assert.equal(palet.oge('icerik').bul((o) => sinifli(o, 'seviye')).length, 0);
  assert.equal(palet.cagrilar.filter((c) => c[0] === 'sayfaSec').length, 0);
  assert.equal(paletSorgula(palet, '').filter((s) => /Sayfaya geç/.test(s.textContent)).length, 0, 'boş sorguda sayfa satırı yok');

  const sayfasiz = await panelAc({ model: MODEL(), mod: 'palet' });
  assert.equal(paletSorgula(sayfasiz, 'sayfa').length, 0);
  const koprusuz = await panelAc({ model: SAYFALI(), mod: 'palet', sayfaSec: false });
  assert.equal(paletSorgula(koprusuz, 'aksam').length, 0);
});

test('palet: ana süreç sayfayı reddederse nedeni ipucunda söylenir ve palet açık kalır; hata sayfa kapatmaz', async () => {
  const palet = await panelAc({ model: SAYFALI(), mod: 'palet', sayfaSecYaniti: { ok: false, tur: 'bilinmiyor' } });
  paletSorgula(palet, 'aksam');
  paletEnter(palet);
  await akit();
  assert.match(palet.oge('ipucu').textContent, /Akşam sayfası açılamadı/);
  assert.equal(kapatSayisi(palet), 0);
  const kopuk = await panelAc({ model: SAYFALI(), mod: 'palet', sayfaSecYaniti: () => Promise.reject(new Error('x')) });
  paletSorgula(kopuk, 'aksam');
  paletEnter(kopuk);
  await akit();
  assert.match(kopuk.oge('ipucu').textContent, /açılamadı/);
});

test('panel gösterimi sayfa isteği taşırsa o sekme seçili açılır ve sekme çubuğu görünür kalır; palet kipinde istek yok sayılır; bilinmeyen sayfa Tümü sekmesine döner', async () => {
  const palet = await panelAc({ model: SAYFALI(), mod: 'palet' });
  assert.equal(palet.oge('sekmeler').hidden, true);
  palet.goster('panel', { sayfa: 'aksam' }); // ana süreç palet satırından sonra paneli bu sayfayla açar
  assert.equal(palet.oge('sekmeler').hidden, false, 'palet kipinden çıkınca sekme çubuğu görünür');
  assert.equal(seciliSekme(palet).textContent, 'Akşam');
  assert.deepEqual(karoEtiketleri(palet), ['Priz', 'Ampul', 'Film']);
  palet.goster('palet', { sayfa: 'aksam' });
  assert.equal(palet.oge('sekmeler').hidden, true);
  assert.equal(palet.oge('sekmeler').children.length, 0);
  palet.goster('panel');
  assert.equal(palet.oge('sekmeler').hidden, false);
  assert.equal(seciliSekme(palet).textContent, 'Akşam', 'istek olmadan yeniden açınca seçili sayfa korunur');
  palet.goster('panel', { sayfa: 'tumu' });
  assert.equal(seciliSekme(palet).textContent, 'Tümü');
  palet.goster('panel', { sayfa: 'silinmis' });
  assert.equal(seciliSekme(palet).textContent, 'Tümü');
  palet.goster('panel', { sayfa: 42 });
  assert.equal(seciliSekme(palet).textContent, 'Tümü', 'metin olmayan istek yok sayılır');
});

test('sekmeler: karosuz sayfa kısa bir açıklama gösterir; seçili sayfa model güncellenince korunur, silinirse Tümü\'ne dönülür', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  sekmeBul(sayfa, 'Boş').gonder('click');
  assert.match(icerik(sayfa).textContent, /Bu sayfada karo yok/);
  sekmeBul(sayfa, 'Akşam').gonder('click');
  const guncel = SAYFALI();
  guncel.gruplar[0].karolar = [{ ...AMPUL, durum: 'acik' }];
  sayfa.durum(guncel);
  assert.equal(seciliSekme(sayfa).textContent, 'Akşam', 'model güncellemesi seçimi bozmaz');
  assert.deepEqual(karoEtiketleri(sayfa), ['Priz', 'Ampul', 'Film']);
  const silinmis = SAYFALI();
  silinmis.sayfalar = [silinmis.sayfalar[1]];
  sayfa.durum(silinmis);
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü', 'silinen sayfa seçiliyse Tümü');
  assert.ok(karoEtiketleri(sayfa).includes('PC kapat'));
  const sayfasiz = SAYFALI();
  sayfasiz.sayfalar = [];
  sayfa.durum(sayfasiz);
  assert.equal(sayfa.oge('sekmeler').hidden, true, 'hiç sayfa kalmadıysa çubuk gizlenir');
});

test('sekmeler: klavye — sekmede oklar / Home / End sekmeyi seçer ve odağı ona verir; Ctrl+PageDown / PageUp sayfa değiştirir', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  const tumu = sekmeBul(sayfa, 'Tümü');
  const sag = tumu.gonder('keydown', { key: 'ArrowRight' });
  assert.equal(sag.onlendi, true);
  assert.equal(seciliSekme(sayfa).textContent, 'Akşam');
  assert.equal(sayfa.odakta(), seciliSekme(sayfa), 'odak yeni sekmede');
  sayfa.odakta().gonder('keydown', { key: 'End' });
  assert.equal(seciliSekme(sayfa).textContent, 'Boş');
  assert.equal(sayfa.odakta(), seciliSekme(sayfa));
  sayfa.odakta().gonder('keydown', { key: 'ArrowRight' });
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü', 'sarmal');
  sayfa.odakta().gonder('keydown', { key: 'ArrowRight', ctrlKey: true });
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü', 'değiştirici tuşla sekme gezintisi çalışmaz');

  const ctrl = sayfa.belgeOlayi('keydown', { key: 'PageDown', ctrlKey: true, target: icerik(sayfa) });
  assert.equal(ctrl.onlendi, true);
  assert.equal(seciliSekme(sayfa).textContent, 'Akşam');
  sayfa.belgeOlayi('keydown', { key: 'PageUp', ctrlKey: true, target: icerik(sayfa) });
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü');
  const yalnizPage = sayfa.belgeOlayi('keydown', { key: 'PageDown', target: icerik(sayfa) });
  assert.notEqual(yalnizPage.onlendi, true);
  assert.equal(seciliSekme(sayfa).textContent, 'Tümü', 'Ctrl olmadan PageDown sayfa değiştirmez');
});

test('sekmeler: sayfa adı yalnız textContent ile yazılır (zararlı ad öğe üretmez); adsız sayfa için ana sürecin verdiği ad kullanılır', async () => {
  const model = SAYFALI();
  model.sayfalar[0].ad = '<img onerror=alert(1)>';
  const sayfa = await panelAc({ model });
  assert.equal(sekmeler(sayfa)[1].textContent, '<img onerror=alert(1)>');
  assert.equal(sayfa.oge('sekmeler').bul((o) => o.etiket === 'img').length, 0);
});

test('sekmeler: dil İngilizceye geçince sabit sekme adları ve etiketler çevrilir', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  sayfa.dilDegisti({ dil: 'en' });
  assert.equal(sekmeler(sayfa)[0].textContent, 'All');
  assert.equal(sayfa.oge('sekmeler').getAttribute('aria-label'), 'Panel pages');
  sekmeBul(sayfa, 'Boş').gonder('click');
  assert.match(icerik(sayfa).textContent, /There are no tiles on this page/);
});

test('ızgara: geniş / büyük karo birden çok sütun kaplar; ok gezintisi bu satırları izler', async () => {
  const a = karo('light.a', 'A', { boyut: 'genis' });
  const b = karo('light.b', 'B');
  const c = karo('light.c', 'C');
  const d = karo('light.d', 'D', { boyut: 'buyuk' });
  const e = karo('light.e', 'E', { boyut: 'kucuk' });
  const model = { ...MODEL(), gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: [a, b, c, d, e] }], sonlar: [] };
  const sayfa = await panelAc({ model });
  const sarmalar = icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma'));
  assert.deepEqual(sarmalar.map((o) => siniflar(o).filter((s) => s.startsWith('boyut-'))), [['boyut-genis'], [], [], ['boyut-buyuk'], ['boyut-kucuk']]);
  // satırlar: [A(2), B(1)] [C(1)] [D(3)] [E(1)] — C, D'ye sığmadığı için satır orada biter
  const bas = (tus) => sayfa.belgeOlayi('keydown', { key: tus, target: sayfa.odakta() });
  sayfa.odakVer(dugmeBul(sayfa, 'A'));
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'B'));
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'C'), 'B satır sonu: sonraki satırın başı');
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'D'), 'C tek başına satır (D tam genişlik)');
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'E'));
});

// ---------------------------------------------------------------- ayrıntı bölmesi (o-16)

test('uzun basma (500 ms): ayrıntı bölmesi açılır, gruplar gizlenir, odak "Geri"ye gider; kısa tıklama ise eylem çalıştırır ve ayrıntı açmaz', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  basiliTut(sayfa, ampul, 200);
  assert.ok(sinifli(ampul, 'uzun-basma'), 'sessiz görsel ipucu');
  birak(sayfa, ampul);
  assert.ok(!sinifli(ampul, 'uzun-basma'));
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 1, 'kısa tıklama eylem çalıştırır');
  assert.equal(ayrintiVarMi(sayfa), false);

  sayfa.zaman.ilerle(500); // çift tık kilidi geçsin
  const ikinci = dugmeBul(sayfa, 'Ampul');
  basiliTut(sayfa, ikinci, 499);
  assert.equal(ayrintiVarMi(sayfa), false, '499 ms: henüz açılmadı');
  sayfa.zaman.ilerle(1);
  assert.equal(ayrintiVarMi(sayfa), true, '500 ms: ayrıntı açıldı');
  assert.equal(sayfa.calistirmalar().length, 1, 'uzun basma eylem çalıştırmadı');
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'bolum-baslik')).length, 0, 'gruplar gizli');
  assert.equal(sayfa.odakta(), geriDugmesi(sayfa));
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-baslik'))[0].textContent, 'Ampul');
});

test('uzun basma: imleç hâlâ basılıyken ayrıntı açılsa da odak "Geri"de kalır (bırakınca da) ve ok tuşu gezintisi çalışır', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  sayfa.odakVer(ampul);
  basiliTut(sayfa, ampul, 500); // belge düzeyinde pointerdown da gider: basılı fare yeniden çizimleri erteler
  assert.equal(ayrintiVarMi(sayfa), true);
  assert.equal(sayfa.odakta(), geriDugmesi(sayfa), 'basış sürerken odak gövdeye düşmez');
  birak(sayfa, ampul);
  sayfa.zaman.ilerle(10);
  assert.equal(sayfa.odakta(), geriDugmesi(sayfa), 'bırakınca da');
  const menu = icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-menu'))[0];
  sayfa.belgeOlayi('keydown', { key: 'ArrowRight', target: sayfa.odakta() });
  assert.equal(sayfa.odakta(), menu, 'klavye gezintisi ayrıntı bölmesinde çalışır');
});

test('uzun basma: bırakınca gelen tıklama yutulur (ışık açılıp kapanmaz); yutma süresi dolunca normal tıklama çalışır', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  basiliTut(sayfa, ampul, 500);
  birak(sayfa, ampul);
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 0, 'uzun basmanın bırakma tıklaması eylem değildir');
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 1, 'yutma tek seferliktir');
});

test('uzun basma: eşiği aşan hareket, pointerleave ve blur iptal eder', async () => {
  const sayfa = await panelAc();
  let ampul = dugmeBul(sayfa, 'Ampul');
  basiliTut(sayfa, ampul, 100, { clientX: 5, clientY: 5 });
  ampul.gonder('pointermove', { clientX: 60, clientY: 5 });
  sayfa.zaman.ilerle(700);
  assert.equal(ayrintiVarMi(sayfa), false, 'sürükleme');
  birak(sayfa, ampul);
  ampul = dugmeBul(sayfa, 'Ampul');
  basiliTut(sayfa, ampul, 200);
  ampul.gonder('pointerleave');
  sayfa.zaman.ilerle(700);
  assert.equal(ayrintiVarMi(sayfa), false, 'imleç düğmeden çıktı');
  birak(sayfa, ampul);
  basiliTut(sayfa, ampul, 200);
  ampul.gonder('blur');
  sayfa.zaman.ilerle(700);
  assert.equal(ayrintiVarMi(sayfa), false, 'odak kaybı');
});

test('Shift+Enter ayrıntı açar; düz Enter, Ctrl+Shift+Enter ve otomatik tekrar açmaz', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  ampul.gonder('keydown', { key: 'Enter' });
  ampul.gonder('keydown', { key: 'Enter', shiftKey: true, ctrlKey: true });
  ampul.gonder('keydown', { key: 'Enter', shiftKey: true, repeat: true });
  assert.equal(ayrintiVarMi(sayfa), false);
  const olay = ampul.gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(olay.onlendi, true);
  assert.equal(ayrintiVarMi(sayfa), true);
});

test('"⋯" düğmesi ayrıntı açar; klavye durağı değildir (tabIndex -1) ve adı karoyu söyler', async () => {
  const sayfa = await panelAc();
  const kontroller = icerik(sayfa).bul((o) => sinifli(o, 'karo-kontrol'));
  assert.ok(kontroller.length >= 3, 'zararsız karoların hepsinde var');
  assert.ok(kontroller.every((k) => k.tabIndex === -1 && k.type === 'button'));
  assert.equal(kontroller[0].getAttribute('aria-label'), 'LED şerit kontrolleri');
  assert.equal(kontroller[0].textContent, '⋯');
  kontroller[1].gonder('click');
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-baslik'))[0].textContent, 'Ampul');
});

test('yıkıcı ve tekrarlayan karoda ayrıntı / uzun basma / "⋯" YOKTUR: yıkıcı karo yalnız 0,8 sn basılı tutmayla çalışır', async () => {
  const sayfa = await panelAc();
  const pc = dugmeBul(sayfa, 'PC kapat');
  const ses = dugmeBul(sayfa, 'Ses +');
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'karo-kontrol')).filter((k) => k.getAttribute('aria-label').startsWith('PC') || k.getAttribute('aria-label').startsWith('Ses')).length, 0);
  pc.gonder('keydown', { key: 'Enter', shiftKey: true });
  ses.gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(ayrintiVarMi(sayfa), false, 'Shift+Enter yıkıcıda ayrıntı açmaz');
  pc.gonder('pointerdown', { button: 0, clientX: 1, clientY: 1 });
  sayfa.belgeOlayi('pointerdown', {});
  sayfa.zaman.ilerle(500);
  assert.equal(ayrintiVarMi(sayfa), false, '500 ms: yıkıcıda ayrıntı yok');
  assert.equal(sayfa.calistirmalar().length, 0, 'henüz eylem yok');
  sayfa.zaman.ilerle(400);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }], '0,8 sn basılı tutma değişmeden çalışır');
});

test('ayrıntı bölmesi: Esc önce bölmeyi kapatır, ikinci Esc paneli kapatır; "Geri" odağı karoya geri verir', async () => {
  const sayfa = await panelAc();
  sayfa.odakVer(dugmeBul(sayfa, 'Ampul'));
  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(ayrintiVarMi(sayfa), true);
  sayfa.belgeOlayi('keydown', { key: 'Escape', target: geriDugmesi(sayfa) });
  assert.equal(ayrintiVarMi(sayfa), false);
  assert.equal(kapatSayisi(sayfa), 0, 'ilk Esc yalnız bölmeyi kapattı');
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'Ampul'), 'odak karoya döndü');
  sayfa.belgeOlayi('keydown', { key: 'Escape', target: icerik(sayfa) });
  assert.equal(kapatSayisi(sayfa), 1, 'ikinci Esc paneli kapatır');

  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  geriDugmesi(sayfa).gonder('click');
  assert.equal(ayrintiVarMi(sayfa), false);
  assert.equal(sayfa.odakta(), dugmeBul(sayfa, 'Ampul'));
});

test('ayrıntı bölmesi: ışıkta parlaklık kontrolleri (hazır seviyeler + kaydırıcı) görünür ve eylem aynı yoldan gider', async () => {
  const sayfa = await panelAc();
  dugmeBul(sayfa, 'LED şerit').gonder('keydown', { key: 'Enter', shiftKey: true });
  const hazir = icerik(sayfa).bul((o) => sinifli(o, 'hazir') && o.textContent === '%50')[0];
  assert.ok(hazir, 'ayrıntıda hazır seviyeler var');
  assert.ok(icerik(sayfa).bul((o) => o.type === 'range').length === 1);
  hazir.gonder('click');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 50, sonDeger: true }]);
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-ust')).length, 1);
});

test('ayrıntı bölmesi: tek tıklama eylemi olmayan (yalnız durum) karoda not gösterilir, eylem düğmesi yoktur', async () => {
  const iklim = karo('climate.salon', 'Salon', { grup: 'diger', durum: 'notr', varsayilanEylem: false });
  const model = { ...MODEL(), gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: [iklim] }], sonlar: [] };
  const sayfa = await panelAc({ model });
  dugmeBul(sayfa, 'Salon').gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.match(icerik(sayfa).textContent, /Bu karo yalnızca durum gösterir/);
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'karo')).length, 0);
});

test('detayKaydet: başka gruplar alana özel kontrol ekler; kayıt hatası bölmeyi bozmaz', async () => {
  const iklim = karo('climate.salon', 'Salon', { grup: 'diger', durum: 'notr', varsayilanEylem: false });
  const model = { ...MODEL(), gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: [iklim, PRIZ] }], sonlar: [] };
  const sayfa = sayfayiKur({ model });
  sayfa.sandbox.EvYuzeyDuzen.detayKaydet('climate', (k, kap, ortak) => kap.appendChild(ortak.olustur('p', 'iklim-ozel', `${k.etiket} ısı`)));
  sayfa.sandbox.EvYuzeyDuzen.detayKaydet('switch', () => {
    throw new Error('kötü eklenti');
  });
  await akit();
  sayfa.goster('panel');
  dugmeBul(sayfa, 'Salon').gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'iklim-ozel'))[0].textContent, 'Salon ısı');
  geriDugmesi(sayfa).gonder('click');
  dugmeBul(sayfa, 'Priz').gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(ayrintiVarMi(sayfa), true, 'eklenti hata verse de ayrıntı açıldı');
  assert.ok(geriDugmesi(sayfa));
});

test('ayrıntı bölmesi: pencere yeniden gösterilince kapanır ama seçili sayfa korunur; karo modelden kalkarsa bölme kapanır', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  sekmeBul(sayfa, 'Akşam').gonder('click');
  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(ayrintiVarMi(sayfa), true);
  sayfa.goster('panel');
  assert.equal(ayrintiVarMi(sayfa), false);
  assert.equal(seciliSekme(sayfa).textContent, 'Akşam');
  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  const ampulsuz = SAYFALI();
  ampulsuz.gruplar[0].karolar = [ISIK];
  sayfa.durum(ampulsuz);
  assert.equal(ayrintiVarMi(sayfa), false, 'karo kalktı: bölme kapandı');
});

test('sekme seçmek açık ayrıntıyı kapatır', async () => {
  const sayfa = await panelAc({ model: SAYFALI() });
  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  sekmeBul(sayfa, 'Akşam').gonder('click');
  assert.equal(ayrintiVarMi(sayfa), false);
  assert.deepEqual(karoEtiketleri(sayfa), ['Priz', 'Ampul', 'Film']);
});

// ---------------------------------------------------------------- sağ tık (o-16)

test('sağ tık: yalnız varlık kimliği ana sürece gider; varsayılan menü engellenir; yıkıcı karoda da bağlıdır', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  const sarma = icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma') && o.children.includes(ampul))[0];
  const olay = sarma.gonder('contextmenu', { clientX: 5, clientY: 6 });
  assert.equal(olay.onlendi, true);
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'sagTik'), [['sagTik', 'light.ampul']], 'koordinat, ad, durum gitmez');
  dugmeBul(sayfa, 'PC kapat').gonder('contextmenu', {});
  dugmeBul(sayfa, 'Ses +').gonder('contextmenu', {});
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'sagTik').map((c) => c[1]), ['light.ampul', 'button.pc_bilgisayari_kapat', 'button.pc_mediavolumeup']);
  assert.equal(sayfa.calistirmalar().length, 0, 'sağ tık HA eylemi çalıştırmaz');
});

test('sağ tık: ışık karosunda da çalışır; uzun basmanın ürettiği bağlam menüsü olayı yutulur; köprüde sagTik yoksa sessizce geçilir', async () => {
  const sayfa = await panelAc();
  const kutu = icerik(sayfa).bul((o) => sinifli(o, 'isik-karo'))[0];
  kutu.gonder('contextmenu', {});
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'sagTik').map((c) => c[1]), ['light.led_serit']);

  const ampul = dugmeBul(sayfa, 'Ampul');
  const sarma = icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma') && o.children.includes(ampul))[0];
  basiliTut(sayfa, ampul, 500);
  sarma.gonder('contextmenu', {}); // dokunmatikte aynı basış bağlam menüsü olayı da üretir
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'sagTik').length, 1, 'ayrıntı açıldıysa menü açılmaz');

  const eski = await panelAc({ sagTik: false });
  assert.doesNotThrow(() => dugmeBul(eski, 'Ampul').gonder('contextmenu', {}));
});

test('ayrıntı bölmesindeki "⋯" bağlam menüsünü ister', async () => {
  const sayfa = await panelAc();
  dugmeBul(sayfa, 'Ampul').gonder('keydown', { key: 'Enter', shiftKey: true });
  icerik(sayfa).bul((o) => sinifli(o, 'ayrinti-menu'))[0].gonder('click');
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'sagTik'), [['sagTik', 'light.ampul']]);
});

// ---------------------------------------------------------------- karo görünümü (o-31)

test('görünüm: simge (emoji / çizgi ikon), renk sınıfı ve boyut sınıfı uygulanır; metin etiketten ÖNCE gelen simge aria-hidden olur', async () => {
  const a = karo('light.a', 'A', { simge: '💡', renk: 'mavi', boyut: 'genis' });
  const b = karo('light.b', 'B', { simge: 'ikon:isik', renk: 'yesil', boyut: 'kucuk' });
  const c = karo('light.c', 'C', { simge: '', renk: null, boyut: 'normal' });
  const model = { ...MODEL(), gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: [a, b, c] }], sonlar: [] };
  const sayfa = await panelAc({ model });
  const da = dugmeBul(sayfa, 'A');
  assert.ok(sinifli(da, 'renk-mavi') && sinifli(da, 'simgeli'));
  // 2.0: simge karonun yuvarlak "madeni"sinin içindedir; madeni etiketten önce gelir ve süstür
  const madeniA = da.children[0];
  assert.deepEqual([madeniA.className, madeniA.getAttribute('aria-hidden')], ['karo-madeni', 'true']);
  const simgeA = madeniA.children[0];
  assert.deepEqual([simgeA.className, simgeA.getAttribute('aria-hidden'), simgeA.textContent], ['karo-simge emoji', 'true', '💡']);
  assert.ok(da.children[1].className.includes('karo-etiket'), 'simge etiketten önce');

  const db = dugmeBul(sayfa, 'B');
  const simgeB = db.children[0].children[0];
  assert.equal(simgeB.className, 'karo-simge ikon');
  const svg = simgeB.children[0];
  assert.equal(svg.etiket, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.children[0].getAttribute('d'), KaroGorunum.IKONLAR.isik);
  assert.equal(svg.textContent, '', 'SVG içinde metin yok');

  const dc = dugmeBul(sayfa, 'C');
  assert.deepEqual(siniflar(dc).filter((s) => s.startsWith('renk-') || s === 'simgeli'), []);
  // simge seçilmemiş karo alanının varsayılan ikonunu taşır (ışık: ampul); seçilen simge gibi metinsiz SVG
  const varsayilan = dc.children[0].children[0];
  assert.equal(varsayilan.etiket, 'svg');
  assert.equal(varsayilan.children[0].getAttribute('d'), KaroGorunum.IKONLAR.isik);
  assert.equal(dc.textContent, 'C' + dc.children[2].textContent, 'madeni metin eklemez');
  const sarmaSiniflari = icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma')).map(siniflar);
  assert.ok(sarmaSiniflari[0].includes('boyut-genis'));
  assert.ok(sarmaSiniflari[1].includes('boyut-kucuk'));
  assert.ok(!sarmaSiniflari[2].some((s) => s.startsWith('boyut-')), 'normal boyutta sınıf yok');
});

test('görünüm: renderer, ana süreçten gelse bile yasak simgeyi (kapı / kilit / siren emojisi), bilinmeyen rengi ve boyutu yeniden süzer; satır içi stil yazılmaz', async () => {
  const kotu = karo('light.k', 'K', { simge: '🔒', renk: 'javascript:alert(1)', boyut: 'span 99' });
  const kapi = karo('light.l', 'L', { simge: '🚪' });
  const siren = karo('light.m', 'M', { simge: '🚨', renk: 'kirmizi' });
  const baslik = karo('light.n', 'N', { simge: 'ikon:yok-boyle-ikon' });
  const model = { ...MODEL(), gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: [kotu, kapi, siren, baslik] }], sonlar: [] };
  const sayfa = await panelAc({ model });
  for (const etiket of ['K', 'L', 'M', 'N']) {
    const d = dugmeBul(sayfa, etiket);
    assert.equal(d.bul((o) => sinifli(o, 'karo-simge')).length, 0, `${etiket}: simge yok`);
    assert.ok(!sinifli(d, 'simgeli'));
    assert.deepEqual(Object.keys(d.style), [], `${etiket}: satır içi stil yok`);
  }
  assert.ok(!siniflar(dugmeBul(sayfa, 'K')).some((s) => s.startsWith('renk-')));
  assert.ok(sinifli(dugmeBul(sayfa, 'M'), 'renk-kirmizi'), 'geçerli renk yine uygulanır');
  assert.equal(icerik(sayfa).bul((o) => siniflar(o).some((s) => s.startsWith('boyut-'))).length, 0);
});

test('görünüm: yıkıcı ve tekrarlayan karo sarmasızdır, boyut sınıfı düğmenin kendisindedir; ışık karosu simge / renk taşır', async () => {
  const pc = { ...PC_KAPAT, boyut: 'genis', renk: 'kirmizi', simge: 'ikon:guc' };
  const ses = { ...SES_ARTIR, boyut: 'buyuk' };
  const isik = { ...ISIK, simge: '💡', renk: 'sari', boyut: 'kucuk' };
  const model = { ...MODEL(), gruplar: [{ kod: 'isik', etiket: 'Işık', karolar: [isik] }, { kod: 'pc', etiket: 'PC', karolar: [pc] }, { kod: 'medya', etiket: 'Medya', karolar: [ses] }], sonlar: [] };
  const sayfa = await panelAc({ model });
  const dpc = dugmeBul(sayfa, 'PC kapat');
  assert.ok(sinifli(dpc, 'boyut-genis') && sinifli(dpc, 'renk-kirmizi'));
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma') && o.children.includes(dpc)).length, 0, 'sarma yok');
  assert.ok(sinifli(dugmeBul(sayfa, 'Ses +'), 'boyut-buyuk'));
  const dl = dugmeBul(sayfa, 'LED şerit');
  assert.ok(sinifli(dl, 'renk-sari') && sinifli(dl, 'simgeli'));
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'isik-karo')).length, 1);
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'hazir')).length, 4, 'hazır seviyeler yerinde');
});

// ---------------------------------------------------------------- düzen modülü yokken geri dönüş

test('yuzey-duzen.js yüklenmese bile panel eskisi gibi çalışır (sekme, sarma, ayrıntı yok)', async () => {
  const sayfa = await panelAc({ model: SAYFALI(), duzenYok: true });
  assert.equal(sayfa.oge('sekmeler').hidden, true);
  assert.equal(icerik(sayfa).bul((o) => sinifli(o, 'karo-sarma') || sinifli(o, 'karo-kontrol')).length, 0);
  const ampul = icerik(sayfa).bul((o) => o.etiket === 'button' && o.textContent.startsWith('Ampul'))[0];
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 1);
});

// ---------------------------------------------------------------- kaynak / CSS / HTML

test('yuzey.html: #sekmeler gizli başlar; betik sırası karo-gorunum.js, yuzey-duzen.js, yuzey-sayfa.js; CSP gevşemez', () => {
  assert.match(HTML, /<div id="sekmeler" class="sekmeler" hidden><\/div>/);
  const sira = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sira.indexOf('lib/karo-gorunum.js') < sira.indexOf('yuzey-duzen.js'));
  assert.ok(sira.indexOf('yuzey-duzen.js') < sira.indexOf('yuzey-sayfa.js'));
  assert.match(HTML, /script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(HTML, /<script>|style=|onclick=/);
});

test('yuzey-duzen.js: HTML ataması, satır içi stil, eval ve require yok; DOM yalnız textContent / setAttribute ile kurulur', () => {
  const kod = DUZEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(kod, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.style\b|require\(|setAttribute\(\s*['"]on/);
  assert.doesNotMatch(kod, /fetch\(|XMLHttpRequest|WebSocket/);
});

const yorumsuz = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const bosluksuz = (s) => s.trim().replace(/\s+/g, ' ');
const kurallar = (css) => [...yorumsuz(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ secici: bosluksuz(m[1]), govde: m[2] }));
const degiskenler = (govde) => Object.fromEntries([...govde.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], bosluksuz(m[2])]));

function temalar() {
  const temiz = yorumsuz(CSS);
  const bas = temiz.indexOf('@media (prefers-color-scheme: light)');
  const ilk = (metin) => degiskenler(kurallar(metin).find((k) => k.secici === ':root')?.govde ?? '');
  return { koyu: ilk(temiz.slice(0, bas)), acik: ilk(temiz.slice(bas)) };
}

function parlaklik(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [acik, koyu] = [parlaklik(a), parlaklik(b)].sort((x, y) => y - x);
  return (acik + 0.05) / (koyu + 0.05);
}

test('CSS: her hazır renk için iki temada ayrı --renk-* değişkeni ve .renk-* sınıfı vardır; renkler zeminlerinde okunur (>= 4,5 --karo, >= 3 diğer yüzeyler)', () => {
  const { koyu, acik } = temalar();
  const sinifGovdeleri = kurallar(CSS);
  for (const renk of KaroGorunum.RENKLER) {
    for (const [ad, tema] of [['koyu', koyu], ['açık', acik]]) {
      assert.match(tema[`--renk-${renk}`] ?? '', /^#[0-9a-f]{6}$/i, `${ad}: --renk-${renk}`);
      assert.ok(kontrast(tema[`--renk-${renk}`], tema['--karo']) >= 4.5, `${ad}: ${renk} / --karo = ${kontrast(tema[`--renk-${renk}`], tema['--karo']).toFixed(2)}`);
      for (const zemin of ['--bg', '--bg-ust', '--karo-uzerinde']) {
        assert.ok(kontrast(tema[`--renk-${renk}`], tema[zemin]) >= 3, `${ad}: ${renk} / ${zemin}`);
      }
    }
    const kural = sinifGovdeleri.find((k) => k.secici === `.renk-${renk}`);
    assert.ok(kural, `.renk-${renk} sınıfı`);
    assert.match(kural.govde, new RegExp(`--renk:\\s*var\\(--renk-${renk}\\)`));
  }
  assert.deepEqual(Object.keys(koyu).sort(), Object.keys(acik).sort(), 'iki temada aynı değişkenler');
});

test('CSS: boyut sınıfları sütun sayısıyla uyumlu; sekme, ayrıntı ve uzun basma kuralları var; hareket azaltma ipucunu kapatır; bileşen kurallarında sabit renk yok', () => {
  const k = kurallar(CSS);
  const govde = (secici) => k.filter((r) => r.secici.split(',').map(bosluksuz).includes(secici)).map((r) => r.govde).join(';');
  assert.match(govde('.boyut-genis'), /grid-column:\s*span 2/);
  assert.match(govde('.boyut-buyuk'), /grid-column:\s*1 \/ -1/);
  for (const [boyut, sutun] of Object.entries(KaroGorunum.BOYUT_SUTUNU)) {
    if (boyut === 'normal' || boyut === 'kucuk') assert.equal(sutun, 1);
  }
  for (const s of ['.sekmeler', '.sekme', '.sekme.secili', '.karo-sarma', '.karo-kontrol', '.karo-simge', '.ayrinti', '.ayrinti-ust', '.ayrinti-geri', '.ayrinti-govde', '.karo.uzun-basma::after']) {
    assert.ok(govde(s), `${s} kuralı`);
  }
  assert.match(govde('.sekmeler[hidden]'), /display:\s*none/, 'hidden özniteliği display:flex tarafından ezilmez');
  assert.match(govde('.karo.durum-acik .karo-simge'), /color:\s*var\(--renk,\s*var\(--acik\)\)/, 'açık karoda simge vurgulanır (seçilen renk varsa o kalır)');
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.karo\.uzun-basma::after\s*\{\s*content:\s*none/);
  const disarida = k.filter((r) => !r.secici.startsWith(':root')).map((r) => r.govde).join('\n');
  assert.doesNotMatch(disarida, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

test('CSS: "Hareketi azalt" ayarı (<html data-hareket>) uzun basma çizgisini de kapatır; yıkıcı karonun 0,8 sn dolumu hareketi azaltınca da çalışır', () => {
  const k = kurallar(CSS);
  const govde = (secici) => k.filter((r) => r.secici.split(',').map(bosluksuz).includes(secici)).map((r) => r.govde).join(';');
  assert.match(govde(':root[data-hareket="azalt"] .karo.uzun-basma::after'), /content:\s*none/);
  // işlevsel geri bildirim: dolum ilerlemesi hareketi azalt kurallarının hiçbirinde kapatılmaz
  const azaltKurallari = k.filter((r) => r.secici.includes('[data-hareket="azalt"]')).map((r) => r.secici + '{' + r.govde + '}').join('\n');
  assert.doesNotMatch(azaltKurallari, /basili|dolum/);
  assert.match(govde('.karo.basili::after'), /animation:\s*dolum 800ms linear forwards/);
});

test('çeviri: yeni panel anahtarlarının hepsi iki dilde var ve Türkçe karşılıkları boş değil', () => {
  const sandbox = { window: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DIL, sandbox);
  vm.runInContext(SOZLUK, sandbox);
  const tr = sandbox.EvDil.cevirmen('tr', sandbox.EvCeviriYuzey);
  const en = sandbox.EvDil.cevirmen('en', sandbox.EvCeviriYuzey);
  for (const anahtar of ['yuzey.sekme.etiket', 'yuzey.sekme.tumu', 'yuzey.sayfa.bos', 'yuzey.sayfa.bosAlt', 'yuzey.karo.kontrollerAc', 'yuzey.ayrinti.etiket', 'yuzey.ayrinti.geri', 'yuzey.ayrinti.menu', 'yuzey.ayrinti.yalnizDurum']) {
    assert.ok(tr(anahtar, { etiket: 'X' }) && tr(anahtar, { etiket: 'X' }) !== anahtar, `${anahtar} tr`);
    assert.ok(en(anahtar, { etiket: 'X' }) && en(anahtar, { etiket: 'X' }) !== anahtar, `${anahtar} en`);
    assert.doesNotMatch(en(anahtar, { etiket: 'X' }), /[çğıöşüÇĞİÖŞÜ]/, `${anahtar}: İngilizce metinde Türkçe harf yok`);
  }
});
