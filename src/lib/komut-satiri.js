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
 *
 * 1.4.0 (o-19) pencere ve durum komutları (aşağıda pencereDurumKomutu): `--goster` / `--gizle` / `--degistir` (isteğe bağlı
 * `--hedef=ana|panel|palet`, varsayılan ana pencere) ve `--durum` / `--liste` ile `--cikti=<dosya.json>`. Bu komutlar HİÇBİR servis
 * çağrısı yapmaz; yalnız pencere gösterir/gizler ya da durumu bir JSON dosyasına yazar. `--eylem` ile birlikte verilemez.
 *
 * 1.4.0 dış tetikler (dis grubu, aşağıda): `--kaynak=jumplist|kisayol` (o-21: görev çubuğu atlama listesi ve masaüstü kısayolu
 * `--eylem` ile birlikte verir; eylem o zaman dış tetik kapısından, Ayarlar'daki seçenek açıksa geçer) ve `evpaneli://eylem?ad=...`
 * bağlantısı (o-54). Bağlantı YALNIZ favori ADI taşır (varlık kimliği değil); ek olarak en çok bir değiştirici (parlaklik, islem, adim).
 */

const { anahtarKatla, adAnahtari } = require('./metin');
const { sorguCoz, alanKomutu, komutluAlanMi, kuyrukBolumleri } = require('./arama');
const { yonluAdCoz, yonDestekleniyorMu } = require('./yonlu-eylem');

const EYLEM_ARGI = '--eylem';
const EYLEM_ONEKI = '--eylem=';
const EN_COK_AD = 60;
const EN_AZ_ONEK_HARFI = 2; // önek eşleşmesi için en az harf/rakam ("f" Film'i çalıştırmasın; h-22)

/**
 * `-` ile başlayıp en az bir karakter daha taşıyan argüman başka bir seçenektir ("-" tek başına "Ses -" adının parçasıdır).
 * İstisna (o-13): "-10" / "-10%" bir eksi adımıdır, seçenek değil. Tırnaksız `--eylem=led -10` böyle bölünür; seçenek sayılsaydı
 * "-10" sessizce düşer ve "led" aç-kapa çalışırdı.
 */
const secenekMi = (a) => typeof a !== 'string' || (/^-./.test(a) && !/^-\d{1,3}%?$/.test(a));

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
 * 1.4.0 (o-13) kesin yön: tam ad bulunamazsa sondaki işaretli adım ("led +10", "led -10", "fan +20") ya da fiil ("salon ac", "salon kapat",
 * "salon degistir") ayrılır ve kalan ad YALNIZ bu yönü destekleyen karolar arasında aranır (aç/kapat: ışık, priz, vantilatör,
 * input_boolean, nem alıcı; adım: parlaklık kontrollü ışık ve vantilatör). Böylece "ekran kapat" bir düğmeyi çalıştırmaz, "led +10"
 * parlaklık kontrolü kapalı bir ışığa uygulanmaz. Yön çözülemezse (hiç eşleşme yok) eski çözümleme sürer.
 * @param {string} ad
 * @param {{id: string, etiket: string, parlaklikKontrol?: boolean, alan?: string, ozellik?: object|null, varsayilanEylem?: boolean}[]} karolar zaten güvenli süzülmüş favori karoları
 * @returns {{id: string, parlaklik?: number, kapat?: true, yon?: {tur: 'ac'|'kapat'|'degistir'}|{tur: 'goreli', delta: number}, servis?: string, veri?: object}|{hata: 'bulunamadi'|'belirsiz'|'sinir'|'desteklenmiyor'|'komutGerekli'}}
 */
function eylemAdiniCoz(ad, karolar) {
  const tumu = Array.isArray(karolar) ? karolar : [];
  const liste = tumu.filter((k) => k?.varsayilanEylem !== false);
  const tam = adiEsle(ad, liste, false);
  if (tam.karo) return { id: tam.karo.id };
  if (tam.hata === 'belirsiz') return { hata: 'belirsiz' };
  const yonlu = yonluAdCoz(ad);
  if (yonlu) {
    const s = adiEsle(yonlu.metin, liste.filter((k) => yonDestekleniyorMu(yonlu.yon, k)), true);
    if (s.karo) return { id: s.karo.id, yon: yonlu.yon };
    if (s.hata === 'belirsiz') return { hata: 'belirsiz' };
  }
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

// --- pencere ve durum komutları (o-19) -------------------------------------------------------------------------------

const PENCERE_FIILLERI = Object.freeze({ goster: 'goster', gizle: 'gizle', degistir: 'degistir' });
const DURUM_FIILLERI = Object.freeze(['durum', 'liste']);
const PENCERE_HEDEFLERI = Object.freeze(['ana', 'panel', 'palet']);
const HEDEF_ARGI = '--hedef';
const CIKTI_ARGI = '--cikti';
const EN_COK_CIKTI_YOLU = 300; // ham değer üst sınırı (çözümleme sınırı komut-durum.js'tedir)
/** `--goster`, `--gizle=x` gibi biçimler de "istendi" sayılır (bozuk yazım sessizce yok sayılmaz). */
const FIIL_DESENI = /^--(goster|gizle|degistir|durum|liste)(=|$)/i;

/**
 * `--ad=değer` ya da `--ad değer` seçeneğinin değerini döner (ardışık seçenek olmayan argümanlar boşlukla eklenir, tırnaklar soyulur,
 * denetim karakterleri atılır). Seçenek yoksa null; var ama değeri yoksa ''.
 */
function secenekDegeri(argv, ad) {
  const sira = argv.findIndex((a) => {
    if (typeof a !== 'string') return false;
    const k = a.toLowerCase();
    return k === ad || k.startsWith(`${ad}=`);
  });
  if (sira === -1) return null;
  const parcalar = [];
  if (argv[sira].length > ad.length) parcalar.push(argv[sira].slice(ad.length + 1));
  for (let i = sira + 1; i < argv.length && !secenekMi(argv[i]); i += 1) parcalar.push(argv[i]);
  let deger = parcalar.join(' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (deger.length >= 2 && /^(["']).*\1$/.test(deger)) deger = deger.slice(1, -1).trim();
  return deger;
}

/**
 * argv içindeki pencere/durum komutunu çözer; hiçbiri yoksa null. Sonuç türleri:
 *   { tur: 'pencere', islem: 'goster'|'gizle'|'degistir', hedef: 'ana'|'panel'|'palet' }
 *   { tur: 'durum', liste: boolean, cikti: string|null, dizin: string|null }   cikti: ham değer (güvenli çözümleme komut-durum.js'te)
 *   { tur: 'cakisma' }   birden çok komut (`--goster --gizle`, `--durum --goster`, `--eylem` ile birlikte)
 *   { tur: 'gecersiz' }  bozuk yazım (`--goster=x`, bilinmeyen `--hedef`, fiilsiz `--hedef`/`--cikti`, `--durum --hedef`)
 * @param {unknown} argv
 * @param {string|null} [dizin] komutu veren kopyanın çalışma klasörü (göreli `--cikti` yolunu çözmek için)
 */
function pencereDurumKomutu(argv, dizin = null) {
  if (!Array.isArray(argv)) return null;
  const fiiller = argv.filter((a) => typeof a === 'string' && FIIL_DESENI.test(a));
  const hedefHam = secenekDegeri(argv, HEDEF_ARGI);
  const ciktiHam = secenekDegeri(argv, CIKTI_ARGI);
  const eylemVar = eylemIstendiMi(argv);
  if (fiiller.length === 0) {
    if (eylemVar || (hedefHam === null && ciktiHam === null)) return null; // --eylem'in yan seçenekleri ya da hiç komut yok
    return { tur: 'gecersiz' }; // fiilsiz --hedef / --cikti: sessiz kalınmaz
  }
  if (eylemVar) return { tur: 'cakisma' };
  const adlar = new Set();
  for (const f of fiiller) {
    if (f.includes('=')) return { tur: 'gecersiz' };
    adlar.add(f.slice(2).toLowerCase());
  }
  const pencereAdlari = [...adlar].filter((a) => Object.hasOwn(PENCERE_FIILLERI, a));
  const durumAdlari = [...adlar].filter((a) => DURUM_FIILLERI.includes(a));
  if (pencereAdlari.length > 1 || (pencereAdlari.length > 0 && durumAdlari.length > 0)) return { tur: 'cakisma' };
  if (pencereAdlari.length === 1) {
    if (ciktiHam !== null) return { tur: 'gecersiz' };
    const hedef = hedefHam === null ? 'ana' : hedefHam.toLowerCase();
    if (!PENCERE_HEDEFLERI.includes(hedef)) return { tur: 'gecersiz' };
    return { tur: 'pencere', islem: PENCERE_FIILLERI[pencereAdlari[0]], hedef };
  }
  if (hedefHam !== null) return { tur: 'gecersiz' };
  const cikti = ciktiHam === null || ciktiHam === '' ? null : ciktiHam.length > EN_COK_CIKTI_YOLU ? ciktiHam.slice(0, EN_COK_CIKTI_YOLU + 1) : ciktiHam;
  return { tur: 'durum', liste: durumAdlari.includes('liste'), cikti, dizin: typeof dizin === 'string' && dizin ? dizin : null };
}

// --- dış tetikler (1.4.0, dis grubu: o-21 Jump List ve masaüstü kısayolu, o-54 evpaneli:// bağlantısı) -------------------------

const KAYNAK_DESENI = /^--kaynak(=|$)/i;
/** `--kaynak=` değeri -> eylem-sinifi.js DIS_KAYNAKLAR adı. Başka değer kabul edilmez. */
const KOMUT_SATIRI_KAYNAKLARI = Object.freeze({ jumplist: 'jumplist', kisayol: 'kisayol-dosyasi' });
const PROTOKOL = 'evpaneli';
const PROTOKOL_ONEKI = `${PROTOKOL}:`;
const PROTOKOL_SINIRI = 400; // bağlantının tamamı (kodlanmış) en çok bu kadar karakter
const PROTOKOL_ANAHTARLARI = Object.freeze(['ad', 'parlaklik', 'islem', 'adim']);
const PROTOKOL_ISLEMLERI = Object.freeze(['ac', 'kapat', 'degistir']);
/** Komut satırına (Jump List, .lnk) yazılan adda bulunamayacak karakterler: tırnak, ters bölü, kabuk ve ortam değişkeni işaretleri. */
const ARGUMAN_YASAK_DESENI = /["\\%^&|<>!`\u0000-\u001F\u007F-\u009F]/;
/** HA varlık kimliği biçimi (`light.salon`): dış tetikler favori ADI taşır, kimlik kabul edilmez (o-54). */
const KIMLIK_BICIMI = /^[a-z_]+\.[a-z0-9_]+$/i;

/** Metin bir varlık kimliği biçiminde mi? Dış tetiklerde (bağlantı, Jump List, kısayol, yerel API) böyle ad reddedilir. */
function kimlikBicimindeMi(ad) {
  return typeof ad === 'string' && KIMLIK_BICIMI.test(ad.trim());
}

/**
 * argv içindeki `--kaynak` değeri: yoksa null; `jumplist` -> 'jumplist', `kisayol` -> 'kisayol-dosyasi'; birden çok, değersiz ya da
 * bilinmeyen değer -> 'gecersiz' (çağıran eylemi ÇALIŞTIRMAZ; komut satırı kaynağına düşülmez).
 * @param {unknown} argv
 * @returns {'jumplist'|'kisayol-dosyasi'|'gecersiz'|null}
 */
function eylemKaynagi(argv) {
  if (!Array.isArray(argv)) return null;
  const ham = argv.filter((a) => typeof a === 'string' && KAYNAK_DESENI.test(a));
  if (ham.length === 0) return null;
  if (ham.length > 1 || !ham[0].includes('=')) return 'gecersiz';
  let deger = ham[0].slice(ham[0].indexOf('=') + 1).trim();
  if (deger.length >= 2 && /^(["']).*\1$/.test(deger)) deger = deger.slice(1, -1).trim();
  deger = deger.toLowerCase();
  return Object.hasOwn(KOMUT_SATIRI_KAYNAKLARI, deger) ? KOMUT_SATIRI_KAYNAKLARI[deger] : 'gecersiz';
}

/**
 * Ad komut satırına (`--eylem="<ad>"`) güvenle yazılabilir mi? Tırnak, ters bölü, %, ^, &, |, <, >, !, ters tırnak ve denetim karakteri
 * içermez; `-` ile başlamaz (seçenek sanılmasın); boş değildir ve EN_COK_AD karakteri aşmaz.
 * @param {unknown} ad
 */
function argumanAdiGuvenliMi(ad) {
  if (typeof ad !== 'string') return false;
  const kirpik = ad.trim();
  if (kirpik === '' || kirpik !== ad || ad.length > EN_COK_AD) return false;
  if (ARGUMAN_YASAK_DESENI.test(ad) || ad.startsWith('-') || kimlikBicimindeMi(ad)) return false;
  return anahtarKatla(ad) !== '';
}

/**
 * Karoyu komut satırında TEK BAŞINA geri bulduran ad: önce etiket, sonra HA'daki ad denenir. Aday güvenli bir argüman olmalı ve
 * eylemAdiniCoz ile aynı karoya, değiştiricisiz (parlaklık, yön, servis yok) çözülmelidir; yoksa null (karo Jump List'e, kısayola
 * ya da bağlantıya konmaz). Varlık kimliği aday DEĞİLDİR: dış bağlantılar favori adı taşır.
 * @param {{id: string, etiket?: string, ad?: string}} karo
 * @param {object[]} karolar güvenli favori karoları
 * @returns {string|null}
 */
function komutSatiriAdi(karo, karolar) {
  if (!karo || typeof karo.id !== 'string') return null;
  for (const aday of [karo.etiket, karo.ad]) {
    if (!argumanAdiGuvenliMi(aday)) continue;
    const cozum = eylemAdiniCoz(aday, karolar);
    if (cozum.id === karo.id && Object.keys(cozum).length === 1) return aday;
  }
  return null;
}

/**
 * Jump List görevi ve masaüstü kısayolu için argüman dizgesi: `--eylem="<ad>" --kaynak=jumplist|kisayol`. Ad güvenli değilse null.
 * @param {string} ad komutSatiriAdi sonucu
 * @param {'jumplist'|'kisayol'} kaynak
 */
function eylemArgumanlari(ad, kaynak) {
  if (!argumanAdiGuvenliMi(ad) || !Object.hasOwn(KOMUT_SATIRI_KAYNAKLARI, kaynak)) return null;
  return `${EYLEM_ONEKI}"${ad}" --kaynak=${kaynak}`;
}

/** argv'deki evpaneli: bağlantısı: yoksa null, tek ise metni, birden çok ise { cakisma: true }. */
function protokolArgumani(argv) {
  if (!Array.isArray(argv)) return null;
  const bulunan = argv.filter((a) => typeof a === 'string' && a.slice(0, PROTOKOL_ONEKI.length).toLowerCase() === PROTOKOL_ONEKI);
  if (bulunan.length === 0) return null;
  if (bulunan.length > 1) return { cakisma: true };
  return bulunan[0];
}

/**
 * `evpaneli://eylem?ad=<favori adı>[&parlaklik=0-100 | &islem=ac|kapat|degistir | &adim=±1-100]` bağlantısını çözer. Saf; hiçbir şey
 * çalıştırmaz. Sıkı: başka ana bilgisayar/yol, kullanıcı adı, port, # parçası, bilinmeyen ya da yinelenen anahtar, birden çok
 * değiştirici, denetim karakteri, PROTOKOL_SINIRI'nı aşan bağlantı ve EN_COK_AD'ı aşan ad reddedilir.
 * @param {unknown} metin
 * @returns {{ad: string, islem?: 'ac'|'kapat'|'degistir', parlaklik?: number, adim?: number}|{hata: 'gecersiz'}}
 */
function protokolBaglantisiCoz(metin) {
  const gecersiz = { hata: 'gecersiz' };
  if (typeof metin !== 'string' || metin.length > PROTOKOL_SINIRI || /[\u0000-\u0020\u007F-\u009F]/.test(metin)) return gecersiz;
  let url;
  try {
    url = new URL(metin);
  } catch {
    return gecersiz;
  }
  if (url.protocol !== PROTOKOL_ONEKI || url.username !== '' || url.password !== '' || url.port !== '' || url.hash !== '') return gecersiz;
  if (url.hostname.toLowerCase() !== 'eylem' || (url.pathname !== '' && url.pathname !== '/')) return gecersiz;
  const anahtarlar = [...url.searchParams.keys()];
  if (anahtarlar.some((k) => !PROTOKOL_ANAHTARLARI.includes(k)) || new Set(anahtarlar).size !== anahtarlar.length) return gecersiz;
  const ad = (url.searchParams.get('ad') ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (ad === '' || ad.length > EN_COK_AD || anahtarKatla(ad) === '' || kimlikBicimindeMi(ad)) return gecersiz;
  const degistiriciler = anahtarlar.filter((k) => k !== 'ad');
  if (degistiriciler.length > 1) return gecersiz;
  const sonuc = { ad };
  if (degistiriciler.length === 0) return sonuc;
  const deger = url.searchParams.get(degistiriciler[0]);
  if (degistiriciler[0] === 'islem') {
    if (!PROTOKOL_ISLEMLERI.includes(deger)) return gecersiz;
    sonuc.islem = deger;
  } else if (degistiriciler[0] === 'parlaklik') {
    if (!/^\d{1,3}$/.test(deger) || Number(deger) > 100) return gecersiz;
    sonuc.parlaklik = Number(deger);
  } else {
    // "+" sorgu dizgesinde boşluğa çözülür: "adim=+10" ile "adim=%2B10" aynıdır.
    const m = /^([ +-]?)(\d{1,3})$/.exec(deger);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 100) return gecersiz;
    sonuc.adim = m[1] === '-' ? -Number(m[2]) : Number(m[2]);
  }
  return sonuc;
}

/**
 * Favori adı için bağlantı (Ayarlar'daki "Bağlantıyı kopyala"). Ad güvenli bir argüman değilse null.
 * @param {string} ad
 */
function protokolBaglantisi(ad) {
  if (!argumanAdiGuvenliMi(ad)) return null;
  return `${PROTOKOL}://eylem?ad=${encodeURIComponent(ad)}`;
}

/**
 * Açılış ya da ikinci kopyadan gelen DIŞ tetik isteği (1.4.0 dis grubu). `ek` ikinci kopyanın requestSingleInstanceLock ile gönderdiği
 * ek veridir ({ eylem?, kaynak?, protokol? }); verilmişse argv'nin yerine geçer.
 *  - evpaneli:// bağlantısı TEK BAŞINA gelmelidir: yanında `--eylem`, `--kaynak` ya da pencere/durum komutu varsa (ör. tırnak kaçırarak
 *    eklenmiş argüman) { tur: 'cakisma' } döner ve HİÇBİRİ çalışmaz. Birden çok bağlantı da çakışmadır.
 *  - `--kaynak=jumplist|kisayol` (Jump List görevi, masaüstü kısayolu): { tur: 'kaynak', kaynak } ('gecersiz' olabilir); eylem adı
 *    yine komutSatiriEylemi ile okunur.
 *  - Hiçbiri yoksa null (olağan komut satırı akışı).
 * @param {unknown} argv
 * @param {unknown} [ek]
 * @returns {{tur: 'protokol', metin: string}|{tur: 'cakisma'}|{tur: 'kaynak', kaynak: string}|null}
 */
function disIstegi(argv, ek = null) {
  const ekNesne = ek && typeof ek === 'object' ? ek : {};
  const protokol = ekNesne.protokol !== undefined ? ekNesne.protokol : protokolArgumani(argv);
  const kaynak = ekNesne.kaynak !== undefined ? ekNesne.kaynak : eylemKaynagi(argv);
  if (protokol !== null && protokol !== undefined) {
    if (typeof protokol !== 'string') return { tur: 'cakisma' };
    const baska = (kaynak !== null && kaynak !== undefined) || eylemIstendiMi(argv) || ekNesne.eylem !== undefined || pencereDurumKomutu(argv, null) !== null;
    return baska ? { tur: 'cakisma' } : { tur: 'protokol', metin: protokol };
  }
  if (kaynak === null || kaynak === undefined) return null;
  return { tur: 'kaynak', kaynak: typeof kaynak === 'string' && (kaynak === 'jumplist' || kaynak === 'kisayol-dosyasi') ? kaynak : 'gecersiz' };
}

module.exports = {
  EYLEM_ARGI,
  EYLEM_ONEKI,
  EN_COK_AD,
  EN_AZ_ONEK_HARFI,
  PENCERE_HEDEFLERI,
  KOMUT_SATIRI_KAYNAKLARI,
  PROTOKOL,
  PROTOKOL_SINIRI,
  eylemIstendiMi,
  komutSatiriEylemi,
  eylemAdiniCoz,
  pencereDurumKomutu,
  eylemKaynagi,
  argumanAdiGuvenliMi,
  kimlikBicimindeMi,
  komutSatiriAdi,
  eylemArgumanlari,
  protokolArgumani,
  protokolBaglantisiCoz,
  protokolBaglantisi,
  disIstegi,
};
