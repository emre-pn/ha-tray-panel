'use strict';

/**
 * Arayüz dili (src/lib/dil.js + src/lib/ceviri/*.js): dil çözümü, çevirmen, sayfa çevirisi, sözlük bütünlüğü (tr/en/de/fr/es anahtar ve
 * yer tutucu eşliği), kullanılan her anahtarın sözlükte bulunması, ayar normalleştirme; İngilizce metinlerde Türkçe harf, Almanca /
 * Fransızca / İspanyolca metinlerde Türkçeye özgü harf (ğ ı ş) kalmaması ve Türkçe metnin çevrilmeden kopyalanmaması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EvDil = require('../src/lib/dil');
const ANA = require('../src/lib/ceviri/ana');
const AYARLAR = require('../src/lib/ceviri/ayarlar');
const YUZEY = require('../src/lib/ceviri/yuzey');
const { anaCevirmen, TR } = require('../src/lib/ceviri-varsayilan');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { ayarGirdisiniDogrula } = require('../src/lib/ayar-kaydet');
const { HAZIR_LISTE, hazirListeUygula } = require('../src/lib/favoriler');
const { adGuvenliMi } = require('../src/lib/suzgec');
const { kisayolDogrula, kisayolUyarilari } = require('../src/lib/kisayol');

const KOK = path.join(__dirname, '..');
const oku = (goreli) => fs.readFileSync(path.join(KOK, goreli), 'utf8');
const VARSAYILAN = JSON.parse(oku('varsayilan-ayarlar.json'));
const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
/** Almanca (ö ü), Fransızca (ç) ve İspanyolcada geçerli olan ç ö ü hariç, yalnız Türkçede bulunan harfler. */
const TURKCE_OZEL_HARF = /[ğĞıİşŞ]/;
const DILLER = ['tr', 'en', 'de', 'fr', 'es'];
const YENI_DILLER = ['de', 'fr', 'es'];
const SOZLUKLER = { ana: ANA, ayarlar: AYARLAR, yuzey: YUZEY };
/** Türkçe ile aynı yazılması doğal olan metinler (özel ad, ortak sözcük); başka her metin çevrilmiş olmalıdır. */
const TURKCE_ILE_AYNI_OLABILIR_ANAHTAR = new Set(['hazir.scene.film', 'ayar.aktar.favoriSayisi.bir']);
const TURKCE_ILE_AYNI_OLABILIR_METIN = new Set(['normal', 'Fan', 'Film', 'Home Assistant', 'PC', 'Telefon', 'Tema']);
const yerTutucular = (metin) => [...String(metin).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

// --- dil çözümü -----------------------------------------------------------------------------------------

test('dilCoz: beş dil olduğu gibi; sistem Windows diline göre (tr/en/de/fr/es ile başlıyorsa o dil, aksi en); eksik ya da geçersiz her şey tr', () => {
  for (const dil of DILLER) assert.equal(EvDil.dilCoz(dil, 'ja-JP'), dil, `açık seçim sistem dilini ezer: ${dil}`);
  assert.equal(EvDil.dilCoz('tr', 'en-US'), 'tr');
  assert.equal(EvDil.dilCoz('en', 'tr-TR'), 'en');
  assert.equal(EvDil.dilCoz('de', 'tr-TR'), 'de');
  assert.equal(EvDil.dilCoz('fr', 'en-US'), 'fr');
  assert.equal(EvDil.dilCoz('es', 'de-DE'), 'es');
  assert.equal(EvDil.dilCoz('sistem', 'tr-TR'), 'tr');
  assert.equal(EvDil.dilCoz('sistem', 'TR'), 'tr');
  assert.equal(EvDil.dilCoz('sistem', 'en-US'), 'en');
  assert.equal(EvDil.dilCoz('sistem', 'en'), 'en');
  assert.equal(EvDil.dilCoz('sistem', 'it-IT'), 'en', 'desteklenmeyen sistem dili İngilizceye düşer');
  assert.equal(EvDil.dilCoz('sistem', 'ja-JP'), 'en');
  assert.equal(EvDil.dilCoz('sistem', 'pt-BR'), 'en');
  // yeni diller: bölge, büyük/küçük harf, alt çizgi ve boşluk toleransı
  for (const [sistem, beklenen] of [
    ['de-DE', 'de'], ['de-AT', 'de'], ['de-CH', 'de'], ['de', 'de'], ['DE', 'de'], ['De-de', 'de'], ['de_DE', 'de'], ['  de-DE ', 'de'],
    ['fr-FR', 'fr'], ['fr-CA', 'fr'], ['fr-BE', 'fr'], ['fr', 'fr'], ['FR-fr', 'fr'], ['fr_CH', 'fr'],
    ['es-ES', 'es'], ['es-MX', 'es'], ['es-419', 'es'], ['es', 'es'], ['ES', 'es'], ['es_AR', 'es'],
  ]) assert.equal(EvDil.dilCoz('sistem', sistem), beklenen, sistem);
  // dil kodunun yalnızca önek olarak benzemesi yetmez
  for (const benzer of ['deu-DE', 'der', 'dev-IN', 'fra-FR', 'fro', 'esp', 'est-EE', 'fil-PH', 'enx', 'trk']) assert.equal(EvDil.dilCoz('sistem', benzer), 'en', benzer);
  for (const bos of [undefined, null, '', '  ', 42, {}]) assert.equal(EvDil.dilCoz('sistem', bos), 'tr', String(bos));
  for (const kotu of [undefined, null, '', 'it', 'EN', 'DE', 'Fr', 'es-ES', 'de-DE', 42, {}]) assert.equal(EvDil.dilCoz(kotu, 'en-US'), 'tr', String(kotu));
});

test('dilAyariDuzelt ve sabitler', () => {
  assert.deepEqual([...EvDil.DILLER], ['tr', 'en', 'de', 'fr', 'es']);
  assert.deepEqual([...EvDil.DIL_AYARLARI], ['sistem', 'tr', 'en', 'de', 'fr', 'es']);
  assert.equal(EvDil.VARSAYILAN_DIL, 'tr');
  assert.equal(EvDil.VARSAYILAN_DIL_AYARI, 'sistem');
  for (const iyi of ['sistem', 'tr', 'en', 'de', 'fr', 'es']) assert.equal(EvDil.dilAyariDuzelt(iyi), iyi);
  for (const kotu of [undefined, null, 'it', 'EN', 'DE', 'de-DE', 1, {}]) assert.equal(EvDil.dilAyariDuzelt(kotu), 'sistem');
  assert.equal(EvDil.dilAyariDuzelt('x', 'tr'), 'tr');
  assert.equal(EvDil.dilAyariDuzelt('fr', 'tr'), 'fr');
});

test('Intl yerel adları her dil için tanımlı; bilinmeyen dil Türkçe sayılır; sayı yazımı dile göre', () => {
  assert.deepEqual({ ...EvDil.YEREL_ADLARI },{ tr: 'tr-TR', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' });
  for (const dil of DILLER) assert.equal(EvDil.yerelAdi(dil), EvDil.YEREL_ADLARI[dil]);
  for (const kotu of [undefined, null, 'it', 'sistem', 'toString', '__proto__', 5]) assert.equal(EvDil.yerelAdi(kotu), 'tr-TR', String(kotu));
  // gerçek Intl bu yerel adlarla beklenen ondalık ayracını verir (sayı yazımı dile göre)
  assert.equal((1234.5).toLocaleString(EvDil.yerelAdi('en')), '1,234.5');
  assert.equal((1234.5).toLocaleString(EvDil.yerelAdi('de')), '1.234,5');
  assert.equal((0.5).toLocaleString(EvDil.yerelAdi('fr')), '0,5');
  assert.equal((0.5).toLocaleString(EvDil.yerelAdi('es')), '0,5');
});

test('bilgi-bicim.js yerel adları lib/dil.js ile aynı (iki dosya birbirine bağlı olmadan çalışır; eşlik burada denetlenir)', () => {
  const BilgiBicim = require('../src/lib/bilgi-bicim');
  assert.deepEqual({ ...BilgiBicim.YEREL_ADLARI }, { ...EvDil.YEREL_ADLARI });
  assert.deepEqual(Object.keys(BilgiBicim.YEREL_ADLARI), [...DILLER]);
});

// --- çevirmen -------------------------------------------------------------------------------------------

test('cevirmen: seçili dil, yer tutucular, Türkçeye ve anahtarın kendisine düşme; sözlük sırası; var() ve dil', () => {
  const s1 = { tr: { a: 'Merhaba {ad}', b: 'Yalnız Türkçe', c: '{n} öğe' }, en: { a: 'Hello {ad}', c: '{n} items', c_bir: 'x' } };
  const s2 = { tr: { a: 'ikinci', d: 'Dördüncü' }, en: { d: 'Fourth' } };
  const en = EvDil.cevirmen('en', s1, s2);
  assert.equal(en.dil, 'en');
  assert.equal(en('a', { ad: 'Emre' }), 'Hello Emre');
  assert.equal(en('a'), 'Hello {ad}', 'değişken verilmezse yer tutucu kalır');
  assert.equal(en('b'), 'Yalnız Türkçe', 'İngilizcesi yoksa Türkçe');
  assert.equal(en('d'), 'Fourth', 'sonraki sözlük');
  assert.equal(en('yok.anahtar'), 'yok.anahtar', 'hiçbirinde yoksa anahtarın kendisi');
  assert.equal(en.var('a'), true);
  assert.equal(en.var('b'), false, 'var(): seçili dilde karşılık var mı');
  const tr = EvDil.cevirmen('tr', s1, s2);
  assert.equal(tr.dil, 'tr');
  assert.equal(tr('a', { ad: 'Emre' }), 'Merhaba Emre', 'önce verilen sözlük');
  assert.equal(EvDil.cevirmen('it', s1).dil, 'tr', 'geçersiz dil tr olur');
  assert.equal(EvDil.cevirmen('DE', s1).dil, 'tr', 'büyük harfli dil kodu geçersiz');
  assert.equal(EvDil.cevirmen('en')('x'), 'x', 'sözlüksüz çalışır');
  assert.equal(en('a', { ad: '$&' }), 'Hello $&', 'özel değiştirme dizileri yorumlanmaz');
  assert.equal(en('a', { __proto__: { ad: 'kalitim' } }), 'Hello {ad}', 'miras alınan özellik kullanılmaz');
});

test('cevirmen: de/fr/es kendi sözlüğünden okur; karşılığı yoksa Türkçeye (İngilizceye değil), o da yoksa anahtarın kendisine düşer', () => {
  const s1 = {
    tr: { a: 'Merhaba {ad}', b: 'Yalnız Türkçe', c: 'Üç' },
    en: { a: 'Hello {ad}', b: 'English b' },
    de: { a: 'Hallo {ad}', c: 'Drei' },
    fr: { a: 'Bonjour {ad}' },
    es: { a: 'Hola {ad}' },
  };
  for (const [dil, selam] of [['de', 'Hallo Emre'], ['fr', 'Bonjour Emre'], ['es', 'Hola Emre']]) {
    const t = EvDil.cevirmen(dil, s1);
    assert.equal(t.dil, dil);
    assert.equal(t('a', { ad: 'Emre' }), selam);
    assert.equal(t.var('a'), true);
    assert.equal(t('b'), 'Yalnız Türkçe', `${dil}: karşılığı yoksa Türkçe (İngilizce değil)`);
    assert.equal(t.var('b'), false, `${dil}: var() yalnız kendi dilini sayar`);
    assert.equal(t('yok.anahtar'), 'yok.anahtar');
  }
  assert.equal(EvDil.cevirmen('de', s1)('c'), 'Drei');
  assert.equal(EvDil.cevirmen('fr', s1)('c'), 'Üç', 'fr karşılığı yok -> Türkçe');
  // sözlük sırası yeni dillerde de geçerli: önce verilen sözlük
  const ilk = { tr: { z: 'tr-ilk' }, de: { z: 'de-ilk' } };
  const ikinci = { tr: { z: 'tr-ikinci' }, de: { z: 'de-ikinci' } };
  assert.equal(EvDil.cevirmen('de', ilk, ikinci)('z'), 'de-ilk');
  assert.equal(EvDil.cevirmen('de', { de: {} }, ikinci)('z'), 'de-ikinci');
});

test('cogul: n === 1 ve .bir anahtarı varsa tekil; yoksa çoğul; {n} otomatik', () => {
  const t = EvDil.cevirmen('en', { tr: {}, en: { 'x': '{n} items', 'x.bir': '{n} item', y: '{n} rows' } });
  assert.equal(EvDil.cogul(t, 'x', 1), '1 item');
  assert.equal(EvDil.cogul(t, 'x', 2), '2 items');
  assert.equal(EvDil.cogul(t, 'x', 0), '0 items');
  assert.equal(EvDil.cogul(t, 'y', 1), '1 rows', '.bir yoksa aynı anahtar');
});

test('cogul: de/es yalnız 1 tekil; Fransızcada 0 da tekil ("0 favori"); .bir yoksa her sayıda aynı anahtar', () => {
  const sozluk = {
    tr: {},
    de: { 'x': '{n} Einträge', 'x.bir': '{n} Eintrag' },
    fr: { 'x': '{n} entrées', 'x.bir': '{n} entrée', 'y': '{n} lignes' },
    es: { 'x': '{n} entradas', 'x.bir': '{n} entrada' },
    en: { 'x': '{n} entries', 'x.bir': '{n} entry' },
  };
  const al = (dil) => EvDil.cevirmen(dil, sozluk);
  assert.equal(EvDil.cogul(al('de'), 'x', 1), '1 Eintrag');
  assert.equal(EvDil.cogul(al('de'), 'x', 0), '0 Einträge');
  assert.equal(EvDil.cogul(al('de'), 'x', 2), '2 Einträge');
  assert.equal(EvDil.cogul(al('es'), 'x', 1), '1 entrada');
  assert.equal(EvDil.cogul(al('es'), 'x', 0), '0 entradas');
  assert.equal(EvDil.cogul(al('es'), 'x', 5), '5 entradas');
  assert.equal(EvDil.cogul(al('fr'), 'x', 1), '1 entrée');
  assert.equal(EvDil.cogul(al('fr'), 'x', 0), '0 entrée', 'Fransızcada sıfır tekil');
  assert.equal(EvDil.cogul(al('fr'), 'x', 2), '2 entrées');
  assert.equal(EvDil.cogul(al('fr'), 'x', 0.5), '0.5 entrées', 'yalnız tam 0 tekil');
  assert.equal(EvDil.cogul(al('en'), 'x', 0), '0 entries', 'İngilizcede sıfır çoğul');
  assert.equal(EvDil.cogul(al('fr'), 'y', 0), '0 lignes', '.bir yoksa sıfırda da aynı anahtar');
  // Türkçede sıfır çoğul anahtarını kullanır (tr tekil/çoğul metni zaten aynı)
  assert.equal(EvDil.cogul(EvDil.cevirmen('tr', { tr: { 'x': '{n} öğe', 'x.bir': '{n} öğe' } }), 'x', 0), '0 öğe');
});

// --- sayfa çevirisi (küçük sahte DOM) --------------------------------------------------------------------

function sahteBelge(ogeler) {
  const oge = (nitelikler, metin = '') => {
    const o = { nitelikler: { ...nitelikler }, textContent: metin, getAttribute: (a) => (a in o.nitelikler ? o.nitelikler[a] : null), setAttribute: (a, d) => { o.nitelikler[a] = d; } };
    return o;
  };
  const liste = ogeler.map(([n, m]) => oge(n, m));
  const html = oge({ lang: 'tr' });
  const belge = {
    nodeType: 9,
    documentElement: html,
    querySelectorAll: (secici) => liste.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.nitelikler : 'data-i18n-attr' in o.nitelikler)),
  };
  return { belge, liste, html };
}

test('sayfayiCevir: data-i18n metni, data-i18n-attr öznitelikleri ve <html lang>; sözlükte olmayan anahtara dokunulmaz', () => {
  const { belge, liste, html } = sahteBelge([
    [{ 'data-i18n': 'a' }, 'Türkçe A'],
    [{ 'data-i18n': 'yok' }, 'Türkçe kalır'],
    [{ 'data-i18n-attr': 'placeholder:p; title:t;aria-label:yok;bozuk', placeholder: 'tr p', title: 'tr t', 'aria-label': 'tr a' }, ''],
    [{ 'data-i18n': 'a', 'data-i18n-attr': 'title:t' }, 'Türkçe A2'],
  ]);
  const t = EvDil.cevirmen('en', { tr: {}, en: { a: 'English A', p: 'English p', t: 'English t' } });
  EvDil.sayfayiCevir(belge, t);
  assert.equal(html.nitelikler.lang, 'en');
  assert.equal(liste[0].textContent, 'English A');
  assert.equal(liste[1].textContent, 'Türkçe kalır');
  assert.equal(liste[2].nitelikler.placeholder, 'English p');
  assert.equal(liste[2].nitelikler.title, 'English t');
  assert.equal(liste[2].nitelikler['aria-label'], 'tr a', 'sözlükte olmayan öznitelik anahtarı korunur');
  assert.equal(liste[3].textContent, 'English A');
  // yeniden Türkçeye döner
  EvDil.sayfayiCevir(belge, EvDil.cevirmen('tr', { tr: { a: 'Türkçe A', p: 'tr p', t: 'tr t' }, en: {} }));
  assert.equal(html.nitelikler.lang, 'tr');
  assert.equal(liste[0].textContent, 'Türkçe A');
  // güvenli: geçersiz argümanlar atmaz
  assert.doesNotThrow(() => EvDil.sayfayiCevir(null, t));
  assert.doesNotThrow(() => EvDil.sayfayiCevir(belge, null));
});

// --- sözlük bütünlüğü -----------------------------------------------------------------------------------

for (const [ad, sozluk] of Object.entries(SOZLUKLER)) {
  test(`sözlük ${ad}: beş dil (tr, en, de, fr, es) aynı anahtar kümesine ve aynı {yer tutuculara} sahip; değerler boş olmayan metin`, () => {
    assert.deepEqual(Object.keys(sozluk).sort(), [...DILLER].sort(), 'sözlük tam olarak bu beş dili verir');
    for (const dil of DILLER) assert.equal(typeof sozluk[dil], 'object', dil);
    const trAnahtarlar = Object.keys(sozluk.tr).sort();
    for (const dil of DILLER.filter((d) => d !== 'tr')) {
      const anahtarlar = Object.keys(sozluk[dil]).sort();
      assert.deepEqual(anahtarlar.filter((k) => !trAnahtarlar.includes(k)), [], `yalnız ${dil} içinde olan anahtarlar`);
      assert.deepEqual(trAnahtarlar.filter((k) => !anahtarlar.includes(k)), [], `yalnız tr içinde olan anahtarlar (${dil} çevrilmemiş)`);
    }
    for (const k of trAnahtarlar) {
      for (const dil of DILLER) {
        assert.equal(typeof sozluk[dil][k], 'string', `${k}: ${dil} metin olmalı`);
        assert.ok(sozluk[dil][k].trim() !== '', `${k}: ${dil} boş olmamalı`);
        assert.deepEqual(yerTutucular(sozluk[dil][k]), yerTutucular(sozluk.tr[k]), `${k}: yer tutucular ${dil} ile tr arasında aynı olmalı`);
      }
    }
  });

  test(`sözlük ${ad}: İngilizce metinlerde Türkçe harf yok (özel adlar ve Türkçe sözcük alıntıları hariç değil: hiç yok)`, () => {
    const kacak = Object.entries(sozluk.en).filter(([, m]) => TURKCE_HARF.test(m));
    assert.deepEqual(kacak, [], 'İngilizce sözlükte Türkçe harf içeren metinler');
  });

  test(`sözlük ${ad}: Almanca, Fransızca ve İspanyolca metinlerde Türkçeye özgü harf (ğ ı ş İ) yok`, () => {
    for (const dil of YENI_DILLER) {
      const kacak = Object.entries(sozluk[dil]).filter(([, m]) => TURKCE_OZEL_HARF.test(m));
      assert.deepEqual(kacak, [], `${dil} sözlüğünde Türkçe harf içeren metinler`);
    }
  });

  test(`sözlük ${ad}: Almanca, Fransızca ve İspanyolca metin Türkçe metnin çevrilmeden kopyası değil (ortak sözcük ve özel ad hariç)`, () => {
    for (const dil of YENI_DILLER) {
      const kopya = Object.entries(sozluk[dil]).filter(([k, m]) => m === sozluk.tr[k] && sozluk.tr[k] !== sozluk.en[k]
        && !TURKCE_ILE_AYNI_OLABILIR_ANAHTAR.has(k) && !TURKCE_ILE_AYNI_OLABILIR_METIN.has(m)).map(([k]) => k);
      assert.deepEqual(kopya, [], `${dil}: Türkçeden kopyalanmış görünen metinler`);
    }
  });

  test(`sözlük ${ad}: de/fr/es metinleri düzgün yazılmış (baş/son boşluk yalnız tr'deki gibi, çift boşluk, düz tırnak, bırakılmış işaret yok)`, () => {
    for (const dil of YENI_DILLER) {
      for (const [k, m] of Object.entries(sozluk[dil])) {
        assert.equal(/^\s/.test(m), /^\s/.test(sozluk.tr[k]), `${dil} ${k}: baştaki boşluk tr ile aynı olmalı`);
        assert.equal(/\s$/.test(m), /\s$/.test(sozluk.tr[k]), `${dil} ${k}: sondaki boşluk tr ile aynı olmalı`);
        // Türkçe metin bilerek iki boşluklu ("#0f75e0  (...)", "ara…  (Ctrl+F)") ya da çok satırlıysa çeviri de aynı yapıdadır
        assert.equal(/ {2,}/.test(m.trim()), / {2,}/.test(sozluk.tr[k].trim()), `${dil} ${k}: çift boşluk tr ile aynı yerde olmalı`);
        assert.equal((m.match(/\n/g) ?? []).length, (sozluk.tr[k].match(/\n/g) ?? []).length, `${dil} ${k}: satır sonu sayısı tr ile aynı olmalı`);
        assert.doesNotMatch(m, /["']/, `${dil} ${k}: düz tırnak ya da kesme işareti (tipografik kullanılmalı)`);
        assert.doesNotMatch(m, /\bTODO\b|XXX|\?\?\?/, `${dil} ${k}: yarım kalmış işaret`);
        assert.doesNotMatch(m, /[\r\t]/, `${dil} ${k}: denetim karakteri`);
      }
    }
  });

  test(`sözlük ${ad}: Fransızca noktalama kuralı: ; : ? ! öncesinde ve « » içinde bölünmeyen boşluk (U+00A0), sıradan boşluk değil`, () => {
    for (const [k, m] of Object.entries(sozluk.fr)) {
      assert.doesNotMatch(m, / [:;?!»]/, `fr ${k}: işaretten önce sıradan boşluk`);
      assert.doesNotMatch(m, /« /, `fr ${k}: açılış tırnağından sonra sıradan boşluk`);
      assert.doesNotMatch(m, /[:;?!][A-Za-zÀ-ÿ]/, `fr ${k}: işaretten sonra boşluksuz sözcük`);
    }
  });
}

test('ana sözlük: anahtarlar tekil (aynı anahtar iki kez tanımlanmaz) ve her .bir anahtarının çoğul karşılığı var', () => {
  const kaynak = oku('src/lib/ceviri/ana.js');
  const anahtarlar = [...kaynak.matchAll(/^\s*\['([^']+)',/gm)].map((m) => m[1]);
  const tekrar = anahtarlar.filter((k, i) => anahtarlar.indexOf(k) !== i);
  assert.deepEqual(tekrar, [], 'yinelenen anahtarlar');
  for (const k of Object.keys(ANA.tr).filter((x) => x.endsWith('.bir'))) assert.ok(Object.hasOwn(ANA.tr, k.slice(0, -4)), `${k}: çoğul karşılığı yok`);
});

// --- kullanılan her anahtar sözlükte var -----------------------------------------------------------------

/** Dosyadaki t('anahtar') ve ileti(t, 'anahtar', ...) kullanımlarının sabit anahtarları. */
function kullanilanAnahtarlar(kaynakHam) {
  const kaynak = kaynakHam.split('\n').filter((satir) => !/^\s*(\/\/|\*|\/\*)/.test(satir)).join('\n'); // açıklama satırlarındaki örnekler sayılmaz
  const sonuc = new Set();
  for (const m of kaynak.matchAll(/(?<![\w.$])(?:t|TR)\(\s*'([A-Za-z0-9_.]+)'/g)) sonuc.add(m[1]);
  for (const m of kaynak.matchAll(/ileti\(\s*t\s*,\s*'([A-Za-z0-9_.]+)'/g)) sonuc.add(m[1]);
  return sonuc;
}

test('ana süreç ve src/lib kaynaklarında kullanılan her sabit t("anahtar") ana sözlükte (beş dilin hepsinde) tanımlı', () => {
  const dosyalar = ['src/main.js', 'src/eylem.js', 'src/ha-istemcisi.js', 'src/yuzey-yoneticisi.js', 'src/kose-bildirim.js']
    .concat(fs.readdirSync(path.join(KOK, 'src/lib')).filter((d) => d.endsWith('.js') && d !== 'dil.js').map((d) => `src/lib/${d}`));
  let toplam = 0;
  for (const dosya of dosyalar) {
    for (const anahtar of kullanilanAnahtarlar(oku(dosya))) {
      toplam += 1;
      for (const dil of DILLER) assert.ok(Object.hasOwn(ANA[dil], anahtar), `${dosya}: "${anahtar}" ana sözlükte (${dil}) yok`);
    }
  }
  assert.ok(toplam > 100, `çok az anahtar bulundu (${toplam}): düzenli ifade bozulmuş olabilir`);
});

test('dinamik anahtar aileleri tamam: hazir.<kimlik> (her hazır karo), onay.<kimlik>, grup.<kod>, durum/alan adları, kisayol.ayrilmis.*', () => {
  for (const dil of DILLER) {
    for (const h of HAZIR_LISTE) assert.ok(Object.hasOwn(ANA[dil], `hazir.${h.kimlik}`), `${dil} hazir.${h.kimlik}`);
    const kisayolKaynagi = oku('src/lib/kisayol.js');
    for (const m of kisayolKaynagi.matchAll(/'((?:Control|Alt)\+[A-Za-z0-9]+)':\s*'/g)) assert.ok(Object.hasOwn(ANA[dil], `kisayol.ayrilmis.${m[1]}`), `${dil} kisayol.ayrilmis.${m[1]}`);
    const sinif = oku('src/lib/eylem-sinifi.js');
    const kimlikler = [...sinif.matchAll(/ACIKLAMALI_KIMLIKLER[^=]*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    for (const k of kimlikler) assert.ok(Object.hasOwn(ANA[dil], `onay.${k}`), `${dil} onay.${k}`);
    assert.ok(Object.hasOwn(ANA[dil], 'onay.genel'), `${dil} onay.genel`);
  }
});

// --- Türkçe varsayılanlar ile sözlük aynı ----------------------------------------------------------------

test("kisayol.js'teki satır içi Türkçe varsayılan iletiler sözlükteki tr metinlerle aynı (t verilse de verilmese de aynı sonuç)", () => {
  const girdiler = ['', 'xyz', 'F5', 'Shift+A', 'Control+C', 'Control+Alt+Delete', 'Alt+F4', 'Control+Space', 'Control+Alt+Q', 'Control+Alt+H', 'Control+Alt+7', 'Win+H', 'Control+H', 'Alt+K', 'Control+Z', 'Control+Y', 'Control+W', 'Control+F4', 'Alt+Space', 'Control+X', 'Control+A', 'Control+V'];
  for (const g of girdiler) {
    assert.deepEqual(kisayolDogrula(g, TR), kisayolDogrula(g), `dogrula ${g}`);
    assert.deepEqual(kisayolUyarilari(g, TR), kisayolUyarilari(g), `uyarilar ${g}`);
  }
  // ileti(t, anahtar, varsayilan) çağrılarındaki varsayılanlar da sözlükteki tr ile bire bir aynı
  const kaynak = oku('src/lib/kisayol.js');
  let sayi = 0;
  for (const m of kaynak.matchAll(/ileti\(\s*t\s*,\s*'([A-Za-z0-9_.]+)'\s*,\s*('(?:[^'\\]|\\.)*')/g)) {
    sayi += 1;
    assert.equal(ANA.tr[m[1]], new Function(`return ${m[2]}`)(), `${m[1]}: satır içi varsayılan ile sözlük tr farklı`);
  }
  assert.ok(sayi >= 8);
  const nedenler = kaynak.match(/NEDEN_MESAJLARI = \{([\s\S]*?)\n  \};/)[1];
  assert.equal(ANA.tr['kisayol.bos'], 'Kısayol boş.');
  assert.match(nedenler, /bos: 'Kısayol boş\.'/);
});

test('bildirim ve hata metinleri: tr çevirmeni ile üretilen metin eski sabit Türkçe metinle aynı', () => {
  const bildirim = require('../src/lib/bildirim-metni');
  assert.equal(bildirim.ANAHTAR_SILME_ONAY_METNI, ANA.tr['bildirim.anahtarSilmeOnay']);
  assert.equal(TR('uygulama.ad'), 'Ev Paneli');
  assert.equal(anaCevirmen('en')('uygulama.ad'), 'Home Panel');
});

// --- hazır liste İngilizce etiketleri ---------------------------------------------------------------------

for (const dil of ['en', ...YENI_DILLER]) {
  test(`${dil} hazır liste etiketleri güvenlik süzgecinden geçer (kapı/kilit sözcüğü yok) ve favori eklenirken o dilde yazılır`, () => {
    const t = anaCevirmen(dil);
    const harfDenetimi = dil === 'en' ? TURKCE_HARF : TURKCE_OZEL_HARF;
    for (const h of HAZIR_LISTE) {
      const etiket = t(`hazir.${h.kimlik}`);
      assert.notEqual(etiket, `hazir.${h.kimlik}`, `${h.kimlik}: ${dil} etiket var`);
      assert.equal(adGuvenliMi(h.kimlik, etiket), true, `${h.kimlik}: "${etiket}" süzgeçten geçmeli`);
      assert.doesNotMatch(etiket, harfDenetimi);
      assert.ok(etiket.length <= 40, `${h.kimlik}: kısa etiket ("${etiket}")`);
    }
    const varliklar = HAZIR_LISTE.map((h) => ({ entity_id: h.kimlik, state: 'off', attributes: { friendly_name: `${h.etiket} cihazı` } }));
    const etiketAl = (kimlik, varsayilan) => (t.var(`hazir.${kimlik}`) ? t(`hazir.${kimlik}`) : varsayilan);
    const sonuc = hazirListeUygula([], varliklar, { etiketAl });
    assert.ok(sonuc.eklenenler.length > 0);
    for (const f of sonuc.favoriler) assert.equal(f.etiket, t(`hazir.${f.entity_id}`));
    const turkce = hazirListeUygula([], varliklar);
    for (const f of turkce.favoriler) assert.equal(f.etiket, HAZIR_LISTE.find((h) => h.kimlik === f.entity_id).etiket, 'etiketAl yoksa Türkçe (eski davranış)');
  });
}

test('çevrilmiş alan, grup ve "adsız sayfa" etiketleri her dilde kapı/kilit süzgecinden geçer (güvenlik kuralı yeni dillerde de gevşemez)', () => {
  const etiketAnahtarlari = Object.keys(ANA.tr).filter((k) => /^(alan|grup)\./.test(k));
  assert.ok(etiketAnahtarlari.length >= 20, 'alan ve grup etiketleri bulundu');
  for (const dil of DILLER) {
    const t = anaCevirmen(dil);
    for (const k of etiketAnahtarlari) assert.equal(adGuvenliMi('light.deneme', t(k)), true, `${dil} ${k}: "${t(k)}"`);
    for (const n of [1, 2, 10]) assert.equal(adGuvenliMi('light.deneme', t('sayfa.adsiz', { n })), true, `${dil} sayfa.adsiz ${n}`);
  }
});

// --- ayar: normalleştirme ve kaydetme ---------------------------------------------------------------------

test("ayar şeması: 'dil' varsayılanı 'sistem'; geçerli değer korunur, bozuk/eksik değer varsayılana döner; şema sürümü değişmez", () => {
  assert.equal(VARSAYILAN.dil, 'sistem');
  const duzelt = (ham) => ayarlariDuzelt(ham, { varsayilan: VARSAYILAN }).ayarlar;
  assert.equal(duzelt({}).dil, 'sistem');
  for (const iyi of ['tr', 'en', 'de', 'fr', 'es', 'sistem']) assert.equal(duzelt({ dil: iyi }).dil, iyi);
  for (const kotu of ['it', 'EN', 'DE', 'de-DE', 7, null, {}, []]) assert.equal(duzelt({ dil: kotu }).dil, 'sistem', JSON.stringify(kotu));
  const eski = duzelt({ semaSurumu: 5, yerelAdres: 'http://192.168.1.10:8123' });
  assert.equal(eski.dil, 'sistem', 'dil alanı olmayan eski ayar dosyası göçte sistem dilini izler');
});

test("ayar kaydetme: girdideki 'dil' yalnız sistem/tr/en/de/fr/es ise kabul edilir; yoksa ya da geçersizse mevcut korunur", () => {
  const girdi = { yerelAdres: 'http://192.168.1.10:8123', disAdres: '', kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli' };
  const mevcut = { kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli', dil: 'tr' };
  for (const iyi of ['en', 'de', 'fr', 'es', 'sistem', 'tr']) assert.equal(ayarGirdisiniDogrula({ ...girdi, dil: iyi }, mevcut).yeni.dil, iyi, iyi);
  for (const kotu of ['it', 'DE', 'de-DE', 'Fr', '', 7, null]) assert.equal(ayarGirdisiniDogrula({ ...girdi, dil: kotu }, mevcut).yeni.dil, undefined, `geçersiz değer yeni ayara girmez (mevcut korunur): ${JSON.stringify(kotu)}`);
  assert.equal(ayarGirdisiniDogrula(girdi, mevcut).yeni.dil, undefined);
  // iletiler seçili dilde
  const en = anaCevirmen('en');
  const kotu = ayarGirdisiniDogrula({ ...girdi, yerelAdres: 'abc' }, mevcut, { t: en });
  assert.ok(kotu.hatalar.length > 0);
  assert.doesNotMatch(JSON.stringify(kotu.hatalar), TURKCE_HARF);
  for (const dil of YENI_DILLER) {
    const yeni = ayarGirdisiniDogrula({ ...girdi, yerelAdres: 'abc' }, mevcut, { t: anaCevirmen(dil) });
    assert.ok(yeni.hatalar.length > 0, dil);
    assert.doesNotMatch(JSON.stringify(yeni.hatalar), TURKCE_OZEL_HARF, `${dil}: hata iletisinde Türkçe harf`);
    assert.notDeepEqual(yeni.hatalar, kotu.hatalar, `${dil}: ileti İngilizceden farklı`);
  }
  const trKotu = ayarGirdisiniDogrula({ ...girdi, yerelAdres: 'abc' }, mevcut);
  assert.match(JSON.stringify(trKotu.hatalar), /Ev içi adres geçersiz/);
});

// --- HTML: data-i18n anahtarları ve İngilizce görünür metin ---------------------------------------------

const HTML_SAYFALARI = ['src/ayarlar.html', 'src/offline.html', 'src/kose-bildirim.html', 'src/yuzey.html'];
/** Sayfalar hangi sözlüklerden çevrilir (sayfa -> sözlükler). Ayarlar ve panel kendi sözlüğünü, ortak kısayol iletileri için ana sözlüğü de yükleyebilir. */
const SAYFA_SOZLUKLERI = {
  'src/ayarlar.html': [AYARLAR, ANA],
  'src/offline.html': [ANA, AYARLAR, YUZEY],
  'src/kose-bildirim.html': [ANA, YUZEY, AYARLAR],
  'src/yuzey.html': [YUZEY, ANA],
};

function htmlAnahtarlari(html) {
  const anahtarlar = new Set();
  for (const m of html.matchAll(/\bdata-i18n="([^"]+)"/g)) anahtarlar.add(m[1]);
  for (const m of html.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
    for (const parca of m[1].split(';')) {
      const i = parca.indexOf(':');
      if (i > 0) anahtarlar.add(parca.slice(i + 1).trim());
    }
  }
  return anahtarlar;
}

test('HTML sayfalarındaki her data-i18n / data-i18n-attr anahtarı bir sözlükte (beş dilin hepsinde) tanımlı', () => {
  for (const sayfa of HTML_SAYFALARI) {
    const sozlukler = SAYFA_SOZLUKLERI[sayfa];
    for (const anahtar of htmlAnahtarlari(oku(sayfa))) {
      for (const dil of DILLER) assert.ok(sozlukler.some((s) => Object.hasOwn(s[dil], anahtar)), `${sayfa}: "${anahtar}" hiçbir ${dil} sözlükte yok`);
    }
  }
});

/**
 * Basit HTML tarayıcı: verilen dilde (varsayılan İngilizce) çevirisi uygulanmış sayfada kalan görünür metinleri ve görünür öznitelikleri döndürür.
 * data-i18n'li öğenin içeriği sözlükteki o dildeki metinle değişir; data-i18n-attr'lı öznitelikler de.
 */
function ingilizceGorunurMetinler(html, sozlukler, dil = 'en') {
  const bul = (anahtar) => {
    for (const s of sozlukler) if (Object.hasOwn(s[dil], anahtar)) return s[dil][anahtar];
    return null;
  };
  const kalan = [];
  const temiz = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const BOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const belirteç = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const yigin = []; // { ad, cevrili }
  let m;
  while ((m = belirteç.exec(temiz))) {
    if (m[4] !== undefined) {
      if (yigin.some((o) => o.cevrili)) continue; // çevrilen öğenin içindeki Türkçe metin sayfada İngilizceyle değişir
      const metin = m[4].replace(/&[a-z#0-9]+;/gi, ' ').trim();
      if (metin) kalan.push(metin);
      continue;
    }
    const [, kapanis, ad, nitelikler] = m;
    const kucuk = ad.toLowerCase();
    if (kapanis) {
      while (yigin.length && yigin.at(-1).ad !== kucuk) yigin.pop();
      yigin.pop();
      continue;
    }
    const nitelik = (a) => {
      const e = nitelikler.match(new RegExp(`(?:^|\\s)${a}\\s*=\\s*"([^"]*)"`));
      return e ? e[1] : null;
    };
    const anahtar = nitelik('data-i18n');
    const cevrili = anahtar !== null && bul(anahtar) !== null;
    if (cevrili) kalan.push(bul(anahtar));
    const ceviriler = new Map();
    for (const parca of String(nitelik('data-i18n-attr') ?? '').split(';')) {
      const i = parca.indexOf(':');
      if (i > 0 && bul(parca.slice(i + 1).trim()) !== null) ceviriler.set(parca.slice(0, i).trim(), bul(parca.slice(i + 1).trim()));
    }
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const deger = ceviriler.get(a) ?? nitelik(a);
      if (deger) kalan.push(deger);
    }
    if (!BOS.has(kucuk) && !/\/\s*$/.test(nitelikler)) yigin.push({ ad: kucuk, cevrili });
  }
  return kalan;
}

test('ingilizceGorunurMetinler (test yardımcısı) kendi kendini sınar', () => {
  const html = '<html lang="tr"><head><title data-i18n="t">Başlık</title><script>var a="ğ"</script></head><body><h1 data-i18n="h">Merhaba <b>dünya</b></h1><p>Çıplak metin</p><input placeholder="Ara" data-i18n-attr="placeholder:p" title="Şunu"><br/></body></html>';
  const s = [{ en: { t: 'Title', h: 'Hello', p: 'Search' } }];
  assert.deepEqual(ingilizceGorunurMetinler(html, s), ['Title', 'Hello', 'Çıplak metin', 'Search', 'Şunu']);
  assert.deepEqual(ingilizceGorunurMetinler(html, [{ en: {}, de: { t: 'Titel', h: 'Hallo', p: 'Suche' } }], 'de'), ['Titel', 'Hallo', 'Çıplak metin', 'Suche', 'Şunu']);
});

test('çevirisi başlamış HTML sayfalarında (data-i18n kullanan) İngilizce seçiliyken Türkçe harfli görünür metin kalmaz', () => {
  let denetlenen = 0;
  for (const sayfa of HTML_SAYFALARI) {
    const html = oku(sayfa);
    if (htmlAnahtarlari(html).size === 0) continue; // henüz çeviri işaretlenmemiş sayfa (ilgili iş paketi bitince kendiliğinden devreye girer)
    denetlenen += 1;
    const kacaklar = ingilizceGorunurMetinler(html, SAYFA_SOZLUKLERI[sayfa]).filter((x) => TURKCE_HARF.test(x));
    assert.deepEqual(kacaklar, [], `${sayfa}: İngilizcede kalan Türkçe görünür metin`);
  }
  assert.ok(denetlenen >= 0);
});

test('çevirisi başlamış HTML sayfalarında Almanca, Fransızca ve İspanyolca seçiliyken Türkçeye özgü harfli (ğ ı ş) görünür metin kalmaz; dil adları sabit', () => {
  let denetlenen = 0;
  for (const sayfa of HTML_SAYFALARI) {
    const html = oku(sayfa);
    if (htmlAnahtarlari(html).size === 0) continue;
    denetlenen += 1;
    const enKalan = ingilizceGorunurMetinler(html, SAYFA_SOZLUKLERI[sayfa], 'en').length;
    for (const dil of YENI_DILLER) {
      const metinler = ingilizceGorunurMetinler(html, SAYFA_SOZLUKLERI[sayfa], dil);
      assert.deepEqual(metinler.filter((x) => TURKCE_OZEL_HARF.test(x)), [], `${sayfa}: ${dil} seçiliyken kalan Türkçe görünür metin`);
      assert.equal(metinler.length, enKalan, `${sayfa}: ${dil} ile en aynı sayıda görünür metin üretir (çeviri kapsamı eşit)`);
    }
  }
  assert.ok(denetlenen >= 3, 'en az üç sayfa denetlendi');
  // dil seçicideki adlar sözlükle çevrilmez: HTML'de her dilin kendi adı sabit durur
  const ayarlarHtml = oku('src/ayarlar.html');
  for (const [dil, ad] of Object.entries({ tr: 'Türkçe', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' })) {
    const adHtml = ad.replace('ü', '&uuml;').replace('ç', '&ccedil;').replace('ñ', '&ntilde;');
    assert.match(ayarlarHtml, new RegExp(`<option value="${dil}">${adHtml}</option>`), `${dil}: "${ad}" seçeneği sabit adla`);
  }
});

// --- renderer betikleri sözlük dosyalarını UMD olarak yükler -------------------------------------------

test('dil.js ve sözlük dosyaları tarayıcıda da yüklenir: require kullanmaz, global ad verir', () => {
  for (const [dosya, ad] of [['src/lib/dil.js', 'EvDil'], ['src/lib/ceviri/ana.js', 'EvCeviriAna'], ['src/lib/ceviri/ayarlar.js', 'EvCeviriAyarlar'], ['src/lib/ceviri/yuzey.js', 'EvCeviriYuzey']]) {
    const kaynak = oku(dosya);
    assert.doesNotMatch(kaynak, /\brequire\(/, `${dosya}: require yok`);
    const pencere = {};
    new Function('module', 'globalThis', 'window', `${kaynak}\n`).call(pencere, undefined, pencere, pencere);
    assert.equal(typeof pencere[ad], 'object', `${dosya}: ${ad} küresel adı`);
  }
});
