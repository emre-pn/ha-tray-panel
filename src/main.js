'use strict';

/**
 * Ev Paneli — Home Assistant için hızlı kontrol paneli (Electron ana süreç).
 *
 * Güvenlik özeti
 *  - Tüm pencereler: contextIsolation, sandbox, nodeIntegration kapalı, webSecurity açık.
 *  - Ana pencere yalnız ayar dosyasındaki iki kökende (ev içi + dış adres) gezinir;
 *    diğer bağlantılar varsayılan tarayıcıda açılır.
 *  - HA REST API çağrıları yalnız bu süreçte yapılır. Erişim anahtarı safeStorage
 *    (Windows DPAPI) ile şifreli dosyada durur, hiçbir renderer'a gönderilmez,
 *    hiçbir log/hata mesajına yazılmaz.
 *  - Kapı, kilit, alarm, garaj, bariyer ve gate/lock varlıkları favori olamaz, hiçbir yüzeyden çalıştırılamaz
 *    (src/lib/suzgec.js). Geri alınması zor eylemler (PC kapat vb.) onay ister (src/lib/eylem-sinifi.js).
 *  - Tepsi menüsü, hızlı panel, komut paleti, eylem kısayolları ve komut satırı (--eylem=) tek güvenli eylem hattından
 *    geçer (src/eylem.js, src/lib/eylem-hatti.js); servis çağrısı yalnız orada yapılır.
 *  - Canlı durum için tek WebSocket ana süreçtedir (src/ha-ws.js); anahtar yalnız o bağlantının auth iletisinde geçer.
 *  - Yetki kesici (src/lib/yetki-kesici.js): Home Assistant bir anahtarı reddederse (401 / auth_invalid) o anahtarla HİÇBİR
 *    adrese istek gitmez (kalıcı; ip_ban tetiklenmesin). Kimlikli istekten önce tek doğrulama gider, 403 adresi 15 dk durdurur.
 *    Kimlikli her ağ işlemi (REST + WS auth) tek küresel kapıdan geçer, aynı anda en çok 1 (src/lib/kimlikli-kapi.js).
 *    Yanıtsız (belirsiz) denemeler kalıcı sayılır (doğrulanmamış anahtarda 1., doğrulanmışta 2.'de durur: "Yeniden Dene"), IP başına
 *    hata bütçesi (>= 2 hatalı deneme) yeni anahtar için açık ikinci onay ister, okunamayan/bozuk kesici kaydı da onaya bağlar,
 *    ev içi 403'te doğrulanmamış anahtar dış adrese gitmez, kayıt yazılamazsa saklı anahtar dosyası kenara alınır.
 *  - Günlük dosyası sır içermez (src/lib/gunluk.js); yerel sayfalar CSP'li ve satır içi betiksizdir.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process'); // yalnız toplantı ışığının salt okunur `reg query` çağrısı (src/dis-tetikler.js regSorgulayiciOlustur)
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
} = require('electron');

const { kokenAl } = require('./lib/dogrulama');
const { alanAl, adGuvenliMi, guvenliVarlikMi } = require('./lib/suzgec');
const { VARSAYILAN_KISAYOL, VARSAYILAN_PALET_KISAYOLU, kisayolGoster, kisayolNormallestir, kisayolUyarilari, kisayolPlani } = require('./lib/kisayol');
const { EN_COK_ENGELLENEN, SEMA_SURUMU, ayarlariDuzelt } = require('./lib/ayar-sema');
const { aktarilanAlanlar, ekAyarlariUygula, ekAyarOzeti, ekGirdiDogrula } = require('./lib/ayar-alanlari');
const { ayarGirdisiniDogrula, kisayolKaydiSonrasiUyarilar } = require('./lib/ayar-kaydet');
const { gocOncesiYedegiAl, hataliAlanYedegiAl, yedekDosyaAdi } = require('./lib/ayar-yedegi');
const { eskiSurumYedeginiDevral } = require('./lib/yedek-kurtarma');
const { ayarAktariciOlustur } = require('./lib/ayar-aktar');
const { adresSinayiciOlustur } = require('./lib/adres-sina');
const { sayfaYanitiBozukMu } = require('./lib/yoklama');
const { bekleSn } = require('./lib/geri-cekilme');
const { yolGecerliMi, sayfaYolu, gizliKalmaAsildiMi, gecmisOffseti } = require('./lib/gezinti');
const { PENCERE_BOYUTLARI, ortala, pencereKaydiHesapla, anaPencereHedefi, pencereKonumKaydiHesapla, tercihEkranBul, tercihKaydiOlustur, opaklikOrani } = require('./lib/pencere-yerlesim');
const { ODAK_KAYBI_GECIKME_MS, tiklamaKarari, odakKaybiGizlensinMi } = require('./lib/pencere-davranisi');
const { tusEylemi, yakinlastirmaDegistir } = require('./lib/tus-eylemi');
const { oturumAcilisiDurumu } = require('./lib/oturum-acilisi');
const { kisalt } = require('./lib/metin');
const { DIL_AYARLARI, dilCoz, cevirmen, cogul } = require('./lib/dil');
const ANA_SOZLUK = require('./lib/ceviri/ana');
const { gunlukOlustur } = require('./lib/gunluk');
const { anahtarDeposuOlustur } = require('./lib/anahtar-deposu');
const { ustbilgiDeposuOlustur } = require('./lib/ozel-ustbilgi');
const { baglantiYoneticisiOlustur } = require('./baglanti-yoneticisi');
const { sertifikaDeposuOlustur } = require('./lib/sertifika-deposu');
const { sertifikaYoneticisiOlustur } = require('./sertifika-yoneticisi');
const { oauthYoneticisiOlustur, birlesikAnahtarDeposuOlustur } = require('./oauth-yoneticisi');
const { esitlemeYoneticisiOlustur } = require('./esitleme-yoneticisi');
const { yetkiKesiciOlustur } = require('./lib/yetki-kesici');
const { onayBiletiDeposuOlustur } = require('./lib/onay-bileti');
const { sinirliEszamanli } = require('./lib/sinirli-eszamanli');
const { cokmeSayilirMi, cokmeNedeniMetni, cokmeKarari } = require('./lib/cokme-siniri');
const { SINIF, eylemSinifi, adayGizliMi, onayAciklamasi } = require('./lib/eylem-sinifi');
const { HAZIR_LISTE_SURUMU, favorileriBirlestir, hazirListeUygula, onayiDuzelt } = require('./lib/favoriler');
const { durumDeposuOlustur } = require('./lib/durum-deposu');
const { YARDIMCI_VARLIKLAR, karolariOlustur, yuzeyModeliOlustur } = require('./lib/yuzey-modeli');
const { tepsiMenuPlani, acikIsikSayisi, ipucuMetni, ekranMenuPlani, ekranEtiketi } = require('./lib/tepsi-menu');
const { bilgiKimlikleri, bilgiKaydi, bilgiModeliOlustur, bilgiBolumunuEkle, bilgiKarolari, sensorUyariSayisi } = require('./lib/bilgi-modeli');
const { kapaklariKapat } = require('./lib/medya-kapagi');
const { malzemeDestekliMi, pencereMalzemesi } = require('./lib/malzeme');
const { temaKaynagi, etkinSema, sistemKoyuMu, ozelPalet, gorunumModeli, metinOlcegiOrani } = require('./lib/gorunum');
const { sonKullanilanlarOlustur } = require('./lib/son-kullanilanlar');
const { komutSatiriEylemi, eylemIstendiMi, pencereDurumKomutu, eylemKaynagi, protokolArgumani, disIstegi } = require('./lib/komut-satiri');
const { GUC_OLAYLARI } = require('./lib/pc-olaylari');
const { durumBelgesiOlustur, ciktiYoluCoz, durumDosyasiYaz } = require('./lib/komut-durum');
const { surumDenetleyicisiOlustur, dosyaDeposu: surumDeposu, SURUM_SAYFASI, DURUM_DOSYASI: SURUM_DURUM_DOSYASI } = require('./lib/surum-denetimi');
const { guncellemeYoneticisiOlustur, destekDurumu: guncellemeDestekDurumu, DURUM_DOSYASI: GUNCELLEME_DURUM_DOSYASI } = require('./lib/guncelleme');
const { yenilikleriAyikla } = require('./lib/yenilikler');
const { yazimDenetiminiKapat } = require('./lib/yazim-denetimi');
const { raporOlustur, gunlukSonSatirlari } = require('./lib/tanilama');
const { odaOnerileri } = require('./lib/oda-kurulum');
const { tekrarEngeliOlustur } = require('./lib/tekrar-engeli');
const { durumlariSuz, durumuDuzelt } = require('./lib/ha-ws-protokol');
// Kullanıcıya giden metinler arayüz diline göre t('...') ile (src/lib/ceviri/ana.js) alınır; bu modülden yalnız parametreli işlevler gelir.
const {
  AD_SINIRI,
  alanlarSifirlandiMetni,
  anaKisayolAlinamadiMetni,
  ekKisayollarUygulanamadiMetni,
  kisayolSifirlandiMetni,
  semaDahaYeniMetni,
  eskiSurumYedegiMetni,
  HTTP_ANAHTAR_GUNLUK_SATIRI,
  ayarDosyasiBozukMetni,
  ikinciOnayMetni,
  merkezKoseMetni,
} = require('./lib/bildirim-metni');
const { HaHatasi, hataMetni, haIstemcisiOlustur, YERELE_DONUS_YOKLAMA_MS } = require('./ha-istemcisi');
const { guvenliWebTercihleri, yerelOlaydanMi, yerelPencereOlustur } = require('./yerel-pencere');
const { koseBildirimiOlustur } = require('./kose-bildirim');
const { itmeKartiOlustur } = require('./itme-kart');
const { mobilKayitOlustur } = require('./lib/mobil-kayit');
const { haWsOlustur } = require('./ha-ws');
const { haOkumaOlustur } = require('./lib/ha-okuma');
const { bildirimAkisiOlustur } = require('./lib/bildirim-akisi');
const { kapatilanDeposuOlustur } = require('./lib/bildirim-merkezi');
const { UYARI_ALANLARI, durumOnerileri, alanSimgesi } = require('./lib/uyari-kurallari');
const { karoAlaniMi, alanSirasi, varsayilanServis } = require('./lib/alan-kaydi');
const { kisayolEylemSecenekleri } = require('./lib/yonlu-eylem');
const { eylemKatmaniOlustur } = require('./eylem');
const { saatMetni: kullaniciSaatMetni } = require('./lib/bilgi-bicim'); // 1.4.0 eylem grubu (o-15): gecikmeli eylem bildirimindeki saat, Ayarlar > Saat biçimiyle
const { favoriListesineEkle } = require('./lib/diger-cihazlar'); // 1.4.0 eylem grubu (o-46): palet "Favoriye ekle"
const { eylemEkleriOlustur } = require('./lib/eylem-ekleri'); // 1.4.0 eylem grubu: etkinlik geçmişi, geri al, gecikmeli eylem, son değişenler, oda, diğer cihazlar
const { yuzeyYoneticisiOlustur } = require('./yuzey-yoneticisi');
const { kameraServisiOlustur, kameraAdaylari, kameraModeli, kameraIzinleriniDuzelt, EN_BUYUK_GORUNTU_BAYT } = require('./lib/kamera'); // 1.4.0 cihaz grubu (o-48)
const { disTetiklerOlustur, regSorgulayiciOlustur, DINLENEN_AYARLAR: DIS_AYAR_ALANLARI } = require('./dis-tetikler');
const { duzenGecmisiOlustur } = require('./lib/duzen-gecmisi');
const { duzenYoneticisiOlustur } = require('./lib/duzen-yoneticisi');
// 1.4.0 pencere grubu: tepsi rozeti (o-27), masaüstü karoları (o-33), ekran özeti (o-32)
const { tepsiRozetiOlustur } = require('./tepsi-rozeti');
const { masaustuKarolariOlustur } = require('./masaustu-karolari');
const { sabitlenecekKarolar, masaustuKaroModeli, sabitlenebilirKimlikMi } = require('./lib/masaustu-karo');
const { ekranOzetleriAl } = require('./lib/ekran-ozeti');
// 1.4.0 etkileşim grubu: basılı tutunca göster (o-60), bağlantı bildirimi (o-38); tepsi orta tık (o-20) eylem katmanındadır
const { basiliTutOlustur } = require('./lib/basili-tut');
const { ORTA_TIK_ALANLARI } = require('./lib/orta-tik');
const { baglantiBildirimiOlustur } = require('./lib/baglanti-bildirimi');

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

// UYGULAMA_ADI yalnız veri klasörü, ayar kimliği ve Windows başlangıç kaydı adıdır (çevrilmez: ayar klasörü değişmesin). Ekrana giden ad uygulamaAdi() ile alınır
// (Türkçede 'Ev Paneli', İngilizcede 'Home Panel').
const UYGULAMA_ADI = 'Ev Paneli';
const UYGULAMA_KIMLIGI = 'io.github.emre-pn.evpaneli'; // electron-builder.yml içindeki appId ile aynı
const HA_BOLUMU = 'persist:ha';
const GIZLI_BASLAT_ARG = '--gizli';
const FAVORI_YENILEME_MS = 60_000; // canlı bağlantı YOKKEN (REST yedeği) durum yenileme aralığı
const REST_TEK_ISTEK_SINIRI = 25; // izlenen varlık bundan çoksa tek /api/states isteği, değilse varlık başına istek
const REST_ESZAMANLILIK = 4; // varlık başına isteklerde çalışan sayısı; kimlikli kapı (K1) bunları zaten SIRAYA dizer (aynı anda ağda en çok 1)
const OTURUM_KAPANMA_BEKLEME_MS = 15_000; // query-session-end sonrası session-end gelmezse oturum kapatma iptal edilmiş sayılır
const COKME_KAYIT_SINIRI = 20;
const UYKU_SICRAMA_ESIGI_MS = 3 * 60_000; // 60 sn'lik zamanlayıcı iki turu arasında bundan fazla saat atlarsa uyku/uyanış sayılır (Modern Standby; h-37)
const UYANIS_YENIDEN_DENEME_SN = [5, 15, 30]; // uyanışta yoklama başarısızsa sayfa HA'dayken bu sürelerle (sn) yeniden yoklanır (h-16)
const TEPSI_CIFT_TIK_MS = 500; // Windows çift tıklama süresi: tepsideki ikinci tık (çift tık) ilkiyle aynı tık sayılır, aç-kapa olmaz (k-17)
const AYAR_OKUMA_DENEME = 4; // ayar dosyası okunamazsa (kilit: EBUSY/EPERM...) bu kadar deneme, aralar AYAR_OKUMA_ARA_MS * deneme sayısı (h-10)
const AYAR_OKUMA_ARA_MS = 60;
const AYAR_YENIDEN_ADLANDIRMA_DENEME = 3; // geçici ayar dosyasını asıl dosyanın yerine koyarken kilit için kısa aralıklı deneme (h-32)
const AYAR_YENIDEN_ADLANDIRMA_ARA_MS = 40;
const AYARLAR_COKME_KAYIT_SINIRI = 10;

const KOK_DIZIN = path.join(__dirname, '..');
const IKON_ICO = path.join(KOK_DIZIN, 'assets', 'ikon.ico');
const IKON_PNG = path.join(KOK_DIZIN, 'assets', 'ikon.png');
// Bağlantı yokken tepsi simgesi (detay-18): gri tonlu, yarı saydam; dosya yoksa normal simge kullanılır (simge görünmez kalmasın).
const IKON_SOLUK_ICO = path.join(KOK_DIZIN, 'assets', 'ikon-soluk.ico');
const IKON_SOLUK = fs.existsSync(IKON_SOLUK_ICO) ? IKON_SOLUK_ICO : IKON_ICO;
const VARSAYILAN_AYAR_DOSYASI = path.join(KOK_DIZIN, 'varsayilan-ayarlar.json');
const PRELOAD = path.join(__dirname, 'preload.js');
const AYARLAR_HTML = path.join(__dirname, 'ayarlar.html');
const OFFLINE_HTML = path.join(__dirname, 'offline.html');

const HAZIR_YENIDEN_DENEME_MS = 90_000; // eksik kalan hazır karolar için yeniden deneme aralığı (oturum içi)
const HAZIR_YENIDEN_DENEME_SAYISI = 3;
const ODAK_ONPLAN_YEDEK_MS = 300; // pencere gösterildikten sonra hâlâ odaksızsa ön plana zorlamadan önce bekleme
const YERLESIM_SESSIZ_MS = 800; // programla yerleştirilen boyut/konum ayara yazılmasın

// Favori alanları, GÜVENLİK KURALI süzgeci ve kısayol doğrulaması src/lib/ altındadır
// (saf modüller; birim testleri test/ altında).

// ---------------------------------------------------------------------------
// Uygulama kimliği ve veri klasörü (ready'den ÖNCE ayarlanmalı)
// ---------------------------------------------------------------------------

app.setName(UYGULAMA_ADI);
// Geliştirme sürümü (npm start) kurulu sürümden AYRI klasör ve ayrı tek kopya kilidi kullanır:
// kurulu uygulama tepsideyken deneme sessizce kapanıp kurulu pencereyi öne getirmesin (hata-23).
// Taşınabilir derleme (o-45; electron-builder portable) kurulu sürümle AYNI klasörü ve aynı tek kopya kilidini kullanır: ayarlar, anahtar ve HA
// oturumu ortaktır; kurulu sürüm çalışırken taşınabilir exe yeni kopya açmaz, çalışanı öne getirir. Ayar klasörünü exe'nin yanına almak
// bilinçli olarak YAPILMADI: erişim anahtarı Windows kullanıcısına bağlı (DPAPI) şifrelenir, başka bilgisayarda çözülemez.
const VERI_KLASORU = app.isPackaged ? UYGULAMA_ADI : `${UYGULAMA_ADI} (gelistirme)`;
app.setPath('userData', path.join(app.getPath('appData'), VERI_KLASORU)); // %APPDATA%\Ev Paneli
app.setAppLogsPath(); // Windows'ta userData\logs

// Günlük dosyası (hata-06): <userData>\logs\ev-paneli.log, 256 KB'ta döner (tek yedek), sır içermez.
function gunlukDizini() {
  try {
    return app.getPath('logs');
  } catch {
    return path.join(app.getPath('userData'), 'logs');
  }
}
const gunlukKaydi = gunlukOlustur({ dizin: gunlukDizini(), konsol: true });

// Beklenmeyen hatalar YALNIZ adı/koduyla yazılır (ileti metni adres ya da sır içerebilir). Tepsi uygulaması çalışmaya devam eder.
function hataKimligi(hata) {
  const ad = typeof hata?.name === 'string' ? hata.name : 'bilinmeyen';
  return typeof hata?.code === 'string' ? `${ad} (${hata.code})` : ad;
}
process.on('uncaughtException', (hata) => gunlukKaydi.yaz(`Yakalanmamış hata: ${hataKimligi(hata)}`));
process.on('unhandledRejection', (neden) => gunlukKaydi.yaz(`İşlenmeyen söz reddi: ${hataKimligi(neden)}`));

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

let ayarlar = null;
let anaPencere = null;
let ayarlarPenceresi = null;
let tepsi = null;
let cikiliyor = false;
let ilkGosterimYapildi = false;
let kayitliKisayol = null;

let aktifAdres = null; // ana pencerede şu an açık HA kökeni
let baglantiTuru = null; // 'yerel' | 'dis' | null
let sonBasari = null; // son başarılı HA okumasının/canlı bağlantının zamanı (ms; yalnız bu oturum; tanılama raporu için)
let gosterilenSayfa = 'yok'; // 'baglaniyor' | 'cevrimdisi' | 'ha' | 'yok'
let haSayfaBasligi = '';
let yenidenDenemeZamanlayicisi = null;
let baglanmaSurumu = 0;
let oturumKapaniyor = false; // Windows oturum kapatma sorgusu geldi; iptal edilirse sıfırlanır (pencere gizleme bozulmasın)
let oturumKapanmaZamanlayicisi = null;
let cokmeZamanlari = []; // sayfa süreci çökme zamanları (src/lib/cokme-siniri.js)
let cokmeZamanlayicisi = null;
let acikOnaySayisi = 0; // tepsi menüsünden açılan onay pencereleri (hata-04): biri açıkken ana pencere odak kaybıyla gizlenmez

let anahtarReddedildi = false; // kayıtlı erişim anahtarı Home Assistant tarafından reddedilmiş (yetki kesici açık): tepsi, panel, Ayarlar uyarır
let yetkiDurumu = null; // 'reddedildi' | 'dogrulanamadi' | 'kayit-onayi' | 'yerel-yasak' | null: kesici bu nedenle kimlikli istek göndermiyor (tepsi, panel, Ayarlar gösterir)
let yerelYasakBildirildi = false; // ev içi 403 bildirimi oturum başına BİR kez
let anahtarYonetici = null; // true | false | null (bilinmiyor): kayıtlı anahtarın kullanıcısı yönetici mi (HA auth/current_user is_admin; o-43). Başka hiçbir kullanıcı bilgisi tutulmaz.
let anahtarYoneticiOlcumu = null; // süren ölçüm sözü (çift ölçüm olmasın)
let anahtarYoneticiSurumu = 0; // anahtar değişince artar: eski anahtarın geç gelen yanıtı yenisinin durumunu ezmesin

let favoriSonYenileme = 0; // son REST yenilemesi
let favoriYenilemeSuruyor = null;
let favoriYenilemeTekrari = false; // yenileme sürerken zorla-yenile istendi (eylem sonrası): bitince bir tur daha çalışır (h-20)
let hazirListeSuruyor = null; // hazır liste uygulaması (hiz-07) sürerken ikinci çağrı aynı sözü paylaşır
let hazirYenidenDenemeZamanlayicisi = null; // HA yeni açılmışken eksik kalan hazır karolar için oturum içi yeniden deneme
let bekleyenKomutEylemi = null; // uygulama hazır olmadan gelen --eylem=<ad> (ikinci kopya): hazır olunca çalıştırılır
let bekleyenPencereKomutu = null; // uygulama hazır olmadan gelen --goster/--gizle/--degistir/--durum/--liste (o-19): hazır olunca çalıştırılır
const kisayolTekrarEngeli = tekrarEngeliOlustur(); // basılı tutulan ana/eylem/palet/pano kısayolunun klavye tekrarları tek tetikleme sayılır (h-04)
const tepsiTiklamaEngeli = tekrarEngeliOlustur({ sureMs: TEPSI_CIFT_TIK_MS }); // tepsi çift tıklaması tek tık sayılır (k-17)
const ortaTikEngeli = tekrarEngeliOlustur({ sureMs: 700 }); // tepsi orta tıkının art arda basışları tek tık sayılır: ışık aç-kapa titremesin (o-20)
const ekKisayollar = new Map(); // kayıtlı eylem/palet/pano kısayolları: hızlandırıcı -> plan kimliği
let kisayolDurumlari = []; // son kısayol planı + kayıt sonucu (Ayarlar'da gösterilir)
let cihazOnbellegi = null; // Ayarlar penceresine en son gösterilen cihazlar: { guvenli: Map<id, ad>, tumKimlikler: Set<id> }

let denemeSayaci = 0; // ardışık başarısız bağlantı denemesi (artan bekleme için); başarıda/elle denemede sıfırlanır
let durumSayfasiHazir = false; // offline.html ana pencerede yüklendi (yerinde güncelleme yapılabilir)
let bekleyenYol = null; // çevrimdışıyken istenen pano yolu; bağlanınca açılır
let agDegistiZamanlayicisi = null;
let agYenidenDenemeZamanlayicisi = null; // uyanışta yoklama başarısızsa 5/15/30 sn sonraki yeniden denemeler (h-16)
let agDenetimSurumu = 0;
let sonAgDenetimi = 0; // ağ en son ne zaman denetlendi (saat sıçraması uyanışı aynı uyanışı ikinci kez saymasın; h-37)
let sonDakikaTiki = Date.now(); // 60 sn'lik zamanlayıcının son turu (saat sıçraması denetimi; h-37)
let yenilemeSurumu = 0;
let ayarYazimiEngelli = false; // ayarlar.json açılışta OKUNAMADI (JSON bozuk değil): varsayılanlarla çalışılır ama diske HİÇ yazılmaz (h-10)
let sonIyiAyarMetni = null; // diskte son doğrulanmış (okunan ya da yazılan) ayar dosyası metni: ayarlar.json.bak kopyasının kaynağı (h-32)
let sonBakMetni = null;
let ayarlarCokmeZamanlari = []; // Ayarlar penceresinin sayfa süreci çökme zamanları (h-37)

let pencereKayitZamanlayicisi = null;
let yerlesimBitisi = 0; // bu zamana kadar resize/move olayları ayara yazılmaz (programla yerleştirme)
let fizikselMod = 'hizli'; // fiziksel pencerenin şu anki boyutunun ait olduğu mod; ayardaki mod gizliyken değişebilir
let yerlesimHedefi = null; // son pencereyiYerlestir hedefi { mod, width, height }; kısılmış boyut kullanıcı boyutu sayılmaz
let gizlenmeZamani = 0; // pencere en son ne zaman gizlendi (pencere-04)
let odakKaybiZamanlayicisi = null;
let sonOdakKaybi = 0; // ana pencere odağı en son ne zaman kaybetti (ayardan bağımsız; tepsi tıklaması kararı)
let sonOtomatikGizleme = 0; // odak kaybıyla en son ne zaman gizlendi (tepsi tıklaması tutarlılığı)
let onPlanZamanlayicisi = null;
let yakinlastirmaKayitZamanlayicisi = null;
const haAltPencereleri = new Set(); // HA'nın açtığı alt pencereler (odak kaybında gizleme sayılmaz)
let acilisBildirimleri = { notlar: [], atilanlar: [], onayIstenenler: [], bozukDosyaYedegi: null }; // ayar yüklenirken bulunanlar; açılışta bir kez bildirilir
let sonBildirim = null;
let sonTepsiIpucu = ''; // tepsiye en son yazılan ipucu / simge (aynı değer yeniden yazılmaz)
let tepsiSoluk = true; // başlangıç durumu "bağlanıyor": tepsi soluk simgeyle açılır

// ---------------------------------------------------------------------------
// Arayüz dili (src/lib/dil.js, src/lib/ceviri/ana.js)
// ---------------------------------------------------------------------------

let etkinDil = 'tr'; // 'tr' | 'en' | 'de' | 'fr' | 'es': ayardaki dil ('sistem' | 'tr' | 'en' | 'de' | 'fr' | 'es') ve sistem dilinden çözülür
let cevirici = cevirmen('tr', ANA_SOZLUK);
/** Kullanıcıya giden her metin buradan geçer; dil değişince kendiliğinden yeni dili izler (lib modülleri bu işlevi `t` olarak alır). */
const t = (anahtar, degiskenler) => cevirici(anahtar, degiskenler);
Object.defineProperties(t, {
  dil: { get: () => etkinDil },
  var: { value: (anahtar) => cevirici.var(anahtar) },
});

/** İşletim sistemi dili (app.getLocale); sahte/eksik ortamda ya da hata verirse 'tr'. */
function sistemDiliAl() {
  try {
    const dil = typeof app.getLocale === 'function' ? app.getLocale() : 'tr';
    return typeof dil === 'string' && dil ? dil : 'tr';
  } catch {
    return 'tr';
  }
}

/** Etkin dili ayardan yeniden hesaplar; değiştiyse true. ayarlar henüz yüklenmediyse 'sistem' sayılır. */
function dilHesapla() {
  const onceki = etkinDil;
  etkinDil = dilCoz(ayarlar?.dil ?? 'sistem', sistemDiliAl());
  cevirici = cevirmen(etkinDil, ANA_SOZLUK);
  return etkinDil !== onceki;
}

/** Ekranda görünen uygulama adı. */
function uygulamaAdi() {
  return t('uygulama.ad');
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** Yalnız sabit/türetilmiş güvenli metinler yazılır (günlük ayrıca sır ayıklar). Anahtar, başlık ya da istek nesnesi ASLA. */
function gunluk(mesaj) {
  gunlukKaydi.yaz(mesaj);
}

const bekle = (ms) => new Promise((coz) => setTimeout(coz, ms));

function izinliKokenler() {
  const kume = new Set();
  if (ayarlar?.yerelAdres) kume.add(ayarlar.yerelAdres);
  if (ayarlar?.disAdres) kume.add(ayarlar.disAdres);
  return kume;
}

function izinliKokenMi(koken) {
  return !!koken && izinliKokenler().has(koken);
}

function varlikAdi(varlik) {
  const ad = varlik?.attributes?.friendly_name;
  if (typeof ad === 'string' && ad.trim()) return ad.trim().slice(0, 100);
  return String(varlik?.entity_id ?? '');
}

function durumMetni(durum) {
  switch (durum) {
    case 'on':
    case 'off':
    case 'unavailable':
    case 'unknown':
      return t(`durum.${durum}`);
    default:
      return '';
  }
}

/** Windows menülerinde "&" kısayol harfi sayılır; çiftlemek gerekir. */
function menuMetni(metin) {
  return String(metin).replace(/&/g, '&&');
}

// ---------------------------------------------------------------------------
// Ayar dosyası: %APPDATA%\Ev Paneli\ayarlar.json
// ---------------------------------------------------------------------------

function ayarDosyasiYolu() {
  return path.join(app.getPath('userData'), 'ayarlar.json');
}

function jsonOku(dosya) {
  return JSON.parse(fs.readFileSync(dosya, 'utf8').replace(/^\uFEFF/, ''));
}

function varsayilanlariOku() {
  try {
    const veri = jsonOku(VARSAYILAN_AYAR_DOSYASI);
    return veri && typeof veri === 'object' ? veri : {};
  } catch {
    gunluk('varsayilan-ayarlar.json okunamadı.');
    return {};
  }
}

/** Kısa eşzamanlı bekleme (ayar dosyası okuma/yazma yeniden denemeleri arasında; ana süreçte Atomics.wait kullanılabilir). */
function kisaBekle(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* bekleme desteklenmiyorsa denemeler arka arkaya yapılır */
  }
}

/**
 * Ayar dosyasını okur (h-10). JSON'un bozuk olması ile dosyanın o an OKUNAMAMASI (antivirüs/yedekleme programı tutuyor: EBUSY,
 * EPERM, EACCES...) ayrı şeylerdir: okuma hatasında birkaç kez kısa aralıkla yeniden denenir; yine okunamazsa 'okunamadi'
 * döner ve çağıran dosyaya HİÇ yazmaz (sağlam ayarlar varsayılanlarla ezilmesin). Yalnız gerçekten ayrıştırılamayan içerik 'bozuk'tur.
 * @returns {{durum: 'yok'}|{durum: 'okunamadi'}|{durum: 'bozuk'}|{durum: 'tamam', ham: object, metin: string}}
 */
function ayarDosyasiniOku(dosya) {
  let metin = null;
  for (let deneme = 0; deneme < AYAR_OKUMA_DENEME && metin === null; deneme += 1) {
    if (deneme > 0) kisaBekle(AYAR_OKUMA_ARA_MS * deneme);
    try {
      metin = fs.readFileSync(dosya, 'utf8');
    } catch (hata) {
      if (hata?.code === 'ENOENT') return { durum: 'yok' };
    }
  }
  if (metin === null) return { durum: 'okunamadi' };
  try {
    const ham = JSON.parse(metin.replace(/^\uFEFF/, ''));
    if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return { durum: 'bozuk' };
    return { durum: 'tamam', ham, metin };
  } catch {
    return { durum: 'bozuk' };
  }
}

function ayarlariYukle() {
  const dosya = ayarDosyasiYolu();
  let ham = null; // ayarlar.json'dan okunan içerik (göç yedeği kararları bu dosya içindir)
  let bakHam = null; // dosya bozuksa ayarlar.json.bak (son iyi kopya) içeriği
  let bozukDosyaYedegi = null; // null: dosya bozuk değildi; '': bozuktu ama yedeklenemedi; ad: yedeğin dosya adı
  let okunamadi = false;
  const okuma = ayarDosyasiniOku(dosya);
  if (okuma.durum === 'tamam') {
    ham = okuma.ham;
    sonIyiAyarMetni = okuma.metin;
  } else if (okuma.durum === 'okunamadi') {
    // Dosya var ama okunamadı (kilit/izin): "bozuk" DEĞİL. Varsayılanlarla çalışılır, dosyanın üzerine HİÇ yazılmaz (h-10).
    gunluk('ayarlar.json okunamadı (kilitli olabilir); varsayılanlarla çalışılıyor, dosyaya yazılmayacak.');
    okunamadi = true;
    ayarYazimiEngelli = true;
  } else if (okuma.durum === 'bozuk') {
    gunluk('ayarlar.json bozuk; yedeklenip varsayılanlar kullanılıyor.');
    bozukDosyaYedegi = '';
    const yedek = dosya.replace(/\.json$/, `.bozuk-${Date.now()}.json`);
    try {
      fs.renameSync(dosya, yedek);
      bozukDosyaYedegi = path.basename(yedek);
    } catch {
      try {
        fs.copyFileSync(dosya, yedek, fs.constants.COPYFILE_EXCL); // kenara alınamadıysa kopyası
        bozukDosyaYedegi = path.basename(yedek);
      } catch {
        ayarYazimiEngelli = true; // ne kenara alınabildi ne kopyalanabildi: bozuk dosya yine de ezilmesin (h-10)
      }
    }
    // Son iyi kopya (h-32): ayarlar.json.bak sağlamsa ayarlar ondan geri yüklenir.
    const bak = ayarDosyasiniOku(`${dosya}.bak`);
    if (bak.durum === 'tamam') {
      bakHam = bak.ham;
      sonIyiAyarMetni = bak.metin;
      gunluk('ayarlar.json.bak (son iyi kopya) geri yüklendi.');
    }
  }
  // Şema düzeltme ve göç (src/lib/ayar-sema.js): bilinmeyen/bozuk alanlar düzelir, eski pencere biçimi taşınır.
  // Süzgeçten elenen favoriler sessiz silinmez: açılışta tek bildirim + günlük (acilisBildirimleriniGoster).
  const varsayilan = varsayilanlariOku();
  const { ayarlar: duzeltilen, notlar, atilanlar, onayIstenenler, sifirlananlar } = ayarlariDuzelt(bakHam ?? ham ?? {}, { varsayilan });
  // Eski (ya da kendinden YENİ) şemadan gelen dosya, aşağıda yeni biçimiyle üzerine yazılmadan ÖNCE aynı klasöre
  // ayarlar.v<sürüm>-yedek.json olarak kopyalanır (src/lib/ayar-yedegi.js; var olan yedek ezilmez, kopyalama başarısızsa göç
  // durmaz). Bozuk dosyada ham null'dır: o yol yukarıdaki 'bozuk' yedeğiyle zaten ele alındı.
  const semaYedegi = gocOncesiYedegiAl({ dosya, ham, fs, gunluk });
  // Tipi bozuk alanlar varsayılana döndüyse (h-33) özgün dosya zaman damgalı bir kopyaya alınır.
  const hataliYedek = ham !== null && sifirlananlar.length > 0 ? hataliAlanYedegiAl({ dosya, fs, gunluk }).yedek : null;
  // Aynı klasörü kullanan daha eski bir sürüm (1.3.0; taşınabilir derleme dahil) bu dosyayı açıp üzerine yazdıysa, düşürdüğü bilgiler
  // (iklim/medya/sensör favorileri, simge-renk-boyut, dil seçimi) onun aldığı ayarlar.v<şema>-yedek.json'dan geri alınır
  // (src/lib/yedek-kurtarma.js). Yalnız gerçekten okunan bir ayar dosyasında çalışır (ham null değilse).
  const devir = eskiSurumYedeginiDevral({ dizin: path.dirname(dosya), ayarlar: duzeltilen, ham: ayarYazimiEngelli ? null : ham, varsayilan, fs, gunluk });
  const sonuc = devir.ayarlar;
  // Bozuk dosya sessizce sıfırlanmaz: açılışta yedek dosya adıyla bildirilir (acilisBildirimleriniGoster).
  acilisBildirimleri = {
    notlar: [...notlar, ...(bozukDosyaYedegi === null ? [] : ['ayar-dosyasi-bozuk']), ...(okunamadi ? ['ayar-dosyasi-okunamadi'] : [])],
    atilanlar,
    onayIstenenler,
    bozukDosyaYedegi,
    bakTenGeriYuklendi: bakHam !== null,
    sifirlananlar,
    hataliYedek,
    semaYedegi: semaYedegi.yedek,
  };
  // ayarYazimiEngelli iken yazmaz (dosya okunamadıysa ya da bozuk dosya saklanamadıysa)
  if (ayarlariYaz(sonuc)) {
    // Geri alınanlar artık kayıtlı: eski sürümün yedeği kenara alınır (bir sonraki gidişte yeniden yedek alabilsin) ve kullanıcıya söylenir.
    const kenar = devir.tuket();
    if (devir.geriAlindi) {
      acilisBildirimleri.notlar.push('eski-surum-yedegi');
      acilisBildirimleri.eskiSurumYedegi = kenar ?? devir.yedek;
    }
  }
  return sonuc;
}

/**
 * Ev içi adres http:// iken erişim anahtarı ev ağında şifresiz gider (hata-01'de kabul edilmiş risk; kök çözüm HTTPS adres).
 * Her açılışta günlüğe sabit bir satır yazılır; Windows bildirimi aynı adres için BİR kez gösterilir (habersiz kalınmasın,
 * ama her açılışta da rahatsız edilmesin).
 */
function httpAnahtarUyarisiniGoster() {
  const adres = String(ayarlar.yerelAdres ?? '');
  if (!adres.toLowerCase().startsWith('http:') || !anahtarDeposu.varMi()) return;
  gunluk(HTTP_ANAHTAR_GUNLUK_SATIRI);
  if (ayarlar.httpUyarisiAdresi === adres) return;
  ayarlar.httpUyarisiAdresi = adres;
  ayarlariYaz();
  bildir(t('bildirim.httpUyarisi'), uygulamaAdi(), AYARLARI_AC);
}

/** Ayar yüklenirken bulunan düzeltmeleri kullanıcıya bir kez bildirir (sessiz değişiklik yok). */
function acilisBildirimleriniGoster() {
  const { notlar, atilanlar, onayIstenenler, bozukDosyaYedegi, bakTenGeriYuklendi, sifirlananlar, hataliYedek, semaYedegi, eskiSurumYedegi } = acilisBildirimleri;
  acilisBildirimleri = { notlar: [], atilanlar: [], onayIstenenler: [], bozukDosyaYedegi: null, bakTenGeriYuklendi: false, sifirlananlar: [], hataliYedek: null, semaYedegi: null, eskiSurumYedegi: null };
  if (notlar.includes('ayar-dosyasi-okunamadi')) {
    bildir(t('bildirim.ayarOkunamadi')); // günlük satırı okuma anında yazıldı (ayarlariYukle)
  }
  if (notlar.includes('ayar-dosyasi-bozuk')) {
    gunluk(bakTenGeriYuklendi ? 'ayarlar.json bozuktu; son iyi kopyadan geri yüklendi.' : 'ayarlar.json bozuktu; varsayılan ayarlarla başlandı.');
    bildir(ayarDosyasiBozukMetni(bozukDosyaYedegi, bakTenGeriYuklendi, t));
  }
  if (notlar.includes('kisayol-varsayilana-donduruldu')) {
    gunluk('Kayıtlı kısayol geçersizdi; varsayılana döndürüldü.');
    bildir(kisayolSifirlandiMetni('ana', kisayolGoster(ayarlar.kisayol), t), uygulamaAdi(), AYARLARI_AC);
  }
  if (notlar.includes('palet-kisayol-varsayilana-donduruldu')) {
    // h-33: palet kısayolu geçersizdi ve sessizce varsayılana dönmüştü; artık bildirilir.
    gunluk('Kayıtlı palet kısayolu geçersizdi; varsayılana döndürüldü.');
    bildir(kisayolSifirlandiMetni('palet', kisayolGoster(ayarlar.paletKisayol), t), uygulamaAdi(), AYARLARI_AC);
  }
  if (notlar.includes('alan-tipi-hatali') && sifirlananlar.length > 0) {
    // h-33: tipi bozuk alanlar (ör. favoriler dizi değil) varsayılana döndü; hangi alanlar olduğu ve özgün dosyanın yedeği bildirilir.
    gunluk(`${sifirlananlar.length} ayar alanı tipi bozuk olduğu için varsayılana döndürüldü.`);
    bildir(alanlarSifirlandiMetni(sifirlananlar, hataliYedek ?? '', t));
  }
  if (notlar.includes('sema-daha-yeni')) {
    // h-11: dosya bu sürümden daha yeni bir Ev Paneli ile kaydedilmiş; bilinmeyen ayarlar korundu, özgün dosya yedeklendi.
    gunluk('Ayar dosyası daha yeni bir şemada; bilinmeyen alanlar korundu.');
    bildir(semaDahaYeniMetni(ayarlar.semaSurumu, semaYedegi ?? '', t));
  }
  if (notlar.includes('eski-surum-yedegi')) {
    // Daha eski bir sürüm ayar dosyasını yazarken düşürdüğü favoriler ve ayarlar yedekten geri alındı (günlük satırı yedek-kurtarma.js'de).
    bildir(eskiSurumYedegiMetni(eskiSurumYedegi ?? '', t));
  }
  const elenen = atilanlar.filter((a) => a.neden !== 'tekrar').length;
  if (elenen > 0) {
    gunluk(`${elenen} favori güvenlik/geçerlilik kuralıyla ayar dosyasından çıkarıldı.`);
    bildir(cogul(t, 'bildirim.favoriElendi', elenen));
  }
  if (onayIstenenler.length > 0) {
    // Şema göçü (v3): geri alınması zor eylemler artık onay ister; kullanıcı habersiz kalmasın (hata-04).
    const adlar = onayIstenenler.slice(0, 5).map((k) => ayarlar.favoriler.find((f) => f.entity_id === k)?.ad ?? k);
    gunluk(`${onayIstenenler.length} favori artık çalıştırılmadan önce onay soruyor.`);
    bildir(t('bildirim.favoriOnaySoracak', { adlar: `${adlar.join(', ')}${onayIstenenler.length > 5 ? '…' : ''}` }));
  }
}

/** Son iyi kopya (h-32): yeni içerik asıl dosyanın yerine konmadan önce, diskte son doğrulanmış içerik ayarlar.json.bak olarak saklanır. */
function sonIyiKopyayiSakla(dosya) {
  if (sonIyiAyarMetni === null || sonIyiAyarMetni === sonBakMetni) return;
  try {
    fs.writeFileSync(`${dosya}.bak`, sonIyiAyarMetni, 'utf8');
    sonBakMetni = sonIyiAyarMetni;
  } catch {
    /* son iyi kopya alınamadı: kayıt yine de sürer */
  }
}

/** Geçici dosyayı asıl dosyanın yerine koyar; kilit/izin kaynaklı geçici hatalarda (antivirüs, yedekleme) kısa aralıkla 3 kez dener (h-32). */
function ayarDosyasiniYerineKoy(gecici, dosya) {
  for (let deneme = 1; ; deneme += 1) {
    try {
      fs.renameSync(gecici, dosya);
      return;
    } catch (hata) {
      const kilitHatasi = ['EPERM', 'EBUSY', 'EACCES'].includes(hata?.code);
      if (!kilitHatasi || deneme >= AYAR_YENIDEN_ADLANDIRMA_DENEME) throw hata;
      kisaBekle(AYAR_YENIDEN_ADLANDIRMA_ARA_MS * deneme);
    }
  }
}

/**
 * Elektrik kesintisine dayanıklı yazım (h-32): geçici dosyaya yazılır ve fsync ile DİSKE zorlanır, son iyi kopya .bak olarak saklanır,
 * sonra asıl dosyanın yerine konur (aynı birimde yeniden adlandırma atomiktir). Ayar dosyası açılışta okunamadıysa (h-10) hiç yazılmaz.
 * @returns {boolean} yazıldı mı; IPC işleyicileri başarısızlığı kullanıcıya bildirir (kaydedildi sanılmasın).
 */
function ayarlariYaz(veri = ayarlar) {
  if (!veri) return false;
  if (ayarYazimiEngelli) return false;
  const dosya = ayarDosyasiYolu();
  const gecici = `${dosya}.tmp`;
  let tanimlayici = null;
  try {
    fs.mkdirSync(path.dirname(dosya), { recursive: true });
    const metin = `${JSON.stringify(veri, null, 2)}\n`;
    tanimlayici = fs.openSync(gecici, 'w');
    fs.writeFileSync(tanimlayici, metin, 'utf8');
    fs.fsyncSync(tanimlayici);
    fs.closeSync(tanimlayici);
    tanimlayici = null;
    sonIyiKopyayiSakla(dosya);
    ayarDosyasiniYerineKoy(gecici, dosya);
    sonIyiAyarMetni = metin;
    if (esitlemeYoneticisi) esitlemeYoneticisi.yerelDegisti(); // klasör eşitleme açıksa ve bir bölüm değiştiyse kısa süre sonra eşitlenir (o-58)
    return true;
  } catch {
    gunluk('ayarlar.json yazılamadı.');
    if (tanimlayici !== null) {
      try {
        fs.closeSync(tanimlayici);
      } catch {
        /* zaten kapalı */
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Erişim anahtarı (safeStorage / DPAPI ile şifreli; asenkron API + atomik yazma: src/lib/anahtar-deposu.js)
// ---------------------------------------------------------------------------

// Elle yapıştırılan uzun ömürlü anahtar (anahtar.dat) ve tarayıcıyla giriş oturumu (oauth-oturum.dat; 1.4.0, o-57) TEK arayüzde birleşir:
// `anahtarDeposu` ana sürecin her yerinde eskisi gibi kullanılır. İkisi aynı anda bulunmaz (src/oauth-yoneticisi.js).
const manuelAnahtarDeposu = anahtarDeposuOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'anahtar.dat'),
  fs,
  safe: safeStorage,
  gunluk,
});
const oturumDeposu = anahtarDeposuOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'oauth-oturum.dat'),
  fs,
  safe: safeStorage,
  gunluk,
  etiket: 'Tarayici oturumu',
});
const anahtarDeposu = birlesikAnahtarDeposuOlustur({
  manuel: manuelAnahtarDeposu,
  oturum: {
    oturumVarMi: () => oturumDeposu.varMi(),
    erisimAnahtariAl: () => oauthYoneticisi.erisimAnahtariAl(),
    cikis: (secenek) => oauthYoneticisi.cikis(secenek),
    yerelSil: () => oauthYoneticisi.yerelSil(),
  },
});

// ---------------------------------------------------------------------------
// Bağlantı katmanı (1.4.0, o-55/o-56; src/baglanti-yoneticisi.js): HA'ya giden REST/canlı bağlantı/HA penceresi yolları için özel
// üstbilgiler (Cloudflare Access vb., değerler safeStorage ile şifreli) ve yalnız HA ana bilgisayarı için sertifika güveni.
// ---------------------------------------------------------------------------

// Sertifika güveni (o-56): yalnız HA ana bilgisayarları için özel kök CA / parmak izi sabitleme. Kayıtlar ayarlardan AYRI dosyada
// (sertifika-guveni.json): içe aktarılan/eşitlenen bir dosya güven köklerini değiştiremesin. "Hataları yok say" seçeneği yoktur.
const sertifikaYoneticisi = sertifikaYoneticisiOlustur({
  depo: sertifikaDeposuOlustur({ dosyaYolu: path.join(app.getPath('userData'), 'sertifika-guveni.json'), fs, gunluk }),
  ayarlarAl: () => ayarlar,
  dosyaSec: async () => {
    const secenekler = {
      title: t('baglanti.sertifikaSec'),
      properties: ['openFile'],
      filters: [{ name: t('baglanti.sertifikaDosyasi'), extensions: ['pem', 'crt', 'cer', 'der'] }],
    };
    const pencere = ayarlarPenceresi && !ayarlarPenceresi.isDestroyed() ? ayarlarPenceresi : null;
    const secim = pencere ? await dialog.showOpenDialog(pencere, secenekler) : await dialog.showOpenDialog(secenekler);
    return secim && !secim.canceled && Array.isArray(secim.filePaths) && typeof secim.filePaths[0] === 'string' ? secim.filePaths[0] : null;
  },
  gunluk,
});

const baglantiYoneticisi = baglantiYoneticisiOlustur({
  ayarlarAl: () => ayarlar,
  sertifika: sertifikaYoneticisi,
  ustbilgiDeposu: ustbilgiDeposuOlustur({
    depo: anahtarDeposuOlustur({ dosyaYolu: path.join(app.getPath('userData'), 'ozel-ustbilgiler.dat'), fs, safe: safeStorage, gunluk, etiket: 'Ozel ustbilgi' }),
    gunluk,
  }),
  fetchTemel: (url, secenekler) => net.fetch(url, secenekler),
  WebSocketTemel: globalThis.WebSocket,
  t,
  gunluk,
});

// Klasör tabanlı ayar eşitleme (1.4.0, o-58; src/esitleme-yoneticisi.js): kullanıcının seçtiği yerel klasörde (Dropbox, OneDrive, Syncthing...)
// sırsız bölüm bölüm JSON; varsayılan KAPALI, ağa çıkmaz. Yönetici ipcKaydet() içinde kurulur (içe aktarma hattını kullanır). İsteğe bağlı dosya
// parolası safeStorage ile esitleme-parola.dat'ta durur; ne ayara, ne dosyaya, ne günlüğe girer.
let esitlemeYoneticisi = null;
const esitlemeParolaDeposu = anahtarDeposuOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'esitleme-parola.dat'),
  fs,
  safe: safeStorage,
  gunluk,
  etiket: 'Esitleme parolasi',
});

// ---------------------------------------------------------------------------
// Ağ: adres seçimi ve HA REST API (src/ha-istemcisi.js)
// ---------------------------------------------------------------------------

/**
 * Yetki kesici (src/lib/yetki-kesici.js): reddedilen anahtarların parmak izleri <userData>\yetki-kesici.json'da (anahtarın kendisi
 * ASLA). Kimlikli her istek ve WebSocket auth adımı bundan geçer (ha-istemcisi.js, ha-ws.js).
 */
/**
 * Yedek kayıt yerleri: (1) userData içinde ikinci dosya (ana dosya kilitli/bozuksa), (2) FARKLI klasör: %LOCALAPPDATA%\<veri klasörü>
 * (userData yazılamıyorsa: disk/izin/kilit; tur 2 inceleme).
 */
function yetkiYedekYollari() {
  const yollar = [path.join(app.getPath('userData'), 'yetki-kesici.yedek.json')];
  const yerelAppData = process.env.LOCALAPPDATA;
  if (yerelAppData) yollar.push(path.join(yerelAppData, path.basename(app.getPath('userData')), 'yetki-kesici.yedek.json'));
  return yollar;
}

/**
 * Reddedilen/doğrulanamayan anahtarın kaydı HİÇBİR yere yazılamadıysa (disk dolu, izin) yeniden başlatmada aynı anahtarla bir deneme
 * daha giderdi: kayıtlı anahtarın dosyası kenara alınır (yeniden adlandırma yazma alanı gerektirmez) ve kullanıcıya söylenir.
 */
function anahtarDosyasiniKenaraAl(parmakIzi) {
  anahtarDeposu
    .anahtarAl()
    .then((anahtar) => {
      if (anahtar && yetkiKesici.parmakIzi(anahtar) === parmakIzi && anahtarDeposu.karantinayaAl()) bildir(t('bildirim.anahtarKarantina'), uygulamaAdi(), AYARLARI_AC);
    })
    .catch(() => {})
    .finally(() => yetkiDurumunuTazele());
}

/** Ayarlar'daki açık ikinci onay için tek kullanımlık biletler (tur 5, K7): bilet aday parmak izine ve o anki hata sayacına bağlıdır. */
const onayBiletleri = onayBiletiDeposuOlustur();

const yetkiKesici = yetkiKesiciOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'yetki-kesici.json'),
  yedekYollar: yetkiYedekYollari(),
  fs,
  gunluk,
  // Kayıt yazılamadı/okunamadı: sessiz kalınmaz (her yeniden başlatmada aynı geçersiz anahtarla 1 deneme daha gidebilir).
  kayitSorunu: (tur) => bildir(t(tur === 'yazilamadi' ? 'bildirim.yetkiKaydiYazilamadi' : 'bildirim.yetkiKaydiOkunamadi'), uygulamaAdi(), AYARLARI_AC),
  reddedildi: (parmakIzi, _neden, kalici) => {
    // Tarayıcı oturumunun erişim anahtarı reddedildiyse (o-57): yenileme anahtarıyla bir kez yenilenir; oturum geçersizse bildirim
    // oturumSonlandi'dan gelir ("anahtar reddedildi" bildirimi ve anahtar dosyasını kenara alma bu dala uygulanmaz).
    if (oauthYoneticisi.erisimReddedildi(parmakIzi)) {
      oauthYoneticisi
        .erisimAnahtariAl()
        .then((yeni) => {
          if (!yeni) return;
          ws.yenidenBaglan();
          durumlariYenile({ zorla: true });
          // Açılışta anahtar reddedilmişse hazır liste uygulanamamıştı: yeni anahtarla yeniden denenir (sürüm güncelse atlanır).
          return hazirListeyiUygula();
        })
        .catch(() => {})
        .finally(() => yetkiDurumunuTazele());
      return;
    }
    // Kullanılan (kayıtlı) anahtar reddedildiyse parmak izi başına BİR kez bildirilir; Ayarlar'da denenen aday anahtar
    // reddedilirse kullanıcı zaten sonucu Ayarlar'da görür (bildirim çıkmaz).
    anahtarDeposu
      .anahtarAl()
      .then((anahtar) => {
        if (anahtar && yetkiKesici.parmakIzi(anahtar) === parmakIzi) bildir(t('bildirim.anahtarReddedildi'), uygulamaAdi(), AYARLARI_AC);
      })
      .catch(() => {})
      .finally(() => yetkiDurumunuTazele());
    if (!kalici) anahtarDosyasiniKenaraAl(parmakIzi);
  },
  dogrulanamadi: (parmakIzi, kalici) => {
    anahtarDeposu
      .anahtarAl()
      .then((anahtar) => {
        if (anahtar && yetkiKesici.parmakIzi(anahtar) === parmakIzi) bildir(t('bildirim.anahtarDogrulanamadi'), uygulamaAdi(), AYARLARI_AC);
      })
      .catch(() => {})
      .finally(() => yetkiDurumunuTazele());
    if (!kalici) anahtarDosyasiniKenaraAl(parmakIzi);
  },
  degisti: () => yetkiDurumunuTazele(),
});

const haIstemcisi = haIstemcisiOlustur({
  fetch: (url, secenekler) => baglantiYoneticisi.fetch(url, secenekler), // HA kökenine özel üstbilgiler eklenir (o-55)
  ayarlarAl: () => ayarlar,
  anahtarAl: () => anahtarDeposu.anahtarAl(),
  yetkiKesici,
  durumDegisti: () => yetkiDurumunuTazele(), // ev içi 403 engeli (yerel-yasak) değişti
  aktifAdresAl: () => aktifAdres,
  yenidenBaglan: (secim) => {
    // Ana pencere yanlış adreste kaldıysa (ör. evden çıkıldı) ya da hata sayfasındaysa onu da taşı.
    if (!anaPencere || anaPencere.isDestroyed()) return;
    if (gosterilenSayfa === 'cevrimdisi' || (gosterilenSayfa === 'ha' && secim.adres !== aktifAdres)) {
      baglan(secim);
    }
  },
  gunluk,
});
const { adresSec, haIstek } = haIstemcisi;

/**
 * Tarayıcıyla giriş (1.4.0, o-57; src/oauth-yoneticisi.js): geçici 127.0.0.1 dinleyicisi, /auth/token çağrıları (ha-istemcisi.oauthIstegi: yetki kesici,
 * küresel kapı, güvenli adres), yenileme anahtarı safeStorage ile oauth-oturum.dat'ta, erişim anahtarı yalnız bellekte.
 */
const oauthYoneticisi = oauthYoneticisiOlustur({
  depo: oturumDeposu,
  jetonIstegi: (girdi) => haIstemcisi.oauthIstegi(girdi),
  tabanBul: async () => (await haIstemcisi.apiTabaniBul()) ?? haIstemcisi.apiTabaniBul(true),
  tarayiciAc: (url) => shell.openExternal(url), // YALNIZ kullanıcı "Tarayıcıyla giriş yap" dediğinde; adres ayardaki HA kökeninden kurulur
  ayarlarAl: () => ayarlar,
  parmakIzi: (anahtar) => yetkiKesici.parmakIzi(anahtar),
  erisimKabulEdildi: (taban, anahtar) => haIstemcisi.yeniErisimAnahtari(taban, anahtar),
  erisimDegisti: ({ eski }) => {
    // Yenilenen oturumun eski erişim anahtarının kesici kaydı atılır (reddedilmişse kayıt kalır)
    if (eski && !yetkiKesici.reddedildiMi(eski)) yetkiKesici.temizle(eski);
  },
  degisti: () => ayarlaraOturumDegistiBildir(),
  oturumAcildi: async () => {
    // Tarayıcı girişi, kayıtlı elle anahtarın yerine geçer (aynı anda tek giriş türü).
    let eskiParmak = null;
    try {
      const elle = manuelAnahtarDeposu.varMi() ? await manuelAnahtarDeposu.anahtarAl() : null;
      if (elle) eskiParmak = yetkiKesici.parmakIzi(elle);
    } catch {
      eskiParmak = null;
    }
    if (manuelAnahtarDeposu.varMi() || manuelAnahtarDeposu.karantinadaMi()) await manuelAnahtarDeposu.sil();
    if (eskiParmak) yetkiKesici.temizle(eskiParmak);
    haIstemcisi.dogrulamayiSifirla();
    await yetkiDurumunuTazele();
    ws.yenidenBaglan();
    durumlariYenile({ zorla: true });
    await hazirListeyiUygula();
  },
  oturumSonlandi: () => {
    // HA yenileme anahtarını reddetti (silinmiş/iptal) ya da erişim anahtarı yenilemeye rağmen reddedildi: anahtar yok durumuna dönülür.
    bildir(t('bildirim.oturumSonlandi'), uygulamaAdi(), AYARLARI_AC);
    ws.durdur();
    haIstemcisi.dogrulamayiSifirla();
    depo.sifirla();
    cihazOnbellegi = null;
    yetkiDurumunuTazele();
    yuzey.modelDegisti();
  },
  t,
  dil: () => etkinDil,
  gunluk,
});

// ---------------------------------------------------------------------------
// Durum deposu, canlı bağlantı, eylem hattı ve hızlı panel (Dalga 3)
// ---------------------------------------------------------------------------

/** Tek durum kaynağı: canlı bağlantı (src/ha-ws.js) ve REST yedeği AYNI depoya yazar; tepsi, panel ve palet buradan okur. */
const depo = durumDeposuOlustur();
const son = sonKullanilanlarOlustur({ dosyaYolu: path.join(app.getPath('userData'), 'son-kullanilanlar.json'), fs, gunluk });
/** 1.4.0 düzen (o-30): favori + sayfa düzeninin son 20 anlık görüntüsü (<userData>\duzen-gecmisi.json); ayar yedeklerinden (ayar-yedegi.js) ayrıdır. */
const duzenGecmisi = duzenGecmisiOlustur({ dosyaYolu: path.join(app.getPath('userData'), 'duzen-gecmisi.json'), fs, gunluk });

/**
 * Tepsi simgesi rozeti (o-27, 1.4.0; src/tepsi-rozeti.js): ayar `tepsiRozeti` 'isik' ise açık ışık sayısı, 'sensor' ise seçilen sensörün
 * kısa değeri (birden çok sensör seçiliyse sırayla) simgeye çizilir. Varsayılan 'kapali' iken simge eskisi gibi dosya simgesidir. Bağlantı yokken (soluk) rozet çizilmez.
 */
const tepsiRozeti = tepsiRozetiOlustur({
  nativeImage,
  screen,
  tepsiAl: () => (tepsi && !tepsi.isDestroyed() ? tepsi : null),
  ayarlarAl: () => ayarlar,
  durumAl: (kimlik) => depo.al(kimlik),
  acikIsikAl: () => acikIsikSayisi(favoriKarolari()),
  solukAl: () => baglantiTuru === null,
  normalIkon: IKON_ICO,
  solukIkon: IKON_SOLUK,
  gunluk,
});

/** Ayarlar'da kullanıcının tek tek onayladığı kamera kimlikleri (1.4.0, o-48); doğrulanmış kopya, ayar yoksa boş. */
function kameraIzinleri() {
  return kameraIzinleriniDuzelt(ayarlar?.kameraIzinleri) ?? [];
}

/** İzlenen varlıklar: favoriler + salt-okunur yardımcı varlıklar (medya çalıyor, ses çıkışı) + bilgi kartlarının varlıkları (sensör şeridi, hava, takvim, yapılacaklar) + (rozet 'sensor' modunda) seçili sensör + uyarı kurallarının varlıkları + onaylı kameralar (1.4.0). */
function izlenenKimlikler() {
  return new Set([...(ayarlar?.favoriler ?? []).map((f) => f.entity_id), ...YARDIMCI_VARLIKLAR, ...bilgiKimlikleri(ayarlar), ...tepsiRozeti.izlenenKimlikler(), ...bildirimAkisi.izlenenKimlikler(), ...kameraIzinleri()]);
}

/**
 * o-38: "Home Assistant bağlantısı koptu / geri geldi" Windows bildirimi (src/lib/baglanti-bildirimi.js). Kesinti ayardaki süre
 * (baglantiBildirimSn, varsayılan 60 sn) kadar sürmedikçe sessizdir; "geri geldi" yalnız "koptu" gösterildiyse gelir. Uyku, yetki sorunu
 * ve ayardan kapatma kesinti sayılmaz. Yalnız yerel bildirimdir (ağa bir şey gitmez); ayar `baglantiBildirimi` kapatılabilir.
 */
const baglantiBildirimi = baglantiBildirimiOlustur({
  etkinMi: () => ayarlar?.baglantiBildirimi !== false,
  gecikmeSnAl: () => ayarlar?.baglantiBildirimSn,
  koptu: () => bildir(t('bildirim.baglantiKoptu'), uygulamaAdi(), AYARLARI_AC),
  geldi: () => bildir(t('bildirim.baglantiGeldi'), uygulamaAdi()),
});

const ws = haWsOlustur({
  WebSocketSinifi: baglantiYoneticisi.webSocketSinifi, // üstbilgi / özel sertifika gerekmiyorsa küresel WebSocket aynen kullanılır (o-55/o-56)
  adresAl: () => haIstemcisi.apiTabaniBul(),
  anahtarAl: () => anahtarDeposu.anahtarAl(),
  yetki: haIstemcisi.wsYetkisi,
  izlenen: izlenenKimlikler,
  depo,
  etkinMi: () => ayarlar?.canliBaglanti !== false,
  durumDegisti: (d) => {
    baglantiBildirimi.durum(d); // o-38: uzun kesintide "koptu", dönünce "geri geldi"
    if (d.canli && ayarlarPenceresi && !ayarlarPenceresi.isDestroyed()) void anahtarYoneticisiniOlc(); // o-43: Ayarlar açıkken anahtarın kullanıcı türü
    if (d.canli) {
      depo.sonHata = null; // canlı bağlantı kuruldu: eski bir REST hatası ("bağlantı yok") artık geçerli değil
      sonBasari = Date.now();
    }
    bildirimAkisi.baglantiDegisti(); // kurulum/kopma sırasındaki toplu durumlar uyarı üretmez (1.4.0)
    yuzey.modelDegisti();
    masaustuKarolari.modelDegisti(); // karolardaki bağlantı durumu (canlı / yedek)
    tepsiyiGuncelle(); // canlı/yedek geçişi ipucundaki "(son bilinen)" notunu değiştirir
    if (!d.canli) durumlariYenile(); // canlı bağlantı yokken REST yedeği hemen devreye girer
  },
  gunluk,
});

/**
 * Kayıtlı anahtar reddedilmiş mi (yetki kesici açık mı)? Durum bellekte tutulur; değişince tepsi ve panel tazelenir.
 * Açılışta, kesici değişince, anahtar kaydı/silmesinde çağrılır.
 */
async function yetkiDurumunuTazele() {
  let yeni = null;
  try {
    const anahtar = await anahtarDeposu.anahtarAl();
    if (anahtar) {
      const parmakIzi = yetkiKesici.parmakIzi(anahtar);
      yetkiKesici.koru(parmakIzi); // saklı anahtarın kaydı, Ayarlar'da denenen aday anahtarlar yüzünden listeden düşmesin
      if (yetkiKesici.reddedildiMi(parmakIzi)) yeni = 'reddedildi';
      else if (yetkiKesici.onayDurumu()) yeni = 'kayit-onayi'; // kesici kaydı okunamadı/bozuk/yazılamıyor: Yeniden Dene onayı bekleniyor
      else if (yetkiKesici.dogrulanamadiMi(parmakIzi)) yeni = 'dogrulanamadi';
      else if (haIstemcisi.engelDurumu() === 'yerel-yasak') yeni = 'yerel-yasak';
    }
  } catch {
    yeni = null;
  }
  yetkiDurumu = yeni;
  anahtarReddedildi = yeni === 'reddedildi';
  if (yeni === 'yerel-yasak' && !yerelYasakBildirildi) {
    yerelYasakBildirildi = true;
    bildir(t('bildirim.yerelYasak'), uygulamaAdi(), AYARLARI_AC);
  }
  tepsiyiGuncelle();
  yuzey.modelDegisti();
}

/**
 * o-43: anahtarın kullanıcısı yönetici mi? Yönetici anahtarı sızarsa tüm Home Assistant ayarlarına erişilir; uygulama yalnız cihazları
 * yönettiğinden yönetici olmayan bir kullanıcı önerilir (Ayarlar > Erişim anahtarı ve tanılama raporu). Ölçüm tek salt okunur WS komutudur
 * (auth/current_user), YALNIZ Ayarlar açıkken ve canlı bağlantı varken, durum bilinmiyorsa yapılır; yalnız is_admin boolean'ı bellekte tutulur
 * (kullanıcı adı ve kimliği saklanmaz, günlüğe ya da rapora girmez). Sonuç açık Ayarlar penceresine bildirilir.
 */
function anahtarYoneticisiniOlc() {
  if (anahtarYonetici !== null || anahtarYoneticiOlcumu) return anahtarYoneticiOlcumu ?? Promise.resolve(anahtarYonetici);
  if (!ws.canliMi() || !anahtarDeposu.varMi() || yetkiDurumu) return Promise.resolve(null);
  const surum = anahtarYoneticiSurumu;
  anahtarYoneticiOlcumu = (async () => {
    try {
      const sonuc = await haOkuma.yoneticiMi({ taze: true });
      if (surum === anahtarYoneticiSurumu && typeof sonuc === 'boolean') {
        anahtarYonetici = sonuc;
        ayarlaraAnahtarYoneticisiniBildir();
      }
    } catch {
      gunluk('Anahtarın kullanıcı türü okunamadı.');
    } finally {
      anahtarYoneticiOlcumu = null;
    }
    return anahtarYonetici;
  })();
  return anahtarYoneticiOlcumu;
}

/** Anahtar değişti ya da silindi: yönetici bilgisi unutulur (yeni anahtar yeniden ölçülür). */
function anahtarYoneticisiniSifirla() {
  anahtarYoneticiSurumu += 1;
  const degisti = anahtarYonetici !== null;
  anahtarYonetici = null;
  anahtarYoneticiOlcumu = null;
  if (degisti) ayarlaraAnahtarYoneticisiniBildir();
}

/** Kesici açıkken tepsi ipucunda ve panelin üstünde görünen kısa durum metni (yok: null). */
function yetkiKisaMetni() {
  if (yetkiDurumu === 'reddedildi') return t('bildirim.anahtarReddedildiKisa');
  if (yetkiDurumu === 'dogrulanamadi') return t('bildirim.anahtarDogrulanamadiKisa');
  if (yetkiDurumu === 'kayit-onayi') return t('bildirim.kayitOnayiKisa');
  if (yetkiDurumu === 'yerel-yasak') return t('bildirim.yerelYasakKisa');
  return null;
}

/** Tepsi menüsündeki durum satırı (yok: null). */
function yetkiMenuMetni() {
  if (yetkiDurumu === 'reddedildi') return t('bildirim.anahtarReddedildiMenu');
  if (yetkiDurumu === 'dogrulanamadi') return t('bildirim.anahtarDogrulanamadiMenu');
  if (yetkiDurumu === 'kayit-onayi') return t('bildirim.kayitOnayiMenu');
  if (yetkiDurumu === 'yerel-yasak') return t('bildirim.yerelYasakMenu');
  return null;
}

/** Son REST hatası YALNIZ canlı bağlantı yokken gösterilir (canlıyken durumlar zaten güncel; eski hata yanıltır). Kesici açıkken kendi uyarısı vardır. */
function gosterilecekHata() {
  if (yetkiDurumu) return null;
  return ws.canliMi() ? null : depo.sonHata;
}

/** Panelin kamera bölümü: onaylı + süzgeçten geçmiş kameralar ve görüntü seçenekleri; hiç yoksa null (bölüm görünmez). */
function kameraBolumu() {
  const liste = kameraModeli({ izinler: kameraIzinleri(), durumAl: (kimlik) => depo.al(kimlik) });
  if (liste.length === 0) return null;
  return { liste, bulanik: ayarlar?.kameraBulanik !== false, yenilemeSn: ayarlar?.kameraYenilemeSn ?? 0 };
}

/** Renderer'a ve tepsi menüsüne giden karo modeli: GÜVENLİK KURALI'ndan geçmeyen favoriler hiç girmez (src/lib/yuzey-modeli.js). */
function yuzeyModeli() {
  const d = ws.durum();
  const model = yuzeyModeliOlustur({
    favoriler: ayarlar?.favoriler ?? [],
    durumAl: (kimlik) => depo.al(kimlik),
    sonKimlikler: son.en(8),
    baglanti: {
      baglanti: d.baglanti,
      canli: d.canli,
      hata: gosterilecekHata() ? hataMetni(gosterilecekHata(), t) : null,
      uyari: yetkiKisaMetni(), // yetki kesici açık: panelin üstünde görünür
      anahtarYok: !anahtarDeposu.varMi(), // boş panel/palette "anahtar yok" ile "favori yok" ayrılır (k-03)
    },
    t,
    sayfalar: ayarlar?.sayfalar ?? [], // 1.4.0 düzen (o-24): panel sekmeleri
    bildirim: bildirimAkisi.model(), // 1.4.0: bildirim şeridi (HA bildirimleri, düşük pil, güncelleme, uyarılar)
    kamera: kameraBolumu(), // 1.4.0 (o-48): yalnız Ayarlar'da onaylı kameralar; görüntü modelde yok (yuzey:kamera ile çekilir)
  });
  // Bilgi kartları (o-04, o-07, o-08, o-10): sensör şeridi, sensör karoları, üst kartlar, takvim ve yapılacaklar; renderer'a rendererModeli ile süzülerek gider.
  bilgiBolumunuEkle(model, { ayarlar, durumAl: (kimlik) => depo.al(kimlik), t });
  model.eylem = eylemEk.modelBolumu(); // 1.4.0 eylem grubu (o-12 geri al...): rendererModeli eylem-modeli.js beyaz listesinden geçirir
  model.gruplar = eylemEk.odaGruplari(model.gruplar); // 1.4.0 eylem grubu (o-14): ayar `oda` iken karolar odalara göre gruplanır (aksi halde aynen)
  // Albüm kapağı (Ayarlar > Bilgi kartları): kapalıysa medya karolarının kapak bayrağı söner, panel kapak istemez.
  return ayarlar?.medyaKapagi === false ? kapaklariKapat(model) : model;
}

/**
 * Yeni yerel pencerelerin (hızlı panel, palet, köşe bildirimi) Windows 11 malzemesi (gorunum-11; src/lib/malzeme.js).
 * Ana HA penceresine uygulanmaz. Sistem desteklemiyorsa ('yok') opak koyu arka plan kullanılır. ayarlar henüz yüklenmeden
 * çağrılırsa varsayılan malzeme (acrylic) hesaplanır.
 */
function yeniPencereMalzemesi() {
  // o-25 / o-29: yüksek karşıtlık malzemeyi kapatır; açık tema ve özel panel arka planı opak ilk boyama rengini belirler.
  const sistemKoyu = sistemKoyuMu(nativeTheme);
  const palet = ozelPalet(ayarlar, { sistemKoyu });
  return pencereMalzemesi(ayarlar?.yeniPencereMalzemesi, os.release(), {
    yuksekKarsitlik: ayarlar?.yuksekKarsitlik === true,
    acikTema: etkinSema(ayarlar?.temaZorla, sistemKoyu) === 'acik',
    arkaPlan: palet ? palet.arkaPlan : null,
  });
}

/**
 * Hızlı panel, palet ve köşe bildirimi sayfalarına giden görünüm modeli (özel/hazır palet, yüksek karşıtlık, kozmetik animasyonlar;
 * src/lib/gorunum.js). Her şey varsayılansa null: yüke hiç eklenmez. Renkler ana süreçte üretilir, sayfa yalnız beyaz listeli değişkenleri yazar.
 */
function gorunumuAl() {
  return gorunumModeli(ayarlar, { malzeme: yeniPencereMalzemesi().malzeme, sistemKoyu: sistemKoyuMu(nativeTheme) });
}

/** Ayarlar > Görünüm > Metin boyutu çarpanı (1, 1.15, 1.3, 1.5); HA penceresine uygulanmaz. */
function metinOlcegiAl() {
  return metinOlcegiOrani(ayarlar?.metinOlcegi);
}

/** Süzülmüş karolar FAVORİ SIRASINDA (tepsi menüsünün "ilk 8 favori" listesi; grup sırası değil). */
function favoriKarolari() {
  return karolariOlustur(ayarlar?.favoriler ?? [], (kimlik) => depo.al(kimlik), t);
}

const eylem = eylemKatmaniOlustur({
  ayarlarAl: () => ayarlar,
  depo,
  canliMi: () => ws.canliMi(),
  haIstek,
  son,
  geriBildirim,
  durumlariYenile: () => durumlariYenile({ zorla: true }),
  onayDiyalogu,
  onayAcikMi: () => acikOnaySayisi > 0,
  onayBekleniyorBildir,
  karolariAl: () => yuzeyModeli().gruplar.flatMap((g) => g.karolar),
  bildirimKayitliMi: (haKimligi) => bildirimAkisi.bildirimKayitliMi(haKimligi), // yalnız panelde gösterilen HA bildirimi kapatılabilir
  t,
  gunluk,
});
// Bilgi kartlarının varlıkları (sensör şeridi, hava, takvim, yapılacaklar listeleri) favori olmasa da okunabilir/yazılabilir kayıtlıdır;
// hat yine alan izin listesini, Kapı Kuralı'nı ve servis izinlerini uygular (sensör/hava/takvim salt okunur).
eylem.kayitKaynagiEkle(bilgiKaydi(() => ayarlar));

/**
 * 1.4.0 eylem grubu (src/lib/eylem-ekleri.js): etkinlik geçmişi (o-17), geri al (o-12), gecikmeli eylem (o-15), son değişenler (o-18),
 * oda grubu / odayı kapat (o-14), palette "diğer cihazlar" (o-46). Hepsi eylem katmanına tek noktadan bağlanır ve eylemleri yine tek
 * güvenli hattan (Kapı Kuralı, sınıf, servis izin listesi, hız sınırı) çalıştırır; dosyalar yalnız <userData> içindedir.
 */
const eylemEk = eylemEkleriOlustur({
  eylem,
  ayarlarAl: () => ayarlar,
  dosyalar: { etkinlik: path.join(app.getPath('userData'), 'etkinlik-gecmisi.json') },
  fs,
  gunluk,
  bildir: geriBildirim, // geri alma özeti, gecikmeli eylem bildirimleri
  saatMetni: (ms) => kullaniciSaatMetni(ms, { saatBicimi: ayarlar?.saatBicimi }),
  t,
  degisti: () => yuzey.modelDegisti(), // geri alma yığını değişti / süresi doldu: panelin "Geri al" düğmesi
  depo, // son değişenler (o-18): bağlayıcının depo dinleyicisi, aşağıdaki modelDegisti dinleyicisinden ÖNCE kurulur
  alanlarAl: () => haOkuma.alanlar(), // oda gruplaması / odayı kapat (o-14): HA alan kaydı (haOkuma aşağıda kurulur; çağrı anında hazırdır)
  haIstek: (yol) => haIstek(yol), // palette "*" favori dışı cihazlar (o-46): yalnız GET /api/states (tek bağımsız değişken: yazma yok)
  favoriEkle: (kayit) => paletFavoriEkle(kayit), // o-46: palet menüsü "Favoriye ekle"
  dilAl: () => etkinDil,
  adAl: (kimlik) => {
    const favori = (ayarlar?.favoriler ?? []).find((f) => f.entity_id === kimlik);
    return favori ? favori.etiket || favori.ad : undefined;
  },
});

/**
 * 1.4.0 okuma uçları (src/lib/ha-okuma.js): geçmiş, takvim, hava tahmini, alan (oda) kaydı, yapılacaklar, kalıcı bildirim
 * aboneliği, yönetici denetimi. Yalnız ana süreçte; REST istekleri korumalı haIstek'ten, WS istekleri canlı bağlantının okuma
 * komutlarından geçer. Hepsi süzgeçli, hız sınırlı; HA yanıt vermezse boş döner. Panel/palet yalnız yuzey:oku ile okur.
 */
const haOkuma = haOkumaOlustur({ haIstek, ws, durumAl: (kimlik) => depo.al(kimlik), gunluk });

/**
 * 1.4.0 kamera anlık görüntüsü (o-48; src/lib/kamera.js). Görüntü korumalı haIstek'ten (yetki kesici, kimlikli kapı, yönlendirme yok) ikili
 * yanıt olarak çekilir; yalnız Ayarlar'da onaylı ve kamera süzgecinden (kapı/zil/giriş elenir) geçen kameralar; diske yazılmaz.
 */
const kamera = kameraServisiOlustur({
  ikiliIstek: async (yol) => {
    const yanit = await haIstek(yol, { ikili: true, enCokBayt: EN_BUYUK_GORUNTU_BAYT });
    return { icerikTuru: yanit.icerikTuru, baytlar: yanit.bayt };
  },
  durumAl: (kimlik) => depo.al(kimlik),
  izinlerAl: kameraIzinleri,
  gunluk,
});

/**
 * 1.4.0 bildirim merkezi ve uyarı kuralları (o-36, o-37, o-39; src/lib/bildirim-akisi.js): HA kalıcı bildirimleri (WS, yalnız okuma),
 * düşük pil / bekleyen güncelleme taraması (10 dk'da bir GET /api/states) ve kullanıcının kurduğu varlık uyarıları tek modelde
 * toplanır; panelin bildirim şeridine ve (ayarlıysa) köşe/Windows bildirimine gider. Hepsi Kapı Kuralı süzgecinden geçer.
 */
const bildirimAkisi = bildirimAkisiOlustur({
  okumaAl: () => haOkuma,
  haIstek: (yol) => haIstek(yol), // yalnız GET /api/states (tek bağımsız değişken: yazma yok)
  depo,
  ayarAl: () => ayarlar,
  goster: (g) => bildirimGoster(g),
  degisti: () => yuzey.modelDegisti(),
  kapatilan: kapatilanDeposuOlustur({ dosyaYolu: path.join(app.getPath('userData'), 'bildirim-kapatilan.json'), fs, gunluk }),
  t,
  gunluk,
});
depo.dinle((kimlikler) => bildirimAkisi.depoDegisti(kimlikler));

const yuzey = yuzeyYoneticisiOlustur({
  modelAl: yuzeyModeli,
  eylem,
  bildirim: bildirimAkisi,
  geriAl: (kaynak) => eylemEk.geriAl(kaynak), // 1.4.0 eylem grubu (o-12): yuzey:geri-al
  eylemEk, // 1.4.0 eylem grubu: yuzey:geciktir, yuzey:gecikmeli-iptal (o-15) ve sonraki uçlar
  tepsiSinirlariAl: () => (tepsi && !tepsi.isDestroyed() ? tepsi.getBounds() : null),
  haAc: () => pencereyiGoster(),
  ayarlarAc: () => ayarlarPenceresiniAc(),
  malzemeAl: yeniPencereMalzemesi,
  ustteAl: () => ayarlar?.panelHerZamanUstte === true, // o-22: görünürken tam ekran uygulamaların da üstünde
  opaklikAl: () => ayarlar?.panelOpaklik ?? 100, // o-32: yalnız opak malzemede uygulanır
  t,
  dilAl: () => etkinDil,
  gunluk,
  okuma: haOkuma,
  sagTik: (kimlik, pencere) => duzen.karoMenusuAc(kimlik, pencere), // 1.4.0 düzen (o-16): karo bağlam menüsü
  gorunumAl: gorunumuAl, // o-25 / o-29 / o-34
  metinOlcegiAl, // o-25
  kamera, // 1.4.0 (o-48): yuzey:kamera
  korumaAl: () => kameraIzinleri().length > 0, // kameraya izin verilmişse panel/palet ekran görüntüsü ve kaydından gizlenir
  etkilesimAl: () => ({ tekerlek: ayarlar?.karoTekerlegi !== false, sabit: ayarlar?.panelSabit === true }), // o-20 fare tekerleği, o-23 panel sabitleme
  sabitDegistir: (sabit) => {
    // o-23: panelin iğne düğmesi. Ayar yazılamazsa eski değer korunur ve hata fırlatılır (sayfa "yapılamadı" ipucu gösterir).
    const onceki = ayarlar.panelSabit === true;
    ayarlar.panelSabit = sabit === true;
    if (!ayarlariYaz()) {
      ayarlar.panelSabit = onceki;
      throw new Error('panelSabit yazilamadi');
    }
    return ayarlar.panelSabit;
  },
  // 1.4.0 dis grubu (o-54): evpaneli:// izni panelde sorulur (disTetikler aşağıda kurulur; köprü yalnız çağrı anında okunur)
  disOnay: {
    al: () => disTetikler.onay.al(),
    yanitla: (bilet, karar) => disTetikler.onay.yanitla(bilet, karar),
    kapandi: () => disTetikler.onay.kapandi(),
  },
});

/**
 * Masaüstüne sabitlenen karolar (o-33, 1.4.0; src/masaustu-karolari.js): ayar `masaustuKarolari` listesindeki FAVORİLER ayrı küçük
 * pencereler olarak durur. Hangi karoların açılacağına src/lib/masaustu-karo.js karar verir (favori + sabitlenebilir alan + Kapı
 * Kuralı + yalnız zararsız eylem); pencere sayfasına yalnız alan beyaz listesi giden bir model gönderilir. Eylemler yine eylem
 * katmanından (kaynak 'masaustu') tek güvenli hattan geçer.
 */
function masaustuKarolariniAl() {
  return sabitlenecekKarolar({ secili: ayarlar?.masaustuKarolari ?? [], favoriler: ayarlar?.favoriler ?? [], durumAl: (kimlik) => depo.al(kimlik), t });
}
const masaustuKarolari = masaustuKarolariOlustur({
  karolariAl: masaustuKarolariniAl,
  modelAl: (kimlik) => {
    const karo = masaustuKarolariniAl().find((k) => k.kimlik === kimlik);
    if (!karo) return null;
    const d = ws.durum();
    return masaustuKaroModeli(karo.karo, { canli: d.canli, baglanti: d.baglanti });
  },
  eylem,
  konumlariAl: () => ayarlar?.masaustuKaroKonumlari ?? {},
  konumKaydet: (kayitlar) => {
    ayarlar.masaustuKaroKonumlari = kayitlar;
    ayarlariYaz();
  },
  ustteAl: () => ayarlar?.masaustuKaroUstte === true,
  ekranlarAl: () => ekranOzetleriAl(screen),
  kaldir: (kimlik) => {
    // Karonun × düğmesi / pencerenin kapatılması: sabitleme listeden çıkar (kimlik hiçbir yerde başka biçimde saklanmaz).
    if (!sabitlenebilirKimlikMi(kimlik)) return;
    ayarlar.masaustuKarolari = (ayarlar.masaustuKarolari ?? []).filter((k) => k !== kimlik);
    ayarlariYaz();
    ayarlaraFavoriDegistiBildir(); // açık Ayarlar sayfası eski listeyle kaydedip karoyu geri getirmesin
  },
  malzemeAl: yeniPencereMalzemesi,
  t,
  dilAl: () => etkinDil,
  gunluk,
});

// Durum değişince panel/palet modeli, tepsi ipucu (açık ışık sayısı) ve masaüstü karoları tazelenir.
depo.dinle(() => {
  yuzey.modelDegisti();
  masaustuKarolari.modelDegisti();
  tepsiyiGuncelle();
  disTetikler.favorilerDegisti(); // Jump List (kısmalı; imza aynıysa yazılmaz): favorinin uygunluğu canlı duruma bağlı olabilir
});

// ---------------------------------------------------------------------------
// Dış tetikler (1.4.0 dis grubu; src/dis-tetikler.js): o-21 Jump List ve masaüstü kısayolu, o-47 PC olayları, o-52 yerel API,
// o-53 toplantı ışığı, o-54 evpaneli:// bağlantısı. Hepsi varsayılan KAPALI; eylemler tek ortak kapıdan (src/lib/dis-tetik.js: seçenek,
// hız sınırı, yalnız zararsız favori, Kapı Kuralı) ve tek güvenli eylem hattından geçer.
// ---------------------------------------------------------------------------

/** Yerel API jetonu: erişim anahtarından AYRI, safeStorage ile şifreli dosya. Renderer'a, günlüğe ve dışa aktarmaya gitmez. */
const apiJetonDeposu = anahtarDeposuOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'yerel-api-jetonu.dat'),
  fs,
  safe: safeStorage,
  gunluk,
});

/** Jump List / masaüstü kısayolu / evpaneli:// kaydının çalıştıracağı dosya: taşınabilir derlemede kalıcı exe, geliştirmede electron + uygulama klasörü. */
function disTetikHedefi() {
  if (tasinabilirMi()) return { program: process.env.PORTABLE_EXECUTABLE_FILE, onek: [] };
  if (app.isPackaged) return { program: process.execPath, onek: [] };
  return { program: process.execPath, onek: [typeof app.getAppPath === 'function' ? app.getAppPath() : KOK_DIZIN] };
}

/** evpaneli:// izni panelde gösterilemezse yedek iletişim kutusu (Enter ve Esc = Reddet). */
async function disOnayDiyalogu(soru) {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: t('dis.onayBaslik'),
    message: t('dis.onaySoru', { ad: soru.ad }),
    detail: t('dis.onayAyrinti'),
    buttons: [t('dis.onayIzin'), t('dis.onayHerZaman'), t('dis.onayReddet')],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  });
  return ['izin', 'herZaman', 'reddet'][response] ?? 'reddet';
}

/**
 * Dış tetik kapısının sonuç olayları (src/lib/dis-tetik.js olay kancası) etkinlik geçmişine (o-17) düşer. Çalıştırılan eylem (başarı ya da
 * hat hatası) zaten eylem katmanından kaynağıyla (jumplist, kisayol-dosyasi, yerel-api, protokol, pc-olayi, toplanti) yazılır; burada YALNIZ
 * kapıda durdurulanlar yazılır, böylece çift kayıt olmaz. Kapı Kuralı'na takılanlar (yasak), hız sınırı ve geçersiz istekler yazılmaz.
 * Kayıt sır, adres, bağlantı metni ya da jeton taşımaz; kimlik/ad kapıdan geçmiş karodandır (geçmiş yine de ikinci kez süzer).
 */
const DIS_TETIK_GECMISE_YAZILANLAR = new Map([
  ['kapali', 'atlandi'],
  ['kaynak-izinsiz', 'atlandi'],
  ['onay-bekliyor', 'atlandi'],
  ['anlik-yok', 'atlandi'],
  ['anahtar-yok', 'atlandi'],
  ['bulunamadi', 'atlandi'],
  ['belirsiz', 'atlandi'],
  ['reddedildi', 'iptal'],
]);
function disTetikOlayiniGecmiseYaz(k) {
  const sonuc = DIS_TETIK_GECMISE_YAZILANLAR.get(k?.sonuc);
  if (!sonuc) return;
  const kayit = { kaynak: k.kaynak, islem: 'dis-tetik', sonuc, neden: k.sonuc };
  if (typeof k.kimlik === 'string' && k.kimlik) {
    kayit.kimlik = k.kimlik;
    if (typeof k.ad === 'string' && k.ad) kayit.ad = k.ad;
  }
  eylemEk.etkinlik.ekle(kayit);
}

const disTetikler = disTetiklerOlustur({
  app,
  shell,
  clipboard,
  fs,
  ayarlarAl: () => ayarlar,
  // Ana sürecin kendi yazdığı alanlar (tetikProtokolIzinleri, tetikPcUyarisi): Ayarlar sayfası bunları göndermez, kaydetme ezmez.
  ayarYaz: (yama) => {
    if (!ayarlar) return;
    Object.assign(ayarlar, yama);
    ayarlariYaz();
  },
  karolarAl: () => yuzeyModeli().gruplar.flatMap((g) => g.karolar),
  eylem, // yalnız kapı (src/lib/dis-tetik.js) eylem.distenCalistir'i çağırır; main.js eylem başlatmaz
  anahtarVarMi: () => anahtarDeposu.varMi(), // erişim anahtarı yoksa dış eylem HA'ya gitmez (komut satırı eylemiyle aynı kural)
  jetonDeposu: apiJetonDeposu,
  hedefAl: disTetikHedefi,
  panelOnayGoster: () => yuzey.disOnayGoster(),
  onayBitti: () => yuzey.disOnayBitti(),
  onayDiyalogu: disOnayDiyalogu,
  geriBildirim,
  t,
  gunluk,
  regSorgula: regSorgulayiciOlustur({ execFile }),
  olay: disTetikOlayiniGecmiseYaz, // etkinlik geçmişi (o-17): kapıda reddedilen / izin verilmeyen dış tetikler
});
// Ayarlar > Dış tetikler açıksa durum (API, izinler, toplantı) değişince sayfa durumu yeniden ister (yük yok, jeton yok).
disTetikler.dinle(() => {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('dis:durum-degisti');
  } catch {
    /* pencere kapanıyor */
  }
});

let bekleyenDisIstegi = null; // hazır olmadan ikinci kopyadan gelen evpaneli:// ya da Jump List / kısayol isteği

/**
 * Dış tetik isteği (disIstegi): evpaneli:// bağlantısı ya da `--eylem --kaynak=jumplist|kisayol`. Bağlantı başka bir komutla birlikte
 * gelirse HİÇBİRİ çalışmaz. Bağlantı metni ve favori adı günlüğe yazılmaz.
 */
function disIstegiIsle(istek, argv, ek) {
  if (istek.tur === 'cakisma') {
    gunluk('Dış tetik isteği başka bir komutla birlikte geldi; hiçbiri çalıştırılmadı.');
    if (ayarlar?.tetikProtokol === true || ayarlar?.tetikJumpList === true || ayarlar?.tetikMasaustu === true) geriBildirim({ tur: 'hata', metin: t('dis.cakisma') });
    return;
  }
  if (istek.tur === 'protokol') {
    disTetikler.protokoldan(istek.metin);
    return;
  }
  if (istek.kaynak === 'gecersiz') {
    gunluk('Komut satırı kaynağı anlaşılamadı; eylem çalıştırılmadı.');
    geriBildirim({ tur: 'hata', metin: t('dis.kaynakGecersiz') });
    return;
  }
  const eylemIstegi = komutSatiriEylemi(typeof ek?.eylem === 'string' ? [`--eylem=${ek.eylem}`] : argv);
  if (!eylemIstegi) {
    komutEylemiIsle(null);
    return;
  }
  disTetikler.komutSatirindan({ ad: eylemIstegi.ad, kaynak: istek.kaynak });
}

// ---------------------------------------------------------------------------
// Düzen: karo bağlam menüsü, düzen geçmişi, onarım (1.4.0 düzen grubu; src/lib/duzen-yoneticisi.js)
// ---------------------------------------------------------------------------

let bekleyenOdakFavori = null; // panel menüsünden "Düzenle…": Ayarlar açılınca bu favoriye odaklanır (bir kez okunur)

/** Panel menüsünden "Düzenle…": Ayarlar açılır / öne gelir ve favori satırına odaklanır. */
function favoriyeGit(kimlik) {
  bekleyenOdakFavori = kimlik;
  ayarlarPenceresiniAc();
  try {
    if (ayarlarPenceresi && !ayarlarPenceresi.isDestroyed() && !ayarlarPenceresi.webContents.isLoading()) {
      ayarlarPenceresi.webContents.send('ayarlar:favoriye-git', kimlik);
      bekleyenOdakFavori = null;
    }
  } catch {
    /* pencere kapanıyor; bekleyen odak ilk ayar özetiyle gider */
  }
}

/** Karo menüsü "Favorilerden kaldır": ana sürecin kendi yerel onay penceresi. Açıkken eylem hattı yeni tıklamaları yutmaz, bildirir (onayAcikMi). */
async function karoKaldirOnayi(ad) {
  acikOnaySayisi += 1;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('karoMenu.kaldirDugme'), t('diyalog.vazgec')],
      defaultId: 1, // Enter'a yanlışlıkla basmak kaldırmasın
      cancelId: 1,
      noLink: true,
      title: uygulamaAdi(),
      message: t('karoMenu.kaldirMesaj', { ad: kisalt(ad, AD_SINIRI) }),
      detail: t('karoMenu.kaldirAyrinti'),
    });
    return response === 0;
  } catch {
    return false;
  } finally {
    acikOnaySayisi -= 1;
  }
}

/** Menüyü imleç konumunda açar; kapanınca çözülür. Pencere kapanmışsa ya da menü kurulamazsa sessizce çözülür. */
function karoMenusunuGoster(sablon, pencere) {
  return new Promise((coz) => {
    try {
      Menu.buildFromTemplate(sablon).popup({ window: pencere && !pencere.isDestroyed() ? pencere : undefined, callback: () => coz() });
    } catch {
      gunluk('Karo menüsü gösterilemedi.');
      coz();
    }
  });
}

const duzen = duzenYoneticisiOlustur({
  ayarlarAl: () => ayarlar,
  yaz: () => ayarlariYaz(),
  gecmis: duzenGecmisi,
  karoAl: (kimlik) => yuzeyModeli().gruplar.flatMap((g) => g.karolar).find((k) => k.id === kimlik),
  menuAc: karoMenusunuGoster,
  onayIste: karoKaldirOnayi,
  duzenleAc: favoriyeGit,
  degisti: ({ yalnizModel = false, ayarlardan = false } = {}) => {
    if (yalnizModel) yuzey.modelDegisti();
    else izlenenleriYenile();
    if (!ayarlardan) ayarlaraFavoriDegistiBildir(); // açık Ayarlar eski listeyle kaydetmesin
  },
  cihazAl: () => cihazOnbellegi,
  // Karo menüsü "Masaüstüne sabitle" (1.4.0): Ayarlar'daki aynı `masaustuKarolari` listesi; yazılınca karo pencereleri eşitlenir
  masaustuAl: () => [...(ayarlar?.masaustuKarolari ?? [])],
  masaustuKaydet: (liste) => {
    ayarlar.masaustuKarolari = liste;
    const yazildi = ayarlariYaz();
    masaustuKarolari.esitle();
    return yazildi;
  },
  menuMetni,
  t,
  gunluk,
  hataBildir: (metin) => geriBildirim({ tur: 'hata', metin }),
});

// ---------------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------------

/** Bildirime tıklayınca Ayarlar açılır (k-10): "Ayarlar’dan yeni anahtar kaydet" gibi bildirimler için `bildir` üçüncü bağımsız değişkeni. */
const AYARLARI_AC = Object.freeze({ tikla: () => ayarlarPenceresiniAc() });
const acikBildirimler = new Set(); // gösterilen Windows bildirimleri: tıklama olayı gelene kadar çöp toplayıcıya kaptırılmasın

/**
 * Windows bildirimi. `tikla` verilirse bildirime tıklayınca çağrılır (k-10; hata fırlatsa da uygulamayı düşürmez).
 * @param {string} govde
 * @param {string} [baslik]
 * @param {{tikla?: () => void}} [secenek]
 */
function bildir(govde, baslik = uygulamaAdi(), { tikla } = {}) {
  try {
    if (!Notification.isSupported()) return;
    const ikon = nativeImage.createFromPath(IKON_PNG);
    const bildirim = new Notification({
      title: baslik,
      body: govde,
      silent: true,
      icon: ikon.isEmpty() ? undefined : ikon,
    });
    sonBildirim = bildirim;
    if (typeof bildirim.on === 'function') {
      acikBildirimler.add(bildirim);
      const birak = () => acikBildirimler.delete(bildirim);
      bildirim.on('close', birak);
      bildirim.on('failed', birak);
      bildirim.on('click', () => {
        birak();
        if (typeof tikla !== 'function') return;
        try {
          tikla();
        } catch {
          gunluk('Bildirim tıklaması işlenemedi.');
        }
      });
    }
    bildirim.show();
  } catch {
    gunluk('Bildirim gösterilemedi.');
  }
}

// Köşe bildirimi: odak almayan küçük pencere (src/kose-bildirim.js). Yüklenemezse bekleyen bildirim Windows'a düşer.
const kose = koseBildirimiOlustur({
  gunluk,
  malzemeAl: yeniPencereMalzemesi,
  engelAl: () => yuzey.gorunenSinirlar(), // açık panelin üstüne yerleşsin (g-09)
  dilAl: () => etkinDil,
  gorunumAl: gorunumuAl, // o-25 / o-29 / o-34
  metinOlcegiAl, // o-25
  yedekGoster: ({ tur, metin }) => bildir(metin, tur === 'hata' ? t('uygulama.hataBaslik') : uygulamaAdi()),
});

/**
 * Eylem sonucu anında geri bildirimi (hiz-04): köşe bildirimi (ayarda açıksa), isteğe bağlı bip (yalnız başarıda) ve
 * Windows bildirimi YALNIZ hatada. Köşe penceresi hiç oluşturulamazsa başarı da Windows bildirimine düşer.
 */
function geriBildirim({ tur, metin, baslik = uygulamaAdi() }) {
  const hata = tur === 'hata';
  // ayarlar henüz yüklenmeden çağrılabilir (ör. açılışta gelen komut satırı eylemi): hata yutulmaz, varsayılanlarla gösterilir
  const bip = !!ayarlar?.bipSesi;
  const koseAcik = ayarlar ? !!ayarlar.koseBildirimi : true;
  if (!hata && bip) {
    try {
      shell.beep();
    } catch {
      /* ses çalınamadı */
    }
  }
  let koseGosterildi = false;
  if (koseAcik) koseGosterildi = kose.goster({ tur: hata ? 'hata' : 'ok', metin });
  if (hata || (koseAcik && !koseGosterildi)) bildir(metin, baslik);
}

/**
 * Bildirim merkezi ve uyarı kuralı gösterimi (1.4.0; bildirim-akisi.js `goster`): köşe bildirimi ('bilgi' türü, 6 sn, sıralı) ve
 * yalnız kural "Windows bildirimi de" dediyse Windows bildirimi. Metinler akışta Kapı Kuralı süzgecinden geçmiştir. Ayarlar'daki
 * "köşe bildirimi" kapalıysa köşe penceresi hiç çıkmaz (öğeler panelin bildirim şeridinde kalır); köşe penceresi oluşturulamazsa
 * bildirim Windows'a düşer (yedekGoster). Windows bildirimi başlığı kuraldır, gövdesi bildirim metnidir; tıklama işlemi yoktur.
 */
function bildirimGoster({ baslik, metin, simge, windows }) {
  const koseAcik = ayarlar ? !!ayarlar.koseBildirimi : true;
  let koseGosterildi = false;
  if (koseAcik) koseGosterildi = kose.goster({ tur: 'bilgi', metin: merkezKoseMetni(baslik, metin, t), simge });
  if (windows === true) bildir(metin, t('uyari.windowsBaslik'));
  else if (koseAcik && !koseGosterildi) bildir(metin, baslik);
}

/** Bildirim akışını başlatır ve ayar değişimlerine bağlar (açılışta bir kez; ayarlar yüklendikten sonra). */
function bildirimAkisiniBaslat() {
  for (const ad of ['bildirimKalici', 'bildirimPil', 'bildirimGuncelleme', 'bildirimPilEsigi', 'bildirimMasaustu']) ekAyarDinle(ad, () => bildirimAkisi.ayarDegisti());
  ekAyarDinle('uyariKurallari', () => {
    bildirimAkisi.ayarDegisti();
    // Kuralların varlıkları izlenen kümeye girer/çıkar: depo budanır, canlı abonelik yeni kümeyle yenilenir (REST yedeğinde hemen okunur).
    depo.buda(izlenenKimlikler());
    if (ws.canliMi()) ws.abonelikYenile();
    else if (ayarlar?.canliBaglanti !== false) ws.yenidenBaglan();
    if (!ws.canliMi()) durumlariYenile({ zorla: true });
  });
  bildirimAkisi.baslat();
}

// ---------------------------------------------------------------------------
// Mobil bildirimler (o-61): HA mobile_app kaydı, itme kanalı ve bildirim düğmeleri
// ---------------------------------------------------------------------------
// Varsayılan KAPALI ve açık rıza ile: Ayarlar > Mobil bildirimler > "Kaydol" (onay penceresiyle) bu bilgisayarı HA'ya mobile_app cihazı olarak
// kaydeder (src/lib/mobil-kayit.js). Webhook kimliği safeStorage dosyasındadır (ayara/günlüğe/dışa aktarmaya girmez). Gelen bildirimler WS itme
// kanalından alınır, Kapı Kuralı süzgecinden geçer: düğmesizler Windows bildirimi, düğmeliler küçük kart olur (src/itme-kart.js). Düğmeye basınca
// webhook'a TEK ileti (mobile_app_notification_action olayı) gider. Hiçbir sensör/konum/cihaz bilgisi HA'ya yollanmaz. Kayıt POST'u haIstek'ten
// (bu dosyada POST yok), webhook ha-istemcisi.js webhookGonder'den geçer (yetki kesici, kapı, tek deneme).
const mobilDeposu = anahtarDeposuOlustur({
  dosyaYolu: path.join(app.getPath('userData'), 'mobil-kayit.dat'),
  fs,
  safe: safeStorage,
  gunluk,
});
let mobilKayitAdi = ''; // "Kaydol" isteğinin cihaz adı (yalnız o kayıt isteği sürerken dolu)
let mobilIslemde = false; // kaydol / kaydı sil aynı anda bir tane

const itmeKart = itmeKartiOlustur({
  gunluk,
  malzemeAl: yeniPencereMalzemesi,
  engelAl: () => yuzey.gorunenSinirlar(),
  dilAl: () => etkinDil,
  gorunumAl: gorunumuAl,
  metinOlcegiAl,
  varsayilanBaslikAl: () => t('mobil.varsayilanBaslik'),
  yedekGoster: (b) => bildir(b.mesaj, b.baslik ?? t('mobil.varsayilanBaslik')), // kart açılamazsa ileti Windows bildirimi olarak yine görünür
});

/** Ayarlar > Mobil bildirimler durumu (sır YOK: webhook kimliği, adres, anahtar girmez). */
function mobilDurumu() {
  const d = mobilKayit.durum();
  return {
    ok: true,
    kayitli: d.kayitli,
    etkin: d.etkin,
    kanal: d.kanal, // 'kayitsiz' | 'kapali' | 'bekliyor' | 'dinliyor' | 'kayit-yok' | 'yetkisiz' | 'destek-yok'
    kayitSuruyor: d.kayitSuruyor,
    sonBildirim: d.sonBildirim,
    dusenBildirim: d.dusenBildirim,
    canliAcik: ayarlar?.canliBaglanti !== false, // canlı bağlantı kapalıysa itme kanalı hiç açılmaz
  };
}

function mobilDurumunuYay() {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('mobil:degisti', { ...mobilDurumu(), mobilBildirimler: ayarlar?.mobilBildirimler === true });
  } catch {
    /* pencere kapanıyor */
  }
}

/** HA'dan gelen çözülmüş bildirim: düğmeliyse kart, değilse Windows bildirimi. Aynı etiketli eski kart yenisiyle yer değiştirir. */
function mobilBildirimGoster(b) {
  if (b.dugmeler.length > 0) {
    itmeKart.goster(b);
    return;
  }
  if (b.etiket !== null) itmeKart.temizle(b.etiket);
  bildir(b.mesaj, b.baslik ?? t('mobil.varsayilanBaslik'));
}

// Sözlük anahtarları açık yazılır (dinamik birleştirme yok): kullanılmayan anahtar testle yakalanır.
const MOBIL_UYARI_ANAHTARLARI = Object.freeze({ 'kayit-yok': 'mobil.uyari.kayitYok', yetkisiz: 'mobil.uyari.yetkisiz', 'destek-yok': 'mobil.uyari.destekYok' });
const MOBIL_HATA_ANAHTARLARI = Object.freeze({
  mesgul: 'mobil.hata.mesgul',
  sifreleme: 'mobil.hata.sifreleme',
  yanit: 'mobil.hata.yanit',
  yazilamadi: 'mobil.hata.yazilamadi',
  bulunamadi: 'mobil.hata.bulunamadi',
  belirsiz: 'mobil.hata.belirsiz',
  gecikti: 'mobil.hata.belirsiz',
  gecersiz: 'mobil.hata.gecersiz',
  kapali: 'mobil.hata.kapali',
  kayitsiz: 'mobil.hata.kayitsiz',
  'cok-sik': 'mobil.hata.cokSik',
  'kayit-yok': 'mobil.hata.kayitYok',
});

/** Kaydol / eylem hata sonucu -> kullanıcı metni (adres, kimlik ve ham ileti içermez). */
function mobilHataMetni(sonuc) {
  const tur = sonuc?.hata;
  if (typeof tur === 'string' && Object.hasOwn(MOBIL_HATA_ANAHTARLARI, tur)) return t(MOBIL_HATA_ANAHTARLARI[tur]);
  return hataMetni({ tur, durumKodu: sonuc?.durumKodu }, t);
}

/** İtme kanalı kalıcı olarak kapandı (HA kaydı tanımıyor / başka kullanıcı / komut yok): kartlar kalkar, kullanıcıya tek bildirim gider. */
function mobilKanalKapandi(tur) {
  itmeKart.hepsiniKapat();
  if (tur === 'kayit-yok' && ayarlar) {
    ayarlar.mobilBildirimler = false; // yerel kayıt zaten silindi; kanal kapalı
    ayarlariYaz();
  }
  if (Object.hasOwn(MOBIL_UYARI_ANAHTARLARI, tur)) bildir(t(MOBIL_UYARI_ANAHTARLARI[tur]), uygulamaAdi(), { tikla: () => ayarlarPenceresiniAc('bolumMobil') });
  mobilDurumunuYay();
}

const mobilKayit = mobilKayitOlustur({
  haIstek,
  webhookGonder: (webhookKimligi, govde) => haIstemcisi.webhookGonder(webhookKimligi, govde),
  depo: mobilDeposu,
  ws,
  etkinMi: () => ayarlar?.mobilBildirimler === true,
  cihazAdiAl: () => mobilKayitAdi || ayarlar?.mobilCihazAdi || '',
  kimlik: () => ({ uygulamaKimligi: UYGULAMA_KIMLIGI, uygulamaAdi: uygulamaAdi(), surum: uygulamaSurumu(), osSurumu: `Windows ${os.release()}` }),
  goster: mobilBildirimGoster,
  temizle: (etiket) => itmeKart.temizle(etiket),
  uyari: mobilKanalKapandi,
  durumDegisti: mobilDurumunuYay,
  gunluk,
});

/** Kaydol onayı: ana sürecin kendi yerel penceresi (varsayılan düğme "Vazgeç"). true = kaydol. */
async function mobilKaydolOnayi(cihazAdi) {
  try {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: [t('mobil.kaydolDugme'), t('diyalog.vazgec')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: uygulamaAdi(),
      message: t('mobil.kaydolMesaj', { ad: kisalt(cihazAdi, 40) }),
      detail: t('mobil.kaydolAyrinti'),
    });
    return response === 0;
  } catch {
    return false;
  }
}

/** Kaydı sil onayı. true = sil. */
async function mobilSilOnayi() {
  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('mobil.silDugme'), t('diyalog.vazgec')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: uygulamaAdi(),
      message: t('mobil.silMesaj'),
      detail: t('mobil.silAyrinti'),
    });
    return response === 0;
  } catch {
    return false;
  }
}

/** Ayarlar "Kaydol": cihaz adı doğrulanır, onay alınır, HA'ya TEK kayıt isteği gider; başarılıysa itme kanalı açılır. */
async function mobilKaydol(girdi) {
  if (mobilIslemde) return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.mesgul') };
  mobilIslemde = true;
  try {
    const dogrulama = ekGirdiDogrula({ mobilCihazAdi: typeof girdi?.cihazAdi === 'string' ? girdi.cihazAdi : '' }, t);
    if (dogrulama.uyarilar.length > 0) return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.cihazAdi') };
    const cihazAdi = dogrulama.yeni.mobilCihazAdi ?? ''; // boşsa HA'ya uygulama adı gider (ayarda boş kalır)
    if (mobilKayit.durum().kayitli) return { ...mobilDurumu(), ok: true, sonuc: 'zaten', mobilBildirimler: ayarlar?.mobilBildirimler === true };
    if (!(await mobilKaydolOnayi(cihazAdi || uygulamaAdi()))) return { ...mobilDurumu(), ok: true, sonuc: 'vazgecildi' };
    mobilKayitAdi = cihazAdi || uygulamaAdi();
    const sonuc = await mobilKayit.kaydol();
    mobilKayitAdi = '';
    if (!sonuc.ok) {
      gunluk(`Mobil kayıt yapılamadı (${typeof sonuc.hata === 'string' ? sonuc.hata : 'bilinmiyor'}).`);
      return { ...mobilDurumu(), ok: false, hata: mobilHataMetni(sonuc) };
    }
    ayarlar.mobilBildirimler = true; // kullanıcı kaydolmayı onayladı: kanal açılır (Ayarlar'daki kutu da buna göre güncellenir)
    ayarlar.mobilCihazAdi = cihazAdi;
    ayarlariYaz();
    await mobilKayit.baslat();
    return { ...mobilDurumu(), ok: true, sonuc: 'kaydoldu', mobilBildirimler: true, mobilCihazAdi: cihazAdi };
  } catch {
    gunluk('Mobil kayıt tamamlanamadı.');
    return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.bilinmiyor') };
  } finally {
    mobilKayitAdi = '';
    mobilIslemde = false;
    mobilDurumunuYay();
  }
}

/** Ayarlar "Kaydı sil": onaydan sonra yerel kayıt (webhook kimliği) silinir, kanal kapanır. HA'daki cihaz girdisini kullanıcı HA'dan kaldırır. */
async function mobilKaydiSil() {
  if (mobilIslemde) return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.mesgul') };
  mobilIslemde = true;
  try {
    if (!mobilKayit.durum().kayitli) return { ...mobilDurumu(), ok: true, sonuc: 'yok', mobilBildirimler: ayarlar?.mobilBildirimler === true };
    if (!(await mobilSilOnayi())) return { ...mobilDurumu(), ok: true, sonuc: 'vazgecildi' };
    itmeKart.hepsiniKapat();
    const sonuc = await mobilKayit.kaydiSil();
    if (!sonuc.ok) return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.silinemedi') };
    ayarlar.mobilBildirimler = false;
    ayarlariYaz();
    return { ...mobilDurumu(), ok: true, sonuc: 'silindi', mobilBildirimler: false };
  } catch {
    gunluk('Mobil kayıt silinemedi.');
    return { ...mobilDurumu(), ok: false, hata: t('mobil.hata.bilinmiyor') };
  } finally {
    mobilIslemde = false;
    mobilDurumunuYay();
  }
}

/** Kartın düğmesi: kart numarası ve düğme SIRASI doğrulanır (itme-kuyrugu.js), eylem kimliği ana süreçte çözülür ve webhook'a tek ileti gider. */
async function itmeEylemi(girdi) {
  const secim = itmeKart.eylemSec(girdi?.kartNo, girdi?.sira);
  if (!secim) return { ok: false };
  const sonuc = await mobilKayit.eylemGonder(secim.eylem, secim.etiket);
  // etkinlik geçmişi (o-17): düğmenin başlığı ve eylem kimliği yazılmaz, yalnız basıldığı ve sonucu
  eylemEk.etkinlik.ekle({ kaynak: 'bildirim', islem: 'bildirim-dugme', sonuc: sonuc.ok ? 'ok' : 'hata', ...(sonuc.ok ? {} : { neden: typeof sonuc.hata === 'string' && /^[a-z][a-z0-9_-]{1,38}$/.test(sonuc.hata) ? sonuc.hata : 'hata' }) });
  if (sonuc.ok) geriBildirim({ tur: 'ok', metin: t('mobil.eylem.gitti') });
  else geriBildirim({ tur: 'hata', metin: t('mobil.eylem.hata', { neden: mobilHataMetni(sonuc) }) });
  return { ok: sonuc.ok === true };
}

// ---------------------------------------------------------------------------
// Ana pencere
// ---------------------------------------------------------------------------

function disariAc(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) {
      // Sayfa sessizce başka bir uygulamada açılmasın: açılınca köşede kısa bilgi görünür (k-20; ayarda köşe bildirimi açıksa).
      shell
        .openExternal(u.toString())
        .then(() => {
          if (ayarlar?.koseBildirimi !== false) kose.goster({ tur: 'ok', metin: t(u.protocol === 'mailto:' ? 'sonuc.epostaAcildi' : 'sonuc.tarayicidaAcildi') });
        })
        .catch(() => {});
    }
  } catch {
    /* geçersiz adres: yok say */
  }
}

/** HA içeriği gösteren her pencereye (ana pencere ve HA'nın açtığı alt pencereler) uygulanır. */
function haGezinmeKorumalari(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (izinliKokenMi(kokenAl(url))) {
      // Aynı HA'dan açılan pencere (ör. eklenti arayüzü): aynı oturumla, aynı kısıtlarla.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 760,
          autoHideMenuBar: true,
          icon: IKON_ICO,
          webPreferences: guvenliWebTercihleri({ partition: HA_BOLUMU }),
        },
      };
    }
    disariAc(url);
    return { action: 'deny' };
  });

  wc.on('did-create-window', (cocuk) => {
    // Alt pencere odaktayken ana pencere "odak kaybında gizle" ile kaybolmasın (pencere-01).
    haAltPencereleri.add(cocuk);
    // Alt pencere odağı başka yere bırakırsa ya da kapanırsa ana pencere de "başka yere tıklayınca gizle" kuralına uyar (k-17).
    cocuk.on('blur', altPencereOdakKaybi);
    cocuk.once('closed', () => {
      haAltPencereleri.delete(cocuk);
      altPencereOdakKaybi();
    });
    haGezinmeKorumalari(cocuk.webContents);
  });

  wc.on('will-navigate', (olay) => {
    if (izinliKokenMi(kokenAl(olay.url))) return;
    olay.preventDefault();
    disariAc(olay.url);
  });

  wc.on('will-redirect', (olay) => {
    if (!olay.isMainFrame || izinliKokenMi(kokenAl(olay.url))) return;
    olay.preventDefault();
    disariAc(olay.url);
  });
}

function anaPencereOlustur() {
  // Konum verilmez: pencere her gösterimde imlecin bulunduğu monitörde ortalanır (pencereyiYerlestir).
  fizikselMod = ayarlar.pencereBoyutu;
  const kayit = ayarlar.pencere[fizikselMod];
  const secenekler = {
    width: kayit.width,
    height: kayit.height,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: uygulamaAdi(),
    icon: IKON_ICO,
    autoHideMenuBar: true,
    backgroundColor: '#14161b',
    webPreferences: guvenliWebTercihleri({ partition: HA_BOLUMU, preload: PRELOAD }),
  };
  anaPencere = new BrowserWindow(secenekler);
  vurguyuUygula(anaPencere);
  anaPencereOpaklikUygula(); // o-32: yeniden oluşturulan pencere de ayardaki opaklıkla açılır
  const wc = anaPencere.webContents;

  haGezinmeKorumalari(wc);

  anaPencere.on('close', (olay) => {
    if (cikiliyor || oturumKapaniyor) return;
    olay.preventDefault();
    pencereyiGizle();
    if (!ayarlar.tepsiIpucuGosterildi) {
      ayarlar.tepsiIpucuGosterildi = true;
      ayarlariYaz();
      bildir(t('bildirim.tepsiIpucu'));
    }
  });

  // Windows oturumu kapanırken gizlemeye çalışma, gerçekten kapan (hata-06). Sorgu İPTAL edilebilir (başka bir
  // uygulama kapatmayı engelleyebilir); bu yüzden yalnız geçici bayrak kurulur ve 15 sn içinde session-end
  // gelmezse sıfırlanır: pencere yine tepsiye gizlenir. cikiliyor YALNIZ gerçek çıkışta (session-end,
  // before-quit, "Çıkış") kurulur.
  anaPencere.on('query-session-end', () => {
    oturumKapaniyor = true;
    clearTimeout(oturumKapanmaZamanlayicisi);
    oturumKapanmaZamanlayicisi = setTimeout(() => {
      oturumKapaniyor = false;
    }, OTURUM_KAPANMA_BEKLEME_MS);
  });
  anaPencere.on('session-end', () => {
    cikiliyor = true;
    oturumKapaniyor = true;
    pencereDurumunuKaydet({ zorla: true });
  });

  for (const olay of ['resize', 'move']) anaPencere.on(olay, pencereDurumunuGecikmeliKaydet);
  anaPencere.on('maximize', () => pencereDurumunuKaydet());
  anaPencere.on('unmaximize', () => pencereDurumunuKaydet());

  // Odak kaybında gizle (pencere-01): kısa gecikmeyle; tepsi tıklaması ya da yeniden odak bunu iptal eder.
  anaPencere.on('blur', odakKaybiniBaslat);
  anaPencere.on('focus', odakGeldi);

  // Fare "Geri/İleri" tuşları (Windows app-command; denenmedi).
  anaPencere.on('app-command', (_olay, komut) => {
    if (komut === 'browser-backward') gecmiseGit(-1);
    else if (komut === 'browser-forward') gecmiseGit(1);
  });

  anaPencere.on('page-title-updated', (olay, baslik) => {
    olay.preventDefault();
    if (gosterilenSayfa === 'ha') {
      haSayfaBasligi = String(baslik || '')
        .replace(/\s+[–-]\s+Home Assistant$/, '')
        .slice(0, 80);
    }
    basligiGuncelle();
  });

  wc.on('did-navigate', (_olay, url, httpKodu) => {
    if (url.startsWith('file:')) {
      // Uygulamanın kendi durum sayfası yüklemesi (durumSayfasiGoster) gosterilenSayfa'yı ÖNCEDEN ayarlar. HA sayfasındayken
      // yerel sayfa gelirse (HA'nın kendi geri okuyla geçmişteki durum sayfasına dönüldü) bu İSTENMEMİŞTİR: pencere orada
      // takılıp kalmasın diye aşağıda yeniden bağlanılır (h-35).
      const istenmedi = gosterilenSayfa === 'ha';
      try {
        gosterilenSayfa = new URL(url).searchParams.get('durum') === 'baglaniyor' ? 'baglaniyor' : 'cevrimdisi';
      } catch {
        gosterilenSayfa = 'cevrimdisi';
      }
      haSayfaBasligi = '';
      if (istenmedi) {
        gunluk('HA sayfasından yerel durum sayfasına geri dönüldü; yeniden bağlanılıyor.');
        gosterilenSayfa = 'baglaniyor'; // baglan() durum sayfasını yeniden yüklemesin (sayfa zaten açık)
        aktifAdres = null;
        baglantiTuru = null;
        denemeSayaci = 0;
        basligiGuncelle();
        baglan();
        return;
      }
    } else {
      durumSayfasiHazir = false;
      // Sayfa yüklendi ama sunucu 5xx/403 döndürdüyse (ör. Cloudflare hata sayfası) "bağlandı" sayılmaz:
      // çevrimdışı ekrana alınır, geri çekilmeli denemeler başlar (hata-02).
      if (sayfaYanitiBozukMu(httpKodu)) {
        gunluk(`Sayfa bozuk yanıt verdi: HTTP_${httpKodu}`);
        haIstemcisi.secimiSifirla();
        cevrimdisiGoster(`HTTP_${httpKodu}`);
        return;
      }
      const koken = kokenAl(url);
      gosterilenSayfa = 'ha';
      aktifAdres = koken;
      denemeSayaci = 0; // başarılı bağlantı: artan bekleme başa döner
      if (koken === ayarlar.yerelAdres) baglantiTuru = 'yerel';
      else if (koken === ayarlar.disAdres) baglantiTuru = 'dis';
      else baglantiTuru = null;
    }
    basligiGuncelle();
  });

  // offline.html yüklendi: sonraki durum değişiklikleri yeniden yükleme yerine yerinde güncellenebilir.
  wc.on('did-finish-load', () => {
    if (wc.getURL().startsWith('file:')) durumSayfasiHazir = true;
  });

  // Yakınlaştırma düzeyi (Ctrl +/-/0) kalıcıdır; HA sayfası her yüklendiğinde yeniden uygulanır.
  wc.on('dom-ready', () => {
    if (!wc.getURL().startsWith('file:')) wc.setZoomLevel(ayarlar.yakinlastirma);
  });
  wc.on('zoom-changed', (_olay, yon) => yakinlastir(yon === 'in' ? 1 : -1)); // Ctrl + fare tekerleği

  wc.on('did-fail-load', (_olay, kod, aciklama, url, anaCerceve) => {
    if (!anaCerceve || kod === -3 /* ERR_ABORTED: başka bir yüklemeyle iptal */) return;
    if (String(url).startsWith('file:')) return;
    const hataKodu = /^[A-Z0-9_]+$/.test(String(aciklama)) ? String(aciklama) : `HATA_${kod}`;
    gunluk(`Sayfa yüklenemedi: ${hataKodu}`);
    // Chromium başarısız yüklemede kendi hata sayfasını offline.html'in yerine koyabilir: yerinde güncelleme
    // ölü sayfaya gitmesin, durum sayfası yeniden yüklensin.
    durumSayfasiHazir = false;
    cevrimdisiGoster(hataKodu);
  });

  // Sayfa süreci çöktü: artan beklemeyle yeniden yükle; 10 dk içinde 5 çökmeden sonra DUR (hata-06).
  wc.on('render-process-gone', (_olay, ayrinti) => {
    const neden = ayrinti?.reason;
    if (cikiliyor || oturumKapaniyor || !cokmeSayilirMi(neden)) return;
    durumSayfasiHazir = false;
    const simdi = Date.now();
    cokmeZamanlari = [...cokmeZamanlari, simdi].slice(-COKME_KAYIT_SINIRI);
    const karar = cokmeKarari(cokmeZamanlari, simdi);
    clearTimeout(cokmeZamanlayicisi);
    cokmeZamanlayicisi = null;
    if (karar.dur) {
      gunluk(`Sayfa süreci art arda çöktü (${cokmeNedeniMetni(neden)}, ${karar.sayi} kez); otomatik yeniden yükleme durduruldu.`);
      cevrimdisiGoster('COKME', { otomatik: false });
      return;
    }
    gunluk(`Sayfa süreci kapandı (${cokmeNedeniMetni(neden)}); ${karar.bekleMs / 1000} sn sonra yeniden bağlanılacak.`);
    cokmeZamanlayicisi = setTimeout(() => {
      cokmeZamanlayicisi = null;
      baglan();
    }, karar.bekleMs);
  });

  // Pencere içi kısayollar (src/lib/tus-eylemi.js): yenile, tam ekran, gizle, yakınlaştırma, geri/ileri.
  wc.on('before-input-event', (olay, girdi) => {
    const eylem = tusEylemi(girdi);
    if (!eylem) return;
    olay.preventDefault();
    tusEylemiCalistir(eylem);
  });
}

function tusEylemiCalistir(eylem) {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  switch (eylem) {
    case 'yenile':
      yenile();
      break;
    case 'yenile-onbellek':
      yenile({ onbellegiYoksay: true });
      break;
    case 'tamekran':
      anaPencere.setFullScreen(!anaPencere.isFullScreen());
      break;
    case 'gizle':
      pencereyiGizle();
      break;
    case 'yakin-art':
      yakinlastir(1);
      break;
    case 'yakin-eksi':
      yakinlastir(-1);
      break;
    case 'yakin-sifir':
      yakinlastir(0);
      break;
    case 'geri':
      gecmiseGit(-1);
      break;
    case 'ileri':
      gecmiseGit(1);
      break;
    case 'boyut-degistir':
      pencereBoyutuDegistir(ayarlar.pencereBoyutu === 'hizli' ? 'genis' : 'hizli');
      break;
    default:
  }
}

/** Yakınlaştırma yalnız HA sayfasında; düzey ayara yazılır (gecikmeli). yon: 1 yakınlaş, -1 uzaklaş, 0 sıfırla. */
function yakinlastir(yon) {
  if (gosterilenSayfa !== 'ha' || !anaPencere || anaPencere.isDestroyed()) return;
  const seviye = yakinlastirmaDegistir(ayarlar.yakinlastirma, yon);
  ayarlar.yakinlastirma = seviye;
  anaPencere.webContents.setZoomLevel(seviye);
  clearTimeout(yakinlastirmaKayitZamanlayicisi);
  yakinlastirmaKayitZamanlayicisi = setTimeout(() => ayarlariYaz(), 500);
}

/** Geri/ileri (navigationHistory). Uygulamanın kendi durum sayfaları (file:) atlanır. */
function gecmiseGit(yon) {
  if (gosterilenSayfa !== 'ha' || !anaPencere || anaPencere.isDestroyed()) return;
  const gecmis = anaPencere.webContents.navigationHistory;
  const adresler = gecmis.getAllEntries().map((girdi) => girdi.url);
  const sapma = gecmisOffseti(adresler, gecmis.getActiveIndex(), yon);
  if (sapma !== null && gecmis.canGoToOffset(sapma)) gecmis.goToOffset(sapma);
}

// ---------------------------------------------------------------------------
// Pencere boyutu, konumu ve gizlenme davranışı
// ---------------------------------------------------------------------------

function pencereDurumunuKaydet({ zorla = false } = {}) {
  if (!anaPencere || anaPencere.isDestroyed() || !ilkGosterimYapildi) return;
  if (!zorla && Date.now() < yerlesimBitisi) return; // programla yerleştirildi: kullanıcı boyutu değil
  if (anaPencere.isFullScreen() || anaPencere.isMinimized()) return;
  // Yuva ve değer kararı src/lib/pencere-yerlesim.js'de: fiziksel pencerenin modu (ayardaki etkin mod gizliyken
  // değişmiş olabilir) ve yerleştirme hedefinde kalan (kısılmış) boyutun kullanıcı boyutu sayılmaması.
  const sonuc = pencereKaydiHesapla({
    fizikselMod,
    normalSinirlar: anaPencere.getNormalBounds(),
    buyutulmus: anaPencere.isMaximized(),
    hedef: yerlesimHedefi,
    mevcut: ayarlar.pencere,
  });
  // 1.4.0 (o-32): konum modu "hatırla" ise pencerenin konumu da (boyut moduna göre) kaydedilir; yerleştirme hedefinde kalan konum kayıt sayılmaz.
  const konumlar = pencereKonumKaydiHesapla({
    konumModu: ayarlar.pencereKonumu,
    fizikselMod,
    normalSinirlar: anaPencere.getNormalBounds(),
    hedef: yerlesimHedefi,
    mevcut: ayarlar.pencereKonumlari,
  });
  if (!sonuc && !konumlar) return;
  if (sonuc) ayarlar.pencere[sonuc.yuva] = sonuc.kayit;
  if (konumlar) ayarlar.pencereKonumlari = konumlar;
  ayarlariYaz();
}

function pencereDurumunuGecikmeliKaydet() {
  clearTimeout(pencereKayitZamanlayicisi);
  pencereKayitZamanlayicisi = setTimeout(() => pencereDurumunuKaydet(), 500);
}

/**
 * Pencereyi etkin boyut modunun boyutunda yerleştirir. Karar src/lib/pencere-yerlesim.js anaPencereHedefi'nde (o-32): konum modu
 * "hatırla" ve kayıtlı konum bağlı bir ekranda görünüyorsa orası; tercih edilen ekran bağlıysa onun çalışma alanında ortalanır;
 * aksi halde (varsayılan, ya da ekran sökülmüş) `nokta`nın bulunduğu monitörün çalışma alanında ortalanır.
 */
function pencereyiYerlestir(nokta) {
  if (!anaPencere || anaPencere.isDestroyed() || anaPencere.isFullScreen()) return;
  const mod = ayarlar.pencereBoyutu;
  const kayit = ayarlar.pencere[mod];
  const alan = screen.getDisplayNearestPoint(nokta).workArea;
  const ekranlar = ekranOzetleriAl(screen);
  const hedef = anaPencereHedefi({
    boyut: kayit,
    konumModu: ayarlar.pencereKonumu,
    konum: ayarlar.pencereKonumlari?.[mod] ?? null,
    tercihEkran: tercihEkranBul(ekranlar, ayarlar.tercihEkran),
    ekranlar,
    imlecAlani: alan,
  });
  fizikselMod = mod;
  yerlesimHedefi = { mod, width: hedef.width, height: hedef.height, x: hedef.x, y: hedef.y };
  yerlesimBitisi = Date.now() + YERLESIM_SESSIZ_MS;
  if (anaPencere.isMaximized()) anaPencere.unmaximize();
  anaPencere.setBounds(hedef);
  anaPencere.setBounds(hedef); // karma DPI'da ilk çağrı yanlış ölçeklenebilir, ikincisi düzeltir (denenmedi)
  if (mod === 'genis' && kayit.maximized === true) anaPencere.maximize();
}

/**
 * Ana pencerenin opaklığı (o-32, ayar panelOpaklik: yüzde 50-100). Ana pencerede Windows 11 malzemesi yoktur (hep opak zemin), bu
 * yüzden opaklık akrilik/mica ile üst üste binmez; küçük panel ve palet için aynı kural src/yuzey-yoneticisi.js'tedir. Hata
 * fırlatmaz (pencere yok olmuş ya da sistem desteklemiyor olabilir).
 */
function anaPencereOpaklikUygula() {
  if (!anaPencere || anaPencere.isDestroyed() || typeof anaPencere.setOpacity !== 'function') return;
  try {
    anaPencere.setOpacity(opaklikOrani(ayarlar?.panelOpaklik));
  } catch {
    gunluk('Pencere opaklığı uygulanamadı.');
  }
}

/** 'hizli' <-> 'genis'. Görünür pencere hemen yeniden boyutlanır; gizliyse bir sonraki gösterimde uygulanır. */
function pencereBoyutuDegistir(mod) {
  if (!PENCERE_BOYUTLARI.includes(mod) || mod === ayarlar.pencereBoyutu) return;
  pencereDurumunuKaydet({ zorla: true }); // eski modun son boyutu saklansın
  ayarlar.pencereBoyutu = mod;
  ayarlariYaz();
  if (anaPencere && !anaPencere.isDestroyed() && anaPencere.isVisible() && !anaPencere.isMinimized()) {
    const s = anaPencere.getBounds();
    pencereyiYerlestir({ x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height / 2) });
  }
}

function odakKaybindaGizleAyarla(acik) {
  ayarlar.odakKaybindaGizle = !!acik;
  ayarlariYaz();
  if (!ayarlar.odakKaybindaGizle) odakKaybiZamanlayicisiniIptalEt();
}

function odakKaybiZamanlayicisiniIptalEt() {
  clearTimeout(odakKaybiZamanlayicisi);
  odakKaybiZamanlayicisi = null;
}

function odakGeldi() {
  sonOdakKaybi = 0;
  odakKaybiZamanlayicisiniIptalEt();
}

function odakKaybiniBaslat() {
  // Ayar kapalıyken de kaydedilir: tepsi tıklaması odağı görev çubuğuna aldığından bu, "pencere odaktaydı"
  // demenin tek yoludur (src/lib/pencere-davranisi.js, tiklamaKarari).
  sonOdakKaybi = Date.now();
  if (!ayarlar.odakKaybindaGizle) return;
  clearTimeout(odakKaybiZamanlayicisi);
  odakKaybiZamanlayicisi = setTimeout(() => {
    odakKaybiZamanlayicisi = null;
    odakKaybiniUygula();
  }, ODAK_KAYBI_GECIKME_MS);
}

/**
 * Ayarlar ya da HA'nın açtığı alt pencere odağı bıraktı ya da kapandı (k-17): ana pencere o sırada odakta değilse ve hâlâ açıksa
 * "başka yere tıklayınca gizle" kuralı onun için de işler. sonOdakKaybi DEĞİŞMEZ (ana pencere odağı kaybetmedi); karar gecikmeyle
 * odakKaybiniUygula'da verilir: odak ana pencereye ya da başka bir uygulama penceresine geçtiyse orada hesaplanır.
 */
function altPencereOdakKaybi() {
  if (!ayarlar?.odakKaybindaGizle) return;
  clearTimeout(odakKaybiZamanlayicisi);
  odakKaybiZamanlayicisi = setTimeout(() => {
    odakKaybiZamanlayicisi = null;
    odakKaybiniUygula();
  }, ODAK_KAYBI_GECIKME_MS);
}

function odakKaybiniUygula() {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  const odakli = BrowserWindow.getFocusedWindow();
  const gizlensin = odakKaybiGizlensinMi({
    ayarAcik: ayarlar.odakKaybindaGizle,
    gorunur: anaPencere.isVisible(),
    simgeDurumunda: anaPencere.isMinimized(),
    tamEkran: anaPencere.isFullScreen(),
    anaPencereOdakta: anaPencere.isFocused(),
    ayarlarOdakta: !!ayarlarPenceresi && !ayarlarPenceresi.isDestroyed() && ayarlarPenceresi.isFocused(),
    altPencereOdakta: !!odakli && haAltPencereleri.has(odakli),
    devToolsOdakta: anaPencere.webContents.isDevToolsFocused(),
    onayAcik: acikOnaySayisi > 0,
  });
  if (!gizlensin) return;
  sonOtomatikGizleme = Date.now();
  pencereyiGizle();
}

/** Ana panoya (ya da ayardaki yola) git: HA sayfasındaysa hemen, çevrimdışıysa bağlanınca (bekleyenYol). */
function panoyaGit(yol = '/') {
  if (!anaPencere || anaPencere.isDestroyed() || !yolGecerliMi(yol)) return false;
  if (gosterilenSayfa === 'ha' && aktifAdres && izinliKokenMi(aktifAdres)) {
    anaPencere.loadURL(`${aktifAdres}${yol}`).catch(() => {
      /* hata did-fail-load içinde işlenir */
    });
  } else {
    bekleyenYol = yol;
  }
  return true;
}

/**
 * Ana pencerede şu an açık HA sayfasının yolu (yol + sorgu + parça; k-18), örn. "/lovelace/mutfak?edit=1".
 * Yalnız ana pencere GERÇEKTEN izinli bir HA kökeninde bir HA sayfası gösteriyorsa döner; çevrimdışı/bağlanıyor sayfasında,
 * başka kökende ya da yasak yollarda (/api, /auth, /local, /hacsfiles) null. Ayarlar penceresindeki "geçerli sayfayı kullan"
 * düğmesi bunu kullanır; dönen değer yine de kaydedilmeden önce yolGecerliMi'den geçer.
 * @returns {string | null}
 */
function acikHaSayfasiYolu() {
  if (gosterilenSayfa !== 'ha' || !aktifAdres || !izinliKokenMi(aktifAdres)) return null;
  if (!anaPencere || anaPencere.isDestroyed() || anaPencere.webContents.isDestroyed()) return null;
  try {
    return sayfaYolu(anaPencere.webContents.getURL(), aktifAdres);
  } catch {
    return null;
  }
}

/** Pencere N dakikadan uzun gizli kaldıysa (ayar; 0 = hiç) gösterirken ana panoya dön (pencere-04). */
function uzunGizliyseAnaPanoyaDon() {
  const asildi = gosterilenSayfa === 'ha' && gizliKalmaAsildiMi(gizlenmeZamani, Date.now(), ayarlar.anaPanoyaDonDk);
  gizlenmeZamani = 0;
  if (!asildi) return;
  // Gizli başlayıp (oturum açılışı) bir kez bile gösterilmemiş pencere zaten açılışta yüklenen ana panodadır: "uzun gizli kaldı" diye
  // yeniden yüklemek boşuna. HA "/" adresini kendi ana panosuna ("/lovelace/0" gibi) çevirdiğinden aşağıdaki pathname denetimi
  // bunu yakalamaz (h-14).
  if (!ilkGosterimYapildi) return;
  try {
    const mevcutUrl = anaPencere?.webContents?.getURL?.();
    if (typeof mevcutUrl === 'string' && mevcutUrl) {
      const u = new URL(mevcutUrl);
      if (aktifAdres && u.origin === aktifAdres && u.pathname === '/' && !u.search && !u.hash) return;
    }
  } catch {
    /* url ayrıştırılamazsa panoyaGit çağrılır */
  }
  panoyaGit('/');
}

function pencereyeOdakVer() {
  anaPencere.focus();
  anaPencere.webContents.focus(); // ilk tuş vuruşu sayfaya gitsin (hiz-14)
  clearTimeout(onPlanZamanlayicisi);
  // Windows ön plan kilidi pencerenin odak almasını engelleyebilir; olmazsa blur hiç gelmez ve pencere
  // açık kalır. Kısa süreli "üstte" yedeği (denenmedi).
  onPlanZamanlayicisi = setTimeout(() => {
    if (!anaPencere || anaPencere.isDestroyed() || !anaPencere.isVisible() || anaPencere.isFocused()) return;
    anaPencere.setAlwaysOnTop(true);
    anaPencere.focus();
    anaPencere.setAlwaysOnTop(false);
  }, ODAK_ONPLAN_YEDEK_MS);
}

/**
 * Ana pencere yok ya da yok edilmişse (ör. iptal edilen oturum kapatma sırasında kapanmış) yeniden oluşturur;
 * tepsi uygulaması pencere olmadan "ölü" kalmasın (hata-06). Gerçek çıkış sırasında oluşturulmaz.
 */
function anaPencereyiGarantile() {
  if (anaPencere && !anaPencere.isDestroyed()) return true;
  if (cikiliyor) return false;
  gunluk('Ana pencere yoktu; yeniden oluşturuluyor.');
  durumSayfasiHazir = false;
  gosterilenSayfa = 'yok';
  aktifAdres = null;
  baglantiTuru = null;
  haSayfaBasligi = '';
  anaPencereOlustur();
  baglan();
  return true;
}

function pencereyiGoster() {
  if (!anaPencereyiGarantile()) return;
  odakKaybiZamanlayicisiniIptalEt();
  const gizliydi = !anaPencere.isVisible() || anaPencere.isMinimized();
  if (gizliydi) {
    // Her gösterimde imlecin bulunduğu monitörde ortalanır (pencere-03); görünür pencereye dokunulmaz.
    if (anaPencere.isMinimized()) anaPencere.restore();
    uzunGizliyseAnaPanoyaDon();
    pencereyiYerlestir(screen.getCursorScreenPoint());
  }
  ilkGosterimYapildi = true;
  anaPencere.show();
  pencereyeOdakVer();
}

function pencereyiGizle() {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  odakKaybiZamanlayicisiniIptalEt();
  const gorunurdu = anaPencere.isVisible();
  pencereDurumunuKaydet({ zorla: true });
  anaPencere.hide();
  if (gorunurdu) gizlenmeZamani = Date.now();
}

/**
 * Tepsi tıklaması ve genel kısayol aynı kuralla çalışır (src/lib/pencere-davranisi.js, tiklamaKarari):
 * pencere görünür VE odaktaysa gizle, aksi halde göster/öne getir. kaynak: 'tepsi' | 'kisayol'.
 */
function pencereyiAcKapat(kaynak = 'kisayol') {
  if (!anaPencereyiGarantile()) return;
  const gorunur = anaPencere.isVisible() && !anaPencere.isMinimized();
  const karar = tiklamaKarari({
    kaynak,
    gorunur,
    odakta: gorunur && anaPencere.isFocused(),
    bekleyenGizleme: odakKaybiZamanlayicisi !== null,
    sonGizlemeMs: sonOtomatikGizleme,
    sonOdakKaybiMs: sonOdakKaybi,
    simdi: Date.now(),
  });
  if (karar === 'kapat') pencereyiGizle();
  else pencereyiGoster();
}

function baglantiDurumMetni() {
  if (baglantiTuru === 'yerel') return t('baglanti.yerel');
  if (baglantiTuru === 'dis') return t('baglanti.dis');
  if (gosterilenSayfa === 'baglaniyor') return t('baglanti.baglaniyor');
  return t('baglanti.yok');
}

function basligiGuncelle() {
  const durum = baglantiDurumMetni();
  const gelistirme = app.isPackaged ? '' : t('uygulama.gelistirme'); // kurulu sürümle karışmasın (hata-23)
  if (anaPencere && !anaPencere.isDestroyed()) {
    const sayfa = gosterilenSayfa === 'ha' && haSayfaBasligi ? ` — ${haSayfaBasligi}` : '';
    anaPencere.setTitle(`${uygulamaAdi()}${gelistirme}${sayfa}   (${durum})`);
  }
  tepsiyiGuncelle();
}

/**
 * Dikkat gerektiren sensör sayısı (zayıf pil, açık sorun/duman/gaz/su sensörü): favori sensör karoları + bilgi bölümündeki sensörler.
 * Ayar kapalıysa (sensorTepsiIpucu) ya da hiç sensör yoksa 0; sayı olmayan/ulaşılamayan sensör uyarı sayılmaz.
 */
function sensorUyarisi() {
  if (ayarlar?.sensorTepsiIpucu !== true) return 0;
  const karolar = [...favoriKarolari(), ...bilgiKarolari(bilgiModeliOlustur({ ayarlar, durumAl: (kimlik) => depo.al(kimlik), t }))];
  return sensorUyariSayisi(karolar, ayarlar.pilEsigi);
}

/**
 * Tepsi ipucu ve simgesi (detay-18). İpucu: "Ev Paneli — Ev ağı — 2 ışık açık" (İngilizcede "Home Panel — Home network — 2 lights on") (favori ışıklar; canlı bağlantıda anında).
 * Simge: bağlantı yokken (ana pencere hiçbir adrese bağlı değilken) soluk. Değişmeyen değer yeniden yazılmaz. Windows 11'de
 * simge taşma alanındaysa (^) bunların hiçbiri görünmez: ilk gizleme bildirimi bunu söyler.
 */
function tepsiyiGuncelle() {
  if (!tepsi || tepsi.isDestroyed()) return;
  const ipucu = ipucuMetni({
    ad: uygulamaAdi(),
    t,
    durum: baglantiDurumMetni(),
    uyari: yetkiKisaMetni(), // yetki kesici açık
    acikIsik: acikIsikSayisi(favoriKarolari()),
    sensorUyari: sensorUyarisi(), // o-04: yalnız "Tepsi ipucunda sensör uyarısı" açıksa (varsayılan kapalı)
    canli: ws.canliMi() || (baglantiTuru !== null && depo.sonHata === null), // REST yedeği sağlıklıysa sayı en çok 1 dk eski: "son bilinen" denmez
    gelistirme: !app.isPackaged, // kurulu sürümle karışmasın (hata-23)
    ek: tepsiRozeti.ipucuEki(), // o-27: rozet 'sensor' modunda seçili sensörün kısa değeri
  });
  if (ipucu !== sonTepsiIpucu) {
    sonTepsiIpucu = ipucu;
    tepsi.setToolTip(ipucu);
  }
  // Simge: bağlantı yokken soluk dosya simgesi; bağlıyken dosya simgesi ya da (ayar açıksa) rozetli simge. Değişmeyen simge yeniden
  // yazılmaz, rozet değişimleri en çok saniyede bir uygulanır (src/tepsi-rozeti.js).
  tepsiSoluk = baglantiTuru === null;
  try {
    tepsiRozeti.guncelle();
  } catch {
    gunluk('Tepsi simgesi değiştirilemedi.');
  }
}

// ---------------------------------------------------------------------------
// Bağlantı akışı
// ---------------------------------------------------------------------------

function yenidenDenemeyiIptalEt() {
  clearTimeout(yenidenDenemeZamanlayicisi);
  yenidenDenemeZamanlayicisi = null;
}

/** offline.html ana pencerede gerçekten yüklü mü (bayrak bayat kalmış olabilir: hata sayfası yerine geçmiş olabilir)? */
function durumSayfasiAcikMi() {
  if (!durumSayfasiHazir || !anaPencere || anaPencere.isDestroyed()) return false;
  return anaPencere.webContents.getURL().startsWith('file:');
}

/**
 * Durum sayfasını (offline.html) gösterir. Sayfa zaten açıksa yeniden yüklemek yerine yerinde günceller:
 * artan bekleme (2-4-8-15 sn) her denemede sayfayı baştan yükleyip titretmesin (hata-05).
 */
function durumSayfasiGoster(durum, ek = {}) {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  const yerinde = durumSayfasiAcikMi() && (gosterilenSayfa === 'baglaniyor' || gosterilenSayfa === 'cevrimdisi');
  gosterilenSayfa = durum;
  if (yerinde) {
    anaPencere.webContents.send('baglanti:durum', {
      durum,
      sn: Number(ek.sn) || 0,
      hata: ek.hata || '',
      yerel: ayarlar.yerelAdres || '',
      dis: ayarlar.disAdres || '',
      dil: etkinDil,
    });
    return;
  }
  durumSayfasiHazir = false;
  const query = { durum, yerel: ayarlar.yerelAdres || '', dis: ayarlar.disAdres || '', dil: etkinDil, ...ek };
  anaPencere.loadFile(OFFLINE_HTML, { query }).catch(() => {});
}

function cokmeGecmisiniSifirla() {
  cokmeZamanlari = [];
  clearTimeout(cokmeZamanlayicisi);
  cokmeZamanlayicisi = null;
}

/**
 * Çevrimdışı ekranı gösterir ve artan beklemeyle (2, 4, 8, 15 sn, sonra ayardaki tavan) yeniden dener.
 * otomatik:false -> yeniden deneme zamanlayıcısı kurulmaz (art arda çökme; kullanıcı "Tekrar Dene"ye basar).
 */
function cevrimdisiGoster(hataKodu = '', { otomatik = true } = {}) {
  yenidenDenemeyiIptalEt();
  aktifAdres = null;
  baglantiTuru = null;
  haSayfaBasligi = '';
  if (!otomatik) {
    durumSayfasiGoster('cevrimdisi', { sn: '0', hata: hataKodu });
    basligiGuncelle();
    return;
  }
  const beklemeSn = bekleSn(denemeSayaci, ayarlar.yenidenDenemeSn);
  denemeSayaci = Math.min(denemeSayaci + 1, 1000);
  durumSayfasiGoster('cevrimdisi', { sn: String(beklemeSn), hata: hataKodu });
  basligiGuncelle();
  yenidenDenemeZamanlayicisi = setTimeout(() => baglan(), beklemeSn * 1000);
}

/**
 * @param {{adres:string, tur:'yerel'|'dis'}|null} hazirSecim adres zaten yoklandıysa tekrar yoklanmaz
 *   ve durum sayfası gösterilmeden doğrudan yüklenir.
 */
async function baglan(hazirSecim = null) {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  yenidenDenemeyiIptalEt();
  const surum = ++baglanmaSurumu;

  if (hazirSecim) {
    /* adres seçilmiş: durum sayfası göstermeden doğrudan yükle */
  } else if (gosterilenSayfa === 'cevrimdisi' && durumSayfasiAcikMi()) {
    anaPencere.webContents.send('baglanti:durum', 'deneniyor');
  } else if (gosterilenSayfa !== 'baglaniyor') {
    aktifAdres = null;
    baglantiTuru = null;
    durumSayfasiGoster('baglaniyor');
  }
  basligiGuncelle();

  const secim = hazirSecim ?? (await adresSec());
  if (surum !== baglanmaSurumu || !anaPencere || anaPencere.isDestroyed()) return; // daha yeni bir deneme var

  if (!secim) {
    gunluk('Sunucuya ulaşılamadı.');
    cevrimdisiGoster();
    return;
  }
  gunluk(secim.tur === 'yerel' ? 'Ev ağı adresine bağlanılıyor.' : 'Dış adrese bağlanılıyor.');
  haIstemcisi.secimiAyarla(secim.adres);
  baglantiTuru = secim.tur;
  basligiGuncelle();
  const yol = bekleyenYol ?? '/';
  bekleyenYol = null;
  anaPencere.loadURL(`${secim.adres}${yol}`).catch(() => {
    /* hata did-fail-load içinde işlenir */
  });
}

/**
 * Yenile (Ctrl+R, F5, tepsi menüsü). HA sayfasındaysa önce adres yeniden seçilir: ağ değişmişse (ör. evden
 * çıkıldı) ölü adreste kalınmaz. Yoklama 2 sn içinde bitmezse beklemeden yenilenir; sayfa açılmazsa
 * did-fail-load çevrimdışı akışa alır. HA sayfasında değilse doğrudan bağlanılır (hata-02).
 */
async function yenile({ onbellegiYoksay = false } = {}) {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  cokmeGecmisiniSifirla(); // elle yenileme: art arda çökme sınırı baştan sayılır
  if (gosterilenSayfa !== 'ha') {
    denemeSayaci = 0;
    baglan();
    return;
  }
  const surum = ++yenilemeSurumu;
  const secim = await Promise.race([adresSec(), bekle(2000).then(() => undefined)]);
  if (surum !== yenilemeSurumu || !anaPencere || anaPencere.isDestroyed()) return; // daha yeni bir yenileme var
  if (gosterilenSayfa !== 'ha') {
    baglan();
    return;
  }
  if (secim && secim.adres !== aktifAdres) {
    denemeSayaci = 0;
    baglan(secim);
    return;
  }
  const wc = anaPencere.webContents;
  if (onbellegiYoksay) wc.reloadIgnoringCache();
  else wc.reload();
}

// ---------------------------------------------------------------------------
// Görünüm: tema ve pencere vurgu rengi (gorunum-13)
// ---------------------------------------------------------------------------

/**
 * Koyu tema (ayar temaZorla = 'koyu'): nativeTheme.themeSource = 'dark'; aksi halde Windows temasını izler ('system').
 * Başlık çubuğunun bu yolla gerçekten koyulaştığı DENENMEDİ (README). Yan etki: HA profili "otomatik tema" ise HA de koyu görünür.
 */
function temayiUygula() {
  try {
    nativeTheme.themeSource = temaKaynagi(ayarlar?.temaZorla);
  } catch {
    gunluk('Tema ayarlanamadı.');
  }
}

/**
 * Tema, malzeme, yüksek karşıtlık ya da panel renkleri değişti (o-25, o-29): açık panel/palet/bildirim pencerelerinin arka plan rengi ve malzemesi
 * güncellenir. Sayfanın kendi renkleri bir sonraki gösterimde gelir (gorunumuAl).
 */
function gorunumuYenile() {
  try {
    yuzey.malzemeyiUygula();
    kose.malzemeyiUygula();
    itmeKart.malzemeyiUygula();
  } catch {
    gunluk('Pencere görünümü güncellenemedi.');
  }
}

/** Pencere vurgu rengi (kenarlık): "#rrggbb" -> o renk, '' -> Windows'un kendi ayarı. Windows dışında ya da eski sürümde atlanır. */
function vurguyuUygula(pencere) {
  if (!pencere || pencere.isDestroyed() || typeof pencere.setAccentColor !== 'function') return;
  try {
    pencere.setAccentColor(ayarlar?.vurguRengi || null);
  } catch {
    gunluk('Vurgu rengi uygulanamadı.');
  }
}

// ---------------------------------------------------------------------------
// Ayarlar penceresi
// ---------------------------------------------------------------------------

// Tepsiden/bildirimden doğrudan açılabilen Ayarlar bölümleri (Ayarlar'daki kimliklerle aynı; başka değer yok sayılır).
const AYARLAR_BOLUMLERI = new Set(['bolumSurum', 'bolumAraclar', 'bolumMobil']); // bolumMobil (o-61): "mobil kayıt silindi" bildirimi tıklanınca

/** Açık Ayarlar penceresine "şu bölümü aç ve göster" der (ayarlar:bolum-ac); sayfa kendi bölümünü açar. */
function ayarlarBolumuIste(bolum) {
  if (!AYARLAR_BOLUMLERI.has(bolum) || !ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('ayarlar:bolum-ac', { bolum });
  } catch {
    /* pencere kapanıyor */
  }
}

/** @param {string} [bolum] açılışta gösterilecek bölüm (AYARLAR_BOLUMLERI); menü `click` işleyicisi olarak çağrılınca gelen nesne yok sayılır */
function ayarlarPenceresiniAc(bolum) {
  const istenen = typeof bolum === 'string' && AYARLAR_BOLUMLERI.has(bolum) ? bolum : null;
  if (ayarlarPenceresi && !ayarlarPenceresi.isDestroyed()) {
    if (ayarlarPenceresi.isMinimized()) ayarlarPenceresi.restore();
    ayarlarPenceresi.show();
    ayarlarPenceresi.focus();
    if (istenen) ayarlarBolumuIste(istenen);
    return;
  }
  ayarlarPenceresi = yerelPencereOlustur({
    preload: PRELOAD, // varsayılan oturum, HA oturumu değil
    secenekler: {
      width: 780,
      height: 860,
      minWidth: 560,
      minHeight: 500,
      show: false,
      title: t('uygulama.ayarlarBaslik'),
      icon: IKON_ICO,
      autoHideMenuBar: true,
      backgroundColor: '#14161b',
    },
    cokunce: ayarlarPenceresiCokunce,
  });
  vurguyuUygula(ayarlarPenceresi);
  ayarlarPenceresi.once('ready-to-show', () => ayarlarPenceresi?.show());
  ayarlarPenceresi.on('blur', altPencereOdakKaybi); // odak başka yere gittiyse ana pencere de gizlenir (k-17)
  ayarlarPenceresi.on('closed', () => {
    ayarlarPenceresi = null;
    cihazOnbellegi = null;
    altPencereOdakKaybi();
  });
  // Kaydedilmemiş değişiklik varken kapatma (k-02): sayfa beforeunload ile kapanışı durdurur; karar burada verilir ve
  // eşzamanlı olmalıdır (olay.preventDefault() = "uyarıyı yok say, kapat"). Uygulama çıkarken hiç sorulmaz.
  ayarlarPenceresi.webContents.on('will-prevent-unload', (olay) => {
    if (cikiliyor) {
      olay.preventDefault();
      return;
    }
    let secim = 0; // pencere gösterilemezse takılı kalmasın: kapat
    try {
      secim = dialog.showMessageBoxSync(ayarlarPenceresi, {
        type: 'question',
        buttons: [t('diyalog.kapat'), t('diyalog.vazgec')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: uygulamaAdi(),
        message: t('diyalog.kaydedilmemis'),
        detail: t('diyalog.kaydedilmemisAyrinti'),
      });
    } catch {
      secim = 0;
    }
    if (secim === 0) olay.preventDefault();
  });
  ayarlarPenceresi.loadFile(AYARLAR_HTML).catch(() => {});
  if (istenen) ayarlarPenceresi.webContents.once('did-finish-load', () => ayarlarBolumuIste(istenen));
}

/**
 * Ayarlar penceresinin sayfa süreci çöktü (h-37; ana pencere ve hızlı panelde de kurtarma vardır): artan beklemeyle sayfa yeniden
 * yüklenir; 10 dk içinde 5 çökmeden sonra pencere kapatılır ve kullanıcıya söylenir (tepsiden yeniden açılabilir).
 */
function ayarlarPenceresiCokunce(ayrinti, pencere) {
  const neden = ayrinti?.reason;
  if (cikiliyor || oturumKapaniyor || !cokmeSayilirMi(neden) || pencere !== ayarlarPenceresi || pencere.isDestroyed()) return;
  const simdi = Date.now();
  ayarlarCokmeZamanlari = [...ayarlarCokmeZamanlari, simdi].slice(-AYARLAR_COKME_KAYIT_SINIRI);
  const karar = cokmeKarari(ayarlarCokmeZamanlari, simdi);
  if (karar.dur) {
    gunluk(`Ayarlar penceresi art arda çöktü (${cokmeNedeniMetni(neden)}, ${karar.sayi} kez); kapatıldı.`);
    ayarlarCokmeZamanlari = [];
    bildir(t('bildirim.ayarlarArtArdaCoktu'));
    pencere.destroy();
    return;
  }
  gunluk(`Ayarlar penceresi çöktü (${cokmeNedeniMetni(neden)}); ${karar.bekleMs / 1000} sn sonra yeniden yüklenecek.`);
  if (karar.sayi === 1) bildir(t('bildirim.ayarlarCoktu'));
  setTimeout(() => {
    if (pencere === ayarlarPenceresi && !pencere.isDestroyed()) pencere.loadFile(AYARLAR_HTML).catch(() => {});
  }, karar.bekleMs);
}

/** Yerel bir sayfaya (Ayarlar, durum sayfası) 'dil:degisti' ({ dil }) bildirir; sayfa kendini yeniden çevirir. Pencere kapanıyorsa sessiz geçer. */
function dilBildir(pencere) {
  try {
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('dil:degisti', { dil: etkinDil });
  } catch {
    /* pencere kapanıyor */
  }
}

/**
 * Arayüz dili değişti (Ayarlar'dan): pencere başlıkları ve tepsi ipucu yeni dille yazılır, açık yerel sayfalara (Ayarlar, durum sayfası,
 * hızlı panel/palet, köşe bildirimi) bildirilir. Tepsi menüsü her açılışta yeniden kurulduğundan ayrıca işlem gerekmez.
 */
function dilDegistiYay() {
  sonTepsiIpucu = ''; // ipucu metni dile bağlı: aynı kalsa bile yeniden yazılsın
  basligiGuncelle(); // ana pencere başlığı + tepsi ipucu
  if (ayarlarPenceresi && !ayarlarPenceresi.isDestroyed()) {
    try {
      ayarlarPenceresi.setTitle(t('uygulama.ayarlarBaslik'));
    } catch {
      /* pencere kapanıyor */
    }
  }
  dilBildir(ayarlarPenceresi);
  if (durumSayfasiAcikMi()) dilBildir(anaPencere); // HA sayfasına köprü açılmaz; yalnız yerel durum sayfasına gider
  yuzey.dilDegisti();
  kose.dilDegisti();
  itmeKart.dilDegisti();
  masaustuKarolari.dilDegisti();
  disTetikler.dilDegisti(); // Jump List görev açıklamaları
}

/** o-43: anahtarın kullanıcı türü (yönetici mi) belirlendi ya da unutuldu: açık Ayarlar sayfasına yalnız boolean/null gider. */
function ayarlaraAnahtarYoneticisiniBildir() {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('ayarlar:anahtar-yonetici', { anahtarYonetici });
  } catch {
    /* pencere kapanıyor */
  }
}

/**
 * Palet "*" menüsü "Favoriye ekle" (o-46): cihaz favori listesinin SONUNA eklenir (aynı süzgeç, sınır ve onay kuralı; src/lib/diger-cihazlar.js
 * favoriListesineEkle). Düzen geçmişine tek nokta yazılır (Ayarlar > Düzen geçmişinden geri alınabilir), ayar yazılır, izlenenler yenilenir ve
 * açık Ayarlar sayfası haberdar edilir. Günlüğe cihaz adı ya da kimliği yazılmaz.
 */
function paletFavoriEkle({ kimlik, ad }) {
  const sonuc = favoriListesineEkle(ayarlar.favoriler, { kimlik, ad });
  if (!sonuc.ok) return sonuc;
  const duzenOncesi = duzen.anlik();
  ayarlar.favoriler = sonuc.favoriler;
  duzen.degisimiIsle(duzenOncesi, 'kaydet');
  const yazildi = ayarlariYaz();
  cihazOnbellegi = null; // favori listesi değişti: sonraki cihaz listesi yeniden alınır
  izlenenleriYenile();
  ayarlaraFavoriDegistiBildir();
  gunluk('Palet menüsünden bir cihaz favorilere eklendi.');
  return yazildi ? { ok: true } : { ok: false, tur: 'yazilamadi' };
}

/** Tarayıcıyla giriş durumu değişti (dinleyici açıldı/kapandı, giriş bitti, oturum yenilendi/sona erdi, o-57): açık Ayarlar sayfası durumu yeniden sorar. */
function ayarlaraOturumDegistiBildir() {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('ayarlar:oturum-degisti');
  } catch {
    /* pencere kapanıyor */
  }
}

/** Klasör eşitleme durumu değişti (bölüm alındı/yazıldı, hata, açma/kapama; o-58): açık Ayarlar sayfası durumu yeniden sorar. */
function ayarlaraEsitlemeDegistiBildir() {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('ayarlar:esitleme-degisti');
  } catch {
    /* pencere kapanıyor */
  }
}

/** Favori listesi arka planda değişti (ör. hazır karoların yeniden denemesi): açık Ayarlar sayfasına haber verilir (h-27). */
function ayarlaraFavoriDegistiBildir() {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('ayarlar:favoriler-degisti');
  } catch {
    /* pencere kapanıyor */
  }
}

/**
 * Ana pencerede AÇIK Home Assistant sayfası (k-18, "Açık sayfayı ekle"): yalnız ayardaki izinli kökenlerden (ev içi / dış adres) ve yalnız
 * geçerli bir yol olarak döner; çevrimdışı/durum sayfasında ya da başka bir kökende hata verilir. Yol, gezinti.sayfaYolu ile
 * (acikHaSayfasiYolu ile aynı kural) sorgu/parçasıyla alınır; geçersizse sorgu/parça atılarak denenir.
 * @returns {{ok: true, yol: string, ad: string} | {ok: false, hata: string}}
 */
function ayarlarIcinAcikSayfa() {
  if (!anaPencere || anaPencere.isDestroyed() || gosterilenSayfa !== 'ha') {
    return { ok: false, hata: t('ana.acikSayfaYok') };
  }
  let adres = null;
  try {
    adres = new URL(anaPencere.webContents.getURL());
  } catch {
    adres = null;
  }
  if (!adres || !izinliKokenMi(adres.origin)) return { ok: false, hata: t('ana.acikSayfaFarkliAdres') };
  const yol = sayfaYolu(adres.href, adres.origin); // yol + sorgu + parça; geçersizse sırayla atılarak denenir, hepsi yolGecerliMi'den geçer
  if (!yol) return { ok: false, hata: t('ana.sayfaEklenemez') };
  return { ok: true, yol, ad: kisalt(haSayfaBasligi, 30) };
}

// ---------------------------------------------------------------------------
// Otomatik başlatma ve genel kısayol
// ---------------------------------------------------------------------------

/**
 * Taşınabilir derleme mi (o-45)? electron-builder'ın portable açılış yardımcısı exe'yi geçici klasöre açar ve PORTABLE_EXECUTABLE_FILE
 * ortam değişkenini taşınabilir exe'nin yoluna ayarlar. Bu durumda process.execPath geçici klasörü gösterir ve kalıcı DEĞİLDİR: Windows
 * açılışına yazılmaz.
 */
function tasinabilirMi() {
  return typeof process.env.PORTABLE_EXECUTABLE_FILE === 'string' && process.env.PORTABLE_EXECUTABLE_FILE !== '';
}

/** Windows'taki GERÇEK oturum açılışı durumu: { durum, mesaj } (src/lib/oturum-acilisi.js). */
function otomatikBaslatDurumu() {
  let s = null;
  if (app.isPackaged && !tasinabilirMi()) {
    try {
      s = app.getLoginItemSettings({ path: process.execPath, args: [GIZLI_BASLAT_ARG] });
    } catch {
      s = null; // okunamadı: durum uydurulmaz ('belirsiz')
    }
  }
  return oturumAcilisiDurumu({
    paketli: app.isPackaged,
    tasinabilir: tasinabilirMi(),
    ayarAcik: ayarlar.otomatikBaslat,
    s,
    ad: UYGULAMA_ADI, // Windows başlangıç kaydının adı (çevrilmez)
    yol: process.execPath,
    t,
  });
}

/**
 * Ayarı Windows'a yazar. app.setLoginItemSettings `enabled` varsayılanı true'dur: her açılışta yazarsak
 * Görev Yöneticisi'nden kapatılmış kaydı sessizce yeniden etkinleştirirdi (pencere-08). Bu yüzden Windows
 * kaydı kapatmışsa kullanıcı açıkça istemedikçe (zorla) YAZILMAZ.
 */
function otomatikBaslatUygula({ zorla = false } = {}) {
  // Geliştirme modunda (npm start) kayıt defterine electron.exe, taşınabilir derlemede geçici klasördeki exe yazılmasın (o-45).
  if (!app.isPackaged || tasinabilirMi()) return;
  if (ayarlar.otomatikBaslat && !zorla && otomatikBaslatDurumu().durum === 'windows-kapatmis') {
    gunluk('Otomatik başlatma Windows tarafından kapatılmış; kullanıcı kararına saygı gösterilip yazılmadı.');
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: ayarlar.otomatikBaslat,
      path: process.execPath,
      args: [GIZLI_BASLAT_ARG],
      name: UYGULAMA_ADI,
      enabled: true,
    });
  } catch {
    gunluk('Otomatik başlatma ayarlanamadı.');
  }
}

/** Kullanıcı kutuyu elle değiştirdi (tepsi/ayarlar): Windows'ta kapatılmış olsa bile yeniden yazılır. */
function otomatikBaslatAyarla(acik) {
  if (tasinabilirMi()) return; // taşınabilir derleme kurulu sürümle ortak ayar dosyasını kullanır; başlangıç tercihine dokunmaz (o-45)
  ayarlar.otomatikBaslat = !!acik;
  ayarlariYaz();
  otomatikBaslatUygula({ zorla: true });
}

/**
 * Ana kısayolun işi. Windows tuş basılı tutulurken kısayolu klavye tekrar hızında yeniden üretebildiğinden (RegisterHotKey,
 * MOD_NOREPEAT yok) basılı tutma tek tetikleme sayılır: pencere aç-kapa-aç-kapa titremez, her kapanışta ayar yazılmaz (h-04;
 * eylem/palet/pano kısayollarıyla aynı engel: src/lib/tekrar-engeli.js).
 */
function anaKisayolIsi(hizlandirici) {
  return () => {
    // o-60: "basılı tutunca göster" açıkken tekrar olayları engellenmez, tuşun tutulduğunu anlamak için kullanılır (src/lib/basili-tut.js)
    if (ayarlar?.kisayolBasiliTut === true) {
      basiliTut.tus();
      return;
    }
    if (kisayolTekrarEngeli.gec(hizlandirici)) pencereyiAcKapat('kisayol');
  };
}

/**
 * o-60: ana kısayol basılı tutulduğu sürece Home Assistant penceresini gösterir, bırakılınca gizler. Tuş dinleyicisi YOKTUR; yalnız genel
 * kısayolun kendi tekrar olayları kullanılır. Tekrar gelmiyorsa (kısa basış ya da sistem tekrar üretmiyorsa) davranış sıradan geçiştir:
 * pencere açık kalır, ikinci basış kapatır. Seçenek varsayılan KAPALIDIR (kisayolBasiliTut).
 */
const basiliTut = basiliTutOlustur({
  ac: () => pencereyiGoster(),
  kapat: () => pencereyiGizle(),
  // İlk basışta: pencere görünür VE odaktaysa kapatılır (sıradan geçiş), arkada kaldıysa öne alınır. Bırakınca: yalnız hâlâ görünürse gizlenir.
  acikMi: () => !!anaPencere && !anaPencere.isDestroyed() && anaPencere.isVisible() && !anaPencere.isMinimized() && anaPencere.isFocused(),
  gorunurMu: () => !!anaPencere && !anaPencere.isDestroyed() && anaPencere.isVisible() && !anaPencere.isMinimized(),
});

/** Kayıtlı palet/eylem/pano kısayollarının hepsini bırakır (ana kısayol dokunulmaz). */
function ekKisayollariBirak() {
  for (const hizlandirici of ekKisayollar.keys()) {
    try {
      globalShortcut.unregister(hizlandirici);
    } catch {
      /* zaten kayıtlı değil */
    }
  }
  ekKisayollar.clear();
}

/**
 * Ana kısayolu değiştirir. Yeni tuş uygulamanın KENDİ palet/favori/pano kısayollarından birinin tuşuysa önce onlar bırakılır
 * (aksi halde Windows kaydı reddeder ve ileti "başka bir uygulama kullanıyor olabilir" derdi; h-26). Ana kısayol çakışmada
 * önceliklidir (kisayolPlani): çakışan ek kısayol planda "başka bir kısayolla çakışıyor" olarak kalır, ayrıca ek kısayollar
 * yeni ana kısayola göre yeniden kurulur. Kayıt gerçekten başarısız olursa her şey eski haline döner.
 */
function kisayoluUygula(yeni) {
  const eski = kayitliKisayol;
  if (eski) {
    globalShortcut.unregister(eski);
    kayitliKisayol = null;
  }
  const ekBirakildi = ekKisayollar.has(kisayolNormallestir(yeni) ?? yeni);
  if (ekBirakildi) ekKisayollariBirak();
  let tamam = false;
  try {
    tamam = globalShortcut.register(yeni, anaKisayolIsi(yeni));
  } catch {
    tamam = false;
  }
  if (tamam) {
    kayitliKisayol = yeni;
    if (ekBirakildi) ekKisayollariUygula({ ana: yeni }); // ayarlar.kisayol'u çağıran işleyici sonra günceller
    return true;
  }
  if (eski) {
    try {
      if (globalShortcut.register(eski, anaKisayolIsi(eski))) kayitliKisayol = eski;
    } catch {
      /* eski kısayol da alınamadı */
    }
  }
  if (ekBirakildi) ekKisayollariUygula();
  return false;
}

/** Eylem sınıfı (kısayol planı için): HA'daki güncel ad önbellekte varsa onunla, yoksa kayıtlı adla. */
function kisayolSinifi(kimlik, favori) {
  const durum = depo.al(kimlik);
  return eylemSinifi(durum ?? { entity_id: kimlik, attributes: { friendly_name: favori?.ad ?? kimlik } }, favori).sinif;
}

/**
 * Plan öğesinin kısayola basılınca yapacağı iş (ana kısayol burada yönetilmez: anaKisayolIsi). Windows tuş basılı tutulurken kısayolu
 * klavye tekrar hızında yeniden üretebildiğinden (RegisterHotKey, MOD_NOREPEAT yok) her iş yinelenen tetikleme engelinden
 * geçer: basılı tutma tek tetikleme sayılır (lib/tekrar-engeli.js).
 */
function kisayolIsi(oge) {
  let is = null;
  if (oge.tur === 'palet') is = () => yuzey.paletAcKapat();
  else if (oge.tur === 'favori') is = () => eylem.kisayolla(oge.kimlik);
  else if (oge.tur === 'geri-al') is = () => void eylemEk.geriAl('kisayol'); // 1.4.0 (o-12)
  else if (oge.tur === 'pano') {
    is = () => {
      const pano = ayarlar.panolar[oge.sira];
      if (pano) panoAc(pano);
    };
  }
  if (!is) return null;
  return () => {
    if (kisayolTekrarEngeli.gec(oge.kisayol)) is();
  };
}

/**
 * Palet, eylem ve pano kısayollarını kaydeder (hiz-05, pencere-02). Ana kısayol (ayarlar.kisayol) kisayoluUygula ile ayrı
 * yönetilir; burada yalnız çakışma önceliği için plana girer. Öncelik: ana, palet, favoriler, panolar (çakışmada önceki
 * kazanır). Yıkıcı ve engelli eylemler plana giremez (kisayolPlani 'sinif' ile reddeder); geçersiz, çakışan ya da sınırı
 * aşan kısayol kaydedilmez ve nedeniyle bildirilir. Her çağrıda önceki ek kısayollar bırakılıp yeniden kaydedilir.
 * @param {{ana?: string}} [secenek] ana: plandaki ana kısayol (varsayılan ayarlar.kisayol); ana kısayol değişirken henüz ayara yazılmamış değeri verilir
 * @returns {object[]} plan öğeleri + kayıt sonucu (durum: 'etkin' | 'reddedildi' | 'alinamadi')
 */
function ekKisayollariUygula({ ana = ayarlar.kisayol } = {}) {
  ekKisayollariBirak();
  const plan = kisayolPlani({
    ana,
    palet: ayarlar.paletKisayol,
    favoriler: ayarlar.favoriler,
    panolar: ayarlar.panolar,
    geriAl: ayarlar.geriAl !== false ? ayarlar.geriAlKisayolu : '', // 1.4.0 (o-12): geri alma açıksa ve kısayolu varsa
    siniflandir: kisayolSinifi,
    t,
  });
  kisayolDurumlari = plan.map((oge) => {
    const sonuc = { ...oge, durum: oge.gecerli ? 'etkin' : 'reddedildi' };
    if (oge.tur === 'ana' || !oge.gecerli) return sonuc;
    let tamam = false;
    try {
      const is = kisayolIsi(oge);
      tamam = !!is && globalShortcut.register(oge.kisayol, is);
    } catch {
      tamam = false;
    }
    if (tamam) {
      ekKisayollar.set(oge.kisayol, oge.id);
    } else {
      sonuc.durum = 'alinamadi';
      sonuc.mesaj = t('ana.kisayolKaydedilemedi', { kisayol: kisayolGoster(oge.kisayol) });
    }
    return sonuc;
  });
  return kisayolDurumlari;
}

/** Ek kısayol planında sorunlu olanlar (Ayarlar uyarısı ve açılış bildirimi için). */
function kisayolSorunlari() {
  return kisayolDurumlari.filter((k) => k.tur !== 'ana' && k.durum !== 'etkin');
}

// ---------------------------------------------------------------------------
// Favoriler ve tepsi
// ---------------------------------------------------------------------------

/** Favori listesi değişti: izlenen küme, "Son" listesi, kısayollar ve canlı abonelik yeniden kurulur. */
function izlenenleriYenile() {
  depo.buda(izlenenKimlikler());
  son.buda(new Set(ayarlar.favoriler.map((f) => f.entity_id)));
  ekKisayollariUygula();
  if (ws.canliMi()) ws.abonelikYenile();
  else ws.yenidenBaglan();
  if (!ws.canliMi()) durumlariYenile({ zorla: true });
  yuzey.modelDegisti();
  masaustuKarolari.esitle(); // favori listesi değişti: favori olmaktan çıkan ya da eklenen karo pencereleri güncellenir
  disTetikler.favorilerDegisti(); // Jump List görevleri
}

/**
 * Hazır ilk karolar (hiz-07): HA'daki GERÇEK varlık listesi tek bir OKUMA isteğiyle (GET /api/states; yazma yok) alınır;
 * hazır listedeki, HA'da var olan ve güvenlik kuralından geçen karolar mevcut favorilerin SONUNA eklenir. Mevcut favoriler
 * ve sıraları değişmez, hiçbir şey silinmez. Başarıda ayardaki hazirListeSurumu güncellenir (açılışta bir kez); HA'ya
 * ulaşılamazsa sürüm artmaz ve sonraki açılışta/anahtar kaydında yeniden denenir.
 * @param {{zorla?: boolean}} [secenek] zorla: sürüm güncel olsa da uygula (Ayarlar'daki "Hazır listeyi yeniden uygula")
 */
function hazirListeyiUygula({ zorla = false, yalnizca = null, deneme = 0 } = {}) {
  if (hazirListeSuruyor) return hazirListeSuruyor;
  if (!zorla && ayarlar.hazirListeSurumu >= HAZIR_LISTE_SURUMU) return Promise.resolve({ ok: true, atlandi: true, eklenenler: [], atlananlar: [] });
  if (!anahtarDeposu.varMi()) return Promise.resolve({ ok: false, hata: hataMetni({ tur: 'anahtar-yok' }, t) });
  hazirListeSuruyor = (async () => {
    try {
      const varliklar = await haIstek('/api/states');
      if (!Array.isArray(varliklar)) throw new HaHatasi('sunucu');
      const sonuc = hazirListeUygula(ayarlar.favoriler, varliklar, { yalnizca, etiketAl: (kimlik, varsayilan) => (t.var(`hazir.${kimlik}`) ? t(`hazir.${kimlik}`) : varsayilan) });
      ayarlar.favoriler = onayiDuzelt(sonuc.favoriler);
      ayarlar.hazirListeSurumu = HAZIR_LISTE_SURUMU;
      const yazildi = ayarlariYaz();
      izlenenleriYenile();
      if (sonuc.eklenenler.length > 0) ayarlaraFavoriDegistiBildir(); // açık Ayarlar sayfası eski listeyle kaydetmesin (h-27)
      gunluk(`Hazır liste uygulandı: ${sonuc.eklenenler.length} eklendi, ${sonuc.atlananlar.length} atlandı.`);
      if (!zorla || yalnizca) hazirListeEksikleriniDene(sonuc.atlananlar, deneme); // elle uygulamada (düğme) yeniden deneme zinciri kurulmaz
      return { ok: yazildi, eklenenler: sonuc.eklenenler, atlananlar: sonuc.atlananlar };
    } catch (hata) {
      gunluk(`Hazır liste uygulanamadı: ${hata?.tur ?? 'bilinmeyen'}`);
      return { ok: false, hata: hataMetni(hata, t) };
    } finally {
      hazirListeSuruyor = null;
    }
  })();
  return hazirListeSuruyor;
}

/**
 * HA yeni yeniden başlamışken /api/states 200 döner ama bazı hazır varlıklar (HASS.Agent düğmeleri, scriptler) henüz oluşmamış
 * olabilir. Sürüm yine güncellenir (kullanıcının sildiği karo sonraki açılışlarda geri gelmesin), ama HA'da 'yok' diye atlananlar
 * için bu oturumda en çok 3 kez, 90 sn arayla YALNIZ o karolar yeniden denenir. Başka (kullanıcının çıkardığı) karolara dokunulmaz.
 */
function hazirListeEksikleriniDene(atlananlar, deneme) {
  clearTimeout(hazirYenidenDenemeZamanlayicisi);
  hazirYenidenDenemeZamanlayicisi = null;
  const eksikler = atlananlar.filter((a) => a.neden === 'yok').map((a) => a.entity_id);
  if (eksikler.length === 0 || deneme >= HAZIR_YENIDEN_DENEME_SAYISI || cikiliyor) return;
  hazirYenidenDenemeZamanlayicisi = setTimeout(() => {
    hazirYenidenDenemeZamanlayicisi = null;
    if (cikiliyor || !ayarlar) return;
    hazirListeyiUygula({ zorla: true, yalnizca: eksikler, deneme: deneme + 1 });
  }, HAZIR_YENIDEN_DENEME_MS);
}

/** İkinci kopyadan (ya da hazır olunca kuyruktan) gelen `--eylem` isteği: geçerliyse çalışır, değilse hata gösterilir. */
function komutEylemiIsle(istek) {
  if (istek) {
    komutSatiriEylemiCalistir(istek.ad);
  } else {
    gunluk('Komut satırı eylemi anlaşılamadı (ad yok, geçersiz ya da çok uzun).'); // ad günlüğe yazılmaz
    geriBildirim({ tur: 'hata', metin: t('sonuc.komutGecersiz') });
  }
}

/** `--eylem=<ad>` (hiz-05): ad yalnız güvenli favori karoları arasında aranır; yıkıcı eylemler komut satırından ASLA çalışmaz. */
function komutSatiriEylemiCalistir(ad) {
  if (!anahtarDeposu.varMi()) {
    geriBildirim({ tur: 'hata', metin: t('sonuc.komutAnahtarGerekli') });
    return Promise.resolve({ ok: false, tur: 'anahtar-yok' });
  }
  return eylem.komutSatirindan(ad);
}

/** Uygulama sürümü (package.json); okunamazsa boş metin. */
function uygulamaSurumu() {
  try {
    return typeof app.getVersion === 'function' ? String(app.getVersion()) : '';
  } catch {
    return '';
  }
}

/** `--cikti` dosyasının yazılamayacağı klasörler: uygulamanın kendi veri klasörleri (ayar, anahtar, oturum, günlük) ve kurulum klasörü. */
function ciktiYasakKlasorleri() {
  const liste = [app.getPath('userData'), KOK_DIZIN, path.dirname(process.execPath)];
  try {
    liste.push(path.join(app.getPath('appData'), UYGULAMA_ADI), path.join(app.getPath('appData'), `${UYGULAMA_ADI} (gelistirme)`));
    if (process.env.LOCALAPPDATA) liste.push(path.join(process.env.LOCALAPPDATA, UYGULAMA_ADI), path.join(process.env.LOCALAPPDATA, `${UYGULAMA_ADI} (gelistirme)`));
  } catch {
    /* appData çözülemezse userData yine yasaktır */
  }
  return liste.filter((k) => typeof k === 'string' && k !== '');
}

/** `--goster` / `--gizle` / `--degistir` (o-19): servis çağrısı YOK; yalnız pencere gösterilir ya da gizlenir. hedef: 'ana' | 'panel' | 'palet'. */
function pencereKomutuCalistir({ islem, hedef }) {
  if (hedef === 'ana') {
    const gorunur = !!anaPencere && !anaPencere.isDestroyed() && anaPencere.isVisible() && !anaPencere.isMinimized();
    if (islem === 'goster' || (islem === 'degistir' && !gorunur)) pencereyiGoster();
    else if (gorunur) pencereyiGizle();
    return;
  }
  const acik = yuzey.kip() === hedef;
  if (islem === 'goster' || (islem === 'degistir' && !acik)) yuzey.ac(hedef);
  else if (acik) yuzey.gizle('komut-satiri');
}

/**
 * `--durum` / `--liste` (o-19): güvenli favorilerin durumu `--cikti` dosyasına JSON olarak yazılır (src/lib/komut-durum.js). Belge yalnız
 * kapı kuralından geçmiş karolardan kurulur; anahtar, adres (yalnız sınıfı), webhook kimliği ve ham durum metni belgeye girmez. Başarı
 * sessizdir (betikler sık sorgulayabilir); hata köşe bildirimiyle söylenir.
 */
async function durumKomutuCalistir(komut) {
  const cikti = ciktiYoluCoz(komut.cikti, { dizin: komut.dizin, ev: app.getPath('home'), yasakKlasorler: ciktiYasakKlasorleri() });
  if (!cikti.ok) {
    geriBildirim({ tur: 'hata', metin: t(cikti.neden === 'gerekli' ? 'sonuc.durumCiktiGerekli' : 'sonuc.durumCiktiGecersiz') });
    return { ok: false, tur: cikti.neden };
  }
  // Canlı bağlantı yoksa ve son okuma eskiyse önce tazelenir (tepsi menüsünün kuralıyla aynı).
  if (!ws.canliMi() && Date.now() - favoriSonYenileme > 10_000) await Promise.resolve(durumlariYenile()).catch(() => {});
  const anaVar = !!anaPencere && !anaPencere.isDestroyed();
  const belge = durumBelgesiOlustur({
    liste: komut.liste === true,
    simdi: new Date(),
    uygulamaSurumu: uygulamaSurumu(),
    baglantiTuru,
    canli: ws.canliMi(),
    anahtarVar: anahtarDeposu.varMi(),
    anaPencere: anaVar ? (anaPencere.isVisible() && !anaPencere.isMinimized() ? 'gorunur' : 'gizli') : 'yok',
    karolar: favoriKarolari(),
  });
  const yazim = durumDosyasiYaz(cikti.yol, belge, { ev: app.getPath('home'), yasakKlasorler: ciktiYasakKlasorleri() });
  if (!yazim.ok) {
    gunluk(`Durum dosyası yazılamadı (${yazim.neden}).`);
    geriBildirim({ tur: 'hata', metin: t(yazim.neden === 'baska-dosya' ? 'sonuc.durumDosyaBaska' : 'sonuc.durumYazilamadi') });
    return { ok: false, tur: yazim.neden };
  }
  gunluk(`Durum dosyası yazıldı (${belge.tur}, ${belge.favoriSayisi} favori).`); // yol günlüğe yazılmaz (kişisel klasör adı içerebilir)
  return { ok: true };
}

/** `pencereDurumKomutu` sonucunu uygular; geçersiz ya da çakışan komut hata bildirir, hiçbir şey çalıştırmaz. */
function pencereDurumKomutuIsle(komut) {
  if (!komut) return Promise.resolve({ ok: false, tur: 'yok' });
  if (komut.tur === 'pencere') {
    pencereKomutuCalistir(komut);
    return Promise.resolve({ ok: true });
  }
  if (komut.tur === 'durum') return durumKomutuCalistir(komut);
  gunluk(`Komut satırı komutu reddedildi (${komut.tur}).`);
  geriBildirim({ tur: 'hata', metin: t(komut.tur === 'cakisma' ? 'sonuc.komutCakisma' : 'sonuc.komutPencereGecersiz') });
  return Promise.resolve({ ok: false, tur: komut.tur });
}

// ---------------------------------------------------------------------------
// Yeni sürüm denetimi ve Yenilikler (o-40)
// ---------------------------------------------------------------------------
// Varsayılan KAPALI ve açık rıza ile (ayar surumDenetimi). Açıkken günde en çok bir kez GitHub'ın herkese açık sürüm adresine anahtarsız,
// çerezsiz tek GET gider (src/lib/surum-denetimi.js); bulunan sürüm yalnız BİLDİRİLİR. İndirme ve kurulum yoktur: sürüm sayfası, kullanıcı
// bildirime ya da düğmeye tıklayınca varsayılan tarayıcıda açılır. Kapalıyken ağa hiç çıkılmaz (elle denetim dahil).
const SURUM_ILK_DENETIM_MS = 90_000; // açılıştan sonra: hazır liste ve bağlantı yerleştikten sonra
const SURUM_BAKIS_MS = 6 * 60 * 60_000; // günlük sınırı denetleyici uygular; bu yalnız "zamanı geldi mi" bakışıdır
let surumDenetleyicisiNesnesi = null;
let surumZamanlayicisi = null;

function surumDenetleyicisi() {
  if (!surumDenetleyicisiNesnesi) {
    surumDenetleyicisiNesnesi = surumDenetleyicisiOlustur({
      fetch: (url, secenekler) => net.fetch(url, secenekler),
      mevcutSurum: uygulamaSurumu(),
      acikMi: () => ayarlar?.surumDenetimi === true,
      onSurumlerMi: () => ayarlar?.onSurumler === true, // o-51: "Ön sürümleri de göster"
      depo: surumDeposu({ yol: path.join(app.getPath('userData'), SURUM_DURUM_DOSYASI) }),
      gunluk,
    });
  }
  return surumDenetleyicisiNesnesi;
}

/** Yeni sürüm bildirimi (Windows bildirimi): tıklanınca sürüm sayfası tarayıcıda açılır; aynı sürüm için bir kez gösterilir. */
function yeniSurumBildir(surum, sayfa) {
  bildir(t('surum.yeniCikti', { surum }), uygulamaAdi(), { tikla: () => disariAc(sayfa || SURUM_SAYFASI) });
  surumDenetleyicisi().bildirildi(surum);
}

/** Zamanlanmış denetim: günde en çok bir kez (denetleyici sınırı uygular); kapalıysa hiçbir şey yapmaz. */
async function surumOtomatikDenetle() {
  if (!surumDenetimiAcikMi() || cikiliyor) return;
  if (guncellemeAktifMi()) {
    // o-51: uygulama içi güncelleme açıksa denetimi güncelleyici yapar (tek istek zinciri); bulunan sürüm bildirilir, indirme kullanıcıdadır
    try {
      const sonuc = await guncellemeYoneticisi().denetle();
      if (sonuc.sonuc === 'yeni' && sonuc.bildirimGerek) guncellemeYeniBildir(sonuc.surum);
    } catch {
      gunluk('Güncelleme denetimi çalıştırılamadı.');
    }
    return;
  }
  try {
    const sonuc = await surumDenetleyicisi().denetle();
    if (sonuc.sonuc === 'yeni' && sonuc.bildirimGerek) yeniSurumBildir(sonuc.surum, sonuc.sayfa);
  } catch {
    gunluk('Sürüm denetimi çalıştırılamadı.');
  }
}

/** Seçenek açıkken zamanlayıcıyı kurar (ilk bakış ilkMs sonra, sonra 6 saatte bir); kapalıyken zamanlayıcı YOKTUR. */
function surumDenetimiPlanla(ilkMs) {
  clearTimeout(surumZamanlayicisi);
  surumZamanlayicisi = null;
  if (!surumDenetimiAcikMi() || cikiliyor) return;
  surumZamanlayicisi = setTimeout(async () => {
    await surumOtomatikDenetle();
    surumDenetimiPlanla(SURUM_BAKIS_MS);
  }, ilkMs);
  if (typeof surumZamanlayicisi?.unref === 'function') surumZamanlayicisi.unref();
}

/** Elle denetim (tepsi ya da Ayarlar): seçenek kapalıysa ağa ÇIKILMAZ, 'kapali' döner. */
async function surumElleDenetle() {
  if (guncellemeAktifMi()) {
    try {
      const s = await guncellemeYoneticisi().denetle({ elle: true });
      const bilgi = guncellemeYoneticisi().durum();
      // İndirme/kurulum sürerken ya da dosya inmişken sonuç yine "yeni sürüm var"dır (ayrıntı güncelleme durumunda).
      const sonuc = s.sonuc === 'indirildi' || s.sonuc === 'mesgul' ? 'yeni' : s.sonuc === 'erken' || s.sonuc === 'desteklenmiyor' ? 'hata' : s.sonuc;
      return { ok: true, sonuc, surum: s.surum ?? bilgi.surum ?? undefined, guncelleme: true };
    } catch {
      gunluk('Güncelleme denetimi çalıştırılamadı.');
      return { ok: true, sonuc: 'hata', guncelleme: true };
    }
  }
  if (ayarlar?.surumDenetimi !== true) return { ok: true, sonuc: 'kapali' };
  try {
    const s = await surumDenetleyicisi().denetle({ elle: true });
    return { ok: true, sonuc: s.sonuc, surum: s.surum, sayfa: s.sayfa };
  } catch {
    gunluk('Sürüm denetimi çalıştırılamadı.');
    return { ok: true, sonuc: 'hata' };
  }
}

/** Tepsi: "Güncellemeleri denetle". Sonuç her zaman söylenir; seçenek kapalıysa Ayarlar'daki ilgili bölüm açılır (ağa çıkılmaz). */
async function surumTepsidenDenetle() {
  const s = await surumElleDenetle();
  if (s.sonuc === 'kapali') {
    geriBildirim({ tur: 'ok', metin: t('sonuc.surumKapali') });
    ayarlarPenceresiniAc('bolumSurum');
  } else if (s.sonuc === 'yeni') {
    if (s.guncelleme) guncellemeYeniBildir(s.surum);
    else yeniSurumBildir(s.surum, s.sayfa);
  } else if (s.sonuc === 'guncel') {
    geriBildirim({ tur: 'ok', metin: t('sonuc.surumGuncel', { surum: uygulamaSurumu() }) });
  } else if (s.sonuc === 'cok-sik') {
    geriBildirim({ tur: 'ok', metin: t('sonuc.surumCokSik') });
  } else {
    geriBildirim({ tur: 'hata', metin: t('sonuc.surumHata') });
  }
}

// ---------------------------------------------------------------------------
// Uygulama içi güncelleme (o-51)
// ---------------------------------------------------------------------------
// Varsayılan KAPALI ve açık rıza ile (ayar uygulamaGuncelleme; taşınabilir sürümde ve kurulmamış çalıştırmada etkisiz). Açıkken sürüm denetimini
// electron-updater yapar (GitHub Sürümleri, electron-builder `publish`; src/lib/guncelleme.js kuralları). Otomatik indirme ve çıkışta kurma
// KAPALIDIR: kurucu yalnız Ayarlar'daki "İndir" düğmesiyle iner (sha512 doğrulanır), kurulum ayrıca bu sürecin kendi onay penceresiyle başlar.
// electron-updater yalnız ilk gerçek kullanımda yüklenir; kapalıyken yüklenmez ve ağa hiç çıkılmaz. Home Assistant adresi/anahtarı hiçbir yere gitmez.
let guncellemeYoneticisiNesnesi = null;

function guncellemeDestegi() {
  return guncellemeDestekDurumu({ paketli: app.isPackaged, tasinabilir: tasinabilirMi(), platform: process.platform });
}

function guncellemeAktifMi() {
  return ayarlar?.uygulamaGuncelleme === true && guncellemeDestegi() === 'tamam';
}

/** Zamanlanmış/elle sürüm denetiminin herhangi biri açık mı (o-40 bildirimi ya da o-51 güncelleyici)? */
function surumDenetimiAcikMi() {
  return ayarlar?.surumDenetimi === true || guncellemeAktifMi();
}

function guncellemeYoneticisi() {
  if (!guncellemeYoneticisiNesnesi) {
    guncellemeYoneticisiNesnesi = guncellemeYoneticisiOlustur({
      guncelleyiciAl: () => require('electron-updater').autoUpdater,
      acikMi: () => ayarlar?.uygulamaGuncelleme === true,
      onSurumlerMi: () => ayarlar?.onSurumler === true,
      destekMi: guncellemeDestegi,
      mevcutSurum: uygulamaSurumu(),
      depo: surumDeposu({ yol: path.join(app.getPath('userData'), GUNCELLEME_DURUM_DOSYASI) }),
      kurulumaHazirlan: () => {
        cikiliyor = true; // quitAndInstall uygulamayı kapatır: "kaydedilmemiş değişiklik" soruları ve tepsiye gizlenme devre dışı
      },
      kurulumuBirak: () => {
        cikiliyor = false;
      },
      gunluk,
      degisti: guncellemeDurumunuYay,
    });
  }
  return guncellemeYoneticisiNesnesi;
}

/** Ayarlar penceresine güncel durum itilir (yalnız sürüm, boyut, ilerleme ve sınıflandırılmış neden; adres/yol/ham ileti YOK). */
function guncellemeDurumunuYay(durum) {
  if (!ayarlarPenceresi || ayarlarPenceresi.isDestroyed()) return;
  try {
    ayarlarPenceresi.webContents.send('guncelleme:degisti', { ok: true, ...durum });
  } catch {
    /* pencere kapanıyor */
  }
}

function guncellemeDurumu() {
  return { ok: true, ...guncellemeYoneticisi().durum() };
}

/** "Yeni sürüm var" bildirimi: tıklanınca Ayarlar > Sürüm bölümü açılır (indirme orada); aynı sürüm için bir kez. */
function guncellemeYeniBildir(surum) {
  bildir(t('guncelleme.yeniCikti', { surum }), uygulamaAdi(), { tikla: () => ayarlarPenceresiniAc('bolumSurum') });
  guncellemeYoneticisi().bildirildi(surum);
}

/** İndirme bitti ve doğrulandı: Ayarlar açıksa orada görünür, değilse bildirim kurulum için Ayarlar'ı açar (kurulum yine onay ister). */
function guncellemeIndirildiBildir(surum) {
  const gorunuyor = ayarlarPenceresi && !ayarlarPenceresi.isDestroyed() && ayarlarPenceresi.isVisible() && !ayarlarPenceresi.isMinimized();
  if (gorunuyor) return;
  bildir(t('guncelleme.indirildi', { surum }), uygulamaAdi(), { tikla: () => ayarlarPenceresiniAc('bolumSurum') });
}

/** Kurulum onayı: ana sürecin kendi yerel penceresi (varsayılan düğme "Vazgeç"; Enter yanlışlıkla kurmasın). true = kur. */
async function guncellemeKurOnayi(surum) {
  try {
    const secenekler = {
      type: 'question',
      buttons: [t('guncelleme.kurDugme'), t('diyalog.vazgec')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: uygulamaAdi(),
      message: t('guncelleme.kurMesaj', { surum: kisalt(surum, 40) }),
      detail: t('guncelleme.kurAyrinti'),
    };
    const { response } = await dialog.showMessageBox(secenekler);
    return response === 0;
  } catch {
    return false;
  }
}

/** Ayarlar "İndir": yalnız doğrulanmış bir "yeni sürüm" bilgisi varken. */
async function guncellemeIndir() {
  try {
    const yonetici = guncellemeYoneticisi();
    const onceki = yonetici.durum().durum;
    const s = await yonetici.indir();
    if (s.sonuc === 'indirildi' && onceki !== 'indirildi') guncellemeIndirildiBildir(s.surum);
    return { ok: true, sonuc: s.sonuc, neden: s.neden, surum: s.surum };
  } catch {
    gunluk('Güncelleme indirilemedi.');
    return { ok: true, sonuc: 'hata', neden: 'bilinmiyor' };
  }
}

/** Ayarlar "Kur ve yeniden başlat": önce onay penceresi; onaylanırsa dosya yeniden doğrulanıp kurulur. */
async function guncellemeKur() {
  try {
    const yonetici = guncellemeYoneticisi();
    const d = yonetici.durum();
    if (d.durum !== 'indirildi' || !d.surum) return { ok: true, sonuc: 'gecersiz' };
    if (!(await guncellemeKurOnayi(d.surum))) return { ok: true, sonuc: 'vazgecildi' };
    const s = await yonetici.kur();
    return { ok: true, sonuc: s.sonuc, neden: s.neden, surum: s.surum };
  } catch {
    gunluk('Güncelleme kurulamadı.');
    return { ok: true, sonuc: 'hata', neden: 'kurulum' };
  }
}

/** Ayarlar'ın "Sürüm" bölümü için kayıtlı bilgi (ağa çıkmaz). */
function surumBilgisi() {
  return { ok: true, surum: uygulamaSurumu(), ...surumDenetleyicisi().bilgi() };
}

/** Çalışan sürümün notları: uygulamayla paketlenen CHANGELOG.md'den (ağ yok). Dosya yoksa/okunamazsa bulundu:false. */
function yenilikleriGetir() {
  const surum = uygulamaSurumu();
  const yok = { ok: true, surum, bulundu: false, baslik: '', metin: '' };
  try {
    const yol = path.join(KOK_DIZIN, 'CHANGELOG.md');
    if (fs.statSync(yol).size > 1_000_000) return yok;
    return { ok: true, surum, ...yenilikleriAyikla(fs.readFileSync(yol, 'utf8'), surum) };
  } catch {
    return yok;
  }
}

/**
 * Tanılama raporu (o-41, src/lib/tanilama.js): sürüm, Windows yapısı, adres SINIFI (adresin kendisi değil), bağlantı kipi, yetki kesici
 * durumu, hatalı deneme sayısı, son başarı ve günlüğün maskelenmiş son satırları. Erişim anahtarı ve günlük dosyasının yolu girmez.
 * Metin her çağrıda ana süreçte kurulur (renderer metin yollamaz); kopyalama da aynı metni panoya yazar.
 */
function tanilamaRaporu() {
  const kullaniciAdlari = [];
  try {
    kullaniciAdlari.push(os.userInfo().username);
  } catch {
    // kullanıcı bilgisi okunamazsa yalnız klasör adıyla yetinilir
  }
  try {
    kullaniciAdlari.push(path.basename(app.getPath('home')));
  } catch {
    // kullanıcı klasörü bilinmiyorsa genel kurallar (C:\Users\<ad>) yine çalışır
  }
  return raporOlustur({
    kullaniciAdlari,
    simdi: new Date(),
    uygulamaSurumu: uygulamaSurumu(),
    paketTuru: tasinabilirMi() ? 'tasinabilir' : app.isPackaged ? 'kurulu' : 'gelistirme',
    surumler: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    isletimSistemi: { platform: process.platform, surum: os.release(), mimari: process.arch },
    yerelAdres: ayarlar?.yerelAdres ?? null,
    disAdres: ayarlar?.disAdres ?? null,
    baglantiTuru,
    canli: ws.canliMi(),
    anahtarVar: anahtarDeposu.varMi(),
    yetkiDurumu,
    anahtarYonetici: anahtarDeposu.varMi() ? anahtarYonetici : null, // o-43
    hataliDeneme: yetkiKesici.hataliDenemeSayisi(),
    yetkiKaydiSorunu: yetkiKesici.kayitSorunu(),
    sonBasari,
    gunlukSatirlari: gunlukSonSatirlari({ fs, yol: gunlukKaydi.yol, eskiYol: gunlukKaydi.eskiYol }),
    disTetikler: disTetikler.tanilamaOzeti(), // 1.4.0 dis grubu: yalnız açık/kapalı ve sayılar (jeton, ad, bağlantı yok)
  });
}

/**
 * Odadan ilk kurulum önerisi (o-44, src/lib/oda-kurulum.js): HA'daki oda (alan) kaydı ve güncel durumlar okunur; yalnız Kapı Kuralı'ndan
 * geçen, zararsız, eylem alanındaki varlıklar odalara göre önerilir. Oda kaydı canlı WebSocket gerektirir; canlı değilse neden kodu
 * döner (metni sayfa kendi dilinde yazar). Hiçbir şey kaydedilmez ve servis çağrılmaz: sayfa öneriyi favori SEÇİMİNE ekler, kayıt kullanıcının
 * "Kaydet"idir (favoriler:kaydet kendi süzgecinden yine geçirir).
 */
async function odalariGetir() {
  if (!ws.canliMi()) return { ok: false, neden: 'canli-yok' };
  try {
    const [durumlar, alanVerisi] = await Promise.all([haIstek('/api/states'), haOkuma.alanlar()]);
    if (!Array.isArray(durumlar)) return { ok: false, neden: 'hata' };
    if (haOkuma.kapaliUclar().includes('alanlar')) return { ok: false, neden: 'yetki' }; // oda kaydı bu anahtarla okunamıyor (yönetici gerekir)
    return { ok: true, odalar: odaOnerileri({ durumlar, alanVerisi, dil: etkinDil }), alanSayisi: alanVerisi.alanlar.length };
  } catch {
    return { ok: false, neden: 'hata' };
  }
}

/** Ayarlar önizlemesi: rapor metni (yalnız gösterilir). */
function tanilamaGetir() {
  try {
    const { metin, gunlukSatiri } = tanilamaRaporu();
    return { ok: true, metin, gunlukSatiri };
  } catch {
    return { ok: false };
  }
}

/** Raporu panoya yazar ve AYNI metni önizleme için geri verir (kullanıcı yapıştırmadan önce ne kopyalandığını görür). */
function tanilamaKopyala() {
  try {
    const { metin, gunlukSatiri } = tanilamaRaporu();
    clipboard.writeText(metin);
    gunluk(`Tanılama raporu panoya kopyalandı (${gunlukSatiri} günlük satırı).`);
    return { ok: true, metin, gunlukSatiri };
  } catch {
    return { ok: false };
  }
}

/** "Günlük dosyasını göster": dosya yoksa klasörü açar. Yol arayüze verilmez, yalnız sonuç döner. */
function gunlukKlasoruAc() {
  const yol = gunlukKaydi.yol;
  if (!yol) return { ok: false, neden: 'yok' };
  try {
    if (fs.existsSync(yol)) {
      shell.showItemInFolder(yol);
      return { ok: true };
    }
    if (fs.existsSync(path.dirname(yol))) {
      shell.openPath(path.dirname(yol)).catch(() => {});
      return { ok: true, klasor: true };
    }
  } catch {
    /* açılamadı */
  }
  return { ok: false, neden: 'yok' };
}

/**
 * REST yedeği: izlenen varlıkların durumunu HA'dan okur ve depoya yazar. Canlı bağlantı kuruluyken (zorla: false) hiçbir
 * şey yapmaz: depoyu zaten canlı bağlantı günceller. 25'e kadar varlık için varlık başına istek, fazlası için tek /api/states.
 */
async function durumlariYenile({ zorla = false } = {}) {
  // Favori yoksa ama bilgi kartları (sensör şeridi, hava, takvim, yapılacaklar), tepsi rozeti sensörü ya da uyarı kuralı varlıkları seçiliyse yine okunur
  // (kural varlıkları REST yedeğinde de okunur; 1.4.0).
  if (!anahtarDeposu.varMi() || !ayarlar || (ayarlar.favoriler.length === 0 && bilgiKimlikleri(ayarlar).size === 0 && tepsiRozeti.izlenenKimlikler().length === 0 && bildirimAkisi.izlenenKimlikler().size === 0 && kameraIzinleri().length === 0)) {
    depo.sifirla();
    return undefined;
  }
  if (!zorla && ws.canliMi()) return undefined;
  if (favoriYenilemeSuruyor) {
    // Süren (belki eylemden ÖNCE başlamış) yenilemeye katılmak bayat durum bırakır: zorla istek "bitince bir tur daha" işareti bırakır (h-20).
    if (zorla) favoriYenilemeTekrari = true;
    return favoriYenilemeSuruyor;
  }
  favoriYenilemeSuruyor = (async () => {
    try {
      const kimlikler = [...izlenenKimlikler()];
      if (kimlikler.length > REST_TEK_ISTEK_SINIRI) {
        const tum = await haIstek('/api/states');
        const liste = durumlariSuz(tum, kimlikler);
        if (!liste) throw new HaHatasi('sunucu');
        depo.toplu(liste, kimlikler);
      } else {
        // En çok REST_ESZAMANLILIK istek aynı anda; ilk hatada (401, 403, ağ) kalanlar HİÇ başlatılmaz. Her istek ayrıca
        // yetki kesiciden ve tek doğrulama geçidinden geçer (ha-istemcisi.js): hepsi aynı milisaniyede patlamaz.
        // ilkTek: ilk istek TEK başına gider (anahtar o anda geçerli mi bilinmiyor: iptal edilmişse HA'ya en çok 1 hatalı deneme);
        // başarırsa kalanlar REST_ESZAMANLILIK kadar paralel sürer.
        const sonuclar = await sinirliEszamanli(
          kimlikler,
          REST_ESZAMANLILIK,
          async (kimlik) => {
            if (!zorla && ws.canliMi()) return [kimlik, undefined];
            try {
              return [kimlik, await haIstek(`/api/states/${kimlik}`)];
            } catch (hata) {
              if (hata.tur === 'bulunamadi') return [kimlik, null];
              throw hata;
            }
          },
          { ilkTek: true },
        );
        for (const [kimlik, varlik] of sonuclar) {
          if (varlik === undefined) continue;
          const d = varlik === null ? null : durumuDuzelt(varlik);
          if (d && d.entity_id === kimlik) depo.guncelle(d);
          else depo.yokIsaretle(kimlik);
        }
      }
      depo.sonHata = null;
      sonBasari = Date.now();
    } catch (hata) {
      depo.sonHata = hata;
    } finally {
      favoriSonYenileme = Date.now();
      favoriYenilemeSuruyor = null;
      tepsiyiGuncelle(); // sonHata değişmiş olabilir: ipucundaki "(son bilinen)" notu
      if (favoriYenilemeTekrari) {
        favoriYenilemeTekrari = false;
        if (!cikiliyor) Promise.resolve().then(() => durumlariYenile({ zorla: true })); // süren turun sonucu bayat olabilir: yeni tur
      }
    }
  })();
  return favoriYenilemeSuruyor;
}

/** Yıkıcı eylem için onay penceresi (tepsi menüsü; soru-3). true = "Çalıştır". Açıkken ana pencere odak kaybıyla gizlenmez. */
async function onayDiyalogu(ad, kimlik) {
  acikOnaySayisi += 1;
  odakKaybiZamanlayicisiniIptalEt();
  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('diyalog.calistir'), t('diyalog.vazgec')],
      defaultId: 1, // Enter'a yanlışlıkla basmak çalıştırmasın
      cancelId: 1,
      noLink: true,
      title: uygulamaAdi(),
      message: t('diyalog.calistirilsinMi', { ad: kisalt(ad, AD_SINIRI) }),
      detail: onayAciklamasi(kimlik, t),
    });
    return response === 0;
  } catch {
    return false;
  } finally {
    acikOnaySayisi -= 1;
  }
}

/** Başka bir onay penceresi açıkken yeni tıklama sessizce yutulmaz: kullanıcıya neden bir şey olmadığı söylenir. */
function onayBekleniyorBildir() {
  gunluk('Favori tıklaması yok sayıldı: bekleyen bir onay penceresi var.');
  geriBildirim({ tur: 'hata', metin: t('bildirim.onayBekliyor') });
}

/** "Panolar" öğesi / pano kısayolu: ana pencereyi gösterir ve HA panosunu açar (yol ayarda doğrulanmış güvenli bir HA yoludur). */
function panoAc(pano) {
  pencereyiGoster();
  panoyaGit(pano.yol); // gösterimden SONRA: uzun gizli kaldıysa ana panoya dönüş bunu ezmesin
}

/** Windows menülerinde ikinci düzey için ortak öğe: onay kutulu (aç/kapa) ya da düz. */
function favoriMenuOgesi(oge) {
  const tikla = () => eylem.tepsiTikla(oge.kimlik);
  return oge.checkbox
    ? { label: menuMetni(oge.label), type: 'checkbox', checked: oge.checked, click: tikla }
    : { label: menuMetni(oge.label), click: tikla };
}

/**
 * Tepsi menüsünün favori bölümü (hiz-15): ilk 8 zararsız favori üst düzeyde (tek tık), kalanlar "Diğer favoriler"de,
 * onay isteyenler "Onaylı eylemler"de (tıklayınca onay penceresi), ayarlı panolar "Panolar"da. Karolar GÜVENLİK KURALI
 * süzgecinden geçmiş modeldir: kapı/kilit/alarm menüde hiç yoktur.
 */
function favoriMenuOgeleri() {
  if (!anahtarDeposu.varMi()) {
    return [{ label: t('menu.anahtarEkle'), click: ayarlarPenceresiniAc }];
  }
  const plan = tepsiMenuPlani(favoriKarolari(), { t });
  const ogeler = [];
  if (gosterilecekHata()) ogeler.push({ label: t('menu.durumAlinamadi', { hata: hataMetni(gosterilecekHata(), t) }), enabled: false });
  if (plan.ust.length + plan.alt.length + plan.yikici.length === 0) {
    ogeler.push({ label: t('menu.favoriYok'), click: ayarlarPenceresiniAc });
  }
  ogeler.push(...plan.ust.map(favoriMenuOgesi));
  if (plan.alt.length > 0) ogeler.push({ label: t('menu.digerFavoriler'), submenu: plan.alt.map(favoriMenuOgesi) });
  if (plan.yikici.length > 0) ogeler.push({ label: t('menu.onayliEylemler'), submenu: plan.yikici.map(favoriMenuOgesi) });
  if (ayarlar.panolar.length > 0) {
    ogeler.push({ label: t('menu.panolar'), submenu: ayarlar.panolar.map((pano) => ({ label: menuMetni(pano.ad), click: () => panoAc(pano) })) });
  }
  return ogeler;
}

/**
 * "Ekrana taşı" altmenüsü (o-32): birden çok ekran bağlıysa ana pencerenin açılacağı ekran seçilir (işaretli ekran = tercih); "Tercih yok"
 * her açılışta imlecin ekranını kullanır. Tek ekranda menü öğesi hiç eklenmez. Planı src/lib/tepsi-menu.js ekranMenuPlani üretir.
 */
function ekranaTasiMenusu() {
  const plan = ekranMenuPlani(ekranOzetleriAl(screen), ayarlar.tercihEkran, t);
  if (plan.length === 0) return [];
  return [
    {
      label: t('menu.ekranaTasi'),
      submenu: [
        ...plan.map((ekran) => ({ label: menuMetni(ekran.label), type: 'radio', checked: ekran.checked, click: () => tercihEkraniAyarla(ekran.id) })),
        { type: 'separator' },
        { label: t('menu.ekranTercihiYok'), type: 'radio', checked: !plan.some((ekran) => ekran.checked), click: () => tercihEkraniAyarla(null) },
      ],
    },
  ];
}

/**
 * Tercih edilen ekranı kaydeder (tepsi menüsü; `null` = tercih yok) ve ana pencere görünürse hemen o ekrana taşır. Seçilen ekran
 * bağlı değilse hiçbir şey değişmez. Ekran söküldüğünde tercih silinmez: pencere imlecin ekranında açılır, ekran dönünce tercih geçerli olur.
 */
function tercihEkraniAyarla(ekranId) {
  if (ekranId === null) {
    ayarlar.tercihEkran = {};
  } else {
    const ekran = ekranOzetleriAl(screen).find((e) => e.id === ekranId);
    if (!ekran) return;
    ayarlar.tercihEkran = tercihKaydiOlustur(ekran);
  }
  ayarlariYaz();
  anaPencereyiTercihEkranaTasi();
}

/** Ana pencere görünürse yeni yerleşim kuralıyla yeniden yerleştirilir (gizliyse bir sonraki gösterimde uygulanır). */
function anaPencereyiTercihEkranaTasi() {
  if (!anaPencere || anaPencere.isDestroyed() || !anaPencere.isVisible() || anaPencere.isMinimized() || anaPencere.isFullScreen()) return;
  const s = anaPencere.getBounds();
  pencereyiYerlestir({ x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height / 2) });
}

/** 1.4.0 eylem grubu (o-12): geri alınacak bir girdi varsa "Geri al: <ad>" öğesi; adımlar aynı güvenli eylem hattından geçer. */
function geriAlMenuOgesi() {
  const ozet = eylemEk.modelBolumu().geriAl;
  if (!ozet) return [];
  return [{ type: 'separator' }, { label: menuMetni(t('tepsi.geriAl', { ad: ozet.ad })), click: () => void eylemEk.geriAl('tepsi-menu') }];
}

/**
 * 1.4.0 eylem grubu (o-15): bekleyen zamanlı eylemler varsa "Zamanlı eylemler (N)" alt menüsü: her biri tek tıkla iptal edilir, "Hepsini iptal et".
 * Menü her açılışta kurulur; bekleyen yoksa öğe hiç görünmez. Etiketler Kapı Kuralı'ndan geçmiş ad ve kullanıcı saat biçimindeki saati taşır.
 */
function gecikmeliMenuOgesi() {
  const liste = eylemEk.modelBolumu().gecikmeli;
  if (!Array.isArray(liste) || liste.length === 0) return [];
  const saat = (ms) => kullaniciSaatMetni(ms, { saatBicimi: ayarlar?.saatBicimi });
  return [
    {
      label: menuMetni(t('tepsi.gecikmeli', { n: liste.length })),
      submenu: [
        ...liste.map((o) => ({ label: menuMetni(t(o.yon === 'ac' ? 'tepsi.gecikmeli.ac' : 'tepsi.gecikmeli.kapat', { ad: o.ad, saat: saat(o.bitis) })), click: () => void eylemEk.gecikmeliIptal(o.id, 'tepsi-menu') })),
        ...(liste.length > 1 ? [{ type: 'separator' }, { label: menuMetni(t('tepsi.gecikmeli.hepsi')), click: () => void eylemEk.gecikmeliHepsiniIptal() }] : []),
      ],
    },
  ];
}

function tepsiMenusuOlustur() {
  const gorunur =!!anaPencere && !anaPencere.isDestroyed() && anaPencere.isVisible() && !anaPencere.isMinimized();
  const oturum = otomatikBaslatDurumu(); // Windows'taki gerçek durum (Görev Yöneticisi'nden kapatılmış olabilir)
  let oturumEtiketi = t('menu.oturum');
  if (!app.isPackaged) oturumEtiketi += t('menu.oturumYalnizKurulu');
  else if (tasinabilirMi()) oturumEtiketi += t('menu.oturumTasinabilir');
  else if (oturum.durum === 'windows-kapatmis') oturumEtiketi += t('menu.oturumWindowsKapatmis');
  const sablon = [
    { label: `${uygulamaAdi()} — ${baglantiDurumMetni()}`, enabled: false },
    ...(yetkiDurumu ? [{ label: yetkiMenuMetni(), click: ayarlarPenceresiniAc }] : []),
    { type: 'separator' },
    {
      label: gorunur ? t('menu.pencereyiGizle') : t('menu.pencereyiGoster'),
      accelerator: kayitliKisayol || undefined,
      registerAccelerator: false,
      click: () => (gorunur ? pencereyiGizle() : pencereyiGoster()),
    },
    { type: 'separator' },
    ...favoriMenuOgeleri(),
    ...geriAlMenuOgesi(),
    ...gecikmeliMenuOgesi(),
    { type: 'separator' },
    { label: t('menu.yenile'), click: () => yenile() },
    { label: t('menu.ayarlar'), click: ayarlarPenceresiniAc },
    { label: t('menu.guncellemeDenetle'), click: () => surumTepsidenDenetle().catch(() => {}) },
    { label: t('menu.yenilikler'), click: () => ayarlarPenceresiniAc('bolumSurum') },
    {
      label: t('menu.genisPencere'),
      type: 'checkbox',
      checked: ayarlar.pencereBoyutu === 'genis',
      click: (oge) => pencereBoyutuDegistir(oge.checked ? 'genis' : 'hizli'),
    },
    ...ekranaTasiMenusu(),
    {
      label: t('menu.disariTiklayinca'),
      type: 'checkbox',
      checked: ayarlar.odakKaybindaGizle,
      click: (oge) => odakKaybindaGizleAyarla(oge.checked),
    },
    {
      label: oturumEtiketi,
      type: 'checkbox',
      checked: oturum.durum === 'gelistirme' ? ayarlar.otomatikBaslat : ayarlar.otomatikBaslat && oturum.durum === 'etkin',
      enabled: app.isPackaged && !tasinabilirMi(),
      click: (oge) => otomatikBaslatAyarla(oge.checked),
    },
    { type: 'separator' },
    { label: t('menu.cikis'), click: cik },
  ];
  return Menu.buildFromTemplate(sablon);
}

function tepsiOlustur() {
  tepsi = new Tray(tepsiSoluk ? IKON_SOLUK : IKON_ICO); // başlangıç "bağlanıyor": soluk; bağlanınca normal simgeye döner
  tepsiRozeti.baslangic(); // ilk simge dosya simgesi: rozet (varsa) ilk güncellemede gelir
  sonTepsiIpucu = '';
  tepsiyiGuncelle();
  // Sol tık: hızlı panel (ayar: tepsiSolTik 'panel') ya da eskisi gibi geniş pencere ('pencere'); ikisi de aynı tiklamaKarari kuralıyla açar/kapatır.
  // Windows çift tıklamada "tık, çift tık, tık" üretir: ikinci tık ilkiyle aynı tık sayılır, panel açılıp hemen kapanmaz (k-17).
  tepsi.on('click', () => {
    if (!tepsiTiklamaEngeli.gec('tepsi')) return;
    if (ayarlar?.tepsiSolTik === 'pencere') pencereyiAcKapat('tepsi');
    else yuzey.panelAcKapat('tepsi');
  });
  // Orta tık (o-20, yalnız Windows): Ayarlar'da seçilen TEK zararsız favori çalışır ('' = kapalı, hiçbir şey olmaz). Eylem kısayolla aynı
  // güvenli hattan geçer (eylem.tepsiOrtaTikla); art arda basışlar tek tık sayılır. Ağ ya da HA yoksa hata bildirimi çıkar, uygulama düşmez.
  tepsi.on('middle-click', () => {
    const kimlik = ayarlar?.tepsiOrtaTik;
    if (typeof kimlik !== 'string' || kimlik === '') return;
    if (!ortaTikEngeli.gec('orta-tik')) return;
    Promise.resolve(eylem.tepsiOrtaTikla(kimlik)).catch(() => gunluk('Tepsi orta tık eylemi tamamlanamadı.'));
  });
  // Menü her açılışta depodaki güncel durumla yeniden kurulur; canlı bağlantı yokken (REST yedeği) bayatsa tazelenir.
  tepsi.on('right-click', () => {
    tepsi.popUpContextMenu(tepsiMenusuOlustur());
    if (!ws.canliMi() && Date.now() - favoriSonYenileme > 10_000) durumlariYenile();
  });
  tepsi.on('mouse-enter', () => {
    if (!ws.canliMi() && Date.now() - favoriSonYenileme > 10_000) durumlariYenile();
  });
}

function cik() {
  cikiliyor = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// İzinler: yalnız iki HA adresi için bildirim ve tam ekran (HA'daki video/kamera tam ekran düğmesi; h-36); gerisi
// (kamera, mikrofon, konum, pano...) red. Diğer köken ve file: sayfaları hiçbir izin alamaz.
// ---------------------------------------------------------------------------

const IZINLI_IZINLER = new Set(['notifications', 'fullscreen']);

function izinleriAyarla(oturum) {
  oturum.setPermissionRequestHandler((_wc, izin, geriCagir, ayrinti) => {
    geriCagir(IZINLI_IZINLER.has(izin) && izinliKokenMi(kokenAl(ayrinti?.requestingUrl)));
  });
  oturum.setPermissionCheckHandler((_wc, izin, istekKokeni) => {
    return IZINLI_IZINLER.has(izin) && izinliKokenMi(kokenAl(istekKokeni));
  });
  oturum.setDevicePermissionHandler(() => false); // USB / HID / seri port
}

// ---------------------------------------------------------------------------
// IPC — yalnız yerel sayfalarımızdan (offline.html, ayarlar.html) kabul edilir
// ---------------------------------------------------------------------------

const izinYok = () => ({ ok: false, hata: t('ana.izinYok') });

/** Bekleyen "Düzenle…" odağını bir kez verir (sonraki özetlerde null). */
function odakFavoriyiAl() {
  const kimlik = bekleyenOdakFavori;
  bekleyenOdakFavori = null;
  return kimlik;
}

async function ayarOzeti() {
  void anahtarYoneticisiniOlc(); // o-43: bilinmiyorsa arka planda ölçülür; sonuç 'ayarlar:anahtar-yonetici' ile gelir (özet beklemez)
  return {
    yerelAdres: ayarlar.yerelAdres,
    disAdres: ayarlar.disAdres,
    kisayol: ayarlar.kisayol, // yalnız başarıyla kaydedilen kısayol ayara yazılır: bu, fiilen etkin olandır
    kisayolEtkin: kayitliKisayol === ayarlar.kisayol,
    dil: etkinDil, // etkin arayüz dili: 'tr' | 'en' | 'de' | 'fr' | 'es'
    dilAyari: ayarlar.dil, // ayardaki değer: 'sistem' | 'tr' | 'en' | 'de' | 'fr' | 'es'
    sistemDili: dilCoz('sistem', sistemDiliAl()), // 'sistem' seçilirse kullanılacak dil: 'tr' | 'en' | 'de' | 'fr' | 'es'
    kisayolUyarilari: kisayolUyarilari(ayarlar.kisayol, t),
    varsayilanKisayol: VARSAYILAN_KISAYOL,
    paletKisayol: ayarlar.paletKisayol,
    varsayilanPaletKisayolu: VARSAYILAN_PALET_KISAYOLU,
    paletKisayolUyarilari: ayarlar.paletKisayol ? kisayolUyarilari(ayarlar.paletKisayol, t) : [],
    tepsiSolTik: ayarlar.tepsiSolTik,
    canliBaglanti: ayarlar.canliBaglanti,
    canliDurum: ws.durum().baglanti,
    panolar: ayarlar.panolar.map(({ ad, yol, kisayol }) => ({ ad, yol, kisayol: kisayol ?? '' })),
    kisayolDurumlari: kisayolDurumlari.map(({ id, tur, kisayol, kimlik, sira, gecerli, neden, mesaj, durum }) => ({ id, tur, kisayol, kimlik, sira, gecerli, neden, mesaj, durum })),
    hazirListeGuncel: ayarlar.hazirListeSurumu >= HAZIR_LISTE_SURUMU,
    otomatikBaslat: ayarlar.otomatikBaslat,
    otomatikBaslatDestekleniyor: app.isPackaged && !tasinabilirMi(),
    otomatikBaslatDurumu: otomatikBaslatDurumu(),
    pencereBoyutu: ayarlar.pencereBoyutu,
    odakKaybindaGizle: ayarlar.odakKaybindaGizle,
    anaPanoyaDonDk: ayarlar.anaPanoyaDonDk,
    koseBildirimi: ayarlar.koseBildirimi,
    bipSesi: ayarlar.bipSesi,
    temaZorla: ayarlar.temaZorla,
    vurguRengi: ayarlar.vurguRengi,
    yeniPencereMalzemesi: ayarlar.yeniPencereMalzemesi,
    malzemeDestekleniyor: malzemeDestekliMi(os.release()),
    anahtarVar: anahtarDeposu.varMi(),
    girisTuru: oauthYoneticisi.oturumVarMi() ? 'tarayici' : manuelAnahtarDeposu.varMi() ? 'anahtar' : null, // 1.4.0 (o-57): kayıtlı girişin türü (değeri değil)
    anahtarReddedildi, // yetki kesici açık: Ayarlar "reddedildi" durumunu ve yeni anahtar gerektiğini gösterir
    yetkiDurumu, // 'reddedildi' | 'dogrulanamadi' | 'kayit-onayi' | 'yerel-yasak' | null: son üçünde Ayarlar "Yeniden Dene" düğmesini gösterir
    yetkiHataliDeneme: yetkiKesici.hataliDenemeSayisi(), // hata bütçesi (sırsız sayı): >= 2 iken yeni anahtar açık ikinci onay ister
    anahtarKarantinada: anahtarDeposu.karantinadaMi(), // reddedilen anahtarın kaydı yazılamadığı için dosyası kenara alındı
    yetkiKaydiSorunu: yetkiKesici.kayitSorunu(), // 'yazilamadi' | 'okunamadi' | null: kesici kaydı diske yazılamıyor/okunamıyor (Ayarlar uyarır)
    anahtarYonetici, // o-43: true = anahtar yönetici kullanıcıya ait (uyarı), false = yönetici değil (önerilen), null = bilinmiyor
    ortaTikAlanlari: [...ORTA_TIK_ALANLARI], // o-20: tepsi orta tıkına seçilebilen alanlar (Ayarlar seçici listesi)
    sifrelemeVar: await anahtarDeposu.kullanilabilirMi(),
    favoriler: ayarlar.favoriler.map(({ entity_id, ad, onay, etiket, kisayol, parlaklik, simge, renk, boyut, tepsi, kisayolEylemi, gostergeMin, gostergeMax, grafikTuru }) => ({ entity_id, ad, onay, etiket, kisayol, parlaklik, kisayolEylemi, simge, renk, boyut, ...(tepsi === true ? { tepsi: true } : {}), ...(gostergeMin !== undefined && gostergeMax !== undefined ? { gostergeMin, gostergeMax } : {}), ...(grafikTuru !== undefined ? { grafikTuru } : {}) })),
    odakFavori: odakFavoriyiAl(), // panel menüsünden "Düzenle…" ile açıldıysa odaklanılacak favori (bir kez)
    ayarDosyasi: ayarDosyasiYolu(),
    // o-32: bağlı ekranlar (tercih edilen ekran seçici): kimlik, o dilde etiket ve sınırlar; yalnız sayılar ve kısa metin
    ekranlar: ekranOzetleriAl(screen).map((e, sira) => ({ id: e.id, etiket: ekranEtiketi(e, sira, t), x: e.sinirlar.x, y: e.sinirlar.y, genislik: e.sinirlar.width, yukseklik: e.sinirlar.height })),
    ...ekAyarOzeti(ayarlar), // 1.4.0: ayar-alanlari.js tablosundaki alanlar (ozette:true)
  };
}

/**
 * 1.4.0: ayar-alanlari.js tablosundaki bir alan "Ayarları Kaydet" (ya da içe aktarma) ile DEĞİŞİNCE çağrılacak dinleyiciler.
 * Kullanım (özellik ajanları): ekAyarDinle('panelHerZamanUstte', (yeni, eski) => yuzey.ustteTut(yeni));
 * Dinleyici hatası kaydı durdurmaz (günlüğe sabit metin yazılır).
 */
const ekAyarDinleyicileri = new Map(); // ad -> Function[]
function ekAyarDinle(ad, dinleyici) {
  if (typeof dinleyici !== 'function') return;
  if (!ekAyarDinleyicileri.has(ad)) ekAyarDinleyicileri.set(ad, []);
  ekAyarDinleyicileri.get(ad).push(dinleyici);
}
function ekAyarDegisimleriniYay(degisenler) {
  for (const { ad, eski, yeni } of degisenler) {
    for (const dinleyici of ekAyarDinleyicileri.get(ad) ?? []) {
      try {
        dinleyici(yeni, eski);
      } catch {
        gunluk(`Ayar değişikliği uygulanamadı (${ad}).`);
      }
    }
  }
}

// --- Bilgi kartları (o-04, o-07, o-08, o-09, o-10, o-11) ayar dinleyicileri ---
/** Bilgi bölümünün izlenen varlıkları değişti: izlenen küme budanır, canlı abonelik yenilenir, eksik durumlar okunur, panel ve tepsi tazelenir. */
function bilgiIzleneniYenile() {
  depo.buda(izlenenKimlikler());
  if (ws.canliMi()) ws.abonelikYenile();
  else ws.yenidenBaglan();
  if (!ws.canliMi()) durumlariYenile({ zorla: true });
  yuzey.modelDegisti();
  tepsiyiGuncelle();
}
for (const ad of ['sensorSeridi', 'ustKart1', 'ustKart2', 'havaVarligi', 'birincilMedya', 'takvimler', 'yapilacakListeleri', 'hizliListe']) {
  ekAyarDinle(ad, bilgiIzleneniYenile);
}
for (const ad of ['saatBicimi', 'tarihBicimi', 'takvimGunSayisi', 'sensorGrafik', 'sensorGrafikSaat', 'pilEsigi', 'sensorTepsiIpucu', 'havaTahmini', 'medyaKapagi']) {
  ekAyarDinle(ad, () => {
    yuzey.modelDegisti();
    tepsiyiGuncelle();
  });
}
// --- Pencere grubu (1.4.0: o-22, o-27, o-32, o-33) ayar dinleyicileri ---
/** Tepsi rozeti ayarı (mod ya da sensör) değişti: izlenen küme ve abonelik yenilenir, simge hemen yeniden hesaplanır. */
function tepsiRozetiAyariDegisti() {
  depo.buda(izlenenKimlikler());
  if (ws.canliMi()) ws.abonelikYenile();
  else durumlariYenile({ zorla: true });
  sonTepsiIpucu = ''; // sensör eki ipucunda: aynı metin kalsa bile yeniden yazılsın
  tepsiyiGuncelle();
}
// Cihaz grubu (1.4.0, o-48): kamera izinleri değişti -> izlenen küme budanır, abonelik yenilenir, bellekteki kareler silinir, koruma yeniden uygulanır.
ekAyarDinle('kameraIzinleri', () => {
  kamera.temizle();
  yuzey.kameraDegisti();
  bilgiIzleneniYenile();
});
for (const ad of ['kameraBulanik', 'kameraYenilemeSn']) ekAyarDinle(ad, () => yuzey.modelDegisti());
ekAyarDinle('panelHerZamanUstte', () => yuzey.ustteDegisti());
for (const ad of ['geriAl', 'geriAlSureDk']) ekAyarDinle(ad, () => eylemEk.geriAlAyarDegisti()); // 1.4.0 eylem grubu (o-12): kapanınca yığın boşalır, süre canlı uygulanır
ekAyarDinle('gecikmeliEylem', () => eylemEk.gecikmeliAyarDegisti()); // 1.4.0 eylem grubu (o-15): kapanınca bekleyen zamanlı eylemler iptal olur
ekAyarDinle('sonDegisenler', () => eylemEk.sonDegisenlerAyarDegisti()); // 1.4.0 eylem grubu (o-18): kapanınca liste silinir
ekAyarDinle('panelGruplama', () => eylemEk.odaAyarDegisti()); // 1.4.0 eylem grubu (o-14): panel tür / oda gruplaması
ekAyarDinle('paletDigerCihazlar', () => eylemEk.digerAyarDegisti()); // 1.4.0 eylem grubu (o-46): kapanınca favori dışı cihaz listesi silinir
ekAyarDinle('panelOpaklik', () => {
  yuzey.opaklikDegisti();
  anaPencereOpaklikUygula();
});
ekAyarDinle('tercihEkran', () => anaPencereyiTercihEkranaTasi());
ekAyarDinle('tepsiRozeti', tepsiRozetiAyariDegisti);
ekAyarDinle('tepsiRozetSensoru', tepsiRozetiAyariDegisti);
ekAyarDinle('tepsiRozetSensorleri', tepsiRozetiAyariDegisti);
ekAyarDinle('masaustuKarolari', () => masaustuKarolari.esitle());
ekAyarDinle('masaustuKaroUstte', () => masaustuKarolari.ustteDegisti());
// Grup "tema" (o-25, o-29, o-34): görünüm ayarları değişince açık pencereler güncellenir. Sayfaların kendi görünümü (renkler, animasyon)
// `gorunum` olarak her gösterimde yeniden gönderilir; burada yalnız pencere düzeyindeki şeyler (arka plan rengi/malzemesi, yakınlaştırma) tazelenir.
ekAyarDinle('metinOlcegi', () => yuzey.metinOlcegiUygula());
// Grup "etkilesim" (o-20, o-23, o-60, o-38): tekerlek / sabitleme açık sayfaya hemen bildirilir; diğerleri bir sonraki olayda okunur
for (const ad of ['karoTekerlegi', 'panelSabit']) ekAyarDinle(ad, () => yuzey.etkilesimDegisti());
ekAyarDinle('kisayolBasiliTut', () => basiliTut.sifirla());
for (const ad of ['baglantiBildirimi', 'baglantiBildirimSn']) ekAyarDinle(ad, () => baglantiBildirimi.ayarDegisti());
for (const ad of ['yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelArkaPlani']) ekAyarDinle(ad, () => gorunumuYenile());

function ipcKaydet() {
  // --- offline.html ---
  ipcMain.handle('baglanti:tekrar-dene', (olay) => {
    if (!yerelOlaydanMi(olay, anaPencere, OFFLINE_HTML)) return false;
    denemeSayaci = 0; // elle deneme: artan bekleme ve çökme sınırı başa döner
    cokmeGecmisiniSifirla();
    baglan();
    return true;
  });
  ipcMain.handle('ayarlar:ac', (olay) => {
    if (!yerelOlaydanMi(olay, anaPencere, OFFLINE_HTML)) return false;
    ayarlarPenceresiniAc();
    return true;
  });

  // --- ayarlar.html ---
  const ayarlardan = (olay) => yerelOlaydanMi(olay, ayarlarPenceresi, AYARLAR_HTML);

  ipcMain.handle('ayarlar:getir', async (olay) => (ayarlardan(olay) ? { ok: true, ...(await ayarOzeti()) } : izinYok()));

  // Doğrulama src/lib/ayar-kaydet.js'de. Yalnız ADRES hatası kaydı durdurur; kısayol sorunları uyarıdır ve
  // diğer ayarlar (adresler, otomatik başlatma, pencere davranışı, geri bildirim) yine kaydedilir (hata-12).
  // Gövde ayrı işlevdir: aynı yoldan içe aktarma / yedekten geri dönme de geçer (k-13). `alanlar`: hatalı alanlar (Ayarlar işaretler, h-01).
  async function ayarlariKaydetIsle(girdi) {
    // Bu kayıtla dil de değişiyorsa hata ve uyarı iletileri YENİ dilde yazılır (Ayarlar sayfası kayıttan sonra o dile geçer).
    const hedefDilAyari = DIL_AYARLARI.includes(girdi?.dil) ? girdi.dil : ayarlar.dil;
    const hedefT = cevirmen(dilCoz(hedefDilAyari, sistemDiliAl()), ANA_SOZLUK);
    let dogrulama = ayarGirdisiniDogrula(girdi, ayarlar, { t: hedefT });
    // Kayıt reddedilirse dil değişmez ve sayfa eski dilde kalır: hata iletileri de şimdiki dilde yazılır.
    if (dogrulama.hatalar.length > 0 && hedefT.dil !== etkinDil) dogrulama = ayarGirdisiniDogrula(girdi, ayarlar, { t });
    const { hatalar, yeni } = dogrulama;
    let uyarilar = dogrulama.uyarilar;
    if (hatalar.length > 0) {
      // hatalar[i] ile hataAlanlari[i] eşlidir (ayar-kaydet.js): her alanın ilk iletisi o alanın altında gösterilir.
      const alanMesajlari = {};
      dogrulama.hataAlanlari.forEach((alan, i) => {
        alanMesajlari[alan] ??= hatalar[i];
      });
      return { ok: false, hata: hatalar.join(' '), alanlar: dogrulama.hataAlanlari, alanMesajlari };
    }

    // Arayüz dili hemen uygulanır: sonraki iletiler, pencere başlıkları, tepsi ve açık yerel sayfalar yeni dille (ek kısayol iletileri de yeniden kurulur).
    let ekKisayolDegisti = false;
    if (yeni.dil !== undefined && yeni.dil !== ayarlar.dil) {
      ayarlar.dil = yeni.dil;
      if (dilHesapla()) {
        dilDegistiYay();
        ekKisayolDegisti = true;
      }
    }

    if (yeni.kisayol !== kayitliKisayol) {
      if (kisayoluUygula(yeni.kisayol)) {
        ayarlar.kisayol = yeni.kisayol;
      } else {
        // Uygulanamayan kısayol için AltGr/Win uyarıları yanıltıcıdır: yalnız "kaydedilemedi" gösterilir.
        uyarilar = kisayolKaydiSonrasiUyarilar(uyarilar, false);
        const etkin = kayitliKisayol ? t('ana.etkinKisayol', { kisayol: kisayolGoster(kayitliKisayol) }) : t('ana.etkinKisayolYok');
        uyarilar.push({
          alan: 'kisayol',
          mesaj: `${t('ana.kisayolKaydedilemedi', { kisayol: kisayolGoster(yeni.kisayol) })} ${etkin}`,
        });
      }
    }

    // Dalga 3: palet kısayolu, tepsi sol tık, canlı bağlantı, panolar (ek kısayollar kayıttan sonra uygulanır)
    if (yeni.paletKisayol !== undefined && yeni.paletKisayol !== ayarlar.paletKisayol) {
      ayarlar.paletKisayol = yeni.paletKisayol;
      ekKisayolDegisti = true;
    }
    if (yeni.panolar !== undefined) {
      ayarlar.panolar = yeni.panolar;
      ekKisayolDegisti = true;
    }
    if (yeni.tepsiSolTik !== undefined) ayarlar.tepsiSolTik = yeni.tepsiSolTik;
    let canliDegisti = false;
    if (yeni.canliBaglanti !== undefined && yeni.canliBaglanti !== ayarlar.canliBaglanti) {
      ayarlar.canliBaglanti = yeni.canliBaglanti;
      canliDegisti = true;
    }

    const adresDegisti = yeni.yerelAdres !== ayarlar.yerelAdres || yeni.disAdres !== ayarlar.disAdres;
    ayarlar.yerelAdres = yeni.yerelAdres;
    ayarlar.disAdres = yeni.disAdres;
    // Kutu elle değiştirildiyse Windows'ta kapatılmış olsa bile yeniden yazılır; değişmediyse kullanıcının
    // Görev Yöneticisi kararına dokunulmaz.
    let otomatikZorla = false;
    if (yeni.otomatikBaslat !== undefined && !tasinabilirMi()) { // taşınabilirde ortak ayar değeri değişmez (kurulu sürümün tercihi korunur; o-45)
      otomatikZorla = yeni.otomatikBaslat !== ayarlar.otomatikBaslat;
      ayarlar.otomatikBaslat = yeni.otomatikBaslat;
    }
    if (yeni.odakKaybindaGizle !== undefined) {
      ayarlar.odakKaybindaGizle = yeni.odakKaybindaGizle;
      if (!ayarlar.odakKaybindaGizle) odakKaybiZamanlayicisiniIptalEt();
    }
    if (yeni.koseBildirimi !== undefined) ayarlar.koseBildirimi = yeni.koseBildirimi;
    if (yeni.bipSesi !== undefined) ayarlar.bipSesi = yeni.bipSesi;
    if (yeni.anaPanoyaDonDk !== undefined) ayarlar.anaPanoyaDonDk = yeni.anaPanoyaDonDk;
    if (yeni.pencereBoyutu !== undefined) pencereBoyutuDegistir(yeni.pencereBoyutu); // hemen uygular
    // Görünüm (Dalga 4): tema, vurgu rengi ve yeni pencerelerin malzemesi hemen uygulanır.
    if (yeni.temaZorla !== undefined && yeni.temaZorla !== ayarlar.temaZorla) {
      ayarlar.temaZorla = yeni.temaZorla;
      temayiUygula();
      gorunumuYenile(); // 'acik' tema: pencere arka planı da açık olur (o-29)
    }
    if (yeni.vurguRengi !== undefined && yeni.vurguRengi !== ayarlar.vurguRengi) {
      ayarlar.vurguRengi = yeni.vurguRengi;
      vurguyuUygula(anaPencere);
      vurguyuUygula(ayarlarPenceresi);
    }
    if (yeni.yeniPencereMalzemesi !== undefined && yeni.yeniPencereMalzemesi !== ayarlar.yeniPencereMalzemesi) {
      ayarlar.yeniPencereMalzemesi = yeni.yeniPencereMalzemesi;
      yuzey.malzemeyiUygula();
      kose.malzemeyiUygula();
      itmeKart.malzemeyiUygula();
      masaustuKarolari.malzemeyiUygula();
    }
    const ekDegisenler = ekAyarlariUygula(ayarlar, yeni); // 1.4.0: ayar-alanlari.js tablosundaki alanlar
    if (ekDegisenler.some((d) => d.ad === 'geriAl' || d.ad === 'geriAlKisayolu')) ekKisayolDegisti = true; // geri alma kısayolu (o-12)
    const yazildi = ayarlariYaz();
    ekAyarDegisimleriniYay(ekDegisenler);
    otomatikBaslatUygula({ zorla: otomatikZorla });
    if (adresDegisti) {
      haIstemcisi.secimiSifirla();
      denemeSayaci = 0;
      baglan();
      if (!canliDegisti) ws.yenidenBaglan(); // canlı bağlantı yeni adresle yeniden kurulur
    }
    if (canliDegisti) {
      if (ayarlar.canliBaglanti) ws.yenidenBaglan();
      else ws.durdur();
      durumlariYenile({ zorla: true });
    }
    if (ekKisayolDegisti) {
      for (const k of ekKisayollariUygula().filter((o) => o.tur !== 'ana' && o.durum !== 'etkin')) {
        uyarilar.push({ alan: k.tur === 'palet' ? 'paletKisayol' : k.tur === 'pano' ? 'panolar' : k.tur === 'geri-al' ? 'geriAlKisayolu' : 'favoriler', mesaj: k.mesaj || t('ana.kisayolUygulanamadi', { kisayol: kisayolGoster(k.kisayol) }) });
      }
    }
    if (!yazildi) return { ok: false, hata: t('bildirim.ayarYazilamadi') }; // bellekte uygulandı ama diske yazılamadı
    return { ok: true, uyarilar, ...(await ayarOzeti()) };
  }
  ipcMain.handle('ayarlar:kaydet', async (olay, girdi) => (ayarlardan(olay) ? ayarlariKaydetIsle(girdi) : izinYok()));

  // İçe aktarma / yedekten geri dönme (k-13): doğrulanmış ayarlar "Ayarları Kaydet" ile AYNI yoldan uygulanır (adres ve kısayol
  // doğrulaması dahil; adres reddedilirse hiçbir şey değişmez). Favoriler şema ve kapı süzgecinden geçmiş listedir (ayar-yedegi.js).
  // Erişim anahtarı hiçbir yönde dosyaya girmez ve bu yoldan değişmez.
  async function ayarlariIceAktarUygula(cozum) {
    const a = cozum.ayarlar;
    const duzenOncesi = duzen.anlik();
    if (a.favoriler !== undefined || a.sayfalar !== undefined) duzen.noktaAl('aktar'); // içe aktarma / yedekten dönme düzeni değiştirir: önceki düzen geçmişe
    const girdi = { yerelAdres: a.yerelAdres ?? ayarlar.yerelAdres, disAdres: a.disAdres ?? ayarlar.disAdres, kisayol: a.kisayol ?? ayarlar.kisayol };
    for (const alan of ['paletKisayol', 'tepsiSolTik', 'canliBaglanti', 'otomatikBaslat', 'pencereBoyutu', 'odakKaybindaGizle', 'anaPanoyaDonDk', 'koseBildirimi', 'bipSesi', 'temaZorla', 'vurguRengi', 'yeniPencereMalzemesi', 'panolar', ...aktarilanAlanlar()]) {
      if (a[alan] !== undefined) girdi[alan] = a[alan];
    }
    const sonuc = await ayarlariKaydetIsle(girdi);
    if (!sonuc.ok) return { ok: false, hata: sonuc.hata };
    let yazildi = true;
    if (a.favoriler !== undefined) {
      ayarlar.favoriler = onayiDuzelt(a.favoriler);
      duzen.degisimiIsle(duzenOncesi, 'aktar'); // sayfalar yeni favorilere göre budanır
      yazildi = ayarlariYaz();
      izlenenleriYenile();
    }
    if (!yazildi) return { ok: false, hata: t('bildirim.ayarYazilamadi') };
    return { ok: true, uyarilar: (sonuc.uyarilar ?? []).map((u) => u.mesaj).filter(Boolean), favoriSayisi: ayarlar.favoriler.length };
  }
  const ayarAktarici = ayarAktariciOlustur({
    dialog,
    ayarDizini: path.dirname(ayarDosyasiYolu()),
    varsayilanKlasor: (() => {
      try {
        return app.getPath('documents') || app.getPath('userData');
      } catch {
        return app.getPath('userData');
      }
    })(),
    ayarlarAl: () => ayarlar,
    varsayilanAl: varsayilanlariOku,
    uygula: ayarlariIceAktarUygula,
    t,
    anahtarVarMi: () => anahtarDeposu.varMi(), // kayıtlı anahtar varken ana makine değişikliği onay ister (ayar-aktar.js)
    bilinenKimlikler: () => cihazOnbellegi?.tumKimlikler ?? null, // içe aktarma önizlemesi: HA'da bulunamayan favori sayısı (cihaz listesi hiç alınmadıysa sayı verilmez)
    gunluk,
  });
  ipcMain.handle('ayarlar:disa-aktar', (olay) => (ayarlardan(olay) ? ayarAktarici.disaAktar(ayarlarPenceresi) : izinYok()));
  // İçe aktarma iki adımlıdır (1.4.0): önizleme dosyayı seçtirir ve ne değişeceğini söyler (hiçbir ayar uygulanmaz); uygulama önizlemenin numarasıyla istenir.
  ipcMain.handle('ayarlar:ice-aktar-onizle', (olay) => (ayarlardan(olay) ? ayarAktarici.iceAktarOnizle(ayarlarPenceresi) : izinYok()));
  ipcMain.handle('ayarlar:ice-aktar', (olay, onizlemeNo) => (ayarlardan(olay) ? ayarAktarici.iceAktar(ayarlarPenceresi, onizlemeNo) : izinYok()));
  ipcMain.handle('ayarlar:yedekler', (olay) => (ayarlardan(olay) ? ayarAktarici.yedekler() : izinYok()));
  ipcMain.handle('ayarlar:yedekten-don', (olay, ad) => (ayarlardan(olay) ? ayarAktarici.yedektenDon(ad, ayarlarPenceresi) : izinYok()));

  // Klasör eşitleme (o-58): klasörden gelen bölümler içe aktarma ile AYNI hattan (ayarlariIceAktarUygula) uygulanır. Klasörü yalnız bu diyalog seçer.
  esitlemeYoneticisi = esitlemeYoneticisiOlustur({
    ayarlarAl: () => ayarlar,
    ayarlariYaz: () => ayarlariYaz(),
    iceAktar: ayarlariIceAktarUygula,
    varsayilanAl: varsayilanlariOku,
    parolaDeposu: esitlemeParolaDeposu,
    klasorSecDiyalogu: async () => {
      const secenekler = { title: t('esitleme.klasorSec'), properties: ['openDirectory', 'createDirectory'] };
      const pencere = ayarlarPenceresi && !ayarlarPenceresi.isDestroyed() ? ayarlarPenceresi : null;
      const secim = pencere ? await dialog.showOpenDialog(pencere, secenekler) : await dialog.showOpenDialog(secenekler);
      return secim && !secim.canceled && Array.isArray(secim.filePaths) && typeof secim.filePaths[0] === 'string' ? secim.filePaths[0] : null;
    },
    yasakKlasorler: ciktiYasakKlasorleri, // uygulamanın veri ve kurulum klasörleri eşitleme klasörü olamaz
    yedekAl: async () => {
      // Klasörden ilk kez ayar alınmadan önce ayarlar.json'ın kopyası: uygulamanın kendi zaman damgalı yedek adıyla, Ayarlar > yedekler listesinden geri dönülebilir.
      const kaynak = ayarDosyasiYolu();
      fs.copyFileSync(kaynak, path.join(path.dirname(kaynak), yedekDosyaAdi(SEMA_SURUMU, Date.now())));
    },
    degisti: () => ayarlaraEsitlemeDegistiBildir(),
    gunluk,
    t,
  });

  // Bağlantı katmanı (o-55/o-56): özel üstbilgiler ve sertifika güveni; yalnız Ayarlar penceresi (src/baglanti-yoneticisi.js).
  // + tarayıcıyla giriş (o-57): oturum:durum | giris-baslat | giris-iptal | cikis; + klasör eşitleme (o-58): esitleme:durum | klasor-sec | ayarla | simdi | parola-koy | parola-sil
  baglantiYoneticisi.ipcKaydet({ ipcMain, ayarlardan, izinYok, ek: [...oauthYoneticisi.ipcIsleyicileri(), ...esitlemeYoneticisi.ipcIsleyicileri()] });

  // "Bağlantıyı sına" (k-14): kaydedilmemiş adresin Home Assistant olup olmadığı ANAHTAR GÖNDERMEDEN yoklanır (adres-sina.js).
  const adresSinayici = adresSinayiciOlustur({ fetch: (url, secenekler) => baglantiYoneticisi.fetch(url, secenekler), t, gunluk }); // kayıtlı adrese özel üstbilgiler eklenir (o-55)
  ipcMain.handle('ayarlar:adres-sina', (olay, adres, tur) => (ayarlardan(olay) ? adresSinayici.sina(adres, tur === 'dis' ? 'dis' : 'yerel') : izinYok()));

  // "Açık sayfayı ekle" (k-18): ana pencerede açık HA sayfasının yolu ve adı.
  ipcMain.handle('ayarlar:aciksayfa', (olay) => (ayarlardan(olay) ? ayarlarIcinAcikSayfa() : izinYok()));

  // Sürüm denetimi ve Yenilikler (o-40): yalnız Ayarlar penceresi sorabilir. Seçenek kapalıyken 'surum:denetle' ağa ÇIKMAZ.
  ipcMain.handle('surum:durum', (olay) => (ayarlardan(olay) ? surumBilgisi() : izinYok()));
  ipcMain.handle('surum:denetle', async (olay) => (ayarlardan(olay) ? surumElleDenetle() : izinYok()));
  ipcMain.handle('surum:yenilikler', (olay) => (ayarlardan(olay) ? yenilikleriGetir() : izinYok()));
  // Uygulama içi güncelleme (o-51): yalnız Ayarlar penceresi. Kapalıyken/desteklenmeyen sürümde hiçbiri ağa ya da diske dokunmaz.
  ipcMain.handle('guncelleme:durum', (olay) => (ayarlardan(olay) ? guncellemeDurumu() : izinYok()));
  ipcMain.handle('guncelleme:indir', async (olay) => (ayarlardan(olay) ? guncellemeIndir() : izinYok()));
  ipcMain.handle('guncelleme:kur', async (olay) => (ayarlardan(olay) ? guncellemeKur() : izinYok()));
  // Mobil bildirimler (o-61): yalnız Ayarlar penceresi. Kaydol / Kaydı sil kendi onay pencerelerini açar; kapalıyken ve kayıtsızken hiçbiri ağa çıkmaz.
  ipcMain.handle('mobil:durum', async (olay) => (ayarlardan(olay) ? { ...mobilDurumu(), sifrelemeVar: await mobilDeposu.kullanilabilirMi(), cihazAdi: ayarlar?.mobilCihazAdi ?? '' } : izinYok()));
  ipcMain.handle('mobil:kaydol', async (olay, girdi) => (ayarlardan(olay) ? mobilKaydol(girdi) : izinYok()));
  ipcMain.handle('mobil:kaydi-sil', async (olay) => (ayarlardan(olay) ? mobilKaydiSil() : izinYok()));
  // Düğmeli bildirim kartı (o-61): yalnız o kartın yerel sayfası; sayfa kart numarası ve düğme SIRASI gönderir (eylem kimliği bu süreçte kalır).
  ipcMain.handle('itme:eylem', async (olay, girdi) => (itmeKart.olaydanMi(olay) ? itmeEylemi(girdi) : izinYok()));
  ipcMain.handle('itme:kapat', (olay, girdi) => (itmeKart.olaydanMi(olay) ? { ok: itmeKart.kapatIstegi(girdi?.kartNo) } : izinYok()));
  ipcMain.handle('surum:sayfa-ac', (olay) => {
    if (!ayarlardan(olay)) return izinYok();
    disariAc(SURUM_SAYFASI); // kullanıcı düğmeye bastı: varsayılan tarayıcıda sabit sürüm sayfası
    return { ok: true };
  });

  // Tanılama (o-41): yalnız Ayarlar penceresi sorabilir. Rapor ana süreçte kurulur; kopyalama yalnız o metni panoya yazar.
  ipcMain.handle('tanilama:getir', (olay) => (ayarlardan(olay) ? tanilamaGetir() : izinYok()));
  ipcMain.handle('tanilama:kopyala', (olay) => (ayarlardan(olay) ? tanilamaKopyala() : izinYok()));
  ipcMain.handle('gunluk:klasor-ac', (olay) => (ayarlardan(olay) ? gunlukKlasoruAc() : izinYok()));

  // Odadan ilk kurulum (o-44): yalnız Ayarlar penceresi sorabilir; yalnız okur (öneri listesi döner, hiçbir şey kaydedilmez).
  ipcMain.handle('odalar:getir', async (olay) => (ayarlardan(olay) ? odalariGetir() : izinYok()));

  // 1.4.0 dis grubu: Ayarlar > Dış tetikler. Yalnız Ayarlar penceresi sorabilir; yerel API jetonu hiçbir yanıta girmez (yalnız panoya yazılır).
  ipcMain.handle('dis:durum', async (olay) => (ayarlardan(olay) ? disTetikler.durum() : izinYok()));
  ipcMain.handle('dis:kisayol-olustur', (olay, kimlik) => (ayarlardan(olay) ? disTetikler.kisayolOlustur(kimlik) : izinYok()));
  ipcMain.handle('dis:baglanti-kopyala', (olay, kimlik) => (ayarlardan(olay) ? disTetikler.baglantiKopyala(kimlik) : izinYok()));
  ipcMain.handle('dis:jeton-kopyala', async (olay) => (ayarlardan(olay) ? disTetikler.jetonKopyala() : izinYok()));
  ipcMain.handle('dis:jeton-yenile', async (olay) => (ayarlardan(olay) ? disTetikler.jetonYenile() : izinYok()));
  ipcMain.handle('dis:izin-kaldir', (olay, kimlik) => (ayarlardan(olay) ? disTetikler.izinKaldir(kimlik) : izinYok()));
  // --- Eylem grubu (1.4.0): Ayarlar > Etkinlik geçmişi (o-17) ---
  ipcMain.handle('etkinlik:liste', (olay) => (ayarlardan(olay) ? eylemEk.etkinlikListesi() : izinYok()));
  ipcMain.handle('etkinlik:temizle', (olay) => (ayarlardan(olay) ? eylemEk.etkinlikTemizle() : izinYok()));

  // Windows Başlangıç ayarlarından kapatılmışsa kullanıcı açıkça isterse yeniden etkinleştirilir (pencere-08).
  ipcMain.handle('otomatik-baslat:etkinlestir', async (olay) => {
    if (!ayarlardan(olay)) return izinYok();
    otomatikBaslatAyarla(true);
    return { ok: true, ...(await ayarOzeti()) };
  });

  /** Bilet imzası: aday parmak izi + onaylanan hata sayacı (bütçe nedeni) + kayıt durumu. Anahtarı içermez. */
  function ikinciOnayImzasi(parmakIzi, gerek) {
    const butce = gerek.neden === 'hata-butcesi';
    return { parmakIzi, sayi: butce ? gerek.sayi : 0, kayit: butce ? (gerek.kayit ?? null) : gerek.neden };
  }

  /** İkinci onay gerekli yanıtı: uyarı metni (güncel N) + bu parmak izine ve bu sayaca bağlı YENİ tek kullanımlık bilet. */
  function ikinciOnayYaniti(parmakIzi, gerek) {
    return { ok: false, onayGerekli: true, hata: ikinciOnayMetni(gerek.neden, gerek.sayi, gerek.kayit, t), bilet: onayBiletleri.ver(ikinciOnayImzasi(parmakIzi, gerek)) };
  }

  /**
   * Açık ikinci onay (K4/K5/K7): gerekliyse yalnız bu parmak izi için verilmiş, sayaç değişmemiş ve kullanılmamış bir bilet kabul edilir
   * (bilet her denemede yanar); aksi halde yeni bilet içeren onayGerekli yanıtı döner. `yalnizButce`: kayıt nedeni tek başına bilet
   * istemez (Yeniden Dene o durumda başlı başına onaydır) ama bütçe >= 2 ise kayıt nedeni olsa da bilet ister.
   * @returns {{yanit: object}|{onay: {sayi: number}|null}}
   */
  function ikinciOnayDegerlendir(parmakIzi, bilet, { yalnizButce = false } = {}) {
    const gerek = yetkiKesici.onayGerekliMi(parmakIzi);
    if (!gerek || (yalnizButce && gerek.neden !== 'hata-butcesi')) return { onay: null };
    const imza = ikinciOnayImzasi(parmakIzi, gerek);
    if (onayBiletleri.tuket(bilet, imza)) return { onay: { sayi: imza.sayi } };
    return { yanit: ikinciOnayYaniti(parmakIzi, gerek) };
  }

  ipcMain.handle('anahtar:kaydet', async (olay, girdi, secenek) => {
    if (!ayarlardan(olay)) return izinYok();
    if (typeof girdi !== 'string') return { ok: false, hata: t('ana.gecersizAnahtar') };
    const anahtar = girdi.trim();
    if (anahtar.length < 20 || anahtar.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(anahtar)) {
      return { ok: false, hata: t('ana.anahtarBenzemiyor') };
    }
    if (!(await anahtarDeposu.kullanilabilirMi())) {
      return { ok: false, hata: t('ana.sifrelemeYok') };
    }
    // Daha önce reddedilmiş bir anahtarı yeniden kaydetmek kesiciyi sıfırlamaz: Home Assistant'a hiç istek gitmez.
    const parmakIzi = yetkiKesici.parmakIzi(anahtar);
    if (yetkiKesici.reddedildiMi(parmakIzi)) return { ok: false, hata: t('bildirim.anahtarZatenReddedildi') };
    // Hata bütçesi >= 2 ya da kesici kaydı güvenilmez: açık ikinci onay (bu aday + bu sayaç için, tek kullanımlık bilet) olmadan Home Assistant'a HİÇ istek gitmez.
    const degerlendirme = ikinciOnayDegerlendir(parmakIzi, secenek?.bilet);
    if (degerlendirme.yanit) return degerlendirme.yanit;
    let uyari = '';
    let dogrulandi = false;
    try {
      await haIstemcisi.anahtariDogrula(anahtar, { onay: degerlendirme.onay });
      dogrulandi = true; // TEK istek: GET /api/ (HA: {"message": "API running."}); 401 anahtarı reddedilmiş işaretler
    } catch (hata) {
      // Kapı beklerken sayaç arttıysa (başka bir isteğin 401'i) istemci ağa çıkmadan 'ikinci-onay' verir: güncel sayaçla yeni bilet.
      if (hata.tur === 'ikinci-onay') return ikinciOnayYaniti(parmakIzi, yetkiKesici.onayGerekliMi(parmakIzi) ?? hata.onay ?? { neden: 'hata-butcesi', sayi: yetkiKesici.hataliDenemeSayisi() });
      if (hata.tur === 'yetki') return { ok: false, hata: t('bildirim.anahtarKaydiReddedildi') };
      uyari = t('ana.anahtarDogrulanamadiUyari', { hata: hataMetni(hata, t) });
    }
    try {
      await anahtarDeposu.yaz(anahtar);
    } catch {
      return { ok: false, hata: t('ana.anahtarSifrelenemedi') };
    }
    anahtarYoneticisiniSifirla(); // o-43: yeni anahtar, yeni kullanıcı olabilir
    // Güvenilmez kesici kaydı onayı (tur 4, K5) KÜRESEL olarak YALNIZ aday BAŞARIYLA doğrulanıp saklandığında kalkar: aday 401 aldıysa
    // ya da doğrulanamadıysa saklı (eski) anahtar "Yeniden Dene" olmadan ağa çıkmaz.
    if (dogrulandi) yetkiKesici.onayVer();
    await yetkiDurumunuTazele(); // farklı parmak izli yeni anahtar kesiciyi açar (eski reddedilen kayıt kalır: aynı anahtar yine engelli)
    if (yetkiKesici.karar({ parmakIzi }).izin) {
      ws.yenidenBaglan(); // yeni anahtarla canlı bağlantı
      durumlariYenile({ zorla: true });
      // Anahtar ilk kez eklendiyse hazır liste (sürüm güncelse atlanır). Yanıt liste eklendikten SONRA döner: Ayarlar ekranı
      // favori anlık görüntüsünü hemen alır; bayat görüntüyle "Favorileri Kaydet" hazır karoları sessizce silerdi.
      await hazirListeyiUygula();
    }
    return { ok: true, uyari };
  });

  // Kullanıcı onayı: belirsiz (yanıtsız) deneme sınırı aşıldıysa ya da kesici kaydı güvenilmezse TEK yeni hak; ev içi 403 yüzünden dış
  // adrese gitmeyen (YALNIZ bu saklı anahtara) izin. Hata bütçesi >= 2 iken (doğrulanmamış anahtar; kayıt nedeni olsa da) ayrıca AÇIK
  // ikinci onay gerekir (secenek.bilet: onayGerekli yanıtındaki tek kullanımlık bilet).
  ipcMain.handle('yetki:yeniden-dene', async (olay, secenek) => {
    if (!ayarlardan(olay)) return izinYok();
    let anahtar = null;
    try {
      anahtar = await anahtarDeposu.anahtarAl();
    } catch {
      anahtar = null;
    }
    const parmakIzi = anahtar ? yetkiKesici.parmakIzi(anahtar) : null;
    if (parmakIzi) {
      const degerlendirme = ikinciOnayDegerlendir(parmakIzi, secenek?.bilet, { yalnizButce: true }); // K12a: doğrulanmış saklı anahtar da muaf değil
      if (degerlendirme.yanit) return degerlendirme.yanit;
    }
    yetkiKesici.yenidenDene(); // güvenilmez kayıt kapısı da burada açılır (Yeniden Dene tek başına onaydır); durmuş anahtara TEK deneme hakkı
    haIstemcisi.disIzniVer(parmakIzi); // ev içi 403 iken dış adres izni YALNIZ bu parmak izi için (K9)
    await yetkiDurumunuTazele();
    ws.yenidenBaglan();
    durumlariYenile({ zorla: true });
    return { ok: true, ...(await ayarOzeti()) };
  });

  // Yalnız YEREL dosya silinir; Home Assistant'taki anahtar iptal edilmez ve ileti bunu açıkça söyler (hata-07).
  ipcMain.handle('anahtar:sil', async (olay) => {
    if (!ayarlardan(olay)) return izinYok();
    let silinenParmakIzi = null; // YALNIZ saklı anahtarın kaydı temizlenir (diğer kayıtlar ve hata bütçesi korunur)
    try {
      // Tarayıcı oturumunda erişim anahtarı yenilenmesin diye (ağ) bellekteki anahtarın parmak izi sorulur
      const silinen = oauthYoneticisi.oturumVarMi() ? null : await anahtarDeposu.anahtarAl();
      if (silinen) silinenParmakIzi = yetkiKesici.parmakIzi(silinen);
      else if (oauthYoneticisi.oturumVarMi()) silinenParmakIzi = oauthYoneticisi.gecerliParmak();
    } catch {
      silinenParmakIzi = null;
    }
    try {
      await anahtarDeposu.sil();
    } catch {
      return { ok: false, hata: t('ana.anahtarDosyasiSilinemedi') };
    }
    ws.durdur();
    anahtarYoneticisiniSifirla(); // o-43
    yetkiKesici.temizle(silinenParmakIzi); // "Anahtarı sil" saklı anahtarın kaydını temizler; yeniden eklenen anahtar tek doğrulamayla başlar
    haIstemcisi.dogrulamayiSifirla();
    await yetkiDurumunuTazele();
    depo.sifirla();
    kamera.temizle(); // 1.4.0: anahtar silindi, bellekteki kamera kareleri de gider
    cihazOnbellegi = null;
    yuzey.modelDegisti();
    return { ok: true, mesaj: t('bildirim.anahtarSilindi') };
  });

  ipcMain.handle('cihazlar:getir', async (olay) => {
    if (!ayarlardan(olay)) return izinYok();
    try {
      const durumlar = await haIstek('/api/states');
      if (!Array.isArray(durumlar)) throw new HaHatasi('sunucu');
      // hata-14: süzgeçten ÖNCE HA'daki tüm kimlikler alınır; kayıt "HA'da şu an yok" ile "güvenlik engelli"yi ayırt eder.
      const tumKimlikler = new Set(durumlar.map((v) => v?.entity_id).filter((k) => typeof k === 'string'));
      const cihazlar = durumlar
        // GÜVENLİK KURALI: kilit/alarm/kapı burada elenir, renderer'a hiç gitmez. 1.4.0: yalnız karo olabilen alanlar
        // (src/lib/alan-kaydi.js karoAlaniMi; iklim, medya, sensör... dahil; yapılacaklar/takvim kendi ayarlarıyla seçilir).
        .filter((v) => guvenliVarlikMi(v) && karoAlaniMi(alanAl(v.entity_id)))
        .map((v) => {
          const alan = alanAl(v.entity_id);
          const siniflama = eylemSinifi(v, {}); // favori ayarından bağımsız varsayılan sınıf (hata-04)
          return {
            entity_id: v.entity_id,
            ad: varlikAdi(v),
            alan,
            alanEtiketi: t(`alan.${alan}`),
            durum: durumMetni(v.state),
            onayZorunlu: siniflama.sinif === SINIF.YIKICI && siniflama.zorunlu,
            varsayilanOnay: siniflama.sinif === SINIF.YIKICI,
            // yıkıcı eylem ve tek tıklama eylemi olmayan karo (1.4.0: iklim, sensör...) kısayola atanamaz
            kisayolUygun: siniflama.sinif === SINIF.ZARARSIZ && varsayilanServis(alan) !== null,
            tekTiklama: varsayilanServis(alan) !== null, // false: karo yalnız panelde ve palette görünür (tepsi menüsü ve kısayol atlar)
            kisayolEylemleri: kisayolEylemSecenekleri(alan), // o-13: kısayola atanabilen kesin yönler (kapalı liste; boş = yalnız aç-kapa)
            gizli: adayGizliMi(v), // detay-20: panele/favorilere önerilmez; listede varsayılan gizli (güvenlik kuralı DEĞİLDİR)
            // 1.4.0 uyarı kuralı seçici (Ayarlar): kural kurulabilen alanlar ve o varlık için önerilen durum değerleri (HA'nın yazdığı adlar)
            ...(UYARI_ALANLARI.includes(alan) ? { uyariUygun: true, durumOnerileri: durumOnerileri(v), uyariSimgesi: alanSimgesi(alan) } : {}),
          };
        })
        .sort((a, b) => alanSirasi(a.alan) - alanSirasi(b.alan) || a.ad.localeCompare(b.ad, etkinDil));
      const guvenli = new Map(cihazlar.map((c) => [c.entity_id, c.ad]));
      // o-07 / o-10: yapılacaklar listesi ve takvim favori (karo) olamaz; Ayarlar'daki bilgi seçimleri için ayrı, Kapı Kuralı'ndan geçmiş liste.
      const bilgiVarliklari = durumlar
        .filter((v) => guvenliVarlikMi(v) && ['calendar', 'todo'].includes(alanAl(v.entity_id)))
        .map((v) => ({ entity_id: v.entity_id, ad: varlikAdi(v), alan: alanAl(v.entity_id), alanEtiketi: t(`alan.${alanAl(v.entity_id)}`) }))
        .sort((a, b) => alanSirasi(a.alan) - alanSirasi(b.alan) || a.ad.localeCompare(b.ad, etkinDil));
      cihazOnbellegi = { guvenli, tumKimlikler };
      // Kayıtlı favorilerden listede görünmeyenler: HA'da şu an yok (korunur) ya da güvenlik kuralına takılıyor.
      const eksik = [];
      const engelli = [];
      for (const { entity_id: kimlik, ad } of ayarlar.favoriler) {
        if (guvenli.has(kimlik)) continue;
        if (!tumKimlikler.has(kimlik) && adGuvenliMi(kimlik, ad)) eksik.push({ entity_id: kimlik, ad });
        else engelli.push({ entity_id: kimlik, ad });
      }
      // o-48: kamera onay listesi için ayrı aday listesi (kamera karo/favori olamaz). Kapı/zil/diafon/giriş adlı kameralar buraya hiç gelmez.
      // Zaten onaylı olup şu an HA'da bulunamayan ya da süzgece takılan kimlikler `kameraIzinleri` ayarında kalır ama listede görünmez; kaydedince düşer.
      return { ok: true, cihazlar, eksik, engelli, bilgiVarliklari, kameraAdaylari: kameraAdaylari(durumlar) };
    } catch (hata) {
      return { ok: false, hata: t('ana.cihazListesiAlinamadi', { hata: hataMetni(hata, t) }) };
    }
  });

  // Yük: [{ entity_id, onay? }] (düz kimlik listesi de kabul edilir). Seçilmemiş favoriler kullanıcının kararıyla çıkar;
  // HA'da o an görünmeyen favoriler olduğu gibi KORUNUR (hata-14); güvenlik kuralına takılanlar çıkarılır ve bildirilir.
  ipcMain.handle('favoriler:kaydet', (olay, girdi) => {
    if (!ayarlardan(olay)) return izinYok();
    if (!Array.isArray(girdi) || girdi.length > 200) return { ok: false, hata: t('ana.gecersizListe') };
    if (!cihazOnbellegi) return { ok: false, hata: t('ana.onceCihazlar') };
    const duzenOncesi = duzen.anlik(); // 1.4.0 düzen (o-30): değişiklikten önceki favori + sayfa düzeni
    const { yeni, eksik, engelli, kisayolHatalari, etiketHatalari, gorunumHatalari, eylemHatalari = [] } = favorileriBirlestir({
      mevcut: ayarlar.favoriler,
      secilen: girdi,
      guvenliListe: cihazOnbellegi.guvenli,
      tumKimlikler: cihazOnbellegi.tumKimlikler,
    });
    ayarlar.favoriler = onayiDuzelt(yeni);
    if (engelli.length > 0) {
      const dusenler = new Set(engelli.map((e) => e.entity_id));
      const onceki = (ayarlar.engellenenFavoriler ?? []).filter((e) => !dusenler.has(e.entity_id));
      ayarlar.engellenenFavoriler = [...onceki, ...engelli.map((e) => ({ entity_id: e.entity_id, neden: 'guvenlik' }))].slice(-EN_COK_ENGELLENEN);
      gunluk(`${engelli.length} favori güvenlik kuralı nedeniyle çıkarıldı.`);
    }
    duzen.degisimiIsle(duzenOncesi, 'kaydet', { birlestir: true }); // sayfalar favorilere göre budanır; önceki düzen geçmişe yazılır
    const yazildi = ayarlariYaz();
    izlenenleriYenile();
    if (!yazildi) return { ok: false, hata: t('bildirim.ayarYazilamadi') };
    return {
      ok: true,
      sayi: yeni.length,
      eksik: eksik.length,
      engelli: engelli.length,
      kisayolHatalari,
      etiketHatalari, // karo adı kapı süzgecinden geçmedi (k-06): Ayarlar söyler, önceki ad korunur
      gorunumHatalari, // simge / renk / boyut geçersizdi (o-31): [{ entity_id, alan }]; önceki değer korunur
      // kısayol eylemi bu favori için geçerli değil (o-13): favori ve kısayol kaydedilir, eylem aç-kapa kalır; yalnız doluysa eklenir
      ...(eylemHatalari.length > 0 ? { eylemHatalari } : {}),
      kisayolSorunlari: kisayolSorunlari().map(({ id, tur, kisayol, kimlik, neden, mesaj }) => ({ id, tur, kisayol, kimlik, neden, mesaj })),
    };
  });

  // 1.4.0 düzen (o-28, o-30): düzen geçmişi, geçmiş noktasına dönüş ve HA'da bulunamayan favoriyi onarma. Yalnız Ayarlar'dan.
  ipcMain.handle('duzen:gecmis', (olay) => (ayarlardan(olay) ? duzen.gecmisListesi() : izinYok()));
  ipcMain.handle('duzen:don', (olay, id) => (ayarlardan(olay) ? duzen.geriDon(id) : izinYok()));
  ipcMain.handle('favoriler:onar', (olay, eski, yeni) => (ayarlardan(olay) ? duzen.onar(eski, yeni) : izinYok()));

  // Hazır ilk karoları (hiz-07) elle yeniden uygular; eksik olanlar eklenir, mevcutlara dokunulmaz.
  ipcMain.handle('favoriler:hazir-liste', async (olay) => {
    if (!ayarlardan(olay)) return izinYok();
    const sonuc = await hazirListeyiUygula({ zorla: true });
    if (!sonuc.ok) return { ok: false, hata: sonuc.hata || t('bildirim.ayarYazilamadi') };
    cihazOnbellegi = null; // favori listesi değişti: sonraki cihaz listesi yeniden alınır
    return { ok: true, eklenen: sonuc.eklenenler.length, atlanan: sonuc.atlananlar.length };
  });

  yuzey.ipcKaydet(); // panel/palet kanalları (her biri gönderen denetimli)
  masaustuKarolari.ipcKaydet(); // masaüstü karosu kanalları (karo:*; her biri o karonun penceresinden gelmeli)
}

// ---------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------

/**
 * Uyanışta ve ekran kilidi açılışında hemen yeniden dene (hata-05): ağ değişmiş ya da henüz hazır olmayabilir.
 * `resume` ile `unlock-screen` birlikte gelebilir; 500 ms içinde tek işe indirilir.
 */
function agDegisti(neden) {
  // Seçim önbelleği 500 ms'lik birleştirmeyi beklemeden unutulur: ana pencerenin eski adresi doğrulanana kadar anahtarlı
  // hiçbir istek (REST yedeği, canlı bağlantı) o adrese gitmez (ha-istemcisi.js, dogrulamaBekliyor).
  haIstemcisi.secimiSifirla();
  sonAgDenetimi = Date.now();
  bildirimAkisi.baglantiDegisti(); // uyanış/ağ değişimi: sonraki toplu durum yüklemesi uyarı üretmez (1.4.0)
  clearTimeout(agDegistiZamanlayicisi);
  clearTimeout(agYenidenDenemeZamanlayicisi); // önceki uyanışın yeniden deneme zinciri bırakılır; yenisi başlıyor
  agYenidenDenemeZamanlayicisi = null;
  agDegistiZamanlayicisi = setTimeout(() => agiDenetle(neden, 0), 500);
}

/**
 * Ağ denetimi turu. Yoklama başarısızsa ve sayfa HA'daysa (çevrimdışı sayfasının kendi geri çekilmesi yoktur) 5, 15 ve 30 sn
 * sonra yeniden denenir (h-16): uyanışta ağ geç gelirse sayfa ölü adreste "bağlantı kesildi" ekranında kalmasın. Bir deneme
 * başarılı olursa sayfa yeniden yüklenir (yoklama sonucu ilk turda başarısızdı, sayfa o ağ kesintisinden bayattır).
 * @param {number} deneme 0 = ilk tur; 1.. = yeniden denemeler
 */
async function agiDenetle(neden, deneme) {
  const surum = ++agDenetimSurumu;
  gunluk(deneme === 0 ? `Ağ yeniden denetleniyor (${neden}).` : `Ağ yeniden denetleniyor (${neden}, ${deneme}. yeniden deneme).`);
  denemeSayaci = 0;
  haIstemcisi.secimiSifirla();
  // Önce adres DOĞRULANIR, canlı bağlantı sonra kurulur: aksi halde ağ değişmişse erişim anahtarı eski adresteki yabancı
  // bir cihaza gidebilirdi (ev içi adres http ise düz ws://).
  const secim = await adresSec();
  if (surum !== agDenetimSurumu) return; // daha yeni bir ağ denetimi başladı
  haIstemcisi.secimiAyarla(secim?.adres ?? null);
  if (deneme === 0 || secim) ws.yenidenBaglan(); // uyanış/kilit açılışı: canlı bağlantı doğrulanmış adresle yeniden kurulur
  if (!anaPencere || anaPencere.isDestroyed()) return;
  if (secim) {
    if (gosterilenSayfa !== 'ha' || secim.adres !== aktifAdres) baglan(secim);
    else if (deneme > 0) anaPencere.webContents.reload(); // ağ geç geldi: ölü bağlantıda kalmış HA sayfası yenilenir
  } else if (gosterilenSayfa === 'cevrimdisi') {
    cevrimdisiGoster(); // geri çekilme zinciri 2 sn'den yeniden başlar
  } else if (gosterilenSayfa === 'ha' && deneme < UYANIS_YENIDEN_DENEME_SN.length && !cikiliyor) {
    agYenidenDenemeZamanlayicisi = setTimeout(() => {
      agYenidenDenemeZamanlayicisi = null;
      agiDenetle(neden, deneme + 1);
    }, UYANIS_YENIDEN_DENEME_SN[deneme] * 1000);
  }
}

/**
 * k-15 (1.2.0): ana pencere dış adresteyken ev içi adres yeniden ulaşılabilir olduysa ev içi adrese dönülür. Yoklama YALNIZ ev içi
 * adrese ve anahtarsızdır (ha-istemcisi.js yereleDonusYokla). Pencere o an odaktaysa sayfa kullanıcının altından yenilenmez.
 */
async function yereleDonusuDene() {
  const uygun = () => gosterilenSayfa === 'ha' && baglantiTuru === 'dis' && anaPencere && !anaPencere.isDestroyed() && !anaPencere.isFocused();
  if (!uygun()) return;
  const secim = await haIstemcisi.yereleDonusYokla();
  if (!secim || !uygun()) return;
  gunluk('Ev içi adres yeniden ulaşılabilir; ev ağı adresine dönülüyor.');
  denemeSayaci = 0;
  ws.yenidenBaglan(); // canlı bağlantı da az önce (anahtarsız) yoklanan ev içi adrese taşınır
  baglan(secim);
}

function baslat() {
  // --eylem ile açılış (anlaşılmasa bile) ve pencere/durum komutuyla açılış (o-19) pencere göstermez; komut kendi işini yapar
  const gizliBasla = process.argv.includes(GIZLI_BASLAT_ARG) || baslangicEylemIstendi || baslangicPencereKomutu !== null || baslangicDisIstegi !== null;

  app.on('second-instance', (_olay, argv, dizin, ek) => {
    // 1.4.0 dis grubu: evpaneli:// bağlantısı (o-54) ve Jump List / masaüstü kısayolu (o-21) pencere ve durum komutlarından ÖNCE
    // ayrılır: bağlantının yanına eklenmiş bir komut (çakışma) hiçbir şey çalıştırmaz.
    const disIstek = disIstegi(argv, ek);
    if (disIstek) {
      if (!ayarlar) bekleyenDisIstegi = { istek: disIstek, argv, ek };
      else disIstegiIsle(disIstek, argv, ek);
      return;
    }
    // `--goster` / `--gizle` / `--degistir` / `--durum` / `--liste` (o-19): ikinci kopya komutu bu kopyaya iletir; servis çağrısı yapılmaz.
    // `--eylem` ile birlikte verilen pencere komutu 'cakisma' sayılır ve HİÇBİRİ çalışmaz.
    const pencereKomutu = pencereDurumKomutu(argv, dizin);
    if (pencereKomutu) {
      if (!ayarlar) bekleyenPencereKomutu = pencereKomutu; // henüz hazır değil: hazır olunca çalışır
      else pencereDurumKomutuIsle(pencereKomutu);
      return;
    }
    // `--eylem=<ad>` (hiz-05): ikinci kopya eylemi bu kopyaya iletir (additionalData; yoksa argv) ve pencere AÇILMAZ.
    if (eylemIstendiMi(argv) || typeof ek?.eylem === 'string') {
      const istek = komutSatiriEylemi(typeof ek?.eylem === 'string' ? [`--eylem=${ek.eylem}`] : argv);
      if (!ayarlar) {
        // Uygulama henüz hazır değil (ayarlar yüklenmedi): eylem kaybolmasın, hazır olunca çalışır.
        bekleyenKomutEylemi = { ad: istek ? istek.ad : null };
        return;
      }
      komutEylemiIsle(istek);
      return;
    }
    if (!ayarlar) return; // hazır değilken açılış sırasındaki ikinci kopya: pencere zaten ilk gösterimde açılır
    // İkinci kopya açılmak istendi: mevcut pencereyi öne getir (oturum açılışındaki gizli başlatma hariç).
    if (!argv.includes(GIZLI_BASLAT_ARG)) pencereyiGoster();
  });

  app.on('web-contents-created', (_olay, wc) => {
    wc.on('will-attach-webview', (o) => o.preventDefault());
    // Varsayılan: hiçbir pencere yeni pencere açamaz. HA pencereleri (haGezinmeKorumalari) bunu kendi işleyicisiyle geçersiz kılar.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  // Pencereler gizlense de uygulama tepside çalışmaya devam eder.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    cikiliyor = true;
    pencereDurumunuKaydet({ zorla: true });
    oauthYoneticisi.kapat(); // açık giriş dinleyicisi kalmaz (o-57)
    if (esitlemeYoneticisi) esitlemeYoneticisi.kapat(); // klasör izleyicisi ve zamanlayıcılar bırakılır (o-58)
    ws.durdur();
    bildirimAkisi.durdur();
    son.bosalt();
    disTetikler.durdur(); // yerel API ve toplantı yoklaması durur; bekleyen bağlantı izni reddedilir
    eylemEk.kapat(); // etkinlik geçmişi yazılır
    yuzey.kapat();
    kose.kapat();
    mobilKayit.durdur();
    itmeKart.kapat();
    masaustuKarolari.kapat(); // bekleyen karo konumları yazılır, karo pencereleri yok edilir
    try {
      session.fromPartition(HA_BOLUMU).flushStorageData(); // HA giriş bilgisi (localStorage) diske yazılsın
    } catch {
      /* yok say */
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(app.isPackaged ? UYGULAMA_KIMLIGI : process.execPath);
    Menu.setApplicationMenu(null);

    ayarlar = ayarlariYukle();
    dilHesapla(); // ayar yüklendi: etkin dil (ayar ya da sistem dili); bundan sonraki her metin bu dille
    // Yetki kesici kaydı HER kimlikli istekten önce yüklenir: reddedilmiş anahtarla uygulama yeniden açılsa da 0 istek gider.
    const reddedilmisKayit = yetkiKesici.yukle();
    if (reddedilmisKayit > 0) gunluk(`Yetki kesici: ${reddedilmisKayit} reddedilmiş anahtar kaydı yüklendi.`);
    baglantiYoneticisi.yukle(); // özel üstbilgiler (o-55): ağ yolları yükleme bitmeden üstbilgisiz istek atmaz (yönetici bekler)
    temayiUygula(); // pencereler oluşmadan önce: koyu tema (gorunum-13)
    // Windows teması değişince ("sistem" teması) opak pencere arka planı da açık/koyu olur (o-29).
    if (typeof nativeTheme.on === 'function') nativeTheme.on('updated', () => gorunumuYenile());
    son.yukle();
    duzenGecmisi.yukle();
    eylemEk.yukle(); // 1.4.0 eylem grubu: etkinlik geçmişi
    ekAyarDinle('sayfalar', (yeni, eski) => duzen.sayfalarDegisti(yeni, eski)); // 1.4.0 düzen (o-24, o-30)
    // Yazım denetimi ve sözlük indirmesi kapalı (o-42): oturumlar ilk kullanılmadan önce; Windows'ta Electron sözlüğü Google CDN'den indirirdi.
    yazimDenetiminiKapat(session.fromPartition(HA_BOLUMU), gunluk);
    yazimDenetiminiKapat(session.defaultSession, gunluk);
    izinleriAyarla(session.fromPartition(HA_BOLUMU));
    izinleriAyarla(session.defaultSession);
    baglantiYoneticisi.oturumaBagla(session.fromPartition(HA_BOLUMU), { ustbilgi: true }); // HA penceresi: özel üstbilgiler yalnız HA kökenlerine (o-55)
    baglantiYoneticisi.oturumaBagla(session.defaultSession);
    ipcKaydet();
    esitlemeYoneticisi.baslat(); // klasör eşitleme (o-58): ayarda açıksa izleme kurulur ve açılıştan biraz sonra eşitlenir; kapalıysa hiçbir şey yapmaz

    tepsiOlustur();
    yetkiDurumunuTazele(); // tepsi ipucu/menü ve panel, reddedilmiş kayıtlı anahtarı ilk andan gösterir
    anaPencereOlustur();
    // Köşe bildirimi penceresi (ayarda açıksa) açılıştan biraz sonra arka planda yüklenir; kapalıysa hiç oluşturulmaz.
    if (ayarlar.koseBildirimi) kose.hazirla();
    if (gizliBasla) gizlenmeZamani = Date.now(); // gizli başlayan pencere "gizli kalma" süresini baştan sayar
    else pencereyiGoster();

    if (!kisayoluUygula(ayarlar.kisayol)) {
      bildir(anaKisayolAlinamadiMetni(kisayolGoster(ayarlar.kisayol), t), uygulamaAdi(), AYARLARI_AC);
    }
    acilisBildirimleriniGoster();
    httpAnahtarUyarisiniGoster();
    otomatikBaslatUygula();
    baglan();

    // Palet, eylem ve pano kısayolları (hiz-05, pencere-02); sorunlar açılışta bir kez bildirilir (sessiz kalmaz).
    ekKisayollariUygula();
    const sorunlar = kisayolSorunlari();
    if (sorunlar.length > 0) {
      gunluk(`${sorunlar.length} ek kısayol uygulanamadı.`);
      bildir(ekKisayollarUygulanamadiMetni(sorunlar.length, t), uygulamaAdi(), AYARLARI_AC);
    }

    // Canlı durum (hiz-03): tek WebSocket; kurulamazsa REST yedeği 60 sn'de bir yeniler. Hızlı panel arka planda yüklenir.
    ws.baslat();
    durumlariYenile();
    bildirimAkisiniBaslat();
    // Mobil bildirimler (o-61): yalnız kayıtlıysa ve ayar açıksa itme kanalı açılır; aksi halde hiçbir şey olmaz. Ayar değişince kanal açılır/kapanır.
    ekAyarDinle('mobilBildirimler', (yeni) => {
      if (yeni === true) mobilKayit.baslat().catch(() => {});
      else {
        mobilKayit.durdur();
        itmeKart.hepsiniKapat();
      }
      mobilDurumunuYay();
    });
    mobilKayit.baslat().catch(() => {});
    yuzey.hazirla();
    masaustuKarolari.hazirla(); // sabitlenmiş karolar açılıştan biraz sonra arka planda açılır (ana pencere ve tepsi önce gelsin)
    // Ekran bağlandı/söküldü ya da çözünürlük değişti: görünmez kalan karolar yerine alınır (kayıtlı konum silinmez, ekran dönünce geçerli olur).
    for (const olay of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(olay, () => masaustuKarolari.ekranDegisti());
    // Yeni sürüm denetimi (o-40): seçenek açılırsa ilk bakış 3 sn sonra, kapanırsa zamanlayıcı kalkar; açılışta yalnız seçenek açıksa planlanır.
    ekAyarDinle('surumDenetimi', () => surumDenetimiPlanla(surumDenetimiAcikMi() ? 3000 : 0));
    // Uygulama içi güncelleme (o-51): kapanınca bellekteki sürüm bilgisi atılır (kapalıyken inmiş dosya kurulmaz); "ön sürümler" değişince de
    // eski öneri atılıp bir sonraki denetimde yeniden bakılır.
    ekAyarDinle('uygulamaGuncelleme', (yeni) => {
      if (yeni !== true) guncellemeYoneticisiNesnesi?.kapandi();
      surumDenetimiPlanla(surumDenetimiAcikMi() ? 3000 : 0);
      if (guncellemeYoneticisiNesnesi) guncellemeDurumunuYay(guncellemeYoneticisiNesnesi.durum());
    });
    ekAyarDinle('onSurumler', () => {
      guncellemeYoneticisiNesnesi?.kapandi();
      surumDenetimiPlanla(surumDenetimiAcikMi() ? 3000 : 0);
    });
    // Dış tetikler (1.4.0 dis grubu): seçenek değişince ilgili tetik hemen uygulanır (Jump List, protokol kaydı, API, toplantı yoklaması).
    for (const ad of DIS_AYAR_ALANLARI) ekAyarDinle(ad, () => disTetikler.ayarDegisti(ad));
    disTetikler.baslat();
    surumDenetimiPlanla(SURUM_ILK_DENETIM_MS);
    hazirListeyiUygula().finally(() => {
      if (baslangicDisIstegi) disIstegiIsle(baslangicDisIstegi, baslangicArgv, null); // evpaneli:// ya da Jump List / kısayol ile açılış
      else if (baslangicPencereKomutu) {
        // uygulama `--goster` / `--durum`... ile başlatıldı; durum belgesi için favori durumları önce okunur
        const komut = baslangicPencereKomutu;
        Promise.resolve(komut.tur === 'durum' ? durumlariYenile({ zorla: true }) : undefined)
          .catch(() => {})
          .finally(() => pencereDurumKomutuIsle(komut));
      } else if (baslangicEylemi) komutSatiriEylemiCalistir(baslangicEylemi.ad); // uygulama `--eylem=<ad>` ile başlatıldı
      else if (baslangicEylemIstendi) komutEylemiIsle(null); // `--eylem` var ama anlaşılamadı: sessiz kalmaz, hata bildirilir (h-22)
      if (bekleyenPencereKomutu) {
        const bekleyen = bekleyenPencereKomutu;
        bekleyenPencereKomutu = null;
        pencereDurumKomutuIsle(bekleyen); // hazır olmadan gelen ikinci kopya komutu
      }
      if (bekleyenKomutEylemi) {
        const bekleyen = bekleyenKomutEylemi;
        bekleyenKomutEylemi = null;
        komutEylemiIsle(bekleyen.ad === null ? null : bekleyen); // hazır olmadan gelen ikinci kopya eylemi
      }
      if (bekleyenDisIstegi) {
        const bekleyen = bekleyenDisIstegi;
        bekleyenDisIstegi = null;
        disIstegiIsle(bekleyen.istek, bekleyen.argv, bekleyen.ek); // hazır olmadan gelen ikinci kopya bağlantısı / görevi
      }
    });

    sonDakikaTiki = Date.now();
    setInterval(() => {
      // Windows'un "Modern Standby" kipinde uyku/uyanış olayı gelmeyebilir (doğrulanmadı): iki tur arasında >3 dk saat atlaması
      // uyanış sayılır. Gerçek uyanış olayı zaten ağ denetimi başlattıysa (son 2 dk) ikinci kez denetlenmez (h-37).
      const simdi = Date.now();
      const sicrama = simdi - sonDakikaTiki > UYKU_SICRAMA_ESIGI_MS;
      sonDakikaTiki = simdi;
      if (sicrama && simdi - sonAgDenetimi > 2 * 60_000) {
        gunluk('Saat sıçraması algılandı; uyanış sayılıyor.');
        agDegisti('saat-sicramasi');
      }
      if (!ws.canliMi() && Date.now() - favoriSonYenileme >= FAVORI_YENILEME_MS - 5000) durumlariYenile();
    }, FAVORI_YENILEME_MS);
    setInterval(() => yereleDonusuDene().catch(() => {}), YERELE_DONUS_YOKLAMA_MS); // k-15: dış adresten ev içine dönüş

    // Uykudan uyanınca ve ekran kilidi açılınca ağ değişmiş ya da henüz hazır olmayabilir: hemen yeniden dene.
    // Uykuya dalarken canlı bağlantı kapatılır (uyanana kadar yeniden denenmez).
    // 1.4.0 dis grubu (o-47): PC olayları yalnız seçenek açıkken kuralları çalıştırır; uykuya geçerken istek bağlantı kapanmadan gider
    // (bu dinleyiciler aşağıdakilerden önce kaydedilir).
    for (const [olayAdi, pcOlayi] of Object.entries(GUC_OLAYLARI)) powerMonitor.on(olayAdi, () => disTetikler.guc(pcOlayi));
    powerMonitor.on('suspend', () => ws.askiyaAl());
    powerMonitor.on('resume', () => agDegisti('uyanis'));
    powerMonitor.on('unlock-screen', () => agDegisti('kilit-acildi'));
  }).catch((hata) => {
    // Açılış zincirinde beklenmeyen hata (h-37): yalnız günlüğe değil kullanıcıya da söylenir; hata adı/kodu dışında bilgi yazılmaz.
    gunluk(`Açılış sırasında hata: ${hataKimligi(hata)}`);
    dilHesapla(); // hata ayar yüklenmeden de olabilir: dil henüz çözülmediyse bildirim sistem dilinde yazılsın
    bildir(t('bildirim.acilisHatasi'));
  });
}

// `--eylem=<ad>` ile başlatıldıysa ad, çalışan ilk kopyaya 'second-instance' additionalData ile iletilir.
const baslangicEylemi = komutSatiriEylemi(process.argv);
const baslangicEylemIstendi = eylemIstendiMi(process.argv); // anlaşılmayan `--eylem` de pencere açmaz ve hata bildirir
const baslangicPencereKomutu = pencereDurumKomutu(process.argv, process.cwd()); // `--goster` / `--gizle` / `--degistir` / `--durum` / `--liste` (o-19)
const baslangicArgv = process.argv.slice(); // açılış argümanları (dış istek hazır olunca bunlarla işlenir)
const baslangicDisIstegi = disIstegi(baslangicArgv); // 1.4.0 dis grubu: evpaneli:// bağlantısı ya da Jump List / kısayol görevi

/** İlk kopyaya 'second-instance' ile giden ek veri: eylem adı, kaynak (jumplist | kisayol) ve evpaneli:// bağlantısı (varsa). */
function ikinciKopyaEki() {
  const ek = {};
  if (baslangicEylemi) ek.eylem = baslangicEylemi.ad;
  const kaynak = eylemKaynagi(process.argv);
  if (kaynak !== null) ek.kaynak = kaynak;
  const protokol = protokolArgumani(process.argv);
  if (protokol !== null) ek.protokol = protokol;
  return Object.keys(ek).length > 0 ? ek : undefined;
}

if (app.requestSingleInstanceLock(ikinciKopyaEki())) {
  baslat();
} else {
  app.quit();
}

// Ayarlar penceresi köprüsü (k-18) ve testler için. Electron dışında yüklenmez; dışa yalnız salt-okunur durum sorgusu açılır.
module.exports = { acikHaSayfasiYolu };
