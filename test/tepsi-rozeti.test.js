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
    acikIsikCagri: 0, // acikIsikAl kaç kez çağrıldı (tüm favorilerden karo kurar: pahalı)
    soluk,
    durumlar,
    olcek,
    resimler: [],
    tepsiResimleri: [],
    gunlukler: [],
    zamanlayicilar: new Map(),
    sonKimlik: 0,
    tepsiVar,
    dil: 'tr', // dilAl'ın döndürdüğü etkin arayüz dili
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
    acikIsikAl: () => {
      o.acikIsikCagri += 1;
      return o.acikIsik;
    },
    solukAl: () => o.soluk,
    dilAl: () => o.dil,
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

test('açık ışık sayısı (tüm favorilerden karo kurar) yalnız isik modunda hesaplanır; kapali ve sensor modunda hiç çağrılmaz', () => {
  const kapali = kur({ ayar: { tepsiRozeti: 'kapali' }, acikIsik: 5 });
  kapali.rozet.baslangic();
  kapali.an = 5000;
  kapali.rozet.guncelle();
  assert.equal(kapali.acikIsikCagri, 0, 'varsayılan kapali modda sonuç çöpe gidecekken hesaplanmaz');
  const sensor = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.sicaklik' }, acikIsik: 5, durumlar: { 'sensor.sicaklik': { entity_id: 'sensor.sicaklik', state: '21.5', attributes: { friendly_name: 'Salon', unit_of_measurement: '°C' } } } });
  sensor.rozet.baslangic();
  sensor.an = 5000;
  sensor.rozet.guncelle();
  assert.equal(sensor.acikIsikCagri, 0);
  const isik = kur({ acikIsik: 3 });
  isik.rozet.baslangic();
  isik.an = 5000;
  isik.rozet.guncelle();
  assert.ok(isik.acikIsikCagri > 0, 'isik modunda sayı hâlâ okunur');
  assert.equal(isik.tepsiResimleri.length, 1, 've rozet çizilir');
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

test('ipucuEki: float artığı olan sensör hassasiyetle yazılır; ipucu kısa kalır, diğer sensörler ve dil ayracı korunur; geçersiz dil tr sayılır', () => {
  const durumlar = {
    'sensor.salon': sensor('sensor.salon', '23.600000381469727', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C', suggested_display_precision: 1 }),
    'sensor.mutfak': sensor('sensor.mutfak', '19.5', { friendly_name: 'Mutfak sıcaklığı', unit_of_measurement: '°C' }),
    'sensor.nem': sensor('sensor.nem', '45', { friendly_name: 'Nem', unit_of_measurement: '%' }),
  };
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon', tepsiRozetSensorleri: ['sensor.mutfak', 'sensor.nem'] }, durumlar });
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 23,6 °C · Mutfak sıcaklığı: 19,5 °C · Nem: %45');
  o.dil = 'en';
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 23.6 °C · Mutfak sıcaklığı: 19.5 °C · Nem: 45%');
  o.dil = 'fr';
  assert.match(o.rozet.ipucuEki(), /^Salon sıcaklığı: 23,6 °C · /);
  assert.ok(o.rozet.ipucuEki().length < 120, 'tepsi ipucu 120 karakter sınırında diğer sensörleri kesmez');
  o.dil = 5; // geçersiz dil tr sayılır
  assert.match(o.rozet.ipucuEki(), /^Salon sıcaklığı: 23,6 °C · Mutfak sıcaklığı: 19,5 °C/);
});

test('ipucuEki: yalnız sensor modunda, bağlantı varken ve rozeti olan sensörde "Ad: değer birim"', () => {
  const durumlar = { 'sensor.salon': sensor('sensor.salon', '21.5', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' }) };
  const o = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon' }, durumlar });
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21,5 °C', 'etkin dil tr: virgül');
  o.dil = 'en';
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21.5 °C', 'dil değişince ayraç değişir');
  o.dil = 'tr';
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

// --- birden çok rozet sensörü (1.4.0) ----------------------------------------------------------------------------------------

const { EN_COK_ROZET_SENSORU, DONUS_MS } = require('../src/tepsi-rozeti');

const COKLU_DURUMLAR = {
  'sensor.salon': sensor('sensor.salon', '21', { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C' }),
  'sensor.pil': sensor('sensor.pil', '80', { friendly_name: 'Telefon pili', unit_of_measurement: '%' }),
  'sensor.nem': sensor('sensor.nem', '45', { friendly_name: 'Nem', unit_of_measurement: '%' }),
};
const COKLU_AYAR = { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon', tepsiRozetSensorleri: ['sensor.pil', 'sensor.nem'] };
const donusZamanlayicisi = (o) => [...o.zamanlayicilar.entries()].filter(([, z]) => z.ms === DONUS_MS);
const donusTetikle = (o) => {
  const [[kimlik, z]] = donusZamanlayicisi(o);
  o.zamanlayicilar.delete(kimlik);
  z.fn();
};
const metinleri = (o) => o.resimler.map((r) => r.tampon);
const rozetPng = (metin) => simgePng({ boyut: 16, rozet: { tur: 'sensor', metin } });

test('çoklu sensör: sabitler; rozette en çok 3 sensör, dönüş aralığı 5 sn', () => {
  assert.equal(EN_COK_ROZET_SENSORU, 3);
  assert.equal(DONUS_MS, 5000);
});

test('çoklu sensör: geçerli sensörler sırayla gösterilir (ana, ikinci, üçüncü, yine ana); her tık bir sonrakini çizer', () => {
  const o = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.ok(metinleri(o)[0].equals(rozetPng('21')), 'ana sensör önce');
  assert.equal(donusZamanlayicisi(o).length, 1, 'birden çok geçerli sensör: dönüş zamanlayıcısı kurulur');
  o.an = 10000;
  donusTetikle(o);
  assert.ok(metinleri(o)[1].equals(rozetPng('80')));
  o.an = 15000;
  donusTetikle(o);
  assert.ok(metinleri(o)[2].equals(rozetPng('45')));
  o.an = 20000;
  donusTetikle(o);
  assert.ok(metinleri(o)[3].equals(rozetPng('21')), 'başa döner');
  assert.equal(donusZamanlayicisi(o).length, 1, 'zamanlayıcı yeniden kuruldu');
});

test('çoklu sensör: rozeti çizilemeyen sensör (sayı değil, durum yok, kapı kuralı) atlanır; tek geçerli sensör kalırsa dönüş durur', () => {
  const durumlar = {
    ...COKLU_DURUMLAR,
    'sensor.pil': sensor('sensor.pil', 'unavailable', { friendly_name: 'Telefon pili' }),
  };
  const o = kur({ ayar: COKLU_AYAR, durumlar });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.ok(metinleri(o)[0].equals(rozetPng('21')));
  o.an = 10000;
  donusTetikle(o);
  assert.ok(metinleri(o)[1].equals(rozetPng('45')), 'ulaşılamayan sensör atlandı');
  o.an = 15000;
  donusTetikle(o);
  assert.ok(metinleri(o)[2].equals(rozetPng('21')));

  // yalnız bir geçerli sensör: dönüş yok
  o.durumlar['sensor.nem'] = sensor('sensor.nem', 'unknown', { friendly_name: 'Nem' });
  o.an = 20000;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 0, 'tek geçerli sensör: dönüş zamanlayıcısı yok');

  // kapı sözcüklü ek sensör kapı kuralına takılır
  const kapi = kur({
    ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon', tepsiRozetSensorleri: ['sensor.kapi_sicakligi'] },
    durumlar: { 'sensor.salon': COKLU_DURUMLAR['sensor.salon'], 'sensor.kapi_sicakligi': sensor('sensor.kapi_sicakligi', '18', { friendly_name: 'Ön kapı sıcaklığı' }) },
  });
  kapi.rozet.baslangic();
  kapi.an = 5000;
  kapi.rozet.guncelle();
  assert.equal(donusZamanlayicisi(kapi).length, 0, 'kapı kuralına takılan sensör sayılmaz');
  assert.equal(kapi.rozet.ipucuEki(), 'Salon sıcaklığı: 21 °C', 'ipucuna da girmez');
});

test('çoklu sensör: hiçbir sensör çizilemiyorsa rozet yok; ayarda ek sensör yoksa (eski kayıt) davranış eskisi gibi', () => {
  const o = kur({ ayar: COKLU_AYAR, durumlar: {} });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.deepEqual(o.tepsiResimleri, []);
  assert.equal(donusZamanlayicisi(o).length, 0);
  const eski = kur({ ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon' }, durumlar: COKLU_DURUMLAR });
  eski.rozet.baslangic();
  eski.an = 5000;
  eski.rozet.guncelle();
  assert.ok(metinleri(eski)[0].equals(rozetPng('21')));
  assert.equal(donusZamanlayicisi(eski).length, 0, 'tek sensör: dönüş yok');
});

test('çoklu sensör: kimlikler tekrarsız ve en çok 3; ek liste dizi değilse ya da öğe metin değilse yok sayılır', () => {
  const o = kur({
    ayar: { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon', tepsiRozetSensorleri: ['sensor.salon', 'sensor.pil', 5, null, '', 'sensor.nem', 'sensor.fazla'] },
    durumlar: COKLU_DURUMLAR,
  });
  assert.deepEqual(o.rozet.izlenenKimlikler(), ['sensor.salon', 'sensor.pil', 'sensor.nem'], 'ana önce, tekrar ve geçersiz yok, en çok 3');
  assert.equal(o.rozet.izlenenKimlik(), 'sensor.salon', 'eski çağrı yalnız ana sensörü verir');
  o.ayar = { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon', tepsiRozetSensorleri: 'sensor.pil' };
  assert.deepEqual(o.rozet.izlenenKimlikler(), ['sensor.salon']);
  o.ayar = { tepsiRozeti: 'sensor', tepsiRozetSensoru: '', tepsiRozetSensorleri: ['sensor.pil'] };
  assert.deepEqual(o.rozet.izlenenKimlikler(), ['sensor.pil'], 'ana sensör boşsa ek sensör tek başına geçerli');
  for (const mod of ['isik', 'kapali', 'garip']) {
    o.ayar = { ...COKLU_AYAR, tepsiRozeti: mod };
    assert.deepEqual(o.rozet.izlenenKimlikler(), [], mod);
  }
});

test('çoklu sensör: tepsi ipucu geçerli sensörlerin hepsini sırayla yazar; bağlantı yokken ve sensor modu dışında yok', () => {
  const o = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR });
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21 °C · Telefon pili: %80 · Nem: %45');
  o.dil = 'en';
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21 °C · Telefon pili: 80% · Nem: 45%');
  o.dil = 'tr';
  o.durumlar['sensor.pil'] = sensor('sensor.pil', 'unavailable', { friendly_name: 'Telefon pili' });
  assert.equal(o.rozet.ipucuEki(), 'Salon sıcaklığı: 21 °C · Nem: %45', 'çizilemeyen sensör ipucuna girmez');
  o.soluk = true;
  assert.equal(o.rozet.ipucuEki(), null);
  o.soluk = false;
  o.ayar = { ...COKLU_AYAR, tepsiRozeti: 'isik' };
  assert.equal(o.rozet.ipucuEki(), null);
});

test('çoklu sensör: bağlantı kopunca, mod değişince, sensör azalınca ve temizle ile dönüş zamanlayıcısı durur; tepsi yokken kurulmaz', () => {
  const o = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 1);
  o.soluk = true;
  o.an = 5100;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 0, 'bağlantı yok: dönüş durur (rozet de çizilmez)');
  o.soluk = false;
  o.an = 8000;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 1, 'bağlantı dönünce yeniden kurulur');
  o.ayar = { ...COKLU_AYAR, tepsiRozeti: 'isik' };
  o.an = 12000;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 0, 'sensor modu dışında dönüş yok');
  o.ayar = COKLU_AYAR;
  o.an = 16000;
  o.rozet.guncelle();
  assert.equal(donusZamanlayicisi(o).length, 1);
  o.rozet.temizle();
  assert.equal(donusZamanlayicisi(o).length, 0, 'temizle zamanlayıcıyı siler');

  const yok = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR, tepsiVar: false });
  yok.an = 5000;
  yok.rozet.guncelle();
  assert.equal(yok.zamanlayicilar.size, 0, 'tepsi yokken zamanlayıcı kurulmaz');

  // zamanlayıcı çalarken tepsi kaybolduysa sessizce durur
  const kapanis = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR });
  kapanis.rozet.baslangic();
  kapanis.an = 5000;
  kapanis.rozet.guncelle();
  kapanis.tepsiVar = false;
  kapanis.an = 10000;
  donusTetikle(kapanis);
  assert.equal(donusZamanlayicisi(kapanis).length, 0);
});

test('çoklu sensör: dönüş simgeyi saniyede en çok bir kez yazar ve ağ ya da günlük işi yapmaz', () => {
  const o = kur({ ayar: COKLU_AYAR, durumlar: COKLU_DURUMLAR });
  o.rozet.baslangic();
  o.an = 5000;
  o.rozet.guncelle();
  const once = o.tepsiResimleri.length;
  o.an = 5300; // saniye dolmadı: dönüş sonucu bekletilir
  donusTetikle(o);
  assert.equal(o.tepsiResimleri.length, once, 'aralık dolmadan yeni simge yazılmaz');
  assert.equal(o.zamanlayicilar.size >= 1, true);
  assert.deepEqual(o.gunlukler, [], 'günlüğe sensör adı / değeri yazılmaz');
});
