'use strict';

/**
 * Klasör eşitleme testleri için SAHTE ortam (o-58): gerçek geçici klasör, bellek içi parola deposu, sahte zamanlayıcı/saat/izleyici.
 * İki "bilgisayar" aynı klasörü paylaşır (Dropbox/Syncthing gibi); ağ, Electron ve gerçek ayar klasörü yoktur.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { ayarlariDuzelt } = require('../src/lib/ayar-sema');
const { esitlemeYoneticisiOlustur } = require('../src/esitleme-yoneticisi');
const { DOSYA_ADI } = require('../src/lib/ayar-esitleme');
const VARSAYILAN = require('../varsayilan-ayarlar.json');

const BASLANGIC = 1_800_000_000_000;

const ayarlarYap = (ek = {}) => ayarlariDuzelt({ ...VARSAYILAN, ...ek }, { varsayilan: VARSAYILAN }).ayarlar;

function geciciKlasor(onek = 'esitleme-') {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), onek));
  return { klasor, temizle: () => fs.rmSync(klasor, { recursive: true, force: true }) };
}

/** Bellek içi parola deposu (safeStorage karşılığı); `sifrelemeVar: false` şifreleme kullanılamıyor durumunu verir. */
function sahteParolaDeposu({ sifrelemeVar = true } = {}) {
  let deger = null;
  return {
    varMi: () => deger !== null,
    kullanilabilirMi: async () => sifrelemeVar,
    anahtarAl: async () => deger,
    yaz: async (p) => {
      deger = p;
    },
    sil: async () => {
      deger = null;
      return { silindi: true };
    },
    oku: () => deger,
  };
}

/** Sahte zamanlayıcılar: bekleyen işler elle tetiklenir. */
function sahteZaman(saat = { t: 0 }) {
  const isler = new Map();
  let sayac = 0;
  const tut = (f, ms, tekrarli) => {
    sayac += 1;
    const kimlik = sayac;
    isler.set(kimlik, { f, ms, tekrarli });
    return { kimlik, unref() {} };
  };
  return {
    setTimeout: (f, ms) => tut(f, ms, false),
    clearTimeout: (t) => {
      if (t) isler.delete(t.kimlik);
    },
    setInterval: (f, ms) => tut(f, ms, true),
    clearInterval: (t) => {
      if (t) isler.delete(t.kimlik);
    },
    bekleyenler: () => [...isler.values()].map((i) => ({ ms: i.ms, tekrarli: i.tekrarli })),
    zamanlayiciSayisi: () => [...isler.values()].filter((i) => !i.tekrarli).length,
    aralikSayisi: () => [...isler.values()].filter((i) => i.tekrarli).length,
    /** Bekleyen tek seferlik işleri çalıştırır ve tamamlanmasını bekler. */
    async tetikle() {
      saat.t += 5000; // eşitleme alt aralığı (EN_AZ_ARALIK_MS) beklemesi sahte saatte takılmasın
      const bekleyen = [...isler.entries()].filter(([, i]) => !i.tekrarli);
      for (const [kimlik, is] of bekleyen) {
        isler.delete(kimlik);
        await is.f();
      }
      await new Promise((coz) => setImmediate(coz));
    },
    async araliklariTetikle() {
      saat.t += 5000;
      for (const is of [...isler.values()].filter((i) => i.tekrarli)) await is.f();
      await new Promise((coz) => setImmediate(coz));
    },
  };
}

/** Sahte fs.watch: geri çağrılar elle tetiklenir. */
function sahteIzleyici() {
  const kayitlar = [];
  const izle = (klasor, secenek, geriCagri) => {
    const kayit = { klasor, secenek, geriCagri, kapali: false, hataDinleyicileri: [] };
    kayitlar.push(kayit);
    return {
      close: () => {
        kayit.kapali = true;
      },
      on: (olay, f) => {
        if (olay === 'error') kayit.hataDinleyicileri.push(f);
      },
    };
  };
  izle.kayitlar = kayitlar;
  izle.acik = () => kayitlar.filter((k) => !k.kapali);
  izle.olay = (ad = DOSYA_ADI) => {
    for (const k of kayitlar.filter((x) => !x.kapali)) k.geriCagri('change', ad);
  };
  return izle;
}

/**
 * Bir "bilgisayar" kurar.
 * @param {object} bag
 * @param {string} bag.klasor ortak eşitleme klasörü
 * @param {string} bag.aygit bu bilgisayarın yerel durum kaydındaki aygit kimliği (verilirse esitlemeDurumu.aygit olarak yazılır)
 * @param {boolean} [bag.yerelDegistiBagli] true: ayar yazımı (içe aktarma dahil) main.js ayarlariYaz gibi yonetici.yerelDegisti() çağırır
 */
function bilgisayarKur({ klasor, aygit = null, ayarEk = {}, acik = true, saat = { t: BASLANGIC }, parolaDeposu = sahteParolaDeposu(), yasak = [], secilecekKlasor = klasor, fsOzel = null, yerelDegistiBagli = false }) {
  const ayarlar = ayarlarYap({
    ...(acik ? { klasorEsitleme: true, esitlemeKlasoru: klasor } : { esitlemeKlasoru: klasor }),
    ...(aygit ? { esitlemeDurumu: { aygit } } : {}),
    ...ayarEk,
  });
  // iceAktarSirasinda(ayarlar): içe aktarma sürerken (ör. kullanıcının Ayarlar'da yaptığı) başka bir değişikliği taklit eder
  const durum = { ayarYazimi: 0, iceAktar: [], yedek: 0, gunluk: [], degisti: 0, uygulandi: [], iceAktarHatasi: false, iceAktarSirasinda: null, diyalog: secilecekKlasor, hata: null };
  const zaman = sahteZaman(saat);
  const izle = sahteIzleyici();
  const yazildi = () => {
    durum.ayarYazimi += 1;
    if (yerelDegistiBagli) yonetici.yerelDegisti();
    return true;
  };
  const yonetici = esitlemeYoneticisiOlustur({
    ayarlarAl: () => ayarlar,
    ayarlariYaz: yazildi,
    iceAktar: async (cozum) => {
      durum.iceAktar.push(JSON.parse(JSON.stringify(cozum.ayarlar)));
      if (durum.iceAktarHatasi) return { ok: false, hata: 'sahte hata' };
      for (const [alan, deger] of Object.entries(cozum.ayarlar)) ayarlar[alan] = JSON.parse(JSON.stringify(deger));
      if (durum.iceAktarSirasinda) durum.iceAktarSirasinda(ayarlar);
      if (yerelDegistiBagli) yazildi(); // main.js ayarlariIceAktarUygula ayarları ayarlariYaz ile yazar
      return { ok: true };
    },
    varsayilanAl: () => VARSAYILAN,
    parolaDeposu,
    klasorSecDiyalogu: async () => durum.diyalog,
    yasakKlasorler: () => yasak,
    yedekAl: async () => {
      durum.yedek += 1;
    },
    degisti: () => {
      durum.degisti += 1;
    },
    uygulandi: (adlar) => durum.uygulandi.push([...adlar]),
    fsp: fsOzel ?? fsp,
    izle,
    zaman,
    simdi: () => saat.t,
    // Her bilgisayarın kimliği/tuzu deterministik olmasın diye gerçek rastgele kullanılır (varsayılan).
    t: (anahtar) => anahtar,
    gunluk: (m) => durum.gunluk.push(m),
  });
  return {
    ayarlar,
    durum,
    yonetici,
    zaman,
    izle,
    saat,
    parolaDeposu,
    /** Eşitler (saat 5 sn ilerler: alt aralık beklemesi olmasın). */
    async esitle(secenek = {}) {
      saat.t += 5000;
      return yonetici.esitle({ elle: false, ...secenek });
    },
    ilerle(ms) {
      saat.t += ms;
    },
    dosyaYolu: () => path.join(klasor, DOSYA_ADI),
    dosyaOku: () => fs.readFileSync(path.join(klasor, DOSYA_ADI), 'utf8'),
    dosyaVarMi: () => fs.existsSync(path.join(klasor, DOSYA_ADI)),
  };
}

module.exports = { BASLANGIC, ayarlarYap, geciciKlasor, sahteParolaDeposu, sahteZaman, sahteIzleyici, bilgisayarKur, VARSAYILAN };
