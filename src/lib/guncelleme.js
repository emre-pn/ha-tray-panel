'use strict';

/**
 * Uygulama içi güncelleme (o-51): kural ve durum makinesi. Saf modül: electron-updater, saat ve dosya okuma dışarıdan verilir; burada
 * ağ kodu YOKTUR (istekleri electron-updater yapar, onu src/main.js tembel yükler).
 *
 * İlkeler:
 *  - Varsayılan KAPALI ve açık rıza ile (ayar `uygulamaGuncelleme`): `acikMi()` false iken HİÇ istek gitmez, hiçbir şey indirilmez ya da kurulmaz.
 *  - Giden istekler yalnız GitHub Sürümleri'ne (electron-builder `publish`: github, sabit depo) anahtarsız, çerezsiz GET'tir. Home Assistant
 *    adresi, anahtar ya da kullanıcı bilgisi hiçbir yere gitmez; electron-updater'ın rastgele "hazırlama kimliği" başlığı sabit bir
 *    değerle ezilir (kullanıcıya özgü kimlik yok), User-Agent sabittir. Telemetri yok.
 *  - Otomatik indirme ve çıkışta kurma KAPALI: indirme "İndir" düğmesiyle, kurulum ayrıca ana sürecin kendi onay penceresiyle başlar.
 *  - Bütünlük: electron-updater, latest.yml'de sha512 YOKSA denetimi sessizce atlar. Bu yüzden bilgi, indirmeden ÖNCE burada doğrulanır
 *    (sürüm yalnız ileri gider, ön sürüm yalnız seçenek açıkken, dosya adı yalnız düz ad, sha512 zorunlu ve biçimli, boyut sınırlı)
 *    ve indirilen dosyanın sha512'si hem indirmeden sonra hem KURMADAN hemen önce bu bilgiyle yeniden hesaplanıp karşılaştırılır.
 *  - Günde en çok bir otomatik denetim; elle denetim en çok dakikada bir (sürüm denetimiyle (o-40) aynı sınırlar).
 *  - Hata iletisi, adres ve dosya yolu günlüğe/arayüze yazılmaz; yalnız sınıflandırılmış bir neden taşınır.
 */

const nodeFs = require('node:fs');
const nodeCrypto = require('node:crypto');
const nodePath = require('node:path');
const { surumAyristir, surumMetniOn, surumKarsilastirOn, durumuDuzelt, DENETIM_ARALIGI_MS, ELLE_ARALIK_MS } = require('./surum-denetimi');

const DURUM_DOSYASI = 'guncelleme.json';
const KULLANICI_AJANI = 'ev-paneli-guncelleme'; // sürüm ya da makine bilgisi içermez
const HAZIRLAMA_BASLIGI = { 'x-user-staging-id': 'yok', 'User-Agent': KULLANICI_AJANI }; // electron-updater'ın rastgele kimliğini ve Electron UA'sını ezer
const EN_BUYUK_KURUCU = 400 * 1024 * 1024; // beklenmedik büyüklükte bir "kurucu" indirilmez
const EN_COK_DOSYA = 8;
const KURULUM_BEKLEME_MS = 20_000; // quitAndInstall sessizce başarısız olabilir: uygulama bu sürede kapanmadıysa durum geri alınır
const SHA512_DESENI = /^[A-Za-z0-9+/]{86}==$/; // 64 baytın base64'ü (electron-builder çıktısı)
const DOSYA_ADI_DESENI = /^[A-Za-z0-9._()+ -]{1,120}$/;

/** Desteklenmeyen ortamlarda (taşınabilir sürüm, kurulmamış geliştirme çalıştırması, Windows dışı) güncelleyici hiç kurulmaz. */
function destekDurumu({ paketli, tasinabilir, platform }) {
  if (platform !== 'win32') return 'platform';
  if (!paketli) return 'paketsiz';
  if (tasinabilir) return 'tasinabilir';
  return 'tamam';
}

/** Kurucu dosya adı: yalnız düz ad (dizin, adres, sürücü ya da üst dizin parçası yok) ve .exe. */
function dosyaAdiGecerliMi(ad) {
  return typeof ad === 'string' && DOSYA_ADI_DESENI.test(ad) && !ad.includes('..') && !ad.startsWith(' ') && !ad.endsWith(' ') && /\.exe$/i.test(ad);
}

/**
 * electron-updater'ın verdiği sürüm bilgisini (latest.yml içeriği) indirmeden önce doğrular.
 * @returns {{ ok: true, surum: string, onSurum: boolean, dosyaAdi: string, sha512: string, boyut: number } | { ok: false, neden: string }}
 */
function bilgiyiDogrula(bilgi, { mevcutSurum, onSurumler = false } = {}) {
  if (!bilgi || typeof bilgi !== 'object' || Array.isArray(bilgi)) return { ok: false, neden: 'bicim' };
  const s = surumAyristir(bilgi.version);
  if (!s) return { ok: false, neden: 'surum' };
  if (s.on !== null && onSurumler !== true) return { ok: false, neden: 'on-surum' };
  const surum = surumMetniOn(s);
  if (surumKarsilastirOn(surum, mevcutSurum) !== 1) return { ok: false, neden: 'eski' }; // yalnız ileri: eşit ya da eski sürüm kurulmaz
  const dosyalar = bilgi.files;
  if (!Array.isArray(dosyalar) || dosyalar.length < 1 || dosyalar.length > EN_COK_DOSYA) return { ok: false, neden: 'dosya' };
  for (const d of dosyalar) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, neden: 'bicim' };
    if (!dosyaAdiGecerliMi(d.url)) return { ok: false, neden: 'dosya' };
    if (typeof d.sha512 !== 'string' || !SHA512_DESENI.test(d.sha512)) return { ok: false, neden: 'ozet' };
    if (!Number.isSafeInteger(d.size) || d.size <= 0 || d.size > EN_BUYUK_KURUCU) return { ok: false, neden: 'boyut' };
  }
  // Eski biçim alanları (path/sha512) varsa yine tutarlı olmalı; yoksa sorun değil.
  if (bilgi.path !== undefined && !dosyalar.some((d) => d.url === bilgi.path)) return { ok: false, neden: 'dosya' };
  if (bilgi.sha512 !== undefined && (typeof bilgi.sha512 !== 'string' || !SHA512_DESENI.test(bilgi.sha512))) return { ok: false, neden: 'ozet' };
  const kurucu = dosyalar[0]; // electron-updater da listedeki ilk .exe'yi indirir
  return { ok: true, surum, onSurum: s.on !== null, dosyaAdi: kurucu.url, sha512: kurucu.sha512, boyut: kurucu.size };
}

/** Dosyanın sha512'sini (base64) ve boyutunu akıştan hesaplar. */
function dosyaSha512(yol, { fs = nodeFs, crypto = nodeCrypto } = {}) {
  return new Promise((coz, reddet) => {
    const ozet = crypto.createHash('sha512');
    let boyut = 0;
    const akis = fs.createReadStream(yol);
    akis.on('data', (parca) => {
      boyut += parca.length;
      ozet.update(parca);
    });
    akis.on('error', reddet);
    akis.on('end', () => coz({ sha512: ozet.digest('base64'), boyut }));
  });
}

/** Zamanlamadan bağımsız (sabit süreli) base64 sha512 karşılaştırması. */
function ozetlerEsitMi(a, b, crypto = nodeCrypto) {
  if (typeof a !== 'string' || typeof b !== 'string' || !SHA512_DESENI.test(a) || !SHA512_DESENI.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'base64'), Buffer.from(b, 'base64'));
}

/** electron-updater / ağ hatasını yalnız sınıfa indirger (ileti, adres ve yol arayüze ya da günlüğe sızmasın). */
function hataSinifla(hata) {
  const kod = String(hata?.code ?? '');
  const ileti = String(hata?.message ?? '').slice(0, 300);
  if (kod === 'ERR_CHECKSUM_MISMATCH' || /checksum mismatch|sha512/i.test(ileti)) return 'ozet';
  if (kod === 'ERR_UPDATER_NO_CHECKSUM') return 'butunluk';
  if (kod === 'ERR_UPDATER_INVALID_SIGNATURE') return 'imza';
  if (kod === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || kod === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' || kod === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || kod === 'ERR_UPDATER_RELEASE_NOT_FOUND' || hata?.statusCode === 404) return 'dosya-yok';
  if (/ETIMEDOUT|TIMED_OUT|timeout/i.test(kod + ileti)) return 'zaman';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|net::/i.test(kod + ileti) || hata?.statusCode >= 500) return 'ag';
  if (kod.startsWith('ERR_UPDATER_INVALID')) return 'butunluk';
  return 'bilinmiyor';
}

/**
 * @param {object} g
 * @param {() => object} g.guncelleyiciAl electron-updater `autoUpdater` (tembel: ilk kullanımda yüklenir; testte sahte)
 * @param {() => boolean} g.acikMi ayar `uygulamaGuncelleme`
 * @param {() => boolean} [g.onSurumlerMi] ayar `onSurumler`
 * @param {() => ('tamam'|'tasinabilir'|'paketsiz'|'platform')} g.destekMi `destekDurumu` sonucu
 * @param {string} g.mevcutSurum çalışan sürüm
 * @param {{oku: () => object|null, yaz: (d: object) => void}} g.depo
 * @param {(yol: string) => Promise<{sha512: string, boyut: number}>} [g.dosyaOzeti]
 * @param {() => void} [g.kurulumaHazirlan] quitAndInstall'dan hemen önce (main.js: çıkış bayrağını kurar)
 * @param {() => void} [g.kurulumuBirak] kurulum başlamadıysa bayrağı geri alır
 * @param {(fn: Function, ms: number) => any} [g.zamanlayici]
 * @param {() => number} [g.simdi]
 * @param {(m: string) => void} [g.gunluk]
 * @param {(durum: object) => void} [g.degisti] her durum değişikliğinde (ilerleme dahil, tamsayı yüzdesi değişince)
 */
function guncellemeYoneticisiOlustur({
  guncelleyiciAl,
  acikMi,
  onSurumlerMi = () => false,
  destekMi,
  mevcutSurum,
  depo,
  dosyaOzeti = dosyaSha512,
  kurulumaHazirlan = () => {},
  kurulumuBirak = () => {},
  zamanlayici = (fn, ms) => setTimeout(fn, ms),
  simdi = Date.now,
  gunluk = () => {},
  degisti = () => {},
} = {}) {
  let kayit = null; // kalıcı: sonDenetim / sonSurum / bildirilen
  let durum = 'bosta'; // bosta | denetleniyor | yeni | indiriliyor | indirildi | kuruluyor
  let bilgi = null; // doğrulanmış sürüm bilgisi
  let hata = null; // sınıflandırılmış son hata nedeni (yalnız gösterim)
  let ilerleme = 0;
  let indirilenDosya = null;
  let guncelleyici = null;
  let bekleyen = null; // sürmekte olan denetim
  let sonElle = 0;

  const kayitAl = () => {
    if (!kayit) kayit = durumuDuzelt(depo?.oku?.());
    return kayit;
  };
  const kayitYaz = () => {
    try {
      depo?.yaz?.({ ...kayitAl() });
    } catch {
      /* yazılamadı: bellekte kalır */
    }
  };

  /** Arayüze/ana sürece giden görünüm: sürüm, boyut, ilerleme, neden. Adres, dosya yolu ve ham hata iletisi YOKTUR. */
  function gorunum() {
    const destek = destekMi();
    return {
      acik: acikMi() === true,
      destek,
      durum,
      surum: bilgi?.surum ?? null,
      onSurum: bilgi?.onSurum === true,
      boyut: bilgi?.boyut ?? null,
      ilerleme,
      hata,
      sonDenetim: kayitAl().sonDenetim > 0 ? kayitAl().sonDenetim : null,
    };
  }
  const yay = () => {
    try {
      degisti(gorunum());
    } catch {
      /* dinleyici hatası güncellemeyi bozmasın */
    }
  };

  /** Güncelleyiciyi kurar (her denetimde yeniden uygulanır: ayar değişmiş olabilir). allowPrerelease, allowDowngrade'i açar: sonra kapatılır. */
  function ayarla() {
    if (!guncelleyici) {
      guncelleyici = guncelleyiciAl();
      guncelleyici.on?.('download-progress', (p) => {
        if (durum !== 'indiriliyor') return;
        const yuzde = Number.isFinite(p?.percent) ? Math.max(0, Math.min(100, Math.floor(p.percent))) : ilerleme;
        if (yuzde !== ilerleme) {
          ilerleme = yuzde;
          yay();
        }
      });
      guncelleyici.on?.('update-downloaded', (olay) => {
        indirilenDosya = typeof olay?.downloadedFile === 'string' ? olay.downloadedFile : null;
      });
    }
    const g = guncelleyici;
    g.autoDownload = false; // indirme yalnız kullanıcı onayıyla
    g.autoInstallOnAppQuit = false; // çıkışta sessiz kurulum yok
    g.autoRunAppAfterInstall = true;
    g.allowPrerelease = onSurumlerMi() === true;
    g.allowDowngrade = false; // allowPrerelease açıkken kendiliğinden açılırdı: eski sürüme dönüş yok
    g.disableDifferentialDownload = true; // yalnız tam kurucu; sha512 bütün dosya üzerinden doğrulanır
    g.disableWebInstaller = true;
    g.fullChangelog = false;
    g.forceDevUpdateConfig = false;
    g.logger = null; // varsayılan günlükçü adres ve yığın izi yazardı
    g.requestHeaders = { ...HAZIRLAMA_BASLIGI };
    return g;
  }

  function hataya(neden, onceki) {
    hata = neden;
    durum = onceki;
    ilerleme = 0;
    gunluk(`Güncelleme işlemi tamamlanamadı (${neden}).`);
    yay();
  }

  async function denetimYap() {
    let sonuc;
    try {
      sonuc = await ayarla().checkForUpdates();
    } catch (h) {
      const neden = hataSinifla(h);
      hataya(neden, bilgi ? 'yeni' : 'bosta');
      return { sonuc: 'hata', neden };
    }
    if (!sonuc) {
      hataya('etkin-degil', bilgi ? 'yeni' : 'bosta');
      return { sonuc: 'hata', neden: 'etkin-degil' };
    }
    if (sonuc.isUpdateAvailable !== true) {
      bilgi = null;
      hata = null;
      durum = 'bosta';
      kayitAl().sonSurum = null;
      kayitYaz();
      gunluk('Güncelleme denetimi: güncel.');
      yay();
      return { sonuc: 'guncel' };
    }
    const dogrulama = bilgiyiDogrula(sonuc.updateInfo, { mevcutSurum, onSurumler: onSurumlerMi() === true });
    if (!dogrulama.ok) {
      bilgi = null;
      hataya('butunluk', 'bosta');
      gunluk(`Güncelleme bilgisi reddedildi (${dogrulama.neden}).`);
      return { sonuc: 'hata', neden: 'butunluk' };
    }
    const yeniSurumMu = !bilgi || bilgi.surum !== dogrulama.surum;
    bilgi = dogrulama;
    if (yeniSurumMu) indirilenDosya = null;
    hata = null;
    durum = 'yeni';
    ilerleme = 0;
    const d = kayitAl();
    d.sonSurum = dogrulama.surum;
    const bildirimGerek = d.bildirilen !== dogrulama.surum;
    kayitYaz();
    gunluk(`Güncelleme denetimi: yeni sürüm var (${dogrulama.surum}).`);
    yay();
    return { sonuc: 'yeni', surum: dogrulama.surum, onSurum: dogrulama.onSurum, boyut: dogrulama.boyut, bildirimGerek };
  }

  /**
   * @param {{ elle?: boolean }} [secenek]
   * @returns {Promise<{sonuc: 'kapali'|'desteklenmiyor'|'mesgul'|'indirildi'|'erken'|'cok-sik'|'guncel'|'yeni'|'hata', surum?: string, neden?: string, bildirimGerek?: boolean}>}
   */
  function denetle({ elle = false } = {}) {
    if (!acikMi()) return Promise.resolve({ sonuc: 'kapali' });
    if (destekMi() !== 'tamam') return Promise.resolve({ sonuc: 'desteklenmiyor', neden: destekMi() });
    if (bekleyen) return bekleyen;
    if (durum === 'indiriliyor' || durum === 'kuruluyor') return Promise.resolve({ sonuc: 'mesgul' });
    if (durum === 'indirildi') return Promise.resolve({ sonuc: 'indirildi', surum: bilgi?.surum });
    const t = simdi();
    const d = kayitAl();
    if (elle) {
      if (sonElle > 0 && t >= sonElle && t - sonElle < ELLE_ARALIK_MS) return Promise.resolve({ sonuc: 'cok-sik' });
      sonElle = t;
    } else if (d.sonDenetim > 0 && t >= d.sonDenetim && t - d.sonDenetim < DENETIM_ARALIGI_MS) {
      return Promise.resolve({ sonuc: 'erken' });
    }
    d.sonDenetim = t; // deneme başarısız olsa da yazılır: günde en çok bir otomatik istek
    kayitYaz();
    durum = 'denetleniyor';
    hata = null;
    yay();
    bekleyen = (async () => {
      try {
        return await denetimYap();
      } finally {
        bekleyen = null;
      }
    })();
    return bekleyen;
  }

  /** Kullanıcı "İndir" dedi. Yalnız doğrulanmış bir "yeni sürüm" bilgisi varken; seçenek kapandıysa indirilmez. */
  async function indir() {
    if (!acikMi()) return { sonuc: 'kapali' };
    if (destekMi() !== 'tamam') return { sonuc: 'desteklenmiyor', neden: destekMi() };
    if (durum === 'indirildi') return { sonuc: 'indirildi', surum: bilgi?.surum };
    if (durum !== 'yeni' || !bilgi) return { sonuc: 'gecersiz' };
    const hedef = bilgi;
    durum = 'indiriliyor';
    ilerleme = 0;
    hata = null;
    indirilenDosya = null;
    yay();
    let yollar;
    try {
      yollar = await ayarla().downloadUpdate();
    } catch (h) {
      const neden = hataSinifla(h);
      hataya(neden, 'yeni');
      return { sonuc: 'hata', neden };
    }
    const dosya = indirilenDosya ?? (Array.isArray(yollar) ? yollar[0] : null);
    const dogrulandi = await indirileniDogrula(dosya, hedef);
    if (dogrulandi !== true) {
      indirilenDosya = null;
      hataya(dogrulandi, 'yeni');
      return { sonuc: 'hata', neden: dogrulandi };
    }
    indirilenDosya = dosya;
    ilerleme = 100;
    durum = 'indirildi';
    hata = null;
    gunluk(`Güncelleme indirildi ve doğrulandı (${hedef.surum}).`);
    yay();
    return { sonuc: 'indirildi', surum: hedef.surum };
  }

  /** İndirilen dosya doğrulanmış bilgiyle birebir uyuşmalı: ad, boyut ve sha512. true ya da hata nedeni döner. */
  async function indirileniDogrula(dosya, hedef) {
    if (typeof dosya !== 'string' || dosya === '') return 'indirme';
    if (nodePath.basename(dosya).toLowerCase() !== hedef.dosyaAdi.toLowerCase()) return 'ozet';
    let ozet;
    try {
      ozet = await dosyaOzeti(dosya);
    } catch {
      return 'ozet';
    }
    if (!ozet || ozet.boyut !== hedef.boyut || !ozetlerEsitMi(ozet.sha512, hedef.sha512)) return 'ozet';
    return true;
  }

  /** Kullanıcı kurulumu onayladı (onay penceresi ana süreçte gösterilir). Dosya KURMADAN hemen önce yeniden doğrulanır. */
  async function kur() {
    if (!acikMi()) return { sonuc: 'kapali' };
    if (destekMi() !== 'tamam') return { sonuc: 'desteklenmiyor', neden: destekMi() };
    if (durum !== 'indirildi' || !bilgi || !indirilenDosya) return { sonuc: 'gecersiz' };
    const hedef = bilgi;
    durum = 'kuruluyor';
    hata = null;
    yay();
    const dogrulandi = await indirileniDogrula(indirilenDosya, hedef);
    if (dogrulandi !== true) {
      indirilenDosya = null;
      hataya(dogrulandi, 'yeni');
      return { sonuc: 'hata', neden: dogrulandi };
    }
    try {
      kurulumaHazirlan();
      guncelleyici.quitAndInstall(true, true); // sessiz kurulum, bitince uygulama yeniden açılır
    } catch {
      try {
        kurulumuBirak();
      } catch {
        /* geri alınamadı */
      }
      hataya('kurulum', 'indirildi');
      return { sonuc: 'hata', neden: 'kurulum' };
    }
    // quitAndInstall hata vermeden de başarısız olabilir (yükleyici başlatılamadı): uygulama kapanmadıysa durum geri alınır.
    const sayac = zamanlayici(() => {
      if (durum !== 'kuruluyor') return;
      try {
        kurulumuBirak();
      } catch {
        /* geri alınamadı */
      }
      hataya('kurulum', 'indirildi');
    }, KURULUM_BEKLEME_MS);
    if (typeof sayac?.unref === 'function') sayac.unref();
    return { sonuc: 'kuruluyor', surum: hedef.surum };
  }

  return {
    denetle,
    indir,
    kur,
    durum: gorunum,
    /** Seçenek kapandı: bellekteki sürüm bilgisi atılır (kapalıyken indirilmiş dosya kurulmaz). */
    kapandi() {
      if (durum === 'indiriliyor' || durum === 'kuruluyor') return;
      bilgi = null;
      hata = null;
      ilerleme = 0;
      indirilenDosya = null;
      durum = 'bosta';
      yay();
    },
    /** Bu sürüm için bildirim gösterildi (aynı sürüm için bir daha bildirilmez). */
    bildirildi(surum) {
      const s = surumAyristir(surum);
      if (!s) return;
      kayitAl().bildirilen = surumMetniOn(s);
      kayitYaz();
    },
  };
}

module.exports = {
  DURUM_DOSYASI,
  KULLANICI_AJANI,
  HAZIRLAMA_BASLIGI,
  EN_BUYUK_KURUCU,
  KURULUM_BEKLEME_MS,
  destekDurumu,
  dosyaAdiGecerliMi,
  bilgiyiDogrula,
  dosyaSha512,
  ozetlerEsitMi,
  hataSinifla,
  guncellemeYoneticisiOlustur,
};
