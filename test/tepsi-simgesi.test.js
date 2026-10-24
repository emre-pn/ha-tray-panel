'use strict';

// 1.4.0 (o-27): tepsi simgesi çizimi (bağımlılıksız PNG), rozet metni/yerleşimi ve güncelleme sınırlayıcı.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  IZGARA,
  EN_COK_ROZET_KARAKTERI,
  ROZET_TURLERI,
  GLIFLER,
  temelRgba,
  sayiRozetMetni,
  isikRozeti,
  sensorRozeti,
  rozetBelirle,
  sensorIpucuEki,
  rozetYerlesimi,
  rozetCiz,
  simgeRgba,
  simgePng,
  tepsiSimgeBoyutu,
  simgeAnahtari,
  tepsiSimgeDenetleyicisi,
} = require('../src/lib/tepsi-simgesi');
const { pngUret } = require('../araclar/ikon-uret');

const PNG_IMZASI = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Yardımcılar -------------------------------------------------------------------------------------------------------------------

const crcTablosu = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const bayt of buf) c = crcTablosu[(c ^ bayt) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG'yi parçalar, imzayı ve her parçanın CRC'sini doğrular; { boyut, rgba } (satır filtresi 'None' varsayılır) döndürür. */
function pngCoz(png) {
  assert.ok(png.subarray(0, 8).equals(PNG_IMZASI), 'PNG imzası');
  let ofset = 8;
  const parcalar = [];
  while (ofset < png.length) {
    const uzunluk = png.readUInt32BE(ofset);
    const tip = png.subarray(ofset + 4, ofset + 8).toString('ascii');
    const veri = png.subarray(ofset + 8, ofset + 8 + uzunluk);
    const beklenen = png.readUInt32BE(ofset + 8 + uzunluk);
    assert.equal(crc(Buffer.concat([Buffer.from(tip, 'ascii'), veri])), beklenen, `${tip} CRC`);
    parcalar.push({ tip, veri });
    ofset += 12 + uzunluk;
  }
  assert.equal(ofset, png.length, 'fazladan bayt yok');
  assert.deepEqual(parcalar.map((p) => p.tip), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = parcalar[0].veri;
  const genislik = ihdr.readUInt32BE(0);
  const yukseklik = ihdr.readUInt32BE(4);
  assert.equal(genislik, yukseklik);
  assert.equal(ihdr[8], 8, '8 bit');
  assert.equal(ihdr[9], 6, 'RGBA');
  const ham = zlib.inflateSync(parcalar[1].veri);
  assert.equal(ham.length, (genislik * 4 + 1) * yukseklik);
  const rgba = Buffer.alloc(genislik * yukseklik * 4);
  for (let y = 0; y < yukseklik; y++) {
    assert.equal(ham[y * (genislik * 4 + 1)], 0, 'satır filtresi None');
    ham.copy(rgba, y * genislik * 4, y * (genislik * 4 + 1) + 1, (y + 1) * (genislik * 4 + 1));
  }
  return { boyut: genislik, rgba };
}

const piksel = (rgba, boyut, x, y) => [...rgba.subarray((y * boyut + x) * 4, (y * boyut + x) * 4 + 4)];

function parlaklik([r, g, b]) {
  const k = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}
const kontrast = (a, b) => {
  const [acik, koyu] = [parlaklik(a), parlaklik(b)].sort((x, y) => y - x);
  return (acik + 0.05) / (koyu + 0.05);
};

const sensor = (kimlik, durum, nitelik = {}) => ({ entity_id: kimlik, state: durum, attributes: nitelik });

// --- Rozet metni -------------------------------------------------------------------------------------------------------------------

test('sayiRozetMetni: en çok 3 karakter; 10 altı bir ondalık, büyük tam sayı, binler "k"', () => {
  assert.equal(sayiRozetMetni(7), '7');
  assert.equal(sayiRozetMetni(9.5), '9.5');
  assert.equal(sayiRozetMetni(9.96), '10', '10\'a yuvarlanan değer iki hane');
  assert.equal(sayiRozetMetni(0), '0');
  assert.equal(sayiRozetMetni(-4), '-4');
  assert.equal(sayiRozetMetni(-9.5), '-10', 'yarımlar sıfırdan uzağa yuvarlanır');
  assert.equal(sayiRozetMetni(-2.5), '-3', '"-2.5" 4 karakter: tam sayıya yuvarlanır');
  assert.equal(sayiRozetMetni(-2.4), '-2');
  assert.equal(sayiRozetMetni(-0.04), '0', '"-0" yazılmaz');
  assert.equal(sayiRozetMetni(21.5), '22');
  assert.equal(sayiRozetMetni(999), '999');
  assert.equal(sayiRozetMetni(1000), '1k');
  assert.equal(sayiRozetMetni(2400), '2k');
  assert.equal(sayiRozetMetni(15000), '15k');
  assert.equal(sayiRozetMetni(99000), '99k');
  assert.equal(sayiRozetMetni(-12), '-12');
  assert.equal(sayiRozetMetni(-1200), '-1k');
});

test('sayiRozetMetni: sığmayan ya da sayı olmayan değer için rozet yok (yanlış değer göstermektense)', () => {
  assert.equal(sayiRozetMetni(100000), null);
  assert.equal(sayiRozetMetni(-100000), null);
  assert.equal(sayiRozetMetni(-999.4), '-1k', '"-999" 4 karakter: binliğe yuvarlanır');
  assert.equal(sayiRozetMetni(-100000), null);
  assert.equal(sayiRozetMetni(1e12), null);
  for (const kotu of [NaN, Infinity, -Infinity, '5', null, undefined, {}]) assert.equal(sayiRozetMetni(kotu), null, String(kotu));
  for (const d of [0, 3.14, 21.5, 123, 1500, -7, 54321]) {
    const m = sayiRozetMetni(d);
    if (m !== null) assert.ok(m.length <= EN_COK_ROZET_KARAKTERI && [...m].every((k) => Object.hasOwn(GLIFLER, k)), `${d} -> ${m}`);
  }
});

test('isikRozeti: 0 ya da bilinmeyen sayıda rozet yok; 99\'dan büyük sayı "99"', () => {
  assert.deepEqual(isikRozeti(3), { tur: 'isik', metin: '3' });
  assert.deepEqual(isikRozeti(99), { tur: 'isik', metin: '99' });
  assert.deepEqual(isikRozeti(240), { tur: 'isik', metin: '99' });
  for (const kotu of [0, -1, 1.5, NaN, null, undefined, '3']) assert.equal(isikRozeti(kotu), null, String(kotu));
});

test('sensorRozeti: sayısal sensör rozet verir; metin değerli, ulaşılamayan ve sensör olmayan varlık vermez', () => {
  assert.deepEqual(sensorRozeti(sensor('sensor.salon_sicaklik', '21.5', { unit_of_measurement: '°C', device_class: 'temperature' })), { tur: 'sensor', metin: '22' });
  assert.deepEqual(sensorRozeti(sensor('sensor.nem', '48', { unit_of_measurement: '%' })), { tur: 'sensor', metin: '48' });
  assert.equal(sensorRozeti(sensor('sensor.yedek', 'unavailable')), null);
  assert.equal(sensorRozeti(sensor('sensor.yedek', 'unknown')), null);
  assert.equal(sensorRozeti(sensor('sensor.durum', 'cooling')), null, 'metin değerli sensör');
  assert.equal(sensorRozeti(sensor('sensor.buyuk', '123456')), null, 'sığmayan değer');
  for (const kotu of [null, undefined, 5, 'sensor.x', {}, { entity_id: 5 }]) assert.equal(sensorRozeti(kotu), null);
});

test('sensorRozeti (Kapı Kuralı): kapı/kilit/alarm sözcüklü ad, yasak cihaz sınıfı ve sensör dışı alanlar rozet üretmez', () => {
  assert.equal(sensorRozeti(sensor('sensor.giris_kapisi_sicaklik', '21')), null, 'kimlikte kapı');
  assert.equal(sensorRozeti(sensor('sensor.sicaklik', '21', { friendly_name: 'Ön kapı sıcaklığı' })), null, 'adda kapı');
  assert.equal(sensorRozeti(sensor('sensor.sicaklik', '21', { friendly_name: 'Front door temperature' })), null);
  assert.equal(sensorRozeti(sensor('sensor.sicaklik', '21', { friendly_name: 'Garaj' })), null);
  assert.equal(sensorRozeti(sensor('sensor.sicaklik', '21', { device_class: 'door' })), null, 'cihaz sınıfı');
  assert.equal(sensorRozeti(sensor('binary_sensor.salon_hareket', 'on')), null, 'ikili sensör sayı değil');
  assert.equal(sensorRozeti(sensor('lock.on_kapi', '5')), null);
  assert.equal(sensorRozeti(sensor('alarm_control_panel.ev', '5')), null);
  assert.equal(sensorRozeti(sensor('cover.garaj', '5')), null);
  assert.equal(sensorRozeti(sensor('light.salon', '5')), null, 'sensör olmayan alan');
  assert.equal(sensorRozeti(sensor('number.hedef', '5')), null);
  assert.ok(sensorRozeti(sensor('sensor.salon_sicaklik', '21', { friendly_name: 'Salon sıcaklığı' })), 'zararsız ad geçer');
});

test('rozetBelirle: kapali -> yok; isik -> ışık sayısı; sensor -> sensör; bilinmeyen mod -> yok', () => {
  const salon = sensor('sensor.salon', '19');
  assert.equal(rozetBelirle({ mod: 'kapali', acikIsik: 4, sensorVarligi: salon }), null);
  assert.deepEqual(rozetBelirle({ mod: 'isik', acikIsik: 4, sensorVarligi: salon }), { tur: 'isik', metin: '4' });
  assert.equal(rozetBelirle({ mod: 'isik', acikIsik: 0, sensorVarligi: salon }), null);
  assert.deepEqual(rozetBelirle({ mod: 'sensor', acikIsik: 4, sensorVarligi: salon }), { tur: 'sensor', metin: '19' });
  assert.equal(rozetBelirle({ mod: 'sensor', acikIsik: 4 }), null);
  assert.equal(rozetBelirle({ mod: 'garip', acikIsik: 4, sensorVarligi: salon }), null);
  assert.equal(rozetBelirle({}), null);
});

test('sensorIpucuEki: hassasiyet (suggested_display_precision) uygulanır, float artığı yazılmaz; ondalık ayracı dile uyar; rozetle aynı sayıyı gösterir', () => {
  const s = sensor('sensor.salon', '23.600000381469727', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C', suggested_display_precision: 1 });
  assert.equal(sensorIpucuEki(s), 'Salon sıcaklığı: 23,6 °C');
  assert.equal(sensorIpucuEki(s, { dil: 'tr' }), 'Salon sıcaklığı: 23,6 °C');
  assert.equal(sensorIpucuEki(s, { dil: 'en' }), 'Salon sıcaklığı: 23.6 °C');
  assert.equal(sensorIpucuEki(s, { dil: 'de' }), 'Salon sıcaklığı: 23,6 °C');
  assert.equal(sensorIpucuEki(s, { dil: 'bilinmeyen' }), 'Salon sıcaklığı: 23,6 °C', 'bilinmeyen dil tr sayılır');
  assert.doesNotMatch(sensorIpucuEki(s), /600000/);
  const pil = sensor('sensor.pil', '79.5', { friendly_name: 'Pil', unit_of_measurement: '%', suggested_display_precision: 0 });
  assert.equal(sensorIpucuEki(pil, { dil: 'tr' }), 'Pil: %80');
  assert.equal(sensorIpucuEki(pil, { dil: 'en' }), 'Pil: 80%');
  // hassasiyet yoksa en çok iki ondalık değil, HA'nın verdiği kadar (gereksiz artık yok); metin değerli sensör ipucuna girmez
  assert.equal(sensorIpucuEki(sensor('sensor.metin', 'abc', { friendly_name: 'Metin' })), null);
});

test('sensorIpucuEki: "Ad: değer birim"; ad süzgeçten geçmezse ya da rozet yoksa null', () => {
  assert.equal(sensorIpucuEki(sensor('sensor.salon', '21.5', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' })), 'Salon sıcaklığı: 21,5 °C', 'varsayılan dil tr: virgül');
  assert.equal(sensorIpucuEki(sensor('sensor.salon', '21.5', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' }), { dil: 'en' }), 'Salon sıcaklığı: 21.5 °C');
  assert.equal(sensorIpucuEki(sensor('sensor.salon', '48', { friendly_name: 'Nem' })), 'Nem: 48');
  assert.equal(sensorIpucuEki(sensor('sensor.salon', '21', {})), null, 'adsız sensör');
  assert.equal(sensorIpucuEki(sensor('sensor.salon', 'unavailable', { friendly_name: 'Salon' })), null);
  assert.equal(sensorIpucuEki(sensor('sensor.salon', '21', { friendly_name: 'Ön kapı sıcaklığı' })), null, 'Kapı Kuralı');
  assert.equal(sensorIpucuEki(sensor('lock.on_kapi', '21', { friendly_name: 'Kapı' })), null);
  assert.equal(sensorIpucuEki(null), null);
  const uzun = sensorIpucuEki(sensor('sensor.s', '5', { friendly_name: 'A'.repeat(200) }));
  assert.ok(uzun === null || uzun.length <= 40 + 2 + 40 + 1 + 12, 'ad kısaltılır');
});

// --- Yerleşim ve çizim -------------------------------------------------------------------------------------------------------------

test('rozetYerlesimi: sağ alt köşeye yaslı, ızgara içinde, glifler zemin içinde; 1-3 karakter', () => {
  for (const metin of ['5', '42', '99', '9.5', '-4', '2k', '15k'.slice(0, 3), '100']) {
    const y = rozetYerlesimi(metin);
    assert.ok(y, metin);
    assert.equal(y.x1, IZGARA);
    assert.equal(y.y1, IZGARA);
    assert.ok(y.x0 >= 0 && y.y0 >= 0, `${metin} sol üst ızgara içinde`);
    assert.equal(y.glifler.length, metin.length);
    for (const g of y.glifler) {
      const genislik = g.satirlar[0].length;
      assert.ok(g.x >= y.x0 + 1 && g.x + genislik <= y.x1 - 1, `${metin} glif zemin içinde`);
      assert.ok(g.y >= y.y0 + 1 && g.y + 5 <= y.y1 - 1);
    }
  }
  const tek = rozetYerlesimi('5');
  const cift = rozetYerlesimi('55');
  assert.ok(cift.x0 < tek.x0, 'daha uzun metin daha geniş rozet');
  assert.equal(tek.y1 - tek.y0, 7, '5 satırlık yazı + 1 + 1 dolgu');
});

test('rozetYerlesimi: boş, 3 karakterden uzun ya da glifi olmayan karakter için null', () => {
  for (const kotu of ['', '1234', 'a', 'x1', '1 2', null, undefined, 5]) assert.equal(rozetYerlesimi(kotu), null, String(kotu));
  assert.ok(rozetYerlesimi('0'));
  assert.ok(rozetYerlesimi('k'));
  assert.ok(rozetYerlesimi('.'));
});

test('glifler: her biri 5 satır, satır uzunlukları eşit, yalnız 0/1', () => {
  for (const [karakter, satirlar] of Object.entries(GLIFLER)) {
    assert.equal(satirlar.length, 5, karakter);
    assert.equal(new Set(satirlar.map((s) => s.length)).size, 1, `${karakter} satır genişlikleri eşit`);
    assert.ok(satirlar.every((s) => /^[01]+$/.test(s)), karakter);
    assert.ok(satirlar.some((s) => s.includes('1')), `${karakter} boş değil`);
  }
  for (const rakam of '0123456789') assert.ok(Object.hasOwn(GLIFLER, rakam));
});

test('rozet renkleri: yazı/zemin kontrastı en az 4,5:1', () => {
  for (const [tur, renkler] of Object.entries(ROZET_TURLERI)) {
    assert.ok(kontrast(renkler.zemin, renkler.yazi) >= 4.5, `${tur}: ${kontrast(renkler.zemin, renkler.yazi).toFixed(2)}`);
  }
});

test('simgeRgba: rozetsiz çıktı temel simgeyle aynı; rozet yalnız sağ alt bölgeyi değiştirir', () => {
  for (const boyut of [16, 20, 24, 32]) {
    const temel = simgeRgba({ boyut });
    assert.ok(temel.equals(temelRgba(boyut, false)), `${boyut} rozetsiz = temel`);
    const rozetli = simgeRgba({ boyut, rozet: { tur: 'isik', metin: '3' } });
    assert.equal(rozetli.length, temel.length);
    assert.equal(rozetli.equals(temel), false, `${boyut} rozet bir şey çizer`);
    const y = rozetYerlesimi('3');
    const sinir = Math.floor((y.x0 * boyut) / IZGARA) - 1;
    const ustSinir = Math.floor((y.y0 * boyut) / IZGARA) - 1;
    for (let py = 0; py < boyut; py++) {
      for (let px = 0; px < boyut; px++) {
        if (px >= sinir && py >= ustSinir) continue;
        assert.deepEqual(piksel(rozetli, boyut, px, py), piksel(temel, boyut, px, py), `${boyut}: (${px},${py}) rozet bölgesi dışında değişmemeli`);
      }
    }
  }
});

test('simgeRgba: rozet alanı zemin rengiyle başlar, glif pikselleri yazı rengindedir; tür rengi doğru', () => {
  const boyut = 32;
  for (const tur of ['isik', 'sensor']) {
    const rgba = simgeRgba({ boyut, rozet: { tur, metin: '8' } });
    const y = rozetYerlesimi('8');
    const renk = ROZET_TURLERI[tur];
    const orta = (b) => Math.round((b * boyut) / IZGARA);
    // zemin: rozet sol üst glif dışı dolgu hücresi (dolgu 1 birim = 2 piksel; köşe kesikten uzak bir nokta)
    assert.deepEqual(piksel(rgba, boyut, orta(y.x0) + 1, orta(y.y0) + 4).slice(0, 3), renk.zemin, `${tur} zemin (sol dolgu sütunu)`);
    // '8' glifinin sol üst hücresi dolu: yazı rengi
    const g = y.glifler[0];
    assert.deepEqual(piksel(rgba, boyut, orta(g.x) + 1, orta(g.y) + 1).slice(0, 3), renk.yazi, `${tur} yazı`);
    assert.equal(piksel(rgba, boyut, orta(g.x) + 1, orta(g.y) + 1)[3], 255);
  }
});

test('simgeRgba: soluk simgede (bağlantı yok) rozet çizilmez; geçersiz rozet bir şey çizmez', () => {
  for (const boyut of [16, 32]) {
    const soluk = simgeRgba({ boyut, soluk: true, rozet: { tur: 'isik', metin: '7' } });
    assert.ok(soluk.equals(temelRgba(boyut, true)), 'soluk simgede rozet yok');
  }
  const temel = temelRgba(16, false);
  for (const kotu of [{ tur: 'garip', metin: '3' }, { tur: 'isik', metin: '1234' }, { tur: 'isik', metin: 'x' }, { tur: 'isik' }, {}, null]) {
    assert.ok(simgeRgba({ boyut: 16, rozet: kotu }).equals(temel), JSON.stringify(kotu));
  }
  const ara = Buffer.from(temel);
  assert.equal(rozetCiz(ara, 16, { tur: 'garip', metin: '3' }), false);
  assert.equal(rozetCiz(ara, 16, { tur: 'isik', metin: '3' }), true);
});

test('simgeRgba: boyut 16..64 aralığına kıstırılır, tam sayı değilse 16', () => {
  assert.equal(simgeRgba({ boyut: 5 }).length, 16 * 16 * 4);
  assert.equal(simgeRgba({ boyut: 1000 }).length, 64 * 64 * 4);
  assert.equal(simgeRgba({ boyut: 20.5 }).length, 16 * 16 * 4);
  assert.equal(simgeRgba({ boyut: '32' }).length, 16 * 16 * 4);
  assert.equal(simgeRgba().length, 16 * 16 * 4);
});

// --- PNG ---------------------------------------------------------------------------------------------------------------------------

test('simgePng: geçerli PNG (imza, CRC, IHDR, IDAT, IEND) ve pikseller simgeRgba ile aynı', () => {
  for (const [boyut, rozet] of [[16, null], [16, { tur: 'isik', metin: '12' }], [24, { tur: 'sensor', metin: '-4' }], [32, { tur: 'isik', metin: '99' }]]) {
    const png = simgePng({ boyut, rozet });
    const { boyut: okunan, rgba } = pngCoz(png);
    assert.equal(okunan, boyut);
    assert.ok(rgba.equals(simgeRgba({ boyut, rozet })), `${boyut} ${JSON.stringify(rozet)}`);
  }
  assert.equal(pngCoz(simgePng({ boyut: 3 })).boyut, 16);
  assert.equal(pngCoz(simgePng()).boyut, 16);
});

test('assets/ikon.png ve ikon-soluk.png çizimi paylaşılan koddan çıkan görüntüyle birebir aynı (yeniden düzenleme simgeyi değiştirmedi)', () => {
  for (const [dosya, soluk] of [['ikon.png', false], ['ikon-soluk.png', true]]) {
    const varlik = pngCoz(fs.readFileSync(path.join(__dirname, '..', 'assets', dosya)));
    assert.equal(varlik.boyut, 256);
    assert.ok(varlik.rgba.equals(temelRgba(256, soluk)), dosya);
    assert.ok(pngCoz(pngUret(256, soluk)).rgba.equals(varlik.rgba), `${dosya}: araç çıktısı`);
  }
});

test('tepsiSimgeBoyutu: 16 * ölçek, 16..64 arası; bozuk ölçek 16', () => {
  assert.equal(tepsiSimgeBoyutu(1), 16);
  assert.equal(tepsiSimgeBoyutu(1.25), 20);
  assert.equal(tepsiSimgeBoyutu(1.5), 24);
  assert.equal(tepsiSimgeBoyutu(2), 32);
  assert.equal(tepsiSimgeBoyutu(4), 64);
  assert.equal(tepsiSimgeBoyutu(10), 64);
  assert.equal(tepsiSimgeBoyutu(0.5), 16);
  for (const kotu of [0, -2, NaN, Infinity, '2', null, undefined]) assert.equal(tepsiSimgeBoyutu(kotu), 16, String(kotu));
});

test('simgeAnahtari: aynı görüntü aynı anahtar; soluk rozeti yok sayar; geçersiz rozet anahtara girmez', () => {
  const a = simgeAnahtari({ boyut: 16, soluk: false, rozet: { tur: 'isik', metin: '3' } });
  assert.equal(a, simgeAnahtari({ boyut: 16, soluk: false, rozet: { tur: 'isik', metin: '3' } }));
  assert.notEqual(a, simgeAnahtari({ boyut: 16, soluk: false, rozet: { tur: 'isik', metin: '4' } }));
  assert.notEqual(a, simgeAnahtari({ boyut: 16, soluk: false, rozet: { tur: 'sensor', metin: '3' } }));
  assert.notEqual(a, simgeAnahtari({ boyut: 32, soluk: false, rozet: { tur: 'isik', metin: '3' } }));
  assert.equal(simgeAnahtari({ boyut: 16, soluk: true, rozet: { tur: 'isik', metin: '3' } }), simgeAnahtari({ boyut: 16, soluk: true, rozet: null }));
  assert.equal(simgeAnahtari({ boyut: 16, soluk: false, rozet: { tur: 'garip', metin: '3' } }), simgeAnahtari({ boyut: 16, soluk: false, rozet: null }));
});

// --- Güncelleme sınırlayıcı --------------------------------------------------------------------------------------------------------

function denetleyiciKur({ uygula, aralikMs = 1000 } = {}) {
  const o = { an: 0, uygulananlar: [], zamanlayicilar: new Map(), sonKimlik: 0 };
  const zaman = {
    setTimeout(fn, ms) {
      const kimlik = ++o.sonKimlik;
      o.zamanlayicilar.set(kimlik, { fn, ms });
      return kimlik;
    },
    clearTimeout(kimlik) {
      o.zamanlayicilar.delete(kimlik);
    },
  };
  o.denetleyici = tepsiSimgeDenetleyicisi({
    uygula: uygula ?? ((d) => o.uygulananlar.push(d.anahtar)),
    simdi: () => o.an,
    zaman,
    aralikMs,
  });
  o.tetikle = () => {
    const [kimlik, z] = [...o.zamanlayicilar.entries()][0];
    o.zamanlayicilar.delete(kimlik);
    z.fn();
  };
  return o;
}

test('denetleyici: aynı anahtar yeniden yazılmaz; ilk değişim süre dolmuşsa hemen uygulanır', () => {
  const o = denetleyiciKur();
  o.denetleyici.baslangic('dosya|normal');
  o.denetleyici.iste({ anahtar: 'dosya|normal' });
  assert.deepEqual(o.uygulananlar, []);
  o.an = 5000;
  o.denetleyici.iste({ anahtar: 'a' });
  assert.deepEqual(o.uygulananlar, ['a']);
  o.denetleyici.iste({ anahtar: 'a' });
  assert.deepEqual(o.uygulananlar, ['a']);
  assert.equal(o.denetleyici.uygulanan(), 'a');
});

test('denetleyici: saniyede en çok bir değişim; pencere içindekilerin SONUNCUSU pencere sonunda uygulanır', () => {
  const o = denetleyiciKur();
  o.denetleyici.baslangic('dosya|normal');
  o.an = 5000;
  o.denetleyici.iste({ anahtar: 'a' }); // hemen
  o.an = 5100;
  o.denetleyici.iste({ anahtar: 'b' });
  o.an = 5200;
  o.denetleyici.iste({ anahtar: 'c' });
  o.an = 5300;
  o.denetleyici.iste({ anahtar: 'd' });
  assert.deepEqual(o.uygulananlar, ['a'], 'aradakiler bekler');
  assert.equal(o.zamanlayicilar.size, 1, 'tek zamanlayıcı');
  assert.equal([...o.zamanlayicilar.values()][0].ms, 900, 'kalan süre kadar');
  o.an = 6000;
  o.tetikle();
  assert.deepEqual(o.uygulananlar, ['a', 'd']);
  assert.equal(o.zamanlayicilar.size, 0);
});

test('denetleyici: değer eski haline dönerse bekleyen değişim iptal edilir', () => {
  const o = denetleyiciKur();
  o.denetleyici.baslangic('dosya|normal');
  o.an = 5000;
  o.denetleyici.iste({ anahtar: 'a' });
  o.an = 5100;
  o.denetleyici.iste({ anahtar: 'b' });
  assert.equal(o.zamanlayicilar.size, 1);
  o.an = 5200;
  o.denetleyici.iste({ anahtar: 'a' });
  assert.equal(o.zamanlayicilar.size, 0, 'zamanlayıcı temizlendi');
  assert.deepEqual(o.uygulananlar, ['a']);
});

test('denetleyici: hizli değişim (bağlantı durumu) beklemez ve bekleyeni geçersiz kılar', () => {
  const o = denetleyiciKur();
  o.denetleyici.baslangic('dosya|normal');
  o.an = 5000;
  o.denetleyici.iste({ anahtar: 'a' });
  o.an = 5100;
  o.denetleyici.iste({ anahtar: 'b' });
  o.an = 5150;
  o.denetleyici.iste({ anahtar: 'dosya|soluk', hizli: true });
  assert.deepEqual(o.uygulananlar, ['a', 'dosya|soluk']);
  assert.equal(o.zamanlayicilar.size, 0);
});

test('denetleyici: uygula hata fırlatsa da düşmez, sonraki değişim yeniden denenir', () => {
  let cagri = 0;
  const o = denetleyiciKur({
    uygula: () => {
      cagri += 1;
      throw new Error('simge yazılamadı');
    },
  });
  o.denetleyici.baslangic('dosya|normal');
  o.an = 5000;
  assert.doesNotThrow(() => o.denetleyici.iste({ anahtar: 'a' }));
  o.an = 9000;
  assert.doesNotThrow(() => o.denetleyici.iste({ anahtar: 'b' }));
  assert.equal(cagri, 2);
});

test('denetleyici: geçersiz istek yok sayılır; temizle bekleyeni ve zamanlayıcıyı siler', () => {
  const o = denetleyiciKur();
  o.denetleyici.baslangic('dosya|normal');
  o.denetleyici.iste(null);
  o.denetleyici.iste({});
  o.denetleyici.iste({ anahtar: 5 });
  assert.deepEqual(o.uygulananlar, []);
  o.an = 100;
  o.denetleyici.iste({ anahtar: 'a' });
  assert.equal(o.zamanlayicilar.size, 1);
  o.denetleyici.temizle();
  assert.equal(o.zamanlayicilar.size, 0);
  assert.deepEqual(o.uygulananlar, []);
});
