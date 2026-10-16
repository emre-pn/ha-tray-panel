'use strict';

/**
 * Ayarlar penceresinin Türkçe/İngilizce çevirisi (src/ayarlar.html + src/ayarlar.js + src/lib/ceviri/ayarlar.js).
 *
 * Statik denetimler: HTML'deki Türkçe varsayılan metin sözlükle birebir aynı, kullanılan her anahtar iki dilde tanımlı, ölü anahtar yok,
 * İngilizce metinde Türkçe harf / çevrilmemiş kopya yok, kapı-kilit kuralının İngilizce açıklaması süzgeçteki her sözcüğü sayar.
 * Davranış denetimleri (sahte DOM, test/ayarlar-sahte.js): dil seçimi kayıt yüküne girer, kayıttan ve ana süreç olayından sonra sayfa yeni dilde
 * yeniden yazılır (durumdan türeyen metinler dahil), kaydedilmemiş düzenleme ve güvenlik davranışları dile bağlı değildir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AYARLAR = require('../src/lib/ceviri/ayarlar');
const ANA = require('../src/lib/ceviri/ana');
const { YASAK_PARCALAR, YASAK_KISA_PARCALAR } = require('../src/lib/suzgec');
const {
  HTML,
  BETIK,
  AYAR,
  CIHAZLAR,
  AYAR_D3,
  CIHAZLAR_D3,
  akit,
  duzles,
  acilmisSayfa,
  sayfayiKur,
  gorunurMetinler,
  girdiler,
} = require('./ayarlar-sahte');

const KOK = path.join(__dirname, '..');
const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
const DIL_ANAHTARI = 'evPaneli.ayarlar.dil';
const yerTutucular = (metin) => [...String(metin).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
const varsayilanOlmayan = (s) => Object.keys(s.tr).filter((k) => !k.endsWith('.bir'));

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const bildirim = (sayfa) => sayfa.oge('genelBildirim').textContent;

/** Sözlükler: tr/en ayarlar sözlüğü, ana sözlük geri düşüşüyle (sayfanın çevirmeni gibi). */
const metin = (dil, anahtar) => AYARLAR[dil][anahtar] ?? ANA[dil][anahtar];

// ---------------------------------------------------------------------------
// Statik denetimler: HTML, sözlük, kaynak
// ---------------------------------------------------------------------------

const cozEsc = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const bosluk = (s) => s.replace(/\s+/g, ' ').trim();

test('ayarlar.html: data-i18n içeriği ve data-i18n-attr öznitelikleri Türkçe sözlükle birebir aynı (Türkçe varsayılan metin değişmez)', () => {
  let sayac = 0;
  for (const m of HTML.matchAll(/<(\w+)([^>]*?\bdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, , , anahtar, ic] = m;
    const yazilan = cozEsc(ic);
    assert.doesNotMatch(yazilan, /<[a-z]/i, `${anahtar}: data-i18n öğesinin içinde etiket olmamalı (içerik tümüyle değişir)`);
    const beklenen = metin('tr', anahtar);
    assert.notEqual(beklenen, undefined, `${anahtar}: Türkçe sözlükte yok`);
    assert.equal(bosluk(yazilan), bosluk(beklenen), `${anahtar}: HTML'deki Türkçe metin sözlükten farklı`);
    sayac += 1;
  }
  assert.ok(sayac > 100, `yeterince çevrilebilir öğe bulunamadı (${sayac})`);
  let nitelikSayisi = 0;
  for (const m of HTML.matchAll(/<(\w+)([^>]*?)\bdata-i18n-attr="([^"]+)"([^>]*)>/g)) {
    const tumu = `${m[2]} ${m[4]}`;
    for (const parca of m[3].split(';')) {
      const i = parca.indexOf(':');
      const nitelik = parca.slice(0, i).trim();
      const anahtar = parca.slice(i + 1).trim();
      const deger = new RegExp(`(?:^|\\s)${nitelik}="([^"]*)"`).exec(tumu);
      assert.ok(deger, `${anahtar}: ${nitelik} özniteliği HTML'de yok`);
      assert.equal(cozEsc(deger[1]), metin('tr', anahtar), `${anahtar}: ${nitelik} Türkçe varsayılanı sözlükten farklı`);
      nitelikSayisi += 1;
    }
  }
  assert.equal(nitelikSayisi, 8, 'öznitelik çevirileri (placeholder, aria-label)');
});

test('ayarlar.html: dil seçici Görünüm bölümünde; "Dil / Language" etiketi ve dil adları sabit, "Sistem dili" çevrilir; sayfa betikleri doğru sırada', () => {
  assert.match(HTML, /<label for="dilSecimi">Dil \/ Language<\/label>/);
  assert.match(HTML, /<select id="dilSecimi">\s*<option value="sistem" data-i18n="ayar\.dil\.sistem">Sistem dili<\/option>\s*<option value="tr">T&uuml;rk&ccedil;e<\/option>\s*<option value="en">English<\/option>\s*<\/select>/);
  const gorunum = HTML.slice(HTML.indexOf('id="bolumGorunum"'), HTML.indexOf('id="bolumAnahtar"'));
  assert.match(gorunum, /id="dilSecimi"/, 'dil seçici Görünüm bölümünde');
  assert.ok(!Object.values(AYARLAR.tr).concat(Object.values(AYARLAR.en)).some((m) => m === 'English' || m === 'Türkçe'), 'dil adları çevrilmez');
  // Sözlükler ve dil.js, ayarlar.js'ten ve kisayol.js'ten önce yüklenir
  const betikler = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(betikler, ['lib/dil.js', 'lib/ceviri/ana.js', 'lib/ceviri/ayarlar.js', 'lib/kisayol.js', 'lib/arama.js', 'ayarlar.js']);
  assert.match(HTML, /<html lang="tr">/);
});

test('ayarlar.js: kullandığı her sözlük anahtarı tanımlı (ayar.* Ayarlar sözlüğünde, diğerleri ana sözlükte; iki dilde)', () => {
  const kullanilan = new Set([...BETIK.matchAll(/'((?:ayar|bildirim|kisayol|uygulama|sonuc)\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
  assert.ok(kullanilan.size > 100, `anahtar bulunamadı (${kullanilan.size})`);
  for (const anahtar of kullanilan) {
    const kaynak = anahtar.startsWith('ayar.') ? AYARLAR : ANA;
    assert.ok(Object.hasOwn(kaynak.tr, anahtar), `${anahtar}: tr sözlükte yok`);
    assert.ok(Object.hasOwn(kaynak.en, anahtar), `${anahtar}: en sözlükte yok`);
  }
  for (const anahtar of ['bildirim.anahtarSilmeOnay']) assert.ok(kullanilan.has(anahtar), `${anahtar}: ayarlar.js kullanmıyor`);
  // HTML anahtarları: ayar.* Ayarlar sözlüğünde; sayfa başlığı ana sözlükten
  for (const [, anahtar] of HTML.matchAll(/\bdata-i18n="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(AYARLAR.en, anahtar) || Object.hasOwn(ANA.en, anahtar), `${anahtar}: HTML anahtarı sözlükte yok`);
  }
});

test('ayarlar.js: Türkçe metin sabiti kalmadı (Türkçe harfli dize yalnız yorum satırlarında)', () => {
  const kodSatirlari = BETIK.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((s) => s.replace(/(^|\s)\/\/.*$/, ''));
  const kacaklar = kodSatirlari.filter((s) => TURKCE_HARF.test(s));
  assert.deepEqual(kacaklar, [], 'kodda Türkçe harfli sabit var: metin sözlüğe taşınmalı');
});

test('Ayarlar sözlüğü: ölü anahtar yok, ana sözlükle çakışmıyor, kaynakta yinelenen anahtar yok, .bir yalnız çoğul tabanı olanlarda', () => {
  const kullanilan = new Set([...BETIK.matchAll(/'(ayar\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
  for (const m of HTML.matchAll(/\bdata-i18n="([^"]+)"/g)) kullanilan.add(m[1]);
  for (const m of HTML.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) kullanilan.add(p.slice(p.indexOf(':') + 1).trim());
  const olu = varsayilanOlmayan(AYARLAR).filter((k) => !kullanilan.has(k));
  assert.deepEqual(olu, [], 'hiçbir yerde kullanılmayan (ölü) anahtarlar');

  for (const k of Object.keys(AYARLAR.tr)) {
    assert.ok(k.startsWith('ayar.'), `${k}: Ayarlar sözlüğü anahtarları ayar. ile başlar`);
    assert.ok(!Object.hasOwn(ANA.tr, k), `${k}: ana sözlükte de var (üst üste yazılır)`);
    if (k.endsWith('.bir')) assert.ok(Object.hasOwn(AYARLAR.tr, k.slice(0, -4)), `${k}: çoğul tabanı yok`);
  }

  const kaynak = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ceviri', 'ayarlar.js'), 'utf8');
  const tanimlar = [...kaynak.matchAll(/^\s*\['(ayar\.[A-Za-z0-9_.]+)',/gm)].map((m) => m[1]);
  assert.equal(tanimlar.length, Object.keys(AYARLAR.tr).length, 'kaynaktaki satır sayısı ile anahtar sayısı eşit (yinelenen anahtar yok)');
  assert.equal(new Set(tanimlar).size, tanimlar.length);
});

test('Ayarlar sözlüğü İngilizce: Türkçe harf yok, Türkçe kopya değil, ASCII Türkçe sözcük kalıntısı yok, yer tutucular iki dilde aynı', () => {
  const ozdes = Object.keys(AYARLAR.tr).filter((k) => AYARLAR.tr[k] === AYARLAR.en[k]);
  assert.deepEqual(ozdes, ['ayar.aktar.ozet'], 'yalnız yer tutuculardan oluşan metin iki dilde aynı olabilir');
  // Güvenlik kuralı metni kapı/kilit sözcüklerinin Türkçe yazımlarını bilerek sayar (ayrı sınanır)
  const turkceSozcukler = ['veya', 'ile', 'ama', 'gibi', 'daha', 'kadar', 'icin', 'degil', 'sonra', 'tamam', 'hata', 'kaydet', 'ayar', 'ayarlar', 'cihaz', 'pano', 'kisayol', 'adres', 'bir', 'bu', 'ise', 'yok', 'var', 'olan', 'olarak'];
  const kalinti = new RegExp(`(?<![\\p{L}])(?:${turkceSozcukler.join('|')})(?![\\p{L}])`, 'iu');
  for (const [anahtar, ingilizce] of Object.entries(AYARLAR.en)) {
    assert.doesNotMatch(ingilizce, TURKCE_HARF, `${anahtar}: İngilizce metinde Türkçe harf`);
    assert.deepEqual(yerTutucular(ingilizce), yerTutucular(AYARLAR.tr[anahtar]), `${anahtar}: yer tutucular farklı`);
    if (anahtar !== 'ayar.guvenlik.metin') assert.doesNotMatch(ingilizce.replace(/\{[A-Za-z0-9_]+\}/g, ''), kalinti, `${anahtar}: Türkçe sözcük kalıntısı`);
    assert.ok(ingilizce.trim() !== '' || anahtar.startsWith('ayar.'), anahtar);
  }
  assert.equal(AYARLAR.en['ayar.baslik'], 'Home Panel Settings');
  assert.equal(AYARLAR.en['ayar.kaydet.dugme'], 'Save settings');
  assert.match(HTML, /<h1 data-i18n="ayar\.baslik">/);
});

test('Güvenlik kuralı (kapı/kilit) açıklaması İngilizcede de eksiksiz: süzgeçteki her sözcük (Türkçe yazımlarıyla) sayılır; kural Türkçesi değişmedi', () => {
  const ingilizce = AYARLAR.en['ayar.guvenlik.metin'].toLowerCase();
  // kilid/kepeng/unlock yalnız ek biçimleri: kilit/kepenk/lock zaten sayılıyor
  const ekBicimler = new Set(['kilid', 'kepeng', 'unlock']);
  for (const sozcuk of [...YASAK_PARCALAR, ...YASAK_KISA_PARCALAR]) {
    if (ekBicimler.has(sozcuk)) continue;
    assert.match(ingilizce, new RegExp(`(?<![a-z])${sozcuk}`), `İngilizce kural metninde "${sozcuk}" yok`);
  }
  // Metnin anlattığı kurallar: kilit ve alarm sistemleri listelenmez, kapılar yalnız HA arayüzünden açılır, karo adları, otomatik çıkarma
  assert.match(ingilizce, /locks, alarm systems/);
  assert.match(ingilizce, /cannot be added to favorites/);
  assert.match(ingilizce, /doors can only be opened from inside the home assistant interface/);
  assert.match(ingilizce, /tile names follow the same rule/);
  assert.match(ingilizce, /removed automatically when you save/);
  const turkce = AYARLAR.tr['ayar.guvenlik.metin'];
  assert.match(turkce, /^Kilitler \(lock\), alarm sistemleri ve adında ya da kimliğinde "kapı \/ door \/ kilit \/ lock \/ alarm \/ garaj \/ bariyer \/ gate \/ diafon \/ interkom \/ kepenk \/ deadbolt \/ latch \/ buzzer \/ yale \/ shutter" geçen hiçbir cihaz favorilere eklenemez ve bu listede gösterilmez\. Kapılar yalnızca Home Assistant arayüzü içerisinden açılabilir\./);
});

test('yer tutucu sayıları: çoğul çiftlerinde ({n}) .bir metni de {n} içerir; sayı verilen her metinde n var', () => {
  for (const anahtar of Object.keys(AYARLAR.tr).filter((k) => k.endsWith('.bir'))) {
    for (const dil of ['tr', 'en']) assert.match(AYARLAR[dil][anahtar], /\{n\}/, `${anahtar} (${dil})`);
  }
});

// ---------------------------------------------------------------------------
// Davranış: dil seçimi, kayıt, ana süreç olayı
// ---------------------------------------------------------------------------

/** İngilizce sınamalar için ASCII veri (Türkçe harfli sunucu verisi, sayfanın kendi metnini denetlemeyi bozar). */
const AYAR_EN = {
  ...AYAR_D3,
  dil: 'en',
  dilAyari: 'en',
  sistemDili: 'en',
  favoriler: [
    { entity_id: 'light.living_room', ad: 'Living Room Lamp' },
    { entity_id: 'light.old_lamp', ad: 'Old Lamp' },
    { entity_id: 'light.hallway', ad: 'Hallway' },
  ],
  panolar: [{ ad: 'Energy', yol: '/energy', kisayol: 'Control+Alt+E' }],
};
const CIHAZLAR_EN = {
  ok: true,
  cihazlar: [
    { entity_id: 'light.living_room', ad: 'Living Room Lamp', alan: 'light', alanEtiketi: 'Lights', durum: 'on', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
    { entity_id: 'scene.movie', ad: 'Movie', alan: 'scene', alanEtiketi: 'Scenes', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
    { entity_id: 'button.shut_down_pc', ad: 'Shut Down PC', alan: 'button', alanEtiketi: 'Buttons', durum: '', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
    { entity_id: 'light.hidden_candidate', ad: 'Hidden Candidate', alan: 'light', alanEtiketi: 'Lights', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: true },
  ],
  eksik: [{ entity_id: 'light.old_lamp', ad: 'Old Lamp' }],
  engelli: [{ entity_id: 'light.hallway', ad: 'Hallway' }],
};
const YEDEKLER_EN = [
  { ad: 'settings.v4-backup.json', tur: 'goc', surum: 4, zaman: Date.UTC(2026, 8, 1, 10, 30), bayt: 2048, okunabilir: true },
  { ad: 'settings.corrupt-1790000000000.json', tur: 'bozuk', surum: null, zaman: Date.UTC(2026, 9, 2, 8, 0), bayt: 12, okunabilir: false },
];

/** Çevrilebilir (data-i18n / data-i18n-attr) öğelerin o dildeki sözlük karşılığıyla eşleştiğini söyler. */
function ceviriOgeleriUyusuyor(sayfa, dil, haric = new Set()) {
  const farklar = [];
  for (const oge of sayfa.ceviriOgeleri) {
    const anahtar = oge.getAttribute('data-i18n');
    if (anahtar !== null && !haric.has(oge.id) && oge.textContent !== metin(dil, anahtar)) {
      farklar.push(`${oge.id ?? oge.etiket}: "${oge.textContent}" != "${metin(dil, anahtar)}"`);
    }
    const nitelikler = oge.getAttribute('data-i18n-attr');
    if (nitelikler !== null) {
      for (const parca of nitelikler.split(';')) {
        const i = parca.indexOf(':');
        const ad = parca.slice(0, i).trim();
        const deger = oge.getAttribute(ad) ?? oge[ad];
        if (deger !== metin(dil, parca.slice(i + 1).trim())) farklar.push(`${oge.id ?? oge.etiket}[${ad}]: "${deger}"`);
      }
    }
  }
  return farklar;
}
/** JS'in kendi yazdığı (durumdan türeyen) çevrilebilir öğeler: varsayılan metinle başlar, betik durumdan yeniden yazar. */
const JS_SAHIPLI = new Set(['anahtarRozet', 'adimAdresDurum', 'adimAnahtarDurum', 'adimFavoriDurum', 'secilenSayisi', 'vurguOnizleme', 'gizlileriGosterMetin', 'btnDahaFazla', 'btnAnahtarGoster', 'btnAyarlariKaydet', 'btnAnahtarKaydet', 'btnCihazlariYukle', 'btnYerelSina', 'btnDisSina']);

test('Türkçe açılış: dil seçimi "sistem" (alan yok ya da geçersizse), sayfa Türkçe kalır; kaydet yükü dil alanını taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('dilSecimi').value, 'sistem');
  assert.equal(sayfa.htmlDili(), null, 'dil değişmediği için sayfa yeniden çevrilmez');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).dil, 'sistem');
  assert.equal(bildirim(sayfa).startsWith('Ayarlar kaydedildi.'), true);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Kaydet');

  for (const [dilAyari, beklenen] of [['tr', 'tr'], ['en', 'en'], ['sistem', 'sistem'], ['de', 'sistem'], [null, 'sistem']]) {
    const s = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari }, cihazlar: CIHAZLAR });
    assert.equal(s.oge('dilSecimi').value, beklenen, `dilAyari=${dilAyari}`);
    assert.equal(kirliMi(s), false, 'kayıtlı seçim kirli sayılmaz');
  }
});

test('Dil seçimi kirli yapar; kaydedilince yük dil taşır ve sayfa YENİ dilde yeniden yazılır (olay yanıttan önce gelir)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' }, cihazlar: CIHAZLAR });
  sayfa.oge('dilSecimi').value = 'en';
  sayfa.oge('dilSecimi').dispatchEvent({ type: 'change' });
  assert.equal(kirliMi(sayfa), true);
  assert.equal(sayfa.htmlDili(), null, 'kaydedilene dek sayfa dili değişmez');
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, '');

  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).dil, 'en');
  assert.equal(sayfa.sunucu.dil, 'en');
  assert.equal(sayfa.htmlDili(), 'en');
  assert.equal(sayfa.oge('dilSecimi').value, 'en');
  assert.equal(kirliMi(sayfa), false);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Save settings');
  assert.equal(sayfa.oge('btnAyarlariKaydet').disabled, false);
  assert.match(bildirim(sayfa), /^Settings saved\./);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari|bildirim-basarili/);
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Stored Encrypted');
  assert.equal(sayfa.oge('adimAnahtarDurum').textContent, 'Done');
  assert.equal(sayfa.depo.get(DIL_ANAHTARI), 'en', 'son dil ilk boyama için saklanır');
  // Cihaz listesi yeniden alındı (ana süreç iletileri yeni dilde gelir) ve seçim bozulmadı
  assert.ok(sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length >= 2);
  assert.match(sayfa.oge('secilenSayisi').textContent, /^\d+ favorites? selected$/);
});

test('Dil olayı yanıttan önce gelmese de (yalnız kayıt yanıtı) sayfa yeni dile geçer; geri Türkçeye dönüş sözlükle birebir', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' }, cihazlar: CIHAZLAR, dilOlayi: false });
  sayfa.oge('dilSecimi').value = 'en';
  sayfa.oge('dilSecimi').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  assert.equal(sayfa.htmlDili(), 'en');
  assert.match(bildirim(sayfa), /^Settings saved\./);
  assert.deepEqual(ceviriOgeleriUyusuyor(sayfa, 'en', JS_SAHIPLI), []);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Save settings');

  sayfa.oge('dilSecimi').value = 'tr';
  sayfa.oge('dilSecimi').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  assert.equal(sayfa.htmlDili(), 'tr');
  assert.equal(sonKayitYuku(sayfa).dil, 'tr');
  assert.deepEqual(ceviriOgeleriUyusuyor(sayfa, 'tr', JS_SAHIPLI), [], 'Türkçeye dönünce her çevrilebilir öğe Türkçe sözlük metni');
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Kaydet');
  assert.match(bildirim(sayfa), /^Ayarlar kaydedildi\./);
  assert.equal(sayfa.depo.get(DIL_ANAHTARI), 'tr');
});

test('"sistem" seçimi: etkin dil ana sürecin çözdüğü dildir (Windows İngilizce ise sayfa İngilizce)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'en-US' }, cihazlar: CIHAZLAR });
  // sahte ana süreç sistem dilini 'en' olarak çözecek
  sayfa.sunucu.sistemDili = 'en';
  sayfa.oge('dilSecimi').value = 'sistem';
  sayfa.oge('dilSecimi').dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).dil, 'sistem');
  assert.equal(sayfa.sunucu.dilAyari, 'sistem');
  assert.equal(sayfa.oge('dilSecimi').value, 'sistem');
  assert.equal(sayfa.htmlDili(), 'en');
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Save settings');
});

test('Ana süreçten gelen dil olayı: sayfa yeniden çevrilir, ayar özeti ve cihaz listesi yeniden alınır, kaydedilmemiş düzenleme korunur', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, dil: 'tr', dilAyari: 'sistem', sistemDili: 'tr' }, cihazlar: CIHAZLAR_D3 });
  yaz(sayfa.oge('yerelAdres'), 'http://192.168.1.99:8123');
  assert.equal(kirliMi(sayfa), true);
  const sayiTr = /^(\d+) favori seçili$/.exec(sayfa.oge('secilenSayisi').textContent)?.[1];
  assert.ok(sayiTr && Number(sayiTr) > 1, 'Türkçe seçili sayısı görünür');
  const getirOnce = sayfa.getirSayisi();
  const cihazOnce = sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length;

  await sayfa.dilDegisti('en');
  assert.equal(sayfa.htmlDili(), 'en');
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Save settings');
  assert.ok(sayfa.getirSayisi() > getirOnce, 'ayar özeti yeniden alındı');
  assert.ok(sayfa.cagrilar.filter((c) => c[0] === 'cihazlariGetir').length > cihazOnce, 'cihaz listesi yeniden alındı');
  assert.equal(sayfa.oge('yerelAdres').value, 'http://192.168.1.99:8123', 'yazılan değer korunur');
  assert.equal(kirliMi(sayfa), true, 'kirli durum korunur');
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Stored Encrypted');
  assert.equal(sayfa.oge('secilenSayisi').textContent, `${sayiTr} favorites selected`);
  assert.equal(sayfa.oge('hazirListeDurum').textContent, metin('en', 'ayar.hazir.durumGuncel'));
  assert.equal(sayfa.oge('canliDurumMetni').textContent, metin('en', 'ayar.canli.canli'));
  assert.equal(sayfa.depo.get(DIL_ANAHTARI), 'en');

  // aynı dilin tekrar bildirilmesi hiçbir şey yapmaz
  const getirSonra = sayfa.getirSayisi();
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.getirSayisi(), getirSonra);
  // geçersiz dil yok sayılır
  await sayfa.dilDegisti('xx');
  assert.equal(sayfa.htmlDili(), 'en');
  // geri Türkçe
  await sayfa.dilDegisti('tr');
  assert.equal(sayfa.htmlDili(), 'tr');
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  assert.equal(sayfa.oge('secilenSayisi').textContent, `${sayiTr} favori seçili`);
  assert.equal(sayfa.oge('yerelAdres').value, 'http://192.168.1.99:8123');
});

test('Dil değişince süren işlemin düğme etiketi kaybolmaz ("Kaydediliyor…" → "Saving…" → "Save settings")', async () => {
  let coz;
  const bekle = new Promise((r) => { coz = r; });
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' },
    cihazlar: CIHAZLAR,
    ayarKaydetYaniti: async () => {
      await bekle;
      return { ok: true, uyarilar: [] };
    },
  });
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('btnAyarlariKaydet').disabled, true);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Kaydediliyor…');
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge('btnAyarlariKaydet').disabled, true);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Saving…', 'süren işlemin etiketi yeni dilde');
  coz();
  await akit();
  assert.equal(sayfa.oge('btnAyarlariKaydet').disabled, false);
  assert.equal(sayfa.oge('btnAyarlariKaydet').textContent, 'Save settings');
});

test('Reddedilen HA panosu satırının nedeni dil değişince yeni dilde yeniden yazılır (satırda metin değil kod saklanır)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr', panolar: [] }, cihazlar: CIHAZLAR_D3 });
  const satirlari = () => sayfa.oge('panolarListesi').bul((o) => o.className === 'pano-satir');
  sayfa.oge('btnPanoEkle').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(satirlari().length, 1);
  const [ad, yol] = girdiler(satirlari()[0]);
  yaz(ad, 'Enerji');
  yaz(yol, 'energy'); // "/" ile başlamıyor: ana süreç satırı kaydetmez
  await kaydet(sayfa);
  const hata = () => satirlari()[0].bul((o) => o.className === 'pano-hata')[0];
  assert.equal(hata().textContent, metin('tr', 'ayar.pano.kaydedilmedi'));
  assert.equal(hata().style.display, 'block');
  assert.equal(girdiler(satirlari()[0])[0].placeholder, 'Ad (örn. Enerji)');

  await sayfa.dilDegisti('en');
  assert.equal(hata().textContent, metin('en', 'ayar.pano.kaydedilmedi'));
  assert.equal(hata().style.display, 'block', 'hata işareti dil değişince kaybolmaz');
  assert.equal(girdiler(satirlari()[0])[0].placeholder, 'Name (e.g. Energy)');
  assert.equal(girdiler(satirlari()[0])[0].value, 'Enerji', 'kullanıcının yazdığı değer çevrilmez');
  assert.equal(satirlari()[0].getAttribute('aria-label'), 'HA dashboard 1');
  assert.match(hata().textContent, /^Not saved: /);
});

test('Yetki kesici durumları ve güvenlik kaydı sorunları yeni dilde yeniden yazılır; yeniden dene düğmesi ve rozet davranışı değişmez', async () => {
  const sayfa = await acilmisSayfa({
    ayar: { ...AYAR_D3, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr', yetkiDurumu: 'dogrulanamadi', yetkiKaydiSorunu: 'yazilamadi' },
    cihazlar: CIHAZLAR_D3,
  });
  assert.equal(sayfa.oge('anahtarRozet').textContent, metin('tr', 'ayar.yetki.dogrulanamadi.rozet'));
  assert.equal(sayfa.oge('yetkiDurumUyari').textContent, metin('tr', 'ayar.yetki.dogrulanamadi.metin'));
  assert.equal(sayfa.oge('yetkiKaydiUyari').textContent, metin('tr', 'ayar.yetkiKaydi.yazilamadi'));
  assert.equal(sayfa.oge('btnYetkiYenidenDene').style.display, 'inline-flex');

  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Could Not Verify — Requests Stopped');
  assert.equal(sayfa.oge('yetkiDurumUyari').textContent, metin('en', 'ayar.yetki.dogrulanamadi.metin'));
  assert.equal(sayfa.oge('yetkiKaydiUyari').textContent, metin('en', 'ayar.yetkiKaydi.yazilamadi'));
  assert.equal(sayfa.oge('yetkiDurumUyari').style.display, 'block');
  assert.equal(sayfa.oge('btnYetkiYenidenDene').style.display, 'inline-flex');
  assert.equal(sayfa.oge('btnAnahtarSil').style.display, 'inline-flex');
  assert.match(sayfa.oge('anahtarRozet').className, /rozet-uyari/);

  // diğer iki durum
  for (const [durum, anahtar] of [['kayit-onayi', 'ayar.yetki.kayitOnayi'], ['yerel-yasak', 'ayar.yetki.yerelYasak']]) {
    const s = await acilmisSayfa({ ayar: { ...AYAR_D3, dil: 'en', dilAyari: 'en', sistemDili: 'en', yetkiDurumu: durum }, cihazlar: CIHAZLAR_EN });
    assert.equal(s.oge('anahtarRozet').textContent, metin('en', `${anahtar}.rozet`));
    assert.equal(s.oge('yetkiDurumUyari').textContent, metin('en', `${anahtar}.metin`));
  }
});

test('İngilizce açılış: tam durumla (favoriler, sıra, HA panoları, yedekler, kurulum) sayfada hiç Türkçe harf kalmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_EN, cihazlar: CIHAZLAR_EN, yedekler: YEDEKLER_EN });
  assert.equal(sayfa.htmlDili(), 'en');
  assert.deepEqual(ceviriOgeleriUyusuyor(sayfa, 'en', JS_SAHIPLI), []);
  assert.equal(sayfa.oge('dilSecimi').value, 'en');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '2 favorites selected', 'güvenlik kuralına takılan favori sayıya katılmaz');
  // başlık ve gezinti
  const h1 = sayfa.ceviriOgeleri.find((o) => o.etiket === 'h1');
  assert.equal(h1.textContent, 'Home Panel Settings');
  assert.equal(sayfa.ceviriOgeleri.find((o) => o.etiket === 'title').textContent, ANA.en['uygulama.ayarlarBaslik']);
  assert.equal(sayfa.ceviriOgeleri.find((o) => o.etiket === 'nav').getAttribute('aria-label'), 'Settings sections');
  assert.equal(sayfa.ceviriOgeleri.find((o) => o.getAttribute('data-i18n') === 'ayar.gezin.anahtar').textContent, 'Access token');
  assert.equal(sayfa.oge('yedekListesi').bul((o) => o.className === 'yedek-satir').length, 2);

  const gorunur = gorunurMetinler(sayfa);
  assert.ok(gorunur.length > 150, `denetim boş bir sayfayı sınıyor olmasın (${gorunur.length} metin)`);
  const kacaklar = gorunur.filter(([, m]) => TURKCE_HARF.test(m));
  assert.deepEqual(kacaklar, [], 'İngilizce sayfada Türkçe harfli görünür metin');
  // Cihaz satırları ve sıra paneli gerçekten çizilmiş olmalı (denetim boş bir sayfayı sınamasın)
  assert.ok(sayfa.oge('cihazListesi').bul((o) => o.className.includes('cihaz-satir')).length >= 3);
  assert.equal(sayfa.oge('favoriSirasiListesi').bul((o) => o.className === 'sira-satir').length, 2, 'Living Room Lamp ve HA’da bulunamayan Old Lamp; engelli Hallway yok');
  assert.ok(gorunurMetinler(sayfa).some(([, m]) => m === 'Tile name'), 'karo adı etiketi İngilizce');
  assert.ok(gorunurMetinler(sayfa).some(([, m]) => m === 'Safety rule: this entity cannot be a favorite; it is removed when you save.'));
});

test('İngilizce akışlar: sına, anahtar, silme onayı, hazır liste, dışa/içe aktarma ve kayıt iletileri İngilizce ve Türkçe harfsiz', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR_EN,
    cihazlar: CIHAZLAR_EN,
    yedekler: YEDEKLER_EN,
    adresSinaYaniti: () => ({ ok: true, ulasilabilir: false, neden: 'x' }),
    aktarimYaniti: {
      disa: { ok: true, ad: 'export.json', favoriSayisi: 2 },
      ice: { ok: true, ad: 'backup.json', alanSayisi: 1, favoriSayisi: 1, atilanSayisi: 1, notlar: [], uyarilar: [] },
    },
  });
  const iletiler = [];
  const goz = (ad) => iletiler.push([ad, bildirim(sayfa)]);

  // adres sına
  yaz(sayfa.oge('yerelAdres'), '');
  sayfa.oge('btnYerelSina').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('yerelAdresSonuc').textContent, 'Enter the address to test first.');
  yaz(sayfa.oge('yerelAdres'), 'http://192.168.1.10:8123');
  sayfa.oge('btnYerelSina').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('yerelAdresSonuc').textContent, 'The address could not be reached.');
  assert.equal(sayfa.oge('btnYerelSina').textContent, 'Test Connection');

  // kayıt: tekil/çoğul iletiler (sunucu favori sonucu: kayıtlı, 1 bulunamayan, 1 engelli)
  await kaydet(sayfa);
  goz('kayit');
  assert.match(bildirim(sayfa), /^Settings saved\. \d+ devices? (?:was|were) saved to the tray favorites\. 1 of them could not be found in Home Assistant right now, so it was kept as it is\. 1 favorite was removed because of the safety rule\.$/);

  // anahtar: boş
  sayfa.oge('btnAnahtarKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(bildirim(sayfa), 'Please paste your Home Assistant access token.');
  goz('anahtar-bos');
  // anahtar: göster/gizle ve uzunluk
  yaz(sayfa.oge('anahtarGirdisi'), 'abc');
  assert.equal(sayfa.oge('anahtarUzunluk').textContent.startsWith('3 characters.'), true);
  yaz(sayfa.oge('anahtarGirdisi'), 'a');
  assert.equal(sayfa.oge('anahtarUzunluk').textContent.startsWith('1 character.'), true);
  sayfa.oge('btnAnahtarGoster').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('btnAnahtarGoster').textContent, 'Hide');
  sayfa.oge('btnAnahtarGoster').dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('btnAnahtarGoster').textContent, 'Show');
  yaz(sayfa.oge('anahtarGirdisi'), '');

  // anahtarı sil: onay metni ana sözlükten, İngilizce
  sayfa.oge('btnAnahtarSil').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.sorular.at(-1), ANA.en['bildirim.anahtarSilmeOnay']);
  assert.doesNotMatch(sayfa.sorular.at(-1), TURKCE_HARF);
  assert.equal(bildirim(sayfa), ANA.en['bildirim.anahtarSilindi'], 'ana sürecin yanıtı seçili dilde gelir');
  goz('anahtar-sil');
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Not Added Yet');

  // dışa / içe aktarma
  sayfa.oge('btnDisaAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(bildirim(sayfa), 'Settings exported (export.json). The access token is not written to the file.');
  goz('disa');
  sayfa.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.match(bildirim(sayfa), /^Settings imported \(backup\.json\)\. 1 setting imported\. 1 favorite\. 1 value was skipped because it was not valid\. The access token was not changed\./);
  goz('ice');

  // yedeğe dön
  const yedekDugmesi = sayfa.oge('yedekListesi').bul((o) => o.etiket === 'button')[0];
  yedekDugmesi.dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.sorular.at(-1), metin('en', 'ayar.aktar.geriDonmeOnayi'));
  goz('yedek');

  for (const [ad, m] of iletiler) assert.doesNotMatch(m, TURKCE_HARF, `${ad}: ileti İngilizce olmalı`);
  for (const soru of sayfa.sorular) assert.doesNotMatch(soru, TURKCE_HARF, 'onay soruları İngilizce');
  assert.deepEqual(gorunurMetinler(sayfa).filter(([, m]) => TURKCE_HARF.test(m)), []);
});

test('Çoğul: İngilizce ve Türkçe tekil/çoğul biçimler sayıya göre seçilir', async () => {
  const bir = await acilmisSayfa({ ayar: { ...AYAR_EN, favoriler: [{ entity_id: 'light.living_room', ad: 'Living Room Lamp' }] }, cihazlar: { ...CIHAZLAR_EN, eksik: [], engelli: [] } });
  assert.equal(bir.oge('secilenSayisi').textContent, '1 favorite selected');
  const iki = await acilmisSayfa({ ayar: { ...AYAR_EN, favoriler: [{ entity_id: 'light.living_room', ad: 'Living Room Lamp' }, { entity_id: 'scene.movie', ad: 'Movie' }] }, cihazlar: { ...CIHAZLAR_EN, eksik: [], engelli: [] } });
  assert.equal(iki.oge('secilenSayisi').textContent, '2 favorites selected');
  const trBir = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] }, cihazlar: CIHAZLAR });
  assert.equal(trBir.oge('secilenSayisi').textContent, '1 favori seçili');
});

test('Güvenlik davranışları dile bağlı değildir: İngilizcede de engelli varlık seçilemez, onaylı eylem zorunlu onayda kalır, kayıtta engelli sayısı bildirilir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_EN, cihazlar: CIHAZLAR_EN });
  const satir = (kimlik) => sayfa.oge('cihazListesi').bul((o) => o.className.includes('cihaz-satir')).find((s) => s.bul((o) => o.className === 'cihaz-kimlik')[0].textContent === kimlik);
  const engelli = satir('light.hallway');
  assert.equal(engelli.bul((o) => o.etiket === 'input')[0].disabled, true, 'kapı/kilit kuralına takılan satır seçilemez');
  assert.match(engelli.textContent, /Safety rule: this entity cannot be a favorite; it is removed when you save\./);
  const onayli = satir('button.shut_down_pc');
  const onayKutusu = onayli.bul((o) => o.etiket === 'input' && o.type === 'checkbox')[1];
  assert.equal(onayKutusu.checked, true);
  assert.equal(onayKutusu.disabled, true, 'zorunlu onay kapatılamaz');
  assert.equal(onayli.bul((o) => o.className === 'onay-etiket')[0].title, 'This action always asks for confirmation (it cannot be turned off).');

  await kaydet(sayfa);
  assert.match(bildirim(sayfa), /1 favorite was removed because of the safety rule\./);
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
  assert.ok(sayfa.cagrilar.some((c) => c[0] === 'favorileriKaydet'), 'engelli kayıt varken favoriler yeniden yazılır (ana süreç çıkarır)');
  assert.equal(sayfa.sunucu.favoriler.some((f) => f.entity_id === 'light.hallway'), false, 'engelli varlık sunucuda favori kalmaz');
  assert.equal(sayfa.oge('favoriSirasiListesi').bul((o) => o.className === 'sira-ad').some((o) => o.textContent === 'Hallway'), false, 'engelli varlık sıra panelinde yok');
});

test('Son dil önbelleği: ilk boyama doğru dilde; ana süreç farklı dil söylerse düzeltilir; geçersiz önbellek yok sayılır', async () => {
  // Önbellek İngilizce, ana süreç de İngilizce: sayfa betik çalışır çalışmaz (yanıt beklenmeden) İngilizce
  const hizli = sayfayiKur({ ayar: AYAR_EN, cihazlar: CIHAZLAR_EN, depo: { [DIL_ANAHTARI]: 'en' } });
  assert.equal(hizli.htmlDili(), 'en', 'ilk boyama önbellekteki dilde');
  assert.equal(hizli.oge('btnAyarlariKaydet').textContent, 'Save settings', 'metinler betik çalışır çalışmaz çevrilmiş');
  await akit();
  assert.equal(hizli.htmlDili(), 'en');
  assert.equal(hizli.oge('btnAyarlariKaydet').textContent, 'Save settings');

  // Önbellek İngilizce ama ana süreç artık Türkçe: sayfa Türkçeye düzelir ve önbellek güncellenir
  const eski = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' }, cihazlar: CIHAZLAR, depo: { [DIL_ANAHTARI]: 'en' } });
  assert.equal(eski.htmlDili(), 'tr');
  assert.equal(eski.depo.get(DIL_ANAHTARI), 'tr');
  assert.equal(eski.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  assert.deepEqual(ceviriOgeleriUyusuyor(eski, 'tr', JS_SAHIPLI), []);

  // Geçersiz önbellek değeri yok sayılır
  for (const kotu of ['fr', '', 'EN', '{}']) {
    const s = await acilmisSayfa({ ayar: { ...AYAR, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' }, cihazlar: CIHAZLAR, depo: { [DIL_ANAHTARI]: kotu } });
    assert.equal(s.htmlDili(), null, `önbellek "${kotu}" yok sayılır`);
    assert.equal(s.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  }
});

test('Ayar özeti alınamazsa ve dil bilgisi yoksa sayfa Türkçe kalır (eski ana süreç uyumu)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.htmlDili(), null);
  assert.equal(sayfa.oge('anahtarRozet').textContent, 'Şifreli Olarak Saklanıyor');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '3 favori seçili', 'güvenlik kuralına takılan favori sayıya katılmaz');
});
