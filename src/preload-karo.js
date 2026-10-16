'use strict';

/**
 * Masaüstü karosu köprüsü (window.evKaro, o-33): yalnız masaustu-karo.html'in ihtiyaç duyduğu kanallar. Anahtarı, adresi ya da
 * başka bir IPC kanalını görmez; sandbox'ta yerel dosya require etmez. Köprü yalnız yerel (file:) sayfaya açılır; ana
 * süreçteki her işleyici ayrıca gönderenin bu karonun penceresi ve masaustu-karo.html olduğunu denetler (src/masaustu-karolari.js).
 * Karonun kimliği sayfadan GİTMEZ: ana süreç hangi pencerenin hangi karoya ait olduğunu kendisi bilir.
 */

const { contextBridge, ipcRenderer } = require('electron');

function dinle(kanal, callback) {
  if (typeof callback !== 'function') return () => {};
  const dinleyici = (_olay, yuk) => callback(yuk);
  ipcRenderer.on(kanal, dinleyici);
  return () => ipcRenderer.removeListener(kanal, dinleyici);
}

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('evKaro', {
    // Yanıt: { ok, model, malzeme, dil? } (model: src/lib/masaustu-karo.js masaustuKaroModeli)
    durumAl: () => ipcRenderer.invoke('karo:durum-al'),
    // Karo değişti: yük { model, malzeme }
    onDurum: (callback) => dinle('karo:durum', callback),
    // Arayüz dili değişti: yük { dil: 'tr' | 'en' | 'de' | 'fr' | 'es' }. Sayfa kendini yeniden çevirir (EvDil.sayfayiCevir).
    onDilDegisti: (callback) => dinle('dil:degisti', callback),
    // Yük: { tur: 'tikla' } ya da { parlaklik: 25 | 50 | 100 }; yanıt: { ok, tur? }. Onay gerektiren eylem çalışmaz (kaynak 'masaustu').
    calistir: (yuk) => ipcRenderer.invoke('karo:calistir', yuk),
    // Karoyu masaüstünden kaldır (ayardaki sabitleme listesinden çıkar)
    kaldir: () => ipcRenderer.send('karo:kaldir'),
  });
}
