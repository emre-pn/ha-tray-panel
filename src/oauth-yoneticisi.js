'use strict';

/**
 * Tarayıcıyla giriş (OAuth / IndieAuth) yöneticisi — 1.4.0 bağlantı grubu (o-57). Elle yapıştırılan uzun ömürlü erişim anahtarının yanında
 * ikinci bir giriş yolu: kullanıcı varsayılan tarayıcıda Home Assistant'a girer, uygulama yalnız bu bilgisayardaki geçici dinleyiciden
 * (127.0.0.1) gelen tek kullanımlık kodu alır, HA'nın /auth/token ucunda jetona çevirir.
 *
 * Güvenlik özeti
 *  - Dinleyici YALNIZ 127.0.0.1'de, rastgele kapıda ve YALNIZ kullanıcı "Tarayıcıyla giriş yap" dediğinde açılır; ilk geçerli geri çağrıdan,
 *    iptalden ya da 5 dakikadan sonra kapanır. Yalnız GET /callback; `Host` başlığı dinleyicinin adresi olmalı (DNS yeniden bağlama), `state`
 *    32 rastgele bayttır ve sabit zamanlı karşılaştırılır, kod biçim denetiminden geçer, yanlış deneme sayısı sınırlıdır.
 *  - Tarayıcı yalnız kullanıcının düğmesiyle (IPC) ve yalnız ayardaki HA adresinin /auth/authorize sayfasıyla açılır.
 *  - Yenileme anahtarı (kalıcı) safeStorage ile şifreli ayrı dosyadadır (oauth-oturum.dat); erişim anahtarı (~30 dk) YALNIZ bellektedir.
 *    İkisi de günlüğe, hata iletisine, dışa aktarmaya, klasör eşitlemesine ve tanılama raporuna girmez.
 *  - Jeton istekleri ha-istemcisi.oauthIstegi'nden geçer: yetki kesici, küresel kapı, güvenli adres, yönlendirme reddi, zaman aşımı.
 *  - Erişim anahtarı bitimine 3 dk kala (ilk kullanımda) tek uçuşla yenilenir; yenileme başarısızsa geçici sorunda artan beklemeyle
 *    (30 sn - 5 dk) yeniden denenir, süresi dolmuş anahtar ASLA gönderilmez. HA yenileme anahtarını reddederse (silinmiş/iptal) oturum
 *    bitirilir ve yeniden giriş istenir. HA erişim anahtarını 401 ile reddederse (yetki kesici) bir kez yenilenir; 30 dk içinde ikinci red
 *    oturumu bitirir (HA'nın IP sayacı en çok 2 hatalı deneme görür).
 *  - Elle anahtar ve tarayıcı oturumu AYNI ANDA bulunmaz: birleşik depo (aşağıda) ikisini tek `anahtarAl` arayüzünde sunar.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { HaHatasi } = require('./ha-istemcisi');
const oauth = require('./lib/oauth');

const YENILEME_GUVENLI_KALAN_MS = 20_000; // bu kadardan az ömrü kalan erişim anahtarı gönderilmez
const SOGUMA_TABAN_MS = 30_000;
const SOGUMA_TAVAN_MS = 5 * 60_000;
const RED_PENCERESI_MS = 30 * 60_000;
const EN_COK_RED = 2; // bu pencerede bu kadar erişim reddi oturumu bitirir
const SON_SONUC_OMRU_MS = 10 * 60_000; // giriş sonucu (hata/başarı) Ayarlar'da bu süre görünür
const SAYFA_STILI =
  'body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f5f7;color:#1b1f23}' +
  'main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem}' +
  '@media(prefers-color-scheme:dark){body{background:#16181c;color:#e8eaed}}';

const kacis = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** HaHatasi türü -> Ayarlar'da gösterilen neden kodu (adres, jeton ya da ayrıntı taşımaz). */
function nedenKodu(hata) {
  switch (hata?.tur) {
    case 'yasak-erisim':
    case 'duraklatildi':
      return 'yasak';
    case 'sunucu':
      return 'sunucu';
    case 'kaynak-izinsiz':
      return 'adres';
    case 'reddedildi':
    case 'dogrulanamadi':
    case 'yerel-yasak':
    case 'ikinci-onay':
      return 'engelli';
    default:
      return 'baglanti';
  }
}

/**
 * @param {object} bag
 * @param {{varMi: () => boolean, kullanilabilirMi: () => Promise<boolean>, anahtarAl: () => Promise<string|null>, yaz: (s: string) => Promise<void>, sil: () => Promise<unknown>}} bag.depo oturum dosyası (anahtar-deposu.js örneği)
 * @param {(girdi: {form: string, taban?: string}) => Promise<{durum: number, govde: object|null, taban: string}>} bag.jetonIstegi ha-istemcisi.oauthIstegi
 * @param {() => Promise<string|null>} bag.tabanBul anahtarsız yoklamayla seçilen HA kökeni (ayardaki adreslerden biri)
 * @param {(url: string) => Promise<void>} bag.tarayiciAc varsayılan tarayıcıda açar (yalnız kullanıcı düğmesiyle çağrılır)
 * @param {() => {yerelAdres?: string, disAdres?: string}} bag.ayarlarAl
 * @param {(anahtar: string) => string} bag.parmakIzi yetki kesicinin parmak izi işlevi
 * @param {(taban: string, anahtar: string) => void} [bag.erisimKabulEdildi] HA'nın verdiği erişim anahtarı (yetki kesici "doğrulanmış" sayar)
 * @param {(bilgi: {eski: string|null, yeni: string}) => void} [bag.erisimDegisti] erişim anahtarı yenilendi (parmak izleri)
 * @param {() => void} [bag.degisti] durum değişti (Ayarlar'a bildirilir)
 * @param {() => Promise<void>} [bag.oturumAcildi] giriş tamamlandı (elle anahtarı sil, bağlantıyı tazele)
 * @param {(neden: string) => void} [bag.oturumSonlandi] oturum sunucu tarafından bitirildi (bildirim)
 */
function oauthYoneticisiOlustur({
  depo,
  jetonIstegi,
  tabanBul,
  tarayiciAc,
  ayarlarAl,
  parmakIzi,
  erisimKabulEdildi = () => {},
  erisimDegisti = () => {},
  degisti = () => {},
  oturumAcildi = async () => {},
  oturumSonlandi = () => {},
  httpModulu = http,
  rastgele = crypto.randomBytes,
  zaman = { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) },
  simdi = () => Date.now(),
  t = (anahtar) => anahtar,
  dil = () => 'tr',
  gunluk = () => {},
}) {
  let surum = 0; // oturum silindiğinde artar: süren yenileme/giriş sonucu çöpe gider (silinen oturum geri gelmesin)
  let onbellek = null; // çözülmüş oturum kaydı { taban, istemci, yenileme }
  let erisim = null; // { anahtar, bitis, parmak }
  let yenilemeSozu = null;
  let soguma = null; // { sonraki, sayi, tur, durumKodu }
  let redler = []; // erişim anahtarı reddedilme zamanları
  let giris = null; // süren giriş: { asama, sunucu, kapi, durum, istemci, taban, gecersiz, zamanlayici, bitis }
  let sonGiris = null; // { sonuc, neden, zaman }
  let dusuyor = false; // oturum sunucu tarafından bitirildi, kayıt dosyası siliniyor: bu aralıkta yeni yenileme başlamaz

  // ---- Oturum kaydı ----------------------------------------------------------------------------------------------------------------

  async function oturumuOku() {
    if (onbellek) return onbellek;
    if (!depo.varMi()) return null;
    const sira = surum;
    const metin = await depo.anahtarAl();
    const kayit = metin ? oauth.oturumuCoz(metin) : null;
    if (kayit && sira === surum && depo.varMi()) onbellek = kayit;
    return sira === surum ? kayit : null;
  }

  /** Oturumu bu bilgisayardan siler (ağa çıkmaz). Süren yenileme/giriş sonucu geçersiz olur. */
  async function yerelSil() {
    surum += 1;
    erisim = null;
    onbellek = null;
    soguma = null;
    redler = [];
    await depo.sil();
  }

  async function oturumuDusur(neden) {
    dusuyor = true; // dosya silinirken (zaman alır) aynı oturumla yeni yenileme başlamasın
    try {
      await yerelSil();
    } catch {
      /* dosya silinemese de bellekteki oturum düşmüştür */
    } finally {
      dusuyor = false;
    }
    gunluk('Tarayıcı oturumu sona erdi; yeniden giriş gerekiyor.');
    try {
      oturumSonlandi(neden);
    } catch {
      /* bildirim hatası yöneticiyi etkilemesin */
    }
    degisti();
  }

  // ---- Erişim anahtarı (yenileme) ----------------------------------------------------------------------------------------------------

  /** Yenileme / iptal isteğinin gidebileceği kökenler: girişin yapıldığı andaki HA adresleri (eski kayıtta yalnız giriş kökeni). */
  const izinliKokenler = (kayit) => (Array.isArray(kayit?.kokenler) && kayit.kokenler.length > 0 ? kayit.kokenler : [kayit?.taban].filter(Boolean));

  const gecerliErisim = () => (erisim && erisim.bitis - simdi() > YENILEME_GUVENLI_KALAN_MS ? erisim.anahtar : null);

  function sogumayaAl(hata) {
    const sayi = (soguma?.sayi ?? 0) + 1;
    soguma = {
      sayi,
      sonraki: simdi() + Math.min(SOGUMA_TABAN_MS * 2 ** (sayi - 1), SOGUMA_TAVAN_MS),
      tur: typeof hata?.tur === 'string' ? hata.tur : 'baglanti',
      durumKodu: Number.isInteger(hata?.durumKodu) ? hata.durumKodu : 0,
    };
  }

  async function yenileIc() {
    const sira = surum;
    const eldeki = gecerliErisim();
    if (soguma && simdi() < soguma.sonraki) {
      if (eldeki) return eldeki; // erken yenileme beklemede: anahtarın ömrü sürüyor
      throw new HaHatasi(soguma.tur, soguma.durumKodu);
    }
    let kayit = null;
    try {
      kayit = await oturumuOku();
    } catch {
      kayit = null; // dosya çözülemedi
    }
    if (sira !== surum || !kayit) return null; // oturum yok (ya da bu bilgisayarda çözülemiyor): anahtar yok
    let yanit;
    try {
      yanit = await jetonIstegi({ form: oauth.yenilemeFormu({ yenileme: kayit.yenileme, istemci: kayit.istemci }), izinliKokenler: izinliKokenler(kayit) });
    } catch (hata) {
      if (sira !== surum) return null;
      if (hata?.tur === 'kaynak-izinsiz') {
        // Adres, oturumu veren sunucunun dışına çevrilmiş: yenileme anahtarı oraya gönderilmez, oturum yerelde düşer (yeniden giriş gerekir).
        await oturumuDusur('adres-degisti');
        return null;
      }
      sogumayaAl(hata);
      gunluk('Tarayıcı oturumu yenilenemedi (geçici sorun); yeniden denenecek.');
      if (eldeki) return eldeki;
      throw hata instanceof HaHatasi ? hata : new HaHatasi('baglanti');
    }
    if (sira !== surum) return null;
    if (oauth.kaliciRedMi(yanit.durum, yanit.govde)) {
      await oturumuDusur('sunucu-reddetti'); // yenileme anahtarı silinmiş/iptal edilmiş ya da client_id uyuşmuyor: yeniden denemek yararsız
      return null;
    }
    const jeton = yanit.durum === 200 ? oauth.jetonYaniti(yanit.govde, { simdi: simdi() }) : { ok: false };
    if (!jeton.ok) {
      const hata = new HaHatasi('sunucu', yanit.durum);
      sogumayaAl(hata);
      gunluk('Tarayıcı oturumu yenilenemedi (beklenmeyen yanıt); yeniden denenecek.');
      if (eldeki) return eldeki;
      throw hata;
    }
    soguma = null;
    const eski = erisim;
    erisim = { anahtar: jeton.erisim, bitis: jeton.bitis, parmak: parmakIzi(jeton.erisim) };
    try {
      erisimKabulEdildi(yanit.taban, jeton.erisim);
    } catch {
      /* yetki kesici bakımı yenilemeyi bozmasın */
    }
    if (jeton.yenileme && jeton.yenileme !== kayit.yenileme) {
      // HA şimdilik yenileme anahtarını döndürmez; döndürürse (OAuth 2.1) yenisi saklanır.
      const yeniKayit = { ...kayit, yenileme: jeton.yenileme };
      try {
        await depo.yaz(oauth.oturumuYaz(yeniKayit));
        if (sira === surum) onbellek = yeniKayit;
      } catch {
        gunluk('Tarayıcı oturumunun yeni yenileme anahtarı saklanamadı.');
      }
    }
    try {
      erisimDegisti({ eski: eski ? eski.parmak : null, yeni: erisim.parmak });
    } catch {
      /* bakım hatası yenilemeyi bozmasın */
    }
    degisti();
    return jeton.erisim;
  }

  /**
   * Kimlikli isteklerin kullanacağı erişim anahtarı. Oturum yoksa null. Yenileme geçici olarak başarısızsa (ağ, HA) ve elde süresi dolmamış
   * anahtar yoksa HaHatasi fırlatır (çağıranlar bunu "bağlantı yok" olarak işler; "anahtar yok" DEĞİLDİR).
   */
  async function erisimAnahtariAl() {
    if (dusuyor || !depo.varMi()) {
      erisim = null;
      return null;
    }
    if (erisim && erisim.bitis - simdi() > oauth.YENILEME_ONCESI_MS) return erisim.anahtar;
    if (!yenilemeSozu) {
      const soz = yenileIc().finally(() => {
        if (yenilemeSozu === soz) yenilemeSozu = null; // oturum arada değiştiyse yeni uçuş silinmesin
      });
      yenilemeSozu = soz;
    }
    return yenilemeSozu;
  }

  /**
   * Yetki kesici bir erişim anahtarını reddetti (HA 401). Bu OTURUMUN erişim anahtarıysa true döner: anahtar bir daha verilmez, sonraki
   * `erisimAnahtariAl` yenileme anahtarıyla yenisini alır. 30 dk içinde ikinci red oturumu bitirir (hatalı deneme zinciri olmasın).
   */
  function erisimReddedildi(parmak) {
    if (!erisim || erisim.parmak !== parmak) return false;
    erisim = null;
    const an = simdi();
    redler = [...redler.filter((z) => an - z < RED_PENCERESI_MS), an];
    if (redler.length >= EN_COK_RED) {
      gunluk('Tarayıcı oturumunun erişim anahtarı yenilenmesine rağmen yeniden reddedildi; oturum bitiriliyor.');
      oturumuDusur('surekli-reddedildi').catch(() => {});
    }
    degisti();
    return true;
  }

  // ---- Çıkış -------------------------------------------------------------------------------------------------------------------------

  /**
   * Oturumu kapatır: önce bu bilgisayardaki kayıt silinir; sonra (iptal: true) HA'daki yenileme anahtarı iptal edilmeye çalışılır.
   * İptal başarısız olsa da yerel oturum gitmiştir (kullanıcıya söylenir; HA profilinden elle silinebilir).
   * @returns {Promise<{ok: true, iptalEdildi: boolean}>}
   */
  async function cikis({ iptal = true, bekle = true } = {}) {
    let kayit = null;
    try {
      kayit = await oturumuOku();
    } catch {
      kayit = null;
    }
    await yerelSil();
    let iptalEdildi = false;
    if (iptal && kayit) {
      const is = jetonIstegi({ form: oauth.iptalFormu({ yenileme: kayit.yenileme }), izinliKokenler: izinliKokenler(kayit) })
        .then((yanit) => yanit.durum === 200)
        .catch(() => false);
      if (bekle) iptalEdildi = await is;
    }
    gunluk(iptalEdildi ? 'Tarayıcı oturumu kapatıldı; Home Assistant’taki yenileme anahtarı iptal edildi.' : 'Tarayıcı oturumu bu bilgisayardan silindi.');
    degisti();
    return { ok: true, iptalEdildi };
  }

  // ---- Giriş (geçici yerel dinleyici) ---------------------------------------------------------------------------------------------------

  function sayfaYap(baslik, metin) {
    const karma = crypto.createHash('sha256').update(SAYFA_STILI, 'utf8').digest('base64');
    return {
      govde:
        `<!doctype html><html lang="${kacis(dil())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="referrer" content="no-referrer"><title>${kacis(baslik)}</title><style>${SAYFA_STILI}</style></head>` +
        `<body><main><h1>${kacis(baslik)}</h1><p>${kacis(metin)}</p></main></body></html>`,
      csp: `default-src 'none'; style-src 'sha256-${karma}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    };
  }

  function yanitla(yanit, kod, govde, csp) {
    yanit.writeHead(kod, {
      'Content-Type': csp ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(govde),
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp ?? "default-src 'none'",
      Connection: 'close',
    });
    yanit.end(govde);
  }

  function dinleyiciyiKapat(g) {
    try {
      g.sunucu.close();
      g.sunucu.closeAllConnections?.();
    } catch {
      /* zaten kapalı */
    }
  }

  /** Girişi sonlandırır (idempotent): zamanlayıcı ve dinleyici kapanır, sonuç Ayarlar için saklanır. */
  function bitir(g, sonuc, neden = null) {
    if (giris !== g) return;
    zaman.clearTimeout(g.zamanlayici);
    dinleyiciyiKapat(g);
    giris = null;
    sonGiris = { sonuc, neden, zaman: simdi() };
    degisti();
  }

  async function kodDegistir(g, kod) {
    try {
      const yanit = await jetonIstegi({ form: oauth.kodFormu({ kod, istemci: g.istemci }), taban: g.taban });
      const ayar = ayarlarAl() ?? {};
      const kokenler = oauth.kokenleriDuzelt([g.taban, ayar.yerelAdres, ayar.disAdres]); // yenileme / iptal yalnız bu kökenlere gider
      if (yanit.durum !== 200) return bitir(g, 'hata', 'kod-reddedildi');
      const jeton = oauth.jetonYaniti(yanit.govde, { yenilemeGerekli: true, simdi: simdi() });
      if (!jeton.ok) return bitir(g, 'hata', 'yanit-gecersiz');
      let eski = null;
      try {
        eski = await oturumuOku(); // yeni giriş eskisinin yerine geçer: eski yenileme anahtarı HA'da iptal edilir
      } catch {
        eski = null;
      }
      try {
        await depo.yaz(oauth.oturumuYaz({ taban: g.taban, istemci: g.istemci, yenileme: jeton.yenileme, kokenler }));
      } catch {
        // Saklanamayan oturum kullanılamaz: HA'da açık kalmasın diye hemen iptal edilir.
        jetonIstegi({ form: oauth.iptalFormu({ yenileme: jeton.yenileme }), taban: g.taban }).catch(() => {});
        return bitir(g, 'hata', 'saklanamadi');
      }
      surum += 1; // eski oturumun süren yenilemesi yeni oturumu ezmesin
      yenilemeSozu = null;
      onbellek = { taban: g.taban, istemci: g.istemci, yenileme: jeton.yenileme, kokenler };
      soguma = null;
      redler = [];
      const oncekiErisim = erisim;
      erisim = { anahtar: jeton.erisim, bitis: jeton.bitis, parmak: parmakIzi(jeton.erisim) };
      try {
        erisimKabulEdildi(yanit.taban, jeton.erisim);
        erisimDegisti({ eski: oncekiErisim ? oncekiErisim.parmak : null, yeni: erisim.parmak });
      } catch {
        /* yetki kesici bakımı girişi bozmasın */
      }
      if (eski && eski.yenileme !== jeton.yenileme) {
        jetonIstegi({ form: oauth.iptalFormu({ yenileme: eski.yenileme }), izinliKokenler: izinliKokenler(eski) }).catch(() => {});
      }
      gunluk('Tarayıcıyla giriş tamamlandı; oturum şifreli olarak saklandı.');
      bitir(g, 'tamam');
      try {
        await oturumAcildi();
      } catch {
        gunluk('Tarayıcı girişi sonrası bağlantı tazelenemedi.');
      }
      return undefined;
    } catch (hata) {
      gunluk('Tarayıcıyla giriş tamamlanamadı (kod HA’da değiştirilemedi).');
      return bitir(g, 'hata', nedenKodu(hata));
    }
  }

  function istekIsle(g, istek, yanit) {
    const sinif = oauth.geriCagriSinifla({ metot: istek.method, yol: istek.url, anaBilgisayarBasligi: istek.headers.host, kapi: g.kapi, durum: g.durum });
    if (g.asama !== 'bekliyor' || sinif.sinif === 'yok') return yanitla(yanit, 404, 'Not found');
    if (sinif.sinif === 'gecersiz') {
      g.gecersiz += 1;
      const sayfa = sayfaYap(t('oturum.sayfa.hataBaslik'), t('oturum.sayfa.hataMetin'));
      yanitla(yanit, 400, sayfa.govde, sayfa.csp);
      if (g.gecersiz >= oauth.EN_COK_GECERSIZ_GERI_CAGRI) {
        gunluk('Tarayıcı girişi iptal edildi: çok sayıda geçersiz geri çağrı geldi.');
        bitir(g, 'hata', 'cok-fazla-deneme');
      }
      return undefined;
    }
    if (sinif.sinif === 'iptal') {
      const sayfa = sayfaYap(t('oturum.sayfa.iptalBaslik'), t('oturum.sayfa.iptalMetin'));
      yanitla(yanit, 200, sayfa.govde, sayfa.csp);
      return bitir(g, 'iptal');
    }
    // Geçerli kod: bir kez kabul edilir, dinleyici hemen kapanır (ikinci bir geri çağrı 404 alır).
    g.asama = 'tamamlaniyor';
    const sayfa = sayfaYap(t('oturum.sayfa.tamamBaslik'), t('oturum.sayfa.tamamMetin'));
    yanit.once('finish', () => dinleyiciyiKapat(g));
    yanitla(yanit, 200, sayfa.govde, sayfa.csp);
    zaman.clearTimeout(g.zamanlayici);
    degisti();
    kodDegistir(g, sinif.kod);
    return undefined;
  }

  function dinleyiciAc(g) {
    return new Promise((coz, reddet) => {
      const sunucu = httpModulu.createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 1 }, (istek, yanit) => {
        try {
          istekIsle(g, istek, yanit);
        } catch {
          try {
            yanit.destroy();
          } catch {
            /* bağlantı zaten kapalı */
          }
        }
      });
      sunucu.maxConnections = 8;
      sunucu.on('clientError', (_hata, soket) => {
        try {
          soket.destroy();
        } catch {
          /* kapalı */
        }
      });
      sunucu.once('error', reddet);
      sunucu.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => {
        sunucu.removeListener('error', reddet);
        sunucu.on('error', () => {});
        g.sunucu = sunucu;
        g.kapi = sunucu.address().port;
        coz();
      });
    });
  }

  /** Kullanıcı "Tarayıcıyla giriş yap" dedi. @returns {Promise<{ok: true} | {ok: false, neden: string}>} */
  async function girisBaslat() {
    if (giris) return { ok: false, neden: 'suruyor' };
    if (!(await depo.kullanilabilirMi())) return { ok: false, neden: 'sifreleme-yok' };
    let taban = null;
    try {
      taban = await tabanBul();
    } catch {
      taban = null;
    }
    const ayar = ayarlarAl() ?? {};
    if (!taban) return { ok: false, neden: 'adres-yok' };
    if (taban !== ayar.yerelAdres && taban !== ayar.disAdres) return { ok: false, neden: 'adres-yok' };
    if (giris) return { ok: false, neden: 'suruyor' }; // adres seçilirken başka bir giriş başladı
    const g = { asama: 'bekliyor', sunucu: null, kapi: 0, durum: oauth.durumUret(rastgele), istemci: '', taban, gecersiz: 0, zamanlayici: null, bitis: simdi() + oauth.GIRIS_ZAMAN_ASIMI_MS };
    giris = g;
    try {
      await dinleyiciAc(g);
    } catch {
      giris = null;
      gunluk('Tarayıcı girişi için yerel dinleyici açılamadı.');
      return { ok: false, neden: 'dinleyici' };
    }
    g.istemci = oauth.istemciKimligi(g.kapi);
    const adres = oauth.girisAdresi({ taban, kapi: g.kapi, durum: g.durum });
    if (!adres) {
      dinleyiciyiKapat(g);
      giris = null;
      return { ok: false, neden: 'adres-yok' };
    }
    g.zamanlayici = zaman.setTimeout(() => {
      gunluk('Tarayıcıyla giriş zaman aşımına uğradı.');
      bitir(g, 'zaman-asimi');
    }, oauth.GIRIS_ZAMAN_ASIMI_MS);
    g.zamanlayici?.unref?.();
    sonGiris = null;
    try {
      await tarayiciAc(adres);
    } catch {
      bitir(g, 'hata', 'tarayici');
      return { ok: false, neden: 'tarayici' };
    }
    gunluk('Tarayıcıyla giriş başlatıldı (yerel dinleyici açık, en çok 5 dk).');
    degisti();
    return { ok: true };
  }

  function girisIptal() {
    const g = giris;
    if (!g) return { ok: true };
    if (g.asama !== 'bekliyor') return { ok: false, neden: 'tamamlaniyor' }; // kod değişimi sürüyor: birkaç saniye
    bitir(g, 'iptal');
    return { ok: true };
  }

  /** Uygulama kapanırken: açık dinleyici kalmaz. */
  function kapat() {
    if (giris) {
      zaman.clearTimeout(giris.zamanlayici);
      dinleyiciyiKapat(giris);
      giris = null;
    }
  }

  // ---- Durum / IPC ----------------------------------------------------------------------------------------------------------------------

  async function durum() {
    let kayit = null;
    try {
      kayit = depo.varMi() ? await oturumuOku() : null;
    } catch {
      kayit = null;
    }
    let anaBilgisayar = null;
    if (kayit) {
      try {
        anaBilgisayar = new URL(kayit.taban).host;
      } catch {
        anaBilgisayar = null;
      }
    }
    const taze = erisim && erisim.bitis > simdi();
    return {
      var: depo.varMi(),
      cozuldu: !!kayit, // false: kayıt var ama bu bilgisayarda çözülemiyor (başka kullanıcıdan kopyalanmış olabilir)
      anaBilgisayar,
      asama: giris ? giris.asama : 'yok',
      kalanSn: giris && giris.asama === 'bekliyor' ? Math.max(0, Math.ceil((giris.bitis - simdi()) / 1000)) : 0,
      erisim: soguma ? 'yenilenemedi' : taze ? 'taze' : yenilemeSozu ? 'yenileniyor' : 'yok',
      son: sonGiris && simdi() - sonGiris.zaman < SON_SONUC_OMRU_MS ? { sonuc: sonGiris.sonuc, neden: sonGiris.neden } : null,
    };
  }

  function ipcIsleyicileri() {
    return [
      ['oturum:durum', async () => ({ ok: true, oturum: await durum() })],
      ['oturum:giris-baslat', () => girisBaslat()],
      ['oturum:giris-iptal', () => girisIptal()],
      ['oturum:cikis', () => cikis({ iptal: true, bekle: true })],
    ];
  }

  return {
    oturumVarMi: () => depo.varMi(),
    /** Bellekteki erişim anahtarının parmak izi (ağa çıkmaz, yenilemez); yoksa null. */
    gecerliParmak: () => (erisim ? erisim.parmak : null),
    erisimAnahtariAl,
    erisimReddedildi,
    girisBaslat,
    girisIptal,
    cikis,
    yerelSil,
    kapat,
    durum,
    ipcIsleyicileri,
  };
}

/**
 * Birleşik anahtar deposu: ana sürecin her yerinde kullanılan `anahtarDeposu` arayüzünü (varMi, kullanilabilirMi, anahtarAl, yaz, sil,
 * karantinayaAl, karantinadaMi) korur. Elle yapıştırılan anahtar varsa o; yoksa tarayıcı oturumunun (yenilenen) erişim anahtarı verilir.
 * İkisi aynı anda bulunmaz: elle anahtar kaydedilince oturum kapatılır (HA'daki yenileme anahtarı arka planda iptal edilmeye çalışılır),
 * tarayıcıyla giriş tamamlanınca elle anahtarı silmek ana sürecin işidir (oturumAcildi).
 */
function birlesikAnahtarDeposuOlustur({ manuel, oturum }) {
  return {
    varMi: () => manuel.varMi() || oturum.oturumVarMi(),
    kullanilabilirMi: () => manuel.kullanilabilirMi(),
    async anahtarAl() {
      if (manuel.varMi()) return manuel.anahtarAl();
      return oturum.erisimAnahtariAl();
    },
    async yaz(anahtar) {
      await manuel.yaz(anahtar);
      if (oturum.oturumVarMi()) await oturum.cikis({ iptal: true, bekle: false });
    },
    async sil() {
      await manuel.sil();
      await oturum.yerelSil(); // yalnız YEREL kayıt; HA'daki anahtar/oturum iptal edilmez ("Anahtarı sil" iletisi bunu söyler)
      return { silindi: true };
    },
    karantinayaAl: () => manuel.karantinayaAl(),
    karantinadaMi: () => manuel.karantinadaMi(),
  };
}

module.exports = { oauthYoneticisiOlustur, birlesikAnahtarDeposuOlustur, nedenKodu, YENILEME_GUVENLI_KALAN_MS, SOGUMA_TABAN_MS, SOGUMA_TAVAN_MS, EN_COK_RED };
