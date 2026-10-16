'use strict';

/**
 * Yeni sürüm denetimi (o-40): src/lib/surum-denetimi.js. Ağ ve dosya sistemi sahtedir; gerçek istek gitmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SURUM_API_ADRESI,
  SURUM_SAYFASI,
  DENETIM_ARALIGI_MS,
  ELLE_ARALIK_MS,
  surumCoz,
  surumKarsilastir,
  surumSayfasiGecerliMi,
  yanitiCoz,
  durumuDuzelt,
  dosyaDeposu,
  surumDenetleyicisiOlustur,
} = require('../src/lib/surum-denetimi');

const GUN = DENETIM_ARALIGI_MS;
const T0 = 1_800_000_000_000;

/** Sahte yanıt: { durum, govde, url, uzunluk }. */
const yanit = ({ ok = true, govde = '', url = SURUM_API_ADRESI, uzunluk = null } = {}) => ({
  ok,
  url,
  headers: { get: (ad) => (ad.toLowerCase() === 'content-length' && uzunluk !== null ? String(uzunluk) : null) },
  text: async () => govde,
});
const surumGovdesi = (etiket, ek = {}) => JSON.stringify({ tag_name: etiket, html_url: `https://github.com/emre-pn/ha-tray-panel/releases/tag/${etiket}`, draft: false, prerelease: false, ...ek });

/** Bellek içi depo + sahte saat + istek kaydı. */
function kur({ acik = true, mevcut = '1.3.0', yanitlar = [], kayitli = null } = {}) {
  const ortam = {
    saat: T0,
    istekler: [],
    gunlukler: [],
    yazilan: [],
    kayit: kayitli,
  };
  const kuyruk = [...yanitlar];
  const dis = { acik };
  const denetleyici = surumDenetleyicisiOlustur({
    fetch: async (url, secenek) => {
      ortam.istekler.push({ url, secenek });
      const sonraki = kuyruk.length > 1 ? kuyruk.shift() : kuyruk[0];
      if (sonraki instanceof Error) throw sonraki;
      return sonraki;
    },
    mevcutSurum: mevcut,
    acikMi: () => dis.acik,
    depo: { oku: () => ortam.kayit, yaz: (d) => { ortam.kayit = JSON.parse(JSON.stringify(d)); ortam.yazilan.push(ortam.kayit); } },
    simdi: () => ortam.saat,
    gunluk: (m) => ortam.gunlukler.push(m),
    zamanAsimi: () => undefined,
  });
  return { ortam, dis, denetleyici };
}

test('surumCoz / surumKarsilastir: yalnız X.Y.Z (v ön eki olur); ön sürüm ve bozuk metin reddedilir; sayısal karşılaştırma', () => {
  assert.deepEqual(surumCoz('1.4.0'), { ana: 1, alt: 4, yama: 0 });
  assert.deepEqual(surumCoz('v2.10.3'), { ana: 2, alt: 10, yama: 3 });
  for (const kotu of ['1.4', '1.4.0-beta', '1.4.0.1', 'sürüm', '', null, undefined, 5, '1.4.x', '1.-4.0', `1.${'9'.repeat(40)}.0`]) assert.equal(surumCoz(kotu), null, String(kotu));
  assert.equal(surumKarsilastir('1.10.0', '1.9.0'), 1, '10 > 9 (metin sırası değil)');
  assert.equal(surumKarsilastir('1.3.0', 'v1.3.0'), 0);
  assert.equal(surumKarsilastir('1.3.9', '1.4.0'), -1);
  assert.equal(surumKarsilastir('2.0.0', '1.99.99'), 1);
  assert.equal(surumKarsilastir('1.3.0', 'x'), null);
});

test('yanitiCoz: etiket çözülür; sürüm sayfası yalnız emre-pn/ha-tray-panel sürümlerinden gelirse alınır, aksi halde sabit sayfa', () => {
  assert.deepEqual(yanitiCoz(surumGovdesi('v1.4.0')), { surum: '1.4.0', sayfa: 'https://github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0' });
  for (const sahte of [
    'https://evil.example/releases/tag/v1.4.0',
    'https://github.com.evil.example/emre-pn/ha-tray-panel/releases/tag/v1.4.0',
    'https://github.com/baska/depo/releases/tag/v1.4.0',
    'http://github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0',
    'https://user:pw@github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0',
    'javascript:alert(1)',
    'https://github.com:444/emre-pn/ha-tray-panel/releases/tag/v1.4.0',
    `https://github.com/emre-pn/ha-tray-panel/releases/${'a'.repeat(300)}`,
    42,
    null,
  ]) {
    assert.equal(yanitiCoz(surumGovdesi('v1.4.0', { html_url: sahte })).sayfa, SURUM_SAYFASI, String(sahte));
    assert.equal(surumSayfasiGecerliMi(sahte), false);
  }
  assert.equal(yanitiCoz(surumGovdesi('v1.4.0', { html_url: undefined })).sayfa, SURUM_SAYFASI);
});

test('yanitiCoz: bozuk JSON, dizi, taslak/ön sürüm ya da çözülemeyen etiket -> null', () => {
  for (const kotu of ['', 'yok', '[]', 'null', '"1.4.0"', JSON.stringify({ tag_name: 'sürüm' }), JSON.stringify({ tag_name: 'v1.4.0-rc1' }), JSON.stringify({}), surumGovdesi('v1.4.0', { draft: true }), surumGovdesi('v1.4.0', { prerelease: true })]) {
    assert.equal(yanitiCoz(kotu), null, String(kotu).slice(0, 40));
  }
});

test('durumuDuzelt: yalnız bilinen alanlar, bozuk değerler sıfırlanır', () => {
  assert.deepEqual(durumuDuzelt(null), { sonDenetim: 0, sonSurum: null, bildirilen: null });
  assert.deepEqual(durumuDuzelt({ sonDenetim: 'dün', sonSurum: 'x', bildirilen: 7, baska: 1 }), { sonDenetim: 0, sonSurum: null, bildirilen: null });
  assert.deepEqual(durumuDuzelt({ sonDenetim: T0, sonSurum: 'v1.4.0', bildirilen: '1.4.0' }), { sonDenetim: T0, sonSurum: '1.4.0', bildirilen: '1.4.0' });
  assert.equal(durumuDuzelt({ sonDenetim: -5 }).sonDenetim, 0);
  assert.equal(durumuDuzelt([1, 2]).sonDenetim, 0);
});

test('KAPALI iken hiç istek gitmez (otomatik de elle de); depoya da yazılmaz', async () => {
  const { ortam, denetleyici } = kur({ acik: false, yanitlar: [yanit({ govde: surumGovdesi('v9.9.9') })] });
  assert.deepEqual(await denetleyici.denetle(), { sonuc: 'kapali' });
  assert.deepEqual(await denetleyici.denetle({ elle: true }), { sonuc: 'kapali' });
  assert.equal(ortam.istekler.length, 0);
  assert.equal(ortam.yazilan.length, 0);
  assert.equal(denetleyici.bilgi().acik, false);
});

test('açıkken tek istek: sabit GitHub adresi, GET, çerezsiz; anahtar/adres/sürüm bilgisi taşımaz', async () => {
  const { ortam, denetleyici } = kur({ yanitlar: [yanit({ govde: surumGovdesi('v1.3.0') })] });
  const sonuc = await denetleyici.denetle();
  assert.equal(sonuc.sonuc, 'guncel');
  assert.equal(ortam.istekler.length, 1);
  const { url, secenek } = ortam.istekler[0];
  assert.equal(url, 'https://api.github.com/repos/emre-pn/ha-tray-panel/releases/latest');
  assert.equal(secenek.method, 'GET');
  assert.equal(secenek.credentials, 'omit');
  assert.equal(secenek.body, undefined);
  assert.deepEqual(Object.keys(secenek.headers).sort(), ['Accept', 'User-Agent']);
  assert.doesNotMatch(JSON.stringify(secenek), /1\.3\.0|Bearer|Authorization|Cookie|token/i, 'istekte sürüm, kimlik ya da çerez yok');
});

test('yeni sürüm: karşılaştırma, bildirim yalnız bir kez gerekir; "Yenilikler/yeniSurum" bilgisi kalıcıdır', async () => {
  const { ortam, denetleyici } = kur({ yanitlar: [yanit({ govde: surumGovdesi('v1.4.0') })] });
  const ilk = await denetleyici.denetle();
  assert.deepEqual(ilk, { sonuc: 'yeni', surum: '1.4.0', sayfa: 'https://github.com/emre-pn/ha-tray-panel/releases/tag/v1.4.0', bildirimGerek: true });
  assert.equal(denetleyici.bilgi().yeniSurum, '1.4.0');
  denetleyici.bildirildi('1.4.0');
  ortam.saat += GUN + 1;
  const ikinci = await denetleyici.denetle();
  assert.equal(ikinci.sonuc, 'yeni');
  assert.equal(ikinci.bildirimGerek, false, 'aynı sürüm için ikinci bildirim yok');
  // uygulama yeniden başlar: kalıcı kayıttan okunur; kayıtta daha eski bir sürüm bildirilmişse yenisi yine bildirilir
  const yeniden = kur({ kayitli: { sonDenetim: 1, sonSurum: '1.3.5', bildirilen: '1.3.5' }, yanitlar: [yanit({ govde: surumGovdesi('v1.4.0') })] });
  assert.equal((await yeniden.denetleyici.denetle()).bildirimGerek, true);
  const ayni = kur({ kayitli: ortam.kayit, yanitlar: [yanit({ govde: surumGovdesi('v1.4.0') })] });
  ayni.ortam.saat = ortam.saat + 2 * GUN;
  assert.equal((await ayni.denetleyici.denetle()).bildirimGerek, false, 'yeniden başlasa da aynı sürüm tekrar bildirilmez');
});

test('güncel ya da daha eski sürüm: yeni sayılmaz; önceki "yeni" bilgisi silinir (kullanıcı güncellemiş)', async () => {
  const { ortam, denetleyici } = kur({ mevcut: '1.3.0', kayitli: { sonDenetim: 1, sonSurum: '1.3.0', bildirilen: null }, yanitlar: [yanit({ govde: surumGovdesi('v1.2.0') })] });
  const sonuc = await denetleyici.denetle();
  assert.equal(sonuc.sonuc, 'guncel');
  assert.equal(denetleyici.bilgi().yeniSurum, null);
  assert.equal(ortam.kayit.sonSurum, null);
  const k2 = kur({ mevcut: '1.5.0', kayitli: { sonDenetim: 0, sonSurum: '1.4.0', bildirilen: null } });
  assert.equal(k2.denetleyici.bilgi().yeniSurum, null, 'çalışan sürüm kayıtlı yeni sürümü geçtiyse gösterilmez');
});

test('günde en çok bir otomatik denetim: 24 saat dolmadan "erken"; başarısız deneme de sayılır', async () => {
  const { ortam, denetleyici } = kur({ yanitlar: [new Error('ag yok'), yanit({ govde: surumGovdesi('v1.4.0') })] });
  const ilk = await denetleyici.denetle();
  assert.deepEqual(ilk, { sonuc: 'hata', neden: 'ag' });
  ortam.saat += GUN - 1000;
  assert.deepEqual(await denetleyici.denetle(), { sonuc: 'erken' });
  assert.equal(ortam.istekler.length, 1);
  ortam.saat += 1000;
  assert.equal((await denetleyici.denetle()).sonuc, 'yeni');
  assert.equal(ortam.istekler.length, 2);
});

test('saat geri alınmışsa (son deneme gelecekte) otomatik denetim takılıp kalmaz', async () => {
  const { ortam, denetleyici } = kur({ kayitli: { sonDenetim: T0 + 400 * GUN, sonSurum: null, bildirilen: null }, yanitlar: [yanit({ govde: surumGovdesi('v1.3.0') })] });
  assert.equal((await denetleyici.denetle()).sonuc, 'guncel');
  assert.equal(ortam.istekler.length, 1);
  assert.equal(ortam.kayit.sonDenetim, T0);
});

test('elle denetim günlük sınırı beklemez ama dakikada en çok bir kez; sürerken ikinci çağrı aynı isteği paylaşır', async () => {
  let birak;
  const bekle = new Promise((coz) => { birak = coz; });
  const ortam = { istekler: 0 };
  const d = surumDenetleyicisiOlustur({
    fetch: async () => {
      ortam.istekler += 1;
      await bekle;
      return yanit({ govde: surumGovdesi('v1.3.0') });
    },
    mevcutSurum: '1.3.0',
    acikMi: () => true,
    depo: { oku: () => null, yaz: () => {} },
    simdi: () => T0,
    zamanAsimi: () => undefined,
  });
  const a = d.denetle({ elle: true });
  const b = d.denetle({ elle: true });
  assert.equal(a, b, 'sürerken aynı söz');
  birak();
  assert.equal((await a).sonuc, 'guncel');
  assert.equal(ortam.istekler, 1);
  assert.deepEqual(await d.denetle({ elle: true }), { sonuc: 'cok-sik' });
  assert.equal(ortam.istekler, 1);

  const k = kur({ yanitlar: [yanit({ govde: surumGovdesi('v1.3.0') })] });
  await k.denetleyici.denetle();
  k.ortam.saat += 5000; // otomatik denetimden 5 sn sonra elle: günlük sınır elle denetimi engellemez
  assert.equal((await k.denetleyici.denetle({ elle: true })).sonuc, 'guncel');
  k.ortam.saat += ELLE_ARALIK_MS - 1;
  assert.equal((await k.denetleyici.denetle({ elle: true })).sonuc, 'cok-sik');
  k.ortam.saat += 2;
  assert.equal((await k.denetleyici.denetle({ elle: true })).sonuc, 'guncel');
});

test('hata yolları: ağ, zaman aşımı, HTTP hatası, bozuk gövde, büyük gövde, yönlendirme -> "hata" (sır/adres günlüğe girmez, çökmez)', async () => {
  const zaman = Object.assign(new Error('zaman'), { name: 'TimeoutError' });
  const durumlar = [
    [new Error('getaddrinfo ENOTFOUND api.github.com'), 'ag'],
    [zaman, 'zaman'],
    [yanit({ ok: false }), 'http'],
    [yanit({ govde: '{bozuk' }), 'yanit'],
    [yanit({ govde: 'x'.repeat(600 * 1024) }), 'buyuk'],
    [yanit({ govde: surumGovdesi('v1.4.0'), uzunluk: 10_000_000 }), 'buyuk'],
    [yanit({ govde: surumGovdesi('v1.4.0'), url: 'https://evil.example/releases/latest' }), 'yonlendirme'],
    [{ ok: true, url: '', headers: { get: () => null }, text: async () => { throw new Error('okunamadi'); } }, 'ag'],
  ];
  for (const [yanitVeyaHata, neden] of durumlar) {
    const { ortam, denetleyici } = kur({ yanitlar: [yanitVeyaHata] });
    const sonuc = await denetleyici.denetle();
    assert.deepEqual(sonuc, { sonuc: 'hata', neden });
    assert.equal(denetleyici.bilgi().yeniSurum, null);
    for (const satir of ortam.gunlukler) assert.doesNotMatch(satir, /github|evil|ENOTFOUND|https?:/i, `günlükte adres/ayrıntı yok: ${satir}`);
  }
});

test('dosyaDeposu: yazar, okur; bozuk/büyük/yok dosya null; yazılamayan konum çökertmez', () => {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'surum-denetimi-'));
  try {
    const yol = path.join(klasor, 'alt', 'surum-denetimi.json');
    const depo = dosyaDeposu({ yol });
    assert.equal(depo.oku(), null);
    depo.yaz({ sonDenetim: T0, sonSurum: '1.4.0', bildirilen: null });
    assert.deepEqual(depo.oku(), { sonDenetim: T0, sonSurum: '1.4.0', bildirilen: null });
    assert.deepEqual(fs.readdirSync(path.dirname(yol)), ['surum-denetimi.json'], 'geçici dosya kalmaz');
    fs.writeFileSync(yol, '{bozuk');
    assert.equal(depo.oku(), null);
    fs.writeFileSync(yol, ' '.repeat(5000));
    assert.equal(depo.oku(), null);
    const dosyaUstu = path.join(klasor, 'dosya');
    fs.writeFileSync(dosyaUstu, 'x');
    assert.doesNotThrow(() => dosyaDeposu({ yol: path.join(dosyaUstu, 'a', 'b.json') }).yaz({ sonDenetim: 1 }));
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
  }
});

test('modül dış ağa yalnız verilen fetch ile çıkar; sabit adresler yalnız emre-pn/ha-tray-panel', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'surum-denetimi.js'), 'utf8');
  assert.doesNotMatch(kaynak, /require\(\s*['"](?:node:)?(?:https?|net|tls|dns|dgram)['"]\s*\)/);
  assert.doesNotMatch(kaynak, /(?<![\w.])fetch\s*\(\s*['"`]/, 'adres doğrudan fetch içine yazılmaz');
  for (const adres of [...kaynak.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]).filter((a) => a !== 'https://api.github.com/')) assert.match(adres, /^https:\/\/(api\.)?github\.com\/(repos\/)?emre-pn\/ha-tray-panel\//, adres);
});
