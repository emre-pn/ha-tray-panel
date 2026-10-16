'use strict';

/**
 * "Yenilikler" (o-40; saf): CHANGELOG.md içinden çalışan sürümün bölümünü düz metne çevirir.
 * Ağ yoktur: not dosyası uygulamayla birlikte paketlenir. Çıktı renderer'da yalnız textContent ile yazılır (HTML değildir).
 */

const { surumCoz } = require('./surum-denetimi');

const BASLIK_DESENI = /^#{2,4}\s+\[?v?(\d{1,5}\.\d{1,5}\.\d{1,5})\]?(.*)$/;
const HERHANGI_BASLIK = /^#{1,6}\s/;
const SINIRLAR = Object.freeze({ enCokKarakter: 6000, enCokSatir: 60, satirSiniri: 600 });

/** Kod noktası sayısına göre keser; kesilirse sona "…" konur (vekil çiftleri bölünmez). */
function kes(metin, enFazla) {
  const harfler = Array.from(metin);
  return harfler.length <= enFazla ? metin : `${harfler.slice(0, enFazla - 1).join('').trimEnd()}…`;
}

/** Satır içi işaretleri atar: **kalın**, `kod`, [bağlantı](adres) -> bağlantı metni; liste imi "•" olur. */
function duzMetin(satir) {
  let s = String(satir).replace(/\s+$/, '');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/^(\s*)[-*]\s+/, '$1• ');
  return s;
}

/**
 * @param {string} icerik CHANGELOG.md metni
 * @param {string} surum çalışan sürüm ("1.3.0")
 * @returns {{ bulundu: boolean, baslik: string, metin: string }} bulunamazsa { bulundu: false, baslik: '', metin: '' }
 */
function yenilikleriAyikla(icerik, surum, sinir = SINIRLAR) {
  const hedef = surumCoz(surum);
  const bos = { bulundu: false, baslik: '', metin: '' };
  if (!hedef || typeof icerik !== 'string') return bos;
  const satirlar = icerik.split(/\r?\n/);
  let bas = -1;
  let baslik = '';
  for (let i = 0; i < satirlar.length; i += 1) {
    const e = BASLIK_DESENI.exec(satirlar[i]);
    if (!e) continue;
    const bulunan = surumCoz(e[1]);
    if (bulunan && bulunan.ana === hedef.ana && bulunan.alt === hedef.alt && bulunan.yama === hedef.yama) {
      bas = i + 1;
      const tarih = e[2].replace(/^\s*[—–-]\s*/, '').trim();
      baslik = tarih ? `${e[1]} — ${tarih}` : e[1];
      break;
    }
  }
  if (bas < 0) return bos;
  const cikti = [];
  let karakter = 0;
  let kesildi = false;
  for (let i = bas; i < satirlar.length; i += 1) {
    if (HERHANGI_BASLIK.test(satirlar[i])) break;
    const satir = kes(duzMetin(satirlar[i]), sinir.satirSiniri);
    if (satir === '' && (cikti.length === 0 || cikti[cikti.length - 1] === '')) continue; // baştaki ve art arda boş satırlar
    if (cikti.length >= sinir.enCokSatir || karakter + satir.length > sinir.enCokKarakter) {
      kesildi = true;
      break;
    }
    cikti.push(satir);
    karakter += satir.length + 1;
  }
  while (cikti.length > 0 && cikti[cikti.length - 1] === '') cikti.pop();
  if (kesildi) cikti.push('…');
  return { bulundu: true, baslik, metin: cikti.join('\n') };
}

module.exports = { SINIRLAR, duzMetin, yenilikleriAyikla };
