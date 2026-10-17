'use strict';

/**
 * Oda bağlayıcısı (o-14, 1.4.0 eylem grubu; Electron'a bağlı değildir): panelde "Odaya göre grupla" görünümü ve "Odayı kapat" düğmesi.
 *  - Home Assistant'ın alan (oda) kaydı arka planda okunur (haOkuma.alanlar: WS yönetici komutları, 5 dk önbellekli) ve bellekte
 *    tutulur. Okunamıyorsa (yönetici yetkisi yok, HA kapalı) panel tür gruplu kalır; hiçbir şey bozulmaz.
 *  - `gruplar()` panel modelinin gruplarını ayar `panelGruplama: 'oda'` iken oda gruplarına çevirir (src/lib/oda-gruplari.js).
 *  - `kapat()` bir odanın açık, zararsız üyelerini (ışık, priz, vantilatör, sanal anahtar, nem alıcı) kapatır. Üyeleri HER ZAMAN burada
 *    yeniden hesaplanır (renderer yalnız grup kodunu söyler); her kapatma eylem katmanının tek güvenli hattından geçer
 *    (eylem.kayitliCalistir, kaynak 'panel'): Kapı Kuralı, eylem sınıfı, servis izin listesi, hız sınırı, tek POST. Adımlar sessizdir,
 *    sonuç TEK özet bildirimidir; geri al yığınına tek girdi (parti) olarak girer, etkinlik geçmişine her adım 'oda-kapat' işlemiyle yazılır.
 *  - Oda kaydı ve eşleme yalnız bellektedir; diske yazılmaz, dışarı gönderilmez.
 */

const { odaGruplari, odaBul, odaKapatUyeleri, KAPAT_SERVISI } = require('./oda-gruplari');
const { kisalt } = require('./metin');
const { AD_SINIRI } = require('./bildirim-metni');
const { TR } = require('./ceviri-varsayilan');

const ETIKET = 'oda-kapat';
const YENILEME_MS = 5 * 60_000;
const HATA_SONRASI_YENILEME_MS = 30_000;
const EN_COK_ESLEME = 5000;
const EN_COK_ALAN = 200;
const ESZAMANLILIK = 4;

/** Alan verisini küçük, düz bir kopyaya indirger (bozuk ya da çok büyük girdi bellekte tutulmaz). */
function alanVerisiOzeti(ham) {
  const alanlar = [];
  for (const a of Array.isArray(ham?.alanlar) ? ham.alanlar : []) {
    if (alanlar.length >= EN_COK_ALAN) break;
    if (a && typeof a.id === 'string' && typeof a.ad === 'string') alanlar.push({ id: a.id, ad: a.ad });
  }
  const varlikAlanlari = {};
  let sayi = 0;
  if (ham?.varlikAlanlari && typeof ham.varlikAlanlari === 'object') {
    for (const [kimlik, alanId] of Object.entries(ham.varlikAlanlari)) {
      if (sayi >= EN_COK_ESLEME) break;
      if (typeof alanId === 'string') {
        varlikAlanlari[kimlik] = alanId;
        sayi += 1;
      }
    }
  }
  return { alanlar, varlikAlanlari };
}

/**
 * @param {object} bag
 * @param {object} bag.eylem eylem katmanı (src/eylem.js)
 * @param {() => object} bag.ayarlarAl ayarlar (panelGruplama, favoriler)
 * @param {(kimlik: string) => object|null|undefined} bag.durumAl durum deposu okuyucusu
 * @param {() => Promise<object>} bag.alanlarAl haOkuma.alanlar
 * @param {(b: {tur: 'ok'|'hata', metin: string}) => void} [bag.bildir]
 * @param {Function} [bag.t] çevirmen (verilmezse Türkçe)
 * @param {() => void} [bag.degisti] panel modeli yenilensin
 * @param {() => string} [bag.dilAl] oda adlarının sıralama dili
 * @param {() => number} [bag.simdi]
 * @param {(m: string) => void} [bag.gunluk]
 */
function odaBaglayiciOlustur({ eylem, ayarlarAl, durumAl, alanlarAl, bildir = () => {}, t = TR, degisti = () => {}, dilAl = () => 'tr', simdi = () => Date.now(), gunluk = () => {} }) {
  const acikMi = () => ayarlarAl()?.panelGruplama === 'oda';
  let alanVerisi = null;
  let imza = '';
  let sonDenemeZamani = -Infinity;
  let sonrakiDeneme = YENILEME_MS;
  let suren = null;
  let calisiyor = false;
  let sayac = 0;

  /** Alan kaydını okur; değiştiyse paneli yeniletir. Eşzamanlı çağrılar tek okumayı paylaşır; hata modeli bozmaz. */
  function yenile() {
    if (suren) return suren;
    sonDenemeZamani = simdi();
    sonrakiDeneme = HATA_SONRASI_YENILEME_MS;
    suren = (async () => {
      try {
        const ozet = alanVerisiOzeti(await alanlarAl());
        if (ozet.alanlar.length > 0) sonrakiDeneme = YENILEME_MS;
        const yeniImza = JSON.stringify(ozet);
        if (yeniImza !== imza) {
          imza = yeniImza;
          alanVerisi = ozet.alanlar.length > 0 ? ozet : null;
          if (acikMi()) degisti();
        }
      } catch {
        gunluk('Oda kaydı okunamadı.');
      } finally {
        suren = null;
      }
    })();
    return suren;
  }

  return {
    /** Panel modelinin gruplarını (ayar `oda` iken, oda kaydı biliniyorsa) oda gruplarına çevirir; aksi halde aynen döner. Ağa çıkmaz. */
    gruplar(modelGruplari) {
      if (!acikMi()) return modelGruplari;
      if (simdi() - sonDenemeZamani >= sonrakiDeneme) void yenile();
      if (!alanVerisi) return modelGruplari;
      return odaGruplari(modelGruplari, alanVerisi, { dil: dilAl() });
    },
    /** Ayarlar'da panelGruplama değişti: oda kaydı hemen okunur, panel yeniden gruplanır. */
    ayarDegisti() {
      if (acikMi()) void yenile();
      degisti();
    },
    yenile,

    /**
     * Odayı kapatır.
     * @param {{kaynak: string, kod: string}} istek yalnız 'panel' kaynağı; kod `oda-<8 onaltılık>` grup kodu
     * @returns {Promise<{ok: boolean, tur?: string, adet?: number, toplam?: number}>}
     */
    async kapat({ kaynak, kod } = {}) {
      if (kaynak !== 'panel') return { ok: false, tur: 'gecersiz' };
      if (!acikMi()) return { ok: false, tur: 'kapali' };
      const oda = odaBul(kod, alanVerisi);
      if (!oda) return { ok: false, tur: 'gecersiz' };
      if (calisiyor) return { ok: false, tur: 'mesgul' };
      const odaAdi = kisalt(oda.ad, AD_SINIRI);
      const uyeler = odaKapatUyeleri({ favoriler: ayarlarAl()?.favoriler, durumAl, alanVerisi, alanId: oda.id });
      if (uyeler.length === 0) {
        bildir({ tur: 'ok', metin: t('oda.zatenKapali', { oda: odaAdi }) });
        return { ok: true, adet: 0, toplam: 0 };
      }
      sayac += 1;
      const parti = { id: `oda-kapat-${sayac}`, ad: t('oda.partiAdi', { oda: odaAdi }) };
      calisiyor = true;
      let basarili = 0;
      try {
        for (let i = 0; i < uyeler.length; i += ESZAMANLILIK) {
          const sonuclar = await Promise.all(
            uyeler.slice(i, i + ESZAMANLILIK).map((u) =>
              Promise.resolve(eylem.kayitliCalistir({ kimlik: u.kimlik, kaynak: 'panel', kayit: u.kayit, eylem: { servis: KAPAT_SERVISI }, parti, sessiz: true }, ETIKET)).catch(() => ({ ok: false, tur: 'hata' })),
            ),
          );
          basarili += sonuclar.filter((s) => s?.ok === true).length;
        }
      } finally {
        calisiyor = false;
      }
      const toplam = uyeler.length;
      if (basarili === toplam) bildir({ tur: 'ok', metin: t('oda.kapatildi', { oda: odaAdi, n: basarili }) });
      else bildir({ tur: 'hata', metin: t('oda.kismen', { oda: odaAdi, n: basarili, toplam }) });
      degisti(); // geri al düğmesi
      return { ok: basarili > 0, ...(basarili === 0 ? { tur: 'hata' } : {}), adet: basarili, toplam };
    },
  };
}

module.exports = { ETIKET, YENILEME_MS, alanVerisiOzeti, odaBaglayiciOlustur };
