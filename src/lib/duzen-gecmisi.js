'use strict';

/**
 * Düzen geçmişi: favori ve sayfa düzeninin son 20 anlık görüntüsü (o-30, "düzeni geri al").
 *
 * Her favori / sayfa değişikliğinden ÖNCE ana süreç eski düzeni buraya yazar ({ favoriler, sayfalar }); kullanıcı Ayarlar'dan bu
 * noktalardan birine dönebilir. Ayar yedeklerinden (ayar-yedegi.js: göç öncesi kopyalar, dışa aktarma) AYRIDIR: yalnız düzeni
 * (favoriler + sayfalar) kapsar, yalnız bu uygulamanın kendi değişikliklerinde oluşur. Dosya: <userData>\duzen-gecmisi.json,
 * atomik yazma (geçici dosya + yeniden adlandırma). İçinde yalnız varlık kimlikleri, karo adları, kısayol / görünüm ayarları ve
 * zaman damgaları vardır; sır (erişim anahtarı, adres) YOKTUR.
 *
 * Güvenlik: dosyadan okunan ve geri yüklenen her anlık görüntü ayar şemasından yeniden geçer (favorileriDuzelt: alan, kapı kuralı,
 * sınırlar; sayfalariDuzelt): elle bozulmuş bir dosya kapı / kilit favorisi ya da geçersiz kayıt sokamaz.
 */

const { favorileriDuzelt } = require('./favoriler');
const { sayfalariDuzelt } = require('./sayfalar');

const EN_COK_NOKTA = 20;
const SURUM = 1;
const DOSYA_BAYT_SINIRI = 4 * 1024 * 1024;
/** Noktanın nedeni (Ayarlar bu kodları çevirir). */
const NEDENLER = Object.freeze(['kaydet', 'sayfalar', 'menu-kaldir', 'menu-tepsi', 'menu-sayfa', 'onar', 'don', 'aktar']);

/** Anlık görüntüyü şemadan geçirir; geçersizse null. Girdiyi DEĞİŞTİRMEZ (derin kopya döner). */
function anlikDuzelt(anlik) {
  if (!anlik || typeof anlik !== 'object') return null;
  const favoriler = favorileriDuzelt(anlik.favoriler).favoriler;
  const sayfalar = sayfalariDuzelt(anlik.sayfalar) ?? [];
  return { favoriler: structuredClone(favoriler), sayfalar: structuredClone(sayfalar) };
}

const imza = (anlik) => JSON.stringify([anlik.favoriler, anlik.sayfalar]);

function noktalariDuzelt(ham) {
  const liste = Array.isArray(ham?.noktalar) ? ham.noktalar : [];
  const sonuc = [];
  const gorulen = new Set();
  for (const oge of liste) {
    const anlik = anlikDuzelt(oge);
    const id = oge?.id;
    if (!anlik || !Number.isInteger(id) || id < 1 || gorulen.has(id)) continue;
    gorulen.add(id);
    sonuc.push({
      id,
      zaman: Number.isFinite(oge.zaman) ? oge.zaman : 0,
      neden: NEDENLER.includes(oge.neden) ? oge.neden : 'kaydet',
      ...anlik,
    });
    if (sonuc.length >= EN_COK_NOKTA) break;
  }
  return sonuc.sort((a, b) => b.id - a.id);
}

/**
 * @param {object} bag
 * @param {string} bag.dosyaYolu
 * @param {{existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync?}} bag.fs
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 */
function duzenGecmisiOlustur({ dosyaYolu, fs, gunluk = () => {}, simdi = () => Date.now() }) {
  let noktalar = []; // en yeni önde
  let sonId = 0;

  function yaz() {
    const gecici = `${dosyaYolu}.tmp`;
    try {
      const yol = String(dosyaYolu).replace(/[\\/][^\\/]*$/, '');
      if (yol && yol !== dosyaYolu) fs.mkdirSync(yol, { recursive: true });
      fs.writeFileSync(gecici, `${JSON.stringify({ surum: SURUM, noktalar }, null, 1)}\n`, 'utf8');
      fs.renameSync(gecici, dosyaYolu);
      return true;
    } catch {
      gunluk('Düzen geçmişi dosyası yazılamadı.');
      return false;
    }
  }

  return {
    /** Dosyadan yükler (bozuk / okunamayan dosya boş geçmişle başlar). @returns {number} nokta sayısı */
    yukle() {
      noktalar = [];
      try {
        if (!fs.existsSync(dosyaYolu)) return 0;
        if (typeof fs.statSync === 'function' && fs.statSync(dosyaYolu).size > DOSYA_BAYT_SINIRI) throw new Error('buyuk');
        noktalar = noktalariDuzelt(JSON.parse(String(fs.readFileSync(dosyaYolu, 'utf8')).replace(/^﻿/, '')));
      } catch {
        gunluk('Düzen geçmişi dosyası okunamadı; geçmiş boş başlatıldı.');
        noktalar = [];
      }
      sonId = noktalar.reduce((en, n) => Math.max(en, n.id), 0);
      return noktalar.length;
    },
    /**
     * Düzenin DEĞİŞMEDEN ÖNCEKİ halini nokta olarak ekler. Önceki noktayla aynıysa eklenmez; `birlestirMs` içinde önceki nokta
     * varsa da eklenmez (tek "Kaydet" bir kaç ardışık değişiklik üretirse en eski, yani gerçek öncesi hal kalır).
     * @param {{favoriler: object[], sayfalar: object[]}} anlik
     * @param {string} [neden] NEDENLER'den biri
     * @returns {boolean} eklendi mi
     */
    kaydet(anlik, neden = 'kaydet', { birlestirMs = 0 } = {}) {
      const temiz = anlikDuzelt(anlik);
      if (!temiz) return false;
      const son = noktalar[0];
      if (son && imza(son) === imza(temiz)) return false;
      const an = simdi();
      if (son && birlestirMs > 0 && an - son.zaman >= 0 && an - son.zaman < birlestirMs) return false;
      sonId += 1;
      noktalar = [{ id: sonId, zaman: an, neden: NEDENLER.includes(neden) ? neden : 'kaydet', ...temiz }, ...noktalar].slice(0, EN_COK_NOKTA);
      yaz();
      return true;
    },
    /** Ayarlar listesi: en yeniden eskiye, yalnız özet (kimlikler ve adlar listede YOKTUR). */
    liste() {
      return noktalar.map((n) => ({ id: n.id, zaman: n.zaman, neden: n.neden, favoriSayisi: n.favoriler.length, sayfaSayisi: n.sayfalar.length }));
    },
    /** Noktanın düzeni (derin kopya) ya da null. */
    al(id) {
      const nokta = noktalar.find((n) => n.id === id);
      return nokta ? { favoriler: structuredClone(nokta.favoriler), sayfalar: structuredClone(nokta.sayfalar) } : null;
    },
    sayi: () => noktalar.length,
    temizle() {
      noktalar = [];
      return yaz();
    },
  };
}

module.exports = { EN_COK_NOKTA, NEDENLER, anlikDuzelt, duzenGecmisiOlustur };
