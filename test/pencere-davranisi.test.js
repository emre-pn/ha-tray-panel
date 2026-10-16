'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ODAK_KAYBI_GECIKME_MS,
  TEPSI_YARIS_MS,
  tiklamaKarari,
  odakKaybiGizlensinMi,
} = require('../src/lib/pencere-davranisi');

const simdi = 1_000_000;
const tik = (ek) => tiklamaKarari({ kaynak: 'tepsi', gorunur: false, odakta: false, bekleyenGizleme: false, sonGizlemeMs: 0, simdi, ...ek });

test('odak kaybı gecikmesi 150-200 ms aralığında (kart)', () => {
  assert.ok(ODAK_KAYBI_GECIKME_MS >= 150 && ODAK_KAYBI_GECIKME_MS <= 200);
});

test('tepsi: pencere odaktaysa kapat', () => {
  assert.equal(tik({ gorunur: true, odakta: true }), 'kapat');
});

test('tepsi: görünür ama arkada ve odaksız -> ac (öne getir), kısayolla tutarlı', () => {
  assert.equal(tik({ gorunur: true, odakta: false }), 'ac');
  assert.equal(tiklamaKarari({ kaynak: 'kisayol', gorunur: true, odakta: false, bekleyenGizleme: false, sonGizlemeMs: 0, simdi }), 'ac');
});

test('tepsi: gizli pencere -> ac', () => {
  assert.equal(tik({ gorunur: false }), 'ac');
});

test('tepsi: odak kaybı gizlemesi bekliyorken (tıklama odağı aldığı için) kapat', () => {
  assert.equal(tik({ gorunur: true, odakta: false, bekleyenGizleme: true }), 'kapat');
});

test('tepsi: az önce otomatik gizlendiyse kapat (yeniden açılıp titremesin)', () => {
  assert.equal(tik({ gorunur: false, sonGizlemeMs: simdi - 100 }), 'kapat');
  assert.equal(tik({ gorunur: false, sonGizlemeMs: simdi - (TEPSI_YARIS_MS - 1) }), 'kapat');
  assert.equal(tik({ gorunur: false, sonGizlemeMs: simdi - TEPSI_YARIS_MS }), 'ac');
  assert.equal(tik({ gorunur: false, sonGizlemeMs: simdi - 5000 }), 'ac');
  assert.equal(tik({ gorunur: false, sonGizlemeMs: 0 }), 'ac'); // hiç otomatik gizlenmedi
});

test('tepsi: "dışarı tıklayınca gizle" KAPALIYKEN (zamanlayıcı da otomatik gizleme de yok) az önceki odak kaybı "odaktaydı" demektir', () => {
  // Tepsi tıklaması odağı görev çubuğuna aldığı için odakta=false gelir; tek iz sonOdakKaybiMs'dir.
  const kapali = (ek) => tik({ gorunur: true, odakta: false, bekleyenGizleme: false, sonGizlemeMs: 0, ...ek });
  assert.equal(kapali({ sonOdakKaybiMs: simdi - 100 }), 'kapat');
  assert.equal(kapali({ sonOdakKaybiMs: simdi - (TEPSI_YARIS_MS - 1) }), 'kapat');
  assert.equal(kapali({ sonOdakKaybiMs: simdi - TEPSI_YARIS_MS }), 'ac'); // uzun süre önce odağı kaybetti: öne getir
  assert.equal(kapali({ sonOdakKaybiMs: simdi - 5000 }), 'ac');
  assert.equal(kapali({ sonOdakKaybiMs: 0 }), 'ac'); // odağı hiç kaybetmedi / yeniden odak aldı
  assert.equal(kapali({}), 'ac');
});

test('tepsi: pencere görünmüyorsa odak kaybı işareti yok sayılır (gizlemenin kendi blur olayı yeniden açmayı engellemez)', () => {
  assert.equal(tik({ gorunur: false, odakta: false, sonOdakKaybiMs: simdi - 10 }), 'ac');
});

test('kısayol: blur zamanlayıcısı, yakın gizleme ve odak kaybı bilgisi dikkate alınmaz', () => {
  const k = (ek) => tiklamaKarari({ kaynak: 'kisayol', gorunur: false, odakta: false, bekleyenGizleme: false, sonGizlemeMs: 0, simdi, ...ek });
  assert.equal(k({ bekleyenGizleme: true }), 'ac');
  assert.equal(k({ sonGizlemeMs: simdi - 50 }), 'ac');
  assert.equal(k({ gorunur: true, odakta: false, sonOdakKaybiMs: simdi - 50 }), 'ac');
  assert.equal(k({ gorunur: true, odakta: true }), 'kapat');
});

test('odaktaki pencere "görünür değil" ise odakta sayılmaz', () => {
  assert.equal(tik({ gorunur: false, odakta: true }), 'ac');
});

const hepsiUygun = {
  ayarAcik: true,
  gorunur: true,
  simgeDurumunda: false,
  tamEkran: false,
  anaPencereOdakta: false,
  ayarlarOdakta: false,
  altPencereOdakta: false,
  devToolsOdakta: false,
};

test('odakKaybiGizlensinMi: başka yere tıklandıysa gizlenir', () => {
  assert.equal(odakKaybiGizlensinMi(hepsiUygun), true);
});

test('odakKaybiGizlensinMi: ayar kapalı, görünmüyor, simge durumu, tam ekran -> gizlenmez', () => {
  for (const ek of [{ ayarAcik: false }, { gorunur: false }, { simgeDurumunda: true }, { tamEkran: true }]) {
    assert.equal(odakKaybiGizlensinMi({ ...hepsiUygun, ...ek }), false, JSON.stringify(ek));
  }
});

test('odakKaybiGizlensinMi: yeniden odak, Ayarlar, HA alt penceresi ya da geliştirici araçları odaktaysa gizlenmez', () => {
  for (const ek of [{ anaPencereOdakta: true }, { ayarlarOdakta: true }, { altPencereOdakta: true }, { devToolsOdakta: true }]) {
    assert.equal(odakKaybiGizlensinMi({ ...hepsiUygun, ...ek }), false, JSON.stringify(ek));
  }
});

test('odakKaybiGizlensinMi: eylem onay penceresi açıkken gizlenmez (hata-04)', () => {
  assert.equal(odakKaybiGizlensinMi({ ...hepsiUygun, onayAcik: true }), false);
  assert.equal(odakKaybiGizlensinMi({ ...hepsiUygun, onayAcik: false }), true);
});
