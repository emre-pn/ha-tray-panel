'use strict';

/**
 * Panel modelindeki "eylem" bölümü (1.4.0 eylem grubu: o-12 geri al, o-15 bekleyen gecikmeli eylemler, o-18 son değişenler, o-14 odalar...). Ana süreç bölümü
 * eylem bağlayıcısından (src/lib/eylem-ekleri.js) alır, renderer'a giderken BEYAZ LİSTEDEN geçirilir (rendererEylem): kimlik, ham ayar ya da
 * HA yanıtı bu yoldan sayfaya çıkmaz. Renderer yine kendi doğrulamasını yapar (src/yuzey-eylem.js).
 */

const { adGuvenliMi } = require('./suzgec');

const EN_COK_GERI_AL = 5;
const EN_COK_GECIKMELI = 10;
const AD_SINIRI = 60;
const GECIKMELI_KIMLIK_DESENI = /^g\d{1,9}$/;
const EN_COK_DEGISEN = 20;
const DEGISEN_ALANLARI = ['light', 'switch', 'scene', 'climate', 'media_player'];
const DEGISEN_TURLERI = ['acildi', 'kapandi', 'calisti', 'degisti'];
const VARLIK_DESENI = /^[a-z_]{1,30}\.[a-z0-9_]{1,100}$/;

const sonluSayi = (d) => typeof d === 'number' && Number.isFinite(d);

/** Geri al özeti: { adet: 1..5, ad, bitis (ms, mutlak) } ya da null. */
function geriAlOzeti(ham) {
  if (!ham || typeof ham !== 'object') return null;
  if (!Number.isInteger(ham.adet) || ham.adet < 1 || !sonluSayi(ham.bitis) || ham.bitis <= 0) return null;
  return { adet: Math.min(ham.adet, EN_COK_GERI_AL), ad: String(ham.ad ?? '').slice(0, AD_SINIRI), bitis: Math.floor(ham.bitis) };
}

/**
 * Bekleyen gecikmeli eylemler (o-15): [{ id: 'g<n>' (opak), ad, yon: 'ac'|'kapat', bitis (ms, mutlak) }], en yakın önde, en çok 10.
 * Varlık kimliği renderer'a GİTMEZ; iptal yalnız opak kimlikle istenir.
 */
function gecikmeliOzeti(ham) {
  if (!Array.isArray(ham)) return [];
  const sonuc = [];
  for (const o of ham) {
    if (sonuc.length >= EN_COK_GECIKMELI) break;
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !GECIKMELI_KIMLIK_DESENI.test(o.id)) continue;
    if ((o.yon !== 'ac' && o.yon !== 'kapat') || !sonluSayi(o.bitis) || o.bitis <= 0) continue;
    sonuc.push({ id: o.id, ad: String(o.ad ?? '').slice(0, AD_SINIRI), yon: o.yon, bitis: Math.floor(o.bitis) });
  }
  return sonuc.sort((a, b) => a.bitis - b.bitis);
}

/**
 * Son değişenler (o-18): [{ kimlik, ad, alan, tur, zaman (ms, mutlak) }], en yeni üstte, en çok 20. Yalnız ışık / priz / sahne / klima /
 * medya oynatıcı alanları ve bilinen değişim türleri geçer; kimlik biçimi doğrulanır. Kapı Kuralı kaynakta (son-degisenler.js) uygulanır.
 */
function degisenOzeti(ham) {
  if (!Array.isArray(ham)) return [];
  const sonuc = [];
  for (const o of ham) {
    if (sonuc.length >= EN_COK_DEGISEN) break;
    if (!o || typeof o !== 'object' || typeof o.kimlik !== 'string' || !VARLIK_DESENI.test(o.kimlik)) continue;
    if (!DEGISEN_ALANLARI.includes(o.alan) || !o.kimlik.startsWith(`${o.alan}.`) || !DEGISEN_TURLERI.includes(o.tur) || !sonluSayi(o.zaman) || o.zaman <= 0) continue;
    if (!adGuvenliMi(o.kimlik, String(o.ad ?? ''))) continue; // Kapı Kuralı: kaynakta uygulanır, burada ikinci kez (savunma derinliği)
    sonuc.push({ kimlik: o.kimlik, ad: String(o.ad ?? '').slice(0, AD_SINIRI), alan: o.alan, tur: o.tur, zaman: Math.floor(o.zaman) });
  }
  return sonuc.sort((a, b) => b.zaman - a.zaman);
}

/**
 * Renderer'a giden eylem bölümü (beyaz liste). Girdi değiştirilmez.
 * @param {{geriAl?: object|null, gecikmeli?: object[], degisenler?: object[], degisenAcik?: boolean}|null|undefined} eylem
 * @returns {{geriAl: {adet: number, ad: string, bitis: number}|null, gecikmeli: {id: string, ad: string, yon: string, bitis: number}[], degisenler: object[], degisenAcik: boolean}}
 */
function rendererEylem(eylem) {
  return { geriAl: geriAlOzeti(eylem?.geriAl), gecikmeli: gecikmeliOzeti(eylem?.gecikmeli), degisenler: degisenOzeti(eylem?.degisenler), degisenAcik: eylem?.degisenAcik === true };
}

module.exports = { EN_COK_GERI_AL, EN_COK_GECIKMELI, EN_COK_DEGISEN, AD_SINIRI, geriAlOzeti, gecikmeliOzeti, degisenOzeti, rendererEylem };
