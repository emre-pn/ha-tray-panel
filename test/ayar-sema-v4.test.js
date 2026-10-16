'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');
const { panolariDuzelt, panoDuzelt } = require('../src/lib/panolar');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));

// Kullanıcının bugünkü 4 favorisinin sentetik karşılığı (v3 biçimi: düğmeler onay:false).
const V3_FAVORILER = [
  { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit' },
  { entity_id: 'light.smart_multicolor_bulb', ad: 'Ampul' },
  { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'Ses çıkışı: Hoparlör', onay: false },
  { entity_id: 'button.pc_ses_cikis_kulaklik', ad: 'Ses çıkışı: Kulaklık', onay: false },
];
const V4_ETIKETLER = {
  'light.masa_led_serit': { etiket: 'LED şerit', parlaklik: true },
  'light.smart_multicolor_bulb': { etiket: 'Ampul' },
  'button.pc_ses_cikis_hoparlor': { etiket: 'Hoparlör' },
  'button.pc_ses_cikis_kulaklik': { etiket: 'Kulaklık' },
};
const V4_FAVORILER = V3_FAVORILER.map((f) => ({ ...f, ...V4_ETIKETLER[f.entity_id] }));
const v3 = (ek = {}) => ({
  semaSurumu: 3,
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  kisayol: 'Control+Alt+H',
  pencereBoyutu: 'hizli',
  pencere: { hizli: { width: 600, height: 700 }, genis: { width: 1500, height: 900, maximized: false } },
  favoriler: V3_FAVORILER.map((f) => ({ ...f })),
  ...ek,
});

test('v3 -> v5 göçü: yeni alanlar varsayılanlarla gelir; favoriler etiket alır, hiçbiri silinmez; kullanıcı değerleri korunur', () => {
  const { ayarlar, notlar, atilanlar } = ayarlariDuzelt(v3(), { varsayilan: VARSAYILAN });
  assert.equal(SEMA_SURUMU, 5);
  assert.equal(ayarlar.semaSurumu, 5);
  assert.deepEqual(ayarlar.favoriler, V4_FAVORILER);
  assert.deepEqual(atilanlar, []);
  assert.ok(notlar.includes('sema-gocu'));
  assert.equal(ayarlar.canliBaglanti, true);
  assert.equal(ayarlar.paletKisayol, 'Control+Alt+P');
  assert.equal(ayarlar.tepsiSolTik, 'panel');
  assert.equal(ayarlar.hazirListeSurumu, 0);
  assert.deepEqual(ayarlar.panolar, []);
  assert.deepEqual(ayarlar.pencere.hizli, { width: 600, height: 700 });
  assert.equal(ayarlar.kisayol, 'Control+Alt+H');
});

test('v4 göçü idempotan: çıktı tekrar düzeltilince aynı kalır, not üretmez', () => {
  const ilk = ayarlariDuzelt(v3(), { varsayilan: VARSAYILAN }).ayarlar;
  const ikinci = ayarlariDuzelt(JSON.parse(JSON.stringify(ilk)), { varsayilan: VARSAYILAN });
  assert.deepEqual(ikinci.ayarlar, ilk);
  assert.deepEqual(ikinci.notlar, []);
});

test('v4 göçü: kullanıcının kendi etiketi ezilmez; hazır listede olmayan favoriye dokunulmaz; v4 dosyasında parlaklık yeniden eklenmez', () => {
  const ham = v3({
    favoriler: [
      { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit', etiket: 'Benim LED' },
      { entity_id: 'light.baska', ad: 'Başka' },
    ],
  });
  const { ayarlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.deepEqual(ayarlar.favoriler[0], { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit', etiket: 'Benim LED', parlaklik: true });
  assert.deepEqual(ayarlar.favoriler[1], { entity_id: 'light.baska', ad: 'Başka' });
  // v4 dosyasında kullanıcı parlaklık kontrolünü kapattıysa (alan yok) göç tekrarlanmaz: yeniden açılmaz
  const v4 = ayarlariDuzelt({ ...ham, semaSurumu: 4, favoriler: [{ entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit', etiket: 'LED şerit' }] }, { varsayilan: VARSAYILAN });
  assert.deepEqual(v4.ayarlar.favoriler[0], { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit', etiket: 'LED şerit' });
});

test('v4: tepsiSolTik, canliBaglanti, paletKisayol doğrulanır; geçersiz değer varsayılana döner', () => {
  const al = (ek) => ayarlariDuzelt(v3({ semaSurumu: 4, ...ek }), { varsayilan: VARSAYILAN });
  assert.equal(al({ tepsiSolTik: 'pencere' }).ayarlar.tepsiSolTik, 'pencere');
  assert.equal(al({ tepsiSolTik: 'panel' }).ayarlar.tepsiSolTik, 'panel');
  assert.equal(al({ tepsiSolTik: 'baska' }).ayarlar.tepsiSolTik, 'panel');
  assert.equal(al({ canliBaglanti: false }).ayarlar.canliBaglanti, false);
  assert.equal(al({ canliBaglanti: 'hayir' }).ayarlar.canliBaglanti, true);
  assert.equal(al({ paletKisayol: 'Control+Alt+K' }).ayarlar.paletKisayol, 'Control+Alt+K');
  assert.equal(al({ paletKisayol: '' }).ayarlar.paletKisayol, '', 'boş = palet kısayolu kapalı');
  const kotu = al({ paletKisayol: 'Hizli+Tus' });
  assert.equal(kotu.ayarlar.paletKisayol, 'Control+Alt+P');
  assert.ok(kotu.notlar.includes('palet-kisayol-varsayilana-donduruldu'));
});

test('v4: hazirListeSurumu 0..güncel aralığında tamsayı; bozuk değer 0 olur', () => {
  const al = (d) => ayarlariDuzelt(v3({ semaSurumu: 4, hazirListeSurumu: d }), { varsayilan: VARSAYILAN }).ayarlar.hazirListeSurumu;
  assert.equal(al(1), 1);
  assert.equal(al(0), 0);
  assert.equal(al(-1), 0);
  assert.equal(al(99), 0);
  assert.equal(al('x'), 0);
  assert.equal(al(null), 0);
});

test('v4: panolar en çok 6, geçersiz yollar (api/auth) ve adsızlar düşer; kısayol normalleşir', () => {
  const pano = (i) => ({ ad: `Pano ${i}`, yol: `/lovelace/p${i}` });
  const ham = v3({
    semaSurumu: 4,
    panolar: [
      { ad: 'Salon', yol: '/lovelace/salon', kisayol: 'Alt+Control+1' },
      { ad: 'Kötü', yol: '/api/states' },
      { ad: '', yol: '/lovelace/x' },
      { ad: 'Dış', yol: 'https://kotu.example/x' },
      pano(1), pano(2), pano(3), pano(4), pano(5), pano(6),
    ],
  });
  const { ayarlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.panolar.length, 6);
  assert.deepEqual(ayarlar.panolar[0], { ad: 'Salon', yol: '/lovelace/salon', kisayol: 'Control+Alt+1' });
  assert.ok(ayarlar.panolar.every((p) => p.yol.startsWith('/lovelace/')));
  assert.deepEqual(ayarlariDuzelt(v3({ semaSurumu: 4, panolar: 'x' }), { varsayilan: VARSAYILAN }).ayarlar.panolar, []);
});

test('v4: varsayılan ayar dosyası güncel şemayı ve boş favori listesini taşır', () => {
  assert.equal(VARSAYILAN.semaSurumu, SEMA_SURUMU);
  assert.deepEqual(VARSAYILAN.favoriler, []);
  assert.equal(VARSAYILAN.tepsiSolTik, 'panel');
  assert.equal(VARSAYILAN.paletKisayol, 'Control+Alt+P');
  assert.equal(VARSAYILAN.canliBaglanti, true);
  assert.equal(VARSAYILAN.hazirListeSurumu, 0);
  assert.deepEqual(VARSAYILAN.panolar, []);
});

test('panoDuzelt/panolariDuzelt: ad kırpılır, denetim karakteri atılır, geçersiz kısayol atılır ve sayılır, 6 sınırı', () => {
  assert.deepEqual(panoDuzelt({ ad: '  Salon\u0000  ', yol: '/lovelace/salon' }).pano, { ad: 'Salon', yol: '/lovelace/salon' });
  assert.equal(panoDuzelt({ ad: 'x'.repeat(100), yol: '/lovelace/a' }).pano.ad.length, 30);
  assert.equal(panoDuzelt(null).pano, null);
  assert.equal(panoDuzelt([]).pano, null);
  assert.equal(panoDuzelt({ ad: 'A', yol: '/auth/x' }).pano, null);
  assert.equal(panoDuzelt({ ad: 'A', yol: '/lovelace/../x' }).pano, null);
  const r = panoDuzelt({ ad: 'A', yol: '/lovelace/a', kisayol: 'Hizli+Tus' });
  assert.deepEqual([r.pano, r.kisayolAtildi], [{ ad: 'A', yol: '/lovelace/a' }, true]);
  const liste = panolariDuzelt([{ ad: 'A', yol: '/lovelace/a', kisayol: 'Kotu' }, { ad: '', yol: '/x' }, ...Array.from({ length: 7 }, (_, i) => ({ ad: `P${i}`, yol: `/lovelace/p${i}` }))]);
  assert.deepEqual([liste.panolar.length, liste.atilanlar, liste.kisayolAtilanlar, liste.fazla], [6, 1, 1, 2]);
});

// --- ayarlar:kaydet doğrulaması (ayar-kaydet.js) ---

const MEVCUT = { kisayol: 'Control+Alt+H', paletKisayol: 'Control+Alt+P' };
const temel = (ek = {}) => ({ yerelAdres: 'http://192.168.1.10:8123', disAdres: 'https://ha.example.com', kisayol: 'Control+Alt+H', ...ek });

test('ayar-kaydet: tepsiSolTik ve canliBaglanti yalnız geçerli değerle uygulanır', () => {
  const r = ayarGirdisiniDogrula(temel({ tepsiSolTik: 'pencere', canliBaglanti: false }), MEVCUT);
  assert.equal(r.yeni.tepsiSolTik, 'pencere');
  assert.equal(r.yeni.canliBaglanti, false);
  const k = ayarGirdisiniDogrula(temel({ tepsiSolTik: 'sag', canliBaglanti: 'evet' }), MEVCUT);
  assert.ok(!('tepsiSolTik' in k.yeni) && !('canliBaglanti' in k.yeni));
});

test('ayar-kaydet: palet kısayolu — boş kapatır, geçerli normalleşir, geçersiz uyarı verir ve eskisini korur', () => {
  assert.equal(ayarGirdisiniDogrula(temel({ paletKisayol: '' }), MEVCUT).yeni.paletKisayol, '');
  assert.equal(ayarGirdisiniDogrula(temel({ paletKisayol: 'Alt+Control+K' }), MEVCUT).yeni.paletKisayol, 'Control+Alt+K');
  const kotu = ayarGirdisiniDogrula(temel({ paletKisayol: 'Hizli+Tus' }), MEVCUT);
  assert.ok(!('paletKisayol' in kotu.yeni));
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'paletKisayol'));
  assert.deepEqual(kotu.hatalar, [], 'palet kısayolu sorunu kaydı durdurmaz');
  assert.ok(ayarGirdisiniDogrula(temel({ paletKisayol: 5 }), MEVCUT).uyarilar.some((u) => u.alan === 'paletKisayol'));
  assert.ok(!('paletKisayol' in ayarGirdisiniDogrula(temel(), MEVCUT).yeni), 'gönderilmediyse dokunulmaz');
});

test('ayar-kaydet: panolar süzülür, sınır ve geçersizler uyarı olur; dizi değilse korunur', () => {
  const r = ayarGirdisiniDogrula(
    temel({ panolar: [{ ad: 'Salon', yol: '/lovelace/salon', kisayol: 'Control+Alt+1' }, { ad: '', yol: '/x' }] }),
    MEVCUT,
  );
  assert.deepEqual(r.yeni.panolar, [{ ad: 'Salon', yol: '/lovelace/salon', kisayol: 'Control+Alt+1' }]);
  assert.equal(r.uyarilar.filter((u) => u.alan === 'panolar').length, 1);
  assert.deepEqual(r.hatalar, []);
  const kotu = ayarGirdisiniDogrula(temel({ panolar: 'x' }), MEVCUT);
  assert.ok(!('panolar' in kotu.yeni));
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'panolar'));
  const cok = ayarGirdisiniDogrula(temel({ panolar: Array.from({ length: 9 }, (_, i) => ({ ad: `P${i}`, yol: `/lovelace/p${i}` })) }), MEVCUT);
  assert.equal(cok.yeni.panolar.length, 6);
  assert.ok(cok.uyarilar.some((u) => /En çok 6/.test(u.mesaj)));
  assert.deepEqual(ayarGirdisiniDogrula(temel({ panolar: [] }), MEVCUT).yeni.panolar, [], 'boş liste = hepsini sil (kullanıcı kararı)');
});
