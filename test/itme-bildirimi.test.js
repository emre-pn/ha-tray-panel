'use strict';

/**
 * o-61: HA mobile_app itme bildirimi çözümü (saf). Ağ ve Electron yok. Gelen yük güvenilmez veri sayılır:
 * Kapı Kuralı süzgeci, düğme ayıklaması, uzaktan komutların yoksayılması, sınırlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EN_COK_DUGME,
  BASLIK_SINIRI,
  MESAJ_SINIRI,
  DUGME_BASLIK_SINIRI,
  etiketDuzelt,
  eylemKimligiGuvenliMi,
  dugmeCoz,
  bildirimiCoz,
} = require('../src/lib/itme-bildirimi');

const dugme = (action, title, ek = {}) => ({ action, title, ...ek });

test('düz bildirim: ileti, başlık ve etiket çözülür; düğme yoksa boş liste', () => {
  const c = bildirimiCoz({ message: 'Çamaşır bitti', title: 'Makine', data: { tag: 'camasir' } });
  assert.deepEqual(c, { tur: 'goster', baslik: 'Makine', mesaj: 'Çamaşır bitti', etiket: 'camasir', dugmeler: [], dusenDugme: 0 });
});

test('başlık ve etiket isteğe bağlıdır; boş başlık yok sayılır', () => {
  assert.deepEqual(bildirimiCoz({ message: 'Merhaba' }), { tur: 'goster', baslik: null, mesaj: 'Merhaba', etiket: null, dugmeler: [], dusenDugme: 0 });
  assert.equal(bildirimiCoz({ message: 'Merhaba', title: '   ' }).baslik, null);
  assert.equal(bildirimiCoz({ message: 'Merhaba', title: null }).baslik, null);
});

test('biçim dışı yük yoksayılır (nesne değil, ileti yok, ileti metin değil, başlık metin değil)', () => {
  for (const yuk of [null, undefined, 'metin', 42, [], {}, { message: 5 }, { message: null }, { title: 'x' }]) {
    assert.deepEqual(bildirimiCoz(yuk), { tur: 'yoksay', neden: 'bicim' }, JSON.stringify(yuk));
  }
  assert.deepEqual(bildirimiCoz({ message: 'x', title: 5 }), { tur: 'yoksay', neden: 'bicim' });
  assert.deepEqual(bildirimiCoz({ message: '   ' }), { tur: 'yoksay', neden: 'bos' });
  assert.deepEqual(bildirimiCoz({ message: '<b></b>' }), { tur: 'yoksay', neden: 'bos' });
});

test('HTML ve Markdown işaretleri düz metne çevrilir; bağlantı ve görsel alanları okunmaz', () => {
  const c = bildirimiCoz({ message: '<b>Kalın</b> **yazı**', title: '<i>Başlık</i>', data: { image: 'https://ornek.invalid/a.png', url: 'https://ornek.invalid', sound: 'x.wav' } });
  assert.equal(c.tur, 'goster');
  assert.doesNotMatch(c.mesaj, /[<>*]/);
  assert.doesNotMatch(c.baslik, /[<>]/);
  assert.deepEqual(Object.keys(c).sort(), ['baslik', 'dugmeler', 'dusenDugme', 'etiket', 'mesaj', 'tur']);
  assert.doesNotMatch(JSON.stringify(c), /ornek\.invalid|\.wav/);
});

test('Kapı Kuralı: kapı, kilit, alarm, garaj, bariyer, siren ve kepenk içeren ileti YA DA başlık bildirimin tamamını düşürür (5 dil)', () => {
  const yasakIletiler = [
    'Ön kapı açık',
    'Garaj kapısı açıldı',
    'Front door is open',
    'Die Haustür ist offen',
    'La porte est ouverte',
    'La puerta está abierta',
    'Alarm tetiklendi',
    'Smart lock unlocked',
    'Kilit açıldı',
    'Siren çalıyor',
    'Bariyer kalktı',
    'Kepenk iniyor',
  ];
  for (const ileti of yasakIletiler) {
    assert.deepEqual(bildirimiCoz({ message: ileti }), { tur: 'yoksay', neden: 'guvensiz' }, ileti);
    // başlıkta geçen yasak sözcük de bildirimin tamamını düşürür
    assert.deepEqual(bildirimiCoz({ message: 'Güvenli ileti', title: ileti }), { tur: 'yoksay', neden: 'guvensiz' }, `başlık: ${ileti}`);
  }
});

test('Kapı Kuralı: yasak sözcük düğme başlığında ya da eylem kimliğinde ise yalnız o düğme düşer, bildirim kalır', () => {
  const c = bildirimiCoz({
    message: 'Hareket algılandı',
    data: {
      actions: [
        dugme('TAMAM', 'Tamam'),
        dugme('KAPIYI_AC', 'Aç'),
        dugme('ACIL', 'Kapıyı aç'),
        dugme('UNLOCK_FRONT', 'Tamam'),
        dugme('GARAJ', 'Garaj'),
        dugme('ERTELE', 'Ertele'),
      ],
    },
  });
  assert.equal(c.tur, 'goster');
  assert.deepEqual(c.dugmeler, [{ eylem: 'TAMAM', baslik: 'Tamam' }, { eylem: 'ERTELE', baslik: 'Ertele' }]);
  assert.equal(c.dusenDugme, 4);
});

test('Kapı Kuralı: zil, ziyaretçi, giriş (kamera giriş sözcükleri) ileti, başlık, düğme başlığı ve kimliğinde bildirimi / düğmeyi düşürür (5 dil)', () => {
  // "Zil çaldı" + "Aç": kapı açan otomasyonun düğmesi hiçbir koşulda gösterilmez
  assert.deepEqual(bildirimiCoz({ message: 'Zil çaldı', data: { actions: [dugme('AC', 'Aç')] } }), { tur: 'yoksay', neden: 'guvensiz' });
  assert.deepEqual(bildirimiCoz({ message: 'Kurye geldi', title: 'Ziyaretçi', data: { actions: [dugme('AC', 'Aç')] } }), { tur: 'yoksay', neden: 'guvensiz' });
  for (const iletisi of ['Giriş kapısında hareket', 'Girişte biri var', 'Visitor at the entrance', 'The bell rang', 'Es klingelt', 'Besucher am Eingang', "Quelqu'un à l'entrée",'Alguien en la entrada', 'Misafir geldi', 'Guest arrived']) {
    assert.deepEqual(bildirimiCoz({ message: iletisi }), { tur: 'yoksay', neden: 'guvensiz' }, iletisi);
    assert.deepEqual(bildirimiCoz({ message: 'Merhaba', title: iletisi }), { tur: 'yoksay', neden: 'guvensiz' }, `başlık: ${iletisi}`);
  }
  // masum ileti düğmeleriyle gösterilir; giriş sözcüklü düğme başlığı ya da kimliği yalnız o düğmeyi düşürür
  const c = bildirimiCoz({ message: 'Çamaşır bitti', data: { actions: [dugme('GIRISI_AC', 'Aç'), dugme('KAPAT', 'Girişi aç'), dugme('ZIL_SUSTUR', 'Sustur'), dugme('ENTRANCE_OPEN', 'Tamam'), dugme('TAMAM', 'Tamam')] } });
  assert.equal(c.tur, 'goster');
  assert.deepEqual(c.dugmeler, [{ eylem: 'TAMAM', baslik: 'Tamam' }]);
  assert.equal(c.dusenDugme, 4);
  // etiket ve eylem kimliği (webhook gövdesinin son kapısı) aynı kuralı uygular
  assert.equal(eylemKimligiGuvenliMi('GIRISI_AC'), false);
  assert.equal(eylemKimligiGuvenliMi('doorbell_open'), false);
  assert.equal(eylemKimligiGuvenliMi('ZIL_AC'), false);
  assert.equal(eylemKimligiGuvenliMi('TAMAM'), true);
  assert.equal(etiketDuzelt('zil-bildirimi'), null);
  assert.equal(etiketDuzelt('camasir'), 'camasir');
});

test('Kapı Kuralı: etiket yasak sözcük içeriyorsa etiketsiz gösterilir', () => {
  assert.equal(bildirimiCoz({ message: 'Merhaba', data: { tag: 'door_open' } }).etiket, null);
  assert.equal(bildirimiCoz({ message: 'Merhaba', data: { tag: 'kapi' } }).etiket, null);
  assert.equal(etiketDuzelt('camasir'), 'camasir');
  assert.equal(etiketDuzelt('door-bell'), null);
});

test('etiket deseni: boşluk, uzun, metin dışı değerler etiketsiz sayılır', () => {
  for (const kotu of ['', 'a b', 'x'.repeat(65), 5, null, undefined, {}, 'ş', 'a/b', 'a<b']) assert.equal(etiketDuzelt(kotu), null, String(kotu));
  assert.equal(etiketDuzelt('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(etiketDuzelt('Cam.Asir:1_x-2'), 'Cam.Asir:1_x-2');
});

test('eylem kimliği: düz desen, "URI" ayrık sözcüğü ve Kapı Kuralı', () => {
  for (const iyi of ['TAMAM', 'onayla', 'action_1', 'a.b:c-d']) assert.equal(eylemKimligiGuvenliMi(iyi), true, iyi);
  for (const kotu of ['', 'a b', 'URI', 'uri', 'Uri', 'x'.repeat(65), 5, null, undefined, 'a;b', 'KAPI_AC', 'unlock_door', 'ALARM_KUR']) assert.equal(eylemKimligiGuvenliMi(kotu), false, String(kotu));
});

test('düğme: bağlantı açan (uri) ve metin girişi isteyen düğmeler düşer', () => {
  assert.deepEqual(dugmeCoz(dugme('TAMAM', 'Tamam')), { eylem: 'TAMAM', baslik: 'Tamam' });
  assert.equal(dugmeCoz(dugme('ACIK', 'Aç', { uri: 'https://ornek.invalid' })), null);
  assert.equal(dugmeCoz(dugme('ACIK', 'Aç', { uri: '/lovelace/0' })), null);
  assert.equal(dugmeCoz(dugme('YANIT', 'Yanıtla', { behavior: 'textInput' })), null);
  assert.equal(dugmeCoz(dugme('URI', 'Aç')), null);
  assert.deepEqual(dugmeCoz(dugme('TAMAM', 'Tamam', { uri: '' })), { eylem: 'TAMAM', baslik: 'Tamam' });
  for (const kotu of [null, undefined, 'x', 5, [], {}, { action: 'A' }, { title: 'B' }, { action: 5, title: 'B' }, { action: 'A', title: 5 }]) assert.equal(dugmeCoz(kotu), null, JSON.stringify(kotu));
});

test('düğme sınırları: en çok 3, yinelenen eylem düşer, çok sayıda girdi taranmaz, uzun başlık kısalır', () => {
  assert.equal(EN_COK_DUGME, 3);
  const c = bildirimiCoz({
    message: 'Seç',
    data: { actions: [dugme('A', 'Bir'), dugme('A', 'Bir yine'), dugme('B', 'İki'), dugme('C', 'Üç'), dugme('D', 'Dört'), dugme('E', 'Beş')] },
  });
  assert.deepEqual(c.dugmeler.map((d) => d.eylem), ['A', 'B', 'C']);
  assert.equal(c.dusenDugme, 3);

  const cok = bildirimiCoz({ message: 'Seç', data: { actions: Array.from({ length: 100 }, (_, i) => dugme(`E${i}`, `Düğme ${i}`)) } });
  assert.equal(cok.dugmeler.length, 3);
  assert.equal(cok.dusenDugme, 97);

  const uzun = bildirimiCoz({ message: 'Seç', data: { actions: [dugme('U', 'x'.repeat(200))] } });
  assert.ok(uzun.dugmeler[0].baslik.length <= DUGME_BASLIK_SINIRI);
});

test('düğme dizisi olmayan ya da bozuk data sorun çıkarmaz', () => {
  for (const data of [undefined, null, 'x', 5, [], { actions: 'x' }, { actions: {} }, { actions: null }, { actions: [null, 5, 'x', []] }]) {
    const c = bildirimiCoz({ message: 'Merhaba', data });
    assert.equal(c.tur, 'goster', JSON.stringify(data));
    assert.deepEqual(c.dugmeler, []);
  }
});

test('metin sınırları: başlık ve ileti kısalır, Kapı Kuralı kısaltılmış değil ham metinde de denetlenir', () => {
  const c = bildirimiCoz({ message: 'a'.repeat(1000), title: 'b'.repeat(1000) });
  assert.equal(c.tur, 'goster');
  assert.ok(c.mesaj.length <= MESAJ_SINIRI);
  assert.ok(c.baslik.length <= BASLIK_SINIRI);
  // yasak sözcük kırpma noktasının ötesinde bile olsa bildirim gösterilmez
  const gizli = bildirimiCoz({ message: `${'a'.repeat(500)} kapı` });
  assert.deepEqual(gizli, { tur: 'yoksay', neden: 'guvensiz' });
});

test('uzaktan komutlar gösterilmez ve çalıştırılmaz: konum isteği, kanal silme, command_* yoksayılır', () => {
  for (const komut of ['request_location_update', 'remove_channel', 'command_activity', 'command_screen_on', 'command_volume_level', '  request_location_update  ']) {
    assert.deepEqual(bildirimiCoz({ message: komut }), { tur: 'yoksay', neden: 'komut' }, komut);
    assert.deepEqual(bildirimiCoz({ message: komut, data: { tag: 'x' } }), { tur: 'yoksay', neden: 'komut' }, `etiketli ${komut}`);
  }
});

test('clear_notification yalnız güvenli etiketle kart kapatır; etiketsizse yoksayılır', () => {
  assert.deepEqual(bildirimiCoz({ message: 'clear_notification', data: { tag: 'camasir' } }), { tur: 'temizle', etiket: 'camasir' });
  assert.deepEqual(bildirimiCoz({ message: 'clear_notification' }), { tur: 'yoksay', neden: 'komut' });
  assert.deepEqual(bildirimiCoz({ message: 'clear_notification', data: { tag: 'a b' } }), { tur: 'yoksay', neden: 'komut' });
  assert.deepEqual(bildirimiCoz({ message: 'clear_notification', data: { tag: 'kapi_zili' } }), { tur: 'yoksay', neden: 'komut' });
});

test('bildirimiCoz girdiyi değiştirmez', () => {
  const yuk = { message: '<b>x</b>', title: 'T', data: { tag: 't', actions: [dugme('A', 'Bir'), dugme('KAPI', 'Kapı')] } };
  const kopya = JSON.parse(JSON.stringify(yuk));
  bildirimiCoz(yuk);
  assert.deepEqual(yuk, kopya);
});
