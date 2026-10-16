'use strict';

/**
 * Erişim anahtarı deposu (saf; Electron'a bağlı değildir — `safe` (safeStorage) ve `fs` dışarıdan verilir) — hata-07.
 *
 *  - Asenkron safeStorage (encryptStringAsync/decryptStringAsync) kullanılır; eşzamanlı çağrılar Electron 45'te
 *    kullanımdan kalkıyor, 46'da kaldırılıyor.
 *  - Okuma: önce asenkron; olmazsa eşzamanlı (eski sürümde yazılmış dosya için). Eşzamanlı okuma başarılı olduysa ya da
 *    `shouldReEncrypt` ise anahtar yeni biçimle yeniden yazılır: önce geçici dosyaya yaz, geri çöz ve eşitliği doğrula,
 *    sonra yeniden adlandır. Doğrulama başarısızsa geçici dosya silinir, özgün dosya kalır.
 *  - Göçten önce özgün dosya `<dosya>.eski` olarak YEDEKLENİR (yedek alınamazsa göç yapılmaz). Yeni biçim sonraki
 *    açılışlarda çözülemezse (şifreleme API'si ya da profil değişti) anahtar bu yedekten okunur. Yedek, yeni biçim
 *    başka bir süreçte başarıyla okunduğunda ya da anahtar yazılıp silindiğinde silinir.
 *  - Yazma atomiktir (geçici dosya + yeniden adlandırma) ve yazılan veri geri çözülüp doğrulanır. Yaz/sil tek sırada çalışır
 *    (1.2.0, h-38): aynı anda iki kayıt aynı geçici dosyayı paylaşıp bellek ile diski tutarsız bırakamaz.
 *  - Çözülmüş anahtar bellekte önbelleklenir (her istekte diskten çözülmez); aynı anda gelen okumalar tek okumayı
 *    paylaşır; yazma/silme önbelleği günceller. Anahtar ASLA günlüğe, hata metnine ya da başka bir kanala yazılmaz.
 *
 * Aynı Windows kullanıcısındaki her program anahtarı çözebilir; asıl koruma, izin listesi ve GÜVENLİK KURALI'dır.
 */

const path = require('node:path');

/**
 * @param {{ dosyaYolu: string, fs: object, safe: object, gunluk?: (m: string) => void }} girdi
 * @returns {{ varMi: () => boolean, kullanilabilirMi: () => Promise<boolean>, anahtarAl: () => Promise<string|null>,
 *             yaz: (anahtar: string) => Promise<void>, sil: () => Promise<{silindi: boolean}> }}
 */
function anahtarDeposuOlustur({ dosyaYolu, fs, safe, gunluk = () => {} }) {
  const yazmaGecicisi = `${dosyaYolu}.tmp`;
  const gocGecicisi = `${dosyaYolu}.gocu.tmp`; // yazma ile göç aynı geçici dosyayı ezmesin
  const eskiYedek = `${dosyaYolu}.eski`; // göç öncesi özgün dosya
  const karantinaYolu = `${dosyaYolu}.reddedildi`; // reddedilen anahtarın kaydı yazılamadığında dosya buraya alınır (tur 2)

  let onbellek = null;
  let okuma = null;
  let surum = 0; // yaz/sil artırır: bayat bir okumanın önbelleğe yazmasını ve göçün yeni anahtarı ezmesini engeller
  let cozmeHatasiBildirildi = false;
  let yedegiBenAldim = false; // bu süreçte alınan yedek, yeni biçim BAŞKA bir açılışta okunana kadar silinmez

  const varMi = () => fs.existsSync(dosyaYolu);

  async function asenkronVarMi() {
    try {
      return typeof safe.isAsyncEncryptionAvailable === 'function' && !!(await safe.isAsyncEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function senkronVarMi() {
    try {
      return typeof safe.isEncryptionAvailable === 'function' && !!safe.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async function kullanilabilirMi() {
    return (await asenkronVarMi()) || senkronVarMi();
  }

  /** @returns {Promise<{metin: string, yenidenSifrele: boolean}|null>} */
  async function coz(veri) {
    if (await asenkronVarMi()) {
      try {
        const sonuc = await safe.decryptStringAsync(veri);
        if (sonuc && typeof sonuc.result === 'string' && sonuc.result) {
          return { metin: sonuc.result, yenidenSifrele: !!sonuc.shouldReEncrypt };
        }
      } catch {
        /* eski (eşzamanlı) biçim olabilir: aşağıda denenir */
      }
    }
    if (senkronVarMi() && typeof safe.decryptString === 'function') {
      try {
        const metin = safe.decryptString(veri);
        if (metin) return { metin, yenidenSifrele: true };
      } catch {
        /* çözülemedi */
      }
    }
    return null;
  }

  /** Eski biçimli ya da yeniden şifrelenmesi istenen anahtarı yeni biçimle, doğrulayarak yeniden yazar (en iyi çaba). */
  async function yenidenYaz(anahtar, benimSurum) {
    try {
      if (!(await asenkronVarMi())) return false;
      fs.writeFileSync(gocGecicisi, await safe.encryptStringAsync(anahtar));
      const dogrulama = await safe.decryptStringAsync(fs.readFileSync(gocGecicisi));
      if (dogrulama?.result !== anahtar || benimSurum !== surum) {
        fs.rmSync(gocGecicisi, { force: true });
        return false;
      }
      fs.copyFileSync(dosyaYolu, eskiYedek); // yedek alınamazsa catch: göç yapılmaz, özgün dosya kalır
      yedegiBenAldim = true;
      fs.renameSync(gocGecicisi, dosyaYolu); // kontrol ile yeniden adlandırma arasında await yok: yarış olmaz
      return true;
    } catch {
      try {
        fs.rmSync(gocGecicisi, { force: true });
      } catch {
        /* yok say */
      }
      return false;
    }
  }

  async function oku(benimSurum) {
    let veri;
    try {
      veri = fs.readFileSync(dosyaYolu);
    } catch {
      return null;
    }
    const cozulen = await coz(veri);
    if (!cozulen) {
      const yedekten = await yedektenOku();
      if (!cozmeHatasiBildirildi) {
        cozmeHatasiBildirildi = true;
        gunluk(
          yedekten
            ? 'Erişim anahtarı ana dosyadan çözülemedi; göç öncesi yedekten okundu.'
            : 'Erişim anahtarı çözülemedi (başka kullanıcı/bilgisayardan kopyalanmış olabilir).',
        );
      }
      return yedekten;
    }
    if (cozulen.yenidenSifrele) await yenidenYaz(cozulen.metin, benimSurum);
    else if (!yedegiBenAldim && benimSurum === surum) yedegiSil(); // yeni biçim önceki açılışta yazılmıştı ve şimdi sorunsuz okundu
    return cozulen.metin;
  }

  /** Göç öncesi yedeği çözmeyi dener (ana dosya çözülemediğinde); yoksa ya da çözülemezse null. */
  async function yedektenOku() {
    let veri;
    try {
      veri = fs.readFileSync(eskiYedek);
    } catch {
      return null;
    }
    return (await coz(veri))?.metin ?? null;
  }

  function yedegiSil() {
    try {
      fs.rmSync(eskiYedek, { force: true });
    } catch {
      /* yok say */
    }
    yedegiBenAldim = false;
  }

  function karantinayiSil() {
    try {
      fs.rmSync(karantinaYolu, { force: true });
    } catch {
      /* yok say */
    }
  }

  /**
   * Home Assistant'ın reddettiği ama kaydı (yetki kesici) diske yazılamayan anahtarın dosyasını kenara alır (yeniden adlandırma:
   * disk dolu olsa da çalışır). Böylece uygulama yeniden başlayınca anahtar yoktur ve HA'ya istek gitmez. Kullanıcı yeni anahtar
   * kaydedince ya da "Anahtarı sil" deyince kenardaki dosya silinir. @returns {boolean} kenara alındı mı
   */
  function karantinayaAl() {
    try {
      if (!fs.existsSync(dosyaYolu)) return false;
      fs.renameSync(dosyaYolu, karantinaYolu);
    } catch {
      return false;
    }
    surum += 1;
    onbellek = null;
    okuma = null;
    cozmeHatasiBildirildi = false;
    gunluk('Reddedilen erişim anahtarının dosyası kenara alındı (kayıt yazılamadı).');
    return true;
  }

  const karantinadaMi = () => fs.existsSync(karantinaYolu);

  /** Çözülmüş anahtar ya da null (dosya yok / çözülemedi). Önbellekli; aynı anda gelen çağrılar tek okumayı paylaşır. */
  async function anahtarAl() {
    if (!varMi()) {
      onbellek = null;
      return null;
    }
    if (onbellek) return onbellek;
    if (!okuma) {
      const benimSurum = surum;
      okuma = (async () => {
        try {
          const sonuc = await oku(benimSurum);
          if (sonuc && benimSurum === surum) onbellek = sonuc;
          return sonuc;
        } finally {
          if (benimSurum === surum) okuma = null;
        }
      })();
    }
    return okuma;
  }

  // h-38 (1.2.0): yaz ve sil TEK sırada çalışır. İki kayıt aynı geçici dosyayı (yazmaGecicisi) paylaştığı için iç içe geçerse biri
  // diğerinin geçici dosyasını yeniden adlandırabilir (bellekte A, diskte B kalırdı); sil de süren bir yazmanın geçici dosyasını silip
  // ardından anahtarı geri getirebilirdi. Sıradaki iş öncekinin başarısından bağımsız çalışır (bir hata sırayı kilitlemez).
  let yazmaSirasi = Promise.resolve();
  function siraya(is) {
    const sonuc = yazmaSirasi.then(is, is);
    yazmaSirasi = sonuc.catch(() => {});
    return sonuc;
  }

  function yaz(anahtar) {
    return siraya(() => yazIc(anahtar));
  }

  async function yazIc(anahtar) {
    if (typeof anahtar !== 'string' || anahtar.length === 0) throw new Error('gecersiz-anahtar');
    let asenkron = false;
    let veri;
    if (await asenkronVarMi()) {
      asenkron = true;
      veri = await safe.encryptStringAsync(anahtar);
    } else if (senkronVarMi()) {
      veri = safe.encryptString(anahtar);
    } else {
      throw new Error('sifreleme-yok');
    }
    fs.mkdirSync(path.dirname(dosyaYolu), { recursive: true });
    fs.writeFileSync(yazmaGecicisi, veri);
    const yazilan = fs.readFileSync(yazmaGecicisi);
    const geri = asenkron ? (await safe.decryptStringAsync(yazilan))?.result : safe.decryptString(yazilan);
    if (geri !== anahtar) {
      fs.rmSync(yazmaGecicisi, { force: true });
      throw new Error('dogrulama-basarisiz');
    }
    fs.renameSync(yazmaGecicisi, dosyaYolu);
    karantinayiSil(); // yeni anahtar kaydedildi: eski karantina artık anlamsız
    yedegiSil(); // yeni anahtar yazıldı: eski anahtarın yedeği artık yanlış anahtar olurdu
    surum += 1;
    onbellek = anahtar;
    okuma = null;
    cozmeHatasiBildirildi = false;
  }

  /** Yalnız YEREL dosyayı siler; Home Assistant'taki anahtar iptal edilmez (kullanıcı bunu HA profilinden yapmalı). Süren yazmayı bekler (h-38). */
  function sil() {
    return siraya(silIc);
  }

  async function silIc() {
    fs.rmSync(dosyaYolu, { force: true });
    fs.rmSync(yazmaGecicisi, { force: true });
    fs.rmSync(gocGecicisi, { force: true });
    karantinayiSil();
    yedegiSil(); // "Anahtarı sil": yedek de gider
    surum += 1;
    onbellek = null;
    okuma = null;
    cozmeHatasiBildirildi = false;
    return { silindi: true };
  }

  return { varMi, kullanilabilirMi, anahtarAl, yaz, sil, karantinayaAl, karantinadaMi };
}

module.exports = { anahtarDeposuOlustur };
