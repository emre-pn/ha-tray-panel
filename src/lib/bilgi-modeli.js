'use strict';

/**
 * Bilgi kartlarının modeli (saf; Electron'a bağlı değil) — o-04 sensör şeridi, o-07 yapılacaklar, o-08 üst kartlar (hava, saat,
 * varlık), o-10 takvim. Ayarlar'daki alanlardan (src/lib/ayar-alanlari.js) ve durum deposundan, panelin "bilgi" bölümünün modelini üretir.
 *
 * Model (ana süreç; yuzeyModeliOlustur sonucuna main.js `bilgi` olarak ekler):
 *   ayar      { saatBicimi, tarihBicimi, takvimGunSayisi, sensorGrafik, sensorGrafikSaat, pilEsigi }
 *   kartlar   [{ yuva: 1|2, tur: 'hava'|'saat'|'varlik', karo: Karo|null, secilmedi: boolean }]   ('yok' yuvası listede değildir)
 *   serit     Karo[]            sensör şeridi (en çok 6; sensor / binary_sensor karoları)
 *   sensorler Karo[]            favori sensör karoları ("Sensör" grubu; panelde mini grafik ve gösterge çizilir, tıklayınca geçmiş açılır)
 *   takvimler [{ id, etiket, kullanilabilir, mesgul }]
 *   listeler  [{ id, etiket, kullanilabilir, acikSayisi }]
 *   hizliListe string           palet "liste süt" hedefi (hizliListe ya da ilk yapılacaklar listesi; yoksa '')
 * Karo, yuzey-modeli.js karoOlustur çıktısıdır: Kapı Kuralı, eylem sınıfı ve güvenli öznitelik alt kümesi aynı yoldan uygulanır.
 * Süzgeçten geçmeyen varlık (kapı sözcüklü ad, kapı sınıfı...) HİÇ görünmez; model ayrıca renderer beyaz listesinden geçer
 * (rendererBilgi). Takvim etkinlikleri, yapılacaklar öğeleri ve geçmiş verisi modelde yoktur: panel bunları yuzey:oku ile ister.
 *
 * Kayıt kaynağı (bilgiKaydi): seçili varlıklar favori olmasa da yuzey:oku / yuzey:calistir için "kayıtlı" sayılır
 * (eylem.kayitKaynagiEkle). Yalnız ayardaki kimlikler kayıtlıdır; serbest kimlik yok.
 */

const { alanAl, adGuvenliMi, guvenliVarlikMi } = require('./suzgec');
const { karoOlustur, rendererKaro } = require('./yuzey-modeli');
const { guvenliOzellikler } = require('./varlik-ozellik');
const { dikkatNedeni } = require('./bilgi-bicim');
const { kisalt } = require('./metin');
const { TR } = require('./ceviri-varsayilan');

const ETIKET_SINIRI = 40;
const EN_COK_SERIT = 6;
const EN_COK_TAKVIM = 4;
const EN_COK_LISTE = 4;
const KART_DEGERLERI_OZEL = Object.freeze(['yok', 'saat', 'hava']);

const liste = (d) => (Array.isArray(d) ? d.filter((k) => typeof k === 'string') : []);
const benzersiz = (d, enCok) => [...new Set(d)].slice(0, enCok);

function canliAd(varlik) {
  const ad = varlik?.attributes?.friendly_name;
  return typeof ad === 'string' && ad.trim() ? ad.trim() : '';
}

/** 'todo.alisveris_listesi' -> 'alisveris listesi' (canlı ad yokken yedek). */
function nesneAdi(kimlik) {
  return kimlik.split('.').slice(1).join('.').replace(/_/g, ' ');
}

/** Ayarlardan seçilen varlıkların çözülmüş hâli (geçersiz türler sessizce yok sayılır). */
function yapilandirma(ayarlar) {
  const a = ayarlar && typeof ayarlar === 'object' ? ayarlar : {};
  const kartlar = [a.ustKart1, a.ustKart2].map((deger, i) => ({ yuva: i + 1, deger: typeof deger === 'string' && deger !== '' ? deger : 'yok' }));
  const hava = typeof a.havaVarligi === 'string' ? a.havaVarligi : '';
  const takvimler = benzersiz(liste(a.takvimler), EN_COK_TAKVIM);
  const listeler = benzersiz(liste(a.yapilacakListeleri), EN_COK_LISTE);
  const hizli = typeof a.hizliListe === 'string' ? a.hizliListe : '';
  return {
    kartlar,
    hava,
    serit: benzersiz(liste(a.sensorSeridi), EN_COK_SERIT),
    takvimler,
    listeler,
    hizli,
    hizliHedef: hizli || listeler[0] || '',
  };
}

/**
 * Bilgi bölümünün izlediği ve okuttuğu TÜM kimlikler (durum deposu aboneliği ve kayıt kaynağı için). Yalnız ayardaki kimlikler:
 * sensör şeridi, üst kartların varlıkları, kullanılan hava varlığı, takvimler, yapılacaklar listeleri ve hızlı liste.
 * @returns {Set<string>}
 */
function bilgiKimlikleri(ayarlar) {
  const y = yapilandirma(ayarlar);
  const kimlikler = new Set([...y.serit, ...y.takvimler, ...y.listeler]);
  for (const k of y.kartlar) {
    if (!KART_DEGERLERI_OZEL.includes(k.deger)) kimlikler.add(k.deger);
  }
  if (y.kartlar.some((k) => k.deger === 'hava') && y.hava) kimlikler.add(y.hava);
  if (y.hizliHedef) kimlikler.add(y.hizliHedef);
  return kimlikler;
}

/**
 * eylem.kayitKaynagiEkle için kaynak: ayardaki bilgi kimliği için { entity_id, ad } döner, diğerleri için null. Hat ayrıca
 * alan izin listesini, Kapı Kuralı'nı ve servis izinlerini uygular (sensör/hava/takvim salt okunur; yapılacaklar yalnız
 * add_item / update_item / remove_item).
 */
function bilgiKaydi(ayarlarAl) {
  return (kimlik) => {
    if (typeof kimlik !== 'string' || !bilgiKimlikleri(ayarlarAl()).has(kimlik)) return null;
    return { entity_id: kimlik, ad: nesneAdi(kimlik) };
  };
}

function etiketle(kimlik, varlik) {
  const ad = kisalt(canliAd(varlik) || nesneAdi(kimlik), ETIKET_SINIRI);
  return adGuvenliMi(kimlik, ad) ? ad : null;
}

/** Sensör/hava/varlık karosu (Kapı Kuralı dahil karoOlustur'dan); olmazsa null. */
function bilgiKarosu(kimlik, durumAl, t) {
  return karoOlustur({ entity_id: kimlik, ad: nesneAdi(kimlik) }, durumAl(kimlik), t);
}

function kullanilabilirMi(varlik) {
  return varlik !== null && varlik?.state !== 'unavailable'; // undefined (henüz bilinmiyor) kullanılabilir sayılır: okuma yine de denenir
}

function takvimSatiri(kimlik, durumAl) {
  const varlik = durumAl(kimlik);
  if (varlik && !guvenliVarlikMi(varlik)) return null;
  const etiket = etiketle(kimlik, varlik);
  if (!etiket || alanAl(kimlik) !== 'calendar') return null;
  const mesgul = varlik ? guvenliOzellikler(varlik)?.mesgul : null;
  return { id: kimlik, etiket, kullanilabilir: kullanilabilirMi(varlik), mesgul: typeof mesgul === 'boolean' ? mesgul : null };
}

function listeSatiri(kimlik, durumAl) {
  const varlik = durumAl(kimlik);
  if (varlik && !guvenliVarlikMi(varlik)) return null;
  const etiket = etiketle(kimlik, varlik);
  if (!etiket || alanAl(kimlik) !== 'todo') return null;
  const sayi = varlik ? guvenliOzellikler(varlik)?.acikSayisi : null;
  return { id: kimlik, etiket, kullanilabilir: kullanilabilirMi(varlik), acikSayisi: Number.isInteger(sayi) ? sayi : null };
}

/**
 * @param {object} girdi
 * @param {object} girdi.ayarlar ayar nesnesi (bilgi alanları ayar-alanlari.js'ten gelir)
 * @param {(kimlik:string)=>object|null|undefined} girdi.durumAl depo okuyucu
 * @param {Function} [girdi.t] çevirmen (verilmezse Türkçe)
 * @param {object[]} [girdi.sensorKarolari] favoriler arasındaki sensor / binary_sensor karoları (yuzey-modeli.js karoOlustur çıktısı)
 */
function bilgiModeliOlustur({ ayarlar, durumAl, t = TR, sensorKarolari = [] }) {
  const y = yapilandirma(ayarlar);
  const a = ayarlar && typeof ayarlar === 'object' ? ayarlar : {};

  const serit = [];
  for (const kimlik of y.serit) {
    const alan = alanAl(kimlik);
    if (alan !== 'sensor' && alan !== 'binary_sensor') continue;
    const karo = bilgiKarosu(kimlik, durumAl, t);
    if (karo) serit.push(karo);
  }

  const kartlar = [];
  for (const { yuva, deger } of y.kartlar) {
    if (deger === 'yok') continue;
    if (deger === 'saat') {
      kartlar.push({ yuva, tur: 'saat', karo: null, secilmedi: false });
    } else if (deger === 'hava') {
      const karo = y.hava && alanAl(y.hava) === 'weather' ? bilgiKarosu(y.hava, durumAl, t) : null;
      kartlar.push({ yuva, tur: 'hava', karo, secilmedi: y.hava === '' });
    } else {
      const alan = alanAl(deger);
      const karo = alan === 'sensor' || alan === 'binary_sensor' ? bilgiKarosu(deger, durumAl, t) : null;
      if (karo) kartlar.push({ yuva, tur: 'varlik', karo, secilmedi: false });
    }
  }

  return {
    ayar: {
      saatBicimi: a.saatBicimi ?? 'sistem',
      tarihBicimi: a.tarihBicimi ?? 'orta',
      takvimGunSayisi: Number.isInteger(a.takvimGunSayisi) ? a.takvimGunSayisi : 3,
      sensorGrafik: a.sensorGrafik !== false,
      sensorGrafikSaat: [1, 6, 24].includes(a.sensorGrafikSaat) ? a.sensorGrafikSaat : 6,
      pilEsigi: Number.isInteger(a.pilEsigi) ? a.pilEsigi : 20,
    },
    kartlar,
    serit,
    sensorler: (Array.isArray(sensorKarolari) ? sensorKarolari : []).filter((k) => k && (k.alan === 'sensor' || k.alan === 'binary_sensor')),
    takvimler: y.takvimler.map((k) => takvimSatiri(k, durumAl)).filter(Boolean),
    listeler: y.listeler.map((k) => listeSatiri(k, durumAl)).filter(Boolean),
    hizliListe: y.hizliHedef && listeSatiri(y.hizliHedef, durumAl) ? y.hizliHedef : '',
  };
}

/**
 * Panel modeline bilgi bölümünü ekler: favoriler arasındaki sensör karoları ("Sensör" grubu) genel gruplardan çıkarılıp bilgi
 * bölümüne taşınır (salt okunur karolardır: panelin eylem karosu çizimine girmezler, palette ve komut satırında yoktur).
 * @param {{gruplar?: object[]}} model yuzeyModeliOlustur sonucu (yerinde değiştirilir)
 * @returns {object} aynı model
 */
function bilgiBolumunuEkle(model, { ayarlar, durumAl, t = TR }) {
  const gruplar = Array.isArray(model?.gruplar) ? model.gruplar : [];
  const sensorKarolari = gruplar.filter((g) => g.kod === 'sensor').flatMap((g) => g.karolar ?? []);
  model.gruplar = gruplar.filter((g) => g.kod !== 'sensor');
  model.bilgi = bilgiModeliOlustur({ ayarlar, durumAl, t, sensorKarolari });
  return model;
}

/** Modeldeki tüm sensör karoları (şerit + üst kart varlıkları + hava kartı); tepsi uyarısı için. */
function bilgiKarolari(bilgi) {
  return [...(bilgi?.serit ?? []), ...(bilgi?.kartlar ?? []).map((k) => k.karo).filter(Boolean)];
}

/**
 * Dikkat gerektiren sensör sayısı (tepsi ipucu; o-04 "sensorTepsiIpucu"). Aynı kimlik bir kez sayılır. Ulaşılamayan
 * ya da sayı olmayan sensör uyarı sayılmaz.
 * @param {object[]} karolar favori sensör karoları + bilgiKarolari
 * @param {number} [pilEsigi]
 */
function sensorUyariSayisi(karolar, pilEsigi = 20) {
  const gorulen = new Set();
  let sayi = 0;
  for (const karo of Array.isArray(karolar) ? karolar : []) {
    if (!karo || typeof karo.id !== 'string' || gorulen.has(karo.id)) continue;
    gorulen.add(karo.id);
    if (dikkatNedeni(karo, pilEsigi) !== null) sayi += 1;
  }
  return sayi;
}

const sayiAl = (d, varsayilan) => (Number.isInteger(d) ? d : varsayilan);

/** Renderer'a giden bilgi modeli (beyaz liste): karolar rendererKaro'dan geçer; HA'daki ad ve ham öznitelik gitmez. */
function rendererBilgi(bilgi) {
  const dizi = (d) => (Array.isArray(d) ? d : []);
  const a = bilgi?.ayar ?? {};
  return {
    ayar: {
      saatBicimi: ['sistem', '24', '12'].includes(a.saatBicimi) ? a.saatBicimi : 'sistem',
      tarihBicimi: ['orta', 'kisa', 'uzun', 'yok'].includes(a.tarihBicimi) ? a.tarihBicimi : 'orta',
      takvimGunSayisi: sayiAl(a.takvimGunSayisi, 3),
      sensorGrafik: a.sensorGrafik !== false,
      sensorGrafikSaat: [1, 6, 24].includes(a.sensorGrafikSaat) ? a.sensorGrafikSaat : 6,
      pilEsigi: sayiAl(a.pilEsigi, 20),
    },
    kartlar: dizi(bilgi?.kartlar).map((k) => ({
      yuva: k.yuva === 2 ? 2 : 1,
      tur: ['hava', 'saat', 'varlik'].includes(k.tur) ? k.tur : 'saat',
      karo: k.karo ? rendererKaro(k.karo) : null,
      secilmedi: k.secilmedi === true,
    })),
    serit: dizi(bilgi?.serit).map(rendererKaro),
    sensorler: dizi(bilgi?.sensorler).map(rendererKaro),
    takvimler: dizi(bilgi?.takvimler).map((k) => ({ id: k.id, etiket: k.etiket, kullanilabilir: k.kullanilabilir === true, mesgul: typeof k.mesgul === 'boolean' ? k.mesgul : null })),
    listeler: dizi(bilgi?.listeler).map((k) => ({ id: k.id, etiket: k.etiket, kullanilabilir: k.kullanilabilir === true, acikSayisi: Number.isInteger(k.acikSayisi) ? k.acikSayisi : null })),
    hizliListe: typeof bilgi?.hizliListe === 'string' ? bilgi.hizliListe : '',
  };
}

module.exports = {
  EN_COK_SERIT,
  EN_COK_TAKVIM,
  EN_COK_LISTE,
  yapilandirma,
  bilgiKimlikleri,
  bilgiKaydi,
  bilgiModeliOlustur,
  bilgiBolumunuEkle,
  bilgiKarolari,
  sensorUyariSayisi,
  rendererBilgi,
};
