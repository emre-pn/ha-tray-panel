'use strict';

/**
 * Basılı tutunca göster (o-60; saf — zamanlayıcılar ve pencere işlemleri dışarıdan verilir). Seçenek `kisayolBasiliTut`
 * (varsayılan KAPALI) açıksa ana kısayol "basılı tutulduğu sürece göster" gibi çalışır: tuş bırakılınca pencere gizlenir.
 *
 * YERLEŞİK TUŞ DİNLEYİCİSİ YOKTUR (uiohook gibi bir modül eklenmez; klavye dinlenmez). Tek bilgi kaynağı genel kısayolun KENDİ
 * tekrar olaylarıdır: Windows'ta RegisterHotKey, tuş basılı tutulurken (MOD_NOREPEAT verilmediyse) klavye tekrar hızında yeniden
 * tetiklenir (src/lib/tekrar-engeli.js aynı olguya dayanır; bu davranış bu ortamda DENENMEDİ). Algoritma:
 *   1. İlk tetikleme: pencere kapalıysa açılır (kapalı değilse kapatılır: sıradan bir geçiş). Bekleme penceresi başlar.
 *   2. Bekleme penceresi (Windows'un en yavaş ilk tekrar gecikmesi ~1 sn + pay) içinde ikinci bir tetikleme gelirse tuş
 *      TUTULUYOR demektir. Tekrar aralığı ölçülür; son birkaç aralığın en büyüğünün 2,5 katı (en az 200 ms, en çok 1250 ms)
 *      kadar tetikleme gelmezse tuş bırakılmış sayılır ve pencere (bu basışla açıldıysa) gizlenir.
 *   3. Pencere dolmadan ikinci tetikleme gelmediyse tuş TUTULAMIYOR (kısa basış ya da sistem tekrar üretmiyor): pencere açık kalır,
 *      yani davranış sıradan geçişe (aç/kapa) döner. Böylece tekrar olayı hiç gelmeyen bir sistemde kısayol kilitlenmez.
 *   Gizlendikten sonra kısa bir süre (350 ms) gelen tetiklemeler yok sayılır: yavaş bir sistemde araya giren boşluk pencerenin
 *   kapanıp tekrar açılmasına (titremeye) yol açmaz.
 */

const ILK_PENCERE_MS = 1100; // ilk tetiklemeden sonra ikinci tetiklemenin gelebileceği en uzun süre
const ILK_BIRAKMA_MS = 650; // ilk tekrardan sonra aralık henüz ölçülemezken bırakma beklemesi (en yavaş tekrar hızı ~400 ms)
const EN_AZ_BIRAKMA_MS = 200;
const EN_COK_BIRAKMA_MS = 1250;
const BIRAKMA_KATSAYISI = 2.5;
const SUSTURMA_MS = 350;
const ARALIK_SAYISI = 4;

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    simdi: () => Date.now(),
  };
}

/** Ölçülen tekrar aralıklarından bırakma bekleme süresi (ms). Aralık yoksa ILK_BIRAKMA_MS. */
function birakmaSuresi(araliklar) {
  const gecerli = araliklar.filter((a) => Number.isFinite(a) && a >= 0);
  if (gecerli.length === 0) return ILK_BIRAKMA_MS;
  const sure = Math.round(BIRAKMA_KATSAYISI * Math.max(...gecerli));
  return Math.min(EN_COK_BIRAKMA_MS, Math.max(EN_AZ_BIRAKMA_MS, sure));
}

/**
 * @param {object} bag
 * @param {() => unknown} bag.ac pencereyi göster
 * @param {() => unknown} bag.kapat pencereyi gizle
 * @param {() => boolean} bag.acikMi ilk basışta: pencere "açık" mı (açıksa bu basış kapatır, değilse açar)
 * @param {() => boolean} [bag.gorunurMu] bırakınca: pencere hâlâ görünür mü (görünürse gizlenir); verilmezse acikMi
 * @param {{setTimeout: Function, clearTimeout: Function, simdi: () => number}} [bag.zaman]
 * @returns {{tus: () => string, sifirla: () => void, durum: () => string}}
 */
function basiliTutOlustur({ ac, kapat, acikMi, gorunurMu = acikMi, zaman = varsayilanZaman() }) {
  let durum = 'bos'; // 'bos' | 'bekliyor' (ilk tetikleme oldu, tekrar bekleniyor) | 'tutuyor' (tekrar algılandı)
  let is = 'yoksay'; // bu basışın yaptığı iş: 'ac' (açtı: bırakınca gizlenir) | 'yoksay' (kapattı: bırakınca bir şey yapılmaz)
  let sonOlay = 0;
  let araliklar = [];
  let susturmaBitisi = 0;
  let zamanlayici = null;

  function zamanlayiciyiTemizle() {
    if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
    zamanlayici = null;
  }

  function kur(ms, fn) {
    zamanlayiciyiTemizle();
    zamanlayici = zaman.setTimeout(() => {
      zamanlayici = null;
      fn();
    }, ms);
  }

  function birakildi() {
    const idi = is;
    durum = 'bos';
    araliklar = [];
    is = 'yoksay';
    susturmaBitisi = zaman.simdi() + SUSTURMA_MS;
    if (idi === 'ac' && gorunurMu()) kapat();
  }

  function tutulamadi() {
    // İkinci tetikleme gelmedi: kısa basış (ya da tekrar üretmeyen sistem). Pencere olduğu gibi kalır; sıradan geçiş.
    durum = 'bos';
    araliklar = [];
    is = 'yoksay';
  }

  return {
    /**
     * Genel kısayol tetiklendi (ilk basış ya da tekrar).
     * @returns {'acildi'|'kapandi'|'tutuyor'|'yoksayildi'|'susturuldu'}
     */
    tus() {
      const t = zaman.simdi();
      if (durum === 'bos') {
        if (t < susturmaBitisi) {
          susturmaBitisi = t + SUSTURMA_MS;
          return 'susturuldu';
        }
        sonOlay = t;
        if (acikMi()) {
          kapat();
          is = 'yoksay';
        } else {
          ac();
          is = 'ac';
        }
        durum = 'bekliyor';
        kur(ILK_PENCERE_MS, tutulamadi);
        return is === 'ac' ? 'acildi' : 'kapandi';
      }
      const gecen = t - sonOlay;
      sonOlay = t;
      if (durum === 'bekliyor') {
        durum = 'tutuyor';
        araliklar = [];
      } else {
        araliklar = [...araliklar, gecen].slice(-ARALIK_SAYISI);
      }
      kur(birakmaSuresi(araliklar), birakildi);
      return 'tutuyor';
    },
    /** Ayar kapandı ya da uygulama çıkıyor: bekleyen her şey bırakılır; pencereye dokunulmaz. */
    sifirla() {
      zamanlayiciyiTemizle();
      durum = 'bos';
      is = 'yoksay';
      araliklar = [];
      susturmaBitisi = 0;
    },
    durum: () => durum,
  };
}

module.exports = { ILK_PENCERE_MS, ILK_BIRAKMA_MS, EN_AZ_BIRAKMA_MS, EN_COK_BIRAKMA_MS, SUSTURMA_MS, birakmaSuresi, basiliTutOlustur };
