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
 *   5. servis, sabit izin listesinden (alan + eylem)                               -> 'gecersiz'
 *   6. varlık başına hız sınırı (sürükleme/basılı tutma); son değer sınırı aşar    -> 'cok-sik'
 *   7. POST tam BİR kez (asla yeniden denenmez)                                    -> 'ha-hatasi'
 *
 * Kapı/kilit/alarm/garaj/bariyer/gate/lock varlıkları 3. adımda her zaman durur; bu dosya o kuralı gevşetmez.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { FAVORI_ALANLARI, alanAl, adGuvenliMi, guvenliVarlikMi } = require('./suzgec');
const { SINIF, KAYNAKLAR, eylemSinifi, kaynakIzni } = require('./eylem-sinifi');

/** Alan başına çağrılabilecek servisler (sabit izin listesi). İlk eleman varsayılan servistir (FAVORI_ALANLARI ile aynı). */
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
const BASILI_OMUR_MS = 10_000; // başlatılıp unutulan basış sonsuza dek geçerli kalmasın (0,8 sn tutma + istek gecikmesi için bol)

/**
 * Panel/palet'te "basılı tut" onayının ana süreç tarafı. Renderer yalnız "basış başladı" der (yuzey:basili-basla); onay,
 * ana sürecin kendi saatiyle en az ~0,8 sn geçmişse ve yalnız BİR kez geçerlidir. Böylece tek bir IPC çağrısıyla
 * yıkıcı eylem çalıştırılamaz.
 * @param {{simdi?: () => number, sureMs?: number}} [secenek]
 */
function basiliTutmaDeposu({ simdi = () => Date.now(), sureMs = BASILI_SURE_MS } = {}) {
  const basislar = new Map(); // kimlik -> başlangıç zamanı
  return {
    basla(kimlik) {
      if (typeof kimlik !== 'string') return false;
      if (basislar.size >= 32) basislar.clear(); // sınırsız büyümesin
      basislar.set(kimlik, simdi());
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

function parlaklikDuzelt(deger) {
  return Number.isInteger(deger) && deger >= 1 && deger <= 100 ? deger : null;
}

/**
 * Servis ve gövdeyi sabit izin listesinden kurar.
 * @returns {{servis: string, govde: object}|null}
 */
function servisKur(alan, kimlik, favori, eylem) {
  const izinli = IZINLI_SERVISLER[alan];
  if (!izinli) return null;
  const istek = eylem && typeof eylem === 'object' ? eylem : {};
  if (istek.parlaklik !== undefined) {
    const yuzde = parlaklikDuzelt(istek.parlaklik);
    // Yalnız "parlaklık kontrollü" ışık favorisinde; başka alanda ya da kontrolü kapalı ışıkta REDDEDİLİR.
    if (yuzde === null || alan !== 'light' || favori.parlaklik !== true) return null;
    return { servis: 'turn_on', govde: { entity_id: kimlik, brightness_pct: yuzde } };
  }
  const servis = istek.servis === undefined ? FAVORI_ALANLARI[alan].servis : istek.servis;
  if (typeof servis !== 'string' || !izinli.includes(servis)) return null;
  return { servis, govde: { entity_id: kimlik } };
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
   * @param {{kimlik: string, kaynak: string, onay?: 'diyalog'|'basili', eylem?: {parlaklik?: number, servis?: string}, sonDeger?: boolean}} istek
   *   onay: YALNIZ ana sürecin kendi koduyla verilir ('diyalog': onay penceresi yanıtlandı; 'basili': basılı tutma isteği).
   * @returns {Promise<{ok: true, ad: string, alan: string, servis: string, sinif: string, onceki: string, yeni?: string, parlaklik?: number}
   *   | {ok: false, tur: string, neden?: string, ad?: string}>}
   *   tur: 'gecersiz' | 'bilinmeyen-favori' | 'yasak' | 'ulasilamiyor' | 'bulunamadi' | 'kaynak-izinsiz' | 'onay-gerekli' | 'cok-sik' | 'ha-hatasi'
   */
  return async function calistir(istek) {
    const { kimlik, kaynak, onay, eylem, sonDeger } = istek && typeof istek === 'object' ? istek : {};
    // 1. biçim
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return { ok: false, tur: 'gecersiz' };
    if (!KAYNAKLAR.includes(kaynak)) return { ok: false, tur: 'gecersiz' };
    if (onay !== undefined && onay !== 'diyalog' && onay !== 'basili') return { ok: false, tur: 'gecersiz' };
    if (eylem !== undefined && (eylem === null || typeof eylem !== 'object' || Array.isArray(eylem))) return { ok: false, tur: 'gecersiz' };

    // 2. favori listesinde olmalı
    const favori = favoriAl(kimlik);
    if (!favori || typeof favori !== 'object' || favori.entity_id !== kimlik) return { ok: false, tur: 'bilinmeyen-favori' };

    // 3. güvenlik: önce kayıtlı adla (ağsız), sonra HA'daki güncel durumla
    const alan = alanAl(kimlik);
    if (!Object.hasOwn(FAVORI_ALANLARI, alan)) return { ok: false, tur: 'yasak' };
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
    const siniflama = eylemSinifi(varlik, favori);
    const izin = kaynakIzni(siniflama.sinif, kaynak);
    if (!izin.izin) return { ok: false, tur: 'kaynak-izinsiz', ad };
    if (izin.onayTuru) {
      const onayli = izin.onayTuru === 'diyalog' ? onay === 'diyalog' : onay === 'basili' && basiliOnayi(kimlik) === true;
      if (!onayli) return { ok: false, tur: 'onay-gerekli', ad };
    }

    // 5. servis (sabit izin listesi)
    const kurulan = servisKur(alan, kimlik, favori, eylem);
    if (!kurulan) return { ok: false, tur: 'gecersiz', ad };

    // 6. hız sınırı
    const sinir = alan === 'button' || alan === 'input_button' ? ORAN_SINIRI_DUGME : ORAN_SINIRI;
    if (!hizSiniri.dene(kimlik, { sinir, sonDeger: sonDeger === true })) return { ok: false, tur: 'cok-sik', ad };

    // 7. POST tam bir kez
    let yanit;
    try {
      yanit = await haIstek(`/api/services/${alan}/${kurulan.servis}`, { yontem: 'POST', govde: kurulan.govde });
    } catch (hata) {
      return hataSonucu(hata, ad);
    }
    const yeni = Array.isArray(yanit) ? yanit.find((d) => d?.entity_id === kimlik)?.state : undefined;
    const sonuc = { ok: true, ad, alan, servis: kurulan.servis, sinif: siniflama.sinif === SINIF.YIKICI ? 'yikici' : 'zararsiz', onceki: varlik.state };
    if (typeof yeni === 'string') sonuc.yeni = yeni;
    if (kurulan.govde.brightness_pct !== undefined) sonuc.parlaklik = kurulan.govde.brightness_pct;
    return sonuc;
  };
}

module.exports = {
  IZINLI_SERVISLER,
  ORAN_SINIRI,
  ORAN_SINIRI_DUGME,
  ORAN_SINIRI_SON,
  BASILI_SURE_MS,
  basiliTutmaDeposu,
  hizSiniriOlustur,
  eylemHattiOlustur,
};
