'use strict';

// 1.4.0 dis grubu: dış tetik düzenleyicisi (src/dis-tetikler.js). Electron, kayıt defteri ve ağ YOK: app/shell/clipboard, yerel API
// ve toplantı izleyicisi sahtedir.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { disTetiklerOlustur, regSorgulayiciOlustur, EN_AZ_GORUNME_MS, ONAY_SURESI_MS, AYAR_TETIKLERI, DINLENEN_AYARLAR } = require('../src/dis-tetikler');
const { OLAY_GECIKMESI_MS } = require('../src/lib/pc-olaylari');
const { AYGIT_ANAHTARLARI } = require('../src/lib/toplanti-isigi');
const { AYAR_ALANLARI } = require('../src/lib/ayar-alanlari');

const KAROLAR = [
  { id: 'light.salon', etiket: 'Salon', ad: 'Salon', alan: 'light', sinif: 'zararsiz', durum: 'acik', yuzde: 60, parlaklikKontrol: true, varsayilanEylem: true, onayliServisler: [] },
  { id: 'scene.film', etiket: 'Film', ad: 'Film', alan: 'scene', sinif: 'zararsiz', durum: 'notr', yuzde: null, varsayilanEylem: true, onayliServisler: [] },
  { id: 'button.pc_kapat', etiket: 'PC kapat', ad: 'PC kapat', alan: 'button', sinif: 'yikici', durum: 'notr', yuzde: null, varsayilanEylem: true, onayliServisler: ['press'] },
];

function ortam(ayar = {}, { anahtar = true, onayDiyalogu = undefined } = {}) {
  const ayarlar = { ...ayar };
  const kayitlar = [];
  const jumpListler = [];
  const protokolCagrilari = [];
  const kisayollar = [];
  const pano = [];
  const bildirimler = [];
  const eylemler = [];
  const zamanlayicilar = [];
  const apiCagrilari = [];
  const izleyiciCagrilari = [];
  let an = 1_000_000;
  let izleyiciBag = null;
  let apiBag = null;
  let protokolBizim = false;
  let jeton = null;
  let panelGosterilsin = true;
  const app = {
    setJumpList: (plan) => {
      jumpListler.push(plan);
      return 'ok';
    },
    isDefaultProtocolClient: () => protokolBizim,
    setAsDefaultProtocolClient: (...a) => {
      protokolCagrilari.push(['kaydet', ...a]);
      protokolBizim = true;
      return true;
    },
    removeAsDefaultProtocolClient: (...a) => {
      protokolCagrilari.push(['kaldir', ...a]);
      protokolBizim = false;
      return true;
    },
  };
  const d = disTetiklerOlustur({
    app,
    shell: { writeShortcutLink: (yol, islem, secenek) => (kisayollar.push({ yol, islem, secenek }), true) },
    clipboard: { writeText: (m) => pano.push(m) },
    fs: { existsSync: (y) => y.endsWith(`${path.sep}Salon.lnk`) },
    ayarlarAl: () => ayarlar,
    ayarYaz: (yama) => {
      kayitlar.push(yama);
      Object.assign(ayarlar, yama);
    },
    karolarAl: () => KAROLAR,
    eylem: { distenCalistir: async (yuk) => (eylemler.push(yuk), { ok: true }) },
    anahtarVarMi: () => anahtar,
    jetonDeposu: { anahtarAl: async () => jeton, yaz: async (j) => (jeton = j) },
    hedefAl: () => ({ program: 'C:\\EvPaneli\\Ev Paneli.exe', onek: [] }),
    masaustuAl: () => 'C:\\Masaustu',
    panelOnayGoster: () => panelGosterilsin,
    onayDiyalogu,
    geriBildirim: (b) => bildirimler.push(b),
    t: (k, d2) => (d2 ? `${k}:${JSON.stringify(d2)}` : k),
    regSorgula: async () => '',
    zaman: { setTimeout: (fn, ms) => (zamanlayicilar.push({ fn, ms }), zamanlayicilar.length), clearTimeout: () => {} },
    simdi: () => an,
    yerelApiFabrikasi: (bag) => {
      apiBag = bag;
      let calisiyor = false;
      let port = null;
      return {
        bag,
        baslat: async (p) => (apiCagrilari.push(['baslat', p]), (calisiyor = true), (port = p), { ok: true }),
        durdur: async () => (apiCagrilari.push(['durdur']), (calisiyor = false)),
        durum: () => ({ calisiyor, port: calisiyor ? port : null, hata: null }),
        isle: bag.isle,
      };
    },
    izleyiciFabrikasi: (bag) => {
      izleyiciBag = bag;
      let calisiyor = false;
      return {
        baslat: () => (izleyiciCagrilari.push('baslat'), (calisiyor = true)),
        durdur: () => (izleyiciCagrilari.push('durdur'), (calisiyor = false)),
        duraklat: () => izleyiciCagrilari.push('duraklat'),
        surdur: () => izleyiciCagrilari.push('surdur'),
        yenile: () => izleyiciCagrilari.push('yenile'),
        durum: () => ({ calisiyor, duraklatildi: false, toplantida: false }),
      };
    },
  });
  return {
    d,
    ayarlar,
    kayitlar,
    jumpListler,
    protokolCagrilari,
    kisayollar,
    pano,
    bildirimler,
    eylemler,
    zamanlayicilar,
    apiCagrilari,
    izleyiciCagrilari,
    izleyici: () => izleyiciBag,
    apiBag: () => apiBag,
    jeton: () => jeton,
    ileri: (ms) => (an += ms),
    panelYok: () => (panelGosterilsin = false),
    zamanlayicilariCalistir: () => {
      const liste = zamanlayicilar.splice(0);
      for (const z of liste) z.fn();
    },
  };
}

const bekle = () => new Promise(setImmediate);

test('varsayılan: hiçbir tetik bir şey yazmaz ya da açmaz (Jump List boş, protokol kaydı yok, API ve yoklama kapalı)', async () => {
  const o = ortam();
  o.d.baslat();
  await bekle();
  assert.deepEqual(o.jumpListler, [null]);
  assert.deepEqual(o.protokolCagrilari, []);
  assert.deepEqual(o.apiCagrilari, [['durdur']]);
  assert.equal(o.jeton(), null, 'API kapalıyken jeton üretilmez');
  assert.deepEqual(o.izleyiciCagrilari, ['durdur']);
  assert.deepEqual(await o.d.komutSatirindan({ ad: 'Salon', kaynak: 'jumplist' }), { ok: false, tur: 'kapali' });
  assert.deepEqual(o.eylemler, []);
});

test('Jump List: yalnız zararsız favoriler, imza aynıysa yeniden yazılmaz; kapanınca varsayılana döner', async () => {
  const o = ortam({ tetikJumpList: true });
  o.d.baslat();
  const plan = o.jumpListler.at(-1);
  assert.deepEqual(plan[0].items.map((i) => i.title), ['Salon', 'Film']);
  assert.match(plan[0].items[0].args, /^--eylem="Salon" --kaynak=jumplist$/);
  o.d.favorilerDegisti();
  o.d.favorilerDegisti();
  o.d.favorilerDegisti();
  assert.equal(o.zamanlayicilar.length, 1, 'kısma: sık değişiklik tek tazeleme kurar (ertelenip durmaz)');
  o.zamanlayicilariCalistir();
  assert.equal(o.jumpListler.length, 1, 'değişiklik yok: yeniden yazılmadı');
  o.ayarlar.tetikJumpList = false;
  o.d.ayarDegisti('tetikJumpList');
  assert.equal(o.jumpListler.at(-1), null);
  const s = await o.d.komutSatirindan({ ad: 'Salon', kaynak: 'jumplist' });
  assert.equal(s.tur, 'kapali');
});

test('masaüstü kısayolu: seçenek kapalıyken yazılmaz; yalnız uygun favori; var olan dosyanın üzerine yazılmaz', () => {
  const o = ortam();
  assert.deepEqual(o.d.kisayolOlustur('light.salon'), { ok: false, hata: 'kapali' });
  o.ayarlar.tetikMasaustu = true;
  assert.deepEqual(o.d.kisayolOlustur('button.pc_kapat'), { ok: false, hata: 'uygun-degil' });
  assert.deepEqual(o.d.kisayolOlustur('lock.kapi'), { ok: false, hata: 'uygun-degil' });
  assert.deepEqual(o.d.kisayolOlustur('light.salon'), { ok: true, dosya: 'Salon (2).lnk' });
  assert.equal(o.kisayollar.length, 1);
  assert.equal(o.kisayollar[0].yol, path.join('C:\\Masaustu', 'Salon (2).lnk'));
  assert.equal(o.kisayollar[0].islem, 'create');
  assert.equal(o.kisayollar[0].secenek.args, '--eylem="Salon" --kaynak=kisayol');
});

test('evpaneli:// kaydı seçenek açılınca yazılır ("--" ile), kapanınca yalnız bizimse kaldırılır', () => {
  const o = ortam({ tetikProtokol: true });
  o.d.baslat();
  assert.deepEqual(o.protokolCagrilari, [['kaydet', 'evpaneli', 'C:\\EvPaneli\\Ev Paneli.exe', ['--']]]);
  o.d.ayarDegisti('tetikProtokol'); // zaten bizim: yeniden yazılmaz
  assert.equal(o.protokolCagrilari.length, 1);
  o.ayarlar.tetikProtokol = false;
  o.d.ayarDegisti('tetikProtokol');
  assert.deepEqual(o.protokolCagrilari.at(-1), ['kaldir', 'evpaneli', 'C:\\EvPaneli\\Ev Paneli.exe', ['--']]);
  o.d.ayarDegisti('tetikProtokol'); // bizim değil: kaldırılmaz
  assert.equal(o.protokolCagrilari.length, 2);
});

test('evpaneli:// izni panelde: bilet olmadan ya da süre dolmadan izin verilemez; Her zaman izni ayara yazılır', async () => {
  const o = ortam({ tetikProtokol: true });
  const s = o.d.protokoldan('evpaneli://eylem?ad=Salon&parlaklik=30');
  await bekle();
  const soru = o.d.onay.al();
  assert.deepEqual({ ...soru, bilet: typeof soru.bilet }, { bilet: 'string', ad: 'Salon', islem: 'parlaklik', deger: 30, bekleMs: EN_AZ_GORUNME_MS });
  assert.equal(o.d.onay.yanitla('baska-bilet', 'herZaman'), false);
  assert.equal(o.d.onay.yanitla(soru.bilet, 'herZaman'), false, 'çok erken');
  assert.equal(o.d.onay.yanitla(soru.bilet, 'evet'), false);
  o.ileri(EN_AZ_GORUNME_MS);
  assert.equal(o.d.onay.yanitla(soru.bilet, 'herZaman'), true);
  assert.equal((await s).ok, true);
  assert.deepEqual(o.kayitlar, [{ tetikProtokolIzinleri: ['light.salon'] }]);
  assert.deepEqual(o.eylemler, [{ kimlik: 'light.salon', kaynak: 'protokol', bildirim: 'hepsi', parlaklik: 30 }]);
  assert.equal(o.d.onay.al(), null);
  // izin kaldırılır
  assert.deepEqual(o.d.izinKaldir('light.salon'), { ok: true });
  assert.deepEqual(o.ayarlar.tetikProtokolIzinleri, []);
  assert.deepEqual(o.d.izinKaldir('light.salon'), { ok: false });
});

test('evpaneli:// izni: Reddet hemen kabul edilir; panel kapanırsa ya da süre dolarsa reddedilir; bozuk bağlantı bildirilir', async () => {
  const o = ortam({ tetikProtokol: true });
  let s = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  assert.equal(o.d.onay.yanitla(o.d.onay.al().bilet, 'reddet'), true);
  assert.equal((await s).tur, 'reddedildi');
  s = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  o.d.onay.kapandi();
  assert.equal((await s).tur, 'reddedildi');
  s = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  const zamanAsimi = o.zamanlayicilar.findLast((z) => z.ms === ONAY_SURESI_MS);
  zamanAsimi.fn();
  assert.equal((await s).tur, 'reddedildi');
  assert.deepEqual(o.eylemler, []);
  assert.equal((await o.d.protokoldan('evpaneli://eylem?kimlik=light.salon')).tur, 'gecersiz');
  assert.equal(o.bildirimler.at(-1).metin, 'dis.baglantiGecersiz');
  // yıkıcı favori soru bile sormadan reddedilir
  assert.equal((await o.d.protokoldan('evpaneli://eylem?ad=PC%20kapat')).tur, 'kaynak-izinsiz');
});

test('evpaneli:// izni: panel gösterilemezse yedek iletişim kutusu yoksa reddedilir', async () => {
  const o = ortam({ tetikProtokol: true });
  o.panelYok();
  assert.equal((await o.d.protokoldan('evpaneli://eylem?ad=Film')).tur, 'reddedildi');
});

test('evpaneli:// izni: yedek iletişim kutusu zaman aşımında ve durdur() ile iptal sinyalini alır; ikinci bağlantı yığılmaz', async () => {
  const sinyaller = [];
  const onayDiyalogu = (soru, secenek) => {
    sinyaller.push(secenek?.signal);
    return new Promise(() => {}); // kullanıcı hiç yanıtlamaz
  };
  const o = ortam({ tetikProtokol: true }, { onayDiyalogu });
  o.panelYok();
  const s = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  assert.equal(sinyaller.length, 1);
  assert.equal(sinyaller[0].aborted, false, 'soru açıkken kutu açık kalır');
  o.zamanlayicilar.findLast((z) => z.ms === ONAY_SURESI_MS).fn();
  assert.equal((await s).tur, 'reddedildi');
  assert.equal(sinyaller[0].aborted, true, 'zaman aşımında açık kutu kapatılır');
  // durdur() bekleyen soruyu bitirirken kutuyu da kapatır
  const s2 = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  assert.equal(sinyaller.length, 2);
  assert.equal(sinyaller[1].aborted, false);
  o.d.durdur();
  assert.equal((await s2).tur, 'reddedildi');
  assert.equal(sinyaller[1].aborted, true);
  assert.deepEqual(o.eylemler, []);
});

test('yerel API: açılınca jeton üretilir ve sunucu başlar; port değişince yeniden başlar; kapanınca durur; jeton yalnız panoya gider', async () => {
  const o = ortam({ tetikYerelApi: true, tetikApiPortu: 48200 });
  o.d.baslat();
  await o.d.durum();
  await bekle();
  assert.match(o.jeton(), /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(o.apiCagrilari, [['baslat', 48200]]);
  o.ayarlar.tetikApiPortu = 48201;
  await o.d.ayarDegisti('tetikApiPortu');
  await bekle();
  assert.deepEqual(o.apiCagrilari.at(-1), ['baslat', 48201]);
  const durum = await o.d.durum();
  assert.equal(durum.api.jetonVar, true);
  assert.doesNotMatch(JSON.stringify(durum), new RegExp(o.jeton()));
  assert.deepEqual(await o.d.jetonKopyala(), { ok: true });
  assert.deepEqual(o.pano, [o.jeton()]);
  const eski = o.jeton();
  assert.deepEqual(await o.d.jetonYenile(), { ok: true });
  assert.notEqual(o.jeton(), eski);
  o.ayarlar.tetikYerelApi = false;
  o.d.ayarDegisti('tetikYerelApi');
  await bekle();
  await bekle();
  assert.deepEqual(o.apiCagrilari.at(-1), ['durdur']);
});

test('yerel API isle: kapalıyken kapali; liste/durum yalnız okur; eylem kapıdan geçer ve bildirim kipi ayara göre', async () => {
  const o = ortam({ tetikYerelApi: true });
  const isle = o.apiBag().isle;
  assert.deepEqual(await isle('/liste', {}), {
    ok: true,
    favoriler: [
      { ad: 'Salon', alan: 'light', durum: 'acik', yuzde: 60 },
      { ad: 'Film', alan: 'scene', durum: 'notr', yuzde: null },
    ],
  });
  assert.deepEqual(await isle('/durum', { ad: 'salon' }), { ok: true, ad: 'Salon', alan: 'light', durum: 'acik', yuzde: 60 });
  assert.deepEqual(o.eylemler, []);
  assert.equal((await isle('/eylem', { ad: 'PC kapat' })).tur, 'kaynak-izinsiz');
  assert.equal((await isle('/eylem', { ad: 'Salon', islem: 'kapat' })).ok, true);
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'light.salon', kaynak: 'yerel-api', bildirim: 'yok', yon: { tur: 'kapat' } });
  o.ayarlar.tetikApiBildirim = true;
  await isle('/eylem', { ad: 'Film' });
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'scene.film', kaynak: 'yerel-api', bildirim: 'hepsi' });
  o.ayarlar.tetikYerelApi = false;
  assert.deepEqual(await isle('/liste', {}), { ok: false, tur: 'kapali' });
  assert.deepEqual(await isle('/eylem', { ad: 'Film' }), { ok: false, tur: 'kapali' });
});

test('PC olayları: kilit kuralı hemen, uyanış kuralı gecikmeli çalışır; ilk kullanımda bir kez uyarılır; uykuda yoklama durur', async () => {
  const o = ortam({
    tetikPcOlaylari: true,
    tetikPcAcma: true,
    tetikPcKurallari: [
      { olay: 'kilit', kimlik: 'light.salon', islem: 'kapat' },
      { olay: 'uyanis', kimlik: 'light.salon', islem: 'geriYukle' },
      { olay: 'uyku', kimlik: 'button.pc_kapat', islem: 'calistir' },
    ],
  });
  o.d.guc('kilit');
  await bekle();
  assert.deepEqual(o.eylemler, [{ kimlik: 'light.salon', kaynak: 'pc-olayi', bildirim: 'hata', yon: { tur: 'kapat' } }]);
  assert.deepEqual(o.kayitlar, [{ tetikPcUyarisi: true }]);
  assert.deepEqual(o.bildirimler.map((b) => b.metin), ['dis.pcIlkKez']);
  o.d.guc('uyku');
  await bekle();
  assert.equal(o.eylemler.length, 1, 'yıkıcı düğme PC olayından çalışmaz');
  assert.ok(o.izleyiciCagrilari.includes('duraklat'));
  o.d.guc('uyanis');
  assert.ok(o.izleyiciCagrilari.includes('surdur'));
  assert.equal(o.zamanlayicilar.at(-1).ms, OLAY_GECIKMESI_MS.uyanis);
  o.zamanlayicilar.at(-1).fn();
  await bekle();
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'light.salon', kaynak: 'pc-olayi', bildirim: 'hata', parlaklik: 60 });
  assert.equal(o.bildirimler.filter((b) => b.metin === 'dis.pcIlkKez').length, 1, 'uyarı bir kez');
  o.d.guc('bilinmeyen');
});

test('toplantı ışığı: başlangıçta favori başlar, bitişte seçime göre geri yükleme / kapatma / başka favori', async () => {
  const o = ortam({ tetikToplanti: true, tetikToplantiFavori: 'light.salon', tetikToplantiBitis: 'geriYukle' });
  o.d.baslat();
  assert.ok(o.izleyiciCagrilari.includes('baslat'));
  o.izleyici().degisti(true);
  await bekle();
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'light.salon', kaynak: 'toplanti', bildirim: 'hata', yon: { tur: 'ac' } });
  o.ileri(10_000);
  o.izleyici().degisti(false);
  await bekle();
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'light.salon', kaynak: 'toplanti', bildirim: 'hata', parlaklik: 60 });
  o.ayarlar.tetikToplantiBitis = 'favori';
  o.ayarlar.tetikToplantiBitisFavori = 'scene.film';
  o.ileri(10_000);
  o.izleyici().degisti(false);
  await bekle();
  assert.deepEqual(o.eylemler.at(-1), { kimlik: 'scene.film', kaynak: 'toplanti', bildirim: 'hata' });
  o.ayarlar.tetikToplantiBitis = 'yok';
  const once = o.eylemler.length;
  o.ileri(10_000);
  o.izleyici().degisti(false);
  await bekle();
  assert.equal(o.eylemler.length, once);
  // favori seçilmeden izleyici başlamaz
  o.ayarlar.tetikToplantiFavori = '';
  o.d.ayarDegisti('tetikToplantiFavori');
  assert.equal(o.izleyiciCagrilari.at(-1), 'durdur');
});

test('toplantı ışığı: aralık / kaynak değişince izleyici SIFIRLANMAZ (devam eden toplantı yeniden "başladı" sayılıp başlangıç eylemi tekrarlanmaz); açma-kapama ve favori değişimi yeniden kurar', async () => {
  const o = ortam({ tetikToplanti: true, tetikToplantiFavori: 'light.salon', tetikToplantiBitis: 'geriYukle' });
  const say = (ad) => o.izleyiciCagrilari.filter((c) => c === ad).length;
  o.d.baslat();
  assert.equal(say('baslat'), 1);
  o.izleyici().degisti(true); // toplantı başladı: başlangıç eylemi bir kez
  await bekle();
  assert.equal(o.eylemler.length, 1);
  const [baslatOnce, durdurOnce] = [say('baslat'), say('durdur')];

  o.ayarlar.tetikToplantiAralik = 30;
  o.d.ayarDegisti('tetikToplantiAralik');
  o.ayarlar.tetikToplantiKaynak = 'kamera';
  o.d.ayarDegisti('tetikToplantiKaynak');
  assert.deepEqual([say('baslat'), say('durdur')], [baslatOnce, durdurOnce], 'izleyici durdurulup yeniden başlatılmadı');
  assert.equal(say('yenile'), 2, 'yeni aralık zamanlayıcıya uygulanır');
  assert.equal(o.eylemler.length, 1, 'başlangıç eylemi tekrarlanmadı');

  // başka favori seçildi: izleyici yeniden kurulur (eski davranış)
  o.ayarlar.tetikToplantiFavori = 'scene.film';
  o.d.ayarDegisti('tetikToplantiFavori');
  assert.deepEqual([say('durdur'), say('baslat')], [durdurOnce + 1, baslatOnce + 1]);
  // seçenek kapandı: durur
  o.ayarlar.tetikToplanti = false;
  o.d.ayarDegisti('tetikToplanti');
  assert.equal(o.izleyiciCagrilari.at(-1), 'durdur');
  // yeniden açılınca kurulur
  o.ayarlar.tetikToplanti = true;
  o.d.ayarDegisti('tetikToplanti');
  assert.equal(o.izleyiciCagrilari.at(-1), 'baslat');
});

test('durum ve tanılama özeti sır taşımaz; durdur API\'yi kapatır ve bekleyen izni reddeder', async () => {
  const o = ortam({ tetikProtokol: true, tetikYerelApi: true, tetikProtokolIzinleri: ['light.salon', 'light.silinmis'] });
  o.d.baslat();
  await bekle();
  const d = await o.d.durum();
  assert.deepEqual(d.uygunlar, [{ kimlik: 'light.salon', ad: 'Salon' }, { kimlik: 'scene.film', ad: 'Film' }]);
  assert.deepEqual(d.izinler, [{ kimlik: 'light.salon', ad: 'Salon' }, { kimlik: 'light.silinmis', ad: null }]);
  assert.deepEqual(d.kuralUygunlari.map((k) => [k.kimlik, k.acKapa]), [['light.salon', true], ['scene.film', false]]);
  assert.equal(d.protokol.kayitli, true);
  const ozet = o.d.tanilamaOzeti();
  assert.equal(ozet.protokolIzinSayisi, 2);
  assert.doesNotMatch(JSON.stringify(ozet), /light\.|[A-Za-z0-9_-]{43}/);
  const s = o.d.protokoldan('evpaneli://eylem?ad=Film');
  await bekle();
  await o.d.durdur();
  assert.equal((await s).tur, 'reddedildi');
  assert.deepEqual(o.apiCagrilari.at(-1), ['durdur']);
  assert.ok(o.izleyiciCagrilari.includes('durdur'));
});

test('dinle: durum değişince Ayarlar bilgilendirilir; dinleyici hatası yok sayılır', async () => {
  const o = ortam({ tetikProtokol: true });
  let sayi = 0;
  const birak = o.d.dinle(() => sayi++);
  o.d.dinle(() => {
    throw new Error('x');
  });
  o.d.izinKaldir('yok');
  o.ayarlar.tetikProtokolIzinleri = ['scene.film'];
  o.d.izinKaldir('scene.film');
  assert.equal(sayi, 1);
  birak();
  o.d.ayarDegisti('tetikPcOlaylari');
  assert.equal(sayi, 1);
});

test('erişim anahtarı yoksa dış eylem HA\'ya gitmez: "anahtar-yok"; kullanıcı tetiğinde bildirilir, sessiz yerel API\'de bildirilmez', async () => {
  const o = ortam({ tetikJumpList: true, tetikYerelApi: true, tetikPcOlaylari: true, tetikPcKurallari: [{ olay: 'kilit', kimlik: 'light.salon', islem: 'kapat' }] }, { anahtar: false });
  const s = await o.d.komutSatirindan({ ad: 'Salon', kaynak: 'jumplist' });
  assert.deepEqual([s.ok, s.tur], [false, 'anahtar-yok']);
  assert.deepEqual(o.bildirimler.map((b) => b.metin), ['dis.anahtarGerekli']);
  assert.equal((await o.apiBag().isle('/eylem', { ad: 'Film' })).tur, 'anahtar-yok');
  assert.equal(o.bildirimler.length, 1, 'yerel API bildirim kapalıyken sessiz');
  o.d.guc('kilit');
  await bekle();
  assert.equal(o.bildirimler.length, 2, 'PC olayı hatası bildirilir');
  assert.deepEqual(o.eylemler, [], 'eylem katmanı hiç çağrılmadı');
  assert.equal(o.ayarlar.tetikPcUyarisi, undefined, 'başarısız çalışma ilk kullanım sayılmaz');
});

test('DINLENEN_AYARLAR: main.js yalnız var olan tetik alanlarını dinler; sır ya da ana sürecin yazdığı alan yok', () => {
  assert.ok(Object.isFrozen(DINLENEN_AYARLAR));
  for (const ad of Object.keys(AYAR_TETIKLERI)) assert.ok(DINLENEN_AYARLAR.includes(ad), ad);
  for (const ad of ['tetikPcOlaylari', 'tetikPcAcma', 'tetikPcKurallari']) assert.ok(DINLENEN_AYARLAR.includes(ad), ad);
  const alanAdlari = new Set(AYAR_ALANLARI.map((a) => a.ad));
  for (const ad of DINLENEN_AYARLAR) assert.ok(alanAdlari.has(ad), `${ad} ayar-alanlari.js'te tanımlı`);
  // Ana sürecin kendi yazdıkları dinlenmez (ayarYaz -> ayarDegisti döngüsü olmasın)
  assert.equal(DINLENEN_AYARLAR.includes('tetikProtokolIzinleri'), false);
  assert.equal(DINLENEN_AYARLAR.includes('tetikPcUyarisi'), false);
  assert.equal(new Set(DINLENEN_AYARLAR).size, DINLENEN_AYARLAR.length);
});

test('regSorgulayiciOlustur (o-53): yalnız win32; yalnız sabit ConsentStore anahtarları; reg.exe "query" ile salt okunur, kabuk yok', async () => {
  assert.equal(regSorgulayiciOlustur({ execFile: () => {}, platform: 'linux' }), null);
  assert.equal(regSorgulayiciOlustur({ execFile: null, platform: 'win32' }), null);
  const cagrilar = [];
  let yanit = [null, 'HKEY_CURRENT_USER\\...\n    LastUsedTimeStop    REG_QWORD    0x0\n'];
  const execFile = (program, argumanlar, secenek, geriCagir) => {
    cagrilar.push({ program, argumanlar, secenek });
    queueMicrotask(() => geriCagir(...yanit));
  };
  const sorgula = regSorgulayiciOlustur({ execFile, platform: 'win32', sistemKoku: 'D:\\Win' });
  assert.equal(typeof sorgula, 'function');
  for (const anahtar of Object.values(AYGIT_ANAHTARLARI)) {
    assert.match(await sorgula(anahtar), /LastUsedTimeStop/);
  }
  assert.equal(cagrilar.length, 2);
  for (const c of cagrilar) {
    assert.equal(c.program, 'D:\\Win\\System32\\reg.exe');
    assert.equal(c.argumanlar.length, 3);
    assert.equal(c.argumanlar[0], 'query', 'yalnız okuma: add/delete/import yok');
    assert.equal(c.argumanlar[2], '/s');
    assert.match(c.argumanlar[1], /^HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\(microphone|webcam)$/);
    assert.equal(c.secenek.windowsHide, true);
    assert.equal(c.secenek.shell, undefined, 'kabuk kullanılmaz');
    assert.ok(c.secenek.timeout > 0 && c.secenek.maxBuffer > 0);
  }
  // Listede olmayan anahtar sorgulanmaz bile
  for (const kotu of ['HKCU\\Software', 'HKLM\\SAM', `${AYGIT_ANAHTARLARI.mikrofon} /f`, '', null]) {
    await assert.rejects(sorgula(kotu), /izinsiz-anahtar/);
  }
  assert.equal(cagrilar.length, 2);
  // reg.exe hatası: ileti yol ya da çıktı taşımaz
  yanit = [Object.assign(new Error('Command failed: C:\\Windows\\System32\\reg.exe query HKCU\\... gizli'), { code: 1 }), ''];
  await assert.rejects(sorgula(AYGIT_ANAHTARLARI.kamera), (h) => h.message === 'okunamadi');
  // Bozuk sistem kökü varsayılan Windows klasörüne düşer (göreli yol / ağ yolu çalıştırılmaz)
  for (const kok of ['Windows', '\\\\sunucu\\pay', undefined]) {
    const c2 = [];
    const s2 = regSorgulayiciOlustur({ execFile: (p, a, s, g) => (c2.push(p), g(null, '')), platform: 'win32', sistemKoku: kok });
    await s2(AYGIT_ANAHTARLARI.mikrofon);
    assert.match(c2[0], /^[A-Za-z]:\\.*\\System32\\reg\.exe$/, String(kok));
  }
});
