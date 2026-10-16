'use strict';

/**
 * Favori kaydında karo görünümü (simge, renk, boyut; o-31) ve tepsiye sabitleme (tepsi; o-16): kayıt, doğrulama, birleştirme, aktarma,
 * yüzey modeli ve tepsi menüsü. Geçersiz ya da kapı-kilit temalı değer kayda hiç girmez; sır / ham değer sayfaya gitmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { favorileriDuzelt, favorileriBirlestir } = require('../src/lib/favoriler');
const { karoOlustur, yuzeyModeliOlustur, RENDERER_KARO_ALANLARI, rendererModeli } = require('../src/lib/yuzey-modeli');
const { tepsiMenuPlani } = require('../src/lib/tepsi-menu');
const { ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');

const guvenli = (...cift) => new Map(cift);
const birlestir = (mevcut, secilen, ek = {}) =>
  favorileriBirlestir({
    mevcut,
    secilen,
    guvenliListe: ek.guvenliListe ?? guvenli(['light.a', 'A'], ['light.b', 'B'], ['switch.priz', 'Priz'], ['button.pc_bilgisayari_kapat', 'PC kapat']),
    tumKimlikler: ek.tumKimlikler ?? new Set(['light.a', 'light.b', 'switch.priz', 'button.pc_bilgisayari_kapat']),
  });

test('favorileriDuzelt: geçerli simge, renk, boyut ve tepsi korunur; geçersizler sessizce atılır', () => {
  const { favoriler } = favorileriDuzelt([
    { entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true },
    { entity_id: 'light.b', ad: 'B', simge: 'ikon:isik', renk: 'mor', boyut: 'normal', tepsi: false },
    { entity_id: 'switch.priz', ad: 'Priz', simge: 'abc', renk: '#ff0000', boyut: 'dev', tepsi: 'evet' },
    { entity_id: 'scene.film', ad: 'Film', simge: '', renk: '', boyut: '' },
  ]);
  assert.deepEqual(favoriler, [
    { entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true },
    { entity_id: 'light.b', ad: 'B', simge: 'ikon:isik', renk: 'mor' },
    { entity_id: 'switch.priz', ad: 'Priz' },
    { entity_id: 'scene.film', ad: 'Film' },
  ]);
});

test('KAPI KURALI: kapı / kilit / siren emojisi simge olarak kayda girmez', () => {
  const { favoriler } = favorileriDuzelt([{ entity_id: 'light.a', ad: 'A', simge: '🔒' }, { entity_id: 'light.b', ad: 'B', simge: '🚪' }, { entity_id: 'switch.priz', ad: 'Priz', simge: '🚨' }]);
  assert.deepEqual(favoriler.map((f) => 'simge' in f), [false, false, false]);
});

test('favorileriBirlestir: görünüm alanları yükten gelir; yükte olmayan alan kayıttan korunur; "" temizler; "normal" boyutu varsayılana döndürür', () => {
  const mevcut = [{ entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true }];
  const korunan = birlestir(mevcut, [{ entity_id: 'light.a' }]);
  assert.deepEqual(korunan.yeni, mevcut, 'yükte olmayan alanlar korunur');
  assert.deepEqual(korunan.gorunumHatalari, []);
  const degisen = birlestir(mevcut, [{ entity_id: 'light.a', simge: 'ikon:ev', renk: 'yesil', boyut: 'buyuk', tepsi: false }]);
  assert.deepEqual(degisen.yeni, [{ entity_id: 'light.a', ad: 'A', simge: 'ikon:ev', renk: 'yesil', boyut: 'buyuk' }]);
  const temiz = birlestir(mevcut, [{ entity_id: 'light.a', simge: '', renk: '', boyut: 'normal' }]);
  assert.deepEqual(temiz.yeni, [{ entity_id: 'light.a', ad: 'A', tepsi: true }]);
  assert.deepEqual(temiz.gorunumHatalari, []);
});

test('favorileriBirlestir: geçersiz istek bildirilir ve ÖNCEKİ değer korunur; yeni favoride değer hiç yazılmaz', () => {
  const mevcut = [{ entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis' }];
  const r = birlestir(mevcut, [{ entity_id: 'light.a', simge: '🔒', renk: 'turuncu-koyu', boyut: 'dev' }, { entity_id: 'light.b', simge: '🚪', renk: 'kirmizi' }]);
  assert.deepEqual(r.gorunumHatalari, [
    { entity_id: 'light.a', alan: 'simge' },
    { entity_id: 'light.a', alan: 'renk' },
    { entity_id: 'light.a', alan: 'boyut' },
    { entity_id: 'light.b', alan: 'simge' },
  ]);
  assert.deepEqual(r.yeni[0], { entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis' }, 'önceki değerler duruyor');
  assert.deepEqual(r.yeni[1], { entity_id: 'light.b', ad: 'B', renk: 'kirmizi' }, 'yasak simge yazılmadı, geçerli renk yazıldı');
});

test('favorileriBirlestir: kayıtlı ama HA\'da olmayan favori de görünümünü korur', () => {
  const mevcut = [{ entity_id: 'light.eski', ad: 'Eski', simge: '⭐', renk: 'sari', boyut: 'kucuk', tepsi: true }];
  const r = birlestir(mevcut, ['light.eski'], { guvenliListe: guvenli(), tumKimlikler: new Set() });
  assert.deepEqual(r.eksik, ['light.eski']);
  assert.deepEqual(r.yeni, mevcut);
});

test('ayar yedeği: görünüm, tepsi alanları ve sayfalar dışa / içe aktarılır (round-trip); bilinmeyen alan ve sır alınmaz', () => {
  const ayarlar = {
    favoriler: [{ entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true, gizli: 'x', token: 'y' }, { entity_id: 'switch.priz', ad: 'Priz', simge: '🔒' }],
    sayfalar: [{ id: 'abc', ad: 'Akşam', varliklar: ['light.a', 'lock.on_kapi'] }],
  };
  const dis = ayarlariDisaAktar(ayarlar);
  assert.equal(dis.ok, true);
  const dosya = JSON.parse(dis.metin);
  assert.deepEqual(dosya.ayarlar.favoriler[0], { entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true });
  assert.deepEqual(dosya.ayarlar.sayfalar, ayarlar.sayfalar, 'sayfalar dışa aktarma tablosundadır');
  assert.doesNotMatch(dis.metin, /"token"|"gizli"/);
  const ice = ayarYedeginiCoz(dosya);
  assert.equal(ice.ok, true);
  assert.deepEqual(ice.ayarlar.favoriler, [{ entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true }, { entity_id: 'switch.priz', ad: 'Priz' }], 'yasak simge içe aktarmada atılır');
  assert.deepEqual(ice.ayarlar.sayfalar, [{ id: 'abc', ad: 'Akşam', varliklar: ['light.a'] }], 'sayfadaki kilit varlığı içe aktarmada atılır');
});

test('karoOlustur: görünüm alanları kayıttan YENİDEN doğrulanır; geçersiz değer karoda varsayılandır', () => {
  const varlik = { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'A' } };
  const k = karoOlustur({ entity_id: 'light.a', ad: 'A', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true }, varlik);
  assert.deepEqual([k.simge, k.renk, k.boyut, k.tepsi], ['💡', 'mavi', 'genis', true]);
  const bozuk = karoOlustur({ entity_id: 'light.a', ad: 'A', simge: '🔒', renk: 'javascript:x', boyut: 'span 9', tepsi: 'evet' }, varlik);
  assert.deepEqual([bozuk.simge, bozuk.renk, bozuk.boyut, bozuk.tepsi], [null, null, 'normal', false]);
  const bos = karoOlustur({ entity_id: 'light.a', ad: 'A' }, varlik);
  assert.deepEqual([bos.simge, bos.renk, bos.boyut, bos.tepsi], [null, null, 'normal', false]);
  for (const alan of ['simge', 'renk', 'boyut', 'tepsi']) assert.ok(RENDERER_KARO_ALANLARI.includes(alan));
});

test('rendererModeli: görünüm alanları renderer\'a gider, favori kaydındaki diğer alanlar (kısayol, etiket ham hâli) gitmez', () => {
  const m = yuzeyModeliOlustur({ favoriler: [{ entity_id: 'light.a', ad: 'A', kisayol: 'Control+Alt+1', simge: '💡', renk: 'mavi', boyut: 'buyuk' }], durumAl: () => undefined });
  const r = rendererModeli(m);
  const karo = r.gruplar[0].karolar[0];
  assert.deepEqual([karo.simge, karo.renk, karo.boyut], ['💡', 'mavi', 'buyuk']);
  assert.ok(!JSON.stringify(r).includes('Control+Alt'));
});

test('tepsi menüsü: tepsi:true zararsız favoriler üst düzeyde ÖNCE gelir (kendi içinde favori sırasıyla); yıkıcı karo sabitlense bile "Onaylı" altında kalır', () => {
  const favoriler = [
    { entity_id: 'light.a', ad: 'A' },
    { entity_id: 'light.b', ad: 'B' },
    { entity_id: 'switch.priz', ad: 'Priz', tepsi: true },
    { entity_id: 'light.c', ad: 'C', tepsi: true },
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat', tepsi: true },
  ];
  const karolar = yuzeyModeliOlustur({ favoriler, durumAl: () => undefined }).gruplar.flatMap((g) => g.karolar);
  const plan = tepsiMenuPlani(karolar, { ustSayi: 2 });
  assert.deepEqual(plan.ust.map((o) => o.kimlik).sort(), ['light.c', 'switch.priz']);
  assert.deepEqual(plan.alt.map((o) => o.kimlik).sort(), ['light.a', 'light.b']);
  assert.deepEqual(plan.yikici.map((o) => o.kimlik), ['button.pc_bilgisayari_kapat']);
});
