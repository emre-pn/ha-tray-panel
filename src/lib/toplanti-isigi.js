'use strict';

/**
 * Toplantı ışığı (o-53, 1.4.0 dis grubu). Saf; Electron'a bağlı değildir (kayıt defteri sorgusu dışarıdan verilir).
 *
 * Mikrofon ya da kamera kullanımda mı? Windows'un kendi gizlilik kaydı okunur (YALNIZ OKUMA):
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{microphone,webcam}
 * Alt anahtarlarında (mağaza uygulamaları ve NonPackaged altında masaüstü uygulamaları) LastUsedTimeStart / LastUsedTimeStop
 * REG_QWORD değerleri durur; Start > 0 ve Stop = 0 olan bir alt anahtar varsa aygıt şu an kullanılıyordur.
 *
 * GİZLİLİK: hangi uygulamanın kullandığı (alt anahtar adı, uygulama yolu) HİÇBİR yere yazılmaz, saklanmaz, günlüğe girmez;
 * çözümleyici yalnız evet/hayır döner. Kayıt defterine hiçbir şey yazılmaz.
 *
 * Titreşim önleme: kullanım ilk görüldüğünde "başladı"; art arda BITIS_OKUMASI kez kullanılmıyor okununca "bitti".
 */

const ANAHTAR_KOKU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
const AYGIT_ANAHTARLARI = Object.freeze({ mikrofon: `${ANAHTAR_KOKU}\\microphone`, kamera: `${ANAHTAR_KOKU}\\webcam` });
const KAYNAK_SECENEKLERI = Object.freeze(['ikisi', 'mikrofon', 'kamera']);
const BITIS_OKUMASI = 2;
const EN_AZ_ARALIK_MS = 5000;
const EN_COK_ARALIK_MS = 60_000;

/** "0x1d9a..." -> BigInt; okunamazsa null. */
function qword(metin) {
  if (typeof metin !== 'string' || !/^0x[0-9a-f]{1,16}$/i.test(metin)) return null;
  try {
    return BigInt(metin);
  } catch {
    return null;
  }
}

/**
 * `reg query <anahtar> /s` çıktısında şu an kullanımda olan bir alt anahtar var mı? Yalnız boolean döner (uygulama adı yok).
 * @param {unknown} cikti
 * @returns {boolean}
 */
function kullanimdaMi(cikti) {
  if (typeof cikti !== 'string' || cikti === '') return false;
  let baslangic = null;
  let bitis = null;
  const blokBitti = () => {
    const sonuc = baslangic !== null && baslangic > 0n && bitis === 0n;
    baslangic = null;
    bitis = null;
    return sonuc;
  };
  for (const satir of cikti.split(/\r?\n/)) {
    if (/^HKEY_/i.test(satir)) {
      if (blokBitti()) return true;
      continue;
    }
    const m = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(\S+)\s*$/.exec(satir);
    if (!m) continue;
    if (m[1] === 'LastUsedTimeStart') baslangic = qword(m[2]);
    else bitis = qword(m[2]);
  }
  return blokBitti();
}

/** Seçilen kaynağa göre sorgulanacak anahtarlar. */
function anahtarlar(kaynak) {
  if (kaynak === 'mikrofon') return [AYGIT_ANAHTARLARI.mikrofon];
  if (kaynak === 'kamera') return [AYGIT_ANAHTARLARI.kamera];
  return [AYGIT_ANAHTARLARI.mikrofon, AYGIT_ANAHTARLARI.kamera];
}

/**
 * Yoklayıcı. Zamanlayıcı yalnız baslat() ile kurulur; duraklat()/surdur() uyku-uyanış içindir.
 * @param {object} bag
 * @param {(anahtar: string) => Promise<string>} bag.sorgula `reg query <anahtar> /s` çıktısı (yalnız okuma; çağıran sağlar)
 * @param {() => string} bag.kaynakAl 'ikisi' | 'mikrofon' | 'kamera'
 * @param {() => number} bag.aralikAl yoklama aralığı (ms; 5-60 sn arasına sıkıştırılır)
 * @param {(kullanimda: boolean) => void} bag.degisti toplantı başladı (true) / bitti (false)
 * @param {(m: string) => void} [bag.gunluk]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 */
function toplantiIzleyiciOlustur({ sorgula, kaynakAl = () => 'ikisi', aralikAl = () => 10_000, degisti, gunluk = () => {}, zaman = globalThis }) {
  let zamanlayici = null;
  let calisiyor = false;
  let duraklatildi = false;
  let durum = false; // toplantı var mı (bildirilen son durum)
  let bosSayac = 0;
  let hataBildirildi = false;
  let yoklaniyor = false;
  let nesil = 0; // durdur/baslat arası bayat yoklamanın sonucu yok sayılır

  const aralik = () => {
    const n = Number(aralikAl());
    return Math.min(EN_COK_ARALIK_MS, Math.max(EN_AZ_ARALIK_MS, Number.isFinite(n) ? n : 10_000));
  };

  function planla() {
    if (!calisiyor || duraklatildi) return;
    zaman.clearTimeout(zamanlayici);
    zamanlayici = zaman.setTimeout(() => {
      zamanlayici = null;
      yokla().finally(planla);
    }, aralik());
  }

  /** Tek okuma; durum değişirse degisti çağrılır. Hata olursa durum değişmez (bir kez günlüğe yazılır, ayrıntısız). */
  async function yokla() {
    if (yoklaniyor) return;
    yoklaniyor = true;
    const benim = nesil;
    try {
      let aktif = false;
      let okundu = false;
      for (const anahtar of anahtarlar(kaynakAl())) {
        try {
          const cikti = await sorgula(anahtar);
          okundu = true;
          if (kullanimdaMi(cikti)) {
            aktif = true;
            break;
          }
        } catch {
          /* bu aygıtın anahtarı yok ya da okunamadı */
        }
      }
      if (benim !== nesil || !calisiyor) return;
      if (!okundu) {
        if (!hataBildirildi) {
          hataBildirildi = true;
          gunluk('Toplantı ışığı: aygıt kullanım kaydı okunamadı.');
        }
        return;
      }
      if (aktif) {
        bosSayac = 0;
        if (!durum) {
          durum = true;
          degisti(true);
        }
      } else if (durum) {
        bosSayac += 1;
        if (bosSayac >= BITIS_OKUMASI) {
          durum = false;
          bosSayac = 0;
          degisti(false);
        }
      }
    } catch {
      /* degisti hatası yoklamayı durdurmaz */
    } finally {
      yoklaniyor = false;
    }
  }

  return {
    baslat() {
      if (calisiyor) return;
      calisiyor = true;
      duraklatildi = false;
      nesil += 1;
      yokla().finally(planla);
    },
    /** Durdurur; toplantı sürüyorsa bitiş BİLDİRİLMEZ (seçeneği kapatmak ışığa dokunmaz). */
    durdur() {
      calisiyor = false;
      nesil += 1;
      zaman.clearTimeout(zamanlayici);
      zamanlayici = null;
      durum = false;
      bosSayac = 0;
    },
    duraklat() {
      duraklatildi = true;
      zaman.clearTimeout(zamanlayici);
      zamanlayici = null;
    },
    surdur() {
      if (!calisiyor || !duraklatildi) return;
      duraklatildi = false;
      planla();
    },
    yokla,
    durum: () => ({ calisiyor, duraklatildi, toplantida: durum }),
  };
}

module.exports = { ANAHTAR_KOKU, AYGIT_ANAHTARLARI, KAYNAK_SECENEKLERI, BITIS_OKUMASI, kullanimdaMi, anahtarlar, toplantiIzleyiciOlustur };
