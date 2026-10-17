'use strict';

/**
 * o-55/o-56: küçük WebSocket istemcisi. Yalnız 127.0.0.1 üzerindeki sahte sunucuya bağlanır (gerçek Home Assistant ya da internet yok);
 * sertifikalar bellekte üretilir (test/sertifika-uret.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { wsIstemciSinifiOlustur } = require('../src/lib/ws-istemci');
const { sahteSunucuBaslat, cerceve } = require('./ws-sahte-sunucu');
const { zincirUret, sertifikaUret } = require('./sertifika-uret');

/** Olayları sırayla biriktirir; kosul sağlanana kadar bekler. */
function izle(soket) {
  const olaylar = [];
  for (const tur of ['open', 'message', 'close', 'error']) soket.addEventListener(tur, (o) => olaylar.push({ tur, ...o }));
  const bekle = async (kosul, ms = 3000) => {
    const bitis = Date.now() + ms;
    while (Date.now() < bitis) {
      if (kosul(olaylar)) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return kosul(olaylar);
  };
  return { olaylar, bekle, turler: () => olaylar.map((o) => o.tur) };
}

test('düz ws: el sıkışma, ek üstbilgiler, gönderme ve alma', async () => {
  const sunucu = await sahteSunucuBaslat({ acilis: (b, s) => s.metinGonder(b, '{"type":"auth_required"}') });
  try {
    const Sinif = wsIstemciSinifiOlustur({ secenekAl: () => ({ ustbilgi: { 'CF-Access-Client-Id': 'kimlik', 'X-Ek': 'deger' } }) });
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.equal(s.readyState, 0);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'message')));
    assert.equal(s.readyState, 1);
    assert.deepEqual(i.turler().slice(0, 2), ['open', 'message']);
    assert.equal(i.olaylar[1].data, '{"type":"auth_required"}');
    const istek = sunucu.istekler[0];
    assert.equal(istek.satir, 'GET /api/websocket HTTP/1.1');
    assert.equal(istek.baslik.host, `127.0.0.1:${sunucu.port}`);
    assert.equal(istek.baslik.upgrade, 'websocket');
    assert.equal(istek.baslik['sec-websocket-version'], '13');
    assert.equal(istek.baslik['cf-access-client-id'], 'kimlik');
    assert.equal(istek.baslik['x-ek'], 'deger');
    assert.equal(istek.baslik.origin, undefined);
    s.send('{"type":"auth","access_token":"SAHTE"}');
    assert.ok(await sunucu.bekle(() => sunucu.gelen.length === 1));
    assert.equal(sunucu.gelen[0], '{"type":"auth","access_token":"SAHTE"}');
    assert.equal(sunucu.ilk().sonCerceve.maskeli, true, 'istemci çerçeveleri maskeli');
    // büyük ileti (16 bit ve 64 bit uzunluk biçimleri)
    const orta = 'a'.repeat(1000);
    const buyuk = 'b'.repeat(70000);
    s.send(orta);
    s.send(buyuk);
    assert.ok(await sunucu.bekle(() => sunucu.gelen.length === 3));
    assert.equal(sunucu.gelen[1], orta);
    assert.equal(sunucu.gelen[2], buyuk);
    s.close();
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    const kapanis = i.olaylar.find((x) => x.tur === 'close');
    assert.equal(kapanis.wasClean, true);
    assert.equal(s.readyState, 3);
    assert.deepEqual(sunucu.kapanisKodlari, [1000]);
  } finally {
    await sunucu.kapat();
  }
});

test('düz ws: parçalı ileti, çok baytlı UTF-8, ping/pong ve küçük parçalara bölünmüş çerçeve', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    const Sinif = wsIstemciSinifiOlustur();
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'open')));
    const b = sunucu.ilk();
    // parçalı: metin(fin=0) + devam(fin=1)
    b.soket.write(cerceve(1, 'merha', { fin: false }));
    b.soket.write(cerceve(0, 'ba ışık ', { fin: false }));
    b.soket.write(cerceve(0, 'ğüşi', { fin: true }));
    // iki parçaya bölünmüş tek çerçeve (başlık ortasından)
    const tek = cerceve(1, JSON.stringify({ t: 'x'.repeat(300) }));
    b.soket.write(tek.subarray(0, 1));
    await new Promise((r) => setTimeout(r, 20));
    b.soket.write(tek.subarray(1, 100));
    await new Promise((r) => setTimeout(r, 20));
    b.soket.write(tek.subarray(100));
    // iki çerçeve tek yazmada
    b.soket.write(Buffer.concat([cerceve(1, 'bir'), cerceve(1, 'iki')]));
    // ping -> pong
    b.soket.write(cerceve(9, 'nabiz'));
    assert.ok(await i.bekle((o) => o.filter((x) => x.tur === 'message').length === 4));
    const iletiler = i.olaylar.filter((x) => x.tur === 'message').map((x) => x.data);
    assert.equal(iletiler[0], 'merhaba ışık ğüşi');
    assert.equal(JSON.parse(iletiler[1]).t.length, 300);
    assert.deepEqual(iletiler.slice(2), ['bir', 'iki']);
    assert.ok(await sunucu.bekle(() => sunucu.pongler.length === 1));
    assert.deepEqual(sunucu.pongler, ['nabiz']);
    s.close();
  } finally {
    await sunucu.kapat();
  }
});

test('düz ws: sunucu kapanışı close olayı üretir (kod ve neden ile)', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    const Sinif = wsIstemciSinifiOlustur();
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'open')));
    sunucu.ilk().soket.write(cerceve(8, Buffer.concat([Buffer.from([0x0b, 0xb8]), Buffer.from('gule gule')]))); // 3000
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    const k = i.olaylar.find((x) => x.tur === 'close');
    assert.equal(k.code, 3000);
    assert.equal(k.reason, 'gule gule');
    assert.equal(s.readyState, 3);
    s.send('kapali sonrasi'); // sessizce yok sayılır
  } finally {
    await sunucu.kapat();
  }
});

test('düz ws: protokol ihlalleri bağlantıyı hata + kapanışla bitirir', async () => {
  const durumlar = [
    ['maskeli sunucu çerçevesi', (b) => b.soket.write(Buffer.from([0x81, 0x81, 1, 2, 3, 4, 0x61 ^ 1]))],
    ['RSV biti', (b) => b.soket.write(Buffer.from([0xc1, 0x01, 0x61]))],
    ['ikili çerçeve', (b) => b.soket.write(cerceve(2, Buffer.from([1, 2, 3])))],
    ['geçersiz UTF-8', (b) => b.soket.write(cerceve(1, Buffer.from([0xff, 0xfe])))],
    ['yetim devam çerçevesi', (b) => b.soket.write(cerceve(0, 'x'))],
    ['bilinmeyen opkod', (b) => b.soket.write(cerceve(3, 'x'))],
    ['parçalı kontrol çerçevesi', (b) => b.soket.write(cerceve(9, 'x', { fin: false }))],
  ];
  for (const [ad, yaz] of durumlar) {
    const sunucu = await sahteSunucuBaslat();
    try {
      const Sinif = wsIstemciSinifiOlustur();
      const s = new Sinif(sunucu.adres());
      const i = izle(s);
      assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'open')), ad);
      yaz(sunucu.ilk());
      assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')), ad);
      assert.ok(i.turler().includes('error'), ad);
      assert.equal(i.olaylar.find((x) => x.tur === 'close').wasClean, false, ad);
      assert.ok(!i.turler().includes('message'), `${ad}: ileti iletilmemeli`);
    } finally {
      await sunucu.kapat();
    }
  }
});

test('düz ws: ileti boyutu sınırı aşılırsa 1009 ile kesilir (yük beklenmeden)', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    const Sinif = wsIstemciSinifiOlustur({ enCokMesajBayt: 1000 });
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'open')));
    const baslik = Buffer.alloc(10);
    baslik[0] = 0x81;
    baslik[1] = 127;
    baslik.writeBigUInt64BE(5000n, 2);
    sunucu.ilk().soket.write(baslik); // yük hiç gönderilmedi
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.ok(i.turler().includes('error'));
    assert.ok(await sunucu.bekle(() => sunucu.kapanisKodlari.includes(1009)));
  } finally {
    await sunucu.kapat();
  }
});

test('el sıkışma doğrulanmazsa bağlantı kurulmaz: 403, yanlış Accept, eksik başlık, istenmemiş uzantı', async () => {
  const durumlar = [
    ['403 yanıtı', { durum: 403 }],
    ['301 yönlendirme', { durum: 301 }],
    ['yanlış Accept', { bozukAccept: true }],
    ['istenmemiş uzantı', { ekBaslik: 'Sec-WebSocket-Extensions: permessage-deflate\r\n' }],
  ];
  for (const [ad, secenek] of durumlar) {
    const sunucu = await sahteSunucuBaslat(secenek);
    try {
      const Sinif = wsIstemciSinifiOlustur();
      const s = new Sinif(sunucu.adres());
      const i = izle(s);
      assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')), ad);
      assert.ok(i.turler().includes('error'), ad);
      assert.ok(!i.turler().includes('open'), `${ad}: open olmamalı`);
      assert.equal(s.readyState, 3, ad);
    } finally {
      await sunucu.kapat();
    }
  }
});

test('el sıkışma yanıtı gelmezse zaman aşımı ile hata verir', async () => {
  const sunucu = await sahteSunucuBaslat({ handshakeYapma: true });
  try {
    const Sinif = wsIstemciSinifiOlustur({ baglantiZamanAsimiMs: 150 });
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.ok(i.turler().includes('error'));
  } finally {
    await sunucu.kapat();
  }
});

test('ulaşılamayan sunucu: error ve close (bağlantı reddi)', async () => {
  const sunucu = await sahteSunucuBaslat();
  const adres = sunucu.adres();
  await sunucu.kapat();
  const Sinif = wsIstemciSinifiOlustur();
  const s = new Sinif(adres);
  const i = izle(s);
  assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
  assert.deepEqual(i.turler(), ['error', 'close']);
});

test('geçersiz üstbilgi: hiç bağlanılmaz (kimlik/enjeksiyon üstbilgileri sunucuya ulaşmaz)', async () => {
  for (const ustbilgi of [{ Authorization: 'Bearer x' }, { 'X-Ad': 'a\r\nX-Sizinti: 1' }, { Host: 'baska' }, { 'Sec-WebSocket-Key': 'x' }]) {
    const sunucu = await sahteSunucuBaslat();
    try {
      const Sinif = wsIstemciSinifiOlustur({ secenekAl: () => ({ ustbilgi }) });
      const s = new Sinif(sunucu.adres());
      const i = izle(s);
      assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
      assert.deepEqual(i.turler(), ['error', 'close']);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(sunucu.baglantilar.length, 0, JSON.stringify(ustbilgi));
    } finally {
      await sunucu.kapat();
    }
  }
});

test('seçenek çözücü hata fırlatırsa kapalı kalır (bağlanmaz)', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    const Sinif = wsIstemciSinifiOlustur({
      secenekAl: () => {
        throw new Error('sertifika deposu okunamadı');
      },
    });
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.equal(sunucu.baglantilar.length, 0);
  } finally {
    await sunucu.kapat();
  }
});

test('adres doğrulaması: ws/wss dışı, kimlik bilgili ya da bozuk adres oluşturulamaz', () => {
  const Sinif = wsIstemciSinifiOlustur();
  assert.throws(() => new Sinif('http://127.0.0.1/'), TypeError);
  assert.throws(() => new Sinif('ws://kullanici:sifre@127.0.0.1/'), TypeError);
  assert.throws(() => new Sinif('bozuk adres'), TypeError);
  assert.equal(Sinif.OPEN, 1);
});

test('send: bağlanırken fırlatır, kapandıktan sonra sessizce yok sayar; close bağlanırken bitirir', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    const Sinif = wsIstemciSinifiOlustur();
    const s = new Sinif(sunucu.adres());
    assert.throws(() => s.send('x'));
    s.close();
    const i = izle(s);
    assert.equal(s.readyState, 3);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sunucu.baglantilar.length, 0, 'bağlanmadan kapatıldı');
    assert.deepEqual(i.turler(), []);
  } finally {
    await sunucu.kapat();
  }
});

// ---- TLS: özel CA ve parmak izi ----

test('wss + özel CA: yalnız o CA ile imzalı sunucu sertifikası kabul edilir', async () => {
  const { ca, sunucu: sertifika } = zincirUret({ san: ['127.0.0.1'] });
  const sunucu = await sahteSunucuBaslat({ tls: { key: sertifika.privateKeyPem, cert: sertifika.pem }, acilis: (b, s) => s.metinGonder(b, 'merhaba') });
  try {
    // CA tanımlıyken bağlanır
    const Tamam = wsIstemciSinifiOlustur({ secenekAl: () => ({ ca: [ca.pem], ustbilgi: { 'X-Ek': 'v' } }) });
    const s1 = new Tamam(sunucu.adres());
    const i1 = izle(s1);
    assert.ok(await i1.bekle((o) => o.some((x) => x.tur === 'message')));
    assert.equal(sunucu.istekler[0].baslik['x-ek'], 'v');
    s1.close();

    // CA tanımsızken (varsayılan Node doğrulaması) kurulmaz ve yükseltme isteği hiç gitmez
    const onceki = sunucu.istekler.length;
    const Yok = wsIstemciSinifiOlustur();
    const s2 = new Yok(sunucu.adres());
    const i2 = izle(s2);
    assert.ok(await i2.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.ok(i2.turler().includes('error'));
    assert.ok(!i2.turler().includes('open'));
    assert.equal(sunucu.istekler.length, onceki, 'sertifika güvenilmezken üstbilgi/istek gönderilmedi');

    // Başka bir CA tanımlıyken de kurulmaz
    const baska = sertifikaUret({ cn: 'Baska CA', ca: true });
    const Baska = wsIstemciSinifiOlustur({ secenekAl: () => ({ ca: [baska.pem] }) });
    const s3 = new Baska(sunucu.adres());
    const i3 = izle(s3);
    assert.ok(await i3.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.ok(!i3.turler().includes('open'));
    assert.equal(sunucu.istekler.length, onceki);
  } finally {
    await sunucu.kapat();
  }
});

test('wss + özel CA: sunucu adı sertifikada yoksa kurulmaz (ana bilgisayar adı denetimi korunur)', async () => {
  const { ca, sunucu: sertifika } = zincirUret({ san: ['baska.test'] }); // 127.0.0.1 SAN'ı yok
  const sunucu = await sahteSunucuBaslat({ tls: { key: sertifika.privateKeyPem, cert: sertifika.pem } });
  try {
    const Sinif = wsIstemciSinifiOlustur({ secenekAl: () => ({ ca: [ca.pem] }) });
    const s = new Sinif(sunucu.adres());
    const i = izle(s);
    assert.ok(await i.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.ok(!i.turler().includes('open'));
    assert.equal(sunucu.istekler.length, 0);
  } finally {
    await sunucu.kapat();
  }
});

test('wss + parmak izi: eşleşirse kurulur; eşleşmezse yükseltme isteği (üstbilgiler) HİÇ gönderilmez', async () => {
  const oz = sertifikaUret({ cn: 'ha.ornek', san: ['127.0.0.1'] }); // kendinden imzalı, hiçbir CA tanımıyor
  const sunucu = await sahteSunucuBaslat({ tls: { key: oz.privateKeyPem, cert: oz.pem }, acilis: (b, s) => s.metinGonder(b, 'selam') });
  try {
    const gorulenDer = [];
    const Esles = wsIstemciSinifiOlustur({
      secenekAl: () => ({
        ustbilgi: { 'CF-Access-Client-Secret': 'GIZLI' },
        yaprakDenetle: (der) => {
          gorulenDer.push(der);
          return require('node:crypto').createHash('sha256').update(der).digest('hex') === oz.parmakIzi;
        },
      }),
    });
    const s1 = new Esles(sunucu.adres());
    const i1 = izle(s1);
    assert.ok(await i1.bekle((o) => o.some((x) => x.tur === 'message')));
    assert.equal(sunucu.istekler[0].baslik['cf-access-client-secret'], 'GIZLI');
    assert.ok(Buffer.isBuffer(gorulenDer[0]) && gorulenDer[0].equals(oz.der));
    s1.close();

    const onceki = sunucu.istekler.length;
    const Uymaz = wsIstemciSinifiOlustur({ secenekAl: () => ({ ustbilgi: { 'CF-Access-Client-Secret': 'GIZLI' }, yaprakDenetle: () => false }) });
    const s2 = new Uymaz(sunucu.adres());
    const i2 = izle(s2);
    assert.ok(await i2.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.deepEqual(i2.turler(), ['error', 'close']);
    assert.equal(sunucu.istekler.length, onceki, 'parmak izi uyuşmazken yükseltme isteği gönderilmedi');

    // denetleyici fırlatırsa da kapalı kalır
    const Firlat = wsIstemciSinifiOlustur({
      secenekAl: () => ({
        yaprakDenetle: () => {
          throw new Error('beklenmeyen');
        },
      }),
    });
    const s3 = new Firlat(sunucu.adres());
    const i3 = izle(s3);
    assert.ok(await i3.bekle((o) => o.some((x) => x.tur === 'close')));
    assert.equal(sunucu.istekler.length, onceki);
  } finally {
    await sunucu.kapat();
  }
});
