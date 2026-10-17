'use strict';

/**
 * Sensör favorisinin gösterge aralığı (gostergeMin, gostergeMax) ve grafik biçimi (grafikTuru) — 1.4.0.
 * Doğrulama src/lib/karo-gorunum.js'te; kayıt favoriler.js, model yuzey-modeli.js, yedek ayar-yedegi.js / yedek-kurtarma.js.
 * Ağ ve Electron yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { gostergeAraligiDuzelt, grafikTuruDuzelt, GRAFIK_TURLERI } = require('../src/lib/karo-gorunum');
const { favoriOlustur, favorileriDuzelt, favorileriBirlestir } = require('../src/lib/favoriler');
const { karoOlustur, rendererModeli } = require('../src/lib/yuzey-modeli');
const { ayarlariDisaAktar, ayarYedeginiCoz } = require('../src/lib/ayar-yedegi');
const { YENI_FAVORI_ALANLARI } = require('../src/lib/yedek-kurtarma');

const SENSOR = { entity_id: 'sensor.guc', state: '350', attributes: { friendly_name: 'Güç', unit_of_measurement: 'W', min_value: 0, max_value: 1000 } };

test('gostergeAraligiDuzelt: ikisi de sonlu sayı ve alt < üst olmalı; tek sınır, ters / eşit aralık, sayı olmayan ve dev değer reddedilir', () => {
  assert.deepEqual(gostergeAraligiDuzelt(0, 100), { gostergeMin: 0, gostergeMax: 100 });
  assert.deepEqual(gostergeAraligiDuzelt(-20.5, 40), { gostergeMin: -20.5, gostergeMax: 40 });
  assert.deepEqual(gostergeAraligiDuzelt(-1e9, 1e9), { gostergeMin: -1e9, gostergeMax: 1e9 });
  for (const [a, u] of [[0, 0], [10, 5], [0, undefined], [undefined, 5], [null, null], ['0', '100'], [NaN, 5], [0, Infinity], [-Infinity, 0], [0, 1e9 + 1], [-1e9 - 1, 0], [true, 5], [[0], [5]]]) {
    assert.equal(gostergeAraligiDuzelt(a, u), null, `${String(a)} ${String(u)}`);
  }
});

test('grafikTuruDuzelt: kapalı liste; boş ya da "otomatik" varsayılan; bilinmeyen null', () => {
  assert.deepEqual([...GRAFIK_TURLERI], ['otomatik', 'cizgi', 'gosterge', 'yok']);
  assert.deepEqual(['', 'otomatik', 'cizgi', 'gosterge', 'yok', ' yok '].map(grafikTuruDuzelt), ['otomatik', 'otomatik', 'cizgi', 'gosterge', 'yok', 'yok']);
  for (const kotu of ['dev', 'Cizgi', 5, null, undefined, {}]) assert.equal(grafikTuruDuzelt(kotu), null, String(kotu));
});

test('favoriOlustur: gösterge aralığı ve grafik biçimi yalnız sensör favorisinde saklanır; "otomatik" kayda yazılmaz', () => {
  assert.deepEqual(favoriOlustur('sensor.guc', 'Güç', { gostergeMin: 0, gostergeMax: 500, grafikTuru: 'gosterge' }), {
    entity_id: 'sensor.guc',
    ad: 'Güç',
    gostergeMin: 0,
    gostergeMax: 500,
    grafikTuru: 'gosterge',
  });
  assert.deepEqual(favoriOlustur('sensor.guc', 'Güç', { grafikTuru: 'otomatik' }), { entity_id: 'sensor.guc', ad: 'Güç' });
  assert.deepEqual(favoriOlustur('sensor.guc', 'Güç', { gostergeMin: 5, gostergeMax: 5, grafikTuru: 'dev' }), { entity_id: 'sensor.guc', ad: 'Güç' }, 'eşit aralık ve bilinmeyen biçim atılır');
  assert.deepEqual(favoriOlustur('sensor.guc', 'Güç', { gostergeMin: 0 }), { entity_id: 'sensor.guc', ad: 'Güç' }, 'tek sınır saklanmaz');
  // sensör olmayan alanlarda alanlar yok sayılır
  for (const kimlik of ['light.a', 'binary_sensor.hareket', 'climate.salon']) {
    assert.deepEqual(favoriOlustur(kimlik, 'X', { gostergeMin: 0, gostergeMax: 5, grafikTuru: 'yok' }), { entity_id: kimlik, ad: 'X' }, kimlik);
  }
});

test('favorileriDuzelt: ayar dosyasındaki geçersiz gösterge değerleri sessizce atılır, geçerli olanlar korunur', () => {
  const { favoriler, atilanlar } = favorileriDuzelt([
    { entity_id: 'sensor.a', ad: 'A', gostergeMin: 10, gostergeMax: 90, grafikTuru: 'cizgi' },
    { entity_id: 'sensor.b', ad: 'B', gostergeMin: '10', gostergeMax: '90', grafikTuru: 'x' },
    { entity_id: 'sensor.c', ad: 'C', gostergeMin: 90, gostergeMax: 10 },
  ]);
  assert.deepEqual(atilanlar, []);
  assert.deepEqual(favoriler, [
    { entity_id: 'sensor.a', ad: 'A', gostergeMin: 10, gostergeMax: 90, grafikTuru: 'cizgi' },
    { entity_id: 'sensor.b', ad: 'B' },
    { entity_id: 'sensor.c', ad: 'C' },
  ]);
});

const birlestir = (mevcut, secilen) =>
  favorileriBirlestir({ mevcut, secilen, guvenliListe: new Map([['sensor.guc', 'Güç'], ['light.a', 'A']]), tumKimlikler: new Set(['sensor.guc', 'light.a']) });

test('favorileriBirlestir: yükte olmayan gösterge alanları kayıttan korunur; aralık ÇİFT olarak güncellenir; null temizler; geçersiz çift kaydı siler', () => {
  const mevcut = [{ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 0, gostergeMax: 500, grafikTuru: 'gosterge' }];
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc' }]).yeni, mevcut, 'yükte olmayan alanlar korunur');
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', grafikTuru: 'cizgi' }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 0, gostergeMax: 500, grafikTuru: 'cizgi' }]);
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', grafikTuru: 'otomatik' }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 0, gostergeMax: 500 }]);
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', gostergeMin: 10, gostergeMax: 20 }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 10, gostergeMax: 20, grafikTuru: 'gosterge' }]);
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', gostergeMin: null, gostergeMax: null }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', grafikTuru: 'gosterge' }], 'null aralığı temizler');
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', gostergeMin: 50 }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', grafikTuru: 'gosterge' }], 'yarım çift saklanmaz');
  assert.deepEqual(birlestir(mevcut, [{ entity_id: 'sensor.guc', gostergeMin: 90, gostergeMax: 10 }]).yeni, [{ entity_id: 'sensor.guc', ad: 'Güç', grafikTuru: 'gosterge' }], 'ters aralık saklanmaz');
  // yeni favoride başka alanlarda yok sayılır
  assert.deepEqual(birlestir([], [{ entity_id: 'light.a', gostergeMin: 0, gostergeMax: 5, grafikTuru: 'yok' }]).yeni, [{ entity_id: 'light.a', ad: 'A' }]);
});

test('karoOlustur: favorideki gösterge aralığı sensörün kendi min/max özniteliğinden önce gelir; geçersiz aralık yok sayılır', () => {
  const kendi = karoOlustur({ entity_id: 'sensor.guc', ad: 'Güç' }, SENSOR);
  assert.deepEqual([kendi.ozellik.enAz, kendi.ozellik.enCok, kendi.grafikTuru], [0, 1000, 'otomatik']);
  const kullanici = karoOlustur({ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 100, gostergeMax: 400, grafikTuru: 'gosterge' }, SENSOR);
  assert.deepEqual([kullanici.ozellik.enAz, kullanici.ozellik.enCok, kullanici.grafikTuru], [100, 400, 'gosterge']);
  const bozuk = karoOlustur({ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 400, gostergeMax: 100, grafikTuru: 'dev' }, SENSOR);
  assert.deepEqual([bozuk.ozellik.enAz, bozuk.ozellik.enCok, bozuk.grafikTuru], [0, 1000, 'otomatik'], 'kayıt elle bozulsa da model doğrular');
  // aralığı bilinmeyen sensöre kullanıcı aralığı verilebilir; canlı durum yoksa özellik null kalır
  const aralıksız = { entity_id: 'sensor.sicaklik', state: '21', attributes: { friendly_name: 'Sıcaklık', unit_of_measurement: '°C' } };
  assert.equal(karoOlustur({ entity_id: 'sensor.sicaklik', ad: 'Sıcaklık' }, aralıksız).ozellik.enAz, null);
  assert.deepEqual([10, 30], ((o) => [o.enAz, o.enCok])(karoOlustur({ entity_id: 'sensor.sicaklik', ad: 'Sıcaklık', gostergeMin: 10, gostergeMax: 30 }, aralıksız).ozellik));
  assert.equal(karoOlustur({ entity_id: 'sensor.sicaklik', ad: 'Sıcaklık', gostergeMin: 10, gostergeMax: 30 }, null).ozellik, null);
  // sensör olmayan karoda biçim her zaman otomatik
  assert.equal(karoOlustur({ entity_id: 'light.a', ad: 'A', grafikTuru: 'yok' }, { entity_id: 'light.a', state: 'on', attributes: {} }).grafikTuru, 'otomatik');
});

test('rendererModeli: grafikTuru renderer karosunda var, gösterge aralığı ayrı alan olarak GİTMEZ (ozellik içinde)', () => {
  const karo = karoOlustur({ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 1, gostergeMax: 2, grafikTuru: 'cizgi' }, SENSOR);
  const model = rendererModeli({ gruplar: [{ kod: 'sensor', etiket: 'Sensör', karolar: [karo] }] });
  const gelen = model.gruplar[0].karolar[0];
  assert.equal(gelen.grafikTuru, 'cizgi');
  assert.equal('gostergeMin' in gelen, false);
  assert.equal('gostergeMax' in gelen, false);
});

test('ayar yedeği: gösterge alanları dışa aktarılır, içe aktarılırken yeniden doğrulanır; yedek kurtarma bu alanları tanır', () => {
  assert.ok(['gostergeMin', 'gostergeMax', 'grafikTuru'].every((a) => YENI_FAVORI_ALANLARI.includes(a)));
  const ayarlar = { favoriler: [{ entity_id: 'sensor.guc', ad: 'Güç', gostergeMin: 0, gostergeMax: 500, grafikTuru: 'gosterge', gizliAlan: 'x' }] };
  const dosya = ayarlariDisaAktar(ayarlar, { simdi: new Date(0) });
  assert.equal(dosya.ok, true);
  assert.match(dosya.metin, /gostergeMin/);
  assert.doesNotMatch(dosya.metin, /gizliAlan/);
  const cozulmus = ayarYedeginiCoz(JSON.parse(dosya.metin));
  assert.equal(cozulmus.ok, true);
  const f = favorileriDuzelt(cozulmus.ayarlar.favoriler).favoriler[0];
  assert.deepEqual([f.gostergeMin, f.gostergeMax, f.grafikTuru], [0, 500, 'gosterge']);
});
