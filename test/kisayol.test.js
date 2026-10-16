'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VARSAYILAN_KISAYOL,
  kisayolGecerliMi,
  kisayolDogrula,
  kisayolNormallestir,
  kisayolUyarilari,
  kisayolGoster,
  tusOlayindanKisayol,
} = require('../src/lib/kisayol');

test('geçerli kısayollar', () => {
  for (const k of ['Control+Alt+H', 'Control+Shift+H', 'Alt+Shift+Delete', 'Control+Alt+Space', 'Super+H', 'Control+F9', 'Alt+F1']) {
    assert.ok(kisayolGecerliMi(k), k);
  }
  assert.ok(kisayolGecerliMi(VARSAYILAN_KISAYOL));
});

test('geçersiz kısayollar: tek F tuşu, yalnız Shift, kara liste, biçim hataları', () => {
  for (const k of ['F9', 'Shift+A', 'Shift+F9', 'Alt+F4', 'Control+Control+H', 'Ctrl+Control+H', '', '   ', 'Control+', '+H', 'H', 'Control+Alt+Ö', 'Control+Alt+H+J', 'Control+Alt+Tab', 'Alt+Hyper+H']) {
    assert.ok(!kisayolGecerliMi(k), JSON.stringify(k));
  }
  for (const k of [null, undefined, 42, {}, ['Control+H']]) assert.ok(!kisayolGecerliMi(k));
  assert.ok(!kisayolGecerliMi(`Control+${'A'.repeat(70)}`));
});

test('Alt+F4 kara listede; Control+Alt+F4 ayrı bir birleşimdir', () => {
  assert.ok(!kisayolGecerliMi('Alt+F4'));
  assert.ok(kisayolGecerliMi('Control+Alt+F4'));
});

test('kisayolDogrula nedenleri', () => {
  assert.equal(kisayolDogrula('').neden, 'bos');
  assert.equal(kisayolDogrula('Control+Alt+Ö').neden, 'bicim');
  assert.equal(kisayolDogrula('Control+Control+H').neden, 'bicim');
  assert.equal(kisayolDogrula('Shift+A').neden, 'degistirici-yok');
  assert.equal(kisayolDogrula('F9').neden, 'degistirici-yok');
  assert.equal(kisayolDogrula('Alt+F4').neden, 'kara-liste');
  assert.deepEqual(kisayolDogrula('Control+Alt+H'), { gecerli: true, neden: null, mesaj: '' });
  assert.ok(kisayolDogrula('F9').mesaj.length > 10);
});

test('normalleştirme: değiştirici sırası Control, Alt, Shift, Super', () => {
  assert.equal(kisayolNormallestir('Alt+Control+H'), 'Control+Alt+H');
  assert.equal(kisayolNormallestir('Control+Alt+H'), 'Control+Alt+H');
  assert.equal(kisayolNormallestir('Super+Shift+Alt+Control+Delete'), 'Control+Alt+Shift+Super+Delete');
  assert.equal(kisayolNormallestir('Shift+Control+H'), 'Control+Shift+H');
  assert.equal(kisayolNormallestir('Control+Control+H'), null);
  assert.equal(kisayolNormallestir('geçersiz'), null);
});

test('uyarılar engellemez, bilgi verir', () => {
  const ctrlAlt = kisayolUyarilari('Control+Alt+H');
  assert.equal(ctrlAlt.length, 1);
  assert.match(ctrlAlt[0], /AltGr/);
  assert.match(kisayolUyarilari('Super+H')[0], /Windows/);
  assert.match(kisayolUyarilari('Control+H')[0], /kısayollarını bozabilir/);
  assert.deepEqual(kisayolUyarilari('Control+Shift+H'), []);
  assert.deepEqual(kisayolUyarilari('Alt+Shift+Delete'), []);
  assert.deepEqual(kisayolUyarilari('F9'), []); // geçersiz: uyarı değil hata
});

test('kisayolGoster', () => {
  assert.equal(kisayolGoster('Control+Alt+H'), 'Ctrl+Alt+H');
  assert.equal(kisayolGoster('Super+H'), 'Win+H');
  assert.equal(kisayolGoster(null), '');
});

// --- h-24: esnek yazım (Ctrl, Win, küçük harf, boşluk) ------------------------------------------------

test('h-24: Ctrl / Win / küçük harf / boşluklu yazımlar kabul edilir ve normalleştirilir', () => {
  const beklenen = new Map([
    ['Ctrl+Alt+H', 'Control+Alt+H'],
    ['ctrl+alt+k', 'Control+Alt+K'],
    ['  Ctrl + Alt + K  ', 'Control+Alt+K'],
    ['ctrl alt k', 'Control+Alt+K'],
    ['win+h', 'Super+H'],
    ['Windows+Shift+h', 'Shift+Super+H'],
    ['Alt+Control+f9', 'Control+Alt+F9'],
    ['CONTROL+ALT+SPACE', 'Control+Alt+Space'],
    ['control+shift+pgup', 'Control+Shift+PageUp'],
    ['alt+shift+del', 'Alt+Shift+Delete'],
    ['Control+shift+a', 'Control+Shift+A'],
  ]);
  for (const [girdi, cikti] of beklenen) {
    assert.equal(kisayolNormallestir(girdi), cikti, girdi);
    assert.ok(kisayolGecerliMi(girdi), girdi);
  }
  assert.equal(kisayolNormallestir('Ctrl+Control+H'), null, 'aynı değiştirici iki adla yazılamaz');
  assert.equal(kisayolNormallestir('Ctrl++H'), null);
  assert.equal(kisayolNormallestir('Ctrl+Alt+'), null);
});

// --- h-25: Windows'a ayrılmış birleşimler ----------------------------------------------------------

test('h-25: Ctrl+C/V/X/A/Z/Y/W/F4/Space, Alt+Space, Alt+F4 ve Ctrl+Alt+Delete reddedilir ("Windows’a ayrılmış")', () => {
  for (const k of ['Control+C', 'Ctrl+V', 'ctrl+x', 'Control+A', 'Control+Z', 'Control+Y', 'Control+W', 'Control+F4', 'Control+Space', 'Alt+Space', 'Alt+F4', 'Control+Alt+Delete', 'ctrl + alt + del']) {
    const d = kisayolDogrula(k);
    assert.equal(d.gecerli, false, k);
    assert.equal(d.neden, 'kara-liste', k);
    assert.match(d.mesaj, /Windows’a ayrılmış/, k);
  }
  // Komşu birleşimler serbest kalır
  for (const k of ['Control+Shift+C', 'Control+Alt+C', 'Control+Alt+V', 'Alt+Shift+Space', 'Control+Alt+F4', 'Control+H']) {
    assert.ok(kisayolGecerliMi(k), k);
  }
});

test('h-25: AltGr ile çakışan Türkçe Q tuşları uyarıda adıyla sayılır; diğer harflerde genel uyarı da listeyi taşır', () => {
  const karakter = new Map([['Q', '@'], ['E', '€'], ['T', '₺'], ['7', '{'], ['8', '['], ['9', ']'], ['0', '}']]);
  for (const [tus, harf] of karakter) {
    const uyari = kisayolUyarilari(`Control+Alt+${tus}`);
    assert.equal(uyari.length, 1, tus);
    assert.ok(uyari[0].includes(`AltGr+${tus} (${harf})`), `${tus}: ${uyari[0]}`);
  }
  const genel = kisayolUyarilari('Control+Alt+H');
  assert.equal(genel.length, 1);
  assert.ok(genel[0].includes('Q (@), E (€), T (₺), 7 ({), 8 ([), 9 (]), 0 (})'), genel[0]);
  assert.doesNotMatch(genel[0], /AltGr+H/);
});

// --- k-01: tuş basışından kısayol ------------------------------------------------------------------

test('k-01: tuş basışı fiziksel tuş koduyla kısayola çevrilir; değiştirici tek başına ya da desteklenmeyen tuş null', () => {
  const bas = (code, ek = {}) => tusOlayindanKisayol({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...ek });
  assert.equal(bas('KeyK', { ctrlKey: true, altKey: true }), 'Control+Alt+K');
  assert.equal(bas('KeyK', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }), 'Control+Alt+Shift+Super+K');
  assert.equal(bas('Digit7', { ctrlKey: true, altKey: true }), 'Control+Alt+7');
  assert.equal(bas('F9', { ctrlKey: true }), 'Control+F9');
  assert.equal(bas('F24', { altKey: true }), 'Alt+F24');
  assert.equal(bas('Space', { altKey: true, shiftKey: true }), 'Alt+Shift+Space');
  assert.equal(bas('ArrowUp', { ctrlKey: true }), 'Control+Up');
  assert.equal(bas('Delete', { ctrlKey: true, altKey: true }), 'Control+Alt+Delete');
  assert.equal(bas('PageDown', { altKey: true }), 'Alt+PageDown');
  for (const code of ['ControlLeft', 'AltRight', 'ShiftLeft', 'MetaLeft', 'Tab', 'Enter', 'Escape', 'Backspace', 'Numpad5', '', undefined]) {
    assert.equal(bas(code, { ctrlKey: true }), null, String(code));
  }
  assert.equal(tusOlayindanKisayol(null), null);
  // Çıktı her zaman ayrıştırılabilir biçimdedir
  for (const k of ['Control+Alt+K', 'Control+Alt+Shift+Super+K', 'Control+Up']) assert.equal(kisayolNormallestir(k), k);
});
