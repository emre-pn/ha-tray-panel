'use strict';

/**
 * Ayar alanı kaydı — 1.4.0 ortak altyapı (saf). Şema 6'dan itibaren yeni ayar alanları ayar-sema.js'e TEK TEK elle değil,
 * buradaki AYAR_ALANLARI tablosuna birer satır olarak eklenir; okuma (ayarlariDuzelt), kaydetme doğrulaması
 * (ayarGirdisiniDogrula), Ayarlar özeti (main.js ayarOzeti), dışa/içe aktarma (ayar-yedegi.js) ve tip denetimi (h-33) tablodan
 * kendiliğinden yürür. Böylece her özellik grubu yalnız kendi satırını ekler; ayar-sema.js / ayar-kaydet.js / main.js'te çakışma olmaz.
 *
 * AYAR ALANI EKLEME KALIBI (ajanlar için):
 *   1) Aşağıdaki AYAR_ALANLARI dizisine, kendi grubunun yorum başlığı altında, yardımcılardan biriyle satır ekle:
 *        mantiksalAlan('panelHerZamanUstte', false),
 *        secenekAlan('saatBicimi', ['24', '12'], '24'),
 *        tamsayiAlan('metinOlcegi', 100, 150, 100),
 *        metinAlan('havaVarligi', { enUzun: 120, desen: /^weather\.[a-z0-9_]+$/, varsayilan: '' }),
 *        kimlikListesiAlan('seritSensorleri', { enCok: 8, alanlar: ['sensor', 'binary_sensor'] }),
 *        kimlikAlan('yapilacakListesi', { alanlar: ['todo'] }),
 *        nesneAlan('uyariKurallari', { varsayilan: [], duzelt: (ham) => kurallariDuzelt(ham) }),
 *      Ek seçenekler (son bağımsız değişken): { surum: 6, aktarilir: true, ozette: true, gizli: false }
 *        surum      alanın eklendiği şema sürümü (varsayılan GUNCEL_EK_SURUM = 6)
 *        aktarilir  dışa/içe aktarmaya girer mi (varsayılan true). Sır taşıyan alan EKLENMEZ: sırlar (anahtar, parola, webhook
 *                   kimliği) ayar dosyasına hiç yazılmaz; anahtar-deposu.js gibi şifreli ayrı depoda durur.
 *        ozette     Ayarlar sayfasına ayarOzeti ile gider mi (varsayılan true)
 *   2) Varsayılanı gerekiyorsa varsayilan-ayarlar.json'a da yaz (yoksa tablodaki varsayılan kullanılır).
 *   3) Değişiklik anında bir şey yapılacaksa main.js'te ekAyarDinle('ad', (yeni, eski) => ...) ile dinleyici ekle.
 *   4) Ayarlar sayfası (ayarlar.js) alanı ayarlar:kaydet yükünde aynı adla gönderir; doğrulama buradaki duzelt ile yapılır
 *      (geçersiz değer mevcut değeri korur ve 'kaydet.ekAlanGecersiz' uyarısı verilir).
 *   5) Göç gerekiyorsa (eski bir alandan değer taşımak gibi) GOCLER'e { surum, uygula(ayarlar, ham, notlar) } ekle; şema
 *      sürümünü yalnız birleştirme ajanı artırır (ayar-sema.js SEMA_SURUMU), tek sürümde birden çok grup aynı göçü paylaşır.
 *   6) test/ayar-alanlari.test.js kalıbıyla (alanlariDuzelt / ekGirdiDogrula / ekAyarlariUygula, kendi listesiyle) test yaz.
 *
 * Kurallar: duzelt hiçbir zaman fırlatmaz; geçersiz ham değer için `undefined` döner (varsayılana düşülür). Varlık kimliği
 * taşıyan alanlar Kapı Kuralı'ndan geçer (kapı/kilit kimliği ayara yazılamaz). Hiçbir alan dışarıya istek seçeneğini varsayılan
 * AÇIK yapamaz (dış ağ seçenekleri mantiksalAlan(..., false)).
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, metinGuvenliMi } = require('./suzgec');
const { kayitliAlanMi } = require('./alan-kaydi');
const { kisalt } = require('./metin');
const { sayfalariDuzelt } = require('./sayfalar');
const { KONUM_MODLARI, VARSAYILAN_KONUM_MODU, OPAKLIK_SINIRI, konumlariDuzelt, tercihEkranDuzelt } = require('./pencere-yerlesim');
const { EN_COK_KARO, SABITLENEBILIR_ALANLAR, karoKonumlariniDuzelt } = require('./masaustu-karo');
const { METIN_OLCEKLERI, VARSAYILAN_METIN_OLCEGI, HAZIR_TEMA_ADLARI, HAVA_EFEKTI_DEGERLERI, MEVSIM_EFEKTI_DEGERLERI, vurguRengiDuzelt } = require('./gorunum');
const { kurallariDuzelt } = require('./uyari-kurallari');
const { kameraIzinleriniDuzelt, YENILEME_SECENEKLERI: KAMERA_YENILEME_SECENEKLERI } = require('./kamera');
const { ORTA_TIK_ALANLARI } = require('./orta-tik');
const { GECIKME_SINIRI: BAGLANTI_GECIKME } = require('./baglanti-bildirimi');
const { pcKurallariDuzelt } = require('./pc-olaylari');
const { KAYNAK_SECENEKLERI: TOPLANTI_KAYNAKLARI } = require('./toplanti-isigi');
const { kisayolNormallestir, kisayolDogrula } = require('./kisayol');
const { BOLUM_ADLARI, klasorYoluDuzelt, bolumListesiDuzelt, durumDuzelt } = require('./esitleme-bolumleri');

const GUNCEL_EK_SURUM = 6;
const KART_VARLIK_ALANLARI = Object.freeze(['sensor', 'binary_sensor']); // üst kartta gösterilebilen (salt okunur) varlık alanları
const KORUNAN_ADLAR = new Set(['__proto__', 'constructor', 'prototype', 'semaSurumu']);
const AD_DESENI = /^[a-z][A-Za-z0-9]{1,40}$/;

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

function tanim(ad, tip, varsayilan, duzelt, ek = {}) {
  if (typeof ad !== 'string' || !AD_DESENI.test(ad) || KORUNAN_ADLAR.has(ad)) throw new Error(`ayar-alanlari: invalid field name ${ad}`);
  return Object.freeze({
    ad,
    tip, // ayar-sema.js tip denetimi: 'metin' | 'mantiksal' | 'sayi' | 'dizi' | 'nesne'
    varsayilan,
    duzelt,
    surum: Number.isInteger(ek.surum) ? ek.surum : GUNCEL_EK_SURUM,
    aktarilir: ek.aktarilir !== false,
    ozette: ek.ozette !== false,
  });
}

/** Açık/kapalı. Varsayılan dış ağ seçeneklerinde false olmalıdır. */
function mantiksalAlan(ad, varsayilan = false, ek) {
  return tanim(ad, 'mantiksal', varsayilan === true, (ham) => (typeof ham === 'boolean' ? ham : undefined), ek);
}

/** Sabit değer kümesinden biri. */
function secenekAlan(ad, degerler, varsayilan, ek) {
  const liste = Object.freeze([...degerler]);
  if (!liste.includes(varsayilan)) throw new Error(`ayar-alanlari: default not in list ${ad}`);
  return tanim(ad, typeof varsayilan === 'number' ? 'sayi' : 'metin', varsayilan, (ham) => (liste.includes(ham) ? ham : undefined), ek);
}

/** Tamsayı [min, max]; metin sayı ("15") da kabul edilir. */
function tamsayiAlan(ad, min, max, varsayilan, ek) {
  return tanim(
    ad,
    'sayi',
    varsayilan,
    (ham) => {
      const n = typeof ham === 'number' ? ham : typeof ham === 'string' && ham.trim() !== '' ? Number(ham) : NaN;
      return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
    },
    ek,
  );
}

/** Kısa metin: kısaltılır, isteğe bağlı desenle sınanır; suz: true ise Kapı Kuralı süzgecinden geçer. */
function metinAlan(ad, { enUzun = 100, desen = null, varsayilan = '', suz = true } = {}, ek) {
  return tanim(
    ad,
    'metin',
    varsayilan,
    (ham) => {
      if (typeof ham !== 'string' || ham.length > enUzun * 4) return undefined;
      const m = kisalt(ham, enUzun);
      if (m === '') return '';
      if (desen && !desen.test(m)) return undefined;
      if (suz && !metinGuvenliMi(m)) return undefined;
      return m;
    },
    ek,
  );
}

function kimlikGecerliMi(kimlik, alanlar) {
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
  const alan = alanAl(kimlik);
  if (!kayitliAlanMi(alan) || (alanlar && !alanlar.includes(alan))) return false;
  return adGuvenliMi(kimlik, ''); // kapı/kilit kimliği ayara yazılamaz (adın kendisi canlı durumla ayrıca denetlenir)
}

/** Tek varlık kimliği ('' = seçilmedi). Kimlik Kapı Kuralı'ndan ve alan listesinden geçmelidir. */
function kimlikAlan(ad, { alanlar = null } = {}, ek) {
  return tanim(ad, 'metin', '', (ham) => (ham === '' ? '' : kimlikGecerliMi(ham, alanlar) ? ham : undefined), ek);
}

/** Varlık kimliği listesi (tekrarsız, en çok enCok); geçersiz öğe sessizce düşer, dizi değilse undefined. */
function kimlikListesiAlan(ad, { enCok = 20, alanlar = null } = {}, ek) {
  return tanim(
    ad,
    'dizi',
    Object.freeze([]),
    (ham) => {
      if (!Array.isArray(ham)) return undefined;
      const sonuc = [];
      for (const k of ham) if (sonuc.length < enCok && kimlikGecerliMi(k, alanlar) && !sonuc.includes(k)) sonuc.push(k);
      return sonuc;
    },
    ek,
  );
}

/** Serbest yapı: duzelt(ham) doğrulanmış kopya döner ya da undefined. tip: 'dizi' | 'nesne'. */
function nesneAlan(ad, { varsayilan, duzelt, tip = Array.isArray(varsayilan) ? 'dizi' : 'nesne' } = {}, ek) {
  if (typeof duzelt !== 'function') throw new Error(`ayar-alanlari: duzelt required ${ad}`);
  return tanim(ad, tip, varsayilan, duzelt, ek);
}

// --- Grup "tema": metin boyutu ve yüksek karşıtlık (o-25), panel teması (o-29), kozmetik animasyonlar (o-34) ---------------------
const renkDuzelt = (ham) => {
  const renk = vurguRengiDuzelt(ham);
  return renk === null ? undefined : renk; // '' = hazır temanın / varsayılanın rengi
};
const metinOlcegiAl = (ham) => {
  const n = typeof ham === 'number' ? ham : typeof ham === 'string' && ham.trim() !== '' ? Number(ham) : NaN;
  return METIN_OLCEKLERI.includes(n) ? n : undefined;
};
const TEMA_ALANLARI = [
  nesneAlan('metinOlcegi', { varsayilan: VARSAYILAN_METIN_OLCEGI, tip: 'sayi', duzelt: metinOlcegiAl }), // % (100 | 115 | 130 | 150): panel, palet, bildirim, Ayarlar
  mantiksalAlan('yuksekKarsitlik', false), // opak zemin, malzeme kapalı, belirgin kenarlık, >= 7:1 metin
  secenekAlan('panelTemasi', HAZIR_TEMA_ADLARI, 'varsayilan'), // hazır panel teması
  nesneAlan('panelVurguRengi', { varsayilan: '', tip: 'metin', duzelt: renkDuzelt }), // '' ya da "#rrggbb" (ana pencere kenarlığı olan vurguRengi'nden ayrı)
  nesneAlan('panelArkaPlani', { varsayilan: '', tip: 'metin', duzelt: renkDuzelt }), // '' ya da "#rrggbb"
  mantiksalAlan('animasyonlar', false), // kozmetik animasyonlar: varsayılan KAPALI
  mantiksalAlan('animasyonGecisleri', true), // animasyonlar açıkken hareketli geçişler
  secenekAlan('havaEfekti', HAVA_EFEKTI_DEGERLERI, 'otomatik'), // animasyonlar açıkken hava efekti
  secenekAlan('mevsimEfekti', MEVSIM_EFEKTI_DEGERLERI, 'yok'), // animasyonlar açıkken mevsimsel süs
  mantiksalAlan('hareketiAzalt', false), // true: hiçbir kozmetik animasyon çalışmaz (sistemin "hareketi azalt" tercihi zaten uygulanır)
];

/**
 * Geri al kısayolu (o-12): '' = kısayol yok; yoksa geçerli bir genel kısayol (src/lib/kisayol.js kuralları: Windows'a ayrılmış birleşimler
 * reddedilir) normalleştirilmiş biçimde saklanır. Geçersiz değer mevcut olanı korur. Çakışma ve kayıt sonucu main.js kısayol planındadır.
 */
const VARSAYILAN_GERI_AL_KISAYOLU = 'Control+Alt+Z';
function geriAlKisayoluDuzelt(ham) {
  if (typeof ham !== 'string') return undefined;
  const m = ham.trim();
  if (m === '') return '';
  const normal = kisayolNormallestir(m);
  return normal !== null && kisayolDogrula(m).gecerli ? normal : undefined;
}

/**
 * Panelin üst kart yuvası (o-08): 'yok' | 'saat' (saat ve tarih) | 'hava' (havaVarligi) | 'medya' (birincilMedya: şimdi çalan kartı,
 * oynatıcının kendi kontrolleriyle) | bir sensor / binary_sensor kimliği (yalnız durumu gösterilir; karttan eylem çalıştırılmaz).
 * Kimlik Kapı Kuralı'ndan geçmelidir. Işık, anahtar, script gibi eylem alanları kabul edilmez: sensör/hava kartı salt okunurdur ve
 * eylem hattına kayıtlı varlık olarak girmemelidir (src/lib/bilgi-modeli.js bilgiKimlikleri). Yalnız 'medya' kartı oynatıcıyı
 * (media_player, kendi servis izin listesiyle) kontrol eder; oynatıcı birincilMedya ayarındaki tek kimliktir.
 */
function kartYuvasiAlan(ad) {
  return nesneAlan(ad, {
    varsayilan: 'yok',
    tip: 'metin',
    duzelt: (ham) => {
      if (typeof ham !== 'string') return undefined;
      const m = ham.trim();
      if (m === 'yok' || m === 'saat' || m === 'hava' || m === 'medya') return m;
      if (!VARLIK_KIMLIGI_DESENI.test(m) || !KART_VARLIK_ALANLARI.includes(alanAl(m))) return undefined;
      return adGuvenliMi(m, '') ? m : undefined;
    },
  });
}

/**
 * ŞEMA 6+ AYAR ALANLARI. Her grup kendi başlığı altına ekler (sıra önemsizdir).
 */
const AYAR_ALANLARI = Object.freeze([
  // --- bilgi grubu: sensör şeridi ve grafikleri (o-04, o-09, o-11), üst kartlar (o-08), takvim (o-10), yapılacaklar (o-07) ---
  // Hepsi varsayılan olarak KAPALI/boştur (kullanıcı seçmedikçe panelde yeni bölüm görünmez). Varlık kimlikleri Kapı Kuralı'ndan geçer;
  // seçilen varlıklar eylem katmanına yalnız kayıtlı varlık olarak eklenir (src/lib/bilgi-modeli.js bilgiKaydi).
  kimlikListesiAlan('sensorSeridi', { enCok: 6, alanlar: ['sensor', 'binary_sensor'] }), // panelin üstündeki sensör şeridi
  mantiksalAlan('sensorGrafik', true), // sensör karolarında/şeritte mini grafik ve gösterge (açık panelde HA geçmişi okunur)
  secenekAlan('sensorGrafikSaat', [1, 6, 24], 6), // mini grafiğin kapsadığı saat
  tamsayiAlan('pilEsigi', 5, 50, 20), // bu yüzdenin altındaki pil sensörü "dikkat" olarak vurgulanır
  mantiksalAlan('sensorTepsiIpucu', false), // dikkat gerektiren sensörler tepsi ipucunda da yazılır
  kartYuvasiAlan('ustKart1'),
  kartYuvasiAlan('ustKart2'),
  kimlikAlan('havaVarligi', { alanlar: ['weather'] }), // 'hava' yuvasının kaynağı
  secenekAlan('havaTahmini', ['kapali', 'gunluk', 'saatlik'], 'gunluk'), // hava kartının altındaki tahmin şeridi (panel açıkken HA'dan okunur); 'kapali': şerit yok
  kimlikAlan('birincilMedya', { alanlar: ['media_player'] }), // 'medya' üst kartının oynatıcısı ('' : seçilmedi); yalnız media_player, Kapı Kuralı'ndan geçer
  mantiksalAlan('medyaKapagi', true), // medya kartlarında albüm kapağı: HA'nın kendi vekil adresinden ana süreç çeker, dış adres ASLA çekilmez
  secenekAlan('saatBicimi', ['sistem', '24', '12'], 'sistem'), // sistem: Windows bölge ayarı
  secenekAlan('tarihBicimi', ['orta', 'kisa', 'uzun', 'yok'], 'orta'),
  kimlikListesiAlan('takvimler', { enCok: 4, alanlar: ['calendar'] }), // yaklaşan etkinlikler (salt okunur)
  tamsayiAlan('takvimGunSayisi', 1, 14, 3), // bugünden kaç gün ileriye bakılır
  kimlikListesiAlan('yapilacakListeleri', { enCok: 4, alanlar: ['todo'] }), // panelde görünen yapılacaklar listeleri
  kimlikAlan('hizliListe', { alanlar: ['todo'] }), // palette "liste süt" ile eklenen liste ('' : ilk liste)

  // --- düzen: panel sayfaları (sekmeler; o-24). Doğrulama src/lib/sayfalar.js'dedir. ---
  nesneAlan('sayfalar', { varsayilan: [], duzelt: (ham) => sayfalariDuzelt(ham) }),

  // --- eylem grubu (1.4.0): o-17 etkinlik geçmişi, o-12 geri al, o-15 gecikmeli eylem, o-14 oda, o-46 palette diğer cihazlar ---
  // Hepsi yerel ve ağa çıkmaz; eylemler yine tek güvenli hattan geçer (src/lib/eylem-ekleri.js).
  mantiksalAlan('etkinlikGecmisi', true), // o-17: yapılan/yapılamayan eylemlerin yerel kaydı (son 200; kimlik, ad, kaynak, sonuç; sır yok)
  mantiksalAlan('geriAl', true), // o-12: son eylemleri (en çok 5) geri al; yalnız zararsız eylemler, süre sınırlı
  tamsayiAlan('geriAlSureDk', 1, 60, 10), // o-12: geri alma penceresi (dakika)
  nesneAlan('geriAlKisayolu', { varsayilan: VARSAYILAN_GERI_AL_KISAYOLU, tip: 'metin', duzelt: geriAlKisayoluDuzelt }), // o-12: genel kısayol ('' = yok)
  mantiksalAlan('gecikmeliEylem', true), // o-15: "10 dk sonra kapat" gibi zamanlı eylemler (yalnız bellekte; uygulama kapanınca iptal; ışık/priz/vantilatör/nem alıcı/yardımcı anahtar)
  mantiksalAlan('sonDegisenler', true), // o-18: palette "@" ile son değişenler (izlenen ışık/priz/sahne/klima/medya; yalnız bellekte)
  secenekAlan('panelGruplama', ['tur', 'oda'], 'tur'), // o-14: panel karoları türe ('tur') ya da HA odasına ('oda') göre gruplanır; 'oda' için HA alan kaydı okunabilmelidir
  mantiksalAlan('paletDigerCihazlar', false), // o-46: palette "*" ile favori OLMAYAN güvenli ışık/priz/vantilatör/sahne aranır (varsayılan KAPALI: KILAVUZ'daki "yalnız favoriler" kararını gevşetir; açıkken HA'dan durum listesi okunur)
  // --- pencere grubu: o-22 üstte tutma, o-32 konum/ekran/opaklık, o-27 tepsi rozeti, o-33 masaüstü karoları ---
  // o-22: açıkken panel/palet görünürken 'screen-saver' seviyesinde (tam ekran uygulamaların üstünde) durur. Varsayılan KAPALI (1.3.0 davranışı).
  mantiksalAlan('panelHerZamanUstte', false),
  // o-32: ana pencere konumu: 'imlec' = her açılışta imlecin ekranında ortala (1.3.0), 'hatirla' = taşındığı yer hatırlanır.
  secenekAlan('pencereKonumu', KONUM_MODLARI, VARSAYILAN_KONUM_MODU),
  // Boyut moduna göre kayıtlı konumlar { hizli?, genis? }: makineye özgüdür, dışa aktarılmaz ve Ayarlar sayfasına gitmez.
  nesneAlan('pencereKonumlari', { varsayilan: {}, duzelt: (ham) => (ham !== null && typeof ham === 'object' && !Array.isArray(ham) ? konumlariDuzelt(ham) : undefined) }, { aktarilir: false, ozette: false }),
  // Tercih edilen ekran { id, x, y, genislik, yukseklik } ({} = seçilmedi): makineye özgüdür, dışa aktarılmaz.
  nesneAlan('tercihEkran', { varsayilan: {}, duzelt: tercihEkranDuzelt }, { aktarilir: false }),
  // Panel opaklığı (yüzde); yalnız opak malzemede uygulanır (akrilik/mica'da tam opak).
  tamsayiAlan('panelOpaklik', OPAKLIK_SINIRI.en_az, OPAKLIK_SINIRI.en_cok, OPAKLIK_SINIRI.en_cok),
  // o-27: tepsi simgesi rozeti: 'kapali' | 'isik' (açık ışık sayısı) | 'sensor' (seçilen sensörün kısa değeri). Rozetin sensörü yalnız 'sensor' alanı olabilir (Kapı Kuralı'ndan geçer).
  secenekAlan('tepsiRozeti', ['kapali', 'isik', 'sensor'], 'kapali'),
  kimlikAlan('tepsiRozetSensoru', { alanlar: ['sensor'] }),
  // Rozet için en çok 2 EK sensör (ana sensörle birlikte en çok 3): geçerli olanlar rozette sırayla gösterilir. Yalnız 'sensor' alanı; Kapı Kuralı çizimde de uygulanır.
  kimlikListesiAlan('tepsiRozetSensorleri', { enCok: 2, alanlar: ['sensor'] }),
  // o-33: masaüstüne sabitlenen karolar: yalnız FAVORİ olan, sabitlenebilir alandaki kimlikler (çalışma anında ayrıca süzülür); konumları makineye özgüdür.
  kimlikListesiAlan('masaustuKarolari', { enCok: EN_COK_KARO, alanlar: SABITLENEBILIR_ALANLAR }),
  nesneAlan('masaustuKaroKonumlari', { varsayilan: {}, duzelt: karoKonumlariniDuzelt }, { aktarilir: false, ozette: false }),
  // Karolar diğer pencerelerin üstünde mi kalsın (varsayılan KAPALI: masaüstünde, pencerelerin altında durur).
  mantiksalAlan('masaustuKaroUstte', false),

  // --- etkilesim grubu (o-20, o-23, o-60, o-38) ---
  // o-20: fare tekerleği ışık parlaklığını / medya sesini ±5 değiştirir (varsayılan AÇIK; kaydırılabilir panelde yalnız kaydırıcı üstünde ve
  // kaydırma sürerken devreye girmez). tepsiOrtaTik: tepsi simgesine orta tıkta çalışacak zararsız favori ('' = kapalı); kimlik Kapı Kuralı'ndan
  // ve orta-tik.js alan listesinden geçer, çalışma anında ayrıca favori/zararsız sınıf denetlenir.
  mantiksalAlan('karoTekerlegi', true),
  kimlikAlan('tepsiOrtaTik', { alanlar: ORTA_TIK_ALANLARI }),
  // o-23: paneli sabitle (dışarı tıklayınca kapanmaz; Esc kapatır). Varsayılan KAPALI.
  mantiksalAlan('panelSabit', false),
  // o-60: ana kısayolu basılı tutunca göster, bırakınca gizle (tuş dinleyicisi yok; kısayolun kendi tekrarlarından anlaşılır). Varsayılan KAPALI.
  mantiksalAlan('kisayolBasiliTut', false),
  // o-38: Home Assistant bağlantısı en az baglantiBildirimSn saniye kopuk kalırsa "koptu", dönünce "geri geldi" bildirimi (yerel Windows bildirimi; ağa bir şey gitmez).
  mantiksalAlan('baglantiBildirimi', true),
  tamsayiAlan('baglantiBildirimSn', BAGLANTI_GECIKME.en_az, BAGLANTI_GECIKME.en_cok, BAGLANTI_GECIKME.varsayilan),

  // --- tema grubu: görünüm (o-25 metin boyutu ve yüksek karşıtlık, o-29 tema ve renkler, o-34 animasyonlar) ---
  ...TEMA_ALANLARI,
  // --- Bildirim grubu (o-36, o-37, o-39): bildirim merkezi ve varlık uyarı kuralları (src/lib/bildirim-akisi.js) ---
  mantiksalAlan('bildirimKalici', true), // HA kalıcı bildirimlerini panelde göster (WS persistent_notification/subscribe, yalnız okuma)
  mantiksalAlan('bildirimPil', true), // düşük pil bildirimleri (10 dakikada bir GET /api/states)
  mantiksalAlan('bildirimGuncelleme', false), // bekleyen güncelleme bildirimleri (update.* varlıkları)
  tamsayiAlan('bildirimPilEsigi', 5, 50, 20), // bu yüzdenin altı/eşiti "düşük pil" sayılır
  mantiksalAlan('bildirimMasaustu', true), // yeni merkez bildirimlerini köşe bildirimi olarak da göster
  nesneAlan('uyariKurallari', { varsayilan: [], duzelt: (ham) => kurallariDuzelt(ham) }), // varlık uyarı kuralları (uyari-kurallari.js)
  // --- cihaz grubu (o-48): kamera anlık görüntüsü. Kamera YALNIZ burada tek tek onaylanırsa panelde görünür (varsayılan: hiçbiri).
  // kameraIzinleri dışa/içe aktarmaya GİRMEZ (aktarilir:false): başkasından alınan bir dosya kameranızı kendiliğinden açamaz.
  nesneAlan('kameraIzinleri', { varsayilan: [], duzelt: kameraIzinleriniDuzelt }, { aktarilir: false }),
  mantiksalAlan('kameraBulanik', true), // görüntü bulanık başlar, tıklayınca açılır (varsayılan AÇIK)
  secenekAlan('kameraYenilemeSn', KAMERA_YENILEME_SECENEKLERI, 0), // 0: yalnız elle "Yenile"; aksi hâlde panel açıkken her N saniyede bir
  // --- arac grubu ---
  // o-40 Yeni sürüm denetimi: günde en çok bir kez GitHub sürüm adresine anahtarsız GET (IP'n GitHub'a görünür). VARSAYILAN KAPALI, açık rıza ile.
  // aktarilir:false -> dışa/içe aktarmaya girmez: başkasından alınan bir dosya bu dış ağ seçeneğini kendiliğinden açamaz.
  mantiksalAlan('surumDenetimi', false, { aktarilir: false }),
  // --- dis grubu: dış tetikler (o-21 Jump List ve masaüstü kısayolu, o-47 PC olayları, o-52 yerel API, o-53 toplantı ışığı, o-54 evpaneli://) ---
  // HEPSİ varsayılan KAPALI ve aktarilir:false: dışa aktarılan, klasörden eşitlenen ya da başkasından alınan bir dosya bir dış tetiği açamaz,
  // izin ya da kural ekleyemez. Yerel API jetonu burada DEĞİL, safeStorage ile ayrı dosyadadır (yerel-api-jetonu.dat). Ayrıntı: src/dis-tetikler.js.
  mantiksalAlan('tetikJumpList', false, { aktarilir: false }), // görev çubuğu atlama listesinde zararsız favoriler
  mantiksalAlan('tetikMasaustu', false, { aktarilir: false }), // Ayarlar'dan favori için masaüstü kısayolu (.lnk) oluşturma ve çalıştırma
  mantiksalAlan('tetikProtokol', false, { aktarilir: false }), // evpaneli:// bağlantısı (açılınca HKCU kaydı, kapanınca kaldırılır)
  // Bağlantıdan "Her zaman" izni verilen favoriler: yalnız ana süreç (izin sorusu) ekler, Ayarlar'dan kaldırılır; sayfaya özetle gitmez.
  kimlikListesiAlan('tetikProtokolIzinleri', { enCok: 50 }, { aktarilir: false, ozette: false }),
  mantiksalAlan('tetikYerelApi', false, { aktarilir: false }), // 127.0.0.1 üzerinde jetonlu yerel API
  tamsayiAlan('tetikApiPortu', 1024, 65535, 48123, { aktarilir: false }),
  mantiksalAlan('tetikApiBildirim', false, { aktarilir: false }), // yerel API eylemlerinde başarı/hata bildirimi
  mantiksalAlan('tetikPcOlaylari', false, { aktarilir: false }), // PC kilitlenince / kilit açılınca / uykuda / uyanınca kurallar
  mantiksalAlan('tetikPcAcma', false, { aktarilir: false }), // PC olayında kapatma dışındaki işlemler (aç, çalıştır, geri yükle)
  nesneAlan('tetikPcKurallari', { varsayilan: [], duzelt: pcKurallariDuzelt }, { aktarilir: false }), // src/lib/pc-olaylari.js
  mantiksalAlan('tetikPcUyarisi', false, { aktarilir: false, ozette: false }), // ilk kullanım uyarısı gösterildi mi (ana süreç yazar)
  mantiksalAlan('tetikToplanti', false, { aktarilir: false }), // mikrofon/kamera kullanımda iken toplantı ışığı
  secenekAlan('tetikToplantiKaynak', TOPLANTI_KAYNAKLARI, 'ikisi', { aktarilir: false }),
  kimlikAlan('tetikToplantiFavori', {}, { aktarilir: false }), // toplantı başlayınca açılan / başlatılan favori
  secenekAlan('tetikToplantiBitis', ['geriYukle', 'kapat', 'favori', 'yok'], 'geriYukle', { aktarilir: false }),
  kimlikAlan('tetikToplantiBitisFavori', {}, { aktarilir: false }), // bitiş 'favori' ise başlatılan favori
  tamsayiAlan('tetikToplantiAralik', 5, 60, 10, { aktarilir: false }), // yoklama aralığı (sn)
  // o-51 Uygulama içi güncelleme (electron-updater, GitHub Sürümleri): VARSAYILAN KAPALI, açık rıza ile. Açıkken denetim güncelleyiciden yapılır;
  // kurucu YALNIZ "İndir" düğmesiyle inip ayrı onayla kurulur (otomatik indirme ve çıkışta kurma yok). aktarilir:false: içe aktarılan dosya
  // dış ağ ve kurucu indirme seçeneğini kendiliğinden açamaz. Taşınabilir sürümde etkisizdir (src/lib/guncelleme.js destekDurumu).
  mantiksalAlan('uygulamaGuncelleme', false, { aktarilir: false }),
  // o-51 "Ön sürümleri de göster" (beta kanalı): hem sürüm denetimi (o-40) hem uygulama içi güncelleme için; varsayılan KAPALI.
  mantiksalAlan('onSurumler', false, { aktarilir: false }),
  // o-61 mobile_app bildirimleri (src/lib/mobil-kayit.js): bu bilgisayarı Home Assistant'a bildirim alan bir cihaz olarak kaydetmek KULLANICININ
  // açık eylemidir (Ayarlar > Mobil bildirimler > Kaydol, onay penceresiyle). `mobilBildirimler` itme kanalının açık olup olmadığıdır (varsayılan
  // KAPALI; kayıt başarılı olunca ana süreç açar, "Kaydı sil" kapatır). Webhook kimliği ayara GİRMEZ (safeStorage dosyası). Hiçbiri dışa/içe
  // aktarılmaz: içe aktarılan dosya bildirim kanalını ya da cihaz adını kendiliğinden belirleyemez.
  mantiksalAlan('mobilBildirimler', false, { aktarilir: false }),
  metinAlan('mobilCihazAdi', { enUzun: 40, desen: /^[\p{L}\p{N} ._()-]+$/u, varsayilan: '' }, { aktarilir: false }),

  // --- baglanti grubu (o-58): klasör tabanlı ayar eşitleme (src/lib/ayar-esitleme.js, src/esitleme-yoneticisi.js) ---
  // Hepsi makineye özgüdür ve dışa/içe aktarmaya GİRMEZ: başkasından alınan bir dosya eşitlemeyi kendiliğinden açamaz ya da klasörü değiştiremez.
  // Eşitleme VARSAYILAN KAPALI; yalnız kullanıcının seçtiği yerel klasöre yazar (ağa çıkmaz). Parola ve hiçbir sır bu alanlarda tutulmaz.
  mantiksalAlan('klasorEsitleme', false, { aktarilir: false, ozette: false }),
  nesneAlan('esitlemeKlasoru', { varsayilan: '', tip: 'metin', duzelt: klasorYoluDuzelt }, { aktarilir: false, ozette: false }),
  nesneAlan('esitlemeBolumleri', { varsayilan: BOLUM_ADLARI, tip: 'dizi', duzelt: bolumListesiDuzelt }, { aktarilir: false, ozette: false }),
  nesneAlan('esitlemeDurumu', { varsayilan: {}, tip: 'nesne', duzelt: durumDuzelt }, { aktarilir: false, ozette: false }),
]);

/**
 * Şema göçleri (ayarlariDuzelt sonunda, kayıtlı sürüm < surum ise sırayla). uygula(ayarlar, ham, notlar): ayarlar düzeltilmiş yeni
 * nesnedir (yerinde değiştirilir), ham dosya içeriği (salt okunur), notlar ayar-sema notları (yeni not adı eklenebilir).
 */
const GOCLER = Object.freeze([
  Object.freeze({
    surum: 6,
    // 1.4.0: yeni alanlar AYAR_ALANLARI varsayılanlarıyla eklenir; kullanıcının mevcut değerlerine ve favorilerine dokunulmaz.
    uygula() {},
  }),
]);

function kopya(deger) {
  return deger !== null && typeof deger === 'object' ? structuredClone(deger) : deger;
}

function guvenliDuzelt(alan, ham) {
  try {
    return alan.duzelt(ham);
  } catch {
    return undefined;
  }
}

/**
 * Ham ayar dosyasından (g) ve varsayılan ayarlardan (v) kayıttaki alanların düzeltilmiş değerleri.
 * @returns {object} { ad: değer } (her alan için; geçersizse varsayılan)
 */
function alanlariDuzelt(g, v, liste = AYAR_ALANLARI) {
  const ham = duzNesneMi(g) ? g : {};
  const vars = duzNesneMi(v) ? v : {};
  const sonuc = {};
  for (const alan of liste) {
    let deger = Object.hasOwn(ham, alan.ad) ? guvenliDuzelt(alan, ham[alan.ad]) : undefined;
    if (deger === undefined && Object.hasOwn(vars, alan.ad)) deger = guvenliDuzelt(alan, vars[alan.ad]);
    sonuc[alan.ad] = kopya(deger === undefined ? alan.varsayilan : deger);
  }
  return sonuc;
}

/** Göçleri uygular (kayıtlı sürüm < göç sürümü). */
function gocleriUygula(ayarlar, ham, oncekiSurum, notlar, gocler = GOCLER) {
  for (const goc of [...gocler].sort((a, b) => a.surum - b.surum)) {
    if (oncekiSurum < goc.surum) goc.uygula(ayarlar, ham, notlar);
  }
}

/** ayar-sema.js tip denetimi için { ad: tip }. */
function alanTipleri(liste = AYAR_ALANLARI) {
  return Object.fromEntries(liste.map((a) => [a.ad, a.tip]));
}

/** Dışa/içe aktarılan alan adları. */
function aktarilanAlanlar(liste = AYAR_ALANLARI) {
  return liste.filter((a) => a.aktarilir).map((a) => a.ad);
}

/**
 * ayarlar:kaydet yükündeki kayıtlı alanlar: geçerli değer `yeni`ye girer; geçersiz değer mevcut olanı korur ve uyarı verir.
 * @returns {{ yeni: object, uyarilar: {alan: string, mesaj: string}[] }}
 */
function ekGirdiDogrula(girdi, t, liste = AYAR_ALANLARI) {
  const yeni = {};
  const uyarilar = [];
  if (!duzNesneMi(girdi)) return { yeni, uyarilar };
  for (const alan of liste) {
    if (girdi[alan.ad] === undefined) continue;
    const deger = guvenliDuzelt(alan, girdi[alan.ad]);
    if (deger === undefined) uyarilar.push({ alan: alan.ad, mesaj: t('kaydet.ekAlanGecersiz') });
    else yeni[alan.ad] = kopya(deger);
  }
  return { yeni, uyarilar };
}

/**
 * Doğrulanmış `yeni` değerleri ayarlara yazar; değişen alan adlarını döner (main.js dinleyicileri bunlar için çağırır).
 * @returns {{ad: string, eski: unknown, yeni: unknown}[]}
 */
function ekAyarlariUygula(ayarlar, yeni, liste = AYAR_ALANLARI) {
  const degisenler = [];
  for (const alan of liste) {
    if (!duzNesneMi(yeni) || yeni[alan.ad] === undefined) continue;
    const eski = ayarlar[alan.ad];
    if (JSON.stringify(eski) === JSON.stringify(yeni[alan.ad])) continue;
    ayarlar[alan.ad] = kopya(yeni[alan.ad]);
    degisenler.push({ ad: alan.ad, eski, yeni: ayarlar[alan.ad] });
  }
  return degisenler;
}

/** Ayarlar sayfasına giden özet parçası. */
function ekAyarOzeti(ayarlar, liste = AYAR_ALANLARI) {
  const sonuc = {};
  for (const alan of liste) if (alan.ozette) sonuc[alan.ad] = kopya(ayarlar?.[alan.ad] ?? alan.varsayilan);
  return sonuc;
}

module.exports = {
  VARSAYILAN_GERI_AL_KISAYOLU,
  geriAlKisayoluDuzelt,
  GUNCEL_EK_SURUM,
  AYAR_ALANLARI,
  GOCLER,
  mantiksalAlan,
  secenekAlan,
  tamsayiAlan,
  metinAlan,
  kimlikAlan,
  kimlikListesiAlan,
  nesneAlan,
  alanlariDuzelt,
  gocleriUygula,
  alanTipleri,
  aktarilanAlanlar,
  ekGirdiDogrula,
  ekAyarlariUygula,
  ekAyarOzeti,
};
