'use strict';

/**
 * Ana süreç modülleri için Node tarafı yardımcı: ana sözlük (ceviri/ana.js) ve Türkçe varsayılan çevirmen.
 * src/lib/ altındaki saf modüller `t` verilmezse bugünkü Türkçe metinleri bu çevirmenle üretir (mevcut testler ve çağrılar değişmeden çalışır).
 * Renderer'da kullanılmaz (require kullanır).
 */

const { cevirmen } = require('./dil');
const ANA = require('./ceviri/ana');

/** @param {string} dil 'tr' | 'en' */
const anaCevirmen = (dil) => cevirmen(dil, ANA);
const TR = anaCevirmen('tr');

module.exports = { ANA, anaCevirmen, TR };
