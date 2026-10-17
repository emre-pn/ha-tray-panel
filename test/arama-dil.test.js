'use strict';

/**
 * Palet komut sözcükleri: Almanca, Fransızca, İspanyolca (src/lib/arama.js). Türkçe ve İngilizce davranışı DEĞİŞMEZ.
 * Arama dilden bağımsızdır: her dilin sözcüğü her zaman geçerlidir. Sözlük anahtarları katlanmıştır (ü->u, é->e, ß->s, ñ->n);
 * kullanıcı aksanlı yazar, ikisi de çalışır. Kapı Kuralı: hiçbir sözlükte kapı/kilit/kepenk/alarm fiili yoktur (aç/kapat yalnız
 * turn_on / turn_off öğelerine gider).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { alanKomutu, katlaDizi, paletSorgusu, yonCoz } = require('../src/lib/arama');
const { servisDogrula } = require('../src/lib/servis-izinleri');

const kat = (m) => katlaDizi(m).join('');
const OZ = {
  light: { renkModlari: ['color_temp', 'hs'], enAzKelvin: 2200, enCokKelvin: 6500 },
  climate: { enAz: 16, enCok: 30, modlar: ['off', 'cool', 'heat', 'auto', 'fan_only', 'dry'] },
  media_player: { kaynaklar: ['HDMI 1', 'HDMI 2', 'Netflix'] },
  fan: { onAyarlar: ['Uyku', 'Turbo'] },
  humidifier: { enAz: 30, enCok: 80 },
  vacuum: {},
  timer: {},
};
const VARLIK = {
  climate: { entity_id: 'climate.salon', attributes: { min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'cool', 'heat', 'auto', 'fan_only', 'dry'] } },
  light: { entity_id: 'light.masa', attributes: { supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 } },
  media_player: { entity_id: 'media_player.tv', attributes: { source_list: ['HDMI 1', 'HDMI 2', 'Netflix'] } },
  fan: { entity_id: 'fan.v', attributes: { preset_modes: ['Uyku', 'Turbo'] } },
  humidifier: { entity_id: 'humidifier.n', attributes: { min_humidity: 30, max_humidity: 80 } },
  vacuum: { entity_id: 'vacuum.s', attributes: {} },
  timer: { entity_id: 'timer.mutfak', attributes: {} },
};
const komutu = (alan, sorgu) => alanKomutu({ alan, ozellik: OZ[alan] }, kat(sorgu));

// [alan, kullanıcının yazdığı kuyruk, beklenen { servis, tur, deger? }]
const BEKLENEN = [
  // ---- aç / kapat (her açılıp kapanabilen alan)
  ...['light', 'climate', 'media_player', 'fan', 'humidifier'].flatMap((alan) => [
    ...['an', 'ein', 'Einschalten', 'Anschalten', 'Allume', 'Allumer', 'Enciende', 'Encender', 'Prende'].map((s) => [alan, s, { servis: 'turn_on', tur: 'ac' }]),
    ...['aus', 'Ausschalten', 'Abschalten', 'Éteins', 'Éteindre', 'Eteint', 'Apaga', 'Apagar'].map((s) => [alan, s, { servis: 'turn_off', tur: 'kapat' }]),
  ]),
  // ---- ışık: beyaz tonları
  ['light', 'Warmweiß', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Warmweiss', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Neutralweiß', { servis: 'turn_on', tur: 'ton', deger: 'dogal' }],
  ['light', 'Kaltweiß', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  ['light', 'kalt', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  ['light', 'Blanc chaud', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Chaude', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Blanc naturel', { servis: 'turn_on', tur: 'ton', deger: 'dogal' }],
  ['light', 'Naturel', { servis: 'turn_on', tur: 'ton', deger: 'dogal' }],
  ['light', 'Blanc froid', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  ['light', 'Froid', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  ['light', 'Cálido', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Cálida', { servis: 'turn_on', tur: 'ton', deger: 'sicak' }],
  ['light', 'Neutro', { servis: 'turn_on', tur: 'ton', deger: 'dogal' }],
  ['light', 'Frío', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  ['light', 'Fría', { servis: 'turn_on', tur: 'ton', deger: 'soguk' }],
  // ---- ışık: renkler
  ...[
    ['Rot', 'kirmizi'], ['Gelb', 'sari'], ['Grün', 'yesil'], ['Gruen', 'yesil'], ['Türkis', 'turkuaz'], ['Tuerkis', 'turkuaz'], ['Blau', 'mavi'], ['Lila', 'mor'], ['Violett', 'mor'], ['Rosa', 'pembe'], ['Orange', 'turuncu'],
    ['Rouge', 'kirmizi'], ['Jaune', 'sari'], ['Vert', 'yesil'], ['Turquoise', 'turkuaz'], ['Bleu', 'mavi'], ['Mauve', 'mor'], ['Violette', 'mor'], ['Rose', 'pembe'],
    ['Rojo', 'kirmizi'], ['Naranja', 'turuncu'], ['Amarillo', 'sari'], ['Verde', 'yesil'], ['Turquesa', 'turkuaz'], ['Azul', 'mavi'], ['Morado', 'mor'], ['Violeta', 'mor'], ['Rosado', 'pembe'],
  ].map(([s, renk]) => ['light', s, { servis: 'turn_on', tur: 'renk', deger: renk }]),
  // ---- klima modları
  ...[
    ['Heizen', 'heat'], ['Heizung', 'heat'], ['Kühlen', 'cool'], ['Kuehlen', 'cool'], ['Kühlung', 'cool'], ['Automatik', 'auto'], ['Automatisch', 'auto'], ['Lüfter', 'fan_only'], ['Luefter', 'fan_only'], ['Trocknen', 'dry'], ['Entfeuchten', 'dry'], ['Trocken', 'dry'],
    ['Chauffage', 'heat'], ['Chauffer', 'heat'], ['Refroidir', 'cool'], ['Refroidissement', 'cool'], ['Froid', 'cool'], ['Automatique', 'auto'], ['Ventilateur', 'fan_only'], ['Ventilation', 'fan_only'], ['Sec', 'dry'], ['Déshumidifier', 'dry'],
    ['Calefacción', 'heat'], ['Calentar', 'heat'], ['Calor', 'heat'], ['Frío', 'cool'], ['Enfriar', 'cool'], ['Refrigerar', 'cool'], ['Refrigeración', 'cool'], ['Automático', 'auto'], ['Ventilador', 'fan_only'], ['Ventilación', 'fan_only'], ['Seco', 'dry'], ['Deshumidificar', 'dry'],
  ].map(([s, mod]) => ['climate', s, { servis: 'set_hvac_mode', tur: 'mod', deger: mod }]),
  // ---- medya
  ...['Stumm', 'Stummschalten', 'Muet', 'Silence', 'Sourdine', 'Silenciar', 'Mudo'].map((s) => ['media_player', s, { servis: 'volume_mute', tur: 'sessiz' }]),
  ...['Ton an', 'Stumm aus', 'Activer le son', 'Réactiver le son', 'Activar sonido', 'Quitar silencio', 'Desilenciar'].map((s) => ['media_player', s, { servis: 'volume_mute', tur: 'sesli' }]),
  ...['Abspielen', 'Wiedergabe', 'Pausieren', 'Fortsetzen', 'Lecture', 'Jouer', 'Mettre en pause', 'Reproducir', 'Pausa', 'Pausar', 'Reanudar'].map((s) => ['media_player', s, { servis: 'media_play_pause', tur: 'oynat' }]),
  ...['Weiter', 'Nächster', 'Naechster', 'Suivant', 'Suivante', 'Prochain', 'Siguiente', 'Próximo', 'Próxima'].map((s) => ['media_player', s, { servis: 'media_next_track', tur: 'sonraki' }]),
  ...['Zurück', 'Zurueck', 'Vorheriger', 'Précédent', 'Précédente', 'Anterior', 'Atrás'].map((s) => ['media_player', s, { servis: 'media_previous_track', tur: 'onceki' }]),
  ['media_player', 'Lautstärke 30', { servis: 'volume_set', tur: 'ses', deger: 30 }],
  ['media_player', 'Lautstaerke 30', { servis: 'volume_set', tur: 'ses', deger: 30 }],
  ['media_player', 'Volume 30', { servis: 'volume_set', tur: 'ses', deger: 30 }],
  ['media_player', 'Volumen 30', { servis: 'volume_set', tur: 'ses', deger: 30 }],
  ['media_player', 'Sonido 30', { servis: 'volume_set', tur: 'ses', deger: 30 }],
  ['media_player', 'Quelle Netflix', { servis: 'select_source', tur: 'kaynak', deger: 'Netflix' }],
  ['media_player', 'Eingang HDMI 2', { servis: 'select_source', tur: 'kaynak', deger: 'HDMI 2' }],
  ['media_player', 'Source HDMI 1', { servis: 'select_source', tur: 'kaynak', deger: 'HDMI 1' }],
  ['media_player', 'Entrée HDMI 1', { servis: 'select_source', tur: 'kaynak', deger: 'HDMI 1' }],
  ['media_player', 'Fuente Netflix', { servis: 'select_source', tur: 'kaynak', deger: 'Netflix' }],
  ['media_player', 'Entrada HDMI 2', { servis: 'select_source', tur: 'kaynak', deger: 'HDMI 2' }],
  // ---- süpürge
  ...['Starten', 'Reinigen', 'Saugen', 'Démarrer', 'Lancer', 'Nettoyer', 'Iniciar', 'Empezar', 'Comenzar', 'Limpiar'].map((s) => ['vacuum', s, { servis: 'start', tur: 'basla' }]),
  ...['Pausieren', 'Pauser', 'Mettre en pause', 'Pausar', 'Pausa'].map((s) => ['vacuum', s, { servis: 'pause', tur: 'duraklat' }]),
  ...['Zurück', 'Zurueck', 'Laden', 'Ladestation', 'Retour', 'Recharge', 'Recharger', 'Volver', 'Regresar', 'Recargar', 'Cargar', 'Base'].map((s) => ['vacuum', s, { servis: 'return_to_base', tur: 'sarj' }]),
  // ---- zamanlayıcı
  ...['Starten', 'Fortsetzen', 'Démarrer', 'Lancer', 'Reprendre', 'Iniciar', 'Empezar', 'Continuar', 'Reanudar'].map((s) => ['timer', s, { servis: 'start', tur: 'basla' }]),
  ...['Pausieren', 'Pauser', 'Mettre en pause', 'Pausar', 'Pausa'].map((s) => ['timer', s, { servis: 'pause', tur: 'duraklat' }]),
  ...['Abbrechen', 'Stoppen', 'Beenden', 'Annuler', 'Arrêter', 'Cancelar', 'Detener', 'Parar'].map((s) => ['timer', s, { servis: 'cancel', tur: 'iptal' }]),
];

test('DE/FR/ES komut sözcükleri: aksanlı ya da aksansız yazım aynı komutu üretir ve kuru geçişte servis izinlerinden geçer', () => {
  for (const [alan, sorgu, beklenen] of BEKLENEN) {
    const k = komutu(alan, sorgu);
    assert.ok(k && !k.hata, `${alan} "${sorgu}": komut yok (${JSON.stringify(k)})`);
    assert.equal(k.servis, beklenen.servis, `${alan} "${sorgu}" servis`);
    assert.equal(k.tur, beklenen.tur, `${alan} "${sorgu}" tür`);
    if (beklenen.deger !== undefined) assert.equal(k.deger, beklenen.deger, `${alan} "${sorgu}" değer`);
    const sonuc = servisDogrula(alan, k.servis, k.veri, VARLIK[alan]);
    assert.equal(sonuc.ok, true, `${alan} "${sorgu}": ${JSON.stringify(sonuc)}`);
  }
});

test('beyaz ton ve ses komutlarının ayrıntısı: kelvin cihaz aralığında, ses oranı 0-1', () => {
  assert.deepEqual(komutu('light', 'Kaltweiß').veri, { color_temp_kelvin: 6500 });
  assert.deepEqual(komutu('light', 'Blanc chaud').veri, { color_temp_kelvin: 2700 });
  assert.deepEqual(komutu('light', 'Rojo').veri, { rgb_color: [255, 0, 0] });
  assert.deepEqual(komutu('media_player', 'Lautstärke 30').veri, { volume_level: 0.3 });
  assert.deepEqual(komutu('media_player', 'Stumm').veri, { is_volume_muted: true });
  assert.deepEqual(komutu('media_player', 'Ton an').veri, { is_volume_muted: false });
  assert.deepEqual(komutu('media_player', 'Volumen 120'), { hata: 'sinir', alt: 0, ust: 100 });
});

test('cihaz desteklemiyorsa DE/FR/ES de "desteklenmiyor" der (renk yok, mod yok)', () => {
  const beyazIsik = { alan: 'light', ozellik: { renkModlari: ['brightness'] } };
  assert.deepEqual(alanKomutu(beyazIsik, kat('Rot')), { hata: 'desteklenmiyor' });
  assert.deepEqual(alanKomutu(beyazIsik, kat('Warmweiß')), { hata: 'desteklenmiyor' });
  const yalnizSogutma = { alan: 'climate', ozellik: { modlar: ['off', 'cool'] } };
  assert.deepEqual(alanKomutu(yalnizSogutma, kat('Heizen')), { hata: 'desteklenmiyor' });
  assert.equal(alanKomutu(yalnizSogutma, kat('Kühlen')).deger, 'cool');
});

test('palet: cümle içinde DE/FR/ES komutu (öğe adı + komut sözcüğü)', () => {
  const ogeler = [
    { etiket: 'Wohnzimmer Klima', alan: 'climate', ozellik: OZ.climate },
    { etiket: 'Lampe Tisch', alan: 'light', parlaklikKontrol: true, ozellik: OZ.light },
    { etiket: 'Fernseher', alan: 'media_player', ozellik: OZ.media_player },
    { etiket: 'Saugroboter', alan: 'vacuum', ozellik: {} },
  ];
  const ilk = (sorgu) => paletSorgusu(sorgu, ogeler).sonuclar[0];
  assert.equal(ilk('Wohnzimmer Klima kühlen').eylem.servis, 'set_hvac_mode');
  assert.equal(ilk('Wohnzimmer Klima kühlen').eylem.deger, 'cool');
  assert.equal(ilk('Lampe Tisch aus').eylem.servis, 'turn_off');
  assert.equal(ilk('Lampe Tisch Grün').eylem.deger, 'yesil');
  assert.equal(ilk('Fernseher Lautstärke 25').eylem.deger, 25);
  assert.equal(ilk('Fernseher Stumm').eylem.tur, 'sessiz');
  assert.equal(ilk('Fernseher Ton an').eylem.tur, 'sesli', '"Ton an": ayrı bir "an" komutu değil, iki sözcüklü sessizden çıkma');
  assert.equal(ilk('Saugroboter zurück').eylem.servis, 'return_to_base');
  assert.equal(ilk('Lampe Tisch blanc chaud').eylem.deger, 'sicak');
  assert.equal(ilk('Fernseher suivant').eylem.servis, 'media_next_track');
  assert.equal(ilk('Lampe Tisch apaga').eylem.servis, 'turn_off');
  assert.equal(ilk('Fernseher siguiente').eylem.servis, 'media_next_track');
  assert.equal(ilk('Saugroboter limpiar').eylem.servis, 'start');
});

test('yön sözdizimi: "<ad> an/aus/éteins/apaga/umschalten..." (kesin yönlü eylem) çözümlenir', () => {
  const yon = (m) => yonCoz(m)?.yon?.tur ?? null;
  for (const m of ['Wohnzimmer an', 'Wohnzimmer ein', 'Wohnzimmer einschalten', 'salon allume', 'salon Allumer', 'salon marche', 'salón enciende', 'salón encender', 'salón prende']) assert.equal(yon(m), 'ac', m);
  for (const m of ['Wohnzimmer aus', 'Wohnzimmer ausschalten', 'Wohnzimmer abschalten', 'salon éteins', 'salon éteindre', 'salon arrêt', 'salón apaga', 'salón apagar']) assert.equal(yon(m), 'kapat', m);
  for (const m of ['Lampe umschalten', 'Lampe wechseln', 'lampe basculer', 'lampe inverser', 'lampe alterner', 'luz alternar', 'luz conmutar', 'luz cambiar']) assert.equal(yon(m), 'degistir', m);
  assert.equal(yonCoz('Wohnzimmer aus').metin, 'Wohnzimmer');
  assert.equal(yonCoz('Lampe Tisch Éteins').metin, 'Lampe Tisch');
});

test('"Ses +/-" işaret sözcükleri: moins / menos / mas ("ses menos" -> "Ses −")', () => {
  const ogeler = [{ etiket: 'Ses +', alan: 'button' }, { etiket: 'Ses −', alan: 'button' }];
  const etiket = (s) => paletSorgusu(s, ogeler).sonuclar.map((r) => r.oge.etiket);
  assert.deepEqual(etiket('ses moins'), ['Ses −']);
  assert.deepEqual(etiket('ses menos'), ['Ses −']);
  assert.deepEqual(etiket('ses mas'), ['Ses +']);
  assert.deepEqual(etiket('ses plus'), ['Ses +'], 'plus (DE/FR/EN) zaten vardı');
  assert.deepEqual(etiket('ses minus'), ['Ses −']);
});

test('Kapı Kuralı: kapı/kilit/kepenk/alarm fiilleri (DE/FR/ES/TR/EN) hiçbir sözlükte komut değildir', () => {
  const KAPI_SOZLERI = [
    'öffnen', 'offnen', 'oeffnen', 'schließen', 'schliessen', 'verriegeln', 'entriegeln', 'aufschließen', 'abschließen', 'tür', 'tuer', 'tor', 'garage', 'garagentor', 'rollladen', 'rolladen', 'sirene', 'alarm', 'scharf', 'unscharf',
    'ouvrir', 'ouvre', 'fermer', 'ferme', 'verrouiller', 'déverrouiller', 'deverrouiller', 'porte', 'portail', 'volet', 'serrure', 'sirène', 'alarme', 'armer', 'désarmer', 'desarmer',
    'abrir', 'abre', 'cerrar', 'cierra', 'bloquear', 'desbloquear', 'cerradura', 'puerta', 'garaje', 'portón', 'persiana', 'sirena', 'alarma', 'armar', 'desarmar',
    'kilitle', 'kilit', 'kapi', 'kepenk', 'garaj', 'lock', 'unlock', 'open', 'close', 'arm', 'disarm', 'siren', 'gate', 'shutter',
  ];
  const alanlar = Object.keys(OZ).concat(['input_select', 'input_number', 'number', 'select']);
  for (const kelime of KAPI_SOZLERI) {
    if (kelime === 'kapi') continue; // yalnız "kapat/kapali" aç-kapat sözcüğüdür; "kapı" bir sözcük değildir (ad parçasıdır)
    for (const alan of alanlar) {
      const k = alanKomutu({ alan, ozellik: OZ[alan] ?? {} }, kat(kelime));
      assert.ok(!k || k.hata, `${alan} "${kelime}" komut üretmemeli: ${JSON.stringify(k)}`);
    }
    assert.equal(yonCoz(`salon ${kelime}`), null, `yön: "${kelime}" aç/kapat/değiştir değildir`);
  }
  // Aynı sözlüklerden çıkan her servis aç/kapat dışında kapı/kilit servisi değildir
  const yasakServisler = ['lock', 'unlock', 'open', 'open_cover', 'close_cover', 'alarm_arm_away', 'alarm_disarm', 'trigger'];
  for (const [alan, sorgu] of BEKLENEN.map(([a, s]) => [a, s])) {
    const k = komutu(alan, sorgu);
    assert.ok(!yasakServisler.includes(k.servis), `${alan} "${sorgu}" -> ${k.servis}`);
  }
});

test('Türkçe ve İngilizce komutlar değişmeden çalışır (gerileme koruması)', () => {
  assert.equal(komutu('light', 'ac').servis, 'turn_on');
  assert.equal(komutu('light', 'kapat').servis, 'turn_off');
  assert.equal(komutu('light', 'on').servis, 'turn_on');
  assert.equal(komutu('light', 'off').servis, 'turn_off');
  assert.equal(komutu('light', 'sicak').deger, 'sicak');
  assert.equal(komutu('light', 'Warm').deger, 'sicak');
  assert.equal(komutu('light', 'kırmızı').deger, 'kirmizi');
  assert.equal(komutu('light', 'red').deger, 'kirmizi');
  assert.equal(komutu('light', '3000k').veri.color_temp_kelvin, 3000);
  assert.equal(komutu('climate', '24').veri.temperature, 24);
  assert.equal(komutu('climate', 'ısıt').deger, 'heat');
  assert.equal(komutu('climate', 'cool').deger, 'cool');
  assert.equal(komutu('climate', 'fan').deger, 'fan_only');
  assert.equal(komutu('media_player', 'ses 30').deger, 30);
  assert.equal(komutu('media_player', 'volume 30').deger, 30);
  assert.equal(komutu('media_player', 'sessiz').servis, 'volume_mute');
  assert.equal(komutu('media_player', 'kaynak netflix').deger, 'Netflix');
  assert.equal(komutu('media_player', 'source hdmi 1').deger, 'HDMI 1');
  assert.equal(komutu('media_player', 'sonraki').servis, 'media_next_track');
  assert.equal(komutu('media_player', 'önceki').servis, 'media_previous_track');
  assert.equal(komutu('vacuum', 'başla').servis, 'start');
  assert.equal(komutu('vacuum', 'şarja dön').servis, 'return_to_base');
  assert.equal(komutu('timer', 'iptal').servis, 'cancel');
  assert.equal(komutu('timer', 'cancel').servis, 'cancel');
  assert.equal(yonCoz('salon aç').yon.tur, 'ac');
  assert.equal(yonCoz('salon KAPAT').yon.tur, 'kapat');
  assert.equal(yonCoz('salon toggle').yon.tur, 'degistir');
  assert.deepEqual(yonCoz('led +10'), { metin: 'led', yon: { tur: 'goreli', delta: 10 } });
  // Türkçe sözcükler DE/FR/ES eklemelerinden etkilenmez: "son", "fan", "tv ses" gibi sıradan Türkçe yazımlar komut olmaz
  assert.equal(komutu('media_player', 'son'), null);
  assert.equal(komutu('light', 'son'), null);
  assert.equal(komutu('light', 'ev'), null);
  assert.equal(yonCoz('salon son'), null);
});
