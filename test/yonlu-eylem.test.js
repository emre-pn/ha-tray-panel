'use strict';

// o-13: kesin yönlü eylemler. Saf karar katmanı (src/lib/yonlu-eylem.js) ve yön sözdizimi (src/lib/arama.js yonCoz).

const test = require('node:test');
const assert = require('node:assert/strict');
const { yonCoz } = require('../src/lib/arama');
const {
  AC_KAPAT_ALANLARI,
  yonDestekleniyorMu,
  kisayolEylemiYonu,
  kisayolEylemSecenekleri,
  kisayolEylemiGecerliMi,
  goreliParlaklik,
  goreliHiz,
} = require('../src/lib/yonlu-eylem');

const isik = (state, brightness) => ({ entity_id: 'light.led', state, attributes: brightness === undefined ? {} : { brightness } });
const fan = (state, percentage, percentage_step) => ({
  entity_id: 'fan.vantilator',
  state,
  attributes: { ...(percentage === undefined ? {} : { percentage }), ...(percentage_step === undefined ? {} : { percentage_step }) },
});

test('yonCoz: işaretli adım ayrılır (+10, -10, +10%, −5, +%10); işaret ve rakam bitişik olmalıdır', () => {
  assert.deepEqual(yonCoz('led +10'), { metin: 'led', yon: { tur: 'goreli', delta: 10 } });
  assert.deepEqual(yonCoz('led -10'), { metin: 'led', yon: { tur: 'goreli', delta: -10 } });
  assert.deepEqual(yonCoz('LED şerit +5%'), { metin: 'LED şerit', yon: { tur: 'goreli', delta: 5 } });
  assert.deepEqual(yonCoz('led +%20'), { metin: 'led', yon: { tur: 'goreli', delta: 20 } });
  assert.deepEqual(yonCoz('led −5'), { metin: 'led', yon: { tur: 'goreli', delta: -5 } }, 'Unicode eksi');
  assert.deepEqual(yonCoz('  led   +10  '), { metin: 'led', yon: { tur: 'goreli', delta: 10 } });
  assert.equal(yonCoz('led - 10'), null, 'boşluklu işaret yön değildir');
  assert.equal(yonCoz('led 10'), null, 'işaretsiz sayı parlaklıktır, yön değil');
  assert.equal(yonCoz('led +0'), null);
  assert.equal(yonCoz('led +101'), null);
  assert.equal(yonCoz('led +1000'), null);
  assert.equal(yonCoz('+10'), null, 'ad olmadan yön olmaz');
  assert.equal(yonCoz('Ses +'), null, 'adın parçası olan işaret');
  assert.equal(yonCoz('Salon - Işık'), null);
});

test('yonCoz: fiiller ayrılır (aç/yak/on, kapat/söndür/off, değiştir/toggle); Türkçe katlama uygulanır', () => {
  assert.deepEqual(yonCoz('salon ac'), { metin: 'salon', yon: { tur: 'ac' } });
  assert.deepEqual(yonCoz('SALON AÇ'), { metin: 'SALON', yon: { tur: 'ac' } });
  assert.deepEqual(yonCoz('salon yak'), { metin: 'salon', yon: { tur: 'ac' } });
  assert.deepEqual(yonCoz('salon on'), { metin: 'salon', yon: { tur: 'ac' } });
  assert.deepEqual(yonCoz('salon kapat'), { metin: 'salon', yon: { tur: 'kapat' } });
  assert.deepEqual(yonCoz('Salon KAPAT'), { metin: 'Salon', yon: { tur: 'kapat' } });
  assert.deepEqual(yonCoz('salon söndür'), { metin: 'salon', yon: { tur: 'kapat' } });
  assert.deepEqual(yonCoz('salon off'), { metin: 'salon', yon: { tur: 'kapat' } });
  assert.deepEqual(yonCoz('salon değiştir'), { metin: 'salon', yon: { tur: 'degistir' } });
  assert.deepEqual(yonCoz('salon toggle'), { metin: 'salon', yon: { tur: 'degistir' } });
  assert.deepEqual(yonCoz('gece lambası kapat'), { metin: 'gece lambası', yon: { tur: 'kapat' } });
  assert.equal(yonCoz('kapat'), null, 'tek sözcük fiil: ad yok');
  assert.equal(yonCoz('salon'), null);
  assert.equal(yonCoz('salon acik'), null);
  assert.equal(yonCoz(''), null);
  assert.equal(yonCoz(null), null);
  assert.equal(yonCoz(undefined), null);
});

test('yonDestekleniyorMu: aç/kapat yalnız ışık, priz, vantilatör, input_boolean, nem alıcıda; adım yalnız parlaklık kontrollü ışık ve vantilatörde', () => {
  const ac = { tur: 'ac' };
  const adim = { tur: 'goreli', delta: 10 };
  for (const alan of AC_KAPAT_ALANLARI) {
    assert.equal(yonDestekleniyorMu(ac, { id: `${alan}.x` }), true, alan);
    assert.equal(yonDestekleniyorMu({ tur: 'kapat' }, { id: `${alan}.x` }), true, alan);
  }
  for (const alan of ['scene', 'script', 'button', 'automation', 'lock', 'cover', 'camera', 'alarm_control_panel', 'climate', 'media_player', 'sensor']) {
    assert.equal(yonDestekleniyorMu(ac, { id: `${alan}.x` }), false, `${alan} aç/kapat desteklemez`);
    assert.equal(yonDestekleniyorMu(adim, { id: `${alan}.x` }), false, `${alan} adım desteklemez`);
  }
  assert.equal(yonDestekleniyorMu(adim, { id: 'light.led', parlaklikKontrol: true }), true);
  assert.equal(yonDestekleniyorMu(adim, { id: 'light.led', parlaklikKontrol: false }), false, 'kısılamayan ışığa adım uygulanmaz');
  assert.equal(yonDestekleniyorMu(adim, { id: 'light.led' }), false);
  assert.equal(yonDestekleniyorMu(adim, { id: 'fan.vantilator' }), true);
  assert.equal(yonDestekleniyorMu(adim, { id: 'switch.priz' }), false);
  assert.equal(yonDestekleniyorMu(null, { id: 'light.x' }), false);
  assert.equal(yonDestekleniyorMu(ac, null), false);
});

test('kisayolEylemiYonu: kapalı liste; geçersiz biçim ve adım null', () => {
  assert.deepEqual(kisayolEylemiYonu('ac'), { tur: 'ac' });
  assert.deepEqual(kisayolEylemiYonu('kapat'), { tur: 'kapat' });
  assert.deepEqual(kisayolEylemiYonu('parlak+10'), { tur: 'goreli', hedef: 'parlaklik', delta: 10 });
  assert.deepEqual(kisayolEylemiYonu('parlak-20'), { tur: 'goreli', hedef: 'parlaklik', delta: -20 });
  assert.deepEqual(kisayolEylemiYonu('parlak+5'), { tur: 'goreli', hedef: 'parlaklik', delta: 5 });
  assert.deepEqual(kisayolEylemiYonu('hiz+10'), { tur: 'goreli', hedef: 'hiz', delta: 10 });
  assert.deepEqual(kisayolEylemiYonu('hiz-20'), { tur: 'goreli', hedef: 'hiz', delta: -20 });
  for (const kotu of ['', 'toggle', 'degistir', 'parlak+7', 'parlak+0', 'parlak+50', 'parlak+100', 'hiz+5', 'hiz+30', 'AC', 'ac ', 'turn_off', 'parlak', 'parlak+', 'light.turn_on', null, undefined, 5, {}, []]) {
    assert.equal(kisayolEylemiYonu(kotu), null, String(kotu));
  }
});

test('kisayolEylemSecenekleri: alana göre kapalı liste; aç-kapa listede yoktur (boş değer varsayılandır)', () => {
  assert.deepEqual(kisayolEylemSecenekleri('light'), ['ac', 'kapat', 'parlak+5', 'parlak+10', 'parlak+20', 'parlak-5', 'parlak-10', 'parlak-20']);
  assert.deepEqual(kisayolEylemSecenekleri('fan'), ['ac', 'kapat', 'hiz+10', 'hiz+20', 'hiz-10', 'hiz-20']);
  for (const alan of ['switch', 'input_boolean', 'humidifier']) assert.deepEqual(kisayolEylemSecenekleri(alan), ['ac', 'kapat'], alan);
  for (const alan of ['scene', 'script', 'button', 'lock', 'cover', 'camera', 'sensor', '', undefined]) assert.deepEqual(kisayolEylemSecenekleri(alan), [], String(alan));
  // Listedeki her değer yönü çözülebilir olmalı.
  for (const alan of AC_KAPAT_ALANLARI) for (const d of kisayolEylemSecenekleri(alan)) assert.notEqual(kisayolEylemiYonu(d), null, `${alan}/${d}`);
});

test('kisayolEylemiGecerliMi: parlaklık adımı yalnız parlaklık kontrolü açık ışıkta; hız adımı yalnız vantilatörde', () => {
  assert.equal(kisayolEylemiGecerliMi('light', 'ac', {}), true);
  assert.equal(kisayolEylemiGecerliMi('light', 'kapat', undefined), true);
  assert.equal(kisayolEylemiGecerliMi('light', 'parlak+10', { parlaklik: true }), true);
  assert.equal(kisayolEylemiGecerliMi('light', 'parlak+10', { parlaklik: false }), false);
  assert.equal(kisayolEylemiGecerliMi('light', 'parlak+10', {}), false);
  assert.equal(kisayolEylemiGecerliMi('light', 'hiz+10', { parlaklik: true }), false, 'ışık için hız adımı yok');
  assert.equal(kisayolEylemiGecerliMi('fan', 'hiz-20', {}), true);
  assert.equal(kisayolEylemiGecerliMi('fan', 'parlak+10', { parlaklik: true }), false);
  assert.equal(kisayolEylemiGecerliMi('switch', 'ac', {}), true);
  assert.equal(kisayolEylemiGecerliMi('switch', 'parlak+10', { parlaklik: true }), false);
  assert.equal(kisayolEylemiGecerliMi('scene', 'ac', {}), false);
  assert.equal(kisayolEylemiGecerliMi('lock', 'ac', {}), false, 'kilit hiçbir yön almaz');
  assert.equal(kisayolEylemiGecerliMi('light', 'bilinmeyen', {}), false);
  assert.equal(kisayolEylemiGecerliMi('light', '', {}), false);
});

test('goreliParlaklik: açık ışıkta yüzde kayar, 1..100 arasında kalır; kapalıyken artı adım açar, eksi adım bir şey yapmaz', () => {
  assert.deepEqual(goreliParlaklik(isik('on', 128), 10), { tur: 'ayarla', yuzde: 60 }, '128/255 = %50 + 10');
  assert.deepEqual(goreliParlaklik(isik('on', 128), -10), { tur: 'ayarla', yuzde: 40 });
  assert.deepEqual(goreliParlaklik(isik('on', 255), 10), { tur: 'degisim-yok' }, '%100 üstüne çıkmaz');
  assert.deepEqual(goreliParlaklik(isik('on', 245), 20), { tur: 'ayarla', yuzde: 100 }, 'sınıra kenetlenir');
  assert.deepEqual(goreliParlaklik(isik('on', 13), -20), { tur: 'ayarla', yuzde: 1 }, 'eksi adım ışığı kapatmaz, %1\'e iner');
  assert.deepEqual(goreliParlaklik(isik('on', 3), -5), { tur: 'degisim-yok' }, 'zaten en düşükte');
  assert.deepEqual(goreliParlaklik(isik('off'), 10), { tur: 'ayarla', yuzde: 10 }, 'kapalı ışık +10 ile %10 açılır');
  assert.deepEqual(goreliParlaklik(isik('off'), 20), { tur: 'ayarla', yuzde: 20 });
  assert.deepEqual(goreliParlaklik(isik('off'), -10), { tur: 'degisim-yok' });
  assert.deepEqual(goreliParlaklik(isik('unavailable'), 10), { tur: 'ulasilamiyor' });
  assert.deepEqual(goreliParlaklik(isik('unknown'), 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliParlaklik(isik('on'), 10), { tur: 'desteklenmiyor' }, 'parlaklık bildirmeyen ışıkta hesap yapılmaz');
  assert.deepEqual(goreliParlaklik(isik('on', 'abc'), 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliParlaklik(isik('on', 128), 0), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliParlaklik(isik('on', 128), 2.5), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliParlaklik(null, 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliParlaklik(undefined, 10), { tur: 'desteklenmiyor' });
});

test('goreliHiz: yüzde 0..100 arasında kalır; kapalıyken artı adım o hızla açar; bilinmeyen hızda hesap yapılmaz', () => {
  assert.deepEqual(goreliHiz(fan('on', 50), 20), { tur: 'ayarla', yuzde: 70 });
  assert.deepEqual(goreliHiz(fan('on', 50), -10), { tur: 'ayarla', yuzde: 40 });
  assert.deepEqual(goreliHiz(fan('on', 95), 20), { tur: 'ayarla', yuzde: 100 });
  assert.deepEqual(goreliHiz(fan('on', 100), 10), { tur: 'degisim-yok' });
  assert.deepEqual(goreliHiz(fan('on', 10), -20), { tur: 'ayarla', yuzde: 0 }, '0 vantilatörü kapatır (HA davranışı)');
  assert.deepEqual(goreliHiz(fan('off'), 10), { tur: 'ayarla', yuzde: 10 });
  assert.deepEqual(goreliHiz(fan('off'), -10), { tur: 'degisim-yok' });
  assert.deepEqual(goreliHiz(fan('unavailable'), 10), { tur: 'ulasilamiyor' });
  assert.deepEqual(goreliHiz(fan('on'), 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliHiz(fan('on', '50'), 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliHiz(fan('on', NaN), 10), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliHiz(fan('on', 50), 0), { tur: 'desteklenmiyor' });
  assert.deepEqual(goreliHiz(null, 10), { tur: 'desteklenmiyor' });
});

test('goreliHiz: basamaklı fanda (percentage_step) delta hız basamağına çevrilir; gönderilen yüzde HA eşlemesinde hedef basamağa düşer', () => {
  // HA percentage_to_ordered_list_item: ceil(yüzde * hızSayısı / 100) numaralı hız
  const hiz = (yuzde, hizSayisi) => Math.ceil((yuzde * hizSayisi) / 100);
  const ADIM3 = 33.333333333333336;
  assert.deepEqual(goreliHiz(fan('on', 100, ADIM3), -20), { tur: 'ayarla', yuzde: 66 });
  assert.deepEqual(goreliHiz(fan('on', 67, ADIM3), -10), { tur: 'ayarla', yuzde: 33 });
  assert.deepEqual(goreliHiz(fan('on', 66, ADIM3), -10), { tur: 'ayarla', yuzde: 33 });
  assert.deepEqual(goreliHiz(fan('on', 33, ADIM3), -10), { tur: 'ayarla', yuzde: 0 }, 'en düşük basamaktan eksi fanı kapatır (HA davranışı)');
  assert.deepEqual(goreliHiz(fan('on', 33, ADIM3), 10), { tur: 'ayarla', yuzde: 66 });
  assert.deepEqual(goreliHiz(fan('on', 66, ADIM3), 10), { tur: 'ayarla', yuzde: 100 });
  assert.deepEqual(goreliHiz(fan('on', 100, ADIM3), 10), { tur: 'degisim-yok' });
  assert.deepEqual(goreliHiz(fan('off', undefined, ADIM3), 10), { tur: 'ayarla', yuzde: 33 }, 'kapalı fanda artı adım en az bir basamak açar');
  assert.deepEqual(goreliHiz(fan('off', undefined, ADIM3), -10), { tur: 'degisim-yok' });
  assert.deepEqual(goreliHiz(fan('on', 100, 25), -10), { tur: 'ayarla', yuzde: 75 });
  assert.deepEqual(goreliHiz(fan('on', 50, 25), 60), { tur: 'ayarla', yuzde: 100 }, 'büyük delta birden çok basamak atlar, 100 ile sınırlı');
  assert.deepEqual(goreliHiz(fan('on', 50, 25), -60), { tur: 'ayarla', yuzde: 0 });
  // gönderilen yüzde gerçekten bir alt/üst basamağa düşer (HA yukarı yuvarlamasıyla)
  for (const [hizSayisi, adim] of [[3, ADIM3], [4, 25], [6, 100 / 6], [7, 100 / 7]]) {
    for (let mevcut = 1; mevcut <= hizSayisi; mevcut += 1) {
      const yuzde = mevcut === hizSayisi ? 100 : Math.floor(mevcut * adim);
      for (const delta of [-20, -10, 10, 20]) {
        const s = goreliHiz(fan('on', yuzde, adim), delta);
        const beklenen = Math.max(0, Math.min(hizSayisi, mevcut + Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / adim))));
        if (beklenen === mevcut) assert.equal(s.tur, 'degisim-yok', `${hizSayisi} hız, ${mevcut}. basamak, ${delta}`);
        else {
          assert.equal(s.tur, 'ayarla', `${hizSayisi} hız, ${mevcut}. basamak, ${delta}`);
          assert.equal(s.yuzde === 0 ? 0 : hiz(s.yuzde, hizSayisi), beklenen, `${hizSayisi} hız, ${mevcut}. basamak, ${delta}: ${s.yuzde}`);
        }
      }
    }
  }
  // adım yoksa ya da 1 ise (sürekli ölçek) yüzde hesabı aynen
  for (const adim of [undefined, 1, 0.5, 0, null, 150]) {
    assert.deepEqual(goreliHiz(fan('on', 50, adim), 20), { tur: 'ayarla', yuzde: 70 }, String(adim));
    assert.deepEqual(goreliHiz(fan('on', 50, adim), -10), { tur: 'ayarla', yuzde: 40 }, String(adim));
  }
});
