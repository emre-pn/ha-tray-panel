'use strict';

/**
 * "Home Assistant koptu / geri geldi" bildirimi (o-38; saf — zamanlayıcı ve bildirim işlevleri dışarıdan verilir).
 *
 * Canlı bağlantının (ha-ws.js durumDegisti) durumunu izler. Bildirim iki kuralla sessiz tutulur:
 *  - KISA KESİNTİ: bağlantı en az `gecikmeSn` saniye kesintisiz kopuk kalmadıkça "koptu" bildirimi gelmez; bu süre dolmadan
 *    geri gelirse hiçbir şey gösterilmez (HA yeniden başlatması, Wi-Fi sallantısı...).
 *  - "geri geldi" bildirimi YALNIZ "koptu" bildirimi gösterildiyse gelir (sessiz kesinti sessiz kapanır).
 * Kesinti SAYILMAYAN durumlar: uyku/askıya alma ('askida'), canlı bağlantının ayardan kapatılması, anahtar yokluğu ya da reddi
 * ('yetki' ve benzeri yetki sorunları kendi bildirimlerini zaten üretir), abonelik/izlenen varlık yokluğu gibi yapılandırma
 * durumları. Açılışta hiç canlı olunmadıysa (ilk bağlantı kurulamadıysa) "koptu" bildirimi gelmez: kopan bir şey yoktu.
 * Bildirim metinleri ve gösterimi çağırana aittir; bu modül yalnız ne zaman bildirileceğine karar verir. Dışarıya hiçbir şey göndermez.
 */

const GECIKME_SINIRI = Object.freeze({ en_az: 15, en_cok: 600, varsayilan: 60 });

/** ha-ws.js'in "bağlantı koptu" nedenleri: bu nedenlerle 'baglaniyor' / 'yedek' durumu gerçek bir kesintidir. */
const KESINTI_NEDENLERI = Object.freeze([
  'kapandi',
  'pong-yok',
  'zaman-asimi',
  'gonderilemedi',
  'durumlar-hatasi',
  'olusturulamadi',
  'adres-yok',
  'duraklatildi',
  'dogrulama',
  'auth-gonderilemedi',
  'anahtar-yenilenemedi', // tarayıcı oturumu anahtarı şimdi yenilenemedi (ağ ya da HA geçici sorunu); HA kapalıyken uzun kesintide hep bu neden görülür
]);

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    simdi: () => Date.now(),
  };
}

/** Geçersiz süre varsayılana düşer; sınırlar içinde tam sayıya yuvarlanır. */
function gecikmeSn(ham) {
  const n = typeof ham === 'number' ? ham : typeof ham === 'string' && ham.trim() !== '' ? Number(ham) : NaN;
  if (!Number.isFinite(n)) return GECIKME_SINIRI.varsayilan;
  return Math.min(GECIKME_SINIRI.en_cok, Math.max(GECIKME_SINIRI.en_az, Math.round(n)));
}

/** Bu durum gerçek bir bağlantı kesintisi mi? ({ baglanti, canli, neden } — ha-ws.js durumDegisti) */
function kesintiMi(d) {
  if (!d || typeof d !== 'object' || d.canli === true) return false;
  if (d.baglanti !== 'baglaniyor' && d.baglanti !== 'yedek') return false;
  return KESINTI_NEDENLERI.includes(d.neden);
}

/**
 * @param {object} bag
 * @param {(bilgi: {sureSn: number}) => void} bag.koptu "koptu" bildirimini gösterir (kesinti `gecikmeSn`i aştığında, hâlâ kopukken)
 * @param {(bilgi: {sureSn: number}) => void} bag.geldi "geri geldi" bildirimini gösterir (yalnız "koptu" gösterildiyse)
 * @param {() => boolean} [bag.etkinMi] ayardaki baglantiBildirimi (kapalıysa hiçbir şey gösterilmez)
 * @param {() => number} [bag.gecikmeSnAl] ayardaki baglantiBildirimSn
 * @param {{setTimeout: Function, clearTimeout: Function, simdi: () => number}} [bag.zaman]
 */
function baglantiBildirimiOlustur({ koptu, geldi, etkinMi = () => true, gecikmeSnAl = () => GECIKME_SINIRI.varsayilan, zaman = varsayilanZaman() }) {
  let canliydi = false; // en az bir kez canlı olundu (kopan bir bağlantı var)
  let kesintiBasi = null; // sürmekte olan kesintinin başlangıcı (ms)
  let bildirildi = false; // "koptu" gösterildi, "geri geldi" bekleniyor
  let zamanlayici = null;

  function zamanlayiciyiTemizle() {
    if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
    zamanlayici = null;
  }

  function guvenliCagir(fn, bilgi) {
    try {
      fn(bilgi);
    } catch {
      /* bildirim hatası bağlantı izlemesini bozmasın */
    }
  }

  function sureDoldu() {
    zamanlayici = null;
    if (kesintiBasi === null || bildirildi) return;
    let acik = false;
    try {
      acik = etkinMi() === true;
    } catch {
      acik = false;
    }
    if (!acik) return;
    bildirildi = true;
    guvenliCagir(koptu, { sureSn: Math.max(0, Math.round((zaman.simdi() - kesintiBasi) / 1000)) });
  }

  return {
    /** ha-ws.js durumDegisti çağrısı. */
    durum(d) {
      if (!d || typeof d !== 'object') return;
      if (d.canli === true) {
        zamanlayiciyiTemizle();
        const sureSn = kesintiBasi === null ? 0 : Math.max(0, Math.round((zaman.simdi() - kesintiBasi) / 1000));
        const bildirilmisti = bildirildi;
        canliydi = true;
        kesintiBasi = null;
        bildirildi = false;
        if (bildirilmisti) {
          let acik = false;
          try {
            acik = etkinMi() === true;
          } catch {
            acik = false;
          }
          if (acik) guvenliCagir(geldi, { sureSn });
        }
        return;
      }
      if (kesintiMi(d)) {
        if (!canliydi || kesintiBasi !== null) return; // hiç canlı olunmadı: kopan yok; kesinti zaten izleniyor
        kesintiBasi = zaman.simdi();
        zamanlayiciyiTemizle();
        zamanlayici = zaman.setTimeout(sureDoldu, gecikmeSn(gecikmeSnAl()) * 1000);
        return;
      }
      // Yeniden bağlanma denemesi (ha-ws.js baglan(): 'baglaniyor', neden yok) kesintinin ortasında da görülür: ne başlatır ne bitirir.
      if (d.baglanti === 'baglaniyor' && (d.neden === null || d.neden === undefined)) return;
      // Kesinti olmayan, canlı da olmayan durum
      zamanlayiciyiTemizle();
      kesintiBasi = null;
      if (d.neden === 'askida') return; // uyku: kesinti sayılmaz ama gösterilmiş "koptu" için "geri geldi" korunur
      bildirildi = false; // canlı bağlantı kapatıldı / anahtar yok ya da reddedildi / yapılandırma durumu
      if (d.baglanti === 'kapali' && d.neden === 'anahtar-yok') canliydi = false;
    },
    /**
     * Ayar değişti (bildirim açıldı/kapatıldı ya da süre değişti): süren kesinti için zamanlayıcı kalan süreyle yeniden kurulur; kapalıyken
     * dolan zamanlayıcı da (kesinti sürüyorsa) yeniden kurulur, böylece kesinti sırasında açılan ayar "koptu" ve "geri geldi"yi getirir.
     * Kapalıysa süre dolunca sureDoldu sessizce biter.
     */
    ayarDegisti() {
      if (kesintiBasi === null || bildirildi) return;
      zamanlayiciyiTemizle();
      const gecen = zaman.simdi() - kesintiBasi;
      const kalan = Math.max(0, gecikmeSn(gecikmeSnAl()) * 1000 - gecen);
      zamanlayici = zaman.setTimeout(sureDoldu, kalan);
    },
    /** Uygulama çıkıyor ya da bağlantı sıfırlandı. */
    sifirla() {
      zamanlayiciyiTemizle();
      canliydi = false;
      kesintiBasi = null;
      bildirildi = false;
    },
    durumBilgisi: () => ({ canliydi, kesintiBasi, bildirildi, bekliyor: zamanlayici !== null }),
  };
}

module.exports = { GECIKME_SINIRI, KESINTI_NEDENLERI, gecikmeSn, kesintiMi, baglantiBildirimiOlustur };
