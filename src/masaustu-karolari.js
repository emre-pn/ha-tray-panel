'use strict';

/**
 * Masaüstüne sabitlenen karolar (o-33, 1.4.0): seçili favoriler ayrı, küçük, çerçevesiz yerel pencereler olarak masaüstünde durur.
 * Her karo kendi penceresidir (masaustu-karo.html); taşınır, boyutlanır, konumu ayarda (`masaustuKaroKonumlari`) kalıcıdır.
 * Hangi karoların açılacağına, süzgeçten ve sınıflamadan geçip geçmediğine src/lib/masaustu-karo.js karar verir (`karolariAl`).
 *
 * Güvenlik
 *  - Sayfaya yalnız src/lib/masaustu-karo.js masaustuKaroModeli'nin alan beyaz listesi gider (anahtar, adres, HA'daki ham ad gitmez).
 *  - Her IPC kanalı gönderenin O karonun penceresi ve masaustu-karo.html (ana çerçeve) olduğunu denetler (yerelOlaydanMi). Karonun
 *    kimliği sayfadan gelmez: ana süreç pencere -> karo eşlemesini kendisi tutar. Yük yalnız 'tikla' ya da sabit parlaklık
 *    ön ayarıdır (karoYukunuDuzelt); ayrıca karonun modeli o eylemi sunuyor olmalıdır.
 *  - Eylem kaynağı 'masaustu': onay/basılı tutma sunulmaz, yıkıcı eylem çalışmaz; her şey tek güvenli hattan geçer (src/eylem.js).
 *  - HA'daki ad sonradan Kapı Kuralı'na takılırsa (ya da favori/seçim kalkarsa) karo her durum değişiminde (esitle) kapatılır.
 *  - Sayfa süreci ölürse pencere yok edilir; aynı karo bir oturumda 3 kez ölürse yeniden açılmaz (çökme döngüsü olmaz).
 *  - Açılış gecikmesi (hazirla) bitmeden gelen durum değişiklikleri karo açmaz: ilk durum akını ana pencere ve tepsiden önce karo
 *    penceresi açmasın (modelDegisti, açılış zamanlayıcısı dolana dek bekler; ayar kaynaklı esitle çağrıları bundan etkilenmez).
 *  - Görünüm (o-25 / o-29 / o-34): sayfaya görünüm modeli (yüksek karşıtlık, palet, hareketi azalt) gider ve metin boyutu çarpanı
 *    sayfa yakınlaştırması olarak uygulanır; pencerenin en az/en çok boyutu aynı oranda büyür (köşe bildirimi ve itme kartıyla aynı).
 *
 * Penceresiz çalışan karo tepside ya da görev çubuğunda görünmez (skipTaskbar). Çerçevesiz pencerenin sürükle/yeniden boyutlandır
 * davranışı, çok monitörlü yerleşim ve Windows 11 malzemesi gerçek Windows'ta DENENMEDİ (README elle deneme listesi).
 */

const path = require('node:path');
const { ipcMain } = require('electron');
const { yerelPencereOlustur, yerelOlaydanMi, malzemeUygula } = require('./yerel-pencere');
const { karoHedefi, karoKonumKaydiHesapla, karoYukunuDuzelt, KARO_BOYUT_SINIRLARI } = require('./lib/masaustu-karo');
const { cokmeSayilirMi, cokmeNedeniMetni } = require('./lib/cokme-siniri');
const { TR } = require('./lib/ceviri-varsayilan');

const KARO_HTML = path.join(__dirname, 'masaustu-karo.html');
const PRELOAD_KARO = path.join(__dirname, 'preload-karo.js');
const KONUM_KAYIT_GECIKMESI_MS = 600; // taşıma/boyutlandırma bitince konum ayara yazılır (sürüklerken her adımda yazılmaz)
const ILK_ACILIS_GECIKMESI_MS = 2000;
const EN_COK_COKME = 3;
const OPAK_MALZEME = Object.freeze({ malzeme: 'yok', secenekler: Object.freeze({ backgroundColor: '#2a3040' }) });
const YERLESIM_TOLERANSI = 2; // DIP; karma DPI yuvarlamasını "kullanıcı taşımadı" saymak için
const sinirla = (deger, enAz, enCok) => Math.min(enCok, Math.max(enAz, deger));

/** İki pencere sınırı (tolerans dahilinde) aynı mı? */
const ayniSinir = (a, b) =>
  !!a && !!b && ['x', 'y', 'width', 'height'].every((anahtar) => Number.isFinite(a[anahtar]) && Number.isFinite(b[anahtar]) && Math.abs(a[anahtar] - b[anahtar]) <= YERLESIM_TOLERANSI);

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} bag
 * @param {() => {kimlik: string, karo: object}[]} bag.karolariAl şu an sabitlenecek karolar, sıralı (src/lib/masaustu-karo.js sabitlenecekKarolar)
 * @param {(kimlik: string) => (object|null)} bag.modelAl karonun sayfa modeli (masaustuKaroModeli); karo geçersizse null
 * @param {{masaustundenCalistir: Function}} bag.eylem
 * @param {() => object} bag.konumlariAl ayardaki konum kayıtları (masaustuKaroKonumlari)
 * @param {(kayitlar: object) => void} bag.konumKaydet yeni konum kayıt haritasını ayara yazar
 * @param {() => boolean} bag.ustteAl ayar masaustuKaroUstte
 * @param {() => object[]} bag.ekranlarAl bağlı ekran özetleri (ekranlariOzetle)
 * @param {(kimlik: string) => void} bag.kaldir karoyu sabitleme listesinden çıkarır (pencerenin × düğmesi / kapatılması)
 * @param {() => ({malzeme: string, secenekler: object})} [bag.malzemeAl]
 * @param {() => (object|null)} [bag.gorunumAl] görünüm modeli (src/lib/gorunum.js gorunumModeli); null ise sayfaya gönderilmez
 * @param {() => number} [bag.metinOlcegiAl] Ayarlar > Görünüm > Metin boyutu çarpanı (1 ile 2 arası; geçersizse 1)
 * @param {Function} [bag.t] çevirmen
 * @param {() => string} [bag.dilAl]
 * @param {(m: string) => void} [bag.gunluk]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 */
function masaustuKarolariOlustur({ karolariAl, modelAl, eylem, konumlariAl, konumKaydet, ustteAl, ekranlarAl, kaldir, malzemeAl = () => OPAK_MALZEME, gorunumAl = () => null, metinOlcegiAl = () => 1, t = TR, dilAl = null, gunluk = () => {}, zaman = varsayilanZaman() }) {
  const karolar = new Map(); // karo kimliği -> { kimlik, sira, pencere, yuklendi, gosterildi, sonModel, olcek, yakinlastirma, kayitZamanlayicisi, bizKapatiyor }
  const cokmeler = new Map(); // karo kimliği -> bu oturumdaki çökme sayısı
  let kapaniyor = false;
  let acilisZamanlayicisi = null;
  let acilisBekliyor = false; // hazirla() çağrıldı, gecikme henüz dolmadı: modelDegisti karo açmaz
  const izinYok = () => ({ ok: false, hata: t('ana.izinYok') });

  const canliMi = (e) => !!e.pencere && !e.pencere.isDestroyed();

  function guvenli(is, mesaj) {
    try {
      return is();
    } catch {
      gunluk(mesaj);
      return undefined;
    }
  }

  function istenenKarolar() {
    return guvenli(() => karolariAl(), 'Masaüstü karoları belirlenemedi.') ?? [];
  }

  /** Ayarlar > Görünüm > Metin boyutu çarpanı; sayı değilse ya da 1 ile 2 arasında değilse 1 (köşe bildirimiyle aynı doğrulama). */
  function metinOlcegi() {
    let olcek = 1;
    try {
      olcek = Number(metinOlcegiAl());
    } catch {
      gunluk('Masaüstü karosu metin boyutu okunamadı.');
    }
    return Number.isFinite(olcek) && olcek >= 1 && olcek <= 2 ? olcek : 1;
  }

  /** Görünüm modeli (nesne) ya da null: varsayılan görünümde sayfaya hiçbir anahtar gitmez. */
  function gorunumOku() {
    try {
      const g = gorunumAl();
      return g && typeof g === 'object' ? g : null;
    } catch {
      gunluk('Masaüstü karosu görünümü okunamadı.');
      return null;
    }
  }

  /** Pencerenin en az/en çok boyutu metin boyutuyla orantılı büyür; yeni sınırın dışında kalan pencere sınıra çekilir. */
  function boyutSiniriniUygula(e, olcek) {
    const { en_az: az, en_cok: cok } = KARO_BOYUT_SINIRLARI;
    const enAz = { width: Math.round(az.width * olcek), height: Math.round(az.height * olcek) };
    const enCok = { width: Math.round(cok.width * olcek), height: Math.round(cok.height * olcek) };
    const p = e.pencere;
    try {
      if (typeof p.setMinimumSize === 'function') p.setMinimumSize(enAz.width, enAz.height);
      if (typeof p.setMaximumSize === 'function') p.setMaximumSize(enCok.width, enCok.height);
      if (typeof p.getBounds !== 'function' || typeof p.setBounds !== 'function') return;
      const mevcut = p.getBounds();
      const yeni = { x: mevcut.x, y: mevcut.y, width: sinirla(mevcut.width, enAz.width, enCok.width), height: sinirla(mevcut.height, enAz.height, enCok.height) };
      if (yeni.width === mevcut.width && yeni.height === mevcut.height) return;
      e.yerlesim = yeni; // bu boyut değişimi kullanıcıdan gelmedi: konumuKaydet kayıtlı konumu ezmez
      p.setBounds(yeni);
    } catch {
      gunluk('Masaüstü karosu boyutu ayarlanamadı.');
    }
  }

  /** Metin boyutu çarpanı değiştiyse sayfa yakınlaştırması ve pencere sınırları güncellenir. Kayıtlı konuma dokunulmaz. */
  function olcegiUygula(e, olcek) {
    const wc = e.pencere.webContents;
    if (olcek !== e.yakinlastirma && typeof wc.setZoomFactor === 'function') {
      try {
        wc.setZoomFactor(olcek);
        e.yakinlastirma = olcek;
      } catch {
        gunluk('Masaüstü karosu yakınlaştırması uygulanamadı.');
      }
    }
    if (olcek === e.olcek) return;
    e.olcek = olcek;
    boyutSiniriniUygula(e, olcek);
  }

  function modelGonder(e, zorla = false) {
    if (!canliMi(e) || !e.yuklendi) return;
    const model = guvenli(() => modelAl(e.kimlik), 'Masaüstü karosu modeli alınamadı.');
    if (!model) return;
    const malzeme = guvenli(() => malzemeAl().malzeme, 'Masaüstü karosu malzemesi okunamadı.') ?? 'yok';
    const gorunum = gorunumOku();
    const olcek = metinOlcegi();
    const imza = JSON.stringify([model, malzeme, gorunum, olcek]);
    if (!zorla && imza === e.sonModel) return; // değişmeyen model yeniden gönderilmez (durum deposu sık tetiklenir)
    e.sonModel = imza;
    olcegiUygula(e, olcek);
    guvenli(() => e.pencere.webContents.send('karo:durum', { model, malzeme, ...(gorunum ? { gorunum } : {}) }), 'Masaüstü karosu modeli gönderilemedi.');
  }

  function konumuKaydet(e) {
    if (!canliMi(e) || typeof e.pencere.getBounds !== 'function') return;
    const sinirlar = guvenli(() => e.pencere.getBounds(), 'Masaüstü karosu konumu okunamadı.');
    if (!sinirlar) return;
    // Pencere bizim yerleştirdiğimiz yerde duruyorsa (açılış, ekran değişimi) bu kullanıcının seçimi değildir: kayıtlı konum ezilmez.
    if (e.yerlesim && ayniSinir(sinirlar, e.yerlesim)) return;
    const yeni = karoKonumKaydiHesapla({ kimlik: e.kimlik, sinirlar, mevcut: konumlariAl(), olcek: e.olcek });
    if (yeni) guvenli(() => konumKaydet(yeni), 'Masaüstü karosu konumu kaydedilemedi.');
    e.yerlesim = null; // kullanıcı taşıdı ve kayıt yapıldı: bundan sonraki her konum kullanıcının seçimidir
  }

  function konumuZamanla(e) {
    if (!e.gosterildi) return; // oluşturma/yerleştirme sırasındaki olaylar kayıt sayılmaz
    zaman.clearTimeout(e.kayitZamanlayicisi);
    e.kayitZamanlayicisi = zaman.setTimeout(() => {
      e.kayitZamanlayicisi = null;
      konumuKaydet(e);
    }, KONUM_KAYIT_GECIKMESI_MS);
  }

  /** Karoyu kapatır (biz kapatıyoruz: 'closed' olayı "kullanıcı kapattı" sayılmaz). */
  function kapatKaro(e, { konumKaydi = false } = {}) {
    zaman.clearTimeout(e.kayitZamanlayicisi);
    if (konumKaydi && e.kayitZamanlayicisi !== null) konumuKaydet(e); // bekleyen konum kaybolmasın (uygulama kapanırken)
    e.kayitZamanlayicisi = null;
    e.bizKapatiyor = true;
    karolar.delete(e.kimlik);
    if (e.pencere && !e.pencere.isDestroyed()) guvenli(() => e.pencere.destroy(), 'Masaüstü karosu penceresi kapatılamadı.');
  }

  function sifirla(e, neden) {
    if (karolar.get(e.kimlik) !== e) return;
    gunluk(`Masaüstü karosu penceresi sıfırlandı (${neden}).`);
    cokmeler.set(e.kimlik, (cokmeler.get(e.kimlik) ?? 0) + 1);
    kapatKaro(e);
  }

  function olustur(kimlik, sira) {
    if ((cokmeler.get(kimlik) ?? 0) >= EN_COK_COKME) return; // art arda çöken karo bu oturumda yeniden açılmaz
    const olcek = metinOlcegi();
    const hedef = karoHedefi({ kayit: konumlariAl()?.[kimlik] ?? null, sira, ekranlar: guvenli(() => ekranlarAl(), 'Ekranlar okunamadı.') ?? [], olcek });
    // olcek: pencere sınırlarının dayandığı çarpan; yakinlastirma: sayfaya yazılmış yakınlaştırma (yeni sayfada 1; ilk modelle birlikte yazılır).
    const e = { kimlik, sira, pencere: null, yuklendi: false, gosterildi: false, sonModel: null, olcek, yakinlastirma: 1, kayitZamanlayicisi: null, bizKapatiyor: false, yerlesim: { x: hedef.x, y: hedef.y, width: hedef.width, height: hedef.height } };
    try {
      const bu = yerelPencereOlustur({
        preload: PRELOAD_KARO,
        secenekler: {
          x: hedef.x,
          y: hedef.y,
          width: hedef.width,
          height: hedef.height,
          minWidth: Math.round(KARO_BOYUT_SINIRLARI.en_az.width * olcek),
          minHeight: Math.round(KARO_BOYUT_SINIRLARI.en_az.height * olcek),
          maxWidth: Math.round(KARO_BOYUT_SINIRLARI.en_cok.width * olcek),
          maxHeight: Math.round(KARO_BOYUT_SINIRLARI.en_cok.height * olcek),
          show: false,
          frame: false,
          skipTaskbar: true,
          alwaysOnTop: ustteAl() === true,
          resizable: true,
          movable: true,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          title: t('uygulama.masaustuKaroBaslik'),
          roundedCorners: true, // `transparent` KULLANILMAZ (Windows 11 yuvarlak köşe; malzeme backgroundMaterial ile)
          ...malzemeAl().secenekler,
        },
      });
      e.pencere = bu;
      const wc = bu.webContents;
      wc.once('did-finish-load', () => {
        if (karolar.get(kimlik) !== e || bu.isDestroyed()) return;
        e.yuklendi = true;
        modelGonder(e, true);
        // Odağı çalmaz: karo masaüstünde durur, kullanıcının çalıştığı pencere etkin kalır.
        guvenli(() => (typeof bu.showInactive === 'function' ? bu.showInactive() : bu.show()), 'Masaüstü karosu gösterilemedi.');
        e.gosterildi = true;
      });
      wc.on('render-process-gone', (_olay, ayrinti) => {
        if (!cokmeSayilirMi(ayrinti?.reason)) return;
        sifirla(e, `sayfa-sureci-kapandi:${cokmeNedeniMetni(ayrinti?.reason)}`);
      });
      wc.on('did-fail-load', (_olay, hataKodu, _aciklama, _url, anaCerceve) => {
        if (anaCerceve === false || hataKodu === -3 /* ERR_ABORTED */) return;
        sifirla(e, `sayfa-yuklenemedi:${hataKodu}`);
      });
      bu.on('move', () => konumuZamanla(e));
      bu.on('resize', () => konumuZamanla(e));
      bu.on('closed', () => {
        zaman.clearTimeout(e.kayitZamanlayicisi);
        if (karolar.get(kimlik) === e) karolar.delete(kimlik);
        // Kullanıcı kapattı (ör. Alt+F4): sabitleme kaldırılır, karo kendiliğinden geri gelmez.
        if (!e.bizKapatiyor && !kapaniyor) guvenli(() => kaldir(kimlik), 'Masaüstü karosu kaldırılamadı.');
      });
      karolar.set(kimlik, e);
      Promise.resolve(bu.loadFile(KARO_HTML)).catch(() => sifirla(e, 'yukleme-reddedildi'));
    } catch {
      gunluk('Masaüstü karosu penceresi oluşturulamadı.');
      karolar.delete(kimlik);
    }
  }

  /**
   * Ayardaki seçim ve durum değişince çağrılır (ve her durum değişiminde): olması gereken karo penceresi yoksa açılır, artık
   * gerekmeyen (seçimden çıkan, favori olmaktan çıkan, Kapı Kuralı'na takılan) kapatılır, sayfalara güncel model gider.
   */
  function esitle() {
    if (kapaniyor) return;
    const istenen = istenenKarolar();
    const kimlikler = new Set(istenen.map((k) => k.kimlik));
    for (const e of [...karolar.values()]) if (!kimlikler.has(e.kimlik)) kapatKaro(e);
    istenen.forEach((k, sira) => {
      const e = karolar.get(k.kimlik);
      if (e) e.sira = sira;
      else olustur(k.kimlik, sira);
    });
    for (const e of karolar.values()) modelGonder(e);
  }

  // --- IPC (hepsi gönderen denetimli) ---

  const karodanBul = (olay) => {
    for (const e of karolar.values()) if (canliMi(e) && yerelOlaydanMi(olay, e.pencere, KARO_HTML)) return e;
    return null;
  };

  function ipcKaydet() {
    ipcMain.handle('karo:durum-al', (olay) => {
      const e = karodanBul(olay);
      if (!e) return izinYok();
      const gorunum = gorunumOku();
      return { ok: true, model: guvenli(() => modelAl(e.kimlik), 'Masaüstü karosu modeli alınamadı.') ?? null, malzeme: malzemeAl().malzeme, ...(gorunum ? { gorunum } : {}), ...(dilAl ? { dil: dilAl() } : {}) };
    });
    ipcMain.handle('karo:calistir', async (olay, yuk) => {
      const e = karodanBul(olay);
      if (!e) return izinYok();
      const duzgun = karoYukunuDuzelt(yuk);
      if (!duzgun) return { ok: false, tur: 'gecersiz' };
      const model = guvenli(() => modelAl(e.kimlik), 'Masaüstü karosu modeli alınamadı.');
      if (!model) return { ok: false, tur: 'gecersiz' }; // karo artık geçerli değil (esitle kapatacak)
      if (duzgun.parlaklik !== undefined) {
        if (!model.parlaklikOnAyarlari.includes(duzgun.parlaklik)) return { ok: false, tur: 'gecersiz' };
        return eylem.masaustundenCalistir({ kimlik: e.kimlik, parlaklik: duzgun.parlaklik });
      }
      if (model.tiklanabilir !== true) return { ok: false, tur: 'gecersiz' };
      return eylem.masaustundenCalistir({ kimlik: e.kimlik });
    });
    ipcMain.on('karo:kaldir', (olay) => {
      const e = karodanBul(olay);
      if (!e) return;
      guvenli(() => kaldir(e.kimlik), 'Masaüstü karosu kaldırılamadı.');
      esitle(); // sabitleme listeden çıktı: pencere hemen kapanır (bir sonraki durum değişimini beklemez)
    });
  }

  return {
    ipcKaydet,
    /** Açılıştan biraz sonra karolar arka planda açılır (ana pencere ve tepsi önce gelsin). */
    hazirla(gecikmeMs = ILK_ACILIS_GECIKMESI_MS) {
      zaman.clearTimeout(acilisZamanlayicisi);
      acilisBekliyor = true;
      acilisZamanlayicisi = zaman.setTimeout(() => {
        acilisZamanlayicisi = null;
        acilisBekliyor = false;
        esitle();
      }, gecikmeMs);
    },
    esitle,
    /**
     * Durum deposu değişti: geçersizleşen karo kapanır, açık karoların modeli (değiştiyse) tazelenir. Açılış gecikmesi (hazirla)
     * dolmadan gelen değişiklik hiçbir şey yapmaz: ilk bağlantı / durum akını karo penceresini erkenden açmasın; gecikme dolunca
     * esitle zaten güncel durumu okur.
     */
    modelDegisti() {
      if (acilisBekliyor) return;
      esitle();
    },
    /** Ayar masaustuKaroUstte değişti: açık karoların "her zaman üstte" durumu güncellenir. */
    ustteDegisti() {
      const ust = guvenli(() => ustteAl() === true, 'Masaüstü karosu üst durumu okunamadı.') === true;
      for (const e of karolar.values()) {
        if (canliMi(e) && typeof e.pencere.setAlwaysOnTop === 'function') guvenli(() => e.pencere.setAlwaysOnTop(ust), 'Masaüstü karosu üst durumu uygulanamadı.');
      }
    },
    /** Ayarlar > Görünüm malzemesi değişti: açık karolara uygulanır ve sayfalara yeni malzeme gider. */
    malzemeyiUygula() {
      for (const e of karolar.values()) {
        if (!canliMi(e)) continue;
        malzemeUygula(e.pencere, malzemeAl());
        modelGonder(e, true);
      }
    },
    /**
     * Görünüm ayarı değişti (yüksek karşıtlık, palet, hareketi azalt, animasyon, metin boyutu): açık karolara güncel görünüm modeli
     * gider ve metin boyutu uygulanır. Ayarlar > Görünüm değişiklikleri karoya bu çağrıyla ulaşır (yoksa sonraki model değişimiyle).
     */
    gorunumuUygula() {
      for (const e of karolar.values()) if (canliMi(e)) modelGonder(e, true);
    },
    /** Arayüz dili değişti: pencere başlığı güncellenir, sayfaya 'dil:degisti' gider. */
    dilDegisti() {
      for (const e of karolar.values()) {
        if (!canliMi(e)) continue;
        guvenli(() => {
          e.pencere.setTitle(t('uygulama.masaustuKaroBaslik'));
          e.pencere.webContents.send('dil:degisti', { dil: dilAl ? dilAl() : (t.dil ?? 'tr') });
        }, 'Masaüstü karosu dili güncellenemedi.');
      }
    },
    /**
     * Ekran bağlandı/söküldü ya da çözünürlük değişti. Kullanıcının taşıdığı karo hâlâ bir ekranda görünüyorsa yerinde kalır (yalnız
     * çalışma alanına sığdırılır); artık görünmüyorsa kayıtlı konumuna (o ekran bağlıysa) ya da varsayılan yerine alınır. Bizim
     * yerleştirdiğimiz (kullanıcının taşımadığı) karo, kayıtlı konumunun ekranı geri gelince oraya döner. Kayıtlı konum silinmez ve
     * bu yerleştirmeler kullanıcı seçimi olarak kaydedilmez.
     */
    ekranDegisti() {
      const ekranlar = guvenli(() => ekranlarAl(), 'Ekranlar okunamadı.') ?? [];
      if (ekranlar.length === 0) return; // ekran listesi okunamadı: karolar yerinde kalır (varsayılan yedek alana atılmaz)
      for (const e of karolar.values()) {
        if (!canliMi(e) || typeof e.pencere.getBounds !== 'function' || typeof e.pencere.setBounds !== 'function') continue;
        guvenli(() => {
          const mevcut = e.pencere.getBounds();
          const mevcutHedef = karoHedefi({ kayit: mevcut, sira: e.sira, ekranlar, olcek: e.olcek });
          const kayitli = karoHedefi({ kayit: konumlariAl()?.[e.kimlik] ?? null, sira: e.sira, ekranlar, olcek: e.olcek });
          const kullaniciTasidi = !e.yerlesim || !ayniSinir(mevcut, e.yerlesim);
          const hedef = !kullaniciTasidi && kayitli.kaynak === 'kayit' ? kayitli : mevcutHedef.kaynak === 'kayit' ? mevcutHedef : kayitli;
          if (hedef.x === mevcut.x && hedef.y === mevcut.y && hedef.width === mevcut.width && hedef.height === mevcut.height) return;
          const sinir = { x: hedef.x, y: hedef.y, width: hedef.width, height: hedef.height };
          e.yerlesim = sinir; // bu hareket kullanıcıdan gelmedi: konumuKaydet kayıtlı konumu ezmez
          e.pencere.setBounds(sinir);
        }, 'Masaüstü karosu yeniden yerleştirilemedi.');
      }
    },
    /** Açık karo kimlikleri (sınama ve tanılama için). */
    acikKimlikler: () => [...karolar.keys()],
    /** Uygulama kapanıyor: bekleyen konumlar yazılır, tüm karo pencereleri yok edilir. */
    kapat() {
      kapaniyor = true;
      acilisBekliyor = false;
      zaman.clearTimeout(acilisZamanlayicisi);
      for (const e of [...karolar.values()]) kapatKaro(e, { konumKaydi: true });
    },
  };
}

module.exports = { KARO_HTML, PRELOAD_KARO, KONUM_KAYIT_GECIKMESI_MS, EN_COK_COKME, masaustuKarolariOlustur };
