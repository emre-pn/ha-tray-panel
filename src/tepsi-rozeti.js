'use strict';

/**
 * Tepsi simgesi rozeti (o-27, 1.4.0) — ana süreç yapıştırıcısı. Çizim ve karar saftır (src/lib/tepsi-simgesi.js); burası ayarı okur,
 * hangi simgenin gerektiğini bulur ve Tray.setImage'e yazar. Electron nesneleri (nativeImage, screen, Tray) dışarıdan verilir.
 *
 * Kurallar
 *  - Rozet yalnız ayar `tepsiRozeti` 'isik' (favori ışıklardan açık olanların sayısı) ya da 'sensor' (seçilen sensörün kısa değeri)
 *    iken çizilir; varsayılan 'kapali' iken simge eskisi gibi assets/ikon.ico / ikon-soluk.ico DOSYASIDIR (hiçbir şey değişmez).
 *  - Bağlantı yokken (soluk simge) rozet ÇİZİLMEZ: sayılar güvenilir değildir; soluk simge mantığıyla çakışmaz.
 *  - Sensör rozeti Kapı Kuralı'ndan geçer (src/lib/tepsi-simgesi.js sensorRozeti: yalnız 'sensor' alanı, sayısal durum, süzgeç).
 *    Sensörün adı/değeri günlüğe yazılmaz.
 *  - Simge en çok saniyede bir değişir (tepsiSimgeDenetleyicisi); bağlantı durumu değişimi (soluk <-> normal) beklemez.
 *  - Rozetli simge, sistem tepsi simgesi boyutunda (16 * ölçek) tek bir 1x PNG'dir; DPI'a göre doğru görünüp görünmediği
 *    gerçek Windows'ta DENENMEDİ (README elle deneme listesi). Oluşturulamazsa dosya simgesine düşülür.
 */

const { rozetBelirle, sensorIpucuEki, simgePng, simgeAnahtari, tepsiSimgeBoyutu, tepsiSimgeDenetleyicisi } = require('./lib/tepsi-simgesi');
const { birincilOlcekAl } = require('./lib/ekran-ozeti');

const ROZET_MODLARI = Object.freeze(['kapali', 'isik', 'sensor']);

/**
 * @param {object} g
 * @param {{createFromBuffer: Function}} g.nativeImage
 * @param {object} g.screen
 * @param {() => (object|null)} g.tepsiAl Tray nesnesi (yoksa/yok edilmişse null)
 * @param {() => object} g.ayarlarAl
 * @param {(kimlik: string) => (object|null|undefined)} g.durumAl depodaki varlık durumu
 * @param {() => (number|null)} g.acikIsikAl favori ışıklardan açık olanların sayısı
 * @param {() => boolean} g.solukAl bağlantı yok (soluk simge) mu?
 * @param {string} g.normalIkon assets/ikon.ico yolu
 * @param {string} g.solukIkon assets/ikon-soluk.ico yolu
 * @param {(m: string) => void} [g.gunluk]
 * @param {() => number} [g.simdi]
 * @param {object} [g.zaman] { setTimeout, clearTimeout }
 * @param {number} [g.aralikMs]
 */
function tepsiRozetiOlustur({ nativeImage, screen, tepsiAl, ayarlarAl, durumAl, acikIsikAl, solukAl, normalIkon, solukIkon, gunluk = () => {}, simdi, zaman, aralikMs }) {
  let sonSoluk = null;
  let rozetHatasiBildirildi = false;

  const mod = () => {
    const m = ayarlarAl()?.tepsiRozeti;
    return ROZET_MODLARI.includes(m) ? m : 'kapali';
  };
  const sensorKimligi = () => {
    const k = ayarlarAl()?.tepsiRozetSensoru;
    return typeof k === 'string' && k !== '' ? k : null;
  };

  /** Rozetli simgeyi yazar; oluşturulamazsa dosya simgesine düşer (simge kaybolmaz). */
  function uygula(durum) {
    const tepsi = tepsiAl();
    if (!tepsi) return;
    if (durum.rozet) {
      try {
        const imge = nativeImage.createFromBuffer(simgePng({ boyut: durum.boyut, soluk: false, rozet: durum.rozet }), { scaleFactor: 1 });
        if (imge && (typeof imge.isEmpty !== 'function' || !imge.isEmpty())) {
          tepsi.setImage(imge);
          return;
        }
      } catch {
        /* aşağıda dosya simgesine düşülür */
      }
      if (!rozetHatasiBildirildi) {
        rozetHatasiBildirildi = true;
        gunluk('Tepsi rozeti çizilemedi; dosya simgesi kullanılıyor.');
      }
    }
    tepsi.setImage(durum.soluk ? solukIkon : normalIkon);
  }

  const denetleyici = tepsiSimgeDenetleyicisi({ uygula, simdi, zaman, aralikMs });

  /** Şu an istenen simge durumu (saf okuma). */
  function istenen() {
    const soluk = solukAl() === true;
    const rozet = soluk
      ? null
      : rozetBelirle({
          mod: mod(),
          acikIsik: acikIsikAl(),
          sensorVarligi: mod() === 'sensor' && sensorKimligi() ? durumAl(sensorKimligi()) : null,
        });
    const boyut = tepsiSimgeBoyutu(birincilOlcekAl(screen));
    const anahtar = rozet ? simgeAnahtari({ boyut, soluk: false, rozet }) : soluk ? 'dosya|soluk' : 'dosya|normal';
    return { soluk, rozet, boyut, anahtar };
  }

  return {
    /** Tray ilk dosya simgesiyle oluşturuldu: bu durum "uygulanmış" sayılır (rozet ilk güncellemede gelir). */
    baslangic() {
      const d = istenen();
      sonSoluk = d.soluk;
      denetleyici.baslangic(d.soluk ? 'dosya|soluk' : 'dosya|normal');
    },
    /** Bağlantı, ışık sayısı, sensör değeri ya da ayar değişince çağrılır; değişmeyen simge yeniden yazılmaz, sık değişim saniyede 1'e iner. */
    guncelle() {
      if (!tepsiAl()) return;
      const d = istenen();
      const hizli = sonSoluk !== null && d.soluk !== sonSoluk; // bağlantı durumu değişimi beklemez
      sonSoluk = d.soluk;
      denetleyici.iste({ anahtar: d.anahtar, hizli, soluk: d.soluk, rozet: d.rozet, boyut: d.boyut });
    },
    /** 'sensor' modunda seçili sensörün tepsi ipucu eki ("Salon sıcaklığı: 21,5 °C"); rozet yoksa null. */
    ipucuEki() {
      if (mod() !== 'sensor' || !sensorKimligi() || solukAl() === true) return null;
      return sensorIpucuEki(durumAl(sensorKimligi()));
    },
    /** Canlı abonelik/REST yenilemesine eklenecek kimlik ('sensor' modunda seçili sensör) ya da null. */
    izlenenKimlik() {
      return mod() === 'sensor' ? sensorKimligi() : null;
    },
    temizle: () => denetleyici.temizle(),
    uygulanan: () => denetleyici.uygulanan(),
  };
}

module.exports = { ROZET_MODLARI, tepsiRozetiOlustur };
