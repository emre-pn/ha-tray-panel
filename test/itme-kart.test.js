'use strict';

/**
 * Düğmeli itme bildirimi kartı (src/itme-kart.js, o-61): sahte Electron ile, hiçbir pencere açılmadan.
 * Kart odak almadan açılır, sayfaya yalnız düğme BAŞLIKLARI gider, düğmeler tek kullanımlıktır, pencere bozulursa ileti Windows bildirimine düşer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const KOK = path.join(__dirname, '..', 'src');

function onbellegiTemizle() {
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(KOK + path.sep)) delete require.cache[anahtar];
  }
}

/** Sahte Electron + kart modülü. `yuklemeSonucu`: loadFile sonucu ('tamam' | 'red' | 'bekle'); `olusturmaHatasi`: BrowserWindow kurucusu fırlatır. */
function kur({ yuklemeSonucu = 'tamam', olusturmaHatasi = false, dilAl, gorunumAl, metinOlcegiAl, engelAl, malzemeAl } = {}) {
  const pencereler = [];
  class SahteWebContents extends EventEmitter {
    constructor() {
      super();
      this.mesajlar = [];
      this.zoomlar = [];
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
      if (olusturmaHatasi) throw new Error('pencere kurulamadı');
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
      this.yikik = false;
      this.gorunur = false;
      this.cagri = { showInactive: 0, show: 0, focus: 0, hide: 0 };
      this.malzemeler = [];
      this.arkaPlanRenkleri = [];
      this.sinirlar = [];
      this.ust = [];
      this.yuklenenDosya = null;
      pencereler.push(this);
    }

    loadFile(dosya) {
      this.yuklenenDosya = dosya;
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
      this.cagri.showInactive += 1;
    }

    show() {
      this.gorunur = true;
      this.cagri.show += 1;
    }

    focus() {
      this.cagri.focus += 1;
    }

    hide() {
      this.gorunur = false;
      this.cagri.hide += 1;
    }

    setBackgroundMaterial(m) {
      this.malzemeler.push(m);
    }

    setBackgroundColor(r) {
      this.arkaPlanRenkleri.push(r);
    }

    setBounds(s) {
      this.sinirlar.push(s);
    }

    setAlwaysOnTop(deger, seviye) {
      this.ust.push([deger, seviye]);
    }
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
    modul = require(path.join(KOK, 'itme-kart.js'));
  } finally {
    Module._load = orijinalYukle;
  }
  const gunlukler = [];
  const yedekler = [];
  const kart = modul.itmeKartiOlustur({
    gunluk: (m) => gunlukler.push(m),
    yedekGoster: (b) => yedekler.push(b),
    varsayilanBaslikAl: () => 'Ev Paneli',
    ...(dilAl ? { dilAl } : {}),
    ...(gorunumAl ? { gorunumAl } : {}),
    ...(metinOlcegiAl ? { metinOlcegiAl } : {}),
    ...(engelAl ? { engelAl } : {}),
    ...(malzemeAl ? { malzemeAl } : {}),
  });
  const akit = () => new Promise((coz) => setImmediate(coz));
  const mesajlar = (p) => p.webContents.mesajlar.filter((m) => m.kanal === 'itme:goster').map((m) => m.yuk);
  const olay = (p, dosya = modul.ITME_HTML) => ({ sender: p.webContents, senderFrame: { url: pathToFileURL(dosya).href, parent: null } });
  return { kart, modul, pencereler, gunlukler, yedekler, akit, mesajlar, olay, temizle: () => { kart.kapat(); onbellegiTemizle(); } };
}

const bildirim = (mesaj, ek = {}) => ({ baslik: null, mesaj, etiket: null, dugmeler: [{ eylem: 'ONAYLA_42', baslik: 'Onayla' }, { eylem: 'ERTELE_7', baslik: 'Ertele' }], ...ek });

test('kart: yükleme bitince gösterilir; odak ALMAZ; yük yalnız başlık, ileti ve düğme BAŞLIKLARINI taşır (eylem kimliği yok)', async () => {
  const o = kur();
  try {
    assert.equal(o.kart.goster(bildirim('Hareket algılandı')), true);
    await o.akit();
    assert.equal(o.pencereler.length, 1);
    const p = o.pencereler[0];
    assert.equal(p.yuklenenDosya, o.modul.ITME_HTML);
    assert.equal(p.cagri.showInactive, 1);
    assert.equal(p.cagri.focus, 0);
    assert.equal(p.cagri.show, 0);
    assert.deepEqual(o.mesajlar(p), [{ kartNo: 1, baslik: 'Ev Paneli', mesaj: 'Hareket algılandı', dugmeler: ['Onayla', 'Ertele'], sureMs: 45000, malzeme: 'yok' }]);
    assert.doesNotMatch(JSON.stringify(p.webContents.mesajlar), /ONAYLA_42|ERTELE_7/);
    assert.deepEqual(p.ust.at(-1), [true, 'screen-saver']);
    assert.equal(o.kart.gorunen().kartNo, 1);
  } finally {
    o.temizle();
  }
});

test('kart penceresi güvenli: çerçevesiz, görev çubuğunda yok, üstte, contextIsolation+sandbox, yalnız preload-itme.js', async () => {
  const o = kur();
  try {
    o.kart.goster(bildirim('x'));
    const s = o.pencereler[0].secenekler;
    assert.equal(s.show, false);
    assert.equal(s.frame, false);
    assert.equal(s.skipTaskbar, true);
    assert.equal(s.alwaysOnTop, true);
    assert.equal(s.resizable, false);
    assert.deepEqual([s.width, s.height], [o.modul.KART_BOYUTU.width, o.modul.KART_BOYUTU.height]);
    assert.equal(s.webPreferences.contextIsolation, true);
    assert.equal(s.webPreferences.nodeIntegration, false);
    assert.equal(s.webPreferences.sandbox, true);
    assert.equal(path.basename(s.webPreferences.preload), 'preload-itme.js');
    assert.notEqual(s.focusable, false, 'düğmelere basılabilmesi için odaklanabilir');
  } finally {
    o.temizle();
  }
});

test('konum: köşe bildiriminin ÜSTÜNDE (çakışmaz); açık panel varsa onun da üstüne kayar', async () => {
  const o = kur();
  try {
    o.kart.goster(bildirim('x'));
    await o.akit();
    const { y, height, x, width } = o.pencereler[0].sinirlar.at(-1);
    const { KOSE_BOYUTU, KOSE_MARJI } = require('../src/lib/pencere-yerlesim');
    const koseUstu = 1040 - KOSE_BOYUTU.height - KOSE_MARJI;
    assert.ok(y + height <= koseUstu, `kart (${y + height}) köşe bildiriminin (${koseUstu}) altına inmemeli`);
    assert.equal(x + width, 1920 - KOSE_MARJI);
  } finally {
    o.temizle();
  }
  const engelli = kur({ engelAl: () => ({ x: 1500, y: 600, width: 400, height: 420 }) });
  try {
    engelli.kart.goster(bildirim('x'));
    await engelli.akit();
    const { y, height } = engelli.pencereler[0].sinirlar.at(-1);
    assert.ok(y + height <= 600, 'açık panelin üstünde');
  } finally {
    engelli.temizle();
  }
});

test('metin ölçeği: ölçek > 1 ise pencere büyür ve yakınlaştırma uygulanır; geçersiz ölçek 1 sayılır', async () => {
  const o = kur({ metinOlcegiAl: () => 1.5 });
  try {
    o.kart.goster(bildirim('x'));
    await o.akit();
    const p = o.pencereler[0];
    assert.deepEqual([p.sinirlar.at(-1).width, p.sinirlar.at(-1).height], [540, 264]);
    assert.deepEqual(p.webContents.zoomlar, [1.5]);
  } finally {
    o.temizle();
  }
  const kotu = kur({ metinOlcegiAl: () => 'x' });
  try {
    kotu.kart.goster(bildirim('x'));
    await kotu.akit();
    assert.deepEqual(kotu.pencereler[0].webContents.zoomlar, []);
    assert.equal(kotu.pencereler[0].sinirlar.at(-1).width, 360);
  } finally {
    kotu.temizle();
  }
});

test('eylemSec: yalnız görünen kartın geçerli düğme sırası kabul edilir; kimlik ana süreçte kalır; kart kapanır ve tek kullanımlıktır', async () => {
  const o = kur();
  try {
    o.kart.goster(bildirim('Hareket', { etiket: 'hareket' }));
    await o.akit();
    const p = o.pencereler[0];
    for (const [no, sira] of [[2, 0], [1, 2], [1, -1], [1, 0.5], ['1', 0], [null, 0], [undefined, undefined]]) assert.equal(o.kart.eylemSec(no, sira), null, `${no}/${sira}`);
    assert.equal(p.gorunur, true);
    assert.deepEqual(o.kart.eylemSec(1, 1), { eylem: 'ERTELE_7', etiket: 'hareket' });
    assert.equal(p.gorunur, false, 'basılınca kart gizlenir');
    assert.equal(o.kart.eylemSec(1, 1), null, 'ikinci basış');
    assert.equal(o.kart.eylemSec(1, 0), null);
    assert.equal(o.kart.gorunen(), null);
  } finally {
    o.temizle();
  }
});

test('sıra: ikinci bildirim beklemeye girer; birincisi kapanınca görünür; aynı etiket görünen kartın yerine geçer', async () => {
  const o = kur();
  try {
    o.kart.goster(bildirim('Birinci', { etiket: 'a' }));
    o.kart.goster(bildirim('İkinci', { etiket: 'b' }));
    await o.akit();
    const p = o.pencereler[0];
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Birinci']);
    assert.equal(o.kart.kapatIstegi(99), false, 'yanlış numara');
    assert.equal(o.kart.kapatIstegi(1), true);
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Birinci', 'İkinci']);
    assert.equal(p.gorunur, true);
    o.kart.goster(bildirim('İkinci yeni', { etiket: 'b' }));
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Birinci', 'İkinci', 'İkinci yeni']);
    assert.equal(o.pencereler.length, 1, 'tek pencere yeniden kullanılır');
    o.kart.temizle('b');
    assert.equal(p.gorunur, false);
    assert.equal(o.kart.gorunen(), null);
  } finally {
    o.temizle();
  }
});

test('süre dolması: 45 sn sonra kart kapanır, HA\'ya hiçbir şey gitmez (eylem döndürmez); sıradaki kart görünür', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kart.goster(bildirim('Birinci'));
    o.kart.goster(bildirim('İkinci'));
    await o.akit();
    const p = o.pencereler[0];
    t.mock.timers.tick(44_999);
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Birinci']);
    t.mock.timers.tick(1);
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Birinci', 'İkinci']);
    t.mock.timers.tick(45_000);
    assert.equal(p.gorunur, false);
    assert.equal(o.kart.gorunen(), null);
    assert.deepEqual(o.yedekler, []);
  } finally {
    o.temizle();
  }
});

test('hepsiniKapat ve kapat: kartlar kalkar, süre zamanlayıcısı temizlenir; kapat pencereyi yok eder ve yedek tetiklemez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = kur();
  try {
    o.kart.goster(bildirim('Birinci'));
    o.kart.goster(bildirim('İkinci'));
    await o.akit();
    const p = o.pencereler[0];
    o.kart.hepsiniKapat();
    assert.equal(p.gorunur, false);
    assert.equal(o.kart.gorunen(), null);
    assert.equal(o.kart.eylemSec(1, 0), null);
    t.mock.timers.tick(60_000);
    assert.equal(o.mesajlar(p).length, 1, 'sıradaki kart geri gelmedi');
    o.kart.kapat();
    assert.equal(p.yikik, true);
    assert.deepEqual(o.yedekler, []);
    assert.deepEqual(o.gunlukler, []);
  } finally {
    o.temizle();
  }
});

test('sayfa süreci çökerse görünen ve bekleyen kartlar Windows bildirimine (yedek) düşer, bir kez; sonraki bildirim yeni pencerede açılır', async () => {
  const o = kur();
  try {
    o.kart.goster(bildirim('Birinci'));
    o.kart.goster(bildirim('İkinci'));
    await o.akit();
    const ilk = o.pencereler[0];
    ilk.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
    assert.equal(ilk.yikik, false, 'normal kapanış sıfırlamaz');
    ilk.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(ilk.yikik, true);
    assert.deepEqual(o.yedekler.map((b) => b.mesaj), ['Birinci', 'İkinci']);
    assert.ok(o.gunlukler.some((m) => /sıfırlandı \(sayfa-sureci-kapandi:crashed\)/.test(m)));
    ilk.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(o.yedekler.length, 2, 'ikinci olay tekrar yedeklemez');
    o.kart.goster(bildirim('Üçüncü'));
    await o.akit();
    assert.equal(o.pencereler.length, 2);
    assert.deepEqual(o.mesajlar(o.pencereler[1]).map((m) => m.mesaj), ['Üçüncü']);
  } finally {
    o.temizle();
  }
});

test('ana çerçeve yüklenemezse ya da loadFile reddedilirse bekleyen kart yedeğe düşer; alt çerçeve/iptal sıfırlamaz', async () => {
  const bekleyen = kur({ yuklemeSonucu: 'bekle' });
  try {
    bekleyen.kart.goster(bildirim('Yüklenmeyen'));
    const p = bekleyen.pencereler[0];
    p.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', false);
    p.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///x', true);
    assert.equal(p.yikik, false);
    p.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
    assert.equal(p.yikik, true);
    assert.deepEqual(bekleyen.yedekler.map((b) => b.mesaj), ['Yüklenmeyen']);
    assert.ok(bekleyen.gunlukler.some((m) => /sayfa-yuklenemedi:-6/.test(m)));
  } finally {
    bekleyen.temizle();
  }
  const red = kur({ yuklemeSonucu: 'red' });
  try {
    red.kart.goster(bildirim('Reddedilen'));
    await red.akit();
    assert.equal(red.pencereler[0].yikik, true);
    assert.deepEqual(red.yedekler.map((b) => b.mesaj), ['Reddedilen']);
    assert.ok(red.gunlukler.some((m) => /yukleme-reddedildi/.test(m)));
  } finally {
    red.temizle();
  }
});

test('pencere hiç kurulamazsa (BrowserWindow fırlatır) bildirim kaybolmaz: Windows bildirimine düşer, sıradaki de', async () => {
  const o = kur({ olusturmaHatasi: true });
  try {
    assert.equal(o.kart.goster(bildirim('Birinci')), true);
    assert.equal(o.kart.goster(bildirim('İkinci')), true);
    assert.deepEqual(o.yedekler.map((b) => b.mesaj), ['Birinci', 'İkinci']);
    assert.equal(o.kart.gorunen(), null);
    assert.ok(o.gunlukler.includes('İtme kartı penceresi oluşturulamadı.'));
  } finally {
    o.temizle();
  }
});

test('olaydanMi: yalnız kartın kendi penceresinin ana çerçevesindeki itme-kart.html sayfası; uzak sayfa, alt çerçeve, başka dosya ve pencere yokken false', async () => {
  const o = kur();
  try {
    assert.equal(o.kart.olaydanMi({ sender: {}, senderFrame: { url: pathToFileURL(o.modul.ITME_HTML).href, parent: null } }), false, 'pencere yok');
    o.kart.goster(bildirim('x'));
    await o.akit();
    const p = o.pencereler[0];
    assert.equal(o.kart.olaydanMi(o.olay(p)), true);
    assert.equal(o.kart.olaydanMi({ sender: p.webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } }), false);
    assert.equal(o.kart.olaydanMi({ sender: p.webContents, senderFrame: { url: pathToFileURL(o.modul.ITME_HTML).href, parent: {} } }), false);
    assert.equal(o.kart.olaydanMi(o.olay(p, path.join(KOK, 'ayarlar.html'))), false);
    assert.equal(o.kart.olaydanMi({ sender: new EventEmitter(), senderFrame: { url: pathToFileURL(o.modul.ITME_HTML).href, parent: null } }), false);
    assert.equal(o.kart.olaydanMi({ sender: p.webContents, senderFrame: null }), false);
  } finally {
    o.temizle();
  }
});

test('dil ve görünüm: sayfa yüklenince etkin dil gönderilir; dilDegisti yeniden gönderir; görünüm modeli yüke eklenir; malzeme değişimi uygulanır', async () => {
  let dil = 'tr';
  const o = kur({ dilAl: () => dil, gorunumAl: () => ({ vurgu: '#112233' }), malzemeAl: () => ({ malzeme: 'mica', secenekler: { backgroundColor: '#101010', backgroundMaterial: 'mica' } }) });
  try {
    o.kart.goster(bildirim('x'));
    await o.akit();
    const p = o.pencereler[0];
    assert.deepEqual(p.webContents.mesajlar.filter((m) => m.kanal === 'dil:degisti'), [{ kanal: 'dil:degisti', yuk: { dil: 'tr' } }]);
    assert.deepEqual(o.mesajlar(p)[0].gorunum, { vurgu: '#112233' });
    assert.equal(o.mesajlar(p)[0].malzeme, 'mica');
    dil = 'de';
    o.kart.dilDegisti();
    assert.deepEqual(p.webContents.mesajlar.filter((m) => m.kanal === 'dil:degisti').at(-1).yuk, { dil: 'de' });
    o.kart.malzemeyiUygula();
    assert.deepEqual(p.arkaPlanRenkleri.at(-1), '#101010');
    assert.deepEqual(p.malzemeler.at(-1), 'mica');
  } finally {
    o.temizle();
  }
  // pencere yokken zararsız
  const bos = kur();
  try {
    bos.kart.dilDegisti();
    bos.kart.malzemeyiUygula();
    bos.kart.hepsiniKapat();
    bos.kart.temizle('yok');
    assert.equal(bos.pencereler.length, 0);
  } finally {
    bos.temizle();
  }
});

test('görünüm/ölçek/engel okuyucuları hata fırlatsa da kart gösterilir', async () => {
  const o = kur({
    gorunumAl: () => {
      throw new Error('x');
    },
    metinOlcegiAl: () => {
      throw new Error('y');
    },
    engelAl: () => {
      throw new Error('z');
    },
  });
  try {
    o.kart.goster(bildirim('Yine de görünür'));
    await o.akit();
    assert.deepEqual(o.mesajlar(o.pencereler[0]).map((m) => m.mesaj), ['Yine de görünür']);
  } finally {
    o.temizle();
  }
});

test('kaynak: kart modülü ağa çıkmaz, yerel dosya dışında bir şey yüklemez, kimlik/anahtar taşımaz', () => {
  const fs = require('node:fs');
  const kaynak = fs.readFileSync(path.join(KOK, 'itme-kart.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(kaynak, /\bfetch\(|loadURL|net\.|http:|https:|webhook|Authorization|shell\.|openExternal|child_process/);
  assert.equal((kaynak.match(/loadFile\(/g) ?? []).length, 1);
});

test('konum: metin ölçeği büyüyünce köşe bildirimi de büyür; kart onunla ÇAKIŞMAZ (ölçeklenmiş köşe yüksekliği + boşluk)', async () => {
  const { KOSE_BOYUTU, koseKonumu } = require('../src/lib/pencere-yerlesim');
  const alan = { x: 0, y: 0, width: 1920, height: 1040 };
  for (const olcek of [1, 1.3, 1.5]) {
    const o = kur({ metinOlcegiAl: () => olcek });
    try {
      o.kart.goster(bildirim('x'));
      await o.akit();
      const { y, height } = o.pencereler[0].sinirlar.at(-1);
      const kose = koseKonumu(alan, { width: KOSE_BOYUTU.width * olcek, height: KOSE_BOYUTU.height * olcek });
      assert.ok(y + height <= kose.y - 12, `ölçek ${olcek}: kart (${y + height}) ölçeklenmiş köşe bildiriminin (${kose.y}) 12 px üstünde olmalı`);
    } finally {
      o.temizle();
    }
  }
});

test('konum: kart panelin yanına (başka sütuna) taşındıysa köşe bildirimi onu yukarı itmez; aynı sütundaysa bildirimin üstünde kalır', async () => {
  // Panel yukarıya kadar uzanır: kart üstüne sığmaz, soluna yerleşir; küçük köşe bildirimi ise panelin üstüne sığar (başka sütun)
  const uzunPanel = kur({ engelAl: () => ({ x: 1500, y: 100, width: 400, height: 940 }) });
  try {
    uzunPanel.kart.goster(bildirim('x'));
    await uzunPanel.akit();
    const { x, y, height } = uzunPanel.pencereler[0].sinirlar.at(-1);
    assert.equal(x, 1500 - 360 - 8, 'panelin solunda');
    assert.equal(y + height, 1040 - 16, 'çalışma alanının alt kenarına oturur, boşuna yukarı itilmez');
  } finally {
    uzunPanel.temizle();
  }
  const kisaPanel = kur({ engelAl: () => ({ x: 1500, y: 600, width: 400, height: 420 }) });
  try {
    kisaPanel.kart.goster(bildirim('x'));
    await kisaPanel.akit();
    const { y, height } = kisaPanel.pencereler[0].sinirlar.at(-1);
    const { KOSE_BOYUTU } = require('../src/lib/pencere-yerlesim');
    assert.equal(y + height, 600 - 8 - KOSE_BOYUTU.height - 12, 'panelin üstünde, köşe bildiriminin de üstünde');
  } finally {
    kisaPanel.temizle();
  }
});

test('yükleme beklerken HA kartı temizlerse (gizle) bekleyen kart sıfırlanır; sayfa yüklenince eski kart çıkmaz', async () => {
  const o = kur({ yuklemeSonucu: 'bekle' });
  try {
    o.kart.goster(bildirim('Hareket', { etiket: 'hareket' }));
    const p = o.pencereler[0];
    o.kart.temizle('hareket');
    p.webContents.emit('did-finish-load');
    await o.akit();
    assert.deepEqual(o.mesajlar(p), [], 'temizlenen kart sayfa yüklenince görünmedi');
    assert.equal(p.gorunur, false);
    o.kart.goster(bildirim('Yeni', { etiket: 'yeni' }));
    assert.deepEqual(o.mesajlar(p).map((m) => m.mesaj), ['Yeni'], 'sonraki kart normal gösterilir');
  } finally {
    o.temizle();
  }
});
