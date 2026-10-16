'use strict';

/**
 * Ayarlar sayfasında "Sürüm ve yenilikler" bölümü (o-40): src/ayarlar.js, sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 * Ana süreç tarafı (tepsi, IPC, zamanlayıcı) test/ana-surec.test.js'tedir; denetleyici mantığı test/surum-denetimi.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');

const ADLAR = { surum: 'surumCalisan', durum: 'surumDurum', notlar: 'yenilikMetni', denetle: 'btnSurumDenetle', sayfa: 'btnSurumSayfasi', kutu: 'surumDenetimi' };
const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: { ...AYAR_D3, ...(ek.ayar ?? {}) }, cihazlar: CIHAZLAR_D3, aracYaniti: ek.aracYaniti });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};

test('açılışta çalışan sürüm ve paketli yenilikler yazılır; seçenek varsayılan KAPALI', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge(ADLAR.kutu).checked, false);
  assert.equal(sayfa.oge(ADLAR.surum).textContent, 'Çalışan sürüm: 1.3.0');
  assert.match(sayfa.oge(ADLAR.notlar).textContent, /^1\.3\.0 — 2026-10-16\n\nFirst public release\./);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, '', 'denetim yapılmadan durum satırı boş');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'surumuDenetle'), false, 'açılışta denetim istenmez (ağa çıkılmaz)');
});

test('yenilik notu yoksa (ya da okunamazsa) "bulunamadı" yazılır; sayfa çökmez', async () => {
  const yok = await sayfaAc({ aracYaniti: { yenilikleriGetir: { ok: true, surum: '9.9.9', bulundu: false, baslik: '', metin: '' } } });
  assert.equal(yok.oge(ADLAR.notlar).textContent, 'Bu sürüm için yenilik notu bulunamadı.');
  const hata = await sayfaAc({ aracYaniti: { yenilikleriGetir: { ok: false } } });
  assert.equal(hata.oge(ADLAR.notlar).textContent, 'Bu sürüm için yenilik notu bulunamadı.');
});

test('kayıtlı yeni sürüm bilgisi durum satırında görünür', async () => {
  const sayfa = await sayfaAc({ aracYaniti: { surumDurumu: { ok: true, surum: '1.3.0', acik: true, sonDenetim: 1, yeniSurum: '1.4.0' } } });
  assert.equal(sayfa.oge(ADLAR.durum).textContent, '1.4.0 sürümü çıktı. Sürüm sayfasından indirebilirsin.');
});

test('seçenek kaydedilince yükte surumDenetimi gider; işaretlemek formu kirli yapar', async () => {
  const sayfa = await sayfaAc();
  sayfa.oge(ADLAR.kutu).checked = true;
  sayfa.oge(ADLAR.kutu).dispatchEvent({ type: 'change' });
  assert.notEqual(sayfa.oge('kirliGosterge').style.display, 'none');
  await tikla(sayfa, 'btnAyarlariKaydet');
  const yuk = sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet')[1];
  assert.equal(yuk.surumDenetimi, true);
  const kapali = await sayfaAc({ ayar: { surumDenetimi: true } });
  assert.equal(kapali.oge(ADLAR.kutu).checked, true, 'sunucudaki değer yansır');
});

test('"Şimdi denetle": seçenek kapalıyken ana süreç ağa çıkmaz ve sayfa nedenini söyler; düğme yeniden açılır', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ADLAR.denetle);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'surumuDenetle').length, 1);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Denetim kapalı. Seçeneği işaretleyip Kaydet’e bas, sonra yeniden denetle.');
  assert.equal(sayfa.oge(ADLAR.denetle).disabled, false);
});

test('"Şimdi denetle": güncel, yeni sürüm, çok sık ve hata sonuçları yazılır; denetlenirken düğme kapalıdır', async () => {
  let birak;
  const bekle = new Promise((coz) => { birak = coz; });
  const sayfa = await sayfaAc({ ayar: { surumDenetimi: true }, aracYaniti: { surumuDenetle: async () => { await bekle; return { ok: true, sonuc: 'guncel', surum: '1.3.0' }; } } });
  sayfa.oge(ADLAR.denetle).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Denetleniyor…');
  assert.equal(sayfa.oge(ADLAR.denetle).disabled, true);
  birak();
  await akit();
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Güncelsin: 1.3.0 en son sürüm.');
  assert.equal(sayfa.oge(ADLAR.denetle).disabled, false);

  const sonuclar = [
    [{ ok: true, sonuc: 'yeni', surum: '1.4.0' }, '1.4.0 sürümü çıktı. Sürüm sayfasından indirebilirsin.'],
    [{ ok: true, sonuc: 'cok-sik' }, 'Biraz önce denetlendi; bir dakika sonra yeniden dene.'],
    [{ ok: true, sonuc: 'hata', neden: 'ag' }, 'Denetlenemedi. Bağlantını denetleyip yeniden dene.'],
    [{ ok: false }, 'Denetlenemedi. Bağlantını denetleyip yeniden dene.'],
    [{ ok: true, sonuc: 'bilinmeyen' }, 'Denetlenemedi. Bağlantını denetleyip yeniden dene.'],
  ];
  for (const [yanit, beklenen] of sonuclar) {
    const s = await sayfaAc({ ayar: { surumDenetimi: true }, aracYaniti: { surumuDenetle: yanit } });
    await tikla(s, ADLAR.denetle);
    assert.equal(s.oge(ADLAR.durum).textContent, beklenen, JSON.stringify(yanit));
  }
  const patlayan = await sayfaAc({ ayar: { surumDenetimi: true }, aracYaniti: { surumuDenetle: async () => { throw new Error('köprü koptu'); } } });
  await tikla(patlayan, ADLAR.denetle);
  assert.equal(patlayan.oge(ADLAR.durum).textContent, 'Denetlenemedi. Bağlantını denetleyip yeniden dene.');
  assert.equal(patlayan.oge(ADLAR.denetle).disabled, false);
});

test('"Sürüm sayfasını aç" yalnız köprüyü çağırır (adres sayfadan gitmez)', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ADLAR.sayfa);
  const cagri = sayfa.cagrilar.find((c) => c[0] === 'surumSayfasiniAc');
  assert.deepEqual(cagri, ['surumSayfasiniAc']);
});

test('ana süreç bölüm açmayı ister: bölüm açılır ve görünür kaydırılır; bilinmeyen kimlik yok sayılır', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge('bolumSurum').open, false);
  await sayfa.bolumIste('bolumSurum');
  assert.equal(sayfa.oge('bolumSurum').open, true);
  assert.equal(sayfa.oge('bolumSurum').kaydirma, 1);
  const baska = await sayfaAc();
  await baska.bolumIste('bolumYedek'); // izinli listede değil
  await baska.bolumIste('<img src=x>');
  await baska.bolumIste(undefined);
  assert.equal(baska.oge('bolumYedek').open, false);
  assert.equal(baska.oge('bolumSurum').open, false);
});

test('dil değişince durum ve yenilik metinleri yeni dilde yeniden yazılır', async () => {
  const sayfa = await sayfaAc({ ayar: { surumDenetimi: true }, aracYaniti: { surumuDenetle: { ok: true, sonuc: 'guncel', surum: '1.3.0' }, yenilikleriGetir: { ok: true, surum: '9.9.9', bulundu: false, baslik: '', metin: '' } } });
  await tikla(sayfa, ADLAR.denetle);
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'Güncelsin: 1.3.0 en son sürüm.');
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge(ADLAR.durum).textContent, 'You are up to date: 1.3.0 is the latest version.');
  assert.equal(sayfa.oge(ADLAR.surum).textContent, 'Running version: 1.3.0');
  assert.equal(sayfa.oge(ADLAR.notlar).textContent, 'No release notes were found for this version.');
});

test('HTML: bölüm katlanır, düğmeler type=button; notlar kutusu etiketli ve klavyeyle kaydırılabilir; metin yalnız textContent ile yazılır', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  assert.match(html, /<details class="bolum" id="bolumSurum">/);
  assert.match(html, /<button class="buton buton-ikincil" id="btnSurumDenetle" type="button"/);
  assert.match(html, /<button class="buton buton-ikincil" id="btnSurumSayfasi" type="button"/);
  assert.match(html, /id="yenilikMetni" role="region" tabindex="0" aria-labelledby="yeniliklerEtiketi"/);
  assert.match(html, /id="surumDurum" role="status" aria-live="polite"/);
});

test('taşınabilir sürüm (o-45): "Windows ile başlat" kutusu kapanır ve nedeni yazılır; kurulu sürümde kutu açık kalır', async () => {
  const mesaj = 'Taşınabilir sürümde Windows ile başlatma yoktur; kayıt defterine hiçbir şey yazılmaz. Windows açılışında başlatmak için kurulum sürümünü kullan.';
  const sayfa = await sayfaAc({ ayar: { otomatikBaslatDurumu: { durum: 'tasinabilir', mesaj }, otomatikBaslat: true } });
  assert.equal(sayfa.oge('otomatikBaslat').disabled, true);
  assert.equal(sayfa.oge('otomatikBaslat').checked, true, 'ortak ayar değeri gösterilir');
  assert.equal(sayfa.oge('otomatikBaslatDurum').textContent, mesaj);
  assert.notEqual(sayfa.oge('otomatikBaslatDurum').style.display, 'none');
  const kurulu = await sayfaAc();
  assert.equal(kurulu.oge('otomatikBaslat').disabled, false);
});
