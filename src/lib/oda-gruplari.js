'use strict';

/**
 * Oda (alan) gruplaması ve "odayı kapat" adayları (o-14, 1.4.0 eylem grubu; saf, Electron'a bağlı değildir).
 *
 * Girdi: panel modelinin tür gruplu karoları (yuzey-modeli.js karolariGrupla) ve Home Assistant'ın alan (oda) kaydı
 * (src/lib/ha-okuma.js alanlar(): { alanlar: [{ id, ad }], varlikAlanlari: { kimlik: alanId } }).
 *
 *  - Oda gruplaması YALNIZ görünümdür: odası bilinen karo oda grubuna, odası olmayan karo kendi tür grubunda (Işık, Sahne, PC, Medya,
 *    Onaylı...) kalır. Karo kümesi aynıdır; yeni karo eklenmez, hiçbir karo çıkarılmaz ve süzgeç (Kapı Kuralı) zaten karoOlustur'da uygulanmıştır.
 *    Oda adı da Kapı Kuralı'ndan geçer (adı süzgeçten geçmeyen oda, örn. "Garaj", grup olmaz; karoları tür grubunda kalır).
 *  - Oda grubunun kodu `oda-<8 onaltılık>` (alan kimliğinin özeti) ve etiketi oda adıdır; `oda: true` işareti taşır.
 *  - "Odayı kapat" adayları: odadaki FAVORİLER arasında şu an AÇIK olan, alanı ışık / priz / vantilatör / sanal anahtar / nem alıcı olan,
 *    Kapı Kuralı'ndan geçen ve `turn_off` için ZARARSIZ sınıfta olanlar. Kilit, alarm, kapı, garaj, kepenk, perde, klima, medya, düğme,
 *    script, otomasyon, vana, kamera ve onay isteyen (yıkıcı) hiçbir şey aday olmaz. Üye listesini HER ZAMAN ana süreç yeniden hesaplar;
 *    renderer yalnız grup kodunu söyler.
 */

const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');

const ODA_KAPAT_ALANLARI = Object.freeze(['light', 'switch', 'fan', 'input_boolean', 'humidifier']);
const KAPAT_SERVISI = 'turn_off';
const EN_COK_ODA_UYESI = 30;
const EN_COK_ODA = 60;
const ODA_ETIKET_SINIRI = 30; // renderer grup etiketi sınırı
const ODA_KODU_DESENI = /^oda-[0-9a-f]{8}$/;

/** FNV-1a 32 bit özeti, 8 onaltılık hane. */
function ozet8(metin) {
  let h = 0x811c9dc5;
  for (let i = 0; i < metin.length; i += 1) {
    h ^= metin.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const odaAdi = (ad) => guvenliMetin(typeof ad === 'string' ? ad.trim() : '', ODA_ETIKET_SINIRI);

/**
 * Alan listesinden güvenli odaları ve gruplama kodlarını çıkarır. Kodlar kimliğe göre SIRALI üretilir: aynı alan listesi her zaman aynı
 * kodları verir (çakışma olasılığı çok düşüktür; olursa sonrakine ek özet verilir).
 * @returns {Map<string, {id: string, ad: string, kod: string}>} alan kimliği -> oda
 */
function odalariCikar(alanVerisi) {
  const sonuc = new Map();
  const kullanilan = new Set();
  const liste = Array.isArray(alanVerisi?.alanlar) ? alanVerisi.alanlar : [];
  const sirali = liste.filter((a) => a && typeof a.id === 'string' && a.id !== '').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const a of sirali) {
    if (sonuc.size >= EN_COK_ODA) break;
    if (sonuc.has(a.id)) continue;
    const ad = odaAdi(a.ad);
    if (!ad) continue; // adı süzgeçten geçmeyen oda grup olmaz
    let kod = `oda-${ozet8(a.id)}`;
    for (let n = 1; kullanilan.has(kod); n += 1) kod = `oda-${ozet8(`${a.id}#${n}`)}`;
    kullanilan.add(kod);
    sonuc.set(a.id, { id: a.id, ad, kod });
  }
  return sonuc;
}

/**
 * Tür gruplarını oda gruplarına dönüştürür: odası bilinen karolar oda gruplarına (oda adına göre sıralı), kalanlar kendi tür grubunda.
 * Hiç karonun odası bilinmiyorsa (kayıt okunamadı, yönetici yetkisi yok) girdi aynen döner.
 * @param {{kod: string, etiket: string, karolar: object[]}[]} gruplar
 * @param {{alanlar?: object[], varlikAlanlari?: object}|null|undefined} alanVerisi
 * @param {{dil?: string}} [secenek] oda adlarının sıralama dili
 */
function odaGruplari(gruplar, alanVerisi, { dil = 'tr' } = {}) {
  const girdi = Array.isArray(gruplar) ? gruplar : [];
  const esleme = alanVerisi?.varlikAlanlari && typeof alanVerisi.varlikAlanlari === 'object' ? alanVerisi.varlikAlanlari : {};
  const odalar = odalariCikar(alanVerisi);
  if (odalar.size === 0) return girdi;
  const kovalar = new Map(); // alan kimliği -> karolar
  const kalanlar = girdi.map((g) => ({ ...g, karolar: [] }));
  let tasinan = 0;
  girdi.forEach((g, i) => {
    for (const karo of Array.isArray(g?.karolar) ? g.karolar : []) {
      const alanId = typeof karo?.id === 'string' && Object.hasOwn(esleme, karo.id) ? esleme[karo.id] : undefined;
      if (typeof alanId === 'string' && odalar.has(alanId)) {
        if (!kovalar.has(alanId)) kovalar.set(alanId, []);
        kovalar.get(alanId).push(karo);
        tasinan += 1;
      } else {
        kalanlar[i].karolar.push(karo);
      }
    }
  });
  if (tasinan === 0) return girdi;
  let siralayici;
  try {
    siralayici = new Intl.Collator(dil, { sensitivity: 'base', numeric: true });
  } catch {
    siralayici = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
  }
  const odaGruplari = [...kovalar.entries()]
    .map(([alanId, karolar]) => ({ oda: odalar.get(alanId), karolar }))
    .sort((a, b) => siralayici.compare(a.oda.ad, b.oda.ad) || (a.oda.id < b.oda.id ? -1 : 1))
    .map(({ oda, karolar }) => ({ kod: oda.kod, etiket: oda.ad, karolar, oda: true }));
  return [...odaGruplari, ...kalanlar.filter((g) => g.karolar.length > 0)];
}

/** Grup kodundan oda ({ id, ad, kod }) ya da null. Kod biçimi ve alan kaydı doğrulanır. */
function odaBul(kod, alanVerisi) {
  if (typeof kod !== 'string' || !ODA_KODU_DESENI.test(kod)) return null;
  for (const oda of odalariCikar(alanVerisi).values()) if (oda.kod === kod) return oda;
  return null;
}

/**
 * "Odayı kapat" üyeleri: odadaki favorilerden şu an açık, zararsız ve kapatılabilir olanlar (yukarıdaki kurallar).
 * @param {object} g
 * @param {object[]} g.favoriler ayardaki favoriler
 * @param {(kimlik: string) => object|null|undefined} g.durumAl depo okuyucu
 * @param {{alanlar?: object[], varlikAlanlari?: object}} g.alanVerisi
 * @param {string} g.alanId
 * @returns {{kimlik: string, ad: string, kayit: object}[]}
 */
function odaKapatUyeleri({ favoriler, durumAl, alanVerisi, alanId }) {
  const esleme = alanVerisi?.varlikAlanlari && typeof alanVerisi.varlikAlanlari === 'object' ? alanVerisi.varlikAlanlari : {};
  const uyeler = [];
  for (const favori of Array.isArray(favoriler) ? favoriler : []) {
    if (uyeler.length >= EN_COK_ODA_UYESI) break;
    const kimlik = favori?.entity_id;
    if (typeof kimlik !== 'string' || !Object.hasOwn(esleme, kimlik) || esleme[kimlik] !== alanId) continue;
    if (!ODA_KAPAT_ALANLARI.includes(alanAl(kimlik))) continue;
    const varlik = durumAl(kimlik);
    if (!varlik || typeof varlik !== 'object' || varlik.entity_id !== kimlik || varlik.state !== 'on') continue;
    if (!guvenliVarlikMi(varlik)) continue;
    if (eylemSinifi(varlik, favori, KAPAT_SERVISI).sinif !== SINIF.ZARARSIZ) continue;
    const canliAd = varlik.attributes?.friendly_name;
    const ad = (typeof favori.etiket === 'string' && favori.etiket.trim()) || (typeof canliAd === 'string' && canliAd.trim()) || (typeof favori.ad === 'string' && favori.ad.trim()) || kimlik;
    uyeler.push({ kimlik, ad, kayit: favori });
  }
  return uyeler;
}

module.exports = {
  ODA_KAPAT_ALANLARI,
  KAPAT_SERVISI,
  EN_COK_ODA_UYESI,
  EN_COK_ODA,
  ODA_KODU_DESENI,
  ozet8,
  odalariCikar,
  odaGruplari,
  odaBul,
  odaKapatUyeleri,
};
