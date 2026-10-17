'use strict';

/**
 * Medya oynatıcı albüm kapağı yardımcıları (saf; ağ yok, Electron'a bağlı değil).
 *
 * Kapak YALNIZ ana süreçte, uygulamanın kendi HA bağlantısıyla (anahtar ve adres hiç renderer'a gitmez) çekilir ve renderer'a küçük
 * bir `data:` adresi olarak verilir. Güvenlik sınırları bu dosyadadır:
 *  - Yol beyaz listesi: yalnız HA'nın kendi vekil adresi `/api/media_player_proxy/<aynı oynatıcı>[?token&cache]` çekilir. `entity_picture`
 *    mutlak bir adres (http/https, başka sunucu) ise ASLA çekilmez: HA anahtarı da dış sunucuya gitmez. Önce `entity_picture_local`
 *    (HA'nın yerel vekili) aranır, yoksa `entity_picture` yalnız göreli vekil yoluysa kullanılır.
 *  - İçerik doğrulaması: yalnız jpeg / png / webp, içerik türü başlığı VE ilk baytlar (sihirli sayı) uyumlu, en çok 600 KB, her kenar
 *    en çok 4096 piksel ve en çok 12 milyon piksel (sıkıştırma bombası belleği şişirmesin). SVG ve başka her şey reddedilir.
 *  - Renderer yol ya da adres görmez; yalnız `kapak` (var mı) ve `kapakAnahtari` (yol değiştiğinde değişen kısa özet; jeton içermez) alır.
 */

const KAPAK_YOLU = /^\/api\/media_player_proxy\/(media_player\.[a-z0-9_]{1,80})(\?[A-Za-z0-9_=&%.-]{0,300})?$/;
const KAPAK_EN_COK_BAYT = 600_000;
const KENAR_SINIRI = 4096;
const PIKSEL_SINIRI = 12_000_000;
const IZINLI_TURLER = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Oynatıcının çekilebilir kapak yolu (göreli, beyaz listeden geçen) ya da null.
 * @param {{entity_id?: string, attributes?: object}|null|undefined} varlik HA durumu
 * @param {string} [kimlik] beklenen oynatıcı kimliği (verilmezse varlığın kendisi)
 */
function kapakYolu(varlik, kimlik) {
  const beklenen = typeof kimlik === 'string' ? kimlik : varlik?.entity_id;
  if (typeof beklenen !== 'string' || varlik?.entity_id !== beklenen) return null;
  const n = varlik.attributes;
  if (!n || typeof n !== 'object') return null;
  for (const aday of [n.entity_picture_local, n.entity_picture]) {
    if (typeof aday !== 'string' || aday.length > 400) continue;
    const e = KAPAK_YOLU.exec(aday);
    if (e && e[1] === beklenen) return aday;
  }
  return null;
}

/** Yolun kısa özeti (FNV-1a, 8 onaltılık hane): parça değişince renderer yeni kapak ister. Jeton özetten geri çıkarılamaz. */
function kapakAnahtari(yol) {
  if (typeof yol !== 'string') return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < yol.length; i += 1) {
    h ^= yol.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function pngBoyutu(b) {
  if (b.length < 24 || u32be(b, 0) !== 0x89504e47 || u32be(b, 4) !== 0x0d0a1a0a || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { genislik: u32be(b, 16), yukseklik: u32be(b, 20) };
}

function jpegBoyutu(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const tip = b[i + 1];
    if (tip === 0xff) {
      i += 1; // dolgu baytı
      continue;
    }
    if (tip === 0xd8 || (tip >= 0xd0 && tip <= 0xd7) || tip === 0x01) {
      i += 2; // uzunluksuz işaretler
      continue;
    }
    const uzunluk = (b[i + 2] << 8) | b[i + 3];
    if (uzunluk < 2) return null;
    const sof = tip >= 0xc0 && tip <= 0xcf && tip !== 0xc4 && tip !== 0xc8 && tip !== 0xcc;
    if (sof) return { yukseklik: (b[i + 5] << 8) | b[i + 6], genislik: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + uzunluk;
  }
  return null;
}

function webpBoyutu(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const parca = b.toString('latin1', 12, 16);
  if (parca === 'VP8X') return { genislik: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), yukseklik: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (parca === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { genislik: (b[26] | (b[27] << 8)) & 0x3fff, yukseklik: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (parca === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { genislik: 1 + (bits & 0x3fff), yukseklik: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}

const BOYUT_OKUYUCULARI = Object.freeze({ 'image/png': pngBoyutu, 'image/jpeg': jpegBoyutu, 'image/webp': webpBoyutu });

/**
 * İçerik türü + baytlar uyumlu, sınırlar içinde bir resimse `data:` adresi, değilse null.
 * @param {unknown} icerikTuru Content-Type başlığı (küçük harf, parametresiz)
 * @param {Buffer|Uint8Array|null|undefined} bayt
 */
function kapakVeriAdresi(icerikTuru, bayt) {
  if (typeof icerikTuru !== 'string' || !IZINLI_TURLER.includes(icerikTuru)) return null;
  if (!bayt || typeof bayt.length !== 'number' || bayt.length === 0 || bayt.length > KAPAK_EN_COK_BAYT) return null;
  const tampon = Buffer.isBuffer(bayt) ? bayt : Buffer.from(bayt);
  const boyut = BOYUT_OKUYUCULARI[icerikTuru](tampon); // başlık türüne uymayan baytlar (sihirli sayı) burada null olur
  if (!boyut || !Number.isInteger(boyut.genislik) || !Number.isInteger(boyut.yukseklik)) return null;
  if (boyut.genislik < 1 || boyut.yukseklik < 1 || boyut.genislik > KENAR_SINIRI || boyut.yukseklik > KENAR_SINIRI) return null;
  if (boyut.genislik * boyut.yukseklik > PIKSEL_SINIRI) return null;
  return `data:${icerikTuru};base64,${tampon.toString('base64')}`;
}

/**
 * "Albüm kapağını göster" kapalıyken ana süreç modelindeki bütün medya karolarının kapak bayrağını söndürür (renderer hiç istemez).
 * Model yerinde değiştirilir; grup karoları ve bilgi bölümü üst kart karoları kapsanır.
 * @param {{gruplar?: object[], sonlar?: object[], bilgi?: {kartlar?: object[]}}} model
 */
function kapaklariKapat(model) {
  const sondur = (karo) => {
    const oz = karo?.ozellik;
    if (karo?.alan === 'media_player' && oz && typeof oz === 'object') {
      oz.kapak = false;
      oz.kapakAnahtari = null;
    }
  };
  for (const g of Array.isArray(model?.gruplar) ? model.gruplar : []) for (const k of Array.isArray(g?.karolar) ? g.karolar : []) sondur(k);
  for (const k of Array.isArray(model?.sonlar) ? model.sonlar : []) sondur(k);
  for (const c of Array.isArray(model?.bilgi?.kartlar) ? model.bilgi.kartlar : []) sondur(c?.karo);
  return model;
}

module.exports = { KAPAK_YOLU, KAPAK_EN_COK_BAYT, KENAR_SINIRI, PIKSEL_SINIRI, IZINLI_TURLER, kapakYolu, kapakAnahtari, kapakVeriAdresi, kapaklariKapat };
