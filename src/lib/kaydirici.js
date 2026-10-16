'use strict';

/**
 * Yüzey (palet/panel) etkileşim zamanlayıcıları (saf; zamanlayıcılar dışarıdan verilebilir) — hiz-09, hiz-12, hata-04.
 *  - kisici: kaydırıcı sürüklenirken çağrıları en çok 200 ms'de bire indirir (ilk çağrı hemen, aradakilerin SONUNCUSU
 *    pencere sonunda); bırakılınca (son) değer HER ZAMAN gönderilir (ilk bırakma beklemeden; 200 ms içindeki ardışık
 *    bırakmalar tek gönderimde, EN SON değerle birleşir: ok tuşu basılı tutulan kaydırıcı HA'yı boğmaz).
 *  - tekrarlayici: ses -/+ düğmesi basılı tutulunca ~4 basış/sn (ilk basış hemen, 400 ms sonra 250 ms aralıkla).
 *  - basiliTutma: yıkıcı eylem onayı; düğme ~0,8 sn kesintisiz basılı tutulursa tamamlanır, önce bırakılırsa iptal olur.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/kaydirici.js">) çalışır: `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvKaydirici = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KISMA_MS = 200;
  const TEKRAR_ILK_GECIKME_MS = 400;
  const TEKRAR_ARALIK_MS = 250;
  const BASILI_TUTMA_MS = 800;

  /** Varsayılan zamanlayıcılar çağrı anında okunur (test saatleri küresel işlevleri değiştirebilir). */
  function varsayilanZaman() {
    return {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id) => globalThis.clearTimeout(id),
      simdi: () => Date.now(),
    };
  }

  /**
   * @param {(deger:any, son:boolean) => void} fn
   * @param {{beklemeMs?:number, zaman?:object}} [secenek]
   */
  function kisici(fn, { beklemeMs = KISMA_MS, zaman = varsayilanZaman() } = {}) {
    let sonCagri = -Infinity;
    let sonBirakma = -Infinity; // en son (son = true) gönderimin zamanı
    let bekleyen = { var: false, deger: undefined, son: false };
    let zamanlayici = null;

    function bosalt() {
      if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
      zamanlayici = null;
      bekleyen = { var: false, deger: undefined, son: false };
    }

    function pencereSonu() {
      zamanlayici = null;
      if (!bekleyen.var) return;
      const { deger, son } = bekleyen;
      bekleyen = { var: false, deger: undefined, son: false };
      sonCagri = zaman.simdi();
      if (son) sonBirakma = sonCagri;
      fn(deger, son);
    }

    return {
      /** Sürükleme sırasında her değişimde çağrılır. */
      cagir(deger) {
        if (bekleyen.son) {
          bekleyen.deger = deger; // bekleyen "son" gönderim her zaman EN GÜNCEL değeri taşır (eski bir değer yenisini ezmesin)
          return;
        }
        const gecen = zaman.simdi() - sonCagri;
        if (gecen >= beklemeMs && zamanlayici === null) {
          sonCagri = zaman.simdi();
          fn(deger, false);
          return;
        }
        bekleyen = { var: true, deger, son: false };
        if (zamanlayici === null) zamanlayici = zaman.setTimeout(pencereSonu, Math.max(0, beklemeMs - gecen));
      },
      /**
       * Bırakma: bekleyen ara çağrı atılır, son değer hemen ve `son = true` ile gönderilir. Önceki "son" gönderimden
       * beklemeMs dolmadan gelen bırakmalar (ok tuşu basılı tutulan kaydırıcı her adımda "change" üretir) tek bir gönderime
       * birleştirilir: değer kaybolmaz, pencere sonunda EN SON değer gider (en çok ~5 gönderim/sn).
       */
      son(deger) {
        const gecen = zaman.simdi() - sonBirakma;
        if (gecen >= beklemeMs) {
          bosalt();
          sonCagri = zaman.simdi();
          sonBirakma = sonCagri;
          fn(deger, true);
          return;
        }
        if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
        bekleyen = { var: true, deger, son: true };
        zamanlayici = zaman.setTimeout(pencereSonu, Math.max(0, beklemeMs - gecen));
      },
      iptal: bosalt,
    };
  }

  /**
   * Basılı tutunca tekrar: basla() hemen bir kez çağırır, ilkGecikmeMs sonra aralikMs aralıkla sürdürür; dur() keser.
   * @param {() => void} fn
   */
  function tekrarlayici(fn, { ilkGecikmeMs = TEKRAR_ILK_GECIKME_MS, aralikMs = TEKRAR_ARALIK_MS, zaman = varsayilanZaman() } = {}) {
    let zamanlayici = null;
    let calisiyor = false;

    function planla(ms) {
      zamanlayici = zaman.setTimeout(() => {
        zamanlayici = null;
        if (!calisiyor) return;
        fn();
        planla(aralikMs);
      }, ms);
    }

    return {
      basla() {
        if (calisiyor) return;
        calisiyor = true;
        fn();
        planla(ilkGecikmeMs);
      },
      dur() {
        calisiyor = false;
        if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
        zamanlayici = null;
      },
      calisiyorMu: () => calisiyor,
    };
  }

  /**
   * Basılı tutma onayı. basla() sayacı başlatır; sure dolunca `tamam` çağrılır (bir kez). birak() süre dolmadan
   * çağrılırsa iptal olur ve `iptal` çağrılır. Tamamlandıktan sonra birak() etkisizdir (yeni basla() gerekir).
   * @param {{sureMs?:number, tamam:() => void, basladi?:() => void, iptal?:() => void, zaman?:object}} secenek
   */
  function basiliTutma({ sureMs = BASILI_TUTMA_MS, tamam, basladi = () => {}, iptal = () => {}, zaman = varsayilanZaman() }) {
    let zamanlayici = null;
    let tutuyor = false;

    return {
      basla() {
        if (tutuyor) return false;
        tutuyor = true;
        basladi();
        zamanlayici = zaman.setTimeout(() => {
          zamanlayici = null;
          tutuyor = false;
          tamam();
        }, sureMs);
        return true;
      },
      birak() {
        if (!tutuyor) return;
        tutuyor = false;
        if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
        zamanlayici = null;
        iptal();
      },
      tutuyorMu: () => tutuyor,
    };
  }

  return { KISMA_MS, TEKRAR_ILK_GECIKME_MS, TEKRAR_ARALIK_MS, BASILI_TUTMA_MS, kisici, tekrarlayici, basiliTutma };
});
