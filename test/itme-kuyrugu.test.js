'use strict';

/** o-61: düğmeli itme bildirimi kartı kuyruğu (saf). Tek görünen kart, etiketle değiştirme, sınırlı sıra, tek kullanımlık düğme. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EN_COK_BEKLEYEN, itmeKuyruguOlustur } = require('../src/lib/itme-kuyrugu');

const bildirim = (mesaj, etiket = null, dugmeler = [{ eylem: 'TAMAM', baslik: 'Tamam' }]) => ({ baslik: null, mesaj, etiket, dugmeler });

test('ilk bildirim hemen görünür, ikincisi sıraya girer; numaralar artar', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir'));
  assert.equal(bir.tur, 'goster');
  assert.equal(bir.kart.kartNo, 1);
  const iki = k.ekle(bildirim('iki'));
  assert.equal(iki.tur, 'siraya');
  assert.equal(iki.kart.kartNo, 2);
  assert.equal(k.gorunen().mesaj, 'bir');
  assert.equal(k.bekleyenSayisi(), 1);
});

test('aynı etiketli bildirim görünen kartın yerine geçer (yeni kart numarası)', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('eski', 'camasir'));
  const iki = k.ekle(bildirim('yeni', 'camasir'));
  assert.equal(iki.tur, 'degistir');
  assert.notEqual(iki.kart.kartNo, bir.kart.kartNo);
  assert.equal(k.gorunen().mesaj, 'yeni');
  assert.equal(k.bekleyenSayisi(), 0);
  // eski kartın numarası artık geçersiz
  assert.equal(k.eylemSec(bir.kart.kartNo, 0), null);
  assert.deepEqual(k.eylemSec(iki.kart.kartNo, 0), { eylem: 'TAMAM', etiket: 'camasir', sonraki: null });
});

test('aynı etiketli bekleyen kart yerinde değiştirilir; etiketsiz bildirimler hiç birleşmez', () => {
  const k = itmeKuyruguOlustur();
  k.ekle(bildirim('bir', 'a'));
  k.ekle(bildirim('iki', 'b'));
  const yeni = k.ekle(bildirim('iki-yeni', 'b'));
  assert.equal(yeni.tur, 'siraya');
  assert.equal(k.bekleyenSayisi(), 1);
  k.ekle(bildirim('x'));
  k.ekle(bildirim('x'));
  assert.equal(k.bekleyenSayisi(), 3);
});

test('sıra en çok 5 bekleyen tutar; taşarsa en eskisi düşer', () => {
  assert.equal(EN_COK_BEKLEYEN, 5);
  const k = itmeKuyruguOlustur();
  k.ekle(bildirim('gorunen'));
  for (let i = 1; i <= 8; i += 1) k.ekle(bildirim(`b${i}`));
  assert.equal(k.bekleyenSayisi(), 5);
  const sirayla = [];
  let kart = k.gorunen();
  while (kart) {
    sirayla.push(kart.mesaj);
    kart = k.bitir(kart.kartNo).sonraki;
  }
  assert.deepEqual(sirayla, ['gorunen', 'b4', 'b5', 'b6', 'b7', 'b8']);
});

test('düğme tek kullanımlıktır: kart kapanır, sıradaki görünür, ikinci basış reddedilir', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir', 't1', [{ eylem: 'A', baslik: 'A' }, { eylem: 'B', baslik: 'B' }]));
  const iki = k.ekle(bildirim('iki', 't2'));
  const sonuc = k.eylemSec(bir.kart.kartNo, 1);
  assert.equal(sonuc.eylem, 'B');
  assert.equal(sonuc.etiket, 't1');
  assert.equal(sonuc.sonraki.kartNo, iki.kart.kartNo);
  assert.equal(k.gorunen().kartNo, iki.kart.kartNo);
  assert.equal(k.eylemSec(bir.kart.kartNo, 1), null, 'aynı kartın ikinci basışı');
  assert.equal(k.eylemSec(bir.kart.kartNo, 0), null);
});

test('eylemSec: yanlış kart numarası, sınır dışı sıra ve tamsayı olmayan sıra reddedilir; kart açık kalır', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir', null, [{ eylem: 'A', baslik: 'A' }]));
  for (const [no, sira] of [[999, 0], [bir.kart.kartNo, 1], [bir.kart.kartNo, -1], [bir.kart.kartNo, 0.5], [bir.kart.kartNo, '0'], [bir.kart.kartNo, NaN], ['1', 0], [null, 0], [undefined, 0]]) {
    assert.equal(k.eylemSec(no, sira), null, `${no}/${sira}`);
  }
  assert.equal(k.gorunen().kartNo, bir.kart.kartNo);
});

test('sırada bekleyen kartın numarasıyla düğme basılamaz (yalnız görünen kart)', () => {
  const k = itmeKuyruguOlustur();
  k.ekle(bildirim('bir'));
  const iki = k.ekle(bildirim('iki'));
  assert.equal(k.eylemSec(iki.kart.kartNo, 0), null);
  assert.equal(k.bekleyenSayisi(), 1);
});

test('düğmesiz kartta eylemSec hiçbir şey seçmez', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir', null, []));
  assert.equal(k.eylemSec(bir.kart.kartNo, 0), null);
});

test('bitir: yalnız görünen kartın numarasıyla kapanır, sıradakini getirir', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir'));
  const iki = k.ekle(bildirim('iki'));
  assert.deepEqual(k.bitir(iki.kart.kartNo), { kapandi: false, sonraki: null });
  assert.deepEqual(k.bitir(999), { kapandi: false, sonraki: null });
  const sonuc = k.bitir(bir.kart.kartNo);
  assert.equal(sonuc.kapandi, true);
  assert.equal(sonuc.sonraki.mesaj, 'iki');
  assert.equal(k.bitir(k.gorunen().kartNo).sonraki, null);
  assert.equal(k.gorunen(), null);
});

test('temizle (clear_notification): etiketli bekleyenleri siler, görünen etiketliyse kapatır; boş etiket işe yaramaz', () => {
  const k = itmeKuyruguOlustur();
  k.ekle(bildirim('bir', 'a'));
  k.ekle(bildirim('iki', 'b'));
  k.ekle(bildirim('uc', 'a'));
  k.ekle(bildirim('dort', 'c'));
  assert.deepEqual(k.temizle(''), { kapandi: false, sonraki: null });
  assert.deepEqual(k.temizle(null), { kapandi: false, sonraki: null });
  assert.deepEqual(k.temizle('yok'), { kapandi: false, sonraki: null });
  const sonuc = k.temizle('a');
  assert.equal(sonuc.kapandi, true);
  assert.equal(sonuc.sonraki.mesaj, 'iki');
  assert.equal(k.bekleyenSayisi(), 1); // 'uc' (etiket a) silindi, 'dort' kaldı
  assert.deepEqual(k.temizle('c'), { kapandi: false, sonraki: null });
  assert.equal(k.bekleyenSayisi(), 0);
});

test('sifirla her şeyi siler; sonraki kart numarası geriye gitmez', () => {
  const k = itmeKuyruguOlustur();
  const bir = k.ekle(bildirim('bir'));
  k.ekle(bildirim('iki'));
  k.sifirla();
  assert.equal(k.gorunen(), null);
  assert.equal(k.bekleyenSayisi(), 0);
  assert.equal(k.eylemSec(bir.kart.kartNo, 0), null);
  assert.ok(k.ekle(bildirim('uc')).kart.kartNo > bir.kart.kartNo);
});

test('kuyruk girdiyi kopyalar: dışarıdan değiştirilen düğme listesi kartı etkilemez', () => {
  const k = itmeKuyruguOlustur();
  const dugmeler = [{ eylem: 'A', baslik: 'A' }];
  const kart = k.ekle(bildirim('bir', null, dugmeler)).kart;
  dugmeler[0].eylem = 'DEGISTI';
  dugmeler.push({ eylem: 'B', baslik: 'B' });
  assert.equal(k.eylemSec(kart.kartNo, 1), null);
  assert.equal(k.eylemSec(kart.kartNo, 0).eylem, 'A');
});

test('enCokBekleyen ayarlanabilir', () => {
  const k = itmeKuyruguOlustur({ enCokBekleyen: 1 });
  k.ekle(bildirim('bir'));
  k.ekle(bildirim('iki'));
  k.ekle(bildirim('uc'));
  assert.equal(k.bekleyenSayisi(), 1);
  assert.equal(k.bitir(k.gorunen().kartNo).sonraki.mesaj, 'uc');
});
