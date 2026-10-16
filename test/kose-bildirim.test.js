'use strict';

/**
 * Köşe bildirimi (src/kose-bildirim.js): sahte Electron ile, hiçbir pencere açılmadan. Pencere gün boyu gizli yaşar;
 * sayfa süreci ölürse ya da ana çerçeve yüklenemezse yeniden oluşturulur (Dalga 2 denetimi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const KOK = path.join(__dirname, '..', 'src');

function onbellegiTemizle() {
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(KOK + path.sep)) delete require.cache[anahtar];
  }
}

/** Sahte Electron + köşe bildirimi modülü. `yuklemeSonucu`: loadFile'ın sonucu ('tamam' | 'red' | 'bekle'). */
function kur({ yuklemeSonucu = 'tamam', malzemeAl, engelAl, gorunumAl, metinOlcegiAl } = {}) {
  const pencereler = [];
  class SahteWebContents extends EventEmitter {
    constructor() {
      super();
      this.mesajlar = [];
      this.zoomlar = []; // setZoomFactor çağrıları
    }

    setZoomFactor(f) {
      this.zoomlar.push(f);
    }

    setWindowOpenHandler() {}
    send(kanal, yuk) {
      this.mesajlar.push({ kanal, yuk });
    }
  }
  class SahtePencere extends EventEmitter {
    constructor(secenekler) {
      super();
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
      this.yikik = false;
      this.gorunur = false;
      this.malzemeler = []; // setBackgroundMaterial çağrıları
      this.arkaPlanRenkleri = []; // setBackgroundColor çağrıları
      this.sinirlar = []; // setBounds çağrıları
      pencereler.push(this);
    }

    loadFile() {
      if (yuklemeSonucu === 'red') return Promise.reject(new Error('ERR_FILE_NOT_FOUND'));
      if (yuklemeSonucu === 'tamam') queueMicrotask(() => this.webContents.emit('did-finish-load'));
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

    showInactive() {
      this.gorunur = true;
    }

    hide() {
      this.gorunur = false;
    }

    setBackgroundMaterial(malzeme) {
      this.malzemeler.push(malzeme);
    }

    setBackgroundColor(renk) {
      this.arkaPlanRenkleri.push(renk);
    }

    setBounds(sinir) {
      this.sinirlar.push(sinir);
    }

    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
  }
  const sahte = {
    app: { isPackaged: true },
    BrowserWindow: SahtePencere,
    screen: {
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    },
  };
  const orijinalYukle = Module._load;
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahte : orijinalYukle.call(this, istek, ...gerisi);
  };
  onbellegiTemizle();
  let modul;
  try {
    modul = require(path.join(KOK, 'kose-bildirim.js'));
  } finally {
    Module._load = orijinalYukle;
  }
  const gunlukler = [];
  const yedekler = [];
  const kose = modul.koseBildirimiOlustur({ gunluk: (m) => gunlukler.push(m), yedekGoster: (b) => yedekler.push(b), ...(malzemeAl ? { malzemeAl } : {}), ...(engelAl ? { engelAl } : {}), ...(gorunumAl ? { gorunumAl } : {}), ...(metinOlcegiAl ? { metinOlcegiAl } : {}) });
  const akit = () => new Promise((coz) => setImmediate(coz));
  const mesajlar = (p) => p.webContents.mesajlar.filter((m) => m.kanal === 'kose:goster').map((m) => m.yuk);
  return { kose, pencereler, gunlukler, yedekler, akit, mesajlar, temizle: () => { kose.kapat(); onbellegiTemizle(); } };
}

test('köşe bildirimi: yükleme bitince bekleyen bildirim gösterilir', async () => {
  const o = kur();
  try {
    assert.equal(o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' }), true);
    await o.akit();
    assert.equal(o.pencereler.length, 1);
    assert.deepEqual(o.mesajlar(o.pencereler[0]), [{ tur: 'ok', metin: 'Salon açıldı', sureMs: 1500, malzeme: 'yok' }]);
    assert.equal(o.pencereler[0].gorunur, true);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: sayfa süreci çökerse pencere yok edilir, günlüğe nedeni yazılır; sonraki bildirim yeni pencerede gösterilir', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Birinci' });
    await o.akit();
    const ilk = o.pencereler[0];
    ilk.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(ilk.yikik, true);
    assert.ok(o.gunlukler.some((m) => /sıfırlandı \(sayfa-sureci-kapandi:crashed\)/.test(m)), o.gunlukler.join('|'));
    assert.deepEqual(o.yedekler, [], 'bekleyen bildirim yoktu: yedek de yok');

    assert.equal(o.kose.goster({ tur: 'ok', metin: 'İkinci' }), true);
    await o.akit();
    assert.equal(o.pencereler.length, 2, 'ikinci bildirimde pencere yeniden oluşturuldu');
    assert.deepEqual(o.mesajlar(o.pencereler[1]), [{ tur: 'ok', metin: 'İkinci', sureMs: 1500, malzeme: 'yok' }]);
    assert.equal(o.pencereler[1].gorunur, true);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: normal kapanış (clean-exit) ve alt çerçeve ya da iptal edilen yükleme pencereyi SIFIRLAMAZ', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Birinci' });
    await o.akit();
    const p = o.pencereler[0];
    p.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
    p.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', false); // alt çerçeve
    p.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///x', true); // iptal
    assert.equal(p.yikik, false);
    assert.deepEqual(o.gunlukler, []);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: ana çerçeve yüklenemezse (did-fail-load) pencere sıfırlanır; bekleyen bildirim yedeğe düşer, bir kez', async () => {
  const o = kur({ yuklemeSonucu: 'bekle' }); // did-finish-load hiç gelmez: bildirim bekliyor
  try {
    assert.equal(o.kose.goster({ tur: 'hata', metin: 'Yapılamadı' }), true);
    const p = o.pencereler[0];
    p.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
    assert.equal(p.yikik, true);
    assert.deepEqual(o.yedekler, [{ tur: 'hata', metin: 'Yapılamadı' }]);
    assert.ok(o.gunlukler.some((m) => /sayfa-yuklenemedi:-6/.test(m)));
    // Sonradan gelen ikinci hata ya da loadFile reddi aynı pencere için tekrar işlem yapmaz.
    p.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
    await o.akit();
    assert.equal(o.yedekler.length, 1);
    assert.equal(o.gunlukler.filter((m) => /sıfırlandı/.test(m)).length, 1);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: loadFile reddedilirse pencere sıfırlanır ve bekleyen bildirim yedeğe düşer (önceki davranış korunur)', async () => {
  const o = kur({ yuklemeSonucu: 'red' });
  try {
    assert.equal(o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' }), true);
    await o.akit();
    assert.equal(o.pencereler[0].yikik, true);
    assert.deepEqual(o.yedekler, [{ tur: 'ok', metin: 'Salon açıldı' }]);
    assert.ok(o.gunlukler.some((m) => /yukleme-reddedildi/.test(m)));
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: kapat() pencereyi yok eder ve sıfırlama/yedek tetiklemez', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Birinci' });
    await o.akit();
    const p = o.pencereler[0];
    o.kose.kapat();
    p.webContents.emit('render-process-gone', {}, { reason: 'killed' }); // yok edilirken gelen geç olay
    assert.equal(p.yikik, true);
    assert.deepEqual(o.yedekler, []);
    assert.deepEqual(o.gunlukler, []);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: eski pencerenin geç gelen olayı yeni pencereyi etkilemez', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Birinci' });
    await o.akit();
    const eski = o.pencereler[0];
    eski.webContents.emit('render-process-gone', {}, { reason: 'oom' });
    o.kose.goster({ tur: 'ok', metin: 'İkinci' });
    await o.akit();
    const yeni = o.pencereler[1];
    eski.webContents.emit('render-process-gone', {}, { reason: 'oom' }); // yinelenen geç olay
    eski.emit('closed');
    assert.equal(yeni.yikik, false);
    assert.equal(o.kose.goster({ tur: 'ok', metin: 'Üçüncü' }), true);
    assert.equal(o.pencereler.length, 2, 'yeni pencere hâlâ canlı: üçüncü bildirim yeni pencere açmaz');
    assert.equal(o.mesajlar(yeni).length, 2);
  } finally {
    o.temizle();
  }
});

// --- g-09: açık panelle çakışmama ---------------------------------------------------------------

test('köşe bildirimi: açık panel sağ alt köşeyi örtüyorsa bildirim panelin üstüne yerleşir; panel yoksa ya da engel okunamazsa sağ alt köşede kalır', async () => {
  const panel = { x: 1552, y: 612, width: 360, height: 420 }; // çalışma alanı 1920x1040, panelin alt kenarı 1032
  let engel = panel;
  const o = kur({ engelAl: () => engel });
  try {
    o.kose.goster({ tur: 'ok', metin: 'Birinci' });
    await o.akit();
    const p = o.pencereler[0];
    assert.deepEqual(p.sinirlar.at(-1), { x: 1920 - 320 - 16, y: panel.y - 56 - 8, width: 320, height: 56 }, 'panelin hemen üstünde');

    engel = null; // panel kapandı
    o.kose.goster({ tur: 'ok', metin: 'İkinci' });
    assert.deepEqual(p.sinirlar.at(-1), { x: 1920 - 320 - 16, y: 1040 - 56 - 16, width: 320, height: 56 }, 'varsayılan köşe');

    engel = { x: 0, y: 0, width: 360, height: 420 }; // sol üstte açık panel: çakışma yok
    o.kose.goster({ tur: 'ok', metin: 'Üçüncü' });
    assert.deepEqual(p.sinirlar.at(-1), { x: 1920 - 320 - 16, y: 1040 - 56 - 16, width: 320, height: 56 });

    engel = () => {
      throw new Error('okunamadı');
    };
    const atan = kur({ engelAl: () => engel() });
    try {
      atan.kose.goster({ tur: 'hata', metin: 'Yapılamadı' });
      await atan.akit();
      assert.deepEqual(atan.pencereler[0].sinirlar.at(-1), { x: 1920 - 320 - 16, y: 1040 - 56 - 16, width: 320, height: 56 }, 'engel okunamazsa bildirim yine görünür');
      assert.equal(atan.pencereler[0].gorunur, true);
      assert.deepEqual(atan.gunlukler, [], 'sessizce varsayılana döner');
    } finally {
      atan.temizle();
    }
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: engelAl verilmezse bildirim her zaman sağ alt köşededir (önceki davranış)', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
    await o.akit();
    assert.deepEqual(o.pencereler[0].sinirlar, [{ x: 1584, y: 968, width: 320, height: 56 }]);
  } finally {
    o.temizle();
  }
});

// --- gorunum-11: Windows 11 arka plan malzemesi ----------------------------------------------

const ACRYLIC = { malzeme: 'acrylic', secenekler: { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } };
const OPAK = { malzeme: 'yok', secenekler: { backgroundColor: '#1b1f27' } };

test('köşe bildirimi: malzeme verilmezse opak koyu arka plan, backgroundMaterial yok, transparent yok', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
    await o.akit();
    const s = o.pencereler[0].secenekler;
    assert.equal(s.backgroundColor, '#1b1f27');
    assert.equal(s.backgroundMaterial, undefined);
    assert.equal(s.transparent, undefined);
    assert.equal(s.roundedCorners, true);
    assert.equal(s.focusable, false, 'odak almayan pencere özelliği korunur');
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: acrylic seçiliyse pencere backgroundMaterial ve saydam arka planla açılır, sayfaya "acrylic" bildirilir', async () => {
  const o = kur({ malzemeAl: () => ACRYLIC });
  try {
    o.kose.goster({ tur: 'hata', metin: 'Yapılamadı' });
    await o.akit();
    const s = o.pencereler[0].secenekler;
    assert.equal(s.backgroundMaterial, 'acrylic');
    assert.equal(s.backgroundColor, '#00000000');
    assert.equal(s.transparent, undefined);
    assert.deepEqual(o.mesajlar(o.pencereler[0]), [{ tur: 'hata', metin: 'Yapılamadı', sureMs: 3000, malzeme: 'acrylic' }]);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: malzemeyiUygula var olan pencerenin malzemesini ve rengini günceller; pencere yokken sessizce atlar', async () => {
  let secim = ACRYLIC;
  const o = kur({ malzemeAl: () => secim });
  try {
    o.kose.malzemeyiUygula(); // pencere henüz yok: hata vermez
    o.kose.goster({ tur: 'ok', metin: 'A' });
    await o.akit();
    const p = o.pencereler[0];
    secim = OPAK;
    o.kose.malzemeyiUygula();
    assert.equal(p.malzemeler.at(-1), 'none');
    assert.equal(p.arkaPlanRenkleri.at(-1), '#1b1f27');
    secim = { malzeme: 'mica', secenekler: { backgroundMaterial: 'mica', backgroundColor: '#00000000' } };
    o.kose.malzemeyiUygula();
    assert.equal(p.malzemeler.at(-1), 'mica');
    assert.equal(p.arkaPlanRenkleri.at(-1), '#00000000');
    o.kose.goster({ tur: 'ok', metin: 'B' });
    assert.equal(o.mesajlar(p).at(-1).malzeme, 'mica', 'sonraki bildirim yeni malzemeyi bildirir');
  } finally {
    o.temizle();
  }
});

// ---- 1.4.0 grup "tema": görünüm modeli (o-29, o-34) ve metin boyutu (o-25) -----------------------------------------------

test('tema: köşe bildirimi yüküne görünüm modeli YALNIZ varsayılandan farklıysa eklenir; model üretilemezse bildirim yine gider', async () => {
  const model = { karsitlik: true };
  let simdiki = null;
  const o = kur({ gorunumAl: () => simdiki });
  try {
    o.kose.goster({ tur: 'ok', metin: 'A' });
    await o.akit();
    const p = o.pencereler[0];
    assert.equal(Object.hasOwn(o.mesajlar(p).at(-1), 'gorunum'), false, 'varsayılan görünümde anahtar yok');
    simdiki = model;
    o.kose.goster({ tur: 'ok', metin: 'B' });
    assert.deepEqual(o.mesajlar(p).at(-1).gorunum, model);
    simdiki = null;
    o.kose.goster({ tur: 'ok', metin: 'C' });
    assert.equal(Object.hasOwn(o.mesajlar(p).at(-1), 'gorunum'), false, 'varsayılana dönünce yük yine temiz (sayfa eski görünümü temizler)');
  } finally {
    o.temizle();
  }
  const bozuk = kur({ gorunumAl: () => { throw new Error('bozuk ayar'); } });
  try {
    bozuk.kose.goster({ tur: 'ok', metin: 'D' });
    await bozuk.akit();
    const p = bozuk.pencereler[0];
    assert.equal(bozuk.mesajlar(p).length, 1);
    assert.equal(Object.hasOwn(bozuk.mesajlar(p)[0], 'gorunum'), false);
    assert.equal(bozuk.yedekler.length, 0, 'yedek bildirime düşmez');
  } finally {
    bozuk.temizle();
  }
});

test('o-25 metin boyutu: köşe bildirimi pencere boyutu ve sayfa yakınlaştırması ölçekle büyür; ölçek değişmedikçe yakınlaştırma yeniden yazılmaz', async () => {
  let olcek = 1.5;
  const o = kur({ metinOlcegiAl: () => olcek });
  try {
    o.kose.goster({ tur: 'ok', metin: 'A' });
    await o.akit();
    const p = o.pencereler[0];
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [480, 84]);
    assert.deepEqual(p.webContents.zoomlar, [1.5]);
    o.kose.goster({ tur: 'ok', metin: 'B' });
    assert.deepEqual(p.webContents.zoomlar, [1.5], 'aynı ölçek yeniden uygulanmaz');
    olcek = 1.15;
    o.kose.goster({ tur: 'ok', metin: 'C' });
    assert.deepEqual(p.webContents.zoomlar, [1.5, 1.15]);
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [368, 64]);
    olcek = 1;
    o.kose.goster({ tur: 'ok', metin: 'D' });
    assert.equal(p.webContents.zoomlar.at(-1), 1);
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [320, 56]);
    const alan = { x: 0, y: 0, width: 1920, height: 1040 };
    assert.ok(p.sinirlar.at(-1).x + p.sinirlar.at(-1).width <= alan.width && p.sinirlar.at(-1).y + p.sinirlar.at(-1).height <= alan.height, 'çalışma alanında kalır');
  } finally {
    o.temizle();
  }
});

test('o-25 metin boyutu: ölçek 1 iken yakınlaştırma çağrısı yok; geçersiz ya da hatalı ölçek 1 sayılır', async () => {
  for (const kotu of [undefined, null, 0, 0.5, 2.5, NaN, 'x', {}]) {
    const o = kur({ metinOlcegiAl: () => kotu });
    try {
      o.kose.goster({ tur: 'ok', metin: 'A' });
      await o.akit();
      const p = o.pencereler[0];
      assert.deepEqual(p.webContents.zoomlar, [], String(kotu));
      assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [320, 56], String(kotu));
    } finally {
      o.temizle();
    }
  }
  const hatali = kur({ metinOlcegiAl: () => { throw new Error('x'); } });
  try {
    hatali.kose.goster({ tur: 'ok', metin: 'A' });
    await hatali.akit();
    assert.equal(hatali.pencereler[0].sinirlar.at(-1).width, 320);
  } finally {
    hatali.temizle();
  }
});

test('o-25 metin boyutu: sayfa süreci ölüp pencere yeniden oluşunca yakınlaştırma yeni sayfaya yeniden yazılır', async () => {
  const o = kur({ metinOlcegiAl: () => 1.3 });
  try {
    o.kose.goster({ tur: 'ok', metin: 'A' });
    await o.akit();
    const ilk = o.pencereler[0];
    assert.deepEqual(ilk.webContents.zoomlar, [1.3]);
    ilk.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    o.kose.goster({ tur: 'ok', metin: 'B' });
    await o.akit();
    const yeni = o.pencereler[1];
    assert.ok(yeni && yeni !== ilk);
    assert.deepEqual(yeni.webContents.zoomlar, [1.3], 'yeni sayfa 1 ile başlar, ölçek yeniden yazılır');
  } finally {
    o.temizle();
  }
});
