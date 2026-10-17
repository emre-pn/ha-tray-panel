'use strict';

/**
 * src/oauth-yoneticisi.js (o-57): tarayıcıyla giriş. Gerçek Home Assistant ve internet YOK: jeton ucu sahte işlev, oturum dosyası bellekte.
 * Geri çağrı dinleyicisi GERÇEKTEN 127.0.0.1'de açılır ve gerçek HTTP istekleriyle denenir (döngü adresi; dışarıya çıkılmaz).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { oauthYoneticisiOlustur, birlesikAnahtarDeposuOlustur, nedenKodu, SOGUMA_TABAN_MS } = require('../src/oauth-yoneticisi');
const { HaHatasi } = require('../src/ha-istemcisi');
const oauth = require('../src/lib/oauth');

const TABAN = 'http://192.168.1.50:8123';
const YENILEME = 'r'.repeat(40); // HA yenileme anahtarı yerine test değeri
const erisim = (n) => `e${n}.${'x'.repeat(30)}.${'y'.repeat(12)}`;
const parmak = (a) => crypto.createHash('sha256').update(a).digest('hex').slice(0, 16);
const dk = (n) => n * 60_000;

const bekle = async (kosul, ad = 'koşul', ms = 3000) => {
  const bas = Date.now();
  while (!kosul()) {
    if (Date.now() - bas > ms) assert.fail(`zaman aşımı: ${ad}`);
    await new Promise((coz) => setTimeout(coz, 5));
  }
};

/** Gerçek bir HTTP isteği (döngü adresi). host: Host başlığını değiştirmek için. */
function cagir(kapi, yol, { metot = 'GET', host } = {}) {
  return new Promise((coz, reddet) => {
    const istek = http.request({ host: '127.0.0.1', port: kapi, path: yol, method: metot, headers: host ? { Host: host } : {}, agent: false }, (yanit) => {
      const parcalar = [];
      yanit.on('data', (p) => parcalar.push(p));
      yanit.on('end', () => coz({ durum: yanit.statusCode, basliklar: yanit.headers, govde: Buffer.concat(parcalar).toString('utf8') }));
    });
    istek.on('error', reddet);
    istek.end();
  });
}

const acikYoneticiler = [];
test.afterEach(() => {
  // Bir test yarıda kalsa bile açık dinleyici süreci tutmasın
  for (const yonetici of acikYoneticiler.splice(0)) yonetici.kapat();
});

/** Yönetici + sahte ortam. jeton(form, n): jetonIstegi yanıtı (varsayılan: kod değişimi/yenileme başarılı). */
function kur(ek = {}) {
  const saat = { t: 10_000_000 };
  const gunluk = [];
  const kayit = { istekler: [], acilanUrller: [], degisti: 0, acildi: 0, sonlandi: [], kabul: [], degisimler: [], zamanlayicilar: [] };
  const veri = { metin: null };
  const depo = {
    varMi: () => veri.metin !== null,
    kullanilabilirMi: async () => ek.sifreleme !== false,
    anahtarAl: async () => veri.metin,
    yaz: async (m) => {
      if (ek.yazmaHatasi) throw new Error('disk dolu');
      veri.metin = m;
    },
    sil: async () => {
      veri.metin = null;
    },
  };
  const zaman = {
    setTimeout: (f, ms) => {
      const z = { f, ms, iptal: false, unref() {} };
      kayit.zamanlayicilar.push(z);
      return z;
    },
    clearTimeout: (z) => {
      if (z) z.iptal = true;
    },
  };
  const varsayilanJeton = (form, n) => {
    const alanlar = new URLSearchParams(form);
    if (alanlar.get('grant_type') === 'authorization_code') return { durum: 200, govde: { access_token: erisim(n), token_type: 'Bearer', refresh_token: YENILEME, expires_in: 1800 }, taban: TABAN };
    if (alanlar.get('action') === 'revoke') return { durum: 200, govde: {}, taban: TABAN };
    return { durum: 200, govde: { access_token: erisim(n), token_type: 'Bearer', expires_in: 1800 }, taban: TABAN };
  };
  const yonetici = oauthYoneticisiOlustur({
    depo,
    jetonIstegi: async (girdi) => {
      kayit.istekler.push({ ...girdi, oturumVardi: veri.metin !== null });
      return (ek.jeton ?? varsayilanJeton)(girdi.form, kayit.istekler.length, girdi);
    },
    tabanBul: async () => (ek.taban === undefined ? TABAN : ek.taban),
    tarayiciAc: async (url) => {
      if (ek.tarayiciHatasi) throw new Error('tarayıcı yok');
      kayit.acilanUrller.push(url);
    },
    ayarlarAl: () => ({ yerelAdres: TABAN, disAdres: '' }),
    parmakIzi: parmak,
    erisimKabulEdildi: (taban, anahtar) => kayit.kabul.push([taban, anahtar]),
    erisimDegisti: (bilgi) => kayit.degisimler.push(bilgi),
    degisti: () => {
      kayit.degisti += 1;
    },
    oturumAcildi: async () => {
      kayit.acildi += 1;
    },
    oturumSonlandi: (neden) => kayit.sonlandi.push(neden),
    simdi: () => saat.t,
    zaman,
    t: (anahtar) => anahtar,
    gunluk: (m) => gunluk.push(m),
    ...(ek.yonetici ?? {}),
  });
  acikYoneticiler.push(yonetici);
  /** Oturumu doğrudan kurar (giriş akışı olmadan). */
  const oturumKur = (ayrinti = {}) => {
    veri.metin = oauth.oturumuYaz({ taban: TABAN, istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: YENILEME, ...ayrinti });
  };
  return { yonetici, depo, veri, saat, gunluk, kayit, oturumKur };
}

/** Girişi başlatır; açılan adresten kapı ve state'i çıkarır. */
async function girisBaslat(o) {
  const yanit = await o.yonetici.girisBaslat();
  assert.deepEqual(yanit, { ok: true });
  const url = new URL(o.kayit.acilanUrller.at(-1));
  return { url, kapi: Number(new URL(url.searchParams.get('redirect_uri')).port), state: url.searchParams.get('state'), istemci: url.searchParams.get('client_id') };
}

const kapaliMi = (kapi) =>
  new Promise((coz) => {
    const istek = http.request({ host: '127.0.0.1', port: kapi, path: '/', agent: false }, () => coz(false));
    istek.on('error', () => coz(true));
    istek.end();
  });

test('giriş: tarayıcı yalnız ayardaki HA adresinin /auth/authorize sayfasıyla açılır; dinleyici YALNIZ 127.0.0.1\'de dinler', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  assert.equal(g.url.origin, TABAN);
  assert.equal(g.url.pathname, '/auth/authorize');
  assert.equal(g.istemci, `http://127.0.0.1:${g.kapi}/ev-paneli`);
  assert.equal(g.url.searchParams.get('redirect_uri'), `http://127.0.0.1:${g.kapi}/callback`);
  assert.match(g.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(o.kayit.acilanUrller.length, 1);
  const durum = await o.yonetici.durum();
  assert.equal(durum.asama, 'bekliyor');
  assert.ok(durum.kalanSn > 290 && durum.kalanSn <= 300);
  assert.equal(o.kayit.zamanlayicilar.length, 1);
  assert.equal(o.kayit.zamanlayicilar[0].ms, oauth.GIRIS_ZAMAN_ASIMI_MS);
  // 127.0.0.1 dışındaki bir arayüzden erişilemez: dinleyici bu adresle bağlıdır
  assert.equal(await kapaliMi(g.kapi), false);
  o.yonetici.girisIptal();
  assert.equal(await kapaliMi(g.kapi), true);
});

test('giriş: geçerli geri çağrı kodu jetona çevirir; oturum şifreli depoya yazılır; dinleyici kapanır; sır yanıta, günlüğe ve duruma sızmaz', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  const yanit = await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
  assert.equal(yanit.durum, 200);
  assert.match(yanit.basliklar['content-security-policy'], /default-src 'none'/);
  assert.match(yanit.basliklar['content-security-policy'], /style-src 'sha256-/);
  assert.doesNotMatch(yanit.basliklar['content-security-policy'], /unsafe-inline|script-src/);
  assert.equal(yanit.basliklar['cache-control'], 'no-store');
  assert.equal(yanit.basliklar['referrer-policy'], 'no-referrer');
  assert.equal(yanit.basliklar['x-content-type-options'], 'nosniff');
  assert.equal(yanit.basliklar.connection, 'close');
  assert.equal(yanit.govde.includes('KOD-123456789'), false, 'sayfa kodu yansıtmaz');
  assert.equal(yanit.govde.includes(g.state), false, 'sayfa state yansıtmaz');
  assert.match(yanit.govde, /<h1>oturum\.sayfa\.tamamBaslik<\/h1>/);
  assert.doesNotMatch(yanit.govde, /<script/i);

  await bekle(() => o.kayit.acildi === 1, 'oturumAcildi');
  assert.equal(o.kayit.istekler.length, 1);
  const form = new URLSearchParams(o.kayit.istekler[0].form);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'KOD-123456789');
  assert.equal(form.get('client_id'), g.istemci);
  assert.equal(o.kayit.istekler[0].taban, TABAN, 'kod, girişin başladığı adrese gönderilir');
  assert.deepEqual(oauth.oturumuCoz(o.veri.metin), { taban: TABAN, istemci: g.istemci, yenileme: YENILEME });
  assert.equal(o.veri.metin.includes(erisim(1)), false, 'erişim anahtarı dosyaya yazılmaz');
  assert.deepEqual(o.kayit.kabul, [[TABAN, erisim(1)]]);
  assert.deepEqual(o.kayit.degisimler, [{ eski: null, yeni: parmak(erisim(1)) }]);

  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1), 'taze erişim anahtarı yeniden istek atmadan verilir');
  assert.equal(o.kayit.istekler.length, 1);
  const durum = await o.yonetici.durum();
  assert.deepEqual({ ...durum, anaBilgisayar: undefined }, { var: true, cozuldu: true, anaBilgisayar: undefined, asama: 'yok', kalanSn: 0, erisim: 'taze', son: { sonuc: 'tamam', neden: null } });
  assert.equal(durum.anaBilgisayar, '192.168.1.50:8123');
  assert.equal(await kapaliMi(g.kapi), true, 'giriş bitince dinleyici kapalı');
  assert.equal(o.kayit.zamanlayicilar[0].iptal, true, 'giriş zamanlayıcısı temizlendi');

  const sirlar = [erisim(1), YENILEME, 'KOD-123456789', g.state];
  const toplu = JSON.stringify([durum, o.gunluk]);
  for (const sir of sirlar) assert.equal(toplu.includes(sir), false, 'durum/günlükte sır yok');
  assert.ok(o.gunluk.length > 0);
});

test('giriş: ikinci geri çağrı kabul edilmez (tek kullanımlık); eski state ile yeni girişe saldırı da geçmez', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
  await bekle(() => o.kayit.acildi === 1);
  await assert.rejects(cagir(g.kapi, `/callback?code=KOD-987654321&state=${g.state}`), /ECONNREFUSED/);
  assert.equal(o.kayit.istekler.length, 1);
  // yeni giriş yeni state/kapı üretir; eskisi geçersizdir
  const g2 = await girisBaslat(o);
  assert.notEqual(g2.state, g.state);
  const eski = await cagir(g2.kapi, `/callback?code=KOD-987654321&state=${g.state}`);
  assert.equal(eski.durum, 400);
  o.yonetici.girisIptal();
});

test('giriş: yanlış/eksik state ve bozuk kod 400 alır, girişi bitirmez; geçerli geri çağrı sonra yine çalışır; 5. geçersizde giriş iptal olur', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  for (const yol of ['/callback?code=KOD-123456789', `/callback?code=KOD-123456789&state=${'B'.repeat(43)}`, `/callback?state=${g.state}`, `/callback?state=${g.state}&code=k`]) {
    const yanit = await cagir(g.kapi, yol);
    assert.equal(yanit.durum, 400, yol);
    assert.match(yanit.govde, /oturum\.sayfa\.hataBaslik/);
  }
  assert.equal((await o.yonetici.durum()).asama, 'bekliyor');
  assert.equal(o.kayit.istekler.length, 0, 'geçersiz geri çağrı jeton ucuna HİÇ istek göndermez');
  const iyi = await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
  assert.equal(iyi.durum, 200);
  await bekle(() => o.kayit.acildi === 1);

  const h = kur();
  const g2 = await girisBaslat(h);
  for (let i = 0; i < oauth.EN_COK_GECERSIZ_GERI_CAGRI; i += 1) await cagir(g2.kapi, '/callback?code=KOD-123456789&state=yanlis');
  await bekle(async () => (await h.yonetici.durum()).asama === 'yok');
  const durum = await h.yonetici.durum();
  assert.deepEqual(durum.son, { sonuc: 'hata', neden: 'cok-fazla-deneme' });
  assert.equal(await kapaliMi(g2.kapi), true);
  assert.equal(h.kayit.istekler.length, 0);
});

test('giriş: geri çağrı olmayan istekler (yanlış yol, metot ya da Host başlığı) 404 alır ve sayılmaz', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  const gecerliYol = `/callback?code=KOD-123456789&state=${g.state}`;
  // Dinleyici en çok 8 eşzamanlı bağlantı kabul eder (kaba kuvvet/yük koruması): sekiz istek birlikte, kalanlar sırayla
  const denemeler = [
    cagir(g.kapi, '/'),
    cagir(g.kapi, '/favicon.ico'),
    cagir(g.kapi, '/callback/' + gecerliYol.slice(9)),
    cagir(g.kapi, gecerliYol, { metot: 'POST' }),
    cagir(g.kapi, gecerliYol, { metot: 'HEAD' }),
    cagir(g.kapi, gecerliYol, { host: 'evil.example.com' }),
    cagir(g.kapi, gecerliYol, { host: `localhost:${g.kapi}` }),
    cagir(g.kapi, gecerliYol, { host: '127.0.0.1' }),
  ];
  for (const yanit of await Promise.all(denemeler)) assert.equal(yanit.durum, 404);
  for (let i = 0; i < 12; i += 1) assert.equal((await cagir(g.kapi, '/gizli')).durum, 404);
  assert.equal((await o.yonetici.durum()).asama, 'bekliyor', '404\'ler giriş iptal sayacına girmez');
  assert.equal(o.kayit.istekler.length, 0);
  const iyi = await cagir(g.kapi, gecerliYol);
  assert.equal(iyi.durum, 200);
  await bekle(() => o.kayit.acildi === 1);
});

test('giriş: kullanıcı HA\'da vazgeçerse (error=) iptal sayılır; jeton ucuna istek gitmez', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  const yanit = await cagir(g.kapi, `/callback?state=${g.state}&error=access_denied`);
  assert.equal(yanit.durum, 200);
  assert.match(yanit.govde, /oturum\.sayfa\.iptalBaslik/);
  await bekle(async () => (await o.yonetici.durum()).asama === 'yok');
  assert.deepEqual((await o.yonetici.durum()).son, { sonuc: 'iptal', neden: null });
  assert.equal(o.kayit.istekler.length, 0);
  assert.equal(o.veri.metin, null);
  assert.equal(await kapaliMi(g.kapi), true);
});

test('giriş: iptal, zaman aşımı, ikinci başlatma ve tarayıcı açılamaması', async () => {
  const a = kur();
  const ga = await girisBaslat(a);
  assert.deepEqual(await a.yonetici.girisBaslat(), { ok: false, neden: 'suruyor' }, 'aynı anda tek giriş');
  assert.deepEqual(a.yonetici.girisIptal(), { ok: true });
  assert.deepEqual((await a.yonetici.durum()).son, { sonuc: 'iptal', neden: null });
  assert.equal(await kapaliMi(ga.kapi), true);
  assert.deepEqual(a.yonetici.girisIptal(), { ok: true }, 'giriş yokken iptal zararsız');

  const b = kur();
  const gb = await girisBaslat(b);
  b.kayit.zamanlayicilar[0].f(); // 5 dakika doldu
  assert.deepEqual((await b.yonetici.durum()).son, { sonuc: 'zaman-asimi', neden: null });
  assert.equal(await kapaliMi(gb.kapi), true);
  assert.equal(b.kayit.istekler.length, 0);

  const c = kur({ tarayiciHatasi: true });
  assert.deepEqual(await c.yonetici.girisBaslat(), { ok: false, neden: 'tarayici' });
  assert.equal((await c.yonetici.durum()).asama, 'yok');
  assert.equal(await c.yonetici.girisBaslat().then((y) => y.neden), 'tarayici', 'başarısız başlatma sonraki denemeyi engellemez');
});

test('giriş: önkoşullar — şifreleme yok, ulaşılabilir adres yok, ayarda olmayan adres, dinleyici açılamıyor', async () => {
  assert.deepEqual(await kur({ sifreleme: false }).yonetici.girisBaslat(), { ok: false, neden: 'sifreleme-yok' });
  assert.deepEqual(await kur({ taban: null }).yonetici.girisBaslat(), { ok: false, neden: 'adres-yok' });
  assert.deepEqual(await kur({ taban: 'http://baska.example.com' }).yonetici.girisBaslat(), { ok: false, neden: 'adres-yok' }, 'ayarda olmayan köken için tarayıcı açılmaz');
  const sahteHttp = {
    createServer: () => {
      const sunucu = new EventEmitter();
      sunucu.listen = () => {
        setImmediate(() => sunucu.emit('error', new Error('EADDRINUSE')));
        return sunucu;
      };
      sunucu.close = () => {};
      return sunucu;
    },
  };
  const o = kur({ yonetici: { httpModulu: sahteHttp } });
  assert.deepEqual(await o.yonetici.girisBaslat(), { ok: false, neden: 'dinleyici' });
  assert.equal(o.kayit.acilanUrller.length, 0, 'dinleyici yokken tarayıcı açılmaz');
  assert.equal((await o.yonetici.durum()).asama, 'yok');
});

test('giriş: kod değişimi başarısızlıkları — oturum yazılmaz, bağlantı tazelenmez, neden Ayarlar\'a kodla iletilir', async () => {
  const durumlar = [
    [() => ({ durum: 400, govde: { error: 'invalid_grant' }, taban: TABAN }), 'kod-reddedildi'],
    [() => ({ durum: 401, govde: null, taban: TABAN }), 'kod-reddedildi'],
    [() => ({ durum: 200, govde: { token_type: 'Bearer' }, taban: TABAN }), 'yanit-gecersiz'],
    [() => ({ durum: 200, govde: { access_token: erisim(1), refresh_token: YENILEME }, taban: TABAN }), null], // başarılı (expires_in yok: varsayılan)
    [() => ({ durum: 200, govde: { access_token: erisim(1), expires_in: 1800 }, taban: TABAN }), 'yanit-gecersiz'], // yenileme anahtarı yok
    [() => { throw new HaHatasi('baglanti'); }, 'baglanti'],
    [() => { throw new HaHatasi('yasak-erisim', 403); }, 'yasak'],
    [() => { throw new HaHatasi('duraklatildi', 403); }, 'yasak'],
    [() => { throw new HaHatasi('sunucu', 500); }, 'sunucu'],
    [() => { throw new HaHatasi('kaynak-izinsiz'); }, 'adres'],
    [() => { throw new HaHatasi('dogrulanamadi'); }, 'engelli'],
    [() => { throw new Error('beklenmeyen'); }, 'baglanti'],
  ];
  for (const [jeton, beklenen] of durumlar) {
    const o = kur({ jeton: (form, n) => (new URLSearchParams(form).get('grant_type') === 'authorization_code' ? jeton(form, n) : { durum: 200, govde: {}, taban: TABAN }) });
    const g = await girisBaslat(o);
    await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
    await bekle(async () => (await o.yonetici.durum()).asama === 'yok');
    const durum = await o.yonetici.durum();
    if (beklenen === null) {
      assert.equal(durum.son.sonuc, 'tamam');
      continue;
    }
    assert.deepEqual(durum.son, { sonuc: 'hata', neden: beklenen });
    assert.equal(o.veri.metin, null, 'başarısız girişte oturum yazılmaz');
    assert.equal(o.kayit.acildi, 0, 'başarısız girişte bağlantı tazelenmez, elle anahtar silinmez');
    assert.equal(await o.yonetici.erisimAnahtariAl(), null);
  }
});

test('giriş: oturum yazılamazsa giriş geri alınır ve HA\'daki yeni yenileme anahtarı iptal edilir', async () => {
  const o = kur({ yazmaHatasi: true });
  const g = await girisBaslat(o);
  await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
  await bekle(async () => (await o.yonetici.durum()).asama === 'yok');
  assert.deepEqual((await o.yonetici.durum()).son, { sonuc: 'hata', neden: 'saklanamadi' });
  assert.equal(o.veri.metin, null);
  const iptal = o.kayit.istekler.find((i) => new URLSearchParams(i.form).get('action') === 'revoke');
  assert.ok(iptal, 'iptal isteği gitti');
  assert.equal(new URLSearchParams(iptal.form).get('token'), YENILEME);
  assert.equal(o.kayit.acildi, 0);
  assert.equal(await o.yonetici.erisimAnahtariAl(), null, 'saklanamayan oturumun erişim anahtarı kullanılmaz');
});

test('giriş: yeni giriş eski oturumun yenileme anahtarını HA\'da iptal eder', async () => {
  const o = kur();
  o.oturumKur({ yenileme: 'o'.repeat(40) });
  const g = await girisBaslat(o);
  await cagir(g.kapi, `/callback?code=KOD-123456789&state=${g.state}`);
  await bekle(() => o.kayit.acildi === 1);
  assert.equal(oauth.oturumuCoz(o.veri.metin).yenileme, YENILEME);
  const iptal = o.kayit.istekler.find((i) => new URLSearchParams(i.form).get('action') === 'revoke');
  assert.equal(new URLSearchParams(iptal.form).get('token'), 'o'.repeat(40));
});

test('yenileme: erişim anahtarı taze olduğu sürece istek atılmaz; tek uçuş; bitime 3 dk kala yenilenir ve parmak izleri bildirilir', async () => {
  const o = kur();
  o.oturumKur();
  const sonuclar = await Promise.all([o.yonetici.erisimAnahtariAl(), o.yonetici.erisimAnahtariAl(), o.yonetici.erisimAnahtariAl()]);
  assert.deepEqual(sonuclar, [erisim(1), erisim(1), erisim(1)]);
  assert.equal(o.kayit.istekler.length, 1, 'eşzamanlı çağrılar tek istek paylaşır');
  const form = new URLSearchParams(o.kayit.istekler[0].form);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), YENILEME);
  assert.equal(form.get('client_id'), 'http://127.0.0.1:41000/ev-paneli', 'yenileme, anahtarı veren client_id ile yapılır');
  assert.equal(o.kayit.istekler[0].taban, undefined, 'adres REST ile aynı yoldan (apiTabaniBul) seçilir');

  o.saat.t += dk(26); // 4 dk kaldı: henüz taze
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1));
  assert.equal(o.kayit.istekler.length, 1);
  o.saat.t += dk(2); // 2 dk kaldı: yenilenir
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(2));
  assert.equal(o.kayit.istekler.length, 2);
  assert.deepEqual(o.kayit.degisimler, [{ eski: null, yeni: parmak(erisim(1)) }, { eski: parmak(erisim(1)), yeni: parmak(erisim(2)) }]);
  assert.deepEqual(o.kayit.kabul.map(([, a]) => a), [erisim(1), erisim(2)], 'HA\'nın verdiği her erişim anahtarı yetki kesiciye "doğrulanmış" bildirilir');
  assert.ok(o.kayit.degisti >= 2);
});

test('yenileme: geçici hatada ömrü süren anahtar verilir, süresi dolmuş anahtar ASLA verilmez; artan beklemeyle yeniden denenir', async () => {
  let basarisiz = false;
  const o = kur({
    jeton: (form, n) => {
      if (basarisiz) throw new HaHatasi('baglanti');
      return { durum: 200, govde: { access_token: erisim(n), token_type: 'Bearer', expires_in: 1800 }, taban: TABAN };
    },
  });
  o.oturumKur();
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1));

  basarisiz = true;
  o.saat.t += dk(28); // 2 dk ömrü kaldı, yenileme başarısız: eldeki anahtar hâlâ geçerli
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1));
  assert.equal(o.kayit.istekler.length, 2);
  assert.equal((await o.yonetici.durum()).erisim, 'yenilenemedi');
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1));
  assert.equal(o.kayit.istekler.length, 2, 'bekleme sürerken ağa çıkılmaz');

  o.saat.t += dk(2); // anahtarın ömrü bitti
  await assert.rejects(o.yonetici.erisimAnahtariAl(), (h) => h instanceof HaHatasi && h.tur === 'baglanti', 'süresi dolmuş anahtar verilmez; "anahtar yok" değil bağlantı hatası');
  assert.equal(o.kayit.istekler.length, 3, 'bekleme bitmişti: yenileme tekrar denendi');
  await assert.rejects(o.yonetici.erisimAnahtariAl(), (h) => h.tur === 'baglanti');
  assert.equal(o.kayit.istekler.length, 3, 'artan bekleme: hemen yeniden denenmez');

  o.saat.t += SOGUMA_TABAN_MS * 2 + 1;
  await assert.rejects(o.yonetici.erisimAnahtariAl());
  assert.equal(o.kayit.istekler.length, 4);
  basarisiz = false;
  o.saat.t += 5 * 60_000 + 1; // bekleme tavanı 5 dk
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(5), 'ağ dönünce yenilenir');
  assert.equal((await o.yonetici.durum()).erisim, 'taze');
  assert.equal(o.veri.metin !== null, true, 'geçici hata oturumu silmez');
});

test('yenileme: HA\'nın geçici hataları (403 duraklatma, 5xx, bozuk yanıt) oturumu silmez; hata türü çağırana iletilir', async () => {
  for (const [uret, tur] of [
    [() => { throw new HaHatasi('yasak-erisim', 403); }, 'yasak-erisim'],
    [() => { throw new HaHatasi('duraklatildi', 403); }, 'duraklatildi'],
    [() => { throw new HaHatasi('sunucu', 502); }, 'sunucu'],
    [() => ({ durum: 200, govde: { access_token: 'kisa' }, taban: TABAN }), 'sunucu'],
    [() => ({ durum: 500, govde: null, taban: TABAN }), 'sunucu'],
    [() => ({ durum: 401, govde: null, taban: TABAN }), 'sunucu'], // tanınmayan 401: kalıcı red sayılmaz
    [() => ({ durum: 400, govde: { error: 'temporarily_unavailable' }, taban: TABAN }), 'sunucu'],
    [() => { throw new Error('beklenmeyen'); }, 'baglanti'],
  ]) {
    const o = kur({ jeton: uret });
    o.oturumKur();
    await assert.rejects(o.yonetici.erisimAnahtariAl(), (h) => h instanceof HaHatasi && h.tur === tur, tur);
    assert.notEqual(o.veri.metin, null);
    assert.deepEqual(o.kayit.sonlandi, []);
  }
});

test('yenileme: HA yenileme anahtarını reddederse (invalid_grant) oturum silinir, bildirim tetiklenir, bir daha istek gitmez', async () => {
  const o = kur({ jeton: () => ({ durum: 400, govde: { error: 'invalid_grant' }, taban: TABAN }) });
  o.oturumKur();
  assert.equal(await o.yonetici.erisimAnahtariAl(), null);
  assert.equal(o.veri.metin, null);
  assert.equal(o.yonetici.oturumVarMi(), false);
  assert.deepEqual(o.kayit.sonlandi, ['sunucu-reddetti']);
  assert.equal(await o.yonetici.erisimAnahtariAl(), null);
  assert.equal(o.kayit.istekler.length, 1);
  assert.equal((await o.yonetici.durum()).var, false);

  // client_id uyuşmazlığı (invalid_request) da kalıcıdır
  const k = kur({ jeton: () => ({ durum: 400, govde: { error: 'invalid_request' }, taban: TABAN }) });
  k.oturumKur();
  assert.equal(await k.yonetici.erisimAnahtariAl(), null);
  assert.deepEqual(k.kayit.sonlandi, ['sunucu-reddetti']);
});

test('yenileme: yenileme anahtarı dönerse (OAuth 2.1) yenisi saklanır; çözülemeyen oturum kaydı "anahtar yok" sayılır ve istek atılmaz', async () => {
  const yeni = 'n'.repeat(40);
  const o = kur({ jeton: (form, n) => ({ durum: 200, govde: { access_token: erisim(n), refresh_token: yeni, expires_in: 1800 }, taban: TABAN }) });
  o.oturumKur();
  assert.equal(await o.yonetici.erisimAnahtariAl(), erisim(1));
  assert.equal(oauth.oturumuCoz(o.veri.metin).yenileme, yeni);

  for (const bozuk of ['rastgele metin', '{"surum":9}', 'null']) {
    const b = kur();
    b.veri.metin = bozuk;
    assert.equal(await b.yonetici.erisimAnahtariAl(), null);
    assert.equal(b.kayit.istekler.length, 0);
    const durum = await b.yonetici.durum();
    assert.equal(durum.var, true);
    assert.equal(durum.cozuldu, false, 'Ayarlar "okunamıyor" uyarısını gösterir');
  }
});

test('yenileme: yenileme sürerken oturum kapatılırsa sonuç çöpe gider (silinen oturum geri gelmez)', async () => {
  let birak;
  const bekleyen = new Promise((coz) => { birak = coz; });
  const o = kur({ jeton: async (form, n) => { await bekleyen; return { durum: 200, govde: { access_token: erisim(n), expires_in: 1800 }, taban: TABAN }; } });
  o.oturumKur();
  const yenileme = o.yonetici.erisimAnahtariAl();
  await bekle(() => o.kayit.istekler.length === 1);
  await o.yonetici.yerelSil();
  birak();
  assert.equal(await yenileme, null);
  assert.equal(o.veri.metin, null);
  assert.equal(await o.yonetici.erisimAnahtariAl(), null);
  assert.equal(o.yonetici.gecerliParmak(), null);
});

test('erisimReddedildi: yalnız bu oturumun erişim anahtarı için true; bir kez yenilenir; 30 dk içinde ikinci red oturumu bitirir', async () => {
  const o = kur();
  o.oturumKur();
  const ilk = await o.yonetici.erisimAnahtariAl();
  assert.equal(o.yonetici.erisimReddedildi(parmak('baska-anahtar')), false, 'başka anahtarın reddi bu yöneticiyi ilgilendirmez');
  assert.equal(o.yonetici.gecerliParmak(), parmak(ilk));
  assert.equal(o.yonetici.erisimReddedildi(parmak(ilk)), true);
  assert.equal(o.yonetici.gecerliParmak(), null, 'reddedilen anahtar bir daha verilmez');
  assert.equal(o.yonetici.erisimReddedildi(parmak(ilk)), false, 'tekrar eden bildirim yok sayılır');
  const yeni = await o.yonetici.erisimAnahtariAl();
  assert.equal(yeni, erisim(2), 'yenileme anahtarıyla yeni erişim anahtarı alındı');
  assert.notEqual(o.veri.metin, null);

  o.saat.t += dk(5);
  assert.equal(o.yonetici.erisimReddedildi(parmak(yeni)), true);
  await bekle(() => o.kayit.sonlandi.length === 1, 'oturum bitti');
  assert.equal(o.veri.metin, null);
  assert.deepEqual(o.kayit.sonlandi, ['surekli-reddedildi']);
  assert.equal(await o.yonetici.erisimAnahtariAl(), null);

  // pencere dışındaki ikinci red sayaçta eskimiş sayılır
  const p = kur();
  p.oturumKur();
  const a = await p.yonetici.erisimAnahtariAl();
  p.yonetici.erisimReddedildi(parmak(a));
  p.saat.t += dk(31);
  const b = await p.yonetici.erisimAnahtariAl();
  assert.equal(p.yonetici.erisimReddedildi(parmak(b)), true);
  assert.notEqual(p.veri.metin, null, '31 dk sonraki red oturumu bitirmez');
  assert.deepEqual(p.kayit.sonlandi, []);
});

test('çıkış: yerel oturum ÖNCE silinir, sonra HA\'daki yenileme anahtarı iptal edilir; iptal başarısızsa bile yerel oturum gitmiştir', async () => {
  const o = kur();
  o.oturumKur();
  await o.yonetici.erisimAnahtariAl();
  assert.deepEqual(await o.yonetici.cikis(), { ok: true, iptalEdildi: true });
  const iptal = o.kayit.istekler.at(-1);
  assert.deepEqual([...new URLSearchParams(iptal.form).entries()], [['token', YENILEME], ['action', 'revoke']]);
  assert.equal(iptal.oturumVardi, false, 'iptal isteği gittiğinde yerel oturum çoktan silinmişti');
  assert.equal(o.veri.metin, null);
  assert.equal(o.yonetici.gecerliParmak(), null);
  assert.equal(await o.yonetici.erisimAnahtariAl(), null);

  const h = kur({ jeton: () => { throw new HaHatasi('baglanti'); } });
  h.oturumKur();
  assert.deepEqual(await h.yonetici.cikis(), { ok: true, iptalEdildi: false });
  assert.equal(h.veri.metin, null, 'ağ yokken de yerel oturum silinir');

  const r = kur({ jeton: () => ({ durum: 400, govde: { error: 'invalid_request' }, taban: TABAN }) });
  r.oturumKur();
  assert.deepEqual(await r.yonetici.cikis(), { ok: true, iptalEdildi: false });

  const yok = kur();
  assert.deepEqual(await yok.yonetici.cikis(), { ok: true, iptalEdildi: false });
  assert.equal(yok.kayit.istekler.length, 0, 'oturum yokken ağa çıkılmaz');

  const arka = kur();
  arka.oturumKur();
  assert.deepEqual(await arka.yonetici.cikis({ iptal: true, bekle: false }), { ok: true, iptalEdildi: false }, 'bekleme yok: sonuç beklenmez');
  await bekle(() => arka.kayit.istekler.length === 1, 'arka plan iptali');
  const yerel = kur();
  yerel.oturumKur();
  await yerel.yonetici.cikis({ iptal: false });
  assert.equal(yerel.kayit.istekler.length, 0, 'iptal: false yalnız yerel siler');
});

test('birleşik anahtar deposu: elle anahtar varsa o; yoksa tarayıcı oturumunun erişim anahtarı; elle anahtar kaydı oturumu kapatır; sil ikisini de siler', async () => {
  const cagrilar = [];
  let manuelVar = false;
  let oturumVar = false;
  const manuel = {
    varMi: () => manuelVar,
    kullanilabilirMi: async () => true,
    anahtarAl: async () => (manuelVar ? 'ELLE-ANAHTAR' : null),
    yaz: async (a) => { cagrilar.push(['manuel.yaz', a]); manuelVar = true; },
    sil: async () => { cagrilar.push(['manuel.sil']); manuelVar = false; },
    karantinayaAl: () => true,
    karantinadaMi: () => false,
  };
  const oturum = {
    oturumVarMi: () => oturumVar,
    erisimAnahtariAl: async () => (oturumVar ? 'OTURUM-ANAHTARI' : null),
    cikis: async (s) => { cagrilar.push(['oturum.cikis', s]); oturumVar = false; },
    yerelSil: async () => { cagrilar.push(['oturum.yerelSil']); oturumVar = false; },
  };
  const depo = birlesikAnahtarDeposuOlustur({ manuel, oturum });
  assert.equal(depo.varMi(), false);
  assert.equal(await depo.anahtarAl(), null);

  oturumVar = true;
  assert.equal(depo.varMi(), true);
  assert.equal(await depo.anahtarAl(), 'OTURUM-ANAHTARI');
  assert.equal(await depo.kullanilabilirMi(), true);

  await depo.yaz('ELLE-ANAHTAR');
  assert.deepEqual(cagrilar, [['manuel.yaz', 'ELLE-ANAHTAR'], ['oturum.cikis', { iptal: true, bekle: false }]], 'elle anahtar kazanır; oturum kapanır (HA\'daki iptal arka planda)');
  assert.equal(await depo.anahtarAl(), 'ELLE-ANAHTAR');
  cagrilar.length = 0;
  await depo.yaz('BASKA-ELLE');
  assert.deepEqual(cagrilar, [['manuel.yaz', 'BASKA-ELLE']], 'oturum yoksa ağa/oturuma dokunulmaz');

  oturumVar = true;
  assert.deepEqual(await depo.sil(), { silindi: true });
  assert.deepEqual(cagrilar.slice(-2), [['manuel.sil'], ['oturum.yerelSil']]);
  assert.equal(depo.varMi(), false);
  assert.equal(depo.karantinayaAl(), true);
  assert.equal(depo.karantinadaMi(), false);
});

test('IPC işleyicileri: dört kanal; durum yanıtı jeton içermez; giriş-iptal ve çıkış çalışır', async () => {
  const o = kur();
  const isleyiciler = new Map(o.yonetici.ipcIsleyicileri());
  assert.deepEqual([...isleyiciler.keys()], ['oturum:durum', 'oturum:giris-baslat', 'oturum:giris-iptal', 'oturum:cikis']);
  assert.deepEqual(await isleyiciler.get('oturum:durum')(), { ok: true, oturum: { var: false, cozuldu: false, anaBilgisayar: null, asama: 'yok', kalanSn: 0, erisim: 'yok', son: null } });
  assert.deepEqual(await isleyiciler.get('oturum:giris-baslat')(), { ok: true });
  assert.equal((await isleyiciler.get('oturum:durum')()).oturum.asama, 'bekliyor');
  assert.deepEqual(await isleyiciler.get('oturum:giris-iptal')(), { ok: true });
  o.oturumKur();
  assert.deepEqual(await isleyiciler.get('oturum:cikis')(), { ok: true, iptalEdildi: true });
});

test('kapat: açık dinleyici kalmaz (uygulama kapanırken)', async () => {
  const o = kur();
  const g = await girisBaslat(o);
  o.yonetici.kapat();
  assert.equal(await kapaliMi(g.kapi), true);
  o.yonetici.kapat();
});

test('nedenKodu: HaHatasi türleri Ayarlar neden kodlarına eşlenir', () => {
  assert.equal(nedenKodu(new HaHatasi('yasak-erisim')), 'yasak');
  assert.equal(nedenKodu(new HaHatasi('duraklatildi')), 'yasak');
  assert.equal(nedenKodu(new HaHatasi('sunucu')), 'sunucu');
  assert.equal(nedenKodu(new HaHatasi('kaynak-izinsiz')), 'adres');
  for (const tur of ['reddedildi', 'dogrulanamadi', 'yerel-yasak', 'ikinci-onay']) assert.equal(nedenKodu(new HaHatasi(tur)), 'engelli');
  assert.equal(nedenKodu(new HaHatasi('baglanti')), 'baglanti');
  assert.equal(nedenKodu(new Error('x')), 'baglanti');
  assert.equal(nedenKodu(null), 'baglanti');
});
