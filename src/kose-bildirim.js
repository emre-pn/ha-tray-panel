'use strict';

/**
 * Köşe bildirimi (hiz-04): ekranın sağ alt köşesinde 1,5 sn (hatada 3 sn) görünen, odak ALMAYAN küçük pencere.
 * Eylem başarılı olunca anında gösterilir; Windows bildirimi yalnız hatada çıkar.
 * 1.4.0: 'bilgi' türü (bildirim merkezi ve varlık uyarıları): 6 sn görünür, sırayla gösterilir (en çok 5 bekleyen). Eylem geri
 * bildirimi (ok / hata) hemen gösterilir; bekleyen bilgi bildirimleri o bitince sırayla görünür.
 *
 * Pencere ilk kullanımdan önce (açılıştan ~1 sn sonra) yüklenir; açılış yavaşlamasın. focusable:false pencerenin
 * Windows'ta gerçekten odak almadığı ve tam ekran oyunun üstünde görünüp görünmediği DENENMEDİ (soru-4: oyun/tam
 * ekrana özel iş yok). Renderer yalnız `kose:goster` yükünü alır ve textContent ile yazar.
 */

const path = require('node:path');
const { screen, systemPreferences } = require('electron');
const { yerelPencereOlustur, malzemeUygula } = require('./yerel-pencere');
const { KOSE_BOYUTU, koseKonumu } = require('./lib/pencere-yerlesim');
const { kisalt } = require('./lib/metin');
const { cokmeSayilirMi, cokmeNedeniMetni } = require('./lib/cokme-siniri');

const KOSE_HTML = path.join(__dirname, 'kose-bildirim.html');
const PRELOAD_KOSE = path.join(__dirname, 'preload-kose.js');
const SURE_BASARI_MS = 1500;
const SURE_HATA_MS = 3000;
const SURE_BILGI_MS = 6000;
const BILGI_METIN_SINIRI = 140;
const BILGI_SIMGE_SINIRI = 8;
const BILGI_KUYRUK_SINIRI = 5;
// 1.6.1: pencere bütün olarak (zemin + içerik) solar; sayfa yalnız içeriği canlandırır. Akrilik zemin pencereye aittir: kart pencere
// içinde kayıp solunca zemin yerinde kalıyor, şekil bozuk görünüyor ve sonda boş bir kutu kalıyordu.
const ILK_KARE_MS = 34; // pencere saydam açılır: sayfa yeni bildirimi çizene dek gizliyken kalan ÖNCEKİ bildirimin karesi görünmesin
const GIRIS_SOLMA_MS = 140;
const CIKIS_SOLMA_MS = 120;
const SOLMA_ADIMI_MS = 20;
const METIN_SINIRI = 100;
const ILK_YUKLEME_GECIKMESI_MS = 1000;
const OZET_BASLIK_SINIRI = 60;
// 1.6.0 eylem özeti: simgesi çizilebilen alanlar (köşe sayfasındaki tabloyla aynı). Listede olmayan alan simgesiz (✓ / !) gösterilir.
const OZET_ALANLARI = new Set(['light', 'switch', 'input_boolean', 'fan', 'scene', 'script', 'automation', 'media_player', 'climate', 'water_heater', 'cover', 'humidifier', 'valve', 'vacuum', 'button', 'input_button']);

/**
 * Eylem özeti (1.6.0): { baslik, alt, alan, acik }. Başlık ve alt satır kısaltılır, alan beyaz listeden geçer; biri boşsa özet yok
 * sayılır ve bildirim tek satır metinle çıkar.
 */
function ozetDuzelt(ozet) {
  if (!ozet || typeof ozet !== 'object') return null;
  const baslik = kisalt(String(ozet.baslik ?? ''), OZET_BASLIK_SINIRI);
  const alt = kisalt(String(ozet.alt ?? ''), METIN_SINIRI);
  if (baslik === '' || alt === '') return null;
  return { baslik, alt, alan: OZET_ALANLARI.has(ozet.alan) ? ozet.alan : null, acik: ozet.acik === true };
}
const OPAK_MALZEME = Object.freeze({ malzeme: 'yok', secenekler: Object.freeze({ backgroundColor: '#1b1f27' }) });

/**
 * @param {{ gunluk?: (m: string) => void, yedekGoster?: (b: {tur: string, metin: string}) => void, malzemeAl?: () => ({malzeme: string, secenekler: object}), engelAl?: () => ({x:number,y:number,width:number,height:number}|null) }} secenek
 *   yedekGoster: sayfa yüklenemediği için gösterilemeyen bekleyen bildirim için (ör. Windows bildirimi)
 *   malzemeAl: Windows 11 pencere malzemesi (src/lib/malzeme.js, gorunum-11); verilmezse opak koyu arka plan
 *   engelAl: açık hızlı panel/palet penceresinin sınırları (g-09); bildirim onunla çakışırsa panelin üstüne yerleşir. Verilmezse
 *   (ya da okunamazsa) bildirim her zaman sağ alt köşededir.
 *   dilAl: etkin arayüz dili ('tr' | 'en' | 'de' | 'fr' | 'es'); verilirse sayfa yüklenince ve dil değişince 'dil:degisti' ({ dil }) iletisi gider (ana süreç verir).
 *   gorunumAl: görünüm modeli (src/lib/gorunum.js gorunumModeli: özel palet, yüksek karşıtlık, animasyon); null ise yüke eklenmez
 *   metinOlcegiAl: Ayarlar > Görünüm > Metin boyutu çarpanı (1, 1.15, 1.3, 1.5); pencere ve sayfa yakınlaştırması aynı oranda büyür (o-25)
 */
function koseBildirimiOlustur({ gunluk = () => {}, yedekGoster = () => {}, malzemeAl = () => OPAK_MALZEME, engelAl = () => null, dilAl = null, gorunumAl = () => null, metinOlcegiAl = () => 1 } = {}) {
  let pencere = null;
  let yuklendi = false;
  let bekleyen = null;
  let gorunenBilgi = null; // şu an ekranda olan 'bilgi' kaydı (eylem geri bildirimi onu keserse sıranın başına döner)
  let kuyruk = []; // gösterilmeyi bekleyen 'bilgi' bildirimleri
  let gizlemeZamanlayicisi = null;
  let yuklemeZamanlayicisi = null;
  let solmaZamanlayicisi = null;
  let opaklik = 1; // pencereye son yazılan opaklık
  let cikiyor = false; // pencere gizlenmek üzere soluyor (görünür sayılmaz: gelen bildirim solmayı keser)
  let uygulananOlcek = 1; // sayfaya son yazılan yakınlaştırma (yeni pencerede 1)

  const canliMi = () => !!pencere && !pencere.isDestroyed();

  /** Ayarlar'da "Hareketi azalt" ya da Windows'ta animasyon efektleri kapalıysa pencere solmadan görünür ve gizlenir. */
  function hareketAzaltildi() {
    try {
      if (gorunumAl()?.hareketiAzalt === true) return true;
    } catch {
      /* görünüm okunamadı: sistem ayarına bakılır */
    }
    try {
      return systemPreferences?.getAnimationSettings?.().prefersReducedMotion === true;
    } catch {
      return false;
    }
  }

  const opaklikDestekli = () => typeof pencere.setOpacity === 'function';

  function opaklikYaz(deger) {
    opaklik = deger;
    try {
      pencere.setOpacity(deger);
    } catch {
      /* desteklenmiyor: pencere opak kalır */
    }
  }

  function solmayiDurdur() {
    clearTimeout(solmaZamanlayicisi);
    solmaZamanlayicisi = null;
  }

  /** Pencere opaklığını adım adım hedefe götürür (yumuşak bitiş); bitince `bitince` çağrılır. */
  function solmaBaslat(hedef, sureMs, bitince) {
    solmayiDurdur();
    const bas = opaklik;
    const adimSayisi = Math.max(1, Math.round(sureMs / SOLMA_ADIMI_MS));
    let adim = 0;
    const ilerle = () => {
      if (!canliMi()) return;
      adim += 1;
      const oran = 1 - (1 - adim / adimSayisi) ** 2;
      opaklikYaz(adim >= adimSayisi ? hedef : bas + (hedef - bas) * oran);
      if (adim < adimSayisi) {
        solmaZamanlayicisi = setTimeout(ilerle, SOLMA_ADIMI_MS);
        return;
      }
      solmaZamanlayicisi = null;
      if (bitince) bitince();
    };
    solmaZamanlayicisi = setTimeout(ilerle, SOLMA_ADIMI_MS);
  }

  /** Pencereyi gösterir: önce saydam (ILK_KARE_MS), sonra solarak (hareket azaltılmışsa birden) belirir. Görünürken çağrılırsa solmayı geri alır. */
  function pencereyiGoster() {
    cikiyor = false;
    solmayiDurdur();
    if (!opaklikDestekli()) {
      if (!pencere.isVisible()) pencere.showInactive();
      return;
    }
    const belir = () => (hareketAzaltildi() ? opaklikYaz(1) : solmaBaslat(1, GIRIS_SOLMA_MS));
    if (pencere.isVisible()) {
      if (opaklik < 1) belir();
      return;
    }
    opaklikYaz(0);
    pencere.showInactive(); // odak almadan göster
    solmaZamanlayicisi = setTimeout(() => {
      solmaZamanlayicisi = null;
      if (canliMi()) belir();
    }, ILK_KARE_MS);
  }

  /** Pencereyi gizler: solarak (hareket azaltılmışsa ya da opaklık desteklenmiyorsa hemen). */
  function pencereyiGizle() {
    solmayiDurdur();
    if (!opaklikDestekli() || hareketAzaltildi()) {
      cikiyor = false;
      pencere.hide();
      return;
    }
    cikiyor = true;
    solmaBaslat(0, CIKIS_SOLMA_MS, () => {
      cikiyor = false;
      if (canliMi()) pencere.hide();
    });
  }

  /** Ayarlar > Görünüm > Metin boyutu çarpanı (geçersizse 1). */
  function metinOlcegi() {
    let olcek = 1;
    try {
      olcek = Number(metinOlcegiAl());
    } catch {
      olcek = 1;
    }
    return Number.isFinite(olcek) && olcek >= 1 && olcek <= 2 ? olcek : 1;
  }

  /** Görünüm modeli yüke eklenir; varsayılan görünümde (null) hiçbir anahtar eklenmez. */
  function gorunumEki() {
    try {
      const g = gorunumAl();
      return g ? { gorunum: g } : {};
    } catch {
      return {};
    }
  }

  /**
   * Pencere kullanılamaz hale geldi (sayfa yüklenemedi ya da sayfa süreci öldü): pencereyi yok et, durumu sıfırla; sonraki
   * goster() pencereyi yeniden oluşturur. Gösterilemeyen bekleyen bildirim yedeğe (Windows bildirimi) düşer.
   * `bu`: sıfırlamayı isteyen pencere; zaten başka pencereyle değiştirilmişse hiçbir şey yapılmaz (çift işlem yok).
   */
  function sifirla(bu, neden) {
    if (pencere !== bu) return;
    gunluk(`Köşe bildirimi penceresi sıfırlandı (${neden}); sonraki bildirimde yeniden oluşturulacak.`);
    clearTimeout(gizlemeZamanlayicisi);
    solmayiDurdur();
    cikiyor = false;
    opaklik = 1;
    const kayit = bekleyen;
    const sirada = kuyruk;
    bekleyen = null;
    gorunenBilgi = null;
    kuyruk = [];
    pencere = null;
    yuklendi = false;
    try {
      if (!bu.isDestroyed()) bu.destroy();
    } catch {
      /* zaten yok edilmiş */
    }
    if (kayit) yedekGoster(kayit);
    for (const k of sirada) yedekGoster(k);
  }

  function olustur() {
    if (canliMi()) return;
    yuklendi = false;
    uygulananOlcek = 1;
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

  /** Görünen bildirim bitti: sırada bekleyen bilgi varsa onu göster, yoksa pencereyi gizle. */
  function sonraki() {
    gorunenBilgi = null;
    if (!canliMi()) return;
    const siradaki = kuyruk.shift();
    if (siradaki) gosterIc(siradaki);
    else pencereyiGizle();
  }

  function gosterIc(kayit) {
    const { tur, metin, simge, ozet } = kayit;
    if (!canliMi() || !yuklendi) return;
    bekleyen = null;
    const bilgi = tur === 'bilgi';
    const sureMs = tur === 'hata' ? SURE_HATA_MS : bilgi ? SURE_BILGI_MS : SURE_BASARI_MS;
    try {
      const alan = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      let engel = null;
      try {
        engel = engelAl();
      } catch {
        engel = null; // panel sınırı okunamadı: varsayılan köşe konumu
      }
      const olcek = metinOlcegi();
      pencere.setBounds(koseKonumu(alan, olcek === 1 ? undefined : { width: KOSE_BOYUTU.width * olcek, height: KOSE_BOYUTU.height * olcek }, undefined, engel));
      if (olcek !== uygulananOlcek && typeof pencere.webContents.setZoomFactor === 'function') {
        pencere.webContents.setZoomFactor(olcek);
        uygulananOlcek = olcek;
      }
      pencere.setAlwaysOnTop(true, 'screen-saver');
      pencere.setIgnoreMouseEvents(true);
      const yuk = { tur, metin: kisalt(metin, bilgi ? BILGI_METIN_SINIRI : METIN_SINIRI), sureMs, malzeme: malzemeAl().malzeme, ...gorunumEki() };
      if (bilgi) yuk.simge = kisalt(simge, BILGI_SIMGE_SINIRI);
      else if (ozet) yuk.ozet = ozet;
      pencere.webContents.send('kose:goster', yuk);
      gorunenBilgi = bilgi ? kayit : null;
      pencereyiGoster();
      clearTimeout(gizlemeZamanlayicisi);
      gizlemeZamanlayicisi = setTimeout(sonraki, sureMs); // süre çizgisi bitince pencere solarak gizlenir (CIKIS_SOLMA_MS)
    } catch {
      gunluk('Köşe bildirimi gösterilemedi.');
    }
  }

  /**
   * Eylem geri bildirimi (ok / hata) hemen gösterilir; ama ekranda ya da yüklenmeyi bekleyen bir 'bilgi' (bildirim kuralı, 6 sn) onun yüzünden
   * kaybolmasın: kesilen bilgi sıranın BAŞINA döner ve eylem sonucu bitince yeniden gösterilir. Sıra doluysa en eskisi (bu) düşer.
   */
  function bilgiyiErtele() {
    const kesilen = bekleyen !== null && bekleyen.tur === 'bilgi' ? bekleyen : gorunenBilgi;
    gorunenBilgi = null;
    if (kesilen !== null && kuyruk.length < BILGI_KUYRUK_SINIRI) kuyruk.unshift(kesilen);
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
     * @param {{ tur: 'ok'|'hata'|'bilgi', metin: string, simge?: string, ozet?: {baslik: string, alt: string, alan?: string, acik?: boolean} }} bildirim
     *   simge yalnız 'bilgi' türünde kullanılır (kısa düz metin); ozet (1.6.0) yalnız eylem sonucunda: iki satır ve cihaz simgesi
     * @returns {boolean} gösterildi (ya da yüklenince gösterilecek); pencere hiç oluşturulamadıysa false
     */
    goster({ tur, metin, simge, ozet }) {
      const bilgi = tur === 'bilgi';
      const kayit = bilgi ? { tur: 'bilgi', metin: String(metin ?? ''), simge: String(simge ?? '') } : { tur: tur === 'hata' ? 'hata' : 'ok', metin: String(metin ?? '') };
      const ozetTemiz = bilgi ? null : ozetDuzelt(ozet);
      if (ozetTemiz) kayit.ozet = ozetTemiz; // yedek (Windows bildirimi) yalnız tur ve metni kullanır
      if (!canliMi()) olustur();
      if (!canliMi()) return false;
      if (!bilgi) bilgiyiErtele();
      if (bilgi && (bekleyen !== null || (yuklendi && pencere.isVisible() && !cikiyor))) {
        // Bir bildirim zaten görünüyor (ya da yüklenmeyi bekliyor): bilgi sırasını bekler; sıra dolarsa en eskisi düşer.
        // Pencere gizlenmek üzere soluyorsa sıra çoktan bitmiştir: bilgi hemen gösterilir (solma geri alınır).
        if (kuyruk.length >= BILGI_KUYRUK_SINIRI) kuyruk.shift();
        kuyruk.push(kayit);
        return true;
      }
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
      solmayiDurdur();
      cikiyor = false;
      kuyruk = [];
      bekleyen = null;
      gorunenBilgi = null;
      const eski = pencere;
      pencere = null; // önce boşalt: yok edilirken gelen olaylar sıfırlamayı tetiklemesin
      if (eski && !eski.isDestroyed()) eski.destroy();
    },
  };
}

module.exports = { SURE_BASARI_MS, SURE_HATA_MS, SURE_BILGI_MS, BILGI_KUYRUK_SINIRI, koseBildirimiOlustur };
