'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MALZEME_DEGERLERI,
  VARSAYILAN_MALZEME,
  EN_AZ_YAPI,
  OPAK_ARKA_PLAN,
  SAYDAM_ARKA_PLAN,
  malzemeDuzelt,
  yapiNumarasi,
  malzemeDestekliMi,
  pencereMalzemesi,
} = require('../src/lib/malzeme');

test('malzemeDestekliMi: Windows 11 22H2 (yapı 22621) ve üstü desteklenir; Windows 10, 21H2 ve bozuk girdi desteklenmez', () => {
  assert.equal(EN_AZ_YAPI, 22621);
  assert.equal(malzemeDestekliMi('10.0.26300'), true); // kullanıcının sistemi
  assert.equal(malzemeDestekliMi('10.0.22621'), true); // sınır: 22H2
  assert.equal(malzemeDestekliMi('10.0.22631'), true); // 23H2
  assert.equal(malzemeDestekliMi('10.0.22620'), false);
  assert.equal(malzemeDestekliMi('10.0.22000'), false); // Windows 11 21H2
  assert.equal(malzemeDestekliMi('10.0.19045'), false); // Windows 10 22H2
  for (const bozuk of ['', '   ', null, undefined, 42, 'abc', '10.0', '10', '6.3.9600', '11.0.30000', '10.1.30000', '6.8.0-45-generic', '23.5.0']) {
    assert.equal(malzemeDestekliMi(bozuk), false, String(bozuk));
  }
});

test('yapiNumarasi: yalnız 10.0.<yapı> biçimini çözer; ek sonek yok sayılır', () => {
  assert.equal(yapiNumarasi('10.0.26300'), 26300);
  assert.equal(yapiNumarasi(' 10.0.22621 '), 22621);
  assert.equal(yapiNumarasi('10.0.26100.1'), 26100);
  assert.equal(yapiNumarasi('5.15.0'), null);
  assert.equal(yapiNumarasi(undefined), null);
});

test('malzemeDuzelt: geçerli değerler korunur, geçersizse varsayılan (acrylic)', () => {
  assert.deepEqual(MALZEME_DEGERLERI, ['acrylic', 'mica', 'yok']);
  assert.equal(VARSAYILAN_MALZEME, 'acrylic');
  for (const d of MALZEME_DEGERLERI) assert.equal(malzemeDuzelt(d), d);
  for (const kotu of ['tabbed', 'auto', 'ACRYLIC', '', null, undefined, 5, {}]) assert.equal(malzemeDuzelt(kotu), 'acrylic', String(kotu));
  assert.equal(malzemeDuzelt('x', 'mica'), 'mica');
  assert.equal(malzemeDuzelt('x', 'bozuk-varsayilan'), 'acrylic');
});

test('pencereMalzemesi: destekli sistemde backgroundMaterial + saydam arka plan; transparent HİÇ verilmez', () => {
  for (const malzeme of ['acrylic', 'mica']) {
    const s = pencereMalzemesi(malzeme, '10.0.26300');
    assert.equal(s.malzeme, malzeme);
    assert.deepEqual(s.secenekler, { backgroundMaterial: malzeme, backgroundColor: SAYDAM_ARKA_PLAN });
    assert.ok(!('transparent' in s.secenekler), 'saydam pencere (transparent) kullanılmaz: gölge ve büyütme sorunları');
  }
});

test('pencereMalzemesi: "yok" seçili ya da sistem desteklemiyorsa opak koyu arka plan, malzeme seçeneği YOK', () => {
  const beklenen = { malzeme: 'yok', secenekler: { backgroundColor: OPAK_ARKA_PLAN } };
  assert.deepEqual(pencereMalzemesi('yok', '10.0.26300'), beklenen);
  assert.deepEqual(pencereMalzemesi('acrylic', '10.0.19045'), beklenen); // Windows 10
  assert.deepEqual(pencereMalzemesi('mica', '10.0.22000'), beklenen); // Windows 11 21H2
  assert.deepEqual(pencereMalzemesi('acrylic', ''), beklenen);
  assert.deepEqual(pencereMalzemesi('acrylic', '6.8.0-45-generic'), beklenen); // Linux: hiçbir şey uygulanmaz
  assert.equal(OPAK_ARKA_PLAN, '#1b1f27', 'yuzey.css ve kose-bildirim.css --bg ile aynı');
});

test('pencereMalzemesi: geçersiz seçim varsayılan malzemeye (acrylic) döner', () => {
  assert.equal(pencereMalzemesi(undefined, '10.0.26300').malzeme, 'acrylic');
  assert.equal(pencereMalzemesi('bozuk', '10.0.26300').malzeme, 'acrylic');
});
