'use strict';

/**
 * Düğmeli itme bildirimi kartlarının sırası (o-61; saf: pencere ve zamanlayıcı yok, src/itme-kart.js kullanır).
 *
 * Aynı anda tek kart görünür; gerisi sırada bekler (en çok 5, taşarsa en eskisi düşer). HA'nın "tag" kuralı korunur: aynı etiketli yeni
 * bildirim görünen ya da bekleyen kartın yerine geçer. Her kartın tek kullanımlık düğmeleri vardır: basılan düğme kartı kapatır, aynı
 * karta ikinci kez basılamaz. Kart numarası (kartNo) sayfadan gelen isteği doğrular: yalnız ŞU AN görünen kartın düğme sırası kabul edilir.
 * Eylem kimlikleri YALNIZ bu kuyrukta (ana süreç belleğinde) durur; sayfaya düğme başlıkları gider.
 */

const EN_COK_BEKLEYEN = 5;

/**
 * @typedef {{ baslik: string|null, mesaj: string, etiket: string|null, dugmeler: {eylem: string, baslik: string}[] }} ItmeBildirimi
 * @typedef {ItmeBildirimi & { kartNo: number }} ItmeKarti
 */

function itmeKuyruguOlustur({ enCokBekleyen = EN_COK_BEKLEYEN } = {}) {
  /** @type {ItmeKarti|null} */
  let gorunen = null;
  /** @type {ItmeKarti[]} */
  let bekleyen = [];
  let sayac = 0;

  const yeniKart = (b) => ({ kartNo: (sayac += 1), baslik: b.baslik ?? null, mesaj: b.mesaj, etiket: b.etiket ?? null, dugmeler: (b.dugmeler ?? []).map((d) => ({ eylem: d.eylem, baslik: d.baslik })) });

  function siradakiniAl() {
    gorunen = bekleyen.shift() ?? null;
    return gorunen;
  }

  return {
    /**
     * @param {ItmeBildirimi} bildirim
     * @returns {{ tur: 'goster' | 'degistir' | 'siraya', kart: ItmeKarti }} goster/degistir: kart şimdi görünür olmalı; siraya: bekliyor
     */
    ekle(bildirim) {
      const kart = yeniKart(bildirim);
      if (kart.etiket !== null && gorunen && gorunen.etiket === kart.etiket) {
        gorunen = kart;
        return { tur: 'degistir', kart };
      }
      if (kart.etiket !== null) {
        const sira = bekleyen.findIndex((k) => k.etiket === kart.etiket);
        if (sira >= 0) {
          bekleyen[sira] = kart;
          return { tur: 'siraya', kart };
        }
      }
      if (!gorunen) {
        gorunen = kart;
        return { tur: 'goster', kart };
      }
      if (bekleyen.length >= enCokBekleyen) bekleyen.shift();
      bekleyen.push(kart);
      return { tur: 'siraya', kart };
    },

    /** clear_notification: etiketli bekleyen kartlar silinir; görünen kart bu etiketteyse kapanır. @returns {{ kapandi: boolean, sonraki: ItmeKarti|null }} */
    temizle(etiket) {
      if (typeof etiket !== 'string' || etiket === '') return { kapandi: false, sonraki: null };
      bekleyen = bekleyen.filter((k) => k.etiket !== etiket);
      if (gorunen && gorunen.etiket === etiket) return { kapandi: true, sonraki: siradakiniAl() };
      return { kapandi: false, sonraki: null };
    },

    /** Süre doldu / kapat düğmesi: görünen kart bu numaradaysa kapanır. @returns {{ kapandi: boolean, sonraki: ItmeKarti|null }} */
    bitir(kartNo) {
      if (!gorunen || gorunen.kartNo !== kartNo) return { kapandi: false, sonraki: null };
      return { kapandi: true, sonraki: siradakiniAl() };
    },

    /**
     * Düğmeye basıldı. Yalnız görünen kartın var olan düğme sırası kabul edilir; kabul edilen kart kapanır (tek kullanım).
     * @returns {{ eylem: string, etiket: string|null, sonraki: ItmeKarti|null }|null}
     */
    eylemSec(kartNo, sira) {
      if (!gorunen || gorunen.kartNo !== kartNo || !Number.isInteger(sira) || sira < 0 || sira >= gorunen.dugmeler.length) return null;
      const { eylem } = gorunen.dugmeler[sira];
      const { etiket } = gorunen;
      return { eylem, etiket, sonraki: siradakiniAl() };
    },

    /** Hepsini siler (ayar kapandı, kayıt silindi). */
    sifirla() {
      gorunen = null;
      bekleyen = [];
    },

    gorunen: () => gorunen,
    bekleyenSayisi: () => bekleyen.length,
  };
}

module.exports = { EN_COK_BEKLEYEN, itmeKuyruguOlustur };
