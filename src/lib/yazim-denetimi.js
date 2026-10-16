'use strict';

/**
 * Yazım denetimini ve sözlük indirmesini kapatır (o-42; saf — oturum nesnesi dışarıdan verilir).
 *
 * Electron, Windows'ta yazım denetimi sözlüklerini ilk kullanımda Chromium'un (Google) sözlük sunucusundan indirir. Ev Paneli'nin buna
 * ihtiyacı yoktur ve kullanıcı izni olmadan bir dış adrese gidilmesini istemeyiz (gizlilik). Yerel pencerelerde zaten webPreferences
 * `spellcheck: false` vardır (src/yerel-pencere.js); bu işlev oturum düzeyinde, HA penceresinin oturumunda (persist:ha) ve varsayılan
 * oturumda yazım denetimini kapatır ve dil listesini boşaltır, böylece hiçbir sözlük istenmez.
 *
 * İlk oturum kullanımından ÖNCE çağrılmalıdır (src/main.js: app ready, pencereler ve izin işleyicileri kurulmadan önce).
 * Gerçek Windows'ta indirmenin durduğu elle doğrulanmadı (README/eksikler).
 */

/**
 * @param {object} oturum Electron Session (setSpellCheckerEnabled, setSpellCheckerLanguages)
 * @param {(m: string) => void} [gunluk]
 * @returns {{ kapandi: boolean, dilBos: boolean }} her adımın uygulanıp uygulanmadığı (oturum bu işlevleri sunmuyorsa false)
 */
function yazimDenetiminiKapat(oturum, gunluk = () => {}) {
  const sonuc = { kapandi: false, dilBos: false };
  if (!oturum || typeof oturum !== 'object') return sonuc;
  try {
    if (typeof oturum.setSpellCheckerEnabled === 'function') {
      oturum.setSpellCheckerEnabled(false);
      sonuc.kapandi = true;
    }
  } catch {
    gunluk('Yazım denetimi kapatılamadı.');
  }
  try {
    if (typeof oturum.setSpellCheckerLanguages === 'function') {
      oturum.setSpellCheckerLanguages([]);
      sonuc.dilBos = true;
    }
  } catch {
    gunluk('Yazım denetimi dil listesi boşaltılamadı.');
  }
  return sonuc;
}

module.exports = { yazimDenetiminiKapat };
