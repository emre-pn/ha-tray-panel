'use strict';

/**
 * Kullanıcıya gösterilen kısa geri bildirim metinleri (saf; Electron'a bağlı değildir).
 * Metinler köşe bildirimine, Windows bildirimine ve Ayarlar penceresine gider; anahtar ya da ham hata içermez.
 *
 * Metinlerin kaynağı src/lib/ceviri/ana.js sözlüğüdür (tr + en). Sabitler bugünkü Türkçe metindir (testler ve Ayarlar sayfasının
 * kendi kopyasıyla karşılaştırma için); işlevler son bağımsız değişken olarak çevirmen (`t`) alır, verilmezse Türkçe üretir.
 * Ana süreç (src/main.js) metinleri doğrudan t('bildirim.*') ile alır.
 *
 * Terim ve üslup kuralları (g-14): tek hitap "sen" (kullanıcıya "siz" denmez); kesme işareti kıvrık (’); Windows panosuyla
 * karışmaması için Home Assistant sayfaları "HA panosu" der (yalnız "pano" değil); adresler "ev içi adres" ve "dış adres";
 * "geri gelmeyebilir" yerine "kaybolabilir" gibi açık söylenir. İngilizcede: "access token", "home address", "external address",
 * "HA dashboard".
 */

const { kisalt } = require('./metin');
const { cogul } = require('./dil');
const { TR } = require('./ceviri-varsayilan');

const AD_SINIRI = 100;

/** Eylem sonucu metni: HA yanıtından yeni durum biliniyorsa ona göre, değilse "komut gönderildi". */
function basariMetni(alan, ad, onceki, yeni, t = TR) {
  const a = kisalt(ad, AD_SINIRI);
  if (alan === 'scene') return t('sonuc.sahne', { ad: a });
  if (alan === 'script') return t('sonuc.script', { ad: a });
  if (alan === 'button' || alan === 'input_button') return t('sonuc.dugme', { ad: a });
  if (yeni === 'on' && onceki !== 'on') return t('sonuc.acildi', { ad: a });
  if (yeni === 'off' && onceki !== 'off') return t('sonuc.kapatildi', { ad: a });
  return onceki === 'on' ? t('sonuc.kapatmaKomutu', { ad: a }) : t('sonuc.acmaKomutu', { ad: a });
}

/** Durum bilinmiyorsa genel metin. */
function gonderildiMetni(ad, t = TR) {
  return t('sonuc.komutGonderildi', { ad: kisalt(ad, AD_SINIRI) });
}

/** Hata geri bildirimi: "Yapılamadı: bağlantı yok". */
function hataBildirimiMetni(hataMetni, t = TR) {
  return t('sonuc.yapilamadi', { hata: kisalt(hataMetni, AD_SINIRI) });
}

/** HA içinden tıklanan dış bağlantı varsayılan tarayıcıda (ya da e-posta uygulamasında) açılınca köşede görünen kısa bilgi (k-20). */
const TARAYICIDA_ACILDI_METNI = TR('sonuc.tarayicidaAcildi');
const EPOSTA_ACILDI_METNI = TR('sonuc.epostaAcildi');

/**
 * Anahtar silinirken Ayarlar penceresinde sorulan onay metni (Türkçe). Ayarlar sayfası metni kendi kopyasında tutmaz: aynı sözlük
 * anahtarını (bildirim.anahtarSilmeOnay) seçili dilde çağırır (test/yapi.test.js denetler). Tek hitap "sen" (g-14).
 */
const ANAHTAR_SILME_ONAY_METNI = TR('bildirim.anahtarSilmeOnay');

/** Anahtar silindikten sonra gösterilen ileti: yalnız yerel dosya silindi, HA'daki anahtar duruyor (yukarıdaki not geçerli). */
const ANAHTAR_SILINDI_METNI = TR('bildirim.anahtarSilindi');

/**
 * Yetki kesici (1.1.1): Home Assistant erişim anahtarını reddettiğinde parmak izi başına BİR kez gösterilen Windows bildirimi.
 * Anahtarı, adresi ya da parmak izini içermez.
 */
const ANAHTAR_REDDEDILDI_BILDIRIMI = TR('bildirim.anahtarReddedildi');

/**
 * Yetki kesici kaydı sorunları (tur 1 inceleme): reddedilen anahtarın parmak izi diske yazılamazsa ya da kayıt dosyası okunamazsa
 * kullanıcı bilgilendirilir; aksi halde her yeniden başlatmada aynı geçersiz anahtarla yine 1 doğrulama denemesi sessizce giderdi.
 */
const YETKI_KAYDI_YAZILAMADI_BILDIRIMI = TR('bildirim.yetkiKaydiYazilamadi');
const YETKI_KAYDI_OKUNAMADI_BILDIRIMI = TR('bildirim.yetkiKaydiOkunamadi');
const ANAHTAR_KAYIT_ONAYI_KISA_METNI = TR('bildirim.kayitOnayiKisa');
const ANAHTAR_KAYIT_ONAYI_MENU_METNI = TR('bildirim.kayitOnayiMenu');

/**
 * Ayarlar'da AÇIK ikinci onay isteyen durumlar (tur 3, K4/K5): hata bütçesi dolu (>= 2 hatalı deneme) ya da güvenlik kaydı güvenilmez.
 * Anahtarı, adresi ya da parmak izini içermez.
 */
function ikinciOnayMetni(neden, sayi = 0, kayit = null, t = TR) {
  if (neden === 'hata-butcesi') {
    const butce = t('bildirim.ikinciOnayButce', { sayi });
    // Güvenlik kaydı da güvenilmezse (tur 5, K8) bütçe uyarısı gizlenmez; kayıt durumu ayrıca söylenir.
    return kayit ? `${butce}${t('bildirim.ikinciOnayButceKayit')}` : butce;
  }
  return t('bildirim.ikinciOnayKayit');
}

// ---------------------------------------------------------------------------
// 1.4.0 bildirim merkezi ve uyarı kuralları (bildirim grubu). Hiçbiri anahtar, adres ya da ham HA verisi içermez; ad, durum ve
// sürüm gibi parçaları ÇAĞIRAN süzgeçten geçirir (bildirim-merkezi.js, uyari-kurallari.js) ve burada yalnız cümleye yerleştirilir.
// ---------------------------------------------------------------------------

/** Düşük pil satırı: sayısal pil sensörü ("Salon sensörü: %12"). */
function pilYuzdeMetni(ad, yuzde, t = TR) {
  return t('merkez.pil.yuzde', { ad: kisalt(ad, AD_SINIRI), yuzde });
}

/** Düşük pil satırı: yalnız "düşük" bilen ikili pil sensörü. */
function pilDusukMetni(ad, t = TR) {
  return t('merkez.pil.dusuk', { ad: kisalt(ad, AD_SINIRI) });
}

/** Bekleyen güncelleme satırı; sürüm bilinmiyorsa (ya da güvenli değilse) sürümsüz cümle. */
function guncellemeMetni(ad, surum, t = TR) {
  const a = kisalt(ad, AD_SINIRI);
  return surum ? t('merkez.guncelleme.surum', { ad: a, surum }) : t('merkez.guncelleme.metin', { ad: a });
}

/** Köşe/Windows bildirimi gövdesi: "Başlık: metin" (başlık yoksa yalnız metin). */
function merkezKoseMetni(baslik, metin, t = TR) {
  return baslik ? t('merkez.kose', { baslik: kisalt(baslik, 60), metin: kisalt(metin, AD_SINIRI) }) : kisalt(metin, AD_SINIRI);
}

/** Hız sınırı yüzünden tek tek gösterilmeyen köşe bildirimlerinin özeti. */
function birikenMetni(sayi, t = TR) {
  return cogul(t, 'merkez.biriken', sayi, { n: sayi });
}

/** Uyarı kuralı için, kullanıcı cümlesi yokken kullanılan varsayılan cümle. `bag`: { ad, durum, esik }. */
function uyariVarsayilanMetni(kosulTuru, bag, t = TR) {
  const anahtar = {
    gecis: 'uyari.metin.gecis',
    durum: 'uyari.metin.durum',
    ustunde: 'uyari.metin.ustunde',
    altinda: 'uyari.metin.altinda',
    ulasilamiyor: 'uyari.metin.ulasilamiyor',
    bilinmiyor: 'uyari.metin.bilinmiyor',
  }[kosulTuru];
  return t(anahtar ?? 'uyari.metin.durum', { ad: bag.ad ?? '', durum: bag.durum ?? '', esik: bag.esik ?? '' });
}

/** Tepsi menüsünde ve hızlı panelin üstünde görünen kısa durum (kesici açıkken). */
const ANAHTAR_REDDEDILDI_KISA_METNI = TR('bildirim.anahtarReddedildiKisa');
const ANAHTAR_REDDEDILDI_MENU_METNI = TR('bildirim.anahtarReddedildiMenu');

/** Ayarlar'da anahtar kaydı: Home Assistant yeni anahtarı da reddetti (kaydedilmez, bu anahtarla bir daha istek gitmez). */
const ANAHTAR_KAYDI_REDDEDILDI_METNI = TR('bildirim.anahtarKaydiReddedildi');

/** Ayarlar'da anahtar kaydı: aynı anahtar daha önce reddedilmişti; Home Assistant'a hiç istek gönderilmez. */
const ANAHTAR_ZATEN_REDDEDILDI_METNI = TR('bildirim.anahtarZatenReddedildi');

/** Tepsiden bir favoriye tıklandığında başka bir onay penceresi zaten açıksa (sessizce yutulmasın). */
const ONAY_BEKLIYOR_METNI = TR('bildirim.onayBekliyor');

/** Ayar dosyası diske yazılamadığında Ayarlar penceresinde gösterilen ileti. */
const AYAR_YAZILAMADI_METNI = TR('bildirim.ayarYazilamadi');

/**
 * Bozuk ayar dosyası yedeklenip varsayılanlara dönüldüğünde açılışta bildirilen metin. bakTenGeriYuklendi: dosya bozuktu ama
 * "son iyi kopya" (ayarlar.json.bak) sağlamdı ve ondan geri yüklendi (h-32).
 */
function ayarDosyasiBozukMetni(yedekAdi, bakTenGeriYuklendi = false, t = TR) {
  const yedek = yedekAdi ? t('bildirim.yedekSaklandi', { ad: yedekAdi }) : '';
  return t(bakTenGeriYuklendi ? 'bildirim.ayarBozukBak' : 'bildirim.ayarBozuk', { yedek });
}

/**
 * Ayar dosyası açılışta OKUNAMADI (kilitli, izin yok; JSON bozuk DEĞİL): varsayılanlarla çalışılır ama dosyanın üzerine hiçbir şey
 * yazılmaz (h-10), yoksa sağlam ayarlar varsayılanlarla ezilirdi.
 */
const AYAR_OKUNAMADI_BILDIRIMI = TR('bildirim.ayarOkunamadi');

/** Ayarlar açılışta tipi bozuk alanlar varsayılana döndürüldü (h-33). Yalnız ilk 5 alan adı yazılır. */
function alanlarSifirlandiMetni(alanlar, yedekAdi = '', t = TR) {
  const liste = alanlar.slice(0, 5).join(', ');
  const fazla = alanlar.length > 5 ? '…' : '';
  const yedek = yedekAdi ? t('bildirim.ozgunSaklandi', { ad: yedekAdi }) : '';
  return t('bildirim.alanlarSifirlandi', { liste, fazla, yedek });
}

/** Ayar dosyası bu sürümden daha yeni bir Ev Paneli ile kaydedilmiş (h-11): bilinmeyen ayarlar korunur, özgün dosya yedeklenir. */
function semaDahaYeniMetni(surum, yedekAdi = '', t = TR) {
  const yedek = yedekAdi ? t('bildirim.ozgunSaklandi', { ad: yedekAdi }) : '';
  return t('bildirim.semaDahaYeni', { surum, yedek });
}

/**
 * Daha eski bir Ev Paneli sürümü (aynı ayar klasörünü kullanan kurulu ya da taşınabilir sürüm) ayar dosyasını yazarken düşürdüğü
 * favoriler ve ayarlar, onun bıraktığı yedekten geri alındı (src/lib/yedek-kurtarma.js). yedekAdi: yedeğin saklandığı dosya adı.
 */
function eskiSurumYedegiMetni(yedekAdi = '', t = TR) {
  const yedek = yedekAdi ? t('bildirim.ozgunSaklandi', { ad: yedekAdi }) : '';
  return t('bildirim.eskiSurumYedegi', { yedek });
}

/** Kayıtlı ana kısayol / palet kısayolu geçersizdi ve varsayılana döndürüldü (h-33: palet için de bildirilir). */
function kisayolSifirlandiMetni(tur, gosterilen, t = TR) {
  return t(tur === 'palet' ? 'bildirim.kisayolSifirlandi.palet' : 'bildirim.kisayolSifirlandi.ana', { gosterilen });
}

/** Ana kısayol açılışta kaydedilemedi (başka bir uygulama kullanıyor olabilir). */
function anaKisayolAlinamadiMetni(gosterilen, t = TR) {
  return t('bildirim.anaKisayolAlinamadi', { gosterilen });
}

/** Palet, eylem ve pano kısayollarından bazıları açılışta uygulanamadı. */
function ekKisayollarUygulanamadiMetni(sayi, t = TR) {
  return cogul(t, 'bildirim.ekKisayollar', sayi, { sayi });
}

/** Ayarlar penceresinin sayfa süreci çöktü (h-37). */
const AYARLAR_COKTU_BILDIRIMI = TR('bildirim.ayarlarCoktu');
const AYARLAR_ART_ARDA_COKTU_BILDIRIMI = TR('bildirim.ayarlarArtArdaCoktu');

/** Açılış zincirinde beklenmeyen bir hata oldu (h-37): ayrıntı yalnız günlükte (adı/kodu), bildirimde yok. */
const ACILIS_HATASI_BILDIRIMI = TR('bildirim.acilisHatasi');

/** Ev içi adres http:// iken erişim anahtarı ağda şifresiz gider (hata-01'de kabul edilmiş risk; her açılışta hatırlatılır). */
const HTTP_ANAHTAR_UYARISI = TR('bildirim.httpUyarisi');
const HTTP_ANAHTAR_GUNLUK_SATIRI = 'Ev içi adres http; erişim anahtarı ağda şifresiz gidiyor.'; // günlük satırı: çevrilmez

/**
 * İlk gizlemede gösterilen tepside-çalışıyor ipucu (detay-18). Windows 11'de yeni tepsi simgeleri taşma alanında (^) başlayabilir;
 * simge görünür alana sürüklenmezse tepsi tabanlı geri bildirim (ipucu, soluk simge, hızlı panel) hiç görünmez.
 */
const TEPSI_IPUCU_BILDIRIMI = TR('bildirim.tepsiIpucu');

/**
 * Yetki kesici (tur 2 inceleme): üç ek durum. Hiçbiri anahtarı, adresi ya da parmak izini içermez.
 *  - doğrulanamadı: HA kimlikli doğrulamaya yanıt vermedi (zaman aşımı / gönderim sonrası kopma) ve kalıcı deneme sınırı doldu;
 *  - yerel yasak: ev içi adres 403 verdi (HA bu bilgisayarı banlamış olabilir), doğrulanmamış anahtar dış adrese gönderilmedi;
 *  - karantina: reddedilen anahtarın kaydı hiçbir yere yazılamadı, yeniden başlatmada aynı anahtarla deneme gitmesin diye anahtar dosyası kenara alındı.
 */
const ANAHTAR_DOGRULANAMADI_BILDIRIMI = TR('bildirim.anahtarDogrulanamadi');
const ANAHTAR_DOGRULANAMADI_KISA_METNI = TR('bildirim.anahtarDogrulanamadiKisa');
const ANAHTAR_DOGRULANAMADI_MENU_METNI = TR('bildirim.anahtarDogrulanamadiMenu');
const YEREL_YASAK_BILDIRIMI = TR('bildirim.yerelYasak');
const YEREL_YASAK_KISA_METNI = TR('bildirim.yerelYasakKisa');
const YEREL_YASAK_MENU_METNI = TR('bildirim.yerelYasakMenu');
const ANAHTAR_KARANTINA_BILDIRIMI = TR('bildirim.anahtarKarantina');

module.exports = {
  AD_SINIRI,
  ACILIS_HATASI_BILDIRIMI,
  ANAHTAR_DOGRULANAMADI_BILDIRIMI,
  ANAHTAR_DOGRULANAMADI_KISA_METNI,
  ANAHTAR_DOGRULANAMADI_MENU_METNI,
  ANAHTAR_KARANTINA_BILDIRIMI,
  ANAHTAR_KAYIT_ONAYI_KISA_METNI,
  ANAHTAR_KAYIT_ONAYI_MENU_METNI,
  AYARLAR_ART_ARDA_COKTU_BILDIRIMI,
  AYARLAR_COKTU_BILDIRIMI,
  AYAR_OKUNAMADI_BILDIRIMI,
  EPOSTA_ACILDI_METNI,
  TARAYICIDA_ACILDI_METNI,
  alanlarSifirlandiMetni,
  anaKisayolAlinamadiMetni,
  ekKisayollarUygulanamadiMetni,
  ikinciOnayMetni,
  kisayolSifirlandiMetni,
  semaDahaYeniMetni,
  eskiSurumYedegiMetni,
  YEREL_YASAK_BILDIRIMI,
  YEREL_YASAK_KISA_METNI,
  YEREL_YASAK_MENU_METNI,
  ANAHTAR_KAYDI_REDDEDILDI_METNI,
  ANAHTAR_REDDEDILDI_BILDIRIMI,
  ANAHTAR_REDDEDILDI_KISA_METNI,
  ANAHTAR_REDDEDILDI_MENU_METNI,
  ANAHTAR_ZATEN_REDDEDILDI_METNI,
  TEPSI_IPUCU_BILDIRIMI,
  AYAR_YAZILAMADI_METNI,
  YETKI_KAYDI_OKUNAMADI_BILDIRIMI,
  YETKI_KAYDI_YAZILAMADI_BILDIRIMI,
  HTTP_ANAHTAR_GUNLUK_SATIRI,
  HTTP_ANAHTAR_UYARISI,
  ONAY_BEKLIYOR_METNI,
  ayarDosyasiBozukMetni,
  pilYuzdeMetni,
  pilDusukMetni,
  guncellemeMetni,
  merkezKoseMetni,
  birikenMetni,
  uyariVarsayilanMetni,
  ANAHTAR_SILME_ONAY_METNI,
  ANAHTAR_SILINDI_METNI,
  basariMetni,
  gonderildiMetni,
  hataBildirimiMetni,
};
