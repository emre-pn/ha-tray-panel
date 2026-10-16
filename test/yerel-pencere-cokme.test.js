'use strict';

/**
 * src/yerel-pencere.js: sayfa süreci çökmesi (render-process-gone) bildirimi (h-37). Electron çalıştırılmaz; `electron` modülü
 * bellek içi bir sahteyle değiştirilir. Kurtarma kararı çağıranındır (main.js, Ayarlar penceresi); fabrika yalnız olayı iletir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const YEREL_PENCERE = path.join(__dirname, '..', 'src', 'yerel-pencere.js');

function yerelPencereYukle() {
  class SahteWebContents extends EventEmitter {
    setWindowOpenHandler(isleyici) {
      this.pencereAcma = isleyici;
    }
  }
  class SahtePencere {
    constructor(secenekler) {
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
    }
  }
  const sahte = { app: { isPackaged: true }, BrowserWindow: SahtePencere };
  const orijinal = Module._load;
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahte : orijinal.call(this, istek, ...gerisi);
  };
  delete require.cache[YEREL_PENCERE];
  try {
    return require(YEREL_PENCERE);
  } finally {
    Module._load = orijinal;
    delete require.cache[YEREL_PENCERE];
  }
}

test('yerelPencereOlustur: cokunce verilirse render-process-gone ayrıntı ve pencereyle iletilir', () => {
  const { yerelPencereOlustur } = yerelPencereYukle();
  const cagrilar = [];
  const pencere = yerelPencereOlustur({ secenekler: { width: 100 }, cokunce: (ayrinti, p) => cagrilar.push([ayrinti, p]) });
  pencere.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(cagrilar.length, 1);
  assert.deepEqual(cagrilar[0][0], { reason: 'crashed' });
  assert.equal(cagrilar[0][1], pencere);
});

test('yerelPencereOlustur: ayrıntı gelmezse boş nesne verilir; kurtarma işlevi hata fırlatsa da uygulama düşmez', () => {
  const { yerelPencereOlustur } = yerelPencereYukle();
  let ayrinti = null;
  const pencere = yerelPencereOlustur({
    cokunce: (a) => {
      ayrinti = a;
      throw new Error('kurtarma hatası');
    },
  });
  assert.doesNotThrow(() => pencere.webContents.emit('render-process-gone', {}, undefined));
  assert.deepEqual(ayrinti, {});
});

test('yerelPencereOlustur: cokunce verilmezse render-process-gone dinleyicisi eklenmez; gezinme ve yeni pencere yine engellenir', () => {
  const { yerelPencereOlustur } = yerelPencereYukle();
  const pencere = yerelPencereOlustur({});
  assert.equal(pencere.webContents.listenerCount('render-process-gone'), 0);
  assert.deepEqual(pencere.webContents.pencereAcma({ url: 'https://ornek.example/' }), { action: 'deny' });
  let engellendi = 0;
  pencere.webContents.emit('will-navigate', { preventDefault: () => (engellendi += 1) });
  pencere.webContents.emit('will-redirect', { preventDefault: () => (engellendi += 1) });
  assert.equal(engellendi, 2);
});

test('yerelPencereOlustur: güvenli web tercihleri korunur (sandbox, contextIsolation, nodeIntegration kapalı)', () => {
  const { yerelPencereOlustur } = yerelPencereYukle();
  const tercihler = yerelPencereOlustur({ preload: 'x.js', cokunce: () => {} }).secenekler.webPreferences;
  assert.equal(tercihler.sandbox, true);
  assert.equal(tercihler.contextIsolation, true);
  assert.equal(tercihler.nodeIntegration, false);
  assert.equal(tercihler.preload, 'x.js');
});
