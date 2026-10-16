'use strict';

/**
 * GÜVENLİK KURALI süzgeci (hata-03, hata-11). Beklenen sonuçlar gerçek HA envanterine (test/veri/envanter.json)
 * ve sentetik adlara dayanır. Kapı/kilit/alarm/garaj/bariyer/gate/lock hiçbir koşulda geçmemelidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sadelestir,
  adGuvenliMi,
  guvenliVarlikMi,
  alanAl,
  FAVORI_ALANLARI,
  ALAN_SIRASI,
  YASAK_KELIMELER,
  YASAK_PARCALAR,
  YASAK_KISA_PARCALAR,
  MASUM_SOZCUKLER,
} = require('../src/lib/suzgec');
const envanter = require('./veri/envanter.json');

const varlik = (entity_id, friendly_name, extra = {}) => ({
  entity_id,
  state: 'off',
  attributes: { friendly_name, ...extra },
});
const gercek = (kimlik) => {
  const o = envanter.find((e) => e.entity_id === kimlik);
  assert.ok(o, `${kimlik} envanterde yok`);
  return {
    entity_id: o.entity_id,
    state: o.state,
    attributes: { friendly_name: o.friendly_name, ...(o.device_class ? { device_class: o.device_class } : {}) },
  };
};

test('bugünkü 4 favori (gerçek adlarıyla) süzgeçten geçer', () => {
  for (const kimlik of [
    'light.masa_led_serit',
    'light.smart_multicolor_bulb',
    'button.pc_ses_cikis_hoparlor',
    'button.pc_ses_cikis_kulaklik',
  ]) {
    assert.ok(guvenliVarlikMi(gercek(kimlik)), kimlik);
  }
});

test('sadelestir: Türkçe büyük/küçük harf, aksan ve tam genişlik', () => {
  for (const metin of ['KAPI', 'Kapı', 'kapı', 'kapi']) assert.equal(sadelestir(metin), 'kapi');
  assert.equal(sadelestir('İşık'), 'isik');
  assert.equal(sadelestir('ŞÇĞÜÖ'), 'scguo');
  assert.equal(sadelestir('Ｋａｐｉ'), 'kapi'); // NFKD: tam genişlik çözülür (NFD çözmezdi)
  assert.equal(sadelestir('ﬁx'), 'fix');
  assert.equal(sadelestir(null), '');
});

test('sadelestir: uyumluluk harfleri küçültmeden ÖNCE çözülür (matematik, kare, daire, bölge göstergesi)', () => {
  assert.equal(sadelestir('\u{1D40A}\u{1D400}\u{1D40F}\u{1D408}'), 'kapi'); // matematik kalın BÜYÜK harf: küçük harf karşılığı yok
  assert.equal(sadelestir('\u{1D5AA}\u{1D5BA}\u{1D5C9}\u{1D5C2}'), 'kapi'); // matematik sans-serif "Kapi"
  assert.equal(sadelestir('\u{1F13A}\u{1F130}\u{1F13F}\u{1F138}'), 'kapi'); // kare harfler
  assert.equal(sadelestir('\u{1F17A}\u{1F170}\u{1F17F}\u{1F178}'), 'kapi'); // ters kare harfler: NFKD çözmez, elle eşlenir
  assert.equal(sadelestir('\u{1F15A}\u{1F150}\u{1F15F}\u{1F158}'), 'kapi'); // ters daire içinde harfler
  assert.equal(sadelestir('Ⓚⓐⓟⓘ'), 'kapi'); // daire içinde harfler
  assert.equal(sadelestir('\u{1F1F0}\u{1F1E6}\u{1F1F5}\u{1F1EE}'), 'kapi'); // bölge göstergeleri
  assert.equal(sadelestir('\u{1D40B}\u{1D40E}\u{1D402}\u{1D40A}'), 'lock');
});

test('sadelestir: görünmez biçim karakterleri silinir, sekme ve satır sonu ayraç olarak kalır', () => {
  for (const gizli of ['\u00AD', '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF', '\u200E', '\u202E', '\u{E0041}', '\u0000']) {
    assert.equal(sadelestir(`Ka${gizli}pı`), 'kapi', JSON.stringify(gizli));
  }
  assert.equal(sadelestir('a\tb\nc'), 'a\tb\nc');
  assert.equal(sadelestir('Kápı'), 'kapi'); // birleştirici işaret
});

test('sadelestir: Türkçe karakterler ve sık Latin harfleri ASCII karşılığına iner', () => {
  assert.equal(sadelestir('ÇĞİÖŞÜ çğıöşü'), 'cgiosu cgiosu');
  assert.equal(sadelestir('Straße'), 'strasse');
  assert.equal(sadelestir('Nørdic Łampa Đ Þ Æ Œ'), 'nordic lampa d th ae oe');
});

test('örnek envanter: kapı, kilit ve alarm varlıkları engellenir, geri kalan favori alanları geçer', () => {
  const beklenenEngelli = [
    'button.pc_bilgisayari_kilitle',
    'button.garaj_kapisi_ac',
    'button.garaj_kapisi_led_testi',
    'button.garaj_kapisi_yeniden_baslat',
    'input_boolean.gun_dogumu_alarmi',
    'light.garaj_kapisi_durum_led',
    'script.kapi_ac_onayli',
    'script.pc_kilitle_ekran_kapat',
  ];
  const engelli = envanter
    .filter((o) => Object.hasOwn(FAVORI_ALANLARI, alanAl(o.entity_id)))
    .map((o) => gercek(o.entity_id))
    .filter((v) => !guvenliVarlikMi(v))
    .map((v) => v.entity_id)
    .sort();
  assert.deepEqual(engelli, [...beklenenEngelli].sort());
});

test('PC kilidi için istisna yok (soru-5): kilitle düğmesi ve script engelli', () => {
  assert.ok(!guvenliVarlikMi(gercek('button.pc_bilgisayari_kilitle')));
  assert.ok(!guvenliVarlikMi(gercek('script.pc_kilitle_ekran_kapat')));
  assert.ok(!guvenliVarlikMi(varlik('script.x', 'PC kilitle')));
});

test('kapı/door/kilit/alarm sözcükleri engellenir (kimlikte ya da adda)', () => {
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Kapı Lambası')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'KAPI')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Salon Kapısı')));
  assert.ok(!guvenliVarlikMi(varlik('switch.front_door_relay', 'Röle')));
  assert.ok(!guvenliVarlikMi(varlik('switch.x', 'Door Opener')));
  assert.ok(!guvenliVarlikMi(varlik('light.salonkapisi', 'Işık')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Alarm Işığı')));
  assert.ok(!guvenliVarlikMi(varlik('switch.x', 'Kilit Rölesi')));
});

test('hata-11: indoor/outdoor artık yanlışlıkla engellenmez', () => {
  assert.ok(guvenliVarlikMi(varlik('light.x', 'Indoor Lamp')));
  assert.ok(guvenliVarlikMi(varlik('light.x', 'Outdoor Işık')));
  assert.ok(guvenliVarlikMi(varlik('light.x', 'OUTDOORS')));
  assert.ok(guvenliVarlikMi(varlik('light.indoor_lamp', 'Lamba')));
  assert.ok(guvenliVarlikMi(varlik('light.salon_outdoor', 'Lamba')));
});

test('hata-11: istisna yalnız TAM belirteç; door içeren her başka sözcük engelli kalır', () => {
  for (const ad of ['Front Door Light', 'frontdoor', 'Doorbell Light', 'outdoorlight', 'Door', 'door_2', 'Indoor Door', 'indoorx']) {
    assert.ok(!guvenliVarlikMi(varlik('light.x', ad)), ad);
  }
  assert.ok(!guvenliVarlikMi(varlik('light.frontdoor', 'Lamba')));
  assert.ok(!guvenliVarlikMi(varlik('light.outdoor_door', 'Lamba'))); // belirteçlerden biri "door"
});

test('hata-03: garaj, bariyer, garage, gate, lock, unlock engellenir', () => {
  for (const ad of [
    'Garaj Işığı',
    'Bariyer',
    'GARAJ',
    'Garage Light',
    'Gate Opener',
    'Gateway',
    'Unlock',
    'Unlocked Mode',
    'Lock',
    'Lockdown',
    'Locked',
    'Smartlock Test',
    'Padlock',
    'Deadlock',
    'Relock',
    'Autolock',
  ]) {
    assert.ok(!guvenliVarlikMi(varlik('light.x', ad)), ad);
  }
});

test('hata-03: alt çizgi ve noktalama ayraçtır (kimlikte de)', () => {
  assert.ok(!guvenliVarlikMi(varlik('light.gate_light', 'Lamba')));
  assert.ok(!guvenliVarlikMi(varlik('light.my_lock_light', 'Lamba')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'my-lock-light')));
  assert.ok(!guvenliVarlikMi(varlik('script.garage_open', 'Aç')));
});

test('hata-03: gate/lock belirtecin her yerinde aranır; bilinen masum sözcükler (navigate, clock, block...) geçer', () => {
  for (const ad of [
    'Navigate Mode',
    'Investigate',
    'Clock Light',
    'Block Switch',
    'Flock',
    'Delegate',
    'Alligator',
    'Aggregate',
    'Wallclock',
    'Sunblock',
    'Blocked',
    'Clockwork',
  ]) {
    assert.ok(guvenliVarlikMi(varlik('light.x', ad)), ad);
  }
  assert.ok(guvenliVarlikMi(varlik('light.clock_light', 'Lamba')));
});

test('hata-03: tam genişlikli ve aksanlı yazımlar engellenir (NFKD)', () => {
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Ｋａｐｉ lambası')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'ＧＡＲＡＪ')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Ｇａｔｅ')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'KAPI')));
});

test('lock ve alarm_control_panel alanları ve kapı/garaj/geçit cihaz sınıfları engellenir', () => {
  assert.ok(!guvenliVarlikMi(varlik('lock.on_kapi', 'Ön')));
  assert.ok(!guvenliVarlikMi(varlik('lock.x', 'Herhangi')));
  assert.ok(!guvenliVarlikMi(varlik('alarm_control_panel.ev', 'Ev')));
  for (const sinif of ['door', 'garage_door', 'garage', 'gate', 'lock']) {
    assert.ok(!guvenliVarlikMi(varlik('switch.x', 'Anahtar', { device_class: sinif })), sinif);
  }
  assert.ok(guvenliVarlikMi(varlik('switch.x', 'Anahtar', { device_class: 'outlet' })));
});

test('bilinmeyen alanlar ve geçersiz girdiler engellenir', () => {
  assert.ok(!guvenliVarlikMi(varlik('cover.perde', 'Perde')));
  assert.ok(!guvenliVarlikMi(varlik('sensor.sicaklik', 'Sıcaklık')));
  assert.ok(!guvenliVarlikMi(varlik('Light.X', 'Büyük harf')));
  assert.ok(!guvenliVarlikMi(varlik('light', 'Noktasız')));
  assert.ok(!guvenliVarlikMi(null));
  assert.ok(!guvenliVarlikMi({}));
  assert.ok(!guvenliVarlikMi({ entity_id: 42 }));
});

test('adGuvenliMi ve alanAl', () => {
  assert.ok(adGuvenliMi('light.x', 'Salon'));
  assert.ok(!adGuvenliMi('light.x', 'Salon Kapısı'));
  assert.equal(alanAl('light.masa'), 'light');
});

test('günlük kullanımdaki zararsız adlar geçer (yanlış engel yok)', () => {
  for (const kimlik of [
    'scene.calisma',
    'scene.aksam',
    'scene.film',
    'scene.gece_lambasi',
    'button.pc_ekran_kapat',
    'switch.smart_plug_mini',
    'script.telefonu_bul',
    'script.iyi_geceler',
    'button.pc_bilgisayari_kapat',
    'button.pc_mediaplaypause',
    'script.pc_kapat',
  ]) {
    assert.ok(guvenliVarlikMi(gercek(kimlik)), kimlik);
  }
});

test('favori alanları ve sıra', () => {
  assert.deepEqual(ALAN_SIRASI, ['light', 'switch', 'fan', 'input_boolean', 'scene', 'script', 'button', 'input_button']);
  assert.equal(FAVORI_ALANLARI.light.servis, 'toggle');
  assert.equal(FAVORI_ALANLARI.scene.servis, 'turn_on');
  assert.equal(FAVORI_ALANLARI.button.servis, 'press');
  assert.ok(!('lock' in FAVORI_ALANLARI));
});

test('yasak sözcük listesi kapı, kilit, alarm, garaj, bariyer, gate ve lock köklerini içerir', () => {
  for (const kok of ['kapi', 'door', 'kilit', 'kilid', 'alarm', 'garaj', 'bariyer', 'garage', 'gate', 'lock', 'unlock']) {
    assert.ok(YASAK_KELIMELER.includes(kok), kok);
  }
});

test('hata-03: bitişik yazılmış adlar engellenir (MainGate, FrontGate, Keylock, smartgateopener)', () => {
  assert.ok(!guvenliVarlikMi(varlik('switch.maingate', 'MainGate')));
  assert.ok(!guvenliVarlikMi(varlik('switch.keylock', 'Keylock')));
  assert.ok(!guvenliVarlikMi(varlik('switch.x', 'FrontGate')));
  assert.ok(!guvenliVarlikMi(varlik('switch.x', 'KeyLock')));
  assert.ok(!guvenliVarlikMi(varlik('switch.x', 'SmartGateOpener')));
  assert.ok(!guvenliVarlikMi(varlik('switch.smartgateopener', 'Röle 1'))); // ad zararsız, kimlik değil
  assert.ok(!guvenliVarlikMi(varlik('switch.frontgate', 'Röle 1')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'Salon Lock')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'ClockGate'))); // masum sözcük kapıyı gizleyemez
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'NavigateGate')));
  assert.ok(!guvenliVarlikMi(varlik('light.x', 'gateNavigate')));
});

test('hata-03: Türkçe ek almış "kilid-" biçimleri engellenir (kilidi, kilide, KİLİDİ)', () => {
  assert.ok(!guvenliVarlikMi(varlik('script.kilidi_ac', 'Aç')));
  assert.ok(!guvenliVarlikMi(varlik('script.x', 'Kilidi aç')));
  assert.ok(!guvenliVarlikMi(varlik('input_boolean.x', 'Kilidi açık tut')));
  assert.ok(!guvenliVarlikMi(varlik('input_boolean.x', 'Ev kilidi')));
  assert.ok(!guvenliVarlikMi(varlik('button.x', 'Kilide dokun')));
  assert.ok(!guvenliVarlikMi(varlik('button.x', 'KİLİDİ AÇ')));
  assert.ok(!guvenliVarlikMi(varlik('button.x', 'kilidin')));
  assert.ok(!guvenliVarlikMi(varlik('button.x', 'Kilitle')));
  assert.ok(!guvenliVarlikMi(varlik('button.x', 'Kilitli')));
});

test('hata-03: görünmez karakterle bölünmüş sözcükler engellenir (yumuşak tire, sıfır genişlikli boşluk...)', () => {
  for (const gizli of ['\u00AD', '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']) {
    for (const sozcuk of ['Ka__pı', 'Ga__raj', 'Ki__lit', 'Ba__riyer', 'Al__arm', 'Do__or', 'Ga__te', 'Lo__ck']) {
      const ad = sozcuk.replace('__', gizli);
      assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', ad)), JSON.stringify(ad));
    }
  }
  // Ayrı sözcükler arasına konan görünmez karakter "salonlock" olur: lock belirtecin sonunda da aranır.
  assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', 'Salon\u200BLock')));
});

test('hata-03: uyumluluk harfleriyle (matematik, kare, daire, bölge göstergesi) yazılmış sözcükler engellenir', () => {
  const adlar = [
    '\u{1D40A}\u{1D400}\u{1D40F}\u{1D408} Aç', // matematik kalın KAPI
    '\u{1D5AA}\u{1D5BA}\u{1D5C9}\u{1D5C2} Aç', // matematik sans-serif Kapi
    '\u{1F13A}\u{1F130}\u{1F13F}\u{1F138} Aç', // kare harfler KAPI
    '\u{1F17A}\u{1F170}\u{1F17F}\u{1F178} Aç', // ters kare harfler
    'Ⓚⓐⓟⓘ Aç', // daire içinde harfler
    '\u{1F1F0}\u{1F1E6}\u{1F1F5}\u{1F1EE} Aç', // bölge göstergeleri
    '\u{1D40B}\u{1D40E}\u{1D402}\u{1D40A}', // matematik kalın LOCK
    '\u{1D406}\u{1D400}\u{1D413}\u{1D404}', // matematik kalın GATE
    'ＧＡＲＡＪ',
  ];
  for (const ad of adlar) assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', ad)), ad);
});

test('hata-03: benzer-harf (Kiril, Yunan) ve ASCII\'ye inmeyen yazı sistemleri güvensiz sayılır', () => {
  // "Kаpı": ikinci harf Kiril а; "Gαte": Yunan α; "Lоck": Kiril о
  for (const ad of ['Kаpı Aç', 'Gαte', 'Lоck', 'Свет', '照明', 'Kapı Aç ا']) {
    assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', ad)), ad);
  }
  assert.ok(!adGuvenliMi('button.bina_ac', 'Лампа'));
  // Türkçe ve yaygın Latin harfleri etkilenmez; emoji ve noktalama ayraçtır.
  for (const ad of ['Işık Çalışma Ağı Üst Öğle', 'Straße Lamba', 'Nørdic Lamp', '\u{1F4A1} Salon', 'Salon (Büyük) – lamba']) {
    assert.ok(guvenliVarlikMi(varlik('light.x', ad)), ad);
  }
});

test('hata-03: masum sözcükler yasak parça içermez ve her biri gate/lock içerir (gereksiz muafiyet yok)', () => {
  for (const masum of MASUM_SOZCUKLER) {
    assert.ok(!YASAK_PARCALAR.some((p) => masum.includes(p)), `${masum}: yasak parça içermemeli`);
    assert.ok(YASAK_KISA_PARCALAR.some((p) => masum.includes(p)), `${masum}: listede gereksiz`);
  }
});

// --- 1.2.0 (h-03, h-39): yalnız sıkılaştırma ---------------------------------------------------------------------------

const H03_SOZCUKLERI = ['Diafon', 'Interkom', 'Intercom', 'Kepenk', 'Deadbolt', 'Latch', 'Buzzer', 'Yale', 'Shutter'];

test('h-03: diafon, interkom, intercom, kepenk, deadbolt, latch, buzzer, yale, shutter (adda ya da kimlikte) engellenir', () => {
  for (const sozcuk of H03_SOZCUKLERI) {
    assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', sozcuk)), `${sozcuk} (ad)`);
    assert.ok(!guvenliVarlikMi(varlik(`switch.${sozcuk.toLowerCase()}_rolesi`, 'Röle 1')), `${sozcuk} (kimlik)`);
    assert.ok(YASAK_KELIMELER.includes(sozcuk.toLowerCase()), `${sozcuk} yasak listede`);
  }
});

test('h-03: yeni sözcükler büyük harf, tam genişlik, görünmez karakter, bitişik yazım ve Türkçe ekle de engellenir', () => {
  const tamGenislik = (k) => [...k].map((c) => (/[a-z]/i.test(c) ? String.fromCodePoint(c.charCodeAt(0) + 0xfee0) : c)).join('');
  const donusumler = [
    (k) => k.toLocaleUpperCase('tr-TR'),
    tamGenislik,
    (k) => `${k.slice(0, 2)}\u00AD${k.slice(2)}`, // yumuşak tire
    (k) => `${k.slice(0, 2)}\u200B${k.slice(2)}`, // sıfır genişlikli boşluk
    (k) => `Bina${k}Acici`,
    (k) => `salon_${k}_rolesi`,
  ];
  for (const sozcuk of H03_SOZCUKLERI) {
    for (const donustur of donusumler) {
      const ad = donustur(sozcuk);
      assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', ad)), JSON.stringify(ad));
    }
  }
  // Türkçe ekler: kepenk -> kepengi / kepenge (k yumuşar), diafonu, interkomu
  for (const ad of ['Kepengi aç', 'Kepenge dokun', 'KEPENGİN', 'Diafonu aç', 'Interkomu çal', 'Buzzerı bas']) {
    assert.ok(!guvenliVarlikMi(varlik('button.bina_ac', ad)), ad);
  }
});

test('h-03: "giriş" ve "entrance" eklenmedi (masum adlar geçer); örnek envanter yeni sözcüklerin hiçbirini içermez', () => {
  for (const ad of ['Giriş Lambası', 'Entrance Light', 'Giris', 'Hayal Lambası']) {
    assert.ok(guvenliVarlikMi(varlik('light.x', ad)), ad);
  }
  // Örnek envanterde yeni sözcüklerin hiçbiri yok: engelli liste aynı kalır (yukarıdaki envanter testi de bunu sınar).
  for (const o of envanter) {
    const metin = sadelestir(`${o.entity_id} ${o.friendly_name ?? ''}`);
    for (const sozcuk of H03_SOZCUKLERI) assert.ok(!metin.includes(sozcuk.toLowerCase()), `${o.entity_id}: ${sozcuk}`);
  }
});

test('h-03: cihaz sınıfı büyük/küçük harf duyarsız (Door, DOOR, Garage_Door, tam genişlik) ve sınıf metni de sözcük kuralından geçer', () => {
  for (const sinif of ['Door', 'DOOR', 'Garage_Door', 'GATE', 'Lock', 'Ｄｏｏｒ', ' door ', 'door_lock', 'Shutter']) {
    assert.ok(!guvenliVarlikMi(varlik('switch.x', 'Anahtar', { device_class: sinif })), JSON.stringify(sinif));
  }
  for (const sinif of ['outlet', 'OUTLET', 'switch', 'restart', 'identify', 'update', undefined, null]) {
    assert.ok(guvenliVarlikMi(varlik('switch.x', 'Anahtar', { device_class: sinif })), String(sinif));
  }
});

test('h-39: sahnenin üye listesi (attributes.entity_id) varsa kapı/kilit/kepenk üyesi sahneyi güvensiz yapar', () => {
  const sahne = (uyeler, ad = 'Akşam') => varlik('scene.aksam', ad, { entity_id: uyeler });
  assert.ok(guvenliVarlikMi(sahne(['light.salon', 'switch.priz', 'media_player.tv', 'climate.salon'])), 'zararsız üyeler');
  for (const uye of ['lock.on_kapi', 'lock.x', 'alarm_control_panel.ev', 'cover.perde', 'cover.garaj', 'switch.kapi_rolesi', 'switch.front_door', 'switch.diafon', 'script.kilidi_ac', 'switch.maingate', 'button.kepengi_ac']) {
    assert.ok(!guvenliVarlikMi(sahne(['light.salon', uye])), uye);
  }
  // Geçersiz/beklenmeyen biçim güvensiz sayılır (yalnız sıkılaştırma).
  for (const bozuk of [[42], ['Light.X'], ['light'], [null], {}, 7, ['light.a', '']]) {
    assert.ok(!guvenliVarlikMi(sahne(bozuk)), JSON.stringify(bozuk));
  }
  assert.ok(!guvenliVarlikMi(sahne('lock.on_kapi')), 'tek metin üye de denetlenir');
  assert.ok(guvenliVarlikMi(sahne('light.salon')));
  assert.ok(guvenliVarlikMi(sahne([])), 'boş liste: üye yok');
});

test('h-39: üye listesi yoksa bugünkü davranış (yalnız sahnenin kendi adı); grup üyeleri de aynı kuraldan geçer', () => {
  assert.ok(guvenliVarlikMi(varlik('scene.aksam', 'Akşam')));
  assert.ok(guvenliVarlikMi(varlik('scene.aksam', 'Akşam', { entity_id: undefined })));
  assert.ok(guvenliVarlikMi(varlik('scene.aksam', 'Akşam', { entity_id: null })));
  assert.ok(!guvenliVarlikMi(varlik('scene.kapi', 'Akşam')), 'sahnenin kendi adı yine denetlenir');
  // Işık/anahtar grubu: üyelerinden biri garaj rölesiyse grup da engellenir.
  assert.ok(!guvenliVarlikMi(varlik('switch.tum_roleler', 'Tüm röleler', { entity_id: ['switch.priz', 'switch.garaj_rolesi'] })));
  assert.ok(guvenliVarlikMi(varlik('light.salon_grubu', 'Salon', { entity_id: ['light.a', 'light.b'] })));
});

test('h-39: üye denetimi kapı kuralını gevşetmez (her yasak alan üye listesinde de yasak)', () => {
  const { uyelerGuvenliMi, UYE_YASAK_ALANLARI, YASAK_ALANLAR } = require('../src/lib/suzgec');
  for (const alan of YASAK_ALANLAR) assert.ok(UYE_YASAK_ALANLARI.has(alan), alan);
  assert.ok(UYE_YASAK_ALANLARI.has('cover'));
  assert.equal(uyelerGuvenliMi(undefined), true);
  assert.equal(uyelerGuvenliMi(['light.a']), true);
  assert.equal(uyelerGuvenliMi(['lock.a']), false);
});
