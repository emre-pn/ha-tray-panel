'use strict';

/**
 * Geri al bağlayıcısı (o-12, src/lib/geri-al-baglayici.js): GERÇEK eylem katmanı + sahte HA + sanal saat. Eylem sonucundan yığına yazma,
 * sahne üyelerinin ön okuması, geri alma adımlarının AYNI güvenli hattan geçmesi (kapı kuralı, sınıf, hız sınırı), süre dolumu, kapalı ayar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { geriAlBaglayiciOlustur } = require('../src/lib/geri-al-baglayici');
const { HAZIRLIK_BUTCESI_MS } = require('../src/eylem');
const { kapiOlustur } = require('../src/lib/kimlikli-kapi');
const { eylemOrtami, TEMEL_VARLIKLAR, TEMEL_FAVORILER } = require('./eylem-sahte');
const { anaCevirmen } = require('../src/lib/ceviri-varsayilan');

function kur(ek = {}) {
  const { t, ...eylemEk } = ek;
  const o = eylemOrtami(eylemEk);
  const bildirimler = [];
  const sayac = { degisti: 0 };
  const b = geriAlBaglayiciOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    bildir: (x) => bildirimler.push(x),
    ...(t ? { t } : {}),
    degisti: () => {
      sayac.degisti += 1;
    },
    simdi: o.saat.simdi,
    zaman: o.saat,
  });
  const panel = (yuk) => o.katman.yuzeydenCalistir('panel', yuk);
  return { ...o, b, bildirimler, sayac, panel, govde: () => o.postlar().map((p) => ({ yol: p.yol, govde: p.govde })) };
}

test('panelden kapatılan ışık geri alınınca önceki durumuna döner; girdi yığından çıkar, tek özet bildirimi verilir', async () => {
  const o = kur();
  assert.equal(o.b.ozet(), null);
  assert.deepEqual(await o.panel({ kimlik: 'light.salon' }), { ok: true, ad: 'Salon lambası' });
  assert.equal(o.ha.durum.get('light.salon').state, 'off');
  assert.deepEqual(o.b.ozet(), { adet: 1, ad: 'Salon lambası', bitis: o.saat.simdi() + 600_000 });
  assert.equal(o.sayac.degisti, 1, 'özet değişince panel/tepsi haberdar edilir');
  const s = await o.b.geriAl('panel');
  assert.deepEqual(s, { ok: true, adim: 1 });
  assert.equal(o.ha.durum.get('light.salon').state, 'on');
  assert.equal(o.b.ozet(), null);
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: 'Geri alındı: Salon lambası' }]);
  assert.deepEqual(o.govde().map((p) => p.yol), ['/api/services/light/toggle', '/api/services/light/turn_on']);
  assert.ok(o.sayac.degisti >= 2);
});

test('geri alma kendisi yığına girmez; ikinci geri alma "geri alınacak bir şey yok" der ve HA\'ya bir şey göndermez', async () => {
  const o = kur();
  await o.panel({ kimlik: 'switch.priz' });
  await o.b.geriAl('kisayol');
  const postSayisi = o.postlar().length;
  assert.equal(o.b.sayi(), 0, 'geri alma tekrar geri alınmaz');
  const s = await o.b.geriAl('kisayol');
  assert.deepEqual(s, { ok: false, tur: 'bos' });
  assert.equal(o.bildirimler.at(-1).metin, 'Geri alınacak bir şey yok.');
  assert.equal(o.postlar().length, postSayisi);
});

test('parlaklık kaydırıcısı: sürükleme tek girdi olur, geri alma sürükleme ÖNCESİ yüzdeye döner', async () => {
  const o = kur();
  for (const yuzde of [60, 40, 20, 10]) {
    await o.panel({ kimlik: 'light.salon', parlaklik: yuzde, sonDeger: yuzde === 10 });
    await o.saat.ileri(150);
  }
  assert.equal(o.ha.durum.get('light.salon').attributes.brightness, Math.round(10 * 2.55));
  assert.equal(o.b.ozet().adet, 1);
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, true);
  const son = o.postlar().at(-1);
  assert.deepEqual(son.govde, { entity_id: 'light.salon', brightness_pct: 78 }, '200/255 = %78');
});

test('ışık rengi (kısa aralıkla art arda değişse bile ilk renge) ve vantilatör hızı önceki değerine döner', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  Object.assign(varliklar['light.salon'].attributes, { supported_color_modes: ['color_temp', 'rgb'], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500 });
  const o = kur({ varliklar });
  assert.equal((await o.panel({ kimlik: 'light.salon', servis: 'turn_on', veri: { color_temp_kelvin: 2200 } })).ok, true);
  await o.saat.ileri(1100);
  assert.equal((await o.panel({ kimlik: 'light.salon', servis: 'turn_on', veri: { rgb_color: [255, 0, 0] } })).ok, true);
  assert.equal(o.ha.durum.get('light.salon').attributes.color_mode, 'rgb');
  assert.equal(o.b.ozet().adet, 1, 'renk değişiklikleri tek girdide');
  assert.equal((await o.b.geriAl('panel')).ok, true);
  assert.equal(o.ha.durum.get('light.salon').attributes.color_temp_kelvin, 3000);
  await o.panel({ kimlik: 'fan.vantilator', servis: 'set_percentage', veri: { percentage: 20 } });
  assert.equal(o.ha.durum.get('fan.vantilator').attributes.percentage, 20);
  await o.b.geriAl('panel');
  assert.equal(o.ha.durum.get('fan.vantilator').attributes.percentage, 66);
});

test('sahne: çalışmadan önce üyelerin durumu okunur; geri alma üyeleri (parlaklıkla) önceki duruma döndürür, kapı adlı üye ve yıkıcı alanlar hiç dokunulmaz', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.film'].attributes.entity_id = ['light.salon', 'switch.priz', 'light.yatak'];
  const o = kur({
    varliklar,
    sahneEtkileri: { 'scene.film': { 'light.salon': { state: 'on', attributes: { brightness: 25 } }, 'switch.priz': { state: 'off' }, 'light.yatak': { state: 'on', attributes: { brightness: 100 } } } },
  });
  await o.panel({ kimlik: 'scene.film' });
  assert.equal(o.ha.durum.get('switch.priz').state, 'off');
  assert.equal(o.ha.durum.get('light.yatak').state, 'on');
  assert.deepEqual(o.b.ozet(), { adet: 1, ad: 'Film', bitis: o.saat.simdi() + 600_000 });
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, true);
  assert.equal(o.ha.durum.get('switch.priz').state, 'on');
  assert.equal(o.ha.durum.get('light.yatak').state, 'off', 'sahne açmıştı: önceki durum kapalı');
  assert.equal(o.ha.durum.get('light.salon').state, 'on');
  assert.equal(o.ha.durum.get('light.salon').attributes.brightness, Math.round(0.78 * 255), 'önceki parlaklık geri yüklendi');
  assert.equal(o.bildirimler.filter((b) => b.tur === 'ok').length >= 1, true);
  // adımlar tek tek bildirim çıkarmaz: eylem katmanının kendi bildirimleri yalnız ilk sahne için
  assert.equal(o.bildirimler.length, 1, 'toplam tek bildirim (geri alma özeti)');
});

test('sahne üyesi onay:true favori ise geri alma onu ONAYSIZ açamaz (kısayol: "kaynak-izinsiz", tepsi: "onay-gerekli"); favori olmayan üye yine geri yüklenir', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.film'].attributes.entity_id = ['switch.priz'];
  const favoriler = TEMEL_FAVORILER.map((f) => (f.entity_id === 'switch.priz' ? { ...f, onay: true } : f));
  for (const [kaynak, beklenen] of [['kisayol', 'kaynak-izinsiz'], ['tepsi-menu', 'onay-gerekli']]) {
    const o = kur({ varliklar, favoriler, sahneEtkileri: { 'scene.film': { 'switch.priz': { state: 'off' } } } });
    assert.deepEqual(await o.panel({ kimlik: 'scene.film' }), { ok: true, ad: 'Film' });
    assert.equal(o.ha.durum.get('switch.priz').state, 'off');
    const once = o.postlar().length;
    const s = await o.b.geriAl(kaynak);
    assert.deepEqual([s.ok, s.tur], [false, beklenen], kaynak);
    assert.equal(o.postlar().length, once, `${kaynak}: ek POST yok`);
    assert.equal(o.ha.durum.get('switch.priz').state, 'off', 'onaylı priz onaysız açılmadı');
  }
  // favori olmayan üye hâlâ tek seferlik kayıtla (onaysız) geri yüklenir
  const serbest = kur({ varliklar, favoriler: TEMEL_FAVORILER.filter((f) => f.entity_id !== 'switch.priz'), sahneEtkileri: { 'scene.film': { 'switch.priz': { state: 'off' } } } });
  await serbest.panel({ kimlik: 'scene.film' });
  assert.equal((await serbest.b.geriAl('kisayol')).ok, true);
  assert.equal(serbest.ha.durum.get('switch.priz').state, 'on');
});

test('sahne üyelerinden kapı/kilit adlı olan geri yüklenmez; sahne kapı içeriyorsa hat zaten reddeder ve girdi oluşmaz', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.film'].attributes.entity_id = ['light.salon', 'light.kapi_lambasi'];
  const o = kur({ varliklar });
  const s = await o.panel({ kimlik: 'scene.film' });
  assert.equal(s.ok, false, 'kapı adlı üye barındıran sahne güvenli sayılmaz (h-39)');
  assert.equal(o.b.ozet(), null);
  assert.equal(o.postlar().length, 0);
});

test('sahne üyeleri 1,5 sn içinde okunamazsa sahne yine çalışır ama geri alma girdisi oluşmaz', async () => {
  const o = kur({
    canli: false,
    haSarmala: (ha) => (yol, secenek) => (yol === '/api/states/light.salon' && !secenek?.yontem ? new Promise(() => {}) : ha(yol, secenek)),
  });
  const bekleyen = o.panel({ kimlik: 'scene.film' });
  await o.saat.ileri(HAZIRLIK_BUTCESI_MS);
  const s = await bekleyen;
  assert.equal(s.ok, true);
  assert.equal(o.postlar().some((p) => p.yol === '/api/services/scene/turn_on'), true);
  assert.equal(o.b.ozet(), null);
});

test('hiç geri alınamayanlar yığına girmez: yıkıcı düğme, hata sonucu, gecikmeli kaynak, geri alma etiketi', async () => {
  const o = kur();
  assert.equal((await o.panel({ kimlik: 'button.pc_bilgisayari_kapat' })).ok, false, 'panel: basılı tutma olmadan çalışmaz');
  assert.equal((await o.panel({ kimlik: 'button.pc_bilgisayari_kapat', basili: true })).ok, false, 'basılı tutma kaydı olmadan onay verilmez');
  assert.equal(o.b.ozet(), null);
  await o.panel({ kimlik: 'light.bilinmeyen' });
  assert.equal(o.b.ozet(), null);
  // gecikmeli kaynak (o-15) kullanıcının o anki hareketi değildir
  const g = await o.katman.kayitliCalistir({ kimlik: 'switch.priz', kaynak: 'gecikmeli', kayit: { entity_id: 'switch.priz', ad: 'Masa prizi' }, eylem: { servis: 'turn_off' } }, 'gecikmeli');
  assert.equal(g.ok, true);
  assert.equal(o.b.ozet(), null);
});

test('kapı kuralı geri alma adımında da çalışır: ad sonradan kapı sözcüğü içerirse geri alma reddedilir, hata bildirilir ve girdi atılır', async () => {
  const o = kur();
  await o.panel({ kimlik: 'switch.priz' });
  o.ha.degistir('switch.priz', { attributes: { friendly_name: 'Kapı prizi' } });
  const gonderilen = o.postlar().length;
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, false);
  assert.equal(s.tur, 'yasak');
  assert.equal(o.postlar().length, gonderilen, 'HA\'ya hiçbir şey gitmedi');
  assert.equal(o.bildirimler.at(-1).tur, 'hata');
  assert.equal(o.b.ozet(), null, 'kalıcı nedenle başarısız girdi tekrar denenmez');
});

test('HA\'ya ulaşılamazsa girdi yığına geri konur ve süre dolmadan yeniden denenebilir', async () => {
  let kapali = false;
  const o = kur({
    haSarmala: (ha) => async (yol, secenek) => {
      if (kapali && secenek?.yontem === 'POST') throw Object.assign(new Error('ag'), { tur: 'ag' });
      return ha(yol, secenek);
    },
  });
  await o.panel({ kimlik: 'switch.priz' });
  kapali = true;
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, false);
  assert.equal(s.tur, 'ha-hatasi');
  assert.equal(o.b.ozet().adet, 1, 'geri alma tekrar denenebilir');
  assert.equal(o.bildirimler.at(-1).metin, 'Geri alınamadı: Masa prizi');
  kapali = false;
  await o.saat.ileri(2000);
  assert.equal((await o.b.geriAl('panel')).ok, true);
  assert.equal(o.ha.durum.get('switch.priz').state, 'on');
  assert.equal(o.b.ozet(), null);
});

test('kısmi başarı: başarılı adımlar uygulanır, başarısız sayı bildirilir', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.film'].attributes.entity_id = ['switch.priz', 'light.yatak'];
  let engelle = false;
  const o = kur({
    varliklar,
    sahneEtkileri: { 'scene.film': { 'switch.priz': { state: 'off' }, 'light.yatak': { state: 'on' } } },
    haSarmala: (ha) => async (yol, secenek) => {
      if (engelle && secenek?.yontem === 'POST' && yol.startsWith('/api/services/light/')) throw Object.assign(new Error('x'), { tur: 'ag' });
      return ha(yol, secenek);
    },
  });
  await o.panel({ kimlik: 'scene.film' });
  engelle = true;
  const s = await o.b.geriAl('panel');
  assert.deepEqual([s.ok, s.tur, s.adim, s.basarisiz], [false, 'kismi', 1, 1]);
  assert.equal(o.ha.durum.get('switch.priz').state, 'on');
  assert.equal(o.bildirimler.at(-1).metin, 'Kısmen geri alındı: Film (1 adım yapılamadı)');
  assert.equal(o.b.ozet(), null, 'kısmi başarıda girdi geri konmaz');
});

test('kısmi başarı: tek başarısız adım her dilde tekil yazılır ("1 step failed"), çoğul sayıda çoğul kalır', async () => {
  const beklenenTekil = {
    tr: 'Kısmen geri alındı: Film (1 adım yapılamadı)',
    en: 'Partly undone: Film (1 step failed)',
    de: 'Teilweise rückgängig gemacht: Film (1 Schritt fehlgeschlagen)',
    fr: 'Annulation partielle : Film (1 étape échouée)',
    es: 'Deshecho en parte: Film (1 paso falló)',
  };
  for (const [dil, metin] of Object.entries(beklenenTekil)) {
    const varliklar = structuredClone(TEMEL_VARLIKLAR);
    varliklar['scene.film'].attributes.entity_id = ['switch.priz', 'light.yatak'];
    let engelle = false;
    const o = kur({
      t: anaCevirmen(dil),
      varliklar,
      sahneEtkileri: { 'scene.film': { 'switch.priz': { state: 'off' }, 'light.yatak': { state: 'on' } } },
      haSarmala: (ha) => async (yol, secenek) => {
        if (engelle && secenek?.yontem === 'POST' && yol.startsWith('/api/services/light/')) throw Object.assign(new Error('x'), { tur: 'ag' });
        return ha(yol, secenek);
      },
    });
    await o.panel({ kimlik: 'scene.film' });
    engelle = true;
    const s = await o.b.geriAl('panel');
    assert.equal(s.basarisiz, 1, dil);
    assert.equal(o.bildirimler.at(-1).metin, metin, dil);
  }
  const en = anaCevirmen('en');
  assert.equal(en('geriAl.kismi', { ad: 'Film', n: 2 }), 'Partly undone: Film (2 steps failed)');
});

test('süre dolumu: girdi 10 dk sonra düşer, panel modeli haberdar edilir; ayardaki süre canlı uygulanır', async () => {
  const o = kur({ ayarlar: { geriAlSureDk: 2 } });
  await o.panel({ kimlik: 'switch.priz' });
  assert.equal(o.b.ozet().adet, 1);
  const once = o.sayac.degisti;
  await o.saat.ileri(119_000);
  assert.equal(o.b.ozet().adet, 1);
  await o.saat.ileri(2_000);
  assert.equal(o.b.ozet(), null);
  assert.equal(o.sayac.degisti, once + 1, 'süre dolunca model yenilenir');
  assert.equal(o.saat.bekleyen(), 0, 'artık zamanlayıcı kalmadı');
  assert.deepEqual(await o.b.geriAl('panel'), { ok: false, tur: 'bos' });
});

test('en çok 5 girdi: altıncı eylem en eskiyi düşürür; geri almalar en yeniden başlar', async () => {
  const o = kur();
  for (let i = 0; i < 6; i += 1) {
    await o.panel({ kimlik: i % 2 === 0 ? 'switch.priz' : 'light.yatak' });
    await o.saat.ileri(1100); // hız sınırı penceresi
  }
  assert.equal(o.b.ozet().adet, 5);
  let geriAlinan = 0;
  while ((await o.b.geriAl('panel')).ok) {
    geriAlinan += 1;
    await o.saat.ileri(1100);
  }
  assert.equal(geriAlinan, 5);
});

test('geriAl ayarı kapalıyken hiçbir şey kaydedilmez; ayar kapanınca yığın boşalır; geçersiz kaynak reddedilir', async () => {
  const o = kur();
  await o.panel({ kimlik: 'switch.priz' });
  assert.equal(o.b.ozet().adet, 1);
  o.ayarlar.geriAl = false;
  o.b.ayarDegisti();
  assert.equal(o.b.ozet(), null);
  assert.deepEqual(await o.b.geriAl('panel'), { ok: false, tur: 'kapali' });
  await o.panel({ kimlik: 'light.yatak' });
  assert.equal(o.b.sayi(), 0, 'kapalıyken yeni girdi yok');
  o.ayarlar.geriAl = true;
  assert.deepEqual(await o.b.geriAl('gecikmeli'), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(await o.b.geriAl('web'), { ok: false, tur: 'gecersiz' });
});

test('iki eşzamanlı geri alma: ikincisi meşgul döner, ilk girdi bir kez uygulanır', async () => {
  const o = kur();
  await o.panel({ kimlik: 'switch.priz' });
  await o.saat.ileri(1100);
  const [a, b] = await Promise.all([o.b.geriAl('panel'), o.b.geriAl('kisayol')]);
  assert.equal(a.ok, true);
  assert.deepEqual(b, { ok: false, tur: 'mesgul' });
  assert.equal(o.postlar().filter((p) => p.yol === '/api/services/switch/turn_on').length, 1);
});

test('parti: oda kapatma gibi toplu iş tek girdi olur, adımlar sessizdir ve geri alma tek özet bildirir', async () => {
  const o = kur();
  o.ha.ekle({ entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak' } });
  o.ha.ekle({ entity_id: 'switch.mutfak_priz', state: 'on', attributes: { friendly_name: 'Mutfak prizi' } });
  const parti = { id: 'oda:mutfak', ad: 'Mutfak' };
  for (const kimlik of ['light.mutfak', 'switch.mutfak_priz']) {
    const s = await o.katman.kayitliCalistir({ kimlik, kaynak: 'palet', kayit: { entity_id: kimlik, ad: kimlik }, eylem: { servis: 'turn_off' }, parti, sessiz: true }, 'oda-kapat');
    assert.equal(s.ok, true);
  }
  assert.equal(o.bildirimler.length, 0);
  assert.equal(o.b.ozet().adet, 1);
  assert.equal(o.b.ozet().ad, 'Mutfak');
  await o.saat.ileri(1100);
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, true);
  assert.equal(s.adim, 2);
  assert.equal(o.ha.durum.get('light.mutfak').state, 'on');
  assert.equal(o.ha.durum.get('switch.mutfak_priz').state, 'on');
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: 'Geri alındı: Mutfak' }]);
  assert.equal(o.sonlar.length, 0, 'ana süreç içi işler "Son kullanılanlar"a girmez');
});

test('kapat(): zamanlayıcı ve yığın temizlenir, izleyici/hazırlık bırakılır', async () => {
  const o = kur();
  await o.panel({ kimlik: 'switch.priz' });
  assert.equal(o.saat.bekleyen() > 0, true);
  o.b.kapat();
  assert.equal(o.saat.bekleyen(), 0);
  assert.equal(o.b.sayi(), 0);
  await o.saat.ileri(1100);
  await o.panel({ kimlik: 'light.yatak' });
  assert.equal(o.b.sayi(), 0, 'kapatıldıktan sonra eylemler izlenmez');
});

test('varsayılan favoriler listesi: yalnız zararsız eylemler girdi üretir (kapı adlı ışık hiç çalışmaz)', async () => {
  const o = kur({ favoriler: TEMEL_FAVORILER });
  const s = await o.panel({ kimlik: 'light.kapi_lambasi' });
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  assert.equal(o.b.ozet(), null);
});

test('(bulgu 11) izlenmeyen sahne üyesinin durumu ikinci çalıştırmada yeniden okunur: bayat "kapalı" yüzünden geri al açık ışığı KAPATMAZ', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.film'].attributes.entity_id = ['light.koridor'];
  varliklar['light.koridor'] = { entity_id: 'light.koridor', state: 'off', attributes: { friendly_name: 'Koridor' } };
  const o = kur({
    varliklar,
    canli: true,
    izlenen: ['scene.film'], // üye favori değil: canlı olayları depoya gelmez
    sahneEtkileri: { 'scene.film': { 'light.koridor': { state: 'on', attributes: { brightness: 255 } } } },
  });
  await o.panel({ kimlik: 'scene.film' }); // 1. çalıştırma: koridor 'off' okunur
  o.ha.degistir('light.koridor', { state: 'on', attributes: { brightness: 128 } }); // elle açıldı: WS olayı depoya gelmez
  await o.saat.ileri(1500);
  await o.panel({ kimlik: 'scene.film' }); // 2. çalıştırma: koridor gerçekte AÇIK
  const once = o.postlar().length;
  const s = await o.b.geriAl('panel');
  assert.equal(s.ok, true);
  const yeni = o.postlar().slice(once);
  assert.equal(yeni.some((p) => p.yol === '/api/services/light/turn_off'), false, 'açık ışık geri alma ile kapatılmadı');
  assert.deepEqual(yeni.map((p) => p.yol), ['/api/services/light/turn_on']);
  assert.equal(o.ha.durum.get('light.koridor').state, 'on');
});

test('(bulgu 12) favori olmayan sahne için hazırlık üyeleri okumaz: HA\'ya hiç GET gitmez, sonuç "bilinmeyen-favori"', async () => {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  varliklar['scene.baska'] = { entity_id: 'scene.baska', state: 'unknown', attributes: { friendly_name: 'Başka', entity_id: ['light.salon', 'switch.priz'] } };
  const o = kur({ varliklar, canli: false });
  const s = await o.panel({ kimlik: 'scene.baska' });
  assert.deepEqual([s.ok, s.tur], [false, 'bilinmeyen-favori']);
  assert.equal(o.ha.istekler.length, 0, 'ne sahne ne üyeler okundu');
  const kotu = await o.panel({ kimlik: 'scene.x/../../config' });
  assert.deepEqual([kotu.ok, kotu.tur], [false, 'gecersiz']);
  assert.equal(o.ha.istekler.length, 0);
  assert.equal(o.b.ozet(), null);
});

/**
 * Gecikmeli HA: her istek kimlikli kapıdan (aynı anda en çok 1, 'yuksek' önde) geçer ve sanal saatle rttMs sürer; istek başlangıçları kaydedilir.
 * Sanal saat zamanlayıcıları sırayla çalıştırır; promise zincirlerinin ilerlemesi için her adımdan sonra olay döngüsü boşaltılır.
 */
function gecikmeliHaKur(rttMs, { uyeSayisi = 12 } = {}) {
  const varliklar = structuredClone(TEMEL_VARLIKLAR);
  const uyeler = [];
  for (let i = 0; i < uyeSayisi; i += 1) {
    const kimlik = `light.u${i}`;
    uyeler.push(kimlik);
    varliklar[kimlik] = { entity_id: kimlik, state: 'on', attributes: { friendly_name: `Üye ${i}`, brightness: 128 } };
  }
  varliklar['scene.film'].attributes.entity_id = uyeler;
  const baslayanlar = [];
  let kapi;
  let o;
  const sar = (ha) => async (yol, sec = {}) => {
    kapi ??= kapiOlustur({ zaman: o.saat });
    const birak = await kapi.al({ oncelik: sec.yontem === 'POST' || sec.oncelik === 'yuksek' ? 'yuksek' : 'normal' });
    baslayanlar.push({ yol, yontem: sec.yontem ?? 'GET', t: o.saat.simdi() });
    try {
      await new Promise((coz) => o.saat.setTimeout(coz, rttMs));
      return await ha(yol, sec);
    } finally {
      birak();
    }
  };
  // üyeler favori değil, yalnız sahne izlenir (canlı bağlantıda yalnız izlenen kümenin olayları depoya gelir)
  o = kur({ varliklar, canli: true, izlenen: ['scene.film'], favoriler: TEMEL_FAVORILER.filter((f) => f.entity_id === 'scene.film'), haSarmala: sar });
  const t0 = o.saat.simdi();
  async function ilerle(toplamMs) {
    for (let gecen = 0; gecen < toplamMs; gecen += 10) {
      await o.saat.ileri(10);
      for (let i = 0; i < 12; i += 1) await new Promise((coz) => setImmediate(coz));
    }
  }
  return { o, baslayanlar, ilerle, t0, uyeler };
}

test('(bulgu 20) 12 izlenmeyen üyeli sahne, yavaş HA (200 ms/istek): üye okumaları bütçeyi aşınca yeni okuma başlamaz ve sahne POST hemen arkasından gider', async () => {
  const { o, baslayanlar, ilerle, t0 } = gecikmeliHaKur(200);
  const sonuc = o.panel({ kimlik: 'scene.film' });
  await ilerle(HAZIRLIK_BUTCESI_MS + 1500);
  assert.equal((await sonuc).ok, true);
  const goreli = baslayanlar.map((b) => ({ ...b, t: b.t - t0 }));
  const uyeOkumalari = goreli.filter((b) => b.yontem === 'GET' && b.yol.includes('light.u'));
  assert.ok(uyeOkumalari.length >= 5, 'bütçe içinde üyeler okundu');
  assert.ok(uyeOkumalari.length < 12, 'hepsi okunmadı');
  assert.equal(uyeOkumalari.filter((b) => b.t >= HAZIRLIK_BUTCESI_MS).length, 0, 'bütçe dolduktan sonra yeni üye okuması başlamadı');
  const post = goreli.find((b) => b.yontem === 'POST');
  assert.ok(post, 'sahne POST gitti');
  assert.ok(post.t <= HAZIRLIK_BUTCESI_MS + 200, `POST ${post.t} ms'de başladı: bütçe + yoldaki tek istek`);
  assert.equal(o.b.ozet(), null, 'okuma tamamlanmadığı için geri al kaydı oluşmadı (eski davranış)');
});

test('(bulgu 20) hızlı HA (20 ms/istek): 12 izlenmeyen üye bütçe içinde sırayla okunur ve geri al kaydı oluşur', async () => {
  const { o, baslayanlar, ilerle, uyeler } = gecikmeliHaKur(20);
  const sonuc = o.panel({ kimlik: 'scene.film' });
  await ilerle(1200);
  assert.equal((await sonuc).ok, true);
  assert.deepEqual(baslayanlar.filter((b) => b.yontem === 'GET' && b.yol.includes('light.u')).map((b) => b.yol.split('/').pop()), uyeler, 'üyeler sırayla ve birer kez okundu');
  assert.deepEqual(o.b.ozet()?.adet, 1);
  const geriAlma = o.b.geriAl('panel'); // geri alma adımları da yavaş HA'dan geçer: sanal saat ilerletilir
  await ilerle(1000);
  assert.equal((await geriAlma).ok, true);
});
