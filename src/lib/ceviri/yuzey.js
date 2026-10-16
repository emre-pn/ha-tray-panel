'use strict';

/**
 * Hızlı panel, komut paleti, köşe bildirimi ve çevrimdışı sayfası sözlüğü (src/yuzey.html, src/kose-bildirim.html, src/offline.html):
 * { tr: {...}, en: {...} }.
 * Her iki dilde aynı anahtar kümesi ve aynı {yer tutucular} olmalıdır (test/dil.test.js). tr metinleri bugünkü Türkçe metnin aynısıdır.
 * Satırlar [anahtar, tr, en] üçlüleridir; iki sözlük aynı listeden türetilir, böylece anahtar kümeleri ayrışamaz.
 * Anahtar önekleri: yuzey.* (panel ve palet), kose.* (köşe bildirimi), offline.* (çevrimdışı / bağlantı sayfası).
 * Hem Node'da (require) hem renderer'da (<script src="lib/ceviri/yuzey.js">, window.EvCeviriYuzey) çalışır.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvCeviriYuzey = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SATIRLAR = [
    // --- Hızlı panel ve palet: sayfa, başlık, bağlantı ve alt şerit (src/yuzey.html) ---
    ['yuzey.sayfaBasligi', 'Ev Paneli — Hızlı Panel', 'Home Panel — Quick Panel'],
    ['yuzey.uygulamaAdi', 'Ev Paneli', 'Home Panel'],
    ['yuzey.eskiRozeti', 'Durumlar eski olabilir', 'Status may be out of date'],
    ['yuzey.baglanti.canli', 'Canlı', 'Live'],
    ['yuzey.baglanti.baglaniyor', 'Bağlanıyor…', 'Connecting…'],
    ['yuzey.baglanti.yedek', 'Yedek mod (60 sn’de bir yenilenir)', 'Fallback mode (refreshes every 60 s)'],
    ['yuzey.baglanti.kapali', 'Canlı bağlantı kapalı', 'Live connection off'],
    ['yuzey.alt.haAc', 'HA’yı aç', 'Open HA dashboard'],
    ['yuzey.alt.ayarlar', 'Ayarlar', 'Settings'],
    ['yuzey.serit.hata', 'Home Assistant: {hata}', 'Home Assistant: {hata}'],
    ['yuzey.medya.caliyor', 'Çalıyor', 'Playing'],
    ['yuzey.medya.kulaklik', 'Çalıyor · Kulaklık', 'Playing · Headphones'],
    ['yuzey.medya.hoparlor', 'Çalıyor · Hoparlör', 'Playing · Speaker'],

    // --- Karolar ---
    ['yuzey.durum.acik', 'açık', 'on'],
    ['yuzey.yuzde', '%{n}', '{n}%'],
    ['yuzey.durum.kapali', 'kapalı', 'off'],
    ['yuzey.durum.ulasilamiyor', 'ulaşılamıyor', 'unavailable'],
    ['yuzey.karo.basiliTut', 'basılı tut', 'hold to confirm'],
    ['yuzey.karo.basiliBaslik', '{etiket} — çalıştırmak için basılı tutun', '{etiket} — hold to run'],
    ['yuzey.karo.parlaklik', '{etiket} parlaklığı', '{etiket} brightness'],
    ['yuzey.bolum.son', 'Son kullanılanlar', 'Recently used'],
    ['yuzey.bolum.favoriler', 'Favoriler', 'Favorites'],

    // --- Boş durum ---
    ['yuzey.bos.anahtarYok', 'Erişim anahtarı eklenmemiş.', 'No access token added.'],
    ['yuzey.bos.anahtarYokAlt',
      'Ayarlar’dan Home Assistant adresini ve erişim anahtarını girin.',
      'Enter your Home Assistant address and access token in Settings.'],
    ['yuzey.bos.favoriYok', 'Henüz favori yok.', 'No favorites yet.'],
    ['yuzey.bos.favoriYokAlt', 'Ayarlar’dan favori seçin.', 'Choose favorites in Settings.'],
    ['yuzey.bos.ayarlariAc', 'Ayarlar’ı aç', 'Open Settings'],

    // --- Palet ---
    ['yuzey.arama.ipucu', 'Eylem ara…  (örn. “ışık 40”)', 'Search actions…  (e.g. “light 40”)'],
    ['yuzey.arama.etiket', 'Eylem ara', 'Search actions'],
    ['yuzey.paletSerit',
      'Enter çalıştır · Shift+Enter seviye · Enter’ı basılı tut onay',
      'Enter to run · Shift+Enter for level · Hold Enter to confirm'],
    ['yuzey.palet.sonVeFavoriler', 'Son kullanılanlar ve favoriler', 'Recently used and favorites'],
    ['yuzey.palet.sonuclar', 'Arama sonuçları', 'Search results'],
    ['yuzey.palet.eslesmeYok', 'Eşleşen eylem yok.', 'No matching actions.'],
    ['yuzey.palet.seviye', 'Parlaklık seviyesi', 'Brightness level'],
    ['yuzey.rozet.kapat', 'Kapat', 'Turn off'],
    ['yuzey.rozet.desteklenmiyor', 'Parlaklık desteklenmiyor', 'Brightness not supported'],
    ['yuzey.rozet.basiliTut', 'Enter’a basılı tut', 'Hold Enter'],

    // --- İpucu satırı (eylem sonuçları; ayrıntılı hata iletisi köşe bildirimiyle ana süreçten gelir) ---
    ['yuzey.eylem', 'Eylem', 'Action'],
    ['yuzey.ipucu.onayPalet', '“{etiket}” için Enter’ı basılı tutun.', 'Hold Enter to run “{etiket}”.'],
    ['yuzey.ipucu.onayPanel', '“{etiket}” için düğmeyi basılı tutun.', 'Hold the button to run “{etiket}”.'],
    ['yuzey.ipucu.cokSik', 'Çok sık; biraz bekleyin.', 'Too fast; wait a moment.'],
    ['yuzey.ipucu.calistirilamadi', '“{etiket}” çalıştırılamadı.', '“{etiket}” could not be run.'],
    ['yuzey.ipucu.gonderilemedi', 'Eylem gönderilemedi.', 'The action could not be sent.'],
    ['yuzey.ipucu.basiliDevam', '“{etiket}” çalıştırılıyor… basılı tutmaya devam edin.', 'Running “{etiket}”… keep holding.'],
    ['yuzey.ipucu.basiliTutun', '“{etiket}” için basılı tutun.', 'Hold to run “{etiket}”.'],
    ['yuzey.ipucu.yuklenemedi', 'Panel yüklenemedi.', 'The panel could not be loaded.'],

    // --- Köşe bildirimi (src/kose-bildirim.html; bildirim metni ana süreçte seçili dilde yazılır) ---
    ['kose.sayfaBasligi', 'Ev Paneli — Bildirim', 'Home Panel — Notification'],

    // --- Çevrimdışı / bağlantı sayfası (src/offline.html, src/offline.js) ---
    ['offline.sayfaBasligi', 'Ev Paneli — Bağlantı', 'Home Panel — Connection'],
    ['offline.baslik.cevrimdisi', 'Ev sunucusuna bağlanılamadı', 'Could not connect to the home server'],
    ['offline.baslik.baglaniyor', 'Ev sunucusuna bağlanılıyor…', 'Connecting to the home server…'],
    ['offline.aciklama.varsayilan',
      'Home Assistant sunucunuzun açık olduğundan ve ağ bağlantınızın çalıştığından emin olun.',
      'Make sure your Home Assistant server is on and your network connection is working.'],
    ['offline.aciklama.baglaniyor',
      'Ev içi adres ve internet adresi kontrol ediliyor.',
      'Checking the home address and the external address.'],
    ['offline.hataKodu', 'Hata kodu: {kod}', 'Error code: {kod}'],
    ['offline.adres.evIci', 'Ev İçi:', 'Home address:'],
    ['offline.adres.dis', 'Dış Adres:', 'External address:'],
    ['offline.adres.tanimsiz', '(tanımlı değil)', '(not set)'],
    ['offline.sayac', '{n} saniye içinde yeniden denenecek…', 'Retrying in {n} seconds…'],
    ['offline.sayac.bir', '{n} saniye içinde yeniden denenecek…', 'Retrying in {n} second…'],
    ['offline.tekrarDene', 'Tekrar Dene', 'Try again'],
    ['offline.baglaniyor', 'Bağlanılıyor…', 'Connecting…'],
    ['offline.ayarlar', 'Ayarlar', 'Settings'],

    // Sık Chromium hata kodlarının açıklamaları (g-11); ham kod ayrı bir satırda gösterilir (offline.hataKodu)
    ['offline.hata.adresBulunamadi',
      'Ev sunucusunun adresi bulunamadı. Adresi ve ağ (DNS) ayarlarını kontrol edin.',
      'The home server’s address could not be found. Check the address and your network (DNS) settings.'],
    ['offline.hata.baglantiReddedildi',
      'Sunucu bağlantıyı reddetti. Home Assistant’ın çalıştığını ve adres ile portun doğru olduğunu kontrol edin.',
      'The server refused the connection. Check that Home Assistant is running and that the address and port are correct.'],
    ['offline.hata.zamanAsimi',
      'Sunucudan zamanında yanıt gelmedi (zaman aşımı). Ağ bağlantınızı ve sunucunun durumunu kontrol edin.',
      'The server did not respond in time (timed out). Check your network connection and the server’s status.'],
    ['offline.hata.baglantiKesildi',
      'Bağlantı beklenmedik biçimde kesildi. Tekrar deneyin.',
      'The connection was dropped unexpectedly. Try again.'],
    ['offline.hata.internetYok',
      'İnternet bağlantısı yok. Ağ bağlantınızı kontrol edin.',
      'No internet connection. Check your network connection.'],
    ['offline.hata.adreseUlasilamiyor',
      'Sunucunun adresine ulaşılamıyor. Yönlendiricinizi, VPN ayarlarınızı ya da ağ yolunu kontrol edin.',
      'The server’s address is unreachable. Check your router, your VPN settings or the network route.'],
    ['offline.hata.agDegisti',
      'Ağ bağlantısı değişti. Yeniden bağlanmak için “Tekrar Dene”yi kullanın.',
      'The network connection changed. Use “Try again” to reconnect.'],
    ['offline.hata.sertifikaTarihi',
      'Güvenlik sertifikasının tarihi geçersiz. Sertifika süresi dolmuş olabilir ya da bilgisayarınızın saati yanlış olabilir.',
      'The security certificate’s date is invalid. The certificate may have expired, or your computer’s clock may be wrong.'],
    ['offline.hata.sertifika',
      'Sunucunun güvenlik sertifikası doğrulanamadı. Adresin doğru olduğunu ve sertifikanın geçerli olduğunu kontrol edin.',
      'The server’s security certificate could not be verified. Check that the address is correct and the certificate is valid.'],
    ['offline.hata.cokme',
      'Sayfa art arda çöktü; otomatik yeniden deneme durduruldu. Hazır olduğunuzda “Tekrar Dene” ile elle başlatın.',
      'The page crashed repeatedly, so automatic retries have stopped. When you are ready, start it manually with “Try again”.'],
    ['offline.hata.erisimEngellendi',
      'Erişim engellendi (403). Dış erişim bu ağdan engelli olabilir.',
      'Access denied (403). External access may be blocked from this network.'],
    ['offline.hata.sunucu',
      'Sunucu hatası ({kod}). Home Assistant ya da internet adresi şu an yanıt vermiyor.',
      'Server error ({kod}). Home Assistant or its web address is not responding right now.'],
    ['offline.hata.bilinmeyen',
      'Home Assistant sunucusuna ulaşılamadı ({kod}). Lütfen ağınızı kontrol edin.',
      'Could not reach the Home Assistant server ({kod}). Please check your network.'],
  ];

  const tr = {};
  const en = {};
  for (const [anahtar, turkce, ingilizce] of SATIRLAR) {
    tr[anahtar] = turkce;
    en[anahtar] = ingilizce;
  }
  return { tr, en };
});
