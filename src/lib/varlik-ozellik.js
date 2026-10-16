'use strict';

/**
 * Karo modelinin alan türüne göre GÜVENLİ öznitelik alt kümesi — 1.4.0 ortak güvenli altyapı (saf).
 *
 * Renderer'a HA'daki ham `attributes` nesnesi ASLA gitmez: her model yalnız aşağıdaki beyaz listedeki alanları, tür ve aralık
 * doğrulamasından geçmiş hâliyle üretir. Metin öznitelikleri (medya başlığı/sanatçı, kaynak, ön ayar, seçenek, birim, sensör
 * değeri) Kapı Kuralı süzgecinden geçer (suzgec.js guvenliMetin / metinListesiSuz): geçmeyen metin null olur, listeden düşer.
 * entity_picture, media_image_url, access_token, kamera ve konum bilgisi (latitude/longitude) HİÇBİR modelde yoktur.
 * Canlı HA adı (friendly_name) bu modele girmez (renderer'a giden ad favorideki etikettir; yuzey-modeli.js).
 *
 * Model anahtarları alan-kaydi.js'teki `model` sütunudur:
 *   isik         { renkSicakligi, enAzKelvin, enCokKelvin, rgb, renkModlari }          (yalnız ışıkta; parlaklık zaten karoda `yuzde`)
 *   acKapa       null (aç/kapa karosu için ek öznitelik yok)
 *   tetik        null (sahne, script, düğme)
 *   fan          { yuzde, adimYuzde, salinim, onAyar, onAyarlar }
 *   iklim        { mevcutSicaklik, hedefSicaklik, hedefAlt, hedefUst, enAz, enCok, adim, mod, modlar, hvacEylemi, mevcutNem }
 *   medya        { durum, baslik, sanatci, album, ses, sessiz, kaynak, kaynaklar, sure, konum, konumZamani }
 *   nem          { hedefNem, mevcutNem, enAz, enCok, mod }
 *   supurge      { durum, pil }
 *   secim        { secenek, secenekler }
 *   sayi         { deger, enAz, enCok, adim, birim, kip }
 *   zamanlayici  { durum, sure, kalan, bitis }
 *   yapilacak    { acikSayisi }
 *   sensor       { deger, sayi, birim, sinif, durumSinifi, hassasiyet }
 *   ikiliSensor  { acik, sinif }
 *   hava         { durum, sicaklik, birim, nem, ruzgar, ruzgarBirim, basinc }
 *   takvim       { mesgul }
 *
 * Yeni model alanı eklemek (ajanlar için kalıp): ilgili model işlevine doğrulamalı satır ekle (sayı: sayiAl, metin: metinAl,
 * liste: listeAl, sabit küme: secenekAl), test/varlik-ozellik.test.js'e örnek ekle. Ham öznitelik nesnesi asla kopyalanmaz.
 */

const { alanAl, guvenliMetin, metinListesiSuz } = require('./suzgec');
const { alanModeli } = require('./alan-kaydi');
const { HVAC_MODLARI, RENK_MODLARI } = require('./servis-izinleri');

const HVAC_EYLEMLERI = Object.freeze(['off', 'heating', 'cooling', 'drying', 'idle', 'fan', 'preheating', 'defrosting']);
const MEDYA_DURUMLARI = Object.freeze(['off', 'on', 'idle', 'playing', 'paused', 'standby', 'buffering']);
const SUPURGE_DURUMLARI = Object.freeze(['cleaning', 'docked', 'returning', 'paused', 'idle', 'error']);
const ZAMANLAYICI_DURUMLARI = Object.freeze(['idle', 'active', 'paused']);
const DURUM_SINIFLARI = Object.freeze(['measurement', 'total', 'total_increasing']);
// weather varlığının state değeri (HA koşul listesi).
const HAVA_DURUMLARI = Object.freeze([
  'clear-night',
  'cloudy',
  'exceptional',
  'fog',
  'hail',
  'lightning',
  'lightning-rainy',
  'partlycloudy',
  'pouring',
  'rainy',
  'snowy',
  'snowy-rainy',
  'sunny',
  'windy',
  'windy-variant',
]);
const SURE_DESENI = /^-?\d{1,4}:\d{2}:\d{2}(\.\d{1,6})?$/; // timer duration / remaining: "0:05:00"
const ISO_DESENI = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/;
const SAYI_SINIRI = 1e12;

/** Sonlu ve makul aralıkta sayı; değilse null. Metin sayı ("21.5") da kabul edilir (sensör state'i metindir). */
function sayiAl(deger, { min = -SAYI_SINIRI, max = SAYI_SINIRI } = {}) {
  const n = typeof deger === 'number' ? deger : typeof deger === 'string' && deger.trim() !== '' && deger.length <= 32 ? Number(deger) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
const mantiksalAl = (deger) => (typeof deger === 'boolean' ? deger : null);
/** Süzgeçten geçmiş, kısaltılmış metin; değilse null. */
const metinAl = (deger, enFazla = 100) => guvenliMetin(deger, enFazla);
/** Sabit kümeden değer; değilse null. */
const secenekAl = (deger, kume) => (typeof deger === 'string' && kume.includes(deger) ? deger : null);
/** Sabit kümeyle kesişen liste (tekrarsız, sıra korunur). */
const kumedenListe = (liste, kume) => (Array.isArray(liste) ? [...new Set(liste.filter((d) => typeof d === 'string' && kume.includes(d)))] : []);
const listeAl = (liste, enCok = 50, enUzun = 60) => metinListesiSuz(liste, { enCok, enUzun });
const isoAl = (deger) => (typeof deger === 'string' && deger.length <= 40 && ISO_DESENI.test(deger) && Number.isFinite(Date.parse(deger)) ? deger : null);
const sureAl = (deger) => (typeof deger === 'string' && SURE_DESENI.test(deger) ? deger : null);

const MODELLER = Object.freeze({
  isik(v, n) {
    const modlar = kumedenListe(n.supported_color_modes, ['color_temp', ...RENK_MODLARI, 'brightness', 'onoff', 'white']);
    const rgb = Array.isArray(n.rgb_color) && n.rgb_color.length === 3 && n.rgb_color.every((d) => Number.isInteger(d) && d >= 0 && d <= 255) ? [...n.rgb_color] : null;
    return {
      renkSicakligi: sayiAl(n.color_temp_kelvin, { min: 500, max: 30000 }),
      enAzKelvin: sayiAl(n.min_color_temp_kelvin, { min: 500, max: 30000 }),
      enCokKelvin: sayiAl(n.max_color_temp_kelvin, { min: 500, max: 30000 }),
      rgb,
      renkModlari: modlar,
    };
  },
  acKapa: () => null,
  tetik: () => null,
  fan(v, n) {
    return {
      yuzde: sayiAl(n.percentage, { min: 0, max: 100 }),
      adimYuzde: sayiAl(n.percentage_step, { min: 0, max: 100 }),
      salinim: mantiksalAl(n.oscillating),
      onAyar: metinAl(n.preset_mode, 40),
      onAyarlar: listeAl(n.preset_modes, 20, 40),
    };
  },
  iklim(v, n) {
    return {
      mevcutSicaklik: sayiAl(n.current_temperature, { min: -100, max: 200 }),
      hedefSicaklik: sayiAl(n.temperature, { min: -100, max: 200 }),
      hedefAlt: sayiAl(n.target_temp_low, { min: -100, max: 200 }),
      hedefUst: sayiAl(n.target_temp_high, { min: -100, max: 200 }),
      enAz: sayiAl(n.min_temp, { min: -100, max: 200 }),
      enCok: sayiAl(n.max_temp, { min: -100, max: 200 }),
      adim: sayiAl(n.target_temp_step, { min: 0.01, max: 10 }),
      mod: secenekAl(v.state, HVAC_MODLARI),
      modlar: kumedenListe(n.hvac_modes, HVAC_MODLARI),
      hvacEylemi: secenekAl(n.hvac_action, HVAC_EYLEMLERI),
      mevcutNem: sayiAl(n.current_humidity, { min: 0, max: 100 }),
    };
  },
  medya(v, n) {
    return {
      durum: secenekAl(v.state, MEDYA_DURUMLARI),
      baslik: metinAl(n.media_title, 100),
      sanatci: metinAl(n.media_artist, 100),
      album: metinAl(n.media_album_name, 100),
      ses: sayiAl(n.volume_level, { min: 0, max: 1 }),
      sessiz: mantiksalAl(n.is_volume_muted),
      kaynak: metinAl(n.source, 60),
      kaynaklar: listeAl(n.source_list, 30, 60),
      sure: sayiAl(n.media_duration, { min: 0, max: 1e7 }),
      konum: sayiAl(n.media_position, { min: 0, max: 1e7 }),
      konumZamani: isoAl(n.media_position_updated_at),
    };
  },
  nem(v, n) {
    return {
      hedefNem: sayiAl(n.humidity, { min: 0, max: 100 }),
      mevcutNem: sayiAl(n.current_humidity, { min: 0, max: 100 }),
      enAz: sayiAl(n.min_humidity, { min: 0, max: 100 }),
      enCok: sayiAl(n.max_humidity, { min: 0, max: 100 }),
      mod: metinAl(n.mode, 40),
    };
  },
  supurge(v, n) {
    return { durum: secenekAl(v.state, SUPURGE_DURUMLARI), pil: sayiAl(n.battery_level, { min: 0, max: 100 }) };
  },
  secim(v, n) {
    // Seçenek listesinin TAMAMI süzgeçten geçmiş olmalıdır (suzgec.js seceneklerGuvenliMi); burada yalnız kısaltılır.
    return { secenek: metinAl(v.state, 60), secenekler: listeAl(n.options, 50, 60) };
  },
  sayi(v, n) {
    return {
      deger: sayiAl(v.state),
      enAz: sayiAl(n.min),
      enCok: sayiAl(n.max),
      adim: sayiAl(n.step, { min: 0, max: SAYI_SINIRI }),
      birim: metinAl(n.unit_of_measurement, 12),
      kip: secenekAl(n.mode, ['slider', 'box', 'auto']),
    };
  },
  zamanlayici(v, n) {
    return { durum: secenekAl(v.state, ZAMANLAYICI_DURUMLARI), sure: sureAl(n.duration), kalan: sureAl(n.remaining), bitis: isoAl(n.finishes_at) };
  },
  yapilacak(v) {
    const sayi = sayiAl(v.state, { min: 0, max: 100000 });
    return { acikSayisi: sayi === null ? null : Math.round(sayi) };
  },
  sensor(v, n) {
    const sayi = sayiAl(v.state);
    return {
      deger: metinAl(v.state, 40), // metin değer de olabilir (enum sensör); süzgeçten geçmeyen değer gösterilmez
      sayi,
      birim: metinAl(n.unit_of_measurement, 12),
      sinif: metinAl(n.device_class, 30),
      durumSinifi: secenekAl(n.state_class, DURUM_SINIFLARI),
      hassasiyet: sayiAl(n.suggested_display_precision, { min: 0, max: 10 }),
    };
  },
  ikiliSensor(v, n) {
    return { acik: v.state === 'on' ? true : v.state === 'off' ? false : null, sinif: metinAl(n.device_class, 30) };
  },
  hava(v, n) {
    return {
      durum: secenekAl(v.state, HAVA_DURUMLARI),
      sicaklik: sayiAl(n.temperature, { min: -100, max: 200 }),
      birim: metinAl(n.temperature_unit, 6),
      nem: sayiAl(n.humidity, { min: 0, max: 100 }),
      ruzgar: sayiAl(n.wind_speed, { min: 0, max: 1000 }),
      ruzgarBirim: metinAl(n.wind_speed_unit, 8),
      basinc: sayiAl(n.pressure, { min: 0, max: 5000 }),
    };
  },
  takvim(v) {
    return { mesgul: v.state === 'on' ? true : v.state === 'off' ? false : null };
  },
});

/**
 * Varlığın alan modeline göre güvenli öznitelik alt kümesi. Varlık yoksa, alan kayıtlı değilse ya da model ek öznitelik
 * taşımıyorsa null. Kapı Kuralı'nı ÇAĞIRAN uygular (yuzey-modeli.js karoOlustur guvenliVarlikMi); bu işlev yalnız alt küme çıkarır.
 * @param {{entity_id: string, state?: string, attributes?: object}|null|undefined} varlik
 * @returns {object|null} düz, dondurulmamış nesne (yalnız sayı, mantıksal, kısa metin, metin dizisi ve null)
 */
function guvenliOzellikler(varlik) {
  if (!varlik || typeof varlik !== 'object' || typeof varlik.entity_id !== 'string') return null;
  const model = alanModeli(alanAl(varlik.entity_id));
  if (!model || !Object.hasOwn(MODELLER, model)) return null;
  const n = varlik.attributes && typeof varlik.attributes === 'object' && !Array.isArray(varlik.attributes) ? varlik.attributes : {};
  return MODELLER[model](varlik, n);
}

module.exports = {
  HVAC_EYLEMLERI,
  MEDYA_DURUMLARI,
  SUPURGE_DURUMLARI,
  ZAMANLAYICI_DURUMLARI,
  HAVA_DURUMLARI,
  sayiAl,
  isoAl,
  guvenliOzellikler,
};
