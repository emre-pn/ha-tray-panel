'use strict';

/**
 * KAPI KURALI: Almanca, Fransızca ve İspanyolca kapı/kilit/geçit/diafon adları (src/lib/suzgec.js YASAK_EK_*). Arayüz bu dillere
 * açıldığı için kapı açıcıların adları da bu dillerde olur; eskiden yalnız TR/EN sözcükler tanınıyordu ve "Türöffner", "Ouvrir le
 * portail", "Abrir puerta" gibi adlar tepsi menüsü, kısayol, komut satırı ve masaüstü karosundan onaysız çalışabiliyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adGuvenliMi,
  guvenliVarlikMi,
  metinGuvenliMi,
  guvenliMetin,
  metinListesiSuz,
  sadelestir,
  YASAK_PARCALAR,
  YASAK_KISA_PARCALAR,
  YASAK_EK_PARCALAR,
  YASAK_EK_BELIRTEC_BASLARI,
  YASAK_EK_BAS_ISTISNASI,
  YASAK_EK_TAM_BELIRTECLER,
  EK_DIL_ORNEKLERI,
} = require('../src/lib/suzgec');
const { eylemSinifi, kaynakIzni, SINIF, KAYNAKLAR } = require('../src/lib/eylem-sinifi');
const AYARLAR = require('../src/lib/ceviri/ayarlar');

const varlik = (kimlik, ad) => ({ entity_id: kimlik, state: 'off', attributes: ad === undefined ? {} : { friendly_name: ad } });

// Bulguda sınanan sahte varlıklar: hepsi eskiden GEÇİYORDU.
const KAPI_VARLIKLARI = [
  ['switch.turoffner', 'Türöffner'],
  ['switch.haustur_offner', 'Haustür öffnen'],
  ['button.portail', 'Ouvrir le portail'],
  ['switch.serrure', 'Serrure'],
  ['switch.porte_entree', "Porte d'entrée"],
  ['switch.puerta', 'Abrir puerta'],
  ['switch.cerradura', 'Cerradura'],
  ['switch.schloss', 'Schloss'],
  ['switch.hoftor', 'Hoftor'],
  ['switch.rolltor', 'Rolltor'],
  ['switch.klingel', 'Klingel'],
  ['switch.sonnette', 'Sonnette'],
  ['switch.interphone', 'Interphone'],
  ['switch.gegensprechanlage', 'Gegensprechanlage'],
];

test('bulgu: Almanca/Fransızca/İspanyolca kapı açıcılar (kimlikte ya da adda) süzgeçten geçmez', () => {
  for (const [kimlik, ad] of KAPI_VARLIKLARI) {
    assert.equal(guvenliVarlikMi(varlik(kimlik, ad)), false, `${kimlik} / ${ad}`);
    assert.equal(guvenliVarlikMi(varlik(kimlik, 'Röle')), false, `${kimlik} (yalnız kimlik)`);
    assert.equal(guvenliVarlikMi(varlik('switch.role_1', ad)), false, `${ad} (yalnız ad)`);
  }
});

test('bulgu: bu varlıklar eylem hattında YASAK sınıfındadır ve HİÇBİR yüzeyden (tepsi, kısayol, komut satırı, masaüstü, panel, palet) çalışmaz', () => {
  for (const [kimlik, ad] of KAPI_VARLIKLARI) {
    for (const favori of [undefined, { onay: false }, { onay: true }]) {
      const s = eylemSinifi(varlik(kimlik, ad), favori);
      assert.equal(s.sinif, SINIF.YASAK, `${kimlik} ${JSON.stringify(favori)}`);
      for (const kaynak of KAYNAKLAR) assert.equal(kaynakIzni(s.sinif, kaynak).izin, false, `${kimlik} ${kaynak}`);
    }
    assert.equal(eylemSinifi(varlik(kimlik, ad), undefined, 'turn_on').sinif, SINIF.YASAK, `${kimlik} (servisle)`);
  }
});

test('bulgu: metin yüzeyleri (takvim/yapılacaklar adı, bildirim, uyarı metni) de bu dillerdeki kapı sözcüklerini süzer', () => {
  for (const metin of ['Haustür offen', 'Puerta abierta', 'Portail ouvert', 'Das Tor ist offen', 'Porte ouverte', 'Cerradura bloqueada', 'Klingel hat geläutet', 'Sonnette de la porte']) {
    assert.equal(metinGuvenliMi(metin), false, metin);
    assert.equal(guvenliMetin(metin), null, metin);
  }
  assert.deepEqual(metinListesiSuz(['HDMI 1', 'Haustür', 'Puerta', 'Spotify', 'Portail', 'Tor']), ['HDMI 1', 'Spotify']);
  // Kısaltma süzgeçten ÖNCE yapılır, ama tam metin de denetlenir: temiz görünen kesik, kapı sözcüğünü taşıyan metni geçirmez.
  assert.equal(guvenliMetin('Wohnzimmer Lampe an Haustür', 12), null);
});

test('her yeni sözcük adda ve kimlikte, her alanda, büyük harf / tam genişlik / görünmez karakter / bitişik yazımla da engellenir', () => {
  const tamGenislik = (k) => [...k].map((c) => (/[a-z]/i.test(c) ? String.fromCodePoint(c.charCodeAt(0) + 0xfee0) : c)).join('');
  const sozcukler = ['Tür', 'Tor', 'Schloss', 'Klingel', 'Gegensprechanlage', 'Haustür', 'Türöffner', 'Hoftor', 'porte', 'portail', 'serrure', 'verrou', 'interphone', 'sonnette', 'puerta', 'portón', 'cerradura', 'cerrojo', 'cancela', 'portero', 'timbre', 'barrera', 'candado', 'Nuki'];
  const donusumler = [
    (k) => k,
    (k) => k.toLocaleUpperCase('tr-TR'),
    tamGenislik,
    (k) => `${k.slice(0, 2)}\u00AD${k.slice(2)}`,
    (k) => `${k.slice(0, 1)}\u200B${k.slice(1)}`,
    (k) => `Salon ${k} Röle`,
    (k) => `salon_${k}_rolesi`,
  ];
  for (const sozcuk of sozcukler) {
    for (const donustur of donusumler) {
      const ad = donustur(sozcuk);
      if (donustur !== donusumler[0]) assert.notEqual(ad, sozcuk, `dönüşüm girdiyi değiştirmeli (görünmez karakter silinirse kimliğe düşer): ${JSON.stringify(sozcuk)}`);
      for (const alan of ['light', 'switch', 'climate', 'sensor', 'binary_sensor', 'calendar', 'todo', 'media_player', 'input_select']) {
        assert.equal(guvenliVarlikMi(varlik(`${alan}.x`, ad)), false, `${alan}: ${JSON.stringify(ad)}`);
      }
    }
  }
});

test('"ue/oe/ss" yazımları ve Türkçe harf katlaması: Tueroeffner, Haustuer, Garagentuer, TÜR, SCHLOSS', () => {
  for (const ad of ['Tueroeffner', 'Haustuer', 'Haustueren', 'TÜR', 'TUR', 'SCHLOSS', 'Toroeffner', 'KLINGEL', 'Wohnungstür', 'Kellertür', 'Terrassentür', 'Balkontür', 'Eingangstür', 'Schiebetür', 'Haustürklingel', 'Türkontakt', 'Gartentor', 'Einfahrtstor', 'Garagentor', 'Torantrieb', 'Rolladen', 'Rollläden', 'Parkplatzschranke', 'Schlagbaum']) {
    assert.equal(guvenliVarlikMi(varlik('switch.x', ad)), false, ad);
    assert.equal(guvenliVarlikMi(varlik(`switch.${sadelestir(ad)}`, 'Röle')), false, `kimlik: ${ad}`);
  }
});

test('Fransızca/İspanyolca bileşik ve eklerle: portail automatique, Porte-fenêtre, portillon, videoportero, Abrepuertas, interfono, telefonillo, verrouillage, cerrojo', () => {
  for (const ad of ['Portail automatique', 'Porte-fenêtre', 'Portillon', 'Videoportero', 'Abrepuertas', 'Interfono', 'Telefonillo', 'Verrouillage', 'Déverrouiller', 'Cerrojo eléctrico', 'Candados', 'Persianas', 'Volets roulants', 'Barrière du parking', 'Visiophone', 'Digicode', 'Portón del garaje', 'Cancela de la entrada', 'Verja']) {
    assert.equal(guvenliVarlikMi(varlik('switch.x', ad)), false, ad);
  }
});

test('akıllı kilit markaları: nuki, kwikset, ttlock, tedee, ultraloq (adlarında "lock" geçmeyenler)', () => {
  for (const ad of ['Nuki', 'Nuki Smart Lock Pro', 'Kwikset Halo', 'TTLock Giriş', 'Tedee GO', 'Ultraloq U-Bolt']) {
    assert.equal(guvenliVarlikMi(varlik('switch.x', ad)), false, ad);
  }
  assert.equal(guvenliVarlikMi(varlik('switch.nuki_bad', 'Bad')), false);
});

test('eş anlamlı kapı adları da engellenir (Pforte, Pförtner, grille, gâche, cochera, reja, portal): hem adda hem kimlikte', () => {
  for (const ad of ['Pforte', 'Gartenpforte öffnen', 'Pförtner', 'Pfoertner', 'Grille du jardin', 'Ouvrir la grille', 'Gâche électrique', 'Cochera', 'Abrir cochera', 'Reja jardín', 'Portal']) {
    assert.equal(guvenliVarlikMi(varlik('light.x', ad)), false, ad);
    assert.equal(metinGuvenliMi(ad), false, ad);
  }
  for (const kimlik of ['switch.gartenpforte', 'button.cochera_abrir', 'switch.grille_jardin', 'switch.gache_electrique', 'switch.reja_jardin', 'button.portal_abrir', 'switch.pfortner']) {
    assert.equal(guvenliVarlikMi(varlik(kimlik, undefined)), false, kimlik);
    assert.equal(metinGuvenliMi(kimlik.split('.')[1].replace(/_/g, ' ')), false, kimlik);
  }
  // kısa sözcükler yalnız TAM belirteç: benzer masum adlar geçer
  for (const ad of ['Grillen Terrasse', 'Grill', 'Gâchette', 'Portátil', 'Einfahrt', 'Entrada', 'Rollo', 'Jalousie', 'Rideau', 'Toldo']) {
    assert.equal(guvenliVarlikMi(varlik('light.x', ad)), true, ad);
    assert.equal(metinGuvenliMi(ad), true, ad);
  }
});

test('masum adlar etkilenmez: tor / tür / porte yalnız TAM belirteç ya da belirteç başı; monitor, motor, sensor, reporter, temperatur... geçer', () => {
  const masumlar = [
    // "tor" ile biten ya da "tor" içeren yaygın sözcükler
    'Monitor Schreibtisch', 'Motor', 'Rotor', 'Ventilator Schlafzimmer', 'Detektor', 'Aktor', 'Generator', 'Projektor', 'Sektor', 'Faktor', 'Torte',
    'Interruptor salón', 'Calefactor', 'Detector de humo', 'Reproductor de música', 'Proyector', 'Extractor', 'Regulador', 'Smoke Detector', 'Doctor', 'Actor',
    // "tur" / "tür" ile bitenler
    'Temperatur Wohnzimmer', 'Außentemperatur', 'Raumtemperatur', 'Natur', 'Kultur', 'Tastatur', 'Struktur', 'Reparatur', 'Armatur', 'Agentur',
    // "porte" ile başlayıp kapı olmayanlar / içinde "porte" geçenler
    'Reporter', 'Importer', 'Exporter', 'Transporter', 'Supporter', 'Porter', 'Portable Speaker', 'Portátil', 'Support TV', 'Importe', 'Transporte', 'Importieren', 'Transportieren', 'Exportieren',
    // "cancela" / "cadena" / "puerto" / "timbre" benzerleri
    'Cancelar', 'Cancelado', 'Cadena Ser', 'Puerto USB', 'Haustier Futter', 'Hausnummer',
    // sıradan günlük adlar (DE/FR/ES/EN/TR)
    'Stehlampe Wohnzimmer', 'Küche Deckenlicht', 'Steckdose Kaffeemaschine', 'Rauchmelder Flur', 'Bewegungsmelder', 'Luftfeuchtigkeit Bad', 'Thermostat',
    'Lampe salon', 'Capteur de mouvement', 'Ventilateur chambre', 'Prise cuisine', 'Température salon',
    'Luz salón', 'Enchufe cocina', 'Ventilador dormitorio', 'Aspirador', 'Humedad baño', 'Termostato',
    'Salon lamp', 'Bedroom fan', 'Salon lambası', 'Gece lambası',
  ];
  for (const ad of masumlar) {
    assert.equal(guvenliVarlikMi(varlik('light.x', ad)), true, ad);
    assert.equal(metinGuvenliMi(ad), true, ad);
  }
  for (const kimlik of ['sensor.wohnzimmer_temperatur', 'sensor.monitor_strom', 'sensor.motor_drehzahl', 'switch.ventilator_bad', 'light.reporter_lampe', 'sensor.aussentemperatur']) {
    assert.equal(guvenliVarlikMi(varlik(kimlik, undefined)), true, kimlik);
  }
});

test('tam belirteç kuralı: "tor" ve "tür" yalnız tek başlarına (ya da bilinen bileşikte) engellenir; sözcük ayraçla bölününce de', () => {
  for (const ad of ['Tor', 'tor auf', 'Haus-Tor', 'Tor_2', 'Tür', 'Tür offen', 'Haus Tür', 'Toren', 'Türen', 'TOR']) {
    assert.equal(guvenliVarlikMi(varlik('switch.x', ad)), false, ad);
  }
  assert.ok(YASAK_EK_TAM_BELIRTECLER.has('tor') && YASAK_EK_TAM_BELIRTECLER.has('tur'));
  // "tor" / "tur" / "porte" parça olarak aranmaz: aksi halde monitor / temperatur / reporter engellenirdi
  assert.ok(!YASAK_EK_PARCALAR.includes('tor') && !YASAK_EK_PARCALAR.includes('tur') && !YASAK_EK_PARCALAR.includes('porte'));
  assert.ok(YASAK_EK_BELIRTEC_BASLARI.includes('porte'));
  assert.deepEqual([...YASAK_EK_BAS_ISTISNASI].sort(), ['porter', 'porters']);
});

test('sözlük tutarlılığı: yeni sözcükler sadeleştirilmiş biçimde (küçük harf, aksansız), TR/EN listelerine dokunulmadı ve mevcut masum sözcükler hâlâ geçer', () => {
  for (const parca of [...YASAK_EK_PARCALAR, ...YASAK_EK_BELIRTEC_BASLARI, ...YASAK_EK_TAM_BELIRTECLER]) {
    assert.equal(sadelestir(parca), parca, `${parca}: sadeleştirilmiş olmalı`);
    assert.match(parca, /^[a-z0-9]+$/, parca);
  }
  assert.equal(new Set(YASAK_EK_PARCALAR).size, YASAK_EK_PARCALAR.length, 'yinelenen sözcük yok');
  // Önceki kurallar aynen: TR/EN listeleri yeni dillerin sözcüklerini taşımaz (ayrı sözlük)
  for (const eski of [...YASAK_PARCALAR, ...YASAK_KISA_PARCALAR]) assert.ok(!YASAK_EK_PARCALAR.includes(eski), eski);
  for (const ad of ['Navigate Mode', 'Clock Light', 'Block Switch', 'Indoor Lamp', 'Outdoor Işık', 'Giriş Lambası', 'Entrance Light', 'Wireless ışık']) {
    assert.equal(guvenliVarlikMi(varlik('light.x', ad)), true, ad);
  }
  // TR/EN kapı adları aynen engelli
  for (const ad of ['Kapı', 'Front door', 'Garaj', 'Gate', 'Lock', 'Alarm', 'Siren', 'Kilit']) assert.equal(adGuvenliMi('', ad), false, ad);
});

test('arayüzde gösterilen örnek sözcükler (EK_DIL_ORNEKLERI) süzgeçte engellidir ve Almanca/Fransızca/İspanyolca kural metnindeki liste bunlarla aynıdır', () => {
  const tum = Object.values(EK_DIL_ORNEKLERI).flat();
  for (const sozcuk of tum) assert.equal(adGuvenliMi('', sozcuk), false, `${sozcuk} engelli olmalı`);
  for (const dil of ['de', 'fr', 'es']) {
    const metin = AYARLAR[dil]['ayar.guvenlik.metin'];
    for (const sozcuk of tum) assert.ok(metin.includes(sozcuk), `${dil}: kural metninde "${sozcuk}" yok`);
    // kuralın kendisi (güvence cümlesi) korunur; artık yalnız TR/EN sözcüklerle sınırlı olmadığı açıkça yazılıdır
    assert.match(metin, dil === 'de' ? /Gesperrt sind auch die entsprechenden deutschen, französischen und spanischen Wörter/ : dil === 'fr' ? /Les mots équivalents en allemand, en français et en espagnol sont bloqués aussi/ : /También se bloquean las palabras equivalentes en alemán, francés y español/);
  }
});
