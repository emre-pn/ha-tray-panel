'use strict';

/**
 * Kozmetik panel efektleri: hava (yağmur, kar, güneş, fırtına) ve mevsim (çiçek, parıltı, yaprak, kar) — o-34 (saf; Electron'a bağlı değildir).
 *
 * Bu dosya efekt SEÇİMİNİ ve parçacık matematiğini/çizimini içerir; canvas'ı bağlayan, döngüyü yöneten ve ayarları dinleyen parça
 * src/yuzey-gorunum.js'tedir. Her şey yalnız görsel zevk içindir: efekt hiçbir eylem, ağ isteği ya da veri okuması yapmaz; hava durumu
 * yalnız karo modelindeki beyaz listeli `durum` değerinden (varlik-ozellik.js HAVA_DURUMLARI) gelir, metin hiç kullanılmaz.
 *
 * Hareket ve erişilebilirlik: efektSec, hareket azaltılmışsa (ayar ya da sistem) HİÇBİR efekt seçmez. Fırtına şimşeği nadirdir (en erken 7 sn arayla),
 * tek ve yumuşak sönümlenen düşük parlaklıklı bir ışıktır (saniyede 3 kez yanıp sönme sınırının çok altında). Parçacık sayısı pencere alanıyla
 * orantılıdır ve üst sınırlıdır; çizim döngüsü kare başına en çok ~30 fps çalışır (yuzey-gorunum.js).
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/efekt.js">, window.EvEfekt) çalışır: `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvEfekt = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EFEKTLER = Object.freeze(['yagmur', 'kar', 'gunes', 'firtina', 'cicek', 'parilti', 'yaprak']);
  const HAVA_EFEKTLERI = Object.freeze(['yagmur', 'kar', 'gunes', 'firtina']);

  // HA weather durumu -> hava efekti. Listede olmayan durum (bulutlu, sis, açık gece...) efekt üretmez.
  const HAVA_DURUMU_EFEKTI = Object.freeze({
    rainy: 'yagmur',
    pouring: 'yagmur',
    hail: 'yagmur',
    snowy: 'kar',
    'snowy-rainy': 'kar',
    sunny: 'gunes',
    lightning: 'firtina',
    'lightning-rainy': 'firtina',
  });
  const MEVSIM_EFEKTI = Object.freeze({ ilkbahar: 'cicek', yaz: 'parilti', sonbahar: 'yaprak', kis: 'kar' });

  const TABAN_ALAN = 360 * 420; // yuzey.css panel boyutu: parçacık sayıları bu alan için verilir
  const TABAN_SAYI = Object.freeze({ yagmur: 70, firtina: 110, kar: 45, gunes: 10, cicek: 18, parilti: 16, yaprak: 16 });
  const EN_COK_PARCACIK = 220;
  const EN_COK_ADIM_MS = 64; // uzun duraklamadan sonra parçacıklar sıçramasın
  const SIMSEK_ARALIK_MS = Object.freeze([7000, 14000]);
  const SIMSEK_SURE_MS = 450;
  const SIMSEK_EN_COK_ALFA = 0.12;

  // Açık temada beyaz kar görünmez: iki tema için ayrı renkler (alfa 0..1).
  const RENKLER = Object.freeze({
    koyu: Object.freeze({ yagmur: '147, 197, 253', kar: '255, 255, 255', gunes: '253, 224, 71', cicek: '244, 114, 182', parilti: '253, 224, 71', yaprak: '251, 146, 60', simsek: '255, 255, 255' }),
    acik: Object.freeze({ yagmur: '37, 99, 235', kar: '71, 85, 105', gunes: '217, 119, 6', cicek: '219, 39, 119', parilti: '161, 98, 7', yaprak: '194, 65, 12', simsek: '255, 255, 255' }),
  });

  /** Ay (0..11, Ocak = 0) -> mevsim adı (kuzey yarım küre): Mart-Mayıs ilkbahar, Haziran-Ağustos yaz, Eylül-Kasım sonbahar, Aralık-Şubat kış. */
  function mevsimAdi(ay) {
    if (!Number.isInteger(ay) || ay < 0 || ay > 11) return null;
    if (ay >= 2 && ay <= 4) return 'ilkbahar';
    if (ay >= 5 && ay <= 7) return 'yaz';
    if (ay >= 8 && ay <= 10) return 'sonbahar';
    return 'kis';
  }

  /**
   * Hangi efekt çalışsın? Hava efekti mevsim efektinden önce gelir (aynı anda yalnız bir efekt).
   * @param {object} p
   * @param {{ hava?: string, mevsim?: string }|null} p.animasyon ana sürecin gönderdiği görünüm modelindeki animasyon (null: animasyonlar kapalı)
   * @param {boolean} [p.hareketAzalt] ayar ya da sistem "hareketi azalt"
   * @param {string|null} [p.havaDurumu] paneldeki ilk hava karosunun durumu (weather)
   * @param {number} [p.ay] 0..11
   * @returns {string|null} EFEKTLER üyesi ya da null
   */
  function efektSec({ animasyon, hareketAzalt = false, havaDurumu = null, ay } = {}) {
    if (!animasyon || typeof animasyon !== 'object' || hareketAzalt === true) return null;
    const hava = animasyon.hava;
    if (HAVA_EFEKTLERI.includes(hava)) return hava;
    if (hava === 'otomatik' && typeof havaDurumu === 'string' && Object.hasOwn(HAVA_DURUMU_EFEKTI, havaDurumu)) return HAVA_DURUMU_EFEKTI[havaDurumu];
    const mevsim = animasyon.mevsim === 'otomatik' ? mevsimAdi(ay) : animasyon.mevsim;
    return typeof mevsim === 'string' && Object.hasOwn(MEVSIM_EFEKTI, mevsim) ? MEVSIM_EFEKTI[mevsim] : null;
  }

  /** Model (yuzey:durum) içindeki ilk hava karosunun durumu; yoksa null. Yalnız beyaz listeli enum olduğu için sayfa bunu güvenle okur. */
  function havaDurumuBul(model) {
    const gruplar = model && Array.isArray(model.gruplar) ? model.gruplar : [];
    for (const g of gruplar) {
      for (const k of g && Array.isArray(g.karolar) ? g.karolar : []) {
        if (k && k.alan === 'weather' && k.ozellik && typeof k.ozellik.durum === 'string') return k.ozellik.durum;
      }
    }
    return null;
  }

  const aralik = (rastgele, a, b) => a + (b - a) * rastgele();

  /** Pencere alanına göre parçacık sayısı (taban sayının 0,6..2 katı, en çok EN_COK_PARCACIK). */
  function parcacikSayisi(tur, genislik, yukseklik) {
    const taban = TABAN_SAYI[tur] ?? 0;
    const oran = Math.min(2, Math.max(0.6, (genislik * yukseklik) / TABAN_ALAN));
    return Math.min(EN_COK_PARCACIK, Math.round(taban * oran));
  }

  function parcacikOlustur(tur, w, h, rastgele, baslangic) {
    const x = rastgele() * w;
    const y = baslangic ? rastgele() * h : -aralik(rastgele, 4, 40);
    switch (tur) {
      case 'yagmur':
      case 'firtina': {
        const hizli = tur === 'firtina';
        return { x, y, vx: hizli ? -160 : -70, vy: aralik(rastgele, hizli ? 720 : 520, hizli ? 980 : 760), uzunluk: aralik(rastgele, hizli ? 12 : 9, hizli ? 22 : 16), alfa: aralik(rastgele, 0.25, 0.55) };
      }
      case 'kar':
        return { x, y, vx: 0, vy: aralik(rastgele, 22, 52), r: aralik(rastgele, 1.1, 3), faz: aralik(rastgele, 0, Math.PI * 2), salinim: aralik(rastgele, 8, 24), alfa: aralik(rastgele, 0.45, 0.85) };
      case 'cicek':
        return { x, y, vx: aralik(rastgele, -14, 8), vy: aralik(rastgele, 26, 54), r: aralik(rastgele, 2.2, 4), faz: aralik(rastgele, 0, Math.PI * 2), salinim: aralik(rastgele, 10, 26), aci: aralik(rastgele, 0, Math.PI * 2), donus: aralik(rastgele, -2, 2), alfa: aralik(rastgele, 0.5, 0.85) };
      case 'yaprak':
        return { x, y, vx: aralik(rastgele, -18, 6), vy: aralik(rastgele, 30, 64), r: aralik(rastgele, 3, 5.5), faz: aralik(rastgele, 0, Math.PI * 2), salinim: aralik(rastgele, 12, 30), aci: aralik(rastgele, 0, Math.PI * 2), donus: aralik(rastgele, -2.5, 2.5), alfa: aralik(rastgele, 0.5, 0.85) };
      case 'parilti':
        return { x, y: rastgele() * h, vx: aralik(rastgele, -6, 6), vy: aralik(rastgele, -8, 4), r: aralik(rastgele, 1.4, 2.8), faz: aralik(rastgele, 0, Math.PI * 2), hiz: aralik(rastgele, 0.6, 1.6), alfa: 1 };
      case 'gunes':
        return { x: w - aralik(rastgele, 0, w * 0.5), y: rastgele() * h * 0.5, vx: aralik(rastgele, -4, 4), vy: aralik(rastgele, -3, 3), r: aralik(rastgele, 1.2, 2.4), faz: aralik(rastgele, 0, Math.PI * 2), hiz: aralik(rastgele, 0.4, 1.1), alfa: 1 };
      default:
        return { x, y, vx: 0, vy: 0, r: 1, alfa: 0 };
    }
  }

  /**
   * Efektin başlangıç durumu. `rastgele`: () => [0,1) (testte sahte).
   * @returns {{ tur: string, w: number, h: number, t: number, parcaciklar: object[], simsek: { bekle: number, kalan: number } }}
   */
  function olustur(tur, w, h, rastgele = Math.random) {
    if (!EFEKTLER.includes(tur)) throw new Error('efekt: unknown kind');
    const genislik = Math.max(1, Math.round(w));
    const yukseklik = Math.max(1, Math.round(h));
    const sayi = parcacikSayisi(tur, genislik, yukseklik);
    const parcaciklar = [];
    for (let i = 0; i < sayi; i += 1) parcaciklar.push(parcacikOlustur(tur, genislik, yukseklik, rastgele, true));
    return { tur, w: genislik, h: yukseklik, t: 0, parcaciklar, simsek: { bekle: aralik(rastgele, SIMSEK_ARALIK_MS[0], SIMSEK_ARALIK_MS[1]), kalan: 0 } };
  }

  /** Zamanı `dtMs` ilerletir (yerinde); ekrandan çıkan parçacık üstten yeniden doğar. */
  function adim(durum, dtMs, rastgele = Math.random) {
    const dt = Math.min(EN_COK_ADIM_MS, Math.max(0, Number(dtMs) || 0)) / 1000;
    durum.t += dt;
    const { w, h, tur } = durum;
    for (const p of durum.parcaciklar) {
      if (tur === 'parilti' || tur === 'gunes') {
        p.faz += p.hiz * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0) p.x += w;
        else if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += tur === 'gunes' ? h * 0.5 : h;
        else if (p.y > (tur === 'gunes' ? h * 0.5 : h)) p.y -= tur === 'gunes' ? h * 0.5 : h;
        continue;
      }
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      if (p.faz !== undefined) {
        p.faz += dt * 1.6;
        p.x += Math.sin(p.faz) * p.salinim * dt;
      }
      if (p.aci !== undefined) p.aci += p.donus * dt;
      if (p.y > h + 24 || p.x < -30 || p.x > w + 30) Object.assign(p, parcacikOlustur(tur, w, h, rastgele, false), tur === 'yagmur' || tur === 'firtina' ? { x: rastgele() * (w + 60) } : {});
    }
    if (tur === 'firtina') {
      const s = durum.simsek;
      if (s.kalan > 0) s.kalan = Math.max(0, s.kalan - dt * 1000);
      else {
        s.bekle -= dt * 1000;
        if (s.bekle <= 0) {
          s.kalan = SIMSEK_SURE_MS;
          s.bekle = aralik(rastgele, SIMSEK_ARALIK_MS[0], SIMSEK_ARALIK_MS[1]);
        }
      }
    }
    return durum;
  }

  /** Şimşeğin o anki alfa değeri (0 = yok). Yumuşak sönümlenir; en çok SIMSEK_EN_COK_ALFA. */
  function simsekAlfasi(durum) {
    const k = durum.simsek ? durum.simsek.kalan : 0;
    if (!(k > 0)) return 0;
    return SIMSEK_EN_COK_ALFA * (k / SIMSEK_SURE_MS) ** 2;
  }

  const rgba = (rgb, alfa) => `rgba(${rgb}, ${Math.max(0, Math.min(1, alfa)).toFixed(3)})`;

  /**
   * Efekti `ctx` (CanvasRenderingContext2D) üzerine çizer; önce tuvali temizler. Fare olaylarını etkilemez (tuval pointer-events: none).
   * @param {'koyu'|'acik'} [sema] renk takımı (açık temada beyaz yerine koyu tonlar)
   */
  function ciz(ctx, durum, sema = 'koyu') {
    const renk = RENKLER[sema === 'acik' ? 'acik' : 'koyu'];
    ctx.clearRect(0, 0, durum.w, durum.h);
    switch (durum.tur) {
      case 'yagmur':
      case 'firtina': {
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        for (const p of durum.parcaciklar) {
          ctx.strokeStyle = rgba(renk.yagmur, p.alfa);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + (p.vx / p.vy) * p.uzunluk, p.y + p.uzunluk);
          ctx.stroke();
        }
        const flas = simsekAlfasi(durum);
        if (flas > 0) {
          ctx.fillStyle = rgba(renk.simsek, flas);
          ctx.fillRect(0, 0, durum.w, durum.h);
        }
        break;
      }
      case 'kar':
        for (const p of durum.parcaciklar) {
          ctx.fillStyle = rgba(renk.kar, p.alfa);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'cicek':
      case 'yaprak':
        for (const p of durum.parcaciklar) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.aci);
          ctx.fillStyle = rgba(durum.tur === 'cicek' ? renk.cicek : renk.yaprak, p.alfa);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * (durum.tur === 'cicek' ? 0.55 : 0.7), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      case 'parilti':
        for (const p of durum.parcaciklar) {
          const alfa = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(p.faz));
          ctx.fillStyle = rgba(renk.parilti, alfa);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'gunes': {
        // Sağ üst köşede yavaşça nefes alan sıcak ışık + birkaç süzülen toz zerresi
        const nefes = 0.5 + 0.5 * Math.sin(durum.t * 0.6);
        const merkezX = durum.w * 0.92;
        const merkezY = 0;
        const yaricap = Math.max(durum.w, durum.h) * (0.55 + 0.05 * nefes);
        const gradyan = ctx.createRadialGradient(merkezX, merkezY, 0, merkezX, merkezY, yaricap);
        gradyan.addColorStop(0, rgba(renk.gunes, 0.1 + 0.07 * nefes));
        gradyan.addColorStop(1, rgba(renk.gunes, 0));
        ctx.fillStyle = gradyan;
        ctx.fillRect(0, 0, durum.w, durum.h);
        for (const p of durum.parcaciklar) {
          ctx.fillStyle = rgba(renk.gunes, 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(p.faz)));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    EFEKTLER,
    HAVA_EFEKTLERI,
    HAVA_DURUMU_EFEKTI,
    MEVSIM_EFEKTI,
    EN_COK_PARCACIK,
    EN_COK_ADIM_MS,
    SIMSEK_ARALIK_MS,
    SIMSEK_EN_COK_ALFA,
    mevsimAdi,
    efektSec,
    havaDurumuBul,
    parcacikSayisi,
    olustur,
    adim,
    simsekAlfasi,
    ciz,
  };
});
