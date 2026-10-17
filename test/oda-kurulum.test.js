'use strict';

/**
 * Oda temelli ilk kurulum önerisi (o-44): src/lib/oda-kurulum.js. Saf modül; HA yanıtları elle kurulan nesnelerdir (ağ yok).
 * Ana süreç tarafı (IPC, canlı bağlantı şartı) test/ana-surec.test.js'tedir; Ayarlar sayfası test/ayarlar-oda.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EN_COK_CIHAZ, onerilebilirMi, odaOnerileri } = require('../src/lib/oda-kurulum');
const { guvenliVarlikMi } = require('../src/lib/suzgec');

const durum = (kimlik, ad, state = 'off', nitelik = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: ad, ...nitelik } });
const alanlar = (...liste) => ({ alanlar: liste.map(([id, ad]) => ({ id, ad })), varlikAlanlari: {} });
const eslestir = (veri, harita) => ({ ...veri, varlikAlanlari: harita });

const TEMEL_DURUMLAR = [
  durum('light.salon_lambasi', 'Salon Lambası'),
  durum('switch.salon_priz', 'Salon Priz'),
  durum('scene.film', 'Film Sahnesi'),
  durum('light.mutfak_lambasi', 'Mutfak Lambası', 'on'),
  durum('fan.mutfak_aspirator', 'Mutfak Aspiratör'),
  durum('light.cocuk_odasi', 'Çocuk Lambası'),
  durum('light.atanmamis', 'Odasız Lamba'),
];
const TEMEL_VERI = eslestir(alanlar(['salon', 'Salon'], ['mutfak', 'Mutfak'], ['cocuk', 'Çocuk Odası'], ['bos', 'Boş Oda']), {
  'light.salon_lambasi': 'salon',
  'switch.salon_priz': 'salon',
  'scene.film': 'salon',
  'light.mutfak_lambasi': 'mutfak',
  'fan.mutfak_aspirator': 'mutfak',
  'light.cocuk_odasi': 'cocuk',
});

test('odaOnerileri: odalara göre gruplanır; odalar Türkçe sıralıdır, boş oda yoktur; cihazlar alan sırasında (ışık, priz, vantilatör, sahne) ve adla sıralanır', () => {
  const odalar = odaOnerileri({ durumlar: TEMEL_DURUMLAR, alanVerisi: TEMEL_VERI });
  assert.deepEqual(odalar.map((o) => o.ad), ['Çocuk Odası', 'Mutfak', 'Salon'], '"Çocuk" Mutfak\'tan önce (tr sırası); Boş Oda yok');
  const salon = odalar.find((o) => o.id === 'salon');
  assert.equal(salon.toplam, 3);
  assert.deepEqual(salon.cihazlar, [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light' },
    { entity_id: 'switch.salon_priz', ad: 'Salon Priz', alan: 'switch' },
    { entity_id: 'scene.film', ad: 'Film Sahnesi', alan: 'scene' },
  ]);
  assert.deepEqual(odalar.find((o) => o.id === 'mutfak').cihazlar.map((c) => c.entity_id), ['light.mutfak_lambasi', 'fan.mutfak_aspirator']);
  for (const o of odalar) assert.deepEqual(Object.keys(o).sort(), ['ad', 'cihazlar', 'id', 'toplam'], 'yalnız bilinen alanlar döner');
  assert.equal(JSON.stringify(odalar).includes('Odasız'), false, 'odaya atanmamış varlık önerilmez');
});

test('odaOnerileri: Kapı Kuralı — kapı, kilit, alarm, garaj, perde kapısı adlı ya da sınıflı varlıklar ve bunları içeren sahneler önerilmez', () => {
  const durumlar = [
    durum('light.salon_lambasi', 'Salon Lambası'),
    durum('light.giris_kapisi_lambasi', 'Giriş Kapısı Lambası'),
    durum('switch.garaj_acici', 'Garaj Açıcı'),
    durum('lock.on_kapi', 'Ön Kapı'),
    durum('alarm_control_panel.ev', 'Ev Alarmı'),
    durum('siren.alarm', 'Siren'),
    durum('cover.garaj', 'Garaj Kapısı'),
    durum('binary_sensor.kapi', 'Kapı Sensörü', 'off', { device_class: 'door' }),
    durum('scene.kapiyi_ac', 'Hepsini Aç', 'scening', { entity_id: ['light.salon_lambasi', 'lock.on_kapi'] }),
    durum('scene.film', 'Film', 'scening', { entity_id: ['light.salon_lambasi'] }),
    durum('light.garaj_isigi', 'Garaj Işığı'),
    durum('input_select.mod', 'Mod', 'a', { options: ['Gündüz', 'Kapıyı aç'] }),
  ];
  const harita = Object.fromEntries(durumlar.map((d) => [d.entity_id, 'salon']));
  const odalar = odaOnerileri({ durumlar, alanVerisi: eslestir(alanlar(['salon', 'Salon']), harita) });
  assert.deepEqual(odalar[0].cihazlar.map((c) => c.entity_id), ['light.salon_lambasi', 'scene.film']);
  for (const d of durumlar) {
    if (['light.salon_lambasi', 'scene.film'].includes(d.entity_id)) continue;
    assert.equal(onerilebilirMi(d), false, `${d.entity_id} önerilmemeli`);
  }
});

test('odaOnerileri: oda adı da süzgeçten geçer — "Garaj", "Kapı Önü" gibi adlı odalar hiç listelenmez; bozuk alan kimliği düşer', () => {
  const durumlar = [durum('light.a', 'Lamba A'), durum('light.b', 'Lamba B'), durum('light.c', 'Lamba C'), durum('light.d', 'Lamba D')];
  const veri = eslestir(
    { alanlar: [{ id: 'garaj', ad: 'Garaj' }, { id: 'kapi_onu', ad: 'Kapı Önü' }, { id: 'bozuk id', ad: 'Bozuk' }, { id: 'salon', ad: 'Salon' }, { id: 'adsiz' }, null, 'x'] },
    { 'light.a': 'garaj', 'light.b': 'kapi_onu', 'light.c': 'bozuk id', 'light.d': 'salon' },
  );
  const odalar = odaOnerileri({ durumlar, alanVerisi: veri });
  assert.deepEqual(odalar.map((o) => o.ad), ['Salon']);
  assert.deepEqual(odalar[0].cihazlar.map((c) => c.entity_id), ['light.d']);
});

test('odaOnerileri: yalnız okunur alanlar, onay isteyen eylemler, yıkıcı eylemler, gizli adaylar ve ulaşılamayan varlıklar önerilmez', () => {
  const dahil = [
    durum('light.l', 'Lamba'),
    durum('climate.k', 'Klima', 'cool'),
    durum('media_player.tv', 'TV', 'off'),
    durum('vacuum.s', 'Süpürge', 'docked'),
    durum('humidifier.n', 'Nemlendirici'),
    durum('input_boolean.m', 'Sanal Anahtar'),
    durum('button.pc_ekran_kapat', 'Ekranı Kapat', 'unknown'), // bilinen zararsız PC eylemi
  ];
  const haric = [
    durum('sensor.sicaklik', 'Sıcaklık', '21'),
    durum('binary_sensor.hareket', 'Hareket', 'off', { device_class: 'motion' }),
    durum('weather.ev', 'Hava', 'sunny'),
    durum('calendar.ev', 'Takvim', 'off'),
    durum('todo.liste', 'Yapılacaklar', '3'),
    durum('script.iyi_geceler', 'İyi Geceler', 'off'),
    durum('script.baska', 'Başka Script', 'off'), // script varsayılan onaylı
    durum('button.zil', 'Zil', 'unknown'), // düğme varsayılan onaylı
    durum('input_select.mod', 'Mod', 'a', { options: ['A', 'B'] }),
    durum('number.esik', 'Eşik', '3'),
    durum('timer.t', 'Sayaç', 'idle'),
    durum('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'), // yıkıcı (açık liste)
    durum('switch.oyun_bilgisayari', 'Oyun Bilgisayarı'), // yıkıcı (açık liste)
    durum('switch.pc_shutdown', 'PC Kapat'), // ipucu belirteci
    durum('button.homeassistant_restart', 'HA Yeniden Başlat', 'unknown'), // gizli aday
    durum('light.yok', 'Ulaşılamayan Lamba', 'unavailable'),
    durum('cover.perde', 'Perde', 'open'), // alan kayıtta yok
    durum('lawn_mower.bahce', 'Çim Biçme', 'docked'),
  ];
  const tum = [...dahil, ...haric];
  const odalar = odaOnerileri({ durumlar: tum, alanVerisi: eslestir(alanlar(['ev', 'Ev']), Object.fromEntries(tum.map((d) => [d.entity_id, 'ev']))) });
  assert.deepEqual(
    odalar[0].cihazlar.map((c) => c.entity_id).sort(),
    dahil.map((d) => d.entity_id).sort(),
  );
  for (const d of haric) assert.equal(onerilebilirMi(d), false, `${d.entity_id} önerilmemeli`);
});

test('odaOnerileri: oda başına sınır (varsayılan 20) uygulanır; toplam gerçek sayıyı söyler; sınır ayarlanabilir', () => {
  const durumlar = Array.from({ length: 35 }, (_, i) => durum(`light.l${String(i).padStart(2, '0')}`, `Lamba ${String(i).padStart(2, '0')}`));
  const veri = eslestir(alanlar(['salon', 'Salon']), Object.fromEntries(durumlar.map((d) => [d.entity_id, 'salon'])));
  const [oda] = odaOnerileri({ durumlar, alanVerisi: veri });
  assert.equal(EN_COK_CIHAZ, 20);
  assert.equal(oda.toplam, 35);
  assert.equal(oda.cihazlar.length, 20);
  assert.equal(oda.cihazlar[0].ad, 'Lamba 00');
  assert.equal(odaOnerileri({ durumlar, alanVerisi: veri, enCokCihaz: 3 })[0].cihazlar.length, 3);
  assert.equal(odaOnerileri({ durumlar, alanVerisi: veri, enCokCihaz: 0 })[0].cihazlar.length, 0);
});

test('odaOnerileri: kopya kimlikler tek sayılır; adı olmayan varlık kimlikle gösterilir; uzun ad kırpılır', () => {
  const durumlar = [durum('light.a', 'Lamba'), durum('light.a', 'Lamba'), { entity_id: 'light.adsiz', state: 'off', attributes: {} }, durum('light.uzun', 'U'.repeat(300))];
  const veri = eslestir(alanlar(['salon', 'Salon']), { 'light.a': 'salon', 'light.adsiz': 'salon', 'light.uzun': 'salon' });
  const [oda] = odaOnerileri({ durumlar, alanVerisi: veri });
  assert.equal(oda.toplam, 3);
  assert.equal(oda.cihazlar.find((c) => c.entity_id === 'light.adsiz').ad, 'light.adsiz');
  assert.equal(oda.cihazlar.find((c) => c.entity_id === 'light.uzun').ad.length, 100);
});

test('odaOnerileri: bozuk girdiler boş sonuç verir, fırlatmaz; kaynak girdiler değiştirilmez', () => {
  for (const durumlar of [null, undefined, 'x', {}, 5]) assert.deepEqual(odaOnerileri({ durumlar, alanVerisi: TEMEL_VERI }), []);
  for (const alanVerisi of [null, undefined, 'x', 5, {}, { alanlar: 'x', varlikAlanlari: 'y' }, { alanlar: [], varlikAlanlari: {} }]) {
    assert.deepEqual(odaOnerileri({ durumlar: TEMEL_DURUMLAR, alanVerisi }), []);
  }
  assert.deepEqual(odaOnerileri({ durumlar: [null, undefined, 5, 'x', { entity_id: 5 }, { entity_id: 'Kotu Kimlik' }], alanVerisi: TEMEL_VERI }), []);
  const kopya = JSON.stringify([TEMEL_DURUMLAR, TEMEL_VERI]);
  odaOnerileri({ durumlar: TEMEL_DURUMLAR, alanVerisi: TEMEL_VERI });
  assert.equal(JSON.stringify([TEMEL_DURUMLAR, TEMEL_VERI]), kopya);
  // prototip anahtarları eşleme olarak okunmaz
  assert.deepEqual(odaOnerileri({ durumlar: [durum('light.a', 'A')], alanVerisi: { alanlar: [{ id: 'salon', ad: 'Salon' }], varlikAlanlari: JSON.parse('{"__proto__": "salon"}') } }), []);
});

test('odaOnerileri: dil seçimi oda sırasını belirler (en, de, fr, es: Türkçe dışı harf sırası; geçersiz ya da eksik dil Türkçe)', () => {
  const durumlar = [durum('light.a', 'A'), durum('light.b', 'B')];
  const veri = eslestir(alanlar(['a', 'Ilık Oda'], ['b', 'İç Oda']), { 'light.a': 'a', 'light.b': 'b' });
  // Türkçede noktasız ı, noktalı i'den önce gelir; İngilizce sıralamada taban harfler (i) eşit olduğundan ikinci harfe (c < l) bakılır.
  assert.deepEqual(odaOnerileri({ durumlar, alanVerisi: veri, dil: 'tr' }).map((o) => o.ad), ['Ilık Oda', 'İç Oda']);
  assert.deepEqual(odaOnerileri({ durumlar, alanVerisi: veri, dil: 'en' }).map((o) => o.ad), ['İç Oda', 'Ilık Oda']);
  for (const dil of ['de', 'fr', 'es']) assert.deepEqual(odaOnerileri({ durumlar, alanVerisi: veri, dil }).map((o) => o.ad), ['İç Oda', 'Ilık Oda'], dil);
  for (const dil of [undefined, 'it', 'sistem', 'DE', 'toString']) assert.deepEqual(odaOnerileri({ durumlar, alanVerisi: veri, dil }).map((o) => o.ad), ['Ilık Oda', 'İç Oda'], String(dil));
});

test('her öneri Kapı Kuralı süzgecinden geçer (tüm odalar, tüm cihazlar)', () => {
  const odalar = odaOnerileri({ durumlar: TEMEL_DURUMLAR, alanVerisi: TEMEL_VERI });
  const tumu = new Map(TEMEL_DURUMLAR.map((d) => [d.entity_id, d]));
  for (const oda of odalar) for (const c of oda.cihazlar) assert.equal(guvenliVarlikMi(tumu.get(c.entity_id)), true, c.entity_id);
});

test('modül yalnız lib modüllerini ister: elektron, ağ, dosya sistemi ve servis çağrısı yok', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'oda-kurulum.js'), 'utf8');
  const istenenler = [...kaynak.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(istenenler.length > 0);
  for (const m of istenenler) assert.match(m, /^\.\//, `${m}: yalnız ./ modülleri`);
  assert.doesNotMatch(kaynak, /fetch\(|call_service|callService|haIstek|ipcMain|ipcRenderer|fs\./);
});

test('1.4.0 cihaz grubu: perde sınıflı cover önerilir (zararsız); vana, otomasyon, kamera, garaj/sınıfsız cover önerilmez (zorunlu onaylı ya da yasak)', () => {
  const perde = durum('cover.salon_perde', 'Salon Perde', 'open', { device_class: 'curtain' });
  const jaluzi = durum('cover.salon_jaluzi', 'Salon Jaluzi', 'closed', { device_class: 'blind' });
  const haric = [
    durum('valve.bahce_suyu', 'Bahçe Suyu', 'open'),
    durum('automation.gece', 'Gece Modu', 'on'),
    durum('camera.salon', 'Salon Kamera', 'idle'),
    durum('cover.garaj', 'Depo', 'closed', { device_class: 'garage' }),
    durum('cover.sinifsiz', 'Bir Şey', 'closed'),
    durum('cover.kapi_perdesi', 'Ön Kapı Perdesi', 'open', { device_class: 'curtain' }),
  ];
  assert.equal(onerilebilirMi(perde), true);
  assert.equal(onerilebilirMi(jaluzi), true);
  for (const d of haric) assert.equal(onerilebilirMi(d), false, `${d.entity_id} önerilmemeli`);
  const tum = [perde, jaluzi, ...haric];
  const odalar = odaOnerileri({ durumlar: tum, alanVerisi: eslestir(alanlar(['salon', 'Salon']), Object.fromEntries(tum.map((d) => [d.entity_id, 'salon']))) });
  assert.deepEqual(odalar[0].cihazlar.map((c) => c.entity_id).sort(), ['cover.salon_jaluzi', 'cover.salon_perde']);
});
