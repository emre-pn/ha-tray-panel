'use strict';

/**
 * Bağlantı denemeleri arasındaki artan bekleme (saf): 2, 4, 8, 15 sn, sonra tavan.
 * Tavan = ayarlardaki "yeniden deneme" süresi (varsayılan 30 sn). Örnekler:
 *   tavan 30 -> 2, 4, 8, 15, 30, 30 ...   tavan 10 -> 2, 4, 8, 10, 10 ...   tavan 5 -> 2, 4, 5, 5 ...
 */

const DIZI_SN = [2, 4, 8, 15];
const VARSAYILAN_TAVAN_SN = 30;

/** @param {number} n kaçıncı ardışık başarısız deneme (0'dan başlar) */
function bekleSn(n, tavanSn) {
  const tavan = Number.isFinite(tavanSn) && tavanSn >= 1 ? tavanSn : VARSAYILAN_TAVAN_SN;
  const sira = Number.isInteger(n) && n > 0 ? n : 0;
  return Math.min(sira < DIZI_SN.length ? DIZI_SN[sira] : tavan, tavan);
}

module.exports = { DIZI_SN, bekleSn };
