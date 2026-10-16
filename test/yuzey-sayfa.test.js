'use strict';

/**
 * Hızlı panel / palet sayfasının betiği (src/yuzey-sayfa.js) minik bir SAHTE DOM ile çalıştırılır: gerçek tarayıcı, Electron ya da
 * pencere YOK (test/ayarlar-arayuz.test.js ile aynı yaklaşım). Zamanlayıcılar ve Date sahtedir: "0,8 sn basılı tut" gibi süreler
 * milisaniye milisaniye sınanır. Amaç: HTML kimlikleriyle betiğin uyumu, modelin yalnız textContent ile çizilmesi, yıkıcı
 * eylemin YALNIZ basılı tutmayla istenmesi ve renderer'ın onayı kendi başına bildirememesi.
 * Görsel görünüm (CSS) burada denenmez; o elle denenir (README).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(KOK, 'src', 'yuzey.html'), 'utf8');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const DIL = oku('src/lib/dil.js');
const SOZLUK = oku('src/lib/ceviri/yuzey.js');
const ARAMA = oku('src/lib/arama.js');
const KAYDIRICI = oku('src/lib/kaydirici.js');
const BETIK = oku('src/yuzey-sayfa.js');
const BILGI_BICIM = oku('src/lib/bilgi-bicim.js');
const GRAFIK = oku('src/lib/grafik.js');
const YUZEY_BILGI = oku('src/yuzey-bilgi.js');

class SahteOge {
  /** `odak`: sayfanın { aktif } kaydı (document.activeElement); focus() buraya yazar, DOM'dan çıkarılan odaklı öğe odağı yitirir. */
  constructor(etiket = 'div', kimlik = null, odak = { aktif: null }) {
    this.etiket = etiket;
    this.id = kimlik;
    this.odak = odak;
    this.children = [];
    this.dinleyiciler = {};
    this.style = {};
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.offsetHeight = 0;
    this.scrollTop = 0;
    this.title = '';
    this.type = '';
    this.tabIndex = 0;
    this._deger = '';
    this._metin = '';
    this.odakSayisi = 0;
    const kap = this;
    this.classList = {
      add: (c) => {
        if (!kap.className.split(' ').includes(c)) kap.className = `${kap.className} ${c}`.trim();
      },
      remove: (c) => {
        kap.className = kap.className.split(' ').filter((x) => x && x !== c).join(' ');
      },
      contains: (c) => kap.className.split(' ').includes(c),
    };
  }

  get value() {
    return this._deger;
  }

  set value(deger) {
    this._deger = String(deger);
  }

  get textContent() {
    return this._metin + this.children.map((c) => c.textContent).join('');
  }

  set textContent(deger) {
    this._metin = String(deger);
    this.children = [];
  }

  appendChild(cocuk) {
    this.children.push(cocuk);
    return cocuk;
  }

  replaceChildren(...cocuklar) {
    // gerçek DOM gibi: odaktaki öğe ağaçtan çıkarsa odak gövdeye (null) düşer
    const eskiler = this.bul(() => true);
    if (this.odak.aktif && eskiler.includes(this.odak.aktif) && !cocuklar.some((c) => c === this.odak.aktif || c.bul((x) => x === this.odak.aktif).length)) this.odak.aktif = null;
    this._metin = '';
    this.children = [];
    this.scrollTop = 0; // içerik geçici olarak boşalınca tarayıcı kaydırmayı sıfırlayabilir: sayfa kendi konumunu geri vermeli
    for (const c of cocuklar) this.appendChild(c);
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = deger;
  }

  getAttribute(ad) {
    return this.attributes[ad] ?? null;
  }

  removeAttribute(ad) {
    delete this.attributes[ad];
  }

  addEventListener(ad, isleyici) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
  }

  focus() {
    this.odakSayisi += 1;
    this.odak.aktif = this;
  }

  scrollIntoView() {}

  /** Olay gönderir; dinleyiciler olay nesnesini alır. */
  gonder(tip, ek = {}) {
    const olay = { type: tip, target: this, preventDefault() { this.onlendi = true; }, ...ek };
    for (const isleyici of this.dinleyiciler[tip] ?? []) isleyici(olay);
    return olay;
  }

  bul(kosul, sonuc = []) {
    for (const c of this.children) {
      if (kosul(c)) sonuc.push(c);
      c.bul(kosul, sonuc);
    }
    return sonuc;
  }
}

/** Sahte zaman: setTimeout kuyruğu + Date.now; ilerle(ms) sırayla çalıştırır. */
function sahteZaman() {
  let t = 1_000_000;
  let sonId = 0;
  const bekleyenler = new Map();
  const SahteDate = class extends Date {
    static now() {
      return t;
    }
  };
  return {
    SahteDate,
    setTimeout(fn, ms = 0) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
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
  };
}

const karo = (id, etiket, ek = {}) => ({
  id,
  etiket,
  grup: 'diger',
  grupEtiketi: 'Diğer',
  altGrup: null,
  alan: id.split('.')[0],
  durum: 'kapali',
  yuzde: null,
  kullanilabilir: true,
  ulasilamiyor: false,
  sinif: 'zararsiz',
  parlaklikKontrol: false,
  tekrar: false,
  ...ek,
});
const ISIK = karo('light.led_serit', 'LED şerit', { grup: 'isik', grupEtiketi: 'Işık', durum: 'acik', yuzde: 60, parlaklikKontrol: true });
const AMPUL = karo('light.ampul', 'Ampul', { grup: 'isik', grupEtiketi: 'Işık' });
const SAHNE = karo('scene.film', 'Film', { grup: 'sahne', grupEtiketi: 'Sahne', durum: 'notr' });
const SES_ARTIR = karo('button.pc_mediavolumeup', 'Ses +', { grup: 'medya', grupEtiketi: 'Medya', altGrup: 'ses', durum: 'notr', tekrar: true });
const PC_KAPAT = karo('button.pc_bilgisayari_kapat', 'PC kapat', { grup: 'pc', grupEtiketi: 'PC', sinif: 'yikici', durum: 'notr' });
const MODEL = {
  gruplar: [
    { kod: 'isik', etiket: 'Işık', karolar: [ISIK, AMPUL] },
    { kod: 'sahne', etiket: 'Sahne', karolar: [SAHNE] },
    { kod: 'pc', etiket: 'PC', karolar: [PC_KAPAT] },
    { kod: 'medya', etiket: 'Medya', karolar: [SES_ARTIR] },
  ],
  sonlar: [SAHNE],
  ust: { canli: true, baglanti: 'canli', medyaCaliyor: true, aktifCikis: 'kulaklik', hata: null },
};

/**
 * `calistirYaniti`: sabit yanıt ya da (yuk) => yanıt/söz. `aramaYama`: lib/arama.js yüklendikten sonra EvArama üzerinde çalışır (örn. paletSorgusu sonucuna alan eklemek).
 * `dil`: durumAl yanıtındaki etkin arayüz dili (verilmezse yanıtta yoktur: sayfa Türkçe kalır). Sayfadaki data-i18n / data-i18n-attr
 * öğeleri HTML'den okunur (document.querySelectorAll), böylece sayfayiCevir gerçek sayfadaki gibi çalışır.
 */
function sayfayiKur({ model = MODEL, mod = 'panel', calistirYaniti = { ok: true }, malzeme, aramaYama, dil, okuYaniti = (istek) => ({ ok: true, veri: istek.tur === 'gecmis' ? {} : [] }), bildirimYaniti = { ok: true } } = {}) {
  const odak = { aktif: null };
  const ogeler = new Map();
  for (const [, kimlik] of HTML.matchAll(/\bid="([^"]+)"/g)) {
    ogeler.set(kimlik, new SahteOge(new RegExp(`<(\\w+)[^>]*\\bid="${kimlik}"`).exec(HTML)?.[1] ?? 'div', kimlik, odak));
  }
  // data-i18n / data-i18n-attr taşıyan HTML öğeleri: özniteliklerle birlikte (kimliği olan, yukarıdaki öğeyle aynı nesnedir)
  const ceviriOgeleri = [];
  for (const [, etiket, nitelikMetni, icMetin] of HTML.matchAll(/<(\w+)\b([^>]*\bdata-i18n(?:-attr)?="[^>]*)>([^<]*)/g)) {
    const nitelikler = Object.fromEntries([...nitelikMetni.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const oge = (nitelikler.id && ogeler.get(nitelikler.id)) || new SahteOge(etiket, nitelikler.id ?? null, odak);
    Object.assign(oge.attributes, nitelikler);
    if ('data-i18n' in nitelikler) oge.textContent = icMetin; // HTML'deki Türkçe varsayılan metin
    ceviriOgeleri.push(oge);
  }
  const zaman = sahteZaman();
  const cagrilar = [];
  let durumDinleyici = null;
  let gosterDinleyici = null;
  let dilDinleyici = null;
  const kopru = {
    durumAl: async () => ({ ok: true, mod, model, ...(malzeme !== undefined ? { malzeme } : {}), ...(dil !== undefined ? { dil } : {}) }),
    onDurum: (cb) => {
      durumDinleyici = cb;
      return () => {};
    },
    onGoster: (cb) => {
      gosterDinleyici = cb;
      return () => {};
    },
    onDilDegisti: (cb) => {
      dilDinleyici = cb;
      return () => {};
    },
    calistir: async (yuk) => {
      cagrilar.push(['calistir', JSON.parse(JSON.stringify(yuk))]);
      return typeof calistirYaniti === 'function' ? calistirYaniti(yuk) : calistirYaniti;
    },
    basiliBasla: async (kimlik) => {
      cagrilar.push(['basiliBasla', kimlik]);
      return { ok: true };
    },
    basiliBirak: async (kimlik) => {
      cagrilar.push(['basiliBirak', kimlik]);
      return { ok: true };
    },
    // 1.4.0 okuma ucu (geçmiş, takvim, yapılacaklar): yanıtı okuYaniti belirler
    oku: async (istek) => {
      cagrilar.push(['oku', JSON.parse(JSON.stringify(istek))]);
      return typeof okuYaniti === 'function' ? okuYaniti(istek) : okuYaniti;
    },
    bildirimKapat: async (anahtar) => {
      cagrilar.push(['bildirimKapat', anahtar]);
      return typeof bildirimYaniti === 'function' ? bildirimYaniti(anahtar) : bildirimYaniti;
    },
    kapat: () => cagrilar.push(['kapat']),
    boyut: (h) => cagrilar.push(['boyut', h]),
    haAc: async () => cagrilar.push(['haAc']),
    ayarlarAc: async () => cagrilar.push(['ayarlarAc']),
  };
  const belgeDinleyicileri = {};
  const pencereDinleyicileri = {};
  const govde = { className: '' };
  const kok = { dataset: {}, nitelikler: {}, setAttribute: (ad, deger) => (kok.nitelikler[ad] = deger) }; // <html>: data-malzeme (gorunum-11), lang
  const belge = {
    nodeType: 9,
    documentElement: kok,
    querySelectorAll: (secici) => ceviriOgeleri.filter((o) => (secici === '[data-i18n]' ? 'data-i18n' in o.attributes : 'data-i18n-attr' in o.attributes)),
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `yuzey.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket, null, odak),
    createElementNS: (adAlani, etiket) => new SahteOge(etiket, null, odak), // grafikler (lib/grafik.js svgOlustur)
    addEventListener: (ad, fn) => (belgeDinleyicileri[ad] ??= []).push(fn),
    get activeElement() {
      return odak.aktif;
    },
    body: govde,
  };
  const sandbox = {
    document: belge,
    setTimeout: (fn, ms) => zaman.setTimeout(fn, ms),
    clearTimeout: (id) => zaman.clearTimeout(id),
    Date: zaman.SahteDate,
    evYuzey: kopru,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (ad, fn) => (pencereDinleyicileri[ad] ??= []).push(fn);
  vm.createContext(sandbox);
  vm.runInContext(DIL, sandbox, { filename: 'lib/dil.js' });
  vm.runInContext(SOZLUK, sandbox, { filename: 'lib/ceviri/yuzey.js' });
  vm.runInContext(ARAMA, sandbox, { filename: 'lib/arama.js' });
  if (aramaYama) aramaYama(sandbox.EvArama);
  vm.runInContext(KAYDIRICI, sandbox, { filename: 'lib/kaydirici.js' });
  vm.runInContext(BILGI_BICIM, sandbox, { filename: 'lib/bilgi-bicim.js' });
  vm.runInContext(GRAFIK, sandbox, { filename: 'lib/grafik.js' });
  vm.runInContext(YUZEY_BILGI, sandbox, { filename: 'yuzey-bilgi.js' });
  vm.runInContext(BETIK, sandbox, { filename: 'yuzey-sayfa.js' });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    zaman,
    govde,
    kok,
    /** document.activeElement */
    odakta: () => odak.aktif,
    odakVer: (oge) => oge.focus(),
    /** Ana sürecin 'yuzey:goster' / 'yuzey:durum' iletileri */
    goster: (kip, malzemeAdi) => gosterDinleyici({ mod: kip, ...(malzemeAdi !== undefined ? { malzeme: malzemeAdi } : {}) }),
    durum: (yeniModel) => durumDinleyici(yeniModel),
    /** Ana sürecin 'dil:degisti' iletisi */
    dilDegisti: (yuk) => dilDinleyici(yuk),
    /** <title> öğesi (data-i18n ile çevrilir) */
    htmlBasligi: () => ceviriOgeleri.find((o) => o.etiket === 'title'),
    belgeOlayi: (tip, ek) => {
      const olay = { type: tip, preventDefault() { this.onlendi = true; }, ...ek };
      (belgeDinleyicileri[tip] ?? []).forEach((fn) => fn(olay));
      return olay;
    },
    pencereOlayi: (tip) => (pencereDinleyicileri[tip] ?? []).forEach((fn) => fn({ type: tip })),
    calistirmalar: () => cagrilar.filter((c) => c[0] === 'calistir').map((c) => c[1]),
    okumalar: () => cagrilar.filter((c) => c[0] === 'oku').map((c) => c[1]),
  };
}

const akit = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((coz) => setImmediate(coz));
};
const dugmeBul = (sayfa, metin) => sayfa.oge('icerik').bul((o) => o.etiket === 'button' && o.textContent.startsWith(metin) && !o.className.includes('hazir'))[0];
const hazirBul = (sayfa, metin) => sayfa.oge('icerik').bul((o) => o.className.split(' ').includes('hazir') && o.textContent === metin)[0];
const paletSatirlari = (sayfa) => sayfa.oge('icerik').bul((o) => o.className.split(' ').includes('palet-satir'));
const etiketler = (sayfa) => sayfa.oge('icerik').bul((o) => o.className === 'karo-etiket').map((o) => o.textContent);

async function panelAc(secenek) {
  const sayfa = sayfayiKur(secenek);
  await akit();
  sayfa.goster('panel');
  return sayfa;
}

async function paletAc(secenek) {
  const sayfa = sayfayiKur({ ...secenek, mod: 'palet' });
  await akit();
  sayfa.goster('palet');
  return sayfa;
}

// --- panel -------------------------------------------------------------------------------

test('panel: kimlikler HTML ile uyumlu; gruplar, "Son kullanılanlar", bağlantı ve medya şeridi çizilir', async () => {
  const sayfa = await panelAc();
  assert.equal(sayfa.govde.className, 'mod-panel');
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı');
  assert.equal(sayfa.oge('baglanti').className, 'baglanti canli');
  assert.equal(sayfa.oge('medya').hidden, false);
  assert.equal(sayfa.oge('medya').textContent, '♪ Çalıyor · Kulaklık');
  const baslıklar = sayfa.oge('icerik').bul((o) => o.className === 'bolum-baslik').map((o) => o.textContent);
  assert.deepEqual(baslıklar, ['Son kullanılanlar', 'Işık', 'Sahne', 'PC', 'Medya']);
  assert.deepEqual(etiketler(sayfa), ['LED şerit', 'Ampul', 'Film', 'PC kapat', 'Ses +']);
});

test('panel: model boşsa "Henüz favori yok" yazar; bozuk model çizimi bozmaz', async () => {
  const sayfa = await panelAc({ model: { gruplar: [], sonlar: [], ust: {} } });
  assert.match(sayfa.oge('icerik').textContent, /Henüz favori yok/);
  sayfa.durum({ gruplar: 'bozuk' });
  sayfa.durum(null);
  sayfa.durum({ gruplar: [{ karolar: [{ etiket: 'idsiz' }, null] }], sonlar: 5, ust: 7 });
  assert.match(sayfa.oge('icerik').textContent, /Henüz favori yok/);
});

test('panel: karo metinleri yalnız textContent ile yazılır (zararlı ad etiket olmaz); bilinmeyen durum "yok" sayılır', async () => {
  const zararli = karo('light.x', '<img src=x onerror=alert(1)>', { durum: 'bilinmeyen' });
  const sayfa = await panelAc({ model: { gruplar: [{ kod: 'isik', etiket: 'Işık', karolar: [zararli] }], sonlar: [], ust: {} } });
  const etiket = sayfa.oge('icerik').bul((o) => o.className === 'karo-etiket')[0];
  assert.equal(etiket.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(sayfa.oge('icerik').bul((o) => o.etiket === 'img').length, 0);
  assert.ok(dugmeBul(sayfa, '<img').className.includes('durum-yok'));
});

test('panel: zararsız karoya tıklamak tek istek gönderir; yanıt onay-gerekli ise basılı tutma ipucu gösterilir', async () => {
  const sayfa = await panelAc({ calistirYaniti: { ok: false, tur: 'onay-gerekli' } });
  dugmeBul(sayfa, 'Ampul').gonder('click', { detail: 1 });
  await akit();
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.ampul' }]);
  assert.match(sayfa.oge('ipucu').textContent, /basılı tutun/);
  sayfa.zaman.ilerle(3000);
  assert.equal(sayfa.oge('ipucu').textContent, '', 'ipucu kısa sürede silinir');
});

test('ışık karosu: hazır seviyeler son değerle gider; kaydırıcı sürüklenirken kısılır, bırakınca son değer beklemeden gider', async () => {
  const sayfa = await panelAc();
  const hazirlar = sayfa.oge('icerik').bul((o) => o.className.split(' ').includes('hazir'));
  assert.deepEqual(hazirlar.map((h) => h.textContent), ['%10', '%20', '%50', '%100'], 'hiz-09: hazır seviyeler');
  assert.deepEqual(hazirlar.filter((h) => h.className.split(' ').includes('vurgu')).map((h) => h.textContent), ['%50'], 'g-02: vurgu ışığın o anki seviyesine (%60) en yakın düğmede, sabit %20\'de değil');
  assert.deepEqual(hazirlar.filter((h) => h.className.split(' ').includes('sik')).map((h) => h.textContent), ['%20'], 'g-02: "sık kullanılan" işareti ayrı ve yalnız %20\'de');
  hazirBul(sayfa, '%20').gonder('click');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 20, sonDeger: true }]);

  const aralik = sayfa.oge('icerik').bul((o) => o.type === 'range')[0];
  assert.equal(aralik.value, '60', 'kaydırıcı mevcut parlaklıkla başlar');
  assert.equal(aralik.attributes['aria-label'], 'LED şerit parlaklığı');
  const once = sayfa.calistirmalar().length;
  for (const v of [61, 62, 63, 64]) {
    aralik.value = v;
    aralik.gonder('input');
  }
  assert.equal(sayfa.calistirmalar().length - once, 1, 'ilk değer hemen, kalanlar 200 ms pencerede birikir');
  sayfa.zaman.ilerle(150);
  aralik.value = 70;
  aralik.gonder('change');
  const son = sayfa.calistirmalar().at(-1);
  assert.deepEqual(son, { kimlik: 'light.led_serit', parlaklik: 70, sonDeger: true });
});

test('ışık kaydırıcısı: sürükleme sırasında change gelmeden blur/pointerup olursa donuk kilidi çözülür', async () => {
  const sayfa = await panelAc();
  const aralik = sayfa.oge('icerik').bul((o) => o.type === 'range')[0];
  aralik.value = 80;
  aralik.gonder('input');
  sayfa.pencereOlayi('blur');
  sayfa.durum({ ...MODEL, sonlar: [] });
  await akit();
  const sonlar = sayfa.oge('icerik').bul((o) => o.className.split(' ').includes('son-sira'));
  assert.equal(sonlar.length, 0, 'donuk kilidi çözüldü ve model uygulandı');
});

test('yıkıcı karo: düz tıklama HİÇBİR istek göndermez; basılı tutma başlayınca yalnız "başladı" bildirilir, istek ~0,8 sn sonra basili:true ile gider', async () => {
  const sayfa = await panelAc();
  const d = dugmeBul(sayfa, 'PC kapat');
  assert.ok(d.className.includes('yikici'));
  d.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar(), []);

  d.gonder('pointerdown', { button: 0 });
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'basiliBasla'), [['basiliBasla', 'button.pc_bilgisayari_kapat']]);
  assert.ok(d.className.includes('basili'), 'ilerleme görseli');
  sayfa.zaman.ilerle(799);
  assert.deepEqual(sayfa.calistirmalar(), [], '0,8 sn dolmadan istek yok');
  sayfa.zaman.ilerle(2);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }]);
  assert.equal(d.className.includes('basili'), false);
});

test('yıkıcı karo: süre dolmadan bırakma, imleç dışarı çıkma ve pencere odağını kaybetme isteği İPTAL eder', async () => {
  const sayfa = await panelAc();
  for (const iptalOlayi of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) {
    const d = dugmeBul(sayfa, 'PC kapat');
    d.gonder('pointerdown', { button: 0 });
    sayfa.zaman.ilerle(400);
    d.gonder(iptalOlayi);
    sayfa.zaman.ilerle(2000);
    assert.deepEqual(sayfa.calistirmalar(), [], `${iptalOlayi}: istek gitmemeli`);
  }
  const d = dugmeBul(sayfa, 'PC kapat');
  d.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(300);
  sayfa.pencereOlayi('blur');
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'pencere odağı kaybedince tutma bırakılır');
  d.gonder('pointerdown', { button: 2 }); // sağ tuş tutmayı başlatmaz
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), []);
});

test('yıkıcı karo: klavyede Enter basılı tutma ile çalışır, otomatik tekrar eden keydown tutmayı yeniden başlatmaz', async () => {
  const sayfa = await panelAc();
  const d = dugmeBul(sayfa, 'PC kapat');
  d.gonder('keydown', { key: 'Enter', repeat: false });
  d.gonder('keydown', { key: 'Enter', repeat: true });
  d.gonder('keydown', { key: 'Enter', repeat: true });
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'basiliBasla').length, 1);
  sayfa.zaman.ilerle(900);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }]);
});

test('ses +/- karosu: basılı tutunca tekrarlar (hemen, 400 ms sonra, sonra 250 ms aralıkla), bırakınca durur; tutarken gelen model çizimi erteler', async () => {
  const sayfa = await panelAc();
  const d = dugmeBul(sayfa, 'Ses +');
  d.gonder('pointerdown', { button: 0 });
  assert.equal(sayfa.calistirmalar().length, 1);
  sayfa.zaman.ilerle(399);
  assert.equal(sayfa.calistirmalar().length, 1);
  sayfa.zaman.ilerle(2);
  assert.equal(sayfa.calistirmalar().length, 2);
  sayfa.zaman.ilerle(250);
  assert.equal(sayfa.calistirmalar().length, 3);

  // tutarken yeni model gelir: düğme yok edilmez (aksi halde "bırakıldı" olayı hiç gelmezdi)
  sayfa.durum({ ...MODEL, gruplar: MODEL.gruplar.slice(0, 1) });
  assert.equal(dugmeBul(sayfa, 'Ses +'), d, 'çizim ertelendi');
  d.gonder('pointerup');
  const sayi = sayfa.calistirmalar().length;
  sayfa.zaman.ilerle(2000);
  assert.equal(sayfa.calistirmalar().length, sayi, 'bırakınca tekrar durdu');
  assert.equal(dugmeBul(sayfa, 'Ses +'), undefined, 'bırakınca bekleyen model çizildi');
  assert.ok(dugmeBul(sayfa, 'LED şerit'));

  const klavye = await panelAc();
  dugmeBul(klavye, 'Ses +').gonder('click', { detail: 0 }); // klavye ile etkinleştirme: tek basış
  assert.equal(klavye.calistirmalar().length, 1);
});

test('panel: Esc kapatır; "HA\'yı aç" ve "Ayarlar" ilgili köprü işlevini çağırır; yükseklik ana sürece bildirilir', async () => {
  const sayfa = await panelAc();
  sayfa.oge('kok').offsetHeight = 333;
  sayfa.goster('panel');
  sayfa.zaman.ilerle(5);
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'boyut'), [['boyut', 333]]);
  sayfa.belgeOlayi('keydown', { key: 'Escape' });
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1);
  sayfa.oge('haAc').gonder('click');
  sayfa.oge('ayarlarAc').gonder('click');
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'haAc'), true);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'ayarlarAc'), true);
});

test('panel: bağlantı yedek moddayken durum şeridi bunu söyler', async () => {
  const sayfa = await panelAc({ model: { ...MODEL, ust: { canli: false, baglanti: 'yedek', medyaCaliyor: false, aktifCikis: null, hata: null } } });
  assert.match(sayfa.oge('baglanti').textContent, /Yedek mod/);
  assert.equal(sayfa.oge('medya').hidden, true);
});

test('panel: yetki kesici uyarısı (anahtar reddedildi) başlığın ALTINDAKİ şeritte görünür, bağlantı metnini ezmez (g-03); uyarı kalkınca şerit gizlenir', async () => {
  const uyarili = await panelAc({ model: { ...MODEL, ust: { canli: false, baglanti: 'yedek', medyaCaliyor: false, aktifCikis: null, hata: null, uyari: 'Erişim anahtarı reddedildi' } } });
  assert.equal(uyarili.oge('serit').hidden, false);
  assert.equal(uyarili.oge('serit').textContent, '!Erişim anahtarı reddedildi');
  assert.match(uyarili.oge('baglanti').textContent, /^Yedek mod/, 'başlık satırı kısa kalır: uyarı metni başlığa yazılmaz');
  assert.equal(uyarili.oge('baglanti').className, 'baglanti yedek');
  const normal = await panelAc({ model: { ...MODEL, ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null, uyari: null } } });
  assert.equal(normal.oge('baglanti').textContent, 'Canlı');
  assert.equal(normal.oge('baglanti').className, 'baglanti canli');
  assert.equal(normal.oge('serit').hidden, true);
  uyarili.durum({ ...MODEL, ust: { canli: true, baglanti: 'canli', medyaCaliyor: false, aktifCikis: null, hata: null, uyari: null } });
  assert.equal(uyarili.oge('serit').hidden, true, 'uyarı kalkınca şerit gizlenir');
  assert.equal(uyarili.oge('serit').textContent, '');
});

// --- palet -------------------------------------------------------------------------------

test('palet: açılışta arama kutusu odak alır, boş sorguda "Son kullanılanlar" görünür; panel gövdesi sınıfı mod-palet olur', async () => {
  const sayfa = await paletAc();
  assert.equal(sayfa.govde.className, 'mod-palet');
  assert.ok(sayfa.oge('arama').odakSayisi >= 1);
  assert.match(sayfa.oge('icerik').textContent, /Son kullanılanlar/);
  assert.match(sayfa.oge('icerik').textContent, /Favoriler/, 'k-08: son kullanılanların altında bütün favoriler');
  const tumu = MODEL.gruplar.reduce((n, g) => n + g.karolar.length, 0);
  assert.equal(paletSatirlari(sayfa).length, tumu, 'son kullanılan bir kez, kalan bütün favoriler altında');
  const bosSon = await paletAc({ model: { ...MODEL, sonlar: [] } });
  assert.equal(paletSatirlari(bosSon).length, tumu, '"Son" yoksa bütün favoriler gösterilir');
  assert.doesNotMatch(bosSon.oge('icerik').textContent, /Son kullanılanlar/);
  assert.match(bosSon.oge('icerik').textContent, /Favoriler/);
});

test('palet: Türkçe harf katlama ("isik" -> Işık) ve "ışık 40" komutu: Enter parlaklıkla çalıştırır ve paleti kapatır', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'isik 40';
  arama.gonder('input');
  const satirlar = paletSatirlari(sayfa);
  assert.ok(satirlar.length >= 1);
  assert.match(satirlar[0].textContent, /LED şerit/);
  assert.match(satirlar[0].textContent, /%40/, 'parlaklık rozeti');
  arama.gonder('keydown', { key: 'Enter', repeat: false, shiftKey: false });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 40, sonDeger: true }]);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0, 'h-31: palet yanıt gelene kadar kapanmaz');
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1, 'başarılı yanıttan sonra kapanır');
});

test('palet (h-13): parlaklık kontrolü olmayan ampulde sayı sessizce atılıp aç/kapat yapılmaz; satır "parlaklık desteklenmiyor" der, Enter eylem çalıştırmaz', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'ampul 40';
  arama.gonder('input');
  const satirlar = paletSatirlari(sayfa);
  assert.equal(satirlar.length, 1);
  assert.match(satirlar[0].textContent, /Ampul/);
  assert.match(satirlar[0].textContent, /parlaklık desteklenmiyor/i);
  assert.equal(satirlar[0].textContent.includes('%40'), false, 'seviye rozeti yok');
  const olay = arama.gonder('keydown', { key: 'Enter', repeat: false });
  assert.equal(olay.onlendi, true, 'Enter yine de arama kutusunda varsayılan işlem yapmaz');
  assert.deepEqual(sayfa.calistirmalar(), [], 'hiçbir eylem gönderilmedi');
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0, 'palet açık kalır: kullanıcı sayıyı silebilir');

  // Sayı silinince Enter normal çalışır (aç/kapat).
  arama.value = 'ampul';
  arama.gonder('input');
  assert.doesNotMatch(paletSatirlari(sayfa)[0].textContent, /desteklenmiyor/);
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.ampul' }]);
});

test('palet (h-13): sahne ve yıkıcı eylemde de sayı varken Enter çalıştırmaz ("pc kapat 50" basılı tutmayı bile başlatmaz); fareyle tıklama bilinçli seçimdir', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'film 40';
  arama.gonder('input');
  assert.match(paletSatirlari(sayfa)[0].textContent, /parlaklık desteklenmiyor/i);
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(sayfa.calistirmalar(), []);

  arama.value = 'pc kapat 50';
  arama.gonder('input');
  assert.match(paletSatirlari(sayfa)[0].textContent, /parlaklık desteklenmiyor/i);
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'basiliBasla').length, 0, 'basılı tutma başlamadı');

  // Fare tıklaması (bilinçli seçim) eskisi gibi çalışır ve sayıyı göndermez.
  arama.value = 'film 40';
  arama.gonder('input');
  paletSatirlari(sayfa)[0].gonder('click');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'scene.film' }]);
});

test('palet (h-02): "ses 40" LED şeridi %40 yapmaz; "led 40" LED şeridi %40 yapar', async () => {
  const model = { ...MODEL, sonlar: [] };
  const ses = await paletAc({ model });
  ses.oge('arama').value = 'ses 40';
  ses.oge('arama').gonder('input');
  assert.match(paletSatirlari(ses)[0].textContent, /Ses \+/);
  assert.ok(paletSatirlari(ses).every((s) => !/LED şerit/.test(s.textContent)), 'zayıf eşleşen ışık listede bile yok');
  ses.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(ses.calistirmalar(), []);

  const led = await paletAc({ model });
  led.oge('arama').value = 'led 40';
  led.oge('arama').gonder('input');
  led.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(led.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 40, sonDeger: true }]);
});

test('palet (h-23, k-08): "led %40" ve "led 40%" parlaklık verir; "led 0" kapat gönderir; kısılamayan ışıkta "0" kapat sayılmaz', async () => {
  for (const sorgu of ['led %40', 'led 40%']) {
    const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
    sayfa.oge('arama').value = sorgu;
    sayfa.oge('arama').gonder('input');
    assert.match(paletSatirlari(sayfa)[0].textContent, /%40/, sorgu);
    sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
    assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 40, sonDeger: true }], sorgu);
  }
  const kapat = await paletAc({ model: { ...MODEL, sonlar: [] } });
  kapat.oge('arama').value = 'led 0';
  kapat.oge('arama').gonder('input');
  assert.match(paletSatirlari(kapat)[0].textContent, /Kapat/);
  kapat.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(kapat.calistirmalar(), [{ kimlik: 'light.led_serit', kapat: true }]);
  await akit(); // palet yanıt gelince kapanır (h-31)
  assert.equal(kapat.cagrilar.filter((c) => c[0] === 'kapat').length, 1);

  const ampul = await paletAc({ model: { ...MODEL, sonlar: [] } });
  ampul.oge('arama').value = 'ampul 0';
  ampul.oge('arama').gonder('input');
  ampul.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(ampul.calistirmalar(), [], '"ampul 0" aç/kapat yapmaz');
});

test('palet (k-07, h-21): "led" yazınca alakasız sonuç çıkmaz; "ses -" ve "ses arti" doğru düğmeyi bulur; son kullanılan eşit puanda öne geçer', async () => {
  const model = { ...MODEL, sonlar: [] };
  const sayfa = await paletAc({ model });
  sayfa.oge('arama').value = 'led';
  sayfa.oge('arama').gonder('input');
  assert.equal(paletSatirlari(sayfa).length, 1);
  assert.match(paletSatirlari(sayfa)[0].textContent, /LED şerit/);

  sayfa.oge('arama').value = 'ses arti';
  sayfa.oge('arama').gonder('input');
  assert.equal(paletSatirlari(sayfa).length, 1);
  assert.match(paletSatirlari(sayfa)[0].textContent, /Ses \+/);

  // Eşit puan ("isik" grup adında): LED şerit zaten parlaklıkla öne geçer; "Son" listesindeki Ampul daha önce gelir.
  const son = await paletAc({ model: { ...MODEL, sonlar: [AMPUL] } });
  son.oge('arama').value = 'isik';
  son.oge('arama').gonder('input');
  assert.match(paletSatirlari(son)[0].textContent, /Ampul/);
  assert.match(paletSatirlari(son)[1].textContent, /LED şerit/);
});

test('palet: yön tuşları seçimi taşır; Esc önce seviye satırını, sonra paleti kapatır; Shift+Enter ışıkta seviye seçer', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const arama = sayfa.oge('arama');
  const secili = () => paletSatirlari(sayfa).findIndex((s) => s.className.split(' ').includes('secili'));
  assert.equal(secili(), 0);
  arama.gonder('keydown', { key: 'ArrowDown' });
  assert.equal(secili(), 1);
  arama.gonder('keydown', { key: 'ArrowUp' });
  arama.gonder('keydown', { key: 'ArrowUp' });
  assert.equal(secili(), 4, 'baştan sona sarar');
  arama.gonder('keydown', { key: 'ArrowDown' });
  assert.equal(secili(), 0);

  arama.gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false }); // LED şerit: seviye satırı açılır
  const seviyeler = sayfa.oge('icerik').bul((o) => o.className.startsWith('seviye-oge'));
  assert.deepEqual(seviyeler.map((s) => s.textContent), ['%10', '%20', '%50', '%100']);
  arama.gonder('keydown', { key: 'ArrowRight' });
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.led_serit', parlaklik: 20, sonDeger: true }]);

  const ikinci = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const a2 = ikinci.oge('arama');
  a2.gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false });
  a2.gonder('keydown', { key: 'Escape' });
  assert.equal(ikinci.cagrilar.filter((c) => c[0] === 'kapat').length, 0, 'ilk Esc yalnız seviye satırını kapatır');
  a2.gonder('keydown', { key: 'Escape' });
  assert.equal(ikinci.cagrilar.filter((c) => c[0] === 'kapat').length, 1);
});

test('palet: yıkıcı eylem Enter\'a BASILI TUTMAYLA çalışır; kısa Enter, otomatik tekrar ve erken bırakma istek göndermez', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'pc kapat';
  arama.gonder('input');
  assert.match(paletSatirlari(sayfa)[0].textContent, /Enter’a basılı tut/);
  assert.ok(paletSatirlari(sayfa)[0].className.includes('yikici'));

  // kısa Enter: başlar ama bırakılınca iptal
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  sayfa.zaman.ilerle(300);
  arama.gonder('keyup', { key: 'Enter' });
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0, 'iptalde palet kapanmaz');

  // yeterli tutma: otomatik tekrar eden keydown'lar yok sayılır
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  arama.gonder('keydown', { key: 'Enter', repeat: true });
  sayfa.zaman.ilerle(810);
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }]);
  await akit();
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'basiliBasla').length, 2);
});

test('palet: eşleşme yoksa "Eşleşen eylem yok" yazar; yeniden gösterilince sorgu ve seçim sıfırlanır', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'zzzzzz';
  arama.gonder('input');
  assert.match(sayfa.oge('icerik').textContent, /Eşleşen eylem yok/);
  sayfa.goster('palet');
  assert.equal(arama.value, '');
  assert.match(sayfa.oge('icerik').textContent, /Son kullanılanlar/);
});

test('renderer kapı/kilit adını kendi başına süzmez ama hiçbir istekte "onay"ı kendi bildirmez: basili yalnız tutma tamamlanınca gider', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'pc';
  arama.gonder('input');
  for (const tus of ['Enter', ' ']) arama.gonder('keydown', { key: tus, repeat: false, shiftKey: true });
  arama.gonder('keyup', { key: 'Enter' });
  sayfa.zaman.ilerle(5000);
  for (const yuk of sayfa.calistirmalar()) assert.notEqual(yuk.basili, true, 'tutma tamamlanmadan basili:true gönderilmez');
});

// --- denetim düzeltmeleri (Dalga 3): yükseklik, basılı tutma, odak, çizim ---------------------------------------------

test('boyut: pencere içerikten KÜÇÜKKEN büyütme, BÜYÜKKEN küçültme istenir (içeriğin doğal yüksekliği; pencere yüksekliğinden bağımsız)', async () => {
  const sayfa = await panelAc();
  const kok = sayfa.oge('kok');
  const ust = sayfa.oge('ust');
  const icerik = sayfa.oge('icerik');
  const alt = sayfa.oge('alt');
  kok.children = [ust, sayfa.oge('paletKutusu'), icerik, sayfa.oge('ipucu'), alt];
  const olc = ({ pencere, icerikGorunen, icerikTam }) => {
    kok.offsetHeight = pencere; // .kok pencere yüksekliği kadar
    ust.offsetHeight = 44;
    alt.offsetHeight = 46;
    icerik.offsetHeight = icerikGorunen;
    icerik.scrollHeight = icerikTam; // kaydırılan kısım dahil tam içerik
    sayfa.goster('panel'); // sonBildirilenYukseklik sıfırlanır: yeniden ölçülür
    sayfa.zaman.ilerle(5);
    return sayfa.cagrilar.filter((c) => c[0] === 'boyut').at(-1)[1];
  };
  // Eski hata: pencere 290 px iken içerik 700 px olsa bile ölçüm 290'da takılır (max-height:100vh) ve pencere HİÇ büyümezdi.
  assert.equal(olc({ pencere: 290, icerikGorunen: 200, icerikTam: 700 }), 44 + 700 + 46, 'pencere içerikten küçük: BÜYÜTME istenir');
  assert.equal(olc({ pencere: 900, icerikGorunen: 300, icerikTam: 300 }), 44 + 300 + 46, 'pencere içerikten büyük: KÜÇÜLTME istenir');
  assert.equal(olc({ pencere: 390, icerikGorunen: 300, icerikTam: 300 }), 44 + 300 + 46, 'pencere tam oturuyorsa ölçüm aynı kalır');
});

test('palet: arama sonuçları değişince yeniden ölçülür (96 px ile açılan palet sonuçlara göre büyür)', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const kok = sayfa.oge('kok');
  const icerik = sayfa.oge('icerik');
  kok.children = [sayfa.oge('ust'), sayfa.oge('paletKutusu'), icerik, sayfa.oge('ipucu'), sayfa.oge('alt')];
  sayfa.oge('paletKutusu').offsetHeight = 59;
  icerik.offsetHeight = 61;
  icerik.scrollHeight = 61; // pencere 120 px: yalnız ~43 px kalan alan
  sayfa.zaman.ilerle(5);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'boyut').at(-1)[1], 59 + 61);
  icerik.scrollHeight = 5 * 38 + 16; // satırlar eklendi: içerik pencereden büyük
  icerik.offsetHeight = 61;
  const arama = sayfa.oge('arama');
  arama.value = '';
  arama.gonder('input');
  sayfa.zaman.ilerle(5);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'boyut').at(-1)[1], 59 + 5 * 38 + 16, 'pencere içeriğe göre büyütülmek üzere ana sürece bildirildi');
});

test('palet: yıkıcı satır fareyle basılı tutulurken satır yeniden çizilmez; fare kaysa ya da bırakma yeni öğeye gitse de kısa tıklama ASLA eylem çalıştırmaz', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const satir = paletSatirlari(sayfa)[3];
  assert.match(satir.textContent, /PC kapat/);
  satir.gonder('pointerdown', { button: 0 });
  satir.gonder('mousemove'); // basış sırasında fare kaydı: eskiden satır yeniden çizilir, bırakma eski öğeye ulaşmazdı
  assert.equal(paletSatirlari(sayfa)[3], satir, 'basılı satır yeniden çizilmedi');
  sayfa.zaman.ilerle(100);
  satir.gonder('pointerup');
  sayfa.zaman.ilerle(3000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'kısa tıklama PC kapatmaz');
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'basiliBirak'), [['basiliBirak', 'button.pc_bilgisayari_kapat']], 'bırakma ana sürece de bildirildi');

  // başka bir yolla yeniden çizim (yazma): tutma BIRAKILIR, yeni öğeye gelen "bırakıldı" olayı beklenmez
  const ikinci = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const eski = paletSatirlari(ikinci)[3];
  eski.gonder('pointerdown', { button: 0 });
  ikinci.oge('arama').value = '';
  ikinci.oge('arama').gonder('input');
  const yeni = paletSatirlari(ikinci)[3];
  assert.notEqual(yeni, eski, 'satırlar yeniden kuruldu');
  ikinci.zaman.ilerle(100);
  yeni.gonder('pointerup');
  ikinci.zaman.ilerle(3000);
  assert.deepEqual(ikinci.calistirmalar(), [], 'eski sayaç dolsa da yıkıcı eylem çalışmaz');
});

test('palet: fare bırakma belge düzeyinde de yakalanır (öğe-düzeyi olay kaçsa bile basılı tutma sürüp eylemi çalıştırmaz)', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const satir = paletSatirlari(sayfa)[3];
  satir.gonder('pointerdown', { button: 0 });
  sayfa.belgeOlayi('pointerup'); // yalnız belgeye ulaşan bırakma
  sayfa.zaman.ilerle(3000);
  assert.deepEqual(sayfa.calistirmalar(), []);

  const iptal = await paletAc({ model: { ...MODEL, sonlar: [] } });
  paletSatirlari(iptal)[3].gonder('pointerdown', { button: 0 });
  iptal.belgeOlayi('pointercancel');
  iptal.zaman.ilerle(3000);
  assert.deepEqual(iptal.calistirmalar(), []);

  // tam süre tutulursa eylem yine çalışır (düzeltme meşru kullanımı bozmaz)
  const tam = await paletAc({ model: { ...MODEL, sonlar: [] } });
  paletSatirlari(tam)[3].gonder('pointerdown', { button: 0 });
  tam.zaman.ilerle(810);
  assert.deepEqual(tam.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }]);
});

test('palet: Enter basılıyken odak arama kutusundan kaçarsa (blur) ya da keyup başka yere giderse tutma bırakılır, eylem çalışmaz', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'pc kapat';
  arama.gonder('input');
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  sayfa.zaman.ilerle(300);
  arama.gonder('blur'); // odak başka yere geçti: Enter'ın keyup'ı aramaya gelmeyecek
  sayfa.zaman.ilerle(3000);
  assert.deepEqual(sayfa.calistirmalar(), []);

  const ikinci = await paletAc();
  const a2 = ikinci.oge('arama');
  a2.value = 'pc kapat';
  a2.gonder('input');
  a2.gonder('keydown', { key: 'Enter', repeat: false });
  ikinci.zaman.ilerle(300);
  ikinci.belgeOlayi('keyup', { key: 'Enter', target: ikinci.oge('icerik') }); // keyup belgede başka bir öğede
  ikinci.zaman.ilerle(3000);
  assert.deepEqual(ikinci.calistirmalar(), []);

  const ucuncu = await paletAc();
  const a3 = ucuncu.oge('arama');
  a3.value = 'pc kapat';
  a3.gonder('input');
  a3.gonder('keydown', { key: 'Enter', repeat: false });
  ucuncu.zaman.ilerle(300);
  a3.value = 'pc'; // tutarken yazı değişti: satır değişebilir, tutma iptal olur
  a3.gonder('input');
  ucuncu.zaman.ilerle(3000);
  assert.deepEqual(ucuncu.calistirmalar(), [], 'tutma sürerken sonuçlar değişirse eylem çalışmaz');
});

test('palet: satıra/boş alana fare basışı odağı arama kutusundan çalmaz; odak kaçsa da Esc paleti kapatır', async () => {
  const sayfa = await paletAc();
  const bas = (hedef) => {
    let onlendi = false;
    sayfa.belgeOlayi('mousedown', { target: hedef, preventDefault: () => (onlendi = true) });
    return onlendi;
  };
  assert.equal(bas(paletSatirlari(sayfa)[0]), true, 'satır: varsayılan (odak değişimi) engellenir');
  assert.equal(bas(sayfa.oge('icerik')), true, 'boş alan');
  assert.equal(bas(sayfa.oge('arama')), false, 'arama kutusunun kendisi normal çalışır (imleç, seçim)');

  sayfa.belgeOlayi('keydown', { key: 'Escape', target: sayfa.oge('icerik') });
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1, 'odak aramada değilken Esc de kapatır');
  sayfa.belgeOlayi('keydown', { key: 'Escape', target: sayfa.oge('arama') });
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1, 'arama kutusundaki Esc çifte işlenmez (kendi dinleyicisi)');

  const panel = await panelAc();
  let panelOnlendi = false;
  panel.belgeOlayi('mousedown', { target: panel.oge('icerik'), preventDefault: () => (panelOnlendi = true) });
  assert.equal(panelOnlendi, false, 'panelde fare basışı engellenmez');
});

test('çizim: model değişmediyse DOM yeniden kurulmaz (klavye odağı/basış kaybolmaz); basış sürerken gelen güncelleme bırakıldıktan SONRA çizilir', async () => {
  const sayfa = await panelAc();
  const once = dugmeBul(sayfa, 'Ampul');
  sayfa.durum(JSON.parse(JSON.stringify(MODEL))); // aynı içerik
  assert.equal(dugmeBul(sayfa, 'Ampul'), once, 'değişmeyen model: aynı düğme');

  const degisen = JSON.parse(JSON.stringify(MODEL));
  degisen.gruplar[0].karolar[1].durum = 'acik';
  sayfa.belgeOlayi('pointerdown'); // kullanıcı bir karoya BASTI (henüz bırakmadı)
  sayfa.durum(degisen);
  assert.equal(dugmeBul(sayfa, 'Ampul'), once, 'basış sürerken düğme yenilenmez (aksi halde click üretilmezdi)');
  once.gonder('click', { detail: 1 }); // bırakma + click
  sayfa.belgeOlayi('pointerup');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'light.ampul' }], 'basılan karonun click eylemi kaybolmadı');
  assert.equal(dugmeBul(sayfa, 'Ampul'), once, 'click olayı bitmeden çizim yok');
  sayfa.zaman.ilerle(1);
  const yeni = dugmeBul(sayfa, 'Ampul');
  assert.notEqual(yeni, once, 'bırakılınca bekleyen güncelleme çizildi');
  assert.ok(yeni.className.includes('durum-acik'));
});

test('ışık kaydırıcısı: ok tuşu basılı tutulunca (her adımda input + change) HA saniyede en çok ~5 son değerle yüklenir; son değer kaybolmaz', async () => {
  const sayfa = await panelAc();
  const aralik = sayfa.oge('icerik').bul((o) => o.type === 'range')[0];
  for (let v = 61; v <= 90; v += 1) {
    aralik.value = v;
    aralik.gonder('input');
    aralik.gonder('change');
    sayfa.zaman.ilerle(33);
  }
  sayfa.zaman.ilerle(300);
  const sonlar = sayfa.calistirmalar().filter((c) => c.sonDeger === true);
  assert.ok(sonlar.length <= 7, `1 sn'de en çok ~5 sonDeger bekleniyordu: ${sonlar.length}`);
  assert.ok(sayfa.calistirmalar().length <= 14, 'toplam istek sınırlı (30 adım için 30+ istek değil)');
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'light.led_serit', parlaklik: 90, sonDeger: true }, 'son değer mutlaka gider');
});

test('panel: bağlantı yedek/yeniden bağlanıyor iken karolar soluk (kök sınıfı), canlıda ve ayarla kapalıyken değil', async () => {
  const bagli = (baglanti) => ({ ...MODEL, ust: { canli: baglanti === 'canli', baglanti, medyaCaliyor: null, aktifCikis: null, hata: null } });
  assert.equal((await panelAc({ model: bagli('canli') })).oge('kok').className, 'kok');
  assert.equal((await panelAc({ model: bagli('kapali') })).oge('kok').className, 'kok', 'canlı bağlantı ayarla kapalı: REST normal biçimdir');
  assert.match((await panelAc({ model: bagli('yedek') })).oge('kok').className, /\bsoluk\b/);
  assert.match((await panelAc({ model: bagli('baglaniyor') })).oge('kok').className, /\bsoluk\b/);
  const sayfa = await panelAc({ model: bagli('yedek') });
  sayfa.durum(bagli('canli')); // bağlantı geri geldi
  assert.equal(sayfa.oge('kok').className, 'kok');
});

test('medya grubu: ses çıkışı | ses -/+/sessiz | oynat satırları ayrı ızgaralarda (hiz-12); diğer gruplar tek satır', async () => {
  const medya = (id, etiket, altGrup) => karo(id, etiket, { grup: 'medya', grupEtiketi: 'Medya', altGrup, durum: 'notr' });
  const model = {
    ...MODEL,
    gruplar: [
      { kod: 'isik', etiket: 'Işık', karolar: [ISIK, AMPUL] },
      {
        kod: 'medya',
        etiket: 'Medya',
        karolar: [
          medya('button.pc_mediavolumedown', 'Ses −', 'ses'),
          medya('button.pc_ses_cikis_hoparlor', 'Hoparlör', 'cikis'),
          medya('button.pc_mediaplaypause', 'Oynat/Duraklat', 'oynat'),
          medya('button.pc_mediavolumeup', 'Ses +', 'ses'),
          medya('button.pc_ses_cikis_kulaklik', 'Kulaklık', 'cikis'),
        ],
      },
    ],
  };
  const sayfa = await panelAc({ model });
  const izgaralar = sayfa.oge('icerik').bul((o) => o.className.split(' ')[0] === 'izgara');
  assert.deepEqual(izgaralar.map((g) => g.className), ['izgara', 'izgara alt-cikis', 'izgara alt-ses', 'izgara alt-oynat']);
  const satirEtiketleri = (g) => g.bul((o) => o.className === 'karo-etiket').map((o) => o.textContent);
  assert.deepEqual(satirEtiketleri(izgaralar[1]), ['Hoparlör', 'Kulaklık']);
  assert.deepEqual(satirEtiketleri(izgaralar[2]), ['Ses −', 'Ses +']);
  assert.deepEqual(satirEtiketleri(izgaralar[3]), ['Oynat/Duraklat']);
});

test('palet: boş aramada en çok 5 "son" eylem, altında kalan bütün favoriler (hiz-08, k-08)', async () => {
  const sekiz = Array.from({ length: 8 }, (_, i) => karo(`switch.s${i}`, `Priz ${i}`));
  const sayfa = await paletAc({ model: { ...MODEL, gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: sekiz }], sonlar: sekiz } });
  const satirlar = paletSatirlari(sayfa);
  assert.equal(satirlar.length, 8, 'her karo bir kez');
  const basliklar = sayfa.oge('icerik').bul((o) => o.className === 'palet-baslik').map((o) => o.textContent);
  assert.deepEqual(basliklar, ['Son kullanılanlar', 'Favoriler']);
  const bosSon = await paletAc({ model: { ...MODEL, gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: sekiz }], sonlar: [] } });
  assert.equal(paletSatirlari(bosSon).length, 8, '"Son" yoksa bütün favoriler');
  assert.deepEqual(bosSon.oge('icerik').bul((o) => o.className === 'palet-baslik').map((o) => o.textContent), ['Favoriler']);
});

test('hata: eylem başarısız olursa karoda kısa süreli kırmızı çerçeve ve kısa metin; çok sık/onay gerekli bunu tetiklemez', async () => {
  const sayfa = await panelAc({ calistirYaniti: { ok: false, tur: 'ha-hatasi' } });
  const d = dugmeBul(sayfa, 'Ampul');
  d.gonder('click', { detail: 1 });
  await akit();
  assert.ok(d.className.split(' ').includes('hata'), 'kırmızı çerçeve sınıfı');
  assert.match(sayfa.oge('ipucu').textContent, /“Ampul” çalıştırılamadı/);
  sayfa.zaman.ilerle(3100);
  assert.equal(d.className.split(' ').includes('hata'), false, 'işaret kısa sürede kalkar');

  const sik = await panelAc({ calistirYaniti: { ok: false, tur: 'cok-sik' } });
  const e = dugmeBul(sik, 'Ampul');
  e.gonder('click', { detail: 1 });
  await akit();
  assert.equal(e.className.split(' ').includes('hata'), false);
});

// --- gorunum-11: pencere malzemesi (data-malzeme) ---------------------------------------------

test('malzeme: "acrylic" ve "mica" <html> üzerine data-malzeme yazar; "yok" ya da bilinmeyen değer özniteliği kaldırır (opak)', async () => {
  const sayfa = await panelAc();
  assert.equal(sayfa.kok.dataset.malzeme, undefined, 'malzeme bildirilmediyse opak');
  sayfa.goster('panel', 'acrylic');
  assert.equal(sayfa.kok.dataset.malzeme, 'acrylic');
  sayfa.goster('palet', 'mica');
  assert.equal(sayfa.kok.dataset.malzeme, 'mica');
  sayfa.goster('panel', 'yok');
  assert.equal('malzeme' in sayfa.kok.dataset, false);
  sayfa.goster('panel', 'acrylic');
  sayfa.goster('panel', '<script>');
  assert.equal('malzeme' in sayfa.kok.dataset, false, 'bilinmeyen değer özniteliğe yazılmaz');
  sayfa.goster('panel', { toString: () => 'acrylic' });
  assert.equal('malzeme' in sayfa.kok.dataset, false, 'metin olmayan değer yok sayılır');
});

test('malzeme: sayfa ilk açıldığında ana sürecin durum yanıtındaki malzeme de uygulanır (gösterimden önce)', async () => {
  const sayfa = sayfayiKur({ malzeme: 'acrylic' });
  await akit();
  assert.equal(sayfa.kok.dataset.malzeme, 'acrylic');
  const duz = sayfayiKur({ malzeme: 'yok' });
  await akit();
  assert.equal('malzeme' in duz.kok.dataset, false);
});

test('malzeme: yarı saydam stil yalnız :root[data-malzeme] altında; öznitelik yokken opak koyu arka plan geçerli (CSS)', () => {
  const css = oku('src/yuzey.css');
  assert.match(css, /:root\[data-malzeme\]/);
  const koseCss = oku('src/kose-bildirim.css');
  assert.match(koseCss, /:root\[data-malzeme\]/);
  // Varsayılan (özniteliksiz) arka plan opak kalmalı: kök değişkeni opak renk, saydam hâli yalnız öznitelikle.
  assert.match(css, /--bg:\s*#1b1f27/);
  assert.match(koseCss, /--bg:\s*#1b1f27/);
  assert.doesNotMatch(css.split(':root[data-malzeme]')[0], /transparent/, 'öznitelik yokken saydamlık yok');
});

// =============================================================================================
// 1.2.0 "Panel ve palet arayüzü": h-06, h-07, k-09, h-12, g-03, h-15, h-31, g-02, g-04, g-05, g-07, g-08, g-13, g-01, k-03, k-08, k-16
// =============================================================================================

const sinifli = (oge, sinif) => oge.className.split(' ').includes(sinif);
const kopya = (o) => JSON.parse(JSON.stringify(o));
const sonlariBul = (sayfa) => sayfa.oge('icerik').bul((o) => o.className === 'son-oge');
const kapatSayisi = (sayfa) => sayfa.cagrilar.filter((c) => c[0] === 'kapat').length;
const ayarlarAcSayisi = (sayfa) => sayfa.cagrilar.filter((c) => c[0] === 'ayarlarAc').length;

// ---- CSS ayrıştırma (kontrast ve kural denetimi için) ------------------------------------------

const yorumsuz = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const bosluksuz = (s) => s.trim().replace(/\s+/g, ' ');

/** Düz kural listesi: [{ secici, govde }] (iç içe @media kuralları da düzleştirilerek gelir; medya bağlamı yoktur). */
function kurallar(css) {
  return [...yorumsuz(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ secici: bosluksuz(m[1]), govde: m[2] }));
}

/** Seçici virgüllü listenin üyesiyse kuralın gövdesi (birden çok kural varsa birleşik). */
function kuralGovdesi(css, secici) {
  return kurallar(css)
    .filter((k) => k.secici.split(',').map(bosluksuz).includes(secici))
    .map((k) => k.govde)
    .join(';');
}

function degiskenler(govde) {
  return Object.fromEntries([...govde.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], bosluksuz(m[2])]));
}

/** `@media (prefers-color-scheme: light) { ... }` bloğunun iç metni (dengeli süslü parantez). */
function acikTemaBlogu(css) {
  const temiz = yorumsuz(css);
  const bas = temiz.indexOf('@media (prefers-color-scheme: light)');
  if (bas < 0) return null;
  let i = temiz.indexOf('{', bas);
  const ic = i + 1;
  let derinlik = 0;
  for (; i < temiz.length; i += 1) {
    if (temiz[i] === '{') derinlik += 1;
    else if (temiz[i] === '}') {
      derinlik -= 1;
      if (derinlik === 0) return { ic: temiz.slice(ic, i), once: temiz.slice(0, bas) };
    }
  }
  return null;
}

/** { koyu, acik } değişken tabloları: koyu = medya bloğundan ÖNCEKİ ilk `:root`; açık = medya bloğundaki ilk `:root`. */
function temalar(css) {
  const blok = acikTemaBlogu(css);
  assert.ok(blok, 'prefers-color-scheme: light bloğu var');
  const ilk = (metin) => degiskenler(kurallar(metin).find((k) => k.secici === ':root')?.govde ?? '');
  return { koyu: ilk(blok.once), acik: ilk(blok.ic) };
}

function parlaklik(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [acik, koyu] = [parlaklik(a), parlaklik(b)].sort((x, y) => y - x);
  return (acik + 0.05) / (koyu + 0.05);
}

// ---- h-06: çift tık ----------------------------------------------------------------------

test('h-06: aynı karoya çift tık TEK istek gönderir; yanıt anında gelse de 400 ms dolmadan ikinci tıklama yok sayılır, farklı karo etkilenmez', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  const led = dugmeBul(sayfa, 'LED şerit');
  ampul.gonder('click', { detail: 1 });
  ampul.gonder('click', { detail: 2 }); // çift tıkın ikinci basışı
  assert.equal(sayfa.calistirmalar().length, 1, 'çift tık aç-kapa yapmaz');
  await akit(); // yanıt geldi
  sayfa.zaman.ilerle(399);
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 1, '400 ms dolmadan yanıt gelmiş olsa da yok sayılır');
  led.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 2, 'başka karo kilitlenmez');
  sayfa.zaman.ilerle(2);
  ampul.gonder('click', { detail: 1 });
  assert.deepEqual(sayfa.calistirmalar().map((c) => c.kimlik), ['light.ampul', 'light.led_serit', 'light.ampul'], '400 ms sonra yeni tıklama çalışır');
});

test('h-06: yanıt gelmediği sürece ikinci tıklama bekler (uzun süre geçse de); yanıt gelince serbest kalır; takılı kalan kilit 5 sn sonra çözülür', async () => {
  let coz;
  const sayfa = await panelAc({
    calistirYaniti: () =>
      new Promise((r) => {
        coz = r;
      }),
  });
  const ampul = dugmeBul(sayfa, 'Ampul');
  ampul.gonder('click', { detail: 1 });
  sayfa.zaman.ilerle(1000);
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 1, 'yanıt yok: ikinci istek gitmez');
  coz({ ok: true });
  await akit();
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 2, 'yanıt geldi ve 400 ms geçti');
  sayfa.zaman.ilerle(4000);
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 2, 'ikinci istek hâlâ yanıtsız (4 sn)');
  sayfa.zaman.ilerle(1100);
  ampul.gonder('click', { detail: 1 });
  assert.equal(sayfa.calistirmalar().length, 3, 'yanıt hiç gelmezse kilit 5 sn sonra çözülür');
});

test('h-06: "Son kullanılanlar" düğmesi ve palet satırı da çift tıkta tek istek gönderir; ses +/− tekrarlı karo kilitlenmez', async () => {
  const sayfa = await panelAc();
  const son = sonlariBul(sayfa)[0];
  son.gonder('click', { detail: 1 });
  son.gonder('click', { detail: 2 });
  assert.equal(sayfa.calistirmalar().length, 1);

  const ses = dugmeBul(sayfa, 'Ses +');
  ses.gonder('click', { detail: 0 });
  ses.gonder('click', { detail: 0 });
  assert.equal(sayfa.calistirmalar().filter((c) => c.kimlik === 'button.pc_mediavolumeup').length, 2, 'ses düğmesi basılı tutunca tekrarlar: kilit yok');

  const palet = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const arama = palet.oge('arama');
  arama.value = 'ampul';
  arama.gonder('input');
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  arama.gonder('keydown', { key: 'Enter', repeat: false }); // repeat:false ikinci basış (hızlı çift Enter)
  assert.equal(palet.calistirmalar().length, 1);
});

// ---- h-07, k-09: odak korunur, ok tuşu gezintisi --------------------------------------------

test('h-07: yeniden çizimde odaktaki karo, hazır seviye düğmesi, "Son" düğmesi ve kaydırıcı aynı öğe olarak yeniden odaklanır', async () => {
  const sayfa = await panelAc();
  let tur = 0;
  const degisen = () => {
    tur += 1; // her çağrıda farklı model: HA her turda yeni parlaklık bildirir
    const m = kopya(MODEL);
    m.gruplar[0].karolar[0].yuzde = 60 + tur;
    m.gruplar[0].karolar[1].durum = 'acik';
    return m;
  };
  const dene = (bul, aciklama) => {
    const eski = bul();
    assert.ok(eski, aciklama);
    sayfa.odakVer(eski);
    sayfa.durum(degisen());
    const yeni = bul();
    assert.notEqual(yeni, eski, `${aciklama}: öğe yeniden kuruldu`);
    assert.equal(sayfa.odakta(), yeni, `${aciklama}: odak yeni öğede`);
  };
  dene(() => dugmeBul(sayfa, 'Ampul'), 'karo');
  dene(() => hazirBul(sayfa, '%50'), 'hazır seviye');
  dene(() => sonlariBul(sayfa)[0], 'son kullanılan');
  dene(() => sayfa.oge('icerik').bul((o) => o.type === 'range')[0], 'ışık kaydırıcısı (ok tuşuyla ayar sürer)');
});

test('h-07: odak panel içinde değilse çalmaz; odaktaki karo modelden kalkarsa odak içerik alanına düşer; kaydırma konumu korunur', async () => {
  const sayfa = await panelAc();
  assert.equal(sayfa.odakta(), sayfa.oge('icerik'), 'açılışta odak içerik alanında');
  const ampul = dugmeBul(sayfa, 'Ampul');
  const degisen = kopya(MODEL);
  degisen.gruplar[0].karolar[1].durum = 'acik';
  sayfa.durum(degisen);
  assert.equal(ampul.odakSayisi, 0);
  assert.equal(dugmeBul(sayfa, 'Ampul').odakSayisi, 0, 'odak içerik alanındayken karolara odak verilmez');
  assert.equal(sayfa.odakta(), sayfa.oge('icerik'));

  sayfa.oge('icerik').scrollTop = 120;
  const yeni = dugmeBul(sayfa, 'Ampul');
  sayfa.odakVer(yeni);
  const ampulsuz = kopya(MODEL);
  ampulsuz.gruplar[0].karolar = [ampulsuz.gruplar[0].karolar[0]];
  sayfa.durum(ampulsuz);
  assert.equal(dugmeBul(sayfa, 'Ampul'), undefined);
  assert.equal(sayfa.odakta(), sayfa.oge('icerik'), 'odaktaki karo kalktı: klavye kullanıcısı içerik alanında kalır');
  assert.equal(sayfa.oge('icerik').scrollTop, 120, 'kaydırma konumu geri verilir');

  // pencere yeniden gösterilince eski gösterimin odağı geri verilmez
  const odakli = dugmeBul(sayfa, 'LED şerit');
  sayfa.odakVer(odakli);
  sayfa.goster('panel');
  assert.equal(sayfa.odakta(), sayfa.oge('icerik'));
});

test('k-09: panelde ok tuşları ızgarada gezinir (Sol/Sağ sırayla, Yukarı/Aşağı satırlar arası, Home/End satır, Ctrl+Home/End tüm panel)', async () => {
  const sayfa = await panelAc();
  const icerik = sayfa.oge('icerik');
  const bas = (tus, hedef, ek = {}) => sayfa.belgeOlayi('keydown', { key: tus, target: hedef ?? sayfa.odakta(), ...ek });
  const son = sonlariBul(sayfa)[0];
  const led = dugmeBul(sayfa, 'LED şerit');
  const ampul = dugmeBul(sayfa, 'Ampul');
  const hazir = (m) => hazirBul(sayfa, m);
  const film = sayfa.oge('icerik').bul((o) => o.etiket === 'button' && o.textContent.startsWith('Film') && !sinifli(o, 'son-oge'))[0];
  const pc = dugmeBul(sayfa, 'PC kapat');
  const ses = dugmeBul(sayfa, 'Ses +');

  // odak içerik alanındayken ilk ok tuşu ilk öğeye gider
  const ilk = bas('ArrowDown', icerik);
  assert.equal(ilk.onlendi, true);
  assert.equal(sayfa.odakta(), son);
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), led, 'Son kullanılanlar satırından ışık karosuna');
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), hazir('%10'), 'ışık karosundan hazır seviye satırına (kaydırıcı atlanır)');
  bas('ArrowRight');
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), hazir('%50'));
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), ampul);
  bas('ArrowLeft');
  assert.equal(sayfa.odakta(), hazir('%100'), 'satır başında Sol bir önceki satırın sonuna geçer');
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), ampul, 'satır sonunda Sağ sonraki satırın başına geçer');
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), film);
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), pc);
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), ses);
  const kenar = bas('ArrowDown');
  assert.equal(sayfa.odakta(), ses, 'son satırda Aşağı yerinde kalır');
  assert.equal(kenar.onlendi, true, 'kenarda bile içerik alanı kaymaz');
  bas('ArrowUp');
  assert.equal(sayfa.odakta(), pc);

  sayfa.odakVer(hazir('%50'));
  bas('Home');
  assert.equal(sayfa.odakta(), hazir('%10'));
  bas('End');
  assert.equal(sayfa.odakta(), hazir('%100'));
  bas('End', undefined, { ctrlKey: true });
  assert.equal(sayfa.odakta(), ses, 'Ctrl+End son öğe');
  bas('Home', undefined, { ctrlKey: true });
  assert.equal(sayfa.odakta(), son, 'Ctrl+Home ilk öğe');
});

test('k-09: kaydırıcıda oklar kaydırıcının kendi işidir; Shift/Alt/Ctrl+ok ve diğer tuşlar gezinmeyi tetiklemez; Esc kapatmaya devam eder', async () => {
  const sayfa = await panelAc();
  const aralik = sayfa.oge('icerik').bul((o) => o.type === 'range')[0];
  sayfa.odakVer(aralik);
  for (const tus of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    const olay = sayfa.belgeOlayi('keydown', { key: tus, target: aralik });
    assert.notEqual(olay.onlendi, true, `${tus}: kaydırıcının varsayılanı engellenmez`);
    assert.equal(sayfa.odakta(), aralik);
  }
  const ampul = dugmeBul(sayfa, 'Ampul');
  sayfa.odakVer(ampul);
  for (const ek of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    const olay = sayfa.belgeOlayi('keydown', { key: 'ArrowUp', target: ampul, ...ek });
    assert.notEqual(olay.onlendi, true);
    assert.equal(sayfa.odakta(), ampul);
  }
  assert.notEqual(sayfa.belgeOlayi('keydown', { key: 'a', target: ampul }).onlendi, true);
  sayfa.belgeOlayi('keydown', { key: 'Escape', target: ampul });
  assert.equal(kapatSayisi(sayfa), 1);
  // palet kipinde panel gezintisi çalışmaz
  const palet = await paletAc();
  assert.notEqual(palet.belgeOlayi('keydown', { key: 'ArrowDown', target: palet.oge('icerik') }).onlendi, true);
});

test('k-09: ızgara 3 sütundur (satır başına 3 karo); Yukarı/Aşağı yatay konuma en yakın öğeyi seçer, konum yoksa aynı sütunu', async () => {
  const dizi = ['A', 'B', 'C', 'D', 'E'].map((ad) => karo(`switch.${ad.toLowerCase()}`, `Priz ${ad}`));
  const sayfa = await panelAc({ model: { ...MODEL, gruplar: [{ kod: 'diger', etiket: 'Diğer', karolar: dizi }], sonlar: [] } });
  const d = (ad) => dugmeBul(sayfa, `Priz ${ad}`);
  const bas = (tus) => sayfa.belgeOlayi('keydown', { key: tus, target: sayfa.odakta() });
  sayfa.odakVer(d('C'));
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), d('E'), 'üçüncü sütundan alt satırın (2 öğe) son öğesine kırpılır');
  bas('ArrowUp');
  assert.equal(sayfa.odakta(), d('B'), 'alt satırın 2. öğesinden üstteki satırın 2. öğesine');
  sayfa.odakVer(d('C'));
  bas('ArrowRight');
  assert.equal(sayfa.odakta(), d('D'), 'satır sonunda Sağ sonraki satırın başına');

  // gerçek yerleşimde yatay konuma bakılır
  const rect = (merkez) => () => ({ left: merkez - 10, width: 20 });
  d('A').getBoundingClientRect = rect(50);
  d('B').getBoundingClientRect = rect(150);
  d('C').getBoundingClientRect = rect(250);
  d('D').getBoundingClientRect = rect(400);
  d('E').getBoundingClientRect = rect(60);
  sayfa.odakVer(d('A'));
  bas('ArrowDown');
  assert.equal(sayfa.odakta(), d('E'), 'merkezi x=50 olana en yakın alt öğe (sütun sırası değil)');
});

// ---- h-12, g-03: hata ve uyarı şeridi ------------------------------------------------------------

test('h-12: HA\'ya neden ulaşılamadığı başlığın altındaki şeritte yazar; değişmeyen şerit yeniden kurulmaz; hata gidince şerit gizlenir', async () => {
  const ustHata = { canli: false, baglanti: 'yedek', medyaCaliyor: true, aktifCikis: 'kulaklik', hata: 'bağlantı yok', uyari: null };
  const sayfa = await panelAc({ model: { ...MODEL, ust: ustHata } });
  const serit = sayfa.oge('serit');
  assert.equal(serit.hidden, false);
  assert.equal(serit.textContent, '!Home Assistant: bağlantı yok');
  assert.equal(serit.children.length, 1);
  assert.equal(serit.children[0].className, 'serit-satir hata');
  assert.match(sayfa.oge('baglanti').textContent, /^Yedek mod/);
  assert.equal(sayfa.oge('medya').textContent, '♪ Çalıyor · Kulaklık', 'medya bilgisi başlıkta kalır');
  const satir = serit.children[0];
  sayfa.durum({ ...kopya(MODEL), ust: { ...ustHata }, sonlar: [] }); // karolar değişti, şerit aynı
  assert.equal(serit.children[0], satir, 'aynı şerit içeriği yeniden kurulmaz');
  sayfa.durum({ ...kopya(MODEL), ust: { ...ustHata, hata: 'erişim engellendi (403)' } });
  assert.equal(serit.textContent, '!Home Assistant: erişim engellendi (403)');
  sayfa.durum({ ...kopya(MODEL), ust: { ...ustHata, hata: null, baglanti: 'canli', canli: true } });
  assert.equal(serit.hidden, true);
  assert.equal(serit.textContent, '');
});

test('h-12: hata ve uyarı birlikte gelirse iki ayrı satır olur (uyarı üstte); zararlı metin etiket olmaz', async () => {
  const ust = { canli: false, baglanti: 'yedek', medyaCaliyor: null, aktifCikis: null, hata: '<b>x</b>', uyari: 'Erişim anahtarı reddedildi' };
  const sayfa = await panelAc({ model: { ...MODEL, ust } });
  const serit = sayfa.oge('serit');
  assert.deepEqual(serit.children.map((s) => s.className), ['serit-satir uyari', 'serit-satir hata']);
  assert.equal(serit.children[1].children[1].textContent, 'Home Assistant: <b>x</b>');
  assert.equal(serit.bul((o) => o.etiket === 'b').length, 0);
});

test('g-03: şerit başlığın DIŞINDA, hemen altında; başlık satırı kırılmaz (CSS)', () => {
  assert.ok(HTML.indexOf('</header>') < HTML.indexOf('id="serit"'), 'şerit başlıktan sonra');
  assert.ok(HTML.indexOf('id="serit"') < HTML.indexOf('id="icerik"'), 'şerit içerikten önce');
  const css = oku('src/yuzey.css');
  assert.match(kuralGovdesi(css, '.baslik'), /white-space:\s*nowrap/);
  assert.match(kuralGovdesi(css, '.baslik'), /flex:\s*none/);
  assert.match(kuralGovdesi(css, '.baglanti'), /white-space:\s*nowrap/);
  assert.match(kuralGovdesi(css, '.medya'), /text-overflow:\s*ellipsis/, 'uzun medya bilgisi başlığı kırmaz, kısalır');
  assert.match(kuralGovdesi(css, '.serit'), /padding/);
  assert.match(kuralGovdesi(css, '.mod-palet .serit'), /display:\s*none/, 'palette başlık şeridi yok');
});

// ---- h-15: ana süreç adı panelde görünmez -------------------------------------------------

test('h-15: model yanlışlıkla HA adı (ad) taşısa bile panel onu çizmez ya da saklamaz', async () => {
  const k = karo('light.x', 'Salon', { grup: 'isik', grupEtiketi: 'Işık', ad: 'Salon Tavan Lambası (HA uzun adı)' });
  const sayfa = await panelAc({ model: { gruplar: [{ kod: 'isik', etiket: 'Işık', karolar: [k] }], sonlar: [k], ust: {} } });
  const tum = sayfa.oge('icerik').bul(() => true);
  for (const o of tum) {
    assert.ok(!o.textContent.includes('HA uzun'), 'metin');
    assert.ok(!String(o.title).includes('HA uzun'), 'başlık');
    assert.ok(!JSON.stringify(o.attributes).includes('HA uzun'), 'öznitelik');
  }
  assert.match(BETIK, /function modelDuzelt/);
  assert.doesNotMatch(BETIK.slice(BETIK.indexOf('function modelDuzelt'), BETIK.indexOf('function tumKarolar')), /\bad:/, 'modelDuzelt beyaz listesinde ad yok');
});

// ---- h-31: palet ---------------------------------------------------------------------------

test('h-31: palette Enter basılı tutulurken seçili satırda dolum çubuğu (basili sınıfı) görünür; bırakınca ve tamamlanınca kalkar', async () => {
  const sayfa = await paletAc();
  const arama = sayfa.oge('arama');
  arama.value = 'pc kapat';
  arama.gonder('input');
  const satir = paletSatirlari(sayfa)[0];
  assert.equal(sinifli(satir, 'basili'), false);
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  assert.equal(sinifli(satir, 'basili'), true, 'basılı tutarken çubuk dolar');
  assert.equal(sinifli(paletSatirlari(sayfa)[0], 'secili'), true, 'çubuk seçili satırda');
  sayfa.zaman.ilerle(300);
  arama.gonder('keyup', { key: 'Enter' });
  assert.equal(sinifli(satir, 'basili'), false, 'erken bırakınca kalkar');
  arama.gonder('keydown', { key: 'Enter', repeat: false });
  sayfa.zaman.ilerle(810);
  assert.equal(sinifli(satir, 'basili'), false, 'tamamlanınca kalkar');
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'button.pc_bilgisayari_kapat', basili: true }]);
});

test('h-31: "çok sık" ve "onay gerekli" yanıtlarında palet KAPANMAZ ve uyarı görünür; başarıda ve diğer hatalarda yanıttan sonra kapanır', async () => {
  const durumlar = [
    [{ ok: false, tur: 'cok-sik' }, false, /Çok sık; biraz bekleyin/],
    [{ ok: false, tur: 'onay-gerekli' }, false, /“Ampul” için Enter’ı basılı tutun/],
    [{ ok: false, tur: 'ha-hatasi' }, true, /“Ampul” çalıştırılamadı/],
    [{ ok: true }, true, /^$/],
  ];
  for (const [yanit, kapanir, metin] of durumlar) {
    const sayfa = await paletAc({ calistirYaniti: yanit });
    const arama = sayfa.oge('arama');
    arama.value = 'ampul';
    arama.gonder('input');
    arama.gonder('keydown', { key: 'Enter', repeat: false });
    assert.equal(kapatSayisi(sayfa), 0, `${yanit.tur ?? 'ok'}: yanıt gelmeden kapanmaz`);
    await akit();
    assert.equal(kapatSayisi(sayfa), kapanir ? 1 : 0, `${yanit.tur ?? 'ok'}: kapanma`);
    assert.match(sayfa.oge('ipucu').textContent, metin);
    if (!kapanir) {
      assert.ok(paletSatirlari(sayfa).length > 0, 'liste yerinde');
      sayfa.zaman.ilerle(3000);
      assert.equal(sayfa.oge('ipucu').textContent, '', 'uyarı kısa sürede silinir');
    }
  }
});

test('h-31: yıkıcı eylem tamamlanınca palet yanıta göre kapanır; "çok sık" yanıtında açık kalır; başka gösterime geçilmişse geç yanıt kapatmaz', async () => {
  const sik = await paletAc({ calistirYaniti: { ok: false, tur: 'cok-sik' } });
  sik.oge('arama').value = 'pc kapat';
  sik.oge('arama').gonder('input');
  sik.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  sik.zaman.ilerle(810);
  await akit();
  assert.equal(kapatSayisi(sik), 0);
  assert.match(sik.oge('ipucu').textContent, /Çok sık/);

  let coz;
  const sayfa = await paletAc({
    calistirYaniti: () =>
      new Promise((r) => {
        coz = r;
      }),
  });
  sayfa.oge('arama').value = 'ampul';
  sayfa.oge('arama').gonder('input');
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  sayfa.goster('palet'); // palet kapandı ve yeniden açıldı
  coz({ ok: true });
  await akit();
  assert.equal(kapatSayisi(sayfa), 0, 'eski gösterimin yanıtı yeni gösterimi kapatmaz');
});

test('h-31: IME yazımı sürerken (isCompositing / keyCode 229) Enter, oklar ve Esc yok sayılır; yazım bitince normal çalışır', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const arama = sayfa.oge('arama');
  const secili = () => paletSatirlari(sayfa).findIndex((s) => sinifli(s, 'secili'));
  for (const ek of [{ isComposing: true }, { keyCode: 229 }]) {
    const enter = arama.gonder('keydown', { key: 'Enter', repeat: false, ...ek });
    assert.equal(enter.onlendi, undefined, 'IME Enter\'ı engellenmez (IME onu kullanır)');
    arama.gonder('keydown', { key: 'ArrowDown', ...ek });
    arama.gonder('keydown', { key: 'Escape', ...ek });
    sayfa.belgeOlayi('keydown', { key: 'Escape', target: sayfa.oge('icerik'), ...ek });
  }
  assert.deepEqual(sayfa.calistirmalar(), []);
  assert.equal(secili(), 0);
  assert.equal(kapatSayisi(sayfa), 0);
  arama.gonder('keydown', { key: 'ArrowDown', isComposing: false });
  assert.equal(secili(), 1);
  arama.gonder('keydown', { key: 'Enter', repeat: false, isComposing: false });
  assert.equal(sayfa.calistirmalar().length, 1);
});

// ---- g-02: hazır seviyeler -----------------------------------------------------------------

test('g-02: vurgu ışığın o anki seviyesine en yakın hazır düğmededir (eşitlikte düşük olan); kapalı/bilinmeyen seviyede hiçbiri; "sık" işareti her zaman yalnız %20', async () => {
  const durumlar = [
    [{ durum: 'acik', yuzde: 18 }, '%20'],
    [{ durum: 'acik', yuzde: 5 }, '%10'],
    [{ durum: 'acik', yuzde: 35 }, '%20'],
    [{ durum: 'acik', yuzde: 36 }, '%50'],
    [{ durum: 'acik', yuzde: 75 }, '%50'],
    [{ durum: 'acik', yuzde: 80 }, '%100'],
    [{ durum: 'acik', yuzde: 100 }, '%100'],
    [{ durum: 'kapali', yuzde: null }, null],
    [{ durum: 'acik', yuzde: null }, null],
    [{ durum: 'yok', yuzde: null }, null],
  ];
  for (const [ek, beklenen] of durumlar) {
    const isik = karo('light.led_serit', 'LED şerit', { grup: 'isik', grupEtiketi: 'Işık', parlaklikKontrol: true, ...ek });
    const sayfa = await panelAc({ model: { gruplar: [{ kod: 'isik', etiket: 'Işık', karolar: [isik] }], sonlar: [], ust: {} } });
    const hazirlar = sayfa.oge('icerik').bul((o) => sinifli(o, 'hazir'));
    assert.deepEqual(hazirlar.filter((h) => sinifli(h, 'vurgu')).map((h) => h.textContent), beklenen ? [beklenen] : [], JSON.stringify(ek));
    assert.deepEqual(hazirlar.filter((h) => sinifli(h, 'sik')).map((h) => h.textContent), ['%20'], 'sık kullanılan işareti ayrı sınıfta');
  }
  const css = oku('src/yuzey.css');
  assert.match(kuralGovdesi(css, '.hazir.vurgu'), /border-color/);
  assert.doesNotMatch(kuralGovdesi(css, '.hazir.sik'), /border-color|font-weight/, '"sık" işareti seviye vurgusuyla aynı görünümde değil');
  assert.match(kuralGovdesi(css, '.hazir.sik::after'), /opacity/, 'silik');
});

// ---- g-04: yedek mod ------------------------------------------------------------------------

test('g-04: yedek/bağlanıyor modunda başlıkta "Durumlar eski olabilir" rozeti çıkar; canlı ve ayarla kapalıyken çıkmaz', async () => {
  const bagli = (baglanti) => ({ ...MODEL, ust: { canli: baglanti === 'canli', baglanti, medyaCaliyor: null, aktifCikis: null, hata: null } });
  for (const [baglanti, rozet] of [['canli', false], ['kapali', false], ['yedek', true], ['baglaniyor', true]]) {
    const sayfa = await panelAc({ model: bagli(baglanti) });
    assert.equal(sayfa.oge('eski').hidden, !rozet, baglanti);
  }
  assert.match(HTML, /id="eski"[^>]*>Durumlar eski olabilir</);
  const sayfa = await panelAc({ model: bagli('yedek') });
  sayfa.durum(bagli('canli'));
  assert.equal(sayfa.oge('eski').hidden, true, 'bağlantı geri gelince rozet kalkar');
});

test('g-04: yedek modda KAROLAR soluklaşmaz (opacity yok); yalnız durum metni hafif solar ve kontrastı >= 4,5 kalır (CSS)', () => {
  const css = oku('src/yuzey.css');
  const soluk = kurallar(css).filter((k) => k.secici.includes('.kok.soluk'));
  assert.ok(soluk.length >= 1);
  for (const k of soluk) {
    assert.doesNotMatch(k.govde, /opacity/, `${k.secici}: karoyu/ışık kutusunu soluklaştıran opacity yok`);
    assert.match(k.secici, /karo-durum/, 'yalnız durum metni etkilenir');
  }
  const { koyu, acik } = temalar(css);
  for (const tema of [koyu, acik]) {
    assert.ok(kontrast(tema['--soluk-eski'], tema['--karo']) >= 4.5, 'eski durum metni --karo üzerinde okunur');
    assert.ok(kontrast(tema['--acik-eski'], tema['--karo']) >= 4.5, 'eski "açık" durum metni --karo üzerinde okunur');
  }
});

// ---- g-05: palet seçili satır ---------------------------------------------------------------

test('g-05: palette seçili satırın sol şeridi/çerçevesi var; eşleşen harf ve yıkıcı etiket renkleri seçili zeminde >= 4,5 (iki temada)', () => {
  const css = oku('src/yuzey.css');
  assert.match(kuralGovdesi(css, '.palet-satir.secili'), /inset 3px 0 0/, 'sol vurgu şeridi');
  assert.match(kuralGovdesi(css, '.palet-satir.secili'), /inset 0 0 0 1px/, 'ince çerçeve');
  assert.match(kuralGovdesi(css, '.palet-etiket mark'), /var\(--vurgu-metin\)/);
  assert.match(kuralGovdesi(css, '.palet-satir.yikici .palet-etiket'), /var\(--yikici-metin\)/);
  const { koyu, acik } = temalar(css);
  for (const [ad, tema] of [['koyu', koyu], ['açık', acik]]) {
    for (const zemin of ['--karo-uzerinde', '--karo', '--bg']) {
      assert.ok(kontrast(tema['--vurgu-metin'], tema[zemin]) >= 4.5, `${ad}: eşleşen harf ${zemin} üzerinde`);
      assert.ok(kontrast(tema['--yikici-metin'], tema[zemin]) >= 4.5, `${ad}: yıkıcı etiket ${zemin} üzerinde`);
    }
    assert.ok(kontrast(tema['--soluk-secili'], tema['--karo-uzerinde']) >= 4.5, `${ad}: seçili satırda grup/durum metni`);
  }
});

// ---- g-07: Onaylı en altta --------------------------------------------------------------------

test('g-07: panelde "Onaylı" grubu en alta (Diğer\'in altına) çizilir', async () => {
  const diger = karo('switch.priz', 'Priz');
  const model = {
    gruplar: [
      { kod: 'isik', etiket: 'Işık', karolar: [AMPUL] },
      { kod: 'diger', etiket: 'Diğer', karolar: [diger] },
      { kod: 'onayli', etiket: 'Onaylı', karolar: [PC_KAPAT] },
    ],
    sonlar: [],
    ust: {},
  };
  const sayfa = await panelAc({ model });
  assert.deepEqual(sayfa.oge('icerik').bul((o) => o.className === 'bolum-baslik').map((o) => o.textContent), ['Işık', 'Diğer', 'Onaylı']);
  const bolumler = sayfa.oge('icerik').bul((o) => o.etiket === 'section');
  assert.match(bolumler.at(-1).className, /\bgrup-onayli\b/);
});

// ---- g-08: karo ipuçları ----------------------------------------------------------------------

test('g-08: yıkıcı karoda kalıcı "basılı tut" alt yazısı vardır, diğer karolarda yoktur', async () => {
  const sayfa = await panelAc();
  const ipuclari = sayfa.oge('icerik').bul((o) => o.className === 'karo-ipucu');
  assert.equal(ipuclari.length, 1);
  assert.equal(ipuclari[0].textContent, 'basılı tut');
  assert.ok(dugmeBul(sayfa, 'PC kapat').children.includes(ipuclari[0]));
  assert.equal(dugmeBul(sayfa, 'Ampul').bul((o) => o.className === 'karo-ipucu').length, 0);
});

test('g-08: başarılı eylemden sonra karoda 1 sn "basari" (yeşil çerçeve); hata/çok sık/ara değerler/tekrarlı karo işaretlenmez; yıkıcı tamamlanınca da işaret', async () => {
  const sayfa = await panelAc();
  const ampul = dugmeBul(sayfa, 'Ampul');
  ampul.gonder('click', { detail: 1 });
  await akit();
  assert.equal(sinifli(ampul, 'basari'), true);
  sayfa.zaman.ilerle(999);
  assert.equal(sinifli(ampul, 'basari'), true);
  sayfa.zaman.ilerle(2);
  assert.equal(sinifli(ampul, 'basari'), false, '1 sn sonra kalkar');

  const hazir = hazirBul(sayfa, '%20');
  hazir.gonder('click');
  await akit();
  assert.equal(sinifli(hazir, 'basari'), true, 'hazır seviye (son değer) başarılı');

  const aralik = sayfa.oge('icerik').bul((o) => o.type === 'range')[0];
  aralik.value = 70;
  aralik.gonder('input'); // ara değer: sonDeger:false
  await akit();
  assert.equal(sinifli(aralik, 'basari'), false, 'kaydırıcı ara değerleri yanıp sönmez');

  const ses = dugmeBul(sayfa, 'Ses +');
  ses.gonder('click', { detail: 0 });
  await akit();
  assert.equal(sinifli(ses, 'basari'), false, 'basılı tutulan ses +/- yeşil yanıp sönmez');

  const pc = dugmeBul(sayfa, 'PC kapat');
  pc.gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(810);
  await akit();
  assert.equal(sinifli(pc, 'basari'), true, 'basılı tutma tamamlanıp eylem başarılı olunca');

  const hatali = await panelAc({ calistirYaniti: { ok: false, tur: 'ha-hatasi' } });
  const h = dugmeBul(hatali, 'Ampul');
  h.gonder('click', { detail: 1 });
  await akit();
  assert.equal(sinifli(h, 'basari'), false);
  assert.equal(sinifli(h, 'hata'), true);
});

test('g-08: her grubun başlığına CSS ile (süs, ekran okuyucuya girmeden) küçük simge eklenir; metin değişmez', async () => {
  const css = oku('src/yuzey.css');
  const { GRUPLAR } = require('../src/lib/favoriler');
  for (const kod of [...GRUPLAR.map((g) => g.kod), 'onayli']) {
    const govde = kuralGovdesi(css, `.grup-${kod} .bolum-baslik::before`);
    assert.match(govde, /content:\s*"[^"]+"\s*\/\s*""/, `${kod}: simge alt metinsiz (süs)`);
  }
  assert.match(kuralGovdesi(css, '.bolum.son .bolum-baslik::before'), /content/);
  const sayfa = await panelAc();
  assert.deepEqual(sayfa.oge('icerik').bul((o) => o.className === 'bolum-baslik').map((o) => o.textContent), ['Son kullanılanlar', 'Işık', 'Sahne', 'PC', 'Medya']);
});

// ---- g-13: yazı boyutu (pencere ölçeklenince yükseklik yeniden ölçülür) ------------------------------

test('g-13: pencere yeniden boyutlanınca (yakınlaştırma) içerik yüksekliği yeniden ölçülüp bildirilir', async () => {
  const sayfa = await panelAc();
  sayfa.oge('kok').offsetHeight = 300;
  sayfa.goster('panel');
  sayfa.zaman.ilerle(5);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'boyut').at(-1)[1], 300);
  sayfa.oge('kok').offsetHeight = 380;
  sayfa.pencereOlayi('resize');
  sayfa.zaman.ilerle(5);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'boyut').at(-1)[1], 380);
  sayfa.pencereOlayi('resize'); // yükseklik değişmedi: yeni bildirim yok
  sayfa.zaman.ilerle(5);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'boyut').length, 2);
});

// ---- g-01: açık tema ---------------------------------------------------------------------------

test('g-01: panel, palet ve köşe bildirimi color-scheme bildirir ve prefers-color-scheme: light ile açık temaya geçer; renkler yalnız değişkenlerdedir', () => {
  for (const [dosya, html] of [['src/yuzey.css', 'src/yuzey.html'], ['src/kose-bildirim.css', 'src/kose-bildirim.html']]) {
    const css = oku(dosya);
    assert.match(oku(html), /<meta name="color-scheme" content="dark light">/, `${html}: color-scheme meta`);
    const { koyu, acik } = temalar(css);
    assert.ok(Object.keys(koyu).length > 0 && Object.keys(acik).length > 0, `${dosya}: iki tema değişkenleri`);
    assert.deepEqual(Object.keys(acik).filter((d) => !(d in koyu)), [], `${dosya}: açık temada olup koyuda olmayan değişken yok`);
    for (const d of Object.keys(koyu)) assert.ok(d in acik, `${dosya}: ${d} açık temada da tanımlı`);
    assert.match(css, /color-scheme:\s*dark;/);
    assert.match(acikTemaBlogu(css).ic, /color-scheme:\s*light;/);
    // :root blokları dışında sabit renk (hex / rgb) yok
    const disarida = kurallar(css)
      .filter((k) => !k.secici.startsWith(':root'))
      .map((k) => k.govde)
      .join('\n');
    assert.doesNotMatch(disarida, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${dosya}: bileşen kuralları renk değişkeni kullanır`);
    // yarı saydam malzeme açık temada da var (iki tema için ayrı)
    assert.match(acikTemaBlogu(css).ic, /:root\[data-malzeme\]/, `${dosya}: açık tema malzemesi`);
  }
});

test('g-01: metin renkleri iki temada da zeminlerinde WCAG 4,5:1 sağlar (panel ve köşe bildirimi)', () => {
  const css = oku('src/yuzey.css');
  const { koyu, acik } = temalar(css);
  const ciftler = [
    ['--metin', '--bg'], ['--metin', '--bg-ust'], ['--metin', '--karo'], ['--metin', '--karo-uzerinde'],
    ['--soluk', '--bg'], ['--soluk', '--bg-ust'], ['--soluk', '--karo'],
    ['--acik', '--bg'], ['--acik', '--karo'], ['--acik', '--bg-ust'],
    ['--rozet-metin', '--vurgu'], ['--rozet-metin', '--yikici'], ['--rozet-metin', '--hata'], ['--rozet-metin', '--yedek'], ['--rozet-metin', '--canli'],
  ];
  for (const [ad, tema] of [['koyu', koyu], ['açık', acik]]) {
    for (const [on, arka] of ciftler) {
      assert.ok(kontrast(tema[on], tema[arka]) >= 4.5, `${ad}: ${on} / ${arka} = ${kontrast(tema[on], tema[arka]).toFixed(2)}`);
    }
  }
  const kose = temalar(oku('src/kose-bildirim.css'));
  for (const [ad, tema] of [['koyu', kose.koyu], ['açık', kose.acik]]) {
    assert.ok(kontrast(tema['--metin'], tema['--bg']) >= 4.5, `köşe ${ad}: metin`);
    assert.ok(kontrast(tema['--isaret-metin'], tema['--basari']) >= 4.5, `köşe ${ad}: ✓ simgesi`);
    assert.ok(kontrast(tema['--isaret-metin'], tema['--hata']) >= 4.5, `köşe ${ad}: ! simgesi`);
  }
});

// ---- k-03: boş durum ----------------------------------------------------------------------------

test('k-03: boş panelde "anahtar yok" ile "favori yok" ayrılır; ikisinde de "Ayarlar’ı aç" düğmesi ayarları açar', async () => {
  const anahtarsiz = await panelAc({ model: { gruplar: [], sonlar: [], ust: { anahtarYok: true } } });
  assert.match(anahtarsiz.oge('icerik').textContent, /Erişim anahtarı eklenmemiş/);
  assert.doesNotMatch(anahtarsiz.oge('icerik').textContent, /Henüz favori yok/);
  const dugme = anahtarsiz.oge('icerik').bul((o) => o.etiket === 'button')[0];
  assert.equal(dugme.textContent, 'Ayarlar’ı aç');
  dugme.gonder('click');
  assert.equal(ayarlarAcSayisi(anahtarsiz), 1);

  const favorisiz = await panelAc({ model: { gruplar: [], sonlar: [], ust: { anahtarYok: false } } });
  assert.match(favorisiz.oge('icerik').textContent, /Henüz favori yok/);
  assert.doesNotMatch(favorisiz.oge('icerik').textContent, /anahtarı eklenmemiş/);
  favorisiz.oge('icerik').bul((o) => o.etiket === 'button')[0].gonder('click');
  assert.equal(ayarlarAcSayisi(favorisiz), 1);
  // klavyeyle de: ok tuşu gezintisine girer
  favorisiz.odakVer(favorisiz.oge('icerik'));
  favorisiz.belgeOlayi('keydown', { key: 'ArrowDown', target: favorisiz.oge('icerik') });
  assert.equal(favorisiz.odakta(), favorisiz.oge('icerik').bul((o) => o.etiket === 'button')[0]);
});

test('k-03: palette boş durumda aynı iki mesaj ve Ayarlar düğmesi var; boş durumda Enter Ayarlar\'ı açar; aramada sonuç yoksa düğme yok', async () => {
  const anahtarsiz = await paletAc({ model: { gruplar: [], sonlar: [], ust: { anahtarYok: true } } });
  assert.match(anahtarsiz.oge('icerik').textContent, /Erişim anahtarı eklenmemiş/);
  anahtarsiz.oge('icerik').bul((o) => o.etiket === 'button')[0].gonder('click');
  assert.equal(ayarlarAcSayisi(anahtarsiz), 1, 'palette bugüne dek hiç olmayan Ayarlar yolu');

  const favorisiz = await paletAc({ model: { gruplar: [], sonlar: [], ust: {} } });
  assert.match(favorisiz.oge('icerik').textContent, /Henüz favori yok/);
  favorisiz.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.equal(ayarlarAcSayisi(favorisiz), 1, 'Enter ile de açılır');

  const aramali = await paletAc();
  aramali.oge('arama').value = 'zzzzzz';
  aramali.oge('arama').gonder('input');
  assert.match(aramali.oge('icerik').textContent, /Eşleşen eylem yok/);
  assert.equal(aramali.oge('icerik').bul((o) => o.etiket === 'button').length, 0);
  aramali.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  assert.equal(ayarlarAcSayisi(aramali), 0, 'sonuçsuz arama Ayarlar açmaz');
});

// ---- k-08: palet ipucu şeridi, Home/End, parlaklık uyarısı ---------------------------------------

test('k-08: palet altında "Enter çalıştır · Shift+Enter seviye · Enter’ı basılı tut onay" şeridi vardır (palette görünür, panelde gizli) ve arama kutusuna bağlıdır', () => {
  assert.match(HTML, /id="paletSerit"[^>]*>Enter çalıştır · Shift\+Enter seviye · Enter’ı basılı tut onay</);
  assert.match(HTML, /id="arama"[^>]*aria-describedby="paletSerit"/);
  const css = oku('src/yuzey.css');
  assert.match(kuralGovdesi(css, '.mod-panel .palet-serit'), /display:\s*none/);
  assert.doesNotMatch(kuralGovdesi(css, '.mod-palet .alt'), /^$/);
  assert.doesNotMatch(css.slice(css.indexOf('.mod-palet .ust')), /\.mod-palet \.palet-serit/, 'palette gizlenmez');
});

test('k-08: palette Home/End ilk/son satırı seçer (değiştirici tuşla varsayılan kalır)', async () => {
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const arama = sayfa.oge('arama');
  const secili = () => paletSatirlari(sayfa).findIndex((s) => sinifli(s, 'secili'));
  const end = arama.gonder('keydown', { key: 'End' });
  assert.equal(secili(), 4);
  assert.equal(end.onlendi, true);
  arama.gonder('keydown', { key: 'Home' });
  assert.equal(secili(), 0);
  const kaydirmali = arama.gonder('keydown', { key: 'End', shiftKey: true });
  assert.equal(secili(), 0, 'Shift+End metin seçimi için bırakılır');
  assert.equal(kaydirmali.onlendi, undefined);
  arama.gonder('keydown', { key: 'Home', ctrlKey: true });
  assert.equal(secili(), 0);
  // sonuç yokken Home/End varsayılanı bozmaz
  arama.value = 'zzzzzz';
  arama.gonder('input');
  assert.equal(arama.gonder('keydown', { key: 'End' }).onlendi, undefined);
});

test('k-08: arama sonucu "parlaklikDesteklenmiyor" derse ilk satırda uyarı rozeti görünür; yoksa görünmez', async () => {
  const yama = (ea) => {
    const eski = ea.paletSorgusu;
    ea.paletSorgusu = (sorgu, ogeler) => ({ ...eski(sorgu, ogeler), parlaklikDesteklenmiyor: true });
  };
  const sayfa = await paletAc({ aramaYama: yama });
  sayfa.oge('arama').value = 'ampul';
  sayfa.oge('arama').gonder('input');
  const satirlar = paletSatirlari(sayfa);
  assert.ok(satirlar.length >= 1);
  assert.match(satirlar[0].textContent, /Parlaklık desteklenmiyor/);
  for (const s of satirlar.slice(1)) assert.doesNotMatch(s.textContent, /Parlaklık desteklenmiyor/);

  // Parlaklığı destekleyen öğede sayı varken ya da sayı hiç yokken rozet çıkmaz.
  for (const sorgu of ['led 40', 'ampul']) {
    const normal = await paletAc();
    normal.oge('arama').value = sorgu;
    normal.oge('arama').gonder('input');
    assert.ok(paletSatirlari(normal).length >= 1, sorgu);
    assert.doesNotMatch(normal.oge('icerik').textContent, /desteklenmiyor/, sorgu);
  }
});

// ---- k-16: erişilebilirlik ------------------------------------------------------------------------

test('k-16: arama kutusu combobox, içerik alanı palette listbox, satırlar option; seçili satır aria-activedescendant ile duyurulur', async () => {
  assert.match(HTML, /id="arama"[^>]*role="combobox"/);
  assert.match(HTML, /id="arama"[^>]*aria-controls="icerik"/);
  assert.match(HTML, /id="arama"[^>]*aria-autocomplete="list"/);
  const sayfa = await paletAc({ model: { ...MODEL, sonlar: [] } });
  const arama = sayfa.oge('arama');
  assert.equal(sayfa.oge('icerik').attributes.role, 'listbox');
  assert.ok(sayfa.oge('icerik').attributes['aria-label']);
  const satirlar = paletSatirlari(sayfa);
  assert.deepEqual(satirlar.map((s) => s.attributes.role), Array(5).fill('option'));
  assert.deepEqual(satirlar.map((s) => s.id), ['palet-satir-0', 'palet-satir-1', 'palet-satir-2', 'palet-satir-3', 'palet-satir-4']);
  assert.equal(arama.attributes['aria-activedescendant'], 'palet-satir-0');
  assert.deepEqual(satirlar.map((s) => s.attributes['aria-selected']), ['true', 'false', 'false', 'false', 'false']);
  arama.gonder('keydown', { key: 'ArrowDown' });
  assert.equal(arama.attributes['aria-activedescendant'], 'palet-satir-1');
  assert.deepEqual(paletSatirlari(sayfa).map((s) => s.attributes['aria-selected']), ['false', 'true', 'false', 'false', 'false']);
  arama.gonder('keydown', { key: 'ArrowUp' });

  // seviye seçimi: etkin öğe seviye düğmesidir
  arama.gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false });
  assert.equal(arama.attributes['aria-activedescendant'], 'palet-seviye-0');
  arama.gonder('keydown', { key: 'ArrowRight' });
  assert.equal(arama.attributes['aria-activedescendant'], 'palet-seviye-1');
  const seviyeler = sayfa.oge('icerik').bul((o) => (o.id ?? '').startsWith('palet-seviye-'));
  assert.deepEqual(seviyeler.map((s) => s.attributes['aria-selected']), ['false', 'true', 'false', 'false']);
  assert.ok(seviyeler.every((s) => s.attributes.role === 'option'));
  arama.gonder('keydown', { key: 'Escape' });
  assert.equal(arama.attributes['aria-activedescendant'], 'palet-satir-0', 'seviye satırı kapanınca etkin öğe satıra döner');

  // sonuç yokken etkin öğe yok; panel kipinde listbox/etkin öğe kalkar
  arama.value = 'zzzzzz';
  arama.gonder('input');
  assert.equal('aria-activedescendant' in arama.attributes, false);
  sayfa.goster('panel');
  assert.equal('role' in sayfa.oge('icerik').attributes, false, 'panelde içerik alanı listbox değildir');
  assert.equal('aria-activedescendant' in arama.attributes, false);
});

test('k-16: açık/kapalı karolar aria-pressed taşır; sahne, yıkıcı ve tekrarlı karolar taşımaz; dekoratif simgeler aria-hidden', async () => {
  const ust = { canli: false, baglanti: 'yedek', medyaCaliyor: true, aktifCikis: 'hoparlor', hata: 'bağlantı yok', uyari: null };
  const sayfa = await panelAc({ model: { ...MODEL, ust } });
  assert.equal(dugmeBul(sayfa, 'LED şerit').attributes['aria-pressed'], 'true');
  assert.equal(dugmeBul(sayfa, 'Ampul').attributes['aria-pressed'], 'false');
  for (const ad of ['PC kapat', 'Ses +']) assert.equal('aria-pressed' in dugmeBul(sayfa, ad).attributes, false, ad);
  const sahne = sayfa.oge('icerik').bul((o) => o.etiket === 'button' && o.textContent.startsWith('Film') && !sinifli(o, 'son-oge'))[0];
  assert.equal('aria-pressed' in sahne.attributes, false, 'sahne düğmesinin durumu yok');
  // durum gelince aria-pressed güncellenir
  const m = { ...kopya(MODEL), ust };
  m.gruplar[0].karolar[1].durum = 'acik';
  sayfa.durum(m);
  assert.equal(dugmeBul(sayfa, 'Ampul').attributes['aria-pressed'], 'true');
  // süsler
  const nota = sayfa.oge('medya').children[0];
  assert.equal(nota.textContent, '♪ ');
  assert.equal(nota.attributes['aria-hidden'], 'true');
  assert.equal(sayfa.oge('serit').bul((o) => o.className === 'serit-simge')[0].attributes['aria-hidden'], 'true');
  assert.match(HTML, /id="serit"[^>]*role="status"/);
});

// ---- arayüz dili: İngilizce ve çalışma anında dil değişimi ----------------------------------------
// Karo adları ve grup başlıkları ana süreçte seçili dilde yazılır (burada İngilizce model verilir); sayfa kendi metinlerini çevirir.

const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
const EN_ISIK = karo('light.led_strip', 'LED strip', { grup: 'isik', grupEtiketi: 'Light', durum: 'acik', yuzde: 60, parlaklikKontrol: true });
const EN_AMPUL = karo('light.bulb', 'Bulb', { grup: 'isik', grupEtiketi: 'Light' });
const EN_SAHNE = karo('scene.movie', 'Movie', { grup: 'sahne', grupEtiketi: 'Scene', durum: 'notr' });
const EN_PC = karo('button.pc_shutdown', 'Shut down PC', { grup: 'pc', grupEtiketi: 'PC', sinif: 'yikici', durum: 'notr' });
const EN_UST = { canli: true, baglanti: 'canli', medyaCaliyor: true, aktifCikis: 'kulaklik', hata: null };
const EN_MODEL = {
  gruplar: [
    { kod: 'isik', etiket: 'Light', karolar: [EN_ISIK, EN_AMPUL] },
    { kod: 'sahne', etiket: 'Scene', karolar: [EN_SAHNE] },
    { kod: 'pc', etiket: 'PC', karolar: [EN_PC] },
  ],
  sonlar: [EN_SAHNE],
  ust: EN_UST,
};

/** Sayfada o an görünür olabilecek bütün metinler ve erişilebilirlik öznitelikleri (sayfa başlığı dahil). */
function gorunurMetinler(sayfa) {
  const metinler = [];
  const ekle = (m) => {
    if (m) metinler.push(String(m));
  };
  for (const kimlik of ['baslik', 'medya', 'baglanti', 'eski', 'serit', 'ipucu', 'paletSerit', 'haAc', 'ayarlarAc']) {
    ekle(sayfa.oge(kimlik).textContent);
    ekle(sayfa.oge(kimlik).title);
  }
  ekle(sayfa.oge('arama').attributes.placeholder);
  ekle(sayfa.oge('arama').attributes['aria-label']);
  ekle(sayfa.htmlBasligi().textContent);
  const icerik = sayfa.oge('icerik');
  ekle(icerik.attributes['aria-label']);
  for (const o of icerik.bul(() => true)) {
    if (o.children.length === 0) ekle(o.textContent);
    ekle(o.title);
    ekle(o.attributes['aria-label']);
  }
  return metinler;
}

const turkceKalan = (sayfa) => gorunurMetinler(sayfa).filter((m) => TURKCE_HARF.test(m));
const yazilar = (sayfa, sinif) => sayfa.oge('icerik').bul((o) => o.className === sinif).map((o) => o.textContent);

test('dil en: sabit ve dinamik panel metinleri İngilizce; Türkçe harfli görünür metin kalmaz (favori adları ve HA verisi hariç)', async () => {
  const sayfa = await panelAc({ model: EN_MODEL, dil: 'en' });
  assert.equal(sayfa.kok.nitelikler.lang, 'en');
  assert.equal(sayfa.htmlBasligi().textContent, 'Home Panel — Quick Panel');
  assert.equal(sayfa.oge('baslik').textContent, 'Home Panel');
  assert.equal(sayfa.oge('haAc').textContent, 'Open HA dashboard');
  assert.equal(sayfa.oge('ayarlarAc').textContent, 'Settings');
  assert.equal(sayfa.oge('arama').attributes.placeholder, 'Search actions…  (e.g. “light 40”)');
  assert.equal(sayfa.oge('arama').attributes['aria-label'], 'Search actions');
  assert.equal(sayfa.oge('paletSerit').textContent, 'Enter to run · Shift+Enter for level · Hold Enter to confirm');
  assert.equal(sayfa.oge('eski').textContent, 'Status may be out of date');
  assert.equal(sayfa.oge('baglanti').textContent, 'Live');
  assert.equal(sayfa.oge('medya').textContent, '♪ Playing · Headphones');
  assert.equal(sayfa.oge('medya').title, '♪ Playing · Headphones');
  assert.deepEqual(yazilar(sayfa, 'bolum-baslik'), ['Recently used', 'Light', 'Scene', 'PC']);
  assert.deepEqual(yazilar(sayfa, 'karo-durum'), ['60%', 'off', '', ''], 'durum metinleri: açık seviyesi, kapalı, nötr');
  assert.deepEqual(yazilar(sayfa, 'karo-ipucu'), ['hold to confirm']);
  assert.equal(dugmeBul(sayfa, 'Shut down PC').title, 'Shut down PC — hold to run');
  assert.equal(sayfa.oge('icerik').bul((o) => o.etiket === 'input')[0].attributes['aria-label'], 'LED strip brightness');
  assert.deepEqual(turkceKalan(sayfa), []);
});

test('dil en: bağlantı durumları, hata/uyarı şeridi (ilk harf İngilizce kurallarıyla büyür) ve medya çıkışları İngilizce', async () => {
  const durumlar = { canli: 'Live', baglaniyor: 'Connecting…', yedek: 'Fallback mode (refreshes every 60 s)', kapali: 'Live connection off' };
  for (const [baglanti, metin] of Object.entries(durumlar)) {
    const sayfa = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, baglanti } }, dil: 'en' });
    assert.equal(sayfa.oge('baglanti').textContent, metin, baglanti);
  }
  for (const bozuk of ['__proto__', 'toString', 'bilinmeyen', 7, null]) {
    const sayfa = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, baglanti: bozuk } }, dil: 'en' });
    assert.equal(sayfa.oge('baglanti').textContent, 'Live connection off', `bilinmeyen bağlantı durumu "kapalı" sayılır: ${String(bozuk)}`);
  }
  const sayfa = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, aktifCikis: 'hoparlor', hata: 'invalid token', uyari: 'invalid key rejected' } }, dil: 'en' });
  assert.equal(sayfa.oge('medya').textContent, '♪ Playing · Speaker');
  const satirlar = sayfa.oge('serit').bul((o) => o.className === 'serit-metin').map((o) => o.textContent);
  assert.deepEqual(satirlar, ['Invalid key rejected', 'Home Assistant: invalid token'], 'İngilizcede i -> I (Türkçedeki İ olmaz)');
  assert.equal((await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, medyaCaliyor: true, aktifCikis: null } }, dil: 'en' })).oge('medya').textContent, '♪ Playing');
  // Türkçede aynı metin Türkçe büyük harf kuralıyla yazılır (davranış değişmedi)
  const tr = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, uyari: 'invalid key rejected' } } });
  assert.equal(tr.oge('serit').bul((o) => o.className === 'serit-metin')[0].textContent, 'İnvalid key rejected');
});

test('dil en: boş durum iletileri ve Ayarlar düğmesi İngilizce (panel ve palet)', async () => {
  for (const [ust, ana, alt] of [
    [{ anahtarYok: true }, 'No access token added.', 'Enter your Home Assistant address and access token in Settings.'],
    [{ anahtarYok: false }, 'No favorites yet.', 'Choose favorites in Settings.'],
  ]) {
    for (const ac of [panelAc, paletAc]) {
      const sayfa = await ac({ model: { gruplar: [], sonlar: [], ust }, dil: 'en' });
      assert.deepEqual(yazilar(sayfa, 'bos-metin'), [ana]);
      assert.deepEqual(yazilar(sayfa, 'bos-alt'), [alt]);
      assert.deepEqual(yazilar(sayfa, 'bos-dugme'), ['Open Settings']);
      assert.deepEqual(turkceKalan(sayfa), []);
    }
  }
});

test('dil en: palet bölüm başlıkları, rozetler, seviye grubu, eşleşme yok ve aria etiketleri İngilizce', async () => {
  const sayfa = await paletAc({ model: EN_MODEL, dil: 'en' });
  assert.deepEqual(sayfa.oge('icerik').bul((o) => o.className === 'palet-baslik').map((o) => o.textContent), ['Recently used', 'Favorites']);
  assert.equal(sayfa.oge('icerik').attributes['aria-label'], 'Recently used and favorites');
  assert.deepEqual(yazilar(sayfa, 'rozet uyari'), ['Hold Enter'], 'yıkıcı satır rozeti');
  // "led 0" = kapat rozeti; sayıyı desteklemeyen öğede uyarı rozeti
  sayfa.oge('arama').value = 'led 0';
  sayfa.oge('arama').gonder('input');
  assert.deepEqual(yazilar(sayfa, 'rozet'), ['Turn off']);
  sayfa.oge('arama').value = 'bulb 40';
  sayfa.oge('arama').gonder('input');
  assert.ok(yazilar(sayfa, 'rozet sessiz').length >= 1);
  assert.ok(yazilar(sayfa, 'rozet sessiz').every((m) => m === 'Brightness not supported'));
  // Shift+Enter seviye grubu
  sayfa.oge('arama').value = 'led';
  sayfa.oge('arama').gonder('input');
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false });
  assert.equal(sayfa.oge('icerik').bul((o) => o.attributes.role === 'group')[0].attributes['aria-label'], 'Brightness level');
  assert.deepEqual(turkceKalan(sayfa), []);
  // sonuç yok
  sayfa.oge('arama').value = 'zzzzzz';
  sayfa.oge('arama').gonder('input');
  assert.deepEqual(yazilar(sayfa, 'bos'), ['No matching actions.']);
  assert.deepEqual(turkceKalan(sayfa), []);
});

test('dil en: ipucu satırı iletileri (onay, çok sık, çalıştırılamadı, gönderilemedi, basılı tutma) İngilizce', async () => {
  const ipucu = async (ac, yanit, olay) => {
    const sayfa = await ac({ model: EN_MODEL, dil: 'en', calistirYaniti: yanit });
    olay(sayfa);
    await akit();
    return sayfa.oge('ipucu').textContent;
  };
  const panelTikla = (sayfa) => dugmeBul(sayfa, 'Bulb').gonder('click', { detail: 1 });
  const paletEnter = (sayfa) => {
    sayfa.oge('arama').value = 'bulb';
    sayfa.oge('arama').gonder('input');
    sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  };
  assert.equal(await ipucu(panelAc, { ok: false, tur: 'onay-gerekli' }, panelTikla), 'Hold the button to run “Bulb”.');
  assert.equal(await ipucu(paletAc, { ok: false, tur: 'onay-gerekli' }, paletEnter), 'Hold Enter to run “Bulb”.');
  assert.equal(await ipucu(panelAc, { ok: false, tur: 'cok-sik' }, panelTikla), 'Too fast; wait a moment.');
  assert.equal(await ipucu(panelAc, { ok: false, tur: 'ha-hatasi' }, panelTikla), '“Bulb” could not be run.');
  assert.equal(await ipucu(panelAc, () => Promise.reject(new Error('x')), panelTikla), 'The action could not be sent.');
  // yıkıcı karoda basılı tutma: başlayınca ve erken bırakılınca
  const sayfa = await panelAc({ model: EN_MODEL, dil: 'en' });
  const d = dugmeBul(sayfa, 'Shut down PC');
  d.gonder('pointerdown', { button: 0 });
  assert.equal(sayfa.oge('ipucu').textContent, 'Running “Shut down PC”… keep holding.');
  sayfa.zaman.ilerle(300);
  d.gonder('pointerup');
  assert.equal(sayfa.oge('ipucu').textContent, 'Hold to run “Shut down PC”.');
});

// Almanca, Fransızca ve İspanyolca (1.4.0 o-35). ç/ö/ü bu dillerde de geçtiği için kalıntı denetimi Türkçeye özgü harflerle (ğ ı İ ş) yapılır.
const TURKCE_OZEL_HARF = /[ğıİşĞŞ]/;
const turkceOzelKalan = (sayfa) => gorunurMetinler(sayfa).filter((m) => TURKCE_OZEL_HARF.test(m));
const NBSP = '\u00A0';
const YENI_DIL_METINLERI = {
  de: {
    baslik: 'Home Panel — Schnellpanel', haAc: 'HA-Dashboard öffnen', ayarlar: 'Einstellungen', arama: 'Aktion suchen…  (z. B. „Licht 40“)', aramaEtiket: 'Aktion suchen',
    paletSerit: 'Enter ausführen · Shift+Enter Stufe · Enter gedrückt halten zum Bestätigen', eski: 'Status möglicherweise veraltet', canli: 'Live', medya: '♪ Wird abgespielt · Kopfhörer',
    son: 'Zuletzt verwendet', yuzde: '60 %', kapali: 'aus', ipucu: 'gedrückt halten', pcBaslik: 'Shut down PC — zum Ausführen gedrückt halten', parlaklik: 'Helligkeit von LED strip',
    bosAna: 'Kein Zugriffstoken hinzugefügt.', bosDugme: 'Einstellungen öffnen', favoriYok: 'Noch keine Favoriten.', hataSeridi: 'Home Assistant: invalid token',
    sonVeFavoriler: 'Zuletzt verwendet und Favoriten', kapatRozet: 'Ausschalten', desteklenmiyor: 'Helligkeit nicht unterstützt', basiliRozet: 'Enter gedrückt halten', seviye: 'Helligkeitsstufe', eslesmeYok: 'Keine passenden Aktionen.',
    onayPanel: 'Halte die Schaltfläche gedrückt, um „Bulb“ auszuführen.', onayPalet: 'Halte Enter gedrückt, um „Bulb“ auszuführen.', cokSik: 'Zu schnell; warte einen Moment.', calistirilamadi: '„Bulb“ konnte nicht ausgeführt werden.', gonderilemedi: 'Die Aktion konnte nicht gesendet werden.',
    basiliDevam: '„Shut down PC“ wird ausgeführt… weiter gedrückt halten.', basiliTutun: 'Zum Ausführen von „Shut down PC“ gedrückt halten.',
  },
  fr: {
    baslik: 'Home Panel — Panneau rapide', haAc: 'Ouvrir le tableau de bord HA', ayarlar: 'Paramètres', arama: 'Rechercher une action…  (p. ex. « lumière 40 »)', aramaEtiket: 'Rechercher une action',
    paletSerit: 'Entrée pour exécuter · Maj+Entrée pour le niveau · maintenir Entrée pour confirmer', eski: 'Les états sont peut-être obsolètes', canli: 'En direct', medya: '♪ Lecture en cours · Casque',
    son: 'Récemment utilisés', yuzde: '60 %', kapali: 'désactivé', ipucu: 'maintenir appuyé', pcBaslik: 'Shut down PC — maintenez appuyé pour exécuter', parlaklik: 'Luminosité de LED strip',
    bosAna: 'Aucun jeton d’accès ajouté.', bosDugme: 'Ouvrir les paramètres', favoriYok: 'Aucun favori pour l’instant.', hataSeridi: 'Home Assistant : invalid token',
    sonVeFavoriler: 'Récents et favoris', kapatRozet: 'Éteindre', desteklenmiyor: 'Luminosité non prise en charge', basiliRozet: 'Maintenir Entrée', seviye: 'Niveau de luminosité', eslesmeYok: 'Aucune action correspondante.',
    onayPanel: 'Maintenez le bouton enfoncé pour exécuter « Bulb ».', onayPalet: 'Maintenez Entrée pour exécuter « Bulb ».', cokSik: 'Trop rapide ; patientez un instant.', calistirilamadi: '« Bulb » n’a pas pu être exécuté.', gonderilemedi: 'L’action n’a pas pu être envoyée.',
    basiliDevam: 'Exécution de « Shut down PC »… continuez à maintenir appuyé.', basiliTutun: 'Maintenez appuyé pour exécuter « Shut down PC ».',
  },
  es: {
    baslik: 'Home Panel — Panel rápido', haAc: 'Abrir panel de HA', ayarlar: 'Configuración', arama: 'Buscar acción…  (p. ej. “luz 40”)', aramaEtiket: 'Buscar acción',
    paletSerit: 'Enter para ejecutar · Mayús+Enter para el nivel · mantén Enter para confirmar', eski: 'Los estados pueden estar desactualizados', canli: 'En vivo', medya: '♪ Reproduciendo · Auriculares',
    son: 'Usados recientemente', yuzde: '60 %', kapali: 'apagado', ipucu: 'mantén pulsado', pcBaslik: 'Shut down PC — mantén pulsado para ejecutar', parlaklik: 'Brillo de LED strip',
    bosAna: 'No se ha añadido ningún token de acceso.', bosDugme: 'Abrir configuración', favoriYok: 'Aún no hay favoritos.', hataSeridi: 'Home Assistant: invalid token',
    sonVeFavoriler: 'Usados recientemente y favoritos', kapatRozet: 'Apagar', desteklenmiyor: 'Brillo no compatible', basiliRozet: 'Mantén Enter', seviye: 'Nivel de brillo', eslesmeYok: 'No hay acciones coincidentes.',
    onayPanel: 'Mantén pulsado el botón para ejecutar “Bulb”.', onayPalet: 'Mantén Enter para ejecutar “Bulb”.', cokSik: 'Demasiado rápido; espera un momento.', calistirilamadi: 'No se pudo ejecutar “Bulb”.', gonderilemedi: 'No se pudo enviar la acción.',
    basiliDevam: 'Ejecutando “Shut down PC”… sigue manteniendo pulsado.', basiliTutun: 'Mantén pulsado para ejecutar “Shut down PC”.',
  },
};

// Fransızca tipografi: « » içinde ve ; : ? ! » öncesinde bölünmez boşluk (sözlükte \u00A0 olarak yazılır); tabloda okunaklı olsun diye düz boşlukla yazıldı.
for (const anahtar of Object.keys(YENI_DIL_METINLERI.fr)) {
  YENI_DIL_METINLERI.fr[anahtar] = YENI_DIL_METINLERI.fr[anahtar].replace(/« /g, `«${NBSP}`).replace(/ ([»;:?!])/g, `${NBSP}$1`);
}

test('dil de/fr/es: sabit ve dinamik panel metinleri o dilde; yüzde "60 %" yazılır; Türkçeye özgü harf kalmaz', async () => {
  for (const [dil, b] of Object.entries(YENI_DIL_METINLERI)) {
    const sayfa = await panelAc({ model: EN_MODEL, dil });
    assert.equal(sayfa.kok.nitelikler.lang, dil);
    assert.equal(sayfa.htmlBasligi().textContent, b.baslik, dil);
    assert.equal(sayfa.oge('baslik').textContent, 'Home Panel', `${dil}: uygulama adı çevrilmez`);
    assert.equal(sayfa.oge('haAc').textContent, b.haAc, dil);
    assert.equal(sayfa.oge('ayarlarAc').textContent, b.ayarlar, dil);
    assert.equal(sayfa.oge('arama').attributes['aria-label'], b.aramaEtiket, dil);
    assert.equal(sayfa.oge('eski').textContent, b.eski, dil);
    assert.equal(sayfa.oge('baglanti').textContent, b.canli, dil);
    assert.equal(sayfa.oge('medya').textContent, b.medya, dil);
    assert.equal(yazilar(sayfa, 'bolum-baslik')[0], b.son, dil);
    assert.deepEqual(yazilar(sayfa, 'karo-durum'), [b.yuzde, b.kapali, '', ''], `${dil}: durum metinleri`);
    assert.deepEqual(yazilar(sayfa, 'karo-ipucu'), [b.ipucu], dil);
    assert.equal(dugmeBul(sayfa, 'Shut down PC').title, b.pcBaslik, dil);
    assert.equal(sayfa.oge('icerik').bul((o) => o.etiket === 'input')[0].attributes['aria-label'], b.parlaklik, dil);
    assert.deepEqual(turkceOzelKalan(sayfa), [], `${dil}: Türkçeye özgü harf kalmamalı`);
    assert.doesNotMatch(gorunurMetinler(sayfa).join('\n'), /\b(?:yuzey|offline|kose|masaustu)\.[a-z]/i, `${dil}: çözülmemiş sözlük anahtarı kalmamalı`);
  }
  // arama ipucundaki örnek, dilin kendi örneği (Fransızcada « » aralarında bölünmez boşlukla)
  assert.equal((await panelAc({ model: EN_MODEL, dil: 'de' })).oge('arama').attributes.placeholder, YENI_DIL_METINLERI.de.arama);
  assert.equal((await panelAc({ model: EN_MODEL, dil: 'es' })).oge('arama').attributes.placeholder, YENI_DIL_METINLERI.es.arama);
  const frArama = (await panelAc({ model: EN_MODEL, dil: 'fr' })).oge('arama').attributes.placeholder;
  assert.equal(frArama, YENI_DIL_METINLERI.fr.arama);
  assert.ok(frArama.includes(`«${NBSP}lumière 40${NBSP}»`), 'tırnak içinde bölünmez boşluk');
});

test('dil de/fr/es: bağlantı durumları, hata/uyarı şeridi (ilk harf dilin kurallarıyla büyür) ve medya çıkışları o dilde', async () => {
  const durumlar = {
    de: { canli: 'Live', baglaniyor: 'Verbindung wird hergestellt…', yedek: 'Fallback-Modus (Aktualisierung alle 60 s)', kapali: 'Live-Verbindung aus', hoparlor: '♪ Wird abgespielt · Lautsprecher', yalnizca: '♪ Wird abgespielt' },
    fr: { canli: 'En direct', baglaniyor: 'Connexion en cours…', yedek: 'Mode de secours (actualisation toutes les 60 s)', kapali: 'Connexion en direct désactivée', hoparlor: '♪ Lecture en cours · Haut-parleur', yalnizca: '♪ Lecture en cours' },
    es: { canli: 'En vivo', baglaniyor: 'Conectando…', yedek: 'Modo de respaldo (se actualiza cada 60 s)', kapali: 'Conexión en vivo desactivada', hoparlor: '♪ Reproduciendo · Altavoz', yalnizca: '♪ Reproduciendo' },
  };
  for (const [dil, d] of Object.entries(durumlar)) {
    for (const baglanti of ['canli', 'baglaniyor', 'yedek', 'kapali']) {
      const sayfa = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, baglanti } }, dil });
      assert.equal(sayfa.oge('baglanti').textContent, d[baglanti], `${dil} ${baglanti}`);
    }
    const bozuk = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, baglanti: 'bilinmeyen' } }, dil });
    assert.equal(bozuk.oge('baglanti').textContent, d.kapali, `${dil}: bilinmeyen bağlantı durumu "kapalı" sayılır`);
    const sayfa = await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, aktifCikis: 'hoparlor', hata: 'invalid token', uyari: 'invalid key rejected' } }, dil });
    assert.equal(sayfa.oge('medya').textContent, d.hoparlor, dil);
    const satirlar = sayfa.oge('serit').bul((o) => o.className === 'serit-metin').map((o) => o.textContent);
    assert.deepEqual(satirlar, ['Invalid key rejected', YENI_DIL_METINLERI[dil].hataSeridi], `${dil}: i -> I (Türkçedeki İ olmaz)`);
    assert.equal((await panelAc({ model: { ...EN_MODEL, ust: { ...EN_UST, medyaCaliyor: true, aktifCikis: null } }, dil })).oge('medya').textContent, d.yalnizca, dil);
  }
});

test('dil de/fr/es: boş durum iletileri ve Ayarlar düğmesi o dilde (panel ve palet)', async () => {
  for (const [dil, b] of Object.entries(YENI_DIL_METINLERI)) {
    for (const ac of [panelAc, paletAc]) {
      const anahtarsiz = await ac({ model: { gruplar: [], sonlar: [], ust: { anahtarYok: true } }, dil });
      assert.deepEqual(yazilar(anahtarsiz, 'bos-metin'), [b.bosAna], dil);
      assert.deepEqual(yazilar(anahtarsiz, 'bos-dugme'), [b.bosDugme], dil);
      assert.equal(yazilar(anahtarsiz, 'bos-alt').length, 1, dil);
      assert.deepEqual(turkceOzelKalan(anahtarsiz), [], dil);
      const favorisiz = await ac({ model: { gruplar: [], sonlar: [], ust: { anahtarYok: false } }, dil });
      assert.deepEqual(yazilar(favorisiz, 'bos-metin'), [b.favoriYok], dil);
      assert.deepEqual(turkceOzelKalan(favorisiz), [], dil);
    }
  }
});

test('dil de/fr/es: palet bölüm başlıkları, rozetler, seviye grubu, eşleşme yok ve aria etiketleri o dilde', async () => {
  for (const [dil, b] of Object.entries(YENI_DIL_METINLERI)) {
    const sayfa = await paletAc({ model: EN_MODEL, dil });
    assert.equal(sayfa.oge('paletSerit').textContent, b.paletSerit, dil);
    assert.deepEqual(sayfa.oge('icerik').bul((o) => o.className === 'palet-baslik').map((o) => o.textContent)[0], b.son, dil);
    assert.equal(sayfa.oge('icerik').attributes['aria-label'], b.sonVeFavoriler, dil);
    assert.deepEqual(yazilar(sayfa, 'rozet uyari'), [b.basiliRozet], `${dil}: yıkıcı satır rozeti`);
    sayfa.oge('arama').value = 'led 0';
    sayfa.oge('arama').gonder('input');
    assert.deepEqual(yazilar(sayfa, 'rozet'), [b.kapatRozet], dil);
    sayfa.oge('arama').value = 'bulb 40';
    sayfa.oge('arama').gonder('input');
    assert.ok(yazilar(sayfa, 'rozet sessiz').length >= 1, dil);
    assert.ok(yazilar(sayfa, 'rozet sessiz').every((m) => m === b.desteklenmiyor), dil);
    sayfa.oge('arama').value = 'led';
    sayfa.oge('arama').gonder('input');
    sayfa.oge('arama').gonder('keydown', { key: 'Enter', shiftKey: true, repeat: false });
    assert.equal(sayfa.oge('icerik').bul((o) => o.attributes.role === 'group')[0].attributes['aria-label'], b.seviye, dil);
    assert.deepEqual(turkceOzelKalan(sayfa), [], dil);
    sayfa.oge('arama').value = 'zzzzzz';
    sayfa.oge('arama').gonder('input');
    assert.deepEqual(yazilar(sayfa, 'bos'), [b.eslesmeYok], dil);
  }
});

test('dil de/fr/es: ipucu satırı iletileri (onay, çok sık, çalıştırılamadı, gönderilemedi, basılı tutma) o dilde', async () => {
  for (const [dil, b] of Object.entries(YENI_DIL_METINLERI)) {
    const ipucu = async (ac, yanit, olay) => {
      const sayfa = await ac({ model: EN_MODEL, dil, calistirYaniti: yanit });
      olay(sayfa);
      await akit();
      return sayfa.oge('ipucu').textContent;
    };
    const panelTikla = (sayfa) => dugmeBul(sayfa, 'Bulb').gonder('click', { detail: 1 });
    const paletEnter = (sayfa) => {
      sayfa.oge('arama').value = 'bulb';
      sayfa.oge('arama').gonder('input');
      sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
    };
    assert.equal(await ipucu(panelAc, { ok: false, tur: 'onay-gerekli' }, panelTikla), b.onayPanel, dil);
    assert.equal(await ipucu(paletAc, { ok: false, tur: 'onay-gerekli' }, paletEnter), b.onayPalet, dil);
    assert.equal(await ipucu(panelAc, { ok: false, tur: 'cok-sik' }, panelTikla), b.cokSik, dil);
    assert.equal(await ipucu(panelAc, { ok: false, tur: 'ha-hatasi' }, panelTikla), b.calistirilamadi, dil);
    assert.equal(await ipucu(panelAc, () => Promise.reject(new Error('x')), panelTikla), b.gonderilemedi, dil);
    const sayfa = await panelAc({ model: EN_MODEL, dil });
    const d = dugmeBul(sayfa, 'Shut down PC');
    d.gonder('pointerdown', { button: 0 });
    assert.equal(sayfa.oge('ipucu').textContent, b.basiliDevam, dil);
    sayfa.zaman.ilerle(300);
    d.gonder('pointerup');
    assert.equal(sayfa.oge('ipucu').textContent, b.basiliTutun, dil);
  }
});

test('dil: çalışma anında tr -> de -> fr -> es -> en geçişi sabit metinleri çevirir ve açık paneli yeniden çizer; geri Türkçeye dönülür', async () => {
  const sayfa = await panelAc({ model: MODEL });
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı');
  for (const dil of ['de', 'fr', 'es']) {
    sayfa.dilDegisti({ dil });
    assert.equal(sayfa.kok.nitelikler.lang, dil);
    assert.equal(sayfa.oge('baglanti').textContent, YENI_DIL_METINLERI[dil].canli, dil);
    assert.equal(sayfa.oge('haAc').textContent, YENI_DIL_METINLERI[dil].haAc, dil);
    assert.equal(sayfa.htmlBasligi().textContent, YENI_DIL_METINLERI[dil].baslik, dil);
    assert.equal(yazilar(sayfa, 'bolum-baslik')[0], YENI_DIL_METINLERI[dil].son, `${dil}: açık panel yeni dille çizilir`);
    assert.deepEqual(yazilar(sayfa, 'karo-ipucu'), [YENI_DIL_METINLERI[dil].ipucu], dil);
  }
  sayfa.dilDegisti({ dil: 'en' });
  assert.equal(sayfa.oge('baglanti').textContent, 'Live');
  sayfa.dilDegisti({ dil: 'tr' });
  assert.equal(sayfa.kok.nitelikler.lang, 'tr');
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı');
  assert.equal(yazilar(sayfa, 'bolum-baslik')[0], 'Son kullanılanlar');
});

test('dil: palet açıkken Almancaya geçilince sorgu korunur, rozetler yeni dilde yazılır, eski ipucu silinir', async () => {
  const sayfa = await paletAc({ model: EN_MODEL, calistirYaniti: { ok: false, tur: 'cok-sik' } });
  sayfa.oge('arama').value = 'led 0';
  sayfa.oge('arama').gonder('input');
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  await akit();
  assert.match(sayfa.oge('ipucu').textContent, /Çok sık/);
  sayfa.dilDegisti({ dil: 'de' });
  assert.equal(sayfa.oge('arama').value, 'led 0', 'yazılan sorgu korunur');
  assert.deepEqual(yazilar(sayfa, 'rozet'), ['Ausschalten']);
  assert.equal(sayfa.oge('ipucu').textContent, '');
  assert.equal(sayfa.oge('arama').attributes.placeholder, YENI_DIL_METINLERI.de.arama);
});

test('dil: durumAl yanıtında dil yoksa ya da geçersizse sayfa Türkçe kalır; tr verilirse <html lang> tr olur', async () => {
  for (const dil of [undefined, 'it', 'EN', 'de-DE', 'FR', 7]) {
    const sayfa = await panelAc({ dil });
    assert.equal(sayfa.oge('baglanti').textContent, 'Canlı', String(dil));
    assert.equal(sayfa.oge('haAc').textContent, 'HA’yı aç', String(dil));
    assert.equal(sayfa.kok.nitelikler.lang, undefined, 'dil bilinmiyorsa <html lang> değiştirilmez (HTML varsayılanı tr)');
  }
  const tr = await panelAc({ dil: 'tr' });
  assert.equal(tr.kok.nitelikler.lang, 'tr');
  assert.equal(tr.oge('arama').attributes.placeholder, 'Eylem ara…  (örn. “ışık 40”)');
});

test('dil: çalışma anında değişim (onDilDegisti) sabit metinleri çevirir ve açık paneli yeniden çizer; geçersiz dil yok sayılır; geri Türkçeye dönülür', async () => {
  const sayfa = await panelAc({ model: MODEL });
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı');
  assert.deepEqual(yazilar(sayfa, 'karo-ipucu'), ['basılı tut']);
  sayfa.dilDegisti({ dil: 'en' });
  assert.equal(sayfa.kok.nitelikler.lang, 'en');
  assert.equal(sayfa.oge('baglanti').textContent, 'Live');
  assert.equal(sayfa.oge('medya').textContent, '♪ Playing · Headphones');
  assert.equal(sayfa.oge('haAc').textContent, 'Open HA dashboard');
  assert.equal(sayfa.htmlBasligi().textContent, 'Home Panel — Quick Panel');
  assert.deepEqual(yazilar(sayfa, 'karo-ipucu'), ['hold to confirm']);
  assert.equal(yazilar(sayfa, 'bolum-baslik')[0], 'Recently used');
  sayfa.dilDegisti({ dil: 'it' });
  sayfa.dilDegisti({ dil: 'ES' });
  sayfa.dilDegisti(null);
  sayfa.dilDegisti({});
  assert.equal(sayfa.oge('baglanti').textContent, 'Live', 'geçersiz dil mevcut dili bozmaz');
  sayfa.dilDegisti({ dil: 'tr' });
  assert.equal(sayfa.kok.nitelikler.lang, 'tr');
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı');
  assert.equal(sayfa.oge('haAc').textContent, 'HA’yı aç');
  assert.equal(yazilar(sayfa, 'bolum-baslik')[0], 'Son kullanılanlar');
});

test('dil: palet açıkken dil değişince sorgu ve seçili satır korunur, rozetler yeni dilde yazılır, eski ipucu silinir', async () => {
  const sayfa = await paletAc({ model: EN_MODEL, calistirYaniti: { ok: false, tur: 'cok-sik' } });
  sayfa.oge('arama').value = 'led 0';
  sayfa.oge('arama').gonder('input');
  assert.deepEqual(yazilar(sayfa, 'rozet'), ['Kapat']);
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  await akit();
  assert.match(sayfa.oge('ipucu').textContent, /Çok sık/);
  sayfa.dilDegisti({ dil: 'en' });
  assert.equal(sayfa.oge('arama').value, 'led 0', 'yazılan sorgu korunur');
  assert.deepEqual(yazilar(sayfa, 'rozet'), ['Turn off']);
  assert.equal(sayfa.oge('ipucu').textContent, '', 'önceki dildeki ipucu kalmaz');
  assert.equal(sayfa.oge('arama').attributes.placeholder, 'Search actions…  (e.g. “light 40”)');
  assert.equal(paletSatirlari(sayfa).filter((s) => s.className.split(' ').includes('secili')).length, 1);
});

test('dil: sürükleme / basılı tutma sürerken gelen dil değişimi çizimi erteler (sabit metinler hemen çevrilir), bırakınca çizer', async () => {
  const sayfa = await panelAc({ model: MODEL });
  sayfa.belgeOlayi('pointerdown');
  sayfa.dilDegisti({ dil: 'en' });
  assert.equal(sayfa.oge('haAc').textContent, 'Open HA dashboard', 'sabit metin hemen');
  assert.equal(sayfa.oge('baglanti').textContent, 'Canlı', 'dinamik metin basış sürerken yeniden çizilmez');
  sayfa.belgeOlayi('pointerup');
  sayfa.zaman.ilerle(1);
  assert.equal(sayfa.oge('baglanti').textContent, 'Live');
});

// ---- 1.4.0 bilgi bölümleri (o-04, o-07, o-08, o-09, o-10, o-11): src/yuzey-bilgi.js sayfaya bağlı --------------------------

const bilgiKaro = (id, etiket, alan, ozellik, ek = {}) => ({
  ...karo(id, etiket, { grup: 'sensor', grupEtiketi: 'Sensör', alan, durum: 'notr' }),
  ozellik,
  ...ek,
});
const B_SICAKLIK = bilgiKaro('sensor.salon_sicaklik', 'Salon sıcaklık', 'sensor', { deger: '21.4', sayi: 21.4, birim: '°C', sinif: 'temperature', hassasiyet: 1, enAz: null, enCok: null });
const B_PIL = bilgiKaro('sensor.kumanda_pil', 'Kumanda pil', 'sensor', { deger: '12', sayi: 12, birim: '%', sinif: 'battery', hassasiyet: null, enAz: null, enCok: null });
const B_HAVA = bilgiKaro('weather.ev', 'Ev', 'weather', { durum: 'sunny', sicaklik: 24, birim: '°C', nem: 40, ruzgar: null, ruzgarBirim: null, basinc: null });
const BILGI = {
  ayar: { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 },
  kartlar: [{ yuva: 1, tur: 'saat', karo: null, secilmedi: false }, { yuva: 2, tur: 'hava', karo: B_HAVA, secilmedi: false }],
  serit: [B_SICAKLIK],
  sensorler: [B_SICAKLIK, B_PIL],
  takvimler: [{ id: 'calendar.ev', etiket: 'Ev takvimi', kullanilabilir: true, mesgul: false }],
  listeler: [{ id: 'todo.alisveris', etiket: 'Alışveriş', kullanilabilir: true, acikSayisi: 1 }],
  hizliListe: 'todo.alisveris',
};
const BILGI_MODEL = { ...MODEL, bilgi: BILGI };
const bilgiOkuma = (istek) => {
  if (istek.tur === 'yapilacak') return { ok: true, veri: [{ uid: 'u1', baslik: 'Süt', tamamlandi: false }] };
  if (istek.tur === 'takvim') return { ok: true, veri: [] };
  return { ok: true, veri: Object.fromEntries(istek.kimlikler.map((k) => [k, [{ t: Date.now() - 3 * 3_600_000, d: 20 }, { t: Date.now() - 3_600_000, d: 22 }]])) };
};
const sinifVar = (o, ad) => `${o.className} ${o.attributes.class ?? ''}`.split(/\s+/).includes(ad);
const bulSinif = (sayfa, ad) => sayfa.oge('icerik').bul((o) => sinifVar(o, ad));

test('bilgi: panel bölümleri sırayla çizilir (kartlar, şerit, son kullanılanlar, gruplar, sensörler, yapılacaklar, takvim); okumalar yalnız panel açıkken istenir', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  sayfa.zaman.ilerle(100);
  const basliklar = yazilar(sayfa, 'bolum-baslik');
  assert.deepEqual(basliklar, ['Son kullanılanlar', 'Işık', 'Sahne', 'PC', 'Medya', 'Sensörler', 'Yapılacaklar: Alışveriş · 1 açık', 'Yaklaşan etkinlikler']);
  const govdeSirasi = sayfa.oge('icerik').children.map((c) => c.className);
  assert.deepEqual(govdeSirasi.slice(0, 3), ['bilgi-kartlar', 'sensor-serit', 'bolum son']);
  assert.match(bulSinif(sayfa, 'kart-hava')[0].textContent, /24 °C/);
  const turler = sayfa.okumalar().map((o) => o.tur).sort();
  assert.deepEqual(turler, ['gecmis', 'takvim', 'yapilacak']);
  assert.deepEqual(sayfa.okumalar().find((o) => o.tur === 'gecmis'), { tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik', 'sensor.kumanda_pil'], saat: 6 });
  assert.equal(sayfa.calistirmalar().length, 0, 'bilgi bölümü açılışta hiçbir eylem çalıştırmaz');
});

test('bilgi: model bilgi taşımıyorsa panel eskisi gibi çizilir ve hiçbir okuma istenmez', async () => {
  const sayfa = await panelAc({ model: MODEL, okuYaniti: bilgiOkuma });
  await akit();
  assert.deepEqual(sayfa.okumalar(), []);
  assert.deepEqual(yazilar(sayfa, 'bolum-baslik'), ['Son kullanılanlar', 'Işık', 'Sahne', 'PC', 'Medya']);
});

test('bilgi: saat kartı sayfanın zamanlayıcısıyla dakikada bir güncellenir', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  const once = bulSinif(sayfa, 'saat-deger')[0].textContent;
  assert.match(once, /^\d{2}:\d{2}$/);
  sayfa.zaman.ilerle(61_000);
  const sonra = bulSinif(sayfa, 'saat-deger')[0].textContent;
  assert.notEqual(sonra, once);
});

test('bilgi: sensöre tıklayınca geçmiş görünümü açılır, Esc önce onu kapatır (panel kapanmaz), ikinci Esc paneli kapatır', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  bulSinif(sayfa, 'serit-oge')[0].gonder('click');
  sayfa.zaman.ilerle(100);
  await akit();
  sayfa.zaman.ilerle(100);
  assert.equal(bulSinif(sayfa, 'bilgi-detay').length, 1);
  assert.equal(bulSinif(sayfa, 'sensor-serit').length, 0, 'görünüm panelin yerini alır');
  assert.deepEqual(sayfa.okumalar().filter((o) => o.tur === 'gecmis').at(-1), { tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik'], saat: 24 });
  assert.equal(sayfa.odakta(), bulSinif(sayfa, 'detay-geri')[0], 'odak Geri düğmesine gider');
  const ilk = sayfa.belgeOlayi('keydown', { key: 'Escape' });
  assert.equal(ilk.onlendi, true);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0);
  assert.equal(bulSinif(sayfa, 'bilgi-detay').length, 0);
  assert.equal(sayfa.odakta(), bulSinif(sayfa, 'serit-oge')[0], 'odak görünümü açan sensöre döner');
  sayfa.belgeOlayi('keydown', { key: 'Escape' });
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1);
});

test('bilgi: pencere yeniden gösterilince açık geçmiş görünümü kapanır', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  bulSinif(sayfa, 'serit-oge')[0].gonder('click');
  sayfa.zaman.ilerle(100);
  assert.equal(bulSinif(sayfa, 'bilgi-detay').length, 1);
  sayfa.goster('panel');
  assert.equal(bulSinif(sayfa, 'bilgi-detay').length, 0);
  assert.equal(bulSinif(sayfa, 'sensor-serit').length, 1);
});

test('bilgi: ok tuşu gezintisi sensör şeridine ve yapılacaklar düğmelerine ulaşır (ekleme kutusu yazı imlecini bozmasın diye gezintide değildir)', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  sayfa.zaman.ilerle(100);
  const icerik = sayfa.oge('icerik');
  icerik.focus();
  sayfa.belgeOlayi('keydown', { key: 'ArrowDown', target: icerik });
  assert.ok(sinifVar(sayfa.odakta(), 'serit-oge'), 'ilk ok tuşu ilk gezilebilir öğeye (sensör şeridi) gider');
  const girdi = bulSinif(sayfa, 'liste-girdi')[0];
  girdi.focus();
  const olay = sayfa.belgeOlayi('keydown', { key: 'ArrowLeft', target: girdi });
  assert.equal(olay.onlendi, undefined, 'ekleme kutusunda oklar imlecindir');
});

test('yapılacaklar: silme, panelde basılı tutmayla gider (başlangıç bildirilir, ~0,8 sn sonra remove_item + basili:true); erken bırakma iptal eder', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  sayfa.zaman.ilerle(100);
  const sil = () => bulSinif(sayfa, 'liste-sil')[0];
  sil().gonder('click');
  assert.deepEqual(sayfa.calistirmalar(), [], 'düz tıklama silmez');
  sil().gonder('pointerdown', { button: 0 });
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'basiliBasla'), [['basiliBasla', 'todo.alisveris']]);
  sayfa.zaman.ilerle(400);
  sil().gonder('pointerup');
  sayfa.zaman.ilerle(2000);
  assert.deepEqual(sayfa.calistirmalar(), [], 'erken bırakma isteği iptal eder');
  assert.ok(sayfa.cagrilar.some((c) => c[0] === 'basiliBirak' && c[1] === 'todo.alisveris'));
  sil().gonder('pointerdown', { button: 0 });
  sayfa.zaman.ilerle(900);
  await akit();
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'todo.alisveris', servis: 'remove_item', veri: { item: 'u1' }, basili: true }]);
});

test('yapılacaklar: tamamlama ve ekleme eylem hattına servis + veri olarak gider; yazarken gelen model çizimi ertelenir, yazılan metin korunur', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  await akit();
  sayfa.zaman.ilerle(100);
  bulSinif(sayfa, 'liste-onay')[0].gonder('click');
  await akit();
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'todo.alisveris', servis: 'update_item', veri: { item: 'u1', status: 'completed' } });

  const girdi = bulSinif(sayfa, 'liste-girdi')[0];
  girdi.focus();
  girdi.gonder('focus');
  girdi.value = 'yarı';
  girdi.gonder('input');
  sayfa.durum({ ...BILGI_MODEL, bilgi: { ...BILGI, serit: [] } });
  assert.equal(bulSinif(sayfa, 'liste-girdi')[0], girdi, 'yazarken çizim ertelendi: kutu yok edilmedi');
  girdi.gonder('blur');
  sayfa.zaman.ilerle(1);
  const yeni = bulSinif(sayfa, 'liste-girdi')[0];
  assert.notEqual(yeni, girdi);
  assert.equal(yeni.value, 'yarı', 'taslak yeni kutuya taşındı');
  yeni.value = 'ekmek';
  yeni.gonder('keydown', { key: 'Enter' });
  await akit();
  assert.deepEqual(sayfa.calistirmalar().at(-1), { kimlik: 'todo.alisveris', servis: 'add_item', veri: { item: 'ekmek' } });
});

test('palet: "liste süt" ilk satırda "listeye ekle" önerir; Enter yalnız add_item gönderir ve paleti kapatır', async () => {
  const sayfa = await paletAc({ model: BILGI_MODEL, okuYaniti: bilgiOkuma });
  sayfa.oge('arama').value = 'liste süt';
  sayfa.oge('arama').gonder('input');
  const satirlar = paletSatirlari(sayfa);
  assert.match(satirlar[0].textContent, /“süt” → Alışveriş listesine ekle/);
  assert.match(satirlar[0].textContent, /Yapılacaklar/);
  assert.ok(satirlar[0].className.split(' ').includes('secili'));
  assert.equal(satirlar[0].className.includes('yikici'), false);
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  await akit();
  assert.deepEqual(sayfa.calistirmalar(), [{ kimlik: 'todo.alisveris', servis: 'add_item', veri: { item: 'süt' } }]);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 1, 'başarıda palet kapanır');
  assert.deepEqual(sayfa.okumalar(), [], 'palette hiçbir okuma istenmez');
});

test('palet: hızlı ekleme satırı yalnız "liste/list/todo <metin>" için ve hızlı liste seçiliyse çıkar; başka sorgular eskisi gibi', async () => {
  const sayfa = await paletAc({ model: BILGI_MODEL });
  for (const [sorgu, beklenen] of [['list milk', true], ['todo ekmek', true], ['liste', false], ['led 40', false], ['ampul', false]]) {
    sayfa.oge('arama').value = sorgu;
    sayfa.oge('arama').gonder('input');
    assert.equal(paletSatirlari(sayfa).some((s) => /listesine ekle/.test(s.textContent)), beklenen, sorgu);
  }
  const listesiz = await paletAc({ model: { ...MODEL, bilgi: { ...BILGI, hizliListe: '' } } });
  listesiz.oge('arama').value = 'liste süt';
  listesiz.oge('arama').gonder('input');
  assert.equal(paletSatirlari(listesiz).some((s) => /listesine ekle/.test(s.textContent)), false);
});

test('palet: ekleme başarısız olursa palet açık kalmaz ama eylem yalnız add_item\'dır; "çok sık" yanıtında açık kalır ve uyarı verir', async () => {
  const sayfa = await paletAc({ model: BILGI_MODEL, calistirYaniti: { ok: false, tur: 'cok-sik' } });
  sayfa.oge('arama').value = 'liste süt';
  sayfa.oge('arama').gonder('input');
  sayfa.oge('arama').gonder('keydown', { key: 'Enter', repeat: false });
  await akit();
  assert.match(sayfa.oge('ipucu').textContent, /Çok sık/);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'kapat').length, 0);
  assert.equal(sayfa.calistirmalar().every((c) => c.servis === 'add_item'), true);
});

test('dil: İngilizce arayüzde bilgi bölümleri İngilizce yazılır (başlıklar, durum, ipuçları) ve Türkçe karakter sızmaz', async () => {
  const sayfa = await panelAc({ model: BILGI_MODEL, dil: 'en', okuYaniti: bilgiOkuma });
  await akit();
  sayfa.zaman.ilerle(100);
  const basliklar = yazilar(sayfa, 'bolum-baslik');
  assert.ok(basliklar.includes('Sensors'));
  assert.ok(basliklar.includes('Upcoming events'));
  assert.ok(basliklar.includes('To-do: Alışveriş · 1 open'));
  assert.match(bulSinif(sayfa, 'kart-hava')[0].textContent, /Sunny/);
  assert.match(bulSinif(sayfa, 'kart-hava')[0].textContent, /Humidity 40%/);
  assert.match(bulSinif(sayfa, 'bilgi-takvim')[0].textContent, /No upcoming events/);
  const kart = bulSinif(sayfa, 'sensor-karo').find((k) => /Kumanda pil/.test(k.textContent));
  assert.match(kart.textContent, /! low battery/);
  assert.match(kart.textContent, /12%/);
  sayfa.dilDegisti({ dil: 'tr' });
  assert.ok(yazilar(sayfa, 'bolum-baslik').includes('Sensörler'));
  assert.match(bulSinif(sayfa, 'kart-hava')[0].textContent, /Güneşli/);
});

test('bilgi: sayfada yeni betikler yuzey-sayfa.js\'den önce yüklenir ve HTML\'de satır içi betik yok', () => {
  const sira = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const sayfa = sira.indexOf('yuzey-sayfa.js');
  for (const betik of ['lib/bilgi-bicim.js', 'lib/grafik.js', 'yuzey-bilgi.js']) {
    assert.ok(sira.indexOf(betik) >= 0 && sira.indexOf(betik) < sayfa, `${betik} yuzey-sayfa.js'den önce`);
  }
  assert.ok(sira.indexOf('yuzey-bilgi.js') > sira.indexOf('lib/grafik.js') && sira.indexOf('yuzey-bilgi.js') > sira.indexOf('lib/bilgi-bicim.js'));
  assert.doesNotMatch(HTML, /<script>|\sstyle="/);
});

test('bilgi (CSS): seri renkleri iki temada tanımlıdır; çizim sınıfları (sparkline, gösterge, grafik, seri-0..6) stil alır; satır içi renk yok', () => {
  const css = oku('src/yuzey.css');
  const { koyu, acik } = temalar(css);
  for (const tema of [koyu, acik]) {
    for (let i = 0; i < 7; i += 1) assert.match(tema[`--seri-${i}`] ?? '', /^#[0-9a-f]{6}$/i, `--seri-${i}`);
    assert.equal(new Set(Array.from({ length: 7 }, (_, i) => tema[`--seri-${i}`])).size, 7, 'yedi ayrı renk');
  }
  for (const secici of ['.sparkline-cizgi', '.sparkline-alan', '.gosterge-arka', '.gosterge-deger', '.gosterge-deger.uyari', '.gosterge-deger.kritik', '.grafik-izgara', '.eksen', '.imlec', '.cizgi.seri-0', '.cizgi.seri-6', '.nokta.seri-3', '.seri-isaret.seri-4']) {
    assert.notEqual(kuralGovdesi(css, secici), '', `${secici}: kural yok`);
  }
  // seri renkleri yalnız değişkenlerden gelir (g-01 kuralı) ve grafik ızgarası kutu ızgarasından ayrı sınıftır
  assert.match(kuralGovdesi(css, '.cizgi.seri-4'), /var\(--seri-4\)/);
  assert.doesNotMatch(oku('src/lib/grafik.js'), /class: 'izgara'/);
});

test('bilgi (CSS): grafik çizgileri ve gösterge yayları kartlarında WCAG 1.4.11 için ayırt edilir; yedi serinin dokusu / etiketi renge ek olarak vardır', () => {
  const css = oku('src/yuzey.css');
  const { koyu, acik } = temalar(css);
  // Kartlarda 3:1 yakalayan seriler grafikte yeterli; kalanlar için (açık temada sarı / yeşil / pembe) lejant etiketi + sayısal istatistik + desen zorunludur.
  let zayif = 0;
  for (const [ad, tema] of [['koyu', koyu], ['açık', acik]]) {
    for (let i = 0; i < 7; i += 1) if (kontrast(tema[`--seri-${i}`], tema['--karo']) < 3) zayif += 1;
    for (const d of ['--vurgu', '--yedek', '--hata']) assert.ok(kontrast(tema[d], tema['--karo']) >= 3, `${ad}: ${d} gösterge yayı --karo üzerinde`);
  }
  assert.ok(zayif <= 4, `düşük kontrastlı seri sayısı sınırlı (${zayif})`);
  assert.match(kuralGovdesi(css, '.seri-isaret.seri-4'), /dashed/);
  assert.match(kuralGovdesi(css, '.seri-isaret.seri-5'), /dotted/);
  assert.match(oku('src/lib/grafik.js'), /SERI_KESIK_DESENLERI/);
});

// ------------------------------------------------------------------ bildirim şeridi (1.4.0)

const BILDIRIM_ZAMANI = Date.UTC(2026, 9, 15, 7, 5);
const bildirimOgesi = (anahtar, ek = {}) => ({ anahtar, kaynak: 'ha', baslik: 'Başlık ' + anahtar, metin: 'Metin ' + anahtar, zaman: BILDIRIM_ZAMANI, simge: '🔔', ...ek });
const BILDIRIMLI = (bildirim) => ({ ...MODEL, bildirim });
const UC_BILDIRIM = { ogeler: [bildirimOgesi('ka1', { kaynak: 'uyari', simge: '⚠' }), bildirimOgesi('kb2', { kaynak: 'pil', simge: '🪫' }), bildirimOgesi('kc3', { kaynak: 'guncelleme', simge: '⬆' })], sayi: 3, gizlenen: 0 };
const bildirimKapatDugmeleri = (sayfa) => sayfa.oge('bildirimListe').bul((o) => o.etiket === 'button');
const bildirimSatirlari = (sayfa) => sayfa.oge('bildirimListe').bul((o) => o.etiket === 'li');
const bildirimSaati = (dil) => new Date(BILDIRIM_ZAMANI).toLocaleTimeString(dil, { hour: '2-digit', minute: '2-digit' });

test('bildirim: modelde bildirim yoksa, boşsa ya da bozuksa şerit gizli kalır', async () => {
  const yok = await panelAc({ model: MODEL });
  assert.equal(yok.oge('bildirim').hidden, true);
  const bos = await panelAc({ model: BILDIRIMLI({ ogeler: [], sayi: 0, gizlenen: 0 }) });
  assert.equal(bos.oge('bildirim').hidden, true);
  const bozuk = await panelAc({ model: BILDIRIMLI('merhaba') });
  assert.equal(bozuk.oge('bildirim').hidden, true);
});

test('bildirim: kapalı şeritte rozet sayıyı, özet en yeni bildirimin metnini gösterir; liste kapalıdır', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  assert.equal(sayfa.oge('bildirim').hidden, false);
  assert.equal(sayfa.oge('bildirimSayi').hidden, false);
  assert.equal(sayfa.oge('bildirimSayi').textContent, '3');
  assert.equal(sayfa.oge('bildirimSayi').attributes['aria-label'], '3 bildirim');
  assert.equal(sayfa.oge('bildirimOzet').textContent, 'Metin ka1');
  assert.equal(sayfa.oge('bildirimListe').hidden, true);
  assert.equal(sayfa.oge('bildirimDugme').attributes['aria-expanded'], 'false');
  assert.equal(sayfa.oge('bildirimGizli').hidden, true);
});

test('bildirim: tek bildirimde rozet etiketi tekil yazılır', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: [bildirimOgesi('ka1')], sayi: 1, gizlenen: 0 }) });
  assert.equal(sayfa.oge('bildirimSayi').attributes['aria-label'], '1 bildirim');
});

test('bildirim: başlık düğmesi listeyi açıp kapatır; öğeler başlık, metin, saat ve kaynak sınıfıyla çizilir', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(sayfa.oge('bildirimListe').hidden, false);
  assert.equal(sayfa.oge('bildirimDugme').attributes['aria-expanded'], 'true');
  assert.equal(sayfa.oge('bildirimOzet').textContent, '', 'açıkken özet tekrarlanmaz');
  const satirlar = bildirimSatirlari(sayfa);
  assert.equal(satirlar.length, 3);
  assert.deepEqual(satirlar.map((s) => s.className), ['bildirim-oge uyari', 'bildirim-oge pil', 'bildirim-oge guncelleme']);
  const saat = bildirimSaati('tr-TR');
  const ilk = satirlar[0];
  assert.equal(ilk.bul((o) => o.className === 'bildirim-oge-baslik')[0].textContent, 'Başlık ka1' + saat);
  assert.equal(ilk.bul((o) => o.className === 'bildirim-zaman')[0].textContent, saat);
  assert.equal(ilk.bul((o) => o.className === 'bildirim-metin')[0].textContent, 'Metin ka1');
  const simge = ilk.bul((o) => o.className === 'bildirim-simge')[0];
  assert.equal(simge.textContent, '⚠');
  assert.equal(simge.attributes['aria-hidden'], 'true', 'simge süstür');
  const kapat = bildirimKapatDugmeleri(sayfa)[0];
  assert.equal(kapat.attributes['aria-label'], 'Bildirimi kapat: Metin ka1');
  assert.equal(kapat.type, 'button');
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(sayfa.oge('bildirimListe').hidden, true);
  assert.equal(sayfa.oge('bildirimOzet').textContent, 'Metin ka1');
});

test('bildirim: zamanı olmayan öğede saat yazılmaz', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: [bildirimOgesi('ka1', { zaman: 0 })], sayi: 1, gizlenen: 0 }) });
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(sayfa.oge('bildirimListe').bul((o) => o.className === 'bildirim-zaman').length, 0);
});

test('bildirim: kapat düğmesi köprüye opak anahtarı iletir; yanıt beklerken düğme pasiftir ve çift tıklama tek istek gönderir', async () => {
  let coz;
  const bekle = new Promise((c) => (coz = c));
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM), bildirimYaniti: () => bekle });
  sayfa.oge('bildirimDugme').gonder('click');
  const kapat = bildirimKapatDugmeleri(sayfa)[1];
  kapat.gonder('click');
  kapat.gonder('click');
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'bildirimKapat'), [['bildirimKapat', 'kb2']]);
  assert.equal(kapat.disabled, true);
  coz({ ok: true });
  await akit();
  assert.equal(kapat.disabled, false);
  assert.equal(sayfa.oge('ipucu').textContent, '', 'başarıda uyarı yok');
});

test('bildirim: kapatma başarısızsa ipucu satırı söyler; "çok sık" ayrı mesajdır; köprü hatası da yakalanır', async () => {
  const cokSik = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM), bildirimYaniti: { ok: false, tur: 'cok-sik' } });
  cokSik.oge('bildirimDugme').gonder('click');
  bildirimKapatDugmeleri(cokSik)[0].gonder('click');
  await akit();
  assert.equal(cokSik.oge('ipucu').textContent, 'Çok sık; biraz bekleyin.');

  const olmadi = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM), bildirimYaniti: { ok: false, tur: 'gecersiz' } });
  olmadi.oge('bildirimDugme').gonder('click');
  bildirimKapatDugmeleri(olmadi)[0].gonder('click');
  await akit();
  assert.equal(olmadi.oge('ipucu').textContent, 'Bildirim kapatılamadı.');
  assert.equal(bildirimKapatDugmeleri(olmadi)[0].disabled, false, 'yeniden denenebilir');

  const patladi = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM), bildirimYaniti: () => Promise.reject(new Error('ipc')) });
  patladi.oge('bildirimDugme').gonder('click');
  bildirimKapatDugmeleri(patladi)[0].gonder('click');
  await akit();
  assert.equal(patladi.oge('ipucu').textContent, 'Bildirim kapatılamadı.');
});

test('bildirim: kapatılan öğe yeni modelden kalkınca odak sıradaki düğmeye, hiç kalmayınca içeriğe geçer; liste açık kalır', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  sayfa.oge('bildirimDugme').gonder('click');
  sayfa.odakVer(bildirimKapatDugmeleri(sayfa)[1]);
  sayfa.durum(BILDIRIMLI({ ogeler: [UC_BILDIRIM.ogeler[0], UC_BILDIRIM.ogeler[2]], sayi: 2, gizlenen: 0 }));
  assert.equal(sayfa.oge('bildirimListe').hidden, false, 'liste açık kalır');
  assert.equal(bildirimSatirlari(sayfa).length, 2);
  assert.equal(sayfa.odakta(), bildirimKapatDugmeleri(sayfa)[1], 'odak sıradaki düğmede');
  sayfa.durum(BILDIRIMLI({ ogeler: [UC_BILDIRIM.ogeler[0]], sayi: 1, gizlenen: 0 }));
  assert.equal(sayfa.odakta(), bildirimKapatDugmeleri(sayfa)[0], 'son düğmeye kayar');
  sayfa.durum(BILDIRIMLI({ ogeler: [], sayi: 0, gizlenen: 0 }));
  assert.equal(sayfa.oge('bildirim').hidden, true);
  assert.equal(sayfa.odakta(), sayfa.oge('icerik'), 'şerit kalkınca odak içerik alanına döner');
});

test('bildirim: odak şeritte değilse yeniden çizim odağı çalmaz; aynı model şeridi yeniden kurmaz', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  sayfa.oge('bildirimDugme').gonder('click');
  const eski = bildirimKapatDugmeleri(sayfa)[0];
  sayfa.odakVer(sayfa.oge('haAc'));
  const yeni = BILDIRIMLI({ ogeler: [UC_BILDIRIM.ogeler[1], UC_BILDIRIM.ogeler[2]], sayi: 2, gizlenen: 0 });
  sayfa.durum(yeni);
  assert.equal(sayfa.odakta(), sayfa.oge('haAc'));
  const once = bildirimKapatDugmeleri(sayfa)[0];
  sayfa.durum(yeni);
  assert.equal(bildirimKapatDugmeleri(sayfa)[0], once, 'değişmeyen bildirim DOM’u yeniden kurmaz');
  assert.notEqual(once, eski);
});

test('bildirim: yalnız gizlenen varsa "N bildirim gizlendi" satırı çıkar, başlık düğmesi pasif olur; içerik hiçbir yerde yazılmaz', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: [], sayi: 0, gizlenen: 3 }) });
  assert.equal(sayfa.oge('bildirim').hidden, false);
  assert.equal(sayfa.oge('bildirimGizli').hidden, false);
  assert.equal(sayfa.oge('bildirimGizli').textContent, '3 bildirim gizlendi');
  assert.equal(sayfa.oge('bildirimDugme').disabled, true);
  assert.equal(sayfa.oge('bildirimSayi').hidden, true);
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(sayfa.oge('bildirimListe').hidden, true, 'boş liste açılmaz');
  const bir = await panelAc({ model: BILDIRIMLI({ ogeler: [bildirimOgesi('ka1')], sayi: 1, gizlenen: 1 }) });
  assert.equal(bir.oge('bildirimGizli').textContent, '1 bildirim gizlendi');
  assert.equal(bir.oge('bildirimDugme').disabled, false);
});

test('bildirim: palet kipinde şerit gizlidir, panele dönünce yeniden çıkar; her gösterimde liste kapalı başlar', async () => {
  const palet = await paletAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  assert.equal(palet.oge('bildirim').hidden, true);
  const sayfa = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM) });
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(sayfa.oge('bildirimListe').hidden, false);
  sayfa.goster('palet');
  assert.equal(sayfa.oge('bildirim').hidden, true);
  sayfa.goster('panel');
  assert.equal(sayfa.oge('bildirim').hidden, false);
  assert.equal(sayfa.oge('bildirimListe').hidden, true, 'yeni gösterimde kapalı');
  assert.equal(sayfa.oge('bildirimDugme').attributes['aria-expanded'], 'false');
});

test('bildirim: metinler yalnız textContent ile yazılır; etiketli metin etiket olarak yorumlanmaz, öğe çocuğu oluşmaz', async () => {
  const kotu = '<img src=x onerror=alert(1)>';
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: [bildirimOgesi('ka1', { baslik: kotu, metin: kotu, simge: kotu })], sayi: 1, gizlenen: 0 }) });
  assert.equal(sayfa.oge('bildirimOzet').textContent, kotu);
  sayfa.oge('bildirimDugme').gonder('click');
  const satir = bildirimSatirlari(sayfa)[0];
  assert.equal(satir.bul((o) => o.className === 'bildirim-metin')[0].textContent, kotu);
  assert.equal(satir.bul((o) => o.etiket === 'img').length, 0);
  assert.equal(sayfa.oge('bildirimOzet').textContent, '', 'açıkken özet boş');
});

test('bildirim: bozuk öğeler (anahtarsız, nesne olmayan, bilinmeyen kaynak) ayıklanır; uzun metin ve tuhaf sayılar sınırlanır', async () => {
  const uzun = 'a'.repeat(500);
  const sayfa = await panelAc({
    model: BILDIRIMLI({
      ogeler: [null, 5, { anahtar: '', metin: 'x' }, { metin: 'anahtarsız' }, bildirimOgesi('ka1', { kaynak: 'baska', metin: uzun, baslik: uzun, simge: uzun, zaman: 'dün' })],
      sayi: -4,
      gizlenen: 'çok',
    }),
  });
  sayfa.oge('bildirimDugme').gonder('click');
  const satirlar = bildirimSatirlari(sayfa);
  assert.equal(satirlar.length, 1);
  assert.equal(satirlar[0].className, 'bildirim-oge ha', 'bilinmeyen kaynak "ha" olur');
  assert.equal(satirlar[0].bul((o) => o.className === 'bildirim-metin')[0].textContent.length, 200);
  assert.equal(satirlar[0].bul((o) => o.className === 'bildirim-simge')[0].textContent.length, 8);
  assert.equal(satirlar[0].bul((o) => o.className === 'bildirim-zaman').length, 0);
  assert.equal(sayfa.oge('bildirimSayi').textContent, '1', 'geçersiz sayı öğe sayısına döner');
  assert.equal(sayfa.oge('bildirimGizli').hidden, true);
});

test('bildirim: çok öğeli listeden ilk 30 çizilir', async () => {
  const cok = Array.from({ length: 45 }, (_, i) => bildirimOgesi('k' + String(i).padStart(2, '0')));
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: cok, sayi: 45, gizlenen: 0 }) });
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(bildirimSatirlari(sayfa).length, 30);
  assert.equal(sayfa.oge('bildirimSayi').textContent, '45');
});

test('dil en: bildirim şeridi etiketleri İngilizce; dil çalışma anında değişince şerit yeniden yazılır', async () => {
  const sayfa = await panelAc({ model: BILDIRIMLI({ ogeler: UC_BILDIRIM.ogeler, sayi: 3, gizlenen: 2 }), dil: 'en' });
  assert.equal(sayfa.oge('bildirimBaslik').textContent, 'Notifications');
  assert.equal(sayfa.oge('bildirimSayi').attributes['aria-label'], '3 notifications');
  assert.equal(sayfa.oge('bildirimGizli').textContent, '2 notifications hidden');
  sayfa.oge('bildirimDugme').gonder('click');
  assert.equal(bildirimKapatDugmeleri(sayfa)[0].attributes['aria-label'], 'Dismiss notification: Metin ka1');
  assert.equal(sayfa.oge('bildirimListe').bul((o) => o.className === 'bildirim-zaman')[0].textContent, bildirimSaati('en-US'));
  sayfa.dilDegisti({ dil: 'tr' });
  assert.equal(sayfa.oge('bildirimBaslik').textContent, 'Bildirimler');
  assert.equal(sayfa.oge('bildirimGizli').textContent, '2 bildirim gizlendi');
  assert.equal(bildirimKapatDugmeleri(sayfa)[0].attributes['aria-label'], 'Bildirimi kapat: Metin ka1');
  const hata = await panelAc({ model: BILDIRIMLI(UC_BILDIRIM), dil: 'en', bildirimYaniti: { ok: false, tur: 'gecersiz' } });
  hata.oge('bildirimDugme').gonder('click');
  bildirimKapatDugmeleri(hata)[0].gonder('click');
  await akit();
  assert.equal(hata.oge('ipucu').textContent, 'The notification could not be dismissed.');
  const tekil = await panelAc({ model: BILDIRIMLI({ ogeler: [bildirimOgesi('ka1')], sayi: 1, gizlenen: 1 }), dil: 'en' });
  assert.equal(tekil.oge('bildirimSayi').attributes['aria-label'], '1 notification');
  assert.equal(tekil.oge('bildirimGizli').textContent, '1 notification hidden');
});

test('bildirim: yuzey.css palette şeridi gizler ve bildirim kurallarına renk kodu gömmez (yalnız tema değişkenleri)', () => {
  const css = oku('src/yuzey.css');
  assert.match(css, /\.mod-palet \.bildirim\b[^{]*\{[^}]*display:\s*none/);
  const kurallar = [...css.matchAll(/(^|\n)\s*([^{}\n]*\.bildirim[^{}]*)\{([^}]*)\}/g)];
  assert.ok(kurallar.length >= 8, 'bildirim kuralları bulundu');
  for (const [, , secici, govde] of kurallar) assert.doesNotMatch(govde, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${secici.trim()} renk kodu gömüyor`);
});
