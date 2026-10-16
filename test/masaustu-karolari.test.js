'use strict';

/**
 * Masaüstü karo pencereleri yöneticisi (src/masaustu-karolari.js; o-33): sahte Electron ile, hiçbir pencere açılmadan.
 * Gerçek karo seçimi (src/lib/masaustu-karo.js) kullanılır; böylece Kapı Kuralı ve yıkıcı eylem dışlaması uçtan uca denenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { sabitlenecekKarolar, masaustuKaroModeli } = require('../src/lib/masaustu-karo');
const { ekranlariOzetle } = require('../src/lib/pencere-yerlesim');
const { anaCevirmen } = require('../src/lib/ceviri-varsayilan');

const KOK = path.join(__dirname, '..', 'src');
const KARO_HTML = path.join(KOK, 'masaustu-karo.html');
const EKRAN_BIRINCI = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const EKRAN_SOL = { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, workArea: { x: -1280, y: 0, width: 1280, height: 984 } };

function onbellegiTemizle() {
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(KOK + path.sep)) delete require.cache[anahtar];
  }
}

const akit = () => new Promise((coz) => setImmediate(coz));
const varlik = (kimlik, durum, nitelik = {}) => ({ entity_id: kimlik, state: durum, attributes: nitelik });
const favori = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: kimlik.split('.')[1], ...ek });

/**
 * @param {object} [s]
 * @param {string[]} [s.secili] ayar masaustuKarolari
 * @param {object[]} [s.favoriler]
 * @param {object[]} [s.varliklar] depodaki durumlar
 */
function kur({ secili = ['light.salon', 'switch.priz'], favoriler = null, varliklar = null, konumlar = {}, ust = false, ekranlar = [EKRAN_BIRINCI], malzeme = null, yuklemeReddi = false, kurucuHatasi = false, dil = 'tr' } = {}) {
  const o = {
    secili: [...secili],
    favoriler: favoriler ?? [favori('light.salon', { parlaklik: true }), favori('switch.priz'), favori('sensor.sicaklik'), favori('light.mutfak')],
    varliklar: new Map((varliklar ?? [varlik('light.salon', 'on', { brightness: 120 }), varlik('switch.priz', 'off'), varlik('sensor.sicaklik', '21.5', { unit_of_measurement: '°C' }), varlik('light.mutfak', 'on')]).map((v) => [v.entity_id, v])),
    konumlar,
    ust,
    ekranlar,
    malzeme,
    yuklemeReddi,
    kurucuHatasi,
    pencereler: [],
    ipc: new Map(),
    kaydedilenKonumlar: [],
    kaldirilanlar: [],
    eylemCagrilari: [],
    gunlukler: [],
    zamanlayicilar: new Map(),
    sonZamanlayici: 0,
    baglanti: { canli: true, baglanti: 'ev' },
    eylemYaniti: { ok: true },
  };
  class SahteWebContents extends EventEmitter {
    constructor() {
      super();
      this.mesajlar = [];
    }

    setWindowOpenHandler(fn) {
      this.pencereAcmaIsleyicisi = fn;
    }

    send(kanal, yuk) {
      this.mesajlar.push({ kanal, yuk });
    }
  }
  class SahtePencere extends EventEmitter {
    constructor(secenekler) {
      super();
      if (o.kurucuHatasi) throw new Error('pencere açılamadı');
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
      this.yikik = false;
      this.cagri = { show: 0, showInactive: 0, focus: 0 };
      this.sinirlar = { x: secenekler.x, y: secenekler.y, width: secenekler.width, height: secenekler.height };
      this.setBoundsCagrilari = [];
      this.ustCagrilari = [];
      this.basliklar = [];
      this.renkler = [];
      this.malzemeler = [];
      o.pencereler.push(this);
    }

    loadFile(dosya) {
      this.yuklenenDosya = dosya;
      if (o.yuklemeReddi) return Promise.reject(new Error('yüklenemedi'));
      queueMicrotask(() => this.webContents.emit('did-finish-load'));
      return Promise.resolve();
    }

    isDestroyed() {
      return this.yikik;
    }

    destroy() {
      if (this.yikik) return;
      this.yikik = true;
      this.emit('closed');
    }

    show() {
      this.cagri.show += 1;
    }

    showInactive() {
      this.cagri.showInactive += 1;
    }

    focus() {
      this.cagri.focus += 1;
    }

    getBounds() {
      return { ...this.sinirlar };
    }

    setBounds(sinir) {
      this.sinirlar = { ...sinir };
      this.setBoundsCagrilari.push({ ...sinir });
    }

    setAlwaysOnTop(deger) {
      this.ustCagrilari.push(deger);
    }

    setTitle(baslik) {
      this.basliklar.push(baslik);
    }

    setBackgroundColor(renk) {
      this.renkler.push(renk);
    }

    setBackgroundMaterial(m) {
      this.malzemeler.push(m);
    }
  }
  const sahteElectron = {
    app: { isPackaged: true },
    BrowserWindow: SahtePencere,
    ipcMain: {
      handle: (kanal, fn) => o.ipc.set(kanal, fn),
      on: (kanal, fn) => o.ipc.set(kanal, fn),
    },
  };
  const orijinalYukle = Module._load;
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahteElectron : orijinalYukle.call(this, istek, ...gerisi);
  };
  onbellegiTemizle();
  let modul;
  try {
    modul = require(path.join(KOK, 'masaustu-karolari.js'));
  } finally {
    Module._load = orijinalYukle;
  }
  const t = anaCevirmen(dil);
  const karolariAl = () => sabitlenecekKarolar({ secili: o.secili, favoriler: o.favoriler, durumAl: (k) => o.varliklar.get(k), t });
  o.modul = modul;
  o.yonetici = modul.masaustuKarolariOlustur({
    karolariAl: () => {
      if (o.karolariAlHatasi) throw new Error('boom');
      return karolariAl();
    },
    modelAl: (kimlik) => {
      if (o.modelAlHatasi) throw new Error('boom');
      const karo = karolariAl().find((k) => k.kimlik === kimlik);
      return karo ? masaustuKaroModeli(karo.karo, o.baglanti) : null;
    },
    eylem: {
      masaustundenCalistir: async (yuk) => {
        o.eylemCagrilari.push(yuk);
        return o.eylemYaniti;
      },
    },
    konumlariAl: () => o.konumlar,
    konumKaydet: (kayitlar) => {
      o.kaydedilenKonumlar.push(kayitlar);
      o.konumlar = kayitlar;
    },
    ustteAl: () => o.ust,
    ekranlarAl: () => ekranlariOzetle(o.ekranlar, 1),
    kaldir: (kimlik) => {
      o.kaldirilanlar.push(kimlik);
      o.secili = o.secili.filter((k) => k !== kimlik);
    },
    malzemeAl: o.malzeme ? () => o.malzeme : undefined,
    t,
    dilAl: () => dil,
    gunluk: (m) => o.gunlukler.push(m),
    zaman: {
      setTimeout: (fn, ms) => {
        const kimlik = ++o.sonZamanlayici;
        o.zamanlayicilar.set(kimlik, { fn, ms });
        return kimlik;
      },
      clearTimeout: (kimlik) => {
        o.zamanlayicilar.delete(kimlik);
      },
    },
  });
  o.yonetici.ipcKaydet();
  /** Sayfa yüklendi mi (queueMicrotask) diye bekler. */
  o.yukle = akit;
  o.olay = (pencere, ek = {}) => ({ sender: pencere.webContents, senderFrame: { parent: null, url: pathToFileURL(KARO_HTML).href }, ...ek });
  o.cagir = (kanal, olay, ...bagimsiz) => o.ipc.get(kanal)(olay, ...bagimsiz);
  o.sonMesaj = (pencere, kanal) => pencere.webContents.mesajlar.filter((m) => m.kanal === kanal).at(-1)?.yuk;
  o.zamanlayiciTetikle = () => {
    const [kimlik, z] = [...o.zamanlayicilar.entries()][0];
    o.zamanlayicilar.delete(kimlik);
    z.fn();
  };
  return o;
}

/** Açılış: esitle + sayfaların yüklenmesi. Pencereler açılma sırasıyla döner. */
async function ac(o) {
  o.yonetici.esitle();
  await o.yukle();
  return o.pencereler;
}

// --- Açma / kapama -----------------------------------------------------------------------------------------------------------------

test('esitle: seçili favori karoları için, sırayla birer küçük çerçevesiz pencere açar; güvenli web tercihleri ve karo sayfası', async () => {
  const o = kur();
  const [a, b] = await ac(o);
  assert.equal(o.pencereler.length, 2);
  assert.deepEqual(o.yonetici.acikKimlikler(), ['light.salon', 'switch.priz']);
  for (const p of [a, b]) {
    assert.equal(p.yuklenenDosya, KARO_HTML);
    assert.equal(p.secenekler.frame, false);
    assert.equal(p.secenekler.skipTaskbar, true);
    assert.equal(p.secenekler.show, false);
    assert.equal(p.secenekler.minimizable, false);
    assert.equal(p.secenekler.maximizable, false);
    assert.equal(p.secenekler.fullscreenable, false);
    assert.equal(p.secenekler.resizable, true);
    assert.equal(p.secenekler.alwaysOnTop, false, 'varsayılan: masaüstünde, diğer pencerelerin üstünde değil');
    assert.equal(p.secenekler.transparent, undefined);
    assert.equal(p.secenekler.webPreferences.contextIsolation, true);
    assert.equal(p.secenekler.webPreferences.sandbox, true);
    assert.equal(p.secenekler.webPreferences.nodeIntegration, false);
    assert.equal(p.secenekler.webPreferences.preload, o.modul.PRELOAD_KARO);
    assert.match(path.basename(o.modul.PRELOAD_KARO), /^preload-karo\.js$/);
    assert.equal(p.secenekler.title, 'Ev Paneli — Masaüstü Karosu');
    assert.deepEqual([p.secenekler.minWidth, p.secenekler.minHeight, p.secenekler.maxWidth, p.secenekler.maxHeight], [120, 88, 360, 260]);
    assert.deepEqual(p.webContents.pencereAcmaIsleyicisi(), { action: 'deny' });
  }
  assert.deepEqual([a.secenekler.x, a.secenekler.y, a.secenekler.width, a.secenekler.height], [1728, 16, 176, 112], 'ilk karo birincil ekranın sağ üstünde');
  assert.equal(b.secenekler.x, 1728);
  assert.equal(b.secenekler.y, 16 + 112 + 12, 'ikincisi altına dizilir');
});

test('sayfa yüklenince karo ODAK ÇALMADAN (showInactive) gösterilir ve model gönderilir; yüklenmeden model gönderilmez', async () => {
  const o = kur({ secili: ['light.salon'] });
  o.yonetici.esitle();
  const p = o.pencereler[0];
  assert.deepEqual(p.cagri, { show: 0, showInactive: 0, focus: 0 }, 'yüklenmeden gösterilmez');
  assert.equal(o.sonMesaj(p, 'karo:durum'), undefined);
  await o.yukle();
  assert.deepEqual(p.cagri, { show: 0, showInactive: 1, focus: 0 });
  const mesaj = o.sonMesaj(p, 'karo:durum');
  assert.equal(mesaj.malzeme, 'yok');
  assert.equal(mesaj.model.id, 'light.salon');
  assert.equal(mesaj.model.tiklanabilir, true);
  assert.deepEqual(mesaj.model.parlaklikOnAyarlari, [25, 50, 100]);
});

test('değişmeyen model yeniden gönderilmez; değişen gönderilir', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  o.yonetici.modelDegisti();
  o.yonetici.modelDegisti();
  assert.equal(p.webContents.mesajlar.filter((m) => m.kanal === 'karo:durum').length, 1);
  o.varliklar.set('light.salon', varlik('light.salon', 'off'));
  o.yonetici.modelDegisti();
  const mesajlar = p.webContents.mesajlar.filter((m) => m.kanal === 'karo:durum');
  assert.equal(mesajlar.length, 2);
  assert.equal(mesajlar[1].yuk.model.durum, 'kapali');
  o.baglanti = { canli: false, baglanti: 'kapali' };
  o.yonetici.modelDegisti();
  assert.equal(p.webContents.mesajlar.filter((m) => m.kanal === 'karo:durum').length, 3, 'bağlantı durumu da modelin parçası');
});

test('seçimden çıkan karo kapatılır (sabitleme kaldırma geri çağrısı ÇAĞRILMAZ); seçilince yeniden açılır', async () => {
  const o = kur();
  await ac(o);
  o.secili = ['switch.priz'];
  o.yonetici.esitle();
  assert.deepEqual(o.yonetici.acikKimlikler(), ['switch.priz']);
  assert.equal(o.pencereler[0].yikik, true);
  assert.deepEqual(o.kaldirilanlar, [], 'biz kapattık, kullanıcı değil');
  o.secili = ['switch.priz', 'light.salon'];
  o.yonetici.esitle();
  await o.yukle();
  assert.equal(o.pencereler.length, 3);
  assert.deepEqual(o.yonetici.acikKimlikler(), ['switch.priz', 'light.salon']);
});

test('kullanıcı pencereyi kapatırsa (Alt+F4) sabitleme kaldırılır ve karo kendiliğinden geri gelmez', async () => {
  const o = kur();
  const [a] = await ac(o);
  a.destroy();
  assert.deepEqual(o.kaldirilanlar, ['light.salon']);
  o.yonetici.esitle();
  await o.yukle();
  assert.deepEqual(o.yonetici.acikKimlikler(), ['switch.priz']);
  assert.equal(o.pencereler.length, 2, 'yeni pencere açılmadı');
});

test('KAPI KURALI (uçtan uca): HA\'daki ad sonradan kapıya dönerse karo bir sonraki durum değişiminde kapanır; kapı alanları hiç açılmaz', async () => {
  const o = kur({
    secili: ['light.salon', 'lock.on_kapi', 'cover.garaj', 'switch.kapi_rolesi', 'alarm_control_panel.ev', 'binary_sensor.pencere'],
    favoriler: [favori('light.salon'), favori('lock.on_kapi'), favori('cover.garaj'), favori('switch.kapi_rolesi'), favori('alarm_control_panel.ev'), favori('binary_sensor.pencere')],
    varliklar: [varlik('light.salon', 'on'), varlik('lock.on_kapi', 'locked'), varlik('cover.garaj', 'closed'), varlik('switch.kapi_rolesi', 'on'), varlik('alarm_control_panel.ev', 'disarmed'), varlik('binary_sensor.pencere', 'on', { device_class: 'window' })],
  });
  await ac(o);
  assert.deepEqual(o.yonetici.acikKimlikler(), ['light.salon'], 'yalnız zararsız ışık açıldı');
  o.varliklar.set('light.salon', varlik('light.salon', 'on', { friendly_name: 'Garaj kapısı ışığı' }));
  o.yonetici.modelDegisti();
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
  assert.equal(o.pencereler[0].yikik, true);
});

test('YIKICI: onay isteyen favori masaüstüne sabitlenmez; favori olmaktan çıkan karo kapanır', async () => {
  const o = kur({ secili: ['switch.priz', 'light.salon'], favoriler: [favori('switch.priz', { onay: true }), favori('light.salon')] });
  await ac(o);
  assert.deepEqual(o.yonetici.acikKimlikler(), ['light.salon']);
  o.favoriler = [];
  o.yonetici.esitle();
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
});

test('kapat: tüm pencereler yok edilir, kullanıcı kapatması sayılmaz (kaldır çağrılmaz); sonraki esitle bir şey açmaz', async () => {
  const o = kur();
  await ac(o);
  o.yonetici.kapat();
  assert.ok(o.pencereler.every((p) => p.yikik));
  assert.deepEqual(o.kaldirilanlar, []);
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
  o.yonetici.esitle();
  assert.equal(o.pencereler.length, 2);
});

test('hazirla: açılıştan 2 saniye sonra esitle çalışır; kapat bekleyen açılışı iptal eder', async () => {
  const o = kur();
  o.yonetici.hazirla();
  assert.equal(o.pencereler.length, 0);
  assert.equal([...o.zamanlayicilar.values()][0].ms, 2000);
  o.zamanlayiciTetikle();
  assert.equal(o.pencereler.length, 2);
  const p = kur();
  p.yonetici.hazirla(50);
  assert.equal([...p.zamanlayicilar.values()][0].ms, 50);
  p.yonetici.kapat();
  assert.equal(p.zamanlayicilar.size, 0);
});

test('karoları belirleyen ya da modeli üreten işlev hata fırlatırsa uygulama düşmez, günlüğe yazılır', async () => {
  const o = kur();
  o.karolariAlHatasi = true;
  assert.doesNotThrow(() => o.yonetici.esitle());
  assert.equal(o.pencereler.length, 0);
  assert.ok(o.gunlukler.length > 0);
  o.karolariAlHatasi = false;
  o.yonetici.esitle();
  await o.yukle();
  o.modelAlHatasi = true;
  o.varliklar.set('light.salon', varlik('light.salon', 'off'));
  assert.doesNotThrow(() => o.yonetici.modelDegisti());
});

test('pencere oluşturulamazsa (kurucu hata) günlüğe yazılır, karo kayıtta kalmaz, uygulama düşmez', () => {
  const o = kur({ kurucuHatasi: true });
  assert.doesNotThrow(() => o.yonetici.esitle());
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
  assert.ok(o.gunlukler.some((m) => /oluşturulamadı/.test(m)));
});

// --- Konum -------------------------------------------------------------------------------------------------------------------------

test('kayıtlı konum varsa pencere orada açılır (ekranda görünüyorsa); kayıtlı olmayanlar varsayılan yığında', async () => {
  const sinir = { x: 400, y: 300, width: 200, height: 140 };
  const o = kur({ konumlar: { 'switch.priz': sinir } });
  const [a, b] = await ac(o);
  assert.deepEqual([a.secenekler.x, a.secenekler.y], [1728, 16], 'sıra 0');
  assert.deepEqual({ x: b.secenekler.x, y: b.secenekler.y, width: b.secenekler.width, height: b.secenekler.height }, sinir);
});

test('taşıma/boyutlandırma: gecikmeli ve tek seferde kaydedilir; açılış sırasındaki olaylar sayılmaz; aynı konum yazılmaz', async () => {
  const o = kur({ secili: ['light.salon'] });
  o.yonetici.esitle();
  const p = o.pencereler[0];
  p.emit('move'); // yerleştirme sırasında (henüz gösterilmedi)
  assert.equal(o.zamanlayicilar.size, 0);
  await o.yukle();
  p.sinirlar = { x: 100, y: 120, width: 200, height: 130 };
  p.emit('move');
  p.emit('resize');
  p.emit('move');
  assert.equal(o.zamanlayicilar.size, 1, 'sürüklerken tek zamanlayıcı');
  assert.equal([...o.zamanlayicilar.values()][0].ms, 600);
  assert.deepEqual(o.kaydedilenKonumlar, []);
  o.zamanlayiciTetikle();
  assert.deepEqual(o.kaydedilenKonumlar, [{ 'light.salon': { x: 100, y: 120, width: 200, height: 130 } }]);
  p.emit('move');
  o.zamanlayiciTetikle();
  assert.equal(o.kaydedilenKonumlar.length, 1, 'aynı konum yeniden yazılmaz');
});

test('kapat: bekleyen konum kaybolmaz (uygulama kapanırken yazılır)', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  p.sinirlar = { x: 50, y: 60, width: 180, height: 120 };
  p.emit('move');
  o.yonetici.kapat();
  assert.deepEqual(o.kaydedilenKonumlar, [{ 'light.salon': { x: 50, y: 60, width: 180, height: 120 } }]);
});

test('ekranDegisti: ekranı sökülen karo görünür alana alınır; kayıtlı konum SİLİNMEZ, bu yerleştirme kaydedilmez ve ekran dönünce karo kayıtlı konumuna döner', async () => {
  const kayit = { x: -1000, y: 100, width: 176, height: 112 };
  const o = kur({ secili: ['light.salon'], konumlar: { 'light.salon': kayit }, ekranlar: [EKRAN_BIRINCI, EKRAN_SOL] });
  const [p] = await ac(o);
  assert.deepEqual({ x: p.secenekler.x, y: p.secenekler.y }, { x: -1000, y: 100 }, 'sol monitörde açıldı');
  o.ekranlar = [EKRAN_BIRINCI]; // sol monitör söküldü
  o.yonetici.ekranDegisti();
  assert.deepEqual(p.setBoundsCagrilari.at(-1), { x: 1728, y: 16, width: 176, height: 112 }, 'varsayılan yığına alındı');
  p.emit('move'); // gerçek pencere setBounds sonrası 'move' yayar
  o.zamanlayiciTetikle();
  assert.deepEqual(o.kaydedilenKonumlar, [], 'program yerleştirmesi kullanıcı seçimi olarak kaydedilmez');
  assert.deepEqual(o.konumlar['light.salon'], kayit, 'kayıtlı konum durur');
  o.ekranlar = [EKRAN_BIRINCI, EKRAN_SOL]; // sol monitör geri takıldı
  o.yonetici.ekranDegisti();
  assert.deepEqual(p.setBoundsCagrilari.at(-1), kayit, 'kayıtlı konuma dönüldü');
  p.emit('move');
  o.zamanlayiciTetikle();
  assert.deepEqual(o.kaydedilenKonumlar, []);
});

test('ekranDegisti: kullanıcının taşıdığı karo hâlâ görünüyorsa kayıtlı konuma geri SIÇRAMAZ; görünmüyorsa kayıtlıya/varsayılana alınır', async () => {
  const o = kur({ secili: ['light.salon'], konumlar: { 'light.salon': { x: -1000, y: 100, width: 176, height: 112 } }, ekranlar: [EKRAN_BIRINCI, EKRAN_SOL] });
  const [p] = await ac(o);
  p.sinirlar = { x: 300, y: 200, width: 176, height: 112 }; // kullanıcı birincil ekrana sürükledi
  p.emit('move');
  o.zamanlayiciTetikle();
  assert.deepEqual(o.kaydedilenKonumlar.at(-1), { 'light.salon': { x: 300, y: 200, width: 176, height: 112 } });
  o.yonetici.ekranDegisti();
  assert.deepEqual(p.setBoundsCagrilari, [], 'kullanıcı konumu korunur');
  p.sinirlar = { x: -900, y: 300, width: 176, height: 112 }; // sol monitöre sürükledi ve kaydetti
  p.emit('move');
  o.zamanlayiciTetikle();
  o.ekranlar = [EKRAN_BIRINCI];
  o.yonetici.ekranDegisti();
  assert.equal(p.setBoundsCagrilari.length, 1);
  assert.equal(p.sinirlar.x >= 0, true, 'sökülen ekrandan görünür alana taşındı');
  assert.deepEqual(o.konumlar['light.salon'], { x: -900, y: 300, width: 176, height: 112 }, 'kayıt (kullanıcının seçimi) silinmedi');
});

test('kayıt yokken varsayılan yığındaki karo hareket olayı alsa da konum kaydedilmez; kullanıcı sürükleyince kaydedilir', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  p.emit('move');
  p.emit('resize');
  o.zamanlayiciTetikle();
  assert.deepEqual(o.kaydedilenKonumlar, []);
  p.sinirlar = { ...p.sinirlar, x: p.sinirlar.x - 300 };
  p.emit('move');
  o.zamanlayiciTetikle();
  assert.equal(o.kaydedilenKonumlar.length, 1);
  p.sinirlar = { ...p.sinirlar, x: 1728 }; // kullanıcı varsayılan yere geri taşıdı: yine kullanıcı seçimi
  p.emit('move');
  o.zamanlayiciTetikle();
  assert.equal(o.kaydedilenKonumlar.length, 2);
});

test('ekranDegisti: hâlâ görünen karoya dokunulmaz; çalışma alanı küçüldüyse sığdırılır; ekran listesi okunamazsa hiçbir şey yapılmaz', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  o.yonetici.ekranDegisti();
  assert.deepEqual(p.setBoundsCagrilari, []);
  o.ekranlar = [{ ...EKRAN_BIRINCI, workArea: { x: 0, y: 0, width: 1600, height: 900 } }];
  o.yonetici.ekranDegisti();
  assert.equal(p.setBoundsCagrilari.length, 1);
  assert.ok(p.sinirlar.x + p.sinirlar.width <= 1600 && p.sinirlar.y + p.sinirlar.height <= 900, 'çalışma alanına sığdırıldı');
  const once = p.setBoundsCagrilari.length;
  o.ekranlar = [];
  o.yonetici.ekranDegisti();
  assert.equal(p.setBoundsCagrilari.length, once, 'boş ekran listesi (okuma hatası) karoları 1280x720 yedeğine atmaz');
});

// --- Üstte tutma, malzeme, dil -----------------------------------------------------------------------------------------------------

test('masaustuKaroUstte: açılışta alwaysOnTop seçeneği; ayar değişince açık karolara uygulanır', async () => {
  const o = kur({ ust: true });
  await ac(o);
  assert.ok(o.pencereler.every((p) => p.secenekler.alwaysOnTop === true));
  o.ust = false;
  o.yonetici.ustteDegisti();
  assert.ok(o.pencereler.every((p) => p.ustCagrilari.at(-1) === false));
  o.ust = true;
  o.yonetici.ustteDegisti();
  assert.ok(o.pencereler.every((p) => p.ustCagrilari.at(-1) === true));
});

test('malzeme: pencere seçeneklerine karışır; değişince arka plan uygulanır ve sayfaya yeni malzeme gider', async () => {
  const o = kur({ secili: ['light.salon'], malzeme: { malzeme: 'mica', secenekler: { backgroundMaterial: 'mica', backgroundColor: '#112233' } } });
  const [p] = await ac(o);
  assert.equal(p.secenekler.backgroundMaterial, 'mica');
  assert.equal(p.secenekler.backgroundColor, '#112233');
  assert.equal(o.sonMesaj(p, 'karo:durum').malzeme, 'mica');
  o.malzeme = { malzeme: 'yok', secenekler: { backgroundColor: '#2a3040' } };
  o.yonetici.malzemeyiUygula();
  assert.equal(p.renkler.at(-1), '#2a3040');
  assert.equal(o.sonMesaj(p, 'karo:durum').malzeme, 'yok');
});

test('dilDegisti: pencere başlığı yeni dilde, sayfaya dil:degisti gider', async () => {
  const o = kur({ secili: ['light.salon'], dil: 'en' });
  const [p] = await ac(o);
  assert.equal(p.secenekler.title, 'Home Panel — Desktop Tile');
  o.yonetici.dilDegisti();
  assert.equal(p.basliklar.at(-1), 'Home Panel — Desktop Tile');
  assert.deepEqual(o.sonMesaj(p, 'dil:degisti'), { dil: 'en' });
});

// --- Çökme sınırı -----------------------------------------------------------------------------------------------------------------

test('sayfa süreci çökerse pencere yok edilir ve bir sonraki esitle\'de yeniden açılır; aynı karo oturumda 3 kez çökerse bir daha açılmaz', async () => {
  const o = kur({ secili: ['light.salon'] });
  await ac(o);
  for (let i = 1; i <= 3; i++) {
    const p = o.pencereler.at(-1);
    p.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(p.yikik, true, `çökme ${i}`);
    assert.deepEqual(o.kaldirilanlar, [], 'çökme kullanıcı kapatması değildir: sabitleme kalır');
    o.yonetici.esitle();
    await o.yukle();
  }
  assert.equal(o.pencereler.length, 3, '3. çökmeden sonra açılmadı');
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
  o.yonetici.esitle();
  assert.equal(o.pencereler.length, 3, 'döngü yok');
  assert.ok(o.gunlukler.some((m) => /sıfırlandı \(sayfa-sureci-kapandi:crashed\)/.test(m)));
});

test('clean-exit çökme sayılmaz; ana çerçeve dışı ve ERR_ABORTED yükleme hataları yok sayılır; ana çerçeve hatası sıfırlar', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  p.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  p.webContents.emit('did-fail-load', {}, -105, 'x', 'file:///x', false);
  p.webContents.emit('did-fail-load', {}, -3, 'x', 'file:///x', true);
  assert.equal(p.yikik, false);
  p.webContents.emit('did-fail-load', {}, -105, 'x', 'file:///x', true);
  assert.equal(p.yikik, true);
});

test('loadFile reddedilirse karo sıfırlanır (yakalanmamış söz reddi yok)', async () => {
  const o = kur({ secili: ['light.salon'], yuklemeReddi: true });
  o.yonetici.esitle();
  await akit();
  await akit();
  assert.equal(o.pencereler[0].yikik, true);
  assert.deepEqual(o.yonetici.acikKimlikler(), []);
});

// --- IPC: gönderen denetimi --------------------------------------------------------------------------------------------------------

test('IPC kanalları kayıtlı: karo:durum-al, karo:calistir, karo:kaldir', () => {
  const o = kur();
  assert.deepEqual([...o.ipc.keys()].sort(), ['karo:calistir', 'karo:durum-al', 'karo:kaldir']);
});

test('karo:durum-al: karonun kendi penceresi modelini alır; kimlik sayfadan gelmez; dil eklenir', async () => {
  const o = kur();
  const [a, b] = await ac(o);
  const ya = await o.cagir('karo:durum-al', o.olay(a));
  assert.equal(ya.ok, true);
  assert.equal(ya.model.id, 'light.salon');
  assert.equal(ya.malzeme, 'yok');
  assert.equal(ya.dil, 'tr');
  const yb = await o.cagir('karo:durum-al', o.olay(b), { id: 'light.salon' });
  assert.equal(yb.model.id, 'switch.priz', 'sayfanın gönderdiği kimlik yok sayılır');
});

test('IPC gönderen denetimi: başka pencere, alt çerçeve, uzak/başka sayfa ve yok edilmiş pencere reddedilir; eylem çalışmaz', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  const yabanci = { webContents: new EventEmitter() };
  const olaylar = {
    'başka pencere': { sender: yabanci.webContents, senderFrame: { parent: null, url: pathToFileURL(KARO_HTML).href } },
    'alt çerçeve': o.olay(p, { senderFrame: { parent: {}, url: pathToFileURL(KARO_HTML).href } }),
    'uzak sayfa': o.olay(p, { senderFrame: { parent: null, url: 'https://ha.example.com/lovelace' } }),
    'başka yerel sayfa': o.olay(p, { senderFrame: { parent: null, url: pathToFileURL(path.join(KOK, 'ayarlar.html')).href } }),
    'çerçevesiz': { sender: p.webContents },
    'bozuk url': o.olay(p, { senderFrame: { parent: null, url: 'not a url' } }),
  };
  for (const [ad, olay] of Object.entries(olaylar)) {
    const al = await o.cagir('karo:durum-al', olay);
    assert.equal(al.ok, false, `${ad}: durum-al`);
    assert.equal(al.model, undefined);
    const calistir = await o.cagir('karo:calistir', olay, { tur: 'tikla' });
    assert.equal(calistir.ok, false, `${ad}: calistir`);
    o.cagir('karo:kaldir', olay);
  }
  assert.deepEqual(o.eylemCagrilari, []);
  assert.deepEqual(o.kaldirilanlar, []);
  p.destroy();
  assert.equal((await o.cagir('karo:durum-al', o.olay(p))).ok, false, 'yok edilmiş pencere');
});

test('izin yoksa hata iletisi dile göre; ayrıntı sızmaz', async () => {
  const tr = kur({ secili: ['light.salon'] });
  await ac(tr);
  assert.deepEqual(await tr.cagir('karo:durum-al', { sender: {}, senderFrame: null }), { ok: false, hata: 'İzin yok.' });
  const en = kur({ secili: ['light.salon'], dil: 'en' });
  await ac(en);
  assert.deepEqual(await en.cagir('karo:durum-al', { sender: {}, senderFrame: null }), { ok: false, hata: 'Not allowed.' });
});

// --- IPC: eylem yükü ---------------------------------------------------------------------------------------------------------------

test('karo:calistir: düz tıklama karonun KENDİ kimliğiyle eylem katmanına gider (kimliği sayfa belirleyemez)', async () => {
  const o = kur();
  const [a, b] = await ac(o);
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(a), { tur: 'tikla' }), { ok: true });
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(b), { tur: 'tikla' }), { ok: true });
  assert.deepEqual(o.eylemCagrilari, [{ kimlik: 'light.salon' }, { kimlik: 'switch.priz' }]);
});

test('karo:calistir: parlaklık ön ayarı yalnız modelin sunduğu değerlerle (favoride parlaklık açıkken) kabul edilir', async () => {
  const o = kur({ secili: ['light.salon', 'light.mutfak'] });
  const [salon, mutfak] = await ac(o);
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(salon), { parlaklik: 50 }), { ok: true });
  assert.deepEqual(o.eylemCagrilari, [{ kimlik: 'light.salon', parlaklik: 50 }]);
  const reddedilen = await o.cagir('karo:calistir', o.olay(mutfak), { parlaklik: 50 });
  assert.deepEqual(reddedilen, { ok: false, tur: 'gecersiz' }, 'favoride parlaklık kapalı: düğme de yok, istek de reddedilir');
  assert.equal(o.eylemCagrilari.length, 1);
});

test('karo:calistir: kimlik, servis, ek alan, ön ayar dışı değer ve bozuk yük reddedilir; eylem katmanına hiçbir şey gitmez', async () => {
  const o = kur({ secili: ['light.salon'] });
  const [p] = await ac(o);
  for (const yuk of [
    undefined, null, 'tikla', 5, [], {}, { tur: 'tikla', kimlik: 'lock.on_kapi' }, { tur: 'tikla', id: 'light.salon' }, { tur: 'tikla', servis: 'unlock' }, { kimlik: 'lock.on_kapi' },
    { servis: 'turn_on' }, { tur: 'ac' }, { parlaklik: 30 }, { parlaklik: '50' }, { parlaklik: 100.5 }, { parlaklik: 50, tur: 'tikla' }, { parlaklik: 50, kimlik: 'light.mutfak' }, { parlaklik: -1 },
  ]) {
    assert.deepEqual(await o.cagir('karo:calistir', o.olay(p), yuk), { ok: false, tur: 'gecersiz' }, JSON.stringify(yuk));
  }
  assert.deepEqual(o.eylemCagrilari, []);
});

test('karo:calistir: salt okunur sensör karosu tıklanamaz; ulaşılamayan karo çalıştırılamaz; karo geçersizleşmişse reddedilir', async () => {
  const o = kur({ secili: ['sensor.sicaklik', 'switch.priz'] });
  const [sensor, priz] = await ac(o);
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(sensor), { tur: 'tikla' }), { ok: false, tur: 'gecersiz' });
  o.varliklar.set('switch.priz', varlik('switch.priz', 'unavailable'));
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(priz), { tur: 'tikla' }), { ok: false, tur: 'gecersiz' });
  o.varliklar.set('switch.priz', varlik('switch.priz', 'on', { friendly_name: 'Kapı rölesi' }));
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(priz), { tur: 'tikla' }), { ok: false, tur: 'gecersiz' }, 'kapı kuralına takılan karo (esitle henüz kapatmadan)');
  assert.deepEqual(o.eylemCagrilari, []);
});

test('karo:calistir: eylem katmanının yanıtı olduğu gibi sayfaya döner', async () => {
  const o = kur({ secili: ['switch.priz'] });
  const [p] = await ac(o);
  o.eylemYaniti = { ok: false, tur: 'reddedildi' };
  assert.deepEqual(await o.cagir('karo:calistir', o.olay(p), { tur: 'tikla' }), { ok: false, tur: 'reddedildi' });
});

test('karo:kaldir: × düğmesi yalnız kendi karosunun sabitlemesini kaldırır ve pencere hemen kapanır', async () => {
  const o = kur();
  const [a, b] = await ac(o);
  o.cagir('karo:kaldir', o.olay(b), 'light.salon');
  assert.deepEqual(o.kaldirilanlar, ['switch.priz'], 'sayfanın gönderdiği kimlik yok sayılır');
  assert.equal(b.yikik, true, 'pencere durum değişimini beklemeden kapandı');
  assert.equal(a.yikik, false);
  assert.deepEqual(o.yonetici.acikKimlikler(), ['light.salon']);
  assert.deepEqual(o.secili, ['light.salon']);
});
