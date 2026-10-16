'use strict';

/**
 * Tema ve pencere vurgu rengi ayarları (saf) — gorunum-13.
 *
 * `temaZorla`: 'koyu' ya da 'sistem'. 'koyu' iken nativeTheme.themeSource = 'dark' olur (Electron'un çizdiği arayüzler
 * ve Windows başlık çubuğu için; başlık çubuğunun gerçekten koyulaştığı DENENMEDİ). Yan etki: Home Assistant profilinde tema
 * "otomatik" ise HA de koyu görünür (prefers-color-scheme).
 * `vurguRengi`: '' (Windows'un vurgu rengi) ya da "#rrggbb" (pencere kenarlığı için setAccentColor).
 * Özel başlık çubuğu YAPILMAZ (kırılgan; HA sayfasına sürükleme alanı enjekte etmek gerekir).
 */

const TEMA_DEGERLERI = ['koyu', 'sistem'];
const VARSAYILAN_TEMA = 'koyu';
const VURGU_DESENI = /^#[0-9a-fA-F]{6}$/;

/** Ayardan gelen tema değerini düzeltir; geçersizse `varsayilan`. */
function temaDuzelt(deger, varsayilan = VARSAYILAN_TEMA) {
  if (TEMA_DEGERLERI.includes(deger)) return deger;
  return TEMA_DEGERLERI.includes(varsayilan) ? varsayilan : VARSAYILAN_TEMA;
}

/** nativeTheme.themeSource değeri. */
function temaKaynagi(tema) {
  return temaDuzelt(tema) === 'koyu' ? 'dark' : 'system';
}

/**
 * Vurgu rengini düzeltir: boş metin -> '' (sistem rengi), "#rrggbb" -> küçük harfli aynısı; başka her şey (3 haneli kısa
 * biçim, ad, rgb(), metin olmayan değer) -> null (geçersiz).
 * @returns {string|null}
 */
function vurguRengiDuzelt(deger) {
  if (typeof deger !== 'string') return null;
  const metin = deger.trim();
  if (metin === '') return '';
  return VURGU_DESENI.test(metin) ? metin.toLowerCase() : null;
}

module.exports = { TEMA_DEGERLERI, VARSAYILAN_TEMA, VURGU_DESENI, temaDuzelt, temaKaynagi, vurguRengiDuzelt };
