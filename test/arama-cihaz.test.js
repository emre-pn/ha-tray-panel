'use strict';

/**
 * 1.4.0 cihaz grubu palet komutları (src/lib/arama.js alanKomutu / paletSorgusu): perde ("salon perde 40", "perde ac", "perde dur"),
 * vana ("su vanasi kapat"), otomasyon ("gece modu calistir"). Komut yalnız bir öneridir; asıl doğrulama ana süreçteki eylem hattındadır
 * (test/cihaz-eylem-hatti.test.js): vana ve otomasyon komutları orada ZORUNLU onaylıdır (palette Enter basılı tutulur).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { alanKomutu, katlaDizi, komutluAlanMi, paletSorgusu } = require('../src/lib/arama');
const { servisDogrula } = require('../src/lib/servis-izinleri');

const kat = (m) => katlaDizi(m).join('');
const komutu = (oge, kuyruk) => alanKomutu(oge, kat(kuyruk));

const PERDE = { etiket: 'Salon perde', alan: 'cover', ozellik: { durum: 'open', konum: 40, sinif: 'curtain', destek: 15 } };
const PERDE_KONUMSUZ = { etiket: 'Mutfak jaluzi', alan: 'cover', ozellik: { durum: 'open', konum: null, sinif: 'blind', destek: 3 } };
const PERDE_BILINMEYEN = { etiket: 'Yatak perde', alan: 'cover', ozellik: { durum: 'closed', konum: null, sinif: 'curtain', destek: null } };
const VANA = { etiket: 'Bahçe suyu', alan: 'valve', ozellik: { durum: 'open', konum: null, destek: 3 } };
const OTO = { etiket: 'Gece modu', alan: 'automation', ozellik: { acik: true, sonTetik: null } };
const OGELER = [PERDE, PERDE_KONUMSUZ, PERDE_BILINMEYEN, VANA, OTO];

const eylemi = (sorgu, ogeler = OGELER) => paletSorgusu(sorgu, ogeler).sonuclar[0]?.eylem ?? null;

test('komutluAlanMi: perde, vana, otomasyon komut alanıdır; kamera ve kapı alanları değildir', () => {
  for (const alan of ['cover', 'valve', 'automation']) assert.equal(komutluAlanMi(alan), true, alan);
  for (const alan of ['camera', 'lock', 'alarm_control_panel', 'siren']) assert.equal(komutluAlanMi(alan), false, alan);
});

test('perde: aç, kapat, dur (Türkçe ve İngilizce sözcükler) doğru servisi önerir', () => {
  for (const [kuyruk, servis, tur] of [
    ['ac', 'open_cover', 'kapak-ac'],
    ['open', 'open_cover', 'kapak-ac'],
    ['yukari', 'open_cover', 'kapak-ac'],
    ['kaldir', 'open_cover', 'kapak-ac'],
    ['kapat', 'close_cover', 'kapak-kapat'],
    ['close', 'close_cover', 'kapak-kapat'],
    ['asagi', 'close_cover', 'kapak-kapat'],
    ['indir', 'close_cover', 'kapak-kapat'],
    ['dur', 'stop_cover', 'dur'],
    ['durdur', 'stop_cover', 'dur'],
    ['stop', 'stop_cover', 'dur'],
  ]) {
    const k = komutu(PERDE, kuyruk);
    assert.equal(k.servis, servis, kuyruk);
    assert.equal(k.tur, tur, kuyruk);
    assert.equal(k.veri, undefined, `${kuyruk}: parametresiz`);
  }
});

test('perde: konum 0-100 tamsayı; ondalık komut olmaz; aralık dışı "sinir"', () => {
  const k = komutu(PERDE, '40');
  assert.equal(k.servis, 'set_cover_position');
  assert.deepEqual(k.veri, { position: 40 });
  assert.equal(k.tur, 'konum');
  assert.equal(k.deger, 40);
  assert.deepEqual(komutu(PERDE, '0').veri, { position: 0 });
  assert.deepEqual(komutu(PERDE, '100').veri, { position: 100 });
  assert.equal(komutu(PERDE, '101').hata, 'sinir');
  assert.equal(komutu(PERDE, '-5')?.hata ?? 'yok', 'sinir');
  assert.equal(komutu(PERDE, '40.5'), null, 'ondalık konum komut sayılmaz');
  assert.equal(komutu(PERDE, 'rastgele'), null);
  assert.equal(komutu(PERDE, ''), null);
});

test('perde: destek bit alanı bilinirse olmayan işlem "desteklenmiyor"; bilinmezse (null) denenir', () => {
  // destek 3 = yalnız aç + kapat: konum ve dur yok
  assert.equal(komutu(PERDE_KONUMSUZ, '40').hata, 'desteklenmiyor');
  assert.equal(komutu(PERDE_KONUMSUZ, 'dur').hata, 'desteklenmiyor');
  assert.equal(komutu(PERDE_KONUMSUZ, 'ac').servis, 'open_cover');
  assert.equal(komutu(PERDE_KONUMSUZ, 'kapat').servis, 'close_cover');
  // destek bilinmiyor + konum özniteliği yok: konum komutu önerilmez, diğerleri denenir
  assert.equal(komutu(PERDE_BILINMEYEN, '40').hata, 'desteklenmiyor');
  assert.equal(komutu(PERDE_BILINMEYEN, 'dur').servis, 'stop_cover');
  // destek bilinmiyor ama konum öznitelği var: konum komutu denenir
  assert.equal(komutu({ ...PERDE_BILINMEYEN, ozellik: { ...PERDE_BILINMEYEN.ozellik, konum: 30 } }, '50').servis, 'set_cover_position');
  assert.equal(komutu({ alan: 'cover', ozellik: null }, 'ac').servis, 'open_cover');
});

test('perde: paletSorgusu "salon perde 40" konumu ayarlar, "perde ac" adı perde olan tüm öğelere satır verir', () => {
  assert.deepEqual(eylemi('salon perde 40'), { servis: 'set_cover_position', veri: { position: 40 }, tur: 'konum', deger: 40 });
  const s = paletSorgusu('perde kapat', OGELER).sonuclar;
  assert.deepEqual(s.map((r) => r.oge.etiket).sort(), ['Salon perde', 'Yatak perde']);
  assert.ok(s.every((r) => r.eylem.servis === 'close_cover'));
});

test('vana: yalnız aç ve kapat (konum, dur, yüzde ve çalıştır sözcükleri komut değildir)', () => {
  assert.equal(komutu(VANA, 'ac').servis, 'open_valve');
  assert.equal(komutu(VANA, 'open').servis, 'open_valve');
  assert.equal(komutu(VANA, 'kapat').servis, 'close_valve');
  assert.equal(komutu(VANA, 'close').servis, 'close_valve');
  for (const kuyruk of ['dur', 'stop', '40', '100', 'calistir', 'yukari', 'asagi', 'tetikle']) assert.equal(komutu(VANA, kuyruk), null, kuyruk);
  assert.equal(komutu({ ...VANA, ozellik: { ...VANA.ozellik, destek: 1 } }, 'kapat').hata, 'desteklenmiyor');
  assert.equal(komutu({ alan: 'valve', ozellik: {} }, 'kapat').servis, 'close_valve', 'destek bilinmiyorsa denenir');
});

test('otomasyon: çalıştır/tetikle trigger; aç turn_on; kapat turn_off; başka sözcük komut değil', () => {
  for (const kuyruk of ['calistir', 'tetikle', 'run', 'trigger']) {
    const k = komutu(OTO, kuyruk);
    assert.equal(k.servis, 'trigger', kuyruk);
    assert.equal(k.tur, 'calistir', kuyruk);
  }
  assert.equal(komutu(OTO, 'ac').servis, 'turn_on');
  assert.equal(komutu(OTO, 'kapat').servis, 'turn_off');
  for (const kuyruk of ['40', 'dur', 'reload', 'sil']) assert.equal(komutu(OTO, kuyruk), null, kuyruk);
});

test('önerilen her komut servis-izinleri.js doğrulamasından geçer (öneri ile izin listesi tutarlı)', () => {
  const varlik = { cover: { entity_id: 'cover.a', state: 'open', attributes: { device_class: 'curtain', current_position: 40 } }, valve: { entity_id: 'valve.a', state: 'open', attributes: {} }, automation: { entity_id: 'automation.a', state: 'on', attributes: {} } };
  for (const [oge, kuyruklar] of [[PERDE, ['ac', 'kapat', 'dur', '0', '55', '100']], [VANA, ['ac', 'kapat']], [OTO, ['calistir', 'ac', 'kapat']]]) {
    for (const kuyruk of kuyruklar) {
      const k = komutu(oge, kuyruk);
      const dogrulama = servisDogrula(oge.alan, k.servis, k.veri, varlik[oge.alan]);
      assert.equal(dogrulama.ok, true, `${oge.alan} ${kuyruk} -> ${k.servis}`);
    }
  }
});

test('kapı/kilit/garaj kelimeleri perde komutu değildir; kilit ve kamera için komut hiç yok', () => {
  assert.equal(komutu(PERDE, 'kilitle'), null);
  assert.equal(komutu(PERDE, 'garaj'), null);
  assert.equal(komutu({ alan: 'lock', ozellik: {} }, 'ac'), null);
  assert.equal(komutu({ alan: 'camera', ozellik: {} }, 'ac'), null);
  assert.equal(komutu({ alan: 'alarm_control_panel', ozellik: {} }, 'kapat'), null);
});
