'use strict';

/**
 * Eylem grubu bağlayıcısı (1.4.0; Electron'a bağlı değildir): etkinlik geçmişi (o-17), geri al (o-12), gecikmeli eylem (o-15),
 * son değişenler (o-18), oda grubu/odayı kapat (o-14) ve palette "diğer cihazlar" (o-46) modüllerini eylem katmanına (src/eylem.js)
 * ve ana sürece TEK noktadan bağlar. main.js ve yuzey-yoneticisi.js yalnız bu nesneyi kullanır; böylece eylem katmanına yeni giriş
 * noktası açılmaz (test/degismezler.test.js main.js'teki `eylem.` çağrılarını sayar) ve her yeni yüzey (palet, oda, geri al,
 * gecikmeli, diğer cihazlar) aynı tek güvenli hattan geçer: Kapı Kuralı, eylem sınıfı + yüzey izni, servis izin listesi, hız sınırı.
 *
 * Başka modüllerin kullanacağı API (ajanlar için):
 *   eylemEk.etkinlik.ekle({ kaynak, kimlik?, ad?, islem, sonuc, neden? })   // etkinlik geçmişine satır yazar (src/lib/etkinlik-gecmisi.js)
 *   eylem.sonucDinle(({ istek, sonuc, sessiz, hazirlik }) => ...)           // her eylem sonucunu gözlemler (src/eylem.js)
 *   eylem.hazirlikEkle(ad, (istek, ic) => değer|söz)                         // eylemden ÖNCE çalışır (en çok 1,5 sn bekletir); sonuç izleyicide hazirlik[ad]
 *   eylem.kayitliCalistir({ kimlik, kaynak, kayit, eylem?, parti?, sessiz? }, islem)  // favori olmayan varlık için tek seferlik kayıtla, AYNI güvenli hattan
 *   eylemEk.geriAl(kaynak) / eylemEk.modelBolumu()                           // geri al (o-12) ve panel modelinin "eylem" bölümü
 *   eylemEk.gecikmeliPlanla(kaynak, {kimlik, yon, dakika}) / gecikmeliIptal(id) / gecikmeliHepsiniIptal()   // gecikmeli eylem (o-15)
 *   eylemEk.modelBolumu().degisenler   // palet "@" (o-18): son değişen ışık/priz/sahne/klima/medya; yalnız bellekte, en çok 20 satır
 *   eylemEk.odaGruplari(gruplar) / odaKapat(kaynak, kod) / odaAyarDegisti()   // odaya göre gruplama ve "odayı kapat" (o-14)
 *   eylemEk.digerListe(kaynak) / digerCalistir(kaynak, {kimlik, islem}) / digerFavoriEkle(kaynak, kimlik) / digerAyarDegisti()   // palet "*" favori dışı güvenli cihazlar (o-46)
 */

const { etkinlikGecmisiOlustur } = require('./etkinlik-gecmisi');
const { geriAlBaglayiciOlustur } = require('./geri-al-baglayici');
const { gecikmeliEylemOlustur } = require('./gecikmeli-eylem');
const { sonDegisenlerOlustur } = require('./son-degisenler');
const { odaBaglayiciOlustur } = require('./oda-baglayici');
const { digerCihazlarOlustur } = require('./diger-cihazlar');
const { TR } = require('./ceviri-varsayilan');

/** Hata sonuçlarından geçmişe yazılmayanlar: Kapı Kuralı (adı/kimliği saklamamak için), bilinmeyen kayıt, hız sınırı ve onay beklemesi (sonuç değil, ara adım). */
const GECMISE_YAZILMAYAN_HATALAR = new Set(['yasak', 'bilinmeyen-favori', 'cok-sik', 'onay-gerekli', 'bilinmeyen-bildirim']);

/**
 * Eylem izleyicisinin bilgisini etkinlik kaydına çevirir (saf). Ara değerler (kaydırıcı sürükleme, ses +/- basılı tutma) yazılmaz.
 * @param {{istek: object, sonuc: object, sessiz?: boolean}} bilgi
 * @returns {object|null} etkinlik-gecmisi.js ekle() girdisi ya da null
 */
function eylemKaydi(bilgi) {
  const { istek, sonuc, sessiz } = bilgi ?? {};
  if (!istek || !sonuc || sessiz === true) return null;
  const islem = typeof istek.islem === 'string' && istek.islem !== 'cihaz' && istek.islem !== 'gecikmeli'
    ? istek.islem
    : istek.parlaklik !== undefined
      ? 'parlaklik'
      : (sonuc.ok ? sonuc.servis : istek.servis) ?? 'tek-tik';
  const kayit = { kaynak: istek.kaynak, kimlik: istek.kimlik, islem };
  if (sonuc.ok) return { ...kayit, ad: sonuc.ad, sonuc: 'ok' };
  if (GECMISE_YAZILMAYAN_HATALAR.has(sonuc.tur)) return null;
  const neden = typeof sonuc.neden === 'string' && /^[a-z][a-z0-9_-]{1,23}$/.test(sonuc.neden) ? `${sonuc.tur}/${sonuc.neden}` : String(sonuc.tur ?? 'hata');
  return { ...kayit, ad: sonuc.ad, sonuc: 'hata', neden };
}

/**
 * @param {object} bag
 * @param {object} bag.eylem eylem katmanı (src/eylem.js)
 * @param {() => object} bag.ayarlarAl
 * @param {{etkinlik: string}} bag.dosyalar dosya yolları
 * @param {object} bag.fs
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 * @param {object} [bag.zaman] { setTimeout, clearTimeout }
 * @param {(b: {tur: 'ok'|'hata', metin: string}) => void} [bag.bildir] kullanıcı geri bildirimi (geri alma özeti...)
 * @param {Function} [bag.t] çevirmen (verilmezse Türkçe)
 * @param {() => void} [bag.degisti] panel modelinin "eylem" bölümü değişti (yuzey.modelDegisti + tepsi menüsü)
 * @param {(ms: number) => string} [bag.saatMetni] gecikmeli eylem bildirimindeki saat (kullanıcının saat biçimiyle)
 * @param {object} [bag.depo] durum deposu (src/lib/durum-deposu.js): verilirse son değişenler (o-18) izlenir. Dinleyici sırası: bu bağlayıcı,
 *   panel modelini yenileyen depo dinleyicisinden ÖNCE kurulmalıdır (yeni kayıt aynı toplu bildirimde modele girsin).
 * @param {(kimlik: string) => string|undefined} [bag.adAl] kullanıcının verdiği ad (favori etiketi); son değişenler listesinde kullanılır
 * @param {() => Promise<object>} [bag.alanlarAl] HA alan (oda) kaydı (haOkuma.alanlar); verilmezse oda gruplaması/"odayı kapat" kapalıdır
 * @param {() => string} [bag.dilAl] arayüz dili (oda adlarının sıralaması)
 * @param {(yol: string) => Promise<unknown>} [bag.haIstek] korumalı HA okuma yolu (yalnız GET /api/states); verilmezse "diğer cihazlar" (o-46) kapalıdır
 * @param {(kayit: {kimlik: string, ad: string, alan: string}) => object|Promise<object>} [bag.favoriEkle] ana sürecin favori ekleme işlevi ("Favoriye ekle" menü satırı)
 */
function eylemEkleriOlustur({ eylem, ayarlarAl, dosyalar, fs, gunluk = () => {}, simdi = () => Date.now(), zaman, bildir = () => {}, t = TR, degisti = () => {}, saatMetni, depo, adAl, alanlarAl, dilAl, haIstek, favoriEkle }) {
  const etkinlik = etkinlikGecmisiOlustur({
    dosyaYolu: dosyalar.etkinlik,
    fs,
    gunluk,
    simdi,
    ...(zaman ? { zaman } : {}),
    acikMi: () => ayarlarAl()?.etkinlikGecmisi !== false,
  });

  // o-17: her eylem sonucu (panel, palet, tepsi, kısayol, komut satırı, masaüstü, gecikmeli...) etkinlik geçmişine yazılır
  const izleyiciyiKaldir = eylem.sonucDinle((bilgi) => {
    const kayit = eylemKaydi(bilgi);
    if (kayit) etkinlik.ekle(kayit);
  });

  // o-12: geri al (yığın, sahne ön okuması, süre dolumu)
  const geriAl = geriAlBaglayiciOlustur({ eylem, ayarlarAl, bildir, t, degisti, simdi, ...(zaman ? { zaman } : {}), gunluk });

  // o-18: son değişenler (palet "@"): izlenen varlıkların aç/kapat geçişleri, yalnız bellekte
  const sonDegisenler = depo ? sonDegisenlerOlustur({ depo, ayarlarAl, simdi, ...(adAl ? { adAl } : {}) }) : null;

  // o-14: odaya göre gruplama ve "odayı kapat" (HA alan kaydı arka planda okunur; yalnız bellekte)
  const oda = depo && alanlarAl ? odaBaglayiciOlustur({ eylem, ayarlarAl, durumAl: (kimlik) => depo.al(kimlik), alanlarAl, bildir, t, degisti, simdi, gunluk, ...(dilAl ? { dilAl } : {}) }) : null;

  // o-46: palette "*" ile favori olmayan güvenli cihazlar (varsayılan KAPALI; liste tek okuma isteğiyle, 2 dk bellekte)
  const diger = typeof haIstek === 'function' ? digerCihazlarOlustur({ eylem, ayarlarAl, haIstek, favoriEkle, ...(alanlarAl ? { alanlarAl } : {}), simdi, gunluk }) : null;

  // o-15: gecikmeli eylem (bekleyen liste, zamanlayıcı, iptal); favori dışı kimlik yalnız "diğer cihazlar" listesindeyse kabul edilir
  const gecikmeli = gecikmeliEylemOlustur({ eylem, ayarlarAl, bildir, t, degisti, simdi, ...(zaman ? { zaman } : {}), gunluk, ...(saatMetni ? { saatMetni } : {}), kaydet: (k) => etkinlik.ekle(k), digerMi: (kimlik) => (diger ? diger.listedeMi(kimlik) : false) });

  return {
    etkinlik,
    /** Açılışta: kayıtlı dosyalar okunur. */
    yukle() {
      etkinlik.yukle();
    },
    /** Çıkışta: bekleyen yazmalar yapılır, izleyiciler bırakılır. */
    kapat() {
      izleyiciyiKaldir();
      gecikmeli.kapat(); // bekleyen gecikmeli eylemlerin hepsi iptal olur
      if (sonDegisenler) sonDegisenler.kapat();
      if (diger) diger.kapat();
      geriAl.kapat();
      etkinlik.bosalt();
    },

    // --- Geri al (o-12): panel düğmesi (yuzey:geri-al), Ctrl+Alt+Z ve tepsi menüsü bunu çağırır ---
    geriAl: (kaynak) => geriAl.geriAl(kaynak),
    /** Ayarlar'da geriAl / geriAlSureDk değişti. */
    geriAlAyarDegisti: () => geriAl.ayarDegisti(),
    /** Panel modelinin "eylem" bölümü (src/lib/eylem-modeli.js rendererEylem beyaz listeden geçirir). */
    modelBolumu() {
      return { geriAl: geriAl.ozet(), gecikmeli: gecikmeli.ozet(), degisenler: sonDegisenler ? sonDegisenler.ozet() : [], degisenAcik: sonDegisenler !== null && ayarlarAl()?.sonDegisenler !== false };
    },

    // --- Odaya göre gruplama ve "odayı kapat" (o-14): panel modeli (main.js yuzeyModeli) ve yuzey:oda-kapat bunları çağırır ---
    /** Panel modelinin gruplarını ayar `panelGruplama: 'oda'` iken oda gruplarına çevirir (oda kaydı bilinmiyorsa aynen döner). */
    odaGruplari: (gruplar) => (oda ? oda.gruplar(gruplar) : gruplar),
    odaKapat: (kaynak, kod) => (oda ? oda.kapat({ kaynak, kod }) : Promise.resolve({ ok: false, tur: 'kapali' })),
    /** Ayarlar'da panelGruplama değişti. */
    odaAyarDegisti() {
      if (oda) oda.ayarDegisti();
      else degisti();
    },

    // --- Palette favori olmayan güvenli cihazlar (o-46): yuzey:diger-* kanalları bunları çağırır (yalnız palet) ---
    digerListe: (kaynak) => (diger ? diger.liste({ kaynak }) : Promise.resolve({ ok: false, tur: 'kapali' })),
    digerCalistir: (kaynak, yuk) => (diger ? diger.calistir({ kaynak, kimlik: yuk?.kimlik, islem: yuk?.islem }) : Promise.resolve({ ok: false, tur: 'kapali' })),
    digerFavoriEkle: (kaynak, kimlik) => (diger ? diger.favoriyeEkle({ kaynak, kimlik }) : Promise.resolve({ ok: false, tur: 'kapali' })),
    /** Ayarlar'da paletDigerCihazlar değişti: kapanınca liste silinir ve favori olmayan cihazların bekleyen gecikmeli eylemleri iptal olur. */
    digerAyarDegisti() {
      if (diger) diger.ayarDegisti();
      gecikmeli.digerAyarDegisti();
    },

    // --- Son değişenler (o-18) ---
    /** Ayarlar'da sonDegisenler değişti: kapanınca liste silinir, açılınca temel çizgi şimdiki durumdan kurulur. */
    sonDegisenlerAyarDegisti() {
      if (sonDegisenler) sonDegisenler.ayarDegisti();
      degisti();
    },

    // --- Gecikmeli eylem (o-15): palet satırı (yuzey:geciktir), panel şeridi (yuzey:gecikmeli-iptal) ve tepsi menüsü bunları çağırır ---
    gecikmeliPlanla: (kaynak, yuk) => gecikmeli.planla({ ...yuk, kaynak }),
    gecikmeliIptal: (id, kaynak) => gecikmeli.iptal(id, kaynak),
    gecikmeliHepsiniIptal: () => gecikmeli.hepsiniIptal({ kaynak: 'tepsi-menu' }),
    /** Ayarlar'da gecikmeliEylem değişti. */
    gecikmeliAyarDegisti: () => gecikmeli.ayarDegisti(),

    // --- Ayarlar > Etkinlik geçmişi (ayarlar:* IPC; gönderen denetimini main.js yapar) ---
    etkinlikListesi() {
      return { ok: true, acik: ayarlarAl()?.etkinlikGecmisi !== false, kayitlar: etkinlik.liste() };
    },
    etkinlikTemizle() {
      etkinlik.temizle();
      return { ok: true };
    },
  };
}

module.exports = { GECMISE_YAZILMAYAN_HATALAR, eylemKaydi, eylemEkleriOlustur };
