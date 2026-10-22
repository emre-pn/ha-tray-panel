'use strict';

/**
 * Arayüz ikon seti (1.7.0 "Kumanda Merkezi"): panelin üst bölümü, bildirim hapı, sensör çipleri, medya hapı ve alt çubuk için çizgi ikonlar.
 * Karo simgelerinden (lib/karo-gorunum.js IKONLAR, kullanıcının seçtiği simge) AYRIDIR: bunlar arayüzün kendi işaretleridir.
 *
 * 24x24 görünüm kutusu, 1,75 çizgi, iki ton: her parça [yol, dolgu?, kalınlık?, dönüş?]. dolgu 1 = yarı saydam ton (%20), 2 = tam dolu.
 * Çizim YALNIZ createElementNS + setAttribute iledir (HTML dizgesi atanmaz, CSP'ye uygun); renk currentColor'dan gelir.
 * Kapı, kilit, anahtar, siren ikonu bu sette YOKTUR (kapı kuralı).
 *
 * Hem Node'da (require; testler) hem renderer'da (<script src="lib/ikon-seti.js">, window.EvIkonSeti) çalışır.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvIkonSeti = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BULUT = 'M7 18.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.4 1.6A3.4 3.4 0 0 0 7 18.5z';
  const YUKSEK_BULUT = 'M7 15h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.4 1.6A3.3 3.3 0 0 0 7 15z';

  const IKONLAR = Object.freeze({
    zil: [['M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z', 1], ['M10 20.5a2 2 0 0 0 4 0']],
    asagi: [['M6 9l6 6 6-6']],
    igne: [['M9 3.5h6l-1 5.5 3 3H7l3-3z', 1], ['M12 12v8.5']],
    daha: [['M6 12h.01M12 12h.01M18 12h.01', 0, 3]],
    oynat: [['M8 5.5v13l10.5-6.5z', 2]],
    duraklat: [['M8.5 5.5v13M15.5 5.5v13', 0, 2.4]],
    ileri: [['M6 6l8.5 6L6 18z', 2], ['M18 6v12']],
    ev: [['M3.5 11L12 3.5l8.5 7.5'], ['M5.5 9.5V20.5h13V9.5', 1]],
    ayar: [['M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z', 1], ['M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1']],
    geriAl: [['M9 14L4 9l5-5'], ['M4 9h10a6 6 0 0 1 0 12h-3']],
    termometre: [['M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z', 1], ['M12 9v6']],
    damla: [['M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z', 1]],
    simsek: [['M13 2.5L4.5 14H11l-1 7.5L18.5 10H12z', 1]],
    pil: [['M3.5 8h14v8h-14z', 1], ['M20.5 11v2']],
    nokta: [['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 2]],
    // Hava (Home Assistant weather durumları; havaIkonAdi eşler)
    gunes: [['M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z', 1], ['M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']],
    gece: [['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z', 1]],
    parcali: [['M8.5 5.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z', 1], ['M8.5 1.8v1.4M3.6 9H2.2M5 5.5l-1-1M12 5.5l1-1'], ['M8 19.5h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.4 1.6A3.3 3.3 0 0 0 8 19.5z', 1]],
    bulut: [[BULUT, 1]],
    yagmur: [[YUKSEK_BULUT, 1], ['M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5']],
    kar: [[YUKSEK_BULUT, 1], ['M8 19h.01M12 20.5h.01M16 19h.01', 0, 2.6]],
    firtina: [[YUKSEK_BULUT, 1], ['M12.5 15.5l-2 3.5h3l-2 3.5']],
    sis: [['M4 9h16M6 13h12M4 17h16']],
    ruzgar: [['M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8']],
  });
  const IKON_ADLARI = Object.freeze(Object.keys(IKONLAR));

  const HAVA_IKONLARI = Object.freeze({
    sunny: 'gunes',
    'clear-night': 'gece',
    partlycloudy: 'parcali',
    cloudy: 'bulut',
    exceptional: 'bulut',
    rainy: 'yagmur',
    pouring: 'yagmur',
    hail: 'kar',
    snowy: 'kar',
    'snowy-rainy': 'kar',
    lightning: 'firtina',
    'lightning-rainy': 'firtina',
    fog: 'sis',
    windy: 'ruzgar',
    'windy-variant': 'ruzgar',
  });

  /** Home Assistant hava durumunun ikonu; bilinmeyen durumda null. */
  function havaIkonAdi(durum) {
    return typeof durum === 'string' && Object.hasOwn(HAVA_IKONLARI, durum) ? HAVA_IKONLARI[durum] : null;
  }

  // Sensör çipi: önce cihaz sınıfı (device_class), yoksa birim; ikisi de tanınmazsa küçük nokta.
  const SINIF_IKONLARI = Object.freeze({
    temperature: 'termometre',
    humidity: 'damla',
    moisture: 'damla',
    power: 'simsek',
    energy: 'simsek',
    current: 'simsek',
    voltage: 'simsek',
    apparent_power: 'simsek',
    battery: 'pil',
    illuminance: 'gunes',
  });
  const BIRIM_IKONLARI = Object.freeze({ '°C': 'termometre', '°F': 'termometre', K: 'termometre', W: 'simsek', kW: 'simsek', kWh: 'simsek', Wh: 'simsek', V: 'simsek', A: 'simsek', lx: 'gunes' });

  /** @param {{sinif?: string|null, birim?: string|null}|null} ozellik sensör özelliği (yuzey-bilgi.js ozellikDuzelt) */
  function sensorIkonAdi(ozellik) {
    const o = ozellik && typeof ozellik === 'object' ? ozellik : {};
    if (typeof o.sinif === 'string' && Object.hasOwn(SINIF_IKONLARI, o.sinif)) return SINIF_IKONLARI[o.sinif];
    if (typeof o.birim === 'string' && Object.hasOwn(BIRIM_IKONLARI, o.birim)) return BIRIM_IKONLARI[o.birim];
    return 'nokta';
  }

  const NS = 'http://www.w3.org/2000/svg';

  /**
   * İkon öğesi (süs: aria-hidden). Bilinmeyen ad ya da SVG oluşturamayan belge için null.
   * @param {Document} belge
   * @param {string} ad IKONLAR anahtarı
   * @param {number} [boyut] piksel (varsayılan 18)
   * @param {string} [sinif]
   */
  function ikon(belge, ad, boyut, sinif) {
    if (!belge || typeof belge.createElementNS !== 'function' || !Object.hasOwn(IKONLAR, ad)) return null;
    const svg = belge.createElementNS(NS, 'svg');
    const olcu = String(Number.isFinite(boyut) && boyut > 0 ? boyut : 18);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', olcu);
    svg.setAttribute('height', olcu);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'ikon' + (sinif ? ' ' + sinif : ''));
    IKONLAR[ad].forEach(function (parca) {
      const yol = belge.createElementNS(NS, 'path');
      yol.setAttribute('d', parca[0]);
      if (parca[3]) yol.setAttribute('transform', 'rotate(' + parca[3] + ' 12 12)');
      yol.setAttribute('stroke', 'currentColor');
      yol.setAttribute('stroke-width', String(parca[2] || 1.75));
      yol.setAttribute('stroke-linecap', 'round');
      yol.setAttribute('stroke-linejoin', 'round');
      if (parca[1] === 1) {
        yol.setAttribute('fill', 'currentColor');
        yol.setAttribute('fill-opacity', '0.2');
      } else if (parca[1] === 2) {
        yol.setAttribute('fill', 'currentColor');
      } else {
        yol.setAttribute('fill', 'none');
      }
      svg.appendChild(yol);
    });
    return svg;
  }

  return { IKONLAR, IKON_ADLARI, HAVA_IKONLARI, havaIkonAdi, sensorIkonAdi, ikon };
});
