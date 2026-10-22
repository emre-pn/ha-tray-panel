'use strict';

/**
 * Geri al (o-12) saf mantığı: src/lib/geri-al.js. Eylem sonucundan geri alma planı, en çok 5 girdilik süre sınırlı yığın, sürekli değerlerin
 * birleşmesi ve parti (oda kapatma). Ağ, Electron ve saat YOK (zaman elle ilerletilir).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EN_COK_GIRDI,
  VARSAYILAN_SURE_MS,
  EN_AZ_SURE_MS,
  EN_COK_SURE_MS,
  BIRLESTIRME_MS,
  EN_COK_SAHNE_UYESI,
  EN_COK_ADIM,
  KAYNAKLAR,
  parlaklikYuzdesi,
  sureyiKirp,
  geriAlmaPlani,
  geriAlYiginiOlustur,
} = require('../src/lib/geri-al');

const ok = (ek) => ({ ok: true, ad: 'Salon', alan: 'light', servis: 'toggle', sinif: 'zararsiz', onceki: 'on', ...ek });
const plan = (ek) => geriAlmaPlani({ kimlik: 'light.salon', ad: 'Salon', ...ek });

test('sabitler: en çok 5 girdi, varsayılan 10 dk, 1-60 dk aralığı; geri alınabilen kaynaklar kullanıcının kendi hareketleri', () => {
  assert.equal(EN_COK_GIRDI, 5);
  assert.equal(VARSAYILAN_SURE_MS, 600_000);
  assert.deepEqual([EN_AZ_SURE_MS, EN_COK_SURE_MS], [60_000, 3_600_000]);
  assert.ok(!KAYNAKLAR.includes('gecikmeli'), 'gecikmeli eylem yığına girmez');
  assert.deepEqual([...KAYNAKLAR].sort(), ['komut-satiri', 'kisayol', 'masaustu', 'palet', 'panel', 'tepsi-menu'].sort());
  assert.equal(sureyiKirp(undefined), VARSAYILAN_SURE_MS);
  assert.equal(sureyiKirp(1), EN_AZ_SURE_MS);
  assert.equal(sureyiKirp(99 * 3_600_000), EN_COK_SURE_MS);
  assert.equal(sureyiKirp(NaN), VARSAYILAN_SURE_MS);
  assert.equal(parlaklikYuzdesi(255), 100);
  assert.equal(parlaklikYuzdesi(1), 1);
  assert.equal(parlaklikYuzdesi(200), 78);
  assert.equal(parlaklikYuzdesi('x'), null);
});

test('aç/kapa: toggle, turn_on ve turn_off önceki duruma döner; durum değişmediyse geri alınacak bir şey yok', () => {
  const once = (state, nitelik = {}) => ({ state, attributes: nitelik });
  assert.deepEqual(plan({ istek: {}, sonuc: ok({ servis: 'toggle', once: once('on'), yeni: 'off' }) }), { tur: 'ac-kapa', adimlar: [{ kimlik: 'light.salon', ad: 'Salon', eylem: { servis: 'turn_on' } }] });
  assert.deepEqual(plan({ istek: {}, sonuc: ok({ servis: 'toggle', once: once('off'), yeni: 'on' }) }).adimlar[0].eylem, { servis: 'turn_off' });
  assert.deepEqual(plan({ istek: { servis: 'turn_off' }, sonuc: ok({ servis: 'turn_off', once: once('on') }) }).adimlar[0].eylem, { servis: 'turn_on' });
  assert.deepEqual(plan({ istek: { servis: 'turn_on' }, sonuc: ok({ servis: 'turn_on', once: once('off') }) }).adimlar[0].eylem, { servis: 'turn_off' });
  // yeni durum HA yanıtında yoksa toggle'dan çıkarılır
  assert.deepEqual(plan({ istek: {}, sonuc: ok({ servis: 'toggle', once: once('on') }) }).adimlar[0].eylem, { servis: 'turn_on' });
  // zaten o durumdaydı
  assert.equal(plan({ istek: { servis: 'turn_on' }, sonuc: ok({ servis: 'turn_on', once: once('on') }) }), null);
  assert.equal(plan({ istek: { servis: 'turn_off' }, sonuc: ok({ servis: 'turn_off', once: once('off') }) }), null);
  // switch / fan / input_boolean da aç-kapa
  for (const alan of ['switch', 'fan', 'input_boolean']) {
    const p = geriAlmaPlani({ kimlik: `${alan}.x`, ad: 'X', istek: {}, sonuc: ok({ alan, servis: 'toggle', once: once('on'), yeni: 'off' }) });
    assert.equal(p.tur, 'ac-kapa', alan);
  }
});

test('geri alınmayanlar: başarısız sonuç, yıkıcı sınıf, bilinmeyen/ulaşılamayan önceki durum, desteklenmeyen alanlar (kilit, kapak, iklim, medya, düğme, betik)', () => {
  const once = { state: 'on', attributes: {} };
  assert.equal(plan({ istek: {}, sonuc: { ok: false, tur: 'ha-hatasi' } }), null);
  assert.equal(plan({ istek: {}, sonuc: null }), null);
  assert.equal(plan({ istek: {}, sonuc: ok({ sinif: 'yikici', once }) }), null);
  assert.equal(plan({ istek: {}, sonuc: ok({ once: { state: 'unavailable', attributes: {} } }) }), null);
  assert.equal(plan({ istek: {}, sonuc: ok({ once: { state: 'unknown', attributes: {} } }) }), null);
  assert.equal(plan({ istek: {}, sonuc: ok({}) }), null, 'once yoksa');
  for (const alan of ['lock', 'cover', 'climate', 'media_player', 'button', 'script', 'automation', 'valve', 'camera', 'alarm_control_panel', 'siren']) {
    assert.equal(geriAlmaPlani({ kimlik: `${alan}.x`, ad: 'X', istek: { servis: 'turn_on' }, sonuc: ok({ alan, servis: 'turn_on', once }) }), null, alan);
  }
  // parametreli aç (ör. bilinmeyen veri) geri alınmaz: geri yüklenecek öznitelik bilinmiyor
  assert.equal(plan({ istek: { servis: 'turn_on', veri: { effect: 'x' } }, sonuc: ok({ servis: 'turn_on', once }) }), null);
});

test('parlaklık: önceki yüzdeye döner; ışık kapalıyken açıldıysa geri alma kapatır; ışık dışında plan yok', () => {
  const p = plan({ istek: { parlaklik: 20 }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: { brightness: 200 } }, parlaklik: 20 }) });
  assert.deepEqual(p, { tur: 'parlaklik', adimlar: [{ kimlik: 'light.salon', ad: 'Salon', eylem: { parlaklik: 78 } }] });
  const kapaliydi = plan({ istek: { parlaklik: 40 }, sonuc: ok({ servis: 'turn_on', once: { state: 'off', attributes: {} } }) });
  assert.deepEqual(kapaliydi.adimlar[0].eylem, { servis: 'turn_off' });
  assert.equal(plan({ istek: { parlaklik: 40 }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: {} } }) }), null, 'önceki parlaklık bilinmiyor');
  assert.equal(geriAlmaPlani({ kimlik: 'fan.f', ad: 'F', istek: { parlaklik: 40 }, sonuc: ok({ alan: 'fan', once: { state: 'on', attributes: { brightness: 100 } } }) }), null);
});

test('renk: renk sıcaklığı ya da rgb önceki renge döner; renk modu bilinmiyorsa plan yok; kapalıyken açıldıysa kapatır', () => {
  const sicak = plan({ istek: { servis: 'turn_on', veri: { rgb_color: [10, 20, 30] } }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: { color_mode: 'color_temp', color_temp_kelvin: 3000 } } }) });
  assert.deepEqual(sicak, { tur: 'renk', adimlar: [{ kimlik: 'light.salon', ad: 'Salon', eylem: { servis: 'turn_on', veri: { color_temp_kelvin: 3000 } } }] });
  const rgb = plan({ istek: { servis: 'turn_on', veri: { color_temp_kelvin: 2700 } }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: { color_mode: 'rgb', rgb_color: [255, 180, 100] } } }) });
  assert.deepEqual(rgb.adimlar[0].eylem, { servis: 'turn_on', veri: { rgb_color: [255, 180, 100] } });
  assert.equal(plan({ istek: { servis: 'turn_on', veri: { rgb_color: [1, 2, 3] } }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: { color_mode: 'brightness' } } }) }), null);
  assert.deepEqual(plan({ istek: { servis: 'turn_on', veri: { rgb_color: [1, 2, 3] } }, sonuc: ok({ servis: 'turn_on', once: { state: 'off', attributes: {} } }) }).adimlar[0].eylem, { servis: 'turn_off' });
  // bozuk rgb
  assert.equal(plan({ istek: { servis: 'turn_on', veri: { rgb_color: [1, 2, 3] } }, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: { rgb_color: [999, 0, 0] } } }) }), null);
});

test('renk: sıcaklık kipindeki ışıkta kelvin bilinmiyorsa rgb değerine DÜŞÜLMEZ (HA bu kipte türetilmiş rgb_color da verir; geri alma beyaz ışığı RGB kipine geçirirdi)', () => {
  const istek = { servis: 'turn_on', veri: { rgb_color: [10, 20, 30] } };
  const kipli = (nitelik) => plan({ istek, sonuc: ok({ servis: 'turn_on', once: { state: 'on', attributes: nitelik } }) });
  assert.equal(kipli({ color_mode: 'color_temp', rgb_color: [255, 180, 100] }), null, 'kelvin yok');
  assert.equal(kipli({ color_mode: 'color_temp', color_temp_kelvin: 'x', rgb_color: [255, 180, 100] }), null, 'kelvin sayı değil');
  assert.deepEqual(kipli({ color_mode: 'color_temp', color_temp_kelvin: 2700.4, rgb_color: [255, 180, 100] }).adimlar[0].eylem, { servis: 'turn_on', veri: { color_temp_kelvin: 2700 } });
  // rgb kipli ışık rgb ile geri döner; kip bilinmiyorsa eski davranış (rgb varsa rgb)
  assert.deepEqual(kipli({ color_mode: 'hs', rgb_color: [255, 180, 100] }).adimlar[0].eylem.veri, { rgb_color: [255, 180, 100] });
  assert.deepEqual(kipli({ rgb_color: [1, 2, 3] }).adimlar[0].eylem.veri, { rgb_color: [1, 2, 3] });
});

test('vantilatör hızı: önceki yüzdeye döner (0-100 kırpılır); kapalıyken açıldıysa kapatır', () => {
  const fan = (once, istek = { servis: 'set_percentage', veri: { percentage: 30 } }) => geriAlmaPlani({ kimlik: 'fan.v', ad: 'V', istek, sonuc: ok({ alan: 'fan', servis: 'set_percentage', once }) });
  assert.deepEqual(fan({ state: 'on', attributes: { percentage: 66 } }).adimlar[0].eylem, { servis: 'set_percentage', veri: { percentage: 66 } });
  assert.deepEqual(fan({ state: 'on', attributes: { percentage: 140 } }).adimlar[0].eylem.veri, { percentage: 100 });
  assert.deepEqual(fan({ state: 'off', attributes: {} }).adimlar[0].eylem, { servis: 'turn_off' });
  assert.equal(fan({ state: 'on', attributes: {} }), null);
});

test('sahne: üyelerin önceki durumu adım olur (açıksa parlaklıkla TEK adım), güvensiz alan ve geçersiz durum atlanır, en çok 12 üye', () => {
  const uyeler = [
    { kimlik: 'light.salon', ad: 'Salon', durum: 'on', parlaklik: 78 },
    { kimlik: 'switch.priz', ad: 'Priz', durum: 'off' },
    { kimlik: 'lock.on', ad: 'Kilit', durum: 'on' },
    { kimlik: 'cover.perde', ad: 'Perde', durum: 'on' },
    { kimlik: 'light.bilinmiyor', ad: 'B', durum: 'unavailable' },
    null,
    { kimlik: 5, durum: 'on' },
  ];
  const p = geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: { servis: 'turn_on' }, sonuc: ok({ alan: 'scene', servis: 'turn_on' }), sahneUyeleri: uyeler });
  assert.equal(p.tur, 'sahne');
  assert.deepEqual(p.adimlar.map((a) => [a.kimlik, a.eylem]), [
    ['light.salon', { parlaklik: 78 }], // parlaklık komutu ışığı o yüzdeyle açar: üye başına tek adım (tek POST)
    ['switch.priz', { servis: 'turn_off' }],
  ]);
  assert.ok(p.adimlar.every((a) => a.uye === true));
  assert.equal(geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: {}, sonuc: ok({ alan: 'scene' }), sahneUyeleri: [] }), null);
  assert.equal(geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: {}, sonuc: ok({ alan: 'scene' }) }), null);
  const cok = Array.from({ length: 30 }, (_, i) => ({ kimlik: `switch.p${i}`, ad: `P${i}`, durum: 'on' }));
  assert.equal(geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: {}, sonuc: ok({ alan: 'scene' }), sahneUyeleri: cok }).adimlar.length, EN_COK_SAHNE_UYESI);
  // parlaklığı bilinen ışıklar adım bütçesini ikiye katlamaz: 12 üye = 12 adım
  const isiklar = Array.from({ length: 30 }, (_, i) => ({ kimlik: `light.l${i}`, ad: `L${i}`, durum: 'on', parlaklik: 50 }));
  const isikPlani = geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: {}, sonuc: ok({ alan: 'scene' }), sahneUyeleri: isiklar });
  assert.equal(isikPlani.adimlar.length, EN_COK_SAHNE_UYESI);
  assert.ok(isikPlani.adimlar.every((a) => a.eylem.parlaklik === 50 && a.uye === true));
  // parlaklığı bilinmeyen ya da kapalı ışık düz aç / kapa
  const duz = geriAlmaPlani({ kimlik: 'scene.film', ad: 'Film', istek: {}, sonuc: ok({ alan: 'scene' }), sahneUyeleri: [{ kimlik: 'light.a', ad: 'A', durum: 'on' }, { kimlik: 'light.b', ad: 'B', durum: 'off', parlaklik: 40 }, { kimlik: 'light.c', ad: 'C', durum: 'on', parlaklik: 0 }] });
  assert.deepEqual(duz.adimlar.map((a) => a.eylem), [{ servis: 'turn_on' }, { servis: 'turn_off' }, { servis: 'turn_on' }]);
});

// ---------------------------------------------------------------- yığın

function yigin(ek = {}) {
  let t = 1_000_000;
  const y = geriAlYiginiOlustur({ simdi: () => t, ...ek });
  return {
    y,
    ileri: (ms) => {
      t += ms;
    },
    simdi: () => t,
  };
}
const aKapa = (kimlik) => ({ tur: 'ac-kapa', adimlar: [{ kimlik, ad: kimlik, eylem: { servis: 'turn_on' } }] });
const parlaklikPlani = (yuzde) => ({ tur: 'parlaklik', adimlar: [{ kimlik: 'light.a', ad: 'A', eylem: { parlaklik: yuzde } }] });

test('yığın en çok 5 girdi tutar: altıncı en eskiyi düşürür; son() en yeniyi verir, cikar() geri alınanı çıkarır', () => {
  const { y } = yigin();
  for (let i = 1; i <= 6; i += 1) y.ekle({ kimlik: `switch.p${i}`, ad: `P${i}`, plan: aKapa(`switch.p${i}`), kaynak: 'panel' });
  assert.equal(y.sayi(), 5);
  assert.equal(y.son().kimlik, 'switch.p6');
  const en = y.son();
  y.cikar(en.id);
  assert.equal(y.son().kimlik, 'switch.p5');
  assert.equal(y.sayi(), 4);
  assert.equal(y.ozet().adet, 4);
  y.temizle();
  assert.equal(y.son(), null);
  assert.equal(y.ozet(), null);
  assert.equal(y.enYakinBitis(), null);
});

test('süre dolumu: varsayılan 10 dk, sureAl canlı okunur; dolan girdi düşer, bitiş en yakın girdinin süresidir', () => {
  let sure = 5 * 60_000;
  const { y, ileri, simdi } = yigin({ sureAl: () => sure });
  y.ekle({ kimlik: 'switch.a', ad: 'A', plan: aKapa('switch.a'), kaynak: 'panel' });
  const bas = simdi();
  ileri(2 * 60_000);
  y.ekle({ kimlik: 'switch.b', ad: 'B', plan: aKapa('switch.b'), kaynak: 'panel' });
  assert.equal(y.enYakinBitis(), bas + 5 * 60_000);
  assert.equal(y.ozet().bitis, bas + 2 * 60_000 + 5 * 60_000, 'özetin bitişi en yeni girdinindir');
  ileri(3 * 60_000);
  assert.equal(y.sayi(), 1, 'ilk girdi 5 dk sonra düştü');
  assert.equal(y.son().kimlik, 'switch.b');
  sure = 4 * 60_000; // ayar canlı değişti: son girdi 3 dk yaşında, 4 dk sınırına 1 dk var
  assert.equal(y.sayi(), 1);
  ileri(60_000);
  assert.equal(y.sayi(), 0);
  // varsayılan
  const v = yigin();
  v.y.ekle({ kimlik: 'switch.a', ad: 'A', plan: aKapa('switch.a'), kaynak: 'panel' });
  v.ileri(VARSAYILAN_SURE_MS - 1);
  assert.equal(v.y.sayi(), 1);
  v.ileri(1);
  assert.equal(v.y.sayi(), 0);
});

test('sürekli değerler (parlaklık, renk, hız) aynı varlıkta 5 sn içinde TEK girdide birleşir ve EN ESKİ önceki değeri korur', () => {
  const { y, ileri } = yigin();
  const ilk = y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(80), kaynak: 'panel' });
  ileri(200);
  const ikinci = y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(60), kaynak: 'panel' });
  ileri(BIRLESTIRME_MS);
  const ucuncu = y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(40), kaynak: 'panel' });
  assert.equal(ilk, ikinci, 'aynı girdi');
  assert.equal(ikinci, ucuncu, 'her birleşme süreyi yeniler: sürükleme boyunca zincir sürer');
  assert.equal(y.sayi(), 1);
  assert.deepEqual(y.son().adimlar[0].eylem, { parlaklik: 80 }, 'en eski değer');
  ileri(BIRLESTIRME_MS + 1);
  y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(30), kaynak: 'panel' });
  assert.equal(y.sayi(), 2, '5 sn geçince yeni girdi');
  // farklı varlık ya da farklı tür birleşmez
  y.ekle({ kimlik: 'light.b', ad: 'B', plan: { tur: 'parlaklik', adimlar: [{ kimlik: 'light.b', ad: 'B', eylem: { parlaklik: 10 } }] }, kaynak: 'panel' });
  y.ekle({ kimlik: 'light.b', ad: 'B', plan: { tur: 'renk', adimlar: [{ kimlik: 'light.b', ad: 'B', eylem: { servis: 'turn_off' } }] }, kaynak: 'panel' });
  assert.equal(y.sayi(), 4);
  // aç/kapa birleşmez (her biri ayrı geri alınır)
  y.ekle({ kimlik: 'switch.p', ad: 'P', plan: aKapa('switch.p'), kaynak: 'panel' });
  y.ekle({ kimlik: 'switch.p', ad: 'P', plan: aKapa('switch.p'), kaynak: 'panel' });
  assert.equal(y.sayi(), 5);
});

test('sürekli değer birleşmesi yalnız yığının EN ÜSTÜNDEKİ girdiyle olur: araya başka eylem girdiyse yeni girdi açılır (geri alma sırası bozulmaz)', () => {
  const { y, ileri } = yigin();
  y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(80), kaynak: 'panel' }); // A: önceki 80
  ileri(300);
  y.ekle({ kimlik: 'switch.b', ad: 'B', plan: aKapa('switch.b'), kaynak: 'panel' });
  ileri(300);
  const ikinci = y.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(50), kaynak: 'panel' }); // A: önceki 50, 5 sn içinde ama B araya girdi
  assert.equal(y.sayi(), 3, 'eski A girdisi yerinde güncellenmez');
  assert.equal(y.son(), ikinci, 'son eylem (A) en üstte');
  assert.deepEqual(y.son().adimlar[0].eylem, { parlaklik: 50 });
  // geri alma sırası: A (son), B, A (ilk)
  y.cikar(y.son().id);
  assert.equal(y.son().kimlik, 'switch.b');
  y.cikar(y.son().id);
  assert.deepEqual([y.son().kimlik, y.son().adimlar[0].eylem], ['light.a', { parlaklik: 80 }], 'ilk A girdisi en eski değeri korudu');
  // üstteki girdi aynı varlıksa birleşme sürer
  const { y: y2, ileri: ileri2 } = yigin();
  const a1 = y2.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(80), kaynak: 'panel' });
  ileri2(100);
  assert.equal(y2.ekle({ kimlik: 'light.a', ad: 'A', plan: parlaklikPlani(60), kaynak: 'panel' }), a1);
  assert.equal(y2.sayi(), 1);
});

test('parti girdisine adım eklenince girdi en üste çıkar (araya girmiş başka eylemden sonra da son eylem önce geri alınır); geriKoy sırası bozulmaz', () => {
  const { y } = yigin();
  const parti = { id: 'oda:salon', ad: 'Salon' };
  y.ekle({ kimlik: 'light.a', ad: 'A', plan: aKapa('light.a'), kaynak: 'panel', parti });
  y.ekle({ kimlik: 'switch.b', ad: 'B', plan: aKapa('switch.b'), kaynak: 'panel' });
  assert.equal(y.son().kimlik, 'switch.b');
  y.ekle({ kimlik: 'light.c', ad: 'C', plan: aKapa('light.c'), kaynak: 'panel', parti });
  assert.equal(y.sayi(), 2, 'parti hâlâ tek girdi');
  assert.equal(y.son().tur, 'oda');
  assert.deepEqual(y.son().adimlar.map((x) => x.kimlik), ['light.a', 'light.c']);
  const oda = y.son();
  y.cikar(oda.id);
  assert.equal(y.son().kimlik, 'switch.b');
  y.geriKoy(oda);
  assert.equal(y.son(), oda, 'geri konan parti girdisi yine en üstte');
  assert.equal(y.sayi(), 2);
});

test('parti (oda kapatma): aynı partinin adımları tek girdide toplanır, tekrarlar atılır, adım sayısı sınırlıdır', () => {
  const { y } = yigin();
  const parti = { id: 'oda:salon', ad: 'Salon' };
  const a = y.ekle({ kimlik: 'light.a', ad: 'A', plan: aKapa('light.a'), kaynak: 'panel', parti });
  const b = y.ekle({ kimlik: 'light.b', ad: 'B', plan: aKapa('light.b'), kaynak: 'panel', parti });
  y.ekle({ kimlik: 'light.b', ad: 'B', plan: aKapa('light.b'), kaynak: 'panel', parti });
  assert.equal(a, b);
  assert.equal(y.sayi(), 1);
  assert.equal(y.son().tur, 'oda');
  assert.equal(y.son().ad, 'Salon');
  assert.deepEqual(y.son().adimlar.map((x) => x.kimlik), ['light.a', 'light.b']);
  for (let i = 0; i < EN_COK_ADIM + 10; i += 1) y.ekle({ kimlik: `switch.s${i}`, ad: 'S', plan: aKapa(`switch.s${i}`), kaynak: 'panel', parti });
  assert.equal(y.son().adimlar.length, EN_COK_ADIM);
  // başka parti ayrı girdi
  y.ekle({ kimlik: 'light.z', ad: 'Z', plan: aKapa('light.z'), kaynak: 'panel', parti: { id: 'oda:yatak', ad: 'Yatak' } });
  assert.equal(y.sayi(), 2);
});

test('geçersiz plan eklenmez; ekleme yığındaki özgün planı paylaşmaz (kopya)', () => {
  const { y } = yigin();
  assert.equal(y.ekle({ kimlik: 'light.a', ad: 'A', plan: null, kaynak: 'panel' }), null);
  assert.equal(y.ekle({ kimlik: 'light.a', ad: 'A', plan: { tur: 'ac-kapa', adimlar: [] }, kaynak: 'panel' }), null);
  const p = aKapa('light.a');
  y.ekle({ kimlik: 'light.a', ad: 'A', plan: p, kaynak: 'panel' });
  p.adimlar[0].eylem.servis = 'degisti';
  assert.equal(y.son().adimlar[0].eylem.servis, 'turn_on');
  assert.equal(y.sayi(), 1);
});

test('geriKoy: süresi dolmamış girdi sırasıyla geri döner; süresi dolmuş ya da zaten yığındaki eklenmez', () => {
  const { y, ileri } = yigin();
  y.ekle({ kimlik: 'switch.a', ad: 'A', plan: aKapa('switch.a'), kaynak: 'panel' });
  const b = y.ekle({ kimlik: 'switch.b', ad: 'B', plan: aKapa('switch.b'), kaynak: 'panel' });
  y.cikar(b.id);
  y.ekle({ kimlik: 'switch.c', ad: 'C', plan: aKapa('switch.c'), kaynak: 'panel' });
  y.geriKoy(b);
  assert.deepEqual([y.sayi(), y.son().kimlik], [3, 'switch.c'], 'sıra id ile korunur: c en yeni');
  y.geriKoy(b);
  assert.equal(y.sayi(), 3, 'çift eklenmez');
  const c = y.son();
  y.cikar(c.id);
  ileri(VARSAYILAN_SURE_MS + 1);
  y.geriKoy(c);
  assert.equal(y.sayi(), 0, 'süresi dolmuş geri konmaz');
});
