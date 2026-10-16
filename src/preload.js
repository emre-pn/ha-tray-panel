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
    // Sürüm ve yenilikler (o-40): kayıtlı bilgi (ağa çıkmaz), elle denetim (seçenek kapalıyken ağa ÇIKMAZ), paketli sürüm notları ve
    // sürüm sayfasını varsayılan tarayıcıda açma (kullanıcı düğmesi). Adres/yol renderer'dan gitmez; ana süreç sabit adresi açar.
    surumDurumu: () => ipcRenderer.invoke('surum:durum'),
    surumuDenetle: () => ipcRenderer.invoke('surum:denetle'),
    yenilikleriGetir: () => ipcRenderer.invoke('surum:yenilikler'),
    surumSayfasiniAc: () => ipcRenderer.invoke('surum:sayfa-ac'),
    // Tanılama raporu (o-41): rapor metni ana süreçte kurulur (anahtar yok, adres yalnız sınıf olarak, günlük satırları maskeli). tanilamaGetir
    // yalnız önizleme verir; tanilamaKopyala aynı metni panoya yazar ve geri verir. Günlük klasörünü ana süreç açar (yol arayüze verilmez).
    tanilamaGetir: () => ipcRenderer.invoke('tanilama:getir'),
    tanilamaKopyala: () => ipcRenderer.invoke('tanilama:kopyala'),
    gunlukKlasoruAc: () => ipcRenderer.invoke('gunluk:klasor-ac'),
    // Odadan ilk kurulum (o-44): HA'daki odalar ve her odanın önerilen güvenli cihazları (yalnız okur; canlı bağlantı gerekir). Öneriyi favori
    // seçimine eklemek ve kaydetmek sayfanın ve kullanıcının işidir (favorileriKaydet); bu çağrı hiçbir şey yazmaz.
    odalariGetir: () => ipcRenderer.invoke('odalar:getir'),
    // Ana süreç belirli bir Ayarlar bölümünün açılmasını ister (tepsi "Yenilikler"): yük { bolum: 'bolumSurum' | 'bolumAraclar' }.
    onBolumAc: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('ayarlar:bolum-ac', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:bolum-ac', dinleyici);
    },
    // Favori listesi ana süreçte değişti (hazır karoların yeniden denemesi, h-27): Ayarlar listeyi tazeler.
    onFavorilerDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('ayarlar:favoriler-degisti', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:favoriler-degisti', dinleyici);
    },

    // --- Düzen (1.4.0 düzen grubu: o-16, o-28, o-30) ---
    // Düzen geçmişi: son 20 favori + sayfa düzeni anlık görüntüsü (yalnız zaman, neden, sayılar); yanıt { ok, noktalar }
    duzenGecmisiniGetir: () => ipcRenderer.invoke('duzen:gecmis'),
    // Geçmiş noktasına dön (id: tam sayı); yanıt { ok, favoriSayisi?, sayfaSayisi?, atilan?, hata? }
    duzeneDon: (id) => ipcRenderer.invoke('duzen:don', id),
    // HA'da bulunamayan favoriyi seçilen cihaza bağla (eski ve yeni varlık kimliği); yanıt { ok, favoriSayisi?, neden?, hata? }
    favoriyiOnar: (eski, yeni) => ipcRenderer.invoke('favoriler:onar', eski, yeni),
    // Panelde karo menüsünden "Düzenle…": yük varlık kimliği (Ayarlar o favoriye odaklanır)
    onFavoriyeGit: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, kimlik) => callback(kimlik);
      ipcRenderer.on('ayarlar:favoriye-git', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:favoriye-git', dinleyici);
    },
  });
}
