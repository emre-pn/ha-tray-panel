'use strict';

/**
 * Düzen değişiklikleri (saf) — 1.4.0 düzen grubu (o-16, o-28, o-30): favori listesi ve sayfalar üzerinde bağlam menüsü, onarım ve
 * geri yükleme işlemleri. Ana süreç (main.js) çağırır; sonucu ayara yazar, anlık görüntü alır ve yüzeyleri tazeler.
 *
 * Hiçbir işlev girdiyi DEĞİŞTİRMEZ. Hiçbir işlem yeni bir varlık getirmez: onarım hariç (kullanıcı yeni kimliği güvenli cihaz
 * listesinden seçer, main.js doğrular) yalnız mevcut favoriler kaldırılır / işaretlenir / sayfalara bağlanır. Kapı kuralı, alan
 * ve sınır denetimleri favoriOlustur / favorileriDuzelt / sayfalariDuzelt'te zaten uygulanır; geri yüklenen düzen de aynı süzgeçten geçer.
 */

const { alanAl, adGuvenliMi } = require('./suzgec');
const { kisalt } = require('./metin');
const { favoriOlustur, favorileriDuzelt, onayiDuzelt } = require('./favoriler');
const { sayfalariDuzelt, sayfalariBuda } = require('./sayfalar');
const { kimlikDegistir, tumundenCikar, varlikEkle, varlikCikar } = require('./duzen-islemleri');

const AD_SINIRI = 100;
const kopya = (d) => structuredClone(d);

/** Favoriyi tepsiye sabitler / sabitten çıkarır (deger verilmezse tersine çevirir). @returns {{favoriler: object[], degisti: boolean, deger: boolean}} */
function tepsiDegistir(favoriler, kimlik, deger) {
  const liste = kopya(Array.isArray(favoriler) ? favoriler : []);
  const f = liste.find((o) => o.entity_id === kimlik);
  if (!f) return { favoriler: liste, degisti: false, deger: false };
  const yeni = typeof deger === 'boolean' ? deger : f.tepsi !== true;
  if ((f.tepsi === true) === yeni) return { favoriler: liste, degisti: false, deger: yeni };
  if (yeni) f.tepsi = true;
  else delete f.tepsi;
  return { favoriler: liste, degisti: true, deger: yeni };
}

/** Favoriyi listeden ve bütün sayfalardan çıkarır. */
function favoriyiKaldir(favoriler, sayfalar, kimlik) {
  const liste = Array.isArray(favoriler) ? favoriler : [];
  if (!liste.some((f) => f.entity_id === kimlik)) return { favoriler: kopya(liste), sayfalar: kopya(sayfalar ?? []), degisti: false };
  return { favoriler: kopya(liste.filter((f) => f.entity_id !== kimlik)), sayfalar: tumundenCikar(sayfalar, kimlik), degisti: true };
}

/**
 * Favoriyi sayfaya ekler / sayfadan çıkarır (ekle verilmezse üyeliği tersine çevirir). Yalnız favori olan kimlik sayfaya girer.
 * @returns {{sayfalar: object[], degisti: boolean, uye: boolean}}
 */
function sayfaUyeliginiDegistir(sayfalar, favoriler, sayfaId, kimlik, ekle) {
  const liste = kopya(Array.isArray(sayfalar) ? sayfalar : []);
  const sayfa = liste.find((s) => s.id === sayfaId);
  if (!sayfa || !(Array.isArray(favoriler) ? favoriler : []).some((f) => f.entity_id === kimlik)) return { sayfalar: liste, degisti: false, uye: false };
  const uye = sayfa.varliklar.includes(kimlik);
  const hedef = typeof ekle === 'boolean' ? ekle : !uye;
  if (hedef === uye) return { sayfalar: liste, degisti: false, uye };
  const yeni = hedef ? varlikEkle(liste, sayfaId, kimlik) : varlikCikar(liste, sayfaId, kimlik);
  const sonrasi = yeni.find((s) => s.id === sayfaId).varliklar.includes(kimlik);
  return { sayfalar: yeni, degisti: sonrasi !== uye, uye: sonrasi };
}

/**
 * Kullanılamayan (HA'da bulunamayan) favoriyi yenisine bağlar (o-28): sıra, karo adı, onay, kısayol, parlaklık, görünüm ve tepsi ayarı
 * ve sayfa üyelikleri yeni varlığa taşınır. Aynı alandan olmalıdır (ışık -> ışık); yeni kimlik zaten favori olamaz; yeni adı kapı kuralından
 * geçmelidir (çağıran ayrıca cihaz listesinde güvenli olduğunu doğrular).
 * @param {{favoriler: object[], sayfalar: object[], eski: string, yeni: string, yeniAd: string}} girdi
 * @returns {{ok: true, favoriler: object[], sayfalar: object[]} | {ok: false, neden: 'kayitsiz'|'zaten-var'|'alan'|'guvenlik'|'gecersiz'}}
 */
function favoriyiOnar({ favoriler, sayfalar, eski, yeni, yeniAd }) {
  const liste = Array.isArray(favoriler) ? favoriler : [];
  const sira = liste.findIndex((f) => f.entity_id === eski);
  if (typeof eski !== 'string' || typeof yeni !== 'string' || eski === yeni) return { ok: false, neden: 'gecersiz' };
  if (sira < 0) return { ok: false, neden: 'kayitsiz' };
  if (liste.some((f) => f.entity_id === yeni)) return { ok: false, neden: 'zaten-var' };
  if (alanAl(eski) !== alanAl(yeni)) return { ok: false, neden: 'alan' };
  const ad = kisalt(typeof yeniAd === 'string' && yeniAd.trim() ? yeniAd : yeni, AD_SINIRI);
  if (!adGuvenliMi(yeni, ad)) return { ok: false, neden: 'guvenlik' };
  const { entity_id: _kimlik, ad: _ad, ...ek } = liste[sira];
  const kayit = favoriOlustur(yeni, ad, ek);
  const sonuc = kopya(liste);
  sonuc[sira] = kayit;
  return { ok: true, favoriler: onayiDuzelt(sonuc), sayfalar: kimlikDegistir(sayfalar, eski, yeni) };
}

/**
 * Anlık görüntüyü (düzen geçmişi noktası) yeniden doğrulayarak geri yüklenecek düzene çevirir: favoriler ayar şemasından (alan, kapı
 * kuralı, sınırlar) ve onay kuralından geçer, sayfalar doğrulanır ve favori olmayan varlıklardan arındırılır.
 * @returns {{favoriler: object[], sayfalar: object[], atilanlar: {entity_id: string, neden: string}[]}}
 */
function duzeniDogrula(anlik) {
  const duzeltilen = favorileriDuzelt(anlik?.favoriler);
  const favoriler = onayiDuzelt(duzeltilen.favoriler);
  const sayfalar = sayfalariBuda(sayfalariDuzelt(anlik?.sayfalar) ?? [], new Set(favoriler.map((f) => f.entity_id)));
  return { favoriler, sayfalar, atilanlar: duzeltilen.atilanlar };
}

module.exports = { tepsiDegistir, favoriyiKaldir, sayfaUyeliginiDegistir, favoriyiOnar, duzeniDogrula };
