'use strict';

/**
 * Düzen işlemleri (src/lib/duzen-islemleri.js; o-24, o-30): sayfa listesi ve sıralama dizi işlemleri. Saf, girdiyi değiştirmeyen
 * işlevler; hem ana süreç hem Ayarlar sayfası (window.EvDuzenIslemleri) aynı kodu kullanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../src/lib/duzen-islemleri');

const S = (id, ad, ...varliklar) => ({ id, ad, varliklar });
const ornek = () => [S('aaa', 'Işıklar', 'light.a', 'light.b'), S('bbb', 'Akşam', 'scene.film')];
const donmus = (nesne) => JSON.stringify(nesne);

test('hiçbir işlev girdiyi değiştirmez', () => {
  const liste = ornek();
  const once = donmus(liste);
  D.sayfaEkle(liste, 'Yeni', 'ccc');
  D.sayfayiAdlandir(liste, 'aaa', 'Başka');
  D.sayfayiCogalt(liste, 'aaa', 'ddd', 'kopya');
  D.sayfayiSil(liste, 'aaa');
  D.sayfayiTasi(liste, 'aaa', 1);
  D.sayfayiKonumaTasi(liste, 'aaa', 1);
  D.varlikEkle(liste, 'aaa', 'light.c');
  D.varlikCikar(liste, 'aaa', 'light.a');
  D.varlikTasi(liste, 'aaa', 'light.a', { yon: 1 });
  D.kimlikDegistir(liste, 'light.a', 'light.z');
  D.tumundenCikar(liste, 'light.a');
  assert.equal(donmus(liste), once);
});

test('sayfaKimligiUret: kullanılmayan, desene uyan kimlik; çakışmada yeni üretir', () => {
  const dizi = [0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  const rastgele = () => dizi[i++ % dizi.length];
  const ilk = D.sayfaKimligiUret([], rastgele);
  assert.equal(ilk, 'saaaaa');
  assert.match(ilk, D.SAYFA_KIMLIGI_DESENI);
  const ikinci = D.sayfaKimligiUret([{ id: 'saaaaa' }], rastgele);
  assert.notEqual(ikinci, 'saaaaa');
  assert.match(D.sayfaKimligiUret([]), D.SAYFA_KIMLIGI_DESENI);
  for (let n = 0; n < 50; n += 1) assert.match(D.sayfaKimligiUret(['saaaaa']), D.SAYFA_KIMLIGI_DESENI);
});

test('sayfaEkle: ad kırpılır; geçersiz / yinelenen kimlik ve 12 sayfa sınırı değişiklik yapmaz', () => {
  let liste = D.sayfaEkle([], '   Oturma   odası  ', 'abc');
  assert.deepEqual(liste, [S('abc', 'Oturma odası')]);
  assert.equal(D.sayfaEkle(liste, 'X', 'abc').length, 1, 'aynı kimlik');
  assert.equal(D.sayfaEkle(liste, 'X', 'A!').length, 1, 'geçersiz kimlik');
  assert.equal(D.sayfaEkle(liste, 'X', 5).length, 1);
  assert.equal(D.sayfaEkle(liste, 'x'.repeat(100), 'zzz')[1].ad.length, D.SAYFA_AD_SINIRI);
  liste = [];
  for (let n = 0; n < D.EN_COK_SAYFA + 3; n += 1) liste = D.sayfaEkle(liste, `S${n}`, `sa${String(n).padStart(2, '0')}`);
  assert.equal(liste.length, D.EN_COK_SAYFA);
  assert.deepEqual(D.sayfaEkle(null, 'a', 'abc'), [S('abc', 'a')], 'bozuk girdi çökmez');
});

test('sayfayiAdlandir: yalnız o sayfa; olmayan sayfa değişiklik yapmaz', () => {
  const yeni = D.sayfayiAdlandir(ornek(), 'bbb', '  Gece ');
  assert.deepEqual(yeni.map((s) => s.ad), ['Işıklar', 'Gece']);
  assert.deepEqual(D.sayfayiAdlandir(ornek(), 'yok', 'X'), ornek());
});

test('sayfayiCogalt: dizi kopyası özgün sayfanın hemen arkasına girer; adı ek alır; kopya bağımsızdır', () => {
  const { sayfalar, yeniId } = D.sayfayiCogalt(ornek(), 'aaa', 'kkk', 'kopya');
  assert.equal(yeniId, 'kkk');
  assert.deepEqual(sayfalar.map((s) => s.id), ['aaa', 'kkk', 'bbb']);
  assert.equal(sayfalar[1].ad, 'Işıklar kopya');
  assert.deepEqual(sayfalar[1].varliklar, ['light.a', 'light.b']);
  sayfalar[1].varliklar.push('light.c');
  assert.deepEqual(sayfalar[0].varliklar, ['light.a', 'light.b'], 'kopya özgünü etkilemez');
  // uzun ad: ek sığacak biçimde özgün ad kısalır, toplam sınırı aşmaz
  const uzun = [S('aaa', 'a'.repeat(D.SAYFA_AD_SINIRI), 'light.a')];
  const c = D.sayfayiCogalt(uzun, 'aaa', 'kkk', 'kopya');
  assert.ok(Array.from(c.sayfalar[1].ad).length <= D.SAYFA_AD_SINIRI);
  assert.ok(c.sayfalar[1].ad.endsWith('kopya'));
  // geçersizler
  assert.equal(D.sayfayiCogalt(ornek(), 'yok', 'kkk', 'k').yeniId, null);
  assert.equal(D.sayfayiCogalt(ornek(), 'aaa', 'bbb', 'k').yeniId, null, 'kimlik kullanımda');
  assert.equal(D.sayfayiCogalt(ornek(), 'aaa', 'A!', 'k').yeniId, null);
  let dolu = [];
  for (let n = 0; n < D.EN_COK_SAYFA; n += 1) dolu = D.sayfaEkle(dolu, `S${n}`, `sa${String(n).padStart(2, '0')}`);
  assert.equal(D.sayfayiCogalt(dolu, 'sa00', 'zzz', 'k').yeniId, null, 'sınır dolu');
  assert.equal(D.sayfayiCogalt(ornek(), 'aaa', 'kkk', '').sayfalar[1].ad, 'Işıklar', 'ek boşsa ad aynı');
});

test('sayfayiSil: yalnız o sayfa kalkar', () => {
  assert.deepEqual(D.sayfayiSil(ornek(), 'aaa').map((s) => s.id), ['bbb']);
  assert.deepEqual(D.sayfayiSil(ornek(), 'yok').map((s) => s.id), ['aaa', 'bbb']);
});

test('sayfayiTasi / sayfayiKonumaTasi: kenarlarda kırpılır, sıra korunur', () => {
  const sira = (l) => l.map((s) => s.id).join();
  const uc = [...ornek(), S('ccc', 'C')];
  assert.equal(sira(D.sayfayiTasi(uc, 'ccc', -1)), 'aaa,ccc,bbb');
  assert.equal(sira(D.sayfayiTasi(uc, 'aaa', -1)), 'aaa,bbb,ccc', 'başta yukarı: değişmez');
  assert.equal(sira(D.sayfayiTasi(uc, 'ccc', 1)), 'aaa,bbb,ccc', 'sonda aşağı: değişmez');
  assert.equal(sira(D.sayfayiTasi(uc, 'aaa', 1)), 'bbb,aaa,ccc');
  assert.equal(sira(D.sayfayiTasi(uc, 'aaa', 0)), 'aaa,bbb,ccc');
  assert.equal(sira(D.sayfayiKonumaTasi(uc, 'aaa', 2)), 'bbb,ccc,aaa');
  assert.equal(sira(D.sayfayiKonumaTasi(uc, 'ccc', 0)), 'ccc,aaa,bbb');
  assert.equal(sira(D.sayfayiKonumaTasi(uc, 'aaa', 99)), 'bbb,ccc,aaa', 'sınıra kırpılır');
  assert.equal(sira(D.sayfayiKonumaTasi(uc, 'aaa', 'x')), 'aaa,bbb,ccc');
  assert.equal(sira(D.sayfayiKonumaTasi(uc, 'yok', 1)), 'aaa,bbb,ccc');
});

test('konumaTasi / yondeTasi: genel dizi taşıma', () => {
  assert.deepEqual(D.konumaTasi(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(D.konumaTasi(['a', 'b', 'c', 'd'], 'd', -5), ['d', 'a', 'b', 'c']);
  assert.deepEqual(D.konumaTasi(['a', 'b'], 'z', 0), ['a', 'b']);
  assert.deepEqual(D.konumaTasi(null, 'z', 0), []);
  assert.deepEqual(D.yondeTasi(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(D.yondeTasi(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(D.yondeTasi(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(D.yondeTasi(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(D.yondeTasi(['a', 'b', 'c'], 'b', 0), ['a', 'b', 'c']);
});

test('varlikEkle / varlikCikar / varlikTasi: yinelenen eklenmez, 100 varlık sınırı, sayfa sırası bağımsız', () => {
  let l = D.varlikEkle(ornek(), 'aaa', 'light.c');
  assert.deepEqual(l[0].varliklar, ['light.a', 'light.b', 'light.c']);
  l = D.varlikEkle(l, 'aaa', 'light.c');
  assert.equal(l[0].varliklar.length, 3);
  assert.deepEqual(D.varlikEkle(ornek(), 'yok', 'light.c'), ornek());
  assert.deepEqual(D.varlikEkle(ornek(), 'aaa', 5), ornek());
  assert.deepEqual(D.varlikCikar(l, 'aaa', 'light.a')[0].varliklar, ['light.b', 'light.c']);
  assert.deepEqual(D.varlikTasi(l, 'aaa', 'light.c', { yon: -1 })[0].varliklar, ['light.a', 'light.c', 'light.b']);
  assert.deepEqual(D.varlikTasi(l, 'aaa', 'light.a', { hedef: 2 })[0].varliklar, ['light.b', 'light.c', 'light.a']);
  assert.deepEqual(D.varlikTasi(l, 'yok', 'light.a', { yon: 1 }), l);
  let dolu = [S('aaa', 'A')];
  for (let n = 0; n < D.EN_COK_SAYFA_VARLIGI + 5; n += 1) dolu = D.varlikEkle(dolu, 'aaa', `light.l${n}`);
  assert.equal(dolu[0].varliklar.length, D.EN_COK_SAYFA_VARLIGI);
});

test('kimlikDegistir (onarım): sırayı korur; yeni kimlik zaten sayfadaysa eskisi yalnız çıkar; tumundenCikar: bütün sayfalardan', () => {
  const l = [S('aaa', 'A', 'light.a', 'light.b', 'light.c'), S('bbb', 'B', 'light.z'), S('ccc', 'C', 'light.a', 'light.b')];
  const d = D.kimlikDegistir(l, 'light.a', 'light.b');
  assert.deepEqual(d[0].varliklar, ['light.b', 'light.c'], 'yeni zaten vardı: eski düşer');
  assert.deepEqual(d[2].varliklar, ['light.b']);
  const e = D.kimlikDegistir(l, 'light.b', 'light.y');
  assert.deepEqual(e[0].varliklar, ['light.a', 'light.y', 'light.c'], 'aynı sırada değişir');
  assert.deepEqual(e[1].varliklar, ['light.z'], 'ilgisiz sayfa değişmez');
  assert.deepEqual(D.tumundenCikar(l, 'light.a').map((s) => s.varliklar), [['light.b', 'light.c'], ['light.z'], ['light.b']]);
  assert.deepEqual(D.varlikSayfalari(l, 'light.a'), ['aaa', 'ccc']);
});

test('bozuk girdiler çökmez', () => {
  for (const kotu of [null, undefined, 'x', 5, {}, [null], [{}], [{ id: 'aaa' }]]) {
    assert.ok(Array.isArray(D.sayfayiSil(kotu, 'aaa')));
    assert.ok(Array.isArray(D.sayfayiAdlandir(kotu, 'aaa', 'x')));
    assert.ok(Array.isArray(D.varlikEkle(kotu, 'aaa', 'light.a')));
    assert.ok(Array.isArray(D.sayfayiTasi(kotu, 'aaa', 1)));
  }
});

test('renderer kopyası: require yok; window.EvDuzenIslemleri aynı işlevleri verir', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'duzen-islemleri.js'), 'utf8');
  assert.doesNotMatch(kaynak, /require\s*\(/);
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(kaynak, sandbox);
  const R = sandbox.EvDuzenIslemleri;
  assert.ok(R);
  assert.equal(JSON.stringify(R.sayfayiSil(ornek(), 'aaa')), JSON.stringify(D.sayfayiSil(ornek(), 'aaa')));
  assert.equal(R.EN_COK_SAYFA, D.EN_COK_SAYFA);
});
