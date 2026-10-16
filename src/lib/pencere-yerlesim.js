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

/**
 * Geçerli yakınlaştırmaya adımı uygular; sonuç YAKINLASTIRMA_ADIMLARI içindedir (bilinmeyen değer 1 sayılır).
 * `taban` (o-25): Ayarlar > Görünüm > Metin boyutu; "sıfırla" (Ctrl 0) buna döner (geçersizse 1). Ctrl − tabanın altına da inebilir.
 */
function yakinlastirmaDegeri(mevcut, adim, taban = 1) {
  if (adim === 'sifirla') return YAKINLASTIRMA_ADIMLARI.includes(taban) ? taban : 1;
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
};
