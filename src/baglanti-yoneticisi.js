'use strict';

/**
 * Bağlantı yöneticisi (1.4.0, bağlantı grubu: o-55, o-56). Home Assistant'a giden HER ağ yolunu (REST/OAuth isteği, canlı bağlantı ve
 * HA penceresi) tek yerde şekillendirir: özel üstbilgiler (Cloudflare Access vb.) ve yalnız HA ana bilgisayarı için sertifika güveni.
 *
 * Electron'a doğrudan bağlı değildir: `session` nesneleri, `fetch` ve WebSocket sınıfı dışarıdan verilir (main.js bağlar); testler sahte
 * oturumla yürür. `src/lib/` altındaki saf modüllerden (ozel-ustbilgi, sertifika, ws-istemci) yararlanır.
 *
 * Güvence
 *  - Üstbilgiler yalnız ayardaki iki HA kökenine (ev içi + dış adres) eklenir (ozel-ustbilgi.js adresIcinUstbilgi); GitHub sürüm denetimi,
 *    yönlendirme ve başka her köken üstbilgi görmez. Değerler ASLA günlüğe, hata iletisine, yanıta ya da Ayarlar sayfasına gitmez
 *    (arayüze yalnız adlar verilir).
 *  - Ağ yolları (REST, canlı bağlantı, HA penceresi) açılışta üstbilgi deposunun yüklenmesini bekler: ilk istekte üstbilgi eksik gitmez.
 *  - Sertifika güveni (varsa) yalnız HA ana bilgisayarlarına uygulanır; "sertifika hatalarını yok say" diye bir seçenek YOKTUR.
 *  - IPC işleyicileri yalnız Ayarlar penceresinden gelen çağrıyı kabul eder (`ayarlardan` denetimi main.js'ten gelir).
 */

const { EN_COK_USTBILGI, adresIcinUstbilgi, fetchSecenegineEkle, istekUstbilgilerineEkle } = require('./lib/ozel-ustbilgi');
const { wsIstemciSinifiOlustur } = require('./lib/ws-istemci');
const { adresSinayiciOlustur } = require('./lib/adres-sina');

const WEB_ISTEK_FILTRESI = Object.freeze({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });

/**
 * @param {object} bag
 * @param {() => ({yerelAdres?: string, disAdres?: string}|null)} bag.ayarlarAl
 * @param {ReturnType<typeof import('./lib/ozel-ustbilgi').ustbilgiDeposuOlustur>} bag.ustbilgiDeposu
 * @param {(url: string, secenek?: object) => Promise<Response>} bag.fetchTemel net.fetch
 * @param {Function|undefined} [bag.WebSocketTemel] küresel WebSocket (ustbilgi/sertifika gerekmeyen bağlantılarda kullanılır)
 * @param {object|null} [bag.sertifika] sertifika güveni (o-56); verilmezse yalnız üstbilgi
 * @param {Function} [bag.wsSinifiOlustur] testler için
 * @param {Function} [bag.t] çevirmen
 * @param {(adres: string, tur: 'yerel'|'dis') => Promise<object>} [bag.adresSina] anahtarsız yoklama (adres-sina.js); verilmezse üstbilgili fetch ile kurulur
 * @param {(mesaj: string) => void} [bag.gunluk] yalnız sabit metinler
 */
function baglantiYoneticisiOlustur({
  ayarlarAl,
  ustbilgiDeposu,
  fetchTemel,
  WebSocketTemel = undefined,
  sertifika = null,
  wsSinifiOlustur = wsIstemciSinifiOlustur,
  t = (anahtar) => anahtar,
  adresSina = null,
  gunluk = () => {},
  wsSecenekleri = {},
}) {
  /** İzinli kökenler: ayardaki iki HA adresi (ev içi + dış). */
  function izinliKokenler() {
    const a = ayarlarAl() ?? {};
    return [a.yerelAdres, a.disAdres].filter((k) => typeof k === 'string' && k !== '');
  }

  function ekUstbilgi(adres) {
    return adresIcinUstbilgi(adres, { liste: ustbilgiDeposu.liste(), izinliKokenler: izinliKokenler() });
  }

  /** net.fetch sarmalayıcısı: HA kökenine giden isteğe özel üstbilgiler eklenir (başka köken değişmeden gider). */
  async function fetchEt(url, secenek) {
    if (typeof url !== 'string') return fetchTemel(url, secenek);
    await ustbilgiDeposu.hazir();
    return fetchTemel(url, fetchSecenegineEkle(secenek, ekUstbilgi(url)));
  }

  const sinayici = typeof adresSina === 'function' ? adresSina : adresSinayiciOlustur({ fetch: fetchEt, t, gunluk }).sina;

  // ---- Canlı bağlantı ----

  async function wsSeceneklerCoz(url) {
    await ustbilgiDeposu.hazir();
    if (sertifika) await sertifika.hazir();
    const ustbilgi = ekUstbilgi(url);
    const guven = sertifika ? sertifika.wsSecenekleri(url) : null;
    if (!ustbilgi && !guven) return null;
    return { ...(ustbilgi ? { ustbilgi } : {}), ...(guven ?? {}) };
  }

  const OzelSoket = wsSinifiOlustur({ secenekAl: wsSeceneklerCoz, ...wsSecenekleri });

  /** Bu adres için küresel WebSocket yetmez mi (üstbilgi ya da özel sertifika güveni gerekiyor, ya da depo henüz yüklenmedi)? */
  function ozelSoketGerekli(url) {
    if (typeof WebSocketTemel !== 'function') return true;
    if (!ustbilgiDeposu.hazirMi()) return true;
    if (sertifika && !sertifika.hazirMi()) return true;
    if (ekUstbilgi(url) !== null) return true;
    return !!sertifika && sertifika.wsSecenekleri(url) !== null;
  }

  /** ha-ws.js'e verilen WebSocket sınıfı: `new HaSoketi(url)`. */
  function HaSoketi(url) {
    if (ozelSoketGerekli(url)) return new OzelSoket(url);
    return new WebSocketTemel(url);
  }
  HaSoketi.CONNECTING = 0;
  HaSoketi.OPEN = 1;
  HaSoketi.CLOSING = 2;
  HaSoketi.CLOSED = 3;

  // ---- Oturumlar (HA penceresi ve net.fetch) ----

  const bagliOturumlar = new WeakSet();

  /**
   * Bir Electron oturumuna kancaları bağlar.
   * @param {object} ses session nesnesi
   * @param {{ ustbilgi?: boolean }} [secenek] ustbilgi: istek üstbilgisi kancası (HA penceresinin bölümü); sertifika kancası her oturuma
   */
  function oturumaBagla(ses, { ustbilgi = false } = {}) {
    if (!ses || bagliOturumlar.has(ses)) return;
    bagliOturumlar.add(ses);
    if (ustbilgi && ses.webRequest && typeof ses.webRequest.onBeforeSendHeaders === 'function') {
      const kur = () => {
        if (ustbilgiDeposu.sayi() === 0 && ustbilgiDeposu.hazirMi()) {
          ses.webRequest.onBeforeSendHeaders(null); // tanımlı üstbilgi yok: kanca hiç çalışmaz (HA penceresi bugünkü gibi)
          return;
        }
        ses.webRequest.onBeforeSendHeaders(WEB_ISTEK_FILTRESI, (ayrinti, geriCagir) => {
          const cevapla = () => {
            try {
              geriCagir({ requestHeaders: istekUstbilgilerineEkle(ayrinti.requestHeaders, ekUstbilgi(ayrinti.url)) });
            } catch {
              geriCagir({ requestHeaders: ayrinti?.requestHeaders });
            }
          };
          // Açılışta depo yüklenirken gelen ilk istekler (HA penceresi) üstbilgisiz gitmesin: yükleme beklenir.
          if (ustbilgiDeposu.hazirMi()) cevapla();
          else ustbilgiDeposu.hazir().then(cevapla, cevapla);
        });
      };
      kur();
      ustbilgiDeposu.degistiDinle(kur);
    }
    if (sertifika) sertifika.oturumaBagla(ses);
  }

  // ---- Arayüz (Ayarlar > Bağlantı) ----

  /** Ayarlar sayfasına giden durum: üstbilgi DEĞERLERİ yoktur, yalnız adlar. */
  function durum() {
    return {
      ok: true,
      ustbilgi: { adlar: ustbilgiDeposu.adlar(), enCok: EN_COK_USTBILGI },
      ...(sertifika ? { sertifika: sertifika.durum() } : {}),
    };
  }

  /** Renderer'dan gelen listeyi kaba biçimden geçirir (yalnız {ad: string, deger: string|null}); ayrıntılı doğrulama ozel-ustbilgi.js'te. */
  function girdiyiTemizle(girdi) {
    if (!Array.isArray(girdi) || girdi.length > 32) return null;
    return girdi.map((o) => ({
      ad: o && typeof o.ad === 'string' ? o.ad : '',
      deger: o && (typeof o.deger === 'string' || o.deger === null) ? o.deger : '',
    }));
  }

  async function ustbilgileriKaydet(girdi) {
    const liste = girdiyiTemizle(girdi);
    if (liste === null) return { ok: false, hatalar: [{ sira: 0, neden: 'ad-gecersiz' }] };
    const sonuc = await ustbilgiDeposu.kaydet(liste);
    if (sonuc.ok) {
      gunluk(`Özel üstbilgi listesi kaydedildi (${sonuc.adlar.length} ad).`);
      return { ok: true, adlar: sonuc.adlar };
    }
    if (sonuc.sifreleme) return { ok: false, sifreleme: true, hata: t('ana.sifrelemeYok') };
    if (sonuc.yazilamadi) return { ok: false, hata: t('baglanti.ustKaydedilemedi') };
    return { ok: false, hatalar: sonuc.hatalar };
  }

  async function ustbilgileriSil() {
    const sonuc = await ustbilgiDeposu.sil();
    if (sonuc.ok) gunluk('Özel üstbilgi listesi silindi.');
    return sonuc.ok ? { ok: true, adlar: [] } : { ok: false, hata: t('baglanti.ustSilinemedi') };
  }

  /**
   * "Üstbilgileri dene": kayıtlı adresler ANAHTAR GÖNDERİLMEDEN yoklanır (adres-sina.js); fetch sarmalayıcısı kayıtlı adrese üstbilgileri
   * ekler. 403/yönlendirme: katman (Cloudflare Access) üstbilgileri kabul etmedi ya da eksik.
   */
  async function ustbilgileriDene() {
    const a = ayarlarAl() ?? {};
    const sonuclar = [];
    for (const [tur, adres] of [['yerel', a.yerelAdres], ['dis', a.disAdres]]) {
      if (typeof adres !== 'string' || adres === '') continue;
      const s = await sinayici(adres, tur);
      sonuclar.push({ tur, ok: !!s.ok, ulasilabilir: !!s.ulasilabilir, neden: s.neden ?? null, mesaj: s.mesaj ?? s.hata ?? '' });
    }
    return { ok: true, sonuclar, ustbilgiSayisi: ustbilgiDeposu.sayi() };
  }

  /**
   * IPC işleyicilerini kaydeder. `ayarlardan(olay)` yalnız Ayarlar penceresinden gelen çağrıda true döner; `izinYok()` reddetme yanıtıdır.
   */
  function ipcKaydet({ ipcMain, ayarlardan, izinYok, ek = [] }) {
    const kaydet = (kanal, isleyici) => ipcMain.handle(kanal, (olay, ...args) => (ayarlardan(olay) ? isleyici(...args) : izinYok()));
    kaydet('baglanti:durum', async () => {
      await ustbilgiDeposu.hazir();
      if (sertifika) await sertifika.hazir();
      return durum();
    });
    kaydet('baglanti:ustbilgi-kaydet', (girdi) => ustbilgileriKaydet(girdi));
    kaydet('baglanti:ustbilgi-sil', () => ustbilgileriSil());
    kaydet('baglanti:ustbilgi-dene', () => ustbilgileriDene());
    for (const [kanal, isleyici] of [...(sertifika ? sertifika.ipcIsleyicileri() : []), ...ek]) kaydet(kanal, isleyici);
  }

  return {
    yukle: () => Promise.all([ustbilgiDeposu.yukle(), sertifika ? sertifika.yukle() : null]),
    fetch: fetchEt,
    webSocketSinifi: HaSoketi,
    oturumaBagla,
    durum,
    ustbilgileriKaydet,
    ustbilgileriSil,
    ustbilgileriDene,
    ipcKaydet,
    izinliKokenler,
  };
}

module.exports = { baglantiYoneticisiOlustur, WEB_ISTEK_FILTRESI };
