'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));

// Kullanıcının bugünkü (v4) ayarlarının sentetik karşılığı.
const V4_FAVORILER = [
  { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit', etiket: 'LED şerit', parlaklik: true },
  { entity_id: 'light.smart_multicolor_bulb', ad: 'Ampul', etiket: 'Ampul' },
  { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'Ses çıkışı: Hoparlör', onay: false, etiket: 'Hoparlör' },
  { entity_id: 'button.pc_ses_cikis_kulaklik', ad: 'Ses çıkışı: Kulaklık', onay: false, etiket: 'Kulaklık' },
];
const v4 = (ek = {}) => ({
  semaSurumu: 4,
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  kisayol: 'Control+Alt+H',
  paletKisayol: 'Control+Alt+P',
  pencereBoyutu: 'hizli',
  pencere: { hizli: { width: 600, height: 700 }, genis: { width: 1500, height: 900, maximized: false } },
  favoriler: V4_FAVORILER.map((f) => ({ ...f })),
  ...ek,
});

test('varsayılan ayarlar: şema 5 ve Görünüm alanları (koyu tema, sistem vurgusu, acrylic) var', () => {
  assert.equal(SEMA_SURUMU, 5);
  assert.equal(VARSAYILAN.semaSurumu, 5);
  assert.equal(VARSAYILAN.temaZorla, 'koyu');
  assert.equal(VARSAYILAN.vurguRengi, '');
  assert.equal(VARSAYILAN.yeniPencereMalzemesi, 'acrylic');
});

test('v4 -> v5 göçü: favoriler ve kullanıcı değerleri DEĞİŞMEZ, yalnız Görünüm alanları varsayılanla gelir', () => {
  const { ayarlar, atilanlar, notlar } = ayarlariDuzelt(v4(), { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.semaSurumu, 5);
  assert.deepEqual(ayarlar.favoriler, V4_FAVORILER);
  assert.deepEqual(atilanlar, []);
  assert.ok(notlar.includes('sema-gocu'));
  assert.equal(ayarlar.yerelAdres, 'http://192.168.1.10:8123');
  assert.equal(ayarlar.disAdres, 'https://ha.example.com');
  assert.equal(ayarlar.kisayol, 'Control+Alt+H');
  assert.deepEqual(ayarlar.pencere.hizli, { width: 600, height: 700 });
  assert.equal(ayarlar.temaZorla, 'koyu');
  assert.equal(ayarlar.vurguRengi, '');
  assert.equal(ayarlar.yeniPencereMalzemesi, 'acrylic');
});

test('v5 göçü kendini tekrar etmez (idempotent) ve kullanıcının Görünüm seçimlerini korur', () => {
  const ilk = ayarlariDuzelt(v4(), { varsayilan: VARSAYILAN }).ayarlar;
  const ikinci = ayarlariDuzelt(ilk, { varsayilan: VARSAYILAN });
  assert.deepEqual(ikinci.ayarlar, ilk);
  assert.ok(!ikinci.notlar.includes('sema-gocu'));
  const secili = ayarlariDuzelt({ ...ilk, temaZorla: 'sistem', vurguRengi: '#0F75E0', yeniPencereMalzemesi: 'mica' }, { varsayilan: VARSAYILAN }).ayarlar;
  assert.equal(secili.temaZorla, 'sistem');
  assert.equal(secili.vurguRengi, '#0f75e0', 'renk küçük harfe çevrilir');
  assert.equal(secili.yeniPencereMalzemesi, 'mica');
});

test('geçersiz Görünüm değerleri varsayılana döner; geçersiz vurgu rengi "" (sistem rengi) olur; favoriler sağlam kalır', () => {
  for (const kotu of ['#fff', '#12345', '#gggggg', 'kirmizi', 'rgb(1,2,3)', 42, null, {}]) {
    const { ayarlar } = ayarlariDuzelt(v4({ vurguRengi: kotu }), { varsayilan: VARSAYILAN });
    assert.equal(ayarlar.vurguRengi, '', String(kotu));
    assert.deepEqual(ayarlar.favoriler, V4_FAVORILER);
  }
  const { ayarlar } = ayarlariDuzelt(v4({ temaZorla: 'mor', yeniPencereMalzemesi: 'cam' }), { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.temaZorla, 'koyu');
  assert.equal(ayarlar.yeniPencereMalzemesi, 'acrylic');
});

const MEVCUT = { kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli' };
const girdi = (ek = {}) => ({
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  kisayol: 'Control+Alt+H',
  ...ek,
});

test('ayarlar:kaydet: geçerli tema ve malzeme kabul edilir, geçersiz olan YOK sayılır (mevcut değer korunur)', () => {
  const iyi = ayarGirdisiniDogrula(girdi({ temaZorla: 'sistem', yeniPencereMalzemesi: 'mica' }), MEVCUT);
  assert.deepEqual(iyi.hatalar, []);
  assert.equal(iyi.yeni.temaZorla, 'sistem');
  assert.equal(iyi.yeni.yeniPencereMalzemesi, 'mica');
  const kotu = ayarGirdisiniDogrula(girdi({ temaZorla: 'mor', yeniPencereMalzemesi: 'cam' }), MEVCUT);
  assert.deepEqual(kotu.hatalar, []);
  assert.equal('temaZorla' in kotu.yeni, false);
  assert.equal('yeniPencereMalzemesi' in kotu.yeni, false);
  const yok = ayarGirdisiniDogrula(girdi(), MEVCUT);
  assert.equal('temaZorla' in yok.yeni, false);
  assert.equal('vurguRengi' in yok.yeni, false);
});

test('ayarlar:kaydet: vurgu rengi geçerliyse kabul, boşsa sıfırlama; geçersizse YALNIZ uyarı (diğer ayarlar yine kaydedilir)', () => {
  assert.equal(ayarGirdisiniDogrula(girdi({ vurguRengi: '#0F75E0' }), MEVCUT).yeni.vurguRengi, '#0f75e0');
  assert.equal(ayarGirdisiniDogrula(girdi({ vurguRengi: '' }), MEVCUT).yeni.vurguRengi, '');
  assert.equal(ayarGirdisiniDogrula(girdi({ vurguRengi: '   ' }), MEVCUT).yeni.vurguRengi, '');
  for (const kotu of ['#abc', 'mavi', '#12345g', 7]) {
    const r = ayarGirdisiniDogrula(girdi({ vurguRengi: kotu, temaZorla: 'sistem' }), MEVCUT);
    assert.deepEqual(r.hatalar, [], String(kotu));
    assert.equal(r.uyarilar.length, 1, String(kotu));
    assert.equal(r.uyarilar[0].alan, 'vurguRengi');
    assert.match(r.uyarilar[0].mesaj, /#rrggbb/);
    assert.equal('vurguRengi' in r.yeni, false, 'önceki renk korunur');
    assert.equal(r.yeni.temaZorla, 'sistem', 'diğer ayarlar yine kaydedilir');
  }
});
