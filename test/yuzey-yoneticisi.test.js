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
function kur({ model, zoomVar = true, getBoundsVar = true, okuma = null, eylem = {}, sagTik = null, ayar = {}, gorunumAl, metinOlcegiAl, bildirim = null, kamera = null, korumaVar = true, disOnay = null, geriAl = null, eylemEk = null } = {}) {
  // 1.4.0 (o-22, o-32): ustteAl / opaklikAl / malzemeAl ayarları; testler `ayarlar` nesnesini değiştirir
  const ayarlar = { ust: false, opaklik: 100, malzeme: 'yok', koru: false, ...ayar };
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
      this.korumalar = []; // setContentProtection(deger) (1.4.0 kamera)
      if (korumaVar) this.setContentProtection = (deger) => this.korumalar.push(deger);
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
    kamera,
    korumaAl: () => ayarlar.koru,
    disOnay,
    ...(geriAl ? { geriAl } : {}),
    ...(eylemEk ? { eylemEk } : {}),
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

// ---- 1.4.0 kamera (o-48): yuzey:kamera kanalı, ekran görüntüsü koruması, bellek temizliği ---------------------------------

function sahteKamera() {
  const cagrilar = [];
  return {
    cagrilar,
    temizlemeler: { sayi: 0 },
    al: async (kimlik) => {
      cagrilar.push(kimlik);
      return { ok: true, veri: 'data:image/png;base64,AAAA', yas: 0, onbellek: false };
    },
    temizle() {
      this.temizlemeler.sayi += 1;
    },
  };
}

test('kamera: yuzey:kamera yalnız açık hızlı panelden çalışır; palette, gizliyken ve yüzey dışı gönderenden reddedilir', async () => {
  const kamera = sahteKamera();
  const o = kur({ kamera });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:kamera');
    assert.ok(isle, 'kanal kayıtlı');
    const p = await panelAc(o);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'camera.salon'), { ok: true, veri: 'data:image/png;base64,AAAA', yas: 0, onbellek: false });
    assert.deepEqual(kamera.cagrilar, ['camera.salon']);
    // yüzey dışı gönderen (başka çerçeve / başka sayfa)
    const yabanci = { sender: p.webContents, senderFrame: { parent: null, url: 'https://ornek.com/' } };
    const izinsiz = await isle(yabanci, 'camera.salon');
    assert.equal(izinsiz.ok, false);
    assert.equal(kamera.cagrilar.length, 1, 'yabancı gönderen kamera servisine ulaşamaz');
    // palet kipi
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'camera.salon'), { ok: false, tur: 'gecersiz' });
    // gizliyken
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'camera.salon'), { ok: false, tur: 'gecersiz' });
    assert.equal(kamera.cagrilar.length, 1);
  } finally {
    o.temizle();
  }
});

test('kamera: yük yalnız kısa metin kimliktir (nesne, dizi, boş, 120+ karakter reddedilir); servis kimliği ayrıca doğrular', async () => {
  const kamera = sahteKamera();
  const o = kur({ kamera });
  try {
    const p = await panelAc(o);
    const isle = o.ipcIsleyicileri.get('yuzey:kamera');
    for (const kotu of [undefined, null, 42, {}, [], ['camera.salon'], '', 'x'.repeat(121), { kimlik: 'camera.salon' }]) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu)?.slice(0, 30));
    }
    assert.equal(kamera.cagrilar.length, 0);
    assert.equal((await isle(o.yuzeyOlayi(p), 'camera.' + 'a'.repeat(100))).ok, true, '120 karaktere kadar servise gider');
  } finally {
    o.temizle();
  }
});

test('kamera: kamera servisi verilmediyse yuzey:kamera "gecersiz" döner (özellik kapalı)', async () => {
  const o = kur();
  try {
    const p = await panelAc(o);
    assert.deepEqual(await o.ipcIsleyicileri.get('yuzey:kamera')(o.yuzeyOlayi(p), 'camera.salon'), { ok: false, tur: 'gecersiz' });
  } finally {
    o.temizle();
  }
});

test('kamera: panel gizlenince, kapanınca ve yok edilince bellekteki kareler silinir', async () => {
  const kamera = sahteKamera();
  const o = kur({ kamera });
  try {
    const p = await panelAc(o);
    const once = kamera.temizlemeler.sayi;
    o.yonetici.gizle('test');
    assert.ok(kamera.temizlemeler.sayi > once, 'gizlenince temizlendi');
    const ara = kamera.temizlemeler.sayi;
    o.yonetici.kapat();
    assert.ok(kamera.temizlemeler.sayi > ara, 'kapanınca temizlendi');
    assert.ok(p);
  } finally {
    o.temizle();
  }
});

test('kamera: kameraDegisti() eski kareleri siler ve ekran görüntüsü korumasını açık pencereye hemen uygular', async () => {
  const kamera = sahteKamera();
  const o = kur({ kamera });
  try {
    const p = await panelAc(o);
    assert.equal(p.korumalar.at(-1), false, 'kamera izni yokken koruma kapalı');
    o.ayarlar.koru = true;
    const once = kamera.temizlemeler.sayi;
    o.yonetici.kameraDegisti();
    assert.equal(p.korumalar.at(-1), true, 'izin verilince koruma açılır');
    assert.ok(kamera.temizlemeler.sayi > once);
    o.ayarlar.koru = false;
    o.yonetici.kameraDegisti();
    assert.equal(p.korumalar.at(-1), false);
  } finally {
    o.temizle();
  }
});

test('kamera: her gösterimde koruma ayara göre yeniden uygulanır; setContentProtection yoksa (eski ortam) sessizce atlanır', async () => {
  const o = kur({ ayar: { koru: true } });
  try {
    const p = await panelAc(o);
    assert.equal(p.korumalar.at(-1), true);
    o.yonetici.gizle('test');
    o.ayarlar.koru = false;
    o.yonetici.panelAcKapat('tepsi');
    await akit();
    assert.equal(p.korumalar.at(-1), false);
  } finally {
    o.temizle();
  }
  const yok = kur({ ayar: { koru: true }, korumaVar: false });
  try {
    const p = await panelAc(yok);
    assert.equal(p.korumalar.length, 0);
    assert.doesNotThrow(() => yok.yonetici.kameraDegisti());
  } finally {
    yok.temizle();
  }
});

test('1.4.0 dis (o-54) bağlantı izni: soru yalnız açık panelde ve disOnayGoster ile okunur; karar bilet ile iletilir; kapanış / palete geçiş reddeder', async () => {
  const cagrilar = [];
  const SORU = { bilet: 'b-1', ad: 'Salon', islem: 'ac', bekleMs: 0 };
  const disOnay = {
    al: () => (cagrilar.push(['al']), { ...SORU }),
    yanitla: (bilet, karar) => (cagrilar.push(['yanitla', bilet, karar]), bilet === 'b-1'),
    kapandi: () => cagrilar.push(['kapandi']),
  };
  const o = kur({ disOnay });
  try {
    const al = o.ipcIsleyicileri.get('yuzey:dis-onay-al');
    const yanitla = o.ipcIsleyicileri.get('yuzey:dis-onay-yanit');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await al(yabanci)).ok, false);
    assert.equal((await yanitla(yabanci, 'b-1', 'izin')).ok, false);

    // panel olağan yoldan açıkken soru yok (disOnay.al çağrılmaz)
    const p = await panelAc(o);
    assert.deepEqual(await al(o.yuzeyOlayi(p)), { ok: true, soru: null });
    assert.deepEqual(await yanitla(o.yuzeyOlayi(p), 'b-1', 'izin'), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(cagrilar, []);

    assert.equal(o.yonetici.disOnayGoster(), true);
    assert.equal(o.yonetici.kip(), 'panel');
    assert.equal(o.mesajlar(p, 'yuzey:dis-onay').length, 1, 'yüklü sayfaya soru dürtüsü gider (yük yok)');
    assert.equal(o.mesajlar(p, 'yuzey:dis-onay')[0], undefined);
    assert.deepEqual(await al(o.yuzeyOlayi(p)), { ok: true, soru: SORU });
    assert.deepEqual(await yanitla(o.yuzeyOlayi(p), 'yanlis', 'izin'), { ok: false });
    assert.deepEqual(await yanitla(o.yuzeyOlayi(p), 'b-1', 'herZaman'), { ok: true });
    assert.deepEqual(await al(o.yuzeyOlayi(p)), { ok: true, soru: null }, 'yanıtlanan soru yeniden okunmaz');
    o.yonetici.gizle('odak');
    assert.equal(cagrilar.filter((c) => c[0] === 'kapandi').length, 0, 'yanıtlanmış soru kapanışta reddedilmez');

    // açık soru: panel kapanınca reddedilir
    assert.equal(o.yonetici.disOnayGoster(), true);
    o.yonetici.gizle('odak');
    assert.equal(cagrilar.filter((c) => c[0] === 'kapandi').length, 1);
    // açık soru: palete geçince reddedilir
    assert.equal(o.yonetici.disOnayGoster(), true);
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    assert.equal(cagrilar.filter((c) => c[0] === 'kapandi').length, 2);
    assert.deepEqual(await al(o.yuzeyOlayi(p)), { ok: true, soru: null }, 'palette soru okunmaz');
    // soru başka yoldan bitti (zaman aşımı): panel dürtülür, sonraki kapanış yeniden reddetmez
    assert.equal(o.yonetici.disOnayGoster(), true);
    const once = o.mesajlar(p, 'yuzey:dis-onay').length;
    o.yonetici.disOnayBitti();
    assert.equal(o.mesajlar(p, 'yuzey:dis-onay').length, once + 1);
    o.yonetici.gizle('odak');
    assert.equal(cagrilar.filter((c) => c[0] === 'kapandi').length, 2);
  } finally {
    o.temizle();
  }
  const onaysiz = kur();
  try {
    assert.equal(onaysiz.yonetici.disOnayGoster(), false, 'köprü verilmezse panel açılmaz (yedek iletişim kutusuna düşülür)');
    assert.equal(onaysiz.pencereler.length, 0);
  } finally {
    onaysiz.temizle();
  }
});

test('1.4.0 dis (o-54): panel sayfası henüz yüklenmemişken istenen soru, sayfa yüklenince gösterim olayıyla okunur', async () => {
  const disOnay = { al: () => ({ bilet: 'b-2', ad: 'Film', islem: 'calistir', bekleMs: 600 }), yanitla: () => true, kapandi() {} };
  const o = kur({ disOnay });
  try {
    assert.equal(o.yonetici.disOnayGoster(), true);
    await akit();
    const p = o.pencereler[0];
    assert.equal(o.yonetici.kip(), 'panel');
    assert.equal(o.mesajlar(p, 'yuzey:goster').length, 1);
    assert.equal((await o.ipcIsleyicileri.get('yuzey:dis-onay-al')(o.yuzeyOlayi(p))).soru.bilet, 'b-2');
  } finally {
    o.temizle();
  }
});

test('1.4.0 yuzey:geri-al (o-12): yalnız açık panel/paletten, yüksüz; kaynak pencere kipinden gelir ve sonuç yalnız { ok, tur } olarak döner', async () => {
  const cagrilar = [];
  const geriAl = async (kaynak) => {
    cagrilar.push(kaynak);
    return { ok: false, tur: 'kismi', adim: 3, basarisiz: 1, ad: 'sizmamali' };
  };
  const o = kur({ geriAl });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:geri-al');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci)).ok, false);
    assert.deepEqual(cagrilar, [], 'yabancı gönderici: geri alma çalışmaz');

    // pencere henüz açılmamış / gizli: kaynak yok, istek kabul edilmez
    const p = await panelAc(o);
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p)), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(cagrilar, []);

    assert.equal(o.yonetici.panelAcKapat('test'), 'acildi');
    await akit();
    // renderer yük gönderse bile yok sayılır: kaynak yalnız açık kipten gelir
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { kaynak: 'kisayol', kimlik: 'light.x' }), { ok: false, tur: 'kismi' });
    assert.deepEqual(cagrilar, ['panel']);
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    await isle(o.yuzeyOlayi(p));
    assert.deepEqual(cagrilar, ['panel', 'palet']);
  } finally {
    o.temizle();
  }
  const geriAlsiz = kur();
  try {
    const p = await panelAc(geriAlsiz);
    assert.deepEqual(await geriAlsiz.ipcIsleyicileri.get('yuzey:geri-al')(geriAlsiz.yuzeyOlayi(p)), { ok: false, tur: 'gecersiz' });
  } finally {
    geriAlsiz.temizle();
  }
});

test('yuzey:basili-basla: panel gizlenince, kapanınca ve panelden palete geçince başlamış basışlar iptal edilir (eski bir basış yeni oturumda onay sayılmaz)', async () => {
  const basla = [];
  const iptal = [];
  const eylem = { basiliBasla: (kimlik) => (basla.push(kimlik), kimlik !== 'light.favori_degil'), basiliIptal: (kimlik) => iptal.push(kimlik) };
  const o = kur({ eylem });
  try {
    const bas = o.ipcIsleyicileri.get('yuzey:basili-basla');
    const birak = o.ipcIsleyicileri.get('yuzey:basili-birak');
    const p = await panelAc(o);
    const olay = o.yuzeyOlayi(p);
    assert.deepEqual(await bas(olay, 'button.pc_bilgisayari_kapat'), { ok: true });
    assert.deepEqual(await bas(olay, 'light.favori_degil'), { ok: false });
    assert.deepEqual(basla, ['button.pc_bilgisayari_kapat', 'light.favori_degil']);
    assert.deepEqual(iptal, []);
    o.yonetici.gizle('test');
    assert.deepEqual(iptal, ['button.pc_bilgisayari_kapat'], 'gizlenince yalnız başlamış basış iptal edilir (reddedilen için iptal çağrısı yok)');

    // bırakılan basış zaten iptal edilmiştir; gizlerken ikinci kez iptal edilmez
    assert.equal(o.yonetici.panelAcKapat('test'), 'acildi');
    await akit();
    await bas(olay, 'script.iyi_geceler');
    await birak(olay, 'script.iyi_geceler');
    o.yonetici.gizle('test');
    assert.deepEqual(iptal, ['button.pc_bilgisayari_kapat', 'script.iyi_geceler']);

    // panelden palete geçiş: eski kipin basışı taşınmaz
    assert.equal(o.yonetici.panelAcKapat('test'), 'acildi');
    await akit();
    await bas(olay, 'button.pc_bilgisayari_kapat');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(iptal.slice(2), ['button.pc_bilgisayari_kapat']);
    await bas(olay, 'script.iyi_geceler');

    // yönetici kapanırken de iptal edilir
    o.yonetici.kapat();
    assert.deepEqual(iptal.slice(3), ['script.iyi_geceler']);
  } finally {
    o.temizle();
  }
});

test('1.4.0 yuzey:geciktir (o-15): yalnız açık panel/paletten; yük biçimce doğrulanır; kaynak pencere kipinden gelir; sonuç yalnız { ok, tur } döner', async () => {
  const cagrilar = [];
  const eylemEk = {
    gecikmeliPlanla: async (kaynak, yuk) => {
      cagrilar.push([kaynak, yuk]);
      return { ok: false, tur: 'dolu', id: 'g1', bitis: 5, gizli: 'sizmamali' };
    },
    gecikmeliIptal: () => true,
  };
  const o = kur({ eylemEk });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:geciktir');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, { kimlik: 'light.x', yon: 'kapat', dakika: 5 })).ok, false);
    assert.deepEqual(cagrilar, [], 'yabancı gönderici: çalışmaz');

    const p = await panelAc(o);
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { kimlik: 'light.x', yon: 'kapat', dakika: 5 }), { ok: false, tur: 'gecersiz' }, 'pencere gizliyken kabul edilmez');
    assert.equal(o.yonetici.panelAcKapat('test'), 'acildi');
    await akit();

    for (const kotu of [undefined, null, 'x', 5, [], {}, { kimlik: 'light.x' }, { kimlik: 5, yon: 'kapat', dakika: 5 }, { kimlik: 'l'.repeat(121), yon: 'kapat', dakika: 5 }, { kimlik: 'light.x', yon: 'toggle', dakika: 5 }, { kimlik: 'light.x', yon: 'kapat', dakika: '5' }, { kimlik: 'light.x', yon: 'kapat', dakika: 1.5 }]) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
    }
    assert.deepEqual(cagrilar, [], 'bozuk yük bağlayıcıya hiç ulaşmaz');

    // geçerli yük: fazladan alanlar atılır; kaynak açık kipten gelir
    assert.deepEqual(await isle(o.yuzeyOlayi(p), { kimlik: 'light.x', yon: 'kapat', dakika: 5, kaynak: 'kisayol', servis: 'unlock' }), { ok: false, tur: 'dolu' });
    assert.deepEqual(cagrilar, [['panel', { kimlik: 'light.x', yon: 'kapat', dakika: 5 }]]);
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    await isle(o.yuzeyOlayi(p), { kimlik: 'fan.x', yon: 'sureli', dakika: 30 });
    assert.deepEqual(cagrilar.at(-1), ['palet', { kimlik: 'fan.x', yon: 'sureli', dakika: 30 }]);
  } finally {
    o.temizle();
  }
  const baglayicisiz = kur();
  try {
    const p = await panelAc(baglayicisiz);
    assert.deepEqual(await baglayicisiz.ipcIsleyicileri.get('yuzey:geciktir')(baglayicisiz.yuzeyOlayi(p), { kimlik: 'light.x', yon: 'kapat', dakika: 5 }), { ok: false, tur: 'gecersiz' });
  } finally {
    baglayicisiz.temizle();
  }
});

test('1.4.0 yuzey:sayfa-sec (o-24): yalnız PALETTEN ve gönderen denetimiyle; kimlik modeldeki sayfa ya da "tumu" olmalı; panel o sayfayla bir kez açılır, servis çağrısı yapılmaz', async () => {
  const model = { gruplar: [], sonlar: [], ust: {}, sayfalar: [{ id: 'aksam', ad: 'Akşam', kimlikler: [] }, { id: 'bos01', ad: 'Boş', kimlikler: [] }] };
  const o = kur({ model });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:sayfa-sec');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, 'aksam')).ok, false);

    // pencere gizliyken ve panelden kabul edilmez
    const p = await panelAc(o);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'aksam'), { ok: false, tur: 'gecersiz' }, 'panelden gelen istek reddedilir');
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'aksam'), { ok: false, tur: 'gecersiz' }, 'pencere gizliyken reddedilir');

    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    const gosterSayisi = o.mesajlar(p, 'yuzey:goster').length;
    for (const kotu of [undefined, null, 5, [], {}, 'yok', 'AKSAM', 'a'.repeat(41), '']) {
      const yanit = await isle(o.yuzeyOlayi(p), kotu);
      assert.equal(yanit.ok, false, JSON.stringify(kotu));
    }
    assert.equal(o.mesajlar(p, 'yuzey:goster').length, gosterSayisi, 'bozuk istek paneli açmaz');

    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'aksam'), { ok: true });
    const acilis = o.mesajlar(p, 'yuzey:goster').at(-1);
    assert.equal(acilis.mod, 'panel');
    assert.equal(acilis.sayfa, 'aksam');
    // istek bir kez kullanılır: sonraki gösterim sayfa taşımaz
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.panelAcKapat('tepsi'), 'acildi');
    await akit();
    assert.equal(Object.hasOwn(o.mesajlar(p, 'yuzey:goster').at(-1), 'sayfa'), false);
    // "tumu" da geçerlidir; palet gösterimi sayfa taşımaz
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.equal(Object.hasOwn(o.mesajlar(p, 'yuzey:goster').at(-1), 'sayfa'), false);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'tumu'), { ok: true });
    assert.equal(o.mesajlar(p, 'yuzey:goster').at(-1).sayfa, 'tumu');
  } finally {
    o.temizle();
  }
});

test('1.4.0 yuzey:gecikmeli-iptal (o-15): yalnız opak kimlik (g<n>) kabul edilir; varlık kimliği ya da bozuk kimlik bağlayıcıya ulaşmaz', async () => {
  const cagrilar = [];
  const eylemEk = {
    gecikmeliPlanla: async () => ({ ok: true }),
    gecikmeliIptal: (id, kaynak) => {
      cagrilar.push([id, kaynak]);
      return id === 'g1';
    },
  };
  const o = kur({ eylemEk });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:gecikmeli-iptal');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, 'g1')).ok, false);
    const p = await panelAc(o);
    o.yonetici.gizle('test');
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'g1'), { ok: false, tur: 'gecersiz' });
    assert.equal(o.yonetici.panelAcKapat('test'), 'acildi');
    await akit();
    for (const kotu of [undefined, null, 5, {}, 'light.salon', 'g', 'g1x', 'x1', 'G1', 'g1234567890', '']) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
    }
    assert.deepEqual(cagrilar, []);
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'g1'), { ok: true });
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'g2'), { ok: false });
    assert.deepEqual(cagrilar, [['g1', 'panel'], ['g2', 'panel']]);
  } finally {
    o.temizle();
  }
});

test('1.4.0 yuzey:oda-kapat (o-14): yalnız açık PANELDEN; yük yalnız grup kodu (oda-<8 onaltılık>); palet, yabancı gönderici ve bozuk kod bağlayıcıya ulaşmaz; yanıt süzülür', async () => {
  const cagrilar = [];
  const eylemEk = {
    gecikmeliPlanla: async () => ({ ok: true }),
    gecikmeliIptal: () => true,
    odaKapat: async (kaynak, kod) => {
      cagrilar.push([kaynak, kod]);
      return { ok: true, adet: 3, toplam: 3, gizli: 'sizmamali', tur: 'x' };
    },
  };
  const o = kur({ eylemEk });
  try {
    const isle = o.ipcIsleyicileri.get('yuzey:oda-kapat');
    assert.equal(typeof isle, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await isle(yabanci, 'oda-0123abcd')).ok, false);
    assert.deepEqual(cagrilar, [], 'yabancı gönderici: çalışmaz');

    const p = await panelAc(o);
    for (const kotu of [undefined, null, 5, {}, [], 'light.salon', 'oda-0123ABCD', 'oda-0123abc', 'oda-0123abcde', 'oda-', '', 'Oda-0123abcd']) {
      assert.deepEqual(await isle(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
    }
    assert.deepEqual(cagrilar, [], 'bozuk yük bağlayıcıya hiç ulaşmaz');

    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'oda-0123abcd'), { ok: true, tur: 'x', adet: 3 }, 'yanıt beyaz listeden geçer');
    assert.deepEqual(cagrilar, [['panel', 'oda-0123abcd']]);

    // palet penceresinden gelen istek reddedilir (yalnız panel)
    o.yonetici.gizle('test');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(await isle(o.yuzeyOlayi(p), 'oda-0123abcd'), { ok: false, tur: 'gecersiz' });
    assert.equal(cagrilar.length, 1);
  } finally {
    o.temizle();
  }
  const baglayicisiz = kur();
  try {
    const p = await panelAc(baglayicisiz);
    assert.deepEqual(await baglayicisiz.ipcIsleyicileri.get('yuzey:oda-kapat')(baglayicisiz.yuzeyOlayi(p), 'oda-0123abcd'), { ok: false, tur: 'gecersiz' });
  } finally {
    baglayicisiz.temizle();
  }
});

test('1.4.0 yuzey:diger-* (o-46): yalnız açık PALETTEN; panel, yabancı gönderici ve bozuk yük bağlayıcıya ulaşmaz; liste ve yanıtlar beyaz listeden geçer', async () => {
  const cagrilar = [];
  const eylemEk = {
    gecikmeliPlanla: async () => ({ ok: true }),
    gecikmeliIptal: () => true,
    digerListe: async (kaynak) => {
      cagrilar.push(['liste', kaynak]);
      return {
        ok: true,
        liste: [
          { kimlik: 'light.mutfak', ad: 'Mutfak lambası', alan: 'light', durum: 'acik', oda: 'Mutfak', gizli: 'sizmamali' },
          { kimlik: 'lock.on_kapi', ad: 'Ön kapı', alan: 'lock', durum: 'acik' }, // alan beyaz listede değil
          { kimlik: 'light.x', ad: 'X', alan: 'light', durum: 'garip' }, // durum beyaz listede değil
          { kimlik: 5, ad: 'Y', alan: 'light', durum: 'acik' },
          null,
          { kimlik: 'scene.sinema', ad: 'Sinema', alan: 'scene', durum: 'notr' },
        ],
      };
    },
    digerCalistir: async (kaynak, yuk) => {
      cagrilar.push(['calistir', kaynak, yuk]);
      return { ok: false, tur: 'cok-sik', gizli: 'sizmamali' };
    },
    digerFavoriEkle: async (kaynak, kimlik) => {
      cagrilar.push(['favori', kaynak, kimlik]);
      return { ok: true, gizli: 'sizmamali' };
    },
  };
  const o = kur({ eylemEk });
  try {
    const liste = o.ipcIsleyicileri.get('yuzey:diger-cihazlar');
    const calistir = o.ipcIsleyicileri.get('yuzey:diger-calistir');
    const favori = o.ipcIsleyicileri.get('yuzey:diger-favori-ekle');
    assert.equal(typeof liste, 'function');
    assert.equal(typeof calistir, 'function');
    assert.equal(typeof favori, 'function');
    const yabanci = { sender: {}, senderFrame: { parent: null, url: 'https://kotu.example/' } };
    assert.equal((await liste(yabanci)).ok, false);
    assert.equal((await calistir(yabanci, { kimlik: 'light.mutfak', islem: 'ac' })).ok, false);
    assert.equal((await favori(yabanci, 'light.mutfak')).ok, false);
    assert.deepEqual(cagrilar, [], 'yabancı gönderici: hiçbiri çalışmaz');

    // PANELDE yok: yalnız palet kipi
    const p = await panelAc(o);
    assert.deepEqual(await liste(o.yuzeyOlayi(p)), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(await calistir(o.yuzeyOlayi(p), { kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(await favori(o.yuzeyOlayi(p), 'light.mutfak'), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(cagrilar, [], 'panel kipi: bağlayıcıya ulaşmaz');

    o.yonetici.gizle('test');
    assert.deepEqual(await liste(o.yuzeyOlayi(p)), { ok: false, tur: 'gecersiz' }, 'pencere gizliyken kaynak yok');
    assert.equal(o.yonetici.paletAcKapat(), 'acildi');
    await akit();

    assert.deepEqual(await liste(o.yuzeyOlayi(p)), {
      ok: true,
      liste: [
        { kimlik: 'light.mutfak', ad: 'Mutfak lambası', alan: 'light', durum: 'acik', oda: 'Mutfak' },
        { kimlik: 'scene.sinema', ad: 'Sinema', alan: 'scene', durum: 'notr' },
      ],
    });
    assert.deepEqual(cagrilar, [['liste', 'palet']]);

    for (const kotu of [undefined, null, 5, 'light.mutfak', [], {}, { kimlik: 'light.mutfak' }, { islem: 'ac' }, { kimlik: 5, islem: 'ac' }, { kimlik: 'a'.repeat(121), islem: 'ac' }, { kimlik: 'light.mutfak', islem: 'turn_on' }, { kimlik: 'light.mutfak', islem: 'toggle' }, { kimlik: 'light.mutfak', islem: '__proto__' }, { kimlik: 'light.mutfak', islem: ['ac'] }]) {
      assert.deepEqual(await calistir(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
    }
    for (const kotu of [undefined, null, 5, {}, [], 'a'.repeat(121)]) assert.deepEqual(await favori(o.yuzeyOlayi(p), kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
    assert.equal(cagrilar.length, 1, 'bozuk yük bağlayıcıya hiç ulaşmaz');

    // geçerli yük: yalnız { kimlik, islem } gider (fazladan alan ve kaynak beyanı atılır); yanıt süzülür
    assert.deepEqual(await calistir(o.yuzeyOlayi(p), { kimlik: 'light.mutfak', islem: 'degistir', kaynak: 'panel', servis: 'unlock', veri: { x: 1 } }), { ok: false, tur: 'cok-sik' });
    assert.deepEqual(cagrilar.at(-1), ['calistir', 'palet', { kimlik: 'light.mutfak', islem: 'degistir' }]);
    assert.deepEqual(await favori(o.yuzeyOlayi(p), 'light.mutfak'), { ok: true });
    assert.deepEqual(cagrilar.at(-1), ['favori', 'palet', 'light.mutfak']);
  } finally {
    o.temizle();
  }

  // liste hata/kapalı yanıtı kısa kodla geçer; bağlayıcı yoksa "gecersiz"
  const hatali = kur({ eylemEk: { gecikmeliPlanla: async () => ({ ok: true }), gecikmeliIptal: () => true, digerListe: async () => ({ ok: false, tur: 'kapali', ayrinti: 'x' }) } });
  try {
    const p = await panelAc(hatali);
    hatali.yonetici.gizle('test');
    assert.equal(hatali.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(await hatali.ipcIsleyicileri.get('yuzey:diger-cihazlar')(hatali.yuzeyOlayi(p)), { ok: false, tur: 'kapali' });
  } finally {
    hatali.temizle();
  }
  const baglayicisiz = kur();
  try {
    const p = await panelAc(baglayicisiz);
    baglayicisiz.yonetici.gizle('test');
    assert.equal(baglayicisiz.yonetici.paletAcKapat(), 'acildi');
    await akit();
    assert.deepEqual(await baglayicisiz.ipcIsleyicileri.get('yuzey:diger-cihazlar')(baglayicisiz.yuzeyOlayi(p)), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(await baglayicisiz.ipcIsleyicileri.get('yuzey:diger-calistir')(baglayicisiz.yuzeyOlayi(p), { kimlik: 'light.x', islem: 'ac' }), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(await baglayicisiz.ipcIsleyicileri.get('yuzey:diger-favori-ekle')(baglayicisiz.yuzeyOlayi(p), 'light.x'), { ok: false, tur: 'gecersiz' });
  } finally {
    baglayicisiz.temizle();
  }
});
