'use strict';

/**
 * Servis izin listesi ve parametre doğrulama — 1.4.0 ortak güvenli altyapı (saf; ağ ve Electron yok).
 *
 * Eylem hattı (src/lib/eylem-hatti.js) "servis eylemi" yolunda HA'ya gidecek gövdeyi YALNIZ buradan kurar: alan başına sabit
 * servis listesi, her servisin parametre şeması ve sınırları. Listede olmayan servis, bilinmeyen parametre, sınır dışı değer,
 * adıma uymayan sayı, cihazın kendi listesinde olmayan seçenek REDDEDİLİR (sessizce düzeltilmez; yalnız `kirp: true` olan
 * renk sıcaklığı cihazın kendi aralığına kırpılır). Kilit/kapı/kepenk/alarm servisleri bu tabloya HİÇBİR zaman girmez
 * (test/servis-izinleri.test.js).
 *
 * Şema (SERVIS_IZINLERI[alan][servis]):
 *   parametreler  { ad: parametreSemasi }  (yoksa parametresiz servis; gelen her parametre reddedilir)
 *   sinif         'zararsiz' (varsayılan) | 'onayli' (varsayılan onay ister; favoride onay:false kapatır) |
 *                 'yikici' (onay her zaman, kapatılamaz) — eylem-sinifi.js eylemSinifi(varlik, favori, servis) bunu uygular
 *   birlikteOlmaz [['a', 'b']]  aynı çağrıda ikisi birden verilemez
 *
 * parametreSemasi:
 *   { tur: 'sayi', gerekli?, tamsayi?, min?, max?, minOznitelik?, maxOznitelik?, adim?, adimOznitelik?, kirp?, renkModu? }
 *       min/max mutlak sınırdır; *Oznitelik verilmişse cihazın kendi değeri (HA özniteliği) sınırı DARALTIR (genişletemez).
 *       adim: değer (alt sınırdan ya da sıfırdan) adımın katı olmalı; kayan nokta artığı adıma yuvarlanır.
 *       kirp: değer mutlak sınır içinde ama cihaz aralığı dışındaysa cihaz aralığına kırpılır (yalnız renk sıcaklığı).
 *   { tur: 'mantiksal', gerekli? }
 *   { tur: 'secenek', gerekli?, listeOznitelik?, sabitListe?, suz? }
 *       değer, cihazın listesinde (listeOznitelik, ör. hvac_modes / source_list / options) VE varsa sabitListe'de olmalı.
 *       suz: liste öğeleri kapı süzgecinden geçer (geçmeyen seçenek seçilemez).
 *   { tur: 'metin', gerekli?, enUzun } kapı süzgecinden geçmeli, boş olamaz, enUzun kod noktası
 *   { tur: 'rgb', gerekli?, renkModu? } [r, g, b], her biri 0..255 tamsayı
 *   renkModu: (sayi/rgb) öznitelik supported_color_modes bu modlardan birini içermeli (ışık rengi desteklemiyorsa ret)
 *
 * Yeni servis eklemek (ajanlar için kalıp): ilgili alana satır ekle, yıkıcıysa sinif:'yikici', belirsizse 'onayli';
 * test/servis-izinleri.test.js'e geçerli/geçersiz örnek ekle. Alan alan-kaydi.js'te 'eylem' türünde olmalı.
 */

const { metinGuvenliMi, metinListesiSuz } = require('./suzgec');
const { kisalt } = require('./metin');

const HVAC_MODLARI = Object.freeze(['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only']);
const RENK_MODLARI = Object.freeze(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);
const TODO_DURUMLARI = Object.freeze(['needs_action', 'completed']);
const SINIFLAR = Object.freeze(['zararsiz', 'onayli', 'yikici']);
const EN_COK_PARAMETRE = 8;
const SAYI_TAVANI = 1e9;

const parametresiz = Object.freeze({});
const acKapa = Object.freeze({ toggle: parametresiz, turn_on: parametresiz, turn_off: parametresiz });

const SERVIS_IZINLERI = Object.freeze({
  light: Object.freeze({
    toggle: parametresiz,
    turn_off: parametresiz,
    turn_on: Object.freeze({
      parametreler: Object.freeze({
        color_temp_kelvin: Object.freeze({
          tur: 'sayi',
          tamsayi: true,
          min: 1000,
          max: 20000,
          minOznitelik: 'min_color_temp_kelvin',
          maxOznitelik: 'max_color_temp_kelvin',
          kirp: true,
          renkModu: Object.freeze(['color_temp']),
        }),
        rgb_color: Object.freeze({ tur: 'rgb', renkModu: RENK_MODLARI }),
      }),
      birlikteOlmaz: Object.freeze([Object.freeze(['color_temp_kelvin', 'rgb_color'])]),
    }),
  }),
  switch: acKapa,
  input_boolean: acKapa,
  fan: Object.freeze({
    ...acKapa,
    set_percentage: Object.freeze({ parametreler: Object.freeze({ percentage: Object.freeze({ tur: 'sayi', gerekli: true, tamsayi: true, min: 0, max: 100 }) }) }),
    oscillate: Object.freeze({ parametreler: Object.freeze({ oscillating: Object.freeze({ tur: 'mantiksal', gerekli: true }) }) }),
    set_preset_mode: Object.freeze({ parametreler: Object.freeze({ preset_mode: Object.freeze({ tur: 'secenek', gerekli: true, listeOznitelik: 'preset_modes', suz: true }) }) }),
  }),
  scene: Object.freeze({ turn_on: parametresiz }),
  script: Object.freeze({ turn_on: parametresiz }),
  button: Object.freeze({ press: parametresiz }),
  input_button: Object.freeze({ press: parametresiz }),
  climate: Object.freeze({
    turn_on: parametresiz,
    turn_off: parametresiz,
    set_temperature: Object.freeze({
      parametreler: Object.freeze({
        temperature: Object.freeze({ tur: 'sayi', gerekli: true, min: -50, max: 100, minOznitelik: 'min_temp', maxOznitelik: 'max_temp', adim: 0.1, adimOznitelik: 'target_temp_step' }),
      }),
    }),
    // Mod değişimi (ısıt <-> soğut <-> kapalı) yeni favoride varsayılan olarak onay ister.
    set_hvac_mode: Object.freeze({
      sinif: 'onayli',
      parametreler: Object.freeze({ hvac_mode: Object.freeze({ tur: 'secenek', gerekli: true, listeOznitelik: 'hvac_modes', sabitListe: HVAC_MODLARI }) }),
    }),
  }),
  media_player: Object.freeze({
    turn_on: parametresiz,
    // Kapatma varsayılan olarak onay ister (o-03): yanlış tıklamayla TV/hoparlör kapanmasın; favoride onay:false kapatır.
    turn_off: Object.freeze({ sinif: 'onayli' }),
    media_play_pause: parametresiz,
    media_next_track: parametresiz,
    media_previous_track: parametresiz,
    volume_set: Object.freeze({ parametreler: Object.freeze({ volume_level: Object.freeze({ tur: 'sayi', gerekli: true, min: 0, max: 1 }) }) }),
    volume_mute: Object.freeze({ parametreler: Object.freeze({ is_volume_muted: Object.freeze({ tur: 'mantiksal', gerekli: true }) }) }),
    select_source: Object.freeze({ parametreler: Object.freeze({ source: Object.freeze({ tur: 'secenek', gerekli: true, listeOznitelik: 'source_list', suz: true }) }) }),
  }),
  humidifier: Object.freeze({
    ...acKapa,
    set_humidity: Object.freeze({
      parametreler: Object.freeze({ humidity: Object.freeze({ tur: 'sayi', gerekli: true, tamsayi: true, min: 0, max: 100, minOznitelik: 'min_humidity', maxOznitelik: 'max_humidity' }) }),
    }),
  }),
  vacuum: Object.freeze({ start: parametresiz, pause: parametresiz, return_to_base: parametresiz, locate: parametresiz }),
  input_select: Object.freeze({
    select_option: Object.freeze({ parametreler: Object.freeze({ option: Object.freeze({ tur: 'secenek', gerekli: true, listeOznitelik: 'options', suz: true }) }) }),
  }),
  select: Object.freeze({
    select_option: Object.freeze({ parametreler: Object.freeze({ option: Object.freeze({ tur: 'secenek', gerekli: true, listeOznitelik: 'options', suz: true }) }) }),
  }),
  input_number: Object.freeze({
    set_value: Object.freeze({
      parametreler: Object.freeze({ value: Object.freeze({ tur: 'sayi', gerekli: true, min: -SAYI_TAVANI, max: SAYI_TAVANI, minOznitelik: 'min', maxOznitelik: 'max', adimOznitelik: 'step', oznitelikZorunlu: true }) }),
    }),
  }),
  number: Object.freeze({
    set_value: Object.freeze({
      parametreler: Object.freeze({ value: Object.freeze({ tur: 'sayi', gerekli: true, min: -SAYI_TAVANI, max: SAYI_TAVANI, minOznitelik: 'min', maxOznitelik: 'max', adimOznitelik: 'step', oznitelikZorunlu: true }) }),
    }),
  }),
  timer: Object.freeze({ start: parametresiz, pause: parametresiz, cancel: parametresiz }),
  todo: Object.freeze({
    add_item: Object.freeze({ parametreler: Object.freeze({ item: Object.freeze({ tur: 'metin', gerekli: true, enUzun: 200 }) }) }),
    update_item: Object.freeze({
      parametreler: Object.freeze({
        item: Object.freeze({ tur: 'metin', gerekli: true, enUzun: 200 }),
        status: Object.freeze({ tur: 'secenek', gerekli: true, sabitListe: TODO_DURUMLARI }),
      }),
    }),
    remove_item: Object.freeze({ sinif: 'yikici', parametreler: Object.freeze({ item: Object.freeze({ tur: 'metin', gerekli: true, enUzun: 200 }) }) }),
  }),
});

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d) && [Object.prototype, null].includes(Object.getPrototypeOf(d));
const sonluSayi = (d) => (typeof d === 'number' && Number.isFinite(d) ? d : null);

/** Alanın izinli servis adları (yoksa boş). */
function izinliServisler(alan) {
  return typeof alan === 'string' && Object.hasOwn(SERVIS_IZINLERI, alan) ? Object.keys(SERVIS_IZINLERI[alan]) : [];
}

/** @returns {object|null} servis şeması */
function servisSemasi(alan, servis) {
  if (typeof alan !== 'string' || typeof servis !== 'string') return null;
  if (!Object.hasOwn(SERVIS_IZINLERI, alan) || !Object.hasOwn(SERVIS_IZINLERI[alan], servis)) return null;
  return SERVIS_IZINLERI[alan][servis];
}

/** Servisin onay sınıfı: 'zararsiz' | 'onayli' | 'yikici'; izinli değilse null. */
function servisSinifi(alan, servis) {
  const sema = servisSemasi(alan, servis);
  if (!sema) return null;
  return SINIFLAR.includes(sema.sinif) ? sema.sinif : 'zararsiz';
}

function renkModuVarMi(sema, nitelikler) {
  if (!sema.renkModu) return true;
  const modlar = Array.isArray(nitelikler.supported_color_modes) ? nitelikler.supported_color_modes : [];
  return sema.renkModu.some((m) => modlar.includes(m));
}

/** Sayı doğrulama; geçerse (kırpılmış/yuvarlanmış) değer, geçmezse hata nedeni. */
function sayiDogrula(deger, sema, nitelikler) {
  if (typeof deger !== 'number' || !Number.isFinite(deger)) return { hata: 'parametre' };
  if (sema.tamsayi && !Number.isInteger(deger)) return { hata: 'parametre' };
  if (!renkModuVarMi(sema, nitelikler)) return { hata: 'desteklenmiyor' };
  const mutlakAlt = sema.min ?? -SAYI_TAVANI;
  const mutlakUst = sema.max ?? SAYI_TAVANI;
  const oAlt = sema.minOznitelik ? sonluSayi(nitelikler[sema.minOznitelik]) : null;
  const oUst = sema.maxOznitelik ? sonluSayi(nitelikler[sema.maxOznitelik]) : null;
  if (sema.oznitelikZorunlu && (oAlt === null || oUst === null)) return { hata: 'desteklenmiyor' }; // sınırı bilinmeyen sayı ayarlanmaz
  const alt = oAlt === null ? mutlakAlt : Math.max(mutlakAlt, oAlt); // cihaz sınırı yalnız DARALTIR
  const ust = oUst === null ? mutlakUst : Math.min(mutlakUst, oUst);
  if (alt > ust) return { hata: 'sinir' };
  let sonuc = deger;
  if (sema.kirp) {
    if (deger < mutlakAlt || deger > mutlakUst) return { hata: 'sinir' };
    sonuc = Math.min(ust, Math.max(alt, deger));
  } else if (deger < alt - 1e-9 || deger > ust + 1e-9) {
    return { hata: 'sinir' };
  }
  const oAdim = sema.adimOznitelik ? sonluSayi(nitelikler[sema.adimOznitelik]) : null;
  const adim = oAdim !== null && oAdim > 0 ? oAdim : sema.adim;
  if (typeof adim === 'number' && adim > 0 && !sema.kirp) {
    // Adıma uyum: sıfırdan ya da alt sınırdan sayılan katlardan birine (kayan nokta payıyla) denk gelmeli.
    const tabanlar = oAlt === null ? [0] : [0, oAlt];
    const taban = tabanlar.find((t) => {
      const k = (sonuc - t) / adim;
      return Math.abs(k - Math.round(k)) < 1e-6;
    });
    if (taban === undefined) return { hata: 'adim' };
    sonuc = Number((taban + Math.round((sonuc - taban) / adim) * adim).toFixed(10));
    if (sonuc < alt - 1e-9 || sonuc > ust + 1e-9) return { hata: 'sinir' };
  }
  if (sema.tamsayi) sonuc = Math.round(sonuc);
  return { deger: sonuc };
}

function secenekDogrula(deger, sema, nitelikler) {
  if (typeof deger !== 'string' || deger === '' || deger.length > 255) return { hata: 'parametre' };
  if (sema.sabitListe && !sema.sabitListe.includes(deger)) return { hata: 'parametre' };
  if (sema.listeOznitelik) {
    const ham = nitelikler[sema.listeOznitelik];
    if (!Array.isArray(ham)) return { hata: 'desteklenmiyor' };
    // suz: listedeki öğe süzgeçten geçmeli (ör. "Kapı kamerası" kaynağı seçilemez); karşılaştırma tam metinle yapılır.
    const liste = sema.suz ? ham.filter((s) => typeof s === 'string' && metinGuvenliMi(s)) : ham;
    if (!liste.includes(deger)) return { hata: 'parametre' };
  }
  return { deger };
}

function metinDogrula(deger, sema) {
  const enUzun = sema.enUzun ?? 200;
  if (typeof deger !== 'string' || deger.length > enUzun * 4) return { hata: 'parametre' }; // dev metin işlenmeden reddedilir
  const temiz = kisalt(deger, Number.MAX_SAFE_INTEGER);
  if (temiz === '' || Array.from(temiz).length > enUzun) return { hata: 'parametre' };
  if (!metinGuvenliMi(temiz)) return { hata: 'guvenlik' };
  return { deger: temiz };
}

function rgbDogrula(deger, sema, nitelikler) {
  if (!Array.isArray(deger) || deger.length !== 3) return { hata: 'parametre' };
  if (!deger.every((d) => Number.isInteger(d) && d >= 0 && d <= 255)) return { hata: 'parametre' };
  if (!renkModuVarMi(sema, nitelikler)) return { hata: 'desteklenmiyor' };
  return { deger: [...deger] };
}

function parametreDogrula(deger, sema, nitelikler) {
  switch (sema.tur) {
    case 'sayi':
      return sayiDogrula(deger, sema, nitelikler);
    case 'mantiksal':
      return typeof deger === 'boolean' ? { deger } : { hata: 'parametre' };
    case 'secenek':
      return secenekDogrula(deger, sema, nitelikler);
    case 'metin':
      return metinDogrula(deger, sema);
    case 'rgb':
      return rgbDogrula(deger, sema, nitelikler);
    default:
      return { hata: 'parametre' };
  }
}

/**
 * Servis isteğini izin listesi ve parametre şemasıyla doğrular, HA'ya gidecek gövdeyi kurar.
 * Varlığın Kapı Kuralı'ndan geçtiği ÇAĞIRANIN (eylem hattının) sorumluluğundadır; burada yalnız servis/parametre denetlenir.
 * @param {string} alan
 * @param {string} servis
 * @param {unknown} veri parametreler (düz nesne; yoksa {})
 * @param {{entity_id: string, attributes?: object}} varlik HA'daki GÜNCEL durum (sınırlar ve listeler buradan okunur)
 * @returns {{ok: true, govde: object, sinif: 'zararsiz'|'onayli'|'yikici'} | {ok: false, neden: 'servis'|'parametre'|'eksik'|'sinir'|'adim'|'desteklenmiyor'|'guvenlik', parametre?: string}}
 */
function servisDogrula(alan, servis, veri, varlik) {
  const sema = servisSemasi(alan, servis);
  if (!sema) return { ok: false, neden: 'servis' };
  if (!varlik || typeof varlik.entity_id !== 'string') return { ok: false, neden: 'parametre' };
  const girdi = veri === undefined ? {} : veri;
  if (!duzNesneMi(girdi)) return { ok: false, neden: 'parametre' };
  const anahtarlar = Object.keys(girdi);
  if (anahtarlar.length > EN_COK_PARAMETRE) return { ok: false, neden: 'parametre' };
  const parametreler = sema.parametreler ?? {};
  const nitelikler = varlik.attributes && typeof varlik.attributes === 'object' && !Array.isArray(varlik.attributes) ? varlik.attributes : {};
  for (const ad of anahtarlar) if (!Object.hasOwn(parametreler, ad)) return { ok: false, neden: 'parametre', parametre: kisalt(ad, 40) };
  for (const [a, b] of sema.birlikteOlmaz ?? []) if (Object.hasOwn(girdi, a) && Object.hasOwn(girdi, b)) return { ok: false, neden: 'parametre', parametre: b };
  const govde = { entity_id: varlik.entity_id };
  for (const [ad, pSema] of Object.entries(parametreler)) {
    if (!Object.hasOwn(girdi, ad) || girdi[ad] === undefined) {
      if (pSema.gerekli) return { ok: false, neden: 'eksik', parametre: ad };
      continue;
    }
    const sonuc = parametreDogrula(girdi[ad], pSema, nitelikler);
    if (sonuc.hata) return { ok: false, neden: sonuc.hata, parametre: ad };
    govde[ad] = sonuc.deger;
  }
  return { ok: true, govde, sinif: servisSinifi(alan, servis) };
}

/**
 * Renderer'a güvenle verilebilecek seçenek listesi (karo modelinde açılır liste için): cihazın listesi süzgeçten geçer.
 * @returns {string[]}
 */
function secilebilirListe(alan, servis, parametre, varlik) {
  const sema = servisSemasi(alan, servis)?.parametreler?.[parametre];
  if (!sema || sema.tur !== 'secenek') return [];
  const ham = sema.listeOznitelik ? varlik?.attributes?.[sema.listeOznitelik] : sema.sabitListe;
  const liste = metinListesiSuz(ham, { enCok: 100, enUzun: 255 });
  return sema.sabitListe ? liste.filter((s) => sema.sabitListe.includes(s)) : liste;
}

module.exports = {
  SERVIS_IZINLERI,
  HVAC_MODLARI,
  RENK_MODLARI,
  TODO_DURUMLARI,
  izinliServisler,
  servisSemasi,
  servisSinifi,
  servisDogrula,
  secilebilirListe,
};
