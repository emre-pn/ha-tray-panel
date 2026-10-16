'use strict';

// 1.4.0 (o-27): tepsi rozeti ana süreç yapıştırıcısı. Electron nesneleri (nativeImage, screen, Tray) sahtedir; gerçek tepsi/pencere yok.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROZET_MODLARI, tepsiRozetiOlustur } = require('../src/tepsi-rozeti');
const { simgePng } = require('../src/lib/tepsi-simgesi');

const NORMAL = 'assets/ikon.ico';
const SOLUK = 'assets/ikon-soluk.ico';

function kur({ ayar = { tepsiRozeti: 'isik', tepsiRozetSensoru: '' }, acikIsik = 3, soluk = false, durumlar = {}, olcek = 1, imge = null, tepsiVar = true } = {}) {
  const o = {
    an: 0,
    ayar,
    acikIsik,
    soluk,
    durumlar,
    olcek,
    resimler: [],
    tepsiResimleri: [],
    gunlukler: [],
    zamanlayicilar: new Map(),
    sonKimlik: 0,
    tepsiVar,
    imge, // null: varsayılan sahte; işlev: createFromBuffer yerine
  };
  const zaman = {
    setTimeout(fn, ms) {
      const kimlik = ++o.sonKimlik;
      o.zamanlayicilar.set(kimlik, { fn, ms });
      return kimlik;
    },
    clearTimeout(kimlik) {
      o.zamanlayicilar.delete(kimlik);
    },
  };
  o.tepsi = { setImage: (resim) => o.tepsiResimleri.push(resim) };
  o.rozet = tepsiRozetiOlustur({
    nativeImage: {
      createFromBuffer: (tampon, secenek) => {
        if (o.imge) return o.imge(tampon, secenek);
        const sahte = { isEmpty: () => false, tampon, secenek };
        o.resimler.push(sahte);
        return sahte;
      },
    },
    screen: { getPrimaryDisplay: () => ({ scaleFactor: o.olcek }) },
    tepsiAl: () => (o.tepsiVar ? o.tepsi : null),
    ayarlarAl: () => o.ayar,
    durumAl: (kimlik) => o.durumlar[kimlik],
    acikIsikAl: () => o.acikIsik,
    solukAl: () => o.soluk,
    normalIkon: NORMAL,
    solukIkon: SOLUK,
    gunluk: (m) => o.gunlukler.push(m),
    simdi: () => o.an,
    zaman,
    aralikMs: 1000,
  });
  o.tetikle = () => {
    const [kimlik, z] = [...o.zamanlayicilar.entries()][0];
    o.zamanlayicilar.delete(kimlik);
    z.fn();
  };
  return o;
}

const sensor = (kimlik, durum, nitelik = {}) => ({ entity_id: kimlik, state: durum, attributes: nitelik });

test('ROZET_MODLARI: kapali, isik, sensor', () => {
  assert.deepEqual([...ROZET_MODLARI], ['kapali', 'isik', 'sensor']);
});

test('kapali (varsayılan): simge hiç değişmez, hiçbir resim üretilmez', () => {
  const o = kur({ ayar: { tepsiRozeti: 'kapali' }, acikIsik: 5 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, []);
  assert.deepEqual(o.resimler, []);
  const bilinmeyen = kur({ ayar: { tepsiRozeti: 'garip' }, acikIsik: 5 });
  bilinmeyen.rozet.baslangic();
  bilinmeyen.an = 5000;
  bilinmeyen.rozet.guncelle();
  assert.deepEqual(bilinmeyen.tepsiResimleri, [], 'bilinmeyen mod kapalı sayılır');
  const ayarsiz = kur({ ayar: null });
  ayarsiz.rozet.baslangic();
  ayarsiz.an = 5000;
  ayarsiz.rozet.guncelle();
  assert.deepEqual(ayarsiz.tepsiResimleri, []);
});

test('isik: açık ışık sayısı rozetli PNG olarak yazılır; PNG simgePng ile aynıdır, ölçek 1x', () => {
  const o = kur({ acikIsik: 3 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1);
  assert.equal(o.resimler.length, 1);
  assert.ok(o.resimler[0].tampon.equals(simgePng({ boyut: 16, rozet: { tur: 'isik', metin: '3' } })));
  assert.deepEqual(o.resimler[0].secenek, { scaleFactor: 1 });
  assert.equal(o.tepsiResimleri[0], o.resimler[0]);
});

test('isik: sayı 0 ise rozet yok (simge dosya simgesinde kalır); değişmeyen simge yeniden yazılmaz', () => {
  const o = kur({ acikIsik: 0 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, []);
  o.acikIsik = 2;
  o.rozet.guncelle();
  o.rozet.guncelle();
  o.an = 9000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1, 'aynı sayı tekrar yazılmaz');
  o.acikIsik = 0;
  o.an = 20000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri.slice(1), [NORMAL], 'sayı 0\'a inince dosya simgesine dönülür');
});

test('simge saniyede en çok bir kez değişir; aradaki değişimlerin sonuncusu pencere sonunda uygulanır', () => {
  const o = kur({ acikIsik: 1 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle(); // hemen
  o.an = 5100;
  o.acikIsik = 2;
  o.rozet.guncelle();
  o.an = 5300;
  o.acikIsik = 3;
  o.rozet.guncelle();
  o.an = 5500;
  o.acikIsik = 4;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1);
  assert.equal(o.zamanlayicilar.size, 1);
  o.an = 6000;
  o.tetikle();
  assert.equal(o.tepsiResimleri.length, 2);
  assert.ok(o.resimler[1].tampon.equals(simgePng({ boyut: 16, rozet: { tur: 'isik', metin: '4' } })), 'son değer');
});

test('bağlantı yokken (soluk) rozet çizilmez, soluk dosya simgesi beklemeden yazılır; bağlantı gelince rozet geri gelir', () => {
  const o = kur({ acikIsik: 3 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1);
  o.an = 5100; // saniye dolmadı
  o.soluk = true;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.at(-1), SOLUK, 'bağlantı kopması beklemez');
  assert.equal(o.resimler.length, 1, 'soluk simgede rozetli resim üretilmez');
  o.an = 5200;
  o.soluk = false;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 3);
  assert.ok(o.tepsiResimleri.at(-1).tampon, 'bağlantı dönünce rozetli simge hemen');
});

test('bağlantı yokken başlangıç soluk simgedir; soluk simgede ışık sayısı değişse de bir şey yazılmaz', () => {
  const o = kur({ acikIsik: 5, soluk: true });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  o.acikIsik = 6;
  o.an = 9000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, []);
  assert.deepEqual(o.resimler, []);
});

test('ekran ölçeği simge boyutunu belirler (16 * ölçek)', () => {
  for (const [olcek, boyut] of [[1.25, 20], [1.5, 24], [2, 32]]) {
    const o = kur({ olcek });
    o.rozet.baslangic();
    o.an = 5000;
    o.rozet.guncelle();
    assert.ok(o.resimler[0].tampon.equals(simgePng({ boyut, rozet: { tur: 'isik', metin: '3' } })), `${olcek} -> ${boyut}`);
  }
});

test('sensor: seçilen sensörün değeri rozet olur; durum değişince güncellenir', () => {
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' }, durumlar: { 'sensor.salon_sicaklik': sensor('sensor.salon_sicaklik', '21', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' }) } });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.ok(o.resimler[0].tampon.equals(simgePng({ boyut: 16, rozet: { tur: 'sensor', metin: '21' } })));
  o.durumlar['sensor.salon_sicaklik'] = sensor('sensor.salon_sicaklik', '9.5', { friendly_name: 'Salon sıcaklığı' });
  o.an = 8000;
  o.rozet.guncelle();
  assert.ok(o.resimler[1].tampon.equals(simgePng({ boyut: 16, rozet: { tur: 'sensor', metin: '9.5' } })));
});

test('sensor: durum yok, ulaşılamıyor ya da sayı değilse rozet yok (dosya simgesi)', () => {
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' }, durumlar: {} });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, []);
  o.durumlar['sensor.salon_sicaklik'] = sensor('sensor.salon_sicaklik', '20');
  o.an = 8000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1);
  o.durumlar['sensor.salon_sicaklik'] = sensor('sensor.salon_sicaklik', 'unavailable');
  o.an = 12000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.at(-1), NORMAL);
  const seciliDegil = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: '' }, durumlar: { 'sensor.x': sensor('sensor.x', '5') } });
  seciliDegil.rozet.baslangic();
  seciliDegil.an = 5000;
  seciliDegil.rozet.guncelle();
  assert.deepEqual(seciliDegil.tepsiResimleri, [], 'sensör seçilmemiş');
});

test('KAPI KURALI: kapı/kilit/alarm sözcüklü ya da sensör olmayan varlık rozet olarak seçilse de çizilmez, ipucuna girmez', () => {
  const seciliSensorler = [
    ['sensor.giris_kapisi', sensor('sensor.giris_kapisi', '21', { friendly_name: 'Giriş' })],
    ['sensor.sicaklik', sensor('sensor.sicaklik', '21', { friendly_name: 'Ön kapı sıcaklığı' })],
    ['sensor.sicaklik', sensor('sensor.sicaklik', '21', { friendly_name: 'Garage door' })],
    ['sensor.sicaklik', sensor('sensor.sicaklik', '21', { device_class: 'door' })],
    ['lock.on_kapi', sensor('lock.on_kapi', '5')],
    ['binary_sensor.kapi', sensor('binary_sensor.kapi', 'on')],
    ['alarm_control_panel.ev', sensor('alarm_control_panel.ev', '1')],
    ['cover.garaj', sensor('cover.garaj', '50')],
    ['light.salon', sensor('light.salon', '5')],
  ];
  for (const [kimlik, varlik] of seciliSensorler) {
    const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: kimlik }, durumlar: { [kimlik]: varlik } });
    o.rozet.baslangic();
    o.an = 5000;
    o.rozet.guncelle();
    assert.deepEqual(o.tepsiResimleri, [], `${kimlik}: rozet yok`);
    assert.equal(o.rozet.ipucuEki(), null, `${kimlik}: ipucu eki yok`);
  }
});

test('ipucuEki: yalnız sensor modunda, bağlantı varken ve rozeti olan sensörde "Ad: değer birim"', () => {
  const durumlar = { 'sensor.salon': sensor('sensor.salon', '21.5', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' }) };
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon' }, durumlar });
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21.5 °C');
  o.soluk = true;
  assert.equal(o.rozet.ipucuEki(), null, 'bağlantı yokken değer güvenilmez');
  o.soluk = false;
  o.ayar = { tepsiRozeti: 'isik', tepsiRozetSensoru: 'sensor.salon' };
  assert.equal(o.rozet.ipucuEki(), null);
  o.ayar = { tepsiRozeti: 'kapali', tepsiRozetSensoru: 'sensor.salon' };
  assert.equal(o.rozet.ipucuEki(), null);
  o.ayar = { tepsiRozeti: 'sensor', tepsiRozetSensoru: '' };
  assert.equal(o.rozet.ipucuEki(), null);
});

test('izlenenKimlik: yalnız sensor modunda seçili sensör (canlı abonelik/REST yenilemesine eklenir)', () => {
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon' } });
  assert.equal(o.rozet.izlenenKimlik(), 'sensor.salon');
  o.ayar = { tepsiRozeti: 'isik', tepsiRozetSensoru: 'sensor.salon' };
  assert.equal(o.rozet.izlenenKimlik(), null);
  o.ayar = { tepsiRozeti: 'kapali', tepsiRozetSensoru: 'sensor.salon' };
  assert.equal(o.rozet.izlenenKimlik(), null);
  for (const bos of ['', null, undefined, 5]) {
    o.ayar = { tepsiRozeti: 'sensor', tepsiRozetSensoru: bos };
    assert.equal(o.rozet.izlenenKimlik(), null, String(bos));
  }
});

test('mod rozetten kapalıya dönünce dosya simgesine geri dönülür', () => {
  const o = kur({ acikIsik: 3 });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.length, 1);
  o.ayar = { tepsiRozeti: 'kapali', tepsiRozetSensoru: '' };
  o.an = 9000;
  o.rozet.guncelle();
  assert.equal(o.tepsiResimleri.at(-1), NORMAL);
});

test('resim oluşturulamazsa dosya simgesine düşülür; hata günlüğe bir kez, değer içermeden yazılır', () => {
  const o = kur({ acikIsik: 3, imge: () => { throw new Error('png bozuk sensor.gizli_kimlik'); } });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, [NORMAL]);
  o.acikIsik = 4;
  o.an = 9000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, [NORMAL, NORMAL]);
  assert.equal(o.gunlukler.length, 1, 'günlük şişmez');
  assert.doesNotMatch(o.gunlukler[0], /gizli|sensor\./);
});

test('boş resim dönerse de dosya simgesine düşülür', () => {
  const o = kur({ acikIsik: 3, imge: () => ({ isEmpty: () => true }) });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, [NORMAL]);
  assert.equal(o.gunlukler.length, 1);
});

test('Tray yoksa (kapanış) güncelleme sessizce atlanır; temizle bekleyen zamanlayıcıyı siler', () => {
  const o = kur({ acikIsik: 1, tepsiVar: false });
  o.rozet.baslangic();
  o.an = 5000;
  assert.doesNotThrow(() => o.rozet.guncelle());
  assert.deepEqual(o.tepsiResimleri, []);
  const p = kur({ acikIsik: 1 });
  p.rozet.baslangic();
  p.an = 5000;
  p.rozet.guncelle();
  p.an = 5100;
  p.acikIsik = 2;
  p.rozet.guncelle();
  assert.equal(p.zamanlayicilar.size, 1);
  p.rozet.temizle();
  assert.equal(p.zamanlayicilar.size, 0);
});
