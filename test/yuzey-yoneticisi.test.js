'use strict';

/**
 * Hızlı panel / palet penceresinin yöneticisi (src/yuzey-yoneticisi.js): sahte Electron ile, hiçbir pencere açılmadan.
 * Ağırlıkla 1.2.0 değişiklikleri: renderer'a giden modelde HA adı yok (h-15), Ctrl + / Ctrl − / Ctrl 0 yakınlaştırma (g-13),
 * köşe bildiriminin panel sınırlarını okuması (g-09). Eylem/IPC güvenlik denetimleri test/degismezler.test.js ve
 * test/ana-surec.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const KOK = path.join(__dirname, '..', 'src');
const YUZEY_HTML = path.join(KOK, 'yuzey.html');
const CALISMA_ALANI = { x: 0, y: 0, width: 1920, height: 1040 };
const EKRAN = { x: 0, y: 0, width: 1920, height: 1080 };
const TEPSI = { x: 1880, y: 1045, width: 24, height: 24 };

function onbellegiTemizle() {
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(KOK + path.sep)) delete require.cache[anahtar];
  }
}

const akit = () => new Promise((coz) => setImmediate(coz));

/** Sahte Electron + yönetici. `zoomVar`: webContents.setZoomFactor var mı (eski sürüm/sahte ortam davranışı). */
function kur({ model, zoomVar = true, getBoundsVar = true } = {}) {
  const pencereler = [];
  const ipcIsleyicileri = new Map();
  class SahteWebContents extends EventEmitter {
    constructor() {
      super();
      this.mesajlar = [];
      this.zoomlar = [];
      if (zoomVar) this.setZoomFactor = (f) => this.zoomlar.push(f);
    }

    setWindowOpenHandler() {}
    send(kanal, yuk) {
      this.mesajlar.push({ kanal, yuk });
    }

    focus() {}
  }
  class SahtePencere extends EventEmitter {
    constructor(secenekler) {
      super();
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
      this.yikik = false;
      this.gorunur = false;
      this.sinirlar = [];
      pencereler.push(this);
      if (getBoundsVar) this.getBounds = () => ({ ...(this.sinirlar.at(-1) ?? { x: 0, y: 0, width: 0, height: 0 }) });
    }

    loadFile() {
      queueMicrotask(() => this.webContents.emit('did-finish-load'));
      return Promise.resolve();
    }

    isDestroyed() {
      return this.yikik;
    }

    destroy() {
      this.yikik = true;
      this.emit('closed');
    }

    isVisible() {
      return this.gorunur;
    }

    isFocused() {
      return this.gorunur;
    }

    show() {
      this.gorunur = true;
    }

    hide() {
      this.gorunur = false;
    }

    focus() {}
    moveTop() {}
    setBounds(sinir) {
      this.sinirlar.push(sinir);
    }

    setBackgroundColor() {}
    setBackgroundMaterial() {}
  }
  const sahte = {
    app: { isPackaged: true },
    BrowserWindow: SahtePencere,
    ipcMain: {
      handle: (kanal, fn) => ipcIsleyicileri.set(kanal, fn),
      on: (kanal, fn) => ipcIsleyicileri.set(kanal, fn),
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({ workArea: CALISMA_ALANI, bounds: EKRAN }),
    },
  };
  const orijinalYukle = Module._load;
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahte : orijinalYukle.call(this, istek, ...gerisi);
  };
  onbellegiTemizle();
  let modul;
  try {
    modul = require(path.join(KOK, 'yuzey-yoneticisi.js'));
  } finally {
    Module._load = orijinalYukle;
  }
  const gunlukler = [];
  const yonetici = modul.yuzeyYoneticisiOlustur({
    modelAl: () => model ?? { gruplar: [], sonlar: [], ust: {} },
    eylem: {},
    tepsiSinirlariAl: () => TEPSI,
    haAc() {},
    ayarlarAc() {},
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: () => 1, clearTimeout() {} },
  });
  yonetici.ipcKaydet();
  const yuzeyOlayi = (pencere) => ({ sender: pencere.webContents, senderFrame: { parent: null, url: pathToFileURL(YUZEY_HTML).href } });
  return {
    yonetici,
    pencereler,
    gunlukler,
    ipcIsleyicileri,
    yuzeyOlayi,
    /** Ana sürecin gönderdiği ileti yükleri */
    mesajlar: (p, kanal) => p.webContents.mesajlar.filter((m) => m.kanal === kanal).map((m) => m.yuk),
    /** before-input-event gönder; { onlendi } döner */
    tus: (p, girdi) => {
      const olay = { onlendi: false, preventDefault() { this.onlendi = true; } };
      p.webContents.emit('before-input-event', olay, { type: 'keyDown', control: true, ...girdi });
      return olay;
    },
    temizle: () => {
      yonetici.kapat();
      onbellegiTemizle();
    },
  };
}

async function panelAc(o) {
  assert.equal(o.yonetici.panelAcKapat('tepsi'), 'acildi');
  await akit();
  return o.pencereler[0];
}

const MODEL_ADLI = {
  gruplar: [
    {
      kod: 'isik',
      etiket: 'Işık',
      karolar: [
        { id: 'light.a', ad: 'Salon Tavan Lambası (HA uzun adı)', etiket: 'Salon', grup: 'isik', grupEtiketi: 'Işık', altGrup: null, alan: 'light', durum: 'acik', yuzde: 50, kullanilabilir: true, ulasilamiyor: false, sinif: 'zararsiz', parlaklikKontrol: true, tekrar: false },
      ],
    },
  ],
  sonlar: [{ id: 'light.a', ad: 'Salon Tavan Lambası (HA uzun adı)', etiket: 'Salon', grup: 'isik', grupEtiketi: 'Işık', altGrup: null, alan: 'light', durum: 'acik', yuzde: 50, kullanilabilir: true, ulasilamiyor: false, sinif: 'zararsiz', parlaklikKontrol: true, tekrar: false }],
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: null, aktifCikis: null, hata: null, uyari: null, anahtarYok: false },
};

test('h-15: renderer\'a giden model (yuzey:durum ve yuzey:durum-al) HA adını (ad) taşımaz; ana süreç modeli değişmez', async () => {
  const o = kur({ model: MODEL_ADLI });
  try {
    const p = await panelAc(o);
    o.yonetici.modelDegisti();
    const gonderilen = o.mesajlar(p, 'yuzey:durum').at(-1);
    assert.ok(gonderilen, 'model gönderildi');
    assert.ok(!JSON.stringify(gonderilen).includes('HA uzun'), 'yuzey:durum yükünde HA adı yok');
    assert.equal(gonderilen.gruplar[0].karolar[0].etiket, 'Salon');
    assert.equal(gonderilen.sonlar[0].etiket, 'Salon');
    assert.equal(gonderilen.ust.anahtarYok, false);

    const yanit = await o.ipcIsleyicileri.get('yuzey:durum-al')(o.yuzeyOlayi(p));
    assert.equal(yanit.ok, true);
    assert.ok(!JSON.stringify(yanit.model).includes('HA uzun'), 'durum-al yanıtında HA adı yok');
    assert.equal(yanit.model.gruplar[0].karolar[0].parlaklikKontrol, true);

    assert.equal(MODEL_ADLI.gruplar[0].karolar[0].ad, 'Salon Tavan Lambası (HA uzun adı)', 'ana süreç modeli (komut satırı eşleşmesi için) ad taşımaya devam eder');
  } finally {
    o.temizle();
  }
});

test('g-13: Ctrl + / Ctrl − / Ctrl 0 panelde sayfa yakınlaştırmasını ve pencere boyutunu (genişlik ve yükseklik) aynı oranda değiştirir', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    const boyutlar = () => p.sinirlar.at(-1);
    assert.deepEqual([boyutlar().width, boyutlar().height], [360, 420]);

    const a = o.tus(p, { key: '+' });
    assert.equal(a.onlendi, true, 'tuş sayfaya gitmez');
    assert.deepEqual(p.webContents.zoomlar, [1.15]);
    assert.deepEqual([boyutlar().width, boyutlar().height], [414, 483]);

    o.tus(p, { key: '=' });
    o.tus(p, { key: '+' });
    assert.deepEqual(p.webContents.zoomlar.slice(-2), [1.3, 1.5]);
    assert.deepEqual([boyutlar().width, boyutlar().height], [540, 630]);
    assert.ok(boyutlar().x >= 8 && boyutlar().x + boyutlar().width <= 1920 - 8, 'çalışma alanında kalır');
    assert.ok(boyutlar().y >= 8 && boyutlar().y + boyutlar().height <= 1040 - 8);

    o.tus(p, { key: '-' });
    assert.equal(p.webContents.zoomlar.at(-1), 1.3);
    o.tus(p, { key: '0' });
    assert.equal(p.webContents.zoomlar.at(-1), 1);
    assert.deepEqual([boyutlar().width, boyutlar().height], [360, 420]);

    const sayi = p.webContents.zoomlar.length;
    const yine = o.tus(p, { key: '0' });
    assert.equal(yine.onlendi, true);
    assert.equal(p.webContents.zoomlar.length, sayi, 'değişmeyen yakınlaştırma yeniden uygulanmaz');
    for (let i = 0; i < 10; i += 1) o.tus(p, { key: '+' });
    assert.equal(p.webContents.zoomlar.at(-1), 2, 'en çok 2 kat');

    const baskasi = o.tus(p, { key: 'a' });
    assert.equal(baskasi.onlendi, false, 'diğer tuşlar sayfaya gider');
    assert.equal(o.tus(p, { key: '+', control: false }).onlendi, false, 'Ctrl olmadan yakınlaştırma yok');
    assert.equal(o.tus(p, { key: '+', type: 'keyUp' }).onlendi, false);
  } finally {
    o.temizle();
  }
});

test('g-13: palette de ölçeklenir (genişlik 560 * ölçek, çalışma alanına sığacak biçimde); renderer\'ın bildirdiği yükseklik CSS pikselidir ve ölçekle çarpılır', async () => {
  const o = kur();
  try {
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    const p = o.pencereler[0];
    const sinir = () => p.sinirlar.at(-1);
    assert.equal(sinir().width, 560);
    o.tus(p, { key: '+' });
    o.tus(p, { key: '+' });
    o.tus(p, { key: '+' });
    assert.equal(sinir().width, 840, '560 * 1.5');
    for (let i = 0; i < 6; i += 1) o.tus(p, { key: '+' });
    assert.equal(sinir().width, 1120);

    o.tus(p, { key: '0' });
    o.tus(p, { key: '+' }); // 1.15
    const boyut = o.ipcIsleyicileri.get('yuzey:boyut');
    boyut(o.yuzeyOlayi(p), 400); // 400 CSS pikseli
    assert.equal(sinir().height, 460, '400 * 1.15');
    boyut(o.yuzeyOlayi(p), 400); // aynı yükseklik: yeni yerleştirme yok
    const sayi = p.sinirlar.length;
    boyut(o.yuzeyOlayi(p), 400);
    assert.equal(p.sinirlar.length, sayi);
    for (let i = 0; i < 6; i += 1) o.tus(p, { key: '+' });
    boyut(o.yuzeyOlayi(p), 600);
    assert.equal(sinir().height, 1024, 'çalışma alanından 16 piksel pay kalır');
    o.tus(p, { key: '0' });
    assert.equal(sinir().height, 512, 'CSS yüksekliği (1024 / 2) saklandı: ölçek 1\'e dönünce 512');
  } finally {
    o.temizle();
  }
});

test('g-13: yakınlaştırma pencere gizli/yeniden oluşturulsa da korunur; gizliyken yapılan değişiklik bir sonraki gösterimde uygulanır', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    o.tus(p, { key: '+' });
    o.tus(p, { key: '+' }); // 1.3
    o.yonetici.gizle('kapat');
    o.yonetici.panelAcKapat('tepsi');
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [468, 546], 'yeniden gösterimde 1.3 ölçek');

    // sayfa süreci çöker: yeni pencere oluşur, did-finish-load'da yakınlaştırma yeniden uygulanır
    p.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(p.yikik, true);
    o.yonetici.panelAcKapat('tepsi');
    await akit();
    const yeni = o.pencereler[1];
    assert.ok(yeni && yeni !== p);
    assert.deepEqual(yeni.webContents.zoomlar, [1.3]);
    assert.equal(yeni.sinirlar.at(-1).width, 468);
  } finally {
    o.temizle();
  }
});

test('g-13: yakınlaştırma desteği olmayan ortamda (setZoomFactor yok) hata vermez, pencere boyutu yine ölçeklenir', async () => {
  const o = kur({ zoomVar: false });
  try {
    const p = await panelAc(o);
    const olay = o.tus(p, { key: '+' });
    assert.equal(olay.onlendi, true);
    assert.equal(p.sinirlar.at(-1).width, 414);
    assert.deepEqual(o.gunlukler, []);
  } finally {
    o.temizle();
  }
});

test('g-13: eski pencerenin geç gelen tuş olayı yeni pencereyi etkilemez; pencere gizliyken tuş yerleştirme yapmaz', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    p.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    const sayi = p.sinirlar.length;
    const olay = o.tus(p, { key: '+' });
    assert.equal(olay.onlendi, false, 'sıfırlanmış pencerenin olayı yok sayılır');
    assert.equal(p.sinirlar.length, sayi);

    o.yonetici.panelAcKapat('tepsi');
    await akit();
    const yeni = o.pencereler[1];
    o.yonetici.gizle('kapat');
    const gizliSayi = yeni.sinirlar.length;
    o.tus(yeni, { key: '+' });
    assert.equal(yeni.sinirlar.length, gizliSayi, 'gizliyken setBounds yok');
    o.yonetici.panelAcKapat('tepsi');
    assert.equal(yeni.sinirlar.at(-1).width, 414, 'gösterilince uygulanır');
  } finally {
    o.temizle();
  }
});

test('g-09: gorunenSinirlar yalnız panel/palet görünürken pencerenin sınırlarını verir; kapalıysa ya da okunamıyorsa null', async () => {
  const o = kur();
  try {
    assert.equal(o.yonetici.gorunenSinirlar(), null, 'pencere henüz yok');
    const p = await panelAc(o);
    const sinir = o.yonetici.gorunenSinirlar();
    assert.deepEqual(sinir, p.getBounds());
    assert.equal(sinir.width, 360);
    o.yonetici.gizle('kapat');
    assert.equal(o.yonetici.gorunenSinirlar(), null, 'gizliyken engel değildir');
    o.yonetici.panelAcKapat('tepsi');
    p.getBounds = () => {
      throw new Error('okunamadı');
    };
    assert.equal(o.yonetici.gorunenSinirlar(), null);
  } finally {
    o.temizle();
  }
  const getBoundsYok = kur({ getBoundsVar: false });
  try {
    await panelAc(getBoundsYok);
    assert.equal(getBoundsYok.yonetici.gorunenSinirlar(), null, 'getBounds olmayan sahte pencere');
  } finally {
    getBoundsYok.temizle();
  }
});
