'use strict';

/**
 * Panel teması (src/lib/tema-renk.js, o-29): renk matematiği, hazır temalar, palet üretimi ve renderer'a yazım.
 * Hiçbir pencere açılmaz; sayfa tarafı sahte <html> öğesiyle sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/lib/tema-renk');

const METIN_CIFTLERI = [
  ['--metin', '--bg'], ['--metin', '--bg-ust'], ['--metin', '--karo'], ['--metin', '--karo-uzerinde'],
  ['--soluk', '--bg'], ['--soluk', '--bg-ust'], ['--soluk', '--karo'], ['--soluk', '--karo-uzerinde'],
  ['--soluk-eski', '--karo'], ['--soluk-eski', '--bg'], ['--soluk-secili', '--karo-uzerinde'],
  ['--acik', '--bg'], ['--acik', '--karo'], ['--acik', '--bg-ust'], ['--acik', '--karo-uzerinde'],
  ['--acik-eski', '--karo'], ['--acik-eski', '--bg'],
  ['--vurgu-metin', '--bg'], ['--vurgu-metin', '--karo'], ['--vurgu-metin', '--karo-uzerinde'],
  ['--yikici-metin', '--bg'], ['--yikici-metin', '--karo'], ['--yikici-metin', '--karo-uzerinde'],
  ['--rozet-metin', '--vurgu'], ['--rozet-metin', '--yikici'], ['--rozet-metin', '--hata'], ['--rozet-metin', '--yedek'], ['--rozet-metin', '--canli'],
];

function metinKontrastiniDenetle(palet, ad) {
  const d = palet.degiskenler;
  for (const [on, arka] of METIN_CIFTLERI) {
    const oran = T.kontrast(d[on], d[arka]);
    assert.ok(oran >= T.HEDEF_KONTRAST, `${ad}: ${on} / ${arka} = ${oran.toFixed(2)} (en az ${T.HEDEF_KONTRAST})`);
  }
}

// Tekrarlanabilir sahte rastgele sayı üreteci (mulberry32)
function rastgeleUret(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rastgeleRenk = (r) => `#${Math.floor(r() * 0x1000000).toString(16).padStart(6, '0')}`;

test('hexDuzelt: yalnız #rrggbb (küçük harfe çevrilir, kenar boşluğu atılır); başka her şey null', () => {
  assert.equal(T.hexDuzelt('#0F75E0'), '#0f75e0');
  assert.equal(T.hexDuzelt('  #abcdef '), '#abcdef');
  for (const kotu of ['#fff', 'abcdef', '#abcde', '#abcdefg', 'rgb(1,2,3)', 'red', '', null, undefined, 5, {}, '#abcdef;x', 'url(#abcdef)']) {
    assert.equal(T.hexDuzelt(kotu), null, String(kotu));
  }
});

test('parlaklik ve kontrast: bilinen WCAG değerleri', () => {
  assert.equal(T.parlaklik('#000000'), 0);
  assert.equal(T.parlaklik('#ffffff'), 1);
  assert.ok(Math.abs(T.kontrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(T.kontrast('#ffffff', '#000000') - 21) < 1e-9, 'sıra önemsiz');
  assert.ok(Math.abs(T.kontrast('#777777', '#777777') - 1) < 1e-9);
  assert.ok(Math.abs(T.kontrast('#767676', '#ffffff') - 4.54) < 0.01, 'bilinen AA sınır grisi');
});

test('karistir ve kontrastaUydur: uç noktalar; yeterli renk değişmez, yetersiz renk en az gerektiği kadar çekilir', () => {
  assert.equal(T.karistir('#000000', '#ffffff', 0), '#000000');
  assert.equal(T.karistir('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(T.karistir('#000000', '#ffffff', 0.5), '#808080');
  const zemin = ['#1b1f27'];
  assert.equal(T.kontrastaUydur('#f1f5f9', zemin, 4.5, 'acik'), '#f1f5f9', 'zaten yeterli');
  const uyan = T.kontrastaUydur('#2a2f3a', zemin, 4.5, 'acik');
  assert.ok(T.kontrast(uyan, zemin[0]) >= 4.5);
  assert.notEqual(uyan, '#2a2f3a');
  // hiçbir karışım yetmiyorsa uç renk
  assert.equal(T.kontrastaUydur('#777777', ['#777777'], 30, 'acik'), '#ffffff');
  assert.equal(T.kontrastaUydur('#777777', ['#777777'], 30, 'koyu'), '#000000');
});

test('parlakligiSinirla: aralık dışı renk en az gerektiği kadar çekilir, içindeki değişmez', () => {
  const koyu = T.parlakligiSinirla('#ffffff', 0, 0.035);
  assert.ok(T.parlaklik(koyu) <= 0.035 + 1e-9);
  const acik = T.parlakligiSinirla('#000000', 0.7, 1);
  assert.ok(T.parlaklik(acik) >= 0.7 - 1e-9);
  assert.equal(T.parlakligiSinirla('#1b1f27', 0, 0.035), '#1b1f27');
  assert.equal(T.parlakligiSinirla('#808080', 0, 1), '#808080');
});

test('hazır temalar: ad listesi sabit, varsayılan palet gerektirmez; her tema iki şemada geçerli renk taşır', () => {
  assert.deepEqual([...T.HAZIR_TEMA_ADLARI], ['varsayilan', 'okyanus', 'orman', 'gunbatimi', 'lavanta', 'grafit']);
  assert.equal(T.ozelPaletGerekli({ tema: 'varsayilan' }), false);
  assert.equal(T.ozelPaletGerekli({}), false);
  assert.equal(T.ozelPaletGerekli(), false);
  assert.equal(T.ozelPaletGerekli({ tema: 'okyanus' }), true);
  assert.equal(T.ozelPaletGerekli({ tema: 'yok-boyle-bir-tema' }), false, 'bilinmeyen tema palet gerektirmez');
  assert.equal(T.ozelPaletGerekli({ tema: '__proto__' }), false);
  assert.equal(T.ozelPaletGerekli({ tema: 'constructor' }), false);
  assert.equal(T.ozelPaletGerekli({ arkaPlan: '#112233' }), true);
  assert.equal(T.ozelPaletGerekli({ vurgu: '#112233' }), true);
  assert.equal(T.ozelPaletGerekli({ arkaPlan: 'kırmızı', vurgu: '#12' }), false);
  for (const ad of T.HAZIR_TEMA_ADLARI) {
    if (ad === 'varsayilan') continue;
    for (const sema of ['koyu', 'acik']) {
      const t = T.HAZIR_TEMALAR[ad][sema];
      assert.match(t.arkaPlan, /^#[0-9a-f]{6}$/, `${ad}/${sema} arkaPlan`);
      assert.match(t.vurgu, /^#[0-9a-f]{6}$/, `${ad}/${sema} vurgu`);
    }
  }
});

test('paletUret: her hazır tema iki şemada tüm metin çiftlerinde en az 4,5:1 sağlar', () => {
  for (const sema of ['koyu', 'acik']) {
    for (const tema of T.HAZIR_TEMA_ADLARI) {
      for (const saydam of [false, true]) {
        const palet = T.paletUret({ sema, tema, saydam });
        assert.equal(palet.sema, sema);
        if (!saydam) metinKontrastiniDenetle(palet, `${tema}/${sema}`);
      }
    }
  }
});

test('paletUret: uç ve rastgele arka plan / vurgu renkleriyle de metin kontrastı hiçbir zaman 4,5:1 altına düşmez', () => {
  const uclar = ['#000000', '#ffffff', '#808080', '#7f7f7f', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#2e2e2e', '#d0d0d0', '#5a5a5a', '#a0a0a0'];
  const r = rastgeleUret(20261016);
  const renkler = [...uclar];
  for (let i = 0; i < 400; i += 1) renkler.push(rastgeleRenk(r));
  for (const sema of ['koyu', 'acik']) {
    for (let i = 0; i < renkler.length; i += 1) {
      const arka = renkler[i];
      const vurgu = renkler[(i * 7 + 3) % renkler.length];
      const palet = T.paletUret({ sema, arkaPlan: arka, vurgu });
      metinKontrastiniDenetle(palet, `${sema} arka=${arka} vurgu=${vurgu}`);
    }
  }
});

test('paletUret: özel arka plan şemayı belirler (ayar tema seçimini aşar); tabanlar okunur uca çekilir', () => {
  const acik = T.paletUret({ sema: 'koyu', arkaPlan: '#ffffff' });
  assert.equal(acik.sema, 'acik', 'beyaz arka plan açık palet üretir');
  assert.ok(T.parlaklik(acik.degiskenler['--bg']) >= 0.7);
  const koyu = T.paletUret({ sema: 'acik', arkaPlan: '#000000' });
  assert.equal(koyu.sema, 'koyu');
  assert.ok(T.parlaklik(koyu.degiskenler['--bg']) <= 0.035 + 1e-9);
  // ölü bölge: orta gri koyu uca çekilir (okunur metin bırakmayan renk aynen kullanılmaz)
  const gri = T.paletUret({ sema: 'koyu', arkaPlan: '#808080' });
  assert.notEqual(gri.degiskenler['--bg'], '#808080');
  assert.equal(gri.arkaPlan, gri.degiskenler['--bg']);
});

test('paletUret: geçersiz girdiler varsayılan palete düşer; çıktı donmuş ve yalnız beyaz listeli değişkenleri taşır', () => {
  const p = T.paletUret({ sema: 'mor', tema: 'yok', arkaPlan: 'kırmızı', vurgu: 'javascript:1' });
  assert.equal(p.sema, 'koyu');
  assert.equal(p.arkaPlan, T.VARSAYILAN_TABAN.koyu);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.degiskenler));
  assert.deepEqual(Object.keys(p.degiskenler).sort(), [...T.DEGISKEN_ADLARI].sort());
  for (const [ad, deger] of Object.entries(p.degiskenler)) assert.ok(T.degiskenDegeriGecerli(deger), `${ad}: ${deger}`);
  assert.doesNotThrow(() => T.paletUret());
  assert.doesNotThrow(() => T.paletUret(null));
  assert.equal(T.paletUret({ tema: '__proto__' }).arkaPlan, T.VARSAYILAN_TABAN.koyu, 'prototip adı tema sayılmaz');
});

test('paletUret: saydam malzemede yüzeyler rgba(...), metin renkleri düz hex kalır', () => {
  const p = T.paletUret({ sema: 'koyu', tema: 'okyanus', saydam: true });
  for (const ad of ['--bg', '--bg-ust', '--karo', '--karo-uzerinde', '--kenar']) assert.match(p.degiskenler[ad], /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\)$/, ad);
  for (const ad of ['--metin', '--soluk', '--vurgu', '--rozet-metin']) assert.match(p.degiskenler[ad], /^#[0-9a-f]{6}$/, ad);
  const acik = T.paletUret({ sema: 'acik', saydam: true });
  assert.match(acik.degiskenler['--bg'], /^rgba\(/);
  // opak halinin aynı tabanından türer
  const opak = T.paletUret({ sema: 'koyu', tema: 'okyanus' });
  assert.equal(p.degiskenler['--metin'], opak.degiskenler['--metin']);
});

test('degiskenDegeriGecerli: yalnız #rrggbb ve rgba(r, g, b, a); CSS enjeksiyonu kabul edilmez', () => {
  for (const iyi of ['#112233', 'rgba(1, 2, 3, 0.5)', 'rgba(255, 255, 255, 0.14)', 'rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 0)']) assert.equal(T.degiskenDegeriGecerli(iyi), true, iyi);
  for (const kotu of ['red', 'url(x)', '#112233; background: red', 'rgba(1,2,3,0.5)', 'rgb(1, 2, 3)', 'var(--bg)', '#112', '', null, undefined, 7, {}, 'rgba(1, 2, 3, 0.5); x', 'expression(1)', 'rgba(1, 2, 3, 2)']) {
    assert.equal(T.degiskenDegeriGecerli(kotu), false, String(kotu));
  }
});

// ---- sayfa tarafı: gorunumUygula -------------------------------------------------------------------------------------------

function sahteKok() {
  const stil = new Map();
  const oz = new Map();
  return {
    style: {
      setProperty: (ad, deger) => stil.set(ad, deger),
      removeProperty: (ad) => stil.delete(ad),
    },
    setAttribute: (ad, deger) => oz.set(ad, String(deger)),
    removeAttribute: (ad) => oz.delete(ad),
    stil,
    oz,
  };
}

test('gorunumUygula: palet değişkenleri CSSOM ile, öznitelikler setAttribute ile yazılır; satır içi style özniteliği hiç yazılmaz', () => {
  const kok = sahteKok();
  const palet = T.paletUret({ sema: 'koyu', tema: 'orman' });
  const sonuc = T.gorunumUygula(kok, { sema: 'koyu', degiskenler: palet.degiskenler, karsitlik: true, animasyon: { gecis: true, hava: 'otomatik', mevsim: 'yok' } }, { hareketAzalt: false });
  assert.equal(kok.stil.size, T.DEGISKEN_ADLARI.length);
  assert.equal(kok.stil.get('--bg'), palet.degiskenler['--bg']);
  assert.equal(kok.oz.get('data-sema'), 'koyu');
  assert.equal(kok.oz.get('data-karsitlik'), '1');
  assert.equal(kok.oz.get('data-gecis'), '1');
  assert.equal(kok.oz.has('data-hareket'), false);
  assert.equal(kok.oz.has('style'), false, 'satır içi stil özniteliği yok');
  assert.deepEqual(sonuc, { hareketAzalt: false, gecis: true, animasyon: { gecis: true, hava: 'otomatik', mevsim: 'yok' } });
});

test('gorunumUygula: model yoksa önceki her şey temizlenir (varsayılan görünüme dönüş)', () => {
  const kok = sahteKok();
  T.gorunumUygula(kok, { sema: 'acik', degiskenler: T.paletUret({ sema: 'acik' }).degiskenler, karsitlik: true, hareketiAzalt: true, animasyon: { gecis: true, hava: 'yok', mevsim: 'yok' } });
  assert.ok(kok.stil.size > 0 && kok.oz.size > 0);
  for (const bos of [null, undefined, {}, 'x', 5]) {
    T.gorunumUygula(kok, { sema: 'acik', degiskenler: T.paletUret({ sema: 'acik' }).degiskenler, karsitlik: true });
    const s = T.gorunumUygula(kok, bos);
    assert.equal(kok.stil.size, 0, String(bos));
    assert.equal(kok.oz.size, 0, String(bos));
    assert.deepEqual(s, { hareketAzalt: false, gecis: false, animasyon: null });
  }
});

test('gorunumUygula: hareket azaltma (ayar ya da sistem) geçişleri ve animasyonu kapatır, data-hareket yazar', () => {
  const animasyon = { gecis: true, hava: 'yagmur', mevsim: 'kis' };
  for (const [model, sistem] of [[{ hareketiAzalt: true, animasyon }, { hareketAzalt: false }], [{ animasyon }, { hareketAzalt: true }], [{ hareketiAzalt: true, animasyon }, { hareketAzalt: true }]]) {
    const kok = sahteKok();
    const s = T.gorunumUygula(kok, model, sistem);
    assert.equal(s.hareketAzalt, true);
    assert.equal(s.gecis, false);
    assert.equal(s.animasyon, null, 'azaltılmışsa efekt seçimi için animasyon verilmez');
    assert.equal(kok.oz.get('data-hareket'), 'azalt');
    assert.equal(kok.oz.has('data-gecis'), false);
  }
});

test('gorunumUygula: beyaz liste dışı değişken adı ve geçersiz değer yazılmaz', () => {
  const kok = sahteKok();
  T.gorunumUygula(kok, {
    degiskenler: { '--bg': '#112233', '--metin': 'url(http://x)', '--kotu': '#ffffff', 'background': '#000000', '--vurgu': 'red; x', '--kenar': 'rgba(1, 2, 3, 0.2)' },
    sema: 'koyu',
  });
  assert.deepEqual([...kok.stil.keys()].sort(), ['--bg', '--kenar']);
  assert.equal(kok.oz.get('data-sema'), 'koyu');
  // hiç değişken yazılamadıysa data-sema da yazılmaz
  const bos = sahteKok();
  T.gorunumUygula(bos, { degiskenler: { '--bg': 'red' }, sema: 'koyu' });
  assert.equal(bos.oz.has('data-sema'), false);
  // bilinmeyen sema değeri yazılmaz
  const kotuSema = sahteKok();
  T.gorunumUygula(kotuSema, { degiskenler: { '--bg': '#112233' }, sema: '"><script>' });
  assert.equal(kotuSema.oz.has('data-sema'), false);
});

test('gorunumUygula: kök öğe eksik ya da yarım olsa da fırlatmaz', () => {
  assert.doesNotThrow(() => T.gorunumUygula(null, { karsitlik: true }));
  assert.doesNotThrow(() => T.gorunumUygula({}, { degiskenler: { '--bg': '#112233' } }));
});
