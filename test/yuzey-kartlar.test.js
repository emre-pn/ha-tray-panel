'use strict';

/**
 * 1.4.0 hızlı panel cihaz kartları (src/yuzey-kartlar.js): klima (o-01), ışık rengi (o-02), medya (o-03), vantilatör / nem alıcı /
 * süpürge (o-05), seçici / sayı / zamanlayıcı (o-06). Sahte DOM + sahte saat (test/yuzey-kartlar-sahte.js).
 * Kural: onay isteyen servis (karonun `onayliServisler` listesi) YALNIZ ~0,8 sn basılı tutmayla gider ve istekte `basili: true`
 * vardır; renderer onayı kendi başına veremez (asıl denetim ana süreçtedir: test/eylem-hatti.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, modelYap, panelAc, dugmeler, dugmeAra, kartlar, basiliTut } = require('./yuzey-kartlar-sahte');

const IKLIM_OZ = { mod: 'cool', modlar: ['off', 'cool', 'heat', 'auto'], hedefSicaklik: 24, enAz: 16, enCok: 30, adim: 0.5, mevcutSicaklik: 26.5, hvacEylemi: 'cooling', mevcutNem: 55 };
const KLIMA = karo('climate.salon', 'Salon klima', { grup: 'iklim', grupEtiketi: 'İklim', varsayilanEylem: false, onayliServisler: ['set_hvac_mode'], ozellik: IKLIM_OZ });

/** Var olan karodan başka kimlik / ad / ek alanlarla türetilmiş karo. */
const varyant = (temel, id, etiket, ek = {}) => ({ ...temel, id, etiket, alan: id.split('.')[0], ...ek });
const metin = (sayfa) => sayfa.oge('icerik').textContent;
const secili = (oge) => oge.sinifVar('vurgu');

// --- klima ---------------------------------------------------------------------------------------------------------

test('klima: kart durum, hedef, şu anki sıcaklık ve nemi gösterir; tam genişlik kart olarak çizilir (düz karo değil)', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  assert.equal(kartlar(sayfa).length, 1);
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-iklim'));
  assert.match(metin(sayfa), /Salon klima/);
  assert.match(metin(sayfa), /Soğut · soğutuyor/);
  assert.match(metin(sayfa), /24°/);
  assert.match(metin(sayfa), /Şimdi 26,5° · Nem %55/);
  assert.equal(sayfa.bul((o) => o.sinifVar('karo')).length, 0, 'düz karo yok');
});

test('klima: + ve − düğmeleri 400 ms içinde tek gönderimde birleşir (son değer), cihazın aralığına kırpılır; ara değer göstergede hemen görünür', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  const artir = dugmeAra(sayfa, 'Salon klima hedef sıcaklığını artır');
  const azalt = dugmeAra(sayfa, 'Salon klima hedef sıcaklığını azalt');
  artir.gonder('click');
  assert.match(metin(sayfa), /25°/);
  artir.gonder('click');
  assert.match(metin(sayfa), /26°/);
  sayfa.zaman.ilerle(399);
  assert.deepEqual(sayfa.calistirmalar(), [], '400 ms dolmadan gönderim yok');
  sayfa.zaman.ilerle(2);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'climate.salon', servis: 'set_temperature', veri: { temperature: 26 }, sonDeger: true }]);

  const alt = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.alt', 'Alt', { ozellik: { ...IKLIM_OZ, hedefSicaklik: 16 } })) });
  dugmeAra(alt, 'Alt hedef sıcaklığını azalt').gonder('click');
  alt.zaman.ilerle(500);
  assert.deepEqual(alt.calistirmalar(), [], 'zaten alt sınırda: değişiklik yok, istek yok');
  const ust = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.ust', 'Üst', { ozellik: { ...IKLIM_OZ, hedefSicaklik: 29.5 } })) });
  dugmeAra(ust, 'Üst hedef sıcaklığını artır').gonder('click');
  ust.zaman.ilerle(500);
  assert.deepEqual(ust.calistirmalar().map((y) => y.veri), [{ temperature: 30 }], 'üst sınıra kırpılır');
  assert.equal(azalt.disabled, false);
});

test('klima: adım 1 olan cihazda 22,5 + 1 adım ızgarasına oturur (24); 0,5 adımlı cihazda 1 derecelik düğme artışı ızgarada kalır', async () => {
  const sayfa = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.t', 'Tado', { ozellik: { ...IKLIM_OZ, adim: 1, hedefSicaklik: 22.5 } })) });
  dugmeAra(sayfa, 'Tado hedef sıcaklığını artır').gonder('click');
  sayfa.zaman.ilerle(500);
  assert.deepEqual(sayfa.calistirmalar().map((y) => y.veri), [{ temperature: 24 }]);
  const yarim = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.y', 'Yarım', { ozellik: { ...IKLIM_OZ, adim: 0.5, hedefSicaklik: 22.5 } })) });
  dugmeAra(yarim, 'Yarım hedef sıcaklığını artır').gonder('click');
  yarim.zaman.ilerle(500);
  assert.deepEqual(yarim.calistirmalar().map((y) => y.veri), [{ temperature: 23.5 }]);
});

test('klima: güç düğmesi açıkken kapatır, kapalıyken açar (tek tıkla, onaysız); kapalı klimada durum "Kapalı"', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  const guc = dugmeAra(sayfa, 'Salon klima aç / kapat');
  assert.equal(guc.attributes['aria-pressed'], 'true');
  guc.gonder('click');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'climate.salon', servis: 'turn_off' }]);

  const kapali = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.k', 'Kapalı klima', { ozellik: { ...IKLIM_OZ, mod: 'off', hvacEylemi: 'off' } })) });
  const kguc = dugmeAra(kapali, 'Kapalı klima aç / kapat');
  assert.equal(kguc.attributes['aria-pressed'], 'false');
  kguc.gonder('click');
  assert.deepEqual(kapali.calistirmalar(), [{ kimlik: 'climate.k', servis: 'turn_on' }]);
});

test('klima: mod düğmeleri cihazın modlarından gelir, etkin mod vurgulanır; mod değişimi (onaylı servis) YALNIZ basılı tutmayla gider', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  const mod = dugmeler(sayfa, (o) => o.sinifVar('kart-dugme') && /moduna geç/.test(o.attributes['aria-label'] ?? ''));
  assert.deepEqual(mod.map((d) => d.textContent), ['Kapalı', 'Soğut', 'Isıt', 'Otomatik']);
  assert.deepEqual(mod.filter(secili).map((d) => d.textContent), ['Soğut']);
  assert.ok(mod.every((d) => d.sinifVar('onayli')), 'kesikli kenar: basılı tutulur');
  const isit = dugmeAra(sayfa, 'Salon klima: Isıt moduna geç');

  isit.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), [], 'düz tıklama hiçbir şey göndermez');

  isit.gonder('pointerdown', { button: 0 });
  assert.deepEqual(sayfa.basiliBaslamalar(), ['climate.salon'], 'ana sürece yalnız "başladı" gider');
  sayfa.zaman.ilerle(799);
  assert.deepEqual(sayfa.calistirmalar(), []);
  sayfa.zaman.ilerle(2);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'climate.salon', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, basili: true }]);
  assert.match(metin(sayfa), /Kesikli kenarlı düğmeler/, 'kartta onaylı düğme varsa tek satır hatırlatma yazılır');
});

test('klima: süre dolmadan bırakmak mod değişimini iptal eder; kullanıcı onayı kapattıysa (onayliServisler boş) tek tıklamayla gider', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  const otomatik = dugmeAra(sayfa, 'Salon klima: Otomatik moduna geç');
  for (const bitis of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) {
    otomatik.gonder('pointerdown', { button: 0 });
    sayfa.zaman.ilerle(300);
    otomatik.gonder(bitis);
    sayfa.zaman.ilerle(2000);
  }
  assert.deepEqual(sayfa.calistirmalar(), []);

  const serbest = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.s', 'Serbest', { onayliServisler: [] })) });
  const isit = dugmeAra(serbest, 'Serbest: Isıt moduna geç');
  assert.equal(isit.sinifVar('onayli'), false);
  isit.gonder('click', { detail: 1 });
  await serbest.zaman.ilerle(1);
  assert.deepEqual(serbest.calistirmalar(), [{ kimlik: 'climate.s', servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' } }]);
  assert.doesNotMatch(metin(serbest), /Kesikli kenarlı/);
});

test('klima: ulaşılamayan klima "ulaşılamıyor" der ve düğmeleri kapalıdır; hedef yoksa (ısıt/soğut aralığı) aralık gösterilir, ± kapalıdır', async () => {
  const sayfa = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.u', 'Uzak', { kullanilabilir: false, ulasilamiyor: true })) });
  assert.match(metin(sayfa), /ulaşılamıyor/);
  assert.ok(dugmeAra(sayfa, 'Uzak aç / kapat').disabled);
  assert.ok(dugmeAra(sayfa, 'Uzak hedef sıcaklığını artır').disabled);

  const aralik = await panelAc({ model: modelYap(varyant(KLIMA, 'climate.a', 'Aralık', { ozellik: { ...IKLIM_OZ, hedefSicaklik: null, hedefAlt: 20, hedefUst: 24 } })) });
  assert.match(metin(aralik), /20–24°/);
  assert.ok(dugmeAra(aralik, 'Aralık hedef sıcaklığını artır').disabled, 'tek hedef yoksa set_temperature gönderilemez');
});

test('klima: modlar tanıdık değilse (cihaz özel mod bildirirse) düğme çizilmez; metinler yalnız textContent (zararlı ad etiket olmaz)', async () => {
  const zararli = varyant(KLIMA, 'climate.z', '<img src=x onerror=alert(1)>', { ozellik: { ...IKLIM_OZ, modlar: [], mod: 'bilinmeyen' } });
  const sayfa = await panelAc({ model: modelYap(zararli) });
  assert.equal(sayfa.bul((o) => o.etiket === 'img').length, 0);
  assert.match(metin(sayfa), /<img src=x onerror=alert\(1\)>/);
  assert.equal(dugmeler(sayfa, (o) => /moduna geç/.test(o.attributes['aria-label'] ?? '')).length, 0);
});

// --- ışık rengi ----------------------------------------------------------------------------------------------------

const RENKLI = karo('light.masa', 'Masa', {
  grup: 'isik',
  grupEtiketi: 'Işık',
  durum: 'acik',
  yuzde: 60,
  parlaklikKontrol: true,
  ozellik: { renkModlari: ['color_temp', 'hs'], enAzKelvin: 2200, enCokKelvin: 6500, renkSicakligi: 2800, rgb: null },
});

test('ışık rengi: beyaz tonu ve renk paleti parlaklık kontrollü ışıkta çıkar; düğmeler cihazın aralığına kırpılmış kelvin ve palet rgb değeri gönderir', async () => {
  const sayfa = await panelAc({ model: modelYap(RENKLI) });
  const tonlar = dugmeler(sayfa, (o) => /beyaz/i.test(o.attributes['aria-label'] ?? ''));
  assert.deepEqual(tonlar.map((d) => d.textContent), ['Sıcak beyaz', 'Doğal beyaz', 'Soğuk beyaz']);
  assert.deepEqual(tonlar.filter(secili).map((d) => d.textContent), ['Sıcak beyaz'], '2800 K sıcak beyaza en yakın');
  tonlar[0].gonder('click', { detail: 1 });
  sayfa.zaman.ilerle(500);
  tonlar[2].gonder('click', { detail: 1 });
  sayfa.zaman.ilerle(500);
  assert.deepEqual(sayfa.calistirmalar(), [
    { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 2700 } },
    { kimlik: 'light.masa', servis: 'turn_on', veri: { color_temp_kelvin: 6500 } },
  ]);
  const renkler = dugmeler(sayfa, (o) => o.sinifVar('renk'));
  assert.equal(renkler.length, 8);
  dugmeAra(sayfa, 'Masa: Mavi').gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'light.masa', servis: 'turn_on', veri: { rgb_color: [30, 90, 255] } });
});

test('ışık rengi: cihazın üst kelvin sınırı düşükse "Soğuk beyaz" o sınıra kırpılır', async () => {
  const dar = varyant(RENKLI, 'light.dar', 'Dar', { ozellik: { renkModlari: ['color_temp'], enAzKelvin: 2000, enCokKelvin: 5000, renkSicakligi: null, rgb: null } });
  const sayfa = await panelAc({ model: modelYap(dar) });
  dugmeAra(sayfa, 'Dar: Soğuk beyaz (5000 K)').gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.dar', servis: 'turn_on', veri: { color_temp_kelvin: 5000 } }]);
  assert.equal(dugmeler(sayfa, (o) => o.sinifVar('renk')).length, 0, 'yalnız beyaz tonu destekleyen ışıkta renk paleti yok');
});

test('ışık rengi: rengi desteklemeyen ışıkta bölüm tamamen gizlenir; yalnız renk (tonsuz) destekleyen ışıkta yalnız palet çıkar', async () => {
  const sade = varyant(RENKLI, 'light.sade', 'Sade', { ozellik: { renkModlari: ['brightness'], enAzKelvin: null, enCokKelvin: null, renkSicakligi: null, rgb: null } });
  const sayfa = await panelAc({ model: modelYap(sade) });
  assert.equal(sayfa.bul((o) => o.sinifVar('kart-renkler')).length, 0);
  assert.equal(dugmeler(sayfa, (o) => /beyaz|Mavi/.test(o.attributes['aria-label'] ?? '')).length, 0);
  assert.ok(sayfa.bul((o) => o.type === 'range').length >= 1, 'parlaklık kaydırıcısı eskisi gibi var');

  const yalnizRenk = varyant(RENKLI, 'light.rgb', 'Rgb', { ozellik: { renkModlari: ['rgb'], enAzKelvin: null, enCokKelvin: null, renkSicakligi: null, rgb: [1, 2, 3] } });
  const r = await panelAc({ model: modelYap(yalnizRenk) });
  assert.equal(dugmeler(r, (o) => /beyaz/i.test(o.attributes['aria-label'] ?? '')).length, 0);
  assert.equal(dugmeler(r, (o) => o.sinifVar('renk')).length, 8);
});

test('ışık rengi: renk düğmesi metin taşımaz (dolgu CSS sınıfından), erişilebilir adı vardır; ışık yoksa ya da parlaklık kontrolü kapalıysa düz karo kalır', async () => {
  const sayfa = await panelAc({ model: modelYap(RENKLI) });
  const kirmizi = dugmeAra(sayfa, 'Masa: Kırmızı');
  assert.equal(kirmizi.textContent, '');
  assert.ok(kirmizi.sinifVar('renk-kirmizi'));
  assert.equal(JSON.stringify(kirmizi.style), '{}', 'satır içi stil yok');
  const duz = await panelAc({ model: modelYap(varyant(RENKLI, 'light.duz', 'Düz', { parlaklikKontrol: false })) });
  assert.equal(duz.bul((o) => o.sinifVar('kart-renkler')).length, 0);
  assert.equal(duz.bul((o) => o.sinifVar('karo')).length, 1);
});

// --- medya ---------------------------------------------------------------------------------------------------------

const BASLANGIC = 1_000_000;
const MEDYA_OZ = {
  durum: 'playing',
  baslik: 'Güzel Şarkı',
  sanatci: 'Sanatçı',
  ses: 0.3,
  sessiz: false,
  kaynak: 'HDMI 1',
  kaynaklar: ['HDMI 1', 'HDMI 2', 'Netflix'],
  sure: 200,
  konum: 50,
  konumZamani: new Date(BASLANGIC).toISOString(),
};
const TV = karo('media_player.tv', 'Salon TV', { grup: 'medya', grupEtiketi: 'Medya', varsayilanEylem: false, onayliServisler: ['turn_off'], ozellik: MEDYA_OZ });

test('medya: başlık, sanatçı ve durum görünür; oynat/duraklat, önceki, sonraki tek tıkla gider', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-medya'));
  assert.match(metin(sayfa), /Güzel Şarkı — Sanatçı/);
  assert.match(metin(sayfa), /Çalıyor/);
  for (const [aria, servis] of [
    ['Salon TV: oynat / duraklat', 'media_play_pause'],
    ['Salon TV: sonraki parça', 'media_next_track'],
    ['Salon TV: önceki parça', 'media_previous_track'],
  ]) {
    dugmeAra(sayfa, aria).gonder('click', { detail: 1 });
    sayfa.zaman.ilerle(500);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'media_player.tv', servis }, aria);
  }
  assert.ok(secili(dugmeAra(sayfa, 'Salon TV: oynat / duraklat')), 'çalarken oynat düğmesi vurgulu');
});

test('medya: ses kaydırıcısı sürüklenirken kısılır (araDeger), bırakınca son değer 0-1 aralığında gider; sessize al düğmesi tersini gönderir', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  const ses = sayfa.bul((o) => o.type === 'range')[0];
  assert.equal(ses.value, '30');
  assert.equal(ses.attributes['aria-label'], 'Salon TV ses düzeyi');
  ses.value = 35;
  ses.gonder('input');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.35 }, araDeger: true }]);
  for (const v of [40, 45]) {
    ses.value = v;
    ses.gonder('input');
  }
  assert.equal(sayfa.calistirmalar().length, 1, '200 ms içindeki ara değerler birikir');
  ses.value = 45;
  ses.gonder('change');
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.45 }, sonDeger: true });

  dugmeAra(sayfa, 'Salon TV: sessize al').gonder('click', { detail: 1 });
  sayfa.zaman.ilerle(500);
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'media_player.tv', servis: 'volume_mute', veri: { is_volume_muted: true } });
});

test('medya: sürükleme sürerken gelen model çizimi erteler (kaydırıcı elinden alınmaz), bırakınca çizilir', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  const ses = sayfa.bul((o) => o.type === 'range')[0];
  ses.value = 60;
  ses.gonder('input');
  sayfa.durum(modelYap(varyant(TV, 'media_player.tv', 'Salon TV', { ozellik: { ...MEDYA_OZ, ses: 0.5 } })));
  assert.equal(sayfa.bul((o) => o.type === 'range')[0], ses, 'sürükleme sürerken öğe yenilenmedi');
  ses.gonder('change');
  const yeni = sayfa.bul((o) => o.type === 'range')[0];
  assert.notEqual(yeni, ses, 'bırakınca bekleyen model çizildi');
  assert.equal(yeni.value, '50');
});

test('medya: kaynak seçimi cihazın listesinden, seçince gider (onaysız); aynı kaynağı yeniden seçmek istek göndermez', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  const liste = sayfa.bul((o) => o.etiket === 'select')[0];
  assert.equal(liste.attributes['aria-label'], 'Salon TV kaynağı');
  assert.deepEqual(liste.children.map((o) => o.textContent), ['HDMI 1', 'HDMI 2', 'Netflix']);
  assert.equal(liste.value, 'HDMI 1');
  liste.value = 'HDMI 1';
  liste.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), []);
  liste.value = 'Netflix';
  liste.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'media_player.tv', servis: 'select_source', veri: { source: 'Netflix' }, sonDeger: true }]);
});

test('medya: kapatma onaylı servis olarak basılı tutma ister; kapalı TV\'yi açmak onaysızdır', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  const guc = dugmeAra(sayfa, 'Salon TV aç / kapat');
  assert.ok(guc.sinifVar('onayli'));
  guc.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), []);
  basiliTut(sayfa, guc, 900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'media_player.tv', servis: 'turn_off', basili: true }]);

  const kapali = await panelAc({ model: modelYap(varyant(TV, 'media_player.k', 'Kapalı TV', { ozellik: { ...MEDYA_OZ, durum: 'off', baslik: null, sanatci: null } })) });
  const ac = dugmeAra(kapali, 'Kapalı TV aç / kapat');
  assert.equal(ac.sinifVar('onayli'), false, 'turn_on onaylı değil');
  ac.gonder('click', { detail: 1 });
  assert.deepEqual(kapali.calistirmalar(), [{ kimlik: 'media_player.k', servis: 'turn_on' }]);
});

test('medya: ilerleme çubuğu çalarken saniyede bir ilerler, duraklatılmışsa sabit kalır; süre bilinmiyorsa çubuk yok', async () => {
  const sayfa = await panelAc({ model: modelYap(TV) });
  const cubuk = sayfa.bul((o) => o.etiket === 'progress')[0];
  assert.equal(Number(cubuk.max), 200);
  assert.equal(Number(cubuk.value), 50);
  sayfa.zaman.ilerle(10_000);
  assert.equal(Number(cubuk.value), 60);
  sayfa.zaman.ilerle(1_000_000);
  assert.equal(Number(cubuk.value), 200, 'süreyi aşmaz');

  const durak = await panelAc({ model: modelYap(varyant(TV, 'media_player.d', 'Duraklı', { ozellik: { ...MEDYA_OZ, durum: 'paused' } })) });
  const dcubuk = durak.bul((o) => o.etiket === 'progress')[0];
  durak.zaman.ilerle(10_000);
  assert.equal(Number(dcubuk.value), 50);

  const sureYok = await panelAc({ model: modelYap(varyant(TV, 'media_player.s', 'Süresiz', { ozellik: { ...MEDYA_OZ, sure: null } })) });
  assert.equal(sureYok.bul((o) => o.etiket === 'progress').length, 0);
});

test('medya: albüm kapağı için görsel öğesi hiç yoktur (img/picture/canvas çizilmez); model dışı anahtarlar (entity_picture) atılır', async () => {
  const sayfa = await panelAc({ model: modelYap(varyant(TV, 'media_player.tv', 'Salon TV', { ozellik: { ...MEDYA_OZ, entity_picture: '/api/media_player_proxy/x?token=gizli', media_image_url: 'http://x/y.jpg' } })) });
  assert.equal(sayfa.bul((o) => ['img', 'picture', 'canvas', 'video', 'audio', 'iframe'].includes(o.etiket)).length, 0);
  assert.doesNotMatch(JSON.stringify(sayfa.bul(() => true).map((o) => [o.attributes, o.title])), /gizli|media_player_proxy|y\.jpg/);
});

// --- vantilatör, nem alıcı, süpürge --------------------------------------------------------------------------------

const FAN = karo('fan.vantilator', 'Vantilatör', {
  grup: 'iklim',
  grupEtiketi: 'İklim',
  durum: 'acik',
  yuzde: 50,
  ozellik: { yuzde: 50, adimYuzde: 25, onAyar: 'Uyku', onAyarlar: ['Uyku', 'Turbo'], salinim: false },
});

test('vantilatör: hız kaydırıcısı, ön ayarlar ve salınım düğmesi; ana karo yine aç/kapat yapar (eski davranış korunur)', async () => {
  const sayfa = await panelAc({ model: modelYap(FAN) });
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-fan'));
  const ana = sayfa.bul((o) => o.sinifVar('karo'))[0];
  ana.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'fan.vantilator' }], 'düz tıklama eski aç/kapat eylemi');
  sayfa.zaman.ilerle(500);

  const hiz = sayfa.bul((o) => o.type === 'range')[0];
  assert.equal(hiz.value, '50');
  assert.equal(hiz.step, '25');
  hiz.value = 75;
  hiz.gonder('change');
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'fan.vantilator', servis: 'set_percentage', veri: { percentage: 75 }, sonDeger: true });

  const uyku = dugmeAra(sayfa, 'Vantilatör: Turbo ön ayarı');
  uyku.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'fan.vantilator', servis: 'set_preset_mode', veri: { preset_mode: 'Turbo' } });
  assert.ok(secili(dugmeAra(sayfa, 'Vantilatör: Uyku ön ayarı')), 'etkin ön ayar vurgulu');
  sayfa.zaman.ilerle(500);
  dugmeAra(sayfa, 'Vantilatör salınımı aç / kapat').gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'fan.vantilator', servis: 'oscillate', veri: { oscillating: true } });
});

test('vantilatör: hız ve ön ayarı olmayan (yalnız aç/kapat) vantilatör düz karo kalır', async () => {
  const sade = varyant(FAN, 'fan.sade', 'Sade fan', { ozellik: { yuzde: null, adimYuzde: null, onAyar: null, onAyarlar: [], salinim: null } });
  const sayfa = await panelAc({ model: modelYap(sade) });
  assert.equal(kartlar(sayfa).length, 0);
  assert.equal(sayfa.bul((o) => o.sinifVar('karo')).length, 1);
});

test('nem alıcı: hedef nem kaydırıcısı cihazın aralığındadır ve yüzde olarak gider; aralığı bilinmeyen nem alıcı düz karo kalır', async () => {
  const nem = karo('humidifier.n', 'Nem alıcı', { grup: 'iklim', grupEtiketi: 'İklim', durum: 'acik', ozellik: { hedefNem: 50, mevcutNem: 45, enAz: 30, enCok: 80, mod: null } });
  const sayfa = await panelAc({ model: modelYap(nem) });
  const k = sayfa.bul((o) => o.type === 'range')[0];
  assert.equal(k.min, '30');
  assert.equal(k.max, '80');
  assert.equal(k.value, '50');
  k.value = 65;
  k.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'humidifier.n', servis: 'set_humidity', veri: { humidity: 65 }, sonDeger: true }]);
  const bilinmeyen = await panelAc({ model: modelYap(varyant(nem, 'humidifier.b', 'Belirsiz', { ozellik: { hedefNem: null, mevcutNem: null, enAz: null, enCok: null, mod: null } })) });
  assert.equal(kartlar(bilinmeyen).length, 0);
});

test('süpürge: başlat, duraklat, şarja dön düğmeleri ve durum + pil; hepsi tek tıkla gider', async () => {
  const sup = karo('vacuum.s', 'Süpürge', { grup: 'diger', varsayilanEylem: false, ozellik: { durum: 'cleaning', pil: 80 } });
  const sayfa = await panelAc({ model: modelYap(sup) });
  assert.match(metin(sayfa), /Temizliyor · Pil %80/);
  for (const [aria, servis] of [
    ['Süpürge: temizliği başlat', 'start'],
    ['Süpürge: duraklat', 'pause'],
    ['Süpürge: şarj istasyonuna dön', 'return_to_base'],
  ]) {
    dugmeAra(sayfa, aria).gonder('click', { detail: 1 });
    sayfa.zaman.ilerle(500);
    assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'vacuum.s', servis }, aria);
  }
  assert.ok(secili(dugmeAra(sayfa, 'Süpürge: temizliği başlat')), 'temizlerken "Başlat" vurgulu');
});

// --- seçici, sayı, zamanlayıcı -------------------------------------------------------------------------------------

const EV_MODU = karo('input_select.ev_modu', 'Ev modu', {
  grup: 'yardimci',
  grupEtiketi: 'Yardımcılar',
  sinif: 'yikici',
  varsayilanEylem: false,
  onayliServisler: ['select_option'],
  ozellik: { secenek: 'Ev', secenekler: ['Ev', 'Dışarıda', 'Uyku'] },
});

test('seçici (varsayılan onaylı): seçim yerel kalır, "Uygula" basılı tutulunca gider; vazgeçilirse hiçbir şey gitmez', async () => {
  const sayfa = await panelAc({ model: modelYap(EV_MODU) });
  assert.ok(kartlar(sayfa)[0].sinifVar('kart-secim'));
  const liste = sayfa.bul((o) => o.etiket === 'select')[0];
  const uygula = dugmeler(sayfa, (o) => o.textContent === 'Uygula')[0];
  assert.ok(uygula.disabled, 'değişiklik yokken kapalı');
  liste.value = 'Uyku';
  liste.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), [], 'seçmek göndermez');
  assert.equal(uygula.disabled, false);

  uygula.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(400);
  uygula.gonder('pointerup');
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'erken bırakma iptal');

  basiliTut(sayfa, uygula, 900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'input_select.ev_modu', servis: 'select_option', veri: { option: 'Uyku' }, sonDeger: true, basili: true }]);
});

test('seçici: bekleyen (uygulanmamış) seçim, model yenilense de korunur; seçenek yoksa "Seçenek yok" yazar', async () => {
  const sayfa = await panelAc({ model: modelYap(EV_MODU, karo('input_boolean.x', 'Ek')) });
  const liste = sayfa.bul((o) => o.etiket === 'select')[0];
  liste.value = 'Dışarıda';
  liste.gonder('change');
  sayfa.durum(modelYap(EV_MODU, karo('input_boolean.x', 'Ek', { durum: 'acik' })));
  const yeni = sayfa.bul((o) => o.etiket === 'select')[0];
  assert.notEqual(yeni, liste, 'panel yeniden çizildi');
  assert.equal(yeni.value, 'Dışarıda', 'bekleyen seçim korundu');
  assert.equal(dugmeler(sayfa, (o) => o.textContent === 'Uygula')[0].disabled, false);

  const bos = await panelAc({ model: modelYap(varyant(EV_MODU, 'select.b', 'Boş', { ozellik: { secenek: null, secenekler: [] } })) });
  assert.match(metin(bos), /Seçenek yok/);
  assert.equal(bos.bul((o) => o.etiket === 'select').length, 0);
});

test('seçici (onay kapalı): seçince gider, aynı seçeneği yeniden seçmek göndermez; hata olursa liste eski değere döner', async () => {
  const serbest = varyant(EV_MODU, 'select.s', 'Serbest', { sinif: 'zararsiz', onayliServisler: [] });
  const sayfa = await panelAc({ model: modelYap(serbest), calistirYaniti: { ok: false, tur: 'ha-hatasi' } });
  const liste = sayfa.bul((o) => o.etiket === 'select')[0];
  assert.equal(dugmeler(sayfa, (o) => o.textContent === 'Uygula').length, 0);
  liste.value = 'Ev';
  liste.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), []);
  liste.value = 'Uyku';
  liste.gonder('change');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'select.s', servis: 'select_option', veri: { option: 'Uyku' }, sonDeger: true }]);
  await new Promise((coz) => setImmediate(coz));
  await new Promise((coz) => setImmediate(coz));
  assert.equal(liste.value, 'Ev', 'başarısız gönderimde eski değer');
});

const SAYI = karo('input_number.esik', 'Eşik', {
  grup: 'yardimci',
  grupEtiketi: 'Yardımcılar',
  sinif: 'yikici',
  varsayilanEylem: false,
  onayliServisler: ['set_value'],
  ozellik: { deger: 5, enAz: 0, enCok: 10, adim: 1, birim: '°C', kip: 'slider' },
});

test('sayı (varsayılan onaylı): ± ve kaydırıcı yerel değeri değiştirir, "Uygula" basılı tutulunca gider; sınırlar cihazdan gelir', async () => {
  const sayfa = await panelAc({ model: modelYap(SAYI) });
  assert.match(metin(sayfa), /5 °C/);
  const artir = dugmeAra(sayfa, 'Eşik değerini artır');
  const uygula = dugmeler(sayfa, (o) => o.textContent === 'Uygula')[0];
  artir.gonder('click');
  artir.gonder('click');
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'onaylı serviste ± hiçbir şey göndermez');
  assert.match(metin(sayfa), /7 °C/);
  const aralik = sayfa.bul((o) => o.type === 'range')[0];
  assert.equal(aralik.min, '0');
  assert.equal(aralik.max, '10');
  assert.equal(aralik.value, '7');
  assert.equal(uygula.disabled, false);
  basiliTut(sayfa, uygula, 900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'input_number.esik', servis: 'set_value', veri: { value: 7 }, sonDeger: true, basili: true }]);
});

test('sayı: sınır dışına çıkılmaz (üstte + etkisiz); sınırı bilinmeyen sayı ayarlanamaz ("Sınırları bilinmiyor")', async () => {
  const ust = await panelAc({ model: modelYap(varyant(SAYI, 'input_number.u', 'Üst', { ozellik: { ...SAYI.ozellik, deger: 10 } })) });
  const artir = dugmeAra(ust, 'Üst değerini artır');
  artir.gonder('click');
  assert.match(metin(ust), /10 °C/);
  assert.equal(dugmeler(ust, (o) => o.textContent === 'Uygula')[0].disabled, true, 'değişiklik olmadı');

  const sinirsiz = await panelAc({ model: modelYap(varyant(SAYI, 'number.s', 'Sınırsız', { ozellik: { deger: 3, enAz: null, enCok: null, adim: null, birim: null, kip: null } })) });
  assert.match(metin(sinirsiz), /Sınırları bilinmiyor/);
  assert.equal(sinirsiz.bul((o) => o.type === 'range').length, 0);
  assert.equal(dugmeler(sinirsiz, (o) => /değerini/.test(o.attributes['aria-label'] ?? '')).length, 0);
});

test('sayı (onay kapalı): ± düğmeleri 400 ms\'de tek gönderimde birleşir, kaydırıcı bırakılınca son değer gider', async () => {
  const serbest = varyant(SAYI, 'number.s', 'Serbest', { sinif: 'zararsiz', onayliServisler: [], ozellik: { ...SAYI.ozellik, adim: 0.5 } });
  const sayfa = await panelAc({ model: modelYap(serbest) });
  const artir = dugmeAra(sayfa, 'Serbest değerini artır');
  artir.gonder('click');
  artir.gonder('click');
  artir.gonder('click');
  sayfa.zaman.ilerle(450);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'number.s', servis: 'set_value', veri: { value: 6.5 }, sonDeger: true }]);
  const aralik = sayfa.bul((o) => o.type === 'range')[0];
  aralik.value = 9;
  aralik.gonder('change');
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'number.s', servis: 'set_value', veri: { value: 9 }, sonDeger: true });
});

const ZAMANLAYICI = karo('timer.mutfak', 'Mutfak', {
  grup: 'yardimci',
  grupEtiketi: 'Yardımcılar',
  sinif: 'yikici',
  varsayilanEylem: false,
  onayliServisler: ['start', 'pause', 'cancel'],
  ozellik: { durum: 'active', sure: '0:05:00', kalan: null, bitis: new Date(BASLANGIC + 120_000).toISOString() },
});

test('zamanlayıcı: geri sayım saniyede bir azalır; başlat / duraklat / iptal (varsayılan onaylı) basılı tutulunca gider', async () => {
  const sayfa = await panelAc({ model: modelYap(ZAMANLAYICI) });
  assert.match(metin(sayfa), /Çalışıyor · 2:00/);
  sayfa.zaman.ilerle(1000);
  assert.match(metin(sayfa), /Çalışıyor · 1:59/);
  sayfa.zaman.ilerle(200_000);
  assert.match(metin(sayfa), /Çalışıyor · 0:00/, 'süre bitince sıfırda kalır');

  const duraklat = dugmeAra(sayfa, 'Mutfak: duraklat');
  duraklat.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), []);
  basiliTut(sayfa, duraklat, 900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'timer.mutfak', servis: 'pause', basili: true }]);
  basiliTut(sayfa, dugmeAra(sayfa, 'Mutfak: iptal et'), 900);
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'timer.mutfak', servis: 'cancel', basili: true });
});

test('zamanlayıcı: duraklatılmış zamanlayıcı kalan süreyi gösterir ve "Sürdür" der; boştaki zamanlayıcı süreyi gösterir ve saymaz', async () => {
  const durak = varyant(ZAMANLAYICI, 'timer.d', 'Duraklı', { ozellik: { durum: 'paused', sure: '0:05:00', kalan: '0:03:30', bitis: null } });
  const sayfa = await panelAc({ model: modelYap(durak) });
  assert.match(metin(sayfa), /Duraklatıldı · 3:30/);
  sayfa.zaman.ilerle(5000);
  assert.match(metin(sayfa), /Duraklatıldı · 3:30/);
  assert.ok(dugmeAra(sayfa, 'Duraklı: başlat ya da sürdür'));
  assert.equal(dugmeAra(sayfa, 'Duraklı: başlat ya da sürdür').textContent, 'Sürdür');

  const bosta = await panelAc({ model: modelYap(varyant(ZAMANLAYICI, 'timer.b', 'Boşta', { ozellik: { durum: 'idle', sure: '1:00:00', kalan: null, bitis: null } })) });
  assert.match(metin(bosta), /Boşta · 1:00:00/);
  assert.equal(dugmeAra(bosta, 'Boşta: başlat ya da sürdür').textContent, 'Başlat');
});

test('zamanlayıcı: model yenilenince eski sayaç bırakılır (art arda çizimde sayaç birikmez); onay kapalıysa başlat tek tıkla gider', async () => {
  const serbest = varyant(ZAMANLAYICI, 'timer.s', 'Serbest', { sinif: 'zararsiz', onayliServisler: [] });
  const sayfa = await panelAc({ model: modelYap(serbest) });
  for (let i = 0; i < 5; i += 1) sayfa.durum(modelYap(varyant(serbest, 'timer.s', 'Serbest', { etiket: `Serbest${i}` })));
  sayfa.zaman.ilerle(3000);
  assert.match(metin(sayfa), /Serbest4/);
  dugmeAra(sayfa, 'Serbest4: başlat ya da sürdür').gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'timer.s', servis: 'start' }]);
});

// --- genel ---------------------------------------------------------------------------------------------------------

test('tek tıklama eylemi olmayan salt okunur karo (sensör) düz karoya düşer; tıklamak ne istek ne ipucu üretir', async () => {
  const sensor = karo('sensor.sicaklik', 'Sıcaklık', { varsayilanEylem: false, ozellik: { deger: '21.5', sayi: 21.5, birim: '°C', sinif: 'temperature', durumSinifi: 'measurement', hassasiyet: 1 } });
  const sayfa = await panelAc({ model: modelYap(sensor) });
  assert.equal(kartlar(sayfa).length, 0);
  const d = sayfa.bul((o) => o.sinifVar('karo'))[0];
  d.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(sayfa.ipucu(), '', 'komut yazılamayan karoda "komut yazın" ipucu yok');
});

test('kart gruplarına ayrılır: İklim ve Yardımcılar başlıkları görünür; sınıfı yıkıcı yardımcı "Onaylı" satırına taşınmaz', async () => {
  const model = {
    gruplar: [
      { kod: 'iklim', etiket: 'İklim', karolar: [KLIMA] },
      { kod: 'yardimci', etiket: 'Yardımcılar', karolar: [EV_MODU, SAYI] },
    ],
    sonlar: [],
    ust: { canli: true, baglanti: 'canli' },
  };
  const sayfa = await panelAc({ model });
  const basliklar = sayfa.bul((o) => o.className === 'bolum-baslik').map((o) => o.textContent);
  assert.deepEqual(basliklar, ['İklim', 'Yardımcılar']);
  assert.equal(kartlar(sayfa).length, 3);
});

test('kartlar kimliklere göre ayrı kilitlenir: aynı kartta iki farklı düğmeye art arda basış birbirini yok saymaz; aynı düğmeye çift tık yok sayılır', async () => {
  const sup = karo('vacuum.s', 'Süpürge', { varsayilanEylem: false, ozellik: { durum: 'docked', pil: 100 } });
  const sayfa = await panelAc({ model: modelYap(sup) });
  const basla = dugmeAra(sayfa, 'Süpürge: temizliği başlat');
  const duraklat = dugmeAra(sayfa, 'Süpürge: duraklat');
  basla.gonder('click', { detail: 1 });
  basla.gonder('click', { detail: 1 });
  duraklat.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar().map((y) => y.servis), ['start', 'pause']);
});

test('başarısız servis (onay ister) panelde ipucuyla söylenir; ana süreç "cok-sik" derse ipucu çıkar, kart bozulmaz', async () => {
  const sup = karo('vacuum.s', 'Süpürge', { varsayilanEylem: false, ozellik: { durum: 'docked', pil: 100 } });
  const sayfa = await panelAc({ model: modelYap(sup), calistirYaniti: { ok: false, tur: 'cok-sik' } });
  dugmeAra(sayfa, 'Süpürge: temizliği başlat').gonder('click', { detail: 1 });
  await new Promise((coz) => setImmediate(coz));
  await new Promise((coz) => setImmediate(coz));
  assert.match(sayfa.ipucu(), /sık/i);
  assert.equal(kartlar(sayfa).length, 1);
});

test('İngilizce arayüz: kart metinleri ve erişilebilir adlar İngilizce yazılır', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA, ZAMANLAYICI, RENKLI), dil: 'en' });
  assert.match(metin(sayfa), /Cool · cooling/);
  assert.match(metin(sayfa), /Now 26[.,]5°/);
  assert.ok(dugmeAra(sayfa, 'Salon klima: switch to Heat mode'));
  assert.ok(dugmeAra(sayfa, 'Mutfak: cancel'));
  assert.deepEqual(dugmeler(sayfa, (o) => /white/i.test(o.attributes['aria-label'] ?? '')).map((d) => d.textContent), ['Warm white', 'Neutral white', 'Cool white']);
  assert.match(metin(sayfa), /Dashed buttons run when held for about a second/);
});

test('kartlar betiği yoksa panel çökmez: kartlar düz karo olarak çizilir ve tıklamak istek göndermez', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA, EV_MODU), kartlarYok: true });
  assert.equal(kartlar(sayfa).length, 0);
  const karolar = sayfa.bul((o) => o.sinifVar('karo'));
  assert.equal(karolar.length, 2);
  karolar[0].gonder('click', { detail: 1 });
  karolar[1].gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'tek tıklama eylemi olmayan karo servis göndermez, onaylı olsa bile');
});

test('model savunması: bilinmeyen öznitelik anahtarları atılır, uzun metin ve liste kısaltılır, türü tutmayan değer null olur', async () => {
  const sayfa = await panelAc({ model: modelYap(KLIMA) });
  const K = sayfa.sandbox.EvKartlar;
  const uzun = 'a'.repeat(500);
  const temiz = JSON.parse(
    JSON.stringify(
      K.ozellikDuzelt({
        entity_picture: '/gizli',
        baslik: uzun,
        ses: 'yüksek',
        kaynaklar: Array.from({ length: 300 }, (_, i) => `K${i}`).concat([5, null]),
        rgb: [1, 2, 300],
        mevcutSicaklik: Infinity,
        sessiz: 'evet',
        sure: '0:05:00',
      }),
    ),
  );
  assert.equal('entity_picture' in temiz, false);
  assert.equal(temiz.baslik.length, 120);
  assert.equal(temiz.ses, null);
  assert.equal(temiz.kaynaklar.length, 100);
  assert.ok(temiz.kaynaklar.every((k) => typeof k === 'string'));
  assert.equal(temiz.rgb, null);
  assert.equal(temiz.mevcutSicaklik, null);
  assert.equal(temiz.sessiz, null);
  assert.equal(temiz.sure, '0:05:00');
  assert.equal(K.ozellikDuzelt(null), null);
  assert.equal(K.ozellikDuzelt([1]), null);
  assert.equal(K.ozellikDuzelt('x'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(K.servisListesiDuzelt(['set_hvac_mode', 'BÜYÜK', 5, 'a'.repeat(50), '../x', 'turn_off']))), ['set_hvac_mode', 'turn_off']);
  assert.deepEqual(JSON.parse(JSON.stringify(K.servisListesiDuzelt('x'))), []);
});
