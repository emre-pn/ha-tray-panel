'use strict';

/**
 * k-05: favori sırası (yükteki sıra korunur), k-06: karo adı (etiket) ve kapı süzgeci.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { favorileriDuzelt, favorileriBirlestir } = require('../src/lib/favoriler');

const guvenli = (...cift) => new Map(cift);
const TUMU = new Set(['light.masa', 'light.ampul', 'button.hoparlor', 'scene.film']);
const GUVENLI = guvenli(['light.masa', 'Masa'], ['light.ampul', 'Ampul'], ['button.hoparlor', 'Hoparlör'], ['scene.film', 'Film']);

test('k-05: yükteki sıra yeni favori sırasıdır (tepsi ve panel bu sırayı kullanır); sıra değişince alanlar korunur', () => {
  const mevcut = [
    { entity_id: 'light.masa', ad: 'Masa', etiket: 'Masa lambası', kisayol: 'Control+Alt+M' },
    { entity_id: 'light.ampul', ad: 'Ampul' },
    { entity_id: 'button.hoparlor', ad: 'Hoparlör', onay: false },
  ];
  const { yeni, kisayolHatalari } = favorileriBirlestir({
    mevcut,
    secilen: [{ entity_id: 'button.hoparlor' }, { entity_id: 'scene.film' }, { entity_id: 'light.masa' }, { entity_id: 'light.ampul' }],
    guvenliListe: GUVENLI,
    tumKimlikler: TUMU,
  });
  assert.deepEqual(yeni.map((f) => f.entity_id), ['button.hoparlor', 'scene.film', 'light.masa', 'light.ampul']);
  assert.deepEqual(yeni[2], { entity_id: 'light.masa', ad: 'Masa', etiket: 'Masa lambası', kisayol: 'Control+Alt+M' });
  assert.equal(yeni[0].onay, false);
  assert.deepEqual(kisayolHatalari, []);
});

test('k-06: yükteki karo adı kaydedilir, boş karo adı temizler, yükte yoksa kayıttaki korunur', () => {
  const mevcut = [{ entity_id: 'light.masa', ad: 'Masa', etiket: 'Eski ad' }, { entity_id: 'light.ampul', ad: 'Ampul', etiket: 'Ampul adı' }];
  const { yeni, etiketHatalari } = favorileriBirlestir({
    mevcut,
    secilen: [
      { entity_id: 'light.masa', etiket: '  Masa   lambası  ' },
      { entity_id: 'light.ampul' },
      { entity_id: 'button.hoparlor', etiket: 'Ses çıkışı' },
      { entity_id: 'scene.film', etiket: '' },
    ],
    guvenliListe: GUVENLI,
    tumKimlikler: TUMU,
  });
  const harita = new Map(yeni.map((f) => [f.entity_id, f]));
  assert.equal(harita.get('light.masa').etiket, 'Masa lambası', 'boşluklar sadeleşir');
  assert.equal(harita.get('light.ampul').etiket, 'Ampul adı', 'yükte yok: korunur');
  assert.equal(harita.get('button.hoparlor').etiket, 'Ses çıkışı', 'yeni favoride de ad verilebilir');
  assert.equal('etiket' in harita.get('scene.film'), false);
  assert.deepEqual(etiketHatalari, []);

  const temizle = favorileriBirlestir({ mevcut, secilen: [{ entity_id: 'light.masa', etiket: '' }], guvenliListe: GUVENLI, tumKimlikler: TUMU });
  assert.equal('etiket' in temizle.yeni[0], false, 'boş karo adı etiketi siler (HA adı görünür)');
});

test('k-06: karo adı kapı süzgecinden geçer: "Kapı", "kilit", "garaj" adı reddedilir, bildirilir, önceki ad korunur', () => {
  const mevcut = [{ entity_id: 'light.masa', ad: 'Masa', etiket: 'Masa lambası' }];
  for (const kotu of ['Kapı ışığı', 'ön KAPI', 'Garaj', 'kilit', 'Door light', 'alarm', 'ｋａｐｉ', 'Ka\u00ADpı']) {
    const { yeni, etiketHatalari } = favorileriBirlestir({
      mevcut,
      secilen: [{ entity_id: 'light.masa', etiket: kotu }, { entity_id: 'light.ampul', etiket: kotu }],
      guvenliListe: GUVENLI,
      tumKimlikler: TUMU,
    });
    assert.equal(yeni[0].etiket, 'Masa lambası', `${kotu}: önceki ad korunur`);
    assert.equal('etiket' in yeni[1], false, `${kotu}: yeni favoriye uygulanmaz`);
    assert.deepEqual(etiketHatalari, [{ entity_id: 'light.masa', neden: 'guvenlik' }, { entity_id: 'light.ampul', neden: 'guvenlik' }], kotu);
  }
});

test('k-06: karo adı 40 karakterle sınırlanır ve favorileriDuzelt (ayar dosyası / içe aktarma yolu) da etiketi süzer', () => {
  const uzun = 'a'.repeat(70);
  const { yeni, etiketHatalari } = favorileriBirlestir({ mevcut: [], secilen: [{ entity_id: 'light.masa', etiket: uzun }], guvenliListe: GUVENLI, tumKimlikler: TUMU });
  assert.equal(yeni[0].etiket.length, 40);
  assert.deepEqual(etiketHatalari, []);
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'light.masa', ad: 'Masa', etiket: 'Kapı ışığı' },
    { entity_id: 'light.ampul', ad: 'Ampul', etiket: 'Güzel ampul' },
  ]);
  assert.equal('etiket' in favoriler[0], false);
  assert.equal(favoriler[1].etiket, 'Güzel ampul');
});
