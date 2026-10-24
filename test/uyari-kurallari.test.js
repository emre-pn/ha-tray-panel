'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UYARI_ALANLARI,
  EN_COK_KURAL,
  DAKIKA_SINIRI,
  GUN_SINIRI,
  alanSimgesi,
  durumOnerileri,
  varlikKimligiGecerliMi,
  kosulDuzelt,
  saatDakika,
  sessizSaatlerDuzelt,
  sessizMi,
  kuralDuzelt,
  kurallariDuzelt,
  kuralKimlikleri,
  kosulSaglaniyorMu,
  gecisEslesiyorMu,
  durumMetni,
  uyariMetniKur,
  uyariDegerlendiriciOlustur,
} = require('../src/lib/uyari-kurallari');
const { FAVORI_ALANLARI } = require('../src/lib/suzgec');
const { TR, anaCevirmen } = require('../src/lib/ceviri-varsayilan');
const { HAVA_DURUMLARI, MEDYA_DURUMLARI, SUPURGE_DURUMLARI, ZAMANLAYICI_DURUMLARI } = require('../src/lib/varlik-ozellik');
const { HVAC_MODLARI } = require('../src/lib/servis-izinleri');

const EN = anaCevirmen('en');

function sahteZaman() {
  let sonId = 0;
  let simdi = 1_000_000;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: simdi + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    simdi: () => simdi,
    ilerle(ms) {
      simdi += ms;
      for (const [id, v] of [...bekleyenler].sort((a, b) => a[1].bitis - b[1].bitis)) {
        if (v.bitis <= simdi && bekleyenler.has(id)) {
          bekleyenler.delete(id);
          v.fn();
        }
      }
    },
    bekleyen: () => bekleyenler.size,
  };
}

const kural = (ek = {}) => ({
  id: 'u1',
  acik: true,
  varlik: 'sensor.sicaklik',
  kosul: { tur: 'esik', yon: 'ustunde', deger: 30 },
  metin: '',
  sure: 0,
  bekleme: 0,
  sessizSaatler: null,
  windows: false,
  ...ek,
});

/** Değerlendiriciyi sahte depo ve zamanla kurar. `durumlar`: { kimlik: varlık } */
function kur(kurallar, secenek = {}) {
  const zaman = sahteZaman();
  const durumlar = new Map();
  const olaylar = [];
  const gunluk = [];
  const d = uyariDegerlendiriciOlustur({
    kurallarAl: () => kurallar,
    durumAl: (k) => durumlar.get(k),
    uyar: (o) => olaylar.push(o),
    simdi: zaman.simdi,
    zaman,
    gunluk: (m) => gunluk.push(m),
    yerelDakika: secenek.yerelDakika ?? (() => 12 * 60),
    t: secenek.t ?? TR,
  });
  const ayarla = (kimlik, state, ek = {}) => {
    durumlar.set(kimlik, { entity_id: kimlik, state, attributes: { friendly_name: 'Salon', ...ek } });
    d.degisti([kimlik]);
  };
  return { d, zaman, durumlar, olaylar, gunluk, ayarla };
}

// --- alan listesi ve Kapı Kuralı -------------------------------------------------------------------------------

test('uyarı alanları: kapı alanları yok, hepsi kayıtlı alan', () => {
  for (const yasak of ['lock', 'alarm_control_panel', 'cover', 'camera', 'siren', 'valve', 'garage_door']) {
    assert.ok(!UYARI_ALANLARI.includes(yasak), yasak);
  }
  assert.ok(UYARI_ALANLARI.length > 10);
  assert.ok(Object.keys(FAVORI_ALANLARI).length > 0);
});

test('varlık kimliği: geçerli alan kabul; kapı/kilit adı, yasak alan ve bozuk desen reddedilir', () => {
  assert.equal(varlikKimligiGecerliMi('sensor.sicaklik'), true);
  assert.equal(varlikKimligiGecerliMi('light.salon'), true);
  assert.equal(varlikKimligiGecerliMi('lock.on_kapi'), false);
  assert.equal(varlikKimligiGecerliMi('cover.garaj'), false);
  assert.equal(varlikKimligiGecerliMi('alarm_control_panel.ev'), false);
  assert.equal(varlikKimligiGecerliMi('sensor.kapi_durumu'), false);
  assert.equal(varlikKimligiGecerliMi('sensor.garage_door_state'), false);
  assert.equal(varlikKimligiGecerliMi('sensor.Büyük'), false);
  assert.equal(varlikKimligiGecerliMi(''), false);
  assert.equal(varlikKimligiGecerliMi(null), false);
  assert.equal(varlikKimligiGecerliMi(42), false);
  assert.equal(varlikKimligiGecerliMi('camera.bahce'), false);
});

// --- koşul doğrulama --------------------------------------------------------------------------------------------

test('koşul: geçerli türler normalleşir, bozuk olanlar reddedilir', () => {
  assert.deepEqual(kosulDuzelt({ tur: 'ulasilamiyor', fazla: 1 }), { tur: 'ulasilamiyor' });
  assert.deepEqual(kosulDuzelt({ tur: 'bilinmiyor' }), { tur: 'bilinmiyor' });
  assert.deepEqual(kosulDuzelt({ tur: 'durum', deger: ' on ' }), { tur: 'durum', deger: 'on' });
  assert.deepEqual(kosulDuzelt({ tur: 'gecis', den: 'off', ye: 'on' }), { tur: 'gecis', den: 'off', ye: 'on' });
  assert.deepEqual(kosulDuzelt({ tur: 'gecis', ye: 'on' }), { tur: 'gecis', den: '', ye: 'on' });
  assert.deepEqual(kosulDuzelt({ tur: 'esik', yon: 'altinda', deger: '12.5' }), { tur: 'esik', yon: 'altinda', deger: 12.5 });
  assert.equal(kosulDuzelt({ tur: 'durum' }), undefined);
  assert.equal(kosulDuzelt({ tur: 'durum', deger: '' }), undefined);
  assert.equal(kosulDuzelt({ tur: 'esik', yon: 'yanda', deger: 1 }), undefined);
  assert.equal(kosulDuzelt({ tur: 'esik', yon: 'ustunde', deger: 'abc' }), undefined);
  assert.equal(kosulDuzelt({ tur: 'esik', yon: 'ustunde', deger: Infinity }), undefined);
  assert.equal(kosulDuzelt({ tur: 'esik', yon: 'ustunde', deger: 1e12 }), undefined);
  assert.equal(kosulDuzelt({ tur: 'baska' }), undefined);
  assert.equal(kosulDuzelt(null), undefined);
  assert.equal(kosulDuzelt([]), undefined);
  assert.equal(kosulDuzelt('durum'), undefined);
});

test('koşul: kapı sözcüğü taşıyan durum değeri reddedilir', () => {
  assert.equal(kosulDuzelt({ tur: 'durum', deger: 'Kapıyı aç' }), undefined);
  assert.equal(kosulDuzelt({ tur: 'gecis', den: 'unlock', ye: 'on' }), undefined);
  assert.equal(kosulDuzelt({ tur: 'gecis', den: '', ye: 'garage door' }), undefined);
});

// --- sessiz saatler ----------------------------------------------------------------------------------------------

test('saatDakika: geçerli HH:MM, bozuk girdi null', () => {
  assert.equal(saatDakika('00:00'), 0);
  assert.equal(saatDakika('07:30'), 450);
  assert.equal(saatDakika('23:59'), 1439);
  for (const bozuk of ['24:00', '7:30', '07:60', '', 'aa:bb', null, 730, '07:30:00']) assert.equal(saatDakika(bozuk), null, String(bozuk));
});

test('sessiz saatler: aynı güne ait aralık', () => {
  const s = { baslangic: '13:00', bitis: '15:00' };
  assert.equal(sessizMi(s, 12 * 60 + 59), false);
  assert.equal(sessizMi(s, 13 * 60), true);
  assert.equal(sessizMi(s, 14 * 60 + 59), true);
  assert.equal(sessizMi(s, 15 * 60), false, 'bitiş dışarıda');
});

test('sessiz saatler: gece yarısını aşan aralık (22:00-07:00)', () => {
  const s = { baslangic: '22:00', bitis: '07:00' };
  assert.equal(sessizMi(s, 21 * 60 + 59), false);
  assert.equal(sessizMi(s, 22 * 60), true);
  assert.equal(sessizMi(s, 23 * 60 + 30), true);
  assert.equal(sessizMi(s, 0), true);
  assert.equal(sessizMi(s, 6 * 60 + 59), true);
  assert.equal(sessizMi(s, 7 * 60), false);
  assert.equal(sessizMi(s, 12 * 60), false);
});

test('sessiz saatler: yok/eşit/bozuk aralık sessiz sayılmaz; düzeltme', () => {
  assert.equal(sessizMi(null, 100), false);
  assert.equal(sessizMi({ baslangic: '10:00', bitis: '10:00' }, 600), false);
  assert.equal(sessizMi({ baslangic: 'x', bitis: '10:00' }, 600), false);
  assert.equal(sessizMi({ baslangic: '09:00', bitis: '10:00' }, NaN), false);
  assert.equal(sessizSaatlerDuzelt(null), null);
  assert.equal(sessizSaatlerDuzelt({ baslangic: '10:00', bitis: '10:00' }), null);
  assert.equal(sessizSaatlerDuzelt({ baslangic: '25:00', bitis: '10:00' }), null);
  assert.deepEqual(sessizSaatlerDuzelt({ baslangic: '22:00', bitis: '07:00', fazla: 1 }), { baslangic: '22:00', bitis: '07:00' });
});

// --- kural doğrulama ----------------------------------------------------------------------------------------------

test('kuralDuzelt: alanlar normalleşir, varsayılanlar atanır', () => {
  const k = kuralDuzelt({ varlik: 'sensor.sicaklik', kosul: { tur: 'esik', yon: 'ustunde', deger: 30 }, fazla: 'x' });
  assert.deepEqual(k, {
    id: '',
    acik: true,
    varlik: 'sensor.sicaklik',
    kosul: { tur: 'esik', yon: 'ustunde', deger: 30 },
    metin: '',
    sure: 0,
    bekleme: 300,
    sessizSaatler: null,
    windows: false,
  });
  const tam = kuralDuzelt({
    id: 'a1',
    acik: false,
    varlik: 'light.salon',
    kosul: { tur: 'durum', deger: 'on' },
    metin: '  Salon ışığı açık  ',
    sure: 120,
    bekleme: 60,
    sessizSaatler: { baslangic: '23:00', bitis: '06:00' },
    windows: true,
  });
  assert.equal(tam.id, 'a1');
  assert.equal(tam.acik, false);
  assert.equal(tam.metin, 'Salon ışığı açık');
  assert.equal(tam.sure, 120);
  assert.equal(tam.bekleme, 60);
  assert.deepEqual(tam.sessizSaatler, { baslangic: '23:00', bitis: '06:00' });
  assert.equal(tam.windows, true);
});

test('kuralDuzelt: bozuk girdiler null döner, fırlatmaz', () => {
  const gecerli = { varlik: 'sensor.a', kosul: { tur: 'bilinmiyor' } };
  assert.notEqual(kuralDuzelt(gecerli), null);
  for (const bozuk of [
    null,
    undefined,
    'x',
    [],
    42,
    {},
    { varlik: 'lock.kapi', kosul: { tur: 'bilinmiyor' } },
    { varlik: 'sensor.a' },
    { varlik: 'sensor.a', kosul: { tur: 'yok' } },
    { ...gecerli, sure: -1 },
    { ...gecerli, sure: 86_401 },
    { ...gecerli, sure: 1.5 },
    { ...gecerli, sure: 'abc' },
    { ...gecerli, bekleme: 1e9 },
    { ...gecerli, metin: 5 },
    { ...gecerli, metin: 'Kapıyı kilitle' },
    { ...gecerli, metin: 'x'.repeat(5000) },
  ]) {
    assert.equal(kuralDuzelt(bozuk), null, JSON.stringify(bozuk));
  }
});

test('kuralDuzelt: uzun cümle kısaltılır; sessiz saat bozuksa yok sayılır; windows yalnız true', () => {
  const k = kuralDuzelt({ ...{ varlik: 'sensor.a', kosul: { tur: 'bilinmiyor' } }, metin: 'a'.repeat(300), sessizSaatler: { baslangic: 'x', bitis: 'y' }, windows: 'evet' });
  assert.equal(Array.from(k.metin).length, 100);
  assert.equal(k.sessizSaatler, null);
  assert.equal(k.windows, false);
});

test('kurallariDuzelt: dizi değilse undefined; geçersizler düşer; en çok EN_COK_KURAL; kimlikler benzersiz', () => {
  assert.equal(kurallariDuzelt(null), undefined);
  assert.equal(kurallariDuzelt({}), undefined);
  assert.deepEqual(kurallariDuzelt([]), []);
  const g = (varlik, id) => ({ id, varlik, kosul: { tur: 'bilinmiyor' } });
  const sonuc = kurallariDuzelt([g('sensor.a', 'x1'), g('sensor.b', 'x1'), g('lock.kapi', 'x2'), g('sensor.c'), 'bozuk', g('sensor.d', 'U!')]);
  assert.deepEqual(
    sonuc.map((k) => k.varlik),
    ['sensor.a', 'sensor.b', 'sensor.c', 'sensor.d'],
  );
  const kimlikler = sonuc.map((k) => k.id);
  assert.equal(new Set(kimlikler).size, 4);
  assert.ok(kimlikler.every((k) => /^[a-z0-9]{2,12}$/.test(k)));
  assert.equal(kimlikler[0], 'x1');
  const cok = Array.from({ length: 60 }, (_, i) => g(`sensor.s${i}`));
  assert.equal(kurallariDuzelt(cok).length, EN_COK_KURAL);
});

test('kurallariDuzelt: çıktı yeniden doğrulanınca aynı kalır (kararlı)', () => {
  const ilk = kurallariDuzelt([{ varlik: 'sensor.a', kosul: { tur: 'esik', yon: 'altinda', deger: 3 } }, { varlik: 'light.b', kosul: { tur: 'gecis', den: 'off', ye: 'on' }, sure: 30 }]);
  assert.deepEqual(kurallariDuzelt(ilk), ilk);
});

test('kuralKimlikleri: yalnız açık kuralların varlıkları', () => {
  const k = new Set(kuralKimlikleri([kural({ varlik: 'sensor.a' }), kural({ id: 'u2', varlik: 'sensor.b', acik: false })]));
  assert.deepEqual([...k], ['sensor.a']);
  assert.equal(kuralKimlikleri(null).size, 0);
});

// --- koşul değerlendirme -------------------------------------------------------------------------------------------

test('kosulSaglaniyorMu: eşik, durum, ulaşılamıyor, bilinmiyor', () => {
  const v = (state) => ({ state });
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'ustunde', deger: 30 }, v('31')), true);
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'ustunde', deger: 30 }, v('30')), false, 'eşit değil, üstünde');
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'altinda', deger: 10 }, v('9.5')), true);
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'altinda', deger: 10 }, v('10')), false);
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'altinda', deger: 10 }, v('unavailable')), false, 'sayı olmayan durum eşiği tetiklemez');
  assert.equal(kosulSaglaniyorMu({ tur: 'esik', yon: 'altinda', deger: 10 }, v('')), false);
  assert.equal(kosulSaglaniyorMu({ tur: 'durum', deger: 'on' }, v('on')), true);
  assert.equal(kosulSaglaniyorMu({ tur: 'durum', deger: 'on' }, v('off')), false);
  assert.equal(kosulSaglaniyorMu({ tur: 'ulasilamiyor' }, v('unavailable')), true);
  assert.equal(kosulSaglaniyorMu({ tur: 'ulasilamiyor' }, v('unknown')), false);
  assert.equal(kosulSaglaniyorMu({ tur: 'bilinmiyor' }, v('unknown')), true);
  assert.equal(kosulSaglaniyorMu({ tur: 'gecis', den: '', ye: '' }, v('on')), false, 'geçiş düzey koşulu değildir');
  assert.equal(kosulSaglaniyorMu({ tur: 'durum', deger: 'on' }, null), false);
  assert.equal(kosulSaglaniyorMu({ tur: 'durum', deger: 'on' }, { state: 5 }), false);
});

test('gecisEslesiyorMu: boş uçlar herhangi; aynı durum eşleşmez', () => {
  assert.equal(gecisEslesiyorMu({ den: 'off', ye: 'on' }, 'off', 'on'), true);
  assert.equal(gecisEslesiyorMu({ den: 'off', ye: 'on' }, 'idle', 'on'), false);
  assert.equal(gecisEslesiyorMu({ den: '', ye: 'on' }, 'idle', 'on'), true);
  assert.equal(gecisEslesiyorMu({ den: 'off', ye: '' }, 'off', 'x'), true);
  assert.equal(gecisEslesiyorMu({ den: '', ye: '' }, 'a', 'b'), true);
  assert.equal(gecisEslesiyorMu({ den: '', ye: '' }, 'a', 'a'), false);
});

// --- cümle ----------------------------------------------------------------------------------------------------------

test('durumMetni: bilinen durumlar çevrilir, sayıya birim eklenir, kapı metni null', () => {
  assert.equal(durumMetni({ state: 'on' }, TR), TR('durum.on'));
  assert.equal(durumMetni({ state: 'on' }, EN), 'on');
  assert.equal(durumMetni({ state: '23.5', attributes: { unit_of_measurement: '°C' } }, TR), '23.5 °C');
  assert.equal(durumMetni({ state: 'playing' }, TR), 'çalıyor');
  assert.equal(durumMetni({ state: 'bilinmeyen_durum_x' }, TR), 'bilinmeyen_durum_x', 'sözlükte olmayan durum ham kalır');
  assert.equal(durumMetni({ state: 'Kapıyı aç' }, TR), null);
  assert.equal(durumMetni({ state: 7 }, TR), null);
  assert.equal(durumMetni(null, TR), null);
});

test('durumMetni: Ayarlar’da kural kurulabilen hava, medya, süpürge, zamanlayıcı ve klima durumlarının hepsi beş dilde çevrilir', () => {
  const durumlar = new Set([...HAVA_DURUMLARI, ...MEDYA_DURUMLARI, ...SUPURGE_DURUMLARI, ...ZAMANLAYICI_DURUMLARI, ...HVAC_MODLARI]);
  assert.ok(durumlar.size > 30);
  for (const dil of ['tr', 'en', 'de', 'fr', 'es']) {
    const c = anaCevirmen(dil);
    for (const d of durumlar) {
      assert.equal(c.var(`durum.${d}`), true, `${dil}: durum.${d}`);
      assert.notEqual(durumMetni({ state: d }, c), null);
    }
  }
  assert.equal(durumMetni({ state: 'rainy' }, TR), 'yağmurlu');
  assert.equal(durumMetni({ state: 'rainy' }, EN), 'rainy');
  assert.equal(durumMetni({ state: 'partlycloudy' }, anaCevirmen('de')), 'teilweise bewölkt');
  assert.equal(durumMetni({ state: 'idle' }, anaCevirmen('fr')), 'inactif');
});

test('uyariMetniKur: varsayılan cümle ad ve durumu içerir; iki dilde', () => {
  const v = { entity_id: 'sensor.sicaklik', state: '33', attributes: { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' } };
  const tr = uyariMetniKur(kural(), v, TR);
  assert.ok(tr.includes('Salon sıcaklığı'), tr);
  assert.ok(tr.includes('33'), tr);
  assert.ok(tr.includes('30'), 'eşik de yazılır: ' + tr);
  const en = uyariMetniKur(kural(), v, EN);
  assert.ok(en.includes('Salon sıcaklığı') && en.includes('33'), en);
  assert.notEqual(tr, en);
});

test('uyariMetniKur: kullanıcı cümlesi yer tutucuları doldurur', () => {
  const v = { entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Salon' } };
  const m = uyariMetniKur(kural({ varlik: 'light.salon', metin: 'Dikkat: {ad} şimdi {durum}!' }), v, TR);
  assert.equal(m, `Dikkat: Salon şimdi ${TR('durum.on')}!`);
});

test('uyariMetniKur: ad yoksa kimlik kullanılır; kapı sözcüklü ad cümleyi engeller', () => {
  const adsiz = { entity_id: 'sensor.sicaklik', state: '33', attributes: {} };
  assert.ok(uyariMetniKur(kural(), adsiz, TR).includes('sensor.sicaklik'));
  const kotu = { entity_id: 'sensor.sicaklik', state: '33', attributes: { friendly_name: 'Ön kapı sıcaklığı' } };
  assert.ok(!uyariMetniKur(kural({ metin: '{ad} çok sıcak' }), kotu, TR)?.toLowerCase().includes('kapı'));
});

test('uyariMetniKur: durum değeri kapı sözcüğü taşıyorsa null', () => {
  const v = { entity_id: 'sensor.x', state: 'unlocked door', attributes: {} };
  assert.equal(uyariMetniKur(kural({ varlik: 'sensor.x' }), v, TR), null);
});

// --- durum önerileri -------------------------------------------------------------------------------------------------

test('durumOnerileri: alana göre sabit liste + unavailable/unknown; seçicide seçenekler süzülür', () => {
  const isik = durumOnerileri({ entity_id: 'light.salon' });
  assert.deepEqual(isik.slice(0, 2), ['on', 'off']);
  assert.ok(isik.includes('unavailable') && isik.includes('unknown'));
  const klima = durumOnerileri({ entity_id: 'climate.salon' });
  assert.ok(klima.includes('heat') && klima.includes('cool'));
  const medya = durumOnerileri({ entity_id: 'media_player.tv' });
  assert.ok(medya.includes('playing'));
  const secici = durumOnerileri({ entity_id: 'select.mod', attributes: { options: ['Eve geliyorum', 'Kapıyı aç', 'Uyku'] } });
  assert.ok(secici.includes('Eve geliyorum') && secici.includes('Uyku'));
  assert.ok(!secici.some((s) => s.includes('Kapı')), 'kapı sözcüklü seçenek önerilmez');
  const sayac = durumOnerileri({ entity_id: 'sensor.sicaklik' });
  assert.deepEqual(sayac, ['unavailable', 'unknown']);
});

test('durumOnerileri: kapı alanı ve bozuk girdi boş liste', () => {
  assert.deepEqual(durumOnerileri({ entity_id: 'lock.kapi' }), []);
  assert.deepEqual(durumOnerileri({ entity_id: 'cover.garaj' }), []);
  assert.deepEqual(durumOnerileri(null), []);
  assert.deepEqual(durumOnerileri({}), []);
});

test('alanSimgesi: bilinen alan simgesi, bilinmeyen alan zil', () => {
  assert.notEqual(alanSimgesi('light'), alanSimgesi('sensor'));
  assert.equal(alanSimgesi('bilinmeyen'), '🔔');
  assert.equal(alanSimgesi('constructor'), '🔔');
  for (const alan of UYARI_ALANLARI) assert.ok(alanSimgesi(alan).length > 0, alan);
});

// --- değerlendirici: eşik ------------------------------------------------------------------------------------------

test('değerlendirici: ilk görülen durum yalnız taban çizgisidir (eşik zaten aşılmış olsa da bildirim yok)', () => {
  const { olaylar, ayarla } = kur([kural()]);
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar.length, 0);
});

test('değerlendirici: eşik geçişi bir kez bildirir, koşul kalkana dek tekrarlamaz, kalkıp dönünce yine bildirir', () => {
  const { olaylar, ayarla } = kur([kural()]);
  ayarla('sensor.sicaklik', '25');
  ayarla('sensor.sicaklik', '31');
  assert.equal(olaylar.length, 1);
  assert.equal(olaylar[0].kuralId, 'u1');
  assert.equal(olaylar[0].kimlik, 'sensor.sicaklik');
  assert.equal(olaylar[0].alan, 'sensor');
  assert.equal(olaylar[0].simge, alanSimgesi('sensor'));
  assert.ok(olaylar[0].metin.includes('31'));
  ayarla('sensor.sicaklik', '33');
  ayarla('sensor.sicaklik', '40');
  assert.equal(olaylar.length, 1, 'koşul sürerken tekrar yok');
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '32');
  assert.equal(olaylar.length, 2, 'koşul kalkıp dönünce yeniden');
});

test('değerlendirici: altında eşiği', () => {
  const { olaylar, ayarla } = kur([kural({ kosul: { tur: 'esik', yon: 'altinda', deger: 10 } })]);
  ayarla('sensor.sicaklik', '15');
  ayarla('sensor.sicaklik', '9');
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: eşik koşulunda sayı olmayan durum koşulu kaldırır (unavailable -> yine eşik üstü bildirir)', () => {
  const { olaylar, ayarla } = kur([kural()]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  ayarla('sensor.sicaklik', 'unavailable');
  ayarla('sensor.sicaklik', '36');
  assert.equal(olaylar.length, 2);
});

// --- değerlendirici: durum / geçiş / ulaşılamıyor -----------------------------------------------------------------

test('değerlendirici: tam durum kenar tetiklidir', () => {
  const { olaylar, ayarla } = kur([kural({ varlik: 'light.salon', kosul: { tur: 'durum', deger: 'on' } })]);
  ayarla('light.salon', 'on'); // taban: zaten açık
  assert.equal(olaylar.length, 0);
  ayarla('light.salon', 'off');
  ayarla('light.salon', 'on');
  assert.equal(olaylar.length, 1);
  ayarla('light.salon', 'on', { brightness: 5 }); // öznitelik güncellemesi: durum aynı
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: duruma geçiş den/ye eşleşmesine bakar', () => {
  const { olaylar, ayarla } = kur([kural({ varlik: 'media_player.tv', kosul: { tur: 'gecis', den: 'playing', ye: 'paused' } })]);
  ayarla('media_player.tv', 'idle');
  ayarla('media_player.tv', 'paused'); // idle -> paused: eşleşmez
  assert.equal(olaylar.length, 0);
  ayarla('media_player.tv', 'playing');
  ayarla('media_player.tv', 'paused'); // eşleşir
  assert.equal(olaylar.length, 1);
  ayarla('media_player.tv', 'paused'); // aynı durum
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: geçişte boş "den" herhangi bir durumdan gelişi kabul eder', () => {
  const { olaylar, ayarla } = kur([kural({ varlik: 'switch.pr', kosul: { tur: 'gecis', den: '', ye: 'on' } })]);
  ayarla('switch.pr', 'unavailable');
  ayarla('switch.pr', 'on');
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: ulaşılamıyor ve bilinmiyor uyarıları', () => {
  const { olaylar, ayarla } = kur([kural({ id: 'a1', varlik: 'sensor.a', kosul: { tur: 'ulasilamiyor' } }), kural({ id: 'a2', varlik: 'sensor.b', kosul: { tur: 'bilinmiyor' } })]);
  ayarla('sensor.a', '5');
  ayarla('sensor.b', '5');
  ayarla('sensor.a', 'unknown');
  ayarla('sensor.b', 'unavailable');
  assert.equal(olaylar.length, 0, 'yanlış durumlar tetiklemez');
  ayarla('sensor.a', 'unavailable');
  ayarla('sensor.b', 'unknown');
  assert.deepEqual(olaylar.map((o) => o.kuralId).sort(), ['a1', 'a2']);
});

test('değerlendirici: kapalı kural çalışmaz; kural varlığı dışındaki değişim yok sayılır', () => {
  const { olaylar, ayarla } = kur([kural({ acik: false })]);
  ayarla('sensor.sicaklik', '10');
  ayarla('sensor.sicaklik', '50');
  ayarla('sensor.baska', '50');
  assert.equal(olaylar.length, 0);
});

// --- değerlendirici: süre, bekleme, ısınma -------------------------------------------------------------------------

test('değerlendirici: süre dolana dek koşul sürerse bildirir (o-39)', () => {
  const { olaylar, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar.length, 0);
  zaman.ilerle(59_000);
  assert.equal(olaylar.length, 0);
  zaman.ilerle(1_000);
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: süre dolmadan koşul kalkarsa bildirim yok', () => {
  const { olaylar, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  zaman.ilerle(30_000);
  ayarla('sensor.sicaklik', '25');
  zaman.ilerle(120_000);
  assert.equal(olaylar.length, 0);
  assert.equal(zaman.bekleyen(), 0, 'zamanlayıcı temizlenir');
});

test('değerlendirici: süre sürerken yeni dalgalanma sayacı sıfırlamaz (koşul kesintisiz sürüyor)', () => {
  const { olaylar, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  zaman.ilerle(30_000);
  ayarla('sensor.sicaklik', '36');
  zaman.ilerle(30_000);
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: süreli geçiş koşulunda hedef durumdan çıkılırsa bildirim yok', () => {
  const { olaylar, ayarla, zaman } = kur([kural({ varlik: 'light.salon', sure: 30, kosul: { tur: 'gecis', den: 'off', ye: 'on' } })]);
  ayarla('light.salon', 'off');
  ayarla('light.salon', 'on');
  zaman.ilerle(10_000);
  ayarla('light.salon', 'off');
  zaman.ilerle(60_000);
  assert.equal(olaylar.length, 0);
  ayarla('light.salon', 'on');
  zaman.ilerle(30_000);
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: bekleme süresi içinde aynı kural ikinci kez bildirmez, sonra bildirir', () => {
  const { olaylar, ayarla, zaman } = kur([kural({ bekleme: 600 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar.length, 1);
  ayarla('sensor.sicaklik', '20');
  zaman.ilerle(60_000);
  ayarla('sensor.sicaklik', '35'); // bekleme dolmadı
  assert.equal(olaylar.length, 1);
  ayarla('sensor.sicaklik', '20');
  zaman.ilerle(600_000);
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar.length, 2);
});

test('değerlendirici: ısınma süresinde gelen değişimler yalnız tabanı günceller', () => {
  const { d, olaylar, ayarla, zaman } = kur([kural()]);
  ayarla('sensor.sicaklik', '20');
  d.isinmaBaslat(5_000);
  ayarla('sensor.sicaklik', '35'); // bağlantı sonrası toplu yükleme
  assert.equal(olaylar.length, 0);
  ayarla('sensor.sicaklik', '36');
  assert.equal(olaylar.length, 0);
  zaman.ilerle(6_000);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: ısınmada yinelenen durum bekleyen süre sayacını silmez (eşik)', () => {
  const { d, olaylar, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  zaman.ilerle(30_000);
  d.isinmaBaslat(); // WS yeniden kuruldu
  ayarla('sensor.sicaklik', '36'); // toplu yüklemede koşul hâlâ sağlanıyor
  assert.equal(zaman.bekleyen(), 1, 'sayaç sürüyor');
  zaman.ilerle(31_000);
  assert.equal(olaylar.length, 1, 'ilk kopmadan 61 sn sonra bildirir');
});

test('değerlendirici: ısınmada aynı durum yinelenince süreli durum kuralı bildirir', () => {
  const { d, olaylar, ayarla, zaman } = kur([kural({ varlik: 'switch.pompa', kosul: { tur: 'durum', deger: 'on' }, sure: 600 })]);
  ayarla('switch.pompa', 'off');
  ayarla('switch.pompa', 'on');
  zaman.ilerle(120_000);
  d.isinmaBaslat();
  ayarla('switch.pompa', 'on');
  zaman.ilerle(481_000);
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: ısınmada aynı durum yinelenince süreli geçiş kuralı bildirir', () => {
  const { d, olaylar, ayarla, zaman } = kur([kural({ varlik: 'light.salon', sure: 30, kosul: { tur: 'gecis', den: 'off', ye: 'on' } })]);
  ayarla('light.salon', 'off');
  ayarla('light.salon', 'on');
  zaman.ilerle(10_000);
  d.isinmaBaslat();
  ayarla('light.salon', 'on');
  zaman.ilerle(21_000);
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: ısınmada koşul bozulursa ya da durum değişirse bekleyen sayaç iptal olur (taban alınır)', () => {
  const { d, olaylar, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  zaman.ilerle(30_000);
  d.isinmaBaslat();
  ayarla('sensor.sicaklik', '20'); // koşul bozuldu
  assert.equal(zaman.bekleyen(), 0);
  zaman.ilerle(120_000);
  assert.equal(olaylar.length, 0);

  const g = kur([kural({ varlik: 'light.salon', sure: 30, kosul: { tur: 'gecis', den: 'off', ye: 'on' } })]);
  g.ayarla('light.salon', 'off');
  g.ayarla('light.salon', 'on');
  g.zaman.ilerle(10_000);
  g.d.isinmaBaslat();
  g.ayarla('light.salon', 'off'); // durum değişti: taban
  g.zaman.ilerle(60_000);
  assert.equal(g.olaylar.length, 0);
});

test('değerlendirici: bekleyen süre sayacı dolunca kuralın GÜNCEL metni, pencere ve sessiz saat ayarı uygulanır', () => {
  const kurallar = [kural({ sure: 60, metin: 'ESKI {ad}' })];
  const { d, olaylar, ayarla, zaman } = kur(kurallar);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  zaman.ilerle(30_000);
  kurallar[0] = kural({ sure: 60, metin: 'YENI {ad}', windows: true, sessizSaatler: { baslangic: '11:00', bitis: '13:00' } }); // şimdiki dakikayı (12:00) kapsar; süre ve koşul aynı: sayaç sürer
  d.kurallarDegisti();
  assert.equal(zaman.bekleyen(), 1, 'sayaç yeniden kurulmadı');
  zaman.ilerle(31_000);
  assert.equal(olaylar.length, 1);
  assert.ok(olaylar[0].metin.includes('YENI'), olaylar[0].metin);
  assert.ok(!olaylar[0].metin.includes('ESKI'));
  assert.equal(olaylar[0].windows, true);
  assert.equal(olaylar[0].sessiz, true);

  const g = [kural({ varlik: 'light.salon', sure: 30, kosul: { tur: 'gecis', den: 'off', ye: 'on' }, metin: 'ESKI {ad}' })];
  const o = kur(g);
  o.ayarla('light.salon', 'off');
  o.ayarla('light.salon', 'on');
  o.zaman.ilerle(10_000);
  g[0] = kural({ varlik: 'light.salon', sure: 30, kosul: { tur: 'gecis', den: 'off', ye: 'on' }, metin: 'YENI {ad}', windows: true });
  o.d.kurallarDegisti();
  o.zaman.ilerle(21_000);
  assert.equal(o.olaylar.length, 1);
  assert.ok(o.olaylar[0].metin.includes('YENI'));
  assert.equal(o.olaylar[0].windows, true);
});

test('değerlendirici: varlık HA’da yok olunca taban sıfırlanır; geri gelince bildirim üretmez', () => {
  const { olaylar, ayarla, durumlar, d } = kur([kural()]);
  ayarla('sensor.sicaklik', '20');
  durumlar.set('sensor.sicaklik', null);
  d.degisti(['sensor.sicaklik']);
  ayarla('sensor.sicaklik', '40'); // yeniden taban
  assert.equal(olaylar.length, 0);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '40');
  assert.equal(olaylar.length, 1);
});

test('değerlendirici: kural değişince (koşul farklı) taban yeniden alınır', () => {
  const kurallar = [kural()];
  const { d, olaylar, ayarla } = kur(kurallar);
  ayarla('sensor.sicaklik', '20');
  kurallar[0] = kural({ kosul: { tur: 'esik', yon: 'ustunde', deger: 10 } }); // artık zaten sağlanıyor
  d.kurallarDegisti();
  assert.equal(olaylar.length, 0, 'yeni koşul tabanda sağlanıyor: bildirim yok');
  ayarla('sensor.sicaklik', '25');
  assert.equal(olaylar.length, 0);
});

test('değerlendirici: kuralı silmek zamanlayıcıyı temizler', () => {
  const kurallar = [kural({ sure: 60 })];
  const { d, olaylar, ayarla, zaman } = kur(kurallar);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(zaman.bekleyen(), 1);
  kurallar.length = 0;
  d.kurallarDegisti();
  assert.equal(zaman.bekleyen(), 0);
  zaman.ilerle(120_000);
  assert.equal(olaylar.length, 0);
});

test('değerlendirici: durdur zamanlayıcıları temizler', () => {
  const { d, ayarla, zaman } = kur([kural({ sure: 60 })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  d.durdur();
  assert.equal(zaman.bekleyen(), 0);
});

// --- değerlendirici: sessiz saatler --------------------------------------------------------------------------------

test('değerlendirici: sessiz saatte olay sessiz=true gelir, saat dışında false', () => {
  let dakika = 23 * 60;
  const { olaylar, ayarla } = kur([kural({ sessizSaatler: { baslangic: '22:00', bitis: '07:00' } })], { yerelDakika: () => dakika });
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar[0].sessiz, true);
  ayarla('sensor.sicaklik', '20');
  dakika = 12 * 60;
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar[1].sessiz, false);
});

test('değerlendirici: windows bayrağı olaya taşınır', () => {
  const { olaylar, ayarla } = kur([kural({ windows: true })]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35');
  assert.equal(olaylar[0].windows, true);
});

// --- değerlendirici: güvenlik --------------------------------------------------------------------------------------

test('değerlendirici (kapı kuralı): HA’da sonradan kapı adı alan varlık için bildirim gösterilmez, sayılır', () => {
  const { d, olaylar, ayarla } = kur([kural()]);
  ayarla('sensor.sicaklik', '20');
  ayarla('sensor.sicaklik', '35', { friendly_name: 'Garaj kapısı sıcaklığı' });
  assert.equal(olaylar.length, 0);
  assert.equal(d.gizlenen(), 1);
});

test('değerlendirici (kapı kuralı): kapı sınıfı olan varlık bildirmez', () => {
  const { d, olaylar, ayarla } = kur([kural({ varlik: 'binary_sensor.x', kosul: { tur: 'durum', deger: 'on' } })]);
  ayarla('binary_sensor.x', 'off');
  ayarla('binary_sensor.x', 'on', { device_class: 'door' });
  assert.equal(olaylar.length, 0);
  assert.equal(d.gizlenen(), 1);
});

test('değerlendirici (kapı kuralı): üretilen cümleye kapı sözcüğü sızıyorsa ({durum} yer tutucusu) bildirim gösterilmez', () => {
  const { d, olaylar, ayarla } = kur([kural({ varlik: 'sensor.x', metin: 'Uyarı: {durum}', kosul: { tur: 'gecis', den: '', ye: '' } })]);
  ayarla('sensor.x', 'ok');
  ayarla('sensor.x', 'Kapıyı aç');
  assert.equal(olaylar.length, 0);
  assert.equal(d.gizlenen(), 1);
  ayarla('sensor.x', 'tamam');
  assert.equal(olaylar.length, 1, 'güvenli durum yine bildirilir');
  assert.ok(!/kap[ıi]/i.test(olaylar[0].metin));
});

test('değerlendirici: süreli kuralın zamanlayıcısında uyar fırlatırsa süreç çökmez', () => {
  const zaman = sahteZaman();
  const durumlar = new Map();
  const gunluk = [];
  const d = uyariDegerlendiriciOlustur({
    kurallarAl: () => [kural({ sure: 5 })],
    durumAl: (k) => durumlar.get(k),
    uyar: () => {
      throw new Error('x');
    },
    simdi: zaman.simdi,
    zaman,
    gunluk: (m) => gunluk.push(m),
  });
  const ayarla = (s) => {
    durumlar.set('sensor.sicaklik', { entity_id: 'sensor.sicaklik', state: s, attributes: {} });
    d.degisti(['sensor.sicaklik']);
  };
  ayarla('1');
  ayarla('99');
  assert.doesNotThrow(() => zaman.ilerle(6_000));
  assert.equal(gunluk.length, 1);
});

test('değerlendirici: günlüğe kimlik veya ad yazılmaz (hata durumunda sabit metin)', () => {
  const kurallar = [kural()];
  const zaman = sahteZaman();
  const gunluk = [];
  const d = uyariDegerlendiriciOlustur({
    kurallarAl: () => kurallar,
    durumAl: () => {
      throw new Error('sensor.sicaklik secret-token');
    },
    uyar: () => {},
    simdi: zaman.simdi,
    zaman,
    gunluk: (m) => gunluk.push(m),
  });
  d.degisti(['sensor.sicaklik']);
  assert.equal(gunluk.length, 1);
  assert.ok(!gunluk[0].includes('sensor') && !gunluk[0].includes('secret'));
});

test('değerlendirici: uyar geri çağrısı fırlatırsa diğer kurallar etkilenmez', () => {
  const zaman = sahteZaman();
  const durumlar = new Map();
  const alinan = [];
  const kurallar = [kural({ id: 'a1', varlik: 'sensor.a' }), kural({ id: 'a2', varlik: 'sensor.b' })];
  const d = uyariDegerlendiriciOlustur({
    kurallarAl: () => kurallar,
    durumAl: (k) => durumlar.get(k),
    uyar: (o) => {
      alinan.push(o.kuralId);
      if (o.kuralId === 'a1') throw new Error('x');
    },
    simdi: zaman.simdi,
    zaman,
  });
  const ayarla = (k, s) => {
    durumlar.set(k, { entity_id: k, state: s, attributes: {} });
    d.degisti([k]);
  };
  ayarla('sensor.a', '1');
  ayarla('sensor.b', '1');
  ayarla('sensor.a', '99');
  ayarla('sensor.b', '99');
  assert.deepEqual(alinan, ['a1', 'a2']);
});

// --- hız sınırı -----------------------------------------------------------------------------------------------------

test('değerlendirici: tüm kurallar toplamı dakikada DAKIKA_SINIRI bildirimden fazlasını üretmez', () => {
  const kurallar = Array.from({ length: 15 }, (_, i) => kural({ id: `k${i}`, varlik: `sensor.s${i}` }));
  const { olaylar, ayarla, gunluk } = kur(kurallar);
  for (let i = 0; i < 15; i += 1) ayarla(`sensor.s${i}`, '1');
  for (let i = 0; i < 15; i += 1) ayarla(`sensor.s${i}`, '99');
  assert.equal(olaylar.length, DAKIKA_SINIRI);
  assert.ok(gunluk.length > 0);
  assert.ok(gunluk.every((m) => !m.includes('sensor.')));
});

test('değerlendirici: dakika sınırı süre geçince açılır; günlük sınır aşılamaz', () => {
  const kurallar = [kural({ bekleme: 0 })];
  const { olaylar, ayarla, zaman } = kur(kurallar);
  ayarla('sensor.sicaklik', '1');
  let toplam = 0;
  for (let i = 0; i < GUN_SINIRI + 20; i += 1) {
    ayarla('sensor.sicaklik', '99');
    ayarla('sensor.sicaklik', '1');
    zaman.ilerle(20_000); // dakikada 3 bildirim
    toplam += 1;
  }
  assert.ok(toplam > GUN_SINIRI);
  assert.ok(olaylar.length <= GUN_SINIRI, `gün sınırı: ${olaylar.length}`);
  assert.ok(olaylar.length > DAKIKA_SINIRI, 'dakika sınırı süre geçince açıldı');
});
