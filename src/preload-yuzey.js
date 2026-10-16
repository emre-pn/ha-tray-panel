'use strict';

/**
 * Hızlı panel / palet köprüsü (window.evYuzey): yalnız yuzey.html'in ihtiyaç duyduğu kanallar. Anahtarı, adresi ya da
 * başka bir IPC kanalını görmez; sandbox'ta yerel dosya require etmez. Köprü yalnız yerel (file:) sayfaya açılır; ana
 * süreçteki her işleyici ayrıca gönderenin yuzey.html olduğunu denetler (src/yuzey-yoneticisi.js).
 */

const { contextBridge, ipcRenderer } = require('electron');

function dinle(kanal, callback) {
  if (typeof callback !== 'function') return () => {};
  const dinleyici = (_olay, yuk) => callback(yuk);
  ipcRenderer.on(kanal, dinleyici);
  return () => ipcRenderer.removeListener(kanal, dinleyici);
}

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('evYuzey', {
    // Ana süreç modeli: { ok, mod, model, malzeme, dil?, gorunum? } (model: gruplar, sonlar, ust; src/lib/yuzey-modeli.js; gorunum: src/lib/gorunum.js)
    durumAl: () => ipcRenderer.invoke('yuzey:durum-al'),
    onDurum: (callback) => dinle('yuzey:durum', callback),
    // Yük: { mod: 'panel' | 'palet', malzeme, gorunum? } (pencere her gösterildiğinde)
    onGoster: (callback) => dinle('yuzey:goster', callback),
    // Arayüz dili değişti: yük { dil: 'tr' | 'en' | 'de' | 'fr' | 'es' }. Sayfa kendini yeniden çevirir (EvDil.sayfayiCevir).
    onDilDegisti: (callback) => dinle('dil:degisti', callback),
    // Yük: { kimlik, parlaklik?, kapat?, servis?, veri?, sonDeger?, araDeger?, basili? }; yanıt: { ok, tur?, neden?, ad? }
    // (1.4.0 servis eylemi: { kimlik, servis, veri } — doğrulama ana süreçteki eylem hattındadır)
    calistir: (yuk) => ipcRenderer.invoke('yuzey:calistir', yuk),
    // 1.4.0 okuma: { tur: 'gecmis'|'takvim'|'hava'|'yapilacak', ... }; yanıt: { ok, veri } (yalnız kayıtlı varlıklar; src/lib/ha-okuma.js)
    oku: (istek) => ipcRenderer.invoke('yuzey:oku', istek),
    // 1.4.0 bildirim şeridi: modeldeki (opak) öğe anahtarıyla kapatır; yanıt: { ok, tur? } (HA bildirimi HA'ya da gider)
    bildirimKapat: (anahtar) => ipcRenderer.invoke('yuzey:bildirim-kapat', anahtar),
    basiliBasla: (kimlik) => ipcRenderer.invoke('yuzey:basili-basla', kimlik),
    // Basılı tutma süre dolmadan bırakıldı: ana süreçteki başlangıç kaydı silinir (savunma derinliği)
    basiliBirak: (kimlik) => ipcRenderer.invoke('yuzey:basili-birak', kimlik),
    kapat: () => ipcRenderer.send('yuzey:kapat'),
    boyut: (yukseklik) => ipcRenderer.send('yuzey:boyut', Number(yukseklik)),
    haAc: () => ipcRenderer.invoke('yuzey:ha-ac'),
    ayarlarAc: () => ipcRenderer.invoke('yuzey:ayarlar-ac'),
    // 1.4.0 düzen (o-16): karoya sağ tık. Yük yalnız varlık kimliğidir; menüyü ana süreç kurar (Menu.popup), HA'ya bir şey gitmez.
    sagTik: (kimlik) => ipcRenderer.invoke('yuzey:sag-tik', kimlik),
  });
}
