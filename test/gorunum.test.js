'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/lib/gorunum');
const { TEMA_DEGERLERI, VARSAYILAN_TEMA, temaDuzelt, temaKaynagi, vurguRengiDuzelt } = G;
const { kontrast } = require('../src/lib/tema-renk');

test('temaKaynagi: koyu -> dark (zorla), açık -> light (zorla), sistem -> system; geçersiz değer varsayılan koyuya döner', () => {
  assert.deepEqual(TEMA_DEGERLERI, ['koyu', 'sistem', 'acik']);
  assert.equal(VARSAYILAN_TEMA, 'koyu');
  assert.equal(temaKaynagi('koyu'), 'dark');
  assert.equal(temaKaynagi('sistem'), 'system');
  assert.equal(temaKaynagi('acik'), 'light');
  for (const kotu of ['light', 'dark', 'Koyu', 'ACIK', 'açık', '', null, undefined, 3]) assert.equal(temaKaynagi(kotu), 'dark', String(kotu));
});

test('temaDuzelt: geçerli korunur, geçersiz varsayılana (ya da verilen varsayılana) döner', () => {
  assert.equal(temaDuzelt('sistem'), 'sistem');
  assert.equal(temaDuzelt('acik'), 'acik');
  assert.equal(temaDuzelt('x'), 'koyu');
  assert.equal(temaDuzelt('x', 'sistem'), 'sistem');
  assert.equal(temaDuzelt('x', 'acik'), 'acik');
  assert.equal(temaDuzelt('x', 'bozuk'), 'koyu');
});

test('vurguRengiDuzelt: yalnız #rrggbb (küçük harfe çevrilir); boş = sistem rengi; başka her şey geçersiz (null)', () => {
  assert.equal(vurguRengiDuzelt('#0f75e0'), '#0f75e0');
  assert.equal(vurguRengiDuzelt('#0F75E0'), '#0f75e0');
  assert.equal(vurguRengiDuzelt('  #ABCDEF  '), '#abcdef');
  assert.equal(vurguRengiDuzelt(''), '');
  assert.equal(vurguRengiDuzelt('   '), '');
  for (const kotu of ['#fff', '0f75e0', '#0f75e', '#0f75e00', '#gggggg', 'red', 'rgb(1,2,3)', '#0f75e0; x', 'javascript:1', null, undefined, 5, true, {}, []]) {
    assert.equal(vurguRengiDuzelt(kotu), null, String(kotu));
  }
});

// ---- o-25: metin boyutu ------------------------------------------------------------------------------------------------------

test('metin ölçeği: yalnız 100/115/130/150; sayı ya da sayı metni; geçersiz varsayılana döner; oran pencere yakınlaştırma adımlarıyla aynı', () => {
  assert.deepEqual([...G.METIN_OLCEKLERI], [100, 115, 130, 150]);
  assert.equal(G.VARSAYILAN_METIN_OLCEGI, 100);
  for (const n of G.METIN_OLCEKLERI) {
    assert.equal(G.metinOlcegiDuzelt(n), n);
    assert.equal(G.metinOlcegiDuzelt(String(n)), n);
  }
  for (const kotu of [99, 101, 125, 200, 0, -100, NaN, Infinity, '', ' ', 'yüz', null, undefined, {}, [], true, '1e2x']) {
    assert.equal(G.metinOlcegiDuzelt(kotu), 100, String(kotu));
  }
  assert.equal(G.metinOlcegiDuzelt('x', 130), 130, 'verilen varsayılan');
  assert.equal(G.metinOlcegiDuzelt('x', 77), 100, 'geçersiz varsayılan yerine 100');
  const { YAKINLASTIRMA_ADIMLARI } = require('../src/lib/pencere-yerlesim');
  for (const n of G.METIN_OLCEKLERI) {
    assert.equal(G.metinOlcegiOrani(n), n / 100);
    assert.ok(YAKINLASTIRMA_ADIMLARI.includes(G.metinOlcegiOrani(n)), `${n}: oran pencere yakınlaştırma adımı`);
  }
  assert.equal(G.metinOlcegiOrani('bozuk'), 1);
});

// ---- o-29: tema ------------------------------------------------------------------------------------------------------------

test('etkinSema: koyu/açık ayarı kesin; sistem Windows temasına bakar (bilinmiyorsa koyu)', () => {
  assert.equal(G.etkinSema('koyu', false), 'koyu');
  assert.equal(G.etkinSema('acik', true), 'acik');
  assert.equal(G.etkinSema('sistem', true), 'koyu');
  assert.equal(G.etkinSema('sistem', false), 'acik');
  assert.equal(G.etkinSema('sistem'), 'koyu');
  assert.equal(G.etkinSema('bozuk', false), 'koyu', 'geçersiz ayar koyu');
  assert.equal(G.etkinSema(undefined), 'koyu');
});

test('sistemKoyuMu: Electron nativeTheme.shouldUseDarkColors; okunamazsa koyu (eski davranış)', () => {
  assert.equal(G.sistemKoyuMu({ shouldUseDarkColors: false }), false);
  assert.equal(G.sistemKoyuMu({ shouldUseDarkColors: true }), true);
  assert.equal(G.sistemKoyuMu({}), true);
  assert.equal(G.sistemKoyuMu(null), true);
  assert.equal(G.sistemKoyuMu(undefined), true);
});

test('ozelPalet: her şey varsayılansa null; yüksek karşıtlıkta özel renkler yok sayılır; aksi halde palet', () => {
  assert.equal(G.ozelPalet({}), null);
  assert.equal(G.ozelPalet(null), null);
  assert.equal(G.ozelPalet({ panelTemasi: 'varsayilan', panelVurguRengi: '', panelArkaPlani: '' }), null);
  assert.equal(G.ozelPalet({ panelTemasi: 'okyanus', yuksekKarsitlik: true }), null);
  const p = G.ozelPalet({ panelTemasi: 'okyanus', temaZorla: 'koyu' });
  assert.equal(p.sema, 'koyu');
  assert.equal(p.arkaPlan, '#0e1c2b');
  const acik = G.ozelPalet({ panelTemasi: 'okyanus', temaZorla: 'acik' });
  assert.equal(acik.sema, 'acik');
  const sistemAcik = G.ozelPalet({ panelTemasi: 'okyanus', temaZorla: 'sistem' }, { sistemKoyu: false });
  assert.equal(sistemAcik.sema, 'acik');
  const ozel = G.ozelPalet({ panelVurguRengi: '#ff0066', temaZorla: 'koyu' });
  assert.ok(kontrast(ozel.degiskenler['--metin'], ozel.degiskenler['--bg']) >= 4.5);
  assert.match(G.ozelPalet({ panelTemasi: 'okyanus' }, { saydam: true }).degiskenler['--bg'], /^rgba\(/);
  assert.match(G.ozelPalet({ panelTemasi: 'okyanus' }, { saydam: false }).degiskenler['--bg'], /^#/);
});

test('gorunumModeli: varsayılan ayarlarda null (yüke hiçbir şey eklenmez); eksik ya da bozuk ayarda da null', () => {
  assert.equal(G.gorunumModeli({}), null);
  assert.equal(G.gorunumModeli(null), null);
  assert.equal(G.gorunumModeli(undefined), null);
  assert.equal(
    G.gorunumModeli({ metinOlcegi: 100, yuksekKarsitlik: false, panelTemasi: 'varsayilan', panelVurguRengi: '', panelArkaPlani: '', animasyonlar: false, animasyonGecisleri: true, havaEfekti: 'otomatik', mevsimEfekti: 'yok', hareketiAzalt: false, temaZorla: 'koyu' }),
    null,
  );
  assert.equal(G.gorunumModeli({ animasyonGecisleri: true, havaEfekti: 'yagmur', mevsimEfekti: 'kis' }), null, 'animasyonlar kapalıyken efekt ayarları etkisizdir');
});

test('gorunumModeli: palet, karşıtlık, hareket ve animasyon alanları; yüksek karşıtlıkta özel palet ve süs efekti yok', () => {
  const palet = G.gorunumModeli({ panelTemasi: 'lavanta', temaZorla: 'koyu' }, { malzeme: 'yok', sistemKoyu: true });
  assert.equal(palet.sema, 'koyu');
  assert.equal(Object.keys(palet.degiskenler).length, 21);
  assert.equal(palet.karsitlik, undefined);
  assert.equal(palet.animasyon, undefined);

  const saydam = G.gorunumModeli({ panelTemasi: 'lavanta' }, { malzeme: 'acrylic' });
  assert.match(saydam.degiskenler['--bg'], /^rgba\(/, 'malzeme açıkken yüzeyler yarı saydam');
  assert.match(G.gorunumModeli({ panelTemasi: 'lavanta' }, { malzeme: 'mica' }).degiskenler['--karo'], /^rgba\(/);
  assert.match(G.gorunumModeli({ panelTemasi: 'lavanta' }, { malzeme: 'yok' }).degiskenler['--karo'], /^#/);

  const karsit = G.gorunumModeli({ yuksekKarsitlik: true, panelTemasi: 'orman', panelVurguRengi: '#ff0000', animasyonlar: true, animasyonGecisleri: true, havaEfekti: 'yagmur', mevsimEfekti: 'kis' });
  assert.equal(karsit.karsitlik, true);
  assert.equal(karsit.degiskenler, undefined, 'özel renkler yok sayılır');
  assert.equal(karsit.sema, undefined);
  assert.deepEqual(karsit.animasyon, { gecis: true, hava: 'yok', mevsim: 'yok' }, 'yüksek karşıtlıkta efekt çizilmez, yalnız geçişler');

  const anim = G.gorunumModeli({ animasyonlar: true, animasyonGecisleri: false, havaEfekti: 'kar', mevsimEfekti: 'yaz' });
  assert.deepEqual(anim, { animasyon: { gecis: false, hava: 'kar', mevsim: 'yaz' } });
  assert.deepEqual(G.gorunumModeli({ animasyonlar: true }), { animasyon: { gecis: true, hava: 'otomatik', mevsim: 'yok' } }, 'varsayılan alt seçenekler');
  assert.deepEqual(G.gorunumModeli({ animasyonlar: true, havaEfekti: 'kasirga', mevsimEfekti: '<x>' }).animasyon, { gecis: true, hava: 'otomatik', mevsim: 'yok' }, 'geçersiz değer varsayılana');
});

test('gorunumModeli: hareketi azalt açıkken animasyon alanı hiç yoktur; yalnız hareketiAzalt işareti gider', () => {
  const m = G.gorunumModeli({ animasyonlar: true, hareketiAzalt: true, havaEfekti: 'yagmur', mevsimEfekti: 'kis' });
  assert.deepEqual(m, { hareketiAzalt: true });
  assert.deepEqual(G.gorunumModeli({ hareketiAzalt: true }), { hareketiAzalt: true });
});

test('gorunumModeli: animasyonlar yalnız kesin true ile açılır (varsayılan KAPALI); bozuk değerler kapalıdır', () => {
  for (const bozuk of ['true', 1, 'evet', null, undefined, {}, []]) assert.equal(G.gorunumModeli({ animasyonlar: bozuk }), null, String(bozuk));
  for (const bozuk of ['true', 1, 'evet', null, {}]) assert.equal(G.gorunumModeli({ yuksekKarsitlik: bozuk }), null, String(bozuk));
});

test('gorunumModeli: çıktı yapılandırılmış klonlanabilir düz veridir (IPC) ve ayarlardaki nesneyle paylaşılmaz', () => {
  const ayarlar = { panelTemasi: 'orman', animasyonlar: true };
  const m = G.gorunumModeli(ayarlar);
  assert.doesNotThrow(() => structuredClone(m));
  m.degiskenler['--bg'] = '#000000';
  assert.notEqual(G.gorunumModeli(ayarlar).degiskenler['--bg'], '#000000', 'her çağrı yeni nesne');
  assert.deepEqual(ayarlar, { panelTemasi: 'orman', animasyonlar: true }, 'girdi değişmez');
});
