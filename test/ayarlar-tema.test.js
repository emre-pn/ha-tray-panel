'use strict';

/**
 * Ayarlar > Görünüm bölümünün 1.4.0 "tema" alanları (src/ayarlar.js + ayarlar.html): metin boyutu ve yüksek karşıtlık (o-25), hazır tema ve
 * özel panel renkleri (o-29), animasyon ayarları (o-34). Sahte DOM (test/ayarlar-sahte.js); görsel görünüm denenmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { HTML, BETIK, AYAR, CIHAZLAR, akit, duzles, acilmisSayfa, gorunurMetinler } = require('./ayarlar-sahte');
const T = require('../src/lib/tema-renk');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonKayitYuku = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const sec = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'change' });
};
const isaretle = (oge, deger) => {
  oge.checked = deger;
  oge.dispatchEvent({ type: 'change' });
};
const gecersizMi = (oge) => oge.classList.contains('gecersiz') && oge.getAttribute('aria-invalid') === 'true';
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display === 'inline';
const secenekler = (kimlik) => [...new RegExp(`<select[^>]*id="${kimlik}"[^>]*>([\\s\\S]*?)</select>`).exec(HTML)[1].matchAll(/value="([^"]*)"/g)].map((m) => m[1]);

const TEMA_AYARI = {
  ...AYAR,
  metinOlcegi: 100, yuksekKarsitlik: false, panelTemasi: 'varsayilan', panelVurguRengi: '', panelArkaPlani: '',
  animasyonlar: false, animasyonGecisleri: true, havaEfekti: 'otomatik', mevsimEfekti: 'yok', hareketiAzalt: false,
};

test('HTML: tema alanlarının kimlikleri var; seçenek kümeleri çekirdekle aynı; renk kutuları 7 karakter; çevrilebilir metinler data-i18n\'li', () => {
  for (const kimlik of [
    'metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelVurguSecici', 'btnPanelVurguSifirla', 'panelVurguHata',
    'panelArkaPlani', 'panelArkaSecici', 'btnPanelArkaSifirla', 'panelArkaHata', 'temaOnizleme', 'temaKontrast',
    'animasyonlar', 'animasyonGecisleri', 'havaEfekti', 'mevsimEfekti', 'hareketiAzalt',
  ]) assert.match(HTML, new RegExp(`id="${kimlik}"`), kimlik);
  const G = require('../src/lib/gorunum');
  assert.deepEqual(secenekler('metinOlcegi').map(Number), [...G.METIN_OLCEKLERI]);
  assert.deepEqual(secenekler('panelTemasi'), [...G.HAZIR_TEMA_ADLARI]);
  assert.deepEqual(secenekler('havaEfekti'), [...G.HAVA_EFEKTI_DEGERLERI]);
  assert.deepEqual(secenekler('mevsimEfekti'), [...G.MEVSIM_EFEKTI_DEGERLERI]);
  assert.match(HTML, /id="panelVurguRengi"[^>]*maxlength="7"/);
  assert.match(HTML, /id="panelArkaPlani"[^>]*maxlength="7"/);
  assert.match(HTML, /<input type="color" id="panelVurguSecici"[^>]*aria-label=/);
  assert.match(HTML, /<input type="color" id="panelArkaSecici"[^>]*aria-label=/);
  assert.match(HTML, /id="temaKontrast"[^>]*role="status"/);
  assert.match(HTML, /id="temaOnizleme"[^>]*aria-hidden="true"/, 'önizleme süstür: ekran okuyucuya yalnız kontrast metni okunur');
  // bölümde yer alırlar
  const gorunum = HTML.slice(HTML.indexOf('id="bolumGorunum"'), HTML.indexOf('id="bolumAnahtar"'));
  for (const kimlik of ['metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'animasyonlar', 'hareketiAzalt']) assert.match(gorunum, new RegExp(`id="${kimlik}"`), `${kimlik} Görünüm bölümünde`);
});

test('açılış: kayıtlı tema ayarları alanlara yazılır; kirli gösterge çıkmaz', async () => {
  const sayfa = await acilmisSayfa({
    ayar: {
      ...TEMA_AYARI, metinOlcegi: 130, yuksekKarsitlik: true, panelTemasi: 'orman', panelVurguRengi: '#ff0066', panelArkaPlani: '#112233',
      animasyonlar: true, animasyonGecisleri: false, havaEfekti: 'kar', mevsimEfekti: 'ilkbahar', hareketiAzalt: true, temaZorla: 'acik',
    },
    cihazlar: CIHAZLAR,
  });
  assert.equal(sayfa.oge('metinOlcegi').value, '130');
  assert.equal(sayfa.oge('yuksekKarsitlik').checked, true);
  assert.equal(sayfa.oge('panelTemasi').value, 'orman');
  assert.equal(sayfa.oge('panelVurguRengi').value, '#ff0066');
  assert.equal(sayfa.oge('panelVurguSecici').value, '#ff0066', 'renk seçici metinle eşlenir');
  assert.equal(sayfa.oge('panelArkaPlani').value, '#112233');
  assert.equal(sayfa.oge('panelArkaSecici').value, '#112233');
  assert.equal(sayfa.oge('animasyonlar').checked, true);
  assert.equal(sayfa.oge('animasyonGecisleri').checked, false);
  assert.equal(sayfa.oge('havaEfekti').value, 'kar');
  assert.equal(sayfa.oge('mevsimEfekti').value, 'ilkbahar');
  assert.equal(sayfa.oge('hareketiAzalt').checked, true);
  assert.equal(sayfa.oge('temaZorla').value, 'acik');
  assert.equal(kirliMi(sayfa), false);
});

test('açılış: eski ayar (alanlar yok) çökmez; varsayılanlar gösterilir, animasyonlar KAPALI', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('metinOlcegi').value, '100');
  assert.equal(sayfa.oge('yuksekKarsitlik').checked, false);
  assert.equal(sayfa.oge('panelTemasi').value, 'varsayilan');
  assert.equal(sayfa.oge('panelVurguRengi').value, '');
  assert.equal(sayfa.oge('panelArkaPlani').value, '');
  assert.equal(sayfa.oge('animasyonlar').checked, false);
  assert.equal(sayfa.oge('animasyonGecisleri').checked, true);
  assert.equal(sayfa.oge('havaEfekti').value, 'otomatik');
  assert.equal(sayfa.oge('mevsimEfekti').value, 'yok');
  assert.equal(sayfa.oge('hareketiAzalt').checked, false);
  assert.equal(kirliMi(sayfa), false);
  const bozuk = await acilmisSayfa({
    ayar: { ...AYAR, metinOlcegi: 77, yuksekKarsitlik: 'x', panelTemasi: 'kasirga', panelVurguRengi: 5, panelArkaPlani: 'kırmızı', animasyonlar: 'evet', havaEfekti: 'dolu', mevsimEfekti: {}, hareketiAzalt: 1 },
    cihazlar: CIHAZLAR,
  });
  assert.equal(bozuk.oge('metinOlcegi').value, '100');
  assert.equal(bozuk.oge('panelTemasi').value, 'varsayilan');
  assert.equal(bozuk.oge('panelVurguRengi').value, '');
  assert.equal(bozuk.oge('panelArkaPlani').value, '');
  assert.equal(bozuk.oge('animasyonlar').checked, false);
  assert.equal(bozuk.oge('havaEfekti').value, 'otomatik');
  assert.equal(bozuk.oge('mevsimEfekti').value, 'yok');
});

test('kayıt: tema alanları yükte gider ve kayıttan sonra gösterge kapanır; her alan değişince kirli olur', async () => {
  const sayfa = await acilmisSayfa({ ayar: TEMA_AYARI, cihazlar: CIHAZLAR });
  const degisimler = [
    () => sec(sayfa.oge('metinOlcegi'), '115'),
    () => isaretle(sayfa.oge('yuksekKarsitlik'), true),
    () => sec(sayfa.oge('panelTemasi'), 'lavanta'),
    () => yaz(sayfa.oge('panelVurguRengi'), '#aa00ff'),
    () => yaz(sayfa.oge('panelArkaPlani'), '#101020'),
    () => isaretle(sayfa.oge('animasyonlar'), true),
    () => isaretle(sayfa.oge('animasyonGecisleri'), false),
    () => sec(sayfa.oge('havaEfekti'), 'yagmur'),
    () => sec(sayfa.oge('mevsimEfekti'), 'otomatik'),
    () => isaretle(sayfa.oge('hareketiAzalt'), true),
  ];
  const geriAl = [
    () => sec(sayfa.oge('metinOlcegi'), '100'),
    () => isaretle(sayfa.oge('yuksekKarsitlik'), false),
    () => sec(sayfa.oge('panelTemasi'), 'varsayilan'),
    () => yaz(sayfa.oge('panelVurguRengi'), ''),
    () => yaz(sayfa.oge('panelArkaPlani'), ''),
    () => isaretle(sayfa.oge('animasyonlar'), false),
    () => isaretle(sayfa.oge('animasyonGecisleri'), true),
    () => sec(sayfa.oge('havaEfekti'), 'otomatik'),
    () => sec(sayfa.oge('mevsimEfekti'), 'yok'),
    () => isaretle(sayfa.oge('hareketiAzalt'), false),
  ];
  degisimler.forEach((degistir, i) => {
    degistir();
    assert.equal(kirliMi(sayfa), true, `değişiklik ${i} kirli yapar`);
    geriAl[i]();
    assert.equal(kirliMi(sayfa), false, `değişiklik ${i} geri alınınca temiz`);
  });
  degisimler.forEach((d) => d());
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  const yuk = sonKayitYuku(sayfa);
  assert.deepEqual(
    ['metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelArkaPlani', 'animasyonlar', 'animasyonGecisleri', 'havaEfekti', 'mevsimEfekti', 'hareketiAzalt'].map((ad) => yuk[ad]),
    [115, true, 'lavanta', '#aa00ff', '#101020', true, false, 'yagmur', 'otomatik', true],
  );
  assert.equal(typeof yuk.metinOlcegi, 'number', 'metin ölçeği sayı olarak gider');
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra gösterge kapanır');
  assert.equal(sayfa.sunucu.metinOlcegi, 115);
  assert.equal(sayfa.sunucu.animasyonlar, true);
});

test('o-29 renk kutuları: geçerli renk seçiciyle eşlenir, geçersiz renk işaretlenir ve hata söyler, sıfırla temizler; seçici metne yazar', async () => {
  const sayfa = await acilmisSayfa({ ayar: TEMA_AYARI, cihazlar: CIHAZLAR });
  for (const [metin, secici, sifirla, hata] of [
    ['panelVurguRengi', 'panelVurguSecici', 'btnPanelVurguSifirla', 'panelVurguHata'],
    ['panelArkaPlani', 'panelArkaSecici', 'btnPanelArkaSifirla', 'panelArkaHata'],
  ]) {
    yaz(sayfa.oge(metin), '#FF0000');
    assert.equal(sayfa.oge(secici).value, '#ff0000');
    assert.equal(gecersizMi(sayfa.oge(metin)), false);
    yaz(sayfa.oge(metin), 'kırmızı');
    assert.ok(gecersizMi(sayfa.oge(metin)), `${metin} geçersiz işaretli`);
    assert.match(sayfa.oge(hata).textContent, /#rrggbb/);
    assert.equal(sayfa.oge(hata).style.display, 'block');
    yaz(sayfa.oge(metin), '#12');
    assert.ok(gecersizMi(sayfa.oge(metin)), 'kısa renk geçersiz');
    sayfa.oge(secici).value = '#00ff88';
    sayfa.oge(secici).dispatchEvent({ type: 'input' });
    assert.equal(sayfa.oge(metin).value, '#00ff88');
    assert.equal(gecersizMi(sayfa.oge(metin)), false, 'seçiciyle düzelince işaret kalkar');
    assert.equal(sayfa.oge(hata).style.display, 'none');
    assert.equal(kirliMi(sayfa), true);
    sayfa.oge(sifirla).dispatchEvent({ type: 'click' });
    assert.equal(sayfa.oge(metin).value, '');
    assert.equal(gecersizMi(sayfa.oge(metin)), false);
  }
  assert.equal(kirliMi(sayfa), false, 'iki alan da sıfırlanınca temiz');
});

test('o-29 renk kutuları: sunucu geçersiz rengi reddederse yazılan değer ve işaret kalır, neden söylenir', async () => {
  const sayfa = await acilmisSayfa({
    ayar: TEMA_AYARI,
    cihazlar: CIHAZLAR,
    ayarKaydetYaniti: (yuk, sunucu) => {
      sunucu.metinOlcegi = yuk.metinOlcegi; // geri kalanı kabul edilir
      return { ok: true, uyarilar: [{ alan: 'panelVurguRengi', mesaj: 'Bu alan için geçersiz bir değer gönderildi; önceki değer korundu.' }] };
    },
  });
  yaz(sayfa.oge('panelVurguRengi'), '#abcdef');
  await kaydet(sayfa);
  assert.equal(sayfa.oge('panelVurguRengi').value, '#abcdef', 'yazılan değer kalır');
  assert.ok(gecersizMi(sayfa.oge('panelVurguRengi')));
  assert.match(sayfa.oge('panelVurguHata').textContent, /geçersiz/);
});

test('o-29 önizleme: seçime göre paleti tema-renk.js üretir; metin kontrastı 4,5:1 altına düşmez ve yazılır', async () => {
  const sayfa = await acilmisSayfa({ ayar: TEMA_AYARI, cihazlar: CIHAZLAR });
  const degiskenler = () => sayfa.oge('temaOnizleme').style.degiskenler ?? {};
  assert.equal(degiskenler()['--bg'], T.paletUret({ sema: 'koyu' }).degiskenler['--bg'], 'varsayılan: koyu varsayılan palet');
  assert.match(sayfa.oge('temaKontrast').textContent, /^Önizleme metin kontrastı: \d,\d:1 \(en az 4,5:1 gerekir\)\.$/);

  sec(sayfa.oge('panelTemasi'), 'okyanus');
  assert.equal(degiskenler()['--bg'], T.paletUret({ sema: 'koyu', tema: 'okyanus' }).degiskenler['--bg']);
  assert.equal(degiskenler()['--vurgu'], T.paletUret({ sema: 'koyu', tema: 'okyanus' }).degiskenler['--vurgu']);

  sec(sayfa.oge('temaZorla'), 'acik');
  assert.equal(degiskenler()['--bg'], T.paletUret({ sema: 'acik', tema: 'okyanus' }).degiskenler['--bg'], 'tema seçimi paleti açık yapar');

  // aşırı seçimler okunur tona çekilir
  yaz(sayfa.oge('panelArkaPlani'), '#808080');
  yaz(sayfa.oge('panelVurguRengi'), '#808080');
  const d = degiskenler();
  assert.ok(T.kontrast(d['--metin'], d['--bg']) >= 4.5);
  assert.ok(T.kontrast(d['--soluk'], d['--karo']) >= 4.5);
  assert.ok(T.kontrast(d['--rozet-metin'], d['--vurgu']) >= 4.5);
  const oran = Number(/(\d),(\d):1/.exec(sayfa.oge('temaKontrast').textContent).slice(1, 3).join('.'));
  assert.ok(oran >= 4.5, `yazılan oran ${oran}`);

  // geçersiz renk yok sayılır (önizleme son geçerli paletle değil, o alan olmadan üretilir)
  yaz(sayfa.oge('panelArkaPlani'), 'kırmızı');
  assert.equal(degiskenler()['--bg'], T.paletUret({ sema: 'acik', tema: 'okyanus', vurgu: '#808080' }).degiskenler['--bg']);

  // yüksek karşıtlık: özel renkler önizlemeden kalkar ve açıklama değişir
  isaretle(sayfa.oge('yuksekKarsitlik'), true);
  assert.deepEqual(degiskenler(), {});
  assert.equal(sayfa.oge('temaKontrast').textContent, 'Yüksek karşıtlık açık: özel panel renkleri kullanılmaz.');
  isaretle(sayfa.oge('yuksekKarsitlik'), false);
  assert.ok(degiskenler()['--bg']);
});

test('o-29 önizleme: "Windows temasını izle" seçiliyken Windows\'un açık/koyu teması önizlemeyi belirler', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...TEMA_AYARI, temaZorla: 'sistem' }, cihazlar: CIHAZLAR });
  assert.equal(sayfa.oge('temaOnizleme').style.degiskenler['--bg'], T.paletUret({ sema: 'koyu' }).degiskenler['--bg'], 'sahte ortamda matchMedia yok: koyu');
});

test('o-29 önizleme: İngilizcede kontrast metni İngilizce ve noktalı ondalıktır', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...TEMA_AYARI, dil: 'en', dilAyari: 'en' }, cihazlar: CIHAZLAR });
  assert.match(sayfa.oge('temaKontrast').textContent, /^Preview text contrast: \d\.\d:1 \(at least 4\.5:1 is required\)\.$/);
  isaretle(sayfa.oge('yuksekKarsitlik'), true);
  assert.equal(sayfa.oge('temaKontrast').textContent, 'High contrast is on: custom panel colors are not used.');
});

test('o-25 yüksek karşıtlık: Ayarlar penceresi de hemen opak/yüksek karşıtlıklı olur (<html data-karsitlik>) ve kapanınca kalkar', async () => {
  const sayfa = await acilmisSayfa({ ayar: TEMA_AYARI, cihazlar: CIHAZLAR });
  assert.equal(sayfa.htmlOzelligi('data-karsitlik'), null);
  isaretle(sayfa.oge('yuksekKarsitlik'), true);
  assert.equal(sayfa.htmlOzelligi('data-karsitlik'), '1');
  isaretle(sayfa.oge('yuksekKarsitlik'), false);
  assert.equal(sayfa.htmlOzelligi('data-karsitlik'), null);
  const kayitli = await acilmisSayfa({ ayar: { ...TEMA_AYARI, yuksekKarsitlik: true }, cihazlar: CIHAZLAR });
  assert.equal(kayitli.htmlOzelligi('data-karsitlik'), '1', 'kayıtlı ayarla açılır');
  assert.match(HTML, /:root\[data-karsitlik\]\s*\{/);
});

test('o-25 metin boyutu: Ayarlar penceresi seçimle hemen büyür; Ctrl +/-/0 ile çarpılır; kayıtlı yakınlaştırma korunur', async () => {
  const sayfa = await acilmisSayfa({ ayar: TEMA_AYARI, cihazlar: CIHAZLAR });
  assert.equal(sayfa.yakinlastirma(), undefined, 'varsayılan: hiçbir şey yazılmaz');
  sec(sayfa.oge('metinOlcegi'), '130');
  assert.equal(sayfa.yakinlastirma(), '1.3');
  sec(sayfa.oge('metinOlcegi'), '150');
  assert.equal(sayfa.yakinlastirma(), '1.5');
  const bas = (alanlar) => sayfa.belgeTusu({ ctrlKey: true, ...alanlar });
  bas({ key: '+' }); // adım 1.1 x 1.5
  assert.equal(sayfa.yakinlastirma(), '1.65');
  bas({ key: '0' });
  assert.equal(sayfa.yakinlastirma(), '1.5', 'sıfırla metin boyutuna döner');
  sec(sayfa.oge('metinOlcegi'), '100');
  assert.equal(sayfa.yakinlastirma(), '1', 'ölçek %100 olunca yakınlaştırma 1');

  const kayitli = await acilmisSayfa({ ayar: { ...TEMA_AYARI, metinOlcegi: 115 }, cihazlar: CIHAZLAR });
  assert.equal(kayitli.yakinlastirma(), '1.15', 'kayıtlı ayarla açılır');
  const ikisi = await acilmisSayfa({ ayar: { ...TEMA_AYARI, metinOlcegi: 130 }, cihazlar: CIHAZLAR, depo: { 'evPaneli.ayarlar.yakinlastirma': '4' } });
  assert.equal(ikisi.yakinlastirma(), '1.625', 'önceki Ctrl+ seçimi (1,25) x 130%');
});

test('o-34 animasyonlar: ana anahtar kapalıyken alt seçenekler pasif (değerleri korunur); "Hareketi azalt" her zaman açık', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...TEMA_AYARI, havaEfekti: 'kar', mevsimEfekti: 'kis' }, cihazlar: CIHAZLAR });
  for (const kimlik of ['animasyonGecisleri', 'havaEfekti', 'mevsimEfekti']) assert.equal(sayfa.oge(kimlik).disabled, true, `${kimlik} pasif`);
  assert.equal(sayfa.oge('hareketiAzalt').disabled, false);
  assert.equal(sayfa.oge('animasyonlar').disabled, false);
  isaretle(sayfa.oge('animasyonlar'), true);
  for (const kimlik of ['animasyonGecisleri', 'havaEfekti', 'mevsimEfekti']) assert.equal(sayfa.oge(kimlik).disabled, false, `${kimlik} etkin`);
  isaretle(sayfa.oge('animasyonlar'), false);
  assert.equal(sayfa.oge('havaEfekti').disabled, true);
  assert.equal(sayfa.oge('havaEfekti').value, 'kar', 'değer korunur');
  await kaydet(sayfa);
  assert.equal(sonKayitYuku(sayfa).havaEfekti, 'kar', 'pasif alanların değeri de kayda gider');
  assert.equal(sonKayitYuku(sayfa).animasyonlar, false);
});

test('tema: içe aktarma sonrası tema alanları yeni ayarlara döner; bu pencere de yüksek karşıtlık ve metin boyutunu yeniden uygular', async () => {
  const sayfa = await acilmisSayfa({
    ayar: TEMA_AYARI,
    cihazlar: CIHAZLAR,
    aktarimYaniti: {
      icesonrasi: (sunucu) => Object.assign(sunucu, { metinOlcegi: 150, yuksekKarsitlik: true, panelTemasi: 'grafit', animasyonlar: true, havaEfekti: 'gunes' }),
    },
  });
  yaz(sayfa.oge('panelArkaPlani'), '#102030'); // kaydedilmemiş düzenleme: içe aktarma onayı sorulur (confirm: evet)
  sayfa.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.oge('metinOlcegi').value, '150');
  assert.equal(sayfa.oge('yuksekKarsitlik').checked, true);
  assert.equal(sayfa.oge('panelTemasi').value, 'grafit');
  assert.equal(sayfa.oge('animasyonlar').checked, true);
  assert.equal(sayfa.oge('havaEfekti').value, 'gunes');
  assert.equal(sayfa.oge('panelArkaPlani').value, '', 'içe aktarma özel rengi de yeni ayarlara döndürür');
  assert.equal(sayfa.htmlOzelligi('data-karsitlik'), '1');
  assert.equal(sayfa.yakinlastirma(), '1.5');
  assert.equal(kirliMi(sayfa), false);
});

test('tema: tüm görünür metinler Türkçe (varsayılan) ve İngilizcede Türkçe harf kalmaz; yeni alanlar etiketli', async () => {
  // Türkçe varsayılan metin HTML'dedir (sözlükle birebir aynılığını test/ayarlar-dil.test.js denetler)
  assert.match(HTML, /id="okunurBaslik" data-i18n="ayar\.okunur\.baslik">Okunabilirlik</);
  assert.match(HTML, /data-i18n="ayar\.okunur\.karsitlik">Yüksek karşıtlık</);
  const en = await acilmisSayfa({ ayar: { ...TEMA_AYARI, dil: 'en', dilAyari: 'en' }, cihazlar: CIHAZLAR });
  const yeniDilMetni = gorunurMetinler(en)
    .filter(([tanim]) => /^(temaKontrast|okunurBaslik|panelRenkBaslik|animBaslik|metinOlcegi|panelTemasi|havaEfekti|mevsimEfekti|panelVurguSecici|panelArkaSecici)/.test(tanim))
    .map(([, m]) => m);
  assert.ok(yeniDilMetni.length >= 6, 'yeni alanların görünür metinleri bulundu');
  for (const m of yeniDilMetni) assert.doesNotMatch(m, /[çğıöşüÇĞİÖŞÜ]/, `İngilizcede Türkçe harf yok: ${m}`);
  assert.equal(en.oge('okunurBaslik').textContent, 'Readability');
  assert.equal(en.oge('animBaslik').textContent, 'Animations');
  assert.equal(en.oge('panelVurguSecici').getAttribute('aria-label'), 'Panel accent color picker');
});

test('değişmez: ayarlar.js tema alanlarını yalnız textContent/değer/öznitelikle yazar (innerHTML yok) ve ağ API\'si kullanmaz', () => {
  assert.doesNotMatch(BETIK, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.doesNotMatch(BETIK, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});
