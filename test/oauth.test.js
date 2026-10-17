'use strict';

/**
 * src/lib/oauth.js (o-57): tarayıcıyla giriş için saf yardımcılar. Ağ, dosya ve Electron yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const oauth = require('../src/lib/oauth');

const DURUM = 'A'.repeat(43);
const JETON = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // HA yenileme anahtarı biçimi (onaltılık dize), test değeri
const ERISIM = 'abcdefghijklmnopqrst.uvwxyz0123456789.ABCDEFGHIJ_KLMN-OP';

const geriCagri = (ek = {}) => ({ metot: 'GET', yol: `/callback?state=${DURUM}&code=KOD12345`, anaBilgisayarBasligi: '127.0.0.1:41000', kapi: 41000, durum: DURUM, ...ek });

test('durumUret: 32 bayt, base64url (43 hane), her çağrıda farklı', () => {
  const a = oauth.durumUret();
  const b = oauth.durumUret();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(oauth.durumUret(() => Buffer.alloc(32, 1)), Buffer.alloc(32, 1).toString('base64url'));
});

test('girisAdresi: HA kökeninin /auth/authorize sayfası; client_id ve redirect_uri aynı döngü adresinden; state eklenir', () => {
  const adres = oauth.girisAdresi({ taban: 'http://192.168.1.50:8123', kapi: 41000, durum: DURUM });
  const url = new URL(adres);
  assert.equal(url.origin, 'http://192.168.1.50:8123');
  assert.equal(url.pathname, '/auth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'http://127.0.0.1:41000/ev-paneli');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:41000/callback');
  assert.equal(url.searchParams.get('state'), DURUM);
  assert.equal(new URL(url.searchParams.get('client_id')).host, new URL(url.searchParams.get('redirect_uri')).host, 'IndieAuth: aynı ana bilgisayar+kapı');
  assert.equal(new URL(oauth.girisAdresi({ taban: 'https://ha.example.com/yol/x?y=1', kapi: 2, durum: DURUM })).origin, 'https://ha.example.com', 'yalnız köken kullanılır');
});

test('girisAdresi: geçersiz taban, şema, kapı ya da state null döner', () => {
  assert.equal(oauth.girisAdresi({ taban: 'kotu', kapi: 41000, durum: DURUM }), null);
  assert.equal(oauth.girisAdresi({ taban: 'ftp://ha.test', kapi: 41000, durum: DURUM }), null);
  assert.equal(oauth.girisAdresi({ taban: 'http://ha.test', kapi: 0, durum: DURUM }), null);
  assert.equal(oauth.girisAdresi({ taban: 'http://ha.test', kapi: 70000, durum: DURUM }), null);
  assert.equal(oauth.girisAdresi({ taban: 'http://ha.test', kapi: 41000, durum: 'kisa' }), null);
});

test('geriCagriSinifla: geçerli kod; fazladan parametre sorun değil', () => {
  assert.deepEqual(oauth.geriCagriSinifla(geriCagri()), { sinif: 'kod', kod: 'KOD12345' });
  assert.deepEqual(oauth.geriCagriSinifla(geriCagri({ yol: `/callback?code=KOD12345&state=${DURUM}&x=1` })), { sinif: 'kod', kod: 'KOD12345' });
});

test('geriCagriSinifla: metot, ana bilgisayar başlığı ya da yol yanlışsa "yok" (sayılmaz)', () => {
  assert.equal(oauth.geriCagriSinifla(geriCagri({ metot: 'POST' })).sinif, 'yok');
  assert.equal(oauth.geriCagriSinifla(geriCagri({ metot: 'HEAD' })).sinif, 'yok');
  for (const baslik of ['evil.test', '127.0.0.1', '127.0.0.1:41001', 'localhost:41000', undefined, '127.0.0.1:41000.evil.test']) {
    assert.equal(oauth.geriCagriSinifla(geriCagri({ anaBilgisayarBasligi: baslik })).sinif, 'yok', `Host=${baslik}`);
  }
  for (const yol of ['/', '/favicon.ico', '/callback/', '/CALLBACK', '/callback2', '//callback', `/x/../callback?state=${DURUM}&code=KOD12345x`]) {
    const s = oauth.geriCagriSinifla(geriCagri({ yol }));
    assert.ok(s.sinif === 'yok' || s.sinif === 'kod', `${yol}: ${s.sinif}`);
  }
  assert.equal(oauth.geriCagriSinifla(geriCagri({ yol: '/' })).sinif, 'yok');
  assert.equal(oauth.geriCagriSinifla(geriCagri({ yol: '/callback/' })).sinif, 'yok');
  assert.equal(oauth.geriCagriSinifla(geriCagri({ yol: undefined })).sinif, 'yok');
});

test('geriCagriSinifla: state yok, yanlış, yinelenen ya da farklı uzunlukta -> "gecersiz"; kod biçimi denetlenir', () => {
  const gecersiz = (yol, neden) => assert.deepEqual(oauth.geriCagriSinifla(geriCagri({ yol })), { sinif: 'gecersiz', neden }, yol);
  gecersiz('/callback?code=KOD12345', 'durum-uyusmuyor');
  gecersiz(`/callback?state=${'B'.repeat(43)}&code=KOD12345`, 'durum-uyusmuyor');
  gecersiz(`/callback?state=${DURUM}x&code=KOD12345`, 'durum-uyusmuyor');
  gecersiz(`/callback?state=${DURUM.slice(1)}&code=KOD12345`, 'durum-uyusmuyor');
  gecersiz(`/callback?state=${DURUM}&state=${DURUM}&code=KOD12345`, 'durum-uyusmuyor');
  gecersiz('/callback?state=&code=KOD12345', 'durum-uyusmuyor');
  gecersiz(`/callback?state=${DURUM}`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=kisa`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=KOD12345&code=KOD54321`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=${'K'.repeat(513)}`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=KOD%0d%0a12345`, 'kod-gecersiz');
  gecersiz(`/callback?state=${DURUM}&code=KOD 12345`, 'kod-gecersiz');
});

test('geriCagriSinifla: geçerli state ile error=... iptaldir; state yanlışsa error bile iptal sayılmaz', () => {
  assert.deepEqual(oauth.geriCagriSinifla(geriCagri({ yol: `/callback?state=${DURUM}&error=access_denied` })), { sinif: 'iptal' });
  assert.equal(oauth.geriCagriSinifla(geriCagri({ yol: `/callback?state=${'B'.repeat(43)}&error=access_denied` })).sinif, 'gecersiz');
});

test('formlar: /auth/token gövdeleri alan alan doğru ve kodlanmış', () => {
  const kod = new URLSearchParams(oauth.kodFormu({ kod: 'K1', istemci: 'http://127.0.0.1:41000/ev-paneli' }));
  assert.deepEqual([...kod.entries()], [['grant_type', 'authorization_code'], ['code', 'K1'], ['client_id', 'http://127.0.0.1:41000/ev-paneli']]);
  const yen = new URLSearchParams(oauth.yenilemeFormu({ yenileme: JETON, istemci: 'http://127.0.0.1:41000/ev-paneli' }));
  assert.deepEqual([...yen.entries()], [['grant_type', 'refresh_token'], ['refresh_token', JETON], ['client_id', 'http://127.0.0.1:41000/ev-paneli']]);
  const iptal = new URLSearchParams(oauth.iptalFormu({ yenileme: JETON }));
  assert.deepEqual([...iptal.entries()], [['token', JETON], ['action', 'revoke']]);
});

test('jetonYaniti: geçerli kod değişimi yanıtı; bitiş zamanı expires_in ile hesaplanır', () => {
  const j = oauth.jetonYaniti({ access_token: ERISIM, token_type: 'Bearer', refresh_token: JETON, expires_in: 1800 }, { yenilemeGerekli: true, simdi: 1_000_000 });
  assert.deepEqual(j, { ok: true, erisim: ERISIM, yenileme: JETON, bitis: 1_000_000 + 1_800_000, omurSn: 1800 });
  const yenileme = oauth.jetonYaniti({ access_token: ERISIM, token_type: 'bearer', expires_in: 600 }, { simdi: 0 });
  assert.equal(yenileme.ok, true);
  assert.equal(yenileme.yenileme, null);
  assert.equal(yenileme.bitis, 600_000);
  assert.equal(oauth.jetonYaniti({ access_token: ERISIM }, { simdi: 0 }).omurSn, 1800, 'expires_in yoksa HA varsayılanı');
  assert.equal(oauth.jetonYaniti({ access_token: ERISIM, expires_in: 10 ** 9 }, { simdi: 0 }).omurSn, 86_400, 'üst sınır');
});

test('jetonYaniti: eksik/bozuk/zararlı alanlar reddedilir (üstbilgi enjeksiyonu, kısa ömür, yanlış tür, yenileme zorunlu)', () => {
  const kotu = (govde, secenek) => assert.deepEqual(oauth.jetonYaniti(govde, { simdi: 0, ...secenek }), { ok: false, neden: 'yanit-gecersiz' }, JSON.stringify(govde));
  kotu(null);
  kotu([]);
  kotu('metin');
  kotu({});
  kotu({ access_token: 'kisa' });
  kotu({ access_token: `${ERISIM}\r\nX-Evil: 1` });
  kotu({ access_token: `${ERISIM} Bearer` });
  kotu({ access_token: 5 });
  kotu({ access_token: ERISIM, token_type: 'mac' });
  kotu({ access_token: ERISIM, refresh_token: 'kisa' });
  kotu({ access_token: ERISIM, refresh_token: 7 });
  kotu({ access_token: ERISIM, expires_in: 5 });
  kotu({ access_token: ERISIM, expires_in: 'uzun' });
  kotu({ access_token: ERISIM, expires_in: NaN });
  kotu({ access_token: ERISIM, expires_in: 1800 }, { yenilemeGerekli: true });
});

test('kaliciRedMi: yalnız 400/401 ve tanınan OAuth hata kodları oturumu bitirir; ağ/5xx/429 bitirmez', () => {
  for (const hata of ['invalid_grant', 'invalid_request', 'invalid_client', 'unauthorized_client', 'access_denied', 'unsupported_grant_type']) {
    assert.equal(oauth.kaliciRedMi(400, { error: hata }), true, hata);
    assert.equal(oauth.kaliciRedMi(401, { error: hata }), true, `401 ${hata}`);
  }
  assert.equal(oauth.kaliciRedMi(400, { error: 'temporarily_unavailable' }), false);
  assert.equal(oauth.kaliciRedMi(400, null), false);
  assert.equal(oauth.kaliciRedMi(400, {}), false);
  assert.equal(oauth.kaliciRedMi(400, { error: 5 }), false);
  for (const durum of [200, 403, 404, 429, 500, 502]) assert.equal(oauth.kaliciRedMi(durum, { error: 'invalid_grant' }), false, `${durum}`);
});

test('oturum kaydı: yaz/çöz gidiş-dönüş; erişim anahtarı dosyaya girmez; bozuk ya da tanınmayan kayıt null', () => {
  const metin = oauth.oturumuYaz({ taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON });
  assert.deepEqual(JSON.parse(metin), { surum: 1, taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON });
  assert.equal(metin.includes(ERISIM), false);
  assert.deepEqual(oauth.oturumuCoz(metin), { taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON });
  assert.equal(oauth.oturumuCoz(oauth.oturumuYaz({ taban: 'http://192.168.1.50:8123/yol?x', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON })).taban, 'http://192.168.1.50:8123', 'taban köken olarak normalleşir');

  const gecerli = { surum: 1, taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON };
  const coz = (ek) => oauth.oturumuCoz(JSON.stringify({ ...gecerli, ...ek }));
  assert.notEqual(coz({}), null);
  assert.equal(oauth.oturumuCoz('{bozuk'), null);
  assert.equal(oauth.oturumuCoz('null'), null);
  assert.equal(oauth.oturumuCoz(undefined), null);
  assert.equal(coz({ surum: 2 }), null);
  assert.equal(coz({ yenileme: 'kisa' }), null);
  assert.equal(coz({ yenileme: `${JETON}\n` }), null);
  assert.equal(coz({ taban: 'ftp://ha.test' }), null);
  assert.equal(coz({ taban: 'kotu' }), null);
  assert.equal(coz({ istemci: 'http://evil.test:41000/ev-paneli' }), null, 'client_id yalnız döngü adresi olabilir');
  assert.equal(coz({ istemci: 'https://127.0.0.1:41000/ev-paneli' }), null);
  assert.equal(coz({ istemci: 'http://127.0.0.1:99999/ev-paneli' }), null);
  assert.equal(coz({ istemci: 'http://127.0.0.1:41000/baska' }), null);
});

test('oturum kaydı: kökenler normalleşir (köken, tekrarsız, en çok 4, yalnız http/https); alan yoksa dönen kayıtta da yoktur', () => {
  assert.deepEqual(oauth.kokenleriDuzelt(['http://192.168.1.50:8123/yol', 'http://192.168.1.50:8123', 'https://ha.example.com/', 'ftp://x', 'x', 5, null, '']), ['http://192.168.1.50:8123', 'https://ha.example.com']);
  assert.deepEqual(oauth.kokenleriDuzelt('metin'), []);
  assert.equal(oauth.kokenleriDuzelt(Array.from({ length: 9 }, (_, i) => `http://h${i}.example.com`)).length, 4);
  const metin = oauth.oturumuYaz({ taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON, kokenler: ['http://192.168.1.50:8123', 'https://baska.example.org/x'] });
  assert.deepEqual(oauth.oturumuCoz(metin).kokenler, ['https://ha.example.com', 'http://192.168.1.50:8123', 'https://baska.example.org']);
  assert.equal(JSON.parse(metin).erisim, undefined);
  assert.equal(Object.hasOwn(oauth.oturumuCoz(oauth.oturumuYaz({ taban: 'https://ha.example.com', istemci: 'http://127.0.0.1:41000/ev-paneli', yenileme: JETON })), 'kokenler'), false);
});
