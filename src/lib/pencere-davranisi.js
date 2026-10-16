'use strict';

/**
 * Pencerenin gizlenme kararları (saf; zamanlayıcı ve odak bilgisini ana süreç verir).
 */

const ODAK_KAYBI_GECIKME_MS = 180; // odak kaybında gizlemeden önce bekleme; tepsi tıklaması bu sürede iptal eder
const TEPSI_YARIS_MS = 600; // otomatik gizlemeden bu kadar sonra gelen tepsi tıklaması "gizle" niyetidir

/**
 * Tepsi / kısayol tıklaması pencereyi gizlemeli mi, göstermeli mi?
 * Windows'ta tepsi 'click' olayı fare bırakılınca gelir; o ana kadar odak çoktan görev çubuğuna geçmiştir.
 * "Başka yere tıklayınca gizle" AÇIKSA bu yüzden pencere gizlenmek üzeredir (bekleyen zamanlayıcı) ya da yeni
 * gizlenmiştir. KAPALIYSA ne zamanlayıcı ne otomatik gizleme oluşur; tek iz, pencerenin az önce odağını
 * kaybetmesidir (sonOdakKaybiMs). Üç işaret de tepsi için "pencere odaktaydı" demektir.
 * @returns {'ac'|'kapat'}
 */
function tiklamaKarari({ kaynak, gorunur, odakta, bekleyenGizleme, sonGizlemeMs, sonOdakKaybiMs, simdi }) {
  let odaktaydi = !!gorunur && !!odakta;
  if (kaynak === 'tepsi') {
    const yakin = (zaman) => Number.isFinite(zaman) && zaman > 0 && simdi - zaman < TEPSI_YARIS_MS;
    // Odak kaybı yalnız pencere hâlâ görünürse sayılır: gizleme kendi blur olayını da üretebilir.
    const yeniOdakKaybi = !!gorunur && yakin(sonOdakKaybiMs);
    if (bekleyenGizleme || yakin(sonGizlemeMs) || yeniOdakKaybi) odaktaydi = true;
  }
  return odaktaydi ? 'kapat' : 'ac';
}

/**
 * Odak kaybı gecikmesi dolduğunda pencere gerçekten gizlenmeli mi?
 * Gizlenmez: ayar kapalı, pencere görünmüyor/simge durumunda/tam ekranda, yeniden odak almış ya da
 * odak uygulamanın kendi başka penceresinde (Ayarlar, HA'nın açtığı alt pencere, geliştirici araçları) ya da
 * eylem onay penceresi açık.
 */
function odakKaybiGizlensinMi({
  ayarAcik,
  gorunur,
  simgeDurumunda,
  tamEkran,
  anaPencereOdakta,
  ayarlarOdakta,
  altPencereOdakta,
  devToolsOdakta,
  onayAcik = false,
}) {
  if (!ayarAcik || !gorunur || simgeDurumunda || tamEkran) return false;
  if (anaPencereOdakta || ayarlarOdakta || altPencereOdakta || devToolsOdakta) return false;
  if (onayAcik) return false; // tepsi menüsünden açılan onay penceresi odağı aldı (hata-04)
  return true;
}

module.exports = { ODAK_KAYBI_GECIKME_MS, TEPSI_YARIS_MS, tiklamaKarari, odakKaybiGizlensinMi };
