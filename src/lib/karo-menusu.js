'use strict';

/**
 * Karo bağlam (sağ tık) menüsü (saf) — 1.4.0 düzen grubu (o-16).
 *
 * Panelde bir karoya sağ tıklanınca ana süreç Menu.popup ile YALNIZ bu plandaki öğeleri gösterir: düzenle, tepsiye ekle / kaldır,
 * masaüstüne sabitle / sabitlemeyi kaldır, sayfaya ekle (işaret kutulu), favorilerden kaldır. Hiçbir öğe HA'ya eylem göndermez; yıkıcı
 * eylemin 800 ms basılı tutma onayı menüden DEĞİL panelde kalır (kısa basış / menü onay yerine geçmez). Menü etiketleri sabit metinlerdir;
 * sayfa adı kapı kuralından geçmiştir.
 *
 * Masaüstüne sabitleme (1.4.0): Ayarlar'daki "Masaüstüne sabitlenen karolar" listesiyle (`masaustuKarolari`) AYNI ayarı değiştirir; yeni bir
 * yetki eklemez. Öğe yalnız sabitlenebilir alanlarda (src/lib/masaustu-karo.js: kapı kuralından geçen, kilit / alarm / kapı / cover /
 * kamera olmayan) ve zararsız sınıfta görünür; liste dolunca (EN_COK_KARO) "sabitle" öğesi hiç çıkmaz. Plan yalnız çağıran `masaustu`
 * (sabitli kimlikler) verirse bu öğeyi içerir.
 */

const { TR } = require('./ceviri-varsayilan');
const { tepsiDegistir, favoriyiKaldir, sayfaUyeliginiDegistir } = require('./duzen');
const { EN_COK_KARO, sabitlenebilirKimlikMi } = require('./masaustu-karo');

const SAYFA_ISLEMI_DESENI = /^sayfa:([a-z0-9]{3,12})$/;

/**
 * @param {{karo: {id: string, sinif?: string}, favori: object|undefined, sayfalar: {id: string, ad: string, varliklar: string[]}[], masaustu?: string[], t?: Function}} girdi
 *   masaustu: şu an masaüstüne sabitli kimlikler (verilmezse sabitleme öğesi yok)
 * @returns {{id?: string, label?: string, tur?: 'ayirac'|'checkbox', checked?: boolean, alt?: object[]}[]} plan; favori değilse boş
 */
function karoMenuPlani({ karo, favori, sayfalar = [], masaustu, t = TR }) {
  if (!karo || typeof karo.id !== 'string' || !favori || favori.entity_id !== karo.id) return [];
  const plan = [{ id: 'duzenle', label: t('karoMenu.duzenle') }];
  // Onay isteyen (yıkıcı) favoriler tepside zaten ayrı "Onaylı eylemler" altındadır; tek tıklama eylemi olmayan karolar (klima, medya...)
  // hiç tepsiye girmez: ikisinde de sabitleme anlamsız.
  if (karo.sinif !== 'yikici' && karo.varsayilanEylem !== false) plan.push({ id: 'tepsi', label: t(favori.tepsi === true ? 'karoMenu.tepsidenKaldir' : 'karoMenu.tepsiyeEkle') });
  if (Array.isArray(masaustu) && karo.sinif === 'zararsiz' && sabitlenebilirKimlikMi(karo.id)) {
    const sabit = masaustu.includes(karo.id);
    if (sabit || masaustu.length < EN_COK_KARO) plan.push({ id: 'masaustu', label: t(sabit ? 'karoMenu.masaustundenKaldir' : 'karoMenu.masaustuneSabitle') });
  }
  if (sayfalar.length > 0) {
    plan.push({
      id: 'sayfalar',
      label: t('karoMenu.sayfayaEkle'),
      alt: sayfalar.map((s, i) => ({
        id: `sayfa:${s.id}`,
        label: s.ad || t('sayfa.adsiz', { n: i + 1 }),
        tur: 'checkbox',
        checked: s.varliklar.includes(karo.id),
      })),
    });
  }
  plan.push({ tur: 'ayirac' }, { id: 'kaldir', label: t('karoMenu.favoridenKaldir') });
  return plan;
}

/**
 * Menü işleminin ayar üzerindeki etkisi. Kimlik favori olmalıdır.
 *  - 'duzenle'  -> { tur: 'duzenle' } (Ayarlar açılır; ayar değişmez)
 *  - 'tepsi'    -> { tur: 'degisti', neden: 'menu-tepsi', favoriler, sayfalar }
 *  - 'masaustu' -> { tur: 'masaustu', sabit: boolean, liste: string[] } (sabitli kimlik listesinin yeni hâli; favori / sayfa değişmez, düzen geçmişine girmez)
 *  - 'sayfa:<id>' -> { tur: 'degisti', neden: 'menu-sayfa', ... } (üyelik tersine çevrilir)
 *  - 'kaldir'   -> { tur: 'degisti', neden: 'menu-kaldir', ... } (ÇAĞIRAN önce kullanıcıdan onay almalıdır)
 *  - değişiklik yoksa / geçersizse { tur: 'yok' }
 * @returns {{tur: 'duzenle'|'yok'} | {tur: 'degisti', neden: string, favoriler: object[], sayfalar: object[]}}
 */
function karoMenuIslemi({ islem, kimlik, favoriler, sayfalar, masaustu }) {
  if (typeof islem !== 'string' || typeof kimlik !== 'string' || !(Array.isArray(favoriler) ? favoriler : []).some((f) => f.entity_id === kimlik)) return { tur: 'yok' };
  if (islem === 'duzenle') return { tur: 'duzenle' };
  if (islem === 'masaustu') {
    if (!Array.isArray(masaustu) || !sabitlenebilirKimlikMi(kimlik)) return { tur: 'yok' };
    const liste = masaustu.filter((k) => typeof k === 'string');
    if (liste.includes(kimlik)) return { tur: 'masaustu', sabit: false, liste: liste.filter((k) => k !== kimlik) };
    if (liste.length >= EN_COK_KARO) return { tur: 'yok' };
    return { tur: 'masaustu', sabit: true, liste: [...liste, kimlik] };
  }
  if (islem === 'tepsi') {
    const s = tepsiDegistir(favoriler, kimlik);
    return s.degisti ? { tur: 'degisti', neden: 'menu-tepsi', favoriler: s.favoriler, sayfalar: sayfalar ?? [] } : { tur: 'yok' };
  }
  if (islem === 'kaldir') {
    const s = favoriyiKaldir(favoriler, sayfalar, kimlik);
    return s.degisti ? { tur: 'degisti', neden: 'menu-kaldir', favoriler: s.favoriler, sayfalar: s.sayfalar } : { tur: 'yok' };
  }
  const eslesme = SAYFA_ISLEMI_DESENI.exec(islem);
  if (eslesme) {
    const s = sayfaUyeliginiDegistir(sayfalar, favoriler, eslesme[1], kimlik);
    return s.degisti ? { tur: 'degisti', neden: 'menu-sayfa', favoriler, sayfalar: s.sayfalar } : { tur: 'yok' };
  }
  return { tur: 'yok' };
}

module.exports = { karoMenuPlani, karoMenuIslemi };
