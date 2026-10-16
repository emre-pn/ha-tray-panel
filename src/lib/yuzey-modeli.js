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
 * Renderer'a giden alanların tam listesi RENDERER_KARO_ALANLARI'dır; yeni alan ekleyen ajan oraya ve test/yuzey-modeli.test.js'e ekler.
 */

const { alanAl, adGuvenliMi, guvenliVarlikMi } = require('./suzgec');
const { karoAlaniMi, varsayilanServis } = require('./alan-kaydi');
const { izinliServisler } = require('./servis-izinleri');
const { guvenliOzellikler } = require('./varlik-ozellik');
const { SINIF, eylemSinifi } = require('./eylem-sinifi');
const { GRUPLAR, grupBul, altGrupBul, tekrarliMi } = require('./favoriler');
const { karoDurumu, aktifCikis } = require('./durum-deposu');
const { kisalt } = require('./metin');
const { TR } = require('./ceviri-varsayilan');

const ETIKET_SINIRI = 40;
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
    ozellik: canli ? guvenliOzellikler(canli) : null,
    varsayilanEylem: varsayilanServis(alan) !== null,
    onayliServisler,
  };
}

/**
 * Karoları sabit grup sırasında toplar (Işık, Sahne, PC, Medya, Diğer, Onaylı). Onay isteyen (yıkıcı) karolar kendi
 * grubundan çıkarılıp EN ALTA, "Onaylı" satırına alınır (g-07): sık kullanılan hoparlör/kulaklık ve ses düğmeleri ilk
 * ekranda kalır, nadir kullanılan PC kapat / İyi geceler altta durur. Boş gruplar atlanır; grup içi sıra favori sırasıdır.
 * @returns {{ kod: string, etiket: string, karolar: object[] }[]}
 */
function karolariGrupla(karolar, t = TR) {
  const onayli = karolar.filter((k) => k.sinif === 'yikici');
  const sonuc = [];
  for (const g of GRUPLAR) {
    const uyeler = karolar.filter((k) => k.grup === g.kod && k.sinif !== 'yikici');
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
 * @returns {{ gruplar: object[], sonlar: object[], ust: {canli:boolean, baglanti:string, medyaCaliyor:boolean|null, aktifCikis:string|null, hata:string|null, uyari:string|null, anahtarYok:boolean} }}
 */
function yuzeyModeliOlustur({ favoriler, durumAl, sonKimlikler = [], baglanti = {}, t = TR }) {
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
    ust: {
      canli: baglanti.canli === true,
      baglanti: typeof baglanti.baglanti === 'string' ? baglanti.baglanti : 'kapali',
      medyaCaliyor: medya && (medya.state === 'on' || medya.state === 'off') ? medya.state === 'on' : null,
      aktifCikis: cikis && typeof cikis.state === 'string' ? aktifCikis(cikis.state) : null,
      hata: typeof baglanti.hata === 'string' ? kisalt(baglanti.hata, 100) : null,
      uyari: typeof baglanti.uyari === 'string' && baglanti.uyari ? kisalt(baglanti.uyari, 100) : null,
      anahtarYok: baglanti.anahtarYok === true,
    },
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
]);

function rendererKaro(karo) {
  const sonuc = {};
  for (const alan of RENDERER_KARO_ALANLARI) {
    const deger = karo?.[alan];
    sonuc[alan] = deger !== null && typeof deger === 'object' ? structuredClone(deger) : deger; // ana süreç nesnesiyle paylaşılmasın
  }
  return sonuc;
}

/**
 * Ana süreçteki modeli IPC yüküne çevirir (h-15): her karoda yalnız RENDERER_KARO_ALANLARI kalır. HA'daki ad (`ad`) ve ileride
 * karoya eklenecek ana-süreç alanları panele gitmez. Girdi değiştirilmez.
 * @param {{gruplar?: object[], sonlar?: object[], ust?: object}} model yuzeyModeliOlustur sonucu
 */
function rendererModeli(model) {
  const dizi = (d) => (Array.isArray(d) ? d : []);
  return {
    gruplar: dizi(model?.gruplar).map((g) => ({ kod: g.kod, etiket: g.etiket, karolar: dizi(g.karolar).map(rendererKaro) })),
    sonlar: dizi(model?.sonlar).map(rendererKaro),
    ust: model?.ust ?? {},
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
  rendererModeli,
};
