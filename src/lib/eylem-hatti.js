'use strict';

/**
 * Tek güvenli eylem hattı (saf; ağ ve Electron dışarıdan verilir) — hiz-01, hiz-02, hiz-05, hiz-09.
 *
 * Tepsi menüsü, panel, palet, kısayol ve komut satırı AYNI hattan geçer; hiçbir yüzey başka bir yoldan servis çağıramaz.
 * Sıra (her adım bir öncekinden SONRA, hiçbiri atlanamaz):
 *   1. kaynak / kimlik / eylem biçimi doğrulaması                                  -> 'gecersiz'
 *   2. kimlik ayardaki favorilerde olmalı (serbest metin eylem YOK)                -> 'bilinmeyen-favori'
 *   3. kayıtlı adla önsüzgeç; HA'daki GÜNCEL durumla GÜVENLİK KURALI yeniden       -> 'yasak' / 'ulasilamiyor'
 *   4. eylem sınıfı + yüzey izni + onay (basılı tutma / onay penceresi)            -> 'kaynak-izinsiz' / 'onay-gerekli'
 *      (1.4.0 dış tetiklerde ayrıca disKaynakIzni: valf/otomasyon/kamera/perde, klima modu) -> 'kaynak-izinsiz'
 *   5. servis, sabit izin listesinden (alan + eylem)                               -> 'gecersiz'
 *   6. varlık başına hız sınırı (sürükleme/basılı tutma); son değer sınırı aşar    -> 'cok-sik'
 *   7. POST tam BİR kez (asla yeniden denenmez)                                    -> 'ha-hatasi'
 *
 * Kapı/kilit/alarm/garaj/bariyer/gate/lock varlıkları 3. adımda her zaman durur; bu dosya o kuralı gevşetmez.
 *
 * 1.4.0 — genel "servis eylemi" yolu (AYNI hat, AYNI tek POST): istek.eylem = { servis, veri } ile kimlik + servis + parametreler
 * gelir. Sıra: kayıtlı varlık (2) -> süzgeç (3; alan alan-kaydi.js'te 'eylem' türünde olmalı) -> eylem sınıfı servisle birlikte
 * (4; eylemSinifi(varlik, favori, servis): climate.set_hvac_mode, seçici/sayı/zamanlayıcı varsayılan onaylı, todo.remove_item
 * zorunlu onaylı) -> izin listesi + parametre sınırları (5; servis-izinleri.js servisDogrula, sınırlar HA'daki GÜNCEL
 * öznitelikten) -> hız sınırı (6) -> yetki kesici/kimlikli kapı (haIstek, 7) -> HA. Yalnız okunur alanlarda (sensor,
 * binary_sensor, weather, calendar) hiçbir servis çağrılmaz ('yasak').
 * Parametresiz 1.3.0 servisleri (toggle/turn_on/turn_off/press) IZINLI_SERVISLER ile eskisi gibi kurulur.
 *
 * Tek POST noktası servisPostla'dır (bu dosyanın sonunda): varlık eylemi (calistir) ve HA kalıcı bildirimini kapatma
 * (bildirimKapatHattiOlustur; varlıksız persistent_notification.dismiss) ikisi de oradan geçer.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, guvenliVarlikMi } = require('./suzgec');
const { eylemAlaniMi, varsayilanServis } = require('./alan-kaydi');
const { servisDogrula, varliksizServisDogrula } = require('./servis-izinleri');
const { SINIF, KAYNAKLAR, DIS_KAYNAKLAR, eylemSinifi, kaynakIzni, disKaynakIzni } = require('./eylem-sinifi');

/**
 * 1.3.0'ın PARAMETRESİZ servisleri (sabit izin listesi). İlk eleman varsayılan servistir (alan-kaydi.js varsayilanServis ile aynı).
 * Parametreli ve 1.4.0 servisleri src/lib/servis-izinleri.js'tedir (SERVIS_IZINLERI); orası bunların üst kümesidir.
 */
const IZINLI_SERVISLER = Object.freeze({
  light: ['toggle', 'turn_on', 'turn_off'],
  switch: ['toggle', 'turn_on', 'turn_off'],
  fan: ['toggle', 'turn_on', 'turn_off'],
  input_boolean: ['toggle', 'turn_on', 'turn_off'],
  scene: ['turn_on'],
  script: ['turn_on'],
  button: ['press'],
  input_button: ['press'],
});

const ORAN_PENCERESI_MS = 1000;
const ORAN_SINIRI = 8; // varlık başına saniyede çağrı
const ORAN_SINIRI_DUGME = 6; // düğme basışları (ses -/+ basılı tutma ~4/sn)
const ORAN_SINIRI_SON = 10; // sonDeger (kaydırıcı bırakıldı / hazır seviye) gönderimleri: normal sınırı aşar ama KENDİ sınırı vardır

const BASILI_SURE_MS = 800;
const BASILI_TOLERANS_MS = 100; // zamanlayıcı/IPC gecikmesi payı
const BASILI_SINIRI = 32; // aynı anda tutulan en çok başlangıç kaydı
const BASILI_OMUR_MS = 10_000; // başlatılıp unutulan basış sonsuza dek geçerli kalmasın (0,8 sn tutma + istek gecikmesi için bol)

/**
 * Panel/palet'te "basılı tut" onayının ana süreç tarafı. Renderer yalnız "basış başladı" der (yuzey:basili-basla); onay,
 * ana sürecin kendi saatiyle en az ~0,8 sn geçmişse ve yalnız BİR kez geçerlidir. Böylece tek bir IPC çağrısıyla
 * yıkıcı eylem çalıştırılamaz.
 * Sınırda (BASILI_SINIRI) yalnız süresi dolmuş ya da EN ESKİ kayıt atılır; o an tutulmakta olan basış silinmez. Yüzey (panel/palet)
 * gizlenince ya da kip değişince başlamış basışlar src/yuzey-yoneticisi.js tarafından iptal edilir.
 * @param {{simdi?: () => number, sureMs?: number}} [secenek]
 */
function basiliTutmaDeposu({ simdi = () => Date.now(), sureMs = BASILI_SURE_MS } = {}) {
  const basislar = new Map(); // kimlik -> başlangıç zamanı (ekleme sırası = başlama sırası)
  return {
    basla(kimlik) {
      if (typeof kimlik !== 'string') return false;
      const t = simdi();
      basislar.delete(kimlik); // yeniden başlayan basış sıranın sonuna gider
      if (basislar.size >= BASILI_SINIRI) {
        for (const [k, bas] of basislar) if (t - bas > BASILI_OMUR_MS) basislar.delete(k);
        if (basislar.size >= BASILI_SINIRI) basislar.delete(basislar.keys().next().value); // sınırsız büyümesin: yalnız en eskisi
      }
      basislar.set(kimlik, t);
      return true;
    },
    /** Yeterince basılı tutuldu mu? Doğruysa kayıt tüketilir (ikinci kez kullanılamaz). */
    tuket(kimlik) {
      const bas = basislar.get(kimlik);
      if (bas === undefined) return false;
      basislar.delete(kimlik);
      const gecen = simdi() - bas;
      return gecen >= sureMs - BASILI_TOLERANS_MS && gecen <= BASILI_OMUR_MS;
    },
    iptal(kimlik) {
      basislar.delete(kimlik);
    },
    temizle() {
      basislar.clear();
    },
  };
}

/**
 * Hız sınırlayıcı: varlık başına kayan 1 sn'lik pencere. `sonDeger` (sürükleme bırakıldı) normal sınırı aşar ve normal
 * sayıma girer, ama kendi sınırı da vardır (ORAN_SINIRI_SON/sn): renderer'ın "son değer" beyanı sınırsız çağrı hakkı vermez.
 */
function hizSiniriOlustur({ simdi = () => Date.now() } = {}) {
  const cagrilar = new Map(); // kimlik -> [{ t, son }]
  return {
    /** @returns {boolean} true = çağrıya izin verildi (ve sayıldı) */
    dene(kimlik, { sinir = ORAN_SINIRI, sonDeger = false } = {}) {
      const t = simdi();
      const liste = (cagrilar.get(kimlik) ?? []).filter((z) => t - z.t < ORAN_PENCERESI_MS);
      const doldu = sonDeger ? liste.filter((z) => z.son).length >= ORAN_SINIRI_SON : liste.length >= sinir;
      if (doldu) {
        cagrilar.set(kimlik, liste);
        return false;
      }
      liste.push({ t, son: sonDeger });
      cagrilar.set(kimlik, liste);
      if (cagrilar.size > 400) for (const [k, v] of cagrilar) if (v.every((z) => t - z.t >= ORAN_PENCERESI_MS)) cagrilar.delete(k);
      return true;
    },
    temizle() {
      cagrilar.clear();
    },
  };
}

const SERVIS_ADI_DESENI = /^[a-z_]{1,40}$/;

/** istek.eylem biçim denetimi (1. adım): servis adı kısa düz metin, veri düz nesne, parlaklık ile veri birlikte olmaz. */
function eylemBicimiGecerliMi(eylem) {
  if (eylem === undefined) return true;
  if (eylem === null || typeof eylem !== 'object' || Array.isArray(eylem)) return false;
  if (eylem.servis !== undefined && (typeof eylem.servis !== 'string' || !SERVIS_ADI_DESENI.test(eylem.servis))) return false;
  if (eylem.veri !== undefined && (eylem.veri === null || typeof eylem.veri !== 'object' || Array.isArray(eylem.veri))) return false;
  if (eylem.veri !== undefined && eylem.parlaklik !== undefined) return false;
  return true;
}

/** Sınıflama için istenen servis (4. adım): parlaklık turn_on'dur; servis verilmediyse undefined (tek tıklama eylemi). */
function istenenServis(eylem) {
  if (!eylem || typeof eylem !== 'object') return undefined;
  if (eylem.parlaklik !== undefined) return 'turn_on';
  return typeof eylem.servis === 'string' ? eylem.servis : undefined;
}

function parlaklikDuzelt(deger) {
  return Number.isInteger(deger) && deger >= 1 && deger <= 100 ? deger : null;
}

/**
 * Servis ve gövdeyi sabit izin listesinden kurar. 1.3.0 parametresiz servisler IZINLI_SERVISLER'den; parametreli ve 1.4.0
 * servisleri servis-izinleri.js servisDogrula ile (alan izin listesi + parametre şeması + HA'daki GÜNCEL sınırlar).
 * @param {object} varlik HA'daki güncel durum (sınırlar ve seçenek listeleri buradan okunur)
 * @returns {{servis: string, govde: object, servisEylemi: boolean}|{hata: string}}
 */
function servisKur(alan, kimlik, favori, eylem, varlik) {
  const istek = eylem && typeof eylem === 'object' ? eylem : {};
  if (istek.parlaklik !== undefined) {
    const yuzde = parlaklikDuzelt(istek.parlaklik);
    // Yalnız "parlaklık kontrollü" ışık favorisinde; başka alanda ya da kontrolü kapalı ışıkta REDDEDİLİR.
    if (yuzde === null || alan !== 'light' || favori.parlaklik !== true) return { hata: 'parametre' };
    return { servis: 'turn_on', govde: { entity_id: kimlik, brightness_pct: yuzde }, servisEylemi: false };
  }
  const servis = istek.servis === undefined ? varsayilanServis(alan) : istek.servis;
  if (typeof servis !== 'string') return { hata: 'servis' }; // tek tıklama eylemi olmayan alan (iklim, medya...): servis açıkça verilmeli
  const izinli = IZINLI_SERVISLER[alan];
  if (istek.veri === undefined && izinli?.includes(servis)) return { servis, govde: { entity_id: kimlik }, servisEylemi: false };
  const dogrulama = servisDogrula(alan, servis, istek.veri, varlik);
  if (!dogrulama.ok) return { hata: dogrulama.neden };
  return { servis, govde: dogrulama.govde, servisEylemi: true };
}

/**
 * Eylem grubu (o-12 geri al): eylemden ÖNCEKİ durumun küçük, süzülmüş anlık görüntüsü. Yalnız geri yüklemeye yarayan öznitelikler
 * (parlaklık, renk, vantilatör yüzdesi, sahne üyeleri) ve yalnız basit değerler (sayı, kısa metin, küçük sayı/metin dizisi) alınır;
 * başka hiçbir öznitelik (adres, resim adresi, kullanıcı metni) dışarı çıkmaz.
 */
const ONCE_OZNITELIKLERI = Object.freeze(['brightness', 'color_temp_kelvin', 'rgb_color', 'hs_color', 'xy_color', 'color_mode', 'percentage', 'entity_id']);
const ONCE_DIZI_SINIRI = 40;

function oncekiGoruntu(varlik) {
  const nitelikler = varlik?.attributes && typeof varlik.attributes === 'object' ? varlik.attributes : {};
  const alinan = {};
  for (const ad of ONCE_OZNITELIKLERI) {
    const d = nitelikler[ad];
    if (typeof d === 'number' && Number.isFinite(d)) alinan[ad] = d;
    else if (typeof d === 'string' && d.length <= 80) alinan[ad] = d;
    else if (Array.isArray(d) && d.length <= ONCE_DIZI_SINIRI && d.every((e) => (typeof e === 'number' && Number.isFinite(e)) || (typeof e === 'string' && e.length <= 80))) alinan[ad] = [...d];
  }
  return { state: String(varlik?.state ?? '').slice(0, 40), attributes: alinan };
}

function hataTuru(hata) {
  return typeof hata?.tur === 'string' ? hata.tur : 'bilinmeyen';
}

/** HTTP durum kodu varsa (yalnız tam sayı) hata sonucuna eklenir: "sunucu hatası (500)" gibi metin için. */
function hataSonucu(hata, ad) {
  const sonuc = { ok: false, tur: 'ha-hatasi', neden: hataTuru(hata), ad };
  if (Number.isInteger(hata?.durumKodu) && hata.durumKodu > 0) sonuc.durumKodu = hata.durumKodu;
  return sonuc;
}

/**
 * @param {object} bag
 * @param {(kimlik: string) => object|undefined} bag.favoriAl ayardaki favori kaydı
 * @param {(kimlik: string) => Promise<object|null|undefined>} bag.guncelDurum HA'daki GÜNCEL durum (canlı depo ya da REST); null = HA'da yok
 * @param {(yol: string, secenek: {yontem: string, govde: object}) => Promise<unknown>} bag.haIstek tek servis çağrısı
 * @param {(kimlik: string) => boolean} [bag.basiliOnayi] 'basili' onayı ana süreççe doğrulandı mı (tüketir)
 * @param {{dene: Function}} [bag.hizSiniri]
 */
function eylemHattiOlustur({ favoriAl, guncelDurum, haIstek, basiliOnayi = () => false, hizSiniri = hizSiniriOlustur() }) {
  /**
   * @param {{kimlik: string, kaynak: string, onay?: 'diyalog'|'basili', eylem?: {parlaklik?: number, servis?: string, veri?: object}, sonDeger?: boolean}} istek
   *   onay: YALNIZ ana sürecin kendi koduyla verilir ('diyalog': onay penceresi yanıtlandı; 'basili': basılı tutma isteği).
   *   eylem.servis + eylem.veri (1.4.0): servis eylemi; veri, servis-izinleri.js şemasıyla doğrulanır.
   * @param {object} [ic] YALNIZ ana süreç içi (src/eylem.js) çağrılar için: ic.kayit = tek seferlik kayıt { entity_id, ad, ... }; verilirse
   *   "kimlik ayardaki favorilerde olmalı" adımında favoriAl yerine bu kayıt kullanılır (geri al ve "diğer cihazlar" yolları). Renderer'dan
   *   gelen istek bu nesneyi taşıyamaz; geri kalan TÜM adımlar (süzgeç, sınıf, yüzey izni, servis listesi, hız sınırı, tek POST) aynen çalışır.
   * @returns {Promise<{ok: true, ad: string, alan: string, servis: string, sinif: string, onceki: string, once: {state: string, attributes: object}, yeni?: string, parlaklik?: number, servisEylemi: boolean}
   *   | {ok: false, tur: string, neden?: string, ad?: string}>}
   *   'gecersiz' sonucunda neden (5. adımda): 'servis' | 'parametre' | 'eksik' | 'sinir' | 'adim' | 'desteklenmiyor' | 'guvenlik'
   *   tur: 'gecersiz' | 'bilinmeyen-favori' | 'yasak' | 'ulasilamiyor' | 'bulunamadi' | 'kaynak-izinsiz' | 'onay-gerekli' | 'cok-sik' | 'ha-hatasi'
   */
  return async function calistir(istek, ic) {
    const { kimlik, kaynak, onay, eylem, sonDeger } = istek && typeof istek === 'object' ? istek : {};
    // 1. biçim
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return { ok: false, tur: 'gecersiz' };
    if (!KAYNAKLAR.includes(kaynak)) return { ok: false, tur: 'gecersiz' };
    if (onay !== undefined && onay !== 'diyalog' && onay !== 'basili') return { ok: false, tur: 'gecersiz' };
    if (!eylemBicimiGecerliMi(eylem)) return { ok: false, tur: 'gecersiz' };

    // 2. favori listesinde olmalı
    const favori = ic && typeof ic === 'object' && ic.kayit !== undefined ? ic.kayit : favoriAl(kimlik);
    if (!favori || typeof favori !== 'object' || favori.entity_id !== kimlik) return { ok: false, tur: 'bilinmeyen-favori' };

    // 3. güvenlik: önce kayıtlı adla (ağsız), sonra HA'daki güncel durumla
    const alan = alanAl(kimlik);
    if (!eylemAlaniMi(alan)) return { ok: false, tur: 'yasak' }; // alan-kaydi.js: yalnız 'eylem' türü alanlar (okunur alanda servis YOK)
    let ad = typeof favori.ad === 'string' && favori.ad ? favori.ad : kimlik;
    if (!adGuvenliMi(kimlik, ad)) return { ok: false, tur: 'yasak', ad };
    let varlik;
    try {
      varlik = await guncelDurum(kimlik);
    } catch (hata) {
      return hataSonucu(hata, ad);
    }
    if (varlik === null || varlik === undefined) return { ok: false, tur: 'bulunamadi', ad };
    if (typeof varlik !== 'object' || varlik.entity_id !== kimlik || !guvenliVarlikMi(varlik)) return { ok: false, tur: 'yasak', ad };
    const canliAd = varlik.attributes?.friendly_name;
    if (typeof canliAd === 'string' && canliAd.trim()) ad = canliAd.trim().slice(0, 100);
    if (varlik.state === 'unavailable') return { ok: false, tur: 'ulasilamiyor', ad };

    // 4. sınıf, yüzey izni, onay
    const siniflama = eylemSinifi(varlik, favori, istenenServis(eylem));
    const izin = kaynakIzni(siniflama.sinif, kaynak);
    if (!izin.izin) return { ok: false, tur: 'kaynak-izinsiz', ad };
    if (izin.onayTuru) {
      const onayli = izin.onayTuru === 'diyalog' ? onay === 'diyalog' : onay === 'basili' && basiliOnayi(kimlik) === true;
      if (!onayli) return { ok: false, tur: 'onay-gerekli', ad };
    }
    // 4b. 1.4.0 dış tetikler (Jump List, .lnk, yerel API, evpaneli://, PC olayı, toplantı ışığı): valf, otomasyon, kamera, perde/kepenk ve
    // klima modu değişimi zararsız sayılsa da çalışmaz (src/lib/dis-tetik.js kapısı da bakar; bu savunma derinliğidir).
    if (DIS_KAYNAKLAR.includes(kaynak) && !disKaynakIzni(alan, istenenServis(eylem) ?? varsayilanServis(alan) ?? undefined)) return { ok: false, tur: 'kaynak-izinsiz', ad };

    // 5. servis (sabit izin listesi + parametre sınırları; servis-izinleri.js servisDogrula)
    const kurulan = servisKur(alan, kimlik, favori, eylem, varlik);
    if (kurulan.hata) return { ok: false, tur: 'gecersiz', neden: kurulan.hata, ad };

    // 6. hız sınırı
    const sinir = alan === 'button' || alan === 'input_button' ? ORAN_SINIRI_DUGME : ORAN_SINIRI;
    if (!hizSiniri.dene(kimlik, { sinir, sonDeger: sonDeger === true })) return { ok: false, tur: 'cok-sik', ad };

    // 7. POST tam bir kez
    const once = oncekiGoruntu(varlik); // eylemden ÖNCEKİ durum (geri al, o-12); POST'tan önce alınır
    let yanit;
    try {
      yanit = await servisPostla(haIstek, alan, kurulan.servis, kurulan.govde);
    } catch (hata) {
      return hataSonucu(hata, ad);
    }
    const yeni = Array.isArray(yanit) ? yanit.find((d) => d?.entity_id === kimlik)?.state : undefined;
    const sonuc = { ok: true, ad, alan, servis: kurulan.servis, sinif: siniflama.sinif === SINIF.YIKICI ? 'yikici' : 'zararsiz', onceki: varlik.state, once, servisEylemi: kurulan.servisEylemi };
    if (typeof yeni === 'string') sonuc.yeni = yeni;
    if (kurulan.govde.brightness_pct !== undefined) sonuc.parlaklik = kurulan.govde.brightness_pct;
    return sonuc;
  };
}

const BILDIRIM_ORAN_SINIRI = 4; // saniyede kapatma çağrısı (tüm bildirimler toplamı)

/**
 * 1.4.0 (bildirim grubu): HA kalıcı bildirimini kapatma — varlıksız TEK servis (persistent_notification.dismiss), AYNI tek POST
 * noktasından (servisPostla) ve yetki kesici/kimlikli kapıdan (haIstek) geçer. Sıra: kaynak yalnız hızlı panel -> servis izin
 * listesi + kimlik deseni (servis-izinleri.js varliksizServisDogrula) -> kimlik şu an panelde gösterilen (Kapı Kuralı'ndan geçmiş)
 * bir HA bildirimi olmalı -> hız sınırı -> POST. Başka servis ya da serbest kimlik gönderilemez.
 * @param {object} bag
 * @param {(kimlik: string) => boolean} bag.bildirimKayitliMi kimlik panelde gösterilen bir HA bildirimi mi
 * @param {(yol: string, secenek: object) => Promise<unknown>} bag.haIstek
 * @param {{dene: Function}} [bag.hizSiniri]
 * @returns {(istek: {kimlik: string, kaynak: string}) => Promise<{ok: true, sinif: string} | {ok: false, tur: string, neden?: string}>}
 */
function bildirimKapatHattiOlustur({ bildirimKayitliMi, haIstek, hizSiniri = hizSiniriOlustur() }) {
  return async function bildirimKapat(istek) {
    const { kimlik, kaynak } = istek && typeof istek === 'object' ? istek : {};
    if (kaynak !== 'panel') return { ok: false, tur: 'kaynak-izinsiz' };
    const dogrulama = varliksizServisDogrula('persistent_notification', 'dismiss', { notification_id: kimlik });
    if (!dogrulama.ok) return { ok: false, tur: 'gecersiz', neden: dogrulama.neden };
    if (bildirimKayitliMi(kimlik) !== true) return { ok: false, tur: 'bilinmeyen-bildirim' };
    if (!hizSiniri.dene('bildirim-kapat', { sinir: BILDIRIM_ORAN_SINIRI })) return { ok: false, tur: 'cok-sik' };
    try {
      await servisPostla(haIstek, 'persistent_notification', 'dismiss', dogrulama.govde);
    } catch (hata) {
      return hataSonucu(hata, '');
    }
    return { ok: true, sinif: dogrulama.sinif };
  };
}

/** TEK servis çağrısı noktası (REST POST): varlık eylemi ve bildirim kapatma buradan geçer; asla yeniden denenmez (ha-istemcisi.js). */
function servisPostla(haIstek, alan, servis, govde) {
  return haIstek(`/api/services/${alan}/${servis}`, { yontem: 'POST', govde });
}

module.exports = {
  IZINLI_SERVISLER,
  ORAN_SINIRI,
  ORAN_SINIRI_DUGME,
  ORAN_SINIRI_SON,
  BILDIRIM_ORAN_SINIRI,
  BASILI_SURE_MS,
  ONCE_OZNITELIKLERI,
  oncekiGoruntu,
  basiliTutmaDeposu,
  hizSiniriOlustur,
  eylemHattiOlustur,
  bildirimKapatHattiOlustur,
};
