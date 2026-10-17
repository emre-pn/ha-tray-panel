'use strict';

/**
 * Karo görünümü: simge, renk ve boyut (saf) — 1.4.0 düzen grubu (o-31).
 *
 * Favori kaydındaki üç görünüm alanının TEK doğrulama yeri burasıdır; ana süreç (favoriler.js, yuzey-modeli.js) da panel ve Ayarlar
 * sayfaları (çizim ve seçici) da aynı tabloyu kullanır. Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/karo-gorunum.js">,
 * window.EvKaroGorunum) çalışır: `require` kullanmaz.
 *
 *  - simge  '' (yok) | 'ikon:<ad>' (aşağıdaki çizgi ikon seti; satır içi SVG yolu, CSP'ye uygun) | tek bir emoji (en çok 16 UTF-16 birimi).
 *           Kapı / kilit / anahtar / siren emojileri KAPI KURALI gereği simge olamaz (yalnızca sıkılaştırma: bir karoda görünmezler).
 *  - renk   '' (varsayılan) | hazır palet adı. Serbest renk YOK: renkler yuzey.css içinde iki temada kontrastı denetlenmiş
 *           sınıflardır (.renk-<ad>); satır içi stil ya da renk metni sayfaya hiç gitmez.
 *  - boyut  'normal' (varsayılan, kayıtta saklanmaz) | 'kucuk' | 'genis' (2 sütun) | 'buyuk' (3 sütun, tam genişlik).
 *  - Yalnız sensör favorisi: grafikTuru ('otomatik' varsayılan, kayıtta saklanmaz | 'cizgi' | 'gosterge' | 'yok') ile gostergeMin / gostergeMax
 *    (gösterge aralığı; ikisi birden ve min < max olmalı). Gösterge aralığı sensörün kendi min/max özniteliğinden önce gelir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvKaroGorunum = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Çizgi ikon seti: 24x24 görünüm kutusunda, çizgi (stroke) ile çizilen yollar. Ad -> SVG yol verisi. */
  const IKONLAR = Object.freeze({
    isik: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z',
    priz: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5',
    vantilator: 'M12 12v-8a3 3 0 0 1 3 3M12 12h8a3 3 0 0 1-3 3M12 12v8a3 3 0 0 1-3-3M12 12h-8a3 3 0 0 1 3-3',
    sahne: 'M4 8h16v12H4zM4 8l2-4h4l-2 4M10 8l2-4h4l-2 4M16 8l2-4h2v4',
    ekran: 'M3 4h18v12H3zM8 20h8M12 16v4',
    hoparlor: 'M5 3h14v18H5zM12 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    muzik: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
    kulaklik: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z',
    guc: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
    ev: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
    yatak: 'M3 18V6M3 14h18v4M21 18v-4a3 3 0 0 0-3-3h-8v3M7 11.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    kahve: 'M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 9h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
    telefon: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
    yildiz: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    ay: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
    gunes: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  });
  const IKON_ADLARI = Object.freeze(Object.keys(IKONLAR));
  const IKON_ONEKI = 'ikon:';
  const SVG_GORUNUM_KUTUSU = '0 0 24 24';

  const RENKLER = Object.freeze(['kirmizi', 'turuncu', 'sari', 'yesil', 'turkuaz', 'mavi', 'mor', 'pembe', 'gri']);
  const BOYUTLAR = Object.freeze(['kucuk', 'normal', 'genis', 'buyuk']);
  const VARSAYILAN_BOYUT = 'normal';
  /** Boyutun ızgarada kapladığı sütun sayısı (yuzey.css .boyut-* sınıflarıyla aynı). */
  const BOYUT_SUTUNU = Object.freeze({ kucuk: 1, normal: 1, genis: 2, buyuk: 3 });

  const EMOJI_SINIRI = 16;
  // Tek bir emoji: bayrak (iki bölge göstergesi), tuş kapağı (1️⃣) ya da resimli sembol + değiştirici/ZWJ dizisi.
  const EMOJI_DESENI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)$/u;
  // KAPI KURALI: kapı, kilit, anahtar, siren/alarm, bariyer/geçit ve pencere temalı emojiler hiçbir karoda simge olmaz (kapı, kilitli/açık kilit,
  // kilit+anahtar, anahtar, eski anahtar, acil ışığı, inşaat bariyeri, pencere, torii geçidi). Yalnızca sıkılaştırma: bir karoda görünmezler.
  const YASAK_EMOJI_KOD_NOKTALARI = Object.freeze(new Set([0x1f6aa, 0x1f512, 0x1f513, 0x1f510, 0x1f50f, 0x1f511, 0x1f5dd, 0x1f6a8, 0x1f6a7, 0x1fa9f, 0x26e9]));

  function yasakEmojiVarMi(metin) {
    for (const harf of metin) {
      if (YASAK_EMOJI_KOD_NOKTALARI.has(harf.codePointAt(0))) return true;
    }
    return false;
  }

  /**
   * Simge değerini çözer. @returns {{tur: 'ikon', ad: string, yol: string}|{tur: 'emoji', metin: string}|null}
   * Boş, geçersiz ya da yasak değer için null. Metin sayfaya HER ZAMAN textContent ile yazılır.
   */
  function simgeCoz(deger) {
    if (typeof deger !== 'string') return null;
    const metin = deger.trim();
    if (metin === '' || metin.length > EMOJI_SINIRI + IKON_ONEKI.length) return null;
    if (metin.startsWith(IKON_ONEKI)) {
      const ad = metin.slice(IKON_ONEKI.length);
      return Object.hasOwn(IKONLAR, ad) ? { tur: 'ikon', ad, yol: IKONLAR[ad] } : null;
    }
    if (metin.length > EMOJI_SINIRI || !EMOJI_DESENI.test(metin) || yasakEmojiVarMi(metin)) return null;
    return { tur: 'emoji', metin };
  }

  /**
   * Kayda yazılacak simge: '' = simge yok (temizle), geçerli değerin kendisi, geçersiz/yasak değer için null.
   * @returns {string|null}
   */
  function simgeDuzelt(deger) {
    if (typeof deger !== 'string') return null;
    if (deger.trim() === '') return '';
    const cozulmus = simgeCoz(deger);
    if (!cozulmus) return null;
    return cozulmus.tur === 'ikon' ? IKON_ONEKI + cozulmus.ad : cozulmus.metin;
  }

  /** '' = varsayılan renk; palet adı; aksi null. */
  function renkDuzelt(deger) {
    if (typeof deger !== 'string') return null;
    const ad = deger.trim();
    if (ad === '') return '';
    return RENKLER.includes(ad) ? ad : null;
  }

  /** '' ya da 'normal' = varsayılan ('normal' döner); geçerli boyut; aksi null. */
  function boyutDuzelt(deger) {
    if (typeof deger !== 'string') return null;
    const ad = deger.trim();
    if (ad === '') return VARSAYILAN_BOYUT;
    return BOYUTLAR.includes(ad) ? ad : null;
  }

  /** Sensör karosunun grafik biçimi. 'otomatik': aralığı biliniyorsa gösterge, geçmişi varsa çizgi (eski davranış). */
  const GRAFIK_TURLERI = Object.freeze(['otomatik', 'cizgi', 'gosterge', 'yok']);
  const VARSAYILAN_GRAFIK = 'otomatik';
  const GOSTERGE_SINIRI = 1e9;

  /** '' ya da 'otomatik' = varsayılan ('otomatik' döner); geçerli tür; aksi null. */
  function grafikTuruDuzelt(deger) {
    if (typeof deger !== 'string') return null;
    const ad = deger.trim();
    if (ad === '') return VARSAYILAN_GRAFIK;
    return GRAFIK_TURLERI.includes(ad) ? ad : null;
  }

  /**
   * Gösterge aralığı: ikisi de sonlu sayı (mutlak değeri en çok 1e9) ve alt < üst olmalı. Geçersizse null (tek sınır ya da ters aralık saklanmaz).
   * @returns {{gostergeMin: number, gostergeMax: number}|null}
   */
  function gostergeAraligiDuzelt(alt, ust) {
    const sayi = (d) => (typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= GOSTERGE_SINIRI ? d : null);
    const a = sayi(alt);
    const u = sayi(ust);
    return a !== null && u !== null && a < u ? { gostergeMin: a, gostergeMax: u } : null;
  }

  return {
    GRAFIK_TURLERI,
    VARSAYILAN_GRAFIK,
    GOSTERGE_SINIRI,
    grafikTuruDuzelt,
    gostergeAraligiDuzelt,
    IKONLAR,
    IKON_ADLARI,
    IKON_ONEKI,
    SVG_GORUNUM_KUTUSU,
    RENKLER,
    BOYUTLAR,
    VARSAYILAN_BOYUT,
    BOYUT_SUTUNU,
    EMOJI_SINIRI,
    simgeCoz,
    simgeDuzelt,
    renkDuzelt,
    boyutDuzelt,
  };
});
