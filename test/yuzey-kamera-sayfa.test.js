'use strict';

/**
 * Kamera bölümünün hızlı panel sayfasına bağlanması (src/yuzey-sayfa.js + src/yuzey-kamera.js), sahte DOM ve sahte köprüyle.
 *  - bölüm yalnız panel kipinde ve Ayarlar'da onaylı kamera varsa çizilir; palette kamera yoktur;
 *  - görüntü yalnız panel gösterilince/görünürken istenir; gizlenince DOM'dan silinir;
 *  - köprüde `kamera` yoksa sayfa kamerasız çalışır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { karo, modelYap, panelAc, paletAc, akit } = require('./yuzey-kartlar-sahte');

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const KAMERA = {
  liste: [
    { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true },
    { id: 'camera.balkon', etiket: 'Balkon', kullanilabilir: false },
  ],
  bulanik: true,
  yenilemeSn: 0,
};
const modelKamerali = (kamera = KAMERA) => ({ ...modelYap(karo('light.a', 'Lamba')), kamera });
const metin = (sayfa) => sayfa.oge('icerik').textContent;
const goruntuler = (sayfa) => sayfa.bul((o) => o.sinifVar('kamera-goruntu'));

test('panel: onaylı kamera varsa "Kameralar" bölümü çizilir; görüntü bulanık; yalnız kullanılabilir kamera istenir', async () => {
  const sayfa = await panelAc({ model: modelKamerali(), kameraYaniti: { ok: true, veri: PNG_URL, yas: 0, onbellek: false } });
  await akit();
  assert.equal(sayfa.bul((o) => o.sinifVar('grup-kamera')).length, 1);
  assert.match(metin(sayfa), /Kameralar/);
  assert.match(metin(sayfa), /Salon/);
  assert.match(metin(sayfa), /Balkon/);
  assert.deepEqual(sayfa.kameraIstekleri(), ['camera.salon'], 'ulaşılamayan kamera istenmez');
  const resim = goruntuler(sayfa).find((g) => g.getAttribute('src') === PNG_URL);
  assert.ok(resim, 'görüntü data: URL olarak yerleşti');
  assert.ok(resim.sinifVar('kamera-bulanik'), 'varsayılan bulanık');
});

test('panel: kamera bölümü yoksa (model.kamera null) hiçbir kamera isteği gitmez ve bölüm çizilmez', async () => {
  const sayfa = await panelAc({ model: modelKamerali(null), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  assert.equal(sayfa.bul((o) => o.sinifVar('grup-kamera')).length, 0);
  assert.deepEqual(sayfa.kameraIstekleri(), []);
});

test('palet: kamera bölümü çizilmez, istek gitmez', async () => {
  const sayfa = await paletAc({ model: modelKamerali(), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  assert.equal(sayfa.bul((o) => o.sinifVar('grup-kamera')).length, 0);
  assert.deepEqual(sayfa.kameraIstekleri(), []);
});

test('köprüde kamera yoksa sayfa kamerasız çalışır (bölüm yok, hata yok)', async () => {
  const sayfa = await panelAc({ model: modelKamerali() });
  await akit();
  assert.equal(sayfa.bul((o) => o.sinifVar('grup-kamera')).length, 0);
  assert.match(metin(sayfa), /Lamba/);
});

test('model kamera alanı bozuksa (kapı kamerası kimliği, tür hatası) süzülür: kimlik deseni camera.* dışı öğe çizilmez', async () => {
  const kamera = { liste: [{ id: 'light.a', etiket: 'Işık', kullanilabilir: true }, { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }, { id: 5 }, null], bulanik: true, yenilemeSn: 0 };
  const sayfa = await panelAc({ model: modelKamerali(kamera), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  assert.equal(sayfa.bul((o) => o.sinifVar('kamera-karo')).length, 1);
  assert.deepEqual(sayfa.kameraIstekleri(), ['camera.salon']);
});

test('pencere gizlenince (visibilitychange) görüntüler DOM\'dan silinir; görünür olunca ilk yükleme tekrarlanmaz (yeni gösterim gerekir)', async () => {
  const sayfa = await panelAc({ model: modelKamerali(), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  assert.ok(goruntuler(sayfa).some((g) => g.getAttribute('src') === PNG_URL));
  sayfa.sandbox.document.hidden = true;
  sayfa.belgeOlayi('visibilitychange');
  assert.ok(goruntuler(sayfa).every((g) => g.getAttribute('src') === null), 'gizli pencerede kare kalmaz');
  const sayi = sayfa.kameraIstekleri().length;
  sayfa.zaman.ilerle(120_000);
  await akit();
  assert.equal(sayfa.kameraIstekleri().length, sayi, 'gizliyken istek yok');
  sayfa.sandbox.document.hidden = false;
  sayfa.belgeOlayi('visibilitychange');
  await akit();
  assert.equal(sayfa.kameraIstekleri().length, sayi, 'yalnız görünür olmak yeni çekim başlatmaz (bekleyen yükleme yok)');
});

test('yeniden gösterim: eski kare silinir ve ilk görüntü yeniden istenir', async () => {
  const sayfa = await panelAc({ model: modelKamerali(), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  const ilk = sayfa.kameraIstekleri().length;
  sayfa.goster('panel');
  await akit();
  assert.ok(sayfa.kameraIstekleri().length > ilk, 'yeni gösterim yeniden çekim ister (ana süreç önbellekten döner)');
});

test('otomatik yenileme: yenilemeSn 10 iken panel açıkken 10 sn\'de bir yeniden istenir', async () => {
  const sayfa = await panelAc({ model: modelKamerali({ ...KAMERA, yenilemeSn: 10 }), kameraYaniti: { ok: true, veri: PNG_URL } });
  await akit();
  const ilk = sayfa.kameraIstekleri().length;
  sayfa.zaman.ilerle(10_000);
  await akit();
  assert.ok(sayfa.kameraIstekleri().length > ilk);
});

test('kamera hatası panelde kısa metin olarak görünür; sahte görüntü yok', async () => {
  const sayfa = await panelAc({ model: modelKamerali(), kameraYaniti: { ok: false, tur: 'izinsiz' } });
  await akit();
  assert.match(metin(sayfa), /izin/i);
  assert.ok(goruntuler(sayfa).every((g) => g.getAttribute('src') === null));
});
