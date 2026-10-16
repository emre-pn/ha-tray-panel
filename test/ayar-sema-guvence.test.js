'use strict';

/**
 * 1.2.0 ayar dosyası güvenceleri (src/lib/ayar-sema.js):
 *  - h-33: bozuk/silinmiş şema sürümü eski göçleri (v3: düğme/script favorilerinde onayı kapatma) yeniden çalıştırmaz;
 *          tipi bozuk alanlar sessizce sıfırlanmaz, sifirlananlar ile bildirilir.
 *  - h-11: kendinden yeni şemalı dosyada bilinmeyen üst düzey alanlar korunur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt, gocSurumu, semaSurumuBozukMu, yeniSemaMi } = require('../src/lib/ayar-sema');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));
const duzelt = (ham) => ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });

const DUGME = { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'Ses çıkışı: Hoparlör' };
const SCRIPT = { entity_id: 'script.telefonu_bul', ad: 'Telefonu bul' };
const PC_KAPAT = { entity_id: 'button.pc_pc_kapat', ad: 'PC kapat' };

/** Uygulamanın bugün yazdığı (güncel şemalı) tam ayar dosyası; düğme favorilerinde onay alanı YOK (varsayılan onaylı alanlar). */
const guncelDosya = (ek = {}) => ({ ...VARSAYILAN, favoriler: [{ ...DUGME }, { ...SCRIPT }], ...ek });

// --- h-33: şema sürümü güvenilirliği ---

test('h-33: sürüm alanı BOZUKSA (metin, null, 0, negatif, ondalık, boolean) v3 göçü çalışmaz: düğme/script favorilerinde onay kapanmaz', () => {
  for (const bozuk of ['abc', '5', null, 0, -3, 2.5, true, [], {}]) {
    const { ayarlar, notlar, onayIstenenler, sifirlananlar } = duzelt(guncelDosya({ semaSurumu: bozuk }));
    assert.equal(semaSurumuBozukMu({ semaSurumu: bozuk }), true, JSON.stringify(bozuk));
    assert.equal(gocSurumu({ semaSurumu: bozuk }), SEMA_SURUMU, JSON.stringify(bozuk));
    for (const f of ayarlar.favoriler) assert.equal(f.onay, undefined, `${f.entity_id}: onay kapatılmamalı (${JSON.stringify(bozuk)})`);
    assert.deepEqual(onayIstenenler, []);
    assert.ok(!notlar.includes('sema-gocu'), 'göç yapılmadı');
    assert.ok(notlar.includes('sema-surumu-bozuk'));
    assert.ok(notlar.includes('alan-tipi-hatali'));
    assert.deepEqual(sifirlananlar, ['semaSurumu']);
    assert.equal(ayarlar.semaSurumu, SEMA_SURUMU, 'dosya güncel sürümle yazılır');
  }
});

test('h-33: sürüm alanı SİLİNMİŞ ama dosyada sonraki şemaların alanları var -> göç çalışmaz; gerçek 1.0.0 dosyasında çalışmaya devam eder', () => {
  const sili = guncelDosya();
  delete sili.semaSurumu;
  const a = duzelt(sili);
  assert.equal(gocSurumu(sili), SEMA_SURUMU);
  for (const f of a.ayarlar.favoriler) assert.equal(f.onay, undefined, f.entity_id);
  assert.ok(!a.notlar.includes('sema-gocu'));
  assert.ok(!a.notlar.includes('sema-surumu-bozuk'), 'alan hiç yok: bozuk değil, yalnız belirsiz');
  assert.deepEqual(a.sifirlananlar, []);

  // Gerçek 1.0.0 dosyası: sürüm alanı yok ve sonraki şemaların alanları da yok -> v3 göçü (bugünkü davranış) sürer.
  const v1 = { yerelAdres: 'http://192.168.1.10:8123', favoriler: [{ ...DUGME }, { ...SCRIPT }, { ...PC_KAPAT }], pencere: { x: 1, y: 2, width: 1000, height: 700 }, tepsiIpucuGosterildi: true };
  const eski = duzelt(v1);
  assert.equal(gocSurumu(v1), 1);
  assert.ok(eski.notlar.includes('sema-gocu'));
  assert.equal(eski.ayarlar.favoriler.find((f) => f.entity_id === DUGME.entity_id).onay, false, 'zorunlu olmayan düğme bugünkü gibi onaysız');
  assert.equal(eski.ayarlar.favoriler.find((f) => f.entity_id === PC_KAPAT.entity_id).onay, undefined, 'zorunlu onaylı PC kapat onay ister (kapatılmaz)');
  assert.deepEqual(eski.onayIstenenler, [PC_KAPAT.entity_id]);
});

test('h-33: geçerli eski sürüm (1-2) göç eder; 3 ve üstü etmez; zorunlu onaylı eylemin onayı hiçbir durumda kapanmaz', () => {
  for (const [surum, beklenen] of [[1, false], [2, false], [3, undefined], [4, undefined], [5, undefined]]) {
    const f = duzelt({ semaSurumu: surum, favoriler: [{ ...DUGME }] }).ayarlar.favoriler[0];
    assert.equal(f.onay, beklenen, `v${surum}`);
  }
  for (const surum of [undefined, 'abc', null, 0, 1, 2, 3, 99]) {
    const f = duzelt({ semaSurumu: surum, favoriler: [{ ...PC_KAPAT }] }).ayarlar.favoriler[0];
    assert.notEqual(f.onay, false, `PC kapat: onay kapatılamaz (sürüm ${JSON.stringify(surum)})`);
  }
});

test('h-33: tipi bozuk alanlar sifirlananlar ile bildirilir, varsayılana döner; geçerli dosyalarda yanlış alarm yok', () => {
  const { ayarlar, notlar, sifirlananlar } = duzelt(guncelDosya({ favoriler: 'bozuk', panolar: 5, pencere: [], yakinlastirma: 'x', koseBildirimi: 'evet', yerelAdres: 42 }));
  assert.deepEqual(sifirlananlar.sort(), ['favoriler', 'koseBildirimi', 'panolar', 'pencere', 'yakinlastirma', 'yerelAdres']);
  assert.ok(notlar.includes('alan-tipi-hatali'));
  assert.deepEqual(ayarlar.favoriler, [], 'favoriler dizi değilse boşa iner (özgün dosya yedeklenir; main.js)');
  assert.deepEqual(ayarlar.panolar, []);
  assert.equal(ayarlar.koseBildirimi, true);
  assert.equal(ayarlar.yerelAdres, VARSAYILAN.yerelAdres);

  // null da tip hatasıdır (uygulama hiçbir alana null yazmaz)
  assert.deepEqual(duzelt(guncelDosya({ disAdres: null, otomatikBaslat: null })).sifirlananlar.sort(), ['disAdres', 'otomatikBaslat']);

  // yanlış alarm yok: varsayılan dosya, güncel dosya, sayı metni, 1.0.0 dosyası
  assert.deepEqual(duzelt(VARSAYILAN).sifirlananlar, []);
  assert.deepEqual(duzelt(guncelDosya()).sifirlananlar, []);
  assert.deepEqual(duzelt(guncelDosya({ yenidenDenemeSn: '45' })).sifirlananlar, [], 'sayı metni kabul edilir (tamsayi() de kabul eder)');
  assert.deepEqual(duzelt({ yerelAdres: 'http://192.168.1.10:8123', favoriler: [], pencere: { x: 1, y: 1, width: 900, height: 700 }, tepsiIpucuGosterildi: true, otomatikBaslat: true }).sifirlananlar, []);
  assert.deepEqual(duzelt({}).sifirlananlar, []);
  assert.deepEqual(duzelt(null).sifirlananlar, []);
  assert.ok(!duzelt(guncelDosya()).notlar.includes('alan-tipi-hatali'));
});

test('h-33: geçersiz kısayol/palet kısayolu kendi notlarıyla bildirilir (sifirlananlar\'a ikinci kez girmez); palet kısayolu "" kapalıdır ve bildirilmez', () => {
  const a = duzelt(guncelDosya({ kisayol: 'Ctrl-H', paletKisayol: 'bozuk' }));
  assert.ok(a.notlar.includes('kisayol-varsayilana-donduruldu'));
  assert.ok(a.notlar.includes('palet-kisayol-varsayilana-donduruldu'));
  assert.equal(a.ayarlar.paletKisayol, 'Control+Alt+P');
  assert.deepEqual(a.sifirlananlar, []);
  const b = duzelt(guncelDosya({ paletKisayol: '' }));
  assert.equal(b.ayarlar.paletKisayol, '');
  assert.ok(!b.notlar.includes('palet-kisayol-varsayilana-donduruldu'));
});

// --- h-11: kendinden yeni şemalı dosya ---

test('h-11: daha yeni şemalı dosyada bilinmeyen üst düzey alanlar olduğu gibi korunur; bilinen alanlar yine düzeltilir; sürüm düşürülmez', () => {
  const ham = guncelDosya({
    semaSurumu: SEMA_SURUMU + 2,
    gelecekAyar: { renk: 'mor', liste: [1, 2, { a: true }] },
    baskaAlan: 'x',
    koseBildirimi: false,
    yakinlastirma: 99, // bilinen alan: düzeltilir
  });
  const { ayarlar, notlar, bilinmeyenAlanlar } = duzelt(ham);
  assert.equal(ayarlar.semaSurumu, SEMA_SURUMU + 2);
  assert.deepEqual(ayarlar.gelecekAyar, { renk: 'mor', liste: [1, 2, { a: true }] });
  assert.equal(ayarlar.baskaAlan, 'x');
  assert.deepEqual(bilinmeyenAlanlar.sort(), ['baskaAlan', 'gelecekAyar']);
  assert.ok(notlar.includes('sema-daha-yeni'));
  assert.ok(!notlar.includes('sema-gocu'));
  assert.ok(!notlar.includes('sema-surumu-bozuk'));
  assert.equal(ayarlar.koseBildirimi, false);
  assert.notEqual(ayarlar.yakinlastirma, 99, 'bilinen alan düzeltilir');
  assert.equal(yeniSemaMi(ham), true);
  // Girdiyle paylaşılmaz (derin kopya).
  ayarlar.gelecekAyar.liste.push(3);
  assert.deepEqual(ham.gelecekAyar.liste, [1, 2, { a: true }]);
  // JSON'a gidiş-dönüş: yazılan dosyada alanlar durur.
  assert.deepEqual(JSON.parse(JSON.stringify(ayarlar)).gelecekAyar, { renk: 'mor', liste: [1, 2, { a: true }, 3] });
});

test('h-11: güncel ya da eski şemalı dosyada bilinmeyen alanlar taşınmaz; tehlikeli anahtarlar (__proto__, constructor) yeni şemada bile taşınmaz', () => {
  const guncel = duzelt(guncelDosya({ bilinmeyen: 1 }));
  assert.equal(guncel.ayarlar.bilinmeyen, undefined);
  assert.deepEqual(guncel.bilinmeyenAlanlar, []);
  assert.ok(!guncel.notlar.includes('sema-daha-yeni'));
  const eski = duzelt({ semaSurumu: 3, favoriler: [], bilinmeyen: 1 });
  assert.equal(eski.ayarlar.bilinmeyen, undefined);

  const ham = JSON.parse(`{"semaSurumu": ${SEMA_SURUMU + 1}, "__proto__": {"zararli": true}, "constructor": {"x": 1}, "prototype": 5, "tamam": 1}`);
  const { ayarlar, bilinmeyenAlanlar } = duzelt(ham);
  assert.deepEqual(bilinmeyenAlanlar, ['tamam']);
  assert.equal(Object.hasOwn(ayarlar, '__proto__'), false);
  assert.equal(Object.hasOwn(ayarlar, 'constructor'), false);
  assert.equal({}.zararli, undefined, 'Object prototipi kirlenmez');
  assert.equal(ayarlar.zararli, undefined);
});

test('h-11: daha yeni sürümün hazır liste sürümü düşürülmez (geri dönünce silinen karolar yeniden eklenmesin); güncel şemada eskisi gibi sınırlanır', () => {
  assert.equal(duzelt(guncelDosya({ semaSurumu: SEMA_SURUMU + 1, hazirListeSurumu: 7 })).ayarlar.hazirListeSurumu, 7);
  assert.equal(duzelt(guncelDosya({ semaSurumu: SEMA_SURUMU, hazirListeSurumu: 7 })).ayarlar.hazirListeSurumu, 0, 'güncel şemada bilinmeyen sürüm sıfırlanır (eski davranış)');
  assert.equal(duzelt(guncelDosya({ semaSurumu: SEMA_SURUMU + 1, hazirListeSurumu: 1 })).ayarlar.hazirListeSurumu, 1);
  assert.equal(duzelt(guncelDosya({ semaSurumu: SEMA_SURUMU + 1, hazirListeSurumu: 'x' })).ayarlar.hazirListeSurumu, 0);
});
