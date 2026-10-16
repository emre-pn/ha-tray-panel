'use strict';

/**
 * Yazım denetimi ve sözlük indirmesi kapatma (o-42): src/lib/yazim-denetimi.js ve main.js bağlantısı. Gerçek Electron oturumu yok;
 * indirmenin Windows'ta gerçekten durduğu burada SINANMAZ (elle doğrulanmalı).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { yazimDenetiminiKapat } = require('../src/lib/yazim-denetimi');

const sahteOturum = () => {
  const olaylar = [];
  return { olaylar, setSpellCheckerEnabled: (d) => olaylar.push(['acik', d]), setSpellCheckerLanguages: (l) => olaylar.push(['diller', l]) };
};

test('yazimDenetiminiKapat: denetim kapatılır ve dil listesi boşaltılır (bu sırayla); sonuç iki adımı bildirir', () => {
  const o = sahteOturum();
  assert.deepEqual(yazimDenetiminiKapat(o), { kapandi: true, dilBos: true });
  assert.deepEqual(o.olaylar, [['acik', false], ['diller', []]]);
});

test('yazimDenetiminiKapat: işlev sunmayan, bozuk ya da fırlatan oturum çökertmez; hangi adımın yapıldığı söylenir', () => {
  assert.deepEqual(yazimDenetiminiKapat(null), { kapandi: false, dilBos: false });
  assert.deepEqual(yazimDenetiminiKapat('x'), { kapandi: false, dilBos: false });
  assert.deepEqual(yazimDenetiminiKapat({}), { kapandi: false, dilBos: false });
  const gunluk = [];
  const sonuc = yazimDenetiminiKapat(
    { setSpellCheckerEnabled: () => { throw new Error('desteklenmiyor'); }, setSpellCheckerLanguages: () => {} },
    (m) => gunluk.push(m),
  );
  assert.deepEqual(sonuc, { kapandi: false, dilBos: true });
  assert.deepEqual(gunluk, ['Yazım denetimi kapatılamadı.']);
  assert.deepEqual(yazimDenetiminiKapat({ setSpellCheckerLanguages: () => { throw new Error('x'); } }, () => {}), { kapandi: false, dilBos: false });
});

test('main.js: yazım denetimi HA oturumunda ve varsayılan oturumda, izin işleyicilerinden ve pencerelerden ÖNCE kapatılır; başka yerde sözlük ayarı yok', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const ha = main.indexOf('yazimDenetiminiKapat(session.fromPartition(HA_BOLUMU)');
  const varsayilan = main.indexOf('yazimDenetiminiKapat(session.defaultSession');
  const izin = main.indexOf('izinleriAyarla(session.fromPartition(HA_BOLUMU))');
  const pencere = main.indexOf('anaPencereOlustur();', izin);
  assert.ok(ha > 0 && varsayilan > 0, 'iki oturum da kapatılıyor');
  assert.ok(ha < izin && varsayilan < izin, 'izin işleyicilerinden önce');
  assert.ok(izin < pencere && varsayilan < pencere, 'ilk pencereden önce');
  assert.doesNotMatch(main, /setSpellCheckerEnabled\(true\)|setSpellCheckerLanguages\(\[\s*['"]/, 'yazım denetimi hiçbir yerde açılmaz');
  assert.doesNotMatch(main, /setSpellCheckerDictionaryDownloadURL/, 'sözlük adresi ayarlanmaz (indirme kapalı olmalı, başka adrese yönlendirilmez)');
});

test('yerel pencerelerin web tercihlerinde spellcheck zaten kapalıdır (HA penceresi de aynı tercihleri paylaşır)', () => {
  const yerel = fs.readFileSync(path.join(__dirname, '..', 'src', 'yerel-pencere.js'), 'utf8');
  assert.match(yerel, /spellcheck: false/);
});
