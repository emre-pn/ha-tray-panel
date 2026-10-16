'use strict';

/**
 * Düzen geçmişi (src/lib/duzen-gecmisi.js; o-30): favori + sayfa düzeninin son 20 anlık görüntüsü. Ayar yedeklerinden ayrıdır;
 * dosyadan okunan her nokta şemadan yeniden geçer (elle bozulmuş dosya kapı / kilit favorisi sokamaz) ve içinde sır yoktur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { duzenGecmisiOlustur, anlikDuzelt, EN_COK_NOKTA, NEDENLER } = require('../src/lib/duzen-gecmisi');

const YOL = 'C:\\veri\\duzen-gecmisi.json';

function sahteFs(baslangic = {}, { yazmaHatasi = false } = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  const yazimlar = [];
  return {
    dosyalar,
    yazimlar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => {
      if (!dosyalar.has(y)) throw new Error('yok');
      return dosyalar.get(y);
    },
    statSync: (y) => ({ size: Buffer.byteLength(String(dosyalar.get(y) ?? '')) }),
    mkdirSync: () => {},
    writeFileSync: (y, v) => {
      if (yazmaHatasi) throw new Error('disk dolu');
      yazimlar.push(y);
      dosyalar.set(y, v);
    },
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
  };
}

const f = (kimlik, ad = kimlik) => ({ entity_id: kimlik, ad });
const duzen = (...kimlikler) => ({ favoriler: kimlikler.map((k) => f(k)), sayfalar: [] });
let saat = 1_000;
const simdi = () => saat;

function kur(fs = sahteFs(), ek = {}) {
  saat = 1_000;
  const gunluk = [];
  const g = duzenGecmisiOlustur({ dosyaYolu: YOL, fs, simdi, gunluk: (m) => gunluk.push(m), ...ek });
  return { g, fs, gunluk };
}

test('kaydet: noktalar en yeniden eskiye; liste yalnız özet (kimlik ve ad yok); al derin kopya döner', () => {
  const { g } = kur();
  assert.equal(g.kaydet(duzen('light.a'), 'kaydet'), true);
  saat += 10;
  assert.equal(g.kaydet({ favoriler: [f('light.a'), f('light.b')], sayfalar: [{ id: 'abc', ad: 'S', varliklar: ['light.a'] }] }, 'sayfalar'), true);
  const liste = g.liste();
  assert.deepEqual(liste.map((n) => [n.id, n.neden, n.favoriSayisi, n.sayfaSayisi]), [[2, 'sayfalar', 2, 1], [1, 'kaydet', 1, 0]]);
  assert.ok(!JSON.stringify(liste).includes('light.'), 'listede kimlik yok');
  const nokta = g.al(1);
  nokta.favoriler.push(f('light.zzz'));
  assert.equal(g.al(1).favoriler.length, 1, 'dışarıdaki değişiklik geçmişi bozmaz');
  assert.equal(g.al(99), null);
  assert.equal(g.sayi(), 2);
});

test('kaydet: önceki noktayla aynı düzen eklenmez', () => {
  const { g } = kur();
  assert.equal(g.kaydet(duzen('light.a')), true);
  assert.equal(g.kaydet(duzen('light.a')), false);
  assert.equal(g.kaydet(duzen('light.a', 'light.b')), true);
  assert.equal(g.sayi(), 2);
});

test('kaydet: birlestirMs içinde gelen ardışık değişiklik tek nokta olur (en eski hâl kalır)', () => {
  const { g } = kur();
  g.kaydet(duzen('light.a'), 'kaydet', { birlestirMs: 2500 });
  saat += 1000;
  assert.equal(g.kaydet(duzen('light.a', 'light.b'), 'sayfalar', { birlestirMs: 2500 }), false, '1 sn sonra: birleşir');
  assert.deepEqual(g.al(1).favoriler.map((x) => x.entity_id), ['light.a']);
  saat += 5000;
  assert.equal(g.kaydet(duzen('light.a', 'light.b'), 'sayfalar', { birlestirMs: 2500 }), true, '6 sn sonra: yeni nokta');
  assert.equal(g.sayi(), 2);
});

test('en çok 20 nokta: en eskiler düşer; kimlikler tekrar kullanılmaz', () => {
  const { g } = kur();
  for (let n = 0; n < 25; n += 1) {
    saat += 10;
    g.kaydet(duzen(`light.l${n}`));
  }
  assert.equal(EN_COK_NOKTA, 20);
  assert.equal(g.sayi(), 20);
  const liste = g.liste();
  assert.equal(liste[0].id, 25);
  assert.equal(liste.at(-1).id, 6);
  assert.equal(g.al(1), null, 'düşen nokta artık yok');
});

test('kalıcılık: dosyaya atomik (geçici dosya + yeniden adlandırma) yazılır, yeni örnek aynı geçmişi yükler ve kimlik sayacı sürer', () => {
  const { g, fs } = kur();
  g.kaydet(duzen('light.a'));
  saat += 10;
  g.kaydet(duzen('light.a', 'light.b'));
  assert.deepEqual(fs.yazimlar, [`${YOL}.tmp`, `${YOL}.tmp`]);
  assert.ok(fs.dosyalar.has(YOL));
  assert.ok(!fs.dosyalar.has(`${YOL}.tmp`));
  const yeni = duzenGecmisiOlustur({ dosyaYolu: YOL, fs, simdi });
  assert.equal(yeni.yukle(), 2);
  assert.equal(yeni.liste().length, 2);
  saat += 10;
  yeni.kaydet(duzen('light.c'));
  assert.equal(yeni.liste()[0].id, 3, 'kimlik sayacı kalınan yerden sürer');
});

test('dosya içinde sır yok: yalnız kimlik, ad, kısayol ve görünüm alanları', () => {
  const { g, fs } = kur();
  g.kaydet({ favoriler: [{ ...f('light.a'), kisayol: 'Control+Alt+1', simge: '💡', renk: 'mavi', boyut: 'genis', tepsi: true, token: 'eyJhbGciOi.gizli.deger', anahtar: 'gizli' }], sayfalar: [] });
  const metin = fs.dosyalar.get(YOL);
  assert.doesNotMatch(metin, /eyJ|gizli|token|anahtar|http/i);
  assert.match(metin, /light\.a/);
  assert.match(metin, /💡/);
});

test('yukle: bozuk ya da çok büyük dosya boş geçmişle başlar ve günlüğe sabit metin yazar', () => {
  for (const icerik of ['{bozuk json', 'null', '[]', '{"noktalar": 5}']) {
    const { g, gunluk } = kur(sahteFs({ [YOL]: icerik }));
    assert.equal(g.yukle(), 0, icerik);
    assert.equal(g.sayi(), 0);
    if (icerik.startsWith('{bozuk')) assert.equal(gunluk.length, 1);
  }
  const buyuk = kur(sahteFs({ [YOL]: ' '.repeat(5 * 1024 * 1024) }));
  assert.equal(buyuk.g.yukle(), 0);
  assert.equal(buyuk.gunluk.length, 1);
  assert.equal(kur().g.yukle(), 0, 'dosya yok');
});

test('yukle: dosyadaki noktalar şemadan yeniden geçer — kapı/kilit favorisi, geçersiz kimlik, yinelenen nokta atılır', () => {
  const icerik = JSON.stringify({
    surum: 1,
    noktalar: [
      { id: 3, zaman: 30, neden: 'kaydet', favoriler: [f('light.a'), f('lock.on_kapi'), f('light.kapi_isigi'), f('cover.perde')], sayfalar: [{ id: 'abc', ad: 'Alarm', varliklar: ['lock.on_kapi', 'light.a'] }] },
      { id: 3, zaman: 31, neden: 'kaydet', favoriler: [f('light.b')], sayfalar: [] },
      { id: 0, zaman: 1, favoriler: [], sayfalar: [] },
      { id: 'x', zaman: 1, favoriler: [], sayfalar: [] },
      { id: 2, zaman: 20, neden: 'saçma', favoriler: [f('light.c')] },
      null,
      5,
    ],
  });
  const { g } = kur(sahteFs({ [YOL]: icerik }));
  assert.equal(g.yukle(), 2);
  const nokta = g.al(3);
  assert.deepEqual(nokta.favoriler.map((x) => x.entity_id), ['light.a']);
  assert.deepEqual(nokta.sayfalar, [{ id: 'abc', ad: '', varliklar: ['light.a'] }].map((s) => ({ ...s, varliklar: s.varliklar.filter((k) => k === 'light.a') })));
  assert.equal(g.liste().find((n) => n.id === 2).neden, 'kaydet', 'bilinmeyen neden kaydet olur');
  assert.deepEqual(g.liste().map((n) => n.id), [3, 2], 'yeniden eskiye');
});

test('yazma hatası geçmişi bozmaz: bellekte kalır, günlüğe sabit metin yazılır', () => {
  const { g, gunluk } = kur(sahteFs({}, { yazmaHatasi: true }));
  assert.equal(g.kaydet(duzen('light.a')), true);
  assert.equal(g.sayi(), 1);
  assert.equal(gunluk.length, 1);
  assert.ok(!gunluk[0].includes('disk dolu'), 'günlük ham hata metnini taşımaz');
});

test('geçersiz anlık görüntü kaydedilmez; temizle geçmişi siler', () => {
  const { g } = kur();
  for (const kotu of [null, undefined, 5, 'x']) assert.equal(g.kaydet(kotu), false);
  g.kaydet(duzen('light.a'));
  assert.equal(g.temizle(), true);
  assert.equal(g.sayi(), 0);
  assert.ok(NEDENLER.includes('don') && NEDENLER.includes('onar') && NEDENLER.includes('aktar'));
});

test('anlikDuzelt: girdiyi değiştirmez; favoriler ve sayfalar şemadan geçer', () => {
  const girdi = { favoriler: [f('light.a'), f('lock.x')], sayfalar: [{ id: 'abc', ad: 'A', varliklar: ['light.a'] }] };
  const once = JSON.stringify(girdi);
  const temiz = anlikDuzelt(girdi);
  assert.equal(JSON.stringify(girdi), once);
  assert.deepEqual(temiz.favoriler.map((x) => x.entity_id), ['light.a']);
  assert.equal(anlikDuzelt(null), null);
  assert.deepEqual(anlikDuzelt({}), { favoriler: [], sayfalar: [] });
});
