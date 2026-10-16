'use strict';

/**
 * Ana pencerede gezinti yardımcıları (saf).
 *  - yolGecerliMi: HA içinde yalnız "/lovelace/ev" gibi güvenli yol (ve ?sorgu, #parça) kabul edilir.
 *  - sayfaYolu: ana pencerede açık HA sayfasının adresinden pano yolu çıkarır ("bu sayfayı pano yap").
 *  - gizliKalmaAsildiMi: pencere uzun süre gizli kaldıysa ana panoya dönmek için.
 *  - gecmisOffseti: geri/ileri giderken uygulamanın kendi durum sayfalarını (file:) atlar.
 */

// Yol: "." yok (".." ve dosya uzantıları giremez). Sorgu (?a=1&b=2, k-18): yalnız harf, rakam ve _ - = & . % , + ;
// "/" ve ":" sorguda da yoktur: şema, "//host" ya da yol kaçışı kurulamaz. Adres her zaman ayardaki HA kökenine eklenir.
const YOL_DESENI = /^\/(?!\/)[A-Za-z0-9_\-/]{0,120}(?:\?[A-Za-z0-9_\-=&.%,+]{1,120})?(?:#[A-Za-z0-9_\-=&]{1,80})?$/;
// HA'nın API, kimlik doğrulama ve özel dosya yolları pano değildir ("/api?x=1" de değildir).
const YASAK_YOL_ONEKLERI = /^\/(?:api|auth|local|hacsfiles)(?:[/#?]|$)/i;

function yolGecerliMi(yol) {
  if (typeof yol !== 'string' || yol.length > 220) return false;
  if (!YOL_DESENI.test(yol)) return false;
  return !YASAK_YOL_ONEKLERI.test(yol);
}

/**
 * Açık HA sayfasının pano yolu (k-18): `url` ayardaki `koken`e aitse yol + sorgu + parça; yolGecerliMi'den geçmezse önce
 * parça, sonra sorgu atılarak denenir (ör. geçersiz bir sorgu yüzünden sayfa tümden reddedilmesin). Hiçbiri geçmezse null.
 * @param {string} url ana penceredeki adres
 * @param {string} koken beklenen HA kökeni ("https://ev.example.com")
 * @returns {string|null}
 */
function sayfaYolu(url, koken) {
  if (typeof url !== 'string' || typeof koken !== 'string' || koken === '') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== koken) return null;
  const adaylar = [`${u.pathname}${u.search}${u.hash}`, `${u.pathname}${u.search}`, `${u.pathname}${u.hash}`, u.pathname];
  return adaylar.find((aday) => yolGecerliMi(aday)) ?? null;
}

/** gizlenme: Date.now() değeri (0/null = hiç gizlenmedi); dk = 0 -> özellik kapalı. */
function gizliKalmaAsildiMi(gizlenme, simdi, dk) {
  if (!Number.isFinite(dk) || dk <= 0) return false;
  if (!Number.isFinite(gizlenme) || gizlenme <= 0) return false;
  return simdi - gizlenme > dk * 60_000;
}

/**
 * Geçmişte `yon` (-1 geri, +1 ileri) yönünde, file: sayfalarını atlayarak gidilecek göreli konumu bulur.
 * @param {(string|null)[]} adresler geçmiş girdilerinin adresleri (sırayla)
 * @returns {number|null} goToOffset için sapma; gidilecek yer yoksa null
 */
function gecmisOffseti(adresler, aktifIndeks, yon) {
  if (!Array.isArray(adresler) || !Number.isInteger(aktifIndeks) || (yon !== 1 && yon !== -1)) return null;
  for (let adim = 1; adim <= 20; adim += 1) {
    const hedef = aktifIndeks + yon * adim;
    if (hedef < 0 || hedef >= adresler.length) return null;
    const adres = adresler[hedef];
    if (typeof adres !== 'string' || adres.startsWith('file:')) continue;
    return yon * adim;
  }
  return null;
}

module.exports = { yolGecerliMi, sayfaYolu, gizliKalmaAsildiMi, gecmisOffseti };
