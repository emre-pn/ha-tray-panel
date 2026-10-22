'use strict';

/**
 * Son eylemi geri al (o-12, 1.4.0 eylem grubu; saf, Electron'a ve ağa bağlı değildir).
 *
 * Fikir: kullanıcı bir ışığı/prizi/vantilatörü/sahneyi panelden, paletten, kısayoldan... değiştirdiğinde eylemden ÖNCEKİ durum
 * (eylem hattının `sonuc.once` görüntüsü; src/lib/eylem-hatti.js) en çok 5 girdilik, süre sınırlı bir yığına yazılır. "Geri al"
 * (panel düğmesi, Ctrl+Alt+Z, tepsi menüsü) en yeni girdinin geri yükleme ADIMLARINI üretir; adımları çalıştırmak eylem katmanındaki
 * AYNI güvenli hattın işidir (Kapı Kuralı, eylem sınıfı + yüzey izni, servis izin listesi, hız sınırı, tek POST). Bu modül HA'ya hiçbir
 * şey göndermez; yalnızca "ne yapılırsa geri alınır" planını kurar.
 *
 * Neler geri alınır (yalnız ZARARSIZ sınıf; yıkıcı eylem, düğme, script, iklim, medya hiç girmez):
 *  - ışık/priz/vantilatör/sanal anahtar aç-kapa: önceki açık/kapalı durum (ışık "aç" ile önceki parlaklık/renk cihazın kendi hafızasına bağlıdır)
 *  - ışık parlaklığı: önceki yüzde (ışık kapalıyken açıldıysa geri alma kapatır)
 *  - ışık rengi (sıcaklık ya da rgb): önceki renk (ışık kapalıyken açıldıysa geri alma kapatır)
 *  - vantilatör hızı: önceki yüzde
 *  - sahne: sahnenin üyelerinden aç-kapa yapılabilenlerin (ışık, priz, vantilatör, sanal anahtar; en çok 12) önceki durumu
 * Sürekli değerlerde (parlaklık, renk, hız) aynı varlık için kısa aralıkla (5 sn) gelen değişiklikler, araya başka bir eylem girmediyse
 * (yığının en üstündeki girdiyle) TEK girdide toplanır ve EN ESKİ görüntüyü korur: kaydırıcıyı sürüklemek tek bir geri alma adımıdır.
 */

const { alanAl } = require('./suzgec');

const EN_COK_GIRDI = 5;
const VARSAYILAN_SURE_MS = 10 * 60_000;
const EN_AZ_SURE_MS = 60_000;
const EN_COK_SURE_MS = 60 * 60_000;
const BIRLESTIRME_MS = 5_000;
const EN_COK_SAHNE_UYESI = 12;
const EN_COK_ADIM = 60; // bir girdinin (parti: oda kapatma) toplam geri yükleme adımı
const ACIK_KAPALI_ALANLARI = Object.freeze(['light', 'switch', 'fan', 'input_boolean']);
const SAHNE_UYE_ALANLARI = ACIK_KAPALI_ALANLARI;
/** Geri alınabilen eylemin kaynakları: kullanıcının kendi hareketleri. Gecikmeli eylem ve geri alma kendisi yığına girmez. */
const KAYNAKLAR = Object.freeze(['panel', 'palet', 'tepsi-menu', 'kisayol', 'komut-satiri', 'masaustu']);
/** Sürekli değer türleri: aynı varlıkta kısa aralıkla gelenler birleşir. */
const SUREKLI_TURLER = Object.freeze(['parlaklik', 'renk', 'hiz']);

const sonluSayi = (d) => (typeof d === 'number' && Number.isFinite(d) ? d : null);
const durumGecerliMi = (d) => d === 'on' || d === 'off';

/** 0..255 parlaklık -> 1..100 yüzde. */
function parlaklikYuzdesi(deger) {
  const b = sonluSayi(deger);
  if (b === null) return null;
  return Math.max(1, Math.min(100, Math.round((b / 255) * 100)));
}

/** Açık/kapalı geri yükleme adımı. */
function acKapaAdimi(hedef) {
  return { eylem: { servis: hedef === 'on' ? 'turn_on' : 'turn_off' } };
}

/** Önceki rengi geri yükleyen adım (renk sıcaklığı ya da rgb); önceki renk bilinmiyorsa null. */
function renkAdimi(oznitelikler) {
  const kelvin = sonluSayi(oznitelikler.color_temp_kelvin);
  // Sıcaklık kipinde kelvin bilinmiyorsa rgb'ye DÜŞÜLMEZ: HA bu kipte rgb_color'ı türetilmiş olarak da verir, geri alma beyaz ışığı RGB kipine geçirirdi.
  if (oznitelikler.color_mode === 'color_temp') return kelvin === null ? null : { eylem: { servis: 'turn_on', veri: { color_temp_kelvin: Math.round(kelvin) } } };
  const rgb = oznitelikler.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) return { eylem: { servis: 'turn_on', veri: { rgb_color: [...rgb] } } };
  return null;
}

/**
 * Bir eylem sonucundan geri alma planı kurar; geri alınacak bir şey yoksa null.
 * @param {object} bilgi
 * @param {string} bilgi.kimlik
 * @param {string} bilgi.ad
 * @param {{servis?: string, veri?: object, parlaklik?: number}} bilgi.istek eylemin kendisi (servis/veri/parlaklık)
 * @param {{ok: true, alan: string, servis: string, sinif: string, once?: {state: string, attributes: object}, yeni?: string}} bilgi.sonuc hat sonucu
 * @param {{kimlik: string, ad: string, durum: 'on'|'off', parlaklik?: number}[]} [bilgi.sahneUyeleri] sahne üyelerinin eylemden ÖNCEKİ durumu
 * @returns {{tur: 'ac-kapa'|'parlaklik'|'renk'|'hiz'|'sahne', adimlar: {kimlik: string, ad: string, eylem: object}[]}|null}
 */
function geriAlmaPlani({ kimlik, ad, istek = {}, sonuc, sahneUyeleri }) {
  if (!sonuc || sonuc.ok !== true || sonuc.sinif !== 'zararsiz') return null; // yalnız başarılı ve zararsız eylem
  const alan = typeof sonuc.alan === 'string' ? sonuc.alan : alanAl(kimlik);
  if (alan === 'scene') return sahnePlani(kimlik, ad, sahneUyeleri);
  if (!ACIK_KAPALI_ALANLARI.includes(alan)) return null;
  const once = sonuc.once;
  if (!once || !durumGecerliMi(once.state)) return null; // kullanılamıyor / bilinmiyor: geri yüklenecek bir durum yok
  const nitelikler = once.attributes && typeof once.attributes === 'object' ? once.attributes : {};
  const adim = (a) => ({ kimlik, ad, eylem: a.eylem });
  const servis = typeof istek.servis === 'string' ? istek.servis : sonuc.servis;

  // 1. ışık parlaklığı (brightness_pct yolu)
  if (istek.parlaklik !== undefined) {
    if (alan !== 'light') return null;
    if (once.state === 'off') return { tur: 'parlaklik', adimlar: [adim(acKapaAdimi('off'))] }; // parlaklık komutu ışığı açtı
    const yuzde = parlaklikYuzdesi(nitelikler.brightness);
    return yuzde === null ? null : { tur: 'parlaklik', adimlar: [adim({ eylem: { parlaklik: yuzde } })] };
  }
  // 2. ışık rengi
  if (alan === 'light' && servis === 'turn_on' && istek.veri && (istek.veri.color_temp_kelvin !== undefined || istek.veri.rgb_color !== undefined)) {
    if (once.state === 'off') return { tur: 'renk', adimlar: [adim(acKapaAdimi('off'))] };
    const renk = renkAdimi(nitelikler);
    return renk ? { tur: 'renk', adimlar: [adim(renk)] } : null;
  }
  // 3. vantilatör hızı
  if (alan === 'fan' && servis === 'set_percentage') {
    if (once.state === 'off') return { tur: 'hiz', adimlar: [adim(acKapaAdimi('off'))] };
    const yuzde = sonluSayi(nitelikler.percentage);
    return yuzde === null ? null : { tur: 'hiz', adimlar: [adim({ eylem: { servis: 'set_percentage', veri: { percentage: Math.max(0, Math.min(100, Math.round(yuzde))) } } })] };
  }
  // 4. aç/kapa (parametresiz toggle / turn_on / turn_off)
  if (istek.veri === undefined && (servis === 'toggle' || servis === 'turn_on' || servis === 'turn_off')) {
    const sonrasi = durumGecerliMi(sonuc.yeni) ? sonuc.yeni : servis === 'toggle' ? (once.state === 'on' ? 'off' : 'on') : servis === 'turn_on' ? 'on' : 'off';
    if (sonrasi === once.state) return null; // zaten o durumdaydı: geri alınacak bir değişiklik yok
    return { tur: 'ac-kapa', adimlar: [adim(acKapaAdimi(once.state))] };
  }
  return null;
}

/** Sahne: üyelerin önceki durumunu geri yükler. Üye listesi yoksa ya da boşsa geri alınacak bir şey yoktur. */
function sahnePlani(kimlik, ad, uyeler) {
  if (!Array.isArray(uyeler) || uyeler.length === 0) return null;
  const adimlar = [];
  for (const u of uyeler.slice(0, EN_COK_SAHNE_UYESI)) {
    if (!u || typeof u.kimlik !== 'string' || !SAHNE_UYE_ALANLARI.includes(alanAl(u.kimlik)) || !durumGecerliMi(u.durum)) continue;
    // Açıkken önceki parlaklık biliniyorsa TEK adım: parlaklık komutu ışığı o yüzdeyle açar (ışık "aç" ile cihaz hafızasına güvenmez, üye başına tek POST)
    const parlakli = u.durum === 'on' && alanAl(u.kimlik) === 'light' && Number.isInteger(u.parlaklik) && u.parlaklik >= 1 && u.parlaklik <= 100;
    const eylem = parlakli ? { parlaklik: u.parlaklik } : u.durum === 'on' ? { servis: 'turn_on' } : { servis: 'turn_off' };
    adimlar.push({ kimlik: u.kimlik, ad: typeof u.ad === 'string' ? u.ad : u.kimlik, eylem, uye: true });
  }
  return adimlar.length === 0 ? null : { tur: 'sahne', adimlar };
}

function sureyiKirp(ms) {
  const n = sonluSayi(ms);
  return n === null ? VARSAYILAN_SURE_MS : Math.max(EN_AZ_SURE_MS, Math.min(EN_COK_SURE_MS, Math.round(n)));
}

/**
 * Geri alma yığını: en çok 5 girdi, süre sınırlı, aynı varlığın sürekli değer değişiklikleri birleşik. Zaman `simdi()` ile, süre sınırı
 * `sureAl()` (ms) ile her kullanımda okunur (ayar canlı değişebilir).
 * @param {{simdi?: () => number, sureAl?: () => number, enCok?: number}} [secenek]
 */
function geriAlYiginiOlustur({ simdi = () => Date.now(), sureAl = () => VARSAYILAN_SURE_MS, enCok = EN_COK_GIRDI } = {}) {
  let girdiler = []; // en yeni sonda
  let sayac = 0;

  function sureDoldu() {
    const sinir = simdi() - sureyiKirp(sureAl());
    girdiler = girdiler.filter((g) => g.zaman > sinir);
  }

  return {
    /**
     * Plan bir girdi olarak yığına yazılır. Sürekli değerde (parlaklık, renk, hız) yığının EN ÜSTTEKİ girdisi aynı varlığın ve 5 sn içindeyse
     * onunla birleşir (EN ESKİ adımlar korunur, yalnız zaman yenilenir); arada başka bir eylem olduysa yeni girdi açılır, böylece geri alma
     * sırası (son eylem önce) bozulmaz. `parti` ({ id, ad }) verilirse aynı partinin adımları TEK girdide toplanır (oda kapatma: her cihazın
     * önceki durumu tek "geri al" olur); adım eklenen parti girdisi en üste taşınır. @returns {object|null} eklenen/birleşen girdi
     */
    ekle({ kimlik, ad, plan, kaynak, parti }) {
      sureDoldu();
      if (!plan || !Array.isArray(plan.adimlar) || plan.adimlar.length === 0) return null;
      const t = simdi();
      const adimlar = plan.adimlar.map((a) => ({ ...a, eylem: structuredClone(a.eylem) }));
      if (parti && typeof parti.id === 'string' && parti.id !== '') {
        const buParti = girdiler.find((g) => g.parti === parti.id);
        if (buParti) {
          // aynı cihaz iki kez geldiyse EN ESKİ önceki durum korunur
          const varOlan = new Set(buParti.adimlar.map((a) => `${a.kimlik}|${JSON.stringify(a.eylem)}`));
          for (const a of adimlar) if (buParti.adimlar.length < EN_COK_ADIM && !varOlan.has(`${a.kimlik}|${JSON.stringify(a.eylem)}`)) buParti.adimlar.push(a);
          buParti.zaman = t;
          sayac += 1; // en yeni dokunulan girdi en üste çıkar (geriKoy sırası id iledir)
          buParti.id = sayac;
          girdiler = [...girdiler.filter((g) => g !== buParti), buParti];
          return buParti;
        }
        sayac += 1;
        const girdi = { id: sayac, zaman: t, kimlik: parti.id, ad: typeof parti.ad === 'string' && parti.ad ? parti.ad : kimlik, tur: 'oda', adimlar: adimlar.slice(0, EN_COK_ADIM), kaynak, parti: parti.id };
        girdiler.push(girdi);
        if (girdiler.length > enCok) girdiler = girdiler.slice(-enCok);
        return girdi;
      }
      const son = girdiler.at(-1);
      if (son && son.kimlik === kimlik && SUREKLI_TURLER.includes(plan.tur) && son.tur === plan.tur && t - son.zaman <= BIRLESTIRME_MS) {
        son.zaman = t;
        return son;
      }
      sayac += 1;
      const girdi = { id: sayac, zaman: t, kimlik, ad: typeof ad === 'string' && ad ? ad : kimlik, tur: plan.tur, adimlar: adimlar.slice(0, EN_COK_ADIM), kaynak };
      girdiler.push(girdi);
      if (girdiler.length > enCok) girdiler = girdiler.slice(-enCok);
      return girdi;
    },
    /** Hiçbir adımı uygulanamayan (ağ yok gibi) girdiyi, süresi dolmadıysa yeniden yığına koyar (eski zamanıyla; sıra korunur). */
    geriKoy(girdi) {
      sureDoldu();
      if (!girdi || girdiler.some((g) => g.id === girdi.id)) return;
      if (simdi() - girdi.zaman >= sureyiKirp(sureAl())) return;
      girdiler.push(girdi);
      girdiler.sort((a, b) => a.id - b.id);
      if (girdiler.length > enCok) girdiler = girdiler.slice(-enCok);
    },
    /** En yeni (geçerli) girdi; yoksa null. */
    son() {
      sureDoldu();
      return girdiler.length > 0 ? girdiler[girdiler.length - 1] : null;
    },
    /** Girdiyi yığından çıkarır (geri alındı ya da artık geri alınamaz). */
    cikar(id) {
      girdiler = girdiler.filter((g) => g.id !== id);
    },
    /** Panel/tepsi için özet: { adet, ad, tur, bitis } — bitis: en yeni girdinin süresinin dolacağı an (ms); yoksa null. */
    ozet() {
      sureDoldu();
      if (girdiler.length === 0) return null;
      const son = girdiler[girdiler.length - 1];
      return { adet: girdiler.length, ad: son.ad, tur: son.tur, bitis: son.zaman + sureyiKirp(sureAl()) };
    },
    /** En yakın süre dolumu (ms, mutlak); girdi yoksa null. */
    enYakinBitis() {
      sureDoldu();
      if (girdiler.length === 0) return null;
      return Math.min(...girdiler.map((g) => g.zaman)) + sureyiKirp(sureAl());
    },
    temizle() {
      girdiler = [];
    },
    sayi() {
      sureDoldu();
      return girdiler.length;
    },
  };
}

module.exports = {
  EN_COK_GIRDI,
  VARSAYILAN_SURE_MS,
  EN_AZ_SURE_MS,
  EN_COK_SURE_MS,
  BIRLESTIRME_MS,
  EN_COK_SAHNE_UYESI,
  EN_COK_ADIM,
  SAHNE_UYE_ALANLARI,
  KAYNAKLAR,
  parlaklikYuzdesi,
  sureyiKirp,
  geriAlmaPlani,
  geriAlYiginiOlustur,
};
