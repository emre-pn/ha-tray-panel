'use strict';

/**
 * Sır içermeyen, döngülü günlük (saf; Electron'a bağlı değildir — dosya sistemi dışarıdan verilebilir) — hata-06.
 * Her satır yazılmadan önce sirTemizle'den geçer: erişim anahtarı, JWT, Bearer, URL içi parola ve webhook
 * kimliği günlüğe düşmez. Uygulama yine de günlüğe yalnız sabit/türetilmiş güvenli metinler yazar (savunma derinliği).
 * Günlük yazılamazsa uygulama durmaz.
 */

const path = require('node:path');

const SATIR_SINIRI = 400;
const VARSAYILAN_DOSYA = 'ev-paneli.log';
const VARSAYILAN_BOYUT_SINIRI = 256 * 1024;
const DONME_BEKLEME_YAZIMI = 50; // döndürme başarısız olunca bu kadar yazım boyunca yeniden denenmez

/** Günlüğe yazılacak metinden sırları ayıklar ve tek satıra, en çok 400 karaktere indirir. */
function sirTemizle(metin) {
  let s = String(metin ?? '');
  s = s.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//[gizli]@'); // URL içi kullanıcı:parola@
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [gizli]');
  s = s.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[jwt]');
  s = s.replace(/([?&](?:access_token|token|api_key|apikey|key|password|passwd|secret|webhook_id|auth)=)[^&\s]*/gi, '$1[gizli]');
  s = s.replace(/(\/api\/webhook\/)[^\s/?#]+/gi, '$1[gizli]');
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[uzun-dizi]');
  s = s.replace(/[\r\n]+/g, ' ');
  return s.length > SATIR_SINIRI ? `${s.slice(0, SATIR_SINIRI)}…` : s;
}

/**
 * @param {{ dizin?: string, dosya?: string, enFazlaBayt?: number, fs?: object, konsol?: boolean, simdi?: () => Date }} secenek
 *   dizin yoksa yalnız konsola yazılır. Dosya `enFazlaBayt`ı aşınca `<ad>.1.log`'a döndürülür (tek yedek).
 * @returns {{ yaz: (mesaj: string) => void, yol: string|null, eskiYol: string|null }}
 */
function gunlukOlustur({
  dizin,
  dosya = VARSAYILAN_DOSYA,
  enFazlaBayt = VARSAYILAN_BOYUT_SINIRI,
  fs = require('node:fs'),
  konsol = false,
  simdi = () => new Date(),
} = {}) {
  const yol = dizin ? path.join(dizin, dosya) : null;
  const eskiYol = yol ? yol.replace(/\.log$/, '.1.log') : null;
  let dizinHazir = false;
  let boyut = null; // bellekteki dosya boyutu (ilk yazımda diskten okunur)
  let donmeBekle = 0;

  function yaz(mesaj) {
    const temiz = sirTemizle(mesaj);
    if (konsol) console.log(`[Ev Paneli] ${temiz}`);
    if (!yol) return;
    try {
      const satir = `${simdi().toISOString()} ${temiz}\n`;
      if (!dizinHazir) {
        fs.mkdirSync(dizin, { recursive: true });
        dizinHazir = true;
      }
      if (boyut === null) {
        try {
          boyut = fs.statSync(yol).size;
        } catch {
          boyut = 0;
        }
      }
      if (boyut > 0 && boyut + Buffer.byteLength(satir) > enFazlaBayt) {
        if (donmeBekle > 0) donmeBekle -= 1;
        else {
          // Yeniden adlandırma var olan yedeğin üzerine yazar (önce silmek, döndürme başarısız olunca yedeği boş yere kaybettirirdi).
          try {
            fs.renameSync(yol, eskiYol);
            boyut = 0;
          } catch {
            donmeBekle = DONME_BEKLEME_YAZIMI; // dosya kilitli (antivirüs, izleyici...): satır yine eklenir, her satırda yeniden denenmez
          }
        }
      }
      fs.appendFileSync(yol, satir, 'utf8');
      boyut += Buffer.byteLength(satir);
    } catch {
      /* günlük yazılamazsa uygulama durmaz */
    }
  }

  return { yaz, yol, eskiYol };
}

module.exports = { SATIR_SINIRI, VARSAYILAN_DOSYA, VARSAYILAN_BOYUT_SINIRI, sirTemizle, gunlukOlustur };
