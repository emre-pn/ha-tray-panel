'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tusEylemi, yakinlastirmaDuzelt, yakinlastirmaDegistir } = require('../src/lib/tus-eylemi');

const tus = (ek) => ({ type: 'keyDown', key: '', code: '', control: false, alt: false, shift: false, meta: false, isAutoRepeat: false, ...ek });

test('yenile: Ctrl+R ve F5; Ctrl+Shift+R önbelleksiz (önce o kontrol edilir)', () => {
  assert.equal(tusEylemi(tus({ key: 'r', code: 'KeyR', control: true })), 'yenile');
  assert.equal(tusEylemi(tus({ key: 'R', code: 'KeyR', control: true, shift: true })), 'yenile-onbellek');
  assert.equal(tusEylemi(tus({ key: 'F5', code: 'F5' })), 'yenile');
  assert.equal(tusEylemi(tus({ key: 'F5', code: 'F5', control: true })), 'yenile-onbellek');
  assert.equal(tusEylemi(tus({ key: 'F5', code: 'F5', shift: true })), 'yenile-onbellek');
});

test('tam ekran, gizle, boyut değiştir', () => {
  assert.equal(tusEylemi(tus({ key: 'F11', code: 'F11' })), 'tamekran');
  assert.equal(tusEylemi(tus({ key: 'w', code: 'KeyW', control: true })), 'gizle');
  assert.equal(tusEylemi(tus({ key: 'G', code: 'KeyG', control: true, shift: true })), 'boyut-degistir');
  assert.equal(tusEylemi(tus({ key: 'g', code: 'KeyG', control: true })), null);
});

test('yakınlaştırma: Türkçe Q düzeni (+ Shift ile, - ayrı tuşta) key ile çalışır', () => {
  // Türkçe Q: "+" Shift+4 ile üretilir (code Digit4), "-" ayrı fiziksel tuş (code Slash gibi): code güvenilmez.
  assert.equal(tusEylemi(tus({ key: '+', code: 'Digit4', control: true, shift: true })), 'yakin-art');
  assert.equal(tusEylemi(tus({ key: '-', code: 'Slash', control: true })), 'yakin-eksi');
  assert.equal(tusEylemi(tus({ key: '_', code: 'Slash', control: true, shift: true })), 'yakin-eksi');
  assert.equal(tusEylemi(tus({ key: '0', code: 'Digit0', control: true })), 'yakin-sifir');
});

test('yakınlaştırma: ABD düzeni ve sayısal tuş takımı', () => {
  assert.equal(tusEylemi(tus({ key: '=', code: 'Equal', control: true })), 'yakin-art');
  assert.equal(tusEylemi(tus({ key: '+', code: 'Equal', control: true, shift: true })), 'yakin-art');
  assert.equal(tusEylemi(tus({ key: '-', code: 'Minus', control: true })), 'yakin-eksi');
  assert.equal(tusEylemi(tus({ key: '+', code: 'NumpadAdd', control: true })), 'yakin-art');
  assert.equal(tusEylemi(tus({ key: '-', code: 'NumpadSubtract', control: true })), 'yakin-eksi');
  assert.equal(tusEylemi(tus({ key: '0', code: 'Numpad0', control: true })), 'yakin-sifir');
});

test('geri/ileri: Alt+Sol, Alt+Sağ (Ctrl yok)', () => {
  assert.equal(tusEylemi(tus({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true })), 'geri');
  assert.equal(tusEylemi(tus({ key: 'ArrowRight', code: 'ArrowRight', alt: true })), 'ileri');
  assert.equal(tusEylemi(tus({ key: 'ArrowLeft', code: 'ArrowLeft' })), null);
  assert.equal(tusEylemi(tus({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true, shift: true })), null);
});

test('Ctrl+Alt birleşimleri (AltGr) hiçbir şey tetiklemez', () => {
  for (const ek of [
    { key: 'r', code: 'KeyR' },
    { key: 'w', code: 'KeyW' },
    { key: '+', code: 'Digit4' },
    { key: '0', code: 'Digit0' },
    { key: '-', code: 'Slash' },
    { key: 'ArrowLeft', code: 'ArrowLeft' },
    { key: 'F5', code: 'F5' },
    { key: 'F11', code: 'F11' },
  ]) {
    assert.equal(tusEylemi(tus({ ...ek, control: true, alt: true })), null, JSON.stringify(ek));
  }
});

test('keyUp, meta ve boş girdi null döner', () => {
  assert.equal(tusEylemi({ ...tus({ key: 'r', code: 'KeyR', control: true }), type: 'keyUp' }), null);
  assert.equal(tusEylemi(tus({ key: 'r', code: 'KeyR', control: true, meta: true })), null);
  assert.equal(tusEylemi(null), null);
  assert.equal(tusEylemi(undefined), null);
  assert.equal(tusEylemi({}), null);
});

test('ilgisiz tuşlar null döner (HA kısayolları bozulmaz)', () => {
  for (const ek of [
    { key: 'e', code: 'KeyE' },
    { key: 'c', code: 'KeyC', control: true },
    { key: 'a', code: 'KeyA', control: true },
    { key: 'Escape', code: 'Escape' },
    { key: 'F12', code: 'F12' },
    { key: 'w', code: 'KeyW', control: true, shift: true },
    { key: 'F4', code: 'F4', alt: true },
  ]) {
    assert.equal(tusEylemi(tus(ek)), null, JSON.stringify(ek));
  }
});

test('tekrarlayan basışta yalnız yakınlaştırma çalışır', () => {
  assert.equal(tusEylemi(tus({ key: 'r', code: 'KeyR', control: true, isAutoRepeat: true })), null);
  assert.equal(tusEylemi(tus({ key: 'F5', code: 'F5', isAutoRepeat: true })), null);
  assert.equal(tusEylemi(tus({ key: 'w', code: 'KeyW', control: true, isAutoRepeat: true })), null);
  assert.equal(tusEylemi(tus({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true, isAutoRepeat: true })), null);
  assert.equal(tusEylemi(tus({ key: '+', code: 'Digit4', control: true, shift: true, isAutoRepeat: true })), 'yakin-art');
  assert.equal(tusEylemi(tus({ key: '-', code: 'Minus', control: true, isAutoRepeat: true })), 'yakin-eksi');
});

test('yakinlastirmaDuzelt: -3..5 aralığı ve 0,5 adım', () => {
  assert.equal(yakinlastirmaDuzelt(0), 0);
  assert.equal(yakinlastirmaDuzelt(1), 1);
  assert.equal(yakinlastirmaDuzelt(0.5), 0.5);
  assert.equal(yakinlastirmaDuzelt(0.7), 0.5);
  assert.equal(yakinlastirmaDuzelt(0.8), 1);
  assert.equal(yakinlastirmaDuzelt(-3), -3);
  assert.equal(yakinlastirmaDuzelt(-9), -3);
  assert.equal(yakinlastirmaDuzelt(99), 5);
  assert.equal(yakinlastirmaDuzelt('1.5'), 1.5);
  for (const kotu of [undefined, null, '', 'x', NaN, Infinity, {}]) assert.equal(yakinlastirmaDuzelt(kotu), 0, String(kotu));
  assert.ok(Object.is(yakinlastirmaDuzelt(-0.1), 0)); // -0 olmaz
});

test('yakinlastirmaDegistir: adım, sınır ve sıfırlama', () => {
  assert.equal(yakinlastirmaDegistir(0, 1), 0.5);
  assert.equal(yakinlastirmaDegistir(0, -1), -0.5);
  assert.equal(yakinlastirmaDegistir(4.5, 1), 5);
  assert.equal(yakinlastirmaDegistir(5, 1), 5);
  assert.equal(yakinlastirmaDegistir(-3, -1), -3);
  assert.equal(yakinlastirmaDegistir(2.5, 0), 0);
  assert.equal(yakinlastirmaDegistir(undefined, 1), 0.5);
  assert.ok(Object.is(yakinlastirmaDegistir(0.5, -1), 0));
});
