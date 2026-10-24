'use strict';

/**
 * o-55: bağlantı yöneticisi (özel üstbilgiler). Sahte oturum, sahte fetch ve 127.0.0.1 üzerindeki sahte WebSocket sunucusu;
 * gerçek Home Assistant, gerçek şifreleme ya da internet yok. Değerler sahte sınama metinleridir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { baglantiYoneticisiOlustur } = require('../src/baglanti-yoneticisi');
const { ustbilgiDeposuOlustur } = require('../src/lib/ozel-ustbilgi');
const { sahteSunucuBaslat } = require('./ws-sahte-sunucu');

const YEREL = 'http://192.168.1.20:8123';
const DIS = 'https://ha.ornek.test';

function sahteDepo(ilk = null) {
  let metin = ilk;
  return {
    varMi: () => metin !== null,
    anahtarAl: async () => metin,
    async yaz(m) {
      metin = m;
    },
    async sil() {
      metin = null;
      return { silindi: true };
    },
    ham: () => metin,
  };
}

async function kur({ liste = null, ayar = { yerelAdres: YEREL, disAdres: DIS }, WebSocketTemel, sertifika = null, adresSina = null, yavasDepo = false } = {}) {
  const depo = sahteDepo(liste ? JSON.stringify(liste) : null);
  if (yavasDepo) {
    const asil = depo.anahtarAl;
    depo.anahtarAl = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return asil();
    };
  }
  const ustbilgiDeposu = ustbilgiDeposuOlustur({ depo });
  const cagrilar = [];
  const yonetici = baglantiYoneticisiOlustur({
    ayarlarAl: () => ayar,
    ustbilgiDeposu,
    fetchTemel: async (url, secenek) => {
      cagrilar.push({ url, secenek });
      return { status: 200 };
    },
    WebSocketTemel,
    sertifika,
    adresSina,
    t: (anahtar) => anahtar,
  });
  return { yonetici, ustbilgiDeposu, depo, cagrilar, ayar };
}

test('fetch sarmalayıcısı: yalnız ayardaki HA kökenlerine üstbilgi ekler, mevcut Authorization ezilmez', async () => {
  const { yonetici, ustbilgiDeposu, cagrilar } = await kur({ liste: [{ ad: 'CF-Access-Client-Id', deger: 'kimlik' }, { ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' }] });
  await ustbilgiDeposu.yukle();
  await yonetici.fetch(`${DIS}/api/states`, { method: 'GET', headers: { Authorization: 'Bearer TEST', Accept: 'application/json' } });
  await yonetici.fetch(`${YEREL}/manifest.json`, { method: 'GET' });
  await yonetici.fetch('https://api.github.com/repos/x/y/releases/latest', { method: 'GET' });
  await yonetici.fetch('https://ha.ornek.test.saldirgan.example/api/', { method: 'GET' });
  assert.equal(cagrilar[0].secenek.headers['CF-Access-Client-Id'], 'kimlik');
  assert.equal(cagrilar[0].secenek.headers['CF-Access-Client-Secret'], 'GIZLI_TEST_DEGERI');
  assert.equal(cagrilar[0].secenek.headers.Authorization, 'Bearer TEST');
  assert.equal(cagrilar[0].secenek.method, 'GET');
  assert.equal(cagrilar[1].secenek.headers['CF-Access-Client-Id'], 'kimlik');
  assert.equal(cagrilar[2].secenek.headers, undefined, 'GitHub isteğine üstbilgi eklenmez');
  assert.equal(cagrilar[3].secenek.headers, undefined, 'benzer ama farklı köken üstbilgi görmez');
});

test('fetch sarmalayıcısı: üstbilgi tanımlı değilse seçenek aynen geçer; URL nesnesi değişmeden iletilir', async () => {
  const { yonetici, cagrilar } = await kur();
  const secenek = { method: 'POST', body: 'x' };
  await yonetici.fetch(`${DIS}/api/`, secenek);
  assert.equal(cagrilar[0].secenek, secenek);
  const url = new URL(`${DIS}/api/`);
  await yonetici.fetch(url, secenek);
  assert.equal(cagrilar[1].url, url);
});

test('fetch sarmalayıcısı: açılışta depo yüklenirken ilk istek BEKLER (üstbilgisiz gitmez)', async () => {
  const { yonetici, cagrilar } = await kur({ liste: [{ ad: 'X-Ek', deger: 'v' }], yavasDepo: true });
  const yuklenme = yonetici.yukle();
  const istek = yonetici.fetch(`${DIS}/api/`, {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cagrilar.length, 0, 'depo yüklenmeden ağa çıkılmadı');
  await istek;
  await yuklenme;
  assert.equal(cagrilar[0].secenek.headers['X-Ek'], 'v');
});

test('oturum kancası: üstbilgi varken HA kökenine eklenir, başka kökene eklenmez; liste boşalınca kanca kalkar', async () => {
  const { yonetici, ustbilgiDeposu } = await kur({ liste: [{ ad: 'X-Ek', deger: 'v' }] });
  const kancalar = [];
  const oturum = { webRequest: { onBeforeSendHeaders: (...a) => kancalar.push(a) } };
  yonetici.oturumaBagla(oturum, { ustbilgi: true });
  assert.equal(kancalar.at(-1)[0], null, 'yükleme bitmeden üstbilgi yok: kanca kaldırılır');
  await yonetici.yukle();
  const [filtre, dinleyici] = kancalar.at(-1);
  assert.deepEqual(filtre.urls, ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']);
  const yanit = (url, basliklar = { Accept: '*/*' }) => {
    let sonuc;
    dinleyici({ url, requestHeaders: basliklar }, (s) => {
      sonuc = s;
    });
    return sonuc;
  };
  assert.equal(yanit(`${DIS}/lovelace/0`).requestHeaders['X-Ek'], 'v');
  assert.equal(yanit('wss://ha.ornek.test/api/websocket').requestHeaders['X-Ek'], 'v');
  assert.equal(yanit(`${YEREL}/static/x.js`).requestHeaders['X-Ek'], 'v');
  assert.equal(yanit('https://baska.example/').requestHeaders['X-Ek'], undefined);
  assert.equal(yanit('https://baska.example/').requestHeaders.Accept, '*/*');
  // geri çağırma her durumda çağrılır (istek takılı kalmasın)
  let cagrildi = 0;
  dinleyici({ url: 5, requestHeaders: null }, () => {
    cagrildi += 1;
  });
  assert.equal(cagrildi, 1);
  await ustbilgiDeposu.sil();
  assert.equal(kancalar.at(-1)[0], null, 'liste boş: kanca kaldırıldı');
});

test('oturum kancası: ustbilgi seçeneği verilmeyen oturuma (varsayılan oturum) üstbilgi kancası bağlanmaz; aynı oturum iki kez bağlanmaz', async () => {
  const { yonetici } = await kur({ liste: [{ ad: 'X-Ek', deger: 'v' }] });
  await yonetici.yukle();
  const kancalar = [];
  const oturum = { webRequest: { onBeforeSendHeaders: (...a) => kancalar.push(a) } };
  yonetici.oturumaBagla(oturum);
  assert.equal(kancalar.length, 0);
  const ha = { webRequest: { onBeforeSendHeaders: (...a) => kancalar.push(a) } };
  yonetici.oturumaBagla(ha, { ustbilgi: true });
  const sayi = kancalar.length;
  yonetici.oturumaBagla(ha, { ustbilgi: true });
  assert.equal(kancalar.length, sayi);
  // webRequest olmayan oturum sorun çıkarmaz
  assert.doesNotThrow(() => yonetici.oturumaBagla({}, { ustbilgi: true }));
});

test('WebSocket sınıfı: üstbilgi yoksa küresel WebSocket, varsa özel istemci (üstbilgi sunucuya ulaşır)', async () => {
  const sunucu = await sahteSunucuBaslat({ acilis: (b, s) => s.metinGonder(b, 'merhaba') });
  try {
    const kok = sunucu.kok();
    const olusturulan = [];
    class SahteKuresel {
      constructor(url) {
        olusturulan.push(url);
      }
    }
    const ayar = { yerelAdres: kok, disAdres: DIS };
    // üstbilgi yok -> küresel sınıf
    const a = await kur({ ayar, WebSocketTemel: SahteKuresel });
    await a.yonetici.yukle();
    const s1 = new a.yonetici.webSocketSinifi(sunucu.adres());
    assert.ok(s1 instanceof SahteKuresel);
    assert.deepEqual(olusturulan, [sunucu.adres()]);

    // üstbilgi var -> özel istemci
    const b = await kur({ ayar, liste: [{ ad: 'CF-Access-Client-Id', deger: 'kimlik' }], WebSocketTemel: SahteKuresel });
    await b.yonetici.yukle();
    const s2 = new b.yonetici.webSocketSinifi(sunucu.adres());
    assert.ok(!(s2 instanceof SahteKuresel));
    const iletiler = [];
    s2.addEventListener('message', (o) => iletiler.push(o.data));
    assert.ok(await sunucu.bekle(() => iletiler.length === 1));
    assert.equal(sunucu.istekler[0].baslik['cf-access-client-id'], 'kimlik');
    s2.close();
    assert.equal(olusturulan.length, 1, 'özel istemci küresel sınıfı çağırmadı');

    // ayardaki köken dışına (ör. başka bir kapı) üstbilgi gitmez: küresel sınıf
    const baska = await kur({ ayar: { yerelAdres: 'http://127.0.0.1:1', disAdres: DIS }, liste: [{ ad: 'X-Ek', deger: 'v' }], WebSocketTemel: SahteKuresel });
    await baska.yonetici.yukle();
    const s3 = new baska.yonetici.webSocketSinifi(sunucu.adres());
    assert.ok(s3 instanceof SahteKuresel);
  } finally {
    await sunucu.kapat();
  }
});

test('WebSocket sınıfı: depo yüklenmeden önce özel istemci seçilir ve üstbilgi yüklenince bağlantıya eklenir', async () => {
  const sunucu = await sahteSunucuBaslat();
  try {
    class SahteKuresel {}
    const { yonetici } = await kur({ ayar: { yerelAdres: sunucu.kok(), disAdres: DIS }, liste: [{ ad: 'X-Ek', deger: 'v' }], WebSocketTemel: SahteKuresel, yavasDepo: true });
    const yuklenme = yonetici.yukle();
    const s = new yonetici.webSocketSinifi(sunucu.adres());
    assert.ok(!(s instanceof SahteKuresel));
    await yuklenme;
    assert.ok(await sunucu.bekle(() => sunucu.istekler.length === 1));
    assert.equal(sunucu.istekler[0].baslik['x-ek'], 'v');
    s.close();
  } finally {
    await sunucu.kapat();
  }
});

test('WebSocket sınıfı: küresel WebSocket yoksa özel istemci kullanılır', async () => {
  const { yonetici } = await kur({ WebSocketTemel: undefined });
  await yonetici.yukle();
  const s = new yonetici.webSocketSinifi('ws://127.0.0.1:1/api/websocket');
  assert.equal(typeof s.addEventListener, 'function');
  s.close();
});

test('durum: arayüze yalnız üstbilgi ADLARI gider (değerler hiçbir yanıtta yok)', async () => {
  const { yonetici } = await kur({ liste: [{ ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' }] });
  await yonetici.yukle();
  const d = yonetici.durum();
  assert.deepEqual(d.ustbilgi.adlar, ['CF-Access-Client-Secret']);
  assert.equal(d.ustbilgi.enCok, 8);
  assert.ok(!JSON.stringify(d).includes('GIZLI_TEST_DEGERI'));
  const k = await yonetici.ustbilgileriKaydet([{ ad: 'CF-Access-Client-Secret', deger: null }, { ad: 'X-Yeni', deger: 'baska_deger_1' }]);
  assert.deepEqual(k, { ok: true, adlar: ['CF-Access-Client-Secret', 'X-Yeni'] });
  assert.ok(!JSON.stringify(k).includes('baska_deger_1'));
});

test('ustbilgileriKaydet: kaba biçim reddi, doğrulama hataları ve şifreleme yokluğu', async () => {
  const { yonetici } = await kur();
  await yonetici.yukle();
  assert.deepEqual(await yonetici.ustbilgileriKaydet('metin'), { ok: false, hatalar: [{ sira: 0, neden: 'ad-gecersiz' }] });
  assert.deepEqual(await yonetici.ustbilgileriKaydet(Array.from({ length: 33 }, () => ({ ad: 'X', deger: 'v' }))), { ok: false, hatalar: [{ sira: 0, neden: 'ad-gecersiz' }] });
  const yasak = await yonetici.ustbilgileriKaydet([{ ad: 'Authorization', deger: 'Bearer x' }]);
  assert.equal(yasak.ok, false);
  assert.equal(yasak.hatalar[0].neden, 'ad-yasak');
  const bozuk = await yonetici.ustbilgileriKaydet([{ ad: 'X-Ad', deger: 5 }, null]);
  assert.equal(bozuk.ok, false);
  assert.equal(yonetici.durum().ustbilgi.adlar.length, 0);

  const sifrelemesiz = sahteDepo();
  sifrelemesiz.yaz = async () => {
    throw new Error('sifreleme-yok');
  };
  const y2 = baglantiYoneticisiOlustur({
    ayarlarAl: () => ({}),
    ustbilgiDeposu: ustbilgiDeposuOlustur({ depo: sifrelemesiz }),
    fetchTemel: async () => ({}),
    t: (a) => a,
  });
  const s = await y2.ustbilgileriKaydet([{ ad: 'X-Ek', deger: 'v' }]);
  assert.deepEqual(s, { ok: false, sifreleme: true, hata: 'ana.sifrelemeYok' });

  // B44: disk/izin hatası şifreleme sorunu değildir: ayrı ileti
  const dolu = sahteDepo();
  dolu.yaz = async () => {
    throw new Error('ENOSPC: no space left on device');
  };
  const y3 = baglantiYoneticisiOlustur({
    ayarlarAl: () => ({}),
    ustbilgiDeposu: ustbilgiDeposuOlustur({ depo: dolu }),
    fetchTemel: async () => ({}),
    t: (a) => a,
  });
  assert.deepEqual(await y3.ustbilgileriKaydet([{ ad: 'X-Ek', deger: 'v' }]), { ok: false, hata: 'baglanti.ustKaydedilemedi' });
});

test('ustbilgileriDene: kayıtlı adresler anahtarsız yoklanır; ayarsız adres atlanır', async () => {
  const cagrilar = [];
  const adresSina = async (adres, tur) => {
    cagrilar.push([adres, tur]);
    return { ok: true, ulasilabilir: tur === 'yerel', neden: tur === 'yerel' ? 'tamam' : 'erisim-engelli', mesaj: `m-${tur}` };
  };
  const a = await kur({ adresSina, liste: [{ ad: 'X-Ek', deger: 'v' }] });
  await a.yonetici.yukle();
  const s = await a.yonetici.ustbilgileriDene();
  assert.deepEqual(cagrilar, [[YEREL, 'yerel'], [DIS, 'dis']]);
  assert.deepEqual(s.sonuclar.map((r) => [r.tur, r.ulasilabilir, r.neden]), [['yerel', true, 'tamam'], ['dis', false, 'erisim-engelli']]);
  assert.equal(s.ustbilgiSayisi, 1);
  cagrilar.length = 0;
  const b = await kur({ adresSina, ayar: { yerelAdres: '', disAdres: DIS } });
  assert.equal((await b.yonetici.ustbilgileriDene()).sonuclar.length, 1);
});

test('ipcKaydet: işleyiciler yalnız Ayarlar penceresinden gelen çağrıyı kabul eder', async () => {
  const { yonetici } = await kur({ liste: [{ ad: 'X-Ek', deger: 'v' }] });
  await yonetici.yukle();
  const kayit = new Map();
  let ayarlardanMi = false;
  yonetici.ipcKaydet({
    ipcMain: { handle: (kanal, f) => kayit.set(kanal, f) },
    ayarlardan: () => ayarlardanMi,
    izinYok: () => ({ ok: false, izinYok: true }),
  });
  assert.deepEqual([...kayit.keys()].sort(), ['baglanti:durum', 'baglanti:ustbilgi-dene', 'baglanti:ustbilgi-kaydet', 'baglanti:ustbilgi-sil']);
  for (const [kanal, f] of kayit) {
    const yanit = await f({}, [{ ad: 'X', deger: 'v' }]);
    assert.deepEqual(yanit, { ok: false, izinYok: true }, kanal);
  }
  assert.equal(yonetici.durum().ustbilgi.adlar.length, 1, 'yetkisiz çağrı hiçbir şeyi değiştirmedi');
  ayarlardanMi = true;
  assert.equal((await kayit.get('baglanti:durum')({})).ok, true);
  assert.deepEqual(await kayit.get('baglanti:ustbilgi-sil')({}), { ok: true, adlar: [] });
});
