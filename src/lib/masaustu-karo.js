'use strict';

/**
 * Masaüstüne sabitlenen karolar (o-33, 1.4.0) — saf yardımcılar (Electron'a bağlı değildir).
 *
 * Bir FAVORİ, ayrı küçük çerçevesiz pencere olarak masaüstünde durur (pencere yönetimi: src/masaustu-karolari.js). Bu dosya
 * hangi favorilerin sabitlenebileceğini, pencere konumunun nasıl kaydedilip düzeltileceğini ve sayfaya giden karo modelini belirler.
 *
 * Güvenlik (Kapı Kuralı yalnız SIKILAŞIR):
 *  - Sabitlenebilir alanlar kısa ve sabit bir listedir (ışık, anahtar, vantilatör, sanal anahtar, sahne, sensör, ikili sensör).
 *    Kilit, alarm, kapı, garaj, bariyer, siren, perde/panjur (cover) ve kamera bu listede YOKTUR; kimlik ayrıca süzgeçten
 *    (adGuvenliMi) ve canlı durumla (karoOlustur -> guvenliVarlikMi) geçmelidir. binary_sensor için kapı/pencere/kilit/kurcalama
 *    sınıfları süzgeçte zaten dışarıdadır.
 *  - Yalnız FAVORİLER sabitlenir (ayardaki kimlik favori değilse karo hiç oluşmaz); onay isteyen (yıkıcı) favoriler sabitlenmez:
 *    masaüstü karosu basılı tutma/onay penceresi sunmaz, bu yüzden "yalnız zararsız" eylemler çalışır (eylem kaynağı 'masaustu').
 *  - Sayfaya (renderer) giden model ALAN BEYAZ LİSTESİdir: anahtar, adres, HA'daki ham ad gitmez.
 *  - Karo penceresinden gelen yük yalnız iki biçimde kabul edilir: düz tıklama (varsayılan servis) ya da sabit parlaklık ön ayarı.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi } = require('./suzgec');
const { eylemAlaniMi } = require('./alan-kaydi');
const { karoOlustur } = require('./yuzey-modeli');
const { kisalt } = require('./metin');
const { enCokKesisenEkran, alanaSigdir, yeterinceGorunurMu } = require('./pencere-yerlesim');

/** Aynı anda en çok bu kadar karo penceresi (her biri ayrı pencere/süreç yüküdür). */
const EN_COK_KARO = 6;
/** Sabitlenebilir alanlar (sıra Ayarlar'daki listede de bu sıradır). Yalnız zararsız, tek tıklamalı ya da salt okunur alanlar. */
const SABITLENEBILIR_ALANLAR = Object.freeze(['light', 'switch', 'fan', 'input_boolean', 'scene', 'sensor', 'binary_sensor']);
/** Işık karosundaki parlaklık ön ayarları (yüzde). Sabit liste: pencereden başka değer gelemez. */
const PARLAKLIK_ON_AYARLARI = Object.freeze([25, 50, 100]);
const KARO_BOYUTU = Object.freeze({ width: 176, height: 112 });
const KARO_BOYUT_SINIRLARI = Object.freeze({ en_az: Object.freeze({ width: 120, height: 88 }), en_cok: Object.freeze({ width: 360, height: 260 }) });
/** Ayarda saklanan en çok konum kaydı (sabitlemesi kaldırılan karoların konumu da bir süre durur). */
const EN_COK_KONUM_KAYDI = 24;
const KENAR_BOSLUGU = 16;
const ARA_BOSLUK = 12;
const EN_COK_KOORDINAT = 100000;
const ETIKET_SINIRI = 40;

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
const sonluSayi = (d) => typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= EN_COK_KOORDINAT;

/** Kimlik sabitlenebilir mi (biçim + alan listesi + Kapı Kuralı)? Canlı durum ayrıca karoOlustur'da denetlenir. */
function sabitlenebilirKimlikMi(kimlik) {
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
  if (!SABITLENEBILIR_ALANLAR.includes(alanAl(kimlik))) return false;
  return adGuvenliMi(kimlik, '');
}

/** Metin boyutu çarpanı (Ayarlar > Görünüm): sonlu ve 1 ile 2 arasında değilse 1 (ana süreçteki metinOlcegi ile aynı doğrulama). */
function olcekDuzelt(olcek) {
  return typeof olcek === 'number' && Number.isFinite(olcek) && olcek >= 1 && olcek <= 2 ? olcek : 1;
}

/** Boyut kırpması: en az sınır `enAzOlcek`, en çok sınır `enCokOlcek` çarpanıyla büyür (pencere sınırları metin boyutuyla büyür). */
function karoSiniriKirp(ham, enAzOlcek, enCokOlcek) {
  if (!duzNesneMi(ham) || !sonluSayi(ham.x) || !sonluSayi(ham.y) || !sonluSayi(ham.width) || !sonluSayi(ham.height)) return null;
  const { en_az: az, en_cok: cok } = KARO_BOYUT_SINIRLARI;
  return {
    x: Math.round(ham.x),
    y: Math.round(ham.y),
    width: Math.min(Math.round(cok.width * enCokOlcek), Math.max(Math.round(az.width * enAzOlcek), Math.round(ham.width))),
    height: Math.min(Math.round(cok.height * enCokOlcek), Math.max(Math.round(az.height * enAzOlcek), Math.round(ham.height))),
  };
}

/**
 * Karo penceresi sınırı { x, y, width, height }: koordinatlar tam sayı, boyut izinli aralığa kırpılır; biçim bozuksa null.
 * `olcek` (metin boyutu çarpanı, varsayılan 1): pencerenin en az/en çok boyutu aynı oranda büyüdüğünden (masaustu-karolari.js)
 * kırpma da o oranla yapılır; yoksa %150'de büyütülen karo kayıtta ve yeniden yerleştirmede 360x260'a inerdi.
 */
function karoSiniriDuzelt(ham, olcek = 1) {
  const o = olcekDuzelt(olcek);
  return karoSiniriKirp(ham, o, o);
}

/**
 * Ölçekten bağımsız (ayar şeması ve diskteki kayıtlar): en az ölçek 1, en çok ölçek 2. Kullanıcı başka bir metin boyutunda
 * büyüttüğü karonun kaydı, bu kayıt başka bir ölçekte okunurken (ya da başka bir karo kaydedilirken) kırpılıp kaybolmaz.
 */
function karoSiniriGevsekDuzelt(ham) {
  return karoSiniriKirp(ham, 1, 2);
}

/**
 * Ayardaki konum kayıtları { kimlik: { x, y, width, height } }: geçersiz kimlik/sınır atılır, en çok EN_COK_KONUM_KAYDI.
 * Nesne değilse undefined (ayar alanı reddeder, mevcut değer korunur).
 */
function karoKonumlariniDuzelt(ham) {
  if (!duzNesneMi(ham)) return undefined;
  const sonuc = {};
  let say = 0;
  for (const [kimlik, sinir] of Object.entries(ham)) {
    if (say >= EN_COK_KONUM_KAYDI) break;
    if (!sabitlenebilirKimlikMi(kimlik)) continue;
    const duzgun = karoSiniriGevsekDuzelt(sinir);
    if (!duzgun) continue;
    sonuc[kimlik] = duzgun;
    say += 1;
  }
  return sonuc;
}

/**
 * Bir karo penceresi taşındığında/boyutlandığında yeni konum kaydı (saf). Değişiklik yoksa ya da sınır bozuksa null.
 * En çok EN_COK_KONUM_KAYDI kayıt tutulur: sınır aşılırsa EN ESKİ eklenen (nesne sırasıyla ilk) kayıt düşer; güncellenen karo sona taşınır.
 * @returns {object|null} yeni kayıt haritası ya da null
 */
function karoKonumKaydiHesapla({ kimlik, sinirlar, mevcut = {}, olcek = 1 }) {
  if (!sabitlenebilirKimlikMi(kimlik)) return null;
  const yeni = karoSiniriDuzelt(sinirlar, olcek);
  if (!yeni) return null;
  const kayitlar = karoKonumlariniDuzelt(mevcut) ?? {};
  const eski = kayitlar[kimlik];
  if (eski && eski.x === yeni.x && eski.y === yeni.y && eski.width === yeni.width && eski.height === yeni.height) return null;
  delete kayitlar[kimlik];
  const girdiler = [...Object.entries(kayitlar), [kimlik, yeni]].slice(-EN_COK_KONUM_KAYDI);
  return Object.fromEntries(girdiler);
}

/**
 * Karonun açılış sınırları (saf). Kayıtlı konum bağlı bir ekranda yeterince görünüyorsa o (çalışma alanına sığdırılmış);
 * aksi halde (kayıt yok ya da ekran sökülmüş) birincil ekranın sağ kenarında, sıra numarasına göre alta doğru dizilir; sığmazsa
 * yeni bir sütun açılır. Kayıt silinmez: ekran geri gelince konum yeniden geçerli olur.
 * @param {{kayit?: object|null, sira?: number, ekranlar?: object[], olcek?: number}} g ekranlar: ekranlariOzetle sonucu (birincil önce); olcek: metin boyutu çarpanı
 * @returns {{x:number,y:number,width:number,height:number,kaynak:'kayit'|'varsayilan'}}
 */
function karoHedefi({ kayit = null, sira = 0, ekranlar = [], olcek = 1 }) {
  const liste = Array.isArray(ekranlar) ? ekranlar : [];
  const duzgun = karoSiniriDuzelt(kayit, olcek);
  if (duzgun) {
    const ekran = enCokKesisenEkran(liste, duzgun);
    if (ekran && yeterinceGorunurMu(duzgun, ekran)) return { ...alanaSigdir(duzgun, ekran.calismaAlani), kaynak: 'kayit' };
  }
  // Varsayılan boyut da metin boyutuyla büyür: sayfa setZoomFactor(olcek) ile yakınlaştığından 176x112 DIP pencere CSS'te küçülür
  // (%150'de 117x75 px) ve içerik sıkışırdı; ölçekli boyut CSS alanını tasarım boyutunda (176x112) tutar. Satır/sütun adımı da ölçeklidir.
  const o = olcekDuzelt(olcek);
  const width = Math.round(KARO_BOYUTU.width * o);
  const height = Math.round(KARO_BOYUTU.height * o);
  const alan = liste[0]?.calismaAlani ?? { x: 0, y: 0, width: 1280, height: 720 };
  const satir = Math.max(1, Math.floor((alan.height - 2 * KENAR_BOSLUGU + ARA_BOSLUK) / (height + ARA_BOSLUK)));
  const s = Number.isInteger(sira) && sira >= 0 ? sira : 0;
  const sutun = Math.floor(s / satir);
  const x = alan.x + alan.width - width - KENAR_BOSLUGU - sutun * (width + ARA_BOSLUK);
  const y = alan.y + KENAR_BOSLUGU + (s % satir) * (height + ARA_BOSLUK);
  return { ...alanaSigdir({ x, y, width, height }, alan), kaynak: 'varsayilan' };
}

/** Karo penceresi yükü: 'tikla' ya da { parlaklik } (ön ayar). Başka her şey null (reddedilir). */
function karoYukunuDuzelt(yuk) {
  if (!duzNesneMi(yuk)) return null;
  const anahtarlar = Object.keys(yuk);
  if (anahtarlar.length === 1 && anahtarlar[0] === 'tur' && yuk.tur === 'tikla') return { tur: 'tikla' };
  if (anahtarlar.length === 1 && anahtarlar[0] === 'parlaklik' && PARLAKLIK_ON_AYARLARI.includes(yuk.parlaklik)) return { parlaklik: yuk.parlaklik };
  return null;
}

/**
 * Seçili kimliklerden gerçekten sabitlenecek karolar (saf). Sıra seçim sırasıdır; tekrar, en çok EN_COK_KARO ve şunlar elenir:
 * sabitlenebilir olmayan kimlik, favori olmayan kimlik, süzgeçten/sınıflamadan geçmeyen karo (kapı sözcüğü, YASAK) ve onay isteyen
 * (yıkıcı) karo. Dönüş ana süreç nesnesidir ({ kimlik, favori, karo }); sayfaya `masaustuKaroModeli` ile süzülmüş hâli gider.
 * @param {{secili: string[], favoriler: object[], durumAl: (kimlik: string) => (object|null|undefined), t?: Function}} g
 */
function sabitlenecekKarolar({ secili, favoriler, durumAl, t }) {
  const sonuc = [];
  const goruldu = new Set();
  const favoriHaritasi = new Map();
  for (const f of Array.isArray(favoriler) ? favoriler : []) if (f && typeof f.entity_id === 'string' && !favoriHaritasi.has(f.entity_id)) favoriHaritasi.set(f.entity_id, f);
  for (const kimlik of Array.isArray(secili) ? secili : []) {
    if (sonuc.length >= EN_COK_KARO) break;
    if (goruldu.has(kimlik) || !sabitlenebilirKimlikMi(kimlik)) continue;
    goruldu.add(kimlik);
    const favori = favoriHaritasi.get(kimlik);
    if (!favori) continue;
    const karo = karoOlustur(favori, durumAl(kimlik), t);
    if (!karo || karo.sinif !== 'zararsiz') continue;
    sonuc.push({ kimlik, favori, karo });
  }
  return sonuc;
}

/** Tek tıklamayla eylem yapılabilir mi (salt okunur sensör ve eylemsiz karolar için false)? */
function tiklanabilirMi(karo) {
  return !!karo && karo.sinif === 'zararsiz' && karo.kullanilabilir === true && karo.varsayilanEylem === true && eylemAlaniMi(karo.alan);
}

/**
 * Işık karosunda parlaklık ön ayarları gösterilir mi? Eylem hattı parlaklığı yalnız favoride "parlaklık" açıksa kabul eder
 * (karo.parlaklikKontrol); düğme, hattın zaten reddedeceği bir isteği göndermesin diye aynı koşul burada da aranır.
 */
function parlaklikOnAyariVarMi(karo) {
  return !!karo && karo.alan === 'light' && karo.parlaklikKontrol === true && karo.sinif === 'zararsiz' && karo.kullanilabilir === true && eylemAlaniMi(karo.alan);
}

/**
 * Karo penceresinin sayfasına giden model (alan beyaz listesi): kimlik, etiket, alan, durum, yüzde, kullanılabilirlik, güvenli öznitelik
 * alt kümesi (yalnız sensörlerde), tıklanabilirlik, parlaklık ön ayarları ve bağlantı bilgisi.
 * @param {object} karo karoOlustur sonucu (ana süreç nesnesi)
 * @param {{canli?: boolean, baglanti?: string}} [baglanti]
 */
function masaustuKaroModeli(karo, baglanti = {}) {
  const sensorMu = karo.alan === 'sensor' || karo.alan === 'binary_sensor';
  return {
    id: karo.id,
    etiket: typeof karo.etiket === 'string' ? kisalt(karo.etiket, ETIKET_SINIRI) : '', // kod noktası tabanlı: vekil çifti (emoji) ortadan bölünmez
    alan: karo.alan,
    durum: karo.durum,
    yuzde: Number.isFinite(karo.yuzde) ? karo.yuzde : null,
    kullanilabilir: karo.kullanilabilir === true,
    ulasilamiyor: karo.ulasilamiyor === true,
    ozellik: sensorMu && karo.ozellik ? structuredClone(karo.ozellik) : null,
    tiklanabilir: tiklanabilirMi(karo),
    parlaklikOnAyarlari: parlaklikOnAyariVarMi(karo) ? [...PARLAKLIK_ON_AYARLARI] : [],
    baglanti: {
      canli: baglanti.canli === true,
      baglanti: typeof baglanti.baglanti === 'string' ? baglanti.baglanti : 'kapali',
    },
  };
}

module.exports = {
  EN_COK_KARO,
  SABITLENEBILIR_ALANLAR,
  PARLAKLIK_ON_AYARLARI,
  KARO_BOYUTU,
  KARO_BOYUT_SINIRLARI,
  EN_COK_KONUM_KAYDI,
  sabitlenebilirKimlikMi,
  olcekDuzelt,
  karoSiniriDuzelt,
  karoSiniriGevsekDuzelt,
  karoKonumlariniDuzelt,
  karoKonumKaydiHesapla,
  karoHedefi,
  karoYukunuDuzelt,
  sabitlenecekKarolar,
  tiklanabilirMi,
  parlaklikOnAyariVarMi,
  masaustuKaroModeli,
};
