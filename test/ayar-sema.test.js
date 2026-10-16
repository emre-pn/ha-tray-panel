'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SEMA_SURUMU, EN_COK_ENGELLENEN, ayarlariDuzelt } = require('../src/lib/ayar-sema');

const VARSAYILAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'varsayilan-ayarlar.json'), 'utf8'));

// Kullanıcının bugünkü (v1) ayar dosyasının SENTETİK karşılığı: 4 favori, eski tek boyutlu pencere.
const DORT_FAVORI = [
  { entity_id: 'light.masa_led_serit', ad: 'Masa LED Şerit' },
  { entity_id: 'light.smart_multicolor_bulb', ad: 'Ampul' },
  { entity_id: 'button.pc_ses_cikis_hoparlor', ad: 'Ses çıkışı: Hoparlör' },
  { entity_id: 'button.pc_ses_cikis_kulaklik', ad: 'Ses çıkışı: Kulaklık' },
];
const v1 = () => ({
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  yerelZamanAsimiMs: 3000,
  disZamanAsimiMs: 10000,
  yenidenDenemeSn: 30,
  kisayol: 'Control+Alt+H',
  otomatikBaslat: true,
  favoriler: DORT_FAVORI.map((f) => ({ ...f })),
  pencere: { x: 120, y: 60, width: 1100, height: 700, maximized: true },
  tepsiIpucuGosterildi: true,
});

// v3 göçü: düğme favorileri zorunlu onaylı değilse açıkça onay:false alır (bugünkü davranış korunur).
const DORT_FAVORI_V3 = DORT_FAVORI.map((f) => (f.entity_id.startsWith('button.') ? { ...f, onay: false } : { ...f }));
// v4 göçü: hazır listedeki mevcut favoriler etiketini, LED şerit ayrıca parlaklık kontrolünü alır; ad ve sıra değişmez.
const ETIKETLER = {
  'light.masa_led_serit': { etiket: 'LED şerit', parlaklik: true },
  'light.smart_multicolor_bulb': { etiket: 'Ampul' },
  'button.pc_ses_cikis_hoparlor': { etiket: 'Hoparlör' },
  'button.pc_ses_cikis_kulaklik': { etiket: 'Kulaklık' },
};
const DORT_FAVORI_V4 = DORT_FAVORI_V3.map((f) => ({ ...f, ...ETIKETLER[f.entity_id] }));

test('v1 -> v5 göçü: 4 favori ve tüm değerler korunur, hiçbir favori düşmez', () => {
  const { ayarlar, notlar, atilanlar, onayIstenenler } = ayarlariDuzelt(v1(), { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.semaSurumu, SEMA_SURUMU);
  assert.equal(SEMA_SURUMU, 6); // 1.4.0: şema 6 (ayar-alanlari.js)
  assert.deepEqual(ayarlar.favoriler, DORT_FAVORI_V4);
  assert.deepEqual(onayIstenenler, []);
  assert.ok(!notlar.includes('favori-onay-gerekli'));
  assert.deepEqual(atilanlar, []);
  assert.deepEqual(ayarlar.engellenenFavoriler, []);
  assert.equal(ayarlar.yerelAdres, 'http://192.168.1.10:8123');
  assert.equal(ayarlar.disAdres, 'https://ha.example.com');
  assert.equal(ayarlar.kisayol, 'Control+Alt+H');
  assert.equal(ayarlar.otomatikBaslat, true);
  assert.equal(ayarlar.tepsiIpucuGosterildi, true);
  assert.ok(notlar.includes('sema-gocu'));
  assert.ok(notlar.includes('pencere-v1-tasindi'));
});

test('v2 -> v5 göçü: 4 favori korunur, düğmeler onay:false alır, ışıklara onay alanı eklenmez, yeni alanlar varsayılan', () => {
  const v2 = { ...v1(), semaSurumu: 2, pencereBoyutu: 'hizli', pencere: { hizli: { width: 560, height: 780 }, genis: { width: 1280, height: 820, maximized: false } } };
  const { ayarlar, notlar } = ayarlariDuzelt(v2, { varsayilan: VARSAYILAN });
  assert.deepEqual(ayarlar.favoriler, DORT_FAVORI_V4);
  assert.equal(ayarlar.koseBildirimi, true);
  assert.equal(ayarlar.bipSesi, false);
  assert.equal(ayarlar.semaSurumu, 6);
  assert.deepEqual(notlar, ['sema-gocu']);
});

test('v3 göçü: zorunlu onaylı mevcut favoriler SİLİNMEZ, onay isteyecek hâle gelir ve bildirilir', () => {
  const ham = {
    ...v1(),
    semaSurumu: 2,
    favoriler: [
      ...DORT_FAVORI,
      { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC bilgisayari_kapat' },
      { entity_id: 'script.iyi_geceler', ad: 'İyi geceler' },
      { entity_id: 'script.yeni_script', ad: 'Yeni script' },
      { entity_id: 'script.isigi_kapat', ad: 'Işığı kapat' },
      { entity_id: 'button.x', ad: 'Açık onaylı', onay: true },
    ],
  };
  const { ayarlar, notlar, onayIstenenler, atilanlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.deepEqual(atilanlar, []);
  assert.equal(ayarlar.favoriler.length, 9);
  const bul = (k) => ayarlar.favoriler.find((f) => f.entity_id === k);
  assert.ok(!('onay' in bul('button.pc_bilgisayari_kapat'))); // zorunlu: onay alanı yazılmaz
  assert.ok(!('onay' in bul('script.iyi_geceler')));
  assert.ok(!('onay' in bul('script.isigi_kapat')));
  assert.equal(bul('script.yeni_script').onay, false); // zorunlu değil: bugünkü (onaysız) davranış korunur
  assert.equal(bul('button.x').onay, true); // kullanıcının açık seçimi korunur
  assert.deepEqual(onayIstenenler, ['button.pc_bilgisayari_kapat', 'script.iyi_geceler', 'script.isigi_kapat']);
  assert.ok(notlar.includes('favori-onay-gerekli'));
});

test('v3 şeması: köşe bildirimi ve bip boolean doğrulanır', () => {
  const al = (ek) => ayarlariDuzelt({ ...v1(), semaSurumu: 3, ...ek }, { varsayilan: VARSAYILAN }).ayarlar;
  assert.equal(al({ koseBildirimi: false }).koseBildirimi, false);
  assert.equal(al({ koseBildirimi: 'evet' }).koseBildirimi, true);
  assert.equal(al({ bipSesi: true }).bipSesi, true);
  assert.equal(al({ bipSesi: 1 }).bipSesi, false);
  assert.equal(al({}).koseBildirimi, true);
  assert.equal(al({}).bipSesi, false);
});

test('güncel şemada göç tekrarlanmaz: onay alanı olmayan düğme favorisi olduğu gibi kalır', () => {
  const { ayarlar, notlar } = ayarlariDuzelt({ ...v1(), semaSurumu: SEMA_SURUMU }, { varsayilan: VARSAYILAN });
  assert.ok(ayarlar.favoriler.filter((f) => f.entity_id.startsWith('button.')).every((f) => !('onay' in f)));
  assert.ok(!notlar.includes('sema-gocu'));
  assert.ok(!notlar.includes('favori-onay-gerekli'));
});

test('v1 -> v3: eski pencere "geniş" boyuta taşınır (konum düşer), "hızlı" varsayılan olur', () => {
  const { ayarlar } = ayarlariDuzelt(v1(), { varsayilan: VARSAYILAN });
  assert.deepEqual(ayarlar.pencere.genis, { width: 1100, height: 700, maximized: true });
  assert.deepEqual(ayarlar.pencere.hizli, { width: 560, height: 780 });
  assert.equal(ayarlar.pencereBoyutu, 'hizli');
  assert.ok(!('x' in ayarlar.pencere) && !('y' in ayarlar.pencere));
  assert.ok(!('x' in ayarlar.pencere.genis) && !('y' in ayarlar.pencere.genis));
});

test('v1 -> v3: yeni alanlar varsayılanlarla gelir', () => {
  const { ayarlar } = ayarlariDuzelt(v1(), { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.odakKaybindaGizle, true);
  assert.equal(ayarlar.anaPanoyaDonDk, 5);
  assert.equal(ayarlar.yakinlastirma, 0);
});

test('göç idempotan: v2 çıktısı tekrar düzeltilince aynı kalır ve not üretmez', () => {
  const ilk = ayarlariDuzelt(v1(), { varsayilan: VARSAYILAN }).ayarlar;
  const ikinci = ayarlariDuzelt(JSON.parse(JSON.stringify(ilk)), { varsayilan: VARSAYILAN });
  assert.deepEqual(ikinci.ayarlar, ilk);
  assert.deepEqual(ikinci.notlar, []);
  assert.deepEqual(ikinci.atilanlar, []);
});

test('bozuk ve boş girdi varsayılanlara döner', () => {
  for (const ham of [null, undefined, [], 'metin', 42, {}]) {
    const { ayarlar, notlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
    assert.equal(ayarlar.yerelAdres, 'http://192.168.1.10:8123', String(ham));
    assert.equal(ayarlar.disAdres, 'https://ha.example.com');
    assert.equal(ayarlar.kisayol, 'Control+Alt+H');
    assert.equal(ayarlar.otomatikBaslat, true);
    assert.equal(ayarlar.pencereBoyutu, 'hizli');
    assert.deepEqual(ayarlar.pencere.hizli, { width: 560, height: 780 });
    assert.deepEqual(ayarlar.pencere.genis, { width: 1280, height: 820, maximized: false });
    assert.deepEqual(ayarlar.favoriler, []);
    assert.deepEqual(notlar, []);
  }
});

test('varsayılan dosya bile yoksa kod içi yedek değerler kullanılır', () => {
  const { ayarlar } = ayarlariDuzelt(null, { varsayilan: {} });
  assert.equal(ayarlar.yerelAdres, '');
  assert.equal(ayarlar.disAdres, '');
  assert.equal(ayarlar.yerelZamanAsimiMs, 3000);
  assert.equal(ayarlar.disZamanAsimiMs, 10000);
  assert.equal(ayarlar.yenidenDenemeSn, 30);
  assert.equal(ayarlar.kisayol, 'Control+Alt+H');
  assert.equal(ayarlar.otomatikBaslat, true);
  assert.equal(ayarlar.anaPanoyaDonDk, 5);
  assert.equal(ayarlar.odakKaybindaGizle, true);
  assert.deepEqual(ayarlar.pencere.hizli, { width: 560, height: 780 });
  assert.equal(ayarlariDuzelt(undefined).ayarlar.kisayol, 'Control+Alt+H');
});

test('geçersiz kısayol varsayılana döner ve not düşer', () => {
  for (const kotu of ['F9', 'Shift+A', 'Alt+F4', 'Control+a', '', null, 42]) {
    const { ayarlar, notlar } = ayarlariDuzelt({ ...v1(), kisayol: kotu }, { varsayilan: VARSAYILAN });
    assert.equal(ayarlar.kisayol, 'Control+Alt+H', String(kotu));
    assert.ok(notlar.includes('kisayol-varsayilana-donduruldu'), String(kotu));
  }
  const yok = v1();
  delete yok.kisayol;
  assert.ok(!ayarlariDuzelt(yok, { varsayilan: VARSAYILAN }).notlar.includes('kisayol-varsayilana-donduruldu'));
});

test('geçerli kısayol normalleştirilir', () => {
  assert.equal(ayarlariDuzelt({ ...v1(), kisayol: 'Alt+Control+P' }).ayarlar.kisayol, 'Control+Alt+P');
});

test('sınır dışı sayılar kırpılır / varsayılana döner', () => {
  const { ayarlar } = ayarlariDuzelt(
    { ...v1(), yerelZamanAsimiMs: 5, disZamanAsimiMs: 999_999, yenidenDenemeSn: 1, anaPanoyaDonDk: 5000, yakinlastirma: 99 },
    { varsayilan: VARSAYILAN },
  );
  assert.equal(ayarlar.yerelZamanAsimiMs, 3000);
  assert.equal(ayarlar.disZamanAsimiMs, 10000);
  assert.equal(ayarlar.yenidenDenemeSn, 30);
  assert.equal(ayarlar.anaPanoyaDonDk, 5);
  assert.equal(ayarlar.yakinlastirma, 5);
  assert.equal(ayarlariDuzelt({ ...v1(), anaPanoyaDonDk: 0 }, { varsayilan: VARSAYILAN }).ayarlar.anaPanoyaDonDk, 0);
  assert.equal(ayarlariDuzelt({ ...v1(), anaPanoyaDonDk: null }, { varsayilan: VARSAYILAN }).ayarlar.anaPanoyaDonDk, 5);
  assert.equal(ayarlariDuzelt({ ...v1(), yakinlastirma: -9 }, { varsayilan: VARSAYILAN }).ayarlar.yakinlastirma, -3);
});

test('dış adres boş bırakılabilir; http dış adres reddedilir', () => {
  assert.equal(ayarlariDuzelt({ ...v1(), disAdres: '' }, { varsayilan: VARSAYILAN }).ayarlar.disAdres, '');
  assert.equal(ayarlariDuzelt({ ...v1(), disAdres: 'http://ha.example.com' }, { varsayilan: VARSAYILAN }).ayarlar.disAdres, 'https://ha.example.com');
});

test('ev içi adres https olabilir (soru-7)', () => {
  assert.equal(ayarlariDuzelt({ ...v1(), yerelAdres: 'https://ha.ev.lan' }, { varsayilan: VARSAYILAN }).ayarlar.yerelAdres, 'https://ha.ev.lan');
});

test('v2 pencere biçimi korunur; geçersiz boyutlar varsayılana döner', () => {
  const v2 = {
    ...v1(),
    semaSurumu: SEMA_SURUMU,
    pencereBoyutu: 'genis',
    pencere: { hizli: { width: 600, height: 700 }, genis: { width: 1500, height: 900, maximized: false } },
  };
  const { ayarlar, notlar } = ayarlariDuzelt(v2, { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.pencereBoyutu, 'genis');
  assert.deepEqual(ayarlar.pencere, v2.pencere);
  assert.deepEqual(notlar, []);
  const bozuk = ayarlariDuzelt({ ...v2, pencere: { hizli: { width: 5, height: 5 }, genis: 'x' }, pencereBoyutu: 'dev' }, { varsayilan: VARSAYILAN }).ayarlar;
  assert.deepEqual(bozuk.pencere.hizli, { width: 560, height: 780 });
  assert.deepEqual(bozuk.pencere.genis, { width: 1280, height: 820, maximized: false });
  assert.equal(bozuk.pencereBoyutu, 'hizli');
});

test('süzgeçten geçmeyen favoriler SESSİZ silinmez: atilanlar ve engellenenFavoriler ile bildirilir', () => {
  const ham = v1();
  ham.favoriler.push(
    { entity_id: 'light.kapi_lambasi', ad: 'Kapı Lambası' },
    { entity_id: 'lock.on_kapi', ad: 'Ön' },
    { entity_id: 'light.salon', ad: 'Salon' },
    { entity_id: 'light.salon', ad: 'Salon' }, // tekrar
    { entity_id: 'Bozuk Kimlik', ad: 'x' },
    { entity_id: 'cover.perde', ad: 'Perde' },
  );
  const { ayarlar, atilanlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.deepEqual(
    ayarlar.favoriler.map((f) => f.entity_id),
    [...DORT_FAVORI.map((f) => f.entity_id), 'light.salon'],
  );
  assert.deepEqual(
    atilanlar.map((a) => a.neden),
    ['guvenlik', 'alan', 'tekrar', 'gecersiz-kimlik', 'alan'],
  );
  // tekrar ve geçersiz kimlik kaydedilmez; engellenenlere yalnız geçerli biçimli, elenmiş kimlikler girer
  assert.deepEqual(ayarlar.engellenenFavoriler, [
    { entity_id: 'light.kapi_lambasi', neden: 'guvenlik' },
    { entity_id: 'lock.on_kapi', neden: 'alan' },
    { entity_id: 'cover.perde', neden: 'alan' },
  ]);
});

test('engellenenFavoriler: önceki kayıtlar korunur, kimlik başına tek, en çok 20', () => {
  const onceki = Array.from({ length: 25 }, (_, i) => ({ entity_id: `light.eski_${i}`, neden: 'guvenlik' }));
  const ham = { ...v1(), semaSurumu: 2, engellenenFavoriler: [...onceki, { entity_id: 'light.eski_3', neden: 'guvenlik' }] };
  ham.favoriler.push({ entity_id: 'light.yeni_kapi', ad: 'Kapı' });
  const { ayarlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.engellenenFavoriler.length, EN_COK_ENGELLENEN);
  assert.equal(ayarlar.engellenenFavoriler.at(-1).entity_id, 'light.yeni_kapi');
  const kimlikler = ayarlar.engellenenFavoriler.map((e) => e.entity_id);
  assert.equal(new Set(kimlikler).size, kimlikler.length);
  assert.ok(kimlikler.includes('light.eski_3'));
});

test('engellenenFavoriler: bozuk kayıtlar temizlenir', () => {
  const ham = { ...v1(), semaSurumu: 2, engellenenFavoriler: [null, 5, 'x', { entity_id: 5 }, { entity_id: 'Kötü Id' }, { entity_id: 'light.a', neden: 'g'.repeat(100) }] };
  const { ayarlar } = ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.equal(ayarlar.engellenenFavoriler.length, 1);
  assert.equal(ayarlar.engellenenFavoriler[0].neden.length, 40);
});

test('favoriler düz metin kimlik listesi olarak da kabul edilir (eski biçim)', () => {
  const { ayarlar } = ayarlariDuzelt({ ...v1(), favoriler: ['light.salon', 'switch.priz'] }, { varsayilan: VARSAYILAN });
  assert.deepEqual(ayarlar.favoriler, [
    { entity_id: 'light.salon', ad: 'light.salon' },
    { entity_id: 'switch.priz', ad: 'switch.priz' },
  ]);
});

test('semaSurumu: eksikse güncel sürüm, daha yenisi düşürülmez', () => {
  assert.equal(ayarlariDuzelt(v1()).ayarlar.semaSurumu, SEMA_SURUMU);
  assert.equal(ayarlariDuzelt({ ...v1(), semaSurumu: 7 }).ayarlar.semaSurumu, 7);
  assert.ok(!ayarlariDuzelt({ ...v1(), semaSurumu: 7 }).notlar.includes('sema-gocu'));
});

test('giriş nesnesi değiştirilmez', () => {
  const ham = v1();
  const kopya = JSON.parse(JSON.stringify(ham));
  ayarlariDuzelt(ham, { varsayilan: VARSAYILAN });
  assert.deepEqual(ham, kopya);
});

test('httpUyarisiAdresi: geçerli köken korunur; eksik ya da geçersiz değer boş olur', () => {
  const duzelt = (ham) => ayarlariDuzelt(ham, { varsayilan: VARSAYILAN }).ayarlar.httpUyarisiAdresi;
  assert.equal(duzelt({ httpUyarisiAdresi: 'http://192.168.1.10:8123' }), 'http://192.168.1.10:8123');
  assert.equal(duzelt({ httpUyarisiAdresi: 'http://192.168.1.10:8123/yol?x=1' }), 'http://192.168.1.10:8123');
  for (const kotu of [undefined, null, 5, true, 'bozuk', '', 'javascript:alert(1)']) assert.equal(duzelt({ httpUyarisiAdresi: kotu }), '', String(kotu));
  assert.equal(duzelt({}), '');
});
