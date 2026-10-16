'use strict';

/**
 * Electron `screen` nesnesinden sade, savunmalı ekran okuması (saf; `screen` dışarıdan verilir). Yerleşim kararları
 * src/lib/pencere-yerlesim.js'tedir; burası yalnız ham Display listesini özetlere çevirir ve eksik/bozuk bir `screen`
 * (eski sahte ortam, ekran yok) karşısında asla fırlatmaz: boş liste ya da 1 ölçek döner.
 */

const { ekranlariOzetle } = require('./pencere-yerlesim');

/** Bağlı ekranların özetleri (ekranlariOzetle: birincil önce, soldan sağa). Okunamazsa []. */
function ekranOzetleriAl(screen) {
  try {
    if (!screen || typeof screen.getAllDisplays !== 'function') return [];
    const birincil = typeof screen.getPrimaryDisplay === 'function' ? screen.getPrimaryDisplay() : null;
    return ekranlariOzetle(screen.getAllDisplays(), Number.isInteger(birincil?.id) ? birincil.id : null);
  } catch {
    return [];
  }
}

/** Birincil ekranın ölçek çarpanı (tepsi simgesi boyutu için); okunamazsa 1. */
function birincilOlcekAl(screen) {
  try {
    const olcek = screen?.getPrimaryDisplay?.()?.scaleFactor;
    return Number.isFinite(olcek) && olcek > 0 ? olcek : 1;
  } catch {
    return 1;
  }
}

module.exports = { ekranOzetleriAl, birincilOlcekAl };
