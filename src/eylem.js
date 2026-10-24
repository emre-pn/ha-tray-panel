'use strict';

/**
 * Eylem katmanı (ana süreç, Electron'a bağlı değildir): tepsi menüsü, panel, palet, genel kısayol ve komut satırı eylemlerinin
 * HEPSİ buradan geçer ve src/lib/eylem-hatti.js'deki tek güvenli hatta girer (kapı/kilit kuralı, eylem sınıfı, yüzey izni,
 * onay, hız sınırı, tek POST). Bu dosya hattın etrafındaki işleri yapar: güncel durumu bulur (canlı depo ya da REST),
 * geri bildirimi verir, "Son kullanılanlar"a yazar ve REST yedeğinde durumu tazeler.
 *
 * Renderer'dan gelen HİÇBİR değer onay yerine geçmez: panel/palet yıkıcı eylemi yalnız ana sürecin kendi saatiyle doğruladığı
 * "basılı tutma" ile (yuzey:basili-basla) çalıştırabilir; tepsi onayı yalnız bu dosyadaki onay penceresiyle verilir.
 *
 * 1.4.0 servis eylemi (ajanlar için API):
 *  - Panel/palet: yuzey:calistir yükü { kimlik, servis, veri, sonDeger?, basili? } — servis/veri yalnız biçimce süzülür, asıl
 *    doğrulama hattadır (servis-izinleri.js izin listesi + parametre sınırları). Örnek: { kimlik: 'climate.salon',
 *    servis: 'set_temperature', veri: { temperature: 22 } }.
 *  - Tepsi orta tık (1.4.0, o-20): eylem.tepsiOrtaTikla(kimlik) — ayardaki tek zararsız favori, 'kisayol' kaynağıyla (yıkıcı eylem çalışmaz).
 *  - Ana süreç (palet metni, kısayol, zamanlayıcı yerine kullanıcı hareketi olan yollar): eylem.servisCalistir({ kimlik, kaynak,
 *    servis, veri, onay?, sonDeger? }); kaynak KAYNAKLAR'dan biri olmalı, onay yalnız ana sürecin kendi onayıdır.
 *  - Favori olmayan ama kullanıcının Ayarlar'da seçtiği varlıklar (ör. yapılacaklar listesi): eylem.kayitKaynagiEkle((kimlik) =>
 *    kayit|null) ile kayıt kaynağı eklenir; hattın "kimlik kayıtlı olmalı" adımı favorilere ek olarak bu kaynaklara bakar.
 *    Kaynak yalnız ayardaki kayıtlı kimlikleri döndürmelidir (serbest metin eylem YOK).
 *
 * 1.4.0 dış tetikler (o-21, o-47, o-52, o-53, o-54): Jump List, masaüstü kısayolu, yerel API, evpaneli:// bağlantısı, PC olayları ve
 * toplantı ışığı YALNIZ src/lib/dis-tetik.js kapısından geçip eylem.distenCalistir ile buraya gelir (kaynak DIS_KAYNAKLAR'dan biri;
 * hat 4b adımı valf/otomasyon/kamera/perde ve klima modunu ayrıca reddeder). `bildirim`: 'hepsi' (başarı ve hata), 'hata' (yalnız
 * hata; PC olayı ve toplantı ışığı) ya da 'yok' (yerel API'de bildirim kapalıysa).
 */

const { eylemHattiOlustur, bildirimKapatHattiOlustur, basiliTutmaDeposu, hataSonucu } = require('./lib/eylem-hatti');
const { SINIF, DIS_KAYNAKLAR, eylemSinifi } = require('./lib/eylem-sinifi');
const { eylemAdiniCoz } = require('./lib/komut-satiri');
const { goreliParlaklik, goreliHiz, kisayolEylemiYonu, kisayolEylemiGecerliMi } = require('./lib/yonlu-eylem');
const { alanAl, guvenliVarlikMi } = require('./lib/suzgec');
const { durumuDuzelt } = require('./lib/ha-ws-protokol');
const { AD_SINIRI, basariMetni, basariOzeti, gonderildiMetni, hataBildirimiMetni } = require('./lib/bildirim-metni');
const { TR } = require('./lib/ceviri-varsayilan');
const { tekrarliMi } = require('./lib/favoriler');
const { kisalt } = require('./lib/metin');
const { hataMetni } = require('./ha-istemcisi');
const { ortaTikUygunMu } = require('./lib/orta-tik');
const { VARLIK_KIMLIGI_DESENI } = require('./lib/dogrulama');

const HAZIRLIK_BUTCESI_MS = 1500; // eylemden önce çalışan hazırlık işlevlerinin (geri al için sahne üyeleri okuması) toplam bekleme sınırı
const REST_SONRASI_YENILEME_MS = 1000; // canlı bağlantı yokken cihazın durumunu bildirmesi için kısa bekleme
const YUZEYLER = ['panel', 'palet'];
const BILDIRIM_KIPLERI = ['hepsi', 'hata', 'yok']; // 1.4.0 dış tetikler: başarı/hata bildirimi kipi

const SERVIS_ADI_DESENI = /^[a-z_]{1,40}$/;
const VERI_BAYT_SINIRI = 2048;

/** Servis yükü biçimi (renderer'dan güvenilmez): kısa servis adı; veri yoksa ya da küçük, düz bir nesne (en çok 8 anahtar). */
function servisYukuGecerliMi(servis, veri) {
  if (typeof servis !== 'string' || !SERVIS_ADI_DESENI.test(servis)) return false;
  if (veri === undefined) return true;
  if (!veri || typeof veri !== 'object' || Array.isArray(veri) || Object.keys(veri).length > 8) return false;
  try {
    return JSON.stringify(veri).length <= VERI_BAYT_SINIRI;
  } catch {
    return false;
  }
}

function varsayilanZaman() {
  return { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
}

/** Eylem sonucundaki hata türünü kullanıcıya gösterilecek kısa metne çevirir (adres, anahtar vb. ASLA içermez). t: çevirmen; verilmezse Türkçe. */
function eylemHataMetni(sonuc, t = TR) {
  switch (sonuc?.tur) {
    case 'ha-hatasi':
      return hataMetni({ tur: sonuc.neden, durumKodu: sonuc.durumKodu }, t);
    case 'yasak':
      return hataMetni({ tur: 'engelli' }, t);
    case 'ulasilamiyor':
    case 'bulunamadi':
    case 'kaynak-izinsiz':
    case 'onay-gerekli':
      return hataMetni({ tur: sonuc.tur }, t);
    case 'bilinmeyen-favori':
      return t('sonuc.favoridedegil');
    case 'bilinmeyen-bildirim':
      return t('sonuc.bildirimYok'); // 1.4.0: kapatılmak istenen bildirim artık listede değil
    case 'gecersiz':
      // 1.4.0 servis eylemi: sınır/adım dışı değer ve cihazın desteklemediği işlem ayrı söylenir (değer/cihaz ayrıntısı yok).
      if (sonuc.neden === 'sinir' || sonuc.neden === 'adim') return t('sonuc.sinirDisi');
      if (sonuc.neden === 'desteklenmiyor') return t('sonuc.desteklenmiyor');
      return t('sonuc.gecersizIstek');
    default:
      return hataMetni({}, t);
  }
}

/**
 * @param {object} bag
 * @param {() => {favoriler: object[]}} bag.ayarlarAl
 * @param {{al: Function, guncelle: Function, yokIsaretle: Function}} bag.depo
 * @param {() => boolean} bag.canliMi canlı bağlantı kurulu mu (depo güncel mi)
 * @param {(kimlik: string) => boolean} [bag.izlenenMi] depo bu kimliği GÜNCEL tutuyor mu (canlı bağlantıda yalnız izlenen kümenin olayları depoya işlenir).
 *   false ise guncelDurum depoya ne bakar ne yazar, her seferinde REST okur; verilmezse hepsi izlenen sayılır.
 * @param {(yol: string, secenek?: object) => Promise<unknown>} bag.haIstek
 * @param {{ekle: Function}} bag.son "Son kullanılanlar" deposu
 * @param {(b: {tur: 'ok'|'hata', metin: string, baslik?: string, ozet?: {baslik: string, alt: string, alan: string, acik: boolean}}) => void} bag.geriBildirim
 *   ozet (1.6.0): köşe bildiriminin iki satırı (cihaz adı + ne oldu) ve simgesi için
 * @param {() => Promise<void>|void} bag.durumlariYenile REST ile izlenen varlıkların durumunu tazeler
 * @param {(ad: string, kimlik: string) => Promise<boolean>} bag.onayDiyalogu tepsi menüsü onay penceresi (true = çalıştır)
 * @param {() => boolean} bag.onayAcikMi bir onay penceresi zaten açık mı
 * @param {() => void} bag.onayBekleniyorBildir
 * @param {() => object[]} bag.karolariAl komut satırı adını çözmek için güvenli favori karoları (yuzey-modeli)
 * @param {(kimlik: string) => boolean} [bag.bildirimKayitliMi] (1.4.0) kimlik şu an panelde gösterilen bir HA bildirimi mi (bildirimKapat için)
 * @param {string} [bag.uygulamaAdi] sabit uygulama adı (t verilmediyse bildirim başlığında kullanılır)
 * @param {Function} [bag.t] çevirmen (src/lib/dil.js); ana süreçte dil değişince kendiliğinden yeni dili izler. Verilmezse Türkçe.
 * @param {(m: string) => void} [bag.gunluk]
 * @param {{setTimeout: Function, clearTimeout?: Function}} [bag.zaman] clearTimeout yoksa bekleyen REST yenilemesi varken ikincisi kurulmaz
 * @param {() => number} [bag.simdi]
 */
function eylemKatmaniOlustur({
  ayarlarAl,
  depo,
  canliMi,
  izlenenMi = () => true,
  haIstek,
  son,
  geriBildirim,
  durumlariYenile,
  onayDiyalogu,
  onayAcikMi,
  onayBekleniyorBildir,
  karolariAl,
  bildirimKayitliMi = () => false,
  uygulamaAdi = 'Ev Paneli',
  t: tVerilen,
  gunluk = () => {},
  zaman = varsayilanZaman(),
  simdi = () => Date.now(),
}) {
  const t = tVerilen ?? TR;
  const adAl = () => (tVerilen ? t('uygulama.ad') : uygulamaAdi);
  const kayitKaynaklari = [];
  /** Kayıtlı varlık: önce favoriler, sonra (1.4.0) kayitKaynagiEkle ile eklenen kaynaklar. Kayıt { entity_id, ad, onay? } olmalı. */
  const favoriAl = (kimlik) => {
    const favori = (ayarlarAl()?.favoriler ?? []).find((f) => f.entity_id === kimlik);
    if (favori) return favori;
    for (const kaynak of kayitKaynaklari) {
      let kayit;
      try {
        kayit = kaynak(kimlik);
      } catch {
        kayit = null;
      }
      if (kayit && typeof kayit === 'object' && kayit.entity_id === kimlik) return kayit;
    }
    return undefined;
  };
  const basili = basiliTutmaDeposu({ simdi });

  // --- Eylem grubu (1.4.0: o-12 geri al, o-15 gecikmeli eylem, o-17 etkinlik geçmişi, o-18 son değişenler) ---------------------------
  /** Hazırlık işlevleri (ad -> işlev): eylemden ÖNCE çalışır, sonucu izleyicilere `hazirlik[ad]` olarak gider (ör. sahne üyelerinin önceki durumu). */
  const hazirlayicilar = new Map();

  /**
   * Hazırlıkları çalıştırır; her biri en çok HAZIRLIK_BUTCESI_MS bekletir, hata/zaman aşımı eylemi engellemez (o ad için undefined).
   * Hazırlıklar hattın kimlik deseni ve "kayıtlı olmalı" denetiminden ÖNCE çalışır; bu yüzden burada aynı iki denetim yeniden yapılır:
   * renderer'dan gelen desen dışı ya da kayıtsız kimlik için HA'ya hiçbir okuma gitmez (hat zaten reddedecek).
   */
  async function hazirliklariYap(istek, ic) {
    if (hazirlayicilar.size === 0) return undefined;
    const kimlik = istek?.kimlik;
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return undefined;
    const kayit = ic && typeof ic === 'object' && ic.kayit !== undefined ? ic.kayit : favoriAl(kimlik);
    if (!kayit || typeof kayit !== 'object' || kayit.entity_id !== kimlik) return undefined;
    const sonuc = {};
    for (const [ad, islev] of [...hazirlayicilar]) {
      let iptal = false; // bütçe dolunca true: hazırlık yeni HA okuması BAŞLATMAMALI (beklemeyi bırakmak sürenleri iptal etmez)
      const sinyal = { iptalMi: () => iptal };
      try {
        let veri = islev(istek, ic, sinyal);
        if (veri && typeof veri.then === 'function') {
          veri = await Promise.race([
            veri,
            new Promise((coz) =>
              zaman.setTimeout(() => {
                iptal = true;
                coz(undefined);
              }, HAZIRLIK_BUTCESI_MS),
            ),
          ]);
        }
        if (veri !== undefined) sonuc[ad] = veri;
      } catch {
        gunluk('Eylem hazırlığı tamamlanamadı.');
      }
    }
    return Object.keys(sonuc).length > 0 ? sonuc : undefined;
  }

  /** Sonuç izleyicileri: her hat çağrısından SONRA (başarı da, hata da) çağrılır; yalnız gözlemler, eylemi değiştiremez ve hatası yutulur. */
  const sonucIzleyicileri = [];

  /** Parti (toplu iş: oda kapatma, geri alma): aynı kullanıcı hareketinin adımlarını bağlar. { id, ad } — kısa, düz metin. */
  function partiOzeti(ic) {
    const p = ic?.parti;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id === '' || p.id.length > 60) return undefined;
    return Object.freeze({ id: p.id, ad: typeof p.ad === 'string' ? kisalt(p.ad, AD_SINIRI) : '' });
  }

  /**
   * İzleyicilere giden bilgi: renderer'dan gelen hiçbir ham nesne değil, burada kurulan küçük, dondurulmuş özet.
   * @param {object} istek hat isteği
   * @param {object} sonuc hat sonucu
   * @param {{islem?: string, parti?: {id: string, ad: string}}} ic ana süreç içi etiket ('geri-al' | 'gecikmeli' | 'oda-kapat' | 'cihaz') ve parti
   */
  function izleyicilereBildir(istek, sonuc, ic, hazirlik) {
    if (sonucIzleyicileri.length === 0) return;
    const eylem = istek?.eylem && typeof istek.eylem === 'object' ? istek.eylem : {};
    const bilgi = Object.freeze({
      istek: Object.freeze({
        kimlik: istek.kimlik,
        kaynak: istek.kaynak,
        servis: typeof eylem.servis === 'string' ? eylem.servis : undefined,
        veri: eylem.veri && typeof eylem.veri === 'object' ? Object.freeze(structuredClone(eylem.veri)) : undefined,
        parlaklik: Number.isInteger(eylem.parlaklik) ? eylem.parlaklik : undefined,
        sonDeger: istek.sonDeger === true,
        araDeger: istek.araDeger === true,
        islem: typeof ic?.islem === 'string' ? ic.islem : undefined,
        parti: partiOzeti(ic),
      }),
      sonuc: Object.freeze({ ...sonuc }),
      sessiz: araDegerMi(istek),
      hazirlik,
    });
    for (const izleyici of [...sonucIzleyicileri]) {
      try {
        izleyici(bilgi);
      } catch {
        gunluk('Eylem izleyicisi hata verdi.');
      }
    }
  }

  /**
   * HA'daki GÜNCEL durum: canlı bağlantıda İZLENEN varlık için depodan, değilse REST'ten (404 = HA'da yok). Güvenlik süzgeci hatta yeniden uygulanır.
   * oncelik: kimlikli kapıdaki sıra ('yuksek' varsayılan; eylem öncesi hazırlık okumaları 'normal' ile hattın okumasının ve POST'un önüne geçmez).
   * İzlenmeyen varlığın (sahne üyesi, "diğer cihazlar") olayları depoya gelmez: kaydı bayat kalırdı, bu yüzden onlar için depoya bakılmaz ve REST sonucu depoya yazılmaz.
   */
  async function guncelDurum(kimlik, { oncelik = 'yuksek' } = {}) {
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return null; // desen dışı kimlik HA yoluna eklenmez (`..` parçaları çözülürdü)
    const izleniyor = izlenenMi(kimlik) === true;
    const onbellek = izleniyor ? depo.al(kimlik) : undefined;
    if (canliMi() && onbellek !== undefined) return onbellek;
    try {
      const varlik = await haIstek(`/api/states/${kimlik}`, { oncelik }); // eylemden önceki okuma toplu yenilemenin arkasında beklemez (tur 5, K10); hazırlık okumaları 'normal' ister
      const d = durumuDuzelt(varlik);
      if (izleniyor && d && d.entity_id === kimlik) depo.guncelle(d);
      return varlik;
    } catch (hata) {
      if (hata?.tur === 'bulunamadi') {
        if (izleniyor) depo.yokIsaretle(kimlik);
        return null;
      }
      throw hata;
    }
  }

  const hat = eylemHattiOlustur({
    favoriAl,
    guncelDurum,
    haIstek,
    basiliOnayi: (kimlik) => basili.tuket(kimlik),
  });
  const bildirimHatti = bildirimKapatHattiOlustur({ bildirimKayitliMi, haIstek });

  /**
   * Ara değer / tekrar mı (kaydırıcı sürüklemesi, ses -/+ basılı tutma)? Sonuç izleyicilerine (etkinlik geçmişi, geri al, son değişenler)
   * giden `sessiz` yalnız budur: dış tetiğin `bildirim` kipi (başarı bildirimi istenmedi) eylemin geçmişe yazılmasını engellemez.
   */
  function araDegerMi(istek) {
    if (!YUZEYLER.includes(istek.kaynak)) return false;
    if (tekrarliMi(istek.kimlik)) return true; // ses -/+ basılı tutma: her basışta bildirim çıkmasın
    if (istek.araDeger === true) return true; // 1.4.0: kaydırıcı ara değeri (ses, sıcaklık, sayı...): bildirim yalnız bırakınca
    return istek.eylem?.parlaklik !== undefined && istek.sonDeger !== true; // kaydırıcı ara değerleri
  }

  function sessizMi(istek) {
    if (istek.bildirim === 'hata' || istek.bildirim === 'yok') return true; // 1.4.0 dış tetik: başarı bildirimi istenmedi
    return araDegerMi(istek);
  }

  /** Bildirimde görünen ad (1.6.1): favorinin karo adı (Ayarlar > Favoriler > Karo adı) varsa o, yoksa HA'daki güncel ad. */
  function gorunenAd(sonuc, istek) {
    const etiket = favoriAl(istek?.kimlik)?.etiket;
    if (typeof etiket === 'string' && etiket.trim()) return etiket.trim();
    return sonuc.ad || istek?.kimlik || '';
  }

  function basariBildir(sonuc, istek) {
    if (sessizMi(istek)) return;
    const ad = gorunenAd(sonuc, istek);
    let metin;
    let ozet;
    if (sonuc.parlaklik !== undefined) {
      metin = t('sonuc.parlaklik', { ad: kisalt(ad, AD_SINIRI), yuzde: sonuc.parlaklik });
      ozet = { alt: t('sonuc.ozet.parlaklik', { yuzde: sonuc.parlaklik }), acik: true };
    } else if (sonuc.servisEylemi === true) {
      metin = gonderildiMetni(ad, t); // 1.4.0 servis eylemi: "komut gönderildi"
      ozet = { alt: t('sonuc.ozet.komut'), acik: false };
    } else {
      metin = basariMetni(sonuc.alan, ad, sonuc.onceki, sonuc.yeni, t);
      ozet = basariOzeti(sonuc.alan, sonuc.onceki, sonuc.yeni, t);
    }
    geriBildirim({ tur: 'ok', metin, ozet: { baslik: kisalt(ad, AD_SINIRI), alan: sonuc.alan, ...ozet } });
  }

  let yenilemeBekliyor = false;
  let yenilemeZamanlayici;

  /**
   * REST yedeğinde (canlı bağlantı yok) cihazın durumunu bildirmesi için eylemden kısa süre sonra tek bir durum tazelemesi ister. Bekleyen bir tazeleme
   * varsa süresi yeniden başlar (debounce): kaydırıcı sürüklemesi ya da ses -/+ basılı tutma her adım için ayrı bir tur başlatmaz, tek tur son adımdan sonra çalışır.
   */
  function yenilemePlanla() {
    if (yenilemeBekliyor) {
      if (typeof zaman.clearTimeout !== 'function') return; // sahte/eksik zamanlayıcı: bekleyen varken ikincisi kurulmaz
      zaman.clearTimeout(yenilemeZamanlayici);
    }
    yenilemeBekliyor = true;
    yenilemeZamanlayici = zaman.setTimeout(() => {
      yenilemeBekliyor = false;
      Promise.resolve(durumlariYenile()).catch(() => {});
    }, REST_SONRASI_YENILEME_MS);
  }

  /** Hatadan sonra REST yedeğinde durumu hemen tazeler; sürükleme ara değeri hatası (peş peşe gelebilir) birleştirilmiş tazelemeye gider. */
  function hataSonrasiYenile(istek) {
    if (canliMi()) return;
    if (araDegerMi(istek)) yenilemePlanla();
    else Promise.resolve(durumlariYenile()).catch(() => {});
  }

  /**
   * Hattı çalıştırır; geri bildirim, "Son" ve durum tazelemeyi yapar.
   * @returns {Promise<{ok: boolean, tur?: string, ad?: string}>} hata ayrıntısı (ağ, adres) dışarı verilmez
   */
  async function calistir(istek, ic) {
    const hazirlik = await hazirliklariYap(istek, ic);
    const sonuc = await hat(istek, ic);
    izleyicilereBildir(istek, sonuc, ic, hazirlik);
    // ic.sessiz: toplu işin (geri alma, oda kapatma) adımları tek tek bildirim çıkarmaz; özeti çağıran modül verir.
    const toplu = ic?.sessiz === true;
    if (sonuc.ok) {
      if (!toplu) basariBildir(sonuc, istek);
      // "Son kullanılanlar" tek tıklamayla yinelenebilen eylemleri tutar; servis eylemi (klima 24, ışık rengi, ses 30) yinelenemez.
      // Ana süreç içi işler (ic.islem: geri alma, gecikmeli eylem, oda kapatma, diğer cihazlar) kullanıcının tıkladığı karo değildir: "Son"a girmez.
      if (!ic?.islem && YUZEYLER.includes(istek.kaynak) && sonuc.sinif === 'zararsiz' && sonuc.servisEylemi !== true) son.ekle(istek.kimlik);
      if (!canliMi()) yenilemePlanla();
      return { ok: true, ad: sonuc.ad };
    }
    if (sonuc.tur === 'onay-gerekli' || sonuc.tur === 'cok-sik') return { ok: false, tur: sonuc.tur, ad: sonuc.ad }; // sessiz: yüzey kendi ipucunu gösterir
    // neden bir hata türü dizgesidir (ör. 'gecikti'), sır taşımaz; çağıran (gecikmeli eylem) belirsiz sonucu kesin hatadan ayırabilsin.
    const nedenEki = sonuc.neden ? { neden: sonuc.neden } : {};
    if (toplu) {
      gunluk(`Eylem başarısız: ${sonuc.tur}${sonuc.neden ? `/${sonuc.neden}` : ''}`);
      hataSonrasiYenile(istek);
      return { ok: false, tur: sonuc.tur, ad: sonuc.ad, ...nedenEki };
    }
    if (sonuc.tur === 'ha-hatasi' && sonuc.neden === 'gecikti') {
      // h-09 (1.2.0): komut HA'ya gitti ama yanıt gecikti (uzun sahne): "Yapılamadı" denmez; sonuç bilinmiyor.
      gunluk('Eylem yanıtı gecikti: ha-hatasi/gecikti');
      if (!sessizMi(istek)) geriBildirim({ tur: 'ok', metin: `${kisalt(gorunenAd(sonuc, istek), AD_SINIRI)}: ${hataMetni({ tur: 'gecikti' }, t)}` });
      hataSonrasiYenile(istek);
      return { ok: false, tur: sonuc.tur, ad: sonuc.ad, ...nedenEki };
    }
    gunluk(`Eylem başarısız: ${sonuc.tur}${sonuc.neden ? `/${sonuc.neden}` : ''}`);
    if (istek?.bildirim !== 'yok') {
      const ad = kisalt(gorunenAd(sonuc, istek), AD_SINIRI);
      const metin = hataBildirimiMetni(eylemHataMetni(sonuc, t), t);
      geriBildirim({ tur: 'hata', metin, baslik: `${adAl()} — ${ad}`, ozet: { baslik: ad, alt: metin, alan: sonuc.alan || String(istek?.kimlik || '').split('.')[0], acik: false } });
    }
    hataSonrasiYenile(istek);
    return { ok: false, tur: sonuc.tur, ad: sonuc.ad };
  }

  /** Hat dışında kalan hatalar (durum okunamadı, yön hesaplanamadı) da aynı biçimde bildirilir; ayrıntı (ağ, adres) yazılmaz. */
  function yonluHata(sonuc, kimlik, bildirim = 'hepsi') {
    gunluk(`Yönlü eylem başarısız: ${sonuc.tur}${sonuc.neden ? `/${sonuc.neden}` : ''}`);
    if (bildirim !== 'yok') geriBildirim({ tur: 'hata', metin: hataBildirimiMetni(eylemHataMetni(sonuc, t), t), baslik: `${adAl()} — ${kisalt(favoriAl(kimlik)?.ad || kimlik, AD_SINIRI)}` });
    return { ok: false, tur: sonuc.tur };
  }

  /**
   * Kesin yönlü eylem (o-13): kısayol ve komut satırı için. 'ac' / 'kapat' / 'degistir' doğrudan hattan geçer; 'goreli' (parlaklık ya da
   * vantilatör hızı ±N) önce HA'daki GÜNCEL durumu okur, yeni değeri hesaplar ve AYNI hattan (kapı kuralı, sınıf, servis izin listesi,
   * hız sınırı) tek POST ile gönderir. Hesap yalnız 1..100 / 0..100 aralığında kalır; kapalı ışığa artı adım ışığı o yüzdeyle açar.
   * @param {string} kimlik
   * @param {'kisayol'|'komut-satiri'|string} kaynak (1.4.0: dış tetik kaynakları da, distenCalistir üzerinden)
   * @param {{tur: 'ac'|'kapat'|'degistir'} | {tur: 'goreli', delta: number, hedef?: 'parlaklik'|'hiz'}} yon
   * @param {'hepsi'|'hata'|'yok'} [bildirim] 1.4.0 dış tetik bildirim kipi
   */
  async function yonluCalistir(kimlik, kaynak, yon, bildirim = 'hepsi') {
    const ek = bildirim === 'hepsi' ? {} : { bildirim };
    if (yon?.tur === 'ac') return calistir({ kimlik, kaynak, eylem: { servis: 'turn_on' }, ...ek });
    if (yon?.tur === 'kapat') return calistir({ kimlik, kaynak, eylem: { servis: 'turn_off' }, ...ek });
    if (yon?.tur === 'degistir') return calistir({ kimlik, kaynak, ...ek });
    if (yon?.tur !== 'goreli' || !Number.isInteger(yon.delta)) return yonluHata({ tur: 'gecersiz' }, kimlik, bildirim);
    const alan = alanAl(kimlik);
    if (alan !== 'light' && alan !== 'fan') return yonluHata({ tur: 'gecersiz', neden: 'desteklenmiyor' }, kimlik, bildirim);
    if (yon.hedef !== undefined && yon.hedef !== (alan === 'light' ? 'parlaklik' : 'hiz')) return yonluHata({ tur: 'gecersiz', neden: 'desteklenmiyor' }, kimlik, bildirim);
    let varlik;
    try {
      varlik = await guncelDurum(kimlik);
    } catch (hata) {
      return yonluHata(hataSonucu(hata), kimlik, bildirim); // erişim anahtarı reddi, duraklatma... gerçek neden korunur (doğrudan eylemle aynı metin)
    }
    if (varlik === null || varlik === undefined) return yonluHata({ tur: 'bulunamadi' }, kimlik, bildirim);
    if (typeof varlik !== 'object' || varlik.entity_id !== kimlik || !guvenliVarlikMi(varlik)) return yonluHata({ tur: 'yasak' }, kimlik, bildirim);
    const hesap = alan === 'light' ? goreliParlaklik(varlik, yon.delta) : goreliHiz(varlik, yon.delta);
    if (hesap.tur === 'ulasilamiyor') return yonluHata({ tur: 'ulasilamiyor' }, kimlik, bildirim);
    if (hesap.tur === 'desteklenmiyor') return yonluHata({ tur: 'gecersiz', neden: 'desteklenmiyor' }, kimlik, bildirim);
    if (hesap.tur === 'degisim-yok') {
      const ad = (typeof varlik.attributes?.friendly_name === 'string' && varlik.attributes.friendly_name.trim()) || favoriAl(kimlik)?.ad || kimlik;
      if (bildirim === 'hepsi') geriBildirim({ tur: 'ok', metin: t('sonuc.degisimYok', { ad: kisalt(ad, AD_SINIRI) }) });
      return { ok: true, degismedi: true };
    }
    const eylem = alan === 'light' ? { parlaklik: hesap.yuzde } : { servis: 'set_percentage', veri: { percentage: hesap.yuzde } };
    return calistir({ kimlik, kaynak, eylem, ...ek });
  }

  return {
    calistir,
    guncelDurum,

    /** Tepsi menüsü tıklaması: yıkıcı eylemde önce onay penceresi, vazgeçilirse HİÇBİR istek gönderilmez. */
    async tepsiTikla(kimlik) {
      if (onayAcikMi()) return onayBekleniyorBildir();
      const favori = favoriAl(kimlik);
      if (!favori) return undefined;
      const durum = depo.al(kimlik);
      const canliAd = durum?.attributes?.friendly_name;
      const ad = (typeof canliAd === 'string' && canliAd.trim() ? canliAd.trim() : '') || favori.ad || kimlik;
      const onSinif = eylemSinifi(durum ?? { entity_id: kimlik, attributes: { friendly_name: favori.ad } }, favori).sinif;
      let onay;
      if (onSinif === SINIF.YIKICI) {
        if (!(await onayDiyalogu(ad, kimlik))) return undefined;
        onay = 'diyalog';
      }
      const sonuc = await calistir({ kimlik, kaynak: 'tepsi-menu', onay });
      if (!sonuc.ok && sonuc.tur === 'onay-gerekli' && !onay) {
        // Menü eylemi zararsız sanıyordu ama HA'daki güncel durum onay istiyor: şimdi sor.
        if (onayAcikMi()) return onayBekleniyorBildir(); // ağ beklerken başka bir tıklama onay penceresi açmış olabilir
        if (!(await onayDiyalogu(sonuc.ad, kimlik))) return undefined;
        await calistir({ kimlik, kaynak: 'tepsi-menu', onay: 'diyalog' });
      }
      return undefined;
    },

    /**
     * Tepsi simgesine orta tık (o-20): ayarda (`tepsiOrtaTik`) seçilen TEK zararsız favori çalışır. Yeni bir yetki yoktur: eylem, eylem
     * kısayoluyla AYNI yoldan ('kisayol' kaynağı) tek güvenli hattan geçer (Kapı Kuralı, sınıf, servis izin listesi, hız sınırı, tek POST);
     * orta tıkla onay istenmez ve yıkıcı sınıf zaten reddedilir. Hattan önce src/lib/orta-tik.js ön denetimi, ayarda kalmış eski bir seçimin
     * (sonradan onay istenen, favoriden çıkarılan, yıkıcı sayılan favori) sessizce değil NEDENİYLE reddedilmesini sağlar.
     * @param {unknown} kimlik ayardaki tepsiOrtaTik
     * @returns {Promise<{ok: boolean, tur?: string, ad?: string}>}
     */
    async tepsiOrtaTikla(kimlik) {
      const favori = typeof kimlik === 'string' ? favoriAl(kimlik) : undefined;
      const uygun = ortaTikUygunMu({ kimlik, favori, durum: typeof kimlik === 'string' ? depo.al(kimlik) : undefined });
      if (!uygun.uygun) {
        if (uygun.neden === 'secilmedi') return { ok: false, tur: 'gecersiz' };
        gunluk(`Tepsi orta tık eylemi reddedildi: ${uygun.neden}`);
        geriBildirim({ tur: 'hata', metin: t('sonuc.ortaTikUygunDegil'), baslik: adAl() });
        return { ok: false, tur: uygun.neden === 'favori-degil' ? 'bilinmeyen-favori' : uygun.neden === 'gecersiz' ? 'gecersiz' : 'kaynak-izinsiz' };
      }
      return calistir({ kimlik, kaynak: 'kisayol' });
    },

    /**
     * Panel/palet penceresinden gelen istek. Yük renderer'dan gelir ve güvenilmez sayılır: tür/aralık doğrulanır, onay
     * yalnız ana sürecin kaydettiği basılı tutmayla verilir.
     * @param {'panel'|'palet'} kaynak gönderen pencereden ana süreç belirler
     * @param {unknown} yuk { kimlik, parlaklik?, kapat?, servis?, veri?, sonDeger?, araDeger?, basili? }
     *   servis + veri (1.4.0): servis eylemi; burada yalnız biçim (kısa servis adı, küçük düz nesne) denetlenir, izin listesi ve
     *   parametre sınırları hattadır (servis-izinleri.js). parlaklik/kapat ile birlikte verilemez.
     */
    async yuzeydenCalistir(kaynak, yuk) {
      if (!YUZEYLER.includes(kaynak) || !yuk || typeof yuk !== 'object' || Array.isArray(yuk)) return { ok: false, tur: 'gecersiz' };
      if (typeof yuk.kimlik !== 'string' || yuk.kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      const istek = { kimlik: yuk.kimlik, kaynak };
      if (yuk.servis !== undefined) {
        if (yuk.parlaklik !== undefined || yuk.kapat !== undefined || !servisYukuGecerliMi(yuk.servis, yuk.veri)) return { ok: false, tur: 'gecersiz' };
        istek.eylem = yuk.veri === undefined ? { servis: yuk.servis } : { servis: yuk.servis, veri: yuk.veri };
      } else if (yuk.parlaklik !== undefined) {
        if (!Number.isInteger(yuk.parlaklik)) return { ok: false, tur: 'gecersiz' };
        istek.eylem = { parlaklik: yuk.parlaklik };
      } else if (yuk.kapat === true) {
        istek.eylem = { servis: 'turn_off' }; // palet "ışık 0": yalnız bu sabit servis
      }
      if (yuk.sonDeger === true) istek.sonDeger = true;
      if (yuk.araDeger === true) istek.araDeger = true;
      if (yuk.basili === true) istek.onay = 'basili';
      return calistir(istek);
    },

    /**
     * 1.4.0 (o-33): masaüstü karosu penceresinden gelen istek. Kaynak her zaman 'masaustu'dur ve karonun kimliğini ana süreç
     * (pencere -> karo eşlemesi) verir, sayfa vermez. Yalnız iki biçim vardır: kimlik tek başına (alanın tek tıklama servisi) ya
     * da kimlik + sabit parlaklık ön ayarı (tam sayı, hat 1-100 dışını reddeder). Karo onay/basılı tutma sunmaz: yıkıcı eylem ve
     * serbest servis/veri bu yoldan çalışmaz; her şey yine tek güvenli hattan (Kapı Kuralı, sınıf, hız sınırı) geçer.
     * @param {{kimlik: string, parlaklik?: number}} yuk
     */
    async masaustundenCalistir(yuk) {
      if (!yuk || typeof yuk !== 'object' || Array.isArray(yuk)) return { ok: false, tur: 'gecersiz' };
      if (typeof yuk.kimlik !== 'string' || yuk.kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      const istek = { kimlik: yuk.kimlik, kaynak: 'masaustu' };
      if (yuk.parlaklik !== undefined) {
        if (!Number.isInteger(yuk.parlaklik)) return { ok: false, tur: 'gecersiz' };
        istek.eylem = { parlaklik: yuk.parlaklik };
        istek.sonDeger = true;
      }
      return calistir(istek);
    },

    /** Renderer "basılı tutma başladı" dedi: ana süreç kendi saatini başlatır (yalnız favori kimlikleri için). */
    basiliBasla(kimlik) {
      if (typeof kimlik !== 'string' || !favoriAl(kimlik)) return false;
      return basili.basla(kimlik);
    },
    basiliIptal(kimlik) {
      if (typeof kimlik === 'string') basili.iptal(kimlik);
    },

    /**
     * Eylem kısayolu (hiz-05): yalnız zararsız eylemler çalışır, yıkıcı olan hatta 'kaynak-izinsiz' olur. Favoride `kisayolEylemi` varsa
     * (o-13: aç, kapat, parlaklık/hız ±N) o kesin yön uygulanır; eylem bu favori için artık geçerli değilse (parlaklık kontrolü sonradan
     * kapatıldı gibi) sessizce aç-kapa yapılmaz, hata bildirilir. Yoksa varlığın kendi tek tıklama eylemi çalışır.
     */
    kisayolla(kimlik) {
      const favori = favoriAl(kimlik);
      const ham = favori?.kisayolEylemi;
      if (ham === undefined || ham === '') return calistir({ kimlik, kaynak: 'kisayol' });
      if (!kisayolEylemiGecerliMi(alanAl(kimlik), ham, favori)) return Promise.resolve(yonluHata({ tur: 'gecersiz' }, kimlik));
      return yonluCalistir(kimlik, 'kisayol', kisayolEylemiYonu(ham));
    },

    /**
     * 1.4.0: ana süreçten servis eylemi (palet metni çözümü, eylem kısayolu, oda eylemi...). Aynı hattan geçer; renderer'dan
     * gelen yük için yuzeydenCalistir kullanılır.
     * @param {{kimlik: string, kaynak: string, servis: string, veri?: object, onay?: 'diyalog'|'basili', sonDeger?: boolean}} istek
     */
    servisCalistir({ kimlik, kaynak, servis, veri, onay, sonDeger } = {}) {
      if (!servisYukuGecerliMi(servis, veri)) return Promise.resolve({ ok: false, tur: 'gecersiz' });
      const istek = { kimlik, kaynak, eylem: veri === undefined ? { servis } : { servis, veri } };
      if (onay !== undefined) istek.onay = onay;
      if (sonDeger === true) istek.sonDeger = true;
      return calistir(istek);
    },

    /**
     * 1.4.0 dış tetikler: YALNIZ src/lib/dis-tetik.js kapısı çağırır (kaynak açık mı, ad çözümü, zararsızlık, hız sınırı orada).
     * Burada kaynak ve yük biçimi yeniden denetlenir; istek yine aynı hattan geçer (hat 4b: dış kaynak izni). Tek biçim seçilir:
     * yon (aç/kapat/değiştir/±adım), parlaklik (1-100, 0 = kapat), servis + veri (palet sözlüğünün komutları) ya da hiçbiri (tek tıklama).
     * @param {{kimlik: string, kaynak: string, yon?: object, parlaklik?: number, servis?: string, veri?: object, bildirim?: 'hepsi'|'hata'|'yok'}} istek
     */
    distenCalistir({ kimlik, kaynak, yon, parlaklik, servis, veri, bildirim = 'hepsi' } = {}) {
      if (!DIS_KAYNAKLAR.includes(kaynak) || typeof kimlik !== 'string' || kimlik.length > 120 || !BILDIRIM_KIPLERI.includes(bildirim)) {
        return Promise.resolve({ ok: false, tur: 'gecersiz' });
      }
      const ek = bildirim === 'hepsi' ? {} : { bildirim };
      const bicimSayisi = [yon, parlaklik, servis].filter((d) => d !== undefined).length;
      if (bicimSayisi > 1) return Promise.resolve({ ok: false, tur: 'gecersiz' });
      if (yon !== undefined) return yonluCalistir(kimlik, kaynak, yon, bildirim);
      if (parlaklik !== undefined) {
        if (!Number.isInteger(parlaklik) || parlaklik < 0 || parlaklik > 100) return Promise.resolve({ ok: false, tur: 'gecersiz' });
        const eylem = parlaklik === 0 ? { servis: 'turn_off' } : { parlaklik };
        return calistir({ kimlik, kaynak, eylem, sonDeger: true, ...ek });
      }
      if (servis !== undefined) {
        if (!servisYukuGecerliMi(servis, veri)) return Promise.resolve({ ok: false, tur: 'gecersiz' });
        return calistir({ kimlik, kaynak, eylem: veri === undefined ? { servis } : { servis, veri }, ...ek });
      }
      return calistir({ kimlik, kaynak, ...ek });
    },

    /**
     * Eylem grubu: her eylem sonucunu (başarı/hata) gözlemleyen izleyici ekler (etkinlik geçmişi, geri al, son değişenler). İzleyici
     * { istek: {kimlik, kaynak, servis?, veri?, parlaklik?, sonDeger, araDeger, islem?}, sonuc, sessiz } alır; eylemi değiştiremez, hatası yutulur.
     * Dönen işlev izleyiciyi kaldırır.
     */
    sonucDinle(izleyici) {
      if (typeof izleyici !== 'function') return () => {};
      sonucIzleyicileri.push(izleyici);
      return () => {
        const i = sonucIzleyicileri.indexOf(izleyici);
        if (i >= 0) sonucIzleyicileri.splice(i, 1);
      };
    },

    /**
     * Eylem grubu: eylemden ÖNCE çalışan hazırlık işlevi ekler (geri al: sahnenin üyelerinin önceki durumu). İşlev (istek, ic, sinyal) alır, değer ya da
     * söz döner (sinyal.iptalMi(): bekleme bütçesi doldu, yeni HA okuması başlatma); sonuç izleyicilere `hazirlik[ad]` olarak gider. Eylemi bekletme sınırı toplam 1,5 sn'dir; hata/zaman aşımı eylemi engellemez.
     * Dönen işlev hazırlığı kaldırır.
     */
    hazirlikEkle(ad, islev) {
      if (typeof ad !== 'string' || typeof islev !== 'function') return () => {};
      hazirlayicilar.set(ad, islev);
      return () => {
        if (hazirlayicilar.get(ad) === islev) hazirlayicilar.delete(ad);
      };
    },

    /**
     * Eylem grubu (YALNIZ ana süreç modülleri): tek seferlik kayıtla çalıştırır. Kayıt, "kimlik ayardaki favorilerde olmalı" adımının
     * yerine geçer ({ entity_id, ad, parlaklik? }); kapı kuralı, eylem sınıfı + yüzey izni, servis izin listesi, hız sınırı ve tek POST
     * AYNEN uygulanır. Kullanım: geri al (sahne üyeleri), gecikmeli eylem, oda kapatma, palette "diğer cihazlar". Renderer bu yola
     * erişemez: yuzey:* kanalları ancak aşağıdaki yüzeye açık sarmalayıcılardan geçer.
     * @param {{kimlik: string, kaynak: string, kayit: object, eylem?: object, onay?: 'diyalog'|'basili', sonDeger?: boolean,
     *   parti?: {id: string, ad: string}, sessiz?: boolean}} istek parti: toplu işin kimliği (izleyicilere gider); sessiz: bu adım bildirim çıkarmaz
     * @param {'geri-al'|'gecikmeli'|'oda-kapat'|'cihaz'} islem izleyicilere giden etiket
     */
    kayitliCalistir({ kimlik, kaynak, kayit, eylem, onay, sonDeger, parti, sessiz } = {}, islem) {
      if (!kayit || typeof kayit !== 'object' || kayit.entity_id !== kimlik) return Promise.resolve({ ok: false, tur: 'bilinmeyen-favori' });
      const istek = { kimlik, kaynak };
      if (eylem !== undefined) istek.eylem = eylem;
      if (onay !== undefined) istek.onay = onay;
      if (sonDeger === true) istek.sonDeger = true;
      return calistir(istek, { kayit, islem, parti, sessiz: sessiz === true });
    },

    /** 1.4.0: favori dışı kayıt kaynağı ekler (ör. Ayarlar'da seçilen yapılacaklar listesi). Dönen işlev kaynağı kaldırır. */
    kayitKaynagiEkle(kaynak) {
      if (typeof kaynak !== 'function') return () => {};
      kayitKaynaklari.push(kaynak);
      return () => {
        const i = kayitKaynaklari.indexOf(kaynak);
        if (i >= 0) kayitKaynaklari.splice(i, 1);
      };
    },

    /**
     * 1.4.0 (bildirim grubu): panelde gösterilen HA kalıcı bildirimini kapatır (persistent_notification.dismiss). Yalnız kullanıcının
     * panelde "kapat" tıklamasından çağrılır (yuzey:bildirim-kapat); aynı tek POST noktasından ve yetki kesiciden geçer.
     * Başarıda sessizdir (şerit kendini günceller); hatada köşe/Windows hata bildirimi çıkar.
     * @returns {Promise<{ok: boolean, tur?: string}>}
     */
    async bildirimKapat(kimlik) {
      const sonuc = await bildirimHatti({ kimlik, kaynak: 'panel' });
      if (sonuc.ok) return { ok: true };
      gunluk(`Bildirim kapatılamadı: ${sonuc.tur}${sonuc.neden ? `/${sonuc.neden}` : ''}`);
      if (sonuc.tur === 'cok-sik') return { ok: false, tur: sonuc.tur };
      geriBildirim({ tur: 'hata', metin: hataBildirimiMetni(eylemHataMetni(sonuc, t), t), baslik: adAl() });
      return { ok: false, tur: sonuc.tur };
    },

    /** Kimlik kayıtlı mı (favori ya da kayıt kaynağı)? Okuma uçları (yuzey:oku) izni için. */
    kayitliMi(kimlik) {
      return typeof kimlik === 'string' && favoriAl(kimlik) !== undefined;
    },

    /**
     * `--eylem=<ad>` (hiz-05): ad yalnız güvenli favori karoları arasında aranır; belirsizse hiçbir şey çalışmaz.
     * 1.4.0: "klima 24", "masa sicak", "tv ses 30" gibi servis komutları da çözülür (src/lib/komut-satiri.js); düz ad ise
     * tek tıklama eylemi olan karolarda aranır. Çıkan servis eylem hattından geçer (izin listesi, sınırlar, onay sınıfı).
     */
    async komutSatirindan(ad) {
      const cozum = eylemAdiniCoz(ad, karolariAl());
      if (cozum.hata) {
        gunluk(`Komut satırı eylemi çözülemedi: ${cozum.hata}`);
        const anahtar = { belirsiz: 'sonuc.komutBelirsiz', sinir: 'sonuc.komutSinirDisi', desteklenmiyor: 'sonuc.komutDesteklenmiyor', komutGerekli: 'sonuc.komutGerekli' }[cozum.hata] ?? 'sonuc.komutBulunamadi';
        geriBildirim({ tur: 'hata', metin: t(anahtar) });
        return { ok: false, tur: cozum.hata };
      }
      if (cozum.yon) return yonluCalistir(cozum.id, 'komut-satiri', cozum.yon); // "led +10", "salon ac", "salon kapat" (o-13)
      let eylemYuku; // "led 40" -> parlaklık, "led 0" -> kapat (turn_off); "klima 24" -> servis; düz ad -> varlığın kendi eylemi
      if (cozum.parlaklik !== undefined) eylemYuku = { parlaklik: cozum.parlaklik };
      else if (cozum.kapat === true) eylemYuku = { servis: 'turn_off' };
      else if (typeof cozum.servis === 'string') eylemYuku = cozum.veri === undefined ? { servis: cozum.servis } : { servis: cozum.servis, veri: cozum.veri };
      return calistir({ kimlik: cozum.id, kaynak: 'komut-satiri', eylem: eylemYuku });
    },
  };
}

module.exports = { HAZIRLIK_BUTCESI_MS, REST_SONRASI_YENILEME_MS, eylemHataMetni, eylemKatmaniOlustur };
