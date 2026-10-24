'use strict';

/**
 * Yetki kesici + tek doğrulama geçidi (1.1.1): HA istemcisi (src/ha-istemcisi.js) ve canlı bağlantı (src/ha-ws.js) ile birlikte.
 * Sahte fetch ve sahte soket kullanılır; gerçek ağ, gerçek anahtar yoktur. Olay: geçersiz anahtarla her açılışta onlarca kimlikli
 * istek atılıp HA'nın ip_ban'ı tetikleniyordu; burada geçersiz anahtar başına HA'ya EN ÇOK 1 hatalı deneme gittiği sınanır.
 */

const { test, mock } = require('node:test');
const { AsyncLocalStorage } = require('node:async_hooks');
const assert = require('node:assert/strict');
const { HaHatasi, hataMetni, haIstemcisiOlustur } = require('../src/ha-istemcisi');
const { haWsOlustur } = require('../src/ha-ws');
const { DURAKLATMA_MS, EN_COK_BELIRSIZ_IYI, yetkiKesiciOlustur } = require('../src/lib/yetki-kesici');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { kesintiMi } = require('../src/lib/baglanti-bildirimi');
const { sinirliEszamanli } = require('../src/lib/sinirli-eszamanli');

const ANAHTAR = 'SAHTE_ERISIM_ANAHTARI_ABCDEFGHIJ_0123456789';
const YENI_ANAHTAR = 'BASKA_SAHTE_ANAHTAR_KLMNOPQRST_9876543210';
const HA_MANIFEST = JSON.stringify({ name: 'Home Assistant', short_name: 'Assistant', id: '/?homescreen=1' });
const YEREL = 'http://192.168.1.10:8123';
const DIS = 'https://ha.example.com';
const AYAR = { yerelAdres: YEREL, disAdres: DIS, yerelZamanAsimiMs: 3000, disZamanAsimiMs: 10000 };
const DOSYA = 'C:\\sahte\\yetki-kesici.json';
const json = (govde, status = 200) => new Response(JSON.stringify(govde), { status });
const API_CALISIYOR = () => json({ message: 'API running.' });
const akit = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((coz) => setImmediate(coz));
};

function sahteFs() {
  const dosyalar = new Map();
  return {
    dosyalar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => dosyalar.get(y),
    writeFileSync: (y, v) => dosyalar.set(y, String(v)),
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
    mkdirSync() {},
  };
}

/**
 * `ha(url, secenek)`: kimlikli isteklere HA yanıtı (Response ya da fırlatır). Yoklama (/manifest.json) `yoklama(url)` ile yönetilir.
 * Gecikmeli yanıt için ha() bir söz döndürebilir.
 */
function kur({ ha = API_CALISIYOR, yoklama = () => new Response(HA_MANIFEST, { status: 200 }), anahtar = ANAHTAR, fs = sahteFs(), simdi = () => 0, ayar = AYAR, aktif = null } = {}) {
  const durum = { anahtar, ha, yoklama, aktif };
  const cagrilar = [];
  const gunlukler = [];
  const kesici = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs, gunluk: (m) => gunlukler.push(m), simdi });
  kesici.yukle();
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      const kimlikli = !!secenek.headers?.Authorization;
      cagrilar.push({ url, yontem: secenek.method, kimlikli, yetki: secenek.headers?.Authorization });
      if (url.endsWith('/manifest.json')) return durum.yoklama(url);
      return durum.ha(url, secenek);
    },
    ayarlarAl: () => ayar,
    anahtarAl: async () => durum.anahtar,
    aktifAdresAl: () => durum.aktif,
    gunluk: (m) => gunlukler.push(m),
    simdi,
    yetkiKesici: kesici,
  });
  const kimlikliler = () => cagrilar.filter((c) => c.kimlikli);
  return { durum, istemci, kesici, cagrilar, gunlukler, kimlikliler, fs };
}

const hataTuru = (soz) => soz.then(() => 'basarili', (h) => h.tur);
/** Gönderim ÖNCESİ ağ hatası (bağlantı reddedildi): HA isteği hiç görmedi, başka adrese geçmek güvenli. */
const baglantiReddi = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 192.168.1.10:8123'), { code: 'ECONNREFUSED' }) });
/** Gönderim SONRASI kopma: istek HA'ya ulaşmış olabilir. */
const baglantiSifirlandi = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });

test('(a) geçersiz anahtar + 8 eşzamanlı istek: kimlikli istek TAM 1 (doğrulama), dış adrese 0; hepsi aynı reddi alır', async () => {
  const o = kur({ ha: () => json({ message: '401: Unauthorized' }, 401) });
  const sonuclar = await Promise.all(Array.from({ length: 8 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`))));
  assert.deepEqual(sonuclar, Array(8).fill('yetki'));
  assert.equal(o.kimlikliler().length, 1, 'HA\'ya tek hatalı deneme');
  assert.equal(o.kimlikliler()[0].url, `${YEREL}/api/`);
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0, 'dış adrese hiçbir şey gitmedi');
  assert.deepEqual(o.kesici.reddedilenler(), [o.kesici.parmakIzi(ANAHTAR)]);

  // reddedildikten sonra: ağa hiçbir şey çıkmaz (yoklama bile)
  const once = o.cagrilar.length;
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'reddedildi');
  assert.equal(await hataTuru(o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: {} })), 'reddedildi');
  assert.equal(o.cagrilar.length, once, 'reddedilmiş anahtarla 0 istek (kimlikli ya da kimliksiz)');
});

test('(b) yeniden başlatma: kalıcı kayıt yüklenince AYNI anahtarla 0 kimlikli istek (ev içi ya da dış)', async () => {
  const fs = sahteFs();
  const ilk = kur({ ha: () => json({}, 401), fs });
  await hataTuru(ilk.istemci.haIstek('/api/states'));
  assert.equal(fs.dosyalar.has(DOSYA), true);

  const yeniden = kur({ ha: () => json({}, 401), fs }); // yeni süreç: aynı dosya
  assert.equal(await hataTuru(yeniden.istemci.haIstek('/api/states')), 'reddedildi');
  assert.equal(yeniden.cagrilar.length, 0, 'ne yoklama ne kimlikli istek');
  assert.equal(await hataTuru(yeniden.istemci.anahtariDogrula(ANAHTAR)), 'reddedildi');
  assert.equal(yeniden.cagrilar.length, 0);
});

test('(c) yeni (farklı parmak izli) anahtar: 1 doğrulama -> 200 -> normal akış, yeniden doğrulama yok', async () => {
  const fs = sahteFs();
  const o = kur({ ha: () => json({}, 401), fs });
  await hataTuru(o.istemci.haIstek('/api/states'));
  o.durum.anahtar = YENI_ANAHTAR;
  o.durum.ha = (url) => (url.endsWith('/api/') ? API_CALISIYOR() : json([{ entity_id: 'light.a', state: 'on', attributes: {} }]));
  const once = o.kimlikliler().length;
  await o.istemci.anahtariDogrula(YENI_ANAHTAR); // Ayarlar'da kayıt: TEK istek
  assert.equal(o.kimlikliler().length - once, 1);
  assert.equal(o.kimlikliler().at(-1).url, `${YEREL}/api/`);
  assert.equal(o.kimlikliler().at(-1).yetki, `Bearer ${YENI_ANAHTAR}`);
  const sonra = o.kimlikliler().length;
  const liste = await o.istemci.haIstek('/api/states');
  assert.equal(liste[0].entity_id, 'light.a');
  assert.equal(o.kimlikliler().length - sonra, 1, 'kayıttan sonra yeniden doğrulama yok: yalnız asıl istek');
});

test('(d) aynı (reddedilmiş) anahtarı yeniden kaydetmek kesiciyi sıfırlamaz ve HA\'ya istek göndermez', async () => {
  const o = kur({ ha: () => json({}, 401) });
  await hataTuru(o.istemci.haIstek('/api/states'));
  const once = o.cagrilar.length;
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(ANAHTAR)), 'reddedildi');
  assert.equal(o.cagrilar.length, once);
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), true);
});

test('(G6) aday anahtar kaydında 401: kaydın kendisi reddedilmiş işaretlenir; kayıtlı (eski) anahtarın durumu değişmez', async () => {
  const o = kur({ ha: (url, s) => (s.headers.Authorization === `Bearer ${YENI_ANAHTAR}` ? json({}, 401) : API_CALISIYOR()) });
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR)), 'yetki');
  assert.equal(o.kimlikliler().length, 1, 'tek istek');
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(YENI_ANAHTAR)), true);
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), false);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR)), 'reddedildi', 'aynı aday yeniden denenmez');
  assert.equal(o.kimlikliler().length, 1);
});

test('geçerli anahtar: açılışta tek doğrulama sonra istekler; eşzamanlı çağrılar AYNI sözü bekler (doğrulama istekten ÖNCE)', async () => {
  let birakDogrulama;
  const kapi = new Promise((coz) => {
    birakDogrulama = coz;
  });
  const o = kur({
    ha: async (url) => {
      if (url.endsWith('/api/')) {
        await kapi;
        return API_CALISIYOR();
      }
      return json({ entity_id: 'light.a', state: 'on', attributes: {} });
    },
  });
  const sozler = Array.from({ length: 8 }, (_, i) => o.istemci.haIstek(`/api/states/light.l${i}`));
  await akit();
  assert.equal(o.kimlikliler().length, 1, 'doğrulama sürerken diğer çağrılar kendi isteğini atmadı');
  birakDogrulama();
  await Promise.all(sozler);
  const kimlikliler = o.kimlikliler();
  assert.equal(kimlikliler.length, 9);
  assert.equal(kimlikliler[0].url, `${YEREL}/api/`);
  assert.equal(kimlikliler.filter((c) => c.url.endsWith('/api/')).length, 1);
  // sonraki çağrılar doğrulamayı tekrarlamaz
  await o.istemci.haIstek('/api/states/light.x');
  assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, 1);
});

test('doğrulama yanıtı HA\'nınki değilse (200 ama başka içerik) doğrulanmış sayılmaz ve istek gönderilmez', async () => {
  const o = kur({ ha: () => json({ message: 'başka bir şey' }) });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'sunucu');
  assert.equal(o.kimlikliler().length, 1);
});

test('(g) kimlikli istekte 403: anahtar GEÇERSİZ SAYILMAZ, o adrese 15 dk istek yok, paralel deneme yok, adres DEĞİŞMEZ', async () => {
  let t = 1000;
  const o = kur({ ha: () => json({ message: 'Forbidden' }, 403), simdi: () => t });
  const sonuclar = await Promise.all(Array.from({ length: 8 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`))));
  assert.deepEqual(sonuclar, Array(8).fill('yasak-erisim'));
  assert.equal(o.kimlikliler().length, 1, 'yalnız tek doğrulama isteği 403 aldı');
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), false);
  assert.equal(await o.istemci.apiTabaniBul(), YEREL, '403 adres değiştirme nedeni değil');
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);

  // duraklatma boyunca kimlikli hiçbir istek çıkmaz (adres yoklaması anahtarsızdır, serbesttir)
  const once = o.kimlikliler().length;
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'duraklatildi');
  t += DURAKLATMA_MS - 1000;
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'duraklatildi');
  assert.equal(o.kimlikliler().length, once);
  assert.ok(hataMetni(new HaHatasi('duraklatildi')).includes('403'));
  assert.equal(o.gunlukler.filter((m) => /duraklatıldı/.test(m)).length, 1, 'tek günlük satırı');

  // süre dolunca yeniden TEK doğrulama gider; bu kez geçerse akış sürer
  t += 1000;
  o.durum.ha = (url) => (url.endsWith('/api/') ? API_CALISIYOR() : json([]));
  assert.deepEqual(await o.istemci.haIstek('/api/states'), []);
  assert.equal(o.kimlikliler().length, 3, 'doğrulama + asıl istek yeniden gönderildi');
  assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, 2);
});

test('403 doğrulamadan SONRA gelirse (asıl istekte): o adres duraklar, sonraki doğrulama yenilenir', async () => {
  let t = 0;
  const o = kur({
    simdi: () => t,
    ha: (url) => (url.endsWith('/api/') ? API_CALISIYOR() : json({}, 403)),
  });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'yasak-erisim');
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'duraklatildi');
  assert.equal(o.kimlikliler().length, 2);
  t += DURAKLATMA_MS;
  o.durum.ha = () => API_CALISIYOR();
  await o.istemci.haIstek('/api/');
  assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, 3, 'duraklatma sonrası tek doğrulama yeniden gider');
});

test('(h) ev içi adres AĞ hatası: dış adrese geçiş yalnız geçerli anahtarla ve yine önce TEK doğrulamayla', async () => {
  const o = kur({
    ha: (url) => {
      if (url.startsWith(YEREL)) throw baglantiReddi();
      return url.endsWith('/api/') ? API_CALISIYOR() : json({ entity_id: 'light.a', state: 'on', attributes: {} });
    },
  });
  // yoklama: ev içi önce ulaşılabilir görünür (yalnız kimlikli istek ağ hatası alır), yeniden seçimde ev içi düşer
  let yoklamaSayisi = 0;
  o.durum.yoklama = (url) => {
    yoklamaSayisi += 1;
    return url.startsWith(YEREL) && yoklamaSayisi > 1 ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 });
  };
  const yanit = await o.istemci.haIstek('/api/states/light.a');
  assert.equal(yanit.entity_id, 'light.a');
  const dis = o.kimlikliler().filter((c) => c.url.startsWith(DIS));
  assert.deepEqual(dis.map((c) => c.url), [`${DIS}/api/`, `${DIS}/api/states/light.a`], 'dış adreste önce doğrulama, sonra istek');
});

test('(h) reddedilmiş anahtarla ev içi adres düşse bile dış adrese HİÇBİR şey gitmez', async () => {
  const o = kur({ ha: () => json({}, 401) });
  await hataTuru(o.istemci.haIstek('/api/states'));
  o.durum.yoklama = (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 }));
  await o.istemci.secimiSifirla();
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'reddedildi');
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS) && c.kimlikli).length, 0);
  // kimliksiz adres seçimi yine çalışır (G4): ama anahtar hiçbir adrese gitmez
  assert.deepEqual(await o.istemci.adresSec(), { adres: DIS, tur: 'dis' });
  assert.equal(o.kimlikliler().length, 1);
});

test('(G4) 401 ve 403 adres değiştirme nedeni DEĞİLDİR: ağ hatası olmadan ikinci adrese gidilmez', async () => {
  for (const durumKodu of [401, 403]) {
    const o = kur({ ha: () => json({}, durumKodu) });
    await hataTuru(o.istemci.haIstek('/api/states'));
    assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0, `HTTP ${durumKodu}`);
    assert.equal(o.cagrilar.filter((c) => c.url.endsWith('/manifest.json')).length, 1, 'adres yeniden yoklanmadı');
  }
});

test('(i) anahtar günlüğe, hata nesnesine ve kayıt dosyasına yazılmaz; parmak izinin yalnız ilk 8 hanesi günlükte', async () => {
  const fs = sahteFs();
  const o = kur({ ha: () => json({}, 401), fs });
  let hata;
  try {
    await o.istemci.haIstek('/api/states');
  } catch (h) {
    hata = h;
  }
  const p = o.kesici.parmakIzi(ANAHTAR);
  const herSey = JSON.stringify([o.gunlukler, [...fs.dosyalar.values()], { ad: hata.name, tur: hata.tur, mesaj: hata.message, durumKodu: hata.durumKodu }]);
  assert.ok(!herSey.includes(ANAHTAR));
  assert.ok(!herSey.includes(`Bearer`));
  assert.ok(o.gunlukler.some((m) => m.includes(p.slice(0, 8)) && !m.includes(p)));
  assert.equal(o.gunlukler.filter((m) => /Yetki kesici/.test(m)).length, 1, 'tek satır');
});

test('kesici verilmezse eski davranış (yalnız birim testleri için): doğrulama isteği yok', async () => {
  const cagrilar = [];
  const istemci = haIstemcisiOlustur({
    fetch: async (url, secenek) => {
      cagrilar.push(url);
      return url.endsWith('/manifest.json') ? new Response(HA_MANIFEST, { status: 200 }) : json([]);
    },
    ayarlarAl: () => AYAR,
    anahtarAl: async () => ANAHTAR,
    aktifAdresAl: () => null,
  });
  await istemci.haIstek('/api/states');
  assert.deepEqual(cagrilar, [`${YEREL}/manifest.json`, `${YEREL}/api/states`]);
  assert.equal(istemci.wsYetkisi, null);
});

// --- canlı bağlantı (WebSocket) ------------------------------------------------------------

function sahteZaman() {
  let t = 0;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout: (id) => bekleyenler.delete(id),
    ilerle(ms) {
      const hedef = t + ms;
      for (;;) {
        const sira = [...bekleyenler.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, b) => a[1].bitis - b[1].bitis)[0];
        if (!sira) break;
        t = sira[1].bitis;
        bekleyenler.delete(sira[0]);
        sira[1].fn();
      }
      t = hedef;
    },
    bekleyen: () => bekleyenler.size,
  };
}

/** İstemci (gerçek geçit) + canlı bağlantı + sahte soket. */
function wsKur(secenek = {}) {
  const o = kur(secenek);
  const soketler = [];
  class SahteSoket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.gonderilen = [];
      this.dinleyiciler = {};
      soketler.push(this);
    }

    addEventListener(ad, fn) {
      (this.dinleyiciler[ad] ??= []).push(fn);
    }

    send(metin) {
      this.gonderilen.push(JSON.parse(metin));
    }

    close() {
      this.readyState = 3;
    }

    yayinla(ileti) {
      for (const fn of this.dinleyiciler.message ?? []) fn({ data: JSON.stringify(ileti) });
    }
  }
  const zaman = sahteZaman();
  const gunlukler = [];
  const durumlar = [];
  const ws = haWsOlustur({
    WebSocketSinifi: SahteSoket,
    adresAl: () => o.istemci.apiTabaniBul(),
    anahtarAl: async () => o.durum.anahtar,
    izlenen: () => ['light.a'],
    depo: durumDeposuOlustur({ zaman, gruplamaMs: 0 }),
    durumDegisti: (d) => durumlar.push(d.baglanti + (d.neden ? `:${d.neden}` : '')),
    gunluk: (m) => gunlukler.push(m),
    zaman,
    yetki: o.istemci.wsYetkisi,
  });
  return { ...o, ws, soketler, zaman, wsGunlukleri: gunlukler, durumlar };
}

test('(a) WS: geçersiz anahtarla soket HİÇ açılmaz (doğrulama 401), yeniden denenmez; kimlikli istek TAM 1', async () => {
  const o = wsKur({ ha: () => json({}, 401) });
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.equal(o.kimlikliler().length, 1);
  assert.deepEqual(o.durumlar.at(-1), 'yedek:yetki');
  o.zaman.ilerle(10 * 60_000);
  await akit();
  assert.equal(o.soketler.length, 0, 'yeniden bağlanma yok');
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
});

test('(a) REST + WS aynı anda başlarsa (açılış) kimlikli istek yine TAM 1', async () => {
  const o = wsKur({ ha: () => json({}, 401) });
  const rest = Promise.all([1, 2, 3, 4].map(() => hataTuru(o.istemci.haIstek('/api/states/light.a'))));
  o.ws.baslat();
  await Promise.all([rest, akit()]);
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.soketler.length, 0);
});

test('(b) WS: kalıcı kayıtla yeniden başlatma: reddedilmiş anahtarla soket ve istek 0', async () => {
  const fs = sahteFs();
  const ilk = wsKur({ ha: () => json({}, 401), fs });
  ilk.ws.baslat();
  await akit();
  const yeniden = wsKur({ ha: () => json({}, 401), fs });
  yeniden.ws.baslat();
  await akit();
  assert.equal(yeniden.soketler.length, 0);
  assert.equal(yeniden.cagrilar.length, 0, 'yoklama da dahil hiçbir şey');
});

test('(e) WS auth_invalid: anahtar reddedilir (kalıcı), yeniden bağlanma yok, sonraki baslat() soket açmaz', async () => {
  const o = wsKur();
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 1);
  assert.equal(o.kimlikliler().length, 1, 'soketten önce tek doğrulama');
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit(); // auth adımı küresel kapıdan geçer (asenkron)
  assert.deepEqual(s.gonderilen[0], { type: 'auth', access_token: ANAHTAR });
  s.yayinla({ type: 'auth_invalid', message: 'Invalid access token or password' });
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), true);
  assert.equal(o.durumlar.at(-1), 'yedek:yetki');
  o.zaman.ilerle(10 * 60_000);
  await akit();
  assert.equal(o.soketler.length, 1, 'yeniden bağlanma yok');
  o.ws.baslat();
  o.ws.yenidenBaglan();
  await akit();
  assert.equal(o.soketler.length, 1, 'kesici açıkken baslat/yenidenBaglan da soket açmaz');
  assert.equal(o.gunlukler.filter((m) => /Yetki kesici: anahtar reddedildi/.test(m)).length, 1);
  assert.ok(!JSON.stringify([o.gunlukler, o.wsGunlukleri]).includes(ANAHTAR));
});

test('WS: auth_required geldiğinde anahtar bu arada REST ile reddedilmişse auth iletisi HİÇ gönderilmez', async () => {
  const o = wsKur();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  o.kesici.reddet(o.kesici.parmakIzi(ANAHTAR), 'HTTP_401'); // aynı anda REST 401 aldı
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.deepEqual(s.gonderilen, []);
  assert.equal(o.durumlar.at(-1), 'yedek:yetki');
});

test('WS: doğrulama ağ hatasıyla düşerse soket açılmaz, artan beklemeyle yeniden denenir (anahtar reddedilmez)', async () => {
  const o = wsKur({
    ha: () => {
      throw baglantiReddi();
    },
    yoklama: () => new Response(HA_MANIFEST, { status: 200 }),
  });
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.equal(o.kesici.reddedilenler().length, 0);
  o.zaman.ilerle(2000);
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.ok(o.kimlikliler().length >= 2, 'her yeniden denemede en çok 1 doğrulama');
});

test('WS: 403 duraklatması: soket açılmaz, kimlikli istek çıkmaz; süre dolunca doğrulama yeniden gider ve soket açılır', async () => {
  let simdi = 0;
  const o = wsKur({ ha: () => json({}, 403), simdi: () => simdi });
  o.ws.baslat();
  await akit();
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.soketler.length, 0);
  o.zaman.ilerle(60_000);
  await akit();
  assert.equal(o.kimlikliler().length, 1, 'duraklatma sürerken yeniden deneme ağa çıkmaz');
  simdi += DURAKLATMA_MS;
  o.durum.ha = API_CALISIYOR;
  o.zaman.ilerle(60_000);
  await akit();
  assert.equal(o.soketler.length, 1);
  assert.equal(o.kimlikliler().length, 2);
});

// ===========================================================================
// Tur 1 inceleme düzeltmeleri: tazelik, adresler arası tek geçit, yanıt durumu önce, belirsiz (zaman aşımı) soğuma
// ===========================================================================

const GECERLI_HA = (url) => (url.endsWith('/api/') ? API_CALISIYOR() : json({ entity_id: 'light.a', state: 'on', attributes: {} }));
const hataliDenemeler = (o, once) => o.kimlikliler().length - once; // revoke sonrası HA'ya giden kimlikli (hatalı) istek sayısı

test('(B1) doğrulanmış oturum + anahtar HA\'da iptal + uyanış (secimiSifirla): 4 eşzamanlı istek -> HA\'ya TAM 1 hatalı deneme', async () => {
  const o = kur({ ha: GECERLI_HA });
  await o.istemci.haIstek('/api/states/light.a'); // oturum doğrulandı (önbellek dolu)
  o.durum.ha = () => json({ message: '401: Unauthorized' }, 401);
  const once = o.kimlikliler().length;
  o.istemci.secimiSifirla(); // uyanış / ağ değişimi
  const sonuclar = await Promise.all(Array.from({ length: 4 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`))));
  assert.deepEqual(sonuclar, Array(4).fill('yetki'));
  assert.equal(hataliDenemeler(o, once), 1, 'önbellek uyanışta unutulur: tek doğrulama, kalanlar onu bekler');
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), true);
});

test('(B1) tazelik: son başarılı kimlikli yanıt 30 sn\'den eskiyse (olay olmadan bile) yine TEK doğrulama gider', async () => {
  let t = 0;
  const o = kur({ ha: GECERLI_HA, simdi: () => t });
  await o.istemci.haIstek('/api/states/light.a');
  t += 29_000;
  const sayi = o.kimlikliler().length;
  await o.istemci.haIstek('/api/states/light.a');
  assert.equal(hataliDenemeler(o, sayi), 1, '29 sn: hâlâ taze, yalnız asıl istek');
  t += 60_000;
  o.durum.ha = () => json({}, 401);
  const once = o.kimlikliler().length;
  const sonuclar = await Promise.all(Array.from({ length: 4 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`))));
  assert.deepEqual(sonuclar, Array(4).fill('yetki'));
  assert.equal(hataliDenemeler(o, once), 1, 'bayat önbellek: geçit yeniden');
});

test('(B1) canlı bağlantı kopunca önbellek unutulur: anahtar iptal edilmişse REST yedeği (4 eşzamanlı) + WS yeniden bağlanma toplam TAM 1 hatalı deneme', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  assert.ok(s, 'soket açıldı (doğrulama 200)');
  s.yayinla({ type: 'auth_required' });
  await akit();
  s.yayinla({ type: 'auth_ok' });
  o.durum.ha = () => json({}, 401); // anahtar HA'da iptal edildi, HA soketi kapattı
  const once = o.kimlikliler().length;
  for (const fn of s.dinleyiciler.close ?? []) fn({});
  const rest = Promise.all(Array.from({ length: 4 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`)))); // main.js: canlı yok -> REST yedeği
  await akit();
  o.zaman.ilerle(60_000); // WS yeniden deneme zamanlayıcıları
  await akit();
  await rest;
  assert.equal(hataliDenemeler(o, once), 1);
  assert.equal(o.soketler.length, 1, 'ikinci soket açılmadı');
  assert.equal(o.soketler.flatMap((x) => x.gonderilen.filter((m) => m.type === 'auth')).length, 1, 'yalnız ilk (geçerliyken) auth gitti');
});

test('(B2) doğrulama sürerken adres değişirse aynı anahtar ikinci adrese paralel GİTMEZ; ilki 401 alırsa ikinci adres de reddedilir', async () => {
  let birak;
  const kapi = new Promise((coz) => {
    birak = coz;
  });
  const o = kur({
    ha: async (url) => {
      if (url.startsWith(YEREL) && url.endsWith('/api/')) {
        await kapi;
        return json({}, 401);
      }
      return GECERLI_HA(url);
    },
  });
  const birinci = hataTuru(o.istemci.haIstek('/api/states/light.a'));
  await akit();
  assert.equal(o.kimlikliler().length, 1);
  o.durum.yoklama = (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 }));
  o.istemci.secimiSifirla(); // Wi-Fi değişti: artık dış adres seçilecek
  const ikinci = hataTuru(o.istemci.haIstek('/api/states/light.b'));
  await akit();
  assert.equal(o.kimlikliler().length, 1, 'ilk doğrulama sürerken dış adrese kimlikli istek çıkmadı');
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS) && c.kimlikli).length, 0);
  birak();
  assert.equal(await birinci, 'yetki');
  assert.equal(await ikinci, 'reddedildi');
  assert.equal(o.kimlikliler().length, 1, 'HA\'ya giden kimlikli istek TAM 1');
});

test('(B2) ilk adresteki doğrulama BAŞARILI biterse ikinci adres sırayla (paralel değil) kendi doğrulamasını yapar', async () => {
  let birak;
  const kapi = new Promise((coz) => {
    birak = coz;
  });
  let ayni = 0;
  let enCok = 0;
  const o = kur({
    ha: async (url) => {
      ayni += 1;
      enCok = Math.max(enCok, ayni);
      if (url.startsWith(YEREL) && url.endsWith('/api/')) await kapi;
      ayni -= 1;
      return GECERLI_HA(url);
    },
  });
  const birinci = o.istemci.haIstek('/api/states/light.a');
  await akit();
  o.durum.yoklama = (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 }));
  o.istemci.secimiSifirla();
  const ikinci = o.istemci.haIstek('/api/states/light.b');
  await akit();
  birak();
  await Promise.all([birinci, ikinci]);
  assert.equal(enCok, 1, 'aynı anda tek kimlikli istek');
  assert.deepEqual(o.kimlikliler().filter((c) => c.url.startsWith(DIS)).map((c) => c.url), [`${DIS}/api/`, `${DIS}/api/states/light.b`]);
});

test('(B3) 401 yanıtının gövdesi okunamasa bile (bağlantı sıfırlandı) durum ÖNCE değerlendirilir: anahtar reddedilir, yeniden deneme yok', async () => {
  const o = kur({
    ha: () => ({ status: 401, text: () => Promise.reject(new TypeError('terminated')), body: { cancel: async () => {} } }),
  });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'yetki');
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), true);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'reddedildi');
  assert.equal(o.kimlikliler().length, 1);
});

test('(B3) 403 yanıtının gövdesi okunamasa bile adres duraklatılır (ağ hatası sanılıp yeniden denenmez)', async () => {
  const o = kur({
    ha: () => ({ status: 403, text: () => Promise.reject(new TypeError('terminated')), body: { cancel: async () => {} } }),
  });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'yasak-erisim');
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'duraklatildi');
  assert.equal(o.kimlikliler().length, 1);
});

test('(B3) kimlikli istekte zaman aşımı BELİRSİZDİR: başka adrese geçilmez, yeniden denenmez; soğuma bitince kimliksiz yoklama + TEK doğrulama', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    const o = kur({ ha: () => new Promise(() => {}), simdi: () => t }); // HA yanıt vermiyor (yavaş tünel)
    o.kesici.dogrulandi(o.kesici.parmakIzi(ANAHTAR)); // doğrulanmış anahtar: ilk belirsizlikte 30 sn soğuma (doğrulanmamışta bkz. tur3-K6-4)
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000); // doğrulama süresi (ev içi 15 sn) dolsun
    assert.equal(await p, 'belirsiz');
    assert.equal(o.kimlikliler().length, 1, 'ikinci deneme / ikinci adres yok');
    assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
    assert.equal(o.kesici.reddedilenler().length, 0, 'zaman aşımı anahtarı reddedilmiş saymaz');
    assert.ok(hataMetni(new HaHatasi('belirsiz')).length > 0);

    const sayi = o.cagrilar.length;
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz', 'soğuma sürerken ağa hiçbir şey çıkmaz');
    t += 29_000;
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz');
    assert.equal(o.cagrilar.length, sayi, 'yoklama dahil 0 istek');

    t += 2_000; // soğuma (30 sn) bitti
    o.durum.ha = GECERLI_HA;
    o.durum.yoklama = () => new Response(HA_MANIFEST, { status: 200 });
    const yanit = await o.istemci.haIstek('/api/states/light.a');
    assert.equal(yanit.entity_id, 'light.a');
    const yeni = o.cagrilar.slice(sayi);
    assert.equal(yeni.filter((c) => c.url.endsWith('/manifest.json')).length, 1, 'kimliksiz adres yoklaması yeniden');
    assert.equal(yeni.filter((c) => c.kimlikli && c.url.endsWith('/api/')).length, 1, 'TEK doğrulama');
  } finally {
    mock.timers.reset();
  }
});

test('(B3) WS: doğrulama zaman aşımına uğrarsa (belirsiz) soket açılmaz, soğuma boyunca ağa kimlikli istek çıkmaz', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const t = 0;
    const o = wsKur({ ha: () => new Promise(() => {}), simdi: () => t });
    o.ws.baslat();
    await akit();
    mock.timers.tick(30_000); // doğrulama süresi (ev içi 15 sn) dolsun
    await akit();
    assert.equal(o.kimlikliler().length, 1);
    assert.equal(o.soketler.length, 0);
    o.zaman.ilerle(20_000); // WS yeniden deneme zamanlayıcısı (sahte zaman): soğuma sürüyor
    await akit();
    assert.equal(o.kimlikliler().length, 1, 'soğuma boyunca yeni kimlikli istek yok');
    assert.equal(o.kesici.reddedilenler().length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('(B3) belirsizlikten sonra 30 sn soğuma; başarılı kimlikli yanıt belirsiz sayacı sıfırlar (ardışık olmayan iki belirsizlik anahtarı durdurmaz)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    const o = kur({ ha: () => new Promise(() => {}), simdi: () => t });
    const p = o.kesici.parmakIzi(ANAHTAR);
    o.kesici.dogrulandi(p); // doğrulanmış anahtar: kalıcı belirsiz sınırı 2 (doğrulanmamışta 1; bkz. tur3-K2)
    const zamanAsimi = async () => {
      const s = hataTuru(o.istemci.haIstek('/api/states/light.a'));
      await akit();
      mock.timers.tick(30_000); // doğrulama süresi (ev içi 15 sn) dolsun
      return s;
    };
    assert.equal(await zamanAsimi(), 'belirsiz'); // soğuma 30 sn
    const sayi = o.cagrilar.length;
    t += 29_000;
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz', '29 sn: hâlâ soğuma');
    assert.equal(o.cagrilar.length, sayi);
    t += 2_000;
    o.durum.ha = GECERLI_HA;
    assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a', '31 sn: soğuma bitti');
    assert.equal(o.kesici.belirsizSayisi(p), 0, 'başarılı doğrulama kalıcı sayacı sıfırladı');

    // başarıdan sonra yeni zaman aşımı yine yalnız soğutur (sınır 2'ye ulaşılmadı)
    o.durum.ha = () => new Promise(() => {});
    t += 31_000; // doğrulama bayatladı
    assert.equal(await zamanAsimi(), 'belirsiz');
    assert.equal(o.kesici.dogrulanamadiMi(p), false);
    t += 31_000;
    o.durum.ha = GECERLI_HA;
    assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  } finally {
    mock.timers.reset();
  }
});

// --- Tur 2 inceleme bulguları ---------------------------------------------------------------------------------------------

/** HA yanıtı: başlıklar geldi ama gövde iptali / okuması hiç bitmiyor (yük altındaki HA, yavaş tünel). */
const yanitGovdeTakili = (durum) => () => ({ status: durum, text: () => new Promise(() => {}), body: { cancel: () => new Promise(() => {}) } });

test('(tur2-P1) 401 başlığı geldi ama gövde iptali süreyi aşıyor: 401 KAYBOLMAZ (anahtar reddedilir, "bağlantı" sayılıp yeniden denenmez)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const o = kur({ ha: yanitGovdeTakili(401) });
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000); // 8 sn de, doğrulama süresi de dolsun
    assert.equal(await p, 'yetki');
    assert.equal(o.kimlikliler().length, 1, "HA'ya tek (hatalı) deneme: ikinci doğrulama/yeniden deneme yok");
    assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
    assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), true);
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'reddedildi');
    assert.equal(o.kimlikliler().length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('(tur2-P1) 403 başlığı geldi ama gövde iptali süreyi aşıyor: adres duraklatılır, ağ hatası sanılıp yeniden denenmez', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const o = kur({ ha: yanitGovdeTakili(403) });
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000);
    assert.equal(await p, 'yasak-erisim');
    assert.equal(o.kimlikliler().length, 1);
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'duraklatildi');
    assert.equal(o.kimlikliler().length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('(tur2-P1) kimlikli istekte yanıt başlığı geldiyse (200) gövde okunurken süre dolsa da bu ağ hatası DEĞİLDİR: başka adrese/yeniden deneme yok', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const o = kur({ ha: yanitGovdeTakili(200) });
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000);
    assert.equal(await p, 'sunucu');
    assert.equal(o.kimlikliler().length, 1);
    assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('(tur2-P2) istek gönderildikten sonra kopan bağlantı (ECONNRESET) BELİRSİZDİR: anında yeniden deneme/adres değiştirme yok, soğuma sürer', async () => {
  const t = 0;
  const o = kur({
    simdi: () => t,
    ha: () => {
      throw baglantiSifirlandi();
    },
  });
  o.kesici.dogrulandi(o.kesici.parmakIzi(ANAHTAR)); // doğrulanmış anahtar: ilk belirsizlikte soğuma (doğrulanmamışta kalıcı durma: tur3-K6-4)
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz');
  assert.equal(o.kimlikliler().length, 1, "HA'ya tek istek (ikinci doğrulama yok)");
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz', 'soğuma sürüyor');
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.kesici.belirsizSayisi(o.kesici.parmakIzi(ANAHTAR)), 1, 'kalıcı belirsiz sayacına girdi');
  assert.equal(o.kesici.reddedildiMi(o.kesici.parmakIzi(ANAHTAR)), false);
});

test('(tur2-P2) sınıflandırılamayan ağ hatası (yalın "fetch failed") kimlikli istekte belirsiz sayılır; gönderim ÖNCESİ hatalar (reddedilen bağlantı, DNS, ağ yok) eskisi gibi adres değiştirir', async () => {
  const yalin = kur({
    ha: () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.equal(await hataTuru(yalin.istemci.haIstek('/api/states')), 'belirsiz');
  assert.equal(yalin.kimlikliler().length, 1);

  const adresDegistirir = async (hata, etiket) => {
    const o = kur({
      ha: (url) => {
        if (url.startsWith(YEREL)) throw hata();
        return GECERLI_HA(url);
      },
    });
    let yoklama = 0;
    o.durum.yoklama = (url) => {
      yoklama += 1;
      return url.startsWith(YEREL) && yoklama > 1 ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 });
    };
    assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a', etiket);
  };
  for (const kod of ['ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED']) {
    await adresDegistirir(() => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(kod), { code: kod }) }), kod);
  }
  // Electron net.fetch: hata iletisi "net::ERR_..." biçiminde
  await adresDegistirir(() => new TypeError('net::ERR_CONNECTION_REFUSED'), 'net::ERR_CONNECTION_REFUSED');
  await adresDegistirir(() => new TypeError('net::ERR_NAME_NOT_RESOLVED'), 'net::ERR_NAME_NOT_RESOLVED');
  // B39: bağlantı kurulmadan oluşan öbür Chromium DNS/adres hataları da gönderim öncesidir
  for (const kod of ['ERR_NAME_RESOLUTION_FAILED', 'ERR_DNS_TIMED_OUT', 'ERR_DNS_MALFORMED_RESPONSE', 'ERR_ADDRESS_INVALID', 'ERR_CONNECTION_FAILED']) {
    await adresDegistirir(() => new TypeError(`net::${kod}`), `net::${kod}`);
  }
});

test('(B39) DNS/adres hatasıyla düşen kimlikli istek BELİRSİZ sayılmaz: sayaç artmaz, anahtar "dogrulanamadi" olmaz, sonraki istek yeniden tek doğrulamayla başlar', async () => {
  for (const kod of ['ERR_NAME_RESOLUTION_FAILED', 'ERR_DNS_TIMED_OUT', 'ERR_ADDRESS_INVALID', 'ERR_CONNECTION_FAILED']) {
    const o = kur({
      ha: () => {
        throw new TypeError(`net::${kod}`);
      },
    });
    const p = o.kesici.parmakIzi(ANAHTAR);
    for (let i = 0; i < 3; i += 1) assert.notEqual(await hataTuru(o.istemci.haIstek('/api/states')), 'belirsiz', kod);
    assert.equal(o.kesici.belirsizSayisi(p), 0, kod);
    assert.equal(o.kesici.dogrulanamadiMi(p), false, kod);
    o.durum.ha = GECERLI_HA; // ağ düzeldi
    const once = o.kimlikliler().length;
    assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a', kod);
    assert.equal(o.kimlikliler().length - once, 2, `${kod}: tek doğrulama + asıl istek`);
  }
});

test("(tur2-P3) doğrulama isteği 8 sn'de kesilmez (ev içi 15 sn, dış adres 30 sn): yavaş HA/tünelde HA'nın saydığı yanıtsız deneme olmasın", async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const o = kur({ ha: () => new Promise(() => {}) });
    let bitti = false;
    const p = hataTuru(o.istemci.haIstek('/api/states')).then((r) => {
      bitti = true;
      return r;
    });
    await akit();
    mock.timers.tick(8000);
    await akit();
    assert.equal(bitti, false, '8 sn: doğrulama hâlâ bekliyor');
    mock.timers.tick(7000);
    assert.equal(await p, 'belirsiz', 'ev içi doğrulama 15 sn');

    const dis = kur({ ha: () => new Promise(() => {}), yoklama: (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 })) });
    let disBitti = false;
    const q = hataTuru(dis.istemci.haIstek('/api/states')).then((r) => {
      disBitti = true;
      return r;
    });
    await akit();
    mock.timers.tick(29_000);
    await akit();
    assert.equal(disBitti, false, 'dış adres: 29 sn hâlâ bekliyor');
    mock.timers.tick(1000);
    assert.equal(await q, 'belirsiz');
    assert.ok(dis.cagrilar.some((c) => c.kimlikli && c.url === `${DIS}/api/`));
  } finally {
    mock.timers.reset();
  }
});

test('(tur2-P3) WS: anahtar "dogrulanamadi" durumundaysa soket açılmaz ve yeniden bağlanma döngüsüne girilmez', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.belirsizKaydet(p);
  o.kesici.belirsizKaydet(p);
  o.ws.baslat();
  await akit();
  o.zaman.ilerle(10 * 60_000);
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.equal(o.cagrilar.length, 0, 'ne yoklama ne kimlikli istek');
  assert.deepEqual(o.ws.durum(), { baglanti: 'yedek', canli: false, neden: 'dogrulanamadi' }, 'kalıcı yedek: "duraklatildi" geri çekilme döngüsü yok');
  assert.equal(kesintiMi(o.ws.durum()), false, 'gerçek kesinti sayılmaz: "bağlantı koptu" bildirimi gelmez');
  assert.equal(o.zaman.bekleyen(), 0, 'bekleyen yeniden bağlanma zamanlayıcısı yok');
  o.kesici.yenidenDene();
  o.ws.yenidenBaglan();
  await akit();
  assert.equal(o.soketler.length, 1, 'kullanıcı Yeniden dene dedi: soket açıldı');
  assert.equal(o.kimlikliler().length, 1, 'tek doğrulama');
});

test("(tur2-P5) doğrulama taze (30 sn) iken anahtar iptal edilirse bağımsız eşzamanlı çağrılar (toplu + eylem POST + /api/states) HA'ya TEK hatalı deneme gönderir", async () => {
  let t = 0;
  const o = kur({ ha: GECERLI_HA, simdi: () => t });
  await o.istemci.haIstek('/api/states/light.a'); // başarılı: tazelik başladı
  t += 10_000;
  o.durum.ha = () => json({ message: '401: Unauthorized' }, 401); // anahtar HA'da silindi
  const once = o.kimlikliler().length;
  const sonuclar = await Promise.all([
    hataTuru(o.istemci.haIstek('/api/states')),
    hataTuru(o.istemci.haIstek('/api/states/light.a')),
    hataTuru(o.istemci.haIstek('/api/states/light.b')),
    hataTuru(o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } })),
  ]);
  assert.equal(o.kimlikliler().length - once, 1, 'ilk istek tek başına gitti, kalanlar sonucunu bekledi');
  assert.equal(sonuclar.filter((s) => s === 'yetki').length, 1);
  assert.equal(sonuclar.filter((s) => s === 'reddedildi').length, 3);
});

test("(tur2-P5) WS auth_ok HA'nın anahtarı kabul ettiğini gösterir: sonraki REST yeniden doğrulama göndermez", async () => {
  let t = 0;
  const o = wsKur({ ha: GECERLI_HA, simdi: () => t });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  t += 20_000;
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.length, 1);
  t += 15_000; // doğrulamadan 35 sn sonra auth_ok: REST doğrulaması bayat olurdu
  s.yayinla({ type: 'auth_ok' });
  const once = o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length;
  await o.istemci.haIstek('/api/states/light.a');
  assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, once, 'auth_ok doğrulama sayıldı');
});

const yerelYasakYoklama = (url) => (url.startsWith(YEREL) ? new Response('Forbidden', { status: 403 }) : new Response(HA_MANIFEST, { status: 200 }));

test("(tur2-P6) ev içi YOKLAMA 403 (HA ban'ı): doğrulanmamış anahtar dış adrese GİTMEZ; adres seçimi (kimliksiz) yine dış adresi bulur", async () => {
  const o = kur({ ha: () => json({}, 401), yoklama: yerelYasakYoklama });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states')), 'yerel-yasak');
  assert.equal(o.kimlikliler().length, 0, 'dış adrese kimlikli istek 0 (ev içi zaten yasak)');
  assert.equal(o.kesici.reddedilenler().length, 0, 'anahtar reddedilmiş sayılmaz');
  assert.deepEqual(await o.istemci.adresSec(), { adres: DIS, tur: 'dis' }, 'adres seçimi anahtarsız sürer');
  assert.equal(o.istemci.engelDurumu(), 'yerel-yasak');
  assert.ok(hataMetni(new HaHatasi('yerel-yasak')).includes('403'));
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(ANAHTAR)), 'yerel-yasak');
  assert.equal(o.kimlikliler().length, 0);
});

test('(tur2-P6) ev içi yoklama 403 iken daha önce başarıyla doğrulanmış anahtar dış adrese gidebilir (tek doğrulamayla); kullanıcı onayı da izin verir', async () => {
  const iyi = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama });
  iyi.kesici.dogrulandi(iyi.kesici.parmakIzi(ANAHTAR)); // önceki oturumdan kalıcı "doğrulanmış"
  assert.equal((await iyi.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  assert.deepEqual(iyi.kimlikliler().map((c) => c.url), [`${DIS}/api/`, `${DIS}/api/states/light.a`]);

  const onayli = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama });
  assert.equal(await hataTuru(onayli.istemci.haIstek('/api/states/light.a')), 'yerel-yasak');
  onayli.istemci.disIzniVer(onayli.kesici.parmakIzi(ANAHTAR)); // kullanıcı Ayarlar'da "Yeniden dene" dedi
  assert.equal(onayli.istemci.engelDurumu(), null);
  assert.equal((await onayli.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  assert.equal(onayli.kimlikliler().filter((c) => c.url === `${DIS}/api/`).length, 1, 'dış adreste tek doğrulama');
});

test('(tur2-P6) ev içi yoklama ARTIK 403 vermiyorsa engel kalkar (ban kalktı); ev içi zaman aşımı/ulaşılamaz 403 sayılmaz', async () => {
  const o = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama });
  await hataTuru(o.istemci.haIstek('/api/states'));
  assert.equal(o.istemci.engelDurumu(), 'yerel-yasak');
  o.durum.yoklama = () => new Response(HA_MANIFEST, { status: 200 }); // HA yeniden başlatıldı, ban kalktı
  o.istemci.secimiSifirla();
  assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  assert.equal(o.istemci.engelDurumu(), null);
  assert.ok(o.kimlikliler().every((c) => c.url.startsWith(YEREL)));

  // evden uzak: ev içi yoklama zaman aşımı/ağ hatası -> dış adres normal (engel yok)
  const uzak = kur({ ha: GECERLI_HA, yoklama: (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 })) });
  assert.equal((await uzak.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  assert.ok(uzak.kimlikliler().every((c) => c.url.startsWith(DIS)));
});

// ===========================================================================
// Tur 3 inceleme düzeltmeleri (K1-K6): tek küresel kapı (en çok 1 kimlikli işlem), belirsizlik sınırı 1/2, HA-değil yanıt,
// IP başına hata bütçesi, okunamayan/bozuk kesici kaydı, ana pencere zaten dış adresteyken yerel-yasak koruması
// ===========================================================================

const K1 = 'ILK_SAHTE_ANAHTAR_AAAAAAAAAAAAAAAAA_0001';
const K2 = 'IKINCI_SAHTE_ANAHTAR_BBBBBBBBBBBBBBB_0002';
const K3 = 'UCUNCU_SAHTE_ANAHTAR_CCCCCCCCCCCCCCC_0003';
const K4 = 'DORDUNCU_SAHTE_ANAHTAR_DDDDDDDDDDDDD_0004';

/** Sahte soketlere sırayla auth_required gönderir; auth gelirse sonucu `auth` ('ok' | 'invalid' | null: yanıtsız) belirler. */
async function wsSurucu(o, { auth = 'invalid', tur = 6, sayac = null } = {}) {
  for (let i = 0; i < tur; i += 1) {
    await akit();
    for (const s of o.soketler) {
      if (!s.basladi) {
        s.basladi = true;
        s.yayinla({ type: 'auth_required' });
      }
      if (!s.yanitlandi && s.gonderilen.some((m) => m.type === 'auth')) {
        s.yanitlandi = true;
        if (auth === 'invalid') {
          if (sayac) sayac.hatali += 1;
          s.yayinla({ type: 'auth_invalid' });
        } else if (auth === 'ok') s.yayinla({ type: 'auth_ok' });
      }
    }
  }
}

test("(tur3-K6-1) yedek modunda son kabulden 1 sn sonra anahtar iptal + toplu yenileme (4 eşzamanlı) + ws.baslat: HA'ya TOPLAM 1 hatalı deneme", async () => {
  let t = 0;
  const sayac = { hatali: 0 };
  let iptal = false;
  const o = wsKur({
    simdi: () => t,
    ha: (url) => {
      if (iptal) {
        sayac.hatali += 1;
        return json({ message: '401: Unauthorized' }, 401);
      }
      return GECERLI_HA(url);
    },
  });
  await o.istemci.haIstek('/api/states/light.a'); // son kabul edilen yanıt (t=0)
  iptal = true;
  t += 1000;
  const toplu = sinirliEszamanli(
    Array.from({ length: 8 }, (_, i) => `light.l${i}`),
    4,
    (k) => o.istemci.haIstek(`/api/states/${k}`),
  ).then(
    () => 'basarili',
    (h) => h.tur,
  );
  o.ws.baslat();
  await wsSurucu(o, { auth: 'invalid', sayac });
  assert.equal(await toplu, 'yetki');
  assert.equal(sayac.hatali, 1, 'REST + WS birlikte tek hatalı deneme');
});

test('(tur3-K6-1b) WS auth yanıtını beklerken REST kapıda bekler; auth_invalid gelince REST kalanları ağa ÇIKMAZ (toplam 1)', async () => {
  const sayac = { hatali: 0 };
  let iptal = false;
  const o = wsKur({
    ha: (url) => {
      if (iptal) {
        sayac.hatali += 1;
        return json({}, 401);
      }
      return GECERLI_HA(url);
    },
  });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' }); // auth gönderilir, yanıt henüz yok
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  iptal = true;
  const rest = Promise.all(Array.from({ length: 4 }, (_, i) => hataTuru(o.istemci.haIstek(`/api/states/light.l${i}`))));
  await akit();
  assert.equal(sayac.hatali, 0, 'kapı WS auth yanıtına kadar tutulur: REST bekliyor');
  sayac.hatali += 1;
  s.yayinla({ type: 'auth_invalid' }); // HA auth iletisini reddetti
  const sonuclar = await rest;
  assert.deepEqual(sonuclar, Array(4).fill('reddedildi'));
  assert.equal(sayac.hatali, 1);
});

test('(tur3-K1) kimlikli işlemler SIRALIDIR: aynı anda en çok 1 kimlikli istek yolda (geçerli anahtar, 8 eşzamanlı çağrı)', async () => {
  let aktifSayi = 0;
  let enCok = 0;
  const o = kur({
    ha: async (url) => {
      aktifSayi += 1;
      enCok = Math.max(enCok, aktifSayi);
      await akit();
      aktifSayi -= 1;
      return GECERLI_HA(url);
    },
  });
  await Promise.all(Array.from({ length: 8 }, (_, i) => o.istemci.haIstek(`/api/states/light.l${i}`)));
  assert.equal(enCok, 1);
  assert.equal(o.kimlikliler().length, 9, 'doğrulama + 8 istek');
});

test('(tur3-K1) kapı her durumda bırakılır: ağ hatası ve zaman aşımı sonrası sıradaki çağrılar takılmaz', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    let tur = 'hata';
    const o = kur({
      simdi: () => t,
      ha: (url) => {
        if (tur === 'hata') throw baglantiReddi();
        if (tur === 'takili') return new Promise(() => {});
        return GECERLI_HA(url);
      },
    });
    o.kesici.dogrulandi(o.kesici.parmakIzi(ANAHTAR));
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'baglanti'); // gönderim öncesi ağ hatası
    tur = 'takili';
    o.istemci.secimiSifirla();
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000);
    assert.equal(await p, 'belirsiz'); // zaman aşımı
    t += 31_000;
    tur = 'iyi';
    let bitti = false;
    const son = o.istemci.haIstek('/api/states/light.a').then((y) => {
      bitti = true;
      return y;
    });
    await akit();
    assert.equal(bitti, true, 'kapı takılı kalmadı');
    assert.equal((await son).entity_id, 'light.a');
  } finally {
    mock.timers.reset();
  }
});

test('(tur3-K1) WS soketi auth yanıtı beklerken kapanırsa kapı bırakılır: REST çağrıları takılmaz', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  let bitti = false;
  const rest = hataTuru(o.istemci.haIstek('/api/states/light.a')).then((tur) => {
    bitti = true;
    return tur;
  });
  await akit();
  assert.equal(bitti, false, 'auth yanıtı beklenirken REST kapıda');
  for (const fn of s.dinleyiciler.close ?? []) fn({}); // yanıtsız kapanış
  await akit();
  assert.equal(bitti, true, 'kapanışta kapı bırakıldı');
  assert.equal(await rest, 'belirsiz', 'yanıtsız kopma belirsiz sayıldı: soğuma sürerken REST ağa çıkmadan reddedilir');
});

test('(tur3-K1) WS durdur() auth yanıtı beklerken kapıyı bırakır', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  o.soketler[0].yayinla({ type: 'auth_required' });
  await akit();
  let bitti = false;
  const rest = hataTuru(o.istemci.haIstek('/api/states/light.a')).then((tur) => {
    bitti = true;
    return tur;
  });
  await akit();
  assert.equal(bitti, false);
  o.ws.durdur();
  assert.equal(await rest, 'belirsiz', 'yanıtsız auth durdurmada belirsiz sayılır (tur 4): soğuma sürerken REST ağa çıkmaz');
  assert.equal(bitti, true);
});

test('(tur3-K3) /api/ 200 ama HA içeriği değil: doğrulanmış SAYILMAZ; ikinci çağrı yine /api/ doğrulamasıyla başlar, iyiMi false', async () => {
  const o = kur({ ha: () => json({ message: 'başka bir şey' }) });
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'sunucu');
  assert.equal(o.kesici.iyiMi(p), false);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'sunucu');
  assert.deepEqual(
    o.kimlikliler().map((c) => c.url),
    [`${YEREL}/api/`, `${YEREL}/api/`],
    'asıl istek hiç gitmedi; her çağrı yeniden TEK doğrulamayla başladı',
  );
  assert.equal(o.kesici.iyiMi(p), false);
});

test('(tur3-K3) /api/ 404 ya da JSON olmayan 200: doğrulama sayılmaz, tazelik penceresi açmaz, kalıcı iyi işareti yok', async () => {
  for (const yanit of [() => json({ message: 'yok' }, 404), () => new Response('<html>vekil</html>', { status: 200 })]) {
    const o = kur({ ha: yanit });
    const p = o.kesici.parmakIzi(ANAHTAR);
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'sunucu');
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'sunucu');
    assert.equal(o.kesici.iyiMi(p), false);
    assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, 2);
    assert.equal(o.kimlikliler().filter((c) => c.url.includes('/api/states')).length, 0);
  }
});

test('(tur3-K6-3) WS: auth gönderildi, auth_ok/auth_invalid gelmeden soket kapandı -> BELİRSİZ sayılır; soğuma boyunca yeni kimlikli istek yok', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  const p = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(o.kesici.belirsizSayisi(p), 0);
  for (const fn of s.dinleyiciler.close ?? []) fn({});
  assert.equal(o.kesici.belirsizSayisi(p), 1, 'yanıtsız kopma belirsiz denemedir');
  const once = o.kimlikliler().length;
  o.zaman.ilerle(5_000); // WS yeniden bağlanma zamanlayıcısı; soğuma (30 sn) sürüyor
  await akit();
  assert.equal(o.kimlikliler().length, once, 'soğuma bitmeden ikinci doğrulama gitmedi');
  assert.equal(o.soketler.length, 1);
});

test('(tur3-K6-3b) WS: auth_ok gelmişse sonradan kopma belirsiz SAYILMAZ; auth_ok belirsiz sayacı sıfırlar', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.dogrulandi(p);
  o.kesici.belirsizKaydet(p); // doğrulanmış anahtarda sınır 2: sayaç 1
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  s.yayinla({ type: 'auth_ok' });
  assert.equal(o.kesici.belirsizSayisi(p), 0, 'auth_ok sayaçları sıfırladı');
  for (const fn of s.dinleyiciler.close ?? []) fn({});
  assert.equal(o.kesici.belirsizSayisi(p), 0, 'auth_ok sonrası kopma belirsiz değil');
});

test('(tur3-K6-4) doğrulanmamış anahtarda İLK belirsizlikten sonra 0 istek (soğuma bitse de, yeniden başlatılsa da); "Yeniden Dene" ile TAM 1', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    const fs = sahteFs();
    const o = kur({ ha: () => new Promise(() => {}), simdi: () => t, fs });
    const p = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000);
    assert.equal(await p, 'belirsiz');
    assert.equal(o.kimlikliler().length, 1);
    const sayi = o.cagrilar.length;
    t += 60 * 60_000;
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(o.cagrilar.length, sayi, 'yoklama dahil yeni istek yok');

    const yeniden = kur({ ha: () => new Promise(() => {}), simdi: () => t, fs }); // uygulama yeniden başladı
    assert.equal(await hataTuru(yeniden.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(yeniden.cagrilar.length, 0);

    // kullanıcı "Yeniden Dene" der: TAM 1 yeni hak
    yeniden.kesici.yenidenDene();
    yeniden.istemci.disIzniVer(yeniden.kesici.parmakIzi(ANAHTAR));
    const pp = hataTuru(yeniden.istemci.haIstek('/api/states/light.a'));
    await akit();
    mock.timers.tick(30_000);
    assert.equal(await pp, 'belirsiz');
    assert.equal(yeniden.kimlikliler().length, 1, 'tam 1 yeni doğrulama');
    t += 60 * 60_000;
    assert.equal(await hataTuru(yeniden.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(yeniden.kimlikliler().length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('(tur3-K2) doğrulanmış anahtarda sınır 2: ilk belirsizlikte soğuma (30 sn), ikincide kullanıcı onayı gerekir', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    const o = kur({ ha: () => new Promise(() => {}), simdi: () => t });
    const p = o.kesici.parmakIzi(ANAHTAR);
    o.kesici.dogrulandi(p);
    const dene = async () => {
      const s = hataTuru(o.istemci.haIstek('/api/states/light.a'));
      await akit();
      mock.timers.tick(30_000);
      return s;
    };
    assert.equal(await dene(), 'belirsiz');
    assert.equal(o.kesici.dogrulanamadiMi(p), false);
    t += 31_000;
    assert.equal(await dene(), 'belirsiz');
    assert.equal(o.kesici.dogrulanamadiMi(p), true);
    t += 60 * 60_000;
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(o.kimlikliler().length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('(tur3-K4) hata bütçesi: sayaç >= 2 iken YENİ anahtar ancak açık ikinci onayla doğrulanır; sayaç kalıcıdır; REST başarısı sıfırlamaz', async () => {
  const fs = sahteFs();
  const yanit = (url, s) => (s.headers.Authorization === `Bearer ${K4}` ? API_CALISIYOR() : json({}, 401));
  const o = kur({ ha: yanit, fs });
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K1)), 'yetki');
  assert.equal(o.kesici.hataliDenemeSayisi(), 1);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K2)), 'yetki', 'sayaç 1 iken onay gerekmez');
  assert.equal(o.kesici.hataliDenemeSayisi(), 2);
  assert.equal(o.kimlikliler().length, 2);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K3)), 'ikinci-onay', 'sayaç 2: onaysız doğrulanmaz');
  assert.equal(o.kimlikliler().length, 2, 'ağa HİÇBİR şey çıkmadı');
  assert.deepEqual(o.kesici.onayGerekliMi(o.kesici.parmakIzi(K3)), { neden: 'hata-butcesi', sayi: 2 });
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K3, { onay: true })), 'ikinci-onay', 'boolean onay artık geçmez: onay nesnesi (bilet sonucu) gerekir');

  const yeniden = kur({ ha: yanit, fs }); // yeniden başlatma: sayaç kalıcı
  assert.equal(yeniden.kesici.hataliDenemeSayisi(), 2);
  assert.equal(await hataTuru(yeniden.istemci.anahtariDogrula(K3)), 'ikinci-onay');
  assert.equal(yeniden.cagrilar.length, 0);
  assert.equal(await hataTuru(yeniden.istemci.anahtariDogrula(K4, { onay: { sayi: 2 } })), 'basarili', 'açık onayla tek doğrulama gider');
  assert.equal(yeniden.kimlikliler().length, 1);
  assert.equal(yeniden.kesici.hataliDenemeSayisi(), 2, 'REST başarısı HA sayacını sıfırladığı doğrulanmadı: muhafazakâr olarak sıfırlanmaz');
});

test('(tur3-K4) hata bütçesi yalnız WS auth_ok ile sıfırlanır (HA process_success_login yalnız orada doğrulandı); günlük sırsız', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.kesici.reddet(o.kesici.parmakIzi(K1), 'HTTP_401', 'yerel');
  o.kesici.reddet(o.kesici.parmakIzi(K2), 'HTTP_401', 'yerel');
  assert.equal(o.kesici.hataliDenemeSayisi(), 2);
  await o.istemci.haIstek('/api/states/light.a');
  assert.equal(o.kesici.hataliDenemeSayisi(), 2);
  o.ws.baslat();
  await akit();
  o.soketler[0].yayinla({ type: 'auth_required' });
  await akit();
  o.soketler[0].yayinla({ type: 'auth_ok' });
  assert.equal(o.kesici.hataliDenemeSayisi(), 0);
  assert.ok(!JSON.stringify([o.gunlukler, o.wsGunlukleri]).includes(ANAHTAR));
});

test('(tur3-K5) bozuk kesici dosyası: saklı anahtar için ilk kimlikli istek onaya (Yeniden Dene) bağlıdır; 0 istek, onayla TAM 1', async () => {
  const fs = sahteFs();
  fs.dosyalar.set(DOSYA, '{bozuk json');
  const o = kur({ ha: GECERLI_HA, fs });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.cagrilar.length, 0, 'yoklama dahil 0 istek');
  assert.equal(o.kesici.onayDurumu(), 'kayit-okunamadi');
  o.kesici.yenidenDene();
  assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  assert.equal(o.kimlikliler().filter((c) => c.url.endsWith('/api/')).length, 1);
});

test('(tur3-K5) okunamayan kesici dosyası (kilitli): daha önce doğrulanmış anahtar için de ilk istek onaya bağlıdır', async () => {
  const fs = sahteFs();
  const ilk = kur({ ha: GECERLI_HA, fs });
  await ilk.istemci.haIstek('/api/states/light.a'); // anahtar doğrulandı, kayıt yazıldı
  assert.equal(ilk.kesici.iyiMi(ilk.kesici.parmakIzi(ANAHTAR)), true);
  const okuma = fs.readFileSync;
  fs.readFileSync = (y) => {
    if (y === DOSYA) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return okuma(y);
  };
  const yeniden = kur({ ha: GECERLI_HA, fs });
  assert.equal(await hataTuru(yeniden.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(yeniden.cagrilar.length, 0);
});

test('(tur3-K5) kayıt hiçbir yere yazılamıyorsa açılışta ilk kimlikli istek onaya bağlanır (her açılışta aynı geçersiz anahtarla 1 deneme gitmesin)', async () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('EROFS');
  };
  const o = kur({ ha: GECERLI_HA, fs });
  assert.equal(o.kesici.onayDurumu(), 'kayit-yazilamadi');
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.cagrilar.length, 0);
});

test('(tur3-K5) temizle(parmakIzi) YALNIZ o parmak izinin kaydını siler; diğer kayıtlar ve hata bütçesi sayacı korunur', () => {
  const o = kur();
  const a = o.kesici.parmakIzi(K1);
  const b = o.kesici.parmakIzi(K2);
  o.kesici.reddet(a);
  o.kesici.reddet(b);
  assert.equal(o.kesici.hataliDenemeSayisi(), 2);
  assert.equal(o.kesici.temizle(a), true);
  assert.deepEqual(o.kesici.reddedilenler(), [b]);
  assert.equal(o.kesici.hataliDenemeSayisi(), 2, 'hata bütçesine dokunulmadı');
  assert.equal(o.kesici.temizle(a), false);
});

test('(tur3-K6) ana pencere ZATEN dış adresteyken (aktifAdresAl kısayolu) ev içi 403: doğrulanmamış anahtar dış adrese GİTMEZ', async () => {
  const o = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama, aktif: DIS });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'yerel-yasak');
  assert.equal(o.kimlikliler().length, 0, 'dış adrese kimlikli istek 0');
  assert.equal(o.istemci.engelDurumu(), 'yerel-yasak');

  // doğrulanmış anahtar gider; kullanıcı onayı da izin verir
  const iyi = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama, aktif: DIS });
  iyi.kesici.dogrulandi(iyi.kesici.parmakIzi(ANAHTAR));
  assert.equal((await iyi.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  const onayli = kur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama, aktif: DIS });
  onayli.istemci.disIzniVer(onayli.kesici.parmakIzi(ANAHTAR));
  assert.equal((await onayli.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');

  // evden uzak: ev içi yoklama ağ hatası (403 değil) -> dış adres normal
  const uzak = kur({ ha: GECERLI_HA, aktif: DIS, yoklama: (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 })) });
  assert.equal((await uzak.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
});

test('(tur3-K6) WS yolu da aynı koruma: ana pencere dış adreste + ev içi 403 + doğrulanmamış anahtar -> soket açılmaz, kimlikli istek 0', async () => {
  const o = wsKur({ ha: GECERLI_HA, yoklama: yerelYasakYoklama, aktif: DIS });
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.equal(o.kimlikliler().length, 0);
});

test('(tur3-K1) yinelenen auth_required ikinci auth göndermez; kapı tek kez alınır ve auth_ok ile bırakılır', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  s.yayinla({ type: 'auth_ok' });
  let bitti = false;
  await o.istemci.haIstek('/api/states/light.a').then(() => {
    bitti = true;
  });
  assert.equal(bitti, true, 'auth_ok sonrası kapı açık');
});

// ===========================================================================
// Tur 4 inceleme düzeltmeleri
// ===========================================================================

test('(tur4-K5) bozuk kayıt + onaylı aday 401: saklı anahtar "Yeniden Dene" olmadan ağa ÇIKMAZ (onay yalnız aday doğrulamasına özel)', async () => {
  const fs = sahteFs();
  fs.dosyalar.set(DOSYA, '{bozuk json');
  const o = kur({ ha: (url, s) => (s.headers.Authorization === `Bearer ${YENI_ANAHTAR}` ? json({}, 401) : GECERLI_HA(url)), fs });
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.cagrilar.length, 0);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR)), 'ikinci-onay');
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR, { onay: { sayi: 0 } })), 'yetki');
  assert.equal(o.kimlikliler().length, 1, 'yalnız aday gitti');
  assert.equal(o.kimlikliler()[0].yetki, `Bearer ${YENI_ANAHTAR}`);
  assert.equal(o.kesici.onayDurumu(), 'kayit-okunamadi', 'onay hâlâ açık');
  // 60 sn yedek yoklaması / tepsi: saklı anahtar yine 0 istek
  for (let i = 0; i < 3; i += 1) assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.kimlikliler().length, 1, 'saklı anahtar için HİÇ kimlikli istek çıkmadı');
  assert.equal(o.kesici.hataliDenemeSayisi(), 1);
});

test('(tur4-K5) kayıt-yazilamadi onayında da aday doğrulaması küresel onayı açmaz: saklı anahtar yine onay bekler', async () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('EROFS');
  };
  const o = kur({ ha: GECERLI_HA, fs });
  assert.equal(o.kesici.onayDurumu(), 'kayit-yazilamadi');
  await o.istemci.anahtariDogrula(YENI_ANAHTAR, { onay: { sayi: 0 } });
  assert.equal(o.kimlikliler().length, 1);
  assert.equal(o.kesici.onayDurumu(), 'kayit-yazilamadi', 'küresel onayı yalnız çağıran (aday kaydedilince) temizler');
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.kimlikliler().length, 1);
});

test('(tur4-O2) WS: auth gönderildi, yanıt gelmeden yenidenBaglan(): BELİRSİZ sayılır, yeni soket açılıp ikinci auth GİTMEZ (HA\'ya toplam 1 auth)', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  const p = o.kesici.parmakIzi(ANAHTAR);
  const once = o.kimlikliler().length;
  o.ws.yenidenBaglan(); // ör. favori kaydı, anahtar:kaydet, Yeniden Dene: auth_invalid henüz gelmedi
  await akit();
  assert.equal(o.kesici.belirsizSayisi(p), 1, 'yanıtsız auth belirsiz sayıldı');
  for (const yeni of o.soketler.slice(1)) {
    yeni.yayinla({ type: 'auth_required' });
    await akit();
  }
  const authSayisi = o.soketler.reduce((n, k) => n + k.gonderilen.filter((m) => m.type === 'auth').length, 0);
  assert.equal(authSayisi, 1, 'ikinci auth soğuma bitmeden gitmedi');
  assert.equal(o.kimlikliler().length, once, 'yeni REST doğrulaması da yok');
});

test('(tur4-O2) WS: auth yanıtı beklerken askiyaAl() (uyku) ve durdur() da belirsiz sayar; uyanışta soğuma sürerken ikinci deneme gitmez', async () => {
  for (const yol of ['askiyaAl', 'durdur']) {
    const o = wsKur({ ha: GECERLI_HA });
    o.ws.baslat();
    await akit();
    const s = o.soketler[0];
    s.yayinla({ type: 'auth_required' });
    await akit();
    o.ws[yol]();
    assert.equal(o.kesici.belirsizSayisi(o.kesici.parmakIzi(ANAHTAR)), 1, yol);
    const once = o.kimlikliler().length;
    o.ws.yenidenBaglan(); // uyanış
    await akit();
    assert.equal(o.kimlikliler().length, once, `${yol}: soğuma sürerken yeni kimlikli istek yok`);
    assert.equal(o.soketler.length, 1, `${yol}: yeni soket yok`);
  }
});

test('(tur4-O2) WS: auth_ok geldikten sonra yenidenBaglan() belirsiz SAYMAZ', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  o.soketler[0].yayinla({ type: 'auth_required' });
  await akit();
  o.soketler[0].yayinla({ type: 'auth_ok' });
  o.ws.yenidenBaglan();
  await akit();
  assert.equal(o.kesici.belirsizSayisi(o.kesici.parmakIzi(ANAHTAR)), 0);
});

test('(tur4-O4) eylem (POST) toplu GET yenilemesinin ARKASINDA beklemez: kapıdaki tek istekten sonra hemen gider; sınır yine 1', async () => {
  let aktifSayi = 0;
  let enCok = 0;
  const o = kur({
    ha: async (url) => {
      aktifSayi += 1;
      enCok = Math.max(enCok, aktifSayi);
      await akit();
      aktifSayi -= 1;
      return GECERLI_HA(url);
    },
  });
  await o.istemci.haIstek('/api/states/light.x'); // doğrulandı
  const sozler = Array.from({ length: 6 }, (_, i) => o.istemci.haIstek(`/api/states/light.l${i}`));
  await akit(); // ilki yolda, kalan GET'ler kapıda sırada
  const post = o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: { entity_id: 'light.a' } });
  await Promise.all([...sozler, post]);
  const yollar = o.kimlikliler().slice(2).map((c) => `${c.yontem} ${new URL(c.url).pathname}`);
  assert.equal(yollar.length, 7);
  assert.equal(yollar[1], 'POST /api/services/light/toggle', `POST ilk GET'ten hemen sonra gitti: ${yollar.join(' | ')}`);
  assert.equal(enCok, 1);
});

test('(tur4-O4) WS auth da bekleyen toplu GET\'lerin önüne geçer', async () => {
  let birakKapi;
  const tutucu = new Promise((coz) => {
    birakKapi = coz;
  });
  let tut = false;
  const o = wsKur({
    ha: async (url) => {
      if (tut && !url.endsWith('/api/')) {
        tut = false;
        await tutucu; // kapıyı tutan ilk GET
      }
      return GECERLI_HA(url);
    },
  });
  await o.istemci.haIstek('/api/states/light.x'); // doğrulandı (tazelik penceresi açık)
  tut = true;
  const gets = Array.from({ length: 4 }, (_, i) => o.istemci.haIstek(`/api/states/light.g${i}`));
  await akit();
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  assert.ok(s, 'soket açıldı');
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 0, 'ilk GET kapıyı tutarken auth sırada');
  const kimlikliOnce = o.kimlikliler().length;
  birakKapi();
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1, 'auth, kalan GET\'lerden ÖNCE kapıyı aldı');
  assert.equal(o.kimlikliler().length, kimlikliOnce, 'auth kapıdayken kalan GET\'ler ağa çıkmadı');
  s.yayinla({ type: 'auth_ok' });
  await Promise.all(gets);
});

// ===========================================================================
// Tur 5 inceleme düzeltmeleri (K7-K10)
// ===========================================================================

const yerelUlasilmaz = (url) => (url.startsWith(YEREL) ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 }));

test('(tur5-K10) A doğrulaması yoldayken aday C onaysız başlatılır; A 401 alınca sayaç 2: C ağa ÇIKMAZ ve ikinci-onay alır (bütçe kapı alındıktan sonra yeniden denetlenir)', async () => {
  let birakA;
  const tut = new Promise((coz) => {
    birakA = coz;
  });
  const o = kur({
    anahtar: K1,
    ha: async (url, s) => {
      if (s.headers.Authorization === `Bearer ${K1}`) {
        await tut;
        return json({}, 401);
      }
      return API_CALISIYOR();
    },
  });
  o.kesici.reddet(o.kesici.parmakIzi(K4), 'HTTP_401', 'yerel'); // sayaç 1: onay gerekmez
  const a = hataTuru(o.istemci.haIstek('/api/states/light.a')); // saklı anahtar A: tek doğrulama yolda
  await akit();
  assert.equal(o.kimlikliler().length, 1);
  const c = o.istemci.anahtariDogrula(K3).then(() => null, (h) => h);
  await akit();
  assert.equal(o.kimlikliler().length, 1, 'C kapıda bekliyor');
  birakA();
  assert.equal(await a, 'yetki');
  const hata = await c;
  assert.equal(hata?.tur, 'ikinci-onay');
  assert.equal(hata.onay.neden, 'hata-butcesi');
  assert.equal(hata.onay.sayi, 2);
  assert.equal(o.kimlikliler().length, 1, 'C ağa hiç çıkmadı');
  assert.equal(o.cagrilar.filter((c2) => c2.yetki === `Bearer ${K3}`).length, 0);
  assert.equal(o.kesici.hataliDenemeSayisi(), 2, 'sayaç 3 olmadı');
});

test('(tur5-K10) onaylı aday (sayaç 2 onaylandı): bekleme sırasında sayaç 3 olursa onay GEÇMEZ; ağa çıkmadan yeniden ikinci-onay', async () => {
  let birakA;
  const tut = new Promise((coz) => {
    birakA = coz;
  });
  const o = kur({
    anahtar: K1,
    ha: async (url, s) => {
      if (s.headers.Authorization === `Bearer ${K1}`) {
        await tut;
        return json({}, 401);
      }
      return API_CALISIYOR();
    },
  });
  o.kesici.reddet(o.kesici.parmakIzi(K4), 'HTTP_401', 'yerel');
  o.kesici.reddet(o.kesici.parmakIzi(K2), 'HTTP_401', 'yerel');
  const a = hataTuru(o.istemci.haIstek('/api/states/light.a'));
  await akit();
  const c = o.istemci.anahtariDogrula(K3, { onay: { sayi: 2 } }).then(() => null, (h) => h);
  await akit();
  birakA();
  await a;
  const hata = await c;
  assert.equal(hata?.tur, 'ikinci-onay');
  assert.equal(hata.onay.sayi, 3, 'yeni sayaç gösterilir');
  assert.equal(o.kimlikliler().length, 1);
});

test('(tur5-K9) disIzniVer(A) YALNIZ A için geçerlidir: ev içi 403 iken aday B dış adrese GİTMEZ (yerel-yasak), dış adrese 0 kimlikli istek', async () => {
  const o = kur({ ha: () => json({}, 401), yoklama: yerelYasakYoklama });
  const pA = o.kesici.parmakIzi(ANAHTAR);
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'yerel-yasak');
  o.istemci.disIzniVer(pA); // kullanıcı A için "Yeniden Dene" dedi
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'yetki', 'A dış adrese tek doğrulamayla gitti (401)');
  const dis = o.kimlikliler().length;
  assert.equal(dis, 1);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR)), 'yerel-yasak', 'aday B kendi onayı olmadan dış adrese gitmez');
  assert.equal(o.kimlikliler().length, dis, 'dış adrese B ile kimlikli istek 0');
  assert.equal(o.cagrilar.filter((c) => c.yetki === `Bearer ${YENI_ANAHTAR}`).length, 0);
  assert.equal(o.istemci.engelDurumu(), 'yerel-yasak');
  // B için de açık onay (Yeniden Dene) verilirse gider
  o.istemci.disIzniVer(o.kesici.parmakIzi(YENI_ANAHTAR));
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(YENI_ANAHTAR)), 'yetki');
  assert.equal(o.kimlikliler().length, dis + 1);
});

test('(tur5-K9) ev içi ULAŞILAMAZ (ağ hatası, 403 değil) iken doğrulanmamış anahtar tek doğrulamayla dış adrese gider (bilinçli karar); anahtar silinince dış adres izinleri sıfırlanır', async () => {
  const o = kur({ ha: GECERLI_HA, yoklama: yerelUlasilmaz });
  await o.istemci.anahtariDogrula(K1);
  assert.deepEqual(o.kimlikliler().map((c) => c.url), [`${DIS}/api/`]);
  const y = kur({ ha: () => json({}, 401), yoklama: yerelYasakYoklama });
  y.istemci.disIzniVer(y.kesici.parmakIzi(ANAHTAR));
  y.istemci.dogrulamayiSifirla(); // "Anahtarı sil"
  assert.equal(await hataTuru(y.istemci.haIstek('/api/states/light.a')), 'yerel-yasak', 'silmeden sonra eski izin geçmez');
  assert.equal(y.kimlikliler().length, 0);
});

test('(tur5-K8) hata bütçesi KÖKEN başına: dış kökende 401 yalnız dış sayacı artırır; ev içi WS auth_ok dış sayacı sıfırlamaz; uyarı isteğin gideceği kökeni kullanır', async () => {
  const o = kur({ ha: () => json({}, 401), yoklama: yerelUlasilmaz });
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K1)), 'yetki'); // ev içi ulaşılamaz: dış adres
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K2)), 'yetki');
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 2);
  assert.equal(o.kesici.hataliDenemeSayisi('yerel'), 0);
  o.istemci.wsYetkisi.onaylandi(YEREL, o.kesici.parmakIzi(K3)); // evde başka bir bağlantıda auth_ok
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 2, 'ev içi auth_ok dış kökenin sayacını sıfırlamadı');
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K3)), 'ikinci-onay');
  assert.equal(o.kimlikliler().length, 2, 'K3 ağa çıkmadı');
  o.istemci.wsYetkisi.onaylandi(DIS, o.kesici.parmakIzi(K3)); // dış adreste başarılı giriş
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 0);
});

test('(tur5-K8) WS auth_invalid yalnız bağlanılan kökenin sayacını artırır', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  s.yayinla({ type: 'auth_invalid' });
  assert.equal(o.kesici.hataliDenemeSayisi('yerel'), 1);
  assert.equal(o.kesici.hataliDenemeSayisi('dis'), 0);
});

test('(tur5-K8) aday anahtar bütçeden muaf DEĞİLDİR: daha önce doğrulanmış (sonra iptal edilmiş olabilecek) anahtar aday olarak yapıştırılınca sayaç >= 2 ise ikinci onay ister', async () => {
  const o = kur({ ha: GECERLI_HA });
  o.kesici.dogrulandi(o.kesici.parmakIzi(K3));
  o.kesici.reddet(o.kesici.parmakIzi(K1), 'HTTP_401', 'yerel');
  o.kesici.reddet(o.kesici.parmakIzi(K2), 'HTTP_401', 'yerel');
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K3)), 'ikinci-onay');
  assert.equal(o.cagrilar.length, 0);
  assert.equal(await hataTuru(o.istemci.anahtariDogrula(K3, { onay: { sayi: 2 } })), 'basarili');
});

test('(tur5-K8) bozuk kayıt + bütçe 3: aday doğrulaması bütçe uyarısını (ve kayıt nedenini) birlikte ister', async () => {
  const fs = sahteFs();
  fs.dosyalar.set(DOSYA, '{bozuk');
  const o = kur({ ha: GECERLI_HA, fs });
  for (let i = 0; i < 3; i += 1) o.kesici.reddet(o.kesici.parmakIzi(`RED_${i}_ANAHTAR_AAAAAAAAAAAAAAAAAAAAAAAA`), 'HTTP_401', 'yerel');
  const hata = await o.istemci.anahtariDogrula(K3).then(() => null, (h) => h);
  assert.equal(hata?.tur, 'ikinci-onay');
  assert.deepEqual({ ...hata.onay }, { neden: 'hata-butcesi', sayi: 3, kayit: 'kayit-okunamadi' });
  assert.equal(o.cagrilar.length, 0);
});

test('(tur5-K10) kimlikli istekte 502/504/520/522/524 BELİRSİZ sayılır (HA işlemiş olabilir): hiç doğrulanmamış anahtarda ilk seferden sonra durur, yeni doğrulama gitmez', async () => {
  for (const kod of [502, 504, 520, 522, 524]) {
    const o = kur({ ha: () => new Response('<html>bad gateway</html>', { status: kod }) });
    const p = o.kesici.parmakIzi(ANAHTAR);
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'belirsiz', `HTTP ${kod}`);
    assert.equal(o.kesici.belirsizSayisi(p), 1, `HTTP ${kod}`);
    assert.equal(o.kesici.dogrulanamadiMi(p), true, `HTTP ${kod}: doğrulanmamış anahtar durur`);
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(o.kimlikliler().length, 1, `HTTP ${kod}: tek istek`);
  }
  for (const kod of [500, 503]) {
    const o = kur({ ha: () => new Response('x', { status: kod }) });
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'sunucu', `HTTP ${kod}`);
    assert.equal(o.kesici.belirsizSayisi(o.kesici.parmakIzi(ANAHTAR)), 0);
  }
});

test('(tur5-K10) haIstek({ oncelik: "yuksek" }) bekleyen toplu GET\'lerin önüne geçer (eylem öncesi durum okuması)', async () => {
  const o = kur({
    ha: async (url) => {
      await akit();
      return GECERLI_HA(url);
    },
  });
  await o.istemci.haIstek('/api/states/light.x'); // doğrulandı
  const sozler = Array.from({ length: 6 }, (_, i) => o.istemci.haIstek(`/api/states/light.l${i}`));
  await akit();
  const eylem = o.istemci.haIstek('/api/states/light.eylem', { oncelik: 'yuksek' });
  await Promise.all([...sozler, eylem]);
  const yollar = o.kimlikliler().slice(2).map((c) => new URL(c.url).pathname);
  assert.equal(yollar[1], '/api/states/light.eylem', `öncelikli GET ilk GET'ten hemen sonra gitti: ${yollar.join(' | ')}`);
});

// --- tur 6: kalıcı "yolda" işareti (istek göndermeden ÖNCE yazılır; süreç ölse de deneme kaydı kalır) ---------------

const yoldaOku = (fs) => JSON.parse(fs.dosyalar.get(DOSYA) ?? '{}').yolda ?? [];

test('(tur6-P1) doğrulama yoldayken süreç ölürse (yanıt yok, kapanış olayı yok): deneme kalıcıdır; yeniden açılışta AYNI anahtarla 0 istek, durum "dogrulanamadi"', async () => {
  const fs = sahteFs();
  const o = kur({ ha: () => new Promise(() => {}), fs });
  const p = o.kesici.parmakIzi(ANAHTAR);
  hataTuru(o.istemci.haIstek('/api/states/light.a')); // yanıt hiç gelmez (HA yükte)
  await akit();
  assert.equal(o.kimlikliler().length, 1);
  assert.deepEqual(yoldaOku(fs), [p], 'istek ağa çıkmadan önce kalıcı işaret yazıldı');
  assert.ok(!fs.dosyalar.get(DOSYA).includes(ANAHTAR), 'anahtar dosyaya yazılmaz');

  // Süreç öldü (before-quit bile çalışmadı): yeni süreç aynı dosyayı okur.
  for (let tur = 0; tur < 3; tur += 1) {
    const yeniden = kur({ ha: () => json({}, 401), fs });
    assert.equal(yeniden.kesici.dogrulanamadiMi(p), true, `tur ${tur}: doğrulanmamış anahtar Yeniden Dene bekler`);
    assert.equal(await hataTuru(yeniden.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
    assert.equal(yeniden.cagrilar.length, 0, `tur ${tur}: yoklama dahil 0 istek`);
    assert.deepEqual(yoldaOku(fs), [], 'artakalan işaret belirsiz denemeye çevrildi ve silindi');
    assert.equal(yeniden.kesici.belirsizSayisi(p), 1, 'her açılış sayacı artırmaz');
  }
});

test('(tur6-P1) artakalan işaret: dogrulanamadi geri çağrısı (kullanıcı bildirimi) açılışta BİR kez çalışır; günlük sırsız', async () => {
  const fs = sahteFs();
  const p = yetkiKesiciOlustur({}).parmakIzi(ANAHTAR);
  fs.dosyalar.set(DOSYA, JSON.stringify({ surum: 1, reddedilenler: [], yolda: [p] }));
  const bildirimler = [];
  const gunlukler = [];
  const kesici = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs, gunluk: (m) => gunlukler.push(m), dogrulanamadi: (parmakIzi) => bildirimler.push(parmakIzi) });
  kesici.yukle();
  assert.deepEqual(bildirimler, [p]);
  assert.equal(kesici.dogrulanamadiMi(p), true);
  assert.ok(gunlukler.some((g) => g.includes(p.slice(0, 8))));
  assert.ok(gunlukler.every((g) => !g.includes(p) && !g.includes(ANAHTAR)));
  kesici.yukle(); // ikinci yükleme: işaret silinmişti, yeni bildirim yok
  assert.equal(bildirimler.length, 1);
});

test('(tur6-P1) doğrulanmış anahtarda artakalan işaret 1 belirsizdir (sınır 2): bir deneme daha, o da yarım kalırsa Yeniden Dene', async () => {
  const fs = sahteFs();
  const ilk = kur({ ha: () => new Promise(() => {}), fs });
  const p = ilk.kesici.parmakIzi(ANAHTAR);
  ilk.kesici.dogrulandi(p);
  hataTuru(ilk.istemci.haIstek('/api/states/light.a'));
  await akit();
  assert.deepEqual(yoldaOku(fs), [p]);
  const ikinci = kur({ ha: () => new Promise(() => {}), fs });
  assert.equal(ikinci.kesici.dogrulanamadiMi(p), false);
  hataTuru(ikinci.istemci.haIstek('/api/states/light.a'));
  await akit();
  assert.equal(ikinci.kimlikliler().length, 1);
  const ucuncu = kur({ ha: () => json({}, 401), fs });
  assert.equal(ucuncu.kesici.dogrulanamadiMi(p), true);
  assert.equal(await hataTuru(ucuncu.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(ucuncu.cagrilar.length, 0);
});

test('(tur6-P1) işaret her kesin sonuçta silinir: 200 doğrulama, 401, gönderim öncesi ağ hatası, yanıt başlığı (403/404/500) ve zaman aşımı (belirsiz sayaca döner)', async () => {
  const p = yetkiKesiciOlustur({}).parmakIzi(ANAHTAR);
  for (const [ad, ha, beklenen] of [
    ['200', API_CALISIYOR, 'basarili'],
    ['401', () => json({}, 401), 'yetki'],
    ['403', () => json({}, 403), 'yasak-erisim'],
    ['404', () => json({}, 404), 'sunucu'],
    ['500', () => new Response('x', { status: 500 }), 'sunucu'],
    ['200 ama HA değil', () => json({ x: 1 }), 'sunucu'],
    ['ağ hatası (gönderim öncesi)', () => { throw baglantiReddi(); }, 'baglanti'],
  ]) {
    const fs = sahteFs();
    const o = kur({ ha, fs });
    assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), beklenen, ad);
    assert.deepEqual(yoldaOku(fs), [], `${ad}: işaret silindi`);
  }
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const fs = sahteFs();
    const o = kur({ ha: () => new Promise(() => {}), fs });
    const s = hataTuru(o.istemci.haIstek('/api/states/light.a'));
    await akit();
    assert.deepEqual(yoldaOku(fs), [p]);
    mock.timers.tick(30_000);
    assert.equal(await s, 'belirsiz');
    assert.deepEqual(yoldaOku(fs), [], 'zaman aşımında işaret belirsiz sayaca döndü');
    assert.equal(o.kesici.belirsizSayisi(p), 1);
  } finally {
    mock.timers.reset();
  }
});

test('(tur6-P1) taze doğrulamadan sonraki kimlikli istekler işaret/diske yazmaz (yalnız doğrulama ve doğrulanmamış istekler)', async () => {
  const fs = sahteFs();
  const o = kur({ ha: GECERLI_HA, fs });
  await o.istemci.haIstek('/api/states/light.a'); // doğrulama + istek
  let yazim = 0;
  const yaz = fs.writeFileSync;
  fs.writeFileSync = (...a) => {
    yazim += 1;
    return yaz(...a);
  };
  for (let i = 0; i < 5; i += 1) await o.istemci.haIstek(`/api/states/light.l${i}`);
  assert.equal(yazim, 0, 'taze doğrulama varken disk yazımı yok');
});

test('(tur6-P1) işaret yazılamıyorsa istek ağa ÇIKMAZ: "kayit-yazilamadi" kapısı uygulanır', async () => {
  const fs = sahteFs();
  const o = kur({ ha: GECERLI_HA, fs });
  fs.writeFileSync = () => {
    throw new Error('EPERM');
  };
  assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'dogrulanamadi');
  assert.equal(o.kimlikliler().length, 0, 'işaret kaydedilemeyen deneme gönderilmez');
  assert.equal(o.kesici.onayDurumu(), 'kayit-yazilamadi');
  assert.equal(o.kesici.kayitSorunu(), 'yazilamadi');
});

test('(tur6-P1) WS: auth gönderildi, yanıt yok, süreç öldü: işaret kalıcıdır ve belirsiz sayılır (doğrulanmış anahtarda sınır 2); ikincisi de yarım kalırsa soket ve kimlikli istek 0', async () => {
  const fs = sahteFs();
  const o = wsKur({ ha: GECERLI_HA, fs });
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.equal(s.gonderilen.filter((m) => m.type === 'auth').length, 1);
  assert.deepEqual(yoldaOku(fs), [p], 'auth iletisinden ÖNCE işaret yazıldı');

  const ikinci = wsKur({ ha: GECERLI_HA, fs }); // süreç öldü; yeniden açılış
  assert.equal(ikinci.kesici.belirsizSayisi(p), 1, 'yanıtsız auth belirsiz deneme sayıldı');
  assert.equal(ikinci.kesici.iyiMi(p), true, 'doğrulanmış anahtar: sınır 2');
  assert.deepEqual(yoldaOku(fs), [], 'artakalan işaret belirsiz sayaca çevrildi');
});

test('(tur6-P1) WS: doğrulanmamış anahtarda artakalan işaretle yeniden açılış: soket ve kimlikli istek 0', async () => {
  const fs = sahteFs();
  const p = yetkiKesiciOlustur({}).parmakIzi(ANAHTAR);
  fs.dosyalar.set(DOSYA, JSON.stringify({ surum: 1, reddedilenler: [], yolda: [p] }));
  const o = wsKur({ ha: GECERLI_HA, fs });
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 0);
  assert.equal(o.cagrilar.length, 0);
  assert.equal(o.kesici.dogrulanamadiMi(p), true);
});

test('(tur6-P1) WS: auth_ok, auth_invalid ve yanıtsız kapanış işareti siler (kapanış belirsiz sayaca çevirir)', async () => {
  for (const son of ['auth_ok', 'auth_invalid', 'kapanis']) {
    const fs = sahteFs();
    const o = wsKur({ ha: GECERLI_HA, fs });
    const p = o.kesici.parmakIzi(ANAHTAR);
    o.ws.baslat();
    await akit();
    const s = o.soketler[0];
    s.yayinla({ type: 'auth_required' });
    await akit();
    assert.deepEqual(yoldaOku(fs), [p], son);
    if (son === 'kapanis') for (const fn of s.dinleyiciler.close ?? []) fn({});
    else s.yayinla({ type: son });
    assert.deepEqual(yoldaOku(fs), [], `${son}: işaret silindi`);
    if (son === 'kapanis') assert.equal(o.kesici.belirsizSayisi(p), 1);
  }
});

// --- tur 7 (K11): belirsiz denemeler de isteğin gittiği kökenin hata bütçesine girer ---------------------------------

const K5 = 'BESINCI_SAHTE_ANAHTAR_EEEEEEEEEEEEEE_0005';
const kokenSayaclari = (kesici) => ({ yerel: kesici.hataliDenemeSayisi('yerel'), dis: kesici.hataliDenemeSayisi('dis') });

test("(tur7-K11) HA ev içinde yavaş (isteği sayar, 15 sn içinde yanıt vermez) + 5 farklı aday art arda: 3. adaydan itibaren ikinci-onay; HA ev içi sayacı onaysız 2'yi geçmez", async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let yavas = true;
    let yerelSayac = 0;
    const o = kur({
      ha: (url) => {
        if (url.startsWith(YEREL)) yerelSayac += 1; // HA ev içinde bu hatalı denemeyi sayar
        return yavas ? new Promise(() => {}) : json({}, 401);
      },
    });
    const turler = [];
    for (const [sira, aday] of [K1, K2, K3, K4, K5].entries()) {
      if (sira === 3) yavas = false; // HA toparlandı
      const sonuc = o.istemci.anahtariDogrula(aday).then(() => 'basarili', (h) => h.tur);
      await akit();
      mock.timers.tick(15_000);
      turler.push(await sonuc);
    }
    assert.deepEqual(turler, ['belirsiz', 'belirsiz', 'ikinci-onay', 'ikinci-onay', 'ikinci-onay']);
    assert.equal(yerelSayac, 2, "HA ev içi sayacı onaysız 2'yi geçmedi");
    assert.deepEqual(kokenSayaclari(o.kesici), { yerel: 2, dis: 0 });
    assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('(tur7-K11) belirsiz sonuç isteğin gittiği kökenin bütçesine girer: zaman aşımı, gönderim sonrası kopma, 502/504/52x (ev içi ve dış adres)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const durumlar = [
      ['zaman aşımı', () => new Promise(() => {}), true],
      ['ECONNRESET', () => Promise.reject(baglantiSifirlandi()), false],
      ['502', () => new Response('<html>bad gateway</html>', { status: 502 }), false],
      ['524', () => new Response('<html>timeout</html>', { status: 524 }), false],
    ];
    for (const [ad, ha, zamanAsimi] of durumlar) {
      const yerel = kur({ ha });
      const a = hataTuru(yerel.istemci.haIstek('/api/states'));
      await akit();
      if (zamanAsimi) mock.timers.tick(15_000);
      assert.equal(await a, 'belirsiz', ad);
      assert.deepEqual(kokenSayaclari(yerel.kesici), { yerel: 1, dis: 0 }, `ev içi ${ad}`);

      const dis = kur({ ha, yoklama: yerelUlasilmaz });
      const b = hataTuru(dis.istemci.haIstek('/api/states'));
      await akit();
      if (zamanAsimi) mock.timers.tick(30_000);
      assert.equal(await b, 'belirsiz', ad);
      assert.deepEqual(kokenSayaclari(dis.kesici), { yerel: 0, dis: 1 }, `dış adres ${ad}`);
    }
  } finally {
    mock.timers.reset();
  }
});

test('(tur7-K11) WS: auth gönderildi, auth_ok/auth_invalid gelmeden soket koptu: bağlanılan kökenin bütçesi artar', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  o.ws.baslat();
  await akit();
  const s = o.soketler[0];
  s.yayinla({ type: 'auth_required' });
  await akit();
  assert.deepEqual(kokenSayaclari(o.kesici), { yerel: 0, dis: 0 });
  for (const fn of s.dinleyiciler.close ?? []) fn({});
  assert.deepEqual(kokenSayaclari(o.kesici), { yerel: 1, dis: 0 });

  const d = wsKur({ ha: GECERLI_HA, yoklama: yerelUlasilmaz });
  d.ws.baslat();
  await akit();
  d.soketler[0].yayinla({ type: 'auth_required' });
  await akit();
  for (const fn of d.soketler[0].dinleyiciler.close ?? []) fn({});
  assert.deepEqual(kokenSayaclari(d.kesici), { yerel: 0, dis: 1 });
});

test('(tur7-K11) kalıcı "yolda" işaretine köken yazılır; artakalan işaret açılışta o kökenin bütçesini 1 artırır (köken yoksa ikisini); yeniden yükleme tekrar saymaz', async () => {
  const p = yetkiKesiciOlustur({}).parmakIzi(ANAHTAR);
  mock.timers.enable({ apis: ['setTimeout'] }); // yanıtsız isteklerin gerçek zamanlayıcıları testi geciktirmesin
  try {
    // uçtan uca: ev içinde yanıtsız doğrulama, süreç ölür
    const fs = sahteFs();
    const ilk = kur({ ha: () => new Promise(() => {}), fs });
    hataTuru(ilk.istemci.haIstek('/api/states/light.a'));
    await akit();
    const kayit = JSON.parse(fs.dosyalar.get(DOSYA));
    assert.deepEqual(kayit.yolda, [p]);
    assert.deepEqual(kayit.yoldaKoken, { [p]: 'yerel' }, 'işarete köken de yazıldı');
    assert.ok(!fs.dosyalar.get(DOSYA).includes(ANAHTAR));
    const yeniden = kur({ ha: () => json({}, 401), fs });
    assert.deepEqual(kokenSayaclari(yeniden.kesici), { yerel: 1, dis: 0 });
    assert.deepEqual(JSON.parse(fs.dosyalar.get(DOSYA)).yolda, []);

    // dış adreste yanıtsız doğrulama
    const dfs = sahteFs();
    const dis = kur({ ha: () => new Promise(() => {}), yoklama: yerelUlasilmaz, fs: dfs });
    hataTuru(dis.istemci.haIstek('/api/states/light.a'));
    await akit();
    assert.deepEqual(JSON.parse(dfs.dosyalar.get(DOSYA)).yoldaKoken, { [p]: 'dis' });
    assert.deepEqual(kokenSayaclari(kur({ ha: () => json({}, 401), fs: dfs }).kesici), { yerel: 0, dis: 1 });
  } finally {
    mock.timers.reset();
  }

  // dosya düzeni: köken yok (eski biçimli işaret) ya da bozuk -> ikisine birden
  for (const [ad, ek, beklenen] of [
    ['yerel', { yolda: [p], yoldaKoken: { [p]: 'yerel' } }, { yerel: 1, dis: 0 }],
    ['dis', { yolda: [p], yoldaKoken: { [p]: 'dis' } }, { yerel: 0, dis: 1 }],
    ['eski biçim', { yolda: [p] }, { yerel: 1, dis: 1 }],
    ['bozuk köken', { yolda: [p], yoldaKoken: { [p]: 'baska' } }, { yerel: 1, dis: 1 }],
    ['bozuk köken nesnesi', { yolda: [p], yoldaKoken: [p] }, { yerel: 1, dis: 1 }],
  ]) {
    const f = sahteFs();
    f.dosyalar.set(DOSYA, JSON.stringify({ surum: 1, reddedilenler: [], ...ek }));
    const kesici = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs: f });
    kesici.yukle();
    assert.deepEqual(kokenSayaclari(kesici), beklenen, ad);
    assert.equal(kesici.belirsizSayisi(p), 1, ad);
    kesici.yukle(); // ikinci yükleme: işaret silinmişti, tekrar sayılmaz
    assert.deepEqual(kokenSayaclari(kesici), beklenen, `${ad}: ikinci yüklemede de aynı (diskten okunan sayaç)`);
  }
});

test('(tur7-K11) kesici birim: belirsizKaydet köken verilirse yalnız o kökeni, verilmezse ikisini artırır; çakışan yolda kökeni bilinmeyene döner; reddedilmiş anahtar sayaç artırmaz', () => {
  const kesici = yetkiKesiciOlustur({});
  const p = kesici.parmakIzi(ANAHTAR);
  const q = kesici.parmakIzi(YENI_ANAHTAR);
  kesici.belirsizKaydet(p, 'dis');
  assert.deepEqual(kokenSayaclari(kesici), { yerel: 0, dis: 1 });
  kesici.belirsizKaydet(q);
  assert.deepEqual(kokenSayaclari(kesici), { yerel: 1, dis: 2 }, 'köken bilinmiyorsa ikisi de');
  const f = sahteFs();
  const k2 = yetkiKesiciOlustur({ dosyaYolu: DOSYA, fs: f });
  k2.yukle();
  assert.equal(k2.yoldaBaslat(p, 'yerel'), true);
  assert.equal(k2.yoldaBaslat(p, 'dis'), true, 'aynı anahtar iki kökende yolda');
  assert.equal(JSON.parse(f.dosyalar.get(DOSYA)).yoldaKoken?.[p], undefined, 'köken bilinmiyor: yazılmaz (iki kökene birden sayılır)');
  k2.belirsizKaydet(p);
  assert.deepEqual(kokenSayaclari(k2), { yerel: 1, dis: 1 });
  const k3 = yetkiKesiciOlustur({});
  k3.reddet(p, 'HTTP_401', 'yerel');
  k3.belirsizKaydet(p, 'dis'); // zaten reddedilmiş: kimlikli istek çıkmamalıydı; sayaç oynamaz
  assert.deepEqual(kokenSayaclari(k3), { yerel: 1, dis: 0 });
});

// --- tur 7 (K11): sabit tohumlu rastgele senaryo testi ------------------------------------------------------------

/** Küçük, sabit tohumlu rastgele sayı üreteci (mulberry32). */
function tohumlu(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AG_MODLARI = ['ok', 'ok', 'refused', 'slow', 'reset', '403', '502'];

/**
 * Tek senaryo: ev içi ve dış adreste rastgele ağ durumları (bağlantı reddi, yavaş/yanıtsız, kopma, 403 ban, 502), REST GET/POST,
 * aday anahtar doğrulaması, canlı bağlantı, secimiSifirla, zaman ilerlemesi ve süreç ölüp yeniden açılması (yanıt gelmeden).
 * Sahte HA, anahtarı geçersiz olan her kimlikli isteği GÖNDERİLDİĞİ anda sayar (yanıt kaybolsa da sayılır).
 */
async function rastgeleSenaryo(tohum, { gecerliAnahtar = false } = {}) {
  const rnd = tohumlu(tohum);
  const sec = (dizi) => dizi[Math.floor(rnd() * dizi.length)];
  const dogrulanmisRnd = rnd() < 0.35;
  const dogrulanmis = gecerliAnahtar || dogrulanmisRnd; // 1.1.1'de doğrulanmış; (gecerliAnahtar yoksa) sonradan HA'da silinmiş anahtar
  const gecerli = new Set(dogrulanmis ? [ANAHTAR] : []);
  // Süreç başına zamanlayıcı yalıtımı (tur 9): her sürecin işlemleri kendi AsyncLocalStorage bağlamında çalışır; süreç ölünce o bağlamda
  // kurulmuş (ve sonradan kurulacak) tüm sahte zamanlayıcılar iptal edilir. Böylece ölü sürecin zaman aşımı zamanlayıcıları yeni sürecin
  // tick'leriyle ateşlenip diske yazmaya (ya da sayaç oynatmaya) çalışmaz: gerçek bir süreç ölümünü olduğu gibi temsil eder.
  const bag = new AsyncLocalStorage();
  const surecler = new Map(); // id -> { deger: ölü mü }
  const sahipli = new Map(); // id -> Set(zamanlayıcı)
  let surecSayaci = 0;
  const surecteCalis = (o, fn) => bag.run(o.id, fn);
  const ihlalListesi = []; // gecerliAnahtar: değişmez ihlalleri
  const restModu = gecerliAnahtar && rnd() < 0.5; // yalnız REST (canlı bağlantı kapalı): WS auth_ok sayaçları hiç sıfırlamaz
  const modlar = { [YEREL]: 'ok', [DIS]: 'ok' };
  const sayac = { [YEREL]: { saklı: 0, aday: 0 }, [DIS]: { saklı: 0, aday: 0 } }; // HA'nın köken başına saydığı hatalı deneme: saklı anahtar / aday anahtarlar
  const fs = sahteFs();
  let t = 0;
  let saklıAnahtar = ANAHTAR; // diskteki (saklı) anahtar; "belirsiz kalan aday kaydedilir" akışında (main.js anahtar:kaydet) adaya geçer
  let yenidenDeneSayisi = 0; // onaysız (bilet gerektirmeden) geçen "Yeniden Dene" sayısı: her biri TEK ek hak verir
  const oluYazma = { sayi: 0 }; // ölü sürecin fs'e yazma DENEMESİ: gerçek bir süreç ölüyken hiç yazamaz, sayı 0 olmalı
  let sayiyor = false; // doğrulanmış anahtar iptal edilene kadar sayma
  const say = (koken, anahtar) => {
    if (!sayiyor) return;
    sayac[koken][anahtar === ANAHTAR ? 'saklı' : 'aday'] += 1;
  };
  const surecKur = () => {
    const id = (surecSayaci += 1);
    const olu = { deger: false };
    surecler.set(id, olu);
    sahipli.set(id, new Set());
    return bag.run(id, () => surecKurIc(id, olu));
  };
  const surecKurIc = (id, olu) => {
    const sfs = {
      dosyalar: fs.dosyalar,
      existsSync: (y) => fs.existsSync(y),
      readFileSync: (y) => fs.readFileSync(y),
      writeFileSync: (y, v) => {
        if (olu.deger) oluYazma.sayi += 1; // ölü süreç diske yazmaz (yazma denemesi sayılır ve sonda 0 olduğu doğrulanır)
        else fs.writeFileSync(y, v);
      },
      renameSync: (a, b) => {
        if (olu.deger) oluYazma.sayi += 1;
        else fs.renameSync(a, b);
      },
      mkdirSync() {},
    };
    const o = wsKur({
      fs: sfs,
      anahtar: saklıAnahtar,
      simdi: () => t,
      ha: async (url, s) => {
        if (olu.deger) return new Promise(() => {});
        const koken = new URL(url).origin;
        const anahtar = String(s.headers.Authorization).replace('Bearer ', '');
        const mod = modlar[koken];
        if (mod === 'refused') throw baglantiReddi();
        if (mod === '403') return json({ message: 'ban' }, 403); // ban/Cloudflare engeli: HA kimliği işlemez
        const gecerliMi = gecerli.has(anahtar);
        if (!gecerliMi) say(koken, anahtar);
        if (mod === 'slow') return new Promise(() => {});
        if (mod === 'reset') throw baglantiSifirlandi();
        if (mod === '502') return new Response('x', { status: 502 });
        if (!gecerliMi) return json({}, 401);
        return url.endsWith('/api/') ? API_CALISIYOR() : json({});
      },
      yoklama: (url) => {
        if (olu.deger) return new Promise(() => {});
        const mod = modlar[new URL(url).origin];
        if (mod === 'refused') throw baglantiReddi();
        if (mod === 'slow') return new Promise(() => {});
        return mod === '403' ? new Response('', { status: 403 }) : new Response(HA_MANIFEST, { status: 200 });
      },
    });
    return { ...o, olu, id };
  };
  const surecOldur = (o) => {
    o.olu.deger = true; // süreç yanıt gelmeden öldü
    for (const h of sahipli.get(o.id)) globalThis.clearTimeout(h);
    sahipli.get(o.id).clear();
  };
  const wsSur = (o) => {
    for (const s of o.soketler) {
      const koken = new URL(s.url.replace(/^ws/, 'http')).origin;
      if (!s.basladi) {
        s.basladi = true;
        if (['refused', '403', '502'].includes(modlar[koken])) {
          s.readyState = 3;
          for (const fn of s.dinleyiciler.close ?? []) fn({});
          continue;
        }
        s.yayinla({ type: 'auth_required' });
      }
      const auth = s.gonderilen.find((m) => m.type === 'auth');
      if (auth && !s.yanitlandi) {
        s.yanitlandi = true;
        const gecerliMi = gecerli.has(auth.access_token);
        if (!gecerliMi) say(koken, auth.access_token);
        if (modlar[koken] === 'slow') continue;
        if (modlar[koken] === 'reset') {
          s.readyState = 3;
          for (const fn of s.dinleyiciler.close ?? []) fn({});
        } else s.yayinla({ type: gecerliMi ? 'auth_ok' : 'auth_invalid' });
      }
    }
  };
  // Zaman 1 sn'lik dilimlerle ilerler ve her dilimden sonra söz zincirleri boşalır (gerçekte her zamanlayıcı ayrı bir görevdir;
  // tek hamlede 200 sn atlamak zamanlayıcı sonuçlarının sırasını gerçek dışı karıştırır).
  const ilerle = async (o, ms, dilimMs = 1000) => {
    for (let kalan = ms; kalan > 0; kalan -= dilimMs) {
      const dilim = Math.min(dilimMs, kalan);
      t += dilim;
      mock.timers.tick(dilim);
      o.zaman.ilerle(dilim);
      await new Promise((coz) => setImmediate(coz));
    }
  };
  const dolas = async (o) => {
    await akit();
    wsSur(o);
    await akit();
    wsSur(o);
  };

  mock.timers.enable({ apis: ['setTimeout'] });
  const sahteSet = globalThis.setTimeout;
  const sahteTemizle = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = bag.getStore();
    if (id === undefined) return sahteSet(fn, ms, ...args);
    if (surecler.get(id).deger) {
      const bos = sahteSet(() => {}, 1); // ölü sürecin yeni zamanlayıcısı: hiç çalışmaz
      sahteTemizle(bos);
      return bos;
    }
    const h = sahteSet(AsyncLocalStorage.bind(fn), ms, ...args); // geri çağrı, kurulduğu sürecin bağlamında çalışır
    sahipli.get(id).add(h);
    return h;
  };
  try {
    let o = surecKur();
    if (dogrulanmis) {
      await surecteCalis(o, () => o.istemci.haIstek('/api/states')); // doğrulandı (kalıcı iyi işareti)
      if (!gecerliAnahtar) gecerli.delete(ANAHTAR); // anahtar HA'da silindi
    }
    sayiyor = true;
    const p = o.kesici.parmakIzi(ANAHTAR);
    // GEÇERLİ ANAHTAR değişmezi (tur 9, K14-K16): en az bir başarı almış geçerli anahtar, iki ardışık belirsiz (K2) dışında hiçbir zaman
    // (hata bütçesi, köken sayacı, Yeniden Dene geçmişi yüzünden) durmaz: 'dogrulanamadi' ve 'reddedildi' yok, güvenilmez kayıt kapısı yok.
    const gecerliDenetle = (ad) => {
      if (!gecerliAnahtar) return;
      if (o.kesici.reddedildiMi(p)) ihlalListesi.push(`${ad}: geçerli anahtar reddedildi`);
      if (o.kesici.onayDurumu()) ihlalListesi.push(`${ad}: kayıt kapısı kapandı (${o.kesici.onayDurumu()})`);
      if (o.kesici.dogrulanamadiMi(p) && o.kesici.belirsizSayisi(p) < EN_COK_BELIRSIZ_IYI) {
        ihlalListesi.push(`${ad}: geçerli anahtar ${o.kesici.belirsizSayisi(p)} belirsizle durdu (bütçe ${JSON.stringify(kokenSayaclari(o.kesici))})`);
      }
    };
    const adimlar = gecerliAnahtar ? 25 + Math.floor(rnd() * 30) : 6 + Math.floor(rnd() * 9); // geçerli anahtarda uzun kullanım: geçici hatalar birikebilsin
    for (let i = 0; i < adimlar; i += 1) {
      if (gecerliAnahtar) {
        // geçici kopmalar: bir adres kısa süre bozulur (yavaş/kopma/502), sonra düzelir; HA geçerli anahtarı hiç saymaz
        if (i % 2 === 0) {
          modlar[rnd() < 0.8 ? YEREL : DIS] = sec(['slow', 'reset', '502']);
          surecteCalis(o, () => o.istemci.haIstek('/api/states/light.gecici').catch(() => {}));
          await surecteCalis(o, () => ilerle(o, 16_000, 2000)); // yanıtsız istek zaman aşımına uğrar: belirsiz deneme (soğuma sürer, ikinci istek gitmez)
        } else {
          modlar[YEREL] = 'ok';
          modlar[DIS] = 'ok';
          await surecteCalis(o, () => ilerle(o, 61_000, 5000)); // soğuma biter
          surecteCalis(o, () => o.istemci.haIstek('/api/states/light.gecici').catch(() => {})); // başarılı yanıt: askıdakiler düşer
          await surecteCalis(o, () => dolas(o));
        }
      }
      const e = rnd();
      if (e < 0.22) {
        surecteCalis(o, () => {
          for (let j = 0, n = 1 + Math.floor(rnd() * 4); j < n; j += 1) o.istemci.haIstek(`/api/states/light.l${j}`).catch(() => {});
        });
      } else if (e < 0.28) surecteCalis(o, () => o.istemci.haIstek('/api/services/light/toggle', { yontem: 'POST', govde: {} }).catch(() => {}));
      else if (e < 0.45) {
        const aday = sec([K1, K2, K3, K4, K5]);
        // main.js anahtar:kaydet: reddedilmiş aday kaydedilmez; ikinci onay (bilet) verilmedi; 401 dışındaki hatalarda (belirsiz, ağ) aday yine KAYDEDİLİR
        if (!gecerliAnahtar && !o.kesici.reddedildiMi(o.kesici.parmakIzi(aday))) {
          const surec = o;
          surecteCalis(o, () =>
            o.istemci.anahtariDogrula(aday).catch((h) => {
              if (h?.tur === 'ikinci-onay' || h?.tur === 'yetki' || surec.olu.deger) return;
              saklıAnahtar = aday;
              surec.durum.anahtar = aday;
              surec.kesici.koru(surec.kesici.parmakIzi(aday));
            }),
          );
        }
      }
      else if (e < 0.56) {
        const baslat = rnd() < 0.5;
        if (!restModu) surecteCalis(o, () => (baslat ? o.ws.baslat() : o.ws.yenidenBaglan()));
      } else if (e < 0.63) surecteCalis(o, () => o.istemci.secimiSifirla());
      else if (e < 0.74) modlar[sec([YEREL, DIS])] = sec(AG_MODLARI);
      else if (e < 0.8) {
        // main.js yetki:yeniden-dene: bütçe >= 2 ise (doğrulanmış olsa da, K12a) bilet gerekir; bilet verilmez. Aksi halde TEK yeni hak.
        const pp = o.kesici.parmakIzi(saklıAnahtar);
        const gerek = o.kesici.onayGerekliMi(pp);
        if (!gerek || gerek.neden !== 'hata-butcesi') {
          yenidenDeneSayisi += 1;
          surecteCalis(o, () => {
            o.kesici.yenidenDene();
            o.istemci.disIzniVer(pp);
            if (!restModu) o.ws.yenidenBaglan();
            o.istemci.haIstek('/api/states').catch(() => {});
          });
        }
      } else if (e < 0.92) await surecteCalis(o, () => ilerle(o, sec([100, 3000, 8000, 16_000, 31_000, 61_000, 120_000])));
      else {
        surecOldur(o); // süreç yanıt gelmeden öldü
        o = surecKur();
      }
      await surecteCalis(o, () => dolas(o));
      gecerliDenetle(`tohum ${tohum} adım ${i}`);
    }
    for (let i = 0; i < 3; i += 1) {
      await surecteCalis(o, () => ilerle(o, 100_000));
      await surecteCalis(o, () => dolas(o));
      gecerliDenetle(`tohum ${tohum} son ${i}`);
    }
    if (gecerliAnahtar) {
      // ağ düzeldi (HA geçerli anahtarı kabul ediyor): iki ardışık belirsizle durmamışsa onaysız kimlikli istek gider, durum null kalır
      modlar[YEREL] = 'ok';
      modlar[DIS] = 'ok';
      await surecteCalis(o, () => ilerle(o, 20 * 60_000, 30_000)); // 403 duraklatması (15 dk) ve belirsiz soğuması bitsin
      await surecteCalis(o, () => dolas(o));
      if (o.kesici.belirsizSayisi(p) < EN_COK_BELIRSIZ_IYI) {
        const sonuc = await surecteCalis(o, async () => {
          const r = o.istemci.haIstek('/api/states/light.son').then(() => 'ok', (h) => h.tur);
          await akit();
          return r;
        });
        if (sonuc !== 'ok') ihlalListesi.push(`tohum ${tohum}: ağ düzelince geçerli anahtarla istek gitmedi (${sonuc}; bütçe ${JSON.stringify(kokenSayaclari(o.kesici))}, belirsiz ${o.kesici.belirsizSayisi(p)})`);
        gecerliDenetle(`tohum ${tohum} sonda`);
      }
    }
    return { dogrulanmis, sayac, yenidenDeneSayisi, oluYazma: oluYazma.sayi, ihlaller: ihlalListesi };
  } finally {
    globalThis.setTimeout = sahteSet;
    mock.timers.reset();
  }
}

const TOHUM_SAYISI = Number(process.env.YETKI_TOHUM_SAYISI) > 0 ? Number(process.env.YETKI_TOHUM_SAYISI) : 200; // yerelde 1500 ile de çalıştırılabilir

test("(tur7-K11, tur8-K12) rastgele senaryolar (varsayılan 200 sabit tohum, YETKI_TOHUM_SAYISI ile artar; Yeniden Dene ve 'belirsiz kalan aday kaydedilir' akışı dahil): ikinci onay (bilet) verilmeden tek kökende HA toplamı (saklı + aday) <= 4, saklı anahtar için <= sınır + Yeniden Dene; ölü süreç diske yazma denemesi 0", async () => {
  const ihlaller = [];
  for (let tohum = 1; tohum <= TOHUM_SAYISI; tohum += 1) {
    const { dogrulanmis, sayac, yenidenDeneSayisi, oluYazma } = await rastgeleSenaryo(tohum);
    const saklı = sayac[YEREL].saklı + sayac[DIS].saklı;
    // doğrulanmamış anahtar ilk belirsizlikte, doğrulanmış ikincisinde durur; her bütçe onaysız (< 2) "Yeniden Dene" TEK ek hak verir
    if (saklı > (dogrulanmis ? 2 : 1) + yenidenDeneSayisi) ihlaller.push(`tohum ${tohum}: saklı anahtar için HA ${saklı} deneme saydı (doğrulanmış=${dogrulanmis}, yeniden dene=${yenidenDeneSayisi})`);
    // açık ikinci onay (bilet) hiç verilmedi: tek kökende saklı + aday toplamı HA'nın 5 eşiğinin altında kalır
    for (const koken of [YEREL, DIS]) {
      const toplam = sayac[koken].saklı + sayac[koken].aday;
      if (toplam > 4) ihlaller.push(`tohum ${tohum}: ${koken} üzerinde HA toplam ${toplam} deneme saydı (saklı ${sayac[koken].saklı} + aday ${sayac[koken].aday}; ikinci onay verilmedi)`);
    }
    if (oluYazma !== 0) ihlaller.push(`tohum ${tohum}: ölü süreç fs'e ${oluYazma} kez yazmayı denedi`);
  }
  assert.deepEqual(ihlaller, []);
});

test("(tur9-K14, K15, K16) GEÇERLİ ANAHTAR değişmezi (rastgele senaryolar): anahtar HA'da geçerli kaldıkça rastgele ağ hataları, köken değişimleri, süreç ölümleri ve Yeniden Dene altında iki ardışık belirsiz (K2) dışında hiç durmaz; ağ düzelince onaysız istek gider; ölü süreç diske yazma denemesi 0", async () => {
  const ihlaller = [];
  for (let tohum = 1; tohum <= TOHUM_SAYISI; tohum += 1) {
    const { ihlaller: liste, oluYazma } = await rastgeleSenaryo(tohum, { gecerliAnahtar: true });
    ihlaller.push(...liste);
    if (oluYazma !== 0) ihlaller.push(`tohum ${tohum}: ölü süreç fs'e ${oluYazma} kez yazmayı denedi`);
  }
  assert.deepEqual(ihlaller.slice(0, 20), []);
});

// --- Tur 9 (K14, K16): geçerli anahtar HA yeniden başlatmalarında ve köken sayaçlarıyla kilitlenmez ---------------------------------------

test('(tur9-K14) 4 HA yeniden başlatma döngüsü (ev içi ret -> dış tünel 502 -> ev içi düzelir) GEÇERLİ anahtarla: dış sayaç şişmez, hiç durmaz, ikinci onay istemez, canlı bağlantı açılır', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let t = 0;
    let yerelAcik = true;
    const o = wsKur({
      simdi: () => t,
      ha: (url) => {
        if (url.startsWith(YEREL)) return yerelAcik ? GECERLI_HA(url) : Promise.reject(baglantiReddi());
        return new Response('<html>bad gateway</html>', { status: 502 }); // tünel: HA yeniden başlarken 502
      },
      yoklama: (url) => (url.startsWith(YEREL) && !yerelAcik ? Promise.reject(new TypeError('fetch failed')) : new Response(HA_MANIFEST, { status: 200 })),
    });
    const p = o.kesici.parmakIzi(ANAHTAR);
    await o.istemci.haIstek('/api/states/light.a'); // ilk başarı: doğrulanmış
    for (let dongu = 1; dongu <= 4; dongu += 1) {
      yerelAcik = false; // HA yeniden başlıyor
      o.istemci.secimiSifirla();
      t += 120_000;
      const dis = await hataTuru(o.istemci.haIstek('/api/states/light.a'));
      assert.equal(dis, 'belirsiz', `döngü ${dongu}: tünel 502 verdi`);
      assert.equal(o.kesici.hataliDenemeSayisi('dis'), 1, `döngü ${dongu}: dış adrese giden deneme askıda`);
      yerelAcik = true; // HA döndü
      o.istemci.secimiSifirla();
      t += 120_000;
      mock.timers.tick(120_000);
      assert.equal(await hataTuru(o.istemci.haIstek('/api/states/light.a')), 'basarili', `döngü ${dongu}: ev içi düzeldi, normal kullanım`);
      assert.deepEqual(kokenSayaclari(o.kesici), { yerel: 0, dis: 0 }, `döngü ${dongu}: başarıyla askıdakiler düştü`);
      assert.equal(o.kesici.dogrulanamadiMi(p), false);
      assert.equal(o.kesici.onayGerekliMi(p), null, 'ikinci onay gerekmez');
    }
    o.ws.baslat();
    await akit();
    assert.ok(o.soketler.length >= 1, 'canlı bağlantı açıldı');
    assert.ok(o.soketler.every((s) => s.url.startsWith('ws://192.168.1.10')), 'ev içi adreste');
  } finally {
    mock.timers.reset();
  }
});

test('(tur9-K16) {yerel: 0, dis: 4 kesin} + geçerli doğrulanmış anahtar evde: ön denetimler, REST ve canlı bağlantı onaysız çalışır (bütçe kararı yalnız hedef köken bilinirken ve yalnız onay sorusunda)', async () => {
  const o = wsKur({ ha: GECERLI_HA });
  const p = o.kesici.parmakIzi(ANAHTAR);
  o.kesici.dogrulandi(p);
  for (let i = 0; i < 4; i += 1) o.kesici.reddet(o.kesici.parmakIzi(`SAHTE_BASKA_${i}_${'X'.repeat(25)}`), 'HTTP_401', 'dis');
  assert.deepEqual(kokenSayaclari(o.kesici), { yerel: 0, dis: 4 });
  assert.equal(o.kesici.dogrulanamadiMi(p), false, 'durum özeti (main.js) kilit göstermez');
  assert.deepEqual(o.kesici.karar({ parmakIzi: p }), { izin: true }, 'köken bilinmeden ön denetim');
  assert.equal((await o.istemci.haIstek('/api/states/light.a')).entity_id, 'light.a');
  o.ws.baslat();
  await akit();
  assert.equal(o.soketler.length, 1, 'WS açıldı');
  o.soketler[0].yayinla({ type: 'auth_required' });
  await akit();
  assert.deepEqual(o.soketler[0].gonderilen[0], { type: 'auth', access_token: ANAHTAR });
  assert.equal(o.cagrilar.filter((c) => c.url.startsWith(DIS)).length, 0, 'dış adrese istek yok');
  // onay SORUSU köken bilinmiyorsa en yüksek sayacı kullanabilir (yalnız soru): aday kaydı ikinci onay ister
  assert.equal(o.kesici.onayGerekliMi(o.kesici.parmakIzi(YENI_ANAHTAR))?.neden, 'hata-butcesi');
  assert.equal(o.kesici.onayGerekliMi(o.kesici.parmakIzi(YENI_ANAHTAR), { koken: 'yerel' }), null, 'ev içine gidecek aday: ev içi sayaç 0');
});
