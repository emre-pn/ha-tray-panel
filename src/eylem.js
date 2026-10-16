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
 *  - Ana süreç (palet metni, kısayol, zamanlayıcı yerine kullanıcı hareketi olan yollar): eylem.servisCalistir({ kimlik, kaynak,
 *    servis, veri, onay?, sonDeger? }); kaynak KAYNAKLAR'dan biri olmalı, onay yalnız ana sürecin kendi onayıdır.
 *  - Favori olmayan ama kullanıcının Ayarlar'da seçtiği varlıklar (ör. yapılacaklar listesi): eylem.kayitKaynagiEkle((kimlik) =>
 *    kayit|null) ile kayıt kaynağı eklenir; hattın "kimlik kayıtlı olmalı" adımı favorilere ek olarak bu kaynaklara bakar.
 *    Kaynak yalnız ayardaki kayıtlı kimlikleri döndürmelidir (serbest metin eylem YOK).
 */

const { eylemHattiOlustur, bildirimKapatHattiOlustur, basiliTutmaDeposu } = require('./lib/eylem-hatti');
const { SINIF, eylemSinifi } = require('./lib/eylem-sinifi');
const { eylemAdiniCoz } = require('./lib/komut-satiri');
const { durumuDuzelt } = require('./lib/ha-ws-protokol');
const { AD_SINIRI, basariMetni, gonderildiMetni, hataBildirimiMetni } = require('./lib/bildirim-metni');
const { TR } = require('./lib/ceviri-varsayilan');
const { tekrarliMi } = require('./lib/favoriler');
const { kisalt } = require('./lib/metin');
const { hataMetni } = require('./ha-istemcisi');

const REST_SONRASI_YENILEME_MS = 1000; // canlı bağlantı yokken cihazın durumunu bildirmesi için kısa bekleme
const YUZEYLER = ['panel', 'palet'];

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
  return { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) };
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
 * @param {(yol: string, secenek?: object) => Promise<unknown>} bag.haIstek
 * @param {{ekle: Function}} bag.son "Son kullanılanlar" deposu
 * @param {(b: {tur: 'ok'|'hata', metin: string, baslik?: string}) => void} bag.geriBildirim
 * @param {() => Promise<void>|void} bag.durumlariYenile REST ile izlenen varlıkların durumunu tazeler
 * @param {(ad: string, kimlik: string) => Promise<boolean>} bag.onayDiyalogu tepsi menüsü onay penceresi (true = çalıştır)
 * @param {() => boolean} bag.onayAcikMi bir onay penceresi zaten açık mı
 * @param {() => void} bag.onayBekleniyorBildir
 * @param {() => object[]} bag.karolariAl komut satırı adını çözmek için güvenli favori karoları (yuzey-modeli)
 * @param {(kimlik: string) => boolean} [bag.bildirimKayitliMi] (1.4.0) kimlik şu an panelde gösterilen bir HA bildirimi mi (bildirimKapat için)
 * @param {string} [bag.uygulamaAdi] sabit uygulama adı (t verilmediyse bildirim başlığında kullanılır)
 * @param {Function} [bag.t] çevirmen (src/lib/dil.js); ana süreçte dil değişince kendiliğinden yeni dili izler. Verilmezse Türkçe.
 * @param {(m: string) => void} [bag.gunluk]
 * @param {{setTimeout: Function}} [bag.zaman]
 * @param {() => number} [bag.simdi]
 */
function eylemKatmaniOlustur({
  ayarlarAl,
  depo,
  canliMi,
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

  /** HA'daki GÜNCEL durum: canlı bağlantıda depodan, değilse REST'ten (404 = HA'da yok). Güvenlik süzgeci hatta yeniden uygulanır. */
  async function guncelDurum(kimlik) {
    const onbellek = depo.al(kimlik);
    if (canliMi() && onbellek !== undefined) return onbellek;
    try {
      const varlik = await haIstek(`/api/states/${kimlik}`, { oncelik: 'yuksek' }); // eylemden önceki okuma toplu yenilemenin arkasında beklemez (tur 5, K10)
      const d = durumuDuzelt(varlik);
      if (d && d.entity_id === kimlik) depo.guncelle(d);
      return varlik;
    } catch (hata) {
      if (hata?.tur === 'bulunamadi') {
        depo.yokIsaretle(kimlik);
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

  function sessizMi(istek) {
    if (!YUZEYLER.includes(istek.kaynak)) return false;
    if (tekrarliMi(istek.kimlik)) return true; // ses -/+ basılı tutma: her basışta bildirim çıkmasın
    if (istek.araDeger === true) return true; // 1.4.0: kaydırıcı ara değeri (ses, sıcaklık, sayı...): bildirim yalnız bırakınca
    return istek.eylem?.parlaklik !== undefined && istek.sonDeger !== true; // kaydırıcı ara değerleri
  }

  function basariBildir(sonuc, istek) {
    if (sessizMi(istek)) return;
    let metin;
    if (sonuc.parlaklik !== undefined) metin = t('sonuc.parlaklik', { ad: kisalt(sonuc.ad, AD_SINIRI), yuzde: sonuc.parlaklik });
    else if (sonuc.servisEylemi === true) metin = gonderildiMetni(sonuc.ad, t); // 1.4.0 servis eylemi: "komut gönderildi"
    else metin = basariMetni(sonuc.alan, sonuc.ad, sonuc.onceki, sonuc.yeni, t);
    geriBildirim({ tur: 'ok', metin });
  }

  /**
   * Hattı çalıştırır; geri bildirim, "Son" ve durum tazelemeyi yapar.
   * @returns {Promise<{ok: boolean, tur?: string, ad?: string}>} hata ayrıntısı (ağ, adres) dışarı verilmez
   */
  async function calistir(istek) {
    const sonuc = await hat(istek);
    if (sonuc.ok) {
      basariBildir(sonuc, istek);
      // "Son kullanılanlar" tek tıklamayla yinelenebilen eylemleri tutar; servis eylemi (klima 24, ışık rengi, ses 30) yinelenemez.
      if (YUZEYLER.includes(istek.kaynak) && sonuc.sinif === 'zararsiz' && sonuc.servisEylemi !== true) son.ekle(istek.kimlik);
      if (!canliMi()) zaman.setTimeout(() => Promise.resolve(durumlariYenile()).catch(() => {}), REST_SONRASI_YENILEME_MS);
      return { ok: true, ad: sonuc.ad };
    }
    if (sonuc.tur === 'onay-gerekli' || sonuc.tur === 'cok-sik') return { ok: false, tur: sonuc.tur, ad: sonuc.ad }; // sessiz: yüzey kendi ipucunu gösterir
    if (sonuc.tur === 'ha-hatasi' && sonuc.neden === 'gecikti') {
      // h-09 (1.2.0): komut HA'ya gitti ama yanıt gecikti (uzun sahne): "Yapılamadı" denmez; sonuç bilinmiyor.
      gunluk('Eylem yanıtı gecikti: ha-hatasi/gecikti');
      geriBildirim({ tur: 'ok', metin: `${kisalt(sonuc.ad || istek?.kimlik || '', AD_SINIRI)}: ${hataMetni({ tur: 'gecikti' }, t)}` });
      if (!canliMi()) Promise.resolve(durumlariYenile()).catch(() => {});
      return { ok: false, tur: sonuc.tur, ad: sonuc.ad };
    }
    gunluk(`Eylem başarısız: ${sonuc.tur}${sonuc.neden ? `/${sonuc.neden}` : ''}`);
    geriBildirim({ tur: 'hata', metin: hataBildirimiMetni(eylemHataMetni(sonuc, t), t), baslik: `${adAl()} — ${kisalt(sonuc.ad || istek?.kimlik || '', AD_SINIRI)}` });
    if (!canliMi()) Promise.resolve(durumlariYenile()).catch(() => {});
    return { ok: false, tur: sonuc.tur, ad: sonuc.ad };
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

    /** Eylem kısayolu (hiz-05): yalnız zararsız eylemler çalışır, yıkıcı olan hatta 'kaynak-izinsiz' olur. */
    kisayolla(kimlik) {
      return calistir({ kimlik, kaynak: 'kisayol' });
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
      let eylemYuku; // "led 40" -> parlaklık, "led 0" -> kapat (turn_off); "klima 24" -> servis; düz ad -> varlığın kendi eylemi
      if (cozum.parlaklik !== undefined) eylemYuku = { parlaklik: cozum.parlaklik };
      else if (cozum.kapat === true) eylemYuku = { servis: 'turn_off' };
      else if (typeof cozum.servis === 'string') eylemYuku = cozum.veri === undefined ? { servis: cozum.servis } : { servis: cozum.servis, veri: cozum.veri };
      return calistir({ kimlik: cozum.id, kaynak: 'komut-satiri', eylem: eylemYuku });
    },
  };
}

module.exports = { REST_SONRASI_YENILEME_MS, eylemHataMetni, eylemKatmaniOlustur };
