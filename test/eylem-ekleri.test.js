'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemEkleriOlustur, eylemKaydi } = require('../src/lib/eylem-ekleri');
const { eylemOrtami, sahteFs } = require('./eylem-sahte');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');

const ETKINLIK_YOLU = 'C:\\veri\\etkinlik-gecmisi.json';

function kur(secenek) {
  const o = eylemOrtami(secenek);
  const fs = sahteFs();
  const ek = eylemEkleriOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    dosyalar: { etkinlik: ETKINLIK_YOLU },
    fs,
    simdi: o.saat.simdi,
    zaman: o.saat,
  });
  return { ...o, ek, fs };
}

test('eylemKaydi: başarı -> ok kaydı (kaynak, kimlik, ad, servis); parlaklık ve geri al/oda etiketleri işlem olur', () => {
  const istek = { kimlik: 'light.salon', kaynak: 'panel', sonDeger: false, araDeger: false };
  assert.deepEqual(eylemKaydi({ istek, sonuc: { ok: true, ad: 'Salon', servis: 'toggle' } }), { kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', ad: 'Salon', sonuc: 'ok' });
  assert.equal(eylemKaydi({ istek: { ...istek, parlaklik: 40 }, sonuc: { ok: true, ad: 'Salon', servis: 'turn_on', parlaklik: 40 } }).islem, 'parlaklik');
  assert.equal(eylemKaydi({ istek: { ...istek, islem: 'geri-al' }, sonuc: { ok: true, ad: 'Salon', servis: 'turn_on' } }).islem, 'geri-al');
  assert.equal(eylemKaydi({ istek: { ...istek, islem: 'oda-kapat' }, sonuc: { ok: true, ad: 'Salon', servis: 'turn_off' } }).islem, 'oda-kapat');
  assert.equal(eylemKaydi({ istek: { ...istek, kaynak: 'gecikmeli', islem: 'gecikmeli' }, sonuc: { ok: true, ad: 'Salon', servis: 'turn_off' } }).islem, 'turn_off');
});

test('eylemKaydi: hata -> hata kaydı + kısa neden; yasak, bilinmeyen-favori, cok-sik, onay-gerekli ve sessiz (ara değer) yazılmaz', () => {
  const istek = { kimlik: 'light.salon', kaynak: 'palet', servis: 'turn_off' };
  assert.deepEqual(eylemKaydi({ istek, sonuc: { ok: false, tur: 'ha-hatasi', neden: 'ag', ad: 'Salon' } }), {
    kaynak: 'palet',
    kimlik: 'light.salon',
    islem: 'turn_off',
    ad: 'Salon',
    sonuc: 'hata',
    neden: 'ha-hatasi/ag',
  });
  assert.equal(eylemKaydi({ istek: { kimlik: 'light.salon', kaynak: 'panel' }, sonuc: { ok: false, tur: 'ulasilamiyor' } }).islem, 'tek-tik');
  assert.equal(eylemKaydi({ istek, sonuc: { ok: false, tur: 'ulasilamiyor' } }).neden, 'ulasilamiyor');
  for (const tur of ['yasak', 'bilinmeyen-favori', 'cok-sik', 'onay-gerekli']) assert.equal(eylemKaydi({ istek, sonuc: { ok: false, tur } }), null, tur);
  assert.equal(eylemKaydi({ istek, sonuc: { ok: true, ad: 'x', servis: 'toggle' }, sessiz: true }), null);
  assert.equal(eylemKaydi(null), null);
  // neden metni serbest biçimli bir hata iletisiyse koda indirilmez, "ha-hatasi" tek başına kalır
  assert.equal(eylemKaydi({ istek, sonuc: { ok: false, tur: 'ha-hatasi', neden: 'Bağlantı http://10.0.0.5:8123 reddedildi' } }).neden, 'ha-hatasi');
});

test('panel, palet, kısayol, komut satırı ve tepsi eylemleri etkinlik geçmişine kaynağıyla yazılır', async () => {
  const o = kur();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  await o.katman.yuzeydenCalistir('palet', { kimlik: 'scene.film' });
  await o.katman.kisayolla('switch.priz');
  await o.katman.komutSatirindan('vantilator');
  await o.katman.tepsiTikla('light.yatak');
  const l = o.ek.etkinlik.liste();
  assert.deepEqual(l.map((k) => k.kaynak), ['tepsi-menu', 'komut-satiri', 'kisayol', 'palet', 'panel']);
  assert.deepEqual(l.map((k) => k.sonuc), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(l.map((k) => k.kimlik), ['light.yatak', 'fan.vantilator', 'switch.priz', 'scene.film', 'light.yatak']);
  assert.deepEqual(l.map((k) => k.islem), ['toggle', 'toggle', 'toggle', 'turn_on', 'toggle']);
  assert.equal(l[0].ad, 'Yatak lambası');
});

test('kaydırıcı ara değerleri ve ses +/- basılı tutma yazılmaz; son değer tek kayıt olur', async () => {
  const o = kur();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.salon', parlaklik: 30 });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.salon', parlaklik: 40, araDeger: true });
  assert.equal(o.ek.etkinlik.sayi(), 0);
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.salon', parlaklik: 45, sonDeger: true });
  assert.equal(o.ek.etkinlik.sayi(), 1);
  assert.equal(o.ek.etkinlik.liste()[0].islem, 'parlaklik');
});

test('hata sonuçları yazılır (HA hatası, ulaşılamıyor); kapı kuralı/yasak yazılmaz ve ad/kimlik hiçbir yerde geçmişe girmez', async () => {
  const o = kur();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.kapi_lambasi' });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'switch.bilinmeyen' });
  assert.equal(o.ek.etkinlik.sayi(), 0);
  o.ha.degistir('light.yatak', { state: 'unavailable' });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  const [k] = o.ek.etkinlik.liste();
  assert.deepEqual([k.sonuc, k.neden, k.kimlik], ['hata', 'ulasilamiyor', 'light.yatak']);
});

test('HA hata iletisindeki adres ve anahtar geçmişe girmez', async () => {
  const o = kur({
    haSarmala: (asil) => async (yol, secenek = {}) => {
      if (secenek.yontem === 'POST') throw Object.assign(new Error('http://192.168.1.5:8123 Bearer eyJhbGciOiJIUzI1NiJ9.gizli'), { tur: 'ag', durumKodu: 502 });
      return asil(yol, secenek);
    },
  });
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.salon' });
  assert.equal(s.ok, false);
  const kayit = o.ek.etkinlik.liste()[0];
  assert.deepEqual([kayit.sonuc, kayit.neden], ['hata', 'ha-hatasi/ag']);
  o.ek.kapat();
  const dosya = o.fs.dosyalar.get(ETKINLIK_YOLU);
  for (const gizli of ['192.168', 'Bearer', 'eyJ', 'gizli', '8123']) assert.ok(!dosya.includes(gizli), `${gizli} dosyaya girmedi`);
});

test('etkinlikGecmisi ayarı kapalıysa yeni kayıt yazılmaz; açılınca yazılır', async () => {
  const o = kur({ ayarlar: { etkinlikGecmisi: false } });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  assert.equal(o.ek.etkinlik.sayi(), 0);
  o.ayarlar.etkinlikGecmisi = true;
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  assert.equal(o.ek.etkinlik.sayi(), 1);
});

test('liste/temizle yüzü: etkinlikListesi acik bilgisini ve kayıtları verir; etkinlikTemizle siler; kapat() izleyiciyi bırakır ve dosyayı yazar', async () => {
  const o = kur();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  const liste = o.ek.etkinlikListesi();
  assert.equal(liste.ok, true);
  assert.equal(liste.acik, true);
  assert.equal(liste.kayitlar.length, 1);
  o.ek.kapat();
  assert.ok(o.fs.dosyalar.has(ETKINLIK_YOLU), 'çıkışta yazılır');
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  assert.equal(o.ek.etkinlik.sayi(), 1, 'kapat() sonrası yeni kayıt yok');
  assert.deepEqual(o.ek.etkinlikTemizle(), { ok: true });
  assert.equal(o.ek.etkinlikListesi().kayitlar.length, 0);
});

test('izleyici hatası eylemi bozmaz: eylem yine başarılı döner', async () => {
  const o = kur();
  o.katman.sonucDinle(() => {
    throw new Error('izleyici patladı');
  });
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  assert.equal(s.ok, true);
  assert.equal(o.postlar().length, 1);
  assert.equal(o.ek.etkinlik.sayi(), 1);
});

// --- geri al (o-12) bağlayıcı entegrasyonu ---------------------------------------------------------

function kurGeriAl(secenek) {
  const o = eylemOrtami(secenek);
  const fs = sahteFs();
  const bildirimler = [];
  const sayac = { degisti: 0 };
  const ek = eylemEkleriOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    dosyalar: { etkinlik: ETKINLIK_YOLU },
    fs,
    simdi: o.saat.simdi,
    zaman: o.saat,
    bildir: (b) => bildirimler.push(b),
    degisti: () => {
      sayac.degisti += 1;
    },
  });
  return { ...o, ek, fs, bildirimler, sayac };
}

test('geri al: modelBolumu özeti verir; geri alma etkinlik geçmişine "geri-al" işlemiyle ve geri alan yüzeyin kaynağıyla yazılır', async () => {
  const o = kurGeriAl();
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'switch.priz' });
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: { adet: 1, ad: 'Masa prizi', bitis: o.saat.simdi() + 600_000 }, gecikmeli: [], degisenler: [], degisenAcik: false });
  const s = await o.ek.geriAl('kisayol');
  assert.equal(s.ok, true);
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  const [geriAl, orijinal] = o.ek.etkinlik.liste();
  assert.deepEqual([geriAl.kaynak, geriAl.islem, geriAl.sonuc, geriAl.kimlik], ['kisayol', 'geri-al', 'ok', 'switch.priz']);
  assert.deepEqual([orijinal.kaynak, orijinal.islem], ['panel', 'toggle']);
  assert.deepEqual(o.bildirimler, [{ tur: 'ok', metin: 'Geri alındı: Masa prizi' }]);
  assert.ok(o.sayac.degisti >= 2, 'ekleme ve geri alma panel modelini yeniletir');
});

test('geri al: sahne geri alınınca her üye adımı etkinlik geçmişine yazılır ama bildirim tek ve özet', async () => {
  const o = kurGeriAl({ sahneEtkileri: { 'scene.film': { 'light.salon': { state: 'off' }, 'switch.priz': { state: 'off' } } } });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'scene.film' });
  const bildirimOnce = o.bildirimler.length;
  await o.saat.ileri(1100);
  const s = await o.ek.geriAl('panel');
  assert.equal(s.ok, true);
  const geriAlKayitlari = o.ek.etkinlik.liste().filter((k) => k.islem === 'geri-al');
  assert.ok(geriAlKayitlari.length >= 2, 'her üye adımı kayıtlı');
  assert.deepEqual([...new Set(geriAlKayitlari.map((k) => k.kimlik))].sort(), ['light.salon', 'switch.priz']);
  assert.equal(o.bildirimler.length - bildirimOnce, 1, 'tek özet bildirimi');
  assert.equal(o.ha.durum.get('switch.priz').state, 'on');
});

test('geri al: kapat() geri alma zamanlayıcısını ve yığınını bırakır; kapatıldıktan sonra eylemler izlenmez', async () => {
  const o = kurGeriAl();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'switch.priz' });
  assert.ok(o.saat.bekleyen() > 0);
  o.ek.kapat();
  assert.equal(o.saat.bekleyen(), 0);
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  await o.saat.ileri(1100);
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.yatak' });
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
});

test('geri al: ayarDegisti geriAl kapanınca yığını boşaltır, süre değişince bitişi yeniden hesaplar', async () => {
  const o = kurGeriAl();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'switch.priz' });
  o.ayarlar.geriAlSureDk = 2;
  o.ek.geriAlAyarDegisti();
  assert.equal(o.ek.modelBolumu().geriAl.bitis, o.saat.simdi() + 120_000);
  o.ayarlar.geriAl = false;
  o.ek.geriAlAyarDegisti();
  assert.deepEqual(o.ek.modelBolumu(), { geriAl: null, gecikmeli: [], degisenler: [], degisenAcik: false });
  assert.deepEqual(await o.ek.geriAl('panel'), { ok: false, tur: 'kapali' });
});

// --- gecikmeli eylem (o-15) bağlayıcı entegrasyonu -------------------------------------------------

test('gecikmeli: gecikmeliPlanla bekleyeni modelBolumu().gecikmeli listesine koyar, zamanı gelince eylem tek güvenli hattan çalışır ve etkinlik geçmişine "gecikmeli" kaynağıyla yazılır', async () => {
  const o = kurGeriAl();
  const plan = await o.ek.gecikmeliPlanla('palet', { kimlik: 'switch.priz', yon: 'kapat', dakika: 5 });
  assert.equal(plan.ok, true);
  const liste = o.ek.modelBolumu().gecikmeli;
  assert.equal(liste.length, 1);
  assert.deepEqual([liste[0].yon, liste[0].ad, liste[0].kimlik], ['kapat', 'Masa prizi', undefined], 'varlık kimliği dışarı verilmez');
  assert.equal(o.postlar().length, 0, 'zamanı gelmeden HA çağrısı yok');
  await o.saat.ileri(5 * 60_000 + 100);
  assert.equal(o.postlar().length, 1);
  assert.match(o.postlar()[0].yol, /switch\/turn_off$/);
  assert.deepEqual(o.ek.modelBolumu().gecikmeli, []);
  const kayit = o.ek.etkinlik.liste().find((k) => k.kaynak === 'gecikmeli');
  assert.ok(kayit, 'gecikmeli kaynağıyla kayıt');
  assert.equal(kayit.kimlik, 'switch.priz');
  assert.equal(kayit.sonuc, 'ok');
});

test('gecikmeli: iptal edilen eylem hiç çalışmaz; gecikmeliHepsiniIptal hepsini siler; kapat() zamanlayıcıları bırakır', async () => {
  const o = kurGeriAl();
  const a = await o.ek.gecikmeliPlanla('panel', { kimlik: 'switch.priz', yon: 'kapat', dakika: 5 });
  await o.ek.gecikmeliPlanla('panel', { kimlik: 'light.yatak', yon: 'kapat', dakika: 10 });
  assert.equal(o.ek.modelBolumu().gecikmeli.length, 2);
  assert.equal(o.ek.gecikmeliIptal(a.id, 'panel'), true);
  assert.equal(o.ek.modelBolumu().gecikmeli.length, 1);
  assert.equal(o.ek.gecikmeliIptal('g999', 'panel'), false, 'bilinmeyen kimlik');
  o.ek.gecikmeliHepsiniIptal();
  assert.deepEqual(o.ek.modelBolumu().gecikmeli, []);
  await o.saat.ileri(11 * 60_000);
  assert.equal(o.postlar().length, 0, 'iptal edilenler çalışmadı');

  await o.ek.gecikmeliPlanla('panel', { kimlik: 'switch.priz', yon: 'kapat', dakika: 5 });
  assert.ok(o.saat.bekleyen() > 0);
  o.ek.kapat();
  assert.equal(o.saat.bekleyen(), 0, 'kapanışta bekleyen zamanlayıcı kalmaz');
  assert.deepEqual(o.ek.modelBolumu().gecikmeli, []);
  await o.saat.ileri(10 * 60_000);
  assert.equal(o.postlar().length, 0);
});

test('gecikmeli: gecikmeliEylem ayarı kapanınca bekleyenler iptal olur ve yeni plan reddedilir', async () => {
  const o = kurGeriAl();
  await o.ek.gecikmeliPlanla('panel', { kimlik: 'switch.priz', yon: 'kapat', dakika: 5 });
  o.ayarlar.gecikmeliEylem = false;
  o.ek.gecikmeliAyarDegisti();
  assert.deepEqual(o.ek.modelBolumu().gecikmeli, []);
  assert.equal((await o.ek.gecikmeliPlanla('panel', { kimlik: 'switch.priz', yon: 'kapat', dakika: 5 })).ok, false);
  await o.saat.ileri(6 * 60_000);
  assert.equal(o.postlar().length, 0);
});

// --- son değişenler (o-18) bağlayıcı entegrasyonu ---------------------------------------------------------

function kurDegisen(ek = {}) {
  const o = eylemOrtami();
  const depo = durumDeposuOlustur({ zaman: { setTimeout: () => 1, clearTimeout: () => {} } });
  const sayac = { degisti: 0 };
  const ek2 = eylemEkleriOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    dosyalar: { etkinlik: ETKINLIK_YOLU },
    fs: sahteFs(),
    simdi: o.saat.simdi,
    zaman: o.saat,
    degisti: () => {
      sayac.degisti += 1;
    },
    depo,
    adAl: (k) => (k === 'light.salon' ? 'Salonum' : undefined),
    ...ek,
  });
  const yaz = (kimlik, state, ad) => {
    depo.guncelle({ entity_id: kimlik, state, attributes: { friendly_name: ad } });
    depo.bosalt();
  };
  return { ...o, depo, ek: ek2, sayac, yaz };
}

test('son değişenler: depo verilirse modelBolumu().degisenler dolar; ad favori etiketinden gelir; degisenAcik ayara bağlıdır', () => {
  const o = kurDegisen();
  assert.deepEqual(o.ek.modelBolumu().degisenler, []);
  assert.equal(o.ek.modelBolumu().degisenAcik, true);
  o.yaz('light.salon', 'off', 'Salon lambası');
  o.yaz('light.salon', 'on', 'Salon lambası');
  const liste = o.ek.modelBolumu().degisenler;
  assert.deepEqual(liste.map((x) => [x.kimlik, x.ad, x.tur]), [['light.salon', 'Salonum', 'acildi']]);
  o.ayarlar.sonDegisenler = false;
  o.ek.sonDegisenlerAyarDegisti();
  assert.deepEqual(o.ek.modelBolumu().degisenler, []);
  assert.equal(o.ek.modelBolumu().degisenAcik, false);
  assert.ok(o.sayac.degisti >= 1, 'ayar değişince panel modeli yenilenir');
});

test('son değişenler: depo verilmezse bölüm boş ve kapalıdır (eski kurulum çökmez); sonDegisenlerAyarDegisti güvenlidir', () => {
  const o = kurGeriAl();
  assert.deepEqual(o.ek.modelBolumu().degisenler, []);
  assert.equal(o.ek.modelBolumu().degisenAcik, false);
  assert.doesNotThrow(() => o.ek.sonDegisenlerAyarDegisti());
});

test('son değişenler: kapat() dinleyiciyi bırakır; kapandıktan sonra gelen durumlar listeye girmez', () => {
  const o = kurDegisen();
  o.yaz('light.salon', 'off', 'Salon');
  o.ek.kapat();
  o.yaz('light.salon', 'on', 'Salon');
  assert.deepEqual(o.ek.modelBolumu().degisenler, []);
});

test('son değişenler: eylem sonucu (panelden aç) depo değişimiyle listeye girer; geri al ve gecikmeli bölümler etkilenmez', async () => {
  const o = kurDegisen();
  o.yaz('switch.priz', 'off', 'Masa prizi');
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'switch.priz' });
  o.yaz('switch.priz', 'on', 'Masa prizi'); // HA'nın canlı bağlantıdan bildirdiği yeni durum
  const bolum = o.ek.modelBolumu();
  assert.deepEqual(bolum.degisenler.map((x) => [x.kimlik, x.tur]), [['switch.priz', 'acildi']]);
  assert.equal(bolum.geriAl.adet, 1);
  assert.deepEqual(bolum.gecikmeli, []);
});

// --- odaya göre gruplama ve "odayı kapat" (o-14) bağlayıcı entegrasyonu ------------------------------------

const ODA_ALANLARI = {
  alanlar: [{ id: 'salon', ad: 'Salon' }],
  varlikAlanlari: { 'light.salon': 'salon', 'switch.priz': 'salon', 'fan.vantilator': 'salon', 'light.kapi_lambasi': 'salon' },
};
const odaKodu = () => require('../src/lib/oda-gruplari').odalariCikar(ODA_ALANLARI).get('salon').kod;

function kurOda(ayar = 'oda') {
  const o = kurDegisen({ alanlarAl: async () => structuredClone(ODA_ALANLARI), dilAl: () => 'tr' });
  o.ayarlar.panelGruplama = ayar;
  for (const [k, ad] of [['light.salon', 'Salon lambası'], ['switch.priz', 'Masa prizi'], ['fan.vantilator', 'Vantilatör'], ['light.kapi_lambasi', 'Kapı lambası']]) o.yaz(k, 'on', ad);
  return o;
}
const MODEL_GRUPLARI = () => [{ kod: 'isik', etiket: 'Işık', karolar: [{ id: 'light.salon' }, { id: 'light.kapi_lambasi' }] }, { kod: 'yardimci', etiket: 'Yardımcı', karolar: [{ id: 'switch.priz' }] }];

test('oda: odaGruplari ayar "tur" iken gruplara dokunmaz; "oda" iken kayıt okununca gruplar odalara göre döner', async () => {
  const tur = kurOda('tur');
  const g = MODEL_GRUPLARI();
  assert.equal(tur.ek.odaGruplari(g), g);
  const o = kurOda();
  assert.equal(o.ek.odaGruplari(g), g, 'kayıt henüz okunmadı: tür gruplu');
  await new Promise((coz) => setImmediate(coz));
  await new Promise((coz) => setImmediate(coz));
  assert.ok(o.sayac.degisti >= 1, 'kayıt gelince panel modeli yenilenir');
  const sonuc = o.ek.odaGruplari(MODEL_GRUPLARI());
  assert.deepEqual(sonuc.filter((x) => x.oda).map((x) => [x.etiket, x.karolar.map((k) => k.id).sort()]), [['Salon', ['light.kapi_lambasi', 'light.salon', 'switch.priz']]]);
});

test('oda: odaKapat yalnız panelden; kapı lambasına dokunulmaz; geri al yığınına TEK girdi (parti) girer ve etkinlik geçmişine her adım "oda-kapat" yazılır', async () => {
  const o = kurOda();
  o.ek.odaGruplari(MODEL_GRUPLARI());
  await new Promise((coz) => setImmediate(coz));
  await new Promise((coz) => setImmediate(coz));
  assert.deepEqual(await o.ek.odaKapat('palet', odaKodu()), { ok: false, tur: 'gecersiz' });
  assert.equal(o.postlar().length, 0);
  const s = await o.ek.odaKapat('panel', odaKodu());
  assert.deepEqual(s, { ok: true, adet: 3, toplam: 3 });
  assert.deepEqual(o.postlar().map((p) => p.yol).sort(), ['/api/services/fan/turn_off', '/api/services/light/turn_off', '/api/services/switch/turn_off']);
  assert.equal(o.postlar().filter((p) => p.govde.entity_id === 'light.kapi_lambasi').length, 0);
  assert.equal(o.ek.modelBolumu().geriAl.adet, 1, 'oda kapatma geri alma yığınına tek girdi');
  const kayitlar = o.ek.etkinlik.liste();
  assert.equal(kayitlar.length, 3);
  assert.ok(kayitlar.every((k) => k.islem === 'oda-kapat' && k.kaynak === 'panel' && k.sonuc === 'ok'));
});

test('oda: alanlarAl verilmezse ya da depo yoksa oda özelliği kapalı kalır (eski kurulum çökmez); odaAyarDegisti paneli yine yeniler', async () => {
  const depoSuz = kur();
  const g = MODEL_GRUPLARI();
  assert.equal(depoSuz.ek.odaGruplari(g), g);
  assert.deepEqual(await depoSuz.ek.odaKapat('panel', odaKodu()), { ok: false, tur: 'kapali' });
  assert.doesNotThrow(() => depoSuz.ek.odaAyarDegisti());
  const alansiz = kurDegisen();
  assert.equal(alansiz.ek.odaGruplari(g), g);
  assert.deepEqual(await alansiz.ek.odaKapat('panel', odaKodu()), { ok: false, tur: 'kapali' });
  const once = alansiz.sayac.degisti;
  alansiz.ek.odaAyarDegisti();
  assert.equal(alansiz.sayac.degisti, once + 1);
});

// --- palette favori dışı cihazlar (o-46) bağlayıcı entegrasyonu ---------------------------------------------

const { TEMEL_VARLIKLAR: DIGER_TEMEL } = require('./eylem-sahte');

const DIGER_VARLIKLARI = {
  ...DIGER_TEMEL,
  'light.mutfak': { entity_id: 'light.mutfak', state: 'on', attributes: { friendly_name: 'Mutfak lambası' } },
  'scene.sinema': { entity_id: 'scene.sinema', state: 'unknown', attributes: { friendly_name: 'Sinema', entity_id: ['light.mutfak'] } },
  'lock.on_kapi': { entity_id: 'lock.on_kapi', state: 'locked', attributes: { friendly_name: 'Ön kapı' } },
};
const DIGER_FAVORILERI = [{ entity_id: 'light.salon', ad: 'Salon lambası' }];

function kurDiger(ayar = true, ek = {}) {
  const o = eylemOrtami({ varliklar: DIGER_VARLIKLARI, favoriler: DIGER_FAVORILERI, ayarlar: { paletDigerCihazlar: ayar } });
  const favoriler = [];
  const sayac = { degisti: 0 };
  const e = eylemEkleriOlustur({
    eylem: o.katman,
    ayarlarAl: () => o.ayarlar,
    dosyalar: { etkinlik: ETKINLIK_YOLU },
    fs: sahteFs(),
    simdi: o.saat.simdi,
    zaman: o.saat,
    degisti: () => {
      sayac.degisti += 1;
    },
    haIstek: (yol) => o.ha.haIstek(yol),
    favoriEkle: async (k) => {
      favoriler.push(k);
      return { ok: true };
    },
    ...ek,
  });
  return { ...o, ek: e, favoriler, sayac };
}

test('diğer cihazlar: ayar kapalıyken (varsayılan) liste/çalıştır/favori "kapali" döner ve HA\'ya hiç istek atılmaz', async () => {
  const o = kurDiger(false);
  assert.deepEqual(await o.ek.digerListe('palet'), { ok: false, tur: 'kapali' });
  assert.deepEqual(await o.ek.digerCalistir('palet', { kimlik: 'light.mutfak', islem: 'degistir' }), { ok: false, tur: 'kapali' });
  assert.deepEqual(await o.ek.digerFavoriEkle('palet', 'light.mutfak'), { ok: false, tur: 'kapali' });
  assert.equal(o.ha.istekler.length, 0);
});

test('diğer cihazlar: liste yalnız palet kaynağına ve yalnız favori olmayan güvenli cihazları içerir; kilit ve favori yok', async () => {
  const o = kurDiger();
  assert.deepEqual(await o.ek.digerListe('panel'), { ok: false, tur: 'gecersiz' });
  const s = await o.ek.digerListe('palet');
  assert.equal(s.ok, true);
  const kimlikler = s.liste.map((x) => x.kimlik);
  assert.ok(kimlikler.includes('light.mutfak') && kimlikler.includes('scene.sinema'));
  assert.ok(!kimlikler.includes('light.salon'), 'favori');
  assert.ok(!kimlikler.includes('lock.on_kapi'), 'kilit');
  assert.ok(!kimlikler.includes('light.kapi_lambasi'), 'adı kapıya takılan ışık');
  assert.ok(!kimlikler.includes('button.pc_bilgisayari_kapat'), 'düğme');
});

test('diğer cihazlar: çalıştır AYNI güvenli hattan geçer — tek POST, etkinlik geçmişi ("palet"), geri alınabilir (yığına girer) ve "Son" listesine karışmaz', async () => {
  const o = kurDiger();
  await o.ek.digerListe('palet');
  assert.deepEqual(await o.ek.digerCalistir('panel', { kimlik: 'light.mutfak', islem: 'degistir' }), { ok: false, tur: 'gecersiz' });
  assert.equal(o.postlar().length, 0);
  assert.deepEqual(await o.ek.digerCalistir('palet', { kimlik: 'light.mutfak', islem: 'degistir' }), { ok: true });
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/toggle']);
  assert.equal(o.ha.durum.get('light.mutfak').state, 'off');
  const kayit = o.ek.etkinlik.liste()[0];
  assert.deepEqual([kayit.kaynak, kayit.kimlik, kayit.sonuc, kayit.ad], ['palet', 'light.mutfak', 'ok', 'Mutfak lambası']);
  assert.equal(o.ek.modelBolumu().geriAl.adet, 1, 'geri al yığınında');
  assert.equal(o.sonlar.length, 0, 'favori olmayan cihaz "Son" listesine yazılmaz');
  // geri al: önceki duruma döner
  assert.equal((await o.ek.geriAl('palet')).ok, true);
  assert.equal(o.ha.durum.get('light.mutfak').state, 'on');
  assert.equal(o.ek.etkinlik.liste()[0].islem, 'geri-al');
});

test('diğer cihazlar: kilit, favori ve uydurma kimlikle çalıştırma POST üretmez', async () => {
  const o = kurDiger();
  for (const kimlik of ['lock.on_kapi', 'light.salon', 'light.yok', 'button.pc_bilgisayari_kapat', 'light.kapi_lambasi']) {
    assert.deepEqual(await o.ek.digerCalistir('palet', { kimlik, islem: 'kapat' }), { ok: false, tur: 'bulunamadi' }, kimlik);
  }
  assert.deepEqual(await o.ek.digerCalistir('palet', null), { ok: false, tur: 'gecersiz' });
  assert.equal(o.postlar().length, 0);
});

test('diğer cihazlar + gecikmeli: favori dışı kimlik yalnız listede ve ayar açıkken ertelenebilir; liste dışı ya da ayar kapalıyken "bilinmeyen-favori"', async () => {
  const o = kurDiger();
  const bilinmeyen = await o.ek.gecikmeliPlanla('palet', { kimlik: 'light.mutfak', yon: 'kapat', dakika: 5 });
  assert.equal(bilinmeyen.ok, true, 'light.mutfak güvenli ve listede');
  for (const kimlik of ['light.yok', 'light.kapi_lambasi']) {
    assert.deepEqual((await o.ek.gecikmeliPlanla('palet', { kimlik, yon: 'kapat', dakika: 5 })).tur, 'bilinmeyen-favori', kimlik);
  }
  for (const kimlik of ['lock.on_kapi', 'script.bilgisayari_kapat', 'button.yeniden_baslat']) {
    assert.deepEqual((await o.ek.gecikmeliPlanla('palet', { kimlik, yon: 'kapat', dakika: 5 })).tur, 'gecersiz', kimlik);
  }
  await o.saat.ileri(5 * 60_000 + 100);
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/turn_off']);

  const kapali = kurDiger(false);
  assert.deepEqual((await kapali.ek.gecikmeliPlanla('palet', { kimlik: 'light.mutfak', yon: 'kapat', dakika: 5 })).tur, 'bilinmeyen-favori');
  assert.equal(kapali.ha.istekler.length, 0, 'ayar kapalıyken HA isteği hiç atılmaz');
});

test('diğer cihazlar: favoriye ekle ana süreç işlevine {kimlik, ad, alan} verir; yalnız palet; digerAyarDegisti kapanınca liste silinir', async () => {
  const o = kurDiger();
  assert.deepEqual(await o.ek.digerFavoriEkle('panel', 'light.mutfak'), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(await o.ek.digerFavoriEkle('palet', 'light.mutfak'), { ok: true });
  assert.deepEqual(o.favoriler, [{ kimlik: 'light.mutfak', ad: 'Mutfak lambası', alan: 'light' }]);
  await o.ek.digerListe('palet');
  const once = o.ha.istekler.length;
  o.ayarlar.paletDigerCihazlar = false;
  o.ek.digerAyarDegisti();
  assert.deepEqual(await o.ek.digerListe('palet'), { ok: false, tur: 'kapali' });
  assert.equal(o.ha.istekler.length, once, 'ayar kapanınca ağa çıkılmaz');
});

test('diğer cihazlar + gecikmeli: digerAyarDegisti paletDigerCihazlar kapanınca favori olmayan cihazın bekleyen gecikmeli eylemini iptal eder; favorininki sürer', async () => {
  const o = kurDiger();
  assert.equal((await o.ek.gecikmeliPlanla('palet', { kimlik: 'light.mutfak', yon: 'kapat', dakika: 5 })).ok, true, 'favori dışı');
  assert.equal((await o.ek.gecikmeliPlanla('palet', { kimlik: 'light.salon', yon: 'kapat', dakika: 5 })).ok, true, 'favori');
  assert.equal(o.ek.modelBolumu().gecikmeli.length, 2);
  o.ek.digerAyarDegisti(); // ayar hâlâ açık
  assert.equal(o.ek.modelBolumu().gecikmeli.length, 2);
  o.ayarlar.paletDigerCihazlar = false;
  o.ek.digerAyarDegisti();
  assert.deepEqual(o.ek.modelBolumu().gecikmeli.map((x) => x.ad), ['Salon lambası']);
  assert.ok(o.ek.etkinlik.liste().some((k) => k.kimlik === 'light.mutfak' && k.islem === 'gecikmeli-iptal'), 'iptal geçmişe yazıldı');
  await o.saat.ileri(5 * 60_000 + 100);
  assert.deepEqual(o.postlar().map((p) => p.govde.entity_id), ['light.salon'], 'iptal edilen cihaza hiçbir komut gitmez');
});

test('diğer cihazlar: haIstek verilmezse özellik kapalı kalır (eski kurulum çökmez); kapat() belleği boşaltır', async () => {
  const haIstekSiz = kurDiger(true, { haIstek: undefined });
  assert.deepEqual(await haIstekSiz.ek.digerListe('palet'), { ok: false, tur: 'kapali' });
  assert.deepEqual(await haIstekSiz.ek.digerCalistir('palet', { kimlik: 'light.mutfak', islem: 'ac' }), { ok: false, tur: 'kapali' });
  assert.doesNotThrow(() => haIstekSiz.ek.digerAyarDegisti());
  const o = kurDiger();
  await o.ek.digerListe('palet');
  o.ek.kapat();
  const once = o.ha.istekler.length;
  await o.ek.digerListe('palet');
  assert.equal(o.ha.istekler.length, once + 1, 'kapat() önbelleği boşalttı: liste yeniden okundu');
});
