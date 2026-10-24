'use strict';

/**
 * Metin yardımcıları (saf; Electron'a bağlı değildir).
 */

// Görünmez biçim karakterleri (yumuşak tire, sıfır genişlikli boşluk/birleştirici, word joiner, BOM, yön işaretleri, etiket
// karakterleri: \p{Cf}) ve yazdırılamayan denetim karakterleri (\p{Cc}; sekme/satır sonu ayraç olarak kalır) sözcüğün ortasında
// durup onu bölemesin: "Ka\u00ADpı" -> "kapi" (hata-03).
const GORUNMEZ_KARAKTERLER = /\p{Cf}|(?![\t-\r\u0085])\p{Cc}/gu;
// NFKD'nin çözmediği harf benzeri semboller: ters daire/kare içindeki harfler ve bölge göstergeleri A-Z'ye karşılık gelir.
const SEMBOL_HARFLERI = /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu;
const SEMBOL_HARF_TABANLARI = [0x1f150, 0x1f170, 0x1f1e6];
// NFKD'nin ayrıştıramadığı yaygın Latin harfleri ASCII karşılığına indirilir.
const LATIN_ESLEMELERI = { ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th' };
const LATIN_DESENI = new RegExp(`[${Object.keys(LATIN_ESLEMELERI).join('')}]`, 'g');

function sembolHarfiniCoz(harf) {
  const kod = harf.codePointAt(0);
  const taban = SEMBOL_HARF_TABANLARI.find((t) => kod >= t && kod < t + 26);
  return String.fromCharCode(97 + kod - taban);
}

/**
 * Türkçe büyük/küçük harf, aksan ve uyumluluk biçimlerini sadeleştirir: "KAPI", "Kapı", "ｋａｐｉ", "𝐊𝐀𝐏𝐈" -> "kapi".
 * Sıra önemlidir: önce NFKD (tam genişlikli, matematik alfasayısal ve kare/daire harfler yalnız BÜYÜK harf olarak
 * çözülür; küçültme bundan SONRA yapılmalı), sonra küçük harf (tr-TR: "I" -> "ı"), sonra yeniden NFKD.
 * Birleştirici işaretler (\p{M}) ve görünmez biçim karakterleri silinir (hata-03).
 */
function sadelestir(metin) {
  return String(metin ?? '')
    .normalize('NFKD')
    .replace(SEMBOL_HARFLERI, sembolHarfiniCoz)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(GORUNMEZ_KARAKTERLER, '')
    .replace(LATIN_DESENI, (harf) => LATIN_ESLEMELERI[harf]);
}

// Ad katlama saf bir metin -> metin eşlemesidir ve aynı favori adları tekrar tekrar katlanır (komut satırı adı çözümü her karoyu
// listedeki tüm adlarla karşılaştırır: O(N²) katlama). Sonuç girdi metni başına saklanır; büyüklük ve girdi uzunluğu sınırlıdır
// (dolunca boşaltılır). Kapı Kuralı süzgeci (sadelestir) önbelleğe alınmaz: yalnız anahtarKatla ve adAnahtari sonuçları.
const ONBELLEK_SINIRI = 4096;
const ONBELLEK_EN_UZUN_GIRDI = 256;
const ANAHTAR_ONBELLEGI = new Map();
const AD_ANAHTARI_ONBELLEGI = new Map();

function onbellekli(onbellek, metin, hesapla) {
  const girdi = String(metin ?? '');
  if (girdi.length > ONBELLEK_EN_UZUN_GIRDI) return hesapla(girdi);
  const kayitli = onbellek.get(girdi);
  if (kayitli !== undefined) return kayitli;
  const sonuc = hesapla(girdi);
  if (onbellek.size >= ONBELLEK_SINIRI) onbellek.clear();
  onbellek.set(girdi, sonuc);
  return sonuc;
}

/**
 * Ad eşleme anahtarı (komut satırı --eylem=): sadeleştirir, harf/rakam dışını tek boşluğa indirir.
 * "Gece lambası", "gece-lambasi", "GECE_LAMBASI" -> "gece lambasi".
 */
function anahtarKatla(metin) {
  return onbellekli(ANAHTAR_ONBELLEGI, metin, (m) =>
    sadelestir(m)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  );
}

/**
 * Ad anahtarı (komut satırı --eylem=): anahtarKatla gibidir, ama BOŞLUKLA AYRILMIŞ tek başına duran işaretleri sözcüğe çevirir:
 * "+" -> "arti", "-" ve "−" (U+2212) -> "eksi". Böylece "Ses +" ve "Ses −" aynı "ses" anahtarına düşüp birbirini silmez (h-21):
 * "Ses +" -> "ses arti", "Ses −" -> "ses eksi". Sözcüğe bitişik işaretler ("gece-lambasi", "ses+") ayraç gibi davranmaya devam eder.
 */
function adAnahtari(metin) {
  return onbellekli(AD_ANAHTARI_ONBELLEGI, metin, (m) =>
    sadelestir(m)
      .replace(/(^|\s)([+\-\u{2212}])(?=\s|$)/gu, (_eslesme, bas, isaret) => `${bas}${isaret === '+' ? 'arti' : 'eksi'}`)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  );
}

/** Kod noktası sayısına göre keser (vekil çiftleri bölünmez); boşlukları teke indirir. */
function kisalt(metin, enFazla) {
  const temiz = String(metin ?? '').replace(/\s+/g, ' ').trim();
  const harfler = Array.from(temiz);
  return harfler.length <= enFazla ? temiz : harfler.slice(0, enFazla).join('');
}

module.exports = { sadelestir, anahtarKatla, adAnahtari, kisalt };
