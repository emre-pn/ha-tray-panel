'use strict';

/**
 * Klasör tabanlı ayar eşitlemenin (1.4.0, o-58) bölüm tablosu ve ayar alanı doğrulayıcıları — BAĞIMLILIKSIZ yaprak modül (saf).
 * ayar-alanlari.js bunu yükler; ayar-esitleme.js (çekirdek) ayar-yedegi.js'i yüklediği için döngü olmasın diye tablo burada durur.
 *
 * BÖLÜMLER, eşitlenebilen alanların AÇIK BEYAZ LİSTESİDİR (kapalı varsayım): eşitleme elle yapılan bir içe aktarma değildir, klasöre yazabilen
 * herkes bu dosyayı değiştirebilir. Bu yüzden listede olmayan hiçbir alan eşitlenmez; yeni bir ayar alanı eklenince bilinçli olarak buraya
 * konmadıkça klasöre yazılmaz ve klasörden alınmaz. KESİNLİKLE listede olmayanlar:
 *  - yerelAdres, disAdres: erişim anahtarı bu adreslere gider; klasörden değişirse anahtar başka bir sunucuya yönlendirilebilirdi.
 *  - dış ağ seçenekleri (surumDenetimi, klasorEsitleme...), otomatikBaslat, canliBaglanti: işletim sistemi ya da makineye özgü davranış.
 *  - pencere konumları, tercih edilen ekran, masaüstü karo konumları: makineye özgü.
 *  - erişim anahtarı, yenileme anahtarı, özel üstbilgi değerleri, sertifika güveni, parola: hiçbir zaman ayar nesnesinde yoktur.
 */

const path = require('node:path');

const BOLUMLER = Object.freeze({
  // Favori karolar, Home Assistant panoları ve panel sayfaları (karo başına kısayol, simge, renk, boyut dahil)
  favoriler: Object.freeze(['favoriler', 'panolar', 'sayfalar']),
  // Genel kısayollar (panel, palet, geri al) ve tepsi tıklaması
  kisayollar: Object.freeze(['kisayol', 'paletKisayol', 'geriAlKisayolu', 'tepsiSolTik']),
  // Tema, renkler, metin boyutu, animasyonlar, pencere boyutu ve opaklığı, panel gruplaması ve fare tekerleği
  gorunum: Object.freeze([
    'temaZorla',
    'vurguRengi',
    'yeniPencereMalzemesi',
    'pencereBoyutu',
    'panelOpaklik',
    'metinOlcegi',
    'yuksekKarsitlik',
    'panelTemasi',
    'panelVurguRengi',
    'panelArkaPlani',
    'animasyonlar',
    'animasyonGecisleri',
    'havaEfekti',
    'mevsimEfekti',
    'hareketiAzalt',
    'panelGruplama',
    'karoTekerlegi',
  ]),
  // Sensör şeridi, üst kartlar (hava tahmini, birincil medya oynatıcı, albüm kapağı), saat/tarih biçimi, takvim ve yapılacaklar, tepsi rozeti
  bilgi: Object.freeze([
    'sensorSeridi',
    'sensorGrafik',
    'sensorGrafikSaat',
    'pilEsigi',
    'sensorTepsiIpucu',
    'ustKart1',
    'ustKart2',
    'havaVarligi',
    'havaTahmini',
    'birincilMedya',
    'medyaKapagi',
    'saatBicimi',
    'tarihBicimi',
    'takvimler',
    'takvimGunSayisi',
    'yapilacakListeleri',
    'hizliListe',
    'tepsiRozeti',
    'tepsiRozetSensoru',
  ]),
  // Köşe bildirimi, bip sesi, bildirim merkezi seçenekleri ve varlık uyarı kuralları
  bildirim: Object.freeze([
    'koseBildirimi',
    'bipSesi',
    'bildirimKalici',
    'bildirimPil',
    'bildirimGuncelleme',
    'bildirimPilEsigi',
    'bildirimMasaustu',
    'uyariKurallari',
  ]),
});

const BOLUM_ADLARI = Object.freeze(Object.keys(BOLUMLER));
const AYGIT_DESENI = /^[0-9a-f]{16}$/;
const OZET_DESENI = /^[0-9a-f]{32}$/;
const EN_COK_ZAMAN = 8_640_000_000_000_000; // Date'in en büyük değeri
const KLASOR_YOLU_SINIRI = 400;

const duzNesne = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/** Eşitleme klasörü: mutlak, denetim karakteri içermeyen kısa yol ('' = seçilmedi). Geçersizse undefined (ayar-alanlari kalıbı). */
function klasorYoluDuzelt(ham) {
  if (typeof ham !== 'string') return undefined;
  const yol = ham.trim();
  if (yol === '') return '';
  // eslint-disable-next-line no-control-regex
  if (yol.length > KLASOR_YOLU_SINIRI || /[\u0000-\u001f]/.test(yol)) return undefined;
  return path.win32.isAbsolute(yol) || path.posix.isAbsolute(yol) ? yol : undefined;
}

/** Eşitlenecek bölüm adları: bilinen adlar, tekrarsız, sabit sırada (BOLUM_ADLARI sırası). Dizi değilse undefined. */
function bolumListesiDuzelt(ham) {
  if (!Array.isArray(ham)) return undefined;
  return BOLUM_ADLARI.filter((ad) => ham.includes(ad));
}

/** Bölüm başına yerel eşitleme kaydı { ozet, zaman, aygit }; bozuk girdiler sessizce düşer. */
function bolumKaydiDuzelt(ham) {
  if (!duzNesne(ham)) return null;
  if (typeof ham.ozet !== 'string' || !OZET_DESENI.test(ham.ozet)) return null;
  if (!Number.isSafeInteger(ham.zaman) || ham.zaman < 0 || ham.zaman > EN_COK_ZAMAN) return null;
  if (typeof ham.aygit !== 'string' || (ham.aygit !== '' && !AYGIT_DESENI.test(ham.aygit))) return null;
  return { ozet: ham.ozet, zaman: ham.zaman, aygit: ham.aygit };
}

/**
 * Eşitleme durumu (ayar dosyasında, makineye özgü): { aygit?: 16 onaltılık hane, bolumler?: { <bölüm>: { ozet, zaman, aygit } } }.
 * Kimlik (aygit) bu bilgisayarı eşitleme dosyasında tanıtan rastgele bir değerdir; hiçbir gizli bilgi taşımaz.
 */
function durumDuzelt(ham) {
  if (!duzNesne(ham)) return undefined;
  const sonuc = {};
  if (typeof ham.aygit === 'string' && AYGIT_DESENI.test(ham.aygit)) sonuc.aygit = ham.aygit;
  if (duzNesne(ham.bolumler)) {
    const bolumler = {};
    for (const ad of BOLUM_ADLARI) {
      const kayit = bolumKaydiDuzelt(ham.bolumler[ad]);
      if (kayit) bolumler[ad] = kayit;
    }
    if (Object.keys(bolumler).length > 0) sonuc.bolumler = bolumler;
  }
  return sonuc;
}

module.exports = {
  BOLUMLER,
  BOLUM_ADLARI,
  AYGIT_DESENI,
  OZET_DESENI,
  EN_COK_ZAMAN,
  klasorYoluDuzelt,
  bolumListesiDuzelt,
  bolumKaydiDuzelt,
  durumDuzelt,
};
