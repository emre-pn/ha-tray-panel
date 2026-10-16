'use strict';

/**
 * `--durum` / `--liste` komutları (o-19; saf, Electron'a bağlı değildir): durum belgesi ve güvenli çıktı dosyası.
 *
 * Belge yalnız uygulamanın kendi güvenli modelinden gelir (yuzey-modeli.js karoları: kapı kuralı, GÜNCEL ad süzgeci ve sınıflama
 * zaten uygulanmıştır). Erişim anahtarı, adres (yalnız sınıfı: 'yerel' | 'dis' | 'yok'), webhook kimliği, ham öznitelik ve HA'daki
 * ham durum metni belgeye HİÇ girmez. Betikler dosyayı okur; ağ yoktur.
 *
 * Çıktı yolu (ciktiYoluCoz) komut satırından geldiği için dardır: kullanıcı klasörünün içinde bir .json dosyası olmalı; uygulamanın
 * kendi veri klasörü (ayarlar, anahtar, oturum) ve kurulum klasörü yasaktır. Yazma önce geçici dosyaya, sonra yeniden adlandırmayla
 * yapılır (okuyan betik yarım dosya görmez); var olan hedef düz bir dosya değilse (klasör, sembolik bağ) ya da kendi durum belgemiz
 * değilse (başka bir .json dosyası) yazılmaz; yalnız boş dosya ve önceki durum belgesi (`bicim: "ev-paneli-durum"`) ezilir.
 */

const nodeFs = require('node:fs');
const nodePath = require('node:path');

const BELGE_BICIMI = 'ev-paneli-durum';
const BELGE_SURUMU = 1;
const CIKTI_EN_COK_UZUNLUK = 260; // Windows MAX_PATH
const ESKI_BELGE_EN_COK_BAYT = 1024 * 1024; // 200 karoluk --liste belgesi onlarca KB'tır; bundan büyük bir hedef bizim belgemiz değildir
const EN_COK_KARO = 200;
const AD_SINIRI = 40;
const DURUMLAR = Object.freeze(['acik', 'kapali', 'notr', 'yok']);
const BAGLANTI_TURLERI = Object.freeze(['yerel', 'dis']);
const PENCERE_DURUMLARI = Object.freeze(['gorunur', 'gizli', 'yok']);

const sinirliMetin = (d, n) => (typeof d === 'string' ? d.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim().slice(0, n) : '');

/**
 * Durum belgesi. Tür 'liste' ise favori karoları da eklenir. Girdi karoları zaten güvenli süzülmüştür (yuzey-modeli.js karolariOlustur);
 * burada yalnız beyaz listedeki alanlar kopyalanır.
 * @param {object} g
 * @param {boolean} g.liste favori listesi de yazılsın mı (--liste)
 * @param {Date} g.simdi
 * @param {string} [g.uygulamaSurumu]
 * @param {'yerel'|'dis'|null} [g.baglantiTuru] HA'ya şu an erişilen adresin SINIFI (adresin kendisi değil)
 * @param {boolean} [g.canli] WebSocket canlı mı
 * @param {boolean} [g.anahtarVar] erişim anahtarı eklenmiş mi (değeri değil)
 * @param {'gorunur'|'gizli'|'yok'} [g.anaPencere]
 * @param {{id:string, etiket:string, alan:string, durum:string, yuzde:number|null, kullanilabilir:boolean, sinif:string}[]} [g.karolar]
 */
function durumBelgesiOlustur({ liste = false, simdi, uygulamaSurumu = '', baglantiTuru = null, canli = false, anahtarVar = false, anaPencere = 'yok', karolar = [] }) {
  const guvenli = (Array.isArray(karolar) ? karolar : []).filter((k) => k && typeof k.id === 'string').slice(0, EN_COK_KARO);
  const belge = {
    bicim: BELGE_BICIMI,
    surum: BELGE_SURUMU,
    tur: liste ? 'liste' : 'durum',
    zaman: (simdi instanceof Date ? simdi : new Date()).toISOString(),
    uygulama: { surum: sinirliMetin(uygulamaSurumu, 20) },
    baglanti: {
      tur: BAGLANTI_TURLERI.includes(baglantiTuru) ? baglantiTuru : 'yok',
      canli: canli === true,
      anahtarVar: anahtarVar === true,
    },
    pencere: { ana: PENCERE_DURUMLARI.includes(anaPencere) ? anaPencere : 'yok' },
    favoriSayisi: guvenli.length,
    acikIsikSayisi: guvenli.filter((k) => k.alan === 'light' && k.durum === 'acik').length,
  };
  if (liste) {
    belge.favoriler = guvenli.map((k) => ({
      kimlik: sinirliMetin(k.id, 100),
      ad: sinirliMetin(k.etiket, AD_SINIRI),
      alan: sinirliMetin(k.alan, 40),
      durum: DURUMLAR.includes(k.durum) ? k.durum : 'yok',
      yuzde: Number.isInteger(k.yuzde) && k.yuzde >= 0 && k.yuzde <= 100 ? k.yuzde : null,
      kullanilabilir: k.kullanilabilir === true,
      onayli: k.sinif === 'yikici',
    }));
  }
  return belge;
}

/** `ic` yolu `dis` klasörünün İÇİNDE mi (eşit değil)? Windows'ta büyük/küçük harf ayrımı path.relative'de yoktur. */
function icindeMi(ic, dis, path) {
  const goreli = path.relative(dis, ic);
  return goreli !== '' && !goreli.startsWith('..') && !path.isAbsolute(goreli);
}

/**
 * Komut satırı çıktı yolunu güvenli bir mutlak yola çözer.
 * @param {unknown} ham `--cikti` değeri
 * @param {{ dizin?: string|null, ev: string, yasakKlasorler?: string[], path?: typeof nodePath }} secenek
 *   dizin: komutu veren kopyanın çalışma klasörü (göreli yol için; yoksa kullanıcı klasörü); ev: kullanıcı klasörü;
 *   yasakKlasorler: yazılamayacak klasörler (veri klasörü, kurulum klasörü)
 * @returns {{ok: true, yol: string} | {ok: false, neden: 'gerekli'|'gecersiz'}}
 */
function ciktiYoluCoz(ham, { dizin = null, ev, yasakKlasorler = [], path = nodePath } = {}) {
  if (typeof ham !== 'string' || ham.trim() === '') return { ok: false, neden: 'gerekli' };
  if (ham.length > CIKTI_EN_COK_UZUNLUK || /[\u0000-\u001F\u007F-\u009F<>"|?*]/.test(ham)) return { ok: false, neden: 'gecersiz' };
  if (typeof ev !== 'string' || ev === '' || !path.isAbsolute(ev)) return { ok: false, neden: 'gecersiz' };
  const taban = typeof dizin === 'string' && dizin !== '' && path.isAbsolute(dizin) ? dizin : ev;
  const yol = path.resolve(taban, ham.trim());
  if (yol.length > CIKTI_EN_COK_UZUNLUK) return { ok: false, neden: 'gecersiz' };
  if (path.extname(yol).toLowerCase() !== '.json') return { ok: false, neden: 'gecersiz' };
  const kok = path.parse(yol).root;
  if (yol.slice(kok.length).includes(':')) return { ok: false, neden: 'gecersiz' }; // NTFS alternatif veri akışı (dosya.json:akış)
  if (!icindeMi(yol, path.resolve(ev), path)) return { ok: false, neden: 'gecersiz' };
  for (const yasak of yasakKlasorler) {
    if (typeof yasak !== 'string' || yasak === '') continue;
    const k = path.resolve(yasak);
    if (yol === k || icindeMi(yol, k, path)) return { ok: false, neden: 'gecersiz' };
  }
  return { ok: true, yol };
}

/** Var olan hedef, bu uygulamanın daha önce yazdığı bir durum belgesi mi (`bicim` alanı)? Okunamayan, çok büyük ya da başka JSON → hayır. */
function oncekiDurumBelgesiMi(yol, durum, fs) {
  try {
    if (durum.size > ESKI_BELGE_EN_COK_BAYT) return false;
    const d = JSON.parse(fs.readFileSync(yol, 'utf8').replace(/^﻿/, ''));
    return d !== null && typeof d === 'object' && !Array.isArray(d) && d.bicim === BELGE_BICIMI;
  } catch {
    return false;
  }
}

/**
 * Belgeyi atomik yazar: aynı klasörde geçici dosya, sonra yeniden adlandırma. Klasör yoksa oluşturulmaz. Var olan hedef düz dosya
 * değilse (klasör, sembolik bağ), hedef klasörün gerçek yolu kullanıcı klasörü dışına çıkıyorsa (bağlantı noktası) ya da hedef boş
 * olmayan, durum belgesi olmayan bir dosyaysa ('baska-dosya') yazılmaz.
 * @returns {{ok: true} | {ok: false, neden: 'klasor'|'dosya-degil'|'baska-dosya'|'yazilamadi'}}
 */
function durumDosyasiYaz(yol, belge, { fs = nodeFs, path = nodePath, ev = null, yasakKlasorler = [], pid = process.pid } = {}) {
  const metin = `${JSON.stringify(belge, null, 2)}\n`;
  const klasor = path.dirname(yol);
  const gecici = path.join(klasor, `.${path.basename(yol)}.${pid}.tmp`);
  try {
    if (!fs.statSync(klasor).isDirectory()) return { ok: false, neden: 'klasor' };
    if (ev) {
      const gercekKlasor = fs.realpathSync(klasor);
      if (gercekKlasor !== fs.realpathSync(ev) && !icindeMi(gercekKlasor, fs.realpathSync(ev), path)) return { ok: false, neden: 'klasor' };
      for (const yasak of yasakKlasorler) {
        let gercekYasak;
        try {
          gercekYasak = fs.realpathSync(yasak);
        } catch {
          continue; // yasak klasör yoksa içine yazılamaz zaten
        }
        if (gercekKlasor === gercekYasak || icindeMi(gercekKlasor, gercekYasak, path)) return { ok: false, neden: 'klasor' };
      }
    }
    let mevcut = null;
    try {
      mevcut = fs.lstatSync(yol);
    } catch (hata) {
      if (hata?.code !== 'ENOENT') throw hata;
    }
    if (mevcut && !mevcut.isFile()) return { ok: false, neden: 'dosya-degil' };
    // Yalnız boş bir dosyanın ya da önceki bir durum belgesinin üzerine yazılır: `--cikti` kullanıcının başka bir .json dosyasını
    // (ayar yedeği, VS Code ayarı, paket dosyası) sessizce ezemez.
    if (mevcut && mevcut.size > 0 && !oncekiDurumBelgesiMi(yol, mevcut, fs)) return { ok: false, neden: 'baska-dosya' };
    fs.writeFileSync(gecici, metin, { encoding: 'utf8', flag: 'w' });
    try {
      fs.renameSync(gecici, yol);
    } catch (hata) {
      try {
        fs.unlinkSync(gecici);
      } catch {
        // geçici dosya zaten yok
      }
      throw hata;
    }
    return { ok: true };
  } catch {
    return { ok: false, neden: 'yazilamadi' };
  }
}

module.exports = {
  BELGE_BICIMI,
  BELGE_SURUMU,
  CIKTI_EN_COK_UZUNLUK,
  EN_COK_KARO,
  durumBelgesiOlustur,
  ciktiYoluCoz,
  durumDosyasiYaz,
};
