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
const { tercihEkranBul } = require('./pencere-yerlesim');

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
 * @param {{ad?: string, durum: string, uyari?: string|null, acikIsik?: number|null, sensorUyari?: number|null, canli?: boolean, gelistirme?: boolean, ek?: string|null, t?: Function}} g
 *   ad verilmezse uygulamanın o dildeki adı (t('uygulama.ad')) kullanılır. ek (1.4.0, o-27): tepsi rozeti 'sensor' modundaki sensörün kısa
 *   metni ("Salon sıcaklığı: 21,5 °C"); ışık sayısından sonra eklenir. sensorUyari (o-04): dikkat gerektiren sensör sayısı
 *   (bilgi-modeli.js sensorUyariSayisi); 0 ya da verilmezse eklenmez. Sayı sonda durur: ipucu 120 karakter sınırında kısalırsa önce o kesilir.
 */
function ipucuMetni({ ad, durum, uyari = null, acikIsik = null, sensorUyari = null, canli = true, gelistirme = false, ek = null, t = TR }) {
  let metin = `${ad ?? t('uygulama.ad')}${gelistirme ? t('uygulama.gelistirme') : ''} — ${durum}`;
  if (typeof uyari === 'string' && uyari) metin += ` — ${uyari}`;
  if (Number.isInteger(acikIsik) && acikIsik > 0) {
    metin += ` — ${cogul(t, 'tepsi.isikAcik', acikIsik)}`;
    if (canli === false) metin += ` ${t('tepsi.sonBilinen')}`;
  }
  if (typeof ek === 'string' && ek !== '') metin += ` — ${ek}`;
  if (Number.isInteger(sensorUyari) && sensorUyari > 0) metin += ` — ${cogul(t, 'tepsi.sensorUyari', sensorUyari)}`;
  return kisalt(metin, IPUCU_SINIRI);
}

/** Ekran menüsü etiketi: "Ekran 2  ·  2560×1440" (birincil ekranda "  ·  ana ekran" eklenir). `sira` 0'dan başlar; liste birincil önce sıralıdır. */
function ekranEtiketi(ekran, sira, t = TR) {
  const boyut = `${ekran.sinirlar.width}×${ekran.sinirlar.height}`;
  return `${t('tepsi.ekran', { n: sira + 1 })}  ·  ${boyut}${ekran.birincil ? `  ·  ${t('tepsi.ekranAna')}` : ''}`;
}

/**
 * Tepsi menüsünün "Ekrana taşı" altmenüsü planı (1.4.0, o-32): bağlı ekranlar (ekranlariOzetle sırasıyla) ve tercih edilen ekran
 * işaretli. Tek ekran varken menü anlamsızdır: boş liste (menü öğesi hiç eklenmez).
 * @param {object[]} ekranlar ekranlariOzetle sonucu
 * @param {object|undefined} tercihEkran ayardaki tercih ({} ya da { id, x, y, genislik, yukseklik })
 * @returns {{id: number, label: string, checked: boolean}[]}
 */
function ekranMenuPlani(ekranlar, tercihEkran, t = TR) {
  const liste = Array.isArray(ekranlar) ? ekranlar : [];
  if (liste.length < 2) return [];
  const tercih = tercihEkranBul(liste, tercihEkran);
  return liste.map((ekran, sira) => ({ id: ekran.id, label: ekranEtiketi(ekran, sira, t), checked: tercih !== null && tercih.id === ekran.id }));
}

module.exports = { UST_SAYISI, IPUCU_SINIRI, menuOgesi, tepsiMenuPlani, acikIsikSayisi, ipucuMetni, ekranEtiketi, ekranMenuPlani };
