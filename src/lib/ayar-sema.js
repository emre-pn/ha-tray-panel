'use strict';

/**
 * Ayar dosyasının şeması, düzeltilmesi ve eski sürümlerden göçü (saf).
 *
 * Şema sürümleri
 *  1  ilk sürüm: pencere = { x, y, width, height, maximized } (tek boyut, konum hatırlanıyordu)
 *  2  pencere = { hizli:{width,height}, genis:{width,height,maximized} }, pencereBoyutu, odakKaybindaGizle,
 *     anaPanoyaDonDk, yakinlastirma, engellenenFavoriler. Konum artık saklanmaz (imleç monitöründe açılır).
 *  3  koseBildirimi, bipSesi (hiz-04) ve favori başına onay (hata-04): mevcut düğme/script favorileri, zorunlu
 *     onaylı olmayanlar için onay:false ile yazılır (bugünkü davranış DEĞİŞMEZ); zorunlu olanlar onay ister.
 *  4  canliBaglanti, paletKisayol, tepsiSolTik, hazirListeSurumu, panolar (Dalga 3) ve favori başına etiket/kisayol/parlaklik:
 *     mevcut favoriler etiketini (hazır listedekiler) ve LED şeridin parlaklık kontrolünü göçle alır; hiçbiri silinmez.
 *  5  Görünüm (Dalga 4): temaZorla ('koyu' | 'sistem'), vurguRengi ('' | '#rrggbb'), yeniPencereMalzemesi ('acrylic' | 'mica' | 'yok').
 *     Yalnız yeni alanlar eklenir; kullanıcının mevcut değerlerine ve favorilerine dokunulmaz.
 *  6  1.4.0: yeni alanlar src/lib/ayar-alanlari.js tablosundan (AYAR_ALANLARI) gelir; her özellik grubu kendi satırını oraya ekler,
 *     bu dosyaya alan eklenmez. Göçler ayar-alanlari.js GOCLER'dedir (v6 göçü: yalnız varsayılanlar eklenir). Favori kaydı
 *     1.4.0 alanlarını (iklim, medya, sensör...) kabul eder (alan-kaydi.js karoAlaniMi); 1.3.0 favorileri aynen kalır.
 *
 * Kullanıcı verisi göçle korunur: hiçbir favori sessizce silinmez (atilanlar ile bildirilir).
 *
 * Şema sürümü güvenilirliği (h-33): eski göçler (v3: düğme/script favorilerinde onayı kapatma) yalnız GERÇEKTEN eski dosyada
 * uygulanır. semaSurumu alanı varsa ama pozitif tamsayı değilse (elle düzenleme, bozulma) ya da hiç yokken dosyada sonraki
 * şemaların alanları görülüyorsa sürüm belirsizdir: eski göçler çalışmaz (güncel sayılır) ve durum bildirilir.
 * Kendinden YENİ şemalı dosya (h-11, eski sürüme dönüş): bilinmeyen üst düzey alanlar olduğu gibi korunur.
 */

const { adresNormallestir, tamsayi, VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { VARSAYILAN_KISAYOL, VARSAYILAN_PALET_KISAYOLU, kisayolGecerliMi, kisayolNormallestir } = require('./kisayol');
const { HAZIR_LISTE_SURUMU, favorileriDuzelt, hazirEtiketleriniTamamla } = require('./favoriler');
const { panolariDuzelt } = require('./panolar');
const { eylemSinifi, SINIF } = require('./eylem-sinifi');
const { alanAl } = require('./suzgec');
const {
  PENCERE_BOYUTLARI,
  VARSAYILAN_PENCERE_BOYUTU,
  VARSAYILAN_BOYUTLAR,
  pencereBoyutuDuzelt,
} = require('./pencere-yerlesim');
const { yakinlastirmaDuzelt } = require('./tus-eylemi');
const { malzemeDuzelt } = require('./malzeme');
const { temaDuzelt, vurguRengiDuzelt } = require('./gorunum');
const { dilAyariDuzelt } = require('./dil');
const { AYAR_ALANLARI, alanlariDuzelt, alanTipleri, gocleriUygula } = require('./ayar-alanlari');

const SEMA_SURUMU = 6;
const TEPSI_SOL_TIK_DEGERLERI = ['panel', 'pencere'];
const ONAY_GOC_ALANLARI = new Set(['button', 'input_button', 'script']); // varsayılan onaylı alanlar (eylem-sinifi)
const EN_COK_ENGELLENEN = 20;
// Şema 2 ve sonrasında eklenen alanlar: semaSurumu yokken bunlardan biri varsa dosya 1.0.0'dan kalma değildir.
// (tepsiIpucuGosterildi ve httpUyarisiAdresi bilerek yok: ilki 1.0.0'da da vardı, ikincisi şema artırmadan eklendi.)
const SONRAKI_SEMA_ALANLARI = [
  'pencereBoyutu', 'odakKaybindaGizle', 'anaPanoyaDonDk', 'yakinlastirma', 'engellenenFavoriler', // 2
  'koseBildirimi', 'bipSesi', // 3
  'canliBaglanti', 'paletKisayol', 'tepsiSolTik', 'hazirListeSurumu', 'panolar', // 4
  'temaZorla', 'vurguRengi', 'yeniPencereMalzemesi', // 5
  ...AYAR_ALANLARI.map((a) => a.ad), // 6+ (ayar-alanlari.js)
];
// Tip denetimi (h-33): bu alanlar uygulama tarafından hep aynı tipte yazılır; başka tipte gelirse sessizce varsayılana dönmez,
// sıfırlananlar listesiyle bildirilir. kisayol ve paletKisayol kendi notlarıyla bildirilir (burada yok).
const ALAN_TIPLERI = {
  yerelAdres: 'metin', disAdres: 'metin', tepsiSolTik: 'metin', dil: 'metin', pencereBoyutu: 'metin', temaZorla: 'metin', vurguRengi: 'metin', yeniPencereMalzemesi: 'metin',
  canliBaglanti: 'mantiksal', otomatikBaslat: 'mantiksal', odakKaybindaGizle: 'mantiksal', koseBildirimi: 'mantiksal', bipSesi: 'mantiksal', tepsiIpucuGosterildi: 'mantiksal',
  yerelZamanAsimiMs: 'sayi', disZamanAsimiMs: 'sayi', yenidenDenemeSn: 'sayi', anaPanoyaDonDk: 'sayi', yakinlastirma: 'sayi', hazirListeSurumu: 'sayi',
  favoriler: 'dizi', panolar: 'dizi', engellenenFavoriler: 'dizi',
  pencere: 'nesne',
  ...alanTipleri(), // 6+ (ayar-alanlari.js)
};
const TIP_DENETIMLERI = {
  metin: (d) => typeof d === 'string',
  mantiksal: (d) => typeof d === 'boolean',
  sayi: (d) => (typeof d === 'number' && Number.isFinite(d)) || (typeof d === 'string' && d.trim() !== '' && Number.isFinite(Number(d))),
  dizi: (d) => Array.isArray(d),
  nesne: (d) => !!d && typeof d === 'object' && !Array.isArray(d),
};
const KORUNMAYAN_ANAHTARLAR = new Set(['__proto__', 'constructor', 'prototype']);

const duzNesne = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : {});
// null, boş metin ve boolean sayıya (0, 1) dönüşüp geçerli sayılmasın.
const sayisal = (d) => (typeof d === 'number' || (typeof d === 'string' && d.trim() !== '') ? d : NaN);

/**
 * Ham ayar nesnesinde kayıtlı şema sürümü. 1.0.0 dosyalarında alan yoktur ya da tamsayı değildir: 1 sayılır.
 * @param {unknown} ham ayarlar.json içeriği
 */
function oncekiSemaSurumu(ham) {
  const g = duzNesne(ham);
  return Number.isInteger(g.semaSurumu) ? g.semaSurumu : 1;
}

/** semaSurumu alanı var ama kullanılamaz mı (pozitif tamsayı değil)? Alan hiç yoksa false (1.0.0 dosyası olabilir). */
function semaSurumuBozukMu(ham) {
  const g = duzNesne(ham);
  return g.semaSurumu !== undefined && !(Number.isInteger(g.semaSurumu) && g.semaSurumu >= 1);
}

/**
 * Göç kararlarında kullanılan GÜVENİLİR sürüm (h-33): geçerli tamsayı ise kendisi; alan hiç yoksa ve sonraki şemaların alanları da
 * yoksa gerçek 1.0.0 dosyasıdır (1); aksi halde (bozuk ya da silinmiş sürüm alanı) belirsizdir ve güncel sayılır: eski göçler
 * çalışmaz, böylece düğme/script favorilerinde onay yanlışlıkla kapanmaz.
 * @param {unknown} ham ayarlar.json içeriği
 */
function gocSurumu(ham) {
  const g = duzNesne(ham);
  if (Number.isInteger(g.semaSurumu) && g.semaSurumu >= 1) return g.semaSurumu;
  if (g.semaSurumu === undefined && !SONRAKI_SEMA_ALANLARI.some((alan) => Object.hasOwn(g, alan))) return 1;
  return SEMA_SURUMU;
}

/** Dosyanın şeması bu uygulamanınkinden YENİ mi (h-11)? Yalnız geçerli bir tamsayı sürümle; bozuk alan "yeni" sayılmaz. */
function yeniSemaMi(ham) {
  const g = duzNesne(ham);
  return Number.isInteger(g.semaSurumu) && g.semaSurumu > SEMA_SURUMU;
}

/**
 * Dosya göçle (yeni biçimiyle) yeniden yazılacak mı: kayıtlı şema sürümü güncelden KÜÇÜKSE.
 * İçi boş nesne göç sayılmaz (kullanıcıdan kalan bir şey yok); 'sema-gocu' notuyla aynı kural.
 * @param {unknown} ham ayarlar.json içeriği
 */
function gocGerekliMi(ham) {
  const g = duzNesne(ham);
  return Object.keys(g).length > 0 && oncekiSemaSurumu(g) < SEMA_SURUMU;
}

/** Süzgeçten çıkarılan favorilerin kısa kaydı (ayrıntı gösterimi için; eylem listesi DEĞİLDİR). */
function engellenenleriDuzelt(liste) {
  if (!Array.isArray(liste)) return [];
  const sonuc = [];
  for (const oge of liste) {
    const kimlik = oge?.entity_id;
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) continue;
    const neden = typeof oge.neden === 'string' ? oge.neden.slice(0, 40) : 'bilinmiyor';
    sonuc.push({ entity_id: kimlik, neden });
  }
  return sonuc;
}

/**
 * @param {unknown} ham ayarlar.json içeriği (ya da null)
 * @param {{varsayilan?: object}} secenekler varsayilan-ayarlar.json içeriği
 * @returns {{ ayarlar: object, notlar: string[], atilanlar: {entity_id:string, neden:string}[], onayIstenenler: string[],
 *   sifirlananlar: string[], bilinmeyenAlanlar: string[] }}
 *   notlar: 'kisayol-varsayilana-donduruldu' | 'palet-kisayol-varsayilana-donduruldu' | 'pencere-v1-tasindi' | 'sema-gocu' | 'favori-onay-gerekli'
 *     | 'sema-surumu-bozuk' | 'sema-daha-yeni' | 'alan-tipi-hatali'
 *   onayIstenenler: göç sonrası zorunlu onaylı olduğu için artık onay isteyen mevcut favorilerin kimlikleri
 *   sifirlananlar: tipi bozuk olduğu için varsayılana dönen alanların adları ('alan-tipi-hatali' notuyla birlikte)
 *   bilinmeyenAlanlar: daha yeni şemalı dosyadan olduğu gibi taşınan bilinmeyen üst düzey alanların adları
 */
function ayarlariDuzelt(ham, { varsayilan } = {}) {
  const v = duzNesne(varsayilan);
  const g = duzNesne(ham);
  const notlar = [];
  const oncekiSurum = gocSurumu(g);
  if (Object.keys(g).length > 0 && oncekiSurum < SEMA_SURUMU) notlar.push('sema-gocu');
  if (semaSurumuBozukMu(g)) notlar.push('sema-surumu-bozuk');
  const yeniSema = yeniSemaMi(g);
  if (yeniSema) notlar.push('sema-daha-yeni');
  // Tipi bozuk alanlar (h-33): varsayılana dönerler ama sessizce değil.
  const sifirlananlar = Object.entries(ALAN_TIPLERI)
    .filter(([alan, tip]) => g[alan] !== undefined && !TIP_DENETIMLERI[tip](g[alan]))
    .map(([alan]) => alan);
  if (semaSurumuBozukMu(g)) sifirlananlar.unshift('semaSurumu');
  if (sifirlananlar.length > 0) notlar.push('alan-tipi-hatali');

  const disHam = g.disAdres === '' ? '' : g.disAdres ?? v.disAdres;

  let kisayol = VARSAYILAN_KISAYOL;
  if (kisayolGecerliMi(g.kisayol)) {
    kisayol = kisayolNormallestir(g.kisayol);
  } else if (g.kisayol !== undefined) {
    notlar.push('kisayol-varsayilana-donduruldu');
  } else if (kisayolGecerliMi(v.kisayol)) {
    kisayol = kisayolNormallestir(v.kisayol);
  }

  // Palet kısayolu: '' = kapalı; geçersiz kayıt varsayılana döner (bildirilir).
  let paletKisayol = VARSAYILAN_PALET_KISAYOLU;
  if (g.paletKisayol === '') {
    paletKisayol = '';
  } else if (kisayolGecerliMi(g.paletKisayol)) {
    paletKisayol = kisayolNormallestir(g.paletKisayol);
  } else if (g.paletKisayol !== undefined) {
    notlar.push('palet-kisayol-varsayilana-donduruldu');
  } else if (v.paletKisayol === '') {
    paletKisayol = '';
  } else if (kisayolGecerliMi(v.paletKisayol)) {
    paletKisayol = kisayolNormallestir(v.paletKisayol);
  }

  // Pencere: eski biçim (x, y, width, height) 'genis' boyuta taşınır; konum düşer.
  const eskiPencere = duzNesne(g.pencere);
  const vPencere = duzNesne(v.pencere);
  let hizliHam;
  let genisHam;
  if (eskiPencere.width !== undefined || eskiPencere.height !== undefined) {
    genisHam = eskiPencere;
    hizliHam = vPencere.hizli;
    notlar.push('pencere-v1-tasindi');
  } else {
    hizliHam = eskiPencere.hizli ?? vPencere.hizli;
    genisHam = eskiPencere.genis ?? vPencere.genis;
  }
  const pencere = {
    hizli: pencereBoyutuDuzelt(hizliHam) ?? { ...VARSAYILAN_BOYUTLAR.hizli },
    genis: pencereBoyutuDuzelt(genisHam, { maximized: true }) ?? { ...VARSAYILAN_BOYUTLAR.genis, maximized: false },
  };

  const pencereBoyutu = PENCERE_BOYUTLARI.includes(g.pencereBoyutu)
    ? g.pencereBoyutu
    : PENCERE_BOYUTLARI.includes(v.pencereBoyutu)
      ? v.pencereBoyutu
      : VARSAYILAN_PENCERE_BOYUTU;

  const duzeltilen = favorileriDuzelt(g.favoriler ?? v.favoriler);
  const { atilanlar } = duzeltilen;
  // v4 göçü: hazır listedeki mevcut favoriler etiketini (ve LED şerit parlaklık kontrolünü) alır; idempotent, hiçbiri silinmez.
  const favoriler = oncekiSurum < 4 ? hazirEtiketleriniTamamla(duzeltilen.favoriler) : duzeltilen.favoriler;
  const { panolar } = panolariDuzelt(g.panolar ?? v.panolar);

  // v3 göçü: zorunlu onaylı OLMAYAN mevcut düğme/script favorileri açıkça onaysız işaretlenir (bugünkü davranış
  // korunur); zorunlu olanlar (PC kapat, PowerShell...) onay ister ve bu bildirilir. Hiçbiri silinmez.
  const onayIstenenler = [];
  if (oncekiSurum < 3) {
    for (const f of favoriler) {
      if (typeof f.onay === 'boolean' || !ONAY_GOC_ALANLARI.has(alanAl(f.entity_id))) continue;
      const s = eylemSinifi({ entity_id: f.entity_id, attributes: { friendly_name: f.ad } }, {});
      if (s.sinif === SINIF.YIKICI && s.zorunlu) onayIstenenler.push(f.entity_id);
      else f.onay = false;
    }
    if (onayIstenenler.length > 0) notlar.push('favori-onay-gerekli');
  }

  // Önceki engellenenler + bu yüklemede elenenler (kimlik başına en yeni), en çok 20.
  const yeniEngellenenler = atilanlar
    .filter((a) => a.neden !== 'tekrar' && VARLIK_KIMLIGI_DESENI.test(a.entity_id))
    .map(({ entity_id, neden }) => ({ entity_id, neden }));
  const engellenenFavoriler = [];
  for (const oge of [...engellenenleriDuzelt(g.engellenenFavoriler), ...yeniEngellenenler]) {
    const onceki = engellenenFavoriler.findIndex((e) => e.entity_id === oge.entity_id);
    if (onceki >= 0) engellenenFavoriler.splice(onceki, 1);
    engellenenFavoriler.push(oge);
  }

  const ayarlar = {
    semaSurumu: Math.max(oncekiSurum, SEMA_SURUMU),
    yerelAdres: adresNormallestir(g.yerelAdres) ?? adresNormallestir(v.yerelAdres) ?? '',
    disAdres: disHam === '' ? '' : adresNormallestir(disHam, true) ?? adresNormallestir(v.disAdres, true) ?? '',
    yerelZamanAsimiMs: tamsayi(g.yerelZamanAsimiMs, 500, 30_000, tamsayi(v.yerelZamanAsimiMs, 500, 30_000, 3000)),
    disZamanAsimiMs: tamsayi(g.disZamanAsimiMs, 1000, 60_000, tamsayi(v.disZamanAsimiMs, 1000, 60_000, 10_000)),
    yenidenDenemeSn: tamsayi(g.yenidenDenemeSn, 5, 3600, tamsayi(v.yenidenDenemeSn, 5, 3600, 30)),
    kisayol,
    paletKisayol,
    tepsiSolTik: TEPSI_SOL_TIK_DEGERLERI.includes(g.tepsiSolTik) ? g.tepsiSolTik : TEPSI_SOL_TIK_DEGERLERI.includes(v.tepsiSolTik) ? v.tepsiSolTik : 'panel',
    canliBaglanti: typeof g.canliBaglanti === 'boolean' ? g.canliBaglanti : v.canliBaglanti !== false,
    otomatikBaslat: typeof g.otomatikBaslat === 'boolean' ? g.otomatikBaslat : v.otomatikBaslat !== false,
    pencereBoyutu,
    pencere,
    odakKaybindaGizle: typeof g.odakKaybindaGizle === 'boolean' ? g.odakKaybindaGizle : v.odakKaybindaGizle !== false,
    koseBildirimi: typeof g.koseBildirimi === 'boolean' ? g.koseBildirimi : v.koseBildirimi !== false,
    bipSesi: typeof g.bipSesi === 'boolean' ? g.bipSesi : v.bipSesi === true,
    anaPanoyaDonDk: tamsayi(sayisal(g.anaPanoyaDonDk), 0, 1440, tamsayi(sayisal(v.anaPanoyaDonDk), 0, 1440, 5)),
    yakinlastirma: yakinlastirmaDuzelt(g.yakinlastirma ?? v.yakinlastirma),
    temaZorla: temaDuzelt(g.temaZorla, temaDuzelt(v.temaZorla)),
    vurguRengi: vurguRengiDuzelt(g.vurguRengi) ?? vurguRengiDuzelt(v.vurguRengi) ?? '', // geçersiz renk sistem rengine döner
    yeniPencereMalzemesi: malzemeDuzelt(g.yeniPencereMalzemesi, malzemeDuzelt(v.yeniPencereMalzemesi)),
    dil: dilAyariDuzelt(g.dil, dilAyariDuzelt(v.dil)), // arayüz dili: 'sistem' | 'tr' | 'en' | 'de' | 'fr' | 'es' (şema sürümü artmadan eklendi; eksik/geçersiz -> varsayılan 'sistem')
    favoriler,
    panolar,
    // Daha yeni bir sürümün hazır liste sürümü (bizimkinden büyük) düşürülmez: geri dönünce silinen karolar yeniden eklenmesin (h-11).
    hazirListeSurumu: yeniSema && Number.isInteger(g.hazirListeSurumu) && g.hazirListeSurumu > HAZIR_LISTE_SURUMU
      ? g.hazirListeSurumu
      : tamsayi(sayisal(g.hazirListeSurumu), 0, HAZIR_LISTE_SURUMU, 0),
    engellenenFavoriler: engellenenFavoriler.slice(-EN_COK_ENGELLENEN),
    tepsiIpucuGosterildi: g.tepsiIpucuGosterildi === true,
    httpUyarisiAdresi: adresNormallestir(g.httpUyarisiAdresi) ?? '', // http uyarısı bildirimi hangi ev içi adres için gösterildi
    ...alanlariDuzelt(g, v), // şema 6+: ayar-alanlari.js tablosundaki alanlar (geçersiz değer varsayılana döner)
  };
  gocleriUygula(ayarlar, g, oncekiSurum, notlar); // şema 6+ göçleri (ayar-alanlari.js GOCLER)
  // Daha yeni şemadan gelen dosya: bilinmeyen üst düzey alanlar olduğu gibi taşınır (eski sürüm yazınca silinmesin; h-11).
  const bilinmeyenAlanlar = [];
  if (yeniSema) {
    for (const anahtar of Object.keys(g)) {
      if (Object.hasOwn(ayarlar, anahtar) || KORUNMAYAN_ANAHTARLAR.has(anahtar)) continue;
      ayarlar[anahtar] = structuredClone(g[anahtar]); // girdiyle paylaşılmasın
      bilinmeyenAlanlar.push(anahtar);
    }
  }
  return { ayarlar, notlar, atilanlar, onayIstenenler, sifirlananlar, bilinmeyenAlanlar };
}

module.exports = {
  SEMA_SURUMU,
  EN_COK_ENGELLENEN,
  TEPSI_SOL_TIK_DEGERLERI,
  ayarlariDuzelt,
  oncekiSemaSurumu,
  gocSurumu,
  gocGerekliMi,
  semaSurumuBozukMu,
  yeniSemaMi,
};
