'use strict';

/**
 * Varlık durumu deposu (saf; Electron'a bağlı değildir) — hiz-03.
 * Tek kaynak: canlı bağlantı (WebSocket) ve REST yedeği AYNI depoya yazar; tepsi menüsü, panel ve palet buradan okur.
 * Değişimler 50 ms'de gruplanıp bildirilir (art arda gelen olaylar arayüzü yormasın).
 *
 *  al(kimlik)  -> durum nesnesi | null (HA'da yok) | undefined (henüz bilinmiyor)
 *  guncelle    -> `last_updated` karşılaştırmalıdır: eski bir olay/anlık görüntü yeniyi ezmez.
 */

const GRUPLAMA_MS = 50;

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/** HA'nın ISO zamanı (mikrosaniyeli olabilir) -> ms; çözülemezse NaN. */
function zamanMs(metin) {
  return typeof metin === 'string' ? Date.parse(metin) : NaN;
}

/** Gelen durum, mevcut kayıttan eski değilse uygulanır (zaman bilgisi yoksa uygulanır). */
function yeniMi(mevcut, gelen) {
  if (!mevcut) return true;
  const a = zamanMs(mevcut.last_updated);
  const b = zamanMs(gelen.last_updated);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return b >= a;
}

/** @param {{gruplamaMs?: number, zaman?: {setTimeout: Function, clearTimeout: Function}}} [secenek] */
function durumDeposuOlustur({ gruplamaMs = GRUPLAMA_MS, zaman = varsayilanZaman() } = {}) {
  const harita = new Map();
  const dinleyiciler = new Set();
  let bekleyenler = new Set();
  let zamanlayici = null;
  let sonHata = null;

  function bildir() {
    zamanlayici = null;
    const degisenler = [...bekleyenler];
    bekleyenler = new Set();
    if (degisenler.length === 0) return;
    for (const dinleyici of [...dinleyiciler]) {
      try {
        dinleyici(degisenler);
      } catch {
        /* bir dinleyicinin hatası diğerlerini etkilemesin */
      }
    }
  }

  function isaretle(kimlik) {
    bekleyenler.add(kimlik);
    if (zamanlayici === null) zamanlayici = zaman.setTimeout(bildir, gruplamaMs);
  }

  const depo = {
    al: (kimlik) => harita.get(kimlik),
    var: (kimlik) => harita.get(kimlik) !== undefined && harita.get(kimlik) !== null,
    kimlikler: () => [...harita.keys()],
    /** @returns {boolean} uygulandı mı (eski olay atlanır) */
    guncelle(varlik) {
      if (!varlik || typeof varlik.entity_id !== 'string') return false;
      if (!yeniMi(harita.get(varlik.entity_id), varlik)) return false;
      harita.set(varlik.entity_id, varlik);
      isaretle(varlik.entity_id);
      return true;
    },
    /** Varlık HA'da yok (kaldırıldı ya da hiç olmadı): null saklanır. */
    yokIsaretle(kimlik) {
      if (harita.get(kimlik) === null) return;
      harita.set(kimlik, null);
      isaretle(kimlik);
    },
    /**
     * Anlık görüntü: `varliklar` uygulanır; `izlenen` içinde olup görüntüde bulunmayan BİLİNMEYEN kimlikler "yok" işaretlenir
     * (REST eksikliği geçici olabilir: bilinen durum korunur).
     * h-18 (1.2.0): `tamListe` (canlı bağlantının get_states yanıtındaki TÜM kimlikler) verilirse, o listede HİÇ bulunmayan izlenen
     * kimlikler daha önce bilinse de "yok" işaretlenir: HA'dan silinen cihaz panelde eski durumuyla kalmaz.
     * @param {Set<string>|null} [secenek.tamListe]
     */
    toplu(varliklar, izlenen = [], { tamListe = null } = {}) {
      const gorulen = new Set();
      for (const v of varliklar) {
        gorulen.add(v.entity_id);
        depo.guncelle(v);
      }
      for (const kimlik of izlenen) {
        if (gorulen.has(kimlik)) continue;
        if (harita.get(kimlik) === undefined || (tamListe instanceof Set && !tamListe.has(kimlik))) depo.yokIsaretle(kimlik);
      }
    },
    /** Artık izlenmeyen kimlikleri siler. */
    buda(izlenen) {
      const kume = izlenen instanceof Set ? izlenen : new Set(izlenen);
      for (const kimlik of [...harita.keys()]) {
        if (!kume.has(kimlik)) {
          harita.delete(kimlik);
          isaretle(kimlik);
        }
      }
    },
    sifirla() {
      const eskiler = [...harita.keys()];
      harita.clear();
      sonHata = null;
      for (const kimlik of eskiler) isaretle(kimlik);
    },
    /** Dinleyici: (degisenKimlikler: string[]) => void; abonelikten çıkış işlevi döner. */
    dinle(dinleyici) {
      dinleyiciler.add(dinleyici);
      return () => dinleyiciler.delete(dinleyici);
    },
    /** Bekleyen toplu bildirimi hemen yapar (test ve kapanış için). */
    bosalt() {
      if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
      bildir();
    },
    get sonHata() {
      return sonHata;
    },
    set sonHata(hata) {
      sonHata = hata ?? null;
    },
  };
  return depo;
}

/** Parlaklık (0-255) -> yüzde (0-100), en yakın tam sayıya yuvarlanır. */
function yuzdeCevir(parlaklik) {
  if (typeof parlaklik !== 'number' || !Number.isFinite(parlaklik)) return null;
  return Math.max(0, Math.min(100, Math.round((parlaklik / 255) * 100)));
}

const ACIK_KAPALI_ALANLARI = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'binary_sensor']);
// 1.4.0: on/off dışında durum metni olan alanlar: hangi durum "açık" (vurgulu), hangisi "kapalı" sayılır. Listede olmayan durum 'notr'.
const DURUM_TABLOSU = Object.freeze({
  climate: { acik: ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'], kapali: ['off'] },
  media_player: { acik: ['playing', 'paused', 'on', 'idle', 'buffering'], kapali: ['off', 'standby'] },
  vacuum: { acik: ['cleaning', 'returning'], kapali: ['docked', 'idle', 'paused'] },
  timer: { acik: ['active'], kapali: ['idle'] },
  // 1.4.0 cihaz grubu: perde/jaluzi ve vana "açık" (açık ya da açılıyor), "kapalı" (kapalı); kapanıyor geçiştir (nötr). Otomasyon etkin/devre dışı.
  cover: { acik: ['open', 'opening'], kapali: ['closed'] },
  valve: { acik: ['open', 'opening'], kapali: ['closed'] },
  automation: { acik: ['on'], kapali: ['off'] },
});

/**
 * Karonun durum rengi için sade durum.
 * @param {{entity_id:string, state:string, attributes?:object}|null|undefined} varlik
 * @returns {{ durum: 'acik'|'kapali'|'yok'|'notr', yuzde: number|null }}
 *   'yok': henüz bilinmiyor / HA'da yok / ulaşılamıyor; 'notr': sahne, düğme gibi açık-kapalı olmayanlar.
 *   Işık açıkken parlaklık varsa yüzde (en az %1) döner.
 */
function karoDurumu(varlik) {
  if (!varlik || typeof varlik.entity_id !== 'string') return { durum: 'yok', yuzde: null };
  if (varlik.state === 'unavailable') return { durum: 'yok', yuzde: null };
  const alan = varlik.entity_id.split('.')[0];
  if (alan === 'script') return { durum: varlik.state === 'on' ? 'acik' : 'notr', yuzde: null };
  if (Object.hasOwn(DURUM_TABLOSU, alan)) {
    const tablo = DURUM_TABLOSU[alan];
    if (tablo.acik.includes(varlik.state)) return { durum: 'acik', yuzde: null };
    if (tablo.kapali.includes(varlik.state)) return { durum: 'kapali', yuzde: null };
    return { durum: 'notr', yuzde: null };
  }
  if (!ACIK_KAPALI_ALANLARI.has(alan)) return { durum: 'notr', yuzde: null };
  if (varlik.state === 'on') {
    let yuzde = alan === 'light' ? yuzdeCevir(varlik.attributes?.brightness) : null;
    if (yuzde !== null && yuzde < 1) yuzde = 1;
    return { durum: 'acik', yuzde };
  }
  if (varlik.state === 'off') return { durum: 'kapali', yuzde: null };
  return { durum: 'yok', yuzde: null }; // unknown vb.
}

/** sensor.pc_ses_default_device metninden etkin çıkış: 'hoparlor' | 'kulaklik' | null. */
function aktifCikis(durumMetni) {
  if (typeof durumMetni !== 'string') return null;
  const m = durumMetni
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i');
  if (m.includes('kulaklik') || m.includes('headphone') || m.includes('headset')) return 'kulaklik';
  if (m.includes('hoparlor') || m.includes('speaker')) return 'hoparlor';
  return null;
}

module.exports = { GRUPLAMA_MS, durumDeposuOlustur, yuzdeCevir, karoDurumu, aktifCikis };
