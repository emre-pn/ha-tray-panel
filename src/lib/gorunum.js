'use strict';

/**
 * Tema, pencere vurgu rengi, metin boyutu, yüksek karşıtlık ve kozmetik animasyon ayarları (saf) — gorunum-13, o-25, o-29, o-34.
 *
 * `temaZorla`: 'koyu' | 'sistem' | 'acik'. 'koyu' iken nativeTheme.themeSource = 'dark', 'acik' iken 'light' olur (Electron'un çizdiği
 * arayüzler ve Windows başlık çubuğu için; başlık çubuğunun gerçekten renk değiştirdiği DENENMEDİ). Yan etki: Home Assistant profilinde
 * tema "otomatik" ise HA de aynı temayı izler (prefers-color-scheme).
 * `vurguRengi`: '' (Windows'un vurgu rengi) ya da "#rrggbb" (ana pencere kenarlığı için setAccentColor). PANEL vurgusu ayrıdır (panelVurguRengi).
 * Özel başlık çubuğu YAPILMAZ (kırılgan; HA sayfasına sürükleme alanı enjekte etmek gerekir).
 *
 * Yeni alanlar (ayar-alanlari.js tablosu):
 *   metinOlcegi (100 | 115 | 130 | 150)  hızlı panel / palet / köşe bildirimi / Ayarlar penceresi metin ve denetim boyutu (%). HA penceresine DOKUNULMAZ.
 *   yuksekKarsitlik (bool)               opak zemin (malzeme kapalı), belirgin kenarlık, en az 7:1 metin kontrastı (CSS: :root[data-karsitlik]).
 *   panelTemasi (HAZIR_TEMA_ADLARI), panelVurguRengi, panelArkaPlani   panel/palet/köşe bildirimi renkleri (tema-renk.js üretir).
 *   animasyonlar (bool, varsayılan KAPALI), animasyonGecisleri, havaEfekti, mevsimEfekti, hareketiAzalt   kozmetik animasyonlar (efekt.js).
 * Hareket kuralı: sistemde "hareketi azalt" (CSS prefers-reduced-motion) ya da hareketiAzalt açıksa HİÇBİR kozmetik animasyon çalışmaz;
 * ayar bunu yalnız daraltabilir, sistem tercihini geçersiz kılamaz.
 */

const { HAZIR_TEMA_ADLARI, ozelPaletGerekli, paletUret } = require('./tema-renk');

const TEMA_DEGERLERI = ['koyu', 'sistem', 'acik'];
const VARSAYILAN_TEMA = 'koyu';
const VURGU_DESENI = /^#[0-9a-fA-F]{6}$/;
const METIN_OLCEKLERI = Object.freeze([100, 115, 130, 150]);
const VARSAYILAN_METIN_OLCEGI = 100;
const HAVA_EFEKTI_DEGERLERI = Object.freeze(['yok', 'otomatik', 'yagmur', 'kar', 'gunes', 'firtina']);
const MEVSIM_EFEKTI_DEGERLERI = Object.freeze(['yok', 'otomatik', 'ilkbahar', 'yaz', 'sonbahar', 'kis']);

/** Ayardan gelen tema değerini düzeltir; geçersizse `varsayilan`. */
function temaDuzelt(deger, varsayilan = VARSAYILAN_TEMA) {
  if (TEMA_DEGERLERI.includes(deger)) return deger;
  return TEMA_DEGERLERI.includes(varsayilan) ? varsayilan : VARSAYILAN_TEMA;
}

/** nativeTheme.themeSource değeri. */
function temaKaynagi(tema) {
  const t = temaDuzelt(tema);
  return t === 'koyu' ? 'dark' : t === 'acik' ? 'light' : 'system';
}

/**
 * Vurgu rengini düzeltir: boş metin -> '' (sistem rengi), "#rrggbb" -> küçük harfli aynısı; başka her şey (3 haneli kısa
 * biçim, ad, rgb(), metin olmayan değer) -> null (geçersiz).
 * @returns {string|null}
 */
function vurguRengiDuzelt(deger) {
  if (typeof deger !== 'string') return null;
  const metin = deger.trim();
  if (metin === '') return '';
  return VURGU_DESENI.test(metin) ? metin.toLowerCase() : null;
}

/** Metin ölçeği (%): 100/115/130/150; sayı ya da sayı metni kabul edilir, geçersizse `varsayilan`. */
function metinOlcegiDuzelt(ham, varsayilan = VARSAYILAN_METIN_OLCEGI) {
  const n = typeof ham === 'number' ? ham : typeof ham === 'string' && ham.trim() !== '' ? Number(ham) : NaN;
  if (METIN_OLCEKLERI.includes(n)) return n;
  return METIN_OLCEKLERI.includes(varsayilan) ? varsayilan : VARSAYILAN_METIN_OLCEGI;
}

/** Metin ölçeğinin çarpanı (1, 1.15, 1.3, 1.5): pencere yakınlaştırma adımlarıyla (pencere-yerlesim.js YAKINLASTIRMA_ADIMLARI) aynı değerler. */
function metinOlcegiOrani(ham) {
  return metinOlcegiDuzelt(ham) / 100;
}

/** Etkin tema: ayar 'koyu' / 'acik' ise o, 'sistem' ise Windows'un temasına (sistemKoyu) göre. */
function etkinSema(temaZorla, sistemKoyu = true) {
  const t = temaDuzelt(temaZorla);
  if (t === 'koyu') return 'koyu';
  if (t === 'acik') return 'acik';
  return sistemKoyu === false ? 'acik' : 'koyu';
}

/** Electron nativeTheme: Windows koyu mu? (okunamazsa koyu varsayılır: eski davranış) */
function sistemKoyuMu(nativeTheme) {
  return !nativeTheme || nativeTheme.shouldUseDarkColors !== false;
}

/**
 * Özel panel paleti (hazır tema / özel vurgu / özel arka plan) gerekiyorsa üretilmiş palet, aksi halde null.
 * Yüksek karşıtlık açıkken null: CSS'in sabit yüksek karşıtlık paleti geçerlidir ve özel renkler yok sayılır.
 * @returns {ReturnType<typeof paletUret>|null}
 */
function ozelPalet(ayarlar, { sistemKoyu = true, saydam = false } = {}) {
  const a = ayarlar && typeof ayarlar === 'object' ? ayarlar : {};
  if (a.yuksekKarsitlik === true) return null;
  const secim = { tema: a.panelTemasi, arkaPlan: a.panelArkaPlani, vurgu: a.panelVurguRengi };
  if (!ozelPaletGerekli(secim)) return null;
  return paletUret({ sema: etkinSema(a.temaZorla, sistemKoyu), tema: secim.tema, arkaPlan: secim.arkaPlan, vurgu: secim.vurgu, saydam });
}

/**
 * Hızlı panel, palet ve köşe bildirimi sayfalarına giden görünüm modeli (yuzey:goster, yuzey:durum-al, kose:goster yüküne `gorunum`
 * olarak eklenir). Her şey varsayılansa null döner ve yüke hiç eklenmez (sayfa CSS'in kendi görünümünde kalır / eski özel görünümü temizler).
 * @param {object} ayarlar
 * @param {{ malzeme?: string, sistemKoyu?: boolean }} [baglam] malzeme: etkin pencere malzemesi ('acrylic' | 'mica' | 'yok')
 * @returns {{ sema?: string, degiskenler?: object, karsitlik?: true, hareketiAzalt?: true, animasyon?: { gecis: boolean, hava: string, mevsim: string } }|null}
 */
function gorunumModeli(ayarlar, { malzeme = 'yok', sistemKoyu = true } = {}) {
  const a = ayarlar && typeof ayarlar === 'object' ? ayarlar : {};
  const model = {};
  const palet = ozelPalet(a, { sistemKoyu, saydam: malzeme === 'acrylic' || malzeme === 'mica' });
  if (palet) {
    model.sema = palet.sema;
    model.degiskenler = { ...palet.degiskenler };
  }
  if (a.yuksekKarsitlik === true) model.karsitlik = true;
  const azalt = a.hareketiAzalt === true;
  if (azalt) model.hareketiAzalt = true;
  if (a.animasyonlar === true && !azalt) {
    // Yüksek karşıtlıkta süs efekti çizilmez (metin okunurluğu); yalnız geçişler kalır.
    const efektsiz = a.yuksekKarsitlik === true;
    model.animasyon = {
      gecis: a.animasyonGecisleri !== false,
      hava: efektsiz ? 'yok' : HAVA_EFEKTI_DEGERLERI.includes(a.havaEfekti) ? a.havaEfekti : 'otomatik',
      mevsim: efektsiz ? 'yok' : MEVSIM_EFEKTI_DEGERLERI.includes(a.mevsimEfekti) ? a.mevsimEfekti : 'yok',
    };
  }
  return Object.keys(model).length > 0 ? model : null;
}

module.exports = {
  TEMA_DEGERLERI,
  VARSAYILAN_TEMA,
  VURGU_DESENI,
  METIN_OLCEKLERI,
  VARSAYILAN_METIN_OLCEGI,
  HAZIR_TEMA_ADLARI,
  HAVA_EFEKTI_DEGERLERI,
  MEVSIM_EFEKTI_DEGERLERI,
  temaDuzelt,
  temaKaynagi,
  vurguRengiDuzelt,
  metinOlcegiDuzelt,
  metinOlcegiOrani,
  etkinSema,
  sistemKoyuMu,
  ozelPalet,
  gorunumModeli,
};
