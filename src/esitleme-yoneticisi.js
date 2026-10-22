'use strict';

/**
 * Klasör tabanlı ayar eşitleme yöneticisi (1.4.0, bağlantı grubu: o-58). Kullanıcının seçtiği yerel klasörde (Dropbox, OneDrive, Syncthing,
 * ağ sürücüsü...) tek bir JSON dosyası tutar; birden çok bilgisayarın ayarları BÖLÜM bölüm, zaman damgasıyla birleşir. Çekirdek mantık
 * src/lib/ayar-esitleme.js'tedir (saf); bu dosya dosya sistemi, izleme, zamanlama, parola deposu ve IPC işini yapar.
 *
 * Güvence
 *  - Uygulama dışarıya YALNIZ yerel klasöre yazar; ağa çıkmaz (bulut hizmeti kullanıcının kendi eşitleme istemcisidir). Seçenek VARSAYILAN KAPALI,
 *    dışa/içe aktarmaya girmez; klasörü yalnız ana süreç diyalogu seçer (arayüz yol veremez), uygulamanın kendi veri klasörleri yasaktır.
 *  - Klasördeki dosya GÜVENİLMEZ girdi sayılır: boyut sınırı, JSON/şema doğrulaması, bölüm beyaz listesi, kapı/kilit süzgeci (içe aktarma ile aynı
 *    hat: ayarYedeginiCoz), 24 saatten ileri damgaların reddi; JWT benzeri değer içeren dosya okunmaz/yazılmaz. HA adresleri ve sırlar bölümlerde yoktur.
 *  - Parola (isteğe bağlı) yalnız safeStorage deposundadır (esitleme-parola.dat); dosyaya, günlüğe, hata iletisine ve arayüz yanıtlarına girmez.
 *    Günlüğe yalnız sabit metin ve sayılar yazılır (klasör yolu bile yazılmaz: kullanıcı adı içerebilir).
 *  - Hata durumunda başka bilgisayarın verisi ezilmez: okunamayan/parolası uyuşmayan/daha yeni sürümden gelen ANA dosyaya yazılmaz.
 *  - IPC işleyicileri yalnız Ayarlar penceresinden gelen çağrıyı kabul eder (baglanti-yoneticisi.js ipcKaydet `ek` listesi: ayarlardan(olay) koruması).
 */

const path = require('node:path');
const crypto = require('node:crypto');
const { AKTARIM_BAYT_SINIRI } = require('./lib/ayar-yedegi');
const { BOLUM_ADLARI, bolumListesiDuzelt } = require('./lib/esitleme-bolumleri');
const { sifreleyiciOlustur, parolaGecerliMi } = require('./lib/esitleme-sifre');
const {
  DOSYA_ADI,
  GECICI_ONEK,
  EN_COK_ADAY,
  ozetle,
  aygitUret,
  bolumAnlik,
  uzakBolumTemizle,
  dosyayiCoz,
  dosyaMetni,
  belgeleriBirlestir,
  bolumKarari,
  klasorDogrula,
  adayAdlari,
  kararliYaz,
} = require('./lib/ayar-esitleme');

const DEGISIKLIK_BEKLEME_MS = 3000; // yerel ayar değişti: kısa süre sonra tek eşitleme
const KLASOR_OLAYI_BEKLEME_MS = 2000; // klasörde değişiklik: bulut istemcisi dosyayı yazıp bitirsin
const ACILIS_BEKLEME_MS = 4000;
const YOKLAMA_MS = 60_000; // izleme kaçırırsa (ağ sürücüsü, uyku) klasör imzası dakikada bir yoklanır
const EN_AZ_ARALIK_MS = 1500; // iki eşitleme arası alt sınır (kendi yazdığımızın yankısı döngü kurmasın)
const OLAY_PENCERESI_MS = 1000; // izleyici olay fırtınası denetimi (izlenen klasör silinince Windows'ta sonsuz olay gelir)
const EN_COK_OLAY = 200; // bir pencerede bu kadar olaydan fazlası fırtına sayılır ve izleyici bırakılır

/** Ana dosyada bu nedenlerle yazılmaz: başka bilgisayarın verisi ezilmesin. */
const YAZMAYI_ENGELLEYEN = new Set(['parola-gerekli', 'parola-yanlis', 'daha-yeni', 'cok-buyuk', 'gizli-deger']);

const duzNesne = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/**
 * @param {object} bag
 * @param {() => object} bag.ayarlarAl canlı ayar nesnesi
 * @param {() => boolean} bag.ayarlariYaz ayarlar.json'a yazar
 * @param {(cozum: object) => Promise<{ok: boolean, hata?: string}>} bag.iceAktar doğrulanmış (bölüm) ayarlarını uygular (main.js ayarlariIceAktarUygula)
 * @param {() => object} bag.varsayilanAl varsayilan-ayarlar.json içeriği
 * @param {{varMi: () => boolean, kullanilabilirMi: () => Promise<boolean>, anahtarAl: () => Promise<string|null>, yaz: (s: string) => Promise<void>, sil: () => Promise<unknown>}} bag.parolaDeposu
 * @param {() => Promise<string|null>} bag.klasorSecDiyalogu ana süreç klasör diyalogu; seçilen yol ya da null (vazgeçildi)
 * @param {() => string[]} [bag.yasakKlasorler] eşitleme klasörü olamayacak klasörler (uygulamanın veri ve kurulum klasörleri)
 * @param {() => Promise<void>} [bag.yedekAl] klasörden ilk kez ayar alınmadan önce ayarlar.json'ın kopyası
 * @param {() => void} [bag.degisti] durum değişti (açık Ayarlar sayfasına haber)
 * @param {(adlar: string[]) => void} [bag.uygulandi] klasörden gelen bölümler uygulandı
 */
function esitlemeYoneticisiOlustur({
  ayarlarAl,
  ayarlariYaz,
  iceAktar,
  varsayilanAl,
  parolaDeposu,
  klasorSecDiyalogu,
  yasakKlasorler = () => [],
  yedekAl = async () => {},
  degisti = () => {},
  uygulandi = () => {},
  fsp = require('node:fs/promises'),
  izle = require('node:fs').watch,
  zaman = { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id), setInterval: (f, ms) => globalThis.setInterval(f, ms), clearInterval: (id) => globalThis.clearInterval(id) },
  simdi = () => Date.now(),
  rastgele = crypto.randomBytes,
  sifreleyici = sifreleyiciOlustur({ rastgele }),
  t = (anahtar) => anahtar,
  gunluk = () => {},
}) {
  let asama = 'kapali'; // 'kapali' | 'bekliyor' | 'esitleniyor' | 'tamam' | 'hata'
  let neden = null;
  let son = null; // { zaman, uygulanan, yazilan } (sayılar)
  let calisan = null;
  let tekrar = false;
  let planliZamanlayici = null;
  let yoklamaZamanlayici = null;
  let izleyici = null;
  let izlenenKlasor = '';
  let olayPenceresiBasi = 0; // izleyici olay fırtınası denetimi: pencerenin başlangıcı ve içindeki olay sayısı
  let olaySayisi = 0;
  let sonImza = '';
  let sonCalisma = 0;
  let sonYerelKilit = null;
  let kendiUygulamamiz = false; // klasörden gelen bölüm şu an uygulanıyor: bu sırada gelen yerelDegisti kendi yazımımızın yankısıdır
  let yedekGerekli = false; // eşitleme yeni açıldı: klasörden ilk uygulamadan önce ayar yedeği alınır
  let yedekAlindi = false; // yedek bu açma döneminde alındı (her uygulamada tekrarlanmaz)
  const uygulanamayan = new Map(); // bölüm -> reddedilen uzak damga (aynı sürüm tekrar tekrar denenmez)

  const gunlugeYaz = (mesaj) => {
    try {
      gunluk(mesaj);
    } catch {
      /* günlük hatası eşitlemeyi durdurmaz */
    }
  };
  const haberVer = () => {
    try {
      degisti();
    } catch {
      /* arayüz haberi eşitlemeyi durdurmaz */
    }
  };
  const bekle = (ms) => new Promise((coz) => zaman.setTimeout(coz, ms));

  const ayar = () => ayarlarAl() ?? {};
  const etkinMi = () => {
    const a = ayar();
    return a.klasorEsitleme === true && typeof a.esitlemeKlasoru === 'string' && a.esitlemeKlasoru !== '';
  };
  const seciliBolumler = () => {
    const a = ayar();
    return bolumListesiDuzelt(a.esitlemeBolumleri) ?? [...BOLUM_ADLARI];
  };

  // ---- Zamanlama ve izleme ----------------------------------------------------------------------------------------------------------

  function planla(ms) {
    if (!etkinMi()) return;
    zaman.clearTimeout(planliZamanlayici);
    planliZamanlayici = zaman.setTimeout(() => {
      planliZamanlayici = null;
      return esitle({}).catch(() => {});
    }, ms);
    planliZamanlayici?.unref?.();
  }

  function izlemeyiBirak() {
    zaman.clearTimeout(planliZamanlayici);
    planliZamanlayici = null;
    if (yoklamaZamanlayici !== null) zaman.clearInterval(yoklamaZamanlayici);
    yoklamaZamanlayici = null;
    if (izleyici) {
      try {
        izleyici.close();
      } catch {
        /* zaten kapalı */
      }
    }
    izleyici = null;
    izlenenKlasor = '';
    sonImza = '';
  }

  /** Belirli izleyiciyi kapatır (hâlâ geçerli izleyiciyse durum sıfırlanır). */
  function izleyiciyiBirak(hedef) {
    try {
      hedef.close();
    } catch {
      /* zaten kapalı */
    }
    if (izleyici === hedef) {
      izleyici = null;
      izlenenKlasor = '';
    }
  }

  function klasoruIzle() {
    const klasor = ayar().esitlemeKlasoru;
    if (izleyici && izlenenKlasor === klasor) return;
    if (izleyici) {
      try {
        izleyici.close();
      } catch {
        /* zaten kapalı */
      }
      izleyici = null;
    }
    izlenenKlasor = klasor;
    olayPenceresiBasi = 0;
    olaySayisi = 0;
    try {
      const yeni = izle(klasor, { persistent: false }, (_olay, ad) => {
        if (izleyici !== yeni) return; // bırakılmış izleyicinin kuyruktaki olayları
        if (typeof ad === 'string' && ad !== '' && ad.startsWith(GECICI_ONEK)) return; // kendi geçici dosyamız
        // Windows'ta izlenen klasörün KENDİSİ silinince ya da yeniden adlandırılınca Node, dosya adı yerine klasörün tam yolunu veren
        // sonsuz "rename" olayı üretir (saniyede yüzbinlerce; işlemci %100 olur). Yol benzeri ad ya da olay fırtınası görülürse izleyici
        // hemen bırakılır; klasör dönerse 60 sn'lik yoklama yeniden kurar. Bir kez de eşitleme planlanır ("klasör yok" durumu görünsün).
        const simdikiZaman = simdi();
        if (simdikiZaman - olayPenceresiBasi > OLAY_PENCERESI_MS) {
          olayPenceresiBasi = simdikiZaman;
          olaySayisi = 0;
        }
        olaySayisi += 1;
        if ((typeof ad === 'string' && /[\\/]/.test(ad)) || olaySayisi > EN_COK_OLAY) {
          izleyiciyiBirak(yeni);
          planla(KLASOR_OLAYI_BEKLEME_MS);
          return;
        }
        planla(KLASOR_OLAYI_BEKLEME_MS);
      });
      yeni.on?.('error', () => {
        if (izleyici === yeni) {
          try {
            yeni.close();
          } catch {
            /* zaten kapalı */
          }
          izleyici = null;
          izlenenKlasor = '';
        }
      });
      izleyici = yeni;
    } catch {
      izleyici = null;
      izlenenKlasor = '';
    }
  }

  /** Klasördeki aday dosyaların adı + boyut + değişim zamanı: değişiklik yoklaması için. */
  async function klasorImzasi() {
    const klasor = ayar().esitlemeKlasoru;
    try {
      const adlar = adayAdlari(await fsp.readdir(klasor)).slice(0, EN_COK_ADAY * 2);
      const parcalar = [];
      for (const ad of adlar) {
        try {
          const b = await fsp.stat(path.join(klasor, ad));
          parcalar.push(`${ad}:${b.size}:${Math.round(b.mtimeMs)}`);
        } catch {
          parcalar.push(`${ad}:?`);
        }
      }
      return parcalar.join('|');
    } catch {
      return 'yok';
    }
  }

  function yoklamayiKur() {
    if (yoklamaZamanlayici !== null) return;
    yoklamaZamanlayici = zaman.setInterval(async () => {
      if (!etkinMi() || calisan) return;
      klasoruIzle(); // izleyici düşmüşse yeniden kurulur
      const imza = await klasorImzasi();
      if (imza !== sonImza || asama === 'hata' || yerelKilit() !== sonYerelKilit) {
        sonImza = imza;
        await esitle({}).catch(() => {});
      }
    }, YOKLAMA_MS);
    yoklamaZamanlayici?.unref?.();
  }

  function izlemeyiBaslat() {
    klasoruIzle();
    yoklamayiKur();
  }

  // ---- Eşitleme -----------------------------------------------------------------------------------------------------------------------

  /** Yerel ayar kaydı: aygit kimliği garanti edilir. */
  function yerelKayit() {
    const a = ayar();
    const kayit = duzNesne(a.esitlemeDurumu) ? a.esitlemeDurumu : {};
    return { aygit: typeof kayit.aygit === 'string' && kayit.aygit !== '' ? kayit.aygit : aygitUret(rastgele), bolumler: { ...(duzNesne(kayit.bolumler) ? kayit.bolumler : {}) } };
  }

  async function parolaOku() {
    if (!parolaDeposu.varMi()) return { parola: null };
    try {
      const parola = await parolaDeposu.anahtarAl();
      return parola ? { parola } : { hata: 'parola-okunamadi' };
    } catch {
      return { hata: 'parola-okunamadi' };
    }
  }

  /** Klasördeki aday dosyaları okur ve çözer. @returns {Promise<{belgeler: object[], ana: object, sorunlar: Set<string>}>} */
  async function adaylariOku(klasor, parola) {
    const adlar = adayAdlari(await fsp.readdir(klasor));
    const belgeler = [];
    const sorunlar = new Set();
    const ana = { var: false, belge: null, neden: null };
    // Ana dosya önce; çakışma kopyaları en yeni değişim zamanına göre, en çok EN_COK_ADAY dosya.
    const bilgili = [];
    for (const ad of adlar) {
      try {
        const b = await fsp.stat(path.join(klasor, ad));
        if (b.isFile()) bilgili.push({ ad, boyut: b.size, mtime: b.mtimeMs, anaMi: ad.toLowerCase() === DOSYA_ADI });
      } catch {
        /* okunamayan aday atlanır */
      }
    }
    bilgili.sort((x, y) => (x.anaMi === y.anaMi ? y.mtime - x.mtime : x.anaMi ? -1 : 1));
    for (const aday of bilgili.slice(0, EN_COK_ADAY)) {
      if (aday.anaMi) ana.var = true;
      let sonuc;
      if (aday.boyut > AKTARIM_BAYT_SINIRI) sonuc = { ok: false, neden: 'cok-buyuk' };
      else {
        try {
          sonuc = await dosyayiCoz(await fsp.readFile(path.join(klasor, aday.ad), 'utf8'), { parola, sifreleyici, simdi: simdi() });
        } catch {
          sonuc = { ok: false, neden: 'okunamadi' };
        }
      }
      if (sonuc.ok) {
        belgeler.push(sonuc.belge);
        if (aday.anaMi) ana.belge = sonuc.belge;
      } else if (aday.anaMi) {
        ana.neden = sonuc.neden;
        sorunlar.add(sonuc.neden);
      } else if (sonuc.neden === 'daha-yeni') {
        sorunlar.add('daha-yeni'); // çakışma kopyası daha yeni sürümden: bu sürüm yazmaz
      }
    }
    return { belgeler, ana, sorunlar };
  }

  async function dosyayaYaz(klasor, metin) {
    const gecici = path.join(klasor, `${GECICI_ONEK}${rastgele(6).toString('hex')}.tmp`);
    try {
      await fsp.writeFile(gecici, metin, { encoding: 'utf8', flag: 'wx' });
      await fsp.rename(gecici, path.join(klasor, DOSYA_ADI));
      return true;
    } catch {
      try {
        await fsp.rm(gecici, { force: true });
      } catch {
        /* geçici dosya silinemedi */
      }
      return false;
    }
  }

  function bitir(yeniAsama, yeniNeden, ek = {}) {
    asama = yeniAsama;
    neden = yeniNeden;
    if (ek.son) son = ek.son;
    haberVer();
    return { ok: yeniAsama !== 'hata', neden: yeniNeden, ...(ek.son ? { son: ek.son } : {}) };
  }

  async function esitleIc({ elle = false, zorlaYaz = false }) {
    if (!etkinMi()) {
      asama = 'kapali';
      neden = null;
      return { ok: false, neden: 'kapali' };
    }
    const a = ayar();
    const klasor = a.esitlemeKlasoru;
    const secili = seciliBolumler();
    asama = 'esitleniyor';
    neden = null;
    haberVer();

    const { parola, hata: parolaHatasi } = await parolaOku();
    if (parolaHatasi) return bitir('hata', 'parola-okunamadi');

    let okunan;
    try {
      okunan = await adaylariOku(klasor, parola);
    } catch {
      gunlugeYaz('Klasör eşitleme: klasör okunamadı.');
      return bitir('hata', 'klasor-yok');
    }
    const { belgeler, ana, sorunlar } = okunan;
    if (sorunlar.has('daha-yeni')) return bitir('hata', 'daha-yeni');
    if (ana.neden && YAZMAYI_ENGELLEYEN.has(ana.neden) && !(zorlaYaz && (ana.neden === 'parola-gerekli' || ana.neden === 'parola-yanlis'))) return bitir('hata', ana.neden);
    if (ana.neden === 'bozuk' && !elle) return bitir('hata', 'bozuk'); // yarım inmiş dosya olabilir: elle istenmedikçe üzerine yazılmaz
    if (ana.neden === 'okunamadi') return bitir('hata', 'okunamadi');

    const birlesik = belgeleriBirlestir(belgeler);
    const kayit = yerelKayit();
    const varsayilan = varsayilanAl();
    const an = simdi();
    const kararlar = {}; // bölüm -> { eylem, durum, temiz, anlik }
    for (const ad of secili) {
      const anlik = bolumAnlik(a, ad);
      const ozetL = ozetle(anlik);
      const uzak = birlesik.bolumler[ad] ?? null;
      const temiz = uzak ? uzakBolumTemizle(ad, uzak.ayarlar, { varsayilan, t, parolasiz: !parola, yerelFavoriler: a.favoriler }) : null;
      if (temiz?.ok && temiz.onayAtilan > 0) gunlugeYaz('Klasör eşitleme: parolasız dosyadaki onay gevşetmeleri yok sayıldı.');
      const ozetU = temiz?.ok ? temiz.ozet : null;
      let karar = bolumKarari({ durum: kayit.bolumler[ad], ozetL, uzak, ozetU, simdi: an, aygit: kayit.aygit });
      if (karar.eylem === 'uygula') {
        const reddedilen = uygulanamayan.get(ad);
        if (!elle && reddedilen && reddedilen.zaman === uzak.zaman && reddedilen.aygit === uzak.aygit) {
          karar = { eylem: 'yok', durum: kayit.bolumler[ad] ?? { ozet: ozetL, zaman: 0, aygit: '' } }; // bu sürüm daha önce uygulanamadı
        }
      }
      kararlar[ad] = { ...karar, temiz, anlik, uzak, ozetL };
    }
    // Yerel içerik özeti KARAR ANINDA kaydedilir: eşitleme sürerken yapılan değişiklik sonraki turda yakalanır.
    sonYerelKilit = secili.map((ad) => kararlar[ad].ozetL).join('|');
    const onceki = { ...kayit.bolumler };

    // 1) Klasörden gelen bölümleri uygula (yerel ayarlar değişir).
    const uygulananlar = [];
    let uygulamaSorunu = false;
    for (const ad of secili) {
      const k = kararlar[ad];
      if (k.eylem !== 'uygula') continue;
      if (!k.temiz?.ok) continue;
      if (!yedekAlindi && (yedekGerekli || Object.keys(onceki).length === 0)) {
        // Bu bilgisayarda ilk eşitleme (ya da eşitleme yeni açıldı): klasördeki sürüm yerel ayarların yerine geçeceği için önce yedek alınır.
        yedekAlindi = true;
        try {
          await yedekAl();
        } catch {
          gunlugeYaz('Klasör eşitleme: ilk uygulama öncesi ayar yedeği alınamadı.');
        }
      }
      let sonuc;
      kendiUygulamamiz = true;
      try {
        sonuc = await iceAktar(k.temiz.cozum);
      } catch {
        sonuc = { ok: false };
      } finally {
        kendiUygulamamiz = false;
      }
      if (sonuc?.ok) {
        uygulanamayan.delete(ad);
        uygulananlar.push(ad);
        kayit.bolumler[ad] = { ozet: ozetle(bolumAnlik(ayar(), ad)), zaman: k.uzak.zaman, aygit: k.uzak.aygit };
      } else {
        uygulamaSorunu = true;
        uygulanamayan.set(ad, { zaman: k.uzak.zaman, aygit: k.uzak.aygit });
        k.eylem = 'yok';
        k.durum = kayit.bolumler[ad] ?? { ozet: k.ozetL, zaman: 0, aygit: '' }; // uygulanamadı: kayıt ilerlemez
        gunlugeYaz('Klasör eşitleme: bir bölüm uygulanamadı.');
      }
    }
    if (uygulananlar.length > 0) {
      // Uygulanan bölümler kendi yeni özetleriyle kilide girer: kendi uygulamamızın ayar yazımı ikinci bir eşitleme planlamaz. Uygulama sürerken
      // başka bir yerel değişiklik olduysa (ya da uygulama başka bir bölümü değiştirdiyse) kilit tutmaz ve eşitleme her zamanki gibi planlanır.
      sonYerelKilit = secili.map((ad) => (uygulananlar.includes(ad) ? kayit.bolumler[ad].ozet : kararlar[ad].ozetL)).join('|');
      if (yerelKilit() !== sonYerelKilit) planla(DEGISIKLIK_BEKLEME_MS);
    }

    // 2) Dosyaya yazılacak birleşik içerik.
    const bolumler = {};
    const yazilanlar = [];
    for (const ad of BOLUM_ADLARI) {
      const k = kararlar[ad];
      if (k && k.eylem === 'yaz') {
        bolumler[ad] = { zaman: k.durum.zaman, aygit: k.durum.aygit, ayarlar: k.anlik };
        kayit.bolumler[ad] = k.durum;
        yazilanlar.push(ad);
      } else if (k && k.eylem === 'yok') {
        if (birlesik.bolumler[ad]) bolumler[ad] = birlesik.bolumler[ad];
        if (k.durum && k.durum.ozet) kayit.bolumler[ad] = k.durum;
      } else if (k && k.eylem === 'uygula' && birlesik.bolumler[ad]) {
        bolumler[ad] = birlesik.bolumler[ad];
      } else if (birlesik.bolumler[ad]) {
        bolumler[ad] = birlesik.bolumler[ad]; // eşitlenmeyen bölüm: klasördeki sürüm aynen korunur
      }
    }
    const metinSonucu = await dosyaMetni({ bolumler, bilinmeyen: birlesik.bilinmeyen, parola, sifreleyici });
    let yazimSorunu = null;
    if (!metinSonucu.ok) yazimSorunu = metinSonucu.neden;
    else {
      const sade = (b) => kararliYaz(Object.fromEntries(Object.entries(b).map(([ad, g]) => [ad, { zaman: g.zaman, aygit: g.aygit, ayarlar: g.ayarlar }])));
      const dosyaDegisti = !ana.belge || yazilanlar.length > 0 || sade(bolumler) !== sade(ana.belge.bolumler) || sade(birlesik.bilinmeyen) !== sade(ana.belge.bilinmeyen);
      // Ana dosya yoksa ve yazılacak bölüm de yoksa boş dosya oluşturulmaz.
      if (dosyaDegisti && Object.keys(bolumler).length + Object.keys(birlesik.bilinmeyen).length > 0) {
        if (!(await dosyayaYaz(klasor, metinSonucu.metin))) yazimSorunu = 'yazilamadi';
      }
    }
    if (yazimSorunu) {
      // Yazılamayan bölümlerin kaydı ilerletilmez (sonraki turda yeniden denenir); uygulananlar kaydedilir.
      for (const ad of yazilanlar) {
        if (onceki[ad]) kayit.bolumler[ad] = onceki[ad];
        else delete kayit.bolumler[ad];
      }
      yazilanlar.length = 0;
      gunlugeYaz(yazimSorunu === 'yazilamadi' ? 'Klasör eşitleme: dosya yazılamadı.' : 'Klasör eşitleme: dosya yazılmadı (içerik uygun değil).');
    }

    // 3) Yerel kaydı sakla.
    const yeniKayit = { aygit: kayit.aygit, bolumler: kayit.bolumler };
    if (kararliYaz(yeniKayit) !== kararliYaz(duzNesne(a.esitlemeDurumu) ? a.esitlemeDurumu : {})) {
      a.esitlemeDurumu = yeniKayit;
      ayarlariYaz();
    }
    sonImza = await klasorImzasi();
    sonCalisma = simdi();
    if (uygulananlar.length > 0) {
      gunlugeYaz(`Klasör eşitleme: ${uygulananlar.length} bölüm klasörden alındı.`);
      try {
        uygulandi(uygulananlar);
      } catch {
        /* haber hatası eşitlemeyi bozmaz */
      }
    }
    if (yazilanlar.length > 0) gunlugeYaz(`Klasör eşitleme: ${yazilanlar.length} bölüm klasöre yazıldı.`);
    const sonOzet = { zaman: simdi(), uygulanan: uygulananlar.length, yazilan: yazilanlar.length };
    if (yazimSorunu) return bitir('hata', yazimSorunu === 'yazilamadi' ? 'yazilamadi' : yazimSorunu, { son: sonOzet });
    if (uygulamaSorunu) return bitir('hata', 'bolum-uygulanamadi', { son: sonOzet });
    return bitir('tamam', null, { son: sonOzet });
  }

  /** Eşitlemeyi çalıştırır; çalışırken gelen istek tek ek tur olarak birleşir. */
  function esitle(secenek = {}) {
    if (!etkinMi()) return Promise.resolve({ ok: false, neden: 'kapali' });
    if (calisan) {
      tekrar = true;
      return calisan;
    }
    calisan = (async () => {
      try {
        const gecen = simdi() - sonCalisma;
        if (!secenek.elle && gecen >= 0 && gecen < EN_AZ_ARALIK_MS) await bekle(EN_AZ_ARALIK_MS - gecen);
        let sonuc;
        let tur = 0;
        do {
          tekrar = false;
          sonuc = await esitleIc(tur === 0 ? secenek : {});
          tur += 1;
        } while (tekrar && tur < 3 && etkinMi());
        return sonuc;
      } catch {
        gunlugeYaz('Klasör eşitleme: beklenmeyen hata.');
        return bitir('hata', 'beklenmeyen');
      } finally {
        calisan = null;
      }
    })();
    return calisan;
  }

  /** Açık bölümlerin yerel içerik özetleri (değişmediyse eşitleme tetiklenmez). */
  function yerelKilit() {
    const a = ayar();
    return seciliBolumler()
      .map((ad) => ozetle(bolumAnlik(a, ad)))
      .join('|');
  }

  // ---- Dışarıya açılan işlemler ---------------------------------------------------------------------------------------------------------

  /**
   * Ayar dosyası yazıldı (main.js ayarlariYaz): bölümlerden biri değiştiyse kısa süre sonra eşitlenir. Klasörden gelen bölüm uygulanırken gelen
   * çağrı atlanır; uygulama bitince esitleIc kilidi karşılaştırır ve o sırada başka bir değişiklik olduysa eşitlemeyi kendisi planlar.
   */
  function yerelDegisti() {
    if (!etkinMi() || kendiUygulamamiz) return;
    if (yerelKilit() === sonYerelKilit) return;
    planla(DEGISIKLIK_BEKLEME_MS);
  }

  /** Açılışta: eşitleme açıksa izleme kurulur ve kısa süre sonra ilk eşitleme yapılır. */
  function baslat() {
    if (!etkinMi()) {
      asama = 'kapali';
      return;
    }
    asama = 'bekliyor';
    izlemeyiBaslat();
    planla(ACILIS_BEKLEME_MS);
  }

  function kapat() {
    izlemeyiBirak();
  }

  async function durumNesnesi() {
    const a = ayar();
    const klasor = typeof a.esitlemeKlasoru === 'string' ? a.esitlemeKlasoru : '';
    let klasorVar = false;
    let dosyaVar = false;
    if (klasor) {
      try {
        dosyaVar = adayAdlari(await fsp.readdir(klasor)).length > 0;
        klasorVar = true;
      } catch {
        klasorVar = false;
      }
    }
    let sifrelemeVar = false;
    try {
      sifrelemeVar = !!(await parolaDeposu.kullanilabilirMi());
    } catch {
      sifrelemeVar = false;
    }
    return {
      acik: etkinMi(),
      klasor: klasor || null,
      klasorVar,
      dosyaVar,
      tumBolumler: [...BOLUM_ADLARI],
      bolumler: seciliBolumler(),
      parolaVar: parolaDeposu.varMi(),
      sifrelemeVar,
      asama: etkinMi() ? (asama === 'kapali' ? 'bekliyor' : asama) : 'kapali',
      neden: etkinMi() ? neden : null,
      son: etkinMi() && son ? { ...son } : null,
    };
  }

  const yanit = async (ek = {}) => ({ ok: true, ...ek, esitleme: await durumNesnesi() });

  /** Ayarlar > Klasör: diyalogla klasör seçilir; eşitleme kapatılır (yeni klasörde bilinçli yeniden açılır). */
  async function klasorSec() {
    let secilen;
    try {
      secilen = await klasorSecDiyalogu();
    } catch {
      return { ok: false, neden: 'diyalog' };
    }
    if (typeof secilen !== 'string' || secilen === '') return { ok: false, iptal: true };
    const gecerli = klasorDogrula(secilen, yasakKlasorler());
    if (!gecerli.ok) return { ok: false, neden: gecerli.neden };
    try {
      const b = await fsp.stat(gecerli.yol);
      if (!b.isDirectory()) return { ok: false, neden: 'yol-gecersiz' };
    } catch {
      return { ok: false, neden: 'klasor-yok' };
    }
    izlemeyiBirak();
    const a = ayar();
    a.klasorEsitleme = false;
    a.esitlemeKlasoru = gecerli.yol;
    a.esitlemeDurumu = { aygit: yerelKayit().aygit }; // yeni klasör: bölüm kayıtları sıfırlanır (ilk eşitlemede klasördeki sürüm alınır)
    uygulanamayan.clear();
    yedekAlindi = false;
    asama = 'kapali';
    neden = null;
    son = null;
    sonYerelKilit = null;
    ayarlariYaz();
    gunlugeYaz('Klasör eşitleme: klasör seçildi.');
    haberVer();
    return yanit();
  }

  /** Eşitlemeyi aç/kapat ve eşitlenecek bölümleri seç. girdi: { acik?: boolean, bolumler?: string[] } */
  async function ayarla(girdi) {
    if (!duzNesne(girdi)) return { ok: false, neden: 'girdi-gecersiz' };
    const a = ayar();
    if (girdi.bolumler !== undefined) {
      const liste = bolumListesiDuzelt(girdi.bolumler);
      if (liste === undefined) return { ok: false, neden: 'girdi-gecersiz' };
      a.esitlemeBolumleri = liste;
    }
    if (girdi.acik !== undefined) {
      if (typeof girdi.acik !== 'boolean') return { ok: false, neden: 'girdi-gecersiz' };
      if (girdi.acik) {
        if (typeof a.esitlemeKlasoru !== 'string' || a.esitlemeKlasoru === '') return { ok: false, neden: 'klasor-yok' };
        if (seciliBolumler().length === 0) return { ok: false, neden: 'bolum-yok' };
        const gecerli = klasorDogrula(a.esitlemeKlasoru, yasakKlasorler());
        if (!gecerli.ok) return { ok: false, neden: gecerli.neden };
        try {
          if (!(await fsp.stat(a.esitlemeKlasoru)).isDirectory()) return { ok: false, neden: 'klasor-yok' };
        } catch {
          return { ok: false, neden: 'klasor-yok' };
        }
        if (!a.klasorEsitleme) {
          a.klasorEsitleme = true;
          yedekGerekli = true;
          yedekAlindi = false;
          uygulanamayan.clear();
          sonYerelKilit = null;
          gunlugeYaz('Klasör eşitleme: açıldı.');
        }
      } else if (a.klasorEsitleme) {
        a.klasorEsitleme = false;
        izlemeyiBirak();
        asama = 'kapali';
        neden = null;
        gunlugeYaz('Klasör eşitleme: kapatıldı.');
      }
    }
    ayarlariYaz();
    if (etkinMi()) {
      izlemeyiBaslat();
      if (asama === 'kapali') asama = 'bekliyor';
      planla(girdi.acik === true ? 300 : DEGISIKLIK_BEKLEME_MS);
    }
    haberVer();
    return yanit();
  }

  /** "Şimdi eşitle". */
  async function simdiEsitle() {
    if (!etkinMi()) return { ok: false, neden: 'kapali' };
    uygulanamayan.clear();
    const sonuc = await esitle({ elle: true });
    return { ok: sonuc.ok !== false && asama !== 'hata', neden: sonuc.neden ?? null, esitleme: await durumNesnesi() };
  }

  async function parolaKoy(parola) {
    if (!parolaGecerliMi(parola)) return { ok: false, neden: 'parola-gecersiz' };
    let kullanilabilir = false;
    try {
      kullanilabilir = !!(await parolaDeposu.kullanilabilirMi());
    } catch {
      kullanilabilir = false;
    }
    if (!kullanilabilir) return { ok: false, neden: 'sifreleme-yok' };
    try {
      await parolaDeposu.yaz(parola);
    } catch {
      return { ok: false, neden: 'saklanamadi' };
    }
    sifreleyici.temizle();
    gunlugeYaz('Klasör eşitleme: parola kaydedildi.');
    if (etkinMi()) await esitle({ elle: true, zorlaYaz: true });
    return yanit();
  }

  async function parolaSil() {
    try {
      await parolaDeposu.sil();
    } catch {
      return { ok: false, neden: 'silinemedi' };
    }
    sifreleyici.temizle();
    gunlugeYaz('Klasör eşitleme: parola kaldırıldı.');
    if (etkinMi()) await esitle({ elle: true, zorlaYaz: true }); // dosya parolasız yeniden yazılır
    return yanit();
  }

  function ipcIsleyicileri() {
    return [
      ['esitleme:durum', () => yanit()],
      ['esitleme:klasor-sec', () => klasorSec()],
      ['esitleme:ayarla', (girdi) => ayarla(girdi)],
      ['esitleme:simdi', () => simdiEsitle()],
      ['esitleme:parola-koy', (parola) => parolaKoy(parola)],
      ['esitleme:parola-sil', () => parolaSil()],
    ];
  }

  return { baslat, kapat, yerelDegisti, esitle, klasorSec, ayarla, simdiEsitle, parolaKoy, parolaSil, durum: durumNesnesi, ipcIsleyicileri };
}

module.exports = { esitlemeYoneticisiOlustur, DEGISIKLIK_BEKLEME_MS, KLASOR_OLAYI_BEKLEME_MS, ACILIS_BEKLEME_MS, YOKLAMA_MS, EN_AZ_ARALIK_MS };
