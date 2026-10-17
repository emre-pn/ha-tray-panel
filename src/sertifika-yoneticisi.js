'use strict';

/**
 * Sertifika yöneticisi (1.4.0, o-56): YALNIZ Home Assistant ana bilgisayarları için özel kök CA ya da parmak izi sabitleme.
 *
 * "Sertifika hatalarını yok say" diye bir seçenek YOKTUR. Bu dosya, Electron'un `session` sertifika doğrulama kancasını kullanan TEK
 * yerdir (araclar/kontrol.js ve test/yapi.test.js bunu bilinçli olarak yalnız bu dosyaya izin verir).
 *
 * Kurallar
 *  - Kanca yalnız ayardaki iki https HA adresinin ana bilgisayarlarında devreye girer. Başka her ana bilgisayarda -3 (Chromium'un kendi
 *    sonucu) döner; yani HA dışındaki hiçbir siteye etkisi yoktur.
 *  - Sabitleme VARSA: o ana bilgisayar için yalnız parmak izi eşleşen ve tarihi geçerli yaprak sertifika kabul edilir; başka her sertifika
 *    (sistem güvense bile) reddedilir (-2).
 *  - Özel kök CA VARSA: yalnız sistem doğrulaması "yetkili geçersiz" dediğinde devreye girer ve zincir bu köklere çıkıyor, ad ve tarihler
 *    tutuyorsa kabul eder (0). Sistemin başka her ret nedeni (süre, iptal, ad uyuşmazlığı...) olduğu gibi kalır.
 *  - Hiç kayıt yokken kanca KURULMAZ (tarayıcı davranışı bugünkü gibi); kayıtlar silinince kanca kaldırılır.
 *  - Kayıtlar değişince açık bağlantılar kapatılır: kaldırılan güven hemen etkisini kaybeder.
 *  - Günlüğe sertifika ya da parmak izi yazılmaz; yalnız sayılar.
 *  - IPC işleyicileri yalnız Ayarlar penceresinden gelen çağrıyı kabul eder (baglanti-yoneticisi.js `ayarlardan` denetimi).
 */

const nodeFs = require('node:fs');
const nodeCrypto = require('node:crypto');
const {
  EN_COK_CA,
  EN_COK_SABIT,
  DOSYA_EN_COK_BAYT,
  anaBilgisayarCoz,
  tlsAdresiCoz,
  parmakIziniCoz,
  parmakIziniBicimle,
  sertifikalariAyir,
  kokBilgisi,
  sertifikaOzeti,
  sabitlemeUyuyor,
  zincirDogrula,
} = require('./lib/sertifika');
const { sunucuSertifikasiniOku } = require('./lib/sertifika-oku');

const ZINCIR_EN_COK = 6;

/**
 * @param {object} bag
 * @param {ReturnType<typeof import('./lib/sertifika-deposu').sertifikaDeposuOlustur>} bag.depo
 * @param {() => ({yerelAdres?: string, disAdres?: string}|null)} bag.ayarlarAl
 * @param {() => Promise<string|null>} [bag.dosyaSec] kök sertifika dosyası seçtirir (iptalde null); yol arayüze gitmez
 * @param {Function} [bag.sertifikaOkuyucu] testler için (anaBilgisayar, kapi) -> sunucuSertifikasiniOku sonucu
 * @param {() => number} [bag.simdi]
 * @param {(mesaj: string) => void} [bag.gunluk]
 */
function sertifikaYoneticisiOlustur({
  depo,
  ayarlarAl,
  dosyaSec = async () => null,
  sertifikaOkuyucu = sunucuSertifikasiniOku,
  fs = nodeFs,
  crypto = nodeCrypto,
  X509Certificate = nodeCrypto.X509Certificate,
  simdi = Date.now,
  gunluk = () => {},
}) {
  const kutuphane = { crypto, X509Certificate };

  /** Ayardaki https HA adresleri: ana bilgisayar -> { tur, kapi }. Aynı ana bilgisayar iki adreste varsa ilk (ev içi) kazanır. */
  function haAdresleri() {
    const a = ayarlarAl() ?? {};
    const harita = new Map();
    for (const [tur, adres] of [['yerel', a.yerelAdres], ['dis', a.disAdres]]) {
      const cozulen = tlsAdresiCoz(adres);
      if (cozulen && !harita.has(cozulen.anaBilgisayar)) harita.set(cozulen.anaBilgisayar, { tur, kapi: cozulen.kapi });
    }
    return harita;
  }

  function zincirPemleri(sertifika) {
    const sonuc = [];
    let s = sertifika && sertifika.issuerCert;
    for (let i = 0; i < ZINCIR_EN_COK && s; i += 1) {
      if (typeof s.data === 'string') sonuc.push(s.data);
      s = s.issuerCert;
    }
    return sonuc;
  }

  /**
   * Electron setCertificateVerifyProc karar kodu: 0 = kabul, -2 = ret, -3 = Chromium'un sonucu.
   * @param {{ hostname?: string, certificate?: { data?: string, issuerCert?: object }, verificationResult?: string }} istek
   */
  function karar(istek) {
    const anaBilgisayar = anaBilgisayarCoz(istek && istek.hostname);
    if (!anaBilgisayar || !haAdresleri().has(anaBilgisayar)) return -3;
    const yaprakPem = istek.certificate && typeof istek.certificate.data === 'string' ? istek.certificate.data : null;

    const sabit = depo.sabitBul(anaBilgisayar);
    if (sabit) {
      return yaprakPem && sabitlemeUyuyor(sabit.parmak, yaprakPem, { simdi: simdi(), ...kutuphane }) ? 0 : -2;
    }

    const kokler = depo.kokPemleri();
    if (kokler.length === 0 || !yaprakPem) return -3;
    // Yalnız "yetkili geçersiz" durumu özel kökle kurtarılabilir; sistemin başka hiçbir ret nedeni (süre, iptal, ad...) aşılmaz.
    if (istek.verificationResult !== 'net::ERR_CERT_AUTHORITY_INVALID') return -3;
    const sonuc = zincirDogrula({ yaprakPem, araPemler: zincirPemleri(istek.certificate), kokPemler: kokler, anaBilgisayar, simdi: simdi(), X509Certificate });
    return sonuc.ok ? 0 : -3;
  }

  /** Canlı bağlantı (ws-istemci.js) için bağlantıya özel TLS seçenekleri; HA dışı ya da kayıt yoksa null. */
  function wsSecenekleri(url) {
    const adres = tlsAdresiCoz(url);
    if (!adres || !haAdresleri().has(adres.anaBilgisayar)) return null;
    const sabit = depo.sabitBul(adres.anaBilgisayar);
    if (sabit) return { yaprakDenetle: (der) => sabitlemeUyuyor(sabit.parmak, der, { simdi: simdi(), ...kutuphane }) };
    const kokler = depo.kokPemleri();
    return kokler.length > 0 ? { ca: kokler } : null;
  }

  const bagliOturumlar = new WeakSet();

  /** Bir Electron oturumuna doğrulama kancasını bağlar (kayıt yokken kanca kurulmaz; yükleme bitene dek gelen istekler bekler). */
  function oturumaBagla(ses) {
    if (!ses || typeof ses.setCertificateVerifyProc !== 'function' || bagliOturumlar.has(ses)) return;
    bagliOturumlar.add(ses);
    let sonImza = null;
    const imzaAl = () => JSON.stringify([depo.kokler().map((k) => k.parmak), depo.sabitler().map((s) => [s.anaBilgisayar, s.parmak])]);
    const kur = () => {
      if (depo.hazirMi() && depo.bos()) {
        ses.setCertificateVerifyProc(null); // kayıt yok: tarayıcı varsayılanı
      } else {
        ses.setCertificateVerifyProc((istek, geriCagir) => {
          const cevapla = () => {
            let k = -3;
            try {
              k = karar(istek);
            } catch {
              k = -3;
            }
            geriCagir(k);
          };
          if (depo.hazirMi()) cevapla();
          else depo.hazir().then(cevapla, cevapla);
        });
      }
      if (!depo.hazirMi()) return;
      const imza = imzaAl();
      if (sonImza !== null && imza !== sonImza && typeof ses.closeAllConnections === 'function') {
        // Güven değişti: açık bağlantılar eski güvenle kurulmuş olabilir; yenisi yeni kurala göre kurulsun.
        Promise.resolve()
          .then(() => ses.closeAllConnections())
          .catch(() => {});
      }
      sonImza = imza;
    };
    kur();
    depo.hazir().then(kur, kur);
    depo.degistiDinle(kur);
  }

  // ---- Arayüz (Ayarlar > Bağlantı > Sertifika güveni) ----

  const turAdresi = (tur) => {
    const a = ayarlarAl() ?? {};
    return tur === 'dis' ? a.disAdres : a.yerelAdres;
  };

  function durum() {
    const ozet = depo.ozet();
    const adresler = [];
    for (const [anaBilgisayar, bilgi] of haAdresleri()) {
      adresler.push({ tur: bilgi.tur, anaBilgisayar, kapi: bilgi.kapi, sabit: !!depo.sabitBul(anaBilgisayar) });
    }
    return {
      ca: ozet.ca.map((k) => ({ ...k, parmakBicimli: parmakIziniBicimle(k.parmak) })),
      sabit: ozet.sabit.map((s) => ({ ...s, parmakBicimli: parmakIziniBicimle(s.parmak) })),
      adresler,
      enCokCa: EN_COK_CA,
      enCokSabit: EN_COK_SABIT,
    };
  }

  /** "Sunucu sertifikasını oku": TLS el sıkışması, veri yazılmaz. Sabitleme yalnız kullanıcı onayıyla (parmakKaydet) yapılır. */
  async function sertifikaOku(tur) {
    const adres = tlsAdresiCoz(turAdresi(tur === 'dis' ? 'dis' : 'yerel'));
    if (!adres) return { ok: false, neden: typeof turAdresi(tur) === 'string' && turAdresi(tur) !== '' ? 'https-degil' : 'adres-yok' };
    const okuma = await sertifikaOkuyucu({ anaBilgisayar: adres.anaBilgisayar, kapi: adres.kapi });
    if (!okuma || !okuma.ok) return { ok: false, neden: (okuma && okuma.neden) || 'baglanamadi' };
    const ozet = sertifikaOzeti(okuma.der, { X509Certificate });
    if (!ozet) return { ok: false, neden: 'sertifika-yok' };
    return {
      ok: true,
      tur: tur === 'dis' ? 'dis' : 'yerel',
      anaBilgisayar: adres.anaBilgisayar,
      kapi: adres.kapi,
      parmak: ozet.parmak,
      parmakBicimli: parmakIziniBicimle(ozet.parmak),
      ad: ozet.ad,
      veren: ozet.veren,
      sanlar: ozet.sanlar,
      baslangic: ozet.baslangic,
      bitis: ozet.bitis,
      kendindenImzali: ozet.kendindenImzali,
      sistemGuveniyor: okuma.sistemGuveniyor === true,
    };
  }

  /** Parmak izini, ayardaki o adresin ana bilgisayarına bağlayarak sabitler. */
  async function parmakKaydet(tur, parmak) {
    const adres = tlsAdresiCoz(turAdresi(tur === 'dis' ? 'dis' : 'yerel'));
    if (!adres) return { ok: false, neden: 'https-degil' };
    const hex = parmakIziniCoz(parmak);
    if (!hex) return { ok: false, neden: 'parmak-gecersiz' };
    const sonuc = await depo.sabitle(adres.anaBilgisayar, hex);
    if (!sonuc.ok) return { ok: false, neden: sonuc.neden };
    gunluk('Sertifika parmak izi sabitlendi.');
    return { ok: true, sertifika: durum() };
  }

  async function parmakSil(anaBilgisayar) {
    const sonuc = await depo.sabitSil(anaBilgisayar);
    if (!sonuc.ok) return { ok: false, neden: sonuc.neden };
    gunluk('Sertifika parmak izi sabitlemesi kaldırıldı.');
    return { ok: true, sertifika: durum() };
  }

  async function dosyaOku(yol) {
    try {
      const bilgi = await fs.promises.stat(yol);
      if (!bilgi.isFile()) return { ok: false, neden: 'okunamadi' };
      if (bilgi.size > DOSYA_EN_COK_BAYT) return { ok: false, neden: 'cok-buyuk' };
      return { ok: true, icerik: await fs.promises.readFile(yol) };
    } catch {
      return { ok: false, neden: 'okunamadi' };
    }
  }

  /** Kullanıcının seçtiği dosyadan KÖK CA ekler. Özel anahtar içeren ya da kök olmayan dosya eklenmez. */
  async function kokEkle() {
    let yol = null;
    try {
      yol = await dosyaSec();
    } catch {
      return { ok: false, neden: 'diyalog-acilamadi' };
    }
    if (typeof yol !== 'string' || yol === '') return { ok: false, iptal: true };
    const okunan = await dosyaOku(yol);
    if (!okunan.ok) return { ok: false, neden: okunan.neden };
    const ayrilan = sertifikalariAyir(okunan.icerik, { X509Certificate });
    if (!ayrilan.ok) return { ok: false, neden: ayrilan.neden };
    const gecerliler = [];
    let ilkNeden = null;
    for (const pem of ayrilan.pemler) {
      const bilgi = kokBilgisi(pem, { simdi: simdi(), X509Certificate });
      if (bilgi.ok) gecerliler.push(bilgi);
      else ilkNeden = ilkNeden ?? bilgi.neden;
    }
    if (gecerliler.length === 0) return { ok: false, neden: ilkNeden ?? 'ca-degil' };
    const sonuc = await depo.kokEkle(gecerliler);
    if (!sonuc.ok) return { ok: false, neden: sonuc.neden };
    gunluk(`Kök sertifika eklendi (${sonuc.eklenen}).`);
    return { ok: true, eklenen: sonuc.eklenen, atlanan: ayrilan.pemler.length - gecerliler.length, sertifika: durum() };
  }

  async function kokSil(parmak) {
    if (typeof parmak !== 'string' || !/^[0-9a-f]{64}$/.test(parmak)) return { ok: false, neden: 'parmak-gecersiz' };
    const sonuc = await depo.kokSil(parmak);
    if (!sonuc.ok) return { ok: false, neden: sonuc.neden };
    gunluk('Kök sertifika kaldırıldı.');
    return { ok: true, sertifika: durum() };
  }

  /** baglanti-yoneticisi.ipcKaydet `ek` listesi: [kanal, işleyici] çiftleri (ayardan koruması orada). */
  function ipcIsleyicileri() {
    return [
      ['baglanti:sertifika-oku', (tur) => sertifikaOku(tur)],
      ['baglanti:parmak-kaydet', (tur, parmak) => parmakKaydet(tur, parmak)],
      ['baglanti:parmak-sil', (anaBilgisayar) => parmakSil(anaBilgisayar)],
      ['baglanti:ca-ekle', () => kokEkle()],
      ['baglanti:ca-sil', (parmak) => kokSil(parmak)],
    ];
  }

  return {
    yukle: () => depo.yukle(),
    hazir: () => depo.hazir(),
    hazirMi: () => depo.hazirMi(),
    karar,
    wsSecenekleri,
    oturumaBagla,
    durum,
    sertifikaOku,
    parmakKaydet,
    parmakSil,
    kokEkle,
    kokSil,
    ipcIsleyicileri,
  };
}

module.exports = { sertifikaYoneticisiOlustur };
