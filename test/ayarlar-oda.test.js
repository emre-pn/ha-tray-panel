'use strict';

/**
 * Ayarlar sayfasında "Odadan başla" seçicisi (o-44): src/ayarlar.js, sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 * Öneri listesinin kurulması (süzgeç, sıralama) test/oda-kurulum.test.js'tedir; ana süreç tarafı (IPC, canlı bağlantı şartı)
 * test/ana-surec.test.js'tedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');

const ODA = { getir: 'btnOdalariGetir', sec: 'odaSec', durum: 'odaDurum', onizleme: 'odaOnizleme', ekle: 'btnOdaEkle' };

const AYAR_BOS = { ...AYAR_D3, favoriler: [] }; // ilk kurulum: henüz favori yok
const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: ek.ayar ?? { ...AYAR_BOS }, cihazlar: CIHAZLAR_D3, aracYaniti: ek.aracYaniti });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};
const odaSec = async (sayfa, kimlik) => {
  sayfa.oge(ODA.sec).value = kimlik;
  sayfa.oge(ODA.sec).dispatchEvent({ type: 'change' });
  await akit();
};
const secenekler = (sayfa) => sayfa.oge(ODA.sec).children.map((o) => [o.value, o.textContent]);
const onizlemeSatirlari = (sayfa) => sayfa.oge(ODA.onizleme).children.map((c) => c.textContent);
const cagriSayisi = (sayfa, ad) => sayfa.cagrilar.filter((c) => c[0] === ad).length;
const durumMetni = (sayfa) => sayfa.oge(ODA.durum).textContent;

test('açılışta oda istenmez; seçim kutusu kapalı, önizleme gizli, "Seçime ekle" kapalı', async () => {
  const sayfa = await sayfaAc();
  assert.equal(cagriSayisi(sayfa, 'odalariGetir'), 0, 'ana süreçten oda okunmaz (kullanıcı düğmeye basana kadar)');
  assert.equal(sayfa.oge(ODA.sec).disabled, true);
  assert.equal(sayfa.oge(ODA.onizleme).style.display, 'none');
  assert.equal(sayfa.oge(ODA.ekle).disabled, true);
  assert.equal(durumMetni(sayfa), '');
});

test('"Odaları getir": odalar sayıyla birlikte listelenir; durum satırı söyler; oda seçilene kadar önizleme gizli ve ekleme kapalı', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ODA.getir);
  assert.equal(cagriSayisi(sayfa, 'odalariGetir'), 1);
  assert.deepEqual(secenekler(sayfa), [['', 'Oda seç…'], ['salon', 'Salon (2)'], ['mutfak', 'Mutfak (1)']]);
  assert.equal(sayfa.oge(ODA.sec).disabled, false);
  assert.equal(sayfa.oge(ODA.sec).value, '');
  assert.equal(durumMetni(sayfa), 'Öneri bulunan oda sayısı: 2. Bir oda seç.');
  assert.equal(sayfa.oge(ODA.getir).disabled, false);
  assert.equal(sayfa.oge(ODA.ekle).disabled, true);
  assert.equal(sayfa.oge(ODA.onizleme).style.display, 'none');
});

test('oda seçilince cihaz önerisi önizlenir (ad, tür; adlar yalnız metin); "Seçime ekle" açılır', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  assert.notEqual(sayfa.oge(ODA.onizleme).style.display, 'none');
  assert.deepEqual(onizlemeSatirlari(sayfa), ['Salon: önerilen cihaz sayısı 2', '• Salon Lambası · Işıklar', '• Film · Sahneler']);
  assert.equal(sayfa.oge(ODA.ekle).disabled, false);
  await odaSec(sayfa, '');
  assert.equal(sayfa.oge(ODA.onizleme).style.display, 'none');
  assert.equal(sayfa.oge(ODA.ekle).disabled, true);
});

test('"Seçime ekle": öneri favori SEÇİMİNE eklenir, form kirli olur, HİÇBİR ŞEY kaydedilmez; Kaydet\'te yük eklenen kimlikleri sırayla taşır', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Salon: 2 cihaz seçime eklendi. Kaydet’e basana kadar kaydedilmez.');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '2 favori seçili');
  assert.notEqual(sayfa.oge('kirliGosterge').style.display, 'none');
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0, 'eklemek kaydetmez');
  assert.equal(cagriSayisi(sayfa, 'ayarlariKaydet'), 0);
  assert.deepEqual(onizlemeSatirlari(sayfa), ['Salon: önerilen cihaz sayısı 2', '• Salon Lambası · Işıklar · zaten seçili', '• Film · Sahneler · zaten seçili']);
  await tikla(sayfa, 'btnAyarlariKaydet');
  const yuk = sayfa.cagrilar.find((c) => c[0] === 'favorileriKaydet')[1];
  assert.deepEqual(yuk.map((f) => f.entity_id), ['light.salon_lambasi', 'scene.film']);
  assert.equal(yuk.every((f) => Object.keys(f).length === 1), true, 'yükte yalnız kimlik var (onay, kısayol... değişmedi)');
});

test('zaten seçili cihazlar yinelenmez; tekil ileti (1 cihaz); hepsi seçiliyse bunu söyler ve form kirlenmez', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_BOS, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] } }); // light.salon_lambasi zaten seçili
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  assert.deepEqual(onizlemeSatirlari(sayfa).slice(1), ['• Salon Lambası · Işıklar · zaten seçili', '• Film · Sahneler']);
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Salon: 1 cihaz seçime eklendi. Kaydet’e basana kadar kaydedilmez.');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '2 favori seçili');
  await tikla(sayfa, ODA.ekle); // ikinci kez: eklenecek yok
  assert.equal(durumMetni(sayfa), 'Salon: önerilen cihazların hepsi zaten seçili.');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '2 favori seçili');
});

test('hepsi zaten seçili olan odada form kirlenmez', async () => {
  const sayfa = await sayfaAc({ ayar: { ...AYAR_BOS, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }, { entity_id: 'scene.film', ad: 'Film' }] } });
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Salon: önerilen cihazların hepsi zaten seçili.');
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none');
});

test('yüklü cihaz listesinde olmayan öneri eklenmez (kayıt yolu yalnız süzgeçten geçmiş adayları kabul eder)', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'mutfak');
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Mutfak: önerilen cihazların hepsi zaten seçili.', 'bilinmeyen kimlik atlandı, hiçbir şey eklenmedi');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '0 favori seçili');
  assert.equal(sayfa.oge('kirliGosterge').style.display, 'none');
});

test('200 favori sınırı: sınıra kadar eklenir ve söylenir; sınırdayken hiçbir şey eklenmez', async () => {
  const doksan = Array.from({ length: 199 }, (_, i) => ({ entity_id: `light.eski_${i}`, ad: `Eski ${i}` }));
  const sayfa = await sayfaAc({ ayar: { ...AYAR_BOS, favoriler: doksan } });
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Salon: favori sınırına (200) ulaşıldı; 1 cihaz eklenebildi. Kaydet’e basana kadar kaydedilmez.');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '200 favori seçili');
  await tikla(sayfa, ODA.ekle);
  assert.equal(durumMetni(sayfa), 'Favori sınırına (200) ulaşıldı; daha fazla cihaz eklenemez.');
  assert.equal(sayfa.oge('secilenSayisi').textContent, '200 favori seçili');
});

test('oda alınamazsa nedeni söylenir (canlı bağlantı yok, yetki yok, hata, boş liste); seçim kutusu kapalı kalır, düğme yeniden açılır', async () => {
  const durumlar = [
    [{ ok: false, neden: 'canli-yok' }, 'Odalar için Home Assistant’a canlı bağlantı gerekir. Bağlantı kurulunca yeniden dene.'],
    [{ ok: false, neden: 'yetki' }, 'Home Assistant oda bilgisini bu erişim anahtarıyla vermiyor (yönetici yetkisi gerekebilir). Cihazları aşağıdaki listeden elle seçebilirsin.'],
    [{ ok: false, neden: 'hata' }, 'Odalar alınamadı. Biraz sonra yeniden dene.'],
    [{ ok: false }, 'Odalar alınamadı. Biraz sonra yeniden dene.'],
    [{ ok: false, neden: '<img src=x>' }, 'Odalar alınamadı. Biraz sonra yeniden dene.'],
    [null, 'Odalar alınamadı. Biraz sonra yeniden dene.'],
    [{ ok: true, odalar: [] }, 'Önerilecek oda bulunamadı. Home Assistant’ta odaların (alanların) olması ve cihazların odalara atanmış olması gerekir.'],
  ];
  for (const [yanit, beklenen] of durumlar) {
    const sayfa = await sayfaAc({ aracYaniti: { odalariGetir: async () => yanit } });
    await tikla(sayfa, ODA.getir);
    assert.equal(durumMetni(sayfa), beklenen, JSON.stringify(yanit));
    assert.equal(sayfa.oge(ODA.sec).disabled, true);
    assert.equal(sayfa.oge(ODA.getir).disabled, false);
  }
  const patlayan = await sayfaAc({ aracYaniti: { odalariGetir: async () => { throw new Error('köprü koptu'); } } });
  await tikla(patlayan, ODA.getir);
  assert.equal(durumMetni(patlayan), 'Odalar alınamadı. Biraz sonra yeniden dene.');
  assert.equal(patlayan.oge(ODA.getir).disabled, false);
});

test('başarısız yeniden denemede önceki oda listesi temizlenir (eski öneri kalmaz)', async () => {
  let sayac = 0;
  const sayfa = await sayfaAc({ aracYaniti: { odalariGetir: async () => (++sayac === 1 ? { ok: true, odalar: [{ id: 'salon', ad: 'Salon', toplam: 1, cihazlar: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light' }] }] } : { ok: false, neden: 'canli-yok' }) } });
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  assert.equal(sayfa.oge(ODA.ekle).disabled, false);
  await tikla(sayfa, ODA.getir);
  assert.deepEqual(secenekler(sayfa), [['', 'Oda seç…']]);
  assert.equal(sayfa.oge(ODA.ekle).disabled, true);
  assert.equal(sayfa.oge(ODA.onizleme).style.display, 'none');
});

test('ana süreçten gelen bozuk oda kayıtları atılır; gelen metinler yalnız metin olarak yazılır', async () => {
  const kotu = '<img src=x onerror=alert(1)>';
  const yanit = {
    ok: true,
    odalar: [
      { id: 'a', ad: kotu, toplam: 1, cihazlar: [{ entity_id: 'light.salon_lambasi', ad: kotu, alan: 'light' }] },
      { id: 5, ad: 'Sayı Kimlik', cihazlar: [] },
      { id: 'b', ad: 'Cihazsız', cihazlar: [] },
      { id: 'c', ad: 'Bozuk Cihaz', cihazlar: [{ entity_id: 5, ad: 'x', alan: 'light' }, null, 'x'] },
      { id: 'd', ad: 'Cihaz Listesi Yok' },
      null,
      'x',
      { id: 'e', ad: 'Toplam Küçük', toplam: 0, cihazlar: [{ entity_id: 'scene.film', ad: 'Film', alan: 'scene' }] },
    ],
  };
  const sayfa = await sayfaAc({ aracYaniti: { odalariGetir: async () => yanit } });
  await tikla(sayfa, ODA.getir);
  assert.deepEqual(secenekler(sayfa), [['', 'Oda seç…'], ['a', `${kotu} (1)`], ['e', 'Toplam Küçük (1)']], 'geçersiz kayıtlar düştü; toplam cihaz sayısından küçükse cihaz sayısı olur');
  await odaSec(sayfa, 'a');
  assert.equal(onizlemeSatirlari(sayfa)[1], `• ${kotu} · Işıklar`);
  assert.equal(sayfa.oge(ODA.onizleme).children.every((c) => c.children.length === 0), true, 'metin düğümü dışında öğe yok (HTML olarak yorumlanmadı)');
});

test('kırpılmış öneri (toplam > gösterilen) başlıkta söylenir', async () => {
  const yanit = { ok: true, odalar: [{ id: 'salon', ad: 'Salon', toplam: 35, cihazlar: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light' }] }] };
  const sayfa = await sayfaAc({ aracYaniti: { odalariGetir: async () => yanit } });
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  assert.equal(onizlemeSatirlari(sayfa)[0], 'Salon: önerilen cihaz sayısı 35 (ilk 1 gösteriliyor)');
});

test('oda listesi alınırken düğme kapalıdır ve durum "alınıyor" der', async () => {
  let birak;
  const bekle = new Promise((coz) => { birak = coz; });
  const sayfa = await sayfaAc({ aracYaniti: { odalariGetir: async () => { await bekle; return { ok: true, odalar: [] }; } } });
  sayfa.oge(ODA.getir).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
  assert.equal(sayfa.oge(ODA.getir).disabled, true);
  assert.equal(durumMetni(sayfa), 'Odalar alınıyor…');
  birak();
  await akit();
  assert.equal(sayfa.oge(ODA.getir).disabled, false);
});

test('dil değişince seçim kutusu, önizleme başlıkları ve durum satırı yeni dilde yeniden yazılır; oda adları aynı kalır', async () => {
  const sayfa = await sayfaAc();
  await tikla(sayfa, ODA.getir);
  await odaSec(sayfa, 'salon');
  await tikla(sayfa, ODA.ekle);
  await sayfa.dilDegisti('en');
  assert.equal(durumMetni(sayfa), 'Salon: 2 devices were added to the selection. Nothing is saved until you press Save.');
  assert.deepEqual(secenekler(sayfa)[0], ['', 'Pick a room…']);
  assert.equal(sayfa.oge(ODA.sec).value, 'salon', 'seçili oda korunur');
  assert.equal(onizlemeSatirlari(sayfa)[0], 'Salon: suggested devices 2');
  assert.match(onizlemeSatirlari(sayfa)[1], /^• Salon Lambası · Lights · already selected$/);
  assert.equal(sayfa.oge(ODA.getir).textContent, 'Load rooms');
});

test('HTML: seçim kutusu etiketli, düğmeler type=button, durum satırı canlı bölge, önizleme etiketli ve klavyeyle kaydırılabilir; öneri bölümü cihaz listesinden önce', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  const betik = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.js'), 'utf8');
  assert.match(html, /<label for="odaSec" id="odaSeciciEtiketi" data-i18n="ayar\.oda\.baslik">/);
  assert.match(html, /<select id="odaSec" disabled>/);
  for (const kimlik of ['btnOdalariGetir', 'btnOdaEkle']) assert.match(html, new RegExp(`<button class="buton buton-ikincil" id="${kimlik}" type="button"`));
  assert.match(html, /id="odaDurum" role="status" aria-live="polite"/);
  assert.match(html, /id="odaOnizleme" role="region" tabindex="0" aria-labelledby="odaSeciciEtiketi"/);
  assert.ok(html.indexOf('id="odaSecici"') < html.indexOf('id="cihazAra"'));
  assert.doesNotMatch(betik, /odaOnizleme\.(innerHTML|outerHTML|insertAdjacentHTML)|odaSec\.(innerHTML|outerHTML)/);
});
