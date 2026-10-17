'use strict';

/**
 * Palette favori dışı cihazlar (o-46, src/lib/diger-cihazlar.js): GERÇEK eylem katmanı + sahte HA + sanal saat. Ayar kapalıyken ağa çıkılmaması,
 * liste süzgeci (kapı kuralı, alan, eylem sınıfı, favoriler), 2 dakikalık bellek önbelleği, işlemin AYNI güvenli hattan geçmesi (kapı kuralı canlı
 * durumla yeniden, servis izin listesi, tek POST), favoriye ekleme. Gerçek Home Assistant, ağ ya da pencere YOK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { digerCihazlarOlustur, favoriListesineEkle, ALANLAR, EN_COK_CIHAZ, ONBELLEK_MS } = require('../src/lib/diger-cihazlar');
const { odalariCikar } = require('../src/lib/oda-gruplari');
const { eylemOrtami, TEMEL_VARLIKLAR } = require('./eylem-sahte');

const v = (kimlik, state, ad, ek = {}) => ({ entity_id: kimlik, state, attributes: { ...(ad === null ? {} : { friendly_name: ad }), ...ek } });

/** Favoriler: salon lambası, masa prizi. Diğerleri favori DEĞİL. */
const FAVORILER = [
  { entity_id: 'light.salon', ad: 'Salon lambası' },
  { entity_id: 'switch.priz', ad: 'Masa prizi' },
];

const VARLIKLAR = {
  ...TEMEL_VARLIKLAR,
  'light.mutfak': v('light.mutfak', 'on', 'Mutfak lambası'),
  'light.bahce': v('light.bahce', 'off', 'Bahçe lambası'),
  'fan.balkon': v('fan.balkon', 'off', 'Balkon vantilatörü'),
  'input_boolean.misafir': v('input_boolean.misafir', 'off', 'Misafir modu'),
  'humidifier.nem': v('humidifier.nem', 'on', 'Nem alıcı'),
  'switch.sulama': v('switch.sulama', 'off', 'Sulama prizi'),
  'scene.sinema': v('scene.sinema', 'unknown', 'Sinema', { entity_id: ['light.mutfak'] }),
  // elenmesi gerekenler
  'lock.on_kapi': v('lock.on_kapi', 'locked', 'Ön kapı'),
  'switch.kapi_acici': v('switch.kapi_acici', 'off', 'Kapı açıcı'),
  'light.garaj_kapisi_isigi': v('light.garaj_kapisi_isigi', 'on', 'Garaj kapısı ışığı'),
  'light.kilit_isigi': v('light.kilit_isigi', 'on', 'Işık', { device_class: 'lock' }),
  'cover.perde': v('cover.perde', 'closed', 'Salon perdesi', { device_class: 'curtain' }),
  'script.bilgisayari_kapat': v('script.bilgisayari_kapat', 'off', 'Bilgisayarı kapat'),
  'button.yeniden_baslat': v('button.yeniden_baslat', 'unknown', 'Yeniden başlat'),
  'automation.gece': v('automation.gece', 'on', 'Gece otomasyonu'),
  'sensor.sicaklik': v('sensor.sicaklik', '21', 'Sıcaklık'),
  'scene.kilitli_sahne': v('scene.kilitli_sahne', 'unknown', 'Gece sahnesi', { entity_id: ['light.mutfak', 'lock.on_kapi'] }),
  'light.kullanilamaz': v('light.kullanilamaz', 'unavailable', 'Kullanılamayan lamba'),
  'light.adsiz': v('light.adsiz', 'on', null),
  'switch.bilgisayar_kapat': v('switch.bilgisayar_kapat', 'on', 'Bilgisayarı kapat'),
};

const ISARETLI_AD = 'SIR-ADI-BU-GUNLUGE-GIRMEMELI';

function kur({ ayar = true, varliklar = VARLIKLAR, favoriEkle, alanlarAl, haSarmala, ek = {} } = {}) {
  const o = eylemOrtami({ varliklar, favoriler: FAVORILER, ayarlar: { paletDigerCihazlar: ayar, ...(ek.ayarlar ?? {}) }, haSarmala });
  const gunlukler = [];
  const favoriCagrilari = [];
  const okuma = haSarmala ? haSarmala(o.ha.haIstek) : o.ha.haIstek; // palet listesi okuması (eylem katmanının POST'u haSarmala ile aynı sarmalayıcıdan geçer)
  const d = digerCihazlarOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    haIstek: (yol) => okuma(yol),
    favoriEkle: favoriEkle === null ? null : (favoriEkle ?? (async (k) => (favoriCagrilari.push(k), { ok: true }))),
    ...(alanlarAl ? { alanlarAl } : {}),
    simdi: o.saat.simdi,
    gunluk: (m) => gunlukler.push(m),
  });
  const getler = () => o.ha.istekler.filter((i) => i.yontem === 'GET' && i.yol === '/api/states').length;
  return { ...o, d, gunlukler, favoriCagrilari, getler };
}

const adlar = (liste) => liste.map((x) => x.kimlik);
const yeniSoz = () => new Promise((coz) => setImmediate(coz));

test('ayar KAPALI (varsayılan): liste, çalıştır ve favoriye ekle HA\'ya hiç istek atmaz ve "kapali" döner', async () => {
  const o = kur({ ayar: false });
  assert.deepEqual(await o.d.liste({ kaynak: 'palet' }), { ok: false, tur: 'kapali' });
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'kapali' });
  assert.deepEqual(await o.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.mutfak' }), { ok: false, tur: 'kapali' });
  assert.equal(o.ha.istekler.length, 0, 'ayar kapalıyken ağa çıkılmaz');
  assert.equal(o.postlar().length, 0);
  const varsayilan = eylemOrtami({ favoriler: FAVORILER });
  assert.equal(varsayilan.ayarlar.paletDigerCihazlar, undefined, 'ayar verilmezse kapalı sayılır');
});

test('liste: yalnız güvenli, ulaşılabilir, adı olan, favori olmayan ışık/priz/vantilatör/sanal anahtar/nem alıcı/sahne; ada göre sıralı ve tek okuma', async () => {
  const o = kur();
  const sonuc = await o.d.liste({ kaynak: 'palet' });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(adlar(sonuc.liste), [
    'light.bahce', // Bahçe lambası
    'fan.balkon', // Balkon vantilatörü
    'scene.film', // Film
    'input_boolean.misafir', // Misafir modu
    'light.mutfak', // Mutfak lambası
    'humidifier.nem', // Nem alıcı
    'scene.sinema', // Sinema
    'switch.sulama', // Sulama prizi
    'fan.vantilator', // Vantilatör
    'light.yatak', // Yatak lambası
  ]);
  assert.deepEqual(sonuc.liste.find((x) => x.kimlik === 'light.mutfak'), { kimlik: 'light.mutfak', ad: 'Mutfak lambası', alan: 'light', durum: 'acik' });
  assert.equal(sonuc.liste.find((x) => x.kimlik === 'light.bahce').durum, 'kapali');
  assert.equal(sonuc.liste.find((x) => x.kimlik === 'scene.sinema').durum, 'notr');
  assert.equal(o.getler(), 1, 'tek okuma isteği');
  assert.equal(o.postlar().length, 0, 'liste hiçbir şeyi değiştirmez');
  assert.ok(sonuc.liste.every((x) => ALANLAR.includes(x.alan)));
});

test('liste: kapı/kilit/alarm adlı ya da sınıflı, perde (cover), script, düğme, otomasyon, sensör, kullanılamayan, adsız ve yıkıcı sınıftaki ("kapat" ipucu) varlıklar HİÇ girmez', async () => {
  const o = kur();
  const kimlikler = adlar((await o.d.liste({ kaynak: 'palet' })).liste);
  for (const yasak of [
    'lock.on_kapi',
    'switch.kapi_acici',
    'light.garaj_kapisi_isigi',
    'light.kilit_isigi',
    'cover.perde',
    'script.bilgisayari_kapat',
    'button.yeniden_baslat',
    'automation.gece',
    'sensor.sicaklik',
    'light.kullanilamaz',
    'light.adsiz',
    'switch.bilgisayar_kapat',
    'scene.kilitli_sahne', // üyesi kilit olan sahne
    'light.kapi_lambasi', // TEMEL_VARLIKLAR: adı kapı kuralına takılır
    'button.pc_bilgisayari_kapat',
  ]) {
    assert.ok(!kimlikler.includes(yasak), `${yasak} listede olmamalı`);
  }
});

test('liste: favoriler (ayardaki) çıkar; ayardan favori eklenince önbellekteki liste de ona göre süzülür', async () => {
  const o = kur();
  const ilk = adlar((await o.d.liste({ kaynak: 'palet' })).liste);
  assert.ok(!ilk.includes('light.salon') && !ilk.includes('switch.priz'));
  assert.ok(ilk.includes('light.mutfak'));
  o.ayarlar.favoriler = [...o.ayarlar.favoriler, { entity_id: 'light.mutfak', ad: 'Mutfak lambası' }];
  const sonra = adlar((await o.d.liste({ kaynak: 'palet' })).liste);
  assert.ok(!sonra.includes('light.mutfak'), 'yeni favori listeden hemen çıkar');
  assert.equal(o.getler(), 1, 'süzgeç önbellekten, yeni okuma yok');
});

test('liste: yalnız "palet" kaynağı; panel, tepsi, kısayol ve kaynaksız çağrılar "gecersiz" döner ve HA\'ya gitmez', async () => {
  const o = kur();
  for (const kaynak of ['panel', 'tepsi-menu', 'kisayol', 'komut-satiri', 'masaustu', 'gecikmeli', '', undefined, null, 5]) {
    assert.deepEqual(await o.d.liste({ kaynak }), { ok: false, tur: 'gecersiz' }, String(kaynak));
    assert.deepEqual(await o.d.calistir({ kaynak, kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'gecersiz' });
    assert.deepEqual(await o.d.favoriyeEkle({ kaynak, kimlik: 'light.mutfak' }), { ok: false, tur: 'gecersiz' });
  }
  assert.deepEqual(await o.d.liste(), { ok: false, tur: 'gecersiz' });
  assert.equal(o.ha.istekler.length, 0);
});

test('önbellek: 2 dakika dolmadan yeniden okunmaz, dolunca yenilenir; eşzamanlı istekler tek okumayı paylaşır', async () => {
  const o = kur();
  const [a, b, c] = await Promise.all([o.d.liste({ kaynak: 'palet' }), o.d.liste({ kaynak: 'palet' }), o.d.liste({ kaynak: 'palet' })]);
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(o.getler(), 1, 'üç eşzamanlı istek tek okuma');
  await o.saat.ileri(ONBELLEK_MS - 1000);
  await o.d.liste({ kaynak: 'palet' });
  assert.equal(o.getler(), 1, 'süre dolmadı');
  await o.saat.ileri(2000);
  await o.d.liste({ kaynak: 'palet' });
  assert.equal(o.getler(), 2, 'süre dolunca yeniden okundu');
  assert.equal(o.d.sayi(), 12, 'önbellek favorileri de tutar (liste okunurken süzülür); ayardan favori çıkarılırsa yeniden okuma gerekmez');
});

test('liste: HA okunamazsa "hata" döner (ham hata dışarı sızmaz, günlükte cihaz adı yok) ve sonraki istek yeniden dener', async () => {
  let bozuk = true;
  const o = kur({
    haSarmala: (asil) => async (yol, secenek) => {
      if (bozuk && yol === '/api/states') throw Object.assign(new Error(`http://10.0.0.5:8123 ${ISARETLI_AD}`), { tur: 'sunucu' });
      return asil(yol, secenek);
    },
  });
  const sonuc = await o.d.liste({ kaynak: 'palet' });
  assert.deepEqual(sonuc, { ok: false, tur: 'hata' });
  assert.equal(JSON.stringify(sonuc).includes('10.0.0.5'), false);
  assert.equal(o.gunlukler.join('\n').includes(ISARETLI_AD), false);
  assert.equal(o.gunlukler.join('\n').includes('10.0.0.5'), false);
  bozuk = false;
  assert.equal((await o.d.liste({ kaynak: 'palet' })).ok, true, 'hata önbelleğe alınmadı');
});

test('liste: HA beklenmeyen biçimde yanıt verirse (dizi değil / kirli kayıtlar) boş ya da süzülmüş liste döner, çökmez', async () => {
  const o1 = kur({ haSarmala: (asil) => async (yol, secenek) => (yol === '/api/states' ? { hata: 1 } : asil(yol, secenek)) });
  assert.deepEqual(await o1.d.liste({ kaynak: 'palet' }), { ok: true, liste: [] });
  const o2 = kur({ haSarmala: (asil) => async (yol, secenek) => (yol === '/api/states' ? [null, 5, 'x', {}, { entity_id: 5, state: 'on' }, { entity_id: 'light.../x', state: 'on' }, v('light.iyi', 'on', 'İyi lamba')] : asil(yol, secenek)) });
  assert.deepEqual(adlar((await o2.d.liste({ kaynak: 'palet' })).liste), ['light.iyi']);
});

test('liste: en çok 400 cihaz', async () => {
  const cok = {};
  for (let i = 0; i < 450; i += 1) cok[`light.l${i}`] = v(`light.l${i}`, 'on', `Lamba ${i}`);
  const o = kur({ varliklar: cok });
  assert.equal((await o.d.liste({ kaynak: 'palet' })).liste.length, EN_COK_CIHAZ);
});

test('liste: uzun ya da kontrol karakterli ad listeden çıkar; ad en çok 60 karakter', async () => {
  const o = kur({
    varliklar: {
      'light.uzun': v('light.uzun', 'on', 'U'.repeat(80)),
      'light.kontrol': v('light.kontrol', 'on', 'Kötü\u0000ad'),
      'light.iyi': v('light.iyi', 'on', 'Normal lamba'),
    },
  });
  const liste = (await o.d.liste({ kaynak: 'palet' })).liste;
  assert.ok(liste.some((x) => x.kimlik === 'light.iyi'));
  assert.ok(liste.every((x) => x.ad.length <= 60 && !x.ad.includes('\u0000')));
});

test('oda adları: alan kaydı varsa satıra "oda" eklenir; okunamazsa liste oda adsız yine gelir', async () => {
  const veri = { alanlar: [{ id: 'mutfak', ad: 'Mutfak' }], varlikAlanlari: { 'light.mutfak': 'mutfak', 'fan.balkon': 'yok-boyle-alan' } };
  const o = kur({ alanlarAl: async () => structuredClone(veri) });
  const liste = (await o.d.liste({ kaynak: 'palet' })).liste;
  assert.equal(liste.find((x) => x.kimlik === 'light.mutfak').oda, 'Mutfak');
  assert.equal('oda' in liste.find((x) => x.kimlik === 'fan.balkon'), false);
  assert.equal(odalariCikar(veri).size, 1);
  const o2 = kur({
    alanlarAl: async () => {
      throw new Error('yönetici değil');
    },
  });
  const liste2 = (await o2.d.liste({ kaynak: 'palet' })).liste;
  assert.ok(liste2.length > 0 && liste2.every((x) => !('oda' in x)));
});

test('çalıştır: değiştir = toggle, aç = turn_on, kapat = turn_off; tek POST, eylem hattından (kaynak palet) ve ardından liste yenilenir', async () => {
  const o = kur();
  await o.d.liste({ kaynak: 'palet' });
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'degistir' }), { ok: true });
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/toggle']);
  assert.deepEqual(o.postlar()[0].govde, { entity_id: 'light.mutfak' });
  assert.equal(o.ha.durum.get('light.mutfak').state, 'off');
  await o.saat.ileri(5000);
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'ac' }), { ok: true });
  await o.saat.ileri(5000);
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'fan.balkon', islem: 'kapat' }), { ok: true });
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/toggle', '/api/services/light/turn_on', '/api/services/fan/turn_off']);
  assert.equal(o.d.sayi(), 0, 'durum değişti: önbellek silindi, sonraki liste güncel olsun');
  const yeni = (await o.d.liste({ kaynak: 'palet' })).liste;
  assert.equal(yeni.find((x) => x.kimlik === 'light.mutfak').durum, 'acik');
});

test('çalıştır: sahne yalnız çalıştırılır (turn_on); "kapat" geçersizdir ve "değiştir" de turn_on olur', async () => {
  const o = kur();
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'scene.sinema', islem: 'kapat' }), { ok: false, tur: 'gecersiz' });
  assert.equal(o.postlar().length, 0);
  assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'scene.sinema', islem: 'degistir' }), { ok: true });
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/scene/turn_on']);
});

test('çalıştır: yalnız şu an listede olan kimlik çalışır — favori, kilit, perde, script, düğme, uydurma ve biçimsiz kimlikler POST üretmez', async () => {
  const o = kur();
  for (const kimlik of ['light.salon', 'switch.priz', 'lock.on_kapi', 'cover.perde', 'script.bilgisayari_kapat', 'button.yeniden_baslat', 'light.yok_boyle', 'light.garaj_kapisi_isigi', 'switch.bilgisayar_kapat']) {
    const sonuc = await o.d.calistir({ kaynak: 'palet', kimlik, islem: 'degistir' });
    assert.deepEqual(sonuc, { ok: false, tur: 'bulunamadi' }, kimlik);
  }
  for (const kimlik of [undefined, null, 5, {}, '', 'x', 'light.', 'LIGHT.X', 'light.a b', `light.${'a'.repeat(200)}`]) {
    assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik, islem: 'degistir' }), { ok: false, tur: 'gecersiz' }, String(kimlik));
  }
  for (const islem of [undefined, null, 'turn_on', 'turn_off', 'toggle', 'reload', '__proto__', 'constructor', 5, {}]) {
    assert.deepEqual(await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem }), { ok: false, tur: 'gecersiz' }, String(islem));
  }
  assert.equal(o.postlar().length, 0, 'hiçbir geçersiz istek HA\'ya yazmadı');
});

test('çalıştır: kapı kuralı HA\'daki GÜNCEL durumla yeniden uygulanır — listeye girdikten sonra adı kapıya dönen varlık çalışmaz', async () => {
  const o = kur();
  await o.d.liste({ kaynak: 'palet' });
  o.ha.degistir('light.mutfak', { attributes: { friendly_name: 'Garaj kapısı ışığı' } });
  const sonuc = await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'kapat' });
  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.tur, 'yasak');
  assert.equal(o.postlar().length, 0);
  assert.equal(JSON.stringify(sonuc).includes('Garaj'), false, 'ad yanıta sızmaz');
});

test('çalıştır: HA hatası "ha-hatasi" gibi kısa koda iner; ham ileti, adres ya da cihaz adı yanıtta ve günlükte yok', async () => {
  const o = kur({
    haSarmala: (asil) => async (yol, secenek) => {
      if (secenek?.yontem === 'POST') throw Object.assign(new Error(`http://10.0.0.5:8123 Bearer abc ${ISARETLI_AD}`), { tur: 'sunucu' });
      return asil(yol, secenek);
    },
  });
  const sonuc = await o.d.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'degistir' });
  assert.equal(sonuc.ok, false);
  assert.match(sonuc.tur, /^[a-z-]{3,20}$/);
  const dis = JSON.stringify(sonuc) + o.gunlukler.join('\n');
  assert.equal(dis.includes('10.0.0.5') || dis.includes('Bearer') || dis.includes(ISARETLI_AD), false);
});

test('çalıştır: eylem hattı bilinmeyen bir sonuç kodu verirse renderer\'a "hata" gider', async () => {
  const o = kur();
  const sahte = digerCihazlarOlustur({
    eylem: { kayitliCalistir: async () => ({ ok: false, tur: 'icsel-tuhaf-kod-<script>' }) },
    ayarlarAl: () => o.ayarlar,
    haIstek: (yol) => o.ha.haIstek(yol),
    simdi: o.saat.simdi,
  });
  assert.deepEqual(await sahte.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'hata' });
  const patlayan = digerCihazlarOlustur({
    eylem: {
      kayitliCalistir: async () => {
        throw new Error('x');
      },
    },
    ayarlarAl: () => o.ayarlar,
    haIstek: (yol) => o.ha.haIstek(yol),
    simdi: o.saat.simdi,
  });
  assert.deepEqual(await patlayan.calistir({ kaynak: 'palet', kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'hata' });
});

test('çalıştır: etiket "cihaz", kaynak "palet", tek seferlik kayıtla (favori olmasa da) çağrılır', async () => {
  const cagrilar = [];
  const o = kur();
  const d = digerCihazlarOlustur({
    eylem: {
      kayitliCalistir: async (istek, islem) => {
        cagrilar.push({ istek, islem });
        return { ok: true };
      },
    },
    ayarlarAl: () => o.ayarlar,
    haIstek: (yol) => o.ha.haIstek(yol),
    simdi: o.saat.simdi,
  });
  await d.calistir({ kaynak: 'palet', kimlik: 'light.bahce', islem: 'ac' });
  assert.deepEqual(cagrilar, [{ istek: { kimlik: 'light.bahce', kaynak: 'palet', kayit: { entity_id: 'light.bahce', ad: 'Bahçe lambası' }, eylem: { servis: 'turn_on' } }, islem: 'cihaz' }]);
});

test('ayarDegisti: ayar kapanınca önbellek silinir ve sonraki istek ağa gitmeden "kapali" döner; süren okumanın sonucu yoksayılır', async () => {
  const o = kur();
  await o.d.liste({ kaynak: 'palet' });
  assert.ok(o.d.sayi() > 0);
  o.ayarlar.paletDigerCihazlar = false;
  o.d.ayarDegisti();
  assert.equal(o.d.sayi(), 0);
  const once = o.ha.istekler.length;
  assert.deepEqual(await o.d.liste({ kaynak: 'palet' }), { ok: false, tur: 'kapali' });
  assert.equal(o.ha.istekler.length, once);

  // süren okuma: ayar kapanınca sonuç belleğe yazılmaz
  let birak;
  const kapi = new Promise((coz) => {
    birak = coz;
  });
  const o2 = kur({ haSarmala: (asil) => async (yol, secenek) => (yol === '/api/states' ? (await kapi, asil(yol, secenek)) : asil(yol, secenek)) });
  const bekleyen = o2.d.liste({ kaynak: 'palet' });
  await yeniSoz();
  o2.ayarlar.paletDigerCihazlar = false;
  o2.d.ayarDegisti();
  birak();
  await bekleyen;
  assert.equal(o2.d.sayi(), 0, 'kapanma sırasında biten okuma önbelleğe girmedi');
});

test('kapat(): bellek boşalır', async () => {
  const o = kur();
  await o.d.liste({ kaynak: 'palet' });
  o.d.kapat();
  assert.equal(o.d.sayi(), 0);
});

test('favoriye ekle: listedeki cihaz {kimlik, ad, alan} ile ana süreç işlevine verilir; başarıda önbellek silinir', async () => {
  const o = kur();
  await o.d.liste({ kaynak: 'palet' });
  assert.deepEqual(await o.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.bahce' }), { ok: true });
  assert.deepEqual(o.favoriCagrilari, [{ kimlik: 'light.bahce', ad: 'Bahçe lambası', alan: 'light' }]);
  assert.equal(o.d.sayi(), 0);
  assert.equal(o.postlar().length, 0, 'favoriye eklemek HA\'ya yazmaz');
});

test('favoriye ekle: listede olmayan / kapı kuralına takılan / geçersiz kimlik reddedilir ve ana süreç işlevi çağrılmaz', async () => {
  const o = kur();
  for (const kimlik of ['lock.on_kapi', 'light.garaj_kapisi_isigi', 'light.salon', 'cover.perde', 'script.bilgisayari_kapat', 'light.yok']) {
    assert.deepEqual(await o.d.favoriyeEkle({ kaynak: 'palet', kimlik }), { ok: false, tur: 'bulunamadi' }, kimlik);
  }
  for (const kimlik of [undefined, 5, '', 'x', {}]) assert.deepEqual(await o.d.favoriyeEkle({ kaynak: 'palet', kimlik }), { ok: false, tur: 'gecersiz' });
  assert.equal(o.favoriCagrilari.length, 0);
});

test('favoriye ekle: ana süreç işlevi yoksa "kapali", hata verirse "hata", bilinmeyen kod "hata", "dolu" olduğu gibi döner', async () => {
  const yok = kur({ favoriEkle: null });
  assert.deepEqual(await yok.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.bahce' }), { ok: false, tur: 'kapali' });
  const patlar = kur({
    favoriEkle: async () => {
      throw new Error('disk');
    },
  });
  assert.deepEqual(await patlar.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.bahce' }), { ok: false, tur: 'hata' });
  const tuhaf = kur({ favoriEkle: async () => ({ ok: false, tur: 'C:\\gizli\\yol' }) });
  assert.deepEqual(await tuhaf.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.bahce' }), { ok: false, tur: 'hata' });
  const dolu = kur({ favoriEkle: async () => ({ ok: false, tur: 'dolu' }) });
  assert.deepEqual(await dolu.d.favoriyeEkle({ kaynak: 'palet', kimlik: 'light.bahce' }), { ok: false, tur: 'dolu' });
});

test('favoriListesineEkle (saf): sona eklenir, girdiyi değiştirmez; tekrar, sınır ve güvenlik kuralı reddeder', () => {
  const mevcut = [{ entity_id: 'light.salon', ad: 'Salon lambası' }];
  const kopya = structuredClone(mevcut);
  const s = favoriListesineEkle(mevcut, { kimlik: 'light.bahce', ad: 'Bahçe lambası' });
  assert.equal(s.ok, true);
  assert.deepEqual(s.favoriler.map((f) => f.entity_id), ['light.salon', 'light.bahce']);
  assert.deepEqual(s.favoriler[1], { entity_id: 'light.bahce', ad: 'Bahçe lambası' });
  assert.deepEqual(mevcut, kopya, 'girdi değişmedi');
  assert.deepEqual(favoriListesineEkle(mevcut, { kimlik: 'light.salon', ad: 'x' }), { ok: false, tur: 'zaten-var' });
  assert.deepEqual(favoriListesineEkle(mevcut, { kimlik: 'lock.on_kapi', ad: 'Ön kapı' }), { ok: false, tur: 'yasak' });
  assert.deepEqual(favoriListesineEkle(mevcut, { kimlik: 'light.garaj', ad: 'Garaj kapısı' }), { ok: false, tur: 'yasak' }, 'ad kapı kuralına takılır');
  assert.deepEqual(favoriListesineEkle(mevcut, { kimlik: 'cover.perde', ad: 'Perde' }), { ok: false, tur: 'yasak' }, 'perde (cover) bu yoldan favori olmaz');
  assert.deepEqual(favoriListesineEkle(mevcut, { kimlik: 'kotu kimlik', ad: 'x' }), { ok: false, tur: 'yasak' });
  assert.deepEqual(favoriListesineEkle(null, { kimlik: 'light.a', ad: 'A' }).favoriler.map((f) => f.entity_id), ['light.a']);
  const tam = Array.from({ length: 200 }, (_, i) => ({ entity_id: `light.l${i}`, ad: `L${i}` }));
  assert.deepEqual(favoriListesineEkle(tam, { kimlik: 'light.yeni', ad: 'Yeni' }), { ok: false, tur: 'dolu' });
});

test('yalnız sahne ve aç-kapa alanları: ALANLAR içinde kapı, kilit, perde, script, düğme, otomasyon, vana, kamera, klima ve medya yok', () => {
  for (const yasak of ['lock', 'alarm_control_panel', 'cover', 'valve', 'script', 'button', 'automation', 'camera', 'climate', 'media_player', 'vacuum', 'siren']) {
    assert.ok(!ALANLAR.includes(yasak), yasak);
  }
});
