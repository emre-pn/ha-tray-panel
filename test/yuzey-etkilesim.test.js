'use strict';

/**
 * Hızlı panelin 1.4.0 etkileşimleri (sahte DOM, sahte saat; test/yuzey-kartlar-sahte.js):
 *  - o-20 fare tekerleği: ışık parlaklığı ve medya sesi her çentikte ±5; sayfa kaydırmasıyla çakışmaz, kapalı ışığı açmaz,
 *    tekerlek bırakılınca SON değer gider, ayarla kapatılabilir. 1.7.0: panelde ışık kompakt satırdır (kaydırıcısı yok); tekerlek satırın
 *    üstünde çalışır, parlaklık yüzde göstergesinde (.karo-yuzde) görünür, kaydırılabilir panelde yalnız o göstergenin üstünde çalışır;
 *  - 1.7.0 ışık satırı: yatay sürükleme (8 px eşik), sürükleme sonrası tıklamanın yutulması, Shift + ← / → ±10;
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
/** 1.7.0 kompakt satırın parlaklık göstergesi (kaydırıcı artık yalnız ayrıntı bölmesindedir). */
const yuzdeOgesi = (kutu) => kutu.bul((o) => o.sinifVar('karo-yuzde'))[0];
/** Satırın ana düğmesi (aç / kapat, sürükleme ve klavye bunun üstündedir). */
const anaDugme = (kutu) => kutu.bul((o) => o.etiket === 'button' && o.sinifVar('karo'))[0];
const tekerlek = (oge, deltaY, ek = {}) => oge.gonder('wheel', { deltaY, deltaMode: 0, ctrlKey: false, shiftKey: false, ...ek });
const sabitleDugmesi = (sayfa) => sayfa.oge('sabitle');
/** Bu sayfanın son gönderimleri: { parlaklik, sonDeger } */
const parlakliklar = (sayfa) => sayfa.calistirmalar().map((c) => [c.parlaklik, c.sonDeger === true]);

// --- o-20: ışık parlaklığı ----------------------------------------------------------------------------------------------

test('tekerlek: ışıkta yukarı +5, aşağı −5; göstergede hemen görünür, sayfa kaydırması engellenir, tekerlek durunca SON değer bir kez gider', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  assert.equal(kutu.bul((o) => o.type === 'range').length, 0, '1.7.0: satırda kaydırıcı yok; parlaklık yüzde göstergesinde');
  const yuzde = yuzdeOgesi(kutu);
  assert.equal(yuzde.textContent, '%60');
  const ilk = tekerlek(kutu, -100);
  assert.equal(ilk.onlendi, true, 'sayfa kaydırması engellendi (karo üstünde tekerlek karonundur)');
  assert.equal(yuzde.textContent, '%65');
  sayfa.zaman.ilerle(40);
  tekerlek(kutu, -100);
  assert.equal(yuzde.textContent, '%70');
  sayfa.zaman.ilerle(40);
  tekerlek(kutu, 100);
  assert.equal(yuzde.textContent, '%65', 'aşağı çevirmek azaltır');
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
  assert.equal(yuzdeOgesi(isikKutulari(alt)[0]).textContent, '%1');

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
  assert.equal(yuzdeOgesi(kutu).textContent, '%60');
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

test('tekerlek: panel kaydırılabiliyorsa yalnız satırın yüzde göstergesinin üstünde çalışır — satır üstünden geçerken sayfa kaydırması bozulmaz', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const icerik = sayfa.oge('icerik');
  icerik.scrollHeight = 1200;
  icerik.clientHeight = 420;
  const kutu = isikKutulari(sayfa)[0];
  const yuzde = yuzdeOgesi(kutu);
  yuzde.contains = (oge) => oge === yuzde;
  assert.equal(tekerlek(kutu, -100, { target: kutu }).onlendi, undefined, 'satır gövdesi: sayfa kayar');
  assert.equal(tekerlek(kutu, -100, { target: anaDugme(kutu) }).onlendi, undefined, 'satırın ana düğmesi: sayfa kayar');
  assert.equal(yuzde.textContent, '%60', 'değer değişmedi');
  sayfa.zaman.ilerle(500);
  assert.equal(tekerlek(kutu, -100, { target: yuzde }).onlendi, true, 'yüzde göstergesi üstü: değer değişir');
  assert.equal(yuzde.textContent, '%65');
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
  assert.equal(yuzdeOgesi(kutuB).textContent, '%40');
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

// --- 1.7.0: kompakt ışık satırı (sürükleme, tıklamanın yutulması, Shift + ok) -------------------------------------------------

/** Satırın ana düğmesine genişliği 200 px (x: 100..300) olan sahte bir sınır kutusu verir: x konumu yüzdeye çevrilir ((x − 100) / 2). */
const satirKur = (kutu) => {
  const ana = anaDugme(kutu);
  ana.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 48 });
  return ana;
};
const basis = (ana, x, y = 20, ek = {}) => ana.gonder('pointerdown', { clientX: x, clientY: y, pointerId: 1, button: 0, ...ek });
const hareket = (ana, x, y = 20, ek = {}) => ana.gonder('pointermove', { clientX: x, clientY: y, pointerId: 1, ...ek });
const birak = (ana, x, y = 20) => ana.gonder('pointerup', { clientX: x, clientY: y, pointerId: 1 });
/** Yalnız parlaklık istekleri: [parlaklik, sonDeger] */
const parlaklikIstekleri = (sayfa) => sayfa.calistirmalar().filter((c) => c.parlaklik !== undefined).map((c) => [c.parlaklik, c.sonDeger === true]);
/** Yalnız aç / kapat istekleri ({ kimlik }); parlaklık istekleri hariç */
const acKapatlar = (sayfa) => sayfa.calistirmalar().filter((c) => c.parlaklik === undefined);

test('ışık satırı: yatay sürükleme 8 px eşiğini geçince parlaklığı ayarlar; ara değerler kısılır, bırakınca SON değer beklemeden gider; sürükleme sırasında model çizimi ertelenir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  const ana = satirKur(kutu);
  const yuzde = yuzdeOgesi(kutu);
  basis(ana, 160);
  hareket(ana, 167); // 7 px: eşik altı, tıklama sayılır
  assert.equal(yuzde.textContent, '%60');
  assert.deepEqual(sayfa.calistirmalar(), [], 'eşik geçilmeden istek yok');
  hareket(ana, 175); // 15 px: sürükleme başladı; (175 − 100) / 200 = %38
  assert.equal(yuzde.textContent, '%38', 'gösterge fareyi hemen izler');
  assert.deepEqual(parlakliklar(sayfa), [[38, false]], 'ilk değer hemen gider');
  hareket(ana, 200); // %50
  hareket(ana, 250); // %75
  hareket(ana, 260); // %80
  assert.equal(yuzde.textContent, '%80');
  assert.equal(parlakliklar(sayfa).length, 1, 'kalan ara değerler 200 ms pencerede birikir');
  sayfa.durum(modelYap({ ...ISIK, yuzde: 61 }));
  assert.equal(isikKutulari(sayfa)[0], kutu, 'sürükleme sürerken öğe yenilenmedi (satır elden gitmez)');
  birak(ana, 260);
  assert.deepEqual(parlakliklar(sayfa).at(-1), [80, true], 'bırakınca son değer gider');
  assert.equal(parlakliklar(sayfa).filter((x) => x[1]).length, 1, 'tek kesin değer');
  sayfa.zaman.ilerle(600);
  assert.equal(parlakliklar(sayfa).filter((x) => x[1]).length, 1, 'sonradan ikinci kesin değer gitmez');
  assert.ok(sayfa.calistirmalar().every((c) => Number.isInteger(c.parlaklik) && c.parlaklik >= 1 && c.parlaklik <= 100));
  assert.notEqual(isikKutulari(sayfa)[0], kutu, 'bırakılınca bekleyen model çizildi');
  assert.deepEqual(acKapatlar(sayfa), [], 'sürükleme ışığı aç / kapat yapmadı');
});

test('ışık satırı: sürüklemenin sonundaki tıklama aç / kapat sayılmaz (yutulur); sürüklemesiz tıklama ışığı değiştirir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const ana = satirKur(isikKutulari(sayfa)[0]);
  basis(ana, 160);
  hareket(ana, 200);
  birak(ana, 200);
  const tik = ana.gonder('click', { detail: 1 });
  assert.equal(tik.durduruldu, true, 'tıklama düğmenin kendi dinleyicisine ulaşmadı');
  assert.equal(tik.onlendi, true);
  assert.deepEqual(acKapatlar(sayfa), [], 'ışık kapanmadı');
  // yutma yalnız bir tıklamalıktır
  ana.gonder('click', { detail: 1 });
  assert.deepEqual(acKapatlar(sayfa), [{ kimlik: 'light.led_serit' }], 'bir sonraki bağımsız tıklama çalışır');
  ana.gonder('keyup', { key: 'ArrowRight' }); // ızgarada gezinme
  ana.gonder('keyup', { key: 'Shift' });
  sayfa.zaman.ilerle(600);
  assert.equal(parlaklikIstekleri(sayfa).filter((x) => x[1]).length, 1, 'sonraki tuş bırakışları sürüklemenin son değerini yeniden göndermez');

  // sürüklemesiz basış-bırakış (eşik altı) normal tıklamadır
  const duz = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const duzAna = satirKur(isikKutulari(duz)[0]);
  basis(duzAna, 160);
  hareket(duzAna, 163);
  birak(duzAna, 163);
  const duzTik = duzAna.gonder('click', { detail: 1 });
  assert.equal(duzTik.durduruldu, undefined);
  assert.deepEqual(duz.calistirmalar(), [{ kimlik: 'light.led_serit' }]);

  // yutma bayrağı bir sonraki olay turunda kendiliğinden düşer (click hiç gelmediyse bile)
  const yitik = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const yitikAna = satirKur(isikKutulari(yitik)[0]);
  basis(yitikAna, 160);
  hareket(yitikAna, 200);
  birak(yitikAna, 200);
  yitik.zaman.ilerle(1);
  yitikAna.gonder('click', { detail: 1 });
  assert.deepEqual(acKapatlar(yitik), [{ kimlik: 'light.led_serit' }], 'tıklama gelmeden süre dolduysa sonraki tıklama yutulmaz');
});

test('ışık satırı: dikey hareket, sağ tuş, başka işaretçi ve ulaşılamayan ışık sürüklemeyi başlatmaz; uçlarda 1-100 arasına kırpılır', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  const ana = satirKur(kutu);
  const yuzde = yuzdeOgesi(kutu);
  basis(ana, 160, 20);
  hareket(ana, 190, 80); // 30 px yatay, 60 px dikey: panelin kaydırılması
  birak(ana, 190, 80);
  assert.equal(yuzde.textContent, '%60');
  assert.deepEqual(sayfa.calistirmalar(), [], 'dikey harekette istek yok');
  assert.equal(ana.gonder('click', { detail: 1 }).durduruldu, undefined, 'dikey harekette tıklama yutulmaz');

  basis(ana, 160, 20, { button: 2 }); // sağ tuş
  hareket(ana, 220);
  birak(ana, 220);
  basis(ana, 160);
  ana.gonder('pointermove', { clientX: 220, clientY: 20, pointerId: 2 }); // başka işaretçi
  birak(ana, 220);
  assert.deepEqual(parlaklikIstekleri(sayfa), [], 'sağ tuş ve yabancı işaretçi parlaklık değiştirmez');

  basis(ana, 160);
  hareket(ana, 400); // sınırın ötesi: %100'e kırpılır
  assert.equal(yuzde.textContent, '%100');
  hareket(ana, 0); // sınırın gerisi: %1'e kırpılır
  assert.equal(yuzde.textContent, '%1');
  birak(ana, 0);
  assert.deepEqual(parlaklikIstekleri(sayfa).at(-1), [1, true]);
  assert.ok(sayfa.calistirmalar().every((c) => c.parlaklik === undefined || (c.parlaklik >= 1 && c.parlaklik <= 100)));

  const uzak = await panelAc({ model: modelYap({ ...ISIK, kullanilabilir: false, ulasilamiyor: true }), etkilesim: ETKILESIM });
  const uzakAna = satirKur(isikKutulari(uzak)[0]);
  basis(uzakAna, 160);
  hareket(uzakAna, 220);
  birak(uzakAna, 220);
  uzak.zaman.ilerle(1000);
  assert.deepEqual(uzak.calistirmalar(), [], 'ulaşılamayan ışıkta sürükleme etkisiz');
});

test('ışık satırı: Shift + ← / → parlaklığı ±10 değiştirir, tuş bırakılınca SON değer gider; oklar tek başına, Ctrl / Alt / Meta ile ya da başka tuşla etkisizdir', async () => {
  const sayfa = await panelAc({ model: modelYap(ISIK), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  const ana = anaDugme(kutu);
  const yuzde = yuzdeOgesi(kutu);
  assert.equal(ana.attributes['aria-keyshortcuts'], 'Shift+ArrowLeft Shift+ArrowRight', 'kısayol ekran okuyucuya bildirilir');
  const sag = ana.gonder('keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(sag.onlendi, true, 'Shift + ok sayfayı kaydırmaz / ızgarada gezinmez');
  assert.equal(yuzde.textContent, '%70');
  ana.gonder('keydown', { key: 'ArrowRight', shiftKey: true, repeat: true });
  assert.equal(yuzde.textContent, '%80', 'basılı tutunca tekrar eden tuş basışı da adım atar');
  ana.gonder('keydown', { key: 'ArrowLeft', shiftKey: true });
  assert.equal(yuzde.textContent, '%70');
  assert.equal(parlakliklar(sayfa).length, 1, 'ara değerler kısılır: yalnız ilk değer hemen gider');
  ana.gonder('keyup', { key: 'ArrowLeft' });
  assert.deepEqual(parlakliklar(sayfa).at(-1), [70, true], 'tuş bırakılınca son değer beklemeden gider');
  assert.equal(parlakliklar(sayfa).filter((x) => x[1]).length, 1);
  ana.gonder('keyup', { key: 'Shift' });
  ana.gonder('keyup', { key: 'ArrowRight' });
  sayfa.zaman.ilerle(600);
  assert.equal(parlakliklar(sayfa).filter((x) => x[1]).length, 1, 'sonraki tuş bırakışları aynı değeri yeniden göndermez');

  // etkisiz birleşimler
  const once = sayfa.calistirmalar().length;
  for (const ek of [{ key: 'ArrowRight' }, { key: 'ArrowRight', shiftKey: true, ctrlKey: true }, { key: 'ArrowRight', shiftKey: true, altKey: true }, { key: 'ArrowRight', shiftKey: true, metaKey: true }, { key: 'ArrowUp', shiftKey: true }, { key: 'a', shiftKey: true }]) {
    assert.equal(ana.gonder('keydown', ek).onlendi, undefined, JSON.stringify(ek));
  }
  assert.equal(yuzde.textContent, '%70');
  assert.equal(sayfa.calistirmalar().length, once);

  // uçlarda kırpılır
  for (let i = 0; i < 5; i += 1) ana.gonder('keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(yuzde.textContent, '%100');
  for (let i = 0; i < 12; i += 1) ana.gonder('keydown', { key: 'ArrowLeft', shiftKey: true });
  assert.equal(yuzde.textContent, '%1');
  ana.gonder('keyup', { key: 'Shift' });
  sayfa.zaman.ilerle(250); // önceki kesin değerden 200 ms dolmadan gelen bırakma pencere sonunda gider
  assert.deepEqual(parlakliklar(sayfa).at(-1), [1, true]);
});

test('ışık satırı: kapalı ışıkta Shift + → %10\'dan başlar ve ışığı açar; ulaşılamayan ışıkta Shift + ok etkisizdir', async () => {
  const sayfa = await panelAc({ model: modelYap(AMPUL), etkilesim: ETKILESIM });
  const kutu = isikKutulari(sayfa)[0];
  const ana = anaDugme(kutu);
  assert.equal(yuzdeOgesi(kutu).textContent, '—', 'kapalı ışıkta yüzde yok');
  ana.gonder('keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(yuzdeOgesi(kutu).textContent, '%10');
  ana.gonder('keyup', { key: 'ArrowRight' });
  assert.deepEqual(parlakliklar(sayfa).at(-1), [10, true]);

  const uzak = await panelAc({ model: modelYap({ ...ISIK, kullanilabilir: false, ulasilamiyor: true }), etkilesim: ETKILESIM });
  const uzakAna = anaDugme(isikKutulari(uzak)[0]);
  assert.equal(uzakAna.gonder('keydown', { key: 'ArrowRight', shiftKey: true }).onlendi, undefined);
  uzakAna.gonder('keyup', { key: 'ArrowRight' });
  uzak.zaman.ilerle(1000);
  assert.deepEqual(uzak.calistirmalar(), []);
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
