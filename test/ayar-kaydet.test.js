'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ayarGirdisiniDogrula, kisayolKaydiSonrasiUyarilar } = require('../src/lib/ayar-kaydet');

const mevcut = { kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli' };
const girdi = (ek = {}) => ({
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  kisayol: 'Control+Alt+H',
  otomatikBaslat: true,
  pencereBoyutu: 'hizli',
  odakKaybindaGizle: true,
  anaPanoyaDonDk: '5',
  ...ek,
});

test('geçerli girdi: hata ve uyarı yok, değerler uygulanacak', () => {
  const { hatalar, uyarilar, yeni } = ayarGirdisiniDogrula(girdi(), mevcut);
  assert.deepEqual(hatalar, []);
  assert.deepEqual(uyarilar, []); // kısayol değişmedi: AltGr uyarısı tekrarlanmaz
  assert.equal(yeni.yerelAdres, 'http://192.168.1.10:8123');
  assert.equal(yeni.disAdres, 'https://ha.example.com');
  assert.equal(yeni.kisayol, 'Control+Alt+H');
  assert.equal(yeni.otomatikBaslat, true);
  assert.equal(yeni.pencereBoyutu, 'hizli');
  assert.equal(yeni.odakKaybindaGizle, true);
  assert.equal(yeni.anaPanoyaDonDk, 5);
});

test('kısayol hatası adres kaydını ENGELLEMEZ (hata-12): hata yok, uyarı var, mevcut kısayol korunur', () => {
  for (const kotu of ['F9', 'Shift+A', 'Alt+F4', '', 'Control+a']) {
    const { hatalar, uyarilar, yeni } = ayarGirdisiniDogrula(girdi({ kisayol: kotu, yerelAdres: 'http://10.0.0.5:8123' }), mevcut);
    assert.deepEqual(hatalar, [], kotu);
    assert.equal(uyarilar.length, 1, kotu);
    assert.equal(uyarilar[0].alan, 'kisayol');
    assert.match(uyarilar[0].mesaj, /korundu/);
    assert.equal(yeni.kisayol, 'Control+Alt+H');
    assert.equal(yeni.yerelAdres, 'http://10.0.0.5:8123');
  }
});

test('kısayol değişince uyarılar eklenir, kısayol normalleştirilir', () => {
  const { hatalar, uyarilar, yeni } = ayarGirdisiniDogrula(girdi({ kisayol: 'Alt+Control+P' }), mevcut);
  assert.deepEqual(hatalar, []);
  assert.equal(yeni.kisayol, 'Control+Alt+P');
  assert.equal(uyarilar.length, 1);
  assert.match(uyarilar[0].mesaj, /AltGr/);
  const temiz = ayarGirdisiniDogrula(girdi({ kisayol: 'Control+Shift+P' }), mevcut);
  assert.deepEqual(temiz.uyarilar, []);
});

test('ev içi adres https kabul eder (soru-7)', () => {
  const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ yerelAdres: 'https://ha.ev.lan:8123/' }), mevcut);
  assert.deepEqual(hatalar, []);
  assert.equal(yeni.yerelAdres, 'https://ha.ev.lan:8123');
});

test('ev içi adres http:// ise yalnız ev ağı adresi kabul edilir (hata-01); herkese açık ad https ister', () => {
  for (const tamam of ['http://192.168.1.10:8123', 'http://10.0.0.5', 'http://ha.local:8123', 'http://homeassistant:8123', 'http://[fd00::5]:8123', 'https://ha.example.com']) {
    const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ yerelAdres: tamam }), mevcut);
    assert.deepEqual(hatalar, [], tamam);
    assert.ok(yeni.yerelAdres, tamam);
  }
  for (const kotu of ['http://ha.example.com', 'http://8.8.8.8:8123', 'http://ha.example.org']) {
    const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ yerelAdres: kotu }), mevcut);
    assert.equal(hatalar.length, 1, kotu);
    assert.match(hatalar[0], /https:\/\//);
    assert.equal(yeni.yerelAdres, undefined, 'hatalı adres uygulanacak değerlere girmez');
  }
});

test('adres hatası: hatalar dolu', () => {
  assert.equal(ayarGirdisiniDogrula(girdi({ yerelAdres: 'ev' }), mevcut).hatalar.length, 1);
  assert.equal(ayarGirdisiniDogrula(girdi({ yerelAdres: '' }), mevcut).hatalar.length, 1);
  const dis = ayarGirdisiniDogrula(girdi({ disAdres: 'http://ha.example.com' }), mevcut);
  assert.equal(dis.hatalar.length, 1);
  assert.match(dis.hatalar[0], /https/);
  assert.equal(ayarGirdisiniDogrula(girdi({ yerelAdres: 'x', disAdres: 'y' }), mevcut).hatalar.length, 2);
});

test('dış adres boş olabilir', () => {
  const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ disAdres: '' }), mevcut);
  assert.deepEqual(hatalar, []);
  assert.equal(yeni.disAdres, '');
});

test('geçersiz yük', () => {
  assert.deepEqual(ayarGirdisiniDogrula(null, mevcut).hatalar, ['Geçersiz veri.']);
  assert.deepEqual(ayarGirdisiniDogrula('metin', mevcut).hatalar, ['Geçersiz veri.']);
});

test('pencere ayarları: geçersiz değer mevcut olanı korur', () => {
  const kotu = ayarGirdisiniDogrula(
    girdi({ pencereBoyutu: 'dev', odakKaybindaGizle: 'evet', anaPanoyaDonDk: '1441', otomatikBaslat: 'x' }),
    mevcut,
  );
  assert.deepEqual(kotu.hatalar, []);
  assert.ok(!('pencereBoyutu' in kotu.yeni));
  assert.ok(!('odakKaybindaGizle' in kotu.yeni));
  assert.ok(!('anaPanoyaDonDk' in kotu.yeni));
  assert.ok(!('otomatikBaslat' in kotu.yeni));
  assert.equal(kotu.uyarilar.filter((u) => u.alan === 'anaPanoyaDonDk').length, 1);
});

test('anaPanoyaDonDk sınırları: 0 kabul, 1440 kabul, boş/negatif/ondalık reddedilir', () => {
  const al = (d) => ayarGirdisiniDogrula(girdi({ anaPanoyaDonDk: d }), mevcut).yeni.anaPanoyaDonDk;
  assert.equal(al(0), 0);
  assert.equal(al('0'), 0);
  assert.equal(al(1440), 1440);
  assert.equal(al('15'), 15);
  assert.equal(al(''), undefined);
  assert.equal(al('  '), undefined);
  assert.equal(al(-1), undefined);
  assert.equal(al(2.5), undefined);
  assert.equal(al(null), undefined);
  assert.equal(al(true), undefined);
});

test('köşe bildirimi ve bip: yalnız boolean kabul edilir (hiz-04)', () => {
  const v = ayarGirdisiniDogrula(girdi({ koseBildirimi: false, bipSesi: true }), mevcut).yeni;
  assert.equal(v.koseBildirimi, false);
  assert.equal(v.bipSesi, true);
  const gecersiz = ayarGirdisiniDogrula(girdi({ koseBildirimi: 'hayir', bipSesi: 1 }), mevcut).yeni;
  assert.ok(!('koseBildirimi' in gecersiz) && !('bipSesi' in gecersiz));
  const yok = ayarGirdisiniDogrula(girdi(), mevcut).yeni;
  assert.ok(!('koseBildirimi' in yok) && !('bipSesi' in yok));
});

test('ev içi adres https kabul edilir (soru-7); alan adı ve IP ile, kimlik bilgisiyle değil', () => {
  for (const adres of ['https://ha.ev.lan', 'https://192.168.1.10:8123', 'https://ha.ev.lan:8443/']) {
    const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ yerelAdres: adres }), mevcut);
    assert.deepEqual(hatalar, [], adres);
    assert.ok(yeni.yerelAdres.startsWith('https://'), adres);
  }
  const kimlikli = ayarGirdisiniDogrula(girdi({ yerelAdres: 'https://kullanici:parola@ha.ev.lan' }), mevcut);
  assert.equal(kimlikli.hatalar.length, 1);
});

test('pencere boyutu genis kabul edilir', () => {
  assert.equal(ayarGirdisiniDogrula(girdi({ pencereBoyutu: 'genis' }), mevcut).yeni.pencereBoyutu, 'genis');
});

test('kisayolKaydiSonrasiUyarilar: kaydedilemeyen kısayol için AltGr/Win/tek değiştirici uyarıları atılır, diğerleri kalır', () => {
  const altGr = ayarGirdisiniDogrula(girdi({ kisayol: 'Alt+Control+P' }), mevcut).uyarilar;
  assert.equal(altGr.length, 1);
  assert.deepEqual(kisayolKaydiSonrasiUyarilar(altGr, true), altGr);
  assert.deepEqual(kisayolKaydiSonrasiUyarilar(altGr, false), []);

  const win = ayarGirdisiniDogrula(girdi({ kisayol: 'Super+Shift+P' }), mevcut).uyarilar;
  assert.equal(win.length, 1);
  assert.deepEqual(kisayolKaydiSonrasiUyarilar(win, false), []);

  const gecersiz = ayarGirdisiniDogrula(girdi({ kisayol: 'F9' }), mevcut).uyarilar; // geçersiz kısayol: kayıt denenmez ama uyarı kalır
  assert.equal(gecersiz.length, 1);
  assert.deepEqual(kisayolKaydiSonrasiUyarilar(gecersiz, false), gecersiz);

  const karisik = [...altGr, { alan: 'anaPanoyaDonDk', mesaj: 'x' }];
  assert.deepEqual(kisayolKaydiSonrasiUyarilar(karisik, false), [{ alan: 'anaPanoyaDonDk', mesaj: 'x' }]);
});

// --- 1.2.0 (Ayarlar): hatalı alanlar, gevşek kısayol yazımı, ayrılmış kısayollar, HA panosu terimi ----------------------------

test('h-01: hatalı alanlar hatalarla aynı sırada bildirilir (Ayarlar o alanı işaretler); hatasız girdide boş', () => {
  assert.deepEqual(ayarGirdisiniDogrula(girdi(), mevcut).hataAlanlari, []);
  const yerel = ayarGirdisiniDogrula(girdi({ yerelAdres: 'ev' }), mevcut);
  assert.deepEqual(yerel.hataAlanlari, ['yerelAdres']);
  const genel = ayarGirdisiniDogrula(girdi({ yerelAdres: 'http://ha.example.com' }), mevcut);
  assert.deepEqual(genel.hataAlanlari, ['yerelAdres'], 'herkese açık http adresi de ev içi adres alanının hatasıdır');
  const iki = ayarGirdisiniDogrula(girdi({ yerelAdres: 'x', disAdres: 'http://ha.example.com' }), mevcut);
  assert.deepEqual(iki.hataAlanlari, ['yerelAdres', 'disAdres']);
  assert.equal(iki.hatalar.length, iki.hataAlanlari.length, 'hatalar[i] ile hataAlanlari[i] eşlidir');
  assert.deepEqual(ayarGirdisiniDogrula(null, mevcut).hataAlanlari, []);
  assert.deepEqual(ayarGirdisiniDogrula(girdi({ kisayol: 'F9' }), mevcut).hataAlanlari, [], 'kısayol sorunu alan hatası değil, uyarıdır');
});

test('h-24: kısayol yazımı gevşek kabul edilir (ctrl, win, küçük harf, boşluk) ve kayıtlı biçime normalleşir', () => {
  const beklenen = new Map([
    ['ctrl+alt+h', 'Control+Alt+H'],
    ['Ctrl + Alt + H', 'Control+Alt+H'],
    ['ctrl alt h', 'Control+Alt+H'],
    [' CTRL+SHIFT+k ', 'Control+Shift+K'],
    ['win+shift+p', 'Shift+Super+P'],
    ['Alt+Ctrl+F5', 'Control+Alt+F5'],
  ]);
  for (const [yazilan, kayitli] of beklenen) {
    const { hatalar, yeni } = ayarGirdisiniDogrula(girdi({ kisayol: yazilan }), mevcut);
    assert.deepEqual(hatalar, [], yazilan);
    assert.equal(yeni.kisayol, kayitli, yazilan);
  }
});

test('h-25: Windows’a ayrılmış birleşimler kaydedilmez (eski kısayol korunur) ve nedeni söylenir; AltGr çakışması hangi tuşların etkilendiğini söyler', () => {
  for (const ayrilmis of ['Control+C', 'ctrl+v', 'Alt+F4', 'Control+Alt+Delete', 'Alt+Space']) {
    const { hatalar, uyarilar, yeni } = ayarGirdisiniDogrula(girdi({ kisayol: ayrilmis }), mevcut);
    assert.deepEqual(hatalar, [], ayrilmis);
    assert.equal(uyarilar.length, 1, ayrilmis);
    assert.match(uyarilar[0].mesaj, /ayrılmış/, ayrilmis);
    assert.equal(yeni.kisayol, 'Control+Alt+H', `${ayrilmis}: eski kısayol korunur`);
  }
  const altGr = ayarGirdisiniDogrula(girdi({ kisayol: 'Control+Alt+Q' }), mevcut).uyarilar[0];
  assert.equal(altGr.yalnizKayitBasarili, true, 'AltGr uyarısı kaydı engellemez, yalnız bilgi verir');
  assert.match(altGr.mesaj, /Q \(@\)/);
  assert.match(altGr.mesaj, /E \(€\)/);
  assert.match(altGr.mesaj, /7 \(\{\)/);
});

test('g-14: HA panosu terimi ve "sen" hitabı ileti metinlerinde tutarlıdır', () => {
  const metinler = [];
  metinler.push(...ayarGirdisiniDogrula(girdi({ yerelAdres: 'ev' }), mevcut).hatalar);
  metinler.push(...ayarGirdisiniDogrula(girdi({ yerelAdres: 'http://ha.example.com' }), mevcut).hatalar);
  metinler.push(...ayarGirdisiniDogrula(girdi({ disAdres: 'http://x.com' }), mevcut).hatalar);
  const panolar = ayarGirdisiniDogrula(girdi({ panolar: [{ ad: '', yol: '' }, ...Array.from({ length: 8 }, (_, i) => ({ ad: `Ev ${i}`, yol: `/lovelace/ev${i}` }))] }), mevcut).uyarilar;
  metinler.push(...panolar.map((u) => u.mesaj), ayarGirdisiniDogrula(girdi({ panolar: 'x' }), mevcut).uyarilar[0].mesaj);
  assert.ok(metinler.length >= 6);
  for (const metin of metinler) {
    assert.doesNotMatch(metin, /(?<![\p{L}])(?:\p{L}*(?:ınız|iniz|unuz|ünüz)\p{L}*|kullanın|yazın|girin)(?![\p{L}])/iu, metin);
    assert.doesNotMatch(metin, /(?<![\p{L}])pano(?![\p{L}])/iu, `${metin}: "HA panosu" denmeli`);
  }
  assert.ok(panolar.some((u) => /HA panosu/.test(u.mesaj)));
});
