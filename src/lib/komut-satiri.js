'use strict';

/**
 * Komut satırı eylemi: `Ev Paneli.exe --eylem=<ad>` (hiz-05). Saf; Electron'a bağlı değildir.
 *
 * Güvenlik: <ad> yalnız AYARDAKİ FAVORİ karolar arasında aranır (serbest metin/kimlik eylemi yok); çözülen kimlik
 * her zamanki güvenli eylem hattından geçer (kaynak 'komut-satiri': yıkıcı eylem ve kapı/kilit çalışmaz).
 * Birden çok karo eşleşirse HİÇBİRİ çalıştırılmaz (belirsiz).
 *
 * Kabul edilen biçimler: `--eylem=Salon`, `--eylem="led 40"`, tırnaksız `--eylem=led 40` (ardışık argümanlar ada eklenir),
 * eşittirsiz `--eylem Salon` (h-22).
 */

const { anahtarKatla, adAnahtari } = require('./metin');
const { sorguCoz, alanKomutu, komutluAlanMi, kuyrukBolumleri } = require('./arama');

const EYLEM_ARGI = '--eylem';
const EYLEM_ONEKI = '--eylem=';
const EN_COK_AD = 60;
const EN_AZ_ONEK_HARFI = 2; // önek eşleşmesi için en az harf/rakam ("f" Film'i çalıştırmasın; h-22)

/** `-` ile başlayıp en az bir karakter daha taşıyan argüman başka bir seçenektir ("-" tek başına "Ses -" adının parçasıdır). */
const secenekMi = (a) => typeof a !== 'string' || /^-./.test(a);

/**
 * argv içinde `--eylem...` ile başlayan bir argüman var mı? Ayrıştırılamasa bile (eşittirsiz, boş, bozuk) kullanıcı bir
 * eylem istemiştir: çağıran sessiz kalmamalı, pencere açmamalı, hata bildirmelidir.
 * @param {unknown} argv
 */
function eylemIstendiMi(argv) {
  return Array.isArray(argv) && argv.some((a) => typeof a === 'string' && a.toLowerCase().startsWith(EYLEM_ARGI));
}

/**
 * argv içinden eylem adını alır: `--eylem=<ad>` ya da `--eylem <ad>`. İlk eşleşen kullanılır; ardından gelen ve `-` ile
 * başlamayan argümanlar ada boşlukla eklenir (PowerShell'de tırnaksız `--eylem=led 40`). Denetim karakterleri atılır; 60
 * karakteri aşan, boş ya da yalnız noktalama olan ad geçersizdir.
 * @param {unknown} argv
 * @returns {{ad: string}|null}
 */
function komutSatiriEylemi(argv) {
  if (!Array.isArray(argv)) return null;
  const sira = argv.findIndex((a) => {
    if (typeof a !== 'string') return false;
    const k = a.toLowerCase();
    return k === EYLEM_ARGI || k.startsWith(EYLEM_ONEKI);
  });
  if (sira === -1) return null;
  const parcalar = [];
  if (argv[sira].length > EYLEM_ARGI.length) parcalar.push(argv[sira].slice(EYLEM_ONEKI.length));
  for (let i = sira + 1; i < argv.length && !secenekMi(argv[i]); i += 1) parcalar.push(argv[i]);
  let ad = parcalar.join(' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (ad.length >= 2 && /^(["']).*\1$/.test(ad)) ad = ad.slice(1, -1).trim(); // cmd bazen tırnakları bırakır
  if (ad === '' || ad.length > EN_COK_AD) return null;
  if (anahtarKatla(ad) === '') return null;
  return { ad };
}

/** `light.masa_led_x` -> `masa led x` (nesne kimliğinin katlanmış hali) */
function nesneAdi(kimlik, katla) {
  return katla(String(kimlik).split('.').slice(1).join(' ').replace(/_/g, ' '));
}

// Ad katlamaları sırayla denenir: önce "+" / "−" işaretlerini ayıran (h-21), bulunamazsa işaretleri atan eski katlama
// ("Salon - Işık" gibi tireyle ayrılmış adlar "salon isik" yazınca yine bulunur).
const KATLAMALAR = [adAnahtari, anahtarKatla];

/**
 * Tek bir katlamayla karoları arar. Aşamalar: tam etiket / özgün ad, tam nesne kimliği / kimlik, (onek ise) etiket öneki.
 * Önek en az EN_AZ_ONEK_HARFI harf ister. Bir aşamada tek karo çıkarsa o, birden çoğu çıkarsa 'belirsiz'.
 */
function katlamayla(metin, liste, katla, onek) {
  const hedef = katla(metin);
  if (hedef === '') return { hata: 'bulunamadi' };
  const adlar = (k) => [k.etiket, k.ad].filter((a) => typeof a === 'string');
  const asamalar = [
    (k) => adlar(k).some((a) => katla(a) === hedef),
    (k) => nesneAdi(k.id, katla) === hedef || katla(k.id) === hedef,
  ];
  if (onek && hedef.replace(/ /g, '').length >= EN_AZ_ONEK_HARFI) asamalar.push((k) => adlar(k).some((a) => katla(a).startsWith(hedef)));
  for (const asama of asamalar) {
    const bulunan = liste.filter(asama);
    if (bulunan.length === 1) return { karo: bulunan[0] };
    if (bulunan.length > 1) return { hata: 'belirsiz' };
  }
  return { hata: 'bulunamadi' };
}

/** Katlamaları sırayla dener; belirsiz sonuç kesindir (ikinci katlamaya düşülmez), bulunamayan düşer. */
function adiEsle(metin, liste, onek) {
  for (const katla of KATLAMALAR) {
    const s = katlamayla(metin, liste, katla, onek);
    if (s.karo || s.hata === 'belirsiz') return s;
  }
  return { hata: 'bulunamadi' };
}

/**
 * 1.4.0 servis komutu: "klima 24", "masa sicak", "tv ses 30", "ev modu uyku" (arama.js alanKomutu — palette AYNI sözlük).
 * Sorgunun sonundaki 1-4 sözcük (en kısa önce) eşleşen karonun kendi alanında bir komutsa, kalan baş kısım o komutu kabul
 * eden karolar arasında ada çözülür. Birden çok karo eşleşirse HİÇBİRİ seçilmez (belirsiz). Komut tanınıp cihaz desteklemiyorsa
 * ya da değer cihazın aralığı dışındaysa 'desteklenmiyor' / 'sinir' hatası döner. Çıkan servis yine eylem hattından geçer;
 * onay isteyen servisler (iklim modu gibi) komut satırından çalışmaz ('kaynak-izinsiz').
 * @returns {{id: string, servis: string, veri?: object}|{hata: 'belirsiz'|'sinir'|'desteklenmiyor'}|null}
 */
function servisKomutunuCoz(ad, karolar) {
  const adaylar = karolar.filter((k) => komutluAlanMi(k?.alan));
  if (adaylar.length === 0) return null;
  for (const { bas, kuyruk } of kuyrukBolumleri(ad)) {
    const komutlular = adaylar.filter((k) => alanKomutu(k, kuyruk) !== null);
    if (komutlular.length === 0) continue;
    const s = adiEsle(bas, komutlular, true);
    if (s.hata === 'belirsiz') return { hata: 'belirsiz' };
    if (!s.karo) continue;
    const komut = alanKomutu(s.karo, kuyruk);
    if (komut.hata) return { hata: komut.hata };
    return komut.veri === undefined ? { id: s.karo.id, servis: komut.servis } : { id: s.karo.id, servis: komut.servis, veri: komut.veri };
  }
  return null;
}

/**
 * Adı favori karolardan birine çözer. Sıra: tam etiket eşleşmesi, tam nesne kimliği / kimlik, etiket öneki (en az 2 harf).
 * Sondaki sayıdan ÖNCE tam ad denenir ("salon 2" adlı karo varsa o seçilir; h-23). Sonra "led 40", "led 40%", "led %40"
 * sondaki 1-100 sayısı yalnız eşleşen karo parlaklık kontrollü bir ışıksa parlaklık sayılır; "led 0" aynı ışığı kapatır.
 * Sonra 1.4.0 servis komutları (servisKomutunuCoz). Düz ad ve parlaklık yalnız tek tıklama eylemi olan karolarda aranır
 * (`varsayilanEylem: false` olan iklim, medya, seçici... karoları yalnız komutla çalışır).
 * @param {string} ad
 * @param {{id: string, etiket: string, parlaklikKontrol?: boolean, alan?: string, ozellik?: object|null, varsayilanEylem?: boolean}[]} karolar zaten güvenli süzülmüş favori karoları
 * @returns {{id: string, parlaklik?: number, kapat?: true, servis?: string, veri?: object}|{hata: 'bulunamadi'|'belirsiz'|'sinir'|'desteklenmiyor'|'komutGerekli'}}
 */
function eylemAdiniCoz(ad, karolar) {
  const tumu = Array.isArray(karolar) ? karolar : [];
  const liste = tumu.filter((k) => k?.varsayilanEylem !== false);
  const tam = adiEsle(ad, liste, false);
  if (tam.karo) return { id: tam.karo.id };
  if (tam.hata === 'belirsiz') return { hata: 'belirsiz' };
  const { metin, parlaklik, kapat } = sorguCoz(ad);
  if (parlaklik !== null || kapat === true) {
    const s = adiEsle(metin, liste, true);
    if (s.karo?.parlaklikKontrol === true) return kapat === true ? { id: s.karo.id, kapat: true } : { id: s.karo.id, parlaklik };
    if (s.hata === 'belirsiz') return { hata: 'belirsiz' };
  }
  const komutlu = servisKomutunuCoz(ad, tumu);
  if (komutlu) return komutlu;
  const s = adiEsle(ad, liste, true);
  if (s.karo) return { id: s.karo.id };
  if (s.hata === 'bulunamadi') {
    // Ad, tek tıklama eylemi olmayan bir karoya (iklim, medya, seçici...) uyuyor ama komut yok: "favoride yok" demek yanıltır.
    const komutsuz = adiEsle(ad, tumu.filter((k) => k?.varsayilanEylem === false && komutluAlanMi(k.alan)), true);
    if (komutsuz.karo || komutsuz.hata === 'belirsiz') return { hata: 'komutGerekli' };
  }
  return { hata: s.hata };
}

module.exports = { EYLEM_ARGI, EYLEM_ONEKI, EN_COK_AD, EN_AZ_ONEK_HARFI, eylemIstendiMi, komutSatiriEylemi, eylemAdiniCoz };
