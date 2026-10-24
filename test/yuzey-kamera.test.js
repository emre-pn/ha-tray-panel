'use strict';

/**
 * Hızlı panelin kamera bölümü (src/yuzey-kamera.js, o-48): sahte DOM ve sahte köprü ile.
 * Güvenlik/gizlilik özellikleri: görüntü varsayılan bulanık; gizlenince bellekten ve DOM'dan silinir; hata durumunda eski kare yok;
 * geç gelen eski yanıt yok sayılır; yalnız data:image/... base64 görüntü kabul edilir; yalnız metin yazılır (textContent).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/yuzey-kamera');
const { SahteOge, sahteZaman, akit } = require('./yuzey-kartlar-sahte');

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgM=';

const t = (anahtar, degisken) => (degisken ? `${anahtar}|${JSON.stringify(degisken)}` : anahtar);
const model = (ek = {}) => ({
  liste: [
    { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true },
    { id: 'camera.balkon', etiket: 'Balkon', kullanilabilir: true },
  ],
  bulanik: true,
  yenilemeSn: 0,
  ...ek,
});

function kur({ yanitlar = {}, acik = true } = {}) {
  const odak = { aktif: null };
  const zaman = sahteZaman();
  const durum = { acik, cizimler: 0, boyutlar: 0, satirlar: [], odaklar: new Map(), istekler: [], bekleyenler: [] };
  const ctx = {
    t,
    olustur: (etiket, sinif, metin) => {
      const oge = new SahteOge(etiket, null, odak);
      if (sinif) oge.className = sinif;
      if (metin !== undefined) oge.textContent = metin;
      return oge;
    },
    odakKaydet: (anahtar, oge) => durum.odaklar.set(anahtar, oge),
    satirEkle: (ogeler) => durum.satirlar.push(ogeler),
    kamera: (kimlik) => {
      durum.istekler.push(kimlik);
      const y = yanitlar[kimlik];
      if (typeof y === 'function') return y(kimlik);
      return Promise.resolve(y ?? { ok: true, veri: PNG_URL, yas: 0, onbellek: false });
    },
    yenidenCiz: () => (durum.cizimler += 1),
    boyutDegisti: () => (durum.boyutlar += 1),
    simdi: () => zaman.simdi(),
    zamanlayici: { setTimeout: (f, ms) => zaman.setTimeout(f, ms), clearTimeout: (id) => zaman.clearTimeout(id) },
    acikMi: () => durum.acik,
  };
  const modul = K.olustur(ctx);
  const kartlar = () => modul.parcalar()[0].bul((o) => o.sinifVar('kamera-karo'));
  return { modul, durum, zaman, ctx, kartlar };
}

const bulSinif = (kok, sinif) => kok.bul((o) => o.sinifVar(sinif));
const kartDurumu = (kart) => ({
  resim: bulSinif(kart, 'kamera-goruntu')[0],
  cerceve: bulSinif(kart, 'kamera-cerceve')[0],
  durum: bulSinif(kart, 'kamera-durum')[0],
  yenile: bulSinif(kart, 'kamera-yenile')[0],
  yas: bulSinif(kart, 'kamera-yas')[0],
  ad: bulSinif(kart, 'kamera-ad')[0],
});

test('modelDuzelt: yalnız camera.* kimlikleri, tekrarsız, en çok 8; bulanık varsayılan açık; yenileme yalnız izinli değerler; boş liste null', () => {
  const m = K.modelDuzelt({
    liste: [
      { id: 'camera.salon', etiket: ' Salon ', kullanilabilir: true },
      { id: 'camera.salon', etiket: 'Tekrar' },
      { id: 'light.a', etiket: 'Işık' },
      { id: 'camera.A', etiket: 'Büyük harf' },
      { id: 'camera.', etiket: 'Boş' },
      { id: 5 },
      null,
      { id: 'camera.balkon', etiket: '', kullanilabilir: 'evet' },
    ],
    bulanik: false,
    yenilemeSn: 30,
  });
  assert.deepEqual(m, {
    liste: [
      { id: 'camera.salon', etiket: 'Salon', kullanilabilir: true },
      { id: 'camera.balkon', etiket: 'camera.balkon', kullanilabilir: false },
    ],
    bulanik: false,
    yenilemeSn: 30,
  });
  assert.equal(K.modelDuzelt({ liste: [{ id: 'camera.a' }] }).bulanik, true);
  for (const sn of [1, 7, 61, -5, '30', null, NaN, undefined]) assert.equal(K.modelDuzelt({ liste: [{ id: 'camera.a' }], yenilemeSn: sn }).yenilemeSn, 0, String(sn));
  const cok = K.modelDuzelt({ liste: Array.from({ length: 20 }, (_, i) => ({ id: `camera.k${i}` })) });
  assert.equal(cok.liste.length, K.EN_COK_KAMERA);
  for (const bos of [null, undefined, {}, { liste: [] }, { liste: 'x' }, 'x', 5, { liste: [{ id: 'light.a' }] }]) assert.equal(K.modelDuzelt(bos), null, JSON.stringify(bos));
});

test('parcalar: model yoksa bölüm yok; model varsa başlık, not ve her kamera için kart; kart sınıfları ve odak kayıtları', () => {
  const { modul, durum } = kur();
  assert.deepEqual(modul.parcalar(), []);
  modul.ayarla(model());
  const [bolum] = modul.parcalar();
  assert.ok(bolum.sinifVar('grup-kamera'));
  assert.equal(bulSinif(bolum, 'bolum-baslik')[0].textContent, 'yuzey.kamera.baslik');
  assert.equal(bulSinif(bolum, 'kamera-not')[0].textContent, 'yuzey.kamera.notBulanik');
  const kartlar = bulSinif(bolum, 'kamera-karo');
  assert.equal(kartlar.length, 2);
  assert.equal(kartDurumu(kartlar[0]).ad.textContent, 'Salon');
  assert.ok(durum.odaklar.has('kamera:camera.salon') && durum.odaklar.has('kamera:camera.balkon'));
  assert.equal(durum.satirlar.at(-1).length, 2, 'görüntü yokken yalnız yenile düğmeleri odak satırında');
  modul.ayarla(model({ bulanik: false }));
  assert.equal(bulSinif(modul.parcalar()[0], 'kamera-not')[0].textContent, 'yuzey.kamera.not');
});

test('ayarla bir ağ isteği BAŞLATMAZ; yalnız gösterildi (görünür pencere) ilk görüntüyü ister, kameralar sırayla (tek istek)', async () => {
  const { modul, durum } = kur();
  modul.ayarla(model());
  modul.parcalar();
  await akit();
  assert.deepEqual(durum.istekler, []);
  modul.gosterildi();
  assert.deepEqual(durum.istekler, ['camera.salon'], 'bir seferde tek istek');
  await akit();
  assert.deepEqual(durum.istekler, ['camera.salon', 'camera.balkon']);
});

test('görüntü gelince img src data: URL olur ve BULANIK sınıfıyla başlar; tıklayınca açılır, yeniden tıklayınca bulanıklaşır', async () => {
  const { modul, kartlar } = kur();
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const [kart] = kartlar();
  const o = kartDurumu(kart);
  assert.equal(o.resim.getAttribute('src'), PNG_URL);
  assert.ok(o.resim.sinifVar('kamera-bulanik'));
  assert.equal(o.cerceve.getAttribute('aria-pressed'), 'false');
  assert.equal(o.cerceve.hidden, false);
  assert.equal(o.durum.hidden, true);
  o.cerceve.gonder('click');
  assert.ok(!o.resim.sinifVar('kamera-bulanik'));
  assert.equal(o.cerceve.getAttribute('aria-pressed'), 'true');
  assert.match(o.cerceve.getAttribute('aria-label'), /^yuzey\.kamera\.gizle\|/);
  o.cerceve.gonder('click');
  assert.ok(o.resim.sinifVar('kamera-bulanik'));
});

test('bulanik:false ayarı: görüntü bulanıksız başlar', async () => {
  const { modul, kartlar } = kur();
  modul.ayarla(model({ bulanik: false }));
  modul.gosterildi();
  await akit();
  assert.ok(!kartDurumu(kartlar()[0]).resim.sinifVar('kamera-bulanik'));
});

test('her gösterimde görüntü yeniden bulanık başlar (açılmış görüntü kalıcı değildir)', async () => {
  const { modul, kartlar } = kur();
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const o = kartDurumu(kartlar()[0]);
  o.cerceve.gonder('click');
  assert.ok(!o.resim.sinifVar('kamera-bulanik'));
  modul.gosterildi();
  assert.equal(o.resim.getAttribute('src'), null, 'eski kare gösterim anında silinir');
  await akit();
  assert.ok(o.resim.sinifVar('kamera-bulanik'), 'yeniden bulanık');
});

test('gizlendi: bellekteki kareler ve DOM\'daki görüntü silinir, bekleyen istek sıfırlanır, yeni istek gitmez', async () => {
  const { modul, durum, kartlar } = kur();
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  assert.equal(modul.kareSayisi(), 2);
  const o = kartDurumu(kartlar()[0]);
  assert.equal(o.resim.getAttribute('src'), PNG_URL);
  modul.gizlendi();
  assert.equal(modul.kareSayisi(), 0);
  assert.equal(o.resim.getAttribute('src'), null);
  assert.equal(kartDurumu(kartlar()[1]).resim.getAttribute('src'), null);
  const sayi = durum.istekler.length;
  modul.gorunurOldu();
  await akit();
  assert.equal(durum.istekler.length, sayi, 'gizlendikten sonra görünür olunca (gösterim olmadan) istek gitmez');
});

test('geç gelen eski yanıt (gizlendi/yeniden gösterildi sonrası) yok sayılır; görüntü belleğe girmez', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const { modul, kartlar } = kur({ yanitlar: { 'camera.salon': () => bekle } });
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
  modul.gosterildi();
  await akit();
  modul.gizlendi();
  coz({ ok: true, veri: JPEG_URL, yas: 0 });
  await akit();
  assert.equal(modul.kareSayisi(), 0, 'gizlendikten sonra gelen kare saklanmaz');
  assert.equal(kartDurumu(kartlar()[0]).resim.getAttribute('src'), null);
});

test('hata durumunda eski kare gösterilmez; hata türüne göre metin; bilinmeyen tür "goruntu-yok" olur', async () => {
  const yanitlar = { 'camera.salon': { ok: false, tur: 'cok-sik' }, 'camera.balkon': { ok: false, tur: 'ayakta-degil-bu-tur' } };
  const { modul, kartlar } = kur({ yanitlar });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const [a, b] = kartlar().map(kartDurumu);
  assert.equal(a.durum.textContent, 'yuzey.kamera.hata.cokSik');
  assert.ok(a.durum.sinifVar('kamera-hata'));
  assert.equal(a.cerceve.hidden, true);
  assert.equal(a.resim.getAttribute('src'), null);
  assert.equal(b.durum.textContent, 'yuzey.kamera.hata.goruntuYok');
  assert.equal(modul.kareSayisi(), 0);
  // görüntü varken yenilemede hata gelirse eski kare silinir
  yanitlar['camera.salon'] = { ok: true, veri: PNG_URL, yas: 0 };
  a.yenile.gonder('click');
  await akit();
  assert.equal(a.resim.getAttribute('src'), PNG_URL);
  yanitlar['camera.salon'] = { ok: false, tur: 'yasak' };
  a.yenile.gonder('click');
  await akit();
  assert.equal(a.resim.getAttribute('src'), null, 'hata sonrası eski kare kalmaz');
  assert.equal(a.durum.textContent, 'yuzey.kamera.hata.yasak');
});

test('köprü hata fırlatır ya da reddederse "ha-hatasi" gösterilir; panel çökmez', async () => {
  const { modul, kartlar } = kur({ yanitlar: { 'camera.salon': () => Promise.reject(new Error('ağ')), 'camera.balkon': () => { throw new Error('eşzamanlı'); } } });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const [a, b] = kartlar().map(kartDurumu);
  assert.equal(a.durum.textContent, 'yuzey.kamera.hata.haHatasi');
  assert.equal(b.durum.textContent, 'yuzey.kamera.hata.haHatasi');
});

test('geçersiz görüntü kabul edilmez: data:image dışı, http adresi, javascript:, şüpheli karakter, aşırı büyük veri', async () => {
  const kotuler = [
    'http://192.168.1.10:8123/api/camera_proxy/camera.salon?token=GIZLI',
    'javascript:alert(1)',
    'data:text/html;base64,PGgxPmhpPC9oMT4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,AAAA" onerror="x',
    'data:image/png,AAAA',
    '/api/camera_proxy/camera.salon',
    `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024 + 8)}`,
    '',
    5,
    null,
    { toString: () => PNG_URL },
  ];
  for (const veri of kotuler) {
    const { modul, kartlar } = kur({ yanitlar: { 'camera.salon': { ok: true, veri, yas: 0 } } });
    modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
    modul.gosterildi();
    await akit();
    const o = kartDurumu(kartlar()[0]);
    assert.equal(o.resim.getAttribute('src'), null, String(veri).slice(0, 40));
    assert.equal(modul.kareSayisi(), 0);
    assert.equal(o.durum.textContent, 'yuzey.kamera.hata.goruntuYok');
  }
  for (const gecerli of [PNG_URL, JPEG_URL, 'data:image/webp;base64,UklGRgQAAABXRUJQVlA=', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=']) {
    const { modul } = kur({ yanitlar: { 'camera.salon': { ok: true, veri: gecerli, yas: 0 } } });
    modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
    modul.gosterildi();
    await akit();
    assert.equal(modul.kareSayisi(), 1, gecerli.slice(0, 30));
  }
});

test('yenile düğmesi tek kamerayı yeniler; yüklenirken devre dışı; ulaşılamayan kamerada devre dışı ve istek gitmez', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const yanitlar = { 'camera.salon': () => bekle };
  const { modul, durum, kartlar } = kur({ yanitlar });
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }, { id: 'camera.balkon', etiket: 'Balkon', kullanilabilir: false }] }));
  modul.parcalar();
  const [salon, balkon] = kartlar().map(kartDurumu);
  assert.equal(balkon.yenile.disabled, true);
  assert.equal(balkon.durum.textContent, 'yuzey.kamera.hata.ulasilamiyor');
  balkon.yenile.gonder('click');
  await akit();
  assert.deepEqual(durum.istekler, []);
  modul.gosterildi();
  await akit();
  assert.deepEqual(durum.istekler, ['camera.salon'], 'ulaşılamayan kamera sıraya girmez');
  assert.equal(salon.yenile.disabled, true, 'yüklenirken devre dışı');
  assert.equal(salon.durum.textContent, 'yuzey.kamera.yukleniyor');
  coz({ ok: true, veri: PNG_URL, yas: 0 });
  await akit();
  assert.equal(salon.yenile.disabled, false);
  salon.yenile.gonder('click');
  await akit();
  assert.equal(durum.istekler.filter((k) => k === 'camera.salon').length, 2);
});

test('otomatik yenileme: yenilemeSn 10 ise 10 sn\'de bir tüm kameralar yenilenir; gizlenince zamanlayıcı durur; 0 ise hiç kurulmaz', async () => {
  const { modul, durum, zaman } = kur();
  modul.ayarla(model({ yenilemeSn: 10 }));
  modul.gosterildi();
  await akit();
  assert.equal(durum.istekler.length, 2);
  zaman.ilerle(9999);
  await akit();
  assert.equal(durum.istekler.length, 2, '10 sn dolmadan istek yok');
  zaman.ilerle(1);
  await akit();
  assert.equal(durum.istekler.length, 4, 'iki kamera yenilendi');
  modul.gizlendi();
  zaman.ilerle(60_000);
  await akit();
  assert.equal(durum.istekler.length, 4, 'gizliyken yenileme yok');

  const kapali = kur();
  kapali.modul.ayarla(model({ yenilemeSn: 0 }));
  kapali.modul.gosterildi();
  await akit();
  kapali.zaman.ilerle(600_000);
  await akit();
  assert.equal(kapali.durum.istekler.length, 2, 'yenilemeSn 0: yalnız ilk yükleme ve elle yenile');
});

test('pencere görünür değilken (acikMi false) hiç istek gitmez; görünür olunca bekleyen ilk yükleme yapılır', async () => {
  const { modul, durum } = kur({ acik: false });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  assert.deepEqual(durum.istekler, []);
  durum.acik = true;
  modul.gorunurOldu();
  await akit();
  assert.deepEqual(durum.istekler, ['camera.salon', 'camera.balkon']);
});

test('model kamerayı kaldırırsa o kameranın karesi ve kartı bellekten silinir; model null ise zamanlayıcı durur', async () => {
  const { modul, durum, zaman } = kur();
  modul.ayarla(model({ yenilemeSn: 5 }));
  modul.gosterildi();
  await akit();
  assert.equal(modul.kareSayisi(), 2);
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }], yenilemeSn: 5 }));
  assert.equal(modul.kareSayisi(), 1);
  modul.ayarla(null);
  assert.equal(modul.kareSayisi(), 0);
  assert.deepEqual(modul.parcalar(), []);
  const sayi = durum.istekler.length;
  zaman.ilerle(60_000);
  await akit();
  assert.equal(durum.istekler.length, sayi, 'model kalkınca yenileme zamanlayıcısı durur');
});

test('etiket ve durum metinleri yalnız textContent ile yazılır (HTML etiket metni element oluşturmaz)', async () => {
  const { modul, kartlar } = kur();
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: '<img src=x onerror=alert(1)>', kullanilabilir: true }] }));
  modul.gosterildi();
  await akit();
  const [kart] = kartlar();
  assert.equal(kartDurumu(kart).ad.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(kart.bul((o) => o.etiket === 'img' && o !== kartDurumu(kart).resim).length, 0);
});

test('yaş metni: yeni kare "az önce", eski kare saniye sayısı (önbellekten gelen karenin yaşı korunur)', async () => {
  const { modul, kartlar, zaman } = kur({ yanitlar: { 'camera.salon': { ok: true, veri: PNG_URL, yas: 4000, onbellek: true } } });
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
  modul.gosterildi();
  await akit();
  const o = kartDurumu(kartlar()[0]);
  assert.match(o.yas.textContent, /^yuzey\.kamera\.yas\|\{"sn":4\}$/);
  zaman.ilerle(3000);
  modul.parcalar();
  assert.match(o.yas.textContent, /^yuzey\.kamera\.yas\|\{"sn":7\}$/);
});

test('yaş etiketi: yeni model / çizim gelmese de ~5 sn\'de bir kendiliğinden tazelenir; gizlenince zamanlayıcı kalmaz; ağ isteği yapmaz', async () => {
  const { modul, kartlar, zaman, durum } = kur();
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }], yenilemeSn: 0 }));
  modul.gosterildi();
  await akit();
  const o = kartDurumu(kartlar()[0]);
  assert.equal(o.yas.textContent, 'yuzey.kamera.azOnce');
  const istek = durum.istekler.length;
  zaman.ilerle(4999);
  assert.equal(o.yas.textContent, 'yuzey.kamera.azOnce', '5 sn dolmadan değişmez');
  zaman.ilerle(1);
  assert.match(o.yas.textContent, /^yuzey\.kamera\.yas\|\{"sn":5\}$/, '5 sn sonra etiket yaşı yazar (yeniden çizim olmadan)');
  zaman.ilerle(60_000);
  assert.match(o.yas.textContent, /^yuzey\.kamera\.yas\|\{"sn":65\}$/, 'tik zinciri sürer');
  assert.equal(durum.istekler.length, istek, 'tik ağ isteği yapmaz');
  // gizlenince etiket silinir ve zamanlayıcı kalmaz
  modul.gizlendi();
  assert.equal(o.yas.textContent, '');
  zaman.ilerle(60_000);
  assert.equal(o.yas.textContent, '', 'gizliyken tik yok');
  // yeni gösterimde kare gelince tik yeniden kurulur
  modul.gosterildi();
  await akit();
  zaman.ilerle(10_000);
  assert.match(o.yas.textContent, /^yuzey\.kamera\.yas\|\{"sn":10\}$/);
});

test('yaş etiketi: görüntü yoksa (hata, yükleniyor) zamanlayıcı kurulmaz; model null olunca durur', async () => {
  const hatali = kur({ yanitlar: { 'camera.salon': { ok: false, tur: 'ulasilamiyor' } } });
  hatali.modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
  hatali.modul.gosterildi();
  await akit();
  const o = kartDurumu(hatali.kartlar()[0]);
  hatali.zaman.ilerle(30_000);
  assert.equal(o.yas.textContent, '');
  const { modul, kartlar, zaman } = kur();
  modul.ayarla(model({ liste: [{ id: 'camera.salon', etiket: 'Salon', kullanilabilir: true }] }));
  modul.gosterildi();
  await akit();
  const y = kartDurumu(kartlar()[0]).yas;
  modul.ayarla(null);
  const onceki = y.textContent;
  zaman.ilerle(30_000);
  assert.equal(y.textContent, onceki, 'model kalkınca tik durur');
});

// --- Büyüt ve Şimdi yenile (1.4.0) -----------------------------------------------------------------------------------------

test('Büyüt: görüntü yokken kapalı; görüntü gelince açılır, kartı tam genişliğe açar ve tekrar basınca küçültür; bulanıklık büyütmeyle kalkmaz', async () => {
  const { modul, kartlar } = kur();
  modul.ayarla(model());
  assert.equal(bulSinif(kartlar()[0], 'kamera-buyut')[0].disabled, true, 'görüntü yok: büyütülecek bir şey yok');
  modul.gosterildi();
  await akit();
  const kart = kartlar()[0];
  const resim = kartDurumu(kart).resim;
  const buyut = bulSinif(kart, 'kamera-buyut')[0];
  assert.equal(buyut.disabled, false);
  assert.equal(buyut.textContent, 'yuzey.kamera.buyut');
  assert.equal(buyut.getAttribute('aria-pressed'), 'false');
  assert.match(buyut.getAttribute('aria-label'), /^yuzey\.kamera\.buyutAd\|/);
  assert.equal(kart.className, 'kamera-karo');
  buyut.gonder('click');
  assert.ok(kart.sinifVar('kamera-karo') && kart.sinifVar('kamera-buyuk'));
  assert.equal(buyut.textContent, 'yuzey.kamera.kucult');
  assert.equal(buyut.getAttribute('aria-pressed'), 'true');
  assert.match(buyut.getAttribute('aria-label'), /^yuzey\.kamera\.kucultAd\|/);
  assert.ok(resim.sinifVar('kamera-bulanik'), 'büyütmek görüntüyü açmaz: gizlilik için bulanık kalır');
  buyut.gonder('click');
  assert.ok(!kart.sinifVar('kamera-buyuk'));
  assert.equal(buyut.textContent, 'yuzey.kamera.buyut');
});

test('Büyüt: gizlenme, yeniden gösterim ve hata büyütmeyi sıfırlar; her görüntü normal boyutta başlar', async () => {
  const yanitlar = {};
  const { modul, kartlar } = kur({ yanitlar });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const kart = kartlar()[0];
  const buyut = bulSinif(kart, 'kamera-buyut')[0];
  buyut.gonder('click');
  assert.ok(kart.sinifVar('kamera-buyuk'));
  modul.gosterildi();
  assert.ok(!kart.sinifVar('kamera-buyuk'), 'yeni gösterimde sıfırlanır');
  await akit();
  buyut.gonder('click');
  modul.gizlendi();
  assert.ok(!kart.sinifVar('kamera-buyuk'), 'gizlenince sıfırlanır');
  assert.equal(buyut.disabled, true);
  modul.gosterildi();
  await akit();
  buyut.gonder('click');
  assert.ok(kart.sinifVar('kamera-buyuk'));
  yanitlar['camera.salon'] = { ok: false, tur: 'ha-hatasi' };
  bulSinif(kart, 'kamera-yenile')[0].gonder('click');
  await akit();
  assert.ok(!kart.sinifVar('kamera-buyuk'), 'hata: eski kare gibi büyütme de kalkar');
  assert.equal(buyut.disabled, true);
  buyut.gonder('click');
  assert.ok(!kart.sinifVar('kamera-buyuk'), 'görüntü yokken tıklama etkisizdir');
});

test('Büyüt: klavye satırına ve odak kaydına yalnız görüntü varken girer; yeni bir ağ isteği oluşturmaz', async () => {
  const { modul, durum } = kur();
  modul.ayarla(model());
  modul.parcalar();
  assert.equal(durum.satirlar.at(-1).length, 2, 'görüntü yokken yalnız yenile düğmeleri');
  assert.ok(!durum.odaklar.has('kamera-buyut:camera.salon'));
  modul.gosterildi();
  await akit();
  const istek = durum.istekler.length;
  modul.parcalar();
  assert.ok(durum.odaklar.has('kamera-buyut:camera.salon') && durum.odaklar.has('kamera-buyut:camera.balkon'));
  assert.equal(durum.satirlar.at(-1).length, 6, 'iki kamera x (yenile, görüntü, büyüt)');
  bulSinif(modul.parcalar()[0], 'kamera-buyut')[0].gonder('click');
  await akit();
  assert.equal(durum.istekler.length, istek, 'büyütmek HA’ya ya da ana sürece istek göndermez');
});

test('Şimdi yenile: yalnız o kameranın görüntüsünü ister; yükleniyorken kapalıdır ve ikinci tık ikinci istek üretmez', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const yanitlar = {};
  const { modul, durum, kartlar } = kur({ yanitlar });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const sayi = durum.istekler.length;
  const [salon, balkon] = kartlar().map(kartDurumu);
  assert.equal(salon.yenile.textContent, 'yuzey.kamera.yenile');
  yanitlar['camera.balkon'] = () => bekle;
  balkon.yenile.gonder('click');
  assert.deepEqual(durum.istekler.slice(sayi), ['camera.balkon'], 'yalnız tıklanan kamera');
  assert.equal(balkon.yenile.disabled, true, 'yükleniyor');
  balkon.yenile.gonder('click');
  assert.equal(durum.istekler.length, sayi + 1, 'süren istek varken ikinci istek yok');
  coz({ ok: true, veri: JPEG_URL, yas: 0 });
  await akit();
  assert.equal(balkon.yenile.disabled, false);
  assert.equal(balkon.resim.getAttribute('src'), JPEG_URL);
  assert.equal(salon.resim.getAttribute('src'), PNG_URL, 'diğer kamera etkilenmez');
});

test('Büyüt: yenileme sürerken (eski kare bellekte) büyütme korunur; görüntü gelince kart küçülüp uzamaz, düğme "Küçült" kalır', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const yanitlar = {};
  const { modul, kartlar, zaman } = kur({ yanitlar });
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const kart = kartlar()[0];
  const [salon] = kartlar().map(kartDurumu);
  const buyut = bulSinif(kart, 'kamera-buyut')[0];
  buyut.gonder('click');
  assert.ok(kart.sinifVar('kamera-buyuk'));
  yanitlar['camera.salon'] = () => bekle;
  salon.yenile.gonder('click');
  assert.equal(salon.durum.textContent, 'yuzey.kamera.yukleniyor');
  assert.ok(kart.sinifVar('kamera-buyuk'), 'yenileme sürerken kart tam genişlikte kalır');
  assert.equal(buyut.getAttribute('aria-pressed'), 'true');
  assert.equal(buyut.textContent, 'yuzey.kamera.kucult');
  assert.equal(buyut.disabled, true, 'yüklenirken düğme yine kapalıdır');
  zaman.ilerle(4000);
  coz({ ok: true, veri: JPEG_URL, yas: 0 });
  await akit();
  assert.equal(salon.resim.getAttribute('src'), JPEG_URL);
  assert.ok(kart.sinifVar('kamera-buyuk'), 'yeni kare de büyük gelir');
  assert.equal(buyut.disabled, false);
  assert.equal(buyut.textContent, 'yuzey.kamera.kucult');
});

test('Büyüt: ilk yükleme (eski kare yok) büyütülmüş başlamaz; Büyüt/Küçült panel yüksekliğinin yeniden ölçülmesini ister', async () => {
  const { modul, kartlar, durum } = kur();
  modul.ayarla(model());
  modul.gosterildi();
  await akit();
  const kart = kartlar()[0];
  assert.ok(!kart.sinifVar('kamera-buyuk'));
  const buyut = bulSinif(kart, 'kamera-buyut')[0];
  const onceki = durum.boyutlar;
  buyut.gonder('click');
  assert.equal(durum.boyutlar, onceki + 1, 'büyütünce yükseklik yeniden ölçülür');
  buyut.gonder('click');
  assert.equal(durum.boyutlar, onceki + 2, 'küçültünce de');
  modul.gizlendi();
  buyut.gonder('click');
  assert.equal(durum.boyutlar, onceki + 2, 'görüntü yokken tıklama etkisizdir: ölçüm istenmez');
});
