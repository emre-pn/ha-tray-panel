'use strict';

/**
 * Sayfa süreci çökme sınırı (saf) — hata-06. Eskiden sayfa çökünce 1 sn sonra sınırsız yeniden yükleniyordu.
 * Artık: artan bekleme (1, 2, 4, 8 sn), 10 dakika içinde 5 çökmeden sonra otomatik yeniden yükleme DURUR
 * (çevrimdışı sayfada "COKME" gösterilir; kullanıcı elle yenileyince sayaç sıfırlanır).
 */

const COKME_PENCERESI_MS = 10 * 60 * 1000;
const EN_COK_COKME = 5;
const BEKLEME_SN = [1, 2, 4, 8, 15];

// Electron 'render-process-gone' nedenleri (günlüğe yalnız bunlar yazılır; bilinmeyen -> 'bilinmeyen').
const BILINEN_NEDENLER = new Set([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction',
]);

/** 'clean-exit' (normal kapanış) çökme sayılmaz. */
function cokmeSayilirMi(neden) {
  return neden !== 'clean-exit';
}

function cokmeNedeniMetni(neden) {
  return BILINEN_NEDENLER.has(neden) ? neden : 'bilinmeyen';
}

/**
 * @param {number[]} zamanlar çökme zamanları (ms), BU çökme dahil
 * @param {number} simdi şimdiki zaman (ms)
 * @returns {{ dur: boolean, bekleMs: number, sayi: number }}
 *   sayi: penceredeki çökme sayısı; dur: sınıra ulaşıldı, yeniden yükleme yapılmaz
 */
function cokmeKarari(zamanlar, simdi, { pencereMs = COKME_PENCERESI_MS, enCok = EN_COK_COKME, beklemeSn = BEKLEME_SN } = {}) {
  const sonlar = (Array.isArray(zamanlar) ? zamanlar : []).filter(
    (t) => Number.isFinite(t) && Number.isFinite(simdi) && simdi - t >= 0 && simdi - t <= pencereMs,
  );
  const sayi = sonlar.length;
  if (sayi >= enCok) return { dur: true, bekleMs: 0, sayi };
  const sn = beklemeSn[Math.min(Math.max(sayi - 1, 0), beklemeSn.length - 1)];
  return { dur: false, bekleMs: sn * 1000, sayi };
}

module.exports = {
  COKME_PENCERESI_MS,
  EN_COK_COKME,
  BEKLEME_SN,
  cokmeSayilirMi,
  cokmeNedeniMetni,
  cokmeKarari,
};
