'use strict';

/**
 * 1.4.0 palet servis komutları (src/lib/arama.js alanKomutu / paletSorgusu): "klima 24", "masa sicak", "tv ses 30"...
 * Komut yalnız bir öneridir; asıl doğrulama ana süreçteki eylem hattındadır (test/servis-izinleri.test.js, eylem-hatti.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { alanKomutu, katlaDizi, komutluAlanMi, kuyrukBolumleri, paletSorgusu, BEYAZ_TONLAR, RENK_PALETI } = require('../src/lib/arama');
const { servisDogrula } = require('../src/lib/servis-izinleri');

const kat = (m) => katlaDizi(m).join('');
const KLIMA = { etiket: 'Salon klima', alan: 'climate', ozellik: { enAz: 16, enCok: 30, adim: 0.5, modlar: ['off', 'cool', 'heat', 'auto'], hedefSicaklik: 22 } };
const KLIMA2 = { etiket: 'Yatak klima', alan: 'climate', ozellik: { enAz: 16, enCok: 30, adim: 1, modlar: ['off', 'cool'], hedefSicaklik: 24 } };
const MASA = { etiket: 'Masa', alan: 'light', parlaklikKontrol: false, ozellik: { renkModlari: ['color_temp', 'hs'], enAzKelvin: 2200, enCokKelvin: 6500 } };
const TAVAN = { etiket: 'Tavan', alan: 'light', parlaklikKontrol: true, ozellik: { renkModlari: ['brightness'] } };
const TV = { etiket: 'TV', alan: 'media_player', ozellik: { kaynaklar: ['HDMI 1', 'HDMI 2', 'Netflix'], durum: 'playing' } };
const FAN = { etiket: 'Vantilatör', alan: 'fan', ozellik: { onAyarlar: ['Uyku', 'Turbo'], adimYuzde: 25 } };
const NEM = { etiket: 'Nem alıcı', alan: 'humidifier', ozellik: { enAz: 30, enCok: 80 } };
const SUPURGE = { etiket: 'Süpürge', alan: 'vacuum', ozellik: { durum: 'docked' } };
const SECICI = { etiket: 'Ev modu', alan: 'input_select', ozellik: { secenek: 'Ev', secenekler: ['Ev', 'Dışarıda', 'Uyku', 'Uzun yolculuk'] } };
const SAYI = { etiket: 'Eşik', alan: 'input_number', ozellik: { deger: 5, enAz: 0, enCok: 10, adim: 1 } };
const SAYI_SINIRSIZ = { etiket: 'Sınırsız', alan: 'number', ozellik: { deger: 5 } };
const ZAMANLAYICI = { etiket: 'Mutfak', alan: 'timer', ozellik: { durum: 'idle' } };
const SAHNE = { etiket: 'Film', alan: 'scene' };
const OGELER = [KLIMA, KLIMA2, MASA, TAVAN, TV, FAN, NEM, SUPURGE, SECICI, SAYI, SAYI_SINIRSIZ, ZAMANLAYICI, SAHNE];

const eylemi = (sorgu, ogeler = OGELER) => paletSorgusu(sorgu, ogeler).sonuclar[0]?.eylem ?? null;
const satir = (sorgu, ogeler = OGELER) => paletSorgusu(sorgu, ogeler).sonuclar[0];
const komutu = (oge, kuyruk) => alanKomutu(oge, kat(kuyruk));

test('klima: "klima 24" sıcaklık ayarlar; ondalık nokta ya da virgül; ad eşleşen tüm klimalara satır verir', () => {
  const s = paletSorgusu('klima 24', OGELER).sonuclar;
  assert.deepEqual(s.map((r) => r.oge.etiket).sort(), ['Salon klima', 'Yatak klima']);
  assert.deepEqual(s[0].eylem, { servis: 'set_temperature', veri: { temperature: 24 }, tur: 'sicaklik', deger: 24 });
  assert.deepEqual(eylemi('salon klima 23,5').veri, { temperature: 23.5 });
  assert.deepEqual(eylemi('salon klima 23.5').veri, { temperature: 23.5 });
  assert.equal(satir('salon 24').oge, KLIMA, 'baş kısım adın yalnız bir parçası olabilir');
});

test('klima: aralık dışı değer satırda "sinir" olur, eylem üretilmez; cihaz sınırı yoksa mutlak sınır (-50..100)', () => {
  const r = satir('salon klima 40');
  assert.equal(r.eylem, null);
  assert.equal(r.komutHatasi, 'sinir');
  assert.equal(satir('salon klima 10').komutHatasi, 'sinir');
  assert.equal(komutu({ alan: 'climate', ozellik: {} }, '101').hata, 'sinir');
  assert.equal(komutu({ alan: 'climate', ozellik: {} }, '35').servis, 'set_temperature');
  assert.equal(komutu(KLIMA, '%24'), null, 'yüzde klimada sıcaklık değildir');
});

test('klima: kapat/aç ve mod sözcükleri; cihaz modu desteklemiyorsa "desteklenmiyor"', () => {
  assert.equal(eylemi('salon klima kapat').servis, 'turn_off');
  assert.equal(eylemi('salon klima ac').servis, 'turn_on');
  assert.deepEqual(eylemi('salon klima isit'), { servis: 'set_hvac_mode', veri: { hvac_mode: 'heat' }, tur: 'mod', deger: 'heat' });
  assert.deepEqual(eylemi('salon klima sogut').veri, { hvac_mode: 'cool' });
  assert.deepEqual(eylemi('salon klima oto').veri, { hvac_mode: 'auto' });
  assert.equal(satir('yatak klima isit').komutHatasi, 'desteklenmiyor');
  assert.equal(satir('yatak klima isit').eylem, null);
  assert.deepEqual(komutu({ alan: 'climate', ozellik: { modlar: ['heat_cool'] } }, 'oto').veri, { hvac_mode: 'heat_cool' }, 'auto yoksa heat_cool');
});

test('ışık rengi: sıcak/doğal/soğuk beyaz cihazın kelvin aralığına kırpılır; "3000k"; renk adı rgb olur', () => {
  assert.deepEqual(eylemi('masa sicak'), { servis: 'turn_on', veri: { color_temp_kelvin: 2700 }, tur: 'ton', deger: 'sicak', kelvin: 2700 });
  assert.deepEqual(eylemi('masa dogal').veri, { color_temp_kelvin: 4000 });
  assert.deepEqual(eylemi('masa soguk').veri, { color_temp_kelvin: BEYAZ_TONLAR.soguk });
  assert.deepEqual(eylemi('masa warm').veri, { color_temp_kelvin: 2700 }, 'İngilizce sözcük de geçerli');
  assert.deepEqual(eylemi('masa 3000k').veri, { color_temp_kelvin: 3000 });
  assert.deepEqual(eylemi('masa 3000 k').veri, { color_temp_kelvin: 3000 });
  assert.deepEqual(eylemi('masa 1800k').veri, { color_temp_kelvin: 2200 }, 'alt sınıra kırpılır');
  assert.equal(satir('masa 50000k').komutHatasi, 'sinir');
  assert.deepEqual(eylemi('masa kirmizi'), { servis: 'turn_on', veri: { rgb_color: [255, 0, 0] }, tur: 'renk', deger: 'kirmizi' });
  assert.deepEqual(eylemi('masa mavi').veri.rgb_color, [...RENK_PALETI.mavi]);
  assert.deepEqual(eylemi('masa kapat').servis, 'turn_off');
});

test('ışık rengi: renk desteklemeyen ışıkta satır "desteklenmiyor" olur; "ışık 40" gibi parlaklık söz dizimi bozulmaz', () => {
  const s = satir('tavan sicak');
  assert.equal(s.oge, TAVAN);
  assert.equal(s.komutHatasi, 'desteklenmiyor');
  assert.equal(s.eylem, null);
  const parlak = paletSorgusu('tavan 40', OGELER);
  assert.equal(parlak.sonuclar[0].oge, TAVAN);
  assert.equal(parlak.sonuclar[0].parlaklik, 40);
  assert.equal(parlak.sonuclar[0].eylem, undefined, 'parlaklık komutu eski şekli korur');
  assert.equal(paletSorgusu('tavan 0', OGELER).sonuclar[0].kapat, true);
});

test('ışık: yalnız beyaz ton + parlaklık aynı sorguda: komut satırları ve parlaklık satırı puan sırasıyla birleşir', () => {
  const sorgu = paletSorgusu('masa 40', [MASA, { ...TAVAN, etiket: 'Masa lambası', parlaklikKontrol: true }, KLIMA]);
  const parlak = sorgu.sonuclar.find((r) => r.oge.etiket === 'Masa lambası');
  assert.equal(parlak.parlaklik, 40);
  assert.ok(!sorgu.sonuclar.some((r) => r.oge === KLIMA), 'ad eşleşmeyen klima gelmez');
});

test('medya: ses, sessiz, oynat/duraklat, sonraki/önceki, aç/kapat', () => {
  assert.deepEqual(eylemi('tv ses 30'), { servis: 'volume_set', veri: { volume_level: 0.3 }, tur: 'ses', deger: 30 });
  assert.deepEqual(eylemi('tv ses %45').veri, { volume_level: 0.45 });
  assert.deepEqual(eylemi('tv volume 5').veri, { volume_level: 0.05 });
  assert.equal(eylemi('tv ses 0').veri.volume_level, 0);
  assert.equal(satir('tv ses 130').komutHatasi, 'sinir');
  assert.deepEqual(eylemi('tv sessiz'), { servis: 'volume_mute', veri: { is_volume_muted: true }, tur: 'sessiz', deger: undefined });
  assert.deepEqual(eylemi('tv sesli').veri, { is_volume_muted: false });
  assert.equal(eylemi('tv oynat').servis, 'media_play_pause');
  assert.equal(eylemi('tv duraklat').servis, 'media_play_pause');
  assert.equal(eylemi('tv sonraki').servis, 'media_next_track');
  assert.equal(eylemi('tv onceki').servis, 'media_previous_track');
  assert.equal(eylemi('tv kapat').servis, 'turn_off');
  assert.equal(eylemi('tv ac').servis, 'turn_on');
  assert.equal(komutu(TV, '30'), null, 'çıplak sayı medyada ses değildir (yanlışlıkla gürültü olmasın)');
});

test('medya: kaynak seçimi cihazın listesinden (tam, ön ek ya da tek içerme eşleşmesi); listede olmayan kaynak seçilmez', () => {
  assert.deepEqual(eylemi('tv kaynak hdmi 2'), { servis: 'select_source', veri: { source: 'HDMI 2' }, tur: 'kaynak', deger: 'HDMI 2' });
  assert.deepEqual(eylemi('tv hdmi 2').veri, { source: 'HDMI 2' }, 'çıplak kaynak adı tam eşleşmede');
  assert.deepEqual(eylemi('tv kaynak net').veri, { source: 'Netflix' }, 'tek ön ek eşleşmesi');
  assert.equal(satir('tv kaynak hdmi').komutHatasi, 'desteklenmiyor', 'iki kaynak eşleşirse belirsiz: seçilmez');
  assert.equal(satir('tv kaynak xyz').komutHatasi, 'desteklenmiyor');
  assert.equal(komutu(TV, 'hdmi'), null, 'çıplak ön ek komut değildir');
});

test('vantilatör: yüzde ve ön ayar (cihazın listesinden); nem alıcı: hedef nem cihazın aralığında', () => {
  assert.deepEqual(eylemi('vantilator 60'), { servis: 'set_percentage', veri: { percentage: 60 }, tur: 'yuzde', deger: 60 });
  assert.deepEqual(eylemi('vantilator 60%').veri, { percentage: 60 });
  assert.equal(satir('vantilator 120').komutHatasi, 'sinir');
  assert.equal(komutu(FAN, '60.5'), null, 'ondalık yüzde yok');
  assert.deepEqual(eylemi('vantilator uyku'), { servis: 'set_preset_mode', veri: { preset_mode: 'Uyku' }, tur: 'onAyar', deger: 'Uyku' });
  assert.equal(komutu(FAN, 'rüzgar'), null);
  assert.deepEqual(eylemi('nem alici 55').veri, { humidity: 55 });
  assert.equal(satir('nem alici 20').komutHatasi, 'sinir');
  assert.equal(eylemi('nem alici kapat').servis, 'turn_off');
});

test('süpürge ve zamanlayıcı: yalnız sabit sözcükler (başla, duraklat, şarja dön / iptal)', () => {
  assert.equal(eylemi('supurge basla').servis, 'start');
  assert.equal(eylemi('supurge duraklat').servis, 'pause');
  assert.equal(eylemi('supurge sarj').servis, 'return_to_base');
  assert.equal(eylemi('supurge sarja don').servis, 'return_to_base');
  assert.equal(komutu(SUPURGE, 'ac'), null);
  assert.equal(eylemi('mutfak baslat').servis, 'start');
  assert.equal(eylemi('mutfak duraklat').servis, 'pause');
  assert.equal(eylemi('mutfak iptal').servis, 'cancel');
  assert.equal(komutu(ZAMANLAYICI, 'kapat'), null);
});

test('seçici: son sözcük(ler) cihazın seçeneklerinden biri (tam, ön ek); sayı: cihazın aralığında', () => {
  assert.deepEqual(eylemi('ev modu uyku'), { servis: 'select_option', veri: { option: 'Uyku' }, tur: 'secenek', deger: 'Uyku' });
  assert.deepEqual(eylemi('ev modu disarida').veri, { option: 'Dışarıda' });
  assert.deepEqual(eylemi('ev modu dis').veri, { option: 'Dışarıda' }, 'tek ön ek');
  assert.deepEqual(eylemi('ev modu uzun yolculuk').veri, { option: 'Uzun yolculuk' }, 'çok sözcüklü seçenek');
  assert.equal(satir('ev modu bilinmeyen'), undefined);
  assert.deepEqual(eylemi('esik 7'), { servis: 'set_value', veri: { value: 7 }, tur: 'sayi', deger: 7 });
  assert.equal(satir('esik 11').komutHatasi, 'sinir');
  assert.equal(satir('sinirsiz 3').komutHatasi, 'desteklenmiyor', 'aralığı bilinmeyen sayı ayarlanmaz');
});

test('tam ad önceliği: adı sorgunun kendisi olan öğe varsa komut aranmaz ("Salon 24" adlı öğe)', () => {
  const ozel = { etiket: 'Salon 24', alan: 'scene' };
  const s = paletSorgusu('salon 24', [KLIMA, ozel]).sonuclar;
  assert.equal(s.length, 1);
  assert.equal(s[0].oge, ozel);
  assert.equal(s[0].eylem, undefined);
});

test('komut olmayan sorgu eski davranışla aranır; alan bilgisi olmayan öğelerde komut hiç çalışmaz', () => {
  assert.deepEqual(paletSorgusu('film', OGELER).sonuclar.map((r) => r.oge.etiket), ['Film']);
  assert.equal(paletSorgusu('film', OGELER).sonuclar[0].eylem, undefined);
  const eski = [{ etiket: 'Salon klima' }];
  assert.equal(paletSorgusu('salon klima 24', eski).sonuclar[0]?.eylem, undefined);
  assert.equal(paletSorgusu('', OGELER).sonuclar.length, OGELER.length);
  assert.equal(paletSorgusu('klima', OGELER).sonuclar[0].eylem, undefined, 'tek başına ad komut değildir');
});

test('alanKomutu: komut sözlüğü olmayan alan, boş kuyruk ve eksik özellik güvenle null', () => {
  assert.equal(komutluAlanMi('climate'), true);
  assert.equal(komutluAlanMi('scene'), false);
  assert.equal(komutluAlanMi('lock'), false);
  assert.equal(komutluAlanMi('cover'), false);
  assert.equal(alanKomutu(SAHNE, 'ac'), null);
  assert.equal(alanKomutu(KLIMA, ''), null);
  assert.equal(alanKomutu(null, 'ac'), null);
  assert.equal(alanKomutu({ alan: 'climate' }, kat('isit')).hata, 'desteklenmiyor', 'ozellik yoksa mod listesi de yok');
  assert.equal(alanKomutu({ alan: 'select', ozellik: null }, kat('uyku')), null);
});

test('kuyrukBolumleri: en kısa kuyruk önce, en çok 4 sözcük, baş en az bir sözcük', () => {
  assert.deepEqual(kuyrukBolumleri('tv kaynak hdmi 2'), [
    { bas: 'tv kaynak hdmi', kuyruk: '2' },
    { bas: 'tv kaynak', kuyruk: 'hdmi 2' },
    { bas: 'tv', kuyruk: 'kaynak hdmi 2' },
  ]);
  assert.deepEqual(kuyrukBolumleri('klima'), []);
  assert.equal(kuyrukBolumleri('a b c d e f g').length, 4);
});

test('üretilen her servis önerisi servis-izinleri.js doğrulamasından geçer (kuru geçiş)', () => {
  const varliklar = {
    climate: { entity_id: 'climate.salon', attributes: { min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'cool', 'heat', 'auto'] } },
    light: { entity_id: 'light.masa', attributes: { supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 } },
    media_player: { entity_id: 'media_player.tv', attributes: { source_list: ['HDMI 1', 'HDMI 2', 'Netflix'] } },
    fan: { entity_id: 'fan.v', attributes: { preset_modes: ['Uyku', 'Turbo'] } },
    humidifier: { entity_id: 'humidifier.n', attributes: { min_humidity: 30, max_humidity: 80 } },
    vacuum: { entity_id: 'vacuum.s', attributes: {} },
    input_select: { entity_id: 'input_select.ev_modu', attributes: { options: ['Ev', 'Dışarıda', 'Uyku', 'Uzun yolculuk'] } },
    input_number: { entity_id: 'input_number.esik', attributes: { min: 0, max: 10, step: 1 } },
    timer: { entity_id: 'timer.mutfak', attributes: {} },
  };
  const sorgular = [
    [KLIMA, 'klima 24'], [KLIMA, 'klima 23,5'], [KLIMA, 'klima isit'], [KLIMA, 'klima kapat'], [MASA, 'masa sicak'], [MASA, 'masa 3000k'], [MASA, 'masa kirmizi'],
    [TV, 'tv ses 30'], [TV, 'tv sessiz'], [TV, 'tv kaynak netflix'], [TV, 'tv oynat'], [FAN, 'vantilator 50'], [FAN, 'vantilator uyku'], [NEM, 'nem alici 50'],
    [SUPURGE, 'supurge basla'], [SECICI, 'ev modu uyku'], [SAYI, 'esik 7'], [ZAMANLAYICI, 'mutfak iptal'],
  ];
  for (const [oge, sorgu] of sorgular) {
    const r = paletSorgusu(sorgu, [oge]).sonuclar[0];
    assert.ok(r?.eylem, `${sorgu}: komut yok`);
    const alan = oge.alan;
    const sonuc = servisDogrula(alan, r.eylem.servis, r.eylem.veri, varliklar[alan]);
    assert.equal(sonuc.ok, true, `${sorgu}: ${JSON.stringify(sonuc)}`);
  }
});

test('hiçbir komut sözlüğü kapı/kilit/kepenk/alarm eylemi üretmez (Kapı Kuralı)', () => {
  const yasak = ['kilitle', 'kilit', 'ac kapiyi', 'kapiyi ac', 'lock', 'unlock', 'open', 'ac', 'garaj', 'kepenk', 'siren', 'alarm', 'arm', 'disarm', 'close'];
  for (const oge of OGELER) {
    for (const k of yasak) {
      const sonuc = alanKomutu(oge, kat(k));
      if (!sonuc || sonuc.hata) continue;
      assert.ok(['turn_on', 'turn_off'].includes(sonuc.servis), `${oge.alan} "${k}" -> ${sonuc.servis}`);
    }
  }
});
