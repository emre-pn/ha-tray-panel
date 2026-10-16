'use strict';

/**
 * Ayarlar penceresinde arama (o-26). Sayfadaki bölümleri (`.bolum`: kartlar ve katlanır `details`) ve içlerindeki ayar kümelerini
 * (`.form-grubu`: etiket + giriş + yardım metni) sorguya göre süzer; eşleşen bölümü açar, eşleşmeyeni gizler, sorgu silinince sayfayı
 * AYNEN eski haline döndürür (bölümlerin açık/kapalı durumu dahil). Eşleşme yalnız sayfada görünen metne (etiket, yardım metni,
 * seçenek adları, bölüm başlığı ve açıklaması) bakar: sayfa hangi dildeyse o dilde aranır.
 *
 * Kurallar
 *  - Sorgu boşlukla ayrılan sözcüklerdir; her sözcük metinde ALT DİZGE olarak geçmelidir (VE). Paletin bulanık harf-sırası eşleşmesi
 *    kullanılmaz: uzun yardım metinlerinde her şeyi eşleştirirdi. Türkçe harf katlaması paletin kodundan gelir (arama.js katlaDizi):
 *    "Işık", "isik", "IŞIK" aynıdır.
 *  - Bölüm düzeyinde eşleşme (başlık, açıklama ve ayar kümesi dışındaki metinler): bölümün TÜM ayarları görünür kalır.
 *    Aksi halde yalnız eşleşen ayar kümeleri görünür (küme metnine bölüm başlığı da eklenir: "görünüm tema").
 *  - Gizleme yalnız `arama-gizli` sınıfıyla yapılır; sayfanın kendi `style.display` kararlarına (uyarı kutuları, düğmeler) dokunulmaz.
 *  - HTML ataması yok: yalnız sınıf ve `open` özelliği değişir.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/ayar-arama.js">, window.EvAyarArama) çalışır; `require` kullanmaz.
 * Katlama işlevi (EvArama.katlaDizi) dışarıdan verilir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvAyarArama = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GIZLI_SINIF = 'arama-gizli';
  const EN_COK_SORGU = 100;

  const DUGUM_METIN = 3;
  const DUGUM_OGE = 1;
  const ATLANAN_ETIKETLER = new Set(['script', 'style']);

  /**
   * Katlanmış metin: küçük harf, aksansız, tek boşluklu.
   * @param {(m: string) => string[]} katlaDizi
   */
  function katlamaOlustur(katlaDizi) {
    return function katla(metin) {
      return katlaDizi(String(metin ?? '')).join('').replace(/\s+/g, ' ').trim();
    };
  }

  /** Sorgudaki katlanmış sözcükler (en çok EN_COK_SORGU karakter). */
  function sorguSozcukleri(sorgu, katla) {
    const duz = katla(String(sorgu ?? '').slice(0, EN_COK_SORGU));
    return duz === '' ? [] : duz.split(' ');
  }

  /** Her sözcük katlanmış metinde geçiyor mu? */
  function eslesirMi(sozcukler, katlanmisMetin) {
    return sozcukler.length > 0 && sozcukler.every((s) => katlanmisMetin.includes(s));
  }

  /** Öğenin metni (alt ağaç). atla(oge) true dönen alt öğeler (ve altları) dışarıda kalır. */
  function ogeMetni(oge, atla) {
    let metin = '';
    for (const d of oge.childNodes ?? []) {
      if (d.nodeType === DUGUM_METIN) {
        metin += ` ${d.textContent ?? ''}`;
      } else if (d.nodeType === DUGUM_OGE) {
        if (ATLANAN_ETIKETLER.has(String(d.tagName).toLowerCase())) continue;
        if (atla && atla(d)) continue;
        metin += ` ${ogeMetni(d, atla)}`;
      }
    }
    return metin;
  }

  const kumeMi = (oge) => !!oge.classList && oge.classList.contains('form-grubu');
  const detaysMi = (oge) => String(oge.tagName).toLowerCase() === 'details';

  /**
   * @param {object} secenek
   * @param {Document} secenek.belge sayfa (querySelectorAll gerekir)
   * @param {(m: string) => string[]} secenek.katla paletin katlaDizi işlevi (EvArama.katlaDizi)
   */
  function olustur({ belge, katla: katlaDizi }) {
    const katla = katlamaOlustur(katlaDizi);
    let oncekiAcik = null; // Map<details, boolean>: arama başlamadan önceki açık durumları

    function gizle(oge, gizli) {
      if (gizli) oge.classList.add(GIZLI_SINIF);
      else oge.classList.remove(GIZLI_SINIF);
    }

    function bolumler() {
      return Array.from(belge.querySelectorAll('.bolum'));
    }

    /** Tüm gizlemeleri kaldırır, bölümlerin açık/kapalı durumunu arama öncesine döndürür. */
    function temizle() {
      for (const sinif of ['.bolum', '.form-grubu', '.grup-baslik']) {
        for (const oge of Array.from(belge.querySelectorAll(sinif))) gizle(oge, false);
      }
      if (oncekiAcik) {
        for (const [oge, acik] of oncekiAcik) oge.open = acik;
        oncekiAcik = null;
      }
    }

    /**
     * Sorguyu uygular. Boş sorgu sayfayı eski haline döndürür.
     * @returns {{aktif: boolean, bolumSayisi: number, ilk: object|null}} ilk: ilk eşleşen öğe (kaydırmak için)
     */
    function uygula(sorgu) {
      const sozcukler = sorguSozcukleri(sorgu, katla);
      if (sozcukler.length === 0) {
        temizle();
        return { aktif: false, bolumSayisi: 0, ilk: null };
      }
      const liste = bolumler();
      if (oncekiAcik === null) {
        oncekiAcik = new Map();
        for (const b of liste) if (detaysMi(b)) oncekiAcik.set(b, !!b.open);
      }
      let bolumSayisi = 0;
      let ilk = null;
      let digerGorunur = false;
      for (const b of liste) {
        const baslik = Array.from(b.querySelectorAll('.bolum-baslik'))[0];
        const baslikMetni = katla(baslik ? ogeMetni(baslik) : '');
        const ustMetin = katla(ogeMetni(b, kumeMi));
        const bolumEslesti = eslesirMi(sozcukler, ustMetin);
        let kumeEslesen = 0;
        let ilkKume = null;
        for (const k of Array.from(b.querySelectorAll('.form-grubu'))) {
          const eslesti = bolumEslesti || eslesirMi(sozcukler, `${baslikMetni} ${katla(ogeMetni(k))}`);
          gizle(k, !eslesti);
          if (eslesti) {
            kumeEslesen += 1;
            ilkKume ??= k;
          }
        }
        const gorunur = bolumEslesti || kumeEslesen > 0;
        gizle(b, !gorunur);
        if (!gorunur) continue;
        bolumSayisi += 1;
        ilk ??= bolumEslesti ? b : ilkKume;
        if (detaysMi(b)) {
          b.open = true; // gizli (katlanmış) bölümde eşleşme varsa açılır
          digerGorunur = true;
        }
      }
      for (const g of Array.from(belge.querySelectorAll('.grup-baslik'))) gizle(g, !digerGorunur);
      return { aktif: true, bolumSayisi, ilk };
    }

    return { uygula, temizle };
  }

  return { GIZLI_SINIF, EN_COK_SORGU, katlamaOlustur, sorguSozcukleri, eslesirMi, ogeMetni, olustur };
});
