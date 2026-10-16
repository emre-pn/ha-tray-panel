'use strict';

/**
 * Home Assistant REST istemcisi: adres seçimi (ev içi / dış), yoklama ve API istekleri.
 *
 * Electron'a doğrudan bağlı değildir: `fetch` (main.js'te net.fetch), ayarlar, anahtar ve ana pencere durumu dışarıdan
 * verilir; böylece sahte fetch ile birim testi yapılır (test/ha-istemcisi.test.js).
 *
 * Güvenlik
 *  - Authorization başlığı YALNIZ bu dosyada (tekIstek) oluşturulur; anahtar hiçbir günlüğe, hata metnine ya da
 *    başka bir kanala gitmez. Yoklama (adresiYokla) anahtarsızdır.
 *  - Anahtarlı istek yönlendirmeyi izlemez (redirect: 'error'): anahtar başka bir adrese gitmesin. Yoklama da izlemez:
 *    yönlendiren bir adres (ör. http -> https) "ulaşılabilir" seçilmez, çünkü ana pencere ve API o köke gidecek.
 *  - http:// adrese anahtar YALNIZ ev/yerel ağ adresinde gider (anahtarIcinGuvenliAdresMi); herkese açık bir ada düz http ile
 *    ne yoklama ne anahtarlı istek yapılır.
 *  - Sertifika doğrulaması normaldir (ev içi adres https:// ise de); hiçbir sertifika hatası bastırılmaz.
 *  - GET'te bağlantı hatası olursa adres yeniden seçilip bir kez daha denenir; POST (servis çağrısı) ASLA tekrarlanmaz.
 *  - Yetki kesici (1.1.1, src/lib/yetki-kesici.js): kimlikli HER istek (REST ve canlı bağlantının auth adımı) ağa çıkmadan önce
 *    kesiciden geçer. HA bir anahtarı reddederse (401) o anahtarla hiçbir adrese istek gitmez (kalıcı); 403 gelirse o adrese
 *    kimlikli istekler 15 dk durur. Adres değiştirme nedeni YALNIZ ağ hatasıdır: 401/403 adres değiştirmez, anahtarı ikinci
 *    bir adrese taşımaz. Kimlikli toplu isteklerden/canlı bağlantıdan ÖNCE (açılış, adres ya da anahtar değişimi) tam BİR
 *    doğrulama isteği (GET /api/) gider; sürerken gelen diğer çağrılar (başka adrese gidecekler dahil) aynı sözü bekler.
 *    Doğrulama YALNIZ yanıt 200 VE gövde {"message":"API running."} ise sayılır (404 / başka içerikli 200 asla: sonraki çağrı yine
 *    önce /api/ doğrulaması yapar). Doğrulama 30 sn taze kalır; uyanış/ağ-adres değişimi (secimiSifirla), canlı bağlantı kopması ve
 *    ağ hatasında unutulur. Yanıtın durumu gövdeden ÖNCE değerlendirilir ve gövde iptali beklenmez (gövde okunurken kopan ya da
 *    süresi dolan bir 401/403 ağ hatası sanılmaz; yanıt başlığı gelmiş bir istek ASLA "bağlantı" sayılıp başka adrese yeniden denenmez).
 *  - Küresel kapı (tur 3, K1; src/lib/kimlikli-kapi.js): kimlikli HER ağ işlemi (her REST isteği VE WS 'auth' iletisi) tek kapıdan
 *    geçer ve aynı anda EN ÇOK 1 kimlikli işlem yolda olur. WS auth bu kapıyı auth iletisini göndermeden alır, auth_ok/auth_invalid
 *    ya da soket kapanışı gelene kadar bırakmaz. Kapıyı bekleyenler kapıyı aldıktan sonra kesiciyi yeniden denetler: anahtar
 *    uygulama çalışırken iptal edilse bile HA'ya en çok 1 hatalı deneme gider (belirsiz bir yanıtsızlık dışında). Kapı hata, zaman
 *    aşımı, iptal ve soket kapanışında bırakılır; unutulursa bekçi süresi (60 sn) zorla bırakır.
 *    Kimlikli istekte zaman aşımı ve GÖNDERİM SONRASI kopmalar (reset, "terminated", sınıflandırılamayan hatalar) 'belirsiz'
 *    sayılır: yeniden deneme/başka adres yok, o anahtarla 30 sn istek yok VE belirsiz deneme sayısı KALICI tutulur (hiç
 *    doğrulanmamış anahtarda İLK, doğrulanmışta 2. belirsizlikte 'dogrulanamadi': kullanıcı "Yeniden Dene" diyene kadar istek
 *    yok). Yalnız gönderim ÖNCESİ hatalar (bağlantı reddi, DNS, ağ yok) adres değiştirir. Doğrulama isteğinin zaman aşımı
 *    uzundur (ev içi 15 sn, dış 30 sn): HA saydığı halde istemci vazgeçmesin.
 *    Ev içi adres yalnız ULAŞILAMAZ ise (403 değil) hiç doğrulanmamış anahtar dış adrese tek doğrulamayla gider (bilinçli karar, README):
 *    evden uzakken tek yol odur; zarar anahtar başına 1 hatalı deneme ile sınırlıdır.
 *    Ev içi adres YOKLAMASI 403 verdiyse (HA bu bilgisayarı banlamış olabilir) daha önce başarıyla doğrulanmamış anahtar (kullanıcı
 *    onayı yoksa) dış adrese GÖNDERİLMEZ ('yerel-yasak'); ana pencere zaten dış adresteyse (aktifAdresAl kısayolu) bile: dış adrese
 *    gidecek doğrulanmamış anahtar için ev içi yoklama gerekirse yenilenir. Doğrulama sonrası en çok geçersiz anahtar başına 1
 *    hatalı deneme beklenir; `yetkiKesici` verilmezse bu koruma yoktur (yalnız birim testleri; main.js HER ZAMAN verir).
 *  - Öncelik (tur 4): kapıda kullanıcı eylemi (POST), WS auth ve doğrulama isteği bekleyen toplu GET'lerin önüne geçer (sınır yine 1).
 *  - Aday anahtar onayı (tur 4, K5): kayıt güvenilmezken açık ikinci onay yalnız ADAYIN doğrulamasına özel bilettir; küresel onay açılmaz.
 *  - Tur 5 (K7-K10): hata bütçesi KÖKEN başına (ev içi / dış) sayılır ve isteğin gideceği kökenin sayacına bakılır; aday doğrulaması
 *    kapı ALINDIKTAN SONRA bütçeyi yeniden denetler (beklerken sayaç arttıysa ağa çıkmadan 'ikinci-onay'). Açık ikinci onay bir
 *    `onay` nesnesidir ({sayi}: onaylanan sayaç; ana sürecin tek kullanımlık bileti harcandıktan sonra verilir); sayaç onaylanandan
 *    fazlaysa geçmez. Ev içi 403 iken dış adres izni (`disIzniVer`) YALNIZ onaylanan parmak izi içindir. Kimlikli istekte 502/504/520/
 *    522/524 BELİRSİZ sayılır (HA işlemiş olabilir). `haIstek(yol, {oncelik: 'yuksek'})` kapıda toplu GET'lerin önüne geçer.
 *  - Tur 6: doğrulama ve doğrulanmamış/taze olmayan her kimlikli istek (ve WS auth) ağa çıkmadan ÖNCE kesiciye kalıcı "yolda" işareti yazar
 *    (yoldaBaslat; yazılamazsa istek gönderilmez), kesin sonuçta siler (yoldaBitir). Yanıt gelmeden süreç ölürse işaret açılışta belirsiz sayılır.
 *  - 1.2.0 (h-08): ana pencerenin adresi (aktifAdresAl) en çok AKTIF_KISAYOL_GECERLILIK_MS (5 dk) kısayol sayılır; sonra adres
 *    anahtarsız yoklamayla yeniden seçilir. Canlı bağlantı koptuğunda da (wsYetkisi.koptu(true)) seçim unutulur. 401/403 yine adres
 *    DEĞİŞTİRMEZ. (h-19) Adres bulunamazsa zorla ikinci seçim yalnız başarısız seçimin bekleme penceresi dışındaysa yapılır.
 *    (k-15) Dış adresteyken yereleDonusYokla() YALNIZ ev içi adresi anahtarsız yoklar; ulaşılabilirse ev içi seçimi döner.
 *  - 1.2.0 (h-09): TAZE doğrulanmış anahtarla giden servis çağrısı (POST) zaman aşımına uğrarsa 'gecikti' döner ("komut gönderildi,
 *    yanıt gecikti"): 30 sn soğuma YOK. Güvence korunur: deneme kesicide yine ASKIDA sayılır (sonraki başarılı doğrulamada düşer;
 *    anahtar başına hatalı deneme sınırı aynen işler), doğrulama unutulur (sonraki kimlikli istek ÖNCE tek doğrulamayla gider) ve
 *    kapıda bekleyen, önceden doğrulanmış sayılmış istekler gönderilmez ('belirsiz').
 */

const { sinirliOku, yoklamaDegerlendir, YOKLAMA_GOVDE_SINIRI_BAYT } = require('./lib/yoklama');
const { anahtarIcinGuvenliAdresMi } = require('./lib/dogrulama');
const { kapiOlustur } = require('./lib/kimlikli-kapi');
const { TR } = require('./lib/ceviri-varsayilan');

const API_ZAMAN_ASIMI_MS = 8000;
const SECIM_GECERLILIK_MS = 60_000;
const SECIM_BASARISIZ_BEKLEME_MS = 15_000;
const AKTIF_KISAYOL_GECERLILIK_MS = 5 * 60_000; // h-08: ana pencere adresi en çok bu kadar yoklamasız kullanılır
const YERELE_DONUS_YOKLAMA_MS = 3 * 60_000; // k-15: dış adresteyken ev içi adres bu aralıkla (anahtarsız) yoklanır (main.js zamanlayıcısı)
const DOGRULAMA_TAZELIK_MS = 30_000; // son başarılı kimlikli yanıttan bu yana geçen süre: eskiyse yeniden TEK doğrulama
const BELIRSIZ_SOGUMA_MS = 30_000; // kimlikli istekte zaman aşımı: bu süre o anahtarla HİÇBİR kimlikli istek çıkmaz
const BELIRSIZ_SOGUMA_TAVAN_MS = 15 * 60_000; // ardışık zaman aşımlarında soğuma ikiye katlanır (ban sayacı sınırsız dolmasın)
const DOGRULAMA_ZAMAN_ASIMI_YEREL_MS = 15_000; // doğrulama (GET /api/) isteği: HA yavaşken de yanıtı beklenir (HA saydıysa 401'i görelim)
const DOGRULAMA_ZAMAN_ASIMI_DIS_MS = 30_000; // Cloudflare tüneli yavaş olabilir (Cloudflare 100 sn bekler)
/** Kimlikli istekte bu yanıtlar BELİRSİZ sayılır (tur 5, K10): ağ geçidi/vekil/Cloudflare hatası; HA isteği işlemiş (401'i saymış) olabilir. */
const BELIRSIZ_SUNUCU_DURUMLARI = new Set([502, 504, 520, 522, 524]);

/**
 * İstek HA'ya (ya da Cloudflare'e) HİÇ ulaşmadan oluşan, dolayısıyla güvenle yeniden denenebilir ağ hataları: bağlantı reddi,
 * DNS, ağ/yol yok, TLS el sıkışma/sertifika hatası, yönlendirme reddi. Başka her hata (reset, "terminated", sınıflandırılamayan)
 * istek gönderildikten sonra olmuş olabilir: HA 401'i sayıp yanıtı yolda kaybettirmiş olabilir.
 */
const GONDERIM_ONCESI_HATA =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_ACCESS_DENIED|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_CERT_|ERR_SSL_|CERT_|SELF_SIGNED|redirect/i;

function gonderimOncesiHatasiMi(hata) {
  const metin = [hata?.code, hata?.message, hata?.cause?.code, hata?.cause?.message, hata?.cause?.cause?.code].filter((m) => typeof m === 'string').join(' ');
  return GONDERIM_ONCESI_HATA.test(metin);
}

class HaHatasi extends Error {
  /**
   * @param {'anahtar-yok'|'baglanti'|'yetki'|'reddedildi'|'duraklatildi'|'dogrulanamadi'|'yerel-yasak'|'ikinci-onay'|'yasak-erisim'|'bulunamadi'|'sunucu'|'engelli'|'ulasilamiyor'|'kaynak-izinsiz'|'onay-gerekli'|'belirsiz'|'gecikti'} tur
   *   ikinci-onay: hata bütçesi dolu (>= 2 hatalı deneme) ya da kesici kaydı güvenilmez: yeni anahtar doğrulaması AÇIK ikinci onay ister (istek gönderilmedi);
   *   dogrulanamadi: belirsiz (yanıtsız) deneme sınırı aşıldı: kullanıcı "Yeniden dene" diyene kadar istek gönderilmez;
   *   yerel-yasak: ev içi yoklama 403 verdi ve anahtar daha önce doğrulanmadı: anahtar dış adrese gönderilmedi;
   *   belirsiz: kimlikli istek zaman aşımına uğradı / gönderimden sonra koptu (HA isteği işlemiş olabilir): soğuma boyunca o anahtarla istek gönderilmez;
   *   gecikti (h-09): taze doğrulanmış anahtarla giden servis çağrısı zaman aşımına uğradı: komut gönderildi, sonuç bilinmiyor (soğuma yok);
   *   yetki: HA bu istekte 401 verdi; reddedildi: anahtar daha önce reddedilmişti, istek HİÇ gönderilmedi; duraklatildi: adres 403 yüzünden duraklatıldı, istek gönderilmedi
   */
  constructor(tur, durumKodu = 0, ek = null) {
    super(tur);
    this.name = 'HaHatasi';
    this.tur = tur;
    this.durumKodu = durumKodu;
    if (ek) this.onay = ek; // ikinci-onay: { neden, sayi? } (sır içermez)
  }
}

const HATA_ANAHTARLARI = Object.freeze({
  'anahtar-yok': 'hata.anahtarYok',
  baglanti: 'hata.baglanti',
  yetki: 'hata.yetki',
  reddedildi: 'hata.reddedildi',
  duraklatildi: 'hata.duraklatildi',
  'yasak-erisim': 'hata.yasakErisim',
  belirsiz: 'hata.belirsiz',
  gecikti: 'hata.gecikti',
  dogrulanamadi: 'hata.dogrulanamadi',
  'yerel-yasak': 'hata.yerelYasak',
  'ikinci-onay': 'hata.ikinciOnay',
  bulunamadi: 'hata.bulunamadi',
  engelli: 'hata.engelli',
  ulasilamiyor: 'hata.ulasilamiyor',
  'kaynak-izinsiz': 'hata.kaynakIzinsiz',
  'onay-gerekli': 'hata.onayGerekli',
});

/** Kullanıcıya gösterilen kısa hata metni (adres, anahtar vb. ASLA içermez). t: çevirmen (src/lib/dil.js); verilmezse Türkçe. */
function hataMetni(hata, t = TR) {
  const tur = hata?.tur;
  if (typeof tur === 'string' && Object.hasOwn(HATA_ANAHTARLARI, tur)) return t(HATA_ANAHTARLARI[tur]);
  if (tur === 'sunucu') return hata.durumKodu ? t('hata.sunucuKodlu', { kod: hata.durumKodu }) : t('hata.sunucu');
  return t('hata.beklenmeyen');
}

/** fetch'in redirect: 'error' yüzünden reddedildiğini anlar (hata metni sürücüye göre değişir; yalnız "redirect" aranır). */
function yonlendirmeHatasiMi(hata) {
  return /redirect/i.test(`${hata?.message ?? ''} ${hata?.cause?.message ?? ''}`);
}

/** İşi en çok `ms` milisaniye bekler; süre dolarsa isteği iptal eder ve 'baglanti' hatası verir. */
function zamanAsimiIle(ms, is) {
  const denetleyici = new AbortController();
  let zamanlayici;
  const sure = new Promise((_coz, reddet) => {
    zamanlayici = setTimeout(() => {
      denetleyici.abort();
      const hata = new HaHatasi('baglanti');
      hata.zamanAsimi = true; // kimlikli istekte "belirsiz": HA isteği işlemiş olabilir
      reddet(hata);
    }, ms);
  });
  return Promise.race([is(denetleyici.signal), sure]).finally(() => clearTimeout(zamanlayici));
}

/**
 * @param {object} bag
 * @param {(url: string, secenekler: object) => Promise<Response>} bag.fetch
 * @param {() => {yerelAdres?: string, disAdres?: string, yerelZamanAsimiMs?: number, disZamanAsimiMs?: number}} bag.ayarlarAl
 * @param {() => Promise<string|null>} bag.anahtarAl
 * @param {() => string|null} bag.aktifAdresAl ana pencerede şu an açık HA kökeni
 * @param {(secim: {adres: string, tur: 'yerel'|'dis'}) => void} [bag.yenidenBaglan] adres seçimi sonrası ana pencereyi taşıma (karar main.js'te)
 * @param {(mesaj: string) => void} [bag.gunluk] yalnız sabit/türetilmiş güvenli metinler
 * @param {() => number} [bag.simdi]
 * @param {ReturnType<typeof import('./lib/yetki-kesici').yetkiKesiciOlustur>|null} [bag.yetkiKesici] verilmezse kimlikli istekler kesicisiz gider (yalnız testler)
 * @param {() => void} [bag.durumDegisti] istemcinin engel durumu (yerel-yasak) değişti (tepsi/panel/ayarlar tazelensin)
 */
function haIstemcisiOlustur({ fetch, ayarlarAl, anahtarAl, aktifAdresAl, yenidenBaglan = () => {}, gunluk = () => {}, simdi = () => Date.now(), yetkiKesici = null, durumDegisti = () => {} }) {
  let apiSecimi = { adres: null, zaman: 0 };
  let secimSuruyor = null;
  let yerelYasakli = false; // son ev içi YOKLAMA 403 verdi (HA bu bilgisayarı banlamış olabilir)
  let engelTetiklendi = false; // bu yüzden doğrulanmamış bir anahtar dış adrese gönderilmedi (kullanıcıya gösterilir)
  const disIzni = new Set(); // kullanıcı "Yeniden dene" dedi: YALNIZ onaylanan parmak izleri bu oturumda (ev içi 403 iken) dış adrese gidebilir (tur 5, K9)
  // Küresel kapı (K1): kimlikli HER ağ işlemi (REST + WS auth) aynı anda en çok 1. Unutulan kapıyı bekçi zorla bırakır.
  const kapi = kapiOlustur({ zorlaBirakildi: () => gunluk('Kimlikli işlem kapısı bekçi süresi dolduğu için zorla bırakıldı.') });
  let yerelYoklamaZamani = null; // ev içi adresin SON (anahtarsız) yoklama zamanı; null: hiç yoklanmadı / unutuldu
  let yerelYoklaSuruyor = null;
  const dogrulananlar = new Map(); // "taban|parmakIzi" -> son DOĞRULAMA (GET /api/ "API running.") ya da WS auth_ok zamanı (tazelik: DOGRULAMA_TAZELIK_MS)
  const dogrulamaSurenler = new Map(); // parmakIzi -> {taban, soz}: süren TEK doğrulama (single-flight; adresler arası da tek)
  const belirsizler = new Map(); // parmakIzi -> soğuma bitişi: kimlikli istek zaman aşımına uğradı, sonuç belirsiz
  const belirsizSayaci = new Map(); // parmakIzi -> ardışık belirsiz sayısı (başarılı kimlikli yanıtta sıfırlanır)
  // secimiSifirla() sonrası (uyanış, ağ değişimi, adres ayarı, bozuk yanıt) ana pencerenin hâlâ eski sayfada kalan adresi
  // DOĞRULANMAMIŞTIR: yeniden doğrulanana kadar apiTabaniBul onu kısayol saymaz (anahtarlı REST/WS eski adrese gitmesin).
  let dogrulamaBekliyor = false;
  // h-08: ana pencere adresinin kısayol olarak son ONAYLANDIĞI an (anahtarsız seçim sonucu ya da secimiAyarla). Kısayol süresizdi;
  // artık AKTIF_KISAYOL_GECERLILIK_MS sonra adres yeniden (anahtarsız) yoklanır. adres null: hiç seçim yapılmadı.
  let aktifKisayol = { adres: null, zaman: 0 };
  // h-09: taze anahtarla giden servis çağrısı yanıtsız kaldı: bu parmak izleriyle bir sonraki kimlikli istek ÖNCE doğrulanır; kapıda
  // bekleyen (önceden doğrulanmış sayılan) istekler gönderilmez. Başarılı doğrulama/yanıt ya da anahtar değişimi temizler.
  const gecikmeSonrasi = new Set();

  function aktifKisayolOnayla(adres) {
    if (adres) aktifKisayol = { adres, zaman: simdi() };
  }

  /** h-08: ana pencere adresi kısayol olarak hâlâ kullanılabilir mi (son onaydan bu yana 5 dk'dan az)? */
  function aktifKisayolTazeMi(aktif) {
    if (aktifKisayol.adres === null) aktifKisayolOnayla(aktif); // hiç seçim yapılmadan açık olan adres: süre şimdi başlar
    if (aktifKisayol.adres !== aktif) return false; // pencere başka (onaylanmamış) bir adreste: seçim önbelleği ya da yoklama
    const yas = simdi() - aktifKisayol.zaman;
    return yas >= 0 && yas < AKTIF_KISAYOL_GECERLILIK_MS;
  }

  /** h-19: son seçim başarısız oldu ve bekleme penceresi (15 sn) sürüyor mu? */
  function secimBeklemesindeMi() {
    if (apiSecimi.adres || !apiSecimi.zaman) return false;
    const yas = simdi() - apiSecimi.zaman;
    return yas >= 0 && yas < SECIM_BASARISIZ_BEKLEME_MS;
  }

  function izinliKokenMi(koken) {
    const ayar = ayarlarAl() ?? {};
    return !!koken && (koken === ayar.yerelAdres || koken === ayar.disAdres);
  }

  /**
   * /manifest.json yoklaması (anahtarsız). Ulaşılabilir sayılması için yanıt 2xx olmalı VE içeriği Home Assistant'ın
   * manifest'i olmalı (hata-01; 5xx/403 hata-02). Günlüğe yalnız neden kodu yazılır.
   */
  async function adresiYokla(adres, ms) {
    if (!adres) return { ok: false, yasak: false };
    if (!anahtarIcinGuvenliAdresMi(adres)) {
      // Herkese açık bir ada düz http: ne giriş ne de anahtar oraya gitsin; adres seçimi bir sonrakine geçer.
      gunluk('Yoklama atlandı: http adresi ev ağında değil.');
      return { ok: false, yasak: false };
    }
    try {
      const sonuc = await zamanAsimiIle(ms, async (signal) => {
        const yanit = await fetch(new URL('/manifest.json', adres).toString(), {
          method: 'GET',
          signal,
          credentials: 'omit',
          redirect: 'error', // ayardaki adresin KENDİSİ doğrulanır: yönlendirilen son adresin yanıtı sayılmaz
        });
        const durum = yanit.status;
        let metin = null;
        if (durum >= 200 && durum < 300) {
          metin = await sinirliOku(yanit, YOKLAMA_GOVDE_SINIRI_BAYT);
        } else {
          try {
            await yanit.body?.cancel();
          } catch {
            /* gövde zaten kapalı */
          }
        }
        return { durum, metin };
      });
      const karar = yoklamaDegerlendir({ ...sonuc, icerikDogrula: true });
      if (!karar.ulasilabilir) gunluk(`Yoklama ulaşılamaz saydı: ${karar.neden}`);
      return { ok: karar.ulasilabilir, yasak: karar.neden === 'erisim-engelli' };
    } catch (hata) {
      // redirect: 'error' yönlendirmeyi hata olarak bildirir (Electron: "Attempted to redirect...", undici: "unexpected redirect").
      if (yonlendirmeHatasiMi(hata)) gunluk('Yoklama ulaşılamaz saydı: yonlendirme');
      return { ok: false, yasak: false };
    }
  }

  /** Ev içi yoklamanın 403 verip vermediği (HA ban'ı olabilir). Değişirse durum tazelenir; 403 geçince engel kalkar. */
  function yerelYasakAyarla(yasak) {
    if (yerelYasakli === yasak) return;
    yerelYasakli = yasak;
    if (yasak) gunluk('Ev içi adres yoklaması 403 verdi (Home Assistant bu bilgisayarı engellemiş olabilir).');
    else if (engelTetiklendi) engelTetiklendi = false;
    try {
      durumDegisti();
    } catch {
      /* dinleyici hatası istemciyi etkilemesin */
    }
  }

  async function adresSecIc() {
    const ayar = ayarlarAl() ?? {};
    const yerel = await adresiYokla(ayar.yerelAdres, ayar.yerelZamanAsimiMs);
    yerelYoklamaZamani = simdi();
    yerelYasakAyarla(yerel.yasak);
    if (yerel.ok) {
      aktifKisayolOnayla(ayar.yerelAdres); // h-08: anahtarsız yoklamayla onaylandı
      return { adres: ayar.yerelAdres, tur: 'yerel' };
    }
    if ((await adresiYokla(ayar.disAdres, ayar.disZamanAsimiMs)).ok) {
      aktifKisayolOnayla(ayar.disAdres);
      return { adres: ayar.disAdres, tur: 'dis' };
    }
    return null;
  }

  /** Önce ev içi adres, olmazsa dış adres. Aynı anda gelen çağrılar tek denemeyi paylaşır. */
  function adresSec() {
    if (!secimSuruyor) {
      secimSuruyor = adresSecIc().finally(() => {
        secimSuruyor = null;
      });
    }
    return secimSuruyor;
  }

  async function apiTabaniBul(zorla = false) {
    if (!zorla) {
      const aktif = aktifAdresAl();
      if (dogrulamaBekliyor && aktif && apiSecimi.adres === aktif) dogrulamaBekliyor = false; // sayfa doğrulanan adreste: kısayol yeniden geçerli
      // h-08: kısayol süresiz değil; 5 dk'dan eskiyse aşağıdaki seçim önbelleği/anahtarsız yoklama adresi yeniden doğrular.
      if (!dogrulamaBekliyor && aktif && izinliKokenMi(aktif) && aktifKisayolTazeMi(aktif)) return aktif;
      const yas = simdi() - apiSecimi.zaman;
      if (apiSecimi.adres && yas >= 0 && yas < SECIM_GECERLILIK_MS) return apiSecimi.adres;
      if (!apiSecimi.adres && apiSecimi.zaman && yas >= 0 && yas < SECIM_BASARISIZ_BEKLEME_MS) return null;
    }
    const secim = await adresSec();
    apiSecimi = { adres: secim?.adres ?? null, zaman: simdi() };
    // Ana pencere yanlış adreste kaldıysa (ör. evden çıkıldı) ya da hata sayfasındaysa onu da taşıma kararı main.js'te.
    if (secim) yenidenBaglan(secim);
    return apiSecimi.adres;
  }

  /**
   * k-15 (1.2.0): ana pencere DIŞ adresteyken ev içi adres yeniden ulaşılabilir mi? YALNIZ ev içi adres ANAHTARSIZ yoklanır
   * (/manifest.json, içerik doğrulamalı; anahtar hiçbir yere gitmez). Ulaşılabilirse seçim ev içi adrese alınır ve
   * {adres, tur: 'yerel'} döner (pencereyi taşıma kararı main.js'te); değilse ya da pencere dış adreste değilse null.
   * Başka bir seçim sürüyorsa beklemez, null döner (sonraki turda yeniden denenir).
   */
  async function yereleDonusYokla() {
    const ayar = ayarlarAl() ?? {};
    if (!ayar.yerelAdres || !ayar.disAdres || ayar.yerelAdres === ayar.disAdres) return null;
    if (aktifAdresAl() !== ayar.disAdres || secimSuruyor) return null;
    const yerel = await adresiYokla(ayar.yerelAdres, ayar.yerelZamanAsimiMs);
    yerelYoklamaZamani = simdi();
    yerelYasakAyarla(yerel.yasak);
    if (!yerel.ok || aktifAdresAl() !== ayar.disAdres) return null;
    apiSecimi = { adres: ayar.yerelAdres, zaman: simdi() };
    aktifKisayolOnayla(ayar.yerelAdres);
    return { adres: ayar.yerelAdres, tur: 'yerel' };
  }

  function belirsizMi(parmakIzi) {
    const bitis = belirsizler.get(parmakIzi);
    if (bitis === undefined) return false;
    if (bitis > simdi()) return true;
    belirsizler.delete(parmakIzi);
    return false;
  }

  /** Yetki kesici kimlikli isteğe izin vermiyorsa HaHatasi fırlatır (kesici yoksa hiçbir şey yapmaz). Ağa dokunmaz. */
  function kesiciDenetle(taban, parmakIzi) {
    if (!yetkiKesici) return;
    const karar = yetkiKesici.karar({ taban, parmakIzi });
    if (!karar.izin) {
      if (karar.neden === 'reddedildi' || karar.neden === 'dogrulanamadi') throw new HaHatasi(karar.neden);
      throw new HaHatasi('duraklatildi', 403);
    }
    if (belirsizMi(parmakIzi)) throw new HaHatasi('belirsiz');
    yerelYasakDenetle(taban, parmakIzi);
  }

  /**
   * Ev içi adres yoklaması 403 verdiyse HA bu bilgisayarı banlamış olabilir: geçersiz bir anahtarı bir de dış adrese (evin internet
   * IP'si) göndermek o IP'yi de banlatır. Yalnız daha önce başarıyla doğrulanmış (kalıcı) ya da kullanıcının onayladığı anahtar gider.
   */
  function yerelYasakDenetle(taban, parmakIzi) {
    if (!yerelYasakli || !taban || (parmakIzi && disIzni.has(parmakIzi))) return;
    if (!disAdresMi(taban)) return;
    if (parmakIzi && yetkiKesici.iyiMi(parmakIzi)) return;
    if (!engelTetiklendi) {
      engelTetiklendi = true;
      gunluk('Doğrulanmamış erişim anahtarı dış adrese gönderilmedi: ev içi adres 403 verdi (HA ban\'ı olabilir).');
      try {
        durumDegisti();
      } catch {
        /* dinleyici hatası istemciyi etkilemesin */
      }
    }
    throw new HaHatasi('yerel-yasak', 403);
  }

  function disAdresMi(taban) {
    const ayar = ayarlarAl() ?? {};
    return !!ayar.disAdres && taban === ayar.disAdres && taban !== ayar.yerelAdres;
  }

  /**
   * Hata bütçesi kökeni (tur 5, K8): 'yerel' (ev içi, bu bilgisayarın LAN IP'si) | 'dis' (Cloudflare tüneli, evin internet IP'si);
   * adres ayarlardaki ikisinden biri değilse ya da ikisi aynıysa undefined (kesici bilinmeyen kökeni muhafazakâr işler).
   */
  function kokenTuru(taban) {
    const ayar = ayarlarAl() ?? {};
    if (!taban || (ayar.yerelAdres && ayar.yerelAdres === ayar.disAdres)) return undefined;
    if (taban === ayar.yerelAdres) return 'yerel';
    if (taban === ayar.disAdres) return 'dis';
    return undefined;
  }

  /**
   * Doğrulanmamış bir anahtar DIŞ adrese gidecekse ev içi adresin 403 durumu GÜNCEL olmalı (tur 3, K6): ana pencere zaten dış
   * adresteyse (aktifAdresAl kısayolu) adres seçimi yoklama yapmaz, `yerelYasakli` bayatlar ve koruma atlanırdı. Son ev içi
   * (anahtarsız) yoklama SECIM_GECERLILIK_MS'den eskiyse ya da hiç yoksa yenilenir; aynı anda tek yoklama.
   */
  async function yerelDurumunuTazele(taban, parmakIzi) {
    if ((parmakIzi && disIzni.has(parmakIzi)) || !disAdresMi(taban) || (parmakIzi && yetkiKesici.iyiMi(parmakIzi))) return;
    if (yerelYoklamaZamani !== null && simdi() - yerelYoklamaZamani < SECIM_GECERLILIK_MS && simdi() >= yerelYoklamaZamani) return;
    if (!yerelYoklaSuruyor) {
      const ayar = ayarlarAl() ?? {};
      yerelYoklaSuruyor = adresiYokla(ayar.yerelAdres, ayar.yerelZamanAsimiMs)
        .then((yerel) => {
          yerelYoklamaZamani = simdi();
          yerelYasakAyarla(yerel.yasak);
        })
        .catch(() => {})
        .finally(() => {
          yerelYoklaSuruyor = null;
        });
    }
    await yerelYoklaSuruyor;
  }

  /** Doğrulama bilgisini unutur (parmakIzi verilirse yalnız o anahtarın; verilmezse hepsi). Sonraki kimlikli istek TEK doğrulamayla başlar. */
  function dogrulamayiUnut(parmakIzi) {
    if (parmakIzi === undefined) {
      dogrulananlar.clear();
      return;
    }
    for (const k of [...dogrulananlar.keys()]) if (k.endsWith(`|${parmakIzi}`)) dogrulananlar.delete(k);
  }

  /**
   * HA bu (adres, anahtar) çiftini DOĞRULADI: GET /api/ yanıtı 200 ve {"message":"API running."} (dogrulamaGecidi) ya da WS auth_ok.
   * Tazelik başlar, kalıcı "doğrulanmış" işareti yazılır, belirsiz sayaç sıfırlanır. 404 ya da başka içerikli 200 buraya GELMEZ.
   */
  function dogrulandi(taban, parmakIzi) {
    if (yetkiKesici && parmakIzi) {
      dogrulananlar.set(`${taban}|${parmakIzi}`, simdi());
      belirsizSayaci.delete(parmakIzi);
      gecikmeSonrasi.delete(parmakIzi); // h-09: anahtar yeniden doğrulandı
      yetkiKesici.dogrulandi(parmakIzi);
    }
  }

  /**
   * Doğrulama dışı kimlikli REST yanıtı başarıyla alındı (2xx ve gövde JSON nesnesi/dizisi): belirsiz sayaçlar sıfırlanır ve
   * ZATEN taze olan doğrulamanın tazeliği uzar. Doğrulanmış işareti VERİLMEZ (yalnız dogrulandi verir).
   */
  function basariliYanit(taban, parmakIzi) {
    if (!yetkiKesici || !parmakIzi) return;
    if (tazeMi(taban, parmakIzi)) dogrulananlar.set(`${taban}|${parmakIzi}`, simdi());
    belirsizSayaci.delete(parmakIzi);
    gecikmeSonrasi.delete(parmakIzi); // h-09: HA bu anahtarla başarılı yanıt verdi
    yetkiKesici.belirsizSifirla(parmakIzi);
  }

  /**
   * Kimlikli işlem için küresel kapı (K1): ağa çıkmadan önce kesici denetlenir, kapı alınır (aynı anda en çok 1 işlem), kapı
   * alındıktan sonra kesici YENİDEN denetlenir (beklerken reddedilmiş/duraklatılmış/belirsiz kalmış olabilir). Reddedilirse kapı
   * bırakılır ve HaHatasi fırlar. `sonDenetim(taban)` (aday doğrulaması: hata bütçesi) kapı ALINDIKTAN SONRA çağrılır ve fırlatabilir:
   * beklerken başka bir isteğin 401'i sayacı artırdıysa aday ağa çıkmaz (tur 5, K10).
   * @returns {Promise<() => void>} işlem bitince çağrılacak bırakma işlevi (idempotent)
   */
  async function kapiAl(taban, parmakIzi, oncelik = 'normal', sonDenetim = null) {
    if (!yetkiKesici || !parmakIzi) return () => {};
    kesiciDenetle(taban, parmakIzi);
    const birak = await kapi.al({ oncelik });
    try {
      kesiciDenetle(taban, parmakIzi);
      if (sonDenetim) sonDenetim(taban);
    } catch (hata) {
      birak();
      throw hata;
    }
    return birak;
  }

  /** (adres, anahtar) çifti son DOGRULAMA_TAZELIK_MS içinde başarılı bir kimlikli yanıt aldı mı? */
  function tazeMi(taban, parmakIzi) {
    const zaman = dogrulananlar.get(`${taban}|${parmakIzi}`);
    if (zaman === undefined) return false;
    const yas = simdi() - zaman;
    return yas >= 0 && yas < DOGRULAMA_TAZELIK_MS;
  }

  /** Seçim önbelleğini unutur: ana pencerenin eski adresi yeniden doğrulanana kadar anahtarlı REST/WS oraya gitmez. */
  function secimiUnut() {
    apiSecimi = { adres: null, zaman: 0 };
    dogrulamaBekliyor = true;
    yerelYoklamaZamani = null; // ağ değişmiş olabilir: ev içi adresin 403 durumu yeniden öğrenilir
  }

  /** Kimlikli istekte zaman aşımı: sonuç BELİRSİZ (HA sayabilir). Soğuma boyunca o anahtarla hiçbir adrese istek çıkmaz. */
  function belirsizIsaretle(parmakIzi, koken) {
    const yeni = !belirsizMi(parmakIzi); // süren soğuma sırasında gelen (eşzamanlı) zaman aşımları soğumayı katlamaz
    if (yeni) {
      const sayi = (belirsizSayaci.get(parmakIzi) ?? 0) + 1;
      belirsizSayaci.set(parmakIzi, sayi);
      const sogumaMs = Math.min(BELIRSIZ_SOGUMA_MS * 2 ** (sayi - 1), BELIRSIZ_SOGUMA_TAVAN_MS);
      belirsizler.set(parmakIzi, simdi() + sogumaMs);
      gunluk(`Kimlikli istek yanıtsız kaldı (zaman aşımı ya da gönderimden sonra kopma); sonuç belirsiz, ${sogumaMs / 1000} sn boyunca bu anahtarla istek gönderilmeyecek.`);
      yetkiKesici.belirsizKaydet(parmakIzi, koken); // KALICI sayaç: sınır aşılırsa kullanıcı "Yeniden dene" diyene kadar istek yok; isteğin gittiği kökenin hata bütçesi de artar (K11)
    }
    dogrulamayiUnut(parmakIzi);
    secimiUnut(); // soğuma sonrası adres yeniden (kimliksiz) yoklanır
  }

  /**
   * h-09 (1.2.0): TAZE doğrulanmış anahtarla giden servis çağrısı (POST) zaman aşımına uğradı. Kullanıcıya "komut gönderildi, yanıt
   * gecikti" denir ve 30 sn soğuma UYGULANMAZ (sonraki eylemler hemen çalışır). Yetki kesicinin güvencesi korunur:
   *  - deneme kesicide yine ASKIDA belirsiz sayılır (belirsizKaydet): anahtar bu arada iptal edildiyse HA saymış olabilir; anahtar
   *    geçerliyse bir sonraki başarılı doğrulamada düşer. Böylece anahtar başına hatalı deneme sınırı (K2) aynen işler.
   *  - doğrulama unutulur: sonraki kimlikli istek ÖNCE tek doğrulamayla (GET /api/, "yolda" işaretli) gider;
   *  - kapıda bekleyen, doğrulama geçidinden önceden geçmiş istekler gönderilmez (gecikmeSonrasi);
   *  - adres seçimi de unutulur (secimiUnut, soğumasız): sonraki istek ve doğrulama, 5 dk'lık ana pencere kısayolundan ya da seçim
   *    önbelleğinden gitmez; adres önce ANAHTARSIZ (/manifest.json) yoklanır. Ağ bu arada değişmişse (aynı IP'de HA olmayan bir cihaz)
   *    anahtarlı doğrulama isteği (GET /api/) doğrulanmamış bir adrese gitmez. Yoklama ucuzdur ve anahtar taşımaz.
   */
  function servisGecikti(parmakIzi, koken) {
    gunluk('Servis çağrısının yanıtı gecikti (anahtar tazeydi): komut gönderildi, sonuç bilinmiyor; sonraki istek önce adres yoklanıp doğrulanacak.');
    yetkiKesici.belirsizKaydet(parmakIzi, koken);
    dogrulamayiUnut(parmakIzi);
    gecikmeSonrasi.add(parmakIzi);
    secimiUnut(); // soğuma YOK (belirsizIsaretle'den farkı): yalnız adres bir sonraki istekte kimliksiz yeniden yoklanır
  }

  function adresEtiketi(taban) {
    const ayar = ayarlarAl() ?? {};
    return taban === ayar.yerelAdres ? 'ev içi adres' : taban === ayar.disAdres ? 'dış adres' : 'adres';
  }

  /** 403: o adrese kimlikli istekler duraklatılır ve doğrulama bilgisi unutulur (duraklatma bitince yine tek doğrulama gider). */
  function adresiDuraklat(taban) {
    if (!yetkiKesici) return;
    yetkiKesici.duraklat(taban, adresEtiketi(taban));
    for (const k of [...dogrulananlar.keys()]) if (k.startsWith(`${taban}|`)) dogrulananlar.delete(k);
  }

  /**
   * Tek kimlikli (ya da kesicisiz) HTTP isteği. Ağa çıkmadan önce kesiciden ve uçuş sınırından geçer. Yanıtın DURUMU gövdeden ve
   * gövde iptalinden bağımsız değerlendirilir: başlık gelmişse bu istek ağ hatası sayılmaz (401/403/2xx ne ise odur).
   */
  async function tekIstek(taban, yol, yontem, govde, anahtar, { zamanAsimiMs = API_ZAMAN_ASIMI_MS, dogrulama = false, oncelik = 'normal', sonDenetim = null } = {}) {
    if (!anahtarIcinGuvenliAdresMi(taban)) {
      // Savunma derinliği: ayar dosyası elle düzenlenmiş olsa bile anahtar herkese açık bir ada düz http ile gitmez.
      gunluk('Erişim anahtarı ev ağı dışındaki http adresine gönderilmedi.');
      throw new HaHatasi('baglanti');
    }
    const parmakIzi = yetkiKesici ? yetkiKesici.parmakIzi(anahtar) : null;
    // Öncelik (tur 4): kullanıcı eylemi (POST) ve doğrulama isteği, bekleyen toplu durum GET'lerinin önüne geçer (sınır yine 1).
    const birak = await kapiAl(taban, parmakIzi, dogrulama || yontem !== 'GET' || oncelik === 'yuksek' ? 'yuksek' : 'normal', sonDenetim); // ağa çıkmadan hemen önce kesici denetimi + küresel kapı (aynı anda en çok 1)
    let yoldaIsaretli = false;
    try {
      // h-09: taze anahtarla giden bir servis çağrısı yanıtsız kaldıysa, kapıda bekleyen (doğrulama geçidinden ÖNCE geçmiş) istek
      // gönderilmez; yeni istekler önce tek doğrulamadan geçer (başarılı doğrulama işareti temizler).
      if (yetkiKesici && parmakIzi && !dogrulama && gecikmeSonrasi.has(parmakIzi)) throw new HaHatasi('belirsiz');
      const taze = !!(yetkiKesici && parmakIzi) && tazeMi(taban, parmakIzi);
      // Tur 6: doğrulama ve doğrulanmamış/taze olmayan her kimlikli istek ağa çıkmadan ÖNCE kalıcı "yolda" işareti yazar. Süreç yanıt
      // gelmeden ölürse (kapanış, çökme, güncelleme) bir sonraki açılış bunu belirsiz deneme sayar: her açılış yeni bir deneme atmaz.
      if (yetkiKesici && parmakIzi && (dogrulama || !taze)) {
        if (!yetkiKesici.yoldaBaslat(parmakIzi, kokenTuru(taban))) throw new HaHatasi('dogrulanamadi'); // işaret yazılamadı: istek ağa çıkmaz
        yoldaIsaretli = true;
      }
      const tazeServis = taze && !dogrulama && yontem !== 'GET'; // h-09: anahtar az önce doğrulandı ve bu bir servis çağrısı (POST)
      return await istekGonder(taban, yol, yontem, govde, anahtar, parmakIzi, zamanAsimiMs, dogrulama, tazeServis);
    } finally {
      if (yoldaIsaretli) yetkiKesici.yoldaBitir(parmakIzi); // kesin sonuç (yanıt başlığı / gönderim öncesi hata); belirsizse zaten sayaca döndü
      birak();
    }
  }

  async function istekGonder(taban, yol, yontem, govde, anahtar, parmakIzi, zamanAsimiMs, dogrulama, tazeServis = false) {
    const url = new URL(yol, taban).toString();
    let sonuc;
    let alinanDurum = null; // yanıt BAŞLIĞI geldiği anda yazılır
    try {
      sonuc = await zamanAsimiIle(zamanAsimiMs, async (signal) => {
        const yanit = await fetch(url, {
          method: yontem,
          signal,
          credentials: 'omit',
          redirect: 'error', // anahtarlı istek başka bir adrese yönlenmesin
          headers: {
            Authorization: `Bearer ${anahtar}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: govde === undefined ? undefined : JSON.stringify(govde),
        });
        alinanDurum = yanit.status;
        if (alinanDurum === 401 || alinanDurum === 403 || BELIRSIZ_SUNUCU_DURUMLARI.has(alinanDurum)) {
          // Gövde iptali BEKLENMEZ (yavaş iptal 8 sn'lik yarışı kaybettirip 401'i "bağlantı hatası" yapmasın).
          try {
            Promise.resolve(yanit.body?.cancel()).catch(() => {});
          } catch {
            /* gövde zaten kapalı */
          }
          return { durum: alinanDurum, metin: '' };
        }
        return { durum: alinanDurum, metin: await yanit.text() };
      });
    } catch (hata) {
      // Ağ hatalarının ayrıntısı dışarı taşınmaz; yalnız tür bilgisi.
      if (!(yetkiKesici && parmakIzi)) throw hata instanceof HaHatasi ? hata : new HaHatasi('baglanti');
      if (alinanDurum === 401 || alinanDurum === 403 || BELIRSIZ_SUNUCU_DURUMLARI.has(alinanDurum)) {
        sonuc = { durum: alinanDurum, metin: '' }; // yanıt başlığı gelmişti: kaybolmaz
      } else if (alinanDurum !== null) {
        // HA yanıt verdi (başlık geldi) ama gövde okunamadı: bu bir ağ hatası DEĞİL; başka adrese/yeniden deneme yok. İçerik
        // doğrulanamadığı için (HA mı, ara katman mı) hiçbir doğrulama/başarı kaydı yapılmaz.
        throw new HaHatasi('sunucu', alinanDurum);
      } else if (tazeServis && hata instanceof HaHatasi && hata.zamanAsimi) {
        // h-09: anahtar az önce doğrulanmışken servis çağrısı zaman aşımına uğradı: büyük olasılıkla HA komutu çalıştırıyor (uzun sahne).
        servisGecikti(parmakIzi, kokenTuru(taban));
        throw new HaHatasi('gecikti');
      } else if ((hata instanceof HaHatasi && hata.zamanAsimi) || !gonderimOncesiHatasiMi(hata)) {
        // Yanıt gelmeden süre doldu ya da istek gönderildikten sonra koptu: HA isteği işlemiş (hatalıysa saymış) olabilir.
        belirsizIsaretle(parmakIzi, kokenTuru(taban));
        throw new HaHatasi('belirsiz');
      } else {
        dogrulamayiUnut(parmakIzi); // istek HA'ya hiç ulaşmadı: bir sonraki kimlikli istek yeniden TEK doğrulamayla başlar
        throw hata instanceof HaHatasi ? hata : new HaHatasi('baglanti');
      }
    }
    const { durum, metin } = sonuc;
    if (durum === 401) {
      if (yetkiKesici) yetkiKesici.reddet(parmakIzi, 'HTTP_401', kokenTuru(taban)); // bu anahtarla bir daha HİÇBİR istek çıkmaz (kalıcı); hata bütçesi o kökende artar
      throw new HaHatasi('yetki', durum);
    }
    if (durum === 403) {
      adresiDuraklat(taban); // anahtar geçersiz DEĞİL (ban ya da Cloudflare engeli olabilir): yalnız o adres 15 dk durur
      throw new HaHatasi('yasak-erisim', durum);
    }
    if (durum === 404) throw new HaHatasi('bulunamadi', durum); // 404 HİÇBİR zaman doğrulama/başarı sayılmaz (ara katman da 404 verebilir)
    if (yetkiKesici && parmakIzi && BELIRSIZ_SUNUCU_DURUMLARI.has(durum)) {
      // Ağ geçidi hatası (vekil/Cloudflare): istek HA'ya ulaşmış, HA 401'i saymış ama yanıt kaybolmuş olabilir: belirsiz (K2 kuralları).
      belirsizIsaretle(parmakIzi, kokenTuru(taban));
      throw new HaHatasi('belirsiz', durum);
    }
    if (durum < 200 || durum >= 300) throw new HaHatasi('sunucu', durum);
    let sonuc2;
    try {
      sonuc2 = metin ? JSON.parse(metin) : null;
    } catch {
      throw new HaHatasi('sunucu', durum);
    }
    // HA içeriği: gövde JSON nesnesi/dizisi. Doğrulama isteğinde bu karar dogrulamaGecidi'ndedir ("API running." denetimi).
    if (!dogrulama && sonuc2 !== null && typeof sonuc2 === 'object') basariliYanit(taban, parmakIzi);
    return sonuc2;
  }

  /**
   * Tek doğrulama geçidi (G2): GET /api/ (200 ve {"message": "API running."}) bir anahtar için AYNI ANDA yalnız BİR kez gider
   * (adresler arası da tek: doğrulama sürerken adres değişirse diğer adres sırasını bekler). Sürerken gelen çağrılar aynı sözü
   * bekler ve kendi isteklerini atmaz. Başarısızlıkta aynı adresi bekleyenler aynı hatayı alır: 401 -> anahtar reddedilir (yetki
   * kesici, diğer adres de reddedilir), 403 -> adres duraklatılır, zaman aşımı -> belirsiz (soğuma). Doğrulama TAZE kalır:
   * son başarılı kimlikli yanıt DOGRULAMA_TAZELIK_MS'den eskiyse, adres/ağ değişince (secimiSifirla) ya da ağ hatasında yeniden
   * doğrulanır (iptal edilmiş anahtar paralel isteklerle HA sayacını doldurmasın). Kesici yoksa geçit yoktur.
   */
  async function dogrulamaGecidi(taban, anahtar, { sonDenetim = null } = {}) {
    if (!yetkiKesici) return;
    const parmakIzi = yetkiKesici.parmakIzi(anahtar);
    for (;;) {
      kesiciDenetle(taban, parmakIzi);
      if (tazeMi(taban, parmakIzi)) return;
      await yerelDurumunuTazele(taban, parmakIzi); // dış adrese gidecek doğrulanmamış anahtar: ev içi 403 durumu güncel olsun
      kesiciDenetle(taban, parmakIzi);
      if (tazeMi(taban, parmakIzi)) return;
      const suren = dogrulamaSurenler.get(parmakIzi);
      if (!suren) break;
      if (suren.taban === taban) {
        await suren.soz; // aynı adres: sonuç (hata dahil) aynen paylaşılır
      } else {
        try {
          await suren.soz; // başka adreste doğrulama sürüyor: bitmesini bekle (paralel gitme)
        } catch {
          /* kesin sonuç (401/belirsiz) denetimle yansır; başka bir hata ise bu adres sırayla kendi doğrulamasını yapar */
        }
      }
    }
    const soz = (async () => {
      const ayar = ayarlarAl() ?? {};
      const zamanAsimiMs = taban === ayar.disAdres && taban !== ayar.yerelAdres ? DOGRULAMA_ZAMAN_ASIMI_DIS_MS : DOGRULAMA_ZAMAN_ASIMI_YEREL_MS;
      let yanit;
      try {
        yanit = await tekIstek(taban, '/api/', 'GET', undefined, anahtar, { zamanAsimiMs, dogrulama: true, sonDenetim });
      } catch (hata) {
        if (hata?.tur === 'bulunamadi') throw new HaHatasi('sunucu', 404); // 404 doğrulama sayılmaz
        throw hata;
      }
      if (!yanit || typeof yanit !== 'object' || yanit.message !== 'API running.') throw new HaHatasi('sunucu', 200); // HA değil
      dogrulandi(taban, parmakIzi); // YALNIZ burada: 200 + {"message":"API running."}
    })().finally(() => {
      if (dogrulamaSurenler.get(parmakIzi)?.soz === soz) dogrulamaSurenler.delete(parmakIzi);
    });
    dogrulamaSurenler.set(parmakIzi, { taban, soz });
    await soz;
    kesiciDenetle(taban, parmakIzi); // doğrulama sürerken başka bir yolla reddedilmiş ya da duraklatılmış olabilir
  }

  /**
   * HA REST API isteği. GET isteklerinde bağlantı hatası olursa adres yeniden seçilip bir kez daha denenir (adres değiştirme
   * nedeni YALNIZ ağ hatasıdır; 401/403 değildir). POST (servis çağrısı) asla tekrarlanmaz: aç/kapa iki kez çalışmasın.
   * Kimlikli istek önce yetki kesiciden ve tek doğrulama geçidinden geçer.
   */
  async function haIstek(yol, { yontem = 'GET', govde, anahtar, oncelik = 'normal' } = {}) {
    const kullanilacakAnahtar = anahtar ?? (await anahtarAl());
    if (!kullanilacakAnahtar) throw new HaHatasi('anahtar-yok');
    kesiciDenetle(undefined, yetkiKesici ? yetkiKesici.parmakIzi(kullanilacakAnahtar) : null); // reddedilmiş anahtarla adres yoklaması bile yapılmaz

    let taban = await apiTabaniBul();
    // h-19: zorla ikinci seçim YALNIZ başarısız seçimin bekleme penceresi dışındaysa (az önce yapılan seçim başarısızsa iki kat yoklama yok).
    if (!taban && !secimBeklemesindeMi()) taban = await apiTabaniBul(true);
    if (!taban) throw new HaHatasi('baglanti');
    const dene = async (hedef) => {
      await dogrulamaGecidi(hedef, kullanilacakAnahtar);
      return tekIstek(hedef, yol, yontem, govde, kullanilacakAnahtar, { oncelik });
    };
    try {
      return await dene(taban);
    } catch (hata) {
      if (hata.tur !== 'baglanti' || yontem !== 'GET') throw hata;
      const yeniTaban = await apiTabaniBul(true);
      if (!yeniTaban) throw hata;
      return dene(yeniTaban); // yeni adres de önce tek doğrulamadan geçer
    }
  }

  /**
   * Ayarlar'da yeni anahtar kaydı (G6): TEK istek (GET /api/). Başarıdan sonra aynı (adres, anahtar) çifti doğrulanmış sayılır;
   * kayıttan sonraki toplu istekler ve canlı bağlantı yeniden doğrulamaz. 401 -> anahtar reddedilir ve HaHatasi('yetki') fırlar.
   * Hata bütçesi >= 2 (isteğin gideceği kökende) ya da kesici kaydı güvenilmezse AÇIK ikinci onay (`onay: {sayi}`: ana sürecin
   * tek kullanımlık bileti harcandıktan sonra, onaylanan sayaç) olmadan istek HİÇ gönderilmez (HaHatasi('ikinci-onay', 0, {neden, sayi, kayit?})).
   * Onay yalnız onaylanan sayaca kadar geçerlidir: kapı alındıktan sonra sayaç arttıysa (başka bir istek 401 aldı) yeniden 'ikinci-onay'.
   * Aday anahtar (saklı değil) bütçeden muaf değildir: daha önce doğrulanmış olması onu muaf tutmaz.
   */
  async function anahtariDogrula(anahtar, { onay = null } = {}) {
    if (!yetkiKesici) {
      await haIstek('/api/', { anahtar });
      return;
    }
    const parmakIzi = yetkiKesici.parmakIzi(anahtar);
    if (yetkiKesici.reddedildiMi(parmakIzi)) throw new HaHatasi('reddedildi');
    const onayliSayi = onay && typeof onay === 'object' && Number.isInteger(onay.sayi) ? onay.sayi : null;
    const onayDenetle = (koken) => {
      const gerek = yetkiKesici.onayGerekliMi(parmakIzi, { koken });
      if (gerek && (onayliSayi === null || (gerek.neden === 'hata-butcesi' && gerek.sayi > onayliSayi))) throw new HaHatasi('ikinci-onay', 0, gerek);
      return gerek;
    };
    const gerek = onayDenetle(undefined); // köken henüz bilinmiyor: en yüksek sayaç
    // Kullanıcı açıkça onayladı: güvenilmez kayıt kapısı KÜRESEL açılmaz (tur 4, K5); yalnız BU parmak izinin tek doğrulaması geçer.
    // Aday 401 alsa bile saklı anahtar "Yeniden Dene" olmadan ağa çıkmaz; küresel onayı aday kaydedilince main.js temizler.
    const biletiBirak = gerek ? yetkiKesici.onayBileti(parmakIzi) : () => {};
    try {
      kesiciDenetle(undefined, parmakIzi);
      let taban = await apiTabaniBul();
      if (!taban && !secimBeklemesindeMi()) taban = await apiTabaniBul(true); // h-19
      if (!taban) throw new HaHatasi('baglanti');
      // Kapı alındıktan SONRA (tekIstek) bütçe isteğin gideceği kökende yeniden denetlenir (tur 5, K10).
      await dogrulamaGecidi(taban, anahtar, { sonDenetim: (hedef) => onayDenetle(kokenTuru(hedef)) });
    } finally {
      biletiBirak();
    }
  }

  return {
    adresSec,
    apiTabaniBul,
    haIstek,
    anahtariDogrula,
    /**
     * Canlı bağlantı (src/ha-ws.js) için kesici köprüsü: soketi açmadan önce tek doğrulama, auth iletisinden önce ve
     * auth_invalid sonrasında kesici denetimi. Kesici yoksa null (eski davranış).
     */
    wsYetkisi: yetkiKesici
      ? {
          parmakIzi: (anahtar) => yetkiKesici.parmakIzi(anahtar),
          reddedildiMi: (parmakIzi) => yetkiKesici.reddedildiMi(parmakIzi),
          dogrulanamadiMi: (parmakIzi) => yetkiKesici.dogrulanamadiMi(parmakIzi),
          engelliMi: (parmakIzi, taban) => !yetkiKesici.karar({ parmakIzi, taban }).izin || belirsizMi(parmakIzi),
          taze: (taban, parmakIzi) => tazeMi(taban, parmakIzi),
          gecit: (taban, anahtar) => dogrulamaGecidi(taban, anahtar),
          reddedildi: (parmakIzi, taban) => yetkiKesici.reddet(parmakIzi, 'WS_AUTH_INVALID', kokenTuru(taban)),
          // canlı bağlantı koptu (anahtar iptal edilmiş olabilir): doğrulama unutulur. h-08: bağlantı CANLIYDIYSA ağ değişmiş olabilir:
          // adres seçimi de unutulur (yeniden bağlanma ve REST yedeği önce anahtarsız yoklar; eski adrese anahtarla gidilmez).
          koptu: (canliydi = false) => {
            dogrulamayiUnut();
            if (canliydi === true) secimiUnut();
          },
          // Küresel kapı: auth iletisinden ÖNCE alınır, auth_ok/auth_invalid ya da soket kapanışına kadar tutulur (ha-ws.js).
          kapiAl: (taban, parmakIzi) => kapiAl(taban, parmakIzi, 'yuksek'), // WS auth toplu GET'lerin önüne geçer (tur 4)
          // auth gönderildi ama auth_ok/auth_invalid gelmeden soket koptu: HA saymış olabilir (belirsiz deneme).
          belirsiz: (parmakIzi, taban) => {
            belirsizIsaretle(parmakIzi, kokenTuru(taban));
            yetkiKesici.yoldaBitir(parmakIzi); // soğuma sürerken sayaca yazılmadıysa da işaret kalmasın
          },
          // auth iletisinden ÖNCE kalıcı "yolda" işareti (tur 6); false: işaret yazılamadı, auth gönderilmez.
          yoldaBaslat: (parmakIzi, taban) => yetkiKesici.yoldaBaslat(parmakIzi, kokenTuru(taban)),
          yoldaBitir: (parmakIzi) => yetkiKesici.yoldaBitir(parmakIzi),
          // auth_ok: HA anahtarı kabul etti; REST doğrulaması taze sayılır, HA'nın IP başına hatalı sayacı sıfırlanır (hata bütçesi de).
          onaylandi: (taban, parmakIzi) => {
            dogrulandi(taban, parmakIzi);
            yetkiKesici.girisBasarili(kokenTuru(taban)); // YALNIZ bu kökenin sayacı (HA sayacı IP başına: ev içi giriş evin internet IP'sini temizlemez)
          },
        }
      : null,
    /** Anahtar değişti ya da silindi: doğrulama bilgisi unutulur (yeni anahtar yeniden tek doğrulamayla başlar). */
    dogrulamayiSifirla() {
      dogrulananlar.clear();
      belirsizler.clear();
      belirsizSayaci.clear();
      gecikmeSonrasi.clear();
      disIzni.clear();
      if (engelTetiklendi) {
        engelTetiklendi = false;
        durumDegisti();
      }
    },
    /** Engel durumu (Ayarlar/tepsi/panel için): 'yerel-yasak' = ev içi 403 yüzünden doğrulanmamış anahtar dış adrese gönderilmedi. */
    engelDurumu: () => (engelTetiklendi ? 'yerel-yasak' : null),
    /**
     * Kullanıcı Ayarlar'da "Yeniden dene" dedi: YALNIZ onaylanan parmak izi (saklı anahtar) bu oturumda ev içi 403 iken de dış adrese
     * gidebilir (tur 5, K9: başka/yeni aday kendi açık onayı olmadan gitmez); belirsiz (yanıtsız) soğuma sıfırlanır (kalıcı sayaç
     * yetki kesicide: yetkiKesici.yenidenDene()).
     */
    disIzniVer(parmakIzi) {
      if (typeof parmakIzi === 'string' && parmakIzi) disIzni.add(parmakIzi);
      belirsizler.clear();
      belirsizSayaci.clear();
      if (engelTetiklendi) {
        engelTetiklendi = false;
        durumDegisti();
      }
    },
    /** Seçim önbelleğini unut (ağ değişti, adres ayarı değişti, sayfa bozuk yanıt verdi). */
    secimiSifirla() {
      secimiUnut();
      dogrulananlar.clear(); // uyanış/ağ/adres değişimi: önceki doğrulama GEÇERSİZ (anahtar bu arada iptal edilmiş olabilir)
    },
    /** Bağlantı akışı bir adres seçtiyse API de aynı adresi kullansın. */
    secimiAyarla(adres) {
      apiSecimi = { adres: adres ?? null, zaman: simdi() };
      aktifKisayolOnayla(adres); // h-08: ana pencere bu (az önce anahtarsız yoklanmış) adrese taşınıyor
    },
    yereleDonusYokla,
  };
}

module.exports = {
  API_ZAMAN_ASIMI_MS,
  DOGRULAMA_ZAMAN_ASIMI_YEREL_MS,
  DOGRULAMA_ZAMAN_ASIMI_DIS_MS,
  AKTIF_KISAYOL_GECERLILIK_MS,
  YERELE_DONUS_YOKLAMA_MS,
  HaHatasi,
  hataMetni,
  zamanAsimiIle,
  haIstemcisiOlustur,
};
