'use strict';

/**
 * Palette favori dışı cihazlar (o-46, 1.4.0 eylem grubu; Electron'a bağlı değildir): "*" ile başlayan sorgu favori OLMAYAN ama güvenli ışık,
 * priz, vantilatör, sanal anahtar, nem alıcı ve sahneleri arar (src/lib/arama.js digerSorgusu). Shift+Enter satırı "Aç / Kapat / Favoriye ekle /
 * HA'da aç" menüsünü açar. Bu dosya ana süreç tarafıdır: liste, doğrulama, çalıştırma ve favoriye ekleme.
 *
 *  - KAPALI başlar (ayar `paletDigerCihazlar`): KILAVUZ'daki "palette yalnız kayıtlı favoriler aranır" kararını gevşettiği için kullanıcı açıkça açar.
 *    Kapalıyken HA'ya hiçbir istek gitmez, hiçbir liste tutulmaz.
 *  - Liste tek bir OKUMA isteğiyle (GET /api/states; yazma yok, korumalı haIstek yolu: yetki kesici, kimlikli kapı) alınır, 2 dakika bellekte
 *    tutulur, diske yazılmaz, dışarı gönderilmez. Palet açılıp "*" yazılınca ve önbellek bayatsa yenilenir.
 *  - Süzgeç: Kapı Kuralı (suzgec.js guvenliVarlikMi; kilit, alarm, kapı, garaj, kepenk... ad, sınıf ve sahne üyeleri dahil), yalnız ALANLAR,
 *    favori olmayan, ulaşılabilir ve eylem sınıfı ZARARSIZ olanlar. Script, düğme, otomasyon, vana, kamera, perde/kepenk (cover), klima ve
 *    medya bu listeye HİÇ girmez; script ve düğme varsayılan onaylı (yıkıcı sınıf) olduğundan, "kapat/yeniden başlat" ipuçlu ya da açık listedeki
 *    (ör. oyun bilgisayarı) varlık da elenir.
 *  - Çalıştırma kimlik + işlem ('ac' | 'kapat' | 'degistir') ile istenir; kimlik şu an listede olmalıdır (renderer serbest kimlikle eylem
 *    başlatamaz). Eylem eylem.kayitliCalistir ile AYNI güvenli hattan geçer (Kapı Kuralı HA'daki güncel durumla yeniden, eylem sınıfı + yüzey
 *    izni, servis izin listesi, hız sınırı, tek POST); kaynak yalnız 'palet'. Servisler: aç = turn_on, kapat = turn_off, değiştir = toggle
 *    (sahne için yalnız turn_on).
 *  - Favoriye ekle: kayıt favoriOlustur ile kurulur ve ana sürecin `favoriEkle` işleviyle (ayar dosyası, izlenenler, açık Ayarlar haberdar) yazılır.
 *  - Oda adı (varsa): HA alan kaydı en iyi çabayla okunur (haOkuma.alanlar); okunamazsa (yönetici yetkisi yok) oda adı olmadan sürer.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { odalariCikar } = require('./oda-gruplari');
const { EN_COK_FAVORI, favorileriDuzelt, onayiDuzelt } = require('./favoriler');

const ETIKET = 'cihaz';
const KAYNAKLAR = Object.freeze(['palet']);
const ALANLAR = Object.freeze(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'scene']);
const ISLEMLER = Object.freeze({ ac: 'turn_on', kapat: 'turn_off', degistir: 'toggle' });
const EN_COK_CIHAZ = 400;
const ONBELLEK_MS = 2 * 60_000;
const AD_SINIRI = 60;
const KONTROL_KARAKTERI = /[\u0000-\u001f\u007f-\u009f]/;
const BILINEN_HATALAR = new Set(['gecersiz', 'kapali', 'bulunamadi', 'yasak', 'kaynak-izinsiz', 'onay-gerekli', 'cok-sik', 'ulasilamiyor', 'ha-hatasi', 'hata', 'bilinmeyen-favori', 'dolu', 'zaten-var', 'yazilamadi']);

/** Sonuç türü yalnız bilinen kısa kodlardan biri olur (ham hata metni renderer'a gitmez). */
const temizTur = (tur) => (typeof tur === 'string' && BILINEN_HATALAR.has(tur) ? tur : 'hata');

/**
 * Favori listesine tek bir cihaz ekler (saf; girdiyi değiştirmez): ayar şemasındaki aynı süzgeçten (favorileriDuzelt: geçerli kimlik, karo
 * alanı, yasak alanlar, Kapı Kuralı adı) geçer, tekrar ve üst sınır denetlenir. Ana süreç sonucu ayara yazar (main.js favoriEkle).
 * @returns {{ok: true, favoriler: object[]} | {ok: false, tur: 'zaten-var'|'dolu'|'yasak'}}
 */
function favoriListesineEkle(favoriler, { kimlik, ad } = {}) {
  const mevcut = Array.isArray(favoriler) ? favoriler : [];
  if (mevcut.some((f) => f?.entity_id === kimlik)) return { ok: false, tur: 'zaten-var' };
  if (mevcut.length >= EN_COK_FAVORI) return { ok: false, tur: 'dolu' };
  // Bu yoldan yalnız listedeki alanlar favori olur (perde/cover, vana, otomasyon, kamera gibi daha geniş favori alanları Ayarlar'dan eklenir).
  if (typeof kimlik !== 'string' || !ALANLAR.includes(alanAl(kimlik))) return { ok: false, tur: 'yasak' };
  const duzelen = favorileriDuzelt([{ entity_id: kimlik, ad }]).favoriler;
  if (duzelen.length !== 1) return { ok: false, tur: 'yasak' };
  return { ok: true, favoriler: onayiDuzelt([...mevcut, duzelen[0]]) };
}

/**
 * @param {object} bag
 * @param {object} bag.eylem eylem katmanı (src/eylem.js): kayitliCalistir
 * @param {() => object} bag.ayarlarAl ayarlar (paletDigerCihazlar, favoriler)
 * @param {(yol: string) => Promise<unknown>} bag.haIstek korumalı HA okuma yolu (yalnız GET /api/states kullanılır)
 * @param {(kayit: {kimlik: string, ad: string, alan: string}) => {ok: boolean, tur?: string}|Promise<{ok: boolean, tur?: string}>} [bag.favoriEkle]
 *   ana sürecin favori ekleme işlevi (yoksa "favoriye ekle" 'kapali' döner)
 * @param {() => Promise<{alanlar?: object[], varlikAlanlari?: object}>} [bag.alanlarAl] HA alan kaydı (isteğe bağlı; oda adı için)
 * @param {() => number} [bag.simdi]
 * @param {(m: string) => void} [bag.gunluk]
 */
function digerCihazlarOlustur({ eylem, ayarlarAl, haIstek, favoriEkle = null, alanlarAl = null, simdi = () => Date.now(), gunluk = () => {} }) {
  const acik = () => ayarlarAl()?.paletDigerCihazlar === true;
  const favoriMi = (kimlik) => (ayarlarAl()?.favoriler ?? []).some((f) => f?.entity_id === kimlik);
  /** @type {{zaman: number, liste: object[]}|null} */
  let onbellek = null;
  let suren = null;
  let nesil = 0; // ayar kapanınca süren okumanın sonucu yoksayılsın

  /** Oda adları (en iyi çaba): kimlik -> oda adı. Okunamazsa boş. */
  async function odaAdlari() {
    if (typeof alanlarAl !== 'function') return new Map();
    try {
      const veri = await alanlarAl();
      const odalar = odalariCikar(veri);
      const esleme = veri?.varlikAlanlari && typeof veri.varlikAlanlari === 'object' ? veri.varlikAlanlari : {};
      const sonuc = new Map();
      for (const [kimlik, alanId] of Object.entries(esleme)) {
        const oda = typeof alanId === 'string' ? odalar.get(alanId) : undefined;
        if (oda) sonuc.set(kimlik, oda.ad);
      }
      return sonuc;
    } catch {
      return new Map();
    }
  }

  /** HA'daki durum listesinden aday cihazlar (saf süzgeç; ağ dışında). */
  function adaylariSuz(durumlar, odalar) {
    const liste = [];
    for (const v of Array.isArray(durumlar) ? durumlar : []) {
      if (liste.length >= EN_COK_CIHAZ) break;
      const kimlik = v?.entity_id;
      if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) continue;
      const alan = alanAl(kimlik);
      if (!ALANLAR.includes(alan)) continue;
      if (typeof v.state !== 'string' || v.state === 'unavailable') continue;
      if (!guvenliVarlikMi(v)) continue;
      const ham = v.attributes?.friendly_name;
      if (typeof ham === 'string' && KONTROL_KARAKTERI.test(ham)) continue; // kontrol karakterli ad listelenmez
      const ad = guvenliMetin(typeof ham === 'string' && ham.trim() ? ham.trim() : '', AD_SINIRI);
      if (!ad) continue; // adı olmayan ya da süzgeçten geçmeyen varlık listelenmez (kimlik adı gibi gösterilmez)
      if (eylemSinifi(v, { entity_id: kimlik, ad }).sinif !== SINIF.ZARARSIZ) continue;
      const giris = { kimlik, ad, alan, durum: v.state === 'on' ? 'acik' : v.state === 'off' ? 'kapali' : 'notr' };
      const oda = odalar.get(kimlik);
      if (oda) giris.oda = oda;
      liste.push(giris);
    }
    return liste.sort((a, b) => a.ad.localeCompare(b.ad, 'tr', { sensitivity: 'base', numeric: true }) || (a.kimlik < b.kimlik ? -1 : 1));
  }

  function yukle() {
    if (onbellek && simdi() - onbellek.zaman < ONBELLEK_MS) return Promise.resolve(onbellek.liste);
    if (suren) return suren;
    const benimNesil = nesil;
    suren = (async () => {
      try {
        const [durumlar, odalar] = await Promise.all([haIstek('/api/states'), odaAdlari()]);
        const liste = adaylariSuz(durumlar, odalar);
        if (benimNesil === nesil) onbellek = { zaman: simdi(), liste };
        return liste;
      } finally {
        suren = null;
      }
    })();
    return suren;
  }

  async function girisBul(kimlik) {
    const liste = await yukle();
    return liste.find((d) => d.kimlik === kimlik && !favoriMi(kimlik));
  }

  const gecerliKimlik = (kimlik) => typeof kimlik === 'string' && kimlik.length <= 120 && VARLIK_KIMLIGI_DESENI.test(kimlik);

  return {
    /**
     * Palet "*" listesi. @returns {Promise<{ok: true, liste: {kimlik: string, ad: string, alan: string, durum: 'acik'|'kapali'|'notr', oda?: string}[]}|{ok: false, tur: string}>}
     */
    async liste({ kaynak } = {}) {
      if (!KAYNAKLAR.includes(kaynak)) return { ok: false, tur: 'gecersiz' };
      if (!acik()) return { ok: false, tur: 'kapali' };
      try {
        const liste = await yukle();
        return { ok: true, liste: liste.filter((d) => !favoriMi(d.kimlik)).map((d) => ({ ...d })) };
      } catch {
        gunluk('Favori dışı cihaz listesi alınamadı.');
        return { ok: false, tur: 'hata' };
      }
    },

    /**
     * Listedeki bir cihaza işlem uygular.
     * @param {{kaynak: string, kimlik: string, islem: 'ac'|'kapat'|'degistir'}} istek
     * @returns {Promise<{ok: boolean, tur?: string}>}
     */
    async calistir({ kaynak, kimlik, islem } = {}) {
      if (!KAYNAKLAR.includes(kaynak) || !gecerliKimlik(kimlik) || typeof islem !== 'string' || !Object.hasOwn(ISLEMLER, islem)) return { ok: false, tur: 'gecersiz' };
      if (!acik()) return { ok: false, tur: 'kapali' };
      let giris;
      try {
        giris = await girisBul(kimlik);
      } catch {
        return { ok: false, tur: 'hata' };
      }
      if (!giris) return { ok: false, tur: 'bulunamadi' };
      if (giris.alan === 'scene' && islem === 'kapat') return { ok: false, tur: 'gecersiz' };
      const servis = giris.alan === 'scene' ? 'turn_on' : ISLEMLER[islem];
      let sonuc;
      try {
        sonuc = await eylem.kayitliCalistir({ kimlik, kaynak, kayit: { entity_id: kimlik, ad: giris.ad }, eylem: { servis } }, ETIKET);
      } catch {
        return { ok: false, tur: 'hata' };
      }
      if (sonuc?.ok === true) {
        onbellek = null; // durum değişti: sonraki listede güncel durum görünsün
        return { ok: true };
      }
      return { ok: false, tur: temizTur(sonuc?.tur) };
    },

    /**
     * Kimlik şu an "diğer cihazlar" listesinde mi (ayar açık, favori değil, süzgeçten geçmiş)? Gecikmeli eylem favori dışı kimliği yalnız böyle kabul eder.
     * @returns {Promise<boolean>}
     */
    async listedeMi(kimlik) {
      if (!acik() || !gecerliKimlik(kimlik)) return false;
      try {
        return (await girisBul(kimlik)) !== undefined;
      } catch {
        return false;
      }
    },

    /** Listedeki bir cihazı favorilere ekler. @returns {Promise<{ok: boolean, tur?: string}>} */
    async favoriyeEkle({ kaynak, kimlik } = {}) {
      if (!KAYNAKLAR.includes(kaynak) || !gecerliKimlik(kimlik)) return { ok: false, tur: 'gecersiz' };
      if (!acik() || typeof favoriEkle !== 'function') return { ok: false, tur: 'kapali' };
      let giris;
      try {
        giris = await girisBul(kimlik);
      } catch {
        return { ok: false, tur: 'hata' };
      }
      if (!giris) return { ok: false, tur: 'bulunamadi' };
      let sonuc;
      try {
        sonuc = await favoriEkle({ kimlik: giris.kimlik, ad: giris.ad, alan: giris.alan });
      } catch {
        return { ok: false, tur: 'hata' };
      }
      if (sonuc?.ok === true) {
        onbellek = null;
        return { ok: true };
      }
      return { ok: false, tur: temizTur(sonuc?.tur) };
    },

    /** Ayar değişti: kapandıysa liste silinir ve süren okuma yoksayılır. */
    ayarDegisti() {
      if (!acik()) {
        nesil += 1;
        onbellek = null;
      }
    },
    /** Çıkış: bellek boşaltılır. */
    kapat() {
      nesil += 1;
      onbellek = null;
    },
    /** Önbellekteki cihaz sayısı (test ve tanılama). */
    sayi: () => (onbellek ? onbellek.liste.length : 0),
  };
}

module.exports = { ETIKET, KAYNAKLAR, ALANLAR, ISLEMLER, EN_COK_CIHAZ, ONBELLEK_MS, favoriListesineEkle, digerCihazlarOlustur };
