'use strict';

/**
 * Harici bağımlılık olmadan (saf Node.js zlib ve Buffer kullanarak)
 * Ev Paneli için şık bir PNG ve çoklu boyutlu ICO (16, 32, 48, 256) üreten araç.
 * Normal simgenin yanında bağlantı yokken tepside gösterilen SOLUK simgeyi (ikon-soluk.png/.ico) de üretir (detay-18):
 * gri tonlama ve alfa x0,45. Komut: `npm run ikon` (GUI yok; yalnız dosya yazar).
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// CRC32 Tablosu ve Hesaplayıcısı
const olusturCrcTablosu = () => {
  const tablo = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tablo[i] = c >>> 0;
  }
  return tablo;
};

const crcTablosu = olusturCrcTablosu();

function hesaplaCrc(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTablosu[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkUret(tip, veri) {
  const tipBuf = Buffer.from(tip, 'ascii');
  const uzunlukBuf = Buffer.alloc(4);
  uzunlukBuf.writeUInt32BE(veri.length, 0);

  const crcGirdi = Buffer.concat([tipBuf, veri]);
  const crcDegeri = hesaplaCrc(crcGirdi);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcDegeri, 0);

  return Buffer.concat([uzunlukBuf, tipBuf, veri, crcBuf]);
}

const SOLUK_ALFA = 0.45;

/**
 * Belirtilen boyutta ev ve dalga/sinyal simgesi çizer (RGBA buffer).
 * soluk: gri tonlama ve alfa x0,45 (bağlantı yokken tepsi simgesi).
 */
function pikselDizisiUret(boyut, soluk = false) {
  const pikseller = Buffer.alloc((boyut * 4 + 1) * boyut);
  let ofset = 0;

  const bgR = 15, bgG = 117, bgB = 224; // Home Assistant Mavisi (#0f75e0)
  const fgR = 255, fgG = 255, fgB = 255; // Beyaz
  const koseYaricap = boyut * 0.22;
  const merkez = (boyut - 1) / 2;

  for (let y = 0; y < boyut; y++) {
    pikseller[ofset++] = 0; // PNG satır filtresi: None

    for (let x = 0; x < boyut; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      // Yuvarlatılmış kare kart arka planı
      const dx = Math.abs(x - merkez) - (merkez - koseYaricap);
      const dy = Math.abs(y - merkez) - (merkez - koseYaricap);
      let mesafe = 0;
      if (dx > 0 && dy > 0) {
        mesafe = Math.hypot(dx, dy) - koseYaricap;
      } else {
        mesafe = Math.max(dx, dy) - koseYaricap;
      }

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

      pikseller[ofset++] = r;
      pikseller[ofset++] = g;
      pikseller[ofset++] = b;
      pikseller[ofset++] = a;
    }
  }

  return pikseller;
}

function pngUret(boyut, soluk = false) {
  const imza = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrVeri = Buffer.alloc(13);
  ihdrVeri.writeUInt32BE(boyut, 0);
  ihdrVeri.writeUInt32BE(boyut, 4);
  ihdrVeri[8] = 8; // 8 bit
  ihdrVeri[9] = 6; // RGBA
  ihdrVeri[10] = 0; // sıkıştırma
  ihdrVeri[11] = 0; // filtre
  ihdrVeri[12] = 0; // interlace yok
  const ihdrChunk = chunkUret('IHDR', ihdrVeri);

  // IDAT
  const hamPiksel = pikselDizisiUret(boyut, soluk);
  const sikistirilmis = zlib.deflateSync(hamPiksel, { level: 9 });
  const idatChunk = chunkUret('IDAT', sikistirilmis);

  // IEND
  const iendChunk = chunkUret('IEND', Buffer.alloc(0));

  return Buffer.concat([imza, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Birden fazla boyuttaki PNG'yi tek bir Windows .ico dosyasına paketler.
 */
function icoUret(pngDizisi) {
  const sayi = pngDizisi.length;
  const baslikUzunluk = 6 + sayi * 16;
  let toplamBoyut = baslikUzunluk;

  for (const oge of pngDizisi) {
    toplamBoyut += oge.pngBuf.length;
  }

  const icoBuf = Buffer.alloc(toplamBoyut);

  // ICO Başlığı (6 bayt)
  icoBuf.writeUInt16LE(0, 0); // Rezerve (0)
  icoBuf.writeUInt16LE(1, 2); // 1 = ICO türü
  icoBuf.writeUInt16LE(sayi, 4); // İkon sayısı

  let veriOfseti = baslikUzunluk;

  pngDizisi.forEach((oge, i) => {
    const girisOfseti = 6 + i * 16;
    const b = oge.boyut === 256 ? 0 : oge.boyut; // 256 için 0 yazılır

    icoBuf.writeUInt8(b, girisOfseti);     // Genişlik
    icoBuf.writeUInt8(b, girisOfseti + 1); // Yükseklik
    icoBuf.writeUInt8(0, girisOfseti + 2); // Renk paleti
    icoBuf.writeUInt8(0, girisOfseti + 3); // Rezerve
    icoBuf.writeUInt16LE(1, girisOfseti + 4); // Renk düzlemleri
    icoBuf.writeUInt16LE(32, girisOfseti + 6); // Piksel başına bit
    icoBuf.writeUInt32LE(oge.pngBuf.length, girisOfseti + 8); // PNG bayt boyutu
    icoBuf.writeUInt32LE(veriOfseti, girisOfseti + 12); // Veri ofseti

    oge.pngBuf.copy(icoBuf, veriOfseti);
    veriOfseti += oge.pngBuf.length;
  });

  return icoBuf;
}

const BOYUTLAR = [16, 32, 48, 64, 128, 256];

/** İsim önekiyle (ikon / ikon-soluk) 256 piksellik PNG ve çoklu boyutlu ICO yazar. */
function simgeYaz(assetsDizin, ad, soluk) {
  const uretilenler = BOYUTLAR.map((boyut) => ({
    boyut,
    pngBuf: pngUret(boyut, soluk),
  }));

  // 256x256 PNG'yi ana png olarak kaydet
  const enBuyuk = uretilenler.find((u) => u.boyut === 256).pngBuf;
  const pngHedef = path.join(assetsDizin, `${ad}.png`);
  fs.writeFileSync(pngHedef, enBuyuk);
  console.log(`[İkon Üretici] Yazıldı: ${pngHedef} (${enBuyuk.length} bayt)`);

  // Çoklu boyutlu Windows ICO kaydet
  const icoHedef = path.join(assetsDizin, `${ad}.ico`);
  const icoBuf = icoUret(uretilenler);
  fs.writeFileSync(icoHedef, icoBuf);
  console.log(`[İkon Üretici] Yazıldı: ${icoHedef} (${icoBuf.length} bayt)`);
}

// Betik doğrudan çalıştırılırsa dosyalar yazılır; test için require edilince hiçbir şey yazılmaz.
if (require.main === module) {
  const assetsDizin = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(assetsDizin, { recursive: true });
  console.log('[İkon Üretici] PNG ve ICO simgeleri oluşturuluyor…');
  simgeYaz(assetsDizin, 'ikon', false);
  simgeYaz(assetsDizin, 'ikon-soluk', true);
  console.log('[İkon Üretici] Tamamlandı!');
}

module.exports = { BOYUTLAR, SOLUK_ALFA, pikselDizisiUret, pngUret, icoUret };
