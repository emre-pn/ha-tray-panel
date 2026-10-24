'use strict';

/**
 * Home Assistant canlı bağlantısı (hiz-03): ana süreçte TEK WebSocket; renderer'a hiçbir şey açılmaz.
 *
 * Akış: auth_required -> auth -> auth_ok -> subscribe_trigger (yalnız izlenen varlıklar; olmazsa subscribe_events
 * state_changed; o da olmazsa REST yedeği) -> get_states (izlenenlere süzülür) -> canlı. Olaylar durum deposuna
 * (src/lib/durum-deposu.js) `last_updated` karşılaştırmasıyla yazılır: eski olay yeniyi ezmez.
 * 25 sn'de bir ping, 10 sn'de pong gelmezse bağlantı kesilip yeniden kurulur (artan bekleme, tavan 30 sn). Kurulum adımları
 * (auth, abonelik, get_states) toplam 15 sn içinde bitmezse bağlantı kesilip yeniden denenir (sessiz kalan sunucu/proxy).
 *
 * Güvenlik
 *  - Erişim anahtarı YALNIZ `auth` iletisinde geçer; günlüğe, hata metnine, olay verisine yazılmaz. Anahtar yalnız
 *    anahtarIcinGuvenliAdresMi'den geçen bir tabana gidilen soketten gönderilir (herkese açık adrese düz ws:// yok).
 *  - Sertifika doğrulaması normaldir (wss://); hiçbir hata bastırılmaz. 3 başarısız denemeden sonra REST yedeğine geçilir.
 *  - Yetki kesici (1.1.1): soket açılmadan ÖNCE tek doğrulama isteği (GET /api/, REST ile paylaşılan geçit) gider; anahtar
 *    reddedilmişse, adres duraklatılmışsa ya da kimlikli bir istek zaman aşımına uğrayıp soğuma sürüyorsa soket HİÇ açılmaz.
 *    Açık soket koptuğunda REST ile paylaşılan doğrulama unutulur (anahtar iptal edilmiş olabilir): yeniden bağlanma ve REST
 *    yedeği TEK ortak doğrulamayla başlar. 'auth_invalid' anahtarı kalıcı olarak reddedilmiş sayar: yeniden bağlanma yok. `yetki` verilmezse bu koruma yoktur (yalnız birim testleri; main.js HER ZAMAN verir).
 *  - Küresel kapı (tur 3, K1): 'auth' iletisi REST ile AYNI kimlikli kapıdan (aynı anda en çok 1 işlem) geçer: kapı auth iletisi
 *    göndermeden ALINIR, auth_ok / auth_invalid ya da soket kapanışı (koptu, kaliciYedek, durdur, askiyaAl, yeniden bağlanma:
 *    hepsi soketiKapat'tan geçer) gelene kadar TUTULUR. Kapıyı beklerken kesici yeniden denetlenir. auth gönderilip auth_ok /
 *    auth_invalid gelmeden soket koparsa (kapanış, kurulum zaman aşımı) HA saymış olabilir: 'belirsiz' deneme sayılır (K2).
 *  - Sunucudan gelen her ileti güvenilmez veridir (ha-ws-protokol.js doğrular); iletiler 4 MB ile sınırlıdır.
 *  - Bu dosya servis ÇAĞIRMAZ: yalnız okur. Eylemler src/lib/eylem-hatti.js hattından gider.
 *  - 1.4.0 okuma komutları (komut) ve okuma abonelikleri (abone): yalnız ha-ws-protokol.js OKUMA_KOMUTLARI /
 *    ABONELIK_KOMUTLARI listesindeki türler, yalnız bağlantı CANLI iken (auth, yetki kesici ve kimlikli kapıdan geçmiş soket)
 *    gönderilir. Bağlı değilken komut ağa çıkmaz, { ok:false, kod:'baglanti-yok' } döner. Abonelikler bağlantı her canlıya
 *    geçtiğinde yeniden kurulur; HA 'unauthorized' / 'unknown_command' derse abonelik kalıcı olarak düşer (özellik sessizce
 *    kapalı kalır). Bekleyen komutlar kopuşta { ok:false, kod:'koptu' } ile sonuçlanır (asılı söz kalmaz).
 *
 * Electron'a bağlı değildir: WebSocket sınıfı, saat ve adres/anahtar kaynakları dışarıdan verilir (sahte soketle test edilir).
 */

const { anahtarIcinGuvenliAdresMi } = require('./lib/dogrulama');
const { bekleSn } = require('./lib/geri-cekilme');
const p = require('./lib/ha-ws-protokol');

const PING_ARALIGI_MS = 25_000;
const PONG_BEKLEME_MS = 10_000;
const KURULUM_ZAMAN_ASIMI_MS = 15_000; // soket açıldıktan canlı olana kadar tüm kurulum adımları için toplam süre
const KOMUT_ZAMAN_ASIMI_MS = 10_000; // 1.4.0 okuma komutu yanıt süresi
const EN_COK_BEKLEYEN_KOMUT = 16; // aynı anda yanıt bekleyen okuma komutu
const EN_COK_EK_ABONELIK = 16;
const KALICI_RET_KODLARI = new Set(['unauthorized', 'unknown_command']); // yönetici gerektiren / bu HA sürümünde olmayan komut
const YEDEGE_GECIS_DENEMESI = 3; // ardışık başarısız bağlantı sayısı: bundan sonra REST yedeği devreye girer (denemeler sürer)
const ACIK = 1; // WebSocket.OPEN

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} bag
 * @param {Function} [bag.WebSocketSinifi] varsayılan globalThis.WebSocket (Electron'un Node'unda varlığı DENENMEDİ: yoksa REST yedeği)
 * @param {() => Promise<string|null>} bag.adresAl API tabanı (ev içi ya da dış HA kökeni)
 * @param {() => Promise<string|null>} bag.anahtarAl
 * @param {() => Iterable<string>} bag.izlenen izlenecek varlık kimlikleri (favoriler + yardımcı varlıklar)
 * @param {{guncelle: Function, yokIsaretle: Function, toplu: Function}} bag.depo
 * @param {() => boolean} [bag.etkinMi] ayardaki canliBaglanti
 * @param {(durum: {baglanti: string, canli: boolean, neden: string|null}) => void} [bag.durumDegisti]
 * @param {(mesaj: string) => void} [bag.gunluk] yalnız sabit metinler
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {() => number} [bag.tavanSn] yeniden deneme tavanı (varsayılan 30)
 * @param {{parmakIzi: (anahtar: string) => string, reddedildiMi: (parmakIzi: string) => boolean,
 *   engelliMi: (parmakIzi: string, taban?: string) => boolean, taze?: (taban: string, parmakIzi: string) => boolean,
 *   gecit: (taban: string, anahtar: string) => Promise<void>, reddedildi: (parmakIzi: string, taban?: string) => void, koptu?: (canliydi: boolean) => void,
 *   onaylandi?: (taban: string, parmakIzi: string) => void, dogrulanamadiMi?: (parmakIzi: string) => boolean,
 *   kapiAl?: (taban: string, parmakIzi: string) => Promise<() => void>, belirsiz?: (parmakIzi: string, taban?: string) => void,
 *   yoldaBaslat?: (parmakIzi: string, taban?: string) => boolean, yoldaBitir?: (parmakIzi: string) => void}|null} [bag.yetki]
 *   yetki kesici köprüsü (ha-istemcisi.js wsYetkisi)
 */
function haWsOlustur({
  WebSocketSinifi = globalThis.WebSocket,
  adresAl,
  anahtarAl,
  izlenen,
  depo,
  etkinMi = () => true,
  durumDegisti = () => {},
  gunluk = () => {},
  zaman = varsayilanZaman(),
  tavanSn = () => 30,
  yetki = null,
}) {
  let baglanti = 'kapali'; // 'kapali' | 'baglaniyor' | 'canli' | 'yedek'
  let sonNeden = null;
  let soket = null;
  let surum = 0; // her bağlantı denemesi/kapanışı eski soketin olaylarını geçersiz kılar
  let deneme = 0; // ardışık başarısız bağlantı
  let kapatildi = true; // durdur() ya da hiç başlamadı
  let askida = false; // uyku/askıya alma
  let kalici = false; // yeniden denemenin yararsız olduğu durum (anahtar reddi, abonelik yok)
  let sonId = 0;
  let bekleyenler = new Map(); // istek id -> 'trigger' | 'olay' | 'durumlar' | 'ping'
  let abonelik = null;
  let izlenenKume = new Set();
  let yenidenZamanlayici = null;
  let pingZamanlayici = null;
  let pongZamanlayici = null;
  let kurulumZamanlayici = null; // soket açıldı ama henüz canlı değil: bekçi
  let sonKaydedilenDeneme = 0;
  let kapiBirak = null; // küresel kimlikli kapının bırakma işlevi (auth yanıtı/kapanış gelene kadar tutulur)
  let authBekliyor = false; // auth gönderildi, auth_ok/auth_invalid henüz gelmedi
  let oturumParmakIzi = null; // bu soketin anahtarının parmak izi (belirsiz deneme kaydı için)
  let oturumTaban = null; // bu soketin bağlandığı adres (belirsiz denemenin hata bütçesi kökeni için)
  const komutlar = new Map(); // 1.4.0: okuma komutu id -> { coz, zamanlayici }
  const ekAbonelikler = new Map(); // 1.4.0: anahtar -> { ileti, dinleyici, id: number|null }
  let sonEkAbonelikAnahtari = 0;

  /** Bekleyen okuma komutlarını sonuçlandırır (kopuş/kapanış): hiçbir söz asılı kalmaz. */
  function komutlariBitir(kod) {
    for (const [id, k] of komutlar) {
      zaman.clearTimeout(k.zamanlayici);
      komutlar.delete(id);
      k.coz({ ok: false, kod });
    }
  }

  function ekAboneligiGonder(s, anahtar, kayit) {
    const id = yeniId(`ek-abone:${anahtar}`);
    const ileti = p.komutMesaji(id, kayit.ileti, p.ABONELIK_KOMUTLARI);
    kayit.id = ileti ? id : null;
    if (!ileti || !gonder(s, ileti)) {
      bekleyenler.delete(id);
      kayit.id = null;
    }
  }

  function ekAbonelikleriKur(s) {
    for (const [anahtar, kayit] of ekAbonelikler) if (kayit.id === null) ekAboneligiGonder(s, anahtar, kayit);
  }

  function dinleyiciyeVer(kayit, yuk) {
    try {
      kayit.dinleyici(yuk);
    } catch {
      /* dinleyici hatası bağlantıyı etkilemesin */
    }
  }

  function durumuAyarla(yeni, neden = null) {
    if (baglanti === yeni && sonNeden === neden) return;
    baglanti = yeni;
    sonNeden = neden;
    try {
      durumDegisti({ baglanti, canli: baglanti === 'canli', neden });
    } catch {
      /* dinleyici hatası bağlantıyı etkilemesin */
    }
  }

  function zamanlayicilariTemizle() {
    zaman.clearTimeout(yenidenZamanlayici);
    zaman.clearTimeout(pingZamanlayici);
    zaman.clearTimeout(pongZamanlayici);
    zaman.clearTimeout(kurulumZamanlayici);
    yenidenZamanlayici = null;
    pingZamanlayici = null;
    pongZamanlayici = null;
    kurulumZamanlayici = null;
  }

  /** Küresel kapıyı bırakır (yoksa hiçbir şey yapmaz). Kapı HER durumda bırakılır: asılı kalan kapı uygulamayı dondurur. */
  function kapiyiBirak() {
    const birak = kapiBirak;
    kapiBirak = null;
    if (birak) birak();
  }

  /** Soketi kapatır ve eski soketin tüm olaylarını geçersiz kılar (kapanış olayı ikinci kez yeniden denemeyi tetiklemesin). */
  function soketiKapat() {
    surum += 1;
    // auth gönderildi ama auth_ok/auth_invalid gelmeden soket kapanıyor (kopma, kurulum zaman aşımı, yeniden bağlanma, uyku, durdurma):
    // HA auth'u işleyip (hatalıysa sayıp) yanıtı kaybettirmiş olabilir. Her kapanış yolu BELİRSİZ sayar (tur 4): yeni soket
    // doğrulamasız ikinci bir auth göndermesin.
    if (authBekliyor && soket && yetki && oturumParmakIzi) yetki.belirsiz?.(oturumParmakIzi, oturumTaban);
    authBekliyor = false;
    kapiyiBirak(); // her kapanış yolu (koptu, kaliciYedek, durdur, askiyaAl, yeniden bağlanma) kapıyı bırakır
    const s = soket;
    soket = null;
    abonelik = null;
    bekleyenler = new Map();
    komutlariBitir('koptu');
    for (const kayit of ekAbonelikler.values()) kayit.id = null; // bir sonraki canlı bağlantıda yeniden kurulur
    if (s) {
      try {
        s.close();
      } catch {
        /* zaten kapalı */
      }
    }
  }

  function gonder(s, ileti) {
    if (s.readyState !== undefined && s.readyState !== ACIK) return false;
    try {
      s.send(JSON.stringify(ileti));
      return true;
    } catch {
      return false;
    }
  }

  function yeniId(tur) {
    sonId += 1;
    bekleyenler.set(sonId, tur);
    return sonId;
  }

  /** Bağlantı koptu / kurulamadı: artan beklemeyle yeniden dene; ilk 3 başarısızlıktan sonra REST yedeği. */
  function koptu(neden) {
    zamanlayicilariTemizle();
    // Açık bir soket koptuysa anahtar HA'da iptal edilmiş olabilir (HA iptal edilen anahtarın soketini kapatır): REST ile
    // paylaşılan doğrulama bilgisi unutulur, sonraki ilk kimlikli istek (REST yedeği ya da yeniden bağlanma) TEK doğrulamayla başlar.
    // h-08 (1.2.0): CANLI bağlantı koptuysa (ağ değişmiş olabilir) adres seçimi de unutulur: yeniden bağlanma önce anahtarsız yoklar.
    if (soket && yetki) yetki.koptu?.(baglanti === 'canli');
    soketiKapat(); // auth yanıtı beklenirken kopma da burada belirsiz sayılır (soketiKapat)
    if (kapatildi || askida || kalici) return;
    deneme += 1;
    if (deneme === 1 || deneme === YEDEGE_GECIS_DENEMESI || deneme - sonKaydedilenDeneme >= 20) {
      sonKaydedilenDeneme = deneme;
      gunluk(`Canlı bağlantı kurulamadı (${neden}); yeniden denenecek${deneme >= YEDEGE_GECIS_DENEMESI ? ', bu arada REST yedeği kullanılıyor' : ''}.`);
    }
    durumuAyarla(deneme >= YEDEGE_GECIS_DENEMESI ? 'yedek' : 'baglaniyor', neden);
    const sn = bekleSn(deneme - 1, tavanSn());
    yenidenZamanlayici = zaman.setTimeout(() => {
      yenidenZamanlayici = null;
      baglan();
    }, sn * 1000);
  }

  /** Yeniden denemenin yararsız olduğu hâl: REST yedeği kullanılır, soket kapalı kalır (anahtar yeniden kaydedilene ya da uyanışa kadar). */
  function kaliciYedek(neden) {
    zamanlayicilariTemizle();
    soketiKapat();
    kalici = true;
    durumuAyarla('yedek', neden);
  }

  function pingPlanla(bu) {
    zaman.clearTimeout(pingZamanlayici);
    pingZamanlayici = zaman.setTimeout(() => {
      pingZamanlayici = null;
      if (bu !== surum || !soket) return;
      const id = yeniId('ping');
      if (!gonder(soket, p.pingMesaji(id))) return koptu('gonderilemedi');
      pongZamanlayici = zaman.setTimeout(() => {
        pongZamanlayici = null;
        if (bu === surum) koptu('pong-yok');
      }, PONG_BEKLEME_MS);
    }, PING_ARALIGI_MS);
  }

  function durumlariIste(s) {
    gonder(s, p.durumlarMesaji(yeniId('durumlar')));
  }

  function kimlikDizisi() {
    return [...izlenenKume];
  }

  /** Yanıtı henüz gelmemiş trigger/olay abonelik istekleri "eski" sayılır (abonelikYenile peş peşe çağrılırsa ilkinin HA'daki aboneliği sızmasın). */
  function bekleyenAbonelikleriEskit() {
    for (const [id, tur] of bekleyenler) if (tur === 'trigger' || tur === 'olay') bekleyenler.set(id, 'eski-abone');
  }

  function aboneOl(s) {
    izlenenKume = new Set([...izlenen()].filter((k) => typeof k === 'string'));
    if (izlenenKume.size === 0) return kaliciYedek('izlenen-yok');
    if (!gonder(s, p.triggerAboneMesaji(yeniId('trigger'), kimlikDizisi()))) koptu('gonderilemedi');
  }

  function sonucIsle(bu, m) {
    const tur = bekleyenler.get(m.id);
    bekleyenler.delete(m.id);
    const basarili = m.ham.success === true;
    const s = soket;
    if (!s || !tur) return;
    if (tur === 'eski-abone') {
      // abonelikYenile yerine yenisini gönderdiği, yanıtı henüz gelmemiş abonelik: kurulduysa HA'da hemen silinir (yoksa sonsuza dek açık kalırdı);
      // reddedildiyse bir şey yapılmaz (yedeğe geçiş ve durumlar isteği yenisinin kendi yanıtına bağlıdır).
      if (basarili) gonder(s, p.abonelikSilMesaji(yeniId('abonelik-sil'), m.id));
      return;
    }
    if (tur === 'komut') {
      const k = komutlar.get(m.id);
      if (!k) return;
      komutlar.delete(m.id);
      zaman.clearTimeout(k.zamanlayici);
      k.coz(basarili ? { ok: true, sonuc: m.ham.result ?? null } : { ok: false, kod: p.sonucHataKodu(m.ham) });
      return;
    }
    if (tur.startsWith('ek-abone:')) {
      const anahtar = Number(tur.slice('ek-abone:'.length));
      const kayit = ekAbonelikler.get(anahtar);
      if (!kayit || kayit.id !== m.id || basarili) return;
      kayit.id = null;
      const kod = p.sonucHataKodu(m.ham);
      if (KALICI_RET_KODLARI.has(kod)) ekAbonelikler.delete(anahtar); // yönetici gerekiyor / komut yok: özellik sessizce kapalı
      dinleyiciyeVer(kayit, { hata: kod });
      return;
    }
    if (tur === 'trigger') {
      if (basarili) {
        abonelik = { id: m.id, tur: 'trigger' };
        durumlariIste(s);
      } else if (!gonder(s, p.olayAboneMesaji(yeniId('olay')))) {
        koptu('gonderilemedi'); // trigger abonesi reddedildi: tüm state_changed olaylarına geç (istemcide süzülür)
      }
    } else if (tur === 'olay') {
      if (basarili) {
        abonelik = { id: m.id, tur: 'olay' };
        durumlariIste(s);
      } else {
        gunluk('Canlı bağlantı: abonelik kurulamadı; REST yedeği kullanılacak.');
        kaliciYedek('abonelik-yok');
      }
    } else if (tur === 'durumlar') {
      const liste = basarili ? p.durumlariSuz(m.ham.result, izlenenKume) : null;
      if (!liste) return koptu('durumlar-hatasi');
      // h-18: get_states HA'daki TÜM varlıkları verir: bu listede hiç bulunmayan izlenen varlık HA'dan silinmiştir ("yok").
      // Liste ham yanıttan kurulur (durumlariSuz'un attığı bozuk biçimli bir kayıt "yok" sayılmasın).
      const tamListe = new Set(m.ham.result.filter((o) => o && typeof o.entity_id === 'string').map((o) => o.entity_id));
      depo.toplu(liste, kimlikDizisi(), { tamListe });
      zaman.clearTimeout(kurulumZamanlayici); // kurulum bitti: bekçi artık gerekmez (bundan sonra ping/pong korur)
      kurulumZamanlayici = null;
      // h-17: geri çekilme sayacı auth_ok'ta değil, bağlantı gerçekten canlıya geçince sıfırlanır (auth sonrası hep düşen bağlantı
      // 2 sn'de bir yeniden bağlanmasın; bekleme büyüsün ve REST yedeğine geçilsin).
      deneme = 0;
      sonKaydedilenDeneme = 0;
      if (baglanti !== 'canli') gunluk('Canlı bağlantı kuruldu.');
      durumuAyarla('canli');
      pingPlanla(bu);
      ekAbonelikleriKur(s); // 1.4.0: okuma abonelikleri (bildirimler, hava tahmini) her canlı bağlantıda yeniden kurulur
    }
  }

  function olayIsle(m) {
    if (abonelik && m.id === abonelik.id) return durumOlayiIsle(m);
    for (const kayit of ekAbonelikler.values()) {
      if (kayit.id !== null && kayit.id === m.id) {
        const olay = m.ham.event;
        if (olay && typeof olay === 'object' && !Array.isArray(olay)) dinleyiciyeVer(kayit, { olay });
        return undefined;
      }
    }
    return undefined;
  }

  function durumOlayiIsle(m) {
    const d = p.olaydanDurum(m);
    if (!d || !izlenenKume.has(d.kimlik)) return;
    if (d.yeni) depo.guncelle(d.yeni);
    else depo.yokIsaretle(d.kimlik);
  }

  /**
   * auth_required geldi: küresel kapı alınır (auth iletisinden ÖNCE), kesici yeniden denetlenir, auth gönderilir ve kapı
   * auth_ok / auth_invalid / kapanışa kadar tutulur. Kesici bu arada anahtarı reddetmiş (REST 401), adresi duraklatmış (403),
   * sonucu belirsiz bırakmış ya da doğrulama eskimişse auth iletisi HİÇ gönderilmez.
   */
  async function authAdimi(bu, s, oturum) {
    const anahtar = oturum.anahtar;
    oturum.anahtar = null; // bellekte yalnız bu ileti için tutulur
    if (!anahtar) return koptu('auth-gonderilemedi');
    if (yetki && oturum.parmakIzi) {
      let birak = () => {};
      try {
        if (yetki.kapiAl) birak = await yetki.kapiAl(oturum.taban, oturum.parmakIzi);
        else if (yetki.reddedildiMi(oturum.parmakIzi)) throw Object.assign(new Error('reddedildi'), { tur: 'reddedildi' });
        else if (yetki.engelliMi(oturum.parmakIzi, oturum.taban)) throw Object.assign(new Error('duraklatildi'), { tur: 'duraklatildi' });
      } catch (hata) {
        if (bu !== surum || kapatildi || askida) return;
        if (hata?.tur === 'reddedildi' || yetki.reddedildiMi(oturum.parmakIzi)) {
          gunluk('Canlı bağlantı: erişim anahtarı kesici tarafından durdurulmuş; auth gönderilmedi.');
          return kaliciYedek('yetki');
        }
        if (hata?.tur === 'dogrulanamadi' || hata?.tur === 'yerel-yasak') {
          gunluk('Canlı bağlantı: kesici kullanıcı onayı bekliyor; auth gönderilmedi.');
          return kaliciYedek(hata.tur);
        }
        gunluk('Canlı bağlantı: kimlikli istekler geçici olarak durduruldu; auth gönderilmedi.');
        return koptu('duraklatildi');
      }
      if (bu !== surum || kapatildi || askida) {
        birak(); // beklerken soket kapandı: kapıyı hemen bırak
        return;
      }
      kapiyiBirak();
      kapiBirak = birak; // auth yanıtı ya da kapanış gelene kadar TUTULUR
      if (yetki.taze && !yetki.taze(oturum.taban, oturum.parmakIzi)) return koptu('dogrulama'); // doğrulama eskidi: yeniden bağlanırken TEK doğrulama
    }
    const yoldaMi = !!(yetki && oturum.parmakIzi);
    // Tur 6: auth iletisinden ÖNCE kalıcı "yolda" işareti; süreç yanıt gelmeden ölse de bir sonraki açılış bunu belirsiz deneme sayar.
    if (yoldaMi && yetki.yoldaBaslat && !yetki.yoldaBaslat(oturum.parmakIzi, oturum.taban)) {
      gunluk('Canlı bağlantı: kesici kaydı yazılamadı; auth gönderilmedi.');
      return kaliciYedek('dogrulanamadi');
    }
    if (!gonder(s, p.authMesaji(anahtar))) {
      if (yoldaMi) yetki.yoldaBitir?.(oturum.parmakIzi);
      return koptu('auth-gonderilemedi');
    }
    authBekliyor = yoldaMi;
  }

  function mesajIsle(bu, s, oturum, veri) {
    if (bu !== surum) return;
    if (typeof veri === 'string' && veri.length > p.EN_COK_MESAJ_BAYT && baglanti !== 'canli') {
      // Kurulum sırasında (çoğunlukla get_states) sınırı aşan ileti: sessizce atılsa durum sonsuza dek "bağlanıyor" kalırdı.
      // Aynı yanıt her denemede yine gelecektir: yeniden denemek yerine REST yedeğine geçilir (canlıyken büyük olay yalnız atılır).
      gunluk('Canlı bağlantı: ileti boyut sınırını aştı; REST yedeği kullanılacak.');
      return kaliciYedek('ileti-cok-buyuk');
    }
    const m = p.mesajCoz(typeof veri === 'string' ? veri : '');
    if (!m) return;
    switch (m.tur) {
      case 'auth_required':
        if (authBekliyor || kapiBirak) break; // yinelenen auth_required: ikinci auth gönderilmez, kapı kendi kendimize beklenmez
        authAdimi(bu, s, oturum); // kapıyı beklerken iletiler sıraya girmez (yalnız auth bekleniyor)
        break;
      case 'auth_ok':
        authBekliyor = false;
        if (yetki && oturum.parmakIzi) {
          yetki.yoldaBitir?.(oturum.parmakIzi);
          yetki.onaylandi?.(oturum.taban, oturum.parmakIzi); // HA anahtarı kabul etti: REST doğrulaması da taze
        }
        kapiyiBirak(); // auth tamamlandı: REST işlemleri kapıdan geçebilir
        aboneOl(s); // h-17: deneme sayacı burada DEĞİL, get_states başarılı olunca (canlı) sıfırlanır
        break;
      case 'auth_invalid':
        authBekliyor = false;
        gunluk('Canlı bağlantı: erişim anahtarı reddedildi.');
        if (yetki && oturum.parmakIzi) {
          yetki.yoldaBitir?.(oturum.parmakIzi);
          yetki.reddedildi(oturum.parmakIzi, oturum.taban); // kalıcı: bu anahtarla bir daha istek çıkmaz
        }
        kaliciYedek('yetki');
        break;
      case 'result':
        sonucIsle(bu, m);
        break;
      case 'event':
        olayIsle(m);
        break;
      case 'pong':
        if (bekleyenler.get(m.id) === 'ping') {
          bekleyenler.delete(m.id);
          zaman.clearTimeout(pongZamanlayici);
          pongZamanlayici = null;
          pingPlanla(bu);
        }
        break;
      default:
    }
  }

  /** Soket açılmadan kesici engeli: anahtar reddedilmişse kalıcı yedek (yeniden deneme yok), adres duraklatılmışsa artan beklemeyle. */
  function engeldenKop(bu, parmakIzi) {
    if (bu !== surum) return undefined;
    if (yetki.reddedildiMi(parmakIzi)) return kaliciYedek('yetki'); // anahtar reddedilmiş
    if (yetki.dogrulanamadiMi?.(parmakIzi)) return kaliciYedek('dogrulanamadi'); // belirsiz deneme sınırı aşıldı: kullanıcı onayı beklenir
    return koptu('duraklatildi'); // adres 403 yüzünden duraklatılmış ya da zaman aşımı sonrası soğuma: süre dolunca yeniden denenir
  }

  async function baglan() {
    if (kapatildi || askida) return;
    zamanlayicilariTemizle();
    soketiKapat();
    const bu = surum;
    if (!etkinMi()) return durumuAyarla('kapali');
    if (typeof WebSocketSinifi !== 'function') {
      gunluk('Canlı bağlantı kullanılamıyor (WebSocket yok); REST yedeği kullanılacak.');
      return durumuAyarla('yedek', 'ws-yok');
    }
    if (baglanti !== 'yedek') durumuAyarla('baglaniyor');
    let taban = null;
    let anahtar = null;
    let reddedilmis = false;
    let dogrulanamadi = false;
    let bekletilmis = false;
    try {
      anahtar = await anahtarAl();
    } catch {
      // 1.4.0 (o-57): tarayıcı oturumunun erişim anahtarı şimdi yenilenemedi (ağ ya da HA geçici sorunu): bu "anahtar yok" DEĞİLDİR;
      // artan beklemeyle yeniden denenir (REST yedeği bu arada çalışır). Anahtar gerçekten yoksa anahtarAl null döner, fırlatmaz.
      if (bu === surum && !kapatildi && !askida) koptu('anahtar-yenilenemedi');
      return;
    }
    try {
      // Yetki kesici: reddedilmiş anahtarla adres yoklaması bile yapılmaz (hiçbir şey ağa çıkmaz). Zaman aşımı sonrası
      // soğuma sürerken de (adrese bakılmaksızın) yoklama dahil hiçbir şey ağa çıkmaz.
      const parmakIziOn = anahtar && yetki ? yetki.parmakIzi(anahtar) : null;
      reddedilmis = !!parmakIziOn && yetki.reddedildiMi(parmakIziOn);
      // Belirsiz deneme sınırı aşılmış anahtar da engelliMi sayılır; ama o geçici bir soğuma DEĞİL, kullanıcı onayı bekleyen kalıcı
      // bir durumdur: 'duraklatildi' döngüsüne sokulmaz (aşağıda kaliciYedek), adres yoklaması da yapılmaz.
      dogrulanamadi = !!parmakIziOn && !reddedilmis && !!yetki.dogrulanamadiMi?.(parmakIziOn);
      bekletilmis = !!parmakIziOn && !reddedilmis && !dogrulanamadi && yetki.engelliMi(parmakIziOn);
      taban = anahtar && !reddedilmis && !dogrulanamadi && !bekletilmis ? await adresAl() : null;
    } catch {
      taban = null;
    }
    if (bu !== surum || kapatildi || askida) return; // bu arada durduruldu ya da yeni deneme başladı
    if (!anahtar) return durumuAyarla('kapali', 'anahtar-yok'); // anahtar kaydedilince yenidenBaglan çağrılır
    if (reddedilmis) return kaliciYedek('yetki'); // yeni (farklı parmak izli) anahtar kaydedilince yenidenBaglan çağrılır
    if (dogrulanamadi) return kaliciYedek('dogrulanamadi'); // kullanıcı Ayarlar'dan "Yeniden dene" (yenidenBaglan) diyene kadar döngü yok
    if (bekletilmis) return koptu('duraklatildi'); // soğuma bitince yeniden denenir
    if (!taban) return koptu('adres-yok');
    const url = anahtarIcinGuvenliAdresMi(taban) ? p.websocketAdresi(taban) : null;
    if (!url) {
      gunluk('Canlı bağlantı atlandı: adres güvenli değil ya da geçersiz.');
      return kaliciYedek('adres-guvenli-degil');
    }
    let parmakIzi = null;
    if (yetki) {
      // Yetki kesici: reddedilmiş anahtarla ya da duraklatılmış adrese soket açılmaz; önce tek doğrulama (REST ile paylaşılır).
      parmakIzi = yetki.parmakIzi(anahtar);
      if (yetki.engelliMi(parmakIzi, taban)) return engeldenKop(bu, parmakIzi);
      try {
        await yetki.gecit(taban, anahtar);
      } catch (hata) {
        if (bu !== surum || kapatildi || askida) return;
        if (hata?.tur === 'yetki' || hata?.tur === 'reddedildi') return kaliciYedek('yetki');
        // Belirsiz deneme sınırı aşıldı ya da doğrulanmamış anahtar ev içi 403 yüzünden dış adrese gönderilmedi: kullanıcı
        // Ayarlar'dan "Yeniden dene" (yenidenBaglan) diyene kadar yeniden bağlanma döngüsü YOK.
        if (hata?.tur === 'dogrulanamadi' || hata?.tur === 'yerel-yasak') return kaliciYedek(hata.tur);
        return koptu(hata?.tur === 'duraklatildi' || hata?.tur === 'belirsiz' ? 'duraklatildi' : 'dogrulama');
      }
      if (bu !== surum || kapatildi || askida) return;
    }
    let s;
    try {
      s = new WebSocketSinifi(url);
    } catch {
      return koptu('olusturulamadi');
    }
    soket = s;
    zaman.clearTimeout(kurulumZamanlayici);
    kurulumZamanlayici = zaman.setTimeout(() => {
      kurulumZamanlayici = null;
      if (bu === surum && baglanti !== 'canli') koptu('zaman-asimi'); // auth/abonelik/get_states yanıtı gelmedi
    }, KURULUM_ZAMAN_ASIMI_MS);
    const oturum = { anahtar, parmakIzi, taban };
    oturumParmakIzi = parmakIzi;
    oturumTaban = taban;
    authBekliyor = false;
    s.addEventListener('message', (olay) => mesajIsle(bu, s, oturum, olay?.data));
    s.addEventListener('close', () => {
      if (bu === surum) koptu('kapandi');
    });
    s.addEventListener('error', () => {
      /* ayrıntı bilerek okunmaz (adres/anahtar sızmasın); kapanış olayı yeniden denemeyi başlatır */
    });
  }

  return {
    /** Bağlantıyı başlatır (ayar kapalıysa/anahtar yoksa 'kapali' kalır). */
    baslat() {
      kapatildi = false;
      askida = false;
      kalici = false;
      deneme = 0;
      return baglan();
    },
    /** Tümüyle durdurur (uygulama çıkışı, ayar kapatıldı). */
    durdur() {
      kapatildi = true;
      zamanlayicilariTemizle();
      soketiKapat();
      durumuAyarla('kapali');
    },
    /** Uyku/oturum kilidi: soketi kapatır, uyanana kadar yeniden denemez. */
    askiyaAl() {
      askida = true;
      zamanlayicilariTemizle();
      soketiKapat();
      if (baglanti !== 'kapali') durumuAyarla(baglanti === 'canli' ? 'baglaniyor' : baglanti, 'askida');
    },
    /** Hemen yeniden bağlan (uyanış, kilit açıldı, anahtar kaydedildi, adres ya da izlenen küme değişti). */
    yenidenBaglan() {
      kapatildi = false;
      askida = false;
      kalici = false;
      deneme = 0;
      return baglan();
    },
    /** Canlı bağlantı açıkken izlenen küme değiştiğinde soketi kapatmadan aboneliği yeniler. */
    abonelikYenile() {
      if (baglanti !== 'canli' || !soket) {
        kapatildi = false;
        askida = false;
        kalici = false;
        deneme = 0;
        return baglan();
      }
      if (abonelik) {
        gonder(soket, p.abonelikSilMesaji(yeniId('abonelik-sil'), abonelik.id));
        abonelik = null;
      }
      bekleyenAbonelikleriEskit(); // bir önceki yenileme henüz yanıtlanmadıysa onun aboneliği yanıtı gelince silinir
      aboneOl(soket);
      return true;
    },
    durum: () => ({ baglanti, canli: baglanti === 'canli', neden: sonNeden }),
    canliMi: () => baglanti === 'canli',
    /** Kimlik, canlı aboneliğin izlenen kümesinde mi (durum olayları yalnız bunlar için depoya işlenir)? */
    izleniyorMu: (kimlik) => izlenenKume.has(kimlik),

    /**
     * 1.4.0: yalnız okuyan WS komutu (ha-ws-protokol.js OKUMA_KOMUTLARI). Yalnız canlı bağlantıda gönderilir; HİÇBİR zaman
     * reddetmez (hata da sonuçtur).
     * @param {{type: string}} ileti ör. { type: 'config/area_registry/list' }
     * @param {{zamanAsimiMs?: number}} [secenek]
     * @returns {Promise<{ok: true, sonuc: unknown} | {ok: false, kod: string}>}
     *   kod: 'baglanti-yok' | 'izinsiz-komut' | 'cok-sik' | 'gonderilemedi' | 'zaman-asimi' | 'koptu' | HA hata kodu ('unauthorized', 'unknown_command'...)
     */
    komut(ileti, { zamanAsimiMs = KOMUT_ZAMAN_ASIMI_MS } = {}) {
      if (!p.komutMesaji(0, ileti, p.OKUMA_KOMUTLARI)) return Promise.resolve({ ok: false, kod: 'izinsiz-komut' });
      const s = soket;
      if (baglanti !== 'canli' || !s) return Promise.resolve({ ok: false, kod: 'baglanti-yok' });
      if (komutlar.size >= EN_COK_BEKLEYEN_KOMUT) return Promise.resolve({ ok: false, kod: 'cok-sik' });
      return new Promise((coz) => {
        const id = yeniId('komut');
        const zamanlayici = zaman.setTimeout(() => {
          if (!komutlar.has(id)) return;
          komutlar.delete(id);
          bekleyenler.delete(id);
          coz({ ok: false, kod: 'zaman-asimi' });
        }, zamanAsimiMs);
        komutlar.set(id, { coz, zamanlayici });
        if (!gonder(s, p.komutMesaji(id, ileti, p.OKUMA_KOMUTLARI))) {
          zaman.clearTimeout(zamanlayici);
          komutlar.delete(id);
          bekleyenler.delete(id);
          coz({ ok: false, kod: 'gonderilemedi' });
        }
      });
    },

    /**
     * 1.4.0: yalnız okuyan WS aboneliği (ABONELIK_KOMUTLARI). Bağlantı canlıysa hemen, değilse bir sonraki canlı bağlantıda
     * kurulur ve her yeniden bağlanmada yenilenir. Dinleyici { olay } (HA 'event' iletisinin event alanı; güvenilmez veri:
     * çağıran doğrular) ya da { hata: kod } alır. 'unauthorized' / 'unknown_command' hatasında abonelik kalıcı olarak düşer.
     * @returns {() => void} aboneliği bırakır (idempotent); izinsiz türde ya da sınırda etkisiz işlev döner
     */
    abone(ileti, dinleyici) {
      if (typeof dinleyici !== 'function' || !p.komutMesaji(0, ileti, p.ABONELIK_KOMUTLARI)) return () => {};
      if (ekAbonelikler.size >= EN_COK_EK_ABONELIK) return () => {};
      sonEkAbonelikAnahtari += 1;
      const anahtar = sonEkAbonelikAnahtari;
      const kayit = { ileti: { ...ileti }, dinleyici, id: null };
      ekAbonelikler.set(anahtar, kayit);
      if (baglanti === 'canli' && soket) ekAboneligiGonder(soket, anahtar, kayit);
      return () => {
        if (ekAbonelikler.get(anahtar) !== kayit) return;
        ekAbonelikler.delete(anahtar);
        if (kayit.id !== null && soket && baglanti === 'canli') gonder(soket, p.abonelikSilMesaji(yeniId('abonelik-sil'), kayit.id));
        kayit.id = null;
      };
    },
  };
}

module.exports = { PING_ARALIGI_MS, PONG_BEKLEME_MS, KURULUM_ZAMAN_ASIMI_MS, YEDEGE_GECIS_DENEMESI, haWsOlustur };
