'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { durumDeposuOlustur, yuzdeCevir, karoDurumu, aktifCikis, GRUPLAMA_MS } = require('../src/lib/durum-deposu');

function sahteZaman() {
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    atesle() {
      for (const [id, v] of [...bekleyenler]) {
        bekleyenler.delete(id);
        v.fn();
      }
    },
    bekleyen: () => bekleyenler.size,
    sonSure: () => [...bekleyenler.values()].at(-1)?.ms,
  };
}

const varlik = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: {}, ...ek });

test('depo: guncelle yazar, al okur; bilinmeyen undefined, yok-işaretli null', () => {
  const depo = durumDeposuOlustur({ zaman: sahteZaman() });
  assert.equal(depo.al('light.a'), undefined);
  assert.equal(depo.guncelle(varlik('light.a', 'on')), true);
  assert.equal(depo.al('light.a').state, 'on');
  assert.equal(depo.var('light.a'), true);
  depo.yokIsaretle('light.b');
  assert.equal(depo.al('light.b'), null);
  assert.equal(depo.var('light.b'), false);
  assert.equal(depo.guncelle(null), false);
  assert.equal(depo.guncelle({ state: 'on' }), false);
});

test('depo: last_updated karşılaştırması — eski olay yeniyi ezmez, eşit/yeni uygulanır, zamansız uygulanır', () => {
  const depo = durumDeposuOlustur({ zaman: sahteZaman() });
  depo.guncelle(varlik('light.a', 'on', { last_updated: '2026-10-06T10:00:05.000000+00:00' }));
  assert.equal(depo.guncelle(varlik('light.a', 'off', { last_updated: '2026-10-06T10:00:01.000000+00:00' })), false, 'eski olay atlanır');
  assert.equal(depo.al('light.a').state, 'on');
  assert.equal(depo.guncelle(varlik('light.a', 'off', { last_updated: '2026-10-06T10:00:05.000000+00:00' })), true, 'eşit zaman uygulanır');
  assert.equal(depo.guncelle(varlik('light.a', 'on', { last_updated: '2026-10-06T10:00:09.000000+00:00' })), true);
  assert.equal(depo.guncelle(varlik('light.a', 'off')), true, 'zaman bilgisi yoksa uygulanır');
  assert.equal(depo.al('light.a').state, 'off');
});

test('depo: değişimler 50 ms içinde gruplanıp tek bildirimle gelir', () => {
  const zaman = sahteZaman();
  const depo = durumDeposuOlustur({ zaman });
  const bildirimler = [];
  depo.dinle((k) => bildirimler.push(k));
  depo.guncelle(varlik('light.a', 'on'));
  depo.guncelle(varlik('light.b', 'on'));
  depo.guncelle(varlik('light.a', 'off'));
  assert.equal(bildirimler.length, 0);
  assert.equal(zaman.bekleyen(), 1, 'tek zamanlayıcı');
  assert.equal(zaman.sonSure(), GRUPLAMA_MS);
  zaman.atesle();
  assert.deepEqual(bildirimler, [['light.a', 'light.b']]);
});

test('depo: dinleyici hatası diğerlerini engellemez; abonelikten çıkış çalışır; bosalt hemen bildirir', () => {
  const zaman = sahteZaman();
  const depo = durumDeposuOlustur({ zaman });
  const alinan = [];
  depo.dinle(() => {
    throw new Error('kötü dinleyici');
  });
  const cik = depo.dinle((k) => alinan.push(k));
  depo.guncelle(varlik('switch.a', 'on'));
  depo.bosalt();
  assert.deepEqual(alinan, [['switch.a']]);
  assert.equal(zaman.bekleyen(), 0);
  cik();
  depo.guncelle(varlik('switch.a', 'off'));
  depo.bosalt();
  assert.equal(alinan.length, 1);
});

test('depo: toplu anlık görüntü (REST, tam liste verilmez) uygular; izlenen ama görüntüde olmayan bilinmeyen kimlik "yok" olur, bilinen korunur', () => {
  const depo = durumDeposuOlustur({ zaman: sahteZaman() });
  depo.guncelle(varlik('light.bilinen', 'on'));
  depo.toplu([varlik('light.a', 'on')], ['light.a', 'light.yok', 'light.bilinen']);
  assert.equal(depo.al('light.a').state, 'on');
  assert.equal(depo.al('light.yok'), null);
  assert.equal(depo.al('light.bilinen').state, 'on', 'REST eksikliği geçici sayılır (zaman aşımı gibi): önceki durum silinmez');
});

test('h-18: canlı bağlantının TAM listesinde (get_states) hiç bulunmayan izlenen varlık, daha önce bilinse de "yok" olur', () => {
  const depo = durumDeposuOlustur({ zaman: sahteZaman() });
  depo.guncelle(varlik('light.silinen', 'on'));
  depo.guncelle(varlik('light.bozuk', 'on'));
  // tam listede light.bozuk var ama durumu süzgeçten geçemedi (varliklar dizisinde yok): silinmiş sayılmaz
  depo.toplu([varlik('light.a', 'on')], ['light.a', 'light.silinen', 'light.bozuk', 'light.yeni'], { tamListe: new Set(['light.a', 'light.bozuk', 'sensor.baska']) });
  assert.equal(depo.al('light.a').state, 'on');
  assert.equal(depo.al('light.silinen'), null, 'HA\'dan silindi: eski "açık" durumuyla kalmaz');
  assert.equal(depo.al('light.bozuk').state, 'on', 'tam listede var: bilinen durum korunur');
  assert.equal(depo.al('light.yeni'), null, 'hiç bilinmeyen ve listede olmayan: yok');
  // sonra HA'da yeniden eklenirse olay/anlık görüntü onu geri getirir
  depo.toplu([varlik('light.silinen', 'off')], ['light.silinen'], { tamListe: new Set(['light.silinen']) });
  assert.equal(depo.al('light.silinen').state, 'off');
});

test('depo: buda izlenmeyenleri siler, sifirla her şeyi temizler ve sonHata sıfırlanır', () => {
  const depo = durumDeposuOlustur({ zaman: sahteZaman() });
  depo.guncelle(varlik('light.a', 'on'));
  depo.guncelle(varlik('light.b', 'on'));
  depo.buda(['light.a']);
  assert.deepEqual(depo.kimlikler(), ['light.a']);
  depo.sonHata = 'x';
  assert.equal(depo.sonHata, 'x');
  depo.sifirla();
  assert.deepEqual(depo.kimlikler(), []);
  assert.equal(depo.sonHata, null);
});

test('yuzdeCevir: 0/1/127/255 -> 0/0/50/100; sayı olmayan null', () => {
  assert.equal(yuzdeCevir(0), 0);
  assert.equal(yuzdeCevir(1), 0);
  assert.equal(yuzdeCevir(127), 50);
  assert.equal(yuzdeCevir(255), 100);
  assert.equal(yuzdeCevir(300), 100);
  assert.equal(yuzdeCevir('x'), null);
  assert.equal(yuzdeCevir(undefined), null);
  assert.equal(yuzdeCevir(NaN), null);
});

test('karoDurumu: ışık açık/kapalı/yüzde (açıkken en az %1), ulaşılamıyor yok, sahne ve düğme nötr, script çalışıyorsa açık', () => {
  assert.deepEqual(karoDurumu(varlik('light.a', 'on', { attributes: { brightness: 127 } })), { durum: 'acik', yuzde: 50 });
  assert.deepEqual(karoDurumu(varlik('light.a', 'on', { attributes: { brightness: 1 } })), { durum: 'acik', yuzde: 1 });
  assert.deepEqual(karoDurumu(varlik('light.a', 'on')), { durum: 'acik', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('light.a', 'off')), { durum: 'kapali', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('light.a', 'unavailable')), { durum: 'yok', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('light.a', 'unknown')), { durum: 'yok', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('switch.a', 'on', { attributes: { brightness: 10 } })), { durum: 'acik', yuzde: null }, 'yüzde yalnız ışıkta');
  assert.deepEqual(karoDurumu(varlik('scene.a', 'scening')), { durum: 'notr', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('button.a', 'unknown')), { durum: 'notr', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('script.a', 'on')), { durum: 'acik', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('script.a', 'off')), { durum: 'notr', yuzde: null });
  assert.deepEqual(karoDurumu(null), { durum: 'yok', yuzde: null });
  assert.deepEqual(karoDurumu(undefined), { durum: 'yok', yuzde: null });
});

test('karoDurumu (1.4.0 cihaz grubu): perde ve vana open/opening açık, closed kapalı, closing geçiş (nötr); otomasyon on/off; unavailable yok', () => {
  for (const alan of ['cover', 'valve']) {
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'open')), { durum: 'acik', yuzde: null }, alan);
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'opening')), { durum: 'acik', yuzde: null }, alan);
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'closed')), { durum: 'kapali', yuzde: null }, alan);
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'closing')), { durum: 'notr', yuzde: null }, alan);
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'unavailable')), { durum: 'yok', yuzde: null }, alan);
    assert.deepEqual(karoDurumu(varlik(`${alan}.a`, 'unknown')), { durum: 'notr', yuzde: null }, alan);
  }
  assert.deepEqual(karoDurumu(varlik('automation.a', 'on')), { durum: 'acik', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('automation.a', 'off')), { durum: 'kapali', yuzde: null });
  assert.deepEqual(karoDurumu(varlik('automation.a', 'unavailable')), { durum: 'yok', yuzde: null });
});

test('aktifCikis: Türkçe/İngilizce çıkış adlarından hoparlör ya da kulaklık', () => {
  assert.equal(aktifCikis('Hoparlör (Realtek Audio)'), 'hoparlor');
  assert.equal(aktifCikis('Kulaklık (USB)'), 'kulaklik');
  assert.equal(aktifCikis('KULAKLIK'), 'kulaklik');
  assert.equal(aktifCikis('Headphones'), 'kulaklik');
  assert.equal(aktifCikis('Speakers'), 'hoparlor');
  assert.equal(aktifCikis('Monitor'), null);
  assert.equal(aktifCikis(undefined), null);
});
