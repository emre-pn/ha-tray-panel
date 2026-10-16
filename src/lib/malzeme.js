'use strict';

/**
 * Yeni yerel pencerelerin (hızlı panel, komut paleti, köşe bildirimi) Windows 11 arka plan malzemesi (saf) — gorunum-11.
 *
 * Ana Home Assistant penceresine DOKUNULMAZ (HA arayüzü zaten opak; kazanç küçük). `transparent` KULLANILMAZ
 * (gölge ve büyütme sorunları): yalnız `backgroundMaterial` (Windows 11 22H2 ve üstü) ile, sayfadaki yarı saydam CSS
 * (`data-malzeme` özniteliği, yuzey.css / kose-bildirim.css). Malzeme 'yok' seçiliyse ya da sistem desteklemiyorsa
 * pencereler bugünkü gibi opak koyu renkle açılır.
 *
 * Görsel sonuç (acrylic/mica, `backgroundColor` alfa gereksinimi) bu ortamda DENENMEDİ: opak ya da siyah görünürse
 * Ayarlar > Görünüm > Pencere malzemesi = "Düz" seçilir (README elle deneme listesi).
 */

const MALZEME_DEGERLERI = ['acrylic', 'mica', 'yok'];
const VARSAYILAN_MALZEME = 'acrylic';
const EN_AZ_YAPI = 22621; // Windows 11 22H2: setBackgroundMaterial / backgroundMaterial burada başlıyor
const OPAK_ARKA_PLAN = '#1b1f27'; // yuzey.css ve kose-bildirim.css'teki --bg ile aynı
const SAYDAM_ARKA_PLAN = '#00000000';

/** Ayardan gelen değeri düzeltir; geçersizse `varsayilan`. */
function malzemeDuzelt(deger, varsayilan = VARSAYILAN_MALZEME) {
  if (MALZEME_DEGERLERI.includes(deger)) return deger;
  return MALZEME_DEGERLERI.includes(varsayilan) ? varsayilan : VARSAYILAN_MALZEME;
}

/** os.release() ("10.0.26300") -> yapı numarası; Windows 10/11 biçiminde değilse null (Linux/macOS dahil). */
function yapiNumarasi(osRelease) {
  const eslesme = /^(\d+)\.(\d+)\.(\d+)/.exec(String(osRelease ?? '').trim());
  if (!eslesme || Number(eslesme[1]) !== 10 || Number(eslesme[2]) !== 0) return null;
  return Number(eslesme[3]);
}

/** Bu Windows sürümü pencere malzemesini destekliyor mu (Windows 11 22H2+: yapı 22621 ve üstü)? */
function malzemeDestekliMi(osRelease) {
  const yapi = yapiNumarasi(osRelease);
  return yapi !== null && yapi >= EN_AZ_YAPI;
}

/**
 * Pencere oluşturucu seçenekleri ve sayfaya bildirilecek etkin malzeme.
 * @param {string} secim ayardaki yeniPencereMalzemesi ('acrylic' | 'mica' | 'yok')
 * @param {string} osRelease os.release()
 * @returns {{ malzeme: 'acrylic'|'mica'|'yok', secenekler: { backgroundColor: string, backgroundMaterial?: string } }}
 */
function pencereMalzemesi(secim, osRelease) {
  const malzeme = malzemeDuzelt(secim);
  if (malzeme === 'yok' || !malzemeDestekliMi(osRelease)) {
    return { malzeme: 'yok', secenekler: { backgroundColor: OPAK_ARKA_PLAN } };
  }
  return { malzeme, secenekler: { backgroundMaterial: malzeme, backgroundColor: SAYDAM_ARKA_PLAN } };
}

module.exports = {
  MALZEME_DEGERLERI,
  VARSAYILAN_MALZEME,
  EN_AZ_YAPI,
  OPAK_ARKA_PLAN,
  SAYDAM_ARKA_PLAN,
  malzemeDuzelt,
  yapiNumarasi,
  malzemeDestekliMi,
  pencereMalzemesi,
};
