'use strict';

/**
 * o-55: özel HTTP üstbilgileri (Cloudflare Access vb.). Saf modül + sahte şifreli depo; gerçek ağ ve gerçek anahtar dosyası yok.
 * Testlerdeki değerler sahte sınama metinleridir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EN_COK_USTBILGI,
  adYasakMi,
  ustbilgileriDogrula,
  depodanDuzelt,
  kokenCoz,
  adresIcinUstbilgi,
  fetchSecenegineEkle,
  istekUstbilgilerineEkle,
  ustbilgiDeposuOlustur,
} = require('../src/lib/ozel-ustbilgi');

const KOKEN = 'https://ha.ornek.test';
const YEREL = 'http://192.168.1.20:8123';

test('ustbilgileriDogrula: geçerli çiftleri kabul eder, boşlukları kırpar', () => {
  const s = ustbilgileriDogrula([
    { ad: ' CF-Access-Client-Id ', deger: ' abc.access ' },
    { ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' },
  ]);
  assert.equal(s.ok, true);
  assert.deepEqual(s.liste, [
    { ad: 'CF-Access-Client-Id', deger: 'abc.access' },
    { ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' },
  ]);
});

test('ustbilgileriDogrula: kimlik ve bağlantı üstbilgileri tanımlanamaz', () => {
  for (const ad of ['Authorization', 'authorization', 'Host', 'Cookie', 'Content-Type', 'Connection', 'Upgrade', 'Origin', 'Sec-WebSocket-Key', 'Proxy-Authorization', 'X-Forwarded-For', 'Transfer-Encoding']) {
    const s = ustbilgileriDogrula([{ ad, deger: 'x' }]);
    assert.equal(s.ok, false, ad);
    assert.equal(s.hatalar[0].neden, 'ad-yasak', ad);
    assert.equal(adYasakMi(ad), true, ad);
  }
  assert.equal(adYasakMi('CF-Access-Client-Id'), false);
  assert.equal(adYasakMi('X-Ozel'), false);
});

test('ustbilgileriDogrula: geçersiz ad, değer enjeksiyonu ve sınırlar', () => {
  assert.equal(ustbilgileriDogrula([{ ad: 'Gecersiz Ad', deger: 'x' }]).hatalar[0].neden, 'ad-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'Ad:iki', deger: 'x' }]).hatalar[0].neden, 'ad-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: '', deger: 'x' }]).hatalar[0].neden, 'ad-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: 'a\r\nX-Sizinti: 1' }]).hatalar[0].neden, 'deger-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: 'a\nb' }]).hatalar[0].neden, 'deger-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: 'a\tb' }]).hatalar[0].neden, 'deger-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: 'türkçe' }]).hatalar[0].neden, 'deger-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: '   ' }]).hatalar[0].neden, 'deger-yok');
  assert.equal(ustbilgileriDogrula([{ ad: 'X-Ad', deger: 'a'.repeat(2049) }]).hatalar[0].neden, 'deger-gecersiz');
  assert.equal(ustbilgileriDogrula([{ ad: 'X'.repeat(65), deger: 'x' }]).hatalar[0].neden, 'ad-gecersiz');
  assert.equal(ustbilgileriDogrula('metin').ok, false);
  assert.equal(ustbilgileriDogrula([null]).ok, false);
  assert.equal(ustbilgileriDogrula([]).ok, true);
});

test('ustbilgileriDogrula: aynı ad iki kez ve çok fazla öğe reddedilir', () => {
  const s = ustbilgileriDogrula([{ ad: 'X-A', deger: '1' }, { ad: 'x-a', deger: '2' }]);
  assert.equal(s.ok, false);
  assert.equal(s.hatalar[0].neden, 'tekrar');
  const cok = Array.from({ length: EN_COK_USTBILGI + 1 }, (_, i) => ({ ad: `X-Ad-${i}`, deger: 'v' }));
  const c = ustbilgileriDogrula(cok);
  assert.equal(c.ok, false);
  assert.equal(c.hatalar[0].neden, 'cok-fazla');
  assert.equal(c.liste.length, EN_COK_USTBILGI);
});

test('ustbilgileriDogrula: deger null mevcut değeri korur, mevcutta yoksa hata', () => {
  const mevcut = [{ ad: 'CF-Access-Client-Secret', deger: 'ESKI_SIR' }];
  const s = ustbilgileriDogrula([{ ad: 'cf-access-client-secret', deger: null }], { mevcut });
  assert.equal(s.ok, true);
  assert.equal(s.liste[0].deger, 'ESKI_SIR');
  const y = ustbilgileriDogrula([{ ad: 'X-Yeni', deger: null }], { mevcut });
  assert.equal(y.ok, false);
  assert.equal(y.hatalar[0].neden, 'deger-yok');
});

test('depodanDuzelt: bozuk metin boş, geçersiz öğeler düşer', () => {
  assert.deepEqual(depodanDuzelt('bozuk{'), []);
  assert.deepEqual(depodanDuzelt('{"a":1}'), []);
  assert.deepEqual(depodanDuzelt(JSON.stringify([{ ad: 'Authorization', deger: 'x' }, { ad: 'X-Iyi', deger: 'v' }, { ad: 'X-Iyi', deger: 'w' }, 5])), [{ ad: 'X-Iyi', deger: 'v' }]);
});

test('kokenCoz: ws/wss http/https köküne çevrilir', () => {
  assert.equal(kokenCoz('wss://ha.ornek.test/api/websocket'), 'https://ha.ornek.test');
  assert.equal(kokenCoz('ws://192.168.1.20:8123/api/websocket'), 'http://192.168.1.20:8123');
  assert.equal(kokenCoz('https://ha.ornek.test/api/'), KOKEN);
  assert.equal(kokenCoz('ftp://x'), null);
  assert.equal(kokenCoz('bozuk'), null);
});

test('adresIcinUstbilgi: yalnız izinli kökene ve güvenli köke eklenir', () => {
  const liste = [{ ad: 'CF-Access-Client-Id', deger: 'kimlik' }];
  const izinli = [KOKEN, YEREL];
  assert.deepEqual(adresIcinUstbilgi(`${KOKEN}/api/states`, { liste, izinliKokenler: izinli }), { 'CF-Access-Client-Id': 'kimlik' });
  assert.deepEqual(adresIcinUstbilgi('wss://ha.ornek.test/api/websocket', { liste, izinliKokenler: izinli }), { 'CF-Access-Client-Id': 'kimlik' });
  assert.deepEqual(adresIcinUstbilgi(`${YEREL}/api/`, { liste, izinliKokenler: izinli }), { 'CF-Access-Client-Id': 'kimlik' });
  // başka köken: üstbilgi sızmaz
  assert.equal(adresIcinUstbilgi('https://baska.test/api/', { liste, izinliKokenler: izinli }), null);
  assert.equal(adresIcinUstbilgi('https://ha.ornek.test.saldirgan.test/', { liste, izinliKokenler: izinli }), null);
  assert.equal(adresIcinUstbilgi('http://ha.ornek.test/', { liste, izinliKokenler: izinli }), null); // şema farklı
  assert.equal(adresIcinUstbilgi('https://ha.ornek.test:8443/', { liste, izinliKokenler: izinli }), null); // kapı farklı
  // herkese açık ada düz http: izinli listede olsa bile gitmez
  assert.equal(adresIcinUstbilgi('http://acik.ornek.test/', { liste, izinliKokenler: ['http://acik.ornek.test'] }), null);
  // boş liste / bozuk adres
  assert.equal(adresIcinUstbilgi(KOKEN, { liste: [], izinliKokenler: izinli }), null);
  assert.equal(adresIcinUstbilgi('bozuk', { liste, izinliKokenler: izinli }), null);
});

test('fetchSecenegineEkle: Authorization ezilmez, nesne/Headers/dizi biçimleri korunur', () => {
  const ekler = { 'CF-Access-Client-Id': 'kimlik', Authorization: 'SALDIRGAN' };
  const s = fetchSecenegineEkle({ method: 'GET', headers: { Authorization: 'Bearer TEST', Accept: 'application/json' } }, ekler);
  assert.equal(s.method, 'GET');
  assert.equal(s.headers.Authorization, 'Bearer TEST');
  assert.equal(s.headers.Accept, 'application/json');
  assert.equal(s.headers['CF-Access-Client-Id'], 'kimlik');

  const h = fetchSecenegineEkle({ headers: new Headers({ 'Content-Type': 'application/json' }) }, { 'X-Ek': 'v' });
  assert.equal(h.headers['content-type'], 'application/json');
  assert.equal(h.headers['X-Ek'], 'v');

  const d = fetchSecenegineEkle({ headers: [['Accept', 'a/b']] }, { 'X-Ek': 'v' });
  assert.equal(d.headers.Accept, 'a/b');
  assert.equal(d.headers['X-Ek'], 'v');

  const bos = fetchSecenegineEkle(undefined, { 'X-Ek': 'v' });
  assert.deepEqual(bos, { headers: { 'X-Ek': 'v' } });
});

test('fetchSecenegineEkle: ekleme yoksa seçenek aynen döner', () => {
  const secenek = { method: 'POST' };
  assert.equal(fetchSecenegineEkle(secenek, null), secenek);
  assert.equal(fetchSecenegineEkle(secenek, {}), secenek);
});

test('istekUstbilgilerineEkle: aynı adlı Chromium üstbilgisinin yerine kullanıcı tanımı geçer, yasaklar atlanır', () => {
  const s = istekUstbilgilerineEkle({ Accept: '*/*', 'x-ek': 'eski' }, { 'X-Ek': 'yeni', Cookie: 'sizinti' });
  assert.equal(s.Accept, '*/*');
  assert.equal(s['X-Ek'], 'yeni');
  assert.equal(s['x-ek'], undefined);
  assert.equal(s.Cookie, undefined);
  assert.deepEqual(istekUstbilgilerineEkle({ A: '1' }, null), { A: '1' });
});

// ---- Şifreli depo ----

function sahteDepo({ yazmaHatasi = false } = {}) {
  let metin = null;
  const cagrilar = { yaz: 0, sil: 0 };
  return {
    cagrilar,
    ham: () => metin,
    varMi: () => metin !== null,
    anahtarAl: async () => metin,
    async yaz(m) {
      cagrilar.yaz += 1;
      if (yazmaHatasi) throw new Error('sifreleme-yok');
      metin = m;
    },
    async sil() {
      cagrilar.sil += 1;
      metin = null;
      return { silindi: true };
    },
  };
}

test('ustbilgiDeposuOlustur: kaydet şifreli depoya yazar, adlar değer içermez', async () => {
  const depo = sahteDepo();
  const d = ustbilgiDeposuOlustur({ depo });
  const s = await d.kaydet([{ ad: 'CF-Access-Client-Id', deger: 'kimlik' }, { ad: 'CF-Access-Client-Secret', deger: 'GIZLI_TEST_DEGERI' }]);
  assert.equal(s.ok, true);
  assert.deepEqual(s.adlar, ['CF-Access-Client-Id', 'CF-Access-Client-Secret']);
  assert.ok(!JSON.stringify(s).includes('GIZLI_TEST_DEGERI'));
  assert.deepEqual(d.adlar(), ['CF-Access-Client-Id', 'CF-Access-Client-Secret']);
  assert.equal(d.sayi(), 2);
  assert.ok(depo.ham().includes('GIZLI_TEST_DEGERI')); // depoya (şifreli katman) gider
  // liste() kopya döner
  const kopya = d.liste();
  kopya[0].deger = 'degisti';
  assert.equal(d.liste()[0].deger, 'kimlik');
});

test('ustbilgiDeposuOlustur: yukle kayıtlı listeyi okur; bozuk kayıt boş sayılır ve günlüğe değer yazılmaz', async () => {
  const depo = sahteDepo();
  await depo.yaz(JSON.stringify([{ ad: 'X-Ek', deger: 'GIZLI_TEST_DEGERI' }]));
  const gunluk = [];
  const d = ustbilgiDeposuOlustur({ depo, gunluk: (m) => gunluk.push(m) });
  assert.equal(await d.yukle(), 1);
  assert.equal(d.liste()[0].deger, 'GIZLI_TEST_DEGERI');

  const bozukDepo = sahteDepo();
  await bozukDepo.yaz('{bozuk GIZLI_TEST_DEGERI');
  const g2 = [];
  const d2 = ustbilgiDeposuOlustur({ depo: bozukDepo, gunluk: (m) => g2.push(m) });
  assert.equal(await d2.yukle(), 0);
  assert.equal(g2.length, 1);
  assert.ok(!g2.join('').includes('GIZLI_TEST_DEGERI'));
});

test('ustbilgiDeposuOlustur: boş liste kaydı siler; geçersiz giriş depoya dokunmaz', async () => {
  const depo = sahteDepo();
  const d = ustbilgiDeposuOlustur({ depo });
  await d.kaydet([{ ad: 'X-Ek', deger: 'v' }]);
  const k = await d.kaydet([{ ad: 'Authorization', deger: 'v' }]);
  assert.equal(k.ok, false);
  assert.equal(k.hatalar[0].neden, 'ad-yasak');
  assert.equal(d.sayi(), 1);
  const bos = await d.kaydet([]);
  assert.equal(bos.ok, true);
  assert.equal(depo.varMi(), false);
  assert.equal(d.sayi(), 0);
});

test('ustbilgiDeposuOlustur: deger null olan öğe saklı değeri korur', async () => {
  const depo = sahteDepo();
  const d = ustbilgiDeposuOlustur({ depo });
  await d.kaydet([{ ad: 'CF-Access-Client-Secret', deger: 'ESKI_SIR' }]);
  const s = await d.kaydet([{ ad: 'CF-Access-Client-Secret', deger: null }, { ad: 'X-Yeni', deger: 'v' }]);
  assert.equal(s.ok, true);
  assert.equal(d.liste()[0].deger, 'ESKI_SIR');
  assert.equal(d.liste()[1].ad, 'X-Yeni');
});

test('ustbilgiDeposuOlustur: şifreleme yoksa kayıt reddedilir ve bellek değişmez', async () => {
  const depo = sahteDepo({ yazmaHatasi: true });
  const d = ustbilgiDeposuOlustur({ depo });
  const s = await d.kaydet([{ ad: 'X-Ek', deger: 'v' }]);
  assert.deepEqual(s, { ok: false, sifreleme: true });
  assert.equal(d.sayi(), 0);
});

test('ustbilgiDeposuOlustur: sil ve değişiklik dinleyicisi', async () => {
  const depo = sahteDepo();
  const d = ustbilgiDeposuOlustur({ depo });
  let n = 0;
  d.degistiDinle(() => {
    n += 1;
  });
  d.degistiDinle(() => {
    throw new Error('dinleyici hatası depoyu bozmamalı');
  });
  await d.kaydet([{ ad: 'X-Ek', deger: 'v' }]);
  assert.equal(n, 1);
  assert.deepEqual(await d.sil(), { ok: true });
  assert.equal(n, 2);
  assert.equal(d.sayi(), 0);
  assert.equal(depo.varMi(), false);
});

test('ustbilgiDeposuOlustur: eşzamanlı kayıtlar sıralanır, son çağrı kazanır', async () => {
  const depo = sahteDepo();
  const d = ustbilgiDeposuOlustur({ depo });
  const a = d.kaydet([{ ad: 'X-A', deger: '1' }]);
  const b = d.kaydet([{ ad: 'X-B', deger: '2' }]);
  await Promise.all([a, b]);
  assert.deepEqual(d.adlar(), ['X-B']);
  assert.deepEqual(JSON.parse(depo.ham()), [{ ad: 'X-B', deger: '2' }]);
});
