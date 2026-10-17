'use strict';

/**
 * Düğmeli itme bildirimi kartı köprüsü (o-61): ana süreçten gelen `itme:goster` iletisini dinletir, düğme sırasını ve kapatma isteğini
 * ana sürece iletir. Anahtarı, webhook kimliğini, URL'yi ya da eylem kimliklerini görmez; sandbox'ta yerel dosya require etmez.
 * Yalnız file: sayfasına açılır. IPC kanalları ana süreçte yerelOlaydanMi ile korunur (yalnız bu kartın sayfasına yanıt verir).
 */

const { contextBridge, ipcRenderer } = require('electron');

const tamsayi = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('evItme', {
    // Yük: { kartNo, baslik, mesaj, dugmeler: [başlık...], sureMs, malzeme, gorunum? }; metinler ana süreçte zaten seçili dilde yazılır.
    onGoster: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('itme:goster', dinleyici);
      return () => ipcRenderer.removeListener('itme:goster', dinleyici);
    },
    // Arayüz dili değişti: yük { dil }.
    onDilDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('dil:degisti', dinleyici);
      return () => ipcRenderer.removeListener('dil:degisti', dinleyici);
    },
    // Düğmeye basıldı: görünen kartın numarası ve düğme SIRASI (eylem kimliği ana süreçte kalır).
    eylem: (kartNo, sira) => (tamsayi(kartNo) && tamsayi(sira) ? ipcRenderer.invoke('itme:eylem', { kartNo, sira }) : Promise.resolve({ ok: false })),
    // × düğmesi: kartı kapat (HA'ya hiçbir şey gitmez).
    kapat: (kartNo) => (tamsayi(kartNo) ? ipcRenderer.invoke('itme:kapat', { kartNo }) : Promise.resolve({ ok: false })),
  });
}
