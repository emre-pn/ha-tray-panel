'use strict';

/**
 * Köşe bildirimi (hiz-04): ekranın sağ alt köşesinde 1,5 sn (hatada 3 sn) görünen, odak ALMAYAN küçük pencere.
 * Eylem başarılı olunca anında gösterilir; Windows bildirimi yalnız hatada çıkar.
 *
 * Pencere ilk kullanımdan önce (açılıştan ~1 sn sonra) yüklenir; açılış yavaşlamasın. focusable:false pencerenin
 * Windows'ta gerçekten odak almadığı ve tam ekran oyunun üstünde görünüp görünmediği DENENMEDİ (soru-4: oyun/tam
 * ekrana özel iş yok). Renderer yalnız `kose:goster` yükünü alır ve textContent ile yazar.
 */

const path = require('node:path');
const { screen } = require('electron');
const { yerelPencereOlustur, malzemeUygula } = require('./yerel-pencere');
const { KOSE_BOYUTU, koseKonumu } = require('./lib/pencere-yerlesim');
const { kisalt } = require('./lib/metin');
const { cokmeSayilirMi, cokmeNedeniMetni } = require('./lib/cokme-siniri');

const KOSE_HTML = path.join(__dirname, 'kose-bildirim.html');
const PRELOAD_KOSE = path.join(__dirname, 'preload-kose.js');
const SURE_BASARI_MS = 1500;
const SURE_HATA_MS = 3000;
const GIZLEME_PAYI_MS = 150; // sayfadaki solma animasyonu bitsin
const METIN_SINIRI = 100;
const ILK_YUKLEME_GECIKMESI_MS = 1000;
const OPAK_MALZEME = Object.freeze({ malzeme: 'yok', secenekler: Object.freeze({ backgroundColor: '#1b1f27' }) });

/**
 * @param {{ gunluk?: (m: string) => void, yedekGoster?: (b: {tur: string, metin: string}) => void, malzemeAl?: () => ({malzeme: string, secenekler: object}), engelAl?: () => ({x:number,y:number,width:number,height:number}|null) }} secenek
 *   yedekGoster: sayfa yüklenemediği için gösterilemeyen bekleyen bildirim için (ör. Windows bildirimi)
 *   malzemeAl: Windows 11 pencere malzemesi (src/lib/malzeme.js, gorunum-11); verilmezse opak koyu arka plan
 *   engelAl: açık hızlı panel/palet penceresinin sınırları (g-09); bildirim onunla çakışırsa panelin üstüne yerleşir. Verilmezse
 *   (ya da okunamazsa) bildirim her zaman sağ alt köşededir.
 *   dilAl: etkin arayüz dili ('tr' | 'en'); verilirse sayfa yüklenince ve dil değişince 'dil:degisti' ({ dil }) iletisi gider (ana süreç verir).
 */
function koseBildirimiOlustur({ gunluk = () => {}, yedekGoster = () => {}, malzemeAl = () => OPAK_MALZEME, engelAl = () => null, dilAl = null } = {}) {
  let pencere = null;
  let yuklendi = false;
  let bekleyen = null;
  let gizlemeZamanlayicisi = null;
  let yuklemeZamanlayicisi = null;

  const canliMi = () => !!pencere && !pencere.isDestroyed();

  /**
   * Pencere kullanılamaz hale geldi (sayfa yüklenemedi ya da sayfa süreci öldü): pencereyi yok et, durumu sıfırla; sonraki
   * goster() pencereyi yeniden oluşturur. Gösterilemeyen bekleyen bildirim yedeğe (Windows bildirimi) düşer.
   * `bu`: sıfırlamayı isteyen pencere; zaten başka pencereyle değiştirilmişse hiçbir şey yapılmaz (çift işlem yok).
   */
  function sifirla(bu, neden) {
    if (pencere !== bu) return;
    gunluk(`Köşe bildirimi penceresi sıfırlandı (${neden}); sonraki bildirimde yeniden oluşturulacak.`);
    clearTimeout(gizlemeZamanlayicisi);
    const kayit = bekleyen;
    bekleyen = null;
    pencere = null;
    yuklendi = false;
    try {
      if (!bu.isDestroyed()) bu.destroy();
    } catch {
      /* zaten yok edilmiş */
    }
    if (kayit) yedekGoster(kayit);
  }

  function olustur() {
    if (canliMi()) return;
    yuklendi = false;
    try {
      const bu = yerelPencereOlustur({
        preload: PRELOAD_KOSE,
        secenekler: {
          width: KOSE_BOYUTU.width,
          height: KOSE_BOYUTU.height,
          show: false,
          frame: false,
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          roundedCorners: true, // Windows 11'de çerçevesiz pencere yuvarlak köşeli (varsayılan; gorunum-11). `transparent` KULLANILMAZ.
          ...malzemeAl().secenekler, // backgroundMaterial (acrylic/mica; Windows 11 22H2+) ve arka plan rengi
        },
      });
      pencere = bu;
      const wc = bu.webContents;
      wc.once('did-finish-load', () => {
        if (pencere !== bu) return;
        yuklendi = true;
        if (dilAl) dilGonder();
        if (bekleyen) gosterIc(bekleyen);
      });
      // Pencere gün boyu gizli yaşar: sayfa süreci ölürse ya da ana çerçeve yüklenemezse yeniden oluşturulur (hata-06 ile aynı ilke).
      wc.on('render-process-gone', (_olay, ayrinti) => {
        if (!cokmeSayilirMi(ayrinti?.reason)) return; // normal kapanış
        sifirla(bu, `sayfa-sureci-kapandi:${cokmeNedeniMetni(ayrinti?.reason)}`);
      });
      wc.on('did-fail-load', (_olay, hataKodu, _aciklama, _url, anaCerceve) => {
        if (anaCerceve === false || hataKodu === -3 /* ERR_ABORTED */) return;
        sifirla(bu, `sayfa-yuklenemedi:${hataKodu}`);
      });
      wc.on('unresponsive', () => gunluk('Köşe bildirimi sayfası yanıt vermiyor.'));
      bu.on('closed', () => {
        if (pencere !== bu) return;
        pencere = null;
        yuklendi = false;
      });
      bu.loadFile(KOSE_HTML).catch(() => {
        sifirla(bu, 'yukleme-reddedildi'); // did-fail-load zaten sıfırladıysa bir şey yapmaz
      });
    } catch {
      pencere = null;
      gunluk('Köşe bildirimi penceresi oluşturulamadı.');
    }
  }

  /** Sayfaya etkin dili bildirir ('dil:degisti'); yalnız dilAl verildiyse. */
  function dilGonder() {
    if (!canliMi() || !yuklendi) return;
    try {
      pencere.webContents.send('dil:degisti', { dil: dilAl() });
    } catch {
      gunluk('Köşe bildirimi dili güncellenemedi.');
    }
  }

  function gosterIc({ tur, metin }) {
    if (!canliMi() || !yuklendi) return;
    bekleyen = null;
    const sureMs = tur === 'hata' ? SURE_HATA_MS : SURE_BASARI_MS;
    try {
      const alan = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      let engel = null;
      try {
        engel = engelAl();
      } catch {
        engel = null; // panel sınırı okunamadı: varsayılan köşe konumu
      }
      pencere.setBounds(koseKonumu(alan, undefined, undefined, engel));
      pencere.setAlwaysOnTop(true, 'screen-saver');
      pencere.setIgnoreMouseEvents(true);
      pencere.webContents.send('kose:goster', { tur, metin: kisalt(metin, METIN_SINIRI), sureMs, malzeme: malzemeAl().malzeme });
      if (!pencere.isVisible()) pencere.showInactive(); // odak almadan göster
      clearTimeout(gizlemeZamanlayicisi);
      gizlemeZamanlayicisi = setTimeout(() => {
        if (canliMi()) pencere.hide();
      }, sureMs + GIZLEME_PAYI_MS);
    } catch {
      gunluk('Köşe bildirimi gösterilemedi.');
    }
  }

  return {
    /** Açılıştan biraz sonra pencereyi arka planda yükler. */
    hazirla(gecikmeMs = ILK_YUKLEME_GECIKMESI_MS) {
      clearTimeout(yuklemeZamanlayicisi);
      yuklemeZamanlayicisi = setTimeout(olustur, gecikmeMs);
    },
    /** Arayüz dili değişti: sayfaya 'dil:degisti' ({ dil }) bildirilir (pencere gizli olsa da). */
    dilDegisti() {
      if (dilAl) dilGonder();
    },
    /** Ayarlar > Görünüm değişti: var olan pencerenin arka plan malzemesi güncellenir; sayfa yeni değeri sonraki bildirimde alır. */
    malzemeyiUygula() {
      if (canliMi()) malzemeUygula(pencere, malzemeAl());
    },
    /**
     * @param {{ tur: 'ok'|'hata', metin: string }} bildirim
     * @returns {boolean} gösterildi (ya da yüklenince gösterilecek); pencere hiç oluşturulamadıysa false
     */
    goster({ tur, metin }) {
      const kayit = { tur: tur === 'hata' ? 'hata' : 'ok', metin: String(metin ?? '') };
      if (!canliMi()) olustur();
      if (!canliMi()) return false;
      if (!yuklendi) {
        bekleyen = kayit; // yükleme bitince gösterilir
        return true;
      }
      gosterIc(kayit);
      return true;
    },
    kapat() {
      clearTimeout(gizlemeZamanlayicisi);
      clearTimeout(yuklemeZamanlayicisi);
      const eski = pencere;
      pencere = null; // önce boşalt: yok edilirken gelen olaylar sıfırlamayı tetiklemesin
      if (eski && !eski.isDestroyed()) eski.destroy();
    },
  };
}

module.exports = { SURE_BASARI_MS, SURE_HATA_MS, koseBildirimiOlustur };
