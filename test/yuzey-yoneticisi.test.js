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
function kur({ model, zoomVar = true, getBoundsVar = true, okuma = null, eylem = {}, sagTik = null, ayar = {}, gorunumAl, metinOlcegiAl, bildirim = null } = {}) {
  // 1.4.0 (o-22, o-32): ustteAl / opaklikAl / malzemeAl ayarları; testler `ayarlar` nesnesini değiştirir
  const ayarlar = { ust: false, opaklik: 100, malzeme: 'yok', ...ayar };
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
      this.ustCagrilari = []; // setAlwaysOnTop(deger, seviye)
      this.opakliklar = []; // setOpacity(oran)
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
    setAlwaysOnTop(deger, seviye) {
      this.ustCagrilari.push([deger, seviye]);
    }

    setOpacity(oran) {
      this.opakliklar.push(oran);
    }
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
    eylem,
    okuma,
    sagTik,
    bildirim,
    tepsiSinirlariAl: () => TEPSI,
    ustteAl: () => ayarlar.ust,
    opaklikAl: () => ayarlar.opaklik,
    malzemeAl: () => ({ malzeme: ayarlar.malzeme, secenekler: { backgroundColor: '#1b1f27' } }),
    haAc() {},
    ayarlarAc() {},
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: () => 1, clearTimeout() {} },
    ...(gorunumAl ? { gorunumAl } : {}),
    ...(metinOlcegiAl ? { metinOlcegiAl } : {}),
  });
  yonetici.ipcKaydet();
  const yuzeyOlayi = (pencere) => ({ sender: pencere.webContents, senderFrame: { parent: null, url: pathToFileURL(YUZEY_HTML).href } });
  return {
    yonetici,
    ayarlar,
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

test('1.4.0 yuzey:oku: yalnız açık yüzeyden ve yalnız kayıtlı varlık için; okuma yoksa ya da yabancı göndericiden reddedilir', async () => {
  const cagrilar = [];
  const okuma = {
    gecmis: async (k, s) => (cagrilar.push(['gecmis', k, s]), { 'sensor.a': [] }),
    takvimEtkinlikleri: async () => [],
    havaTahmini: async () => [],
    yapilacaklar: async () => [],
  };
  const o = kur({ okuma, eylem: { kayitliMi: (k) => k === 'sensor.a' } });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:oku');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, { tur: 'gecmis', kimlikler: ['sensor.a'] })).ok, false);
    const p = await panelAc(o);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { tur: 'gecmis', kimlikler: ['sensor.a'], saat: 6 }), { ok: true, veri: { 'sensor.a': [] } });
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { tur: 'gecmis', kimlikler: ['sensor.b'] }), { ok: false, tur: 'kayitsiz' });
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { tur: 'servis', kimlik: 'sensor.a' }), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(cagrilar, [['gecmis', ['sensor.a'], { saat: 6 }]]);
  } finally {
    o.temizle();
  }
  const okumasiz = kur();
  try {
    const p = await panelAc(okumasiz);
    assert.deepEqual(await okumasiz.ipcIsleyicileri.get('yuzey:oku')(okumasiz.yuzeyOlayi(p), { tur: 'gecmis', kimlikler: ['sensor.a'] }), { ok: false, tur: 'gecersiz' });
  } finally {
    okumasiz.temizle();
  }
});

test('1.4.0 yuzey:sag-tik (o-16): yalnız açık yüzeyden, yalnız kayıtlı karo için; menüyü kimlik ve pencereyle açar, hata paneli çökertmez, menü sürerken sayaç tutulur', async () => {
  const cagrilar = [];
  let bitir = null;
  const sagTik = (kimlik, pencere) => {
    cagrilar.push([kimlik, pencere]);
    return new Promise((coz) => {
      bitir = coz;
    });
  };
  const o = kur({ sagTik, eylem: { kayitliMi: (k) => k === 'light.salon' } });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:sag-tik');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, 'light.salon')).ok, false, 'yabancı gönderici reddedilir');
    assert.deepEqual(cagrilar, []);

    const kapaliyken = o.yuzeyOlayi({ webContents: {} });
    assert.deepEqual(await isle(kapaliyken, 'light.salon'), { ok: false, hata: 'İzin yok.' }, 'açık olmayan yüzeyden gelen istek reddedilir');

    const p = await panelAc(o);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'light.baska'), { ok: false, tur: 'gecersiz' }, 'kayıtlı olmayan varlık için menü açılmaz');
    for (const kotu of [undefined, null, 42, {}, ['light.salon']]) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' });
    }
    assert.deepEqual(cagrilar, []);

    const bekleyen = isle(o.yuzeyOlayi(p), 'light.salon');
    await akit();
    assert.equal(cagrilar.length, 1);
    assert.equal(cagrilar[0][0], 'light.salon');
    assert.equal(cagrilar[0][1], p, 'menü panel penceresine bağlı açılır');
    bitir();
    assert.deepEqual(await bekleyen, { ok: true });
  } finally {
    o.temizle();
  }

  const patlayan = kur({ sagTik: () => Promise.reject(new Error('menu')), eylem: { kayitliMi: () => true } });
  try {
    const p = await panelAc(patlayan);
    assert.deepEqual(await patlayan.ipcIsleyicileri.get('yuzey:sag-tik')(patlayan.yuzeyOlayi(p), 'light.salon'), { ok: true });
    assert.ok(patlayan.gunlukler.includes('Karo menüsü açılamadı.'));
    assert.doesNotMatch(patlayan.gunlukler.join(' | '), /menu|light.salon/, 'günlüğe hata ayrıntısı ve kimlik yazılmaz');
  } finally {
    patlayan.temizle();
  }

  const menusuz = kur({ eylem: { kayitliMi: () => true } });
  try {
    const p = await panelAc(menusuz);
    assert.deepEqual(await menusuz.ipcIsleyicileri.get('yuzey:sag-tik')(menusuz.yuzeyOlayi(p), 'light.salon'), { ok: false, tur: 'gecersiz' });
  } finally {
    menusuz.temizle();
  }
});

// --- 1.4.0 (o-22): panel her zaman üstte; (o-32): panel opaklığı ------------------------------------------------------------

test('o-22: ayar kapalıyken (varsayılan) panel 1.3.0 gibi "floating" seviyesinde; "normal" ve "screen-saver" kullanılmaz', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    assert.equal(p.secenekler.alwaysOnTop, true, 'pencere oluşturulurken alwaysOnTop true');
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'floating']);
    assert.ok(p.ustCagrilari.every(([deger, seviye]) => deger === true && seviye === 'floating'));
    o.yonetici.gizle();
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'floating']);
    assert.ok(p.ustCagrilari.every(([, seviye]) => seviye !== 'normal'));
  } finally {
    o.temizle();
  }
});

test('o-22: ayar açıkken görünür panel "screen-saver" seviyesindedir (tam ekran uygulamaların üstünde); gizlenince "floating"a döner', async () => {
  const o = kur({ ayar: { ust: true } });
  try {
    const p = await panelAc(o);
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'screen-saver']);
    o.yonetici.gizle();
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'floating'], 'gizliyken yüksek seviye bırakılmaz');
    assert.equal(o.yonetici.panelAcKapat('tepsi'), 'acildi');
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'screen-saver']);
    assert.ok(p.ustCagrilari.every(([deger, seviye]) => deger === true && (seviye === 'screen-saver' || seviye === 'floating')));
  } finally {
    o.temizle();
  }
});

test('o-22: ayar değişince açık panel hemen güncellenir; gizliyken pencereye dokunulmaz (bir sonraki gösterimde uygulanır)', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    o.ayarlar.ust = true;
    o.yonetici.ustteDegisti();
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'screen-saver']);
    o.ayarlar.ust = false;
    o.yonetici.ustteDegisti();
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'floating']);
    o.yonetici.gizle();
    const sayi = p.ustCagrilari.length;
    o.ayarlar.ust = true;
    o.yonetici.ustteDegisti();
    assert.equal(p.ustCagrilari.length, sayi, 'gizliyken seviye değişmez');
    o.yonetici.panelAcKapat('tepsi');
    assert.deepEqual(p.ustCagrilari.at(-1), [true, 'screen-saver']);
  } finally {
    o.temizle();
  }
});

test('o-22: seviye uygulanamazsa (sistem desteklemiyor) panel yine açılır, günlüğe yazılır; ayar okunamazsa "floating"', async () => {
  const o = kur({ ayar: { ust: true } });
  try {
    const p = await panelAc(o);
    o.yonetici.gizle();
    p.setAlwaysOnTop = () => {
      throw new Error('desteklenmiyor');
    };
    assert.equal(o.yonetici.panelAcKapat('tepsi'), 'acildi');
    assert.equal(p.gorunur, true);
    assert.ok(o.gunlukler.some((m) => /üst seviyesi uygulanamadı/.test(m)));
    p.setAlwaysOnTop = undefined; // eski ortam: işlev yok
    assert.doesNotThrow(() => o.yonetici.ustteDegisti());
  } finally {
    o.temizle();
  }
});

test('o-32: opaklık yalnız opak malzemede (yok) uygulanır; 50-100 dışı değer tam opak; akrilik/mica tam opak', async () => {
  const o = kur({ ayar: { opaklik: 70 } });
  try {
    const p = await panelAc(o);
    assert.equal(p.opakliklar.at(-1), 0.7);
    o.ayarlar.opaklik = 55;
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.at(-1), 0.55);
    o.ayarlar.opaklik = 100;
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.at(-1), 1);
    for (const kotu of [49, 101, 0, NaN, '80', null]) {
      o.ayarlar.opaklik = kotu;
      o.yonetici.opaklikDegisti();
      assert.equal(p.opakliklar.at(-1), 1, `${String(kotu)} -> tam opak`);
    }
    o.ayarlar.opaklik = 70;
    o.ayarlar.malzeme = 'acrylic';
    o.yonetici.malzemeyiUygula();
    assert.equal(p.opakliklar.at(-1), 1, 'akrilikte pencere tam opak (şeffaflık malzemeden gelir)');
    o.ayarlar.malzeme = 'mica';
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.at(-1), 1);
    o.ayarlar.malzeme = 'yok';
    o.yonetici.malzemeyiUygula();
    assert.equal(p.opakliklar.at(-1), 0.7, 'opak malzemeye dönünce opaklık yeniden uygulanır');
  } finally {
    o.temizle();
  }
});

test('o-32: gizliyken opaklık değişirse bir sonraki gösterimde uygulanır; opaklık desteği olmayan ortamda hata vermez', async () => {
  const o = kur({ ayar: { opaklik: 100 } });
  try {
    const p = await panelAc(o);
    o.yonetici.gizle();
    const sayi = p.opakliklar.length;
    o.ayarlar.opaklik = 60;
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.length, sayi);
    o.yonetici.panelAcKapat('tepsi');
    assert.equal(p.opakliklar.at(-1), 0.6);
    p.setOpacity = undefined;
    assert.doesNotThrow(() => o.yonetici.opaklikDegisti());
    p.setOpacity = () => {
      throw new Error('desteklenmiyor');
    };
    assert.doesNotThrow(() => o.yonetici.opaklikDegisti());
    assert.ok(o.gunlukler.some((m) => /opaklığı uygulanamadı/.test(m)));
  } finally {
    o.temizle();
  }
});

// ---- 1.4.0 grup "tema": görünüm modeli (o-29, o-34) ve metin boyutu (o-25) -----------------------------------------------

test('tema: görünüm modeli yuzey:goster ve yuzey:durum-al yüküne YALNIZ varsayılandan farklıysa eklenir', async () => {
  const model = { sema: 'koyu', degiskenler: { '--bg': '#0e1c2b' }, animasyon: { gecis: true, hava: 'otomatik', mevsim: 'yok' } };
  let simdiki = null;
  const o = kur({ gorunumAl: () => simdiki });
  try {
    const p = await panelAc(o);
    const ilk = o.mesajlar(p, 'yuzey:goster').at(-1);
    assert.deepEqual(Object.keys(ilk).sort(), ['malzeme', 'mod'], 'varsayılan görünümde gorunum anahtarı hiç yok');
    assert.equal(Object.hasOwn((await o.ipcIsleyicileri.get('yuzey:durum-al')(o.yuzeyOlayi(p))), 'gorunum'), false);

    simdiki = model;
    o.yonetici.gizle('kapat');
    o.yonetici.panelAcKapat('tepsi');
    assert.deepEqual(o.mesajlar(p, 'yuzey:goster').at(-1).gorunum, model, 'her gösterimde güncel model gider');
    const yanit = await o.ipcIsleyicileri.get('yuzey:durum-al')(o.yuzeyOlayi(p));
    assert.deepEqual(yanit.gorunum, model);
    assert.equal(yanit.ok, true);
  } finally {
    o.temizle();
  }
});

test('tema: görünüm modeli üretilemezse (istisna) panel yine açılır, yüke gorunum eklenmez', async () => {
  const o = kur({ gorunumAl: () => { throw new Error('bozuk ayar'); } });
  try {
    const p = await panelAc(o);
    assert.equal(p.gorunur, true);
    assert.equal(Object.hasOwn(o.mesajlar(p, 'yuzey:goster').at(-1), 'gorunum'), false);
    const yanit = await o.ipcIsleyicileri.get('yuzey:durum-al')(o.yuzeyOlayi(p));
    assert.equal(yanit.ok, true);
    assert.equal(Object.hasOwn(yanit, 'gorunum'), false);
  } finally {
    o.temizle();
  }
});

test('o-25 metin boyutu: panel Ayarlar\'daki ölçekle açılır (sayfa yakınlaştırması ve pencere boyutu), Ctrl 0 bu tabana döner', async () => {
  const o = kur({ metinOlcegiAl: () => 1.3 });
  try {
    const p = await panelAc(o);
    await akit();
    assert.deepEqual(p.webContents.zoomlar.at(-1), 1.3, 'sayfa 130% ile açılır');
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [468, 546]);

    o.tus(p, { key: '+' });
    assert.equal(p.webContents.zoomlar.at(-1), 1.5);
    o.tus(p, { key: '-' });
    o.tus(p, { key: '-' });
    assert.equal(p.webContents.zoomlar.at(-1), 1.15, 'taban altına inilebilir');
    o.tus(p, { key: '0' });
    assert.equal(p.webContents.zoomlar.at(-1), 1.3, 'Ctrl 0 tabana (130%) döner, 100%\'e değil');
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [468, 546]);
  } finally {
    o.temizle();
  }
});

test('o-25 metin boyutu: geçersiz ya da hatalı ölçek 1 sayılır; palet de tabanla açılır', async () => {
  for (const kotu of [1.2, 0, -1, NaN, 'x', undefined, null, 9]) {
    const o = kur({ metinOlcegiAl: () => kotu });
    try {
      const p = await panelAc(o);
      assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [360, 420], String(kotu));
      assert.equal(p.webContents.zoomlar.length, 0, 'ölçek 1 iken yakınlaştırma çağrısı yok');
    } finally {
      o.temizle();
    }
  }
  const hatali = kur({ metinOlcegiAl: () => { throw new Error('x'); } });
  try {
    const p = await panelAc(hatali);
    assert.equal(p.sinirlar.at(-1).width, 360);
  } finally {
    hatali.temizle();
  }
  const palet = kur({ metinOlcegiAl: () => 1.5 });
  try {
    assert.equal(palet.yonetici.paletAcKapat(), 'acildi');
    await akit();
    const p = palet.pencereler[0];
    assert.equal(p.webContents.zoomlar.at(-1), 1.5);
    assert.equal(p.sinirlar.at(-1).width, 840, 'palet 560 * 1,5');
  } finally {
    palet.temizle();
  }
});

test('o-25 metin boyutu: Ayarlar\'da değişince açık panel yeni tabana gelir ve oturumdaki elle yakınlaştırma bırakılır', async () => {
  let olcek = 1;
  const o = kur({ metinOlcegiAl: () => olcek });
  try {
    const p = await panelAc(o);
    o.tus(p, { key: '+' });
    o.tus(p, { key: '+' }); // elle 1.3
    assert.equal(p.webContents.zoomlar.at(-1), 1.3);

    olcek = 1.15;
    o.yonetici.metinOlcegiUygula();
    assert.equal(p.webContents.zoomlar.at(-1), 1.15, 'elle seçim bırakılır, yeni taban uygulanır');
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [414, 483], 'görünür pencere yeniden yerleştirilir');

    // gizliyken değişiklik bir sonraki gösterimde uygulanır
    o.yonetici.gizle('kapat');
    olcek = 1.5;
    o.yonetici.metinOlcegiUygula();
    o.yonetici.panelAcKapat('tepsi');
    assert.equal(p.webContents.zoomlar.at(-1), 1.5);
    assert.equal(p.sinirlar.at(-1).width, 540);
  } finally {
    o.temizle();
  }
});

test('o-25 metin boyutu: elle yakınlaştırma varken ayar değişmediği sürece oturum seçimi korunur (gizle/aç)', async () => {
  const o = kur({ metinOlcegiAl: () => 1.15 });
  try {
    const p = await panelAc(o);
    o.tus(p, { key: '+' }); // 1.3
    o.yonetici.gizle('kapat');
    o.yonetici.panelAcKapat('tepsi');
    assert.equal(p.webContents.zoomlar.at(-1), 1.3, 'elle seçim yeniden gösterimde korunur');
    o.tus(p, { key: '0' });
    o.yonetici.gizle('kapat');
    o.yonetici.panelAcKapat('tepsi');
    assert.equal(p.webContents.zoomlar.at(-1), 1.15);
  } finally {
    o.temizle();
  }
});

test('o-25 + o-32: yüksek karşıtlıkta panel opaklığı yok sayılır (opak zemin vaadi bozulmaz); kapanınca ayar yine uygulanır', async () => {
  let gorunum = { karsitlik: true };
  const o = kur({ ayar: { opaklik: 70 }, gorunumAl: () => gorunum });
  try {
    const p = await panelAc(o);
    assert.equal(p.opakliklar.at(-1), 1, 'yüksek karşıtlıkta tam opak');
    gorunum = null;
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.at(-1), 0.7, 'yüksek karşıtlık kapalıyken ayar uygulanır');
    gorunum = { karsitlik: true };
    o.yonetici.opaklikDegisti();
    assert.equal(p.opakliklar.at(-1), 1);
  } finally {
    o.temizle();
  }
});

// --- 1.4.0 bildirim şeridi ---------------------------------------------------------------------------------------------------

const BILDIRIM_OGESI = { anahtar: 'k0123456789abcdef', kaynak: 'ha', baslik: 'Çamaşır', metin: 'Çamaşır bitti', zaman: 1_760_000_000_000, simge: '🏠' };

test('1.4.0 bildirim: renderer modelinde yalnız beyaz listedeki alanlar gider; süzgeçten geçmeyen öğe düşer ve "gizlenen"e eklenir; model yoksa null', async () => {
  const bildirim = {
    ogeler: [
      { ...BILDIRIM_OGESI, haKimligi: 'garage_door_alert', ham: 'x' },
      { ...BILDIRIM_OGESI, anahtar: 'kffffffffffffffff', metin: 'Garaj kapısı açık kaldı' },
      { ...BILDIRIM_OGESI, anahtar: 'kaaaaaaaaaaaaaaaa', kaynak: 'bilinmeyen' },
    ],
    sayi: 3,
    gizlenen: 2,
  };
  const o = kur({ model: { ...MODEL_ADLI, bildirim } });
  try {
    const p = await panelAc(o);
    o.yonetici.modelDegisti();
    const yuk = o.mesajlar(p, 'yuzey:durum').at(-1);
    assert.deepEqual(yuk.bildirim, { ogeler: [BILDIRIM_OGESI], sayi: 1, gizlenen: 3 }, 'elenen öğeler toplamdan düşer, süzgeç yüzünden elenenler gizlenene eklenir');
    assert.ok(!JSON.stringify(yuk).includes('garage_door_alert'), 'HA bildirim kimliği panele gitmez');
    assert.ok(!JSON.stringify(yuk).includes('Garaj'), 'kapı metni panele gitmez');
    const yanit = await o.ipcIsleyicileri.get('yuzey:durum-al')(o.yuzeyOlayi(p));
    assert.deepEqual(yanit.model.bildirim.ogeler.map((x) => x.anahtar), ['k0123456789abcdef']);
  } finally {
    o.temizle();
  }
  const yok = kur({ model: MODEL_ADLI });
  try {
    const p = await panelAc(yok);
    yok.yonetici.modelDegisti();
    assert.equal(yok.mesajlar(p, 'yuzey:durum').at(-1).bildirim, null);
  } finally {
    yok.temizle();
  }
});

test('1.4.0 yuzey:bildirim-kapat: yalnız açık hızlı panelden; anahtar doğrulanır; HA bildirimi eylem.bildirimKapat ile kapatılır', async () => {
  const kapatCagrilari = [];
  const haCagrilari = [];
  const bildirim = {
    kapat: async (anahtar, haKapat) => {
      kapatCagrilari.push(anahtar);
      const yanit = await haKapat('haKimligi');
      return { ok: yanit.ok === true };
    },
  };
  const eylem = { bildirimKapat: async (id) => (haCagrilari.push(id), { ok: true }) };
  const o = kur({ bildirim, eylem });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:bildirim-kapat');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, 'k0123456789abcdef')).ok, false);
    assert.deepEqual(kapatCagrilari, [], 'yabancı gönderici: hiçbir şey kapanmaz');

    const p = await panelAc(o);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'k0123456789abcdef'), { ok: true });
    assert.deepEqual(kapatCagrilari, ['k0123456789abcdef']);
    assert.deepEqual(haCagrilari, ['haKimligi']);
    for (const kotu of [undefined, null, 42, {}, [], '', 'x'.repeat(41)]) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, `geçersiz anahtar: ${String(kotu).slice(0, 10)}`);
    }
    assert.equal(kapatCagrilari.length, 1);

    // palet kipinde şerit yok: kapatma kabul edilmez
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'k0123456789abcdef'), { ok: false, tur: 'gecersiz' });
    // pencere gizliyken de kabul edilmez
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'k0123456789abcdef'), { ok: false, tur: 'gecersiz' });
    assert.equal(kapatCagrilari.length, 1);
  } finally {
    o.temizle();
  }
  const bildirimsiz = kur();
  try {
    const p = await panelAc(bildirimsiz);
    assert.deepEqual(await bildirimsiz.ipcIsleyicileri.get('yuzey:bildirim-kapat')(bildirimsiz.yuzeyOlayi(p), 'k0123456789abcdef'), { ok: false, tur: 'gecersiz' });
  } finally {
    bildirimsiz.temizle();
  }
});
