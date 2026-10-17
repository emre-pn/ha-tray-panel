'use strict';

/**
 * Gecikmeli eylem (o-15, 1.4.0 eylem grubu; Electron'a bağlı değildir): "salon 10 dk sonra kapat", "fan 30dk" (şimdi aç, 30 dk sonra kapat).
 * Palet söz dizimi src/lib/arama.js gecikmeCoz'dadır; burada yalnız ana süreç tarafı vardır: doğrulama, bekleyen liste, zamanlayıcı, iptal.
 *
 * Güvenlik ve sınırlar:
 *  - Yalnız ışık, priz (switch), vantilatör, input_boolean ve nem alıcı ertelenebilir; yalnız aç / kapat. Kapı, kilit, alarm, garaj, kepenk,
 *    sahne, düğme, script, otomasyon, vana ve kamera bu yoldan ASLA ertelenmez.
 *  - Kimlik ayardaki FAVORİLERDEN biri olmalıdır; favori değilse yalnız `paletDigerCihazlar` açıkken ve kimlik "diğer cihazlar" listesindeyse
 *    (src/lib/diger-cihazlar.js) kabul edilir. Serbest kimlikle eylem kurulamaz ('bilinmeyen-favori'); zamanı gelince aynı koşul yeniden denetlenir.
 *  - Planlanırken varlığın GÜNCEL durumu okunur ve Kapı Kuralı + eylem sınıfı denetlenir (yıkıcı sınıf reddedilir). Zamanı gelince eylem
 *    yine tek güvenli hattan geçer (eylem.kayitliCalistir, kaynak 'gecikmeli'): Kapı Kuralı, eylem sınıfı + yüzey izni (gecikmeli onay
 *    SUNAMAZ, yıkıcı çalışmaz), servis izin listesi, hız sınırı, tek POST. Hat kuralları o an yeniden uygulanır.
 *  - Süre 1 dakika - 24 saat; en çok 10 bekleyen eylem. Aynı varlığa aynı işlemi yeniden planlamak eskisinin yerine geçer.
 *  - Bekleyenler yalnız bellektedir: uygulama kapanınca hepsi iptal olur, bilgisayar uykudayken çalışmaz. Zamanlayıcı tetiklendiğinde
 *    planlanan zamandan 2 dakikadan fazla geçmişse (uyku, saat atlaması) eylem ÇALIŞTIRILMAZ, kullanıcıya "çalışmadı" denir.
 *  - Ayar `gecikmeliEylem` kapanınca bekleyenlerin hepsi iptal edilir.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, guvenliVarlikMi } = require('./suzgec');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { kisalt } = require('./metin');
const { AD_SINIRI } = require('./bildirim-metni');
const { TR } = require('./ceviri-varsayilan');
const { GECIKME_ALANLARI, EN_AZ_GECIKME_DK, EN_COK_GECIKME_DK } = require('./arama');

const ETIKET = 'gecikmeli';
const KAYNAKLAR = Object.freeze(['panel', 'palet']); // planı kuran yüzey
const YONLER = Object.freeze({ ac: 'turn_on', kapat: 'turn_off' });
const EN_COK_BEKLEYEN = 10;
const GEC_KALMA_TOLERANSI_MS = 2 * 60_000;
const ERKEN_UYANMA_MS = 1000; // zamanlayıcı bundan fazla erken tetiklenirse yeniden kurulur
const EN_COK_ZAMANLAYICI_MS = 2_000_000_000; // setTimeout üst sınırının (2^31-1) altında

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => {
      const id = globalThis.setTimeout(fn, ms);
      if (typeof id?.unref === 'function') id.unref(); // bekleyen eylem süreç çıkışını geciktirmesin
      return id;
    },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

const ikiHane = (n) => String(n).padStart(2, '0');
const varsayilanSaat = (ms) => {
  const d = new Date(ms);
  return `${ikiHane(d.getHours())}:${ikiHane(d.getMinutes())}`;
};

/**
 * @param {object} bag
 * @param {object} bag.eylem eylem katmanı (src/eylem.js)
 * @param {() => object} bag.ayarlarAl ayarlar (gecikmeliEylem, favoriler)
 * @param {(b: {tur: 'ok'|'hata', metin: string}) => void} [bag.bildir] kullanıcı geri bildirimi
 * @param {Function} [bag.t] çevirmen (verilmezse Türkçe)
 * @param {() => void} [bag.degisti] bekleyen liste değişti (panel modeli yenilensin)
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {(m: string) => void} [bag.gunluk]
 * @param {(ms: number) => string} [bag.saatMetni] kullanıcının saat biçimiyle saat metni
 * @param {(kayit: object) => void} [bag.kaydet] etkinlik geçmişine satır yazar (etkinlik.ekle)
 * @param {(kimlik: string) => Promise<boolean>|boolean} [bag.digerMi] kimlik palet "diğer cihazlar" listesinde mi (ayar kapalıysa false); verilmezse favori dışı reddedilir
 */
function gecikmeliEylemOlustur({ eylem, ayarlarAl, bildir = () => {}, t = TR, degisti = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman(), gunluk = () => {}, saatMetni = varsayilanSaat, kaydet = () => {}, digerMi = () => false }) {
  const acikMi = () => ayarlarAl()?.gecikmeliEylem !== false;
  const bekleyenler = new Map(); // id -> { id, kimlik, ad, servis, yon, bitis, zamanlayici }
  let sayac = 0;

  const adiAl = (varlik, kimlik) => {
    const ad = varlik?.attributes?.friendly_name;
    return kisalt(typeof ad === 'string' && ad.trim() ? ad.trim() : kimlik, AD_SINIRI);
  };

  const favoriBul = (kimlik) => (ayarlarAl()?.favoriler ?? []).find((f) => f?.entity_id === kimlik);

  /** Favori ise ayardaki kayıt (kendi ayarlarıyla), değilse tek seferlik kayıt (yalnız "diğer cihazlar" yolundan gelmiş kimlik için). Kapı Kuralı hatta yine uygulanır. */
  function kayitBul(kimlik, ad) {
    return favoriBul(kimlik) ?? { entity_id: kimlik, ad };
  }

  function zamanlayiciKur(o) {
    zaman.clearTimeout(o.zamanlayici);
    // Zamanlayıcı işlevi sözü döner (testler bekleyebilsin); hata asla yutulmadan kalmaz ama süreci de düşürmez.
    o.zamanlayici = zaman.setTimeout(() => calis(o.id).catch(() => gunluk('Gecikmeli eylem hatası.')), Math.min(EN_COK_ZAMANLAYICI_MS, Math.max(1, o.bitis - simdi())));
  }

  function kaldir(id) {
    const o = bekleyenler.get(id);
    if (!o) return null;
    zaman.clearTimeout(o.zamanlayici);
    bekleyenler.delete(id);
    return o;
  }

  async function calis(id) {
    const o = bekleyenler.get(id);
    if (!o) return;
    const gecen = simdi() - o.bitis;
    if (gecen < -ERKEN_UYANMA_MS) {
      zamanlayiciKur(o); // zamanlayıcı erken uyandı (saat farkı): yeniden kurulur
      return;
    }
    kaldir(id);
    degisti();
    if (!acikMi()) return;
    // Planlandıktan sonra favoriden çıkarılmış ve "diğer cihazlar" yolu da kapalıysa serbest kimlikle eylem çalışmasın.
    if (!favoriBul(o.kimlik) && ayarlarAl()?.paletDigerCihazlar !== true) {
      kaydet({ kaynak: ETIKET, kimlik: o.kimlik, ad: o.ad, islem: o.servis, sonuc: 'atlandi', neden: 'favori-degil' });
      return;
    }
    if (gecen > GEC_KALMA_TOLERANSI_MS) {
      // Bilgisayar uyudu ya da saat ilerledi: eski bir komut sürpriz biçimde çalışmasın.
      kaydet({ kaynak: ETIKET, kimlik: o.kimlik, ad: o.ad, islem: o.servis, sonuc: 'atlandi', neden: 'kacirildi' });
      bildir({ tur: 'hata', metin: t('gecikmeli.kacirildi', { ad: o.ad }) });
      return;
    }
    try {
      // Başarı / hata bildirimini eylem katmanı verir; etkinlik geçmişine eylem izleyicisi yazar (kaynak 'gecikmeli').
      await eylem.kayitliCalistir({ kimlik: o.kimlik, kaynak: ETIKET, kayit: kayitBul(o.kimlik, o.ad), eylem: { servis: o.servis } }, ETIKET);
    } catch {
      gunluk('Gecikmeli eylem çalıştırılamadı.');
    }
  }

  /**
   * Gecikmeli eylem kurar.
   * @param {{kaynak: 'panel'|'palet', kimlik: string, yon: 'ac'|'kapat'|'sureli', dakika: number}} istek
   *   'sureli': varlık HEMEN açılır, `dakika` sonra kapatılır ("fan 30dk"). Açma başarısızsa hiçbir şey kurulmaz.
   * @returns {Promise<{ok: boolean, tur?: string, neden?: string, id?: string, bitis?: number}>}
   */
  async function planla({ kaynak, kimlik, yon, dakika } = {}) {
    if (!acikMi()) return { ok: false, tur: 'kapali' };
    if (!KAYNAKLAR.includes(kaynak) || typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return { ok: false, tur: 'gecersiz' };
    if (!GECIKME_ALANLARI.has(alanAl(kimlik))) return { ok: false, tur: 'gecersiz', neden: 'desteklenmiyor' };
    if (yon !== 'ac' && yon !== 'kapat' && yon !== 'sureli') return { ok: false, tur: 'gecersiz' };
    if (!Number.isInteger(dakika) || dakika < EN_AZ_GECIKME_DK || dakika > EN_COK_GECIKME_DK) return { ok: false, tur: 'gecersiz', neden: 'sinir' };
    const servis = yon === 'ac' ? YONLER.ac : YONLER.kapat; // sureli de sonunda kapatır

    // Kimlik favori olmalı; değilse yalnız ayar açıkken ve ana sürecin "diğer cihazlar" listesinde varsa kabul edilir (serbest kimlik reddedilir).
    if (!favoriBul(kimlik)) {
      let listede = false;
      try {
        listede = (await digerMi(kimlik)) === true;
      } catch {
        listede = false;
      }
      if (!listede || ayarlarAl()?.paletDigerCihazlar !== true) return { ok: false, tur: 'bilinmeyen-favori' };
    }

    let varlik;
    try {
      varlik = await eylem.guncelDurum(kimlik);
    } catch {
      return { ok: false, tur: 'ulasilamiyor' };
    }
    if (varlik === null || varlik === undefined) return { ok: false, tur: 'bulunamadi' };
    if (typeof varlik !== 'object' || varlik.entity_id !== kimlik || !guvenliVarlikMi(varlik)) return { ok: false, tur: 'yasak' };
    const ad = adiAl(varlik, kimlik);
    const kayit = kayitBul(kimlik, ad);
    if (eylemSinifi(varlik, kayit).sinif !== SINIF.ZARARSIZ) return { ok: false, tur: 'kaynak-izinsiz' }; // onay isteyen eylem ertelenemez

    const eski = [...bekleyenler.values()].find((o) => o.kimlik === kimlik && o.servis === servis);
    if (!eski && bekleyenler.size >= EN_COK_BEKLEYEN) return { ok: false, tur: 'dolu' };

    if (yon === 'sureli') {
      const simdiAc = await eylem.kayitliCalistir({ kimlik, kaynak, kayit, eylem: { servis: YONLER.ac }, sessiz: true }, 'cihaz');
      if (!simdiAc?.ok) {
        bildir({ tur: 'hata', metin: t('gecikmeli.acilamadi', { ad }) });
        return { ok: false, tur: simdiAc?.tur ?? 'hata' };
      }
    }

    if (eski) kaldir(eski.id);
    else if (bekleyenler.size >= EN_COK_BEKLEYEN) return { ok: false, tur: 'dolu' }; // aşırı yarış: açma beklerken liste dolmuş olabilir
    sayac += 1;
    const o = { id: `g${sayac}`, kimlik, ad, servis, yon: servis === YONLER.ac ? 'ac' : 'kapat', bitis: simdi() + dakika * 60_000, zamanlayici: null };
    bekleyenler.set(o.id, o);
    zamanlayiciKur(o);
    kaydet({ kaynak, kimlik, ad, islem: 'gecikmeli-kur', sonuc: 'ok' });
    const saat = saatMetni(o.bitis);
    if (yon === 'sureli') bildir({ tur: 'ok', metin: t('gecikmeli.sureli', { ad, saat }) });
    else bildir({ tur: 'ok', metin: t(yon === 'ac' ? 'gecikmeli.planlandiAc' : 'gecikmeli.planlandiKapat', { ad, saat }) });
    degisti();
    return { ok: true, id: o.id, bitis: o.bitis };
  }

  /** Tek bekleyeni iptal eder; geçerli kimlik değilse false. */
  function iptal(id, kaynak = 'panel') {
    if (typeof id !== 'string') return false;
    const o = kaldir(id);
    if (!o) return false;
    kaydet({ kaynak: KAYNAKLAR.includes(kaynak) || kaynak === 'tepsi-menu' ? kaynak : 'panel', kimlik: o.kimlik, ad: o.ad, islem: 'gecikmeli-iptal', sonuc: 'iptal' });
    degisti();
    return true;
  }

  /** Hepsini iptal eder; iptal edilen sayıyı döner. `sessiz`: kapanışta geçmişe yazma. */
  function hepsiniIptal({ kaynak = 'tepsi-menu', sessiz = false } = {}) {
    const idler = [...bekleyenler.keys()];
    for (const id of idler) {
      const o = kaldir(id);
      if (o && !sessiz) kaydet({ kaynak, kimlik: o.kimlik, ad: o.ad, islem: 'gecikmeli-iptal', sonuc: 'iptal' });
    }
    if (idler.length > 0 && !sessiz) degisti();
    return idler.length;
  }

  return {
    planla,
    iptal,
    hepsiniIptal,
    /** Bekleyenler, en yakın önde: [{ id, ad, yon: 'ac'|'kapat', bitis }]. Kimlik DIŞARI verilmez (panel yalnız opak kimlikle iptal eder). */
    ozet() {
      if (!acikMi()) return [];
      return [...bekleyenler.values()].sort((a, b) => a.bitis - b.bitis).map((o) => ({ id: o.id, ad: o.ad, yon: o.yon, bitis: o.bitis }));
    },
    sayi: () => bekleyenler.size,
    /** Ayar değişti: kapandıysa bekleyenlerin hepsi iptal olur. */
    ayarDegisti() {
      if (!acikMi()) hepsiniIptal({ kaynak: 'panel' });
      else degisti();
    },
    /** Uygulama çıkışı: hepsi iptal (hiçbir şey çalışmaz, geçmişe yazılmaz). */
    kapat() {
      hepsiniIptal({ sessiz: true });
    },
  };
}

module.exports = { ETIKET, KAYNAKLAR, YONLER, EN_COK_BEKLEYEN, GEC_KALMA_TOLERANSI_MS, gecikmeliEylemOlustur };
