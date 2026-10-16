'use strict';

/**
 * Yinelenen tetikleme engeli (saf; saat dışarıdan verilebilir) — eylem/palet/pano kısayolları için.
 *
 * Windows'ta RegisterHotKey, MOD_NOREPEAT verilmezse tuş basılı tutulurken WM_HOTKEY'i klavye tekrar hızında yeniden üretir
 * (Chromium'un global kısayol dinleyicisinde bu bayrak kullanılmaz; bu ortamda DENENMEDİ). Engel olmasa ışık/priz kısayoluna
 * 0,5 sn'den uzun basmak aç/kapa titremesi yaratırdı (yalnız varlık başına saniyede 8 çağrı sınırı vardı).
 *
 * Sönümleme (debounce): bir kısayol, ÖNCEKİ olaydan (kabul edilen ya da yok sayılan) beri `sureMs` dolmadan tekrar gelirse yok
 * sayılır ve süre yeniden başlar. Böylece basılı tutma tek tetikleme sayılır; bırakıp `sureMs` sonra basmak yeniden çalışır.
 * `sureMs`, Windows'un en yavaş tuş tekrarı gecikmesinden (~750 ms ayarına kadar) biraz büyüktür.
 */

const SONUMLEME_MS = 800;
const EN_COK_ANAHTAR = 64;

/**
 * @param {{simdi?: () => number, sureMs?: number}} [secenek]
 */
function tekrarEngeliOlustur({ simdi = () => Date.now(), sureMs = SONUMLEME_MS } = {}) {
  const sonOlay = new Map(); // anahtar -> son olay zamanı
  return {
    /**
     * @param {string} anahtar kısayol (hızlandırıcı) ya da başka bir ayırt edici
     * @returns {boolean} true = geçerli tetikleme (çalıştır); false = yinelenen (yok say)
     */
    gec(anahtar) {
      const t = simdi();
      const onceki = sonOlay.get(anahtar);
      sonOlay.set(anahtar, t);
      if (sonOlay.size > EN_COK_ANAHTAR) {
        for (const [k, z] of sonOlay) if (t - z >= sureMs) sonOlay.delete(k);
      }
      return onceki === undefined || t - onceki >= sureMs;
    },
    temizle() {
      sonOlay.clear();
    },
  };
}

module.exports = { SONUMLEME_MS, tekrarEngeliOlustur };
