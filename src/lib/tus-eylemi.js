'use strict';

/**
 * Ana penceredeki klavye girdisini eyleme çevirir (saf; before-input-event girdisini okur).
 *
 * Harf tuşlarında `code` (fiziksel tuş), sembol tuşlarında `key` (üretilen karakter) kullanılır:
 * "+" ve "-" Türkçe Q ile ABD düzeninde farklı fiziksel tuşlardadır, `code` güvenilmez.
 * Windows'ta AltGr = Control+Alt olarak gelir; Control+Alt birleşimleri bilerek yok sayılır ki
 * AltGr ile yazılan karakterler (ör. @ { } [ ]) bozulmasın.
 */

const YAKINLASTIRMA_EN_AZ = -3;
const YAKINLASTIRMA_EN_COK = 5;
const YAKINLASTIRMA_ADIM = 0.5;

const TEKRAR_EDEN_EYLEMLER = new Set(['yakin-art', 'yakin-eksi']);

/**
 * @param {{type:string,key?:string,code?:string,control?:boolean,alt?:boolean,shift?:boolean,meta?:boolean,isAutoRepeat?:boolean}} girdi
 * @returns {'yenile'|'yenile-onbellek'|'tamekran'|'gizle'|'yakin-art'|'yakin-eksi'|'yakin-sifir'|'geri'|'ileri'|'boyut-degistir'|null}
 */
function tusEylemi(girdi) {
  if (!girdi || girdi.type !== 'keyDown' || girdi.meta) return null;
  const { key, code, control, alt, shift } = girdi;
  if (control && alt) return null; // AltGr

  let eylem = null;
  if (code === 'F11' && !control && !alt) {
    eylem = 'tamekran';
  } else if (code === 'F5' && !alt) {
    eylem = control || shift ? 'yenile-onbellek' : 'yenile';
  } else if (control && !alt) {
    if (code === 'KeyR') eylem = shift ? 'yenile-onbellek' : 'yenile'; // Ctrl+Shift+R önce
    else if (code === 'KeyW' && !shift) eylem = 'gizle';
    else if (code === 'KeyG' && shift) eylem = 'boyut-degistir';
    else if (key === '+' || key === '=') eylem = 'yakin-art';
    else if (key === '-' || key === '_') eylem = 'yakin-eksi';
    else if (key === '0' && !shift) eylem = 'yakin-sifir';
  } else if (alt && !control && !shift) {
    if (key === 'ArrowLeft' || code === 'ArrowLeft') eylem = 'geri';
    else if (key === 'ArrowRight' || code === 'ArrowRight') eylem = 'ileri';
  }

  if (eylem && girdi.isAutoRepeat && !TEKRAR_EDEN_EYLEMLER.has(eylem)) return null;
  return eylem;
}

/** Yakınlaştırma düzeyini -3..5 aralığına ve 0,5 adıma getirir; geçersizse 0. */
function yakinlastirmaDuzelt(deger) {
  const n = Number(deger);
  if (deger === null || deger === '' || !Number.isFinite(n)) return 0;
  const adimli = Math.round(n / YAKINLASTIRMA_ADIM) * YAKINLASTIRMA_ADIM;
  const sinirli = Math.min(YAKINLASTIRMA_EN_COK, Math.max(YAKINLASTIRMA_EN_AZ, adimli));
  return sinirli === 0 ? 0 : sinirli; // -0 olmasın
}

/** @param {1|-1|0} yon 0 = sıfırla */
function yakinlastirmaDegistir(seviye, yon) {
  if (yon === 0) return 0;
  return yakinlastirmaDuzelt(yakinlastirmaDuzelt(seviye) + yon * YAKINLASTIRMA_ADIM);
}

module.exports = {
  YAKINLASTIRMA_EN_AZ,
  YAKINLASTIRMA_EN_COK,
  YAKINLASTIRMA_ADIM,
  tusEylemi,
  yakinlastirmaDuzelt,
  yakinlastirmaDegistir,
};
