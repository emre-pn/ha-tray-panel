'use strict';

/**
 * o-56: bağlantı yöneticisi + sertifika yöneticisi birlikte — canlı bağlantı yolu (özel WebSocket istemcisi). 127.0.0.1 üzerindeki sahte
 * TLS WebSocket sunucusu ve bellekte üretilen sertifikalar; gerçek Home Assistant ya da internet yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baglantiYoneticisiOlustur } = require('../src/baglanti-yoneticisi');
const { sertifikaYoneticisiOlustur } = require('../src/sertifika-yoneticisi');
const { sertifikaDeposuOlustur } = require('../src/lib/sertifika-deposu');
const { ustbilgiDeposuOlustur } = require('../src/lib/ozel-ustbilgi');
const { kokBilgisi } = require('../src/lib/sertifika');
const { sahteSunucuBaslat } = require('./ws-sahte-sunucu');
const { sertifikaUret, zincirUret } = require('./sertifika-uret');

function bellekDeposu(metin = null) {
  let ham = metin;
  return {
    varMi: () => ham !== null,
    anahtarAl: async () => ham,
    async yaz(m) {
      ham = m;
    },
    async sil() {
      ham = null;
      return { silindi: true };
    },
  };
}

function kur({ ayar, ustbilgi = null, WebSocketTemel } = {}) {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-bs-'));
  const dosyaYolu = path.join(klasor, 'sertifika-guveni.json');
  const depo = sertifikaDeposuOlustur({ dosyaYolu, fs });
  const sertifika = sertifikaYoneticisiOlustur({ depo, ayarlarAl: () => ayar });
  const yonetici = baglantiYoneticisiOlustur({
    ayarlarAl: () => ayar,
    ustbilgiDeposu: ustbilgiDeposuOlustur({ depo: bellekDeposu(ustbilgi ? JSON.stringify(ustbilgi) : null) }),
    fetchTemel: async () => ({ status: 200 }),
    WebSocketTemel,
    sertifika,
    t: (anahtar) => anahtar,
  });
  return { depo, sertifika, yonetici, temizle: () => fs.rmSync(klasor, { recursive: true, force: true }) };
}

const olayBekle = (soket, tur) => new Promise((coz) => soket.addEventListener(tur, (o) => coz(o)));

test('canlı bağlantı: kayıt yokken küresel WebSocket aynen kullanılır; özel kök ya da sabitleme varken özel istemci seçilir', async () => {
  const { ca, sunucu: sert } = zincirUret({ san: ['127.0.0.1'] });
  const sunucu = await sahteSunucuBaslat({ tls: { key: sert.privateKeyPem, cert: sert.pem }, acilis: (b, s) => s.metinGonder(b, 'merhaba') });
  const ayar = { yerelAdres: `https://127.0.0.1:${sunucu.port}`, disAdres: '' };
  const olusturulan = [];
  class SahteKuresel {
    constructor(url) {
      olusturulan.push(url);
    }
  }
  const o = kur({ ayar, WebSocketTemel: SahteKuresel });
  try {
    await o.yonetici.yukle();
    const hedef = `wss://127.0.0.1:${sunucu.port}/api/websocket`;
    assert.ok(new o.yonetici.webSocketSinifi(hedef) instanceof SahteKuresel, 'kayıt yok: bugünkü yol');

    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    const soket = new o.yonetici.webSocketSinifi(hedef);
    assert.ok(!(soket instanceof SahteKuresel), 'özel kök varken özel istemci');
    const ileti = await olayBekle(soket, 'message');
    assert.equal(ileti.data, 'merhaba');
    soket.close();
    assert.equal(olusturulan.length, 1);
  } finally {
    o.temizle();
    await sunucu.kapat();
  }
});

test('canlı bağlantı + özel kök: yalnız o kökle imzalı sertifika kabul edilir; başka kökle imzalıysa bağlanılmaz ve istek (üstbilgi) gitmez', async () => {
  const dogru = zincirUret({ san: ['127.0.0.1'] });
  const yanlis = zincirUret({ caAdi: 'Baska Kok', san: ['127.0.0.1'] });
  const dogruSunucu = await sahteSunucuBaslat({ tls: { key: dogru.sunucu.privateKeyPem, cert: dogru.sunucu.pem }, acilis: (b, s) => s.metinGonder(b, 'tamam') });
  const yanlisSunucu = await sahteSunucuBaslat({ tls: { key: yanlis.sunucu.privateKeyPem, cert: yanlis.sunucu.pem } });
  const ayar = { yerelAdres: `https://127.0.0.1:${dogruSunucu.port}`, disAdres: `https://127.0.0.1:${yanlisSunucu.port}` };
  const o = kur({ ayar, ustbilgi: [{ ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' }], WebSocketTemel: class {} });
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(dogru.ca.pem)]);

    const iyi = new o.yonetici.webSocketSinifi(`wss://127.0.0.1:${dogruSunucu.port}/api/websocket`);
    assert.equal((await olayBekle(iyi, 'message')).data, 'tamam');
    assert.equal(dogruSunucu.istekler[0].baslik['cf-access-client-secret'], 'GIZLI_TEST_DEGERI', 'kök + üstbilgi birlikte çalışır');
    iyi.close();

    const kotu = new o.yonetici.webSocketSinifi(`wss://127.0.0.1:${yanlisSunucu.port}/api/websocket`);
    await olayBekle(kotu, 'close');
    assert.equal(yanlisSunucu.istekler.length, 0, 'güvenilmeyen sertifikaya üstbilgi/istek gönderilmedi');
  } finally {
    o.temizle();
    await dogruSunucu.kapat();
    await yanlisSunucu.kapat();
  }
});

test('canlı bağlantı + parmak izi sabitleme: eşleşen sertifika kabul, başka sertifika (geçerli bir kökle imzalı olsa bile) reddedilir; istek gitmez', async () => {
  const oz = sertifikaUret({ cn: 'ha.ornek', san: ['127.0.0.1'] }); // kendinden imzalı
  const { ca, sunucu: imzali } = zincirUret({ san: ['127.0.0.1'] });
  const ozSunucu = await sahteSunucuBaslat({ tls: { key: oz.privateKeyPem, cert: oz.pem }, acilis: (b, s) => s.metinGonder(b, 'sabit') });
  const imzaliSunucu = await sahteSunucuBaslat({ tls: { key: imzali.privateKeyPem, cert: imzali.pem } });
  const ayar = { yerelAdres: `https://127.0.0.1:${ozSunucu.port}`, disAdres: '' };
  const o = kur({ ayar, WebSocketTemel: class {} });
  try {
    await o.yonetici.yukle();
    await o.depo.sabitle('127.0.0.1', oz.parmakIzi);

    const iyi = new o.yonetici.webSocketSinifi(`wss://127.0.0.1:${ozSunucu.port}/api/websocket`);
    assert.equal((await olayBekle(iyi, 'message')).data, 'sabit');
    iyi.close();

    // Sabitli ana bilgisayarda başka bir sertifika sunan sunucu (aynı 127.0.0.1): kök listesi de olsa kabul edilmez
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    ayar.disAdres = `https://127.0.0.1:${imzaliSunucu.port}`;
    const kotu = new o.yonetici.webSocketSinifi(`wss://127.0.0.1:${imzaliSunucu.port}/api/websocket`);
    await olayBekle(kotu, 'close');
    assert.equal(imzaliSunucu.istekler.length, 0, 'sıkı sabitleme: sabitlenmeyen sertifikaya istek gitmedi');
  } finally {
    o.temizle();
    await ozSunucu.kapat();
    await imzaliSunucu.kapat();
  }
});

test('canlı bağlantı: kayıtlar henüz yüklenmemişken özel istemci seçilir ve bağlantı kurulurken sabitleme uygulanır', async () => {
  const oz = sertifikaUret({ cn: 'ha.ornek', san: ['127.0.0.1'] });
  const baska = sertifikaUret({ cn: 'ha.ornek', san: ['127.0.0.1'] });
  const sunucu = await sahteSunucuBaslat({ tls: { key: oz.privateKeyPem, cert: oz.pem }, acilis: (b, s) => s.metinGonder(b, 'gec') });
  const ayar = { yerelAdres: `https://127.0.0.1:${sunucu.port}`, disAdres: '' };
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-gec-'));
  try {
    const yol = path.join(klasor, 'sertifika-guveni.json');
    const hazirla = (parmak) => fs.writeFileSync(yol, JSON.stringify({ surum: 1, ca: [], sabit: [{ anaBilgisayar: '127.0.0.1', parmak }] }), 'utf8');
    class SahteKuresel {}
    const yoneticiKur = () => {
      const depo = sertifikaDeposuOlustur({ dosyaYolu: yol, fs });
      const sertifika = sertifikaYoneticisiOlustur({ depo, ayarlarAl: () => ayar });
      const yonetici = baglantiYoneticisiOlustur({
        ayarlarAl: () => ayar,
        ustbilgiDeposu: ustbilgiDeposuOlustur({ depo: bellekDeposu() }),
        fetchTemel: async () => ({ status: 200 }),
        WebSocketTemel: SahteKuresel,
        sertifika,
      });
      return { depo, yonetici };
    };

    // Doğru parmak izi dosyada; yükleme HİÇ çağrılmadan soket kurulur
    hazirla(oz.parmakIzi);
    const a = yoneticiKur();
    assert.equal(a.depo.hazirMi(), false);
    const soket = new a.yonetici.webSocketSinifi(`wss://127.0.0.1:${sunucu.port}/api/websocket`);
    assert.ok(!(soket instanceof SahteKuresel), 'kayıtlar bilinmezken küresel sınıf seçilmez (sabitleme atlanmasın)');
    assert.equal((await olayBekle(soket, 'message')).data, 'gec');
    soket.close();

    // Dosyadaki parmak izi başka bir sertifikaya aitse: bağlantı kurulmaz, istek gitmez
    hazirla(baska.parmakIzi);
    const onceki = sunucu.istekler.length;
    const b = yoneticiKur();
    const kotu = new b.yonetici.webSocketSinifi(`wss://127.0.0.1:${sunucu.port}/api/websocket`);
    await olayBekle(kotu, 'close');
    assert.equal(sunucu.istekler.length, onceki);
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
    await sunucu.kapat();
  }
});

test('durum ve IPC: sertifika özeti baglanti:durum yanıtında; beş sertifika kanalı yalnız Ayarlar penceresine yanıt verir; oturuma kanca bağlanır', async () => {
  const ayar = { yerelAdres: 'https://192.168.1.50:8123', disAdres: '' };
  const o = kur({ ayar, WebSocketTemel: class {} });
  try {
    const kayitli = new Map();
    const ipcMain = { handle: (kanal, fn) => kayitli.set(kanal, fn) };
    const izinli = { sender: 'ayarlar' };
    const yabanci = { sender: 'uzak' };
    o.yonetici.ipcKaydet({ ipcMain, ayarlardan: (olay) => olay === izinli, izinYok: () => ({ ok: false, hata: 'İzin yok.' }) });
    for (const kanal of ['baglanti:durum', 'baglanti:sertifika-oku', 'baglanti:parmak-kaydet', 'baglanti:parmak-sil', 'baglanti:ca-ekle', 'baglanti:ca-sil']) {
      assert.ok(kayitli.has(kanal), kanal);
      assert.deepEqual(await kayitli.get(kanal)(yabanci), { ok: false, hata: 'İzin yok.' }, `${kanal}: yabancı gönderen reddedilir`);
    }
    const durum = await kayitli.get('baglanti:durum')(izinli);
    assert.equal(durum.ok, true);
    assert.deepEqual(durum.sertifika.adresler, [{ tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123, sabit: false }]);
    const kaydet = await kayitli.get('baglanti:parmak-kaydet')(izinli, 'yerel', 'ab'.repeat(32));
    assert.equal(kaydet.ok, true);
    assert.equal((await kayitli.get('baglanti:durum')(izinli)).sertifika.sabit.length, 1);

    const oturum = { setCertificateVerifyProc: (f) => { oturum.proc = f; } };
    o.yonetici.oturumaBagla(oturum);
    await o.sertifika.hazir();
    assert.equal(typeof oturum.proc, 'function', 'kayıt varken HA oturumuna doğrulama kancası bağlandı');
  } finally {
    o.temizle();
  }
});
