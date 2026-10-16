'use strict';

/**
 * Arayüz dili (src/lib/dil.js + src/lib/ceviri/*.js): dil çözümü, çevirmen, sayfa çevirisi, sözlük bütünlüğü (tr/en anahtar ve
 * yer tutucu eşliği), kullanılan her anahtarın sözlükte bulunması, ayar normalleştirme ve İngilizce metinlerde Türkçe harf kalmaması.
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
const SOZLUKLER = { ana: ANA, ayarlar: AYARLAR, yuzey: YUZEY };
const yerTutucular = (metin) => [...String(metin).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

// --- dil çözümü -----------------------------------------------------------------------------------------

test('dilCoz: tr/en olduğu gibi; sistem Windows diline göre (tr ile başlıyorsa tr, aksi en); eksik ya da geçersiz her şey tr', () => {
  assert.equal(EvDil.dilCoz('tr', 'en-US'), 'tr');
  assert.equal(EvDil.dilCoz('en', 'tr-TR'), 'en');
  assert.equal(EvDil.dilCoz('sistem', 'tr-TR'), 'tr');
  assert.equal(EvDil.dilCoz('sistem', 'TR'), 'tr');
  assert.equal(EvDil.dilCoz('sistem', 'en-US'), 'en');
  assert.equal(EvDil.dilCoz('sistem', 'de-DE'), 'en', 'desteklenmeyen sistem dili İngilizceye düşer');
  for (const bos of [undefined, null, '', '  ', 42, {}]) assert.equal(EvDil.dilCoz('sistem', bos), 'tr', String(bos));
  for (const kotu of [undefined, null, '', 'de', 'EN', 42, {}]) assert.equal(EvDil.dilCoz(kotu, 'en-US'), 'tr', String(kotu));
});

test('dilAyariDuzelt ve sabitler', () => {
  assert.deepEqual([...EvDil.DILLER], ['tr', 'en']);
  assert.deepEqual([...EvDil.DIL_AYARLARI], ['sistem', 'tr', 'en']);
  assert.equal(EvDil.VARSAYILAN_DIL, 'tr');
  assert.equal(EvDil.VARSAYILAN_DIL_AYARI, 'sistem');
  for (const iyi of ['sistem', 'tr', 'en']) assert.equal(EvDil.dilAyariDuzelt(iyi), iyi);
  for (const kotu of [undefined, null, 'de', 'EN', 1, {}]) assert.equal(EvDil.dilAyariDuzelt(kotu), 'sistem');
  assert.equal(EvDil.dilAyariDuzelt('x', 'tr'), 'tr');
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
  assert.equal(EvDil.cevirmen('de', s1).dil, 'tr', 'geçersiz dil tr olur');
  assert.equal(EvDil.cevirmen('en')('x'), 'x', 'sözlüksüz çalışır');
  assert.equal(en('a', { ad: '$&' }), 'Hello $&', 'özel değiştirme dizileri yorumlanmaz');
  assert.equal(en('a', { __proto__: { ad: 'kalitim' } }), 'Hello {ad}', 'miras alınan özellik kullanılmaz');
});

test('cogul: n === 1 ve .bir anahtarı varsa tekil; yoksa çoğul; {n} otomatik', () => {
  const t = EvDil.cevirmen('en', { tr: {}, en: { 'x': '{n} items', 'x.bir': '{n} item', y: '{n} rows' } });
  assert.equal(EvDil.cogul(t, 'x', 1), '1 item');
  assert.equal(EvDil.cogul(t, 'x', 2), '2 items');
  assert.equal(EvDil.cogul(t, 'x', 0), '0 items');
  assert.equal(EvDil.cogul(t, 'y', 1), '1 rows', '.bir yoksa aynı anahtar');
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
  test(`sözlük ${ad}: tr ve en aynı anahtar kümesine ve aynı {yer tutuculara} sahip; değerler boş olmayan metin`, () => {
    assert.equal(typeof sozluk.tr, 'object');
    assert.equal(typeof sozluk.en, 'object');
    const trAnahtarlar = Object.keys(sozluk.tr).sort();
    const enAnahtarlar = Object.keys(sozluk.en).sort();
    assert.deepEqual(enAnahtarlar.filter((k) => !trAnahtarlar.includes(k)), [], 'yalnız en içinde olan anahtarlar');
    assert.deepEqual(trAnahtarlar.filter((k) => !enAnahtarlar.includes(k)), [], 'yalnız tr içinde olan anahtarlar (çevrilmemiş)');
    for (const k of trAnahtarlar) {
      assert.equal(typeof sozluk.tr[k], 'string', `${k}: tr metin olmalı`);
      assert.equal(typeof sozluk.en[k], 'string', `${k}: en metin olmalı`);
      assert.ok(sozluk.tr[k].trim() !== '' && sozluk.en[k].trim() !== '', `${k}: boş metin yok`);
      assert.deepEqual(yerTutucular(sozluk.en[k]), yerTutucular(sozluk.tr[k]), `${k}: yer tutucular iki dilde aynı olmalı`);
    }
  });

  test(`sözlük ${ad}: İngilizce metinlerde Türkçe harf yok (özel adlar ve Türkçe sözcük alıntıları hariç değil: hiç yok)`, () => {
    const kacak = Object.entries(sozluk.en).filter(([, m]) => TURKCE_HARF.test(m));
    assert.deepEqual(kacak, [], 'İngilizce sözlükte Türkçe harf içeren metinler');
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

test('ana süreç ve src/lib kaynaklarında kullanılan her sabit t("anahtar") ana sözlükte (tr ve en) tanımlı', () => {
  const dosyalar = ['src/main.js', 'src/eylem.js', 'src/ha-istemcisi.js', 'src/yuzey-yoneticisi.js', 'src/kose-bildirim.js']
    .concat(fs.readdirSync(path.join(KOK, 'src/lib')).filter((d) => d.endsWith('.js') && d !== 'dil.js').map((d) => `src/lib/${d}`));
  let toplam = 0;
  for (const dosya of dosyalar) {
    for (const anahtar of kullanilanAnahtarlar(oku(dosya))) {
      toplam += 1;
      assert.ok(Object.hasOwn(ANA.tr, anahtar), `${dosya}: "${anahtar}" ana sözlükte (tr) yok`);
      assert.ok(Object.hasOwn(ANA.en, anahtar), `${dosya}: "${anahtar}" ana sözlükte (en) yok`);
    }
  }
  assert.ok(toplam > 100, `çok az anahtar bulundu (${toplam}): düzenli ifade bozulmuş olabilir`);
});

test('dinamik anahtar aileleri tamam: hazir.<kimlik> (her hazır karo), onay.<kimlik>, grup.<kod>, durum/alan adları, kisayol.ayrilmis.*', () => {
  for (const h of HAZIR_LISTE) assert.ok(Object.hasOwn(ANA.en, `hazir.${h.kimlik}`), `hazir.${h.kimlik}`);
  const kisayolKaynagi = oku('src/lib/kisayol.js');
  for (const m of kisayolKaynagi.matchAll(/'((?:Control|Alt)\+[A-Za-z0-9]+)':\s*'/g)) assert.ok(Object.hasOwn(ANA.en, `kisayol.ayrilmis.${m[1]}`), `kisayol.ayrilmis.${m[1]}`);
  const sinif = oku('src/lib/eylem-sinifi.js');
  const kimlikler = [...sinif.matchAll(/ACIKLAMALI_KIMLIKLER[^=]*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  for (const k of kimlikler) assert.ok(Object.hasOwn(ANA.en, `onay.${k}`), `onay.${k}`);
  assert.ok(Object.hasOwn(ANA.en, 'onay.genel'));
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

test('İngilizce hazır liste etiketleri güvenlik süzgecinden geçer (kapı/kilit sözcüğü yok) ve favori eklenirken o dilde yazılır', () => {
  const en = anaCevirmen('en');
  for (const h of HAZIR_LISTE) {
    const etiket = en(`hazir.${h.kimlik}`);
    assert.notEqual(etiket, `hazir.${h.kimlik}`, `${h.kimlik}: İngilizce etiket var`);
    assert.equal(adGuvenliMi(h.kimlik, etiket), true, `${h.kimlik}: "${etiket}" süzgeçten geçmeli`);
    assert.doesNotMatch(etiket, TURKCE_HARF);
  }
  const varliklar = HAZIR_LISTE.map((h) => ({ entity_id: h.kimlik, state: 'off', attributes: { friendly_name: `${h.etiket} cihazı` } }));
  const etiketAl = (kimlik, varsayilan) => (en.var(`hazir.${kimlik}`) ? en(`hazir.${kimlik}`) : varsayilan);
  const sonuc = hazirListeUygula([], varliklar, { etiketAl });
  assert.ok(sonuc.eklenenler.length > 0);
  for (const f of sonuc.favoriler) assert.equal(f.etiket, en(`hazir.${f.entity_id}`));
  const turkce = hazirListeUygula([], varliklar);
  for (const f of turkce.favoriler) assert.equal(f.etiket, HAZIR_LISTE.find((h) => h.kimlik === f.entity_id).etiket, 'etiketAl yoksa Türkçe (eski davranış)');
});

// --- ayar: normalleştirme ve kaydetme ---------------------------------------------------------------------

test("ayar şeması: 'dil' varsayılanı 'sistem'; geçerli değer korunur, bozuk/eksik değer varsayılana döner; şema sürümü değişmez", () => {
  assert.equal(VARSAYILAN.dil, 'sistem');
  const duzelt = (ham) => ayarlariDuzelt(ham, { varsayilan: VARSAYILAN }).ayarlar;
  assert.equal(duzelt({}).dil, 'sistem');
  for (const iyi of ['tr', 'en', 'sistem']) assert.equal(duzelt({ dil: iyi }).dil, iyi);
  for (const kotu of ['de', 'EN', 7, null, {}, []]) assert.equal(duzelt({ dil: kotu }).dil, 'sistem', JSON.stringify(kotu));
  const eski = duzelt({ semaSurumu: 5, yerelAdres: 'http://192.168.1.10:8123' });
  assert.equal(eski.dil, 'sistem', 'dil alanı olmayan eski ayar dosyası göçte sistem dilini izler');
});

test("ayar kaydetme: girdideki 'dil' yalnız sistem/tr/en ise kabul edilir; yoksa ya da geçersizse mevcut korunur", () => {
  const girdi = { yerelAdres: 'http://192.168.1.10:8123', disAdres: '', kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli' };
  const mevcut = { kisayol: 'Control+Alt+H', pencereBoyutu: 'hizli', dil: 'tr' };
  assert.equal(ayarGirdisiniDogrula({ ...girdi, dil: 'en' }, mevcut).yeni.dil, 'en');
  assert.equal(ayarGirdisiniDogrula({ ...girdi, dil: 'sistem' }, mevcut).yeni.dil, 'sistem');
  assert.equal(ayarGirdisiniDogrula({ ...girdi, dil: 'de' }, mevcut).yeni.dil, undefined, 'geçersiz değer yeni ayara girmez (mevcut korunur)');
  assert.equal(ayarGirdisiniDogrula(girdi, mevcut).yeni.dil, undefined);
  // iletiler seçili dilde
  const en = anaCevirmen('en');
  const kotu = ayarGirdisiniDogrula({ ...girdi, yerelAdres: 'abc' }, mevcut, { t: en });
  assert.ok(kotu.hatalar.length > 0);
  assert.doesNotMatch(JSON.stringify(kotu.hatalar), TURKCE_HARF);
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

test('HTML sayfalarındaki her data-i18n / data-i18n-attr anahtarı bir sözlükte (tr ve en) tanımlı', () => {
  for (const sayfa of HTML_SAYFALARI) {
    const sozlukler = SAYFA_SOZLUKLERI[sayfa];
    for (const anahtar of htmlAnahtarlari(oku(sayfa))) {
      assert.ok(sozlukler.some((s) => Object.hasOwn(s.tr, anahtar)), `${sayfa}: "${anahtar}" hiçbir tr sözlükte yok`);
      assert.ok(sozlukler.some((s) => Object.hasOwn(s.en, anahtar)), `${sayfa}: "${anahtar}" hiçbir en sözlükte yok`);
    }
  }
});

/**
 * Basit HTML tarayıcı: İngilizce çevirisi uygulanmış sayfada kalan görünür metinleri ve görünür öznitelikleri döndürür.
 * data-i18n'li öğenin içeriği sözlükteki İngilizce metinle değişir; data-i18n-attr'lı öznitelikler de.
 */
function ingilizceGorunurMetinler(html, sozlukler) {
  const bul = (anahtar) => {
    for (const s of sozlukler) if (Object.hasOwn(s.en, anahtar)) return s.en[anahtar];
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
