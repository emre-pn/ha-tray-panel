'use strict';

/**
 * Son değişenler (o-18, src/lib/son-degisenler.js): palet "@" listesinin kaynağı. Gerçek durum deposu (durum-deposu.js) kullanılır;
 * bildirimleri elle boşaltılır (bosalt). Kapı Kuralı, yalnız geçiş kaydı, halka sınırı, ayar kapalıyken hiçbir şey tutmama ve
 * "yalnız bellek" ilkeleri denenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { sonDegisenlerOlustur, degisimTuru, ALANLAR, HALKA_BOYUTU, GOSTERILEN } = require('../src/lib/son-degisenler');

const sessizZaman = { setTimeout: () => 1, clearTimeout: () => {} };
const varlik = (kimlik, state, ad, ek = {}) => ({ entity_id: kimlik, state, attributes: { ...(ad ? { friendly_name: ad } : {}), ...(ek.nitelik ?? {}) }, ...(ek.degisim ? { last_changed: ek.degisim } : {}) });

function kur({ ayar = {}, adAl } = {}) {
  const depo = durumDeposuOlustur({ zaman: sessizZaman });
  const ayarlar = { ...ayar };
  let simdi = 1_700_000_000_000;
  const izleyici = sonDegisenlerOlustur({ depo, ayarlarAl: () => ayarlar, simdi: () => simdi, ...(adAl ? { adAl } : {}) });
  const yaz = (...varliklar) => {
    for (const v of varliklar) depo.guncelle(v);
    depo.bosalt();
  };
  return {
    depo,
    ayarlar,
    izleyici,
    yaz,
    ilerle: (ms) => {
      simdi += ms;
    },
    simdi: () => simdi,
    kimlikler: () => izleyici.ozet().map((o) => o.kimlik),
  };
}

test('alanlar: ışık, priz, sahne, klima, medya oynatıcı; halka 50, gösterim 20', () => {
  assert.deepEqual([...ALANLAR], ['light', 'switch', 'scene', 'climate', 'media_player']);
  assert.equal(HALKA_BOYUTU, 50);
  assert.equal(GOSTERILEN, 20);
});

test('ilk gözlem yalnız temel çizgidir; sonraki geçiş kaydedilir (açıldı / kapandı) ve ad favori etiketinden ya da HA adından gelir', () => {
  const o = kur({ adAl: (k) => (k === 'light.salon' ? 'Salon (favori)' : undefined) });
  o.yaz(varlik('light.salon', 'off', 'Salon lambası'), varlik('switch.priz', 'on', 'Masa prizi'));
  assert.deepEqual(o.izleyici.ozet(), [], 'açılış dolumu liste üretmez');
  o.ilerle(1000);
  o.yaz(varlik('light.salon', 'on', 'Salon lambası'));
  o.ilerle(1000);
  o.yaz(varlik('switch.priz', 'off', 'Masa prizi'));
  const liste = o.izleyici.ozet();
  assert.deepEqual(liste.map((x) => [x.kimlik, x.ad, x.alan, x.tur]), [
    ['switch.priz', 'Masa prizi', 'switch', 'kapandi'],
    ['light.salon', 'Salon (favori)', 'light', 'acildi'],
  ]);
  assert.ok(liste[0].zaman >= liste[1].zaman, 'en yeni üstte');
});

test('nitelik değişimi (parlaklık, renk) ve aynı durumun yinelenmesi kaydedilmez', () => {
  const o = kur();
  o.yaz(varlik('light.salon', 'on', 'Salon', { nitelik: { brightness: 100 } }));
  o.yaz(varlik('light.salon', 'on', 'Salon', { nitelik: { brightness: 200 } }));
  o.yaz(varlik('light.salon', 'on', 'Salon', { nitelik: { brightness: 50 } }));
  assert.equal(o.izleyici.sayi(), 0);
});

test('unavailable / unknown geçişleri kaydedilmez ve temel çizgiyi bozmaz: geri gelince aynı durumdaysa değişim yok, farklıysa var', () => {
  const o = kur();
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  o.yaz(varlik('light.salon', 'unavailable', 'Salon'));
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.equal(o.izleyici.sayi(), 0);
  o.yaz(varlik('light.salon', 'unknown', 'Salon'));
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  assert.deepEqual(o.izleyici.ozet().map((x) => x.tur), ['kapandi']);
});

test('izlenmeyen alanlar girmez: sensör, ikili sensör, vantilatör, perde, hava, takvim, kilit, alarm, siren', () => {
  const o = kur();
  const ornekler = [['sensor.sicaklik', '20', '21'], ['binary_sensor.hareket', 'off', 'on'], ['fan.vantilator', 'off', 'on'], ['cover.perde', 'open', 'closed'], ['weather.ev', 'sunny', 'rainy'], ['calendar.is', 'off', 'on'], ['lock.on_kapi', 'locked', 'unlocked'], ['alarm_control_panel.ev', 'disarmed', 'armed_away'], ['siren.korna', 'off', 'on']];
  o.yaz(...ornekler.map(([k, once]) => varlik(k, once, 'Ad')));
  o.yaz(...ornekler.map(([k, , sonra]) => varlik(k, sonra, 'Ad')));
  assert.equal(o.izleyici.sayi(), 0);
  assert.deepEqual(o.izleyici.ozet(), []);
});

test('Kapı Kuralı: kapı/garaj/kapı zili/kepenk adı ya da sınıfı taşıyan ışık, priz, sahne ve medya kaydedilmez ve listede görünmez', () => {
  const o = kur();
  const yasak = [
    varlik('light.kapi_isigi', 'off', 'Kapı ışığı'),
    varlik('switch.garaj', 'off', 'Garaj kapısı rölesi'),
    varlik('switch.zil', 'off', 'Ev', { nitelik: { device_class: 'door' } }),
    varlik('scene.kapi_ac', 'unknown', 'Gece'),
    varlik('media_player.diafon', 'off', 'Diafon'),
    varlik('light.bahce', 'off', 'Bahçe kapısı aydınlatması'),
    varlik('scene.gece', 'unknown', 'Gece modu', { nitelik: { entity_id: ['lock.on_kapi', 'light.salon'] } }),
  ];
  const kontrol = varlik('light.salon', 'off', 'Salon'); // aynı düzenek güvenli varlığı kaydeder: yasaklılar süzgeçten dolayı yoktur
  o.yaz(...yasak, kontrol);
  o.yaz(...yasak.map((v) => ({ ...v, state: v.state === 'off' ? 'on' : v.state === 'unknown' ? '2024-01-01T10:00:00+00:00' : v.state })), { ...kontrol, state: 'on' });
  assert.equal(o.izleyici.sayi(), 1);
  assert.deepEqual(o.kimlikler(), ['light.salon']);
});

test('Kapı Kuralı: güvenli kayıt sonradan kapı adı alırsa listeden düşer (ad süzgeci her gösterimde yeniden uygulanır)', () => {
  const o = kur();
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.deepEqual(o.kimlikler(), ['light.salon']);
  o.yaz(varlik('light.salon', 'on', 'Kapı önü'));
  assert.deepEqual(o.kimlikler(), []);
});

test('sahne: "unknown" -> zaman damgası ve damga -> yeni damga çalıştırma sayılır; unavailable sayılmaz', () => {
  const o = kur();
  o.yaz(varlik('scene.film', 'unknown', 'Film'));
  o.ilerle(1000);
  o.yaz(varlik('scene.film', '2026-10-17T10:00:00+00:00', 'Film'));
  assert.deepEqual(o.izleyici.ozet().map((x) => [x.kimlik, x.tur]), [['scene.film', 'calisti']]);
  o.ilerle(1000);
  o.yaz(varlik('scene.film', 'unavailable', 'Film'));
  o.yaz(varlik('scene.film', '2026-10-17T11:00:00+00:00', 'Film'));
  assert.equal(o.izleyici.sayi(), 2);
});

test('klima: kapalıdan açığa açıldı, moddan moda değişti, kapalıya kapandı; medya: yalnız kapalı <-> açık (oynat/duraklat sayılmaz, bekleme kapalıdır)', () => {
  assert.equal(degisimTuru('climate', 'off', 'heat'), 'acildi');
  assert.equal(degisimTuru('climate', 'heat', 'cool'), 'degisti');
  assert.equal(degisimTuru('climate', 'cool', 'off'), 'kapandi');
  assert.equal(degisimTuru('climate', 'heat', 'heat'), null);
  assert.equal(degisimTuru('media_player', 'playing', 'paused'), null);
  assert.equal(degisimTuru('media_player', 'idle', 'playing'), null);
  assert.equal(degisimTuru('media_player', 'off', 'playing'), 'acildi');
  assert.equal(degisimTuru('media_player', 'standby', 'on'), 'acildi');
  assert.equal(degisimTuru('media_player', 'paused', 'off'), 'kapandi');
  assert.equal(degisimTuru('media_player', 'playing', 'standby'), 'kapandi');
  assert.equal(degisimTuru('light', 'on', 'on'), null);
  assert.equal(degisimTuru('light', 'on', 'garip'), null);
  assert.equal(degisimTuru('fan', 'off', 'on'), null);
  const o = kur();
  o.yaz(varlik('climate.salon', 'off', 'Klima'), varlik('media_player.tv', 'off', 'TV'));
  o.ilerle(500);
  o.yaz(varlik('climate.salon', 'heat', 'Klima'), varlik('media_player.tv', 'playing', 'TV'));
  o.yaz(varlik('media_player.tv', 'paused', 'TV'));
  o.yaz(varlik('media_player.tv', 'playing', 'TV'));
  assert.deepEqual(o.izleyici.ozet().map((x) => [x.kimlik, x.tur]).sort(), [['climate.salon', 'acildi'], ['media_player.tv', 'acildi']]);
  assert.equal(o.izleyici.sayi(), 2);
});

test('HA\'da olmayan (yok işaretli) varlığın temel çizgisi silinir; geri gelince ilk gözlem sayılır ve yanlış değişim üretmez', () => {
  const o = kur();
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  o.depo.yokIsaretle('light.salon');
  o.depo.bosalt();
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  assert.equal(o.izleyici.sayi(), 0);
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.equal(o.izleyici.sayi(), 1);
});

test('liste varlık başına tek satırdır (en son değişim), en yeni üstte, en çok 20; halka 50 olaydan fazlasını tutmaz', () => {
  const o = kur();
  const kimlikler = Array.from({ length: 30 }, (_, i) => `light.lamba_${i}`);
  o.yaz(...kimlikler.map((k) => varlik(k, 'off', k)));
  kimlikler.forEach((k, i) => {
    o.ilerle(1000);
    o.yaz(varlik(k, 'on', `Lamba ${i}`));
  });
  const liste = o.izleyici.ozet();
  assert.equal(liste.length, 20);
  assert.equal(liste[0].kimlik, 'light.lamba_29');
  assert.equal(liste[19].kimlik, 'light.lamba_10');
  // aynı lambayı art arda değiştirmek halkayı doldurur ama satır çoğaltmaz
  for (let i = 0; i < 80; i += 1) {
    o.ilerle(1000);
    o.yaz(varlik('light.lamba_0', i % 2 === 0 ? 'off' : 'on', 'Lamba 0'));
  }
  assert.equal(o.izleyici.sayi(), HALKA_BOYUTU);
  const sonra = o.izleyici.ozet();
  assert.equal(sonra.filter((x) => x.kimlik === 'light.lamba_0').length, 1);
  assert.equal(sonra[0].kimlik, 'light.lamba_0');
});

test('zaman: last_changed kullanılır; gelecekteki ya da bozuk zaman şimdiye çekilir', () => {
  const o = kur();
  const t0 = o.simdi();
  o.yaz(varlik('light.a', 'off', 'A'), varlik('light.b', 'off', 'B'), varlik('light.c', 'off', 'C'));
  o.ilerle(10 * 60_000);
  o.yaz(varlik('light.a', 'on', 'A', { degisim: new Date(t0 + 5 * 60_000).toISOString() }));
  o.yaz(varlik('light.b', 'on', 'B', { degisim: new Date(o.simdi() + 3_600_000).toISOString() }));
  o.yaz(varlik('light.c', 'on', 'C', { degisim: 'dün akşam' }));
  const z = Object.fromEntries(o.izleyici.ozet().map((x) => [x.kimlik, x.zaman]));
  assert.equal(z['light.a'], t0 + 5 * 60_000);
  assert.equal(z['light.b'], o.simdi(), 'gelecek zaman şimdiye çekilir');
  assert.equal(z['light.c'], o.simdi(), 'bozuk zaman şimdi');
});

test('ad: kullanıcının adı > HA adı > kimlik; kapı kuralından geçmeyen ad kimliğe düşer; çok uzun ad kısalır', () => {
  const o = kur({ adAl: (k) => (k === 'light.a' ? 'Benim lambam' : k === 'light.b' ? 'Giriş kapısı' : undefined) });
  o.yaz(varlik('light.a', 'off', 'HA adı A'), varlik('light.b', 'off', 'HA adı B'), varlik('light.c', 'off', undefined), varlik('light.d', 'off', 'x'.repeat(200)));
  o.yaz(varlik('light.a', 'on', 'HA adı A'), varlik('light.b', 'on', 'HA adı B'), varlik('light.c', 'on', undefined), varlik('light.d', 'on', 'x'.repeat(200)));
  const ad = Object.fromEntries(o.izleyici.ozet().map((x) => [x.kimlik, x.ad]));
  assert.equal(ad['light.a'], 'Benim lambam');
  assert.equal(ad['light.b'], 'HA adı B', 'kullanıcı adı kapı kuralından geçmedi: HA adına düşer');
  assert.equal(ad['light.c'], 'light.c');
  assert.ok(ad['light.d'].length <= 60);
});

test('ayar kapalıyken hiçbir şey kaydedilmez ve liste boştur; kapatınca eski kayıtlar silinir; açınca temel çizgi o andan kurulur', () => {
  const o = kur();
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.equal(o.izleyici.sayi(), 1);
  o.ayarlar.sonDegisenler = false;
  assert.equal(o.izleyici.ayarDegisti(), true, 'dolu liste silindi: model değişti');
  assert.deepEqual(o.izleyici.ozet(), []);
  assert.equal(o.izleyici.ayarDegisti(), false, 'ikinci kez bir şey değişmedi');
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  assert.equal(o.izleyici.sayi(), 0, 'kapalıyken kayıt yok');
  o.ayarlar.sonDegisenler = true;
  o.izleyici.ayarDegisti();
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  assert.equal(o.izleyici.sayi(), 0, 'açılınca mevcut durum temel çizgidir; kapalıyken olan değişim geçmiş sayılmaz');
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.deepEqual(o.kimlikler(), ['light.salon']);
});

test('ayar kapalı başlarsa temel çizgi kurulmaz; açılınca depodaki durumdan kurulur', () => {
  const depo = durumDeposuOlustur({ zaman: sessizZaman });
  depo.guncelle(varlik('light.salon', 'off', 'Salon'));
  const ayarlar = { sonDegisenler: false };
  const izleyici = sonDegisenlerOlustur({ depo, ayarlarAl: () => ayarlar });
  ayarlar.sonDegisenler = true;
  izleyici.ayarDegisti();
  depo.guncelle(varlik('light.salon', 'on', 'Salon'));
  depo.bosalt();
  assert.equal(izleyici.sayi(), 1);
});

test('açılışta depodaki durumlar temel çizgi olur (açılış sonrası ilk değişim kaybolmaz)', () => {
  const depo = durumDeposuOlustur({ zaman: sessizZaman });
  depo.guncelle(varlik('light.salon', 'off', 'Salon'));
  depo.bosalt();
  const izleyici = sonDegisenlerOlustur({ depo, ayarlarAl: () => ({}) });
  depo.guncelle(varlik('light.salon', 'on', 'Salon'));
  depo.bosalt();
  assert.equal(izleyici.sayi(), 1);
});

test('bozuk veri çökertmez; kapat() dinleyiciyi bırakır ve belleği boşaltır; temizle() yalnız listeyi siler', () => {
  const o = kur();
  o.depo.guncelle({ entity_id: 'light.salon', state: 5, attributes: null });
  o.depo.guncelle({ entity_id: 'light.b', state: 'off', attributes: 'x' });
  o.depo.bosalt();
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.equal(o.izleyici.sayi(), 1);
  o.izleyici.temizle();
  assert.equal(o.izleyici.sayi(), 0);
  o.yaz(varlik('light.salon', 'off', 'Salon'));
  assert.equal(o.izleyici.sayi(), 1, 'temizle temel çizgiyi silmez');
  o.izleyici.kapat();
  o.yaz(varlik('light.salon', 'on', 'Salon'));
  assert.equal(o.izleyici.sayi(), 0);
  assert.deepEqual(o.izleyici.ozet(), []);
});

test('yalnız bellek: modül dosya sistemine, ağa ve günlüğe hiç dokunmaz', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'son-degisenler.js'), 'utf8');
  assert.doesNotMatch(kaynak, /require\(['"](fs|node:fs|http|https|net|electron|child_process)['"]\)/);
  assert.doesNotMatch(kaynak, /writeFile|appendFile|fetch\(|gunluk|localStorage/);
});
