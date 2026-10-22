'use strict';

/**
 * Harici bağımlılık olmadan (saf Node.js zlib ve Buffer kullanarak)
 * Ev Paneli logosu için PNG ve çoklu boyutlu ICO (16, 32, 48, 64, 128, 256) üreten araç.
 * Normal simgenin yanında bağlantı yokken tepside gösterilen SOLUK simgeyi (ikon-soluk.png/.ico) de üretir (detay-18):
 * gri tonlama ve alfa x0,45. Komut: `npm run ikon` (GUI yok; yalnız dosya yazar).
 */

const fs = require('node:fs');
const path = require('node:path');
// Çizim ve PNG kodlama src/lib/tepsi-simgesi.js'tedir (uygulama çalışırken tepsi simgesine rozet çizerken de aynı kod kullanılır).
const { SOLUK_ALFA, temelRgba, pngKodla } = require('../src/lib/tepsi-simgesi');

/**
 * Belirtilen boyutta logoyu (ev ve durum noktası) çizer (her satırın başında 1 bayt PNG filtresi olan ham RGBA buffer).
 * soluk: gri tonlama ve alfa x0,45 (bağlantı yokken tepsi simgesi).
 */
function pikselDizisiUret(boyut, soluk = false) {
  const rgba = temelRgba(boyut, soluk);
  const satirBoyu = boyut * 4;
  const pikseller = Buffer.alloc((satirBoyu + 1) * boyut);
  for (let y = 0; y < boyut; y++) {
    pikseller[y * (satirBoyu + 1)] = 0; // PNG satır filtresi: None
    rgba.copy(pikseller, y * (satirBoyu + 1) + 1, y * satirBoyu, (y + 1) * satirBoyu);
  }
  return pikseller;
}

function pngUret(boyut, soluk = false) {
  return pngKodla(boyut, temelRgba(boyut, soluk));
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
