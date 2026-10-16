'use strict';

/**
 * Yeni şemalı ayar dosyasında ikinci gidiş (src/lib/ayar-yedegi.js): var olan yedek (COPYFILE_EXCL ile asla ezilmez) o günkü durumu
 * kapsamıyorsa şimdiki dosya zaman damgalı ek bir yedeğe alınır (ayarlar.v<N>-yedek-<zaman>.json); aynı içerik tekrar yedeklenmez, en yeni
 * EN_COK_ZAMANLI_YEDEK tane tutulur. Gerçek dosya sistemi yalnız geçici klasörde; %APPDATA%'ya dokunulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SEMA_SURUMU } = require('../src/lib/ayar-sema');
const {
  yedekDosyaAdi,
  zamanliYedekZamani,
  zamanliYedekleriBud,
  yedekleriListele,
  yedekAdiGecerliMi,
  EN_COK_ZAMANLI_YEDEK,
  gocOncesiYedegiAl,
} = require('../src/lib/ayar-yedegi');

const GELECEK = SEMA_SURUMU + 1;
const gelecekAd = (zaman) => yedekDosyaAdi(GELECEK, zaman);
const gelecekMetni = (n) => JSON.stringify({ semaSurumu: GELECEK, favoriler: [], deneme: n });
const V1_METIN = '\uFEFF{\n  "yerelAdres": "http://192.168.1.10:8123",\n  "favoriler": [{ "entity_id": "light.salon_lambasi" }]\n}\n';
const V1_HAM = { yerelAdres: 'http://192.168.1.10:8123', favoriler: [{ entity_id: 'light.salon_lambasi' }] };

const gunlukToplayici = () => {
  const satirlar = [];
  const gunluk = (mesaj) => satirlar.push(mesaj);
  gunluk.satirlar = satirlar;
  return gunluk;
};

function gecici(govde) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-yedek-zaman-test-'));
  try {
    return govde(dizin);
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
}

test('yedek adı: zaman verilirse ayarlar.v<N>-yedek-<zaman>.json; zamanliYedekZamani yalnız kendi biçimini tanır', () => {
  assert.equal(yedekDosyaAdi(6, 1_760_000_000_123), 'ayarlar.v6-yedek-1760000000123.json');
  assert.equal(yedekDosyaAdi(6), 'ayarlar.v6-yedek.json');
  assert.equal(zamanliYedekZamani('ayarlar.v6-yedek-1760000000123.json', 6), 1_760_000_000_123);
  for (const [ad, surum] of [
    ['ayarlar.v6-yedek.json', 6],
    ['ayarlar.v7-yedek-1760000000123.json', 6],
    ['ayarlar.v6-yedek-123.json', 6],
    ['ayarlar.v6-yedek-1760000000123.json.bak', 6],
    ['xayarlar.v6-yedek-1760000000123.json', 6],
    ['ayarlar.v6-yedek-17600000001ab.json', 6],
    [null, 6],
    [42, 6],
  ]) {
    assert.equal(zamanliYedekZamani(ad, surum), null, String(ad));
  }
});

test('bulgu: yeni şemalı dosyanın yedeği zaten varsa ve içerik FARKLIYSA ek yedek (zaman damgalı) alınır; var olan yedek ezilmez', () => {
  gecici((dizin) => {
    const dosya = path.join(dizin, 'ayarlar.json');
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(GELECEK)), gelecekMetni('eski-yedek'));
    fs.writeFileSync(dosya, gelecekMetni('yeni-durum'));
    const gunluk = gunlukToplayici();
    const sonuc = gocOncesiYedegiAl({ dosya, ham: JSON.parse(gelecekMetni('yeni-durum')), fs, gunluk });
    assert.equal(sonuc.durum, 'alindi');
    assert.match(sonuc.yedek, new RegExp(`^ayarlar\\.v${GELECEK}-yedek-\\d{13}\\.json$`));
    assert.equal(fs.readFileSync(path.join(dizin, sonuc.yedek), 'utf8'), gelecekMetni('yeni-durum'), 'yeni durum bayt bayt kopyalandı');
    assert.equal(fs.readFileSync(path.join(dizin, yedekDosyaAdi(GELECEK)), 'utf8'), gelecekMetni('eski-yedek'), 'kanonik yedek ezilmedi');
    assert.equal(gunluk.satirlar.length, 1);
    assert.equal(gunluk.satirlar[0], `Daha yeni şemalı ayar dosyası var olan yedekten farklı; ayrıca yedeklendi: ${sonuc.yedek}`);
  });
});

test('aynı içerik bir yedekte zaten varsa (kanonik ya da zaman damgalı) yeni kopya açılmaz: her açılışta yedek çoğalmaz', () => {
  gecici((dizin) => {
    const dosya = path.join(dizin, 'ayarlar.json');
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(GELECEK)), gelecekMetni('a'));
    fs.writeFileSync(dosya, gelecekMetni('a'));
    const ham = { semaSurumu: GELECEK };
    assert.deepEqual(gocOncesiYedegiAl({ dosya, ham, fs, gunluk: gunlukToplayici() }), { durum: 'zaten-var', yedek: yedekDosyaAdi(GELECEK) }, 'kanonik yedek aynı');
    fs.writeFileSync(dosya, gelecekMetni('b'));
    const ikinci = gocOncesiYedegiAl({ dosya, ham, fs, gunluk: gunlukToplayici() });
    assert.equal(ikinci.durum, 'alindi');
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(gocOncesiYedegiAl({ dosya, ham, fs, gunluk: gunlukToplayici() }), { durum: 'zaten-var', yedek: ikinci.yedek }, `tekrar ${i}: zaman damgalı yedek aynı`);
    }
    assert.equal(fs.readdirSync(dizin).filter((a) => a.includes('-yedek')).length, 2, 'kanonik + tek zaman damgalı');
  });
});

test('zaman damgalı yeni şema yedekleri en çok EN_COK_ZAMANLI_YEDEK tane tutulur: en eskiler silinir, kanonik yedek ve başka şemaların yedekleri silinmez', () => {
  gecici((dizin) => {
    const dosya = path.join(dizin, 'ayarlar.json');
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(GELECEK)), gelecekMetni('kanonik'));
    const eskiZamanlar = Array.from({ length: EN_COK_ZAMANLI_YEDEK + 2 }, (_, i) => 1_700_000_000_000 + i);
    for (const z of eskiZamanlar) fs.writeFileSync(path.join(dizin, gelecekAd(z)), gelecekMetni(`z${z}`));
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(GELECEK + 1, 1_600_000_000_000)), 'baska-sema');
    fs.writeFileSync(dosya, gelecekMetni('en-yeni'));
    const sonuc = gocOncesiYedegiAl({ dosya, ham: { semaSurumu: GELECEK }, fs, gunluk: gunlukToplayici() });
    assert.equal(sonuc.durum, 'alindi');
    const zamanli = fs.readdirSync(dizin).filter((a) => zamanliYedekZamani(a, GELECEK) !== null).sort();
    assert.equal(zamanli.length, EN_COK_ZAMANLI_YEDEK);
    assert.ok(zamanli.includes(sonuc.yedek), 'yeni yedek tutuldu');
    assert.ok(!fs.existsSync(path.join(dizin, gelecekAd(eskiZamanlar[0]))), 'en eski silindi');
    assert.ok(fs.existsSync(path.join(dizin, gelecekAd(eskiZamanlar.at(-1)))), 'yeniler kaldı');
    assert.ok(fs.existsSync(path.join(dizin, yedekDosyaAdi(GELECEK))), 'kanonik yedek silinmedi');
    assert.ok(fs.existsSync(path.join(dizin, yedekDosyaAdi(GELECEK + 1, 1_600_000_000_000))), 'başka şemanın yedeği silinmedi');
  });
});

test('ek yedek yalnız YENİ şemalı dosya için: eski şemada (göç) var olan yedek aynen "zaten-var" kalır', () => {
  gecici((dizin) => {
    const dosya = path.join(dizin, 'ayarlar.json');
    fs.writeFileSync(path.join(dizin, 'ayarlar.v1-yedek.json'), 'ESKI-YEDEK');
    fs.writeFileSync(dosya, V1_METIN);
    assert.deepEqual(gocOncesiYedegiAl({ dosya, ham: V1_HAM, fs, gunluk: gunlukToplayici() }), { durum: 'zaten-var', yedek: 'ayarlar.v1-yedek.json' });
    assert.deepEqual(fs.readdirSync(dizin).sort(), ['ayarlar.json', 'ayarlar.v1-yedek.json'], 'eski şemada zaman damgalı kopya açılmaz');
    assert.equal(fs.readFileSync(path.join(dizin, 'ayarlar.v1-yedek.json'), 'utf8'), 'ESKI-YEDEK');
  });
});

/** copyFileSync'i taklit eden bellek içi dosya sistemi (COPYFILE_EXCL: var olan hedef EEXIST); okuma/listeleme isteğe bağlı. */
function sahteFs(baslangic, { okumaVar = true, kopyaHatasi = null } = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  const tabani = {
    dosyalar,
    copyFileSync(kaynak, hedef, bayrak = 0) {
      if (kopyaHatasi && hedef.includes('-yedek-')) throw Object.assign(new Error(`${kopyaHatasi} ${hedef} TEST_ANAHTAR_000`), { code: kopyaHatasi });
      if (!dosyalar.has(kaynak)) throw Object.assign(new Error('yok'), { code: 'ENOENT' });
      if (dosyalar.has(hedef) && bayrak & fs.constants.COPYFILE_EXCL) throw Object.assign(new Error('var'), { code: 'EEXIST' });
      dosyalar.set(hedef, dosyalar.get(kaynak));
    },
  };
  if (okumaVar) {
    tabani.readFileSync = (yol) => {
      if (!dosyalar.has(yol)) throw Object.assign(new Error('yok'), { code: 'ENOENT' });
      return dosyalar.get(yol);
    };
    tabani.readdirSync = () => [...dosyalar.keys()].map((yol) => path.basename(yol));
  }
  return tabani;
}

test('karşılaştırma yapılamıyorsa (okuma/listeleme yok ya da okuma hatası) eski davranış: "zaten-var", hata yok', () => {
  const klasor = path.join('K', 'Ev Paneli');
  const dosya = path.join(klasor, 'ayarlar.json');
  const yedek = path.join(klasor, yedekDosyaAdi(GELECEK));
  const okumasiz = sahteFs({ [dosya]: 'YENI', [yedek]: 'ESKI' }, { okumaVar: false });
  assert.deepEqual(gocOncesiYedegiAl({ dosya, ham: { semaSurumu: GELECEK }, fs: okumasiz, gunluk: gunlukToplayici() }), { durum: 'zaten-var', yedek: yedekDosyaAdi(GELECEK) });
  const hatali = sahteFs({ [dosya]: 'YENI', [yedek]: 'ESKI' });
  hatali.readFileSync = () => {
    throw Object.assign(new Error('EBUSY: C:\\Users\\kisi'), { code: 'EBUSY' });
  };
  const gunluk = gunlukToplayici();
  assert.deepEqual(gocOncesiYedegiAl({ dosya, ham: { semaSurumu: GELECEK }, fs: hatali, gunluk }), { durum: 'zaten-var', yedek: yedekDosyaAdi(GELECEK) });
  assert.deepEqual(gunluk.satirlar, [], 'karşılaştırma yapılamadı: gürültü yok');
});

test('ek yedek kopyalama hatası açılışı durdurmaz: günlüğe yalnız hata kodu (yol ve ileti yok) yazılır, sonuç "zaten-var" kalır', () => {
  const klasor = path.join('K', 'Ev Paneli');
  const dosya = path.join(klasor, 'ayarlar.json');
  const yedek = path.join(klasor, yedekDosyaAdi(GELECEK));
  const fs0 = sahteFs({ [dosya]: 'YENI', [yedek]: 'ESKI' }, { kopyaHatasi: 'EPERM' });
  const gunluk = gunlukToplayici();
  assert.deepEqual(gocOncesiYedegiAl({ dosya, ham: { semaSurumu: GELECEK }, fs: fs0, gunluk }), { durum: 'zaten-var', yedek: yedekDosyaAdi(GELECEK) });
  assert.deepEqual(gunluk.satirlar, ['Daha yeni şemalı ayar dosyasının ek yedeği alınamadı (EPERM); açılış yine de sürüyor.']);
  assert.ok(!gunluk.satirlar[0].includes('TEST_ANAHTAR_000') && !gunluk.satirlar[0].includes('Ev Paneli'));
  // aynı milisaniyede çakışma (EEXIST): sessizce eski davranış
  const cakisan = sahteFs({ [dosya]: 'YENI', [yedek]: 'ESKI' }, { kopyaHatasi: 'EEXIST' });
  const g2 = gunlukToplayici();
  assert.equal(gocOncesiYedegiAl({ dosya, ham: { semaSurumu: GELECEK }, fs: cakisan, gunluk: g2 }).durum, 'zaten-var');
  assert.deepEqual(g2.satirlar, []);
});

test('zamanliYedekleriBud: hata fırlatmaz (klasör okunamıyor, silme reddediliyor); koruAdlar silinmez; yalnız kendi adlarına dokunur', () => {
  assert.deepEqual(zamanliYedekleriBud({ dizin: 'yok', surum: 6, fs: { readdirSync() { throw new Error('ENOENT'); } } }), []);
  const adlar = [1, 2, 3, 4].map((i) => yedekDosyaAdi(6, 1_700_000_000_000 + i));
  const dokunulmaz = ['ayarlar.json', 'ayarlar.v6-yedek.json', 'ayarlar.hatali-1700000000000.json', 'baska.json'];
  const silinenler = [];
  const sahte = { readdirSync: () => [...adlar, ...dokunulmaz], unlinkSync: (yol) => silinenler.push(path.basename(yol)) };
  assert.deepEqual(zamanliYedekleriBud({ dizin: 'd', surum: 6, fs: sahte, koru: 2 }).sort(), [adlar[0], adlar[1]].sort());
  assert.deepEqual(silinenler.sort(), [adlar[0], adlar[1]].sort(), 'başka dosyalara dokunulmadı');
  assert.deepEqual(zamanliYedekleriBud({ dizin: 'd', surum: 6, fs: sahte, koru: 2, koruAdlar: [adlar[0]] }), [adlar[1]], 'korunan ad silinmez');
  const reddeden = { readdirSync: () => adlar, unlinkSync() { throw Object.assign(new Error('x'), { code: 'EPERM' }); } };
  assert.deepEqual(zamanliYedekleriBud({ dizin: 'd', surum: 6, fs: reddeden, koru: 1 }), [], 'silinemeyen sayılmaz, hata yok');
});

test('yedek listesi: zaman damgalı göç yedekleri görünür (zaman adın içindeki damga) ve geri dönülebilir ad sayılır; bozuk desenler sayılmaz', () => {
  gecici((dizin) => {
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(6)), '{"semaSurumu":6}');
    fs.writeFileSync(path.join(dizin, yedekDosyaAdi(6, 1_760_000_000_123)), '{"semaSurumu":6}');
    fs.writeFileSync(path.join(dizin, 'ayarlar.bozuk-1760000000999.json'), '{}');
    fs.writeFileSync(path.join(dizin, 'ayarlar.v6-yedek-123.json'), '{}');
    fs.writeFileSync(path.join(dizin, 'ayarlar.v6-yedek-1760000000123.json.bak'), '{}');
    const liste = yedekleriListele({ dizin, fs });
    const damgali = liste.find((y) => y.ad === yedekDosyaAdi(6, 1_760_000_000_123));
    assert.deepEqual({ tur: damgali.tur, surum: damgali.surum, zaman: damgali.zaman, okunabilir: damgali.okunabilir }, { tur: 'goc', surum: 6, zaman: 1_760_000_000_123, okunabilir: true });
    assert.equal(liste.find((y) => y.ad === 'ayarlar.bozuk-1760000000999.json').zaman, 1_760_000_000_999, 'bozuk dosya kopyasının zamanı yine adından');
    assert.equal(liste.length, 3);
  });
  assert.equal(yedekAdiGecerliMi('ayarlar.v6-yedek-1760000000123.json'), true);
  for (const kotu of ['ayarlar.v6-yedek-123.json', 'ayarlar.v6-yedek-.json', 'ayarlar.v6-yedek-1760000000123x.json', '../ayarlar.v6-yedek-1760000000123.json']) {
    assert.equal(yedekAdiGecerliMi(kotu), false, kotu);
  }
});
