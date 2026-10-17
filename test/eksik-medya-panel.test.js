'use strict';

/**
 * Medya albüm kapağı (panel tarafı) ve birincil medya üst kartı: renderer kapak resmi (yalnız doğrulanmış data adresi, önbellek, yeniden
 * deneme), bilgi modeli 'medya' kartı (Kapı Kuralı, kayıt kaynağı, renderer beyaz listesi), ayar alanı birincilMedya, panel çizimi ve
 * Ayarlar sayfası alanları. Gerçek pencere, Electron, ağ ya da Home Assistant YOK: sahte DOM, sahte zaman, betiklenmiş okuma yanıtı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/ayar-alanlari');
const M = require('../src/lib/bilgi-modeli');
const Bilgi = require('../src/yuzey-bilgi');
const { rendererKaro } = require('../src/lib/yuzey-modeli');
const { TR } = require('../src/lib/ceviri-varsayilan');
const { karo, modelYap, panelAc, akit, sinifli, bulSinif } = require('./eksik-yuzey-sahte');
const bilgiSahte = require('./eksik-bilgi-sahte');
const { HTML, AYAR: AYARLAR_AYAR, CIHAZLAR, acilmisSayfa, duzles, akit: ayarAkit } = require('./ayarlar-sahte');

const RESIM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHzk0lAAAAABJRU5ErkJggg==';
const BASLANGIC = 1_000_000;
const MEDYA_OZ = {
  durum: 'playing',
  baslik: 'Güzel Şarkı',
  sanatci: 'Sanatçı',
  ses: 0.3,
  sessiz: false,
  kaynak: 'HDMI 1',
  kaynaklar: ['HDMI 1', 'HDMI 2'],
  sure: 200,
  konum: 50,
  konumZamani: new Date(BASLANGIC).toISOString(),
  kapak: true,
  kapakAnahtari: '0a1b2c3d',
};
const oynatici = (kimlik = 'media_player.tv', etiket = 'Salon TV', ozellik = {}, ek = {}) =>
  karo(kimlik, etiket, { grup: 'medya', grupEtiketi: 'Medya', varsayilanEylem: false, onayliServisler: ['turn_off'], ozellik: { ...MEDYA_OZ, ...ozellik }, ...ek });
const AYAR = { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20, havaTahmini: 'gunluk' };
const kapakOku = (veri = RESIM) => (istek) => (istek.tur === 'kapak' ? { ok: true, veri } : { ok: true, veri: [] });
const kapakIstekleri = (sayfa) => sayfa.okumalar().filter((i) => i.tur === 'kapak');
const resimler = (sayfa) => sayfa.bul((o) => o.etiket === 'img');
const dugme = (sayfa, aria) => sayfa.bul((o) => o.etiket === 'button' && o.attributes['aria-label'] === aria)[0];
const yenile = async (sayfa, model, ms = 60) => {
  sayfa.durum(model);
  sayfa.zaman.ilerle(ms);
  await akit();
};

// ---- (a) renderer: kapak resmi ---------------------------------------------------------------------------------------------

test('kapak: kapak bayrağı varsa küçük resim çizilir, ana süreçten gelen data adresi yerleşir; resim süs olarak gizlenir ve sürüklenemez', async () => {
  const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: kapakOku() });
  assert.deepEqual(kapakIstekleri(sayfa), [{ tur: 'kapak', kimlik: 'media_player.tv' }]);
  const r = resimler(sayfa);
  assert.equal(r.length, 1);
  assert.ok(sinifli(r[0], 'kart-kapak'));
  assert.equal(r[0].src, RESIM);
  assert.equal(r[0].hidden, false);
  assert.equal(r[0].alt, '');
  assert.equal(r[0].attributes['aria-hidden'], 'true');
  assert.equal(r[0].draggable, false);
  const ust = bulSinif(sayfa, 'kart-medya-ust')[0];
  assert.ok(ust, 'kapak ve çalan parça yan yana');
  assert.match(ust.textContent, /Güzel Şarkı — Sanatçı/);
  assert.ok(ust.bul((o) => o === r[0]).length === 1);
});

test('kapak: resim gelene kadar gizli kalır (adres yok); kapak yoksa ya da bayrak kapalıysa resim de istek de yoktur', async () => {
  let coz;
  const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: (istek) => (istek.tur === 'kapak' ? new Promise((c) => (coz = () => c({ ok: true, veri: RESIM }))) : { ok: true, veri: [] }) });
  assert.equal(resimler(sayfa)[0].hidden, true);
  assert.ok(!resimler(sayfa)[0].src);
  coz();
  await akit();
  assert.equal(resimler(sayfa)[0].hidden, false);
  assert.equal(resimler(sayfa)[0].src, RESIM);

  for (const ozellik of [{ kapak: false, kapakAnahtari: null }, { kapak: undefined, kapakAnahtari: undefined }, { kapak: true, kapakAnahtari: null }, { kapak: 'evet', kapakAnahtari: 'x' }]) {
    const yok = await panelAc({ model: modelYap(oynatici('media_player.tv', 'Salon TV', ozellik)), okuYaniti: kapakOku() });
    assert.equal(resimler(yok).length, 0, JSON.stringify(ozellik));
    assert.equal(kapakIstekleri(yok).length, 0);
    assert.match(yok.oge('icerik').textContent, /Güzel Şarkı — Sanatçı/, 'kart kapaksız yine çizilir');
  }
});

test('kapak: yalnız data:image/(jpeg|png|webp);base64 kabul edilir; http, svg, javascript, aşırı uzun metin ve hatalı yanıt resmi göstermez', async () => {
  const kotuler = [
    'http://dis.example/kapak.png',
    'https://cdn.example/x.jpg',
    '/api/media_player_proxy/media_player.tv?token=1',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PGh0bWw+',
    'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA"onerror="x',
    'data:image/png,AAAA',
    'javascript:alert(1)',
    'data:image/png;base64,' + 'A'.repeat(900_000),
    '',
    5,
    null,
    { veri: RESIM },
    [RESIM],
  ];
  for (const kotu of kotuler) {
    const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: kapakOku(kotu) });
    assert.equal(kapakIstekleri(sayfa).length, 1);
    assert.equal(resimler(sayfa)[0].hidden, true, String(kotu).slice(0, 60));
    assert.ok(!resimler(sayfa)[0].src);
  }
  for (const yanit of [{ ok: false, tur: 'kayitsiz' }, { ok: false }, null, undefined, 'metin', { veri: RESIM }]) {
    const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: (istek) => (istek.tur === 'kapak' ? yanit : { ok: true, veri: [] }) });
    assert.equal(resimler(sayfa)[0].hidden, true, JSON.stringify(yanit));
  }
  const reddedilen = await panelAc({ model: modelYap(oynatici()), okuYaniti: (istek) => (istek.tur === 'kapak' ? Promise.reject(new Error('ipc')) : { ok: true, veri: [] }) });
  assert.equal(resimler(reddedilen)[0].hidden, true, 'IPC hatası kartı bozmaz');
  assert.match(reddedilen.oge('icerik').textContent, /Güzel Şarkı/);
});

test('kapak: önbellek kapak anahtarına bağlıdır; yeniden çizimde aynı kapak yeniden istenmez, parça değişince yeni kapak istenir', async () => {
  const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: kapakOku() });
  assert.equal(kapakIstekleri(sayfa).length, 1);
  await yenile(sayfa, modelYap(oynatici('media_player.tv', 'Salon TV', { ses: 0.5 })));
  assert.equal(kapakIstekleri(sayfa).length, 1, 'aynı anahtar: önbellekten');
  assert.equal(resimler(sayfa)[0].src, RESIM, 'yeniden çizilen kart kapağı hemen gösterir');
  assert.equal(resimler(sayfa)[0].hidden, false);
  await yenile(sayfa, modelYap(oynatici('media_player.tv', 'Salon TV', { kapakAnahtari: 'ffffffff', baslik: 'Başka Şarkı' })));
  assert.equal(kapakIstekleri(sayfa).length, 2, 'anahtar değişti: yeni kapak');
  await yenile(sayfa, modelYap(oynatici('media_player.mutfak', 'Mutfak', { kapakAnahtari: 'ffffffff' })));
  assert.equal(kapakIstekleri(sayfa).length, 3, 'başka oynatıcı: kendi kapağı');
  assert.equal(kapakIstekleri(sayfa)[2].kimlik, 'media_player.mutfak');
});

test('kapak: alınamayan kapak 60 sn içinde yeniden istenmez, sonra yeniden denenir; sonradan gelirse gösterilir', async () => {
  let veri = null;
  const sayfa = await panelAc({ model: modelYap(oynatici()), okuYaniti: (istek) => (istek.tur === 'kapak' ? { ok: true, veri } : { ok: true, veri: [] }) });
  assert.equal(kapakIstekleri(sayfa).length, 1);
  assert.equal(resimler(sayfa)[0].hidden, true);
  await yenile(sayfa, modelYap(oynatici('media_player.tv', 'Salon TV', { ses: 0.4 })), 100);
  assert.equal(kapakIstekleri(sayfa).length, 1, 'başarısız sonuç kısa süre önbellekte (ana süreç hız sınırı korunur)');
  sayfa.zaman.ilerle(61_000);
  veri = RESIM;
  await yenile(sayfa, modelYap(oynatici('media_player.tv', 'Salon TV', { ses: 0.45 })));
  assert.equal(kapakIstekleri(sayfa).length, 2);
  assert.equal(resimler(sayfa)[0].src, RESIM);
  assert.equal(resimler(sayfa)[0].hidden, false);
});

test('kapak: aynı oynatıcı iki yerde (grup + üst kart) tek istek paylaşır; resim yalnız ana süreçten gelir, DOM\'da HA adresi ya da jeton yok', async () => {
  const tv = oynatici();
  const model = {
    ...modelYap(tv),
    bilgi: { ayar: AYAR, kartlar: [{ yuva: 1, tur: 'medya', karo: tv, secilmedi: false }], serit: [], sensorler: [], takvimler: [], listeler: [], hizliListe: '' },
  };
  const sayfa = await panelAc({ model, okuYaniti: kapakOku() });
  assert.equal(kapakIstekleri(sayfa).length, 1, 'aynı karo + aynı anahtar = tek istek');
  assert.equal(resimler(sayfa).length, 2);
  assert.ok(resimler(sayfa).every((r) => r.src === RESIM));
  const tum = JSON.stringify(sayfa.bul(() => true).map((o) => [o.attributes, o.title, o.src]));
  assert.ok(!/media_player_proxy|token|192\.168|http:/.test(tum.replace(RESIM, '')));
});

// ---- (b) bilgi modeli: 'medya' üst kartı -----------------------------------------------------------------------------------

const medyaDurumu = (kimlik, ad = 'Salon TV', ek = {}) => ({
  entity_id: kimlik,
  state: 'playing',
  attributes: { friendly_name: ad, media_title: 'Şarkı', entity_picture: `/api/media_player_proxy/${kimlik}?token=abc`, supported_features: 0, ...ek },
});
const durumlar = {
  'media_player.salon': medyaDurumu('media_player.salon'),
  'media_player.kapi_zili': medyaDurumu('media_player.kapi_zili', 'Kapı zili hoparlörü'),
  'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21', attributes: {} },
};
const durumAl = (k) => durumlar[k];

test('bilgi modeli: ustKart "medya" + birincilMedya oynatıcı bir "medya" kartı üretir; karo media_player karosudur, kapak alanları taşır', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'medya', birincilMedya: 'media_player.salon' }, durumAl });
  assert.equal(m.kartlar.length, 1);
  assert.equal(m.kartlar[0].tur, 'medya');
  assert.equal(m.kartlar[0].yuva, 1);
  assert.equal(m.kartlar[0].secilmedi, false);
  assert.equal(m.kartlar[0].karo.id, 'media_player.salon');
  assert.equal(m.kartlar[0].karo.alan, 'media_player');
  assert.equal(m.kartlar[0].karo.ozellik.kapak, true);
  assert.match(m.kartlar[0].karo.ozellik.kapakAnahtari, /^[0-9a-f]{8}$/);
  assert.ok(Array.isArray(m.kartlar[0].karo.onayliServisler));
});

test('bilgi modeli: oynatıcı seçilmemişse kart "secilmedi"; sensör / ışık / kilit kimliği oynatıcı sayılmaz; kapı sözcüklü oynatıcı görünmez (Kapı Kuralı)', () => {
  const bos = M.bilgiModeliOlustur({ ayarlar: { ustKart2: 'medya', birincilMedya: '' }, durumAl });
  assert.deepEqual(bos.kartlar.map((k) => [k.yuva, k.tur, k.secilmedi, k.karo]), [[2, 'medya', true, null]]);
  for (const yanlis of ['sensor.sicaklik', 'light.salon', 'lock.on_kapi', 'cover.garaj', 'camera.bahce']) {
    const m = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'medya', birincilMedya: yanlis }, durumAl });
    assert.equal(m.kartlar[0].karo, null, yanlis);
    assert.equal(m.kartlar[0].secilmedi, false);
  }
  const kapi = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'medya', birincilMedya: 'media_player.kapi_zili' }, durumAl });
  assert.equal(kapi.kartlar[0].karo, null, 'kapı zili adlı oynatıcı karoya dönüşmez');
});

test('kayıt kaynağı: oynatıcı yalnız "medya" yuvası seçiliyken ve yalnız media_player ise kayıtlı sayılır; başka alan hiçbir yoldan girmez', () => {
  const kimlikler = (ayarlar) => [...M.bilgiKimlikleri(ayarlar)].sort();
  assert.deepEqual(kimlikler({ ustKart1: 'medya', birincilMedya: 'media_player.salon' }), ['media_player.salon']);
  assert.deepEqual(kimlikler({ ustKart2: 'medya', birincilMedya: 'media_player.salon' }), ['media_player.salon']);
  assert.deepEqual(kimlikler({ ustKart1: 'saat', birincilMedya: 'media_player.salon' }), [], 'yuva seçili değilse oynatıcı okunmaz / kaydedilmez');
  assert.deepEqual(kimlikler({ ustKart1: 'medya', birincilMedya: '' }), []);
  for (const yanlis of ['light.salon', 'switch.priz', 'script.s', 'lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'camera.bahce', 'valve.su', 'automation.a', 'sensor.sicaklik', 'media_player.', 'bozuk', 5, null]) {
    assert.deepEqual(kimlikler({ ustKart1: 'medya', birincilMedya: yanlis }), [], String(yanlis));
  }
  const kaynak = M.bilgiKaydi(() => ({ ustKart1: 'medya', birincilMedya: 'media_player.salon' }));
  assert.deepEqual(kaynak('media_player.salon'), { entity_id: 'media_player.salon', ad: 'salon' });
  assert.equal(kaynak('media_player.baska'), null);
  assert.equal(kaynak('light.salon'), null);
  assert.equal(kaynak(5), null);
});

test('renderer beyaz listesi: "medya" türü korunur, bilinmeyen tür "saat" olur; karo rendererKaro\'dan geçer (HA adı ve ham öznitelik gitmez)', () => {
  const m = M.bilgiModeliOlustur({ ayarlar: { ustKart1: 'medya', birincilMedya: 'media_player.salon', ustKart2: 'saat' }, durumAl });
  const r = M.rendererBilgi(m);
  assert.deepEqual(r.kartlar.map((k) => k.tur), ['medya', 'saat']);
  assert.deepEqual(r.kartlar[0].karo, rendererKaro(m.kartlar[0].karo));
  assert.equal(r.kartlar[0].karo.ad, undefined);
  assert.ok(!JSON.stringify(r).includes('abc'), 'jeton renderer modelinde yok');
  assert.equal(M.rendererBilgi({ kartlar: [{ yuva: 1, tur: 'kamera', karo: null }] }).kartlar[0].tur, 'saat');
});

test('ayar alanları: ustKart "medya" kabul edilir; birincilMedya yalnız media_player kimliği (ya da boş), kapı / kilit / başka alan reddedilir', () => {
  const kart = A.AYAR_ALANLARI.find((a) => a.ad === 'ustKart1');
  assert.equal(kart.duzelt('medya'), 'medya');
  assert.equal(kart.duzelt('light.salon'), undefined, 'eylem alanı üst karta giremez');
  const alan = A.AYAR_ALANLARI.find((a) => a.ad === 'birincilMedya');
  assert.ok(alan);
  assert.equal(alan.varsayilan, '');
  assert.equal(alan.duzelt(''), '');
  assert.equal(alan.duzelt('media_player.salon'), 'media_player.salon');
  for (const kotu of ['light.salon', 'lock.on_kapi', 'cover.garaj', 'camera.bahce', 'sensor.sicaklik', 'media_player.kapi_zili', 'media_player.garaj_kapisi', 'MEDIA_PLAYER.A', 'media_player.', 5, null, [], {}]) {
    assert.equal(alan.duzelt(kotu), undefined, String(kotu));
  }
  assert.equal(A.alanlariDuzelt({}, {}).birincilMedya, '');
  assert.equal(A.alanlariDuzelt({ birincilMedya: 'lock.on_kapi' }, {}).birincilMedya, '', 'bozuk dosya değeri varsayılana düşer');
  const { yeni, uyarilar } = A.ekGirdiDogrula({ birincilMedya: 'media_player.salon', ustKart1: 'medya' }, TR);
  assert.equal(yeni.birincilMedya, 'media_player.salon');
  assert.equal(yeni.ustKart1, 'medya');
  assert.deepEqual(uyarilar, []);
  assert.deepEqual(A.ekGirdiDogrula({ birincilMedya: 'lock.on_kapi' }, TR).uyarilar.map((u) => u.alan), ['birincilMedya']);
  assert.ok(A.aktarilanAlanlar().includes('birincilMedya'));
});

// ---- (b) panel: medya üst kartı --------------------------------------------------------------------------------------------

function ustKartModeli(kartlar, ek = {}) {
  return { ...modelYap(...(ek.karolar ?? [])), bilgi: { ayar: AYAR, kartlar, serit: [], sensorler: [], takvimler: [], listeler: [], hizliListe: '' } };
}

test('medya üst kartı: oynatıcının kendi kartı (kapak, parça, düğmeler) iki sütunu kaplayan sarmalayıcıda çizilir; düğmeler servis gönderir', async () => {
  const tv = oynatici();
  const sayfa = await panelAc({ model: ustKartModeli([{ yuva: 1, tur: 'medya', karo: tv, secilmedi: false }, { yuva: 2, tur: 'saat', karo: null, secilmedi: false }]), okuYaniti: kapakOku() });
  const sarmalayici = bulSinif(sayfa, 'bilgi-medya');
  assert.equal(sarmalayici.length, 1);
  assert.ok(sinifli(sarmalayici[0], 'bilgi-kart'));
  assert.equal(sarmalayici[0].bul((o) => sinifli(o, 'kart-medya')).length, 1, 'cihaz medya kartı içeride');
  assert.equal(sarmalayici[0].bul((o) => o.etiket === 'img' && o.src === RESIM).length, 1, 'albüm kapağı üst kartta da var');
  assert.match(sarmalayici[0].textContent, /Güzel Şarkı — Sanatçı/);
  assert.match(sayfa.oge('icerik').textContent, /\d\d:\d\d/, 'yandaki saat kartı korunur');
  for (const [aria, servis] of [['Salon TV: oynat / duraklat', 'media_play_pause'], ['Salon TV: sonraki parça', 'media_next_track']]) {
    dugme(sayfa, aria).gonder('click', { detail: 1 });
    sayfa.zaman.ilerle(500);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'media_player.tv', servis }, aria);
  }
});

test('medya üst kartı: oynatıcı seçilmediyse / alınamıyorsa / ulaşılamıyorsa kısa not; oynatıcı olmayan karo çizilmez', async () => {
  const notu = async (kart) => {
    const sayfa = await panelAc({ model: ustKartModeli([kart]), okuYaniti: kapakOku() });
    return { sayfa, metin: bulSinif(sayfa, 'bilgi-medya')[0]?.textContent };
  };
  assert.equal((await notu({ yuva: 1, tur: 'medya', karo: null, secilmedi: true })).metin, 'Medya oynatıcı seçilmedi');
  assert.equal((await notu({ yuva: 1, tur: 'medya', karo: null, secilmedi: false })).metin, 'Medya oynatıcı kullanılamıyor');
  const ulasilamiyor = await notu({ yuva: 1, tur: 'medya', karo: oynatici('media_player.tv', 'Salon TV', {}, { ulasilamiyor: true }), secilmedi: false });
  assert.equal(ulasilamiyor.metin, 'Medya oynatıcı kullanılamıyor');
  assert.equal(kapakIstekleri(ulasilamiyor.sayfa).length, 0, 'ulaşılamayan oynatıcı için kapak istenmez');
  const sensor = await notu({ yuva: 1, tur: 'medya', karo: karo('sensor.sicaklik', 'Sıcaklık', { alan: 'sensor', ozellik: { deger: '21', sayi: 21, birim: '°C', sinif: null, hassasiyet: null, enAz: null, enCok: null } }), secilmedi: false });
  assert.equal(sensor.metin, 'Medya oynatıcı kullanılamıyor', 'sensör karosu medya yuvasına yerleşemez');
  assert.equal(sensor.sayfa.bul((o) => sinifli(o, 'kart-medya')).length, 0);
  const isik = await notu({ yuva: 1, tur: 'medya', karo: karo('light.salon', 'Salon', { alan: 'light' }), secilmedi: false });
  assert.equal(isik.metin, 'Medya oynatıcı kullanılamıyor', 'ışık karosu da yerleşemez (üst kart eylem yüzeyi olmaz)');
});

test('medya üst kartı: bilgi modülü tek başına (kart hook\'u yok) güvenli not gösterir; medya karosu yalnız sayfanın doğrulayıcısından geçerse kabul edilir', () => {
  const karoHam = { id: 'media_player.tv', etiket: 'Salon TV', alan: 'media_player', kullanilabilir: true, ulasilamiyor: false, ozellik: { durum: 'playing' } };
  const ham = { ayar: bilgiSahte.AYAR, kartlar: [{ yuva: 1, tur: 'medya', karo: karoHam, secilmedi: false }] };
  // doğrulayıcı verilmezse karo kabul edilmez (ham veri kartlara asla sızmaz)
  const kor = Bilgi.modelDuzelt(ham);
  assert.equal(kor.kartlar[0].tur, 'medya');
  assert.equal(kor.kartlar[0].karo, null);
  // doğrulayıcı verilirse sonucu kullanılır; oynatıcı olmayan sonuç düşer
  const gecen = Bilgi.modelDuzelt(ham, (k) => ({ ...k, dogrulandi: true }));
  assert.equal(gecen.kartlar[0].karo.dogrulandi, true);
  assert.equal(Bilgi.modelDuzelt({ ...ham, kartlar: [{ yuva: 1, tur: 'medya', karo: { ...karoHam, alan: 'sensor' }, secilmedi: false }] }, (k) => k).kartlar[0].karo, null);
  assert.equal(Bilgi.modelDuzelt(ham, () => null).kartlar[0].karo, null, 'doğrulayıcı reddederse karo yok');

  const hookSuz = bilgiSahte.ortamKur();
  hookSuz.modul.ayarla(ham);
  assert.equal(bilgiSahte.metin(bilgiSahte.bulSinif(hookSuz.modul.ustParcalar(), 'bilgi-medya')), 'Medya oynatıcı kullanılamıyor');
  const hookluyla = bilgiSahte.ortamKur({
    ek: {
      medyaKaroDuzelt: (k) => ({ ...k }),
      medyaKarti: (k) => hookSuz.ctx.olustur('div', 'kart kart-medya', `kart:${k.id}`),
    },
  });
  hookluyla.modul.ayarla(ham);
  const parca = bilgiSahte.bulSinif(hookluyla.modul.ustParcalar(), 'bilgi-medya');
  assert.equal(parca.length, 1);
  assert.equal(bilgiSahte.metin(parca), 'kart:media_player.tv');
});

// ---- Ayarlar sayfası ------------------------------------------------------------------------------------------------------

const MEDYA_CIHAZLARI = [
  { entity_id: 'media_player.salon_tv', ad: 'Salon TV', alan: 'media_player', alanEtiketi: 'Medya', durum: 'çalıyor', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
  { entity_id: 'media_player.mutfak', ad: 'Mutfak', alan: 'media_player', alanEtiketi: 'Medya', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
  { entity_id: 'media_player.gizli', ad: 'Gizli', alan: 'media_player', alanEtiketi: 'Medya', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: true },
  { entity_id: 'sensor.salon_sicaklik', ad: 'Salon Sıcaklık', alan: 'sensor', alanEtiketi: 'Sensörler', durum: '21', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, gizli: false },
  { entity_id: 'lock.on_kapi', ad: 'Ön Kapı', alan: 'lock', alanEtiketi: 'Kilit', durum: 'kilitli', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
];
const AYAR_CIHAZLARI = { ...CIHAZLAR, cihazlar: [...CIHAZLAR.cihazlar, ...MEDYA_CIHAZLARI] };
const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await ayarAkit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const degerler = (sayfa, kimlik) => sayfa.oge(kimlik).children.map((o) => o.value);
const degistir = (sayfa, kimlik, deger) => {
  sayfa.oge(kimlik).value = deger;
  sayfa.oge(kimlik).dispatchEvent({ type: 'change' });
};

test('Ayarlar HTML: birincilMedya seçimi ve medyaKapagi onay kutusu etiketli, ipucuna bağlı; yeni betik ya da innerHTML yok', () => {
  assert.match(HTML, /<label for="birincilMedya" data-i18n="ayar\.bilgi\.medya\.etiket">/);
  assert.match(HTML, /<select id="birincilMedya"[^>]*aria-describedby="birincilMedyaIpucu"/);
  assert.match(HTML, /id="birincilMedyaIpucu"/);
  assert.match(HTML, /<input type="checkbox" id="medyaKapagi"[^>]*aria-describedby="medyaKapagiIpucu"/);
  assert.match(HTML, /<span data-i18n="ayar\.bilgi\.kapak\.etiket">/);
  assert.match(HTML, /id="medyaKapagiIpucu"/);
});

test('Ayarlar: varsayılan kapak açık, oynatıcı boş; kayıt yükü her ikisini taşır; kirli sayılmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYARLAR_AYAR, cihazlar: AYAR_CIHAZLARI });
  assert.equal(sayfa.oge('medyaKapagi').checked, true);
  assert.equal(sayfa.oge('birincilMedya').value, '');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.medyaKapagi, true);
  assert.equal(yuk.birincilMedya, '');
});

test('Ayarlar: oynatıcı seçeneği yalnız görünür media_player varlıklarından kurulur; üst kart seçeneklerine "Medya oynatıcı" eklenir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYARLAR_AYAR, cihazlar: AYAR_CIHAZLARI });
  assert.deepEqual(degerler(sayfa, 'birincilMedya'), ['', 'media_player.salon_tv', 'media_player.mutfak'], 'gizli aday, sensör ve kilit yok');
  assert.ok(degerler(sayfa, 'ustKart1').includes('medya'));
  assert.ok(degerler(sayfa, 'ustKart2').includes('medya'));
  assert.deepEqual(degerler(sayfa, 'ustKart1').slice(0, 4), ['yok', 'saat', 'hava', 'medya']);
  const ad = sayfa.oge('ustKart1').children.find((o) => o.value === 'medya').textContent;
  assert.equal(ad, 'Medya oynatıcı');
});

test('Ayarlar: seçim değişince kirli olur, geri alınca temizlenir; kayıt yükü yeni değerleri gönderir; kapak kapatılabilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYARLAR_AYAR, ustKart1: 'medya', birincilMedya: 'media_player.mutfak', medyaKapagi: true }, cihazlar: AYAR_CIHAZLARI });
  assert.equal(sayfa.oge('ustKart1').value, 'medya');
  assert.equal(sayfa.oge('birincilMedya').value, 'media_player.mutfak');
  assert.equal(kirliMi(sayfa), false);
  degistir(sayfa, 'birincilMedya', 'media_player.salon_tv');
  assert.equal(kirliMi(sayfa), true);
  degistir(sayfa, 'birincilMedya', 'media_player.mutfak');
  assert.equal(kirliMi(sayfa), false);
  sayfa.oge('medyaKapagi').checked = false;
  sayfa.oge('medyaKapagi').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('medyaKapagi').checked = true;
  sayfa.oge('medyaKapagi').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), false);
  degistir(sayfa, 'birincilMedya', 'media_player.salon_tv');
  sayfa.oge('medyaKapagi').checked = false;
  sayfa.oge('medyaKapagi').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.birincilMedya, 'media_player.salon_tv');
  assert.equal(yuk.medyaKapagi, false);
  assert.equal(yuk.ustKart1, 'medya');
  assert.equal(kirliMi(sayfa), false);
});

test('Ayarlar: cihaz listesi alınamasa da kayıtlı oynatıcı seçeneği korunur ve kaydedilir; bozuk sunucu değerleri varsayılana düşer', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYARLAR_AYAR, ustKart2: 'medya', birincilMedya: 'media_player.salon_tv' }, cihazlar: { ok: false, hata: 'bağlanılamadı' } });
  assert.equal(sayfa.oge('birincilMedya').value, 'media_player.salon_tv');
  assert.deepEqual(degerler(sayfa, 'birincilMedya'), ['', 'media_player.salon_tv'], 'kayıtlı kimlik seçenek olarak eklenir');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).birincilMedya, 'media_player.salon_tv');

  const bozuk = await acilmisSayfa({ ayar: { ...AYARLAR_AYAR, medyaKapagi: 'evet', birincilMedya: 7 }, cihazlar: AYAR_CIHAZLARI });
  assert.equal(bozuk.oge('medyaKapagi').checked, true, 'mantıksal olmayan değer varsayılan (açık)');
  assert.equal(bozuk.oge('birincilMedya').value, '');
  const kapali = await acilmisSayfa({ ayar: { ...AYARLAR_AYAR, medyaKapagi: false }, cihazlar: AYAR_CIHAZLARI });
  assert.equal(kapali.oge('medyaKapagi').checked, false);
});
