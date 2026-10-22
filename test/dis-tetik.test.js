'use strict';

// 1.4.0 dis grubu: dış tetik kapısı (src/lib/dis-tetik.js), eylem.distenCalistir ve hattın 4b adımı (dış kaynak izni).
// Gerçek HA yok: haIstek sahtedir, POST'lar yalnız kaydedilir.

const test = require('node:test');
const assert = require('node:assert/strict');
const { disTetikKapisiOlustur, disaUygunMu, HIZ_SINIRLARI, ANLIK_OMRU_MS } = require('../src/lib/dis-tetik');
const { DIS_KAYNAKLAR, KAYNAKLAR, disKaynakIzni } = require('../src/lib/eylem-sinifi');
const { eylemHattiOlustur, hizSiniriOlustur } = require('../src/lib/eylem-hatti');
const { eylemKatmaniOlustur } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');
const { cevirmen } = require('../src/lib/dil');
const ANA = require('../src/lib/ceviri/ana');

const SUNUCU = {
  'light.led': { entity_id: 'light.led', state: 'on', attributes: { friendly_name: 'LED şerit', brightness: 102 } },
  'light.ampul': { entity_id: 'light.ampul', state: 'off', attributes: { friendly_name: 'Ampul' } },
  'scene.film': { entity_id: 'scene.film', state: 'unknown', attributes: { friendly_name: 'Film' } },
  'switch.priz': { entity_id: 'switch.priz', state: 'on', attributes: { friendly_name: 'Priz' } },
  'button.pc_bilgisayari_kapat': { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'light.kapi_lambasi': { entity_id: 'light.kapi_lambasi', state: 'on', attributes: { friendly_name: 'Kapı lambası' } },
  'climate.salon': { entity_id: 'climate.salon', state: 'heat', attributes: { friendly_name: 'Salon kliması', min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'heat', 'cool'] } },
};
const FAVORILER = [
  { entity_id: 'light.led', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
  { entity_id: 'scene.film', ad: 'Film' },
  { entity_id: 'switch.priz', ad: 'Priz', onay: true }, // kullanıcı onay istemiş: yıkıcı sayılır
  { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat' },
  { entity_id: 'light.kapi_lambasi', ad: 'Lamba' },
  { entity_id: 'climate.salon', ad: 'Klima', onay: false },
];
const ACIK = { tetikJumpList: true, tetikMasaustu: true, tetikYerelApi: true, tetikProtokol: true, tetikPcOlaylari: true, tetikToplanti: true };

function ortam({ ayar = ACIK, onaySor = null, sunucu = SUNUCU } = {}) {
  const istekler = [];
  const bildirimler = [];
  const olaylar = [];
  const izinler = [];
  const sorular = [];
  const kontrol = { postHata: false, ilkPostHata: false }; // true: sonraki POST'lar ağ hatasıyla düşer (ilkPostHata: yalnız ilki)
  let an = 1_000_000;
  const ayarlar = { favoriler: FAVORILER, ...structuredClone(ayar) };
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const t = cevirmen('tr', ANA);
  const karolarAl = () => yuzeyModeliOlustur({ favoriler: FAVORILER, durumAl: (k) => sunucu[k] }).gruplar.flatMap((g) => g.karolar);
  const eylem = eylemKatmaniOlustur({
    ayarlarAl: () => ayarlar,
    depo,
    canliMi: () => false,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
      if (secenek.yontem === 'POST' && (kontrol.postHata || kontrol.ilkPostHata)) {
        kontrol.ilkPostHata = false;
        throw Object.assign(new Error('x'), { tur: 'ag' });
      }
      const e = /^\/api\/states\/(.+)$/.exec(yol);
      if (e) {
        if (!sunucu[e[1]]) throw Object.assign(new Error('x'), { tur: 'bulunamadi' });
        return sunucu[e[1]];
      }
      return [];
    },
    son: { ekle: () => {} },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {},
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: karolarAl,
    t,
    zaman: { setTimeout: () => 0 },
    simdi: () => an,
  });
  const kapi = disTetikKapisiOlustur({
    ayarlarAl: () => ayarlar,
    karolarAl,
    eylem,
    onaySor: onaySor
      ? async (soru) => {
          sorular.push(soru);
          return onaySor(soru);
        }
      : null,
    izinEkle: (kimlik) => {
      izinler.push(kimlik);
      ayarlar.tetikProtokolIzinleri = [...(ayarlar.tetikProtokolIzinleri ?? []), kimlik];
    },
    bildir: (b) => bildirimler.push(b),
    t,
    olay: (o) => olaylar.push(o),
    simdi: () => an,
  });
  const postlar = () => istekler.filter((i) => i.yontem === 'POST');
  // hız sınırına takılmadan art arda çağrı (her çağrı 2,5 sn sonra)
  const cagir = (istek) => {
    an += 2500;
    return kapi.calistir(istek);
  };
  return { kapi, cagir, eylem, ayarlar, istekler, postlar, bildirimler, olaylar, izinler, sorular, kontrol, ileri: (ms) => (an += ms) };
}

test('dış kaynaklar eylem sınıfı kaynaklarındadır; disKaynakIzni valf, otomasyon, kamera, perde ve klima modunu reddeder', () => {
  assert.deepEqual([...DIS_KAYNAKLAR], ['jumplist', 'kisayol-dosyasi', 'yerel-api', 'protokol', 'pc-olayi', 'toplanti']);
  for (const k of DIS_KAYNAKLAR) assert.ok(KAYNAKLAR.includes(k));
  for (const alan of ['valve', 'automation', 'camera', 'cover', 'lock', 'alarm_control_panel', 'siren', 'todo', '', undefined]) assert.equal(disKaynakIzni(alan, 'turn_on'), false, String(alan));
  for (const servis of ['set_hvac_mode', 'set_fan_mode', 'set_preset_mode', 'turn_on', 'turn_off', 'toggle']) assert.equal(disKaynakIzni('climate', servis), false, servis);
  assert.equal(disKaynakIzni('climate', 'set_temperature'), true);
  assert.equal(disKaynakIzni('light', 'toggle'), true);
  assert.equal(disKaynakIzni('scene', 'turn_on'), true);
});

test('hat 4b: dış kaynaktan klima modu değişimi onaysız favoride bile çalışmaz; aynı istek komut satırından geçer', async () => {
  const cagrilar = [];
  const hat = eylemHattiOlustur({
    favoriAl: (k) => FAVORILER.find((f) => f.entity_id === k),
    guncelDurum: async (k) => SUNUCU[k],
    haIstek: async (yol, secenek) => {
      cagrilar.push({ yol, ...secenek });
      return [];
    },
    hizSiniri: hizSiniriOlustur({ simdi: () => 1000 }),
  });
  const eylem = { servis: 'set_hvac_mode', veri: { hvac_mode: 'cool' } };
  for (const kaynak of DIS_KAYNAKLAR) assert.equal((await hat({ kimlik: 'climate.salon', kaynak, eylem })).tur, 'kaynak-izinsiz', kaynak);
  // fan modu ve ön ayar da modu değiştirdiği için dış kaynaklardan çalışmaz
  for (const diger of [{ servis: 'set_fan_mode', veri: { fan_mode: 'low' } }, { servis: 'set_preset_mode', veri: { preset_mode: 'away' } }]) {
    for (const kaynak of DIS_KAYNAKLAR) assert.equal((await hat({ kimlik: 'climate.salon', kaynak, eylem: diger })).tur, 'kaynak-izinsiz', kaynak + ' ' + diger.servis);
  }
  assert.equal(cagrilar.length, 0);
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'komut-satiri', eylem })).ok, true);
  assert.equal((await hat({ kimlik: 'climate.salon', kaynak: 'yerel-api', eylem: { servis: 'set_temperature', veri: { temperature: 21 } } })).ok, true);
  // yıkıcı favori dış kaynaktan hiç çalışmaz (onay yolu yok)
  assert.equal((await hat({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'protokol', onay: 'diyalog' })).tur, 'kaynak-izinsiz');
});

test('her dış tetik varsayılan KAPALI: istek reddedilir, HA\'ya hiçbir istek gitmez', async () => {
  const o = ortam({ ayar: {} });
  for (const kaynak of DIS_KAYNAKLAR) {
    const istek = kaynak === 'pc-olayi' || kaynak === 'toplanti' ? { kaynak, kimlik: 'light.ampul', islem: 'kapat' } : { kaynak, ad: 'Ampul' };
    assert.equal((await o.kapi.calistir(istek)).tur, 'kapali', kaynak);
  }
  assert.equal(o.istekler.length, 0);
  assert.deepEqual(await o.kapi.calistir({ kaynak: 'panel', ad: 'Ampul' }), { ok: false, tur: 'gecersiz' });
});

test('Jump List: ad yalnız güvenli favoriler arasında çözülür, tek POST; başarı bildirimi verilir ve olay yayılır', async () => {
  const o = ortam();
  const s = await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Ampul' });
  assert.deepEqual(s, { ok: true, ad: 'Ampul' });
  assert.deepEqual(o.postlar(), [{ yol: '/api/services/light/toggle', yontem: 'POST', govde: { entity_id: 'light.ampul' } }]);
  assert.deepEqual(o.bildirimler.map((b) => b.tur), ['ok']);
  assert.equal(o.olaylar.length, 1);
  assert.deepEqual(Object.keys(o.olaylar[0]).sort(), ['ad', 'kaynak', 'kimlik', 'sonuc', 'zaman']);
  assert.deepEqual([o.olaylar[0].kaynak, o.olaylar[0].kimlik, o.olaylar[0].sonuc], ['jumplist', 'light.ampul', 'ok']);
});

test('Kapı Kuralı: kapı adlı istek "yasak"; kapı lambası favorisi karo listesinde yok, hiçbir dış tetikten çalışmaz', async () => {
  const o = ortam();
  assert.equal((await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'kapı' })).tur, 'yasak');
  assert.equal((await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'garage door' })).tur, 'yasak');
  assert.equal((await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'Lamba' })).ok, false);
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.kapi_lambasi', islem: 'kapat' })).tur, 'bulunamadi');
  assert.equal(o.postlar().length, 0);
  assert.equal(o.kapi.uygunlar().some((u) => u.karo.id === 'light.kapi_lambasi'), false);
});

test('ad tabanlı dış tetikler favori ADI ister: varlık kimliği (büyük harf ya da boşlukla da) "gecersiz", HA\'ya istek yok', async () => {
  const o = ortam();
  for (const kaynak of ['jumplist', 'kisayol-dosyasi', 'yerel-api', 'protokol']) {
    for (const ad of ['light.ampul', 'LIGHT.AMPUL', ' light.ampul ']) assert.equal((await o.cagir({ kaynak, ad })).tur, 'gecersiz', `${kaynak} ${ad}`);
  }
  assert.deepEqual(o.kapi.durumAl('light.ampul'), { ok: false, tur: 'gecersiz' });
  assert.equal(o.istekler.length, 0);
  assert.equal((await o.cagir({ kaynak: 'jumplist', ad: 'Ampul' })).ok, true, 'ad ile çalışır');
});

test('yıkıcı ve onaylı favoriler dış tetiğe konmaz: PC kapat, onay istenen priz, klima modu', async () => {
  const o = ortam();
  assert.equal((await o.kapi.calistir({ kaynak: 'kisayol-dosyasi', ad: 'Bilgisayarı kapat' })).tur, 'kaynak-izinsiz');
  assert.equal((await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Priz' })).tur, 'kaynak-izinsiz');
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'switch.priz', islem: 'kapat' })).tur, 'kaynak-izinsiz');
  assert.equal(o.postlar().length, 0);
  const adlar = o.kapi.uygunlar().map((u) => u.ad);
  assert.deepEqual(adlar, ['LED şerit', 'Ampul', 'Film']);
  assert.equal(disaUygunMu(null), false);
  assert.equal(disaUygunMu({ alan: 'light', sinif: 'yikici' }), false);
});

test('yerel API: "klima 24" sıcaklık komutu geçer; bildirim kapalıyken başarı ve hata bildirimi çıkmaz', async () => {
  const o = ortam({ ayar: { ...ACIK, tetikApiBildirim: false } });
  const s = await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'salon kliması 24' });
  assert.equal(s.ok, true);
  assert.deepEqual(o.postlar()[0], { yol: '/api/services/climate/set_temperature', yontem: 'POST', govde: { entity_id: 'climate.salon', temperature: 24 } });
  assert.equal((await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'yok böyle' })).tur, 'bulunamadi');
  assert.deepEqual(o.bildirimler, []);
  const o2 = ortam({ ayar: { ...ACIK, tetikApiBildirim: true } });
  await o2.kapi.calistir({ kaynak: 'yerel-api', ad: 'Ampul' });
  assert.deepEqual(o2.bildirimler.map((b) => b.tur), ['ok']);
});

test('ad değiştiricileri: islem, parlaklik, adim; desteklenmeyen ve çift değer reddedilir', async () => {
  const o = ortam();
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'LED şerit', parlaklik: 40 })).tur, 'reddedildi'); // onaySor yok -> reddet
  o.ayarlar.tetikProtokolIzinleri = ['light.led', 'light.ampul', 'scene.film'];
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'LED şerit', parlaklik: 40 })).ok, true);
  assert.deepEqual(o.postlar().at(-1).govde, { entity_id: 'light.led', brightness_pct: 40 });
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Ampul', islem: 'kapat' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/light/turn_off');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Ampul', parlaklik: 40 })).tur, 'desteklenmiyor'); // parlaklık kontrolü kapalı
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Film', islem: 'kapat' })).tur, 'desteklenmiyor');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Film', adim: 10 })).tur, 'desteklenmiyor');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'led 40', parlaklik: 10 })).tur, 'gecersiz');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Ampul', islem: 'ac', parlaklik: 10 })).tur, 'gecersiz');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Ampul', islem: 'patlat' })).tur, 'gecersiz');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'x'.repeat(61) })).tur, 'gecersiz');
  assert.equal((await o.cagir({ kaynak: 'protokol', ad: 'Amp\u0007ul' })).tur, 'gecersiz');
});

test('hız sınırı: kaynak başına pencere dolunca "cok-sik"; pencere geçince yeniden çalışır', async () => {
  const o = ortam();
  const sinir = HIZ_SINIRLARI.jumplist.enCok;
  for (let i = 0; i < sinir; i += 1) {
    o.ileri(10);
    await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Film' });
  }
  assert.equal((await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Film' })).tur, 'cok-sik');
  assert.equal(o.postlar().length, sinir);
  // başka kaynak kendi penceresini kullanır
  assert.equal((await o.kapi.calistir({ kaynak: 'kisayol-dosyasi', ad: 'Film' })).ok, true);
  o.ileri(HIZ_SINIRLARI.jumplist.pencereMs);
  assert.equal((await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Film' })).ok, true);
});

test('evpaneli:// izni: Reddet hiçbir şey göndermez; İzin ver bir kez çalıştırır; Her zaman izni ayara yazar ve bir daha sormaz', async () => {
  let karar = 'reddet';
  const o = ortam({ onaySor: async () => karar });
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Ampul' })).tur, 'reddedildi');
  assert.equal(o.postlar().length, 0);
  assert.deepEqual(o.sorular, [{ ad: 'Ampul', islem: 'calistir' }]);
  karar = 'izin';
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Ampul' })).ok, true);
  assert.deepEqual(o.izinler, []);
  karar = 'herZaman';
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Ampul' })).ok, true);
  assert.deepEqual(o.izinler, ['light.ampul']);
  karar = 'reddet';
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Ampul' })).ok, true);
  assert.equal(o.sorular.length, 3);
  assert.equal(o.postlar().length, 3);
  // geçersiz karar reddet sayılır
  karar = 'evet';
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Film' })).tur, 'reddedildi');
});

test('evpaneli:// izni: aynı anda tek soru; izin beklerken seçenek kapanırsa izin sonrası hiçbir şey çalışmaz', async () => {
  let coz;
  const o = ortam({ onaySor: () => new Promise((r) => (coz = r)) });
  const ilk = o.kapi.calistir({ kaynak: 'protokol', ad: 'Ampul' });
  await Promise.resolve();
  assert.equal(o.kapi.onayBekliyorMu(), true);
  assert.equal((await o.kapi.calistir({ kaynak: 'protokol', ad: 'Film' })).tur, 'onay-bekliyor');
  o.ayarlar.tetikProtokol = false;
  coz('herZaman');
  assert.equal((await ilk).tur, 'kapali');
  assert.deepEqual(o.izinler, []);
  assert.equal(o.postlar().length, 0);
  assert.equal(o.kapi.onayBekliyorMu(), false);
});

test('PC olayı: varsayılan yalnız kapatma; açma ve geri yükleme ayrı izin ister; geri yükleme önceki durumu kurar', async () => {
  const o = ortam();
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.ampul', islem: 'ac' })).tur, 'kaynak-izinsiz');
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'scene.film', islem: 'calistir' })).tur, 'kaynak-izinsiz');
  assert.equal(o.postlar().length, 0);
  // kilit: LED (açık, %40) ve ampul (kapalı) kapatılır
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' })).ok, true);
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.ampul', islem: 'kapat' })).ok, true);
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/turn_off', '/api/services/light/turn_off']);
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'kaynak-izinsiz');
  o.ayarlar.tetikPcAcma = true;
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).ok, true);
  assert.deepEqual(o.postlar().at(-1).govde, { entity_id: 'light.led', brightness_pct: 40 });
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.ampul', islem: 'geriYukle' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/light/turn_off');
  // anlık tüketildi: ikinci geri yükleme hiçbir şey göndermez ve bildirim vermez
  const once = o.postlar().length;
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok');
  assert.equal(o.postlar().length, once);
  // sahne kapatılamaz
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'scene.film', islem: 'kapat' })).tur, 'desteklenmiyor');
  // başarıda bildirim yok (yalnız hata)
  assert.equal(o.bildirimler.filter((b) => b.tur === 'ok').length, 0);
  assert.ok(o.bildirimler.some((b) => b.tur === 'hata'));
});

test('PC olayı: kilit + uyku arka arkaya ilk durumu korur; anlık ANLIK_OMRU_MS sonra unutulur', async () => {
  const o = ortam({ ayar: { ...ACIK, tetikPcAcma: true } });
  await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' }); // canlı model hâlâ "açık" der; ilk anlık korunur
  await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' });
  assert.deepEqual(o.postlar().at(-1).govde, { entity_id: 'light.led', brightness_pct: 40 });
  await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  o.ileri(ANLIK_OMRU_MS + 1);
  assert.equal((await o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok');
});

test('anlık: eylem BAŞARISIZ olursa saklanmaz (uygulanmamış eylemin eski durumu saatler sonra geri yüklenmez); sonraki başarılı eylem yeni anlık alır', async () => {
  const o = ortam({ ayar: { ...ACIK, tetikPcAcma: true } });
  o.kontrol.postHata = true;
  const hata = await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  assert.equal(hata.ok, false);
  assert.equal((await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok', 'başarısız eylemin anlığı yok');
  assert.equal(o.postlar().length, 1, 'geri yükleme hiçbir komut göndermedi');
  o.kontrol.postHata = false;
  assert.equal((await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' })).ok, true);
  assert.equal((await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).ok, true, 'başarılı eylemin anlığı var');
  assert.deepEqual(o.postlar().at(-1).govde, { entity_id: 'light.led', brightness_pct: 40 });
});

test('anlık: kilit + uyku arka arkaya iken biri başarısız olsa da ilk (asıl) durum korunur; hepsi başarısız olursa anlık kalmaz', async () => {
  const o = ortam({ ayar: { ...ACIK, tetikPcAcma: true } });
  o.kontrol.ilkPostHata = true; // kilit olayının komutu düşer, uyku olayınınki geçer
  const kilit = o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  const uyku = o.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  assert.equal((await kilit).ok, false);
  assert.equal((await uyku).ok, true);
  assert.equal((await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).ok, true, 'biri başardı: anlık duruyor');

  const h = ortam({ ayar: { ...ACIK, tetikPcAcma: true } });
  h.kontrol.postHata = true;
  const a = h.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  const b = h.kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  assert.deepEqual([(await a).ok, (await b).ok], [false, false]);
  assert.equal((await h.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok', 'hiçbiri başaramadı');
});

test('anlık: kaynak başınadır (pc-olayi ve toplanti birbirinin anlığını görmez); kendi kaynağının tüketilmemiş anlığı üzerine yazılmaz', async () => {
  const o = ortam({ ayar: { ...ACIK, tetikPcAcma: true } });
  await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'kapat' });
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok', 'PC olayının anlığı toplantıya geri yükletmez');
  // toplantı kendi anlığını alır; PC olayının anlığı bundan etkilenmez
  await o.cagir({ kaynak: 'toplanti', kimlik: 'light.led', islem: 'baslat' });
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.led', islem: 'geriYukle' })).ok, true);
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.led', islem: 'geriYukle' })).tur, 'anlik-yok', 'tüketildi');
  assert.equal((await o.cagir({ kaynak: 'pc-olayi', kimlik: 'light.led', islem: 'geriYukle' })).ok, true, 'PC olayının anlığı yerinde');
});

test('toplantı ışığı: baslat ışığı açar, sahneyi tek tıklama eylemiyle başlatır; bitişte geri yükleme', async () => {
  const o = ortam();
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.ampul', islem: 'baslat' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/light/turn_on');
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'scene.film', islem: 'baslat' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/scene/turn_on');
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.ampul', islem: 'geriYukle' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/light/turn_off');
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'climate.salon', islem: 'baslat' })).tur, 'komutGerekli');
  assert.equal((await o.cagir({ kaynak: 'toplanti', kimlik: 'light.ampul', islem: 'patlat' })).tur, 'gecersiz');
});

test('yerel API okuma: liste ve durum yalnız uygun favorilerin adını ve kısa durumunu verir (kimlik, öznitelik yok)', () => {
  const o = ortam();
  const liste = o.kapi.listeAl();
  assert.deepEqual(liste, [
    { ad: 'LED şerit', alan: 'light', durum: 'acik', yuzde: 40 },
    { ad: 'Ampul', alan: 'light', durum: 'kapali', yuzde: null },
    { ad: 'Film', alan: 'scene', durum: 'notr', yuzde: null },
  ]);
  assert.doesNotMatch(JSON.stringify(liste), /light\.|scene\./);
  assert.deepEqual(o.kapi.durumAl('led'), { ok: true, ad: 'LED şerit', alan: 'light', durum: 'acik', yuzde: 40 });
  assert.equal(o.kapi.durumAl('Bilgisayarı kapat').tur, 'kaynak-izinsiz');
  assert.equal(o.kapi.durumAl('kapı').tur, 'yasak');
  assert.equal(o.kapi.durumAl('led 40').tur, 'gecersiz');
  assert.equal(o.kapi.durumAl(42).tur, 'gecersiz');
  assert.equal(o.istekler.length, 0);
  assert.deepEqual(o.kapi.kuralUygunlari().map((k) => k.id), ['light.led', 'light.ampul', 'scene.film']);
});

test('eylem.distenCalistir: yalnız dış kaynak; biçim denetimi; bildirim kipi "yok" hata bildirimini de susturur', async () => {
  const o = ortam();
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.ampul', kaynak: 'panel' })).tur, 'gecersiz');
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.ampul', kaynak: 'jumplist', bildirim: 'bazen' })).tur, 'gecersiz');
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.ampul', kaynak: 'jumplist', parlaklik: 101 })).tur, 'gecersiz');
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.ampul', kaynak: 'jumplist', parlaklik: 10, yon: { tur: 'ac' } })).tur, 'gecersiz');
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.ampul', kaynak: 'jumplist', servis: 'Turn On' })).tur, 'gecersiz');
  assert.equal(o.postlar().length, 0);
  const s = await o.eylem.distenCalistir({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'yerel-api', bildirim: 'yok' });
  assert.equal(s.tur, 'kaynak-izinsiz');
  assert.deepEqual(o.bildirimler, []);
  await o.eylem.distenCalistir({ kimlik: 'button.pc_bilgisayari_kapat', kaynak: 'yerel-api', bildirim: 'hata' });
  assert.deepEqual(o.bildirimler.map((b) => b.tur), ['hata']);
  assert.equal((await o.eylem.distenCalistir({ kimlik: 'light.led', kaynak: 'toplanti', parlaklik: 0, bildirim: 'hata' })).ok, true);
  assert.equal(o.postlar().at(-1).yol, '/api/services/light/turn_off');
  assert.equal(o.bildirimler.length, 1);
});

test('kapı reddi bildirimi: kullanıcı tıklamasında hata bildirimi, yerel API\'de bildirim yok; metinlerde kimlik ya da adres yok', async () => {
  const o = ortam({ ayar: {} });
  await o.kapi.calistir({ kaynak: 'jumplist', ad: 'Ampul' });
  await o.kapi.calistir({ kaynak: 'yerel-api', ad: 'Ampul' });
  assert.equal(o.bildirimler.length, 1);
  assert.equal(o.bildirimler[0].tur, 'hata');
  assert.doesNotMatch(JSON.stringify(o.bildirimler), /light\.|http|token|jeton/i);
  assert.deepEqual(o.olaylar.map((x) => [x.kaynak, x.sonuc]), [['jumplist', 'kapali'], ['yerel-api', 'kapali']]);
});

test('olay kancası ya da bildirim hata fırlatsa da kapı çalışır', async () => {
  const cagrilar = [];
  const kapi = disTetikKapisiOlustur({
    ayarlarAl: () => ({ tetikJumpList: true }),
    karolarAl: () => [{ id: 'scene.film', etiket: 'Film', ad: 'Film', alan: 'scene', sinif: 'zararsiz', varsayilanEylem: true, onayliServisler: [] }],
    eylem: { distenCalistir: async (yuk) => (cagrilar.push(yuk), { ok: true }) },
    olay: () => {
      throw new Error('x');
    },
    bildir: () => {
      throw new Error('y');
    },
  });
  assert.deepEqual(await kapi.calistir({ kaynak: 'jumplist', ad: 'Film' }), { ok: true, ad: 'Film' });
  assert.deepEqual(cagrilar, [{ kimlik: 'scene.film', kaynak: 'jumplist', bildirim: 'hepsi' }]);
  assert.equal((await kapi.calistir({ kaynak: 'protokol', ad: 'Film' })).tur, 'kapali');
});

test('PC olayı ve toplantı: distenCalistir aynı tikte çağrılır (uykuya geçerken beklemeden)', () => {
  const cagrilar = [];
  const kapi = disTetikKapisiOlustur({
    ayarlarAl: () => ({ tetikPcOlaylari: true }),
    karolarAl: () => [{ id: 'light.a', etiket: 'A', ad: 'A', alan: 'light', sinif: 'zararsiz', durum: 'acik', yuzde: null, varsayilanEylem: true, onayliServisler: [] }],
    eylem: { distenCalistir: (yuk) => (cagrilar.push(yuk), Promise.resolve({ ok: true })) },
  });
  kapi.calistir({ kaynak: 'pc-olayi', kimlik: 'light.a', islem: 'kapat' });
  assert.deepEqual(cagrilar, [{ kimlik: 'light.a', kaynak: 'pc-olayi', bildirim: 'hata', yon: { tur: 'kapat' } }]);
});

test('dış tetik izin listesi TEK yerde tanımlıdır: src içinde eylem-sinifi.js dışında DIS_*YASAK_ALANLAR / disTetigeUygunServisMi tanımı yoktur', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kok = path.join(__dirname, '..', 'src');
  const dosyalar = [];
  const gez = (dizin) => {
    for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
      const yol = path.join(dizin, girdi.name);
      if (girdi.isDirectory()) gez(yol);
      else if (girdi.name.endsWith('.js')) dosyalar.push(yol);
    }
  };
  gez(kok);
  const tanimlayanlar = dosyalar.filter((yol) => /\b(?:const|let|var)\s+DIS_(?:TETIK_)?YASAK_ALANLAR\b|function\s+disTetigeUygunServisMi\b/.test(fs.readFileSync(yol, 'utf8'))).map((yol) => path.basename(yol));
  assert.deepEqual(tanimlayanlar, ['eylem-sinifi.js']);
});

