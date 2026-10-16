'use strict';

/**
 * "Bağlantıyı sına" (k-14): Ayarlar'daki adres kutusuna yazılan, henüz kaydedilmemiş bir adresin Home Assistant olup olmadığını
 * ANAHTAR GÖNDERMEDEN yoklar. Tek istek: GET <adres>/manifest.json (kimlik bilgisi yok, yönlendirme izlenmez, gövde sınırlı).
 *
 * Güvence: bu modül erişim anahtarına hiç erişemez (anahtarAl bağımlılığı YOKTUR); isteğe Authorization başlığı eklenmez ve
 * `credentials: 'omit'` kullanılır. Adres kaydetmedeki kurallarla doğrulanır (ev içi adres: http yalnız ev ağında; dış adres: yalnız https),
 * böylece herkese açık bir ada düz http isteği de gitmez. Sonuç yoklama.js'deki yoklamaDegerlendir ile aynı ölçütle verilir.
 * Saf: fetch ve zamanlayıcı dışarıdan verilir; Electron'a bağlı değildir.
 */

const { adresNormallestir, anahtarIcinGuvenliAdresMi } = require('./dogrulama');
const { sinirliOku, yoklamaDegerlendir, YOKLAMA_GOVDE_SINIRI_BAYT } = require('./yoklama');
const { TR } = require('./ceviri-varsayilan');

const SINAMA_ZAMAN_ASIMI_MS = 6000;

// Sonuç iletileri src/lib/ceviri/ana.js sözlüğündedir ('sina.<neden>'). SONUC_METINLERI bugünkü Türkçe metinlerdir (testler için).
const SONUC_NEDENLERI = Object.freeze(['tamam', 'ha-degil', 'erisim-engelli', 'sunucu-hatasi', 'beklenmeyen-durum', 'yonlendirme', 'ulasilamadi']);
const SONUC_METINLERI = Object.freeze(Object.fromEntries(SONUC_NEDENLERI.map((neden) => [neden, TR(`sina.${neden}`)])));

const yonlendirmeHatasiMi = (hata) => /redirect/i.test(`${hata?.message ?? ''} ${hata?.cause?.message ?? ''}`);

/**
 * @param {object} bag
 * @param {(url: string, secenekler: object) => Promise<Response>} bag.fetch
 * @param {number} [bag.zamanAsimiMs]
 * @param {Function} [bag.t] çevirmen (src/lib/dil.js; ana süreçte dil değişince kendiliğinden yeni dili izler). Verilmezse Türkçe.
 * @param {(mesaj: string) => void} [bag.gunluk] yalnız sabit metinler (adres/ayrıntı yazılmaz)
 */
function adresSinayiciOlustur({ fetch, zamanAsimiMs = SINAMA_ZAMAN_ASIMI_MS, gunluk = () => {}, t = TR }) {
  const metin = (neden) => t(SONUC_NEDENLERI.includes(neden) ? `sina.${neden}` : 'sina.beklenmeyen-durum');
  /**
   * @param {unknown} adres kullanıcının yazdığı adres
   * @param {'yerel'|'dis'} tur 'dis': yalnız https kabul edilir
   * @returns {Promise<{ok: boolean, ulasilabilir?: boolean, neden?: string, mesaj?: string, hata?: string}>}
   *   ok:false = adres sınanamayacak kadar geçersiz (hata alanı); ok:true = sınandı (ulasilabilir + neden + mesaj)
   */
  async function sina(adres, tur) {
    const yalnizHttps = tur === 'dis';
    const kok = adresNormallestir(adres, yalnizHttps);
    if (!kok) {
      return {
        ok: false,
        hata: t(yalnizHttps ? 'kaydet.disGecersiz' : 'kaydet.yerelGecersiz'),
      };
    }
    if (!anahtarIcinGuvenliAdresMi(kok)) {
      // Herkese açık bir ada düz http isteği gitmesin (kaydetmedeki kuralın aynısı).
      return { ok: false, hata: t('kaydet.yerelHttp') };
    }
    const denetleyici = new AbortController();
    let zamanlayici;
    try {
      const yoklama = async () => {
        const yanit = await fetch(new URL('/manifest.json', kok).toString(), {
          method: 'GET',
          signal: denetleyici.signal,
          credentials: 'omit',
          redirect: 'error',
        });
        const durum = yanit.status;
        let metin = null;
        if (durum >= 200 && durum < 300) {
          metin = await sinirliOku(yanit, YOKLAMA_GOVDE_SINIRI_BAYT);
        } else {
          try {
            await yanit.body?.cancel();
          } catch {
            /* gövde zaten kapalı */
          }
        }
        return { durum, metin };
      };
      const sure = new Promise((_coz, reddet) => {
        zamanlayici = setTimeout(() => {
          denetleyici.abort();
          reddet(new Error('zaman-asimi'));
        }, zamanAsimiMs);
      });
      const sonuc = await Promise.race([yoklama(), sure]);
      const karar = yoklamaDegerlendir({ ...sonuc, icerikDogrula: true });
      gunluk(`Adres sınaması: ${karar.neden}`);
      return { ok: true, ulasilabilir: karar.ulasilabilir, neden: karar.neden, mesaj: metin(karar.neden) };
    } catch (hata) {
      if (yonlendirmeHatasiMi(hata)) {
        gunluk('Adres sınaması: yonlendirme');
        return { ok: true, ulasilabilir: false, neden: 'yonlendirme', mesaj: metin('yonlendirme') };
      }
      gunluk('Adres sınaması: ulasilamadi');
      return { ok: true, ulasilabilir: false, neden: 'ulasilamadi', mesaj: metin('ulasilamadi') };
    } finally {
      clearTimeout(zamanlayici);
    }
  }

  return { sina };
}

module.exports = { SINAMA_ZAMAN_ASIMI_MS, SONUC_METINLERI, adresSinayiciOlustur };
