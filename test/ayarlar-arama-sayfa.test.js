'use strict';

/**
 * Ayarlar sayfasında arama bağlantısı (o-26): src/ayarlar.js'in arama kutusu, durum satırı, Temizle düğmesi ve klavye (Esc, Enter, Ctrl+F) kablolaması.
 * Süzme mantığının kendisi test/ayar-arama.test.js'tedir; burada GERÇEK src/lib/ayar-arama.js, sahte Ayarlar sayfası (test/ayarlar-sahte.js,
 * `aramaModulu: true`) ve gerçek ayarlar.html ağacıyla uçtan uca bağlanır. Tarayıcı ve Electron yok.
 * Ortak düzenek modülü varsayılan olarak YÜKLEMEZ (ayarlar.js modülsüz de çalışmalı); src/ayarlar-kategori.js düzeneğe hiç yüklenmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa, tusOlayi } = require('./ayarlar-sahte');
const { GIZLI_SINIF } = require('../src/lib/ayar-arama');

const SORGU = 'tepsi simgesine'; // yalnız Pencere bölümündeki "tepsiSolTik" ayarında geçer (test/ayar-arama.test.js ile aynı)
const SORGU_YOK = 'sadece yardim metninde olmayan';

const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, ...ek });
const yaz = async (sayfa, metin) => {
  const kutu = sayfa.oge('ayarAra');
  kutu.value = metin;
  kutu.dispatchEvent({ type: 'input' });
  await akit();
};
const gizliMi = (oge) => oge.classList.contains(GIZLI_SINIF);
const gorunenBolumler = (sayfa) => sayfa.aramaAgaci.querySelectorAll('.bolum').filter((b) => !gizliMi(b)).map((b) => b.id);
const gizlenenVarMi = (sayfa) => sayfa.aramaAgaci.querySelectorAll('.bolum, .form-grubu, .grup-baslik').some(gizliMi);
const grup = (sayfa, girdiKimligi) => sayfa.aramaAgaci.getElementById(girdiKimligi).closest('.form-grubu');
const durum = (sayfa) => sayfa.oge('ayarAramaDurum').textContent;
const temizleGorunur = (sayfa) => sayfa.oge('btnAyarAraTemizle').style.display === 'inline-flex';

test('modül yüklüyken: yazdıkça ayar kümeleri süzülür, durum satırı bölüm sayısını yazar, Temizle görünür; kutu boşalınca sayfa eski haline döner', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  assert.equal(sayfa.modulYuklu('EvAyarArama'), true);
  assert.equal(durum(sayfa), '');
  assert.equal(temizleGorunur(sayfa), false);

  await yaz(sayfa, SORGU);
  assert.deepEqual(gorunenBolumler(sayfa), ['bolumPencere']);
  assert.equal(gizliMi(grup(sayfa, 'tepsiSolTik')), false);
  assert.equal(gizliMi(grup(sayfa, 'pencereBoyutu')), true, 'eşleşmeyen ayar kümesi gizli');
  assert.equal(durum(sayfa), '1 bölümde eşleşme var');
  assert.equal(temizleGorunur(sayfa), true);

  await yaz(sayfa, SORGU_YOK);
  assert.deepEqual(gorunenBolumler(sayfa), []);
  assert.equal(durum(sayfa), 'Eşleşen ayar yok');
  assert.equal(temizleGorunur(sayfa), true);

  await yaz(sayfa, '   ');
  assert.equal(durum(sayfa), '');
  assert.equal(temizleGorunur(sayfa), false);
  assert.equal(gizlenenVarMi(sayfa), false, 'arama bitince hiçbir şey gizli kalmaz');
});

test('Esc önce aramayı temizler ve olayı yutar (pencere kapanmaz); kutu boşken Esc\'e dokunmaz', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  await yaz(sayfa, SORGU);
  assert.equal(gizlenenVarMi(sayfa), true);
  const esc = tusOlayi({ key: 'Escape' });
  sayfa.oge('ayarAra').dispatchEvent(esc);
  assert.equal(esc.onlendi, true);
  assert.equal(esc.durduruldu, true, 'belge düzeyindeki "Esc pencereyi kapatır" kuralına ulaşmaz');
  assert.equal(sayfa.oge('ayarAra').value, '');
  assert.equal(durum(sayfa), '');
  assert.equal(temizleGorunur(sayfa), false);
  assert.equal(gizlenenVarMi(sayfa), false);

  const bosEsc = tusOlayi({ key: 'Escape' });
  sayfa.oge('ayarAra').dispatchEvent(bosEsc);
  assert.equal(bosEsc.onlendi, false, 'kutu boşken olay yutulmaz: Esc normal akışa (pencereyi kapatma sorusu) gider');
  assert.equal(bosEsc.durduruldu, false);
});

test('Temizle düğmesi aramayı bırakır ve kutuya odaklanır', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  await yaz(sayfa, SORGU);
  assert.equal(temizleGorunur(sayfa), true);
  const odakOnce = sayfa.oge('ayarAra').odaklanma;
  sayfa.oge('btnAyarAraTemizle').tikla();
  await akit();
  assert.equal(sayfa.oge('ayarAra').value, '');
  assert.equal(durum(sayfa), '');
  assert.equal(temizleGorunur(sayfa), false);
  assert.equal(gizlenenVarMi(sayfa), false);
  assert.equal(sayfa.oge('ayarAra').odaklanma, odakOnce + 1);
  assert.equal(sayfa.sonOdak(), sayfa.oge('ayarAra'));
});

test('Enter ilk eşleşen ayara kaydırır; eşleşme yokken Enter zararsızdır', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  await yaz(sayfa, SORGU);
  const kaydirmalar = [];
  grup(sayfa, 'tepsiSolTik').scrollIntoView = (secenek) => kaydirmalar.push(secenek.block);
  const enter = tusOlayi({ key: 'Enter' });
  sayfa.oge('ayarAra').dispatchEvent(enter);
  assert.equal(enter.onlendi, true);
  assert.deepEqual(kaydirmalar, ['center']);

  await yaz(sayfa, SORGU_YOK);
  sayfa.oge('ayarAra').dispatchEvent(tusOlayi({ key: 'Enter' }));
  assert.deepEqual(kaydirmalar, ['center'], 'eşleşme yok: kaydırılacak öğe yok');
});

test('Ctrl+F arama kutusuna odaklanır (tarayıcının kendi bul penceresi açılmaz)', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  const olay = sayfa.belgeTusu({ ctrlKey: true, key: 'f' });
  assert.equal(olay.onlendi, true);
  assert.equal(sayfa.sonOdak(), sayfa.oge('ayarAra'));
  const buyuk = sayfa.belgeTusu({ ctrlKey: true, key: 'F', shiftKey: true });
  assert.equal(buyuk.onlendi, false, 'Ctrl+Shift+F bu kısayol değildir');
});

test('dil değişince aynı sorgu yeniden uygulanır: durum satırı yeni dilde yazılır; sorgu yokken durum boş kalır', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  await sayfa.dilDegisti('en');
  assert.equal(durum(sayfa), '', 'sorgu yok: durum yazılmaz');
  await yaz(sayfa, SORGU);
  assert.equal(durum(sayfa), 'Matches in 1 section');
  await sayfa.dilDegisti('de');
  assert.equal(durum(sayfa), 'Treffer in 1 Abschnitt');
  assert.deepEqual(gorunenBolumler(sayfa), ['bolumPencere'], 'süzme dil değişiminde bozulmaz');
  await yaz(sayfa, SORGU_YOK);
  await sayfa.dilDegisti('fr');
  assert.equal(durum(sayfa), 'Aucun paramètre correspondant');
});

test('modül yüklenmediyse (ayarlar.js modülsüz çalışır) arama kutusu zararsızdır: durum boş, Temizle görünmez, hiçbir şey gizlenmez', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.modulYuklu('EvAyarArama'), false);
  assert.equal(sayfa.aramaAgaci, null);
  await yaz(sayfa, SORGU);
  assert.equal(durum(sayfa), '');
  assert.equal(temizleGorunur(sayfa), false);
  sayfa.oge('ayarAra').dispatchEvent(tusOlayi({ key: 'Enter' }));
  const esc = tusOlayi({ key: 'Escape' });
  sayfa.oge('ayarAra').dispatchEvent(esc);
  assert.equal(esc.onlendi, true);
  assert.equal(sayfa.oge('ayarAra').value, '', 'Esc kutuyu yine boşaltır');
  await sayfa.dilDegisti('en');
  assert.equal(durum(sayfa), '');
});

test('ayarlar-kategori.js yüklenmezse sayfa tek uzun sayfa gibi çalışır: arama ve bölüm bağlantıları kategori modülü olmadan sorunsuzdur', async () => {
  const sayfa = await sayfaAc({ aramaModulu: true });
  assert.equal(sayfa.modulYuklu('EvAyarKategori'), false, 'düzenek kategori modülünü yüklemez');
  await yaz(sayfa, SORGU);
  assert.equal(durum(sayfa), '1 bölümde eşleşme var');
  assert.deepEqual(gorunenBolumler(sayfa), ['bolumPencere']);
  const baglanti = tusOlayi({ type: 'click' });
  sayfa.oge('gezinGorunum').dispatchEvent({ type: 'click', preventDefault: baglanti.preventDefault });
  assert.equal(baglanti.onlendi, true);
  assert.equal(sayfa.oge('bolumGorunum').kaydirma, 1, 'bölüme kaydırır');
  assert.equal(sayfa.sonOdak(), sayfa.oge('gorunumBaslik'), 'başlığa odaklanır');
  await yaz(sayfa, '');
  assert.equal(gizlenenVarMi(sayfa), false);
});
