'use strict';

/**
 * Hızlı panel ve komut paleti penceresi (hiz-01, hiz-02): tek, çerçevesiz, odak alan yerel pencere; iki kipte çalışır
 * ('panel': tepsi simgesinin yanında; 'palet': ekranın üst-ortasında). İkisi aynı sayfayı (yuzey.html) ve aynı güvenli
 * eylem hattını (src/eylem.js) kullanır; tek renderer süreci bellekte tutulur.
 *
 * Güvenlik
 *  - Renderer'a yalnız src/lib/yuzey-modeli.js'in karo modeli gider (rendererModeli ile alan beyaz listesinden geçmiş):
 *    anahtar, adres, HA'daki ham durum ve HA'daki ad gitmez; kapı/kilit karoları modele hiç girmez.
 *  - Her IPC kanalı gönderenin bu pencerenin yerel sayfası (yuzey.html, ana çerçeve) olduğunu denetler.
 *  - Eylem kaynağı ('panel' | 'palet') yükten değil, ana sürecin bildiği açık kipten belirlenir; onay renderer'ın beyanı
 *    DEĞİL, ana sürecin kendi saatiyle doğruladığı "basılı tutma"dır.
 *  - Sayfa süreci ölürse ya da yüklenemezse pencere yok edilir, sonraki açılışta yeniden oluşturulur (kose-bildirim.js ile aynı ilke).
 *
 * focusable pencerenin tam ekran uygulamaların üstünde nasıl davrandığı ve karma DPI'da setBounds DENENMEDİ (soru-4: oyun/tam
 * ekrana özel iş yok; README elle deneme listesi).
 */

const path = require('node:path');
const { ipcMain, screen } = require('electron');
const { yerelPencereOlustur, yerelOlaydanMi, malzemeUygula } = require('./yerel-pencere');
const { PANEL_BOYUTU, PALET_BOYUTU, YAKINLASTIRMA_ADIMLARI, panelKonumu, paletKonumu, yuzeyYuksekligiKirp, yuzeyBoyutu, yakinlastirmaTusu, yakinlastirmaDegeri, opaklikOrani } = require('./lib/pencere-yerlesim');
const { rendererModeli } = require('./lib/yuzey-modeli');
const { tiklamaKarari } = require('./lib/pencere-davranisi');
const { cokmeSayilirMi, cokmeNedeniMetni } = require('./lib/cokme-siniri');
const { TR } = require('./lib/ceviri-varsayilan');
const { yuzeyOkumasi } = require('./lib/ha-okuma');

const YUZEY_HTML = path.join(__dirname, 'yuzey.html');
const PRELOAD_YUZEY = path.join(__dirname, 'preload-yuzey.js');
const YUZEY_ODAK_KAYBI_MS = 100; // odak kaybında gizlemeden önce bekleme; tepsi tıklaması bu sürede iptal eder
const YUZEY_ODAK_YEDEK_MS = 300; // gösterimden sonra hâlâ odaksızsa öne alıp odağı yeniden isteme (Windows ön plan kilidi)
const ILK_YUKLEME_GECIKMESI_MS = 1500;
const KIPLER = ['panel', 'palet'];
const DIGER_ISLEMLER = ['ac', 'kapat', 'degistir']; // palette "*" favori dışı cihaz işlemleri (o-46)
const DIGER_ALANLARI = ['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'scene'];
const DIGER_DURUMLARI = ['acik', 'kapali', 'notr'];
const EN_COK_DIGER_CIHAZ = 400;

/** Palet "*" satırı sayfaya yalnız kısa, tipi doğrulanmış alanlarla gider (ham HA durumu/öznitelik gitmez). */
function digerSatiriniTemizle(d) {
  if (!d || typeof d.kimlik !== 'string' || typeof d.ad !== 'string' || !DIGER_ALANLARI.includes(d.alan) || !DIGER_DURUMLARI.includes(d.durum)) return null;
  return { kimlik: d.kimlik.slice(0, 120), ad: d.ad.slice(0, 100), alan: d.alan, durum: d.durum, ...(typeof d.oda === 'string' && d.oda ? { oda: d.oda.slice(0, 100) } : {}) };
}

const OPAK_MALZEME = Object.freeze({ malzeme: 'yok', secenekler: Object.freeze({ backgroundColor: '#1b1f27' }) });

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} bag
 * @param {() => object} bag.modelAl renderer'a gidecek karo modeli (src/lib/yuzey-modeli.js)
 * @param {{yuzeydenCalistir: Function, basiliBasla: Function, basiliIptal: Function}} bag.eylem
 * @param {() => ({x:number,y:number,width:number,height:number}|null)} bag.tepsiSinirlariAl
 * @param {() => void} bag.haAc ana pencereyi göster
 * @param {() => void} bag.ayarlarAc
 * @param {() => ({malzeme: string, secenekler: object})} [bag.malzemeAl] Windows 11 pencere malzemesi (src/lib/malzeme.js,
 *   gorunum-11); verilmezse opak koyu arka plan
 * @param {() => boolean} [bag.ustteAl] 1.4.0 (o-22) "panel her zaman üstte" ayarı (panelHerZamanUstte): true ise panel/palet görünürken
 *   'screen-saver' seviyesinde üstte tutulur (tam ekran uygulamaların üstünde), gizlenince 1.3.0 seviyesine ('floating') döner; verilmezse hep false
 * @param {() => number} [bag.opaklikAl] 1.4.0 (o-32) panel opaklığı (yüzde, 50-100; ayar panelOpaklik); yalnız opak malzemede ('yok')
 *   uygulanır, akrilik/mica ile üst üste binmez; verilmezse 100
 * @param {Function} [bag.t] çevirmen (src/lib/dil.js; ana süreçte dil değişince kendiliğinden yeni dili izler). Verilmezse Türkçe.
 * @param {() => string} [bag.dilAl] etkin arayüz dili ('tr' | 'en' | 'de' | 'fr' | 'es'); verilirse sayfaya durum yanıtında `dil` olarak gider
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {object|null} [bag.okuma] 1.4.0 okuma uçları (src/lib/ha-okuma.js haOkumaOlustur); verilmezse yuzey:oku hep boş döner
 * @param {((kimlik: string, pencere: object) => Promise<unknown>)|null} [bag.sagTik] 1.4.0 düzen (o-16): karoya sağ tık menüsü
 *   (ana süreç Menu.popup). Menü ve seçilen işlem bitene kadar çözülmez; o sürece panel odak kaybıyla gizlenmez. Yalnız favori karolar için çağrılır.
 * @param {() => (object|null)} [bag.gorunumAl] görünüm modeli (src/lib/gorunum.js gorunumModeli: özel palet, yüksek karşıtlık, animasyon);
 *   null ise (varsayılan görünüm) yüke hiç eklenmez
 * @param {() => number} [bag.metinOlcegiAl] Ayarlar > Görünüm > Metin boyutu çarpanı (1, 1.15, 1.3, 1.5): panel ve palet bu yakınlaştırmayla açılır,
 *   Ctrl 0 buna döner (o-25)
 * @param {() => ({tekerlek: boolean, sabit: boolean}|null)} [bag.etkilesimAl] 1.4.0 etkileşim ayarları (o-20, o-23): tekerlek = karoTekerlegi (fare tekerleği
 *   ışık/ses değiştirsin mi), sabit = panelSabit. Sayfaya `yuzey:goster` / `yuzey:durum-al` yükünde `etkilesim` olarak gider; null ise yüke eklenmez.
 *   Sabitliyken (yalnız 'panel' kipi) odak kaybı paneli GİZLEMEZ; Esc, tepsi/kısayol ve "kapat" yine kapatır. Palet hiçbir zaman sabitlenmez.
 * @param {((sabit: boolean) => boolean)|null} [bag.sabitDegistir] sayfadaki iğne düğmesi (yuzey:sabitle): ayarı yazar ve son durumu döner; verilmezse düğme çalışmaz
 * @param {{kapat: Function}|null} [bag.bildirim] 1.4.0 bildirim merkezi (src/lib/bildirim-akisi.js); yuzey:bildirim-kapat öğeyi bununla kapatır
 * @param {{al: Function, temizle: Function}|null} [bag.kamera] 1.4.0 kamera anlık görüntüsü (src/lib/kamera.js kameraServisiOlustur);
 *   yuzey:kamera yalnız açık HIZLI PANELDEN çağrılır, görüntü diske yazılmaz, panel gizlenince bellekteki kareler silinir
 * @param {() => boolean} [bag.korumaAl] 1.4.0 kamera: panel/palet penceresi ekran görüntüsü ve kayıtlardan korunsun mu (setContentProtection);
 *   kameraya izin verilmişse ana süreç true döndürür. Verilmezse false.
 * @param {{al: Function, yanitla: Function, kapandi: Function}|null} [bag.disOnay] 1.4.0 dis grubu (o-54): evpaneli:// bağlantı izni
 *   (src/dis-tetikler.js `onay`). Soru yalnız açık HIZLI PANELDE gösterilir; panel soru açıkken kapanır ya da palete geçerse reddedilmiş sayılır.
 * @param {((kaynak: 'panel'|'palet') => Promise<{ok: boolean, tur?: string}>)|null} [bag.geriAl] 1.4.0 eylem grubu (o-12): yuzey:geri-al en yeni geri alma
 *   girdisini bununla geri alır (src/lib/eylem-ekleri.js geriAl); adımlar yine tek güvenli eylem hattından geçer
 * @param {object|null} [bag.eylemEk] 1.4.0 eylem grubu bağlayıcısı (src/lib/eylem-ekleri.js): gecikmeli eylem (o-15: yuzey:geciktir, yuzey:gecikmeli-iptal),
 *   oda (o-14) ve diğer cihazlar (o-46) uçları bunun işlevlerini çağırır; yük burada biçimce doğrulanır, asıl doğrulama bağlayıcıdadır
 */
function yuzeyYoneticisiOlustur({ modelAl, eylem, tepsiSinirlariAl, haAc, ayarlarAc, malzemeAl = () => OPAK_MALZEME, ustteAl = () => false, opaklikAl = () => 100, t = TR, dilAl = null, gunluk = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman(), okuma = null, sagTik = null, gorunumAl = () => null, metinOlcegiAl = () => 1, bildirim = null, kamera = null, korumaAl = () => false, etkilesimAl = () => null, sabitDegistir = null, disOnay = null, geriAl = null, eylemEk = null }) {
  const izinYok = () => ({ ok: false, hata: t('ana.izinYok') });
  let pencere = null;
  let yuklendi = false;
  let mod = null; // açıkken 'panel' | 'palet'
  let bekleyenSayfa = null; // palet "sayfa" satırı: panel bu sayfayla açılır (bir kez; yük 'yuzey:goster' içinde gider)
  let bekleyenMod = null; // sayfa yüklenirken istenen kip
  let odakKaybiZamanlayicisi = null;
  let odakYedekZamanlayicisi = null;
  let yuklemeZamanlayicisi = null;
  let sonOdakKaybi = 0;
  let sonOtomatikGizleme = 0;
  let menuAcik = 0; // açık bağlam menüsü / onay sayısı (o-16): sürerken odak kaybı paneli gizlemez
  const yukseklik = { panel: PANEL_BOYUTU.height, palet: PALET_BOYUTU.height }; // renderer'ın bildirdiği içerik yüksekliği (CSS pikseli)
  let yakinlastirma = 1; // Ctrl + / Ctrl − / Ctrl 0 (g-13); pencere gizlenip yeniden oluşturulsa da korunur
  let elleYakinlastirma = false; // kullanıcı Ctrl + / − ile tabandan ayrıldı: Ayarlar'daki metin boyutu değişse bile oturum seçimi korunur
  let uygulananOlcek = 1; // pencerenin sayfasına son yazılan yakınlaştırma (yeni pencerede 1)
  let disOnaySoruldu = false; // o-54: panel bir bağlantı izni sorusu için açıldı ve soru henüz yanıtlanmadı

  /** o-54: açık izin sorusu panel kapanınca / palete geçince reddedilir (dis-tetikler zaman aşımını da kendisi uygular). */
  function disOnayiBirak() {
    if (!disOnaySoruldu) return;
    disOnaySoruldu = false;
    try {
      disOnay?.kapandi();
    } catch {
      gunluk('Bağlantı izni sorusu kapatılamadı.');
    }
  }

  /** Ayarlar > Görünüm > Metin boyutu (o-25): yakınlaştırmanın tabanı. Geçersiz ya da adımlarda olmayan değer 1 sayılır. */
  function tabanYakinlastirma() {
    let olcek = 1;
    try {
      olcek = Number(metinOlcegiAl());
    } catch {
      olcek = 1;
    }
    return YAKINLASTIRMA_ADIMLARI.includes(olcek) ? olcek : 1;
  }

  /** Elle değiştirilmediyse yakınlaştırma Ayarlar'daki tabana eşitlenir (ayarlar pencere oluşmadan sonra da yüklenmiş olabilir). */
  function yakinlastirmayiTabanaEsitle() {
    if (!elleYakinlastirma) yakinlastirma = tabanYakinlastirma();
  }

  /** Görünüm modeli yüke eklenir; varsayılan görünümde (null) hiçbir anahtar eklenmez. */
  function gorunumEki() {
    try {
      const g = gorunumAl();
      return g ? { gorunum: g } : {};
    } catch {
      return {};
    }
  }

  /** o-20 / o-23 etkileşim ayarları: yalnız iki boolean; geçersiz ya da okunamazsa hiçbir anahtar eklenmez. */
  function etkilesimDegeri() {
    try {
      const e = etkilesimAl();
      return e && typeof e === 'object' ? { tekerlek: e.tekerlek !== false, sabit: e.sabit === true } : null;
    } catch {
      return null;
    }
  }

  function etkilesimEki() {
    const e = etkilesimDegeri();
    return e ? { etkilesim: e } : {};
  }

  /** Panel sabitli mi? Yalnız 'panel' kipinde geçerlidir (palet her zaman odak kaybında kapanır). */
  const sabitMi = (kip) => kip === 'panel' && etkilesimDegeri()?.sabit === true;

  const canliMi = () => !!pencere && !pencere.isDestroyed();
  const gorunurMu = () => canliMi() && pencere.isVisible();

  function odakKaybiniIptalEt() {
    zaman.clearTimeout(odakKaybiZamanlayicisi);
    odakKaybiZamanlayicisi = null;
  }

  function odakYedeginiIptalEt() {
    zaman.clearTimeout(odakYedekZamanlayicisi);
    odakYedekZamanlayicisi = null;
  }

  /** Odak kaybından kısa süre sonra hâlâ odaksızsa paneli gizler (blur olayı ve bağlam menüsü kapanışı ortak kullanır). */
  function odakKaybiniZamanla(bu) {
    odakKaybiniIptalEt();
    odakKaybiZamanlayicisi = zaman.setTimeout(() => {
      odakKaybiZamanlayicisi = null;
      if (sabitMi(mod)) return; // o-23: sabitli panel dışarı tıklayınca kapanmaz
      if (pencere === bu && !bu.isDestroyed() && bu.isVisible() && !bu.isFocused()) gizle('odak');
    }, YUZEY_ODAK_KAYBI_MS);
  }

  /**
   * Windows ön plan kilidi pencerenin odak almasını engelleyebilir: pencere açılır ama blur hiç gelmeyeceğinden dışarı
   * tıklayınca kapanmaz, Esc ve yazılanlar önceki uygulamaya (oyun/Chrome) gider. Ana pencerenin yedeğiyle aynı fikir
   * (main.js pencereyeOdakVer); panel zaten alwaysOnTop olduğundan setAlwaysOnTop oynatılmaz, öne alınıp odak yeniden istenir.
   * Davranış bu ortamda DENENMEDİ (README elle deneme listesi).
   */
  function odakYedeginiKur(bu) {
    odakYedeginiIptalEt();
    odakYedekZamanlayicisi = zaman.setTimeout(() => {
      odakYedekZamanlayicisi = null;
      if (pencere !== bu || bu.isDestroyed() || !bu.isVisible() || bu.isFocused()) return;
      try {
        if (typeof bu.moveTop === 'function') bu.moveTop();
        bu.focus();
        bu.webContents.focus();
      } catch {
        gunluk('Hızlı panel odağı yeniden istenemedi.');
      }
    }, YUZEY_ODAK_YEDEK_MS);
  }

  /** Sayfa yakınlaştırmasını uygular (yoksa/başarısızsa sessizce geçer; boyut yine de ölçeklenir). */
  function yakinlastirmayiUygula(wc) {
    try {
      if (typeof wc?.setZoomFactor === 'function') {
        wc.setZoomFactor(yakinlastirma);
        uygulananOlcek = yakinlastirma;
      }
    } catch {
      gunluk('Hızlı panel yakınlaştırması uygulanamadı.');
    }
  }

  /** Ctrl + / Ctrl − / Ctrl 0: yakınlaştırma adımı değişir, pencere (genişlik ve yükseklik) aynı oranda yeniden yerleştirilir. */
  function yakinlastir(adim) {
    const taban = tabanYakinlastirma();
    const yeni = yakinlastirmaDegeri(yakinlastirma, adim, taban); // Ctrl 0 Ayarlar'daki metin boyutuna döner
    elleYakinlastirma = yeni !== taban;
    if (yeni === yakinlastirma) return;
    yakinlastirma = yeni;
    if (!canliMi()) return;
    yakinlastirmayiUygula(pencere.webContents);
    if (gorunurMu() && KIPLER.includes(mod)) yerlestir(mod);
  }

  function sifirla(bu, neden) {
    if (pencere !== bu) return;
    gunluk(`Hızlı panel penceresi sıfırlandı (${neden}); sonraki açılışta yeniden oluşturulacak.`);
    odakKaybiniIptalEt();
    odakYedeginiIptalEt();
    disOnayiBirak();
    pencere = null;
    yuklendi = false;
    mod = null;
    bekleyenMod = null;
    kareleriTemizle();
    try {
      if (!bu.isDestroyed()) bu.destroy();
    } catch {
      /* zaten yok edilmiş */
    }
  }

  function olustur() {
    if (canliMi()) return;
    yuklendi = false;
    uygulananOlcek = 1; // yeni sayfa 1 ile başlar
    yakinlastirmayiTabanaEsitle();
    try {
      const bu = yerelPencereOlustur({
        preload: PRELOAD_YUZEY,
        secenekler: {
          width: PANEL_BOYUTU.width,
          height: PANEL_BOYUTU.height,
          show: false,
          frame: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          title: t('uygulama.yuzeyBaslik'),
          roundedCorners: true, // Windows 11'de çerçevesiz pencere yuvarlak köşeli (varsayılan; gorunum-11). `transparent` KULLANILMAZ.
          ...malzemeAl().secenekler, // backgroundMaterial (acrylic/mica; Windows 11 22H2+) ve arka plan rengi
        },
      });
      pencere = bu;
      const wc = bu.webContents;
      wc.once('did-finish-load', () => {
        if (pencere !== bu) return;
        yuklendi = true;
        yakinlastirmayiTabanaEsitle();
        if (yakinlastirma !== 1) yakinlastirmayiUygula(wc);
        if (bekleyenMod) {
          const istenen = bekleyenMod;
          bekleyenMod = null;
          goster(istenen);
        }
      });
      wc.on('render-process-gone', (_olay, ayrinti) => {
        if (!cokmeSayilirMi(ayrinti?.reason)) return;
        sifirla(bu, `sayfa-sureci-kapandi:${cokmeNedeniMetni(ayrinti?.reason)}`);
      });
      // Panel ve palette yazı boyutu (g-13): çerçevesiz pencerede menü/hızlandırıcı yok; Ctrl + / Ctrl − / Ctrl 0 burada yakalanır.
      wc.on('before-input-event', (olay, girdi) => {
        if (pencere !== bu) return;
        const adim = yakinlastirmaTusu(girdi);
        if (adim === null) return;
        olay.preventDefault();
        yakinlastir(adim);
      });
      wc.on('did-fail-load', (_olay, hataKodu, _aciklama, _url, anaCerceve) => {
        if (anaCerceve === false || hataKodu === -3 /* ERR_ABORTED */) return;
        sifirla(bu, `sayfa-yuklenemedi:${hataKodu}`);
      });
      wc.on('unresponsive', () => gunluk('Hızlı panel sayfası yanıt vermiyor.'));
      bu.on('blur', () => {
        if (pencere !== bu) return;
        sonOdakKaybi = simdi();
        odakKaybiniIptalEt();
        if (menuAcik > 0) return; // bağlam menüsü açık: kapanınca odak yeniden denetlenir (menuBitti)
        odakKaybiniZamanla(bu);
      });
      bu.on('focus', () => {
        if (pencere !== bu) return;
        sonOdakKaybi = 0;
        odakKaybiniIptalEt();
      });
      bu.on('closed', () => {
        if (pencere !== bu) return;
        pencere = null;
        yuklendi = false;
        mod = null;
      });
      bu.loadFile(YUZEY_HTML).catch(() => {
        sifirla(bu, 'yukleme-reddedildi');
      });
    } catch {
      pencere = null;
      gunluk('Hızlı panel penceresi oluşturulamadı.');
    }
  }

  /** Kipe göre boyut ve konumu uygular (imlecin bulunduğu ekranda). */
  function yerlestir(kip) {
    if (!canliMi()) return;
    const imlec = screen.getCursorScreenPoint();
    const ekran = screen.getDisplayNearestPoint(imlec);
    const alan = ekran.workArea;
    const boyut = yuzeyBoyutu(kip === 'palet' ? PALET_BOYUTU : PANEL_BOYUTU, yukseklik[kip], yakinlastirma, alan);
    const konum = kip === 'palet' ? paletKonumu(alan, boyut) : panelKonumu(tepsiSinirlariAl(), alan, boyut, 8, ekran.bounds);
    const hedef = { x: konum.x, y: konum.y, width: boyut.width, height: boyut.height };
    pencere.setBounds(hedef);
    // Karma DPI'da ilk çağrı yanlış ölçeklenebilir; ikinci çağrı yalnız sonuç hedeften saparsa yapılır (1.4.1: her yükseklik
    // değişiminde koşulsuz iki kez boyutlamak paneli sıçratıyordu).
    if (sinirSapti(pencere, hedef)) pencere.setBounds(hedef);
  }

  function sinirSapti(p, hedef) {
    if (typeof p.getBounds !== 'function') return true;
    try {
      const s = p.getBounds();
      return !s || s.x !== hedef.x || s.y !== hedef.y || s.width !== hedef.width || s.height !== hedef.height;
    } catch {
      return true;
    }
  }

  /**
   * o-22: görünürken ayar açıksa 'screen-saver' seviyesi (tam ekran uygulamaların ve görev çubuğunun üstünde), değilse 1.3.0
   * davranışı: pencere oluşturulurken alwaysOnTop:true'nun varsayılan seviyesi 'floating'. Gizlenince hep 'floating'e dönülür
   * ('normal' seviyesi KULLANILMAZ: Electron'da "üstte değil" anlamına gelir). Sistem seviyeyi desteklemezse sessizce atlanır.
   */
  function ustSeviyesiniUygula(gorunur) {
    if (!canliMi() || typeof pencere.setAlwaysOnTop !== 'function') return;
    let ust = false;
    try {
      ust = ustteAl() === true;
    } catch {
      ust = false;
    }
    try {
      if (gorunur && ust) pencere.setAlwaysOnTop(true, 'screen-saver');
      else pencere.setAlwaysOnTop(true, 'floating');
    } catch {
      gunluk('Hızlı panel üst seviyesi uygulanamadı.');
    }
  }

  /** o-32: panel opaklığı yalnız opak malzemede (malzeme 'yok') uygulanır; akrilik/mica'da pencere tam opak kalır. */
  function opaklikUygula() {
    if (!canliMi() || typeof pencere.setOpacity !== 'function') return;
    let oran = 1;
    try {
      // Yüksek karşıtlık (o-25) opak zemin vaat eder: yarı saydam pencere o sözü bozar, opaklık ayarı bu kipte yok sayılır.
      const yuksekKarsitlik = gorunumAl()?.karsitlik === true;
      if (malzemeAl().malzeme === 'yok' && !yuksekKarsitlik) oran = opaklikOrani(opaklikAl());
    } catch {
      oran = 1;
    }
    try {
      pencere.setOpacity(oran);
    } catch {
      gunluk('Hızlı panel opaklığı uygulanamadı.');
    }
  }

  /**
   * 1.4.0 kamera: kameraya izin verilmişse pencere ekran görüntüsü / ekran kaydı programlarından gizlenir (Electron setContentProtection;
   * Windows'ta WDA_EXCLUDEFROMCAPTURE). Ayar değişince ve her gösterimde yeniden uygulanır; desteklenmiyorsa sessizce atlanır.
   */
  function korumaUygula() {
    if (!canliMi() || typeof pencere.setContentProtection !== 'function') return;
    let koru = false;
    try {
      koru = korumaAl() === true;
    } catch {
      koru = false;
    }
    try {
      pencere.setContentProtection(koru);
    } catch {
      gunluk('Hızlı panel ekran görüntüsü koruması uygulanamadı.');
    }
  }

  function modelGonder() {
    if (!canliMi() || !yuklendi) return;
    try {
      pencere.webContents.send('yuzey:durum', rendererModeli(modelAl()));
    } catch {
      gunluk('Hızlı panel modeli gönderilemedi.');
    }
  }

  function goster(kip) {
    if (!KIPLER.includes(kip)) return false;
    if (kip !== 'panel') disOnayiBirak();
    if (!canliMi()) olustur();
    if (!canliMi()) return false;
    if (!yuklendi) {
      bekleyenMod = kip; // sayfa yüklenince açılır
      return true;
    }
    odakKaybiniIptalEt();
    menuAcik = 0;
    mod = kip;
    try {
      yakinlastirmayiTabanaEsitle();
      if (yakinlastirma !== uygulananOlcek) yakinlastirmayiUygula(pencere.webContents); // ayarlar pencere oluştuktan sonra yüklendiyse
      yerlestir(kip);
      modelGonder();
      const istenenSayfa = kip === 'panel' ? bekleyenSayfa : null;
      bekleyenSayfa = null;
      pencere.webContents.send('yuzey:goster', { mod: kip, malzeme: malzemeAl().malzeme, ...gorunumEki(), ...etkilesimEki(), ...(istenenSayfa !== null ? { sayfa: istenenSayfa } : {}) });
      opaklikUygula();
      korumaUygula();
      ustSeviyesiniUygula(true);
      pencere.show();
      pencere.focus();
      pencere.webContents.focus(); // ilk tuş vuruşu sayfaya gitsin (palet arama kutusu)
      odakYedeginiKur(pencere);
    } catch {
      gunluk('Hızlı panel gösterilemedi.');
      return false;
    }
    return true;
  }

  /** Kamera önbelleği (yalnız bellek) panel gizlenince/kapanınca silinir. */
  function kareleriTemizle() {
    try {
      kamera?.temizle?.();
    } catch {
      gunluk('Kamera önbelleği temizlenemedi.');
    }
  }

  function gizle(neden = 'kapat') {
    odakKaybiniIptalEt();
    odakYedeginiIptalEt();
    menuAcik = 0;
    bekleyenMod = null;
    disOnayiBirak();
    if (!canliMi()) return;
    const gorunurdu = pencere.isVisible();
    mod = null;
    kareleriTemizle(); // kamera karesi panel kapanınca bellekte kalmaz
    if (gorunurdu) {
      if (neden === 'odak') sonOtomatikGizleme = simdi();
      pencere.hide();
      ustSeviyesiniUygula(false);
    }
  }

  /**
   * Tepsi tıklaması ya da kısayol aynı kuralla (tiklamaKarari): pencere o kipte görünür VE odaktaysa kapat, değilse aç.
   * Sabitli panel (o-23) dışarı tıklayınca kapanmadığından odaksız görünür: tepsi/kısayol onu her zaman KAPATIR (aksi halde tıklama
   * yalnız odak verir ve panel Esc'ye kalırdı).
   */
  function acKapat(kip, kaynak) {
    const gorunur = gorunurMu() && mod === kip;
    const karar = gorunur && sabitMi(kip)
      ? 'kapat'
      : tiklamaKarari({
        kaynak,
        gorunur,
        odakta: gorunur && pencere.isFocused(),
        bekleyenGizleme: odakKaybiZamanlayicisi !== null,
        sonGizlemeMs: sonOtomatikGizleme,
        sonOdakKaybiMs: sonOdakKaybi,
        simdi: simdi(),
      });
    if (karar === 'kapat') {
      gizle('tikla');
      return 'kapandi';
    }
    return goster(kip) ? 'acildi' : 'acilamadi';
  }

  // --- IPC (hepsi gönderen denetimli) ---

  const yuzeydenMi = (olay) => yerelOlaydanMi(olay, pencere, YUZEY_HTML);
  /** Eylem kaynağı: açık kipten (ana süreç bilir); pencere gizliyken gelen istek kabul edilmez. */
  const kaynakKip = () => (gorunurMu() && KIPLER.includes(mod) ? mod : null);

  function ipcKaydet() {
    ipcMain.handle('yuzey:durum-al', (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      return { ok: true, mod, model: rendererModeli(modelAl()), malzeme: malzemeAl().malzeme, ...(dilAl ? { dil: dilAl() } : {}), ...gorunumEki(), ...etkilesimEki() };
    });
    ipcMain.handle('yuzey:calistir', async (olay, yuk) => {
      if (!yuzeydenMi(olay)) return izinYok();
      const kaynak = kaynakKip();
      if (!kaynak) return { ok: false, tur: 'gecersiz' };
      return eylem.yuzeydenCalistir(kaynak, yuk);
    });
    ipcMain.handle('yuzey:basili-basla', (olay, kimlik) => {
      if (!yuzeydenMi(olay) || !kaynakKip()) return izinYok();
      return { ok: eylem.basiliBasla(kimlik) };
    });
    // Renderer basılı tutmayı BIRAKTI (iptal): ana süreçteki başlangıç kaydı silinir. Onay zaten ana sürecin kendi saatiyle
    // doğrulanır; bu, savunma derinliğidir (bırakılan basış sonradan "yeterince uzun" sayılmasın).
    ipcMain.handle('yuzey:basili-birak', (olay, kimlik) => {
      if (!yuzeydenMi(olay)) return izinYok();
      eylem.basiliIptal(kimlik);
      return { ok: true };
    });
    // 1.4.0 (o-23): iğne düğmesi. Yük yalnız bir boolean'dır; yalnız açık HIZLI PANELDEN (palette düğme yok). Ayarı ana süreç yazar (bag.sabitDegistir) ve
    // yanıtta KESİN son durumu döner (yazılamazsa eski durum). HA'ya hiçbir şey gitmez.
    ipcMain.handle('yuzey:sabitle', (olay, sabit) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'panel' || typeof sabit !== 'boolean' || typeof sabitDegistir !== 'function') return { ok: false, tur: 'gecersiz' };
      let son;
      try {
        son = sabitDegistir(sabit);
      } catch {
        gunluk('Panel sabitleme ayarı yazılamadı.');
        return { ok: false, tur: 'yazilamadi' };
      }
      return typeof son === 'boolean' ? { ok: true, sabit: son } : { ok: false, tur: 'yazilamadi' };
    });
    // 1.4.0 düzen (o-24): palet "sayfa" satırı. YALNIZ PALETTEN; yük yalnız sayfa kimliğidir ('tumu' ya da modeldeki sayfa). Ana süreç kimliği modele karşı
    // doğrular, paneli o sayfayla açar (palet kapanır). HA'ya hiçbir şey gitmez; bilinmeyen kimlik reddedilir.
    ipcMain.handle('yuzey:sayfa-sec', (olay, kimlik) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'palet' || typeof kimlik !== 'string' || kimlik.length > 40) return { ok: false, tur: 'gecersiz' };
      const sayfalar = rendererModeli(modelAl()).sayfalar;
      if (kimlik !== 'tumu' && !sayfalar.some((s) => s.id === kimlik)) return { ok: false, tur: 'bilinmiyor' };
      bekleyenSayfa = kimlik;
      const acildi = goster('panel');
      bekleyenSayfa = null;
      return acildi ? { ok: true } : { ok: false, tur: 'acilamadi' };
    });
    ipcMain.on('yuzey:kapat', (olay) => {
      if (yuzeydenMi(olay)) gizle('renderer');
    });
    ipcMain.on('yuzey:boyut', (olay, deger) => {
      if (!yuzeydenMi(olay)) return;
      const kip = kaynakKip();
      if (!kip || typeof deger !== 'number') return;
      const alan = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      // Renderer CSS pikseli bildirir; pencere sınırı (çalışma alanı, en çok) DIP'tir: yakınlaştırmayla çarpılıp kırpılır, CSS'e geri çevrilir.
      const h = yuzeyYuksekligiKirp(deger * yakinlastirma, alan, yakinlastirma);
      if (h === null) return;
      const css = Math.round(h / yakinlastirma);
      if (css === yukseklik[kip]) return;
      yukseklik[kip] = css;
      yerlestir(kip);
    });
    // 1.4.0 okuma ucu: geçmiş, takvim, hava tahmini, yapılacaklar. Yalnız açık panel/paletten, yalnız KAYITLI (favori ya da
    // Ayarlar'da seçilmiş) varlıklar için; veri ana süreçte süzülür (src/lib/ha-okuma.js yuzeyOkumasi).
    ipcMain.handle('yuzey:oku', async (olay, yuk) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (!kaynakKip() || !okuma) return { ok: false, tur: 'gecersiz' };
      return yuzeyOkumasi(okuma, yuk, (kimlik) => eylem.kayitliMi(kimlik));
    });
    // 1.4.0 düzen (o-16): karoya sağ tık. Yük yalnız bir varlık kimliğidir; menü içeriğini ana süreç kendi ayarından kurar ve
    // HA'ya hiçbir şey göndermez. Yalnız açık panel/paletten, yalnız KAYITLI (favori) karo için.
    ipcMain.handle('yuzey:sag-tik', async (olay, kimlik) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (!sagTik || !kaynakKip() || typeof kimlik !== 'string' || !eylem.kayitliMi(kimlik)) return { ok: false, tur: 'gecersiz' };
      const bu = pencere;
      menuAcik += 1;
      odakKaybiniIptalEt();
      try {
        await sagTik(kimlik, bu);
      } catch {
        gunluk('Karo menüsü açılamadı.');
      } finally {
        menuAcik = Math.max(0, menuAcik - 1);
        // Menü dışına tıklanarak kapatıldıysa odak başka yere gitmiştir: panel her zamanki kuralla gizlenir.
        if (menuAcik === 0 && pencere === bu && !bu.isDestroyed() && bu.isVisible() && !bu.isFocused()) odakKaybiniZamanla(bu);
      }
      return { ok: true };
    });
    // 1.4.0 bildirim şeridi: öğeyi kapatır. Yalnız açık HIZLI PANELDEN (palette şerit yok), anahtar yalnız modeldeki opak anahtardır;
    // HA bildirimi korumalı yoldan (eylem.bildirimKapat: yetki kesici, hız sınırı, tek POST noktası) kapatılır, diğerleri yerelde.
    ipcMain.handle('yuzey:bildirim-kapat', async (olay, anahtar) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'panel' || !bildirim) return { ok: false, tur: 'gecersiz' };
      if (typeof anahtar !== 'string' || anahtar.length === 0 || anahtar.length > 40) return { ok: false, tur: 'gecersiz' };
      return bildirim.kapat(anahtar, (haKimligi) => eylem.bildirimKapat(haKimligi));
    });
    // 1.4.0 kamera anlık görüntüsü (o-48): yalnız açık HIZLI PANELDEN (palette ve diğer yüzeylerde kamera yok). Yük yalnız bir varlık
    // kimliğidir; izin listesi, canlı durum, ad süzgeci, hız sınırı ve görüntü doğrulaması kamera servisindedir (src/lib/kamera.js).
    // Yanıt: { ok:true, veri:'data:image/...', yas, onbellek } | { ok:false, tur }. Görüntü diske yazılmaz.
    ipcMain.handle('yuzey:kamera', async (olay, kimlik) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'panel' || !kamera) return { ok: false, tur: 'gecersiz' };
      if (typeof kimlik !== 'string' || kimlik.length === 0 || kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      return kamera.al(kimlik);
    });
    // 1.4.0 dis grubu (o-54): evpaneli:// izni. Soru yalnız açık panelde okunur; karar yalnız sorunun biletiyle kabul edilir
    // (dis-tetikler onay.yanitla: bilet, karar listesi ve "İzin ver" için en az görünme süresi orada denetlenir).
    ipcMain.handle('yuzey:dis-onay-al', (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'panel' || !disOnay || !disOnaySoruldu) return { ok: true, soru: null };
      return { ok: true, soru: disOnay.al() };
    });
    ipcMain.handle('yuzey:dis-onay-yanit', (olay, bilet, karar) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'panel' || !disOnay || !disOnaySoruldu) return { ok: false, tur: 'gecersiz' };
      const ok = disOnay.yanitla(bilet, karar) === true;
      if (ok) disOnaySoruldu = false;
      return { ok };
    });
    // 1.4.0 eylem grubu (o-12): "Geri al" düğmesi. Yük yoktur (renderer neyin geri alınacağını SEÇEMEZ); yalnız açık panel/paletten.
    ipcMain.handle('yuzey:geri-al', async (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      const kaynak = kaynakKip();
      if (!kaynak || !geriAl) return { ok: false, tur: 'gecersiz' };
      const sonuc = await geriAl(kaynak);
      return { ok: sonuc?.ok === true, ...(typeof sonuc?.tur === 'string' ? { tur: sonuc.tur } : {}) };
    });
    // 1.4.0 eylem grubu (o-15): palet satırından gecikmeli eylem kur ("salon 10 dk sonra kapat", "fan 30dk"). Yük { kimlik, yon: 'ac'|'kapat'|'sureli',
    // dakika }; alan, eylem sınıfı, Kapı Kuralı, süre ve bekleyen sayısı bağlayıcıda (src/lib/gecikmeli-eylem.js) yeniden doğrulanır.
    ipcMain.handle('yuzey:geciktir', async (olay, yuk) => {
      if (!yuzeydenMi(olay)) return izinYok();
      const kaynak = kaynakKip();
      if (!kaynak || !eylemEk) return { ok: false, tur: 'gecersiz' };
      if (!yuk || typeof yuk !== 'object' || Array.isArray(yuk) || typeof yuk.kimlik !== 'string' || yuk.kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      if (!['ac', 'kapat', 'sureli'].includes(yuk.yon) || !Number.isInteger(yuk.dakika)) return { ok: false, tur: 'gecersiz' };
      const sonuc = await eylemEk.gecikmeliPlanla(kaynak, { kimlik: yuk.kimlik, yon: yuk.yon, dakika: yuk.dakika });
      return { ok: sonuc?.ok === true, ...(typeof sonuc?.tur === 'string' ? { tur: sonuc.tur } : {}) };
    });
    // Bekleyen gecikmeli eylemi iptal eder: yük yalnız modeldeki opak kimliktir (g<n>); varlık kimliği sayfaya hiç gitmez.
    ipcMain.handle('yuzey:gecikmeli-iptal', (olay, id) => {
      if (!yuzeydenMi(olay)) return izinYok();
      const kaynak = kaynakKip();
      if (!kaynak || !eylemEk || typeof id !== 'string' || !/^g\d{1,9}$/.test(id)) return { ok: false, tur: 'gecersiz' };
      return { ok: eylemEk.gecikmeliIptal(id, kaynak) === true };
    });
    // 1.4.0 eylem grubu (o-14): panelde odanın başlığındaki "Odayı kapat". Yük yalnız grup kodudur (oda-<8 onaltılık>); üyeleri (açık, zararsız
    // ışık / priz / vantilatör / sanal anahtar / nem alıcı) ana süreç yeniden hesaplar ve her birini tek güvenli hattan çalıştırır. Yalnız PANELDEN.
    ipcMain.handle('yuzey:oda-kapat', async (olay, kod) => {
      if (!yuzeydenMi(olay)) return izinYok();
      const kaynak = kaynakKip();
      if (kaynak !== 'panel' || !eylemEk || typeof kod !== 'string' || !/^oda-[0-9a-f]{8}$/.test(kod)) return { ok: false, tur: 'gecersiz' };
      const sonuc = await eylemEk.odaKapat(kaynak, kod);
      return { ok: sonuc?.ok === true, ...(typeof sonuc?.tur === 'string' ? { tur: sonuc.tur } : {}), ...(Number.isInteger(sonuc?.adet) ? { adet: sonuc.adet } : {}) };
    });
    // 1.4.0 eylem grubu (o-46): palette "*" ile favori olmayan güvenli cihazlar. YALNIZ PALETTEN ve yalnız ayar açıkken; liste, doğrulama ve
    // eylem ana süreçte (src/lib/diger-cihazlar.js): Kapı Kuralı + eylem sınıfı + servis izin listesi + hız sınırı. Sayfaya yalnız kısa alanlar gider.
    ipcMain.handle('yuzey:diger-cihazlar', async (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'palet' || !eylemEk) return { ok: false, tur: 'gecersiz' };
      const sonuc = await eylemEk.digerListe('palet');
      if (sonuc?.ok !== true || !Array.isArray(sonuc.liste)) return { ok: false, tur: typeof sonuc?.tur === 'string' ? sonuc.tur : 'hata' };
      return { ok: true, liste: sonuc.liste.slice(0, EN_COK_DIGER_CIHAZ).map(digerSatiriniTemizle).filter(Boolean) };
    });
    // Yük { kimlik, islem: 'ac'|'kapat'|'degistir' }; kimlik ancak ana sürecin güncel listesinde varsa işlenir (serbest kimlikle eylem başlamaz).
    ipcMain.handle('yuzey:diger-calistir', async (olay, yuk) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'palet' || !eylemEk) return { ok: false, tur: 'gecersiz' };
      if (!yuk || typeof yuk !== 'object' || Array.isArray(yuk) || typeof yuk.kimlik !== 'string' || yuk.kimlik.length > 120 || !DIGER_ISLEMLER.includes(yuk.islem)) return { ok: false, tur: 'gecersiz' };
      const sonuc = await eylemEk.digerCalistir('palet', { kimlik: yuk.kimlik, islem: yuk.islem });
      return { ok: sonuc?.ok === true, ...(typeof sonuc?.tur === 'string' ? { tur: sonuc.tur } : {}) };
    });
    ipcMain.handle('yuzey:diger-favori-ekle', async (olay, kimlik) => {
      if (!yuzeydenMi(olay)) return izinYok();
      if (kaynakKip() !== 'palet' || !eylemEk || typeof kimlik !== 'string' || kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      const sonuc = await eylemEk.digerFavoriEkle('palet', kimlik);
      return { ok: sonuc?.ok === true, ...(typeof sonuc?.tur === 'string' ? { tur: sonuc.tur } : {}) };
    });
    ipcMain.handle('yuzey:ha-ac', (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      gizle('ha-ac');
      haAc();
      return { ok: true };
    });
    ipcMain.handle('yuzey:ayarlar-ac', (olay) => {
      if (!yuzeydenMi(olay)) return izinYok();
      gizle('ayarlar-ac');
      ayarlarAc();
      return { ok: true };
    });
  }

  return {
    ipcKaydet,
    /** Açılıştan biraz sonra pencereyi arka planda yükler (ilk açılış anında olsun). */
    hazirla(gecikmeMs = ILK_YUKLEME_GECIKMESI_MS) {
      zaman.clearTimeout(yuklemeZamanlayicisi);
      yuklemeZamanlayicisi = zaman.setTimeout(olustur, gecikmeMs);
    },
    /** Ayarlar > Görünüm değişti: var olan pencerenin arka plan malzemesi güncellenir; sayfa yeni değeri bir sonraki gösterimde alır. */
    malzemeyiUygula() {
      if (canliMi()) malzemeUygula(pencere, malzemeAl());
      if (gorunurMu()) opaklikUygula(); // malzeme 'yok' <-> akrilik değişince opaklık kuralı da değişir
    },
    /** o-22: "panel her zaman üstte" ayarı değişti: açık pencerenin seviyesi hemen güncellenir (kapalıysa bir sonraki gösterimde uygulanır). */
    ustteDegisti() {
      if (gorunurMu()) ustSeviyesiniUygula(true);
    },
    /** 1.4.0 kamera izinleri değişti: ekran görüntüsü koruması açık pencereye hemen uygulanır, eski kareler silinir. */
    kameraDegisti() {
      kareleriTemizle();
      korumaUygula();
    },
    /** o-32: panel opaklığı ayarı değişti: açık pencereye hemen uygulanır (kapalıysa bir sonraki gösterimde). */
    opaklikDegisti() {
      if (gorunurMu()) opaklikUygula();
    },
    /**
     * Ayarlar > Görünüm > Metin boyutu değişti (o-25): oturumdaki elle yakınlaştırma (Ctrl + / −) bırakılır, yakınlaştırma yeni tabana gelir;
     * pencere açıksa aynı oranda yeniden yerleştirilir.
     */
    metinOlcegiUygula() {
      elleYakinlastirma = false;
      yakinlastirma = tabanYakinlastirma();
      if (!canliMi()) return;
      yakinlastirmayiUygula(pencere.webContents);
      if (gorunurMu() && KIPLER.includes(mod)) yerlestir(mod);
    },
    /**
     * o-54: bağlantı izni sorusunu panelde gösterir (dis-tetikler panelOnayGoster). Panel açılamazsa false: çağıran yedek iletişim
     * kutusuna düşer. Sayfa yükleniyorsa soru gösterim olayıyla (disOnayAl) okunur.
     */
    disOnayGoster() {
      if (!disOnay) return false;
      disOnaySoruldu = true;
      if (!goster('panel')) {
        disOnaySoruldu = false;
        return false;
      }
      if (yuklendi && canliMi()) {
        try {
          pencere.webContents.send('yuzey:dis-onay');
        } catch {
          gunluk('Bağlantı izni sorusu panele gönderilemedi.');
        }
      }
      return true;
    },
    /** o-54: soru başka yoldan bitti (zaman aşımı, yedek kutu): panel soruyu kaldırsın. */
    disOnayBitti() {
      disOnaySoruldu = false;
      if (!canliMi() || !yuklendi) return;
      try {
        pencere.webContents.send('yuzey:dis-onay');
      } catch {
        /* sayfa yok */
      }
    },
    panelAcKapat: (kaynak = 'tepsi') => acKapat('panel', kaynak),
    paletAcKapat: () => acKapat('palet', 'kisayol'),
    /** Kesin gösterim (komut satırı `--goster --hedef=panel|palet`, o-19): açıksa yeniden yerleştirir, kapalıysa açar. Geçersiz kipte false. */
    ac: (kip) => goster(kip),
    gizle,
    /**
     * Arayüz dili değişti: pencere başlığı güncellenir, sayfaya 'dil:degisti' ({ dil }) bildirilir (gizli olsa da; sayfa kendini yeniden çevirir).
     * Model etiketleri (grup adları) bir sonraki modelGonder'de yeni dille gider; pencere açıksa hemen gönderilir.
     */
    dilDegisti() {
      if (!canliMi()) return;
      try {
        pencere.setTitle(t('uygulama.yuzeyBaslik'));
        pencere.webContents.send('dil:degisti', { dil: dilAl ? dilAl() : (t.dil ?? 'tr') });
      } catch {
        gunluk('Hızlı panel dili güncellenemedi.');
      }
      if (gorunurMu()) modelGonder();
    },
    /**
     * o-20 / o-23: etkileşim ayarı (karoTekerlegi, panelSabit) değişti: açık sayfa `yuzey:etkilesim` ({ tekerlek, sabit }) ile haberdar edilir
     * (iğne düğmesi ve tekerlek anında güncellenir). Gizli ya da yüklenmemiş pencereye bir şey gönderilmez; sonraki gösterim yükü zaten taşır.
     */
    etkilesimDegisti() {
      const e = etkilesimDegeri();
      if (!e || !canliMi() || !yuklendi) return;
      try {
        pencere.webContents.send('yuzey:etkilesim', e);
      } catch {
        gunluk('Hızlı panel etkileşim ayarı gönderilemedi.');
      }
      // Sabitleme Ayarlar'dan kaldırıldı ve panel odaksız açık kaldıysa, sıradan odak kaybı kuralı yeniden işler (kısa gecikmeyle gizlenir).
      if (mod === 'panel' && !e.sabit && gorunurMu() && !pencere.isFocused()) odakKaybiniZamanla(pencere);
    },
    /** Durum deposu değişti: pencere açıksa modeli tazele. */
    modelDegisti() {
      if (gorunurMu()) modelGonder();
    },
    gorunurMu,
    kip: () => (gorunurMu() ? mod : null),
    /** Açık panel/palet penceresinin ekran sınırları (köşe bildirimi onunla çakışmasın, g-09); kapalıysa/okunamazsa null. */
    gorunenSinirlar() {
      if (!gorunurMu() || typeof pencere.getBounds !== 'function') return null;
      try {
        return pencere.getBounds();
      } catch {
        return null;
      }
    },
    kapat() {
      zaman.clearTimeout(yuklemeZamanlayicisi);
      odakKaybiniIptalEt();
      odakYedeginiIptalEt();
      disOnayiBirak();
      const eski = pencere;
      pencere = null;
      mod = null;
      kareleriTemizle();
      if (eski && !eski.isDestroyed()) eski.destroy();
    },
  };
}

module.exports = { YUZEY_HTML, YUZEY_ODAK_KAYBI_MS, YUZEY_ODAK_YEDEK_MS, yuzeyYoneticisiOlustur };
