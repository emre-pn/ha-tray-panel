'use strict';

/**
 * Eylem grubu hat uzantıları (1.4.0): eylemden önceki durum görüntüsü (`once`, geri al o-12), tek seferlik kayıt (`ic.kayit`: geri al, gecikmeli
 * eylem, oda kapatma, diğer cihazlar) ve 'gecikmeli' kaynağı. Bunlar hattın hiçbir adımını gevşetmez: kapı kuralı, sınıf, servis izin listesi,
 * hız sınırı ve tek POST aynen çalışır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemHattiOlustur, hizSiniriOlustur, oncekiGoruntu, ONCE_OZNITELIKLERI } = require('../src/lib/eylem-hatti');
const { KAYNAKLAR, SINIF, kaynakIzni } = require('../src/lib/eylem-sinifi');
const { eylemOrtami } = require('./eylem-sahte');

function hat(varliklar, favoriler = [], hizSiniri = undefined) {
  const postlar = [];
  const h = eylemHattiOlustur({
    favoriAl: (k) => favoriler.find((f) => f.entity_id === k),
    guncelDurum: async (k) => varliklar[k] ?? null,
    haIstek: async (yol, secenek) => {
      postlar.push({ yol, govde: secenek.govde });
      return [];
    },
    ...(hizSiniri ? { hizSiniri } : {}),
  });
  return { h, postlar };
}

test('once: yalnız geri yüklemeye yarayan öznitelikler kopyalanır; ad, resim adresi ve başka öznitelikler çıkmaz', () => {
  const varlik = {
    entity_id: 'light.salon',
    state: 'on',
    attributes: {
      friendly_name: 'Salon',
      entity_picture: '/api/image/x?token=gizli',
      brightness: 120,
      color_temp_kelvin: 3000,
      rgb_color: [255, 180, 100],
      color_mode: 'rgb',
      effect_list: ['a', 'b'],
      supported_features: 44,
      icerik: { ic: 'nesne' },
    },
  };
  const g = oncekiGoruntu(varlik);
  assert.deepEqual(g, { state: 'on', attributes: { brightness: 120, color_temp_kelvin: 3000, rgb_color: [255, 180, 100], color_mode: 'rgb' } });
  assert.ok(!JSON.stringify(g).includes('gizli'));
  assert.ok(Object.keys(g.attributes).every((k) => ONCE_OZNITELIKLERI.includes(k)));
  // büyük/yanlış türlü değerler atılır
  const k = oncekiGoruntu({ entity_id: 'fan.f', state: 'on', attributes: { percentage: { x: 1 }, entity_id: Array.from({ length: 41 }, (_, i) => `light.l${i}`), brightness: NaN } });
  assert.deepEqual(k.attributes, {});
  assert.deepEqual(oncekiGoruntu(null), { state: '', attributes: {} });
  // dizi kopya olmalı (özgün durum nesnesi paylaşılmaz)
  const ham = { entity_id: 'light.a', state: 'on', attributes: { rgb_color: [1, 2, 3] } };
  const kopya = oncekiGoruntu(ham);
  kopya.attributes.rgb_color[0] = 99;
  assert.equal(ham.attributes.rgb_color[0], 1);
});

test('başarılı sonuç eylemden ÖNCEKİ durumu taşır (POST sonrası değil)', async () => {
  const o = eylemOrtami();
  const sonuclar = [];
  o.katman.sonucDinle((b) => sonuclar.push(b));
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.salon', parlaklik: 20, sonDeger: true });
  const { sonuc } = sonuclar[0];
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.once, { state: 'on', attributes: { brightness: 200, color_mode: 'color_temp', color_temp_kelvin: 3000 } });
  assert.equal(o.depo.al('light.salon').attributes.brightness, Math.round(20 * 2.55), 'HA durumu değişti, önceki görüntü sabit kaldı');
  assert.ok(Object.isFrozen(sonuc), 'izleyiciye dondurulmuş özet gider');
});

test('ic.kayit: favori olmayan varlık tek seferlik kayıtla çalışır; kayıt yoksa/uyuşmuyorsa bilinmeyen-favori', async () => {
  const varliklar = { 'light.mutfak': { entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } } };
  const { h, postlar } = hat(varliklar, []);
  const istek = { kimlik: 'light.mutfak', kaynak: 'palet', eylem: { servis: 'turn_off' } };
  assert.equal((await h(istek)).tur, 'bilinmeyen-favori', 'ic yok: favori listesinde yok');
  assert.equal((await h(istek, {})).tur, 'bilinmeyen-favori');
  assert.equal((await h(istek, { kayit: { entity_id: 'light.baska', ad: 'x' } })).tur, 'bilinmeyen-favori', 'kayıt kimliği uyuşmalı');
  assert.equal((await h(istek, { kayit: null })).tur, 'bilinmeyen-favori');
  assert.equal(postlar.length, 0);
  const s = await h(istek, { kayit: { entity_id: 'light.mutfak', ad: 'Mutfak' } });
  assert.equal(s.ok, true);
  assert.deepEqual(postlar, [{ yol: '/api/services/light/turn_off', govde: { entity_id: 'light.mutfak' } }]);
});

test('ic.kayit hattın diğer adımlarını GEVŞETMEZ: kapı kuralı, okunur alan, hız sınırı, yıkıcı sınıf, servis listesi', async () => {
  const varliklar = {
    'light.kapi_lambasi': { entity_id: 'light.kapi_lambasi', state: 'on', attributes: { friendly_name: 'Kapı lambası' } },
    'light.garaj': { entity_id: 'light.garaj', state: 'on', attributes: { friendly_name: 'Garaj' } },
    'lock.on': { entity_id: 'lock.on', state: 'locked', attributes: { friendly_name: 'Ön' } },
    'cover.perde': { entity_id: 'cover.perde', state: 'open', attributes: { friendly_name: 'Perde' } },
    'sensor.s': { entity_id: 'sensor.s', state: '5', attributes: { friendly_name: 'S' } },
    'button.pc_bilgisayari_kapat': { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: { friendly_name: 'Kapat' } },
    'light.a': { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'A' } },
  };
  let t = 0; // sahte saat: hız sınırı penceresi (1 sn) gerçek zamana bağlı olmasın
  const { h, postlar } = hat(varliklar, [], hizSiniriOlustur({ simdi: () => t }));
  const dene = (kimlik, kaynak = 'palet', eylem) => h({ kimlik, kaynak, eylem }, { kayit: { entity_id: kimlik, ad: 'Masum ad' } });
  assert.equal((await dene('light.kapi_lambasi')).tur, 'yasak', 'HA adı kapıyı belli ediyor');
  assert.equal((await dene('light.garaj')).tur, 'yasak');
  assert.equal((await dene('lock.on')).tur, 'yasak');
  assert.equal((await dene('cover.perde')).tur, 'yasak');
  assert.equal((await dene('sensor.s', 'palet', { servis: 'turn_on' })).tur, 'yasak');
  assert.equal((await dene('button.pc_bilgisayari_kapat', 'kisayol')).tur, 'kaynak-izinsiz', 'yıkıcı eylem kısayoldan çalışmaz');
  assert.equal((await dene('button.pc_bilgisayari_kapat', 'gecikmeli')).tur, 'kaynak-izinsiz', 'yıkıcı eylem gecikmeliden çalışmaz');
  assert.equal((await dene('button.pc_bilgisayari_kapat', 'palet')).tur, 'onay-gerekli', 'palet: basılı tutma ister');
  assert.equal((await dene('light.a', 'palet', { servis: 'lock' })).tur, 'gecersiz');
  assert.equal(postlar.length, 0);
  // hız sınırı (varlık başına saniyede 8)
  const sonuclar = [];
  for (let i = 0; i < 12; i += 1) sonuclar.push((await dene('light.a', 'palet', { servis: 'turn_off' })).tur ?? 'ok');
  assert.equal(sonuclar.filter((s) => s === 'cok-sik').length, 4);
  t += 1000; // pencere dolunca sınır yeniden açılır
  assert.equal((await dene('light.a', 'palet', { servis: 'turn_off' })).ok, true, 'pencere sonrası çağrı yeniden geçer');
});

test('renderer yükü ic.kayit taşıyamaz: yuzeydenCalistir fazladan alanı yok sayar, favori olmayan varlık reddedilir', async () => {
  const o = eylemOrtami();
  o.ha.ekle({ entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } });
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.mutfak', kayit: { entity_id: 'light.mutfak', ad: 'Mutfak' }, ic: { kayit: { entity_id: 'light.mutfak' } } });
  assert.deepEqual([s.ok, s.tur], [false, 'bilinmeyen-favori']);
  assert.equal(o.postlar().length, 0);
});

test('kayitliCalistir: yalnız kimliği eşleşen kayıtla çalışır; sonuç izleyiciye işlem etiketiyle gider', async () => {
  const o = eylemOrtami();
  o.ha.ekle({ entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } });
  const gelenler = [];
  o.katman.sonucDinle((b) => gelenler.push(b));
  assert.equal((await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'palet', kayit: { entity_id: 'light.baska' } }, 'cihaz')).tur, 'bilinmeyen-favori');
  assert.equal((await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'palet' }, 'cihaz')).tur, 'bilinmeyen-favori');
  assert.equal(gelenler.length, 0, 'hatta hiç girmeyen istek izleyiciye gitmez');
  const s = await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'palet', kayit: { entity_id: 'light.mutfak', ad: 'Mutfak' }, eylem: { servis: 'turn_off' } }, 'cihaz');
  assert.equal(s.ok, true);
  assert.equal(gelenler[0].istek.islem, 'cihaz');
  assert.equal(gelenler[0].istek.kaynak, 'palet');
  assert.equal(o.ha.durum.get('light.mutfak').state, 'off');
});

test("'gecikmeli' kaynağı: tanımlı, zararsız eylem çalışır, yıkıcı eylem hiçbir onayla çalışmaz", () => {
  assert.ok(KAYNAKLAR.includes('gecikmeli'));
  assert.deepEqual(kaynakIzni(SINIF.ZARARSIZ, 'gecikmeli'), { izin: true, onayTuru: null });
  assert.deepEqual(kaynakIzni(SINIF.YIKICI, 'gecikmeli'), { izin: false, onayTuru: null });
  assert.deepEqual(kaynakIzni(SINIF.YASAK, 'gecikmeli'), { izin: false, onayTuru: null });
});

test('kayitliCalistir: parti izleyiciye { id, ad } olarak gider; sessiz adım bildirim çıkarmaz (hata dahil) ve "Son kullanılanlar"a yazılmaz', async () => {
  const o = eylemOrtami();
  o.ha.ekle({ entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } });
  const gelenler = [];
  o.katman.sonucDinle((b) => gelenler.push(b));
  const parti = { id: 'oda:mutfak', ad: 'Mutfak' };
  const kayit = { entity_id: 'light.mutfak', ad: 'Mutfak' };
  const s = await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'panel', kayit, eylem: { servis: 'turn_off' }, parti, sessiz: true }, 'oda-kapat');
  assert.equal(s.ok, true);
  assert.deepEqual(gelenler[0].istek.parti, parti);
  assert.ok(Object.isFrozen(gelenler[0].istek.parti));
  assert.equal(gelenler[0].istek.islem, 'oda-kapat');
  assert.equal(o.bildirimler.length, 0, 'sessiz: başarı bildirimi yok');
  assert.deepEqual(o.sonlar, [], 'ana süreç içi işler "Son kullanılanlar"a girmez');
  // hata da sessiz: kapı adına dönen varlık
  o.ha.degistir('light.mutfak', { attributes: { friendly_name: 'Kapı lambası' } });
  const hata = await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'panel', kayit, eylem: { servis: 'turn_on' }, parti, sessiz: true }, 'oda-kapat');
  assert.deepEqual([hata.ok, hata.tur], [false, 'yasak']);
  assert.equal(o.bildirimler.length, 0, 'sessiz: hata bildirimi de yok (özeti çağıran verir)');
  // sessiz değilse bildirim çıkar
  o.ha.degistir('light.mutfak', { attributes: { friendly_name: 'Mutfak' } });
  await o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'panel', kayit, eylem: { servis: 'turn_on' } }, 'cihaz');
  assert.equal(o.bildirimler.length, 1);
});

test('parti bozuk/uzun kimlikle gelirse izleyiciye gitmez; ad kısaltılır', async () => {
  const o = eylemOrtami();
  o.ha.ekle({ entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } });
  const gelenler = [];
  o.katman.sonucDinle((b) => gelenler.push(b));
  const kayit = { entity_id: 'light.mutfak', ad: 'Mutfak' };
  const yap = (parti) => o.katman.kayitliCalistir({ kimlik: 'light.mutfak', kaynak: 'panel', kayit, eylem: { servis: 'turn_off' }, parti }, 'oda-kapat');
  for (const kotu of [null, 'oda', { id: 5 }, { id: '' }, { id: 'x'.repeat(61) }]) {
    await yap(kotu);
    await o.saat.ileri(1100);
  }
  assert.ok(gelenler.every((g) => g.istek.parti === undefined));
  await yap({ id: 'oda:mutfak', ad: 'x'.repeat(300) });
  assert.ok(gelenler.at(-1).istek.parti.ad.length <= 100, 'uzun parti adı bildirim ad sınırına kısaltılır');
});
