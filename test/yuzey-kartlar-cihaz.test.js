'use strict';

/**
 * 1.4.0 cihaz grubu hızlı panel kartları (src/yuzey-kartlar.js): perde (o-50), vana (o-59), otomasyon (o-49).
 * Sahte DOM + sahte saat (test/yuzey-kartlar-sahte.js). Kurallar:
 *  - perde düğmeleri (aç, dur, kapat) tek tıkla gider; konum kaydırıcısı sürüklenirken ara değer GÖNDERMEZ, bırakınca yalnız son değer gider;
 *  - vana ve otomasyon düğmeleri onaylıdır: düz tıklama hiçbir şey göndermez, ~0,8 sn basılı tutma `basili: true` ile gider;
 *  - cihazın desteklemediği işlem (supported_features bit alanı) için düğme çizilmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, modelYap, panelAc, dugmeAra, kartlar, basiliTut } = require('./yuzey-kartlar-sahte');

const metin = (sayfa) => sayfa.oge('icerik').textContent;

const PERDE = karo('cover.salon', 'Salon perde', {
  grup: 'perde',
  grupEtiketi: 'Perde',
  durum: 'acik',
  varsayilanEylem: false,
  ozellik: { durum: 'open', konum: 40, sinif: 'curtain', destek: 15 },
});
const VANA = karo('valve.su', 'Bahçe suyu', {
  grup: 'diger',
  durum: 'acik',
  varsayilanEylem: false,
  sinif: 'yikici',
  onayliServisler: ['open_valve', 'close_valve'],
  ozellik: { durum: 'open', konum: null, destek: 3 },
});
const OTO = karo('automation.gece', 'Gece modu', {
  grup: 'diger',
  durum: 'acik',
  sinif: 'yikici',
  varsayilanEylem: true,
  onayliServisler: ['trigger', 'turn_on', 'turn_off'],
  ozellik: { acik: true, sonTetik: null },
});
const varyant = (temel, id, etiket, ek = {}) => ({ ...temel, id, etiket, alan: id.split('.')[0], ...ek });

// --- perde ------------------------------------------------------------------------------------------------------------

test('perde: tam genişlik kart; durum ve konum yazılır; aç, dur, kapat düğmeleri tek tıkla servis gönderir', async () => {
  const sayfa = await panelAc({ model: modelYap(PERDE) });
  assert.equal(kartlar(sayfa).length, 1);
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-perde'));
  assert.match(metin(sayfa), /Salon perde/);
  assert.match(metin(sayfa), /Açık · %40/);
  for (const [aria, servis] of [
    ['Salon perde: aç', 'open_cover'],
    ['Salon perde: durdur', 'stop_cover'],
    ['Salon perde: kapat', 'close_cover'],
  ]) {
    const d = dugmeAra(sayfa, aria);
    assert.ok(d, aria);
    assert.equal(d.sinifVar('onayli'), false, `${aria}: perde onaysız`);
    d.gonder('click', { detail: 1 });
    sayfa.zaman.ilerle(500);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'cover.salon', servis }, aria);
  }
  assert.equal(sayfa.calistirmalar().every((y) => y.basili === undefined), true, 'perde basılı tutma istemez');
});

test('perde: konum kaydırıcısı 0-100; sürüklerken ara değer gitmez, bırakınca yalnız son değer gider', async () => {
  const sayfa = await panelAc({ model: modelYap(PERDE) });
  const k = sayfa.bul((o) => o.type === 'range')[0];
  assert.equal(k.min, '0');
  assert.equal(k.max, '100');
  assert.equal(k.value, '40');
  for (const ara of [45, 60, 75]) {
    k.value = ara;
    k.gonder('input');
    sayfa.zaman.ilerle(300);
  }
  assert.deepEqual(sayfa.calistirmalar(), [], 'sürükleme sırasında hiçbir istek gitmez');
  k.value = 80;
  k.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'cover.salon', servis: 'set_cover_position', veri: { position: 80 }, sonDeger: true }]);
});

test('perde: destek bit alanı bilinirse olmayan işlemin düğmesi çizilmez; konum bilinmiyorsa kaydırıcı yok', async () => {
  const yalnizAcKapat = await panelAc({ model: modelYap(varyant(PERDE, 'cover.m', 'Mutfak jaluzi', { ozellik: { durum: 'closed', konum: null, sinif: 'blind', destek: 3 } })) });
  assert.ok(dugmeAra(yalnizAcKapat, 'Mutfak jaluzi: aç'));
  assert.ok(dugmeAra(yalnizAcKapat, 'Mutfak jaluzi: kapat'));
  assert.equal(dugmeAra(yalnizAcKapat, 'Mutfak jaluzi: durdur'), undefined, 'dur desteği yok');
  assert.equal(yalnizAcKapat.bul((o) => o.type === 'range').length, 0);
  const konumsuz = await panelAc({ model: modelYap(varyant(PERDE, 'cover.k', 'Konumsuz', { ozellik: { durum: 'open', konum: null, sinif: 'curtain', destek: 15 } })) });
  assert.equal(konumsuz.bul((o) => o.type === 'range').length, 0, 'cihaz konum bildirmiyorsa kaydırıcı çizilmez');
  const bilinmeyen = await panelAc({ model: modelYap(varyant(PERDE, 'cover.b', 'Bilinmeyen', { ozellik: { durum: 'open', konum: 20, sinif: 'curtain', destek: null } })) });
  for (const ad of ['aç', 'durdur', 'kapat']) assert.ok(dugmeAra(bilinmeyen, `Bilinmeyen: ${ad}`), `destek bilinmiyorsa ${ad} gösterilir`);
});

test('perde: ulaşılamayan perde durumunu yazar; açılırken/kapanırken durum metni', async () => {
  const sayfa = await panelAc({ model: modelYap(varyant(PERDE, 'cover.u', 'Kopuk', { ulasilamiyor: true, kullanilabilir: false })) });
  assert.match(metin(sayfa), /Kopuk/);
  assert.match(metin(sayfa), /ulaşılamıyor/i);
  const acilirken = await panelAc({ model: modelYap(varyant(PERDE, 'cover.a', 'Açılan', { ozellik: { durum: 'opening', konum: 10, sinif: 'curtain', destek: 15 } })) });
  assert.match(metin(acilirken), /Açılıyor · %10/);
});

// --- vana --------------------------------------------------------------------------------------------------------------

test('vana: düz tıklama hiçbir şey göndermez; basılı tutma `basili: true` ile close_valve/open_valve gönderir', async () => {
  const sayfa = await panelAc({ model: modelYap(VANA) });
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-vana'));
  assert.match(metin(sayfa), /Bahçe suyu/);
  assert.match(metin(sayfa), /Açık/);
  for (const [aria, servis] of [
    ['Bahçe suyu: vanayı kapat', 'close_valve'],
    ['Bahçe suyu: vanayı aç', 'open_valve'],
  ]) {
    const d = dugmeAra(sayfa, aria);
    assert.ok(d, aria);
    assert.ok(d.sinifVar('onayli'), `${aria}: onaylı düğme biçimi`);
    d.gonder('click', { detail: 1 });
    assert.deepEqual(sayfa.calistirmalar(), [], `${aria}: düz tıklama gönderim yok`);
    basiliTut(sayfa, d, 900);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'valve.su', servis, basili: true }, aria);
    d.gonder('pointerup');
    sayfa.calistirmalar().length = 0;
    sayfa.cagrilar.length = 0;
  }
  assert.match(metin(sayfa), /Kesikli kenarlı düğmeler/, 'onaylı düğme varsa kartta hatırlatma yazılır');
});

test('vana: süre dolmadan bırakılırsa iptal; basılı tutma ana sürece "başladı" olarak bildirilir', async () => {
  const sayfa = await panelAc({ model: modelYap(VANA) });
  const kapat = dugmeAra(sayfa, 'Bahçe suyu: vanayı kapat');
  kapat.gonder('pointerdown', { button: 0 });
  assert.deepEqual(sayfa.basiliBaslamalar(), ['valve.su']);
  sayfa.zaman.ilerle(400);
  kapat.gonder('pointerup');
  sayfa.zaman.ilerle(1000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'erken bırakma iptal eder');
});

test('vana: destek bit alanı yalnız kapatmayı bildiriyorsa açma düğmesi çizilmez; konum kaydırıcısı yoktur', async () => {
  const sayfa = await panelAc({ model: modelYap(varyant(VANA, 'valve.k', 'Gaz', { ozellik: { durum: 'open', konum: null, destek: 2 } })) });
  assert.ok(dugmeAra(sayfa, 'Gaz: vanayı kapat'));
  assert.equal(dugmeAra(sayfa, 'Gaz: vanayı aç'), undefined);
  assert.equal(sayfa.bul((o) => o.type === 'range').length, 0);
});

// --- otomasyon ---------------------------------------------------------------------------------------------------------

test('otomasyon: çalıştır, aç, kapat düğmeleri ONAYLI; düz tıklama hiçbir şey göndermez; basılı tutma trigger/turn_on/turn_off gönderir', async () => {
  const sayfa = await panelAc({ model: modelYap(OTO) });
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-otomasyon'));
  assert.match(metin(sayfa), /Gece modu/);
  assert.match(metin(sayfa), /Henüz çalışmadı/);
  for (const [aria, servis] of [
    ['Gece modu: otomasyonu şimdi çalıştır', 'trigger'],
    ['Gece modu: otomasyonu aç', 'turn_on'],
    ['Gece modu: otomasyonu kapat', 'turn_off'],
  ]) {
    const d = dugmeAra(sayfa, aria);
    assert.ok(d, aria);
    assert.ok(d.sinifVar('onayli'), aria);
    d.gonder('click', { detail: 1 });
    assert.deepEqual(sayfa.calistirmalar(), [], `${aria}: düz tıklama gönderim yok`);
    basiliTut(sayfa, d, 900);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'automation.gece', servis, basili: true }, aria);
    d.gonder('pointerup');
    sayfa.calistirmalar().length = 0;
    sayfa.cagrilar.length = 0;
  }
});

test('otomasyon: açık/kapalı durum yazılır ve son çalışma zamanı görecelidir; kapalı otomasyon "Kapalı" der', async () => {
  const sonTetik = '2026-10-16T22:00:00+00:00'; // sahte saat 1970'te olduğundan göreli metnin kendisi değil varlığı denenir
  const sayfa = await panelAc({ model: modelYap(varyant(OTO, 'automation.a', 'Aktif', { ozellik: { acik: true, sonTetik } })) });
  assert.match(metin(sayfa), /açık/i);
  assert.match(metin(sayfa), /Son çalışma:/);
  const kapali = await panelAc({ model: modelYap(varyant(OTO, 'automation.k', 'Pasif', { durum: 'kapali', ozellik: { acik: false, sonTetik: null } })) });
  assert.match(metin(kapali), /kapalı/i);
});

test('otomasyon: çalıştırma onaylı olduğu için palet/panel dışındaki karolar ana süreçte yine reddedilir (renderer onayı kendi vermez)', async () => {
  const sayfa = await panelAc({ model: modelYap(OTO) });
  const d = dugmeAra(sayfa, 'Gece modu: otomasyonu şimdi çalıştır');
  d.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(850);
  const [yuk] = sayfa.calistirmalar();
  assert.equal(yuk.basili, true);
  assert.deepEqual(Object.keys(yuk).sort(), ['basili', 'kimlik', 'servis'], 'yük yalnız kimlik, servis ve basili taşır (onay kanıtı ana süreçte tutulur)');
});

// --- iklim: onaylı hedef sıcaklık (B26) ---------------------------------------------------------------------------------------

test('iklim: onaylı hedef sıcaklıkta "Uygula" düğmesi yuvarlak − / + sınıfını (adim) taşımaz; yalnız − ve + taşır (CSS 36 px daireyi yalnız adim sınıfına verir)', async () => {
  const klima = karo('climate.salon', 'Salon klima', {
    grup: 'iklim',
    grupEtiketi: 'İklim',
    varsayilanEylem: false,
    onayliServisler: ['set_temperature'],
    ozellik: { mod: 'cool', modlar: ['off', 'cool'], hedefSicaklik: 24, enAz: 16, enCok: 30, adim: 0.5, mevcutSicaklik: 26.5, hvacEylemi: 'cooling' },
  });
  const sayfa = await panelAc({ model: modelYap(klima) });
  const uygula = sayfa.bul((o) => o.etiket === 'button' && o.textContent === 'Uygula')[0];
  assert.ok(uygula, 'onaylı iklimde Uygula düğmesi çizilir');
  assert.ok(uygula.sinifVar('onayli') && uygula.sinifVar('uygula'));
  assert.equal(uygula.sinifVar('adim'), false, 'daire (adim) sınıfı yok: metin kırpılmaz, dolum çubuğu görünür');
  const adimlar = sayfa.bul((o) => o.etiket === 'button' && o.sinifVar('adim'));
  assert.deepEqual(adimlar.map((d) => d.textContent), ['−', '+']);
});
