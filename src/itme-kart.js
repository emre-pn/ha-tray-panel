'use strict';

/**
 * Düğmeli itme bildirimi kartı (o-61): HA'nın mobile_app bildirimi eylem düğmeleri taşıyorsa ekranın sağ alt köşesinde (köşe bildiriminin
 * üstünde) küçük bir kart görünür. Windows bildirimi bu uygulamaya hangi düğmeye basıldığını güvenle bildirmediği için düğmeli bildirim
 * kendi küçük penceresinde gösterilir; düğmesiz bildirimler Windows bildirimi olarak main.js'ten gider.
 *
 * Güvenlik:
 *  - Yalnız yerel dosya sayfası (itme-kart.html, katı CSP, harici betik), contextIsolation + sandbox (yerel-pencere.js).
 *  - Sayfa YALNIZ başlık, ileti ve düğme BAŞLIKLARINI alır (textContent ile yazar). Eylem kimlikleri bu süreçte kalır; sayfa düğme SIRASINI
 *    ve görünen kartın numarasını yollar, hangi kimliğin HA'ya gideceğini ana süreç (itme-kuyrugu.js) belirler. Eski/başka karta ait
 *    ya da aralık dışı sıra reddedilir; her düğme tek kullanımlıktır.
 *  - Kart odak ALMADAN açılır (showInactive); 45 sn sonra ya da × ile kapanır. Süre dolması HA'ya hiçbir şey göndermez.
 * focusable pencerenin Windows'ta tam ekran oyun/film üstünde nasıl göründüğü DENENMEDİ (köşe bildirimiyle aynı soru).
 */

const path = require('node:path');
const { screen } = require('electron');
const { yerelPencereOlustur, yerelOlaydanMi, malzemeUygula } = require('./yerel-pencere');
const { KOSE_BOYUTU, koseKonumu } = require('./lib/pencere-yerlesim');
const { itmeKuyruguOlustur } = require('./lib/itme-kuyrugu');
const { cokmeSayilirMi, cokmeNedeniMetni } = require('./lib/cokme-siniri');

const ITME_HTML = path.join(__dirname, 'itme-kart.html');
const PRELOAD_ITME = path.join(__dirname, 'preload-itme.js');
const KART_BOYUTU = Object.freeze({ width: 360, height: 176 });
const KART_SURESI_MS = 45_000;
const KOSE_ARASI_BOSLUK = 12; // köşe bildirimi penceresiyle çakışmasın
const OPAK_MALZEME = Object.freeze({ malzeme: 'yok', secenekler: Object.freeze({ backgroundColor: '#1b1f27' }) });

/**
 * @param {object} secenek
 * @param {(m: string) => void} [secenek.gunluk]
 * @param {(bildirim: {baslik: string|null, mesaj: string, etiket: string|null, dugmeler: object[]}) => void} [secenek.yedekGoster] kart gösterilemediğinde (Windows bildirimi)
 * @param {() => ({malzeme: string, secenekler: object})} [secenek.malzemeAl]
 * @param {() => ({x:number,y:number,width:number,height:number}|null)} [secenek.engelAl] açık hızlı panel/palet sınırları
 * @param {() => string} [secenek.dilAl] etkin arayüz dili
 * @param {() => object|null} [secenek.gorunumAl] görünüm modeli (src/lib/gorunum.js)
 * @param {() => number} [secenek.metinOlcegiAl]
 * @param {() => string} [secenek.varsayilanBaslikAl] başlıksız bildirim için yerelleştirilmiş başlık
 */
function itmeKartiOlustur({ gunluk = () => {}, yedekGoster = () => {}, malzemeAl = () => OPAK_MALZEME, engelAl = () => null, dilAl = null, gorunumAl = () => null, metinOlcegiAl = () => 1, varsayilanBaslikAl = () => '' } = {}) {
  const kuyruk = itmeKuyruguOlustur();
  let pencere = null;
  let yuklendi = false;
  let bekleyen = null; // sayfa yüklenmeden gelen kart
  let zamanlayici = null;
  let uygulananOlcek = 1;

  const canliMi = () => !!pencere && !pencere.isDestroyed();

  function metinOlcegi() {
    let olcek = 1;
    try {
      olcek = Number(metinOlcegiAl());
    } catch {
      olcek = 1;
    }
    return Number.isFinite(olcek) && olcek >= 1 && olcek <= 2 ? olcek : 1;
  }

  function gorunumEki() {
    try {
      const g = gorunumAl();
      return g ? { gorunum: g } : {};
    } catch {
      return {};
    }
  }

  function dilGonder() {
    if (!dilAl || !canliMi() || !yuklendi) return;
    try {
      pencere.webContents.send('dil:degisti', { dil: dilAl() });
    } catch {
      gunluk('İtme kartı dili güncellenemedi.');
    }
  }

  /** Pencere kullanılamaz: kartlar Windows bildirimine düşer, durum sıfırlanır; sonraki bildirim pencereyi yeniden oluşturur. */
  function sifirla(bu, neden) {
    if (pencere !== bu) return;
    gunluk(`İtme kartı penceresi sıfırlandı (${neden}); sonraki bildirimde yeniden oluşturulacak.`);
    clearTimeout(zamanlayici);
    // Görünen kart + sıradakiler: hepsi düğmesiz Windows bildirimine düşer (düğmeler çalışmaz, ileti kaybolmaz).
    const kartlar = new Set(bekleyen ? [bekleyen] : []);
    for (let s = kuyruk.gorunen(); s; s = kuyruk.bitir(s.kartNo).sonraki) kartlar.add(s);
    bekleyen = null;
    pencere = null;
    yuklendi = false;
    try {
      if (!bu.isDestroyed()) bu.destroy();
    } catch {
      /* zaten yok edilmiş */
    }
    kuyruk.sifirla();
    for (const k of kartlar) yedekGoster(k);
  }

  function olustur() {
    if (canliMi()) return;
    yuklendi = false;
    uygulananOlcek = 1;
    try {
      const bu = yerelPencereOlustur({
        preload: PRELOAD_ITME,
        secenekler: {
          width: KART_BOYUTU.width,
          height: KART_BOYUTU.height,
          show: false,
          frame: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          roundedCorners: true,
          ...malzemeAl().secenekler,
        },
      });
      pencere = bu;
      const wc = bu.webContents;
      wc.once('did-finish-load', () => {
        if (pencere !== bu) return;
        yuklendi = true;
        dilGonder();
        if (bekleyen) {
          const kart = bekleyen;
          bekleyen = null;
          gosterIc(kart);
        }
      });
      wc.on('render-process-gone', (_olay, ayrinti) => {
        if (!cokmeSayilirMi(ayrinti?.reason)) return;
        sifirla(bu, `sayfa-sureci-kapandi:${cokmeNedeniMetni(ayrinti?.reason)}`);
      });
      wc.on('did-fail-load', (_olay, hataKodu, _aciklama, _url, anaCerceve) => {
        if (anaCerceve === false || hataKodu === -3 /* ERR_ABORTED */) return;
        sifirla(bu, `sayfa-yuklenemedi:${hataKodu}`);
      });
      wc.on('unresponsive', () => gunluk('İtme kartı sayfası yanıt vermiyor.'));
      bu.on('closed', () => {
        if (pencere !== bu) return;
        pencere = null;
        yuklendi = false;
      });
      bu.loadFile(ITME_HTML).catch(() => sifirla(bu, 'yukleme-reddedildi'));
    } catch {
      pencere = null;
      gunluk('İtme kartı penceresi oluşturulamadı.');
    }
  }

  function gizle() {
    clearTimeout(zamanlayici);
    bekleyen = null; // gösterilecek kart kalmadı (yüklenirken HA kartı temizlediyse sayfa yüklenince eski kart çıkmasın)
    if (canliMi()) pencere.hide();
  }

  function konumla() {
    const alan = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    let engel = null;
    try {
      engel = engelAl();
    } catch {
      engel = null;
    }
    const olcek = metinOlcegi();
    const boyut = olcek === 1 ? KART_BOYUTU : { width: KART_BOYUTU.width * olcek, height: KART_BOYUTU.height * olcek };
    const yer = koseKonumu(alan, boyut, undefined, engel);
    // Köşe bildirimi (sağ alt) ile çakışmasın: köşe bildiriminin konumu aynı metin ölçeği ve aynı engelle hesaplanır (yazı büyüyünce o da büyür);
    // kart onunla aynı sütunda kesişiyorsa onun üstünde durur (yer yoksa çalışma alanının üstüne yaslanır). Panelin yanına (başka sütuna)
    // taşınan kart yukarı itilmez.
    const kose = koseKonumu(alan, olcek === 1 ? KOSE_BOYUTU : { width: KOSE_BOYUTU.width * olcek, height: KOSE_BOYUTU.height * olcek }, undefined, engel);
    const cakisir = yer.x < kose.x + kose.width && kose.x < yer.x + yer.width && yer.y < kose.y + kose.height && kose.y < yer.y + yer.height;
    const y = cakisir ? Math.max(Math.round(alan.y), kose.y - KOSE_ARASI_BOSLUK - yer.height) : yer.y;
    pencere.setBounds({ ...yer, y });
    if (olcek !== uygulananOlcek && typeof pencere.webContents.setZoomFactor === 'function') {
      pencere.webContents.setZoomFactor(olcek);
      uygulananOlcek = olcek;
    }
  }

  function gosterIc(kart) {
    if (!canliMi() || !yuklendi) return;
    try {
      konumla();
      pencere.setAlwaysOnTop(true, 'screen-saver');
      const yuk = {
        kartNo: kart.kartNo,
        baslik: kart.baslik ?? varsayilanBaslikAl(),
        mesaj: kart.mesaj,
        dugmeler: kart.dugmeler.map((d) => d.baslik), // eylem kimlikleri sayfaya GİTMEZ
        sureMs: KART_SURESI_MS,
        malzeme: malzemeAl().malzeme,
        ...gorunumEki(),
      };
      pencere.webContents.send('itme:goster', yuk);
      if (!pencere.isVisible()) pencere.showInactive(); // odak almadan göster
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => bitir(kart.kartNo), KART_SURESI_MS);
    } catch {
      gunluk('İtme kartı gösterilemedi.');
      // Kart "görünen" işaretli kalırsa zamanlayıcı hiç kurulmaz ve sonraki kartlar sonsuza dek sırada bekler: kartı kapat, Windows
      // bildirimine düşür (ileti kaybolmaz) ve sıradakine geç. Kuyruk sınırlı olduğundan özyineleme sonlanır.
      const sonuc = kuyruk.bitir(kart.kartNo);
      try {
        yedekGoster(kart);
      } catch {
        gunluk('İtme kartı yedek bildirimi gösterilemedi.');
      }
      if (sonuc.kapandi) ilerle(sonuc.sonraki);
    }
  }

  /** Kuyruktan gelen kartı çiz; pencere hiç kurulamadıysa Windows bildirimine düşür ve sıradakine geç. */
  function kartiCiz(kart) {
    if (!canliMi()) olustur();
    if (!canliMi()) {
      kuyruk.bitir(kart.kartNo);
      yedekGoster(kart);
      const sonraki = kuyruk.gorunen();
      if (sonraki) kartiCiz(sonraki);
      return;
    }
    if (!yuklendi) {
      bekleyen = kart;
      return;
    }
    gosterIc(kart);
  }

  function ilerle(sonraki) {
    clearTimeout(zamanlayici);
    if (sonraki) kartiCiz(sonraki);
    else gizle();
  }

  function bitir(kartNo) {
    const sonuc = kuyruk.bitir(kartNo);
    if (sonuc.kapandi) ilerle(sonuc.sonraki);
    return sonuc.kapandi;
  }

  return {
    /**
     * @param {{ baslik: string|null, mesaj: string, etiket: string|null, dugmeler: {eylem: string, baslik: string}[] }} bildirim
     * @returns {boolean} gösterildi ya da sıraya alındı
     */
    goster(bildirim) {
      const sonuc = kuyruk.ekle(bildirim);
      if (sonuc.tur === 'siraya') return true;
      kartiCiz(sonuc.kart);
      return true;
    },

    /** clear_notification: aynı etiketli kart kapanır / sıradan çıkar. */
    temizle(etiket) {
      const sonuc = kuyruk.temizle(etiket);
      if (sonuc.kapandi) ilerle(sonuc.sonraki);
    },

    /** Sayfa × düğmesi: görünen kart kapanır. */
    kapatIstegi(kartNo) {
      return bitir(kartNo);
    },

    /**
     * Sayfadan gelen düğme isteği: görünen kartın var olan düğme sırası kabul edilir ve kart kapanır.
     * @returns {{ eylem: string, etiket: string|null }|null}
     */
    eylemSec(kartNo, sira) {
      const sonuc = kuyruk.eylemSec(kartNo, sira);
      if (!sonuc) return null;
      ilerle(sonuc.sonraki);
      return { eylem: sonuc.eylem, etiket: sonuc.etiket };
    },

    /** IPC gönderen denetimi: istek bu kartın yerel sayfasının ana çerçevesinden mi geldi? */
    olaydanMi: (olay) => yerelOlaydanMi(olay, pencere, ITME_HTML),

    dilDegisti: dilGonder,

    malzemeyiUygula() {
      if (canliMi()) malzemeUygula(pencere, malzemeAl());
    },

    /** Ayar kapandı / kayıt silindi: bekleyen ve görünen kartlar kaldırılır (HA'ya hiçbir şey gitmez). */
    hepsiniKapat() {
      kuyruk.sifirla();
      bekleyen = null;
      gizle();
    },

    /** Uygulama kapanıyor. */
    kapat() {
      clearTimeout(zamanlayici);
      kuyruk.sifirla();
      bekleyen = null;
      const eski = pencere;
      pencere = null; // önce boşalt: yok edilirken gelen olaylar sıfırlamayı tetiklemesin
      if (eski && !eski.isDestroyed()) eski.destroy();
    },

    gorunen: () => kuyruk.gorunen(),
  };
}

module.exports = { ITME_HTML, KART_BOYUTU, KART_SURESI_MS, itmeKartiOlustur };
