'use strict';

/**
 * Yerel (file:) pencereler için ortak altyapı: güvenli web tercihleri, gönderen denetimi ve pencere fabrikası.
 * Ayarlar, köşe bildirimi (ve ileride palet/panel) bu dosyayı kullanır; HA içeriği gösteren pencereler yalnız
 * guvenliWebTercihleri'ni paylaşır (main.js, haGezinmeKorumalari).
 *
 * Kurallar: contextIsolation + sandbox, nodeIntegration kapalı, yalnız loadFile ile yerel sayfa, gezinme ve yeni
 * pencere yok, her HTML katı CSP'li ve harici betikli, renderer'a anahtar/URL gitmez.
 */

const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

function guvenliWebTercihleri(ek = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    devTools: !app.isPackaged,
    ...ek,
  };
}

function dosyaUrlEslesir(url, dosya) {
  try {
    const gelen = new URL(url);
    if (gelen.protocol !== 'file:') return false;
    const beklenen = pathToFileURL(dosya);
    return decodeURIComponent(gelen.pathname).toLowerCase() === decodeURIComponent(beklenen.pathname).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * IPC isteği, `pencere` içinde yüklü `dosya` sayfasının ana çerçevesinden mi geldi?
 * (Uzak HA sayfası ya da başka bir alt çerçeve bu kanalları çağıramaz.)
 */
function yerelOlaydanMi(olay, pencere, dosya) {
  if (!pencere || pencere.isDestroyed() || olay.sender !== pencere.webContents) return false;
  const cerceve = olay.senderFrame;
  if (!cerceve || cerceve.parent) return false;
  return dosyaUrlEslesir(cerceve.url, dosya);
}

/**
 * Yerel sayfa penceresi oluşturur (yüklemeyi çağıran `loadFile` ile yapar). Gezinme, yönlendirme ve yeni pencere
 * açma engellenir.
 * @param {{ preload?: string, secenekler?: object, cokunce?: (ayrinti: {reason?: string}, pencere: object) => void }} girdi
 *   cokunce: sayfa süreci çöktüğünde ('render-process-gone') çağrılır (h-37: Ayarlar penceresi kurtarması); karar çağıranındır,
 *   fabrika yalnız olayı iletir. Çağıran hata fırlatsa da yutulur.
 */
function yerelPencereOlustur({ preload, secenekler = {}, cokunce }) {
  const pencere = new BrowserWindow({
    ...secenekler,
    webPreferences: guvenliWebTercihleri(preload ? { preload } : {}),
  });
  const wc = pencere.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (olay) => olay.preventDefault());
  wc.on('will-redirect', (olay) => olay.preventDefault());
  if (typeof cokunce === 'function') {
    wc.on('render-process-gone', (_olay, ayrinti) => {
      try {
        cokunce(ayrinti ?? {}, pencere);
      } catch {
        /* kurtarma hatası uygulamayı düşürmesin */
      }
    });
  }
  return pencere;
}

/**
 * Çalışan yerel pencerenin arka plan malzemesini değiştirir (Ayarlar > Görünüm; gorunum-11). Desteklenmeyen sistemde ya da
 * yok edilmiş pencerede sessizce atlanır.
 * @param {{ secenekler: { backgroundColor: string, backgroundMaterial?: string } }} malzeme src/lib/malzeme.js pencereMalzemesi()
 * @returns {boolean} uygulandı mı
 */
function malzemeUygula(pencere, malzeme) {
  if (!pencere || pencere.isDestroyed()) return false;
  try {
    pencere.setBackgroundColor(malzeme.secenekler.backgroundColor);
    if (typeof pencere.setBackgroundMaterial === 'function') pencere.setBackgroundMaterial(malzeme.secenekler.backgroundMaterial ?? 'none');
    return true;
  } catch {
    return false;
  }
}

module.exports = { guvenliWebTercihleri, dosyaUrlEslesir, yerelOlaydanMi, yerelPencereOlustur, malzemeUygula };
