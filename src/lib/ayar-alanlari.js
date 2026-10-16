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
const { KONUM_MODLARI, VARSAYILAN_KONUM_MODU, OPAKLIK_SINIRI, konumlariDuzelt, tercihEkranDuzelt } = require('./pencere-yerlesim');
const { EN_COK_KARO, SABITLENEBILIR_ALANLAR, karoKonumlariniDuzelt } = require('./masaustu-karo');

const GUNCEL_EK_SURUM = 6;
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

/**
 * ŞEMA 6+ AYAR ALANLARI. Her grup kendi başlığı altına ekler (sıra önemsizdir). Şu an boştur: 1.4.0 özellik ajanları dolduracak.
 */
const AYAR_ALANLARI = Object.freeze([
  // --- 1.4.0 özellik grupları satırlarını buraya ekler ---

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
  // o-33: masaüstüne sabitlenen karolar: yalnız FAVORİ olan, sabitlenebilir alandaki kimlikler (çalışma anında ayrıca süzülür); konumları makineye özgüdür.
  kimlikListesiAlan('masaustuKarolari', { enCok: EN_COK_KARO, alanlar: SABITLENEBILIR_ALANLAR }),
  nesneAlan('masaustuKaroKonumlari', { varsayilan: {}, duzelt: karoKonumlariniDuzelt }, { aktarilir: false, ozette: false }),
  // Karolar diğer pencerelerin üstünde mi kalsın (varsayılan KAPALI: masaüstünde, pencerelerin altında durur).
  mantiksalAlan('masaustuKaroUstte', false),
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
