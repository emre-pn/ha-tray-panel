'use strict';

/**
 * Kesin yönlü eylemler (o-13; saf, Electron'a bağlı değildir): "led +10", "led -10", "salon ac", "salon kapat" ve eylem kısayolu.
 *
 * Aç-kapa (toggle) her seferinde farklı sonuç verir; Stream Deck döner düğmesi ya da Görev Zamanlayıcı gibi tekrar eden çağrılar için
 * sonucu belli olan eylemler gerekir: aç, kapat, parlaklık +N / -N, vantilatör hızı +N / -N. Bu dosya yalnız KARARI verir
 * (hangi öğe hangi yönü destekler, geçerli kısayol eylemi hangileridir, göreli değer ne olur); gerçek çağrı src/eylem.js'ten tek
 * güvenli hattan geçer (kapı kuralı, eylem sınıfı, servis izin listesi, hız sınırı). Burada yeni servis YOKTUR: yalnız
 * turn_on / turn_off / toggle, light parlaklığı (brightness_pct) ve fan.set_percentage kullanılır.
 *
 * Kısayol eylemi (favori kaydında `kisayolEylemi`, kapalı liste): '' (yok = aç-kapa), 'ac', 'kapat', 'parlak+5|10|20',
 * 'parlak-5|10|20' (yalnız parlaklık kontrollü ışık), 'hiz+10|20', 'hiz-10|20' (yalnız vantilatör).
 */

const { yonCoz } = require('./arama');
const { yuzdeCevir } = require('./durum-deposu');

/** Aç / kapat / aç-kapa yönü olan alanlar (alan-kaydi.js'te toggle, turn_on, turn_off izinli olanlar). */
const AC_KAPAT_ALANLARI = Object.freeze(['light', 'switch', 'fan', 'input_boolean', 'humidifier']);
const PARLAKLIK_ADIMLARI = Object.freeze([5, 10, 20]);
const HIZ_ADIMLARI = Object.freeze([10, 20]);
const KISAYOL_EYLEMI_DESENI = /^(ac|kapat|(?:parlak|hiz)[+-]\d{1,3})$/;

const alanBul = (kimlik) => String(kimlik ?? '').split('.')[0];

/**
 * Bir karonun (komut satırı karosu: { id, parlaklikKontrol }) bu yönü destekleyip desteklemediği.
 * Parlaklık adımı yalnız parlaklık kontrollü ışıkta ve vantilatörde anlamlıdır (kısayol kayıtlarında ışık için kontrol şarttır).
 */
function yonDestekleniyorMu(yon, karo) {
  const alan = alanBul(karo?.id);
  if (!yon || typeof yon !== 'object') return false;
  if (yon.tur === 'goreli') return (alan === 'light' && karo?.parlaklikKontrol === true) || alan === 'fan';
  return AC_KAPAT_ALANLARI.includes(alan);
}

/** Adı çözer ("led +10" -> { metin: 'led', yon: {...} }); yön yoksa null. Tam ad eşleşmesi çağıranın işidir. */
function yonluAdCoz(ad) {
  return yonCoz(ad);
}

/** 'parlak+10' -> { tur: 'goreli', hedef: 'parlaklik', delta: 10 }; 'ac' -> { tur: 'ac' }; geçersiz -> null. */
function kisayolEylemiYonu(deger) {
  if (typeof deger !== 'string' || !KISAYOL_EYLEMI_DESENI.test(deger)) return null;
  if (deger === 'ac') return { tur: 'ac' };
  if (deger === 'kapat') return { tur: 'kapat' };
  const hedef = deger.startsWith('parlak') ? 'parlaklik' : 'hiz';
  const delta = Number(deger.slice(hedef === 'parlaklik' ? 6 : 3));
  const adimlar = hedef === 'parlaklik' ? PARLAKLIK_ADIMLARI : HIZ_ADIMLARI;
  if (!Number.isInteger(delta) || delta === 0 || !adimlar.includes(Math.abs(delta))) return null;
  return { tur: 'goreli', hedef, delta };
}

/** Bir alan için Ayarlar'da seçilebilen kısayol eylemleri (kapalı liste; '' = varsayılan aç-kapa listede yok). */
function kisayolEylemSecenekleri(alan) {
  if (!AC_KAPAT_ALANLARI.includes(alan)) return [];
  const liste = ['ac', 'kapat'];
  if (alan === 'light') for (const sinyal of ['+', '-']) for (const adim of PARLAKLIK_ADIMLARI) liste.push(`parlak${sinyal}${adim}`);
  if (alan === 'fan') for (const sinyal of ['+', '-']) for (const adim of HIZ_ADIMLARI) liste.push(`hiz${sinyal}${adim}`);
  return liste;
}

/**
 * Kısayol eylemi bu favori için geçerli mi? Parlaklık adımı yalnız `parlaklik` kontrolü açık ışıkta, hız adımı yalnız vantilatörde.
 * @param {string} alan
 * @param {unknown} deger
 * @param {{parlaklik?: boolean}} [favori]
 */
function kisayolEylemiGecerliMi(alan, deger, favori) {
  const yon = kisayolEylemiYonu(deger);
  if (!yon) return false;
  if (!kisayolEylemSecenekleri(alan).includes(deger)) return false;
  if (yon.tur === 'goreli' && yon.hedef === 'parlaklik') return favori?.parlaklik === true;
  return true;
}

const sinirla = (n, alt, ust) => Math.min(ust, Math.max(alt, n));
const sayi = (d) => (typeof d === 'number' && Number.isFinite(d) ? d : null);

/**
 * Göreli parlaklık: HA'daki GÜNCEL duruma göre yeni yüzdeyi hesaplar (hesap bellekteki eski değere değil, çağrı anındaki duruma bakar).
 * Açıkken yüzde (en az 1) delta kadar kayar, 1..100 arasında kalır ("-" ışığı kapatmaz; kapatmak için "kapat"). Kapalıyken artı
 * adım ışığı o yüzdeyle açar ("+10" -> %10), eksi adım bir şey yapmaz.
 * @param {{state?: string, attributes?: object}} varlik
 * @param {number} delta işaretli adım
 * @returns {{tur: 'ayarla', yuzde: number} | {tur: 'degisim-yok'} | {tur: 'desteklenmiyor'} | {tur: 'ulasilamiyor'}}
 */
function goreliParlaklik(varlik, delta) {
  if (!Number.isInteger(delta) || delta === 0) return { tur: 'desteklenmiyor' };
  const durum = varlik?.state;
  if (durum === 'unavailable') return { tur: 'ulasilamiyor' };
  if (durum === 'off') return delta > 0 ? { tur: 'ayarla', yuzde: sinirla(delta, 1, 100) } : { tur: 'degisim-yok' };
  if (durum !== 'on') return { tur: 'desteklenmiyor' };
  const simdiki = yuzdeCevir(varlik.attributes?.brightness);
  if (simdiki === null) return { tur: 'desteklenmiyor' }; // parlaklığını bildirmeyen ışıkta göreli değer hesaplanamaz
  const yeni = sinirla(Math.max(1, simdiki) + delta, 1, 100);
  return yeni === Math.max(1, simdiki) ? { tur: 'degisim-yok' } : { tur: 'ayarla', yuzde: yeni };
}

/**
 * Göreli vantilatör hızı (fan.set_percentage): yüzde 0..100 arasında kalır; 0 vantilatörü kapatır (HA davranışı).
 * Kapalıyken artı adım o hızla açar, eksi adım bir şey yapmaz. Açıkken `percentage` bilinmiyorsa desteklenmiyor.
 * Basamaklı vantilatörde (`percentage_step` > 1; ör. 3 hızlı fanda 33,33) HA yüzdeyi yukarı yuvarlayarak hız basamağına çevirir
 * (ceil(yüzde * hızSayısı / 100)); delta basamaktan küçükse aynı basamağa düşer ve hız değişmez. Bu yüzden delta basamak sayısına
 * çevrilir (en az 1 basamak, işaretine göre) ve hedef yüzde o basamağın alt sınırıdır (tamsayıya aşağı yuvarlanır: 66,67 -> 66 yine
 * 2. basamak). Adım bilinmiyorsa ya da 1'den küçükse (sürekli ölçek) hesap yüzde üzerinden yapılır.
 * @returns {{tur: 'ayarla', yuzde: number} | {tur: 'degisim-yok'} | {tur: 'desteklenmiyor'} | {tur: 'ulasilamiyor'}}
 */
function goreliHiz(varlik, delta) {
  if (!Number.isInteger(delta) || delta === 0) return { tur: 'desteklenmiyor' };
  const durum = varlik?.state;
  if (durum === 'unavailable') return { tur: 'ulasilamiyor' };
  let simdiki;
  if (durum === 'off') simdiki = 0;
  else if (durum === 'on') simdiki = sayi(varlik.attributes?.percentage);
  else return { tur: 'desteklenmiyor' };
  if (simdiki === null) return { tur: 'desteklenmiyor' };
  const adim = sayi(varlik.attributes?.percentage_step);
  if (adim !== null && adim > 1 && adim <= 100) return goreliBasamak(simdiki, delta, adim);
  const yeni = sinirla(Math.round(simdiki + delta), 0, 100);
  return yeni === Math.round(simdiki) ? { tur: 'degisim-yok' } : { tur: 'ayarla', yuzde: yeni };
}

/** Basamaklı vantilatör (goreliHiz): basamak sayısı üzerinden göreli hız; hedef yüzde hedef basamağın alt sınırıdır (son basamak 100). */
function goreliBasamak(simdiki, delta, adim) {
  const enCok = Math.round(100 / adim);
  const simdikiBasamak = sinirla(Math.round(simdiki / adim), 0, enCok);
  const fark = Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / adim));
  const hedefBasamak = sinirla(simdikiBasamak + fark, 0, enCok);
  const yeni = hedefBasamak >= enCok ? 100 : Math.floor(hedefBasamak * adim);
  return hedefBasamak === simdikiBasamak || yeni === Math.round(simdiki) ? { tur: 'degisim-yok' } : { tur: 'ayarla', yuzde: yeni };
}

module.exports = {
  AC_KAPAT_ALANLARI,
  PARLAKLIK_ADIMLARI,
  HIZ_ADIMLARI,
  yonDestekleniyorMu,
  yonluAdCoz,
  kisayolEylemiYonu,
  kisayolEylemSecenekleri,
  kisayolEylemiGecerliMi,
  goreliParlaklik,
  goreliHiz,
};
