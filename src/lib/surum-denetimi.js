'use strict';

/**
 * Yeni sürüm denetimi (o-40; saf — ağ ve dosya sistemi dışarıdan verilir).
 *
 * İlkeler:
 *  - Varsayılan KAPALI ve açık rıza ile: `acikMi()` false iken HİÇ istek gitmez (elle denetim dahil). Telemetri yok.
 *  - Giden tek istek: GitHub'ın herkese açık "en son sürüm" adresine anahtarsız, çerezsiz bir GET. Anahtar, Home Assistant adresi,
 *    kullanıcı adı ya da sürüm bilgisi gönderilmez (sabit bir User-Agent yeter). IP adresinin GitHub'a görünmesi kaçınılmazdır; bu
 *    yüzden seçenek ayarda açıkça söylenir.
 *  - Günde en çok bir otomatik denetim (son deneme zamanı başarısız olsa da yazılır); elle denetim en çok dakikada bir.
 *  - Yalnız bildirim: indirme ve kurulum YOKTUR. Sürüm sayfası, kullanıcı bildirime ya da düğmeye tıklayınca varsayılan tarayıcıda açılır
 *    (adres ya sabittir ya da yanıttaki github.com/emre-pn/ha-tray-panel/releases/ adresidir; başka bir adres kabul edilmez).
 *  - Yanıt bozuksa, çok büyükse ya da başka bir adrese yönlendirilmişse yok sayılır; hata iletisi/adresi günlüğe yazılmaz.
 *  - "Ön sürümleri de göster" (o-51, `onSurumlerMi`): yalnız açıkken "en son sürüm" yerine sürüm LİSTESİ (aynı depo, aynı kısıtlar) okunur ve
 *    ön sürümler de sayılır; kapalıyken davranış değişmez (ön sürüm hiçbir zaman önerilmez).
 */

const nodeFs = require('node:fs');
const nodePath = require('node:path');

const SURUM_API_ADRESI = 'https://api.github.com/repos/emre-pn/ha-tray-panel/releases/latest';
const SURUM_SAYFASI = 'https://github.com/emre-pn/ha-tray-panel/releases/latest';
const SAYFA_ONEKI = 'https://github.com/emre-pn/ha-tray-panel/releases/';
const SURUM_LISTE_API_ADRESI = 'https://api.github.com/repos/emre-pn/ha-tray-panel/releases?per_page=15';
const API_ONEKI = 'https://api.github.com/';
const DENETIM_ARALIGI_MS = 24 * 60 * 60 * 1000;
const ELLE_ARALIK_MS = 60 * 1000;
const ZAMAN_ASIMI_MS = 10_000;
const EN_COK_GOVDE = 512 * 1024;
const DURUM_DOSYASI = 'surum-denetimi.json';
const KULLANICI_AJANI = 'ev-paneli-surum-denetimi'; // GitHub API bir User-Agent ister; sürüm ya da makine bilgisi içermez

const SURUM_DESENI = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;
const ON_SURUM_DESENI = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-([0-9A-Za-z-]{1,16}(?:\.[0-9A-Za-z-]{1,16}){0,3}))?$/;

/** "1.4.0" / "v1.4.0" -> { ana, alt, yama }; ön sürüm ("1.4.0-beta"), eksik ya da bozuk metin -> null. */
function surumCoz(metin) {
  if (typeof metin !== 'string' || metin.length > 32) return null;
  const e = SURUM_DESENI.exec(metin.trim());
  return e ? { ana: Number(e[1]), alt: Number(e[2]), yama: Number(e[3]) } : null;
}

function surumMetni(s) {
  return `${s.ana}.${s.alt}.${s.yama}`;
}

/** Ön sürümü de kabul eden çözümleme: "1.5.0-beta.1" -> { ana, alt, yama, on: 'beta.1' }; kararlı sürümde on: null. Bozuk -> null. */
function surumAyristir(metin) {
  if (typeof metin !== 'string' || metin.length > 48) return null;
  const e = ON_SURUM_DESENI.exec(metin.trim());
  return e ? { ana: Number(e[1]), alt: Number(e[2]), yama: Number(e[3]), on: e[4] ?? null } : null;
}

function surumMetniOn(s) {
  return `${surumMetni(s)}${s.on ? `-${s.on}` : ''}`;
}

/** Semver önceliği: ön eki olmayan sürüm, aynı numaralı ön sürümden büyüktür; ön ek parçaları sayıysa sayısal, değilse metin sırasıyla. */
function surumKarsilastirOn(a, b) {
  const x = surumAyristir(a);
  const y = surumAyristir(b);
  if (!x || !y) return null;
  for (const alan of ['ana', 'alt', 'yama']) {
    if (x[alan] !== y[alan]) return x[alan] > y[alan] ? 1 : -1;
  }
  if (x.on === y.on) return 0;
  if (x.on === null) return 1;
  if (y.on === null) return -1;
  const p = x.on.split('.');
  const q = y.on.split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i += 1) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const pSayi = /^\d+$/.test(p[i]);
    const qSayi = /^\d+$/.test(q[i]);
    if (pSayi && qSayi) return Number(p[i]) > Number(q[i]) ? 1 : -1;
    if (pSayi) return -1; // sayısal parça metinsel parçadan küçüktür
    if (qSayi) return 1;
    return p[i] > q[i] ? 1 : -1;
  }
  return 0;
}

/** a ve b sürüm metni: a > b -> 1, a < b -> -1, eşit -> 0; çözülemeyen -> null. */
function surumKarsilastir(a, b) {
  const x = surumCoz(a);
  const y = surumCoz(b);
  if (!x || !y) return null;
  for (const alan of ['ana', 'alt', 'yama']) {
    if (x[alan] !== y[alan]) return x[alan] > y[alan] ? 1 : -1;
  }
  return 0;
}

function surumSayfasiGecerliMi(adres) {
  if (typeof adres !== 'string' || adres.length > 200 || !adres.startsWith(SAYFA_ONEKI)) return false;
  try {
    const u = new URL(adres);
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.username === '' && u.password === '' && u.port === '' && !/[\s<>"]/.test(adres);
  } catch {
    return false;
  }
}

/**
 * GitHub "releases/latest" yanıt gövdesi. Taslak/ön sürüm ya da çözülemeyen etiket -> null.
 * @returns {{ surum: string, sayfa: string } | null} sayfa: yanıttaki geçerli sürüm sayfası, yoksa sabit "en son sürüm" sayfası
 */
function yanitiCoz(govde) {
  let veri;
  try {
    veri = JSON.parse(String(govde));
  } catch {
    return null;
  }
  if (!veri || typeof veri !== 'object' || Array.isArray(veri) || veri.draft === true || veri.prerelease === true) return null;
  const s = surumCoz(veri.tag_name);
  if (!s) return null;
  return { surum: surumMetni(s), sayfa: surumSayfasiGecerliMi(veri.html_url) ? veri.html_url : SURUM_SAYFASI };
}

/**
 * GitHub "releases" LİSTESİ yanıt gövdesi (ön sürümler dahil): taslaklar atlanır, çözülemeyen etiketler atlanır, en yüksek sürüm seçilir.
 * @returns {{ surum: string, sayfa: string, onSurum: boolean } | null}
 */
function listeyiCoz(govde) {
  let liste;
  try {
    liste = JSON.parse(String(govde));
  } catch {
    return null;
  }
  if (!Array.isArray(liste)) return null;
  let en = null;
  for (const kayit of liste.slice(0, 30)) {
    if (!kayit || typeof kayit !== 'object' || Array.isArray(kayit) || kayit.draft === true) continue;
    const s = surumAyristir(kayit.tag_name);
    if (!s) continue;
    const metin = surumMetniOn(s);
    if (en === null || surumKarsilastirOn(metin, en.surum) === 1) {
      en = { surum: metin, sayfa: surumSayfasiGecerliMi(kayit.html_url) ? kayit.html_url : SURUM_SAYFASI, onSurum: s.on !== null };
    }
  }
  return en;
}

const zamanMi = (d) => typeof d === 'number' && Number.isFinite(d) && d > 0;

/** Kayıtlı durumu bilinen alanlara indirger (bozuk/yabancı içerik atılır). */
function durumuDuzelt(ham) {
  const kaynak = ham && typeof ham === 'object' && !Array.isArray(ham) ? ham : {};
  const surum = (d) => {
    const s = surumAyristir(d);
    return s ? surumMetniOn(s) : null;
  };
  return {
    sonDenetim: zamanMi(kaynak.sonDenetim) ? kaynak.sonDenetim : 0,
    sonSurum: surum(kaynak.sonSurum), // denetimde görülen en son sürüm
    bildirilen: surum(kaynak.bildirilen), // hakkında bildirim gösterilmiş sürüm (aynı sürüm için bir kez)
  };
}

/** Durum dosyası (kullanıcı veri klasöründe küçük JSON); okunamaz/yazılamazsa sessizce bellekte kalır. */
function dosyaDeposu({ yol, fs = nodeFs, path = nodePath } = {}) {
  return {
    oku() {
      try {
        if (fs.statSync(yol).size > 4096) return null;
        return JSON.parse(fs.readFileSync(yol, 'utf8'));
      } catch {
        return null;
      }
    },
    yaz(durum) {
      const gecici = `${yol}.tmp`;
      try {
        fs.mkdirSync(path.dirname(yol), { recursive: true });
        fs.writeFileSync(gecici, `${JSON.stringify(durum)}\n`, 'utf8');
        fs.renameSync(gecici, yol);
      } catch {
        try {
          fs.unlinkSync(gecici);
        } catch {
          /* geçici dosya yok */
        }
      }
    },
  };
}

/**
 * @param {object} g
 * @param {(url: string, secenek: object) => Promise<object>} g.fetch ağ (main.js: net.fetch); testte sahte
 * @param {string} g.mevcutSurum çalışan sürüm ("1.3.0")
 * @param {() => boolean} g.acikMi ayar `surumDenetimi` (kapalıyken hiç istek gitmez)
 * @param {() => boolean} [g.onSurumlerMi] ayar `onSurumler`: açıkken sürüm listesi okunur, ön sürümler de sayılır
 * @param {{oku: () => object|null, yaz: (d: object) => void}} g.depo
 * @param {() => number} [g.simdi]
 * @param {(m: string) => void} [g.gunluk]
 * @param {(ms: number) => AbortSignal|undefined} [g.zamanAsimi]
 */
function surumDenetleyicisiOlustur({
  fetch,
  mevcutSurum,
  acikMi,
  onSurumlerMi = () => false,
  depo,
  simdi = Date.now,
  gunluk = () => {},
  zamanAsimi = (ms) => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined),
} = {}) {
  let durum = null;
  let bekleyen = null; // sürmekte olan denetim (aynı anda tek istek)
  let sonElle = 0;

  const durumAl = () => {
    if (!durum) durum = durumuDuzelt(depo?.oku?.());
    return durum;
  };
  const durumuYaz = () => {
    try {
      depo?.yaz?.({ ...durumAl() });
    } catch {
      /* yazılamadı: bellekte kalır */
    }
  };
  const yeniMi = (surum) => surumKarsilastirOn(surum, mevcutSurum) === 1;

  async function istekYap() {
    const onSurumler = onSurumlerMi() === true;
    let yanit;
    try {
      yanit = await fetch(onSurumler ? SURUM_LISTE_API_ADRESI : SURUM_API_ADRESI, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': KULLANICI_AJANI },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: zamanAsimi(ZAMAN_ASIMI_MS),
      });
    } catch (hata) {
      const ad = hata?.name;
      return { sonuc: 'hata', neden: ad === 'TimeoutError' || ad === 'AbortError' ? 'zaman' : 'ag' };
    }
    if (typeof yanit?.url === 'string' && yanit.url !== '' && !yanit.url.startsWith(API_ONEKI)) return { sonuc: 'hata', neden: 'yonlendirme' };
    if (!yanit || yanit.ok !== true) return { sonuc: 'hata', neden: 'http' };
    const uzunluk = Number(yanit.headers?.get?.('content-length'));
    if (Number.isFinite(uzunluk) && uzunluk > EN_COK_GOVDE) return { sonuc: 'hata', neden: 'buyuk' };
    let govde;
    try {
      govde = await yanit.text();
    } catch {
      return { sonuc: 'hata', neden: 'ag' };
    }
    if (typeof govde !== 'string' || govde.length > EN_COK_GOVDE) return { sonuc: 'hata', neden: 'buyuk' };
    const cozulen = onSurumler ? listeyiCoz(govde) : yanitiCoz(govde);
    if (!cozulen) return { sonuc: 'hata', neden: 'yanit' };
    return { sonuc: 'tamam', ...cozulen };
  }

  /**
   * @param {{ elle?: boolean }} [secenek] elle: kullanıcı "Güncellemeleri denetle" dedi (günlük sınırı beklemez; dakikada bir)
   * @returns {Promise<{sonuc: 'kapali'|'erken'|'cok-sik'|'guncel'|'yeni'|'hata', surum?: string, sayfa?: string, bildirimGerek?: boolean, neden?: string}>}
   */
  function denetle({ elle = false } = {}) {
    if (!acikMi()) return Promise.resolve({ sonuc: 'kapali' });
    if (bekleyen) return bekleyen;
    const t = simdi();
    const d = durumAl();
    if (elle) {
      if (sonElle > 0 && t >= sonElle && t - sonElle < ELLE_ARALIK_MS) return Promise.resolve({ sonuc: 'cok-sik' });
      sonElle = t;
    } else if (d.sonDenetim > 0 && t >= d.sonDenetim && t - d.sonDenetim < DENETIM_ARALIGI_MS) {
      return Promise.resolve({ sonuc: 'erken' });
    }
    d.sonDenetim = t; // deneme başarısız olsa da yazılır: günde en çok bir otomatik istek
    durumuYaz();
    bekleyen = (async () => {
      try {
        const yanit = await istekYap();
        if (yanit.sonuc === 'hata') {
          gunluk(`Sürüm denetimi tamamlanamadı (${yanit.neden}).`);
          return { sonuc: 'hata', neden: yanit.neden };
        }
        if (yeniMi(yanit.surum)) {
          d.sonSurum = yanit.surum;
          const bildirimGerek = d.bildirilen !== yanit.surum;
          durumuYaz();
          gunluk(`Sürüm denetimi: yeni sürüm var (${yanit.surum}).`);
          return { sonuc: 'yeni', surum: yanit.surum, sayfa: yanit.sayfa, bildirimGerek };
        }
        d.sonSurum = null;
        durumuYaz();
        gunluk('Sürüm denetimi: güncel.');
        return { sonuc: 'guncel', surum: yanit.surum };
      } finally {
        bekleyen = null;
      }
    })();
    return bekleyen;
  }

  return {
    denetle,
    /** Bu sürüm için bildirim gösterildi (aynı sürüm için bir daha bildirilmez). */
    bildirildi(surum) {
      const s = surumAyristir(surum); // ön sürüm de olabilir ("Ön sürümleri de göster"): denetle() aynı metni karşılaştırır
      if (!s) return;
      durumAl().bildirilen = surumMetniOn(s);
      durumuYaz();
    },
    /** Kayıtlı bilgi (ağa çıkmaz). yeniSurum: önceki bir denetimde görülen ve çalışandan yeni olan sürüm. */
    bilgi() {
      const d = durumAl();
      // Ön sürümler kapatıldıysa önceki denetimden kalan ön sürüm "yeni sürüm" sayılmaz (kapalıyken ön sürüm hiçbir zaman önerilmez).
      const onSurumMu = d.sonSurum ? surumAyristir(d.sonSurum)?.on != null : false;
      const gorunur = d.sonSurum && (!onSurumMu || onSurumlerMi() === true) && yeniMi(d.sonSurum);
      return { acik: !!acikMi(), sonDenetim: d.sonDenetim > 0 ? d.sonDenetim : null, yeniSurum: gorunur ? d.sonSurum : null };
    },
  };
}

module.exports = {
  SURUM_API_ADRESI,
  SURUM_LISTE_API_ADRESI,
  SURUM_SAYFASI,
  DENETIM_ARALIGI_MS,
  ELLE_ARALIK_MS,
  ZAMAN_ASIMI_MS,
  EN_COK_GOVDE,
  DURUM_DOSYASI,
  surumCoz,
  surumKarsilastir,
  surumAyristir,
  surumMetniOn,
  surumKarsilastirOn,
  surumSayfasiGecerliMi,
  yanitiCoz,
  listeyiCoz,
  durumuDuzelt,
  dosyaDeposu,
  surumDenetleyicisiOlustur,
};
