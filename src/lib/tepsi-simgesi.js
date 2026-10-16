'use strict';

/**
 * Tepsi simgesi çizimi ve canlı rozet (saf; Electron'a bağlı değildir) — 1.4.0 o-27.
 *
 * Bağımlılıksız PNG: ev simgesi (araclar/ikon-uret.js'in çizimi, aynı kod) çalışma anında istenen boyutta çizilir ve sağ alt köşeye
 * küçük bir rakam rozeti konur: açık favori ışık sayısı ya da seçilen sensörün kısa değeri. Rozet metni EN ÇOK 3 karakterdir
 * (0-9 . - + k); ışık sayısı 0 ise rozet yoktur. Rozet Kapı Kuralı'ndan geçmiş veriden üretilir: sensör varlığı guvenliVarlikMi'den
 * ve alan denetiminden geçmezse rozet çizilmez.
 *
 * Çizim 16 birimlik ızgarada yapılır (3x5 piksel yazı tipi); boyut 16'dan büyükse (Windows ölçekleme: 125% -> 20, 150% -> 24,
 * 200% -> 32) hücreler orantılı büyür. 16 pikselde okunaklılığı ve Windows 11 taşma alanındaki davranışı bu ortamda DENENMEDİ.
 *
 * Bu dosya araclar/ikon-uret.js tarafından da kullanılır (assets/ikon*.png/.ico dosyaları aynı çizimden çıkar).
 */

const zlib = require('node:zlib');
const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');
const { guvenliOzellikler } = require('./varlik-ozellik');

const SOLUK_ALFA = 0.45;
const IZGARA = 16; // rozet çizim ızgarası (birim)
const EN_COK_ROZET_KARAKTERI = 3;
const EN_AZ_BOYUT = 16;
const EN_COK_BOYUT = 64;
const VARSAYILAN_ARALIK_MS = 1000; // simge en çok saniyede bir değişir

// --- PNG kodlama (bağımlılıksız) ----------------------------------------------------------------------------------------------

const crcTablosu = (() => {
  const tablo = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tablo[i] = c >>> 0;
  }
  return tablo;
})();

function hesaplaCrc(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTablosu[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkUret(tip, veri) {
  const tipBuf = Buffer.from(tip, 'ascii');
  const uzunlukBuf = Buffer.alloc(4);
  uzunlukBuf.writeUInt32BE(veri.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(hesaplaCrc(Buffer.concat([tipBuf, veri])), 0);
  return Buffer.concat([uzunlukBuf, tipBuf, veri, crcBuf]);
}

/** Ham RGBA piksellerini (boyut x boyut x 4 bayt, satır filtresi baytı YOK) 8 bit RGBA PNG'ye çevirir. */
function pngKodla(boyut, rgba) {
  const imza = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(boyut, 0);
  ihdr.writeUInt32BE(boyut, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 6; // RGBA
  const satirBoyu = boyut * 4;
  const ham = Buffer.alloc((satirBoyu + 1) * boyut);
  for (let y = 0; y < boyut; y++) {
    ham[y * (satirBoyu + 1)] = 0; // satır filtresi: None
    rgba.copy(ham, y * (satirBoyu + 1) + 1, y * satirBoyu, (y + 1) * satirBoyu);
  }
  return Buffer.concat([
    imza,
    chunkUret('IHDR', ihdr),
    chunkUret('IDAT', zlib.deflateSync(ham, { level: 9 })),
    chunkUret('IEND', Buffer.alloc(0)),
  ]);
}

// --- Temel simge (ev) ---------------------------------------------------------------------------------------------------------

/**
 * Belirtilen boyutta ev ve dalga/sinyal simgesinin RGBA pikselleri (boyut x boyut x 4 bayt).
 * soluk: gri tonlama ve alfa x0,45 (bağlantı yokken tepsi simgesi).
 */
function temelRgba(boyut, soluk = false) {
  const rgba = Buffer.alloc(boyut * boyut * 4);
  let ofset = 0;
  const bgR = 15, bgG = 117, bgB = 224; // Home Assistant Mavisi (#0f75e0)
  const fgR = 255, fgG = 255, fgB = 255; // Beyaz
  const koseYaricap = boyut * 0.22;
  const merkez = (boyut - 1) / 2;

  for (let y = 0; y < boyut; y++) {
    for (let x = 0; x < boyut; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      // Yuvarlatılmış kare kart arka planı
      const dx = Math.abs(x - merkez) - (merkez - koseYaricap);
      const dy = Math.abs(y - merkez) - (merkez - koseYaricap);
      let mesafe = 0;
      if (dx > 0 && dy > 0) mesafe = Math.hypot(dx, dy) - koseYaricap;
      else mesafe = Math.max(dx, dy) - koseYaricap;

      if (mesafe <= 0) {
        // Kartın içi
        r = bgR;
        g = bgG;
        b = bgB;
        a = 255;

        // Kart içine Ev Simgesi Çiz (çatı + gövde)
        const nx = (x - merkez) / (boyut * 0.35); // -1..1 aralığı
        const ny = (y - merkez) / (boyut * 0.35); // -1..1 aralığı

        // Çatı: Üçgen
        const catiMi = ny < 0.1 && ny > -0.85 && Math.abs(nx) < (0.85 - (ny + 0.85) * 0.95);
        // Ev gövdesi: Dikdörtgen
        const govdeMi = ny >= 0.05 && ny <= 0.85 && Math.abs(nx) <= 0.65;
        // Kapı boşluğu (ortada ufak açık ton/pencere)
        const kapiMi = ny >= 0.35 && ny <= 0.85 && Math.abs(nx) <= 0.25;

        if ((catiMi || govdeMi) && !kapiMi) {
          r = fgR;
          g = fgG;
          b = fgB;
          a = 255;
        } else if (kapiMi) {
          r = 59;
          g = 130;
          b = 246; // Hafif açık mavi kapı
          a = 255;
        }
      } else if (mesafe < 1.2) {
        // Kenar yumuşatma (antialiasing)
        const alpha = Math.max(0, Math.min(1, 1 - mesafe / 1.2));
        r = bgR;
        g = bgG;
        b = bgB;
        a = Math.round(alpha * 255);
      }

      if (soluk) {
        const gri = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        r = gri;
        g = gri;
        b = gri;
        a = Math.round(a * SOLUK_ALFA);
      }

      rgba[ofset++] = r;
      rgba[ofset++] = g;
      rgba[ofset++] = b;
      rgba[ofset++] = a;
    }
  }
  return rgba;
}

// --- Rozet --------------------------------------------------------------------------------------------------------------------

/** 3x5 piksel yazı tipi (satır satır, '1' = dolu). '.' bir piksel genişliğindedir. */
const GLIFLER = Object.freeze({
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'],
  k: ['101', '101', '110', '101', '101'],
  '.': ['0', '0', '0', '0', '1'],
});
const GLIF_YUKSEKLIGI = 5;
const ROZET_DOLGUSU = 1; // birim
const ROZET_TURLERI = Object.freeze({
  isik: Object.freeze({ zemin: [255, 193, 7], yazi: [17, 24, 39] }), // amber zemin, koyu yazı (kontrast ~11:1)
  sensor: Object.freeze({ zemin: [0, 121, 107], yazi: [255, 255, 255] }), // koyu yeşil-mavi zemin, beyaz yazı (kontrast ~5,3:1)
});

/**
 * Sayıdan en çok 3 karakterlik rozet metni; sonlu değilse ya da 3 karaktere sığmıyorsa null (yanlış değer göstermektense rozet yok).
 * 10'dan küçükse bir ondalık ("9.5", sığmıyorsa tam sayı), büyükse tam sayı; 1000 ve üstü binlik ("2k", "15k"; 99k'yı aşan yok).
 */
function sayiRozetMetni(deger) {
  if (typeof deger !== 'number' || !Number.isFinite(deger)) return null;
  const sigar = (m) => (m.length <= EN_COK_ROZET_KARAKTERI ? m : null);
  const yuvarla = (d) => Math.sign(d) * Math.round(Math.abs(d)); // yarımlar sıfırdan uzağa (-9,5 -> -10; Math.round -9 verirdi)
  if (Math.abs(deger) < 10) {
    const m = sigar(String(yuvarla(deger * 10) / 10)) ?? sigar(String(yuvarla(deger)));
    if (m !== null) return m;
  }
  const tam = sigar(String(yuvarla(deger)));
  if (tam !== null) return tam;
  const bin = Math.round(Math.abs(deger) / 1000);
  if (bin < 1 || bin > 99) return null;
  return sigar(`${deger < 0 ? '-' : ''}${bin}k`);
}

/** Açık ışık sayısından rozet: 0 ya da bilinmiyorsa null; 99'dan büyük sayı "99" olarak gösterilir. */
function isikRozeti(acikIsik) {
  if (!Number.isInteger(acikIsik) || acikIsik <= 0) return null;
  return { tur: 'isik', metin: String(Math.min(acikIsik, 99)) };
}

/**
 * Sensör varlığından rozet. Varlık Kapı Kuralı'ndan geçmeli, alanı 'sensor' olmalı ve durumu sayı olmalıdır; aksi halde null
 * (ulaşılamıyor, bilinmiyor, metin değerli sensör, kapı sözcüklü ad).
 * @param {{entity_id: string, state?: string, attributes?: object}|null|undefined} varlik
 */
function sensorRozeti(varlik) {
  if (!varlik || typeof varlik !== 'object' || typeof varlik.entity_id !== 'string') return null;
  if (alanAl(varlik.entity_id) !== 'sensor' || !guvenliVarlikMi(varlik)) return null;
  const ozellik = guvenliOzellikler(varlik);
  const metin = ozellik && ozellik.sayi !== null ? sayiRozetMetni(ozellik.sayi) : null;
  return metin === null ? null : { tur: 'sensor', metin };
}

/**
 * Rozet seçimi: 'kapali' | 'isik' | 'sensor'. Dönüş: { tur, metin } ya da null (rozet yok).
 * @param {{mod?: string, acikIsik?: number|null, sensorVarligi?: object|null}} g
 */
function rozetBelirle({ mod, acikIsik = null, sensorVarligi = null }) {
  if (mod === 'isik') return isikRozeti(acikIsik);
  if (mod === 'sensor') return sensorRozeti(sensorVarligi);
  return null;
}

/**
 * Sensör rozetinin tepsi ipucu eki: "Salon sıcaklığı: 21,5 °C" (ad ve değer süzgeçten geçmiş, kısa). Rozet yoksa null.
 * Ondalık ayracı yerel dile bırakılır: ham değer metni olduğu gibi yazılır.
 */
function sensorIpucuEki(varlik) {
  if (!sensorRozeti(varlik)) return null;
  const ozellik = guvenliOzellikler(varlik);
  const ad = guvenliMetin(varlik.attributes?.friendly_name, 40);
  const deger = typeof ozellik?.deger === 'string' ? ozellik.deger : null;
  if (!ad || !deger) return null;
  return `${ad}: ${deger}${ozellik.birim ? ` ${ozellik.birim}` : ''}`;
}

function yaziGenisligi(metin) {
  let w = 0;
  for (const karakter of metin) w += GLIFLER[karakter][0].length + 1;
  return w - 1;
}

/**
 * Rozetin 16 birimlik ızgaradaki yerleşimi (saf; sınama için ayrı). Sağ alt köşeye yaslıdır.
 * @returns {{x0:number,y0:number,x1:number,y1:number,glifler:{x:number,y:number,satirlar:string[]}[]}|null}
 */
function rozetYerlesimi(metin) {
  if (typeof metin !== 'string' || metin.length === 0 || metin.length > EN_COK_ROZET_KARAKTERI) return null;
  if ([...metin].some((k) => !Object.hasOwn(GLIFLER, k))) return null;
  const genislik = yaziGenisligi(metin) + 2 * ROZET_DOLGUSU;
  const yukseklik = GLIF_YUKSEKLIGI + 2 * ROZET_DOLGUSU;
  const x0 = IZGARA - genislik;
  const y0 = IZGARA - yukseklik;
  const glifler = [];
  let x = x0 + ROZET_DOLGUSU;
  for (const karakter of metin) {
    const satirlar = GLIFLER[karakter];
    glifler.push({ x, y: y0 + ROZET_DOLGUSU, satirlar });
    x += satirlar[0].length + 1;
  }
  return { x0, y0, x1: IZGARA, y1: IZGARA, glifler };
}

/** Birim koordinatını piksele çevirir (boyut/16 ölçek, en yakın tam piksel; hücreler çakışmaz). */
const pikselDegeri = (birim, boyut) => Math.round((birim * boyut) / IZGARA);

function dolgu(rgba, boyut, px0, py0, px1, py1, renk) {
  for (let y = Math.max(0, py0); y < Math.min(boyut, py1); y++) {
    for (let x = Math.max(0, px0); x < Math.min(boyut, px1); x++) {
      const o = (y * boyut + x) * 4;
      rgba[o] = renk[0];
      rgba[o + 1] = renk[1];
      rgba[o + 2] = renk[2];
      rgba[o + 3] = 255;
    }
  }
}

/** Rozeti RGBA piksellerinin üstüne çizer (yerinde). Geçersiz rozet hiçbir şey çizmez. */
function rozetCiz(rgba, boyut, rozet) {
  const tur = ROZET_TURLERI[rozet?.tur];
  const yerlesim = tur ? rozetYerlesimi(rozet.metin) : null;
  if (!yerlesim) return false;
  const p = (b) => pikselDegeri(b, boyut);
  const kose = Math.max(1, p(1)); // zemin köşeleri kesik (yuvarlak görünüm)
  const x0 = p(yerlesim.x0);
  const y0 = p(yerlesim.y0);
  const x1 = p(yerlesim.x1);
  const y1 = p(yerlesim.y1);
  dolgu(rgba, boyut, x0 + kose, y0, x1 - kose, y1, tur.zemin);
  dolgu(rgba, boyut, x0, y0 + kose, x1, y1 - kose, tur.zemin);
  for (const glif of yerlesim.glifler) {
    glif.satirlar.forEach((satir, sy) => {
      [...satir].forEach((bit, sx) => {
        if (bit === '1') dolgu(rgba, boyut, p(glif.x + sx), p(glif.y + sy), p(glif.x + sx + 1), p(glif.y + sy + 1), tur.yazi);
      });
    });
  }
  return true;
}

function boyutDuzelt(boyut) {
  return Number.isInteger(boyut) ? Math.min(EN_COK_BOYUT, Math.max(EN_AZ_BOYUT, boyut)) : EN_AZ_BOYUT;
}

/**
 * Tepsi simgesi RGBA pikselleri: ev + (varsa) rozet. Bağlantı yokken (soluk) rozet çizilmez: sayılar güvenilir değildir.
 * @param {{boyut?: number, soluk?: boolean, rozet?: {tur: string, metin: string}|null}} g
 */
function simgeRgba({ boyut = EN_AZ_BOYUT, soluk = false, rozet = null } = {}) {
  const b = boyutDuzelt(boyut);
  const rgba = temelRgba(b, soluk);
  if (!soluk && rozet) rozetCiz(rgba, b, rozet);
  return rgba;
}

/** Tepsi simgesi PNG'si (nativeImage.createFromBuffer için). */
function simgePng(g = {}) {
  const b = boyutDuzelt(g.boyut);
  return pngKodla(b, simgeRgba({ ...g, boyut: b }));
}

/** Windows ölçeğinden (1, 1.25, 1.5, 2...) tepsi simgesinin piksel boyutu (SM_CXSMICON karşılığı: 16 * ölçek). */
function tepsiSimgeBoyutu(olcek) {
  return boyutDuzelt(Number.isFinite(olcek) && olcek > 0 ? Math.round(16 * olcek) : EN_AZ_BOYUT);
}

/** Simgenin önbellek/karşılaştırma anahtarı: aynı anahtar = aynı görüntü. */
function simgeAnahtari({ boyut, soluk, rozet }) {
  return `${boyutDuzelt(boyut)}|${soluk ? 's' : 'n'}|${!soluk && rozet && rozetYerlesimi(rozet.metin) && ROZET_TURLERI[rozet.tur] ? `${rozet.tur}:${rozet.metin}` : ''}`;
}

// --- Güncelleme sınırlayıcı ---------------------------------------------------------------------------------------------------

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * Tepsi simgesi değişikliklerini sınırlar: aynı görüntü yeniden yazılmaz, rozet değişimleri en çok `aralikMs`'de bir uygulanır
 * (ilk değişim hemen, aradakilerin SONUNCUSU pencere sonunda). `hizli: true` olan değişim (bağlantı durumu: soluk <-> normal)
 * beklemez. uygula(durum) hata fırlatsa da denetleyici düşmez.
 * @param {{uygula: (durum: object) => void, simdi?: () => number, zaman?: object, aralikMs?: number}} g
 */
function tepsiSimgeDenetleyicisi({ uygula, simdi = () => Date.now(), zaman = varsayilanZaman(), aralikMs = VARSAYILAN_ARALIK_MS }) {
  let uygulanan = null; // en son uygulanan anahtar
  let sonUygulama = -Infinity;
  let bekleyen = null;
  let zamanlayici = null;

  function bekleyeniTemizle() {
    if (zamanlayici !== null) zaman.clearTimeout(zamanlayici);
    zamanlayici = null;
    bekleyen = null;
  }

  function uygulaIc(durum) {
    bekleyeniTemizle();
    uygulanan = durum.anahtar;
    sonUygulama = simdi();
    try {
      uygula(durum);
    } catch {
      /* simge yazılamadı: sonraki değişimde yeniden denenir */
    }
  }

  return {
    /** İlk simge dışarıda (Tray oluşturulurken) verildi: bu anahtar "uygulanmış" sayılır. */
    baslangic(anahtar) {
      uygulanan = anahtar;
      sonUygulama = simdi();
    },
    iste(durum) {
      if (!durum || typeof durum.anahtar !== 'string') return;
      if (durum.anahtar === uygulanan) {
        bekleyeniTemizle(); // eski bekleyen değişim artık geçersiz (değer geri döndü)
        return;
      }
      const gecen = simdi() - sonUygulama;
      if (durum.hizli === true || gecen >= aralikMs) {
        uygulaIc(durum);
        return;
      }
      bekleyen = durum;
      if (zamanlayici === null) {
        zamanlayici = zaman.setTimeout(() => {
          zamanlayici = null;
          const b = bekleyen;
          bekleyen = null;
          if (b && b.anahtar !== uygulanan) uygulaIc(b);
        }, Math.max(0, aralikMs - gecen));
      }
    },
    uygulanan: () => uygulanan,
    temizle: bekleyeniTemizle,
  };
}

module.exports = {
  SOLUK_ALFA,
  IZGARA,
  EN_COK_ROZET_KARAKTERI,
  ROZET_TURLERI,
  GLIFLER,
  pngKodla,
  temelRgba,
  sayiRozetMetni,
  isikRozeti,
  sensorRozeti,
  rozetBelirle,
  sensorIpucuEki,
  rozetYerlesimi,
  rozetCiz,
  simgeRgba,
  simgePng,
  tepsiSimgeBoyutu,
  simgeAnahtari,
  tepsiSimgeDenetleyicisi,
};
