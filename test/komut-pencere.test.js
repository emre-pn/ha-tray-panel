'use strict';

/**
 * Komut satırı pencere ve durum komutları (o-19): `--goster` / `--gizle` / `--degistir` (+ `--hedef`) ve `--durum` / `--liste`
 * (+ `--cikti`). Saf çözümleme; servis çağrısı yoktur. Bozuk yazım sessiz geçilmez ('gecersiz'), birden çok komut 'cakisma' olur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { pencereDurumKomutu, PENCERE_HEDEFLERI, eylemIstendiMi } = require('../src/lib/komut-satiri');

const exe = 'ev-paneli.exe';

test('pencereDurumKomutu: komut yoksa null (düz açılış, --gizli, --eylem ve onun yan seçenekleri)', () => {
  assert.equal(pencereDurumKomutu([exe]), null);
  assert.equal(pencereDurumKomutu([exe, '--gizli']), null);
  assert.equal(pencereDurumKomutu([exe, '--eylem=film']), null);
  assert.equal(pencereDurumKomutu([exe, '--eylem=film', '--hedef=panel']), null, 'yan seçenek --eylem ile gelirse komut sayılmaz');
  assert.equal(pencereDurumKomutu([exe, '--eylem', 'led', '+10']), null);
  assert.equal(pencereDurumKomutu(undefined), null);
  assert.equal(pencereDurumKomutu('--goster'), null);
  assert.equal(pencereDurumKomutu([exe, 5, null]), null);
});

test('pencereDurumKomutu: --goster / --gizle / --degistir (büyük küçük harf fark etmez), varsayılan hedef ana pencere', () => {
  assert.deepEqual(pencereDurumKomutu([exe, '--goster']), { tur: 'pencere', islem: 'goster', hedef: 'ana' });
  assert.deepEqual(pencereDurumKomutu([exe, '--GIZLE']), { tur: 'pencere', islem: 'gizle', hedef: 'ana' });
  assert.deepEqual(pencereDurumKomutu([exe, '--Degistir']), { tur: 'pencere', islem: 'degistir', hedef: 'ana' });
  assert.deepEqual(pencereDurumKomutu([exe, '--gizli', '--goster']), { tur: 'pencere', islem: 'goster', hedef: 'ana' });
});

test('pencereDurumKomutu: --hedef=ana|panel|palet ve eşittirsiz biçim; bilinmeyen hedef geçersiz', () => {
  assert.deepEqual(PENCERE_HEDEFLERI, ['ana', 'panel', 'palet']);
  for (const hedef of PENCERE_HEDEFLERI) {
    assert.deepEqual(pencereDurumKomutu([exe, '--degistir', `--hedef=${hedef}`]), { tur: 'pencere', islem: 'degistir', hedef });
  }
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--hedef', 'palet']), { tur: 'pencere', islem: 'goster', hedef: 'palet' });
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--hedef=PANEL']), { tur: 'pencere', islem: 'goster', hedef: 'panel' });
  assert.deepEqual(pencereDurumKomutu([exe, '--hedef=panel', '--gizle']), { tur: 'pencere', islem: 'gizle', hedef: 'panel' });
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--hedef=ayarlar']), { tur: 'gecersiz' }, 'ayarlar penceresi komut satırından açılmaz');
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--hedef=']), { tur: 'gecersiz' });
});

test('pencereDurumKomutu: bozuk yazım sessiz geçilmez (--goster=x, fiilsiz --hedef/--cikti, pencereyle --cikti)', () => {
  assert.deepEqual(pencereDurumKomutu([exe, '--goster=x']), { tur: 'gecersiz' });
  assert.deepEqual(pencereDurumKomutu([exe, '--gizle=']), { tur: 'gecersiz' });
  assert.deepEqual(pencereDurumKomutu([exe, '--hedef=panel']), { tur: 'gecersiz' });
  assert.deepEqual(pencereDurumKomutu([exe, '--cikti=a.json']), { tur: 'gecersiz' });
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--cikti=a.json']), { tur: 'gecersiz' });
  assert.deepEqual(pencereDurumKomutu([exe, '--durum', '--hedef=panel']), { tur: 'gecersiz' });
});

test('pencereDurumKomutu: birden çok komut ya da --eylem ile birlikte verilen komut çakışmadır (hiçbiri çalışmaz)', () => {
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--gizle']), { tur: 'cakisma' });
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--durum', '--cikti=a.json']), { tur: 'cakisma' });
  assert.deepEqual(pencereDurumKomutu([exe, '--durum', '--liste', '--cikti=a.json']).tur, 'durum', 'durum ve liste aynı belge ailesidir; liste daha kapsamlı');
  assert.deepEqual(pencereDurumKomutu([exe, '--goster', '--eylem=film']), { tur: 'cakisma' });
  assert.deepEqual(pencereDurumKomutu([exe, '--eylem=film', '--durum', '--cikti=a.json']), { tur: 'cakisma' });
  assert.equal(eylemIstendiMi([exe, '--goster']), false, '--goster eylem sayılmaz');
});

test('pencereDurumKomutu: --durum / --liste ham --cikti değerini ve çalışma klasörünü taşır; çıktısız komut da çözülür (hata ana süreçte)', () => {
  assert.deepEqual(pencereDurumKomutu([exe, '--durum', '--cikti=C:\\Users\\ben\\durum.json'], 'C:\\Users\\ben'), {
    tur: 'durum',
    liste: false,
    cikti: 'C:\\Users\\ben\\durum.json',
    dizin: 'C:\\Users\\ben',
  });
  assert.deepEqual(pencereDurumKomutu([exe, '--liste', '--cikti', 'liste.json'], 'C:\\Is'), { tur: 'durum', liste: true, cikti: 'liste.json', dizin: 'C:\\Is' });
  assert.deepEqual(pencereDurumKomutu([exe, '--durum']), { tur: 'durum', liste: false, cikti: null, dizin: null });
  assert.deepEqual(pencereDurumKomutu([exe, '--durum', '--cikti=']), { tur: 'durum', liste: false, cikti: null, dizin: null });
});

test('pencereDurumKomutu: boşluklu yol tırnaklı ya da bölünmüş gelse de birleşir; tırnaklar soyulur, denetim karakterleri atılır, aşırı uzun değer kırpılır', () => {
  assert.equal(pencereDurumKomutu([exe, '--durum', '--cikti="C:\\Users\\ben\\Belge lerim\\d.json"']).cikti, 'C:\\Users\\ben\\Belge lerim\\d.json');
  assert.equal(pencereDurumKomutu([exe, '--durum', '--cikti=C:\\Users\\ben\\Belge', 'lerim\\d.json']).cikti, 'C:\\Users\\ben\\Belge lerim\\d.json');
  assert.equal(pencereDurumKomutu([exe, '--durum', '--cikti=a\u0000.json']).cikti, 'a.json');
  const uzun = pencereDurumKomutu([exe, '--durum', `--cikti=${'a'.repeat(1000)}.json`]);
  assert.ok(uzun.cikti.length <= 301, 'ham değer 300 karakteri çok aşmaz; ana süreç ayrıca geçersiz sayar');
});
