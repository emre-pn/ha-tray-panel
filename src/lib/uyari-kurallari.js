'use strict';

/**
 * Varlık uyarı kuralları (o-37) ve uyarılarda süre / bekleme / tekrar bastırma / sessiz saatler (o-39) — saf; Electron ve ağ yok.
 *
 * Kullanıcı Ayarlar'da bir varlık seçer ve bir koşul kurar; durum deposu (src/lib/durum-deposu.js) zaten canlı olduğundan değerlendirici
 * ana süreçte depo değişimlerini dinler ve koşul sağlanınca `uyar` geri çağrısını çağırır (köşe bildirimi, panelde bildirim şeridi ve
 * isteğe bağlı Windows bildirimi main.js / bildirim-akisi.js'tedir).
 *
 * Kural (ayardaki `uyariKurallari` dizisinin öğesi; kuralDuzelt doğrular, kimse ham değeri doğrudan kullanmaz):
 *   { id, acik, varlik, kosul, metin, sure, bekleme, sessizSaatler, windows }
 *   kosul   { tur: 'gecis', den, ye }          duruma geçiş: durum `den`'den `ye`'ye değişince (boş = herhangi)
 *           { tur: 'durum', deger }            tam durum: durum `deger` OLUNCA (kenar tetiklemeli)
 *           { tur: 'esik', yon: 'ustunde'|'altinda', deger }   sayısal eşik: değer eşiği geçince
 *           { tur: 'ulasilamiyor' } | { tur: 'bilinmiyor' }   durum unavailable / unknown olunca
 *   metin   kullanıcının cümlesi (boş = varsayılan cümle); {ad} ve {durum} yer tutucuları
 *   sure    saniye: koşul bu kadar KESİNTİSİZ sürerse bildir (0 = hemen)
 *   bekleme saniye: aynı kural için iki bildirim arası en az süre (tekrar bastırma)
 *   sessizSaatler { baslangic: 'HH:MM', bitis: 'HH:MM' } | null  yerel saat; geceyi aşabilir (22:00-07:00). Sessiz saatlerde bildirim
 *           AÇILIR PENCERE olarak çıkmaz (sessiz: true); panelin bildirim şeridine yine eklenir.
 *   windows Windows bildirimi de çıksın mı (varsayılan false)
 *
 * Davranış kuralları:
 *  - Koşul "kenar" tetiklemelidir: sağlanmıyorken sağlanır olunca (ve `sure` dolunca) BİR bildirim; koşul kalkana dek tekrar bildirim YOK.
 *  - İlk bağlantıda gelen toplu durumlar uyarı üretmez: bir kural için görülen ilk durum yalnız taban çizgisidir; ayrıca canlı bağlantı
 *    kurulunca / koptuğunda ISINMA süresi boyunca (isinmaBaslat) gelen değişimler yalnız tabanı günceller.
 *  - KAPI KURALI: kural yalnız süzgeçten geçen varlıklarda tanımlanır (alan UYARI_ALANLARI'nda, kimlik adGuvenliMi'den geçer; kilit,
 *    alarm, kapı, garaj, cover, siren alanları ve kapı sınıfları seçilemez). Kullanıcı cümlesi ve durum değerleri metin süzgecinden
 *    geçer. Bildirim anında varlık HA'daki GÜNCEL adıyla yeniden denetlenir ve ÜRETİLEN METİN süzgeçten geçmezse bildirim gösterilmez
 *    (yalnız sayılır: gizlenen()).
 *  - Hız sınırı: tüm kurallar toplamı dakikada en çok DAKIKA_SINIRI, günde en çok GUN_SINIRI bildirim.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, guvenliVarlikMi, metinGuvenliMi, guvenliMetin, metinListesiSuz } = require('./suzgec');
const { kayitliAlanMi } = require('./alan-kaydi');
const { HVAC_MODLARI } = require('./servis-izinleri');
const { HAVA_DURUMLARI, MEDYA_DURUMLARI, SUPURGE_DURUMLARI, ZAMANLAYICI_DURUMLARI, sayiAl } = require('./varlik-ozellik');
const { kisalt } = require('./metin');
const { uyariVarsayilanMetni } = require('./bildirim-metni');
const { TR } = require('./ceviri-varsayilan');

/**
 * Kural kurulabilen alanlar: Ayarlar'da seçilebilen (karo olabilen) alanlardan, anlamlı durumu olanlar. Kapı alanları (lock, alarm,
 * siren, cover...) alan kaydında zaten yoktur; tetik/sahne/düğme gibi durumsuz alanlar ile yalnız kendi ayarıyla seçilen takvim ve
 * yapılacaklar listesi (karo değildir) bilerek dışarıdadır.
 */
const UYARI_ALANLARI = Object.freeze([
  'sensor',
  'binary_sensor',
  'light',
  'switch',
  'fan',
  'input_boolean',
  'climate',
  'media_player',
  'humidifier',
  'vacuum',
  'timer',
  'input_select',
  'select',
  'input_number',
  'number',
  'weather',
]);
const KOSUL_TURLERI = Object.freeze(['gecis', 'durum', 'esik', 'ulasilamiyor', 'bilinmiyor']);
const ESIK_YONLERI = Object.freeze(['ustunde', 'altinda']);

const EN_COK_KURAL = 20;
const METIN_SINIRI = 100;
const DURUM_SINIRI = 64;
const SURE_AZAMI_SN = 86_400; // 24 saat
const BEKLEME_AZAMI_SN = 86_400;
const VARSAYILAN_SURE_SN = 0;
const VARSAYILAN_BEKLEME_SN = 300;
const ESIK_TAVANI = 1e9;
const KIMLIK_DESENI = /^[a-z0-9]{2,12}$/;
const SAAT_DESENI = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DAKIKA_SINIRI = 6; // tüm kurallar: dakikada en çok bu kadar bildirim
const GUN_SINIRI = 60; // tüm kurallar: 24 saatte en çok bu kadar bildirim
const ISINMA_MS = 8000; // bağlantı değişiminden sonra bu süre boyunca değişimler yalnız tabanı günceller

/** Alan başına varlık simgesi (bildirimde cümlenin yanında). Düz Unicode simgeleri; kimlikten türemez. */
const ALAN_SIMGELERI = Object.freeze({
  sensor: '📈',
  binary_sensor: '◉',
  light: '💡',
  switch: '🔌',
  fan: '🌀',
  input_boolean: '🔘',
  climate: '🌡',
  media_player: '🎵',
  humidifier: '💧',
  vacuum: '🧹',
  timer: '⏱',
  input_select: '▾',
  select: '▾',
  input_number: '🔢',
  number: '🔢',
  weather: '⛅',
});
const VARSAYILAN_SIMGE = '🔔';

/** Alanın simgesi (bilinmeyen alan: zil). */
function alanSimgesi(alan) {
  return Object.hasOwn(ALAN_SIMGELERI, alan) ? ALAN_SIMGELERI[alan] : VARSAYILAN_SIMGE;
}

const ORTAK_DURUMLAR = Object.freeze(['unavailable', 'unknown']);
const ACIK_KAPALI = Object.freeze(['on', 'off']);
// w-81: HA'nın yazdığı durum adları, alan başına (kapı sınıfları bu tabloda yok: binary_sensor için yalnız on/off).
const DURUM_ONERILERI = Object.freeze({
  light: ACIK_KAPALI,
  switch: ACIK_KAPALI,
  fan: ACIK_KAPALI,
  input_boolean: ACIK_KAPALI,
  binary_sensor: ACIK_KAPALI,
  humidifier: ACIK_KAPALI,
  climate: HVAC_MODLARI,
  media_player: MEDYA_DURUMLARI,
  vacuum: SUPURGE_DURUMLARI,
  timer: ZAMANLAYICI_DURUMLARI,
  weather: HAVA_DURUMLARI,
});

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/**
 * Seçicide önerilecek durum değerleri: alanın sabit durumları + (seçici varlıkta) cihazın süzgeçten geçen seçenekleri + unavailable /
 * unknown. Metinler süzgeçten geçer. Alan kural kurulabilen bir alan değilse boş liste.
 * @param {{entity_id: string, attributes?: object}} varlik
 * @returns {string[]}
 */
function durumOnerileri(varlik) {
  const kimlik = varlik?.entity_id;
  if (typeof kimlik !== 'string') return [];
  const alan = alanAl(kimlik);
  if (!UYARI_ALANLARI.includes(alan)) return [];
  let liste = [...(DURUM_ONERILERI[alan] ?? [])];
  if (alan === 'select' || alan === 'input_select') liste = liste.concat(metinListesiSuz(varlik.attributes?.options, { enCok: 30, enUzun: DURUM_SINIRI }));
  liste = liste.concat(ORTAK_DURUMLAR);
  return [...new Set(liste)].filter((d) => metinGuvenliMi(d));
}

// ---------------------------------------------------------------------------
// Kural doğrulama
// ---------------------------------------------------------------------------

/** Kural kurulabilir varlık kimliği mi (desen, alan, Kapı Kuralı)? */
function varlikKimligiGecerliMi(kimlik) {
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
  const alan = alanAl(kimlik);
  return UYARI_ALANLARI.includes(alan) && kayitliAlanMi(alan) && adGuvenliMi(kimlik, '');
}

/** Durum değeri metni ('' izinli değil): kısa düz metin, Kapı Kuralı'ndan geçmeli. */
function durumDegeriDuzelt(ham, bosIzinli = false) {
  if (ham === undefined || ham === null) return bosIzinli ? '' : undefined;
  if (typeof ham !== 'string' || ham.length > DURUM_SINIRI * 4) return undefined;
  const m = kisalt(ham, DURUM_SINIRI);
  if (m === '') return bosIzinli ? '' : undefined;
  return metinGuvenliMi(m) ? m : undefined;
}

function kosulDuzelt(ham) {
  if (!duzNesneMi(ham) || !KOSUL_TURLERI.includes(ham.tur)) return undefined;
  switch (ham.tur) {
    case 'ulasilamiyor':
    case 'bilinmiyor':
      return { tur: ham.tur };
    case 'durum': {
      const deger = durumDegeriDuzelt(ham.deger);
      return deger === undefined ? undefined : { tur: 'durum', deger };
    }
    case 'gecis': {
      const den = durumDegeriDuzelt(ham.den, true);
      const ye = durumDegeriDuzelt(ham.ye, true);
      return den === undefined || ye === undefined ? undefined : { tur: 'gecis', den, ye };
    }
    case 'esik': {
      const deger = typeof ham.deger === 'number' || typeof ham.deger === 'string' ? sayiAl(ham.deger, { min: -ESIK_TAVANI, max: ESIK_TAVANI }) : null;
      return deger === null || !ESIK_YONLERI.includes(ham.yon) ? undefined : { tur: 'esik', yon: ham.yon, deger };
    }
    default:
      return undefined;
  }
}

/** 'HH:MM' -> gün içi dakika (0..1439); geçersizse null. */
function saatDakika(metin) {
  const e = typeof metin === 'string' ? SAAT_DESENI.exec(metin) : null;
  return e ? Number(e[1]) * 60 + Number(e[2]) : null;
}

/** Sessiz saatler: geçerli ve başlangıç != bitiş ise normalleştirilmiş kopya; yoksa/geçersizse null (sessiz saat yok). */
function sessizSaatlerDuzelt(ham) {
  if (!duzNesneMi(ham)) return null;
  const b = saatDakika(ham.baslangic);
  const s = saatDakika(ham.bitis);
  if (b === null || s === null || b === s) return null;
  return { baslangic: ham.baslangic, bitis: ham.bitis };
}

/** Gün içi dakika sessiz aralıkta mı? (Gece yarısını aşan aralıklar: 22:00-07:00 -> 23:30 ve 06:00 sessiz, 12:00 değil.) */
function sessizMi(sessizSaatler, dakika) {
  if (!sessizSaatler) return false;
  const b = saatDakika(sessizSaatler.baslangic);
  const s = saatDakika(sessizSaatler.bitis);
  if (b === null || s === null || b === s || !Number.isFinite(dakika)) return false;
  return b < s ? dakika >= b && dakika < s : dakika >= b || dakika < s;
}

function tamsayiAraliginda(ham, min, max, varsayilan) {
  if (ham === undefined || ham === null || ham === '') return varsayilan;
  const n = typeof ham === 'number' ? ham : typeof ham === 'string' ? Number(ham) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Tek kuralı doğrular ve normalleştirilmiş kopyasını döner; geçersizse null. (id burada üretilmez: kurallariDuzelt eksik/yinelenen
 * kimlikleri tamamlar.) Hiçbir zaman fırlatmaz.
 */
function kuralDuzelt(ham) {
  if (!duzNesneMi(ham)) return null;
  if (!varlikKimligiGecerliMi(ham.varlik)) return null;
  const kosul = kosulDuzelt(ham.kosul);
  if (kosul === undefined) return null;
  let metin = '';
  if (ham.metin !== undefined && ham.metin !== null && ham.metin !== '') {
    if (typeof ham.metin !== 'string' || ham.metin.length > METIN_SINIRI * 4) return null;
    metin = kisalt(ham.metin, METIN_SINIRI);
    if (metin !== '' && !metinGuvenliMi(metin)) return null; // kapı sözcüğü taşıyan cümle kural olamaz
  }
  const sure = tamsayiAraliginda(ham.sure, 0, SURE_AZAMI_SN, VARSAYILAN_SURE_SN);
  const bekleme = tamsayiAraliginda(ham.bekleme, 0, BEKLEME_AZAMI_SN, VARSAYILAN_BEKLEME_SN);
  if (sure === undefined || bekleme === undefined) return null;
  const kural = {
    id: typeof ham.id === 'string' && KIMLIK_DESENI.test(ham.id) ? ham.id : '',
    acik: ham.acik !== false,
    varlik: ham.varlik,
    kosul,
    metin,
    sure,
    bekleme,
    sessizSaatler: sessizSaatlerDuzelt(ham.sessizSaatler),
    windows: ham.windows === true,
  };
  return kural;
}

/**
 * Kural listesini doğrular (ayar alanı `uyariKurallari` için duzelt işlevi). Geçersiz kurallar sessizce düşer, en çok EN_COK_KURAL
 * kural kalır; kimliği eksik ya da yinelenen kurala sıradaki boş "uN" kimliği verilir. Dizi değilse undefined (varsayılana düşer).
 * @returns {object[]|undefined}
 */
function kurallariDuzelt(ham) {
  if (!Array.isArray(ham)) return undefined;
  const sonuc = [];
  const kullanilan = new Set();
  const adaylar = [];
  for (const oge of ham.slice(0, EN_COK_KURAL * 3)) {
    const kural = kuralDuzelt(oge);
    if (kural) adaylar.push(kural);
    if (adaylar.length >= EN_COK_KURAL) break;
  }
  for (const k of adaylar) if (k.id && !kullanilan.has(k.id)) kullanilan.add(k.id);
  const gorulen = new Set();
  let sayac = 0;
  for (const kural of adaylar) {
    if (!kural.id || gorulen.has(kural.id)) {
      do sayac += 1;
      while (kullanilan.has(`u${sayac}`));
      kural.id = `u${sayac}`;
      kullanilan.add(kural.id);
    }
    gorulen.add(kural.id);
    sonuc.push(kural);
  }
  return sonuc;
}

/** Kuralların izlediği varlık kimlikleri (durum deposu / canlı bağlantı bunları da izlemelidir). */
function kuralKimlikleri(kurallar) {
  return new Set((Array.isArray(kurallar) ? kurallar : []).filter((k) => k && k.acik !== false).map((k) => k.varlik));
}

// ---------------------------------------------------------------------------
// Koşul değerlendirme ve cümle
// ---------------------------------------------------------------------------

/** Düzey koşulu (durum / eşik / ulaşılamıyor / bilinmiyor) varlığın şu anki durumunda sağlanıyor mu? `gecis` düzey koşulu değildir. */
function kosulSaglaniyorMu(kosul, varlik) {
  const durum = varlik?.state;
  if (typeof durum !== 'string') return false;
  switch (kosul.tur) {
    case 'ulasilamiyor':
      return durum === 'unavailable';
    case 'bilinmiyor':
      return durum === 'unknown';
    case 'durum':
      return durum === kosul.deger;
    case 'esik': {
      const n = sayiAl(durum);
      if (n === null) return false;
      return kosul.yon === 'ustunde' ? n > kosul.deger : n < kosul.deger;
    }
    default:
      return false;
  }
}

/** Duruma geçiş koşulu: önceki -> yeni durum değişimi kuralın `den`/`ye` kısıtlarına uyuyor mu? */
function gecisEslesiyorMu(kosul, onceki, yeni) {
  if (onceki === yeni) return false;
  return (kosul.den === '' || onceki === kosul.den) && (kosul.ye === '' || yeni === kosul.ye);
}

/** Durumun okunur metni: bilinen HA durumları çevrilir (açık, kapalı...), sayıya birim eklenir; süzgeçten geçmezse null. */
function durumMetni(varlik, t = TR) {
  const durum = varlik?.state;
  if (typeof durum !== 'string') return null;
  if (t.var?.(`durum.${durum}`)) return t(`durum.${durum}`);
  const birim = typeof varlik.attributes?.unit_of_measurement === 'string' ? varlik.attributes.unit_of_measurement : '';
  const metin = sayiAl(durum) !== null && birim ? `${durum} ${birim}` : durum;
  return guvenliMetin(metin, 40);
}

function adMetni(varlik, kimlik) {
  const ad = varlik?.attributes?.friendly_name;
  return (typeof ad === 'string' && ad.trim() ? guvenliMetin(ad, 60) : null) ?? kimlik;
}

function esikMetni(deger) {
  return String(Math.round(deger * 1000) / 1000);
}

/**
 * Bildirim cümlesi: kullanıcının cümlesi ({ad}, {durum} yer tutucularıyla) ya da varsayılan cümle. Üretilen METİN Kapı Kuralı'ndan
 * geçmezse null (bildirim gösterilmez). Ad ve durum HA'daki GÜNCEL varlıktan alınır.
 * @returns {string|null}
 */
function uyariMetniKur(kural, varlik, t = TR) {
  const ad = adMetni(varlik, kural.varlik);
  const durum = durumMetni(varlik, t);
  if (durum === null) return null;
  let metin;
  if (kural.metin) {
    metin = kural.metin.replace(/\{ad\}/g, () => ad).replace(/\{durum\}/g, () => durum); // işlevli yerine koyma: ad/durumdaki '$&' gibi diziler yorumlanmaz
  } else {
    const tur = kural.kosul.tur === 'esik' ? kural.kosul.yon : kural.kosul.tur;
    metin = uyariVarsayilanMetni(tur, { ad, durum, esik: kural.kosul.tur === 'esik' ? esikMetni(kural.kosul.deger) : '' }, t);
  }
  return guvenliMetin(metin, 140);
}

// ---------------------------------------------------------------------------
// Değerlendirici
// ---------------------------------------------------------------------------

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

function yerelGunDakikasi(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Uyarı değerlendiricisi. Durum deposu değişince `degisti(kimlikler)` çağrılır; koşul sağlanınca `uyar(olay)` çağrılır:
 *   olay { kuralId, kimlik, alan, simge, metin, sessiz, windows, zaman }
 * @param {object} bag
 * @param {() => object[]} bag.kurallarAl doğrulanmış kurallar (kurallariDuzelt çıktısı)
 * @param {(kimlik: string) => object|null|undefined} bag.durumAl durum deposu okuyucu
 * @param {(olay: object) => void} bag.uyar
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {Function} [bag.t] çevirmen
 * @param {(m: string) => void} [bag.gunluk] yalnız sabit metin (kimlik/ad yazılmaz)
 * @param {(ms: number) => number} [bag.yerelDakika] gün içi yerel dakika (sessiz saatler; test için)
 */
function uyariDegerlendiriciOlustur({ kurallarAl, durumAl, uyar, simdi = () => Date.now(), zaman = varsayilanZaman(), t = TR, gunluk = () => {}, yerelDakika = yerelGunDakikasi }) {
  const durumlar = new Map(); // kural kimliği -> { imza, hazir, onceki, aktif, tetiklendi, zamanlayici, sonBildirim }
  let isinmaBitis = 0;
  let gizlenenSayisi = 0;
  let dakikaGecmisi = []; // son bildirim zamanları (hız sınırı)
  let gunGecmisi = [];

  function kuralDurumu(kural) {
    const imza = JSON.stringify([kural.varlik, kural.kosul, kural.sure]);
    let d = durumlar.get(kural.id);
    if (d && d.imza !== imza) {
      zamanlayiciyiIptalEt(d);
      d = null; // kural değişti: taban çizgisi yeniden alınır
    }
    if (!d) {
      d = { imza, hazir: false, onceki: undefined, aktif: false, tetiklendi: false, zamanlayici: null, sonBildirim: -Infinity };
      durumlar.set(kural.id, d);
    }
    return d;
  }

  function zamanlayiciyiIptalEt(d) {
    if (d.zamanlayici !== null) zaman.clearTimeout(d.zamanlayici);
    d.zamanlayici = null;
  }

  function hizSiniriDene(an) {
    dakikaGecmisi = dakikaGecmisi.filter((z) => an - z < 60_000);
    gunGecmisi = gunGecmisi.filter((z) => an - z < 86_400_000);
    if (dakikaGecmisi.length >= DAKIKA_SINIRI || gunGecmisi.length >= GUN_SINIRI) return false;
    dakikaGecmisi.push(an);
    gunGecmisi.push(an);
    return true;
  }

  function taban(kural, d, varlik) {
    zamanlayiciyiIptalEt(d);
    d.hazir = true;
    d.onceki = varlik.state;
    d.aktif = kural.kosul.tur === 'gecis' ? false : kosulSaglaniyorMu(kural.kosul, varlik);
    d.tetiklendi = d.aktif; // başlangıçta zaten sağlanan koşul bildirim üretmez
  }

  /** Bildirimi üretir: güvenlik, bekleme, hız sınırı sırasıyla; hepsi geçerse `uyar` çağrılır. */
  function tetikle(kural, d, varlik) {
    const an = simdi();
    d.tetiklendi = true;
    if (!varlik || !guvenliVarlikMi(varlik) || varlik.entity_id !== kural.varlik) {
      gizlenenSayisi += 1; // varlık HA'da sonradan kapı/kilit adı aldı: bildirim yok
      return;
    }
    const metin = uyariMetniKur(kural, varlik, t);
    if (metin === null) {
      gizlenenSayisi += 1; // üretilen cümle Kapı Kuralı'na takıldı
      return;
    }
    if (an - d.sonBildirim < kural.bekleme * 1000) return; // bekleme süresi: tekrar bastırma
    if (!hizSiniriDene(an)) {
      gunluk('Uyarı hız sınırı aşıldı; bildirim bastırıldı.');
      return;
    }
    d.sonBildirim = an;
    uyar({
      kuralId: kural.id,
      kimlik: kural.varlik,
      alan: alanAl(kural.varlik),
      simge: alanSimgesi(alanAl(kural.varlik)),
      metin,
      sessiz: sessizMi(kural.sessizSaatler, yerelDakika(an)),
      windows: kural.windows === true,
      zaman: an,
    });
  }

  /** `sure` saniye sonra, koşul hâlâ sürüyorsa tetikler. */
  function sureyiBaslat(kural, d, kontrol) {
    zamanlayiciyiIptalEt(d);
    if (kural.sure <= 0) {
      kontrol(true);
      return;
    }
    d.zamanlayici = zaman.setTimeout(() => {
      d.zamanlayici = null;
      try {
        kontrol(false);
      } catch {
        gunluk('Uyarı kuralı değerlendirilemedi.');
      }
    }, kural.sure * 1000);
  }

  function isle(kural) {
    const d = kuralDurumu(kural);
    const varlik = durumAl(kural.varlik);
    if (!varlik || typeof varlik !== 'object' || typeof varlik.state !== 'string') {
      // henüz bilinmiyor ya da HA'da yok: taban çizgisi sıfırlanır (varlık dönünce yeniden taban alınır)
      zamanlayiciyiIptalEt(d);
      d.hazir = false;
      return;
    }
    if (!d.hazir || simdi() < isinmaBitis) {
      taban(kural, d, varlik);
      return;
    }
    const kosul = kural.kosul;
    if (kosul.tur === 'gecis') {
      const onceki = d.onceki;
      d.onceki = varlik.state;
      if (onceki === varlik.state) return;
      zamanlayiciyiIptalEt(d);
      if (!gecisEslesiyorMu(kosul, onceki, varlik.state)) return;
      const hedef = varlik.state;
      sureyiBaslat(kural, d, (hemen) => {
        const guncel = hemen ? varlik : durumAl(kural.varlik);
        if (guncel && guncel.state === hedef) tetikle(kural, d, guncel);
      });
      return;
    }
    d.onceki = varlik.state;
    const saglaniyor = kosulSaglaniyorMu(kosul, varlik);
    if (saglaniyor && !d.aktif) {
      d.aktif = true;
      d.tetiklendi = false;
      sureyiBaslat(kural, d, (hemen) => {
        const guncel = hemen ? varlik : durumAl(kural.varlik);
        if (d.aktif && !d.tetiklendi && guncel && kosulSaglaniyorMu(kosul, guncel)) tetikle(kural, d, guncel);
      });
    } else if (!saglaniyor && d.aktif) {
      d.aktif = false;
      d.tetiklendi = false;
      zamanlayiciyiIptalEt(d);
    }
  }

  function guvenliIsle(kural) {
    try {
      isle(kural);
    } catch {
      gunluk('Uyarı kuralı değerlendirilemedi.');
    }
  }

  return {
    /** Durum deposu değişti (durum-deposu.js dinle). */
    degisti(kimlikler) {
      const kume = new Set(kimlikler);
      for (const kural of kurallarAl()) {
        if (kural && kural.acik !== false && kume.has(kural.varlik)) guvenliIsle(kural);
      }
    },
    /** Bağlantı durumu değişti (canlı kuruldu/koptu, REST toplu yükleme): kısa süre değişimler yalnız tabanı günceller. */
    isinmaBaslat(ms = ISINMA_MS) {
      isinmaBitis = simdi() + ms;
    },
    /** Kurallar değişti: kaldırılan/değişen kuralların durumu ve zamanlayıcıları silinir; sağlanan koşulların tabanı yeniden alınır. */
    kurallarDegisti() {
      const kurallar = kurallarAl().filter((k) => k && k.acik !== false);
      const kimlikler = new Set(kurallar.map((k) => k.id));
      for (const [id, d] of durumlar) {
        if (!kimlikler.has(id)) {
          zamanlayiciyiIptalEt(d);
          durumlar.delete(id);
        }
      }
      for (const kural of kurallar) guvenliIsle(kural);
    },
    /** Güvenlik kuralı yüzünden gösterilmeyen bildirim sayısı (oturum boyunca). */
    gizlenen: () => gizlenenSayisi,
    /** Kuralların izlediği kimlikler (açık kurallar). */
    izlenenKimlikler: () => kuralKimlikleri(kurallarAl()),
    durdur() {
      for (const d of durumlar.values()) zamanlayiciyiIptalEt(d);
      durumlar.clear();
    },
  };
}

module.exports = {
  UYARI_ALANLARI,
  KOSUL_TURLERI,
  ESIK_YONLERI,
  EN_COK_KURAL,
  METIN_SINIRI,
  DURUM_SINIRI,
  SURE_AZAMI_SN,
  BEKLEME_AZAMI_SN,
  VARSAYILAN_SURE_SN,
  VARSAYILAN_BEKLEME_SN,
  DAKIKA_SINIRI,
  GUN_SINIRI,
  ISINMA_MS,
  ALAN_SIMGELERI,
  alanSimgesi,
  DURUM_ONERILERI,
  durumOnerileri,
  varlikKimligiGecerliMi,
  kosulDuzelt,
  saatDakika,
  sessizSaatlerDuzelt,
  sessizMi,
  kuralDuzelt,
  kurallariDuzelt,
  kuralKimlikleri,
  kosulSaglaniyorMu,
  gecisEslesiyorMu,
  durumMetni,
  uyariMetniKur,
  uyariDegerlendiriciOlustur,
};
