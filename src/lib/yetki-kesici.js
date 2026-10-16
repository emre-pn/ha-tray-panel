'use strict';

/**
 * Yetki kesici (saf; Electron'a bağlı değildir — `fs` dışarıdan verilir) — 1.1.1.
 *
 * Neden var: Home Assistant'ın ip_ban özelliği 5 hatalı kimlikli denemede istemcinin IP'sini banlar. Geçersiz (silinmiş ya da
 * iptal edilmiş) bir anahtarla her açılışta onlarca istek atmak önce PC'yi, sonra dış adrese geçince evin internet IP'sini
 * banlattı. Bu modül üç karar verir; kimlikli (Authorization taşıyan) HER REST isteği ve WebSocket 'auth' adımı bunlardan geçer:
 *
 *  1. REDDEDİLDİ: HA bir anahtarı reddettiyse (REST 401 ya da WS 'auth_invalid') o anahtarın PARMAK İZİ (SHA-256'nın ilk 16
 *     onaltılık hanesi) kalıcı olarak kaydedilir. Kayıtlı parmak izine sahip anahtarla HİÇBİR adrese hiçbir kimlikli istek çıkmaz;
 *     uygulama yeniden başlasa da. Anahtarın kendisi ASLA saklanmaz, günlüğe yazılmaz. Yeni (FARKLI parmak izli) bir anahtar
 *     kaydedilince o anahtar doğal olarak serbesttir; aynı anahtarı yeniden kaydetmek engeli kaldırmaz; 'Anahtarı sil' kaydı temizler.
 *  2. DURAKLATILDI: kimlikli istekte 403 (HA ban'ı ya da Cloudflare engeli) anahtarı geçersiz saydırmaz, ama o ADRESE kimlikli
 *     istekler 15 dk durdurulur (bellekte; yeniden başlatma yeni bir deneme sayılır).
 *  3. DOĞRULANAMADI (tur 2 + tur 3 inceleme): kimlikli istek zaman aşımına uğrar, gönderildikten sonra bağlantı kopar ya da WebSocket'te
 *     auth gönderilip auth_ok/auth_invalid gelmeden soket kopar; HA isteği işlemiş (ve hatalıysa saymış) olabilir. Bu "belirsiz"
 *     denemeler parmak izi başına KALICI sayılır: hiç doğrulanmamış anahtarda İLK belirsizlikte, doğrulanmış (1.1.1'de başarılı
 *     yanıt almış) anahtarda 2.'sinde anahtar 'dogrulanamadi' durumunda durur: hiçbir adrese istek çıkmaz (yeniden başlatma
 *     dahil) ta ki kullanıcı "Yeniden Dene" diyene (TEK yeni hak) ya da yeni anahtar kaydedene kadar. Başarılı bir kimlikli
 *     yanıt sayacı sıfırlar; doğrulama yanıtı (GET /api/ + "API running.") ya da WS auth_ok parmak izini "doğrulanmış" işaretler.
 *  4. HATA BÜTÇESİ (tur 3, K4; tur 5, K8): anahtardan BAĞIMSIZ, kalıcı "hatalı deneme sayacı" (401 / auth_invalid; son başarılı WS
 *     girişinden beri), KÖKEN BAŞINA (ev içi / dış): HA sayacı uzak IP başına tutar; ev içi bağlantıda bu bilgisayarın LAN IP'si, dış
 *     adreste (Cloudflare, X-Forwarded-For) evin internet IP'si sayılır. Sayaç >= 2 iken YENİ bir anahtarın doğrulanması ancak
 *     kullanıcı Ayarlar'da açık ikinci onay verirse yapılır (HA 5 hatalı denemede IP'yi banlar); daha önce doğrulanmış olması yalnız
 *     hiçbir anahtarı DURDURMAZ, yalnız onay sorusudur (aday kaydı, Yeniden Dene; K15: otomatik yollarda 'sayaç >= 4 ise durdur' kuralı yoktur, doğrulanmış
 *     anahtar zaten K2 ile en çok 2 ardışık belirsizden sonra durur); doğrulanmış olmak onay isteğinden muaf tutmaz (K12a). Sıfırlanma koşulu muhafazakârdır: HA kaynağında (components/http/ban.py +
 *     websocket_api/auth.py) hatalı sayaç yalnız IP başına BELLEKTE tutulur ve yalnız o IP'den başarılı bir WebSocket girişinde
 *     (process_success_login, auth_ok) silinir; bu yüzden girisBasarili(koken) YALNIZ başarının geldiği kökenin sayacını sıfırlar
 *     (REST başarısı hiçbirini). Kökeni bilinmeyen ret iki kökene de yazılır; eski tek sayaçlı kayıt iki kökene de taşınır.
 *     K14 (tur 9): HA geçerli bir anahtarın isteğini ASLA hatalı giriş saymaz; bu yüzden BELİRSİZ denemeler (madde 7) kesin sayaca değil
 *     parmak izi + köken başına 'ASKIDA' sayacına yazılır ve köken bütçesine askıda olarak eklenir (bütçe = kesin + tüm anahtarların askıdakileri).
 *     O anahtar herhangi bir kökenden BAŞARILI kimlikli yanıt alınca (HA içeriği doğrulanmış REST 2xx, doğrulama, WS auth_ok) o anahtarın TÜM
 *     askıdakileri tüm kökenlerin bütçesinden düşer (anahtar geçerli: HA bunları saymamıştır). 401/auth_invalid alırsa askıdakiler kesinleşir.
 *     Kalıcı kayıtta askıdakiler parmak izi + köken ile tutulur; eski biçimli kayıt (yalnız hataliKoken) muhafazakâr KESİN sayılır.
 *  5. KAYIT GÜVENİLMEZ (tur 3, K5): kesici dosyası VAR ama okunamıyor ya da bozuksa (yalnız "yok" değil) ya da kayıt hiçbir yere
 *     yazılamıyorsa, saklı anahtar daha önce doğrulanmış olsa bile ilk kimlikli istek kullanıcının "Yeniden Dene" onayına bağlanır.
 *
 *  6. YOLDA İŞARETİ (tur 6): doğrulama isteği ve doğrulanmamış/taze olmayan her kimlikli istek (REST) ile WS auth iletisi ağa çıkmadan
 *     ÖNCE o parmak izi için kalıcı "yolda" işareti yazılır; kesin sonuçta (yanıt başlığı, 401, gönderim öncesi ağ hatası) silinir,
 *     zaman aşımı/kopmada belirsiz sayaca çevrilir. Süreç yanıt gelmeden ölürse (kapanış, çökme, güncelleme, kapanan PC) işaret
 *     diskte kalır: açılışta `yukle()` onu BELİRSİZ deneme sayar (hiç doğrulanmamış anahtar 'dogrulanamadi' olur ve Yeniden Dene bekler),
 *     böylece her açılış aynı geçersiz anahtarla yeni bir deneme göndermez. İşaret yazılamıyorsa istek gönderilmez ('kayit-yazilamadi').
 *  7. BELİRSİZ DENEME BÜTÇEYE GİRER (tur 7, K11): belirsiz sonuçlanan her kimlikli deneme (zaman aşımı, gönderim sonrası kopma, 502/504/52x,
 *     WS auth sonrası yanıtsız kopma, açılışta bulunan artakalan "yolda" işareti) HA tarafında sayılmış olabilir: isteğin gittiği kökenin
 *     hata bütçesine ASKIDA olarak (K14) eklenir; köken bilinmiyorsa (eski biçimli işaret dahil) ikisine birden. Böylece art arda
 *     yavaş-yanıt denemeleri de K4 ikinci onayını tetikler. Kesin sayaçlar yalnız o kökenden WS auth_ok ile sıfırlanır (K8, değişmez).
 *
 * Dosya: <userData>\yetki-kesici.json (+ yedek dosyalar), atomik yazma (geçici dosya + yeniden adlandırma). İçinde yalnız
 * 16 haneli parmak izleri, zaman damgası, neden kodu ve sayaçlar vardır; sır içermez.
 *
 * Kalıcılık (tur 1 inceleme): kayıt BİRDEN ÇOK dosyaya yazılır; açılışta hepsi birleştirilir. Okunamayan (kilitli) dosyanın üzerine
 * ASLA yazılmaz (eski parmak izleri kaybolmasın); bozuk JSON ".bozuk" adıyla kenara alınır. Hiçbir yere yazılamazsa ya da bir dosya
 * okunamazsa `kayitSorunu` geri çağrısı oturum başına tür başına BİR kez çalışır. Reddedilen/doğrulanamayan anahtarın kaydı hiçbir
 * yere yazılamadıysa (`kalici=false`) ana süreç saklı anahtar dosyasını kenara alır: yeniden başlatmada anahtar yoksa istek de yoktur.
 */

const crypto = require('node:crypto');

const SURUM = 1;
const DURAKLATMA_MS = 15 * 60 * 1000;
const EN_COK_KAYIT = 200; // kayıt başına yaklaşık 60 bayt; ekleme sırasıyla tutulur (saat geri alınsa da yeni kayıt atılmaz)
const EN_COK_BELIRSIZ = 1; // hiç doğrulanmamış anahtarda İLK belirsiz sonuçtan sonra durur (kullanıcı "Yeniden Dene" diyene kadar istek yok)
const EN_COK_BELIRSIZ_IYI = 2; // 1.1.1'de başarılı yanıt almış anahtarda (geçici ağ sorunu olasılığı daha yüksek)
const HATA_BUTCESI_ESIGI = 2; // bu kadar hatalı denemeden sonra YENİ anahtar doğrulaması açık ikinci onay ister (HA eşiği 5)
const EN_COK_HATALI_SAYAC = 1000;
const EN_COK_ASKIDA_KAYIT = 64; // askıda tutulan parmak izi sayısı; taşarsa en eskisi KESİNLEŞİR (bütçede kalır)
const EN_COK_ASKIDA_SAYI = 100;
const EN_COK_IYI = 8;
const PARMAK_IZI_DESENI = /^[0-9a-f]{16}$/;
const NEDENLER = new Set(['HTTP_401', 'WS_AUTH_INVALID']);
const KOKENLER = ['yerel', 'dis'];

/** Hata sayacının köken listesi: bilinen köken tek başına, bilinmiyorsa (muhafazakâr) ikisi birden. */
const kokenListesi = (koken) => (KOKENLER.includes(koken) ? [koken] : KOKENLER);

/** Anahtarın SHA-256 özetinin ilk 16 onaltılık hanesi. Anahtarı geri vermez; yalnız eşleştirme içindir. */
function anahtarParmakIzi(anahtar) {
  return crypto.createHash('sha256').update(String(anahtar), 'utf8').digest('hex').slice(0, 16);
}

function kokenAl(taban) {
  try {
    return new URL(taban).origin;
  } catch {
    return String(taban ?? '');
  }
}

/** Dosya içeriğini temizler: bozuk, yinelenen ya da biçimi tutmayan kayıtlar atılır. Ekleme sırası korunur, en yeni EN_COK_KAYIT kalır. */
function kayitlariDuzelt(ham) {
  const liste = Array.isArray(ham?.reddedilenler) ? ham.reddedilenler : [];
  const gorulen = new Set();
  const sonuc = [];
  for (const oge of liste) {
    const parmakIzi = oge?.parmakIzi;
    if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi) || gorulen.has(parmakIzi)) continue;
    gorulen.add(parmakIzi);
    sonuc.push({
      parmakIzi,
      zaman: Number.isFinite(oge.zaman) ? oge.zaman : 0,
      neden: NEDENLER.has(oge.neden) ? oge.neden : 'HTTP_401',
    });
  }
  return sonuc.slice(-EN_COK_KAYIT);
}

/** Belirsiz deneme sayaçları: [{parmakIzi, sayi}] -> Map (bozuk kayıtlar atılır). */
function belirsizleriDuzelt(ham) {
  const liste = Array.isArray(ham?.belirsiz) ? ham.belirsiz : [];
  const sonuc = new Map();
  for (const oge of liste) {
    const parmakIzi = oge?.parmakIzi;
    if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi) || !Number.isInteger(oge.sayi) || oge.sayi < 1 || oge.sayi > 100) continue;
    sonuc.set(parmakIzi, Math.max(sonuc.get(parmakIzi) ?? 0, oge.sayi));
  }
  return sonuc;
}

/** Askıdaki belirsiz denemeler (K14): [{parmakIzi, yerel, dis}] -> Map(parmakIzi -> {yerel, dis}); bozuk kayıtlar atılır, aynı parmak izi için en yüksek değer kalır. */
function askidaDuzelt(ham) {
  const liste = Array.isArray(ham?.askida) ? ham.askida : [];
  const sayi = (n) => (Number.isInteger(n) && n > 0 ? Math.min(n, EN_COK_ASKIDA_SAYI) : 0);
  const sonuc = new Map();
  for (const oge of liste) {
    const parmakIzi = oge?.parmakIzi;
    if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi)) continue;
    const onceki = sonuc.get(parmakIzi) ?? { yerel: 0, dis: 0 };
    const yeni = { yerel: Math.max(onceki.yerel, sayi(oge.yerel)), dis: Math.max(onceki.dis, sayi(oge.dis)) };
    if (yeni.yerel > 0 || yeni.dis > 0) sonuc.set(parmakIzi, yeni);
  }
  return new Map([...sonuc].slice(-EN_COK_ASKIDA_KAYIT));
}

/** Kalıcı hatalı deneme sayaçları ({yerel, dis}; anahtardan bağımsız); bozuk değer 0 sayılır. */
function hataliDuzelt(ham) {
  const sayi = (n) => (Number.isInteger(n) && n > 0 ? Math.min(n, EN_COK_HATALI_SAYAC) : 0);
  const koken = ham?.hataliKoken;
  if (koken && typeof koken === 'object' && !Array.isArray(koken)) return { yerel: sayi(koken.yerel), dis: sayi(koken.dis) };
  const eski = sayi(ham?.hataliDeneme); // tek sayaçlı eski kayıt: muhafazakâr göç (değer her iki kökene de yazılır)
  return { yerel: eski, dis: eski };
}

/**
 * Önceki oturumdan artakalan "yolda" işaretleri: [[parmakIzi, koken]] (16 hane; bozuk girdiler atılır). Köken `yoldaKoken` alanından
 * okunur; yoksa (eski biçimli işaret) ya da geçersizse undefined = bilinmiyor (iki kökene birden sayılır).
 */
function yoldaDuzelt(ham) {
  const liste = Array.isArray(ham?.yolda) ? ham.yolda : [];
  const kokenler = ham?.yoldaKoken && typeof ham.yoldaKoken === 'object' && !Array.isArray(ham.yoldaKoken) ? ham.yoldaKoken : {};
  const sonuc = [];
  for (const p of liste) {
    if (typeof p !== 'string' || !PARMAK_IZI_DESENI.test(p) || sonuc.some((s) => s[0] === p)) continue;
    const k = Object.hasOwn(kokenler, p) && KOKENLER.includes(kokenler[p]) ? kokenler[p] : undefined;
    sonuc.push([p, k]);
  }
  return sonuc.slice(-EN_COK_IYI);
}

/** Aynı parmak izi için iki köken bilgisi: aynıysa o, farklıysa (ya da biri bilinmiyorsa) bilinmiyor (undefined = ikisi birden). */
const kokenBirlestir = (a, b) => (a === b ? a : undefined);

/** Daha önce başarıyla doğrulanmış parmak izleri (16 hane); bozuk girdiler atılır. */
function iyileriDuzelt(ham) {
  const liste = Array.isArray(ham?.dogrulananlar) ? ham.dogrulananlar : [];
  const sonuc = [];
  for (const p of liste) if (typeof p === 'string' && PARMAK_IZI_DESENI.test(p) && !sonuc.includes(p)) sonuc.push(p);
  return sonuc.slice(-EN_COK_IYI);
}

/**
 * @param {object} bag
 * @param {string|null} [bag.dosyaYolu] null: yalnız bellekte (kalıcı değil)
 * @param {string[]} [bag.yedekYollar] aynı kaydın ikinci (ve sonraki) kalıcı yerleri (dosyaYolu verilmişse); FARKLI bir sürücü/klasör olabilir
 * @param {{existsSync, readFileSync, writeFileSync, renameSync, mkdirSync}} [bag.fs]
 * @param {(m: string) => void} [bag.gunluk] yalnız sabit metin, neden kodu ve parmak izinin ilk 8 hanesi
 * @param {() => number} [bag.simdi]
 * @param {(parmakIzi: string, neden: string, kalici: boolean) => void} [bag.reddedildi] YENİ bir parmak izi reddedildiğinde BİR kez (bildirim için); kalici: kayıt diske yazılabildi mi
 * @param {(parmakIzi: string, kalici: boolean) => void} [bag.dogrulanamadi] belirsiz deneme sınırı aşıldığında parmak izi başına BİR kez
 * @param {() => void} [bag.degisti] kayıt değişti (tepsi/panel/ayarlar durumu tazelensin)
 * @param {(tur: 'yazilamadi'|'okunamadi') => void} [bag.kayitSorunu] kalıcı kayıt sorunu (tür başına oturumda BİR kez)
 */
function yetkiKesiciOlustur({
  dosyaYolu = null,
  yedekYollar = [],
  fs = null,
  gunluk = () => {},
  simdi = () => Date.now(),
  reddedildi = () => {},
  dogrulanamadi: dogrulanamadiGeriCagri = () => {},
  degisti = () => {},
  kayitSorunu: sorunGeriCagri = () => {},
} = {}) {
  let kayitlar = []; // reddedilen parmak izleri, en yeni sonda (ekleme sırası)
  let belirsizler = new Map(); // parmakIzi -> kalıcı belirsiz deneme sayısı
  let iyiler = []; // daha önce başarıyla doğrulanmış parmak izleri
  const yolda = new Map(); // parmakIzi -> köken ('yerel'|'dis'|undefined): şu an ağda yanıt bekleyen kimlikli istek/auth (kalıcı işaret; tur 6, köken tur 7)
  const hatali = { yerel: 0, dis: 0 }; // anahtardan bağımsız kalıcı KESİN sayaçlar KÖKEN başına: son başarılı WS girişinden beri HA'nın reddettiği (401 / auth_invalid) deneme sayısı
  let askidalar = new Map(); // K14: parmakIzi -> {yerel, dis}: belirsiz denemeler (HA saymış olabilir; anahtar başarı alırsa düşer, 401 alırsa kesinleşir)
  const kokenButcesi = (k) => hatali[k] + [...askidalar.values()].reduce((toplam, a) => toplam + a[k], 0);
  const hataliSayisi = (koken) => (KOKENLER.includes(koken) ? kokenButcesi(koken) : Math.max(...KOKENLER.map(kokenButcesi))); // köken bilinmiyorsa en yüksek
  const biletler = new Map(); // parmakIzi -> açık bilet sayısı (tur 4, K5): kullanıcı onayı yalnız O parmak izinin tek doğrulamasına geçerli
  let onay = null; // 'kayit-okunamadi' | 'kayit-yazilamadi' | null: kayıt güvenilmez; kullanıcı "Yeniden Dene" diyene kadar kimlikli istek yok
  const korunanlar = new Set(); // saklı (kullanılan) anahtarın parmak izi: sınır aşılsa da listeden düşmez
  const dogrulanamadiBildirilenler = new Set();
  const duraklatmalar = new Map(); // köken -> bitiş zamanı (bellekte)
  const yedekler = Array.isArray(yedekYollar) ? yedekYollar.filter((y, i, d) => typeof y === 'string' && y && y !== dosyaYolu && d.indexOf(y) === i) : [];
  const yollar = dosyaYolu ? [dosyaYolu, ...yedekler] : [];
  const okunamayanlar = new Set(); // okunamayan (kilitli vb.) kayıt dosyaları: üzerlerine YAZILMAZ
  const bildirilenler = new Set(); // kayitSorunu geri çağrısı tür başına bir kez
  let sorun = null; // 'yazilamadi' | 'okunamadi' | null

  function bildirDegisti() {
    try {
      degisti();
    } catch {
      /* dinleyici hatası kesiciyi etkilemesin */
    }
  }

  function reddedildiMiIc(parmakIzi) {
    return typeof parmakIzi === 'string' && kayitlar.some((k) => k.parmakIzi === parmakIzi);
  }

  /** Bir denemenin HA tarafında sayılmış olabileceği kökenlerin hata bütçesi artar (köken bilinmiyorsa ikisi de). */
  function hataliArtir(koken) {
    for (const k of kokenListesi(koken)) hatali[k] = Math.min(hatali[k] + 1, EN_COK_HATALI_SAYAC);
  }

  /** Belirsiz deneme: isteğin gittiği kökenin (bilinmiyorsa ikisinin) ASKIDA sayacı artar (K14). */
  function askidaArtir(parmakIzi, koken) {
    const a = askidalar.get(parmakIzi) ?? { yerel: 0, dis: 0 };
    for (const k of kokenListesi(koken)) a[k] = Math.min(a[k] + 1, EN_COK_ASKIDA_SAYI);
    askidalar.delete(parmakIzi);
    askidalar.set(parmakIzi, a); // en yeni sonda
    while (askidalar.size > EN_COK_ASKIDA_KAYIT) askidaKesinlestir(askidalar.keys().next().value); // taşan en eski: kesinleşir (bütçede kalır)
  }

  /** Anahtar 401 aldı / kaydı silindi: askıdakiler KESİN sayaca geçer (bütçede kalır). @returns {boolean} askıda kayıt vardı mı */
  function askidaKesinlestir(parmakIzi) {
    const a = askidalar.get(parmakIzi);
    if (!a) return false;
    for (const k of KOKENLER) hatali[k] = Math.min(hatali[k] + a[k], EN_COK_HATALI_SAYAC);
    askidalar.delete(parmakIzi);
    return true;
  }

  function belirsizSiniri(parmakIzi) {
    return iyiler.includes(parmakIzi) ? EN_COK_BELIRSIZ_IYI : EN_COK_BELIRSIZ;
  }

  /**
   * Belirsiz deneme sınırı aşıldı mı (kalıcı sayaç) ya da kayıt güvenilmez mi (onay bekliyor)? Kimlikli istek ancak kullanıcı
   * "Yeniden Dene" derse çıkar.
   */
  function dogrulanamadiMiIc(parmakIzi) {
    if (onay && !(typeof parmakIzi === 'string' && biletler.has(parmakIzi))) return true;
    return typeof parmakIzi === 'string' && (belirsizler.get(parmakIzi) ?? 0) >= belirsizSiniri(parmakIzi); // K15/K16: hata bütçesi burada KARAR vermez (yalnız onay sorusudur)
  }

  /** Sınır aşılırsa EN ESKİ korunmayan kayıtlar düşer (saklı anahtarın kaydı asla; zamana değil ekleme sırasına göre). */
  function kirp() {
    while (kayitlar.length > EN_COK_KAYIT) {
      const sira = kayitlar.findIndex((k) => !korunanlar.has(k.parmakIzi));
      if (sira < 0) break;
      kayitlar.splice(sira, 1);
    }
  }

  /** Bellekteki kayıtlara yenilerini ekler (aynı parmak izi bir kez); ekleme sırası korunur. */
  function birlestir(liste) {
    const mevcut = new Set(kayitlar.map((k) => k.parmakIzi));
    const eklenecek = liste.filter((k) => !mevcut.has(k.parmakIzi));
    if (eklenecek.length === 0) return;
    kayitlar = [...kayitlar, ...eklenecek];
    kirp();
  }

  /** Diğer dosyadan gelen sayaçlar ve doğrulanmış işaretler birleştirilir (en yüksek sayaç kazanır). */
  function sayaclariBirlestir(sonuc) {
    hatali.yerel = Math.max(hatali.yerel, sonuc.hatali?.yerel ?? 0);
    hatali.dis = Math.max(hatali.dis, sonuc.hatali?.dis ?? 0);
    for (const [p, sayi] of sonuc.belirsiz ?? []) belirsizler.set(p, Math.max(belirsizler.get(p) ?? 0, sayi));
    for (const [p, a] of sonuc.askida ?? []) {
      const onceki = askidalar.get(p) ?? { yerel: 0, dis: 0 };
      askidalar.set(p, { yerel: Math.max(onceki.yerel, a.yerel), dis: Math.max(onceki.dis, a.dis) });
    }
    for (const p of sonuc.iyi ?? []) if (!iyiler.includes(p)) iyiler = [...iyiler, p].slice(-EN_COK_IYI);
  }

  /** Yazma sırasında yeniden okunabilen (önceden kilitli) dosyadan gelen artakalan işaretler: bellekte belirsiz deneme sayılır (geri çağrı yok); kökeninin bütçesi de artar. */
  function artakalanlariSay(liste) {
    for (const [p, koken] of liste ?? []) {
      if (reddedildiMiIc(p)) continue;
      belirsizler.set(p, Math.min((belirsizler.get(p) ?? 0) + 1, 100));
      askidaArtir(p, koken);
    }
  }

  /** @returns {{durum: 'yok'|'ok'|'bozuk'|'okunamadi', kayitlar?: object[], belirsiz?: Map, askida?: Map, iyi?: string[]}} */
  function dosyayiOku(yol) {
    try {
      if (!fs.existsSync(yol)) return { durum: 'yok' };
      const ham = String(fs.readFileSync(yol, 'utf8')).replace(/^\uFEFF/, '');
      try {
        const veri = JSON.parse(ham);
        return { durum: 'ok', kayitlar: kayitlariDuzelt(veri), belirsiz: belirsizleriDuzelt(veri), iyi: iyileriDuzelt(veri), hatali: hataliDuzelt(veri), askida: askidaDuzelt(veri), yolda: yoldaDuzelt(veri) };
      } catch {
        return { durum: 'bozuk' };
      }
    } catch {
      return { durum: 'okunamadi' };
    }
  }

  /** Bozuk (JSON değil) dosyayı ".bozuk" adıyla kenara alır; yapılamazsa okunamayan sayılır. */
  function bozuguKenaraAl(yol) {
    try {
      fs.renameSync(yol, `${yol}.bozuk`);
      gunluk('Yetki kesici kaydı okunamadı (bozuk); ".bozuk" adıyla kenara alındı, bu dosya boş sayıldı.');
      return true;
    } catch {
      return false;
    }
  }

  function sorunuAyarla(yeni) {
    if (sorun === yeni) return;
    sorun = yeni;
    if (yeni && !bildirilenler.has(yeni)) {
      bildirilenler.add(yeni);
      gunluk(yeni === 'yazilamadi' ? 'Yetki kesici kaydı hiçbir yere yazılamadı; bu oturumda bellekte tutuluyor.' : 'Yetki kesici kaydı okunamadı; üzerine yazılmayacak.');
      try {
        sorunGeriCagri(yeni);
      } catch {
        /* bildirim hatası kesiciyi etkilemesin */
      }
    }
    bildirDegisti();
  }

  function tekDosyayaYaz(yol) {
    const gecici = `${yol}.tmp`;
    try {
      const klasor = String(yol).replace(/[\\/][^\\/]*$/, '');
      if (klasor && klasor !== yol) fs.mkdirSync(klasor, { recursive: true });
      const icerik = {
        surum: SURUM,
        reddedilenler: kayitlar,
        belirsiz: [...belirsizler].map(([parmakIzi, sayi]) => ({ parmakIzi, sayi })),
        dogrulananlar: iyiler,
        hataliKoken: { yerel: hatali.yerel, dis: hatali.dis },
        askida: [...askidalar].map(([parmakIzi, a]) => ({ parmakIzi, yerel: a.yerel, dis: a.dis })),
        yolda: [...yolda.keys()],
        yoldaKoken: Object.fromEntries([...yolda].filter(([, k]) => k !== undefined)),
      };
      fs.writeFileSync(gecici, `${JSON.stringify(icerik, null, 1)}\n`, 'utf8');
      fs.renameSync(gecici, yol);
      return true;
    } catch {
      return false;
    }
  }

  /** Kayıt konumlarından en az birine yazılabiliyor mu? Gerçek kayıt dosyası OLUŞTURULMAZ (yalnız geçici bir deneme dosyası yazılıp silinir). */
  function yazilabilirMi() {
    for (const yol of yollar) {
      const deneme = `${yol}.deneme`;
      try {
        const klasor = String(yol).replace(/[\\/][^\\/]*$/, '');
        if (klasor && klasor !== yol) fs.mkdirSync(klasor, { recursive: true });
        fs.writeFileSync(deneme, '{}\n', 'utf8');
        try {
          fs.unlinkSync?.(deneme);
        } catch {
          /* silinemese de yazılabiliyor */
        }
        return true;
      } catch {
        /* sıradaki konum */
      }
    }
    return false;
  }

  function yaz() {
    if (yollar.length === 0 || !fs) return true;
    // Okunamayan dosya geçici olarak kilitliydiyse (antivirüs, OneDrive) eski parmak izleri kaybolmasın: yazmadan önce yeniden dene.
    for (const yol of [...okunamayanlar]) {
      const sonuc = dosyayiOku(yol);
      if (sonuc.durum === 'ok') {
        birlestir(sonuc.kayitlar);
        sayaclariBirlestir(sonuc);
        artakalanlariSay(sonuc.yolda);
      }
      if (sonuc.durum === 'ok' || sonuc.durum === 'yok') okunamayanlar.delete(yol);
    }
    let basarili = 0;
    let basarisiz = 0;
    for (const yol of yollar) {
      if (okunamayanlar.has(yol)) continue; // okunamayan dosyanın üzerine yazılmaz
      if (tekDosyayaYaz(yol)) basarili += 1;
      else basarisiz += 1;
    }
    if (basarili === 0) {
      sorunuAyarla('yazilamadi');
      return false;
    }
    if (basarisiz > 0) gunluk('Yetki kesici kaydı bir dosyaya yazılamadı; diğerine yazıldı.');
    sorunuAyarla(okunamayanlar.size > 0 ? 'okunamadi' : null);
    return true;
  }

  function belirsizKaydetIc(parmakIzi, koken = undefined) {
    // Köken verilmediyse "yolda" işaretinde kayıtlı kökene bakılır (yoksa bilinmiyor: iki kökene birden).
    const kayitliKoken = typeof parmakIzi === 'string' ? yolda.get(parmakIzi) : undefined;
    if (typeof parmakIzi === 'string') yolda.delete(parmakIzi); // yanıt gelmedi: işaret belirsiz sayaca döner (tek yazımda)
    if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi) || reddedildiMiIc(parmakIzi)) return { sayi: 0, sinirAsildi: false };
    const sayi = (belirsizler.get(parmakIzi) ?? 0) + 1;
    belirsizler.set(parmakIzi, sayi);
    askidaArtir(parmakIzi, KOKENLER.includes(koken) ? koken : kayitliKoken); // K11/K14: HA bu denemeyi (isteğin gittiği kökende) saymış olabilir: ASKIDA
    const sinirAsildi = sayi >= belirsizSiniri(parmakIzi);
    const kalici = yaz();
    if (sinirAsildi && !dogrulanamadiBildirilenler.has(parmakIzi)) {
      dogrulanamadiBildirilenler.add(parmakIzi);
      gunluk(`Yetki kesici: anahtar doğrulanamadı (neden=BELIRSIZ_${sayi}, parmak izi=${parmakIzi.slice(0, 8)}); kullanıcı yeniden deneyene kadar kimlikli istekler durduruldu.`);
      try {
        dogrulanamadiGeriCagri(parmakIzi, kalici);
      } catch {
        /* bildirim hatası kesiciyi etkilemesin */
      }
    }
    bildirDegisti();
    return { sayi, sinirAsildi };
  }

  return {
    /** Diskteki kaydı okur (açılışta, ilk istekten ÖNCE). Dosyalar birleştirilir; okunamayan dosyanın üzerine yazılmaz. @returns {number} reddedilmiş kayıt sayısı */
    yukle() {
      kayitlar = [];
      belirsizler = new Map();
      askidalar = new Map();
      iyiler = [];
      hatali.yerel = 0;
      hatali.dis = 0;
      onay = null;
      yolda.clear();
      okunamayanlar.clear();
      if (yollar.length === 0 || !fs) return 0;
      let guvenilmez = false; // dosya VAR ama okunamadı ya da bozuktu (yalnız "yok" değil)
      const artakalanlar = new Map(); // önceki süreç yanıt almadan öldü: "yolda" işareti kalmış parmak izleri -> köken (tur 6; köken tur 7)
      for (const yol of yollar) {
        let sonuc = dosyayiOku(yol);
        if (sonuc.durum === 'bozuk') {
          guvenilmez = true;
          sonuc = bozuguKenaraAl(yol) ? { durum: 'yok' } : { durum: 'okunamadi' };
        }
        if (sonuc.durum === 'ok') {
          birlestir(sonuc.kayitlar);
          sayaclariBirlestir(sonuc);
          for (const [p, k] of sonuc.yolda ?? []) artakalanlar.set(p, artakalanlar.has(p) ? kokenBirlestir(artakalanlar.get(p), k) : k);
        } else if (sonuc.durum === 'okunamadi') {
          guvenilmez = true;
          okunamayanlar.add(yol);
        }
      }
      sorunuAyarla(okunamayanlar.size > 0 ? 'okunamadi' : null);
      if (guvenilmez) {
        onay = 'kayit-okunamadi'; // eski reddedilmiş/doğrulanmış kayıtlar bilinemiyor: ilk kimlikli istek kullanıcı onayına bağlı
        if (!bildirilenler.has('okunamadi')) {
          // Bozuk dosya kenara alındığı için `sorun` boştur ama kullanıcı yine de bilgilendirilir (oturum başına BİR kez).
          bildirilenler.add('okunamadi');
          try {
            sorunGeriCagri('okunamadi');
          } catch {
            /* bildirim hatası kesiciyi etkilemesin */
          }
        }
        gunluk('Yetki kesici kaydı güvenilmez (okunamadı ya da bozuk); kimlikli istekler kullanıcı onayına (Yeniden Dene) kadar durduruldu.');
      } else if (!yazilabilirMi()) {
        onay = 'kayit-yazilamadi'; // reddedilen anahtar kaydedilemeyecek: her açılışta aynı anahtarla 1 deneme daha gitmesin
        sorunuAyarla('yazilamadi');
        gunluk('Yetki kesici kaydı yazılamıyor; kimlikli istekler kullanıcı onayına (Yeniden Dene) kadar durduruldu.');
      }
      // Yanıtı alınmamış denemeler (kapanış, çökme, güncelleme, kapanan PC): HA saymış olabilir. BELİRSİZ deneme sayılır ve işaret silinir;
      // hiç doğrulanmamış anahtar böylece 'dogrulanamadi' olur (kullanıcı uyarılır) ve her açılış yeni bir deneme göndermez.
      for (const [p, koken] of artakalanlar) {
        if (reddedildiMiIc(p)) continue;
        gunluk(`Yetki kesici: önceki oturumda yanıtı alınmamış bir kimlikli istek kalmıştı (parmak izi=${p.slice(0, 8)}); sonucu belirsiz sayıldı.`);
        belirsizKaydetIc(p, koken); // belirsiz sayaç + isteğin gittiği kökenin hata bütçesi (K11)
      }
      if (artakalanlar.size > 0) yaz(); // reddedilmiş parmak izlerinin işareti de diskten silinsin
      return kayitlar.length;
    },

    /** Kalıcı kayıt sorunu: 'yazilamadi' | 'okunamadi' | null (Ayarlar'da uyarı için). */
    kayitSorunu: () => sorun,

    parmakIzi: anahtarParmakIzi,

    reddedildiMi: reddedildiMiIc,

    /** Belirsiz deneme sınırı aşıldığı (ya da kayıt güvenilmez olduğu) için durdurulmuş mu ('dogrulanamadi')? Hata bütçesi burada karar vermez (K15). */
    dogrulanamadiMi: dogrulanamadiMiIc,

    /**
     * İstek ağa çıkmadan ÖNCE sorulur. taban verilmezse yalnız anahtar denetlenir.
     * @returns {{izin: true} | {izin: false, neden: 'reddedildi'|'dogrulanamadi'|'duraklatildi', kalanMs?: number}}
     */
    karar({ taban, parmakIzi } = {}) {
      if (reddedildiMiIc(parmakIzi)) return { izin: false, neden: 'reddedildi' };
      if (dogrulanamadiMiIc(parmakIzi)) return { izin: false, neden: 'dogrulanamadi' };
      if (taban) {
        const koken = kokenAl(taban);
        const bitis = duraklatmalar.get(koken);
        if (bitis !== undefined) {
          const kalan = bitis - simdi();
          if (kalan > 0) return { izin: false, neden: 'duraklatildi', kalanMs: kalan };
          duraklatmalar.delete(koken);
        }
      }
      return { izin: true };
    },

    /**
     * HA anahtarı reddetti (REST 401 / WS auth_invalid). Kalıcı yazılır; YENİ kayıtsa `reddedildi` geri çağrısı BİR kez çalışır.
     * `koken`: 'yerel' | 'dis' (isteğin gittiği adres; bilinmiyorsa her iki sayaç artar).
     * @returns {boolean} bu parmak izi ilk kez reddedildi mi
     */
    reddet(parmakIzi, neden = 'HTTP_401', koken = undefined) {
      if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi)) return false;
      yolda.delete(parmakIzi); // kesin sonuç: yanıt geldi (aşağıdaki yazım işareti de siler)
      // HA bu denemeyi (isteğin gittiği kökende) saymıştır (aynı anahtar için bile): o kökenin KESİN sayacı artar. Köken bilinmiyorsa ikisi de.
      hataliArtir(koken);
      askidaKesinlestir(parmakIzi); // anahtar geçersiz: önceki belirsiz denemeleri de HA saymıştır (K14: kesinleşir, bütçede kalır)
      if (reddedildiMiIc(parmakIzi)) {
        yaz();
        return false;
      }
      const kod = NEDENLER.has(neden) ? neden : 'HTTP_401';
      kayitlar = [...kayitlar, { parmakIzi, zaman: simdi(), neden: kod }];
      kirp();
      belirsizler.delete(parmakIzi); // artık kesin: reddedildi
      iyiler = iyiler.filter((p) => p !== parmakIzi);
      const kalici = yaz();
      gunluk(`Yetki kesici: anahtar reddedildi (neden=${kod}, parmak izi=${parmakIzi.slice(0, 8)}, hatalı deneme=${hataliSayisi(koken)}, köken=${KOKENLER.includes(koken) ? koken : 'bilinmiyor'}); bu anahtarla kimlikli istekler durduruldu.`);
      try {
        reddedildi(parmakIzi, kod, kalici);
      } catch {
        /* bildirim hatası kesiciyi etkilemesin */
      }
      bildirDegisti();
      return true;
    },

    /** Saklı (kullanılan) anahtarın parmak izini listeden düşmeye karşı korur (aday anahtar denemeleri onu itemesin). */
    koru(parmakIzi) {
      if (typeof parmakIzi === 'string' && PARMAK_IZI_DESENI.test(parmakIzi)) korunanlar.add(parmakIzi);
    },

    /**
     * Kimlikli istek zaman aşımına uğradı / gönderildikten sonra koptu: HA isteği işlemiş olabilir. Sayaç KALICI artar;
     * sınır aşılırsa anahtar 'dogrulanamadi' durumuna geçer (parmak izi başına BİR bildirim). K11: isteğin gittiği kökenin
     * ('yerel' | 'dis'; bilinmiyorsa ikisinin) hata bütçesi de artar.
     * @returns {{sayi: number, sinirAsildi: boolean}}
     */
    belirsizKaydet: belirsizKaydetIc,

    belirsizSayisi: (parmakIzi) => belirsizler.get(parmakIzi) ?? 0,

    /**
     * Kimlikli istek/auth ağa çıkmadan ÖNCE çağrılır (tur 6): kalıcı "yolda" işareti yazılır. Süreç yanıt gelmeden ölürse işaret diskte
     * kalır ve bir sonraki `yukle()` onu belirsiz deneme sayar. İşaret hiçbir yere yazılamazsa istek GÖNDERİLMEZ ('kayit-yazilamadi' kapısı).
     * @returns {boolean} true: işaret yazıldı (ya da kalıcı kayıt yok / açık ikinci onay bileti var); false: yazılamadı, istek gönderilmemeli
     */
    yoldaBaslat(parmakIzi, koken = undefined) {
      if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi)) return true;
      const k = KOKENLER.includes(koken) ? koken : undefined;
      if (yolda.has(parmakIzi)) {
        if (yolda.get(parmakIzi) !== k) {
          yolda.set(parmakIzi, undefined); // aynı anahtarla iki köken yolda: hangisi saydıysa bilinmez, ikisine birden
          yaz();
        }
        return true;
      }
      yolda.set(parmakIzi, k);
      if (yaz()) return true;
      yolda.delete(parmakIzi);
      if (biletler.has(parmakIzi)) return true; // kullanıcı açık ikinci onay verdi (aday doğrulaması): kayıt yazılamıyor uyarısını zaten kabul etti
      if (!onay) {
        onay = 'kayit-yazilamadi';
        gunluk('Yetki kesici: yolda işareti yazılamadı; kimlikli istekler kullanıcı onayına (Yeniden Dene) kadar durduruldu.');
        bildirDegisti();
      }
      return false;
    },

    /** İstek kesin sonuçlandı (yanıt başlığı geldi ya da gönderim öncesi hata); işaret silinir (idempotent). Zaman aşımı/kopmada belirsizKaydet siler. */
    yoldaBitir(parmakIzi) {
      if (typeof parmakIzi === 'string' && yolda.delete(parmakIzi)) yaz();
    },

    /**
     * HA bu anahtarı DOĞRULADI: GET /api/ yanıtı 200 ve {"message":"API running."} (ya da WS auth_ok). Belirsiz sayaç sıfırlanır,
     * parmak izi "doğrulanmış" işaretlenir (kalıcı; yalnız değişince yazılır). 404 / başka içerikli 200 ASLA buradan geçmez.
     */
    dogrulandi(parmakIzi) {
      if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi) || reddedildiMiIc(parmakIzi)) return;
      let degisen = belirsizler.delete(parmakIzi);
      if (askidalar.delete(parmakIzi)) degisen = true; // K14: anahtar geçerli, HA askıdaki denemeleri saymamıştır: tüm kökenlerin bütçesinden düşer
      if (yolda.delete(parmakIzi)) degisen = true;
      dogrulanamadiBildirilenler.delete(parmakIzi);
      if (!iyiler.includes(parmakIzi)) {
        iyiler = [...iyiler, parmakIzi].slice(-EN_COK_IYI);
        degisen = true;
      }
      if (degisen) {
        yaz();
        bildirDegisti();
      }
    },

    /** Daha önce başarıyla doğrulanmış anahtar mı (kalıcı)? */
    iyiMi: (parmakIzi) => iyiler.includes(parmakIzi),

    /** Doğrulama dışı bir kimlikli REST yanıtı (2xx, HA içeriği) başarıyla alındı: belirsiz sayaç sıfırlanır ve askıdaki denemeleri düşer (K14); doğrulanmış işareti VERİLMEZ. */
    belirsizSifirla(parmakIzi) {
      if (typeof parmakIzi !== 'string' || reddedildiMiIc(parmakIzi)) return;
      const belirsizVardi = belirsizler.delete(parmakIzi);
      const askidaVardi = askidalar.delete(parmakIzi); // K14
      if (!belirsizVardi && !askidaVardi) return;
      dogrulanamadiBildirilenler.delete(parmakIzi);
      yaz();
      bildirDegisti();
    },

    /**
     * WebSocket auth_ok: HA'nın kendi hatalı deneme sayacını (IP başına) sıfırladığı tek doğrulanmış yol. YALNIZ başarının geldiği
     * kökenin ('yerel' | 'dis') hata bütçesi sıfırlanır: ev içi giriş evin internet IP'sinin (dış köken) sayacını silmez.
     * Köken bilinmiyorsa hiçbir sayaç sıfırlanmaz. K14: o kökendeki askıdaki denemeler de düşer (HA'nın IP sayacı silindi).
     */
    girisBasarili(koken) {
      if (!KOKENLER.includes(koken)) return;
      // HA o IP'nin sayacını sildi: kesin sayaç ve bu kökendeki (her anahtardan) askıdaki denemeler de silinir (diğer köken değişmez).
      let degisen = hatali[koken] !== 0;
      hatali[koken] = 0;
      for (const [p, a] of [...askidalar]) {
        if (a[koken] === 0) continue;
        degisen = true;
        a[koken] = 0;
        if (a.yerel === 0 && a.dis === 0) askidalar.delete(p);
      }
      if (!degisen) return;
      yaz();
      bildirDegisti();
    },

    /** Son başarılı WS girişinden beri HA'nın reddettiği deneme sayısı (kalıcı, anahtardan bağımsız, sırsız); köken verilmezse en yüksek. */
    hataliDenemeSayisi: (koken) => hataliSayisi(koken),

    /** Kayıt güvenilmezse ('kayit-okunamadi' | 'kayit-yazilamadi') kullanıcı onayı (yenidenDene) bekleniyor; yoksa null. */
    onayDurumu: () => onay,

    /**
     * Kullanıcı Ayarlar'da açık ikinci onay verdi (aday anahtar doğrulaması): güvenilmez KAYIT kapısı KÜRESEL olarak AÇILMAZ; yalnız
     * bu parmak izinin (adayın) doğrulama isteği geçer. Saklı anahtar, aday 401 alsa bile onayı beklemeye devam eder (aksi halde
     * 60 sn'lik yedek yoklaması önceden reddedilmiş olabilecek saklı anahtarı kullanıcı onayı olmadan doğrulardı).
     * @returns {() => void} bileti bırakır (idempotent; doğrulama bitince try/finally ile çağrılır)
     */
    onayBileti(parmakIzi) {
      if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi)) return () => {};
      biletler.set(parmakIzi, (biletler.get(parmakIzi) ?? 0) + 1);
      let birakildi = false;
      return () => {
        if (birakildi) return;
        birakildi = true;
        const kalan = (biletler.get(parmakIzi) ?? 1) - 1;
        if (kalan > 0) biletler.set(parmakIzi, kalan);
        else biletler.delete(parmakIzi);
      };
    },

    /** Aday anahtar BAŞARIYLA doğrulanıp saklandı ya da kullanıcı "Yeniden Dene" dedi: güvenilmez KAYIT kapısı (küresel onay) kapanır. */
    onayVer() {
      if (!onay) return false;
      onay = null;
      bildirDegisti();
      return true;
    },

    /**
     * Bu anahtarı doğrulamadan önce kullanıcıdan AÇIK ikinci onay gerekir mi? (Ayarlar'da kaydet / Yeniden Dene.) İki neden BİRLİKTE döner:
     *  - kayıt güvenilmez: her anahtar için;
     *  - hata bütçesi: isteğin gideceği KÖKENİN sayacı >= HATA_BUTCESI_ESIGI (köken bilinmiyorsa en yüksek sayaç). Daha önce
     *    doğrulanmış olmak BURADA muaf tutmaz (K12a): ne aday ne de saklı anahtar ("Yeniden Dene" kullanıcının açık yeniden denemesidir).
     *    Bütçe (kesin + askıdaki) yalnız bu SORUYU etkiler; otomatik yollarda hiçbir anahtarı durdurmaz (K15, K16).
     * @param {string} parmakIzi
     * @param {{koken?: 'yerel'|'dis'}} [secenek]
     * @returns {{neden: 'kayit-okunamadi'|'kayit-yazilamadi'}|{neden: 'hata-butcesi', sayi: number, kayit?: 'kayit-okunamadi'|'kayit-yazilamadi'}|null}
     *   bütçe varsa neden 'hata-butcesi' (uyarı bütçeyi gösterir), kayıt nedeni de varsa `kayit` alanında
     */
    onayGerekliMi(parmakIzi, { koken } = {}) {
      const sayi = hataliSayisi(koken);
      if (sayi >= HATA_BUTCESI_ESIGI) {
        return onay ? { neden: 'hata-butcesi', sayi, kayit: onay } : { neden: 'hata-butcesi', sayi };
      }
      return onay ? { neden: onay } : null;
    },

    /**
     * Kullanıcı Ayarlar'dan "Yeniden dene" dedi: durmuş (dogrulanamadi) anahtarlara TEK yeni deneme hakkı (başarılıysa yeniden doğrulanır,
     * 401 ise reddedilir, yanıtsızsa yeniden durur). Hata bütçesi >= 2 iken bilet (ikinci onay) gerekir; bu çağıranın işidir (onayGerekliMi).
     * @returns {boolean} durmuş anahtar vardı mı
     */
    yenidenDene() {
      let vardi = false;
      if (onay) {
        onay = null; // kullanıcı güvenilmez kaydı kabul etti: TEK doğrulama gider
        vardi = true;
      }
      for (const [p, sayi] of belirsizler) {
        if (sayi >= belirsizSiniri(p)) {
          const kalan = belirsizSiniri(p) - 1;
          if (kalan > 0) belirsizler.set(p, kalan);
          else belirsizler.delete(p);
          dogrulanamadiBildirilenler.delete(p);
          vardi = true;
        }
      }
      if (vardi) {
        yaz();
        bildirDegisti();
      }
      return vardi;
    },

    /** Kimlikli istekte 403: o adrese istekler 15 dk durur (anahtar geçersiz sayılmaz). @returns {boolean} yeni duraklatma mı */
    duraklat(taban, etiket = 'adres') {
      const koken = kokenAl(taban);
      const bitis = duraklatmalar.get(koken);
      if (bitis !== undefined && bitis > simdi()) return false;
      duraklatmalar.set(koken, simdi() + DURAKLATMA_MS);
      gunluk(`Yetki kesici: ${etiket} için kimlikli istekler ${DURAKLATMA_MS / 60000} dk duraklatıldı (neden=HTTP_403).`);
      bildirDegisti();
      return true;
    },

    /**
     * "Anahtarı sil": YALNIZ o parmak izinin kaydı (reddedildi, belirsiz sayaç, doğrulanmış işareti) silinir; başka anahtarların
     * kayıtlarına, hata bütçesi sayacına ve okunamayan dosyalara DOKUNULMAZ. @returns {boolean} silinecek kayıt vardı mı
     */
    temizle(parmakIzi) {
      if (typeof parmakIzi !== 'string' || !PARMAK_IZI_DESENI.test(parmakIzi)) return false;
      const onceki = kayitlar.length;
      kayitlar = kayitlar.filter((k) => k.parmakIzi !== parmakIzi);
      const askidaVardi = askidaKesinlestir(parmakIzi); // sayaçlara dokunulmaz: askıdakiler kesinleşir, bütçede kalır (K14)
      const vardi = kayitlar.length !== onceki || belirsizler.delete(parmakIzi) || iyiler.includes(parmakIzi) || askidaVardi;
      iyiler = iyiler.filter((p) => p !== parmakIzi);
      dogrulanamadiBildirilenler.delete(parmakIzi);
      korunanlar.delete(parmakIzi);
      yolda.delete(parmakIzi);
      if (vardi) {
        yaz();
        gunluk(`Yetki kesici: anahtar kaydı temizlendi (parmak izi=${parmakIzi.slice(0, 8)}).`);
      }
      bildirDegisti();
      return vardi;
    },

    /** Yalnız sınama/durum için: 16 haneli parmak izleri (sır değildir). */
    reddedilenler: () => kayitlar.map((k) => k.parmakIzi),
  };
}

module.exports = { DURAKLATMA_MS, EN_COK_BELIRSIZ, EN_COK_BELIRSIZ_IYI, EN_COK_KAYIT, HATA_BUTCESI_ESIGI, anahtarParmakIzi, kayitlariDuzelt, yetkiKesiciOlustur };
