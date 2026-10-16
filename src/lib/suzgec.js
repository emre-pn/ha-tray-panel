'use strict';

/**
 * GÜVENLİK KURALI süzgeci (saf; Electron'a bağlı değildir).
 * Liste, kayıt ve çalıştırma — hepsi guvenliVarlikMi'yi kullanır. Kapı/kilit/alarm/garaj/bariyer/gate/lock
 * (1.2.0, h-03: diafon/interkom/kepenk/deadbolt/latch/buzzer/yale/shutter da) varlıkları hiçbir favoriye, listeye ya da
 * eyleme giremez. Bu dosyadaki kurallar yalnız sıkılaştırılabilir; tek gevşeme, hata-11'deki "indoor/outdoor" yanlış
 * engelidir ve YALNIZ o tam belirteçler için geçerlidir.
 * 1.2.0 (h-39): varlığın üye listesi (sahne/grup `attributes.entity_id`) varsa her üye de kapı kuralından geçer; kapı/kilit
 * (ya da kepenk/kapı alanı `cover`) içeren sahne güvensizdir. Liste yoksa davranış değişmez.
 *
 * 1.4.0 (yalnız sıkılaştırma ve yeni alanların kaydı):
 *  - Hangi alanın hiçbir yüzeye girebileceği artık src/lib/alan-kaydi.js tablosundadır (climate, media_player, humidifier,
 *    vacuum, input_select, select, input_number, number, timer, todo, sensor, binary_sensor, weather, calendar eklendi).
 *    Tabloda olmayan alan (cover — perde dahil —, camera, valve, lock, alarm_control_panel, siren...) guvenliVarlikMi'den geçmez.
 *    FAVORI_ALANLARI 1.3.0'ın tek tıklamalı favori alanlarıdır ve DEĞİŞMEDİ (tepsi menüsü/son kullanılanlar onu kullanır);
 *    favori/karo olabilirlik için alan-kaydi.js karoAlaniMi kullanılır.
 *  - siren alanı Kapı Kuralı alanlarına eklendi ve "siren" sözcüğü yasak parçalara eklendi (README, KILAVUZ ve Ayarlar kural metniyle birlikte).
 *  - Yasak cihaz sınıflarına binary_sensor'ın kapı/pencere/açıklık/kurcalama/güvenlik sınıfları eklendi (opening, window,
 *    tamper, safety; door, garage_door, lock zaten vardı). Sınıflar TÜM alanlarda yasaktır.
 *  - Seçenek listesi (`attributes.options`: input_select, select, enum sensör) varsa her seçenek kapı kuralından geçmelidir;
 *    "Kapıyı aç" seçeneği taşıyan bir seçici bütünüyle güvensizdir (seçmek bir otomasyonla kapı açabilir).
 *  - Metin öznitelikleri (medya başlığı, kaynak adı, takvim/yapılacaklar başlığı, bildirim metni...) metinGuvenliMi /
 *    guvenliMetin / metinListesiSuz ile süzülür: geçmeyen metin gösterilmez.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { sadelestir, kisalt } = require('./metin');
const { kayitliAlanMi } = require('./alan-kaydi');

/** Favori olabilecek alanlar ve tepsiden tıklanınca çağrılacak HA servisi. */
const FAVORI_ALANLARI = {
  light: { servis: 'toggle', etiket: 'Işıklar', acKapa: true },
  switch: { servis: 'toggle', etiket: 'Prizler ve anahtarlar', acKapa: true },
  fan: { servis: 'toggle', etiket: 'Vantilatörler', acKapa: true },
  input_boolean: { servis: 'toggle', etiket: 'Sanal anahtarlar', acKapa: true },
  scene: { servis: 'turn_on', etiket: 'Sahneler', acKapa: false },
  script: { servis: 'turn_on', etiket: 'Scriptler', acKapa: false },
  button: { servis: 'press', etiket: 'Düğmeler', acKapa: false },
  input_button: { servis: 'press', etiket: 'Sanal düğmeler', acKapa: false },
};
const ALAN_SIRASI = Object.keys(FAVORI_ALANLARI);

// GÜVENLİK KURALI — bu varlıklar hiçbir zaman listelenmez, favori olamaz, hiçbir yüzeyden çalıştırılamaz.
const YASAK_ALANLAR = new Set(['lock', 'alarm_control_panel', 'siren']);
// 1.4.0: binary_sensor'ın kapı/pencere/açıklık/kilit/kurcalama/güvenlik sınıfları da (tüm alanlarda) yasaktır.
const YASAK_CIHAZ_SINIFLARI = new Set(['door', 'garage_door', 'garage', 'gate', 'lock', 'opening', 'window', 'tamper', 'safety']);

// Sözcükler sadeleştirilmiş (küçük harf, aksansız, NFKD, görünmez karakterler silinmiş) metinde ve belirteç (harf/rakam
// öbeği) bazında aranır; alt çizgi, boşluk ve noktalama ayraçtır.
// Türkçe sözcükler ve "door" belirtecin HERHANGİ bir yerinde engellenir ("kapi", "salonkapisi", "frontdoor").
// "kilid": Türkçede "kilit" ek alınca "kilidi / kilide / kilidin" olur ("Kilidi aç" script'i kuralı atlatmasın).
// h-03 (1.2.0, yalnız sıkılaştırma): kapıyı gerçekten açan başka adlar da belirtecin HERHANGİ bir yerinde engellenir: diafon,
// interkom/intercom, kepenk ("kepeng": "kepengi / kepenge" ek biçimleri), deadbolt, latch, buzzer, yale, shutter.
// "giriş"/"entrance" bilerek EKLENMEDİ: masum adları da ("Giriş lambası") engellerdi.
const YASAK_PARCALAR = [
  'kapi',
  'door',
  'kilit',
  'kilid',
  'alarm',
  'garaj',
  'bariyer',
  'garage',
  'diafon',
  'interkom',
  'intercom',
  'kepenk',
  'kepeng',
  'deadbolt',
  'latch',
  'buzzer',
  'yale',
  'shutter',
  'siren', // 1.4.0: siren alanı zaten yasaktı; adında/kimliğinde geçen her varlık da engellenir (README ve Ayarlar kural metniyle birlikte)
];
// hata-11: yalnız bu TAM belirteçler "door" engelinden muaftır. frontdoor/doorbell/outdoorlight engelli kalır.
const DOOR_ISTISNA = new Set(['indoor', 'outdoor', 'indoors', 'outdoors']);
// "gate" ve "lock" da belirtecin HERHANGİ bir yerinde engellenir: gate, gateway, maingate, frontgate, keylock, padlock,
// smartlock, unlock, lockdown, smartgateopener. Bilinen masum sözcükler (navigate, clock, block...) önce ayıklanır;
// ayıklanan yer boşlukla değiştirilir, kalan parçalar birleşip yeni bir sözcük oluşturmaz. Bu liste yalnız bugün
// (belirteç başına bakan eski kuralın) zaten geçirdiği sözcüklerden oluşur: kuralı gevşetmez.
const YASAK_KISA_PARCALAR = ['gate', 'lock', 'unlock'];
const MASUM_SOZCUKLER = [
  'navigate',
  'investigate',
  'aggregate',
  'delegate',
  'negate',
  'propagate',
  'irrigate',
  'mitigate',
  'litigate',
  'instigate',
  'clock',
  'block',
  'flock',
];
const MASUM_DESENI = new RegExp(MASUM_SOZCUKLER.join('|'), 'g');
const YASAK_KELIMELER = [...YASAK_PARCALAR, ...YASAK_KISA_PARCALAR];
// Sadeleştirmeden sonra a-z dışında HARF (Kiril "а", Yunan "α", CJK...) kalan metin güvensizdir: Türkçe ve Latin harfleri
// ASCII'ye iner, bu yüzden kalan bir harf, benzer-harfle (homoglif) gizlenmiş "kapı"/"gate" olabilir. Kapıyı kapalı tutar.
const YABANCI_HARF = /(?![a-z])\p{L}/u;

function alanAl(varlikKimligi) {
  return String(varlikKimligi).split('.')[0];
}

function belirteclereAyir(sade) {
  return sade.split(/[^a-z0-9]+/).filter(Boolean);
}

function adGuvenliMi(varlikKimligi, ad) {
  const sadeKimlik = sadelestir(varlikKimligi);
  const sadeAd = sadelestir(ad);
  if (YABANCI_HARF.test(sadeKimlik) || YABANCI_HARF.test(sadeAd)) return false;
  // Kimlik ve ad ayrı ayrı bölünür: bir belirteç ikisinin sınırını aşmaz.
  for (const b of [...belirteclereAyir(sadeKimlik), ...belirteclereAyir(sadeAd)]) {
    for (const parca of YASAK_PARCALAR) {
      if (b.includes(parca) && !(parca === 'door' && DOOR_ISTISNA.has(b))) return false;
    }
    const kalan = b.replace(MASUM_DESENI, ' ');
    if (YASAK_KISA_PARCALAR.some((parca) => kalan.includes(parca))) return false;
  }
  return true;
}

/**
 * h-39 (1.2.0): üye varlıkta yasak alan. `cover` kepenk/kapı alanıdır (garaj kapısı, bahçe kapısı, kepenk): üyenin cihaz sınıfı
 * sahne niteliklerinde bulunmadığı için kepenk ile perde ayırt edilemez; güvenlik için hepsi engellenir.
 */
const UYE_YASAK_ALANLARI = new Set([...YASAK_ALANLAR, 'cover']);

/**
 * h-39: sahne/grup üye listesi (attributes.entity_id). Liste yoksa (undefined/null) true: bugünkü davranış. Varsa her üye
 * geçerli bir varlık kimliği olmalı, yasak alanda (kilit, alarm, kepenk/kapı) olmamalı ve kimliği kapı kuralından geçmeli.
 * Beklenmeyen biçim (dizi/metin olmayan değer, geçersiz üye) güvensiz sayılır.
 */
function uyelerGuvenliMi(uyeler) {
  if (uyeler === undefined || uyeler === null) return true;
  const liste = typeof uyeler === 'string' ? [uyeler] : uyeler;
  if (!Array.isArray(liste)) return false;
  for (const uye of liste) {
    if (typeof uye !== 'string' || !VARLIK_KIMLIGI_DESENI.test(uye)) return false;
    if (UYE_YASAK_ALANLARI.has(alanAl(uye))) return false;
    if (!adGuvenliMi(uye, '')) return false;
  }
  return true;
}

const EN_COK_SECENEK = 200;

/**
 * 1.4.0: seçenek listesi (input_select/select `options`, enum sensör). Yoksa true. Varsa en çok 200 metin olmalı ve HER biri kapı
 * kuralından geçmelidir; beklenmeyen biçim güvensizdir.
 */
function seceneklerGuvenliMi(secenekler) {
  if (secenekler === undefined || secenekler === null) return true;
  if (!Array.isArray(secenekler) || secenekler.length > EN_COK_SECENEK) return false;
  return secenekler.every((s) => typeof s === 'string' && adGuvenliMi('', s));
}

/**
 * GÜVENLİK KURALI'nın tek uygulandığı yer. Liste, kayıt ve çalıştırma — hepsi bunu kullanır.
 * 1.4.0: alan src/lib/alan-kaydi.js tablosunda olmalıdır (eskiden FAVORI_ALANLARI). Favori/karo olabilirlik ayrıca karoAlaniMi ile,
 * servis çağrılabilirlik eylemAlaniMi + servis-izinleri.js ile denetlenir.
 */
function guvenliVarlikMi(varlik) {
  if (!varlik || typeof varlik.entity_id !== 'string') return false;
  const kimlik = varlik.entity_id;
  if (!VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
  const alan = alanAl(kimlik);
  if (YASAK_ALANLAR.has(alan)) return false;
  if (!kayitliAlanMi(alan)) return false;
  const nitelikler = varlik.attributes && typeof varlik.attributes === 'object' ? varlik.attributes : {};
  // h-03: cihaz sınıfı büyük/küçük harf (ve tam genişlik, görünmez karakter) duyarsız karşılaştırılır; sınıf metni de sözcük
  // kuralından geçer ("Door", "DOOR", "door_lock" engellenir).
  const sinif = String(nitelikler.device_class ?? '');
  if (YASAK_CIHAZ_SINIFLARI.has(sadelestir(sinif).trim()) || !adGuvenliMi('', sinif)) return false;
  if (!uyelerGuvenliMi(nitelikler.entity_id)) return false; // h-39: kapı/kilit içeren sahne/grup
  if (!seceneklerGuvenliMi(nitelikler.options)) return false; // 1.4.0: "Kapıyı aç" seçenekli seçici
  return adGuvenliMi(kimlik, nitelikler.friendly_name ?? '');
}

/** 1.4.0: serbest metin (medya başlığı, takvim/yapılacaklar başlığı, bildirim metni, birim...) kapı kuralından geçer mi? */
function metinGuvenliMi(metin) {
  return typeof metin === 'string' && adGuvenliMi('', metin);
}

/**
 * 1.4.0: metni kısaltır ve süzer. Metin değilse, boşsa ya da kapı kuralından geçmezse null (gösterilmez).
 * Kısaltma süzgeçten ÖNCE yapılır: kesilen metin de denetlenir.
 * @param {unknown} metin
 * @param {number} [enFazla] kod noktası sınırı (varsayılan 100)
 * @returns {string|null}
 */
function guvenliMetin(metin, enFazla = 100) {
  if (typeof metin !== 'string') return null;
  const kisa = kisalt(metin, enFazla);
  if (!kisa || !adGuvenliMi('', kisa) || !adGuvenliMi('', metin)) return null;
  return kisa;
}

/**
 * 1.4.0: metin listesinden (medya kaynakları, fan ön ayarları...) süzgeçten geçenleri kısaltılmış olarak döner; geçmeyen öğe
 * sessizce düşer. Dizi değilse boş liste.
 * @param {unknown} liste
 * @param {{enCok?: number, enUzun?: number}} [secenek]
 * @returns {string[]}
 */
function metinListesiSuz(liste, { enCok = 50, enUzun = 60 } = {}) {
  if (!Array.isArray(liste)) return [];
  const sonuc = [];
  for (const oge of liste) {
    if (sonuc.length >= enCok) break;
    const m = guvenliMetin(oge, enUzun);
    if (m !== null && !sonuc.includes(m)) sonuc.push(m);
  }
  return sonuc;
}

module.exports = {
  FAVORI_ALANLARI,
  ALAN_SIRASI,
  YASAK_ALANLAR,
  YASAK_PARCALAR,
  YASAK_KISA_PARCALAR,
  MASUM_SOZCUKLER,
  YASAK_KELIMELER,
  DOOR_ISTISNA,
  YASAK_CIHAZ_SINIFLARI,
  UYE_YASAK_ALANLARI,
  sadelestir,
  alanAl,
  adGuvenliMi,
  uyelerGuvenliMi,
  seceneklerGuvenliMi,
  guvenliVarlikMi,
  metinGuvenliMi,
  guvenliMetin,
  metinListesiSuz,
};
