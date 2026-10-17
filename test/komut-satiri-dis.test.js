'use strict';

// 1.4.0 dis grubu: --kaynak=jumplist|kisayol, güvenli argüman adı, evpaneli:// bağlantısı (src/lib/komut-satiri.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eylemKaynagi,
  argumanAdiGuvenliMi,
  kimlikBicimindeMi,
  komutSatiriAdi,
  eylemArgumanlari,
  protokolArgumani,
  protokolBaglantisiCoz,
  protokolBaglantisi,
  komutSatiriEylemi,
  pencereDurumKomutu,
  disIstegi,
  PROTOKOL_SINIRI,
} = require('../src/lib/komut-satiri');

const KAROLAR = [
  { id: 'light.led', etiket: 'LED şerit', ad: 'LED şerit', alan: 'light', parlaklikKontrol: true, varsayilanEylem: true },
  { id: 'light.salon', etiket: 'Salon', ad: 'Salon tavan', alan: 'light', varsayilanEylem: true },
  { id: 'light.salon_2', etiket: 'Salon 2', ad: 'Salon 2', alan: 'light', varsayilanEylem: true },
  { id: 'scene.film', etiket: 'Film "gece"', ad: 'Film gecesi', alan: 'scene', varsayilanEylem: true },
  { id: 'scene.x', etiket: '%PATH%', ad: '-x', alan: 'scene', varsayilanEylem: true },
  { id: 'climate.salon', etiket: 'Klima', ad: 'Klima', alan: 'climate', varsayilanEylem: false },
];

test('--kaynak: yalnız jumplist ve kisayol; değersiz, bilinmeyen ya da yinelenen değer geçersiz', () => {
  assert.equal(eylemKaynagi(['exe', '--eylem=Salon']), null);
  assert.equal(eylemKaynagi(['exe', '--eylem=Salon', '--kaynak=jumplist']), 'jumplist');
  assert.equal(eylemKaynagi(['exe', '--eylem=Salon', '--KAYNAK="kisayol"']), 'kisayol-dosyasi');
  assert.equal(eylemKaynagi(['--kaynak']), 'gecersiz');
  assert.equal(eylemKaynagi(['--kaynak=']), 'gecersiz');
  assert.equal(eylemKaynagi(['--kaynak=panel']), 'gecersiz');
  assert.equal(eylemKaynagi(['--kaynak=yerel-api']), 'gecersiz');
  assert.equal(eylemKaynagi(['--kaynak=jumplist', '--kaynak=kisayol']), 'gecersiz');
  assert.equal(eylemKaynagi('x'), null);
  // --kaynak ad parçası sayılmaz; pencere komutu değildir
  assert.deepEqual(komutSatiriEylemi(['exe', '--eylem=led', '40', '--kaynak=jumplist']), { ad: 'led 40' });
  assert.equal(pencereDurumKomutu(['exe', '--eylem=Salon', '--kaynak=jumplist']), null);
});

test('argüman adı: tırnak, ters bölü, kabuk ve ortam değişkeni işaretleri, baştaki tire ve uzun ad reddedilir', () => {
  for (const ad of ['Salon', 'LED şerit', 'Salon 2', 'Işık (yatak)']) assert.equal(argumanAdiGuvenliMi(ad), true, ad);
  for (const ad of ['', ' ', ' Salon', 'Salon ', 'a"b', 'a\\b', '%PATH%', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a!b', 'a`b', '-x', 'a\nb', 'x'.repeat(61), '...', 42, null]) {
    assert.equal(argumanAdiGuvenliMi(ad), false, JSON.stringify(ad));
  }
});

test('komutSatiriAdi: etiket ya da HA adı karoyu tek başına, değiştiricisiz geri bulmalı; yoksa null', () => {
  assert.equal(komutSatiriAdi(KAROLAR[0], KAROLAR), 'LED şerit');
  assert.equal(komutSatiriAdi(KAROLAR[1], KAROLAR), 'Salon');
  assert.equal(komutSatiriAdi(KAROLAR[2], KAROLAR), 'Salon 2');
  assert.equal(komutSatiriAdi(KAROLAR[3], KAROLAR), 'Film gecesi'); // etiket tırnak içeriyor: HA adı kullanılır
  assert.equal(komutSatiriAdi(KAROLAR[4], KAROLAR), null);
  assert.equal(komutSatiriAdi(KAROLAR[5], KAROLAR), null); // tek tıklama eylemi yok
  assert.equal(komutSatiriAdi(null, KAROLAR), null);
});

test('eylemArgumanlari: Jump List ve kısayol argümanları; güvenli olmayan ad için null', () => {
  assert.equal(eylemArgumanlari('LED şerit', 'jumplist'), '--eylem="LED şerit" --kaynak=jumplist');
  assert.equal(eylemArgumanlari('Salon', 'kisayol'), '--eylem="Salon" --kaynak=kisayol');
  assert.equal(eylemArgumanlari('a"b', 'jumplist'), null);
  assert.equal(eylemArgumanlari('Salon', 'yerel-api'), null);
  // Windows argüman ayrıştırması tırnakları atar: aynı ad geri çözülür
  assert.deepEqual(komutSatiriEylemi(['exe', '--eylem=LED şerit', '--kaynak=jumplist']), { ad: 'LED şerit' });
});

test('protokolArgumani: tek bağlantı metni; birden çok bağlantı çakışma', () => {
  assert.equal(protokolArgumani(['exe', '--']), null);
  assert.equal(protokolArgumani(['exe', '--', 'evpaneli://eylem?ad=Salon']), 'evpaneli://eylem?ad=Salon');
  assert.equal(protokolArgumani(['exe', 'EVPANELI://eylem?ad=Salon']), 'EVPANELI://eylem?ad=Salon');
  assert.deepEqual(protokolArgumani(['exe', 'evpaneli://eylem?ad=a', 'evpaneli://eylem?ad=b']), { cakisma: true });
  assert.equal(protokolArgumani(null), null);
});

test('protokolBaglantisiCoz: ad ve en çok bir değiştirici', () => {
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=Salon'), { ad: 'Salon' });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem/?ad=LED%20%C5%9Ferit'), { ad: 'LED şerit' });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&parlaklik=40'), { ad: 'led', parlaklik: 40 });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&parlaklik=0'), { ad: 'led', parlaklik: 0 });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&islem=kapat'), { ad: 'led', islem: 'kapat' });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&adim=-10'), { ad: 'led', adim: -10 });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&adim=+10'), { ad: 'led', adim: 10 });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=led&adim=%2B20'), { ad: 'led', adim: 20 });
});

test('protokolBaglantisiCoz: sıkı biçim; başka yol, kimlik bilgisi, bilinmeyen/yinelenen anahtar, uzun bağlantı reddedilir', () => {
  const gecersizler = [
    'evpaneli://ayar?ad=Salon',
    'evpaneli://eylem/x?ad=Salon',
    'evpaneli://kullanici:sir@eylem?ad=Salon',
    'evpaneli://eylem:80?ad=Salon',
    'evpaneli://eylem?ad=Salon#x',
    'evpaneli://eylem?ad=Salon&kimlik=light.salon',
    'evpaneli://eylem?ad=Salon&ad=Film',
    'evpaneli://eylem?ad=led&parlaklik=40&islem=ac',
    'evpaneli://eylem?ad=led&parlaklik=101',
    'evpaneli://eylem?ad=led&parlaklik=4.5',
    'evpaneli://eylem?ad=led&islem=sil',
    'evpaneli://eylem?ad=led&adim=0',
    'evpaneli://eylem?ad=led&adim=101',
    'evpaneli://eylem?parlaklik=40',
    'evpaneli://eylem?ad=',
    'evpaneli://eylem?ad=%20%20',
    `evpaneli://eylem?ad=${'x'.repeat(61)}`,
    `evpaneli://eylem?ad=Salon&islem=ac${'&'.repeat(PROTOKOL_SINIRI)}`,
    'evpaneli://eylem?ad=Salon kotu',
    'evpaneli://eylem?ad=Salon\u0000',
    'https://eylem?ad=Salon',
    'evpaneli:',
    'bozuk',
    42,
  ];
  for (const b of gecersizler) assert.deepEqual(protokolBaglantisiCoz(b), { hata: 'gecersiz' }, String(b));
  // ad içindeki denetim karakteri atılır (kodlanmış)
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=Sa%07lon'), { ad: 'Salon' });
});

test('protokolBaglantisi: favori adıyla bağlantı; ad çözümü aynı adı verir; kimlik taşımaz', () => {
  const b = protokolBaglantisi('LED şerit');
  assert.equal(b, 'evpaneli://eylem?ad=LED%20%C5%9Ferit');
  assert.deepEqual(protokolBaglantisiCoz(b), { ad: 'LED şerit' });
  assert.equal(protokolBaglantisi('a"b'), null);
  assert.doesNotMatch(b, /light\./);
});

test('disIstegi: bağlantı TEK BAŞINA gelmeli; yanında eylem, kaynak ya da pencere/durum komutu varsa çakışma (hiçbiri çalışmaz)', () => {
  const B = 'evpaneli://eylem?ad=Salon';
  assert.equal(disIstegi(['exe']), null);
  assert.equal(disIstegi(['exe', '--eylem=Salon']), null, 'olağan komut satırı akışı');
  assert.equal(disIstegi(['exe', '--goster']), null);
  assert.equal(disIstegi(null), null);
  assert.deepEqual(disIstegi(['exe', '--', B]), { tur: 'protokol', metin: B });
  assert.deepEqual(disIstegi(['exe', '--eylem=Salon', '--kaynak=jumplist']), { tur: 'kaynak', kaynak: 'jumplist' });
  assert.deepEqual(disIstegi(['exe', '--eylem=Salon', '--kaynak=kisayol']), { tur: 'kaynak', kaynak: 'kisayol-dosyasi' });
  assert.deepEqual(disIstegi(['exe', '--eylem=Salon', '--kaynak=yerel-api']), { tur: 'kaynak', kaynak: 'gecersiz' });
  assert.deepEqual(disIstegi(['exe', '--eylem=Salon', '--kaynak']), { tur: 'kaynak', kaynak: 'gecersiz' });
  for (const argv of [
    ['exe', B, '--eylem=PC kapat'],
    ['exe', '--eylem=Salon', B], // bağlantı ada eklenmez: çakışma
    ['exe', B, '--kaynak=jumplist'],
    ['exe', B, '--goster'],
    ['exe', B, '--durum', '--cikti=d.json'],
    ['exe', B, '--hedef=panel'], // bozuk pencere komutu da sayılır
    ['exe', B, 'evpaneli://eylem?ad=Film'],
  ]) {
    assert.deepEqual(disIstegi(argv), { tur: 'cakisma' }, argv.join(' '));
  }
});

test('disIstegi: ikinci kopyanın ek verisi argv yerine geçer; bozuk ek veri hiçbir şey çalıştırmaz', () => {
  const B = 'evpaneli://eylem?ad=Salon';
  assert.deepEqual(disIstegi(['exe'], { protokol: B }), { tur: 'protokol', metin: B });
  assert.deepEqual(disIstegi(['exe'], { protokol: B, eylem: 'PC kapat' }), { tur: 'cakisma' });
  assert.deepEqual(disIstegi(['exe'], { protokol: B, kaynak: 'jumplist' }), { tur: 'cakisma' });
  assert.deepEqual(disIstegi(['exe'], { protokol: { cakisma: true } }), { tur: 'cakisma' });
  assert.deepEqual(disIstegi(['exe'], { protokol: 42 }), { tur: 'cakisma' });
  assert.deepEqual(disIstegi(['exe', '--eylem=Salon', '--kaynak=jumplist'], { eylem: 'Salon', kaynak: 'jumplist' }), { tur: 'kaynak', kaynak: 'jumplist' });
  assert.deepEqual(disIstegi(['exe'], { eylem: 'Salon', kaynak: 'kisayol-dosyasi' }), { tur: 'kaynak', kaynak: 'kisayol-dosyasi' });
  assert.deepEqual(disIstegi(['exe'], { eylem: 'Salon', kaynak: 'yerel-api' }), { tur: 'kaynak', kaynak: 'gecersiz' }, 'ek veri kaynağı genişletemez');
  assert.deepEqual(disIstegi(['exe'], { eylem: 'Salon', kaynak: 7 }), { tur: 'kaynak', kaynak: 'gecersiz' });
  assert.equal(disIstegi(['exe', '--eylem=Salon'], { eylem: 'Salon' }), null, 'eski sürümün ek verisi: olağan akış');
  assert.equal(disIstegi(['exe'], 'metin'), null);
  assert.equal(disIstegi(['exe'], { kaynak: null }), null);
});

test('dış tetikler favori ADI taşır: varlık kimliği biçimindeki ad bağlantıda, Jump List / kısayol argümanında ve bağlantı üretiminde reddedilir', () => {
  for (const ad of ['light.salon', 'LIGHT.SALON_LAMBASI', ' lock.on_kapi ', 'input_boolean.misafir']) assert.equal(kimlikBicimindeMi(ad), true, ad);
  for (const ad of ['Salon', 'v1.2', 'Salon.', 'Dr. Ali', 'a.b c', '', null]) assert.equal(kimlikBicimindeMi(ad), false, String(ad));
  assert.equal(argumanAdiGuvenliMi('light.salon'), false);
  assert.equal(eylemArgumanlari('light.salon', 'jumplist'), null);
  assert.equal(protokolBaglantisi('light.salon'), null);
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=light.salon'), { hata: 'gecersiz' });
  assert.deepEqual(protokolBaglantisiCoz('evpaneli://eylem?ad=lock.on_kapi&islem=ac'), { hata: 'gecersiz' });
  // Etiketi kimlik gibi görünen karo HA adıyla listelenir; ikisi de öyleyse hiç listelenmez
  const karolar = [{ id: 'light.a', etiket: 'light.b', ad: 'Masa', alan: 'light', varsayilanEylem: true }, { id: 'light.c', etiket: 'light.c', ad: 'light.c', alan: 'light', varsayilanEylem: true }];
  assert.equal(komutSatiriAdi(karolar[0], karolar), 'Masa');
  assert.equal(komutSatiriAdi(karolar[1], karolar), null);
});
