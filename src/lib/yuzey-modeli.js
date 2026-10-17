'use strict';

/**
 * Hızlı panel ve komut paletinin (renderer) gördüğü karo modeli (saf) — gorunum-12, hiz-02, hiz-01.
 *
 * Renderer'a GİDEN şey yalnız bu modelin `rendererModeli` ile süzülmüş hâlidir: anahtar, adres ve HA'daki ad (`ad`) ASLA
 * gitmez. `ad` (HA'daki güncel ad; kapı süzgecinden geçmiş) yalnız ana süreçte kalır: komut satırı eşleşmesi için
 * karo listesinde durur, ekrana yazılan şey kullanıcının verdiği kısa `etiket`tir.
 * Süzgeçten (GÜVENLİK KURALI) ya da sınıflamadan (YASAK) geçmeyen favoriler modele hiç girmez; kayıtlı ad ve etiket de
 * ayrıca denetlenir.
 *
 * 1.4.0: karo olabilen alanlar src/lib/alan-kaydi.js karoAlaniMi'dir (iklim, medya, sensör...). Her karoya üç alan eklendi:
 *   ozellik          alan türüne göre GÜVENLİ öznitelik alt kümesi (src/lib/varlik-ozellik.js guvenliOzellikler; ham
 *                    attributes ve entity_picture ASLA gitmez; metinler kapı süzgecinden geçmiştir) ya da null
 *   varsayilanEylem  tek tıklama eylemi var mı (alan-kaydi varsayilanServis); false ise tepsi menüsü ve komut satırı karoyu
 *                    atlar, panel düz tıklamada servis göndermez (karo kendi denetimini çizer)
 *   onayliServisler  bu karoda onay (basılı tut / onay penceresi) isteyen servis adları (eylem-sinifi.js eylemSinifi(varlik,
 *                    favori, servis)); renderer basılı tutma ipucunu buna göre gösterir, karar yine ana süreçtedir
 * 1.4.0 düzen grubu: her karoya görünüm alanları (simge, renk, boyut; src/lib/karo-gorunum.js, o-31) ve tepsi (tepsiye sabitli mi, o-16) eklendi;
 *   model ayrıca `sayfalar` taşır (o-24): her sayfa { id, ad, kimlikler } — yalnız modelde karo olan (kapı kuralından geçmiş) varlıklar.
 * Renderer'a giden alanların tam listesi RENDERER_KARO_ALANLARI'dır; yeni alan ekleyen ajan oraya ve test/yuzey-modeli.test.js'e ekler.
 */

const { alanAl, adGuvenliMi, guvenliVarlikMi, guvenliMetin, kameraKimligiGuvenliMi, kameraAdiGuvenliMi } = require('./suzgec');
const { karoAlaniMi, varsayilanServis } = require('./alan-kaydi');
const { izinliServisler } = require('./servis-izinleri');
const { guvenliOzellikler } = require('./varlik-ozellik');
const { simgeDuzelt, renkDuzelt, boyutDuzelt, VARSAYILAN_BOYUT, grafikTuruDuzelt, gostergeAraligiDuzelt, VARSAYILAN_GRAFIK } = require('./karo-gorunum');
const { sayfalariModele } = require('./sayfalar');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { GRUPLAR, grupBul, altGrupBul, tekrarliMi } = require('./favoriler');
const { karoDurumu, aktifCikis } = require('./durum-deposu');
const { kisalt } = require('./metin');
const { TR } = require('./ceviri-varsayilan');
const { YENILEME_SECENEKLERI, EN_COK_KAMERA } = require('./kamera');
const { rendererEylem } = require('./eylem-modeli');

const ETIKET_SINIRI = 40;
/** 1.4.0 (o-50): bu alanlarda cihaz sınıfı yalnız HA'daki GÜNCEL öznitelikten bilinir; durum gelmeden karo hiç görünmez (perde sınıfı doğrulanamaz). */
const CANLI_GEREKLI_ALANLAR = new Set(['cover']);
/** Salt-okunur yardımcı varlıklar: canlı bağlantıda izlenir, eylem hattı bunlara eylem YAPMAZ. */
const MEDYA_CALIYOR_KIMLIGI = 'binary_sensor.pc_medya_caliyor';
const SES_CIKISI_KIMLIGI = 'sensor.pc_ses_default_device';
const YARDIMCI_VARLIKLAR = Object.freeze([MEDYA_CALIYOR_KIMLIGI, SES_CIKISI_KIMLIGI]);

function canliAd(varlik) {
  const ad = varlik?.attributes?.friendly_name;
  return typeof ad === 'string' && ad.trim() ? ad.trim() : '';
}

/**
 * Tek favoriden karo üretir; güvenli/izinli değilse null.
 * @param {object} favori ayardaki favori kaydı
 * @param {object|null|undefined} varlik depodaki durum (undefined: bilinmiyor, null: HA'da yok)
 * @param {Function} [t] çevirmen (src/lib/dil.js); grup etiketi o dilde yazılır, verilmezse Türkçe
 */
function karoOlustur(favori, varlik, t = TR) {
  const kimlik = favori?.entity_id;
  if (typeof kimlik !== 'string') return null;
  const alan = alanAl(kimlik);
  if (!karoAlaniMi(alan)) return null;
  const kayitliAd = typeof favori.ad === 'string' ? favori.ad : kimlik;
  if (!adGuvenliMi(kimlik, kayitliAd)) return null;
  if (favori.etiket !== undefined && !adGuvenliMi(kimlik, favori.etiket)) return null;
  const canli = varlik && typeof varlik === 'object' ? varlik : null;
  if (canli && !guvenliVarlikMi(canli)) return null; // HA'daki GÜNCEL ad/sınıf kapı oldu: karo hiç görünmez
  if (!canli && CANLI_GEREKLI_ALANLAR.has(alan)) return null;
  const siniflamaVarligi = canli ?? { entity_id: kimlik, attributes: { friendly_name: kayitliAd } };
  const siniflama = eylemSinifi(siniflamaVarligi, favori);
  if (siniflama.sinif === SINIF.YASAK) return null;
  const onayliServisler = izinliServisler(alan).filter((s) => eylemSinifi(siniflamaVarligi, favori, s).sinif === SINIF.YIKICI);
  const durum = karoDurumu(canli);
  const etiket = kisalt(favori.etiket || canliAd(canli) || kayitliAd, ETIKET_SINIRI);
  if (!adGuvenliMi(kimlik, etiket)) return null;
  const hamAd = kisalt(canliAd(canli) || kayitliAd, ETIKET_SINIRI);
  if (!adGuvenliMi(kimlik, hamAd)) return null;
  const grup = grupBul(kimlik);
  // Sensör favorisinin gösterge aralığı (kayıttan yeniden doğrulanır) sensörün kendi min/max özniteliğinden ÖNCE gelir.
  const ozellik = canli ? guvenliOzellikler(canli) : null;
  const gosterge = alan === 'sensor' && ozellik ? gostergeAraligiDuzelt(favori.gostergeMin, favori.gostergeMax) : null;
  if (gosterge) Object.assign(ozellik, { enAz: gosterge.gostergeMin, enCok: gosterge.gostergeMax });
  return {
    id: kimlik,
    ad: hamAd,
    etiket,
    grup,
    grupEtiketi: t.var?.(`grup.${grup}`) ? t(`grup.${grup}`) : '',
    altGrup: altGrupBul(kimlik),
    alan,
    durum: durum.durum,
    yuzde: durum.yuzde,
    kullanilabilir: !!canli && canli.state !== 'unavailable',
    ulasilamiyor: canli?.state === 'unavailable', // 'bilinmiyor' (henüz durum yok) ile karışmasın
    sinif: siniflama.sinif === SINIF.YIKICI ? 'yikici' : 'zararsiz',
    parlaklikKontrol: favori.parlaklik === true && alan === 'light',
    tekrar: tekrarliMi(kimlik),
    ozellik,
    varsayilanEylem: varsayilanServis(alan) !== null,
    onayliServisler,
    // 1.4.0 düzen (o-31, o-16): görünüm alanları kayıttan yeniden doğrulanır; geçersiz değer karoda yok sayılır
    simge: simgeDuzelt(favori.simge) || null,
    renk: renkDuzelt(favori.renk) || null,
    boyut: boyutDuzelt(favori.boyut) ?? VARSAYILAN_BOYUT,
    tepsi: favori.tepsi === true,
    grafikTuru: alan === 'sensor' ? grafikTuruDuzelt(favori.grafikTuru) || VARSAYILAN_GRAFIK : VARSAYILAN_GRAFIK, // 1.4.0 sensör: 'otomatik' | 'cizgi' | 'gosterge' | 'yok'
  };
}

/**
 * Karoları sabit grup sırasında toplar (Işık, Sahne, PC, Medya, Diğer, Onaylı). Onay isteyen (yıkıcı) karolar kendi
 * grubundan çıkarılıp EN ALTA, "Onaylı" satırına alınır (g-07): sık kullanılan hoparlör/kulaklık ve ses düğmeleri ilk
 * ekranda kalır, nadir kullanılan PC kapat / İyi geceler altta durur. Boş gruplar atlanır; grup içi sıra favori sırasıdır.
 * @returns {{ kod: string, etiket: string, karolar: object[] }[]}
 */
function karolariGrupla(karolar, t = TR) {
  // 1.4.0: tek tıklama eylemi olmayan karo (seçici, sayı, zamanlayıcı...) kendi kartında servis başına basılı tutmayla onay ister;
  // "Onaylı" satırına taşınmaz, kendi grubunda (Yardımcılar...) kalır.
  const onayliMi = (k) => k.sinif === 'yikici' && k.varsayilanEylem !== false;
  const onayli = karolar.filter(onayliMi);
  const sonuc = [];
  for (const g of GRUPLAR) {
    const uyeler = karolar.filter((k) => k.grup === g.kod && !onayliMi(k));
    if (uyeler.length > 0) sonuc.push({ kod: g.kod, etiket: t(`grup.${g.kod}`), karolar: uyeler });
  }
  if (onayli.length > 0) sonuc.push({ kod: 'onayli', etiket: t('grup.onayli'), karolar: onayli });
  return sonuc;
}

/**
 * Favorilerden süzülmüş karolar, FAVORİ SIRASINDA (grup sırası değil). Tepsi menüsünün "ilk 8 favori" listesi bunu kullanır:
 * kullanıcı Ayarlar'da favori sırasını değiştirince üst düzey de değişir. Güvenlik kuralı (karoOlustur) burada da uygulanır.
 * @param {object[]} favoriler ayardaki favoriler
 * @param {(kimlik:string)=>object|null|undefined} durumAl depo okuyucu
 * @param {Function} [t] çevirmen (verilmezse Türkçe)
 * @returns {object[]}
 */
function karolariOlustur(favoriler, durumAl, t = TR) {
  const karolar = [];
  for (const favori of Array.isArray(favoriler) ? favoriler : []) {
    const karo = karoOlustur(favori, durumAl(favori?.entity_id), t);
    if (karo) karolar.push(karo);
  }
  return karolar;
}

/**
 * @param {object} girdi
 * @param {object[]} girdi.favoriler ayardaki favoriler
 * @param {(kimlik:string)=>object|null|undefined} girdi.durumAl depo okuyucu
 * @param {string[]} [girdi.sonKimlikler] 'Son' listesi (zaten uygun olanlar; burada yine karolarla kesiştirilir)
 * @param {{baglanti?:string, canli?:boolean, hata?:string|null, uyari?:string|null, anahtarYok?:boolean}} [girdi.baglanti]
 *   uyari: yetki kesici açıkken kısa metin (panelin başlık altı şeridinde görünür); anahtarYok: erişim anahtarı hiç eklenmemiş
 *   (panel/palet boş durumunda "anahtar yok" ile "favori yok" ayrılır)
 * @param {Function} [girdi.t] çevirmen (grup etiketleri o dilde yazılır; verilmezse Türkçe)
 * @param {object[]} [girdi.sayfalar] ayardaki sayfalar (src/lib/sayfalar.js); modele yalnız karo olan varlıklarla girer
 * @param {{ogeler?: object[], sayi?: number, gizlenen?: number}|null} [girdi.bildirim] 1.4.0 bildirim merkezi modeli (src/lib/bildirim-akisi.js
 *   model()): panelin bildirim şeridi. Renderer'a rendererBildirim ile süzülmüş (alan beyaz listesi + metin süzgeci) hâliyle gider.
 * @param {{liste?: {id:string, etiket:string, kullanilabilir:boolean}[], bulanik?: boolean, yenilemeSn?: number}|null} [girdi.kamera] 1.4.0 kamera
 *   bölümü (o-48; src/lib/kamera.js kameraModeli + ayarlar): yalnız Ayarlar'da onaylı kameralar. Görüntü modelde YOKTUR (yuzey:kamera ile ayrıca çekilir).
 * @returns {{ gruplar: object[], sonlar: object[], sayfalar: {id:string, ad:string, kimlikler:string[]}[], ust: {canli:boolean, baglanti:string, medyaCaliyor:boolean|null, aktifCikis:string|null, hata:string|null, uyari:string|null, anahtarYok:boolean}, bildirim: object|null }}
 */
function yuzeyModeliOlustur({ favoriler, durumAl, sonKimlikler = [], baglanti = {}, t = TR, sayfalar = [], bildirim = null, kamera = null }) {
  const karolar = karolariOlustur(favoriler, durumAl, t);
  const gruplar = karolariGrupla(karolar, t);
  const harita = new Map(karolar.map((k) => [k.id, k]));
  const sonlar = [];
  for (const kimlik of sonKimlikler) {
    const karo = harita.get(kimlik);
    if (karo && karo.sinif === 'zararsiz' && karo.kullanilabilir) sonlar.push(karo);
  }
  const medya = durumAl(MEDYA_CALIYOR_KIMLIGI);
  const cikis = durumAl(SES_CIKISI_KIMLIGI);
  return {
    gruplar,
    sonlar,
    sayfalar: sayfalariModele(sayfalar, new Set(harita.keys()), (n) => t('sayfa.adsiz', { n })),
    ust: {
      canli: baglanti.canli === true,
      baglanti: typeof baglanti.baglanti === 'string' ? baglanti.baglanti : 'kapali',
      medyaCaliyor: medya && (medya.state === 'on' || medya.state === 'off') ? medya.state === 'on' : null,
      aktifCikis: cikis && typeof cikis.state === 'string' ? aktifCikis(cikis.state) : null,
      hata: typeof baglanti.hata === 'string' ? kisalt(baglanti.hata, 100) : null,
      uyari: typeof baglanti.uyari === 'string' && baglanti.uyari ? kisalt(baglanti.uyari, 100) : null,
      anahtarYok: baglanti.anahtarYok === true,
    },
    bildirim,
    kamera,
  };
}

/** Renderer'a giden karoda bulunabilecek alanların TAM listesi (beyaz liste); `ad` (HA'daki ad) bunda yoktur. */
const RENDERER_KARO_ALANLARI = Object.freeze([
  'id',
  'etiket',
  'grup',
  'grupEtiketi',
  'altGrup',
  'alan',
  'durum',
  'yuzde',
  'kullanilabilir',
  'ulasilamiyor',
  'sinif',
  'parlaklikKontrol',
  'tekrar',
  'ozellik', // 1.4.0: güvenli öznitelik alt kümesi (varlik-ozellik.js)
  'varsayilanEylem', // 1.4.0
  'onayliServisler', // 1.4.0
  'simge', // 1.4.0 düzen: 'ikon:<ad>' ya da emoji (karo-gorunum.js; renderer yine doğrular)
  'renk', // 1.4.0 düzen: hazır palet adı ya da null
  'boyut', // 1.4.0 düzen: 'kucuk' | 'normal' | 'genis' | 'buyuk'
  'tepsi', // 1.4.0 düzen: tepsiye sabitli mi (bağlam menüsü "Tepsiden kaldır" metni için)
  'grafikTuru', // 1.4.0 sensör: grafik biçimi (gösterge aralığı ayrı alan değil, ozellik.enAz / enCok içine işlenir)
]);

/**
 * Kamera bölümünü IPC yüküne çevirir: yalnız { liste: [{id, etiket, kullanilabilir}], bulanik, yenilemeSn }. Kimlik ve ad kamera süzgecinden
 * (kapı/zil/giriş adı elenir) bir kez daha geçer; bulanık varsayılan açıktır (yalnız açıkça false ise kapalı). Liste boşsa null (bölüm hiç görünmez).
 * @returns {{liste: {id:string, etiket:string, kullanilabilir:boolean}[], bulanik: boolean, yenilemeSn: number}|null}
 */
function rendererKamera(kamera) {
  if (!kamera || typeof kamera !== 'object' || !Array.isArray(kamera.liste)) return null;
  const liste = [];
  for (const k of kamera.liste) {
    if (liste.length >= EN_COK_KAMERA) break;
    if (!k || typeof k !== 'object' || !kameraKimligiGuvenliMi(k.id)) continue;
    const etiket = kisalt(typeof k.etiket === 'string' && k.etiket.trim() ? k.etiket.trim() : k.id, ETIKET_SINIRI);
    if (!kameraAdiGuvenliMi(k.id, etiket) || liste.some((o) => o.id === k.id)) continue;
    liste.push({ id: k.id, etiket, kullanilabilir: k.kullanilabilir === true });
  }
  if (liste.length === 0) return null;
  return {
    liste,
    bulanik: kamera.bulanik !== false,
    yenilemeSn: YENILEME_SECENEKLERI.includes(kamera.yenilemeSn) ? kamera.yenilemeSn : 0,
  };
}

/** Renderer'a giden bildirim öğesinde bulunabilecek alanların TAM listesi (HA bildirim kimliği ve varlık kimliği YOK; anahtar opaktır). */
const RENDERER_BILDIRIM_ALANLARI = Object.freeze(['anahtar', 'kaynak', 'baslik', 'metin', 'zaman', 'simge']);
const BILDIRIM_KAYNAKLARI = Object.freeze(['uyari', 'ha', 'pil', 'guncelleme']);
const EN_COK_BILDIRIM = 30;

/**
 * Bildirim merkezi modelini IPC yüküne çevirir: yalnız RENDERER_BILDIRIM_ALANLARI, en çok EN_COK_BILDIRIM öğe. Kapı Kuralı'nın son
 * savunması: başlığı ya da metni süzgeçten geçmeyen öğe ayrıca düşer ve "N gizlendi" sayısına eklenir (kaynak zaten süzmüştür).
 * Model yoksa ya da geçersizse null (panel şeridi hiç görünmez).
 * @returns {{ogeler: object[], sayi: number, gizlenen: number}|null}
 */
function rendererBildirim(bildirim) {
  if (!bildirim || typeof bildirim !== 'object' || !Array.isArray(bildirim.ogeler)) return null;
  const ogeler = [];
  let gizlenen = Number.isInteger(bildirim.gizlenen) && bildirim.gizlenen > 0 ? Math.min(bildirim.gizlenen, 999) : 0;
  let dusen = 0; // modelde sayılıp burada elenen öğeler (toplam sayıdan da çıkar)
  for (const o of bildirim.ogeler.slice(0, EN_COK_BILDIRIM)) {
    if (!o || typeof o !== 'object' || typeof o.anahtar !== 'string' || !BILDIRIM_KAYNAKLARI.includes(o.kaynak)) {
      dusen += 1;
      continue;
    }
    const metin = guvenliMetin(o.metin, 200);
    const baslik = guvenliMetin(o.baslik, 80);
    if (!metin || !baslik) {
      gizlenen += 1;
      dusen += 1;
      continue;
    }
    ogeler.push({
      anahtar: o.anahtar.slice(0, 40),
      kaynak: o.kaynak,
      baslik,
      metin,
      zaman: Number.isFinite(o.zaman) && o.zaman > 0 ? o.zaman : 0,
      simge: typeof o.simge === 'string' ? Array.from(o.simge).slice(0, 4).join('') : '',
    });
  }
  const toplam = Number.isInteger(bildirim.sayi) && bildirim.sayi >= 0 ? Math.min(bildirim.sayi, 9999) : ogeler.length + dusen;
  const sayi = Math.max(ogeler.length, toplam - dusen);
  return { ogeler, sayi, gizlenen };
}

/** Tek karoyu renderer'a giden beyaz liste hâline çevirir (bilgi-modeli.js de şerit/kart karoları için kullanır). */
function rendererKaro(karo) {
  const sonuc = {};
  for (const alan of RENDERER_KARO_ALANLARI) {
    const deger = karo?.[alan];
    sonuc[alan] = deger !== null && typeof deger === 'object' ? structuredClone(deger) : deger; // ana süreç nesnesiyle paylaşılmasın
  }
  return sonuc;
}

const ODA_GRUBU_KODU = /^oda-[0-9a-f]{8}$/;

/**
 * Ana süreçteki modeli IPC yüküne çevirir (h-15): her karoda yalnız RENDERER_KARO_ALANLARI kalır. HA'daki ad (`ad`) ve ileride
 * karoya eklenecek ana-süreç alanları panele gitmez. Girdi değiştirilmez.
 * @param {{gruplar?: object[], sonlar?: object[], ust?: object}} model yuzeyModeliOlustur sonucu
 */
function rendererModeli(model) {
  const dizi = (d) => (Array.isArray(d) ? d : []);
  return {
    // 1.4.0 eylem grubu (o-14): oda grubu (`oda: true`, kod `oda-<8 onaltılık>`) başlığında "Odayı kapat" düğmesi çıkar; başka grup bu işareti taşımaz
    gruplar: dizi(model?.gruplar).map((g) => ({ kod: g.kod, etiket: g.etiket, karolar: dizi(g.karolar).map(rendererKaro), ...(g.oda === true && ODA_GRUBU_KODU.test(g.kod) ? { oda: true } : {}) })),
    sonlar: dizi(model?.sonlar).map(rendererKaro),
    sayfalar: dizi(model?.sayfalar).map((s) => ({ id: s.id, ad: s.ad, kimlikler: dizi(s.kimlikler).filter((k) => typeof k === 'string') })),
    ust: model?.ust ?? {},
    // 1.4.0 bilgi kartları (o-04, o-07, o-08, o-10): kendi beyaz listesinden geçer (bilgi-modeli.js rendererBilgi). İşlev içinde
    // yüklenir: bilgi-modeli.js bu dosyadan karoOlustur/rendererKaro alır (döngüsel yükleme olmasın).
    bilgi: model?.bilgi ? require('./bilgi-modeli').rendererBilgi(model.bilgi) : null,
    bildirim: rendererBildirim(model?.bildirim),
    kamera: rendererKamera(model?.kamera),
    // 1.4.0 eylem grubu (o-12 geri al...): eylem-modeli.js beyaz listesinden geçer
    eylem: rendererEylem(model?.eylem),
  };
}

module.exports = {
  MEDYA_CALIYOR_KIMLIGI,
  SES_CIKISI_KIMLIGI,
  YARDIMCI_VARLIKLAR,
  karoOlustur,
  karolariOlustur,
  karolariGrupla,
  yuzeyModeliOlustur,
  RENDERER_KARO_ALANLARI,
  rendererKaro,
  RENDERER_BILDIRIM_ALANLARI,
  rendererBildirim,
  rendererKamera,
  rendererModeli,
};
