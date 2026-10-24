'use strict';

/**
 * Ayarlar > Dış tetikler bölümü (1.4.0 dis grubu: src/ayarlar-dis.js + ayarlar.js kancaları) sahte DOM ile (test/ayarlar-sahte.js).
 * Gerçek pencere, Electron ya da ana süreç YOK: köprü (evPaneli.dis*) sahtedir. Denetlenenler: varsayılan kapalı, kayıt yüküne giden alanlar,
 * PC olayları ve "açma" izni için onay, kural satırları, düğmeler (kısayol, bağlantı, jeton, izin kaldırma) ve jetonun sayfaya hiç gelmemesi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const AYARLAR = require('../src/lib/ceviri/ayarlar');
const { AYAR, acilmisSayfa, akit, duzles, gorunurMetinler } = require('./ayarlar-sahte');

const tr = (k, d = {}) => AYARLAR.tr[k].replace(/\{(\w+)\}/g, (_, a) => String(d[a]));
const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonYuk = (sayfa) => duzles(sayfa.cagrilar.filter((c) => c[0] === 'ayarlariKaydet').at(-1)[1]);
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const sec = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'change' });
};
const secenekler = (oge) => oge.children.map((o) => [o.value, o.textContent]);
const disCagrilari = (sayfa) => sayfa.cagrilar.filter((c) => c[0].startsWith('dis'));

const DOLU_DURUM = {
  ok: true,
  uygunlar: [{ kimlik: 'light.salon', ad: 'Salon' }, { kimlik: 'scene.film', ad: 'Film' }],
  kuralUygunlari: [{ kimlik: 'light.salon', ad: 'Salon', acKapa: true }, { kimlik: 'scene.film', ad: 'Film', acKapa: false }],
  izinler: [{ kimlik: 'light.salon', ad: 'Salon' }, { kimlik: 'light.eski', ad: null }],
  api: { calisiyor: true, port: 48123, hata: null, jetonVar: true },
  protokol: { kayitli: true },
  toplanti: { calisiyor: true, duraklatildi: false, toplantida: true, okunabilir: true },
};

test('varsayılan: her dış tetik kapalı; açılışta yalnız durum okunur (eylem yok); kayıt yükü varsayılanları taşır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR });
  for (const kimlik of ['disJumpList', 'disMasaustu', 'disProtokol', 'disYerelApi', 'disApiBildirim', 'disPcOlaylari', 'disPcAcma', 'disToplanti']) {
    assert.equal(sayfa.oge(kimlik).checked, false, kimlik);
  }
  assert.deepEqual(disCagrilari(sayfa), [], 'açılışta kısayol/bağlantı/jeton işlemi yapılmaz');
  assert.equal(sayfa.oge('disUygunlarIpucu').textContent, tr('ayar.dis.uygunYok'));
  assert.equal(sayfa.oge('disApiPortu').value, '48123');
  assert.equal(sayfa.oge('disToplantiAralik').value, '10');
  assert.equal(sayfa.oge('btnDisPcKuralEkle').disabled, true, 'uygun favori yokken kural eklenemez');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.deepEqual(
    Object.fromEntries(Object.entries(yuk).filter(([k]) => k.startsWith('tetik'))),
    {
      tetikJumpList: false,
      tetikMasaustu: false,
      tetikProtokol: false,
      tetikYerelApi: false,
      tetikApiPortu: '48123',
      tetikApiBildirim: false,
      tetikPcOlaylari: false,
      tetikPcAcma: false,
      tetikPcKurallari: [],
      tetikToplanti: false,
      tetikToplantiKaynak: 'ikisi',
      tetikToplantiFavori: '',
      tetikToplantiBitis: 'geriYukle',
      tetikToplantiBitisFavori: '',
      tetikToplantiAralik: '10',
    },
  );
  assert.equal(Object.hasOwn(yuk, 'tetikProtokolIzinleri'), false, 'izin listesini yalnız ana süreç yazar');
  assert.equal(Object.hasOwn(yuk, 'tetikPcUyarisi'), false);
});

test('durum: uygun favoriler, izinler, API ve toplantı satırları; jeton sayfaya hiç gelmez; izin kaldırma köprüden gider', async () => {
  let okuma = 0;
  const sayfa = await acilmisSayfa({ ayar: AYAR, disYaniti: { disTetikDurumu: () => ((okuma += 1), DOLU_DURUM) } });
  assert.equal(sayfa.oge('disUygunlarIpucu').textContent, tr('ayar.dis.uygunlar', { liste: 'Salon, Film' }));
  assert.deepEqual(secenekler(sayfa.oge('disKisayolFavori')), [['', tr('ayar.dis.favoriSec')], ['light.salon', 'Salon'], ['scene.film', 'Film']]);
  assert.deepEqual(secenekler(sayfa.oge('disToplantiFavori'))[0], ['', tr('ayar.dis.favoriYok')]);
  const izinler = sayfa.oge('disIzinListesi').children;
  assert.equal(izinler.length, 2);
  assert.equal(izinler[1].children[0].textContent, tr('ayar.dis.favoriDegil', { ad: 'light.eski' }));
  assert.equal(sayfa.oge('disIzinBos').textContent, '');
  assert.match(sayfa.oge('disApiDurum').textContent, /127\.0\.0\.1:48123/);
  assert.equal(sayfa.oge('disApiOrnekGovde').textContent, '{"ad":"Salon"}');
  assert.equal(sayfa.oge('disProtokolDurum').textContent, tr('ayar.dis.protokolKayitli'));
  assert.equal(sayfa.oge('disToplantiDurum').textContent, tr('ayar.dis.toplantiDurum.toplantida'));
  assert.ok(!gorunurMetinler(sayfa).some(([, m]) => /jeton\s*[:=]|Bearer [A-Za-z0-9_-]{10,}/.test(m)), 'jeton metni yok');

  izinler[0].children[1].dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(disCagrilari(sayfa), [['disIzinKaldir', 'light.salon']]);
  const once = okuma;
  await sayfa.disDurumDegisti();
  assert.equal(okuma, once + 1, 'ana süreç olayı durumu yeniden okutur');
});

test('masaüstü kısayolu: seçenek kaydedilmeden ve favori seçilmeden köprü çağrılmaz; sonuç bildirilir', async () => {
  const kapali = await acilmisSayfa({ ayar: AYAR, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  kapali.oge('btnDisKisayolOlustur').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(kapali.oge('disKisayolDurum').textContent, tr('ayar.dis.secimGerekli'));
  sec(kapali.oge('disKisayolFavori'), 'light.salon');
  kapali.oge('btnDisKisayolOlustur').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(kapali.oge('disKisayolDurum').textContent, tr('ayar.dis.kaydetGerekli'));
  assert.deepEqual(disCagrilari(kapali), []);

  const acik = await acilmisSayfa({ ayar: { ...AYAR, tetikMasaustu: true }, disYaniti: { disTetikDurumu: DOLU_DURUM, disKisayolOlustur: { ok: true, dosya: 'Salon (2).lnk' } } });
  sec(acik.oge('disKisayolFavori'), 'light.salon');
  acik.oge('btnDisKisayolOlustur').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(disCagrilari(acik), [['disKisayolOlustur', 'light.salon']]);
  assert.equal(acik.oge('disKisayolDurum').textContent, tr('ayar.dis.kisayolKondu', { dosya: 'Salon (2).lnk' }));
  const red = await acilmisSayfa({ ayar: { ...AYAR, tetikMasaustu: true }, disYaniti: { disTetikDurumu: DOLU_DURUM, disKisayolOlustur: { ok: false, hata: 'uygun-degil' } } });
  sec(red.oge('disKisayolFavori'), 'scene.film');
  red.oge('btnDisKisayolOlustur').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(red.oge('disKisayolDurum').textContent, tr('ayar.dis.favoriUygunDegil'));
});

test('bağlantı ve jeton: kopyalama köprüden; jeton yenileme onay ister, reddedilirse çağrı yok', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, onayYaniti: false, disYaniti: { disTetikDurumu: { ...DOLU_DURUM, protokol: { kayitli: false } } } });
  sec(sayfa.oge('disBaglantiFavori'), 'scene.film');
  sayfa.oge('btnDisBaglantiKopyala').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(disCagrilari(sayfa), [['disBaglantiKopyala', 'scene.film']]);
  assert.match(sayfa.oge('disProtokolDurum').textContent, new RegExp(tr('ayar.dis.baglantiKopyalandi').replace('.', '\\.')));
  assert.match(sayfa.oge('disProtokolDurum').textContent, new RegExp(tr('ayar.dis.protokolKayitsiz').replace('.', '\\.')));

  sayfa.oge('btnDisJetonKopyala').dispatchEvent({ type: 'click' });
  await akit();
  assert.deepEqual(disCagrilari(sayfa).at(-1), ['disJetonKopyala']);
  assert.match(sayfa.oge('disApiDurum').textContent, /Jeton panoya kopyalandı/);
  sayfa.oge('btnDisJetonYenile').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.sorular.at(-1), tr('ayar.dis.jetonYenileOnay'));
  assert.equal(disCagrilari(sayfa).some((c) => c[0] === 'disJetonYenile'), false, 'onay verilmedi: jeton değişmez');
});

test('PC olayları: açmak onay ister (reddedilirse kapalı kalır); kural eklenir, sahne yalnız "çalıştır" alır ve açma izni uyarısı çıkar', async () => {
  const red = await acilmisSayfa({ ayar: AYAR, onayYaniti: false, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  red.oge('disPcOlaylari').tikla();
  assert.equal(red.oge('disPcOlaylari').checked, false);
  assert.equal(red.sorular.at(-1), tr('ayar.dis.pcUyari'));
  assert.equal(kirliMi(red), false);

  const sayfa = await acilmisSayfa({ ayar: AYAR, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  sayfa.oge('disPcOlaylari').tikla();
  assert.equal(sayfa.oge('disPcOlaylari').checked, true);
  assert.equal(kirliMi(sayfa), true);
  sayfa.oge('btnDisPcKuralEkle').dispatchEvent({ type: 'click' });
  const kart = sayfa.oge('disPcKuralListesi').children[0];
  assert.ok(kart, 'kural satırı çizildi');
  const [olay, islem, favori] = kart.bul((o) => o.etiket === 'select');
  assert.deepEqual([olay.value, islem.value, favori.value], ['kilit', 'kapat', 'light.salon']);
  assert.deepEqual(islem.children.map((o) => o.value), ['kapat', 'ac', 'calistir', 'geriYukle']);
  sec(favori, 'scene.film');
  const yeniKart = sayfa.oge('disPcKuralListesi').children[0];
  const [, yeniIslem] = yeniKart.bul((o) => o.etiket === 'select');
  assert.deepEqual(yeniIslem.children.map((o) => o.value), ['calistir'], 'sahne aç/kapa almaz');
  assert.equal(yeniKart.bul((o) => o.className === 'kural-hata')[0].textContent, tr('ayar.dis.kural.acmaGerekli'));
  sec(yeniKart.bul((o) => o.etiket === 'select')[0], 'uyanis');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa).tetikPcKurallari, [{ olay: 'uyanis', kimlik: 'scene.film', islem: 'calistir' }]);
  assert.equal(sonYuk(sayfa).tetikPcOlaylari, true);
  assert.equal(sonYuk(sayfa).tetikPcAcma, false);

  // açma izni de onay ister; kaydedilmiş açık değere dönüşte yeniden sorulmaz
  const soruSayisi = sayfa.sorular.length;
  sayfa.oge('disPcAcma').tikla();
  assert.equal(sayfa.sorular.length, soruSayisi + 1);
  assert.equal(sayfa.sorular.at(-1), tr('ayar.dis.pcAcmaOnay'));
});

test('PC kuralı satırında seçici değişince liste yeniden çizilir ama klavye odağı aynı kimlikli yeni seçicide kalır (durum yenilemesinde de)', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  sayfa.oge('btnDisPcKuralEkle').dispatchEvent({ type: 'click' });
  const seciciler = () => sayfa.oge('disPcKuralListesi').children[0].bul((o) => o.etiket === 'select');
  const [, , eskiFavori] = seciciler();
  eskiFavori.focus();
  sec(eskiFavori, 'scene.film');
  const yeniFavori = seciciler()[2];
  assert.notEqual(yeniFavori, eskiFavori, 'liste yeniden çizildi');
  assert.equal(sayfa.sonOdak(), yeniFavori, 'odak DOM dışına çıkan eski seçiciden yeni seçiciye geçti');
  assert.equal(sayfa.sonOdak().id, 'disPcKural1Favori');

  const eskiOlay = seciciler()[0];
  eskiOlay.focus();
  await sayfa.disDurumDegisti();
  const yeniOlay = seciciler()[0];
  assert.notEqual(yeniOlay, eskiOlay, 'durum yenilemesi de listeyi yeniden çizer');
  assert.equal(sayfa.sonOdak(), yeniOlay);
  assert.equal(sayfa.sonOdak().id, 'disPcKural1Olay');

  // kural girdisi dışındaki odak (örn. Ekle düğmesi) yeniden çizimde yer değiştirmez
  sayfa.oge('btnDisPcKuralEkle').focus();
  await sayfa.disDurumDegisti();
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnDisPcKuralEkle'));
});

test('PC kuralı: ikinci kural aynı olay + favoriyle gelmez; elle tekrar ya da boş favori yapılırsa satırda "kaydedilmez" uyarısı çıkar', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  const ekle = () => sayfa.oge('btnDisPcKuralEkle').dispatchEvent({ type: 'click' });
  const kart = (i) => sayfa.oge('disPcKuralListesi').children[i];
  const uyari = (i) => kart(i).bul((o) => o.className === 'kural-hata')[0];
  const seciciler = (i) => kart(i).bul((o) => o.etiket === 'select');
  ekle();
  ekle();
  const [olay1, , favori1] = seciciler(0);
  const [olay2, , favori2] = seciciler(1);
  assert.deepEqual([olay1.value, favori1.value], ['kilit', 'light.salon']);
  assert.deepEqual([olay2.value, favori2.value], ['kilitAcildi', 'light.salon'], 'aynı favoride kullanılmamış ilk olay seçilir');
  assert.equal(uyari(1).textContent, '');

  sec(olay2, 'kilit');
  assert.equal(uyari(1).textContent, tr('ayar.dis.kural.tekrar'), 'üstteki satırla aynı (olay, favori): kayıtta düşer');
  assert.equal(uyari(1).style.display, 'block');
  assert.equal(uyari(0).textContent, '', 'ilk satır tutulur, uyarı yok');
  sec(seciciler(1)[0], 'uyku');
  assert.equal(uyari(1).textContent, '', 'olay değişince uyarı kalkar');

  sec(seciciler(0)[2], '');
  assert.equal(uyari(0).textContent, tr('ayar.dis.kural.favoriBos'));
  assert.equal(uyari(1).textContent, '');
  assert.equal(kirliMi(sayfa), true);
});

test('kayıtlı kurallar ve toplantı ışığı sunucudan yüklenir; listede olmayan favori "uygun değil" olarak korunur; bitiş favorisi yalnız seçilince görünür', async () => {
  const ayar = {
    ...AYAR,
    tetikPcOlaylari: true,
    tetikPcKurallari: [{ olay: 'kilit', kimlik: 'light.salon', islem: 'kapat' }, { olay: 'uyku', kimlik: 'light.gitti', islem: 'kapat' }],
    tetikToplanti: true,
    tetikToplantiKaynak: 'kamera',
    tetikToplantiFavori: 'light.salon',
    tetikToplantiBitis: 'kapat',
    tetikToplantiAralik: 20,
    tetikApiPortu: 48200,
  };
  const sayfa = await acilmisSayfa({ ayar, disYaniti: { disTetikDurumu: DOLU_DURUM } });
  assert.equal(kirliMi(sayfa), false, 'yükleme kirli yapmaz');
  assert.equal(sayfa.oge('disPcKuralListesi').children.length, 2);
  const ikinciFavori = sayfa.oge('disPcKuralListesi').children[1].bul((o) => o.etiket === 'select')[2];
  assert.deepEqual(secenekler(ikinciFavori).at(-1), ['light.gitti', tr('ayar.dis.uygunDegil', { ad: 'light.gitti' })]);
  assert.equal(sayfa.oge('disToplantiKaynak').value, 'kamera');
  assert.equal(sayfa.oge('disToplantiFavori').value, 'light.salon');
  assert.equal(sayfa.oge('disApiPortu').value, '48200');
  assert.equal(sayfa.oge('disToplantiBitisFavoriGrubu').style.display, 'none');
  sec(sayfa.oge('disToplantiBitis'), 'favori');
  assert.equal(sayfa.oge('disToplantiBitisFavoriGrubu').style.display, 'block');
  sec(sayfa.oge('disToplantiBitisFavori'), 'scene.film');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa);
  assert.equal(yuk.tetikToplantiBitis, 'favori');
  assert.equal(yuk.tetikToplantiBitisFavori, 'scene.film');
  assert.equal(yuk.tetikToplantiAralik, '20');
  assert.equal(yuk.tetikPcKurallari.length, 2);
});

test('İngilizce: bölümün sabit ve durum metinleri İngilizce, Türkçe harf yok', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR, dil: 'en', dilAyari: 'en' }, disYaniti: { disTetikDurumu: { ...DOLU_DURUM, uygunlar: [{ kimlik: 'light.salon', ad: 'Living room' }], kuralUygunlari: [], izinler: [] } } });
  assert.equal(sayfa.oge('disUygunlarIpucu').textContent, AYARLAR.en['ayar.dis.uygunlar'].replace('{liste}', 'Living room'));
  assert.equal(sayfa.oge('disIzinBos').textContent, AYARLAR.en['ayar.dis.izinBos']);
  assert.equal(sayfa.oge('disPcKuralBos').textContent, AYARLAR.en['ayar.dis.kural.bos']);
  for (const kimlik of ['disApiDurum', 'disProtokolDurum', 'disToplantiDurum', 'disUygunlarIpucu']) {
    assert.doesNotMatch(sayfa.oge(kimlik).textContent, /[çğıöşüÇĞİÖŞÜ]/, kimlik);
  }
});
