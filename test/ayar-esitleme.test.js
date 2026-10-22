'use strict';

/**
 * Klasör tabanlı ayar eşitleme çekirdeği (o-58): bölüm tablosu, özet, birleştirme kararı, dosya biçimi (düz ve parolalı), uzak bölümün doğrulanması.
 * Saf modüller: dosya sistemi, ağ ve Electron yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { AYAR_ALANLARI } = require('../src/lib/ayar-alanlari');
const { AKTARILAN_ALANLAR } = require('../src/lib/ayar-yedegi');
const { BOLUMLER, BOLUM_ADLARI, klasorYoluDuzelt, bolumListesiDuzelt, durumDuzelt } = require('../src/lib/esitleme-bolumleri');
const { sifreleyiciOlustur, parolaGecerliMi, SCRYPT } = require('../src/lib/esitleme-sifre');
const E = require('../src/lib/ayar-esitleme');
const VARSAYILAN = require('../varsayilan-ayarlar.json');

const AYGIT_A = 'aaaaaaaaaaaaaaaa';
const AYGIT_B = 'bbbbbbbbbbbbbbbb';
const SIMDI = 1_800_000_000_000;
const ayarlarYap = (ek = {}) => ayarlariDuzelt({ ...VARSAYILAN, ...ek }, { varsayilan: VARSAYILAN }).ayarlar;
const gizliJeton = () => `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;

// ---------------------------------------------------------------------------------------------------------------------------
// Bölüm tablosu ve ayar alanları
// ---------------------------------------------------------------------------------------------------------------------------

test('bölüm tablosu: her alan dışa aktarılabilir bir alandır, bölümler ayrıktır, adres ve makineye özgü alanlar listede yoktur', () => {
  assert.deepEqual([...BOLUM_ADLARI], ['favoriler', 'kisayollar', 'gorunum', 'bilgi', 'bildirim']);
  const gorulen = new Set();
  for (const [bolum, alanlar] of Object.entries(BOLUMLER)) {
    assert.ok(alanlar.length > 0, bolum);
    for (const alan of alanlar) {
      assert.ok(AKTARILAN_ALANLAR.includes(alan), `${alan}: aktarılabilir alan değil`);
      assert.equal(gorulen.has(alan), false, `${alan}: iki bölümde`);
      gorulen.add(alan);
    }
  }
  for (const yasak of ['yerelAdres', 'disAdres', 'otomatikBaslat', 'canliBaglanti', 'surumDenetimi', 'klasorEsitleme', 'esitlemeKlasoru', 'esitlemeBolumleri', 'esitlemeDurumu', 'pencereKonumlari', 'tercihEkran', 'masaustuKaroKonumlari', 'dil', 'hazirListeSurumu', 'semaSurumu']) {
    assert.equal(gorulen.has(yasak), false, `${yasak}: eşitlenmemeli`);
  }
  // Dışa aktarmaya girmeyen (aktarilir: false) hiçbir alan eşitlenmez.
  for (const alan of AYAR_ALANLARI.filter((a) => !a.aktarilir)) assert.equal(gorulen.has(alan.ad), false, `${alan.ad}: aktarılmayan alan eşitlenmez`);
});

test('ayar alanları: eşitleme varsayılan KAPALI, klasör boş, tüm bölümler seçili; hiçbiri dışa/içe aktarmaya ya da Ayarlar özetine girmez', () => {
  const alan = (ad) => AYAR_ALANLARI.find((a) => a.ad === ad);
  assert.equal(alan('klasorEsitleme').varsayilan, false);
  assert.equal(alan('esitlemeKlasoru').varsayilan, '');
  assert.deepEqual([...alan('esitlemeBolumleri').varsayilan], [...BOLUM_ADLARI]);
  assert.deepEqual(alan('esitlemeDurumu').varsayilan, {});
  for (const ad of ['klasorEsitleme', 'esitlemeKlasoru', 'esitlemeBolumleri', 'esitlemeDurumu']) {
    assert.equal(alan(ad).aktarilir, false, `${ad} aktarılmaz`);
    assert.equal(alan(ad).ozette, false, `${ad} özette yok`);
    assert.equal(AKTARILAN_ALANLAR.includes(ad), false);
  }
  const duzgun = ayarlarYap();
  assert.equal(duzgun.klasorEsitleme, false);
  assert.equal(duzgun.esitlemeKlasoru, '');
});

test('doğrulayıcılar: klasör yolu mutlak ve kısa; bölüm listesi bilinen adlarla sınırlı; durum kaydı yalnız geçerli girdileri tutar', () => {
  assert.equal(klasorYoluDuzelt('C:\\Users\\ben\\Dropbox\\EvPaneli'), 'C:\\Users\\ben\\Dropbox\\EvPaneli');
  assert.equal(klasorYoluDuzelt('  D:\\Esitle  '), 'D:\\Esitle');
  assert.equal(klasorYoluDuzelt('\\\\nas\\paylasim\\ev'), '\\\\nas\\paylasim\\ev');
  assert.equal(klasorYoluDuzelt(''), '');
  for (const kotu of ['goreli\\yol', '..\\x', 'C:\\a\u0000b', 'C:\\a\nb', `C:\\${'a'.repeat(500)}`, 5, null, {}, ['C:\\a']]) assert.equal(klasorYoluDuzelt(kotu), undefined, String(kotu).slice(0, 20));

  assert.deepEqual(bolumListesiDuzelt(['bilgi', 'favoriler', 'favoriler', 'x', 5, '__proto__']), ['favoriler', 'bilgi']);
  assert.deepEqual(bolumListesiDuzelt([]), []);
  assert.equal(bolumListesiDuzelt('favoriler'), undefined);

  const ozet = 'a'.repeat(32);
  assert.deepEqual(durumDuzelt({ aygit: AYGIT_A, bolumler: { gorunum: { ozet, zaman: 5, aygit: AYGIT_B }, kotu: { ozet, zaman: 1, aygit: AYGIT_A }, bilgi: { ozet: 'xyz', zaman: 1, aygit: AYGIT_A }, bildirim: { ozet, zaman: -1, aygit: AYGIT_A } } }), { aygit: AYGIT_A, bolumler: { gorunum: { ozet, zaman: 5, aygit: AYGIT_B } } });
  assert.deepEqual(durumDuzelt({ aygit: 'kisa' }), {});
  assert.equal(durumDuzelt([]), undefined);
  assert.equal(durumDuzelt('x'), undefined);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Özet ve anlık görüntü
// ---------------------------------------------------------------------------------------------------------------------------

test('özet: anahtar sırasından bağımsız, içerik değişince değişir; bölüm anlığı yalnız bölümün alanlarını taşır', () => {
  assert.equal(E.ozetle({ a: 1, b: [1, 2], c: { x: 1, y: 2 } }), E.ozetle({ c: { y: 2, x: 1 }, b: [1, 2], a: 1 }));
  assert.notEqual(E.ozetle({ a: 1 }), E.ozetle({ a: 2 }));
  assert.notEqual(E.ozetle({ b: [1, 2] }), E.ozetle({ b: [2, 1] }));
  assert.match(E.ozetle({}), /^[0-9a-f]{32}$/);

  const a = ayarlarYap({ temaZorla: 'acik', yerelAdres: 'http://192.168.1.77:8123', favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }] });
  const gorunum = E.bolumAnlik(a, 'gorunum');
  assert.equal(gorunum.temaZorla, 'acik');
  assert.deepEqual(Object.keys(gorunum).filter((k) => !BOLUMLER.gorunum.includes(k)), []);
  const favoriler = E.bolumAnlik(a, 'favoriler');
  assert.deepEqual(favoriler.favoriler, [{ entity_id: 'light.salon', ad: 'Salon' }]);
  assert.equal(JSON.stringify(E.bolumAnlik(a, 'favoriler')).includes('192.168.1.77'), false, 'adres hiçbir bölümde yok');
  for (const ad of BOLUM_ADLARI) assert.equal(JSON.stringify(E.bolumAnlik(a, ad)).includes('192.168.1.77'), false);
  assert.deepEqual(E.bolumAnlik(a, 'olmayan'), {});
});

// ---------------------------------------------------------------------------------------------------------------------------
// Birleştirme kararı
// ---------------------------------------------------------------------------------------------------------------------------

test('birleştirme kararı: klasörde bölüm yoksa yerel yazılır; kayıt yoksa damga şimdidir', () => {
  const k = E.bolumKarari({ durum: null, ozetL: 'L', uzak: null, ozetU: null, simdi: 100, aygit: AYGIT_A });
  assert.deepEqual(k, { eylem: 'yaz', durum: { ozet: 'L', zaman: 100, aygit: AYGIT_A } });
  const kayitli = { ozet: 'L', zaman: 50, aygit: AYGIT_A };
  assert.deepEqual(E.bolumKarari({ durum: kayitli, ozetL: 'L', uzak: null, ozetU: null, simdi: 100, aygit: AYGIT_A }), { eylem: 'yaz', durum: kayitli });
});

test('birleştirme kararı: yerel değişince damga mantıksal saatle ilerler (en az son damga + 1); uzaktan yeni değilse yerel yazılır', () => {
  const durum = { ozet: 'ESKI', zaman: 5_000, aygit: AYGIT_B };
  const uzak = { zaman: 4_000, aygit: AYGIT_B };
  const saatGeride = E.bolumKarari({ durum, ozetL: 'YENI', uzak, ozetU: 'U', simdi: 1_000, aygit: AYGIT_A });
  assert.equal(saatGeride.eylem, 'yaz');
  assert.deepEqual(saatGeride.durum, { ozet: 'YENI', zaman: 5_001, aygit: AYGIT_A }, 'yerel saat geride olsa da son görülen damganın ardına geçer');
  const normal = E.bolumKarari({ durum, ozetL: 'YENI', uzak, ozetU: 'U', simdi: 9_000, aygit: AYGIT_A });
  assert.deepEqual(normal.durum, { ozet: 'YENI', zaman: 9_000, aygit: AYGIT_A });
});

test('birleştirme kararı: uzak sürüm KESİN daha yeniyse uygulanır; eşit damgada aygit kimliği büyük olan kazanır (iki bilgisayar aynı sonuca varır)', () => {
  const durum = { ozet: 'L', zaman: 1_000, aygit: AYGIT_A };
  const yeniUzak = E.bolumKarari({ durum, ozetL: 'L', uzak: { zaman: 2_000, aygit: AYGIT_B }, ozetU: 'U', simdi: 3_000, aygit: AYGIT_A });
  assert.deepEqual(yeniUzak, { eylem: 'uygula', durum: { ozet: 'U', zaman: 2_000, aygit: AYGIT_B } });
  const eskiUzak = E.bolumKarari({ durum, ozetL: 'L', uzak: { zaman: 500, aygit: AYGIT_B }, ozetU: 'U', simdi: 3_000, aygit: AYGIT_A });
  assert.equal(eskiUzak.eylem, 'yaz');
  // Eşit damga: A'nın kimliği B'ninkinden küçük -> A'da uzak (B) kazanır, B'de yerel kazanır.
  const aTarafi = E.bolumKarari({ durum: { ozet: 'L', zaman: 1_000, aygit: AYGIT_A }, ozetL: 'L', uzak: { zaman: 1_000, aygit: AYGIT_B }, ozetU: 'U', simdi: 3_000, aygit: AYGIT_A });
  const bTarafi = E.bolumKarari({ durum: { ozet: 'U', zaman: 1_000, aygit: AYGIT_B }, ozetL: 'U', uzak: { zaman: 1_000, aygit: AYGIT_A }, ozetU: 'L', simdi: 3_000, aygit: AYGIT_B });
  assert.equal(aTarafi.eylem, 'uygula');
  assert.equal(bTarafi.eylem, 'yaz');
});

test('birleştirme kararı: ilk eşitlemede (kayıt yok) klasörde farklı sürüm varsa klasördeki alınır; aynıysa damga uzaktakine yetişir', () => {
  const uzak = { zaman: 7_000, aygit: AYGIT_B };
  assert.deepEqual(E.bolumKarari({ durum: null, ozetL: 'L', uzak, ozetU: 'U', simdi: 9_000, aygit: AYGIT_A }), { eylem: 'uygula', durum: { ozet: 'U', zaman: 7_000, aygit: AYGIT_B } });
  assert.deepEqual(E.bolumKarari({ durum: null, ozetL: 'ESIT', uzak, ozetU: 'ESIT', simdi: 9_000, aygit: AYGIT_A }), { eylem: 'yok', durum: { ozet: 'ESIT', zaman: 7_000, aygit: AYGIT_B } });
  // Yerel damga zaten daha yeniyse korunur
  const yerel = { ozet: 'ESIT', zaman: 8_000, aygit: AYGIT_A };
  assert.deepEqual(E.bolumKarari({ durum: yerel, ozetL: 'ESIT', uzak, ozetU: 'ESIT', simdi: 9_000, aygit: AYGIT_A }), { eylem: 'yok', durum: yerel });
});

test('birleştirme kararı: uzak bölüm geçersizse (özet yok) yerel sürüm onun yerine yazılır', () => {
  const durum = { ozet: 'L', zaman: 1_000, aygit: AYGIT_A };
  assert.equal(E.bolumKarari({ durum, ozetL: 'L', uzak: { zaman: 99_000, aygit: AYGIT_B }, ozetU: null, simdi: 3_000, aygit: AYGIT_A }).eylem, 'yaz');
});

test('birleştirme kararı: iki bilgisayar rastgele düzenleme dizisinde aynı bölüme yakınsar', () => {
  // Basit benzetim: iki bilgisayar, ortak "dosya"; her tur rastgele biri değiştirir, sonra ikisi sırayla eşitler.
  let tohum = 12345;
  const rastgele = () => {
    tohum = (tohum * 1103515245 + 12345) & 0x7fffffff;
    return tohum / 0x7fffffff;
  };
  for (let deneme = 0; deneme < 30; deneme += 1) {
    const makine = [
      { aygit: AYGIT_A, deger: 'v0', durum: null, saat: 1_000 + Math.floor(rastgele() * 5_000) },
      { aygit: AYGIT_B, deger: 'v0', durum: null, saat: 1_000 + Math.floor(rastgele() * 5_000) },
    ];
    let dosya = null; // { zaman, aygit, deger }
    const esitle = (m) => {
      const ozetL = E.ozetle({ d: m.deger });
      const uzak = dosya ? { zaman: dosya.zaman, aygit: dosya.aygit } : null;
      const k = E.bolumKarari({ durum: m.durum, ozetL, uzak, ozetU: dosya ? E.ozetle({ d: dosya.deger }) : null, simdi: m.saat, aygit: m.aygit });
      m.durum = k.durum;
      if (k.eylem === 'uygula') {
        m.deger = dosya.deger;
        m.durum = { ozet: E.ozetle({ d: m.deger }), zaman: dosya.zaman, aygit: dosya.aygit };
      } else if (k.eylem === 'yaz') dosya = { zaman: k.durum.zaman, aygit: k.durum.aygit, deger: m.deger };
    };
    for (let tur = 0; tur < 12; tur += 1) {
      const m = makine[rastgele() < 0.5 ? 0 : 1];
      m.saat += Math.floor(rastgele() * 3_000);
      if (rastgele() < 0.6) m.deger = `v${tur}-${m.aygit[0]}`;
      esitle(m);
      if (rastgele() < 0.5) esitle(makine[rastgele() < 0.5 ? 0 : 1]);
    }
    esitle(makine[0]);
    esitle(makine[1]);
    esitle(makine[0]);
    assert.equal(makine[0].deger, makine[1].deger, `deneme ${deneme}: yakınsamadı`);
    assert.equal(makine[0].deger, dosya.deger);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Uzak bölümün doğrulanması (içe aktarma hattı)
// ---------------------------------------------------------------------------------------------------------------------------

test('uzak bölüm: kapı/kilit/garaj favorileri süzülür, geçersiz değer atılır, bölüm dışı alanlar (adres, başka bölüm) alınmaz', () => {
  const ham = {
    favoriler: [
      { entity_id: 'light.salon', ad: 'Salon' },
      { entity_id: 'lock.on_kapi', ad: 'Ön kapı' },
      { entity_id: 'cover.garaj_kapisi', ad: 'Garaj kapısı' },
      { entity_id: 'switch.kapi_zili', ad: 'Kapı zili' },
      { entity_id: 'alarm_control_panel.ev', ad: 'Alarm' },
      { entity_id: 'siren.ev', ad: 'Siren' },
    ],
    panolar: [],
    yerelAdres: 'http://evil.example:8123', // bölüm dışı
    temaZorla: 'acik', // başka bölümün alanı
  };
  const sonuc = E.uzakBolumTemizle('favoriler', ham, { varsayilan: VARSAYILAN });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.cozum.ayarlar.favoriler.map((f) => f.entity_id), ['light.salon']);
  assert.deepEqual(Object.keys(sonuc.cozum.ayarlar).sort(), ['favoriler', 'panolar']);
  assert.equal(sonuc.anlik.favoriler.length, 1);
  assert.equal(JSON.stringify(sonuc).includes('evil.example'), false);

  const gorunum = E.uzakBolumTemizle('gorunum', { temaZorla: 'acik', vurguRengi: 'KOTU-RENK', metinOlcegi: 9999, yerelAdres: 'http://evil.example' }, { varsayilan: VARSAYILAN });
  assert.equal(gorunum.ok, true);
  assert.equal(gorunum.cozum.ayarlar.temaZorla, 'acik');
  assert.equal(gorunum.cozum.ayarlar.vurguRengi, '', 'geçersiz değer varsayılana döner');
  assert.equal(Object.hasOwn(gorunum.cozum.ayarlar, 'yerelAdres'), false);

  assert.equal(E.uzakBolumTemizle('gorunum', { yerelAdres: 'http://evil.example' }, { varsayilan: VARSAYILAN }).ok, false, 'bölümün hiçbir alanı yoksa geçersiz');
  assert.equal(E.uzakBolumTemizle('gorunum', 'x', {}).ok, false);
  assert.equal(E.uzakBolumTemizle('olmayan', { temaZorla: 'acik' }, {}).ok, false);
});

test('uzak bölüm: aynı içerik yerel anlık görüntüyle aynı özeti verir (temizleme döngü kurmaz)', () => {
  const yerel = ayarlarYap({ temaZorla: 'acik', favoriler: [{ entity_id: 'light.salon', ad: 'Salon', kisayol: 'Control+Alt+1' }], sayfalar: [] });
  const anlik = E.bolumAnlik(yerel, 'favoriler');
  const uzak = E.uzakBolumTemizle('favoriler', anlik, { varsayilan: VARSAYILAN });
  assert.equal(uzak.ok, true);
  assert.equal(uzak.ozet, E.ozetle(anlik));
});

// ---------------------------------------------------------------------------------------------------------------------------
// Dosya biçimi
// ---------------------------------------------------------------------------------------------------------------------------

const ornekBolumler = () => ({
  gorunum: { zaman: 1_700_000_000_000, aygit: AYGIT_A, ayarlar: { temaZorla: 'acik' } },
  favoriler: { zaman: 1_700_000_000_500, aygit: AYGIT_B, ayarlar: { favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }], panolar: [] } },
});

test('dosya (düz): yazılıp okunur; sır ve adres yok; bölüm başına damga, aygit ve özet; bilinmeyen bölüm korunur', async () => {
  const yazi = await E.dosyaMetni({ bolumler: ornekBolumler(), bilinmeyen: { gelecek: { zaman: 1_700_000_000_000, aygit: AYGIT_B, ayarlar: { x: 1 } } } });
  assert.equal(yazi.ok, true);
  const belge = JSON.parse(yazi.metin);
  assert.equal(belge.bicim, 'ev-paneli-ayar-esitleme');
  assert.equal(belge.surum, 1);
  assert.equal(belge.bolumler.gorunum.ozet, E.ozetle({ temaZorla: 'acik' }));
  assert.ok(yazi.metin.endsWith('\n'));
  const okunan = await E.dosyayiCoz(yazi.metin, { simdi: SIMDI });
  assert.equal(okunan.ok, true);
  assert.deepEqual(okunan.belge.bolumler.gorunum, { zaman: 1_700_000_000_000, aygit: AYGIT_A, ayarlar: { temaZorla: 'acik' } });
  assert.deepEqual(Object.keys(okunan.belge.bilinmeyen), ['gelecek']);
  assert.equal(okunan.belge.gecersiz, 0);
});

test('dosya (parolalı): zarf olarak yazılır, düz metin içermez; doğru parolayla okunur; parolasız/yanlış parolayla ve düz dosya parolalıyken reddedilir', async () => {
  const sifreleyici = sifreleyiciOlustur();
  const yazi = await E.dosyaMetni({ bolumler: ornekBolumler(), parola: 'dogru-parola-123', sifreleyici });
  assert.equal(yazi.ok, true);
  const zarf = JSON.parse(yazi.metin);
  assert.equal(zarf.sifreli, true);
  assert.equal(yazi.metin.includes('Salon'), false, 'içerik düz görünmez');
  assert.equal(yazi.metin.includes('dogru-parola'), false);
  assert.equal(zarf.N, SCRYPT.N);

  const iyi = await E.dosyayiCoz(yazi.metin, { parola: 'dogru-parola-123', sifreleyici, simdi: SIMDI });
  assert.equal(iyi.ok, true);
  assert.equal(iyi.belge.bolumler.favoriler.ayarlar.favoriler[0].ad, 'Salon');
  assert.deepEqual(await E.dosyayiCoz(yazi.metin, { parola: null, sifreleyici, simdi: SIMDI }), { ok: false, neden: 'parola-gerekli' });
  assert.deepEqual(await E.dosyayiCoz(yazi.metin, { parola: 'baska-parola-987', sifreleyici: sifreleyiciOlustur(), simdi: SIMDI }), { ok: false, neden: 'parola-yanlis' });

  const duz = await E.dosyaMetni({ bolumler: ornekBolumler() });
  assert.deepEqual(await E.dosyayiCoz(duz.metin, { parola: 'dogru-parola-123', sifreleyici, simdi: SIMDI }), { ok: false, neden: 'sifresiz' }, 'parola ayarlıyken düz dosya güvenilmez');

  // Bir bayt oynanırsa çözülmez
  const bozuk = { ...zarf, veri: `${zarf.veri.slice(0, 10)}${zarf.veri[10] === 'A' ? 'B' : 'A'}${zarf.veri.slice(11)}` };
  assert.equal((await E.dosyayiCoz(JSON.stringify(bozuk), { parola: 'dogru-parola-123', sifreleyici: sifreleyiciOlustur(), simdi: SIMDI })).neden, 'parola-yanlis');
  // Zayıflatılmış parametreler kabul edilmez
  const zayif = { ...zarf, N: 2 };
  assert.equal((await E.dosyayiCoz(JSON.stringify(zayif), { parola: 'dogru-parola-123', sifreleyici, simdi: SIMDI })).neden, 'bozuk');
});

test('dosya: aynı parolayla iki yazma farklı iv kullanır ve tuz önbelleği yeniden türetmeyi önler; parola kısa/denetim karakterliyse yazılmaz', async () => {
  const sifreleyici = sifreleyiciOlustur();
  const bir = JSON.parse((await E.dosyaMetni({ bolumler: ornekBolumler(), parola: 'dogru-parola-123', sifreleyici })).metin);
  const iki = JSON.parse((await E.dosyaMetni({ bolumler: ornekBolumler(), parola: 'dogru-parola-123', sifreleyici })).metin);
  assert.equal(bir.tuz, iki.tuz);
  assert.notEqual(bir.iv, iki.iv);
  assert.notEqual(bir.veri, iki.veri);
  assert.equal(parolaGecerliMi('kisa'), false);
  assert.equal(parolaGecerliMi('uzun-ama\nsatirli-parola'), false);
  assert.equal(parolaGecerliMi('x'.repeat(129)), false);
  assert.equal(parolaGecerliMi('gecerli-parola'), true);
  assert.deepEqual(await E.dosyaMetni({ bolumler: ornekBolumler(), parola: 'kisa', sifreleyici }), { ok: false, neden: 'parola-gecersiz' });
});

test('dosya: sır içeren dosya ne yazılır ne okunur; bozuk, çok büyük, daha yeni sürüm ve yanlış biçim ayrı nedenlerle reddedilir', async () => {
  const sizdiran = { gorunum: { zaman: 1, aygit: AYGIT_A, ayarlar: { vurguRengi: gizliJeton() } } };
  assert.deepEqual(await E.dosyaMetni({ bolumler: sizdiran }), { ok: false, neden: 'gizli-deger' });
  const govde = JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, semaSurumu: 6, bolumler: { gorunum: { zaman: 1, aygit: AYGIT_A, ayarlar: { vurguRengi: gizliJeton() } } } });
  assert.deepEqual(await E.dosyayiCoz(govde, { simdi: SIMDI }), { ok: false, neden: 'gizli-deger' });

  assert.equal((await E.dosyayiCoz('{bozuk', { simdi: SIMDI })).neden, 'bozuk');
  assert.equal((await E.dosyayiCoz('[]', { simdi: SIMDI })).neden, 'bozuk');
  assert.equal((await E.dosyayiCoz(JSON.stringify({ bicim: 'baska' }), { simdi: SIMDI })).neden, 'bozuk');
  assert.equal((await E.dosyayiCoz(JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, bolumler: 5 }), { simdi: SIMDI })).neden, 'bozuk');
  assert.equal((await E.dosyayiCoz('x'.repeat(600 * 1024), { simdi: SIMDI })).neden, 'cok-buyuk');
  assert.equal((await E.dosyayiCoz(JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 2, bolumler: {} }), { simdi: SIMDI })).neden, 'daha-yeni');
  assert.equal((await E.dosyayiCoz(JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, semaSurumu: 99, bolumler: {} }), { simdi: SIMDI })).neden, 'daha-yeni');
  assert.equal((await E.dosyayiCoz(`\uFEFF${JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, bolumler: {} })}`, { simdi: SIMDI })).ok, true, 'BOM kabul edilir');
});

test('dosya: geçersiz bölüm girdileri atılır; 24 saatten ileri damga, kötü aygit kimliği ve bölüm adları reddedilir', async () => {
  const tam = (bolumler) => JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, semaSurumu: 6, bolumler });
  const iyi = { zaman: SIMDI - 1_000, aygit: AYGIT_A, ayarlar: { temaZorla: 'acik' } };
  const sonuc = await E.dosyayiCoz(
    tam({
      gorunum: iyi,
      favoriler: { ...iyi, zaman: SIMDI + 2 * 24 * 3600 * 1000 }, // gelecek
      bilgi: { ...iyi, aygit: 'KOTU' },
      bildirim: { ...iyi, ayarlar: [] },
      kisayollar: { ...iyi, zaman: -1 },
      '__proto__': iyi,
      'Kotu Ad': iyi,
    }),
    { simdi: SIMDI },
  );
  assert.equal(sonuc.ok, true);
  assert.deepEqual(Object.keys(sonuc.belge.bolumler), ['gorunum']);
  assert.equal(sonuc.belge.gecersiz, 4);
  assert.deepEqual(Object.keys(sonuc.belge.bilinmeyen), []);
  assert.equal(Object.getPrototypeOf(sonuc.belge.bolumler), Object.prototype, 'prototip bozulmadı');
});

test('birleştirme: çakışma kopyaları dahil her bölüm için en yeni damgalı sürüm seçilir; eşit damgada aygit kimliği büyük olan', () => {
  const belge = (bolumler) => ({ bolumler, bilinmeyen: {}, gecersiz: 0 });
  const birlesik = E.belgeleriBirlestir([
    belge({ gorunum: { zaman: 100, aygit: AYGIT_A, ayarlar: { v: 'a' } }, bilgi: { zaman: 300, aygit: AYGIT_A, ayarlar: { v: 'a' } } }),
    belge({ gorunum: { zaman: 200, aygit: AYGIT_B, ayarlar: { v: 'b' } }, bilgi: { zaman: 300, aygit: AYGIT_B, ayarlar: { v: 'b' } } }),
    belge({ gorunum: { zaman: 150, aygit: AYGIT_A, ayarlar: { v: 'c' } } }),
  ]);
  assert.equal(birlesik.bolumler.gorunum.ayarlar.v, 'b');
  assert.equal(birlesik.bolumler.bilgi.ayarlar.v, 'b');
  assert.deepEqual(E.belgeleriBirlestir([]), { bolumler: {}, bilinmeyen: {} });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Klasör ve dosya adları
// ---------------------------------------------------------------------------------------------------------------------------

test('klasör doğrulama: mutlak yol gerekir; uygulamanın veri ve kurulum klasörleri ve altları yasaktır', () => {
  const veri = path.resolve('C:\\Users\\ben\\AppData\\Roaming\\Ev Paneli');
  const kurulum = path.resolve('C:\\Program Files\\Ev Paneli');
  assert.deepEqual(E.klasorDogrula('C:\\Users\\ben\\Dropbox\\EvPaneli', [veri, kurulum]), { ok: true, yol: 'C:\\Users\\ben\\Dropbox\\EvPaneli' });
  assert.equal(E.klasorDogrula('goreli', [veri]).neden, 'yol-gecersiz');
  assert.equal(E.klasorDogrula('', [veri]).neden, 'yol-gecersiz');
  assert.equal(E.klasorDogrula(veri, [veri]).neden, 'yasak-klasor');
  assert.equal(E.klasorDogrula(`${veri}\\alt`, [veri]).neden, 'yasak-klasor');
  assert.equal(E.klasorDogrula(veri.toUpperCase(), [veri]).neden, 'yasak-klasor', 'büyük/küçük harf farkı yasağı aşmaz');
  assert.equal(E.klasorDogrula(`${kurulum}\\resources`, [veri, kurulum]).neden, 'yasak-klasor');
  assert.equal(E.klasorDogrula(`${veri}-baska`, [veri]).ok, true, 'adı aynı önekle başlayan başka klasör yasak değil');
});

test('aday dosyalar: ana dosya ve bulut çakışma kopyaları seçilir; geçici ve başka dosyalar seçilmez; ana dosya önce', () => {
  const adlar = [
    'ev-paneli-esitleme (Ali\'s conflicted copy 2026-10-17).json',
    'ev-paneli-esitleme.json',
    'ev-paneli-esitleme.sync-conflict-20261017-120000-ABCDEFG.json',
    'ev-paneli-esitleme-DESKTOP-ABC.json',
    'ev-paneli-esitleme (1).json',
    '.ev-paneli-esitleme.abcdef.tmp',
    'ev-paneli-esitlemeX.json',
    'baska.json',
    'ev-paneli-esitleme.json.bak',
    'ayarlar.json',
  ];
  const secilen = E.adayAdlari(adlar);
  assert.equal(secilen[0], 'ev-paneli-esitleme.json');
  assert.deepEqual([...secilen].sort(), [adlar[0], adlar[1], adlar[2], adlar[3], adlar[4]].sort());
  assert.deepEqual(E.adayAdlari(null), []);
});

test('şifreleyici: parametreler dosyada yazılı ve yalnız bu değerler kabul edilir; yanlış tür ve biçim hata nedeniyle reddedilir', async () => {
  const s = sifreleyiciOlustur();
  const zarf = await s.sifrele('merhaba', 'dogru-parola-123');
  assert.equal(await s.coz(zarf, 'dogru-parola-123'), 'merhaba');
  for (const bozuk of [null, {}, { ...zarf, sifreli: false }, { ...zarf, kdf: 'pbkdf2' }, { ...zarf, r: 1 }, { ...zarf, p: 2 }, { ...zarf, iv: 'AAAA' }, { ...zarf, etiket: 'AAAA' }, { ...zarf, tuz: '***' }, { ...zarf, veri: '' }, { ...zarf, surum: 0 }]) {
    await assert.rejects(() => s.coz(bozuk, 'dogru-parola-123'), (hata) => hata.neden === 'zarf-gecersiz', JSON.stringify(bozuk)?.slice(0, 40));
  }
  await assert.rejects(() => s.coz({ ...zarf, surum: 2 }, 'dogru-parola-123'), (hata) => hata.neden === 'dahaYeni');
  await assert.rejects(() => s.coz(zarf, 'kisa'), (hata) => hata.neden === 'parola-gecersiz');
  await assert.rejects(() => s.sifrele('x', 'kisa'), (hata) => hata.neden === 'parola-gecersiz');
});

test('onayGevsetmesiniEngelle: uzak onay:false yerelde de onay:false değilse atılır; onay:true ve diğer alanlar aynen; girdi değişmez; uzakBolumTemizle yalnız parolasızda uygular', () => {
  const uzak = [
    { entity_id: 'script.a', ad: 'A', onay: false },
    { entity_id: 'script.b', ad: 'B', onay: false },
    { entity_id: 'light.c', ad: 'C', onay: true, kisayol: 'Control+Alt+1' },
    { entity_id: 'light.d', ad: 'D' },
  ];
  const yerel = [{ entity_id: 'script.b', ad: 'B', onay: false }, { entity_id: 'script.a', ad: 'A' }];
  const once = JSON.stringify(uzak);
  const s = E.onayGevsetmesiniEngelle(uzak, yerel);
  assert.equal(s.atilan, 1);
  assert.equal(JSON.stringify(uzak), once, 'girdi değişmez');
  assert.deepEqual(s.favoriler.map((f) => [f.entity_id, f.onay]), [['script.a', undefined], ['script.b', false], ['light.c', true], ['light.d', undefined]]);
  assert.equal(s.favoriler[2].kisayol, 'Control+Alt+1');
  assert.deepEqual(E.onayGevsetmesiniEngelle('x', []), { favoriler: 'x', atilan: 0 });
  assert.equal(E.onayGevsetmesiniEngelle(uzak, null).atilan, 2);

  const ham = { favoriler: [{ entity_id: 'script.a', ad: 'A', onay: false }], panolar: [] };
  const parolasiz = E.uzakBolumTemizle('favoriler', ham, { varsayilan: VARSAYILAN, parolasiz: true, yerelFavoriler: [] });
  assert.equal(parolasiz.cozum.ayarlar.favoriler[0].onay, undefined);
  assert.equal(parolasiz.onayAtilan, 1);
  const parolali = E.uzakBolumTemizle('favoriler', ham, { varsayilan: VARSAYILAN, parolasiz: false, yerelFavoriler: [] });
  assert.equal(parolali.cozum.ayarlar.favoriler[0].onay, false);
  assert.equal(parolali.onayAtilan, 0);
});

test('onayGevsetmesiniEngelle: yerelde onay:true olan favori uzakta onay:false ya da onaysız gelirse (ışık/priz/sahne: varsayılanı onaysız) yerel onay:true korunur', () => {
  const uzak = [
    { entity_id: 'light.salon', ad: 'Salon' },
    { entity_id: 'switch.priz', ad: 'Priz', onay: false },
    { entity_id: 'scene.film', ad: 'Film', kisayol: 'Control+Alt+F' },
    { entity_id: 'light.mutfak', ad: 'Mutfak', onay: true },
    { entity_id: 'light.koridor', ad: 'Koridor' },
  ];
  const yerel = [
    { entity_id: 'light.salon', ad: 'Salon', onay: true },
    { entity_id: 'switch.priz', ad: 'Priz', onay: true },
    { entity_id: 'scene.film', ad: 'Film', onay: true },
    { entity_id: 'light.mutfak', ad: 'Mutfak', onay: true },
    { entity_id: 'light.koridor', ad: 'Koridor' },
  ];
  const once = JSON.stringify(uzak);
  const s = E.onayGevsetmesiniEngelle(uzak, yerel);
  assert.equal(JSON.stringify(uzak), once, 'girdi değişmez');
  const beklenen = [['light.salon', true], ['switch.priz', true], ['scene.film', true], ['light.mutfak', true], ['light.koridor', undefined]];
  assert.deepEqual(s.favoriler.map((f) => [f.entity_id, f.onay]), beklenen);
  assert.equal(s.atilan, 3);

  // İçe aktarma hattından sonra da: onay:true kalır, onaylı favori kısayol taşıyamaz (kısayol atılır).
  const ham = { favoriler: uzak, panolar: [] };
  const parolasiz = E.uzakBolumTemizle('favoriler', ham, { varsayilan: VARSAYILAN, parolasiz: true, yerelFavoriler: yerel });
  assert.equal(parolasiz.ok, true);
  assert.deepEqual(parolasiz.cozum.ayarlar.favoriler.map((f) => [f.entity_id, f.onay]), beklenen);
  assert.equal(parolasiz.cozum.ayarlar.favoriler.find((f) => f.entity_id === 'scene.film').kisayol, undefined);
  assert.equal(parolasiz.onayAtilan, 3);
  // Parolalı dosya güvenilir: uzaktaki değer aynen gelir.
  const parolali = E.uzakBolumTemizle('favoriler', ham, { varsayilan: VARSAYILAN, parolasiz: false, yerelFavoriler: yerel });
  assert.deepEqual(parolali.cozum.ayarlar.favoriler.map((f) => [f.entity_id, f.onay]), [['light.salon', undefined], ['switch.priz', false], ['scene.film', undefined], ['light.mutfak', true], ['light.koridor', undefined]]);
  assert.equal(parolali.cozum.ayarlar.favoriler.find((f) => f.entity_id === 'scene.film').kisayol, 'Control+Alt+F');
  assert.equal(parolali.onayAtilan, 0);
});

