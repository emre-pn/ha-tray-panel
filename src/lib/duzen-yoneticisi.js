'use strict';

/**
 * Düzen yöneticisi (ana süreç; Electron'a bağımlı DEĞİL) — 1.4.0 düzen grubu (o-16, o-24, o-28, o-30).
 *
 * Panelde karoya sağ tık menüsü, düzen geçmişi (son 20 anlık görüntü), "Düzeni geri al" ve kullanılamayan favoriyi onarma işlemlerini
 * yürütür. Electron'a ait her şey (Menu.popup, dialog, pencere) bağımlılık olarak verilir; böylece sahte bağımlılıklarla sınanır.
 *
 * Güvenlik ilkeleri
 *  - Hiçbir işlem Home Assistant'a istek göndermez ve yeni bir eylem yolu açmaz: yalnız ayardaki favoriler / sayfalar değişir.
 *  - Menü yalnız karo.favori olan kimlik için açılır; öğeler src/lib/karo-menusu.js planıyla sınırlıdır (düzenle, tepsi, sayfa, kaldır).
 *  - Kaldırma önce yerel onay penceresi ister (ana sürecin kendi diyaloğu); 800 ms basılı tutma onayı (yıkıcı eylemler) panelde değişmez.
 *  - Geri yüklenen düzen ayar şemasından yeniden geçer (duzen.js duzeniDogrula): geçmiş dosyası elle bozulsa da kapı / kilit favorisi giremez.
 *  - Onarımda yeni varlık yalnız ana sürecin güvenli cihaz listesinden (cihazAl) seçilebilir; ad HA'dan değil o listeden gelir.
 */

const { karoMenuPlani, karoMenuIslemi } = require('./karo-menusu');
const { favoriyiOnar, duzeniDogrula } = require('./duzen');
const { sayfalariBuda } = require('./sayfalar');
const { onayiDuzelt } = require('./favoriler');

/** Bir "Kaydet" birkaç ardışık değişiklik üretebilir (favoriler + sayfalar ayrı kanallardan gelir): bu sürede tek nokta tutulur. */
const BIRLESTIR_MS = 2500;
const esit = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const kopya = (d) => structuredClone(d);

/**
 * @param {object} bag
 * @param {() => object} bag.ayarlarAl canlı ayar nesnesi (favoriler, sayfalar)
 * @param {() => boolean} bag.yaz ayarları diske yazar; başarıda true
 * @param {object} bag.gecmis src/lib/duzen-gecmisi.js duzenGecmisiOlustur sonucu
 * @param {(kimlik: string) => ({id: string, sinif?: string}|undefined)} bag.karoAl modeldeki (kapı kuralından geçmiş) karo
 * @param {(sablon: object[], pencere?: object) => Promise<void>} bag.menuAc Menu.popup; menü kapanınca çözülür
 * @param {(ad: string) => Promise<boolean>} bag.onayIste "favorilerden kaldırılsın mı" yerel diyaloğu
 * @param {(kimlik: string) => void} bag.duzenleAc Ayarlar'ı açar ve favoriye götürür
 * @param {(secenek?: {yalnizModel?: boolean, ayarlardan?: boolean}) => void} bag.degisti favori / sayfa listesi değişti: panel tazelenir;
 *   yalnizModel: kimlikler değişmedi, yalnız panel modeli tazelensin (izlenenler / kısayollar yeniden kurulmaz); ayarlardan: değişikliği
 *   Ayarlar penceresi kendisi yaptı, o pencereye "liste değişti" bildirimi gitmesin
 * @param {() => ({guvenli: Map<string, string>, tumKimlikler: Set<string>}|null)} [bag.cihazAl] son cihaz listesi önbelleği (onarım için)
 * @param {() => string[]} [bag.masaustuAl] masaüstüne sabitli karo kimlikleri (verilmezse menüde sabitleme öğesi yoktur)
 * @param {(liste: string[]) => boolean} [bag.masaustuKaydet] sabitli kimlik listesini yazar ve masaüstü karolarını eşitler; başarıda true
 * @param {(metin: string) => string} [bag.menuMetni] menü etiketi kaçışı (Windows "&")
 * @param {Function} bag.t çevirmen
 * @param {(m: string) => void} [bag.gunluk]
 * @param {(metin: string) => void} [bag.hataBildir] kullanıcıya kısa hata bildirimi
 * @param {(f: Function) => Promise<void>} [bag.sonraki] bir olay döngüsü turu bekler (testte sabitlenebilir)
 */
function duzenYoneticisiOlustur({
  ayarlarAl,
  yaz,
  gecmis,
  karoAl,
  menuAc,
  onayIste,
  duzenleAc,
  degisti,
  cihazAl = () => null,
  masaustuAl = undefined,
  masaustuKaydet = () => false,
  menuMetni = (s) => s,
  t,
  gunluk = () => {},
  hataBildir = () => {},
  sonraki = () => new Promise((coz) => setImmediate(coz)),
}) {
  /** Şimdiki düzenin derin kopyası (geçmiş noktası için DEĞİŞİKLİKTEN ÖNCE alınır). */
  function anlik() {
    const a = ayarlarAl();
    return { favoriler: kopya(a.favoriler ?? []), sayfalar: kopya(a.sayfalar ?? []) };
  }

  /** Favori olmayan varlıkları sayfalardan atar; değiştiyse true. Diske YAZMAZ (çağıran yazar). */
  function sayfalariBudaSimdi() {
    const a = ayarlarAl();
    const onceki = a.sayfalar ?? [];
    const yeni = sayfalariBuda(onceki, new Set((a.favoriler ?? []).map((f) => f.entity_id)));
    if (esit(onceki, yeni)) return false;
    a.sayfalar = yeni;
    return true;
  }

  /**
   * Bir değişiklikten SONRA çağrılır: sayfalar budanır, düzen değiştiyse `onceki` geçmişe yazılır. Diske yazmaz.
   * @param {{favoriler: object[], sayfalar: object[]}} onceki değişiklikten önceki anlik()
   * @param {string} neden duzen-gecmisi.js NEDENLER'den biri
   * @param {{birlestir?: boolean}} [secenek] birlestir: ardışık değişiklikler tek nokta olsun
   * @returns {{degisti: boolean, budandi: boolean}}
   */
  function degisimiIsle(onceki, neden, { birlestir = false } = {}) {
    const budandi = sayfalariBudaSimdi();
    const degistiMi = !esit(onceki, anlik());
    if (degistiMi) gecmis.kaydet(onceki, neden, { birlestirMs: birlestir ? BIRLESTIR_MS : 0 });
    return { degisti: degistiMi, budandi };
  }

  /**
   * ekAyarDinle('sayfalar', ...) dinleyicisi: Ayarlar'dan sayfalar değişti (kayıt zaten yazıldı). Sayfalar BURADA budanmaz: Ayarlar önce
   * genel ayarları, sonra favorileri kaydeder; yeni eklenen favori sayfada listelenmişken henüz favori olmayabilir. Budama favori
   * kaydında (degisimiIsle) yapılır; o ana dek modelde karosu olmayan kimlikler panele zaten girmez (sayfalariModele).
   */
  function sayfalarDegisti(_yeni, eski) {
    const a = ayarlarAl();
    gecmis.kaydet({ favoriler: kopya(a.favoriler ?? []), sayfalar: Array.isArray(eski) ? eski : [] }, 'sayfalar', { birlestirMs: BIRLESTIR_MS });
    degisti({ yalnizModel: true, ayarlardan: true });
  }

  /** Geçmişe şimdiki düzeni DEĞİŞİKLİKTEN ÖNCE bir nokta olarak yazar (içe aktarma gibi birden çok adımlı işlemler için). */
  function noktaAl(neden) {
    return gecmis.kaydet(anlik(), neden);
  }

  const sayfaBilgisi = () => (ayarlarAl().sayfalar ?? []).map((s) => ({ id: s.id, ad: s.ad, varliklar: s.varliklar }));

  const masaustuListesi = () => (typeof masaustuAl === 'function' ? masaustuAl() : undefined);

  /** Menü işlemini uygular (kaldırmada önce onay istenir). */
  async function islemUygula(islem, kimlik) {
    const a = ayarlarAl();
    const ilk = karoMenuIslemi({ islem, kimlik, favoriler: a.favoriler, sayfalar: a.sayfalar ?? [], masaustu: masaustuListesi() });
    if (ilk.tur === 'yok') return false;
    if (ilk.tur === 'duzenle') {
      duzenleAc(kimlik);
      return true;
    }
    if (ilk.tur === 'masaustu') {
      // Masaüstüne sabitleme favori / sayfa düzenini değiştirmez: düzen geçmişine girmez, yalnız `masaustuKarolari` ayarı yazılır.
      if (!masaustuKaydet(ilk.liste)) hataBildir(t('bildirim.ayarYazilamadi'));
      degisti({ yalnizModel: true }); // açık Ayarlar eski listeyle kaydedip sabitlemeyi geri almasın
      return true;
    }
    if (ilk.neden === 'menu-kaldir') {
      const favori = a.favoriler.find((f) => f.entity_id === kimlik);
      if (!(await onayIste(favori?.etiket || favori?.ad || kimlik))) return false;
    }
    // Onay beklerken ayar değişmiş olabilir: sonuç en güncel durumdan yeniden hesaplanır.
    const sonuc = karoMenuIslemi({ islem, kimlik, favoriler: a.favoriler, sayfalar: a.sayfalar ?? [] });
    if (sonuc.tur !== 'degisti') return false;
    const onceki = anlik();
    a.favoriler = onayiDuzelt(sonuc.favoriler);
    a.sayfalar = sonuc.sayfalar;
    degisimiIsle(onceki, sonuc.neden);
    if (!yaz()) hataBildir(t('bildirim.ayarYazilamadi'));
    degisti({ yalnizModel: sonuc.neden !== 'menu-kaldir' });
    return true;
  }

  /**
   * Karo bağlam menüsü (sağ tık). Menü kapanana ve seçilen işlem bitene kadar çözülmez (panel o sürece odak kaybıyla gizlenmez).
   * @returns {Promise<{ok: boolean}>}
   */
  async function karoMenusuAc(kimlik, pencere) {
    const a = ayarlarAl();
    const favori = typeof kimlik === 'string' ? a.favoriler.find((f) => f.entity_id === kimlik) : undefined;
    const karo = favori ? karoAl(kimlik) : undefined;
    if (!favori || !karo) return { ok: false };
    const plan = karoMenuPlani({ karo, favori, sayfalar: sayfaBilgisi(), masaustu: masaustuListesi(), t });
    let secilen = null;
    const sec = (islem) => () => {
      secilen = islem;
    };
    const sablon = plan.map((oge) => {
      if (oge.tur === 'ayirac') return { type: 'separator' };
      if (Array.isArray(oge.alt)) {
        return {
          label: menuMetni(oge.label),
          submenu: oge.alt.map((alt) => ({ label: menuMetni(alt.label), type: 'checkbox', checked: alt.checked === true, click: sec(alt.id) })),
        };
      }
      return { label: menuMetni(oge.label), click: sec(oge.id) };
    });
    try {
      await menuAc(sablon, pencere);
      await sonraki(); // seçim ile kapanış geri çağrısının sırası platforma göre değişebilir
      if (secilen) await islemUygula(secilen, kimlik);
    } catch {
      gunluk('Karo menüsü işlemi tamamlanamadı.');
      return { ok: false };
    }
    return { ok: true };
  }

  /** Ayarlar > Düzen geçmişi listesi (kimlik / ad YOK: yalnız zaman, neden, sayılar). */
  function gecmisListesi() {
    return { ok: true, noktalar: gecmis.liste() };
  }

  /**
   * Geçmiş noktasına döner. Dönmeden önceki düzen yeni bir nokta olarak saklanır (dönüş de geri alınabilir).
   * @returns {{ok: true, favoriSayisi: number, sayfaSayisi: number, atilan: number} | {ok: false, hata: string}}
   */
  function geriDon(id) {
    const nokta = Number.isInteger(id) ? gecmis.al(id) : null;
    if (!nokta) return { ok: false, hata: t('duzen.hata.noktaYok') };
    const dogru = duzeniDogrula(nokta);
    const a = ayarlarAl();
    const onceki = anlik();
    a.favoriler = dogru.favoriler;
    a.sayfalar = dogru.sayfalar;
    degisimiIsle(onceki, 'don');
    const yazildi = yaz();
    degisti({ ayarlardan: true });
    if (!yazildi) return { ok: false, hata: t('bildirim.ayarYazilamadi') };
    return { ok: true, favoriSayisi: a.favoriler.length, sayfaSayisi: a.sayfalar.length, atilan: dogru.atilanlar.length };
  }

  /**
   * HA'da bulunamayan favoriyi seçilen cihaza bağlar (o-28). Yeni varlık ana sürecin güvenli cihaz listesinde olmalıdır;
   * eski varlık şu an HA'da BULUNMAMALIDIR (çalışan bir karo onarılmaz).
   * @returns {{ok: true, favoriSayisi: number} | {ok: false, neden: string, hata: string}}
   */
  function onar(eski, yeni) {
    const hata = (neden) => ({ ok: false, neden, hata: t(`duzen.hata.${neden}`) });
    const cihazlar = cihazAl();
    if (!cihazlar) return hata('cihazlar');
    if (typeof eski !== 'string' || typeof yeni !== 'string') return hata('gecersiz');
    if (cihazlar.tumKimlikler.has(eski)) return hata('bulunuyor');
    const yeniAd = cihazlar.guvenli.get(yeni);
    if (yeniAd === undefined) return hata('guvenlik');
    const a = ayarlarAl();
    const sonuc = favoriyiOnar({ favoriler: a.favoriler, sayfalar: a.sayfalar ?? [], eski, yeni, yeniAd });
    if (!sonuc.ok) return hata(sonuc.neden);
    const onceki = anlik();
    a.favoriler = onayiDuzelt(sonuc.favoriler);
    a.sayfalar = sonuc.sayfalar;
    degisimiIsle(onceki, 'onar');
    const yazildi = yaz();
    degisti({ ayarlardan: true });
    if (!yazildi) return { ok: false, neden: 'yazilamadi', hata: t('bildirim.ayarYazilamadi') };
    return { ok: true, favoriSayisi: a.favoriler.length };
  }

  return { anlik, noktaAl, degisimiIsle, sayfalarDegisti, karoMenusuAc, islemUygula, gecmisListesi, geriDon, onar };
}

module.exports = { BIRLESTIR_MS, duzenYoneticisiOlustur };
