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
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const { anahtarParmakIzi } = require('../src/lib/yetki-kesici');
const { simgePng } = require('../src/lib/tepsi-simgesi');
const ANA_SOZLUK = require('../src/lib/ceviri/ana');
const {
  ACILIS_HATASI_BILDIRIMI,
  AYARLAR_ART_ARDA_COKTU_BILDIRIMI,
  AYARLAR_COKTU_BILDIRIMI,
  AYAR_OKUNAMADI_BILDIRIMI,
  EPOSTA_ACILDI_METNI,
  TARAYICIDA_ACILDI_METNI,
  ayarDosyasiBozukMetni,
  semaDahaYeniMetni,
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

  // Oturumun izin işleyicileri kaydedilir (h-36): test, istekleri doğrudan işleyicilere verir.
  const oturum = () => {
    const kayit = { istek: null, denetim: null, cihaz: null };
    durum.oturumlar.push(kayit);
    return {
      setPermissionRequestHandler(isleyici) {
        kayit.istek = isleyici;
      },
      setPermissionCheckHandler(isleyici) {
        kayit.denetim = isleyici;
      },
      setDevicePermissionHandler(isleyici) {
        kayit.cihaz = isleyici;
      },
      flushStorageData() {},
    };
  };

  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, // kayıt defterine/oturum açılışına hiçbir şey yazılmaz
    setName() {},
    getLocale: () => durum.sistemDili ?? 'tr-TR', // işletim sistemi dili (arayüz dili "sistem" iken kullanılır)
    getPath: (ad) => {
      if (ad === 'appData') return durum.appData;
      if (ad === 'logs') return path.join(durum.appData, 'gunlukler'); // gerçek %APPDATA% değil, geçici klasör
      if (ad === 'documents') return path.join(durum.appData, 'Belgeler'); // Ayarlar dışa/içe aktarma diyaloğunun açılış klasörü
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
    whenReady: () => durum.hazirSoz ?? Promise.resolve(), // hazirBekle: test "ready" olayını kendisi verir
    quit() {
      durum.cikisIstendi = true;
    },
    setLoginItemSettings() {
      throw new Error('oturum açılışı yazılmamalı');
    },
    getLoginItemSettings() {
      throw new Error('oturum açılışı okunmamalı');
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
      isEncryptionAvailable: () => true,
      isAsyncEncryptionAvailable: async () => true,
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
    session: { fromPartition: oturum, defaultSession: oturum() },
    shell: {
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
async function ortamKur({ tohum = null, ekDosyalar = null, calismaAlani = { x: 0, y: 0, width: 1920, height: 1040 }, ekranlar = null, yoklama = null, anahtar = false, kisayolReddi = [], ha = null, apiYaniti = null, hazirBekle = false, osSurumu = '10.0.26300', yerelDosyalar = null, acilisArgv = null, oncesi = null } = {}) {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-test-'));
  const oncekiYerelAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(gecici, 'LocalAppData'); // gerçek %LOCALAPPDATA%'ya hiçbir şey yazılmasın
  const durum = {
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
  if (acilisArgv) process.argv = ['ev-paneli.exe', ...acilisArgv]; // uygulama `--eylem ...` ile açılıyorsa (main.js yüklenirken okunur)
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
    ayarlarPenceresi: () => durum.pencereler.find((p) => /Ayarlar|Settings/.test(p.secenekler.title ?? '')),
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
  (menuOgesi('Ayarlar…') ?? menuOgesi('Settings…')).click(); // arayüz dili Türkçe ya da İngilizce olabilir
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
  assert.deepEqual(koseMesajlari(ortam), [{ tur: 'ok', metin: 'Düğmeye basıldı: Bilgisayarı Kapat', sureMs: 1500, malzeme: 'acrylic' }]);
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
  ortam.ilerle(4000); // süre dolunca gizlenir
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
  assert.equal(JSON.stringify(yedekler).includes(ortam.durum.yollar.get('userData')), false, 'renderer\'a klasör yolu gitmez');

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
  for (const kanal of ['ayarlar:disa-aktar', 'ayarlar:ice-aktar', 'ayarlar:yedekler', 'ayarlar:yedekten-don', 'ayarlar:adres-sina', 'ayarlar:aciksayfa']) {
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
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'acrylic' }]);
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
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'palet', malzeme: 'acrylic' }]);
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
  { ...PC_KAPAT, kisayol: 'Control+Alt+Z' },
  { entity_id: 'lock.on_kapi', ad: 'Ön Kapı', kisayol: 'Control+Alt+D' },
]), async (ortam) => {
  haKur(ortam.durum, [...HA_VARLIKLARI, durumNesnesi('lock.on_kapi', 'Ön Kapı', 'locked')]);
  await ortam.akit();
  assert.ok(ortam.durum.kisayollar.has('Control+Alt+L'));
  assert.equal(ortam.durum.kisayollar.has('Control+Alt+Z'), false, 'yıkıcı eylem kısayola bağlanmaz');
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

ortamda('canlı bağlantı: anahtar yalnız auth iletisinde gider; canlıyken REST yoklaması YAPILMAZ, durum değişimi açık panele anında yansır', dalga3([SALON]), async (ortam) => {
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
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [] },
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
  tohum: { semaSurumu: 4, hazirListeSurumu: 0, favoriler: [] },
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
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'acrylic' }]);
});

ortamda('malzeme: ayar "mica" ise panel mica ile açılır', dalga4([SALON, PC_KAPAT], { yeniPencereMalzemesi: 'mica' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, 'mica');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'mica' }]);
});

ortamda('malzeme: ayar "Düz" (yok) ise panel eski opak koyu renkle açılır, backgroundMaterial verilmez', dalga4([SALON, PC_KAPAT], { yeniPencereMalzemesi: 'yok' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, undefined);
  assert.equal(panel.secenekler.backgroundColor, '#1b1f27');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'yok' }]);
});

ortamda('malzeme: Windows 10 ya da eski Windows 11 (yapı < 22621) malzemeyi desteklemez: opak koyu renk, düz mod', dalga4([SALON, PC_KAPAT], {}, { osSurumu: '10.0.19045' }), async (ortam) => {
  haKur(ortam.durum, HA_VARLIKLARI);
  await ortam.akit();
  ortam.ilerle(400);
  const panel = await paneliAc(ortam);
  assert.equal(panel.secenekler.backgroundMaterial, undefined);
  assert.equal(panel.secenekler.backgroundColor, '#1b1f27');
  assert.deepEqual(yuzeyMesajlari(ortam, 'yuzey:goster'), [{ mod: 'panel', malzeme: 'yok' }]);
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
const acikAyarlarPenceresi = (ortam) => ortam.durum.pencereler.find((p) => /Ayarlar|Settings/.test(p.secenekler.title ?? '') && !p.yikik);

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

  // geçersiz değer mevcut ayarı bozmaz
  await ayarlarKaydet(ortam, { dil: 'de' });
  assert.equal(ortam.ayarOku().dil, 'sistem');
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

  // ışık: Düzenle…, Tepsiye ekle, Sayfaya ekle, Favorilerden kaldır…
  await menudenSec('light.salon_lambasi', (sablon) => {
    assert.deepEqual(etiketler(sablon), ['Düzenle…', 'Tepsiye ekle', 'Sayfaya ekle', 'Favorilerden kaldır…']);
    return bul(sablon, 'Tepsiye ekle');
  });
  assert.equal(ayar().favoriler.find((f) => f.entity_id === 'light.salon_lambasi').tepsi, true, 'tepsiye sabitlendi');
  await menudenSec('light.salon_lambasi', (sablon) => {
    assert.ok(etiketler(sablon).includes('Tepsiden kaldır'));
    return bul(sablon, 'Tepsiden kaldır');
  });
  assert.equal('tepsi' in ayar().favoriler.find((f) => f.entity_id === 'light.salon_lambasi'), false, 'sabitleme kalktı');

  // yıkıcı eylem (PC kapat): tepsiye sabitleme önerilmez (zaten onaylı eylemler altında)
  await menudenSec('button.pc_bilgisayari_kapat', (sablon) => {
    assert.equal(etiketler(sablon).includes('Tepsiye ekle'), false);
    assert.equal(etiketler(sablon).includes('Tepsiden kaldır'), false);
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
  assert.match(ortam.tepsi.ipuclari.at(-1), /Salon sıcaklığı: 21\.5 °C$/);
  assert.ok(Array.from(ortam.tepsi.ipuclari.at(-1)).length <= 120);
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
