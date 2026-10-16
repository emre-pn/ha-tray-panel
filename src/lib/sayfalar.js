'use strict';

/**
 * Panel sayfaları (sekmeler) — doğrulama ve model (saf) — 1.4.0 düzen grubu (o-24).
 *
 * Ayarda `sayfalar` = [{ id, ad, varliklar: [kimlik, ...] }]: her sayfa favorilerin kendi sıralı alt kümesidir. Hiç sayfa yoksa panel
 * bugünkü gibi sabit gruplarla ("Tümü") çalışır; sayfalar yalnız ek sekmelerdir. HA panoları (src/lib/panolar.js) ayrı bir şeydir.
 *
 * Güvenlik: sayfa adı ve varlık kimlikleri KAPI KURALI'ndan geçer (ad: guvenliMetin; kimlik: alan kaydı + adGuvenliMi). Sayfa varlıkları
 * yalnız bir kayıttır; panelde bir karo olarak görünmesi için ayrıca favori olması ve güncel durumuyla süzgeçten (yuzey-modeli.js
 * karoOlustur) geçmesi gerekir. Sayfa HİÇBİR ZAMAN yeni bir eylem yolu açmaz.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, guvenliMetin } = require('./suzgec');
const { karoAlaniMi } = require('./alan-kaydi');
const { EN_COK_SAYFA, EN_COK_SAYFA_VARLIGI, SAYFA_AD_SINIRI, SAYFA_KIMLIGI_DESENI } = require('./duzen-islemleri');

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/** Sayfa varlığı olabilen kimlik: biçim, karo olabilen alan ve kapı kuralı (adın kendisi canlı durumla ayrıca denetlenir). */
function varlikKimligiGecerliMi(kimlik) {
  return typeof kimlik === 'string' && VARLIK_KIMLIGI_DESENI.test(kimlik) && karoAlaniMi(alanAl(kimlik)) && adGuvenliMi(kimlik, '');
}

/** Sayfa adı: kısaltılır; boşsa ya da kapı kuralından geçmiyorsa '' (sayfa korunur, adsız gösterilir). */
function sayfaAdiDuzelt(ad) {
  if (typeof ad !== 'string' || ad.length > SAYFA_AD_SINIRI * 8) return '';
  return guvenliMetin(ad, SAYFA_AD_SINIRI) ?? '';
}

/**
 * Ayardaki / Ayarlar'dan gelen sayfa listesini temizler. Dizi değilse undefined (ayar-alanlari: varsayılana düşer ya da uyarı verir).
 * Geçersiz kimlikli, yinelenen ya da sınırı aşan sayfalar düşer; geçersiz / yinelenen / fazla varlıklar düşer; hiçbir sayfa için hata fırlatmaz.
 * @param {unknown} ham
 * @returns {{id: string, ad: string, varliklar: string[]}[]|undefined}
 */
function sayfalariDuzelt(ham) {
  if (!Array.isArray(ham)) return undefined;
  const sonuc = [];
  const gorulen = new Set();
  for (const oge of ham) {
    if (sonuc.length >= EN_COK_SAYFA) break;
    if (!duzNesneMi(oge) || typeof oge.id !== 'string' || !SAYFA_KIMLIGI_DESENI.test(oge.id) || gorulen.has(oge.id)) continue;
    gorulen.add(oge.id);
    const varliklar = [];
    for (const kimlik of Array.isArray(oge.varliklar) ? oge.varliklar : []) {
      if (varliklar.length >= EN_COK_SAYFA_VARLIGI) break;
      if (varlikKimligiGecerliMi(kimlik) && !varliklar.includes(kimlik)) varliklar.push(kimlik);
    }
    sonuc.push({ id: oge.id, ad: sayfaAdiDuzelt(oge.ad), varliklar });
  }
  return sonuc;
}

/**
 * Kayıt sırasında ad nedeniyle adsız bırakılan sayfa sayısı (Ayarlar uyarısı için): istenen ad doluydu ama sonuçta boş.
 * @param {unknown} istenen Ayarlar'dan gelen liste
 * @param {{id: string, ad: string}[]} sonuc sayfalariDuzelt sonucu
 */
function adiEngellenenSayisi(istenen, sonuc) {
  if (!Array.isArray(istenen) || !Array.isArray(sonuc)) return 0;
  const adlar = new Map(sonuc.map((s) => [s.id, s.ad]));
  return istenen.filter((s) => duzNesneMi(s) && typeof s.ad === 'string' && s.ad.trim() !== '' && adlar.has(s.id) && adlar.get(s.id) === '').length;
}

/** Favori olmayan varlıkları sayfalardan atar (kayıt sırasında / favori kaldırılınca). Sayfaların kendisi ve sırası korunur. */
function sayfalariBuda(sayfalar, favoriKimlikleri) {
  const kume = favoriKimlikleri instanceof Set ? favoriKimlikleri : new Set(favoriKimlikleri);
  return (Array.isArray(sayfalar) ? sayfalar : []).map((s) => ({ ...s, varliklar: s.varliklar.filter((k) => kume.has(k)) }));
}

/**
 * Renderer'a giden sayfa listesi: yalnız modelde gerçekten karo olan (kapı kuralından geçmiş) varlıklar kalır.
 * Adsız sayfa için `adsiz(n)` ile sıra numaralı ad üretilir.
 * @param {{id: string, ad: string, varliklar: string[]}[]} sayfalar
 * @param {Set<string>} karoKimlikleri modelde bulunan karoların kimlikleri
 * @param {(n: number) => string} adsiz
 * @returns {{id: string, ad: string, kimlikler: string[]}[]}
 */
function sayfalariModele(sayfalar, karoKimlikleri, adsiz) {
  return (Array.isArray(sayfalar) ? sayfalar : []).map((s, i) => ({
    id: s.id,
    ad: s.ad || (typeof adsiz === 'function' ? adsiz(i + 1) : `${i + 1}`),
    kimlikler: s.varliklar.filter((k) => karoKimlikleri.has(k)),
  }));
}

module.exports = { varlikKimligiGecerliMi, sayfaAdiDuzelt, sayfalariDuzelt, adiEngellenenSayisi, sayfalariBuda, sayfalariModele };
