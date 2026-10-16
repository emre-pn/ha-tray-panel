'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KAYNAKLAR,
  EN_COK_OGE,
  EN_COK_UYARI,
  UYARI_OMRU_MS,
  KAPATILAN_EN_COK,
  duzMetin,
  pilVarligi,
  guncellemeVarligi,
  varliklariTara,
  surumTemizle,
  kapatilanAnahtariGecerliMi,
  kapatilanlariDuzelt,
  kapatilanDeposuOlustur,
  merkezOlustur,
} = require('../src/lib/bildirim-merkezi');
const { anaCevirmen } = require('../src/lib/ceviri-varsayilan');

const EN = anaCevirmen('en');

// --- yardımcılar ---------------------------------------------------------------------------------------------------

function sahteFs(baslangic = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  return {
    dosyalar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => {
      if (!dosyalar.has(y)) throw new Error('yok');
      return dosyalar.get(y);
    },
    writeFileSync: (y, v) => dosyalar.set(y, String(v)),
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
    mkdirSync: () => {},
  };
}

function sahteZaman() {
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    setTimeout(fn) {
      sonId += 1;
      bekleyenler.set(sonId, fn);
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    atesle() {
      for (const [id, fn] of [...bekleyenler]) {
        bekleyenler.delete(id);
        fn();
      }
    },
    bekleyen: () => bekleyenler.size,
  };
}

const pil = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Pil', ...ek } });
const guncelleme = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: 'Güncelleme', latest_version: '2026.10.1', ...ek } });

function bellekDeposu() {
  const kume = new Set();
  return {
    kume,
    var: (a) => kume.has(a),
    ekle: (a) => {
      if (!kapatilanAnahtariGecerliMi(a)) return false;
      kume.add(a);
      return true;
    },
    sil: (a) => kume.delete(a),
    anahtarlar: () => [...kume],
  };
}

function merkezKur(ayar = {}) {
  const kapatilan = bellekDeposu();
  const yeniler = [];
  let an = 5_000_000;
  const merkez = merkezOlustur({ kapatilan, simdi: () => an, yeniOge: (o) => yeniler.push(o) });
  merkez.ayarla({ kalici: true, pil: true, guncelleme: true, pilEsigi: 20, ...ayar });
  return { merkez, kapatilan, yeniler, ilerle: (ms) => (an += ms), simdi: () => an };
}

const haB = (id, metin, ek = {}) => ({ id, baslik: null, metin, zaman: '2026-10-16T09:00:00+00:00', ...ek });

// --- Markdown -------------------------------------------------------------------------------------------------------

test('duzMetin: Markdown düz metne iner', () => {
  assert.equal(duzMetin('# Başlık\n\n**Kalın** ve *italik* `kod`'), 'Başlık Kalın ve italik kod');
  assert.equal(duzMetin('Bak [bağlantı](https://ornek.test/x?y=1) burada'), 'Bak bağlantı burada');
  assert.equal(duzMetin('![resim](https://ornek.test/a.png) altı'), 'resim altı');
  assert.equal(duzMetin('- bir\n- iki\n1. üç'), '• bir • iki üç');
  assert.equal(duzMetin('> alıntı\n\n---\nson'), 'alıntı son');
  assert.equal(duzMetin('<b>kalın</b> <https://ornek.test> metin'), 'kalın metin');
  assert.equal(duzMetin('```\nkod satırı\n```'), 'kod satırı');
});

test('duzMetin: adres gösterilmez, entity_id altçizgileri bozulmaz, boşluklar teke iner', () => {
  assert.equal(duzMetin('sensor.salon_sicaklik  pili\n\n\n bitti'), 'sensor.salon_sicaklik pili bitti');
  assert.ok(!duzMetin('[tıkla](http://gizli.test/token=abc)').includes('gizli.test'));
});

test('duzMetin: metin olmayan girdi ve çok uzun girdi güvenli', () => {
  assert.equal(duzMetin(null), '');
  assert.equal(duzMetin(42), '');
  assert.equal(duzMetin(undefined), '');
  assert.ok(duzMetin('a '.repeat(10_000)).length <= 4000);
});

// --- pil ve güncelleme varlıkları ------------------------------------------------------------------------------------

test('pilVarligi: sayısal pil sensörü ve düşük pil ikili sensörü', () => {
  assert.deepEqual(pilVarligi(pil('sensor.a_pil', '12')), { kimlik: 'sensor.a_pil', ad: 'Pil', yuzde: 12, dusuk: false, belirsiz: false });
  assert.equal(pilVarligi(pil('sensor.a_pil', '12.6')).yuzde, 13);
  assert.equal(pilVarligi(pil('binary_sensor.b_pil', 'on', { unit_of_measurement: undefined })).dusuk, true);
  assert.equal(pilVarligi(pil('binary_sensor.b_pil', 'off')).dusuk, false);
  assert.equal(pilVarligi(pil('sensor.a_pil', 'unavailable')).belirsiz, true);
});

test('pilVarligi: pil olmayan, birimi yanlış, aralık dışı ve bozuk girdi null', () => {
  assert.equal(pilVarligi({ entity_id: 'sensor.a', state: '12', attributes: { device_class: 'temperature' } }), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', '12', { unit_of_measurement: 'V' })), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', '120')), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', 'abc')), null);
  assert.equal(pilVarligi(pil('light.a', '12')), null);
  assert.equal(pilVarligi(pil('binary_sensor.b_pil', 'belki')), null);
  assert.equal(pilVarligi(null), null);
  assert.equal(pilVarligi({}), null);
  assert.equal(pilVarligi({ entity_id: 'Sensor.X', state: '1', attributes: {} }), null);
});

test('pilVarligi (kapı kuralı): kapı/kilit adlı sensörün pili listeye girmez', () => {
  assert.equal(pilVarligi(pil('sensor.on_kapi_pil', '5')), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', '5', { friendly_name: 'Garaj kapısı pili' })), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', '5', { friendly_name: 'Front door' })), null);
  assert.equal(pilVarligi(pil('sensor.a_pil', '5', { friendly_name: 'Akıllı kilit' })), null);
  assert.equal(pilVarligi(pil('sensor.lock_pil', '5')), null);
  assert.equal(pilVarligi(pil('binary_sensor.d_pil', 'on', { friendly_name: 'Kapı pili' })), null);
});

test('guncellemeVarligi: bekleyen güncelleme, sürüm temizlenir', () => {
  assert.deepEqual(guncellemeVarligi(guncelleme('update.ha_core', 'on')), { kimlik: 'update.ha_core', ad: 'Güncelleme', surum: '2026.10.1', belirsiz: false, bekliyor: true });
  assert.equal(guncellemeVarligi(guncelleme('update.ha_core', 'off')).bekliyor, false);
  const b = guncellemeVarligi(guncelleme('update.ha_core', 'unavailable'));
  assert.equal(b.belirsiz, true);
  assert.equal(b.bekliyor, false);
  assert.equal(guncellemeVarligi(guncelleme('update.ha_core', 'on', { latest_version: '<script>x</script>' })).surum, '');
  assert.equal(guncellemeVarligi(guncelleme('sensor.x', 'on')), null);
  assert.equal(guncellemeVarligi(null), null);
});

test('guncellemeVarligi (kapı kuralı): kilit/kapı yazılımı güncellemesi listeye girmez', () => {
  assert.equal(guncellemeVarligi(guncelleme('update.on_kapi_kilidi', 'on')), null);
  assert.equal(guncellemeVarligi(guncelleme('update.x', 'on', { friendly_name: 'Garaj kapısı yazılımı' })), null);
  assert.equal(guncellemeVarligi(guncelleme('update.x', 'on', { friendly_name: 'Smart Lock firmware' })), null);
  assert.equal(guncellemeVarligi(guncelleme('update.x', 'on', { device_class: 'door' })), null);
});

test('surumTemizle: yalnız güvenli sürüm karakterleri', () => {
  assert.equal(surumTemizle('2026.10.1'), '2026.10.1');
  assert.equal(surumTemizle(' 1.2.3-beta+4 '), '1.2.3-beta+4');
  assert.equal(surumTemizle('1 2'), '');
  assert.equal(surumTemizle('x'.repeat(31)), '');
  assert.equal(surumTemizle(5), '');
  assert.equal(surumTemizle('unlock'), '', 'kapı/kilit sözcüğü içeren sürüm metni atılır');
});

test('varliklariTara: pil ve güncellemeleri ayırır, diğerlerini atar, dizi değilse null', () => {
  const s = varliklariTara([pil('sensor.a_pil', '5'), pil('binary_sensor.b_pil', 'on'), guncelleme('update.u1', 'on'), { entity_id: 'light.x', state: 'on', attributes: {} }, null, 'x', { state: 1 }]);
  assert.deepEqual([...s.piller.keys()].sort(), ['binary_sensor.b_pil', 'sensor.a_pil']);
  assert.deepEqual([...s.guncellemeler.keys()], ['update.u1']);
  assert.equal(varliklariTara(null), null);
  assert.equal(varliklariTara({}), null);
  assert.equal(varliklariTara([]).piller.size, 0);
});

test('varliklariTara: sayı sınırları uygulanır', () => {
  const cok = Array.from({ length: 500 }, (_, i) => pil(`sensor.s${i}_pil`, '5'));
  assert.equal(varliklariTara(cok).piller.size, 100);
});

// --- kapatılan deposu --------------------------------------------------------------------------------------------------

test('kapatilanAnahtariGecerliMi: yalnız pil: ve guncelleme: anahtarları', () => {
  assert.equal(kapatilanAnahtariGecerliMi('pil:sensor.a_pil'), true);
  assert.equal(kapatilanAnahtariGecerliMi('guncelleme:update.ha_core:2026.10.1'), true);
  assert.equal(kapatilanAnahtariGecerliMi('guncelleme:update.ha_core'), true);
  for (const bozuk of ['ha:abc', 'uyari:u1:5', 'pil:', 'pil:Sensor.X', 'pil:sensor.a/../b', '', null, 5, `pil:sensor.${'a'.repeat(200)}`]) {
    assert.equal(kapatilanAnahtariGecerliMi(bozuk), false, String(bozuk));
  }
});

test('kapatilanlariDuzelt: bozuk, yinelenen ve çok eski kayıtlar atılır', () => {
  const an = 1_000_000_000_000;
  const sonuc = kapatilanlariDuzelt(
    {
      kayitlar: [
        { anahtar: 'pil:sensor.a', zaman: an },
        { anahtar: 'pil:sensor.a', zaman: an },
        { anahtar: 'x:y', zaman: an },
        { anahtar: 'pil:sensor.eski', zaman: an - 100 * 24 * 3600 * 1000 },
        { anahtar: 'pil:sensor.b', zaman: 'x' },
        null,
      ],
    },
    an,
  );
  assert.deepEqual(sonuc.map((k) => k.anahtar), ['pil:sensor.a']);
  assert.deepEqual(kapatilanlariDuzelt(null), []);
  assert.deepEqual(kapatilanlariDuzelt({ kayitlar: 'x' }), []);
});

test('kapatılan deposu: ekle/var/sil, gecikmeli atomik yazma, yeniden yükleme', () => {
  const fs = sahteFs();
  const zaman = sahteZaman();
  const kur = () => kapatilanDeposuOlustur({ dosyaYolu: 'C:\\x\\bildirim-kapatilan.json', fs, zaman, simdi: () => 1_000 });
  const d = kur();
  assert.equal(d.yukle(), 0);
  assert.equal(d.ekle('pil:sensor.a_pil'), true);
  assert.equal(d.ekle('pil:sensor.a_pil'), true, 'aynı anahtar ikinci kez eklenmez');
  assert.equal(d.sayi(), 1);
  assert.equal(d.ekle('ha:abc'), false);
  assert.equal(d.var('pil:sensor.a_pil'), true);
  assert.equal(fs.dosyalar.size, 0, 'yazma gecikmeli');
  zaman.atesle();
  assert.equal(fs.dosyalar.size, 1);
  assert.ok(!fs.dosyalar.has('C:\\x\\bildirim-kapatilan.json.tmp'), 'geçici dosya yeniden adlandırıldı');
  const icerik = fs.dosyalar.get('C:\\x\\bildirim-kapatilan.json');
  assert.ok(!/token|http|password/i.test(icerik));
  const d2 = kur();
  assert.equal(d2.yukle(), 1);
  assert.equal(d2.var('pil:sensor.a_pil'), true);
  d2.sil('pil:sensor.a_pil');
  d2.bosalt();
  assert.equal(kur().yukle(), 0);
});

test('kapatılan deposu: bozuk dosya boş başlar ve günlüğe sabit metin yazar; en çok KAPATILAN_EN_COK', () => {
  const fs = sahteFs({ 'k.json': '{bozuk' });
  const gunluk = [];
  const d = kapatilanDeposuOlustur({ dosyaYolu: 'k.json', fs, gunluk: (m) => gunluk.push(m), zaman: sahteZaman() });
  assert.equal(d.yukle(), 0);
  assert.equal(gunluk.length, 1);
  for (let i = 0; i < KAPATILAN_EN_COK + 30; i += 1) d.ekle(`pil:sensor.s${i}`);
  assert.equal(d.sayi(), KAPATILAN_EN_COK);
});

test('kapatılan deposu: yazma hatası fırlatmaz', () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('disk dolu');
  };
  const gunluk = [];
  const d = kapatilanDeposuOlustur({ dosyaYolu: 'k.json', fs, gunluk: (m) => gunluk.push(m), zaman: sahteZaman() });
  d.ekle('pil:sensor.a');
  assert.equal(d.bosalt(), false);
  assert.equal(gunluk.length, 1);
});

// --- merkez: HA bildirimleri -------------------------------------------------------------------------------------------

test('merkez: ilk HA listesi sessizdir, sonra gelen yeni bildirim bir kez bildirilir', () => {
  const { merkez, yeniler } = merkezKur();
  merkez.haGuncelle([haB('a1', 'Eski bildirim')]);
  assert.equal(yeniler.length, 0, 'açılışta mevcut bildirim yansıtılmaz');
  assert.equal(merkez.model().sayi, 1);
  merkez.haGuncelle([haB('a1', 'Eski bildirim'), haB('b2', 'Yeni bildirim', { baslik: 'Başlık' })]);
  assert.equal(yeniler.length, 1);
  assert.equal(yeniler[0].anahtar, 'ha:b2');
  assert.equal(yeniler[0].baslik, 'Başlık');
  merkez.haGuncelle([haB('a1', 'Eski bildirim'), haB('b2', 'Yeni bildirim güncellendi')]);
  assert.equal(yeniler.length, 1, 'güncelleme tekrar bildirilmez');
  merkez.haGuncelle([haB('a1', 'Eski bildirim')]);
  merkez.haGuncelle([haB('a1', 'Eski bildirim'), haB('b2', 'Yeni bildirim')]);
  assert.equal(yeniler.length, 2, 'kalkıp geri gelen yeni sayılır');
});

test('merkez: HA bildirimi Markdown\'dan arındırılır ve başlığı yoksa varsayılan başlık verilir', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a1', '**Dikkat:** [ayrıntı](https://ornek.test/x) için bak')]);
  const [oge] = merkez.model().ogeler;
  assert.equal(oge.metin, 'Dikkat: ayrıntı için bak');
  assert.equal(oge.baslik, 'Home Assistant');
  assert.equal(oge.kaynak, 'ha');
  assert.ok(!('haKimligi' in oge), 'renderer\'a HA kimliği gitmez');
});

test('merkez (kapı kuralı): Markdown sadeleştirmesinden sonra kapı sözcüğü doğarsa bildirim gösterilmez, sayılır', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a1', 'Garaj [kapısı](x) açık kaldı'), haB('a2', 'Tamam')], { gizlenen: 2 });
  const m = merkez.model();
  assert.deepEqual(m.ogeler.map((o) => o.anahtar), ['ha:a2']);
  assert.equal(m.gizlenen, 3, 'ha-okuma sayısı (2) + merkezin kendi süzgeci (1)');
});

test('merkez (kapı kuralı): başlık süzgeçten geçmezse bildirim gösterilmez', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a1', 'Normal metin', { baslik: 'Ön kapı kilidi' })]);
  assert.equal(merkez.model().ogeler.length, 0);
  assert.equal(merkez.model().gizlenen, 1);
});

test('merkez: HA bildirimi kapatma HA kimliği döner; başarıdan sonra hemen listeden çıkar', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a1', 'Bir'), haB('a2', 'İki')]);
  assert.equal(merkez.haKimligiVarMi('a1'), true);
  const sonuc = merkez.kapat('ha:a1');
  assert.deepEqual(sonuc, { tur: 'ha', haKimligi: 'a1' });
  assert.equal(merkez.model().sayi, 2, 'HA onaylamadan çıkarılmaz');
  merkez.haKapandi('a1');
  assert.deepEqual(merkez.model().ogeler.map((o) => o.anahtar), ['ha:a2']);
  assert.equal(merkez.haKimligiVarMi('a1'), false);
});

test('merkez: geçersiz HA bildirim kimlikleri ve bozuk liste yok sayılır', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a b', 'Boşluklu'), haB('../x', 'Yol'), { id: 5, metin: 'x' }, null, haB('ok', 'Tamam')]);
  assert.deepEqual(merkez.model().ogeler.map((o) => o.anahtar), ['ha:ok']);
  merkez.haGuncelle(null);
  assert.equal(merkez.model().sayi, 0);
});

test('merkez: bildirimKalici kapalıyken HA bildirimleri gösterilmez ve yeni sayılmaz', () => {
  const { merkez, yeniler } = merkezKur({ kalici: false });
  merkez.haGuncelle([haB('a1', 'Bir')]);
  merkez.haGuncelle([haB('a1', 'Bir'), haB('a2', 'İki')]);
  assert.equal(merkez.model().sayi, 0);
  assert.equal(yeniler.length, 0);
});

// --- merkez: pil ---------------------------------------------------------------------------------------------------------

test('merkez: düşük pil eşikle süzülür; ilk tarama sessiz, sonra yeni düşen bildirilir', () => {
  const { merkez, yeniler } = merkezKur();
  assert.equal(merkez.taramaGuncelle([pil('sensor.a_pil', '10'), pil('sensor.b_pil', '80')]), true);
  assert.equal(yeniler.length, 0);
  assert.deepEqual(merkez.model().ogeler.map((o) => o.anahtar), ['pil:sensor.a_pil']);
  merkez.taramaGuncelle([pil('sensor.a_pil', '9'), pil('sensor.b_pil', '15')]);
  assert.equal(yeniler.length, 1);
  assert.equal(yeniler[0].anahtar, 'pil:sensor.b_pil');
  assert.equal(yeniler[0].kaynak, 'pil');
  merkez.taramaGuncelle([pil('sensor.a_pil', '8'), pil('sensor.b_pil', '14')]);
  assert.equal(yeniler.length, 1, 'koşul sürerken tekrar yok');
});

test('merkez: pil metni yüzdeyi ve adı içerir; iki dilde', () => {
  const { merkez } = merkezKur();
  merkez.taramaGuncelle([pil('sensor.a_pil', '12', { friendly_name: 'Salon sensörü' })]);
  const tr = merkez.model().ogeler[0];
  assert.ok(tr.metin.includes('Salon sensörü') && tr.metin.includes('12'), tr.metin);
  assert.equal(tr.baslik, 'Düşük pil');
  merkez.dilDegisti(EN);
  const en = merkez.model().ogeler[0];
  assert.equal(en.baslik, 'Low battery');
  assert.notEqual(en.metin, tr.metin);
});

test('merkez: ikili düşük pil sensörü', () => {
  const { merkez } = merkezKur();
  merkez.taramaGuncelle([pil('binary_sensor.b_pil', 'on', { unit_of_measurement: undefined, friendly_name: 'Dedektör' })]);
  assert.ok(merkez.model().ogeler[0].metin.includes('Dedektör'));
});

test('merkez: pil yerelde kapatılır, koşul kalkana dek geri gelmez; koşul kalkınca kayıt silinir ve yeniden düşünce gösterilir', () => {
  const { merkez, kapatilan, yeniler } = merkezKur();
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  assert.deepEqual(merkez.kapat('pil:sensor.a_pil'), { tur: 'yerel' });
  assert.equal(kapatilan.var('pil:sensor.a_pil'), true);
  assert.equal(merkez.model().sayi, 0);
  merkez.taramaGuncelle([pil('sensor.a_pil', '9')]);
  assert.equal(merkez.model().sayi, 0, 'pil daha da düştü: yine kapalı');
  merkez.taramaGuncelle([pil('sensor.a_pil', '95')]); // pil değişti
  assert.equal(kapatilan.var('pil:sensor.a_pil'), false, 'koşul kalktı: kayıt silindi');
  merkez.taramaGuncelle([pil('sensor.a_pil', '7')]);
  assert.equal(merkez.model().sayi, 1);
  assert.equal(yeniler.length, 1, 'yeniden düşen yeni bildirimdir');
});

test('merkez: ulaşılamıyor durumu pil koşulunu kaldırmaz (kapatma ve bildirim sıfırlanmaz)', () => {
  const { merkez, kapatilan, yeniler } = merkezKur();
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  merkez.kapat('pil:sensor.a_pil');
  merkez.taramaGuncelle([pil('sensor.a_pil', 'unavailable')]);
  assert.equal(kapatilan.var('pil:sensor.a_pil'), true);
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  assert.equal(merkez.model().sayi, 0);
  assert.equal(yeniler.length, 0);
});

test('merkez: HA\'dan kalkan (silinen) pil varlığı koşulu bitirir', () => {
  const { merkez, kapatilan } = merkezKur();
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  merkez.kapat('pil:sensor.a_pil');
  merkez.taramaGuncelle([]);
  assert.equal(kapatilan.var('pil:sensor.a_pil'), false);
});

test('merkez: eşik değişimi sessizdir ve gösterimi günceller; geçersiz eşik yok sayılır', () => {
  const { merkez, yeniler } = merkezKur({ pilEsigi: 10 });
  merkez.taramaGuncelle([pil('sensor.a_pil', '15')]);
  assert.equal(merkez.model().sayi, 0);
  merkez.ayarla({ pilEsigi: 30 });
  assert.equal(merkez.model().sayi, 1);
  assert.equal(yeniler.length, 0, 'eşik değişimi bildirim üretmez');
  merkez.ayarla({ pilEsigi: 3 });
  merkez.ayarla({ pilEsigi: 'x' });
  merkez.ayarla({ pilEsigi: 1.5 });
  assert.equal(merkez.ayarlar().pilEsigi, 30);
});

test('merkez: pil kapalıyken tarama öğesi yok; açılınca mevcutlar sessiz görünür', () => {
  const { merkez, yeniler } = merkezKur({ pil: false });
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  assert.equal(merkez.model().sayi, 0);
  merkez.ayarla({ pil: true });
  assert.equal(merkez.model().sayi, 1);
  assert.equal(yeniler.length, 0);
});

test('merkez: geçersiz tarama (dizi değil) önceki veriyi bozmaz', () => {
  const { merkez } = merkezKur();
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  assert.equal(merkez.taramaGuncelle(null), false);
  assert.equal(merkez.taramaGuncelle('x'), false);
  assert.equal(merkez.model().sayi, 1);
});

// --- merkez: güncelleme ---------------------------------------------------------------------------------------------------

test('merkez: güncelleme bildirimi sürümü içerir; yerelde kapatılır; yeni sürüm yeni bildirimdir', () => {
  const { merkez, kapatilan, yeniler } = merkezKur();
  merkez.taramaGuncelle([guncelleme('update.ha_core', 'on', { latest_version: '2026.10.1', friendly_name: 'HA Core' })]);
  const oge = merkez.model().ogeler[0];
  assert.equal(oge.kaynak, 'guncelleme');
  assert.ok(oge.metin.includes('HA Core') && oge.metin.includes('2026.10.1'), oge.metin);
  assert.equal(oge.anahtar, 'guncelleme:update.ha_core:2026.10.1');
  assert.deepEqual(merkez.kapat(oge.anahtar), { tur: 'yerel' });
  assert.equal(merkez.model().sayi, 0);
  assert.equal(yeniler.length, 0);
  merkez.taramaGuncelle([guncelleme('update.ha_core', 'on', { latest_version: '2026.10.2', friendly_name: 'HA Core' })]);
  assert.equal(merkez.model().sayi, 1, 'yeni sürüm geldi');
  assert.equal(yeniler.length, 1);
  assert.equal(kapatilan.var('guncelleme:update.ha_core:2026.10.1'), false, 'eski sürüme ait kayıt silindi');
});

test('merkez: güncelleme yüklenince (off) öğe kalkar', () => {
  const { merkez } = merkezKur();
  merkez.taramaGuncelle([guncelleme('update.ha_core', 'on')]);
  assert.equal(merkez.model().sayi, 1);
  merkez.taramaGuncelle([guncelleme('update.ha_core', 'off')]);
  assert.equal(merkez.model().sayi, 0);
});

test('merkez: güncelleme varsayılan kapalı ayarıyla gösterilmez', () => {
  const { merkez } = merkezKur({ guncelleme: false });
  merkez.taramaGuncelle([guncelleme('update.ha_core', 'on')]);
  assert.equal(merkez.model().sayi, 0);
});

// --- merkez: uyarılar --------------------------------------------------------------------------------------------------------

const olay = (ek = {}) => ({ kuralId: 'u1', kimlik: 'sensor.a', alan: 'sensor', simge: '📈', metin: 'Salon çok sıcak', sessiz: false, windows: false, zaman: 5_000_000, ...ek });

test('merkez: uyarı eklenir, en yeni önde; kaynağa göre sıralama uyarı > ha > pil', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle([haB('a1', 'HA')]);
  merkez.taramaGuncelle([pil('sensor.a_pil', '5')]);
  merkez.uyariEkle(olay({ zaman: 5_000_001 }));
  merkez.uyariEkle(olay({ zaman: 5_000_002, metin: 'İkinci' }));
  const m = merkez.model();
  assert.deepEqual(m.ogeler.map((o) => o.kaynak), ['uyari', 'uyari', 'ha', 'pil']);
  assert.equal(m.ogeler[0].metin, 'İkinci');
  assert.equal(m.ogeler[0].simge, '📈');
});

test('merkez: uyarı metni süzgeçten geçmezse eklenmez; bozuk olay null', () => {
  const { merkez } = merkezKur();
  assert.equal(merkez.uyariEkle(olay({ metin: 'Kapıyı aç' })), null);
  assert.equal(merkez.uyariEkle(null), null);
  assert.equal(merkez.uyariEkle({ metin: 'x' }), null);
  assert.equal(merkez.uyariEkle(olay({ metin: '' })), null);
  assert.equal(merkez.model().sayi, 0);
});

test('merkez: uyarı kapatılır (yerel, kalıcı değil); 24 saat sonra düşer; en çok EN_COK_UYARI', () => {
  const { merkez, kapatilan, ilerle } = merkezKur();
  const o = merkez.uyariEkle(olay());
  assert.deepEqual(merkez.kapat(o.anahtar), { tur: 'yerel' });
  assert.equal(merkez.model().sayi, 0);
  assert.equal(kapatilan.kume.size, 0, 'uyarı dosyaya yazılmaz');
  merkez.uyariEkle(olay({ zaman: 5_000_000 }));
  ilerle(UYARI_OMRU_MS + 1000);
  assert.equal(merkez.model().sayi, 0);
  for (let i = 0; i < EN_COK_UYARI + 10; i += 1) merkez.uyariEkle(olay({ zaman: 9_000_000 + i }));
  assert.equal(merkez.model().sayi, EN_COK_UYARI);
});

test('merkez: simge geçersizse zil kullanılır', () => {
  const { merkez } = merkezKur();
  merkez.uyariEkle(olay({ simge: '<img src=x onerror=1>' }));
  assert.equal(merkez.model().ogeler[0].simge, '🔔');
});

// --- merkez: genel ------------------------------------------------------------------------------------------------------------

test('merkez: model en çok EN_COK_OGE öğe döner ama sayı gerçek toplamdır', () => {
  const { merkez } = merkezKur();
  merkez.haGuncelle(Array.from({ length: 50 }, (_, i) => haB(`id${i}`, `Bildirim ${i}`)));
  const m = merkez.model();
  assert.equal(m.ogeler.length, EN_COK_OGE);
  assert.equal(m.sayi, 50);
});

test('merkez: kapat bilinmeyen/bozuk anahtarda null; yerel kapatma geçersiz anahtarı yazmaz', () => {
  const { merkez, kapatilan } = merkezKur();
  assert.equal(merkez.kapat('ha:yok'), null);
  assert.equal(merkez.kapat('pil:sensor.yok'), null);
  assert.equal(merkez.kapat(null), null);
  assert.equal(merkez.kapat(42), null);
  assert.equal(kapatilan.kume.size, 0);
});

test('merkez: dinleyici değişimde çağrılır, hatası merkezi bozmaz, abonelik bırakılabilir', () => {
  const { merkez } = merkezKur();
  let sayac = 0;
  const birak = merkez.dinle(() => {
    sayac += 1;
  });
  merkez.dinle(() => {
    throw new Error('x');
  });
  merkez.haGuncelle([haB('a1', 'Bir')]);
  assert.ok(sayac >= 1);
  const onceki = sayac;
  birak();
  merkez.haGuncelle([haB('a1', 'Bir'), haB('a2', 'İki')]);
  assert.equal(sayac, onceki);
});

test('merkez: yeniOge geri çağrısı fırlatırsa merkez çalışmaya devam eder', () => {
  const merkez = merkezOlustur({
    kapatilan: bellekDeposu(),
    yeniOge: () => {
      throw new Error('x');
    },
  });
  merkez.haGuncelle([haB('a1', 'Bir')]);
  assert.doesNotThrow(() => merkez.haGuncelle([haB('a1', 'Bir'), haB('a2', 'İki')]));
  assert.equal(merkez.model().sayi, 2);
});

test('merkez: yerelde kapatılmış öğe yeniden "yeni" olarak yansıtılmaz', () => {
  const { merkez, kapatilan, yeniler } = merkezKur();
  merkez.taramaGuncelle([]);
  kapatilan.ekle('pil:sensor.a_pil');
  merkez.taramaGuncelle([pil('sensor.a_pil', '10')]);
  assert.equal(yeniler.length, 0, 'kapatılmış öğe için yansıtma yok');
});

test('KAYNAKLAR sıralaması: uyarı en üstte', () => {
  assert.deepEqual([...KAYNAKLAR], ['uyari', 'ha', 'pil', 'guncelleme']);
});
