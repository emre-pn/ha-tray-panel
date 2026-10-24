'use strict';

/**
 * Masaüstü karosu sayfasının betiği (src/masaustu-karo-sayfa.js) minik bir SAHTE DOM ile çalıştırılır (test/yuzey-sayfa.test.js ile aynı
 * yaklaşım): gerçek tarayıcı, Electron ya da pencere YOK. Amaç: HTML kimlikleriyle betiğin uyumu, modelin yalnız textContent ile
 * çizilmesi, sayfanın ana sürece YALNIZ { tur: 'tikla' } / { parlaklik } yollaması (kimlik göndermemesi) ve dil/malzeme/hata davranışı.
 * Görünüm (CSS) burada denenmez; yalnız renk kontrastı iki temada hesaplanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const HTML = oku('src/masaustu-karo.html');
const CSS = oku('src/masaustu-karo.css');
const BETIK = oku('src/masaustu-karo-sayfa.js');
// Yorumsuz kod: kelime denetimleri açıklama satırlarına takılmasın (betikte metin değişmezlerinde "//" yok).
const BETIK_KODU = BETIK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/.*$/gm, '');
const DIL = oku('src/lib/dil.js');
const SOZLUK = oku('src/lib/ceviri/yuzey.js');
const TEMA_RENK = oku('src/lib/tema-renk.js');
const BILGI_BICIM = oku('src/lib/bilgi-bicim.js');

class SahteOge {
  constructor(etiket = 'div', kimlik = null) {
    this.etiket = etiket;
    this.id = kimlik;
    this.children = [];
    this.dinleyiciler = {};
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.type = '';
    this._metin = '';
    const kap = this;
    this.classList = {
      add: (c) => {
        if (!kap.className.split(' ').includes(c)) kap.className = `${kap.className} ${c}`.trim();
      },
      remove: (c) => {
        kap.className = kap.className.split(' ').filter((x) => x && x !== c).join(' ');
      },
      contains: (c) => kap.className.split(' ').includes(c),
      toggle: (c, zorla) => {
        const olmali = zorla === undefined ? !kap.classList.contains(c) : !!zorla;
        if (olmali) kap.classList.add(c);
        else kap.classList.remove(c);
        return olmali;
      },
    };
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
    SahteOge.odaktaki = this;
  }

  tikla() {
    for (const isleyici of this.dinleyiciler.click ?? []) isleyici({ type: 'click', target: this });
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
  let t = 0;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
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
    bekleyenSayisi: () => bekleyenler.size,
  };
}

const karoModeli = (ek = {}) => ({
  id: 'light.salon',
  etiket: 'Salon',
  alan: 'light',
  durum: 'acik',
  yuzde: 60,
  kullanilabilir: true,
  ulasilamiyor: false,
  ozellik: null,
  tiklanabilir: true,
  parlaklikOnAyarlari: [25, 50, 100],
  baglanti: { canli: true, baglanti: 'ev' },
  ...ek,
});

/**
 * @param {object} [s]
 * @param {object|null} [s.model] ilk durumAl yanıtındaki model
 * @param {string} [s.dil] durumAl yanıtındaki dil
 * @param {boolean} [s.kopruYok] window.evKaro tanımsız
 * @param {boolean} [s.ceviriYok] EvDil/EvCeviriYuzey yüklenmedi
 * @param {boolean} [s.temaRenkYok] lib/tema-renk.js yüklenmedi
 * @param {boolean} [s.bicimYok] lib/bilgi-bicim.js yüklenmedi
 * @param {object} [s.gorunum] durumAl yanıtındaki görünüm modeli
 * @param {boolean} [s.sistemAzalt] sistem "animasyonları azalt" (prefers-reduced-motion: reduce)
 */
function sayfayiKur({ model = karoModeli(), dil, malzeme, gorunum, calistirYaniti = { ok: true }, kopruYok = false, ceviriYok = false, temaRenkYok = false, bicimYok = false, sistemAzalt = false, durumYaniti } = {}) {
  SahteOge.odaktaki = null;
  const ogeler = new Map();
  for (const [, kimlik] of HTML.matchAll(/\bid="([^"]+)"/g)) {
    ogeler.set(kimlik, new SahteOge(new RegExp(`<(\\w+)[^>]*\\bid="${kimlik}"`).exec(HTML)?.[1] ?? 'div', kimlik));
  }
  const ceviriOgeleri = [];
  for (const [, etiket, nitelikMetni, icMetin] of HTML.matchAll(/<(\w+)\b([^>]*\bdata-i18n(?:-attr)?="[^>]*)>([^<]*)/g)) {
    const nitelikler = Object.fromEntries([...nitelikMetni.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const oge = (nitelikler.id && ogeler.get(nitelikler.id)) || new SahteOge(etiket, nitelikler.id ?? null);
    Object.assign(oge.attributes, nitelikler);
    if ('data-i18n' in nitelikler) oge.textContent = icMetin;
    ceviriOgeleri.push(oge);
  }
  const zaman = sahteZaman();
  const cagrilar = [];
  let durumDinleyici = null;
  let dilDinleyici = null;
  const kopru = {
    durumAl: async () => (durumYaniti !== undefined ? durumYaniti : { ok: true, model, ...(malzeme !== undefined ? { malzeme } : {}), ...(gorunum !== undefined ? { gorunum } : {}), ...(dil !== undefined ? { dil } : {}) }),
    onDurum: (cb) => {
      durumDinleyici = cb;
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
    kaldir: (...bagimsiz) => cagrilar.push(['kaldir', bagimsiz]),
  };
  // <html> öğesi: lib/tema-renk.js gorunumUygula öznitelik ve stil değişkeni yazar (CSS değişkenleri satır içi stil olarak, CSSOM üzerinden).
  const kokNitelikleri = {};
  const kokDegiskenleri = {};
  const kok = {
    dataset: {},
    nitelikler: kokNitelikleri,
    degiskenler: kokDegiskenleri,
    style: {
      setProperty: (ad, deger) => {
        kokDegiskenleri[ad] = deger;
      },
      removeProperty: (ad) => {
        delete kokDegiskenleri[ad];
      },
    },
    setAttribute: (ad, deger) => {
      kokNitelikleri[ad] = String(deger);
    },
    removeAttribute: (ad) => {
      delete kokNitelikleri[ad];
    },
  };
  const belge = {
    documentElement: kok,
    querySelectorAll: (secici) => ceviriOgeleri.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
    get activeElement() {
      return SahteOge.odaktaki ?? null;
    },
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `masaustu-karo.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket),
  };
  const sandbox = {
    document: belge,
    setTimeout: (fn, ms) => zaman.setTimeout(fn, ms),
    clearTimeout: (id) => zaman.clearTimeout(id),
    matchMedia: (sorgu) => ({ matches: sistemAzalt && /prefers-reduced-motion:\s*reduce/.test(sorgu) }),
    ...(kopruYok ? {} : { evKaro: kopru }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (!temaRenkYok) vm.runInContext(TEMA_RENK, sandbox, { filename: 'lib/tema-renk.js' });
  if (!ceviriYok) {
    vm.runInContext(DIL, sandbox, { filename: 'lib/dil.js' });
    vm.runInContext(SOZLUK, sandbox, { filename: 'lib/ceviri/yuzey.js' });
  }
  if (!bicimYok) vm.runInContext(BILGI_BICIM, sandbox, { filename: 'lib/bilgi-bicim.js' });
  vm.runInContext(BETIK, sandbox, { filename: 'masaustu-karo-sayfa.js' });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    zaman,
    kok,
    durum: (yuk) => durumDinleyici(yuk),
    dilDegisti: (yuk) => dilDinleyici(yuk),
    ceviriOgeleri,
    odaktaki: () => SahteOge.odaktaki,
    odaginiSil: () => {
      SahteOge.odaktaki = null;
    },
    calistirmalar: () => cagrilar.filter((c) => c[0] === 'calistir').map((c) => c[1]),
    onayarDugmeleri: () => ogeler.get('onayarlar').children,
  };
}

const akit = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
};

// --- Güvenlik yapısı ---------------------------------------------------------------------------------------------------------------

test('betik HTML olarak yorumlanan atama, eval ya da dış kaynak kullanmaz; kimlik ve anahtar kelimesi içermez', () => {
  assert.doesNotMatch(BETIK_KODU, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|importScripts|XMLHttpRequest|\bfetch\s*\(|WebSocket|localStorage|sessionStorage/);
  assert.doesNotMatch(BETIK_KODU, /entity_id|kimlik|token|webhook|\.id\b/i, 'sayfa karonun kimliğini bilmez ve göndermez');
});

test('HTML: katı CSP, satır içi betik/stil yok, yalnız yerel betikler; beklenen kimlikler var', () => {
  assert.match(HTML, /Content-Security-Policy[^>]*default-src 'none'[^>]*script-src 'self'[^>]*style-src 'self'[^>]*connect-src 'none'/);
  assert.doesNotMatch(HTML, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/i, 'satır içi betik yok');
  assert.doesNotMatch(HTML, /\sstyle=|\son\w+=/i, 'satır içi stil/olay yok');
  assert.deepEqual([...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['lib/dil.js', 'lib/ceviri/yuzey.js', 'lib/bilgi-bicim.js', 'lib/tema-renk.js', 'masaustu-karo-sayfa.js']);
  for (const kimlik of ['karo', 'baglanti', 'kaldir', 'ana', 'etiket', 'deger', 'onayarlar']) assert.match(HTML, new RegExp(`id="${kimlik}"`));
});

// --- Çizim -------------------------------------------------------------------------------------------------------------------------

test('açık ışık: etiket, yüzde değeri, "acik" sınıfı; tıklanabilir ana düğme; parlaklık ön ayarları (60 -> en yakın 50 seçili)', async () => {
  const s = sayfayiKur();
  await akit();
  assert.equal(s.oge('etiket').textContent, 'Salon');
  assert.equal(s.oge('deger').textContent, '%60');
  assert.equal(s.oge('karo').classList.contains('acik'), true);
  assert.equal(s.oge('ana').disabled, false);
  assert.equal(s.oge('ana').title, 'Salon — tıklayarak aç/kapat');
  assert.equal(s.oge('ana').getAttribute('aria-label'), 'Salon: %60');
  assert.equal(s.oge('baglanti').textContent, 'Canlı');
  assert.equal(s.oge('baglanti').className, 'baglanti canli');
  assert.equal(s.oge('onayarlar').hidden, false);
  const dugmeler = s.onayarDugmeleri();
  assert.deepEqual(dugmeler.map((d) => d.textContent), ['%25', '%50', '%100']);
  assert.deepEqual(dugmeler.map((d) => d.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.deepEqual(dugmeler.map((d) => d.className), ['onayar', 'onayar secili', 'onayar']);
  assert.equal(dugmeler[0].getAttribute('aria-label'), 'Salon parlaklığı %25');
  assert.ok(dugmeler.every((d) => d.type === 'button' && d.disabled === false));
});

test('hiçbir ön ayara yakın olmayan yüzde için seçili ön ayar yok; kapalı ışıkta da yok', async () => {
  const s = sayfayiKur({ model: karoModeli({ yuzde: 75 }) });
  await akit();
  assert.deepEqual(s.onayarDugmeleri().map((d) => d.getAttribute('aria-pressed')), ['false', 'false', 'false'], '75: en yakın 50 ya da 100 de 12 puandan uzak');
  s.durum({ model: karoModeli({ durum: 'kapali', yuzde: null }) });
  assert.equal(s.oge('deger').textContent, 'kapalı');
  assert.equal(s.oge('karo').classList.contains('acik'), false);
  assert.ok(s.onayarDugmeleri().every((d) => d.getAttribute('aria-pressed') === 'false'));
});

test('ön ayar yoksa (parlaklık kapalı) ön ayar kutusu gizli; ulaşılamayan karoda ön ayarlar devre dışı', async () => {
  const s = sayfayiKur({ model: karoModeli({ parlaklikOnAyarlari: [], yuzde: null }) });
  await akit();
  assert.equal(s.oge('onayarlar').hidden, true);
  assert.equal(s.onayarDugmeleri().length, 0);
  s.durum({ model: karoModeli({ kullanilabilir: false, ulasilamiyor: true, durum: 'bilinmiyor', tiklanabilir: false }) });
  assert.equal(s.oge('deger').textContent, 'ulaşılamıyor');
  assert.equal(s.oge('karo').classList.contains('acik'), false);
  assert.equal(s.oge('ana').disabled, true);
  assert.ok(s.onayarDugmeleri().every((d) => d.disabled === true));
});

test('parlaklık düğmeleri: ön ayar listesi aynıysa model güncellemesinde YENİDEN KURULMAZ (aynı öğeler), seçili sınıf/aria/devre dışı yerinde güncellenir', async () => {
  const s = sayfayiKur({ model: karoModeli({ yuzde: 60 }) });
  await akit();
  const once = [...s.onayarDugmeleri()];
  assert.equal(once.length, 3);
  assert.deepEqual(once.map((d) => d.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  s.durum({ model: karoModeli({ yuzde: 100 }) });
  const sonra = s.onayarDugmeleri();
  assert.equal(sonra.length, 3);
  sonra.forEach((d, i) => assert.equal(d, once[i], 'aynı düğme nesnesi: ' + i));
  assert.deepEqual(sonra.map((d) => d.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assert.deepEqual(sonra.map((d) => d.className), ['onayar', 'onayar', 'onayar secili']);
  // bağlantı durumu / kullanılabilirlik değişince de aynı düğmeler yerinde devre dışı kalır
  s.durum({ model: karoModeli({ yuzde: 100, kullanilabilir: false, baglanti: { canli: false, baglanti: 'yedek' } }) });
  s.onayarDugmeleri().forEach((d, i) => {
    assert.equal(d, once[i]);
    assert.equal(d.disabled, true);
  });
  // etiket değişince aria-label güncellenir
  s.durum({ model: karoModeli({ etiket: 'Mutfak' }) });
  assert.equal(s.onayarDugmeleri()[0].getAttribute('aria-label'), 'Mutfak parlaklığı %25');
  assert.equal(s.onayarDugmeleri()[0], once[0]);
  // tıklama dinleyicisi yerinde güncellemeden sonra da doğru ön ayarı yollar
  s.onayarDugmeleri()[2].tikla();
  assert.deepEqual(s.calistirmalar(), [{ parlaklik: 100 }]);
});

test('parlaklık düğmeleri: ön ayar listesi değişince yeniden kurulur; kutu yalnız değişimde gizlenir/gösterilir', async () => {
  const s = sayfayiKur({ model: karoModeli({ yuzde: 60 }) });
  await akit();
  const once = [...s.onayarDugmeleri()];
  s.durum({ model: karoModeli({ parlaklikOnAyarlari: [25, 100] }) });
  const sonra = s.onayarDugmeleri();
  assert.deepEqual(sonra.map((d) => d.textContent), ['%25', '%100']);
  assert.ok(sonra.every((d) => !once.includes(d)), 'liste değişti: yeni düğmeler');
  s.durum({ model: karoModeli({ parlaklikOnAyarlari: [], yuzde: null }) });
  assert.equal(s.onayarDugmeleri().length, 0);
  assert.equal(s.oge('onayarlar').hidden, true);
  s.durum({ model: karoModeli() });
  assert.equal(s.oge('onayarlar').hidden, false);
  assert.deepEqual(s.onayarDugmeleri().map((d) => d.textContent), ['%25', '%50', '%100']);
});

test('parlaklık düğmeleri: Enter ile ön ayar seçilip durum değişince klavye odağı düğmede kalır (yeniden kurulan listede de aynı değerli düğmeye taşınır)', async () => {
  const s = sayfayiKur({ model: karoModeli({ yuzde: 25 }) });
  await akit();
  const dugme50 = s.onayarDugmeleri()[1];
  dugme50.focus();
  dugme50.tikla(); // Enter: eylem gider, HA onaylayınca karo:durum gelir
  assert.deepEqual(s.calistirmalar(), [{ parlaklik: 50 }]);
  s.durum({ model: karoModeli({ yuzde: 50 }) });
  s.durum({ model: karoModeli({ yuzde: 50, baglanti: { canli: false, baglanti: 'yedek' } }) });
  assert.equal(s.onayarDugmeleri()[1], dugme50, 'odaktaki düğme DOM\'dan çıkmadı');
  assert.equal(s.odaktaki(), dugme50, 'odak yerinde');
  assert.ok(s.onayarDugmeleri().includes(dugme50));
  assert.equal(dugme50.getAttribute('aria-pressed'), 'true');
  // liste değişip yeniden kurulursa odak aynı değerli yeni düğmeye taşınır
  s.durum({ model: karoModeli({ yuzde: 50, parlaklikOnAyarlari: [50, 100] }) });
  const yeni = s.onayarDugmeleri();
  assert.deepEqual(yeni.map((d) => d.textContent), ['%50', '%100']);
  assert.ok(!yeni.includes(dugme50));
  assert.equal(s.odaktaki(), yeni[0], 'odak %50 düğmesinde kaldı');
  // odak ön ayar düğmesinde değilken yeniden kurulumda odak çalınmaz
  s.odaginiSil();
  s.durum({ model: karoModeli({ yuzde: 50 }) });
  assert.equal(s.odaktaki(), null);
});

test('sensör: değer + birim, salt okunur (ana düğme devre dışı, başlık yalnız etiket), ön ayar yok; değer yoksa tire', async () => {
  const s = sayfayiKur({ model: karoModeli({ id: 'sensor.sicaklik', etiket: 'Salon sıcaklığı', alan: 'sensor', durum: 'notr', yuzde: null, tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: '21.5', sayi: 21.5, birim: '°C' } }) });
  await akit();
  assert.equal(s.oge('deger').textContent, '21,5 °C', 'sayı dil ayracıyla (tr: virgül)');
  assert.equal(s.oge('ana').disabled, true);
  assert.equal(s.oge('ana').title, 'Salon sıcaklığı');
  assert.equal(s.oge('onayarlar').hidden, true);
  s.durum({ model: karoModeli({ alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: null, birim: null } }) });
  assert.equal(s.oge('deger').textContent, '—');
  s.durum({ model: karoModeli({ alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: '48', birim: null } }) });
  assert.equal(s.oge('deger').textContent, '48');
  s.durum({ model: karoModeli({ alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: null }) });
  assert.equal(s.oge('deger').textContent, '—');
});

const sensorModeli = (ozellik, ek = {}) => karoModeli({ id: 'sensor.sicaklik', etiket: 'Salon sıcaklığı', alan: 'sensor', durum: 'notr', yuzde: null, tiklanabilir: false, parlaklikOnAyarlari: [], ozellik, ...ek });

test('sensör: HA\'nın unknown / unavailable durumu ham İngilizce metin + birim olarak değil, çevrilmiş metin olarak yazılır (panelle aynı)', async () => {
  const bekle = { tr: ['bilinmiyor', 'ulaşılamıyor'], en: ['unknown', 'unavailable'], de: ['unbekannt', 'nicht verfügbar'], fr: ['inconnu', 'indisponible'], es: ['desconocido', 'no disponible'] };
  for (const [dil, [bilinmiyor, ulasilamiyor]] of Object.entries(bekle)) {
    const s = sayfayiKur({ dil, model: sensorModeli({ deger: 'unknown', sayi: null, birim: '°C' }) });
    await akit();
    assert.equal(s.oge('deger').textContent, bilinmiyor, dil);
    assert.equal(s.oge('ana').getAttribute('aria-label'), 'Salon sıcaklığı: ' + bilinmiyor, dil);
    s.durum({ model: sensorModeli({ deger: 'unavailable', sayi: null, birim: '°C' }) });
    assert.equal(s.oge('deger').textContent, ulasilamiyor, dil);
  }
});

test('sensör: sayı hassasiyet ve dil ayracıyla yazılır (float artığı taşmaz); sayı olmayan metin değerine birim eklenmez', async () => {
  const sayisal = (deger, ek = {}) => sensorModeli({ deger: String(deger), sayi: Number(deger), birim: '°C', hassasiyet: 1, ...ek });
  const s = sayfayiKur({ dil: 'tr', model: sayisal('23.600000381469727') });
  await akit();
  assert.equal(s.oge('deger').textContent, '23,6 °C');
  s.dilDegisti({ dil: 'en' });
  assert.equal(s.oge('deger').textContent, '23.6 °C', 'dil değişince ayraç da değişir');
  s.dilDegisti({ dil: 'de' });
  assert.equal(s.oge('deger').textContent, '23,6 °C');
  s.durum({ model: sayisal('45.2', { birim: '%' }) });
  s.dilDegisti({ dil: 'tr' });
  assert.equal(s.oge('deger').textContent, '%45,2');
  s.dilDegisti({ dil: 'en' });
  assert.equal(s.oge('deger').textContent, '45.2%');
  s.durum({ model: sensorModeli({ deger: 'abc', sayi: null, birim: '°C' }) });
  assert.equal(s.oge('deger').textContent, 'abc');
  s.durum({ model: sensorModeli({ deger: '12:30', sayi: null, birim: 'h' }) });
  assert.equal(s.oge('deger').textContent, '12:30');
  s.durum({ model: sensorModeli({ deger: '', sayi: null, birim: '°C' }) });
  assert.equal(s.oge('deger').textContent, '—');
});

test('sensör: biçimleyici (lib/bilgi-bicim.js) yüklenemese de karo çizilir; sayı eskisi gibi ham değer + birim, metin değeri birimsiz', async () => {
  const s = sayfayiKur({ bicimYok: true, model: sensorModeli({ deger: '21.5', sayi: 21.5, birim: '°C' }) });
  await akit();
  assert.equal(s.oge('deger').textContent, '21.5 °C');
  s.durum({ model: sensorModeli({ deger: 'unknown', sayi: null, birim: '°C' }) });
  assert.equal(s.oge('deger').textContent, 'bilinmiyor');
  s.durum({ model: sensorModeli({ deger: 'abc', sayi: null, birim: '°C' }) });
  assert.equal(s.oge('deger').textContent, 'abc');
});

test('ikili sensör: açık/kapalı metni; bilinmiyorsa tire; sahne için "çalıştır" ipucu', async () => {
  const s = sayfayiKur({ model: karoModeli({ alan: 'binary_sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { acik: true } }) });
  await akit();
  assert.equal(s.oge('deger').textContent, 'açık');
  s.durum({ model: karoModeli({ alan: 'binary_sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { acik: false } }) });
  assert.equal(s.oge('deger').textContent, 'kapalı');
  s.durum({ model: karoModeli({ alan: 'binary_sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { acik: null } }) });
  assert.equal(s.oge('deger').textContent, '—');
  s.durum({ model: karoModeli({ id: 'scene.film', etiket: 'Film', alan: 'scene', durum: 'notr', yuzde: null, parlaklikOnAyarlari: [] }) });
  assert.equal(s.oge('ana').title, 'Film — tıklayarak çalıştır');
  assert.equal(s.oge('deger').textContent, '—');
});

test('GÜVENLİK: HTML içeren etiket ve değer yalnız metin olarak yazılır (öğe oluşmaz)', async () => {
  const kotu = '<img src=x onerror=alert(1)>';
  const s = sayfayiKur({ model: karoModeli({ etiket: kotu, alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: '<b>5</b>', birim: '</span>' } }) });
  await akit();
  assert.equal(s.oge('etiket').textContent, kotu);
  assert.equal(s.oge('deger').textContent, '<b>5</b>', 'sayı olmayan metin değerine birim eklenmez');
  assert.equal(s.oge('etiket').children.length, 0);
  assert.equal(s.oge('karo').getAttribute('aria-label'), kotu);
  s.durum({ model: karoModeli({ etiket: kotu, alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: '5', sayi: 5, birim: '</span>' } }) });
  assert.equal(s.oge('deger').textContent, '5 </span>');
  assert.equal(s.oge('deger').children.length, 0);
});

test('bağlantı durumu: canlı, yedek, bağlanıyor, kapalı; bozuk bağlantı bilgisi boş', async () => {
  const s = sayfayiKur({ model: karoModeli({ baglanti: { canli: false, baglanti: 'yedek' } }) });
  await akit();
  assert.equal(s.oge('baglanti').textContent, 'Yedek mod');
  assert.equal(s.oge('baglanti').className, 'baglanti yedek');
  s.durum({ model: karoModeli({ baglanti: { canli: false, baglanti: 'baglaniyor' } }) });
  assert.equal(s.oge('baglanti').textContent, 'Bağlanıyor…');
  assert.equal(s.oge('baglanti').className, 'baglanti');
  s.durum({ model: karoModeli({ baglanti: { canli: false, baglanti: 'kapali' } }) });
  assert.equal(s.oge('baglanti').textContent, 'Canlı bağlantı kapalı');
  s.durum({ model: karoModeli({ baglanti: null }) });
  assert.equal(s.oge('baglanti').textContent, '');
});

test('bozuk durum iletileri yok sayılır (eski çizim korunur)', async () => {
  const s = sayfayiKur();
  await akit();
  for (const yuk of [null, undefined, 5, 'x', {}, { model: null }, { model: 'x' }]) s.durum(yuk);
  assert.equal(s.oge('etiket').textContent, 'Salon');
});

test('malzeme: acrylic/mica html[data-malzeme] olur, başka değer kaldırır', async () => {
  const s = sayfayiKur({ malzeme: 'mica' });
  await akit();
  assert.equal(s.kok.dataset.malzeme, 'mica');
  s.durum({ malzeme: 'acrylic' });
  assert.equal(s.kok.dataset.malzeme, 'acrylic');
  s.durum({ malzeme: 'yok' });
  assert.equal('malzeme' in s.kok.dataset, false);
  s.durum({ malzeme: '"><script>' });
  assert.equal('malzeme' in s.kok.dataset, false);
});

// --- Görünüm ayarları (o-25 / o-29 / o-34) -------------------------------------------------------------------------------------------

test('görünüm: durumAl yanıtındaki yüksek karşıtlık ve hareketi azalt, karo ilk çizilirken <html> üzerindedir', async () => {
  const s = sayfayiKur({ gorunum: { karsitlik: true, hareketiAzalt: true } });
  await akit();
  assert.equal(s.kok.nitelikler['data-karsitlik'], '1');
  assert.equal(s.kok.nitelikler['data-hareket'], 'azalt');
  assert.equal(s.oge('etiket').textContent, 'Salon', 'karo yine çizildi');
});

test('görünüm: özel palet yalnız beyaz listeli değişkenlere yazılır; data-sema konur; geçersiz değer ve bilinmeyen değişken yok sayılır', async () => {
  const s = sayfayiKur();
  await akit();
  s.durum({ model: karoModeli(), malzeme: 'yok', gorunum: { sema: 'acik', degiskenler: { '--bg': '#f3f5f9', '--vurgu': '#1d4ed8', '--dugme': '#000000', '--bg-yok': '#ffffff', '--metin': 'url(x)' } } });
  assert.equal(s.kok.nitelikler['data-sema'], 'acik');
  assert.deepEqual(JSON.parse(JSON.stringify(s.kok.degiskenler)), { '--bg': '#f3f5f9', '--vurgu': '#1d4ed8' });
});

test('görünüm: yeni iletide görünüm yoksa önceki özel görünüm temizlenir (varsayılana dönüş)', async () => {
  const s = sayfayiKur({ gorunum: { karsitlik: true, hareketiAzalt: true, sema: 'koyu', degiskenler: { '--bg': '#000000' } } });
  await akit();
  assert.ok(s.kok.nitelikler['data-karsitlik']);
  s.durum({ model: karoModeli(), malzeme: 'yok' });
  assert.deepEqual(JSON.parse(JSON.stringify(s.kok.nitelikler)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(s.kok.degiskenler)), {});
});

test('görünüm: sistemin "animasyonları azalt" tercihi de data-hareket="azalt" yazar; ikisi de kapalıyken yazmaz', async () => {
  const sistem = sayfayiKur({ sistemAzalt: true });
  await akit();
  assert.equal(sistem.kok.nitelikler['data-hareket'], 'azalt');
  const hicbiri = sayfayiKur({ gorunum: { karsitlik: false } });
  await akit();
  assert.equal('data-hareket' in hicbiri.kok.nitelikler, false);
  assert.equal('data-karsitlik' in hicbiri.kok.nitelikler, false);
});

test('görünüm: lib/tema-renk.js yüklenemezse karo yine çizilir ve hata fırlatmaz', async () => {
  const s = sayfayiKur({ temaRenkYok: true, gorunum: { karsitlik: true } });
  await akit();
  assert.equal(s.oge('etiket').textContent, 'Salon');
  assert.doesNotThrow(() => s.durum({ model: karoModeli({ etiket: 'Mutfak' }), malzeme: 'yok', gorunum: { karsitlik: true } }));
  assert.equal(s.oge('etiket').textContent, 'Mutfak');
  assert.deepEqual(JSON.parse(JSON.stringify(s.kok.nitelikler)), {});
});

// --- Eylemler ----------------------------------------------------------------------------------------------------------------------

test('ana düğme { tur: "tikla" }, ön ayar { parlaklik } gönderir; sayfa hiçbir zaman kimlik göndermez', async () => {
  const s = sayfayiKur();
  await akit();
  s.oge('ana').tikla();
  await akit();
  s.onayarDugmeleri()[2].tikla();
  await akit();
  s.onayarDugmeleri()[0].tikla();
  await akit();
  assert.deepEqual(s.calistirmalar(), [{ tur: 'tikla' }, { parlaklik: 100 }, { parlaklik: 25 }]);
  for (const yuk of s.calistirmalar()) assert.ok(Object.keys(yuk).every((k) => k === 'tur' || k === 'parlaklik'));
});

test('bir eylem sürerken ikinci tıklama yok sayılır; bitince yenisi gider', async () => {
  let coz;
  const s = sayfayiKur({ calistirYaniti: () => new Promise((c) => { coz = c; }) });
  await akit();
  s.oge('ana').tikla();
  s.oge('ana').tikla();
  s.onayarDugmeleri()[1].tikla();
  await akit();
  assert.equal(s.calistirmalar().length, 1);
  coz({ ok: true });
  await akit();
  s.oge('ana').tikla();
  await akit();
  assert.equal(s.calistirmalar().length, 2);
});

test('başarısız yanıt ya da fırlatan köprü hata çerçevesi çizer; 1,2 sn sonra kalkar', async () => {
  const s = sayfayiKur({ calistirYaniti: { ok: false, tur: 'reddedildi' } });
  await akit();
  s.oge('ana').tikla();
  await akit();
  assert.equal(s.oge('karo').classList.contains('hata'), true);
  s.zaman.ilerle(1199);
  assert.equal(s.oge('karo').classList.contains('hata'), true);
  s.zaman.ilerle(2);
  assert.equal(s.oge('karo').classList.contains('hata'), false);
  const f = sayfayiKur({ calistirYaniti: () => { throw new Error('köprü koptu'); } });
  await akit();
  f.oge('ana').tikla();
  await akit();
  assert.equal(f.oge('karo').classList.contains('hata'), true);
  const basarili = sayfayiKur({ calistirYaniti: { ok: true } });
  await akit();
  basarili.oge('ana').tikla();
  await akit();
  assert.equal(basarili.oge('karo').classList.contains('hata'), false);
});

test('model gelmeden tıklama hiçbir şey göndermez; × düğmesi argümansız kaldir() çağırır', async () => {
  const s = sayfayiKur({ durumYaniti: { ok: false } });
  await akit();
  s.oge('ana').tikla();
  await akit();
  assert.deepEqual(s.calistirmalar(), []);
  s.oge('kaldir').tikla();
  assert.deepEqual(s.cagrilar.filter((c) => c[0] === 'kaldir'), [['kaldir', []]], 'karo kimliği sayfadan gitmez');
});

test('köprü yoksa (yanlış sayfa) betik hata fırlatmaz', async () => {
  assert.doesNotThrow(() => sayfayiKur({ kopruYok: true }));
  const s = sayfayiKur({ kopruYok: true });
  s.oge('ana').tikla();
  s.oge('kaldir').tikla();
  assert.deepEqual(s.cagrilar, []);
});

// --- Dil ---------------------------------------------------------------------------------------------------------------------------

test('dil: durumAl yanıtındaki dil İngilizceyse metinler İngilizce; dil:degisti yeniden çevirir; geçersiz dil yok sayılır', async () => {
  const s = sayfayiKur({ dil: 'en' });
  await akit();
  assert.equal(s.oge('deger').textContent, '60%');
  assert.equal(s.oge('ana').title, 'Salon — click to switch on/off');
  assert.equal(s.oge('baglanti').textContent, 'Live');
  assert.equal(s.onayarDugmeleri()[1].getAttribute('aria-label'), 'Salon brightness 50%');
  assert.equal(s.oge('kaldir').getAttribute('aria-label'), 'Remove from desktop');
  s.dilDegisti({ dil: 'tr' });
  assert.equal(s.oge('deger').textContent, '%60');
  assert.equal(s.oge('kaldir').getAttribute('aria-label'), 'Masaüstünden kaldır');
  for (const gecersiz of [null, undefined, 'en', { dil: 'it' }, { dil: 'DE' }, { dil: 'de-DE' }, { dil: 5 }, {}]) s.dilDegisti(gecersiz);
  assert.equal(s.oge('deger').textContent, '%60', 'geçersiz dil mesajları değiştirmez');
});

test('dil: Almanca, Fransızca ve İspanyolca karo metinlerini çevirir; yüzde "60 %" yazılır; dil:degisti ile diller arasında geçilir', async () => {
  const beklenen = {
    de: { baglanti: 'Live', ana: 'Salon — zum Ein-/Ausschalten klicken', onayar: 'Helligkeit von Salon 50 %', kaldir: 'Vom Desktop entfernen' },
    fr: { baglanti: 'En direct', ana: 'Salon — cliquez pour allumer/éteindre', onayar: 'Luminosité de Salon 50 %', kaldir: 'Retirer du bureau' },
    es: { baglanti: 'En vivo', ana: 'Salon — haz clic para encender/apagar', onayar: 'Brillo de Salon 50 %', kaldir: 'Quitar del escritorio' },
  };
  for (const [dil, b] of Object.entries(beklenen)) {
    const s = sayfayiKur({ dil });
    await akit();
    assert.equal(s.oge('deger').textContent, '60 %', dil);
    assert.equal(s.oge('baglanti').textContent, b.baglanti, dil);
    assert.equal(s.oge('ana').title, b.ana, dil);
    assert.equal(s.onayarDugmeleri()[1].getAttribute('aria-label'), b.onayar, dil);
    assert.equal(s.oge('kaldir').getAttribute('aria-label'), b.kaldir, dil);
  }
  const s = sayfayiKur({ dil: 'de' });
  await akit();
  s.dilDegisti({ dil: 'fr' });
  assert.equal(s.oge('baglanti').textContent, 'En direct');
  s.dilDegisti({ dil: 'es' });
  assert.equal(s.oge('baglanti').textContent, 'En vivo');
  s.dilDegisti({ dil: 'en' });
  assert.equal(s.oge('deger').textContent, '60%');
  s.dilDegisti({ dil: 'tr' });
  assert.equal(s.oge('deger').textContent, '%60');
});

test('çeviri betikleri yüklenemese de karo etiket ve değeriyle çizilir; metin anahtarı yerine boş kalır', async () => {
  const s = sayfayiKur({ ceviriYok: true });
  await akit();
  assert.equal(s.oge('etiket').textContent, 'Salon');
  assert.equal(s.oge('deger').textContent, '');
  assert.doesNotMatch(s.oge('baglanti').textContent, /yuzey\.|masaustu\./);
  const sensor = sayfayiKur({ ceviriYok: true, model: karoModeli({ alan: 'sensor', durum: 'notr', tiklanabilir: false, parlaklikOnAyarlari: [], ozellik: { deger: '5', sayi: 5, birim: 'W' } }) });
  await akit();
  assert.equal(sensor.oge('deger').textContent, '5 W');
});

test('betikteki görünür metinlerin hepsi sözlükten gelir: beş dilin sözlük anahtarları var', () => {
  const kullanilan = new Set([...BETIK_KODU.matchAll(/\bt\('([a-z][\w.]*)'/g)].map((m) => m[1]), [...BETIK_KODU.matchAll(/anahtar = [^'\n]*'([a-z][\w.]*)'\s*:\s*'([a-z][\w.]*)'/g)].flatMap((m) => [m[1], m[2]]));
  assert.ok(kullanilan.size >= 8);
  const sozluk = require('../src/lib/ceviri/yuzey.js');
  for (const anahtar of kullanilan) {
    for (const dil of ['tr', 'en', 'de', 'fr', 'es']) assert.ok(sozluk[dil][anahtar], `${dil}: ${anahtar}`);
  }
});

// --- CSS: renk kontrastı (WCAG 4,5:1) ----------------------------------------------------------------------------------------------

function degiskenler(blok) {
  return Object.fromEntries([...blok.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
const koyuBlok = /^:root\s*\{([^}]*)\}/m.exec(CSS)[1];
const acikBlok = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(CSS)[1];
const TEMALAR = { koyu: degiskenler(koyuBlok), acik: { ...degiskenler(koyuBlok), ...degiskenler(acikBlok) } };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function parlaklik(hex) {
  const k = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}
function kontrast(on, arka) {
  const [acik, koyu] = [parlaklik(on), parlaklik(arka)].sort((a, b) => b - a);
  return (acik + 0.05) / (koyu + 0.05);
}

test('CSS değişkenleri iki temada da tanımlı ve hex renk', () => {
  for (const [tema, d] of Object.entries(TEMALAR)) {
    for (const ad of ['bg', 'kenar', 'dugme', 'metin', 'soluk', 'acik', 'canli', 'yedek', 'hata', 'vurgu', 'rozet-metin']) {
      assert.match(d[ad] ?? '', /^#[0-9a-fA-F]{6}$/, `${tema}: --${ad}`);
    }
  }
});

test('CSS kontrast: metin ve soluk metin zeminde, açık-durum değeri zeminde, seçili ön ayar yazısı vurgu zemininde en az 4,5:1 (iki tema)', () => {
  for (const [tema, d] of Object.entries(TEMALAR)) {
    for (const [ad, on, arka] of [
      ['metin / bg', d.metin, d.bg],
      ['soluk / bg', d.soluk, d.bg],
      ['metin / dugme', d.metin, d.dugme],
      ['acik / bg', d.acik, d.bg],
      ['rozet-metin / vurgu', d['rozet-metin'], d.vurgu],
      ['rozet-metin / canli', d['rozet-metin'], d.canli],
      ['rozet-metin / yedek', d['rozet-metin'], d.yedek],
      ['rozet-metin / hata', d['rozet-metin'], d.hata],
    ]) {
      assert.ok(kontrast(on, arka) >= 4.5, `${tema}: ${ad} = ${kontrast(on, arka).toFixed(2)}`);
    }
  }
});

test('CSS kontrast: bağlantı noktaları ve hata çerçevesi (metin değil, grafik öğe) zeminde en az 3:1 (iki tema)', () => {
  for (const [tema, d] of Object.entries(TEMALAR)) {
    for (const ad of ['canli', 'yedek', 'hata', 'vurgu']) {
      assert.ok(kontrast(d[ad], d.bg) >= 3, `${tema}: ${ad} / bg = ${kontrast(d[ad], d.bg).toFixed(2)}`);
    }
  }
});

test('CSS: sürükleme bölgesi yalnız karo yüzeyinde, düğmeler no-drag; dış kenar boşluğu yeniden boyutlandırmayı yutmaz; satır içi renk yok', () => {
  assert.match(CSS, /\.karo\s*\{[^}]*-webkit-app-region:\s*drag/);
  for (const secici of ['kaldir', 'ana', 'onayar']) {
    assert.match(CSS, new RegExp(`\\.${secici}\\s*\\{[^}]*-webkit-app-region:\\s*no-drag`), secici);
  }
  assert.match(CSS, /body\s*\{\s*padding:\s*4px/);
  const disi = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const renkliSatirlar = disi.split('\n').filter((satir) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(satir) && !/^\s*--[\w-]+:/.test(satir));
  assert.deepEqual(renkliSatirlar, [], 'renkler yalnız değişken tanımlarında');
});

// --- CSS: görünüm ayarları (yüksek karşıtlık, palet, hareketi azalt) ------------------------------------------------------------------

const karsitlikKoyu = /^:root\[data-karsitlik\]\s*\{([^}]*)\}/m.exec(CSS)?.[1] ?? '';
const karsitlikAcik = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\[data-karsitlik\]\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
const KARSITLIK = { koyu: degiskenler(karsitlikKoyu), acik: { ...degiskenler(karsitlikKoyu), ...degiskenler(karsitlikAcik) } };

test('CSS yüksek karşıtlık: iki temada da tüm karo değişkenleri hex; metin ve soluk metin zeminde en az 7:1, diğer yazılar 4,5:1', () => {
  for (const [tema, d] of Object.entries(KARSITLIK)) {
    for (const ad of ['bg', 'kenar', 'dugme', 'metin', 'soluk', 'acik', 'canli', 'yedek', 'hata', 'vurgu', 'rozet-metin']) {
      assert.match(d[ad] ?? '', /^#[0-9a-fA-F]{6}$/, `${tema}: --${ad}`);
    }
    for (const [ad, on, arka, en_az] of [
      ['metin / bg', d.metin, d.bg, 7],
      ['soluk / bg', d.soluk, d.bg, 7],
      ['metin / dugme', d.metin, d.dugme, 7],
      ['acik / bg', d.acik, d.bg, 4.5],
      ['kenar / bg', d.kenar, d.bg, 7],
      ['rozet-metin / vurgu', d['rozet-metin'], d.vurgu, 4.5],
      ['hata / bg', d.hata, d.bg, 4.5],
      ['canli / bg', d.canli, d.bg, 4.5],
      ['yedek / bg', d.yedek, d.bg, 4.5],
    ]) {
      assert.ok(kontrast(on, arka) >= en_az, `${tema}: ${ad} = ${kontrast(on, arka).toFixed(2)}`);
    }
  }
});

test('CSS yüksek karşıtlık: değerler hızlı panelin yuzey.css yüksek karşıtlık paletiyle aynı (iki tema)', () => {
  const yuzey = oku('src/yuzey.css');
  const koyu = degiskenler(/^:root\[data-karsitlik\]\s*\{([^}]*)\}/m.exec(yuzey)[1]);
  const acik = { ...koyu, ...degiskenler(/@media \(prefers-color-scheme: light\)\s*\{\s*:root\[data-karsitlik\]\s*\{([^}]*)\}/.exec(yuzey)[1]) };
  const karsilik = { bg: 'bg', kenar: 'kenar', dugme: 'karo-uzerinde', metin: 'metin', soluk: 'soluk', acik: 'acik', canli: 'canli', yedek: 'yedek', hata: 'hata', vurgu: 'vurgu', 'rozet-metin': 'rozet-metin' };
  for (const [tema, panel] of [['koyu', koyu], ['acik', acik]]) {
    for (const [karoAd, panelAd] of Object.entries(karsilik)) assert.equal(KARSITLIK[tema][karoAd].toLowerCase(), panel[panelAd].toLowerCase(), `${tema}: --${karoAd}`);
  }
});

test('CSS: özel palet (data-sema) düğme zeminini paletten alır ve malzeme kurallarından SONRA gelir; yüksek karşıtlık da malzemeyi geçersiz kılar', () => {
  const kural = /:root\[data-sema\]\s*\{[^}]*--dugme:\s*var\(--karo-uzerinde[^}]*\}/.exec(CSS);
  assert.ok(kural, ':root[data-sema] { --dugme: var(--karo-uzerinde...) }');
  const sonMalzeme = CSS.lastIndexOf(':root[data-malzeme] {');
  assert.ok(sonMalzeme > 0 && kural.index > sonMalzeme, 'palet kuralı malzeme kurallarından sonra (aynı özgüllük: sonraki kazanır)');
  assert.ok(CSS.indexOf(':root[data-karsitlik] {') > sonMalzeme, 'yüksek karşıtlık kuralı malzeme kurallarından sonra');
  assert.match(CSS, /:root\[data-sema="koyu"\]\s*\{\s*color-scheme:\s*dark/);
  assert.match(CSS, /:root\[data-sema="acik"\]\s*\{\s*color-scheme:\s*light/);
});

test('CSS: uygulamanın "Hareketi azalt" ayarı (data-hareket) geçiş ve animasyonu kapatır; kalın kenarlık ve odak halkası yüksek karşıtlıkta', () => {
  assert.match(CSS, /:root\[data-hareket="azalt"\]\s*\*\s*\{[^}]*transition:\s*none !important[^}]*animation:\s*none !important/);
  assert.match(CSS, /:root\[data-karsitlik\] \.karo,\s*:root\[data-karsitlik\] \.onayar\s*\{\s*border-width:\s*2px/);
  assert.match(CSS, /:root\[data-karsitlik\] :focus-visible\s*\{\s*outline-width:\s*3px/);
});
