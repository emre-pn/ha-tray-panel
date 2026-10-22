'use strict';

/**
 * Grup "tema" yerel sayfa denetimleri (CSS / HTML / renderer betikleri): yüksek karşıtlık paleti (o-25), özel palet değişkenlerinin
 * CSS ile uyumu (o-29), animasyonların varsayılan kapalı ve "hareketi azalt"a uyumlu olması (o-34), CSP ve güvenli API kuralları.
 * Hiçbir pencere açılmaz; görsel sonuç denenmez (README elle deneme listesi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/lib/tema-renk');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const YUZEY_CSS = oku('src/yuzey.css');
const KOSE_CSS = oku('src/kose-bildirim.css');

// ---- CSS ayrıştırma: medya bağlamıyla düz kural listesi ---------------------------------------------------------------------

const yorumsuz = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const bosluksuz = (s) => s.trim().replace(/\s+/g, ' ');

/** [{ secici, govde, medya }]: medya = kuralı saran @media koşulları (ya da ''); @keyframes iç kuralları atlanır. */
function kurallar(css) {
  const metin = yorumsuz(css);
  const sonuc = [];
  const yigin = []; // { baslik, medya }
  let tampon = '';
  for (let i = 0; i < metin.length; i += 1) {
    const c = metin[i];
    if (c === '{') {
      const baslik = bosluksuz(tampon);
      tampon = '';
      if (baslik.startsWith('@media')) yigin.push({ tur: 'medya', baslik });
      else if (baslik.startsWith('@keyframes') || baslik.startsWith('@font-face')) yigin.push({ tur: 'diger', baslik });
      else yigin.push({ tur: 'kural', baslik });
    } else if (c === '}') {
      const ust = yigin.pop();
      if (ust && ust.tur === 'kural' && !yigin.some((y) => y.tur === 'diger')) {
        sonuc.push({ secici: ust.baslik, govde: tampon, medya: yigin.filter((y) => y.tur === 'medya').map((y) => y.baslik).join(' && ') });
      }
      tampon = '';
    } else {
      tampon += c;
    }
  }
  return sonuc;
}

const degiskenler = (govde) => Object.fromEntries([...govde.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], bosluksuz(m[2])]));
const secicidenGovde = (liste, secici, medya) => liste.filter((k) => k.secici === secici && k.medya === medya).map((k) => k.govde).join(';');

const YUZEY_KURALLARI = kurallar(YUZEY_CSS);
const KOSE_KURALLARI = kurallar(KOSE_CSS);
const ACIK_MEDYA = '@media (prefers-color-scheme: light)';
const HAREKET_VAR = '@media (prefers-reduced-motion: no-preference)';

const parlaklik = T.parlaklik;
const kontrast = T.kontrast;

// ---- o-29: özel palet değişkenleri CSS ile uyumlu --------------------------------------------------------------------------

test('palet değişkenleri: tema-renk.js\'in yazabildiği her değişken panel ya da bildirim CSS\'inde :root\'ta tanımlı; CSS\'teki renk değişkenlerinin hepsi yazılabilir', () => {
  const yuzey = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ''));
  const kose = degiskenler(secicidenGovde(KOSE_KURALLARI, ':root', ''));
  const tanimli = new Set([...Object.keys(yuzey), ...Object.keys(kose)]);
  for (const ad of T.DEGISKEN_ADLARI) assert.ok(tanimli.has(ad), `${ad}: CSS'te tanımlı değil`);
  for (const ad of tanimli) assert.ok(T.DEGISKEN_ADLARI.includes(ad), `${ad}: CSS'te var ama özel palet bunu üretmiyor (özel temada eski renk kalırdı)`);
  // panel değişkenleri tam: palet üreticisi panelin değişkenlerinin hepsini yazar
  for (const ad of Object.keys(yuzey)) assert.ok(ad in T.paletUret({ sema: 'koyu' }).degiskenler, `${ad}: paletUret üretmiyor`);
});

test('karo renkleri (--renk-*), grafik serileri (--seri-*) ve ışık paleti (--isik-renk-*): iki tema seti tema-renk.js ile CSS aynı; özel arka planda karo renkleri zeminlerinde >= 4,5 kalır', () => {
  const koyu = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ''));
  const acik = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ACIK_MEDYA));
  for (const [sema, css] of [['koyu', koyu], ['acik', acik]]) {
    const d = T.paletUret({ sema }).degiskenler;
    for (const ad of T.KARO_RENKLERI[sema] ? Object.keys(T.KARO_RENKLERI[sema]) : []) assert.equal(d[`--renk-${ad}`], css[`--renk-${ad}`], `${sema} --renk-${ad}`);
    T.SERI_RENKLERI[sema].forEach((renk, i) => {
      assert.equal(d[`--seri-${i}`], css[`--seri-${i}`], `${sema} --seri-${i}`);
      assert.equal(renk, css[`--seri-${i}`], `${sema} sabit seri ${i}`);
    });
    // ışık rengi paleti düğmeleri (--isik-renk-*): iki temada da aynı sabit dolgu; palet de aynısını yazar
    for (const [ad, renk] of Object.entries(T.ISIK_RENKLERI)) {
      assert.equal(css[`--isik-renk-${ad}`], renk, `${sema} CSS --isik-renk-${ad}`);
      assert.equal(d[`--isik-renk-${ad}`], renk, `${sema} palet --isik-renk-${ad}`);
    }
  }
  // özel (ölü bölgeye düşen) arka plan: karo renkleri dört yüzeyin hepsinde okunur kalır
  for (const arkaPlan of ['#2b3a55', '#7a7a7a', '#d8c9a0', '#101010', '#fafafa']) {
    const palet = T.paletUret({ sema: 'koyu', arkaPlan });
    const d = palet.degiskenler;
    for (const ad of Object.keys(T.KARO_RENKLERI.koyu)) {
      for (const zemin of ['--bg', '--bg-ust', '--karo', '--karo-uzerinde']) {
        assert.ok(kontrast(d[`--renk-${ad}`], d[zemin]) >= 4.5, `${arkaPlan} ${palet.sema}: --renk-${ad} / ${zemin}`);
      }
    }
    for (let i = 0; i < 7; i += 1) assert.match(d[`--seri-${i}`], /^#[0-9a-f]{6}$/);
  }
});

test('palet varsayılanları: hazır "varsayılan" taban/vurgu CSS\'teki --bg ve --vurgu ile aynı (iki tema)', () => {
  const koyu = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ''));
  const acik = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ACIK_MEDYA));
  assert.equal(T.VARSAYILAN_TABAN.koyu, koyu['--bg']);
  assert.equal(T.VARSAYILAN_TABAN.acik, acik['--bg']);
  assert.equal(T.VARSAYILAN_VURGU.koyu, koyu['--vurgu']);
  assert.equal(T.VARSAYILAN_VURGU.acik, acik['--vurgu']);
  const { OPAK_ARKA_PLAN, OPAK_ARKA_PLAN_ACIK } = require('../src/lib/malzeme');
  assert.equal(OPAK_ARKA_PLAN, koyu['--bg']);
  assert.equal(OPAK_ARKA_PLAN_ACIK, acik['--bg']);
});

test('palet saydamlığı: tema-renk.js\'in yarı saydam alfa değerleri CSS\'teki :root[data-malzeme] ile aynı', () => {
  const koyu = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root[data-malzeme]', ''));
  const acik = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root[data-malzeme]', ACIK_MEDYA));
  const alfa = (deger) => Number(/,\s*([\d.]+)\)$/.exec(deger)[1]);
  for (const [sema, css] of [['koyu', koyu], ['acik', acik]]) {
    const palet = T.paletUret({ sema, saydam: true }).degiskenler;
    for (const ad of ['--bg', '--bg-ust', '--karo', '--karo-uzerinde']) assert.equal(alfa(palet[ad]), alfa(css[ad]), `${sema} ${ad}`);
    assert.equal(palet['--kenar'], css['--kenar'], `${sema} --kenar`);
  }
});

test('sabit durum renkleri: tema-renk.js\'teki canlı/yedek/hata/yıkıcı/rozet CSS ile aynı', () => {
  const koyu = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ''));
  const acik = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ACIK_MEDYA));
  for (const [sema, css] of [['koyu', koyu], ['acik', acik]]) {
    const d = T.paletUret({ sema }).degiskenler;
    for (const ad of ['--canli', '--yedek', '--hata', '--yikici']) assert.equal(d[ad], css[ad], `${sema} ${ad}`);
  }
});

// ---- o-25: yüksek karşıtlık ---------------------------------------------------------------------------------------------------

function yuksekKarsitlikPaletleri(kurallarListesi) {
  return {
    koyu: degiskenler(secicidenGovde(kurallarListesi, ':root[data-karsitlik]', '')),
    acik: degiskenler(secicidenGovde(kurallarListesi, ':root[data-karsitlik]', ACIK_MEDYA)),
  };
}

test('yüksek karşıtlık (panel): koyu ve açık palet tam; kenarlık ve metin saf siyah/beyaz; metin çiftleri en az 7:1', () => {
  const { koyu, acik } = yuksekKarsitlikPaletleri(YUZEY_KURALLARI);
  const temel = degiskenler(secicidenGovde(YUZEY_KURALLARI, ':root', ''));
  for (const [ad, palet] of [['koyu', koyu], ['açık', acik]]) {
    for (const d of Object.keys(temel)) assert.ok(d in palet, `${ad}: ${d} yüksek karşıtlıkta tanımlı değil`);
    const metinZeminleri = ['--bg', '--bg-ust', '--karo', '--karo-uzerinde'];
    for (const zemin of metinZeminleri) {
      for (const on of ['--metin', '--soluk', '--soluk-eski', '--soluk-secili', '--acik', '--acik-eski', '--vurgu-metin', '--yikici-metin']) {
        const oran = kontrast(palet[on], palet[zemin]);
        assert.ok(oran >= 7, `${ad}: ${on} / ${zemin} = ${oran.toFixed(2)} (en az 7)`);
      }
    }
    for (const dolu of ['--vurgu', '--yikici', '--hata', '--yedek', '--canli']) {
      assert.ok(kontrast(palet['--rozet-metin'], palet[dolu]) >= 7, `${ad}: rozet metni / ${dolu}`);
    }
    assert.ok(kontrast(palet['--kenar'], palet['--bg']) >= 15, `${ad}: kenarlık zeminden belirgin ayrılır`);
    assert.ok(kontrast(palet['--vurgu'], palet['--bg']) >= 4.5, `${ad}: vurgu rengi (odak halkası, seçili çerçeve) zeminde seçilir`);
    for (const [k, deger] of Object.entries(palet)) assert.match(deger, /^#[0-9a-f]{6}$/, `${ad}: ${k} opak (yarı saydam değil)`);
  }
  assert.equal(koyu['--bg'], '#000000');
  assert.equal(acik['--bg'], '#ffffff');
});

test('köşe bildirimi durum renkleri (--basari, --hata, --bilgi): tema-renk.js iki tema için CSS ile aynı değerleri yazar', () => {
  const koyu = degiskenler(secicidenGovde(KOSE_KURALLARI, ':root', ''));
  const acik = degiskenler(secicidenGovde(KOSE_KURALLARI, ':root', ACIK_MEDYA));
  for (const [sema, css] of [['koyu', koyu], ['acik', acik]]) {
    const d = T.paletUret({ sema }).degiskenler;
    for (const ad of ['--basari', '--hata', '--bilgi']) assert.equal(d[ad], css[ad], `${sema} ${ad}`);
  }
});

test('yüksek karşıtlık (köşe bildirimi): paleti tam; metin ve ✓/! simgeleri en az 7:1', () => {
  const { koyu, acik } = yuksekKarsitlikPaletleri(KOSE_KURALLARI);
  for (const [ad, p] of [['koyu', koyu], ['açık', acik]]) {
    for (const d of ['--bg', '--metin', '--basari', '--hata', '--bilgi', '--isaret-metin']) assert.ok(d in p, `${ad}: ${d}`);
    assert.ok(kontrast(p['--metin'], p['--bg']) >= 7, `${ad}: metin`);
    assert.ok(kontrast(p['--isaret-metin'], p['--basari']) >= 7, `${ad}: ✓ simgesi`);
    assert.ok(kontrast(p['--isaret-metin'], p['--hata']) >= 7, `${ad}: ! simgesi`);
    assert.ok(kontrast(p['--basari'], p['--bg']) >= 4.5 && kontrast(p['--hata'], p['--bg']) >= 4.5 && kontrast(p['--bilgi'], p['--bg']) >= 4.5, `${ad}: sol şerit zeminden seçilir (bilgi türü dahil)`);
  }
});

test('yüksek karşıtlık (Ayarlar): metin ve düğme çiftleri en az 7:1, kenarlıklar saf siyah/beyaz', () => {
  const html = oku('src/ayarlar.html');
  const stil = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const liste = kurallar(stil);
  const { koyu, acik } = yuksekKarsitlikPaletleri(liste);
  for (const [ad, p] of [['koyu', koyu], ['açık', acik]]) {
    for (const on of ['--text-main', '--text-muted', '--text-dim', '--label', '--primary', '--success', '--warning', '--danger', '--ok-text', '--warn-text', '--err-text', '--danger-text', '--chip-text', '--kod-text', '--rule-text', '--btn2-text']) {
      for (const zemin of ['--bg', '--card-bg']) {
        const oran = kontrast(p[on], p[zemin]);
        assert.ok(oran >= 7, `${ad}: ${on} / ${zemin} = ${oran.toFixed(2)}`);
      }
    }
    assert.ok(kontrast(p['--btn2-text'], p['--btn2-bg']) >= 7, `${ad}: ikincil düğme`);
    assert.ok(kontrast('#ffffff', p['--primary-btn']) >= 7, `${ad}: birincil düğme beyaz yazı`);
    assert.ok(kontrast(p['--input-border'], p['--input-bg']) >= 15, `${ad}: giriş kenarlığı`);
    assert.ok(kontrast(p['--card-border'], p['--card-bg']) >= 15, `${ad}: kart kenarlığı`);
    assert.ok(kontrast(p['--input-focus'], p['--input-bg']) >= 7, `${ad}: odak rengi`);
  }
  // açık palet yalnız Windows açıkken (ya da "Her zaman açık" ile) devreye girer: koyu varsayılan, açık medya sorgusunda
  assert.equal(koyu['--bg'], '#000000');
  assert.equal(acik['--bg'], '#ffffff');
});

test('yüksek karşıtlık: panel kenarlıkları kalınlaşır; kullanılamayan karo soluklaşmaz; odak halkası kalın', () => {
  const kural = (secici, medya = '') => YUZEY_KURALLARI.filter((k) => k.secici.split(',').map(bosluksuz).includes(secici) && k.medya === medya).map((k) => k.govde).join(';');
  assert.match(kural(':root[data-karsitlik] .karo'), /border-width:\s*2px/);
  assert.match(kural(':root[data-karsitlik] .karo.durum-acik'), /border-width:\s*3px/);
  assert.match(kural(':root[data-karsitlik] .karo.yok'), /opacity:\s*1/);
  assert.match(kural(':root[data-karsitlik] button:focus-visible'), /outline-width:\s*3px/);
  assert.match(kural(':root[data-karsitlik] .palet-satir.secili'), /box-shadow/);
});

test('yüksek karşıtlık: özel palet değişkenleri yok sayılır (CSS özgüllüğü: sabit palet satır içi değişkenden önce gelmez ama ana süreç karşıtlıkta palet göndermez)', () => {
  const G = require('../src/lib/gorunum');
  const m = G.gorunumModeli({ yuksekKarsitlik: true, panelTemasi: 'orman', panelVurguRengi: '#ff0000', panelArkaPlani: '#123456' });
  assert.equal(m.degiskenler, undefined);
  assert.equal(m.karsitlik, true);
});

// ---- o-34: animasyonlar --------------------------------------------------------------------------------------------------------

const ISLEVSEL = ':root:not([data-hareket])';

test('animasyonlar: animation/transition bildirimleri yalnız işlevsel (:root:not([data-hareket])) ya da kozmetik (:root[data-gecis]) katmanda ve prefers-reduced-motion: no-preference içindedir', () => {
  const bas = YUZEY_CSS.indexOf('Görünüm ayarları (1.4.0 grup "tema")');
  assert.ok(bas > 0, 'tema bloğu işaretli');
  const temaBlogu = kurallar(YUZEY_CSS.slice(bas));
  const hareketli = temaBlogu.filter((k) => /\b(animation|transition|animation-delay)\s*:/.test(k.govde) && !/^\s*(?:animation|transition):\s*none/.test(k.govde));
  assert.ok(hareketli.length >= 8, `hareketli kural sayısı ${hareketli.length}`);
  for (const k of hareketli) {
    assert.ok(
      k.secici.split(',').every((s) => s.trim().startsWith(':root[data-gecis]') || s.trim().startsWith(ISLEVSEL)),
      `${k.secici}: :root[data-gecis] ya da ${ISLEVSEL} ile başlamıyor`,
    );
    assert.equal(k.medya, HAREKET_VAR, `${k.secici}: prefers-reduced-motion: no-preference içinde değil`);
  }
  // köşe bildirimi
  const koseBas = KOSE_CSS.indexOf('Görünüm ayarları (1.4.0 grup "tema")');
  assert.ok(koseBas > 0);
  const koseHareketli = kurallar(KOSE_CSS.slice(koseBas)).filter((k) => /\b(animation|transition)\s*:/.test(k.govde) && !/(?:animation|transition):\s*none/.test(k.govde));
  assert.ok(koseHareketli.length >= 1);
  for (const k of koseHareketli) {
    assert.ok(k.secici.startsWith(':root[data-gecis]'), `${k.secici}`);
    assert.equal(k.medya, HAREKET_VAR);
  }
});

test('animasyonlar: varsayılanda (öznitelik yok) hiçbir yeni kural etkin değildir; kayan vurgu ve efekt tuvali gizli', () => {
  const kuralVar = (secici) => YUZEY_KURALLARI.filter((k) => k.secici === secici);
  assert.match(kuralVar('.kayan-vurgu')[0].govde, /display:\s*none/);
  assert.match(kuralVar('.efekt[hidden]')[0].govde, /display:\s*none/);
  assert.match(kuralVar('.efekt')[0].govde, /pointer-events:\s*none/, 'tuval fareyi geçirir');
  // @keyframes yalnız kendi animasyonlarına bağlıdır; temel (öznitelik gerektirmeyen) kurallar animation kullanmaz
  for (const k of YUZEY_KURALLARI) {
    if (/\banimation\s*:/.test(k.govde) && !/animation:\s*none/.test(k.govde)) {
      assert.ok(k.secici.includes('[data-gecis]') || k.secici.startsWith(ISLEVSEL) || /\.rozet|basili|::after|::before/.test(k.secici), `${k.secici}: beklenmeyen animasyon`);
    }
  }
});

test('animasyonlar: hareketi azalt ayarı (data-hareket) karo geçişlerini kapatır; sistem tercihi eski kuralla korunur', () => {
  const kural = (secici, medya = '') => YUZEY_KURALLARI.filter((k) => k.secici === secici && k.medya === medya).map((k) => k.govde).join(';');
  assert.match(kural(':root[data-hareket="azalt"] .karo'), /transition:\s*none/);
  assert.match(YUZEY_CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.karo\s*\{\s*transition:\s*none/);
  assert.match(KOSE_CSS, /:root\[data-hareket="azalt"\] \.bildirim\s*\{\s*transition:\s*none/);
  // geçiş animasyonu seçilmeden (data-gecis yok) :root[data-hareket] kuralı dışında hiçbir karo geçişi yeniden tanımlanmaz
  const gecisliKaro = YUZEY_KURALLARI.filter((k) => k.secici.startsWith(':root[data-gecis] .karo') && /transition/.test(k.govde));
  assert.ok(gecisliKaro.every((k) => k.medya === HAREKET_VAR));
});

test('işlevsel hareket (1.4.1): basma, başarı işareti ve panel açılışı varsayılan açık; hareketi azalt kapatır; yıkıcı karo basınca küçülmez', () => {
  const kural = (secici, medya = HAREKET_VAR) => YUZEY_KURALLARI.filter((k) => k.secici === secici && k.medya === medya).map((k) => k.govde).join(';');
  assert.match(kural(ISLEVSEL + ' .karo'), /transition:\s*background var\(--t-hizli\) ease-out,\s*transform var\(--t-hizli\)/);
  assert.match(kural(ISLEVSEL + ' .karo:not(.yikici):not(.yok):active'), /transform:\s*scale\(0\.98\)/);
  assert.match(kural(ISLEVSEL + ' .karo.basari::before'), /animation:\s*isaret-belir var\(--t-normal\) var\(--e-giris\)/);
  assert.match(kural(ISLEVSEL + '[data-acilis] .kok'), /animation:\s*panel-ac var\(--t-normal\) var\(--e-giris\) backwards/);
  // basınca küçülen her karo kuralı yıkıcı (basılı tutulan) karoyu dışarıda bırakır
  for (const k of YUZEY_KURALLARI) {
    if (/\.karo[^,]*:active/.test(k.secici) && /transform:\s*scale/.test(k.govde)) assert.match(k.secici, /:not\(\.yikici\)/, k.secici);
  }
  // yalnız transform ve opacity canlandırılır
  for (const ad of ['panel-ac', 'isaret-belir']) {
    const bas = YUZEY_CSS.indexOf('@keyframes ' + ad);
    assert.ok(bas > 0, ad);
    const govde = YUZEY_CSS.slice(bas).split(/\n\}\n/)[0];
    const ozellikler = [...govde.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
    assert.ok(ozellikler.length > 0 && ozellikler.every((o) => o === 'opacity' || o === 'transform'), ad + ': ' + ozellikler);
  }
  // hareket jetonları renk değişkenlerinden ayrı (özel palet onları yazmaz)
  assert.match(kural('html', ''), /--t-normal:\s*167ms/);
  // yeniden çizilen karoda süren başarı işareti ikinci kez belirmez: kural kozmetik işaret kuralından sonra gelir
  const surer = YUZEY_CSS.indexOf(':root .karo.basari.basari-surer::before');
  assert.ok(surer > YUZEY_CSS.indexOf(':root[data-gecis] .karo.basari::before'), 'basari-surer sonra gelir');
  assert.match(kural(':root .karo.basari.basari-surer::before', ''), /animation:\s*none/);
});

test('işlevsel hareket (1.4.1): panel açılışı yalnız panel kipinde, pencere gizliyken gelen gösterimde ve hareket azaltılmamışken oynar', () => {
  const g = oku('src/yuzey-gorunum.js');
  const fonk = g.slice(g.indexOf('function acilisiOynat'), g.indexOf('// ---------------------------------------------------------------- kayan vurgu'));
  assert.match(fonk, /if \(gizliydi !== true \|\| sonuc\.hareketAzalt \|\| !yuk \|\| yuk\.mod !== 'panel'\) return;/);
  assert.match(fonk, /kok\.setAttribute\('data-acilis', '1'\)/);
  assert.match(g, /const gizliydi = document\.hidden === true;[\s\S]*?acilisiOynat\(yuk, gizliydi\);/);
});

test('animasyonlar: kayan vurgu yalnız [data-gecis][data-kayan] iken görünür; giriş animasyonu yalnız [data-gecis][data-giris] iken çalışır; .kok sınıfına bağlı değildir', () => {
  const secicilerAnimasyonlu = YUZEY_KURALLARI.filter((k) => /animation:\s*karo-gir/.test(k.govde)).map((k) => k.secici).join(',');
  assert.match(secicilerAnimasyonlu, /:root\[data-gecis\]\[data-giris\]/);
  assert.doesNotMatch(secicilerAnimasyonlu, /\.kok\.giris/, 'yuzey-sayfa.js .kok sınıfını her çizimde yeniden yazar');
  const kayan = YUZEY_KURALLARI.filter((k) => k.secici === ':root[data-gecis][data-kayan] .kayan-vurgu');
  assert.ok(kayan.length >= 1);
  assert.match(kayan[0].govde, /display:\s*block/);
  assert.equal(kayan[0].medya, HAREKET_VAR);
  assert.match(YUZEY_CSS, /@keyframes karo-gir/);
  assert.match(YUZEY_CSS, /@keyframes isaret-gir/);
});

// ---- HTML / betik düzeni / güvenlik ----------------------------------------------------------------------------------------------

test('yuzey.html: efekt tuvali gizli ve süstür; betik sırası: sayfa betiği, tema-renk, efekt, görünüm betiği; CSP satır içi stile izin vermez', () => {
  const html = oku('src/yuzey.html');
  assert.match(html, /<canvas id="efekt" class="efekt" aria-hidden="true" hidden><\/canvas>/);
  const betikler = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const sira = (ad) => betikler.indexOf(ad);
  assert.ok(sira('yuzey-sayfa.js') > 0);
  assert.ok(sira('lib/tema-renk.js') > sira('yuzey-sayfa.js'), 'tema-renk.js sayfa betiğinden sonra');
  assert.ok(sira('lib/efekt.js') > sira('lib/tema-renk.js'));
  assert.ok(sira('yuzey-gorunum.js') > sira('lib/efekt.js'), 'görünüm betiği bağımlılıklarından sonra');
  assert.equal(betikler.at(-1), 'yuzey-gorunum.js');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /style-src 'self';/, 'panelde satır içi stil yok');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|blob:|https?:/);
  // tuval sayfa içeriğinin dışında (kok kardeşi): odak sırasına girmez
  assert.ok(html.indexOf('id="efekt"') > html.indexOf('id="kok"'));
  assert.doesNotMatch(html, /\sstyle\s*=/, 'satır içi style özniteliği yok');
});

test('kose-bildirim.html: tema-renk.js köşe sayfası betiğinden önce yüklenir; CSP katı', () => {
  const html = oku('src/kose-bildirim.html');
  const betikler = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(betikler.indexOf('lib/tema-renk.js') >= 0 && betikler.indexOf('lib/tema-renk.js') < betikler.indexOf('kose-sayfa.js'));
  assert.doesNotMatch(/Content-Security-Policy" content="([^"]+)"/.exec(html)[1], /unsafe-inline|unsafe-eval/);
});

test('ayarlar.html: tema-renk.js ayarlar.js\'ten önce yüklenir (önizleme)', () => {
  const betikler = [...oku('src/ayarlar.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(betikler.indexOf('lib/tema-renk.js') >= 0 && betikler.indexOf('lib/tema-renk.js') < betikler.indexOf('ayarlar.js'));
});

test('renderer betikleri (tema-renk, efekt, yuzey-gorunum): HTML ataması, eval, ağ, depolama ve require yok; yalnız preload\'un açtığı işlevler', () => {
  const EV_YUZEY_KOPRUSU = ['durumAl', 'onDurum', 'onGoster', 'onDilDegisti', 'calistir', 'oku', 'basiliBasla', 'basiliBirak', 'kapat', 'boyut', 'haAc', 'ayarlarAc'];
  for (const betik of ['src/lib/tema-renk.js', 'src/lib/efekt.js', 'src/yuzey-gorunum.js']) {
    const icerik = yorumsuz(oku(betik)).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(icerik, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|importScripts/, `${betik}: tehlikeli API`);
    assert.doesNotMatch(icerik, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|window\.open\s*\(|localStorage|sessionStorage|indexedDB|navigator\./, `${betik}: ağ/depolama/pencere API'si`);
    assert.doesNotMatch(icerik, /require\s*\(/, `${betik}: sandbox'ta require yok`);
    assert.doesNotMatch(icerik, /setAttribute\(\s*['"]style['"]/, `${betik}: satır içi style özniteliği yazılmaz (CSP)`);
  }
  const gorunum = oku('src/yuzey-gorunum.js');
  for (const [, ad] of gorunum.matchAll(/kopru\.(\w+)/g)) assert.ok(EV_YUZEY_KOPRUSU.includes(ad), `yuzey-gorunum.js: evYuzey.${ad} preload'da yok`);
  assert.deepEqual([...new Set([...gorunum.matchAll(/kopru\.(\w+)/g)].map((m) => m[1]))].sort(), ['durumAl', 'onDurum', 'onGoster'], 'yeni köprü işlevi kullanılmaz; eylem/okuma çağrısı yok');
  const html = oku('src/yuzey.html');
  for (const [, kimlik] of gorunum.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(html.includes(`id="${kimlik}"`), `yuzey.html: #${kimlik} yok`);
  const kose = oku('src/kose-sayfa.js');
  assert.doesNotMatch(yorumsuz(kose), /innerHTML|eval\s*\(|fetch\s*\(/);
});

test('preload köprüleri: tema yeni köprü işlevi eklemez (evYuzey listesi yalnız diğer grupların bilinçli eklediği oku, bildirimKapat, kamera, sagTik, dis onayı ve eylem grubu işlevleriyle uzar; evKose aynı)', () => {
  const yuzey = [...oku('src/preload-yuzey.js').matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  // dis grubu (o-54) bilinçli ekledi: disOnayAl, disOnayYanitla, onDisOnay (evpaneli:// bağlantı izni; test/yapi.test.js)
  // eylem grubu bilinçli ekledi: geriAl, geciktir, gecikmeliIptal, odaKapat, digerCihazlar, digerCalistir, digerFavoriEkle; düzen: sayfaSec (palet sayfa satırı, o-24)
  assert.deepEqual(yuzey, ['durumAl', 'onDurum', 'onGoster', 'onEtkilesim', 'onDilDegisti', 'calistir', 'oku', 'bildirimKapat', 'kamera', 'basiliBasla', 'basiliBirak', 'kapat', 'sabitle', 'boyut', 'haAc', 'ayarlarAc', 'sagTik', 'disOnayAl', 'disOnayYanitla', 'onDisOnay', 'geriAl', 'geciktir', 'gecikmeliIptal', 'odaKapat', 'digerCihazlar', 'digerCalistir', 'digerFavoriEkle', 'sayfaSec']);
  const kose = [...oku('src/preload-kose.js').matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(kose, ['onGoster', 'onDilDegisti']);
});

test('görünüm modeli ağ/HA verisi taşımaz: gorunum.js ve tema-renk.js dosya, ağ ve süreç API\'si kullanmaz', () => {
  for (const dosya of ['src/lib/gorunum.js', 'src/lib/tema-renk.js', 'src/lib/efekt.js']) {
    const icerik = yorumsuz(oku(dosya)).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(icerik, /node:fs|node:net|node:http|node:child_process|\bfetch\s*\(|process\.|electron/i, dosya);
  }
});

test('metin ölçeği: HA penceresine dokunulmaz (ana pencere yakınlaştırması metinOlcegi\'ne bağlı değil)', () => {
  const ana = oku('src/main.js');
  assert.doesNotMatch(ana, /anaPencere[^;]{0,80}metinOlcegi|metinOlcegi[^;]{0,80}anaPencere/);
  // metin ölçeği yalnız panel/palet (yuzey), köşe bildirimi ve Ayarlar için okunur
  const kullanim = [...ana.matchAll(/metinOlcegi\w*/g)].map((m) => m[0]);
  assert.ok(kullanim.length >= 3);
});

test('hiçbir yeni ayar dışarıya çıkış açmaz: tema alanları ağ ile ilgisizdir ve varsayılan ayar dosyası kozmetik animasyonu kapalı tutar', () => {
  const A = require('../src/lib/ayar-alanlari');
  for (const ad of ['animasyonlar', 'hareketiAzalt', 'yuksekKarsitlik']) assert.equal(A.AYAR_ALANLARI.find((a) => a.ad === ad).varsayilan, false, ad);
  const varsayilan = JSON.parse(oku('varsayilan-ayarlar.json'));
  assert.notEqual(varsayilan.animasyonlar, true);
});

// ---- 1.4.2: arayüz cilası -------------------------------------------------------------------------------------------------------

test('arayüz cilası (1.4.2): transition: all yok; iç içe yarıçap tutarlı; değişen sayılar sabit genişlikte; küçük düğmelerin tıklama alanı geniş', () => {
  for (const f of ['src/yuzey.css', 'src/kose-bildirim.css', 'src/itme-kart.css', 'src/masaustu-karo.css', 'src/ayarlar.html', 'src/offline.html']) {
    assert.doesNotMatch(oku(f), /transition:\s*all\b|will-change:\s*all\b/, f);
  }
  const govde = (secici) => YUZEY_KURALLARI.filter((k) => k.secici === secici && k.medya === '').map((k) => k.govde).join(';');
  const yaricap = (secici) => Number((/border-radius:\s*(\d+)px/.exec(govde(secici)) || [])[1]);
  const dolgu = (secici) => Number((/padding:\s*(\d+)px/.exec(govde(secici)) || [])[1]);
  // dış = iç + dolgu
  assert.equal(yaricap('.isik-karo'), yaricap('.isik-karo .karo') + dolgu('.isik-karo'));
  assert.equal(yaricap('.isik-karo'), yaricap('.hazir') + dolgu('.isik-karo'));
  assert.equal(yaricap('.kart'), yaricap('.kart-dugme') + dolgu('.kart'));
  assert.equal(yaricap('.kart'), yaricap('.kart-kapak') + dolgu('.kart'));
  assert.equal(yaricap('.kamera-karo'), yaricap('.kamera-cerceve') + dolgu('.kamera-karo'));
  for (const s of ['.karo-durum', '.kart-durum', '.kart-deger', '.rozet', '.bildirim-rozet', '.bildirim-zaman', '.tahmin-zaman', '.gecikmeli-serit', '.kamera-yas']) {
    assert.match(govde(s), /font-variant-numeric:\s*tabular-nums/, s);
  }
  // albüm kapağının iç çizgisi renk değişkeninden türer (sabit renk yok)
  assert.match(govde('.kart-kapak'), /outline:\s*1px solid color-mix\(in srgb, var\(--metin\) 12%, transparent\)/);
  // tıklama alanı: görünmez sözde öğe düğmenin çevresine taşar
  assert.match(govde('.sabitle'), /position:\s*relative/);
  assert.match(govde('.bildirim-oge-kapat'), /position:\s*relative/);
  assert.match(govde('.sabitle::before,.bildirim-oge-kapat::before') || YUZEY_KURALLARI.filter((k) => /\.sabitle::before/.test(k.secici)).map((k) => k.govde).join(';'), /inset:\s*-8px/);
});
