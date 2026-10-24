'use strict';

/**
 * Pano kısayolları (pencere-02): ayarlarda en çok 6 { ad, yol, kisayol? } kaydı. Kısayola basınca ana pencere o HA panosunu açar.
 * Yol yalnız güvenli bir HA yolu olabilir (gezinti.yolGecerliMi: "/lovelace/ev" biçimi; /api, /auth vb. değil); adres
 * ayardaki HA kökenine eklenir, dışarıya hiçbir yere gidilmez. Pano bir varlık eylemi DEĞİLDİR: HA'nın kendi arayüzünü açar.
 */

const { yolGecerliMi } = require('./gezinti');
const { EN_COK_PANO, kisayolDogrula, kisayolNormallestir } = require('./kisayol');

const AD_SINIRI = 30;

/**
 * @param {unknown} oge
 * @returns {{ pano: {ad: string, yol: string, kisayol?: string}|null, kisayolAtildi: boolean }}
 */
function panoDuzelt(oge) {
  if (!oge || typeof oge !== 'object' || Array.isArray(oge)) return { pano: null, kisayolAtildi: false };
  // Sınır UTF-16 birimine değil kod noktasına göre uygulanır: sınırdaki emoji ikiye bölünüp eşleşmemiş vekil karakter bırakmasın.
  const ad = typeof oge.ad === 'string' ? Array.from(oge.ad.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim()).slice(0, AD_SINIRI).join('').trim() : '';
  const yol = typeof oge.yol === 'string' ? oge.yol.trim() : '';
  if (ad === '' || !yolGecerliMi(yol)) return { pano: null, kisayolAtildi: false };
  const pano = { ad, yol };
  let kisayolAtildi = false;
  if (typeof oge.kisayol === 'string' && oge.kisayol.trim() !== '') {
    if (kisayolDogrula(oge.kisayol.trim()).gecerli) pano.kisayol = kisayolNormallestir(oge.kisayol.trim());
    else kisayolAtildi = true;
  }
  return { pano, kisayolAtildi };
}

/**
 * @param {unknown} liste
 * @returns {{ panolar: {ad: string, yol: string, kisayol?: string}[], atilanlar: number, kisayolAtilanlar: number, fazla: number }}
 *   atilanlar: geçersiz (ad/yol) yüzünden düşen; fazla: 6 sınırını aşan
 */
function panolariDuzelt(liste) {
  const panolar = [];
  let atilanlar = 0;
  let kisayolAtilanlar = 0;
  let fazla = 0;
  if (!Array.isArray(liste)) return { panolar, atilanlar, kisayolAtilanlar, fazla };
  for (const oge of liste) {
    const { pano, kisayolAtildi } = panoDuzelt(oge);
    if (!pano) {
      atilanlar += 1;
      continue;
    }
    if (panolar.length >= EN_COK_PANO) {
      fazla += 1;
      continue;
    }
    if (kisayolAtildi) kisayolAtilanlar += 1;
    panolar.push(pano);
  }
  return { panolar, atilanlar, kisayolAtilanlar, fazla };
}

module.exports = { AD_SINIRI, panoDuzelt, panolariDuzelt };
