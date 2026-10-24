'use strict';

/**
 * Köşe bildirimi (src/kose-bildirim.js): sahte Electron ile, hiçbir pencere açılmadan. Pencere gün boyu gizli yaşar;
 * sayfa süreci ölürse ya da ana çerçeve yüklenemezse yeniden oluşturulur (Dalga 2 denetimi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const KOK = path.join(__dirname, '..', 'src');

function onbellegiTemizle() {
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(KOK + path.sep)) delete require.cache[anahtar];
  }
}

/**
 * Sahte Electron + köşe bildirimi modülü. `yuklemeSonucu`: loadFile'ın sonucu ('tamam' | 'red' | 'bekle').
 * `opaklik`: sahte pencere setOpacity destekler (1.6.1 pencere solması; yoksa pencere eskisi gibi birden görünür/gizlenir).
 * `sistemAzalt`: Windows'ta animasyon efektleri kapalı (systemPreferences.getAnimationSettings).
 */
function kur({ yuklemeSonucu = 'tamam', malzemeAl, engelAl, gorunumAl, metinOlcegiAl, opaklik = false, sistemAzalt = false } = {}) {
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
  if (opaklik) {
    SahtePencere.prototype.setOpacity = function setOpacity(deger) {
      (this.opakliklar ??= []).push(deger);
    };
  }
  const sahte = {
    app: { isPackaged: true },
    BrowserWindow: SahtePencere,
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: sistemAzalt }) },
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
    assert.deepEqual(p.sinirlar.at(-1), { x: panel.x + (panel.width - 320) / 2, y: panel.y - 56 - 8, width: 320, height: 56 }, 'panelin hemen üstünde, yatayda ortalı');

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

// --- 1.4.0: bilgi türü (bildirim merkezi ve varlık uyarıları) --------------------------------------

test('köşe bildirimi: bilgi türü simge ve 6 sn süreyle gösterilir; ok/hata yükünde simge anahtarı yoktur', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'Uyarı: Salon çok sıcak', simge: '📈' });
    await o.akit();
    assert.deepEqual(o.mesajlar(o.pencereler[0]), [{ tur: 'bilgi', metin: 'Uyarı: Salon çok sıcak', simge: '📈', sureMs: 6000, malzeme: 'yok' }]);
    o.kose.goster({ tur: 'ok', metin: 'Tamam' }); // eylem geri bildirimi bilgiyi beklemez
    const son = o.mesajlar(o.pencereler[0]).at(-1);
    assert.deepEqual(son, { tur: 'ok', metin: 'Tamam', sureMs: 1500, malzeme: 'yok' });
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: bilgi metni 140, simge 8 karakterle sınırlanır', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'a'.repeat(400), simge: 'x'.repeat(50) });
    await o.akit();
    const yuk = o.mesajlar(o.pencereler[0])[0];
    assert.equal(Array.from(yuk.metin).length, 140);
    assert.equal(Array.from(yuk.simge).length, 8);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: görünen bildirim varken gelen bilgiler sıraya girer ve süre dolunca sırayla gösterilir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'Bir', simge: '1' });
    await o.akit();
    assert.equal(o.kose.goster({ tur: 'bilgi', metin: 'İki', simge: '2' }), true);
    assert.equal(o.kose.goster({ tur: 'bilgi', metin: 'Üç', simge: '3' }), true);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Bir'], 'sıradakiler hemen görünmez');
    t.mock.timers.tick(6000 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Bir', 'İki']);
    t.mock.timers.tick(6000 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Bir', 'İki', 'Üç']);
    assert.equal(o.pencereler[0].gorunur, true);
    t.mock.timers.tick(6000 + 150);
    assert.equal(o.pencereler[0].gorunur, false, 'sıra bitince pencere gizlenir');
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: bilgi sırası dolunca en eski düşer (en çok BILGI_KUYRUK_SINIRI bekler)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { BILGI_KUYRUK_SINIRI } = require(path.join(KOK, 'kose-bildirim.js'));
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'ilk', simge: 'i' });
    await o.akit();
    for (let i = 0; i < BILGI_KUYRUK_SINIRI + 3; i += 1) o.kose.goster({ tur: 'bilgi', metin: `s${i}`, simge: 'i' });
    for (let i = 0; i < BILGI_KUYRUK_SINIRI + 2; i += 1) t.mock.timers.tick(6150);
    const metinler = o.mesajlar(o.pencereler[0]).map((m) => m.metin);
    assert.equal(metinler[0], 'ilk');
    assert.equal(metinler.length, 1 + BILGI_KUYRUK_SINIRI);
    assert.ok(!metinler.includes('s0') && !metinler.includes('s1') && !metinler.includes('s2'), 'en eskiler düştü: ' + metinler.join(','));
    assert.equal(metinler.at(-1), `s${BILGI_KUYRUK_SINIRI + 2}`);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: yükleme beklerken gelen bilgiler sırada tutulur; pencere sıfırlanırsa hepsi yedeğe düşer', async () => {
  const o = kur({ yuklemeSonucu: 'bekle' });
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'A', simge: 'a' });
    o.kose.goster({ tur: 'bilgi', metin: 'B', simge: 'b' });
    o.pencereler[0].webContents.emit('did-fail-load', {}, -6, 'ERR', 'file:///x', true);
    assert.deepEqual(o.yedekler.map((y) => y.metin), ['A', 'B']);
    assert.ok(o.yedekler.every((y) => y.tur === 'bilgi'));
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: bilinmeyen tür ok sayılır (bilgi yalnız açıkça istenince)', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'uyari', metin: 'x', simge: 'y' });
    await o.akit();
    assert.deepEqual(o.mesajlar(o.pencereler[0]), [{ tur: 'ok', metin: 'x', sureMs: 1500, malzeme: 'yok' }]);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi (1.6.0): eylem özeti sayfaya gider; başlık kısalır, bilinmeyen alan düşer, bilgi ve eksik özet yok sayılır', async () => {
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'Ampul kapatıldı', ozet: { baslik: 'Ampul', alt: 'Kapatıldı', alan: 'light', acik: false } });
    await o.akit();
    assert.deepEqual(o.mesajlar(o.pencereler[0]), [{ tur: 'ok', metin: 'Ampul kapatıldı', ozet: { baslik: 'Ampul', alt: 'Kapatıldı', alan: 'light', acik: false }, sureMs: 1500, malzeme: 'yok' }]);
    o.kose.goster({ tur: 'hata', metin: 'x', ozet: { baslik: 'K'.repeat(90), alt: 'Yapılamadı', alan: 'lock', acik: true } });
    const hata = o.mesajlar(o.pencereler[0]).at(-1).ozet;
    assert.ok(hata.baslik.length <= 60, 'başlık 60 karaktere kısalır');
    assert.equal(hata.alan, null, 'listede olmayan alan simgesiz kalır');
    assert.equal(hata.acik, true);
    o.kose.goster({ tur: 'ok', metin: 'Yalnız metin', ozet: { baslik: 'Ampul', alt: '' } });
    assert.equal('ozet' in o.mesajlar(o.pencereler[0]).at(-1), false, 'alt satır boşsa özet yok, tek satır');
    o.kose.goster({ tur: 'ok', metin: 'Dizi', ozet: 'metin' });
    assert.equal('ozet' in o.mesajlar(o.pencereler[0]).at(-1), false, 'nesne olmayan özet yok sayılır');
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi (1.6.0): bilgi türünde özet kayda girmez (kaynak bekçisi), pencere açılamasa da çökmez', () => {
  const o = kur({ yuklemeSonucu: 'red' });
  try {
    o.kose.goster({ tur: 'ok', metin: 'Ampul açıldı', ozet: { baslik: 'Ampul', alt: 'Açıldı', alan: 'light', acik: true } });
    o.kose.goster({ tur: 'bilgi', metin: 'Çamaşır bitti', simge: 'i', ozet: { baslik: 'a', alt: 'b' } });
  } finally {
    o.temizle();
  }
  const kaynak = fs.readFileSync(path.join(KOK, 'kose-bildirim.js'), 'utf8');
  assert.match(kaynak, /const ozetTemiz = bilgi \? null : ozetDuzelt\(ozet\);/);
});

test('köşe bildirimi: eylem geri bildirimi (ok / hata) ekrandaki bilgiyi hemen keser ama bilgi KAYBOLMAZ; sıranın başına döner ve eylem bitince yeniden görünür', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'Kapı açık kaldı', simge: '!' });
    await o.akit();
    o.kose.goster({ tur: 'bilgi', metin: 'Sıradaki', simge: 'i' });
    o.kose.goster({ tur: 'ok', metin: 'Lamba açıldı' });
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Kapı açık kaldı', 'Lamba açıldı'], 'eylem sonucu bilgiyi beklemez');
    t.mock.timers.tick(1500 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Kapı açık kaldı', 'Lamba açıldı', 'Kapı açık kaldı'], 'kesilen bilgi sırada öne geçer');
    t.mock.timers.tick(6000 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin).at(-1), 'Sıradaki');
    t.mock.timers.tick(6000 + 150);
    assert.equal(o.pencereler[0].gorunur, false, 'sıra bitince pencere gizlenir');
    o.kose.goster({ tur: 'ok', metin: 'Tek başına' });
    t.mock.timers.tick(1500 + 150);
    assert.equal(o.pencereler[0].gorunur, false, 'ekranda bilgi yokken ok sonrası geri dönen bir şey yok');
    assert.equal(o.mesajlar(o.pencereler[0]).length, 5);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: hata geri bildirimi de bilgiyi keser ve bilgi yeniden görünür; ok art arda gelince bilgi bir kez sırada kalır (çoğalmaz)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'Uyarı', simge: '!' });
    await o.akit();
    o.kose.goster({ tur: 'hata', metin: 'Olmadı' });
    o.kose.goster({ tur: 'ok', metin: 'Oldu' });
    o.kose.goster({ tur: 'ok', metin: 'Yine oldu' });
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Uyarı', 'Olmadı', 'Oldu', 'Yine oldu']);
    t.mock.timers.tick(1500 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin).slice(4), ['Uyarı']);
    t.mock.timers.tick(6000 + 150);
    assert.equal(o.mesajlar(o.pencereler[0]).length, 5, 'bilgi bir kez daha gösterildi, çoğalmadı');
    assert.equal(o.pencereler[0].gorunur, false);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: yükleme beklerken gelen ilk bilgi, araya giren eylem geri bildirimiyle EZİLMEZ; ok önce, bilgi ardından görünür', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur({ yuklemeSonucu: 'bekle' });
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'Çamaşır bitti', simge: 'i' });
    o.kose.goster({ tur: 'ok', metin: 'Lamba açıldı' });
    o.pencereler[0].webContents.emit('did-finish-load');
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Lamba açıldı']);
    t.mock.timers.tick(1500 + 150);
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.metin), ['Lamba açıldı', 'Çamaşır bitti']);
    assert.deepEqual(o.yedekler, []);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: sıra doluyken kesilen bilgi geri dönmez (kural: dolu sırada en eski düşer); sıradakiler korunur', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { BILGI_KUYRUK_SINIRI } = require(path.join(KOK, 'kose-bildirim.js'));
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'ilk', simge: 'i' });
    await o.akit();
    for (let i = 0; i < BILGI_KUYRUK_SINIRI; i += 1) o.kose.goster({ tur: 'bilgi', metin: `s${i}`, simge: 'i' });
    o.kose.goster({ tur: 'ok', metin: 'Tamam' });
    t.mock.timers.tick(1500 + 150);
    for (let i = 0; i < BILGI_KUYRUK_SINIRI; i += 1) t.mock.timers.tick(6150);
    const metinler = o.mesajlar(o.pencereler[0]).map((m) => m.metin);
    assert.deepEqual(metinler, ['ilk', 'Tamam', 's0', 's1', 's2', 's3', 's4']);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: kapat() bekleyen kaydı da sıfırlar; yeniden oluşan pencere eski bildirimi göstermez', async () => {
  const o = kur({ yuklemeSonucu: 'bekle' });
  try {
    o.kose.goster({ tur: 'ok', metin: 'Eski' });
    o.kose.kapat();
    assert.equal(o.pencereler[0].yikik, true);
    o.kose.goster({ tur: 'bilgi', metin: 'Yeni', simge: 'i' });
    assert.equal(o.pencereler.length, 2);
    o.pencereler[1].webContents.emit('did-finish-load');
    assert.deepEqual(o.mesajlar(o.pencereler[1]).map((m) => m.metin), ['Yeni'], 'eski bekleyen bildirim yeni pencerede görünmez');
    assert.deepEqual(o.yedekler, []);
  } finally {
    o.temizle();
  }
});

// --- 1.6.1 pencere solması -----------------------------------------------------------------------------------------------
// Kart pencere içinde canlanırken akrilik zemin sabit kalıyor, bildirim bitince bir an boş kutu görünüyordu. Artık pencere
// bütün olarak (zemin + içerik) ana süreçte solar: saydam açılır, belirir; süre sonunda solar ve gizlenir.

/** Sahte saati küçük adımlarla ilerletir: solma adımları birbirini zincirleme kurar (tek büyük tick yalnız ilkini çalıştırır). */
function adimla(t, ms) {
  for (let gecen = 0; gecen < ms; gecen += 5) t.mock.timers.tick(5);
}

const artan = (dizi) => dizi.every((v, i) => i === 0 || v >= dizi[i - 1]);
const azalan = (dizi) => dizi.every((v, i) => i === 0 || v <= dizi[i - 1]);

test('köşe bildirimi (1.6.1): pencere saydam açılır, solarak belirir; süre bitince solarak kaybolur ve ancak sonra gizlenir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur({ opaklik: true });
  try {
    o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
    await o.akit();
    const p = o.pencereler[0];
    assert.equal(p.gorunur, true);
    assert.deepEqual(p.opakliklar, [0], 'ilk kare saydam: gizliyken kalan önceki bildirimin karesi görünmez');
    adimla(t, 260);
    assert.equal(p.opakliklar.at(-1), 1, 'belirdi');
    assert.ok(p.opakliklar.length > 3 && artan(p.opakliklar), 'adım adım: ' + p.opakliklar.join(','));
    const girisSonu = p.opakliklar.length;

    adimla(t, 1500 - 260 + 50); // süre bitti, çıkış solması sürüyor
    assert.equal(p.gorunur, true, 'solarken pencere hâlâ görünür');
    const cikis = p.opakliklar.slice(girisSonu - 1);
    assert.ok(cikis.at(-1) > 0 && cikis.at(-1) < 1, 'yarı saydam: ' + cikis.join(','));
    adimla(t, 200);
    assert.equal(p.gorunur, false, 'solma bitince gizlendi');
    const tumCikis = p.opakliklar.slice(girisSonu - 1);
    assert.equal(tumCikis.at(-1), 0);
    assert.ok(azalan(tumCikis), tumCikis.join(','));
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi (1.6.1): pencere solarak gizlenirken gelen bilgi hemen gösterilir (sıraya takılmaz), solma geri alınır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur({ opaklik: true });
  try {
    o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
    await o.akit();
    const p = o.pencereler[0];
    adimla(t, 1500 + 50); // çıkış solması sürüyor
    assert.ok(p.opakliklar.at(-1) < 1);
    assert.equal(o.kose.goster({ tur: 'bilgi', metin: 'Çamaşır makinesi bitti', simge: 'i' }), true);
    assert.equal(o.mesajlar(p).at(-1).tur, 'bilgi', 'beklemeden gönderildi');
    adimla(t, 300);
    assert.equal(p.gorunur, true, 'eski solmanın sonundaki gizleme çalışmadı');
    assert.equal(p.opakliklar.at(-1), 1, 'yeniden belirdi');
    adimla(t, 6000);
    assert.equal(p.gorunur, false, 'bilginin süresi bitince solup gizlendi');
  } finally {
    o.temizle();
  }
});

for (const [ad, secenek] of [
  ['Ayarlar > Hareketi azalt', { gorunumAl: () => ({ hareketiAzalt: true }) }],
  ['Windows animasyon efektleri kapalı', { sistemAzalt: true }],
]) {
  test(`köşe bildirimi (1.6.1): ${ad} ise pencere solmaz (ilk saydam kareden sonra birden görünür, süre sonunda hemen gizlenir)`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const o = kur({ opaklik: true, ...secenek });
    try {
      o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
      await o.akit();
      const p = o.pencereler[0];
      adimla(t, 100);
      assert.deepEqual(p.opakliklar, [0, 1], 'ara adım yok');
      adimla(t, 1500 - 100 + 5);
      assert.equal(p.gorunur, false, 'süre biter bitmez gizlendi');
      assert.deepEqual(p.opakliklar, [0, 1], 'çıkışta da solma yok');
    } finally {
      o.temizle();
    }
  });
}

test('köşe bildirimi (1.6.1): kapat() sürmekte olan solmayı durdurur (yok edilmiş pencereye yazılmaz)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur({ opaklik: true });
  o.kose.goster({ tur: 'ok', metin: 'Salon açıldı' });
  await o.akit();
  const p = o.pencereler[0];
  adimla(t, 60);
  const sayi = p.opakliklar.length;
  o.temizle();
  assert.equal(p.yikik, true);
  adimla(t, 400);
  assert.equal(p.opakliklar.length, sayi);
});

test('köşe bildirimi: gösterim fırlatırsa pencere görünür kalıp kuyruğu kilitlemez; bilgi yedeğe düşer, sıra ilerler, sonraki bilgi çizilir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kose.goster({ tur: 'bilgi', metin: 'A', simge: 'a' });
    await o.akit();
    const p = o.pencereler[0];
    const gercekSend = p.webContents.send.bind(p.webContents);
    p.webContents.send = (kanal, yuk) => {
      if (kanal === 'kose:goster' && yuk.metin === 'B') throw new Error('Render frame was disposed before WebFrameMain could be accessed');
      gercekSend(kanal, yuk);
    };
    o.kose.goster({ tur: 'bilgi', metin: 'B', simge: 'b' }); // A görünürken sıraya girer
    t.mock.timers.tick(6000 + 150); // A bitti, B çizilemedi
    assert.ok(o.gunlukler.includes('Köşe bildirimi gösterilemedi.'));
    assert.deepEqual(o.yedekler.map((y) => y.metin), ['B'], 'çizilemeyen bilgi yedeğe düştü');
    assert.equal(p.gorunur, false, 'sıra boşaldı: pencere gizlendi, açık kalmadı');
    o.kose.goster({ tur: 'bilgi', metin: 'C', simge: 'c' });
    assert.deepEqual(o.mesajlar(p).map((m) => m.metin), ['A', 'C'], 'sonraki bilgi kuyruğa gömülmedi, çizildi');
    assert.equal(p.gorunur, true);
  } finally {
    o.temizle();
  }
});

test('köşe bildirimi: çizilemeyen hata ikinci Windows bildirimi çıkarmaz (geriBildirim zaten gösterir), sıradaki bilgi gösterilir; çizilemeyen ok da çıkarmaz', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kose.goster({ tur: 'ok', metin: 'ilk' });
    await o.akit();
    const p = o.pencereler[0];
    const gercekSend = p.webContents.send.bind(p.webContents);
    let at = 2;
    p.webContents.send = (kanal, yuk) => {
      if (kanal === 'kose:goster' && yuk.metin !== 'son' && at > 0) {
        at -= 1;
        throw new Error('disposed');
      }
      gercekSend(kanal, yuk);
    };
    o.kose.goster({ tur: 'bilgi', metin: 'son', simge: 's' }); // ilk 'ok' görünürken sıraya girer
    o.kose.goster({ tur: 'ok', metin: 'tamam' }); // fırlatır: ok yedeğe düşmez; bilgiyi keser ve sıraya döndürür
    assert.deepEqual(o.yedekler, [], 'ok için Windows bildirimi yok');
    o.kose.goster({ tur: 'hata', metin: 'bozuk' }); // fırlatır: hata yedeğe düşmez (main.js geriBildirim hatayı zaten Windows bildirimi yapar)
    assert.deepEqual(o.yedekler, [], 'hata için ikinci Windows bildirimi yok');
    assert.ok(o.mesajlar(p).some((m) => m.metin === 'son'), 'sıradaki bilgi çizildi');
  } finally {
    o.temizle();
  }
});
