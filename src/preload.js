'use strict';

/**
 * Ev Paneli — Preload Script
 *
 * contextIsolation: true, nodeIntegration: false, sandbox: true
 * Sadece offline.html ve ayarlar.html sayfalarının ihtiyaç duyduğu
 * güvenli IPC köprü fonksiyonlarını window.evPaneli altına açar.
 *
 * Ana pencerenin preload'u uzak Home Assistant sayfasına da yüklenir; köprü yalnız yerel (file:) sayfalara
 * açılır, uzak sayfa window.evPaneli'yi hiç görmez (hata-17). Ana süreçteki işleyiciler ayrıca gönderenin yerel
 * sayfa olduğunu denetler.
 */

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('evPaneli', {
    // --- Bağlantı / Offline Sayfası İşlemleri ---
    tekrarDene: () => ipcRenderer.invoke('baglanti:tekrar-dene'),
    ayarlariAc: () => ipcRenderer.invoke('ayarlar:ac'),
    // Yük: 'deneniyor' (metin) ya da { durum, sn, hata, yerel, dis } (nesne; sayfa yerinde güncellenir).
    onBaglantiDurum: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, durum) => callback(durum);
      ipcRenderer.on('baglanti:durum', dinleyici);
      return () => ipcRenderer.removeListener('baglanti:durum', dinleyici);
    },

    // --- Ayarlar Sayfası İşlemleri ---
    ayarlariGetir: () => ipcRenderer.invoke('ayarlar:getir'),
    ayarlariKaydet: (yeniAyarlar) => ipcRenderer.invoke('ayarlar:kaydet', yeniAyarlar),
    otomatikBaslatEtkinlestir: () => ipcRenderer.invoke('otomatik-baslat:etkinlestir'),
    // secenek.bilet: Ayarlar'daki AÇIK ikinci onay için sunucunun verdiği tek kullanımlık bilet (onayGerekli yanıtında gelir; aday ve sayaca bağlıdır)
    anahtarKaydet: (anahtar, secenek) => ipcRenderer.invoke('anahtar:kaydet', anahtar, secenek),
    anahtarSil: () => ipcRenderer.invoke('anahtar:sil'),
    // Yetki kesici (1.1.1): "Yeniden dene" = kullanıcı onayı (doğrulanamadı / ev içi 403 durumlarında TEK yeni deneme)
    yetkiYenidenDene: (secenek) => ipcRenderer.invoke('yetki:yeniden-dene', secenek),
    cihazlariGetir: () => ipcRenderer.invoke('cihazlar:getir'),
    // Yük: [{ entity_id, onay? }] (düz kimlik listesi de kabul edilir)
    favorileriKaydet: (favoriler) => ipcRenderer.invoke('favoriler:kaydet', favoriler),
    // Hazır ilk karoları (hiz-07) yeniden uygular: HA'da bulunan eksikler eklenir, mevcut favorilere dokunulmaz.
    hazirListeyiUygula: () => ipcRenderer.invoke('favoriler:hazir-liste'),
    // Bağlantıyı sına (k-14): kaydedilmemiş adres, ANAHTAR GÖNDERİLMEDEN yoklanır. tur: 'yerel' | 'dis'
    adresSina: (adres, tur) => ipcRenderer.invoke('ayarlar:adres-sina', adres, tur),
    // Ana pencerede açık HA sayfasının yolu ve adı (k-18, "Açık sayfayı ekle")
    acikSayfa: () => ipcRenderer.invoke('ayarlar:aciksayfa'),
    // Dışa/içe aktarma ve yedekten dönme (k-13): dosya yolunu ana süreç seçtirir; anahtar hiçbir yönde taşınmaz.
    ayarlariDisaAktar: () => ipcRenderer.invoke('ayarlar:disa-aktar'),
    ayarlariIceAktar: () => ipcRenderer.invoke('ayarlar:ice-aktar'),
    yedekleriGetir: () => ipcRenderer.invoke('ayarlar:yedekler'),
    yedektenDon: (ad) => ipcRenderer.invoke('ayarlar:yedekten-don', ad),
    // Arayüz dili değişti (Ayarlar'dan ya da ana süreçte): yük { dil: 'tr' | 'en' }. Sayfa kendini yeniden çevirir (EvDil.sayfayiCevir).
    onDilDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('dil:degisti', dinleyici);
      return () => ipcRenderer.removeListener('dil:degisti', dinleyici);
    },
    // Favori listesi ana süreçte değişti (hazır karoların yeniden denemesi, h-27): Ayarlar listeyi tazeler.
    onFavorilerDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('ayarlar:favoriler-degisti', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:favoriler-degisti', dinleyici);
    },
  });
}
