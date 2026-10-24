'use strict';

/**
 * Düğmeli itme bildirimi kartının sayfa betiği (src/itme-kart-sayfa.js, o-61): küçük sahte DOM ile, gerçek pencere/Electron yok.
 * Kurallar: metinler yalnız textContent ile yazılır (HTML yorumlanmaz), düğmeye basınca ana sürece YALNIZ kart numarası ve düğme SIRASI gider,
 * en çok 3 düğme, × ve Esc kapatır, süre dolunca görünüm kalkar (HA'ya bir şey gitmez), geçersiz yük yok sayılır, dil değişince yalnız sabit metinler çevrilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');

class SahteOge {
  constructor(etiket, nitelikler = {}) {
    this.etiket = etiket;
    this.id = nitelikler.id ?? '';
    this.attributes = { ...nitelikler };
    this.children = [];
    this.parentNode = null;
    this.dinleyiciler = {};
    this.disabled = false;
    this.type = '';
    this.className = '';
    this.siniflar = new Set();
    this._metin = '';
    const o = this;
    this.classList = {
      add: (c) => o.siniflar.add(c),
      remove: (c) => o.siniflar.delete(c),
      contains: (c) => o.siniflar.has(c),
    };
  }

  get textContent() {
    return this._metin;
  }

  set textContent(deger) {
    this._metin = String(deger);
    this.children = [];
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }

  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
    return c;
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

  tikla() {
    for (const isleyici of this.dinleyiciler.click ?? []) isleyici({ type: 'click' });
  }
}

function sayfaKur({ evItme = true, sozlukYukle = true, azaltHareket = false } = {}) {
  const html = oku('src/itme-kart.html');
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
  const belgeDinleyicileri = {};
  const belge = {
    nodeType: 9,
    documentElement: kok,
    getElementById: (kimlik) => {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `itme-kart.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket),
    querySelectorAll: (secici) => tumu.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
    addEventListener: (ad, isleyici) => (belgeDinleyicileri[ad] ??= []).push(isleyici),
  };
  const cagrilar = { eylem: [], kapat: [] };
  const dinleyiciler = {};
  const zamanlayicilar = [];
  const temizlenenler = [];
  const gorunumCagrilari = [];
  const window = {
    matchMedia: () => ({ matches: azaltHareket }),
  };
  if (evItme) {
    window.evItme = {
      onGoster: (cb) => (dinleyiciler.goster = cb),
      onDilDegisti: (cb) => (dinleyiciler.dil = cb),
      eylem: (no, sira) => cagrilar.eylem.push([no, sira]),
      kapat: (no) => cagrilar.kapat.push([no]),
    };
  }
  window.EvTemaRenk = { gorunumUygula: (k, model, secenek) => gorunumCagrilari.push({ model, secenek }) };
  const sandbox = {
    document: belge,
    window,
    setTimeout: (fn, ms) => {
      zamanlayicilar.push({ fn, ms });
      return zamanlayicilar.length;
    },
    clearTimeout: (id) => temizlenenler.push(id),
  };
  vm.createContext(sandbox);
  if (sozlukYukle) {
    for (const lib of ['src/lib/dil.js', 'src/lib/ceviri/yuzey.js']) vm.runInContext(oku(lib), sandbox, { filename: lib });
    Object.assign(window, { EvDil: sandbox.EvDil, EvCeviriYuzey: sandbox.EvCeviriYuzey });
  }
  vm.runInContext(oku('src/itme-kart-sayfa.js'), sandbox, { filename: 'src/itme-kart-sayfa.js' });
  return {
    oge: (k) => ogeler.get(k),
    kok,
    cagrilar,
    zamanlayicilar,
    temizlenenler,
    gorunumCagrilari,
    baslik: () => tumu.find((o) => o.etiket === 'title'),
    gonder: (yuk) => dinleyiciler.goster(yuk),
    dilGonder: (yuk) => dinleyiciler.dil(yuk),
    tus: (key) => (belgeDinleyicileri.keydown ?? []).forEach((f) => f({ key })),
    dugmeler: () => ogeler.get('kartDugmeler').children,
    gorunur: () => ogeler.get('kart').classList.contains('gorunur'),
  };
}

const yuk = (ek = {}) => ({ kartNo: 7, baslik: 'Ev Paneli', mesaj: 'Hareket algılandı', dugmeler: ['Onayla', 'Ertele'], sureMs: 45000, malzeme: 'yok', ...ek });

test('gösterme: başlık, ileti ve düğme başlıkları yazılır; kart görünür olur; düğmeler type=button', () => {
  const s = sayfaKur();
  s.gonder(yuk());
  assert.equal(s.oge('kartBaslik').textContent, 'Ev Paneli');
  assert.equal(s.oge('kartMesaj').textContent, 'Hareket algılandı');
  assert.deepEqual(s.dugmeler().map((d) => d.textContent), ['Onayla', 'Ertele']);
  assert.ok(s.dugmeler().every((d) => d.type === 'button' && d.className === 'dugme' && d.etiket === 'button'));
  assert.equal(s.gorunur(), true);
});

test('metinler HTML olarak yorumlanmaz (yalnız textContent); uzun metinler kısalır', () => {
  const s = sayfaKur();
  s.gonder(yuk({ baslik: '<img src=x onerror=alert(1)>', mesaj: '<b>kalın</b>'.repeat(100), dugmeler: ['<script>x</script>'.repeat(10)] }));
  assert.equal(s.oge('kartBaslik').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(s.oge('kartMesaj').textContent.length, 300);
  assert.equal(s.dugmeler()[0].textContent.length, 40);
  assert.equal(s.oge('kartBaslik').children.length, 0);
  const kaynak = oku('src/itme-kart-sayfa.js');
  assert.doesNotMatch(kaynak, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
});

test('düğmeye basınca ana sürece YALNIZ kart numarası ve düğme sırası gider; düğmeler kapanır (çift basış yok)', () => {
  const s = sayfaKur();
  s.gonder(yuk({ kartNo: 12 }));
  s.dugmeler()[1].tikla();
  assert.deepEqual(s.cagrilar.eylem, [[12, 1]]);
  assert.ok(s.dugmeler().every((d) => d.disabled === true));
  assert.ok(s.cagrilar.eylem.flat().every((d) => Number.isInteger(d)), 'eylem kimliği/başlık değil, yalnız tamsayılar');
  assert.deepEqual(s.cagrilar.kapat, []);
});

test('en çok 3 düğme gösterilir; düğmesiz kart yalnız ileti taşır; eski düğmeler yeni kartta temizlenir', () => {
  const s = sayfaKur();
  s.gonder(yuk({ dugmeler: ['A', 'B', 'C', 'D', 'E'] }));
  assert.deepEqual(s.dugmeler().map((d) => d.textContent), ['A', 'B', 'C']);
  s.gonder(yuk({ kartNo: 8, dugmeler: [] }));
  assert.equal(s.dugmeler().length, 0);
  s.gonder(yuk({ kartNo: 9, dugmeler: 'yanlış' }));
  assert.equal(s.dugmeler().length, 0);
  s.gonder(yuk({ kartNo: 10, dugmeler: ['Yeni'] }));
  assert.deepEqual(s.dugmeler().map((d) => d.textContent), ['Yeni']);
  s.dugmeler()[0].tikla();
  assert.deepEqual(s.cagrilar.eylem, [[10, 0]], 'basış güncel kartın numarasıyla gider');
});

test('× düğmesi ve Esc görünen kartı kapatma isteği olarak ana sürece bildirir; kart yokken hiçbir şey göndermez', () => {
  const s = sayfaKur();
  s.oge('btnKartKapat').tikla();
  s.tus('Escape');
  assert.deepEqual(s.cagrilar.kapat, [], 'henüz kart yok');
  s.gonder(yuk({ kartNo: 5 }));
  s.oge('btnKartKapat').tikla();
  s.tus('Escape');
  s.tus('Enter');
  s.tus('a');
  assert.deepEqual(s.cagrilar.kapat, [[5], [5]]);
  assert.deepEqual(s.cagrilar.eylem, []);
});

test('süre: sureMs 1-120 sn aralığına sıkıştırılır, geçersizse 45 sn; dolunca görünüm kalkar ve HA\'ya hiçbir şey gitmez; yeni kart zamanlayıcıyı sıfırlar', () => {
  const s = sayfaKur();
  s.gonder(yuk({ sureMs: 45000 }));
  assert.equal(s.zamanlayicilar.at(-1).ms, 45000);
  s.gonder(yuk({ sureMs: 5 }));
  assert.equal(s.zamanlayicilar.at(-1).ms, 1000);
  s.gonder(yuk({ sureMs: 99_999_999 }));
  assert.equal(s.zamanlayicilar.at(-1).ms, 120000);
  s.gonder(yuk({ sureMs: 'x' }));
  assert.equal(s.zamanlayicilar.at(-1).ms, 45000);
  assert.ok(s.temizlenenler.length >= 4, 'önceki zamanlayıcı her gösterimde iptal edilir');
  assert.equal(s.gorunur(), true);
  s.zamanlayicilar.at(-1).fn();
  assert.equal(s.gorunur(), false);
  assert.deepEqual(s.cagrilar, { eylem: [], kapat: [] });
});

test('geçersiz yükler yok sayılır (kart numarası tamsayı değilse, nesne değilse)', () => {
  const s = sayfaKur();
  for (const kotu of [null, undefined, 'x', 5, [], {}, { kartNo: 1.5 }, { kartNo: '1' }, { kartNo: NaN }, { mesaj: 'x' }]) s.gonder(kotu);
  assert.equal(s.gorunur(), false);
  assert.equal(s.oge('kartMesaj').textContent, '');
  assert.equal(s.zamanlayicilar.length, 0);
});

test('malzeme: mica/acrylic <html data-malzeme> olur; "yok" ve bilinmeyen değerde kalkar; görünüm modeli ve hareket azaltma temaya iletilir', () => {
  const s = sayfaKur({ azaltHareket: true });
  s.gonder(yuk({ malzeme: 'mica', gorunum: { vurgu: '#112233' } }));
  assert.equal(s.kok.dataset.malzeme, 'mica');
  assert.deepEqual(JSON.parse(JSON.stringify(s.gorunumCagrilari.at(-1))), { model: { vurgu: '#112233' }, secenek: { hareketAzalt: true } }); // vm bağlamından geldiği için JSON ile kıyaslanır
  s.gonder(yuk({ malzeme: 'acrylic' }));
  assert.equal(s.kok.dataset.malzeme, 'acrylic');
  s.gonder(yuk({ malzeme: 'yok' }));
  assert.equal(s.kok.dataset.malzeme, undefined);
  s.gonder(yuk({ malzeme: '<x>' }));
  assert.equal(s.kok.dataset.malzeme, undefined);
});

test('dil: sayfa başlığı, × düğmesinin etiketi ve <html lang> çevrilir; bildirim metnine (HA\'dan geldiği gibi) dokunulmaz; geçersiz yük yok sayılır', () => {
  const s = sayfaKur();
  assert.equal(s.baslik().textContent, 'Ev Paneli — Home Assistant bildirimi');
  s.gonder(yuk({ mesaj: 'Motion detected' }));
  s.dilGonder({ dil: 'en' });
  assert.equal(s.kok.nitelikler.lang, 'en');
  assert.equal(s.baslik().textContent, 'Home Panel — Home Assistant notification');
  assert.equal(s.oge('btnKartKapat').attributes['aria-label'], 'Close');
  assert.equal(s.oge('btnKartKapat').attributes.title, 'Close');
  assert.equal(s.oge('kartMesaj').textContent, 'Motion detected');
  for (const [dil, kapat] of [['de', 'Schließen'], ['fr', 'Fermer'], ['es', 'Cerrar'], ['tr', 'Kapat']]) {
    s.dilGonder({ dil });
    assert.equal(s.kok.nitelikler.lang, dil);
    assert.equal(s.oge('btnKartKapat').attributes['aria-label'], kapat, dil);
    assert.equal(s.oge('kartMesaj').textContent, 'Motion detected');
  }
  for (const kotu of [null, 'en', 7, {}, { dil: 'it' }, { dil: 'FR' }]) s.dilGonder(kotu);
  assert.equal(s.kok.nitelikler.lang, 'tr');
});

test('çeviri betikleri ya da köprü yoksa sayfa çökmez; kart yine görünür', () => {
  const sozluksuz = sayfaKur({ sozlukYukle: false });
  sozluksuz.gonder(yuk());
  assert.equal(sozluksuz.gorunur(), true);
  assert.doesNotThrow(() => sozluksuz.dilGonder({ dil: 'en' }));
  const koprusuz = sayfaKur({ evItme: false });
  assert.doesNotThrow(() => koprusuz.oge('btnKartKapat').tikla());
  assert.doesNotThrow(() => koprusuz.tus('Escape'));
});

test('HTML: kart alertdialog, düğmeler type=button, katı CSP, sayfa betiği çeviri betiklerinden sonra yüklenir', () => {
  const html = oku('src/itme-kart.html');
  assert.match(html, /id="kart" class="kart" role="alertdialog" aria-labelledby="kartBaslik" aria-describedby="kartMesaj"/);
  assert.match(html, /<button id="btnKartKapat" class="kapat" type="button"/);
  assert.match(html, /<html lang="tr">/);
  const sira = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(sira, ['lib/dil.js', 'lib/ceviri/yuzey.js', 'lib/tema-renk.js', 'itme-kart-sayfa.js']);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  const css = oku('src/itme-kart.css');
  assert.doesNotMatch(css, /url\(\s*['"]?https?:|@import/);
});

test('düğme zemini/kenarı palet değişkenlerinden türer: Windows şemasına zıt özel arka planda da metin okunur', () => {
  const css = oku('src/itme-kart.css');
  const kural = (secici) => {
    const i = css.indexOf(`${secici} {`);
    assert.ok(i >= 0, secici);
    return css.slice(i, css.indexOf('}', i));
  };
  // :root dışında --dugme-bg / --dugme-sinir sabit renk olarak yazılmaz (yalnız yüksek karşıtlık blokları sabit kalır)
  const sabitler = [...css.matchAll(/--dugme-(bg|sinir):\s*(#[0-9a-f]{3,8})/gi)];
  const karsitlikBaslangic = css.indexOf(':root[data-karsitlik]');
  for (const m of sabitler) assert.ok(m.index > karsitlikBaslangic, `sabit ${m[0]} yalnız yüksek karşıtlık bloğunda olabilir`);
  assert.match(css, /--dugme-bg:\s*color-mix\(in srgb, var\(--metin\) \d+%, var\(--bg\)\)/);
  assert.match(css, /--dugme-sinir:\s*color-mix\(in srgb, var\(--metin\) \d+%, var\(--bg\)\)/);
  // vurgulu düğme palet vurgusunu ve onun kontrastlı metnini kullanır
  const ilk = kural('.dugme:first-child');
  assert.match(ilk, /background:\s*var\(--vurgu, var\(--dugme-vurgu\)\)/);
  assert.match(ilk, /color:\s*var\(--vurgu-metin, var\(--dugme-vurgu-metin\)\)/);
  // türetilen zeminle palet metni her iki zıt şemada >= 4,5
  const Tema = require('../src/lib/tema-renk');
  const yuzde = Number(/--dugme-bg:\s*color-mix\(in srgb, var\(--metin\) (\d+)%/.exec(css)[1]);
  for (const sema of ['koyu', 'acik']) {
    for (const arkaPlan of ['#ffffff', '#101820', '#808080', '#e0e0e0', '#333333']) {
      const d = Tema.paletUret({ sema, arkaPlan }).degiskenler;
      const zemin = Tema.karistir(d['--bg'], d['--metin'], yuzde / 100);
      assert.ok(Tema.kontrast(d['--metin'], zemin) >= 4.5, `${sema} ${arkaPlan}: ${Tema.kontrast(d['--metin'], zemin)}`);
    }
  }
});

test('düğmeler tek satırda kalır (ileti metni ezilmez); kısalan başlığın tamamı title ipucuyla verilir', () => {
  const css = oku('src/itme-kart.css');
  const blok = (secici) => {
    const i = css.indexOf(`\n${secici} {`);
    assert.ok(i >= 0, secici);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.doesNotMatch(blok('.dugmeler'), /flex-wrap:\s*wrap\b/);
  assert.match(blok('.dugmeler'), /flex-wrap:\s*nowrap/);
  assert.match(blok('.dugme'), /min-width:\s*0/);
  assert.match(blok('.mesaj'), /min-height:\s*calc\(2 \* 1\.35em\)/);
  const s = sayfaKur();
  const uzun = 'Alarmı sustur ve kamerayı aç hemen';
  s.gonder(yuk({ dugmeler: [uzun, 'B'] }));
  assert.deepEqual(s.dugmeler().map((d) => d.title), [uzun, 'B']);
  assert.equal(s.dugmeler()[0].textContent, uzun);
  s.gonder(yuk({ kartNo: 8, dugmeler: ['<b>x</b>'.repeat(20)] }));
  assert.equal(s.dugmeler()[0].title.length, 40, 'title de textContent gibi 40 karakterle sınırlı');
});
