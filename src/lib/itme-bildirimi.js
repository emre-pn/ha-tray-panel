'use strict';

/**
 * Home Assistant mobile_app itme bildirimi (o-61; saf, ağ ve Electron yok).
 *
 * Kullanıcı bu bilgisayarı HA'ya mobile_app cihazı olarak kaydettiyse (Ayarlar > Mobil bildirimler) HA, `notify.mobile_app_<cihaz>`
 * hizmetinin bildirimlerini WebSocket itme kanalından ('mobile_app/push_notification_channel') gönderir. Bu modül o kanaldan gelen
 * yükü GÜVENİLMEZ veri sayıp ekranda gösterilecek en küçük güvenli modele indirger:
 *
 *  - Başlık ve ileti düz metne çevrilir (HTML/Markdown işaretleri atılır) ve Kapı Kuralı süzgecinden (src/lib/suzgec.js guvenliMetin)
 *    geçer; ikisinden biri geçmezse bildirimin TAMAMI gösterilmez (kapı/kilit/alarm/garaj/bariyer/siren/kepenk içeren metin hiçbir
 *    yüzeye girmez).
 *  - Düğmeler (data.actions): en çok 3; düğme başlığı VE eylem kimliği Kapı Kuralı'ndan geçmeyen, kimliği düz desene uymayan, bağlantı
 *    açan ('URI') ya da metin girişi isteyen (behavior: textInput) düğme sessizce düşer (kalanlar gösterilir). Eylem kimliği
 *    renderer'a GİTMEZ: sayfa yalnız düğme sırasını ve başlığını görür, hangi kimliğin HA'ya gideceğine ana süreç karar verir.
 *  - Uzaktan komutlar ('clear_notification' hariç: etiketle eşleşen kartı kapatır) gösterilmez ve çalıştırılmaz: konum isteği,
 *    command_* ve kanal silme iletileri yok sayılır. Görsel, bağlantı ve ses alanları hiç okunmaz (uzak içerik yüklenmez).
 *
 * Bu dosya hiçbir şey günlüğe yazmaz ve ileti içeriğini hiçbir yere taşımaz.
 */

const { guvenliMetin, adGuvenliMi } = require('./suzgec');
const { duzMetin } = require('./bildirim-merkezi');

const EN_COK_DUGME = 3;
const BASLIK_SINIRI = 60;
const MESAJ_SINIRI = 240;
const DUGME_BASLIK_SINIRI = 24;
const TARANAN_DUGME_SINIRI = 8; // bundan fazla düğme girdisi hiç incelenmez
const ETIKET_DESENI = /^[A-Za-z0-9_.:-]{1,64}$/;
const EYLEM_KIMLIGI_DESENI = /^[A-Za-z0-9_.:-]{1,64}$/;
const KOMUT_DESENI = /^(clear_notification|request_location_update|remove_channel|command_[a-z_]{1,40})$/;

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/** Etiket (tag): düz desen + Kapı Kuralı; geçmezse null (bildirim yine gösterilir, etiketsiz). */
function etiketDuzelt(ham) {
  return typeof ham === 'string' && ETIKET_DESENI.test(ham) && adGuvenliMi('', ham) ? ham : null;
}

/**
 * Eylem kimliği HA'ya gönderilebilir mi (düz desen + Kapı Kuralı)? webhook gövdesi (mobil-kayit.js) son kapıda aynısını yeniden sınar.
 * @param {unknown} kimlik
 */
function eylemKimligiGuvenliMi(kimlik) {
  return typeof kimlik === 'string' && EYLEM_KIMLIGI_DESENI.test(kimlik) && kimlik.toUpperCase() !== 'URI' && adGuvenliMi('', kimlik);
}

/** Tek düğme girdisi -> { eylem, baslik } ya da null (düşer). */
function dugmeCoz(ham) {
  if (!duzNesneMi(ham)) return null;
  if (!eylemKimligiGuvenliMi(ham.action)) return null;
  if (typeof ham.uri === 'string' && ham.uri !== '') return null; // bağlantı açan düğme: bu uygulama adres açmaz
  if (ham.behavior === 'textInput') return null; // metin girişi arayüzü yok: yanıtsız eylem gönderilmez
  const baslik = typeof ham.title === 'string' ? guvenliMetin(duzMetin(ham.title), DUGME_BASLIK_SINIRI) : null;
  return baslik === null ? null : { eylem: ham.action, baslik };
}

/**
 * WS itme kanalından gelen yükü çözer.
 * @param {unknown} olay HA 'event' iletisinin event alanı: { message, title?, data?: { tag?, actions?: [{ action, title, uri?, behavior? }] } }
 * @returns {{ tur: 'goster', baslik: string|null, mesaj: string, etiket: string|null, dugmeler: {eylem: string, baslik: string}[], dusenDugme: number }
 *   | { tur: 'temizle', etiket: string }
 *   | { tur: 'yoksay', neden: 'bicim' | 'komut' | 'bos' | 'guvensiz' }}
 */
function bildirimiCoz(olay) {
  if (!duzNesneMi(olay) || typeof olay.message !== 'string') return { tur: 'yoksay', neden: 'bicim' };
  const veri = duzNesneMi(olay.data) ? olay.data : {};
  const etiket = etiketDuzelt(veri.tag);

  const komut = olay.message.trim();
  if (KOMUT_DESENI.test(komut)) {
    return komut === 'clear_notification' && etiket !== null ? { tur: 'temizle', etiket } : { tur: 'yoksay', neden: 'komut' };
  }

  const duz = duzMetin(olay.message);
  if (duz === '') return { tur: 'yoksay', neden: 'bos' };
  const mesaj = guvenliMetin(duz, MESAJ_SINIRI);
  if (mesaj === null) return { tur: 'yoksay', neden: 'guvensiz' };

  let baslik = null;
  if (olay.title !== undefined && olay.title !== null) {
    if (typeof olay.title !== 'string') return { tur: 'yoksay', neden: 'bicim' };
    const duzBaslik = duzMetin(olay.title);
    if (duzBaslik !== '') {
      baslik = guvenliMetin(duzBaslik, BASLIK_SINIRI);
      if (baslik === null) return { tur: 'yoksay', neden: 'guvensiz' };
    }
  }

  const dugmeler = [];
  let dusenDugme = 0;
  const girdiler = Array.isArray(veri.actions) ? veri.actions : [];
  for (const ham of girdiler.slice(0, TARANAN_DUGME_SINIRI)) {
    const dugme = dugmeCoz(ham);
    if (dugme === null || dugmeler.length >= EN_COK_DUGME || dugmeler.some((d) => d.eylem === dugme.eylem)) {
      dusenDugme += 1;
      continue;
    }
    dugmeler.push(dugme);
  }
  dusenDugme += Math.max(0, girdiler.length - TARANAN_DUGME_SINIRI);
  return { tur: 'goster', baslik, mesaj, etiket, dugmeler, dusenDugme };
}

module.exports = {
  EN_COK_DUGME,
  BASLIK_SINIRI,
  MESAJ_SINIRI,
  DUGME_BASLIK_SINIRI,
  ETIKET_DESENI,
  EYLEM_KIMLIGI_DESENI,
  etiketDuzelt,
  eylemKimligiGuvenliMi,
  dugmeCoz,
  bildirimiCoz,
};
