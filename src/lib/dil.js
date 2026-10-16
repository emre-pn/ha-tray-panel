'use strict';

/**
 * Arayüz dili çekirdeği (saf; Electron'a bağlı değildir): dil seçimi, çevirmen ve sayfa çevirisi.
 *
 * Diller: 'tr' (varsayılan) ve 'en'. Ayardaki `dil` alanı 'sistem' | 'tr' | 'en' olabilir; 'sistem' Windows/Electron dilinden çözülür.
 * Metinler alan başına ayrı sözlük dosyalarındadır (src/lib/ceviri/ana.js, ayarlar.js, yuzey.js); her biri { tr: {...}, en: {...} } verir.
 * Türkçe metinler HTML'de varsayılan olarak durur; İngilizce seçiliyse sayfa çalışma anında sayfayiCevir ile değiştirilir.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/dil.js">, window.EvDil) çalışır: `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvDil = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DILLER = Object.freeze(['tr', 'en']);
  const VARSAYILAN_DIL = 'tr';
  /** Ayarda saklanabilen değerler ('sistem' = işletim sistemi dilini izle). */
  const DIL_AYARLARI = Object.freeze(['sistem', 'tr', 'en']);
  const VARSAYILAN_DIL_AYARI = 'sistem';

  /**
   * Ayardaki değeri etkin dile çözer.
   * @param {unknown} ayar 'sistem' | 'tr' | 'en'; geçersiz ya da eksikse 'tr'
   * @param {unknown} [sistemDili] ör. 'tr-TR', 'en-US' (app.getLocale()); yalnız ayar 'sistem' iken kullanılır
   * @returns {'tr'|'en'}
   */
  function dilCoz(ayar, sistemDili) {
    if (ayar === 'tr' || ayar === 'en') return ayar;
    if (ayar !== 'sistem') return VARSAYILAN_DIL;
    if (typeof sistemDili !== 'string' || sistemDili.trim() === '') return VARSAYILAN_DIL;
    return /^tr(?:[-_]|$)/.test(sistemDili.trim().toLowerCase()) ? 'tr' : 'en';
  }

  /** Ayar değerini düzeltir: bilinmeyen değer varsayılana ('sistem') döner. */
  function dilAyariDuzelt(deger, varsayilan = VARSAYILAN_DIL_AYARI) {
    return DIL_AYARLARI.includes(deger) ? deger : varsayilan;
  }

  const yerTutucu = /\{([A-Za-z0-9_]+)\}/g;

  function yerlestir(sablon, degiskenler) {
    if (!degiskenler || typeof degiskenler !== 'object') return sablon;
    return sablon.replace(yerTutucu, (eslesme, ad) => (Object.hasOwn(degiskenler, ad) ? String(degiskenler[ad]) : eslesme));
  }

  /**
   * Çevirmen üretir. Anahtar seçili dilin sözlüklerinde (verilme sırasıyla) aranır; yoksa Türkçeye, o da yoksa anahtarın kendisine düşer.
   * Metindeki {ad} yer tutucuları `degiskenler`den doldurulur (değişken yoksa yer tutucu olduğu gibi kalır).
   * @param {string} dil 'tr' | 'en' (geçersizse 'tr')
   * @param {...{tr?: object, en?: object}} sozlukler
   * @returns {((anahtar: string, degiskenler?: object) => string) & {dil: string, var: (anahtar: string) => boolean}}
   */
  function cevirmen(dil, ...sozlukler) {
    const etkin = DILLER.includes(dil) ? dil : VARSAYILAN_DIL;
    const bul = (d, anahtar) => {
      for (const sozluk of sozlukler) {
        const tablo = sozluk?.[d];
        if (tablo && Object.hasOwn(tablo, anahtar) && typeof tablo[anahtar] === 'string') return tablo[anahtar];
      }
      return null;
    };
    const t = (anahtar, degiskenler) => {
      const bulunan = bul(etkin, anahtar) ?? (etkin === VARSAYILAN_DIL ? null : bul(VARSAYILAN_DIL, anahtar));
      return bulunan === null ? String(anahtar) : yerlestir(bulunan, degiskenler);
    };
    t.dil = etkin;
    t.var = (anahtar) => bul(etkin, anahtar) !== null;
    return t;
  }

  /**
   * Sayıya bağlı metin: n === 1 ve `anahtar.bir` sözlükte varsa tekil karşılığı, değilse `anahtar` kullanılır. {n} otomatik doldurulur.
   * @param {Function} t cevirmen sonucu
   */
  function cogul(t, anahtar, n, degiskenler = {}) {
    const tekil = n === 1 && typeof t.var === 'function' && t.var(`${anahtar}.bir`);
    return t(tekil ? `${anahtar}.bir` : anahtar, { n, ...degiskenler });
  }

  /**
   * Sayfayı çevirir. `data-i18n="anahtar"` olan öğelerin textContent'i, `data-i18n-attr="placeholder:anahtar;title:anahtar2;aria-label:anahtar3"`
   * öznitelikleri t ile yazılır ve <html lang> ayarlanır. Anahtar sözlükte yoksa öğeye dokunulmaz (HTML'deki Türkçe varsayılan kalır).
   * @param {Document|Element} kok document ya da bir öğe
   * @param {Function} t cevirmen sonucu
   */
  function sayfayiCevir(kok, t) {
    if (!kok || typeof t !== 'function' || typeof kok.querySelectorAll !== 'function') return;
    const belge = kok.nodeType === 9 ? kok : kok.ownerDocument;
    if (belge?.documentElement && typeof t.dil === 'string') belge.documentElement.setAttribute('lang', t.dil);
    const varMi = typeof t.var === 'function' ? t.var : () => true;
    for (const oge of kok.querySelectorAll('[data-i18n]')) {
      const anahtar = oge.getAttribute('data-i18n');
      if (anahtar && varMi(anahtar)) oge.textContent = t(anahtar);
    }
    for (const oge of kok.querySelectorAll('[data-i18n-attr]')) {
      for (const parca of String(oge.getAttribute('data-i18n-attr')).split(';')) {
        const ayrac = parca.indexOf(':');
        if (ayrac <= 0) continue;
        const nitelik = parca.slice(0, ayrac).trim();
        const anahtar = parca.slice(ayrac + 1).trim();
        if (nitelik && anahtar && varMi(anahtar)) oge.setAttribute(nitelik, t(anahtar));
      }
    }
  }

  return { DILLER, VARSAYILAN_DIL, DIL_AYARLARI, VARSAYILAN_DIL_AYARI, dilCoz, dilAyariDuzelt, cevirmen, cogul, sayfayiCevir };
});
