'use strict';

/**
 * Oda temelli ilk kurulum önerisi (o-44; saf — HA verisi dışarıdan verilir, Electron'a ve ağa bağlı değildir).
 *
 * Ayarlar'da "Odadan başla": kullanıcı Home Assistant'ta tanımlı bir odayı (alan) seçer, o odadaki güvenli cihazların önerisini görür
 * ve "Seçime ekle" ile favori seçimine katar. Bu modül yalnız öneri listesini kurar; favoriyi kaydetmez, servis çağırmaz.
 *
 * Girdi: `/api/states` yanıtı (durumlar) ve `haOkuma.alanlar()` sonucu ({ alanlar: [{id, ad}], varlikAlanlari: { kimlik: alanId } }).
 * Bir varlık ÖNERİLİR ancak şunların hepsi doğruysa:
 *  - Kapı Kuralı süzgecinden (guvenliVarlikMi: kapı, kilit, alarm, garaj... adları ve cihaz sınıfları) GÜNCEL durumla geçiyorsa,
 *  - alan favori/karo olabilen bir EYLEM alanıysa (alan-kaydi.js; yalnız okunur sensörler, hava, takvim önerilmez: bir odada onlarca
 *    pil/sinyal sensörü olur ve başlangıç listesini boğar),
 *  - eylem sınıfı ZARARSIZ ise (onay isteyen düğme, script, seçici, sayı, zamanlayıcı ve PC kapatma gibi yıkıcı eylemler önerilmez;
 *    kullanıcı onları cihaz listesinden elle ekleyebilir),
 *  - Ayarlar'ın varsayılan gizlediği adaylardan (adayGizliMi) değilse ve durumu 'unavailable' değilse,
 *  - bir odaya (alana) atanmışsa; oda adı da süzgeçten geçmelidir (adı süzgeçten geçmeyen oda, örn. "Garaj", listede olmaz).
 * Oda başına en çok EN_COK_CIHAZ öneri döner (`toplam` süzülmüş toplamı söyler); önerisi olmayan oda listede yoktur.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');
const { karoAlaniMi, eylemAlaniMi, alanSirasi } = require('./alan-kaydi');
const { SINIF, eylemSinifi, adayGizliMi } = require('./eylem-sinifi');

// Ad sıralamasında kendi sıralama kuralı kullanılan diller (Türkçe varsayılan: ı/İ ve ç, ğ, ö, ş, ü sırası).
const SIRALAMA_DILLERI = ['en', 'de', 'fr', 'es'];

const EN_COK_ODA = 100;
const EN_COK_CIHAZ = 20; // oda başına öneri
const ODA_AD_SINIRI = 60;
const CIHAZ_AD_SINIRI = 100;
const ALAN_KIMLIGI_DESENI = /^[A-Za-z0-9_-]{1,64}$/;

/** Karo adı: friendly_name (kırpılmış) ya da kimlik. Ana süreçteki varlikAdi ile aynı kural. */
function varlikAdi(varlik) {
  const ad = varlik?.attributes?.friendly_name;
  if (typeof ad === 'string' && ad.trim()) return ad.trim().slice(0, CIHAZ_AD_SINIRI);
  return String(varlik?.entity_id ?? '');
}

/** Tek varlık oda önerisine girebilir mi (yukarıdaki kuralların varlık düzeyi). */
function onerilebilirMi(varlik) {
  if (!guvenliVarlikMi(varlik)) return false;
  const alan = alanAl(varlik.entity_id);
  if (!karoAlaniMi(alan) || !eylemAlaniMi(alan)) return false;
  if (adayGizliMi(varlik) || varlik.state === 'unavailable') return false;
  return eylemSinifi(varlik, {}).sinif === SINIF.ZARARSIZ;
}

/**
 * @param {object} g
 * @param {unknown} g.durumlar HA /api/states yanıtı (dizi değilse boş sonuç)
 * @param {unknown} g.alanVerisi haOkuma.alanlar() sonucu
 * @param {string} [g.dil] sıralama dili ('tr' | 'en' | 'de' | 'fr' | 'es')
 * @param {number} [g.enCokCihaz] oda başına öneri sınırı
 * @returns {{ id: string, ad: string, toplam: number, cihazlar: { entity_id: string, ad: string, alan: string }[] }[]}
 */
function odaOnerileri({ durumlar, alanVerisi, dil = 'tr', enCokCihaz = EN_COK_CIHAZ }) {
  if (!Array.isArray(durumlar) || !alanVerisi || typeof alanVerisi !== 'object') return [];
  const odalar = new Map(); // alan kimliği -> { id, ad, adaylar: [] }
  for (const a of Array.isArray(alanVerisi.alanlar) ? alanVerisi.alanlar : []) {
    if (odalar.size >= EN_COK_ODA) break;
    const id = typeof a?.id === 'string' && ALAN_KIMLIGI_DESENI.test(a.id) ? a.id : null;
    const ad = guvenliMetin(a?.ad, ODA_AD_SINIRI); // oda adı da Kapı Kuralı'ndan geçer
    if (id && ad && !odalar.has(id)) odalar.set(id, { id, ad, adaylar: [] });
  }
  const esleme = alanVerisi.varlikAlanlari && typeof alanVerisi.varlikAlanlari === 'object' ? alanVerisi.varlikAlanlari : {};
  const gorulen = new Set();
  for (const varlik of durumlar) {
    const kimlik = varlik?.entity_id;
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik) || gorulen.has(kimlik)) continue;
    if (!Object.hasOwn(esleme, kimlik)) continue;
    const oda = odalar.get(esleme[kimlik]);
    if (!oda || !onerilebilirMi(varlik)) continue;
    gorulen.add(kimlik);
    oda.adaylar.push({ entity_id: kimlik, ad: varlikAdi(varlik), alan: alanAl(kimlik) });
  }
  const karsilastir = (a, b) => String(a).localeCompare(String(b), SIRALAMA_DILLERI.includes(dil) ? dil : 'tr');
  return [...odalar.values()]
    .filter((o) => o.adaylar.length > 0)
    .sort((a, b) => karsilastir(a.ad, b.ad))
    .map((o) => ({
      id: o.id,
      ad: o.ad,
      toplam: o.adaylar.length,
      cihazlar: o.adaylar.sort((a, b) => alanSirasi(a.alan) - alanSirasi(b.alan) || karsilastir(a.ad, b.ad)).slice(0, Math.max(0, enCokCihaz)),
    }));
}

module.exports = { EN_COK_ODA, EN_COK_CIHAZ, ODA_AD_SINIRI, onerilebilirMi, odaOnerileri };
