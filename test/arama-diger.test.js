'use strict';

/**
 * Palet "*" öneki (o-46, src/lib/arama.js digerSorgusu + digerSatirlari): favori olmayan güvenli cihazlar için önek çözümlemesi, alan süzgeci
 * ve ad/oda süzme. Liste ana süreçten gelir; burada yalnız çözümleme ve süzme sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { digerSorgusu, digerSatirlari, degisenSorgusu, paletSorgusu, DIGER_ALANLARI } = require('../src/lib/arama');

const LISTE = [
  { kimlik: 'light.mutfak', ad: 'Mutfak lambası', alan: 'light', durum: 'acik', oda: 'Mutfak' },
  { kimlik: 'light.bahce', ad: 'Bahçe lambası', alan: 'light', durum: 'kapali' },
  { kimlik: 'switch.sulama', ad: 'Sulama prizi', alan: 'switch', durum: 'kapali', oda: 'Bahçe' },
  { kimlik: 'fan.balkon', ad: 'Balkon vantilatörü', alan: 'fan', durum: 'kapali' },
  { kimlik: 'scene.sinema', ad: 'Sinema', alan: 'scene', durum: 'notr', oda: 'Salon' },
  { kimlik: 'input_boolean.misafir', ad: 'Misafir modu', alan: 'input_boolean', durum: 'kapali' },
];

const kimlikler = (satirlar) => satirlar.map((r) => r.diger.kimlik);

test('digerSorgusu: "*" ile başlayan sorgu çözülür; başında boşluk olabilir; "*" ortada ya da sonda önek değildir', () => {
  assert.deepEqual(digerSorgusu('*'), { alan: null, metin: '' });
  assert.deepEqual(digerSorgusu('*salon'), { alan: null, metin: 'salon' });
  assert.deepEqual(digerSorgusu('  *  salon lamba  '), { alan: null, metin: 'salon lamba' });
  assert.deepEqual(digerSorgusu('**'), { alan: null, metin: '*' });
  for (const degil of ['salon', 'salon *', 's*lon', '', '   ', undefined, null, 5, '@salon', '#']) assert.equal(digerSorgusu(degil), null, JSON.stringify(degil));
});

test('digerSorgusu: ilk ya da son sözcük alan süzgeci olabilir (Türkçe katlama); tek sözcük ad olarak kalmaz, süzgeç olur', () => {
  assert.deepEqual(digerSorgusu('*ışık'), { alan: 'light', metin: '' });
  assert.deepEqual(digerSorgusu('*ISIK mutfak'), { alan: 'light', metin: 'mutfak' });
  assert.deepEqual(digerSorgusu('*mutfak ışık'), { alan: 'light', metin: 'mutfak' });
  assert.deepEqual(digerSorgusu('*priz'), { alan: 'switch', metin: '' });
  assert.deepEqual(digerSorgusu('*sahne'), { alan: 'scene', metin: '' });
  assert.deepEqual(digerSorgusu('*vantilatör'), { alan: 'fan', metin: '' });
  assert.deepEqual(digerSorgusu('*sanal'), { alan: 'input_boolean', metin: '' });
  assert.deepEqual(digerSorgusu('*nem'), { alan: 'humidifier', metin: '' });
  assert.deepEqual(digerSorgusu('*light'), { alan: 'light', metin: '' });
  assert.deepEqual(digerSorgusu('*salon sahne'), { alan: 'scene', metin: 'salon' });
  assert.deepEqual(digerSorgusu('*salon lambası'), { alan: null, metin: 'salon lambası' }, 'alan sözü olmayan metin süzgeç değildir');
  assert.deepEqual(digerSorgusu('*salon ışık x'), { alan: null, metin: 'salon ışık x' }, 'ortadaki alan sözü süzgeç olmaz');
});

test('digerSorgusu çıktısındaki alanlar yalnız aç-kapa alanlarıdır (kilit, perde, script, düğme... asla)', () => {
  const alanlar = new Set();
  for (const soz of ['isik', 'light', 'lights', 'priz', 'prize', 'switch', 'plug', 'sahne', 'scene', 'fan', 'vantilator', 'yardimci', 'sanal', 'helper', 'nem', 'humidifier', 'kilit', 'lock', 'perde', 'cover', 'script', 'kapi', 'alarm']) {
    const c = digerSorgusu(`*${soz}`);
    if (c.alan) alanlar.add(c.alan);
  }
  assert.deepEqual([...alanlar].sort(), [...DIGER_ALANLARI].sort());
  for (const soz of ['kilit', 'lock', 'perde', 'cover', 'script', 'kapi', 'alarm']) assert.equal(digerSorgusu(`*${soz}`).alan, null, soz);
});

test('"*" öneki "@" ile ve normal arama ile çakışmaz', () => {
  assert.equal(degisenSorgusu('*salon'), null);
  assert.equal(digerSorgusu('@salon'), null);
  assert.ok(paletSorgusu('salon', []).sonuclar !== undefined);
});

test('digerSatirlari: boş süzgeç listeyi kendi sırasıyla verir; ad Türkçe katlamayla eşlenir; oda adı da aranır', () => {
  assert.deepEqual(kimlikler(digerSatirlari({ alan: null, metin: '' }, LISTE)), LISTE.map((d) => d.kimlik));
  assert.deepEqual(kimlikler(digerSatirlari({ alan: null, metin: 'mutfak' }, LISTE)), ['light.mutfak']);
  assert.deepEqual(kimlikler(digerSatirlari({ alan: null, metin: 'LAMBASI' }, LISTE)).sort(), ['light.bahce', 'light.mutfak']);
  assert.deepEqual(kimlikler(digerSatirlari({ alan: null, metin: 'lambasi' }, LISTE)).sort(), ['light.bahce', 'light.mutfak'], 'ı -> i');
  assert.ok(kimlikler(digerSatirlari({ alan: null, metin: 'bahce' }, LISTE)).includes('switch.sulama'), 'oda adı (Bahçe) ile bulunur');
  assert.deepEqual(digerSatirlari({ alan: null, metin: 'yokboyle' }, LISTE), []);
  const s = digerSatirlari({ alan: null, metin: 'sin' }, LISTE)[0];
  assert.equal(s.diger.kimlik, 'scene.sinema');
  assert.deepEqual(s.konumlar, [0, 1, 2], 'vurgulanacak harf konumları');
  assert.equal(s.diger, LISTE[4], 'öğe olduğu gibi döner');
});

test('digerSatirlari: alan süzgeci yalnız o alandaki cihazları bırakır', () => {
  assert.deepEqual(kimlikler(digerSatirlari({ alan: 'light', metin: '' }, LISTE)), ['light.mutfak', 'light.bahce']);
  assert.deepEqual(kimlikler(digerSatirlari({ alan: 'scene', metin: '' }, LISTE)), ['scene.sinema']);
  assert.deepEqual(kimlikler(digerSatirlari({ alan: 'light', metin: 'bahce' }, LISTE)), ['light.bahce']);
  assert.deepEqual(digerSatirlari({ alan: 'humidifier', metin: '' }, LISTE), []);
});

test('digerSatirlari: bozuk girdi çökertmez; adı olmayan ya da nesne olmayan öğeler atlanır', () => {
  for (const kotu of [undefined, null, 'x', 5, {}, [null, 5, 'x', {}, { ad: 5 }]]) assert.deepEqual(digerSatirlari({ alan: null, metin: 'a' }, kotu), [], JSON.stringify(kotu));
  assert.deepEqual(digerSatirlari(null, [{ ad: 'A', alan: 'light' }]).map((r) => r.diger.ad), ['A']);
  assert.deepEqual(digerSatirlari({ alan: 5, metin: 5 }, [{ ad: 'A', alan: 'light' }]).length, 1, 'geçersiz alan/metin süzgeç sayılmaz');
});
