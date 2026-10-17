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
    // İçe aktarma (1.4.0): önce önizleme (dosyayı ana süreç seçtirir; yol/değer gelmez, yalnız bölüm adları ve sayılar), sonra onaylanınca önizleme numarasıyla uygulama
    ayarlariIceAktarOnizle: () => ipcRenderer.invoke('ayarlar:ice-aktar-onizle'),
    ayarlariIceAktar: (onizlemeNo) => ipcRenderer.invoke('ayarlar:ice-aktar', onizlemeNo),
    yedekleriGetir: () => ipcRenderer.invoke('ayarlar:yedekler'),
    yedektenDon: (ad) => ipcRenderer.invoke('ayarlar:yedekten-don', ad),
    // Arayüz dili değişti (Ayarlar'dan ya da ana süreçte): yük { dil: 'tr' | 'en' | 'de' | 'fr' | 'es' }. Sayfa kendini yeniden çevirir (EvDil.sayfayiCevir).
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
    // Uygulama içi güncelleme (o-51): kayıtlı durum (ağa çıkmaz), "İndir" (yalnız doğrulanmış yeni sürüm varken) ve "Kur ve yeniden başlat" (ana süreç
    // ayrıca onay penceresi gösterir). Adres, dosya yolu ve sha512 renderer'a hiç verilmez. onGuncellemeDegisti: durum/ilerleme itilir.
    guncellemeDurumu: () => ipcRenderer.invoke('guncelleme:durum'),
    guncellemeyiIndir: () => ipcRenderer.invoke('guncelleme:indir'),
    guncellemeyiKur: () => ipcRenderer.invoke('guncelleme:kur'),
    onGuncellemeDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('guncelleme:degisti', dinleyici);
      return () => ipcRenderer.removeListener('guncelleme:degisti', dinleyici);
    },
    // Mobil bildirimler (o-61): kayıt durumu (webhook kimliği, adres ve anahtar renderer'a hiç verilmez), "Kaydol" (cihaz adı; ana süreç onay penceresi
    // gösterir, HA'ya TEK kayıt isteği gider) ve "Kaydı sil" (onay penceresi). onMobilDegisti: kanal/kayıt durumu itilir.
    mobilDurumu: () => ipcRenderer.invoke('mobil:durum'),
    mobilKaydol: (cihazAdi) => ipcRenderer.invoke('mobil:kaydol', { cihazAdi: typeof cihazAdi === 'string' ? cihazAdi.slice(0, 200) : '' }),
    mobilKaydiSil: () => ipcRenderer.invoke('mobil:kaydi-sil'),
    onMobilDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('mobil:degisti', dinleyici);
      return () => ipcRenderer.removeListener('mobil:degisti', dinleyici);
    },
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
    // Anahtarın kullanıcı türü belirlendi / unutuldu (o-43): yük { anahtarYonetici: true | false | null } (true = yönetici → Ayarlar uyarı gösterir).
    onAnahtarYonetici: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = (_olay, yuk) => callback(yuk);
      ipcRenderer.on('ayarlar:anahtar-yonetici', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:anahtar-yonetici', dinleyici);
    },
    // Favori listesi ana süreçte değişti (hazır karoların yeniden denemesi, h-27): Ayarlar listeyi tazeler.
    onFavorilerDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('ayarlar:favoriler-degisti', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:favoriler-degisti', dinleyici);
    },

    // --- Eylem (1.4.0 eylem grubu: o-12, o-15, o-17) ---
    // Etkinlik geçmişi (o-17): yanıt { ok, acik, kayitlar: [{ zaman, kaynak, kimlik?, ad?, islem, sonuc, neden? }] } (son 200, yerel); temizle: { ok }
    etkinlikListesi: () => ipcRenderer.invoke('etkinlik:liste'),
    etkinlikTemizle: () => ipcRenderer.invoke('etkinlik:temizle'),

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

    // --- 1.4.0 dis grubu: Dış tetikler (Jump List, masaüstü kısayolu, evpaneli://, yerel API, PC olayı, toplantı ışığı) ---
    // Durum: { ok, uygunlar: [{kimlik, ad}], kuralUygunlari: [{kimlik, ad, acKapa}], izinler: [{kimlik, ad|null}],
    //          api: { calisiyor, port, hata, jetonVar }, protokol: { kayitli }, toplanti: { calisiyor, toplantida, okunabilir, ... } }.
    // Yerel API jetonu renderer'a HİÇ gelmez: jetonKopyala yalnız panoya yazar.
    disTetikDurumu: () => ipcRenderer.invoke('dis:durum'),
    disKisayolOlustur: (kimlik) => ipcRenderer.invoke('dis:kisayol-olustur', kimlik),
    disBaglantiKopyala: (kimlik) => ipcRenderer.invoke('dis:baglanti-kopyala', kimlik),
    disJetonKopyala: () => ipcRenderer.invoke('dis:jeton-kopyala'),
    disJetonYenile: () => ipcRenderer.invoke('dis:jeton-yenile'),
    disIzinKaldir: (kimlik) => ipcRenderer.invoke('dis:izin-kaldir', kimlik),
    // Dış tetik durumu değişti (API başladı/durdu, izin eklendi, toplantı başladı/bitti): yük yok, sayfa durumu yeniden ister.
    onDisDurumDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('dis:durum-degisti', dinleyici);
      return () => ipcRenderer.removeListener('dis:durum-degisti', dinleyici);
    },
    // --- Bağlantı katmanı (1.4.0 bağlantı grubu: o-55, o-56, o-57, o-58) ---
    // Durum: { ok, ustbilgi: { adlar, enCok }, ... }. Üstbilgi DEĞERLERİ hiçbir yanıtta dönmez; yalnız adlar.
    baglantiDurumuGetir: () => ipcRenderer.invoke('baglanti:durum'),
    // Yük: [{ ad, deger }] (deger null: kayıtlı değer korunur). Yanıt { ok, adlar } | { ok:false, hatalar:[{sira, neden}] | sifreleme, hata }
    ustbilgileriKaydet: (liste) => ipcRenderer.invoke('baglanti:ustbilgi-kaydet', liste),
    ustbilgileriSil: () => ipcRenderer.invoke('baglanti:ustbilgi-sil'),
    // Kayıtlı adresleri ANAHTAR GÖNDERMEDEN (üstbilgilerle) yoklar; yanıt { ok, sonuclar: [{ tur, ulasilabilir, neden, mesaj }] }
    ustbilgileriDene: () => ipcRenderer.invoke('baglanti:ustbilgi-dene'),
    // Sertifika güveni (o-56; yalnız ayardaki https HA adresleri). Sunucu sertifikasını okur (veri yazılmaz); yanıt { ok, parmak, parmakBicimli, ad, veren, ... }
    sertifikaOku: (tur) => ipcRenderer.invoke('baglanti:sertifika-oku', tur),
    // Parmak izini o adresin ana bilgisayarına bağlayarak sabitler (tur: 'yerel' | 'dis'); yanıt { ok } | { ok:false, neden }
    parmakIziniSabitle: (tur, parmak) => ipcRenderer.invoke('baglanti:parmak-kaydet', tur, parmak),
    parmakSabitlemeyiKaldir: (anaBilgisayar) => ipcRenderer.invoke('baglanti:parmak-sil', anaBilgisayar),
    // Dosyayı ana süreç seçtirir ve okur (yol arayüze gelmez, özel anahtar içeren dosya reddedilir); yanıt { ok, eklenen, atlanan } | { ok:false, iptal | neden }
    kokSertifikaEkle: () => ipcRenderer.invoke('baglanti:ca-ekle'),
    kokSertifikayiKaldir: (parmak) => ipcRenderer.invoke('baglanti:ca-sil', parmak),
    // Tarayıcıyla giriş (o-57). Durum: { ok, oturum: { var, cozuldu, anaBilgisayar, asama, kalanSn, erisim, son } }; JETON/KOD hiçbir yanıtta dönmez.
    oturumDurumuGetir: () => ipcRenderer.invoke('oturum:durum'),
    // Varsayılan tarayıcıda HA giriş sayfasını açar (yalnız bu düğmeyle); yanıt { ok } | { ok:false, neden }
    tarayiciGirisiBaslat: () => ipcRenderer.invoke('oturum:giris-baslat'),
    tarayiciGirisiniIptalEt: () => ipcRenderer.invoke('oturum:giris-iptal'),
    // Bu bilgisayardaki oturumu siler ve HA'daki yenileme anahtarını iptal etmeyi dener; yanıt { ok, iptalEdildi }
    tarayiciOturumunuKapat: () => ipcRenderer.invoke('oturum:cikis'),
    // Giriş durumu değişti (dinleyici açıldı/kapandı, giriş bitti, oturum sona erdi): Ayarlar durumu yeniden sorar.
    onOturumDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('ayarlar:oturum-degisti', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:oturum-degisti', dinleyici);
    },
    // Klasör eşitleme (o-58). Yanıtlar { ok, esitleme: { acik, klasor, klasorVar, dosyaVar, tumBolumler, bolumler, parolaVar, sifrelemeVar, asama, neden, son } } | { ok:false, neden };
    // Parola yanıtlarda ASLA dönmez (yalnız parolaVar). Klasörü yalnız ana süreç diyaloğu seçer; yol yazılamaz.
    esitlemeDurumuGetir: () => ipcRenderer.invoke('esitleme:durum'),
    esitlemeKlasoruSec: () => ipcRenderer.invoke('esitleme:klasor-sec'),
    // Yük: { acik?: boolean, bolumler?: string[] }
    esitlemeyiAyarla: (girdi) => ipcRenderer.invoke('esitleme:ayarla', girdi),
    simdiEsitle: () => ipcRenderer.invoke('esitleme:simdi'),
    esitlemeParolasiniKaydet: (parola) => ipcRenderer.invoke('esitleme:parola-koy', parola),
    esitlemeParolasiniSil: () => ipcRenderer.invoke('esitleme:parola-sil'),
    // Eşitleme durumu değişti (bölüm alındı/yazıldı, hata): Ayarlar durumu yeniden sorar.
    onEsitlemeDegisti: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const dinleyici = () => callback();
      ipcRenderer.on('ayarlar:esitleme-degisti', dinleyici);
      return () => ipcRenderer.removeListener('ayarlar:esitleme-degisti', dinleyici);
    },
  });
}
