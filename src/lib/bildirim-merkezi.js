'use strict';

/**
 * Bildirim merkezi (o-36) — saf; Electron ve ağ yok.
 *
 * Panelin bildirim şeridi ve köşe bildirimleri tek modelden beslenir. Dört kaynak:
 *   uyari       kullanıcının kurduğu varlık uyarıları (src/lib/uyari-kurallari.js); bellekte, en çok 20, 24 saat
 *   ha          Home Assistant kalıcı bildirimleri (ha-okuma.js bildirimAboneOl); kapatma HA'ya gider (eylem.bildirimKapat)
 *   pil         düşük pil (sensor / binary_sensor, device_class battery; eşik ayarlıdır)
 *   guncelleme  bekleyen güncelleme (update.* durumu "on")
 *
 * Kurallar:
 *  - İLK YÜKLEME SESSİZDİR: bir kaynağın ilk verisindeki öğeler "bilinen" sayılır, masaüstü yansıtması üretmez (açılışta bildirim
 *    selli olmaz). Sonradan çıkan her yeni öğe BİR kez `yeniOge` ile bildirilir; öğe kalkıp geri gelince yeniden yeni sayılır.
 *    Ayar (kaynak aç/kapat, pil eşiği) değişiminden sonraki ilk karşılaştırma da sessizdir.
 *  - YEREL KAPATMA: pil ve güncelleme öğeleri HA'da kapatılamaz; kapatılanlar kalıcı dosyada (kapatilanDeposuOlustur) tutulur ve
 *    koşul KALKANA dek (pil eşiğin üstüne çıkınca, güncelleme yüklenince / yeni sürüm gelince) bir daha gösterilmez. Güncelleme
 *    anahtarı sürümü içerir: yeni sürüm yeni bildirimdir. Ulaşılamıyor / bilinmiyor durumu koşulu kaldırmaz (öğe korunur).
 *  - KAPI KURALI: gösterilen her metin (başlık, gövde, ad, sürüm) kapı/kilit süzgecinden geçer; Markdown düz metne indirgendikten
 *    SONRA yeniden süzülür (bağlantı metni ile adresin birleşmesiyle yeni bir sözcük doğmuş olabilir). Geçmeyen öğe HİÇ
 *    gösterilmez, yalnız `gizlenen` sayısına eklenir. Pil ve güncelleme varlıkları guvenliVarlikMi / adGuvenliMi'den geçer
 *    (kapı sensörünün pili, kilit yazılımı güncellemesi listeye girmez).
 *  - Dosyada yalnız anahtarlar ve zaman damgaları vardır (varlık kimliği + sürüm); sır içermez.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi, guvenliVarlikMi, guvenliMetin, metinGuvenliMi } = require('./suzgec');
const { BILDIRIM_KIMLIGI_DESENI } = require('./servis-izinleri');
const { sayiAl } = require('./varlik-ozellik');
const { pilYuzdeMetni, pilDusukMetni, guncellemeMetni } = require('./bildirim-metni');
const { TR } = require('./ceviri-varsayilan');

const KAYNAKLAR = Object.freeze(['uyari', 'ha', 'pil', 'guncelleme']);
const KAYNAK_SIMGELERI = Object.freeze({ uyari: '🔔', ha: '🏠', pil: '🔋', guncelleme: '⬆' });

const EN_COK_OGE = 30; // modelde (panel şeridi) en çok bu kadar öğe; `sayi` gerçek toplamı verir
const EN_COK_UYARI = 20;
const UYARI_OMRU_MS = 24 * 60 * 60 * 1000;
const EN_COK_PIL = 100;
const EN_COK_GUNCELLEME = 50;
const EN_COK_TARANAN = 8000; // /api/states yanıtında en çok bu kadar varlığa bakılır
const BASLIK_SINIRI = 80;
const METIN_SINIRI = 200;
const KAPATILAN_EN_COK = 200;
const KAPATILAN_OMRU_MS = 90 * 24 * 60 * 60 * 1000;
const PIL_ESIGI_VARSAYILAN = 20;
const SURUM_DESENI = /^[A-Za-z0-9._+~:-]{1,30}$/;
const KAPATILAN_ANAHTAR_DESENI = /^(pil|guncelleme):[a-z0-9_]+\.[a-z0-9_]+(:[A-Za-z0-9._+~:-]{1,30})?$/;

// ---------------------------------------------------------------------------
// Markdown -> düz metin
// ---------------------------------------------------------------------------

/**
 * HA kalıcı bildirimleri Markdown olabilir; köşe/panel düz metin gösterir. Bağlantı ve görsel yalnız etiketiyle kalır (adres
 * gösterilmez), başlık/liste/alıntı/kod işaretleri atılır, HTML etiketleri silinir, boşluklar teke iner. Sonuç yeniden süzülmelidir.
 * @param {unknown} metin
 * @returns {string}
 */
function duzMetin(metin) {
  if (typeof metin !== 'string') return '';
  let s = metin.slice(0, 4000);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/```[^\n]*\n?/g, '\n'); // kod çiti
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // görsel -> alt metin
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // bağlantı -> etiket
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1'); // başvuru bağlantısı
  s = s.replace(/<https?:[^>]*>/gi, ''); // <https://...>
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, ' '); // HTML etiketleri
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // başlık işareti
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, ''); // alıntı
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '• '); // madde işareti
  s = s.replace(/^[ \t]*\d{1,3}[.)][ \t]+/gm, ''); // numaralı liste
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2'); // kalın
  s = s.replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2'); // italik
  s = s.replace(/~~(.+?)~~/g, '$1'); // üstü çizili
  s = s.replace(/`+/g, ''); // satır içi kod
  s = s.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, ' '); // yatay çizgi
  return s.replace(/\s+/g, ' ').trim();
}

/** Düzleştirilmiş ve süzülmüş metin; geçmezse null. */
function suzulmusDuzMetin(metin, enFazla) {
  const d = duzMetin(metin);
  return d === '' ? null : guvenliMetin(d, enFazla);
}

// ---------------------------------------------------------------------------
// Pil ve güncelleme varlıkları
// ---------------------------------------------------------------------------

const BELIRSIZ_DURUMLAR = Object.freeze(['unavailable', 'unknown']);

function varlikAdi(varlik) {
  const ad = varlik?.attributes?.friendly_name;
  return (typeof ad === 'string' && ad.trim() !== '' ? guvenliMetin(ad, 60) : null) ?? varlik.entity_id;
}

/**
 * Pil varlığı mı? Pil sensörü (sensor, device_class battery, yüzde) ya da düşük pil ikili sensörü (binary_sensor, battery; "on" = düşük).
 * Kapı Kuralı'ndan geçmeyen varlık null.
 * @returns {{kimlik: string, ad: string, yuzde: number|null, dusuk: boolean, belirsiz: boolean}|null}
 */
function pilVarligi(varlik) {
  if (!varlik || typeof varlik.entity_id !== 'string' || !VARLIK_KIMLIGI_DESENI.test(varlik.entity_id)) return null;
  const alan = alanAl(varlik.entity_id);
  if (alan !== 'sensor' && alan !== 'binary_sensor') return null;
  const nitelik = varlik.attributes && typeof varlik.attributes === 'object' ? varlik.attributes : {};
  if (String(nitelik.device_class ?? '').toLowerCase() !== 'battery') return null;
  if (!guvenliVarlikMi(varlik)) return null;
  const durum = varlik.state;
  const belirsiz = BELIRSIZ_DURUMLAR.includes(durum);
  const temel = { kimlik: varlik.entity_id, ad: varlikAdi(varlik), yuzde: null, dusuk: false, belirsiz };
  if (belirsiz) return temel;
  if (alan === 'binary_sensor') return durum === 'on' || durum === 'off' ? { ...temel, dusuk: durum === 'on' } : null;
  const birim = nitelik.unit_of_measurement;
  if (birim !== undefined && birim !== null && birim !== '%') return null;
  const n = sayiAl(durum, { min: 0, max: 100 });
  return n === null ? null : { ...temel, yuzde: Math.round(n) };
}

/** Güncelleme sürümü: yalnız güvenli sürüm karakterleri; aksi halde ''. */
function surumTemizle(ham) {
  if (typeof ham !== 'string') return '';
  const s = ham.trim();
  return SURUM_DESENI.test(s) && metinGuvenliMi(s) ? s : '';
}

/**
 * Bekleyen güncelleme varlığı mı? update.* ve durum "on" (HA, atlanan sürümü zaten "off" sayar). `update` alanı alan kaydında
 * olmadığından Kapı Kuralı burada ayrıca uygulanır (kimlik + ad süzgeci, cihaz sınıfı).
 * @returns {{kimlik: string, ad: string, surum: string, belirsiz: boolean}|null}
 */
function guncellemeVarligi(varlik) {
  if (!varlik || typeof varlik.entity_id !== 'string' || !VARLIK_KIMLIGI_DESENI.test(varlik.entity_id)) return null;
  if (alanAl(varlik.entity_id) !== 'update') return null;
  const nitelik = varlik.attributes && typeof varlik.attributes === 'object' ? varlik.attributes : {};
  const sinif = String(nitelik.device_class ?? '');
  if (!adGuvenliMi(varlik.entity_id, nitelik.friendly_name ?? '') || !adGuvenliMi('', sinif)) return null;
  const ad = varlikAdi(varlik);
  if (!metinGuvenliMi(ad)) return null;
  const belirsiz = BELIRSIZ_DURUMLAR.includes(varlik.state);
  if (!belirsiz && varlik.state !== 'on') return { kimlik: varlik.entity_id, ad, surum: '', belirsiz: false, bekliyor: false };
  return { kimlik: varlik.entity_id, ad, surum: surumTemizle(nitelik.latest_version), belirsiz, bekliyor: !belirsiz };
}

/**
 * /api/states yanıtından (ham dizi) pil ve güncelleme varlıklarını çıkarır. Dizi değilse null.
 * @returns {{piller: Map<string, object>, guncellemeler: Map<string, object>}|null}
 */
function varliklariTara(varliklar) {
  if (!Array.isArray(varliklar)) return null;
  const piller = new Map();
  const guncellemeler = new Map();
  for (const v of varliklar.slice(0, EN_COK_TARANAN)) {
    if (piller.size >= EN_COK_PIL && guncellemeler.size >= EN_COK_GUNCELLEME) break;
    if (!v || typeof v !== 'object' || typeof v.entity_id !== 'string') continue;
    const alan = alanAl(v.entity_id);
    if (alan === 'update') {
      if (guncellemeler.size >= EN_COK_GUNCELLEME) continue;
      const g = guncellemeVarligi(v);
      if (g) guncellemeler.set(g.kimlik, g);
    } else if (alan === 'sensor' || alan === 'binary_sensor') {
      if (piller.size >= EN_COK_PIL) continue;
      const p = pilVarligi(v);
      if (p) piller.set(p.kimlik, p);
    }
  }
  return { piller, guncellemeler };
}

// ---------------------------------------------------------------------------
// Kapatılanlar (kalıcı)
// ---------------------------------------------------------------------------

function kapatilanAnahtariGecerliMi(anahtar) {
  return typeof anahtar === 'string' && anahtar.length <= 160 && KAPATILAN_ANAHTAR_DESENI.test(anahtar);
}

/** Dosya içeriğini temizler: bozuk/yinelenen/eski kayıtlar atılır, en çok KAPATILAN_EN_COK, en yeni önde. */
function kapatilanlariDuzelt(ham, an = Date.now()) {
  const liste = Array.isArray(ham?.kayitlar) ? ham.kayitlar : [];
  const gorulen = new Set();
  const sonuc = [];
  for (const oge of liste) {
    const anahtar = oge?.anahtar;
    if (!kapatilanAnahtariGecerliMi(anahtar) || gorulen.has(anahtar)) continue;
    const zaman = Number.isFinite(oge.zaman) ? oge.zaman : 0;
    if (an - zaman > KAPATILAN_OMRU_MS) continue;
    gorulen.add(anahtar);
    sonuc.push({ anahtar, zaman });
    if (sonuc.length >= KAPATILAN_EN_COK) break;
  }
  return sonuc;
}

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * Yerelde kapatılan (pil / güncelleme) bildirim anahtarları. Dosya: <userData>\bildirim-kapatilan.json, atomik yazma.
 * @param {object} bag
 * @param {string} bag.dosyaYolu
 * @param {{existsSync, readFileSync, writeFileSync, renameSync, mkdirSync}} bag.fs
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 */
function kapatilanDeposuOlustur({ dosyaYolu, fs, gunluk = () => {}, simdi = () => Date.now(), zaman = varsayilanZaman() }) {
  let kayitlar = [];
  let kirli = false;
  let zamanlayici = null;

  function yaz() {
    zaman.clearTimeout(zamanlayici);
    zamanlayici = null;
    if (!kirli) return true;
    const gecici = `${dosyaYolu}.tmp`;
    try {
      const yol = String(dosyaYolu).replace(/[\\/][^\\/]*$/, '');
      if (yol && yol !== dosyaYolu) fs.mkdirSync(yol, { recursive: true });
      fs.writeFileSync(gecici, `${JSON.stringify({ surum: 1, kayitlar }, null, 1)}\n`, 'utf8');
      fs.renameSync(gecici, dosyaYolu);
      kirli = false;
      return true;
    } catch {
      gunluk('Bildirim kapatma dosyası yazılamadı.');
      return false;
    }
  }

  function yazmayiPlanla() {
    kirli = true;
    if (zamanlayici === null) zamanlayici = zaman.setTimeout(yaz, 500);
  }

  return {
    yukle() {
      kayitlar = [];
      try {
        if (!fs.existsSync(dosyaYolu)) return 0;
        const ham = JSON.parse(String(fs.readFileSync(dosyaYolu, 'utf8')).replace(/^﻿/, ''));
        kayitlar = kapatilanlariDuzelt(ham, simdi());
      } catch {
        gunluk('Bildirim kapatma dosyası okunamadı; liste boş başlatıldı.');
        kayitlar = [];
      }
      return kayitlar.length;
    },
    var: (anahtar) => kayitlar.some((k) => k.anahtar === anahtar),
    /** @returns {boolean} eklendi mi (geçersiz anahtar eklenmez) */
    ekle(anahtar) {
      if (!kapatilanAnahtariGecerliMi(anahtar)) return false;
      if (kayitlar.some((k) => k.anahtar === anahtar)) return true;
      kayitlar = [{ anahtar, zaman: simdi() }, ...kayitlar].slice(0, KAPATILAN_EN_COK);
      yazmayiPlanla();
      return true;
    },
    sil(anahtar) {
      const onceki = kayitlar.length;
      kayitlar = kayitlar.filter((k) => k.anahtar !== anahtar);
      if (kayitlar.length !== onceki) yazmayiPlanla();
    },
    anahtarlar: () => kayitlar.map((k) => k.anahtar),
    temizle() {
      if (kayitlar.length === 0) return;
      kayitlar = [];
      yazmayiPlanla();
    },
    bosalt: yaz,
    sayi: () => kayitlar.length,
  };
}

// ---------------------------------------------------------------------------
// Merkez
// ---------------------------------------------------------------------------

const zamanMs = (iso) => {
  const n = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {object} bag
 * @param {{var: Function, ekle: Function, sil: Function, anahtarlar: Function}} bag.kapatilan kapatilanDeposuOlustur sonucu
 * @param {() => number} [bag.simdi]
 * @param {Function} [bag.t]
 * @param {(oge: object) => void} [bag.yeniOge] ilk yüklemeden SONRA ortaya çıkan her yeni merkez öğesi için (ha / pil / guncelleme)
 */
function merkezOlustur({ kapatilan, simdi = () => Date.now(), t = TR, yeniOge = () => {} }) {
  let tr = t;
  let ayar = { kalici: true, pil: true, guncelleme: false, pilEsigi: PIL_ESIGI_VARSAYILAN };
  const ha = new Map(); // id -> { id, baslik, metin, zaman }
  let haHazir = false;
  let haGizlenen = 0;
  let sonGizlenen = 0; // düzleştirilmiş metni süzgeçten geçmeyen öğe sayısı (son hesaplama)
  let piller = new Map();
  let guncellemeler = new Map();
  let taramaHazir = false;
  let uyarilar = [];
  const bilinen = new Set();
  const dinleyiciler = new Set();

  function degistiBildir() {
    for (const d of [...dinleyiciler]) {
      try {
        d();
      } catch {
        /* dinleyici hatası merkezi etkilemesin */
      }
    }
  }

  const kalici = () => ayar.kalici;

  function kaynakHazir(kaynak) {
    return kaynak === 'ha' ? haHazir : taramaHazir;
  }

  /** Kapatma durumundan bağımsız, ayarlara uyan tüm merkez öğeleri (anahtar -> öğe). */
  function merkezOgeleri() {
    const harita = new Map();
    let gizlenen = 0;
    if (ayar.kalici) {
      for (const b of ha.values()) {
        const metin = suzulmusDuzMetin(b.metin, METIN_SINIRI);
        const baslik = b.baslik ? suzulmusDuzMetin(b.baslik, BASLIK_SINIRI) : null;
        if (!metin || (b.baslik && !baslik)) {
          gizlenen += 1;
          continue;
        }
        harita.set(`ha:${b.id}`, {
          anahtar: `ha:${b.id}`,
          kaynak: 'ha',
          baslik: baslik ?? tr('merkez.ha.baslik'),
          metin,
          zaman: zamanMs(b.zaman),
          simge: KAYNAK_SIMGELERI.ha,
          haKimligi: b.id,
        });
      }
    }
    if (ayar.pil) {
      for (const p of piller.values()) {
        const dusukMu = p.yuzde !== null ? p.yuzde <= ayar.pilEsigi : p.dusuk;
        if (!dusukMu) continue;
        const metin = guvenliMetin(p.yuzde !== null ? pilYuzdeMetni(p.ad, p.yuzde, tr) : pilDusukMetni(p.ad, tr), METIN_SINIRI);
        if (!metin) {
          gizlenen += 1;
          continue;
        }
        harita.set(`pil:${p.kimlik}`, { anahtar: `pil:${p.kimlik}`, kaynak: 'pil', baslik: tr('merkez.pil.baslik'), metin, zaman: 0, simge: KAYNAK_SIMGELERI.pil });
      }
    }
    if (ayar.guncelleme) {
      for (const g of guncellemeler.values()) {
        if (!g.bekliyor) continue;
        const anahtar = g.surum ? `guncelleme:${g.kimlik}:${g.surum}` : `guncelleme:${g.kimlik}`;
        const metin = guvenliMetin(guncellemeMetni(g.ad, g.surum, tr), METIN_SINIRI);
        if (!metin) {
          gizlenen += 1;
          continue;
        }
        harita.set(anahtar, { anahtar, kaynak: 'guncelleme', baslik: tr('merkez.guncelleme.baslik'), metin, zaman: 0, simge: KAYNAK_SIMGELERI.guncelleme });
      }
    }
    sonGizlenen = gizlenen;
    return harita;
  }

  /**
   * Yeni ortaya çıkan öğeleri bulur (bilinenle karşılaştırır) ve kapatma kayıtlarını koşulu kalkanlar için budar.
   * @param {boolean} [sessiz] true: yalnız tabanı güncelle, yeni öğe bildirme (ayar değişimi)
   */
  function esitle(sessiz = false) {
    const tum = merkezOgeleri();
    const yeniler = [];
    for (const [anahtar, oge] of tum) {
      if (bilinen.has(anahtar)) continue;
      bilinen.add(anahtar);
      if (!sessiz && kaynakHazir(oge.kaynak)) yeniler.push(oge);
    }
    for (const anahtar of [...bilinen]) if (!tum.has(anahtar)) bilinen.delete(anahtar);
    // Koşulu kalkan (pil eşiğin üstüne çıktı, güncelleme yüklendi / yeni sürüm geldi) yerel kapatmalar silinir; kapalı kaynak ve henüz
    // taranmamış durumda dokunulmaz.
    if (taramaHazir) {
      for (const anahtar of kapatilan.anahtarlar()) {
        const kaynak = anahtar.startsWith('pil:') ? 'pil' : 'guncelleme';
        if (ayar[kaynak] && !tum.has(anahtar)) kapatilan.sil(anahtar);
      }
    }
    for (const oge of yeniler.slice(0, 50)) {
      if (kapatilan.var(oge.anahtar)) continue;
      try {
        yeniOge({ ...oge });
      } catch {
        /* yansıtma hatası merkezi etkilemesin */
      }
    }
    degistiBildir();
  }

  function uyarilariBuda() {
    const sinir = simdi() - UYARI_OMRU_MS;
    uyarilar = uyarilar.filter((u) => u.zaman >= sinir);
  }

  function bul(anahtar) {
    if (typeof anahtar !== 'string') return undefined;
    uyarilariBuda();
    const u = uyarilar.find((o) => o.anahtar === anahtar);
    if (u) return { ...u };
    const o = merkezOgeleri().get(anahtar);
    return o && !kapatilan.var(anahtar) ? { ...o } : undefined;
  }

  function disaAktar(o) {
    return { anahtar: o.anahtar, kaynak: o.kaynak, baslik: o.baslik, metin: o.metin, zaman: o.zaman, simge: o.simge };
  }

  return {
    /** Ayarları uygular; kaynak açılması / eşik değişimi sonrası karşılaştırma sessizdir (mevcutlar yeni sayılmaz). */
    ayarla(yeni = {}) {
      const onceki = ayar;
      ayar = {
        kalici: yeni.kalici !== undefined ? yeni.kalici === true : onceki.kalici,
        pil: yeni.pil !== undefined ? yeni.pil === true : onceki.pil,
        guncelleme: yeni.guncelleme !== undefined ? yeni.guncelleme === true : onceki.guncelleme,
        pilEsigi: Number.isInteger(yeni.pilEsigi) && yeni.pilEsigi >= 5 && yeni.pilEsigi <= 50 ? yeni.pilEsigi : onceki.pilEsigi,
      };
      esitle(true);
    },
    ayarlar: () => ({ ...ayar }),
    dilDegisti(yeniT) {
      if (typeof yeniT === 'function') tr = yeniT;
      degistiBildir();
    },
    /** HA kalıcı bildirim listesi (ha-okuma bildirimAboneOl dinleyicisi). Dinleyiciden gelen liste TAM güncel listedir. */
    haGuncelle(liste, { gizlenen = 0 } = {}) {
      ha.clear();
      for (const b of Array.isArray(liste) ? liste.slice(0, 50) : []) {
        if (!b || typeof b.id !== 'string' || !BILDIRIM_KIMLIGI_DESENI.test(b.id) || typeof b.metin !== 'string') continue;
        ha.set(b.id, { id: b.id, baslik: typeof b.baslik === 'string' ? b.baslik : null, metin: b.metin, zaman: typeof b.zaman === 'string' ? b.zaman : null });
      }
      haGizlenen = Number.isInteger(gizlenen) && gizlenen > 0 ? Math.min(gizlenen, 999) : 0;
      esitle(false);
      haHazir = true;
    },
    /** /api/states taraması (ham dizi). Geçersiz girdi yok sayılır. @returns {boolean} uygulandı mı */
    taramaGuncelle(varliklar) {
      const sonuc = varliklariTara(varliklar);
      if (!sonuc) return false;
      // Ulaşılamıyor / bilinmiyor: koşulun kalktığı anlamına gelmez; öncekini koru (kapatma ve yinelenen bildirim sıfırlanmasın).
      for (const [kimlik, p] of sonuc.piller) if (p.belirsiz && piller.has(kimlik)) sonuc.piller.set(kimlik, piller.get(kimlik));
      for (const [kimlik, g] of sonuc.guncellemeler) if (g.belirsiz && guncellemeler.has(kimlik)) sonuc.guncellemeler.set(kimlik, guncellemeler.get(kimlik));
      for (const [kimlik, p] of sonuc.piller) if (p.belirsiz && p.yuzde === null && !p.dusuk) sonuc.piller.delete(kimlik);
      piller = sonuc.piller;
      guncellemeler = sonuc.guncellemeler;
      esitle(false);
      taramaHazir = true;
      return true;
    },
    /** Uyarı değerlendiricisinin olayı (uyari-kurallari.js). @returns {object|null} eklenen öğe */
    uyariEkle(olay) {
      if (!olay || typeof olay.kuralId !== 'string') return null;
      const metin = suzulmusDuzMetin(olay.metin, METIN_SINIRI);
      if (!metin) return null;
      const an = Number.isFinite(olay.zaman) ? olay.zaman : simdi();
      const oge = {
        anahtar: `uyari:${olay.kuralId}:${an}`,
        kaynak: 'uyari',
        baslik: tr('merkez.uyari.baslik'),
        metin,
        zaman: an,
        simge: typeof olay.simge === 'string' && olay.simge.length > 0 && olay.simge.length <= 8 ? olay.simge : KAYNAK_SIMGELERI.uyari,
      };
      uyarilar = [oge, ...uyarilar.filter((u) => u.anahtar !== oge.anahtar)].slice(0, EN_COK_UYARI);
      degistiBildir();
      return { ...oge };
    },
    /** Panelde gösterilecek model: { ogeler (en çok 30), sayi (toplam), gizlenen }. */
    model() {
      uyarilariBuda();
      const tum = [...merkezOgeleri().values()].filter((o) => !kapatilan.var(o.anahtar));
      const sira = (o) => KAYNAKLAR.indexOf(o.kaynak);
      const hepsi = [...uyarilar, ...tum].sort((a, b) => sira(a) - sira(b) || b.zaman - a.zaman);
      return { ogeler: hepsi.slice(0, EN_COK_OGE).map(disaAktar), sayi: hepsi.length, gizlenen: haGizlenen + sonGizlenen };
    },
    /** Anahtara göre güncel (görünen) öğe; yoksa undefined. */
    bul,
    /** Kimlik şu an panelde GÖSTERİLEN bir HA bildirimi mi? (süzgeçten geçmeyen gizli bildirim kapatılamaz) */
    haKimligiVarMi: (id) => typeof id === 'string' && kalici() && merkezOgeleri().has(`ha:${id}`),
    /** HA bildirim aboneliği bırakıldı: liste ve taban sıfırlanır (yeniden açılınca mevcutlar sessiz sayılır). */
    haSifirla() {
      ha.clear();
      haHazir = false;
      haGizlenen = 0;
      esitle(true);
    },
    /** Pil / güncelleme taraması kapatıldı: veri ve taban sıfırlanır. */
    taramaSifirla() {
      piller = new Map();
      guncellemeler = new Map();
      taramaHazir = false;
      esitle(true);
    },
    /**
     * Öğeyi kapatır. ha: HA'ya gönderilecek kimlik döner (çağıran eylem.bildirimKapat yapar, başarıda haKapandi çağırır);
     * uyarı / pil / güncelleme: yerelde kapanır.
     * @returns {{tur: 'ha', haKimligi: string}|{tur: 'yerel'}|null} bulunamazsa null
     */
    kapat(anahtar) {
      const oge = bul(anahtar);
      if (!oge) return null;
      if (oge.kaynak === 'ha') return { tur: 'ha', haKimligi: oge.haKimligi };
      if (oge.kaynak === 'uyari') {
        uyarilar = uyarilar.filter((u) => u.anahtar !== anahtar);
      } else if (!kapatilan.ekle(anahtar)) {
        return null;
      }
      degistiBildir();
      return { tur: 'yerel' };
    },
    /** HA kapatmayı onayladı: öğe hemen listeden çıkar (asıl "removed" olayı da gelecektir). */
    haKapandi(id) {
      if (!ha.delete(id)) return;
      esitle(true);
    },
    dinle(fn) {
      dinleyiciler.add(fn);
      return () => dinleyiciler.delete(fn);
    },
    /** Kaynaklar için hazırlık durumu (testler / tanı). */
    durum: () => ({ haHazir, taramaHazir, ha: ha.size, pil: piller.size, guncelleme: guncellemeler.size, uyari: uyarilar.length }),
  };
}

module.exports = {
  KAYNAKLAR,
  KAYNAK_SIMGELERI,
  EN_COK_OGE,
  EN_COK_UYARI,
  UYARI_OMRU_MS,
  KAPATILAN_EN_COK,
  PIL_ESIGI_VARSAYILAN,
  duzMetin,
  pilVarligi,
  guncellemeVarligi,
  varliklariTara,
  surumTemizle,
  kapatilanAnahtariGecerliMi,
  kapatilanlariDuzelt,
  kapatilanDeposuOlustur,
  merkezOlustur,
};
