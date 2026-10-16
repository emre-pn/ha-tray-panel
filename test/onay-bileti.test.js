'use strict';

/**
 * Tek kullanımlık ikinci onay bileti (src/lib/onay-bileti.js, 1.1.1 tur 5, K7): saf modül, gerçek ağ yok.
 * Bilet; aday parmak izine, o anki köken sayacına ve kayıt durumuna bağlıdır; bir kez kullanılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { onayBiletiDeposuOlustur } = require('../src/lib/onay-bileti');

const A = '0123456789abcdef';
const B = 'fedcba9876543210';

function kur() {
  let n = 0;
  return onayBiletiDeposuOlustur({ rastgele: () => `nonce-${(n += 1)}` });
}

test('bilet: aynı parmak izi + aynı sayaç + aynı kayıt durumu ile BİR kez kabul edilir; ikinci kullanım reddedilir', () => {
  const depo = kur();
  const bilet = depo.ver({ parmakIzi: A, sayi: 2, kayit: null });
  assert.equal(typeof bilet, 'string');
  assert.ok(bilet.length > 0);
  assert.equal(depo.tuket(bilet, { parmakIzi: A, sayi: 2, kayit: null }), true);
  assert.equal(depo.tuket(bilet, { parmakIzi: A, sayi: 2, kayit: null }), false, 'tek kullanımlık');
});

test('bilet: başka parmak izi, değişmiş sayaç ya da değişmiş kayıt durumu için KABUL EDİLMEZ ve yanar (yeniden bilet gerekir)', () => {
  const depo = kur();
  for (const degisen of [{ parmakIzi: B, sayi: 2, kayit: null }, { parmakIzi: A, sayi: 3, kayit: null }, { parmakIzi: A, sayi: 2, kayit: 'kayit-okunamadi' }]) {
    const bilet = depo.ver({ parmakIzi: A, sayi: 2, kayit: null });
    assert.equal(depo.tuket(bilet, degisen), false, JSON.stringify(degisen));
    assert.equal(depo.tuket(bilet, { parmakIzi: A, sayi: 2, kayit: null }), false, 'yanlış denemeden sonra bilet yanmıştır');
  }
});

test('bilet: bilinmeyen, boş ya da dize olmayan bilet reddedilir; bilet sayısı sınırlıdır (en eski düşer)', () => {
  const depo = onayBiletiDeposuOlustur({ rastgele: (() => { let n = 0; return () => `n${(n += 1)}`; })(), enCok: 3 });
  for (const bilet of [undefined, null, '', 'yok', 5, {}, true]) assert.equal(depo.tuket(bilet, { parmakIzi: A, sayi: 0, kayit: null }), false);
  const ilk = depo.ver({ parmakIzi: A, sayi: 1, kayit: null });
  depo.ver({ parmakIzi: A, sayi: 1, kayit: null });
  depo.ver({ parmakIzi: A, sayi: 1, kayit: null });
  depo.ver({ parmakIzi: A, sayi: 1, kayit: null });
  assert.equal(depo.tuket(ilk, { parmakIzi: A, sayi: 1, kayit: null }), false, 'en eski bilet düştü');
});

test('bilet: varsayılan üreteç tahmin edilemez, her çağrıda farklıdır ve parmak izini içermez', () => {
  const depo = onayBiletiDeposuOlustur();
  const x = depo.ver({ parmakIzi: A, sayi: 2, kayit: null });
  const y = depo.ver({ parmakIzi: A, sayi: 2, kayit: null });
  assert.notEqual(x, y);
  assert.ok(x.length >= 16);
  assert.ok(!x.includes(A));
});
