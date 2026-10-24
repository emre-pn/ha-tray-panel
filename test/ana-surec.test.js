'use strict';

/**
 * Ana süreç (src/main.js) duman testi. Electron ÇALIŞTIRILMAZ, hiçbir pencere ya da iletişim kutusu açılmaz:
 * `electron` modülü Module._load ile bellek içi bir sahteyle değiştirilir, zamanlayıcılar ve Date node:test
 * sahte saatiyle yürür, ayarlar geçici bir klasöre yazılır (gerçek %APPDATA% kullanılmaz).
 *
 * Amaç: src/lib/ içindeki saf kararların main.js'teki durum makinesine doğru bağlandığını sınamak
 * (tepsi/odak kararı, mod -> kayıt yuvası, yerleştirme -> kayıt, did-fail-load -> durum sayfası, kısayol uyarıları,
 * yıkıcı eylem onayı, anında geri bildirim, çökme sınırı, oturum kapatma iptali, favori kaydı).
 * Sahte Chromium'u ya da Windows'u taklit etmez; yalnız main.js'in Electron'a yaptığı çağrıları kaydeder.
 * Ağ yok: `net.fetch` gerçek `Response` nesneleri döndüren bellek içi bir sahtedir; erişim anahtarı sahte bir değerdir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

/**
 * Bir klasör/dosya yolunun metne sızıp sızmadığı. JSON metninde Windows yolundaki her `\` karakteri `\\` olarak yazıldığı için
 * ham yolu `includes` ile aramak JSON'da hiçbir zaman eşleşmez; bu yüzden ham, JSON-kaçışlı ve eğik çizgili biçimlerin üçü de aranır.
 */
const yolSizdiMi = (metin, yol) => {
  const bicimler = [yol, JSON.stringify(yol).slice(1, -1), yol.replace(/\\/g, '/')];
  return bicimler.some((b) => b !== '' && metin.includes(b));
};

const { anahtarParmakIzi } = require('../src/lib/yetki-kesici');
const { simgePng } = require('../src/lib/tepsi-simgesi');
const ANA_SOZLUK = require('../src/lib/ceviri/ana');
/** Tepsi menüsündeki "Ayarlar…" öğesinin ve Ayarlar penceresi başlığının beş dildeki karşılıkları (arayüz dili hangisi olursa olsun bulunur). */
const AYARLAR_MENU_ADLARI = ['tr', 'en', 'de', 'fr', 'es'].map((dil) => ANA_SOZLUK[dil]['menu.ayarlar']);
const AYARLAR_BASLIK_DESENI = new RegExp(['tr', 'en', 'de', 'fr', 'es'].map((dil) => ANA_SOZLUK[dil]['uygulama.ayarlarBaslik'].split(' — ')[1]).join('|'));
const {
  ACILIS_HATASI_BILDIRIMI,
  AYARLAR_ART_ARDA_COKTU_BILDIRIMI,
  AYARLAR_COKTU_BILDIRIMI,
  AYAR_OKUNAMADI_BILDIRIMI,
  EPOSTA_ACILDI_METNI,
  TARAYICIDA_ACILDI_METNI,
  ayarDosyasiBozukMetni,
  semaDahaYeniMetni,
  eskiSurumYedegiMetni,
  ANAHTAR_DOGRULANAMADI_BILDIRIMI,
  ANAHTAR_DOGRULANAMADI_KISA_METNI,
  ANAHTAR_KAYIT_ONAYI_KISA_METNI,
  ANAHTAR_KAYIT_ONAYI_MENU_METNI,
  ANAHTAR_DOGRULANAMADI_MENU_METNI,
  ANAHTAR_KARANTINA_BILDIRIMI,
  ANAHTAR_KAYDI_REDDEDILDI_METNI,
  ANAHTAR_REDDEDILDI_BILDIRIMI,
  ANAHTAR_REDDEDILDI_KISA_METNI,
  ANAHTAR_REDDEDILDI_MENU_METNI,
  ANAHTAR_ZATEN_REDDEDILDI_METNI,
  ANAHTAR_SILINDI_METNI,
  AYAR_YAZILAMADI_METNI,
  HTTP_ANAHTAR_GUNLUK_SATIRI,
  HTTP_ANAHTAR_UYARISI,
  ONAY_BEKLIYOR_METNI,
  TEPSI_IPUCU_BILDIRIMI,
  YEREL_YASAK_BILDIRIMI,
  YEREL_YASAK_KISA_METNI,
  YEREL_YASAK_MENU_METNI,
  YETKI_KAYDI_OKUNAMADI_BILDIRIMI,
  YETKI_KAYDI_YAZILAMADI_BILDIRIMI,
} = require('../src/lib/bildirim-metni');

const { mock } = test;
const KOK_DIZIN = path.join(__dirname, '..');
const MAIN = path.join(KOK_DIZIN, 'src', 'main.js');
const AYARLAR_HTML = path.join(KOK_DIZIN, 'src', 'ayarlar.html');
const OFFLINE_HTML = path.join(KOK_DIZIN, 'src', 'offline.html');
const BASLANGIC_ZAMANI = 1_000_000;
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const SIFRE_ONEKI = 'SAHTE-DPAPI:'; // sahte safeStorage: gerçek şifreleme yok, düz metin değil ama gerçek anahtar da değil
const TEST_ANAHTAR = 'TEST_ANAHTAR_SAHTE_000000';

const akit = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((coz) => setImmediate(coz)); // söz zincirleri sonuçlansın
};

/** src/ altındaki modüller (main.js, yerel-pencere.js, kose-bildirim.js...) 'electron'u her yüklemede yeniden alsın. */
function onbellegiTemizle() {
  const kok = path.join(KOK_DIZIN, 'src') + path.sep;
  for (const anahtar of Object.keys(require.cache)) {
    if (anahtar.startsWith(kok)) delete require.cache[anahtar];
  }
}

function sahteElectronOlustur(durum) {
  class SahteWebContents extends EventEmitter {
    constructor() {
      super();
      this.url = '';
      this.yuklemeler = [];
      this.mesajlar = [];
      this.navigationHistory = { getAllEntries: () => [], getActiveIndex: () => 0, canGoToOffset: () => false, goToOffset() {} };
    }

    getURL() {
      return this.url;
    }

    loadFile(dosya, { query } = {}) {
      const adres = new URL(pathToFileURL(dosya).href);
      for (const [anahtar, deger] of Object.entries(query ?? {})) adres.searchParams.set(anahtar, deger);
      this.yuklemeler.push({ tur: 'dosya', url: adres.href });
      queueMicrotask(() => {
        this.url = adres.href;
        this.emit('did-navigate', {}, adres.href, 200);
        this.emit('did-finish-load');
      });
      return Promise.resolve();
    }

    loadURL(adres) {
      this.yuklemeler.push({ tur: 'url', url: adres }); // başarısızlık/başarı testte olayla bildirilir
      return Promise.resolve();
    }

    send(kanal, yuk) {
      this.mesajlar.push({ kanal, yuk });
    }

    setWindowOpenHandler(isleyici) {
      this.pencereAcmaIsleyicisi = isleyici; // son atanan geçerli (yerel pencerelerde "reddet", HA penceresinde HA için izin)
    }

    setZoomLevel() {}
    isDestroyed() {
      return durum.yikildi;
    }

    focus() {}
    isDevToolsFocused() {
      return false;
    }

    reload() {}
    reloadIgnoringCache() {}
  }

  class SahteBrowserWindow extends EventEmitter {
    static getFocusedWindow() {
      return durum.odakli;
    }

    constructor(secenekler) {
      super();
      this.secenekler = secenekler;
      this.webContents = new SahteWebContents();
      this.gorunur = false;
      this.odakta = false;
      this.simge = false;
      this.buyuk = false;
      this.tamEkran = false;
      this.sinirlar = { x: secenekler.x ?? 0, y: secenekler.y ?? 0, width: secenekler.width, height: secenekler.height };
      this.cagri = { show: 0, hide: 0, focus: 0, showInactive: 0 };
      this.vurgular = []; // setAccentColor çağrıları (gorunum-13)
      this.malzemeler = []; // setBackgroundMaterial çağrıları (gorunum-11)
      this.arkaPlanRenkleri = []; // setBackgroundColor çağrıları
      this.yikik = false; // test yardımcısı: bu pencere tek başına yok edildi
      durum.pencereler.push(this);
    }

    destroy() {
      this.yikik = true;
      this.gorunur = false;
      this.emit('closed');
    }

    /** Test yardımcısı: fiziksel odak kaybı (başka bir yere / görev çubuğuna tıklama). */
    odakKaybet() {
      if (!this.odakta) return;
      this.odakta = false;
      if (durum.odakli === this) durum.odakli = null;
      this.emit('blur');
    }

    isDestroyed() {
      return durum.yikildi || this.yikik; // test bitince true: arka plandaki yeniden deneme zincirleri sonlanır
    }

    isVisible() {
      return this.gorunur;
    }

    isMinimized() {
      return this.simge;
    }

    isMaximized() {
      return this.buyuk;
    }

    isFullScreen() {
      return this.tamEkran;
    }

    isFocused() {
      return this.odakta;
    }

    show() {
      this.gorunur = true;
      this.cagri.show += 1;
    }

    showInactive() {
      this.gorunur = true;
      this.cagri.showInactive += 1;
    }

    setIgnoreMouseEvents() {}

    hide() {
      this.gorunur = false;
      this.cagri.hide += 1;
      this.odakKaybet(); // Windows'ta gizlenen odaklı pencere blur üretir
    }

    focus() {
      this.cagri.focus += 1;
      this.odakta = true;
      durum.odakli = this;
      this.emit('focus');
    }

    restore() {
      this.simge = false;
    }

    maximize() {
      this.buyuk = true;
    }

    unmaximize() {
      this.buyuk = false;
    }

    setFullScreen(deger) {
      this.tamEkran = !!deger;
    }

    setBounds(sinirlar) {
      this.sinirlar = { ...sinirlar };
    }

    getBounds() {
      return { ...this.sinirlar };
    }

    getNormalBounds() {
      return { ...this.sinirlar };
    }

    setTitle(baslik) {
      this.sonBaslik = baslik;
    }
    setAccentColor(renk) {
      this.vurgular.push(renk);
    }

    setBackgroundMaterial(malzeme) {
      this.malzemeler.push(malzeme);
    }

    setBackgroundColor(renk) {
      this.arkaPlanRenkleri.push(renk);
    }

    setAlwaysOnTop(deger, seviye) {
      (this.ustCagrilari ??= []).push([deger, seviye]); // 1.4.0 (o-22, o-33): üstte tutma çağrıları
    }

    setOpacity(oran) {
      (this.opakliklar ??= []).push(oran); // 1.4.0 (o-32)
    }

    setContentProtection(deger) {
      (this.korumalar ??= []).push(deger); // 1.4.0 (o-48 kamera): ekran görüntüsü / ekran kaydı koruması
    }

    moveTop() {
      this.cagri.moveTop = (this.cagri.moveTop ?? 0) + 1;
    }

    loadFile(...bagimsizDegiskenler) {
      return this.webContents.loadFile(...bagimsizDegiskenler);
    }

    loadURL(...bagimsizDegiskenler) {
      return this.webContents.loadURL(...bagimsizDegiskenler);
    }
  }

  class SahteTray extends EventEmitter {
    constructor(ilkSimge) {
      super();
      durum.tepsi = this;
      this.simgeler = [ilkSimge]; // new Tray(simge) ve setImage çağrıları, sırayla
      this.ipuclari = []; // setToolTip çağrıları, sırayla (detay-18)
    }

    setToolTip(metin) {
      this.ipuclari.push(metin);
    }

    setImage(simge) {
      this.simgeler.push(simge);
    }

    isDestroyed() {
      return durum.yikildi;
    }

    getBounds() {
      return { x: 1850, y: 1000, width: 24, height: 24 };
    }

    popUpContextMenu(menu) {
      this.sonMenu = menu;
    }
  }

  const bolumOturumlari = new Map();
  // Oturumun izin işleyicileri kaydedilir (h-36): test, istekleri doğrudan işleyicilere verir.
  const oturum = (ad = 'varsayilan') => {
    const kayit = { ad, istek: null, denetim: null, cihaz: null, yazimAcik: undefined, yazimDilleri: undefined, sira: [] }; // sira: oturum çağrılarının sırası (o-42: yazım denetimi ilk kullanımdan önce kapanır)
    durum.oturumlar.push(kayit);
    return {
      setSpellCheckerEnabled(deger) {
        kayit.sira.push('yazim-acik');
        kayit.yazimAcik = deger;
      },
      setSpellCheckerLanguages(diller) {
        kayit.sira.push('yazim-diller');
        kayit.yazimDilleri = diller;
      },
      setPermissionRequestHandler(isleyici) {
        kayit.sira.push('izin');
        kayit.istek = isleyici;
      },
      setPermissionCheckHandler(isleyici) {
        kayit.denetim = isleyici;
      },
      setDevicePermissionHandler(isleyici) {
        kayit.cihaz = isleyici;
      },
      // 1.4.0 bağlantı grubu (o-56): sertifika doğrulama kancası (yalnız kayıt varken kurulur; null kaldırır)
      setCertificateVerifyProc(isleyici) {
        kayit.sertifikaProc = isleyici;
      },
      // 1.4.0 bağlantı grubu (o-55): özel üstbilgi kancası. Gerçek Electron gibi onBeforeSendHeaders(null) kancayı kaldırır.
      webRequest: {
        onBeforeSendHeaders(filtre, dinleyici) {
          kayit.ustbilgiFiltresi = dinleyici === undefined ? null : filtre;
          kayit.ustbilgiDinleyici = dinleyici === undefined ? null : dinleyici;
        },
      },
      flushStorageData() {},
    };
  };

  const app = Object.assign(new EventEmitter(), {
    isPackaged: durum.paketli === true, // varsayılan false: kayıt defterine/oturum açılışına hiçbir şey yazılmaz (paketli: taşınabilir derleme sınaması, o-45)
    setName() {},
    getVersion: () => durum.surum ?? '1.3.0',
    getLocale: () => durum.sistemDili ?? 'tr-TR', // işletim sistemi dili (arayüz dili "sistem" iken kullanılır)
    getPath: (ad) => {
      if (ad === 'appData') return durum.appData;
      if (ad === 'logs') return path.join(durum.appData, 'gunlukler'); // gerçek %APPDATA% değil, geçici klasör
      if (ad === 'documents') return path.join(durum.appData, 'Belgeler'); // Ayarlar dışa/içe aktarma diyaloğunun açılış klasörü
      if (ad === 'home') return durum.appData; // kullanıcı klasörü (gerçekte appData onun içindedir): komut satırı --cikti yolu doğrulaması (o-19)
      return durum.yollar.get(ad);
    },
    setPath(ad, yol) {
      durum.yollar.set(ad, yol);
      if (ad === 'userData' && durum.yerelDosyalar) {
        // %LOCALAPPDATA%<veri klasörü>: yetki kesicinin FARKLI klasördeki yedek kaydı (gerçek %LOCALAPPDATA% değil, geçici klasör)
        const yerel = path.join(process.env.LOCALAPPDATA, path.basename(yol));
        fs.mkdirSync(yerel, { recursive: true });
        for (const [dosyaAdi, icerik] of Object.entries(durum.yerelDosyalar)) fs.writeFileSync(path.join(yerel, dosyaAdi), icerik, 'utf8');
      }
      if (ad === 'userData' && (durum.tohum || durum.anahtarTohumu || durum.ekDosyalar)) {
        fs.mkdirSync(yol, { recursive: true });
        if (durum.tohum) fs.writeFileSync(path.join(yol, 'ayarlar.json'), JSON.stringify(durum.tohum), 'utf8');
        for (const [dosyaAdi, icerik] of Object.entries(durum.ekDosyalar ?? {})) fs.writeFileSync(path.join(yol, dosyaAdi), icerik, 'utf8');
        if (durum.anahtarTohumu) fs.writeFileSync(path.join(yol, 'anahtar.dat'), Buffer.from(SIFRE_ONEKI + TEST_ANAHTAR));
      }
    },
    setAppLogsPath() {},
    setAppUserModelId() {},
    requestSingleInstanceLock: () => true,
    // 1.4.0 dis grubu (o-21, o-54): Jump List ve evpaneli:// kaydı yalnız kaydedilir (görev çubuğuna / kayıt defterine hiçbir şey yazılmaz).
    setJumpList(plan) {
      (durum.jumpListler ??= []).push(plan);
      return 'ok';
    },
    isDefaultProtocolClient: () => durum.protokolBizim === true,
    setAsDefaultProtocolClient(...a) {
      (durum.protokolCagrilari ??= []).push(['kaydet', ...a]);
      durum.protokolBizim = true;
      return true;
    },
    removeAsDefaultProtocolClient(...a) {
      (durum.protokolCagrilari ??= []).push(['kaldir', ...a]);
      durum.protokolBizim = false;
      return true;
    },
    whenReady: () => durum.hazirSoz ?? Promise.resolve(), // hazirBekle: test "ready" olayını kendisi verir
    quit() {
      durum.cikisIstendi = true;
    },
    setLoginItemSettings(secenek) {
      if (!durum.paketli) throw new Error('oturum açılışı yazılmamalı');
      durum.oturumYazimlari.push(secenek);
    },
    getLoginItemSettings(secenek) {
      if (!durum.paketli) throw new Error('oturum açılışı okunmamalı');
      durum.oturumOkumalari.push(secenek);
      return { executableWillLaunchAtLogin: false, launchItems: [] };
    },
  });

  // Windows bildirimleri kaydedilir (hiz-04: yalnız hatada çıkmalı).
  class SahteBildirim extends EventEmitter {
    constructor(secenek) {
      super();
      this.secenek = secenek;
      durum.bildirimNesneleri.push(this); // test, bildirime tıklamayı emit('click') ile taklit eder (k-10)
    }

    show() {
      // Ev içi adres http iken açılışta bir kez çıkan uyarı ayrı kanala yazılır: "yalnız hatada bildirim" denetimleri
      // bununla karışmasın (uyarının kendisi aşağıda ayrıca sınanır).
      (this.secenek.body === HTTP_ANAHTAR_UYARISI ? durum.httpUyarilari : durum.bildirimler).push(this.secenek);
    }

    static isSupported() {
      return true;
    }
  }

  return {
    app,
    BrowserWindow: SahteBrowserWindow,
    Menu: {
      setApplicationMenu() {},
      // Bağlam menüsü (karo sağ tık, 1.4.0): popup testin durum.menuPopup işleviyle yönetilir; tanımsızsa menü hemen kapanır. Dizi aynen döner.
      buildFromTemplate: (sablon) =>
        Object.defineProperty(sablon, 'popup', { configurable: true, enumerable: false, value: (secenek) => (durum.menuPopup ? durum.menuPopup(sablon, secenek) : secenek?.callback?.()) }),
    },
    Notification: SahteBildirim,
    dialog: {
      async showMessageBox(secenek) {
        durum.diyaloglar.push(secenek);
        if (durum.diyalogBekletici) await durum.diyalogBekletici; // test, pencereyi "açık" tutmak için bir söz verebilir
        return { response: durum.diyalogYaniti };
      },
      // Ayarlar (k-02, k-13): kapatma uyarısı eşzamanlı sorulur (0 = Kapat, 1 = Vazgeç); dosya diyalogları testin verdiği seçimi döner.
      showMessageBoxSync(_pencere, secenek) {
        durum.diyaloglar.push(secenek);
        return durum.senkronDiyalogYaniti ?? 1;
      },
      async showSaveDialog(_pencere, secenek) {
        (durum.dosyaDiyaloglari ??= []).push({ tur: 'kaydet', secenek });
        return durum.dosyaSecimi ?? { canceled: true };
      },
      async showOpenDialog(_pencere, secenek) {
        (durum.dosyaDiyaloglari ??= []).push({ tur: 'ac', secenek });
        return durum.dosyaSecimi ?? { canceled: true, filePaths: [] };
      },
    },
    Tray: SahteTray,
    globalShortcut: {
      register(tus, geriCagir) {
        if (durum.reddedilenKisayollar.has(tus)) return false;
        // Gerçek Electron gibi: uygulamanın kendi kaydettiği bir tuş yeniden kaydedilemez (false döner; h-26 takas senaryosu).
        if (durum.kisayollar.has(tus)) return false;
        durum.kisayollar.set(tus, geriCagir);
        return true;
      },
      unregister: (tus) => durum.kisayollar.delete(tus),
      unregisterAll: () => durum.kisayollar.clear(),
    },
    ipcMain: {
      handle: (kanal, isleyici) => durum.ipc.set(kanal, isleyici),
      on: (kanal, isleyici) => durum.ipc.set(kanal, isleyici),
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
      createFromBuffer: (veri, secenek) => ({ isEmpty: () => false, veri, secenek }), // 1.4.0 (o-27): rozetli tepsi simgesi PNG'si
    },
    nativeTheme: durum.nativeTheme, // themeSource atamaları gorunum-13 testinde okunur
    net: {
      async fetch(url, secenek = {}) {
        durum.fetchler.push({ url, yontem: secenek.method ?? 'GET', basliklar: secenek.headers, govde: secenek.body });
        if (url.endsWith('/manifest.json')) {
          const kod = typeof durum.yoklamaDurumu === 'function' ? durum.yoklamaDurumu(url) : durum.yoklamaDurumu; // işlev: adres başına yanıt
          if (kod === null) throw new Error('ağ yok');
          const tamam = kod >= 200 && kod < 300;
          return new Response(tamam ? HA_MANIFEST : '', { status: kod });
        }
        return durum.apiYaniti(url, secenek);
      },
    },
    powerMonitor: new EventEmitter(),
    safeStorage: {
      isEncryptionAvailable: () => durum.sifrelemeYok !== true, // o-61: test, safeStorage'ın kullanılamadığı makineyi taklit edebilir
      isAsyncEncryptionAvailable: async () => durum.sifrelemeYok !== true,
      encryptStringAsync: async (metin) => Buffer.from(SIFRE_ONEKI + metin),
      decryptStringAsync: async (veri) => ({ result: veri.toString('utf8').slice(SIFRE_ONEKI.length), shouldReEncrypt: false }),
      encryptString: (metin) => Buffer.from(SIFRE_ONEKI + metin),
      decryptString: (veri) => veri.toString('utf8').slice(SIFRE_ONEKI.length),
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: durum.calismaAlani, bounds: durum.calismaAlani }),
      // 1.4.0 pencere grubu (o-32, o-33): bağlı ekranlar (varsayılan tek ekran) ve ekran olayları
      getAllDisplays: () => durum.ekranlar ?? [{ id: 1, bounds: durum.calismaAlani, workArea: durum.calismaAlani, scaleFactor: 1 }],
      getPrimaryDisplay: () => (durum.ekranlar ?? [{ id: 1, bounds: durum.calismaAlani, workArea: durum.calismaAlani, scaleFactor: 1 }])[0],
      on(olay, dinleyici) {
        (durum.ekranDinleyicileri[olay] ??= []).push(dinleyici);
      },
    },
    // Gerçek Electron gibi aynı bölüm adı aynı oturumu döner (o-42: yazım denetimi kapatma ile izin işleyicileri aynı nesnede görünür).
    session: { fromPartition: (ad) => (bolumOturumlari.has(ad) ? bolumOturumlari.get(ad) : bolumOturumlari.set(ad, oturum(ad)).get(ad)), defaultSession: oturum() },
    clipboard: {
      writeText(metin) {
        if (durum.panoHatasi) throw new Error('pano kullanılamıyor');
        durum.pano.push(metin);
      },
    },
    shell: {
      showItemInFolder(yol) {
        durum.klasordeGosterilenler.push(yol);
      },
      openPath: async (yol) => {
        durum.acilanKlasorler.push(yol);
        return ''; // gerçek Electron: boş dize = başarı
      },
      openExternal: async (adres) => {
        if (durum.disariAcmaHatasi) throw new Error('açılamadı'); // varsayılan tarayıcı yok / engellendi
        durum.disariAcilanlar.push(adres);
      },
      beep() {
        durum.bip += 1;
      },
    },
  };
}

/**
 * Sahte WebSocket (Node 24'te global WebSocket vardır: sahtelenmezse main.js GERÇEK ağ bağlantısı denerdi).
 * Soket varsayılan olarak hiç açılmaz (canlı bağlantı kurulamıyor gibi); test sunucu tarafını yayinla()/kopar() ile yönetir.
 */
function sahteWebSocketOlustur(durum) {
  return class SahteWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.gonderilen = [];
      this.kapatildi = false;
      this.dinleyiciler = {};
      durum.soketler.push(this);
    }

    addEventListener(ad, fn) {
      (this.dinleyiciler[ad] ??= []).push(fn);
    }

    send(metin) {
      this.gonderilen.push(JSON.parse(metin));
    }

    close() {
      this.kapatildi = true;
      this.readyState = 3;
    }

    yayinla(ileti) {
      for (const fn of this.dinleyiciler.message ?? []) fn({ data: typeof ileti === 'string' ? ileti : JSON.stringify(ileti) });
    }

    kopar() {
      this.readyState = 3;
      for (const fn of this.dinleyiciler.close ?? []) fn({});
    }
  };
}

/**
 * main.js'i sahte Electron ile yükler ve hazır olmasını bekler.
 * @param {{tohum?: object, calismaAlani?: object, yoklama?: number|null, anahtar?: boolean, kisayolReddi?: string[], ha?: object[], hazirBekle?: boolean}} secenek
 *   tohum: ayarlar.json'a önceden yazılacak ham ayar; yoklama: /manifest.json yanıt kodu (null: ağ yok);
 *   ekDosyalar: veri klasörüne önceden yazılacak ek dosyalar ({ ad: metin }); anahtar: sahte (şifreli biçimde) bir erişim anahtarı dosyası yazılsın; hazirBekle: app "ready" olmadan yüklenir (durum.hazirCoz() ile hazır olur)
 */
async function ortamKur({ paketli = false, tohum = null, ekDosyalar = null, calismaAlani = { x: 0, y: 0, width: 1920, height: 1040 }, ekranlar = null, yoklama = null, anahtar = false, kisayolReddi = [], ha = null, apiYaniti = null, hazirBekle = false, osSurumu = '10.0.26300', yerelDosyalar = null, acilisArgv = null, oncesi = null } = {}) {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-test-'));
  const oncekiYerelAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(gecici, 'LocalAppData'); // gerçek %LOCALAPPDATA%'ya hiçbir şey yazılmasın
  const durum = {
    paketli, // app.isPackaged (varsayılan false)
    oturumYazimlari: [], // app.setLoginItemSettings çağrıları (yalnız paketli)
    oturumOkumalari: [],
    yerelDosyalar,
    appData: gecici,
    yollar: new Map(),
    tohum,
    ekDosyalar,
    anahtarTohumu: anahtar,
    pencereler: [],
    odakli: null,
    tepsi: null,
    ipc: new Map(),
    kisayollar: new Map(),
    reddedilenKisayollar: new Set(kisayolReddi), // başka uygulamanın aldığı kısayollar (açılıştan itibaren)
    calismaAlani,
    ekranlar, // 1.4.0 (o-32, o-33): null = tek ekran; ya da screen.getAllDisplays() biçiminde liste
    ekranDinleyicileri: {}, // screen.on(olay, dinleyici)
    yoklamaDurumu: yoklama, // null: ağ hatası; sayı: /manifest.json yanıt kodu
    // Testler kendi HA yanıtlarını verir (haKur). Varsayılan: yetki kesicinin tek doğrulama isteği (GET /api/) geçer, gerisi 404.
    apiYaniti: (url, secenek) => (new URL(url).pathname === '/api/' && (secenek.method ?? 'GET') === 'GET' ? new Response(JSON.stringify({ message: 'API running.' }), { status: 200 }) : new Response('{}', { status: 404 })),
    fetchler: [],
    soketler: [], // sahte WebSocket örnekleri (canlı bağlantı)
    bildirimler: [], // Windows bildirimleri
    bildirimNesneleri: [], // oluşturulan tüm Notification örnekleri (tıklama taklidi için; k-10)
    oturumlar: [], // session.fromPartition / defaultSession izin işleyicileri (h-36)
    disariAcilanlar: [], // shell.openExternal adresleri (k-20)
    pano: [], // clipboard.writeText metinleri (o-41)
    klasordeGosterilenler: [], // shell.showItemInFolder yolları (o-41)
    acilanKlasorler: [], // shell.openPath yolları (o-41)
    ekMocklar: [], // oncesi seçeneğinin kurduğu mock'lar; temizle geri alır
    httpUyarilari: [], // "ev içi adres http" açılış uyarısı (Windows bildirimi)
    diyaloglar: [], // dialog.showMessageBox çağrıları
    diyalogYaniti: 1, // 0 = "Çalıştır", 1 = "Vazgeç"
    bip: 0,
    nativeTheme: { themeSource: 'system' }, // sahte nativeTheme
    cikisIstendi: false,
    yikildi: false,
    hazirSoz: null, // hazirBekle: app.whenReady() bu sözü bekler; durum.hazirCoz() uygulamayı "hazır" yapar
    hazirCoz: null,
  };
  if (hazirBekle) {
    durum.hazirSoz = new Promise((coz, reddet) => {
      durum.hazirCoz = coz;
      durum.hazirReddet = reddet; // açılış zincirinin hatasını taklit eder (h-37)
    });
  }
  if (apiYaniti) durum.apiYaniti = apiYaniti; // ha'dan farklı (ör. 401/403 dönen) sahte HA: main.js yüklenmeden önce
  if (ha) haKur(durum, ha); // açılış isteklerinin (hazır liste, durum yenileme) de sahte HA'ya gitmesi için main.js yüklenmeden önce
  const sahte = sahteElectronOlustur(durum);
  // Windows sürümü sahtelenir: pencere malzemesi (gorunum-11) test makinesinin gerçek sürümüne bağlı olmasın.
  const osSurumuSahtesi = mock.method(os, 'release', () => osSurumu);

  if (oncesi) durum.ekMocklar.push(...[].concat(oncesi(durum) ?? [])); // main.js yüklenmeden önce (ör. fs hata enjeksiyonu)
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: BASLANGIC_ZAMANI });
  const orijinalYukle = Module._load;
  Module._load = function sahteYukle(istek, ...gerisi) {
    return istek === 'electron' ? sahte : orijinalYukle.call(this, istek, ...gerisi);
  };
  const orijinalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = sahteWebSocketOlustur(durum); // main.js yüklenmeden ÖNCE: ha-ws.js varsayılanı yükleme anında okur
  onbellegiTemizle();
  const logOrijinal = console.log;
  console.log = () => {}; // main.js günlüğü test çıktısını kirletmesin (temizle geri alır)
  // main.js süreç düzeyinde hata dinleyicileri ekler; testler arasında birikmesin diye temizlenir.
  const oncekiDinleyiciler = {
    uncaughtException: process.listeners('uncaughtException'),
    unhandledRejection: process.listeners('unhandledRejection'),
  };
  const dinleyicileriKaldir = () => {
    for (const [olay, onceki] of Object.entries(oncekiDinleyiciler)) {
      for (const dinleyici of process.listeners(olay)) if (!onceki.includes(dinleyici)) process.off(olay, dinleyici);
    }
  };
  const oncekiArgv = process.argv;
  if (acilisArgv) process.argv = ['ev-paneli.exe', ...(typeof acilisArgv === 'function' ? acilisArgv(gecici) : acilisArgv)]; // uygulama `--eylem ...` ile açılıyorsa (main.js yüklenirken okunur); işlev: geçici klasörü alır
  let anaModul = null;
  try {
    anaModul = require(MAIN);
    process.argv = oncekiArgv;
    await akit();
  } catch (hata) {
    process.argv = oncekiArgv;
    console.log = logOrijinal;
    globalThis.WebSocket = orijinalWebSocket;
    mock.timers.reset();
    osSurumuSahtesi.mock.restore();
    for (const m of durum.ekMocklar) m.mock.restore();
    dinleyicileriKaldir();
    if (oncekiYerelAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = oncekiYerelAppData;
    fs.rmSync(gecici, { recursive: true, force: true }); // kurulum fırlatırsa geçici klasör %TEMP% altında artık kalmaz
    throw hata;
  } finally {
    Module._load = orijinalYukle;
  }

  const ayarYolu = () => path.join(durum.yollar.get('userData'), 'ayarlar.json');
  const ortam = {
    durum,
    app: sahte.app,
    guc: sahte.powerMonitor, // uyku/uyanış/kilit olayları (suspend, resume, unlock-screen)
    anaModul, // require(MAIN) dışa açtığı işlevler (acikHaSayfasiYolu; k-18)
    pencere: durum.pencereler[0],
    tepsi: durum.tepsi,
    ayarOku: () => JSON.parse(fs.readFileSync(ayarYolu(), 'utf8')),
    gunlukOku: () => {
      try {
        return fs.readFileSync(path.join(gecici, 'gunlukler', 'ev-paneli.log'), 'utf8');
      } catch {
        return '';
      }
    },
    ilerle(ms) {
      mock.timers.tick(ms);
    },
    akit,
    /** Tepsi sağ tık menüsünden etiketle bir ÜST DÜZEY öğe bulur. */
    menuOgesi(etiket) {
      durum.tepsi.emit('right-click');
      return durum.tepsi.sonMenu.find((oge) => oge.label === etiket);
    },
    /** Tepsi sağ tık menüsünün tüm öğeleri (altmenüler düzleştirilmiş): { oge, ust } — ust: altmenünün etiketi ya da null. */
    menuAgaci() {
      durum.tepsi.emit('right-click');
      const sonuc = [];
      for (const oge of durum.tepsi.sonMenu) {
        sonuc.push({ oge, ust: null });
        for (const alt of oge.submenu ?? []) sonuc.push({ oge: alt, ust: oge.label });
      }
      return sonuc;
    },
    /** Hızlı panel / palet penceresi (Dalga 3): başlığıyla bulunur. */
    yuzeyPenceresi: () => durum.pencereler.find((p) => /Hızlı Panel|Quick Panel/.test(p.secenekler.title ?? '') && !p.yikik),
    /** main.js'in süreç düzeyinde eklediği dinleyiciler (uncaughtException / unhandledRejection). */
    surecDinleyicileri: (olay) => process.listeners(olay).filter((d) => !oncekiDinleyiciler[olay].includes(d)),
    /** Ayarlar penceresi (başlıkla bulunur: köşe bildirimi gibi başka pencereler araya girebilir). */
    ayarlarPenceresi: () => durum.pencereler.find((p) => AYARLAR_BASLIK_DESENI.test(p.secenekler.title ?? '')),
    /** Köşe bildirimi penceresi (odak almayan, çerçevesiz küçük pencere). */
    kosePenceresi: () => durum.pencereler.find((p) => p.secenekler.focusable === false),
    /** Ana pencere: şu an yok edilmemiş, başlıksız-ayarsız ilk uygun pencere. */
    anaPencere: () => durum.pencereler.find((p) => p.secenekler.minWidth === 480 && !p.yikik),
    async temizle() {
      durum.yikildi = true;
      await akit(); // arka plandaki söz zincirleri sahte saat açıkken bitsin (gerçek zamanlayıcı sızmasın)
      console.log = logOrijinal;
      globalThis.WebSocket = orijinalWebSocket;
      mock.timers.reset();
      osSurumuSahtesi.mock.restore();
      for (const m of durum.ekMocklar) m.mock.restore();
      dinleyicileriKaldir();
      onbellegiTemizle();
      if (oncekiYerelAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = oncekiYerelAppData;
      fs.rmSync(gecici, { recursive: true, force: true });
    },
    /** %LOCALAPPDATA%<veri klasörü> (yetki kesicinin farklı klasördeki yedek kaydı; testte geçici klasör). */
    yerelKlasor: () => path.join(gecici, 'LocalAppData', path.basename(durum.yollar.get('userData'))),
  };
  return ortam;
}

function ortamda(ad, secenek, govde) {
  test(ad, async () => {
    const ortam = await ortamKur(secenek);
    try {
      await govde(ortam);
    } finally {
      await ortam.temizle();
    }
  });
}

const ctrlW = { type: 'keyDown', code: 'KeyW', key: 'w', control: true, alt: false, shift: false, meta: false };
const tusBas = (pencere, girdi) => pencere.webContents.emit('before-input-event', { preventDefault() {} }, girdi);

// ---------------------------------------------------------------------------

ortamda('açılış: sahte Electron ile main.js yüklenir, panel gösterilir ve odak alır', undefined, ({ pencere, durum }) => {
  assert.equal(durum.pencereler.length, 1);
  assert.equal(pencere.gorunur, true);
  assert.equal(pencere.odakta, true);
  assert.ok(durum.kisayollar.has('Control+Alt+H'));
});

// --- Tepsi tıklaması (bulgu 1) ---------------------------------------------

ortamda('tepsi: "Dışarı tıklayınca gizle" KAPALIYKEN odaktaki panel tepsi tıklamasıyla gizlenir', { tohum: { odakKaybindaGizle: false, tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle }) => {
  ilerle(400); // gösterim sonrası ön plan yedek zamanlayıcısı geçsin
  assert.equal(pencere.gorunur, true);
  pencere.odakKaybet(); // tepsi tıklaması odağı görev çubuğuna alır
  ilerle(100);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, false);
  assert.equal(pencere.cagri.show, 1, 'yeniden öne alınmamalı');
});

ortamda('tepsi: ayar kapalıyken arkada kalmış (uzun süre önce odağı kaybetmiş) panel öne getirilir', { tohum: { odakKaybindaGizle: false, tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle }) => {
  ilerle(400);
  pencere.odakKaybet();
  ilerle(5000);
  const odakOnce = pencere.cagri.focus;
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
  assert.equal(pencere.cagri.hide, 0);
  assert.equal(pencere.cagri.focus, odakOnce + 1);
  assert.equal(pencere.odakta, true);
});

ortamda('tepsi: ayar kapalıyken gizliyken tıklamak açar', { tohum: { odakKaybindaGizle: false, tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle }) => {
  ilerle(400);
  tusBas(pencere, ctrlW);
  assert.equal(pencere.gorunur, false);
  ilerle(5000);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
});

ortamda('tepsi: ayar AÇIKKEN (varsayılan) tıklama hâlâ gizler', { tohum: { tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle }) => {
  ilerle(400);
  pencere.odakKaybet(); // 180 ms'lik gizleme zamanlayıcısı bekliyor
  ilerle(100);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, false);
  ilerle(1000); // bekleyen zamanlayıcı iptal edildi: ikinci kez gizleme/açma olmamalı
  assert.equal(pencere.gorunur, false);
  assert.equal(pencere.cagri.show, 1);
});

ortamda('tepsi: Ctrl+W ile gizledikten hemen sonra tıklamak paneli açar (gizlemenin kendi blur olayı "odaktaydı" sayılmaz)', { tohum: { odakKaybindaGizle: false, tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle }) => {
  ilerle(400);
  tusBas(pencere, ctrlW); // odaklı pencere gizlenir, sahte blur üretir
  assert.equal(pencere.gorunur, false);
  ilerle(100);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
});

// --- Pencere boyutu kaydı (bulgu 2 ve 4) -------------------------------------

const GENIS_KAYITLI = { pencere: { hizli: { width: 560, height: 780 }, genis: { width: 1000, height: 700, maximized: true } } };

ortamda('boyut: mod pencere GİZLİYKEN değişince çıkışta eski modun boyutu yeni modun yuvasını ezmez', { tohum: GENIS_KAYITLI }, ({ pencere, app, ayarOku, ilerle, menuOgesi }) => {
  ilerle(400);
  tusBas(pencere, ctrlW); // gizli
  assert.equal(pencere.gorunur, false);
  menuOgesi('Geniş pencere').click({ checked: true });
  assert.equal(ayarOku().pencereBoyutu, 'genis');
  app.emit('before-quit'); // çıkış / oturum kapanışı: zorla kayıt
  const ayar = ayarOku();
  assert.deepEqual(ayar.pencere.genis, { width: 1000, height: 700, maximized: true });
  assert.deepEqual(ayar.pencere.hizli, { width: 560, height: 780 });
});

ortamda('yakınlaştırma: 500 ms dolmadan çıkılırsa bekleyen yazım boşaltılır ve yeni düzey ayar dosyasına gider', undefined, ({ pencere, app, ayarOku, ilerle }) => {
  ilerle(400);
  pencere.webContents.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200); // HA sayfasında (yakınlaştırma yalnız orada)
  const eksi = { type: 'keyDown', code: 'Minus', key: '-', control: true, alt: false, shift: false, meta: false };
  const onceki = ayarOku().yakinlastirma;
  tusBas(pencere, eksi);
  assert.equal(ayarOku().yakinlastirma, onceki, '500 ms dolmadan diskte hâlâ eski düzey (gecikmeli yazım)');
  pencere.tamEkran = true; // pencere kaydı yazmadan döner (tam ekran ya da boyut/konum değişmedi): yakınlaştırmayı yalnız bekleyen yazım diske götürebilir
  app.emit('before-quit');
  assert.equal(ayarOku().yakinlastirma, onceki - 0.5, 'çıkışta bekleyen yazım diske gitti');
});

ortamda('boyut: mod gizliyken değişince bir sonraki gösterimde yeni modun boyutu ve büyütülmüş durumu uygulanır', { tohum: { ...GENIS_KAYITLI, tepsiSolTik: 'pencere' } }, ({ pencere, tepsi, ilerle, menuOgesi }) => {
  ilerle(400);
  tusBas(pencere, ctrlW);
  menuOgesi('Geniş pencere').click({ checked: true });
  ilerle(5000);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
  assert.deepEqual({ w: pencere.sinirlar.width, h: pencere.sinirlar.height }, { w: 1000, h: 700 });
  assert.equal(pencere.buyuk, true);
});

ortamda('boyut: görünür pencerede mod değişince eski modun boyutu eski yuvada, yenisi yeni yuvada kalır', undefined, ({ pencere, ayarOku, ilerle, menuOgesi }) => {
  ilerle(900); // ilk yerleştirmenin sessizliği bitsin
  pencere.setBounds({ x: 10, y: 10, width: 600, height: 700 }); // kullanıcı hızlı modda yeniden boyutlandırdı
  pencere.emit('resize');
  ilerle(600); // gecikmeli kayıt
  assert.deepEqual(ayarOku().pencere.hizli, { width: 600, height: 700 });
  menuOgesi('Geniş pencere').click({ checked: true });
  const ayar = ayarOku();
  assert.deepEqual(ayar.pencere.hizli, { width: 600, height: 700 });
  assert.deepEqual(ayar.pencere.genis, { width: 1280, height: 820, maximized: false });
  assert.equal(pencere.sinirlar.width, 1280);
  ilerle(900);
  pencere.emit('resize'); // yerleştirme sonrası olay: geniş yuvaya (hedefte kaldığı için değişmeden) yazılır, hızlı bozulmaz
  ilerle(600);
  const sonra = ayarOku();
  assert.deepEqual(sonra.pencere.hizli, { width: 600, height: 700 });
  assert.deepEqual(sonra.pencere.genis, { width: 1280, height: 820, maximized: false });
});

ortamda(
  'boyut: küçük monitörde kısılan boyut gizlenirken kullanıcı boyutu gibi kaydedilmez',
  {
    tohum: { pencereBoyutu: 'genis', pencere: { hizli: { width: 560, height: 780 }, genis: { width: 1280, height: 820, maximized: false } } },
    calismaAlani: { x: 0, y: 0, width: 1366, height: 728 },
  },
  ({ pencere, ayarOku, ilerle }) => {
    assert.equal(pencere.sinirlar.height, 680, 'çalışma alanına kısılmalı');
    ilerle(900); // yerleştirme sessizliği bitsin
    tusBas(pencere, ctrlW); // gizlemede zorla kayıt
    assert.deepEqual(ayarOku().pencere.genis, { width: 1280, height: 820, maximized: false });

    // Kullanıcı gerçekten yeniden boyutlandırırsa kaydedilir.
    pencere.setBounds({ x: 0, y: 0, width: 1000, height: 600 });
    pencere.emit('resize');
    ilerle(600);
    assert.deepEqual(ayarOku().pencere.genis, { width: 1000, height: 600, maximized: false });
  },
);

// --- did-fail-load -> durum sayfası (bulgu 3) --------------------------------

ortamda('çevrimdışı ekran: yoklama geçse de sayfa yüklemesi düşerse durum sayfası yeniden yüklenir (yerinde güncelleme ölü sayfaya gitmez)', undefined, async ({ pencere, durum, ilerle, akit: bekleAkit }) => {
  const wc = pencere.webContents;
  const dosyaYuklemeleri = () => wc.yuklemeler.filter((y) => y.tur === 'dosya').length;
  assert.match(wc.getURL(), /offline\.html/); // yoklama başarısız: durum sayfası hazır, çevrimdışı durumu yerinde bildirildi
  assert.ok(wc.mesajlar.some((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi'));

  durum.yoklamaDurumu = 200; // yoklama geçer ama ana sayfa yüklemesi düşecek
  ilerle(2000); // ilk yeniden deneme
  await bekleAkit();
  const urlYuklemesi = wc.yuklemeler.filter((y) => y.tur === 'url');
  assert.equal(urlYuklemesi.length, 1);
  assert.equal(urlYuklemesi[0].url, 'http://192.168.1.10:8123/');

  const oncekiDosya = dosyaYuklemeleri();
  const oncekiMesaj = wc.mesajlar.filter((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi').length;
  wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://192.168.1.10:8123/', true);
  await bekleAkit();
  assert.equal(dosyaYuklemeleri(), oncekiDosya + 1, 'durum sayfası loadFile ile yeniden yüklenmeli');
  assert.equal(
    wc.mesajlar.filter((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi').length,
    oncekiMesaj,
    'ölü sayfaya yerinde güncelleme gönderilmemeli',
  );
});

ortamda('çevrimdışı ekran: "Hareketi azalt" ayarı açıksa durum sayfası sorgusuna ve yerinde güncelleme yüküne hareket=azalt eklenir; kapalıyken alan yok', { tohum: { hareketiAzalt: true } }, async ({ pencere, ilerle, akit: bekleAkit }) => {
  const wc = pencere.webContents;
  const dosya = () => wc.yuklemeler.filter((y) => y.tur === 'dosya').at(-1).url;
  assert.match(dosya(), /offline\.html/);
  assert.equal(new URL(dosya()).searchParams.get('hareket'), 'azalt');
  ilerle(2000); // yeniden deneme: yoklama yine düşer, sayfa yerinde güncellenir
  await bekleAkit();
  const yukler = wc.mesajlar.filter((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi').map((m) => m.yuk);
  assert.ok(yukler.length > 0);
  assert.ok(yukler.every((y) => y.hareket === 'azalt'));
});

ortamda('çevrimdışı ekran: "Hareketi azalt" kapalıyken durum sayfasına hareket alanı eklenmez', undefined, async ({ pencere, ilerle, akit: bekleAkit }) => {
  const wc = pencere.webContents;
  assert.equal(new URL(wc.yuklemeler.filter((y) => y.tur === 'dosya').at(-1).url).searchParams.has('hareket'), false);
  ilerle(2000);
  await bekleAkit();
  const yukler = wc.mesajlar.filter((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi').map((m) => m.yuk);
  assert.ok(yukler.length > 0);
  assert.ok(yukler.every((y) => !('hareket' in y)));
});

ortamda('çevrimdışı ekran: sayfa sağlamken artan bekleme yerinde güncellenir (yeniden yüklenmez)', undefined, async ({ pencere, ilerle, akit: bekleAkit }) => {
  const wc = pencere.webContents;
  const dosyaYuklemeleri = () => wc.yuklemeler.filter((y) => y.tur === 'dosya').length;
  const once = dosyaYuklemeleri();
  ilerle(2000); // yeniden deneme: yoklama yine düşer
  await bekleAkit();
  assert.equal(dosyaYuklemeleri(), once);
  assert.ok(wc.mesajlar.some((m) => m.kanal === 'baglanti:durum' && m.yuk?.durum === 'cevrimdisi'));
});

// --- Kısayol uyarıları (bulgu 6) ---------------------------------------------

/** Ayarlar penceresini açar ve oradan gelmiş bir IPC olayı üretir (yalnız yerel sayfadan gelen istek kabul edilir). */
function ayarlarOlayi({ menuOgesi, ayarlarPenceresi }) {
  AYARLAR_MENU_ADLARI.map((ad) => menuOgesi(ad)).find(Boolean).click(); // arayüz dili beş dilden biri olabilir
  return {
    sender: ayarlarPenceresi().webContents,
    senderFrame: { url: pathToFileURL(AYARLAR_HTML).href, parent: null },
  };
}

async function ayarlarKaydet(ortam, girdi) {
  const olay = ayarlarOlayi(ortam);
  return ortam.durum.ipc.get('ayarlar:kaydet')(olay, {
    yerelAdres: 'http://192.168.1.10:8123',
    disAdres: 'https://ha.example.com',
    kisayol: 'Control+Alt+H',
    otomatikBaslat: true,
    pencereBoyutu: 'hizli',
    odakKaybindaGizle: true,
    anaPanoyaDonDk: 5,
    ...girdi,
  });
}

ortamda('ayarlar: kaydedilemeyen kısayol için AltGr uyarısı verilmez, yalnız "kaydedilemedi"', undefined, async (ortam) => {
  ortam.durum.reddedilenKisayollar.add('Control+Alt+J');
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'Control+Alt+J' });
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.uyarilar.length, 1);
  assert.match(sonuc.uyarilar[0].mesaj, /kaydedilemedi/);
  assert.doesNotMatch(sonuc.uyarilar[0].mesaj, /AltGr/);
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+H'), 'eski kısayol korunmalı');
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+H');
});

ortamda('ayarlar: kaydedilen kısayol için AltGr uyarısı korunur', undefined, async (ortam) => {
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'Control+Alt+K' });
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.uyarilar.length, 1);
  assert.match(sonuc.uyarilar[0].mesaj, /AltGr/);
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+K'));
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+K');
});

ortamda('ayarlar: geçersiz kısayol uyarısı korunur, diğer ayarlar yine kaydedilir', undefined, async (ortam) => {
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'F9', yerelAdres: 'http://192.168.1.50:8123' });
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.uyarilar.length, 1);
  assert.match(sonuc.uyarilar[0].mesaj, /korundu/);
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+H');
  assert.equal(ortam.ayarOku().yerelAdres, 'http://192.168.1.50:8123');
});

// ===========================================================================
// Dalga 2: sahte HA, onay, geri bildirim, çökme sınırı, oturum kapatma, favori kaydı
// ===========================================================================

const durumNesnesi = (kimlik, ad, state = 'off') => ({ entity_id: kimlik, state, attributes: { friendly_name: ad } });
const json = (govde, status = 200) => new Response(JSON.stringify(govde), { status });

/**
 * Bellek içi sahte Home Assistant: GET /api/states, GET /api/states/<kimlik>, POST /api/services/<alan>/<servis>.
 * POST başarıyla dönerse toggle'da durum tersine çevrilmiş olarak yanıtlanır.
 */
function haYanitiOlustur(varliklar, { postDurumu = 200 } = {}) {
  return (url, secenek) => {
    const yol = new URL(url).pathname;
    const yontem = secenek.method ?? 'GET';
    if (yol === '/api/' && yontem === 'GET') return json({ message: 'API running.' });
    if (yontem === 'GET' && yol === '/api/states') return json(varliklar);
    const tek = /^\/api\/states\/(.+)$/.exec(yol);
    if (yontem === 'GET' && tek) {
      const varlik = varliklar.find((v) => v.entity_id === tek[1]);
      return varlik ? json(varlik) : json({ message: 'Entity not found.' }, 404);
    }
    const servis = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(yol);
    if (yontem === 'POST' && servis) {
      if (postDurumu !== 200) return json({}, postDurumu);
      const kimlik = JSON.parse(secenek.body).entity_id;
      const varlik = varliklar.find((v) => v.entity_id === kimlik);
      if (!varlik) return json([]);
      const yeni = servis[2] === 'toggle' ? (varlik.state === 'on' ? 'off' : 'on') : varlik.state;
      return json([{ ...varlik, state: yeni }]);
    }
    return json({}, 404);
  };
}

function haKur(durum, varliklar, secenek = {}) {
  durum.apiYaniti = haYanitiOlustur(varliklar, secenek);
}

const postlar = (ortam) => ortam.durum.fetchler.filter((f) => f.yontem === 'POST');
/** Tepsi menüsündeki favori öğesi: üst düzeyde ya da "Diğer favoriler" / "Onaylı eylemler" altında (hiz-15). */
const favoriOgesi = (ortam, etiket) => ortam.menuAgaci().find((d) => d.oge.label === etiket && d.ust !== 'Panolar')?.oge;
const favoriEtiketleri = (ortam) => ortam.menuAgaci().filter((d) => d.ust !== 'Panolar').map((d) => d.oge.label ?? '');
const koseMesajlari = (ortam) =>
  (ortam.kosePenceresi()?.webContents.mesajlar ?? []).filter((m) => m.kanal === 'kose:goster').map((m) => m.yuk);

const PC_KAPAT = { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat' };
const SALON = { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' };
const HA_VARLIKLARI = [
  durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'),
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off'),
];
const TEPSI_AYARI = { yoklama: 200, anahtar: true, tohum: { semaSurumu: 3, favoriler: [PC_KAPAT, SALON] } };

// --- hata-04: yıkıcı eylem onayı (tepsi menüsü) -------------------------------

ortamda('onay: yıkıcı favori "onay ister" etiketiyle, işaret kutusuz görünür; "Vazgeç"te HİÇBİR istek (POST) gönderilmez', TEPSI_AYARI, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const oge = favoriOgesi(ortam, 'PC kapat — onay ister'); // v4 göçü bilinen eylemin kısa etiketini doldurur
  assert.ok(oge, 'yıkıcı favori onay istediğini etiketinde belirtmeli');
  assert.ok(ortam.menuAgaci().some((d) => d.ust === 'Onaylı eylemler' && d.oge.label === oge.label), 'yıkıcı eylem "Onaylı eylemler" altında');
  assert.notEqual(oge.type, 'checkbox');

  await oge.click();
  await ortam.akit();
  assert.equal(ortam.durum.diyaloglar.length, 1);
  const diyalog = ortam.durum.diyaloglar[0];
  assert.deepEqual(diyalog.buttons, ['Çalıştır', 'Vazgeç']);
  assert.equal(diyalog.defaultId, 1, 'Enter varsayılan olarak Vazgeç olmalı');
  assert.equal(diyalog.cancelId, 1);
  assert.match(diyalog.message, /Bilgisayarı Kapat/);
  assert.deepEqual(postlar(ortam), [], 'vazgeçilince servis çağrısı yok');
  assert.deepEqual(ortam.durum.bildirimler, []);
  assert.equal(ortam.kosePenceresi(), undefined, 'vazgeçilince geri bildirim de yok');
});

ortamda('onay: "Çalıştır" denince tek POST gider, köşe bildirimi hemen çıkar, Windows bildirimi ve bip çıkmaz', TEPSI_AYARI, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  ortam.durum.diyalogYaniti = 0;
  await ortam.akit();
  await favoriOgesi(ortam, 'PC kapat — onay ister').click();
  await ortam.akit();
  assert.equal(ortam.durum.diyaloglar.length, 1);
  const gonderilen = postlar(ortam);
  assert.equal(gonderilen.length, 1, 'POST tekrarlanmaz');
  assert.equal(gonderilen[0].url, 'http://192.168.1.10:8123/api/services/button/press');
  assert.deepEqual(JSON.parse(gonderilen[0].govde), { entity_id: 'button.pc_bilgisayari_kapat' });
  assert.equal(gonderilen[0].basliklar.Authorization, `Bearer ${TEST_ANAHTAR}`);
  // 1.6.1: bildirimde favorinin karo adı (etiket) görünür; HA'daki ad ("Bilgisayarı Kapat") yalnız etiket boşsa
  assert.deepEqual(koseMesajlari(ortam), [{ tur: 'ok', metin: 'Düğmeye basıldı: PC kapat', sureMs: 1500, malzeme: 'acrylic', ozet: { baslik: 'PC kapat', alt: 'Düğmeye basıldı', alan: 'button', acik: false } }]);
  assert.deepEqual(ortam.durum.bildirimler, [], 'Windows bildirimi yalnız hatada');
  assert.equal(ortam.durum.bip, 0, 'bip varsayılan olarak kapalı');
});

ortamda('onay: zararsız favori (ışık) onay penceresi olmadan çalışır; durum POST yanıtından bildirilir', TEPSI_AYARI, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const oge = favoriOgesi(ortam, 'Salon Lambası');
  assert.equal(oge.type, 'checkbox');
  await oge.click();
  await ortam.akit();
  assert.deepEqual(ortam.durum.diyaloglar, []);
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.equal(koseMesajlari(ortam)[0].metin, 'Salon Lambası açıldı');
});

ortamda('onay: açık "Onay iste" kutusu (onay:true) zararsız listedeki eylemi de onaya bağlar; onay:false varsayılan onaylı düğmeyi serbest bırakır', {
  yoklama: 200,
  anahtar: true,
  tohum: {
    semaSurumu: 3,
    favoriler: [
      { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', onay: true },
      { entity_id: 'button.pc_ekran_kapat', ad: 'Ekranı Kapat', onay: true },
      { entity_id: 'button.yeni_dugme', ad: 'Yeni Düğme', onay: false },
    ],
  },
}, async (ortam) => {
  haKur(ortam.durum, [
    durumNesnesi('light.salon_lambasi', 'Salon Lambası'),
    durumNesnesi('button.pc_ekran_kapat', 'Ekranı Kapat', 'unknown'),
    durumNesnesi('button.yeni_dugme', 'Yeni Düğme', 'unknown'),
  ]);
  await ortam.akit();
  assert.ok(favoriOgesi(ortam, 'Salon Lambası — onay ister'));
  assert.ok(favoriOgesi(ortam, 'Ekranı kapat — onay ister'));
  const yeni = ortam.menuAgaci().find((d) => d.oge.label === 'Yeni Düğme  ·  düğme');
  assert.ok(yeni, 'onay:false olan düğme onaysız çalışır');
  assert.notEqual(yeni.ust, 'Onaylı eylemler');
});

ortamda('onay: menü zararsız sanırken HA güncel durumu yıkıcı çıkarsa çalıştırmadan önce onay sorulur', {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 3, favoriler: [{ entity_id: 'button.gizli_dugme', ad: 'Düğme', onay: false }] },
}, async (ortam) => {
  // Kayıtlı ad zararsız ("Düğme"), HA'daki güncel ad "Yeniden Başlat" ipucu içeriyor: sınıf yıkıcı olur.
  haKur(ortam.durum, [durumNesnesi('button.gizli_dugme', 'Sunucuyu Yeniden Başlat', 'unknown')]);
  ortam.durum.diyalogYaniti = 1;
  await ortam.akit();
  const oge = ortam.menuAgaci().find((d) => /Düğme|Başlat/.test(d.oge.label ?? '') && d.oge.click && d.ust === null)?.oge
    ?? ortam.menuAgaci().find((d) => /Düğme|Başlat/.test(d.oge.label ?? '') && d.oge.click)?.oge;
  assert.ok(oge, 'sunucu adı henüz bilinmediği için kayıtlı adıyla menüde görünür');
  await oge.click();
  await ortam.akit();
  assert.equal(ortam.durum.diyaloglar.length, 1);
  assert.deepEqual(postlar(ortam), []);
});

// --- hiz-04: anında geri bildirim -----------------------------------------------

ortamda('geri bildirim: bip açıksa başarıda çalar; köşe bildirimi kapalıysa hiçbir şey gösterilmez', {
  ...TEPSI_AYARI,
  tohum: { semaSurumu: 3, bipSesi: true, koseBildirimi: false, favoriler: [SALON] },
}, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  await favoriOgesi(ortam, 'Salon Lambası').click();
  await ortam.akit();
  assert.equal(ortam.durum.bip, 1);
  assert.equal(ortam.kosePenceresi(), undefined);
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('geri bildirim: hata olunca Windows bildirimi çıkar, köşede hata görünür, bip çalmaz', {
  ...TEPSI_AYARI,
  tohum: { semaSurumu: 3, bipSesi: true, favoriler: [SALON] },
}, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI, { postDurumu: 500 });
  await ortam.akit();
  await favoriOgesi(ortam, 'Salon Lambası').click();
  await ortam.akit();
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /Yapılamadı: sunucu hatası \(500\)/);
  assert.equal(koseMesajlari(ortam)[0].tur, 'hata');
  assert.equal(ortam.durum.bip, 0);
});

ortamda('geri bildirim: köşe penceresi odak almaz (focusable:false), tıklamayı geçirir ve odaksız gösterilir', TEPSI_AYARI, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  await favoriOgesi(ortam, 'Salon Lambası').click();
  await ortam.akit();
  const kose = ortam.kosePenceresi();
  assert.ok(kose);
  assert.equal(kose.secenekler.focusable, false);
  assert.equal(kose.secenekler.show, false);
  assert.equal(kose.cagri.show, 0, 'show() odak alır; showInactive kullanılmalı');
  assert.equal(kose.cagri.showInactive, 1);
  assert.equal(kose.secenekler.webPreferences.contextIsolation, true);
  assert.equal(kose.secenekler.webPreferences.sandbox, true);
  // süre dolunca pencere solarak gizlenir (1.6.1): solma adımları zincirlenir, saat küçük adımlarla ilerler
  for (let gecen = 0; gecen < 4000; gecen += 20) ortam.ilerle(20);
  assert.equal(kose.gorunur, false);
});

// --- GÜVENLİK KURALI: kapı eylemi hiçbir yüzeyde çalışmaz ---------------------------

ortamda('kapı: HA\'daki GÜNCEL adı kapı olan favori tepsiden çalıştırılamaz; POST yok, hata bildirilir', {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 3, favoriler: [{ entity_id: 'light.koridor', ad: 'Koridor' }] },
}, async (ortam) => {
  // Menü önbelleği henüz eski kayıtlı adı gösteriyor ('Koridor'); HA'daki güncel ad artık kapı içeriyor.
  haKur(ortam.durum, [durumNesnesi('light.koridor', 'Koridor Kapısı Lambası')]);
  const oge = favoriOgesi(ortam, 'Koridor');
  assert.ok(oge, 'eski ad önbellekte: menüde görünür');
  await oge.click();
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], 'güncel durum kapı olarak sınıflandı: servis çağrısı YOK');
  assert.deepEqual(ortam.durum.diyaloglar, []);
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /Yapılamadı: bu cihaz güvenlik nedeniyle engelli/);
  // Önbellek tazelenince (HA'daki güncel ad) öğe menüden de kalkar.
  ortam.ilerle(70_000);
  await ortam.akit();
  assert.equal(favoriEtiketleri(ortam).some((e) => /Koridor/.test(e)), false);
});

ortamda('kapı: kapı/kilit/garaj favorileri açılışta ayar dosyasından çıkarılır, bildirilir ve menüde hiç görünmez', {
  yoklama: 200,
  anahtar: true,
  tohum: {
    semaSurumu: 3,
    favoriler: [
      { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' },
      { entity_id: 'button.garaj_kapisi_ac', ad: 'Garaj Kapısı Aç' },
      { entity_id: 'light.garaj_lambasi', ad: 'Garaj Lambası' },
      SALON,
    ],
  },
}, async (ortam) => {
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi']);
  assert.equal(ortam.durum.bildirimler.some((b) => /3 favori güvenlik/.test(b.body)), true);
  const etiketler = favoriEtiketleri(ortam);
  assert.equal(etiketler.some((e) => /kap[ıi]|garaj|kilit/i.test(e)), false);
  assert.match(ortam.gunlukOku(), /3 favori güvenlik/);
});

// --- Şema göçü bildirimi (hata-04) -----------------------------------------------

ortamda('göç: eski ayardaki PC kapat favorisi artık onay ister ve kullanıcıya bildirilir; zararsız düğme bugünkü gibi onaysız kalır', {
  tohum: {
    favoriler: [
      { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat' },
      { entity_id: 'button.pc_ekran_kapat', ad: 'Ekranı Kapat' },
      { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
    ],
  },
}, async (ortam) => {
  await ortam.akit();
  const ayar = ortam.ayarOku();
  assert.equal(ayar.semaSurumu, 6);
  assert.equal(ayar.favoriler.length, 3, 'hiçbir favori silinmez');
  assert.deepEqual(ayar.favoriler.map((f) => f.etiket), ['PC kapat', 'Ekranı kapat', undefined], 'v4 göçü yalnız bilinen eylemlere kısa etiket ekler');
  assert.equal(ayar.favoriler[0].onay, undefined);
  assert.equal(ayar.favoriler[1].onay, false);
  const bildirim = ortam.durum.bildirimler.find((b) => /onay soracak/.test(b.body));
  assert.ok(bildirim, 'kullanıcı habersiz kalmamalı');
  assert.match(bildirim.body, /Bilgisayarı Kapat/);
});

// --- hata-06: günlük, çökme sınırı, oturum kapatma -----------------------------------

ortamda('günlük: dosyaya yazılır ve sır içermez; beklenmeyen hata yalnız adı/koduyla yazılır', { anahtar: true }, async (ortam) => {
  assert.match(ortam.gunlukOku(), /Sunucuya ulaşılamadı\./);
  const [yakala] = ortam.surecDinleyicileri('uncaughtException');
  assert.ok(yakala, 'yakalanmamış hata dinleyicisi kurulmalı');
  yakala(Object.assign(new TypeError('ayrinti-sizmasin Bearer abc.def.ghi'), { code: 'E_DENEME' }));
  const gunluk = ortam.gunlukOku();
  assert.match(gunluk, /Yakalanmamış hata: TypeError \(E_DENEME\)/);
  assert.doesNotMatch(gunluk, /ayrinti-sizmasin|TEST_ANAHTAR|Bearer/);
});

ortamda('çökme: artan beklemeyle yeniden yüklenir, 5. çökmede durur (COKME sayfası, otomatik deneme yok); "Tekrar Dene" sayacı sıfırlar', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  await ortam.akit();
  const urlSayisi = () => wc.yuklemeler.filter((y) => y.tur === 'url').length;
  const bas = urlSayisi();
  assert.equal(bas, 1);
  const cokme = (neden = 'crashed') => wc.emit('render-process-gone', {}, { reason: neden });

  wc.emit('render-process-gone', {}, { reason: 'clean-exit' }); // normal kapanış çökme sayılmaz
  ortam.ilerle(60_000);
  await ortam.akit();
  assert.equal(urlSayisi(), bas);

  const beklemeler = [1000, 2000, 4000, 8000];
  for (let i = 0; i < beklemeler.length; i += 1) {
    cokme();
    ortam.ilerle(beklemeler[i] - 1);
    await ortam.akit();
    assert.equal(urlSayisi(), bas + i, `${i + 1}. çökmede bekleme dolmadan yüklenmemeli`);
    ortam.ilerle(1);
    await ortam.akit();
    assert.equal(urlSayisi(), bas + i + 1, `${i + 1}. çökmeden sonra yeniden yüklenmeli`);
  }

  cokme(); // 5.
  ortam.ilerle(300_000);
  await ortam.akit();
  assert.equal(urlSayisi(), bas + 4, '5. çökmeden sonra otomatik yeniden yükleme yok');
  const sonDosya = wc.yuklemeler.filter((y) => y.tur === 'dosya').at(-1).url;
  assert.match(sonDosya, /durum=cevrimdisi/);
  assert.match(sonDosya, /hata=COKME/);
  assert.match(sonDosya, /sn=0/, 'geri sayım yok');
  assert.match(ortam.gunlukOku(), /otomatik yeniden yükleme durduruldu/);

  // "Tekrar Dene" (çevrimdışı sayfadan): sayaç sıfırlanır, yeni çökme yine 1 sn sonra yeniden yükler.
  const olay = { sender: wc, senderFrame: { url: pathToFileURL(OFFLINE_HTML).href, parent: null } };
  assert.equal(ortam.durum.ipc.get('baglanti:tekrar-dene')(olay), true);
  await ortam.akit();
  assert.equal(urlSayisi(), bas + 5);
  cokme();
  ortam.ilerle(1000);
  await ortam.akit();
  assert.equal(urlSayisi(), bas + 6);
});

ortamda('oturum kapatma: sorgu sırasında pencere gizlenmeye çalışılmaz; session-end gelmezse (iptal) 15 sn sonra yine tepsiye gizlenir', undefined, ({ pencere, ilerle }) => {
  ilerle(400);
  const kapat = () => {
    const olay = { engellendi: false, preventDefault() { this.engellendi = true; } };
    pencere.emit('close', olay);
    return olay;
  };
  pencere.emit('query-session-end');
  assert.equal(kapat().engellendi, false, 'oturum kapanırken pencere gerçekten kapanır');
  ilerle(15_000); // session-end gelmedi: kapatma iptal edilmiş
  assert.equal(kapat().engellendi, true, 'iptalden sonra kapat yine gizler');
  assert.equal(pencere.gorunur, false);
});

ortamda('oturum kapatma: session-end gelirse (gerçek çıkış) pencere kapanır, yeniden oluşturulmaz', { tohum: { tepsiSolTik: 'pencere' } }, async ({ pencere, tepsi, durum, ilerle, akit: bekleAkit }) => {
  ilerle(400);
  pencere.emit('query-session-end');
  pencere.emit('session-end');
  ilerle(60_000);
  const olay = { engellendi: false, preventDefault() { this.engellendi = true; } };
  pencere.emit('close', olay);
  assert.equal(olay.engellendi, false);
  pencere.yikik = true;
  tepsi.emit('click');
  await bekleAkit();
  assert.equal(durum.pencereler.filter((p) => p.secenekler.minWidth === 480).length, 1, 'gerçek çıkışta yeni pencere açılmaz');
});

ortamda('oturum kapatma iptali: pencere yok olduysa tepsi tıklaması ana pencereyi yeniden oluşturur', { tohum: { tepsiSolTik: 'pencere' } }, async (ortam) => {
  ortam.ilerle(400);
  ortam.pencere.emit('query-session-end');
  ortam.ilerle(15_000);
  ortam.pencere.yikik = true; // sorgu iptal edildi ama pencere arada kapanmıştı
  ortam.tepsi.emit('click');
  await ortam.akit();
  const yeni = ortam.anaPencere();
  assert.ok(yeni && yeni !== ortam.pencere, 'yeni ana pencere oluşturulmalı');
  assert.equal(yeni.gorunur, true);
  assert.match(ortam.gunlukOku(), /Ana pencere yoktu/);
});

// --- hata-14 + hata-04: Ayarlar ekranı (cihaz listesi ve favori kaydı) ---------------

const AYAR_VARLIKLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'),
  durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'),
  durumNesnesi('script.kendi_scriptim', 'Kendi Scriptim', 'off'),
  durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'),
  durumNesnesi('button.garaj_kapisi_ac', 'Garaj Kapısı Aç', 'unknown'),
  durumNesnesi('light.garaj_lambasi', 'Garaj Lambası', 'off'),
  durumNesnesi('light.koridor', 'Koridor Kapısı Lambası', 'off'), // adı sonradan "kapı" oldu
];
const AYAR_EKRANI = {
  yoklama: 200,
  anahtar: true,
  tohum: {
    semaSurumu: 3,
    favoriler: [
      { entity_id: 'light.eski_lamba', ad: 'Eski Lamba' }, // HA'da şu an yok
      { entity_id: 'light.koridor', ad: 'Koridor' }, // HA'da var ama artık güvenlik kuralına takılıyor
      SALON,
    ],
  },
};

ortamda('cihaz listesi: kapı/kilit/garaj hiç gelmez; yıkıcı/onay bilgisi, eksik ve engelli favoriler ayrı bildirilir', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  const sonuc = await ortam.durum.ipc.get('cihazlar:getir')(olay);
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.cihazlar.map((c) => c.entity_id), ['light.salon_lambasi', 'script.kendi_scriptim', 'button.pc_bilgisayari_kapat']);
  assert.equal(JSON.stringify(sonuc).match(/lock\.|garaj/i), null, 'GÜVENLİK KURALI: renderer\'a hiç gitmez');
  const [isik, betik, pc] = sonuc.cihazlar;
  assert.deepEqual([isik.onayZorunlu, isik.varsayilanOnay], [false, false]);
  assert.deepEqual([betik.onayZorunlu, betik.varsayilanOnay], [false, true], 'yeni script varsayılan onaylı ama kapatılabilir');
  assert.deepEqual([pc.onayZorunlu, pc.varsayilanOnay], [true, true], 'PC kapat: onay kapatılamaz');
  assert.deepEqual(sonuc.eksik, [{ entity_id: 'light.eski_lamba', ad: 'Eski Lamba' }]);
  assert.deepEqual(sonuc.engelli, [{ entity_id: 'light.koridor', ad: 'Koridor' }]);
});

ortamda('cihaz listesi: bozuk öğeler (null, kimliksiz, sayı) listeyi çökertmez; kilit/alarm/kapı/garaj ve kapı adlı takvim hiçbir listeye girmez (ucuz alan denetimi önce, güvenlik süzgeci yine zorunlu)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, [
    null,
    { state: 'on' },
    { entity_id: 5, state: 'on' },
    7,
    ...AYAR_VARLIKLARI,
    durumNesnesi('alarm_control_panel.ev', 'Ev Alarmı', 'disarmed'),
    durumNesnesi('cover.garaj_kapisi', 'Garaj Kapısı', 'closed'),
    durumNesnesi('calendar.aile', 'Aile Takvimi', 'off'),
    durumNesnesi('calendar.on_kapi_zili', 'Ön Kapı Takvimi', 'off'),
    durumNesnesi('todo.market', 'Market', '2'),
    durumNesnesi('lock.arka_kapi', 'Arka Kapı', 'locked'),
  ]);
  const sonuc = await ortam.durum.ipc.get('cihazlar:getir')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true, 'bozuk öğeler listeyi düşürmedi');
  assert.deepEqual(sonuc.cihazlar.map((c) => c.entity_id), ['light.salon_lambasi', 'script.kendi_scriptim', 'button.pc_bilgisayari_kapat']);
  assert.deepEqual(sonuc.bilgiVarliklari.map((b) => b.entity_id), ['todo.market', 'calendar.aile'], 'yalnız güvenli takvim ve yapılacaklar');
  assert.equal(JSON.stringify(sonuc).match(/lock\.|alarm|garaj|kapi/i), null, 'GÜVENLİK KURALI: renderer\'a hiç gitmez');
});

ortamda('favori kaydı: HA\'da görünmeyen favori silinmez; güvenlik engelli düşer; kapı/kilit yeni giriş olamaz; onay seçimi saklanır', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  const kaydet = ortam.durum.ipc.get('favoriler:kaydet');
  assert.deepEqual(await kaydet(olay, []), { ok: false, hata: 'Önce cihaz listesini yükleyin.' });

  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const sonuc = await kaydet(olay, [
    { entity_id: 'light.eski_lamba' },
    { entity_id: 'light.koridor' },
    { entity_id: 'light.salon_lambasi' },
    { entity_id: 'lock.on_kapi' }, // listede hiç yok: kabul edilmez
    { entity_id: 'button.garaj_kapisi_ac' },
    { entity_id: 'script.kendi_scriptim', onay: false },
    { entity_id: 'button.pc_bilgisayari_kapat', onay: false }, // zorunlu onay kapatılamaz
  ]);
  assert.deepEqual(sonuc, { ok: true, sayi: 4, eksik: 1, engelli: 1, kisayolHatalari: [], etiketHatalari: [], gorunumHatalari: [], kisayolSorunlari: [] });
  const ayar = ortam.ayarOku();
  assert.deepEqual(ayar.favoriler, [
    { entity_id: 'light.eski_lamba', ad: 'Eski Lamba' },
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
    { entity_id: 'script.kendi_scriptim', ad: 'Kendi Scriptim', onay: false },
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', etiket: 'PC kapat' }, // bilinen eylem kısa etiketiyle kaydedilir (v4)
  ]);
  assert.deepEqual(ayar.engellenenFavoriler, [{ entity_id: 'light.koridor', neden: 'guvenlik' }]);
});

ortamda('favori kaydı: kullanıcı listeden işareti kaldırdığı favori silinir (karar kullanıcıya ait)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const sonuc = await ortam.durum.ipc.get('favoriler:kaydet')(olay, [{ entity_id: 'light.salon_lambasi' }]);
  assert.deepEqual(sonuc, { ok: true, sayi: 1, eksik: 0, engelli: 0, kisayolHatalari: [], etiketHatalari: [], gorunumHatalari: [], kisayolSorunlari: [] });
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi']);
});

ortamda('ayarlar IPC: yalnız yerel ayarlar sayfasından gelen istek kabul edilir (uzak HA sayfası ya da başka pencere reddedilir)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const altCerceve = { sender: olay.sender, senderFrame: { ...olay.senderFrame, parent: {} } };
  for (const kanal of ['ayarlar:getir', 'cihazlar:getir', 'favoriler:kaydet', 'anahtar:sil', 'anahtar:kaydet', 'ayarlar:kaydet']) {
    for (const kotu of [uzak, baskaPencere, altCerceve]) {
      assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, []), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
    }
  }
  assert.equal(ortam.durum.ipc.get('baglanti:tekrar-dene')(uzak), false);
  assert.equal(ortam.durum.ipc.get('ayarlar:ac')(baskaPencere), false);
  assert.deepEqual(postlar(ortam), []);
  assert.equal(ortam.ayarOku().favoriler.length, 3, 'reddedilen istekler ayarı değiştirmez');
});

ortamda('ayarlar özeti: favoriler kimlik+ad+onay olarak, yeni geri bildirim ayarları ve anahtar durumu gelir (anahtar gelmez)', { ...AYAR_EKRANI, tohum: { semaSurumu: 3, koseBildirimi: false, bipSesi: true, favoriler: [{ ...PC_KAPAT, onay: true }] } }, async (ortam) => {
  const sonuc = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.koseBildirimi, false);
  assert.equal(sonuc.bipSesi, true);
  assert.equal(sonuc.anahtarVar, true);
  assert.equal(sonuc.sifrelemeVar, true);
  assert.deepEqual(JSON.parse(JSON.stringify(sonuc.favoriler)), [{ entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', onay: true, etiket: 'PC kapat' }]);
  assert.equal(sonuc.tepsiSolTik, 'panel');
  assert.equal(sonuc.canliBaglanti, true);
  assert.equal(sonuc.paletKisayol, 'Control+Alt+P');
  assert.doesNotMatch(JSON.stringify(sonuc), new RegExp(TEST_ANAHTAR));
});

ortamda('ayarlar: köşe bildirimi ve bip ayarı kaydedilir', undefined, async (ortam) => {
  const sonuc = await ayarlarKaydet(ortam, { koseBildirimi: false, bipSesi: true });
  assert.equal(sonuc.ok, true);
  const ayar = ortam.ayarOku();
  assert.equal(ayar.koseBildirimi, false);
  assert.equal(ayar.bipSesi, true);
  assert.equal(sonuc.koseBildirimi, false);
  assert.equal(sonuc.bipSesi, true);
});

// --- Ayarlar sayfası (1.2.0): alan iletileri, karo adı, kapatma uyarısı, sınama, açık sayfa, dışa/içe aktarma -------------------

ortamda('ayarlar kaydı: adres hatasında hatalı alanlar ve her alanın kendi iletisi döner; ayar dosyası değişmez (h-01)', undefined, async (ortam) => {
  assert.equal((await ayarlarKaydet(ortam, {})).ok, true);
  const once = ortam.ayarOku();
  const sonuc = await ayarlarKaydet(ortam, { yerelAdres: 'abc', disAdres: 'http://ha.example.com' });
  assert.equal(sonuc.ok, false);
  assert.deepEqual(sonuc.alanlar, ['yerelAdres', 'disAdres']);
  assert.match(sonuc.alanMesajlari.yerelAdres, /^Ev içi adres geçersiz/);
  assert.match(sonuc.alanMesajlari.disAdres, /^Dış adres geçersiz/);
  assert.equal(sonuc.hata, `${sonuc.alanMesajlari.yerelAdres} ${sonuc.alanMesajlari.disAdres}`);
  assert.deepEqual(ortam.ayarOku(), once, 'adres hatası hiçbir ayarı değiştirmez');
});

ortamda('ayarlar kaydı: gevşek yazılmış kısayol (ctrl alt k) normalleşip saklanır; Windows’a ayrılmış birleşim reddedilir ve eski kısayol korunur (h-24, h-25)', undefined, async (ortam) => {
  const sonuc = await ayarlarKaydet(ortam, { kisayol: ' ctrl  alt k ' });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+K');
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+K'));

  const ayrilmis = await ayarlarKaydet(ortam, { kisayol: 'Control+C', yerelAdres: 'http://192.168.1.50:8123' });
  assert.equal(ayrilmis.ok, true, 'kısayol sorunu diğer ayarların kaydını durdurmaz');
  assert.ok(ayrilmis.uyarilar.some((u) => u.alan === 'kisayol' && /ayrılmış/.test(u.mesaj) && !u.yalnizKayitBasarili), 'ayrılmış kısayol uyarı olarak bildirilir');
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+K', 'eski kısayol korunur');
  assert.equal(ortam.ayarOku().yerelAdres, 'http://192.168.1.50:8123');
});

ortamda('favori kaydı: karo adı (etiket) kapı süzgecinden geçer: geçerli ad saklanır, kapı/kilit sözcüklü ad etiketHatalari ile bildirilir ve önceki ad korunur (k-06)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const sonuc = await ortam.durum.ipc.get('favoriler:kaydet')(olay, [
    { entity_id: 'light.salon_lambasi', etiket: '  Salon   ışığı ' },
    { entity_id: 'script.kendi_scriptim', etiket: 'Ön kapıyı aç' },
  ]);
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.etiketHatalari, [{ entity_id: 'script.kendi_scriptim', neden: 'guvenlik' }]);
  const favoriler = ortam.ayarOku().favoriler;
  assert.equal(favoriler.find((f) => f.entity_id === 'light.salon_lambasi').etiket, 'Salon ışığı');
  assert.equal('etiket' in favoriler.find((f) => f.entity_id === 'script.kendi_scriptim'), false, 'reddedilen ad yazılmaz');
  assert.doesNotMatch(JSON.stringify(favoriler), /kapı/i);
  assert.deepEqual(postlar(ortam), []);
});

ortamda('favori kaydı: yükteki sıra tepsideki sırayı belirler (k-05)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  await ortam.durum.ipc.get('favoriler:kaydet')(olay, [{ entity_id: 'script.kendi_scriptim', onay: false }, { entity_id: 'light.salon_lambasi' }]);
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['script.kendi_scriptim', 'light.salon_lambasi']);
  const etiketler = favoriEtiketleri(ortam);
  const konum = (parca) => etiketler.findIndex((e) => e.includes(parca));
  assert.ok(konum('Kendi Scriptim') >= 0 && konum('Salon Lambası') >= 0, JSON.stringify(etiketler));
  assert.ok(konum('Kendi Scriptim') < konum('Salon Lambası'), 'tepsi menüsü kaydedilen sırayı izler: ' + JSON.stringify(etiketler));
});

ortamda('ayarlar penceresi kapanırken: kaydedilmemiş değişiklik uyarısı Kapat/Vazgeç sorar; Vazgeç pencereyi tutar, Kapat bırakır; uygulama çıkarken sorulmaz (k-02)', undefined, async (ortam) => {
  ayarlarOlayi(ortam); // Ayarlar penceresini açar
  const wc = ortam.ayarlarPenceresi().webContents;
  const dene = (yanit) => {
    ortam.durum.senkronDiyalogYaniti = yanit;
    const olay = { engellendi: false, preventDefault() { this.engellendi = true; } };
    wc.emit('will-prevent-unload', olay);
    return olay.engellendi;
  };
  const once = ortam.durum.diyaloglar.length;
  assert.equal(dene(1), false, 'Vazgeç: sayfanın uyarısı geçerli kalır, pencere kapanmaz');
  assert.equal(dene(0), true, 'Kapat: preventDefault uyarıyı yok sayar, pencere kapanır');
  const soru = ortam.durum.diyaloglar.at(-1);
  assert.deepEqual(soru.buttons, ['Kapat', 'Vazgeç']);
  assert.equal(soru.defaultId, 1, 'varsayılan düğme Vazgeç');
  assert.equal(soru.cancelId, 1, 'Esc/pencere kapatma = Vazgeç');
  assert.match(soru.message, /Kaydedilmemiş değişiklik/);
  assert.equal(ortam.durum.diyaloglar.length, once + 2);

  ortam.menuOgesi('Çıkış').click(); // gerçek çıkış: değişiklik sorusu çıkmaz
  const cikisOncesi = ortam.durum.diyaloglar.length;
  assert.equal(dene(1), true);
  assert.equal(ortam.durum.diyaloglar.length, cikisOncesi, 'çıkarken diyalog açılmaz');
});

ortamda('ayarlar:adres-sina: yazılan adres anahtarsız tek GET /manifest.json ile sınanır; geçersiz ya da herkese açık http adresine istek gitmez; yalnız Ayarlar sorabilir (k-14)', { yoklama: 200, anahtar: true }, async (ortam) => {
  const sina = (adres, tur, olay = ayarlarOlayi(ortam)) => ortam.durum.ipc.get('ayarlar:adres-sina')(olay, adres, tur);
  const sinamalar = (kok) => ortam.durum.fetchler.filter((f) => f.url === `${kok}/manifest.json`);

  assert.deepEqual(await sina('http://192.168.1.50:8123', 'yerel'), { ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'Home Assistant bulundu: adres çalışıyor.' });
  const istekler = sinamalar('http://192.168.1.50:8123');
  assert.equal(istekler.length, 1, 'tek istek');
  assert.equal(istekler[0].yontem, 'GET');
  assert.equal(istekler[0].basliklar, undefined, 'başlık (Authorization) yok');
  assert.equal(JSON.stringify(ortam.durum.fetchler.filter((f) => f.url.includes('192.168.1.50'))).includes(TEST_ANAHTAR), false, 'erişim anahtarı sınama isteğine girmez');

  ortam.durum.yoklamaDurumu = 403;
  const engelli = await sina('https://ha.example.com', 'dis');
  assert.equal(engelli.ok, true);
  assert.equal(engelli.ulasilabilir, false);
  assert.equal(engelli.neden, 'erisim-engelli');
  assert.match(engelli.mesaj, /engellemiş/);
  ortam.durum.yoklamaDurumu = 404;
  assert.equal((await sina('https://ha.example.com', 'dis')).neden, 'beklenmeyen-durum');
  ortam.durum.yoklamaDurumu = null;
  assert.equal((await sina('http://192.168.1.50:8123', 'yerel')).neden, 'ulasilamadi');

  const once = ortam.durum.fetchler.length;
  const genel = await sina('http://ornek-genel-adres.com', 'yerel');
  assert.equal(genel.ok, false);
  assert.match(genel.hata, /ev ağı adreslerinde/);
  assert.equal((await sina('http://ha.example.com', 'dis')).ok, false, 'dış adres yalnız https');
  assert.equal((await sina('', 'yerel')).ok, false);
  assert.equal((await sina('abc', 'yerel')).ok, false);
  assert.equal(ortam.durum.fetchler.length, once, 'geçersiz/güvensiz adreslere istek gitmez');

  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  assert.deepEqual(await sina('http://192.168.1.50:8123', 'yerel', uzak), { ok: false, hata: 'İzin yok.' });
  assert.equal(ortam.durum.fetchler.length, once);
});

ortamda('ayarlar:aciksayfa: ana pencerede açık HA sayfasının yolu ve adı döner; HA sayfası yokken, başka kökende ya da uygun olmayan yolda hata verir (k-18)', { yoklama: 200 }, async (ortam) => {
  const aciksayfa = (olay = ayarlarOlayi(ortam)) => ortam.durum.ipc.get('ayarlar:aciksayfa')(olay);
  const wc = ortam.pencere.webContents;
  const git = (adres) => {
    wc.url = adres;
    wc.emit('did-navigate', {}, adres, 200);
  };

  assert.match((await aciksayfa()).hata, /açık bir Home Assistant sayfası yok/, 'HA sayfası henüz yüklenmedi');
  git('http://192.168.1.10:8123/lovelace/ev');
  ortam.pencere.emit('page-title-updated', { preventDefault() {} }, 'Ev Panosu – Home Assistant');
  assert.deepEqual(await aciksayfa(), { ok: true, yol: '/lovelace/ev', ad: 'Ev Panosu' });

  git('http://192.168.1.10:8123/api/states');
  const api = await aciksayfa();
  assert.equal(api.ok, false);
  assert.match(api.hata, /uygun değil/);

  git('https://baska-adres.example/lovelace/ev');
  const baska = await aciksayfa();
  assert.equal(baska.ok, false);
  assert.match(baska.hata, /ayarlardaki ev içi ya da dış adreste değil/);

  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  assert.deepEqual(await aciksayfa(uzak), { ok: false, hata: 'İzin yok.' });
});

const AKTARIM_DOSYASI = (ayarlar) => JSON.stringify({ bicim: 'ev-paneli-ayar-yedegi', aktarimSurumu: 1, semaSurumu: 5, ayarlar });

ortamda('ayarlar:disa-aktar: dosyayı kullanıcının seçtiği yere yazar (renderer yol veremez), erişim anahtarı dosyaya girmez, iptal sessizdir (k-13)', { anahtar: true }, async (ortam) => {
  const disa = (...ek) => ortam.durum.ipc.get('ayarlar:disa-aktar')(ayarlarOlayi(ortam), ...ek);
  const hedef = path.join(ortam.durum.appData, 'yedegim');
  ortam.durum.dosyaSecimi = { canceled: false, filePath: hedef };
  const sonuc = await disa('C:\\Windows\\kotu-yol.json');
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.ad, 'yedegim.json', 'uzantı eklenir; yalnız dosya adı döner');
  const metin = fs.readFileSync(`${hedef}.json`, 'utf8');
  assert.equal(JSON.parse(metin).bicim, 'ev-paneli-ayar-yedegi');
  assert.equal(metin.includes(TEST_ANAHTAR), false, 'erişim anahtarı dosyaya girmez');
  assert.doesNotMatch(metin, /"anahtar|token|Bearer/i);
  assert.equal(fs.existsSync('C:\\Windows\\kotu-yol.json'), false);
  assert.equal(ortam.durum.dosyaDiyaloglari.length, 1);

  ortam.durum.dosyaSecimi = { canceled: true };
  assert.deepEqual(await disa(), { ok: false, iptal: true });
});

ortamda('ayarlar:ice-aktar: dosyadaki ayarlar kaydetmedeki doğrulamayla uygulanır; kapı/kilit favorisi ve anahtar alanı alınmaz; geçersiz adres hiçbir şeyi değiştirmez (k-13)', { anahtar: true }, async (ortam) => {
  const ice = () => ortam.durum.ipc.get('ayarlar:ice-aktar')(ayarlarOlayi(ortam));
  const dosya = path.join(ortam.durum.appData, 'ice.json');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [dosya] };
  fs.writeFileSync(dosya, AKTARIM_DOSYASI({
    yerelAdres: 'http://192.168.1.50:8123',
    koseBildirimi: false,
    favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon' }, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }],
    anahtar: 'SAHTE_ANAHTAR_000000',
  }), 'utf8');
  // Kayıtlı erişim anahtarı varken ana makine değişiyorsa yerel onay sorulur; vazgeçilirse hiçbir şey uygulanmaz.
  const oncekiAdres = ortam.ayarOku().yerelAdres;
  ortam.durum.diyalogYaniti = 1;
  const reddedilen = await ice();
  assert.equal(reddedilen.ok, false);
  assert.equal(ortam.durum.diyaloglar.length, 1, 'ana makine değişikliği için onay diyaloğu açılır');
  assert.equal(ortam.ayarOku().yerelAdres, oncekiAdres, 'onaylanmayan içe aktarma uygulanmaz');
  assert.equal(ortam.ayarOku().koseBildirimi, true);
  ortam.durum.diyalogYaniti = 0; // "İçe aktar"
  const sonuc = await ice();
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.ad, 'ice.json');
  const ayar = ortam.ayarOku();
  assert.equal(ayar.yerelAdres, 'http://192.168.1.50:8123');
  assert.equal(ayar.koseBildirimi, false);
  assert.deepEqual(ayar.favoriler.map((f) => f.entity_id), ['light.salon_lambasi'], 'GÜVENLİK KURALI: kilit favoriye girmez');
  assert.equal(JSON.stringify(ayar).includes('SAHTE_ANAHTAR'), false);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarVar, true, 'kayıtlı erişim anahtarı değişmez');

  fs.writeFileSync(dosya, AKTARIM_DOSYASI({ yerelAdres: 'abc', koseBildirimi: true }), 'utf8');
  const kotu = await ice();
  assert.equal(kotu.ok, false);
  assert.match(kotu.hata, /ev içi adres geçersiz/);
  assert.equal(ortam.ayarOku().koseBildirimi, false, 'reddedilen dosya hiçbir ayarı değiştirmez');

  fs.writeFileSync(dosya, '{ bozuk', 'utf8');
  assert.match((await ice()).hata, /geçerli bir JSON değil/);
  ortam.durum.dosyaSecimi = { canceled: true, filePaths: [] };
  assert.deepEqual(await ice(), { ok: false, iptal: true });
});

ortamda('ayarlar:ice-aktar-onizle: dosyayı ana süreç seçtirir, hiçbir ayarı değiştirmez; yanıt yalnız bölüm adları ve sayılardır; uygulama önizleme numarasıyla yapılır (1.4.0)', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  const onizle = () => ortam.durum.ipc.get('ayarlar:ice-aktar-onizle')(olay);
  const ice = (no) => ortam.durum.ipc.get('ayarlar:ice-aktar')(olay, no);
  const dosya = path.join(ortam.durum.appData, 'onizle.json');
  fs.writeFileSync(dosya, AKTARIM_DOSYASI({
    koseBildirimi: false,
    favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon' }, { entity_id: 'light.eski_lamba', ad: 'Eski' }, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }],
    anahtar: 'SAHTE_ANAHTAR_000000',
  }), 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [dosya] };
  const once = ortam.ayarOku();

  const ilk = await onizle();
  assert.equal(ilk.ok, true);
  assert.equal(ilk.ad, 'onizle.json');
  assert.ok(ilk.bolumler.includes('bildirim') && ilk.bolumler.includes('favoriler'));
  assert.equal(ilk.favoriSayisi, 2, 'kilit favorisi süzgeçte düşer');
  assert.equal(ilk.eksikFavoriSayisi, null, 'cihaz listesi hiç alınmadıysa sayı verilmez');
  assert.deepEqual(ortam.ayarOku(), once, 'önizleme hiçbir ayarı değiştirmez');
  const metin = JSON.stringify(ilk);
  for (const sizmamali of ['SAHTE_ANAHTAR', 'salon_lambasi', 'eski_lamba', 'on_kapi']) assert.ok(!metin.includes(sizmamali), `${sizmamali} renderer'a gitmez`);
  assert.equal(yolSizdiMi(metin, ortam.durum.appData), false, 'renderer\'a klasör yolu gitmez');

  await ortam.durum.ipc.get('cihazlar:getir')(olay); // cihaz listesi alınınca HA'da bulunamayan favori sayılabilir
  const ikinci = await onizle();
  assert.equal(ikinci.eksikFavoriSayisi, 1, 'light.eski_lamba HA\'da yok');
  assert.equal((await ice(ilk.onizlemeNo)).ok, false, 'eski önizleme numarası yeni önizlemeyle geçersizdir');
  assert.equal(ortam.ayarOku().koseBildirimi, true, 'geçersiz numara hiçbir şey uygulamaz');

  const ucuncu = await onizle();
  const sonuc = await ice(ucuncu.onizlemeNo);
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().koseBildirimi, false);
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'light.eski_lamba'], 'GÜVENLİK KURALI: kilit favoriye girmez');
  assert.equal(JSON.stringify(ortam.ayarOku()).includes('SAHTE_ANAHTAR'), false);
  assert.equal((await ice(ucuncu.onizlemeNo)).ok, false, 'numara tek kullanımlıktır');

  ortam.durum.dosyaSecimi = { canceled: true, filePaths: [] };
  assert.deepEqual(await onizle(), { ok: false, iptal: true });
  fs.writeFileSync(dosya, '{ bozuk', 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [dosya] };
  assert.match((await onizle()).hata, /geçerli bir JSON değil/);
});

ortamda('ayarlar:yedekler ve yedekten-don: yalnız ayar klasöründeki beklenen adlı yedekler listelenir ve geri dönülür; yol gezintisi ve olmayan yedek reddedilir (k-13)', {
  ekDosyalar: {
    'ayarlar.v1-yedek.json': JSON.stringify({ semaSurumu: 1, yerelAdres: 'http://192.168.1.77:8123', favoriler: [] }),
    'ayarlar.bozuk-1760000000000.json': '{ bozuk',
    'baska.json': '{}',
  },
}, async (ortam) => {
  const yedekler = await ortam.durum.ipc.get('ayarlar:yedekler')(ayarlarOlayi(ortam));
  assert.equal(yedekler.ok, true);
  assert.deepEqual(yedekler.yedekler.map((y) => y.ad).sort(), ['ayarlar.bozuk-1760000000000.json', 'ayarlar.v1-yedek.json']);
  assert.equal(yedekler.yedekler.find((y) => y.ad === 'ayarlar.bozuk-1760000000000.json').okunabilir, false);
  assert.equal(yolSizdiMi(JSON.stringify(yedekler), ortam.durum.yollar.get('userData')), false, 'renderer\'a klasör yolu gitmez');

  const don = (ad) => ortam.durum.ipc.get('ayarlar:yedekten-don')(ayarlarOlayi(ortam), ad);
  for (const kotu of ['baska.json', '../ayarlar.json', '..\\ayarlar.v1-yedek.json', 'C:\\ayarlar.v1-yedek.json', 'ayarlar.v9-yedek.json', 42, null]) {
    assert.equal((await don(kotu)).ok, false, `${String(kotu)} reddedilmeli`);
  }
  assert.match((await don('ayarlar.bozuk-1760000000000.json')).hata, /geçerli bir JSON değil/);

  const sonuc = await don('ayarlar.v1-yedek.json');
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.ad, 'ayarlar.v1-yedek.json');
  assert.equal(ortam.ayarOku().yerelAdres, 'http://192.168.1.77:8123');
});

ortamda('ayarlar IPC (1.2.0): yeni kanallar da yalnız yerel Ayarlar sayfasından kabul edilir', undefined, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const altCerceve = { sender: olay.sender, senderFrame: { ...olay.senderFrame, parent: {} } };
  for (const kanal of ['ayarlar:disa-aktar', 'ayarlar:ice-aktar-onizle', 'ayarlar:ice-aktar', 'ayarlar:yedekler', 'ayarlar:yedekten-don', 'ayarlar:adres-sina', 'ayarlar:aciksayfa']) {
    for (const kotu of [uzak, baskaPencere, altCerceve]) {
      assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, 'ayarlar.v1-yedek.json'), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
    }
  }
  assert.equal(ortam.durum.dosyaDiyaloglari?.length ?? 0, 0, 'reddedilen istek diyalog açmaz');
});

// --- hata-07: anahtar silme ---------------------------------------------------------------

ortamda('anahtar silme: yalnız yerel dosya silinir ve HA\'daki anahtarın iptal edilmediği açıkça söylenir', { anahtar: true }, async (ortam) => {
  const anahtarYolu = path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat');
  assert.equal(fs.existsSync(anahtarYolu), true);
  const sonuc = await ortam.durum.ipc.get('anahtar:sil')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.mesaj, ANAHTAR_SILINDI_METNI);
  assert.match(sonuc.mesaj, /Home Assistant/);
  assert.equal(fs.existsSync(anahtarYolu), false);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarVar, false);
});

ortamda('anahtar kaydı: doğrulama anahtarsız değil, anahtarla yapılır; diske düz metin yazılmaz', { yoklama: 200 }, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const yeniAnahtar = 'YENI_SAHTE_ANAHTAR_000000';
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), yeniAnahtar);
  assert.deepEqual(sonuc, { ok: true, uyari: '' });
  const dogrulama = ortam.durum.fetchler.find((f) => f.url.endsWith('/api/'));
  assert.equal(dogrulama.basliklar.Authorization, `Bearer ${yeniAnahtar}`);
  const dosya = fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat'));
  assert.equal(dosya.toString('utf8'), SIFRE_ONEKI + yeniAnahtar, 'sahte DPAPI çıktısı yazılır; atomik yazma geçici dosya bırakmaz');
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat.tmp')), false);
});

// ===========================================================================
// Dalga 2 denetim düzeltmeleri
// ===========================================================================

ortamda('onay: bir onay penceresi açıkken gelen ikinci tıklama SESSİZCE yutulmaz; bildirim ve günlük var, pencere kapanınca yine çalışır', TEPSI_AYARI, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  let birak;
  ortam.durum.diyalogBekletici = new Promise((coz) => {
    birak = coz;
  });
  await ortam.akit();
  const birinci = favoriOgesi(ortam, 'PC kapat — onay ister').click(); // onay penceresi açık kalır
  await ortam.akit();
  assert.equal(ortam.durum.diyaloglar.length, 1);

  await favoriOgesi(ortam, 'Salon Lambası').click();
  await ortam.akit();
  assert.equal(ortam.durum.diyaloglar.length, 1, 'ikinci onay penceresi açılmaz');
  assert.deepEqual(postlar(ortam), [], 'hiçbir eylem çalışmaz');
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.equal(ortam.durum.bildirimler[0].body, ONAY_BEKLIYOR_METNI);
  assert.deepEqual(koseMesajlari(ortam), [{ tur: 'hata', metin: ONAY_BEKLIYOR_METNI, sureMs: 3000, malzeme: 'acrylic' }]);
  assert.match(ortam.gunlukOku(), /bekleyen bir onay penceresi var/);

  ortam.durum.diyalogBekletici = null;
  birak(); // birinci pencere "Vazgeç" ile kapanır
  await birinci;
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], 'vazgeçilen eylem çalışmaz');
  await favoriOgesi(ortam, 'Salon Lambası').click();
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, 'onay penceresi kapandıktan sonra tıklamalar yine çalışır');
});

ortamda('ayar dosyası bozuksa sessizce sıfırlanmaz: yedek dosya adıyla açılışta bildirilir ve günlüğe yazılır', { tohum: [] }, async (ortam) => {
  const klasor = ortam.durum.yollar.get('userData');
  const yedekler = fs.readdirSync(klasor).filter((ad) => /^ayarlar\.bozuk-\d+\.json$/.test(ad));
  assert.equal(yedekler.length, 1, 'bozuk dosya silinmez, yedeklenir');
  const bildirim = ortam.durum.bildirimler.find((b) => b.body.startsWith('Ayar dosyası okunamadı'));
  assert.ok(bildirim, 'kullanıcıya bildirildi');
  assert.ok(bildirim.body.includes(yedekler[0]), 'yedek dosya adı bildirimde yazıyor');
  assert.match(ortam.gunlukOku(), /ayarlar\.json bozuktu/);
  assert.deepEqual(ortam.ayarOku().favoriler, []);
});

ortamda('ayar dosyası sağlamsa "bozuk" bildirimi çıkmaz', { tohum: { semaSurumu: 3, favoriler: [] } }, async (ortam) => {
  assert.equal(ortam.durum.bildirimler.some((b) => /okunamadı/.test(b.body)), false);
  assert.deepEqual(fs.readdirSync(ortam.durum.yollar.get('userData')).filter((ad) => /bozuk/.test(ad)), []);
});

// --- Göç öncesi ayar yedeği (src/lib/ayar-yedegi.js): eski şemadaki dosya yeni biçimle ezilmeden önce kopyalanır ---

const yedekAdlari = (ortam) => fs.readdirSync(ortam.durum.yollar.get('userData')).filter((ad) => /^ayarlar\.v\d+-yedek\.json$/.test(ad));

ortamda('göç yedeği: 1.0.0 biçimindeki ayar dosyası ayarlar.v1-yedek.json olarak özgün haliyle saklanır, ayarlar.json yeni biçime geçer', {
  tohum: { yerelAdres: 'http://192.168.1.50:8123', favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] },
}, async (ortam) => {
  const klasor = ortam.durum.yollar.get('userData');
  assert.deepEqual(yedekAdlari(ortam), ['ayarlar.v1-yedek.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(klasor, 'ayarlar.v1-yedek.json'), 'utf8')), {
    yerelAdres: 'http://192.168.1.50:8123',
    favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }],
  }, 'yedek özgün dosyanın aynısı (şema alanı yok)');
  assert.equal(ortam.ayarOku().semaSurumu, 6, 'asıl dosya göçle yeni biçime yazıldı');
  assert.match(ortam.gunlukOku(), /Ayar dosyası göçten önce yedeklendi: ayarlar\.v1-yedek\.json/);
});

ortamda('göç yedeği: yedek zaten varsa üzerine yazılmaz ve göç yine yapılır', {
  tohum: { favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] },
  ekDosyalar: { 'ayarlar.v1-yedek.json': '{"onceki":"yedek"}' },
}, async (ortam) => {
  const klasor = ortam.durum.yollar.get('userData');
  assert.equal(fs.readFileSync(path.join(klasor, 'ayarlar.v1-yedek.json'), 'utf8'), '{"onceki":"yedek"}');
  assert.equal(ortam.ayarOku().semaSurumu, 6);
  assert.equal(ortam.ayarOku().favoriler.length, 1);
  assert.doesNotMatch(ortam.gunlukOku(), /yedeklendi|yedeği alınamadı/);
});

ortamda('göç yedeği: şema güncelse yedek dosyası oluşmaz', { tohum: { semaSurumu: 6, favoriler: [] } }, async (ortam) => {
  assert.deepEqual(yedekAdlari(ortam), []);
  assert.doesNotMatch(ortam.gunlukOku(), /yedeklendi|yedeği alınamadı/);
});

ortamda('göç yedeği: dosya bozuksa yalnız mevcut "bozuk" yedeği alınır, göç yedeği alınmaz', { tohum: [] }, async (ortam) => {
  assert.deepEqual(yedekAdlari(ortam), []);
  assert.equal(fs.readdirSync(ortam.durum.yollar.get('userData')).filter((ad) => /^ayarlar\.bozuk-\d+\.json$/.test(ad)).length, 1);
});

test('göç yedeği: kopyalama başarısız olursa açılış sürer, favoriler korunur, günlüğe sırsız tek satır yazılır', async () => {
  const gercek = fs.copyFileSync;
  const kopya = mock.method(fs, 'copyFileSync', (...bagimsiz) => {
    if (/ayarlar\.v\d+-yedek\.json$/.test(String(bagimsiz[1]))) throw Object.assign(new Error(`EPERM: ${bagimsiz[1]} TEST_ANAHTAR_SAHTE_000000`), { code: 'EPERM' });
    return gercek(...bagimsiz);
  });
  let ortam;
  try {
    ortam = await ortamKur({ tohum: { favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] } });
    assert.equal(kopya.mock.calls.length >= 1, true, 'yedek denendi');
    assert.deepEqual(yedekAdlari(ortam), []);
    const ayar = ortam.ayarOku();
    assert.equal(ayar.semaSurumu, 6, 'göç yedeksiz de tamamlandı');
    assert.equal(ayar.favoriler.length, 1, 'favori silinmedi');
    const satirlar = ortam.gunlukOku().split('\n').filter((s) => /yedeği alınamadı/.test(s));
    assert.equal(satirlar.length, 1);
    assert.match(satirlar[0], /\(EPERM\); göç yine de sürüyor\.$/);
    assert.ok(!ortam.gunlukOku().includes('TEST_ANAHTAR_SAHTE_000000'), 'hata iletisi günlüğe girmez');
  } finally {
    kopya.mock.restore();
    await ortam?.temizle();
  }
});

ortamda('ayarlar diske yazılamıyorsa "kaydedildi" denmez: ayarlar:kaydet ve favoriler:kaydet ok:false döner; engel kalkınca yine çalışır', AYAR_EKRANI, async (ortam) => {
  haKur(ortam.durum, AYAR_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  // Geçici dosyanın yerine klasör koymak yazmayı bozar (disk dolu / kilitli dosya taklidi).
  const engel = path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json.tmp');
  fs.mkdirSync(engel);

  assert.deepEqual(await ortam.durum.ipc.get('favoriler:kaydet')(olay, [{ entity_id: 'light.salon_lambasi' }]), { ok: false, hata: AYAR_YAZILAMADI_METNI });
  assert.deepEqual(await ayarlarKaydet(ortam, { koseBildirimi: false }), { ok: false, hata: AYAR_YAZILAMADI_METNI });
  assert.match(ortam.gunlukOku(), /ayarlar\.json yazılamadı/);
  assert.equal(ortam.ayarOku().favoriler.length, 3, 'diskteki dosya değişmedi');

  fs.rmSync(engel, { recursive: true });
  assert.equal((await ayarlarKaydet(ortam, { koseBildirimi: false })).ok, true);
  assert.equal(ortam.ayarOku().koseBildirimi, false);
});

// --- ev içi adres http: anahtar şifresiz gider (hata-01'de kabul edilmiş risk, açılışta hatırlatılır) ---

ortamda('http uyarısı: ev içi adres http ve anahtar varsa açılışta günlüğe sabit satır + Windows bildirimi BİR kez', { anahtar: true, yoklama: 200 }, async (ortam) => {
  assert.equal(ortam.durum.httpUyarilari.length, 1);
  assert.equal(ortam.durum.httpUyarilari[0].body, HTTP_ANAHTAR_UYARISI);
  assert.ok(ortam.gunlukOku().includes(HTTP_ANAHTAR_GUNLUK_SATIRI));
  assert.equal(ortam.ayarOku().httpUyarisiAdresi, 'http://192.168.1.10:8123', 'gösterildi diye kaydedilir');
});

ortamda('http uyarısı: aynı adres için daha önce bildirildiyse Windows bildirimi çıkmaz (günlük satırı yine yazılır)', {
  anahtar: true,
  yoklama: 200,
  tohum: { semaSurumu: 3, httpUyarisiAdresi: 'http://192.168.1.10:8123' },
}, async (ortam) => {
  assert.deepEqual(ortam.durum.httpUyarilari, []);
  assert.ok(ortam.gunlukOku().includes(HTTP_ANAHTAR_GUNLUK_SATIRI));
});

ortamda('http uyarısı: adres değiştiyse (başka bir http adresi) yeniden bildirilir', {
  anahtar: true,
  yoklama: 200,
  tohum: { semaSurumu: 3, yerelAdres: 'http://192.168.1.50:8123', httpUyarisiAdresi: 'http://192.168.1.10:8123' },
}, async (ortam) => {
  assert.equal(ortam.durum.httpUyarilari.length, 1);
  assert.equal(ortam.ayarOku().httpUyarisiAdresi, 'http://192.168.1.50:8123');
});

ortamda('http uyarısı: Tailscale/CGNAT aralığındaki (100.64.0.0/10) http ev içi adres için de çıkar (Tailscale kapalıyken anahtar şifresiz gider)', {
  anahtar: true,
  yoklama: 200,
  tohum: { semaSurumu: 3, yerelAdres: 'http://100.101.102.103:8123' },
}, async (ortam) => {
  assert.equal(ortam.durum.httpUyarilari.length, 1);
  assert.equal(ortam.durum.httpUyarilari[0].body, HTTP_ANAHTAR_UYARISI);
  assert.ok(ortam.gunlukOku().includes(HTTP_ANAHTAR_GUNLUK_SATIRI));
  assert.equal(ortam.ayarOku().httpUyarisiAdresi, 'http://100.101.102.103:8123');
});

ortamda('http uyarısı: ev içi adres https ise ya da erişim anahtarı yoksa hiç çıkmaz', {
  anahtar: true,
  yoklama: 200,
  tohum: { semaSurumu: 3, yerelAdres: 'https://ha.ev.lan:8123' },
}, async (ortam) => {
  assert.deepEqual(ortam.durum.httpUyarilari, []);
  assert.ok(!ortam.gunlukOku().includes(HTTP_ANAHTAR_GUNLUK_SATIRI));
});

ortamda('http uyarısı: erişim anahtarı yokken (anahtar gitmiyor) çıkmaz', { yoklama: 200 }, async (ortam) => {
  assert.deepEqual(ortam.durum.httpUyarilari, []);
  assert.ok(!ortam.gunlukOku().includes(HTTP_ANAHTAR_GUNLUK_SATIRI));
});

// ===========================================================================
// Dalga 3: hızlı panel, palet, kısayollar, komut satırı, canlı bağlantı, hazır liste
// ===========================================================================

const YUZEY_HTML = path.join(KOK_DIZIN, 'src', 'yuzey.html');
const EKRAN_KAPAT = { entity_id: 'button.pc_ekran_kapat', ad: 'Ekranı Kapat' };
const D3_VARLIKLARI = [
  ...HA_VARLIKLARI,
  durumNesnesi('button.pc_ekran_kapat', 'Ekranı Kapat', 'unknown'),
  durumNesnesi('scene.film', 'Film', 'unknown'),
];
/** Dalga 3 ayarları (şema 4): hazır liste uygulanmış sayılır, böylece yalnız verilen favoriler vardır. */
const dalga3 = (favoriler, ek = {}, secenek = {}) => ({
  yoklama: 200,
  anahtar: true,
  ...secenek,
  tohum: { semaSurumu: 4, hazirListeSurumu: 1, favoriler, ...ek },
});
const yuzeyOlayi = (ortam, pencere = ortam.yuzeyPenceresi()) => ({
  sender: pencere.webContents,
  senderFrame: { url: pathToFileURL(YUZEY_HTML).href, parent: null },
});
const yuzeyMesajlari = (ortam, kanal) => (ortam.yuzeyPenceresi()?.webContents.mesajlar ?? []).filter((m) => m.kanal === kanal).map((m) => m.yuk);

/** Paneli tepsi tıklamasıyla açar ve sayfanın yüklenmesini bekler. */
async function paneliAc(ortam) {
  ortam.tepsi.emit('click');
  await ortam.akit();
  return ortam.yuzeyPenceresi();
}

// --- hızlı panel (hiz-02) ------------------------------------------------------------

ortamda('hızlı panel: tepsi sol tık varsayılan olarak paneli tepsinin yanında açar, ana pencereye dokunmaz; ikinci tık kapatır', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const anaOnce = { show: ortam.pencere.cagri.show, hide: ortam.pencere.cagri.hide };
  const panel = await paneliAc(ortam);
  assert.ok(panel, 'panel penceresi oluşturuldu');
  assert.equal(panel.gorunur, true);
  assert.equal(panel.odakta, true);
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'acrylic', etkilesim: { tekerlek: true, sabit: false } }]);
  assert.deepEqual({ show: ortam.pencere.cagri.show, hide: ortam.pencere.cagri.hide }, anaOnce, 'ana pencere değişmedi');
  const s = panel.sinirlar;
  assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.width <= 1920 && s.y + s.height <= 1040, 'panel çalışma alanının içinde');
  assert.ok(s.x > 1920 / 2 && s.y > 1040 / 2, 'panel tepsiye (sağ alt) yakın');
  assert.equal(panel.secenekler.webPreferences.sandbox, true);
  assert.equal(panel.secenekler.webPreferences.contextIsolation, true);
  assert.equal(panel.secenekler.webPreferences.nodeIntegration, false);
  assert.equal(panel.secenekler.skipTaskbar, true);

  ortam.ilerle(600); // çift tık süresi (k-17) geçti: bu ikinci tık değil yeni bir tık
  ortam.tepsi.emit('click'); // odaktaki panel: tepsi tıklaması kapatır
  assert.equal(panel.gorunur, false);
  ortam.ilerle(5000);
  ortam.tepsi.emit('click');
  assert.equal(panel.gorunur, true, 'yeniden açılır (aynı pencere kullanılır)');
  assert.equal(ortam.durum.pencereler.filter((p) => /Hızlı Panel/.test(p.secenekler.title ?? '')).length, 1);
});

ortamda('hızlı panel: odak kaybında kısa bir gecikmeyle kapanır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.equal(panel.gorunur, true);
  panel.odakKaybet();
  ortam.ilerle(500);
  assert.equal(panel.gorunur, false);
});

ortamda('hızlı panel: ayar tepsiSolTik "pencere" ise sol tık ESKİ geniş pencereyi açar/kapatır, panel hiç oluşmaz', dalga3([SALON], { tepsiSolTik: 'pencere' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  ortam.pencere.odakKaybet();
  ortam.ilerle(100);
  ortam.tepsi.emit('click');
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false);
  assert.equal(ortam.yuzeyPenceresi(), undefined, 'hızlı panel istenmedi');
});

// --- IPC: yalnız yüzey sayfasından, açık kipin kaynağıyla ---------------------------------

ortamda('yüzey IPC: yalnız yüzey sayfası kabul edilir; panel kapalıyken ya da başka gönderenden gelen istek POST üretmez', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const uzak = { sender: panel.webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baska = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const altCerceve = { sender: panel.webContents, senderFrame: { ...olay.senderFrame, parent: {} } };
  for (const kanal of ['yuzey:durum-al', 'yuzey:calistir', 'yuzey:basili-basla', 'yuzey:basili-birak', 'yuzey:ha-ac', 'yuzey:ayarlar-ac']) {
    for (const kotu of [uzak, baska, altCerceve]) {
      assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, { kimlik: 'light.salon_lambasi' }), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
    }
  }
  assert.deepEqual(postlar(ortam), []);

  const sonuc = await ortam.durum.ipc.get('yuzey:calistir')(olay, { kimlik: 'light.salon_lambasi' });
  assert.equal(sonuc.ok, true);
  assert.equal(postlar(ortam).length, 1);

  ortam.durum.ipc.get('yuzey:kapat')(olay);
  assert.equal(panel.gorunur, false);
  const gizliyken = await ortam.durum.ipc.get('yuzey:calistir')(olay, { kimlik: 'light.salon_lambasi' });
  assert.deepEqual(gizliyken, { ok: false, tur: 'gecersiz' }, 'pencere gizliyken gelen istek kabul edilmez');
  assert.equal(postlar(ortam).length, 1);
});

ortamda('yüzey IPC: yıkıcı eylem yalnız ana süreçte doğrulanan ~0,8 sn basılı tutmayla çalışır; renderer onayı kendi bildiremez', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const calistir = ortam.durum.ipc.get('yuzey:calistir');
  const basla = ortam.durum.ipc.get('yuzey:basili-basla');

  // 1. "basili: true" iddiası tek başına yetmez (basılı tutma başlamadı)
  assert.equal((await calistir(olay, { kimlik: PC_KAPAT.entity_id, basili: true })).tur, 'onay-gerekli');
  // 2. çok kısa tutma
  assert.deepEqual(await basla(olay, PC_KAPAT.entity_id), { ok: true });
  ortam.ilerle(300);
  assert.equal((await calistir(olay, { kimlik: PC_KAPAT.entity_id, basili: true })).tur, 'onay-gerekli', '0,3 sn yetmez');
  assert.deepEqual(postlar(ortam), []);
  // 3. yeterli tutma: tek POST, ikinci kullanım yeni tutma ister
  assert.deepEqual(await basla(olay, PC_KAPAT.entity_id), { ok: true });
  ortam.ilerle(900);
  const tamam = await calistir(olay, { kimlik: PC_KAPAT.entity_id, basili: true });
  assert.equal(tamam.ok, true);
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/button/press');
  assert.equal((await calistir(olay, { kimlik: PC_KAPAT.entity_id, basili: true })).tur, 'onay-gerekli', 'onay tek kullanımlık');
  assert.equal(postlar(ortam).length, 1);
  // 4. favori olmayan kimlik için basılı tutma başlamaz
  assert.deepEqual(await basla(olay, 'light.favori_degil'), { ok: false });
});

ortamda('yüzey IPC: kapı/kilit/garaj kimlikleri hiçbir yüzey isteğiyle çalışmaz (favoride olsa bile süzülür)', dalga3([SALON, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }, { entity_id: 'light.garaj_lambasi', ad: 'Garaj Lambası' }]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'), durumNesnesi('light.garaj_lambasi', 'Garaj Lambası', 'off')]);
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi'], 'açılışta ayardan çıkarıldı');
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  for (const kimlik of ['lock.on_kapi', 'light.garaj_lambasi']) {
    for (const yuk of [{ kimlik }, { kimlik, basili: true }, { kimlik, parlaklik: 10 }]) {
      assert.equal((await ortam.durum.ipc.get('yuzey:calistir')(olay, yuk)).ok, false);
    }
  }
  const model = (await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model;
  assert.equal(JSON.stringify(model).match(/kapi|garaj|lock\./i), null, "model renderer'a bile gitmez");
  assert.deepEqual(postlar(ortam), []);
});

// --- palet (hiz-01) ve kısayollar (hiz-05) ----------------------------------------------

ortamda('palet: Control+Alt+P kısayolu kayıtlıdır; basınca palet açılır, tekrar basınca kapanır; palet panelle AYNI pencereyi kullanır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const kisayol = ortam.durum.kisayollar.get('Control+Alt+P');
  assert.ok(kisayol, 'palet kısayolu kaydedildi');
  kisayol();
  await ortam.akit();
  const palet = ortam.yuzeyPenceresi();
  assert.equal(palet.gorunur, true);
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'palet', malzeme: 'acrylic', etkilesim: { tekerlek: true, sabit: false } }]);
  assert.equal(palet.sinirlar.width, 560, 'palet genişliği');
  ortam.ilerle(1000); // yinelenen tetikleme engeli: ikinci BASIŞ ancak sönümleme süresinden sonra sayılır (tuş tekrarı değil)
  kisayol();
  assert.equal(palet.gorunur, false);
  ortam.ilerle(1000);
  kisayol();
  await ortam.akit();
  assert.equal(palet.gorunur, true);
  assert.equal(ortam.durum.pencereler.filter((p) => /Hızlı Panel/.test(p.secenekler.title ?? '')).length, 1);
});

ortamda('palet: paletKisayol boş bırakılırsa palet kısayolu hiç kaydedilmez', dalga3([SALON], { paletKisayol: '' }), async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+P'), false);
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+H'), 'ana kısayol yine var');
});

ortamda('kısayol: zararsız favoriye atanan kısayol kaydedilir ve tek POST çalıştırır; yıkıcı/kapı favorisine atanan hiç kaydedilmez', dalga3([
  { ...SALON, kisayol: 'Control+Alt+L' },
  { ...PC_KAPAT, kisayol: 'Control+Alt+K' }, // Control+Alt+Z artık varsayılan "geri al" kısayoludur (o-12)
  { entity_id: 'lock.on_kapi', ad: 'Ön Kapı', kisayol: 'Control+Alt+D' },
]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+L'));
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+K'), false, 'yıkıcı eylem kısayola bağlanmaz');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+D'), false, 'kapı/kilit kısayola bağlanmaz');
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'button.pc_bilgisayari_kapat']);
  assert.equal(ortam.ayarOku().favoriler[1].kisayol, undefined, 'yıkıcı favoride kısayol saklanmaz');

  await ortam.durum.kisayollar.get('Control+Alt+L')();
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.equal(ortam.yuzeyPenceresi(), undefined, 'kısayol hiçbir pencere açmaz');
});

ortamda('kısayol: aynı kısayol iki eyleme atanamaz; çakışan ikincisi reddedilir ve ayar özetinde nedeni görünür', dalga3([
  { ...SALON, kisayol: 'Control+Alt+L' },
  { entity_id: 'scene.film', ad: 'Film', kisayol: 'Control+Alt+L' },
]), async (ortam) => {
  await ortam.akit();
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  const durumlar = ozet.kisayolDurumlari.filter((d) => d.kisayol === 'Control+Alt+L');
  assert.equal(durumlar.length, 2);
  assert.deepEqual(durumlar.map((d) => d.gecerli), [true, false]);
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+L'));
});

ortamda('kısayol: başka uygulamanın aldığı kısayol açılışta "alınamadı" olarak raporlanır', { ...dalga3([{ ...SALON, kisayol: 'Control+Alt+L' }]), kisayolReddi: ['Control+Alt+L'] }, async (ortam) => {
  await ortam.akit();
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  const d = ozet.kisayolDurumlari.find((x) => x.kisayol === 'Control+Alt+L');
  assert.equal(d.durum, 'alinamadi');
  assert.match(d.mesaj, /kaydedilemedi/);
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+L'), false);
});

// --- komut satırı (hiz-05) --------------------------------------------------------------

ortamda('komut satırı: ikinci kopyadan gelen --eylem=<ad> eylemi çalıştırır ve HİÇBİR pencere açmaz', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  tusBas(ortam.pencere, ctrlW); // ana pencere gizli
  assert.equal(ortam.pencere.gorunur, false);
  const gosterOnce = ortam.pencere.cagri.show;
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=salon lambası'], 'C:\\', { eylem: 'salon lambası' });
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere açılmadı');
  assert.equal(ortam.pencere.cagri.show, gosterOnce);
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'panel de açılmadı');
});

ortamda("komut satırı: argv'den de çözülür; belirsiz ad, bilinmeyen ad ve yıkıcı eylem HİÇBİR şey çalıştırmaz", dalga3([
  SALON,
  { entity_id: 'light.salon_ledi', ad: 'Salon Ledi' },
  PC_KAPAT,
]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('light.salon_ledi', 'Salon Ledi', 'off')]);
  await ortam.akit();
  const gonder = async (ad) => {
    ortam.app.emit('second-instance', {}, ['ev-paneli.exe', `--eylem=${ad}`], 'C:\\');
    await ortam.akit();
  };
  await gonder('salon'); // iki eşleşme: belirsiz
  await gonder('yok boyle bir sey');
  await gonder('PC kapat'); // yıkıcı: komut satırından asla
  await gonder('Bilgisayarı Kapat');
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.diyaloglar, [], 'komut satırı onay penceresi de açmaz');
  await gonder('salon ledi');
  assert.equal(postlar(ortam).length, 1);
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: 'light.salon_ledi' });
});

ortamda('komut satırı: kapı/kilit adları çözülmez; --eylem olmayan ikinci kopya pencereyi öne getirir (eski davranış)', dalga3([SALON, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=Ön Kapı'], 'C:\\');
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem='], 'C:\\');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);

  ortam.ilerle(400);
  tusBas(ortam.pencere, ctrlW);
  ortam.ilerle(5000);
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe'], 'C:\\');
  assert.equal(ortam.pencere.gorunur, true);
});

ortamda('komut satırı (h-22): "--eylem <ad>" (eşittirsiz) ve tırnaksız "--eylem=salon lambası" (ardışık argümanlar) eylemi çalıştırır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem', 'salon lambası'], 'C:\\');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  ortam.ilerle(2000);
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=salon', 'lambası', '--gizli'], 'C:\\');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2, 'ardışık argümanlar ada eklenir, --gizli ada girmez');
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('komut satırı (h-22): anlaşılmayan --eylem (ad yok, tek harf, bulunamayan ad) sessiz kalmaz: hata bildirilir, hiçbir şey çalışmaz', dalga3([SALON, { entity_id: 'scene.film', ad: 'Film' }]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('scene.film', 'Film', 'unknown')]);
  await ortam.akit();
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem'], 'C:\\'); // ad yok
  await ortam.akit();
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /geçersiz/);
  ortam.ilerle(2000);
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=f'], 'C:\\'); // tek harf Film'i çalıştırmaz
  await ortam.akit();
  assert.equal(ortam.durum.bildirimler.length, 2);
  assert.match(ortam.durum.bildirimler[1].body, /bulunamadı/);
  assert.deepEqual(postlar(ortam), []);
});

ortamda('komut satırı (h-22): uygulama kapalıyken "--eylem <ad>" ile açılış pencere AÇMAZ ve eylemi hazır olunca çalıştırır', { ...dalga3([SALON]), acilisArgv: ['--eylem', 'salon', 'lambası'], ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere açılmadı');
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('komut satırı (soğuk açılış): "--eylem <ad>" ilk durum okuması bitince çalışır; HA\'daki güncel adla eşleşir (kayıtlı ad eskimiş olsa da)', { ...dalga3([{ entity_id: 'light.oturma_1', ad: 'Eski ad' }]), acilisArgv: ['--eylem', 'salon', 'lambası'], ha: [durumNesnesi('light.oturma_1', 'Salon Lambası', 'off')] }, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere açılmadı');
  assert.equal(postlar(ortam).length, 1, 'durum okunmadan çalışsaydı "bulunamadı" olurdu');
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: 'light.oturma_1' });
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('komut satırı (soğuk açılış): HA yanıt vermezse bekleme sınırlıdır; eylem yine denenir ve başarısızlık söylenir (sonsuza dek asılı kalmaz)', {
  ...dalga3([{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }]),
  acilisArgv: ['--eylem', 'salon', 'lambası'],
  apiYaniti: (url, secenek) => (new URL(url).pathname === '/api/' && (secenek.method ?? 'GET') === 'GET' ? new Response(JSON.stringify({ message: 'API running.' }), { status: 200 }) : new Promise(() => {})), // doğrulama geçer, gerisi yanıtsız
}, async (ortam) => {
  await ortam.akit();
  assert.deepEqual(ortam.durum.bildirimler, [], 'ilk okuma sürerken eylem bekler');
  for (let i = 0; i < 6; i += 1) {
    ortam.ilerle(10_000);
    await ortam.akit();
  }
  assert.equal(ortam.pencere.gorunur, false);
  assert.equal(ortam.durum.bildirimler.length, 1, 'bekleme bitti: eylem çalıştı ve başarısızlığını söyledi');
  assert.match(ortam.durum.bildirimler[0].body, /yanıt vermedi/);
  assert.deepEqual(postlar(ortam), []);
});

ortamda('komut satırı (h-22): uygulama kapalıyken anlaşılmayan "--eylem" ile açılış da pencere açmaz ve hata bildirir (sessizce yok sayılmaz)', { ...dalga3([SALON]), acilisArgv: ['--eylem'] }, async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere açılmadı');
  assert.deepEqual(postlar(ortam), []);
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /geçersiz/);
});

ortamda('komut satırı (h-23): "led 0" ışığı kapatır (turn_off), "led %40" parlaklık verir; kısılamayan ışıkta sayı aç/kapat yapmaz', dalga3([
  { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
]), async (ortam) => {
  haKur(ortam.durum, [durumNesnesi('light.led_serit', 'LED şerit', 'on'), durumNesnesi('light.ampul', 'Ampul', 'on')]);
  await ortam.akit();
  const gonder = async (ad) => {
    ortam.app.emit('second-instance', {}, ['ev-paneli.exe', `--eylem=${ad}`], 'C:\\');
    await ortam.akit();
    ortam.ilerle(2000);
  };
  await gonder('led 0');
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/turn_off');
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: 'light.led_serit' });
  await gonder('led %40');
  assert.equal(postlar(ortam).length, 2);
  assert.deepEqual(JSON.parse(postlar(ortam)[1].govde), { entity_id: 'light.led_serit', brightness_pct: 40 });
  await gonder('ampul 0');
  await gonder('ampul 40');
  assert.equal(postlar(ortam).length, 2, 'kısılamayan ışıkta sayı aç/kapat yapmaz');
});

// --- kesin yön (o-13): "led +10", "salon ac", eylem kısayolu ------------------------------------

const yonVarlik = (kimlik, ad, state, nitelik = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: ad, ...nitelik } });

ortamda('komut satırı (o-13): "led +10" / "led -10" HA\'daki güncel parlaklığa göre tek POST; "salon ac" / "salon kapat" sabit turn_on / turn_off', dalga3([
  { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
]), async (ortam) => {
  haKur(ortam.durum, [yonVarlik('light.led_serit', 'LED şerit', 'on', { brightness: 128 }), yonVarlik('light.ampul', 'Ampul', 'off')]);
  await ortam.akit();
  const gosterOnce = ortam.pencere.cagri.show;
  const gonder = async (ad) => {
    ortam.app.emit('second-instance', {}, ['ev-paneli.exe', `--eylem=${ad}`], 'C:\\');
    await ortam.akit();
    ortam.ilerle(2000);
  };
  await gonder('led +10');
  await gonder('led -10');
  assert.deepEqual(postlar(ortam).map((p) => [p.url.replace('http://192.168.1.10:8123', ''), JSON.parse(p.govde)]), [
    ['/api/services/light/turn_on', { entity_id: 'light.led_serit', brightness_pct: 60 }],
    ['/api/services/light/turn_on', { entity_id: 'light.led_serit', brightness_pct: 40 }],
  ]);
  await gonder('ampul ac');
  await gonder('ampul kapat');
  assert.deepEqual(postlar(ortam).slice(2).map((p) => [p.url.replace('http://192.168.1.10:8123', ''), JSON.parse(p.govde)]), [
    ['/api/services/light/turn_on', { entity_id: 'light.ampul' }],
    ['/api/services/light/turn_off', { entity_id: 'light.ampul' }],
  ]);
  await gonder('ampul +10'); // kısılamayan ışığa adım uygulanmaz
  assert.equal(postlar(ortam).length, 4);
  assert.equal(ortam.pencere.cagri.show, gosterOnce, 'komut satırı ana pencereyi açmaz');
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'panel de açılmadı');
});

ortamda('komut satırı (o-13): tırnaksız "--eylem=led -10" (eksi adım ayrı argüman) seçenek sayılmaz; kapı lambası ve kilit yön komutuyla da çalışmaz', dalga3([
  { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' },
]), async (ortam) => {
  haKur(ortam.durum, [yonVarlik('light.led_serit', 'LED şerit', 'on', { brightness: 255 }), yonVarlik('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=led', '-10'], 'C:\\');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, '"led" tek başına aç-kapa değil, "-10" adımı uygulanır');
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: 'light.led_serit', brightness_pct: 90 });
  for (const ad of ['on kapi ac', 'on kapi kapat', 'lock.on_kapi ac']) {
    ortam.ilerle(2000);
    ortam.app.emit('second-instance', {}, ['ev-paneli.exe', `--eylem=${ad}`], 'C:\\');
    await ortam.akit();
  }
  assert.equal(postlar(ortam).length, 1, 'kilit yönlü komutla da çalışmaz');
});

ortamda('eylem kısayolu (o-13): favoride kisayolEylemi varsa kısayol kesin yönü uygular (parlak+20 -> tek POST); geçersiz kayıt yükte düşer', dalga3([
  { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true, kisayol: 'Control+Alt+L', kisayolEylemi: 'parlak+20' },
  { entity_id: 'light.ampul', ad: 'Ampul', kisayol: 'Control+Alt+M', kisayolEylemi: 'parlak+10' }, // parlaklık kontrolü yok: yüklemede düşer
  { entity_id: 'switch.priz', ad: 'Priz', kisayol: 'Control+Alt+N', kisayolEylemi: 'kapat' },
]), async (ortam) => {
  haKur(ortam.durum, [
    yonVarlik('light.led_serit', 'LED şerit', 'on', { brightness: 128 }),
    yonVarlik('light.ampul', 'Ampul', 'off'),
    yonVarlik('switch.priz', 'Priz', 'on'),
  ]);
  await ortam.akit();
  const kayit = ortam.ayarOku().favoriler;
  assert.equal(kayit.find((f) => f.entity_id === 'light.led_serit').kisayolEylemi, 'parlak+20');
  assert.equal('kisayolEylemi' in kayit.find((f) => f.entity_id === 'light.ampul'), false, 'geçersiz eylem diskte de kalmaz');
  assert.equal(kayit.find((f) => f.entity_id === 'switch.priz').kisayolEylemi, 'kapat');

  await ortam.durum.kisayollar.get('Control+Alt+L')();
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.durum.kisayollar.get('Control+Alt+M')(); // eylemi düştü: aç-kapa
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.durum.kisayollar.get('Control+Alt+N')();
  await ortam.akit();
  assert.deepEqual(postlar(ortam).map((p) => [p.url.replace('http://192.168.1.10:8123', ''), JSON.parse(p.govde)]), [
    ['/api/services/light/turn_on', { entity_id: 'light.led_serit', brightness_pct: 70 }],
    ['/api/services/light/toggle', { entity_id: 'light.ampul' }],
    ['/api/services/switch/turn_off', { entity_id: 'switch.priz' }],
  ]);
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'kısayol paneli açmaz');
});

ortamda('Ayarlar (o-13): cihaz listesi kisayolEylemleri taşır; kayıtta kisayolEylemi saklanır, geçersizi eylemHatalari ile bildirilir', dalga3([
  { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true },
]), async (ortam) => {
  haKur(ortam.durum, [
    yonVarlik('light.led_serit', 'LED şerit', 'on', { brightness: 128 }),
    yonVarlik('light.ampul', 'Ampul', 'off'),
    yonVarlik('fan.vantilator', 'Vantilatör', 'on', { percentage: 50 }),
    yonVarlik('scene.film', 'Film', 'unknown'),
    yonVarlik('light.kapi_lambasi', 'Kapı lambası', 'on'),
  ]);
  await ortam.akit();
  const olay = ayarlarOlayi(ortam);
  const liste = await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const eylemleri = Object.fromEntries(liste.cihazlar.map((c) => [c.entity_id, c.kisayolEylemleri]));
  assert.deepEqual(eylemleri['light.led_serit'], ['ac', 'kapat', 'parlak+5', 'parlak+10', 'parlak+20', 'parlak-5', 'parlak-10', 'parlak-20']);
  assert.deepEqual(eylemleri['fan.vantilator'], ['ac', 'kapat', 'hiz+10', 'hiz+20', 'hiz-10', 'hiz-20']);
  assert.deepEqual(eylemleri['scene.film'], [], 'sahnenin yönlü eylemi yok');
  assert.equal('light.kapi_lambasi' in eylemleri, false, 'kapı lambası renderer\'a hiç gitmez');

  const sonuc = await ortam.durum.ipc.get('favoriler:kaydet')(olay, [
    { entity_id: 'light.led_serit', parlaklik: true, kisayol: 'Control+Alt+L', kisayolEylemi: 'parlak-10' },
    { entity_id: 'light.ampul', kisayol: 'Control+Alt+M', kisayolEylemi: 'parlak+10' }, // parlaklık kontrolü yok
    { entity_id: 'fan.vantilator', kisayol: 'Control+Alt+V', kisayolEylemi: 'hiz+20' },
  ]);
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.eylemHatalari, [{ entity_id: 'light.ampul', neden: 'gecersiz' }]);
  assert.deepEqual(sonuc.kisayolHatalari, []);
  const kayit = Object.fromEntries(ortam.ayarOku().favoriler.map((f) => [f.entity_id, f]));
  assert.equal(kayit['light.led_serit'].kisayolEylemi, 'parlak-10');
  assert.equal(kayit['light.ampul'].kisayol, 'Control+Alt+M', 'kısayol yine kaydedilir');
  assert.equal('kisayolEylemi' in kayit['light.ampul'], false);
  assert.equal(kayit['fan.vantilator'].kisayolEylemi, 'hiz+20');
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.equal(ozet.favoriler.find((f) => f.entity_id === 'light.led_serit').kisayolEylemi, 'parlak-10', 'ayar özeti eylemi taşır');
  assert.deepEqual(postlar(ortam), [], 'kaydetmek HA\'ya hiçbir servis çağrısı göndermez');
});

// --- pencere ve durum komutları (o-19) -----------------------------------------------------

const pencereKomutuGonder = async (ortam, argv, dizin = 'C:\\') => {
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', ...argv], dizin);
  await ortam.akit();
};

ortamda('komut satırı (o-19): --gizle / --goster / --degistir ana pencereyi yönetir; servis çağrısı yok, bildirim yok', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  assert.equal(ortam.pencere.gorunur, true);
  await pencereKomutuGonder(ortam, ['--gizle']);
  assert.equal(ortam.pencere.gorunur, false);
  const gizleSayisi = ortam.pencere.cagri.hide;
  await pencereKomutuGonder(ortam, ['--gizle']); // zaten gizli: değişmez
  assert.equal(ortam.pencere.cagri.hide, gizleSayisi);
  await pencereKomutuGonder(ortam, ['--goster']);
  assert.equal(ortam.pencere.gorunur, true);
  await pencereKomutuGonder(ortam, ['--GOSTER', '--hedef=ana']); // zaten görünür: gösterim yinelenir ama gizlenmez
  assert.equal(ortam.pencere.gorunur, true);
  await pencereKomutuGonder(ortam, ['--degistir']);
  assert.equal(ortam.pencere.gorunur, false, 'görünürken değiştir gizler');
  await pencereKomutuGonder(ortam, ['--degistir']);
  assert.equal(ortam.pencere.gorunur, true, 'gizliyken değiştir gösterir');
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.bildirimler, []);
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false);
});

ortamda('komut satırı (o-19): --hedef=panel / palet hızlı yüzeyi açar, kapatır ve değiştirir; başka kipte açık yüzeye dokunmaz', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const anaOnce = ortam.pencere.cagri.show;
  await pencereKomutuGonder(ortam, ['--goster', '--hedef=panel']);
  const yuzey = ortam.yuzeyPenceresi();
  assert.ok(yuzey?.gorunur, 'panel açıldı');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster').at(-1)?.mod, 'panel');
  await pencereKomutuGonder(ortam, ['--gizle', '--hedef=palet']); // palet açık değil: panel kapanmaz
  assert.equal(yuzey.gorunur, true);
  await pencereKomutuGonder(ortam, ['--degistir', '--hedef=panel']);
  assert.equal(yuzey.gorunur, false, 'panel kapandı');
  await pencereKomutuGonder(ortam, ['--degistir', '--hedef', 'palet']);
  assert.equal(yuzey.gorunur, true);
  assert.equal(yuzeyMesajlari(ortam, 'yuzey:goster').at(-1)?.mod, 'palet');
  await pencereKomutuGonder(ortam, ['--gizle', '--hedef=palet']);
  assert.equal(yuzey.gorunur, false);
  assert.equal(ortam.pencere.cagri.show, anaOnce, 'ana pencereye dokunulmadı');
  assert.deepEqual(postlar(ortam), []);
});

ortamda('komut satırı (o-19): geçersiz ve çakışan komutlar hata bildirir, hiçbir şey çalıştırmaz (pencere değişmez, POST yok)', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const sirali = [
    [['--goster', '--gizle'], /birden çok komut/],
    [['--goster', '--eylem=salon lambası'], /birden çok komut/],
    [['--durum', '--goster'], /birden çok komut/],
    [['--goster', '--hedef=ayarlar'], /anlaşılamadı/],
    [['--goster=x'], /anlaşılamadı/],
    [['--hedef=panel'], /anlaşılamadı/],
  ];
  let beklenen = 0;
  for (const [argv, desen] of sirali) {
    ortam.ilerle(2000);
    await pencereKomutuGonder(ortam, argv);
    beklenen += 1;
    assert.equal(ortam.durum.bildirimler.length, beklenen, `bildirim: ${argv.join(' ')}`);
    assert.match(ortam.durum.bildirimler.at(-1).body, desen);
  }
  assert.equal(ortam.pencere.gorunur, true, 'hiçbiri pencereyi gizlemedi');
  assert.deepEqual(postlar(ortam), [], '--eylem ile çakışan komut eylemi de çalıştırmaz');
});

const yasakliParcalar = (metin, ortam) => {
  for (const yasak of [TEST_ANAHTAR, '192.168.1.10', 'ha.example.com', 'Authorization', 'Bearer', 'webhook', 'token']) {
    assert.ok(!metin.includes(yasak), `durum dosyasında ${yasak} yok`);
  }
  assert.ok(!yolSizdiMi(metin, ortam.durum.appData), 'durum dosyasında yol yok');
};

ortamda('komut satırı (o-19): --liste güvenli favorilerin durumunu çıktı dosyasına yazar (kapı kuralı, sır yok, pencere/POST yok); --durum özet yazar', {
  ...dalga3([
    SALON,
    { entity_id: 'light.led_serit', ad: 'LED şerit', parlaklik: true },
    { entity_id: 'light.hol', ad: 'Hol' }, // HA'daki güncel ad kapı oldu: karo hiç oluşmaz
  ]),
  ha: [
    durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off'),
    { entity_id: 'light.led_serit', state: 'on', attributes: { friendly_name: 'LED şerit', brightness: 128 } },
    durumNesnesi('light.hol', 'Kapı Lambası', 'on'),
  ],
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  const klasor = path.join(ortam.durum.appData, 'Belgelerim');
  fs.mkdirSync(klasor);
  const yol = path.join(klasor, 'liste.json');
  const gosterOnce = ortam.pencere.cagri.show;
  await pencereKomutuGonder(ortam, ['--liste', `--cikti=${yol}`]);
  const belge = JSON.parse(fs.readFileSync(yol, 'utf8'));
  assert.equal(belge.bicim, 'ev-paneli-durum');
  assert.equal(belge.tur, 'liste');
  assert.equal(belge.uygulama.surum, '1.3.0');
  assert.equal(belge.baglanti.anahtarVar, true);
  assert.ok(['yerel', 'dis', 'yok'].includes(belge.baglanti.tur));
  assert.deepEqual(belge.favoriler.map((f) => f.kimlik), ['light.salon_lambasi', 'light.led_serit']);
  assert.deepEqual(belge.favoriler.find((f) => f.kimlik === 'light.led_serit'), { kimlik: 'light.led_serit', ad: 'LED şerit', alan: 'light', durum: 'acik', yuzde: 50, kullanilabilir: true, onayli: false });
  assert.equal(belge.favoriler.find((f) => f.kimlik === 'light.salon_lambasi').durum, 'kapali');
  assert.equal(belge.favoriSayisi, 2);
  assert.equal(belge.acikIsikSayisi, 1);
  yasakliParcalar(fs.readFileSync(yol, 'utf8'), ortam);
  assert.ok(!JSON.stringify(belge).includes('hol'), 'kapı oldu diye süzülen favori belgede yok');

  // göreli yol komutu veren kopyanın çalışma klasörüne göre çözülür; --durum liste içermez
  await pencereKomutuGonder(ortam, ['--durum', '--cikti', 'ozet.json'], klasor);
  const ozet = JSON.parse(fs.readFileSync(path.join(klasor, 'ozet.json'), 'utf8'));
  assert.equal(ozet.tur, 'durum');
  assert.equal(ozet.favoriSayisi, 2);
  assert.equal('favoriler' in ozet, false);
  assert.deepEqual(postlar(ortam), []);
  assert.equal(ortam.pencere.cagri.show, gosterOnce);
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false);
  assert.deepEqual(ortam.durum.bildirimler, [], 'başarı sessizdir');
  assert.ok(!ortam.gunlukOku().includes(klasor), 'günlükte çıktı yolu yok');
});

ortamda('komut satırı (o-19): --cikti eksik, .json değil, kullanıcı klasörü dışında ya da uygulama veri klasöründe ise yazılmaz ve hata bildirilir', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const veri = ortam.durum.yollar.get('userData');
  fs.mkdirSync(veri, { recursive: true });
  const kotuler = [
    [['--durum'], /--cikti/],
    [['--liste', '--cikti=durum.txt'], /\.json/],
    [['--durum', `--cikti=${path.join(veri, 'ayarlar.json')}`], /\.json/],
    [['--durum', `--cikti=${path.join(os.tmpdir(), 'baska-yer.json')}`], /\.json/],
  ];
  const oncekiAyar = fs.readFileSync(path.join(veri, 'ayarlar.json'), 'utf8');
  let sayi = 0;
  for (const [argv, desen] of kotuler) {
    ortam.ilerle(2000);
    await pencereKomutuGonder(ortam, argv, ortam.durum.appData);
    sayi += 1;
    assert.equal(ortam.durum.bildirimler.length, sayi, argv.join(' '));
    assert.match(ortam.durum.bildirimler.at(-1).body, desen);
  }
  assert.equal(fs.readFileSync(path.join(veri, 'ayarlar.json'), 'utf8'), oncekiAyar, 'ayar dosyası ezilmedi');
  assert.equal(fs.existsSync(path.join(ortam.durum.appData, 'durum.txt')), false);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'baska-yer.json')), false);
  assert.deepEqual(postlar(ortam), []);
});

ortamda('komut satırı (o-19): çıktı klasörü yoksa durum dosyası yazılamaz ve hata söylenir (klasör oluşturulmaz)', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const yol = path.join(ortam.durum.appData, 'yok-klasor', 'd.json');
  await pencereKomutuGonder(ortam, ['--durum', `--cikti=${yol}`]);
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /yazılamadı/);
  assert.equal(fs.existsSync(path.dirname(yol)), false);
});

ortamda('komut satırı (o-19): uygulama kapalıyken "--durum --cikti" ile açılış pencere AÇMAZ, durumlar okunduktan sonra dosyayı yazar', {
  ...dalga3([SALON]),
  acilisArgv: (gecici) => ['--durum', `--cikti=${path.join(gecici, 'acilis.json')}`],
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere açılmadı');
  const belge = JSON.parse(fs.readFileSync(path.join(ortam.durum.appData, 'acilis.json'), 'utf8'));
  assert.equal(belge.favoriSayisi, 1);
  assert.equal(belge.pencere.ana, 'gizli');
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('komut satırı (o-19): uygulama kapalıyken "--goster" ile açılış pencereyi komut gösterir; "--gizle" ile açılış gizli kalır', { ...dalga3([SALON]), acilisArgv: ['--goster'], ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, true);
  assert.equal(ortam.pencere.cagri.show, 1, 'tek gösterim');
});

ortamda('komut satırı (o-19): uygulama kapalıyken "--gizle" ile açılış pencere göstermez', { ...dalga3([SALON]), acilisArgv: ['--gizle'], ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false);
  assert.equal(ortam.pencere.cagri.show, 0);
});

ortamda('komut satırı (o-19): hazır olmadan gelen --gizle / --durum hazır olunca çalışır (komut kaybolmaz)', dalga3([SALON], {}, { hazirBekle: true }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const yol = path.join(ortam.durum.appData, 'bekleyen.json');
  await pencereKomutuGonder(ortam, ['--durum', `--cikti=${yol}`]);
  assert.equal(fs.existsSync(yol), false, 'hazır değilken yazılmaz');
  ortam.durum.hazirCoz();
  await ortam.akit();
  assert.equal(JSON.parse(fs.readFileSync(yol, 'utf8')).tur, 'durum');
  assert.deepEqual(postlar(ortam), []);
});

// --- yeni sürüm denetimi ve Yenilikler (o-40) ----------------------------------------------

const GITHUB_ONEKI = 'https://api.github.com/';
const GITHUB_SURUM_ADRESI = 'https://api.github.com/repos/emre-pn/ha-tray-panel/releases/latest';
const SURUM_SAYFASI = 'https://github.com/emre-pn/ha-tray-panel/releases/latest';
const GUN_MS = 24 * 60 * 60 * 1000;
const surumYaniti = (etiket = 'v1.4.0', ek = {}) => json({ tag_name: etiket, html_url: `https://github.com/emre-pn/ha-tray-panel/releases/tag/${etiket}`, draft: false, prerelease: false, ...ek });
/** Sahte ağa GitHub sürüm adresini ekler (yanit: her istekte yeni Response üreten işlev); HA yanıtları olduğu gibi kalır. */
function githubKur(ortam, yanit) {
  const onceki = ortam.durum.apiYaniti;
  ortam.durum.apiYaniti = (url, secenek) => (url.startsWith(GITHUB_ONEKI) ? yanit(url, secenek) : onceki(url, secenek));
}
const githubIstekleri = (ortam) => ortam.durum.fetchler.filter((f) => f.url.startsWith(GITHUB_ONEKI));
const yeniSurumMetni = (surum) => ANA_SOZLUK.tr['surum.yeniCikti'].replace('{surum}', surum);
const bolumIstekleri = (ortam) => (ortam.ayarlarPenceresi()?.webContents.mesajlar ?? []).filter((m) => m.kanal === 'ayarlar:bolum-ac').map((m) => m.yuk);
const ACIK_DENETIM = { ...dalga3([SALON], { surumDenetimi: true }, { ha: HA_VARLIKLARI }) };

ortamda('sürüm denetimi (o-40): varsayılan KAPALI; günlerce çalışsa da GitHub\'a hiç istek gitmez, zamanlayıcı kurulmaz', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v9.9.9'));
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ozet.surumDenetimi, false);
  for (let i = 0; i < 6; i += 1) {
    ortam.ilerle(GUN_MS / 2);
    await ortam.akit();
  }
  assert.deepEqual(githubIstekleri(ortam), []);
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /9\.9\.9/.test(b.body)), []);
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'surum-denetimi.json')), false, 'kapalıyken durum dosyası da yazılmaz');
});

ortamda('sürüm denetimi (o-40): açıksa açılıştan ~90 sn sonra TEK anahtarsız istek gider; yeni sürüm yalnız bildirilir, tıklayınca sürüm sayfası açılır, indirme yok', ACIK_DENETIM, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  ortam.ilerle(60_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 0, 'açılıştan hemen sonra istek yok');
  ortam.ilerle(40_000);
  await ortam.akit();
  const istekler = githubIstekleri(ortam);
  assert.equal(istekler.length, 1);
  assert.equal(istekler[0].url, GITHUB_SURUM_ADRESI);
  assert.equal(istekler[0].yontem, 'GET');
  assert.equal(istekler[0].govde, undefined);
  assert.doesNotMatch(JSON.stringify(istekler[0].basliklar), /Bearer|Authorization|Cookie|TEST_ANAHTAR/i, 'anahtar ve çerez gitmez');
  assert.doesNotMatch(JSON.stringify(istekler[0]), /192\.168|ha\.example\.com|1\.3\.0/, 'adres ve sürüm bilgisi gitmez');
  const bildirim = ortam.durum.bildirimler.find((b) => /1\.4\.0/.test(b.body));
  assert.ok(bildirim, 'yeni sürüm bildirimi');
  assert.equal(bildirim.body, yeniSurumMetni('1.4.0'));
  assert.deepEqual(ortam.durum.disariAcilanlar, [], 'bildirim gösterilince tarayıcı kendiliğinden açılmaz');
  assert.deepEqual(postlar(ortam), []);
  ortam.durum.bildirimNesneleri.find((n) => /1\.4\.0/.test(n.secenek.body)).emit('click');
  await ortam.akit();
  assert.deepEqual(ortam.durum.disariAcilanlar, ['https://github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0']);
  const durum = JSON.parse(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'surum-denetimi.json'), 'utf8'));
  assert.deepEqual(Object.keys(durum).sort(), ['bildirilen', 'sonDenetim', 'sonSurum']);
  assert.equal(durum.bildirilen, '1.4.0');
  assert.doesNotMatch(ortam.gunlukOku(), /api\.github|github\.com|https?:/i, 'günlükte adres yok');
});

ortamda('sürüm denetimi (o-40): günde en çok bir istek (6 saatlik bakışlar atlanır); aynı sürüm için ikinci bildirim yok; daha yeni sürüm yeniden bildirilir', ACIK_DENETIM, async (ortam) => {
  let etiket = 'v1.4.0';
  githubKur(ortam, () => surumYaniti(etiket));
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 1);
  for (let i = 0; i < 3; i += 1) {
    ortam.ilerle(6 * 60 * 60_000);
    await ortam.akit();
  }
  assert.equal(githubIstekleri(ortam).length, 1, '18 saatte yeni istek yok');
  ortam.ilerle(6 * 60 * 60_000 + 60_000); // 24 saat doldu
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 2);
  assert.equal(ortam.durum.bildirimler.filter((b) => /1\.4\.0/.test(b.body)).length, 1, 'aynı sürüm bir kez bildirilir');
  etiket = 'v1.5.0';
  for (let i = 0; i < 5; i += 1) {
    ortam.ilerle(6 * 60 * 60_000);
    await ortam.akit();
  }
  assert.equal(githubIstekleri(ortam).length, 3);
  assert.equal(ortam.durum.bildirimler.filter((b) => /1\.5\.0/.test(b.body)).length, 1);
});

ortamda('sürüm denetimi (o-40): ağ hatası, bozuk yanıt ve güncel sürüm sessizdir (bildirim yok, çökme yok); başarısız deneme de günde bir sayılır', ACIK_DENETIM, async (ortam) => {
  githubKur(ortam, () => json({ tag_name: 'sürüm?' }));
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 1);
  for (let i = 0; i < 3; i += 1) {
    ortam.ilerle(6 * 60 * 60_000); // 6 saatlik adımlar: zamanlayıcı her adımda yeniden kurulur
    await ortam.akit();
  }
  assert.equal(githubIstekleri(ortam).length, 1, 'hata sonrası da 24 saat dolmadan yeniden denenmez');
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /sürüm|version/i.test(b.body)), []);
  githubKur(ortam, () => surumYaniti('v1.3.0')); // güncel
  ortam.ilerle(6 * 60 * 60_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 2);
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /1\.3\.0/.test(b.body)), []);
});

ortamda('sürüm denetimi (o-40): Ayarlar\'dan açılınca ilk bakış 3 sn sonra yapılır; kapatılınca zamanlayıcı kalkar', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  const kaydet = await ayarlarKaydet(ortam, { surumDenetimi: true });
  assert.equal(kaydet.ok, true);
  assert.equal(ortam.ayarOku().surumDenetimi, true);
  ortam.ilerle(2_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 0);
  ortam.ilerle(1_500);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 1);
  await ayarlarKaydet(ortam, { surumDenetimi: false });
  assert.equal(ortam.ayarOku().surumDenetimi, false);
  ortam.ilerle(3 * GUN_MS);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).length, 1, 'kapatılınca başka istek yok');
});

ortamda('sürüm denetimi (o-40): ayar dışa/içe aktarmaya girmez (başkasının dosyası dış ağ seçeneğini açamaz) ama ayar özetinde ve kayıtta vardır', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  const { aktarilanAlanlar } = require('../src/lib/ayar-alanlari');
  assert.equal(aktarilanAlanlar().includes('surumDenetimi'), false);
  const olay = ayarlarOlayi(ortam);
  const yanit = await ortam.durum.ipc.get('ayarlar:kaydet')(olay, { yerelAdres: 'http://192.168.1.10:8123', surumDenetimi: 'evet' }); // geçersiz tür
  assert.ok(yanit.uyarilar.some((u) => u.alan === 'surumDenetimi'), 'geçersiz değer uyarı verir');
  assert.equal(ortam.ayarOku().surumDenetimi, false, 'geçersiz değer mevcut (kapalı) değeri korur');
});

ortamda('sürüm denetimi (o-40): tepsi "Güncellemeleri denetle" KAPALIYKEN ağa çıkmaz, nedenini söyler ve Ayarlar\'ın Sürüm bölümünü açar', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  ortam.menuOgesi('Güncellemeleri denetle').click();
  await ortam.akit();
  ortam.ilerle(300);
  await ortam.akit();
  assert.deepEqual(githubIstekleri(ortam), []);
  assert.ok(koseMesajlari(ortam).some((m) => m.metin === ANA_SOZLUK.tr['sonuc.surumKapali']), 'köşe bildirimi nedeni söyler');
  const ayarlarPenceresi = ortam.ayarlarPenceresi();
  assert.ok(ayarlarPenceresi, 'Ayarlar açıldı');
  assert.deepEqual(bolumIstekleri(ortam), [{ bolum: 'bolumSurum' }], 'sayfa yüklenince Sürüm bölümü istenir');
  assert.deepEqual(ortam.durum.disariAcilanlar, []);
});

ortamda('sürüm denetimi (o-40): tepsi "Güncellemeleri denetle" AÇIKKEN sonucu söyler: güncel -> köşe bildirimi, yeni -> Windows bildirimi, hata -> hata bildirimi; art arda basış dakikada bir', ACIK_DENETIM, async (ortam) => {
  let etiket = 'v1.3.0';
  githubKur(ortam, () => surumYaniti(etiket));
  const tikla = async () => {
    ortam.menuOgesi('Güncellemeleri denetle').click();
    await ortam.akit();
    ortam.ilerle(300);
    await ortam.akit();
  };
  await tikla();
  assert.equal(githubIstekleri(ortam).length, 1);
  assert.ok(koseMesajlari(ortam).some((m) => m.metin === ANA_SOZLUK.tr['sonuc.surumGuncel'].replace('{surum}', '1.3.0')));
  await tikla(); // 1 dakikadan kısa
  assert.equal(githubIstekleri(ortam).length, 1);
  assert.ok(koseMesajlari(ortam).some((m) => m.metin === ANA_SOZLUK.tr['sonuc.surumCokSik']));
  ortam.ilerle(61_000);
  etiket = 'v1.4.0';
  await tikla();
  assert.equal(githubIstekleri(ortam).length, 2);
  assert.ok(ortam.durum.bildirimler.some((b) => b.body === yeniSurumMetni('1.4.0')));
  ortam.ilerle(61_000);
  githubKur(ortam, () => json({}, 500));
  await tikla();
  assert.ok(ortam.durum.bildirimler.some((b) => b.body === ANA_SOZLUK.tr['sonuc.surumHata']), 'hata Windows bildirimi olarak da düşer');
});

ortamda('sürüm denetimi (o-40): tepsi "Yenilikler" Ayarlar\'ı açar ve Sürüm bölümünü ister; Ayarlar zaten açıksa olay gönderilir; ağa çıkılmaz', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  ortam.menuOgesi('Yenilikler').click();
  await ortam.akit();
  assert.deepEqual(bolumIstekleri(ortam), [{ bolum: 'bolumSurum' }]);
  ortam.menuOgesi('Yenilikler').click(); // pencere açık: doğrudan olay
  await ortam.akit();
  assert.equal(bolumIstekleri(ortam).length, 2);
  ortam.menuOgesi('Ayarlar…').click(); // düz Ayarlar: bölüm istenmez (menü nesnesi bölüm kimliği sanılmaz)
  await ortam.akit();
  assert.equal(bolumIstekleri(ortam).length, 2);
  assert.deepEqual(githubIstekleri(ortam), []);
});

ortamda('sürüm denetimi (o-40): IPC yalnız Ayarlar sayfasına yanıt verir; kapalıyken surum:denetle ağa çıkmaz; yenilikler paketli CHANGELOG\'dan gelir; sürüm sayfası sabit adreste açılır', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  const olay = ayarlarOlayi(ortam);
  const ipc = ortam.durum.ipc;
  const bilgi = await ipc.get('surum:durum')(olay);
  assert.equal(bilgi.ok, true);
  assert.equal(bilgi.surum, '1.3.0');
  assert.equal(bilgi.acik, false);
  assert.equal(bilgi.yeniSurum, null);
  assert.deepEqual(await ipc.get('surum:denetle')(olay), { ok: true, sonuc: 'kapali' });
  assert.deepEqual(githubIstekleri(ortam), []);
  const yenilik = await ipc.get('surum:yenilikler')(olay);
  assert.equal(yenilik.ok, true);
  assert.equal(yenilik.bulundu, true);
  assert.match(yenilik.baslik, /^1\.3\.0/);
  assert.match(yenilik.metin, /First public release/);
  assert.doesNotMatch(yenilik.metin, /\*\*|`/, 'işaretler düz metne çevrilmiş');
  assert.deepEqual(await ipc.get('surum:sayfa-ac')(olay), { ok: true });
  await ortam.akit();
  assert.deepEqual(ortam.durum.disariAcilanlar, [SURUM_SAYFASI]);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  for (const kanal of ['surum:durum', 'surum:denetle', 'surum:yenilikler', 'surum:sayfa-ac']) {
    for (const kotu of [uzak, baskaPencere]) assert.deepEqual(await ipc.get(kanal)(kotu), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
  }
  assert.equal(ortam.durum.disariAcilanlar.length, 1);
});

ortamda('sürüm denetimi (o-40): sürüm notu bulunamayan sürümde (geliştirme/yeni) yenilikler boş döner, çökmez', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  ortam.durum.surum = '9.9.9';
  const yenilik = await ortam.durum.ipc.get('surum:yenilikler')(ayarlarOlayi(ortam));
  assert.deepEqual(yenilik, { ok: true, surum: '9.9.9', bulundu: false, baslik: '', metin: '' });
});

ortamda('sürüm denetimi (o-40): açıkken elle denetim "surum:denetle" ile çalışır ve Ayarlar yeni sürüm bilgisini hatırlar', ACIK_DENETIM, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  const olay = ayarlarOlayi(ortam);
  const sonuc = await ortam.durum.ipc.get('surum:denetle')(olay);
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.sonuc, 'yeni');
  assert.equal(sonuc.surum, '1.4.0');
  assert.equal(githubIstekleri(ortam).length, 1);
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /1\.4\.0/.test(b.body)), [], 'Ayarlar düğmesi Windows bildirimi göndermez (sonuç sayfada yazılır)');
  const bilgi = await ortam.durum.ipc.get('surum:durum')(olay);
  assert.equal(bilgi.acik, true);
  assert.equal(bilgi.yeniSurum, '1.4.0');
});

// --- uygulama içi güncelleme (o-51) ---------------------------------------------------------
// electron-updater Module._load ile bellek içi bir sahteyle değiştirilir (gerçek istek, indirme ya da kurulum YOK); indirilen "kurucu" geçici klasörde
// küçük bir dosyadır ve sha512 gerçekten hesaplanır.

const GUNC_ICERIK = 'sahte-kurucu-icerigi';
const GUNC_SHA = require('node:crypto').createHash('sha512').update(GUNC_ICERIK).digest('base64');
const GUNC_AD = 'Ev-Paneli-Kurulum-1.4.0.exe';
const guncBilgisi = (ek = {}) => ({
  version: '1.4.0',
  files: [{ url: GUNC_AD, sha512: GUNC_SHA, size: GUNC_ICERIK.length }],
  path: GUNC_AD,
  sha512: GUNC_SHA,
  ...ek,
});
const guncUygulama = (ortam) => ortam.durum.guncelleyici;
const guncIletileri = (ortam) => (ortam.ayarlarPenceresi()?.webContents.mesajlar ?? []).filter((m) => m.kanal === 'guncelleme:degisti').map((m) => m.yuk);
const guncelleyiciOncesi = (secenek = {}) => (durum) => {
  const sahte = new EventEmitter();
  sahte.cagrilar = [];
  sahte.yuklemeler = 0;
  sahte.bilgi = secenek.bilgi ?? guncBilgisi();
  sahte.guncelVar = secenek.guncelVar !== false;
  sahte.icerik = secenek.icerik ?? GUNC_ICERIK;
  sahte.kontrolHatasi = secenek.kontrolHatasi ?? null;
  sahte.checkForUpdates = async () => {
    sahte.cagrilar.push('checkForUpdates');
    if (sahte.kontrolHatasi) throw sahte.kontrolHatasi;
    return { isUpdateAvailable: sahte.guncelVar, updateInfo: sahte.bilgi };
  };
  sahte.downloadUpdate = async () => {
    sahte.cagrilar.push('downloadUpdate');
    const dosya = path.join(durum.appData, 'guncelleme-onbellek', GUNC_AD);
    fs.mkdirSync(path.dirname(dosya), { recursive: true });
    fs.writeFileSync(dosya, sahte.icerik);
    sahte.emit('download-progress', { percent: 50.4 });
    sahte.emit('download-progress', { percent: 100 });
    sahte.emit('update-downloaded', { ...sahte.bilgi, downloadedFile: dosya });
    return [dosya];
  };
  sahte.quitAndInstall = (...arg) => {
    sahte.cagrilar.push(['quitAndInstall', ...arg]);
    durum.cikisIstendi = true;
  };
  durum.guncelleyici = sahte;
  const orijinal = Module._load;
  return mock.method(Module, '_load', function guncelleyiciYukle(istek, ...gerisi) {
    if (istek === 'electron-updater') {
      sahte.yuklemeler += 1;
      return { autoUpdater: sahte };
    }
    return orijinal.call(this, istek, ...gerisi);
  });
};
const GUNC_ACIK = (ayarEk = {}, ortamEk = {}) => ({ ...dalga3([SALON], { uygulamaGuncelleme: true, ...ayarEk }, { ha: HA_VARLIKLARI, paketli: true, ...ortamEk }) });

ortamda('güncelleme (o-51): varsayılan KAPALI; günlerce çalışsa da electron-updater yüklenmez, GitHub\'a istek gitmez, IPC "kapali" der', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI, paketli: true, oncesi: guncelleyiciOncesi() }) }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v9.9.9'));
  const olay = ayarlarOlayi(ortam);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.equal(ozet.uygulamaGuncelleme, false);
  assert.equal(ozet.onSurumler, false);
  for (let i = 0; i < 6; i += 1) {
    ortam.ilerle(GUN_MS / 2);
    await ortam.akit();
  }
  assert.equal(guncUygulama(ortam).yuklemeler, 0, 'modül hiç yüklenmedi');
  assert.deepEqual(guncUygulama(ortam).cagrilar, []);
  assert.deepEqual(githubIstekleri(ortam), []);
  const durum = await ortam.durum.ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.ok, true);
  assert.equal(durum.acik, false);
  assert.equal(durum.durum, 'bosta');
  assert.deepEqual(await ortam.durum.ipc.get('guncelleme:indir')(olay), { ok: true, sonuc: 'kapali', neden: undefined, surum: undefined });
  assert.deepEqual(await ortam.durum.ipc.get('guncelleme:kur')(olay), { ok: true, sonuc: 'gecersiz' });
  assert.equal(guncUygulama(ortam).yuklemeler, 0, 'IPC çağrıları da modülü yüklemez');
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'guncelleme.json')), false);
});

ortamda('güncelleme (o-51): açıksa ~90 sn sonra güncelleyici bir kez denetler; otomatik indirme/çıkışta kurma KAPALI; bildirim tıklanınca Ayarlar Sürüm bölümü açılır; hiçbir şey inmez', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi() }, async (ortam) => {
  ortam.ilerle(60_000);
  await ortam.akit();
  assert.deepEqual(guncUygulama(ortam).cagrilar, [], 'açılıştan hemen sonra istek yok');
  ortam.ilerle(40_000);
  await ortam.akit();
  const g = guncUygulama(ortam);
  assert.deepEqual(g.cagrilar, ['checkForUpdates']);
  assert.equal(g.autoDownload, false);
  assert.equal(g.autoInstallOnAppQuit, false);
  assert.equal(g.allowPrerelease, false);
  assert.equal(g.allowDowngrade, false);
  assert.equal(g.disableDifferentialDownload, true);
  assert.equal(g.logger, null);
  assert.doesNotMatch(JSON.stringify(g.requestHeaders), /Bearer|Authorization|TEST_ANAHTAR|192\.168|ha\.example/, 'başlıklarda anahtar/adres yok');
  assert.deepEqual(githubIstekleri(ortam), [], 'ana süreç GitHub\'a kendisi istek yapmaz (güncelleyici yapar)');
  const bildirim = ortam.durum.bildirimler.find((b) => /1\.4\.0/.test(b.body));
  assert.ok(bildirim, 'yeni sürüm bildirimi');
  assert.equal(bildirim.body, ANA_SOZLUK.tr['guncelleme.yeniCikti'].replace('{surum}', '1.4.0'));
  assert.deepEqual(g.cagrilar.filter((c) => c === 'downloadUpdate'), [], 'bildirim indirme başlatmaz');
  assert.deepEqual(ortam.durum.disariAcilanlar, []);
  ortam.durum.bildirimNesneleri.find((n) => /1\.4\.0/.test(n.secenek.body)).emit('click');
  await ortam.akit();
  assert.ok(ortam.ayarlarPenceresi(), 'Ayarlar açıldı');
  assert.deepEqual(bolumIstekleri(ortam), [{ bolum: 'bolumSurum' }]);
  assert.deepEqual(ortam.durum.disariAcilanlar, [], 'tarayıcı açılmaz: indirme uygulama içinde');
  const kayit = JSON.parse(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'guncelleme.json'), 'utf8'));
  assert.deepEqual(Object.keys(kayit).sort(), ['bildirilen', 'sonDenetim', 'sonSurum']);
  assert.equal(kayit.bildirilen, '1.4.0');
  assert.doesNotMatch(ortam.gunlukOku(), /github|https?:|\.exe|sha512|C:\\/i, 'günlükte adres, dosya yolu ve özet yok');
  // aynı sürüm için günde tek bildirim, günde tek istek
  for (let i = 0; i < 3; i += 1) {
    ortam.ilerle(6 * 60 * 60_000);
    await ortam.akit();
  }
  assert.equal(g.cagrilar.filter((c) => c === 'checkForUpdates').length, 1);
  assert.equal(ortam.durum.bildirimler.filter((b) => /1\.4\.0/.test(b.body)).length, 1);
});

ortamda('güncelleme (o-51): Ayarlar\'dan açılınca ilk bakış 3 sn sonra yapılır; kapatılınca zamanlayıcı kalkar ve bellekteki sürüm bilgisi atılır', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI, paketli: true, oncesi: guncelleyiciOncesi() }) }, async (ortam) => {
  const kaydet = await ayarlarKaydet(ortam, { uygulamaGuncelleme: true });
  assert.equal(kaydet.ok, true);
  assert.equal(ortam.ayarOku().uygulamaGuncelleme, true);
  ortam.ilerle(2_000);
  await ortam.akit();
  assert.deepEqual(guncUygulama(ortam).cagrilar, []);
  ortam.ilerle(1_500);
  await ortam.akit();
  assert.deepEqual(guncUygulama(ortam).cagrilar, ['checkForUpdates']);
  const olay = ayarlarOlayi(ortam);
  assert.equal((await ortam.durum.ipc.get('guncelleme:durum')(olay)).durum, 'yeni');
  await ayarlarKaydet(ortam, { uygulamaGuncelleme: false });
  assert.equal(ortam.ayarOku().uygulamaGuncelleme, false);
  assert.equal((await ortam.durum.ipc.get('guncelleme:durum')(olay)).durum, 'bosta', 'kapanınca bilgi atılır');
  assert.equal((await ortam.durum.ipc.get('guncelleme:durum')(olay)).acik, false);
  ortam.ilerle(3 * GUN_MS);
  await ortam.akit();
  assert.equal(guncUygulama(ortam).cagrilar.filter((c) => c === 'checkForUpdates').length, 1, 'kapatılınca başka istek yok');
  assert.deepEqual(await ortam.durum.ipc.get('guncelleme:indir')(olay), { ok: true, sonuc: 'kapali', neden: undefined, surum: undefined });
});

ortamda('güncelleme (o-51): indir -> sha512 doğrulanır -> "indirildi"; kurulum ayrıca onay penceresiyle başlar (Vazgeç varsayılan: kurulmaz); onaylanırsa quitAndInstall(sessiz, yeniden aç)', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi() }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const ipc = ortam.durum.ipc;
  const g = guncUygulama(ortam);
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal((await ipc.get('guncelleme:durum')(olay)).durum, 'yeni');
  assert.deepEqual(await ipc.get('guncelleme:kur')(olay), { ok: true, sonuc: 'gecersiz' }, 'indirmeden kurulmaz');
  assert.deepEqual(ortam.durum.diyaloglar, []);
  const indir = await ipc.get('guncelleme:indir')(olay);
  assert.deepEqual(indir, { ok: true, sonuc: 'indirildi', neden: undefined, surum: '1.4.0' });
  assert.equal(g.cagrilar.filter((c) => c === 'downloadUpdate').length, 1);
  const durum = await ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.durum, 'indirildi');
  assert.equal(durum.surum, '1.4.0');
  assert.equal(durum.ilerleme, 100);
  assert.doesNotMatch(JSON.stringify(durum), /guncelleme-onbellek|\.exe|sha512|http|C:\\/i, 'renderer\'a dosya yolu, adres ya da özet verilmez');
  const itilenler = guncIletileri(ortam);
  assert.ok(itilenler.some((d) => d.durum === 'indiriliyor' && d.ilerleme === 50), 'ilerleme Ayarlar\'a itilir');
  assert.equal(itilenler.at(-1).durum, 'indirildi');
  assert.equal(ortam.durum.cikisIstendi, false);
  // onay penceresi: varsayılan "Vazgeç" -> kurulmaz
  ortam.durum.diyalogYaniti = 1;
  assert.deepEqual(await ipc.get('guncelleme:kur')(olay), { ok: true, sonuc: 'vazgecildi' });
  assert.equal(ortam.durum.diyaloglar.length, 1);
  assert.equal(ortam.durum.diyaloglar[0].defaultId, 1);
  assert.equal(ortam.durum.diyaloglar[0].cancelId, 1);
  assert.equal(ortam.durum.diyaloglar[0].buttons[0], ANA_SOZLUK.tr['guncelleme.kurDugme']);
  assert.equal(ortam.durum.diyaloglar[0].message, ANA_SOZLUK.tr['guncelleme.kurMesaj'].replace('{surum}', '1.4.0'));
  assert.deepEqual(g.cagrilar.filter((c) => Array.isArray(c)), []);
  assert.equal(ortam.durum.cikisIstendi, false);
  // onay verilirse
  ortam.durum.diyalogYaniti = 0;
  const kur = await ipc.get('guncelleme:kur')(olay);
  assert.deepEqual(kur, { ok: true, sonuc: 'kuruluyor', neden: undefined, surum: '1.4.0' });
  assert.deepEqual(g.cagrilar.filter((c) => Array.isArray(c)), [['quitAndInstall', true, true]]);
  assert.equal(ortam.durum.cikisIstendi, true);
  assert.equal((await ipc.get('guncelleme:durum')(olay)).durum, 'kuruluyor');
  assert.deepEqual(postlar(ortam), [], 'güncelleme HA\'ya hiçbir şey yazmaz');
});

ortamda('güncelleme (o-51): indirme bitince Ayarlar açık değilse bildirim kurulum için Ayarlar\'ı açar; kurulum yine onay ister', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi() }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  await ortam.akit();
  ortam.ayarlarPenceresi().gorunur = false; // kullanıcı Ayarlar'ı kapattı/gizledi
  ortam.ilerle(100_000);
  await ortam.akit();
  await ortam.durum.ipc.get('guncelleme:indir')(olay);
  const bildirim = ortam.durum.bildirimler.find((b) => b.body === ANA_SOZLUK.tr['guncelleme.indirildi'].replace('{surum}', '1.4.0'));
  assert.ok(bildirim, 'indirildi bildirimi');
  assert.deepEqual(guncUygulama(ortam).cagrilar.filter((c) => Array.isArray(c)), []);
  ortam.durum.bildirimNesneleri.find((n) => n.secenek.body === bildirim.body).emit('click');
  await ortam.akit();
  assert.ok(bolumIstekleri(ortam).length >= 1);
  assert.equal(ortam.durum.diyaloglar.length, 0, 'bildirim tıklaması kurulumu başlatmaz');
});

ortamda('güncelleme (o-51): indirilen dosyanın sha512\'si yayındakiyle uyuşmazsa "indirildi" olmaz, kurulum başlatılamaz', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi({ icerik: 'degistirilmis-icerik!!' }) }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  ortam.ilerle(100_000);
  await ortam.akit();
  const indir = await ortam.durum.ipc.get('guncelleme:indir')(olay);
  assert.equal(indir.sonuc, 'hata');
  assert.equal(indir.neden, 'ozet');
  const durum = await ortam.durum.ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.durum, 'yeni');
  assert.equal(durum.hata, 'ozet');
  ortam.durum.diyalogYaniti = 0;
  assert.deepEqual(await ortam.durum.ipc.get('guncelleme:kur')(olay), { ok: true, sonuc: 'gecersiz' });
  assert.deepEqual(ortam.durum.diyaloglar, [], 'onay penceresi bile açılmaz');
  assert.deepEqual(guncUygulama(ortam).cagrilar.filter((c) => Array.isArray(c)), []);
  assert.equal(ortam.durum.cikisIstendi, false);
});

ortamda('güncelleme (o-51): sha512 YOK / eski sürüm / ön sürüm (seçenek kapalı) bilgisi reddedilir; hiçbir şey indirilmez', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi({ bilgi: guncBilgisi({ files: [{ url: GUNC_AD, size: 5 }] }) }) }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const g = guncUygulama(ortam);
  const durumOku = async () => ortam.durum.ipc.get('guncelleme:durum')(olay);
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal((await durumOku()).durum, 'bosta');
  assert.equal((await durumOku()).hata, 'butunluk');
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /1\.4\.0/.test(b.body)), [], 'doğrulanmamış sürüm için bildirim yok');
  assert.equal((await ortam.durum.ipc.get('guncelleme:indir')(olay)).sonuc, 'gecersiz');
  g.bilgi = guncBilgisi({ version: '1.4.0-beta.1' }); // ön sürüm, seçenek kapalı
  ortam.ilerle(2 * GUN_MS);
  await ortam.akit();
  assert.equal((await durumOku()).hata, 'butunluk');
  g.bilgi = guncBilgisi({ version: '1.3.0' }); // eşit: ileri değil
  ortam.ilerle(2 * GUN_MS);
  await ortam.akit();
  assert.equal((await durumOku()).hata, 'butunluk');
  assert.deepEqual(g.cagrilar.filter((c) => c === 'downloadUpdate'), []);
});

ortamda('güncelleme (o-51): "ön sürümleri de göster" güncelleyiciye iletilir (allowPrerelease açılır ama allowDowngrade kapalı kalır); ön sürüm önerilir ve işaretlenir', { ...GUNC_ACIK({ onSurumler: true }), oncesi: guncelleyiciOncesi({ bilgi: guncBilgisi({ version: '1.4.0-beta.2', files: [{ url: 'Ev-Paneli-Kurulum-1.4.0-beta.2.exe', sha512: GUNC_SHA, size: GUNC_ICERIK.length }], path: 'Ev-Paneli-Kurulum-1.4.0-beta.2.exe' }) }) }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const g = guncUygulama(ortam);
  g.allowDowngrade = true; // electron-updater allowPrerelease açınca bunu açar; yönetici kapatmalı
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal(g.allowPrerelease, true);
  assert.equal(g.allowDowngrade, false);
  const durum = await ortam.durum.ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.durum, 'yeni');
  assert.equal(durum.surum, '1.4.0-beta.2');
  assert.equal(durum.onSurum, true);
});

ortamda('güncelleme (o-51): tepsi "Güncellemeleri denetle" açıkken güncelleyiciyi kullanır (elle: dakikada bir), yeni sürümü bildirir; kapalıyken güncelleyiciye dokunmaz', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi() }, async (ortam) => {
  const g = guncUygulama(ortam);
  const tikla = async () => {
    ortam.menuOgesi('Güncellemeleri denetle').click();
    await ortam.akit();
    ortam.ilerle(300);
    await ortam.akit();
  };
  await tikla();
  assert.deepEqual(g.cagrilar, ['checkForUpdates']);
  assert.ok(ortam.durum.bildirimler.some((b) => b.body === ANA_SOZLUK.tr['guncelleme.yeniCikti'].replace('{surum}', '1.4.0')));
  await tikla(); // bir dakikadan kısa
  assert.equal(g.cagrilar.length, 1);
  assert.ok(koseMesajlari(ortam).some((m) => m.metin === ANA_SOZLUK.tr['sonuc.surumCokSik']));
  assert.deepEqual(githubIstekleri(ortam), []);
});

ortamda('güncelleme (o-51): taşınabilir sürümde etkisizdir (güncelleyici yüklenmez; durum "tasinabilir"); sürüm denetimi (o-40) bildirimi yine çalışır', { ...GUNC_ACIK({ surumDenetimi: true }), oncesi: (durum) => {
  const onceki = process.env.PORTABLE_EXECUTABLE_FILE;
  process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Taşınabilir\\Ev-Paneli-Tasinabilir.exe';
  const guncelleyici = guncelleyiciOncesi()(durum);
  return [
    guncelleyici,
    { mock: { restore: () => (onceki === undefined ? delete process.env.PORTABLE_EXECUTABLE_FILE : (process.env.PORTABLE_EXECUTABLE_FILE = onceki)) } },
  ];
} }, async (ortam) => {
  githubKur(ortam, () => surumYaniti('v1.4.0'));
  const olay = ayarlarOlayi(ortam);
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal(guncUygulama(ortam).yuklemeler, 0);
  assert.deepEqual(guncUygulama(ortam).cagrilar, []);
  const durum = await ortam.durum.ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.destek, 'tasinabilir');
  assert.equal(durum.acik, true);
  assert.deepEqual(await ortam.durum.ipc.get('guncelleme:indir')(olay), { ok: true, sonuc: 'desteklenmiyor', neden: 'tasinabilir', surum: undefined });
  assert.equal(githubIstekleri(ortam).length, 1, 'o-40 bildirimi taşınabilirde yine çalışır');
  assert.ok(ortam.durum.bildirimler.some((b) => b.body === yeniSurumMetni('1.4.0')), 'sürüm sayfası bildirimi');
});

ortamda('güncelleme (o-51): kurulmamış (geliştirme) çalıştırmada etkisizdir; güncelleyici yüklenmez', { ...dalga3([SALON], { uygulamaGuncelleme: true }, { ha: HA_VARLIKLARI, paketli: false, oncesi: guncelleyiciOncesi() }) }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  ortam.ilerle(2 * GUN_MS);
  await ortam.akit();
  assert.equal(guncUygulama(ortam).yuklemeler, 0);
  const durum = await ortam.durum.ipc.get('guncelleme:durum')(olay);
  assert.equal(durum.destek, 'paketsiz');
});

ortamda('güncelleme (o-51): güncelleme IPC kanalları yalnız Ayarlar sayfasına yanıt verir; ayar dışa/içe aktarmaya girmez', { ...GUNC_ACIK(), oncesi: guncelleyiciOncesi() }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  for (const kanal of ['guncelleme:durum', 'guncelleme:indir', 'guncelleme:kur']) {
    for (const kotu of [uzak, baskaPencere]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
  }
  assert.equal(guncUygulama(ortam).yuklemeler, 0, 'reddedilen çağrılar güncelleyiciyi yüklemez');
  const { aktarilanAlanlar } = require('../src/lib/ayar-alanlari');
  assert.equal(aktarilanAlanlar().includes('uygulamaGuncelleme'), false);
  assert.equal(aktarilanAlanlar().includes('onSurumler'), false);
  const yanit = await ortam.durum.ipc.get('ayarlar:kaydet')(olay, { yerelAdres: 'http://192.168.1.10:8123', uygulamaGuncelleme: 'evet', onSurumler: 1 });
  assert.ok(yanit.uyarilar.some((u) => u.alan === 'uygulamaGuncelleme'));
  assert.ok(yanit.uyarilar.some((u) => u.alan === 'onSurumler'));
});

ortamda('sürüm denetimi (o-40) + ön sürümler (o-51): seçenek açıkken GitHub sürüm LİSTESİ okunur, ön sürüm bildirilir; kapalıyken tek "en son sürüm" adresi', { ...ACIK_DENETIM }, async (ortam) => {
  const liste = JSON.stringify([
    { tag_name: 'v1.4.0-beta.1', html_url: 'https://github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0-beta.1', draft: false, prerelease: true },
    { tag_name: 'v1.3.0', html_url: 'https://github.com/emre-pn/ha-tray-panel/releases/tag/v1.3.0', draft: false, prerelease: false },
  ]);
  githubKur(ortam, (url) => (url.includes('/releases?per_page') ? new Response(liste, { status: 200 }) : surumYaniti('v1.3.0')));
  ortam.ilerle(100_000);
  await ortam.akit();
  assert.equal(githubIstekleri(ortam).at(-1).url, GITHUB_SURUM_ADRESI, 'seçenek kapalı: tek sürüm adresi');
  assert.deepEqual(ortam.durum.bildirimler.filter((b) => /beta/.test(b.body)), []);
  await ayarlarKaydet(ortam, { surumDenetimi: true, onSurumler: true });
  for (let i = 0; i < 5; i += 1) {
    ortam.ilerle(6 * 60 * 60_000 + 60_000); // 24 saatlik sınır dolana kadar 6 saatlik bakışlar
    await ortam.akit();
  }
  const sonIstek = githubIstekleri(ortam).at(-1);
  assert.equal(sonIstek.url, 'https://api.github.com/repos/emre-pn/ha-tray-panel/releases?per_page=15');
  assert.equal(sonIstek.yontem, 'GET');
  assert.ok(ortam.durum.bildirimler.some((b) => b.body === yeniSurumMetni('1.4.0-beta.1')), 'ön sürüm bildirildi');
});

test('yolSizdiMi: ham, JSON-kaçışlı ve eğik çizgili yol biçimlerini yakalar; yolsuz metinde false döner', () => {
  const yol = path.join(os.tmpdir(), 'x');
  assert.equal(yolSizdiMi(JSON.stringify({ yol }), yol), true, 'JSON içinde kaçışlı yol (Windows\'ta ters eğik çizgiler ikilenir)');
  assert.equal(yolSizdiMi(`yol: ${yol}`, yol), true, 'ham yol');
  assert.equal(yolSizdiMi(`yol: ${yol.replace(/\\/g, '/')}`, yol), true, 'eğik çizgili yol');
  assert.equal(yolSizdiMi(JSON.stringify({ ad: 'yedek.json' }), yol), false);
  assert.equal(yolSizdiMi('yol', ''), false, 'boş yol her metinde bulunmuş sayılmaz');
});

// --- taşınabilir derleme (o-45) -------------------------------------------------------------

/** electron-builder portable açılış yardımcısı PORTABLE_EXECUTABLE_FILE'ı ayarlar; ortam değişkeni test bitince geri alınır. */
const tasinabilirOrtam = (ek = {}) => ({
  ...dalga3([SALON], { otomatikBaslat: true }, { paketli: true, ha: HA_VARLIKLARI }),
  oncesi: () => {
    const onceki = process.env.PORTABLE_EXECUTABLE_FILE;
    process.env.PORTABLE_EXECUTABLE_FILE = path.join(os.tmpdir(), 'ev-paneli-usb-yok', 'Ev-Paneli-Tasinabilir-1.3.0.exe'); // gerçek bir sürücüye bağlı değil, dosya oluşturulmaz
    return [{ mock: { restore: () => (onceki === undefined ? delete process.env.PORTABLE_EXECUTABLE_FILE : (process.env.PORTABLE_EXECUTABLE_FILE = onceki)) } }];
  },
  ...ek,
});

ortamda('taşınabilir (o-45): kurulu (paketli) sürümde Windows açılışı eskisi gibi yazılır; geçici klasör yolu değil çalışan exe verilir', { ...dalga3([SALON], { otomatikBaslat: true }, { paketli: true, ha: HA_VARLIKLARI }) }, async (ortam) => {
  assert.equal(ortam.durum.oturumYazimlari.length, 1);
  assert.deepEqual(ortam.durum.oturumYazimlari[0], { openAtLogin: true, path: process.execPath, args: ['--gizli'], name: 'Ev Paneli', enabled: true });
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ozet.otomatikBaslatDestekleniyor, true);
  assert.notEqual(ozet.otomatikBaslatDurumu.durum, 'tasinabilir');
});

ortamda('taşınabilir (o-45): taşınabilir derlemede Windows açılışına HİÇ yazılmaz ve okunmaz; durum "tasinabilir", destek yok, ayar değeri korunur', tasinabilirOrtam(), async (ortam) => {
  assert.deepEqual(ortam.durum.oturumYazimlari, []);
  assert.deepEqual(ortam.durum.oturumOkumalari, []);
  const olay = ayarlarOlayi(ortam);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.equal(ozet.otomatikBaslatDestekleniyor, false);
  assert.equal(ozet.otomatikBaslatDurumu.durum, 'tasinabilir');
  assert.match(ozet.otomatikBaslatDurumu.mesaj, /Taşınabilir sürümde Windows ile başlatma yoktur/);
  assert.equal(ozet.otomatikBaslat, true, 'ortak ayar dosyasındaki tercih (kurulu sürümün) olduğu gibi gösterilir');
  assert.deepEqual(ortam.durum.oturumOkumalari, [], 'durum sorgusu da kayıt defterine bakmaz');
});

ortamda('taşınabilir (o-45): kutuyu kaydetmek, "yeniden etkinleştir" ve tepsi kutusu ortak ayar değerini DEĞİŞTİRMEZ ve Windows\'a yazmaz; tepsi kutusu kapalı ve nedeni etikette', tasinabilirOrtam(), async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const kaydet = await ortam.durum.ipc.get('ayarlar:kaydet')(olay, {
    yerelAdres: 'http://192.168.1.10:8123',
    disAdres: 'https://ha.example.com',
    kisayol: 'Control+Alt+H',
    otomatikBaslat: false,
    pencereBoyutu: 'hizli',
    odakKaybindaGizle: true,
    anaPanoyaDonDk: 5,
  });
  assert.equal(kaydet.ok, true);
  assert.equal(ortam.ayarOku().otomatikBaslat, true, 'taşınabilir sürüm kurulu sürümün başlangıç tercihini ezmez');
  await ortam.durum.ipc.get('otomatik-baslat:etkinlestir')(olay);
  const oge = ortam.menuAgaci().find((d) => /^Windows açılınca başlat/.test(d.oge.label ?? '')).oge;
  assert.equal(oge.enabled, false);
  assert.equal(oge.checked, false);
  assert.equal(oge.label, 'Windows açılınca başlat (taşınabilir sürümde yok)');
  oge.click({ checked: true });
  assert.equal(ortam.ayarOku().otomatikBaslat, true);
  assert.deepEqual(ortam.durum.oturumYazimlari, []);
  assert.deepEqual(ortam.durum.oturumOkumalari, []);
});

ortamda('taşınabilir (o-45): veri klasörü ve tek kopya kilidi kurulu sürümle ortaktır (ayarlar %APPDATA%\\Ev Paneli altında, exe\'nin yanında değil)', tasinabilirOrtam(), async (ortam) => {
  assert.equal(path.basename(ortam.durum.yollar.get('userData')), 'Ev Paneli');
  assert.equal(path.dirname(ortam.durum.yollar.get('userData')), ortam.durum.appData);
  assert.ok(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json')));
  assert.equal(fs.existsSync(path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), 'Ev Paneli')), false, 'exe yanına veri klasörü açılmadı');
});

ortamda('taşınabilir (o-45): PORTABLE_EXECUTABLE_FILE yoksa (kurulu sürüm) hiçbir şey değişmez; boş değer taşınabilir sayılmaz', { ...dalga3([SALON], { otomatikBaslat: true }, { paketli: true, ha: HA_VARLIKLARI }), oncesi: () => {
  const onceki = process.env.PORTABLE_EXECUTABLE_FILE;
  process.env.PORTABLE_EXECUTABLE_FILE = '';
  return [{ mock: { restore: () => (onceki === undefined ? delete process.env.PORTABLE_EXECUTABLE_FILE : (process.env.PORTABLE_EXECUTABLE_FILE = onceki)) } }];
} }, async (ortam) => {
  assert.equal(ortam.durum.oturumYazimlari.length, 1);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ozet.otomatikBaslatDestekleniyor, true);
});

ortamda('tepsi menüsü: ayar diske yazılamıyorsa "Geniş pencere", "Dışarı tıklayınca gizle" ve "Windows açılınca başlat" eski değerine döner, hata söylenir, Windows kaydına dokunulmaz; engel kalkınca çalışır', dalga3([SALON], { otomatikBaslat: false, pencereBoyutu: 'hizli', odakKaybindaGizle: true }, { paketli: true, ha: HA_VARLIKLARI }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  const oturumOnce = ortam.durum.oturumYazimlari.length;
  const oturumOgesi = () => ortam.menuAgaci().find((d) => /^Windows açılınca başlat/.test(d.oge.label ?? '')).oge;
  const olay = ayarlarOlayi(ortam);
  // Geçici dosyanın yerine klasör koymak ayar yazımını bozar (disk dolu / kilitli dosya taklidi).
  const engel = path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json.tmp');
  fs.mkdirSync(engel);
  const hatalar = () => ortam.durum.bildirimler.filter((b) => b.body === AYAR_YAZILAMADI_METNI).length; // hata türü her zaman Windows bildirimi de çıkarır

  ortam.menuOgesi('Geniş pencere').click({ checked: true });
  assert.equal(ortam.menuOgesi('Geniş pencere').checked, false, 'işaret eski değere döndü');
  assert.equal(hatalar(), 1);
  ortam.menuOgesi('Dışarı tıklayınca gizle').click({ checked: false });
  assert.equal(ortam.menuOgesi('Dışarı tıklayınca gizle').checked, true);
  assert.equal(hatalar(), 2);
  oturumOgesi().click({ checked: true });
  assert.equal(oturumOgesi().checked, false);
  assert.equal(hatalar(), 3);
  assert.equal(ortam.durum.oturumYazimlari.length, oturumOnce, 'yazım başarısızken Windows başlangıç kaydı değiştirilmez');
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.deepEqual([ozet.pencereBoyutu, ozet.odakKaybindaGizle, ozet.otomatikBaslat], ['hizli', true, false]);
  assert.deepEqual(await ortam.durum.ipc.get('otomatik-baslat:etkinlestir')(olay), { ok: false, hata: AYAR_YAZILAMADI_METNI }, 'Ayarlar düğmesi de hatayı söyler');
  assert.equal(ortam.durum.oturumYazimlari.length, oturumOnce);

  fs.rmSync(engel, { recursive: true });
  ortam.menuOgesi('Geniş pencere').click({ checked: true });
  ortam.menuOgesi('Dışarı tıklayınca gizle').click({ checked: false });
  oturumOgesi().click({ checked: true });
  const ayar = ortam.ayarOku();
  assert.deepEqual([ayar.pencereBoyutu, ayar.odakKaybindaGizle, ayar.otomatikBaslat], ['genis', false, true]);
  assert.equal(ortam.durum.oturumYazimlari.length, oturumOnce + 1);
  assert.equal(hatalar(), 3, 'yazım başarılıyken yeni hata yok');
});

ortamda('tepsi menüsü: Ayarlar sayfası bu alanlara dokunmadan kaydedince tepsiden yapılan "Geniş pencere" ve "Dışarı tıklayınca gizle" korunur', dalga3([SALON]), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  ortam.menuOgesi('Geniş pencere').click({ checked: true });
  ortam.menuOgesi('Dışarı tıklayınca gizle').click({ checked: false });
  assert.equal(ortam.ayarOku().pencereBoyutu, 'genis');
  assert.equal(ortam.ayarOku().odakKaybindaGizle, false);
  // Açık Ayarlar sayfası bu alanları yüke koymaz (src/ayarlar.js alanDegisti): değişmeyen alanlar ana süreçte olduğu gibi kalır
  const sonuc = await ortam.durum.ipc.get('ayarlar:kaydet')(ayarlarOlayi(ortam), {
    yerelAdres: 'http://192.168.1.10:8123',
    disAdres: 'https://ha.example.com',
    kisayol: 'Control+Alt+H',
    koseBildirimi: false,
  });
  assert.equal(sonuc.ok, true);
  const ayar = ortam.ayarOku();
  assert.equal(ayar.pencereBoyutu, 'genis', 'tepsi değeri eski anlık görüntüyle ezilmedi');
  assert.equal(ayar.odakKaybindaGizle, false);
  assert.equal(ayar.koseBildirimi, false, 'değişen alan yine kaydedildi');
  assert.equal(ortam.menuOgesi('Geniş pencere').checked, true);
});

// --- tanılama raporu ve günlük düğmesi (o-41) -----------------------------------------------

const TANILAMA = ['tanilama:getir', 'tanilama:kopyala', 'gunluk:klasor-ac'];
const gunlukDosyasi = (ortam) => path.join(ortam.durum.appData, 'gunlukler', 'ev-paneli.log');
const gunluguaYaz = (ortam, ...satirlar) => {
  fs.mkdirSync(path.dirname(gunlukDosyasi(ortam)), { recursive: true });
  fs.appendFileSync(gunlukDosyasi(ortam), satirlar.map((s) => `${s}\n`).join(''));
};

ortamda('tanılama (o-41): rapor ana süreçte kurulur; sürüm, Windows yapısı, adres SINIFI, bağlantı kipi, yetki kesici ve son başarı yazılır; adres, anahtar ve günlük yolu yazılmaz; panoya dokunulmaz', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  ortam.ilerle(400);
  await ortam.akit();
  const yanit = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.equal(yanit.ok, true);
  const { metin } = yanit;
  assert.match(metin, /^Ev Paneli \/ Home Panel diagnostics report\nCreated: \d{4}-\d\d-\d\dT[\d:.]+Z\n/);
  assert.match(metin, /\nApp version: 1\.3\.0 \(development build\)\n/, 'sahte ortamda paketli değil');
  assert.match(metin, /\nElectron: \S+, Chrome: \S+, Node: \d+\.\d+\.\d+/);
  assert.match(metin, /\nSystem: \S+ \S+, \S+\n/);
  assert.match(metin, /\nHome address: private IP, http\nExternal address: public name, https\nConnection: home network\n/);
  assert.match(metin, /\nAccess key: added \(the key itself is never included\)\nKey status: ok\nFailed sign-in attempts counted: 0\nBreaker record: ok\n/);
  assert.match(metin, /\nLast successful contact: \d{4}-\d\d-\d\dT[\d:.]+Z \(\d+ min ago\)\n/, 'REST yenilemesi başarılı oldu');
  assert.match(metin, /\nRecent log lines \(\d+; secrets, addresses and device names masked\):\n/);
  for (const sizinti of [TEST_ANAHTAR, '192.168.1.10', 'ha.example.com', ':8123', 'gunlukler', 'ev-paneli.log', ortam.durum.appData]) {
    assert.equal(metin.includes(sizinti), false, `${sizinti} rapora girdi`);
  }
  assert.deepEqual(Object.keys(yanit).sort(), ['gunlukSatiri', 'metin', 'ok'], 'yanıtta yol ya da başka alan yok');
  assert.deepEqual(ortam.durum.pano, [], 'önizleme panoya yazmaz');
  assert.deepEqual(ortam.durum.klasordeGosterilenler, []);
});

ortamda('tanılama: canlı bağlantı günlerce açık kalsa da son başarılı temas "şimdi" yazılır', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  ortam.ilerle(5 * 24 * 60 * 60_000); // 5 gün: canlı soket hiç kapanmadı
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nLive updates \(WebSocket\): connected\n/);
  assert.match(metin, /\nLast successful contact: \d{4}-\d\d-\d\dT[\d:.]+Z \(0 min ago\)\n/, 'canlı soket açıkken eski bağlanma anı değil, şimdi');
});

ortamda('tanılama (o-41): günlük satırları rapora maskelenmiş girer (URL, IP, varlık kimliği, kullanıcı klasörü, anahtar parmak izi); yalnız son 40 satır', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  await ortam.akit();
  const satirlar = Array.from({ length: 60 }, (_, i) => `2026-10-16T09:00:00.000Z eski olay ${i + 1}`);
  gunluguaYaz(
    ortam,
    ...satirlar,
    `2026-10-16T09:10:00.000Z Sayfa yüklenemedi: ${YEREL_KOK}/lovelace/0 light.salon_lambasi 192.168.1.77 C:\\Users\\zeynepk\\AppData\\x parmak izi=ab12cd34 Bearer ${TEST_ANAHTAR}`,
  );
  const { metin, gunlukSatiri } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.equal(gunlukSatiri, 40);
  assert.match(metin, /Recent log lines \(40;/);
  assert.match(metin, /Sayfa yüklenemedi: \[url\] light\.\[entity\] \[ip\] C:\\Users\\\[user\]\\AppData\\x parmak izi=\[masked\] Bearer \[gizli\]\n/);
  assert.doesNotMatch(metin, /eski olay (1|2|10|20)\n/, 'eski satırlar rapora girmez');
  assert.match(metin, /eski olay 60\n/);
  for (const sizinti of [TEST_ANAHTAR, '192.168.1.77', '192.168.1.10', 'salon_lambasi', 'zeynepk', 'ab12cd34']) assert.equal(metin.includes(sizinti), false, sizinti);
});

ortamda('tanılama (o-41): "tanilama:kopyala" AYNI metni panoya yazar ve önizleme için geri verir; günlüğe yalnız sabit bir satır düşer', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  ortam.ilerle(400);
  await ortam.akit();
  const yanit = await ortam.durum.ipc.get('tanilama:kopyala')(ayarlarOlayi(ortam));
  assert.equal(yanit.ok, true);
  assert.equal(ortam.durum.pano.length, 1);
  assert.equal(ortam.durum.pano[0], yanit.metin, 'kopyalanan metin = gösterilen metin');
  assert.match(yanit.metin, /^Ev Paneli \/ Home Panel diagnostics report\n/);
  assert.match(ortam.gunlukOku(), /Tanılama raporu panoya kopyalandı \(\d+ günlük satırı\)\./);
  assert.equal(ortam.durum.pano[0].includes(TEST_ANAHTAR), false);
  sirsiz(ortam);
  // pano kullanılamıyorsa hata yanıtı döner, uygulama çökmez
  ortam.durum.panoHatasi = true;
  assert.deepEqual(await ortam.durum.ipc.get('tanilama:kopyala')(ayarlarOlayi(ortam)), { ok: false });
  assert.equal(ortam.durum.pano.length, 1);
});

ortamda('tanılama (o-41): anahtar eklenmemişse "no key added" yazılır; bağlantı yoksa "none" ve son başarı "never"', { ...dalga3([SALON]), anahtar: false, yoklama: null }, async (ortam) => {
  await ortam.akit();
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nConnection: none\n/);
  assert.match(metin, /\nAccess key: not added \(the key itself is never included\)\nKey status: no key added\n/);
  assert.match(metin, /\nLast successful contact: never in this session\n/);
});

ortamda('tanılama (o-41): adres sınıfları ayardan okunur (.local, genel IP, boş); tam adres hiçbir sınıfta yazılmaz', { ...dalga3([SALON], { yerelAdres: 'http://homeassistant.local:8123', disAdres: 'https://203.0.113.9:8443' }), anahtar: false, yoklama: null }, async (ortam) => {
  await ortam.akit();
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nHome address: local name \(\.local, \.lan or single label\), http\nExternal address: public IP, https\n/);
  for (const sizinti of ['homeassistant', '203.0.113.9', '8443', '8123']) assert.equal(metin.includes(sizinti), false, sizinti);
});

ortamda('tanılama (o-41): taşınabilir derlemede rapor "portable build" yazar', tasinabilirOrtam(), async (ortam) => {
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nApp version: 1\.3\.0 \(portable build\)\n/);
});

ortamda('tanılama (o-41): "gunluk:klasor-ac" günlük dosyasını klasörde gösterir (yol yanıtta yok); dosya yoksa klasörü açar; ikisi de yoksa nedenini söyler', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  await ortam.akit();
  gunluguaYaz(ortam, '2026-10-16T09:00:00.000Z deneme');
  const olay = ayarlarOlayi(ortam);
  const ac = ortam.durum.ipc.get('gunluk:klasor-ac');
  assert.deepEqual(await ac(olay), { ok: true });
  assert.deepEqual(ortam.durum.klasordeGosterilenler, [gunlukDosyasi(ortam)]);
  assert.deepEqual(ortam.durum.acilanKlasorler, []);
  fs.rmSync(gunlukDosyasi(ortam));
  assert.deepEqual(await ac(olay), { ok: true, klasor: true });
  assert.deepEqual(ortam.durum.acilanKlasorler, [path.dirname(gunlukDosyasi(ortam))]);
  assert.equal(ortam.durum.klasordeGosterilenler.length, 1);
  fs.rmSync(path.dirname(gunlukDosyasi(ortam)), { recursive: true, force: true });
  assert.deepEqual(await ac(olay), { ok: false, neden: 'yok' });
  assert.equal(ortam.durum.acilanKlasorler.length, 1);
});

ortamda('tanılama (o-41): üç kanal da yalnız Ayarlar sayfasına yanıt verir; uzak sayfa ve başka pencere reddedilir (pano ve klasör etkilenmez)', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  await ortam.akit();
  gunluguaYaz(ortam, '2026-10-16T09:00:00.000Z deneme');
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: `${YEREL_KOK}/lovelace`, parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  for (const kanal of TANILAMA) {
    for (const kotu of [uzak, baskaPencere]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
  }
  assert.deepEqual(ortam.durum.pano, []);
  assert.deepEqual(ortam.durum.klasordeGosterilenler, []);
  assert.deepEqual(ortam.durum.acilanKlasorler, []);
});

// --- hazır liste (hiz-07) ------------------------------------------------------------------

ortamda("hazır liste: açılışta TEK read-only GET /api/states ile HA'da bulunanlar eklenir, bulunmayanlar atlanır; sürüm kaydedilir; POST yok", {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [] },
  ha: [
    durumNesnesi('scene.film', 'Film', 'unknown'),
    durumNesnesi('scene.calisma', 'Çalışma', 'unknown'),
    durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'),
    durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'),
  ],
}, async (ortam) => {
  await ortam.akit();
  const tumu = ortam.durum.fetchler.filter((f) => new URL(f.url).pathname === '/api/states' && f.yontem === 'GET');
  assert.equal(tumu.length, 1, 'tek toplu okuma');
  assert.deepEqual(postlar(ortam), []);
  const ayar = ortam.ayarOku();
  assert.equal(ayar.hazirListeSurumu, 1);
  assert.deepEqual(ayar.favoriler.map((f) => f.entity_id).sort(), ['button.pc_bilgisayari_kapat', 'scene.calisma', 'scene.film']);
  assert.equal(ayar.favoriler.some((f) => /lock\.|kapi/i.test(f.entity_id)), false);
  assert.match(ortam.gunlukOku(), /Hazır liste uygulandı: 3 eklendi/);
});

ortamda("hazır liste: sürüm güncelse açılışta HA'ya hiç /api/states isteği gitmez; kullanıcının sildiği karo geri gelmez", dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('scene.film', 'Film', 'unknown')]);
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi']);
  assert.equal(ortam.durum.fetchler.some((f) => new URL(f.url).pathname === '/api/states'), false);
});

// --- canlı bağlantı (hiz-03) ----------------------------------------------------------------

/** Sahte HA'nın WebSocket'ini auth -> abonelik -> anlık görüntü adımlarından geçirir. */
async function canliYap(ortam, durumlar) {
  await ortam.akit();
  // kurulum bekçisi takılı kalan soketi kapatıp yeniden bağlanmış olabilir: kapalı soketle değil, açık olanla konuş
  for (let i = 0; i < 40 && ortam.durum.soketler.at(-1)?.kapatildi; i++) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  const s = ortam.durum.soketler.at(-1);
  assert.ok(s, 'canlı bağlantı için soket açıldı');
  s.yayinla({ type: 'auth_required' });
  await ortam.akit(); // auth adımı küresel kimlikli kapıdan geçer (asenkron)
  s.yayinla({ type: 'auth_ok' });
  const abone = s.gonderilen.find((m) => m.type === 'subscribe_trigger');
  s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  const iste = s.gonderilen.find((m) => m.type === 'get_states');
  s.yayinla({ id: iste.id, type: 'result', success: true, result: durumlar });
  await ortam.akit();
  return { s, aboneId: abone.id };
}

ortamda('canlı bağlantı: anahtar yalnız auth iletisinde gider; canlıyken REST yoklaması YAPILMAZ, durum değişimi açık panele anında yansır', dalga3([SALON], { bildirimPil: false /* pil taraması ayrı bir GET /api/states'tir */ }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, aboneId } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  assert.equal(s.url, 'ws://192.168.1.10:8123/api/websocket');
  assert.deepEqual(s.gonderilen[0], { type: 'auth', access_token: TEST_ANAHTAR });
  assert.equal(s.gonderilen.filter((m) => JSON.stringify(m).includes(TEST_ANAHTAR)).length, 1, 'anahtar tek iletide');
  assert.doesNotMatch(ortam.gunlukOku(), new RegExp(TEST_ANAHTAR));
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).canliDurum, 'canli');

  await paneliAc(ortam);
  const modeldeIsik = () => yuzeyMesajlari(ortam, 'yuzey:durum').at(-1).gruplar.flatMap((g) => g.karolar).find((k) => k.id === 'light.salon_lambasi');
  assert.equal(modeldeIsik().durum, 'kapali');
  const once = ortam.durum.fetchler.length;
  s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.salon_lambasi', to_state: durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on') } } } });
  ortam.ilerle(100); // deponun 50 ms'lik bildirim gruplaması
  assert.equal(modeldeIsik().durum, 'acik', "olay renderer'a REST beklemeden iletildi");
  ortam.ilerle(180_000); // 3 dk: eski yoklama aralığı çoktan geçerdi
  await ortam.akit();
  const yoklamalar = ortam.durum.fetchler.slice(once).filter((f) => f.yontem === 'GET' && /\/api\/states/.test(f.url));
  assert.deepEqual(yoklamalar, [], 'canlı bağlantı varken REST yoklaması yok');
});

ortamda('canlı bağlantı: bağlantı kopunca REST yedeği hemen devreye girer', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  const once = ortam.durum.fetchler.length;
  s.kopar();
  await ortam.akit();
  const yedek = ortam.durum.fetchler.slice(once).filter((f) => f.yontem === 'GET' && /\/api\/states/.test(f.url));
  assert.ok(yedek.length >= 1, 'canlı bağlantı kopunca REST ile durum tazelendi');
});

ortamda('canlı bağlantı: canliBaglanti ayarı kapalıyken hiç WebSocket açılmaz (yalnız REST)', dalga3([SALON], { canliBaglanti: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, 0);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).canliDurum, 'kapali');
});

ortamda('canlı bağlantı: erişim anahtarı yokken soket açılmaz', { yoklama: 200, tohum: { semaSurumu: 4, hazirListeSurumu: 1, favoriler: [SALON] } }, async (ortam) => {
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, 0);
});

// --- tepsi menüsü (hiz-15) ------------------------------------------------------------------

ortamda('tepsi menüsü: favoriler üst düzeyde (tek tık), 8\'den sonrası "Diğer favoriler"de, yıkıcılar "Onaylı eylemler"de; kapı hiç yok', dalga3([
  ...Array.from({ length: 9 }, (_, i) => ({ entity_id: `light.lamba_${i + 1}`, ad: `Lamba ${i + 1}` })),
  PC_KAPAT,
  EKRAN_KAPAT,
]), async (ortam) => {
  haKur(ortam.durum, [
    ...Array.from({ length: 9 }, (_, i) => durumNesnesi(`light.lamba_${i + 1}`, `Lamba ${i + 1}`)),
    ...D3_VARLIKLARI,
  ]);
  await ortam.akit();
  const agac = ortam.menuAgaci();
  const ust = agac.filter((d) => d.ust === null && /^Lamba \d$/.test(d.oge.label)).map((d) => d.oge.label);
  assert.equal(ust.length, 8, 'ilk 8 zararsız favori üst düzeyde');
  assert.deepEqual(agac.filter((d) => d.ust === 'Diğer favoriler').map((d) => d.oge.label), ['Lamba 9', 'Ekranı Kapat  ·  düğme']);
  assert.deepEqual(agac.filter((d) => d.ust === 'Onaylı eylemler').map((d) => d.oge.label), ['Bilgisayarı Kapat — onay ister']);
  assert.equal(agac.some((d) => /\bkap[ıi]\b|garaj|kilit|alarm/i.test(d.oge.label ?? '')), false);
  assert.ok(ortam.menuOgesi('Ayarlar…'), 'mevcut menü öğeleri korunur');
});

ortamda('tepsi menüsü: ayarlı panolar "Panolar" altında; tıklayınca ana pencere açılır', dalga3([SALON], { panolar: [{ ad: 'Enerji', yol: '/energy' }] }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  tusBas(ortam.pencere, ctrlW);
  const pano = ortam.menuAgaci().find((d) => d.ust === 'Panolar' && d.oge.label === 'Enerji');
  assert.ok(pano);
  pano.oge.click();
  assert.equal(ortam.pencere.gorunur, true);
});

ortamda('"Son kullanılanlar": yalnız panel/palet ile çalıştırılan zararsız eylemler girer; tepsi menüsü ve yıkıcı eylemler girmez', dalga3([SALON, PC_KAPAT, { entity_id: 'scene.film', ad: 'Film' }]), async (ortam) => {
  haKur(ortam.durum, D3_VARLIKLARI);
  await ortam.akit();
  await favoriOgesi(ortam, 'Film  ·  sahne').click(); // tepsi: Son'a girmez
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.deepEqual((await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.sonlar, []);
  await ortam.durum.ipc.get('yuzey:calistir')(olay, { kimlik: 'light.salon_lambasi' });
  await ortam.durum.ipc.get('yuzey:basili-basla')(olay, PC_KAPAT.entity_id);
  ortam.ilerle(900);
  await ortam.durum.ipc.get('yuzey:calistir')(olay, { kimlik: PC_KAPAT.entity_id, basili: true });
  await ortam.akit();
  const sonlar = (await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.sonlar;
  assert.deepEqual(sonlar.map((k) => k.id), ['light.salon_lambasi'], 'yıkıcı eylem Son listesine girmez');
});

// ===========================================================================
// Dalga 3 denetim düzeltmeleri
// ===========================================================================

ortamda('kısayol: tuş basılı tutulunca (klavye tekrarı) eylem TEK kez çalışır; bırakıp beklenince yeniden çalışır; palet kısayolu da aç/kapa titremez', dalga3([{ ...SALON, kisayol: 'Control+Alt+L' }]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const kisayol = ortam.durum.kisayollar.get('Control+Alt+L');
  for (let i = 0; i < 40; i += 1) {
    kisayol(); // Windows basılı tutulan tuşta WM_HOTKEY'i ~33 ms'de bir yeniden üretir
    ortam.ilerle(33);
    await ortam.akit();
  }
  assert.equal(postlar(ortam).length, 1, '1,3 sn basılı tutma: tek toggle (eskiden saniyede 8 toggle)');
  ortam.ilerle(1000);
  kisayol();
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2, 'bırakıp bekledikten sonra yeni basış çalışır');

  const palet = ortam.durum.kisayollar.get('Control+Alt+P');
  for (let i = 0; i < 20; i += 1) {
    palet();
    ortam.ilerle(33);
  }
  await ortam.akit();
  assert.equal(ortam.yuzeyPenceresi().gorunur, true, 'palet tek tetiklemeyle açık kaldı (20 tekrar = 20 aç/kapa DEĞİL)');
});

ortamda('tepsi menüsü: ilk 8 favori FAVORİ SIRASINDA seçilir (grup sırasında değil); kullanıcının sırası üst düzeyi belirler', dalga3([
  ...[1, 2, 3].map((i) => ({ entity_id: `switch.priz_${i}`, ad: `Priz ${i}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ entity_id: `light.lamba_${i + 1}`, ad: `Lamba ${i + 1}` })),
]), async (ortam) => {
  haKur(ortam.durum, [
    ...[1, 2, 3].map((i) => durumNesnesi(`switch.priz_${i}`, `Priz ${i}`)),
    ...Array.from({ length: 6 }, (_, i) => durumNesnesi(`light.lamba_${i + 1}`, `Lamba ${i + 1}`)),
  ]);
  await ortam.akit();
  const agac = ortam.menuAgaci();
  const ust = agac.filter((d) => d.ust === null && /^(Priz|Lamba) \d/.test(d.oge.label ?? '')).map((d) => d.oge.label);
  // Eskiden grup sırası (Işık, ..., Diğer) kullanılır: ["Lamba 1".."Lamba 6", "Priz 1", "Priz 2"] çıkardı.
  assert.deepEqual(ust, ['Priz 1', 'Priz 2', 'Priz 3', 'Lamba 1', 'Lamba 2', 'Lamba 3', 'Lamba 4', 'Lamba 5']);
  assert.deepEqual(agac.filter((d) => d.ust === 'Diğer favoriler').map((d) => d.oge.label), ['Lamba 6']);
});

const durumHatasi = (ortam) => ortam.menuAgaci().find((d) => /^Durum alınamadı/.test(d.oge.label ?? ''));

ortamda('durum hatası: canlı bağlantı kurulunca eski REST hatası ("Durum alınamadı") menüden ve panelden kalkar', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.durum.apiYaniti = (url, secenek) => dogrulamaGecer(url, secenek, () => json({}, 500)); // açılışta/uyanışta HA durum okumaları geçici bozuk (tek doğrulama isteği /api/ geçer)
  ortam.ilerle(70_000); // yedek yenileme çalışır
  await ortam.akit();
  assert.ok(durumHatasi(ortam), 'REST hatası menüde görünür');
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.ok((await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.ust.hata, 'panel şeridinde de görünür');

  await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  assert.equal(durumHatasi(ortam), undefined, 'canlı bağlantı sağlıklıyken eski hata gösterilmez');
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.ust.hata, null);
});

ortamda('anahtar kaydı: yanıt, hazır liste eklendikten SONRA döner (Ayarlar bayat favori görüntüsüyle hazır karoları silmesin)', {
  yoklama: 200,
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [] },
}, async (ortam) => {
  haKur(ortam.durum, [durumNesnesi('scene.film', 'Film', 'unknown'), durumNesnesi('scene.calisma', 'Çalışma', 'unknown')]);
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().favoriler, [], 'anahtar yokken hazır liste uygulanamadı');
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), 'YENI_SAHTE_ANAHTAR_000000');
  assert.equal(sonuc.ok, true);
  // YANIT DÖNDÜĞÜ AN (ek bekleme yok): Ayarlar ekranı hemen ayarlar:getir çağırır; hazır karolar o an ayarda olmalı.
  const ayar = ortam.ayarOku();
  assert.deepEqual(ayar.favoriler.map((f) => f.entity_id).sort(), ['scene.calisma', 'scene.film']);
  assert.equal(ayar.hazirListeSurumu, 1);
  const getir = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.deepEqual(getir.favoriler.map((f) => f.entity_id).sort(), ['scene.calisma', 'scene.film']);
});

const HAZIR_SAHNELER = (...kimlikler) => kimlikler.map((k) => durumNesnesi(`scene.${k}`, k, 'unknown'));
const stateOkumalari = (ortam) => ortam.durum.fetchler.filter((f) => f.yontem === 'GET' && new URL(f.url).pathname === '/api/states').length;

ortamda('hazır liste: HA yeni açılmışken bulunamayan karolar oturum içinde (90 sn arayla) YALNIZ onlar için yeniden denenir', {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [], bildirimPil: false }, // bildirimPil: pil taraması da /api/states okur; bu test yalnız hazır listeyi sayar
  ha: HAZIR_SAHNELER('film'), // HA henüz tam açılmadı: yalnız Film var
}, async (ortam) => {
  await ortam.akit();
  const kimlikler = () => ortam.ayarOku().favoriler.map((f) => f.entity_id).sort();
  assert.deepEqual(kimlikler(), ['scene.film']);
  assert.equal(ortam.ayarOku().hazirListeSurumu, 1, 'sürüm yine güncellenir (kullanıcının sildiği karo sonraki açılışlarda geri gelmesin)');
  assert.equal(stateOkumalari(ortam), 1);

  haKur(ortam.durum, HAZIR_SAHNELER('film', 'calisma', 'aksam')); // HA açılışını tamamladı
  ortam.ilerle(89_000);
  await ortam.akit();
  assert.equal(stateOkumalari(ortam), 1, '90 sn dolmadan yeniden deneme yok');
  ortam.ilerle(2_000);
  await ortam.akit();
  assert.deepEqual(kimlikler(), ['scene.aksam', 'scene.calisma', 'scene.film'], 'eksik kalan karolar eklendi');
  assert.equal(stateOkumalari(ortam), 2);
  for (let i = 0; i < 8; i += 1) {
    ortam.ilerle(90_000); // her deneme bir öncekinin sonucundan sonra zamanlanır: adım adım ilerlenir
    await ortam.akit();
  }
  assert.equal(stateOkumalari(ortam), 1 + 3, 'hâlâ eksik olan (HA\'da hiç olmayan) karolar için sonsuz deneme yok: en çok 3 yeniden deneme');
  assert.deepEqual(kimlikler(), ['scene.aksam', 'scene.calisma', 'scene.film']);
});

ortamda('hazır liste: yeniden deneme yeni karo eklerse açık Ayarlar sayfasına "favoriler değişti" haberi gider; eklenmezse gitmez (h-27)', {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [] },
  ha: HAZIR_SAHNELER('film'),
}, async (ortam) => {
  await ortam.akit();
  ayarlarOlayi(ortam); // Ayarlar penceresi açık
  const haberler = () => ortam.ayarlarPenceresi().webContents.mesajlar.filter((m) => m.kanal === 'ayarlar:favoriler-degisti');
  assert.equal(haberler().length, 0);

  ortam.ilerle(91_000); // HA'da yeni karo yok: eklenen olmaz, haber de gitmez
  await ortam.akit();
  assert.equal(haberler().length, 0);

  haKur(ortam.durum, HAZIR_SAHNELER('film', 'calisma'));
  ortam.ilerle(91_000);
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id).sort(), ['scene.calisma', 'scene.film']);
  assert.equal(haberler().length, 1, 'sayfa listeyi tazeler (kullanıcının düzenlemeleri sayfada korunur)');
  assert.equal(haberler()[0].yuk, undefined, 'haberle birlikte veri gitmez');
});

ortamda('hazır liste: HA\'da hiç oluşmayan karolar için yeniden deneme en çok 3 kez yapılır', {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [], bildirimPil: false },
  ha: HAZIR_SAHNELER('film'),
}, async (ortam) => {
  await ortam.akit();
  for (let i = 0; i < 8; i += 1) {
    ortam.ilerle(90_000);
    await ortam.akit();
  }
  assert.equal(stateOkumalari(ortam), 1 + 3);
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['scene.film']);
});

ortamda('komut satırı: hazır olmadan gelen geçerli --eylem hazır olunca TEK POST çalıştırır', dalga3([SALON], {}, { hazirBekle: true }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=salon lambası'], 'C:\\', { eylem: 'salon lambası' });
  assert.deepEqual(postlar(ortam), []);
  ortam.durum.hazirCoz();
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
});

ortamda('komut satırı: hazır olmadan gelen GEÇERSİZ --eylem hazır olunca hata olarak bildirilir (ayarlar yüklenmeden geriBildirim çökmez)', dalga3([SALON], {}, { hazirBekle: true }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem='], 'C:\\');
  ortam.durum.hazirCoz();
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /geçersiz/);
});

ortamda('uyanış: ağ değişmişse canlı bağlantı ve anahtarlı REST DOĞRULANMAMIŞ eski adrese gitmez; adres doğrulanınca bağlanır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.pencere.webContents.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200); // ana pencere eski adreste HA sayfasında
  ortam.guc.emit('suspend');
  await ortam.akit();
  const soketOnce = ortam.durum.soketler.length;
  const fetchOnce = ortam.durum.fetchler.length;

  ortam.durum.yoklamaDurumu = null; // başka ağ: 192.168.1.10:8123 Home Assistant DEĞİL (yanıt yok ya da manifest yok)
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, soketOnce, 'adres doğrulanmadan WebSocket açılmaz (erişim anahtarı eski adrese gitmez)');
  assert.deepEqual(ortam.durum.fetchler.slice(fetchOnce).filter((f) => f.basliklar?.Authorization), [], 'anahtarlı REST isteği de eski adrese gitmez');

  ortam.durum.yoklamaDurumu = 200; // ev ağına dönüldü: doğrulanır
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, soketOnce + 1);
  assert.equal(ortam.durum.soketler.at(-1).url, 'ws://192.168.1.10:8123/api/websocket');
});

/** k-15: açılışta ev içi adres yok (dış adres seçilir); sonra ev ağı geri gelir. */
async function disAdresteAc(ortam) {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const dis = ortam.pencere.webContents.yuklemeler.filter((y) => y.tur === 'url').at(-1);
  assert.equal(dis?.url, 'https://ha.example.com/', 'açılışta ev içi yok: dış adres');
  ortam.pencere.webContents.emit('did-navigate', {}, 'https://ha.example.com/', 200);
  await ortam.akit();
  ortam.durum.yoklamaDurumu = 200; // ev ağı geri geldi
  return () => ortam.durum.fetchler.filter((f) => f.url === 'http://192.168.1.10:8123/manifest.json');
}
const evIciYok = { yoklama: (url) => (url.startsWith('http://192.168.1.10') ? null : 200) };

ortamda('k-15: dış adresteyken ev içi adres geri gelince (3 dk\'da bir, YALNIZ ev içine anahtarsız yoklama) ev içi adrese dönülür', dalga3([SALON], {}, evIciYok), async (ortam) => {
  const yerelYoklamalar = await disAdresteAc(ortam);
  const yoklamaOnce = yerelYoklamalar().length;
  ortam.pencere.odakKaybet(); // kullanıcı pencereyi kullanmıyor
  ortam.ilerle(3 * 60_000 - 1000);
  await ortam.akit();
  assert.equal(yerelYoklamalar().length, yoklamaOnce, '3 dk dolmadan yoklama yok');
  ortam.ilerle(1000);
  await ortam.akit();
  const yeni = yerelYoklamalar().slice(yoklamaOnce);
  assert.equal(yeni.length, 1, 'tek anahtarsız yoklama');
  assert.equal(yeni[0].basliklar, undefined, 'yoklamada anahtar yok');
  assert.equal(ortam.pencere.webContents.yuklemeler.at(-1).url, 'http://192.168.1.10:8123/', 'ana pencere ev içi adrese taşındı');
  assert.ok(ortam.gunlukOku().includes('Ev içi adres yeniden ulaşılabilir; ev ağı adresine dönülüyor.'));
});

ortamda('k-15: pencere odaktayken (kullanıcı HA sayfasını kullanıyor) sayfa altından değiştirilmez; yoklama da yapılmaz', dalga3([SALON], {}, evIciYok), async (ortam) => {
  const yerelYoklamalar = await disAdresteAc(ortam);
  const yoklamaOnce = yerelYoklamalar().length;
  assert.equal(ortam.pencere.odakta, true);
  ortam.ilerle(3 * 60_000);
  await ortam.akit();
  assert.equal(yerelYoklamalar().length, yoklamaOnce);
  assert.equal(ortam.pencere.webContents.yuklemeler.at(-1).url, 'https://ha.example.com/');
});

ortamda('hızlı panel: Windows odağı vermezse (ön plan kilidi) kısa süre sonra öne alınıp odak yeniden istenir; odak alındıysa dokunulmaz', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  ortam.ilerle(400);
  assert.equal(panel.odakta, true);
  assert.equal(panel.cagri.moveTop ?? 0, 0, 'odak alındı: yedek devreye girmez');

  ortam.ilerle(200); // çift tık süresi (k-17) geçsin
  ortam.tepsi.emit('click'); // kapat
  assert.equal(panel.gorunur, false);
  ortam.ilerle(5000);
  panel.focus = function odakVerilmedi() {
    this.cagri.focus += 1; // Windows ön plan kilidi: focus() çağrıldı ama odak gelmedi
  };
  const odakOnce = panel.cagri.focus;
  ortam.tepsi.emit('click');
  await ortam.akit();
  assert.equal(panel.gorunur, true);
  assert.equal(panel.odakta, false);
  ortam.ilerle(300);
  assert.equal(panel.cagri.moveTop, 1, 'öne alındı');
  assert.equal(panel.cagri.focus, odakOnce + 2, 'gösterim + yedek: odak yeniden istendi');
  ortam.ilerle(5000);
  assert.equal(panel.cagri.moveTop, 1, 'yedek tek sefer');
});

ortamda('yüzey IPC: basılı tutma süre dolmadan bırakılırsa ana süreçteki başlangıç silinir (sonradan "yeterince uzun" sayılmaz); yalnız yüzey sayfasından kabul edilir', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const basla = ortam.durum.ipc.get('yuzey:basili-basla');
  const birak = ortam.durum.ipc.get('yuzey:basili-birak');
  const calistir = ortam.durum.ipc.get('yuzey:calistir');

  assert.deepEqual(await basla(olay, PC_KAPAT.entity_id), { ok: true });
  ortam.ilerle(300);
  assert.deepEqual(await birak(olay, PC_KAPAT.entity_id), { ok: true });
  ortam.ilerle(900); // bırakılan basış sonradan 0,8 sn'yi aşmış görünmemeli
  assert.equal((await calistir(olay, { kimlik: PC_KAPAT.entity_id, basili: true })).tur, 'onay-gerekli');
  assert.deepEqual(postlar(ortam), []);

  const uzak = { sender: panel.webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  assert.deepEqual(await birak(uzak, PC_KAPAT.entity_id), { ok: false, hata: 'İzin yok.' });
  assert.deepEqual(await birak(olay, 42), { ok: true }, 'geçersiz kimlik zararsızdır');
});

// ===========================================================================
// Dalga 4: Windows 11 görünümü (malzeme), tema, vurgu rengi, tepsi ipucu ve soluk simge
// ===========================================================================

const IKON_SOLUK_ADI = 'ikon-soluk.ico';
const IKON_ADI = 'ikon.ico';
const simgeAdi = (simge) => path.basename(String(simge));
const ISIK_ACIK_VARLIKLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'),
  durumNesnesi('light.smart_multicolor_bulb', 'Ampul', 'on'),
  durumNesnesi('switch.priz', 'Priz', 'on'),
];
const D4_FAVORILERI = [
  SALON,
  { entity_id: 'light.smart_multicolor_bulb', ad: 'Ampul', etiket: 'Ampul' },
  { entity_id: 'switch.priz', ad: 'Priz', etiket: 'Priz' },
];
/** Dalga 3 ayarları + Görünüm alanları (şema 5). */
const dalga4 = (favoriler, ek = {}, secenek = {}) => {
  const temel = dalga3(favoriler, ek, secenek);
  return { ...temel, tohum: { ...temel.tohum, semaSurumu: 5 } };
};

ortamda('tepsi ipucu: bağlanırken "Bağlanıyor…", bağlanınca "Ev ağı" ve açık ışık sayısı yazılır (anahtar ve priz sayılmaz); REST yedeğinde "son bilinen" denmez', dalga4(D4_FAVORILERI, { canliBaglanti: false }, { ha: ISIK_ACIK_VARLIKLARI }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const ipuclari = ortam.tepsi.ipuclari;
  assert.ok(ipuclari.includes('Ev Paneli [geliştirme] — Bağlanıyor…'), 'bağlanırken ipucu');
  assert.equal(ipuclari.at(-1), 'Ev Paneli [geliştirme] — Ev ağı — 2 ışık açık');
  assert.ok(ipuclari.every((m) => Array.from(m).length <= 120));
  assert.equal(new Set(ipuclari).size, ipuclari.length, 'aynı ipucu art arda yeniden yazılmaz');
});

ortamda('tepsi ipucu: canlı bağlantıda ışık açılınca/kapanınca sayı anında değişir; bağlantı kopup REST de hata verirse "(son bilinen)" notu düşülür', dalga4(D4_FAVORILERI), async (ortam) => {
  haKur(ortam.durum, ISIK_ACIK_VARLIKLARI);
  const { s, aboneId } = await canliYap(ortam, [
    durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'),
    durumNesnesi('light.smart_multicolor_bulb', 'Ampul', 'off'),
    durumNesnesi('switch.priz', 'Priz', 'on'),
  ]);
  ortam.ilerle(100);
  assert.equal(ortam.tepsi.ipuclari.at(-1), 'Ev Paneli [geliştirme] — Ev ağı — 1 ışık açık');
  s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.smart_multicolor_bulb', to_state: durumNesnesi('light.smart_multicolor_bulb', 'Ampul', 'on') } } } });
  ortam.ilerle(100);
  assert.equal(ortam.tepsi.ipuclari.at(-1), 'Ev Paneli [geliştirme] — Ev ağı — 2 ışık açık');
  ortam.durum.apiYaniti = () => json({}, 500); // REST yedeği de çalışmıyor
  s.kopar();
  await ortam.akit();
  ortam.ilerle(100);
  await ortam.akit();
  assert.match(ortam.tepsi.ipuclari.at(-1), /2 ışık açık \(son bilinen\)$/);
});

ortamda('tepsi ipucu: kapı ışığı favori olamadığı için sayıya girmez (kapı kuralı)', dalga4([SALON, { entity_id: 'light.garaj_kapisi_durum_led', ad: 'Garaj Kapısı Durum LED' }], { canliBaglanti: false }, { ha: [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'), durumNesnesi('light.garaj_kapisi_durum_led', 'Garaj Kapısı Durum LED', 'on')] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(ortam.tepsi.ipuclari.at(-1), 'Ev Paneli [geliştirme] — Ev ağı — 1 ışık açık');
});

ortamda('tepsi simgesi: bağlanırken soluk, bağlanınca normal (açılışta soluk-normal-soluk titremesi yok)', dalga4(D4_FAVORILERI, { canliBaglanti: false }, { ha: ISIK_ACIK_VARLIKLARI }), async (ortam) => {
  assert.equal(simgeAdi(ortam.tepsi.simgeler[0]), IKON_SOLUK_ADI, 'açılışta bağlanıyor: soluk simgeyle başlar');
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(simgeAdi(ortam.tepsi.simgeler.at(-1)), IKON_ADI, 'bağlantı kurulunca normal simge');
  assert.deepEqual(ortam.tepsi.simgeler.map(simgeAdi), [IKON_SOLUK_ADI, IKON_ADI]);
});

ortamda('tepsi simgesi: ev ve internet adresi de yanıt vermiyorsa simge soluk ve ipucu "Bağlantı yok"', { yoklama: null }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(30_000);
  await ortam.akit();
  assert.equal(simgeAdi(ortam.tepsi.simgeler.at(-1)), IKON_SOLUK_ADI);
  assert.match(ortam.tepsi.ipuclari.at(-1), /^Ev Paneli \[geliştirme\] — Bağlantı yok$/);
  assert.ok(ortam.tepsi.simgeler.every((s) => /ikon(-soluk)?\.ico$/.test(String(s))), 'yalnız paketlenmiş simge dosyaları');
});

ortamda('ilk gizleme: tepsi ipucu bildirimi görünür alana sürükleme yönergesini içerir ve yalnız bir kez çıkar', undefined, ({ pencere, durum, ilerle }) => {
  ilerle(400);
  pencere.emit('close', { preventDefault() {} });
  assert.equal(durum.bildirimler.length, 1);
  assert.equal(durum.bildirimler[0].body, TEPSI_IPUCU_BILDIRIMI);
  assert.match(durum.bildirimler[0].body, /\^ okundan görünür alana sürükle\./);
  assert.match(durum.bildirimler[0].body, /Çıkış/);
  pencere.emit('close', { preventDefault() {} });
  assert.equal(durum.bildirimler.length, 1, 'ikinci gizlemede tekrar çıkmaz');
});

// --- tema ve vurgu rengi (gorunum-13) ---------------------------------------------------------

ortamda('tema: varsayılan "koyu" iken nativeTheme.themeSource "dark" olur; özel başlık çubuğu yok (sistem çerçevesi)', undefined, (ortam) => {
  assert.equal(ortam.durum.nativeTheme.themeSource, 'dark');
  assert.notEqual(ortam.pencere.secenekler.frame, false, 'ana pencere sistem çerçevesini korur');
  assert.equal(ortam.pencere.secenekler.titleBarStyle, undefined);
  assert.equal(ortam.pencere.secenekler.titleBarOverlay, undefined);
});

ortamda('tema: ayar "sistem" ise nativeTheme.themeSource "system" kalır', { tohum: { semaSurumu: 5, temaZorla: 'sistem' } }, (ortam) => {
  assert.equal(ortam.durum.nativeTheme.themeSource, 'system');
});

ortamda('tema: Ayarlardan değiştirince hemen uygulanır ve diske yazılır; geçersiz değer yok sayılır', undefined, async (ortam) => {
  assert.equal(ortam.durum.nativeTheme.themeSource, 'dark');
  const sonuc = await ayarlarKaydet(ortam, { temaZorla: 'sistem' });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.durum.nativeTheme.themeSource, 'system');
  assert.equal(ortam.ayarOku().temaZorla, 'sistem');
  await ayarlarKaydet(ortam, { temaZorla: 'mor' });
  assert.equal(ortam.durum.nativeTheme.themeSource, 'system', 'geçersiz değer mevcut olanı korur');
  assert.equal(ortam.ayarOku().temaZorla, 'sistem');
  await ayarlarKaydet(ortam, { temaZorla: 'koyu' });
  assert.equal(ortam.durum.nativeTheme.themeSource, 'dark');
});

ortamda('vurgu rengi: varsayılan boşken ana pencereye setAccentColor(null) (Windows rengi) uygulanır', undefined, (ortam) => {
  assert.deepEqual(ortam.pencere.vurgular, [null]);
});

ortamda('vurgu rengi: kayıtlı "#rrggbb" ana pencereye açılışta uygulanır', { tohum: { semaSurumu: 5, vurguRengi: '#0f75e0' } }, (ortam) => {
  assert.deepEqual(ortam.pencere.vurgular, ['#0f75e0']);
});

ortamda('vurgu rengi: Ayarlardan değişince ana ve Ayarlar penceresine uygulanır; sıfırlayınca null; geçersiz renk yalnız uyarı', undefined, async (ortam) => {
  const sonuc = await ayarlarKaydet(ortam, { vurguRengi: '#E91E63' });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().vurguRengi, '#e91e63');
  assert.equal(ortam.pencere.vurgular.at(-1), '#e91e63');
  assert.equal(ortam.ayarlarPenceresi().vurgular.at(-1), '#e91e63');

  const kotu = await ayarlarKaydet(ortam, { vurguRengi: 'kirmizi', temaZorla: 'sistem' });
  assert.equal(kotu.ok, true);
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'vurguRengi'));
  assert.equal(ortam.ayarOku().vurguRengi, '#e91e63', 'önceki renk korunur');
  assert.equal(ortam.ayarOku().temaZorla, 'sistem', 'diğer ayarlar yine kaydedilir');

  await ayarlarKaydet(ortam, { vurguRengi: '' });
  assert.equal(ortam.ayarOku().vurguRengi, '');
  assert.equal(ortam.pencere.vurgular.at(-1), null);
});

// --- yeni pencerelerin malzemesi (gorunum-11) -------------------------------------------------

ortamda('malzeme: ana HA penceresine malzeme VERİLMEZ ve rengi değişmez; transparent kullanılmaz', undefined, (ortam) => {
  const ana = ortam.pencere.secenekler;
  assert.equal(ana.backgroundMaterial, undefined, 'ana pencere malzemesiz');
  assert.equal(ana.backgroundColor, '#14161b', 'ana pencerenin rengi değişmedi');
  assert.equal(ana.transparent, undefined);
  assert.deepEqual(ortam.pencere.malzemeler, []);
});

ortamda('malzeme: Windows 11 22H2+ ve varsayılan ayarla hızlı panel acrylic ve saydam arka planla açılır; transparent kullanılmaz', dalga4([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, 'acrylic');
  assert.equal(panel.secenekler.backgroundColor, '#00000000');
  assert.equal(panel.secenekler.transparent, undefined, 'transparent kullanılmaz');
  assert.equal(panel.secenekler.roundedCorners, true);
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'acrylic', etkilesim: { tekerlek: true, sabit: false } }]);
});

ortamda('malzeme: ayar "mica" ise panel mica ile açılır', dalga4([SALON, PC_KAPAT], { yeniPencereMalzemesi: 'mica' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, 'mica');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'mica', etkilesim: { tekerlek: true, sabit: false } }]);
});

ortamda('malzeme: ayar "Düz" (yok) ise panel eski opak koyu renkle açılır, backgroundMaterial verilmez', dalga4([SALON, PC_KAPAT], { yeniPencereMalzemesi: 'yok' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, undefined);
  assert.equal(panel.secenekler.backgroundColor, '#1b1f27');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'yok', etkilesim: { tekerlek: true, sabit: false } }]);
});

ortamda('malzeme: Windows 10 ya da eski Windows 11 (yapı < 22621) malzemeyi desteklemez: opak koyu renk, düz mod', dalga4([SALON, PC_KAPAT], {}, { osSurumu: '10.0.19045' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, undefined);
  assert.equal(panel.secenekler.backgroundColor, '#1b1f27');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'yok', etkilesim: { tekerlek: true, sabit: false } }]);
  const getir = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(getir.malzemeDestekleniyor, false, 'Ayarlar sayfası uyarı göstersin');
});

ortamda('malzeme: Ayarlar sayfasına destek durumu, seçili malzeme, tema ve vurgu rengi bildirilir', undefined, async (ortam) => {
  const getir = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(getir.malzemeDestekleniyor, true);
  assert.equal(getir.yeniPencereMalzemesi, 'acrylic');
  assert.equal(getir.temaZorla, 'koyu');
  assert.equal(getir.vurguRengi, '');
});

ortamda('malzeme: ayarı değiştirince AÇIK panel yeni malzemeyi anında alır (yuzey:goster beklenmeden)', dalga4([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, 'acrylic');
  const sonuc = await ayarlarKaydet(ortam, { yeniPencereMalzemesi: 'yok' });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().yeniPencereMalzemesi, 'yok');
  assert.equal(panel.malzemeler.at(-1), 'none', 'mevcut pencerede malzeme kaldırıldı');
  assert.equal(panel.arkaPlanRenkleri.at(-1), '#1b1f27');
});

// ===========================================================================
// 1.1.1: yetki kesici ve tek doğrulama geçidi (geçersiz anahtarla HA ip_ban tetiklenmesin)
// ===========================================================================
// Olay (2026-10-07): silinmiş anahtarla açılışta ~8 kimlikli istek + WebSocket auth, ev içi adres banlanınca dış adrese geçip
// yine ~6 istek -> evin internet IP'si de banlandı. Aşağıdaki testler geçersiz anahtar başına HA'ya EN ÇOK 1 hatalı deneme
// gittiğini, kesici açıkken (yeniden başlatma dahil) HİÇBİR adrese anahtar gitmediğini sınar. Ağ yok: net.fetch sahtedir.

const YEREL_KOK = 'http://192.168.1.10:8123';
const DIS_KOK = 'https://ha.example.com';
const SEKIZ_ISIK = Array.from({ length: 8 }, (_, i) => ({ entity_id: `light.lamba_${i + 1}`, ad: `Lamba ${i + 1}` }));
const REDDEDILMIS_KAYIT = (anahtar = TEST_ANAHTAR) => ({
  'yetki-kesici.json': JSON.stringify({ surum: 1, reddedilenler: [{ parmakIzi: anahtarParmakIzi(anahtar), zaman: 1, neden: 'HTTP_401' }] }),
});
const kimlikliler = (ortam) => ortam.durum.fetchler.filter((f) => f.basliklar?.Authorization);
const disIstekleri = (ortam) => ortam.durum.fetchler.filter((f) => f.url.startsWith(DIS_KOK));
const hepsiniReddet = () => json({ message: '401: Unauthorized' }, 401);
const hepsiYasak = () => json({ message: 'Forbidden' }, 403);
const dogrulamaGecer = (url, secenek, sonraki) => (new URL(url).pathname === '/api/' && (secenek.method ?? 'GET') === 'GET' ? json({ message: 'API running.' }) : sonraki(url, secenek));
const reddedilmeBildirimleri = (ortam) => ortam.durum.bildirimler.filter((b) => b.body === ANAHTAR_REDDEDILDI_BILDIRIMI);
const sirsiz = (ortam) => {
  const hepsi = JSON.stringify([ortam.gunlukOku(), ortam.durum.bildirimler.map((b) => b.body), ortam.tepsi.ipuclari, ortam.durum.fetchler.map((f) => f.url), koseMesajlari(ortam)]);
  assert.ok(!hepsi.includes(TEST_ANAHTAR), 'anahtar günlükte/bildirimde/ipucunda yok');
  assert.ok(!/Bearer/.test(ortam.gunlukOku()));
};

ortamda('yetki kesici (a): geçersiz anahtar + 8 favori + canlı bağlantı: açılışta kimlikli istek TAM 1 (doğrulama), dış adrese 0, WebSocket 0; tek bildirim ve görünür durum', { ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const k = kimlikliler(ortam);
  assert.equal(k.length, 1, 'HA\'ya tek (hatalı) deneme');
  assert.equal(k[0].url, `${YEREL_KOK}/api/`);
  assert.equal(k[0].yontem, 'GET');
  assert.deepEqual(disIstekleri(ortam), [], 'dış adrese hiçbir istek gitmedi (yoklama dahil)');
  assert.equal(ortam.durum.soketler.length, 0, 'WebSocket hiç açılmadı');

  // 10 dk sonra (60 sn'lik yoklamalar, yeniden bağlanma zamanlayıcıları) hâlâ 1
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1);
  assert.equal(ortam.durum.soketler.length, 0);
  assert.deepEqual(disIstekleri(ortam), []);

  // kullanıcı bilgilendirilir: parmak izi başına BİR Windows bildirimi, tepsi ipucu, menü, panel, Ayarlar
  assert.equal(reddedilmeBildirimleri(ortam).length, 1);
  assert.equal(ANAHTAR_REDDEDILDI_BILDIRIMI, 'Erişim anahtarı Home Assistant tarafından reddedildi. Güvenlik için istekler durduruldu; Ayarlar’dan yeni bir anahtar kaydet.');
  assert.match(ortam.tepsi.ipuclari.at(-1), new RegExp(ANAHTAR_REDDEDILDI_KISA_METNI));
  assert.ok(Array.from(ortam.tepsi.ipuclari.at(-1)).length <= 120);
  assert.ok(ortam.menuOgesi(ANAHTAR_REDDEDILDI_MENU_METNI), 'tepsi menüsünde görünür durum');
  const panel = await paneliAc(ortam);
  assert.equal(yuzeyMesajlari(ortam, 'yuzey:durum').at(-1).ust.uyari, ANAHTAR_REDDEDILDI_KISA_METNI, 'hızlı panelin üstünde kısa uyarı');
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam, panel))).model.ust.uyari, ANAHTAR_REDDEDILDI_KISA_METNI);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ozet.anahtarVar, true);
  assert.equal(ozet.anahtarReddedildi, true);

  // günlük: tek satır, sırsız (neden kodu + parmak izinin ilk 8 hanesi)
  const satirlar = ortam.gunlukOku().split('\n').filter((s) => /Yetki kesici: anahtar reddedildi/.test(s));
  assert.equal(satirlar.length, 1);
  assert.match(satirlar[0], /neden=HTTP_401/);
  assert.ok(satirlar[0].includes(anahtarParmakIzi(TEST_ANAHTAR).slice(0, 8)));
  sirsiz(ortam);
  // kalıcı kayıt: yalnız parmak izi
  const dosya = fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8');
  assert.ok(dosya.includes(anahtarParmakIzi(TEST_ANAHTAR)));
  assert.ok(!dosya.includes(TEST_ANAHTAR));
});

test('yetki kesici (b): uygulama yeniden başlayınca (kalıcı kayıt) aynı anahtarla 0 kimlikli istek, 0 WebSocket, yeniden bildirim yok', async () => {
  const ilk = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet });
  let kayit;
  try {
    await ilk.akit();
    assert.equal(kimlikliler(ilk).length, 1);
    kayit = fs.readFileSync(path.join(ilk.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8');
  } finally {
    await ilk.temizle();
  }
  const yeniden = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet, ekDosyalar: { 'yetki-kesici.json': kayit } });
  try {
    await yeniden.akit();
    yeniden.ilerle(10 * 60_000);
    await yeniden.akit();
    assert.deepEqual(kimlikliler(yeniden), [], 'aynı anahtarla HİÇ kimlikli istek');
    assert.deepEqual(disIstekleri(yeniden), []);
    assert.equal(yeniden.durum.soketler.length, 0);
    assert.equal(reddedilmeBildirimleri(yeniden).length, 0, 'bildirim parmak izi başına bir kez: yeniden açılışta tekrarlanmaz');
    assert.match(yeniden.tepsi.ipuclari.at(-1), new RegExp(ANAHTAR_REDDEDILDI_KISA_METNI), 'ama durum tepsiden ilk andan görünür');
    assert.match(yeniden.gunlukOku(), /1 reddedilmiş anahtar kaydı yüklendi/);
    sirsiz(yeniden);
  } finally {
    await yeniden.temizle();
  }
});

ortamda('yetki kesici (c): farklı parmak izli yeni anahtar: TEK doğrulama -> 200 -> normal akış (durum istekleri, canlı bağlantı), kesici kapanır', { ...dalga3([SALON]), ekDosyalar: REDDEDILMIS_KAYIT(), ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), [], 'kayıtlı anahtar reddedilmiş: açılışta 0 istek');
  assert.ok(ortam.menuOgesi(ANAHTAR_REDDEDILDI_MENU_METNI));
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), 'YENI_SAHTE_ANAHTAR_000000');
  assert.deepEqual(sonuc, { ok: true, uyari: '' });
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const dogrulamalar = kimlikliler(ortam).filter((f) => new URL(f.url).pathname === '/api/');
  assert.equal(dogrulamalar.length, 1, 'kayıt + sonraki akış boyunca yalnız 1 doğrulama');
  assert.equal(dogrulamalar[0].basliklar.Authorization, 'Bearer YENI_SAHTE_ANAHTAR_000000');
  assert.ok(kimlikliler(ortam).some((f) => f.url === `${YEREL_KOK}/api/states/light.salon_lambasi`), 'normal akış sürüyor');
  assert.equal(ortam.durum.soketler.length, 1, 'canlı bağlantı yeni anahtarla kuruldu');
  assert.equal(ortam.durum.soketler[0].url, 'ws://192.168.1.10:8123/api/websocket');
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarReddedildi, false);
  assert.ok(!ortam.tepsi.ipuclari.at(-1).includes(ANAHTAR_REDDEDILDI_KISA_METNI));
  assert.equal(ortam.menuOgesi(ANAHTAR_REDDEDILDI_MENU_METNI), undefined);
  assert.equal(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat'), 'utf8'), `${SIFRE_ONEKI}YENI_SAHTE_ANAHTAR_000000`);
  assert.equal(reddedilmeBildirimleri(ortam).length, 0);
});

ortamda('yetki kesici (d): reddedilmiş anahtarı yeniden kaydetmek kesiciyi sıfırlamaz ve Home Assistant\'a HİÇ istek göndermez', { ...dalga3([SALON]), ekDosyalar: REDDEDILMIS_KAYIT(), ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  const anahtarYolu = path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat');
  const dosyaOnce = fs.readFileSync(anahtarYolu, 'utf8');
  const fetchOnce = ortam.durum.fetchler.length;
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), TEST_ANAHTAR);
  assert.deepEqual(sonuc, { ok: false, hata: ANAHTAR_ZATEN_REDDEDILDI_METNI });
  assert.equal(ortam.durum.fetchler.length, fetchOnce, 'ağa hiçbir şey çıkmadı');
  assert.equal(fs.readFileSync(anahtarYolu, 'utf8'), dosyaOnce);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarReddedildi, true);
  assert.ok(ortam.menuOgesi(ANAHTAR_REDDEDILDI_MENU_METNI));
});

ortamda('yetki kesici (G6): Ayarlar\'da denenen yeni anahtarı HA reddederse: TEK istek, kaydedilmez, kullanıcıya söylenir, aynı aday yeniden denenmez; kayıtlı anahtar etkilenmez', {
  ...dalga3([SALON]),
  apiYaniti: (url, secenek) => (secenek.headers?.Authorization === `Bearer ${TEST_ANAHTAR}` ? haYanitiOlustur(HA_VARLIKLARI)(url, secenek) : hepsiniReddet()),
}, async (ortam) => {
  await ortam.akit();
  const anahtarYolu = path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat');
  const dosyaOnce = fs.readFileSync(anahtarYolu, 'utf8');
  const once = kimlikliler(ortam).length;
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), 'REDDEDILECEK_ANAHTAR_000000');
  assert.deepEqual(sonuc, { ok: false, hata: ANAHTAR_KAYDI_REDDEDILDI_METNI });
  const yeniIstekler = kimlikliler(ortam).slice(once);
  assert.equal(yeniIstekler.length, 1, 'doğrulama TEK istek');
  assert.equal(yeniIstekler[0].basliklar.Authorization, 'Bearer REDDEDILECEK_ANAHTAR_000000');
  assert.equal(fs.readFileSync(anahtarYolu, 'utf8'), dosyaOnce, 'reddedilen anahtar kaydedilmedi');
  assert.equal(reddedilmeBildirimleri(ortam).length, 0, 'aday anahtar için Windows bildirimi çıkmaz (sonuç Ayarlar\'da görünür)');
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarReddedildi, false, 'kayıtlı anahtar hâlâ çalışıyor');
  const tekrar = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), 'REDDEDILECEK_ANAHTAR_000000');
  assert.deepEqual(tekrar, { ok: false, hata: ANAHTAR_ZATEN_REDDEDILDI_METNI });
  assert.equal(kimlikliler(ortam).slice(once).length, 1, 'aynı aday için ikinci istek yok');
});

ortamda('yetki kesici: "Anahtarı sil" reddedilenler kaydını temizler; aynı anahtar yeniden eklenirse yine TEK doğrulama gider', { ...dalga3([SALON]), ekDosyalar: REDDEDILMIS_KAYIT(), ha: HA_VARLIKLARI }, async (ortam) => {
  await ortam.akit();
  const sil = await ortam.durum.ipc.get('anahtar:sil')(ayarlarOlayi(ortam));
  assert.equal(sil.ok, true);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).anahtarReddedildi, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8')).reddedilenler, []);
  const sonuc = await ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), TEST_ANAHTAR);
  assert.deepEqual(sonuc, { ok: true, uyari: '' });
  await ortam.akit();
  assert.equal(kimlikliler(ortam).filter((f) => new URL(f.url).pathname === '/api/').length, 1);
});

ortamda('yetki kesici (e): WebSocket auth_invalid -> kesici açılır, yeniden bağlanma yok, REST yedeği de kimlikli istek atmaz, tek bildirim', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const s = ortam.durum.soketler.at(-1);
  assert.ok(s, 'soket açıldı (doğrulama 200)');
  s.yayinla({ type: 'auth_required' });
  await ortam.akit();
  assert.deepEqual(s.gonderilen[0], { type: 'auth', access_token: TEST_ANAHTAR });
  s.yayinla({ type: 'auth_invalid', message: 'Invalid access token or password' });
  await ortam.akit();
  const soketSayisi = ortam.durum.soketler.length;
  const once = kimlikliler(ortam).length;
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, soketSayisi, 'yeniden bağlanma yok');
  assert.equal(kimlikliler(ortam).length, once, 'REST yedeği ve yoklamalar kimlikli istek atmaz');
  assert.equal(reddedilmeBildirimleri(ortam).length, 1);
  assert.match(ortam.tepsi.ipuclari.at(-1), new RegExp(ANAHTAR_REDDEDILDI_KISA_METNI));
  assert.ok(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8').includes(anahtarParmakIzi(TEST_ANAHTAR)));
  assert.match(ortam.gunlukOku(), /neden=WS_AUTH_INVALID/);
  sirsiz(ortam);
});

ortamda('yetki kesici (f): toplu istek ortasında 401 -> kalan varlıklar için istek ağa HİÇ çıkmaz (ilk istek tek başına gider: ek hatalı deneme 0)', {
  ...dalga3(SEKIZ_ISIK, { canliBaglanti: false }),
  apiYaniti: (url, secenek) => dogrulamaGecer(url, secenek, hepsiniReddet),
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const durumIstekleri = kimlikliler(ortam).filter((f) => /^\/api\/states\//.test(new URL(f.url).pathname));
  assert.equal(durumIstekleri.length, 1, 'ilk istek tek başına gitti ve 401 aldı; ek hatalı deneme 0');
  assert.equal(kimlikliler(ortam).length, 1 + durumIstekleri.length);
  const istenenler = new Set(durumIstekleri.map((f) => new URL(f.url).pathname));
  assert.ok(!istenenler.has('/api/states/light.lamba_8'), 'sıradaki varlıklar için istek atılmadı');
  ortam.ilerle(5 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1 + durumIstekleri.length, 'kesici açıldıktan sonra yeni istek yok');
  assert.equal(reddedilmeBildirimleri(ortam).length, 1);
});

ortamda('yetki kesici (g): kimlikli istekte 403 -> anahtar GEÇERSİZ SAYILMAZ, o adrese 15 dk kimlikli istek yok, paralel deneme yok, adres değişmez, dış adrese geçilmez', {
  ...dalga3(SEKIZ_ISIK, { canliBaglanti: false }),
  apiYaniti: hepsiYasak,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, 'tek doğrulama isteği 403 aldı, paralel yeniden deneme yok');
  ortam.ilerle(14 * 60_000); // 60 sn'lik yoklamalar: hepsi yerel olarak durdurulur
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, '15 dk dolmadan ağa kimlikli hiçbir şey çıkmadı');
  assert.deepEqual(disIstekleri(ortam), [], 'adres değişmedi: dış adrese hiçbir şey gitmedi');
  assert.equal(ortam.pencere.webContents.yuklemeler.filter((y) => y.tur === 'url').every((y) => y.url.startsWith(YEREL_KOK)), true);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ozet.anahtarReddedildi, false, '403 anahtarı reddedilmiş saymaz');
  assert.equal(reddedilmeBildirimleri(ortam).length, 0);
  const kayit403 = JSON.parse(kesiciKaydi(ortam) ?? '{}'); // doğrulama isteği sırasında geçici "yolda" işareti yazılıp silinmiş olabilir
  assert.deepEqual([kayit403.reddedilenler ?? [], kayit403.belirsiz ?? [], kayit403.yolda ?? []], [[], [], []], '403 kalıcı reddedilme/belirsiz kaydı oluşturmaz');
  assert.equal(ortam.gunlukOku().split('\n').filter((s) => /duraklatıldı/.test(s)).length, 1, 'tek günlük satırı');

  ortam.ilerle(2 * 60_000); // 15 dk doldu: yeniden TEK doğrulama gider (yine 403 -> yine duraklatılır)
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 2);
  ortam.ilerle(5 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 2);
  sirsiz(ortam);
});

ortamda('yetki kesici (h): ev içi adres AĞ hatası verirse dış adrese geçiş geçerli anahtarla ve YİNE önce tek doğrulamayla olur', {
  ...dalga3([SALON], { canliBaglanti: false }),
  yoklama: (() => {
    let yerelYoklamasi = 0;
    return (url) => (url.startsWith(DIS_KOK) ? 200 : (yerelYoklamasi += 1) === 1 ? 200 : null); // ev içi ilk yoklamada görünür, sonra düşer
  })(),
  apiYaniti: (url, secenek) => {
    if (url.startsWith(YEREL_KOK)) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }); // ev içi adrese kimlikli istek (gönderim ÖNCESİ) ağ hatası alır
    return haYanitiOlustur(HA_VARLIKLARI)(url, secenek);
  },
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const dis = kimlikliler(ortam).filter((f) => f.url.startsWith(DIS_KOK));
  assert.ok(dis.length >= 2, 'dış adrese geçildi');
  assert.equal(dis[0].url, `${DIS_KOK}/api/`, 'dış adreste ilk kimlikli istek doğrulama');
  assert.equal(dis.filter((f) => f.url === `${DIS_KOK}/api/`).length, 1, 'dış adreste tek doğrulama');
  assert.ok(dis.some((f) => f.url.startsWith(`${DIS_KOK}/api/states/`)));
});

ortamda('yetki kesici (h): kesici açıkken ev içi adres düşse bile dış adrese anahtar GİTMEZ (adres seçimi anahtarsız sürer)', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: REDDEDILMIS_KAYIT(),
  yoklama: (url) => (url.startsWith(DIS_KOK) ? 200 : null),
  apiYaniti: hepsiniReddet,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(5 * 60_000);
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), []);
  assert.ok(disIstekleri(ortam).length >= 1 && disIstekleri(ortam).every((f) => f.url.endsWith('/manifest.json')), 'yalnız anahtarsız yoklama');
  assert.ok(ortam.pencere.webContents.yuklemeler.some((y) => y.tur === 'url' && y.url.startsWith(DIS_KOK)), 'ana pencere yine dış adrese bağlanabilir');
});

ortamda('yetki kesici (j): kesici açıkken tepsi favorisi, eylem kısayolu, komut satırı, hızlı panel ve palet ağa ÇIKMAZ ve kullanıcıya nedeni söylenir', {
  ...dalga3([{ ...SALON, kisayol: 'Control+Alt+L' }]),
  ekDosyalar: REDDEDILMIS_KAYIT(),
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  const neden = /Yapılamadı: erişim anahtarı reddedildi/;
  const bildirimSayisi = () => ortam.durum.bildirimler.filter((b) => neden.test(b.body)).length;
  assert.equal(bildirimSayisi(), 0);

  const salon = ortam.menuAgaci().find((d) => /^Salon Lambası/.test(d.oge.label ?? '') && d.ust !== 'Panolar').oge;
  await salon.click(); // tepsi favorisi
  await ortam.akit();
  assert.equal(bildirimSayisi(), 1, 'tepsi tıklaması: neden söylenir');

  await ortam.durum.kisayollar.get('Control+Alt+L')(); // eylem kısayolu
  await ortam.akit();
  assert.equal(bildirimSayisi(), 2, 'kısayol: neden söylenir');

  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', '--eylem=salon lambası'], 'C:\\', { eylem: 'salon lambası' }); // komut satırı
  await ortam.akit();
  assert.equal(bildirimSayisi(), 3, 'komut satırı: neden söylenir');

  const panel = await paneliAc(ortam); // hızlı panel
  const panelSonucu = await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: 'light.salon_lambasi' });
  assert.equal(panelSonucu.ok, false);
  assert.equal(panelSonucu.tur, 'ha-hatasi');
  ortam.durum.ipc.get('yuzey:kapat')(yuzeyOlayi(ortam, panel));
  ortam.ilerle(5000);
  await ortam.durum.kisayollar.get('Control+Alt+P')(); // palet
  const paletSonucu = await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: 'light.salon_lambasi' });
  assert.equal(paletSonucu.ok, false);
  await ortam.akit();
  assert.ok(bildirimSayisi() >= 5, 'panel ve palet: neden söylenir');

  assert.deepEqual(kimlikliler(ortam), [], 'hiçbir yüzey ağa kimlikli istek çıkarmadı');
  assert.deepEqual(postlar(ortam), []);
  assert.ok(koseMesajlari(ortam).some((m) => m.tur === 'hata' && neden.test(m.metin)), 'köşe bildirimi de nedeni söyler');
  sirsiz(ortam);
});

ortamda('tanılama (o-41): reddedilmiş anahtar raporda "rejected" ve hatalı deneme sayısı olarak görünür; anahtar parmak izi ve anahtar rapora girmez', { ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nKey status: rejected by Home Assistant\nFailed sign-in attempts counted: [1-9]\d*\n/);
  assert.match(metin, /Yetki kesici: anahtar reddedildi \(neden=HTTP_401, parmak izi=\[masked\],/, 'günlük satırındaki parmak izi maskelenir');
  assert.equal(metin.includes(TEST_ANAHTAR), false);
  assert.equal(metin.includes(anahtarParmakIzi(TEST_ANAHTAR).slice(0, 8)), false);
  assert.match(metin, /\nLive updates \(WebSocket\): not connected\n/);
});

// --- odadan ilk kurulum önerisi (o-44) ------------------------------------------------------

const ODA_DURUMLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off'),
  durumNesnesi('switch.salon_priz', 'Salon Priz', 'on'),
  durumNesnesi('scene.film', 'Film', 'scening'),
  durumNesnesi('light.giris_kapisi_lambasi', 'Giriş Kapısı Lambası', 'off'), // Kapı Kuralı
  durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'), // Kapı Kuralı (alan)
  durumNesnesi('sensor.salon_sicaklik', 'Salon Sıcaklık', '21'), // yalnız okunur: önerilmez
  durumNesnesi('button.salon_zil', 'Salon Zil', 'unknown'), // varsayılan onaylı: önerilmez
  durumNesnesi('light.mutfak_lambasi', 'Mutfak Lambası', 'on'),
  durumNesnesi('light.garaj_lambasi', 'Garaj Lambası', 'off'), // oda adı süzgeçte düşer
  durumNesnesi('light.odasiz', 'Odasız Lamba', 'off'),
];
const ODA_WS_YANITLARI = {
  'config/area_registry/list': { success: true, result: [{ area_id: 'salon', name: 'Salon' }, { area_id: 'mutfak', name: 'Mutfak' }, { area_id: 'garaj', name: 'Garaj' }] },
  'config/entity_registry/list_for_display': {
    success: true,
    result: {
      entities: [
        { ei: 'light.salon_lambasi', ai: 'salon' },
        { ei: 'switch.salon_priz', ai: 'salon' },
        { ei: 'scene.film', ai: 'salon' },
        { ei: 'light.giris_kapisi_lambasi', ai: 'salon' },
        { ei: 'lock.on_kapi', ai: 'salon' },
        { ei: 'sensor.salon_sicaklik', ai: 'salon' },
        { ei: 'button.salon_zil', ai: 'salon' },
        { ei: 'light.mutfak_lambasi', ai: 'mutfak' },
        { ei: 'light.garaj_lambasi', ai: 'garaj' },
      ],
    },
  },
  'config/device_registry/list': { success: true, result: [] },
};

/** Canlı bağlantıda ana sürecin gönderdiği okuma komutlarını yanıtlar (komutlar art arda gider: her turda bekleyenler yanıtlanır). */
async function odaKomutlariniYanitla(ortam, soket, yanitlar = ODA_WS_YANITLARI) {
  const yanitlanan = new Set();
  for (let tur = 0; tur < 8; tur += 1) {
    await ortam.akit();
    for (const m of soket.gonderilen) {
      if (!yanitlar[m.type] || yanitlanan.has(m.id)) continue;
      yanitlanan.add(m.id);
      soket.yayinla({ id: m.id, type: 'result', ...yanitlar[m.type] });
    }
  }
  return yanitlanan.size;
}
const odaIsteyin = (ortam) => ortam.durum.ipc.get('odalar:getir')(ayarlarOlayi(ortam));

ortamda('odadan kurulum (o-44): canlı bağlantıda odalar ve güvenli öneriler döner; kapı kuralı, okunur alan, onaylı eylem ve oda adı süzgeci uygulanır; HİÇBİR ŞEY yazılmaz ve servis çağrılmaz', { ...dalga3([], {}, { ha: ODA_DURUMLARI }) }, async (ortam) => {
  const { s } = await canliYap(ortam, ODA_DURUMLARI);
  const ayarOnce = JSON.stringify(ortam.ayarOku());
  const sozu = odaIsteyin(ortam);
  const yanitlanan = await odaKomutlariniYanitla(ortam, s);
  const yanit = await sozu;
  assert.equal(yanitlanan, 3, 'oda kaydı, varlık kaydı ve cihaz kaydı okundu');
  assert.deepEqual(
    s.gonderilen.filter((m) => m.type?.startsWith('config/')).map((m) => m.type),
    ['config/area_registry/list', 'config/entity_registry/list_for_display', 'config/device_registry/list'],
    'yalnız okuma komutları',
  );
  assert.equal(yanit.ok, true);
  assert.deepEqual(
    yanit.odalar.map((o) => [o.id, o.ad, o.toplam, o.cihazlar.map((c) => c.entity_id)]),
    [
      ['mutfak', 'Mutfak', 1, ['light.mutfak_lambasi']],
      ['salon', 'Salon', 3, ['light.salon_lambasi', 'switch.salon_priz', 'scene.film']],
    ],
    'Garaj odası, kapı/kilit, sensör, onaylı düğme ve odasız lamba önerilmez',
  );
  assert.deepEqual(yanit.odalar.find((o) => o.id === 'salon').cihazlar[0], { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light' });
  assert.equal(yanit.alanSayisi, 2, 'adı süzgeçten geçmeyen oda sayılmaz');
  assert.equal(JSON.stringify(yanit).includes(TEST_ANAHTAR), false);
  assert.equal(JSON.stringify(yanit).includes('kapi'), false);
  assert.deepEqual(postlar(ortam), [], 'hiçbir servis çağrılmadı');
  assert.equal(s.gonderilen.some((m) => m.type === 'call_service'), false);
  assert.equal(JSON.stringify(ortam.ayarOku()), ayarOnce, 'ayarlar değişmedi (öneri yalnız sayfada seçime eklenir)');
  assert.deepEqual(ortam.durum.pano, []);
});

ortamda('odadan kurulum (o-44): canlı bağlantı yoksa "canli-yok" döner ve HA\'ya durum/oda isteği gitmez', { ...dalga3([SALON], {}, { ha: HA_VARLIKLARI }) }, async (ortam) => {
  await ortam.akit();
  const tumDurumIstekleri = () => ortam.durum.fetchler.filter((f) => new URL(f.url).pathname === '/api/states').length;
  const once = tumDurumIstekleri();
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).canliDurum === 'canli', false);
  assert.deepEqual(await odaIsteyin(ortam), { ok: false, neden: 'canli-yok' });
  assert.equal(tumDurumIstekleri(), once);
  assert.equal(ortam.durum.soketler.every((k) => !k.gonderilen.some((m) => String(m.type).startsWith('config/'))), true);
});

ortamda('odadan kurulum (o-44): oda kaydı yönetici gerektiriyorsa "yetki" döner (oturum boyunca kapanır, tekrar sorulmaz); oda yoksa boş liste', { ...dalga3([], {}, { ha: ODA_DURUMLARI }) }, async (ortam) => {
  const { s } = await canliYap(ortam, ODA_DURUMLARI);
  const sozu = odaIsteyin(ortam);
  await odaKomutlariniYanitla(ortam, s, { 'config/area_registry/list': { success: false, error: { code: 'unauthorized', message: 'Unauthorized' } } });
  assert.deepEqual(await sozu, { ok: false, neden: 'yetki' });
  const komutSayisi = s.gonderilen.filter((m) => m.type === 'config/area_registry/list').length;
  const ikinci = await odaIsteyin(ortam);
  assert.deepEqual(ikinci, { ok: false, neden: 'yetki' });
  assert.equal(s.gonderilen.filter((m) => m.type === 'config/area_registry/list').length, komutSayisi, 'kapanan uç yeniden sorulmaz');
});

ortamda('odadan kurulum (o-44): HA oda tanımlamamışsa ok:true ve boş liste döner', { ...dalga3([], {}, { ha: ODA_DURUMLARI }) }, async (ortam) => {
  const { s } = await canliYap(ortam, ODA_DURUMLARI);
  const sozu = odaIsteyin(ortam);
  await odaKomutlariniYanitla(ortam, s, {
    'config/area_registry/list': { success: true, result: [] },
    'config/entity_registry/list_for_display': { success: true, result: { entities: [] } },
    'config/device_registry/list': { success: true, result: [] },
  });
  assert.deepEqual(await sozu, { ok: true, odalar: [], alanSayisi: 0 });
});

ortamda('odadan kurulum (o-44): kanal yalnız Ayarlar sayfasına yanıt verir; uzak sayfa ve başka pencere reddedilir (ağa çıkılmaz)', { ...dalga3([], {}, { ha: ODA_DURUMLARI }) }, async (ortam) => {
  const { s } = await canliYap(ortam, ODA_DURUMLARI);
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: `${YEREL_KOK}/lovelace`, parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  for (const kotu of [uzak, baskaPencere]) assert.deepEqual(await ortam.durum.ipc.get('odalar:getir')(kotu), { ok: false, hata: 'İzin yok.' });
  await ortam.akit();
  assert.equal(s.gonderilen.some((m) => String(m.type).startsWith('config/')), false);
});

// --- Tur 1 inceleme düzeltmeleri (ana süreç düzeyinde) ------------------------------------------------------------

const SEKIZ_ISIK_DURUMLARI = SEKIZ_ISIK.map((i) => durumNesnesi(i.entity_id, i.ad));

ortamda('yetki kesici (tur1-B1): doğrulanmış oturumda anahtar iptal edilir ve HA soketi kapatır: REST yedeği (8 favori) + yeniden bağlanma toplam TAM 1 hatalı deneme', dalga3(SEKIZ_ISIK), async (ortam) => {
  haKur(ortam.durum, SEKIZ_ISIK_DURUMLARI);
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const s = ortam.durum.soketler.at(-1);
  assert.ok(s, 'soket açıldı (doğrulama 200)');
  s.yayinla({ type: 'auth_required' });
  await ortam.akit();
  s.yayinla({ type: 'auth_ok' });
  await ortam.akit();
  const authOnce = ortam.durum.soketler.reduce((n, x) => n + x.gonderilen.filter((m) => m.type === 'auth').length, 0);
  assert.equal(authOnce, 1);

  ortam.durum.apiYaniti = hepsiniReddet; // anahtar HA'da silindi; HA soketi kapattı (tazelik penceresi içinde)
  const once = kimlikliler(ortam).length;
  s.kopar();
  await ortam.akit();
  ortam.ilerle(5000);
  await ortam.akit();
  ortam.ilerle(60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length - once, 1, 'HA\'ya giden hatalı kimlikli istek TAM 1 (REST yedeği 4 paralel gitmez, yeniden bağlanma auth atmaz)');
  const authSonra = ortam.durum.soketler.reduce((n, x) => n + x.gonderilen.filter((m) => m.type === 'auth').length, 0);
  assert.equal(authSonra, authOnce, 'ikinci auth gitmedi');
  assert.equal(reddedilmeBildirimleri(ortam).length, 1);
  assert.deepEqual(disIstekleri(ortam), []);
});

ortamda('yetki kesici (tur1-B1): uyanışta (ağ yeniden denetlenir) doğrulama unutulur: iptal edilmiş anahtarla 8 favorilik REST yedeği HA\'ya TAM 1 hatalı deneme gönderir', dalga3(SEKIZ_ISIK, { canliBaglanti: false }), async (ortam) => {
  haKur(ortam.durum, SEKIZ_ISIK_DURUMLARI);
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.ok(kimlikliler(ortam).filter((f) => /^\/api\/states\//.test(new URL(f.url).pathname)).length >= 8, 'normal akış: 8 favori okundu');

  ortam.durum.apiYaniti = hepsiniReddet;
  const once = kimlikliler(ortam).length;
  ortam.ilerle(10_000); // tazelik penceresi (30 sn) içinde uyku/uyanış
  ortam.guc.emit('suspend');
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  ortam.ilerle(60_000); // REST yedeği yoklaması
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length - once, 1, 'tek doğrulama isteği, kalanlar ağa çıkmadı');
  assert.equal(reddedilmeBildirimleri(ortam).length, 1);
});

test('yetki kesici (tur1-B4 + tur2-P2): kayıt hiçbir yere yazılamıyorsa kullanıcıya BİR bildirim + Ayarlar uyarısı; kesici bellekte engeller ve saklı anahtar dosyası kenara alınır (yeniden başlatmada 0 istek)', async () => {
  const ortam = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet, hazirBekle: true });
  let anahtarDosyasi;
  try {
    const userData = ortam.durum.yollar.get('userData');
    // yazılamayan hedef: geçici dosya yerine aynı adlı KLASÖR (writeFileSync EISDIR verir). Disk, "yolda" işareti yazıldıktan SONRA,
    // HA'nın 401'i dönerken bozulur (işaret yazılabilir; reddedilme kaydı yazılamaz).
    ortam.durum.apiYaniti = () => {
      fs.mkdirSync(path.join(userData, 'yetki-kesici.json.tmp'), { recursive: true });
      fs.mkdirSync(path.join(userData, 'yetki-kesici.yedek.json.tmp'), { recursive: true });
      fs.mkdirSync(path.join(ortam.yerelKlasor(), 'yetki-kesici.yedek.json.tmp'), { recursive: true }); // farklı klasördeki yedek de yazılamıyor
      return hepsiniReddet();
    };
    ortam.durum.hazirCoz();
    await ortam.akit();
    ortam.ilerle(400);
    await ortam.akit();
    ortam.ilerle(10 * 60_000);
    await ortam.akit();
    assert.equal(kimlikliler(ortam).length, 1);
    const sorunBildirimleri = ortam.durum.bildirimler.filter((b) => b.body === YETKI_KAYDI_YAZILAMADI_BILDIRIMI);
    assert.equal(sorunBildirimleri.length, 1, 'yazılamadığı BİR kez bildirilir');
    assert.equal(reddedilmeBildirimleri(ortam).length, 1);
    const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
    assert.equal(ozet.yetkiKaydiSorunu, 'yazilamadi');
    // kayıt kalıcı olamadı: yeniden başlatmada aynı geçersiz anahtarla yine 1 deneme gitmesin diye saklı anahtar dosyası kenara alındı
    assert.equal(ortam.durum.bildirimler.filter((b) => b.body === ANAHTAR_KARANTINA_BILDIRIMI).length, 1);
    assert.equal(ozet.anahtarVar, false);
    assert.equal(ozet.anahtarKarantinada, true);
    assert.equal(fs.existsSync(path.join(userData, 'anahtar.dat')), false);
    anahtarDosyasi = fs.readFileSync(path.join(userData, 'anahtar.dat.reddedildi'), 'utf8');
    assert.match(ortam.gunlukOku(), /hiçbir yere yazılamadı/);
    assert.ok(!ortam.gunlukOku().includes(TEST_ANAHTAR));
    assert.ok(!JSON.stringify(ortam.durum.bildirimler.map((n) => n.body)).includes(TEST_ANAHTAR));
  } finally {
    await ortam.temizle();
  }
  // uygulama yeniden açıldı (hiçbir kayıt yok, yalnız kenara alınmış anahtar dosyası): HA'ya 0 istek
  const yeniden = await ortamKur({ ...dalga3(SEKIZ_ISIK), anahtar: false, apiYaniti: hepsiniReddet, ekDosyalar: { 'anahtar.dat.reddedildi': anahtarDosyasi } });
  try {
    await yeniden.akit();
    yeniden.ilerle(10 * 60_000);
    await yeniden.akit();
    assert.deepEqual(kimlikliler(yeniden), []);
    assert.equal(yeniden.durum.soketler.length, 0);
    assert.equal((await yeniden.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(yeniden))).anahtarKarantinada, true, 'Ayarlar nedenini söyler');
  } finally {
    await yeniden.temizle();
  }
});

test('yetki kesici (tur6-P1): "yolda" işareti yazılamıyorsa (disk dolu/izin) HA’ya HİÇ istek gitmez; bildirim + "kayit-onayi" durumu', async () => {
  const ortam = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet, hazirBekle: true });
  try {
    const userData = ortam.durum.yollar.get('userData');
    fs.mkdirSync(path.join(userData, 'yetki-kesici.json.tmp'), { recursive: true });
    fs.mkdirSync(path.join(userData, 'yetki-kesici.yedek.json.tmp'), { recursive: true });
    fs.mkdirSync(path.join(ortam.yerelKlasor(), 'yetki-kesici.yedek.json.tmp'), { recursive: true });
    ortam.durum.hazirCoz();
    await ortam.akit();
    ortam.ilerle(400);
    await ortam.akit();
    ortam.ilerle(10 * 60_000);
    await ortam.akit();
    assert.deepEqual(kimlikliler(ortam), [], 'işaret yazılamadan kimlikli istek ağa çıkmaz');
    assert.deepEqual(disIstekleri(ortam), []);
    assert.equal(ortam.durum.soketler.length, 0);
    assert.equal(ortam.durum.bildirimler.filter((b) => b.body === YETKI_KAYDI_YAZILAMADI_BILDIRIMI).length, 1);
    const ozet = await ayarOzeti(ortam);
    assert.equal(ozet.yetkiDurumu, 'kayit-onayi');
    assert.equal(ozet.yetkiKaydiSorunu, 'yazilamadi');
    assert.ok(!ortam.gunlukOku().includes(TEST_ANAHTAR));
  } finally {
    await ortam.temizle();
  }
});

test('yetki kesici (tur1-B4): ana kayıt dosyası okunamıyorsa (kilitli) yedekten yüklenir, 0 kimlikli istek, kullanıcıya bildirilir ve ana dosyanın üzerine yazılmaz', async () => {
  const ortam = await ortamKur({
    ...dalga3(SEKIZ_ISIK),
    apiYaniti: hepsiniReddet,
    hazirBekle: true,
    ekDosyalar: { 'yetki-kesici.yedek.json': REDDEDILMIS_KAYIT()['yetki-kesici.json'] },
  });
  try {
    const userData = ortam.durum.yollar.get('userData');
    fs.mkdirSync(path.join(userData, 'yetki-kesici.json')); // okunamayan "dosya" (okuma EISDIR verir)
    ortam.durum.hazirCoz();
    await ortam.akit();
    ortam.ilerle(10 * 60_000);
    await ortam.akit();
    assert.deepEqual(kimlikliler(ortam), [], 'yedekteki parmak izi yüklendi: aynı anahtarla HİÇ kimlikli istek');
    assert.equal(ortam.durum.bildirimler.filter((b) => b.body === YETKI_KAYDI_OKUNAMADI_BILDIRIMI).length, 1);
    const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
    assert.equal(ozet.yetkiKaydiSorunu, 'okunamadi');
    assert.equal(ozet.anahtarReddedildi, true);
    assert.equal(fs.statSync(path.join(userData, 'yetki-kesici.json')).isDirectory(), true, 'okunamayan ana dosyaya dokunulmadı');
  } finally {
    await ortam.temizle();
  }
});

test('yetki kesici (tur2-P2): kullanıcı klasörü yazılamıyorsa %LOCALAPPDATA% yedeği kaydı taşır: yeniden başlatmada aynı anahtarla 0 istek', async () => {
  const ilk = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet, hazirBekle: true });
  let yerelKayit;
  try {
    const userData = ilk.durum.yollar.get('userData');
    fs.mkdirSync(path.join(userData, 'yetki-kesici.json.tmp'), { recursive: true });
    fs.mkdirSync(path.join(userData, 'yetki-kesici.yedek.json.tmp'), { recursive: true });
    ilk.durum.hazirCoz();
    await ilk.akit();
    ilk.ilerle(400);
    await ilk.akit();
    assert.equal(kimlikliler(ilk).length, 1);
    yerelKayit = fs.readFileSync(path.join(ilk.yerelKlasor(), 'yetki-kesici.yedek.json'), 'utf8');
    assert.ok(yerelKayit.includes(anahtarParmakIzi(TEST_ANAHTAR)));
    assert.ok(!yerelKayit.includes(TEST_ANAHTAR));
    assert.equal(ilk.durum.bildirimler.filter((b) => b.body === YETKI_KAYDI_YAZILAMADI_BILDIRIMI).length, 0, 'bir yere yazılabildi: sorun yok');
    assert.equal(fs.existsSync(path.join(userData, 'anahtar.dat')), true, 'kayıt kalıcı: anahtar dosyasına dokunulmaz');
  } finally {
    await ilk.temizle();
  }
  const yeniden = await ortamKur({ ...dalga3(SEKIZ_ISIK), apiYaniti: hepsiniReddet, yerelDosyalar: { 'yetki-kesici.yedek.json': yerelKayit } });
  try {
    await yeniden.akit();
    yeniden.ilerle(10 * 60_000);
    await yeniden.akit();
    assert.deepEqual(kimlikliler(yeniden), [], "yedekten yüklendi: HA'ya 0 istek");
    assert.equal(yeniden.durum.soketler.length, 0);
  } finally {
    await yeniden.temizle();
  }
});

// --- Tur 2: doğrulanamadı (belirsiz sınırı) ve ev içi 403 ---------------------------------------------------------------

const hicYanitVermez = () => new Promise(() => {});
const durumBildirimi = (ortam, metin) => ortam.durum.bildirimler.filter((b) => b.body === metin);
const ayarOzeti = (ortam) => ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
const regexKacis = (metin) => metin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

ortamda('yetki kesici (tur3-K2): HA yanıt vermiyorsa (HA saydığı halde) doğrulanmamış anahtarla TAM 1 deneme gider; sonra bildirim + görünür durum, 10 dk sonra da istek yok; "Yeniden Dene" TEK hak verir', { ...dalga3([SALON]), apiYaniti: hicYanitVermez }, async (ortam) => {
  await ortam.akit();
  for (let i = 0; i < 12; i += 1) {
    ortam.ilerle(30_000);
    await ortam.akit();
  }
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, "HA'ya toplam 1 (yanıtsız) deneme");
  assert.equal(ortam.durum.soketler.length, 0);
  assert.deepEqual(disIstekleri(ortam), []);
  assert.equal(durumBildirimi(ortam, ANAHTAR_DOGRULANAMADI_BILDIRIMI).length, 1);
  assert.match(ortam.tepsi.ipuclari.at(-1), new RegExp(regexKacis(ANAHTAR_DOGRULANAMADI_KISA_METNI)));
  assert.ok(ortam.menuOgesi(ANAHTAR_DOGRULANAMADI_MENU_METNI));
  const panel = await paneliAc(ortam);
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam, panel))).model.ust.uyari, ANAHTAR_DOGRULANAMADI_KISA_METNI);
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, 'dogrulanamadi');
  assert.equal(ozet.anahtarReddedildi, false);
  assert.match(ortam.gunlukOku(), /doğrulanamadı/);
  sirsiz(ortam);

  // Ayarlar'dan "Yeniden dene": TEK yeni hak; HA bu kez 401 verir -> reddedildi
  ortam.durum.apiYaniti = hepsiniReddet;
  const sonuc = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true);
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 2, 'yalnız bir yeni deneme');
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 2);
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, 'reddedildi');
});

test('yetki kesici (tur3-K2): "doğrulanamadı" durumu kalıcıdır; uygulama yeniden başlayınca 0 istek', async () => {
  const ilk = await ortamKur({ ...dalga3([SALON]), apiYaniti: hicYanitVermez });
  let kayit;
  try {
    await ilk.akit();
    for (let i = 0; i < 12; i += 1) {
      ilk.ilerle(30_000);
      await ilk.akit();
    }
    assert.equal(kimlikliler(ilk).length, 1);
    kayit = fs.readFileSync(path.join(ilk.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8');
    assert.ok(!kayit.includes(TEST_ANAHTAR));
  } finally {
    await ilk.temizle();
  }
  const yeniden = await ortamKur({ ...dalga3([SALON]), apiYaniti: hicYanitVermez, ekDosyalar: { 'yetki-kesici.json': kayit } });
  try {
    await yeniden.akit();
    yeniden.ilerle(10 * 60_000);
    await yeniden.akit();
    assert.deepEqual(kimlikliler(yeniden), []);
    assert.equal(yeniden.durum.soketler.length, 0);
    assert.match(yeniden.tepsi.ipuclari.at(-1), new RegExp(regexKacis(ANAHTAR_DOGRULANAMADI_KISA_METNI)));
  } finally {
    await yeniden.temizle();
  }
});

const kesiciKaydi = (ortam) => {
  const yol = path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json');
  return fs.existsSync(yol) ? fs.readFileSync(yol, 'utf8') : null;
};

test('yetki kesici (tur6-P1): doğrulama yoldayken uygulama kapanır/ölür (yanıt yok): yeniden açılışta AYNI anahtarla 0 kimlikli istek, "dogrulanamadi" + bildirim; before-quit olsun olmasın', async () => {
  for (const kapanis of ['before-quit', 'oldu']) {
    const ilk = await ortamKur({ ...dalga3([SALON]), apiYaniti: hicYanitVermez });
    let kayit;
    try {
      await ilk.akit();
      ilk.ilerle(3000); // 15 sn'lik zaman aşımı dolmadan
      await ilk.akit();
      assert.equal(kimlikliler(ilk).length, 1, `${kapanis}: ilk açılışta 1 doğrulama`);
      if (kapanis === 'before-quit') {
        ilk.app.emit('before-quit');
        await ilk.akit();
      }
      kayit = kesiciKaydi(ilk); // süreç öldüğünde diskte kalan
      assert.ok(kayit, `${kapanis}: kesici kaydı yazılmış olmalı`);
      assert.ok(!kayit.includes(TEST_ANAHTAR));
    } finally {
      await ilk.temizle();
    }
    const yeniden = await ortamKur({ ...dalga3([SALON]), apiYaniti: hepsiniReddet, ekDosyalar: { 'yetki-kesici.json': kayit } });
    try {
      await yeniden.akit();
      yeniden.ilerle(10 * 60_000);
      await yeniden.akit();
      assert.deepEqual(kimlikliler(yeniden), [], `${kapanis}: aynı anahtarla 0 kimlikli istek`);
      assert.deepEqual(disIstekleri(yeniden), []);
      assert.equal(yeniden.durum.soketler.length, 0);
      assert.equal((await ayarOzeti(yeniden)).yetkiDurumu, 'dogrulanamadi');
      assert.equal(durumBildirimi(yeniden, ANAHTAR_DOGRULANAMADI_BILDIRIMI).length, 1, `${kapanis}: kullanıcı uyarıldı`);
      assert.match(yeniden.tepsi.ipuclari.at(-1), new RegExp(regexKacis(ANAHTAR_DOGRULANAMADI_KISA_METNI)));
      sirsiz(yeniden);
    } finally {
      await yeniden.temizle();
    }
  }
});

test('yetki kesici (tur6-P1b): 5 kez aç/3 sn bekle/öldür (HA yanıt vermiyor): aynı anahtarla toplam 1 kimlikli istek, ilk turdan sonra durum "dogrulanamadi"', async () => {
  let kayit = null;
  let toplam = 0;
  for (let tur = 0; tur < 5; tur += 1) {
    const ortam = await ortamKur({ ...dalga3([SALON]), apiYaniti: hicYanitVermez, ...(kayit ? { ekDosyalar: { 'yetki-kesici.json': kayit } } : {}) });
    try {
      await ortam.akit();
      ortam.ilerle(3000);
      await ortam.akit();
      toplam += kimlikliler(ortam).length;
      assert.equal((await ayarOzeti(ortam)).yetkiDurumu, tur === 0 ? null : 'dogrulanamadi', `tur ${tur}`);
      kayit = kesiciKaydi(ortam) ?? kayit;
    } finally {
      await ortam.temizle();
    }
  }
  assert.equal(toplam, 1, 'beş açılışta HA\'ya toplam 1 (yanıtsız) deneme');
});

ortamda("yetki kesici (tur2-P6): ev içi YOKLAMA 403 (HA ban'ı) + geçersiz anahtar: dış adrese kimlikli istek 0, bildirim + görünür durum; \"Yeniden dene\" ile TEK doğrulama gider", {
  ...dalga3([SALON], {}, { yoklama: (url) => (url.startsWith(DIS_KOK) ? 200 : 403) }),
  apiYaniti: hepsiniReddet,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), [], 'ne ev içi ne dış adrese anahtar gitti');
  assert.ok(disIstekleri(ortam).every((f) => f.url.endsWith('/manifest.json')), 'dış adrese yalnız anahtarsız yoklama');
  assert.equal(ortam.durum.soketler.length, 0);
  assert.equal(durumBildirimi(ortam, YEREL_YASAK_BILDIRIMI).length, 1);
  assert.match(ortam.tepsi.ipuclari.at(-1), new RegExp(regexKacis(YEREL_YASAK_KISA_METNI)));
  assert.ok(ortam.menuOgesi(YEREL_YASAK_MENU_METNI));
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, 'yerel-yasak');
  assert.equal(ozet.anahtarReddedildi, false, 'anahtar reddedilmiş sayılmaz');
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json')), false, 'kalıcı kayıt yok');
  sirsiz(ortam);

  const sonuc = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true);
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const dis = kimlikliler(ortam).filter((f) => f.url.startsWith(DIS_KOK));
  assert.deepEqual(dis.map((f) => f.url), [`${DIS_KOK}/api/`], 'kullanıcı onayından sonra dış adrese TEK doğrulama');
});

// ===========================================================================
// Tur 3 (ana süreç düzeyi): hata bütçesi + açık ikinci onay, güvenilmez kesici kaydı, seçici "Anahtarı sil"
// ===========================================================================

const kaydetIpc = (ortam, anahtar, secenek) => ortam.durum.ipc.get('anahtar:kaydet')(ayarlarOlayi(ortam), anahtar, secenek);

ortamda('yetki kesici (tur3-K4): hata bütçesi >= 2 iken YENİ anahtar açık ikinci onay olmadan doğrulanmaz (HA\'ya 0 istek); onayla tek doğrulama gider', {
  ...dalga3([SALON], { canliBaglanti: false }),
  apiYaniti: hepsiniReddet,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, 'açılışta saklı anahtar için tek doğrulama (401)');
  assert.equal((await ayarOzeti(ortam)).yetkiHataliDeneme, 1);
  const k1 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_BIR_ABCDEFGHIJKLMNOPQ');
  assert.deepEqual(k1, { ok: false, hata: ANAHTAR_KAYDI_REDDEDILDI_METNI }, 'sayaç 1 iken onay gerekmez');
  assert.equal((await ayarOzeti(ortam)).yetkiHataliDeneme, 2);

  const once = kimlikliler(ortam).length;
  const k2 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_IKI_ABCDEFGHIJKLMNOPQ');
  assert.equal(k2.ok, false);
  assert.equal(k2.onayGerekli, true);
  assert.match(k2.hata, /son başarılı bağlantıdan beri 2 hatalı ya da yanıtsız deneme yapıldı/);
  assert.match(k2.hata, /5 hatalı denemede bu bilgisayarı \(dış adresten denendiyse evin internet adresini de\) engeller/);
  assert.equal(kimlikliler(ortam).length, once, 'onaysız: HA\'ya HİÇ istek gitmedi');
  assert.equal(typeof k2.bilet, 'string', 'onayGerekli yanıtı tek kullanımlık bir onay bileti taşır');
  const k2b = await kaydetIpc(ortam, 'ADAY_ANAHTAR_IKI_ABCDEFGHIJKLMNOPQ', { bilet: 'uydurma-bilet' });
  assert.equal(k2b.onayGerekli, true, 'uydurma bilet geçmez');
  assert.equal(kimlikliler(ortam).length, once);
  const eskiTip = await kaydetIpc(ortam, 'ADAY_ANAHTAR_IKI_ABCDEFGHIJKLMNOPQ', { onay: true });
  assert.equal(eskiTip.onayGerekli, true, 'boolean onay (eski biçim) artık geçmez');
  assert.equal(kimlikliler(ortam).length, once);

  const k3 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_IKI_ABCDEFGHIJKLMNOPQ', { bilet: eskiTip.bilet });
  assert.deepEqual(k3, { ok: false, hata: ANAHTAR_KAYDI_REDDEDILDI_METNI }, 'onayla doğrulama gider (HA yine 401 verir)');
  assert.equal(kimlikliler(ortam).length, once + 1, 'tam 1 doğrulama');
  assert.equal((await ayarOzeti(ortam)).yetkiHataliDeneme, 3);

  // tur 5 (K7): tek onay YALNIZ o adaya ve o sayaca yeter; ikinci aday yeniden onay ister, kullanılmış bilet geçmez
  const sonra = kimlikliler(ortam).length;
  const k4 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_UC_ABCDEFGHIJKLMNOPQRS', { bilet: eskiTip.bilet });
  assert.equal(k4.onayGerekli, true, 'kullanılmış bilet başka adaya geçmez');
  assert.match(k4.hata, /son başarılı bağlantıdan beri 3 hatalı ya da yanıtsız deneme yapıldı/, 'uyarıdaki N güncel');
  assert.equal(kimlikliler(ortam).length, sonra, 'ağa çıkmadı');
  const k4b = await kaydetIpc(ortam, 'ADAY_ANAHTAR_UC_ABCDEFGHIJKLMNOPQRS', { bilet: k2.bilet });
  assert.equal(k4b.onayGerekli, true, 'ilk adayın (kullanılmış) bileti de geçmez');
  const k5 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_UC_ABCDEFGHIJKLMNOPQRS', { bilet: k4b.bilet });
  assert.deepEqual(k5, { ok: false, hata: ANAHTAR_KAYDI_REDDEDILDI_METNI });
  assert.equal(kimlikliler(ortam).length, sonra + 1);
  assert.equal((await ayarOzeti(ortam)).yetkiHataliDeneme, 4);
  const k6 = await kaydetIpc(ortam, 'ADAY_ANAHTAR_DORT_ABCDEFGHIJKLMNOPQR', { bilet: k4b.bilet });
  assert.equal(k6.onayGerekli, true, 'kullanılmış/eski sayaçlı bilet geçmez');
  sirsiz(ortam);
});

ortamda('yetki kesici (tur3-K4): "Yeniden Dene" da hata bütçesi >= 2 iken (doğrulanmamış saklı anahtar) açık ikinci onay ister', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: { 'yetki-kesici.json': JSON.stringify({ surum: 1, hataliDeneme: 2, belirsiz: [{ parmakIzi: anahtarParmakIzi(TEST_ANAHTAR), sayi: 1 }] }) },
  apiYaniti: hicYanitVermez,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), [], 'doğrulanamadı: 0 istek');
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, 'dogrulanamadi');
  const onaysiz = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam));
  assert.equal(onaysiz.ok, false);
  assert.equal(onaysiz.onayGerekli, true);
  assert.match(onaysiz.hata, /2 hatalı ya da yanıtsız deneme yapıldı/);
  assert.deepEqual(kimlikliler(ortam), [], 'onaysız Yeniden Dene de ağa çıkmadı');
  assert.equal(typeof onaysiz.bilet, 'string');
  const eskiTip = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam), { onay: true });
  assert.equal(eskiTip.onayGerekli, true, 'boolean onay geçmez');
  const onayli = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam), { bilet: eskiTip.bilet });
  assert.equal(onayli.ok, true);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, 'onayla TAM 1 doğrulama');
});

ortamda('yetki kesici (tur3-K5): bozuk kesici dosyası: açılışta 0 kimlikli istek, görünür durum; "Yeniden Dene" (tek başına onay) ile TAM 1 doğrulama', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: { 'yetki-kesici.json': '{bozuk json' },
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), [], 'kayıt güvenilmez: HA\'ya 0 istek (doğrulanmış olsa bile)');
  assert.equal(ortam.durum.soketler.length, 0);
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, 'kayit-onayi');
  assert.match(ortam.tepsi.ipuclari.at(-1), new RegExp(regexKacis(ANAHTAR_KAYIT_ONAYI_KISA_METNI)));
  assert.ok(ortam.menuOgesi(ANAHTAR_KAYIT_ONAYI_MENU_METNI));
  // yeni anahtar kaydı da (güvenilmez kayıt) açık ikinci onay ister; onaysız HA'ya hiç istek gitmez
  const yeniKayit = await kaydetIpc(ortam, 'ADAY_ANAHTAR_UC_ABCDEFGHIJKLMNOPQRS');
  assert.equal(yeniKayit.onayGerekli, true);
  assert.match(yeniKayit.hata, /yetki-kesici\.json/);
  assert.deepEqual(kimlikliler(ortam), []);
  const sonuc = await ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true, 'hata bütçesi boş: tek onay yeter');
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).filter((f) => new URL(f.url).pathname === '/api/').length, 1, 'tam 1 doğrulama');
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, null);
  sirsiz(ortam);
});

ortamda('yetki kesici (tur3-K5): "Anahtarı sil" YALNIZ saklı anahtarın kaydını temizler; başka reddedilmiş anahtarlar ve hata bütçesi kalır', {
  ...dalga3([SALON]),
  ekDosyalar: {
    'yetki-kesici.json': JSON.stringify({
      surum: 1,
      hataliDeneme: 2,
      reddedilenler: [
        { parmakIzi: anahtarParmakIzi(TEST_ANAHTAR), zaman: 1, neden: 'HTTP_401' },
        { parmakIzi: anahtarParmakIzi('BASKA_REDDEDILMIS_ANAHTAR_000000'), zaman: 2, neden: 'HTTP_401' },
      ],
    }),
  },
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  const sil = await ortam.durum.ipc.get('anahtar:sil')(ayarlarOlayi(ortam));
  assert.equal(sil.ok, true);
  const kayit = JSON.parse(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'yetki-kesici.json'), 'utf8'));
  assert.deepEqual(kayit.reddedilenler.map((k) => k.parmakIzi), [anahtarParmakIzi('BASKA_REDDEDILMIS_ANAHTAR_000000')]);
  assert.deepEqual(kayit.hataliKoken, { yerel: 2, dis: 2 }, 'hata bütçesi korundu (eski tek sayaç iki kökene taşındı)');
  // aynı (artık temizlenmiş) anahtar yeniden kaydedilmek istenirse hata bütçesi >= 2: açık ikinci onay ister
  const sonuc = await kaydetIpc(ortam, TEST_ANAHTAR);
  assert.equal(sonuc.onayGerekli, true);
});

// --- Tur 4 inceleme düzeltmeleri ---

ortamda('yetki kesici (tur4-K5): bozuk kayıt + onaylı aday 401: saklı anahtar 60 sn yedeğiyle de ağa ÇIKMAZ; kayıt onayı korunur', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: { 'yetki-kesici.json': '{bozuk json' },
  apiYaniti: (url, secenek) => (secenek.headers?.Authorization === `Bearer ${TEST_ANAHTAR}` ? haYanitiOlustur(HA_VARLIKLARI)(url, secenek) : hepsiniReddet()),
}, async (ortam) => {
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), []);
  const bilet = (await kaydetIpc(ortam, 'YANLIS_KOPYALANAN_ANAHTAR_0000')).bilet;
  assert.equal(typeof bilet, 'string');
  const sonuc = await kaydetIpc(ortam, 'YANLIS_KOPYALANAN_ANAHTAR_0000', { bilet });
  assert.deepEqual(sonuc, { ok: false, hata: ANAHTAR_KAYDI_REDDEDILDI_METNI });
  assert.equal(kimlikliler(ortam).length, 1, 'yalnız aday gitti');
  ortam.ilerle(10 * 60_000); // 60 sn yedek yenilemeleri
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 1, 'saklı anahtar Yeniden Dene olmadan HİÇ doğrulanmadı');
  assert.equal(kimlikliler(ortam).filter((f) => f.basliklar.Authorization === `Bearer ${TEST_ANAHTAR}`).length, 0);
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, 'kayit-onayi');
  sirsiz(ortam);
});

ortamda('yetki kesici (tur4-K5): bozuk kayıt + onaylı aday BAŞARILI ve kaydedildi: kayıt onayı kalkar; akış yeni (saklı) anahtarla sürer, eski anahtara istek gitmez', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: { 'yetki-kesici.json': '{bozuk json' },
  apiYaniti: (url, secenek) => (secenek.headers?.Authorization === 'Bearer YENI_GECERLI_ANAHTAR_000000' ? haYanitiOlustur(HA_VARLIKLARI)(url, secenek) : hepsiniReddet()),
}, async (ortam) => {
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), []);
  const bilet = (await kaydetIpc(ortam, 'YENI_GECERLI_ANAHTAR_000000')).bilet;
  const sonuc = await kaydetIpc(ortam, 'YENI_GECERLI_ANAHTAR_000000', { bilet });
  assert.deepEqual(sonuc, { ok: true, uyari: '' });
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, null, 'güvenilmez-kayıt onayı kalktı');
  assert.ok(kimlikliler(ortam).length >= 2);
  assert.ok(kimlikliler(ortam).every((f) => f.basliklar.Authorization === 'Bearer YENI_GECERLI_ANAHTAR_000000'), 'yalnız yeni anahtar kullanıldı');
  assert.equal(kimlikliler(ortam).filter((f) => new URL(f.url).pathname === '/api/').length, 1, 'tek doğrulama');
});

// --- Tur 5 inceleme düzeltmeleri (K7-K10) ---

const yenidenDeneIpc = (ortam, secenek) => ortam.durum.ipc.get('yetki:yeniden-dene')(ayarlarOlayi(ortam), secenek);

ortamda('yetki kesici (tur5-K8): bozuk kayıt + hata bütçesi 3: "Yeniden Dene" kayıt nedeni olsa da bütçe uyarısını gösterip bilet ister; bilet tek kullanımlık', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: { 'yetki-kesici.json': '{bozuk', 'yetki-kesici.yedek.json': JSON.stringify({ surum: 1, hataliKoken: { yerel: 3, dis: 0 } }) },
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.deepEqual(kimlikliler(ortam), [], 'kayıt güvenilmez: 0 istek');
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, 'kayit-onayi');
  assert.equal(ozet.yetkiHataliDeneme, 3);
  const onaysiz = await yenidenDeneIpc(ortam);
  assert.equal(onaysiz.ok, false);
  assert.equal(onaysiz.onayGerekli, true, 'bütçe >= 2: kayıt nedeni bütçe uyarısını gizlemedi');
  assert.match(onaysiz.hata, /son başarılı bağlantıdan beri 3 hatalı ya da yanıtsız deneme yapıldı/);
  assert.match(onaysiz.hata, /yetki-kesici\.json/, 'kayıt nedeni de söylenir');
  assert.equal(typeof onaysiz.bilet, 'string');
  assert.deepEqual(kimlikliler(ortam), []);
  const aday = await kaydetIpc(ortam, 'ADAY_ANAHTAR_UC_ABCDEFGHIJKLMNOPQRS');
  assert.equal(aday.onayGerekli, true);
  assert.match(aday.hata, /3 hatalı ya da yanıtsız deneme yapıldı/);
  assert.deepEqual(kimlikliler(ortam), []);
  const onayli = await yenidenDeneIpc(ortam, { bilet: onaysiz.bilet });
  assert.equal(onayli.ok, true);
  const tekrar = await yenidenDeneIpc(ortam, { bilet: onaysiz.bilet });
  assert.equal(tekrar.onayGerekli, true, 'kullanılmış bilet ikinci kez geçmez');
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).filter((f) => new URL(f.url).pathname === '/api/').length, 1, 'onayla TAM 1 doğrulama');
});

// --- Tur 8 (K12, K13): saklı anahtar muafiyetine sınır, Yeniden Dene onayı ---

/** Kalıcı kayıt: doğrulanmış saklı anahtar + köken sayaçları (anahtar HA'da silinmiş, HA yavaş senaryoları için). */
const iyiKayit = (belirsiz, hataliKoken) => ({
  'yetki-kesici.json': JSON.stringify({
    surum: 1,
    dogrulananlar: [anahtarParmakIzi(TEST_ANAHTAR)],
    belirsiz: belirsiz ? [{ parmakIzi: anahtarParmakIzi(TEST_ANAHTAR), sayi: belirsiz }] : [],
    hataliKoken,
  }),
});
const yavasHaIlerle = async (ortam) => {
  for (let i = 0; i < 8; i += 1) {
    ortam.ilerle(40_000);
    await ortam.akit();
  }
};

ortamda("yetki kesici (tur8-K12a): doğrulanmış saklı anahtar HA'da silinmiş + HA yavaş + art arda Yeniden Dene: bütçe >= 2 olduktan sonra HER Yeniden Dene bilet ister; onaysız HA sayacı 4'ü geçmez", {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: iyiKayit(1, { yerel: 1, dis: 0 }),
  apiYaniti: hicYanitVermez,
}, async (ortam) => {
  await ortam.akit();
  await yavasHaIlerle(ortam);
  assert.equal(kimlikliler(ortam).length, 1, 'açılışta tek (yanıtsız) deneme; doğrulanmış anahtarda 2. belirsizlik');
  let ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, 'dogrulanamadi');
  assert.equal(ozet.yetkiHataliDeneme, 2);
  const haSayac = () => 1 + kimlikliler(ortam).length; // kayıttaki 1 önceki deneme + bu oturumdakiler
  const onaysizDeneme = async () => {
    const once = kimlikliler(ortam).length;
    for (let i = 0; i < 4; i += 1) {
      const s = await yenidenDeneIpc(ortam);
      assert.equal(s.ok, false, `onaysız Yeniden Dene geçmedi (${i})`);
      assert.equal(s.onayGerekli, true);
      assert.match(s.hata, /hatalı ya da yanıtsız deneme yapıldı/);
      assert.equal(typeof s.bilet, 'string');
    }
    await ortam.akit();
    await yavasHaIlerle(ortam);
    assert.equal(kimlikliler(ortam).length, once, 'onaysız Yeniden Dene HA\'ya istek göndermedi');
  };
  await onaysizDeneme();
  assert.equal(haSayac(), 2);

  // kullanıcı onaylar (bilet): TEK deneme gider (HA yine yanıt vermez); bütçe 3
  for (const beklenenBilet of [3, 4]) {
    const talep = await yenidenDeneIpc(ortam);
    assert.equal(talep.onayGerekli, true);
    const onayli = await yenidenDeneIpc(ortam, { bilet: talep.bilet });
    assert.equal(onayli.ok, true);
    await ortam.akit();
    await yavasHaIlerle(ortam);
    assert.equal(haSayac(), beklenenBilet, `her onay TAM 1 deneme ekler (HA sayacı ${beklenenBilet})`);
    ozet = await ayarOzeti(ortam);
    assert.equal(ozet.yetkiDurumu, 'dogrulanamadi');
    await onaysizDeneme();
  }
  assert.equal(ozet.yetkiHataliDeneme, 4);
  // bütçe sınırında (4) otomatik yollar da kapalı: 10 dk sonra yine istek yok
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(haSayac(), 4);
  sirsiz(ortam);
});

ortamda("yetki kesici (tur9-K15): kesin sayaç 4 olsa da GEÇERLİ doğrulanmış anahtar otomatik yollarda (açılış, 60 sn yedek) durmaz; onay istemez, 10 dk normal kullanım (K12b kaldırıldı)", {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: iyiKayit(0, { yerel: 4, dis: 4 }),
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const ilk = kimlikliler(ortam).length;
  assert.ok(ilk >= 2, 'açılışta tek doğrulama + durum okuması gitti (bütçe yüzünden durmadı)');
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.ok(kimlikliler(ortam).length > ilk, 'normal yoklamalar onaysız sürüyor');
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, null);
  assert.equal(ozet.yetkiHataliDeneme, 4, 'kesin sayaç yalnız WS auth_ok ile sıfırlanır (K8): REST başarısı sıfırlamaz');
  assert.equal(durumBildirimi(ortam, ANAHTAR_DOGRULANAMADI_BILDIRIMI).length, 0);
  sirsiz(ortam);
});

ortamda("yetki kesici (tur9-K16): {yerel: 0, dis: 4 kesin} + geçerli anahtar evde: onaysız normal kullanım, canlı bağlantı (WS) açılır, dış adrese istek yok", {
  ...dalga3([SALON]),
  ekDosyalar: iyiKayit(0, { yerel: 0, dis: 4 }),
  ha: HA_VARLIKLARI,
}, async (ortam) => {
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  assert.equal(s.url, 'ws://192.168.1.10:8123/api/websocket');
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiDurumu, null);
  assert.equal(ozet.canliDurum, 'canli');
  assert.deepEqual(disIstekleri(ortam), []);
  assert.equal(ozet.yetkiHataliDeneme, 4, 'dış kökenin kesin sayacı ev içi auth_ok ile sıfırlanmaz (K8, değişmedi)');
  assert.equal(durumBildirimi(ortam, ANAHTAR_DOGRULANAMADI_BILDIRIMI).length, 0);
});

ortamda('yetki kesici (tur8-K12): 2 aday 401/belirsiz sonrası bütçe 2 + doğrulanmış saklı anahtar x2 (yanıtsız) + Yeniden Dene: bilet istenir; onaysız HA toplamı 4', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: iyiKayit(0, { yerel: 2, dis: 0 }),
  apiYaniti: hicYanitVermez,
}, async (ortam) => {
  await ortam.akit();
  await yavasHaIlerle(ortam);
  ortam.ilerle(10 * 60_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).length, 2, 'saklı anahtar en çok 2 deneme (doğrulanmış sınır)');
  assert.equal((await ayarOzeti(ortam)).yetkiHataliDeneme, 4);
  const sonuc = await yenidenDeneIpc(ortam);
  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.onayGerekli, true);
  assert.equal(typeof sonuc.bilet, 'string');
  assert.equal(kimlikliler(ortam).length, 2, '2 aday (2) + saklı (2) = 4; onaysız Yeniden Dene eklemedi');
});

const ortamGeciciHata = { sira: [] };
const ECONNRESET_HATASI = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
ortamda('yetki kesici (tur9-K14): GEÇERLİ doğrulanmış anahtar, yalnız REST, aralarında başarılar olan 6 geçici hata (502 / yanıtsız / ECONNRESET): hiç durmaz, onay istemez; askıdaki denemeler başarıyla bütçeden düşer; 10 dk normal kullanım', {
  ...dalga3([SALON], { canliBaglanti: false }),
  ekDosyalar: iyiKayit(0, { yerel: 0, dis: 0 }),
  apiYaniti: (url, secenek) => {
    const gecici = ortamGeciciHata;
    if (gecici.sira.length > 0) {
      const tur = gecici.sira.shift();
      if (tur === '502') return new Response('x', { status: 502 });
      if (tur === 'reset') return Promise.reject(ECONNRESET_HATASI());
      return new Promise(() => {});
    }
    return haYanitiOlustur(HA_VARLIKLARI)(url, secenek);
  },
}, async (ortam) => {
  for (const hata of ['502', 'yanitsiz', 'reset', '502', 'yanitsiz', 'reset']) {
    ortamGeciciHata.sira = [hata]; // art arda değil: arada başarılı yanıt belirsiz sayacı sıfırlar
    await ortam.akit();
    await yavasHaIlerle(ortam);
    ortam.ilerle(5 * 60_000);
    await ortam.akit();
    assert.deepEqual(ortamGeciciHata.sira, [], `${hata} ağa çıkan istekte tüketildi`);
    const ozet = await ayarOzeti(ortam);
    assert.equal(ozet.yetkiDurumu, null, `geçerli anahtar ${hata} sonrası "doğrulanamadı" durumuna düşmedi`);
    assert.ok(ozet.yetkiHataliDeneme < 2, `askıdaki deneme başarıyla düşürüldü (bütçe ${ozet.yetkiHataliDeneme}); ikinci onay gerekmez`);
  }
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.yetkiHataliDeneme, 0, 'tüm askıdaki denemeler düşürüldü');
  const once = kimlikliler(ortam).length;
  for (let i = 0; i < 10; i += 1) {
    ortam.ilerle(60_000);
    await ortam.akit();
  }
  assert.ok(kimlikliler(ortam).length > once, '10 dk normal yoklamalar onaysız sürüyor');
  assert.equal((await ayarOzeti(ortam)).yetkiDurumu, null);
  assert.equal(durumBildirimi(ortam, ANAHTAR_DOGRULANAMADI_BILDIRIMI).length, 0, 'kullanıcıya "doğrulanamadı" bildirimi gitmedi');
  const talep = await yenidenDeneIpc(ortam);
  assert.equal(talep.onayGerekli, undefined, 'Yeniden Dene onay sormaz (bütçe 0)');
  sirsiz(ortam);
});

// ===========================================================================
// 1.2.0 ana süreç ve ayar dosyası denetim düzeltmeleri (h-04, h-10, h-11, h-14, h-16, h-20, h-26, h-32, h-33, h-35, h-36, h-37, k-10, k-17, k-18, k-20)
// ===========================================================================

const gercekOku = fs.readFileSync; // aşağıdaki sahtelerden ÖNCEKİ gerçek işlev: testler dosyaları buradan okur
const ayarDosyasi = (ortam) => path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json');
const klasorAdlari = (ortam) => fs.readdirSync(ortam.durum.yollar.get('userData'));
const bildirimGovdeleri = (ortam) => ortam.durum.bildirimler.map((b) => b.body);
/** Yok edilmemiş Ayarlar penceresi (ortam.ayarlarPenceresi() kapanmış eski pencereyi de bulabilir). */
const acikAyarlarPenceresi = (ortam) => ortam.durum.pencereler.find((p) => AYARLAR_BASLIK_DESENI.test(p.secenekler.title ?? '') && !p.yikik);

/** Yalnız ayarlar.json'a (varsayilan-ayarlar.json'a ya da .bak'a değil) giden okumaları yakalayan fs.readFileSync sahtesi. */
function ayarOkumaSahtesi(karar) {
  return mock.method(fs, 'readFileSync', function sahteOku(dosya, ...gerisi) {
    if (/[\\/]ayarlar\.json$/.test(String(dosya))) {
      const hata = karar();
      if (hata) throw hata;
    }
    return gercekOku.call(this, dosya, ...gerisi);
  });
}
const kilitHatasi = (kod = 'EBUSY') => Object.assign(new Error(`${kod}: resource busy or locked`), { code: kod });

// --- h-10: okunamayan dosya "bozuk" sayılıp ezilmez -------------------------------------------------

const H10_TOHUM = { semaSurumu: 5, yerelAdres: 'http://192.168.1.50:8123', favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }] };

{
  let okumalar = 0;
  ortamda('ayar dosyası (h-10): sürekli kilitli (EBUSY) dosya 4 kez denenir, "bozuk" SAYILMAZ, kenara alınmaz ve ÜZERİNE HİÇ YAZILMAZ; kullanıcıya söylenir', {
    tohum: H10_TOHUM,
    oncesi: () =>
      ayarOkumaSahtesi(() => {
        okumalar += 1;
        return kilitHatasi();
      }),
  }, async (ortam) => {
    assert.equal(okumalar, 4, 'dört deneme');
    assert.equal(gercekOku(ayarDosyasi(ortam), 'utf8'), JSON.stringify(H10_TOHUM), 'sağlam ayar dosyası olduğu gibi duruyor');
    assert.deepEqual(klasorAdlari(ortam).filter((ad) => /bozuk|\.tmp$|\.bak$/.test(ad)), [], 'ne kenara alındı ne geçici dosya ne son iyi kopya yazıldı');
    assert.deepEqual(bildirimGovdeleri(ortam).filter((b) => b === AYAR_OKUNAMADI_BILDIRIMI), [AYAR_OKUNAMADI_BILDIRIMI]);
    assert.equal(bildirimGovdeleri(ortam).some((b) => b.startsWith('Ayar dosyası okunamadı;')), false, '"bozuk dosya" bildirimi çıkmaz');
    assert.match(ortam.gunlukOku(), /ayarlar\.json okunamadı \(kilitli olabilir\)/);

    // Oturum boyunca yapılan değişiklikler de dosyanın üzerine yazılmaz; Ayarlar ekranı "diske yazılamadı" der.
    const sonuc = await ayarlarKaydet(ortam, { yerelAdres: 'http://192.168.1.77:8123' });
    assert.equal(sonuc.ok, false);
    assert.equal(sonuc.hata, AYAR_YAZILAMADI_METNI);
    assert.equal(gercekOku(ayarDosyasi(ortam), 'utf8'), JSON.stringify(H10_TOHUM), 'kayıttan sonra da özgün dosya');
  });
}

{
  let okumalar = 0;
  ortamda('ayar dosyası (h-10): kısa süreli kilit (ilk 2 okuma EPERM) yeniden denemeyle aşılır: ayarlar yüklenir, bildirim yok, dosya normal yazılır', {
    tohum: H10_TOHUM,
    oncesi: () =>
      ayarOkumaSahtesi(() => {
        okumalar += 1;
        return okumalar <= 2 ? kilitHatasi('EPERM') : null;
      }),
  }, async (ortam) => {
    assert.equal(okumalar, 3);
    assert.equal(bildirimGovdeleri(ortam).includes(AYAR_OKUNAMADI_BILDIRIMI), false);
    assert.equal((await ayarOzeti(ortam)).yerelAdres, 'http://192.168.1.50:8123', 'seçilen adres okundu (varsayılan değil)');
    assert.equal(JSON.parse(gercekOku(ayarDosyasi(ortam), 'utf8')).yerelAdres, 'http://192.168.1.50:8123');
  });
}

ortamda('ayar dosyası (h-10): gerçekten ayrıştırılamayan (yarım) JSON hâlâ "bozuk" sayılır: kenara alınır ve bildirilir (okunamadı bildirimi değil)', {
  ekDosyalar: { 'ayarlar.json': '{"yerelAdres": "http://192.168.1.50:81' },
}, async (ortam) => {
  assert.equal(klasorAdlari(ortam).filter((ad) => /^ayarlar\.bozuk-\d+\.json$/.test(ad)).length, 1);
  assert.equal(bildirimGovdeleri(ortam).includes(AYAR_OKUNAMADI_BILDIRIMI), false);
  assert.ok(bildirimGovdeleri(ortam).some((b) => b.startsWith('Ayar dosyası okunamadı; varsayılan ayarlar')));
});

// --- h-32: dayanıklı yazım (fsync, .bak, yeniden adlandırma denemeleri, boş dosya kurtarma) ---------------

ortamda('ayar yazımı (h-32): her yazım diske zorlanır (fsync) ve yeni içerik yerine konmadan önce son iyi içerik ayarlar.json.bak olarak saklanır', {
  tohum: H10_TOHUM,
  oncesi: () => mock.method(fs, 'fsyncSync'),
}, async (ortam) => {
  const fsyncSayisi = () => ortam.durum.ekMocklar[0].mock.callCount();
  assert.ok(fsyncSayisi() >= 1, 'açılıştaki yazım fsync çağırdı');
  const bak = `${ayarDosyasi(ortam)}.bak`;
  assert.equal(gercekOku(bak, 'utf8'), JSON.stringify(H10_TOHUM), 'ilk yazımdan önceki özgün içerik son iyi kopya oldu');

  const oncekiAsil = gercekOku(ayarDosyasi(ortam), 'utf8');
  const once = fsyncSayisi();
  const sonuc = await ayarlarKaydet(ortam, { yerelAdres: 'http://192.168.1.88:8123' });
  assert.equal(sonuc.ok, true);
  assert.ok(fsyncSayisi() > once, 'kayıt da fsync çağırdı');
  assert.equal(gercekOku(bak, 'utf8'), oncekiAsil, '.bak, kayıttan hemen önceki asıl dosyanın aynısı');
  assert.equal(JSON.parse(gercekOku(ayarDosyasi(ortam), 'utf8')).yerelAdres, 'http://192.168.1.88:8123');
  assert.equal(fs.existsSync(`${ayarDosyasi(ortam)}.tmp`), false, 'geçici dosya kalmaz');
});

{
  let kalanBasarisiz = 0;
  let denemeler = 0;
  ortamda('ayar yazımı (h-32): yeniden adlandırma kilit hatasında (EPERM/EBUSY) 3 kez denenir; 2. denemede başarırsa kayıt tamamdır, 3 kez başarısızsa kullanıcıya "yazılamadı" denir', {
    tohum: H10_TOHUM,
    oncesi: () => {
      const gercekAdlandir = fs.renameSync;
      return mock.method(fs, 'renameSync', function sahteAdlandir(kaynak, hedef) {
        if (/ayarlar\.json\.tmp$/.test(String(kaynak)) && kalanBasarisiz > 0) {
          kalanBasarisiz -= 1;
          denemeler += 1;
          throw kilitHatasi('EPERM');
        }
        return gercekAdlandir.call(this, kaynak, hedef);
      });
    },
  }, async (ortam) => {
    kalanBasarisiz = 1;
    denemeler = 0;
    const tamam = await ayarlarKaydet(ortam, { yerelAdres: 'http://192.168.1.60:8123' });
    assert.equal(tamam.ok, true, 'ikinci denemede yerine konuldu');
    assert.equal(denemeler, 1);
    assert.equal(JSON.parse(gercekOku(ayarDosyasi(ortam), 'utf8')).yerelAdres, 'http://192.168.1.60:8123');

    kalanBasarisiz = 99;
    denemeler = 0;
    const basarisiz = await ayarlarKaydet(ortam, { yerelAdres: 'http://192.168.1.61:8123' });
    assert.equal(basarisiz.ok, false);
    assert.equal(basarisiz.hata, AYAR_YAZILAMADI_METNI);
    assert.equal(denemeler, 3, 'tam 3 deneme');
    assert.equal(JSON.parse(gercekOku(ayarDosyasi(ortam), 'utf8')).yerelAdres, 'http://192.168.1.60:8123', 'asıl dosya son iyi haliyle duruyor');
    kalanBasarisiz = 0;
  });
}

ortamda('ayar yazımı (h-32): ayarlar.json 0 bayt kalmışsa (elektrik kesintisi) bozuk dosya kenara alınır ve ayarlar son iyi kopyadan (.bak) geri yüklenir; bildirim bunu söyler', {
  ekDosyalar: {
    'ayarlar.json': '',
    'ayarlar.json.bak': JSON.stringify({ ...H10_TOHUM, yerelAdres: 'http://192.168.1.99:8123' }),
  },
}, async (ortam) => {
  const yedekler = klasorAdlari(ortam).filter((ad) => /^ayarlar\.bozuk-\d+\.json$/.test(ad));
  assert.equal(yedekler.length, 1, 'boş dosya silinmeden kenara alındı');
  assert.equal((await ayarOzeti(ortam)).yerelAdres, 'http://192.168.1.99:8123', 'ayarlar .bak içeriğinden geldi (varsayılan değil)');
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi'], 'favoriler kayboldu sayılmaz');
  assert.ok(bildirimGovdeleri(ortam).includes(ayarDosyasiBozukMetni(yedekler[0], true)));
  assert.match(ortam.gunlukOku(), /ayarlar\.json\.bak \(son iyi kopya\) geri yüklendi/);
});

ortamda('ayar yazımı (h-32): dosya bozuk ve .bak da bozuksa varsayılanlarla başlanır (eski davranış), bildirim "son iyi kopya" demez', {
  ekDosyalar: { 'ayarlar.json': '{', 'ayarlar.json.bak': 'bozuk' },
}, async (ortam) => {
  const bildirim = bildirimGovdeleri(ortam).find((b) => b.startsWith('Ayar dosyası okunamadı'));
  assert.ok(bildirim);
  assert.doesNotMatch(bildirim, /son iyi kopya/);
  assert.match(bildirim, /varsayılan ayarlar kullanılıyor/);
});

// --- h-11: daha yeni şemalı dosya ----------------------------------------------------------------

const GELECEK_TOHUM = { semaSurumu: 9, yerelAdres: 'http://192.168.1.50:8123', gelecekAyar: { acik: true, liste: [1, 2] }, favoriler: [] };

ortamda('ayar dosyası (h-11): bu sürümden YENİ şemalı dosya: özgün dosya ayarlar.v9-yedek.json olarak saklanır, tanınmayan alan korunur, kullanıcıya söylenir', { tohum: GELECEK_TOHUM }, async (ortam) => {
  const yedek = JSON.parse(gercekOku(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.v9-yedek.json'), 'utf8'));
  assert.deepEqual(yedek, GELECEK_TOHUM, 'yedek özgün dosyanın aynısı');
  const asil = ortam.ayarOku();
  assert.deepEqual(asil.gelecekAyar, { acik: true, liste: [1, 2] }, 'tanınmayan ayar silinmedi');
  assert.equal(asil.semaSurumu, 9, 'şema sürümü düşürülmedi');
  assert.equal(asil.yerelAdres, 'http://192.168.1.50:8123');
  assert.ok(bildirimGovdeleri(ortam).includes(semaDahaYeniMetni(9, 'ayarlar.v9-yedek.json')));
  assert.match(ortam.gunlukOku(), /daha yeni bir şemada/);
});

ortamda('ayar dosyası (h-11): yeni şemalı dosyanın yedeği zaten varsa ezilmez', {
  tohum: GELECEK_TOHUM,
  ekDosyalar: { 'ayarlar.v9-yedek.json': '{"onceki":"yedek"}' },
}, async (ortam) => {
  assert.equal(gercekOku(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.v9-yedek.json'), 'utf8'), '{"onceki":"yedek"}');
  assert.equal(ortam.ayarOku().gelecekAyar.acik, true);
});

ortamda('ayar dosyası (h-11): güncel şemalı dosyada yeni-şema yedeği ve bildirimi çıkmaz', { tohum: { semaSurumu: 6, favoriler: [] } }, async (ortam) => {
  assert.deepEqual(klasorAdlari(ortam).filter((ad) => /yedek|hatali/.test(ad)), []);
  assert.equal(bildirimGovdeleri(ortam).some((b) => /daha yeni/.test(b)), false);
});

ortamda('ayar dosyası: yeni şemalı dosyanın yedeği var ve içerik FARKLIYSA ek (zaman damgalı) yedek alınır, kanonik yedek ezilmez, bildirim ek yedeğin adını söyler', {
  tohum: GELECEK_TOHUM,
  ekDosyalar: { 'ayarlar.v9-yedek.json': '{"onceki":"yedek"}' },
}, async (ortam) => {
  const userData = ortam.durum.yollar.get('userData');
  assert.equal(gercekOku(path.join(userData, 'ayarlar.v9-yedek.json'), 'utf8'), '{"onceki":"yedek"}', 'kanonik yedek ezilmedi');
  const ek = klasorAdlari(ortam).filter((ad) => /^ayarlar\.v9-yedek-\d{13}\.json$/.test(ad));
  assert.equal(ek.length, 1, 'yeni durum için ek yedek');
  assert.deepEqual(JSON.parse(gercekOku(path.join(userData, ek[0]), 'utf8')), GELECEK_TOHUM, 'ek yedek özgün dosyanın aynısı');
  assert.ok(bildirimGovdeleri(ortam).includes(semaDahaYeniMetni(9, ek[0])));
});

// --- Eski sürüm (1.3.0) gidiş-dönüşü: aynı klasörü kullanan eski sürüm yeni şemalı dosyayı yedekleyip düşürdükten sonra geri alma ---

const DONUS_YEDEGI = {
  semaSurumu: 6,
  yerelAdres: 'http://192.168.1.50:8123',
  dil: 'sistem',
  favoriler: [
    { entity_id: 'light.salon', ad: 'Salon', simge: 'ikon:isik', renk: 'sari', tepsi: true },
    { entity_id: 'climate.salon', ad: 'Klima', renk: 'mavi' },
    { entity_id: 'sensor.sicaklik', ad: 'Sıcaklık' },
  ],
};
// 1.3.0'ın o dosyayı açıp yazdığı hal: iklim ve sensör favorileri düştü, ışığın yeni alanları silindi
const DONUS_SONRASI = {
  semaSurumu: 6,
  yerelAdres: 'http://192.168.1.50:8123',
  dil: 'sistem',
  favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }, { entity_id: 'light.mutfak', ad: 'Mutfak' }],
  engellenenFavoriler: [{ entity_id: 'climate.salon', neden: 'alan' }, { entity_id: 'sensor.sicaklik', neden: 'alan' }],
};

ortamda('eski sürüm gidiş-dönüşü: düşen favoriler ve görünüm alanları yedekten ayarlar.json\'a geri yazılır, yedek zaman damgalı adla saklanır, kullanıcıya söylenir', {
  tohum: DONUS_SONRASI,
  ekDosyalar: { 'ayarlar.v6-yedek.json': JSON.stringify(DONUS_YEDEGI) },
}, async (ortam) => {
  const userData = ortam.durum.yollar.get('userData');
  const asil = ortam.ayarOku();
  assert.deepEqual(asil.favoriler.map((f) => f.entity_id), ['light.salon', 'climate.salon', 'sensor.sicaklik', 'light.mutfak']);
  const salon = asil.favoriler[0];
  assert.deepEqual({ simge: salon.simge, renk: salon.renk, tepsi: salon.tepsi }, { simge: 'ikon:isik', renk: 'sari', tepsi: true });
  assert.equal(asil.favoriler[1].renk, 'mavi');
  assert.deepEqual(asil.engellenenFavoriler, [], 'eski sürümün "alan" engel kayıtları temizlendi');
  // yedek kenara alındı: kanonik ad boş (eski sürüm bir sonraki gidişte yeniden yedek alabilir), içerik zaman damgalı adda duruyor
  assert.equal(fs.existsSync(path.join(userData, 'ayarlar.v6-yedek.json')), false);
  const saklanan = klasorAdlari(ortam).filter((ad) => /^ayarlar\.v6-yedek-\d{13}\.json$/.test(ad));
  assert.equal(saklanan.length, 1);
  assert.deepEqual(JSON.parse(gercekOku(path.join(userData, saklanan[0]), 'utf8')), DONUS_YEDEGI, 'yedek içeriği aynen saklandı');
  assert.ok(bildirimGovdeleri(ortam).includes(eskiSurumYedegiMetni(saklanan[0])), 'kullanıcıya söylendi (yedek adıyla)');
  assert.match(ortam.gunlukOku(), /Eski sürümün bıraktığı yedekten geri alındı: 2 favori, 1 favorinin görünüm alanları\./);
  assert.equal(ortam.gunlukOku().includes('192.168.1.50'), false, 'günlükte adres yok');
});

ortamda('eski sürüm gidiş-dönüşü: yedekte geri alınacak bir şey yoksa ayarlar değişmez, bildirim çıkmaz, ama yedek yine kenara alınır (bir sonraki gidişte yeniden yedek alınabilsin)', {
  tohum: { ...DONUS_YEDEGI, engellenenFavoriler: [] },
  ekDosyalar: { 'ayarlar.v6-yedek.json': JSON.stringify(DONUS_YEDEGI) },
}, async (ortam) => {
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon', 'climate.salon', 'sensor.sicaklik']);
  assert.equal(bildirimGovdeleri(ortam).some((b) => b.includes('yedekten geri alındı')), false);
  assert.equal(klasorAdlari(ortam).filter((ad) => /^ayarlar\.v6-yedek\.json$/.test(ad)).length, 0);
  assert.equal(klasorAdlari(ortam).filter((ad) => /^ayarlar\.v6-yedek-\d{13}\.json$/.test(ad)).length, 1);
});

ortamda('eski sürüm gidiş-dönüşü: kullanıcının eski sürümde bilerek sildiği (eski sürümün tanıdığı alandaki) favori geri gelmez; dil yalnız eski sürümün tanımadığı değerse ve "sistem" iken geri alınır', {
  tohum: { ...DONUS_SONRASI, favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }] },
  ekDosyalar: { 'ayarlar.v6-yedek.json': JSON.stringify({ ...DONUS_YEDEGI, dil: 'de', favoriler: [...DONUS_YEDEGI.favoriler, { entity_id: 'switch.silinen_priz', ad: 'Silinen priz' }] }) },
}, async (ortam) => {
  const asil = ortam.ayarOku();
  assert.deepEqual(asil.favoriler.map((f) => f.entity_id), ['light.salon', 'climate.salon', 'sensor.sicaklik']);
  assert.equal(asil.dil, 'de');
  // arayüz dili geri alınan dil: bildirim Almanca
  assert.ok(bildirimGovdeleri(ortam).includes(eskiSurumYedegiMetni(klasorAdlari(ortam).find((ad) => /^ayarlar\.v6-yedek-\d{13}\.json$/.test(ad)), (anahtar, degiskenler) => ANA_SOZLUK.de[anahtar].replace(/\{(\w+)\}/g, (_, a) => degiskenler?.[a] ?? ''))), 'bildirim geri alınan dilde');
});

ortamda('eski sürüm gidiş-dönüşü: şema eskiyse (göç sürüyor) yedek okunmaz, ayarlara karışmaz ve kenara alınmaz', {
  tohum: { semaSurumu: 5, yerelAdres: 'http://192.168.1.50:8123', favoriler: [{ entity_id: 'light.salon', ad: 'Salon' }] },
  ekDosyalar: { 'ayarlar.v6-yedek.json': JSON.stringify(DONUS_YEDEGI) },
}, async (ortam) => {
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon']);
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.v6-yedek.json')), true);
  assert.equal(bildirimGovdeleri(ortam).some((b) => b.includes('yedekten geri alındı')), false);
});

ortamda('eski sürüm gidiş-dönüşü: ayar dosyası bozuksa ya da kilitliyse (ham yok) yedekten HİÇBİR şey alınmaz ve yedek kenara alınmaz', {
  tohum: DONUS_SONRASI,
  ekDosyalar: { 'ayarlar.v6-yedek.json': JSON.stringify(DONUS_YEDEGI) },
  oncesi: () => ayarOkumaSahtesi(() => kilitHatasi('EBUSY')),
}, async (ortam) => {
  assert.equal(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.v6-yedek.json')), true, 'yedek yerinde');
  assert.equal(bildirimGovdeleri(ortam).some((b) => b.includes('yedekten geri alındı')), false);
  assert.deepEqual(JSON.parse(gercekOku(ayarDosyasi(ortam), 'utf8')).favoriler.map((f) => f.entity_id), ['light.salon', 'light.mutfak'], 'dosyaya hiç yazılmadı');
});

// --- h-33: tipi bozuk alanlar, kısayol sıfırlama bildirimi ----------------------------------------

ortamda('ayar dosyası (h-33): tipi bozuk alanlar (ör. favoriler dizi değil) varsayılana döner AMA sessiz değil: özgün dosya ayarlar.hatali-*.json olarak saklanır, alan adları bildirilir', {
  tohum: { semaSurumu: 5, yerelAdres: 'http://192.168.1.50:8123', favoriler: 'bozuk', odakKaybindaGizle: 'evet' },
}, async (ortam) => {
  const yedekler = klasorAdlari(ortam).filter((ad) => /^ayarlar\.hatali-\d+\.json$/.test(ad));
  assert.equal(yedekler.length, 1);
  const ozgun = JSON.parse(gercekOku(path.join(ortam.durum.yollar.get('userData'), yedekler[0]), 'utf8'));
  assert.equal(ozgun.favoriler, 'bozuk', 'yedek özgün (bozuk) değerleri içerir');
  assert.equal(Array.isArray(ortam.ayarOku().favoriler), true, 'asıl dosya düzeldi');
  const bildirim = bildirimGovdeleri(ortam).find((b) => b.startsWith('Ayar dosyasında geçersiz değerli alanlar'));
  assert.ok(bildirim, 'kullanıcıya söylendi');
  assert.match(bildirim, /favoriler/);
  assert.match(bildirim, /odakKaybindaGizle/);
  assert.ok(bildirim.includes(yedekler[0]));
  assert.equal(bildirim.includes('192.168.1.50'), false, 'bildirim ayar değerlerini taşımaz');
});

ortamda('ayar dosyası (h-33): geçerli dosyada ".hatali" yedeği ve "geçersiz alan" bildirimi çıkmaz', { tohum: { semaSurumu: 6, favoriler: [] } }, async (ortam) => {
  assert.deepEqual(klasorAdlari(ortam).filter((ad) => /hatali/.test(ad)), []);
  assert.equal(bildirimGovdeleri(ortam).some((b) => /geçersiz değerli/.test(b)), false);
});

ortamda('ayar dosyası (h-33): geçersiz palet kısayolu da (ana kısayol gibi) varsayılana dönerken kullanıcıya bildirilir', {
  tohum: { semaSurumu: 5, favoriler: [], paletKisayol: 'F9' },
}, async (ortam) => {
  assert.ok(bildirimGovdeleri(ortam).some((b) => /palet kısayolu geçerli değildi/.test(b)), 'bildirim var');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+P'), true, 'palet varsayılan tuşa kuruldu');
  assert.match(ortam.gunlukOku(), /palet kısayolu geçersizdi/);
});

// --- h-04: ana kısayol basılı tutma ------------------------------------------------------------

ortamda('ana kısayol (h-04): tuş basılı tutulup işletim sistemi tekrar üretirse TEK tetikleme sayılır; sessizlikten sonra yeni basış yine çalışır', undefined, ({ durum, pencere, ilerle }) => {
  ilerle(400);
  const kisayol = durum.kisayollar.get('Control+Alt+H');
  assert.equal(pencere.gorunur, true);
  kisayol(); // ilk basış: gizler
  assert.equal(pencere.gorunur, false);
  for (let i = 0; i < 10; i += 1) {
    ilerle(33); // ~30 Hz klavye tekrarı
    kisayol();
  }
  assert.equal(pencere.gorunur, false, 'tekrarlar paneli yeniden açıp kapatmaz (titreme yok)');
  assert.equal(pencere.cagri.hide, 1);
  assert.equal(pencere.cagri.show, 1, 'yalnız açılıştaki gösterim');
  ilerle(900); // tuş bırakıldı
  kisayol();
  assert.equal(pencere.gorunur, true, 'yeni basış çalışır');
});

// --- h-14: hiç gösterilmemiş gizli başlatılmış pencere ----------------------------------------------

function gizliBaslatSahtesi() {
  return mock.property(process, 'argv', [...process.argv, '--gizli']);
}
const urlYuklemeleri = (ortam) => ortam.pencere.webContents.yuklemeler.filter((y) => y.tur === 'url');

ortamda('gizli başlatma (h-14): hiç gösterilmemiş pencere ilk açılışta "uzun süre gizli kaldı" diye ana panoya YENİDEN YÜKLENMEZ; ilk gösterimden sonraki uzun gizlilik yine döndürür', {
  yoklama: 200,
  tohum: { semaSurumu: 5, favoriler: [], anaPanoyaDonDk: 5, tepsiSolTik: 'pencere' },
  oncesi: () => gizliBaslatSahtesi(),
}, async (ortam) => {
  const { pencere, tepsi } = ortam;
  const wc = pencere.webContents;
  assert.equal(pencere.gorunur, false, 'oturum açılışında gizli başladı');
  wc.url = 'http://192.168.1.10:8123/lovelace/0'; // HA "/" adresini kendi ana panosuna çevirdi
  wc.emit('did-navigate', {}, wc.url, 200);
  await ortam.akit();
  const once = urlYuklemeleri(ortam).length;

  for (let i = 0; i < 10; i += 1) ortam.ilerle(60_000); // 10 dk sonra ilk kez açılıyor
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
  assert.equal(urlYuklemeleri(ortam).length, once, 'pano yeniden yüklenmedi (boşuna yükleme ve oturum kaybı yok)');

  tusBas(pencere, ctrlW); // artık bir kez gösterildi
  for (let i = 0; i < 10; i += 1) ortam.ilerle(60_000);
  tepsi.emit('click');
  assert.equal(pencere.gorunur, true);
  assert.equal(urlYuklemeleri(ortam).length, once + 1, 'gösterilmiş pencere uzun gizlilikten sonra ana panoya döner');
  assert.equal(urlYuklemeleri(ortam).at(-1).url, 'http://192.168.1.10:8123/');
});

// --- h-16: uyanışta ağ geç gelir --------------------------------------------------------------------

const agDenetimSayisi = (ortam) => (ortam.gunlukOku().match(/Ağ yeniden denetleniyor/g) ?? []).length;

ortamda('uyanış (h-16): ağ uyanıştan sonra geç gelirse yoklama 5, 15 ve 30 sn sonra yeniden denenir (en çok 3 kez); sayfa ölü adreste kalmaz', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200); // HA sayfasında
  await ortam.akit();
  const once = agDenetimSayisi(ortam);
  ortam.durum.yoklamaDurumu = null; // ağ henüz yok
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  assert.equal(agDenetimSayisi(ortam) - once, 1, 'uyanışta ilk tur');

  const adimlar = [
    [4_900, 1, 'ilk yeniden deneme 5 sn sonra'],
    [100, 2, '1. yeniden deneme'],
    [14_900, 2, 'ikincisi 15 sn sonra'],
    [100, 3, '2. yeniden deneme'],
    [29_900, 3, 'üçüncüsü 30 sn sonra'],
    [100, 4, '3. yeniden deneme'],
  ];
  for (const [ms, beklenen, aciklama] of adimlar) {
    ortam.ilerle(ms);
    await ortam.akit();
    assert.equal(agDenetimSayisi(ortam) - once, beklenen, aciklama);
  }
  for (let i = 0; i < 5; i += 1) {
    ortam.ilerle(60_000);
    await ortam.akit();
  }
  assert.equal(agDenetimSayisi(ortam) - once, 4, 'zincir 3 yeniden denemeyle sınırlı (sonsuz yoklama yok)');
});

ortamda('uyanış (h-16): ağ geç gelince yeniden deneme başarılı olur: bayat HA sayfası TEK kez yenilenir', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  let yenilemeler = 0;
  wc.reload = () => {
    yenilemeler += 1;
  };
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200);
  await ortam.akit();
  ortam.durum.yoklamaDurumu = null;
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  assert.equal(yenilemeler, 0);

  ortam.durum.yoklamaDurumu = 200; // ağ geldi
  ortam.ilerle(5000);
  await ortam.akit();
  assert.equal(yenilemeler, 1, 'sayfa yenilendi');
  for (let i = 0; i < 3; i += 1) {
    ortam.ilerle(60_000);
    await ortam.akit();
  }
  assert.equal(yenilemeler, 1, 'ikinci yenileme yok');
});

ortamda('uyanış (h-16): ağ uyanışta hemen hazırsa sayfa yenilenmez (eski davranış: yalnız canlı bağlantı yeniden kurulur)', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  let yenilemeler = 0;
  wc.reload = () => {
    yenilemeler += 1;
  };
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200);
  await ortam.akit();
  ortam.guc.emit('resume');
  ortam.ilerle(500);
  await ortam.akit();
  ortam.ilerle(30_000);
  await ortam.akit();
  assert.equal(yenilemeler, 0);
});

// --- h-37: saat sıçraması (Modern Standby) ve açılış hatası ----------------------------------------

const manifestYoklamalari = (ortam) => ortam.durum.fetchler.filter((f) => f.url.endsWith('/manifest.json')).length;

ortamda('uyku algılama (h-37): uyanış olayı gelmese de iki 60 sn turu arasında >3 dk saat sıçraması uyanış sayılır ve ağ yeniden denetlenir', { yoklama: 200 }, async (ortam) => {
  for (let i = 0; i < 6; i += 1) ortam.ilerle(60_000); // normal akış: sıçrama yok
  await ortam.akit();
  assert.doesNotMatch(ortam.gunlukOku(), /Saat sıçraması algılandı/);
  const once = manifestYoklamalari(ortam);

  mock.timers.setTime(Date.now() + 20 * 60_000); // bilgisayar 20 dk "uyudu"; uyanış olayı gelmedi
  ortam.ilerle(60_000); // sıradaki 60 sn turu
  assert.match(ortam.gunlukOku(), /Saat sıçraması algılandı/);
  ortam.ilerle(500);
  await ortam.akit();
  assert.ok(manifestYoklamalari(ortam) > once, 'ağ yeniden denetlendi (adres yoklaması gitti)');
});

ortamda('uyku algılama (h-37): gerçek uyanış olayı ağ denetimini zaten başlattıysa saat sıçraması ikinci denetim başlatmaz', { yoklama: 200 }, async (ortam) => {
  for (let i = 0; i < 3; i += 1) ortam.ilerle(60_000);
  mock.timers.setTime(Date.now() + 20 * 60_000);
  ortam.guc.emit('resume'); // uyanış olayı geldi
  ortam.ilerle(60_000); // 60 sn turu (sıçrama burada görülür ama denetim 1 dk önce yapıldı)
  assert.doesNotMatch(ortam.gunlukOku(), /Saat sıçraması algılandı/);
  ortam.ilerle(500);
  await ortam.akit();
  assert.equal((ortam.gunlukOku().match(/Ağ yeniden denetleniyor \(uyanis\)/g) ?? []).length, 1);
  assert.doesNotMatch(ortam.gunlukOku(), /saat-sicramasi/);
});

ortamda('açılış hatası (h-37): app.whenReady zinciri hata verirse yalnız günlüğe değil kullanıcıya da bildirilir; ayrıntı (ileti) bildirime ya da günlüğe sızmaz', { hazirBekle: true }, async (ortam) => {
  ortam.durum.hazirReddet(Object.assign(new Error('GİZLİ-AYRINTI-http://x'), { code: 'ERR_ACILIS_DENEME' }));
  await ortam.akit();
  assert.deepEqual(bildirimGovdeleri(ortam), [ACILIS_HATASI_BILDIRIMI]);
  assert.match(ortam.gunlukOku(), /Açılış sırasında hata: Error \(ERR_ACILIS_DENEME\)/);
  assert.doesNotMatch(ortam.gunlukOku(), /GİZLİ-AYRINTI/);
  assert.equal(ortam.durum.pencereler.length, 0, 'pencere açılmadı ama uygulama düşmedi');
});

ortamda('açılış hatası (h-37): ayar yüklenmeden önce hata olsa da bildirim sistem dilinde yazılır (İngilizce sistemde İngilizce)', { hazirBekle: true, oncesi: (durum) => { durum.sistemDili = 'en-US'; } }, async (ortam) => {
  ortam.durum.hazirReddet(Object.assign(new Error('GİZLİ-AYRINTI'), { code: 'ERR_ACILIS_DENEME' }));
  await ortam.akit();
  const govdeler = bildirimGovdeleri(ortam);
  assert.deepEqual(govdeler, [ANA_SOZLUK.en['bildirim.acilisHatasi']]);
  assert.doesNotMatch(govdeler[0], /[çğıöşüÇĞİÖŞÜ]/);
  assert.notEqual(govdeler[0], ACILIS_HATASI_BILDIRIMI);
});

// --- h-37: Ayarlar penceresi sayfa süreci çökmesi ----------------------------------------------------

ortamda('ayarlar penceresi (h-37): sayfa süreci çökerse artan beklemeyle yeniden yüklenir (clean-exit sayılmaz); 5. çökmede pencere kapatılır ve kullanıcıya söylenir', undefined, async (ortam) => {
  ayarlarOlayi(ortam);
  const pencere = ortam.ayarlarPenceresi();
  const wc = pencere.webContents;
  const dosyaYuklemeleri = () => wc.yuklemeler.filter((y) => y.tur === 'dosya').length;
  const ilk = dosyaYuklemeleri();
  assert.equal(ilk, 1);

  wc.emit('render-process-gone', {}, { reason: 'clean-exit' });
  ortam.ilerle(30_000);
  assert.equal(dosyaYuklemeleri(), ilk, 'normal kapanış çökme sayılmaz');
  assert.equal(bildirimGovdeleri(ortam).includes(AYARLAR_COKTU_BILDIRIMI), false);

  const beklemeler = [1000, 2000, 4000, 8000];
  for (const [sira, bekle] of beklemeler.entries()) {
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    ortam.ilerle(bekle - 1);
    assert.equal(dosyaYuklemeleri(), ilk + sira, `${sira + 1}. çökme: bekleme dolmadan yüklenmez`);
    ortam.ilerle(1);
    assert.equal(dosyaYuklemeleri(), ilk + sira + 1, `${sira + 1}. çökme: ${bekle} ms sonra yeniden yüklendi`);
  }
  assert.equal(bildirimGovdeleri(ortam).filter((b) => b === AYARLAR_COKTU_BILDIRIMI).length, 1, 'ilk çökmede tek bildirim');

  wc.emit('render-process-gone', {}, { reason: 'oom' });
  assert.equal(pencere.yikik, true, '5. çökmede pencere kapatıldı');
  assert.equal(bildirimGovdeleri(ortam).filter((b) => b === AYARLAR_ART_ARDA_COKTU_BILDIRIMI).length, 1);
  ortam.ilerle(60_000);
  assert.equal(dosyaYuklemeleri(), ilk + beklemeler.length, 'kapatılan pencere yeniden yüklenmez');
  assert.match(ortam.gunlukOku(), /Ayarlar penceresi art arda çöktü \(oom, 5 kez\); kapatıldı/);

  // tepsiden yeniden açılabilir ve sayaç temizdir
  ayarlarOlayi(ortam);
  const yeni = acikAyarlarPenceresi(ortam);
  assert.notEqual(yeni, pencere);
  yeni.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  ortam.ilerle(1000);
  assert.equal(yeni.webContents.yuklemeler.filter((y) => y.tur === 'dosya').length, 2, 'yeni pencere kendi kurtarmasına sahip');
});

// --- h-20: eylemden sonra zorla durum yenileme ------------------------------------------------------

const h20Bekleyenler = [];

ortamda('durum yenileme (h-20): bir REST yenilemesi sürerken gelen ZORLA yenileme (ör. eylem sonrası) bayat sonucu bırakmaz: tur bitince BİR tur daha okunur, sonsuz döngü olmaz', {
  ...dalga3([SALON], { canliBaglanti: false }),
  apiYaniti: (url) => {
    const yol = new URL(url).pathname;
    if (yol === '/api/') return json({ message: 'API running.' });
    if (yol === '/api/states/light.salon_lambasi') return new Promise((coz) => h20Bekleyenler.push(() => coz(json(durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')))));
    return json({}, 404);
  },
}, async (ortam) => {
  await ortam.akit();
  const okumalar = () => ortam.durum.fetchler.filter((f) => f.yontem === 'GET' && new URL(f.url).pathname === '/api/states/light.salon_lambasi').length;
  assert.equal(okumalar(), 1, 'açılış yenilemesi sürüyor (yanıt tutuluyor)');

  const sonuc = await ayarlarKaydet(ortam, { canliBaglanti: true }); // canlı bağlantı değişimi zorla yenileme ister
  assert.equal(sonuc.ok, true);
  assert.equal(okumalar(), 1, 'süren tura katıldı, ikinci paralel istek yok');

  h20Bekleyenler.shift()();
  await ortam.akit();
  await ortam.akit();
  assert.equal(okumalar(), 2, 'süren tur bitince güncel durum için BİR tur daha');

  h20Bekleyenler.shift()();
  await ortam.akit();
  await ortam.akit();
  assert.equal(okumalar(), 2, 'üçüncü tur yok');
  assert.deepEqual(h20Bekleyenler, []);
});

// --- h-26: ana kısayol ile palet kısayolu çakışması / takas -------------------------------------------

const kisayolDurumlari = async (ortam) => (await ayarOzeti(ortam)).kisayolDurumlari;

ortamda('kısayol (h-26): ana ve palet kısayolları TAKAS edilebilir (ana palet tuşuna, palet ana tuşa): ikisi de kayıtlı, ikisi için uyarı yok, tuşlar doğru işi yapar', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'Control+Alt+P', paletKisayol: 'Control+Alt+H' });
  assert.equal(sonuc.ok, true);
  // AltGr bilgi uyarısı (yalnizKayitBasarili; Türkçe Q'daki çakışan tuşları sayar) başarısızlık değildir: yalnız gerçek sorunlar sayılır.
  assert.deepEqual(sonuc.uyarilar.filter((u) => !u.yalnizKayitBasarili && /kaydedilemedi|uygulanamadı|çakış/.test(u.mesaj)), [], 'hiçbir kaydedilemedi uyarısı yok');
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+P');
  assert.equal(ortam.ayarOku().paletKisayol, 'Control+Alt+H');
  const palet = (await kisayolDurumlari(ortam)).find((k) => k.tur === 'palet');
  assert.equal(palet.durum, 'etkin');

  // Control+Alt+H artık PALET: hızlı panel penceresi (palet modu) açılır, ana pencere değişmez.
  const anaOnce = { show: ortam.pencere.cagri.show, hide: ortam.pencere.cagri.hide };
  ortam.durum.kisayollar.get('Control+Alt+H')();
  await ortam.akit();
  assert.ok(ortam.yuzeyPenceresi(), 'palet açıldı');
  assert.deepEqual({ show: ortam.pencere.cagri.show, hide: ortam.pencere.cagri.hide }, anaOnce);

  // Control+Alt+P artık ANA kısayol: ana pencereyi açıp kapatır.
  ortam.pencere.odakta = true; // Ayarlar penceresi ana pencerenin odağını almış olabilir: ana pencere odakta
  ortam.durum.odakli = ortam.pencere;
  ortam.durum.kisayollar.get('Control+Alt+P')();
  assert.equal(ortam.pencere.gorunur, false, 'ana kısayol ana pencereyi gizledi');
});

ortamda('kısayol (h-26): ana kısayol palet tuşuna alınırsa kayıt reddedilmez; ana kısayol önceliklidir, palet "çakışıyor" diye listelenir, eski ana tuş serbest kalır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'Control+Alt+P' });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.uyarilar.filter((u) => u.alan === 'kisayol' && /kaydedilemedi/.test(u.mesaj)), [], 'Windows kaydı reddetti uyarısı yok');
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+P');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+H'), false, 'eski ana kısayol bırakıldı');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+P'), true);
  const ozet = await ayarOzeti(ortam);
  assert.equal(ozet.kisayolEtkin, true);
  const palet = ozet.kisayolDurumlari.find((k) => k.tur === 'palet');
  assert.notEqual(palet.durum, 'etkin', 'palet aynı tuşta olamaz');
  assert.equal(palet.neden, 'cakisma');
});

ortamda('kısayol (h-26): yeni ana kısayol GERÇEKTEN alınamazsa (başka uygulama) her şey eski haline döner: eski ana tuş ve palet yerinde, kullanıcıya "kaydedilemedi" denir', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.durum.reddedilenKisayollar.add('Control+Alt+P'); // palet tuşunu bırakınca başka bir uygulama kaptı
  const sonuc = await ayarlarKaydet(ortam, { kisayol: 'Control+Alt+P' });
  assert.equal(sonuc.ok, true);
  assert.ok(sonuc.uyarilar.some((u) => u.alan === 'kisayol' && /kaydedilemedi/.test(u.mesaj)));
  assert.equal(ortam.ayarOku().kisayol, 'Control+Alt+H', 'ayar değişmedi');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+H'), true, 'eski ana kısayol geri kuruldu');
  assert.equal((await ayarOzeti(ortam)).kisayolEtkin, true);
});

// --- h-35: HA sayfasından yerel durum sayfasına istenmeden dönüş -----------------------------------

ortamda('bağlantı (h-35): HA sayfasındayken geçmişte geri gidip yerel durum sayfasına düşülürse pencere orada takılmaz: yeniden bağlanılır ve HA adresi yüklenir', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/lovelace/0', 200);
  await ortam.akit();
  const once = urlYuklemeleri(ortam).length;
  wc.emit('did-navigate', {}, pathToFileURL(OFFLINE_HTML).href, 200); // HA'nın geri okuyla durum sayfasına dönüldü
  await ortam.akit();
  ortam.ilerle(100);
  await ortam.akit();
  assert.match(ortam.gunlukOku(), /HA sayfasından yerel durum sayfasına geri dönüldü/);
  assert.equal(urlYuklemeleri(ortam).length, once + 1, 'yeniden bağlanıldı');
  assert.equal(urlYuklemeleri(ortam).at(-1).url, 'http://192.168.1.10:8123/');
});

ortamda('bağlantı (h-35): uygulamanın KENDİ çevrimdışı sayfası (5xx yanıtı) istenmemiş dönüş sayılmaz: ek bağlanma/günlük yok', { yoklama: 200 }, async (ortam) => {
  const wc = ortam.pencere.webContents;
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 200);
  await ortam.akit();
  wc.emit('did-navigate', {}, 'http://192.168.1.10:8123/', 503); // sunucu bozuk yanıt verdi: uygulama durum sayfasını kendi gösterir
  await ortam.akit();
  assert.doesNotMatch(ortam.gunlukOku(), /geri dönüldü/);
  assert.ok(wc.yuklemeler.some((y) => y.tur === 'dosya' && /offline\.html/.test(y.url)), 'durum sayfası kendi yüklendi');
});

// --- yazım denetimi ve sözlük indirmesi (o-42) ---------------------------------------------

ortamda('yazım denetimi (o-42): HA oturumunda ve varsayılan oturumda kapalı, dil listesi boş; bu, ilk oturum kullanımından (izin işleyicisi) önce yapılır; sözlük için ağ isteği yok', undefined, async (ortam) => {
  const ha = ortam.durum.oturumlar.find((o) => o.ad === 'persist:ha');
  const varsayilan = ortam.durum.oturumlar.find((o) => o.ad === 'varsayilan');
  assert.ok(ha && varsayilan, 'iki oturum da kullanıldı');
  for (const oturum of [ha, varsayilan]) {
    assert.equal(oturum.yazimAcik, false);
    assert.deepEqual(oturum.yazimDilleri, []);
    assert.deepEqual(oturum.sira.slice(0, 3), ['yazim-acik', 'yazim-diller', 'izin'], `${oturum.ad}: yazım denetimi kapatma ilk çağrı`);
  }
  ortam.ilerle(600_000);
  await ortam.akit();
  assert.deepEqual(ortam.durum.fetchler.filter((f) => /dictionar|spell|gstatic|google|hunspell|\.bdic/i.test(f.url)), []);
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('yazım denetimi (o-42): oturum yazım denetimi işlevlerini sunmuyor ya da fırlatıyorsa açılış çökmez', undefined, async (ortam) => {
  assert.ok(ortam.pencere.gorunur, 'uygulama açıldı');
  const { yazimDenetiminiKapat } = require('../src/lib/yazim-denetimi');
  assert.doesNotThrow(() => yazimDenetiminiKapat({ setSpellCheckerEnabled() { throw new Error('x'); } }, () => {}));
});

// --- h-36: izinler ---------------------------------------------------------------------------------

ortamda('izinler (h-36): bildirim ve TAM EKRAN izni yalnız iki HA kökenine verilir; kamera, mikrofon, konum, pano... ve başka köken ya da file: sayfası reddedilir (istek ve denetim işleyicileri)', undefined, async (ortam) => {
  const oturumlar = ortam.durum.oturumlar.filter((o) => o.istek && o.denetim);
  assert.ok(oturumlar.length >= 2, 'HA oturumu ve varsayılan oturum işleyicileri kurulu');
  const ozet = await ayarOzeti(ortam);
  const haKokenleri = [ozet.yerelAdres, ozet.disAdres];
  const ISTEK = (oturum, izin, url) => new Promise((coz) => oturum.istek({}, izin, coz, { requestingUrl: url }));
  for (const oturum of oturumlar) {
    for (const koken of haKokenleri) {
      for (const izin of ['notifications', 'fullscreen']) {
        assert.equal(await ISTEK(oturum, izin, `${koken}/lovelace/0`), true, `${koken} ${izin} istek`);
        assert.equal(oturum.denetim({}, izin, `${koken}/`), true, `${koken} ${izin} denetim`);
      }
      for (const izin of ['media', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'midi', 'openExternal', 'pointerLock', 'display-capture', 'hid', 'usb']) {
        assert.equal(await ISTEK(oturum, izin, `${koken}/`), false, `${koken} ${izin} istek reddedilmeli`);
        assert.equal(oturum.denetim({}, izin, `${koken}/`), false, `${koken} ${izin} denetim reddedilmeli`);
      }
    }
    for (const yabanci of ['https://ornek.example/', 'http://192.168.1.200:8123/', pathToFileURL(AYARLAR_HTML).href, 'about:blank', '']) {
      for (const izin of ['notifications', 'fullscreen']) {
        assert.equal(await ISTEK(oturum, izin, yabanci), false, `${yabanci || '(boş)'} ${izin} istek`);
        assert.equal(oturum.denetim({}, izin, yabanci), false, `${yabanci || '(boş)'} ${izin} denetim`);
      }
    }
    assert.equal(oturum.cihaz(), false, 'USB / HID / seri port cihaz izni hep red');
  }
});

// --- k-10: bildirime tıklayınca Ayarlar ------------------------------------------------------------

ortamda('bildirim (k-10): çözüm Ayarlar\'da olan bildirime (ana kısayol alınamadı) tıklayınca Ayarlar açılır; çözümü olmayan bildirime tıklamak hiçbir şey yapmaz', { kisayolReddi: ['Control+Alt+H'], tohum: { semaSurumu: 5, favoriler: [], tepsiIpucuGosterildi: true } }, async (ortam) => {
  const kisayolBildirimi = ortam.durum.bildirimNesneleri.find((b) => /kısayolu alınamadı/.test(b.secenek.body));
  assert.ok(kisayolBildirimi, 'ana kısayol bildirimi çıktı');
  assert.equal(ortam.ayarlarPenceresi(), undefined, 'Ayarlar henüz açık değil');
  kisayolBildirimi.emit('click');
  assert.ok(ortam.ayarlarPenceresi(), 'tıklayınca Ayarlar açıldı');

  const baska = ortam.durum.pencereler.length;
  const duz = new ortam.durum.bildirimNesneleri[0].constructor({ title: 'x', body: 'çözümü yok' }); // tıklaması bağlı değil
  duz.emit('click');
  assert.equal(ortam.durum.pencereler.length, baska);
});

ortamda('bildirim (k-10): Ayarlar açıkken bildirime tıklamak ikinci pencere açmaz, mevcut pencereyi öne alır; kapanmış pencere de sorunsuz yeniden açılır', { kisayolReddi: ['Control+Alt+H'] }, async (ortam) => {
  const bildirim = ortam.durum.bildirimNesneleri.find((b) => /kısayolu alınamadı/.test(b.secenek.body));
  bildirim.emit('click');
  const ayar = ortam.ayarlarPenceresi();
  const sayi = ortam.durum.pencereler.filter((p) => /Ayarlar/.test(p.secenekler.title ?? '')).length;
  bildirim.emit('click');
  assert.equal(ortam.durum.pencereler.filter((p) => /Ayarlar/.test(p.secenekler.title ?? '')).length, sayi, 'ikinci pencere yok');
  assert.ok(ayar.cagri.focus >= 1);
  ayar.destroy();
  bildirim.emit('click');
  assert.ok(acikAyarlarPenceresi(ortam), 'kapatıldıktan sonra yeniden açıldı');
});

// --- k-17: alt pencere odağı ve tepsi çift tıklaması ---------------------------------------------

ortamda('odak (k-17): Ayarlar penceresi odağı başka bir yere bırakınca ana pencere de "dışarı tıklayınca gizle" kuralıyla gizlenir; Ayarlar odaktayken gizlenmez', { tohum: { semaSurumu: 5, favoriler: [], odakKaybindaGizle: true } }, async (ortam) => {
  ortam.ilerle(400);
  ayarlarOlayi(ortam);
  const ayar = ortam.ayarlarPenceresi();
  ayar.focus();
  ortam.pencere.odakKaybet(); // kullanıcı Ayarlar'a geçti
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, true, 'Ayarlar odaktayken ana pencere açık kalır');
  ayar.odakKaybet(); // kullanıcı başka bir uygulamaya tıkladı
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, false, 'ana pencere gizlendi');
});

ortamda('odak (k-17): Ayarlar kapanınca ana pencere odakta değilse gizlenir; ana pencereye geçilmişse açık kalır', { tohum: { semaSurumu: 5, favoriler: [], odakKaybindaGizle: true } }, async (ortam) => {
  ortam.ilerle(400);
  ayarlarOlayi(ortam);
  const ayar = ortam.ayarlarPenceresi();
  ayar.focus();
  ortam.pencere.odakKaybet();
  ortam.ilerle(300);
  ayar.destroy(); // Ayarlar kapandı, odak hiçbir pencerede değil
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, false);

  ortam.pencere.show();
  ortam.pencere.focus();
  ayarlarOlayi(ortam);
  const ikinci = acikAyarlarPenceresi(ortam);
  assert.notEqual(ikinci, ayar, 'yeni Ayarlar penceresi');
  ikinci.focus();
  ortam.pencere.odakKaybet();
  ortam.pencere.focus(); // kullanıcı ana pencereye geri döndü
  ikinci.destroy();
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, true, 'ana pencere odakta: gizlenmez');
});

ortamda('odak (k-17): HA\'nın açtığı alt pencere odağı bırakınca ya da kapanınca ana pencere de gizlenir; alt pencere odaktayken gizlenmez; ayar kapalıysa hiç gizlenmez', { tohum: { semaSurumu: 5, favoriler: [], odakKaybindaGizle: true } }, async (ortam) => {
  ortam.ilerle(400);
  const cocuk = new ortam.pencere.constructor({ width: 1100, height: 760 });
  ortam.pencere.webContents.emit('did-create-window', cocuk);
  cocuk.focus();
  ortam.pencere.odakKaybet();
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, true, 'alt pencere odaktayken açık');
  cocuk.odakKaybet();
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, false, 'alt pencere odağı bırakınca gizlendi');

  ortam.pencere.show();
  const ikinci = new ortam.pencere.constructor({ width: 1100, height: 760 });
  ortam.pencere.webContents.emit('did-create-window', ikinci);
  ikinci.focus();
  ortam.pencere.odakKaybet();
  ikinci.destroy(); // alt pencere kapandı, odak kimsede değil
  ortam.ilerle(300);
  assert.equal(ortam.pencere.gorunur, false, 'alt pencere kapanınca gizlendi');
});

ortamda('odak (k-17): "dışarı tıklayınca gizle" kapalıyken alt pencere odağı bırakmak ana pencereyi gizlemez', { tohum: { semaSurumu: 5, favoriler: [], odakKaybindaGizle: false } }, async (ortam) => {
  ortam.ilerle(400);
  const cocuk = new ortam.pencere.constructor({ width: 1100, height: 760 });
  ortam.pencere.webContents.emit('did-create-window', cocuk);
  cocuk.focus();
  ortam.pencere.odakKaybet();
  cocuk.odakKaybet();
  ortam.ilerle(2000);
  assert.equal(ortam.pencere.gorunur, true);
});

ortamda('tepsi (k-17): Windows çift tıkta iki tıklama da gelir; 500 ms içindeki ikinci tıklama yoksayılır (aç-kapa titremesi yok); sonraki tıklama yine çalışır', { tohum: { semaSurumu: 5, favoriler: [], tepsiSolTik: 'pencere' } }, async (ortam) => {
  ortam.ilerle(400);
  assert.equal(ortam.pencere.gorunur, true);
  ortam.pencere.odakKaybet(); // tepsi tıklaması odağı görev çubuğuna alır
  ortam.ilerle(100);
  ortam.tepsi.emit('click'); // 1. tık: gizler
  ortam.ilerle(120);
  ortam.tepsi.emit('click'); // çift tıkın 2. tıkı
  assert.equal(ortam.pencere.gorunur, false, 'ikinci tık paneli yeniden açmadı');
  assert.equal(ortam.pencere.cagri.show, 1);
  ortam.ilerle(700);
  ortam.tepsi.emit('click');
  assert.equal(ortam.pencere.gorunur, true, 'ayrı tık çalışır');
});

// --- k-18: açık HA sayfasının yolu (Ayarlar'daki "geçerli sayfayı kullan") ----------------------------

ortamda('açık sayfa yolu (k-18): ana pencere izinli HA kökeninde bir sayfa gösteriyorsa yol+sorgu+parça döner; çevrimdışı sayfada, yasak yolda ve başka kökende null', { yoklama: 200 }, async (ortam) => {
  const { acikHaSayfasiYolu } = ortam.anaModul;
  const wc = ortam.pencere.webContents;
  assert.equal(typeof acikHaSayfasiYolu, 'function');
  const git = (adres) => {
    wc.url = adres;
    wc.emit('did-navigate', {}, adres, 200);
  };
  assert.equal(acikHaSayfasiYolu(), null, 'HA sayfası henüz yüklenmedi');

  git('http://192.168.1.10:8123/lovelace/mutfak?edit=1#kart');
  assert.equal(acikHaSayfasiYolu(), '/lovelace/mutfak?edit=1#kart');
  git('http://192.168.1.10:8123/');
  assert.equal(acikHaSayfasiYolu(), '/');
  git('http://192.168.1.10:8123/config/dashboard');
  assert.equal(acikHaSayfasiYolu(), '/config/dashboard');

  for (const yasak of ['/api/states', '/auth/authorize?client_id=x', '/local/dosya.js', '/hacsfiles/x']) {
    git(`http://192.168.1.10:8123${yasak}`);
    assert.equal(acikHaSayfasiYolu(), null, yasak);
  }
  git('http://192.168.1.10:8123//ornek.example/yol');
  assert.equal(acikHaSayfasiYolu(), null, 'çift eğik çizgi (protokol-bağıl) reddedilir');

  wc.url = 'https://ornek.example/lovelace/0'; // gosterilenSayfa hâlâ ha ama URL başka kökende
  assert.equal(acikHaSayfasiYolu(), null, 'başka köken');

  wc.url = pathToFileURL(OFFLINE_HTML).href;
  wc.emit('did-navigate', {}, wc.url, 200);
  assert.equal(acikHaSayfasiYolu(), null, 'çevrimdışı sayfa');
});

// --- k-20: dış bağlantı açıldığında köşe bildirimi --------------------------------------------------

const sayfaAcmaKarari = (ortam, url) => ortam.pencere.webContents.pencereAcmaIsleyicisi({ url });

ortamda('dış bağlantı (k-20): HA içinden tıklanan dış bağlantı tarayıcıda açılınca köşede kısa bilgi görünür (e-posta için ayrı metin); açılamazsa "açıldı" denmez', undefined, async (ortam) => {
  assert.deepEqual(sayfaAcmaKarari(ortam, 'https://ornek.example/sayfa'), { action: 'deny' });
  await ortam.akit();
  assert.deepEqual(ortam.durum.disariAcilanlar, ['https://ornek.example/sayfa']);
  assert.deepEqual(koseMesajlari(ortam).map((m) => [m.tur, m.metin]), [['ok', TARAYICIDA_ACILDI_METNI]]);

  sayfaAcmaKarari(ortam, 'mailto:biri@ornek.example');
  await ortam.akit();
  assert.deepEqual(koseMesajlari(ortam).map((m) => m.metin).at(-1), EPOSTA_ACILDI_METNI);

  const sayi = koseMesajlari(ortam).length;
  ortam.durum.disariAcmaHatasi = true;
  sayfaAcmaKarari(ortam, 'https://baska.example/');
  await ortam.akit();
  assert.equal(koseMesajlari(ortam).length, sayi, 'tarayıcı açılamadıysa yanlış "açıldı" bilgisi yok');
});

ortamda('dış bağlantı (k-20): köşe bildirimi ayardan kapalıysa bilgi gösterilmez; tehlikeli şemalar (javascript:, file:) hiç açılmaz', { tohum: { semaSurumu: 5, favoriler: [], koseBildirimi: false } }, async (ortam) => {
  sayfaAcmaKarari(ortam, 'https://ornek.example/');
  sayfaAcmaKarari(ortam, 'javascript:alert(1)');
  sayfaAcmaKarari(ortam, 'file:///C:/Windows/System32/calc.exe');
  await ortam.akit();
  assert.deepEqual(ortam.durum.disariAcilanlar, ['https://ornek.example/']);
  assert.deepEqual(koseMesajlari(ortam), []);
});

// ===========================================================================
// Arayüz dili (src/lib/dil.js): ayardaki 'dil' ana süreçte çözülür; değişince tepsi, başlıklar ve açık sayfalar güncellenir.
// ===========================================================================

const dilMesajlari = (pencere) => pencere.webContents.mesajlar.filter((m) => m.kanal === 'dil:degisti').map((m) => m.yuk);

ortamda('dil: varsayılan ayar "sistem"; sistem dili İngilizce ise arayüz İngilizce açılır ("Home Panel"), Ayarlar yanıtı dili taşır', {
  oncesi: (durum) => {
    durum.sistemDili = 'en-US';
  },
}, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const yanit = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.equal(yanit.dilAyari, 'sistem');
  assert.equal(yanit.sistemDili, 'en', 'sistem dili tr | en olarak çözülür');
  assert.equal(yanit.dil, 'en');
  assert.ok(ortam.tepsi.ipuclari.at(-1).startsWith('Home Panel'), `tepsi ipucu İngilizce: ${ortam.tepsi.ipuclari.at(-1)}`);
  assert.ok(ortam.menuOgesi('Settings…'), 'tepsi menüsü İngilizce');
  assert.equal(ortam.menuOgesi('Ayarlar…'), undefined);
});

ortamda("dil: Ayarlar'dan dil değişince tepsi menüsü ve ipucu, pencere başlıkları yeniden kurulur ve açık Ayarlar sayfasına dil:degisti gider", undefined, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(olay)).dil, 'tr', 'sistem dili Türkçe');
  assert.ok(ortam.tepsi.ipuclari.at(-1).startsWith('Ev Paneli'));

  const sonuc = await ayarlarKaydet(ortam, { dil: 'en' });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().dil, 'en', 'dil ayara yazıldı');
  assert.equal(ortam.ayarlarPenceresi().sonBaslik, 'Home Panel — Settings');
  assert.ok(ortam.tepsi.ipuclari.at(-1).startsWith('Home Panel'), `tepsi ipucu: ${ortam.tepsi.ipuclari.at(-1)}`);
  assert.ok(ortam.menuOgesi('Settings…'));
  assert.deepEqual(dilMesajlari(ortam.ayarlarPenceresi()), [{ dil: 'en' }]);

  // aynı dille yeniden kaydetmek yeniden bildirim göndermez; "sistem"e dönmek (sistem dili Türkçe) Türkçeye çevirir
  await ayarlarKaydet(ortam, { dil: 'en' });
  assert.equal(dilMesajlari(ortam.ayarlarPenceresi()).length, 1, 'dil değişmediyse olay yok');
  await ayarlarKaydet(ortam, { dil: 'sistem' });
  assert.deepEqual(dilMesajlari(ortam.ayarlarPenceresi()).at(-1), { dil: 'tr' });
  assert.equal(ortam.ayarlarPenceresi().sonBaslik, 'Ev Paneli — Ayarlar');
  assert.ok(ortam.menuOgesi('Ayarlar…'));

  // geçersiz değer mevcut ayarı bozmaz (it: desteklenmeyen dil; DE: büyük harf geçersiz)
  await ayarlarKaydet(ortam, { dil: 'it' });
  assert.equal(ortam.ayarOku().dil, 'sistem');
  await ayarlarKaydet(ortam, { dil: 'DE' });
  assert.equal(ortam.ayarOku().dil, 'sistem');
});

ortamda('dil: Almanca, Fransızca ve İspanyolca seçilince tepsi menüsü, ipucu ve pencere başlıkları o dilde kurulur; dil:degisti gider; dil ayara yazılır', undefined, async (ortam) => {
  const beklenen = [
    ['de', 'Einstellungen…', 'Home Panel — Einstellungen'],
    ['fr', 'Paramètres…', 'Home Panel — Paramètres'],
    ['es', 'Configuración…', 'Home Panel — Configuración'],
  ];
  ayarlarOlayi(ortam);
  let mesajSayisi = 0;
  for (const [dil, menuMetni, baslik] of beklenen) {
    const sonuc = await ayarlarKaydet(ortam, { dil });
    assert.equal(sonuc.ok, true, dil);
    assert.equal(ortam.ayarOku().dil, dil, `${dil}: dil ayara yazıldı`);
    assert.equal(ortam.ayarlarPenceresi().sonBaslik, baslik, `${dil}: Ayarlar penceresi başlığı`);
    assert.ok(ortam.menuOgesi(menuMetni), `${dil}: tepsi menüsünde "${menuMetni}"`);
    assert.equal(ortam.menuOgesi('Ayarlar…'), undefined, `${dil}: Türkçe menü kalmadı`);
    assert.equal(ortam.menuOgesi('Settings…'), undefined, `${dil}: İngilizce menü kalmadı`);
    assert.ok(ortam.tepsi.ipuclari.at(-1).startsWith('Home Panel'), `${dil}: uygulama adı çevrilmez (${ortam.tepsi.ipuclari.at(-1)})`);
    mesajSayisi += 1;
    assert.deepEqual(dilMesajlari(ortam.ayarlarPenceresi()).at(-1), { dil }, `${dil}: dil:degisti`);
    assert.equal(dilMesajlari(ortam.ayarlarPenceresi()).length, mesajSayisi);
  }
  // aynı dille yeniden kaydetmek olay göndermez; Türkçeye dönmek menüyü ve başlığı geri getirir
  await ayarlarKaydet(ortam, { dil: 'es' });
  assert.equal(dilMesajlari(ortam.ayarlarPenceresi()).length, mesajSayisi, 'dil değişmediyse olay yok');
  await ayarlarKaydet(ortam, { dil: 'tr' });
  assert.equal(ortam.ayarlarPenceresi().sonBaslik, 'Ev Paneli — Ayarlar');
  assert.ok(ortam.menuOgesi('Ayarlar…'));
});

for (const [sistemDili, beklenenDil, menuMetni] of [['de-AT', 'de', 'Einstellungen…'], ['fr-CA', 'fr', 'Paramètres…'], ['es-MX', 'es', 'Configuración…'], ['it-IT', 'en', 'Settings…'], ['ja-JP', 'en', 'Settings…']]) {
  ortamda(`dil: sistem dili ${sistemDili} iken arayüz ${beklenenDil} açılır (desteklenmeyen sistem dili İngilizce); Ayarlar yanıtı dili taşır`, {
    oncesi: (durum) => {
      durum.sistemDili = sistemDili;
    },
  }, async (ortam) => {
    const yanit = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
    assert.equal(yanit.dilAyari, 'sistem');
    assert.equal(yanit.sistemDili, beklenenDil, 'sistem dili beş dilden biri olarak çözülür');
    assert.equal(yanit.dil, beklenenDil);
    assert.ok(ortam.tepsi.ipuclari.at(-1).startsWith('Home Panel'));
    assert.ok(ortam.menuOgesi(menuMetni), `tepsi menüsü ${beklenenDil}`);
    assert.equal(ortam.menuOgesi('Ayarlar…'), undefined);
  });
}

ortamda('dil: Almanca, Fransızca ve İspanyolca seçiliyken kaydetme hataları ve uyarıları o dilde döner (Türkçeye özgü harf kalmaz)', undefined, async (ortam) => {
  await ayarlarKaydet(ortam, { dil: 'en' });
  const enHata = (await ayarlarKaydet(ortam, { dil: 'en', yerelAdres: 'abc' })).hata;
  const enUyari = (await ayarlarKaydet(ortam, { dil: 'en', kisayol: 'F9' })).uyarilar[0].mesaj;
  await ayarlarKaydet(ortam, { dil: 'tr' });
  const trHata = (await ayarlarKaydet(ortam, { dil: 'tr', yerelAdres: 'abc' })).hata;
  for (const dil of ['de', 'fr', 'es']) {
    await ayarlarKaydet(ortam, { dil });
    const kotuAdres = await ayarlarKaydet(ortam, { dil, yerelAdres: 'abc' });
    assert.equal(kotuAdres.ok, false, dil);
    assert.doesNotMatch(kotuAdres.hata ?? JSON.stringify(kotuAdres), /[ğĞıİşŞ]/, `${dil}: hata metni`);
    assert.notEqual(kotuAdres.hata, trHata, `${dil}: Türkçe metin değil`);
    assert.notEqual(kotuAdres.hata, enHata, `${dil}: İngilizce metin değil`);
    const kisayol = await ayarlarKaydet(ortam, { dil, kisayol: 'F9' });
    assert.equal(kisayol.ok, true, dil);
    assert.equal(kisayol.uyarilar.length, 1, dil);
    assert.doesNotMatch(kisayol.uyarilar[0].mesaj, /[ğĞıİşŞ]/, `${dil}: uyarı metni`);
    assert.notEqual(kisayol.uyarilar[0].mesaj, enUyari, `${dil}: İngilizce metin değil`);
  }
});

ortamda('dil: İngilizce seçiliyken kaydetme hataları ve uyarıları İngilizce döner (Türkçe harf kalmaz)', undefined, async (ortam) => {
  await ayarlarKaydet(ortam, { dil: 'en' });
  const kotuAdres = await ayarlarKaydet(ortam, { dil: 'en', yerelAdres: 'abc' });
  assert.equal(kotuAdres.ok, false);
  assert.doesNotMatch(kotuAdres.hata ?? JSON.stringify(kotuAdres), /[çğıöşüÇĞİÖŞÜ]/);
  const kisayol = await ayarlarKaydet(ortam, { dil: 'en', kisayol: 'F9' });
  assert.equal(kisayol.ok, true);
  assert.equal(kisayol.uyarilar.length, 1);
  assert.doesNotMatch(kisayol.uyarilar[0].mesaj, /[çğıöşüÇĞİÖŞÜ]/);
});

ortamda('dil: dil değişimiyle gelen kayıt reddedilirse hata sayfanın şimdiki dilinde döner', undefined, async (ortam) => {
  await ayarlarKaydet(ortam, { dil: 'tr' });
  const trdenEn = await ayarlarKaydet(ortam, { dil: 'en', yerelAdres: 'abc' });
  assert.equal(trdenEn.ok, false);
  assert.match(trdenEn.hata, /[çğıöşüÇĞİÖŞÜ]/, 'kayıt reddedildi, sayfa Türkçe kaldı: hata Türkçe olmalı');
  await ayarlarKaydet(ortam, { dil: 'en' });
  const endenTr = await ayarlarKaydet(ortam, { dil: 'tr', yerelAdres: 'abc' });
  assert.equal(endenTr.ok, false);
  assert.doesNotMatch(endenTr.hata, /[çğıöşüÇĞİÖŞÜ]/, 'kayıt reddedildi, sayfa İngilizce kaldı: hata İngilizce olmalı');
});

// --- 1.4.0 düzen (o-16, o-24, o-28, o-30, o-31): ana süreç tarafı ------------------------------------------------------------

const DUZEN_VARLIKLARI = [...AYAR_VARLIKLARI, durumNesnesi('light.yeni_lamba', 'Yeni Lamba', 'off'), durumNesnesi('scene.film', 'Film', 'off')];
const DUZEN_EKRANI = {
  yoklama: 200,
  anahtar: true,
  tohum: {
    semaSurumu: 6,
    favoriler: [SALON, { entity_id: 'light.eski_lamba', ad: 'Eski Lamba', etiket: 'Okuma köşesi' }],
    sayfalar: [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.eski_lamba', 'light.salon_lambasi'] }],
  },
};
const duzenIpc = (ortam, kanal, ...yuk) => ortam.durum.ipc.get(kanal)(ayarlarOlayi(ortam), ...yuk);
const kimlikler = (liste) => liste.map((f) => f.entity_id);

ortamda('düzen IPC: duzen:gecmis, duzen:don ve favoriler:onar yalnız yerel Ayarlar sayfasından kabul edilir; reddedilen istek ayarı değiştirmez', DUZEN_EKRANI, async (ortam) => {
  haKur(ortam.durum, DUZEN_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const altCerceve = { sender: olay.sender, senderFrame: { ...olay.senderFrame, parent: {} } };
  const once = JSON.stringify(ortam.ayarOku());
  for (const [kanal, ...yuk] of [['duzen:gecmis'], ['duzen:don', 1], ['favoriler:onar', 'light.eski_lamba', 'light.yeni_lamba']]) {
    for (const kotu of [uzak, baskaPencere, altCerceve]) {
      assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, ...yuk), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
    }
  }
  assert.equal(JSON.stringify(ortam.ayarOku()), once, 'reddedilen istekler ayarı değiştirmez');
  assert.deepEqual(postlar(ortam), [], 'düzen işlemleri HA’ya hiçbir şey göndermez');
});

ortamda('ayarlar özeti: sayfalar, karo görünümü alanları ve (bir kez) odakFavori gelir', {
  ...DUZEN_EKRANI,
  tohum: { ...DUZEN_EKRANI.tohum, favoriler: [{ ...SALON, simge: 'ikon:isik', renk: 'mavi', boyut: 'genis', tepsi: true }, { entity_id: 'light.eski_lamba', ad: 'Eski Lamba' }] },
}, async (ortam) => {
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.deepEqual(JSON.parse(JSON.stringify(ozet.sayfalar)), [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.eski_lamba', 'light.salon_lambasi'] }]);
  const salon = JSON.parse(JSON.stringify(ozet.favoriler.find((f) => f.entity_id === 'light.salon_lambasi')));
  assert.deepEqual(salon, { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', simge: 'ikon:isik', renk: 'mavi', boyut: 'genis', tepsi: true });
  assert.equal(ozet.odakFavori ?? null, null);
});

ortamda('favori kaydı (o-31, o-16): simge / renk / boyut / tepsi yazılır, geçersiz olan gorunumHatalari ile bildirilir ve önceki değer korunur; yasak emoji hiç yazılmaz', DUZEN_EKRANI, async (ortam) => {
  haKur(ortam.durum, DUZEN_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const kaydet = ortam.durum.ipc.get('favoriler:kaydet');
  const tamam = await kaydet(olay, [
    { entity_id: 'light.salon_lambasi', simge: 'ikon:isik', renk: 'mavi', boyut: 'genis', tepsi: true },
    { entity_id: 'light.eski_lamba' },
  ]);
  assert.equal(tamam.ok, true);
  assert.deepEqual(tamam.gorunumHatalari, []);
  assert.deepEqual(ortam.ayarOku().favoriler[0], { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', simge: 'ikon:isik', renk: 'mavi', boyut: 'genis', tepsi: true });

  const red = await kaydet(olay, [
    { entity_id: 'light.salon_lambasi', simge: '🚪', renk: 'cam-gobegi', boyut: 'dev' },
    { entity_id: 'light.eski_lamba' },
  ]);
  assert.equal(red.ok, true, 'görünüm reddi kaydı durdurmaz');
  assert.deepEqual(red.gorunumHatalari, [
    { entity_id: 'light.salon_lambasi', alan: 'simge' },
    { entity_id: 'light.salon_lambasi', alan: 'renk' },
    { entity_id: 'light.salon_lambasi', alan: 'boyut' },
  ]);
  assert.deepEqual(ortam.ayarOku().favoriler[0], { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', simge: 'ikon:isik', renk: 'mavi', boyut: 'genis', tepsi: true }, 'önceki değerler duruyor');

  const temiz = await kaydet(olay, [{ entity_id: 'light.salon_lambasi', simge: '', renk: '', boyut: 'normal', tepsi: false }, { entity_id: 'light.eski_lamba' }]);
  assert.deepEqual(temiz.gorunumHatalari, []);
  assert.deepEqual(ortam.ayarOku().favoriler[0], { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }, '"" / normal / false kaydı temizler');
});

ortamda('sayfalar (o-24): ayarlar kaydıyla gelir, kapı kuralına takılan ad boşaltılıp bildirilir ve kapı / kilit varlığı sayfaya girmez; favori kaydı sayfayı favorilere göre budar', DUZEN_EKRANI, async (ortam) => {
  haKur(ortam.durum, DUZEN_VARLIKLARI);
  const sonuc = await ayarlarKaydet(ortam, {
    sayfalar: [
      { id: 'abc12', ad: 'Ön kapı', varliklar: ['light.salon_lambasi', 'lock.on_kapi', 'cover.garaj'] },
      { id: 'def34', ad: '  Mutfak ', varliklar: ['light.salon_lambasi', 'light.salon_lambasi'] },
    ],
  });
  assert.equal(sonuc.ok, true);
  assert.ok(sonuc.uyarilar.some((u) => u.alan === 'sayfalar' && u.mesaj), 'kapı kuralına takılan sayfa adı bildirilir');
  const sayfalar = ortam.ayarOku().sayfalar;
  assert.deepEqual(sayfalar.map((s) => s.ad), ['', 'Mutfak']);
  assert.doesNotMatch(JSON.stringify(sayfalar), /lock\.|cover\.|garaj/i, 'kapı / kilit varlığı sayfaya girmez');
  assert.deepEqual(sayfalar[1].varliklar, ['light.salon_lambasi'], 'yinelenen üye tek kalır');
  assert.deepEqual(JSON.parse(JSON.stringify((await ayarOzeti(ortam)).sayfalar)), sayfalar);

  // sayfa en çok 12 tane olur
  const cokSayfa = Array.from({ length: 15 }, (_, i) => ({ id: `sy${String(i).padStart(3, '0')}`, ad: `S${i}`, varliklar: [] }));
  await ayarlarKaydet(ortam, { sayfalar: cokSayfa });
  assert.ok(ortam.ayarOku().sayfalar.length <= 12);

  // favori kaydı: favori olmayan üyeler sayfalardan budanır
  await ayarlarKaydet(ortam, { sayfalar: [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.eski_lamba', 'light.salon_lambasi'] }] });
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  await ortam.durum.ipc.get('favoriler:kaydet')(olay, [{ entity_id: 'light.salon_lambasi' }]);
  assert.deepEqual(ortam.ayarOku().sayfalar[0].varliklar, ['light.salon_lambasi']);
});

ortamda('düzen geçmişi (o-30): favori kaydı önceki düzeni geçmişe yazar (yalnız zaman, neden, sayı); duzen:don o düzeni geri yükler ve dönüşün kendisi de geri alınabilir', DUZEN_EKRANI, async (ortam) => {
  haKur(ortam.durum, DUZEN_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  assert.deepEqual((await duzenIpc(ortam, 'duzen:gecmis')).noktalar, [], 'başlangıçta geçmiş boş');

  await ortam.durum.ipc.get('favoriler:kaydet')(olay, [{ entity_id: 'light.salon_lambasi' }]); // eski lamba kaldırıldı
  assert.deepEqual(kimlikler(ortam.ayarOku().favoriler), ['light.salon_lambasi']);
  const g1 = await duzenIpc(ortam, 'duzen:gecmis');
  assert.equal(g1.ok, true);
  assert.equal(g1.noktalar.length, 1);
  const nokta = g1.noktalar[0];
  assert.equal(nokta.neden, 'kaydet');
  assert.equal(nokta.favoriSayisi, 2);
  assert.equal(nokta.sayfaSayisi, 1);
  assert.ok(Number.isInteger(nokta.id) && Number.isFinite(nokta.zaman));
  assert.doesNotMatch(JSON.stringify(g1), /light\.|Eski|Okuma|Akşam/, 'geçmiş listesi varlık kimliği, karo adı ya da sayfa adı taşımaz');

  // geçersiz kimlik
  assert.equal((await duzenIpc(ortam, 'duzen:don', 9999)).ok, false);
  assert.equal((await duzenIpc(ortam, 'duzen:don', 'x')).ok, false);
  assert.equal((await duzenIpc(ortam, 'duzen:don')).ok, false);
  assert.deepEqual(kimlikler(ortam.ayarOku().favoriler), ['light.salon_lambasi'], 'geçersiz dönüş isteği ayarı değiştirmez');

  // geri dön
  const don = await duzenIpc(ortam, 'duzen:don', nokta.id);
  assert.deepEqual(don, { ok: true, favoriSayisi: 2, sayfaSayisi: 1, atilan: 0 });
  const geri = ortam.ayarOku();
  assert.deepEqual(kimlikler(geri.favoriler), ['light.salon_lambasi', 'light.eski_lamba']);
  assert.equal(geri.favoriler[1].etiket, 'Okuma köşesi');
  assert.deepEqual(geri.sayfalar[0].varliklar, ['light.eski_lamba', 'light.salon_lambasi'], 'sayfa üyeliği de geri geldi');
  assert.equal(geri.yerelAdres, 'http://192.168.1.10:8123', 'adres ve diğer ayarlar değişmez');

  // dönüş de bir nokta bıraktı: dönüşü geri almak mümkün
  const g2 = await duzenIpc(ortam, 'duzen:gecmis');
  assert.equal(g2.noktalar.length, 2);
  assert.equal(g2.noktalar[0].neden, 'don', 'en yeni nokta: dönmeden önceki düzen');
  assert.equal(g2.noktalar[0].favoriSayisi, 1);
  await duzenIpc(ortam, 'duzen:don', g2.noktalar[0].id);
  assert.deepEqual(kimlikler(ortam.ayarOku().favoriler), ['light.salon_lambasi']);
});

ortamda('onarım (o-28): HA’da bulunamayan favori aynı türden güvenli bir cihaza bağlanır; karo adı, sıra, sayfa üyeliği taşınır ve onarım geçmişe yazılır', DUZEN_EKRANI, async (ortam) => {
  haKur(ortam.durum, DUZEN_VARLIKLARI);
  const olay = ayarlarOlayi(ortam);
  const onar = (eski, yeni) => ortam.durum.ipc.get('favoriler:onar')(olay, eski, yeni);

  const cihazsiz = await onar('light.eski_lamba', 'light.yeni_lamba');
  assert.equal(cihazsiz.ok, false, 'önce cihaz listesi alınmış olmalı');
  assert.equal(cihazsiz.neden, 'cihazlar');

  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const once = JSON.stringify(ortam.ayarOku());
  const redler = [
    [['light.salon_lambasi', 'light.yeni_lamba'], 'bulunuyor', 'çalışan bir favori onarılmaz'],
    [['light.eski_lamba', 'lock.on_kapi'], 'guvenlik', 'kapı / kilit asla onarım hedefi olamaz'],
    [['light.eski_lamba', 'button.garaj_kapisi_ac'], 'guvenlik', 'kapı / garaj adlı cihaz hedef olamaz'],
    [['light.eski_lamba', 'light.salon_lambasi'], 'zaten-var', 'zaten favori olan cihaz'],
    [['light.eski_lamba', 'scene.film'], 'alan', 'farklı tür'],
    [['light.olmayan', 'light.yeni_lamba'], 'kayitsiz', 'kayıtlı olmayan favori'],
    [['light.eski_lamba', 'light.hic_yok'], 'guvenlik', 'güvenli listede olmayan cihaz'],
    [[42, 'light.yeni_lamba'], 'gecersiz', 'tür denetimi'],
    [['light.eski_lamba', 'light.eski_lamba'], 'guvenlik', 'kendisiyle onarılmaz (HA’da yok, güvenli listede değil)'],
  ];
  for (const [[eski, yeni], neden, aciklama] of redler) {
    const sonuc = await onar(eski, yeni);
    assert.equal(sonuc.ok, false, aciklama);
    assert.ok(sonuc.hata, `${aciklama}: hata metni var`);
    assert.equal(sonuc.neden, neden, aciklama);
  }
  assert.equal(JSON.stringify(ortam.ayarOku()), once, 'reddedilen onarımlar ayarı değiştirmez');

  const sonuc = await onar('light.eski_lamba', 'light.yeni_lamba');
  assert.deepEqual(sonuc, { ok: true, favoriSayisi: 2 });
  const ayar = ortam.ayarOku();
  assert.deepEqual(ayar.favoriler, [SALON, { entity_id: 'light.yeni_lamba', ad: 'Yeni Lamba', etiket: 'Okuma köşesi' }], 'aynı sırada, karo adı ve diğer alanlar taşındı');
  assert.deepEqual(ayar.sayfalar[0].varliklar, ['light.yeni_lamba', 'light.salon_lambasi'], 'sayfa üyeliği yeni kimliğe geçti');
  const gecmis = await duzenIpc(ortam, 'duzen:gecmis');
  assert.equal(gecmis.noktalar[0].neden, 'onar');
  assert.deepEqual(postlar(ortam), [], 'onarım HA’ya hiçbir servis çağrısı göndermez');
});

const KARO_MENU_EKRANI = {
  yoklama: 200,
  anahtar: true,
  tohum: { semaSurumu: 6, hazirListeSurumu: 1, favoriler: [SALON, EKRAN_KAPAT, PC_KAPAT], sayfalar: [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.salon_lambasi'] }] },
};

ortamda('karo bağlam menüsü (o-16): panelden gelen sağ tık menüyü ana süreçte kurar; tepsiye ekle, sayfaya ekle, kaldır (onayla) ve Düzenle… ayara yazılır; kayıtlı olmayan karo için menü açılmaz', KARO_MENU_EKRANI, async (ortam) => {
  haKur(ortam.durum, D3_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const sagTik = ortam.durum.ipc.get('yuzey:sag-tik');
  const acilanlar = [];
  // Menüyü açar, `sec` ile bir öğe seçtirir ve kapatır (gerçek menüde seçim click, kapanış callback ile gelir).
  const menudenSec = async (kimlik, sec) => {
    ortam.durum.menuPopup = (sablon, secenek) => {
      acilanlar.push(sablon);
      sec(sablon)?.click();
      secenek.callback();
    };
    const sonuc = await sagTik(olay, kimlik);
    await ortam.akit();
    return sonuc;
  };
  const etiketler = (sablon) => sablon.filter((o) => o.type !== 'separator').map((o) => o.label);
  const bul = (sablon, etiket) => sablon.find((o) => o.label === etiket);
  const ayar = () => ortam.ayarOku();

  // kayıtlı olmayan ya da geçersiz karo: menü hiç açılmaz, HA'ya bir şey gitmez
  for (const kotu of ['light.kayitsiz', 'lock.on_kapi', 42, undefined]) {
    assert.deepEqual(await menudenSec(kotu, () => null), { ok: false, tur: 'gecersiz' });
  }
  assert.equal(acilanlar.length, 0);

  // ışık: Düzenle…, Tepsiye ekle, Masaüstüne sabitle, Sayfaya ekle, Favorilerden kaldır…
  await menudenSec('light.salon_lambasi', (sablon) => {
    assert.deepEqual(etiketler(sablon), ['Düzenle…', 'Tepsiye ekle', 'Masaüstüne sabitle', 'Sayfaya ekle', 'Favorilerden kaldır…']);
    return bul(sablon, 'Tepsiye ekle');
  });
  assert.equal(ayar().favoriler.find((f) => f.entity_id === 'light.salon_lambasi').tepsi, true, 'tepsiye sabitlendi');
  await menudenSec('light.salon_lambasi', (sablon) => {
    assert.ok(etiketler(sablon).includes('Tepsiden kaldır'));
    return bul(sablon, 'Tepsiden kaldır');
  });
  assert.equal('tepsi' in ayar().favoriler.find((f) => f.entity_id === 'light.salon_lambasi'), false, 'sabitleme kalktı');

  // masaüstüne sabitle: Ayarlar'daki aynı liste değişir; favori / sayfa düzeni ve HA etkilenmez
  const duzenOnce = JSON.stringify([ayar().favoriler, ayar().sayfalar]);
  const postOnce = postlar(ortam).length;
  await menudenSec('light.salon_lambasi', (sablon) => bul(sablon, 'Masaüstüne sabitle'));
  assert.deepEqual(ayar().masaustuKarolari, ['light.salon_lambasi'], 'masaüstüne sabitlendi');
  assert.equal(JSON.stringify([ayar().favoriler, ayar().sayfalar]), duzenOnce, 'favoriler ve sayfalar değişmedi');
  await menudenSec('light.salon_lambasi', (sablon) => {
    assert.ok(etiketler(sablon).includes('Sabitlemeyi kaldır'));
    assert.equal(etiketler(sablon).includes('Masaüstüne sabitle'), false);
    return bul(sablon, 'Sabitlemeyi kaldır');
  });
  assert.deepEqual(ayar().masaustuKarolari, [], 'sabitleme kalktı');
  assert.equal(postlar(ortam).length, postOnce, 'sabitleme HA’ya hiçbir servis çağrısı göndermez');

  // yıkıcı eylem (PC kapat): tepsiye ve masaüstüne sabitleme önerilmez (zaten onaylı eylemler altında)
  await menudenSec('button.pc_bilgisayari_kapat', (sablon) => {
    assert.equal(etiketler(sablon).includes('Tepsiye ekle'), false);
    assert.equal(etiketler(sablon).includes('Tepsiden kaldır'), false);
    assert.equal(etiketler(sablon).includes('Masaüstüne sabitle'), false);
    return null;
  });

  // sayfaya ekle: alt menüden sayfa seçilir
  await menudenSec('button.pc_ekran_kapat', (sablon) => {
    const alt = bul(sablon, 'Sayfaya ekle');
    assert.deepEqual(alt.submenu.map((o) => [o.label, o.checked]), [['Akşam', false]]);
    return alt.submenu[0];
  });
  assert.deepEqual(ayar().sayfalar[0].varliklar, ['light.salon_lambasi', 'button.pc_ekran_kapat']);
  await menudenSec('button.pc_ekran_kapat', (sablon) => {
    const alt = bul(sablon, 'Sayfaya ekle');
    assert.deepEqual(alt.submenu.map((o) => [o.label, o.checked]), [['Akşam', true]], 'sayfada olan işaretli görünür');
    return alt.submenu[0]; // çıkar
  });
  assert.deepEqual(ayar().sayfalar[0].varliklar, ['light.salon_lambasi']);

  // kaldır: onay ister; vazgeçilirse favori kalır
  ortam.durum.diyalogYaniti = 1;
  await menudenSec('button.pc_ekran_kapat', (sablon) => bul(sablon, 'Favorilerden kaldır…'));
  assert.ok(ayar().favoriler.some((f) => f.entity_id === 'button.pc_ekran_kapat'), 'vazgeçildi: favori kaldı');
  assert.match(ortam.durum.diyaloglar.at(-1).message, /Ekranı Kapat/);
  ortam.durum.diyalogYaniti = 0;
  await menudenSec('button.pc_ekran_kapat', (sablon) => bul(sablon, 'Favorilerden kaldır…'));
  assert.equal(ayar().favoriler.some((f) => f.entity_id === 'button.pc_ekran_kapat'), false, 'onaylandı: favori kaldırıldı');

  // geçmişe yazıldı: son nokta kaldırmadan öncekini taşır ve geri dönülebilir
  const gecmis = await duzenIpc(ortam, 'duzen:gecmis');
  assert.equal(gecmis.noktalar[0].neden, 'menu-kaldir');
  assert.equal((await duzenIpc(ortam, 'duzen:don', gecmis.noktalar[0].id)).ok, true);
  assert.ok(ayar().favoriler.some((f) => f.entity_id === 'button.pc_ekran_kapat'), 'geçmişten geri geldi');

  // Düzenle…: Ayarlar açılır ve favoriye götürür (olay ya da ayar özetindeki odakFavori ile, bir kez)
  await menudenSec('light.salon_lambasi', (sablon) => bul(sablon, 'Düzenle…'));
  const ayarlarPenceresi = ortam.ayarlarPenceresi();
  assert.ok(ayarlarPenceresi, 'Ayarlar penceresi açıldı');
  const gonderildi = ayarlarPenceresi.webContents.mesajlar.some((m) => m.kanal === 'ayarlar:favoriye-git' && m.yuk === 'light.salon_lambasi');
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.ok(gonderildi || ozet.odakFavori === 'light.salon_lambasi', 'Ayarlar o favoriye yönlendirildi');
  assert.equal(((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).odakFavori ?? null), null, 'odak isteği bir kez verilir');
  assert.deepEqual(postlar(ortam), [], 'menü işlemleri HA’ya hiçbir servis çağrısı göndermez');
});

// ===========================================================================
// 1.4.0 pencere grubu: o-22 üstte tutma, o-32 konum/ekran/opaklık, o-27 tepsi rozeti, o-33 masaüstü karoları
// ===========================================================================

const EKRAN_1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
const EKRAN_2 = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1.5 };
const IKI_EKRAN = [EKRAN_1, EKRAN_2];
const TERCIH_EKRAN_2 = { id: 2, x: 1920, y: 0, genislik: 2560, yukseklik: 1440 };
const KARO_HTML = path.join(KOK_DIZIN, 'src', 'masaustu-karo.html');
const karoPencereleri = (ortam) => ortam.durum.pencereler.filter((p) => /Masaüstü Karosu|Desktop Tile/.test(p.secenekler.title ?? '') && !p.yikik);
const karoOlayi = (pencere) => ({ sender: pencere.webContents, senderFrame: { url: pathToFileURL(KARO_HTML).href, parent: null } });
const karoModeli = (pencere) => pencere.webContents.mesajlar.filter((m) => m.kanal === 'karo:durum').at(-1)?.yuk?.model;
const icinde = (s, alan) => s.x >= alan.x && s.y >= alan.y && s.x + s.width <= alan.x + alan.width && s.y + s.height <= alan.y + alan.height;
const SENSOR_SICAKLIK = { entity_id: 'sensor.salon_sicaklik', state: '21.5', attributes: { friendly_name: 'Salon sıcaklığı', unit_of_measurement: '°C', device_class: 'temperature' } };

// --- o-32: ekrana taşı, tercih edilen ekran ---

ortamda('o-32: tek ekranda tepsi menüsünde "Ekrana taşı" yoktur (menü eskisi gibi)', undefined, (ortam) => {
  ortam.ilerle(400);
  assert.equal(ortam.menuOgesi('Ekrana taşı') ?? ortam.menuOgesi('Move to screen'), undefined);
});

ortamda('o-32: birden çok ekranda "Ekrana taşı" altmenüsü; seçim ayara yazılır ve görünür ana pencere o ekranın çalışma alanında ortalanır; "Tercih yok" geri alır', { ekranlar: IKI_EKRAN }, (ortam) => {
  ortam.ilerle(900);
  const alt = () => ortam.menuOgesi('Ekrana taşı').submenu;
  const secenekler = () => alt().filter((o) => o.type !== 'separator').map((o) => [o.label, o.checked]);
  assert.deepEqual(secenekler(), [['Ekran 1  ·  1920×1080  ·  ana ekran', false], ['Ekran 2  ·  2560×1440', false], ['Tercih yok (imlecin ekranı)', true]]);
  assert.ok(alt().filter((o) => o.type === 'radio').length === 3, 'seçilebilir (radyo) öğeler');

  alt()[1].click();
  assert.deepEqual(ortam.ayarOku().tercihEkran, TERCIH_EKRAN_2);
  const s = ortam.pencere.sinirlar;
  assert.ok(icinde(s, EKRAN_2.workArea), 'ikinci ekranın çalışma alanında');
  assert.equal(s.x, 1920 + Math.round((2560 - s.width) / 2));
  assert.equal(s.y, Math.round((1400 - s.height) / 2));
  assert.deepEqual(secenekler(), [['Ekran 1  ·  1920×1080  ·  ana ekran', false], ['Ekran 2  ·  2560×1440', true], ['Tercih yok (imlecin ekranı)', false]]);

  alt().at(-1).click(); // "Tercih yok"
  assert.deepEqual(ortam.ayarOku().tercihEkran, {});
  assert.ok(icinde(ortam.pencere.sinirlar, EKRAN_1.workArea), 'imlecin (birincil) ekranına döndü');
});

ortamda('o-32: ayar diske yazılamıyorsa "Ekrana taşı" seçimi geri alınır, pencere taşınmaz ve hata söylenir', { ekranlar: IKI_EKRAN }, (ortam) => {
  ortam.ilerle(900);
  const onceki = { ...ortam.pencere.sinirlar };
  fs.mkdirSync(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json.tmp')); // yazımı bozar (disk dolu / kilit taklidi)
  ortam.menuOgesi('Ekrana taşı').submenu[1].click();
  assert.deepEqual(ortam.ayarOku().tercihEkran, {});
  assert.deepEqual(ortam.pencere.sinirlar, onceki, 'pencere taşınmadı');
  assert.equal(ortam.menuOgesi('Ekrana taşı').submenu.at(-1).checked, true, 'işaret "Tercih yok"ta kaldı');
  assert.equal(ortam.durum.bildirimler.filter((b) => b.body === AYAR_YAZILAMADI_METNI).length, 1);
});

ortamda('o-32: kayıtlı tercih ekranı bağlıysa ana pencere açılışta oradadır; kimliği değişmiş ama aynı yer/boyuttaki ekran da eşleşir', { ekranlar: IKI_EKRAN, tohum: { tercihEkran: TERCIH_EKRAN_2 } }, (ortam) => {
  assert.ok(icinde(ortam.pencere.sinirlar, EKRAN_2.workArea));
});

ortamda('o-32: tercih ekranının kimliği değişmişse (aynı konum ve boyut) yine o ekran kullanılır', { ekranlar: IKI_EKRAN, tohum: { tercihEkran: { ...TERCIH_EKRAN_2, id: 77 } } }, (ortam) => {
  assert.ok(icinde(ortam.pencere.sinirlar, EKRAN_2.workArea));
});

ortamda('o-32: tercih edilen ekran bağlı değilse pencere imlecin ekranında açılır ve tercih SİLİNMEZ', { ekranlar: [EKRAN_1], tohum: { tercihEkran: TERCIH_EKRAN_2 } }, (ortam) => {
  assert.ok(icinde(ortam.pencere.sinirlar, EKRAN_1.workArea));
  ortam.menuOgesi('Geniş pencere').click({ checked: true }); // ayarları diske yazan herhangi bir işlem
  assert.deepEqual(ortam.ayarOku().tercihEkran, TERCIH_EKRAN_2, 'ekran yeniden takılınca tercih geçerli olur');
  assert.equal(ortam.menuOgesi('Ekrana taşı'), undefined, 'tek ekranda menü yok');
});

ortamda('o-32: tercih ekranı olmayan (bağlı olmayan) bir kimlik seçilemez: menü yalnız bağlı ekranları listeler', { ekranlar: IKI_EKRAN }, (ortam) => {
  ortam.ilerle(900);
  const etiketler = ortam.menuOgesi('Ekrana taşı').submenu.filter((o) => o.type === 'radio').map((o) => o.label);
  assert.equal(etiketler.length, 3);
  assert.ok(etiketler.every((e) => !/undefined|NaN|null/.test(e)));
});

// --- o-32: konum hatırlama ---

ortamda('o-32: konum modu "imlec" (varsayılan): pencere ortalanır; taşıma kaydedilmez', undefined, (ortam) => {
  const { pencere } = ortam;
  assert.equal(pencere.sinirlar.x, Math.round((1920 - pencere.sinirlar.width) / 2));
  ortam.ilerle(900);
  pencere.setBounds({ x: 40, y: 50, width: pencere.sinirlar.width, height: pencere.sinirlar.height });
  pencere.emit('move');
  ortam.ilerle(600);
  assert.deepEqual(ortam.ayarOku().pencereKonumlari ?? {}, {});
});

ortamda('o-32: konum modu "hatirla": kayıtlı konum görünürse pencere orada açılır; taşınınca boyut moduna göre kaydedilir', { tohum: { pencereKonumu: 'hatirla', pencereKonumlari: { hizli: { x: 300, y: 200 } } } }, (ortam) => {
  const { pencere } = ortam;
  assert.deepEqual({ x: pencere.sinirlar.x, y: pencere.sinirlar.y }, { x: 300, y: 200 });
  ortam.ilerle(900);
  pencere.setBounds({ x: 50, y: 60, width: pencere.sinirlar.width, height: pencere.sinirlar.height });
  pencere.emit('move');
  ortam.ilerle(600);
  assert.deepEqual(ortam.ayarOku().pencereKonumlari, { hizli: { x: 50, y: 60 } });
  ortam.menuOgesi('Geniş pencere').click({ checked: true });
  assert.deepEqual(ortam.ayarOku().pencereKonumlari.hizli, { x: 50, y: 60 }, 'mod değişince eski modun konumu durur');
});

ortamda('o-32: "hatirla" iken kayıtlı konumun ekranı yoksa pencere imlecin ekranında açılır, kayıt silinmez', { tohum: { pencereKonumu: 'hatirla', pencereKonumlari: { hizli: { x: -1500, y: 50 } } } }, (ortam) => {
  assert.ok(icinde(ortam.pencere.sinirlar, EKRAN_1.workArea));
  assert.equal(ortam.pencere.sinirlar.x, Math.round((1920 - ortam.pencere.sinirlar.width) / 2), 'ortalandı');
  ortam.menuOgesi('Geniş pencere').click({ checked: true });
  assert.deepEqual(ortam.ayarOku().pencereKonumlari.hizli, { x: -1500, y: 50 });
});

// --- o-32: opaklık, o-22: üstte tutma ---

ortamda('o-32: ana pencere opaklığı ayardan uygulanır (varsayılan tam opak); Ayarlar\'dan değişince hemen güncellenir; geçersiz değer reddedilir', { tohum: { panelOpaklik: 70 } }, async (ortam) => {
  assert.equal(ortam.pencere.opakliklar.at(-1), 0.7);
  const sonuc = await ayarlarKaydet(ortam, { panelOpaklik: 55 });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.pencere.opakliklar.at(-1), 0.55);
  assert.equal(ortam.ayarOku().panelOpaklik, 55);
  const kotu = await ayarlarKaydet(ortam, { panelOpaklik: 10 });
  assert.equal(kotu.uyarilar.length, 1);
  assert.equal(ortam.ayarOku().panelOpaklik, 55, 'geçersiz değer mevcut olanı korur');
});

ortamda('o-32: varsayılanda ana pencereye opaklık UYGULANMAZ (1 = tam opak)', undefined, (ortam) => {
  assert.ok((ortam.pencere.opakliklar ?? [1]).every((o) => o === 1));
});

ortamda('o-32: hızlı panel opaklığı yalnız opak malzemede (yok) uygulanır; akrilikte tam opak kalır', dalga3([SALON], { panelOpaklik: 80, yeniPencereMalzemesi: 'yok' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.equal(panel.opakliklar.at(-1), 0.8);
  await ayarlarKaydet(ortam, { yeniPencereMalzemesi: 'acrylic' });
  assert.equal(panel.opakliklar.at(-1), 1, 'akrilik: pencere tam opak');
});

ortamda('o-22: varsayılanda hızlı panel 1.3.0 gibi "floating" seviyesindedir; ayar açılınca görünür panel "screen-saver" olur ve ayar kalıcıdır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(panel.ustCagrilari.at(-1), [true, 'floating']);
  const sonuc = await ayarlarKaydet(ortam, { panelHerZamanUstte: true });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().panelHerZamanUstte, true);
  assert.deepEqual(panel.ustCagrilari.at(-1), [true, 'screen-saver'], 'açık panel hemen güncellenir');
  ortam.ilerle(600);
  ortam.tepsi.emit('click'); // kapat
  assert.deepEqual(panel.ustCagrilari.at(-1), [true, 'floating'], 'gizlenince yüksek seviye bırakılır');
});

// --- o-27: tepsi rozeti ---

const rozetliMi = (simge, tur, metin) => typeof simge !== 'string' && Buffer.isBuffer(simge.veri) && simge.veri.equals(simgePng({ boyut: 16, rozet: { tur, metin } }));

ortamda('o-27: varsayılan (kapalı) rozetsiz: tepsi simgesi yalnız paketlenmiş dosya simgeleridir', dalga4(D4_FAVORILERI, { canliBaglanti: false }, { ha: ISIK_ACIK_VARLIKLARI }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.ok(ortam.tepsi.simgeler.every((s) => typeof s === 'string' && /ikon(-soluk)?\.ico$/.test(s)));
});

ortamda('o-27: rozet "isik": açık favori ışık sayısı simgeye çizilir (anahtar/priz sayılmaz)', dalga4(D4_FAVORILERI, { canliBaglanti: false, tepsiRozeti: 'isik' }, { ha: ISIK_ACIK_VARLIKLARI }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  const son = ortam.tepsi.simgeler.at(-1);
  assert.ok(rozetliMi(son, 'isik', '2'), 'iki açık ışık');
  assert.deepEqual(son.secenek, { scaleFactor: 1 });
});

ortamda('o-27: canlı bağlantıda ışık açılınca rozet değişir, ama simge saniyede en çok bir kez yazılır', dalga4(D4_FAVORILERI, { tepsiRozeti: 'isik' }), async (ortam) => {
  haKur(ortam.durum, ISIK_ACIK_VARLIKLARI);
  const { s, aboneId } = await canliYap(ortam, [
    durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'),
    durumNesnesi('light.smart_multicolor_bulb', 'Ampul', 'off'),
    durumNesnesi('switch.priz', 'Priz', 'on'),
  ]);
  ortam.ilerle(1500);
  assert.ok(rozetliMi(ortam.tepsi.simgeler.at(-1), 'isik', '1'));
  const resimSayisi = () => ortam.tepsi.simgeler.filter((x) => typeof x !== 'string').length;
  const once = resimSayisi();
  for (const durum of ['on', 'off', 'on']) {
    s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: 'light.smart_multicolor_bulb', to_state: durumNesnesi('light.smart_multicolor_bulb', 'Ampul', durum) } } } });
    ortam.ilerle(50);
  }
  assert.equal(resimSayisi(), once, 'saniye dolmadan simge yeniden yazılmadı');
  ortam.ilerle(1000);
  assert.equal(resimSayisi(), once + 1, 'pencere sonunda tek güncelleme');
  assert.ok(rozetliMi(ortam.tepsi.simgeler.at(-1), 'isik', '2'), 'son değer yazıldı');
});

ortamda('o-27: rozet "sensor": seçilen sensörün değeri çizilir ve tepsi ipucuna eklenir', dalga4(D4_FAVORILERI, { canliBaglanti: false, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' }, { ha: [...ISIK_ACIK_VARLIKLARI, SENSOR_SICAKLIK] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.ok(rozetliMi(ortam.tepsi.simgeler.at(-1), 'sensor', '22'));
  assert.match(ortam.tepsi.ipuclari.at(-1), /Salon sıcaklığı: 21,5 °C$/, 'etkin dil (tr) ondalık ayracı');
  assert.ok(Array.from(ortam.tepsi.ipuclari.at(-1)).length <= 120);
});

ortamda('o-27: tepsi ipucundaki sensör değeri hassasiyetle yuvarlanır ve dil değişince ayracı değişir (float artığı yazılmaz)', dalga4(D4_FAVORILERI, { canliBaglanti: false, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' }, { ha: [...ISIK_ACIK_VARLIKLARI, { ...SENSOR_SICAKLIK, state: '23.600000381469727', attributes: { ...SENSOR_SICAKLIK.attributes, suggested_display_precision: 1 } }] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.match(ortam.tepsi.ipuclari.at(-1), /Salon sıcaklığı: 23,6 °C$/);
  assert.doesNotMatch(ortam.tepsi.ipuclari.join('|'), /600000/);
  const sonuc = await ayarlarKaydet(ortam, { dil: 'en' });
  assert.equal(sonuc.ok, true);
  assert.match(ortam.tepsi.ipuclari.at(-1), /Salon sıcaklığı: 23\.6 °C$/, 'dil değişince ipucu yeni ayraçla yeniden yazılır');
});

ortamda('o-27 KAPI KURALI: sensörün HA\'daki adı kapıya dönmüşse rozet çizilmez ve ipucuna girmez', dalga4(D4_FAVORILERI, { canliBaglanti: false, tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' }, { ha: [...ISIK_ACIK_VARLIKLARI, { ...SENSOR_SICAKLIK, attributes: { ...SENSOR_SICAKLIK.attributes, friendly_name: 'Ön kapı sıcaklığı' } }] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.ok(ortam.tepsi.simgeler.every((s) => typeof s === 'string'), 'rozetli resim üretilmedi');
  assert.doesNotMatch(ortam.tepsi.ipuclari.join('|'), /kapı|21\.5/i);
});

ortamda('o-27: Ayarlar\'dan rozet açılıp kapatılır; kapı/kilit sensörü ya da sensör olmayan varlık seçimi reddedilir', dalga4(D4_FAVORILERI, { canliBaglanti: false }, { ha: [...ISIK_ACIK_VARLIKLARI, SENSOR_SICAKLIK] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.ok(ortam.tepsi.simgeler.every((s) => typeof s === 'string'));
  const acik = await ayarlarKaydet(ortam, { tepsiRozeti: 'isik' });
  assert.equal(acik.ok, true);
  assert.equal(ortam.ayarOku().tepsiRozeti, 'isik');
  ortam.ilerle(2000);
  assert.ok(rozetliMi(ortam.tepsi.simgeler.at(-1), 'isik', '2'));
  for (const kotu of ['lock.on_kapi', 'light.salon_lambasi', 'sensor.giris_kapisi', 'binary_sensor.hareket']) {
    const sonuc = await ayarlarKaydet(ortam, { tepsiRozeti: 'sensor', tepsiRozetSensoru: kotu });
    assert.equal(sonuc.uyarilar.length, 1, kotu);
    assert.equal(ortam.ayarOku().tepsiRozetSensoru, '', `${kotu} yazılmadı`);
  }
  const iyi = await ayarlarKaydet(ortam, { tepsiRozeti: 'sensor', tepsiRozetSensoru: 'sensor.salon_sicaklik' });
  assert.equal(iyi.ok, true);
  await ortam.akit();
  ortam.ilerle(2000);
  await ortam.akit();
  assert.ok(rozetliMi(ortam.tepsi.simgeler.at(-1), 'sensor', '22'));
  await ayarlarKaydet(ortam, { tepsiRozeti: 'kapali' });
  ortam.ilerle(2000);
  assert.equal(typeof ortam.tepsi.simgeler.at(-1), 'string', 'kapatınca dosya simgesine dönüldü');
});

ortamda('o-27 (çoklu): ek rozet sensörleri kaydedilir; en çok 2, tekrarsız, kapı/kilit/sensör olmayan elenir; dizi değilse mevcut değer korunur', dalga4(D4_FAVORILERI, { canliBaglanti: false }, { ha: [...ISIK_ACIK_VARLIKLARI, SENSOR_SICAKLIK] }), async (ortam) => {
  await ortam.akit();
  const sonuc = await ayarlarKaydet(ortam, {
    tepsiRozeti: 'sensor',
    tepsiRozetSensoru: 'sensor.salon_sicaklik',
    tepsiRozetSensorleri: ['sensor.pil', 'lock.on_kapi', 'sensor.pil', 'light.salon_lambasi', 'sensor.giris_kapisi', 'sensor.nem', 'sensor.fazla'],
  });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(ortam.ayarOku().tepsiRozetSensorleri, ['sensor.pil', 'sensor.nem'], 'geçersizler elenir, sınır 2');
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.deepEqual(ozet.tepsiRozetSensorleri, ['sensor.pil', 'sensor.nem'], 'Ayarlar sayfasına özetle gider');
  await ayarlarKaydet(ortam, { tepsiRozetSensorleri: 'sensor.pil' });
  assert.deepEqual(ortam.ayarOku().tepsiRozetSensorleri, ['sensor.pil', 'sensor.nem'], 'geçersiz tür: mevcut değer korunur');
  await ayarlarKaydet(ortam, { tepsiRozetSensorleri: [] });
  assert.deepEqual(ortam.ayarOku().tepsiRozetSensorleri, [], 'boş liste ek sensörleri temizler');
});

// --- o-33: masaüstü karoları ---

const MASAUSTU_HA = [...ISIK_ACIK_VARLIKLARI, SENSOR_SICAKLIK, durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown')];
const KARO_FAVORILERI = [...D4_FAVORILERI, { entity_id: 'sensor.salon_sicaklik', ad: 'Salon sıcaklığı' }, { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat' }];
const karoAyari = (karolar, ek = {}, secenek = {}) => dalga4(KARO_FAVORILERI, { canliBaglanti: false, masaustuKarolari: karolar, ...ek }, { ha: MASAUSTU_HA, ...secenek });
async function karolariAc(ortam) {
  await ortam.akit();
  ortam.ilerle(2500); // açılıştan 2 sn sonra karolar açılır
  await ortam.akit();
  return karoPencereleri(ortam);
}

ortamda('o-33: varsayılanda hiç karo penceresi yoktur', dalga4(KARO_FAVORILERI, { canliBaglanti: false }, { ha: MASAUSTU_HA }), async (ortam) => {
  assert.deepEqual(await karolariAc(ortam), []);
});

ortamda('o-33: sabitlenen favoriler açılıştan sonra küçük çerçevesiz pencereler olarak açılır; güvenli web tercihleri, odak çalınmaz', karoAyari(['light.salon_lambasi', 'sensor.salon_sicaklik']), async (ortam) => {
  assert.deepEqual(karoPencereleri(ortam), [], 'açılışta hemen değil, ana pencere ve tepsiden sonra');
  const karolar = await karolariAc(ortam);
  assert.equal(karolar.length, 2);
  for (const p of karolar) {
    assert.equal(p.secenekler.frame, false);
    assert.equal(p.secenekler.skipTaskbar, true);
    assert.equal(p.secenekler.alwaysOnTop, false);
    assert.equal(p.secenekler.webPreferences.sandbox, true);
    assert.equal(p.secenekler.webPreferences.contextIsolation, true);
    assert.equal(p.secenekler.webPreferences.nodeIntegration, false);
    assert.match(p.secenekler.webPreferences.preload, /preload-karo\.js$/);
    assert.equal(p.cagri.showInactive, 1);
    assert.equal(p.cagri.focus, 0);
    assert.equal(p.cagri.show, 0);
    assert.equal(p.odakta, false);
  }
  assert.deepEqual(karolar.map((p) => karoModeli(p)?.id), ['light.salon_lambasi', 'sensor.salon_sicaklik']);
  assert.equal(karoModeli(karolar[0]).durum, 'acik');
  assert.equal(karoModeli(karolar[1]).ozellik.deger, '21.5');
  assert.equal(karoModeli(karolar[1]).tiklanabilir, false, 'sensör salt okunur');
});

ortamda('o-33 KAPI KURALI: kapı/kilit/alarm/perde, favori olmayan, onaylı (yıkıcı) ve adı kapıya dönmüş varlık masaüstüne sabitlenmez', karoAyari(['lock.on_kapi', 'cover.garaj', 'light.favori_degil', 'button.pc_bilgisayari_kapat', 'switch.priz', 'light.salon_lambasi'], {}, { ha: MASAUSTU_HA.map((v) => (v.entity_id === 'light.salon_lambasi' ? { ...v, attributes: { friendly_name: 'Salon kapı lambası' } } : v)) }), async (ortam) => {
  const karolar = await karolariAc(ortam);
  assert.deepEqual(karolar.map((p) => karoModeli(p)?.id), ['switch.priz']);
  // ayar dosyasına zaten yalnız sabitlenebilir alanlar girer (lock/cover/button elenir); favori olmayan ışık dosyada kalır ama pencere açılmaz
  assert.deepEqual(ortam.ayarOku().masaustuKarolari, ['light.favori_degil', 'switch.priz', 'light.salon_lambasi']);
});

ortamda('o-33: karo tıklaması tek güvenli hattan geçer (varsayılan servis); sayfa kimlik/servis gönderemez; sensör ve olmayan karo çalıştırılamaz', karoAyari(['light.salon_lambasi', 'sensor.salon_sicaklik']), async (ortam) => {
  const [isik, sensor] = await karolariAc(ortam);
  const calistir = ortam.durum.ipc.get('karo:calistir');
  assert.deepEqual(postlar(ortam), []);
  const yanit = await calistir(karoOlayi(isik), { tur: 'tikla' });
  assert.equal(yanit.ok, true);
  assert.deepEqual(postlar(ortam).map((p) => new URL(p.url).pathname), ['/api/services/light/toggle']);
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde ?? postlar(ortam)[0].body), { entity_id: 'light.salon_lambasi' });
  for (const yuk of [{ tur: 'tikla', kimlik: 'lock.on_kapi' }, { kimlik: 'lock.on_kapi' }, { servis: 'unlock' }, { parlaklik: 40 }, null, 'tikla']) {
    assert.deepEqual(await calistir(karoOlayi(isik), yuk), { ok: false, tur: 'gecersiz' }, JSON.stringify(yuk));
  }
  assert.deepEqual(await calistir(karoOlayi(sensor), { tur: 'tikla' }), { ok: false, tur: 'gecersiz' });
  assert.equal(postlar(ortam).length, 1, 'yalnız ilk geçerli tıklama HA\'ya gitti');
  const uzak = { sender: isik.webContents, senderFrame: { url: 'https://ha.example.com/lovelace', parent: null } };
  assert.equal((await calistir(uzak, { tur: 'tikla' })).ok, false, 'karo sayfası dışından gelen istek reddedilir');
  const baska = { sender: ortam.pencere.webContents, senderFrame: { url: pathToFileURL(KARO_HTML).href, parent: null } };
  assert.equal((await calistir(baska, { tur: 'tikla' })).ok, false, 'başka pencere karo kanalını kullanamaz');
  assert.equal(postlar(ortam).length, 1);
});

ortamda('o-33: parlaklık ön ayarı yalnız favoride "parlaklık" açıksa çalışır (sabit liste: 25/50/100)', karoAyari(['light.salon_lambasi', 'light.smart_multicolor_bulb'], {}, {}), async (ortam) => {
  // salon_lambasi favorisinde parlaklık açık; ampul'de değil
  const ayarlar = ortam.ayarOku();
  assert.ok(ayarlar.favoriler.length > 0);
  const [salon, ampul] = await karolariAc(ortam);
  assert.deepEqual(karoModeli(ampul).parlaklikOnAyarlari, [], 'parlaklık kapalı favoride ön ayar sunulmaz');
  const calistir = ortam.durum.ipc.get('karo:calistir');
  assert.deepEqual(await calistir(karoOlayi(ampul), { parlaklik: 50 }), { ok: false, tur: 'gecersiz' });
  assert.equal(postlar(ortam).length, 0);
  assert.equal(karoModeli(salon).id, 'light.salon_lambasi');
});

ortamda('o-33: Ayarlar\'dan seçim değişince pencereler açılıp kapanır; kapı kimliği seçilemez ve seçim 6 ile sınırlıdır', karoAyari(['light.salon_lambasi']), async (ortam) => {
  const [ilk] = await karolariAc(ortam);
  assert.equal(karoModeli(ilk).id, 'light.salon_lambasi');
  const sonuc = await ayarlarKaydet(ortam, { masaustuKarolari: ['switch.priz', 'lock.on_kapi', 'cover.garaj'] });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(ortam.ayarOku().masaustuKarolari, ['switch.priz'], 'kapı kimlikleri ayara yazılmaz');
  await ortam.akit();
  assert.equal(ilk.yikik, true, 'seçimden çıkan karo kapandı');
  assert.deepEqual(karoPencereleri(ortam).map((p) => karoModeli(p)?.id), ['switch.priz']);
  const bos = await ayarlarKaydet(ortam, { masaustuKarolari: [] });
  assert.equal(bos.ok, true);
  assert.deepEqual(karoPencereleri(ortam), []);
  const cok = await ayarlarKaydet(ortam, { masaustuKarolari: ['light.a', 'light.b', 'light.c', 'light.d', 'light.e', 'light.f', 'light.g', 'light.h'] });
  assert.equal(cok.ok, true);
  assert.equal(ortam.ayarOku().masaustuKarolari.length, 6);
});

ortamda('o-33: × düğmesi sabitlemeyi ayardan kaldırır ve pencereyi hemen kapatır; pencereyi kapatan kullanıcı için de aynısı olur', karoAyari(['light.salon_lambasi', 'switch.priz']), async (ortam) => {
  const [isik, priz] = await karolariAc(ortam);
  ortam.durum.ipc.get('karo:kaldir')(karoOlayi(priz), 'light.salon_lambasi');
  assert.deepEqual(ortam.ayarOku().masaustuKarolari, ['light.salon_lambasi'], 'sayfanın gönderdiği kimlik yok sayıldı');
  assert.equal(priz.yikik, true);
  isik.destroy(); // Alt+F4
  assert.deepEqual(ortam.ayarOku().masaustuKarolari, []);
  ortam.ilerle(5000);
  await ortam.akit();
  assert.deepEqual(karoPencereleri(ortam), [], 'kendiliğinden geri gelmez');
});

ortamda('o-33: karolar uygulama çıkarken kapanır ve bekleyen konum yazılır; çıkışta "kullanıcı kapattı" sayılmaz (sabitleme korunur)', karoAyari(['light.salon_lambasi']), async (ortam) => {
  const [p] = await karolariAc(ortam);
  ortam.ilerle(900);
  p.setBounds({ x: 700, y: 300, width: 200, height: 130 });
  p.emit('move');
  ortam.app.emit('before-quit');
  assert.equal(p.yikik, true);
  assert.deepEqual(ortam.ayarOku().masaustuKarolari, ['light.salon_lambasi']);
  assert.deepEqual(ortam.ayarOku().masaustuKaroKonumlari, { 'light.salon_lambasi': { x: 700, y: 300, width: 200, height: 130 } });
});

ortamda('o-33: ayardaki konumda açılır; ekran sökülünce görünür alana, geri takılınca kayıtlı konuma döner; kayıt silinmez', karoAyari(['light.salon_lambasi'], { masaustuKaroKonumlari: { 'light.salon_lambasi': { x: 2000, y: 100, width: 176, height: 112 } } }, { ekranlar: IKI_EKRAN }), async (ortam) => {
  const [p] = await karolariAc(ortam);
  assert.deepEqual({ x: p.sinirlar.x, y: p.sinirlar.y }, { x: 2000, y: 100 });
  assert.ok(ortam.durum.ekranDinleyicileri['display-removed']?.length >= 1, 'ekran olayları dinleniyor');
  assert.ok(ortam.durum.ekranDinleyicileri['display-added']?.length >= 1);
  assert.ok(ortam.durum.ekranDinleyicileri['display-metrics-changed']?.length >= 1);
  ortam.durum.ekranlar = [EKRAN_1];
  for (const dinleyici of ortam.durum.ekranDinleyicileri['display-removed']) dinleyici();
  assert.ok(icinde(p.sinirlar, EKRAN_1.workArea), 'birincil ekranda');
  ortam.ilerle(1000);
  assert.deepEqual(ortam.ayarOku().masaustuKaroKonumlari?.['light.salon_lambasi'], { x: 2000, y: 100, width: 176, height: 112 }, 'kayıtlı konum silinmedi');
  ortam.durum.ekranlar = IKI_EKRAN;
  for (const dinleyici of ortam.durum.ekranDinleyicileri['display-added']) dinleyici();
  assert.deepEqual({ x: p.sinirlar.x, y: p.sinirlar.y }, { x: 2000, y: 100 });
});

ortamda('o-33: "karolar üstte" ayarı açık karolara hemen uygulanır', karoAyari(['light.salon_lambasi']), async (ortam) => {
  const [p] = await karolariAc(ortam);
  assert.equal(p.secenekler.alwaysOnTop, false);
  const sonuc = await ayarlarKaydet(ortam, { masaustuKaroUstte: true });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().masaustuKaroUstte, true);
  assert.deepEqual(p.ustCagrilari.at(-1), [true, undefined]);
  await ayarlarKaydet(ortam, { masaustuKaroUstte: false });
  assert.deepEqual(p.ustCagrilari.at(-1), [false, undefined]);
});

ortamda('o-33: favori silinince o favorinin karosu kapanır (favori olmayan sabitlenemez)', karoAyari(['light.salon_lambasi', 'switch.priz']), async (ortam) => {
  const [isik, priz] = await karolariAc(ortam);
  const olay = ayarlarOlayi(ortam);
  await ortam.durum.ipc.get('cihazlar:getir')(olay);
  const kaydet = ortam.durum.ipc.get('favoriler:kaydet');
  // kullanıcı Ayarlar'da prizin işaretini kaldırır: yalnız ışık seçili kalır
  const sonuc = await kaydet(olay, [{ entity_id: 'light.salon_lambasi' }]);
  assert.equal(sonuc.ok, true);
  await ortam.akit();
  assert.equal(isik.yikik, false);
  assert.equal(priz.yikik, true, 'favori olmaktan çıkan varlığın karosu kapandı');
});

// --- Ayarlar sayfası özeti ---

ortamda('Ayarlar özeti: bağlı ekran listesi, pencere/rozet/karo seçimleri ve makineye özgü konumlar HARİÇ alanlar (konum kayıtları gitmez)', { ekranlar: IKI_EKRAN, tohum: { panelOpaklik: 80, masaustuKarolari: ['light.a'], masaustuKaroKonumlari: { 'light.a': { x: 1, y: 2, width: 200, height: 100 } }, pencereKonumlari: { hizli: { x: 5, y: 6 } } } }, async (ortam) => {
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.deepEqual(ozet.ekranlar.map((e) => e.id), [1, 2]);
  assert.deepEqual(ozet.ekranlar[1], { id: 2, etiket: 'Ekran 2  ·  2560×1440', x: 1920, y: 0, genislik: 2560, yukseklik: 1440 });
  assert.equal(ozet.panelOpaklik, 80);
  assert.deepEqual(ozet.masaustuKarolari, ['light.a']);
  assert.equal(ozet.panelHerZamanUstte, false);
  assert.equal(ozet.pencereKonumu, 'imlec');
  assert.equal(ozet.tepsiRozeti, 'kapali');
  assert.equal('masaustuKaroKonumlari' in ozet, false);
  assert.equal('pencereKonumlari' in ozet, false);
  assert.doesNotMatch(JSON.stringify(ozet), new RegExp(TEST_ANAHTAR));
});

// ===========================================================================
// 1.4.0 bildirim grubu: bildirim merkezi (o-36), varlık uyarı kuralları (o-37), süre / bekleme / sessiz saatler (o-39)
// ===========================================================================

const SICAKLIK = 'sensor.salon_sicaklik';
const sicaklikDurumu = (deger) => ({ entity_id: SICAKLIK, state: String(deger), attributes: { friendly_name: 'Salon Sıcaklık', unit_of_measurement: '°C', device_class: 'temperature' } });
const SICAKLIK_KURALI = { id: 'u1', acik: true, varlik: SICAKLIK, kosul: { tur: 'esik', yon: 'ustunde', deger: 28 }, metin: '{ad} çok sıcak: {durum}', sure: 0, bekleme: 300, sessizSaatler: null, windows: false };
const ISIK_DURUMU = durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off');
/** Pil taraması kapalı (ayrı bir GET /api/states'tir), HA bildirim aboneliği açık; kuralları ve ek ayarı verir. */
const bildirimAyari = (ek = {}, secenek = {}) => dalga3([SALON], { bildirimPil: false, ...ek }, secenek);

/** Sahte saatin başlangıcındaki yerel dakika: sessiz saat aralıkları buna göre kurulur (testler birkaç dakikadan kısadır). */
const BASLANGIC_DAKIKASI = new Date(BASLANGIC_ZAMANI).getHours() * 60 + new Date(BASLANGIC_ZAMANI).getMinutes();
const saatMetni = (dakika) => {
  const d = ((dakika % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
};
const SESSIZ_SIMDI = { baslangic: saatMetni(BASLANGIC_DAKIKASI - 60), bitis: saatMetni(BASLANGIC_DAKIKASI + 60) };
const SESSIZ_SONRA = { baslangic: saatMetni(BASLANGIC_DAKIKASI + 120), bitis: saatMetni(BASLANGIC_DAKIKASI + 240) };

const haBildirimi = (kimlik, baslik, metin) => ({ notification_id: kimlik, title: baslik, message: metin, created_at: '2026-10-16T08:00:00+00:00' });
const haBildirimOlayi = (s, bildirimId, tur, bildirimler) => s.yayinla({ id: bildirimId, type: 'event', event: { type: tur, notifications: bildirimler } });
const durumOlayi = (s, aboneId, durum) => s.yayinla({ id: aboneId, type: 'event', event: { variables: { trigger: { platform: 'state', entity_id: durum.entity_id, to_state: durum } } } });

/** Canlı bağlantıyı kurar, persistent_notification aboneliğini onaylar ve ilk bildirim listesini verir. */
async function bildirimliCanli(ortam, ilkBildirimler = {}, durumlar = [ISIK_DURUMU]) {
  const { s, aboneId } = await canliYap(ortam, durumlar);
  const abone = s.gonderilen.find((m) => m.type === 'persistent_notification/subscribe');
  assert.ok(abone, 'bildirim aboneliği canlı bağlantıda kurulur');
  s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  haBildirimOlayi(s, abone.id, 'current', ilkBildirimler);
  await ortam.akit();
  return { s, aboneId, bildirimId: abone.id };
}

const panelBildirimi = (ortam) => yuzeyMesajlari(ortam, 'yuzey:durum').at(-1)?.bildirim;
const panelOgeleri = (ortam, kaynak) => (panelBildirimi(ortam)?.ogeler ?? []).filter((o) => o.kaynak === kaynak);
const bildirimKapatIpc = (ortam, anahtar, olay = yuzeyOlayi(ortam)) => ortam.durum.ipc.get('yuzey:bildirim-kapat')(olay, anahtar);
const kapatmaPostlari = (ortam) => postlar(ortam).filter((f) => f.url.endsWith('/api/services/persistent_notification/dismiss'));

/** Sahte olayı gönderir; deponun 50 ms'lik gruplaması ve panel yenilemesi için zamanı ilerletir. */
async function durumGonder(ortam, s, aboneId, deger) {
  durumOlayi(s, aboneId, sicaklikDurumu(deger));
  ortam.ilerle(100);
  await ortam.akit();
}

/** Canlı bağlantıyı koruyarak zamanı ilerletir: ping'lere pong verir (25 sn'de bir ping, 10 sn'de pong beklenir; tek büyük adım bağlantıyı koparırdı). */
const yanitlananPingler = new WeakSet();
async function canliIlerle(ortam, s, ms) {
  for (let kalan = ms; kalan > 0; kalan -= 9000) {
    ortam.ilerle(Math.min(kalan, 9000));
    for (const m of s.gonderilen) {
      if (m.type !== 'ping' || yanitlananPingler.has(m)) continue;
      yanitlananPingler.add(m);
      s.yayinla({ id: m.id, type: 'pong' });
    }
    await ortam.akit();
  }
}

ortamda('bildirim (o-36): HA kalıcı bildirimleri salt-okuma aboneliğiyle gelir; ilk liste sessizdir, sonradan gelen köşe bildirimi olur; panelde opak anahtarla görünür, kapı bildirimi yalnız sayılır', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, bildirimId } = await bildirimliCanli(ortam, { eski: haBildirimi('eski_yedekleme', 'Yedekleme', 'Yedekleme tamamlandı') });
  assert.deepEqual(s.gonderilen.find((m) => m.id === bildirimId), { id: bildirimId, type: 'persistent_notification/subscribe' });
  assert.deepEqual(koseMesajlari(ortam), [], 'açılıştaki mevcut bildirimler köşeye taşınmaz');
  assert.deepEqual(ortam.durum.bildirimler, [], 'Windows bildirimi çıkmaz');

  haBildirimOlayi(s, bildirimId, 'added', {
    yeni: haBildirimi('yeni_camasir', 'Çamaşır', 'Çamaşır makinesi bitti'),
    gizli: haBildirimi('gizli_garaj', 'Güvenlik', 'Garaj kapısı açık kaldı'),
  });
  await ortam.akit();
  const kose = koseMesajlari(ortam);
  assert.equal(kose.length, 1, 'yalnız süzgeçten geçen yeni bildirim köşeye çıkar');
  assert.equal(kose[0].tur, 'bilgi');
  assert.match(kose[0].metin, /Çamaşır makinesi bitti/);
  assert.doesNotMatch(JSON.stringify(kose), /[Gg]araj/);
  assert.deepEqual(ortam.durum.bildirimler, [], 'masaüstü yansıması köşe penceresidir, Windows bildirimi değil');

  await paneliAc(ortam);
  const model = panelBildirimi(ortam);
  assert.equal(model.ogeler.length, 2);
  assert.equal(model.sayi, 2);
  assert.equal(model.gizlenen, 1, 'kapı bildirimi panelde yok, yalnız sayılır');
  assert.deepEqual(model.ogeler.map((o) => o.kaynak), ['ha', 'ha']);
  for (const oge of model.ogeler) {
    assert.match(oge.anahtar, /^k[0-9a-f]{16}$/, 'anahtar opak: HA bildirim kimliği panele gitmez');
    assert.deepEqual(Object.keys(oge).sort(), ['anahtar', 'baslik', 'kaynak', 'metin', 'simge', 'zaman']);
  }
  assert.ok(model.ogeler.some((o) => o.metin === 'Çamaşır makinesi bitti'));
  const hepsi = JSON.stringify(yuzeyMesajlari(ortam, 'yuzey:durum'));
  assert.doesNotMatch(hepsi, /[Gg]araj|eski_yedekleme|yeni_camasir|gizli_garaj|notification_id/);
});

ortamda('bildirim (o-36): HA bildirimi paneldeki kapat ile korumalı yoldan kapanır (tek POST, yalnız notification_id); başarıda listeden çıkar', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, bildirimId } = await bildirimliCanli(ortam, { a: haBildirimi('yedek_tamam', 'Yedekleme', 'Yedekleme tamamlandı') });
  await paneliAc(ortam);
  const [oge] = panelOgeleri(ortam, 'ha');
  assert.ok(oge);

  const sonuc = await bildirimKapatIpc(ortam, oge.anahtar);
  assert.deepEqual(sonuc, { ok: true });
  const gonderilen = kapatmaPostlari(ortam);
  assert.equal(gonderilen.length, 1, 'tek POST');
  assert.equal(gonderilen[0].url, 'http://192.168.1.10:8123/api/services/persistent_notification/dismiss');
  assert.deepEqual(JSON.parse(gonderilen[0].govde), { notification_id: 'yedek_tamam' });
  assert.equal(gonderilen[0].basliklar.Authorization, `Bearer ${TEST_ANAHTAR}`);
  assert.doesNotMatch(ortam.gunlukOku(), new RegExp(TEST_ANAHTAR));
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(panelOgeleri(ortam, 'ha').length, 0, 'kapatılan bildirim şeritten çıktı');

  // HA da kaldırıldı olayını gönderse tutarlı kalır; tekrar kapatma isteği bilinmeyen anahtar olarak reddedilir.
  haBildirimOlayi(s, bildirimId, 'removed', { a: haBildirimi('yedek_tamam', 'Yedekleme', 'Yedekleme tamamlandı') });
  await ortam.akit();
  assert.equal((await bildirimKapatIpc(ortam, oge.anahtar)).ok, false);
  assert.equal(kapatmaPostlari(ortam).length, 1, 'ikinci istek HA\'ya gitmez');
});

ortamda('bildirim (o-36): kapatma yalnız açık hızlı panelden ve modeldeki opak anahtarla çalışır; yabancı gönderen, ham kimlik, bilinmeyen ve bozuk anahtar HİÇ POST üretmez', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await bildirimliCanli(ortam, { a: haBildirimi('yedek_tamam', 'Yedekleme', 'Yedekleme tamamlandı') });
  const kapali = await bildirimKapatIpc(ortam, 'k0000000000000000', { sender: { yok: true }, senderFrame: { url: 'https://evil.example/', parent: null } });
  assert.equal(kapali.ok, false, 'panel hiç açılmadıysa yuzey gönderen yok');

  await paneliAc(ortam);
  const [oge] = panelOgeleri(ortam, 'ha');
  assert.equal((await bildirimKapatIpc(ortam, oge.anahtar, ayarlarOlayi(ortam))).ok, false, 'Ayarlar penceresi paneli yerine kapatamaz');
  assert.equal((await bildirimKapatIpc(ortam, oge.anahtar, { sender: ortam.yuzeyPenceresi().webContents, senderFrame: { url: 'https://evil.example/', parent: null } })).ok, false, 'dış sayfadan gelen istek reddedilir');
  for (const kotu of ['yedek_tamam', 'persistent_notification.yedek_tamam', 'k0000000000000000', '', 'a'.repeat(41), 5, null, { anahtar: oge.anahtar }]) {
    assert.equal((await bildirimKapatIpc(ortam, kotu)).ok, false, `reddedilir: ${String(kotu).slice(0, 20)}`);
  }
  assert.equal(kapatmaPostlari(ortam).length, 0, 'hiçbir geçersiz istek HA\'ya gitmedi');
  assert.equal(panelOgeleri(ortam, 'ha').length, 1, 'bildirim yerinde');
});

ortamda('bildirim (o-36): kapatma HA tarafında başarısız olursa bildirim listede kalır ve kullanıcıya hata bildirilir; sınırsız yeniden deneme yok', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI, { postDurumu: 500 });
  await bildirimliCanli(ortam, { a: haBildirimi('yedek_tamam', 'Yedekleme', 'Yedekleme tamamlandı') });
  await paneliAc(ortam);
  const [oge] = panelOgeleri(ortam, 'ha');
  const sonuc = await bildirimKapatIpc(ortam, oge.anahtar);
  assert.equal(sonuc.ok, false);
  assert.equal(kapatmaPostlari(ortam).length, 1, 'başarısız POST yeniden denenmez');
  assert.equal(panelOgeleri(ortam, 'ha').length, 1, 'başarısız kapatma şeridi değiştirmez');
  assert.ok(koseMesajlari(ortam).some((m) => m.tur === 'hata'), 'köşede hata görünür');
});

ortamda('bildirim (o-36): bildirimKalici kapatılınca abonelik bırakılır ve panelde HA bildirimi kalmaz; masaüstü yansıması kapalıyken yeni bildirim yalnız panelde görünür', bildirimAyari({ bildirimMasaustu: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, bildirimId } = await bildirimliCanli(ortam, {});
  haBildirimOlayi(s, bildirimId, 'added', { n: haBildirimi('yeni_bildirim', 'Çamaşır', 'Çamaşır makinesi bitti') });
  await ortam.akit();
  assert.deepEqual(koseMesajlari(ortam), [], 'bildirimMasaustu kapalı: köşe penceresi çıkmaz');
  await paneliAc(ortam);
  assert.equal(panelOgeleri(ortam, 'ha').length, 1, 'panelde yine görünür');

  const sonuc = await ayarlarKaydet(ortam, { bildirimKalici: false });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().bildirimKalici, false);
  ortam.ilerle(100);
  await ortam.akit();
  assert.ok(s.gonderilen.some((m) => m.type === 'unsubscribe_events' && m.subscription === bildirimId), 'abonelik HA\'da bırakılır');
  assert.equal(panelOgeleri(ortam, 'ha').length, 0, 'HA bildirimleri panelden kalkar');
});

ortamda('bildirim: abonelik reddedilirse (yönetici değil) özellik sessizce kapalı kalır; panel ve favoriler çalışmaya devam eder', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ISIK_DURUMU]);
  const abone = s.gonderilen.find((m) => m.type === 'persistent_notification/subscribe');
  s.yayinla({ id: abone.id, type: 'result', success: false, error: { code: 'unauthorized', message: 'Unauthorized' } });
  await ortam.akit();
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).canliDurum, 'canli');
  await paneliAc(ortam);
  assert.deepEqual(panelBildirimi(ortam).ogeler, []);
  assert.equal(yuzeyMesajlari(ortam, 'yuzey:durum').at(-1).gruplar.flatMap((g) => g.karolar).length, 1, 'favori karosu yerinde');
  assert.doesNotMatch(ortam.gunlukOku(), new RegExp(TEST_ANAHTAR));
});

ortamda('bildirim (o-36): düşük pil taraması 10 dakikada bir GET /api/states okur; ilk tarama sessiz, kapı cihazının pili görünmez; eşik ayarı uygulanır', dalga3([SALON], { bildirimPil: true }), async (ortam) => {
  haKur(ortam.durum, [
    ...HA_VARLIKLARI,
    { entity_id: 'sensor.telefon_pil', state: '12', attributes: { friendly_name: 'Telefon Pil', device_class: 'battery', unit_of_measurement: '%' } },
    { entity_id: 'sensor.tablet_pil', state: '45', attributes: { friendly_name: 'Tablet Pil', device_class: 'battery', unit_of_measurement: '%' } },
    { entity_id: 'sensor.garaj_kapisi_pil', state: '3', attributes: { friendly_name: 'Garaj Kapısı Pil', device_class: 'battery', unit_of_measurement: '%' } },
  ]);
  await ortam.akit();
  ortam.ilerle(21_000); // açılıştan sonraki ilk tarama (20 sn)
  await ortam.akit();
  assert.ok(stateOkumalari(ortam) >= 1, 'tarama GET /api/states okur');
  assert.equal(postlar(ortam).length, 0, 'tarama HA\'ya hiçbir şey yazmaz');
  assert.deepEqual(koseMesajlari(ortam), [], 'ilk tarama sessiz');

  await paneliAc(ortam);
  const piller = panelOgeleri(ortam, 'pil');
  assert.equal(piller.length, 1);
  assert.match(piller[0].metin, /Telefon Pil/);
  assert.doesNotMatch(JSON.stringify(yuzeyMesajlari(ortam, 'yuzey:durum')), /[Gg]araj|Tablet/);

  // Eşik 50'ye çıkınca tablet de düşük sayılır; mevcutlar yeni sayılmadığından köşe bildirimi çıkmaz.
  assert.equal((await ayarlarKaydet(ortam, { bildirimPilEsigi: 50 })).ok, true);
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(panelOgeleri(ortam, 'pil').length, 2);
  assert.deepEqual(koseMesajlari(ortam), []);

  // Yerelde kapatılan pil bildirimi HA'ya hiçbir istek göndermeden kapanır ve geri gelmez.
  const [telefon] = panelOgeleri(ortam, 'pil').filter((o) => /Telefon/.test(o.metin));
  assert.deepEqual(await bildirimKapatIpc(ortam, telefon.anahtar), { ok: true });
  assert.equal(kapatmaPostlari(ortam).length, 0);
  assert.equal(postlar(ortam).length, 0);
  ortam.ilerle(11 * 60_000); // sonraki tarama: kapatılan yeniden eklenmez
  await ortam.akit();
  assert.deepEqual(panelOgeleri(ortam, 'pil').map((o) => /Tablet/.test(o.metin)), [true]);
});

ortamda('bildirim (o-36): pil ve güncelleme kapalıyken hiç /api/states taraması yapılmaz (varsayılan olarak yalnız pil açık)', dalga3([SALON], { bildirimPil: false, bildirimGuncelleme: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(25 * 60_000);
  await ortam.akit();
  assert.equal(stateOkumalari(ortam), 0);
});

ortamda('uyarı kuralı (o-37, o-39): eşik geçişi bildirim üretir; ilk görülen durum ve ısınma süresindeki değişim üretmez; koşul sürerken tekrar yok; bekleme dolmadan yeni geçiş bastırılır, dolunca bildirir', bildirimAyari({ uyariKurallari: [SICAKLIK_KURALI] }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, aboneId } = await bildirimliCanli(ortam, {}, [ISIK_DURUMU, sicaklikDurumu(30)]);
  assert.match(JSON.stringify(s.gonderilen.find((m) => m.id === aboneId)), /sensor\.salon_sicaklik/, 'kuralın varlığı canlı aboneliğe girdi');
  await paneliAc(ortam);
  assert.equal(panelOgeleri(ortam, 'uyari').length, 0, 'ilk görülen durum (30, eşiğin üstünde) yalnız taban çizgisidir');

  await durumGonder(ortam, s, aboneId, 20); // ısınma süresi (8 sn) içinde: yalnız taban güncellenir
  await durumGonder(ortam, s, aboneId, 31);
  assert.equal(panelOgeleri(ortam, 'uyari').length, 0, 'ısınma süresindeki geçiş uyarı üretmez');
  await durumGonder(ortam, s, aboneId, 20);
  ortam.ilerle(9000);
  await durumGonder(ortam, s, aboneId, 31);
  const uyarilar = () => panelOgeleri(ortam, 'uyari');
  assert.equal(uyarilar().length, 1, 'ısınma bitti: 20 -> 31 geçişi bildirir');
  assert.match(uyarilar()[0].metin, /^Salon Sıcaklık çok sıcak: 31/);
  const kose = koseMesajlari(ortam);
  assert.equal(kose.length, 1);
  assert.equal(kose[0].tur, 'bilgi');
  assert.match(kose[0].metin, /Salon Sıcaklık çok sıcak: 31/);
  assert.deepEqual(ortam.durum.bildirimler, [], 'windows kapalıyken Windows bildirimi çıkmaz');

  await durumGonder(ortam, s, aboneId, 33);
  assert.equal(uyarilar().length, 1, 'koşul sürerken tekrar bildirim yok');
  await durumGonder(ortam, s, aboneId, 20);
  await durumGonder(ortam, s, aboneId, 31);
  assert.equal(uyarilar().length, 1, 'bekleme (300 sn) dolmadan yeni geçiş bastırılır');
  await canliIlerle(ortam, s, 300_000);
  await durumGonder(ortam, s, aboneId, 20);
  await durumGonder(ortam, s, aboneId, 31);
  assert.equal(uyarilar().length, 2, 'bekleme dolunca yeni geçiş bildirir');
});

ortamda('uyarı kuralı (o-39): süre koşulu kesintisiz sürmeden bildirim çıkmaz; koşul süre dolmadan kalkarsa hiç çıkmaz', bildirimAyari({ uyariKurallari: [{ ...SICAKLIK_KURALI, sure: 120 }] }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, aboneId } = await bildirimliCanli(ortam, {}, [ISIK_DURUMU, sicaklikDurumu(20)]);
  await paneliAc(ortam);
  ortam.ilerle(9000);
  const uyarilar = () => panelOgeleri(ortam, 'uyari');

  await durumGonder(ortam, s, aboneId, 31);
  await canliIlerle(ortam, s, 60_000);
  await durumGonder(ortam, s, aboneId, 20); // süre dolmadan koşul kalktı
  await canliIlerle(ortam, s, 180_000);
  assert.equal(uyarilar().length, 0, 'koşul 120 sn sürmedi: bildirim yok');

  await durumGonder(ortam, s, aboneId, 31);
  await canliIlerle(ortam, s, 110_000);
  assert.equal(uyarilar().length, 0, 'süre dolmadı');
  await canliIlerle(ortam, s, 11_000);
  assert.equal(uyarilar().length, 1, 'koşul 120 sn kesintisiz sürdü: bildirir');
  assert.match(uyarilar()[0].metin, /Salon Sıcaklık çok sıcak: 31/);
});

ortamda('uyarı kuralı (o-39): sessiz saatte uyarı açılır pencere olmaz (köşe de, Windows da) ama panelin bildirim şeridine eklenir; sessiz saat dışında windows seçeneği Windows bildirimi de çıkarır', bildirimAyari({
  uyariKurallari: [
    { ...SICAKLIK_KURALI, id: 'u1', windows: true, sessizSaatler: SESSIZ_SIMDI },
    { ...SICAKLIK_KURALI, id: 'u2', varlik: 'sensor.mutfak_sicaklik', metin: 'Mutfak ısındı: {durum}', windows: true, sessizSaatler: SESSIZ_SONRA },
  ],
}), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const mutfak = (deger) => ({ entity_id: 'sensor.mutfak_sicaklik', state: String(deger), attributes: { friendly_name: 'Mutfak Sıcaklık', unit_of_measurement: '°C', device_class: 'temperature' } });
  const { s, aboneId } = await bildirimliCanli(ortam, {}, [ISIK_DURUMU, sicaklikDurumu(20), mutfak(20)]);
  await paneliAc(ortam);
  ortam.ilerle(9000);

  durumOlayi(s, aboneId, sicaklikDurumu(31));
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(panelOgeleri(ortam, 'uyari').length, 1, 'sessiz saatte bile panelin şeridinde');
  assert.deepEqual(koseMesajlari(ortam), [], 'sessiz saatte köşe penceresi çıkmaz');
  assert.deepEqual(ortam.durum.bildirimler, [], 'sessiz saatte Windows bildirimi de çıkmaz');

  durumOlayi(s, aboneId, mutfak(31));
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(panelOgeleri(ortam, 'uyari').length, 2);
  assert.equal(koseMesajlari(ortam).length, 1, 'sessiz saat dışında köşe bildirimi çıkar');
  assert.match(koseMesajlari(ortam)[0].metin, /Mutfak ısındı: 31 °C/);
  assert.equal(ortam.durum.bildirimler.length, 1, 'kural "Windows bildirimi de" dedi');
  assert.equal(ortam.durum.bildirimler[0].body, 'Mutfak ısındı: 31 °C');
});

ortamda('uyarı kuralı (o-37): "ulaşılamıyor" ve "tam durum" kuralları; köşe bildirimi kapalıyken uyarı yalnız panelde kalır', bildirimAyari({
  koseBildirimi: false,
  uyariKurallari: [
    { id: 'u1', acik: true, varlik: SICAKLIK, kosul: { tur: 'ulasilamiyor' }, metin: '', sure: 0, bekleme: 300, sessizSaatler: null, windows: false },
    { id: 'u2', acik: true, varlik: 'light.salon_lambasi', kosul: { tur: 'durum', deger: 'on' }, metin: '{ad} yandı', sure: 0, bekleme: 0, sessizSaatler: null, windows: false },
  ],
}), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, aboneId } = await bildirimliCanli(ortam, {}, [ISIK_DURUMU, sicaklikDurumu(20)]);
  await paneliAc(ortam);
  ortam.ilerle(9000);
  durumOlayi(s, aboneId, { ...sicaklikDurumu('unavailable') });
  durumOlayi(s, aboneId, durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'));
  ortam.ilerle(100);
  await ortam.akit();
  const metinler = panelOgeleri(ortam, 'uyari').map((o) => o.metin).sort();
  assert.equal(metinler.length, 2);
  assert.ok(metinler.includes('Salon Lambası yandı'));
  assert.ok(metinler.some((m) => /Salon Sıcaklık/.test(m) && /ulaşılamıyor/i.test(m)), `varsayılan cümle: ${metinler.join(' | ')}`);
  assert.deepEqual(koseMesajlari(ortam), [], 'koseBildirimi kapalı: köşe penceresi hiç çıkmaz');
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('uyarı kuralı (o-37, Kapı Kuralı): kapı/kilit/örtü varlıkları ve kapı sözcüklü adlar için kural kaydedilmez; geçerli kural kaydedilir ve izlenen kümeye girip canlı abonelik yenilenir', bildirimAyari(), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s, aboneId } = await bildirimliCanli(ortam, {}, [ISIK_DURUMU]);
  assert.doesNotMatch(JSON.stringify(s.gonderilen.find((m) => m.id === aboneId)), /sicaklik/);
  const kural = (id, varlik, ek = {}) => ({ id, acik: true, varlik, kosul: { tur: 'ulasilamiyor' }, metin: '', sure: 0, bekleme: 300, sessizSaatler: null, windows: false, ...ek });
  const sonuc = await ayarlarKaydet(ortam, {
    uyariKurallari: [
      kural('a1', 'lock.on_kapi'),
      kural('a2', 'cover.perde'),
      kural('a3', 'alarm_control_panel.ev'),
      kural('a4', 'sensor.garaj_kapisi_sicaklik'),
      kural('a5', 'binary_sensor.salon_sicaklik', { metin: 'Garaj kapısı açık' }),
      kural('a6', SICAKLIK),
    ],
  });
  assert.equal(sonuc.ok, true);
  const kayitli = ortam.ayarOku().uyariKurallari;
  assert.deepEqual(kayitli.map((k) => k.varlik), [SICAKLIK], 'yalnız süzgeçten geçen kural saklandı');
  assert.doesNotMatch(JSON.stringify(kayitli), /[Gg]araj|lock\.|cover\.|alarm/);

  // Yeni izlenen küme canlı aboneliğe girer (soket kapanmadan abonelik yenilenir).
  const yeniAbone = s.gonderilen.filter((m) => m.type === 'subscribe_trigger').at(-1);
  assert.notEqual(yeniAbone.id, aboneId, 'abonelik yeniden kuruldu');
  assert.match(JSON.stringify(yeniAbone), /sensor\.salon_sicaklik/);
  assert.doesNotMatch(JSON.stringify(yeniAbone), /lock\.|cover\.|alarm|garaj/);
});

ortamda('ayar yayımı: tek kayıtta sensör şeridi, üst kart ve hava varlığı birlikte değişince canlı abonelik BİR kez silinip yenilenir (alan başına değil)', dalga3([SALON], {}, { ha: HA_VARLIKLARI }), async (ortam) => {
  const { s } = await canliYap(ortam, [ISIK_DURUMU]);
  const sayi = (tur) => s.gonderilen.filter((m) => m.type === tur).length;
  const silmeOnce = sayi('unsubscribe_events');
  const aboneOnce = sayi('subscribe_trigger');
  const sonuc = await ayarlarKaydet(ortam, { sensorSeridi: [SICAKLIK], ustKart1: 'hava', havaVarligi: 'weather.ev' });
  assert.equal(sonuc.ok, true);
  assert.deepEqual([ortam.ayarOku().sensorSeridi, ortam.ayarOku().ustKart1, ortam.ayarOku().havaVarligi], [[SICAKLIK], 'hava', 'weather.ev'], 'üç alan da kaydedildi');
  assert.equal(sayi('unsubscribe_events') - silmeOnce, 1, 'tek abonelik silme');
  assert.equal(sayi('subscribe_trigger') - aboneOnce, 1, 'tek yeni trigger aboneliği');
  assert.match(JSON.stringify(s.gonderilen.filter((m) => m.type === 'subscribe_trigger').at(-1)), /sensor\.salon_sicaklik/);
});

ortamda('ayarlar (o-36, o-37): yeni bildirim ayarları varsayılanlarıyla gelir, kaydedilir ve geçersiz değer reddedilir (eski değer korunur)', undefined, async (ortam) => {
  const ilk = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.equal(ilk.ok, true);
  assert.deepEqual(
    [ilk.bildirimKalici, ilk.bildirimPil, ilk.bildirimGuncelleme, ilk.bildirimPilEsigi, ilk.bildirimMasaustu, ilk.uyariKurallari],
    [true, true, false, 20, true, []],
  );

  const sonuc = await ayarlarKaydet(ortam, { bildirimKalici: false, bildirimPil: false, bildirimGuncelleme: true, bildirimPilEsigi: 35, bildirimMasaustu: false });
  assert.equal(sonuc.ok, true);
  const kayit = ortam.ayarOku();
  assert.deepEqual(
    [kayit.bildirimKalici, kayit.bildirimPil, kayit.bildirimGuncelleme, kayit.bildirimPilEsigi, kayit.bildirimMasaustu],
    [false, false, true, 35, false],
  );
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam));
  assert.deepEqual([ozet.bildirimGuncelleme, ozet.bildirimPilEsigi, ozet.bildirimMasaustu], [true, 35, false]);

  const kotu = await ayarlarKaydet(ortam, { bildirimPilEsigi: 90, bildirimKalici: 'evet' });
  assert.equal(kotu.ok, true, 'ek alan sorunu diğer ayarların kaydını durdurmaz');
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'bildirimPilEsigi'));
  assert.equal(ortam.ayarOku().bildirimPilEsigi, 35, 'aralık dışı eşik reddedildi');
  assert.equal(ortam.ayarOku().bildirimKalici, false, 'mantıksal olmayan değer reddedildi');
});

ortamda('ayarlar (o-37): cihazlar listesi uyarı kurabilen varlıklara durum önerisi ve simge ekler; kilit/kapı/örtü ve kapı adlı varlıklar listede hiç yer almaz', { ...dalga3([SALON]) }, async (ortam) => {
  haKur(ortam.durum, [
    ...HA_VARLIKLARI,
    sicaklikDurumu(21),
    durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'),
    durumNesnesi('cover.perde', 'Salon Perde', 'open'),
    durumNesnesi('binary_sensor.garaj_hareket', 'Garaj Hareket', 'off'),
  ]);
  await ortam.akit();
  const sonuc = await ortam.durum.ipc.get('cihazlar:getir')(ayarlarOlayi(ortam));
  assert.equal(sonuc.ok, true);
  const liste = JSON.parse(JSON.stringify(sonuc.cihazlar));
  const sicaklik = liste.find((c) => c.entity_id === SICAKLIK);
  assert.equal(sicaklik.uyariUygun, true);
  assert.ok(Array.isArray(sicaklik.durumOnerileri));
  assert.equal(typeof sicaklik.uyariSimgesi, 'string');
  assert.ok(sicaklik.uyariSimgesi.length > 0);
  assert.deepEqual(liste.filter((c) => /^(lock|cover)\.|garaj/.test(c.entity_id)), [], 'kapı kuralı: bu varlıklar renderer ayar sayfasına hiç gitmez');
  assert.doesNotMatch(JSON.stringify(liste.map((c) => c.uyariSimgesi ?? '')), /🔒|🚪/);
});

ortamda('bildirim: yalnız uyarı kuralı olan (favorisiz) kullanıcıda canlı bağlantı yokken REST yedeği kural varlığını okur ve uyarı üretir', dalga3([], { bildirimPil: false, canliBaglanti: false, uyariKurallari: [SICAKLIK_KURALI] }), async (ortam) => {
  const varliklar = [sicaklikDurumu(20)];
  haKur(ortam.durum, varliklar);
  await ortam.akit();
  ortam.ilerle(70_000); // REST yedeği turu (60 sn)
  await ortam.akit();
  assert.ok(ortam.durum.fetchler.some((f) => f.url.endsWith('/api/states/sensor.salon_sicaklik')), 'kural varlığı REST ile okundu');
  await paneliAc(ortam);
  varliklar[0] = sicaklikDurumu(31);
  ortam.ilerle(70_000);
  await ortam.akit();
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(panelOgeleri(ortam, 'uyari').length, 1, 'REST ile gelen geçiş de uyarı üretir');
  assert.equal(postlar(ortam).length, 0, 'uyarı yolu HA\'ya hiçbir şey yazmaz');
});

// ===========================================================================
// 1.4.0 cihaz grubu: kamera anlık görüntüsü (o-48), otomasyon (o-49), perde (o-50), vana (o-59) — ana süreç bağlantıları
// ===========================================================================

/** Şema 6 tohumu: 1.4.0 ek alanları (kameraIzinleri...) ayar dosyasından ancak bu sürümde okunur. */
const cihazAyari = (favoriler, ek = {}, secenek = {}) => dalga3(favoriler, { semaSurumu: 6, ...ek }, { apiYaniti: kameraApiYaniti(CIHAZ_VARLIKLARI), ...secenek });
const JPEG_BAYTLARI = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const kameraNesnesi = (kimlik, ad, ek = {}) => ({ entity_id: kimlik, state: 'idle', attributes: { friendly_name: ad, ...ek } });
const CIHAZ_VARLIKLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off'),
  kameraNesnesi('camera.salon', 'Salon kamera'),
  kameraNesnesi('camera.bebek', 'Bebek odası'),
  kameraNesnesi('camera.on_kapi', 'Ön kapı kamerası'),
  kameraNesnesi('camera.zil', 'Zil'),
  { entity_id: 'cover.perde', state: 'open', attributes: { friendly_name: 'Salon perde', device_class: 'curtain', current_position: 40, supported_features: 15 } },
  { entity_id: 'cover.garaj', state: 'closed', attributes: { friendly_name: 'Depo', device_class: 'garage' } },
  durumNesnesi('valve.su', 'Bahçe suyu', 'open'),
  durumNesnesi('automation.gece', 'Gece modu', 'on'),
];

/** Sahte HA: haYanitiOlustur'a kamera görüntüsü yolunu ekler (yalnız GET /api/camera_proxy/camera.*). */
function kameraApiYaniti(varliklar) {
  const taban = haYanitiOlustur(varliklar);
  return (url, secenek) => {
    const yol = new URL(url).pathname;
    if (/^\/api\/camera_proxy\/camera\.[a-z0-9_]+$/.test(yol) && (secenek.method ?? 'GET') === 'GET') {
      return new Response(JPEG_BAYTLARI, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return taban(url, secenek);
  };
}
/** Çalışan ortamda HA'yı değiştirir (ör. bir kameranın adı HA'da sonradan değişti). */
function kameraHaKur(ortam, varliklar = CIHAZ_VARLIKLARI) {
  ortam.durum.apiYaniti = kameraApiYaniti(varliklar);
}
/** Açılıştaki durum okumaları (varlık başına tek GET) bitsin: kamera ve perde karoları canlı durum ister. */
const cihazHazir = async (ortam) => {
  for (let i = 0; i < 4; i += 1) {
    ortam.ilerle(250);
    await ortam.akit();
  }
};
const kameraIstekleri = (ortam) => ortam.durum.fetchler.filter((f) => new URL(f.url).pathname.startsWith('/api/camera_proxy/'));
const panelKamerasi = (ortam) => yuzeyMesajlari(ortam, 'yuzey:durum').at(-1)?.kamera ?? null;

ortamda('kamera: izin listesi boşken (varsayılan) panel modelinde kamera yok, görüntü isteği HA\'ya gitmez, yuzey:kamera "izinsiz" der', cihazAyari([SALON]), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.kamera, null);
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon'), { ok: false, tur: 'izinsiz' });
  assert.deepEqual(kameraIstekleri(ortam), []);
  assert.equal(panel.korumalar?.at(-1) ?? false, false, 'kamera izni yokken pencere korumasız (gereksiz kısıt yok)');
});

ortamda('kamera: onaylı kamera panelde görünür; görüntü korumalı GET ile (Authorization, yönlendirme yok) çekilir ve data: URL olarak döner; 5 sn içinde önbellekten', cihazAyari([SALON], { kameraIzinleri: ['camera.salon'] }), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const model = (await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model;
  assert.deepEqual(model.kamera, { liste: [{ id: 'camera.salon', etiket: 'Salon kamera', kullanilabilir: true }], bulanik: true, yenilemeSn: 0 });
  assert.doesNotMatch(JSON.stringify(model), /camera_proxy|token|entity_picture/);
  assert.equal(panel.korumalar.at(-1), true, 'kameraya izin verilince pencere ekran görüntüsünden gizlenir');

  const ilk = await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon');
  assert.equal(ilk.ok, true);
  assert.equal(ilk.onbellek, false);
  assert.match(ilk.veri, /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(ilk.veri.split(',')[1], 'base64').equals(Buffer.from(JPEG_BAYTLARI)), true);
  const istekler = kameraIstekleri(ortam);
  assert.equal(istekler.length, 1);
  assert.equal(istekler[0].url, 'http://192.168.1.10:8123/api/camera_proxy/camera.salon');
  assert.equal(istekler[0].yontem, 'GET');
  assert.equal(istekler[0].basliklar.Authorization, `Bearer ${TEST_ANAHTAR}`);

  ortam.ilerle(2000);
  const ikinci = await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon');
  assert.equal(ikinci.ok, true);
  assert.equal(ikinci.onbellek, true);
  assert.equal(ikinci.veri, ilk.veri);
  assert.equal(kameraIstekleri(ortam).length, 1, '5 sn içinde ikinci ağ isteği yok');
  ortam.ilerle(4000);
  assert.equal((await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon')).onbellek, false);
  assert.equal(kameraIstekleri(ortam).length, 2);
});

ortamda('kamera: izin listesinde olmayan kamera, kapı/zil kamerası ve kamera olmayan varlık için görüntü çekilmez; ayar dosyasına elle yazılmış kapı kamerası modelde de yoktur', cihazAyari([SALON], { kameraIzinleri: ['camera.salon', 'camera.on_kapi', 'camera.zil'] }), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.deepEqual((await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model.kamera.liste.map((k) => k.id), ['camera.salon']);
  for (const kimlik of ['camera.bebek', 'camera.on_kapi', 'camera.zil', 'light.salon_lambasi', 'cover.perde', '../etc', 'camera.salon/../../config']) {
    const r = await ortam.durum.ipc.get('yuzey:kamera')(olay, kimlik);
    assert.equal(r.ok, false, kimlik);
  }
  assert.deepEqual(kameraIstekleri(ortam), []);
});

ortamda('kamera: HA\'da onaylı kameranın adı sonradan kapı/zil olursa görüntü çekilmez ("yasak") ve panelden kalkar', cihazAyari([SALON], { kameraIzinleri: ['camera.salon'] }), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.equal((await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon')).ok, true);
  const adli = CIHAZ_VARLIKLARI.map((v) => (v.entity_id === 'camera.salon' ? kameraNesnesi('camera.salon', 'Ön kapı zili') : v));
  kameraHaKur(ortam, adli);
  ortam.ilerle(70_000); // yoklama (200 ms) ile durum yenilenir
  await ortam.akit();
  const r = await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon');
  assert.equal(r.ok, false);
  assert.equal(r.tur, 'yasak', 'kapı/zil adlı kamera güvenlik kuralıyla reddedilir (ağ ya da ortam hatasıyla değil)');
  assert.equal(kameraIstekleri(ortam).length, 1, 'yasaklandıktan sonra yeni ağ isteği yok');
});

ortamda('kamera: palet kipinde yuzey:kamera reddedilir (kamera yalnız hızlı panelde)', cihazAyari([SALON], { kameraIzinleri: ['camera.salon'] }), async (ortam) => {
  await cihazHazir(ortam);
  ortam.durum.kisayollar.get('Control+Alt+P')();
  await ortam.akit();
  const olay = yuzeyOlayi(ortam);
  assert.equal(yuzeyMesajlari(ortam, 'yuzey:goster').at(-1)?.mod, 'palet');
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon'), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(kameraIstekleri(ortam), []);
});

ortamda('kamera: yüzey dışı gönderen (başka sayfa, uzak sayfa, alt çerçeve) görüntü isteyemez', cihazAyari([SALON], { kameraIzinleri: ['camera.salon'] }), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const uzak = { sender: panel.webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baska = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const altCerceve = { sender: panel.webContents, senderFrame: { ...olay.senderFrame, parent: {} } };
  for (const kotu of [uzak, baska, altCerceve]) {
    assert.deepEqual(await ortam.durum.ipc.get('yuzey:kamera')(kotu, 'camera.salon'), { ok: false, hata: 'İzin yok.' });
  }
  assert.deepEqual(kameraIstekleri(ortam), []);
});

ortamda('kamera: panel kapanıp yeniden açılınca bellekteki kare silinmiştir (yeniden çekim), kapanmadan 5 sn içinde önbellek geçerlidir', cihazAyari([SALON], { kameraIzinleri: ['camera.salon'] }), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.equal((await ortam.durum.ipc.get('yuzey:kamera')(olay, 'camera.salon')).ok, true);
  ortam.durum.ipc.get('yuzey:kapat')(olay);
  ortam.ilerle(500);
  const yeniPanel = await paneliAc(ortam);
  const yeniOlay = yuzeyOlayi(ortam, yeniPanel);
  const r = await ortam.durum.ipc.get('yuzey:kamera')(yeniOlay, 'camera.salon');
  assert.equal(r.ok, true);
  assert.equal(r.onbellek, false, 'kare panel kapanınca silindi');
  assert.equal(kameraIstekleri(ortam).length, 2);
});

ortamda('cihaz listesi (Ayarlar): kameraAdaylari yalnız güvenli kameralar; kapı/zil kamerası hiç gelmez; kamera genel cihaz listesine girmez', cihazAyari([SALON]), async (ortam) => {
  await cihazHazir(ortam);
  const olay = ayarlarOlayi(ortam);
  const sonuc = await ortam.durum.ipc.get('cihazlar:getir')(olay);
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.kameraAdaylari.map((k) => k.entity_id).sort(), ['camera.bebek', 'camera.salon']);
  assert.doesNotMatch(JSON.stringify(sonuc), /on_kapi|camera\.zil|Ön kapı|camera_proxy/);
  assert.ok(sonuc.cihazlar.every((c) => !c.entity_id.startsWith('camera.')), 'kamera karo/favori adayı değildir');
});

ortamda('ayarlar:kaydet: kameraIzinleri doğrulanır (kapı kamerası ve başka alan düşer), kareler silinir, model ve koruma güncellenir; dışa aktarma dosyasında izin listesi yok', cihazAyari([SALON]), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const yuz = yuzeyOlayi(ortam, panel);
  assert.equal(panelKamerasi(ortam), null);
  const kaydet = await ayarlarKaydet(ortam, { kameraIzinleri: ['camera.salon', 'camera.on_kapi', 'light.salon_lambasi', 'camera.salon'], kameraBulanik: false, kameraYenilemeSn: 10 });
  assert.equal(kaydet.ok, true);
  await ortam.akit();
  const ayar = ortam.ayarOku();
  assert.deepEqual(ayar.kameraIzinleri, ['camera.salon']);
  assert.equal(ayar.kameraBulanik, false);
  assert.equal(ayar.kameraYenilemeSn, 10);
  const model = (await ortam.durum.ipc.get('yuzey:durum-al')(yuz)).model;
  assert.deepEqual(model.kamera, { liste: [{ id: 'camera.salon', etiket: 'Salon kamera', kullanilabilir: true }], bulanik: false, yenilemeSn: 10 });
  assert.equal(panel.korumalar.at(-1), true);
  // izin kaldırılınca bölüm ve koruma gider
  const kapat = await ayarlarKaydet(ortam, { kameraIzinleri: [] });
  assert.equal(kapat.ok, true);
  await ortam.akit();
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(yuz)).model.kamera, null);
  assert.equal(panel.korumalar.at(-1), false);
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:kamera')(yuz, 'camera.salon'), { ok: false, tur: 'izinsiz' });
});

ortamda('perde (o-50): perde favorisi "Perde" grubunda; açma tek POST; konum 0-100 sınırlı; garaj sınıflı cover favoriden çıkarılır ve hiçbir yüzeyden çalışmaz', cihazAyari([SALON, { entity_id: 'cover.perde', ad: 'Salon perde' }, { entity_id: 'cover.garaj', ad: 'Depo' }]), async (ortam) => {
  await cihazHazir(ortam);
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'cover.perde'], 'garaj sınıflı cover açılışta ayardan çıkarıldı');
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const model = (await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model;
  assert.deepEqual(model.gruplar.map((g) => [g.kod, g.karolar.map((k) => k.id)]), [['isik', ['light.salon_lambasi']], ['perde', ['cover.perde']]]);
  const perde = model.gruplar.find((g) => g.kod === 'perde').karolar[0];
  assert.deepEqual(perde.ozellik, { durum: 'open', konum: 40, sinif: 'curtain', destek: 15 });
  assert.equal(perde.sinif, 'zararsiz');
  assert.doesNotMatch(JSON.stringify(model), /garaj|Depo/i);

  const calistir = ortam.durum.ipc.get('yuzey:calistir');
  assert.equal((await calistir(olay, { kimlik: 'cover.perde', servis: 'open_cover' })).ok, true);
  ortam.ilerle(1000);
  assert.equal((await calistir(olay, { kimlik: 'cover.perde', servis: 'set_cover_position', veri: { position: 55 }, sonDeger: true })).ok, true);
  ortam.ilerle(1000);
  const gonderilen = postlar(ortam);
  assert.deepEqual(gonderilen.map((f) => new URL(f.url).pathname), ['/api/services/cover/open_cover', '/api/services/cover/set_cover_position']);
  assert.deepEqual(JSON.parse(gonderilen[0].govde), { entity_id: 'cover.perde' });
  assert.deepEqual(JSON.parse(gonderilen[1].govde), { entity_id: 'cover.perde', position: 55 });
  for (const yuk of [
    { kimlik: 'cover.perde', servis: 'set_cover_position', veri: { position: 140 } },
    { kimlik: 'cover.perde', servis: 'set_cover_position', veri: { position: 20.5 } },
    { kimlik: 'cover.perde', servis: 'toggle' },
    { kimlik: 'cover.garaj', servis: 'open_cover' },
  ]) {
    assert.equal((await calistir(olay, yuk)).ok, false, JSON.stringify(yuk));
  }
  assert.equal(postlar(ortam).length, 2, 'reddedilenlerde POST yok');
});

ortamda('vana (o-59) ve otomasyon (o-49): panelde YALNIZ ana süreçte doğrulanan basılı tutmayla çalışır; kendi "basili" iddiası ve onay:false etkisizdir', cihazAyari([SALON, { entity_id: 'valve.su', ad: 'Bahçe suyu', onay: false }, { entity_id: 'automation.gece', ad: 'Gece modu', onay: false }]), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const calistir = ortam.durum.ipc.get('yuzey:calistir');
  const basla = ortam.durum.ipc.get('yuzey:basili-basla');
  const model = (await ortam.durum.ipc.get('yuzey:durum-al')(olay)).model;
  const vana = model.gruplar.flatMap((g) => g.karolar).find((k) => k.id === 'valve.su');
  const oto = model.gruplar.flatMap((g) => g.karolar).find((k) => k.id === 'automation.gece');
  assert.equal(vana.sinif, 'yikici');
  assert.deepEqual(vana.onayliServisler, ['open_valve', 'close_valve']);
  assert.equal(oto.sinif, 'yikici');
  assert.deepEqual(oto.onayliServisler, ['trigger', 'turn_on', 'turn_off']);

  for (const yuk of [
    { kimlik: 'valve.su', servis: 'close_valve' },
    { kimlik: 'valve.su', servis: 'close_valve', basili: true },
    { kimlik: 'automation.gece', servis: 'trigger' },
    { kimlik: 'automation.gece', servis: 'trigger', basili: true },
  ]) {
    assert.equal((await calistir(olay, yuk)).tur, 'onay-gerekli', JSON.stringify(yuk));
  }
  assert.deepEqual(postlar(ortam), []);

  assert.deepEqual(await basla(olay, 'valve.su'), { ok: true });
  ortam.ilerle(900);
  assert.equal((await calistir(olay, { kimlik: 'valve.su', servis: 'close_valve', basili: true })).ok, true);
  assert.deepEqual(await basla(olay, 'automation.gece'), { ok: true });
  ortam.ilerle(900);
  assert.equal((await calistir(olay, { kimlik: 'automation.gece', servis: 'trigger', basili: true })).ok, true);
  const gonderilen = postlar(ortam);
  assert.deepEqual(gonderilen.map((f) => new URL(f.url).pathname), ['/api/services/valve/close_valve', '/api/services/automation/trigger']);
  assert.deepEqual(JSON.parse(gonderilen[0].govde), { entity_id: 'valve.su' });
  assert.deepEqual(JSON.parse(gonderilen[1].govde), { entity_id: 'automation.gece' });
  assert.equal((await calistir(olay, { kimlik: 'valve.su', servis: 'close_valve', basili: true })).tur, 'onay-gerekli', 'onay tek kullanımlık');
});

ortamda('vana ve otomasyon: palet dışında kısayol/komut satırı gibi yollardan (eylem yüzeyi) çalıştırılamaz', cihazAyari([SALON, { entity_id: 'valve.su', ad: 'Bahçe suyu' }, { entity_id: 'automation.gece', ad: 'Gece modu' }]), async (ortam) => {
  await cihazHazir(ortam);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  // renderer'ın gönderebileceği her şey panel/palet kaynağıdır; kaynak başka bir yüzey olamaz (kimlik + servis dışında alan yok)
  for (const yuk of [
    { kimlik: 'valve.su', servis: 'open_valve', kaynak: 'kisayol', onay: 'diyalog' },
    { kimlik: 'automation.gece', servis: 'turn_on', kaynak: 'komut-satiri', onay: 'basili' },
  ]) {
    const r = await ortam.durum.ipc.get('yuzey:calistir')(olay, yuk);
    assert.equal(r.ok, false, JSON.stringify(yuk));
  }
  assert.deepEqual(postlar(ortam), []);
});


// ===========================================================================
// Etkileşim grubu (1.4.0): o-20 tepsi orta tık / tekerlek, o-23 panel sabitleme, o-60 basılı tutunca göster,
// o-38 bağlantı bildirimi, o-43 yönetici anahtarı uyarısı
// ===========================================================================

const ETK_ORTA_TIK_METNI = 'Tepsi orta tıkı çalıştırılamadı';
const etkOrtaTikHatalari = (ortam) => ortam.durum.bildirimler.filter((b) => String(b.body).startsWith(ETK_ORTA_TIK_METNI));

ortamda('tepsi orta tık (o-20): ayardaki zararsız favori tek güvenli hattan tek POST ile çalışır; art arda basış tek tık sayılır, süre dolunca yeniden çalışır', dalga3([SALON, PC_KAPAT], { tepsiOrtaTik: 'light.salon_lambasi' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, 'tek POST');
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.equal(postlar(ortam)[0].basliklar.Authorization, `Bearer ${TEST_ANAHTAR}`, 'mevcut korumalı yoldan, anahtar yalnız başlıkta');
  ortam.tepsi.emit('middle-click');
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, 'art arda basışlar (700 ms içinde) tek tık sayılır: ışık titremez');
  ortam.ilerle(2000);
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2, 'süre dolunca yeni orta tık çalışır');
  assert.deepEqual(etkOrtaTikHatalari(ortam), []);
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'orta tık hiçbir pencere açmaz');
  assert.equal(ortam.durum.diyaloglar.length, 0, 'onay penceresi yok');
});

ortamda('tepsi orta tık (o-20): ayar boşsa (varsayılan) hiçbir şey olmaz; kısayol dışındaki hiçbir yolu açmaz', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal((await ayarOzeti(ortam)).tepsiOrtaTik, '');
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(etkOrtaTikHatalari(ortam), [], 'seçim yokken hata bildirimi de yok');
  assert.deepEqual(ortam.durum.bildirimler, []);
});

ortamda('tepsi orta tık (o-20): onaylı/yıkıcı, favori olmayan, kapı kimliği ve HA\'daki güncel adı kapı olan eylem ÇALIŞMAZ ve nedeni bildirilir', dalga3([SALON, PC_KAPAT, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }], { tepsiOrtaTik: 'button.pc_bilgisayari_kapat' }), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  // 1) yıkıcı (varsayılan onaylı) düğme
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.equal(etkOrtaTikHatalari(ortam).length, 1, 'neden söylenir');
  assert.equal(ortam.durum.diyaloglar.length, 0, 'orta tık onay penceresi AÇMAZ (onay sorarak yıkıcı eylem çalıştırılmaz)');
  // 2) kapı/kilit kimliği ayara hiç yazılamaz
  const sonuc = await ayarlarKaydet(ortam, { tepsiOrtaTik: 'lock.on_kapi' });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.uyarilar.map((u) => u.alan), ['tepsiOrtaTik'], 'kapı kimliği reddedilir ve uyarı verilir');
  assert.equal(ortam.ayarOku().tepsiOrtaTik, 'button.pc_bilgisayari_kapat', 'eski değer korunur');
  // 3) favori olmayan kimlik
  await ayarlarKaydet(ortam, { tepsiOrtaTik: 'light.favori_degil' });
  ortam.ilerle(2000);
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.equal(etkOrtaTikHatalari(ortam).length, 2);
  // 4) kullanıcı seçili favoriyi sonradan "onay iste" yaptı
  await ayarlarKaydet(ortam, { tepsiOrtaTik: 'light.salon_lambasi' });
  assert.equal((await ortam.durum.ipc.get('cihazlar:getir')(ayarlarOlayi(ortam))).ok, true);
  const kayit = await ortam.durum.ipc.get('favoriler:kaydet')(ayarlarOlayi(ortam), [{ entity_id: 'light.salon_lambasi', onay: true }, { entity_id: 'button.pc_bilgisayari_kapat' }]);
  assert.equal(kayit.ok, true);
  ortam.ilerle(2000);
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], 'onay isteyen favori orta tıkla çalışmaz');
  assert.equal(etkOrtaTikHatalari(ortam).length, 3);
});

ortamda('tepsi orta tık (o-20): HA\'daki GÜNCEL ad kapı/kilit sözcüğü taşıyorsa kayıtlı ad masum olsa da POST yok', dalga3([SALON], { tepsiOrtaTik: 'light.salon_lambasi' }), async (ortam) => {
  haKur(ortam.durum, [durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'), durumNesnesi('light.salon_lambasi', 'Giriş Kapısı Lambası', 'off')]);
  await ortam.akit();
  ortam.tepsi.emit('middle-click');
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('ayarlar özeti ve kaydı (o-20, o-23, o-60, o-38, o-43): yeni alanlar varsayılanlarla gelir, orta tık alanları yıkıcı/kapı alanı içermez, geçersiz değer eskisini korur', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const ozet = await ayarOzeti(ortam);
  assert.deepEqual(
    { t: ozet.karoTekerlegi, o: ozet.tepsiOrtaTik, s: ozet.panelSabit, b: ozet.kisayolBasiliTut, k: ozet.baglantiBildirimi, n: ozet.baglantiBildirimSn },
    { t: true, o: '', s: false, b: false, k: true, n: 60 },
  );
  assert.ok(ozet.ortaTikAlanlari.includes('light') && ozet.ortaTikAlanlari.includes('scene'));
  for (const yasak of ['valve', 'automation', 'camera', 'lock', 'alarm_control_panel', 'siren', 'cover', 'climate']) assert.equal(ozet.ortaTikAlanlari.includes(yasak), false, yasak);
  assert.equal(ozet.anahtarYonetici, null, 'canlı bağlantı yokken yönetici bilgisi bilinmiyor');

  const sonuc = await ayarlarKaydet(ortam, { kisayolBasiliTut: true, karoTekerlegi: false, baglantiBildirimi: false, baglantiBildirimSn: 120, tepsiOrtaTik: 'light.salon_lambasi' });
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.uyarilar, []);
  const kayitli = ortam.ayarOku();
  assert.deepEqual(
    { b: kayitli.kisayolBasiliTut, t: kayitli.karoTekerlegi, k: kayitli.baglantiBildirimi, n: kayitli.baglantiBildirimSn, o: kayitli.tepsiOrtaTik },
    { b: true, t: false, k: false, n: 120, o: 'light.salon_lambasi' },
  );
  assert.equal(kayitli.semaSurumu, 6, 'şema sürümü artmadı');

  const kotu = await ayarlarKaydet(ortam, { baglantiBildirimSn: 7, panelSabit: 'evet' });
  assert.equal(kotu.ok, true);
  assert.deepEqual(kotu.uyarilar.map((u) => u.alan).sort(), ['baglantiBildirimSn', 'panelSabit']);
  assert.equal(ortam.ayarOku().baglantiBildirimSn, 120, 'geçersiz değer eskisini korur');
  assert.equal(ortam.ayarOku().panelSabit, false);
});

// --- o-23: panel sabitleme -----------------------------------------------------------------------------------------------

ortamda('panel sabitleme (o-23): iğne düğmesi ayarı yazar; sabitliyken dışarı tıklamak kapatmaz, Esc / tepsi tıklaması kapatır; sabit çözülünce yine odak kaybında kapanır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster').at(-1).etkilesim, { tekerlek: true, sabit: false });
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:sabitle')(olay, true), { ok: true, sabit: true });
  assert.equal(ortam.ayarOku().panelSabit, true, 'ayar dosyasına yazıldı');
  assert.deepEqual(postlar(ortam), [], 'HA\'ya hiçbir şey gitmez');

  panel.odakKaybet(); // başka bir yere tıklandı
  ortam.ilerle(3000);
  assert.equal(panel.gorunur, true, 'sabitli panel dışarı tıklayınca KAPANMAZ');

  // tepsi simgesine tıklamak sabitli (odaksız) paneli kapatır
  ortam.ilerle(1000);
  ortam.tepsi.emit('click');
  assert.equal(panel.gorunur, false, 'tepsi tıklaması sabitli paneli kapatır');

  // yeniden açılınca sabit durumu sayfaya iletilir; Esc (renderer kapat) kapatır
  ortam.ilerle(5000);
  ortam.tepsi.emit('click');
  await ortam.akit();
  assert.equal(panel.gorunur, true);
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster').at(-1).etkilesim, { tekerlek: true, sabit: true });
  assert.equal((await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam, panel))).etkilesim.sabit, true);
  ortam.durum.ipc.get('yuzey:kapat')(yuzeyOlayi(ortam, panel));
  assert.equal(panel.gorunur, false, 'Esc sabitli paneli de kapatır');

  // sabit çözülünce sıradan davranış geri gelir
  ortam.ilerle(5000);
  ortam.tepsi.emit('click');
  await ortam.akit();
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:sabitle')(yuzeyOlayi(ortam, panel), false), { ok: true, sabit: false });
  assert.equal(ortam.ayarOku().panelSabit, false);
  panel.odakKaybet();
  ortam.ilerle(500);
  assert.equal(panel.gorunur, false, 'sabit değilken odak kaybında kapanır');
});

ortamda('panel sabitleme (o-23): palet sabitlenmez; yalnız yüzey sayfasından ve yalnız boolean kabul edilir; Ayarlar\'dan değişiklik açık panele anında iletilir', dalga3([SALON], { panelSabit: true }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const sabitle = ortam.durum.ipc.get('yuzey:sabitle');
  // palet: panelSabit açık olsa bile odak kaybında kapanır; iğne düğmesi çalışmaz
  ortam.durum.kisayollar.get('Control+Alt+P')();
  await ortam.akit();
  const palet = ortam.yuzeyPenceresi();
  assert.equal(palet.gorunur, true);
  assert.deepEqual(await sabitle(yuzeyOlayi(ortam, palet), false), { ok: false, tur: 'gecersiz' });
  assert.equal(ortam.ayarOku().panelSabit, true);
  palet.odakKaybet();
  ortam.ilerle(500);
  assert.equal(palet.gorunur, false, 'palet hiçbir zaman sabitlenmez');

  ortam.ilerle(2000);
  const panel = await paneliAc(ortam);
  const olay = yuzeyOlayi(ortam, panel);
  const uzak = { sender: panel.webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baska = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  for (const kotu of [uzak, baska]) assert.deepEqual(await sabitle(kotu, false), { ok: false, hata: 'İzin yok.' });
  for (const kotu of ['true', 1, 0, null, undefined, {}, [], 'false']) assert.deepEqual(await sabitle(olay, kotu), { ok: false, tur: 'gecersiz' }, JSON.stringify(kotu));
  assert.equal(ortam.ayarOku().panelSabit, true, 'reddedilen istekler ayarı değiştirmedi');

  // Ayarlar'dan tekerlek ve sabit değişince açık sayfa yuzey:etkilesim alır
  await ayarlarKaydet(ortam, { karoTekerlegi: false, panelSabit: false });
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:etkilesim').at(-1), { tekerlek: false, sabit: false });
  panel.odakKaybet();
  ortam.ilerle(500);
  assert.equal(panel.gorunur, false, 'sabit Ayarlar\'dan kaldırıldı: odak kaybında kapanır');
});

// --- o-60: basılı tutunca göster -----------------------------------------------------------------------------------------

ortamda('basılı tut (o-60): seçenek AÇIKKEN kısayolun tekrarları tuşun tutulduğunu gösterir; pencere tutulurken açık kalır, bırakılınca (tekrarlar kesilince) gizlenir', { tohum: { kisayolBasiliTut: true } }, async (ortam) => {
  const { durum, pencere, ilerle } = ortam;
  ilerle(400);
  const kisayol = durum.kisayollar.get('Control+Alt+H');
  tusBas(pencere, ctrlW); // pencere gizli başlar
  assert.equal(pencere.gorunur, false);
  kisayol(); // ilk basış: göster
  assert.equal(pencere.gorunur, true);
  ilerle(500); // Windows ilk tekrar gecikmesi
  for (let i = 0; i < 40; i += 1) {
    kisayol(); // ~30 Hz tekrar: tuş basılı
    ilerle(33);
  }
  assert.equal(pencere.gorunur, true, 'tuş tutulurken pencere açık');
  ilerle(300); // tuş bırakıldı: tekrar gelmiyor
  assert.equal(pencere.gorunur, false, 'bırakınca gizlenir');
  ilerle(2000);
  kisayol();
  assert.equal(pencere.gorunur, true, 'yeni basış yine gösterir');
  await ortam.akit();
});

ortamda('basılı tut (o-60): tekrar HİÇ gelmezse (kısa basış / sistem tekrar üretmiyor) pencere açık kalır ve ikinci basış kapatır — kısayol kilitlenmez', { tohum: { kisayolBasiliTut: true } }, async (ortam) => {
  const { durum, pencere, ilerle } = ortam;
  ilerle(400);
  const kisayol = durum.kisayollar.get('Control+Alt+H');
  tusBas(pencere, ctrlW);
  kisayol();
  assert.equal(pencere.gorunur, true);
  ilerle(3000); // tek basış, tekrar yok
  assert.equal(pencere.gorunur, true, 'tutulduğu anlaşılamadı: pencere açık kalır');
  pencere.odakta = true; // pencere odakta
  durum.odakli = pencere;
  kisayol();
  assert.equal(pencere.gorunur, false, 'ikinci basış kapatır (eski aç/kapa davranışı)');
});

ortamda('basılı tut (o-60): seçenek KAPALIYKEN (varsayılan) eski davranış: ilk basış gizler, tekrarlar yok sayılır, bırakınca pencereye dokunulmaz', undefined, async (ortam) => {
  const { durum, pencere, ilerle } = ortam;
  assert.equal(ortam.ayarOku().kisayolBasiliTut, false, 'varsayılan KAPALI');
  ilerle(400);
  const kisayol = durum.kisayollar.get('Control+Alt+H');
  kisayol();
  assert.equal(pencere.gorunur, false);
  for (let i = 0; i < 20; i += 1) {
    ilerle(33);
    kisayol();
  }
  ilerle(2000);
  assert.equal(pencere.gorunur, false);
  assert.equal(pencere.cagri.hide, 1);
  assert.equal(pencere.cagri.show, 1);
});

test('basılı tut (o-60): tuş dinleyicisi yok — main.js klavye kancası, yerel modül ya da ek bağımlılık kullanmaz', () => {
  const kaynak = fs.readFileSync(MAIN, 'utf8') + fs.readFileSync(path.join(KOK_DIZIN, 'src', 'lib', 'basili-tut.js'), 'utf8');
  assert.doesNotMatch(kaynak.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /uiohook|iohook|keyboardjs|ffi-napi|node-global-key-listener|GetAsyncKeyState|SetWindowsHookEx|robotjs/i);
});

// --- o-38: bağlantı bildirimi ---------------------------------------------------------------------------------------------

const etkBaglantiBildirimleri = (ortam) => ({
  koptu: ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr['bildirim.baglantiKoptu']),
  geldi: ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr['bildirim.baglantiGeldi']),
});
/** Yeni (henüz kapatılmamış) bir soket açılana dek zamanı ilerletir, sonra auth -> abonelik -> anlık görüntü adımlarını tamamlar. */
async function etkYenidenBaglan(ortam, durumlar) {
  const once = ortam.durum.soketler.length;
  for (let i = 0; i < 400 && (ortam.durum.soketler.length === once || ortam.durum.soketler.at(-1).kapatildi); i += 1) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  return canliYap(ortam, durumlar);
}
const ETK_ISIK = durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off');

ortamda('bağlantı bildirimi (o-38): kısa kesinti SESSİZ; ayardaki süreden uzun kesinti BİR "koptu", dönüşte BİR "geri geldi" bildirimi çıkarır', dalga3([SALON], { bildirimPil: false, baglantiBildirimSn: 30 }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ETK_ISIK]);
  assert.deepEqual(etkBaglantiBildirimleri(ortam), { koptu: [], geldi: [] }, 'açılışta bildirim yok');
  // 1) kısa kesinti: süre dolmadan geri gelir
  s.kopar();
  await ortam.akit();
  await etkYenidenBaglan(ortam, [ETK_ISIK]);
  ortam.ilerle(120_000);
  await ortam.akit();
  assert.deepEqual(etkBaglantiBildirimleri(ortam), { koptu: [], geldi: [] }, 'kısa kesinti bildirim üretmez');
  // 2) uzun kesinti: yeni bağlantı kurulamıyor
  const k = ortam.durum.soketler.at(-1);
  k.kopar();
  await ortam.akit();
  for (let i = 0; i < 45; i += 1) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  const kesintide = etkBaglantiBildirimleri(ortam);
  assert.equal(kesintide.koptu.length, 1, '30 sn aşılınca tek "koptu"');
  assert.equal(kesintide.geldi.length, 0);
  assert.ok(kesintide.koptu[0].title, 'bildirimin başlığı var');
  for (let i = 0; i < 120; i += 1) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  assert.equal(etkBaglantiBildirimleri(ortam).koptu.length, 1, 'kesinti sürerken tekrar bildirilmez');
  await etkYenidenBaglan(ortam, [ETK_ISIK]);
  const donunce = etkBaglantiBildirimleri(ortam);
  assert.equal(donunce.koptu.length, 1);
  assert.equal(donunce.geldi.length, 1, 'dönüşte tek "geri geldi"');
  assert.deepEqual(postlar(ortam), [], 'bildirim HA\'ya hiçbir şey göndermez');
  assert.deepEqual(disIstekleri(ortam), []);
  assert.doesNotMatch(JSON.stringify(ortam.durum.bildirimler), new RegExp(TEST_ANAHTAR));
});

ortamda('bağlantı bildirimi (o-38): ayarda kapalıysa uzun kesintide de bildirim çıkmaz', dalga3([SALON], { bildirimPil: false, baglantiBildirimi: false, baglantiBildirimSn: 15 }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ETK_ISIK]);
  s.kopar();
  await ortam.akit();
  for (let i = 0; i < 90; i += 1) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  await etkYenidenBaglan(ortam, [ETK_ISIK]);
  assert.deepEqual(etkBaglantiBildirimleri(ortam), { koptu: [], geldi: [] });
});

ortamda('bağlantı bildirimi (o-38): ilk bağlantı hiç kurulamazsa "koptu" çıkmaz (kopan bir şey yoktu)', dalga3([SALON], { bildirimPil: false, baglantiBildirimSn: 15 }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  for (let i = 0; i < 120; i += 1) {
    ortam.ilerle(1000);
    await ortam.akit();
  }
  assert.deepEqual(etkBaglantiBildirimleri(ortam), { koptu: [], geldi: [] });
});

// --- o-43: yönetici anahtarı uyarısı --------------------------------------------------------------------------------------

const ETK_KULLANICI = (yonetici) => ({ 'auth/current_user': { success: true, result: { id: 'abcdef0123456789', name: 'Gizli Kisi Adi', is_owner: yonetici, is_admin: yonetici, credentials: [], mfa_modules: [] } } });
const etkYoneticiIletileri = (ortam) => ortam.ayarlarPenceresi().webContents.mesajlar.filter((m) => m.kanal === 'ayarlar:anahtar-yonetici').map((m) => m.yuk);
const etkKullaniciKomutlari = (soket) => soket.gonderilen.filter((m) => m.type === 'auth/current_user');

ortamda('yönetici anahtarı (o-43): canlı bağlantıda Ayarlar açılınca TEK salt okunur komutla ölçülür; yönetici ise Ayarlar\'a ve tanılama raporuna işlenir, kullanıcı adı/kimliği hiçbir yere sızmaz', dalga3([SALON], { bildirimPil: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ETK_ISIK]);
  assert.equal(etkKullaniciKomutlari(s).length, 0, 'Ayarlar kapalıyken ölçüm yok (gereksiz trafik yok)');
  const ilk = await ayarOzeti(ortam);
  assert.equal(ilk.anahtarYonetici, null, 'özet beklemez: ilk yanıtta bilinmiyor');
  await odaKomutlariniYanitla(ortam, s, ETK_KULLANICI(true));
  assert.deepEqual(etkYoneticiIletileri(ortam), [{ anahtarYonetici: true }], 'Ayarlar sayfası yalnız boolean alır');
  assert.equal((await ayarOzeti(ortam)).anahtarYonetici, true);
  assert.equal(etkKullaniciKomutlari(s).length, 1, 'tek ölçüm; tekrar tekrar sorulmaz');
  const { metin } = await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam));
  assert.match(metin, /\nKey user: administrator \(a non-administrator user is recommended\)\n/);
  assert.match(metin, /Last successful contact:[^\n]*\nKey user:/);
  const sizinti = JSON.stringify([etkYoneticiIletileri(ortam), await ayarOzeti(ortam), metin, ortam.gunlukOku(), ortam.durum.bildirimler]);
  for (const gizli of ['Gizli Kisi Adi', 'abcdef0123456789', TEST_ANAHTAR]) assert.equal(sizinti.includes(gizli), false, `${gizli} sızdı`);
  assert.deepEqual(postlar(ortam), [], 'yalnız okuma: servis çağrısı yok');
  assert.equal(s.gonderilen.some((m) => m.type === 'call_service'), false);
});

ortamda('yönetici anahtarı (o-43): yönetici OLMAYAN kullanıcı "önerilen" olarak raporlanır; anahtar silinince bilgi unutulur ve Ayarlar bilgilendirilir', dalga3([SALON], { bildirimPil: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ETK_ISIK]);
  await ayarOzeti(ortam);
  await odaKomutlariniYanitla(ortam, s, ETK_KULLANICI(false));
  assert.deepEqual(etkYoneticiIletileri(ortam), [{ anahtarYonetici: false }]);
  assert.equal((await ayarOzeti(ortam)).anahtarYonetici, false);
  assert.match((await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam))).metin, /\nKey user: non-administrator \(recommended\)\n/);
  const silme = await ortam.durum.ipc.get('anahtar:sil')(ayarlarOlayi(ortam));
  assert.equal(silme.ok, true);
  assert.deepEqual(etkYoneticiIletileri(ortam).at(-1), { anahtarYonetici: null }, 'silinince Ayarlar uyarıyı kaldırır');
  assert.equal((await ayarOzeti(ortam)).anahtarYonetici, null);
  assert.match((await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam))).metin, /\nKey user: not applicable \(no key added\)\n/);
});

ortamda('yönetici anahtarı (o-43): yanıt gelmezse / beklenmeyen biçimde gelirse bilgi "bilinmiyor" kalır; uygulama düşmez ve uyarı gösterilmez', dalga3([SALON], { bildirimPil: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  const { s } = await canliYap(ortam, [ETK_ISIK]);
  await ayarOzeti(ortam);
  await odaKomutlariniYanitla(ortam, s, { 'auth/current_user': { success: true, result: { is_admin: 'evet', name: 'x' } } });
  assert.equal((await ayarOzeti(ortam)).anahtarYonetici, null, 'boolean olmayan değer yönetici sayılmaz');
  assert.deepEqual(etkYoneticiIletileri(ortam), []);
  assert.match((await ortam.durum.ipc.get('tanilama:getir')(ayarlarOlayi(ortam))).metin, /\nKey user: not checked\n/);
});

ortamda('yönetici anahtarı (o-43): canlı bağlantı yokken ölçüm yapılmaz ve HA\'ya hiçbir ek istek gitmez', dalga3([SALON], { canliBaglanti: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const once = ortam.durum.fetchler.length;
  const ozet = await ayarOzeti(ortam);
  await ortam.akit();
  assert.equal(ozet.anahtarYonetici, null);
  assert.equal(ortam.durum.soketler.length, 0);
  assert.equal(ortam.durum.fetchler.slice(once).filter((f) => /current_user/.test(f.url)).length, 0);
});

// ===========================================================================
// 1.4.0 dis grubu: dış tetikler (o-21 Jump List, o-47 PC olayları, o-54 evpaneli://) ana süreç bağlantıları
// ===========================================================================

const SALON_BAGLANTISI = `evpaneli://eylem?ad=${encodeURIComponent('Salon Lambası')}`;
const SALON_ACIK = durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on');
/** İkinci kopyadan dış istek: argv ve requestSingleInstanceLock ek verisi (gerçek ikinci kopyanın ikinciKopyaEki ile gönderdiği). */
function ikinciKopya(ortam, argv, ek) {
  ortam.app.emit('second-instance', {}, ['ev-paneli.exe', ...argv], 'C:\\', ek);
}

ortamda('dış tetikler (varsayılan KAPALI): bağlantı, Jump List / kısayol görevi ve PC olayları HİÇBİR şey çalıştırmaz; protokol kaydı yazılmaz', dalga3([SALON, PC_KAPAT]), async (ortam) => {
  haKur(ortam.durum, [HA_VARLIKLARI[0], SALON_ACIK]);
  await ortam.akit();
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI], { protokol: SALON_BAGLANTISI });
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=jumplist'], { eylem: 'Salon Lambası', kaynak: 'jumplist' });
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=kisayol'], { eylem: 'Salon Lambası', kaynak: 'kisayol-dosyasi' });
  for (const olay of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) ortam.guc.emit(olay);
  ortam.ilerle(6000);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.diyaloglar, [], 'izin iletişim kutusu da açılmaz');
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'panel açılmadı');
  assert.equal(ortam.durum.protokolCagrilari, undefined, 'evpaneli:// HKCU kaydı yazılmadı');
  assert.ok((ortam.durum.jumpListler ?? []).every((p) => p === null), 'Jump List Windows varsayılanında');
  assert.deepEqual(ortam.ayarOku().tetikProtokolIzinleri ?? [], []);
});

ortamda('evpaneli:// (o-54): bağlantı başka komutla gelirse HİÇBİRİ çalışmaz; bozuk bağlantı ve geçersiz --kaynak bildirilir', dalga3([SALON, PC_KAPAT], { tetikProtokol: true, tetikJumpList: true }), async (ortam) => {
  haKur(ortam.durum, [HA_VARLIKLARI[0], SALON_ACIK]);
  await ortam.akit();
  ikinciKopya(ortam, [SALON_BAGLANTISI, '--eylem=Salon Lambası'], { protokol: SALON_BAGLANTISI, eylem: 'Salon Lambası' });
  await ortam.akit();
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI, '--goster']);
  await ortam.akit();
  ikinciKopya(ortam, ['--', 'evpaneli://eylem?ad=Salon%20Lamb%C4%B1s%C4%B1&kimlik=light.salon_lambasi']);
  await ortam.akit();
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=panel']);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.diyaloglar, []);
  assert.equal(ortam.pencere.gorunur, true, 'pencere komutu da uygulanmadı (gizlenmedi / değişmedi)');
  const metinler = ortam.durum.bildirimler.map((b) => b.body);
  assert.equal(metinler.length, 4);
  assert.match(metinler[0], /hiçbiri çalıştırılmadı/);
  assert.match(metinler[1], /hiçbiri çalıştırılmadı/);
  assert.doesNotMatch(metinler.join('\n'), /light\.|evpaneli:/, 'bildirimde bağlantı ya da kimlik yok');
  assert.doesNotMatch(ortam.gunlukOku(), /Salon Lamb|evpaneli:\/\/eylem/, 'bağlantı metni ve favori adı günlüğe yazılmaz');
});

ortamda('evpaneli:// (o-54): açıkken HKCU kaydı yazılır; ilk bağlantıda panelde izin sorulur: Reddet çalıştırmaz, Her zaman bir kez yazılır ve sonra sorulmaz', dalga3([SALON, PC_KAPAT], { tetikProtokol: true }), async (ortam) => {
  haKur(ortam.durum, [HA_VARLIKLARI[0], SALON_ACIK]);
  await ortam.akit();
  const kayit = ortam.durum.protokolCagrilari?.[0];
  assert.ok(kayit, 'protokol kaydı yazıldı');
  assert.equal(kayit[0], 'kaydet');
  assert.equal(kayit[1], 'evpaneli');
  assert.equal(kayit.at(-1).at(-1), '--', 'bağlantı Chromium seçeneği olarak okunamaz');

  const soruAl = async () => (await ortam.durum.ipc.get('yuzey:dis-onay-al')(yuzeyOlayi(ortam))).soru;
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI], { protokol: SALON_BAGLANTISI });
  await ortam.akit();
  assert.equal(ortam.yuzeyPenceresi()?.gorunur, true, 'soru hızlı panelde gösterilir');
  let soru = await soruAl();
  assert.equal(soru.ad, 'Salon Lambası');
  assert.equal(typeof soru.bilet, 'string');
  assert.doesNotMatch(JSON.stringify(soru), /light\./, 'renderer kimlik görmez');
  // Yabancı gönderen soruyu okuyamaz ve yanıtlayamaz
  const yabanci = { sender: ortam.pencere.webContents, senderFrame: { url: 'https://ornek.example/', parent: null } };
  assert.equal((await ortam.durum.ipc.get('yuzey:dis-onay-al')(yabanci)).ok, false);
  assert.equal((await ortam.durum.ipc.get('yuzey:dis-onay-yanit')(yabanci, soru.bilet, 'herZaman')).ok, false);
  assert.equal((await ortam.durum.ipc.get('yuzey:dis-onay-yanit')(yuzeyOlayi(ortam), soru.bilet, 'reddet')).ok, true);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], 'Reddet: istek yok');
  assert.deepEqual(ortam.ayarOku().tetikProtokolIzinleri ?? [], []);

  ortam.ilerle(2000);
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI], { protokol: SALON_BAGLANTISI });
  await ortam.akit();
  soru = await soruAl();
  assert.equal((await ortam.durum.ipc.get('yuzey:dis-onay-yanit')(yuzeyOlayi(ortam), soru.bilet, 'herZaman')).ok, false, 'panel açılır açılmaz izin verilemez');
  ortam.ilerle(700);
  assert.equal((await ortam.durum.ipc.get('yuzey:dis-onay-yanit')(yuzeyOlayi(ortam), soru.bilet, 'herZaman')).ok, true);
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  assert.deepEqual(ortam.ayarOku().tetikProtokolIzinleri, ['light.salon_lambasi']);

  ortam.ilerle(2000);
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI], { protokol: SALON_BAGLANTISI });
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2, 'izinli favori sormadan çalışır');
  assert.equal(await soruAl(), null);

  // Seçenek kapanınca kayıt (bizimse) kaldırılır ve bağlantı çalışmaz
  const sonuc = await ayarlarKaydet(ortam, { tetikProtokol: false });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.durum.protokolCagrilari.at(-1)[0], 'kaldir');
  assert.deepEqual(ortam.ayarOku().tetikProtokolIzinleri, ['light.salon_lambasi'], 'Ayarlar kaydı ana sürecin yazdığı izinleri ezmez');
  ortam.ilerle(2000);
  ikinciKopya(ortam, ['--', SALON_BAGLANTISI], { protokol: SALON_BAGLANTISI });
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2);
});

ortamda('evpaneli:// (o-54): yıkıcı ve kapı favorileri bağlantıyla hiç çalışmaz, izin bile sorulmaz', dalga3([SALON, PC_KAPAT, { entity_id: 'lock.on_kapi', ad: 'Ön Kapı' }], { tetikProtokol: true, tetikProtokolIzinleri: ['button.pc_bilgisayari_kapat'] }), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  for (const ad of ['Bilgisayarı Kapat', 'PC kapat', 'Ön Kapı', 'light.salon_lambasi']) {
    const b = `evpaneli://eylem?ad=${encodeURIComponent(ad)}`;
    ikinciKopya(ortam, ['--', b], { protokol: b });
    await ortam.akit();
    ortam.ilerle(2000);
  }
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(ortam.durum.diyaloglar, []);
  assert.equal(await (async () => (await ortam.durum.ipc.get('yuzey:dis-onay-al')(yuzeyOlayi(ortam)))?.soru ?? null)(), null);
});

ortamda('Jump List (o-21): açıkken yalnız zararsız favoriler görev olur; görev --kaynak=jumplist ile kapıdan geçer; masaüstü seçeneği kapalıyken kısayol görevi çalışmaz', dalga3([SALON, PC_KAPAT], { tetikJumpList: true }), async (ortam) => {
  haKur(ortam.durum, [HA_VARLIKLARI[0], SALON_ACIK]);
  await ortam.akit();
  ortam.ilerle(4000);
  await ortam.akit();
  const plan = ortam.durum.jumpListler.at(-1);
  assert.ok(Array.isArray(plan), 'Jump List yazıldı');
  const gorevler = plan[0].items;
  assert.deepEqual(gorevler.map((g) => g.title), ['Salon Lambası'], 'yıkıcı favori (PC kapat) görev olmaz');
  assert.match(gorevler[0].args, /--eylem="Salon Lambası" --kaynak=jumplist$/);
  assert.doesNotMatch(JSON.stringify(plan), /light\./, 'görev kimlik taşımaz');

  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=jumplist'], { eylem: 'Salon Lambası', kaynak: 'jumplist' });
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
  ortam.ilerle(2000);
  ikinciKopya(ortam, ['--eylem=Bilgisayarı Kapat', '--kaynak=jumplist'], { eylem: 'Bilgisayarı Kapat', kaynak: 'jumplist' });
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=kisayol'], { eylem: 'Salon Lambası', kaynak: 'kisayol-dosyasi' });
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, 'yıkıcı favori ve kapalı kısayol kaynağı çalışmaz');
  assert.deepEqual(ortam.durum.diyaloglar, [], 'onay penceresi de açılmaz');

  // Seçenek kapanınca Windows varsayılan listesine dönülür
  await ayarlarKaydet(ortam, { tetikJumpList: false });
  assert.equal(ortam.durum.jumpListler.at(-1), null);
});

ortamda('PC olayları (o-47): kilitte kapat kuralı çalışır ve ilk kullanım bir kez yazılır; aç kuralı "aç" izni olmadan çalışmaz; kapı kuralı kaydedilmez', dalga3([SALON], {
  tetikPcOlaylari: true,
  tetikPcKurallari: [
    { olay: 'kilit', kimlik: 'light.salon_lambasi', islem: 'kapat' },
    { olay: 'kilitAcildi', kimlik: 'light.salon_lambasi', islem: 'ac' },
    { olay: 'kilit', kimlik: 'lock.on_kapi', islem: 'kapat' },
  ],
}), async (ortam) => {
  haKur(ortam.durum, [SALON_ACIK, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  assert.deepEqual(ortam.ayarOku().tetikPcKurallari.map((k) => k.kimlik), ['light.salon_lambasi', 'light.salon_lambasi'], 'kapı kuralı ayardan düşer');
  ortam.guc.emit('lock-screen');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/turn_off');
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: 'light.salon_lambasi' });
  assert.equal(ortam.ayarOku().tetikPcUyarisi, true, 'ilk kullanım uyarısı bir kez');
  ortam.guc.emit('unlock-screen');
  ortam.ilerle(2000);
  await ortam.akit();
  assert.equal(postlar(ortam).length, 1, 'tetikPcAcma kapalı: aç kuralı çalışmaz');
  assert.deepEqual(ortam.durum.diyaloglar, []);
});

ortamda('Ayarlar > Dış tetikler: dis:* kanalları yalnız Ayarlar penceresinden; durum jeton taşımaz, jeton yalnız panoya; bağlantı favori adı taşır', dalga3([SALON, PC_KAPAT], { tetikMasaustu: true }), async (ortam) => {
  haKur(ortam.durum, [HA_VARLIKLARI[0], SALON_ACIK]);
  await ortam.akit();
  const yabanci = { sender: ortam.pencere.webContents, senderFrame: { url: 'https://ornek.example/', parent: null } };
  const kanallar = ['dis:durum', 'dis:kisayol-olustur', 'dis:baglanti-kopyala', 'dis:jeton-kopyala', 'dis:jeton-yenile', 'dis:izin-kaldir'];
  for (const kanal of kanallar) {
    assert.equal(typeof ortam.durum.ipc.get(kanal), 'function', kanal);
    assert.equal((await ortam.durum.ipc.get(kanal)(yabanci, 'light.salon_lambasi')).ok, false, `${kanal} yabancı gönderen`);
  }
  assert.deepEqual(ortam.durum.pano, []);
  const olay = ayarlarOlayi(ortam);
  const durum = await ortam.durum.ipc.get('dis:durum')(olay);
  assert.equal(durum.ok, true);
  assert.deepEqual(durum.uygunlar.map((u) => u.ad), ['Salon Lambası'], 'yıkıcı favori listelenmez');
  assert.equal(durum.api.calisiyor, false, 'yerel API varsayılan kapalı');
  assert.equal((await ortam.durum.ipc.get('dis:jeton-kopyala')(olay)).ok, true);
  const jeton = ortam.durum.pano.at(-1);
  assert.match(jeton, /^[A-Za-z0-9_-]{32,}$/);
  const sonra = await ortam.durum.ipc.get('dis:durum')(olay);
  assert.equal(sonra.api.jetonVar, true);
  assert.doesNotMatch(JSON.stringify(sonra), new RegExp(jeton), 'durum jetonu taşımaz');
  assert.doesNotMatch(fs.readFileSync(path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json'), 'utf8'), new RegExp(jeton), 'jeton ayar dosyasına girmez');
  assert.doesNotMatch(ortam.gunlukOku(), new RegExp(jeton), 'jeton günlüğe girmez');
  assert.ok(fs.existsSync(path.join(ortam.durum.yollar.get('userData'), 'yerel-api-jetonu.dat')), 'jeton safeStorage dosyasında');
  assert.equal((await ortam.durum.ipc.get('dis:baglanti-kopyala')(olay, 'light.salon_lambasi')).ok, true);
  assert.equal(ortam.durum.pano.at(-1), SALON_BAGLANTISI);
  assert.equal((await ortam.durum.ipc.get('dis:baglanti-kopyala')(olay, 'button.pc_bilgisayari_kapat')).ok, false, 'yıkıcı favori bağlantısı yok');
  assert.equal((await ortam.durum.ipc.get('dis:kisayol-olustur')(olay, 'button.pc_bilgisayari_kapat')).ok, false);
});

ortamda('Jump List (o-21): uygulama görevle AÇILIRSA pencere göstermeden bir kez çalışır (eylem ikinci kez komut satırı yolundan geçmez)', dalga3([SALON], { tetikJumpList: true }, { ha: [SALON_ACIK], acilisArgv: ['--eylem=Salon Lambası', '--kaynak=jumplist'] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(1000);
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false, 'gizli başlar');
  assert.equal(postlar(ortam).length, 1);
  assert.equal(postlar(ortam)[0].url, 'http://192.168.1.10:8123/api/services/light/toggle');
});

ortamda('evpaneli:// (o-54): uygulama bağlantıyla AÇILIRSA gizli başlar; bağlantının yanına komut eklenmişse hiçbiri çalışmaz, izin de sorulmaz', dalga3([SALON], { tetikProtokol: true }, { ha: [SALON_ACIK], acilisArgv: ['--', SALON_BAGLANTISI, '--eylem=Salon Lambası'] }), async (ortam) => {
  await ortam.akit();
  ortam.ilerle(1000);
  await ortam.akit();
  assert.equal(ortam.pencere.gorunur, false);
  assert.deepEqual(postlar(ortam), [], 'çakışma: ne bağlantı ne --eylem çalıştı');
  assert.equal(ortam.yuzeyPenceresi()?.gorunur ?? false, false, 'izin sorulmadı');
  assert.match(ortam.durum.bildirimler.map((b) => b.body).join('\n'), /hiçbiri çalıştırılmadı/);
});

ortamda('dış tetikler: erişim anahtarı yoksa Jump List görevi HA\'ya hiç gitmez ve kullanıcıya söylenir', dalga3([SALON], { tetikJumpList: true }, { anahtar: false }), async (ortam) => {
  haKur(ortam.durum, [SALON_ACIK]);
  await ortam.akit();
  const once = ortam.durum.fetchler.length;
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=jumplist'], { eylem: 'Salon Lambası', kaynak: 'jumplist' });
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  assert.equal(ortam.durum.fetchler.length, once, 'HA\'ya hiçbir istek (okuma da) gitmedi');
  assert.equal(ortam.durum.bildirimler.length, 1);
  assert.match(ortam.durum.bildirimler[0].body, /erişim anahtarı gerekli/);
});

// --- mobil bildirimler (o-61) ----------------------------------------------------------------
// Sahte HA: kayıt ucu (POST /api/mobile_app/registrations) ve webhook (POST /api/webhook/<kimlik>) bellek içi; sahte WebSocket itme kanalını taklit eder.
// Gerçek HA, gerçek ağ, gerçek webhook kimliği ve gerçek safeStorage yok.

const MOBIL_WEBHOOK = 'fedcba9876543210fedcba9876543210'; // sahte kimlik
const ITME_HTML_YOLU = path.join(KOK_DIZIN, 'src', 'itme-kart.html');
const mobilHa = ({ kayit = null, webhook = null } = {}) => {
  const temel = haYanitiOlustur(HA_VARLIKLARI);
  return (url, secenek) => {
    const yol = new URL(url).pathname;
    const yontem = secenek.method ?? 'GET';
    if (yol === '/api/mobile_app/registrations' && yontem === 'POST') return kayit ? kayit(url, secenek) : json({ webhook_id: MOBIL_WEBHOOK });
    if (yol === `/api/webhook/${MOBIL_WEBHOOK}` && yontem === 'POST') return webhook ? webhook(url, secenek) : new Response('{}', { status: 200 });
    return temel(url, secenek);
  };
};
const mobilIstekleri = (ortam) => ortam.durum.fetchler.filter((f) => /\/api\/mobile_app\/|\/api\/webhook\//.test(f.url));
const kayitIstekleri = (ortam) => mobilIstekleri(ortam).filter((f) => f.url.includes('/api/mobile_app/registrations'));
const webhookIstekleri = (ortam) => mobilIstekleri(ortam).filter((f) => f.url.includes('/api/webhook/'));
const mobilDosyasi = (ortam) => path.join(ortam.durum.yollar.get('userData'), 'mobil-kayit.dat');
const kartPenceresi = (ortam) => ortam.durum.pencereler.find((p) => !p.yikik && p.webContents.yuklemeler.some((y) => y.url.endsWith('/itme-kart.html')));
const kartOlayi = (ortam) => ({ sender: kartPenceresi(ortam).webContents, senderFrame: { url: pathToFileURL(ITME_HTML_YOLU).href, parent: null } });
const kartMesajlari = (ortam) => (kartPenceresi(ortam)?.webContents.mesajlar ?? []).filter((m) => m.kanal === 'itme:goster').map((m) => m.yuk);
const mobilAyarIletileri = (ortam) => (ortam.ayarlarPenceresi()?.webContents.mesajlar ?? []).filter((m) => m.kanal === 'mobil:degisti').map((m) => m.yuk);
const itmeOlayi = (s, abone, olay) => s.yayinla({ id: abone.id, type: 'event', event: olay });

/** Canlı bağlantıyı kurar, "Kaydol"u onaylar ve itme aboneliğini HA tarafında başarılı (ya da `hataKodu` ile reddedilmiş) yapar. */
async function mobilKanaliAc(ortam, { cihazAdi = 'Salon PC', hataKodu = null } = {}) {
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  const olay = ayarlarOlayi(ortam);
  ortam.durum.diyalogYaniti = 0;
  const sonuc = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi });
  await ortam.akit();
  const abone = s.gonderilen.find((m) => m.type === 'mobile_app/push_notification_channel');
  if (abone) {
    if (hataKodu) s.yayinla({ id: abone.id, type: 'result', success: false, error: { code: hataKodu, message: 'sahte' } });
    else s.yayinla({ id: abone.id, type: 'result', success: true, result: null });
  }
  await ortam.akit();
  return { s, olay, abone, sonuc };
}

ortamda('mobil bildirimler (o-61): varsayılan KAPALI; kayıt, itme aboneliği ve webhook isteği gitmez, dosya yazılmaz, IPC "kayıtsız" der', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  ortam.ilerle(GUN_MS);
  await ortam.akit();
  assert.equal(s.gonderilen.some((m) => m.type === 'mobile_app/push_notification_channel'), false, 'itme aboneliği yok');
  assert.deepEqual(mobilIstekleri(ortam), []);
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
  assert.equal(kartPenceresi(ortam), undefined, 'kart penceresi hiç oluşmadı');
  const olay = ayarlarOlayi(ortam);
  const ozet = await ortam.durum.ipc.get('ayarlar:getir')(olay);
  assert.equal(ozet.mobilBildirimler, false);
  assert.equal(ozet.mobilCihazAdi, '');
  assert.deepEqual(await ortam.durum.ipc.get('mobil:durum')(olay), {
    ok: true,
    kayitli: false,
    etkin: false,
    kanal: 'kayitsiz',
    kayitSuruyor: false,
    sonBildirim: null,
    dusenBildirim: 0,
    canliAcik: true,
    sifrelemeVar: true,
    cihazAdi: '',
  });
});

ortamda('mobil bildirimler (o-61): ayarı açmak tek başına kayıt YAPMAZ (kayıt yalnız "Kaydol" + onayla); ayar dışa/içe aktarmaya girmez', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  const sonuc = await ayarlarKaydet(ortam, { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' });
  assert.equal(sonuc.ok, true);
  await ortam.akit();
  assert.equal(ortam.ayarOku().mobilBildirimler, true);
  assert.deepEqual(mobilIstekleri(ortam), [], 'kayıt isteği yok');
  assert.equal(s.gonderilen.some((m) => m.type === 'mobile_app/push_notification_channel'), false, 'kayıt yokken abonelik yok');
  const durum = await ortam.durum.ipc.get('mobil:durum')(ayarlarOlayi(ortam));
  assert.equal(durum.kayitli, false);
  assert.equal(durum.kanal, 'kayitsiz');
  const { aktarilanAlanlar } = require('../src/lib/ayar-alanlari');
  assert.equal(aktarilanAlanlar().includes('mobilBildirimler'), false);
  assert.equal(aktarilanAlanlar().includes('mobilCihazAdi'), false);
  const kotu = await ayarlarKaydet(ortam, { mobilCihazAdi: '<b>x</b>', mobilBildirimler: 'evet' });
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'mobilCihazAdi'));
  assert.ok(kotu.uyarilar.some((u) => u.alan === 'mobilBildirimler'));
  assert.equal(ortam.ayarOku().mobilCihazAdi, 'Salon PC', 'geçersiz ad reddedildi');
});

ortamda('mobil bildirimler (o-61): Kaydol onaylanınca TEK kayıt isteği gider; webhook kimliği şifreli dosyada kalır, ayara/günlüğe/yanıta girmez; itme kanalı açılır', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, sonuc, abone } = await mobilKanaliAc(ortam);
  assert.equal(ortam.durum.diyaloglar.length, 1, 'tek onay penceresi');
  const diyalog = ortam.durum.diyaloglar[0];
  assert.equal(diyalog.buttons[0], ANA_SOZLUK.tr['mobil.kaydolDugme']);
  assert.equal(diyalog.defaultId, 1, 'varsayılan düğme Vazgeç');
  assert.equal(diyalog.message, ANA_SOZLUK.tr['mobil.kaydolMesaj'].replace('{ad}', 'Salon PC'));
  assert.equal(kayitIstekleri(ortam).length, 1);
  const kayit = kayitIstekleri(ortam)[0];
  assert.equal(kayit.yontem, 'POST');
  assert.match(kayit.basliklar.Authorization, /^Bearer /, 'kayıt isteği korumalı haIstek yolundan gider');
  const govde = JSON.parse(kayit.govde);
  assert.equal(govde.device_name, 'Salon PC');
  assert.equal(govde.supports_encryption, false);
  assert.deepEqual(govde.app_data, { push_websocket_channel: true });
  assert.ok(!('device_id' in govde));
  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.sonuc, 'kaydoldu');
  assert.equal(sonuc.kayitli, true);
  assert.equal(sonuc.mobilBildirimler, true);
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), true, 'şifreli kayıt dosyası');
  const ayar = ortam.ayarOku();
  assert.equal(ayar.mobilBildirimler, true);
  assert.equal(ayar.mobilCihazAdi, 'Salon PC');
  const olay = ayarlarOlayi(ortam);
  const durum = await ortam.durum.ipc.get('mobil:durum')(olay);
  assert.equal(durum.kayitli, true);
  assert.equal(durum.kanal, 'dinliyor');
  for (const [ad, metin] of [
    ['ayarlar.json', JSON.stringify(ayar)],
    ['kaydol yanıtı', JSON.stringify(sonuc)],
    ['mobil:durum', JSON.stringify(durum)],
    ['ayarlar:getir', JSON.stringify(await ortam.durum.ipc.get('ayarlar:getir')(olay))],
    ['günlük', ortam.gunlukOku()],
    ['mobil:degisti iletileri', JSON.stringify(mobilAyarIletileri(ortam))],
    ['pencere iletileri', JSON.stringify(ortam.pencere.webContents.mesajlar)],
  ]) assert.ok(!metin.includes(MOBIL_WEBHOOK), `${ad}: webhook kimliği sızdı`);
  assert.deepEqual(abone.webhook_id, MOBIL_WEBHOOK);
  assert.equal(abone.support_confirm, false);
  assert.equal(s.gonderilen.filter((m) => m.type === 'mobile_app/push_notification_channel').length, 1);
  assert.ok(mobilAyarIletileri(ortam).length > 0, 'Ayarlar durum olayı aldı');
  // ikinci Kaydol: zaten kayıtlı, ikinci cihaz oluşmaz
  const tekrar = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(tekrar.sonuc, 'zaten');
  assert.equal(kayitIstekleri(ortam).length, 1);
  // ayar kapanınca kanal kapanır (kayıt silinmez)
  await ayarlarKaydet(ortam, { mobilBildirimler: false });
  await ortam.akit();
  const kapali = await ortam.durum.ipc.get('mobil:durum')(olay);
  assert.equal(kapali.kanal, 'kapali');
  assert.equal(kapali.kayitli, true);
});

ortamda('mobil bildirimler (o-61): Kaydol\'da "Vazgeç" HA\'ya hiçbir istek göndermez; geçersiz cihaz adı onay penceresi açmadan reddedilir', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  await ortam.akit();
  const olay = ayarlarOlayi(ortam);
  ortam.durum.diyalogYaniti = 1;
  const vazgec = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(vazgec.ok, true);
  assert.equal(vazgec.sonuc, 'vazgecildi');
  assert.equal(ortam.durum.diyaloglar.length, 1);
  assert.deepEqual(mobilIstekleri(ortam), []);
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
  assert.equal(ortam.ayarOku().mobilBildirimler, false);
  const sayi = ortam.durum.diyaloglar.length;
  const kotu = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: '<script>x</script>' });
  assert.equal(kotu.ok, false);
  assert.equal(kotu.hata, ANA_SOZLUK.tr['mobil.hata.cihazAdi']);
  assert.equal(ortam.durum.diyaloglar.length, sayi, 'geçersiz adla onay penceresi açılmadı');
  assert.deepEqual(mobilIstekleri(ortam), []);
  for (const girdi of [undefined, null, 5, {}, { cihazAdi: 5 }, { cihazAdi: 'x'.repeat(500) }]) {
    const sonuc = await ortam.durum.ipc.get('mobil:kaydol')(olay, girdi);
    assert.ok(typeof sonuc === 'object' && sonuc !== null, JSON.stringify(girdi));
  }
  assert.deepEqual(mobilIstekleri(ortam), [], 'bozuk girdiler kayıt yapmaz (onay penceresi hep Vazgeç)');
});

ortamda('mobil bildirimler (o-61): boş cihaz adıyla uygulama adı gönderilir ve ayarda boş kalır', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  await mobilKanaliAc(ortam, { cihazAdi: '   ' });
  const govde = JSON.parse(kayitIstekleri(ortam)[0].govde);
  assert.match(govde.device_name, /\S/, 'HA\'ya boş ad gitmez');
  assert.equal(ortam.ayarOku().mobilCihazAdi, '');
});

ortamda('mobil bildirimler (o-61): kayıt hataları kullanıcıya adres/kimlik içermeyen metinle döner; kayıt, dosya ve ayar oluşmaz', dalga3([SALON]), async (ortam) => {
  await ortam.akit();
  const olay = ayarlarOlayi(ortam);
  ortam.durum.diyalogYaniti = 0;
  const durumlar = [
    [{ kayit: () => json({ message: 'yok' }, 404) }, 'mobil.hata.bulunamadi'],
    [{ kayit: () => json({}, 500) }, null],
    [{ kayit: () => json({ webhook_id: 5 }) }, 'mobil.hata.yanit'],
    [{ kayit: () => json({ webhook_id: '../../x' }) }, 'mobil.hata.yanit'],
  ];
  for (const [yapilandirma, anahtar] of durumlar) {
    ortam.durum.apiYaniti = mobilHa(yapilandirma);
    const sonuc = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
    assert.equal(sonuc.ok, false);
    if (anahtar) assert.equal(sonuc.hata, ANA_SOZLUK.tr[anahtar]);
    assert.equal(typeof sonuc.hata, 'string');
    assert.doesNotMatch(sonuc.hata, /192\.168|ha\.example|webhook_id|TEST_ANAHTAR/);
    assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
    assert.equal(ortam.ayarOku().mobilBildirimler, false);
    assert.equal((await ortam.durum.ipc.get('mobil:durum')(olay)).kayitli, false);
  }
  assert.equal(kayitIstekleri(ortam).length, durumlar.length, 'her kayıt denemesi tek istek (yeniden deneme yok)');
  assert.doesNotMatch(ortam.gunlukOku(), /192\.168|ha\.example|TEST_ANAHTAR|Bearer/);
});

ortamda('mobil bildirimler (o-61): şifreleme (safeStorage) kullanılamıyorsa kayıt YAPILMAZ ve HA\'ya istek gitmez', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  await ortam.akit();
  ortam.durum.sifrelemeYok = true;
  const olay = ayarlarOlayi(ortam);
  ortam.durum.diyalogYaniti = 0;
  assert.equal((await ortam.durum.ipc.get('mobil:durum')(olay)).sifrelemeVar, false);
  const sonuc = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.hata, ANA_SOZLUK.tr['mobil.hata.sifreleme']);
  assert.deepEqual(mobilIstekleri(ortam), []);
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
});

ortamda('mobil bildirimler (o-61): düğmesiz bildirim Windows bildirimi olur; düğmeli bildirim küçük kart olur ve renderer\'a yalnız düğme BAŞLIKLARI gider', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Çamaşır bitti', title: 'Makine', data: { tag: 'camasir' } });
  await ortam.akit();
  const duz = ortam.durum.bildirimler.find((b) => b.body === 'Çamaşır bitti');
  assert.ok(duz, 'Windows bildirimi');
  assert.equal(duz.title, 'Makine');
  assert.equal(kartPenceresi(ortam), undefined, 'düğmesiz bildirim için kart penceresi açılmaz');

  itmeOlayi(s, abone, {
    message: 'Hareket algılandı',
    data: { tag: 'hareket', actions: [{ action: 'ONAYLA_42', title: 'Onayla' }, { action: 'KAPIYI_AC', title: 'Aç' }, { action: 'ERTELE_7', title: 'Ertele' }, { action: 'URL_8', title: 'Git', uri: 'https://ornek.invalid' }] },
  });
  await ortam.akit();
  const kart = kartPenceresi(ortam);
  assert.ok(kart, 'kart penceresi açıldı');
  assert.equal(kart.cagri.showInactive, 1, 'odak almadan gösterilir');
  assert.equal(kart.cagri.focus, 0);
  const mesajlar = kartMesajlari(ortam);
  assert.equal(mesajlar.length, 1);
  assert.equal(mesajlar[0].mesaj, 'Hareket algılandı');
  assert.equal(mesajlar[0].baslik, ANA_SOZLUK.tr['mobil.varsayilanBaslik']);
  assert.deepEqual(mesajlar[0].dugmeler, ['Onayla', 'Ertele'], 'Kapı Kuralı\'na takılan ve bağlantı açan düğmeler düştü');
  assert.doesNotMatch(JSON.stringify(mesajlar), /ONAYLA_42|ERTELE_7|KAPIYI_AC|URL_8|ornek\.invalid/, 'eylem kimlikleri ve adresler renderer\'a gitmez');
  assert.doesNotMatch(JSON.stringify(mesajlar), new RegExp(MOBIL_WEBHOOK));
  assert.ok(!ortam.durum.bildirimler.some((b) => b.body === 'Hareket algılandı'), 'düğmeli bildirim ikinci kez Windows bildirimi olmaz');
  assert.equal(webhookIstekleri(ortam).length, 0, 'gösterme HA\'ya hiçbir şey göndermez');
});

ortamda('mobil bildirimler (o-61): Kapı Kuralı — kapı/kilit/alarm içeren bildirim hiçbir yüzeyde görünmez; uzaktan komutlar yok sayılır', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone } = await mobilKanaliAc(ortam);
  const once = ortam.durum.bildirimler.length;
  for (const ileti of ['Ön kapı açık', 'Garaj kapısı açıldı', 'Front door open', 'Alarm tetiklendi', 'Siren çalıyor']) itmeOlayi(s, abone, { message: ileti });
  itmeOlayi(s, abone, { message: 'Hareket', title: 'Kilit durumu', data: { actions: [{ action: 'TAMAM', title: 'Tamam' }] } });
  itmeOlayi(s, abone, { message: 'request_location_update' });
  itmeOlayi(s, abone, { message: 'command_screen_on' });
  itmeOlayi(s, abone, { message: 'remove_channel' });
  await ortam.akit();
  assert.equal(ortam.durum.bildirimler.length, once, 'Windows bildirimi yok');
  assert.equal(kartPenceresi(ortam), undefined, 'kart yok');
  assert.deepEqual(webhookIstekleri(ortam), [], 'komutlara yanıt/konum/sensör gönderilmez');
  assert.doesNotMatch(ortam.gunlukOku(), /Ön kapı açık|Garaj kapısı|Front door|Alarm tetiklendi|Siren çalıyor|request_location_update|command_screen_on/, 'günlüğe bildirim içeriği yazılmaz');
});

ortamda('mobil bildirimler (o-61): düğmeye basınca webhook\'a TEK mobile_app_notification_action olayı gider (Authorization yok); düğme tek kullanımlık; geri bildirim gösterilir', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Hareket algılandı', data: { tag: 'hareket', actions: [{ action: 'ONAYLA_42', title: 'Onayla' }, { action: 'ERTELE_7', title: 'Ertele' }] } });
  await ortam.akit();
  const olay = kartOlayi(ortam);
  const { kartNo } = kartMesajlari(ortam).at(-1);
  // kötü istekler: yanlış numara, sıra dışı, tamsayı olmayan
  for (const girdi of [undefined, null, {}, { kartNo, sira: 5 }, { kartNo, sira: -1 }, { kartNo, sira: '0' }, { kartNo: kartNo + 99, sira: 0 }, { kartNo: '1', sira: 0 }]) {
    assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(olay, girdi), { ok: false }, JSON.stringify(girdi));
  }
  assert.deepEqual(webhookIstekleri(ortam), []);
  assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(olay, { kartNo, sira: 1 }), { ok: true });
  assert.equal(webhookIstekleri(ortam).length, 1);
  const istek = webhookIstekleri(ortam)[0];
  assert.equal(istek.yontem, 'POST');
  assert.equal(istek.url, `http://192.168.1.10:8123/api/webhook/${MOBIL_WEBHOOK}`);
  assert.deepEqual(JSON.parse(istek.govde), { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'ERTELE_7', tag: 'hareket' } } });
  assert.ok(!Object.keys(istek.basliklar ?? {}).some((b) => b.toLowerCase() === 'authorization'), 'webhook isteğinde Authorization yok');
  assert.doesNotMatch(JSON.stringify(istek.basliklar ?? {}), /TEST_ANAHTAR|Bearer/);
  assert.equal(kartPenceresi(ortam).gorunur, false, 'basılan kart kapandı');
  assert.ok(koseMesajlari(ortam).some((m) => m.metin === ANA_SOZLUK.tr['mobil.eylem.gitti']), 'geri bildirim');
  // aynı kartın ikinci basışı ve aynı numaralı yeniden basış reddedilir
  assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(olay, { kartNo, sira: 0 }), { ok: false });
  assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(olay, { kartNo, sira: 1 }), { ok: false });
  assert.equal(webhookIstekleri(ortam).length, 1);
  assert.doesNotMatch(ortam.gunlukOku(), new RegExp(MOBIL_WEBHOOK));
});

ortamda('mobil bildirimler (o-61): × düğmesi ve süre dolması HA\'ya hiçbir şey göndermez; sıradaki kart görünür; aynı etiket kartı değiştirir', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone } = await mobilKanaliAc(ortam);
  const dugme = [{ action: 'TAMAM', title: 'Tamam' }];
  itmeOlayi(s, abone, { message: 'Birinci', data: { tag: 'a', actions: dugme } });
  itmeOlayi(s, abone, { message: 'İkinci', data: { tag: 'b', actions: dugme } });
  await ortam.akit();
  const olay = kartOlayi(ortam);
  assert.deepEqual(kartMesajlari(ortam).map((m) => m.mesaj), ['Birinci']);
  assert.deepEqual(await ortam.durum.ipc.get('itme:kapat')(olay, { kartNo: kartMesajlari(ortam)[0].kartNo + 50 }), { ok: false });
  assert.deepEqual(await ortam.durum.ipc.get('itme:kapat')(olay, { kartNo: kartMesajlari(ortam)[0].kartNo }), { ok: true });
  assert.deepEqual(kartMesajlari(ortam).map((m) => m.mesaj), ['Birinci', 'İkinci'], 'sıradaki kart görünür');
  // aynı etiketli yeni bildirim görünen kartın yerine geçer
  itmeOlayi(s, abone, { message: 'İkinci (yeni)', data: { tag: 'b', actions: dugme } });
  await ortam.akit();
  assert.equal(kartMesajlari(ortam).at(-1).mesaj, 'İkinci (yeni)');
  // clear_notification kartı kapatır
  itmeOlayi(s, abone, { message: 'clear_notification', data: { tag: 'b' } });
  await ortam.akit();
  assert.equal(kartPenceresi(ortam).gorunur, false);
  // süre dolması
  itmeOlayi(s, abone, { message: 'Üçüncü', data: { tag: 'c', actions: dugme } });
  await ortam.akit();
  assert.equal(kartPenceresi(ortam).gorunur, true);
  ortam.ilerle(46_000);
  await ortam.akit();
  assert.equal(kartPenceresi(ortam).gorunur, false, '45 sn sonra kart kapandı');
  assert.deepEqual(webhookIstekleri(ortam), [], 'kapatma/süre dolması HA\'ya olay göndermez');
});

ortamda('mobil bildirimler (o-61): düğme isteği sırasında HA kaydı silmişse (410) yerel kayıt temizlenir, ayar kapanır ve tek bildirim gelir', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa({ webhook: () => new Response('', { status: 410 }) });
  const { s, abone } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Hareket', data: { actions: [{ action: 'TAMAM', title: 'Tamam' }] } });
  await ortam.akit();
  const { kartNo } = kartMesajlari(ortam).at(-1);
  const sonuc = await ortam.durum.ipc.get('itme:eylem')(kartOlayi(ortam), { kartNo, sira: 0 });
  assert.deepEqual(sonuc, { ok: false });
  await ortam.akit();
  assert.equal(webhookIstekleri(ortam).length, 1, 'yeniden deneme yok');
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false, 'yerel kayıt silindi');
  assert.equal(ortam.ayarOku().mobilBildirimler, false);
  const durum = await ortam.durum.ipc.get('mobil:durum')(ayarlarOlayi(ortam));
  assert.equal(durum.kayitli, false);
  assert.equal(durum.kanal, 'kayit-yok');
  const uyarilar = ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr['mobil.uyari.kayitYok']);
  assert.equal(uyarilar.length, 1);
  ortam.durum.bildirimNesneleri.find((n) => n.secenek.body === ANA_SOZLUK.tr['mobil.uyari.kayitYok']).emit('click');
  await ortam.akit();
  assert.deepEqual(bolumIstekleri(ortam).at(-1), { bolum: 'bolumMobil' }, 'tıklayınca Ayarlar Mobil bildirimler bölümü açılır');
  assert.ok(koseMesajlari(ortam).some((m) => m.tur === 'hata'), 'eylem hatası kullanıcıya gösterildi');
});

for (const [kod, kanal, uyariAnahtari] of [
  ['unauthorized', 'yetkisiz', 'mobil.uyari.yetkisiz'],
  ['unknown_command', 'destek-yok', 'mobil.uyari.destekYok'],
]) {
  ortamda(`mobil bildirimler (o-61): itme kanalı "${kod}" derse kanal kapanır, tek uyarı gelir, yerel kayıt SİLİNMEZ`, dalga3([SALON]), async (ortam) => {
    ortam.durum.apiYaniti = mobilHa();
    const { olay } = await mobilKanaliAc(ortam, { hataKodu: kod });
    const durum = await ortam.durum.ipc.get('mobil:durum')(olay);
    assert.equal(durum.kanal, kanal);
    assert.equal(durum.kayitli, true, 'kayıt korunur');
    assert.equal(fs.existsSync(mobilDosyasi(ortam)), true);
    assert.equal(ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr[uyariAnahtari]).length, 1);
    assert.equal(ortam.ayarOku().mobilBildirimler, true, 'ayar kullanıcıya bırakılır');
    assert.deepEqual(webhookIstekleri(ortam), []);
  });
}

ortamda('mobil bildirimler (o-61): "not_found" itme hatası yerel kaydı siler, ayarı kapatır ve tek uyarı gösterir; Ayarlar açıksa durum iletilir', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { olay } = await mobilKanaliAc(ortam, { hataKodu: 'not_found' });
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
  assert.equal(ortam.ayarOku().mobilBildirimler, false);
  const durum = await ortam.durum.ipc.get('mobil:durum')(olay);
  assert.equal(durum.kayitli, false);
  assert.equal(durum.kanal, 'kayit-yok');
  assert.equal(ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr['mobil.uyari.kayitYok']).length, 1);
  assert.ok(mobilAyarIletileri(ortam).some((m) => m.kanal === 'kayit-yok' && m.mobilBildirimler === false), 'açık Ayarlar sayfasına durum iletildi');
  // yeniden kaydolunabilir
  const yeni = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(yeni.sonuc, 'kaydoldu');
});

ortamda('mobil bildirimler (o-61): "Kaydı sil" onay ister; Vazgeç hiçbir şeyi silmez; onayla yerel kayıt gider, kanal kapanır, HA\'ya istek gitmez', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { olay } = await mobilKanaliAc(ortam);
  const once = mobilIstekleri(ortam).length;
  ortam.durum.diyalogYaniti = 1;
  const vazgec = await ortam.durum.ipc.get('mobil:kaydi-sil')(olay);
  assert.equal(vazgec.sonuc, 'vazgecildi');
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), true);
  const diyalog = ortam.durum.diyaloglar.at(-1);
  assert.equal(diyalog.buttons[0], ANA_SOZLUK.tr['mobil.silDugme']);
  assert.equal(diyalog.defaultId, 1);
  assert.equal(diyalog.message, ANA_SOZLUK.tr['mobil.silMesaj']);
  ortam.durum.diyalogYaniti = 0;
  const sil = await ortam.durum.ipc.get('mobil:kaydi-sil')(olay);
  assert.equal(sil.ok, true);
  assert.equal(sil.sonuc, 'silindi');
  assert.equal(sil.kayitli, false);
  assert.equal(sil.mobilBildirimler, false);
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), false);
  assert.equal(ortam.ayarOku().mobilBildirimler, false);
  assert.equal(mobilIstekleri(ortam).length, once, 'kayıt silme HA\'ya istek göndermez (REST ucu yok; cihaz HA\'dan elle kaldırılır)');
  assert.equal(ortam.durum.fetchler.some((f) => f.yontem === 'DELETE'), false);
  assert.equal((await ortam.durum.ipc.get('mobil:durum')(olay)).kanal, 'kayitsiz');
  const yok = await ortam.durum.ipc.get('mobil:kaydi-sil')(olay);
  assert.equal(yok.sonuc, 'yok');
  // silinmiş kayıtla düğme/itme çalışmaz; yeniden kaydolunabilir
  const yeni = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(yeni.sonuc, 'kaydoldu');
});

ortamda('mobil bildirimler: ayar diske yazılamıyorsa "Kaydol" başarılı denmez (ok:false, yazılamadı metni); HA\'ya yine tek kayıt isteği gitti, kutu açık kalır; "Kaydı sil" için de aynı', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  const olay = ayarlarOlayi(ortam);
  ortam.durum.diyalogYaniti = 0;
  // Geçici dosyanın yerine klasör koymak ayar yazımını bozar (disk dolu / kilitli dosya taklidi); mobil-kayit.dat ayrı dosyadır.
  const engel = path.join(ortam.durum.yollar.get('userData'), 'ayarlar.json.tmp');
  fs.mkdirSync(engel);
  const kaydol = await ortam.durum.ipc.get('mobil:kaydol')(olay, { cihazAdi: 'Salon PC' });
  assert.equal(kaydol.ok, false);
  assert.equal(kaydol.hata, AYAR_YAZILAMADI_METNI);
  assert.notEqual(kaydol.sonuc, 'kaydoldu');
  assert.equal(kaydol.mobilBildirimler, true, 'HA kaydı yapıldı: kutu bellekteki değeri gösterir');
  assert.equal(kaydol.mobilCihazAdi, 'Salon PC');
  assert.equal(kayitIstekleri(ortam).length, 1, 'HA\'ya tek kayıt isteği');
  assert.equal(fs.existsSync(mobilDosyasi(ortam)), true, 'webhook kimliği yerelde saklandı');
  assert.equal(ortam.ayarOku().mobilBildirimler, false, 'diskteki ayar değişmedi');

  fs.rmSync(engel, { recursive: true });
  assert.equal((await ayarlarKaydet(ortam, { koseBildirimi: false })).ok, true);
  assert.equal(ortam.ayarOku().mobilBildirimler, true, 'engel kalkınca sonraki kayıt bellekteki değeri diske yazar');

  fs.mkdirSync(engel);
  const sil = await ortam.durum.ipc.get('mobil:kaydi-sil')(olay);
  assert.equal(sil.ok, false);
  assert.equal(sil.hata, AYAR_YAZILAMADI_METNI);
  assert.notEqual(sil.sonuc, 'silindi');
  assert.equal(sil.mobilBildirimler, false);
  fs.rmSync(engel, { recursive: true });
});

ortamda('mobil bildirimler (o-61): IPC kanalları yalnız Ayarlar / kart sayfasına yanıt verir; uzak sayfa ve başka pencere reddedilir; hiçbir şey ağa çıkmaz', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone, olay } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Hareket', data: { actions: [{ action: 'TAMAM', title: 'Tamam' }] } });
  await ortam.akit();
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const baskaPencere = { sender: ortam.pencere.webContents, senderFrame: olay.senderFrame };
  const once = mobilIstekleri(ortam).length;
  for (const kanal of ['mobil:durum', 'mobil:kaydol', 'mobil:kaydi-sil']) {
    for (const kotu of [uzak, baskaPencere, kartOlayi(ortam)]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, { cihazAdi: 'x' }), { ok: false, hata: ANA_SOZLUK.tr['ana.izinYok'] }, `${kanal} reddedilmeli`);
  }
  const { kartNo } = kartMesajlari(ortam).at(-1);
  const kartUzak = { sender: kartPenceresi(ortam).webContents, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  const kartAlt = { sender: kartPenceresi(ortam).webContents, senderFrame: { url: pathToFileURL(ITME_HTML_YOLU).href, parent: {} } };
  for (const kanal of ['itme:eylem', 'itme:kapat']) {
    for (const kotu of [uzak, baskaPencere, olay, kartUzak, kartAlt]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, { kartNo, sira: 0 }), { ok: false, hata: ANA_SOZLUK.tr['ana.izinYok'] }, `${kanal} reddedilmeli`);
  }
  assert.equal(mobilIstekleri(ortam).length, once, 'reddedilen çağrılar ağa çıkmadı');
  assert.equal(kartPenceresi(ortam).gorunur, true, 'kart yerinde');
  assert.deepEqual((await ortam.durum.ipc.get('mobil:durum')(olay)).kanal, 'dinliyor');
});

ortamda('mobil bildirimler (o-61): kart penceresi yokken (hiç kart açılmadıysa) kart IPC kanalları kimseye yanıt vermez', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const olay = ayarlarOlayi(ortam);
  const sahte = { sender: olay.sender, senderFrame: { url: pathToFileURL(ITME_HTML_YOLU).href, parent: null } };
  for (const kanal of ['itme:eylem', 'itme:kapat']) assert.deepEqual(await ortam.durum.ipc.get(kanal)(sahte, { kartNo: 1, sira: 0 }), { ok: false, hata: ANA_SOZLUK.tr['ana.izinYok'] });
  assert.deepEqual(webhookIstekleri(ortam), []);
});

ortamda('mobil bildirimler (o-61): canlı bağlantı kapalıyken itme kanalı hiç açılmaz; durum "canliAcik: false" der', dalga3([SALON], { canliBaglanti: false }), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  await ortam.akit();
  assert.equal(ortam.durum.soketler.length, 0);
  const olay = ayarlarOlayi(ortam);
  assert.equal((await ortam.durum.ipc.get('mobil:durum')(olay)).canliAcik, false);
});

ortamda('mobil bildirimler (o-61): kayıtlı ve ayar açıkken uygulama yeniden başlayınca itme kanalı kendiliğinden kurulur; ayar kapalıysa kurulmaz', {
  ...dalga3([SALON], { mobilBildirimler: true, mobilCihazAdi: 'Salon PC' }),
  ekDosyalar: { 'mobil-kayit.dat': Buffer.from(`${SIFRE_ONEKI}${MOBIL_WEBHOOK}`).toString('latin1') },
}, async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  const abone = s.gonderilen.find((m) => m.type === 'mobile_app/push_notification_channel');
  assert.ok(abone, 'itme aboneliği açılışta kuruldu');
  assert.equal(abone.webhook_id, MOBIL_WEBHOOK);
  assert.deepEqual(kayitIstekleri(ortam), [], 'yeniden başlamada yeni kayıt oluşturulmaz');
  const olay = ayarlarOlayi(ortam);
  assert.equal((await ortam.durum.ipc.get('mobil:durum')(olay)).kayitli, true);
  await ayarlarKaydet(ortam, { mobilBildirimler: false });
  await ortam.akit();
  const sonDurum = await ortam.durum.ipc.get('mobil:durum')(olay);
  assert.equal(sonDurum.etkin, false);
  assert.equal(sonDurum.kanal, 'kapali');
  assert.equal(sonDurum.kayitli, true, 'kapatmak kaydı silmez');
});

ortamda('mobil bildirimler (o-61): ayar kapalıyken kayıt dosyası olsa da itme kanalı açılmaz', {
  ...dalga3([SALON], { mobilBildirimler: false }),
  ekDosyalar: { 'mobil-kayit.dat': Buffer.from(`${SIFRE_ONEKI}${MOBIL_WEBHOOK}`).toString('latin1') },
}, async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s } = await canliYap(ortam, [durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off')]);
  assert.equal(s.gonderilen.some((m) => m.type === 'mobile_app/push_notification_channel'), false);
});

test('mobil bildirimler (o-61): main.js HA\'ya doğrudan POST/webhook yazmaz ve sensör/konum türü içermez (yalnız korumalı yollar)', () => {
  const main = fs.readFileSync(MAIN, 'utf8');
  assert.equal((main.match(/yontem:\s*'POST'/g) ?? []).length, 0);
  assert.doesNotMatch(main, /\/api\/webhook\/|register_sensor|update_sensor_states|update_location/);
  assert.match(main, /haIstemcisi\.webhookGonder\(/);
  assert.match(main, /yerelOlaydanMi|itmeKart\.olaydanMi/);
});

// ---------------------------------------------------------------------------
// 1.4.0 eylem grubu: etkinlik geçmişi (o-17), geri al (o-12), gecikmeli eylem (o-15), son değişenler (o-18), oda (o-14), diğer cihazlar (o-46)
// ---------------------------------------------------------------------------

ortamda('etkinlik geçmişi (o-17): panel eylemi kayda geçer; Ayarlar etkinlik:liste ile okur, etkinlik:temizle siler; yüzey sayfası bu kanallara erişemez', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  const olay = ayarlarOlayi(ortam);
  const liste = await ortam.durum.ipc.get('etkinlik:liste')(olay);
  assert.equal(liste.ok, true);
  assert.equal(liste.acik, true);
  assert.equal(liste.kayitlar.length, 1);
  const k = JSON.parse(JSON.stringify(liste.kayitlar[0]));
  assert.deepEqual([k.kaynak, k.kimlik, k.islem, k.sonuc], ['panel', SALON.entity_id, 'toggle', 'ok']);
  assert.equal(typeof k.zaman, 'number');
  // yüzey sayfası (panel) ve uzak sayfa erişemez
  const yuzey = yuzeyOlayi(ortam, panel);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  for (const kanal of ['etkinlik:liste', 'etkinlik:temizle']) {
    for (const kotu of [yuzey, uzak]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu), { ok: false, hata: 'İzin yok.' }, `${kanal} reddedilmeli`);
  }
  assert.equal((await ortam.durum.ipc.get('etkinlik:liste')(olay)).kayitlar.length, 1, 'reddedilen istekler silmedi');
  assert.deepEqual(await ortam.durum.ipc.get('etkinlik:temizle')(olay), { ok: true });
  assert.equal((await ortam.durum.ipc.get('etkinlik:liste')(olay)).kayitlar.length, 0);
});

ortamda('etkinlik geçmişi (o-17): çıkışta <userData>\\etkinlik-gecmisi.json yazılır; dosyada adres/anahtar yok', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.app.emit('before-quit');
  const yol = path.join(ortam.durum.yollar.get('userData'), 'etkinlik-gecmisi.json');
  const dosya = fs.readFileSync(yol, 'utf8');
  const icerik = JSON.parse(dosya);
  assert.equal(icerik.kayitlar.length, 1);
  assert.equal(icerik.kayitlar[0].kimlik, SALON.entity_id);
  assert.ok(!/192\.168|ha\.example|Bearer|token/i.test(dosya), 'adres ve anahtar dosyaya girmez');
});

ortamda('etkinlik geçmişi (o-17): ayar kapalıyken yeni kayıt yazılmaz', dalga3([SALON], { etkinlikGecmisi: false }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  const liste = await ortam.durum.ipc.get('etkinlik:liste')(ayarlarOlayi(ortam));
  assert.deepEqual([liste.acik, liste.kayitlar.length], [false, 0]);
});

// --- geri al (o-12) ---------------------------------------------------------------------------------

const geriAlOzeti = async (ortam) => {
  const yanit = await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam));
  return yanit.model.eylem.geriAl;
};
const geriAlPostlari = (ortam) => postlar(ortam).map((p) => p.url.replace('http://192.168.1.10:8123/api/services/', ''));

ortamda('geri al (o-12): panelden açılan ışık yuzey:geri-al ile kapatılır; model "geri al" özeti taşır, geri alınca özet kalkar ve panel haberdar edilir', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.equal(await geriAlOzeti(ortam), null);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  const ozet = await geriAlOzeti(ortam);
  assert.deepEqual([ozet.adet, ozet.ad], [1, 'Salon Lambası']);
  assert.ok(ozet.bitis > Date.now() - 1000, 'bitiş mutlak zamandır');
  assert.deepEqual(Object.keys(ozet).sort(), ['ad', 'adet', 'bitis'], 'renderer yalnız beyaz listeli alanları görür');
  const modelSayisi = yuzeyMesajlari(ortam, 'yuzey:durum').length;
  const sonuc = await ortam.durum.ipc.get('yuzey:geri-al')(yuzeyOlayi(ortam, panel));
  assert.deepEqual(sonuc, { ok: true });
  assert.deepEqual(geriAlPostlari(ortam), ['light/toggle', 'light/turn_off']);
  assert.equal(await geriAlOzeti(ortam), null);
  await ortam.akit();
  ortam.ilerle(200);
  assert.ok(yuzeyMesajlari(ortam, 'yuzey:durum').length > modelSayisi, 'model yeniden gönderildi (düğme gizlensin)');
  // ikinci geri alma yeni bir şey yapmaz
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:geri-al')(yuzeyOlayi(ortam, panel)), { ok: false, tur: 'bos' });
  assert.equal(postlar(ortam).length, 2);
});

ortamda('geri al (o-12): yüzey olmayan gönderen geri alma yapamaz; kanal yük taşımaz', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  for (const kotu of [olay, uzak]) assert.deepEqual(await ortam.durum.ipc.get('yuzey:geri-al')(kotu), { ok: false, hata: 'İzin yok.' });
  assert.equal(postlar(ortam).length, 1, 'reddedilen istekler HA\'ya bir şey göndermedi');
  assert.equal((await geriAlOzeti(ortam)).adet, 1, 'girdi korundu');
});

ortamda('geri al (o-12): tepsi menüsünde "Geri al: <ad>" öğesi yalnız geri alınacak bir şey varken çıkar ve aynı güvenli yoldan geri alır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal(ortam.menuOgesi('Geri al: Salon Lambası'), undefined);
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  const oge = ortam.menuOgesi('Geri al: Salon Lambası');
  assert.ok(oge, 'tepsi menüsünde geri al öğesi var');
  oge.click();
  await ortam.akit();
  assert.deepEqual(geriAlPostlari(ortam), ['light/toggle', 'light/turn_off']);
  assert.equal(ortam.menuOgesi('Geri al: Salon Lambası'), undefined, 'geri alınınca öğe kalkar');
});

ortamda('geri al (o-12): varsayılan Control+Alt+Z genel kısayolu kayıtlıdır ve son eylemi geri alır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+Z'));
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(1000); // yinelenen tetikleme engeli
  await ortam.durum.kisayollar.get('Control+Alt+Z')();
  await ortam.akit();
  assert.deepEqual(geriAlPostlari(ortam), ['light/toggle', 'light/turn_off']);
  const durum = (await kisayolDurumlari(ortam)).find((k) => k.tur === 'geri-al');
  assert.deepEqual([durum.kisayol, durum.durum], ['Control+Alt+Z', 'etkin']);
});

ortamda('geri al (o-12): kısayol boşsa kaydedilmez ama panel/tepsi çalışır; geriAl kapatılınca model özeti, tepsi öğesi ve yuzey:geri-al kalkar', dalga3([SALON], { geriAlKisayolu: '' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+Z'), false);
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  assert.equal((await geriAlOzeti(ortam)).adet, 1, 'kısayol olmasa da panel düğmesi ve tepsi çalışır');
  const sonuc = await ayarlarKaydet(ortam, { geriAl: false });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().geriAl, false);
  assert.equal(await geriAlOzeti(ortam), null, 'kapanınca yığın boşalır');
  assert.equal(ortam.menuOgesi('Geri al: Salon Lambası'), undefined);
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:geri-al')(yuzeyOlayi(ortam, panel)), { ok: false, tur: 'kapali' });
  ortam.ilerle(1000);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  assert.equal(await geriAlOzeti(ortam), null, 'kapalıyken yeni girdi yok');
});

ortamda('geri al (o-12): kullanıcının önceden atadığı kısayol ezilmez: aynı tuş favoriye aitse geri alma kısayolu "çakışıyor" olur', dalga3([{ ...SALON, kisayol: 'Control+Alt+Z' }]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const durumlar = (await kisayolDurumlari(ortam)).filter((k) => k.kisayol === 'Control+Alt+Z');
  assert.deepEqual(durumlar.map((k) => [k.tur, k.gecerli]), [['favori', true], ['geri-al', false]]);
  assert.equal(durumlar[1].neden, 'cakisma');
  await ortam.durum.kisayollar.get('Control+Alt+Z')(); // favori işi
  await ortam.akit();
  assert.deepEqual(geriAlPostlari(ortam), ['light/toggle']);
});

ortamda('geri al (o-12): Ayarlar\'dan geriAlKisayolu değişir, geçersiz/Windows\'a ayrılmış değer reddedilir ve eski kısayol korunur; süre sınırı 1-60 dk', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const iyi = await ayarlarKaydet(ortam, { geriAlKisayolu: 'ctrl alt j', geriAlSureDk: 30 });
  assert.equal(iyi.ok, true);
  assert.equal(ortam.ayarOku().geriAlKisayolu, 'Control+Alt+J');
  assert.equal(ortam.ayarOku().geriAlSureDk, 30);
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+Z'), false, 'eski tuş bırakıldı');
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+J'), true);
  const kotu = await ayarlarKaydet(ortam, { geriAlKisayolu: 'Alt+F4', geriAlSureDk: 500 });
  assert.equal(kotu.ok, true);
  assert.deepEqual(kotu.uyarilar.filter((u) => /geriAl/.test(u.alan)).map((u) => u.alan).sort(), ['geriAlKisayolu', 'geriAlSureDk']);
  assert.equal(ortam.ayarOku().geriAlKisayolu, 'Control+Alt+J');
  assert.equal(ortam.ayarOku().geriAlSureDk, 30);
});

ortamda('geri al (o-12): kapı/kilit adlı varlık geri alma yığınına HİÇ girmez; çıkışta zamanlayıcı bırakılır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, [durumNesnesi('light.salon_lambasi', 'Kapı Lambası', 'off')]);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  assert.equal(await geriAlOzeti(ortam), null, 'HA adı kapıyı belli edince eylem hiç çalışmaz');
  assert.equal(postlar(ortam).length, 0);
  ortam.app.emit('before-quit');
});

// --- gecikmeli eylem (o-15) ---------------------------------------------------------------------------

const gecikmeliOzeti = async (ortam) => (await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam))).model.eylem.gecikmeli;
const servisAdlari = (ortam) => postlar(ortam).map((p) => p.url.replace('http://192.168.1.10:8123/api/services/', ''));
const DAKIKA = 60_000;
const geciktir = (ortam, panel, yuk) => ortam.durum.ipc.get('yuzey:geciktir')(yuzeyOlayi(ortam, panel), yuk);

ortamda('gecikmeli eylem (o-15): "10 dk sonra kapat" planlanınca hemen bir şey gitmez, süre dolunca TEK kapatma gider; model bekleyeni taşır ve sonra boşalır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 }), { ok: true });
  assert.deepEqual(postlar(ortam), [], 'planlama HA\'ya bir şey göndermez');
  const liste = await gecikmeliOzeti(ortam);
  assert.equal(liste.length, 1);
  assert.deepEqual(Object.keys(liste[0]).sort(), ['ad', 'bitis', 'id', 'yon'], 'renderer yalnız beyaz listeli alanları görür (varlık kimliği yok)');
  assert.deepEqual([liste[0].ad, liste[0].yon], ['Salon Lambası', 'kapat']);
  assert.match(liste[0].id, /^g\d+$/);
  assert.equal(liste[0].bitis, Date.now() + 10 * DAKIKA);
  ortam.ilerle(9 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], '9 dk: henüz yok');
  ortam.ilerle(DAKIKA + 1000);
  await ortam.akit();
  assert.deepEqual(servisAdlari(ortam), ['light/turn_off']);
  assert.deepEqual(JSON.parse(postlar(ortam)[0].govde), { entity_id: SALON.entity_id });
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  const kayitlar = (await ortam.durum.ipc.get('etkinlik:liste')(ayarlarOlayi(ortam))).kayitlar.map((k) => [k.kaynak, k.islem, k.sonuc]);
  assert.deepEqual(kayitlar, [['gecikmeli', 'turn_off', 'ok'], ['panel', 'gecikmeli-kur', 'ok']]);
});

ortamda('gecikmeli eylem (o-15): süreli ("fan 30dk"): HEMEN açılır, 30 dk sonra kapanır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'sureli', dakika: 30 }), { ok: true });
  assert.deepEqual(servisAdlari(ortam), ['light/turn_on']);
  assert.equal((await gecikmeliOzeti(ortam))[0].yon, 'kapat');
  ortam.ilerle(30 * DAKIKA + 1000);
  await ortam.akit();
  assert.deepEqual(servisAdlari(ortam), ['light/turn_on', 'light/turn_off']);
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
});

ortamda('gecikmeli eylem (o-15): tepsi menüsünde "Zamanlı eylemler (N)" alt menüsü çıkar; öğeye tıklamak iptal eder ve zamanı gelince hiçbir şey gitmez', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal(ortam.menuOgesi('Zamanlı eylemler (1)'), undefined, 'bekleyen yokken öğe yok');
  const panel = await paneliAc(ortam);
  await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 });
  const ust = ortam.menuOgesi('Zamanlı eylemler (1)');
  assert.ok(ust, 'bekleyen varken alt menü var');
  assert.equal(ust.submenu.length, 1, 'tek bekleyende "Hepsini iptal et" yok');
  assert.match(ust.submenu[0].label, /^İptal et: Salon Lambası kapanışı \(.+\)$/);
  ust.submenu[0].click();
  await ortam.akit();
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  assert.equal(ortam.menuOgesi('Zamanlı eylemler (1)'), undefined);
  ortam.ilerle(20 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  const kayitlar = (await ortam.durum.ipc.get('etkinlik:liste')(ayarlarOlayi(ortam))).kayitlar.map((k) => [k.kaynak, k.islem, k.sonuc]);
  assert.deepEqual(kayitlar, [['tepsi-menu', 'gecikmeli-iptal', 'iptal'], ['panel', 'gecikmeli-kur', 'ok']]);
});

ortamda('gecikmeli eylem (o-15): birden çok bekleyende "Hepsini iptal et" çıkar ve hepsini iptal eder', dalga3([SALON, { entity_id: 'switch.priz', ad: 'Priz' }]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('switch.priz', 'Priz', 'on')]);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 });
  await geciktir(ortam, panel, { kimlik: 'switch.priz', yon: 'kapat', dakika: 20 });
  const ust = ortam.menuOgesi('Zamanlı eylemler (2)');
  assert.deepEqual(ust.submenu.map((o) => o.type ?? o.label.replace(/ \(.+\)$/, '')), ['İptal et: Salon Lambası kapanışı', 'İptal et: Priz kapanışı', 'separator', 'Hepsini iptal et']);
  ust.submenu.at(-1).click();
  await ortam.akit();
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  ortam.ilerle(30 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('gecikmeli eylem (o-15): uygulama kapanırken bekleyenlerin hepsi iptal olur (hiçbir şey çalışmaz)', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 1 });
  ortam.app.emit('before-quit');
  ortam.ilerle(5 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('gecikmeli eylem (o-15): ayar kapatılınca bekleyenler iptal olur, yeni plan "kapali" döner ve tepsi öğesi kalkar; ayar varsayılan açıktır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).gecikmeliEylem, true);
  const panel = await paneliAc(ortam);
  await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 });
  assert.equal((await gecikmeliOzeti(ortam)).length, 1);
  const sonuc = await ayarlarKaydet(ortam, { gecikmeliEylem: false });
  assert.equal(sonuc.ok, true);
  assert.equal(ortam.ayarOku().gecikmeliEylem, false);
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  assert.equal(ortam.menuOgesi('Zamanlı eylemler (1)'), undefined);
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 }), { ok: false, tur: 'kapali' });
  ortam.ilerle(20 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('gecikmeli eylem (o-15): Kapı Kuralı — kapı adlı ışık, kilit, kepenk, garaj, alarm ve onay isteyen eylem planlanamaz; hiçbir istek gitmez', dalga3([SALON, { entity_id: 'light.on_lamba', ad: 'Lamba' }, { entity_id: 'switch.oyun_bilgisayari', ad: 'Oyun bilgisayarı' }, { entity_id: 'light.yok', ad: 'Yok' }]), async (ortam) => {
  haKur(ortam.durum, [
    ...HA_VARLIKLARI,
    durumNesnesi('light.on_lamba', 'Kapı Lambası', 'on'),
    durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'),
    { ...durumNesnesi('cover.kepenk', 'Kepenk', 'open'), attributes: { friendly_name: 'Kepenk', device_class: 'shutter' } },
    durumNesnesi('cover.garaj', 'Garaj Kapısı', 'closed'),
    durumNesnesi('alarm_control_panel.ev', 'Alarm', 'disarmed'),
    durumNesnesi('switch.oyun_bilgisayari', 'Oyun bilgisayarı', 'on'),
    durumNesnesi('scene.film', 'Film', 'unknown'),
  ]);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  const beklenen = {
    'light.on_lamba': 'yasak',
    'lock.on_kapi': 'gecersiz',
    'cover.kepenk': 'gecersiz',
    'cover.garaj': 'gecersiz',
    'alarm_control_panel.ev': 'gecersiz',
    'switch.oyun_bilgisayari': 'kaynak-izinsiz',
    'scene.film': 'gecersiz',
    'light.yok': 'bulunamadi',
  };
  for (const [kimlik, tur] of Object.entries(beklenen)) {
    assert.deepEqual(await geciktir(ortam, panel, { kimlik, yon: 'kapat', dakika: 10 }), { ok: false, tur }, kimlik);
  }
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  ortam.ilerle(30 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('gecikmeli eylem (o-15): zamanı gelince ad kapıya dönüşmüşse eylem çalışmaz (hat kuralları o an yeniden uygulanır)', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 }), { ok: true });
  haKur(ortam.durum, [HA_VARLIKLARI[0], durumNesnesi('light.salon_lambasi', 'Garaj Kapısı Lambası', 'on')]);
  ortam.ilerle(11 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
});

ortamda('gecikmeli eylem (o-15): favori olmayan kimlikle plan kurulamaz (paletDigerCihazlar kapalıyken serbest kimlikle eylem yok); hiçbir HA isteği gitmez', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('switch.isitici', 'Isıtıcı', 'off')]);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: 'switch.isitici', yon: 'sureli', dakika: 600 }), { ok: false, tur: 'bilinmeyen-favori' });
  assert.deepEqual(await geciktir(ortam, panel, { kimlik: 'switch.isitici', yon: 'kapat', dakika: 10 }), { ok: false, tur: 'bilinmeyen-favori' });
  assert.deepEqual(postlar(ortam), []);
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
  ortam.ilerle(11 * DAKIKA);
  await ortam.akit();
  assert.deepEqual(postlar(ortam), [], 'süre dolsa da hiçbir şey gitmez');
});

ortamda('gecikmeli eylem (o-15): yüzey olmayan gönderen (Ayarlar, uzak sayfa) plan kuramaz ve iptal edemez', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  await geciktir(ortam, panel, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 10 });
  const id = (await gecikmeliOzeti(ortam))[0].id;
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  for (const kotu of [olay, uzak]) {
    assert.deepEqual(await ortam.durum.ipc.get('yuzey:geciktir')(kotu, { kimlik: SALON.entity_id, yon: 'kapat', dakika: 5 }), { ok: false, hata: 'İzin yok.' });
    assert.deepEqual(await ortam.durum.ipc.get('yuzey:gecikmeli-iptal')(kotu, id), { ok: false, hata: 'İzin yok.' });
  }
  assert.equal((await gecikmeliOzeti(ortam)).length, 1, 'reddedilen istekler bekleyeni değiştirmedi');
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:gecikmeli-iptal')(yuzeyOlayi(ortam, panel), id), { ok: true });
  assert.deepEqual(await gecikmeliOzeti(ortam), []);
});

// --- son değişenler (o-18) ----------------------------------------------------------------------------

const degisenOzeti = async (ortam) => (await ortam.durum.ipc.get('yuzey:durum-al')(yuzeyOlayi(ortam))).model.eylem;
/** Cihazın HA'da gerçekten değiştiğini taklit eder: sahte HA'nın durumu değişir, eylemden sonraki durum okuması yeni durumu depoya getirir. */
const temelKur = async (ortam) => {
  const panel = await paneliAc(ortam);
  for (let i = 0; i < 3; i += 1) {
    await ortam.akit(); // açılış dolumu (REST) tamamlanır
    ortam.ilerle(100); // ... ve 50 ms'lik toplu bildirimle temel çizgi olur (ilk gözlem kayıt üretmez)
  }
  await ortam.akit();
  return panel;
};
const salonDurumu = (ortam, durum) => haKur(ortam.durum, [HA_VARLIKLARI[0], durumNesnesi('light.salon_lambasi', 'Salon Lambası', durum)]);

ortamda('son değişenler (o-18): panelden açılan ışık "son değişenler"e girer; model yalnız beyaz listeli alanları taşır ve panel aynı toplu bildirimde haberdar edilir', dalga3([SALON], {}, { ha: HA_VARLIKLARI }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await temelKur(ortam);
  const baslangic = await degisenOzeti(ortam);
  assert.deepEqual([baslangic.degisenler, baslangic.degisenAcik], [[], true], 'açılış dolumu liste üretmez');
  salonDurumu(ortam, 'on');
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(200); // depo bildirimi 50 ms'de toplanır
  await ortam.akit();
  const bolum = await degisenOzeti(ortam);
  assert.equal(bolum.degisenler.length, 1);
  assert.deepEqual(Object.keys(bolum.degisenler[0]).sort(), ['ad', 'alan', 'kimlik', 'tur', 'zaman']);
  assert.deepEqual([bolum.degisenler[0].kimlik, bolum.degisenler[0].ad, bolum.degisenler[0].alan, bolum.degisenler[0].tur], [SALON.entity_id, 'Salon Lambası', 'light', 'acildi']);
  assert.ok(bolum.degisenler[0].zaman > 0);
  const sonModel = yuzeyMesajlari(ortam, 'yuzey:durum').at(-1);
  assert.equal(sonModel.eylem.degisenler.length, 1, 'bağlayıcı dinleyicisi panel modelini yenileyen dinleyiciden ÖNCE çalışır: itilen modelde kayıt var');
  assert.deepEqual(postlar(ortam).length, 1);
});

ortamda('son değişenler (o-18): ayar varsayılan açıktır; kapatılınca liste silinir, model "kapalı" der ve yeni değişiklik tutulmaz; açılınca yeniden başlar', dalga3([SALON], {}, { ha: HA_VARLIKLARI }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  assert.equal((await ortam.durum.ipc.get('ayarlar:getir')(ayarlarOlayi(ortam))).sonDegisenler, true);
  const panel = await temelKur(ortam);
  salonDurumu(ortam, 'on');
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(200);
  await ortam.akit();
  assert.equal((await degisenOzeti(ortam)).degisenler.length, 1);
  const kapat = await ayarlarKaydet(ortam, { sonDegisenler: false });
  assert.equal(kapat.ok, true);
  assert.equal(ortam.ayarOku().sonDegisenler, false);
  const kapali = await degisenOzeti(ortam);
  assert.deepEqual([kapali.degisenler, kapali.degisenAcik], [[], false]);
  ortam.ilerle(1000);
  salonDurumu(ortam, 'off');
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(200);
  await ortam.akit();
  assert.deepEqual((await degisenOzeti(ortam)).degisenler, [], 'kapalıyken kayıt yok');
  const ac = await ayarlarKaydet(ortam, { sonDegisenler: true });
  assert.equal(ac.ok, true);
  assert.equal((await degisenOzeti(ortam)).degisenAcik, true);
  assert.deepEqual((await degisenOzeti(ortam)).degisenler, [], 'açılınca boş başlar');
  ortam.ilerle(1000);
  salonDurumu(ortam, 'on');
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(200);
  await ortam.akit();
  assert.deepEqual((await degisenOzeti(ortam)).degisenler.map((d) => d.tur), ['acildi'], 'açıkken yeniden kaydeder');
});

ortamda('son değişenler (o-18): diske hiçbir şey yazılmaz — çıkıştan sonra veri klasöründe değişen kaydı yoktur', dalga3([SALON], {}, { ha: HA_VARLIKLARI }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  const panel = await temelKur(ortam);
  salonDurumu(ortam, 'on');
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: SALON.entity_id });
  ortam.ilerle(200);
  await ortam.akit();
  assert.equal((await degisenOzeti(ortam)).degisenler.length, 1, 'kayıt bellekte var');
  ortam.app.emit('before-quit');
  const klasor = ortam.durum.yollar.get('userData');
  const dosyalar = fs.readdirSync(klasor).filter((ad) => fs.statSync(path.join(klasor, ad)).isFile());
  for (const ad of dosyalar) {
    assert.ok(!/degisen/i.test(ad), `dosya adı: ${ad}`);
    assert.ok(!/"degisenler"|"tur":"acildi"/.test(fs.readFileSync(path.join(klasor, ad), 'utf8')), `içerik: ${ad}`);
  }
});

ortamda('son değişenler (o-18): priz de listeye girer; kimlik, ad ve tür beyaz listeli biçimde gelir', dalga3([SALON, { entity_id: 'switch.priz', ad: 'Priz' }], {}, { ha: [...HA_VARLIKLARI, durumNesnesi('switch.priz', 'Priz', 'off')] }), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('switch.priz', 'Priz', 'off')]);
  await ortam.akit();
  const panel = await temelKur(ortam);
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('switch.priz', 'Priz', 'on')]);
  await ortam.durum.ipc.get('yuzey:calistir')(yuzeyOlayi(ortam, panel), { kimlik: 'switch.priz' });
  ortam.ilerle(200);
  await ortam.akit();
  const bolum = await degisenOzeti(ortam);
  assert.deepEqual(bolum.degisenler.map((d) => [d.kimlik, d.tur]), [['switch.priz', 'acildi']]);
});

// --- odaya göre gruplama ve odayı kapat (o-14) --------------------------------------------------------

const ODA_PANEL_DURUMLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'on'),
  durumNesnesi('switch.salon_priz', 'Salon Priz', 'on'),
  durumNesnesi('scene.film', 'Film', 'unknown'),
  durumNesnesi('light.mutfak_lambasi', 'Mutfak Lambası', 'on'),
  durumNesnesi('light.odasiz', 'Odasız Lamba', 'on'),
];
const ODA_PANEL_FAVORILERI = [SALON, { entity_id: 'switch.salon_priz', ad: 'Salon Priz' }, { entity_id: 'scene.film', ad: 'Film' }, { entity_id: 'light.mutfak_lambasi', ad: 'Mutfak Lambası' }, { entity_id: 'light.odasiz', ad: 'Odasız Lamba' }];
const sonModel = (ortam) => yuzeyMesajlari(ortam, 'yuzey:durum').at(-1);
const odaGrubu = (ortam, ad) => sonModel(ortam).gruplar.find((g) => g.oda === true && g.etiket === ad);

async function odaPaneliKur(ortam) {
  haKur(ortam.durum, ODA_PANEL_DURUMLARI);
  const { s } = await canliYap(ortam, ODA_PANEL_DURUMLARI);
  const panel = await paneliAc(ortam);
  await odaKomutlariniYanitla(ortam, s);
  ortam.ilerle(100);
  await ortam.akit();
  return { s, panel };
}

ortamda('oda (o-14): ayar "oda" iken panel modeli odalara göre gruplanır (karo kümesi aynı, odası olmayan karo tür grubunda, grup kodu oda-<8 onaltılık>); kimlik ve alan kaydı sayfaya sızmaz', dalga3(ODA_PANEL_FAVORILERI, { panelGruplama: 'oda' }, { ha: ODA_PANEL_DURUMLARI }), async (ortam) => {
  await odaPaneliKur(ortam);
  const model = sonModel(ortam);
  const salon = odaGrubu(ortam, 'Salon');
  const mutfak = odaGrubu(ortam, 'Mutfak');
  assert.ok(salon && mutfak, 'iki oda grubu');
  assert.match(salon.kod, /^oda-[0-9a-f]{8}$/);
  assert.deepEqual(salon.karolar.map((k) => k.id).sort(), ['light.salon_lambasi', 'scene.film', 'switch.salon_priz']);
  assert.deepEqual(mutfak.karolar.map((k) => k.id), ['light.mutfak_lambasi']);
  const tumKarolar = model.gruplar.flatMap((g) => g.karolar.map((k) => k.id)).sort();
  assert.deepEqual(tumKarolar, ODA_PANEL_FAVORILERI.map((f) => f.entity_id).sort(), 'hiçbir karo eklenmedi, çıkarılmadı, tekrarlanmadı');
  const turGrubu = model.gruplar.filter((g) => g.oda !== true);
  assert.ok(turGrubu.some((g) => g.karolar.some((k) => k.id === 'light.odasiz')), 'odası olmayan karo tür grubunda kaldı');
  assert.ok(model.gruplar.filter((g) => g.oda !== true).every((g) => !('oda' in g)), 'oda işareti yalnız oda gruplarında');
  const metin = JSON.stringify(model);
  assert.equal(metin.includes('varlikAlanlari'), false, 'alan kaydı (varlikAlanlari) sayfaya gönderilmedi');
  assert.equal(metin.includes('"alanlar"'), false, 'alan listesi sayfaya gönderilmedi');
  assert.equal(metin.includes('salon"'), false, 'alan kimliği sayfaya gönderilmedi');
});

ortamda('oda (o-14): ayar "tur" (varsayılan) iken oda kaydı HİÇ istenmez; model tür gruplu kalır', dalga3(ODA_PANEL_FAVORILERI, {}, { ha: ODA_PANEL_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, ODA_PANEL_DURUMLARI);
  const { s } = await canliYap(ortam, ODA_PANEL_DURUMLARI);
  await paneliAc(ortam);
  await ortam.akit();
  ortam.ilerle(100);
  assert.equal(s.gonderilen.some((m) => String(m.type).startsWith('config/')), false, 'config/* komutu gitmedi');
  assert.equal(sonModel(ortam).gruplar.some((g) => g.oda === true), false);
});

ortamda('oda (o-14): yuzey:oda-kapat odadaki açık ışık/prizi tek güvenli hattan kapatır; sahne, başka oda ve odasız cihaza dokunulmaz; özet bildirimi tek, geri al tek girdi', dalga3(ODA_PANEL_FAVORILERI, { panelGruplama: 'oda' }, { ha: ODA_PANEL_DURUMLARI }), async (ortam) => {
  const { panel } = await odaPaneliKur(ortam);
  const salon = odaGrubu(ortam, 'Salon');
  // gerçek HA kapatma sonrası yeni durumu döner (ortak sahte turn_off'ta durumu değiştirmez)
  const temel = ortam.durum.apiYaniti;
  ortam.durum.apiYaniti = (url, secenek) => {
    if ((secenek.method ?? 'GET') === 'POST' && /\/turn_off$/.test(new URL(url).pathname)) {
      const kimlik = JSON.parse(secenek.body).entity_id;
      return json([{ ...ODA_PANEL_DURUMLARI.find((v) => v.entity_id === kimlik), state: 'off' }]);
    }
    return temel(url, secenek);
  };
  const sonuc = await ortam.durum.ipc.get('yuzey:oda-kapat')(yuzeyOlayi(ortam, panel), salon.kod);
  assert.deepEqual(sonuc, { ok: true, adet: 2 });
  assert.deepEqual(postlar(ortam).map((p) => p.url.replace('http://192.168.1.10:8123/api/services/', '')).sort(), ['light/turn_off', 'switch/turn_off']);
  assert.deepEqual(postlar(ortam).map((p) => JSON.parse(p.govde).entity_id).sort(), ['light.salon_lambasi', 'switch.salon_priz']);
  const ozet = await geriAlOzeti(ortam);
  assert.equal(ozet.adet, 1, 'oda kapatma geri alma yığınına tek girdi');
  assert.match(ozet.ad, /Salon/);
  const ozetler = koseMesajlari(ortam).filter((m) => JSON.stringify(m).includes('Salon: 2 cihaz kapatıldı'));
  assert.equal(ozetler.length, 1, 'adımlar sessiz, tek özet bildirimi');
  assert.equal(koseMesajlari(ortam).length, 1, 'başka bildirim yok');
});

ortamda('oda (o-14): yuzey:oda-kapat yalnız panelden ve yalnız oda-<8 onaltılık> koduyla; bozuk kod, cihaz kimliği ve yabancı gönderici HA\'ya hiçbir şey göndermez', dalga3(ODA_PANEL_FAVORILERI, { panelGruplama: 'oda' }, { ha: ODA_PANEL_DURUMLARI }), async (ortam) => {
  const { panel } = await odaPaneliKur(ortam);
  const isle = ortam.durum.ipc.get('yuzey:oda-kapat');
  for (const kotu of ['light.salon_lambasi', 'oda-00000000', 'salon', null, undefined, 5, {}]) {
    const yanit = await isle(yuzeyOlayi(ortam, panel), kotu);
    assert.equal(yanit.ok, false, String(kotu));
  }
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  for (const kotu of [olay, uzak]) assert.deepEqual(await isle(kotu, odaGrubu(ortam, 'Salon').kod), { ok: false, hata: 'İzin yok.' });
  assert.equal(postlar(ortam).length, 0);
});

ortamda('oda (o-14): ayar kapatılınca (oda -> tur) model tür gruplu döner ve yuzey:oda-kapat reddedilir', dalga3(ODA_PANEL_FAVORILERI, { panelGruplama: 'oda' }, { ha: ODA_PANEL_DURUMLARI }), async (ortam) => {
  const { panel } = await odaPaneliKur(ortam);
  const kod = odaGrubu(ortam, 'Salon').kod;
  const kaydet = await ayarlarKaydet(ortam, { panelGruplama: 'tur' });
  assert.notEqual(kaydet.ok, false, JSON.stringify(kaydet).slice(0, 200));
  assert.equal(ortam.ayarOku().panelGruplama, 'tur');
  ortam.ilerle(100);
  await ortam.akit();
  assert.equal(sonModel(ortam).gruplar.some((g) => g.oda === true), false, 'tür gruplu');
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:oda-kapat')(yuzeyOlayi(ortam, panel), kod), { ok: false, tur: 'kapali' });
  assert.equal(postlar(ortam).length, 0);
  // geri açılınca oda grupları yeniden gelir (kayıt önbellekte)
  assert.notEqual((await ayarlarKaydet(ortam, { panelGruplama: 'oda' })).ok, false);
  ortam.ilerle(100);
  await ortam.akit();
  assert.ok(odaGrubu(ortam, 'Salon'), 'oda grupları geri geldi');
});

// --- palette favori olmayan güvenli cihazlar (o-46) -----------------------------------------------------

const DIGER_DURUMLARI = [
  durumNesnesi('light.salon_lambasi', 'Salon Lambası', 'off'), // favori
  durumNesnesi('light.bahce', 'Bahçe Lambası', 'off'),
  durumNesnesi('switch.sulama', 'Sulama Prizi', 'on'),
  durumNesnesi('scene.sinema', 'Sinema', 'unknown'),
  durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked'),
  durumNesnesi('cover.perde', 'Salon Perdesi', 'closed'),
  durumNesnesi('button.pc_bilgisayari_kapat', 'Bilgisayarı Kapat', 'unknown'),
  durumNesnesi('light.garaj_kapisi_isigi', 'Garaj Kapısı Işığı', 'on'),
];
const DIGER_GET_SAYISI = (ortam) => ortam.durum.fetchler.filter((f) => f.yontem === 'GET' && new URL(f.url).pathname === '/api/states').length;
const digerLisleri = async (ortam, palet) => ortam.durum.ipc.get('yuzey:diger-cihazlar')(yuzeyOlayi(ortam, palet));

async function paletiAc(ortam) {
  ortam.durum.kisayollar.get('Control+Alt+P')();
  await ortam.akit();
  return ortam.yuzeyPenceresi();
}

ortamda('diğer cihazlar (o-46): ayar KAPALI (varsayılan) iken yuzey:diger-cihazlar "kapali" döner ve HA\'ya liste isteği gitmez', dalga3([SALON], {}, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const palet = await paletiAc(ortam);
  const once = DIGER_GET_SAYISI(ortam);
  assert.deepEqual(await digerLisleri(ortam, palet), { ok: false, tur: 'kapali' });
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:diger-calistir')(yuzeyOlayi(ortam, palet), { kimlik: 'light.bahce', islem: 'degistir' }), { ok: false, tur: 'kapali' });
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:diger-favori-ekle')(yuzeyOlayi(ortam, palet), 'light.bahce'), { ok: false, tur: 'kapali' });
  assert.equal(DIGER_GET_SAYISI(ortam), once, 'liste isteği yok');
  assert.equal(postlar(ortam).length, 0);
});

ortamda('diğer cihazlar (o-46): ayar açıkken liste yalnız palette ve yalnız güvenli favori olmayan cihazları içerir (kilit, perde, düğme, kapı adlı ışık, favori yok); panelden ve yabancı göndericiden alınamaz', dalga3([SALON], { paletDigerCihazlar: true }, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const panel = await paneliAc(ortam);
  assert.deepEqual(await digerLisleri(ortam, panel), { ok: false, tur: 'gecersiz' }, 'panel kipinde yok');
  ortam.tepsi.emit('click'); // paneli kapat
  await ortam.akit();
  const palet = await paletiAc(ortam);
  const yanit = await digerLisleri(ortam, palet);
  assert.equal(yanit.ok, true);
  assert.deepEqual(yanit.liste.map((d) => d.kimlik), ['light.bahce', 'scene.sinema', 'switch.sulama']);
  assert.deepEqual(yanit.liste.map((d) => d.durum), ['kapali', 'notr', 'acik']);
  assert.deepEqual(Object.keys(yanit.liste[0]).sort(), ['ad', 'alan', 'durum', 'kimlik'], 'sayfaya yalnız kısa alanlar gider');
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: 'http://192.168.1.10:8123/lovelace', parent: null } };
  for (const kanal of ['yuzey:diger-cihazlar', 'yuzey:diger-calistir', 'yuzey:diger-favori-ekle']) {
    for (const kotu of [olay, uzak]) assert.deepEqual(await ortam.durum.ipc.get(kanal)(kotu, { kimlik: 'light.bahce', islem: 'ac' }), { ok: false, hata: 'İzin yok.' }, kanal);
  }
  assert.equal(postlar(ortam).length, 0);
});

ortamda('diğer cihazlar (o-46): yuzey:diger-calistir tek güvenli hattan geçer (tek POST, kaynak palet), etkinlik geçmişine yazılır ve geri alınabilir; kilit/perde/düğme/favori kimliği POST üretmez', dalga3([SALON], { paletDigerCihazlar: true }, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const palet = await paletiAc(ortam);
  await digerLisleri(ortam, palet);
  const isle = ortam.durum.ipc.get('yuzey:diger-calistir');
  for (const kimlik of ['lock.on_kapi', 'cover.perde', 'button.pc_bilgisayari_kapat', 'light.garaj_kapisi_isigi', 'light.salon_lambasi', 'light.yok']) {
    assert.deepEqual(await isle(yuzeyOlayi(ortam, palet), { kimlik, islem: 'degistir' }), { ok: false, tur: 'bulunamadi' }, kimlik);
  }
  assert.equal(postlar(ortam).length, 0, 'listede olmayan kimlik HA\'ya hiçbir şey göndermedi');
  assert.deepEqual(await isle(yuzeyOlayi(ortam, palet), { kimlik: 'light.bahce', islem: 'degistir' }), { ok: true });
  assert.deepEqual(postlar(ortam).map((p) => p.url.replace('http://192.168.1.10:8123/api/services/', '')), ['light/toggle']);
  assert.deepEqual(postlar(ortam).map((p) => JSON.parse(p.govde)), [{ entity_id: 'light.bahce' }]);
  const kayit = (await ortam.durum.ipc.get('etkinlik:liste')(ayarlarOlayi(ortam))).kayitlar[0];
  assert.deepEqual([kayit.kaynak, kayit.kimlik, kayit.sonuc], ['palet', 'light.bahce', 'ok']);
  const ozet = await geriAlOzeti(ortam);
  assert.equal(ozet.adet, 1, 'geri al yığınında');
  assert.match(ozet.ad, /Bahçe/);
  // sahne: yalnız aç
  assert.deepEqual(await isle(yuzeyOlayi(ortam, palet), { kimlik: 'scene.sinema', islem: 'kapat' }), { ok: false, tur: 'gecersiz' });
});

ortamda('diğer cihazlar (o-46): "Favoriye ekle" cihazı favori listesinin sonuna yazar (kalıcı), paneli günceller, açık Ayarlar\'ı haberdar eder; ikinci kez eklenmez ve listeden çıkar', dalga3([SALON], { paletDigerCihazlar: true }, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const palet = await paletiAc(ortam);
  await digerLisleri(ortam, palet);
  ayarlarOlayi(ortam); // Ayarlar açık
  const haberler = () => ortam.ayarlarPenceresi().webContents.mesajlar.filter((m) => m.kanal === 'ayarlar:favoriler-degisti');
  const ekle = ortam.durum.ipc.get('yuzey:diger-favori-ekle');
  for (const kotu of ['lock.on_kapi', 'cover.perde', 'light.salon_lambasi', 'light.yok', 'button.pc_bilgisayari_kapat']) {
    assert.deepEqual(await ekle(yuzeyOlayi(ortam, palet), kotu), { ok: false, tur: 'bulunamadi' }, kotu);
  }
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => f.entity_id), ['light.salon_lambasi'], 'reddedilenler favori olmadı');
  assert.equal(haberler().length, 0);
  assert.deepEqual(await ekle(yuzeyOlayi(ortam, palet), 'light.bahce'), { ok: true });
  assert.deepEqual(ortam.ayarOku().favoriler.map((f) => [f.entity_id, f.ad]), [['light.salon_lambasi', 'Salon Lambası'], ['light.bahce', 'Bahçe Lambası']]);
  assert.equal(haberler().length, 1, 'açık Ayarlar sayfası listeyi tazeler');
  assert.equal(postlar(ortam).length, 0, 'favoriye eklemek HA\'ya yazmaz');
  ortam.ilerle(200);
  await ortam.akit();
  assert.ok(sonModel(ortam).gruplar.flatMap((g) => g.karolar).some((k) => k.id === 'light.bahce'), 'panel modeline karo girdi');
  assert.deepEqual((await ekle(yuzeyOlayi(ortam, palet), 'light.bahce')), { ok: false, tur: 'bulunamadi' }, 'artık favori: listede yok');
  assert.deepEqual((await digerLisleri(ortam, palet)).liste.map((d) => d.kimlik), ['scene.sinema', 'switch.sulama']);
  // düzen geçmişine tek nokta yazıldı (Ayarlar > Düzen geçmişinden geri alınabilir)
  const gecmis = await ortam.durum.ipc.get('duzen:gecmis')(ayarlarOlayi(ortam));
  assert.ok(gecmis.ok !== false && JSON.stringify(gecmis).length > 2, 'düzen geçmişi yanıt verdi');
});

ortamda('diğer cihazlar (o-46): ayar Ayarlar\'dan kapatılınca liste "kapali" olur ve HA\'ya yeni liste isteği gitmez; yeniden açılınca çalışır', dalga3([SALON], { paletDigerCihazlar: true }, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const palet = await paletiAc(ortam);
  assert.equal((await digerLisleri(ortam, palet)).ok, true);
  const kaydet = await ayarlarKaydet(ortam, { paletDigerCihazlar: false });
  assert.notEqual(kaydet.ok, false, JSON.stringify(kaydet).slice(0, 200));
  assert.equal(ortam.ayarOku().paletDigerCihazlar, false);
  const once = DIGER_GET_SAYISI(ortam);
  assert.deepEqual(await digerLisleri(ortam, palet), { ok: false, tur: 'kapali' });
  assert.deepEqual(await ortam.durum.ipc.get('yuzey:diger-calistir')(yuzeyOlayi(ortam, palet), { kimlik: 'light.bahce', islem: 'ac' }), { ok: false, tur: 'kapali' });
  assert.equal(DIGER_GET_SAYISI(ortam), once);
  assert.equal(postlar(ortam).length, 0);
  assert.notEqual((await ayarlarKaydet(ortam, { paletDigerCihazlar: true })).ok, false);
  assert.equal((await digerLisleri(ortam, palet)).ok, true);
});

ortamda('diğer cihazlar (o-46): liste okunamazsa ("HA yanıt vermiyor") "hata" döner; ham ileti, adres ve anahtar yanıtta ve günlükte yok', dalga3([SALON], { paletDigerCihazlar: true }, { ha: DIGER_DURUMLARI }), async (ortam) => {
  haKur(ortam.durum, DIGER_DURUMLARI);
  await ortam.akit();
  const temel = ortam.durum.apiYaniti;
  let bozuk = true;
  ortam.durum.apiYaniti = (url, secenek) => (bozuk && new URL(url).pathname === '/api/states' ? json({ hata: 1 }, 500) : temel(url, secenek));
  const palet = await paletiAc(ortam);
  const yanit = await digerLisleri(ortam, palet);
  assert.deepEqual(yanit, { ok: false, tur: 'hata' });
  assert.equal(JSON.stringify(yanit).includes('192.168'), false);
  bozuk = false;
  assert.equal((await digerLisleri(ortam, palet)).ok, true, 'hata önbelleğe alınmadı');
});

// ---------------------------------------------------------------------------
// 1.4.0 bağlantı grubu (o-55): özel HTTP üstbilgileri. Gerçek ağ yok; fetch ve oturum sahte.
// ---------------------------------------------------------------------------

const UST_DEGERI = 'GIZLI_UST_DEGER_SAHTE_1';
const UST_TOHUMU = { yerelAdres: 'http://192.168.1.50:8123', disAdres: 'https://ha.example.com' };
const ustKaydet = (ortam, liste = [{ ad: 'CF-Access-Client-Id', deger: UST_DEGERI }], olay = ayarlarOlayi(ortam)) => ortam.durum.ipc.get('baglanti:ustbilgi-kaydet')(olay, liste);
const haOturumu = (ortam) => ortam.durum.oturumlar.find((o) => o.ad === 'persist:ha');
const ustbilgiAra = (basliklar, ad) => Object.entries(basliklar ?? {}).find(([k]) => k.toLowerCase() === ad.toLowerCase());

ortamda('üstbilgi (o-55): kaydedilen özel üstbilgi yalnız kayıtlı HA adreslerine giden isteklere eklenir; anahtarsız sınama isteğinde Authorization yok; değer günlüğe, yanıta ve durum bilgisine girmez', { tohum: UST_TOHUMU, yoklama: 200, anahtar: true }, async (ortam) => {
  const sonuc = await ustKaydet(ortam);
  assert.deepEqual(JSON.parse(JSON.stringify(sonuc)), { ok: true, adlar: ['CF-Access-Client-Id'] });
  const sina = (adres, tur) => ortam.durum.ipc.get('ayarlar:adres-sina')(ayarlarOlayi(ortam), adres, tur);
  const once = ortam.durum.fetchler.length; // açılış yoklamaları (üstbilgi kaydedilmeden önce) sayılmaz

  await sina(UST_TOHUMU.yerelAdres, 'yerel');
  const kayitli = ortam.durum.fetchler.slice(once).filter((f) => f.url === `${UST_TOHUMU.yerelAdres}/manifest.json`);
  assert.equal(kayitli.length, 1);
  assert.equal(ustbilgiAra(kayitli[0].basliklar, 'CF-Access-Client-Id')?.[1], UST_DEGERI, 'kayıtlı adrese üstbilgi eklenir');
  assert.equal(ustbilgiAra(kayitli[0].basliklar, 'Authorization'), undefined, 'sınama isteği anahtar taşımaz');

  await sina('http://192.168.1.99:8123', 'yerel'); // kayıtlı olmayan adres: üstbilgi gitmez
  const baska = ortam.durum.fetchler.filter((f) => f.url === 'http://192.168.1.99:8123/manifest.json');
  assert.equal(baska.length, 1);
  assert.equal(ustbilgiAra(baska[0].basliklar, 'CF-Access-Client-Id'), undefined, 'kayıtlı olmayan adrese üstbilgi sızmaz');

  const durumYaniti = await ortam.durum.ipc.get('baglanti:durum')(ayarlarOlayi(ortam));
  assert.deepEqual(JSON.parse(JSON.stringify(durumYaniti.ustbilgi)), { adlar: ['CF-Access-Client-Id'], enCok: 8 });
  const hepsi = JSON.stringify([durumYaniti, sonuc, ortam.gunlukOku(), ortam.durum.bildirimler.map((b) => b.body), ortam.durum.pano]);
  assert.equal(hepsi.includes(UST_DEGERI), false, 'değer hiçbir yanıtta ya da günlükte yok');
});

ortamda('üstbilgi (o-55): HA penceresi oturumuna yalnız üstbilgi tanımlıyken kanca kurulur; kanca üstbilgiyi sadece HA kökenine ekler, mevcut üstbilgilere dokunmaz; silinince kanca kalkar', { tohum: UST_TOHUMU, yoklama: 200 }, async (ortam) => {
  await ortam.akit();
  const ha = haOturumu(ortam);
  assert.ok(ha, 'HA oturumu var');
  assert.equal(ha.ustbilgiDinleyici ?? null, null, 'üstbilgi yokken kanca yok: HA penceresi bugünkü gibi');

  await ustKaydet(ortam);
  await ortam.akit();
  assert.equal(typeof ha.ustbilgiDinleyici, 'function');
  const calistir = (url, basliklar) =>
    new Promise((coz) => {
      ha.ustbilgiDinleyici({ url, requestHeaders: { ...basliklar } }, (yanit) => coz(yanit.requestHeaders));
    });
  const haIstegi = await calistir(`${UST_TOHUMU.yerelAdres}/lovelace`, { Cookie: 'oturum=1', 'User-Agent': 'x' });
  assert.equal(haIstegi['CF-Access-Client-Id'], UST_DEGERI);
  assert.equal(haIstegi.Cookie, 'oturum=1', 'mevcut üstbilgilere dokunulmaz');
  const disIstek = await calistir('https://ha.example.com/api/websocket', {});
  assert.equal(disIstek['CF-Access-Client-Id'], UST_DEGERI, 'kayıtlı dış adres de kapsanır');
  const yabanci = await calistir('https://baska-site.example.net/x.js', {});
  assert.equal(ustbilgiAra(yabanci, 'CF-Access-Client-Id'), undefined, 'HA dışı köken: üstbilgi yok');
  const baskaPort = await calistir('http://192.168.1.50:9999/x', {});
  assert.equal(ustbilgiAra(baskaPort, 'CF-Access-Client-Id'), undefined, 'aynı ana bilgisayar ama başka port: üstbilgi yok');

  await ortam.durum.ipc.get('baglanti:ustbilgi-sil')(ayarlarOlayi(ortam));
  await ortam.akit();
  assert.equal(ha.ustbilgiDinleyici, null, 'tüm üstbilgiler silinince kanca kalkar');
});

ortamda('üstbilgi (o-55): IPC kanalları yalnız Ayarlar penceresine yanıt verir; geçersiz ve yasak üstbilgiler kaydedilmez', { tohum: UST_TOHUMU, yoklama: 200 }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: `${UST_TOHUMU.yerelAdres}/lovelace`, parent: null } };
  for (const kanal of ['baglanti:durum', 'baglanti:ustbilgi-kaydet', 'baglanti:ustbilgi-sil', 'baglanti:ustbilgi-dene']) {
    assert.deepEqual(JSON.parse(JSON.stringify(await ortam.durum.ipc.get(kanal)(uzak, [{ ad: 'X-Ek', deger: 'v' }]))), { ok: false, hata: 'İzin yok.' }, `${kanal}: uzak sayfa reddedilir`);
  }
  assert.equal((await ortam.durum.ipc.get('baglanti:durum')(olay)).ustbilgi.adlar.length, 0, 'reddedilen çağrı bir şey kaydetmedi');

  const yasak = JSON.parse(JSON.stringify(await ustKaydet(ortam, [{ ad: 'Authorization', deger: 'Bearer x' }, { ad: 'X-Iyi', deger: 'ok' }])));
  assert.equal(yasak.ok, false);
  assert.deepEqual(yasak.hatalar, [{ sira: 0, neden: 'ad-yasak' }]);
  assert.equal((await ortam.durum.ipc.get('baglanti:durum')(olay)).ustbilgi.adlar.length, 0, 'kısmi kayıt yok: ya hep ya hiç');
  const satirSonu = JSON.parse(JSON.stringify(await ustKaydet(ortam, [{ ad: 'X-Iyi', deger: 'a\r\nHost: kotu' }])));
  assert.equal(satirSonu.ok, false);
  assert.equal(satirSonu.hatalar[0].neden, 'deger-gecersiz');
  const kotuYuk = await ortam.durum.ipc.get('baglanti:ustbilgi-kaydet')(olay, 'x');
  assert.equal(kotuYuk.ok, false);
});

ortamda('üstbilgi (o-55): "Üstbilgileri dene" kayıtlı adresleri anahtarsız yoklar ve sonuçları döner; ayar dosyasına üstbilgi girmez', { tohum: UST_TOHUMU, yoklama: 403, anahtar: true }, async (ortam) => {
  await ustKaydet(ortam);
  const once = ortam.durum.fetchler.length;
  const yanit = JSON.parse(JSON.stringify(await ortam.durum.ipc.get('baglanti:ustbilgi-dene')(ayarlarOlayi(ortam))));
  assert.equal(yanit.ok, true);
  assert.deepEqual(yanit.sonuclar.map((s) => [s.tur, s.neden]), [['yerel', 'erisim-engelli'], ['dis', 'erisim-engelli']]);
  const denemeler = ortam.durum.fetchler.slice(once).filter((f) => f.url.endsWith('/manifest.json'));
  assert.equal(denemeler.length, 2);
  for (const d of denemeler) {
    assert.equal(ustbilgiAra(d.basliklar, 'CF-Access-Client-Id')?.[1], UST_DEGERI);
    assert.equal(ustbilgiAra(d.basliklar, 'Authorization'), undefined);
  }
  assert.equal(JSON.stringify(yanit).includes(UST_DEGERI), false);
  assert.equal(JSON.stringify(ortam.ayarOku()).includes(UST_DEGERI), false, 'ayarlar.json üstbilgi değeri taşımaz');
  assert.equal(JSON.stringify(ortam.ayarOku()).includes('CF-Access-Client-Id'), false, 'üstbilgi adı da ayar dosyasına yazılmaz');
});

// ---------------------------------------------------------------------------
// 1.4.0 bağlantı grubu (o-56): sertifika güveni (özel kök CA / parmak izi sabitleme). Gerçek ağ yok; oturum ve diyalog sahte.
// ---------------------------------------------------------------------------

const SERT_TOHUMU = { yerelAdres: 'http://192.168.1.50:8123', disAdres: 'https://ha.example.com' };
const sertIpc = (ortam, kanal, ...args) => ortam.durum.ipc.get(kanal)(ayarlarOlayi(ortam), ...args);
const sertOturumlari = (ortam) => ortam.durum.oturumlar.filter((o) => o.ad === 'persist:ha' || o.ad === 'varsayilan');
const sertIstek = (hostname, sertifika, sonuc = 'net::ERR_CERT_AUTHORITY_INVALID') => ({ hostname, certificate: { data: sertifika.pem }, verificationResult: sonuc });
const sertKarar = (oturum, istek) => new Promise((coz) => oturum.sertifikaProc(istek, coz));

ortamda('sertifika (o-56): kayıt yokken oturumlarda doğrulama kancası yoktur; parmak izi sabitlenince HA ve varsayılan oturuma kurulur, yalnız HA ana bilgisayarı için karar verir; silinince kalkar', { tohum: SERT_TOHUMU, yoklama: 200 }, async (ortam) => {
  const { sertifikaUret } = require('./sertifika-uret');
  await ortam.akit();
  const oturumlar = sertOturumlari(ortam);
  assert.equal(oturumlar.length >= 2, true);
  for (const o of oturumlar) assert.equal(o.sertifikaProc ?? null, null, `${o.ad}: kayıt yokken kanca yok (tarayıcı varsayılanı)`);

  const sabit = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const baska = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const kaydet = await sertIpc(ortam, 'baglanti:parmak-kaydet', 'dis', sabit.parmakIzi.toUpperCase().replace(/(..)(?!$)/g, '$1:'));
  assert.equal(kaydet.ok, true);
  await ortam.akit();
  for (const o of oturumlar) {
    assert.equal(typeof o.sertifikaProc, 'function', `${o.ad}: kanca kuruldu`);
    assert.equal(await sertKarar(o, sertIstek('ha.example.com', sabit)), 0);
    assert.equal(await sertKarar(o, sertIstek('ha.example.com', baska, 'net::OK')), -2, 'sabitlenmeyen sertifika reddedilir (sistem güvense bile)');
    assert.equal(await sertKarar(o, sertIstek('baska-site.example.net', baska)), -3, 'HA dışı site: Chromium sonucu');
    assert.equal(await sertKarar(o, sertIstek('192.168.1.50', baska)), -3, 'http ev içi adres TLS değil: kapsam dışı');
  }

  const sil = await sertIpc(ortam, 'baglanti:parmak-sil', 'ha.example.com');
  assert.equal(sil.ok, true);
  await ortam.akit();
  for (const o of oturumlar) assert.equal(o.sertifikaProc, null, `${o.ad}: tüm kayıtlar silinince kanca kalktı`);
});

ortamda('sertifika (o-56): kök sertifika Ayarlar\'dan seçilen dosyadan eklenir; PEM ve parmak izi ayar dosyasına, dışa aktarıma, günlüğe ve yanıta girmez; içe aktarma güven köklerini değiştiremez', { tohum: SERT_TOHUMU, yoklama: 200 }, async (ortam) => {
  const { zincirUret } = require('./sertifika-uret');
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const dosya = path.join(ortam.durum.appData, 'ev-kok.pem');
  fs.writeFileSync(dosya, ca.pem, 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [dosya] };

  const ekle = await sertIpc(ortam, 'baglanti:ca-ekle');
  assert.equal(ekle.ok, true);
  assert.equal(ekle.eklenen, 1);
  const diyalog = ortam.durum.dosyaDiyaloglari.at(-1);
  assert.equal(diyalog.tur, 'ac');
  assert.deepEqual(diyalog.secenek.properties, ['openFile']);
  assert.equal(diyalog.secenek.title, 'Kök sertifika seç');
  assert.deepEqual(diyalog.secenek.filters[0].extensions, ['pem', 'crt', 'cer', 'der']);

  await ortam.akit();
  const oturum = sertOturumlari(ortam)[0];
  assert.equal(await sertKarar(oturum, sertIstek('ha.example.com', sunucu)), 0, 'özel kökle imzalı sertifika kabul');
  const digerSunucu = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] }).sunucu;
  assert.equal(await sertKarar(oturum, sertIstek('ha.example.com', digerSunucu)), -3, 'başka CA imzalı sertifika');

  // Hiçbir yanıt, ayar dosyası ya da günlük PEM / parmak izi taşımaz
  const durum = await sertIpc(ortam, 'baglanti:durum');
  assert.deepEqual(durum.sertifika.ca.map((k) => k.parmak), [ca.parmakIzi]);
  assert.equal(JSON.stringify([ekle, durum]).includes('BEGIN CERTIFICATE'), false, 'yanıtlarda PEM yok (parmak izi ve ad Ayarlar sayfasına gider)');
  const sizinti = JSON.stringify([ortam.ayarOku(), ortam.gunlukOku(), ortam.durum.bildirimler.map((b) => b.body), ortam.durum.pano]);
  assert.equal(sizinti.includes('BEGIN CERTIFICATE'), false);
  assert.equal(sizinti.includes(ca.parmakIzi), false, 'parmak izi ayar dosyasına/günlüğe yazılmaz');
  const kayitDosyasi = path.join(ortam.durum.yollar.get('userData'), 'sertifika-guveni.json');
  assert.equal(JSON.parse(fs.readFileSync(kayitDosyasi, 'utf8')).ca.length, 1, 'kayıt ayrı dosyada');

  // Dışa aktarma güven köklerini taşımaz
  const hedef = path.join(ortam.durum.appData, 'disa');
  ortam.durum.dosyaSecimi = { canceled: false, filePath: hedef };
  assert.equal((await sertIpc(ortam, 'ayarlar:disa-aktar')).ok, true);
  const disaMetni = fs.readFileSync(`${hedef}.json`, 'utf8');
  assert.equal(/BEGIN CERTIFICATE|sertifika|parmak/i.test(disaMetni) || disaMetni.includes(ca.parmakIzi), false, 'dışa aktarma sertifika güveni taşımaz');

  // İçe aktarılan bir dosya kök/sabitleme ekleyemez ya da silemez
  const once = fs.readFileSync(kayitDosyasi, 'utf8');
  const ice = path.join(ortam.durum.appData, 'sinsi.json');
  fs.writeFileSync(ice, AKTARIM_DOSYASI({ koseBildirimi: false, ca: [{ pem: digerSunucu.pem }], sabit: [{ anaBilgisayar: 'ha.example.com', parmak: 'ab'.repeat(32) }], sertifikaSabit: { 'ha.example.com': 'ab'.repeat(32) } }), 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [ice] };
  await sertIpc(ortam, 'ayarlar:ice-aktar');
  assert.equal(fs.readFileSync(kayitDosyasi, 'utf8'), once, 'içe aktarma sertifika kaydına dokunamaz');
  assert.equal(JSON.stringify(ortam.ayarOku()).includes('sabit'), false);
});

ortamda('sertifika (o-56): özel anahtar içeren ya da kök olmayan dosya eklenmez; iptal sessizdir; sertifika kanalları yalnız Ayarlar penceresine yanıt verir', { tohum: SERT_TOHUMU, yoklama: 200 }, async (ortam) => {
  const { sertifikaUret } = require('./sertifika-uret');
  const yaprak = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const anahtarli = path.join(ortam.durum.appData, 'anahtarli.pem');
  fs.writeFileSync(anahtarli, `${yaprak.pem}\n${yaprak.privateKeyPem}`, 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [anahtarli] };
  assert.deepEqual(JSON.parse(JSON.stringify(await sertIpc(ortam, 'baglanti:ca-ekle'))), { ok: false, neden: 'ozel-anahtar' });
  const yalnizYaprak = path.join(ortam.durum.appData, 'yaprak.pem');
  fs.writeFileSync(yalnizYaprak, yaprak.pem, 'utf8');
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [yalnizYaprak] };
  assert.deepEqual(JSON.parse(JSON.stringify(await sertIpc(ortam, 'baglanti:ca-ekle'))), { ok: false, neden: 'ca-degil' });
  ortam.durum.dosyaSecimi = { canceled: true, filePaths: [] };
  assert.deepEqual(JSON.parse(JSON.stringify(await sertIpc(ortam, 'baglanti:ca-ekle'))), { ok: false, iptal: true });
  assert.equal((await sertIpc(ortam, 'baglanti:durum')).sertifika.ca.length, 0);

  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: `${SERT_TOHUMU.disAdres}/lovelace`, parent: null } };
  const once = ortam.durum.dosyaDiyaloglari.length;
  for (const kanal of ['baglanti:sertifika-oku', 'baglanti:parmak-kaydet', 'baglanti:parmak-sil', 'baglanti:ca-ekle', 'baglanti:ca-sil']) {
    assert.deepEqual(JSON.parse(JSON.stringify(await ortam.durum.ipc.get(kanal)(uzak, 'dis', 'ab'.repeat(32)))), { ok: false, hata: 'İzin yok.' }, `${kanal}: uzak sayfa reddedilir`);
  }
  assert.equal(ortam.durum.dosyaDiyaloglari.length, once, 'reddedilen çağrı dosya diyaloğu açmaz');
});

ortamda('sertifika (o-56): sunucu sertifikası okuma yalnız https HA adresi için çalışır; http adreste ağa çıkılmaz', { tohum: SERT_TOHUMU, yoklama: 200 }, async (ortam) => {
  const once = ortam.durum.fetchler.length;
  assert.deepEqual(JSON.parse(JSON.stringify(await sertIpc(ortam, 'baglanti:sertifika-oku', 'yerel'))), { ok: false, neden: 'https-degil' });
  assert.equal(ortam.durum.fetchler.length, once);
});

// ---------------------------------------------------------------------------
// 1.4.0 bağlantı grubu (o-57): tarayıcıyla giriş (OAuth). Gerçek HA ve internet yok: /auth/token yanıtları sahte net.fetch'tir;
// geri çağrı dinleyicisi GERÇEKTEN 127.0.0.1'de açılır ve döngü adresinden gerçek HTTP isteğiyle çağrılır. Tarayıcı açılmaz (shell sahte).
// ---------------------------------------------------------------------------

const OT_TABAN = 'http://192.168.1.50:8123';
const OT_TOHUMU = { yerelAdres: OT_TABAN, disAdres: '' };
const OT_YENILEME = 'GIZLI-YENILEME-ANAHTARI-SAHTE-0001';
const OT_KOD = 'GIZLI-GIRIS-KODU-SAHTE-0001';
const otErisim = (n) => `GIZLI-ERISIM-ANAHTARI-SAHTE-${n}.${'x'.repeat(24)}`;
const OT_ISTEMCI = 'http://127.0.0.1:41000/ev-paneli';
const OT_OTURUM_DOSYASI = { 'oauth-oturum.dat': SIFRE_ONEKI + require('../src/lib/oauth').oturumuYaz({ taban: OT_TABAN, istemci: OT_ISTEMCI, yenileme: OT_YENILEME }) };
const otDuz = (x) => JSON.parse(JSON.stringify(x));
const otKayit = () => ({ jetonIstekleri: [], sayac: 0 });

/**
 * Sahte HA: /auth/token (kod değişimi, yenileme, iptal) + REST. erisimGecerli(jeton): Bearer jeton kabul mü (değilse 401);
 * kodYaniti / yenilemeYaniti(form): varsayılan başarılı yanıtın yerine geçer.
 */
function otHa(kayit, { erisimGecerli = () => true, kodYaniti = null, yenilemeYaniti = null } = {}) {
  const normal = haYanitiOlustur(HA_VARLIKLARI);
  return (url, secenek) => {
    const yol = new URL(url).pathname;
    if (yol === '/auth/token') {
      const form = new URLSearchParams(secenek.body);
      kayit.jetonIstekleri.push({ url, form: Object.fromEntries(form), basliklar: secenek.headers, yontem: secenek.method });
      if (form.get('action') === 'revoke') return json({});
      if (form.get('grant_type') === 'authorization_code') return kodYaniti?.(form) ?? json({ access_token: otErisim((kayit.sayac += 1)), token_type: 'Bearer', refresh_token: OT_YENILEME, expires_in: 1800 });
      if (form.get('grant_type') === 'refresh_token') return yenilemeYaniti?.(form) ?? json({ access_token: otErisim((kayit.sayac += 1)), token_type: 'Bearer', expires_in: 1800 });
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    const yetki = secenek.headers?.Authorization;
    if (yol.startsWith('/api/') && yetki && !erisimGecerli(yetki.replace(/^Bearer /, ''))) return json({ message: '401: Unauthorized' }, 401);
    return normal(url, secenek);
  };
}

const oturumIpc = (ortam, kanal, ...args) => ortam.durum.ipc.get(kanal)(ayarlarOlayi(ortam), ...args);
const oturumDosyasi = (ortam) => path.join(ortam.durum.yollar.get('userData'), 'oauth-oturum.dat');
const elleAnahtarDosyasi = (ortam) => path.join(ortam.durum.yollar.get('userData'), 'anahtar.dat');
const jetonPostlari = (kayit, ne) => kayit.jetonIstekleri.filter((i) => i.form.grant_type === ne || (ne === 'iptal' && i.form.action === 'revoke'));
const oturumBildirimleri = (ortam) => ortam.durum.bildirimler.filter((b) => b.body === ANA_SOZLUK.tr['bildirim.oturumSonlandi']);

/** Gerçek (gerçek zamanlı) bekleme: sahte zamanlayıcılar açıkken yalnız setImmediate güvenilir; G/Ç için olay döngüsü döndürülür. */
async function otBekle(kosul, ad) {
  for (let i = 0; i < 20000; i += 1) {
    if (await kosul()) return;
    await new Promise((coz) => setImmediate(coz));
  }
  assert.fail(`zaman aşımı: ${ad}`);
}

/** Döngü adresine gerçek HTTP isteği; dinleyici kapalıysa { hata } döner. */
function otCagri(kapi, yol, { host } = {}) {
  return new Promise((coz) => {
    const istek = http.request({ host: '127.0.0.1', port: kapi, path: yol, method: 'GET', headers: host ? { Host: host } : {}, agent: false }, (yanit) => {
      const parcalar = [];
      yanit.on('data', (p) => parcalar.push(p));
      yanit.on('end', () => coz({ durum: yanit.statusCode, govde: Buffer.concat(parcalar).toString('utf8') }));
    });
    istek.on('error', (hata) => coz({ hata: hata.code ?? 'HATA' }));
    istek.end();
  });
}

/** Girişi başlatır; tarayıcıya verilen adresten dinleme kapısı ile state çıkarılır. */
async function otGirisBaslat(ortam) {
  const yanit = await oturumIpc(ortam, 'oturum:giris-baslat');
  assert.deepEqual(otDuz(yanit), { ok: true });
  assert.equal(ortam.durum.disariAcilanlar.length, 1, 'tarayıcı TEK kez açılır');
  const url = new URL(ortam.durum.disariAcilanlar.at(-1));
  return { url, kapi: Number(new URL(url.searchParams.get('redirect_uri')).port), state: url.searchParams.get('state'), istemci: url.searchParams.get('client_id') };
}

function otSirsiz(ortam, sirlar, ek = []) {
  const hepsi = JSON.stringify([ortam.ayarOku(), ortam.gunlukOku(), ortam.durum.bildirimler.map((b) => b.body), ortam.durum.pano, koseMesajlari(ortam), ortam.tepsi.ipuclari, ...ek]);
  for (const sir of sirlar) assert.equal(hepsi.includes(sir), false, `sır sızdı: ${sir.slice(0, 12)}…`);
}

const k_giris = otKayit();
ortamda('oturum (o-57): tarayıcıyla giriş: adres yalnız ayardaki HA kökeninden kurulur; yanlış state/yanlış Host/yanlış yol kabul edilmez; doğru geri çağrı kodu değiştirir, elle anahtarın yerini alır, sırlar hiçbir yere sızmaz', { tohum: OT_TOHUMU, yoklama: 200, anahtar: true, apiYaniti: otHa(k_giris) }, async (ortam) => {
  await ortam.akit();
  const once = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(once.girisTuru, 'anahtar');
  assert.equal(once.anahtarVar, true);
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.asama, 'yok');
  assert.deepEqual(ortam.durum.disariAcilanlar, [], 'kullanıcı istemeden tarayıcı açılmaz');

  const g = await otGirisBaslat(ortam);
  assert.equal(g.url.origin, OT_TABAN);
  assert.equal(g.url.pathname, '/auth/authorize');
  assert.equal(g.istemci, `http://127.0.0.1:${g.kapi}/ev-paneli`);
  assert.equal(g.url.searchParams.get('redirect_uri'), `http://127.0.0.1:${g.kapi}/callback`);
  assert.equal([...g.url.searchParams.keys()].sort().join(','), 'client_id,redirect_uri,state', 'adreste başka alan yok');
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.asama, 'bekliyor');
  assert.deepEqual(otDuz(await oturumIpc(ortam, 'oturum:giris-baslat')), { ok: false, neden: 'suruyor' }, 'ikinci giriş başlatılamaz');

  // Geçersiz geri çağrılar kod değişimine yol açmaz ve beklemeyi bozmaz
  const yanlisState = await otCagri(g.kapi, `/callback?code=${OT_KOD}&state=${'a'.repeat(43)}`);
  assert.notEqual(yanlisState.durum, 200);
  const yanlisHost = await otCagri(g.kapi, `/callback?code=${OT_KOD}&state=${g.state}`, { host: 'evil.example.com' });
  assert.notEqual(yanlisHost.durum, 200);
  const yanlisYol = await otCagri(g.kapi, `/baska?code=${OT_KOD}&state=${g.state}`);
  assert.notEqual(yanlisYol.durum, 200);
  await ortam.akit();
  assert.equal(jetonPostlari(k_giris, 'authorization_code').length, 0, 'geçersiz geri çağrılar /auth/token\'a gitmez');
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.asama, 'bekliyor');

  // Doğru geri çağrı
  const iyi = await otCagri(g.kapi, `/callback?code=${OT_KOD}&state=${g.state}`);
  assert.equal(iyi.durum, 200);
  assert.equal(iyi.govde.includes(OT_KOD), false, 'sayfa kodu yansıtmaz');
  await otBekle(async () => (await oturumIpc(ortam, 'oturum:durum')).oturum.var === true, 'oturum açıldı');
  await ortam.akit();

  const kodIstegi = jetonPostlari(k_giris, 'authorization_code');
  assert.equal(kodIstegi.length, 1);
  assert.equal(kodIstegi[0].url, `${OT_TABAN}/auth/token`);
  assert.equal(kodIstegi[0].yontem, 'POST');
  assert.equal(kodIstegi[0].form.code, OT_KOD);
  assert.equal(kodIstegi[0].form.client_id, g.istemci);
  assert.equal(kodIstegi[0].basliklar['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(kodIstegi[0].basliklar.Authorization, undefined, 'jeton ucu Authorization taşımaz');
  assert.equal((await otCagri(g.kapi, '/')).hata, 'ECONNREFUSED', 'giriş bitince dinleyici kapanır');

  // Durum: tarayıcı oturumu, elle anahtar yerini bıraktı
  const sonra = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(sonra.girisTuru, 'tarayici');
  assert.equal(sonra.anahtarVar, true);
  assert.equal(fs.existsSync(elleAnahtarDosyasi(ortam)), false, 'elle anahtar dosyası silindi (tek giriş türü)');
  const depolanan = fs.readFileSync(oturumDosyasi(ortam), 'utf8');
  assert.ok(depolanan.startsWith(SIFRE_ONEKI), 'oturum safeStorage ile şifreli yazılır');
  assert.ok(depolanan.includes(OT_YENILEME), 'yenileme anahtarı (şifreli) kayıtta');
  assert.equal(depolanan.includes(otErisim(1)), false, 'erişim anahtarı diske yazılmaz');
  const durumYaniti = otDuz((await oturumIpc(ortam, 'oturum:durum')).oturum);
  assert.equal(durumYaniti.var, true);
  assert.equal(durumYaniti.anaBilgisayar, '192.168.1.50:8123');
  assert.equal(durumYaniti.son.sonuc, 'tamam');

  // Sonraki HA çağrıları yeni erişim anahtarıyla gider; HA kökeni dışına hiçbir istek çıkmaz
  await oturumIpc(ortam, 'cihazlar:getir');
  const kimlikli = kimlikliler(ortam);
  assert.ok(kimlikli.length > 0);
  assert.equal(kimlikli.at(-1).basliklar.Authorization, `Bearer ${otErisim(1)}`);
  assert.ok(ortam.durum.fetchler.every((f) => f.url.startsWith(OT_TABAN)), 'yalnız ayardaki HA adresine istek gider');
  assert.ok(ortam.ayarlarPenceresi().webContents.mesajlar.some((m) => m.kanal === 'ayarlar:oturum-degisti'), 'Ayarlar penceresine değişiklik bildirildi');

  // Sızıntı: ayar dosyası, günlük, bildirim, pano, dışa aktarma, yanıtlar
  const hedef = path.join(ortam.durum.appData, 'disa-oturum');
  ortam.durum.dosyaSecimi = { canceled: false, filePath: hedef };
  assert.equal((await oturumIpc(ortam, 'ayarlar:disa-aktar')).ok, true);
  const disaMetni = fs.readFileSync(`${hedef}.json`, 'utf8');
  otSirsiz(ortam, [OT_YENILEME, OT_KOD, otErisim(1), g.state], [disaMetni, sonra, durumYaniti]);
  assert.equal(/oauth|oturum|yenileme ?anahtar|refresh/i.test(disaMetni), false, 'dışa aktarma giriş bilgisi taşımaz'); // kameraYenilemeSn gibi tercih adları giriş bilgisi değildir
});

const k_kod = otKayit();
ortamda('oturum (o-57): HA giriş kodunu reddederse oturum açılmaz, elle yapıştırılmış anahtar korunur; hata kodu Ayarlar\'a döner, sır dönmez', {
  tohum: OT_TOHUMU,
  yoklama: 200,
  anahtar: true,
  apiYaniti: otHa(k_kod, { kodYaniti: () => json({ error: 'invalid_request', error_description: 'Invalid code' }, 400) }),
}, async (ortam) => {
  const g = await otGirisBaslat(ortam);
  assert.equal((await otCagri(g.kapi, `/callback?code=${OT_KOD}&state=${g.state}`)).durum, 200);
  await otBekle(async () => (await oturumIpc(ortam, 'oturum:durum')).oturum.son?.sonuc === 'hata', 'giriş hatası');
  const durum = otDuz((await oturumIpc(ortam, 'oturum:durum')).oturum);
  assert.equal(durum.var, false);
  assert.equal(durum.son.neden, 'kod-reddedildi');
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false);
  assert.equal(fs.existsSync(elleAnahtarDosyasi(ortam)), true, 'başarısız girişte elle anahtar silinmez');
  assert.equal((await oturumIpc(ortam, 'ayarlar:getir')).girisTuru, 'anahtar');
  otSirsiz(ortam, [OT_KOD, g.state], [durum]);
});

const k_iptal = otKayit();
ortamda('oturum (o-57): giriş iptali ve 5 dakikalık zaman aşımı dinleyiciyi kapatır; uygulama kapanırken açık dinleyici kalmaz; iptalden sonra gelen geri çağrı işlenmez', { tohum: OT_TOHUMU, yoklama: 200, apiYaniti: otHa(k_iptal) }, async (ortam) => {
  const a = await otGirisBaslat(ortam);
  assert.deepEqual(otDuz(await oturumIpc(ortam, 'oturum:giris-iptal')), { ok: true });
  assert.equal((await otCagri(a.kapi, '/')).hata, 'ECONNREFUSED', 'iptalde dinleyici kapanır');
  const gec = await otCagri(a.kapi, `/callback?code=${OT_KOD}&state=${a.state}`);
  assert.equal(gec.hata, 'ECONNREFUSED');
  assert.equal(jetonPostlari(k_iptal, 'authorization_code').length, 0);
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.son.sonuc, 'iptal');

  // Zaman aşımı
  ortam.durum.disariAcilanlar.length = 0;
  const b = await otGirisBaslat(ortam);
  assert.equal((await otCagri(b.kapi, '/')).durum !== undefined, true, 'bekleme sürerken dinleyici açık');
  ortam.ilerle(5 * 60_000 + 1000);
  await otBekle(async () => (await otCagri(b.kapi, '/')).hata === 'ECONNREFUSED', 'zaman aşımı kapanışı');
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.son.sonuc, 'zaman-asimi');

  // Kapanış
  ortam.durum.disariAcilanlar.length = 0;
  const c = await otGirisBaslat(ortam);
  ortam.app.emit('before-quit');
  await otBekle(async () => (await otCagri(c.kapi, '/')).hata === 'ECONNREFUSED', 'çıkışta kapanış');
  assert.equal(jetonPostlari(k_iptal, 'authorization_code').length, 0);
});

ortamda('oturum (o-57): oturum kanalları yalnız Ayarlar penceresine yanıt verir; HA adresine ulaşılamıyorsa giriş başlamaz ve tarayıcı açılmaz', { tohum: OT_TOHUMU, yoklama: null }, async (ortam) => {
  const olay = ayarlarOlayi(ortam);
  const uzak = { sender: olay.sender, senderFrame: { url: `${OT_TABAN}/lovelace`, parent: null } };
  for (const kanal of ['oturum:durum', 'oturum:giris-baslat', 'oturum:giris-iptal', 'oturum:cikis']) {
    assert.deepEqual(otDuz(await ortam.durum.ipc.get(kanal)(uzak)), { ok: false, hata: 'İzin yok.' }, `${kanal}: uzak sayfa reddedilir`);
  }
  assert.deepEqual(ortam.durum.disariAcilanlar, []);
  assert.deepEqual(otDuz(await oturumIpc(ortam, 'oturum:giris-baslat')), { ok: false, neden: 'adres-yok' });
  assert.deepEqual(ortam.durum.disariAcilanlar, [], 'adres yokken tarayıcı açılmaz');
  assert.equal(ortam.durum.fetchler.filter((f) => f.url.includes('/auth/')).length, 0);
});

ortamda('oturum (o-57): tarayıcı açılamazsa giriş başlamaz ve dinleyici kapanır', { tohum: OT_TOHUMU, yoklama: 200 }, async (ortam) => {
  ortam.durum.disariAcmaHatasi = true;
  const yanit = otDuz(await oturumIpc(ortam, 'oturum:giris-baslat'));
  assert.deepEqual(yanit, { ok: false, neden: 'tarayici' });
  const durum = (await oturumIpc(ortam, 'oturum:durum')).oturum;
  assert.equal(durum.asama, 'yok');
});

const k_yenile = otKayit();
ortamda('oturum (o-57): kayıtlı oturumla açılışta erişim anahtarı yenilenir (TEK yenileme isteği, Authorization yok), sonraki istekler Bearer ile gider; süre dolmadan önce yenilenir; erişim anahtarı diske yazılmaz', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_yenile) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const yenilemeler = jetonPostlari(k_yenile, 'refresh_token');
  assert.equal(yenilemeler.length, 1, 'açılışta eşzamanlı çağrılar tek yenilemeyi paylaşır');
  assert.equal(yenilemeler[0].form.refresh_token, OT_YENILEME);
  assert.equal(yenilemeler[0].form.client_id, OT_ISTEMCI, 'yenileme, oturumu veren istemci kimliğiyle yapılır');
  assert.equal(yenilemeler[0].basliklar.Authorization, undefined);
  assert.ok(kimlikliler(ortam).length > 0);
  for (const f of kimlikliler(ortam)) assert.equal(f.basliklar.Authorization, `Bearer ${otErisim(1)}`);
  assert.equal((await oturumIpc(ortam, 'ayarlar:getir')).girisTuru, 'tarayici');

  // Süre dolmadan önce (3 dk) yeni erişim anahtarı alınır; kimlik doğrulama için fazladan GET /api/ yok
  const apiOnce = ortam.durum.fetchler.filter((f) => new URL(f.url).pathname === '/api/').length;
  ortam.ilerle(28 * 60_000);
  await oturumIpc(ortam, 'cihazlar:getir');
  await ortam.akit();
  assert.equal(jetonPostlari(k_yenile, 'refresh_token').length, 2, 'süre dolmadan yenilendi');
  assert.equal(kimlikliler(ortam).at(-1).basliklar.Authorization, `Bearer ${otErisim(2)}`);
  assert.equal(ortam.durum.fetchler.filter((f) => new URL(f.url).pathname === '/api/').length, apiOnce, 'yenilenen anahtar için fazladan doğrulama isteği gitmez');
  assert.equal(fs.readFileSync(oturumDosyasi(ortam), 'utf8').includes(otErisim(2)), false);
  otSirsiz(ortam, [OT_YENILEME, otErisim(1), otErisim(2)]);
});

const k_red = otKayit();
ortamda('oturum (o-57): HA erişim anahtarını reddederse (401) bir kez yenilenir, "anahtar reddedildi" bildirimi çıkmaz, oturum ve anahtar dosyası kalır', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_red, { erisimGecerli: (jeton) => jeton !== otErisim(1) }) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  await otBekle(() => jetonPostlari(k_red, 'refresh_token').length >= 2, 'ikinci yenileme');
  await ortam.akit();
  assert.equal(jetonPostlari(k_red, 'refresh_token').length, 2);
  await otBekle(() => kimlikliler(ortam).some((f) => f.basliklar.Authorization === `Bearer ${otErisim(2)}`), 'yenilenen anahtarla istek');
  assert.equal(reddedilmeBildirimleri(ortam).length, 0, 'oturum erişim anahtarı için "anahtar reddedildi" bildirimi çıkmaz');
  assert.equal(oturumBildirimleri(ortam).length, 0);
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), true);
  assert.equal(fs.existsSync(`${elleAnahtarDosyasi(ortam)}.reddedildi`), false);
  assert.equal(kimlikliler(ortam).at(-1).basliklar.Authorization, `Bearer ${otErisim(2)}`);
  assert.equal((await oturumIpc(ortam, 'ayarlar:getir')).girisTuru, 'tarayici');
});

const k_surekli = otKayit();
ortamda('oturum (o-57): yenilenen erişim anahtarı da reddedilirse oturum biter: tek bildirim, kayıt silinir, HA\'ya hatalı deneme zinciri gitmez', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_surekli, { erisimGecerli: () => false }) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await otBekle(() => oturumBildirimleri(ortam).length > 0, 'oturum sonlandı bildirimi');
  await ortam.akit();
  ortam.ilerle(60_000);
  await ortam.akit();
  assert.equal(oturumBildirimleri(ortam).length, 1);
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false, 'oturum kaydı silindi');
  assert.equal((await oturumIpc(ortam, 'ayarlar:getir')).girisTuru, null);
  assert.ok(jetonPostlari(k_surekli, 'refresh_token').length <= 2, 'yenileme zinciri sınırlı');
  assert.ok(kimlikliler(ortam).length <= 4, `hatalı kimlikli istek sayısı sınırlı (${kimlikliler(ortam).length})`);
  otSirsiz(ortam, [OT_YENILEME, otErisim(1), otErisim(2)]);
});

const k_gecersiz = otKayit();
ortamda('oturum (o-57): HA yenileme anahtarını reddederse (invalid_grant) oturum silinir ve kullanıcıya bildirilir', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_gecersiz, { yenilemeYaniti: () => json({ error: 'invalid_grant' }, 400) }) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await otBekle(() => oturumBildirimleri(ortam).length > 0, 'bildirim');
  await ortam.akit();
  assert.equal(oturumBildirimleri(ortam).length, 1);
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false);
  const ozet = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(ozet.girisTuru, null);
  assert.equal(ozet.anahtarVar, false);
  assert.equal(jetonPostlari(k_gecersiz, 'refresh_token').length, 1, 'kalıcı red tekrar denenmez');
  assert.equal(kimlikliler(ortam).length, 0, 'erişim anahtarı olmadan HA\'ya kimlikli istek gitmez');
});

const k_gecici = otKayit();
const geciciDurum = { acik: false };
ortamda('oturum (o-57): geçici yenileme hatasında (HA yanıt vermiyor) oturum SİLİNMEZ, bildirim çıkmaz, istekler soğuma süresiyle sınırlı kalır; HA dönünce kendiliğinden toparlanır', {
  tohum: OT_TOHUMU,
  yoklama: 200,
  ekDosyalar: OT_OTURUM_DOSYASI,
  apiYaniti: otHa(k_gecici, { yenilemeYaniti: () => (geciciDurum.acik ? json({ access_token: otErisim(9), token_type: 'Bearer', expires_in: 1800 }) : json({ error: 'server_error' }, 503)) }),
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), true);
  assert.equal(oturumBildirimleri(ortam).length, 0);
  const ilk = jetonPostlari(k_gecici, 'refresh_token').length;
  assert.ok(ilk >= 1 && ilk <= 2, `ilk denemeler sınırlı (${ilk})`);
  assert.equal(kimlikliler(ortam).length, 0, 'erişim anahtarı yokken HA\'ya kimlikli istek gitmez');
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.erisim, 'yenilenemedi');
  ortam.ilerle(10_000);
  await oturumIpc(ortam, 'cihazlar:getir');
  await ortam.akit();
  assert.equal(jetonPostlari(k_gecici, 'refresh_token').length, ilk, 'soğuma süresi dolmadan yeni yenileme isteği yok');
  assert.equal(oturumBildirimleri(ortam).length, 0);

  geciciDurum.acik = true;
  ortam.ilerle(6 * 60_000);
  await oturumIpc(ortam, 'cihazlar:getir');
  await ortam.akit();
  assert.equal(kimlikliler(ortam).at(-1)?.basliklar.Authorization, `Bearer ${otErisim(9)}`, 'HA dönünce erişim anahtarı yenilendi');
  assert.equal((await oturumIpc(ortam, 'oturum:durum')).oturum.erisim, 'taze');
});

const k_cikis = otKayit();
ortamda('oturum (o-57): "Oturumu kapat" yerel kaydı siler ve HA\'daki yenileme anahtarını iptal etmeyi dener; iptal edilemese de yerel oturum gider', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_cikis) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const yanit = otDuz(await oturumIpc(ortam, 'oturum:cikis'));
  assert.deepEqual(yanit, { ok: true, iptalEdildi: true });
  const iptaller = jetonPostlari(k_cikis, 'iptal');
  assert.equal(iptaller.length, 1);
  assert.equal(iptaller[0].form.token, OT_YENILEME);
  assert.equal(iptaller[0].basliklar.Authorization, undefined);
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false);
  const ozet = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(ozet.girisTuru, null);
  assert.equal(ozet.anahtarVar, false);
  const once = ortam.durum.fetchler.length;
  ortam.ilerle(120_000);
  await ortam.akit();
  assert.equal(kimlikliler(ortam).filter((f) => ortam.durum.fetchler.indexOf(f) >= once).length, 0, 'çıkıştan sonra kimlikli istek yok');
  otSirsiz(ortam, [OT_YENILEME, otErisim(1)]);
});

const k_cikisYok = otKayit();
ortamda('oturum (o-57): HA\'ya ulaşılamıyorsa çıkış yine yerel oturumu siler ve iptal edilemediğini bildirir', {
  tohum: OT_TOHUMU,
  yoklama: 200,
  ekDosyalar: OT_OTURUM_DOSYASI,
  apiYaniti: (url, secenek) => {
    if (new URL(url).pathname === '/auth/token' && new URLSearchParams(secenek.body).get('action') === 'revoke') throw new Error('ağ yok');
    return otHa(k_cikisYok)(url, secenek);
  },
}, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const yanit = otDuz(await oturumIpc(ortam, 'oturum:cikis'));
  assert.deepEqual(yanit, { ok: true, iptalEdildi: false });
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false);
});

const k_elle = otKayit();
ortamda('oturum (o-57): elle anahtar kaydetmek tarayıcı oturumunu kapatır (yerel kayıt silinir, HA\'daki yenileme anahtarı arka planda iptal edilir); "Anahtarı sil" yalnız yerel kaydı siler ve ağa çıkmaz', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_elle) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  assert.equal((await oturumIpc(ortam, 'ayarlar:getir')).girisTuru, 'tarayici');
  const kayit = await oturumIpc(ortam, 'anahtar:kaydet', 'ELLE_YAPISTIRILAN_SAHTE_000000');
  assert.equal(kayit.ok, true);
  await otBekle(() => jetonPostlari(k_elle, 'iptal').length === 1, 'arka plan iptali');
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false, 'tarayıcı oturumu kapandı');
  assert.equal(fs.existsSync(elleAnahtarDosyasi(ortam)), true);
  const ozet = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(ozet.girisTuru, 'anahtar');
  assert.equal(ozet.anahtarVar, true);

  // Anahtarı sil: yalnız yerel; /auth/token'a gitmez
  const onceki = k_elle.jetonIstekleri.length;
  const sil = await oturumIpc(ortam, 'anahtar:sil');
  assert.equal(sil.ok, true);
  assert.equal(k_elle.jetonIstekleri.length, onceki);
  assert.equal(fs.existsSync(elleAnahtarDosyasi(ortam)), false);
});

const k_sil = otKayit();
ortamda('oturum (o-57): tarayıcı oturumundayken "Anahtarı sil" yerel oturum kaydını siler; HA\'ya iptal gitmez, erişim anahtarını yenilemek için ağa çıkılmaz', { tohum: OT_TOHUMU, yoklama: 200, ekDosyalar: OT_OTURUM_DOSYASI, apiYaniti: otHa(k_sil) }, async (ortam) => {
  await ortam.akit();
  ortam.ilerle(400);
  await ortam.akit();
  const onceki = k_sil.jetonIstekleri.length;
  const sil = await oturumIpc(ortam, 'anahtar:sil');
  assert.equal(sil.ok, true);
  assert.equal(fs.existsSync(oturumDosyasi(ortam)), false);
  assert.equal(k_sil.jetonIstekleri.length, onceki, 'HA\'ya iptal ya da yenileme istemi gitmez');
  const ozet = await oturumIpc(ortam, 'ayarlar:getir');
  assert.equal(ozet.girisTuru, null);
  assert.equal(ozet.anahtarVar, false);
});

// ---------------------------------------------------------------------------
// 1.4.0 bağlantı grubu (o-58): klasör tabanlı ayar eşitleme (main.js bağlantısı). Gerçek geçici klasör ve gerçek dosya G/Ç'si; ağ yok
// (HA yanıtları sahte). Dropbox / OneDrive / Syncthing taklidi yalnız klasördeki dosyadır: başka bir bilgisayarın yazdığı eşitleme dosyası.
// ---------------------------------------------------------------------------

const ES_DOSYA = 'ev-paneli-esitleme.json';
const ES_UZAK_AYGIT = 'aaaaaaaaaaaaaaaa';
const ES_ISIK = { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' };
const esBolum = (ayarlar, zaman = BASLANGIC_ZAMANI - 60_000) => ({ zaman, aygit: ES_UZAK_AYGIT, ayarlar });
const esKlasorYap = (bolumler = null) => {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-esitleme-'));
  if (bolumler) fs.writeFileSync(path.join(klasor, ES_DOSYA), JSON.stringify({ bicim: 'ev-paneli-ayar-esitleme', surum: 1, semaSurumu: 6, bolumler }), 'utf8');
  return klasor;
};

/** Eşitleme klasörü hazır bir ortam: tohum.esitlemeKlasoru verilmezse geçici klasör kullanılır; ortam kapanınca klasör silinir. */
function esitlemeOrtami(ad, { bolumler = null, tohum = {}, ...ek }, govde) {
  test(ad, async () => {
    const klasor = esKlasorYap(bolumler);
    let ortam = null;
    try {
      ortam = await ortamKur({ tohum: { yerelAdres: OT_TABAN, disAdres: '', favoriler: [], esitlemeKlasoru: klasor, ...tohum }, yoklama: 200, ...ek }); // kurulum fırlatırsa klasör yine silinir
      await govde(ortam, klasor);
    } finally {
      if (ortam) {
        try {
          await oturumIpc(ortam, 'esitleme:ayarla', { acik: false }); // klasör izleyicisi ve zamanlayıcılar bırakılır (uygulama kapanışta aynısını kapat() ile yapar)
        } catch {
          /* ortam zaten yıkılmış olabilir */
        }
        await ortam.temizle();
      }
      fs.rmSync(klasor, { recursive: true, force: true });
    }
  });
}
const esUserData = (ortam) => ortam.durum.yollar.get('userData');
const esAyarlarMesajlari = (ortam) => ortam.ayarlarPenceresi().webContents.mesajlar.filter((m) => m.kanal === 'ayarlar:esitleme-degisti');

esitlemeOrtami(
  'klasör eşitleme (o-58): açıkken klasördeki bölümler içe aktarma hattından geçerek alınır (kapı/kilit/alarm süzülür, adresler alınmaz), önce ayar yedeği alınır; Ayarlar bilgilendirilir; günlüğe yol ve içerik girmez',
  {
    tohum: { klasorEsitleme: true },
    bolumler: {
      favoriler: esBolum({
        favoriler: [ES_ISIK, { entity_id: 'lock.on_kapi', ad: 'Ön kapı' }, { entity_id: 'cover.garaj_kapisi', ad: 'Garaj kapısı' }, { entity_id: 'alarm_control_panel.ev', ad: 'Alarm' }, { entity_id: 'siren.ev', ad: 'Siren' }],
        panolar: [],
        yerelAdres: 'http://evil.example:8123',
        disAdres: 'https://evil.example',
      }),
      gorunum: esBolum({ temaZorla: 'acik', yerelAdres: 'http://evil.example:8123' }),
    },
  },
  async (ortam, klasor) => {
    await ortam.akit();
    const ilk = await oturumIpc(ortam, 'esitleme:durum'); // Ayarlar penceresi de açılır (olay bildirimi için)
    assert.equal(ilk.ok, true);
    assert.equal(ilk.esitleme.acik, true);
    assert.equal(ilk.esitleme.klasor, klasor);
    ortam.ilerle(5000); // açılış gecikmesi (eşitleme açılıştan biraz sonra başlar)
    await otBekle(() => ortam.ayarOku().temaZorla === 'acik', 'klasörden alma');
    const ayar = ortam.ayarOku();
    assert.deepEqual(ayar.favoriler.map((f) => f.entity_id), ['light.salon_lambasi'], 'kapı, kilit, garaj kapısı, alarm ve siren favorileri süzüldü');
    assert.equal(ayar.yerelAdres, OT_TABAN, 'ev içi adres klasörden değişmez');
    assert.equal(ayar.disAdres, '', 'dış adres klasörden değişmez');
    assert.equal(JSON.stringify(ayar).includes('evil.example'), false);

    const yedekler = fs.readdirSync(esUserData(ortam)).filter((ad) => /^ayarlar\.v6-yedek-\d{13}\.json$/.test(ad));
    assert.equal(yedekler.length, 1, 'klasörden ilk alınmadan önce ayar yedeği alındı');

    await otBekle(async () => (await oturumIpc(ortam, 'esitleme:durum')).esitleme.asama === 'tamam', 'eşitleme tamam');
    const durum = (await oturumIpc(ortam, 'esitleme:durum')).esitleme;
    assert.ok(durum.son.uygulanan >= 2, `iki bölüm alındı (${durum.son.uygulanan})`);
    assert.equal(durum.parolaVar, false);
    assert.ok(esAyarlarMesajlari(ortam).length >= 1, 'Ayarlar penceresine durum değişikliği bildirildi');

    const gunluk = ortam.gunlukOku();
    assert.match(gunluk, /Klasör eşitleme: \d+ bölüm klasörden alındı\./);
    for (const sizinti of [klasor, 'evil.example', 'lock.on_kapi', 'cover.garaj_kapisi']) assert.equal(gunluk.includes(sizinti), false, `günlüğe sızdı: ${sizinti}`);
  },
);

esitlemeOrtami(
  'klasör eşitleme (o-58): varsayılan KAPALI: klasör ayarda olsa da hiçbir şey okunmaz ya da yazılmaz; durum "kapalı"',
  { tohum: { klasorEsitleme: false }, bolumler: { gorunum: esBolum({ temaZorla: 'acik' }) } },
  async (ortam, klasor) => {
    const oncekiDosya = fs.readFileSync(path.join(klasor, ES_DOSYA), 'utf8');
    ortam.ilerle(10 * 60_000);
    await ortam.akit();
    await ortam.akit();
    assert.notEqual(ortam.ayarOku().temaZorla, 'acik', 'klasördeki ayar alınmadı');
    assert.deepEqual(fs.readdirSync(klasor), [ES_DOSYA], 'klasöre başka dosya yazılmadı');
    assert.equal(fs.readFileSync(path.join(klasor, ES_DOSYA), 'utf8'), oncekiDosya, 'klasördeki dosya değişmedi');
    const durum = (await oturumIpc(ortam, 'esitleme:durum')).esitleme;
    assert.equal(durum.acik, false);
    assert.equal(durum.asama, 'kapali');
    assert.equal(fs.existsSync(path.join(esUserData(ortam), 'esitleme-parola.dat')), false);
  },
);

esitlemeOrtami('klasör eşitleme (o-58): IPC kanalları yalnız Ayarlar penceresinden kabul edilir (HA sayfasından gelen istek reddedilir, diyalog açılmaz, ayar değişmez)', { tohum: { esitlemeKlasoru: '' } }, async (ortam) => {
  await ortam.akit();
  const uzak = { sender: ortam.anaPencere().webContents, senderFrame: { url: 'https://ha.example.com/lovelace', parent: null } };
  ortam.durum.dosyaSecimi = { canceled: false, filePaths: [esUserData(ortam)] };
  const cagrilar = {
    'esitleme:durum': [],
    'esitleme:klasor-sec': [],
    'esitleme:ayarla': [{ acik: true }],
    'esitleme:simdi': [],
    'esitleme:parola-koy': ['Gizli-Parola-123'],
    'esitleme:parola-sil': [],
  };
  for (const [kanal, args] of Object.entries(cagrilar)) {
    const yanit = await ortam.durum.ipc.get(kanal)(uzak, ...args);
    assert.equal(yanit.ok, false, `${kanal}: yabancı gönderen reddedilir`);
  }
  assert.equal((ortam.durum.dosyaDiyaloglari ?? []).length, 0, 'klasör diyalogu açılmadı');
  assert.equal(fs.existsSync(path.join(esUserData(ortam), 'esitleme-parola.dat')), false);
  assert.equal(ortam.ayarOku().klasorEsitleme, false);
});

esitlemeOrtami(
  'klasör eşitleme (o-58): klasörü yalnız ana süreç diyaloğu seçer (uygulamanın kendi veri klasörü reddedilir); açınca yerel bölümler klasöre yazılır ve dosyada adres/anahtar yok; parola dosyayı şifreler ve hiçbir yere sızmaz',
  { tohum: { esitlemeKlasoru: '' }, anahtar: true },
  async (ortam, klasor) => {
    await ortam.akit();
    const bos = (await oturumIpc(ortam, 'esitleme:durum')).esitleme;
    assert.equal(bos.klasor, null);
    assert.equal(bos.acik, false);

    // Uygulamanın kendi veri klasörü eşitleme klasörü olamaz
    ortam.durum.dosyaSecimi = { canceled: false, filePaths: [esUserData(ortam)] };
    const yasak = await oturumIpc(ortam, 'esitleme:klasor-sec');
    assert.deepEqual(otDuz(yasak), { ok: false, neden: 'yasak-klasor' });
    const secenek = ortam.durum.dosyaDiyaloglari.at(-1).secenek;
    assert.ok(secenek.properties.includes('openDirectory'));
    assert.equal(secenek.properties.includes('openFile'), false);

    // Geçerli klasör; seçmek eşitlemeyi AÇMAZ
    ortam.durum.dosyaSecimi = { canceled: false, filePaths: [klasor] };
    const secildi = await oturumIpc(ortam, 'esitleme:klasor-sec');
    assert.equal(secildi.ok, true);
    assert.equal(secildi.esitleme.klasor, klasor);
    assert.equal(secildi.esitleme.acik, false);
    assert.deepEqual(fs.readdirSync(klasor), []);

    // Aç: ilk bilgisayar, klasör boş -> yerel bölümler klasöre yazılır
    const acildi = await oturumIpc(ortam, 'esitleme:ayarla', { acik: true });
    assert.equal(acildi.ok, true);
    ortam.ilerle(1000);
    await otBekle(() => fs.existsSync(path.join(klasor, ES_DOSYA)), 'ilk yazım');
    await otBekle(async () => (await oturumIpc(ortam, 'esitleme:durum')).esitleme.asama === 'tamam', 'eşitleme tamam');
    const duz = fs.readFileSync(path.join(klasor, ES_DOSYA), 'utf8');
    const belge = JSON.parse(duz);
    assert.deepEqual(Object.keys(belge.bolumler).sort(), ['bildirim', 'bilgi', 'favoriler', 'gorunum', 'kisayollar']);
    for (const yasakli of [OT_TABAN, 'yerelAdres', 'disAdres', 'klasorEsitleme', 'esitlemeKlasoru', TEST_ANAHTAR]) assert.equal(duz.includes(yasakli), false, `dosyada olmamalı: ${yasakli}`);

    // Parola: dosya şifreli zarfa dönüşür
    const PAROLA = 'Gizli-Parola-Sahte-0001';
    const koy = await oturumIpc(ortam, 'esitleme:parola-koy', PAROLA);
    assert.equal(koy.ok, true);
    assert.equal(koy.esitleme.parolaVar, true);
    assert.equal(fs.existsSync(path.join(esUserData(ortam), 'esitleme-parola.dat')), true);
    const sifreli = fs.readFileSync(path.join(klasor, ES_DOSYA), 'utf8');
    assert.equal(Object.hasOwn(JSON.parse(sifreli), 'bolumler'), false, 'şifreli dosyada düz bölüm yok');
    assert.equal(sifreli.includes('temaZorla'), false);
    otSirsiz(ortam, [PAROLA, TEST_ANAHTAR], [JSON.stringify(koy), sifreli, JSON.stringify(await oturumIpc(ortam, 'esitleme:durum')), JSON.stringify(await oturumIpc(ortam, 'ayarlar:getir'))]);
    assert.equal(JSON.stringify(ortam.ayarOku()).includes(PAROLA), false);

    // Parola kaldırılınca dosya yeniden düz yazılır
    const sil = await oturumIpc(ortam, 'esitleme:parola-sil');
    assert.equal(sil.ok, true);
    assert.equal(sil.esitleme.parolaVar, false);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(klasor, ES_DOSYA), 'utf8')), 'bolumler'), true);
    assert.equal(fs.existsSync(path.join(esUserData(ortam), 'esitleme-parola.dat')), false);
  },
);

// ===========================================================================
// Birleştirme: dış tetikler ve bildirim düğmeleri etkinlik geçmişine (o-17) kaynaklarıyla düşer
// ===========================================================================

const etkinlikSatirlari = async (ortam) => JSON.parse(JSON.stringify((await ortam.durum.ipc.get('etkinlik:liste')(ayarlarOlayi(ortam))).kayitlar));

ortamda('etkinlik geçmişi (o-17): dış tetikler (Jump List, PC olayı) kaynaklarıyla geçmişe düşer; çalışan eylem tek satırdır (kapı olayı çift kayıt üretmez)', dalga3([SALON], {
  tetikJumpList: true,
  tetikPcOlaylari: true,
  tetikPcKurallari: [{ olay: 'kilit', kimlik: 'light.salon_lambasi', islem: 'kapat' }],
}), async (ortam) => {
  haKur(ortam.durum, [SALON_ACIK]);
  await ortam.akit();
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=jumplist'], { eylem: 'Salon Lambası', kaynak: 'jumplist' });
  await ortam.akit();
  ortam.guc.emit('lock-screen');
  await ortam.akit();
  assert.equal(postlar(ortam).length, 2, 'Jump List görevi ve PC kuralı birer POST');
  const kayitlar = await etkinlikSatirlari(ortam);
  const jump = kayitlar.filter((k) => k.kaynak === 'jumplist');
  const pc = kayitlar.filter((k) => k.kaynak === 'pc-olayi');
  assert.equal(jump.length, 1, 'Jump List: tek satır');
  assert.deepEqual([jump[0].kimlik, jump[0].islem, jump[0].sonuc], [SALON.entity_id, 'toggle', 'ok']);
  assert.equal(pc.length, 1, 'PC olayı: tek satır');
  assert.deepEqual([pc[0].kimlik, pc[0].islem, pc[0].sonuc], [SALON.entity_id, 'turn_off', 'ok']);
  assert.doesNotMatch(JSON.stringify(kayitlar), /192\.168\.|TEST_ANAHTAR|Bearer|evpaneli:/, 'geçmişte adres, anahtar ya da bağlantı yok');
});

ortamda('etkinlik geçmişi (o-17): kapıda durdurulan dış tetik (seçenek kapalı) tek "atlandı" satırı olur; HA\'ya hiçbir şey gitmez, favori adı çözülmeden kimliksiz yazılır', dalga3([SALON]), async (ortam) => {
  haKur(ortam.durum, [SALON_ACIK]);
  await ortam.akit();
  ikinciKopya(ortam, ['--eylem=Salon Lambası', '--kaynak=jumplist'], { eylem: 'Salon Lambası', kaynak: 'jumplist' });
  await ortam.akit();
  assert.deepEqual(postlar(ortam), []);
  const kayitlar = await etkinlikSatirlari(ortam);
  assert.equal(kayitlar.length, 1);
  assert.deepEqual([kayitlar[0].kaynak, kayitlar[0].islem, kayitlar[0].sonuc, kayitlar[0].neden], ['jumplist', 'dis-tetik', 'atlandi', 'kapali']);
  assert.equal(Object.hasOwn(kayitlar[0], 'kimlik'), false);
});

ortamda('etkinlik geçmişi (o-17): bildirim düğmesi basışı kaynağıyla yazılır; düğmenin başlığı, eylem kimliği ve webhook kimliği geçmişe girmez', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa();
  const { s, abone } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Hareket algılandı', data: { tag: 'hareket', actions: [{ action: 'ONAYLA_42', title: 'Onayla' }, { action: 'ERTELE_7', title: 'Ertele' }] } });
  await ortam.akit();
  const { kartNo } = kartMesajlari(ortam).at(-1);
  assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(kartOlayi(ortam), { kartNo, sira: 1 }), { ok: true });
  const kayitlar = await etkinlikSatirlari(ortam);
  const dugme = kayitlar.filter((k) => k.kaynak === 'bildirim');
  assert.equal(dugme.length, 1);
  assert.deepEqual([dugme[0].islem, dugme[0].sonuc], ['bildirim-dugme', 'ok']);
  assert.doesNotMatch(JSON.stringify(kayitlar), new RegExp(`ERTELE|Ertele|ONAYLA|Onayla|${MOBIL_WEBHOOK}`));
});

ortamda('etkinlik geçmişi (o-17): bildirim düğmesi gönderilemezse (410) "hata" satırı kısa nedenle yazılır', dalga3([SALON]), async (ortam) => {
  ortam.durum.apiYaniti = mobilHa({ webhook: () => new Response('', { status: 410 }) });
  const { s, abone } = await mobilKanaliAc(ortam);
  itmeOlayi(s, abone, { message: 'Hareket', data: { actions: [{ action: 'TAMAM', title: 'Tamam' }] } });
  await ortam.akit();
  const { kartNo } = kartMesajlari(ortam).at(-1);
  assert.deepEqual(await ortam.durum.ipc.get('itme:eylem')(kartOlayi(ortam), { kartNo, sira: 0 }), { ok: false });
  const dugme = (await etkinlikSatirlari(ortam)).filter((k) => k.kaynak === 'bildirim');
  assert.equal(dugme.length, 1);
  assert.deepEqual([dugme[0].sonuc, dugme[0].neden], ['hata', 'kayit-yok']);
});
