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
 *  - Birden çok sensör (1.4.0): `tepsiRozetSensoru` + `tepsiRozetSensorleri` (en çok 2 ek) en çok 3 sensör eder. Rozeti çizilebilen (sayısal, süzgeçten
 *    geçen) sensörler SIRAYLA, DONUS_MS'de bir gösterilir; rozeti olmayan sensör atlanır, tek geçerli sensör varsa dönüş yoktur. Dönüş yalnız bağlantı
 *    varken ve 'sensor' modunda döner; zamanlayıcı başka hiçbir şey yapmaz (ağ isteği yok). Tepsi ipucuna geçerli sensörlerin hepsi eklenir.
 *  - Simge en çok saniyede bir değişir (tepsiSimgeDenetleyicisi); bağlantı durumu değişimi (soluk <-> normal) beklemez.
 *  - Rozetli simge, sistem tepsi simgesi boyutunda (16 * ölçek) tek bir 1x PNG'dir; DPI'a göre doğru görünüp görünmediği
 *    gerçek Windows'ta DENENMEDİ (README elle deneme listesi). Oluşturulamazsa dosya simgesine düşülür.
 */

const { rozetBelirle, sensorIpucuEki, simgePng, simgeAnahtari, tepsiSimgeBoyutu, tepsiSimgeDenetleyicisi } = require('./lib/tepsi-simgesi');
const { birincilOlcekAl } = require('./lib/ekran-ozeti');

const ROZET_MODLARI = Object.freeze(['kapali', 'isik', 'sensor']);
/** Rozette sırayla gösterilebilen en çok sensör (ana + ek). */
const EN_COK_ROZET_SENSORU = 3;
/** Birden çok geçerli sensör varken rozetin sensör değiştirme aralığı. */
const DONUS_MS = 5000;

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
 * @param {() => string} [g.dilAl] etkin arayüz dili (ipucundaki sensör değerinin ondalık ayracı için; varsayılan 'tr')
 * @param {() => number} [g.simdi]
 * @param {object} [g.zaman] { setTimeout, clearTimeout }
 * @param {number} [g.aralikMs]
 */
function tepsiRozetiOlustur({ nativeImage, screen, tepsiAl, ayarlarAl, durumAl, acikIsikAl, solukAl, normalIkon, solukIkon, gunluk = () => {}, dilAl = () => 'tr', simdi, zaman, aralikMs }) {
  let sonSoluk = null;
  let rozetHatasiBildirildi = false;
  let sira = 0; // dönüşte şu an gösterilen geçerli sensörün sırası (geçerli sensör sayısına göre döner)
  let donusZamanlayicisi = null;
  const zamanlayici = zaman ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };

  const dilOku = () => {
    try {
      return dilAl();
    } catch {
      return 'tr';
    }
  };
  const mod = () => {
    const m = ayarlarAl()?.tepsiRozeti;
    return ROZET_MODLARI.includes(m) ? m : 'kapali';
  };
  const sensorKimligi = () => {
    const k = ayarlarAl()?.tepsiRozetSensoru;
    return typeof k === 'string' && k !== '' ? k : null;
  };
  /** Ana sensör + ek sensörler: tekrarsız, boş olmayan, en çok EN_COK_ROZET_SENSORU kimlik (ana sensör önce). */
  const sensorKimlikleri = () => {
    const a = ayarlarAl();
    const liste = [];
    for (const k of [a?.tepsiRozetSensoru, ...(Array.isArray(a?.tepsiRozetSensorleri) ? a.tepsiRozetSensorleri : [])]) {
      if (typeof k === 'string' && k !== '' && !liste.includes(k) && liste.length < EN_COK_ROZET_SENSORU) liste.push(k);
    }
    return liste;
  };

  /** Rozeti çizilebilen sensörlerin rozetleri (kimlik sırasıyla). Kapı Kuralı rozetBelirle -> sensorRozeti içindedir. */
  function sensorRozetleri() {
    const sonuc = [];
    for (const kimlik of sensorKimlikleri()) {
      const rozet = rozetBelirle({ mod: 'sensor', sensorVarligi: durumAl(kimlik) });
      if (rozet) sonuc.push(rozet);
    }
    return sonuc;
  }

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
    let rozet = null;
    if (!soluk) {
      if (mod() === 'sensor') {
        const adaylar = sensorRozetleri();
        rozet = adaylar.length > 0 ? adaylar[sira % adaylar.length] : null;
      } else if (mod() === 'isik') {
        // açık ışık sayısı tüm favorilerden karo kurar: yalnız rozet 'isik' modundayken hesaplanır (varsayılan 'kapali' iken değil)
        rozet = rozetBelirle({ mod: 'isik', acikIsik: acikIsikAl(), sensorVarligi: null });
      }
    }
    const boyut = tepsiSimgeBoyutu(birincilOlcekAl(screen));
    const anahtar = rozet ? simgeAnahtari({ boyut, soluk: false, rozet }) : soluk ? 'dosya|soluk' : 'dosya|normal';
    return { soluk, rozet, boyut, anahtar };
  }

  function donusuDurdur() {
    if (donusZamanlayicisi !== null) {
      zamanlayici.clearTimeout(donusZamanlayicisi);
      donusZamanlayicisi = null;
    }
  }

  /** Birden çok geçerli sensör varken (sensor modu, bağlantı var, tepsi var) dönüş zamanlayıcısı çalışır; değilse durur. */
  function donusuAyarla() {
    const gerekli = !!tepsiAl() && mod() === 'sensor' && solukAl() !== true && sensorRozetleri().length > 1;
    if (!gerekli) {
      donusuDurdur();
      return;
    }
    if (donusZamanlayicisi !== null) return;
    donusZamanlayicisi = zamanlayici.setTimeout(() => {
      donusZamanlayicisi = null;
      sira += 1;
      try {
        guncelle();
      } catch {
        gunluk('Tepsi rozeti sensör dönüşü güncellenemedi.');
      }
    }, DONUS_MS);
    if (donusZamanlayicisi && typeof donusZamanlayicisi.unref === 'function') donusZamanlayicisi.unref(); // kapanışı geciktirmez
  }

  function guncelle() {
    if (!tepsiAl()) {
      donusuDurdur();
      return;
    }
    const d = istenen();
    const hizli = sonSoluk !== null && d.soluk !== sonSoluk; // bağlantı durumu değişimi beklemez
    sonSoluk = d.soluk;
    denetleyici.iste({ anahtar: d.anahtar, hizli, soluk: d.soluk, rozet: d.rozet, boyut: d.boyut });
    donusuAyarla();
  }

  return {
    /** Tray ilk dosya simgesiyle oluşturuldu: bu durum "uygulanmış" sayılır (rozet ilk güncellemede gelir). */
    baslangic() {
      const d = istenen();
      sonSoluk = d.soluk;
      denetleyici.baslangic(d.soluk ? 'dosya|soluk' : 'dosya|normal');
    },
    /** Bağlantı, ışık sayısı, sensör değeri ya da ayar değişince çağrılır; değişmeyen simge yeniden yazılmaz, sık değişim saniyede 1'e iner. */
    guncelle,
    /** 'sensor' modunda sensörlerin tepsi ipucu eki ("Salon sıcaklığı: 21,5 °C · Pil: 80 %"); rozeti olan sensör yoksa null. */
    ipucuEki() {
      if (mod() !== 'sensor' || solukAl() === true) return null;
      const parcalar = sensorKimlikleri()
        .map((kimlik) => sensorIpucuEki(durumAl(kimlik), { dil: dilOku() }))
        .filter((p) => typeof p === 'string' && p !== '');
      return parcalar.length > 0 ? parcalar.join(' · ') : null;
    },
    /** Canlı abonelik/REST yenilemesine eklenecek ana sensör kimliği ('sensor' modunda) ya da null (eski çağrılar için). */
    izlenenKimlik() {
      return mod() === 'sensor' ? sensorKimligi() : null;
    },
    /** Canlı abonelik/REST yenilemesine eklenecek TÜM rozet sensörleri ('sensor' modunda en çok 3; değilse boş). */
    izlenenKimlikler() {
      return mod() === 'sensor' ? sensorKimlikleri() : [];
    },
    temizle: () => {
      donusuDurdur();
      denetleyici.temizle();
    },
    uygulanan: () => denetleyici.uygulanan(),
  };
}

module.exports = { ROZET_MODLARI, EN_COK_ROZET_SENSORU, DONUS_MS, tepsiRozetiOlustur };
