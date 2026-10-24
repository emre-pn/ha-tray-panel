'use strict';

/**
 * Geri al bağlayıcısı (o-12, 1.4.0 eylem grubu; Electron'a bağlı değildir). src/lib/geri-al.js'in saf planını eylem katmanına bağlar:
 *  - eylem sonuçlarını izler (eylem.sonucDinle) ve geri alınabilir olanları en çok 5 girdilik, süre sınırlı yığına yazar;
 *  - sahne çalışmadan ÖNCE üyelerinin durumunu okur (eylem.hazirlikEkle; 1,5 sn bütçe);
 *  - "geri al" istenince girdinin adımlarını eylem.kayitliCalistir ile, AYNI tek güvenli hattan (Kapı Kuralı, eylem sınıfı + yüzey
 *    izni, servis izin listesi, hız sınırı, tek POST) çalıştırır; kapı/kilit/alarm/siren/kepenk bu yoldan da asla çalışmaz;
 *  - süre dolunca yığını boşaltır ve panelin modelinin yenilenmesini ister (degisti).
 * Geri alma kendisi yığına girmez. Eylem sonuçları dışında hiçbir şey saklanmaz; HA'ya adres/anahtar gitmez.
 */

const { alanAl, guvenliVarlikMi } = require('./suzgec');
const { kisalt } = require('./metin');
const { cogul } = require('./dil');
const { AD_SINIRI } = require('./bildirim-metni');
const { TR } = require('./ceviri-varsayilan');
const { KAYNAKLAR, SAHNE_UYE_ALANLARI, EN_COK_SAHNE_UYESI, parlaklikYuzdesi, geriAlmaPlani, geriAlYiginiOlustur } = require('./geri-al');

const ETIKET = 'geri-al';
const SAHNE_HAZIRLIGI = 'geri-al-sahne';
const SAHNE_UYE_OKUMA_SINIRI = 40; // sahne öznitelik listesinden bakılacak en çok üye (kalanı atılır)
const YENIDEN_DENENEBILIR = new Set(['ulasilamiyor', 'ha-hatasi', 'cok-sik']); // geçici nedenler: girdi yığına geri konur

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => {
      const id = globalThis.setTimeout(fn, ms);
      if (typeof id?.unref === 'function') id.unref(); // süre dolum zamanlayıcısı süreç çıkışını geciktirmesin
      return id;
    },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} bag
 * @param {object} bag.eylem eylem katmanı (src/eylem.js)
 * @param {() => object} bag.ayarlarAl ayarlar (geriAl, geriAlSureDk, favoriler)
 * @param {(b: {tur: 'ok'|'hata', metin: string}) => void} [bag.bildir] kullanıcı geri bildirimi (tek özet)
 * @param {Function} [bag.t] çevirmen (verilmezse Türkçe)
 * @param {() => void} [bag.degisti] yığının özeti değişti (panel modeli / tepsi menüsü yenilensin)
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {(m: string) => void} [bag.gunluk]
 */
function geriAlBaglayiciOlustur({ eylem, ayarlarAl, bildir = () => {}, t = TR, degisti = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman(), gunluk = () => {} }) {
  const acikMi = () => ayarlarAl()?.geriAl !== false;
  const yigin = geriAlYiginiOlustur({ simdi, sureAl: () => (Number(ayarlarAl()?.geriAlSureDk) || 10) * 60_000 });
  let zamanlayici = null;
  let calisiyor = false;

  function zamanlayiciKur() {
    if (zamanlayici !== null) {
      zaman.clearTimeout(zamanlayici);
      zamanlayici = null;
    }
    const bitis = yigin.enYakinBitis(); // süresi dolanları da ayıklar
    if (bitis === null) return;
    zamanlayici = zaman.setTimeout(() => {
      zamanlayici = null;
      yigin.sayi(); // süresi dolanlar ayıklanır
      zamanlayiciKur();
      degisti();
    }, Math.max(1, bitis - simdi()) + 50);
  }

  /**
   * Sahnenin üyelerinin ŞİMDİKİ (sahne çalışmadan önceki) durumu; okunamayan, güvensiz ya da açık/kapalı olmayan üye atlanır.
   * İzlenmeyen üyeler her basışta REST ile okunur ve kimlikli kapı aynı anda tek işleme izin verir: okumalar SIRAYLA ve 'normal' öncelikle
   * yapılır (hattın kendi okuması ile sahne POST'u 'yuksek' olarak önlerine geçer). Bekleme bütçesi dolunca (sinyal.iptalMi) yeni okuma başlamaz.
   * @returns {Promise<object[]|undefined>} bütçe dolduysa undefined (geri al kaydı oluşmaz)
   */
  async function sahneUyeleriniOku(kimlik, sinyal) {
    const iptalMi = () => sinyal?.iptalMi?.() === true;
    const sahne = await eylem.guncelDurum(kimlik);
    const liste = Array.isArray(sahne?.attributes?.entity_id) ? sahne.attributes.entity_id : [];
    const adaylar = liste
      .slice(0, SAHNE_UYE_OKUMA_SINIRI)
      .filter((k) => typeof k === 'string' && SAHNE_UYE_ALANLARI.includes(alanAl(k)))
      .slice(0, EN_COK_SAHNE_UYESI);
    const durumlar = [];
    for (const k of adaylar) {
      if (iptalMi()) return undefined;
      durumlar.push(await Promise.resolve(eylem.guncelDurum(k, { oncelik: 'normal' })).catch(() => null));
    }
    if (iptalMi()) return undefined;
    const uyeler = [];
    for (const v of durumlar) {
      if (!v || typeof v !== 'object' || !guvenliVarlikMi(v) || (v.state !== 'on' && v.state !== 'off')) continue;
      const ad = typeof v.attributes?.friendly_name === 'string' && v.attributes.friendly_name.trim() ? v.attributes.friendly_name.trim() : v.entity_id;
      const uye = { kimlik: v.entity_id, ad: kisalt(ad, AD_SINIRI), durum: v.state };
      if (v.state === 'on' && alanAl(v.entity_id) === 'light') {
        const yuzde = parlaklikYuzdesi(v.attributes?.brightness);
        if (yuzde !== null) uye.parlaklik = yuzde;
      }
      uyeler.push(uye);
    }
    return uyeler;
  }

  const hazirligiKaldir = eylem.hazirlikEkle(SAHNE_HAZIRLIGI, (istek, ic, sinyal) => {
    if (!acikMi() || typeof istek?.kimlik !== 'string' || alanAl(istek.kimlik) !== 'scene') return undefined;
    if (!KAYNAKLAR.includes(istek.kaynak) || ic?.islem === ETIKET) return undefined;
    return sahneUyeleriniOku(istek.kimlik, sinyal);
  });

  const izleyiciyiKaldir = eylem.sonucDinle((bilgi) => {
    try {
      gozle(bilgi);
    } catch {
      gunluk('Geri alma kaydı tutulamadı.');
    }
  });

  function gozle({ istek, sonuc, hazirlik }) {
    if (!acikMi() || !istek || !sonuc || sonuc.ok !== true) return;
    if (istek.islem === ETIKET || !KAYNAKLAR.includes(istek.kaynak)) return; // geri alma kendisi ve gecikmeli eylem yığına girmez
    const plan = geriAlmaPlani({
      kimlik: istek.kimlik,
      ad: sonuc.ad,
      istek: { servis: istek.servis, veri: istek.veri, parlaklik: istek.parlaklik },
      sonuc,
      sahneUyeleri: hazirlik?.[SAHNE_HAZIRLIGI],
    });
    if (!plan) return;
    if (yigin.ekle({ kimlik: istek.kimlik, ad: sonuc.ad, plan, kaynak: istek.kaynak, parti: istek.parti })) {
      zamanlayiciKur();
      degisti();
    }
  }

  /**
   * Adımın kaydı: favori ise ayardaki kayıt (onay, kısayol... kendi ayarlarıyla; sahne üyesi adımda yalnız parlaklık geri yüklenebilsin diye
   * `parlaklik` açılır, `onay` DEĞİŞMEZ: onaylı favori geri almayla onaysız çalıştırılamaz), değilse tek seferlik kayıt. Kapı Kuralı hatta yine uygulanır.
   */
  function kayitBul(adim) {
    const favori = (ayarlarAl()?.favoriler ?? []).find((f) => f.entity_id === adim.kimlik);
    if (favori) return adim.uye === true ? { ...favori, parlaklik: true } : favori;
    return { entity_id: adim.kimlik, ad: adim.ad, parlaklik: true };
  }

  /**
   * En yeni girdiyi geri alır. Girdi önce yığından çıkar (çift basış iki kez geri almaz); hiçbir adım uygulanamadıysa ve neden geçiciyse
   * (HA'ya ulaşılamadı, hız sınırı) süresi dolmadıkça yığına geri konur.
   * @param {'panel'|'palet'|'tepsi-menu'|'kisayol'} kaynak geri almayı isteyen yüzey
   * @returns {Promise<{ok: boolean, tur?: string, adim?: number, basarisiz?: number}>}
   */
  async function geriAl(kaynak) {
    if (!acikMi()) return { ok: false, tur: 'kapali' };
    if (!KAYNAKLAR.includes(kaynak)) return { ok: false, tur: 'gecersiz' };
    if (calisiyor) return { ok: false, tur: 'mesgul' };
    const girdi = yigin.son();
    if (!girdi) {
      bildir({ tur: 'ok', metin: t('geriAl.bos') });
      return { ok: false, tur: 'bos' };
    }
    calisiyor = true;
    yigin.cikar(girdi.id);
    zamanlayiciKur();
    degisti();
    let basarili = 0;
    let basarisiz = 0;
    let ilkHata = null;
    try {
      for (const adim of girdi.adimlar) {
        let sonuc;
        try {
          sonuc = await eylem.kayitliCalistir({ kimlik: adim.kimlik, kaynak, kayit: kayitBul(adim), eylem: adim.eylem, sonDeger: true, sessiz: true }, ETIKET);
        } catch {
          sonuc = { ok: false, tur: 'hata' };
        }
        if (sonuc?.ok) basarili += 1;
        else {
          basarisiz += 1;
          ilkHata ??= sonuc?.tur ?? 'hata';
        }
      }
    } finally {
      calisiyor = false;
    }
    const ad = kisalt(girdi.ad, AD_SINIRI);
    if (basarisiz === 0) {
      bildir({ tur: 'ok', metin: t('geriAl.tamam', { ad }) });
      return { ok: true, adim: basarili };
    }
    if (basarili === 0) {
      if (YENIDEN_DENENEBILIR.has(ilkHata)) {
        yigin.geriKoy(girdi);
        zamanlayiciKur();
        degisti();
      }
      bildir({ tur: 'hata', metin: t('geriAl.olmadi', { ad }) });
      return { ok: false, tur: ilkHata, basarisiz };
    }
    bildir({ tur: 'hata', metin: cogul(t, 'geriAl.kismi', basarisiz, { ad }) });
    return { ok: false, tur: 'kismi', adim: basarili, basarisiz };
  }

  return {
    geriAl,
    /** Panel/tepsi için özet: { adet, ad, bitis } ya da null (kapalı / geri alınacak bir şey yok). Ad kısa, düz metindir. */
    ozet() {
      if (!acikMi()) return null;
      const o = yigin.ozet();
      return o ? { adet: o.adet, ad: kisalt(o.ad, AD_SINIRI), bitis: o.bitis } : null;
    },
    /** Ayar değişti (geriAl kapandı, süre değişti): kapandıysa yığın boşalır; süre değiştiyse zamanlayıcı yeniden kurulur. */
    ayarDegisti() {
      if (!acikMi()) yigin.temizle();
      zamanlayiciKur();
      degisti();
    },
    temizle() {
      yigin.temizle();
      zamanlayiciKur();
      degisti();
    },
    sayi: () => yigin.sayi(),
    kapat() {
      hazirligiKaldir();
      izleyiciyiKaldir();
      if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
      zamanlayici = null;
      yigin.temizle();
    },
  };
}

module.exports = { ETIKET, SAHNE_HAZIRLIGI, geriAlBaglayiciOlustur };
