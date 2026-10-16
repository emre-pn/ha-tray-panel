'use strict';

/**
 * Köşe bildirimi köprüsü: yalnız ana süreçten gelen `kose:goster` iletilerini dinletir.
 * Anahtarı, URL'yi ya da başka bir IPC kanalını görmez; sandbox'ta yerel dosya require etmez.
 */

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('evKose', {
    // Yük: { tur: 'ok' | 'hata', metin, sureMs, malzeme }; metin ana süreçte zaten seçili dilde yazılır
    onGoster: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('kose:goster', dinleyici);
      return () => ipcRenderer.removeListener('kose:goster', dinleyici);
    },
    // Arayüz dili değişti: yük { dil: 'tr' | 'en' }.
    onDilDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('dil:degisti', dinleyici);
      return () => ipcRenderer.removeListener('dil:degisti', dinleyici);
    },
  });
}
