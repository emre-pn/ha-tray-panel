'use strict';

/**
 * Tepsi menüsündeki favori öğelerinin planı (saf) — hiz-15 — ve tepsi simgesinin ipucu metni — detay-18.
 *
 * İlk 8 zararsız favori menünün ÜST düzeyindedir (tek tıkla), kalan zararsızlar "Diğer favoriler" altmenüsünde,
 * onay isteyen (yıkıcı) eylemler "Onaylı eylemler" altmenüsündedir (tıklayınca onay penceresi çıkar).
 * Girdi, yuzey-modeli.js'in süzgeçten geçirdiği karolardır: kapı/kilit/alarm burada hiç yoktur.
 */

const { kisalt } = require('./metin');
const { cogul } = require('./dil');
const { TR } = require('./ceviri-varsayilan');

const UST_SAYISI = 8;
const IPUCU_SINIRI = 120; // Windows tepsi ipucu ~127 karakterde kesilir

const TUR_ANAHTARLARI = Object.freeze({ scene: 'tepsi.tur.sahne', script: 'tepsi.tur.script', button: 'tepsi.tur.dugme', input_button: 'tepsi.tur.dugme' });
const ACIK_KAPALI_ALANLARI = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier']);

/**
 * @param {object} karo yuzey-modeli.js karosu
 * @param {Function} [t] çevirmen (src/lib/dil.js); verilmezse Türkçe
 * @returns {{kimlik: string, label: string, checkbox: boolean, checked: boolean, yikici: boolean, kullanilabilir: boolean}}
 */
function menuOgesi(karo, t = TR) {
  const yikici = karo.sinif === 'yikici';
  const ek = karo.ulasilamiyor === true ? `  ${t('tepsi.ulasilamiyor')}` : '';
  if (yikici) {
    return { kimlik: karo.id, label: `${karo.etiket} — ${t('tepsi.onayIster')}${ek}`, checkbox: false, checked: false, yikici: true, kullanilabilir: karo.kullanilabilir };
  }
  if (ACIK_KAPALI_ALANLARI.has(karo.alan)) {
    const yuzde = karo.durum === 'acik' && typeof karo.yuzde === 'number' ? `  ·  ${t('tepsi.yuzde', { n: karo.yuzde })}` : '';
    return { kimlik: karo.id, label: `${karo.etiket}${yuzde}${ek}`, checkbox: true, checked: karo.durum === 'acik', yikici: false, kullanilabilir: karo.kullanilabilir };
  }
  const turAnahtari = TUR_ANAHTARLARI[karo.alan];
  const tur = turAnahtari ? t(turAnahtari) : undefined;
  return { kimlik: karo.id, label: `${karo.etiket}${tur ? `  ·  ${tur}` : ''}${ek}`, checkbox: false, checked: false, yikici: false, kullanilabilir: karo.kullanilabilir };
}

/**
 * @param {object[]} karolar favori sırasındaki karolar (yuzey-modeli.js)
 * @param {{ustSayi?: number, t?: Function}} [secenek] t: çevirmen (verilmezse Türkçe)
 * @returns {{ust: object[], alt: object[], yikici: object[]}}
 */
function tepsiMenuPlani(karolar, { ustSayi = UST_SAYISI, t = TR } = {}) {
  // 1.4.0: tek tıklama eylemi olmayan karolar (iklim, medya, sensör...; varsayilanEylem:false) menüye girmez.
  const liste = (Array.isArray(karolar) ? karolar : []).filter((k) => k.varsayilanEylem !== false);
  // 1.4.0 (o-16 "tepsiye ekle"): tepsiye sabitlenen zararsız favoriler (tepsi:true) üst düzeyde önce gelir; sıra kendi içinde favori sırasıdır.
  const zararsizKarolar = liste.filter((k) => k.sinif !== 'yikici');
  const zararsiz = [...zararsizKarolar.filter((k) => k.tepsi === true), ...zararsizKarolar.filter((k) => k.tepsi !== true)].map((k) => menuOgesi(k, t));
  return {
    ust: zararsiz.slice(0, ustSayi),
    alt: zararsiz.slice(ustSayi),
    yikici: liste.filter((k) => k.sinif === 'yikici').map((k) => menuOgesi(k, t)),
  };
}

/** Favori ışıklardan şu an AÇIK olanların sayısı (yuzey-modeli.js karoları; süzgeçten geçmeyen karo zaten yoktur). */
function acikIsikSayisi(karolar) {
  return (Array.isArray(karolar) ? karolar : []).filter((k) => k.alan === 'light' && k.durum === 'acik').length;
}

/**
 * Tepsi simgesinin ipucu: "Ev Paneli — Ev ağı — 2 ışık açık". Açık ışık yoksa (ya da sayı bilinmiyorsa) ekleme yapılmaz.
 * Canlı bağlantı yokken sayı REST yedeğinin son okumasıdır: "(son bilinen)" notu düşülür. Geliştirme sürümü başlıkta ayrılır.
 * Yetki kesici açıksa (anahtar Home Assistant tarafından reddedildi) `uyari` kısa metni durumdan hemen sonra görünür.
 * @param {{ad?: string, durum: string, uyari?: string|null, acikIsik?: number|null, canli?: boolean, gelistirme?: boolean, t?: Function}} g
 *   ad verilmezse uygulamanın o dildeki adı (t('uygulama.ad')) kullanılır
 */
function ipucuMetni({ ad, durum, uyari = null, acikIsik = null, canli = true, gelistirme = false, t = TR }) {
  let metin = `${ad ?? t('uygulama.ad')}${gelistirme ? t('uygulama.gelistirme') : ''} — ${durum}`;
  if (typeof uyari === 'string' && uyari) metin += ` — ${uyari}`;
  if (Number.isInteger(acikIsik) && acikIsik > 0) {
    metin += ` — ${cogul(t, 'tepsi.isikAcik', acikIsik)}`;
    if (canli === false) metin += ` ${t('tepsi.sonBilinen')}`;
  }
  return kisalt(metin, IPUCU_SINIRI);
}

module.exports = { UST_SAYISI, IPUCU_SINIRI, menuOgesi, tepsiMenuPlani, acikIsikSayisi, ipucuMetni };
