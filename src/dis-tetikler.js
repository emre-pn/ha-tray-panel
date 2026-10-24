'use strict';

/**
 * Dış tetikler — ana süreç düzenleyicisi (1.4.0 dis grubu: o-21 Jump List ve masaüstü kısayolu, o-47 PC olayları, o-52 yerel API,
 * o-53 toplantı ışığı, o-54 evpaneli:// bağlantısı). Electron nesneleri (app, shell, clipboard) ve kayıt defteri okuması dışarıdan
 * verilir; testler sahteleriyle çalışır.
 *
 * Her tetik varsayılan KAPALIDIR ve yalnız kendi Ayarlar seçeneği açıkken bir şey yapar; eylemlerin HEPSİ tek kapıdan geçer
 * (src/lib/dis-tetik.js) ve oradan tek güvenli eylem hattına girer. Bu dosya yalnız tetiklerin kendisini yönetir:
 *  - Jump List görevleri (app.setJumpList; seçenek kapanınca Windows'un varsayılan listesine dönülür) ve masaüstü kısayolu (.lnk;
 *    var olan dosyanın üzerine yazılmaz).
 *  - evpaneli:// kaydı: seçenek açılınca çalışma anında HKCU'ya yazılır (app.setAsDefaultProtocolClient), kapanınca yalnız bizimse
 *    kaldırılır. Bağlantıdan gelen her favori için ilk seferde panelde (panel yoksa iletişim kutusunda) "İzin ver / Her zaman / Reddet"
 *    sorulur; soru ONAY_SURESI_MS içinde yanıtlanmazsa ya da panel kapanırsa reddedilmiş sayılır.
 *  - Yerel API (src/lib/yerel-api.js): yalnız 127.0.0.1; jeton safeStorage'da (jetonDeposu), renderer'a ASLA gitmez (yalnız panoya
 *    kopyalanır).
 *  - PC olayları: powerMonitor olayları main.js'ten guc(olay) ile gelir; kurallar src/lib/pc-olaylari.js.
 *  - Toplantı ışığı (src/lib/toplanti-isigi.js): kayıt defteri yalnız okunur, uygulama adları hiçbir yere yazılmaz.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { disTetikKapisiOlustur } = require('./lib/dis-tetik');
const { PROTOKOL, protokolBaglantisiCoz, protokolBaglantisi } = require('./lib/komut-satiri');
const { yerelApiOlustur, jetonUret, jetonGecerliMi, VARSAYILAN_PORT } = require('./lib/yerel-api');
const { toplantiIzleyiciOlustur, AYGIT_ANAHTARLARI } = require('./lib/toplanti-isigi');
const { jumpListPlani, planImzasi, dosyaAdiDuzelt, bosKisayolAdi, kisayolSecenekleri } = require('./lib/windows-kisayol');
const { olayKurallari, OLAY_GECIKMESI_MS, PC_OLAYLARI } = require('./lib/pc-olaylari');

const ONAY_SURESI_MS = 60_000;
const EN_AZ_GORUNME_MS = 600; // panel açıldıktan bu kadar sonra "İzin ver" kabul edilir (bağlantıya çift tıklama izne dönüşmesin)
const ONAY_KARARLARI = Object.freeze(['izin', 'herZaman', 'reddet']);
const JUMP_LIST_GECIKMESI_MS = 3000;
/** Ayar alanı -> değişince yeniden uygulanacak tetik. */
const AYAR_TETIKLERI = Object.freeze({
  tetikJumpList: 'jumpList',
  tetikProtokol: 'protokol',
  tetikYerelApi: 'api',
  tetikApiPortu: 'api',
  tetikToplanti: 'toplanti',
  tetikToplantiKaynak: 'toplanti',
  tetikToplantiFavori: 'toplanti',
  tetikToplantiAralik: 'toplanti',
});

/** main.js'in ekAyarDinle ile dinlediği alanlar: değişince ayarDegisti(ad) çağrılır. */
const DINLENEN_AYARLAR = Object.freeze([...Object.keys(AYAR_TETIKLERI), 'tetikPcOlaylari', 'tetikPcAcma', 'tetikPcKurallari']);
const REG_ZAMAN_ASIMI_MS = 5000;
const REG_CIKTI_SINIRI = 1024 * 1024;

/**
 * Toplantı ışığı için kayıt defteri OKUYUCUSU (o-53; yalnız win32): `%SystemRoot%\System32\reg.exe query <anahtar> /s`. Anahtar yalnız
 * src/lib/toplanti-isigi.js AYGIT_ANAHTARLARI'ndaki sabit HKCU ConsentStore yollarından biri olabilir; başka anahtar sorgulanmaz,
 * kayıt defterine HİÇBİR ŞEY yazılmaz (yalnız `query`). Çıktı yalnız bellekte ayrıştırılır; uygulama adları hiçbir yere yazılmaz.
 * @param {{execFile: Function, platform?: string, sistemKoku?: string}} bag
 * @returns {((anahtar: string) => Promise<string>)|null} win32 değilse null (toplantı ışığı kapalı kalır)
 */
function regSorgulayiciOlustur({ execFile, platform = process.platform, sistemKoku = process.env.SystemRoot || process.env.windir }) {
  if (platform !== 'win32' || typeof execFile !== 'function') return null;
  const kok = typeof sistemKoku === 'string' && /^[A-Za-z]:\\/.test(sistemKoku) ? sistemKoku : 'C:\\Windows';
  const program = path.win32.join(kok, 'System32', 'reg.exe');
  const izinli = new Set(Object.values(AYGIT_ANAHTARLARI));
  return (anahtar) =>
    new Promise((coz, reddet) => {
      if (!izinli.has(anahtar)) {
        reddet(new Error('izinsiz-anahtar'));
        return;
      }
      execFile(program, ['query', anahtar, '/s'], { windowsHide: true, timeout: REG_ZAMAN_ASIMI_MS, maxBuffer: REG_CIKTI_SINIRI, encoding: 'utf8' }, (hata, cikti) => {
        if (hata) reddet(new Error('okunamadi')); // hata iletisi (yol, çıktı) taşınmaz
        else coz(String(cikti ?? ''));
      });
    });
}

function varsayilanZaman() {
  return { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
}

/**
 * @param {object} bag
 * @param {object} bag.app Electron app (setJumpList, setAsDefaultProtocolClient, removeAsDefaultProtocolClient, isDefaultProtocolClient)
 * @param {{writeShortcutLink?: Function}} [bag.shell]
 * @param {{writeText?: Function}} [bag.clipboard]
 * @param {{existsSync: Function}} bag.fs
 * @param {() => object} bag.ayarlarAl
 * @param {(yama: object) => void} bag.ayarYaz ana sürecin yazdığı alanlar (tetikProtokolIzinleri, tetikPcUyarisi) için
 * @param {() => object[]} bag.karolarAl güvenli favori karoları
 * @param {{distenCalistir: Function}} bag.eylem eylem katmanı (src/eylem.js); YALNIZ kapı (src/lib/dis-tetik.js) çağırır
 * @param {() => boolean} [bag.anahtarVarMi] HA erişim anahtarı kayıtlı mı? Yoksa dış eylem HA'ya hiç gitmez ('anahtar-yok')
 * @param {{anahtarAl: Function, yaz: Function}} bag.jetonDeposu yerel API jetonu (safeStorage; src/lib/anahtar-deposu.js)
 * @param {() => {program: string, onek: string[]}} bag.hedefAl Jump List / kısayol / protokolün çalıştıracağı dosya ve ön argümanlar
 * @param {() => string} [bag.masaustuAl] masaüstü klasörü
 * @param {() => boolean} [bag.panelOnayGoster] izin sorusunu panelde gösterir (gösterilemezse false: iletişim kutusuna düşülür)
 * @param {(soru: object, secenek?: { signal: AbortSignal }) => Promise<string>} [bag.onayDiyalogu] yedek iletişim kutusu ('izin' | 'herZaman' | 'reddet'); soru bitince signal iptal edilir
 * @param {() => void} [bag.onayBitti] soru (herhangi bir yoldan: yanıt, zaman aşımı, kapanış) bitti; panel soruyu kaldırır
 * @param {(b: object) => void} [bag.geriBildirim]
 * @param {Function} bag.t
 * @param {(anahtar: string) => Promise<string>} [bag.regSorgula] `reg query <anahtar> /s` çıktısı (toplantı ışığı; yoksa kapalı kalır)
 * @param {(kayit: object) => void} [bag.olay] etkinlik geçmişi kancası
 */
function disTetiklerOlustur({
  app = {},
  shell = {},
  clipboard = {},
  fs,
  ayarlarAl,
  ayarYaz = () => {},
  karolarAl,
  eylem,
  anahtarVarMi = () => true,
  jetonDeposu,
  hedefAl,
  masaustuAl = () => (typeof app.getPath === 'function' ? app.getPath('desktop') : ''),
  panelOnayGoster = () => false,
  onayDiyalogu = null,
  onayBitti = () => {},
  geriBildirim = () => {},
  t,
  gunluk = () => {},
  regSorgula = null,
  olay = () => {},
  zaman = varsayilanZaman(),
  simdi = () => Date.now(),
  yerelApiFabrikasi = yerelApiOlustur,
  izleyiciFabrikasi = toplantiIzleyiciOlustur,
}) {
  const ayarlar = () => {
    try {
      const a = ayarlarAl();
      return a && typeof a === 'object' ? a : {};
    } catch {
      return {};
    }
  };
  const dinleyiciler = new Set();
  const durumDegisti = () => {
    for (const fn of dinleyiciler) {
      try {
        fn();
      } catch {
        /* dinleyici hatası yok sayılır */
      }
    }
  };

  // --- izin sorusu (evpaneli://) ------------------------------------------------------------------------------------
  let bekleyen = null; // { bilet, soru, acildi, bitir }

  function onaySor(soru) {
    return new Promise((coz) => {
      const bilet = crypto.randomUUID();
      // Yedek iletişim kutusunun kapatma yolu: zaman aşımı / durdur() soruyu bitirince açık kutu da kapanır (geç "İzin ver" sessizce yutulmaz,
      // aynı bağlantıya tekrar tıklanınca ikinci kutu üst üste yığılmaz).
      const kayit = { bilet, soru: { ...soru }, acildi: simdi(), zamanlayici: null, iptal: new AbortController() };
      kayit.bitir = (karar) => {
        if (bekleyen !== kayit) return;
        zaman.clearTimeout(kayit.zamanlayici);
        bekleyen = null;
        try {
          kayit.iptal.abort();
        } catch {
          /* iptal edilemese de karar verilir */
        }
        coz(ONAY_KARARLARI.includes(karar) ? karar : 'reddet');
        try {
          onayBitti();
        } catch {
          /* panel yok */
        }
      };
      kayit.zamanlayici = zaman.setTimeout(() => kayit.bitir('reddet'), ONAY_SURESI_MS);
      bekleyen = kayit;
      let gosterildi = false;
      try {
        gosterildi = panelOnayGoster() === true;
      } catch {
        gosterildi = false;
      }
      if (gosterildi) return;
      if (typeof onayDiyalogu !== 'function') {
        kayit.bitir('reddet');
        return;
      }
      Promise.resolve()
        .then(() => onayDiyalogu(kayit.soru, { signal: kayit.iptal.signal }))
        .then(
          (karar) => kayit.bitir(karar),
          () => kayit.bitir('reddet'),
        );
    });
  }

  /** Panel köprüsü (src/yuzey-yoneticisi.js disOnay): soru renderer'a bilet ile gider; karar yalnız aynı biletle kabul edilir. */
  const onay = {
    al() {
      if (!bekleyen) return null;
      const { ad, islem, deger } = bekleyen.soru;
      return { bilet: bekleyen.bilet, ad, islem, ...(Number.isInteger(deger) ? { deger } : {}), bekleMs: Math.max(0, EN_AZ_GORUNME_MS - (simdi() - bekleyen.acildi)) };
    },
    yanitla(bilet, karar) {
      if (!bekleyen || typeof bilet !== 'string' || bekleyen.bilet !== bilet || !ONAY_KARARLARI.includes(karar)) return false;
      if (karar !== 'reddet' && simdi() - bekleyen.acildi < EN_AZ_GORUNME_MS) return false;
      bekleyen.bitir(karar);
      return true;
    },
    /** Panel soru açıkken kapandı (odak kaybı, Esc): reddedilmiş sayılır. */
    kapandi() {
      if (bekleyen) bekleyen.bitir('reddet');
    },
  };

  // --- kapı ----------------------------------------------------------------------------------------------------------
  /** Erişim anahtarı yoksa HA'ya gidilmez (komut satırı eylemiyle aynı kural); bildirim kipi 'yok' değilse kullanıcıya söylenir. */
  const anahtarliEylem = {
    distenCalistir(yuk) {
      let var_ = false;
      try {
        var_ = anahtarVarMi() === true;
      } catch {
        var_ = false;
      }
      if (var_) return eylem.distenCalistir(yuk);
      if (yuk?.bildirim !== 'yok') {
        try {
          geriBildirim({ tur: 'hata', metin: t('dis.anahtarGerekli') });
        } catch {
          /* bildirim hatası yok sayılır */
        }
      }
      return Promise.resolve({ ok: false, tur: 'anahtar-yok' });
    },
  };

  const kapi = disTetikKapisiOlustur({
    ayarlarAl: ayarlar,
    karolarAl,
    eylem: anahtarliEylem,
    onaySor,
    izinEkle: (kimlik) => {
      const liste = Array.isArray(ayarlar().tetikProtokolIzinleri) ? ayarlar().tetikProtokolIzinleri : [];
      if (!liste.includes(kimlik)) ayarYaz({ tetikProtokolIzinleri: [...liste, kimlik].slice(-50) });
      durumDegisti();
    },
    bildir: (b) => geriBildirim(b),
    t,
    olay,
    gunluk,
    simdi,
  });

  // --- Jump List ------------------------------------------------------------------------------------------------------
  let sonJumpListImzasi;
  let jumpListZamanlayicisi = null;

  function hedef() {
    try {
      const h = hedefAl();
      if (h && typeof h.program === 'string' && h.program !== '') return { program: h.program, onek: Array.isArray(h.onek) ? h.onek.filter((a) => typeof a === 'string') : [] };
    } catch {
      /* aşağıda null */
    }
    return null;
  }

  function jumpListUygula() {
    zaman.clearTimeout(jumpListZamanlayicisi);
    jumpListZamanlayicisi = null;
    if (typeof app.setJumpList !== 'function') return;
    const h = hedef();
    const plan =
      ayarlar().tetikJumpList === true && h
        ? jumpListPlani({ uygunlar: kapi.uygunlar(), program: h.program, onekArgumanlar: h.onek, aciklama: (ad) => t('dis.gorevAciklama', { ad }) })
        : null;
    const imza = planImzasi(plan);
    if (imza === sonJumpListImzasi) return;
    try {
      const sonuc = app.setJumpList(plan);
      sonJumpListImzasi = imza;
      if (typeof sonuc === 'string' && sonuc !== 'ok') gunluk(`Jump List yazılamadı: ${sonuc}`);
    } catch {
      gunluk('Jump List yazılamadı.');
    }
  }

  /**
   * Gecikmeli tazeleme. Kısma (throttle) olarak çalışır: bekleyen bir tazeleme varsa yenisi kurulmaz, böylece sık gelen canlı durum
   * değişiklikleri tazelemeyi sonsuza dek ertelemez. Gecikme 0 (dil değişimi) bekleyeni öne çeker.
   */
  function jumpListYenile(gecikmeMs = JUMP_LIST_GECIKMESI_MS) {
    if (sonJumpListImzasi === planImzasi(null) && ayarlar().tetikJumpList !== true) return; // kapalı ve zaten boş
    if (jumpListZamanlayicisi !== null && gecikmeMs > 0) return;
    zaman.clearTimeout(jumpListZamanlayicisi);
    jumpListZamanlayicisi = zaman.setTimeout(jumpListUygula, gecikmeMs);
  }

  // --- evpaneli:// kaydı ----------------------------------------------------------------------------------------------
  let protokolKayitli = false;

  function protokolUygula() {
    const h = hedef();
    if (!h || typeof app.setAsDefaultProtocolClient !== 'function') return;
    const args = [...h.onek, '--']; // "--": bağlantı metni Chromium seçeneği olarak yorumlanamaz
    try {
      const bizim = typeof app.isDefaultProtocolClient === 'function' && app.isDefaultProtocolClient(PROTOKOL, h.program, args) === true;
      if (ayarlar().tetikProtokol === true) {
        protokolKayitli = bizim || app.setAsDefaultProtocolClient(PROTOKOL, h.program, args) === true;
        if (!protokolKayitli) gunluk('evpaneli:// kaydı yazılamadı.');
      } else {
        if (bizim && typeof app.removeAsDefaultProtocolClient === 'function') app.removeAsDefaultProtocolClient(PROTOKOL, h.program, args);
        protokolKayitli = false;
      }
    } catch {
      gunluk('evpaneli:// kaydı güncellenemedi.');
    }
  }

  // --- yerel API ------------------------------------------------------------------------------------------------------
  const api = yerelApiFabrikasi({
    jetonAl: async () => {
      try {
        const j = await jetonDeposu.anahtarAl();
        return jetonGecerliMi(j) ? j : null;
      } catch {
        return null;
      }
    },
    isle: async (yol, govde) => {
      if (ayarlar().tetikYerelApi !== true) return { ok: false, tur: 'kapali' };
      if (yol === '/liste') return { ok: true, favoriler: kapi.listeAl() };
      if (yol === '/durum') return kapi.durumAl(govde.ad);
      return kapi.calistir({ kaynak: 'yerel-api', ...govde });
    },
    gunluk,
    simdi,
  });
  let apiSirasi = Promise.resolve();

  /** Jeton yoksa üretir ve safeStorage'a yazar. Jetonun kendisi dışarı verilmez. */
  async function jetonHazirla() {
    let j = null;
    try {
      j = await jetonDeposu.anahtarAl();
    } catch {
      j = null;
    }
    if (jetonGecerliMi(j)) return j;
    const yeni = jetonUret();
    await jetonDeposu.yaz(yeni);
    return yeni;
  }

  function apiUygula() {
    apiSirasi = apiSirasi
      .catch(() => {})
      .then(async () => {
        const a = ayarlar();
        if (a.tetikYerelApi !== true) {
          await api.durdur();
          return;
        }
        try {
          await jetonHazirla();
        } catch {
          gunluk('Yerel API jetonu hazırlanamadı.');
          await api.durdur();
          return;
        }
        const port = Number.isInteger(a.tetikApiPortu) ? a.tetikApiPortu : VARSAYILAN_PORT;
        const d = api.durum();
        if (d.calisiyor && d.port === port) return;
        await api.baslat(port);
      })
      .finally(durumDegisti);
    return apiSirasi;
  }

  // --- toplantı ışığı -------------------------------------------------------------------------------------------------
  let toplantida = false;
  const izleyici = izleyiciFabrikasi({
    sorgula: (anahtar) => (typeof regSorgula === 'function' ? regSorgula(anahtar) : Promise.reject(new Error('yok'))),
    kaynakAl: () => ayarlar().tetikToplantiKaynak ?? 'ikisi',
    aralikAl: () => (Number.isInteger(ayarlar().tetikToplantiAralik) ? ayarlar().tetikToplantiAralik : 10) * 1000,
    degisti: (kullanimda) => {
      toplantida = kullanimda;
      durumDegisti();
      const a = ayarlar();
      if (a.tetikToplanti !== true) return;
      const favori = typeof a.tetikToplantiFavori === 'string' ? a.tetikToplantiFavori : '';
      if (kullanimda) {
        if (favori) kapi.calistir({ kaynak: 'toplanti', kimlik: favori, islem: 'baslat' });
        return;
      }
      const bitis = a.tetikToplantiBitis ?? 'geriYukle';
      if (bitis === 'geriYukle' && favori) kapi.calistir({ kaynak: 'toplanti', kimlik: favori, islem: 'geriYukle' });
      else if (bitis === 'kapat' && favori) kapi.calistir({ kaynak: 'toplanti', kimlik: favori, islem: 'kapat' });
      else if (bitis === 'favori' && typeof a.tetikToplantiBitisFavori === 'string' && a.tetikToplantiBitisFavori) {
        kapi.calistir({ kaynak: 'toplanti', kimlik: a.tetikToplantiBitisFavori, islem: 'baslat' });
      }
    },
    gunluk,
    zaman,
  });

  let izlenenFavori = ''; // izleyicinin kurulduğu başlangıç favorisi

  function toplantiUygula() {
    const a = ayarlar();
    const favori = typeof a.tetikToplantiFavori === 'string' ? a.tetikToplantiFavori : '';
    const acik = a.tetikToplanti === true && typeof regSorgula === 'function' && favori !== '';
    if (acik && izleyici.durum().calisiyor && favori === izlenenFavori) {
      // Seçenek açık kalıp yalnız aralık / kaynak değişti: izleyici sıfırlanmaz. Sıfırlama devam eden toplantıyı yeniden "başladı" sayar,
      // başlangıç eylemini bir kez daha çalıştırırdı (ışığı toplantı sırasında kapatan kullanıcı için ışık yeniden açılırdı).
      izleyici.yenile();
      durumDegisti();
      return;
    }
    izleyici.durdur();
    toplantida = false;
    izlenenFavori = favori;
    if (acik) izleyici.baslat();
    durumDegisti();
  }

  // --- PC olayları ----------------------------------------------------------------------------------------------------
  const pcZamanlayicilari = new Set();

  function pcKurallariniCalistir(olayAdi) {
    const a = ayarlar();
    if (a.tetikPcOlaylari !== true) return;
    for (const kural of olayKurallari(a.tetikPcKurallari, olayAdi)) {
      kapi.calistir({ kaynak: 'pc-olayi', kimlik: kural.kimlik, islem: kural.islem }).then((sonuc) => {
        if (!sonuc?.ok || ayarlar().tetikPcUyarisi === true) return;
        // İlk kullanımda bir kez söylenir: PC olayı bir favoriyi çalıştırdı, nereden kapatılacağı.
        ayarYaz({ tetikPcUyarisi: true });
        geriBildirim({ tur: 'ok', metin: t('dis.pcIlkKez') });
      });
    }
  }

  /**
   * powerMonitor olayı (main.js). Uykuya geçerken kurallar bekletilmeden çalışır (istek askıya almadan önce çıksın); uyanış ve kilit
   * açılışında kısa bekleme vardır. Toplantı yoklaması uykuda durur.
   * @param {'kilit'|'kilitAcildi'|'uyku'|'uyanis'} olayAdi
   */
  function guc(olayAdi) {
    if (!PC_OLAYLARI.includes(olayAdi)) return;
    if (olayAdi === 'uyku') izleyici.duraklat();
    if (olayAdi === 'uyanis') izleyici.surdur();
    const gecikme = OLAY_GECIKMESI_MS[olayAdi] ?? 0;
    if (gecikme === 0) {
      pcKurallariniCalistir(olayAdi);
      return;
    }
    const z = zaman.setTimeout(() => {
      pcZamanlayicilari.delete(z);
      pcKurallariniCalistir(olayAdi);
    }, gecikme);
    pcZamanlayicilari.add(z);
  }

  // --- dış istekler ---------------------------------------------------------------------------------------------------

  /** Jump List görevi ya da masaüstü kısayolu: `--eylem=<ad> --kaynak=jumplist|kisayol`. */
  function komutSatirindan({ ad, kaynak }) {
    if (kaynak !== 'jumplist' && kaynak !== 'kisayol-dosyasi') return Promise.resolve({ ok: false, tur: 'gecersiz' });
    return kapi.calistir({ kaynak, ad });
  }

  /** evpaneli:// bağlantısı (ikinci kopya ya da açılış argümanı). */
  function protokoldan(metin) {
    const cozum = protokolBaglantisiCoz(metin);
    if (cozum.hata) {
      gunluk('evpaneli:// bağlantısı anlaşılamadı.'); // bağlantı metni günlüğe yazılmaz
      if (ayarlar().tetikProtokol === true) geriBildirim({ tur: 'hata', metin: t('dis.baglantiGecersiz') });
      return Promise.resolve({ ok: false, tur: 'gecersiz' });
    }
    return kapi.calistir({ kaynak: 'protokol', ...cozum });
  }

  // --- Ayarlar sayfası işlemleri --------------------------------------------------------------------------------------

  /** Masaüstüne seçilen favori için .lnk (seçenek açıkken, yalnız uygun favori). Var olan dosyanın üzerine yazılmaz. */
  function kisayolOlustur(kimlik) {
    if (ayarlar().tetikMasaustu !== true) return { ok: false, hata: 'kapali' };
    const uygun = kapi.uygunlar().find((u) => u.karo.id === kimlik);
    if (!uygun) return { ok: false, hata: 'uygun-degil' };
    const h = hedef();
    const klasor = masaustuAl();
    if (!h || typeof klasor !== 'string' || klasor === '' || typeof shell.writeShortcutLink !== 'function') return { ok: false, hata: 'yazilamadi' };
    const ad = dosyaAdiDuzelt(uygun.karo.etiket || uygun.ad);
    const dosya = bosKisayolAdi(ad, (d) => fs.existsSync(path.join(klasor, d)));
    const secenek = kisayolSecenekleri({ ad: uygun.ad, program: h.program, onekArgumanlar: h.onek, aciklama: t('dis.gorevAciklama', { ad: uygun.karo.etiket || uygun.ad }) });
    if (!dosya || !secenek) return { ok: false, hata: 'yazilamadi' };
    try {
      if (shell.writeShortcutLink(path.join(klasor, dosya), 'create', secenek) !== true) return { ok: false, hata: 'yazilamadi' };
    } catch {
      gunluk('Masaüstü kısayolu yazılamadı.');
      return { ok: false, hata: 'yazilamadi' };
    }
    return { ok: true, dosya };
  }

  /** Favorinin evpaneli:// bağlantısını panoya kopyalar (favori adı taşır, kimlik değil). */
  function baglantiKopyala(kimlik) {
    const uygun = kapi.uygunlar().find((u) => u.karo.id === kimlik);
    const baglanti = uygun ? protokolBaglantisi(uygun.ad) : null;
    if (!baglanti || typeof clipboard.writeText !== 'function') return { ok: false, hata: 'uygun-degil' };
    clipboard.writeText(baglanti);
    return { ok: true };
  }

  /** Yerel API jetonunu panoya kopyalar (jeton yoksa üretir). Jeton renderer'a ve günlüğe ASLA gitmez. */
  async function jetonKopyala() {
    if (typeof clipboard.writeText !== 'function') return { ok: false, hata: 'yazilamadi' };
    try {
      clipboard.writeText(await jetonHazirla());
      durumDegisti();
      return { ok: true };
    } catch {
      return { ok: false, hata: 'jeton' };
    }
  }

  /** Yeni jeton üretir; eskisiyle gelen istekler hemen 401 alır. */
  async function jetonYenile() {
    try {
      await jetonDeposu.yaz(jetonUret());
      gunluk('Yerel API jetonu yenilendi.');
      durumDegisti();
      return { ok: true };
    } catch {
      return { ok: false, hata: 'jeton' };
    }
  }

  function izinKaldir(kimlik) {
    const liste = Array.isArray(ayarlar().tetikProtokolIzinleri) ? ayarlar().tetikProtokolIzinleri : [];
    if (typeof kimlik !== 'string' || !liste.includes(kimlik)) return { ok: false };
    ayarYaz({ tetikProtokolIzinleri: liste.filter((k) => k !== kimlik) });
    durumDegisti();
    return { ok: true };
  }

  /** Ayarlar sayfasının "Dış tetikler" bölümü için durum (jeton yok; yalnız var/yok). */
  async function durum() {
    let jetonVar = false;
    try {
      jetonVar = jetonGecerliMi(await jetonDeposu.anahtarAl());
    } catch {
      jetonVar = false;
    }
    const karoAdi = new Map();
    for (const k of (() => {
      try {
        return karolarAl() ?? [];
      } catch {
        return [];
      }
    })()) {
      if (k && typeof k.id === 'string') karoAdi.set(k.id, k.etiket);
    }
    const a = ayarlar();
    return {
      ok: true,
      uygunlar: kapi.uygunlar().map(({ karo, ad }) => ({ kimlik: karo.id, ad: karo.etiket || ad })),
      kuralUygunlari: kapi.kuralUygunlari().map((k) => ({ kimlik: k.id, ad: k.etiket, acKapa: ['light', 'switch', 'fan', 'input_boolean', 'humidifier'].includes(k.alan) })),
      izinler: (Array.isArray(a.tetikProtokolIzinleri) ? a.tetikProtokolIzinleri : []).map((kimlik) => ({ kimlik, ad: karoAdi.get(kimlik) ?? null })),
      api: { ...api.durum(), jetonVar },
      protokol: { kayitli: protokolKayitli },
      toplanti: { ...izleyici.durum(), toplantida, okunabilir: typeof regSorgula === 'function' },
    };
  }

  // --- yaşam döngüsü --------------------------------------------------------------------------------------------------

  function baslat() {
    jumpListUygula();
    protokolUygula();
    apiUygula();
    toplantiUygula();
  }

  /** Uygulama kapanırken: API ve yoklama durur. Jump List ve protokol kaydı seçenek açık kaldıkça yerinde kalır. */
  function durdur() {
    zaman.clearTimeout(jumpListZamanlayicisi);
    for (const z of pcZamanlayicilari) zaman.clearTimeout(z);
    pcZamanlayicilari.clear();
    izleyici.durdur();
    if (bekleyen) bekleyen.bitir('reddet');
    return api.durdur();
  }

  /** Bir ayar alanı değişti (main.js ekAyarDinle). */
  function ayarDegisti(ad) {
    const tur = AYAR_TETIKLERI[ad];
    if (tur === 'jumpList') jumpListUygula();
    else if (tur === 'protokol') protokolUygula();
    else if (tur === 'api') apiUygula();
    else if (tur === 'toplanti') toplantiUygula();
    if (ad === 'tetikPcOlaylari' || ad === 'tetikPcKurallari' || ad === 'tetikPcAcma') durumDegisti();
  }

  /** Favoriler, dil ya da canlı model değişti: Jump List (imza aynıysa yazılmaz) gecikmeli tazelenir. */
  function favorilerDegisti() {
    jumpListYenile();
  }

  return {
    baslat,
    durdur,
    ayarDegisti,
    favorilerDegisti,
    dilDegisti: () => jumpListYenile(0),
    komutSatirindan,
    protokoldan,
    guc,
    onay,
    kisayolOlustur,
    baglantiKopyala,
    jetonKopyala,
    jetonYenile,
    izinKaldir,
    durum,
    dinle(fn) {
      if (typeof fn !== 'function') return () => {};
      dinleyiciler.add(fn);
      return () => dinleyiciler.delete(fn);
    },
    /** Tanılama raporu için (sır yok): hangi tetikler açık, API çalışıyor mu. */
    tanilamaOzeti() {
      const a = ayarlar();
      return {
        jumpList: a.tetikJumpList === true,
        masaustu: a.tetikMasaustu === true,
        protokol: a.tetikProtokol === true,
        protokolIzinSayisi: Array.isArray(a.tetikProtokolIzinleri) ? a.tetikProtokolIzinleri.length : 0,
        yerelApi: a.tetikYerelApi === true,
        apiCalisiyor: api.durum().calisiyor,
        pcOlaylari: a.tetikPcOlaylari === true,
        pcKuralSayisi: Array.isArray(a.tetikPcKurallari) ? a.tetikPcKurallari.length : 0,
        toplanti: a.tetikToplanti === true,
      };
    },
    kapi,
  };
}

module.exports = { ONAY_SURESI_MS, EN_AZ_GORUNME_MS, AYAR_TETIKLERI, DINLENEN_AYARLAR, disTetiklerOlustur, regSorgulayiciOlustur };
