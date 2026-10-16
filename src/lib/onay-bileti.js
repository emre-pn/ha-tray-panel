'use strict';

/**
 * Tek kullanımlık ikinci onay bileti (saf; 1.1.1 tur 5, K7).
 *
 * Neden var: Ayarlar'daki "Anladım, yine de doğrula" onayı bir kutu işaretidir; ana sürece düz bir `onay: true` olarak gidiyorsa
 * ilk hatalı denemeden sonra da işaretli kalır ve ardışık her yeni aday (HA'ya 401 almaya devam ederek) HA'nın 5 hatalı deneme
 * eşiğine kullanıcıya yeniden sorulmadan taşınır. Bunun yerine ana süreç, onay istediğinde bir BİLET verir; bilet
 *  - yalnız o aday parmak izi için,
 *  - verildiği andaki ilgili hata sayacı (ve kayıt durumu) DEĞİŞMEMİŞSE,
 *  - ve daha önce kullanılmamışsa
 * kabul edilir. Her kullanım denemesinde (başarılı ya da değil) bilet yanar: bir sonraki aday ya da değişmiş sayaç yeniden onay ister.
 * Bilet sırdır: parmak izini ya da anahtarı içermez, rastgeledir; yalnız bellekte tutulur.
 */

const crypto = require('node:crypto');

const EN_COK_BILET = 16;

/**
 * @param {object} [bag]
 * @param {() => string} [bag.rastgele] bilet üretici (yalnız testler için)
 * @param {number} [bag.enCok] aynı anda tutulan en çok bilet (en eskisi düşer)
 */
function onayBiletiDeposuOlustur({ rastgele = () => crypto.randomBytes(18).toString('hex'), enCok = EN_COK_BILET } = {}) {
  const biletler = new Map(); // bilet -> { parmakIzi, sayi, kayit }

  return {
    /** @param {{parmakIzi: string, sayi: number, kayit: string|null}} imza @returns {string} yeni bilet */
    ver({ parmakIzi, sayi = 0, kayit = null }) {
      const bilet = rastgele();
      biletler.set(bilet, { parmakIzi, sayi, kayit: kayit ?? null });
      while (biletler.size > enCok) biletler.delete(biletler.keys().next().value);
      return bilet;
    },

    /**
     * Bileti harcar (her durumda yakar). @returns {boolean} bilet bu imza için geçerliydi
     * @param {unknown} bilet
     * @param {{parmakIzi: string, sayi: number, kayit: string|null}} imza
     */
    tuket(bilet, { parmakIzi, sayi = 0, kayit = null }) {
      if (typeof bilet !== 'string' || !bilet) return false;
      const kayitli = biletler.get(bilet);
      if (!kayitli) return false;
      biletler.delete(bilet);
      return kayitli.parmakIzi === parmakIzi && kayitli.sayi === sayi && kayitli.kayit === (kayit ?? null);
    },
  };
}

module.exports = { EN_COK_BILET, onayBiletiDeposuOlustur };
