'use strict';

/**
 * Adres yoklaması sonucunu değerlendirir (saf; Electron'a bağlı değildir).
 *
 * hata-02: dış adresten dönen Cloudflare hata sayfası (5xx, 403) "bağlandı" sayılmaz.
 * hata-01: yoklama yanıtının gerçekten Home Assistant olduğu içerikten doğrulanır (`icerikDogrula: true`):
 *   /manifest.json yanıtı 2xx olmalı VE içeriği HA'nın manifest'i olmalı. Ağdaki rastgele bir cihazı (yönlendirici,
 *   yazıcı, başka bir web sunucusu) eler; bilerek taklit edeni ENGELLEMEZ. Kök çözüm evde de HTTPS adrese
 *   bağlanmaktır (ev içi adres https:// kabul edilir, sertifika doğrulaması normal kalır).
 * `icerikDogrula` kapalıyken (eski davranış) yalnız 5xx ve 403 ulaşılamaz sayılır.
 */

const { sadelestir } = require('./metin');

/** Yoklama gövdesi için üst sınır: düşman bir sunucu sonsuz veri akıtamaz. */
const YOKLAMA_GOVDE_SINIRI_BAYT = 65536;

/**
 * HA'nın /manifest.json yanıtı mı? Gerçek yanıt: JSON nesnesi, "name": "Home Assistant".
 * @param {unknown} metin yanıt gövdesi
 */
function manifestHaMi(metin) {
  if (typeof metin !== 'string' || metin.length === 0 || metin.length > YOKLAMA_GOVDE_SINIRI_BAYT) return false;
  let veri;
  try {
    veri = JSON.parse(metin);
  } catch {
    return false;
  }
  if (!veri || typeof veri !== 'object' || Array.isArray(veri)) return false;
  return typeof veri.name === 'string' && sadelestir(veri.name).includes('home assistant');
}

/**
 * Yanıt gövdesini en çok `enCokBayt` kadar okur, sonra akışı iptal eder.
 * Sınır aşılırsa ya da gövde yoksa null döner (içerik doğrulaması zaten başarısız olur).
 * @param {{ body?: { getReader?: () => { read: () => Promise<{done:boolean, value?:Uint8Array}>, cancel: () => Promise<void> } } }} yanit
 * @returns {Promise<string|null>}
 */
async function sinirliOku(yanit, enCokBayt = YOKLAMA_GOVDE_SINIRI_BAYT) {
  const govde = yanit?.body;
  if (!govde || typeof govde.getReader !== 'function') return null;
  const okuyucu = govde.getReader();
  const parcalar = [];
  let toplam = 0;
  let asildi = false;
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      toplam += value.byteLength;
      if (toplam > enCokBayt) {
        asildi = true;
        break;
      }
      parcalar.push(value);
    }
  } finally {
    try {
      await okuyucu.cancel();
    } catch {
      /* akış zaten kapalı */
    }
  }
  if (asildi) return null;
  return new TextDecoder('utf-8').decode(Buffer.concat(parcalar));
}

/**
 * @param {{ durum: number, metin?: string|null, icerikDogrula?: boolean }} girdi
 * @returns {{ ulasilabilir: boolean, neden: string }}
 *   neden: 'tamam' | 'beklenmeyen-durum' | 'sunucu-hatasi' | 'erisim-engelli' | 'ha-degil' | 'yonlendirme'
 */
function yoklamaDegerlendir({ durum, metin = null, icerikDogrula = false }) {
  if (!Number.isInteger(durum)) return { ulasilabilir: false, neden: 'beklenmeyen-durum' };
  if (durum >= 500) return { ulasilabilir: false, neden: 'sunucu-hatasi' };
  if (durum === 403) return { ulasilabilir: false, neden: 'erisim-engelli' };
  if (icerikDogrula) {
    // Yoklama yönlendirmeyi izlemez (ha-istemcisi: redirect 'error'); yine de 3xx gelirse ayardaki adres doğrulanamamıştır.
    if (durum >= 300 && durum < 400) return { ulasilabilir: false, neden: 'yonlendirme' };
    if (durum < 200 || durum >= 300) return { ulasilabilir: false, neden: 'beklenmeyen-durum' };
    if (!manifestHaMi(metin)) return { ulasilabilir: false, neden: 'ha-degil' };
  }
  return { ulasilabilir: true, neden: 'tamam' };
}

/**
 * Sayfa yüklendikten SONRA ana çerçevenin yanıt kodu: yalnız 5xx ve 403 "bozuk" sayılır.
 * Diğer 4xx (ör. HA'nın kendi 404 sayfası) kullanıcıya HA'nın kendi arayüzüyle gösterilir.
 */
function sayfaYanitiBozukMu(durum) {
  return Number.isInteger(durum) && (durum >= 500 || durum === 403);
}

module.exports = { YOKLAMA_GOVDE_SINIRI_BAYT, manifestHaMi, sinirliOku, yoklamaDegerlendir, sayfaYanitiBozukMu };
