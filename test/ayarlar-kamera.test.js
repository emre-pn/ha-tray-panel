'use strict';

/**
 * Ayarlar sayfasının "Kamera anlık görüntüsü" bölümü (src/ayarlar.html #bolumKamera + src/ayarlar.js kamera satırları): o-48.
 * Sahte DOM ve sahte ana süreç köprüsü (test/ayarlar-sahte.js); gerçek pencere ve Home Assistant YOK.
 * Sınananlar: HTML yapısı, varsayılan KAPALI durum (hiçbir kamera seçili değil), adaylar yalnız cihazlar:getir yanıtındaki kameraAdaylari'ndan,
 * ekle/kaldır ve en çok 8, kayıt yükü, kirli durum, yüklenemeyen listede kayıtlı seçimin korunması, sözlük anahtarlarının kullanımı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const AYARLAR = require('../src/lib/ceviri/ayarlar');
const { HTML, BETIK, AYAR, CIHAZLAR, akit, duzles, acilmisSayfa } = require('./ayarlar-sahte');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const degerler = (kimlik, sayfa) => sayfa.oge(kimlik).children.map((o) => o.value);
const satirlar = (sayfa) => sayfa.oge('kameraIzinleriListesi').children.filter((c) => c.className === 'bilgi-satir');
const satirAdi = (satir) => satir.bul((o) => o.className === 'bilgi-satir-ad')[0].textContent;
const kaldirDugmesi = (satir) => satir.bul((o) => o.etiket === 'button')[0];

function ekle(sayfa, kimlik) {
  sayfa.oge('kameraIzinleriEkle').value = kimlik;
  sayfa.oge('kameraIzinleriEkle').dispatchEvent({ type: 'change' });
  sayfa.oge('btnKameraIzinleriEkle').dispatchEvent({ type: 'click' });
}

const kamera = (kimlik, ad) => ({ entity_id: kimlik, ad });
const KAMERALI = {
  ...CIHAZLAR,
  kameraAdaylari: [kamera('camera.balkon', 'Balkon'), kamera('camera.salon', 'Salon'), kamera('camera.bebek', 'Bebek odası')],
};

test('kamera bölümü: katlanır bölüm, form alanları, gizlilik notu ve sabit seçenekler ayar tablosuyla uyumlu', () => {
  assert.match(HTML, /<details class="bolum" id="bolumKamera">/);
  const bolum = HTML.slice(HTML.indexOf('id="bolumKamera"'), HTML.indexOf('id="bolumBildirimler"'));
  for (const kimlik of ['kameraIzinleriListesi', 'kameraIzinleriEkle', 'btnKameraIzinleriEkle', 'kameraBulanik', 'kameraYenilemeSn', 'kameraYenilemeIpucu']) {
    assert.match(bolum, new RegExp(`id="${kimlik}"`), `#${kimlik}`);
  }
  assert.match(bolum, /data-i18n="ayar\.kamera\.gizlilik"/, 'gizlilik notu görünür');
  const degerlerRe = [...bolum.matchAll(/<select id="kameraYenilemeSn"[\s\S]*?<\/select>/g)][0][0];
  assert.deepEqual([...degerlerRe.matchAll(/value="([^"]*)"/g)].map((m) => m[1]), ['0', '5', '10', '30', '60']);
  assert.match(bolum, /<label for="kameraIzinleriEkle" id="kameraIzinleriEtiket"/);
  assert.match(bolum, /id="btnKameraIzinleriEkle"[^>]*aria-labelledby="btnKameraIzinleriEkle kameraIzinleriEtiket"/);
});

test('kamera bölümü: betik yalnız textContent ile yazar; sözlükteki her ayar.kamera.* anahtarı HTML ya da betikte kullanılır', () => {
  assert.doesNotMatch(BETIK, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  for (const anahtar of Object.keys(AYARLAR.tr).filter((k) => k.startsWith('ayar.kamera.'))) {
    assert.ok(HTML.includes(`"${anahtar}"`) || BETIK.includes(`'${anahtar}'`), `${anahtar} kullanılmıyor`);
  }
  assert.ok(Object.keys(AYARLAR.tr).filter((k) => k.startsWith('ayar.kamera.')).length >= 10);
});

test('açılış: kamera ayarı yoksa HİÇBİR kamera seçili değildir, görüntü bulanık, otomatik yenileme kapalı; kirli değil, kayıt yükü bunları taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: KAMERALI });
  assert.equal(satirlar(sayfa).length, 0);
  assert.match(sayfa.oge('kameraIzinleriListesi').textContent, /Henüz seçilmedi/);
  assert.equal(sayfa.oge('kameraBulanik').checked, true);
  assert.equal(sayfa.oge('kameraYenilemeSn').value, '0');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual([yuk.kameraIzinleri, yuk.kameraBulanik, yuk.kameraYenilemeSn], [[], true, 0]);
});

test('aday listesi: yalnız cihazlar:getir yanıtındaki kameraAdaylari; başka alandaki varlıklar (kilit, kapak, ışık) kamera olarak sunulmaz', async () => {
  const karisik = {
    ...KAMERALI,
    cihazlar: [...CIHAZLAR.cihazlar, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı', alan: 'lock', alanEtiketi: 'Kilit', durum: 'kilitli', onayZorunlu: true, varsayilanOnay: true }],
  };
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: karisik });
  assert.deepEqual(degerler('kameraIzinleriEkle', sayfa), ['', 'camera.balkon', 'camera.salon', 'camera.bebek']);
  assert.ok(!degerler('kameraIzinleriEkle', sayfa).includes('lock.on_kapi'));
  assert.ok(!degerler('kameraIzinleriEkle', sayfa).includes('light.salon_lambasi'));
});

test('kameraAdaylari yoksa (eski ana süreç / kamera yok) seçim kutusu kapalıdır, sayfa çalışır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('kameraIzinleriEkle').disabled, true);
  assert.equal(sayfa.oge('btnKameraIzinleriEkle').disabled, true);
  assert.equal(satirlar(sayfa).length, 0);
});

test('ekle ve kaldır: sıra korunur, kirli durum doğru, kayıt yükü kimlik listesidir, kayıttan sonra temiz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: KAMERALI });
  assert.equal(sayfa.oge('btnKameraIzinleriEkle').disabled, true, 'seçim yokken düğme kapalı');
  ekle(sayfa, 'camera.salon');
  ekle(sayfa, 'camera.bebek');
  assert.deepEqual(satirlar(sayfa).map(satirAdi), ['Salon', 'Bebek odası']);
  assert.deepEqual(degerler('kameraIzinleriEkle', sayfa), ['', 'camera.balkon'], 'eklenenler kutudan düşer');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.deepEqual(sonKayitYuku(sayfa).kameraIzinleri, ['camera.salon', 'camera.bebek']);
  assert.equal(kirliMi(sayfa), false);
  kaldirDugmesi(satirlar(sayfa)[0]).dispatchEvent({ type: 'click' });
  assert.deepEqual(satirlar(sayfa).map(satirAdi), ['Bebek odası']);
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.deepEqual(sonKayitYuku(sayfa).kameraIzinleri, ['camera.bebek']);
});

test('en çok 8 kamera: sınırda ekleme kutusu kapanır', async () => {
  const adaylar = Array.from({ length: 10 }, (_, i) => kamera(`camera.k${i}`, `K ${i}`));
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: { ...CIHAZLAR, kameraAdaylari: adaylar } });
  for (let i = 0; i < 8; i += 1) ekle(sayfa, `camera.k${i}`);
  assert.equal(satirlar(sayfa).length, 8);
  assert.equal(sayfa.oge('kameraIzinleriEkle').disabled, true);
  assert.equal(sayfa.oge('btnKameraIzinleriEkle').disabled, true);
  ekle(sayfa, 'camera.k8');
  assert.equal(satirlar(sayfa).length, 8, 'dokuzuncu eklenmez');
});

test('kayıtlı seçimler: aday listesi yüklenemese de kayıtlı kameralar görünür, kaydedince silinmez, ad bilinmiyorsa kimlik yazılır', async () => {
  const ayar = { ...AYAR, kameraIzinleri: ['camera.salon', 'camera.bebek'], kameraBulanik: false, kameraYenilemeSn: 30 };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: { ok: false, hata: 'bağlanılamadı' } });
  assert.deepEqual(satirlar(sayfa).map(satirAdi), ['camera.salon', 'camera.bebek']);
  assert.equal(sayfa.oge('kameraBulanik').checked, false);
  assert.equal(sayfa.oge('kameraYenilemeSn').value, '30');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual([yuk.kameraIzinleri, yuk.kameraBulanik, yuk.kameraYenilemeSn], [['camera.salon', 'camera.bebek'], false, 30]);
});

test('bulanıklık ve yenileme değişikliği kirli yapar ve sayı olarak kaydedilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: KAMERALI });
  sayfa.oge('kameraBulanik').checked = false;
  sayfa.oge('kameraBulanik').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('kameraYenilemeSn').value = '10';
  sayfa.oge('kameraYenilemeSn').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.equal(yuk.kameraBulanik, false);
  assert.strictEqual(yuk.kameraYenilemeSn, 10);
  assert.equal(kirliMi(sayfa), false);
});

test('ayar dosyasındaki bozuk kamera değerleri ekranda güvenli varsayılana düşer', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, kameraIzinleri: 'camera.salon', kameraBulanik: undefined, kameraYenilemeSn: 7 }, cihazlar: KAMERALI });
  assert.equal(satirlar(sayfa).length, 0);
  assert.equal(sayfa.oge('kameraBulanik').checked, true);
  assert.equal(sayfa.oge('kameraYenilemeSn').value, '0');
});
