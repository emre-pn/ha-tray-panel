'use strict';

/**
 * Karo bağlam (sağ tık) menüsü (saf) — 1.4.0 düzen grubu (o-16).
 *
 * Panelde bir karoya sağ tıklanınca ana süreç Menu.popup ile YALNIZ bu plandaki öğeleri gösterir: düzenle, tepsiye ekle / kaldır,
 * sayfaya ekle (işaret kutulu), favorilerden kaldır. Hiçbir öğe HA'ya eylem göndermez; yıkıcı eylemin 800 ms basılı tutma onayı
 * menüden DEĞİL panelde kalır (kısa basış / menü onay yerine geçmez). Menü etiketleri sabit metinlerdir; sayfa adı kapı kuralından geçmiştir.
 */

const { TR } = require('./ceviri-varsayilan');
const { tepsiDegistir, favoriyiKaldir, sayfaUyeliginiDegistir } = require('./duzen');

const SAYFA_ISLEMI_DESENI = /^sayfa:([a-z0-9]{3,12})$/;

/**
 * @param {{karo: {id: string, sinif?: string}, favori: object|undefined, sayfalar: {id: string, ad: string, varliklar: string[]}[], t?: Function}} girdi
 * @returns {{id?: string, label?: string, tur?: 'ayirac'|'checkbox', checked?: boolean, alt?: object[]}[]} plan; favori değilse boş
 */
function karoMenuPlani({ karo, favori, sayfalar = [], t = TR }) {
  if (!karo || typeof karo.id !== 'string' || !favori || favori.entity_id !== karo.id) return [];
  const plan = [{ id: 'duzenle', label: t('karoMenu.duzenle') }];
  // Onay isteyen (yıkıcı) favoriler tepside zaten ayrı "Onaylı eylemler" altındadır: sabitleme anlamsız.
  if (karo.sinif !== 'yikici') plan.push({ id: 'tepsi', label: t(favori.tepsi === true ? 'karoMenu.tepsidenKaldir' : 'karoMenu.tepsiyeEkle') });
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
 *  - 'sayfa:<id>' -> { tur: 'degisti', neden: 'menu-sayfa', ... } (üyelik tersine çevrilir)
 *  - 'kaldir'   -> { tur: 'degisti', neden: 'menu-kaldir', ... } (ÇAĞIRAN önce kullanıcıdan onay almalıdır)
 *  - değişiklik yoksa / geçersizse { tur: 'yok' }
 * @returns {{tur: 'duzenle'|'yok'} | {tur: 'degisti', neden: string, favoriler: object[], sayfalar: object[]}}
 */
function karoMenuIslemi({ islem, kimlik, favoriler, sayfalar }) {
  if (typeof islem !== 'string' || typeof kimlik !== 'string' || !(Array.isArray(favoriler) ? favoriler : []).some((f) => f.entity_id === kimlik)) return { tur: 'yok' };
  if (islem === 'duzenle') return { tur: 'duzenle' };
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
