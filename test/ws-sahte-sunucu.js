'use strict';

/**
 * Test yardımcısı: 127.0.0.1 üzerinde (yalnız bu süreçten erişilen) sahte WebSocket sunucusu. Düz (net) ya da TLS olabilir.
 * Gerçek Home Assistant ya da internet yoktur. Sunucu tarafı çerçeve çözümü ve üretimi RFC 6455'e göre elle yazılmıştır.
 */

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Maskesiz (sunucu -> istemci) çerçeve. */
function cerceve(opkod, yuk, { fin = true, rsv = 0 } = {}) {
  const veri = Buffer.isBuffer(yuk) ? yuk : Buffer.from(String(yuk), 'utf8');
  let baslik;
  if (veri.length < 126) baslik = Buffer.from([(fin ? 0x80 : 0) | (rsv << 4) | opkod, veri.length]);
  else if (veri.length < 65536) baslik = Buffer.from([(fin ? 0x80 : 0) | (rsv << 4) | opkod, 126, veri.length >> 8, veri.length & 255]);
  else {
    baslik = Buffer.alloc(10);
    baslik[0] = (fin ? 0x80 : 0) | (rsv << 4) | opkod;
    baslik[1] = 127;
    baslik.writeBigUInt64BE(BigInt(veri.length), 2);
  }
  return Buffer.concat([baslik, veri]);
}

/**
 * @param {object} [secenek]
 * @param {{key: string, cert: string}|null} [secenek.tls] verilirse TLS
 * @param {number} [secenek.durum] 101 yerine bu durum kodu (ör. 403)
 * @param {boolean} [secenek.bozukAccept] yanlış Sec-WebSocket-Accept
 * @param {string} [secenek.ekBaslik] yanıta eklenen ham başlık satırı
 * @param {boolean} [secenek.handshakeYapma] el sıkışma yanıtı hiç gönderme
 */
async function sahteSunucuBaslat(secenek = {}) {
  const baglantilar = [];
  const istekler = [];
  const sunucu = (secenek.tls ? tls.createServer({ key: secenek.tls.key, cert: secenek.tls.cert }) : net.createServer());
  const olay = secenek.tls ? 'secureConnection' : 'connection';
  const sonuc = {
    istekler,
    baglantilar,
    gelen: [], // istemciden gelen metin iletileri
    kapanisKodlari: [],
    pingler: [],
    pongler: [],
  };

  sunucu.on(olay, (soket) => {
    const b = { soket, arabellek: Buffer.alloc(0), handshake: false, kapandi: false };
    baglantilar.push(b);
    soket.on('error', () => {});
    soket.on('close', () => {
      b.kapandi = true;
    });
    soket.on('data', (parca) => {
      b.arabellek = Buffer.concat([b.arabellek, parca]);
      if (!b.handshake) {
        const son = b.arabellek.indexOf('\r\n\r\n');
        if (son < 0) return;
        const ham = b.arabellek.subarray(0, son).toString('latin1');
        b.arabellek = b.arabellek.subarray(son + 4);
        const satirlar = ham.split('\r\n');
        const baslik = {};
        for (const s of satirlar.slice(1)) {
          const i = s.indexOf(':');
          baslik[s.slice(0, i).trim().toLowerCase()] = s.slice(i + 1).trim();
        }
        const kayit = { satir: satirlar[0], baslik, ham };
        istekler.push(kayit);
        b.handshake = true;
        if (secenek.handshakeYapma) return;
        if (secenek.durum && secenek.durum !== 101) {
          soket.end(`HTTP/1.1 ${secenek.durum} Hata\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
          return;
        }
        const kabul = crypto.createHash('sha1').update(baslik['sec-websocket-key'] + GUID).digest('base64');
        soket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${secenek.bozukAccept ? 'YANLIS' : kabul}\r\n${secenek.ekBaslik ?? ''}\r\n`,
        );
        if (typeof secenek.acilis === 'function') secenek.acilis(b, sonuc);
      }
      cercevelerOku(b);
    });
  });

  function cercevelerOku(b) {
    for (;;) {
      const a = b.arabellek;
      if (a.length < 2) return;
      const fin = (a[0] & 0x80) !== 0;
      const opkod = a[0] & 0x0f;
      const maskeli = (a[1] & 0x80) !== 0;
      let uz = a[1] & 0x7f;
      let konum = 2;
      if (uz === 126) {
        if (a.length < 4) return;
        uz = a.readUInt16BE(2);
        konum = 4;
      } else if (uz === 127) {
        if (a.length < 10) return;
        uz = Number(a.readBigUInt64BE(2));
        konum = 10;
      }
      const maske = maskeli ? a.subarray(konum, konum + 4) : null;
      if (maskeli) konum += 4;
      if (a.length < konum + uz) return;
      const yuk = Buffer.from(a.subarray(konum, konum + uz));
      b.arabellek = a.subarray(konum + uz);
      if (maske) for (let i = 0; i < yuk.length; i += 1) yuk[i] ^= maske[i % 4];
      b.sonCerceve = { fin, opkod, maskeli, yuk };
      if (opkod === 1) sonuc.gelen.push(yuk.toString('utf8'));
      else if (opkod === 8) {
        sonuc.kapanisKodlari.push(yuk.length >= 2 ? yuk.readUInt16BE(0) : 1005);
        if (!b.kapandi) b.soket.end(cerceve(8, yuk.subarray(0, 2)));
      } else if (opkod === 9) {
        sonuc.pingler.push(yuk.toString('utf8'));
        b.soket.write(cerceve(10, yuk));
      } else if (opkod === 10) sonuc.pongler.push(yuk.toString('utf8'));
      if (typeof secenek.cerceve === 'function') secenek.cerceve(b, { fin, opkod, maskeli, yuk }, sonuc);
    }
  }

  await new Promise((coz) => sunucu.listen(0, '127.0.0.1', coz));
  sonuc.port = sunucu.address().port;
  sonuc.adres = (alan = '127.0.0.1') => `${secenek.tls ? 'wss' : 'ws'}://${alan}:${sonuc.port}/api/websocket`;
  sonuc.kok = (alan = '127.0.0.1') => `${secenek.tls ? 'https' : 'http'}://${alan}:${sonuc.port}`;
  sonuc.metinGonder = (b, metin) => b.soket.write(cerceve(1, metin));
  sonuc.ham = (b, veri) => b.soket.write(veri);
  sonuc.cerceve = cerceve;
  sonuc.ilk = () => baglantilar[0];
  sonuc.bekle = async (kosul, ms = 3000) => {
    const bitis = Date.now() + ms;
    while (Date.now() < bitis) {
      if (kosul()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return kosul();
  };
  sonuc.kapat = async () => {
    for (const b of baglantilar) b.soket.destroy();
    await new Promise((coz) => sunucu.close(coz));
  };
  return sonuc;
}

module.exports = { sahteSunucuBaslat, cerceve, GUID };
