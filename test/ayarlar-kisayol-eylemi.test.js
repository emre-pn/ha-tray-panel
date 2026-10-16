'use strict';

// o-13: Ayarlar'da favori satırındaki "Kısayol eylemi" seçicisi (sahte DOM; test/ayarlar-sahte.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, akit, duzles, acilmisSayfa, satirBul, girdiler, metinKutulari, gorunurMetinler } = require('./ayarlar-sahte');

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonYuk = (sayfa, ad) => duzles(sayfa.cagrilar.filter((c) => c[0] === ad).at(-1)[1]);

const IS_ALANI = { onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false };
const CIHAZLAR = {
  ...CIHAZLAR_D3,
  cihazlar: [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light', alanEtiketi: 'Işıklar', durum: 'açık', ...IS_ALANI,
      kisayolEylemleri: ['ac', 'kapat', 'parlak+5', 'parlak+10', 'parlak+20', 'parlak-5', 'parlak-10', 'parlak-20'] },
    { entity_id: 'fan.vantilator', ad: 'Vantilatör', alan: 'fan', alanEtiketi: 'Vantilatörler', durum: 'açık', ...IS_ALANI,
      kisayolEylemleri: ['ac', 'kapat', 'hiz+10', 'hiz+20', 'hiz-10', 'hiz-20'] },
    { entity_id: 'scene.film', ad: 'Film', alan: 'scene', alanEtiketi: 'Sahneler', durum: '', ...IS_ALANI, kisayolEylemleri: [] },
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', alan: 'button', alanEtiketi: 'Düğmeler', durum: '', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
  ],
};
const FAVORILER = [
  { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', kisayol: 'Control+Alt+L', parlaklik: true, kisayolEylemi: 'parlak+10' },
  { entity_id: 'fan.vantilator', ad: 'Vantilatör', kisayol: 'Control+Alt+V' },
  { entity_id: 'scene.film', ad: 'Film', kisayol: 'Control+Alt+F' },
];
const AYAR = { ...AYAR_D3, favoriler: FAVORILER };

const secici = (satir) => satir.bul((o) => o.etiket === 'select' && o.className === 'kisayol-eylemi')[0];
const secenekler = (satir) => secici(satir).children.map((o) => o.value);
const onayKutulari = (satir) => girdiler(satir).filter((g) => g.type === 'checkbox');

test('seçici yalnız eylemi olan satırlarda görünür: ışık, vantilatör; sahne ve kısayolsuz-uygunsuz öğede yok', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  assert.deepEqual(secenekler(satirBul(sayfa, 'light.salon_lambasi')), ['', 'ac', 'kapat', 'parlak+5', 'parlak+10', 'parlak+20', 'parlak-5', 'parlak-10', 'parlak-20']);
  assert.deepEqual(secenekler(satirBul(sayfa, 'fan.vantilator')), ['', 'ac', 'kapat', 'hiz+10', 'hiz+20', 'hiz-10', 'hiz-20']);
  assert.equal(secici(satirBul(sayfa, 'scene.film')), undefined, 'sahnenin yönlü eylemi yok');
  assert.equal(secici(satirBul(sayfa, 'button.pc_bilgisayari_kapat')), undefined, 'kısayola uygun olmayan öğede kısayol yok, eylem de yok');
});

test('seçici kayıtlı değeri gösterir; seçenek adları okunur (Türkçe): "Aç-kapa (varsayılan)", "Parlaklık +%10"', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const isik = secici(satirBul(sayfa, 'light.salon_lambasi'));
  assert.equal(isik.value, 'parlak+10');
  assert.equal(secici(satirBul(sayfa, 'fan.vantilator')).value, '');
  const adlar = isik.children.map((o) => o.textContent);
  assert.deepEqual(adlar.slice(0, 5), ['Aç-kapa (varsayılan)', 'Aç', 'Kapat', 'Parlaklık +%5', 'Parlaklık +%10']);
  assert.equal(adlar.at(-1), 'Parlaklık −%20');
  const vantilator = secici(satirBul(sayfa, 'fan.vantilator')).children.map((o) => o.textContent);
  assert.deepEqual(vantilator.slice(3), ['Hız +%10', 'Hız +%20', 'Hız −%10', 'Hız −%20']);
});

test('parlaklık adımları yalnız "Parlaklık ayarı" açıkken seçilebilir; ayar kapanınca parlaklık adımı sıfırlanır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const satir = satirBul(sayfa, 'light.salon_lambasi');
  const kutu = secici(satir);
  const [, , parlaklikCb] = onayKutulari(satir);
  assert.equal(parlaklikCb.checked, true);
  assert.equal(kutu.children.find((o) => o.value === 'parlak+10').disabled, false);
  assert.equal(kutu.children.find((o) => o.value === 'ac').disabled, false);

  parlaklikCb.tikla(); // kapat
  assert.equal(kutu.children.find((o) => o.value === 'parlak+10').disabled, true);
  assert.equal(kutu.children.find((o) => o.value === 'parlak-5').disabled, true);
  assert.equal(kutu.children.find((o) => o.value === 'ac').disabled, false, 'aç/kapat parlaklık ayarına bağlı değil');
  assert.equal(kutu.value, '', 'parlaklık adımı geçerliliğini yitirdi: aç-kapa\'ya döner');
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa, 'favorileriKaydet').find((g) => g.entity_id === 'light.salon_lambasi');
  assert.equal(yuk.parlaklik, false);
  assert.equal(yuk.kisayolEylemi, '', 'sunucuya boş değer gider: eylem silinir');
});

test('seçim değişikliği kirli sayılır ve yalnız değişince yükte gider; geri alınan seçim kirli bırakmaz', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const vantilator = secici(satirBul(sayfa, 'fan.vantilator'));
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none');
  vantilator.value = 'hiz-20';
  vantilator.dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'inline');
  vantilator.value = '';
  vantilator.dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none', 'eski değere dönüldü');
  vantilator.value = 'hiz-20';
  vantilator.dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  const yuk = new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g]));
  assert.deepEqual(yuk.get('fan.vantilator'), { entity_id: 'fan.vantilator', kisayolEylemi: 'hiz-20' });
  assert.deepEqual(yuk.get('light.salon_lambasi'), { entity_id: 'light.salon_lambasi' }, 'dokunulmayan satır eylem göndermez');
  // Kayıttan sonra sunucudaki değer gösterilir ve tekrar Kaydet favori çağrısı yapmaz.
  assert.equal(secici(satirBul(sayfa, 'fan.vantilator')).value, 'hiz-20');
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none');
  const once = sayfa.cagrilar.filter((c) => c[0] === 'favorileriKaydet').length;
  await kaydet(sayfa);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'favorileriKaydet').length, once);
});

test('seçici yalnız favori seçiliyken ve kısayol doluyken etkindir', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const satir = satirBul(sayfa, 'fan.vantilator');
  const kutu = secici(satir);
  const [kisayol] = metinKutulari(satir);
  assert.equal(kutu.disabled, false);
  kisayol.value = '  ';
  kisayol.dispatchEvent({ type: 'input' });
  assert.equal(kutu.disabled, true, 'kısayol boşsa eylem seçilemez');
  kisayol.value = 'ctrl alt v';
  kisayol.dispatchEvent({ type: 'input' });
  assert.equal(kutu.disabled, false);
  onayKutulari(satir)[0].tikla(); // favoriden çıkar
  assert.equal(kutu.disabled, true);
  onayKutulari(satir)[0].tikla();
  assert.equal(kutu.disabled, false);
});

test('kayıt sonucunda eylemHatalari varsa kullanıcıya söylenir (sessiz kalmaz); seçici sunucudaki değere döner', async () => {
  const sayfa = await acilmisSayfa({
    ayar: AYAR,
    cihazlar: CIHAZLAR,
    favoriSonucu: { ok: true, sayi: 3, eksik: 0, engelli: 0, kisayolHatalari: [], etiketHatalari: [], eylemHatalari: [{ entity_id: 'fan.vantilator', neden: 'gecersiz' }], kisayolSorunlari: [] },
  });
  const kutu = secici(satirBul(sayfa, 'fan.vantilator'));
  kutu.value = 'hiz+10';
  kutu.dispatchEvent({ type: 'change' });
  await kaydet(sayfa);
  const metin = gorunurMetinler(sayfa).map(([, m]) => m).join('\n');
  assert.match(metin, /1 kısayol eylemi bu favori için geçerli olmadığından kaydedilmedi/);
});

test('seçici metinleri çevrilebilir: her anahtarın iki dilde karşılığı var, İngilizce metin Türkçe harf taşımaz', () => {
  const sozluk = require('../src/lib/ceviri/ayarlar');
  const anahtarlar = ['ayar.cihaz.kisayolEylemi', 'ayar.cihaz.kisayolEylemiEtiket', 'ayar.cihaz.kisayolEylemiIpucu', 'ayar.cihaz.eylem.varsayilan', 'ayar.cihaz.eylem.ac', 'ayar.cihaz.eylem.kapat', 'ayar.cihaz.eylem.parlakArti', 'ayar.cihaz.eylem.parlakEksi', 'ayar.cihaz.eylem.hizArti', 'ayar.cihaz.eylem.hizEksi', 'ayar.kaydet.eylemRed', 'ayar.kaydet.eylemRed.bir'];
  for (const k of anahtarlar) {
    assert.ok(sozluk.tr[k], `${k}: Türkçe karşılık yok`);
    assert.ok(sozluk.en[k], `${k}: İngilizce karşılık yok`);
    assert.doesNotMatch(sozluk.en[k], /[çğıöşüÇĞİÖŞÜ]/, `${k}: İngilizce metinde Türkçe harf var`);
  }
});
