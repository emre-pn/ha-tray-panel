'use strict';

/**
 * Ayarlar > Yedekleme ve geri dönme > Klasörle eşitleme (o-58; src/ayarlar-esitleme.js). Sahte DOM ve sahte köprü (test/ayarlar-sahte.js,
 * test/baglanti-sahte.js); gerçek klasör, dosya, şifreleme ya da Electron yok. Köprü yanıtlarında parola bulunmaz (sayfa yalnız "parola var mı"yı görür).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa, gorunurMetinler } = require('./ayarlar-sahte');
const AYARLAR = require('../src/lib/ceviri/ayarlar');

const P = 'ayar.esitleme.';
const doldur = (metin, d = {}) => metin.replace(/\{(\w+)\}/g, (_, k) => String(d[k]));
const tr = (anahtar, d) => doldur(AYARLAR.tr[anahtar], d);
const en = (anahtar, d) => doldur(AYARLAR.en[anahtar], d);

const ac = (baglantiYaniti = {}, ek = {}) => acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, baglantiYaniti, ...ek });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click' });
  await akit();
};
/** İşaret kutusunu kullanıcı gibi değiştirir (change olayı gider). */
const isaretle = async (sayfa, kimlik, deger) => {
  const oge = sayfa.oge(kimlik);
  oge.checked = deger;
  oge.dispatchEvent({ type: 'change', target: oge });
  await akit();
};
const esitlemeCagrilari = (sayfa) => sayfa.cagrilar.filter((c) => ['esitlemeKlasoruSec', 'esitlemeyiAyarla', 'simdiEsitle', 'esitlemeParolasiniKaydet', 'esitlemeParolasiniSil'].includes(c[0]));
const adlar = (sayfa) => esitlemeCagrilari(sayfa).map((c) => c[0]);
const durum = (sayfa) => sayfa.oge('esitlemeDurum').textContent;
const ileti = (sayfa) => sayfa.oge('esitlemeSonuc').textContent;
const klasor = (sayfa) => sayfa.oge('esitlemeKlasor').textContent;
const parolaDurumu = (sayfa) => sayfa.oge('esitlemeParolaDurum').textContent;
const gorunur = (sayfa, kimlik) => sayfa.oge(kimlik).style.display !== 'none';
/** Ana süreç 'ayarlar:esitleme-degisti' gönderdi. */
const olay = async (sayfa) => {
  for (const f of [...sayfa.baglantiDeposu.esitlemeDinleyicileri]) f();
  await akit();
};
const BOLUMLER = ['favoriler', 'kisayollar', 'gorunum', 'bilgi', 'bildirim'];
const KUTULAR = { favoriler: 'esitlemeBolumFavoriler', kisayollar: 'esitlemeBolumKisayollar', gorunum: 'esitlemeBolumGorunum', bilgi: 'esitlemeBolumBilgi', bildirim: 'esitlemeBolumBildirim' };
const KLASORLU = { acik: false, klasor: 'C:\\Esitleme', klasorVar: true };
const ACIK = { ...KLASORLU, acik: true, asama: 'bekliyor' };

test('açılış: klasör seçilmedi, eşitleme kapalı; tüm bölümler seçili; parola yok; "Şimdi eşitle" kapalı; açılışta eylem çağrılmaz', async () => {
  const sayfa = await ac();
  assert.equal(klasor(sayfa), tr(`${P}klasorYok`));
  assert.equal(sayfa.oge('esitlemeAcik').checked, false);
  assert.equal(sayfa.oge('esitlemeAcik').disabled, true, 'klasör seçilmeden açılamaz');
  for (const ad of BOLUMLER) assert.equal(sayfa.oge(KUTULAR[ad]).checked, true, ad);
  assert.equal(durum(sayfa), tr(`${P}durum.kapali`));
  assert.equal(parolaDurumu(sayfa), tr(`${P}parola.yok`));
  assert.equal(gorunur(sayfa, 'btnEsitlemeParolaSil'), false);
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, true);
  assert.equal(sayfa.oge('esitlemeParola').type, 'password');
  assert.deepEqual(adlar(sayfa), []);
});

test('klasör seçimi: yol yalnız ana süreç diyaloğundan gelir (sayfa yol göndermez); seçilince ileti yazılır, eşitleme hâlâ kapalı ve kutu etkin', async () => {
  const sayfa = await ac();
  await tikla(sayfa, 'btnEsitlemeKlasor');
  assert.deepEqual(esitlemeCagrilari(sayfa), [['esitlemeKlasoruSec']], 'çağrıda argüman yok');
  assert.equal(klasor(sayfa), 'C:\\Eşitleme');
  assert.equal(ileti(sayfa), tr(`${P}sonuc.klasorSecildi`));
  assert.equal(sayfa.oge('esitlemeSonuc').className, 'ipucu alan-sonuc-tamam');
  assert.equal(sayfa.oge('esitlemeAcik').checked, false);
  assert.equal(sayfa.oge('esitlemeAcik').disabled, false);
  assert.equal(durum(sayfa), tr(`${P}durum.kapali`));
});

test('klasör seçiminden vazgeçilirse hiçbir şey değişmez ve hata gösterilmez; diyalog hataları nedene göre yazılır', async () => {
  const vazgec = await ac({ esitlemeSecilecek: null });
  await tikla(vazgec, 'btnEsitlemeKlasor');
  assert.equal(klasor(vazgec), tr(`${P}klasorYok`));
  assert.equal(ileti(vazgec), '');
  const nedenler = { 'yasak-klasor': 'hata.yasakKlasor', 'yol-gecersiz': 'hata.yolGecersiz', 'klasor-yok': 'hata.klasorYok', diyalog: 'hata.genel' };
  for (const [neden, anahtar] of Object.entries(nedenler)) {
    const sayfa = await ac({ esitlemeKlasoruSec: () => ({ ok: false, neden }) });
    await tikla(sayfa, 'btnEsitlemeKlasor');
    assert.equal(ileti(sayfa), tr(`${P}${anahtar}`), neden);
    assert.equal(sayfa.oge('esitlemeSonuc').className, 'ipucu alan-sonuc-sorun');
    assert.equal(sayfa.oge('btnEsitlemeKlasor').disabled, false, 'yeniden denenebilir');
  }
});

test('açma: klasörde dosya yoksa onay sorulmaz; ayarla({acik:true}) gider, durum "bekliyor", "Şimdi eşitle" açılır; kapatınca durum kapalı', async () => {
  const sayfa = await ac({ esitleme: KLASORLU });
  await isaretle(sayfa, 'esitlemeAcik', true);
  assert.deepEqual(sayfa.sorular, []);
  assert.deepEqual(esitlemeCagrilari(sayfa), [['esitlemeyiAyarla', { acik: true }]]);
  assert.equal(sayfa.oge('esitlemeAcik').checked, true);
  assert.equal(durum(sayfa), tr(`${P}durum.bekliyor`));
  assert.equal(ileti(sayfa), tr(`${P}sonuc.acildi`));
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, false);

  await isaretle(sayfa, 'esitlemeAcik', false);
  assert.deepEqual(esitlemeCagrilari(sayfa).at(-1), ['esitlemeyiAyarla', { acik: false }]);
  assert.equal(durum(sayfa), tr(`${P}durum.kapali`));
  assert.equal(ileti(sayfa), tr(`${P}sonuc.kapandi`));
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, true);
});

test('açma: klasörde eşitlenmiş dosya varsa önce onay sorulur; onaylanmazsa çağrı gitmez ve kutu kapalı kalır', async () => {
  const hayir = await ac({ esitleme: { ...KLASORLU, dosyaVar: true } }, { onayYaniti: false });
  await isaretle(hayir, 'esitlemeAcik', true);
  assert.deepEqual(hayir.sorular, [tr(`${P}acOnay`)]);
  assert.deepEqual(adlar(hayir), []);
  assert.equal(hayir.oge('esitlemeAcik').checked, false);
  assert.equal(durum(hayir), tr(`${P}durum.kapali`));

  const evet = await ac({ esitleme: { ...KLASORLU, dosyaVar: true } });
  await isaretle(evet, 'esitlemeAcik', true);
  assert.deepEqual(evet.sorular, [tr(`${P}acOnay`)]);
  assert.deepEqual(adlar(evet), ['esitlemeyiAyarla']);
  assert.equal(evet.oge('esitlemeAcik').checked, true);
});

test('açma reddedilirse (bölüm yok, klasör yok, yasak klasör) neden iletisi yazılır ve kutu kapalı kalır', async () => {
  const bolumsuz = await ac({ esitleme: { ...KLASORLU, bolumler: [] } });
  await isaretle(bolumsuz, 'esitlemeAcik', true);
  assert.equal(ileti(bolumsuz), tr(`${P}hata.bolumYok`));
  assert.equal(bolumsuz.oge('esitlemeAcik').checked, false);

  const yok = await ac({ esitleme: KLASORLU, esitlemeyiAyarla: () => ({ ok: false, neden: 'klasor-yok' }) });
  await isaretle(yok, 'esitlemeAcik', true);
  assert.equal(ileti(yok), tr(`${P}hata.klasorYok`));
  assert.equal(yok.oge('esitlemeAcik').checked, false);
});

test('bölüm seçimi: işaret kaldırılınca ayarla({bolumler}) yalnız seçili bölümlerle gider; sıra sabit', async () => {
  const sayfa = await ac({ esitleme: ACIK });
  await isaretle(sayfa, KUTULAR.gorunum, false);
  await isaretle(sayfa, KUTULAR.bildirim, false);
  assert.deepEqual(esitlemeCagrilari(sayfa).at(-1), ['esitlemeyiAyarla', { bolumler: ['favoriler', 'kisayollar', 'bilgi'] }]);
  assert.equal(sayfa.oge(KUTULAR.gorunum).checked, false);
  assert.equal(sayfa.oge(KUTULAR.bilgi).checked, true);
  assert.equal(ileti(sayfa), tr(`${P}sonuc.bolumler`));
  await isaretle(sayfa, KUTULAR.gorunum, true);
  assert.deepEqual(esitlemeCagrilari(sayfa).at(-1), ['esitlemeyiAyarla', { bolumler: ['favoriler', 'kisayollar', 'gorunum', 'bilgi'] }]);
});

test('"Şimdi eşitle": sonuç satırı zaman ve sayılarla yazılır; kapalıyken düğme etkisiz', async () => {
  const sayfa = await ac({ esitleme: ACIK });
  await tikla(sayfa, 'btnEsitlemeSimdi');
  assert.deepEqual(esitlemeCagrilari(sayfa), [['simdiEsitle']]);
  assert.match(durum(sayfa), /^Son eşitleme: .+\. Klasörden alınan bölüm: 0, klasöre yazılan bölüm: 1\.$/);
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, false);

  const kapali = await ac({ esitleme: KLASORLU });
  assert.equal(kapali.oge('btnEsitlemeSimdi').disabled, true, 'kapalıyken düğme devre dışı (tarayıcı devre dışı düğmeye tıklama göndermez)');
  assert.deepEqual(adlar(kapali), []);
});

test('"Şimdi eşitle" başarısız olursa hata durum satırında bir kez yazılır (iletide tekrarlanmaz)', async () => {
  const sayfa = await ac({
    esitleme: ACIK,
    simdiEsitle: (d) => {
      d.esitleme.asama = 'hata';
      d.esitleme.neden = 'parola-gerekli';
      return { ok: false, neden: 'parola-gerekli', esitleme: JSON.parse(JSON.stringify(d.esitleme)) };
    },
  });
  await tikla(sayfa, 'btnEsitlemeSimdi');
  assert.equal(durum(sayfa), tr(`${P}hata.parolaGerekli`));
  assert.equal(ileti(sayfa), '');
});

test('durum satırı: her neden kodu kendi (beş dilde tanımlı) iletisini gösterir; bilinmeyen kod genel iletiye düşer', async () => {
  const nedenler = {
    'klasor-yok': 'hata.klasorYok',
    okunamadi: 'hata.okunamadi',
    yazilamadi: 'hata.yazilamadi',
    'parola-gerekli': 'hata.parolaGerekli',
    'parola-yanlis': 'hata.parolaYanlis',
    'parola-okunamadi': 'hata.parolaOkunamadi',
    'daha-yeni': 'hata.dahaYeni',
    'gizli-deger': 'hata.gizliDeger',
    'cok-buyuk': 'hata.cokBuyuk',
    bozuk: 'hata.bozuk',
    'bolum-uygulanamadi': 'hata.bolumUygulanamadi',
    beklenmeyen: 'hata.genel',
    uydurma: 'hata.genel',
  };
  for (const [neden, anahtar] of Object.entries(nedenler)) {
    const sayfa = await ac({ esitleme: { ...ACIK, asama: 'hata', neden } });
    assert.equal(durum(sayfa), tr(`${P}${anahtar}`), neden);
    for (const dil of ['tr', 'en', 'de', 'fr', 'es']) assert.ok(AYARLAR[dil][`${P}${anahtar}`], `${dil}: ${anahtar}`);
  }
});

test('eşitleniyor: durum yazılır, "Şimdi eşitle" kapanır ve bitene kadar durum yeniden sorulur; olay gelince yoklama durur', async () => {
  const sayfa = await ac({ esitleme: { ...ACIK, asama: 'esitleniyor' } });
  assert.equal(durum(sayfa), tr(`${P}durum.esitleniyor`));
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, true);
  assert.equal(sayfa.etkinZamanlayicilar().some((z) => z.ms === 2000), true, 'olay gelmezse durum yeniden sorulur');
  sayfa.baglantiDeposu.esitleme = { ...sayfa.baglantiDeposu.esitleme, asama: 'tamam', son: { zaman: 1_800_000_000_000, uygulanan: 0, yazilan: 0 } };
  await olay(sayfa);
  assert.match(durum(sayfa), /^Son eşitleme: /);
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, false);
  assert.equal(sayfa.etkinZamanlayicilar().some((z) => z.ms === 2000), false);
});

test('klasörden bölüm alındığında: kaydedilmemiş değişiklik yoksa sayfa yeni ayarlarla yenilenir ve haber verilir', async () => {
  const sayfa = await ac({ esitleme: { ...ACIK, asama: 'tamam', son: { zaman: 1_800_000_000_000, uygulanan: 0, yazilan: 0 } } });
  const once = sayfa.getirSayisi();
  sayfa.baglantiDeposu.esitleme = { ...sayfa.baglantiDeposu.esitleme, son: { zaman: 1_800_000_060_000, uygulanan: 2, yazilan: 0 } };
  await olay(sayfa);
  assert.ok(sayfa.getirSayisi() > once, 'ayarlar sunucudan yeniden alındı');
  assert.equal(sayfa.oge('genelBildirim').textContent, tr(`${P}alindi`));
  // aynı son kaydı yeniden gelirse ikinci kez haber verilmez
  const sonra = sayfa.getirSayisi();
  await olay(sayfa);
  assert.equal(sayfa.getirSayisi(), sonra);
});

test('klasörden bölüm alındığında kaydedilmemiş düzenleme varsa sayfa YENİLENMEZ (düzenleme ezilmez), yalnız uyarı gösterilir', async () => {
  const sayfa = await ac({ esitleme: { ...ACIK, asama: 'tamam', son: { zaman: 1_800_000_000_000, uygulanan: 0, yazilan: 0 } } });
  const adres = sayfa.oge('yerelAdres');
  adres.value = 'http://192.168.1.99:8123';
  adres.dispatchEvent({ type: 'input' });
  assert.notEqual(sayfa.oge('kirliGosterge').style.display, 'none', 'sayfa kirli');
  const once = sayfa.getirSayisi();
  sayfa.baglantiDeposu.esitleme = { ...sayfa.baglantiDeposu.esitleme, son: { zaman: 1_800_000_060_000, uygulanan: 1, yazilan: 0 } };
  await olay(sayfa);
  assert.equal(sayfa.getirSayisi(), once, 'ayarlar yeniden alınmadı');
  assert.equal(adres.value, 'http://192.168.1.99:8123', 'düzenleme korundu');
  assert.equal(sayfa.oge('genelBildirim').textContent, tr(`${P}alindiKirli`));
});

test('yalnız klasöre yazan eşitleme (uygulanan 0) sayfayı yenilemez', async () => {
  const sayfa = await ac({ esitleme: { ...ACIK, asama: 'tamam', son: { zaman: 1_800_000_000_000, uygulanan: 0, yazilan: 0 } } });
  const once = sayfa.getirSayisi();
  sayfa.baglantiDeposu.esitleme = { ...sayfa.baglantiDeposu.esitleme, son: { zaman: 1_800_000_060_000, uygulanan: 0, yazilan: 3 } };
  await olay(sayfa);
  assert.equal(sayfa.getirSayisi(), once);
  assert.match(durum(sayfa), /klasöre yazılan bölüm: 3\.$/);
});

test('parola: değer yalnız kaydet çağrısına gider, alan hemen temizlenir; parola hiçbir yerde görünmez; durum "parola kayıtlı"', async () => {
  const sayfa = await ac({ esitleme: ACIK });
  const parola = 'cok-gizli-parola-1';
  sayfa.oge('esitlemeParola').value = parola;
  await tikla(sayfa, 'btnEsitlemeParolaKaydet');
  assert.deepEqual(esitlemeCagrilari(sayfa), [['esitlemeParolasiniKaydet', parola]]);
  assert.equal(sayfa.oge('esitlemeParola').value, '', 'alan temizlendi');
  assert.equal(ileti(sayfa), tr(`${P}sonuc.parolaKaydedildi`));
  assert.equal(parolaDurumu(sayfa), tr(`${P}parola.var`));
  assert.equal(gorunur(sayfa, 'btnEsitlemeParolaSil'), true);
  for (const [, metin] of gorunurMetinler(sayfa)) assert.ok(!metin.includes(parola), 'parola görünür metinlerde yok');
});

test('parola: boş, kısa ya da şifreleme yokken kaydedilmez; neden iletisi yazılır ve alan temizlenir', async () => {
  const bos = await ac({ esitleme: ACIK });
  await tikla(bos, 'btnEsitlemeParolaKaydet');
  assert.deepEqual(adlar(bos), [], 'boş parola için çağrı yok');
  assert.equal(ileti(bos), tr(`${P}hata.parolaGecersiz`));

  const kisa = await ac({ esitleme: ACIK });
  kisa.oge('esitlemeParola').value = 'kisa';
  await tikla(kisa, 'btnEsitlemeParolaKaydet');
  assert.equal(ileti(kisa), tr(`${P}hata.parolaGecersiz`));
  assert.equal(kisa.oge('esitlemeParola').value, '');
  assert.equal(parolaDurumu(kisa), tr(`${P}parola.yok`));

  const sifresiz = await ac({ esitleme: { ...ACIK, sifrelemeVar: false } });
  assert.equal(parolaDurumu(sifresiz), tr(`${P}parola.sifrelemeYok`));
  assert.equal(sifresiz.oge('btnEsitlemeParolaKaydet').disabled, true);
  assert.equal(sifresiz.oge('esitlemeParola').disabled, true);
});

test('parola kaldırma: onay istenir; onaylanmazsa çağrı gitmez; onaylanırsa parola silinir ve durum "parola yok"', async () => {
  const hayir = await ac({ esitleme: { ...ACIK, parolaVar: true } }, { onayYaniti: false });
  assert.equal(parolaDurumu(hayir), tr(`${P}parola.var`));
  assert.equal(gorunur(hayir, 'btnEsitlemeParolaSil'), true);
  await tikla(hayir, 'btnEsitlemeParolaSil');
  assert.deepEqual(hayir.sorular, [tr(`${P}parolaSilOnay`)]);
  assert.deepEqual(adlar(hayir), []);

  const evet = await ac({ esitleme: { ...ACIK, parolaVar: true } });
  await tikla(evet, 'btnEsitlemeParolaSil');
  assert.deepEqual(adlar(evet), ['esitlemeParolasiniSil']);
  assert.equal(parolaDurumu(evet), tr(`${P}parola.yok`));
  assert.equal(ileti(evet), tr(`${P}sonuc.parolaKaldirildi`));
  assert.equal(gorunur(evet, 'btnEsitlemeParolaSil'), false);
});

test('köprü hataları (istisna) genel iletiye düşer ve sayfa çalışmayı sürdürür', async () => {
  const sayfa = await ac({ esitleme: ACIK, simdiEsitle: () => { throw new Error('ipc koptu'); } });
  await tikla(sayfa, 'btnEsitlemeSimdi');
  assert.equal(ileti(sayfa), tr(`${P}hata.genel`));
  assert.equal(sayfa.oge('btnEsitlemeSimdi').disabled, false);
});

test('dil: durum ve ileti, dil değişince aynı durumdan yeni dilde yeniden yazılır', async () => {
  const sayfa = await ac({ esitleme: { ...ACIK, asama: 'hata', neden: 'bozuk' } }, { ayar: { ...AYAR_D3, dil: 'tr', dilAyari: 'tr', sistemDili: 'tr' } });
  assert.equal(durum(sayfa), tr(`${P}hata.bozuk`));
  sayfa.oge('dilSecimi').value = 'en';
  sayfa.oge('dilSecimi').dispatchEvent({ type: 'change' });
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(durum(sayfa), en(`${P}hata.bozuk`));
  assert.equal(klasor(sayfa), 'C:\\Esitleme', 'klasör yolu çevrilmez');
  assert.equal(parolaDurumu(sayfa), en(`${P}parola.yok`));
});

test('sözlük: eşitleme anahtarları beş dilde tanımlı; yer tutucular aynı; tr dışında Türkçeye özgü harf yok', () => {
  const anahtarlar = Object.keys(AYARLAR.tr).filter((k) => k.startsWith(P));
  assert.ok(anahtarlar.length >= 50, `anahtar sayısı (${anahtarlar.length})`);
  const yerTutucu = (m) => [...m.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  for (const k of anahtarlar) {
    for (const dil of ['en', 'de', 'fr', 'es']) {
      assert.ok(AYARLAR[dil][k], `${dil}: ${k}`);
      assert.equal(yerTutucu(AYARLAR[dil][k]), yerTutucu(AYARLAR.tr[k]), `${dil}: ${k} yer tutucuları`);
      assert.doesNotMatch(AYARLAR[dil][k], /[ğĞıİşŞ]/, `${dil}: ${k} Türkçeye özgü harf`);
    }
  }
});
