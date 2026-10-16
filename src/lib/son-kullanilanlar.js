'use strict';

/**
 * "Son kullanılanlar" listesi (hiz-08): panel ve paletin en üstündeki satır.
 *
 * Yalnız ZARARSIZ eylemler ve yalnız panel/palet kaynaklı başarılı çalıştırmalar eklenir (çağıran taraf süzer; bu modül
 * ikinci savunma olarak kimliği yeniden doğrular: kapı/kilit adı ya da geçersiz alan listeye hiç girmez, dosyadan da okunmaz).
 * Dosya: <userData>\son-kullanilanlar.json, en çok 50 kayıt, atomik yazma (geçici dosya + yeniden adlandırma). İçinde yalnız
 * varlık kimlikleri ve zaman damgaları vardır; sır içermez.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { FAVORI_ALANLARI, alanAl, adGuvenliMi } = require('./suzgec');

const EN_COK_KAYIT = 50;
const SURUM = 1;
const YAZMA_GECIKMESI_MS = 500;

function kimlikGecerliMi(kimlik) {
  return typeof kimlik === 'string' && VARLIK_KIMLIGI_DESENI.test(kimlik) && Object.hasOwn(FAVORI_ALANLARI, alanAl(kimlik)) && adGuvenliMi(kimlik, kimlik);
}

/** Dosya içeriğini temizler: bozuk/yinelenen/güvensiz kayıtlar atılır, en çok 50, en yeni önde. */
function kayitlariDuzelt(ham) {
  const liste = Array.isArray(ham?.kayitlar) ? ham.kayitlar : [];
  const gorulen = new Set();
  const sonuc = [];
  for (const oge of liste) {
    const kimlik = oge?.kimlik;
    if (!kimlikGecerliMi(kimlik) || gorulen.has(kimlik)) continue;
    gorulen.add(kimlik);
    sonuc.push({ kimlik, zaman: Number.isFinite(oge.zaman) ? oge.zaman : 0 });
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
 */
function sonKullanilanlarOlustur({ dosyaYolu, fs, gunluk = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman() }) {
  let kayitlar = [];
  let kirli = false;
  let zamanlayici = null;

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
      gunluk('Son kullanılanlar dosyası yazılamadı.');
      return false;
    }
  }

  function yazmayiPlanla() {
    kirli = true;
    if (zamanlayici === null) zamanlayici = zaman.setTimeout(yaz, YAZMA_GECIKMESI_MS);
  }

  return {
    yukle() {
      kayitlar = [];
      try {
        if (!fs.existsSync(dosyaYolu)) return kayitlar.length;
        const ham = JSON.parse(String(fs.readFileSync(dosyaYolu, 'utf8')).replace(/^\uFEFF/, ''));
        kayitlar = kayitlariDuzelt(ham);
      } catch {
        gunluk('Son kullanılanlar dosyası okunamadı; liste boş başlatıldı.');
        kayitlar = [];
      }
      return kayitlar.length;
    },
    /** Kimliği en öne alır (varsa eskisini siler). Geçersiz/güvensiz kimlik eklenmez. @returns {boolean} eklendi mi */
    ekle(kimlik) {
      if (!kimlikGecerliMi(kimlik)) return false;
      kayitlar = [{ kimlik, zaman: simdi() }, ...kayitlar.filter((k) => k.kimlik !== kimlik)].slice(0, EN_COK_KAYIT);
      yazmayiPlanla();
      return true;
    },
    /** En yeniden eskiye en çok `n` kimlik. */
    en(n = EN_COK_KAYIT) {
      return kayitlar.slice(0, Math.max(0, n)).map((k) => k.kimlik);
    },
    sonBes() {
      return this.en(5);
    },
    /** Verilen kümede olmayan (artık favori olmayan) kimlikleri siler. */
    buda(izinli) {
      const kume = izinli instanceof Set ? izinli : new Set(izinli);
      const onceki = kayitlar.length;
      kayitlar = kayitlar.filter((k) => kume.has(k.kimlik));
      if (kayitlar.length !== onceki) yazmayiPlanla();
    },
    temizle() {
      if (kayitlar.length === 0) return;
      kayitlar = [];
      yazmayiPlanla();
    },
    /** Bekleyen yazmayı hemen yapar (çıkışta). */
    bosalt: yaz,
    sayi: () => kayitlar.length,
  };
}

module.exports = { EN_COK_KAYIT, kimlikGecerliMi, kayitlariDuzelt, sonKullanilanlarOlustur };
