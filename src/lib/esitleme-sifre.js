'use strict';

/**
 * Klasör eşitleme dosyasının parola ile şifrelenmesi (1.4.0, o-58, isteğe bağlı) — SAF (yalnız node:crypto; dosya, Electron ve günlük yok).
 *
 *  - scrypt (N=32768, r=8, p=1; dosyada yazılı ve OKURKEN yalnız bu değerler kabul edilir: kötü niyetli dosya bellek/işlemci tüketemez) ile
 *    32 baytlık anahtar türetilir; AES-256-GCM ile şifrelenir (12 bayt rastgele iv, 16 bayt etiket). Bölüm adları, sürüm ve biçim adı ek doğrulanmış
 *    veri (AAD) olarak etikete bağlanır; dosyadaki herhangi bir bayt değişirse çözme başarısız olur.
 *  - Parola dosyaya, günlüğe, hata iletisine hiçbir biçimde girmez; bu modül yalnız bellekte kullanır. Türetilen anahtar son tuzla
 *    önbelleklenir (her yazma/okumada ~100 ms'lik scrypt yinelenmesin); tuz yazmalar arasında aynı kalır, iv her yazmada yenidir.
 *  - Yanlış parola ile bozulmuş dosya ayırt edilemez (GCM): ikisi de 'parola-yanlis' döner.
 */

const crypto = require('node:crypto');

const BICIM = 'ev-paneli-ayar-esitleme';
const SURUM = 1;
const SCRYPT = Object.freeze({ N: 32_768, r: 8, p: 1, anahtarBayt: 32, maxmem: 64 * 1024 * 1024 });
const TUZ_BAYT = 16;
const IV_BAYT = 12;
const ETIKET_BAYT = 16;
const EN_AZ_PAROLA = 8;
const EN_COK_PAROLA = 128;
const EN_COK_VERI_BAYT = 1024 * 1024;
const AAD = Buffer.from(`${BICIM}:${SURUM}`, 'utf8');

const duzNesne = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
const b64Bayt = (deger, bayt) => {
  if (typeof deger !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(deger)) return null;
  const tampon = Buffer.from(deger, 'base64');
  return tampon.length === bayt ? tampon : null;
};

/** Parola kullanılabilir mi (kısa/uzun/denetim karakterli parola kaydedilmez). */
function parolaGecerliMi(parola) {
  // eslint-disable-next-line no-control-regex
  return typeof parola === 'string' && parola.length >= EN_AZ_PAROLA && parola.length <= EN_COK_PAROLA && !/[\u0000-\u001f]/.test(parola);
}

/** Dosya içeriği (ayrıştırılmış JSON) şifreli zarf mı? Yalnız biçime bakar. */
function zarfMi(belge) {
  return duzNesne(belge) && belge.bicim === BICIM && belge.sifreli === true;
}

function anahtarTuret(parola, tuz) {
  return new Promise((coz, reddet) => {
    crypto.scrypt(parola.normalize('NFC'), tuz, SCRYPT.anahtarBayt, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (hata, anahtar) => (hata ? reddet(hata) : coz(anahtar)));
  });
}

/** @param {{rastgele?: (n: number) => Buffer}} [bag] rastgele: testler için */
function sifreleyiciOlustur({ rastgele = crypto.randomBytes } = {}) {
  let onbellek = null; // { parolaOzeti, tuzB64, anahtar }
  const ozet = (parola) => crypto.createHash('sha256').update(parola, 'utf8').digest('hex');

  async function anahtarAl(parola, tuz, tuzB64) {
    const o = ozet(parola);
    if (onbellek && onbellek.parolaOzeti === o && onbellek.tuzB64 === tuzB64) return onbellek.anahtar;
    const anahtar = await anahtarTuret(parola, tuz);
    onbellek = { parolaOzeti: o, tuzB64, anahtar };
    return anahtar;
  }

  return {
    /** Metni şifreler. @returns {Promise<object>} JSON'a yazılabilir zarf */
    async sifrele(metin, parola) {
      if (!parolaGecerliMi(parola) || typeof metin !== 'string') throw Object.assign(new Error('parola-gecersiz'), { neden: 'parola-gecersiz' });
      // Önbellekteki tuz yeniden kullanılır (aynı parola); yoksa yeni tuz.
      let tuz;
      if (onbellek && onbellek.parolaOzeti === ozet(parola)) tuz = Buffer.from(onbellek.tuzB64, 'base64');
      else tuz = rastgele(TUZ_BAYT);
      const tuzB64 = tuz.toString('base64');
      const anahtar = await anahtarAl(parola, tuz, tuzB64);
      const iv = rastgele(IV_BAYT);
      const sifre = crypto.createCipheriv('aes-256-gcm', anahtar, iv, { authTagLength: ETIKET_BAYT });
      sifre.setAAD(AAD);
      const veri = Buffer.concat([sifre.update(metin, 'utf8'), sifre.final()]);
      return {
        bicim: BICIM,
        surum: SURUM,
        sifreli: true,
        kdf: 'scrypt',
        N: SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
        tuz: tuzB64,
        iv: iv.toString('base64'),
        etiket: sifre.getAuthTag().toString('base64'),
        veri: veri.toString('base64'),
      };
    },

    /**
     * Zarfı çözer. Hata: Error.neden = 'zarf-gecersiz' (biçim/parametre tanınmadı) | 'dahaYeni' | 'parola-yanlis' | 'parola-gecersiz'.
     * @returns {Promise<string>} düz metin
     */
    async coz(zarf, parola) {
      const hata = (neden) => Object.assign(new Error(neden), { neden });
      if (!zarfMi(zarf)) throw hata('zarf-gecersiz');
      if (!Number.isInteger(zarf.surum) || zarf.surum < 1) throw hata('zarf-gecersiz');
      if (zarf.surum > SURUM) throw hata('dahaYeni');
      if (zarf.kdf !== 'scrypt' || zarf.N !== SCRYPT.N || zarf.r !== SCRYPT.r || zarf.p !== SCRYPT.p) throw hata('zarf-gecersiz');
      const tuz = b64Bayt(zarf.tuz, TUZ_BAYT);
      const iv = b64Bayt(zarf.iv, IV_BAYT);
      const etiket = b64Bayt(zarf.etiket, ETIKET_BAYT);
      if (!tuz || !iv || !etiket || typeof zarf.veri !== 'string' || zarf.veri.length === 0 || zarf.veri.length > EN_COK_VERI_BAYT * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(zarf.veri)) throw hata('zarf-gecersiz');
      if (!parolaGecerliMi(parola)) throw hata('parola-gecersiz');
      const anahtar = await anahtarAl(parola, tuz, zarf.tuz);
      try {
        const coz = crypto.createDecipheriv('aes-256-gcm', anahtar, iv, { authTagLength: ETIKET_BAYT });
        coz.setAAD(AAD);
        coz.setAuthTag(etiket);
        return Buffer.concat([coz.update(Buffer.from(zarf.veri, 'base64')), coz.final()]).toString('utf8');
      } catch {
        throw hata('parola-yanlis');
      }
    },

    /** Önbelleği temizler (parola kaldırıldığında / değiştiğinde). */
    temizle() {
      onbellek = null;
    },
  };
}

module.exports = { BICIM, SURUM, SCRYPT, EN_AZ_PAROLA, EN_COK_PAROLA, parolaGecerliMi, zarfMi, sifreleyiciOlustur };
