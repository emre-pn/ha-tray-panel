'use strict';

/**
 * Hızlı panelin 1.4.0 etkileşimleri (sahte DOM, sahte saat; test/yuzey-kartlar-sahte.js):
 *  - o-20 fare tekerleği: ışık parlaklığı ve medya sesi her çentikte ±5; sayfa kaydırmasıyla çakışmaz, kapalı ışığı açmaz,
 *    tekerlek bırakılınca SON değer gider, ayarla kapatılabilir;
 *  - o-23 panel sabitleme: başlıktaki iğne düğmesi ayarı ana süreçte değiştirir (renderer yalnız ister), başarısızsa eski hâlinde kalır.
 * Ana süreç tarafı (dışarı tıklama, Esc, IPC denetimi, ayar yazımı) test/ana-surec.test.js içindedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, modelYap, panelAc, paletAc, akit, kartlar } = require('./yuzey-kartlar-sahte');

const ISIK = karo('light.led_serit', 'LED şerit', { grup: 'isik', grupEtiketi: 'Işık', durum: 'acik', yuzde: 60, parlaklikKontrol: true });
const AMPUL = karo('light.ampul', 'Ampul', { grup: 'isik', grupEtiketi: 'Işık', durum: 'kapali', yuzde: null, parlaklikKontrol: true });
const MEDYA_OZ = { durum: 'playing', baslik: 'Şarkı', sanatci: 'Sanatçı', ses: 0.3, sessiz: false, kaynak: null, kaynaklar: [], sure: null, konum: null, konumZamani: null };
const TV = karo('media_player.tv', 'Salon TV', { grup: 'medya', grupEtiketi: 'Medya', varsayilanEylem: false, onayliServisler: ['turn_off'], ozellik: MEDYA_OZ });
const ETKILESIM = { tekerlek: true, sabit: false };

const isikKutulari = (sayfa) => sayfa.bul((o) => o.sinifVar('isik-karo'));
const aralikOgesi = (kutu) => kutu.bul((o) => o.type === 'range')[0];
const tekerlek = (oge, deltaY, ek = {}) => oge.gonder('wheel', { deltaY, deltaMode: 0, ctrlKey: false, shiftKey: false, ...ek });
const sabitleDugmesi = (sayfa) => sayfa.oge('sabitle');
/** Bu sayfanın son gönderimleri: { parlaklik, sonDeger } */
const parlakliklar = (sayfa) => sayfa.calistirmalar().map((c) => [c.parlaklik, c.sonDeger === true]);

// --- o-20: ışık parlaklığı ----------------------------------------------------------------------------------------------

test('tekerlek: ışıkta yukarı +5, aşağı −5; göstergede hemen görünür, sayfa kaydırması engellenir, tekerlek durunca SON değer bir kez gider', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  const aralik = aralikOgesi(kutu);
  assert.equal(aralik.value, '60');
  const ilk = tekerlek(kutu, -100);
  assert.equal(ilk.onlendi, true, 'sayfa kaydırması engellendi (karo üstünde tekerlek karonundur)');
  assert.equal(aralik.value, '65');
  sayfa.zaman.ilerle(40);
  tekerlek(kutu, -100);
  assert.equal(aralik.value, '70');
  sayfa.zaman.ilerle(40);
  tekerlek(kutu, 100);
  assert.equal(aralik.value, '65', 'aşağı çevirmek azaltır');
  const araSayisi = sayfa.calistirmalar().length;
  assert.ok(araSayisi >= 1 && araSayisi <= 3, `ara gönderimler kısılır (${araSayisi})`);
  assert.ok(sayfa.calistirmalar().every((c) => c.sonDeger !== true), 'tekerlek sürerken kesin değer gitmedi');
  sayfa.zaman.ilerle(249);
  assert.ok(sayfa.calistirmalar().every((c) => c.sonDeger !== true), '250 ms dolmadan son değer yok');
  sayfa.zaman.ilerle(2);
  const son = sayfa.calistirmalar().at(-1);
  assert.deepEqual(son, { kimlik: 'light.led_serit', parlaklik: 65, sonDeger: true });
  assert.equal(sayfa.calistirmalar().filter((c) => c.sonDeger === true).length, 1, 'tek kesin değer');
  assert.ok(sayfa.calistirmalar().every((c) => Number.isInteger(c.parlaklik) && c.parlaklik >= 1 && c.parlaklik <= 100));
});

test('tekerlek: uçta kırpılır (1 ve 100); değişmeyen değer istek üretmez', async () => {
  const alt = await panelAc({ model: modelYap({ ...ISIK, yuzde: 3 }), etkilesim: ETKILESIM });
  const kutuA = isikKutulari(alt)[0];
  tekerlek(kutuA, 100);
  alt.zaman.ilerle(400);
  assert.deepEqual(parlakliklar(alt).at(-1), [1, true], '3 − 5 → 1');
  const oncekiSayi = alt.calistirmalar().length;
  alt.zaman.ilerle(500);
  tekerlek(isikKutulari(alt)[0], 100);
  alt.zaman.ilerle(400);
  assert.equal(alt.calistirmalar().length, oncekiSayi, 'zaten alt sınırda (1): yeni istek yok');
  assert.equal(aralikOgesi(isikKutulari(alt)[0]).value, '1');

  const ust = await panelAc({ model: modelYap({ ...ISIK, yuzde: 100 }), etkilesim: ETKILESIM });
  tekerlek(isikKutulari(ust)[0], -100);
  ust.zaman.ilerle(600);
  assert.deepEqual(ust.calistirmalar(), [], 'zaten üst sınırda: istek yok');
});

test('tekerlek: ikinci dizi, HA yanıtı (model) gelmeden başlarsa gösterilen değerden sürer — eski model değerine geri sıçramaz', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  tekerlek(kutu, -100);
  tekerlek(kutu, -100);
  sayfa.zaman.ilerle(600); // dizi bitti: son değer 70 gitti, model hâlâ 60
  assert.deepEqual(parlakliklar(sayfa).at(-1), [70, true]);
  tekerlek(isikKutulari(sayfa)[0], -100);
  sayfa.zaman.ilerle(600);
  assert.deepEqual(parlakliklar(sayfa).at(-1), [75, true], '70 + 5 (60 + 5 = 65 değil)');
});

test('tekerlek: kapalı ışığı AÇMAZ ve sayfa kaydırması engellenmez; ulaşılamayan ışıkta da etkisiz', async () => {
  const sayfa = await panelAc({ model: modelYap(AMPUL, { ...ISIK, id: 'light.uzak', etiket: 'Uzak', kullanilabilir: false, ulasilamiyor: true }), etkilesim: ETKILESIM });
  for (const kutu of isikKutulari(sayfa)) {
    const olay = tekerlek(kutu, -100);
    assert.equal(olay.onlendi, undefined, 'olay işlenmedi: sayfa kaydırması sürer');
    sayfa.zaman.ilerle(500);
  }
  sayfa.zaman.ilerle(1000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'kapalı / ulaşılamayan ışığa hiçbir istek gitmez');
});

test('tekerlek: Ctrl (yakınlaştırma) ve Shift (yatay kaydırma) ile çevrilirse yok sayılır', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  assert.equal(tekerlek(kutu, -100, { ctrlKey: true }).onlendi, undefined);
  sayfa.zaman.ilerle(500);
  assert.equal(tekerlek(kutu, -100, { shiftKey: true }).onlendi, undefined);
  sayfa.zaman.ilerle(1000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(aralikOgesi(kutu).value, '60');
});

test('tekerlek: ayardan kapatılınca (karoTekerlegi) hiçbir şey olmaz; Ayarlar\'dan açılınca çalışır (yuzey:etkilesim)', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: { tekerlek: false, sabit: false } });
  const kutu = isikKutulari(sayfa)[0];
  assert.equal(tekerlek(kutu, -100).onlendi, undefined);
  sayfa.zaman.ilerle(1000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  sayfa.etkilesimDegisti({ tekerlek: true, sabit: false });
  assert.equal(tekerlek(kutu, -100).onlendi, true);
  sayfa.zaman.ilerle(400);
  assert.deepEqual(parlakliklar(sayfa).at(-1), [65, true]);
  sayfa.etkilesimDegisti({ tekerlek: false, sabit: false });
  sayfa.zaman.ilerle(1000);
  assert.equal(tekerlek(kutu, -100).onlendi, undefined, 'yeniden kapatıldı');
});

test('tekerlek: etkileşim bilgisi hiç gelmezse (eski ana süreç) varsayılan AÇIK; geçersiz yük yok sayılır', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK) });
  sayfa.etkilesimDegisti(null);
  sayfa.etkilesimDegisti('x');
  assert.equal(tekerlek(isikKutulari(sayfa)[0], -100).onlendi, true);
});

test('tekerlek: panel kaydırılabiliyorsa yalnız kaydırıcının üstünde çalışır — karo üstünden geçerken sayfa kaydırması bozulmaz', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const icerik = sayfa.oge('icerik');
  icerik.scrollHeight = 1200;
  icerik.clientHeight = 420;
  const kutu = isikKutulari(sayfa)[0];
  const aralik = aralikOgesi(kutu);
  aralik.contains = (oge) => oge === aralik;
  assert.equal(tekerlek(kutu, -100, { target: kutu }).onlendi, undefined, 'karo gövdesi: sayfa kayar');
  sayfa.zaman.ilerle(500);
  assert.equal(tekerlek(kutu, -100, { target: aralik }).onlendi, true, 'kaydırıcı üstü: değer değişir');
  assert.equal(aralik.value, '65');
  sayfa.zaman.ilerle(400);
  assert.deepEqual(parlakliklar(sayfa).at(-1), [65, true]);
});

test('tekerlek: kaydırma sürerken (400 ms dolmadan) karo dizi başlatamaz; dizi başladığı karoda kalır', async () => {
  const B = { ...ISIK, id: 'light.b', etiket: 'B', yuzde: 40 };
  const sayfa = await panelAc({ model: modelYap(ISIK, B), etkilesim: ETKILESIM });
  const [kutuA, kutuB] = isikKutulari(sayfa);
  assert.equal(tekerlek(kutuA, -100).onlendi, true);
  sayfa.zaman.ilerle(100);
  assert.equal(tekerlek(kutuB, -100).onlendi, undefined, 'dizi A\'dayken B karosu devralmaz');
  assert.equal(aralikOgesi(kutuB).value, '40');
  sayfa.zaman.ilerle(1000);
  assert.deepEqual(parlakliklar(sayfa).filter((x) => x[0] === 45), [], 'B hiçbir istek üretmedi');
  assert.ok(sayfa.calistirmalar().every((c) => c.kimlik === 'light.led_serit'));
});

test('tekerlek: dizi sürerken gelen model güncellemesi çizimi erteler (kaydırıcı elden gitmez), dizi bitince çizilir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  tekerlek(kutu, -100);
  sayfa.durum(modelYap({ ...ISIK, yuzde: 61 }));
  assert.equal(isikKutulari(sayfa)[0], kutu, 'tekerlek sürerken öğe yenilenmedi');
  sayfa.zaman.ilerle(300);
  assert.notEqual(isikKutulari(sayfa)[0], kutu, 'dizi bitince bekleyen model çizildi');
});

test('tekerlek: palette (kart ızgarası yok) bağlanmaz; panel gizlenip yeniden gösterilince yarım kalan dizi biter ve son değer gider', async () => {
  const palet = await paletAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  assert.equal(isikKutulari(palet).length, 0);
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  tekerlek(isikKutulari(sayfa)[0], -100);
  sayfa.pencereOlayi('blur'); // pencere odağı kaybetti
  assert.deepEqual(parlakliklar(sayfa).at(-1), [65, true], 'yarım kalan dizi bitirildi: kesin değer gitti');
});

// --- o-20: medya sesi ---------------------------------------------------------------------------------------------------

test('tekerlek: medya kartında ses ±5 (volume_set, 0-1); son değer tekerlek durunca bir kez gider', async () => {
  const sayfa = await panelAc({ model: modelYap(TV), etkilesim: ETKILESIM });
  const kart = kartlar(sayfa)[0];
  const ses = kart.bul((o) => o.type === 'range')[0];
  assert.equal(ses.value, '30');
  assert.equal(tekerlek(kart, -100).onlendi, true);
  sayfa.zaman.ilerle(30);
  tekerlek(kart, -100);
  assert.equal(ses.value, '40');
  sayfa.zaman.ilerle(300);
  const son = sayfa.calistirmalar().at(-1);
  assert.deepEqual(son, { kimlik: 'media_player.tv', servis: 'volume_set', veri: { volume_level: 0.4 }, sonDeger: true });
  assert.equal(sayfa.calistirmalar().filter((c) => c.sonDeger === true).length, 1);
  assert.ok(sayfa.calistirmalar().every((c) => c.servis === 'volume_set' && c.veri.volume_level >= 0 && c.veri.volume_level <= 1));
  assert.ok(sayfa.calistirmalar().every((c) => c.basili !== true), 'ses değişimi onay/basılı tutma gerektirmez ve göndermez');
});

test('tekerlek: ulaşılamayan medya cihazında ve tekerlek kapalıyken ses değişmez', async () => {
  const uzak = await panelAc({ model: modelYap({ ...TV, kullanilabilir: false, ulasilamiyor: true }), etkilesim: ETKILESIM });
  assert.equal(tekerlek(kartlar(uzak)[0], -100).onlendi, undefined);
  const kapali = await panelAc({ model: modelYap(TV), etkilesim: { tekerlek: false, sabit: false } });
  assert.equal(tekerlek(kartlar(kapali)[0], -100).onlendi, undefined);
  uzak.zaman.ilerle(1000);
  kapali.zaman.ilerle(1000);
  assert.deepEqual(uzak.calistirmalar(), []);
  assert.deepEqual(kapali.calistirmalar(), []);
});

// --- o-23: sabitleme düğmesi ---------------------------------------------------------------------------------------------

test('sabitleme düğmesi: başlangıç durumu ana süreçten gelir (aria-pressed, ipucu); tıklayınca ana sürece YALNIZ istenen boolean gider ve yanıtla güncellenir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: { tekerlek: true, sabit: false } });
  const dugme = sabitleDugmesi(sayfa);
  assert.equal(dugme.attributes['aria-pressed'], 'false');
  assert.equal(dugme.sinifVar('basili'), false);
  assert.match(dugme.title, /^Paneli sabitle/);
  dugme.gonder('click');
  await akit();
  assert.deepEqual(sayfa.sabitlemeler(), [true]);
  assert.equal(dugme.attributes['aria-pressed'], 'true');
  assert.equal(dugme.sinifVar('basili'), true);
  assert.equal(dugme.title, 'Sabitlemeyi kaldır');
  assert.equal(dugme.attributes['aria-label'], 'Sabitlemeyi kaldır');
  dugme.gonder('click');
  await akit();
  assert.deepEqual(sayfa.sabitlemeler(), [true, false]);
  assert.equal(dugme.attributes['aria-pressed'], 'false');
  assert.deepEqual(sayfa.calistirmalar(), [], 'sabitleme HA\'ya hiçbir eylem göndermez');
});

test('sabitleme düğmesi: açılışta sabitliyse basılı görünür; Ayarlar\'dan değişince (yuzey:etkilesim) düğme güncellenir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: { tekerlek: true, sabit: true } });
  const dugme = sabitleDugmesi(sayfa);
  assert.equal(dugme.attributes['aria-pressed'], 'true');
  assert.equal(dugme.sinifVar('basili'), true);
  sayfa.etkilesimDegisti({ tekerlek: true, sabit: false });
  assert.equal(dugme.attributes['aria-pressed'], 'false');
  assert.equal(dugme.sinifVar('basili'), false);
  sayfa.etkilesimDegisti({ tekerlek: true, sabit: true });
  assert.equal(dugme.attributes['aria-pressed'], 'true');
});

test('sabitleme düğmesi: ana süreç reddeder ya da yazamazsa düğme eski hâlinde kalır ve kısa bir hata ipucu çıkar', async () => {
  for (const yanit of [{ ok: false, tur: 'yazilamadi' }, { ok: true }, { ok: true, sabit: 'evet' }, null, undefined]) {
    const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM, sabitleYaniti: () => yanit });
    const dugme = sabitleDugmesi(sayfa);
    dugme.gonder('click');
    await akit();
    assert.equal(dugme.attributes['aria-pressed'], 'false', JSON.stringify(yanit));
    assert.equal(dugme.sinifVar('basili'), false);
    assert.match(sayfa.ipucu(), /sabit/i, 'ipucu söylenir');
  }
  const atan = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM, sabitleYaniti: () => Promise.reject(new Error('ipc')) });
  sabitleDugmesi(atan).gonder('click');
  await akit();
  assert.equal(sabitleDugmesi(atan).attributes['aria-pressed'], 'false');
  assert.match(atan.ipucu(), /sabit/i);
});

test('sabitleme düğmesi: renderer yalnız boolean ister, ayar anahtarı ya da başka bir şey göndermez', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  sabitleDugmesi(sayfa).gonder('click');
  await akit();
  for (const istek of sayfa.sabitlemeler()) assert.equal(typeof istek, 'boolean');
});
