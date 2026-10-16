'use strict';

/**
 * Arayüz dili çekirdeği (saf; Electron'a bağlı değildir): dil seçimi, çevirmen ve sayfa çevirisi.
 *
 * Diller: 'tr' (varsayılan), 'en', 'de', 'fr' ve 'es'. Ayardaki `dil` alanı 'sistem' ya da bu dillerden biri olabilir; 'sistem' Windows/Electron
 * dilinden çözülür (tanınmayan sistem dili İngilizce olur).
 * Metinler alan başına ayrı sözlük dosyalarındadır (src/lib/ceviri/ana.js, ayarlar.js, yuzey.js); her biri { tr, en, de, fr, es } verir.
 * Türkçe metinler HTML'de varsayılan olarak durur; başka dil seçiliyse sayfa çalışma anında sayfayiCevir ile değiştirilir.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/dil.js">, window.EvDil) çalışır: `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvDil = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DILLER = Object.freeze(['tr', 'en', 'de', 'fr', 'es']);
  const VARSAYILAN_DIL = 'tr';
  /** Ayarda saklanabilen değerler ('sistem' = işletim sistemi dilini izle). */
  const DIL_AYARLARI = Object.freeze(['sistem', ...DILLER]);
  const VARSAYILAN_DIL_AYARI = 'sistem';
  /** Sistem dili tanınmazsa kullanılan dil (desteklenen dillerden birinde olmayan herkes İngilizce görür). */
  const YEDEK_DIL = 'en';
  /** Dil -> Intl/toLocale* yerel adı (sayı, tarih, saat ve büyük harf yazımı bu adla yapılır). */
  const YEREL_ADLARI = Object.freeze({ tr: 'tr-TR', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' });

  /**
   * Ayardaki değeri etkin dile çözer.
   * @param {unknown} ayar 'sistem' | 'tr' | 'en' | 'de' | 'fr' | 'es'; geçersiz ya da eksikse 'tr'
   * @param {unknown} [sistemDili] ör. 'tr-TR', 'en-US', 'de-AT' (app.getLocale()); yalnız ayar 'sistem' iken kullanılır
   * @returns {'tr'|'en'|'de'|'fr'|'es'}
   */
  function dilCoz(ayar, sistemDili) {
    if (typeof ayar === 'string' && DILLER.includes(ayar)) return ayar;
    if (ayar !== 'sistem') return VARSAYILAN_DIL;
    if (typeof sistemDili !== 'string' || sistemDili.trim() === '') return VARSAYILAN_DIL;
    const sistem = sistemDili.trim().toLowerCase();
    return DILLER.find((d) => new RegExp(`^${d}(?:[-_]|$)`).test(sistem)) ?? YEDEK_DIL;
  }

  /** Dilin Intl yerel adı ('tr-TR', 'en-US', 'de-DE', 'fr-FR', 'es-ES'); bilinmeyen dil Türkçe sayılır. */
  function yerelAdi(dil) {
    return Object.hasOwn(YEREL_ADLARI, dil) ? YEREL_ADLARI[dil] : YEREL_ADLARI[VARSAYILAN_DIL];
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
   * @param {string} dil 'tr' | 'en' | 'de' | 'fr' | 'es' (geçersizse 'tr')
   * @param {...{tr?: object, en?: object, de?: object, fr?: object, es?: object}} sozlukler
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
   * Sayıya bağlı metin: n tekil sayılıyorsa ve `anahtar.bir` sözlükte varsa tekil karşılığı, değilse `anahtar` kullanılır. {n} otomatik doldurulur.
   * Tekil: her dilde n === 1; Fransızcada sıfır da tekil sayılır ("0 favori").
   * @param {Function} t cevirmen sonucu
   */
  function cogul(t, anahtar, n, degiskenler = {}) {
    const tekilSayi = n === 1 || (n === 0 && t.dil === 'fr');
    const tekil = tekilSayi && typeof t.var === 'function' && t.var(`${anahtar}.bir`);
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

  return {
    DILLER,
    VARSAYILAN_DIL,
    DIL_AYARLARI,
    VARSAYILAN_DIL_AYARI,
    YEDEK_DIL,
    YEREL_ADLARI,
    dilCoz,
    yerelAdi,
    dilAyariDuzelt,
    cevirmen,
    cogul,
    sayfayiCevir,
  };
});
