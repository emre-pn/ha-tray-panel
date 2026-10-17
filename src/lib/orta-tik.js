'use strict';

/**
 * Tepsi simgesine orta tık (o-20; saf): kullanıcının seçtiği TEK zararsız favori çalışır. Ayar `tepsiOrtaTik` bir varlık kimliğidir
 * ('' = kapalı, varsayılan). Orta tık yeni bir yetki doğurmaz: eylem, kısayolla AYNI yoldan ('kisayol' kaynağı) tek güvenli hattan
 * geçer; yıkıcı (onaylı) sınıf kısayol kaynağında zaten reddedilir. Bu dosya ek bir ön denetim yapar ki ayarda kalmış eski bir
 * seçim (sonradan onay istenen, yıkıcı sayılan ya da Kapı Kuralı'na takılan favori) sessizce reddedilsin ve nedeni söylensin.
 *
 * Kurallar:
 *  - Kimlik Kapı Kuralı'ndan geçer (kapı, kilit, alarm, garaj, bariyer, interkom, zil, siren, panjur kimliği seçilemez).
 *  - Alan: alan kaydında tek tıklama servisi olan, eylem türünde bir alan. valve, automation, camera gibi yıkıcı ya da görüntü
 *    alanları HİÇBİR koşulda girmez (alan kaydında olmasalar bile bu liste ileride eklenecek alanlara karşı da korur).
 *  - Favori olmalı ve onay istememeli (favori.onay !== true); eylem sınıfı ZARARSIZ olmalı (HA'daki güncel adla).
 */

const { KAYITLI_ALANLAR, eylemAlaniMi, varsayilanServis } = require('./alan-kaydi');
const { alanAl, guvenliVarlikMi } = require('./suzgec');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');

/** Orta tık (ve diğer dış tetikler) için ASLA uygun olmayan alanlar: yıkıcı eylemler, görüntü ve Kapı Kuralı alanları. */
const ORTA_TIK_YASAKLI_ALANLAR = Object.freeze(['valve', 'automation', 'camera', 'lock', 'alarm_control_panel', 'siren', 'water_heater', 'update']);

/** Alan kaydındaki tek tıklama eylemi olan alanlar (yasaklı olanlar hariç), kayıt sırasıyla. */
const ORTA_TIK_ALANLARI = Object.freeze(KAYITLI_ALANLAR.filter((a) => eylemAlaniMi(a) && varsayilanServis(a) !== null && !ORTA_TIK_YASAKLI_ALANLAR.includes(a)));

const ortaTikAlaniMi = (alan) => ORTA_TIK_ALANLARI.includes(alan);

/**
 * Ön denetim. durum: HA'daki güncel durum (depo); yoksa kayıtlı adla sınıflanır.
 * @param {{kimlik: unknown, favori?: object|null, durum?: object|null}} g
 * @returns {{uygun: boolean, neden?: 'secilmedi'|'gecersiz'|'favori-degil'|'alan'|'yasak'|'onayli'}}
 */
function ortaTikUygunMu(girdi) {
  const { kimlik, favori, durum } = girdi && typeof girdi === 'object' ? girdi : {};
  if (kimlik === '' || kimlik === undefined || kimlik === null) return { uygun: false, neden: 'secilmedi' };
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return { uygun: false, neden: 'gecersiz' };
  if (!favori || typeof favori !== 'object' || favori.entity_id !== kimlik) return { uygun: false, neden: 'favori-degil' };
  if (!ortaTikAlaniMi(alanAl(kimlik))) return { uygun: false, neden: 'alan' };
  const varlik = durum && typeof durum === 'object' ? durum : { entity_id: kimlik, attributes: { friendly_name: typeof favori.ad === 'string' ? favori.ad : kimlik } };
  if (!guvenliVarlikMi(varlik)) return { uygun: false, neden: 'yasak' };
  if (favori.onay === true) return { uygun: false, neden: 'onayli' };
  if (eylemSinifi(varlik, favori).sinif !== SINIF.ZARARSIZ) return { uygun: false, neden: 'onayli' };
  return { uygun: true };
}

module.exports = { ORTA_TIK_YASAKLI_ALANLAR, ORTA_TIK_ALANLARI, ortaTikAlaniMi, ortaTikUygunMu };
