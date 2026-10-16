'use strict';

/**
 * src/yuzey-gorunum.js (hızlı panel / komut paleti görünüm betiği) renderer testi: sahte DOM, sahte zamanlayıcı ve sahte tuval.
 * Gerçek pencere, Electron ya da ağ yok. Kapsam (o-25, o-29, o-34): palet/öznitelik yazımı, efekt başlat-durdur, "hareketi azalt"
 * (ayar ve sistem tercihi), giriş animasyonu, kayan vurgu, gizli pencerede döngü, yeniden boyutlama ve köprünün yalnız üç işlevi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../src/lib/tema-renk');

const KOK = path.join(__dirname, '..');
const KAYNAK = {
  tema: fs.readFileSync(path.join(KOK, 'src/lib/tema-renk.js'), 'utf8'),
  efekt: fs.readFileSync(path.join(KOK, 'src/lib/efekt.js'), 'utf8'),
  gorunum: fs.readFileSync(path.join(KOK, 'src/yuzey-gorunum.js'), 'utf8'),
};

const bekle = () => new Promise((coz) => setImmediate(coz));

function ogeKur(ad) {
  const nitelikler = new Map();
  const siniflar = new Set();
  const o = {
    tagName: ad,
    parentNode: null,
    cocuklar: [],
    hidden: false,
    offsetWidth: 0,
    offsetHeight: 0,
    offsetTop: 0,
    offsetLeft: 0,
    secili: null, // querySelector('.palet-satir.secili') yanıtı
    style: {
      degerler: new Map(),
      setProperty(k, v) {
        this.degerler.set(k, v);
      },
      removeProperty(k) {
        this.degerler.delete(k);
      },
    },
    classList: {
      add: (c) => siniflar.add(c),
      remove: (c) => siniflar.delete(c),
      contains: (c) => siniflar.has(c),
    },
    siniflar,
    setAttribute: (k, v) => nitelikler.set(k, String(v)),
    getAttribute: (k) => (nitelikler.has(k) ? nitelikler.get(k) : null),
    removeAttribute: (k) => nitelikler.delete(k),
    nitelikler,
    insertBefore(yeni) {
      yeni.parentNode = o;
      o.cocuklar.unshift(yeni);
    },
    removeChild(c) {
      o.cocuklar = o.cocuklar.filter((x) => x !== c);
      c.parentNode = null;
    },
    querySelector: (secici) => (secici === '.palet-satir.secili' ? o.secili : null),
  };
  Object.defineProperty(o, 'firstChild', { get: () => o.cocuklar[0] || null });
  return o;
}

function baglamKur() {
  const cagrilar = [];
  const ozellikler = {};
  const ctx = new Proxy(
    {},
    {
      get(_, ad) {
        if (typeof ad === 'string' && Object.hasOwn(ozellikler, ad)) return ozellikler[ad];
        return (...a) => {
          cagrilar.push(ad);
          return ctx;
        };
      },
      set(_, ad, deger) {
        ozellikler[ad] = deger;
        return true;
      },
    },
  );
  return { ctx, cagrilar, ozellikler };
}

/**
 * Sahte renderer ortamı kurar, üç betiği (tema-renk, efekt, yuzey-gorunum) yükler ve köprüyü döndürür.
 * @param {object} [s]
 * @param {boolean} [s.azalt] sistem prefers-reduced-motion: reduce
 * @param {boolean} [s.acik] sistem prefers-color-scheme: light
 * @param {object|null} [s.gorunum] durumAl yanıtındaki görünüm modeli
 * @param {object|null} [s.model] durumAl yanıtındaki karo modeli
 * @param {boolean} [s.tuvalYok] #efekt öğesi yok
 * @param {boolean} [s.koprusuz] window.evYuzey yok
 * @param {boolean} [s.gozlemcisiz] MutationObserver yok
 * @param {boolean} [s.durumHatasi] durumAl reddedilir
 */
async function kur(s = {}) {
  const kok = ogeKur('html');
  const icerik = ogeKur('div');
  const tuval = ogeKur('canvas');
  tuval.hidden = true; // yuzey.html'deki hidden niteliği
  tuval.width = 0;
  tuval.height = 0;
  const { ctx, cagrilar, ozellikler } = baglamKur();
  let getContextSayisi = 0;
  tuval.getContext = (tur) => {
    getContextSayisi += 1;
    return tur === '2d' ? ctx : null;
  };

  // zamanlayıcılar
  let simdi = 0;
  let zamanKimligi = 0;
  const zamanlayicilar = [];
  const setTimeoutSahte = (fn, ms) => {
    zamanKimligi += 1;
    zamanlayicilar.push({ id: zamanKimligi, fn, due: simdi + ms, iptal: false });
    return zamanKimligi;
  };
  const clearTimeoutSahte = (id) => {
    const z = zamanlayicilar.find((x) => x.id === id);
    if (z) z.iptal = true;
  };
  const ilerlet = (ms) => {
    const hedef = simdi + ms;
    for (;;) {
      const siradaki = zamanlayicilar.filter((z) => !z.iptal && z.due <= hedef).sort((a, b) => a.due - b.due)[0];
      if (!siradaki) break;
      simdi = siradaki.due;
      siradaki.iptal = true;
      siradaki.fn();
    }
    simdi = hedef;
  };
  const bekleyenZamanlayici = () => zamanlayicilar.filter((z) => !z.iptal).length;

  // animasyon kareleri
  let kareKimligi = 0;
  const kareler = new Map();
  let iptalEdilenKare = 0;
  const kareCalistir = (zaman) => {
    const liste = [...kareler.values()];
    kareler.clear();
    for (const fn of liste) fn(zaman);
  };

  // medya sorguları
  const sorgular = new Map();
  const medya = (metin) => {
    if (!sorgular.has(metin)) {
      const dinleyiciler = [];
      sorgular.set(metin, {
        matches: metin.includes('reduced-motion') ? !!s.azalt : metin.includes('prefers-color-scheme: light') ? !!s.acik : false,
        dinleyiciler,
        addEventListener: (tur, fn) => {
          if (tur === 'change') dinleyiciler.push(fn);
        },
      });
    }
    return sorgular.get(metin);
  };
  const azaltDegistir = (deger) => {
    const q = medya('(prefers-reduced-motion: reduce)');
    q.matches = deger;
    for (const fn of q.dinleyiciler) fn({ matches: deger });
  };

  // gözlemci
  const gozlemciler = [];
  class SahteGozlemci {
    constructor(geriCagri) {
      this.geriCagri = geriCagri;
      this.hedef = null;
      this.baglantiKesildi = false;
      gozlemciler.push(this);
    }
    observe(hedef) {
      this.hedef = hedef;
    }
    disconnect() {
      this.baglantiKesildi = true;
    }
  }

  // köprü
  let gosterGeriCagri = null;
  let durumGeriCagri = null;
  const kopruCagrilari = [];
  const kopru = {
    durumAl() {
      kopruCagrilari.push('durumAl');
      if (s.durumHatasi) return Promise.reject(new Error('yok'));
      return Promise.resolve({ ok: true, model: s.model || null, gorunum: s.gorunum });
    },
    onGoster(fn) {
      kopruCagrilari.push('onGoster');
      gosterGeriCagri = fn;
    },
    onDurum(fn) {
      kopruCagrilari.push('onDurum');
      durumGeriCagri = fn;
    },
  };

  // belge
  const belgeDinleyicileri = {};
  const pencereDinleyicileri = {};
  const belge = {
    documentElement: kok,
    hidden: false,
    getElementById: (kimlik) => (kimlik === 'icerik' ? icerik : kimlik === 'efekt' && !s.tuvalYok ? tuval : null),
    createElement: (ad) => ogeKur(ad),
    addEventListener: (tur, fn) => {
      (belgeDinleyicileri[tur] = belgeDinleyicileri[tur] || []).push(fn);
    },
  };
  const pencere = {
    innerWidth: 360,
    innerHeight: 420,
    devicePixelRatio: 1,
    matchMedia: medya,
    setTimeout: setTimeoutSahte,
    clearTimeout: clearTimeoutSahte,
    requestAnimationFrame: (fn) => {
      kareKimligi += 1;
      kareler.set(kareKimligi, fn);
      return kareKimligi;
    },
    cancelAnimationFrame: (id) => {
      iptalEdilenKare += 1;
      kareler.delete(id);
    },
    addEventListener: (tur, fn) => {
      (pencereDinleyicileri[tur] = pencereDinleyicileri[tur] || []).push(fn);
    },
    document: belge,
  };
  if (!s.gozlemcisiz) pencere.MutationObserver = SahteGozlemci;
  if (!s.koprusuz) pencere.evYuzey = kopru;
  pencere.window = pencere;
  pencere.document = belge;
  pencere.console = console;
  const baglamKutusu = vm.createContext({ ...pencere, window: undefined });
  baglamKutusu.window = baglamKutusu;
  baglamKutusu.document = belge;
  for (const kaynak of [KAYNAK.tema, KAYNAK.efekt, KAYNAK.gorunum]) vm.runInContext(kaynak, baglamKutusu);
  await bekle();

  return {
    kok,
    icerik,
    tuval,
    ctx,
    cagrilar,
    ozellikler,
    kopruCagrilari,
    gozlemciler,
    pencere: baglamKutusu,
    belge,
    get getContextSayisi() {
      return getContextSayisi;
    },
    get iptalEdilenKare() {
      return iptalEdilenKare;
    },
    get bekleyenKare() {
      return kareler.size;
    },
    get bekleyenZamanlayici() {
      return bekleyenZamanlayici();
    },
    ilerlet,
    kareCalistir,
    azaltDegistir,
    goster: (yuk) => gosterGeriCagri(yuk),
    durum: (model) => durumGeriCagri(model),
    belgeOlay: (tur) => (belgeDinleyicileri[tur] || []).forEach((fn) => fn()),
    pencereOlay: (tur) => (pencereDinleyicileri[tur] || []).forEach((fn) => fn()),
    var: (ad) => kok.nitelikler.has(ad),
    deger: (ad) => kok.nitelikler.get(ad),
  };
}

const HAVA_MODELI = (durum) => ({ gruplar: [{ karolar: [{ alan: 'weather', ozellik: { durum } }] }] });
const ANIMASYONLU = (hava, mevsim = 'yok', gecis = false) => ({ animasyon: { gecis, hava, mevsim } });

// ---------------------------------------------------------------- varsayılan: hiçbir şey değişmez

test('görünüm yoksa: <html> öznitelik ve değişken almaz, tuval gizli kalır, kare istenmez, bağlam açılmaz', async () => {
  const o = await kur({ gorunum: undefined });
  assert.equal(o.kok.nitelikler.size, 0);
  assert.equal(o.kok.style.degerler.size, 0);
  assert.equal(o.tuval.hidden, true);
  assert.equal(o.bekleyenKare, 0);
  assert.equal(o.getContextSayisi, 0);
  assert.equal(o.gozlemciler.length, 0);
  assert.equal(o.bekleyenZamanlayici, 0);
});

test('köprüden yalnız durumAl, onGoster ve onDurum kullanılır', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur', 'yok', true) });
  assert.deepEqual([...new Set(o.kopruCagrilari)].sort(), ['durumAl', 'onDurum', 'onGoster']);
});

test('köprü ya da bağımlılık yoksa betik sessizce çıkar; durumAl reddedilirse varsayılan görünüm kalır', async () => {
  const koprusuz = await kur({ koprusuz: true });
  assert.equal(koprusuz.kok.nitelikler.size, 0);
  assert.equal(koprusuz.kopruCagrilari.length, 0);
  const hatali = await kur({ durumHatasi: true });
  assert.equal(hatali.kok.nitelikler.size, 0);
  assert.equal(hatali.tuval.hidden, true);
});

// ---------------------------------------------------------------- o-29 / o-25: palet ve öznitelikler

test('özel palet: renk değişkenleri CSSOM ile yazılır, data-sema eklenir; satır içi style özniteliği kullanılmaz', async () => {
  const palet = T.paletUret({ sema: 'koyu', vurgu: '#f97316', taban: '#10161d' });
  const o = await kur({ gorunum: { sema: palet.sema, degiskenler: palet.degiskenler } });
  assert.equal(o.deger('data-sema'), palet.sema);
  assert.equal(o.kok.style.degerler.get('--bg'), palet.degiskenler['--bg']);
  assert.equal(o.kok.style.degerler.get('--vurgu'), palet.degiskenler['--vurgu']);
  assert.equal(o.kok.style.degerler.size, Object.keys(palet.degiskenler).length);
  assert.equal(o.var('style'), false);
});

test('yeni görünüm gelince eski değişken ve öznitelikler silinir (özel palet -> varsayılan)', async () => {
  const palet = T.paletUret({ sema: 'acik', vurgu: '#2563eb' });
  const o = await kur({ gorunum: { sema: 'acik', degiskenler: palet.degiskenler, karsitlik: true } });
  assert.ok(o.kok.style.degerler.size > 0);
  assert.equal(o.var('data-karsitlik'), true);
  o.goster({ gorunum: null });
  assert.equal(o.kok.style.degerler.size, 0);
  assert.equal(o.kok.nitelikler.size, 0);
});

test('geçersiz değişken değeri (CSS enjeksiyonu) yazılmaz', async () => {
  const o = await kur({ gorunum: { sema: 'koyu', degiskenler: { '--bg': 'red; background:url(x)', '--vurgu': '#ff0000', '--bilinmeyen': '#000000' } } });
  assert.equal(o.kok.style.degerler.has('--bg'), false);
  assert.equal(o.kok.style.degerler.has('--bilinmeyen'), false);
  assert.equal(o.kok.style.degerler.get('--vurgu'), '#ff0000');
});

test('yüksek karşıtlık: data-karsitlik yazılır, özel renk gelmez', async () => {
  const o = await kur({ gorunum: { karsitlik: true } });
  assert.equal(o.deger('data-karsitlik'), '1');
  assert.equal(o.kok.style.degerler.size, 0);
  assert.equal(o.var('data-sema'), false);
});

// ---------------------------------------------------------------- o-34: efekt başlat / durdur

test('hava efekti: tuval görünür olur, bağlam bir kez açılır, ilk kare hemen çizilir, döngü ~30 kare/sn ile sürer', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur') });
  assert.equal(o.tuval.hidden, false);
  assert.equal(o.getContextSayisi, 1);
  assert.equal(o.tuval.width, 360);
  assert.equal(o.tuval.height, 420);
  assert.ok(o.cagrilar.includes('stroke'), 'ilk kare çizildi (yağmur çizgileri)');
  assert.equal(o.bekleyenKare, 1);
  const baslangic = o.cagrilar.length;
  o.kareCalistir(1000); // ilk kare zamanı kaydeder
  o.kareCalistir(1010); // 10 ms: çok erken, çizilmez
  assert.equal(o.cagrilar.length, baslangic);
  o.kareCalistir(1050); // 50 ms >= 33 ms
  assert.ok(o.cagrilar.length > baslangic);
  assert.equal(o.bekleyenKare, 1, 'döngü sürüyor');
});

test('efekt türleri doğru çizilir: kar -> daire, güneş -> ışıma, çiçek/yaprak -> elips', async () => {
  const kar = await kur({ gorunum: ANIMASYONLU('kar') });
  assert.ok(kar.cagrilar.includes('arc'));
  const gunes = await kur({ gorunum: ANIMASYONLU('gunes') });
  assert.ok(gunes.cagrilar.includes('createRadialGradient'));
  const cicek = await kur({ gorunum: ANIMASYONLU('yok', 'ilkbahar') });
  assert.ok(cicek.cagrilar.includes('ellipse'));
  const yaprak = await kur({ gorunum: ANIMASYONLU('yok', 'sonbahar') });
  assert.ok(yaprak.cagrilar.includes('ellipse'));
  const kis = await kur({ gorunum: ANIMASYONLU('yok', 'kis') });
  assert.ok(kis.cagrilar.includes('arc'));
});

test('hava "otomatik": ilk hava karosunun durumuna uyar; durum değişince efekt değişir; karo yoksa efekt yok', async () => {
  const yagmurlu = await kur({ gorunum: ANIMASYONLU('otomatik'), model: HAVA_MODELI('rainy') });
  assert.equal(yagmurlu.tuval.hidden, false);
  assert.ok(yagmurlu.cagrilar.includes('stroke'));

  const o = await kur({ gorunum: ANIMASYONLU('otomatik'), model: HAVA_MODELI('snowy') });
  assert.ok(o.cagrilar.includes('arc'));
  assert.equal(o.cagrilar.includes('createRadialGradient'), false);
  o.durum(HAVA_MODELI('sunny'));
  assert.ok(o.cagrilar.includes('createRadialGradient'), 'durum değişti: güneş efekti');
  o.durum(HAVA_MODELI('cloudy'));
  assert.equal(o.tuval.hidden, true, 'bulutlu: efekt yok');

  const karosuz = await kur({ gorunum: ANIMASYONLU('otomatik'), model: { gruplar: [] } });
  assert.equal(karosuz.tuval.hidden, true);
  assert.equal(karosuz.getContextSayisi, 0);
});

test('hava efekti mevsim efektinden önce gelir; mevsim "otomatik" bir efekt seçer', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur', 'ilkbahar') });
  assert.ok(o.cagrilar.includes('stroke'));
  assert.equal(o.cagrilar.includes('ellipse'), false);
  const mevsimsel = await kur({ gorunum: ANIMASYONLU('yok', 'otomatik') });
  assert.equal(mevsimsel.tuval.hidden, false);
});

test('animasyon kapalıyken (varsayılan) ya da yalnız geçiş açıkken efekt çalışmaz', async () => {
  const kapali = await kur({ gorunum: { karsitlik: false } });
  assert.equal(kapali.tuval.hidden, true);
  const yalnizGecis = await kur({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(yalnizGecis.tuval.hidden, true);
  assert.equal(yalnizGecis.bekleyenKare, 0);
  assert.equal(yalnizGecis.deger('data-gecis'), '1');
});

test('görünüm değişince efekt durur: kare iptal edilir, tuval temizlenip gizlenir', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur') });
  assert.equal(o.tuval.hidden, false);
  o.goster({ gorunum: null });
  assert.equal(o.tuval.hidden, true);
  assert.equal(o.bekleyenKare, 0);
  assert.ok(o.iptalEdilenKare >= 1);
  assert.ok(o.cagrilar.filter((c) => c === 'clearRect').length >= 2);
  // yeniden açılınca baştan başlar, bağlam yeniden açılmaz
  o.goster({ gorunum: ANIMASYONLU('kar') });
  assert.equal(o.tuval.hidden, false);
  assert.equal(o.getContextSayisi, 1);
});

test('aynı efekt yeniden gelince (başka ayar değişti) tuval yeniden kurulmaz', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur') });
  const cizim = o.cagrilar.length;
  o.goster({ gorunum: { ...ANIMASYONLU('yagmur'), karsitlik: false } });
  assert.equal(o.cagrilar.length, cizim, 'aynı tür: yeniden çizim/başlatma yok');
  assert.equal(o.tuval.hidden, false);
});

// ---------------------------------------------------------------- hareketi azalt

test('hareketi azalt ayarı: animasyon istense bile efekt, giriş ve geçiş çalışmaz; data-hareket yazılır', async () => {
  const o = await kur({ gorunum: { hareketiAzalt: true, animasyon: { gecis: true, hava: 'yagmur', mevsim: 'kis' } } });
  assert.equal(o.deger('data-hareket'), 'azalt');
  assert.equal(o.var('data-gecis'), false);
  assert.equal(o.var('data-kayan'), false);
  assert.equal(o.tuval.hidden, true);
  assert.equal(o.bekleyenKare, 0);
  assert.equal(o.getContextSayisi, 0);
  assert.equal(o.gozlemciler.length, 0);
  o.goster({ gorunum: { hareketiAzalt: true, animasyon: { gecis: true, hava: 'yagmur', mevsim: 'kis' } } });
  assert.equal(o.var('data-giris'), false);
  assert.equal(o.bekleyenZamanlayici, 0);
});

test('sistem "hareketi azalt" tercihi: açılışta efekt yok; çalışırken değişirse efekt durur ve geri gelir', async () => {
  const sistem = await kur({ azalt: true, gorunum: ANIMASYONLU('yagmur', 'yok', true) });
  assert.equal(sistem.deger('data-hareket'), 'azalt');
  assert.equal(sistem.tuval.hidden, true);
  assert.equal(sistem.var('data-gecis'), false);

  const o = await kur({ gorunum: ANIMASYONLU('yagmur', 'yok', true) });
  assert.equal(o.tuval.hidden, false);
  assert.equal(o.deger('data-gecis'), '1');
  o.azaltDegistir(true);
  assert.equal(o.tuval.hidden, true);
  assert.equal(o.bekleyenKare, 0);
  assert.equal(o.deger('data-hareket'), 'azalt');
  assert.equal(o.var('data-gecis'), false);
  assert.equal(o.var('data-kayan'), false);
  o.azaltDegistir(false);
  assert.equal(o.tuval.hidden, false);
  assert.equal(o.deger('data-gecis'), '1');
  assert.equal(o.var('data-hareket'), false);
});

// ---------------------------------------------------------------- giriş animasyonu

test('giriş animasyonu: yalnız geçişler açıkken ve panel gösterilince <html data-giris> yazılır, 700 ms sonra kalkar', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(o.var('data-giris'), false, 'ilk yüklemede (durumAl) oynatılmaz');
  o.goster({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(o.deger('data-giris'), '1');
  o.ilerlet(699);
  assert.equal(o.var('data-giris'), true);
  o.ilerlet(1);
  assert.equal(o.var('data-giris'), false);
  // art arda gösterim: zamanlayıcı sıfırlanır (eski zamanlayıcı yeni girişi erken silmez)
  o.goster({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  o.ilerlet(400);
  o.goster({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  o.ilerlet(400);
  assert.equal(o.var('data-giris'), true);
  o.ilerlet(300);
  assert.equal(o.var('data-giris'), false);
  assert.equal(o.bekleyenZamanlayici, 0);
});

test('giriş animasyonu geçiş kapalıyken hiç yazılmaz; geçiş kapanınca kalan öznitelik silinir', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur', 'yok', false) });
  o.goster({ gorunum: ANIMASYONLU('yagmur', 'yok', false) });
  assert.equal(o.var('data-giris'), false);
  assert.equal(o.var('data-gecis'), false);
  o.goster({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(o.var('data-giris'), true);
  o.goster({ gorunum: null });
  assert.equal(o.var('data-giris'), false);
});

// ---------------------------------------------------------------- kayan vurgu

test('kayan vurgu: geçişler açıkken data-kayan yazılır, gözlemci kurulur, vurgu seçili satıra konumlanır', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(o.deger('data-kayan'), '1');
  assert.equal(o.gozlemciler.length, 1);
  assert.equal(o.gozlemciler[0].hedef, o.icerik);

  const satir = ogeKur('button');
  satir.offsetTop = 40;
  satir.offsetLeft = 6;
  satir.offsetWidth = 300;
  satir.offsetHeight = 34;
  o.icerik.secili = satir;
  o.gozlemciler[0].geriCagri();
  const vurgu = o.icerik.cocuklar[0];
  assert.equal(vurgu.className, 'kayan-vurgu');
  assert.equal(vurgu.getAttribute('aria-hidden'), 'true');
  assert.equal(vurgu.hidden, false);
  assert.equal(vurgu.style.transform, 'translateY(40px)');
  assert.equal(vurgu.style.left, '6px');
  assert.equal(vurgu.style.width, '300px');
  assert.equal(vurgu.style.height, '34px');

  // seçim aşağı iner: aynı öğe yeni konuma kayar
  satir.offsetTop = 74;
  o.gozlemciler[0].geriCagri();
  assert.equal(vurgu.style.transform, 'translateY(74px)');
  assert.equal(o.icerik.cocuklar.length, 1);

  // içerik yeniden kurulup vurgu sayfadan düşerse geri eklenir ve yeni konuma gider
  o.icerik.removeChild(vurgu);
  satir.offsetTop = 108;
  o.gozlemciler[0].geriCagri();
  assert.equal(o.icerik.cocuklar[0], vurgu);
  assert.equal(vurgu.style.transform, 'translateY(108px)');
  assert.equal(vurgu.siniflar.has('kayma-yok'), false, 'geçişsiz konum sınıfı işi bitince kalkar');

  // seçili satır kalmadı (palet kapandı): vurgu gizlenir
  o.icerik.secili = null;
  o.gozlemciler[0].geriCagri();
  assert.equal(vurgu.hidden, true);
});

test('kayan vurgu: geçiş kapanınca öznitelik kalkar, gözlemci bırakılır, öğe sayfadan alınır', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  const satir = ogeKur('button');
  o.icerik.secili = satir;
  o.gozlemciler[0].geriCagri();
  assert.equal(o.icerik.cocuklar.length, 1);
  o.goster({ gorunum: null });
  assert.equal(o.var('data-kayan'), false);
  assert.equal(o.gozlemciler[0].baglantiKesildi, true);
  assert.equal(o.icerik.cocuklar.length, 0);
  // yeniden açılınca yeni gözlemci kurulur
  o.goster({ gorunum: ANIMASYONLU('yok', 'yok', true) });
  assert.equal(o.gozlemciler.length, 2);
  assert.equal(o.deger('data-kayan'), '1');
});

test('kayan vurgu: MutationObserver yoksa data-kayan yazılmaz (satırın kendi zemini kalır)', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yok', 'yok', true), gozlemcisiz: true });
  assert.equal(o.var('data-kayan'), false);
  assert.equal(o.deger('data-gecis'), '1');
});

// ---------------------------------------------------------------- pencere gizli / yeniden boyutlama

test('pencere gizliyken döngü durur; görünür olunca (visibilitychange) devam eder', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('kar') });
  o.kareCalistir(1000);
  assert.equal(o.bekleyenKare, 1);
  o.belge.hidden = true;
  const cizim = o.cagrilar.length;
  o.kareCalistir(1100);
  assert.equal(o.bekleyenKare, 0, 'gizliyken yeni kare istenmez');
  assert.equal(o.cagrilar.length, cizim, 'gizliyken çizilmez');
  o.belge.hidden = false;
  o.belgeOlay('visibilitychange');
  assert.equal(o.bekleyenKare, 1);
  o.kareCalistir(5000); // uzun duraklama sonrası ilk kare yalnız zamanı kaydeder (parçacıklar sıçramaz)
  o.kareCalistir(5040);
  assert.ok(o.cagrilar.length > cizim);
});

test('efekt yokken görünürlük değişimi kare istemez', async () => {
  const o = await kur({ gorunum: null });
  o.belgeOlay('visibilitychange');
  assert.equal(o.bekleyenKare, 0);
});

test('yeniden boyutlama: bekleme süresinden sonra tuval yeni boyuta göre kurulur; efekt yokken zamanlayıcı kurulmaz', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur') });
  o.pencere.innerWidth = 500;
  o.pencere.innerHeight = 600;
  o.pencereOlay('resize');
  o.pencereOlay('resize');
  assert.equal(o.tuval.width, 360, 'bekleme süresi dolmadan değişmez');
  assert.equal(o.bekleyenZamanlayici, 1, 'art arda olaylar tek zamanlayıcıda birleşir');
  o.ilerlet(120);
  assert.equal(o.tuval.width, 500);
  assert.equal(o.tuval.height, 600);
  assert.equal(o.getContextSayisi, 1);
  assert.equal(o.tuval.hidden, false);

  const efektsiz = await kur({ gorunum: null });
  efektsiz.pencereOlay('resize');
  assert.equal(efektsiz.bekleyenZamanlayici, 0);
});

test('yüksek piksel yoğunluğu: tuval çözünürlüğü en çok 2 kat', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur') });
  o.pencere.devicePixelRatio = 3;
  o.pencereOlay('resize');
  o.ilerlet(120);
  assert.equal(o.tuval.width, 720);
  assert.equal(o.tuval.height, 840);
});

test('tuval öğesi yoksa efekt sessizce atlanır, geçiş öznitelikleri yine yazılır', async () => {
  const o = await kur({ gorunum: ANIMASYONLU('yagmur', 'yok', true), tuvalYok: true });
  assert.equal(o.deger('data-gecis'), '1');
  assert.equal(o.bekleyenKare, 0);
  assert.equal(o.getContextSayisi, 0);
});

// ---------------------------------------------------------------- tema rengi efekt takımı

test('efekt renk takımı temayı izler: açık palet / açık sistem teması koyu tonlu çizim kullanır', async () => {
  const sistemKoyu = await kur({ gorunum: ANIMASYONLU('kar') });
  assert.ok(sistemKoyu.ozellikler.fillStyle.startsWith('rgba(255, 255, 255,'), 'koyu zeminde beyaz kar');
  const sistemAcik = await kur({ acik: true, gorunum: ANIMASYONLU('kar') });
  assert.equal(sistemAcik.tuval.hidden, false);
  assert.ok(sistemAcik.ozellikler.fillStyle.startsWith('rgba(71, 85, 105,'), 'açık zeminde koyu kar');
  const palet = T.paletUret({ sema: 'acik', vurgu: '#2563eb' });
  const paletAcik = await kur({ gorunum: { sema: 'acik', degiskenler: palet.degiskenler, ...ANIMASYONLU('kar') } });
  assert.equal(paletAcik.tuval.hidden, false);
  assert.equal(paletAcik.deger('data-sema'), 'acik');
  assert.ok(paletAcik.ozellikler.fillStyle.startsWith('rgba(71, 85, 105,'), 'palet açıksa sistem koyu olsa da koyu tonlu kar');
  const paletKoyu = await kur({ acik: true, gorunum: { sema: 'koyu', degiskenler: T.paletUret({ sema: 'koyu' }).degiskenler, ...ANIMASYONLU('kar') } });
  assert.ok(paletKoyu.ozellikler.fillStyle.startsWith('rgba(255, 255, 255,'), 'palet koyuysa sistem açık olsa da beyaz kar');
});
