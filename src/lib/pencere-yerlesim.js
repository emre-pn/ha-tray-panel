'use strict';

/**
 * Ana pencerenin boyutu ve konumu (saf; Electron'a bağlı değildir).
 * İki boyut modu: 'hizli' (870 pikselin altı: HA kendiliğinden dar düzene geçer) ve 'genis'.
 * Tüm ölçüler Electron'un DIP (ölçekten bağımsız) birimindedir; workArea görev çubuğu hariç alandır.
 */

const PENCERE_BOYUTLARI = ['hizli', 'genis'];
const VARSAYILAN_PENCERE_BOYUTU = 'hizli';
const VARSAYILAN_BOYUTLAR = {
  hizli: { width: 560, height: 780 },
  genis: { width: 1280, height: 820 },
};
const EN_AZ_BOYUT = { width: 360, height: 300 };
const EN_COK_DEGER = 100_000;
const KENAR = 24;
const HEDEF_TOLERANSI = 2; // DIP; karma DPI yuvarlamasını "kullanıcı yeniden boyutlamadı" saymak için

const sayi = (d) => Number.isFinite(d) && Math.abs(d) < EN_COK_DEGER;

/**
 * Ayar dosyasından gelen boyutu temizler; geçersizse null. `maximized` yalnız 'genis' için tutulur.
 * @param {{width:number,height:number,maximized?:boolean}|null} p
 */
function pencereBoyutuDuzelt(p, { maximized = false } = {}) {
  if (!p || typeof p !== 'object') return null;
  if (!sayi(p.width) || !sayi(p.height)) return null;
  if (p.width < EN_AZ_BOYUT.width || p.height < EN_AZ_BOYUT.height) return null;
  const sonuc = { width: Math.round(p.width), height: Math.round(p.height) };
  if (maximized) sonuc.maximized = p.maximized === true;
  return sonuc;
}

/** Çalışma alanına sığan varsayılan boyut (kenarlarda 24+24 piksel boşluk bırakır). */
function varsayilanBoyut(mod, workArea) {
  const temel = VARSAYILAN_BOYUTLAR[mod] ?? VARSAYILAN_BOYUTLAR[VARSAYILAN_PENCERE_BOYUTU];
  return {
    width: Math.max(1, Math.min(temel.width, Math.round(workArea.width) - 2 * KENAR)),
    height: Math.max(1, Math.min(temel.height, Math.round(workArea.height) - 2 * KENAR)),
  };
}

/**
 * Boyutu çalışma alanından kenar boşluğu kadar kısıp çalışma alanında ortalar.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function ortala(workArea, boyut, kenar = KENAR) {
  const width = Math.max(1, Math.min(Math.round(boyut.width), Math.round(workArea.width) - 2 * kenar));
  const height = Math.max(1, Math.min(Math.round(boyut.height), Math.round(workArea.height) - 2 * kenar));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/**
 * Pencere durumu kaydında HANGİ modun yuvasına NE yazılacağı.
 *
 * - Yuva, fiziksel pencerenin boyutunu taşıyan moddur (fizikselMod), ayardaki etkin mod değil: mod pencere
 *   gizliyken değiştirilebilir ve pencere bir sonraki gösterime kadar eski modun boyutunda kalır; o boyutu yeni
 *   modun yuvasına yazmak kullanıcının kayıtlı boyutunu ezerdi.
 * - Pencere son yerleştirmedeki hedef boyutunda kaldıysa (kullanıcı yeniden boyutlamadıysa) kayıtlı boyut
 *   ezilmez: ortala() boyutu küçük çalışma alanına kısmış olabilir, bu kısılmış değer kullanıcının tercihi değildir.
 *   Yine de 'genis' için büyütülmüş durumu kaydedilir.
 *
 * @param {object} p
 * @param {string} p.fizikselMod pencerenin şu anki boyutunun ait olduğu mod ('hizli' | 'genis')
 * @param {{width:number,height:number}} p.normalSinirlar getNormalBounds() (büyütülmüş/simge durumunda bile normal boyut)
 * @param {boolean} p.buyutulmus pencere şu an büyütülmüş mü
 * @param {{mod:string,width:number,height:number}|null} p.hedef son pencereyiYerlestir hedefi
 * @param {Record<string, {width:number,height:number,maximized?:boolean}>} p.mevcut ayardaki kayıtlı boyutlar
 * @returns {{yuva:string, kayit:{width:number,height:number,maximized?:boolean}}|null}
 */
function pencereKaydiHesapla({ fizikselMod, normalSinirlar, buyutulmus, hedef, mevcut }) {
  if (!PENCERE_BOYUTLARI.includes(fizikselMod)) return null;
  const kayit = pencereBoyutuDuzelt({ width: normalSinirlar?.width, height: normalSinirlar?.height });
  if (!kayit) return null;
  const eski = pencereBoyutuDuzelt(mevcut?.[fizikselMod]);
  const hedefteKaldi =
    !!hedef &&
    hedef.mod === fizikselMod &&
    Math.abs(kayit.width - hedef.width) <= HEDEF_TOLERANSI &&
    Math.abs(kayit.height - hedef.height) <= HEDEF_TOLERANSI;
  if (hedefteKaldi && eski) {
    kayit.width = eski.width;
    kayit.height = eski.height;
  }
  if (fizikselMod === 'genis') kayit.maximized = buyutulmus === true;
  return { yuva: fizikselMod, kayit };
}

const sinirlarGecerli = (s) =>
  !!s && [s.x, s.y, s.width, s.height].every((n) => Number.isFinite(n)) && s.width > 0 && s.height > 0;

function kesisir(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Köşe bildirimi (hiz-04): imleç monitörünün çalışma alanının SAĞ ALT köşesi, küçük odaksız pencere.
const KOSE_BOYUTU = { width: 320, height: 56 };
const KOSE_MARJI = 16;
const KOSE_ENGEL_BOSLUGU = 8; // bildirim açık panelin/paletin hemen üstüne ya da yanına bu kadar boşlukla konur

/**
 * Köşe bildiriminin konumu: çalışma alanının sağ alt köşesi, `marj` boşlukla. Çalışma alanı pencereden
 * küçükse sol üst köşeye yaslanır (pencere alan dışına taşmaz).
 *
 * `engel` (g-09): şu an açık olan hızlı panel/palet penceresinin sınırları. Varsayılan konum onunla kesişiyorsa (panel de tepsi
 * simgesinin yanında, yani sağ alt köşede açılır) bildirim panelin ÜSTÜNE taşınır; üstte yer yoksa panelin soluna; ikisine de
 * sığmıyorsa varsayılan konumda kalır (bildirim her zaman görünür olmalı). Kesişmiyorsa konum değişmez.
 * @param {{x:number,y:number,width:number,height:number}|null} [engel]
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function koseKonumu(workArea, boyut = KOSE_BOYUTU, marj = KOSE_MARJI, engel = null) {
  const width = Math.round(boyut.width);
  const height = Math.round(boyut.height);
  const x = Math.round(workArea.x + workArea.width) - width - marj;
  const y = Math.round(workArea.y + workArea.height) - height - marj;
  const temel = { x: Math.max(Math.round(workArea.x), x), y: Math.max(Math.round(workArea.y), y), width, height };
  if (!sinirlarGecerli(engel) || !kesisir(temel, engel)) return temel;
  const ustY = Math.round(engel.y) - height - KOSE_ENGEL_BOSLUGU;
  if (ustY >= Math.round(workArea.y)) return { ...temel, y: ustY };
  const solX = Math.round(engel.x) - width - KOSE_ENGEL_BOSLUGU;
  if (solX >= Math.round(workArea.x)) return { ...temel, x: solX };
  return temel;
}

// Hızlı panel ve komut paleti (hiz-01, hiz-02): küçük çerçevesiz pencereler.
const PANEL_BOYUTU = { width: 360, height: 420 };
const PALET_BOYUTU = { width: 560, height: 96 };
const YUZEY_YUKSEKLIK_SINIRI = { en_az: 120, en_cok: 640 };
const YUZEY_KENAR_BOSLUGU = 8;

const kisit = (deger, en_az, en_cok) => Math.round(Math.min(Math.max(deger, en_az), Math.max(en_az, en_cok)));

/**
 * Tepsi simgesinin yanında açılan panelin sol üst konumu (hiz-02). Görev çubuğunun hangi kenarda olduğu simgenin
 * ekrandaki en yakın kenarından anlaşılır (görev çubuğu gizliyken de çalışır). Sınırlar geçersizse (sıfır boyut, hiçbir
 * ekranla kesişmiyor) ÇALIŞMA ALANININ SAĞ ALT köşesine yedek konum verilir. Sonuç çalışma alanı içinde kalır.
 * @param {{x:number,y:number,width:number,height:number}|null} tepsiSinirlari Tray#getBounds() ya da click olayının sınırları
 * @param {{x:number,y:number,width:number,height:number}} workArea simgenin bulunduğu ekranın çalışma alanı
 * @param {{width:number,height:number}} boyut panel boyutu
 * @param {number} [bosluk]
 * @param {{x:number,y:number,width:number,height:number}|null} [ekranSinirlari] ekranın tüm alanı (görev çubuğu dahil)
 * @returns {{x:number,y:number}}
 */
function panelKonumu(tepsiSinirlari, workArea, boyut, bosluk = 8, ekranSinirlari = null) {
  const kenar = YUZEY_KENAR_BOSLUGU;
  const x0 = workArea.x + kenar;
  const x1 = workArea.x + workArea.width - boyut.width - kenar;
  const y0 = workArea.y + kenar;
  const y1 = workArea.y + workArea.height - boyut.height - kenar;
  const gecerli = sinirlarGecerli(tepsiSinirlari) && (!ekranSinirlari || kesisir(tepsiSinirlari, ekranSinirlari));
  if (!gecerli) return { x: kisit(workArea.x + workArea.width - boyut.width - 12, x0, x1), y: kisit(workArea.y + workArea.height - boyut.height - 12, y0, y1) };

  const alan = ekranSinirlari && sinirlarGecerli(ekranSinirlari) ? ekranSinirlari : workArea;
  const mx = tepsiSinirlari.x + tepsiSinirlari.width / 2;
  const my = tepsiSinirlari.y + tepsiSinirlari.height / 2;
  const uzakliklar = {
    sol: mx - alan.x,
    sag: alan.x + alan.width - mx,
    ust: my - alan.y,
    alt: alan.y + alan.height - my,
  };
  const enYakin = Object.entries(uzakliklar).sort((a, b) => a[1] - b[1])[0][0];
  let x;
  let y;
  if (enYakin === 'sol') {
    x = tepsiSinirlari.x + tepsiSinirlari.width + bosluk;
    y = my - boyut.height / 2;
  } else if (enYakin === 'sag') {
    x = tepsiSinirlari.x - boyut.width - bosluk;
    y = my - boyut.height / 2;
  } else {
    x = mx - boyut.width / 2;
    y = enYakin === 'ust' ? tepsiSinirlari.y + tepsiSinirlari.height + bosluk : tepsiSinirlari.y - boyut.height - bosluk;
  }
  return { x: kisit(x, x0, x1), y: kisit(y, y0, y1) };
}

/** Komut paletinin sol üst konumu: çalışma alanında yatayda ortalı, üstten ~%18 aşağıda; alttan taşmaz. */
function paletKonumu(workArea, boyut = PALET_BOYUTU, oran = 0.18) {
  const kenar = YUZEY_KENAR_BOSLUGU;
  const x = workArea.x + (workArea.width - boyut.width) / 2;
  const y = workArea.y + workArea.height * oran;
  return {
    x: kisit(x, workArea.x + kenar, workArea.x + workArea.width - boyut.width - kenar),
    y: kisit(y, workArea.y + kenar, workArea.y + workArea.height - boyut.height - kenar),
  };
}

/**
 * Renderer'ın istediği yüksekliği (tam sayı, 120..640) çalışma alanına da sığacak biçimde kırpar; geçersizse null.
 * `olcek` (g-13, yakınlaştırma): yükseklik pencere birimidir (DIP); en çok sınırı da aynı oranda büyür (640 * olcek), çalışma
 * alanı sınırı değişmez.
 */
function yuzeyYuksekligiKirp(yukseklik, workArea = null, olcek = 1) {
  if (!Number.isFinite(yukseklik)) return null;
  const enCok = YUZEY_YUKSEKLIK_SINIRI.en_cok * (Number.isFinite(olcek) && olcek > 1 ? olcek : 1);
  const tavan = workArea ? Math.min(enCok, Math.round(workArea.height) - 2 * YUZEY_KENAR_BOSLUGU) : enCok;
  return kisit(yukseklik, YUZEY_YUKSEKLIK_SINIRI.en_az, tavan);
}

// Panel ve palette yakınlaştırma (g-13): Ctrl + / Ctrl − / Ctrl 0. Yazılar 11-13 piksel; yalnız BÜYÜTME adımları vardır
// (1 = varsayılan). Ana pencerenin Ctrl + / Ctrl − davranışıyla aynı tuşlar.
const YAKINLASTIRMA_ADIMLARI = Object.freeze([1, 1.15, 1.3, 1.5, 1.75, 2]);

/**
 * Basılan tuşun yakınlaştırma karşılığı: 'artir' | 'azalt' | 'sifirla' | null. Yalnız Ctrl (Alt/Meta yok) ve tuş aşağı;
 * "+" Türkçe Q klavyede Shift ile üretilir, bu yüzden Shift'e bakılmaz. `girdi`: Electron before-input-event girdisi.
 */
function yakinlastirmaTusu(girdi) {
  if (!girdi || girdi.type !== 'keyDown' || girdi.control !== true || girdi.alt === true || girdi.meta === true) return null;
  switch (girdi.key) {
    case '+':
    case '=':
    case 'Add':
      return 'artir';
    case '-':
    case '_':
    case 'Subtract':
      return 'azalt';
    case '0':
      return 'sifirla';
    default:
      return null;
  }
}

/** Geçerli yakınlaştırmaya adımı uygular; sonuç YAKINLASTIRMA_ADIMLARI içindedir (bilinmeyen değer 1 sayılır). */
function yakinlastirmaDegeri(mevcut, adim) {
  if (adim === 'sifirla') return 1;
  let sira = YAKINLASTIRMA_ADIMLARI.indexOf(mevcut);
  if (sira < 0) sira = 0;
  if (adim === 'artir') sira = Math.min(YAKINLASTIRMA_ADIMLARI.length - 1, sira + 1);
  else if (adim === 'azalt') sira = Math.max(0, sira - 1);
  return YAKINLASTIRMA_ADIMLARI[sira];
}

/**
 * Yakınlaştırılmış pencerenin boyutu (DIP): genişlik taban genişlik * ölçek (çalışma alanından 2 * kenar boşluğu taşmaz),
 * yükseklik CSS yüksekliği * ölçek (yuzeyYuksekligiKirp ile kırpılır). Ölçek 1 iken eski davranışla aynıdır.
 * @param {{width:number}} taban kipin taban boyutu (PANEL_BOYUTU | PALET_BOYUTU)
 * @param {number} cssYukseklik renderer'ın bildirdiği içerik yüksekliği (CSS pikseli)
 */
function yuzeyBoyutu(taban, cssYukseklik, olcek, workArea) {
  const o = YAKINLASTIRMA_ADIMLARI.includes(olcek) ? olcek : 1;
  const genislik = Math.round(taban.width * o);
  const hedefYukseklik = Math.round(cssYukseklik * o);
  return {
    width: workArea ? Math.max(1, Math.min(genislik, Math.round(workArea.width) - 2 * YUZEY_KENAR_BOSLUGU)) : genislik,
    height: yuzeyYuksekligiKirp(hedefYukseklik, workArea, o) ?? hedefYukseklik,
  };
}

// ---------------------------------------------------------------------------
// 1.4.0 (o-32): pencere konumu kaydı, tercih edilen ekran, "ekrana taşı" ve panel opaklığı (saf).
// ---------------------------------------------------------------------------

const KONUM_MODLARI = Object.freeze(['imlec', 'hatirla']);
const VARSAYILAN_KONUM_MODU = 'imlec';
const OPAKLIK_SINIRI = Object.freeze({ en_az: 50, en_cok: 100 });
const EKRAN_GORUNUR_PAYI = 64; // DIP: kayıtlı konumdaki pencerenin bir ekranın çalışma alanına en az bu kadar (en/boy) girmesi gerekir
const EN_COK_EKRAN_SAYISI = 16;

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
const tamSayiMi = (d, enAz, enCok) => Number.isInteger(d) && d >= enAz && d <= enCok;

/** Kayıtlı pencere konumunu doğrular: { x, y } (tam sayı, çok büyük değil) ya da null. Negatif değer (sol/üst monitör) geçerlidir. */
function konumDuzelt(ham) {
  if (!duzNesneMi(ham) || !sayi(ham.x) || !sayi(ham.y)) return null;
  return { x: Math.round(ham.x), y: Math.round(ham.y) };
}

/** Boyut moduna göre kayıtlı konumlar { hizli?: {x,y}, genis?: {x,y} }; geçersiz yuva atılır, bilinmeyen anahtar düşer. */
function konumlariDuzelt(ham) {
  const sonuc = {};
  if (!duzNesneMi(ham)) return sonuc;
  for (const mod of PENCERE_BOYUTLARI) {
    const konum = konumDuzelt(ham[mod]);
    if (konum) sonuc[mod] = konum;
  }
  return sonuc;
}

/**
 * Tercih edilen ekran kaydı: yok = {} ; var = { id, x, y, genislik, yukseklik } (ekranın kimliği ve sınırları; kimlik değişirse
 * aynı yerdeki aynı çözünürlüklü ekran eşleşsin diye sınırlar da saklanır). Biçimi bozuk ise undefined (ayar alanı reddeder).
 */
function tercihEkranDuzelt(ham) {
  if (!duzNesneMi(ham)) return undefined;
  if (Object.keys(ham).length === 0 || ham.id === undefined) return {};
  if (!tamSayiMi(ham.id, 0, Number.MAX_SAFE_INTEGER)) return undefined;
  if (!sayi(ham.x) || !sayi(ham.y) || !tamSayiMi(ham.genislik, 1, EN_COK_DEGER) || !tamSayiMi(ham.yukseklik, 1, EN_COK_DEGER)) return undefined;
  return { id: ham.id, x: Math.round(ham.x), y: Math.round(ham.y), genislik: ham.genislik, yukseklik: ham.yukseklik };
}

/**
 * Electron Display listesini sade ekran özetlerine çevirir: { id, sinirlar, calismaAlani, birincil }. Sınırı bozuk ekran atılır.
 * Sıra: birincil ekran önce, sonra soldan sağa, yukarıdan aşağıya (etiketlerdeki "Ekran N" sırası). En çok 16 ekran.
 * @param {object[]} ekranlar screen.getAllDisplays()
 * @param {number|null} [birincilId] screen.getPrimaryDisplay().id
 */
function ekranlariOzetle(ekranlar, birincilId = null) {
  const liste = [];
  for (const e of Array.isArray(ekranlar) ? ekranlar : []) {
    if (!e || !sinirlarGecerli(e.bounds) || !Number.isInteger(e.id) || e.id < 0) continue;
    const calisma = sinirlarGecerli(e.workArea) ? e.workArea : e.bounds;
    liste.push({
      id: e.id,
      sinirlar: { x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height },
      calismaAlani: { x: calisma.x, y: calisma.y, width: calisma.width, height: calisma.height },
      birincil: e.id === birincilId,
    });
  }
  liste.sort((a, b) => Number(b.birincil) - Number(a.birincil) || a.sinirlar.x - b.sinirlar.x || a.sinirlar.y - b.sinirlar.y || a.id - b.id);
  return liste.slice(0, EN_COK_EKRAN_SAYISI);
}

/** Bir ekran özetinden tercih kaydı (ayara yazılan biçim). */
function tercihKaydiOlustur(ekran) {
  return { id: ekran.id, x: ekran.sinirlar.x, y: ekran.sinirlar.y, genislik: ekran.sinirlar.width, yukseklik: ekran.sinirlar.height };
}

/**
 * Tercih edilen ekranı bağlı ekranlar arasında bulur: önce kimlik; kimlik değişmişse aynı konumda aynı boyutta olan ekran.
 * Bulunamazsa (ekran sökülmüş) null: pencere imlecin ekranına düşer.
 */
function tercihEkranBul(ekranlar, tercih) {
  if (!Array.isArray(ekranlar) || !duzNesneMi(tercih) || tercih.id === undefined) return null;
  const kimlikle = ekranlar.find((e) => e.id === tercih.id);
  if (kimlikle) return kimlikle;
  return (
    ekranlar.find(
      (e) => e.sinirlar.x === tercih.x && e.sinirlar.y === tercih.y && e.sinirlar.width === tercih.genislik && e.sinirlar.height === tercih.yukseklik,
    ) ?? null
  );
}

/** İki dikdörtgenin kesişim alanı (px²); kesişmiyorsa 0. */
function kesisimAlani(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Dikdörtgenle çalışma alanı en çok kesişen ekran; hiçbiriyle kesişmiyorsa null. */
function enCokKesisenEkran(ekranlar, dikdortgen) {
  let en = null;
  let enAlan = 0;
  for (const ekran of ekranlar) {
    const alan = kesisimAlani(dikdortgen, ekran.calismaAlani);
    if (alan > enAlan) {
      en = ekran;
      enAlan = alan;
    }
  }
  return en;
}

/** Dikdörtgeni çalışma alanına sığdırır: alandan büyükse küçültür, taşıyorsa kaydırır (kenar boşluğu bırakmaz). */
function alanaSigdir(dikdortgen, alan) {
  const width = Math.max(1, Math.min(Math.round(dikdortgen.width), Math.round(alan.width)));
  const height = Math.max(1, Math.min(Math.round(dikdortgen.height), Math.round(alan.height)));
  const x = Math.min(Math.max(Math.round(dikdortgen.x), Math.round(alan.x)), Math.round(alan.x + alan.width) - width);
  const y = Math.min(Math.max(Math.round(dikdortgen.y), Math.round(alan.y)), Math.round(alan.y + alan.height) - height);
  return { x, y, width, height };
}

/** Dikdörtgen bir ekranın çalışma alanında yeterince görünür mü (ekran sökülmüşse ya da çözünürlük düşmüşse görünmez)? */
function yeterinceGorunurMu(dikdortgen, ekran) {
  const alan = ekran.calismaAlani;
  const w = Math.min(dikdortgen.x + dikdortgen.width, alan.x + alan.width) - Math.max(dikdortgen.x, alan.x);
  const h = Math.min(dikdortgen.y + dikdortgen.height, alan.y + alan.height) - Math.max(dikdortgen.y, alan.y);
  return w >= Math.min(EKRAN_GORUNUR_PAYI, dikdortgen.width) && h >= Math.min(EKRAN_GORUNUR_PAYI, dikdortgen.height);
}

/**
 * Ana pencerenin gösterimdeki hedef sınırları (saf). Karar sırası:
 *  1. Konum "hatırla" ise ve bu moda ait kayıtlı konum bir ekranda yeterince görünüyorsa (tercih edilen bir ekran varsa kayıt o
 *     ekrandaysa): kayıtlı konum, çalışma alanına sığdırılarak kullanılır ('kayit').
 *  2. Tercih edilen ekran bağlıysa: o ekranın çalışma alanında ortalanır ('tercih').
 *  3. Aksi halde (varsayılan, ya da ekran sökülmüş): imlecin bulunduğu ekranın çalışma alanında ortalanır ('imlec').
 * Ekran sökülünce kayıt silinmez; ekran geri gelince kayıtlı konum yeniden geçerli olur.
 * @param {object} g
 * @param {{width:number,height:number}} g.boyut kayıtlı boyut (pencere[mod])
 * @param {'imlec'|'hatirla'} [g.konumModu]
 * @param {{x:number,y:number}|null} [g.konum] bu boyut modunun kayıtlı konumu
 * @param {object|null} [g.tercihEkran] tercihEkranBul sonucu (bağlı ekran özeti) ya da null
 * @param {object[]} [g.ekranlar] bağlı ekran özetleri (ekranlariOzetle)
 * @param {{x:number,y:number,width:number,height:number}} g.imlecAlani imlecin (ya da mevcut pencerenin) ekranının çalışma alanı
 * @returns {{x:number,y:number,width:number,height:number,kaynak:'kayit'|'tercih'|'imlec'}}
 */
function anaPencereHedefi({ boyut, konumModu = VARSAYILAN_KONUM_MODU, konum = null, tercihEkran = null, ekranlar = [], imlecAlani }) {
  if (konumModu === 'hatirla' && konumDuzelt(konum)) {
    const aday = { x: konum.x, y: konum.y, width: Math.round(boyut.width), height: Math.round(boyut.height) };
    const ekran = enCokKesisenEkran(ekranlar, aday);
    if (ekran && yeterinceGorunurMu(aday, ekran) && (!tercihEkran || tercihEkran.id === ekran.id)) {
      return { ...alanaSigdir(aday, ekran.calismaAlani), kaynak: 'kayit' };
    }
  }
  if (tercihEkran) return { ...ortala(tercihEkran.calismaAlani, boyut), kaynak: 'tercih' };
  return { ...ortala(imlecAlani, boyut), kaynak: 'imlec' };
}

/**
 * Pencere taşındığında kayıtlı konumlar nasıl güncellenir (saf)? Yalnız konum modu "hatırla" iken; fiziksel pencerenin modunun
 * yuvasına yazılır. Pencere son yerleştirme hedefinde kaldıysa (kullanıcı taşımadı) ya da konum aynıysa değişiklik yoktur (null):
 * ekran sökülüp pencere ortalanmışken eski kayıt ezilmez.
 * @returns {{hizli?:{x:number,y:number},genis?:{x:number,y:number}}|null} yeni kayıt ya da null
 */
function pencereKonumKaydiHesapla({ konumModu, fizikselMod, normalSinirlar, hedef = null, mevcut = {} }) {
  if (konumModu !== 'hatirla' || !PENCERE_BOYUTLARI.includes(fizikselMod)) return null;
  const konum = konumDuzelt({ x: normalSinirlar?.x, y: normalSinirlar?.y });
  if (!konum) return null;
  const hedefteKaldi =
    !!hedef &&
    hedef.mod === fizikselMod &&
    Number.isFinite(hedef.x) &&
    Number.isFinite(hedef.y) &&
    Math.abs(konum.x - hedef.x) <= HEDEF_TOLERANSI &&
    Math.abs(konum.y - hedef.y) <= HEDEF_TOLERANSI;
  if (hedefteKaldi) return null;
  const kayitlar = konumlariDuzelt(mevcut);
  const eski = kayitlar[fizikselMod];
  if (eski && eski.x === konum.x && eski.y === konum.y) return null;
  return { ...kayitlar, [fizikselMod]: konum };
}

/** Panel opaklığı (yüzde, 50-100) -> pencere opaklığı oranı (0,5-1); geçersiz değer tam opak (1). */
function opaklikOrani(yuzde) {
  if (!Number.isFinite(yuzde)) return 1;
  const y = Math.round(yuzde);
  if (y < OPAKLIK_SINIRI.en_az || y > OPAKLIK_SINIRI.en_cok) return 1;
  return y / 100;
}

module.exports = {
  PANEL_BOYUTU,
  PALET_BOYUTU,
  YUZEY_YUKSEKLIK_SINIRI,
  panelKonumu,
  paletKonumu,
  yuzeyYuksekligiKirp,
  YAKINLASTIRMA_ADIMLARI,
  yakinlastirmaTusu,
  yakinlastirmaDegeri,
  yuzeyBoyutu,
  KOSE_BOYUTU,
  KOSE_MARJI,
  koseKonumu,
  PENCERE_BOYUTLARI,
  VARSAYILAN_PENCERE_BOYUTU,
  VARSAYILAN_BOYUTLAR,
  EN_AZ_BOYUT,
  KENAR,
  pencereBoyutuDuzelt,
  varsayilanBoyut,
  ortala,
  pencereKaydiHesapla,
  KONUM_MODLARI,
  VARSAYILAN_KONUM_MODU,
  OPAKLIK_SINIRI,
  EKRAN_GORUNUR_PAYI,
  konumDuzelt,
  konumlariDuzelt,
  tercihEkranDuzelt,
  ekranlariOzetle,
  tercihKaydiOlustur,
  tercihEkranBul,
  enCokKesisenEkran,
  alanaSigdir,
  yeterinceGorunurMu,
  anaPencereHedefi,
  pencereKonumKaydiHesapla,
  opaklikOrani,
};
