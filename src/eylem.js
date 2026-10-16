'use strict';

/**
 * Eylem katmanı (ana süreç, Electron'a bağlı değildir): tepsi menüsü, panel, palet, genel kısayol ve komut satırı eylemlerinin
 * HEPSİ buradan geçer ve src/lib/eylem-hatti.js'deki tek güvenli hatta girer (kapı/kilit kuralı, eylem sınıfı, yüzey izni,
 * onay, hız sınırı, tek POST). Bu dosya hattın etrafındaki işleri yapar: güncel durumu bulur (canlı depo ya da REST),
 * geri bildirimi verir, "Son kullanılanlar"a yazar ve REST yedeğinde durumu tazeler.
 *
 * Renderer'dan gelen HİÇBİR değer onay yerine geçmez: panel/palet yıkıcı eylemi yalnız ana sürecin kendi saatiyle doğruladığı
 * "basılı tutma" ile (yuzey:basili-basla) çalıştırabilir; tepsi onayı yalnız bu dosyadaki onay penceresiyle verilir.
 */

const { eylemHattiOlustur, basiliTutmaDeposu } = require('./lib/eylem-hatti');
const { SINIF, eylemSinifi } = require('./lib/eylem-sinifi');
const { eylemAdiniCoz } = require('./lib/komut-satiri');
const { durumuDuzelt } = require('./lib/ha-ws-protokol');
const { AD_SINIRI, basariMetni, hataBildirimiMetni } = require('./lib/bildirim-metni');
const { TR } = require('./lib/ceviri-varsayilan');
const { tekrarliMi } = require('./lib/favoriler');
const { kisalt } = require('./lib/metin');
const { hataMetni } = require('./ha-istemcisi');

const REST_SONRASI_YENILEME_MS = 1000; // canlı bağlantı yokken cihazın durumunu bildirmesi için kısa bekleme
const YUZEYLER = ['panel', 'palet'];

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
    case 'gecersiz':
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
  uygulamaAdi = 'Ev Paneli',
  t: tVerilen,
  gunluk = () => {},
  zaman = varsayilanZaman(),
  simdi = () => Date.now(),
}) {
  const t = tVerilen ?? TR;
  const adAl = () => (tVerilen ? t('uygulama.ad') : uygulamaAdi);
  const favoriAl = (kimlik) => (ayarlarAl()?.favoriler ?? []).find((f) => f.entity_id === kimlik);
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

  function sessizMi(istek) {
    if (!YUZEYLER.includes(istek.kaynak)) return false;
    if (tekrarliMi(istek.kimlik)) return true; // ses -/+ basılı tutma: her basışta bildirim çıkmasın
    return istek.eylem?.parlaklik !== undefined && istek.sonDeger !== true; // kaydırıcı ara değerleri
  }

  function basariBildir(sonuc, istek) {
    if (sessizMi(istek)) return;
    const metin = sonuc.parlaklik !== undefined ? t('sonuc.parlaklik', { ad: kisalt(sonuc.ad, AD_SINIRI), yuzde: sonuc.parlaklik }) : basariMetni(sonuc.alan, sonuc.ad, sonuc.onceki, sonuc.yeni, t);
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
      if (YUZEYLER.includes(istek.kaynak) && sonuc.sinif === 'zararsiz') son.ekle(istek.kimlik);
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
     * @param {unknown} yuk { kimlik, parlaklik?, sonDeger?, basili? }
     */
    async yuzeydenCalistir(kaynak, yuk) {
      if (!YUZEYLER.includes(kaynak) || !yuk || typeof yuk !== 'object' || Array.isArray(yuk)) return { ok: false, tur: 'gecersiz' };
      if (typeof yuk.kimlik !== 'string' || yuk.kimlik.length > 120) return { ok: false, tur: 'gecersiz' };
      const istek = { kimlik: yuk.kimlik, kaynak };
      if (yuk.parlaklik !== undefined) {
        if (!Number.isInteger(yuk.parlaklik)) return { ok: false, tur: 'gecersiz' };
        istek.eylem = { parlaklik: yuk.parlaklik };
      } else if (yuk.kapat === true) {
        istek.eylem = { servis: 'turn_off' }; // palet "ışık 0": yalnız bu sabit servis; başka servis adı renderer'dan KABUL EDİLMEZ
      }
      if (yuk.sonDeger === true) istek.sonDeger = true;
      if (yuk.basili === true) istek.onay = 'basili';
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

    /** `--eylem=<ad>` (hiz-05): ad yalnız güvenli favori karoları arasında aranır; belirsizse hiçbir şey çalışmaz. */
    async komutSatirindan(ad) {
      const cozum = eylemAdiniCoz(ad, karolariAl());
      if (cozum.hata) {
        gunluk(`Komut satırı eylemi çözülemedi: ${cozum.hata}`);
        geriBildirim({ tur: 'hata', metin: t(cozum.hata === 'belirsiz' ? 'sonuc.komutBelirsiz' : 'sonuc.komutBulunamadi') });
        return { ok: false, tur: cozum.hata };
      }
      let eylemYuku; // "led 40" -> parlaklık, "led 0" -> kapat (turn_off); düz ad -> varlığın kendi eylemi
      if (cozum.parlaklik !== undefined) eylemYuku = { parlaklik: cozum.parlaklik };
      else if (cozum.kapat === true) eylemYuku = { servis: 'turn_off' };
      return calistir({ kimlik: cozum.id, kaynak: 'komut-satiri', eylem: eylemYuku });
    },
  };
}

module.exports = { REST_SONRASI_YENILEME_MS, eylemHataMetni, eylemKatmaniOlustur };
