'use strict';

/**
 * "Windows açılınca başlat" ayarının GERÇEK durumu (saf).
 * Ayar yalnız yazılırsa Görev Yöneticisi > Başlangıç'tan kapatılmış olması fark edilmez ve
 * tepsideki kutu hâlâ işaretli görünür (pencere-08). `s`, app.getLoginItemSettings() sonucudur.
 *
 * Durumlar:
 *  gelistirme       paketlenmemiş sürümde kayıt defterine yazılmaz
 *  kapali           kullanıcı ayarda kapatmış
 *  etkin            Windows açılışta çalıştıracak
 *  windows-kapatmis kayıt var ama Windows Başlangıç ayarlarında devre dışı
 *  kayit-yok        ayar açık ama kayıt defterinde kayıt yok
 *  belirsiz         kayıt var, durumu net okunamadı
 */

const { TR } = require('./ceviri-varsayilan');

// Durum iletileri src/lib/ceviri/ana.js sözlüğündedir ('oturum.<durum>'); 'kapali' için ileti yoktur (boş metin).
const MESAJ_ANAHTARLI_DURUMLAR = new Set(['gelistirme', 'etkin', 'windows-kapatmis', 'kayit-yok', 'belirsiz']);

const yolKarsilastir = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();

/**
 * @param {{paketli:boolean, ayarAcik:boolean, s:object|null, ad:string, yol?:string, t?:Function}} girdi t: çevirmen (verilmezse Türkçe)
 * @returns {{durum:string, mesaj:string}}
 */
function oturumAcilisiDurumu({ paketli, ayarAcik, s, ad, yol, t = TR }) {
  const sonuc = (durum) => ({ durum, mesaj: MESAJ_ANAHTARLI_DURUMLAR.has(durum) ? t(`oturum.${durum}`) : '' });
  if (!paketli) return sonuc('gelistirme');
  if (!ayarAcik) return sonuc('kapali');
  if (!s || typeof s !== 'object') return sonuc('belirsiz'); // okunamadı: durum uydurulmaz
  if (s.executableWillLaunchAtLogin === true) return sonuc('etkin');
  const ogeler = Array.isArray(s.launchItems) ? s.launchItems.filter((o) => o && typeof o === 'object') : [];
  const bizimkiler = ogeler.filter((o) => o.name === ad || (yol && yolKarsilastir(o.path, yol)));
  if (bizimkiler.length === 0) return sonuc('kayit-yok');
  if (bizimkiler.some((o) => o.enabled === false)) return sonuc('windows-kapatmis');
  return sonuc('belirsiz');
}

module.exports = { oturumAcilisiDurumu };
