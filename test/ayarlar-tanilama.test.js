'use strict';

/**
 * Ayarlar sayfasında "Tanılama ve günlük" bölümü (o-41): src/ayarlar.js, sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 * Rapor metninin kendisi test/tanilama.test.js'tedir; ana süreç tarafı (IPC, pano, klasörde göster) test/ana-surec.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');

const ADLAR = { metin: 'tanilamaMetni', durum: 'tanilamaDurum', goster: 'btnTanilamaGoster', kopyala: 'btnTanilamaKopyala', gunluk: 'btnGunlukAc' };
const RAPOR = ['Ev Paneli / Home Panel diagnostics report', 'App version: 1.3.0 (installed build)', 'Home address: private IP, http', ''].join('\n');

const sayfaAc = (aracYaniti) => acilmisSayfa({ ayar: { ...AYAR_D3 }, cihazlar: CIHAZLAR_D3, aracYaniti });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};
const cagriSayisi = (sayfa, ad) => sayfa.cagrilar.filter((c) => c[0] === ad).length;

test('açılışta rapor istenmez (günlük okunmaz, pano kullanılmaz); önizleme ve durum satırı boştur', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge(ADLAR.metin).textContent, '');
  assert.equal(sayfa.oge(ADLAR.durum).textContent, '');
  for (const ad of ['tanilamaGetir', 'tanilamaKopyala', 'gunlukKlasoruAc']) assert.equal(cagriSayisi(sayfa, ad), 0, ad);
});

test('"Raporu göster": rapor önizlemeye yazılır, panoya KOPYALANMAZ; durum satırı kopyalamadan önce gözden geçirmeyi söyler', async () => {
  const sayfa = await sayfaAc({ tanilamaGetir: { ok: true, metin: RAPOR, gunlukSatiri: 12 } });
  await tikla(sayfa, ADLAR.goster);
  assert.equal(sayfa.oge(ADLAR.metin).textContent, RAPOR);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Rapor hazır (günlük satırı: 12). Panoya kopyalamadan önce gözden geçir.');
  assert.equal(cagriSayisi(sayfa, 'tanilamaGetir'), 1);
  assert.equal(cagriSayisi(sayfa, 'tanilamaKopyala'), 0, 'göstermek kopyalamaz');
});

test('"Raporu panoya kopyala": ana sürecin kopyaladığı AYNI metin önizlemede görünür; durum satırı yapıştırmadan önce gözden geçirmeyi söyler', async () => {
  const kopyalanan = ['Ev Paneli / Home Panel diagnostics report', 'Created: 2026-10-16T10:00:00.000Z', ''].join('\n');
  const sayfa = await sayfaAc({ tanilamaKopyala: { ok: true, metin: kopyalanan, gunlukSatiri: 7 } });
  await tikla(sayfa, ADLAR.kopyala);
  assert.equal(sayfa.oge(ADLAR.metin).textContent, kopyalanan);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Panoya kopyalandı (günlük satırı: 7). Yapıştırmadan önce aşağıdaki metni gözden geçir.');
  assert.equal(cagriSayisi(sayfa, 'tanilamaKopyala'), 1);
  // sayfa metni kendisi kurmaz: köprüye argüman da gitmez (rapor metni ana süreçte kurulur)
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'tanilamaKopyala'), ['tanilamaKopyala']);
});

test('rapor alınamayınca hata satırı yazılır; önizleme eski metni korur; düğmeler yeniden açılır; köprü fırlatsa da sayfa çökmez', async () => {
  const sayfa = await sayfaAc({ tanilamaGetir: async () => ({ ok: false }) });
  await tikla(sayfa, ADLAR.goster);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Rapor hazırlanamadı. Biraz sonra yeniden dene.');
  assert.equal(sayfa.oge(ADLAR.metin).textContent, '');
  assert.equal(sayfa.oge(ADLAR.goster).disabled, false);
  assert.equal(sayfa.oge(ADLAR.kopyala).disabled, false);

  const patlayan = await sayfaAc({ tanilamaKopyala: async () => { throw new Error('köprü koptu'); } });
  await tikla(patlayan, ADLAR.kopyala);
  assert.equal(patlayan.oge(ADLAR.durum).textContent, 'Rapor hazırlanamadı. Biraz sonra yeniden dene.');
  assert.equal(patlayan.oge(ADLAR.kopyala).disabled, false);

  for (const bozuk of [{ ok: true }, { ok: true, metin: 5 }, null, undefined]) {
    const s = await sayfaAc({ tanilamaGetir: async () => bozuk });
    await tikla(s, ADLAR.goster);
    assert.equal(s.oge(ADLAR.durum).textContent, 'Rapor hazırlanamadı. Biraz sonra yeniden dene.', JSON.stringify(bozuk));
    assert.equal(s.oge(ADLAR.metin).textContent, '');
  }
});

test('rapor istenirken iki düğme de kapalıdır (art arda tıklama kopyayı katlamaz)', async () => {
  let birak;
  const bekle = new Promise((coz) => { birak = coz; });
  const sayfa = await sayfaAc({ tanilamaKopyala: async () => { await bekle; return { ok: true, metin: RAPOR, gunlukSatiri: 3 }; } });
  sayfa.oge(ADLAR.kopyala).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
  assert.equal(sayfa.oge(ADLAR.goster).disabled, true);
  assert.equal(sayfa.oge(ADLAR.kopyala).disabled, true);
  birak();
  await akit();
  assert.equal(sayfa.oge(ADLAR.goster).disabled, false);
  assert.equal(sayfa.oge(ADLAR.kopyala).disabled, false);
});

test('"Günlük dosyasını göster": yalnız köprüyü çağırır (yol sayfadan geçmez); sonuç durum satırına yazılır', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ADLAR.gunluk);
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'gunlukKlasoruAc'), ['gunlukKlasoruAc']);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Günlük klasörü Dosya Gezgini’nde açıldı.');

  const yok = await sayfaAc({ gunlukKlasoruAc: { ok: false, neden: 'yok' } });
  await tikla(yok, ADLAR.gunluk);
  assert.equal(yok.oge(ADLAR.durum).textContent, 'Günlük dosyası bulunamadı.');

  const patlayan = await sayfaAc({ gunlukKlasoruAc: async () => { throw new Error('x'); } });
  await tikla(patlayan, ADLAR.gunluk);
  assert.equal(patlayan.oge(ADLAR.durum).textContent, 'Günlük dosyası bulunamadı.');
});

test('dil değişince durum satırı yeni dilde yeniden yazılır; rapor metni (İngilizce) değişmez', async () => {
  const sayfa = await sayfaAc({ tanilamaKopyala: { ok: true, metin: RAPOR, gunlukSatiri: 7 } });
  await tikla(sayfa, ADLAR.kopyala);
  assert.match(sayfa.oge(ADLAR.durum).textContent, /^Panoya kopyalandı/);
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Copied to the clipboard (log lines: 7). Review the text below before you paste it.');
  assert.equal(sayfa.oge(ADLAR.metin).textContent, RAPOR);
  assert.equal(sayfa.oge(ADLAR.goster).textContent, 'Show report');
  assert.equal(sayfa.oge(ADLAR.gunluk).textContent, 'Show log file');
});

test('ana süreç "bolumAraclar" bölümünü açmayı isteyebilir (bilinen kimlik)', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge('bolumAraclar').open, false);
  await sayfa.bolumIste('bolumAraclar');
  assert.equal(sayfa.oge('bolumAraclar').open, true);
});

test('HTML: bölüm katlanır; düğmeler type=button; önizleme kutusu etiketli ve klavyeyle kaydırılabilir; metin yalnız textContent ile yazılır; bölüm sürüm bölümünün ardından, alt bilgiden önce', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  const betik = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.js'), 'utf8');
  assert.match(html, /<details class="bolum" id="bolumAraclar">/);
  for (const kimlik of ['btnTanilamaGoster', 'btnTanilamaKopyala', 'btnGunlukAc']) {
    assert.match(html, new RegExp(`<button class="buton buton-ikincil" id="${kimlik}" type="button"`));
  }
  assert.match(html, /id="tanilamaMetni" role="region" tabindex="0" aria-labelledby="tanilamaEtiketi"/);
  assert.match(html, /id="tanilamaDurum" role="status" aria-live="polite"/);
  assert.ok(html.indexOf('id="bolumSurum"') < html.indexOf('id="bolumAraclar"') && html.indexOf('id="bolumAraclar"') < html.indexOf('class="alt-bilgi"'));
  assert.doesNotMatch(betik, /tanilamaMetni\.(innerHTML|outerHTML|insertAdjacentHTML)/);
  assert.doesNotMatch(betik, /tanilamaMetni\.textContent\s*=\s*['"`][^'"`]/, 'önizleme sayfada sabit metinle kurulmaz; metin ana süreçten gelir');
});
