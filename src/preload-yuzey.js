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
    // Ana süreç modeli: { ok, mod, model, malzeme, dil?, gorunum?, etkilesim? } (model: gruplar, sonlar, ust; src/lib/yuzey-modeli.js; gorunum: src/lib/gorunum.js)
    durumAl: () => ipcRenderer.invoke('yuzey:durum-al'),
    onDurum: (callback) => dinle('yuzey:durum', callback),
    // Yük: { mod: 'panel' | 'palet', malzeme, gorunum?, etkilesim? } (pencere her gösterildiğinde; etkilesim: { tekerlek: boolean, sabit: boolean })
    onGoster: (callback) => dinle('yuzey:goster', callback),
    // 1.4.0 (o-20, o-23): etkileşim ayarı değişti (Ayarlar'dan): yük { tekerlek: boolean, sabit: boolean }
    onEtkilesim: (callback) => dinle('yuzey:etkilesim', callback),
    // Arayüz dili değişti: yük { dil: 'tr' | 'en' | 'de' | 'fr' | 'es' }. Sayfa kendini yeniden çevirir (EvDil.sayfayiCevir).
    onDilDegisti: (callback) => dinle('dil:degisti', callback),
    // Yük: { kimlik, parlaklik?, kapat?, servis?, veri?, sonDeger?, araDeger?, basili? }; yanıt: { ok, tur?, neden?, ad? }
    // (1.4.0 servis eylemi: { kimlik, servis, veri } — doğrulama ana süreçteki eylem hattındadır)
    calistir: (yuk) => ipcRenderer.invoke('yuzey:calistir', yuk),
    // 1.4.0 okuma: { tur: 'gecmis'|'takvim'|'hava'|'yapilacak', ... }; yanıt: { ok, veri } (yalnız kayıtlı varlıklar; src/lib/ha-okuma.js)
    oku: (istek) => ipcRenderer.invoke('yuzey:oku', istek),
    // 1.4.0 bildirim şeridi: modeldeki (opak) öğe anahtarıyla kapatır; yanıt: { ok, tur? } (HA bildirimi HA'ya da gider)
    bildirimKapat: (anahtar) => ipcRenderer.invoke('yuzey:bildirim-kapat', anahtar),
    // 1.4.0 kamera anlık görüntüsü (o-48): yalnız hızlı panelde ve yalnız Ayarlar'da izin verilmiş kameralar için; yanıt: { ok, veri? ('data:image/...'), yas?, onbellek?, tur? }
    kamera: (kimlik) => ipcRenderer.invoke('yuzey:kamera', kimlik),
    basiliBasla: (kimlik) => ipcRenderer.invoke('yuzey:basili-basla', kimlik),
    // Basılı tutma süre dolmadan bırakıldı: ana süreçteki başlangıç kaydı silinir (savunma derinliği)
    basiliBirak: (kimlik) => ipcRenderer.invoke('yuzey:basili-birak', kimlik),
    kapat: () => ipcRenderer.send('yuzey:kapat'),
    // 1.4.0 (o-23): paneli sabitle / çöz. Yük bir boolean'dır; yanıt { ok, sabit } (ayar panelSabit ana süreçte yazılır). Yalnız açık HIZLI PANELDEN kabul edilir.
    sabitle: (sabit) => ipcRenderer.invoke('yuzey:sabitle', sabit === true),
    boyut: (yukseklik) => ipcRenderer.send('yuzey:boyut', Number(yukseklik)),
    haAc: () => ipcRenderer.invoke('yuzey:ha-ac'),
    ayarlarAc: () => ipcRenderer.invoke('yuzey:ayarlar-ac'),
    // 1.4.0 düzen (o-16): karoya sağ tık. Yük yalnız varlık kimliğidir; menüyü ana süreç kurar (Menu.popup), HA'ya bir şey gitmez.
    sagTik: (kimlik) => ipcRenderer.invoke('yuzey:sag-tik', kimlik),
    // 1.4.0 dis grubu (o-54): evpaneli:// bağlantı izni. Soru: { bilet, ad, islem, deger?, bekleMs } | null (yalnız açık panelde);
    // karar 'izin' | 'herZaman' | 'reddet' yalnız sorunun biletiyle kabul edilir. onDisOnay: soru geldi ya da bitti (yük yok; soru yeniden okunur).
    disOnayAl: () => ipcRenderer.invoke('yuzey:dis-onay-al'),
    disOnayYanitla: (bilet, karar) => ipcRenderer.invoke('yuzey:dis-onay-yanit', bilet, karar),
    onDisOnay: (callback) => dinle('yuzey:dis-onay', callback),
    // 1.4.0 eylem grubu (o-12): son eylemi geri al. Yük yok: neyin geri alınacağını ana süreç bilir (en yeni geçerli girdi); yanıt: { ok, tur? }
    geriAl: () => ipcRenderer.invoke('yuzey:geri-al'),
    // 1.4.0 eylem grubu (o-15): palet satırından gecikmeli eylem. Yük { kimlik, yon: 'ac'|'kapat'|'sureli', dakika }; yanıt { ok, tur? } (doğrulama ana süreçte)
    geciktir: (yuk) => ipcRenderer.invoke('yuzey:geciktir', yuk),
    // Bekleyen gecikmeli eylemi iptal et: yük modeldeki opak kimlik (g<n>); yanıt { ok }
    gecikmeliIptal: (id) => ipcRenderer.invoke('yuzey:gecikmeli-iptal', id),
    // 1.4.0 eylem grubu (o-14): odayı kapat. Yük yalnız oda grubunun kodu (oda-<8 onaltılık>); üyeleri ana süreç hesaplar; yanıt { ok, tur?, adet? }
    odaKapat: (kod) => ipcRenderer.invoke('yuzey:oda-kapat', kod),
    // 1.4.0 eylem grubu (o-46): palette "*" ile favori olmayan güvenli cihazlar (ayar açıkken; yalnız palet kipinde). Liste yanıtı { ok, liste: [{ kimlik, ad,
    // alan, durum, oda? }] | tur }; çalıştır yükü { kimlik, islem: 'ac'|'kapat'|'degistir' }; favoriye ekle yükü yalnız kimlik. Hepsinin doğrulaması ana süreçte.
    digerCihazlar: () => ipcRenderer.invoke('yuzey:diger-cihazlar'),
    digerCalistir: (yuk) => ipcRenderer.invoke('yuzey:diger-calistir', yuk),
    digerFavoriEkle: (kimlik) => ipcRenderer.invoke('yuzey:diger-favori-ekle', kimlik),
    // 1.4.0 düzen (o-24): palet "sayfa" satırı. Yük yalnız sayfa kimliğidir ('tumu' ya da modeldeki sayfa); ana süreç doğrular ve paneli o sayfayla açar. HA'ya bir şey gitmez.
    sayfaSec: (kimlik) => ipcRenderer.invoke('yuzey:sayfa-sec', kimlik),
  });
}
