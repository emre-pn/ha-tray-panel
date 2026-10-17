'use strict';

/**
 * Etkinlik geçmişi (o-17, 1.4.0 eylem grubu): uygulamanın yaptığı/yapamadığı eylemlerin YEREL kaydı (kim istedi, ne oldu).
 *
 * Neden var: "Işığı kim kapattı, çalıştı mı?" sorusunun cevabı Ayarlar > Etkinlik geçmişi'nde durur. Kayıt yalnız bu bilgisayarda
 * <userData>\etkinlik-gecmisi.json içindedir, ağa çıkmaz, dışa aktarmaya/klasör eşitlemeye/tanılama raporuna GİRMEZ.
 *
 * Kayıt biçimi { zaman, kaynak, kimlik?, ad?, islem, sonuc, neden? }:
 *  - kaynak  eylemin geldiği yüzey/modül: kısa küçük harfli kod ('panel', 'palet', 'tepsi-menu', 'kisayol', 'gecikmeli'...). Diğer
 *            modüllerin yeni kaynakları da bu desenle yazılabilir (ekle() herkese açık API'dir).
 *  - kimlik  varlık kimliği (varsa). Kapı Kuralı'ndan geçmeyen kimlik/ad olan kayıt HİÇ yazılmaz (ikinci savunma).
 *  - islem   servis ya da işlem kodu ('toggle', 'turn_off', 'parlaklik', 'geri-al', 'gecikmeli-kur'...); parametre DEĞERİ yazılmaz.
 *  - sonuc   'ok' | 'hata' | 'iptal' | 'atlandi'
 *  - neden   hata/iptal için kısa kod ('ha-hatasi/yetki', 'ulasilamiyor'...). Sunucu adresi, anahtar, istek gövdesi, HA hata metni yok.
 *
 * Halka tampon: en çok 200 kayıt, en yenisi başta. Atomik yazma (geçici dosya + yeniden adlandırma), gecikmeli (500 ms) ve çıkışta
 * bosalt(). Dosya bozuksa boş başlar; okunan her kayıt yeniden doğrulanır (elle bozulmuş dosya kapı adı gösteremez).
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, YASAK_ALANLAR } = require('./suzgec');
const { kayitliAlanMi } = require('./alan-kaydi');
const { kisalt } = require('./metin');

const EN_COK_KAYIT = 200;
const SURUM = 1;
const YAZMA_GECIKMESI_MS = 500;
const AD_SINIRI = 60;
const KAYNAK_DESENI = /^[a-z][a-z0-9-]{1,23}$/;
const ISLEM_DESENI = /^[a-z][a-z0-9_.-]{1,31}$/;
const NEDEN_DESENI = /^[a-z][a-z0-9_/-]{1,39}$/;
const SONUCLAR = Object.freeze(['ok', 'hata', 'iptal', 'atlandi']);

/** Kimlik biçimce geçerli, kayıtlı alanda ve Kapı Kuralı'ndan geçmeli. */
function kimlikGuvenliMi(kimlik) {
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
  const alan = alanAl(kimlik);
  return !YASAK_ALANLAR.has(alan) && kayitliAlanMi(alan) && adGuvenliMi(kimlik, '');
}

/**
 * Tek kaydı doğrular ve temiz kopyasını döner; geçersiz ya da güvensizse null. (Dosyadan okurken ve ekle()'de aynı kural.)
 * @returns {{zaman: number, kaynak: string, kimlik?: string, ad?: string, islem: string, sonuc: string, neden?: string}|null}
 */
function kaydiDuzelt(ham, simdi = 0) {
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
  const { kaynak, kimlik, ad, islem, sonuc, neden } = ham;
  if (typeof kaynak !== 'string' || !KAYNAK_DESENI.test(kaynak)) return null;
  if (typeof islem !== 'string' || !ISLEM_DESENI.test(islem)) return null;
  if (!SONUCLAR.includes(sonuc)) return null;
  const kayit = { zaman: Number.isFinite(ham.zaman) && ham.zaman > 0 ? Math.floor(ham.zaman) : simdi, kaynak };
  if (kimlik !== undefined) {
    if (!kimlikGuvenliMi(kimlik)) return null; // kapı/kilit kimliği içeren kayıt hiç tutulmaz
    kayit.kimlik = kimlik;
    if (ad !== undefined && ad !== null && ad !== '') {
      if (typeof ad !== 'string') return null;
      const kisa = kisalt(ad, AD_SINIRI);
      if (!adGuvenliMi(kimlik, kisa) || !adGuvenliMi(kimlik, ad)) return null;
      if (kisa) kayit.ad = kisa;
    }
  } else if (ad !== undefined && ad !== null && ad !== '') {
    return null; // kimliksiz kayıtta ad olmaz
  }
  kayit.islem = islem;
  kayit.sonuc = sonuc;
  if (neden !== undefined && neden !== null && neden !== '') {
    if (typeof neden !== 'string' || !NEDEN_DESENI.test(neden)) return null;
    kayit.neden = neden;
  }
  return kayit;
}

/** Dosya içeriğini temizler: bozuk/güvensiz kayıt atılır, en çok 200, en yeni önde (zaman azalan). */
function kayitlariDuzelt(ham) {
  const liste = Array.isArray(ham?.kayitlar) ? ham.kayitlar : [];
  const sonuc = [];
  for (const oge of liste) {
    const kayit = kaydiDuzelt(oge, 0);
    if (kayit) sonuc.push(kayit);
    if (sonuc.length >= EN_COK_KAYIT) break;
  }
  return sonuc;
}

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} bag
 * @param {string} bag.dosyaYolu
 * @param {{existsSync, readFileSync, writeFileSync, renameSync, mkdirSync}} bag.fs
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {() => boolean} [bag.acikMi] false iken ekle() hiçbir şey yazmaz (ayar `etkinlikGecmisi`)
 */
function etkinlikGecmisiOlustur({ dosyaYolu, fs, gunluk = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman(), acikMi = () => true }) {
  let kayitlar = [];
  let kirli = false;
  let zamanlayici = null;
  const dinleyiciler = new Set();

  function yaz() {
    zaman.clearTimeout(zamanlayici);
    zamanlayici = null;
    if (!kirli) return true;
    const gecici = `${dosyaYolu}.tmp`;
    try {
      const yol = String(dosyaYolu).replace(/[\\/][^\\/]*$/, '');
      if (yol && yol !== dosyaYolu) fs.mkdirSync(yol, { recursive: true });
      fs.writeFileSync(gecici, `${JSON.stringify({ surum: SURUM, kayitlar }, null, 1)}\n`, 'utf8');
      fs.renameSync(gecici, dosyaYolu);
      kirli = false;
      return true;
    } catch {
      gunluk('Etkinlik geçmişi dosyası yazılamadı.');
      return false;
    }
  }

  function yazmayiPlanla() {
    kirli = true;
    if (zamanlayici === null) zamanlayici = zaman.setTimeout(yaz, YAZMA_GECIKMESI_MS);
  }

  function degistiBildir() {
    for (const fn of [...dinleyiciler]) {
      try {
        fn();
      } catch {
        /* dinleyici hatası kaydı bozmaz */
      }
    }
  }

  return {
    yukle() {
      kayitlar = [];
      try {
        if (!fs.existsSync(dosyaYolu)) return 0;
        const ham = JSON.parse(String(fs.readFileSync(dosyaYolu, 'utf8')).replace(/^﻿/, ''));
        kayitlar = kayitlariDuzelt(ham);
      } catch {
        gunluk('Etkinlik geçmişi dosyası okunamadı; liste boş başlatıldı.');
        kayitlar = [];
      }
      return kayitlar.length;
    },

    /**
     * DİĞER MODÜLLER İÇİN API: bir etkinlik ekler. Kapalıysa (ayar) ya da kayıt geçersiz/güvensizse eklenmez.
     * @param {{kaynak: string, kimlik?: string, ad?: string, islem: string, sonuc: 'ok'|'hata'|'iptal'|'atlandi', neden?: string, zaman?: number}} kayit
     * @returns {boolean} eklendi mi
     */
    ekle(kayit) {
      if (!acikMi()) return false;
      const temiz = kaydiDuzelt({ ...(kayit && typeof kayit === 'object' ? kayit : {}), zaman: simdi() }, simdi());
      if (!temiz) return false;
      kayitlar = [temiz, ...kayitlar].slice(0, EN_COK_KAYIT);
      yazmayiPlanla();
      degistiBildir();
      return true;
    },

    /** En yeniden eskiye en çok `n` kayıt (kopya). */
    liste(n = EN_COK_KAYIT) {
      return kayitlar.slice(0, Math.max(0, n)).map((k) => ({ ...k }));
    },

    temizle() {
      if (kayitlar.length === 0) return;
      kayitlar = [];
      yazmayiPlanla();
      degistiBildir();
    },

    /** Değişimde (ekleme/temizleme) çağrılacak işlev ekler; dönen işlev kaldırır. */
    dinle(fn) {
      if (typeof fn !== 'function') return () => {};
      dinleyiciler.add(fn);
      return () => dinleyiciler.delete(fn);
    },

    /** Bekleyen yazmayı hemen yapar (çıkışta). */
    bosalt: yaz,
    sayi: () => kayitlar.length,
  };
}

module.exports = { EN_COK_KAYIT, SONUCLAR, kimlikGuvenliMi, kaydiDuzelt, kayitlariDuzelt, etkinlikGecmisiOlustur };
