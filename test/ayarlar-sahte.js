'use strict';

/**
 * Ayarlar sayfasının betiği (src/ayarlar.js) için ortak SAHTE DOM ve sahte ana süreç köprüsü (test/ayarlar-arayuz*.test.js).
 * Gerçek tarayıcı, Electron ya da pencere YOK; HTML'deki kimliklerle betiğin uyumu, metinlerin yalnız textContent ile yazılması,
 * kayıt yüklerinin biçimi ve arayüz mantığı `node --check`in göremeyeceği yerde sınanır. Görsel görünüm (CSS) burada denenmez.
 *
 * Sahte köprü durum tutar: `sunucu` ana sürecin ayar özetidir; ayarlariKaydet / favorileriKaydet bu duruma uygulanır, ayarlariGetir
 * onu döner. Böylece "yalnız kaydedilen bölüm sunucudaki değerlere döner" gibi davranışlar gerçeğe yakın sınanır.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { ANAHTAR_SILINDI_METNI } = require('../src/lib/bildirim-metni');
const SOZLUK_ANA = require('../src/lib/ceviri/ana');

const KOK = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(KOK, 'src', 'ayarlar.html'), 'utf8');
const BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar.js'), 'utf8');
const KISAYOL_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'kisayol.js'), 'utf8');
const ARAMA_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'arama.js'), 'utf8');
const DIL_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'dil.js'), 'utf8');
const TEMA_RENK_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'tema-renk.js'), 'utf8');
const SOZLUK_ANA_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ceviri', 'ana.js'), 'utf8');
const SOZLUK_AYARLAR_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ceviri', 'ayarlar.js'), 'utf8');
const DIL_AYARLARI = ['sistem', 'tr', 'en'];

const akit = async () => {
  for (let i = 0; i < 16; i += 1) await new Promise((coz) => setImmediate(coz));
};

const duzles = (nesne) => JSON.parse(JSON.stringify(nesne)); // vm bağlamından gelen nesneleri düzleştir

class SahteOge {
  constructor(etiket = 'div', kimlik = null, sahne = null) {
    this.etiket = etiket;
    this.id = kimlik;
    this.sahne = sahne;
    this.children = [];
    this.dinleyiciler = {};
    // style.setProperty / removeProperty: CSSOM değişkenleri (önizleme); değerler style.degiskenler'de (görünür anahtar eklemez)
    this.style = {
      setProperty(ad, deger) {
        (this.degiskenler ??= {})[ad] = String(deger);
      },
      removeProperty(ad) {
        if (this.degiskenler) delete this.degiskenler[ad];
      },
    };
    this.attributes = {};
    this.className = '';
    this._deger = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.open = false;
    this.maxLength = -1;
    this.placeholder = '';
    this._metin = '';
    this.odaklanma = 0;
    this.bulanma = 0;
    this.kaydirma = 0;
    const kapsayici = this;
    this.classList = {
      add: (c) => {
        if (!kapsayici.className.split(' ').includes(c)) kapsayici.className = `${kapsayici.className} ${c}`.trim();
      },
      remove: (c) => {
        kapsayici.className = kapsayici.className.split(' ').filter((p) => p !== c && p !== '').join(' ');
      },
      contains: (c) => kapsayici.className.split(' ').includes(c),
    };
  }

  // Gerçek tarayıcıda input.value her zaman metindir (sayı atansa bile).
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
    this._metin = '';
    this.children = [];
    for (const c of cocuklar) this.appendChild(c);
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
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

  dispatchEvent(olay) {
    olay.target ??= this;
    for (const isleyici of this.dinleyiciler[olay.type] ?? []) isleyici(olay);
  }

  focus() {
    this.odaklanma += 1;
    if (this.sahne) this.sahne.sonOdak = this;
  }

  blur() {
    this.bulanma += 1;
  }

  scrollIntoView() {
    this.kaydirma += 1;
  }

  /** Kullanıcı tıklaması: işaret kutusu değişir ve change olayı gider; sonra click olayı. */
  tikla() {
    if (this.etiket === 'input' && this.type === 'checkbox' && !this.disabled) {
      this.checked = !this.checked;
      this.dispatchEvent({ type: 'change', target: this });
    }
    this.dispatchEvent({ type: 'click', target: this, stopPropagation() {}, preventDefault() {} });
  }

  /** Alt ağaçta koşulu sağlayan tüm öğeler. */
  bul(kosul, sonuc = []) {
    for (const c of this.children) {
      if (kosul(c)) sonuc.push(c);
      c.bul(kosul, sonuc);
    }
    return sonuc;
  }
}

/** Klavye olayı: preventDefault çağrıldıysa `onlendi` true olur. */
function tusOlayi(alanlar) {
  const olay = {
    type: 'keydown',
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    onlendi: false,
    durduruldu: false,
    preventDefault() {
      olay.onlendi = true;
    },
    stopPropagation() {
      olay.durduruldu = true;
    },
    ...alanlar,
  };
  return olay;
}

const ALAN_ADLARI = [
  'yerelAdres', 'disAdres', 'otomatikBaslat', 'pencereBoyutu', 'odakKaybindaGizle', 'koseBildirimi', 'bipSesi',
  'yeniPencereMalzemesi', 'temaZorla', 'vurguRengi', 'tepsiSolTik', 'canliBaglanti', 'kisayol', 'paletKisayol',
  // grup "tema" (ayar-alanlari.js tablosu)
  'metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelArkaPlani', 'animasyonlar', 'animasyonGecisleri', 'havaEfekti',
  'mevsimEfekti', 'hareketiAzalt',
];

/** HTML'deki data-i18n / data-i18n-attr işaretli öğeler (kimliği olmayanlar dahil); sayfayiCevir bunları querySelectorAll ile bulur. */
function ceviriOgeleriniKur(ogeler, durum) {
  const sonuc = [];
  const etiketRe = /<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const m of HTML.matchAll(etiketRe)) {
    const nitelikler = m[2];
    if (!/(?:^|\s)data-i18n(?:-attr)?="/.test(nitelikler)) continue;
    const kimlik = /(?:^|\s)id="([^"]+)"/.exec(nitelikler)?.[1] ?? null;
    const oge = (kimlik && ogeler.get(kimlik)) || new SahteOge(m[1], kimlik, durum);
    for (const ad of ['data-i18n', 'data-i18n-attr']) {
      const deger = new RegExp(`(?:^|\\s)${ad}="([^"]*)"`).exec(nitelikler)?.[1];
      if (deger !== undefined) oge.setAttribute(ad, deger);
    }
    sonuc.push(oge);
  }
  return sonuc;
}

function sayfayiKur({
  ayar,
  cihazlar,
  onayYaniti = true,
  favoriSonucu = null,
  kaydetYaniti = null,
  yenidenDeneYaniti = null,
  ayarKaydetYaniti = null,
  adresSinaYaniti = null,
  acikSayfaYaniti = null,
  yedekler = [],
  aktarimYaniti = null,
  yedektenDonYaniti = null,
  depo = null,
  dilOlayi = true,
}) {
  const sunucu = duzles(ayar);
  const durum = { yedekler, sonOdak: null };
  const ogeler = new Map();
  for (const [, kimlik] of HTML.matchAll(/\bid="([^"]+)"/g)) {
    const etiket = new RegExp(`<(\\w+)[^>]*\\bid="${kimlik}"`).exec(HTML)?.[1] ?? 'div';
    const oge = new SahteOge(etiket, kimlik, durum);
    const acilis = new RegExp(`<\\w+[^>]*\\bid="${kimlik}"[^>]*>`).exec(HTML)?.[0] ?? '';
    const tip = /\btype="(\w+)"/.exec(acilis)?.[1];
    if (tip) oge.type = tip;
    ogeler.set(kimlik, oge);
  }
  const cagrilar = [];
  const sorular = [];
  const secenekler = []; // anahtarKaydet / yetkiYenidenDene'ye giden ikinci onay seçenekleri
  const zamanlayicilar = [];
  const belgeDinleyicileri = {};
  const pencereDinleyicileri = {};
  let favoriDegistiGeriCagrisi = null;
  let kapatmaSayisi = 0;
  let getirSayisi = 0;
  const yerelDepo = new Map(Object.entries(depo ?? {}));
  const ceviriOgeleri = ceviriOgeleriniKur(ogeler, durum);
  let dilGeriCagrisi = null;

  function sunucuyaUygula(ham) {
    const yuk = duzles(ham);
    for (const a of ALAN_ADLARI) if (a in yuk) sunucu[a] = yuk[a];
    // Arayüz dili: ana süreç gibi etkin dili çözer ve (dilOlayi açıksa) yanıttan ÖNCE 'dil:degisti' gönderir.
    if (DIL_AYARLARI.includes(yuk.dil)) {
      const eski = sunucu.dil ?? 'tr';
      sunucu.dilAyari = yuk.dil;
      sunucu.dil = yuk.dil === 'sistem' ? (sunucu.sistemDili ?? 'tr') : yuk.dil;
      if (sunucu.dil !== eski && dilOlayi && dilGeriCagrisi) dilGeriCagrisi({ dil: sunucu.dil });
    }
    if ('anaPanoyaDonDk' in yuk) sunucu.anaPanoyaDonDk = Number(yuk.anaPanoyaDonDk);
    if ('panolar' in yuk) {
      sunucu.panolar = yuk.panolar
        .filter((p) => p.ad && String(p.yol).startsWith('/'))
        .slice(0, 6)
        .map((p) => ({ ad: p.ad.slice(0, 30), yol: p.yol, kisayol: p.kisayol || '' }));
    }
  }

  function favorilerinSunucuDurumu(yuk) {
    const onceki = new Map((sunucu.favoriler ?? []).map((f) => [f.entity_id, f]));
    const engelli = new Set((cihazlar?.engelli ?? []).map((e) => e.entity_id));
    const bilinenAd = new Map((cihazlar?.cihazlar ?? []).map((c) => [c.entity_id, c.ad]));
    sunucu.favoriler = yuk
      .filter((g) => !engelli.has(g.entity_id))
      .map((g) => {
        const eski = onceki.get(g.entity_id);
        const f = { entity_id: g.entity_id, ad: eski?.ad ?? bilinenAd.get(g.entity_id) ?? g.entity_id };
        const onay = typeof g.onay === 'boolean' ? g.onay : eski?.onay;
        if (onay !== undefined) f.onay = onay;
        const etiket = 'etiket' in g ? g.etiket : eski?.etiket;
        if (etiket) f.etiket = etiket;
        const kisayol = 'kisayol' in g ? g.kisayol : eski?.kisayol;
        if (kisayol) f.kisayol = kisayol;
        const parlaklik = typeof g.parlaklik === 'boolean' ? g.parlaklik : eski?.parlaklik;
        if (parlaklik) f.parlaklik = parlaklik;
        return f;
      });
  }

  const evPaneli = {
    ayarlariGetir: async () => {
      getirSayisi += 1;
      return { ok: true, ...duzles(sunucu) };
    },
    ayarlariKaydet: async (yuk) => {
      cagrilar.push(['ayarlariKaydet', yuk]);
      if (ayarKaydetYaniti) return ayarKaydetYaniti(duzles(yuk), sunucu);
      sunucuyaUygula(yuk);
      return { ok: true, uyarilar: [] };
    },
    otomatikBaslatEtkinlestir: async () => ({ ok: true }),
    anahtarKaydet: async (anahtar, secenek) => {
      cagrilar.push(['anahtarKaydet', anahtar]);
      secenekler.push(['anahtarKaydet', secenek]);
      return kaydetYaniti ? kaydetYaniti(secenek) : { ok: true, uyari: '' };
    },
    anahtarSil: async () => {
      cagrilar.push(['anahtarSil']);
      sunucu.anahtarVar = false;
      // Ana süreç gibi seçili dilde yanıt verir (Türkçe: bildirim-metni sabiti ile aynı metin).
      return { ok: true, mesaj: sunucu.dil === 'en' ? SOZLUK_ANA.en['bildirim.anahtarSilindi'] : ANAHTAR_SILINDI_METNI };
    },
    yetkiYenidenDene: async (secenek) => {
      cagrilar.push(['yetkiYenidenDene']);
      secenekler.push(['yetkiYenidenDene', secenek]);
      return yenidenDeneYaniti ? yenidenDeneYaniti(secenek, sunucu) : { ok: true };
    },
    cihazlariGetir: async () => {
      cagrilar.push(['cihazlariGetir']);
      if (!cihazlar.ok) return cihazlar;
      const kayitli = new Set((sunucu.favoriler ?? []).map((f) => f.entity_id));
      return {
        ...cihazlar,
        eksik: (cihazlar.eksik ?? []).filter((e) => kayitli.has(e.entity_id)),
        engelli: (cihazlar.engelli ?? []).filter((e) => kayitli.has(e.entity_id)),
      };
    },
    favorileriKaydet: async (yuk) => {
      cagrilar.push(['favorileriKaydet', yuk]);
      const duz = duzles(yuk);
      favorilerinSunucuDurumu(duz);
      return favoriSonucu ?? { ok: true, sayi: duz.length, eksik: 1, engelli: 1 };
    },
    hazirListeyiUygula: async () => {
      cagrilar.push(['hazirListeyiUygula']);
      return { ok: true, eklenen: 3, atlanan: 2 };
    },
    adresSina: async (adres, tur) => {
      cagrilar.push(['adresSina', adres, tur]);
      return adresSinaYaniti
        ? adresSinaYaniti(adres, tur)
        : { ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'Home Assistant bulundu: adres çalışıyor.' };
    },
    acikSayfa: async () => {
      cagrilar.push(['acikSayfa']);
      return acikSayfaYaniti ?? { ok: true, yol: '/lovelace/ev', ad: 'Ev' };
    },
    ayarlariDisaAktar: async () => {
      cagrilar.push(['ayarlariDisaAktar']);
      return aktarimYaniti?.disa ?? { ok: true, ad: 'ev-paneli-ayarlar-2026-10-15.json', favoriSayisi: 4 };
    },
    ayarlariIceAktar: async () => {
      cagrilar.push(['ayarlariIceAktar']);
      const yanit = aktarimYaniti?.ice ?? { ok: true, ad: 'yedek.json', alanSayisi: 12, favoriSayisi: 3, atilanSayisi: 0, notlar: [], uyarilar: [] };
      if (yanit.ok && aktarimYaniti?.icesonrasi) aktarimYaniti.icesonrasi(sunucu);
      return yanit;
    },
    yedekleriGetir: async () => {
      cagrilar.push(['yedekleriGetir']);
      return { ok: true, yedekler: durum.yedekler };
    },
    yedektenDon: async (ad) => {
      cagrilar.push(['yedektenDon', ad]);
      const yanit = yedektenDonYaniti ?? { ok: true, ad, alanSayisi: 10, favoriSayisi: 2, atilanSayisi: 0, notlar: [], uyarilar: [] };
      if (yanit.ok && aktarimYaniti?.icesonrasi) aktarimYaniti.icesonrasi(sunucu);
      return yanit;
    },
    onFavorilerDegisti: (geriCagri) => {
      favoriDegistiGeriCagrisi = geriCagri;
      return () => {};
    },
    onDilDegisti: (geriCagri) => {
      dilGeriCagrisi = geriCagri;
      return () => {};
    },
  };

  const belge = {
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `ayarlar.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket, null, durum),
    documentElement: {
      style: {},
      ozellikler: {},
      setAttribute(ad, deger) {
        this.ozellikler[ad] = String(deger);
      },
      getAttribute(ad) {
        return this.ozellikler[ad] ?? null;
      },
      removeAttribute(ad) {
        delete this.ozellikler[ad];
      },
    },
    nodeType: 9,
    querySelectorAll: (secici) => {
      const ad = secici === '[data-i18n]' ? 'data-i18n' : 'data-i18n-attr';
      return ceviriOgeleri.filter((o) => o.getAttribute(ad) !== null);
    },
    addEventListener: (tip, isleyici) => (belgeDinleyicileri[tip] ??= []).push(isleyici),
  };
  const sandbox = {
    document: belge,
    evPaneli,
    confirm: (soru) => {
      sorular.push(soru);
      return onayYaniti;
    },
    // Yeniden Dene yoklaması (1500 ms) hemen çalışır; bildirimi gizleme gibi diğer zamanlayıcılar `zamanlayicilar`da bekler.
    setTimeout: (islev, ms) => {
      if (ms === 1500) {
        setImmediate(islev);
        return 0;
      }
      zamanlayicilar.push({ islev, ms, iptal: false });
      return zamanlayicilar.length;
    },
    clearTimeout: (kimlik) => {
      if (kimlik && zamanlayicilar[kimlik - 1]) zamanlayicilar[kimlik - 1].iptal = true;
    },
    addEventListener: (tip, isleyici) => (pencereDinleyicileri[tip] ??= []).push(isleyici),
    close: () => {
      kapatmaSayisi += 1;
    },
    localStorage: {
      getItem: (ad) => (yerelDepo.has(ad) ? yerelDepo.get(ad) : null),
      setItem: (ad, deger) => yerelDepo.set(ad, String(deger)),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DIL_BETIGI, sandbox, { filename: 'dil.js' });
  vm.runInContext(SOZLUK_ANA_BETIGI, sandbox, { filename: 'ceviri/ana.js' });
  vm.runInContext(SOZLUK_AYARLAR_BETIGI, sandbox, { filename: 'ceviri/ayarlar.js' });
  vm.runInContext(KISAYOL_BETIGI, sandbox, { filename: 'kisayol.js' });
  vm.runInContext(ARAMA_BETIGI, sandbox, { filename: 'arama.js' });
  vm.runInContext(TEMA_RENK_BETIGI, sandbox, { filename: 'tema-renk.js' });
  vm.runInContext(BETIK, sandbox, { filename: 'ayarlar.js' });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    cagrilar,
    sorular,
    secenekler,
    sunucu,
    zamanlayicilar,
    depo: yerelDepo,
    yedekleriDegistir: (liste) => {
      durum.yedekler = liste;
    },
    sonOdak: () => durum.sonOdak,
    yakinlastirma: () => belge.documentElement.style.zoom,
    /** <html> özniteliği (ör. data-karsitlik). */
    htmlOzelligi: (ad) => belge.documentElement.getAttribute(ad),
    /** <html lang> (sayfayiCevir yazar). */
    htmlDili: () => belge.documentElement.getAttribute('lang'),
    /** Ana süreç 'dil:degisti' gönderdi (kayıt dışı bir yoldan, ör. başka pencereden). */
    dilDegisti: async (dilKodu) => {
      assert.ok(dilGeriCagrisi, 'onDilDegisti kaydedilmemiş');
      sunucu.dil = dilKodu;
      sunucu.dilAyari = dilKodu;
      dilGeriCagrisi({ dil: dilKodu });
      await akit();
    },
    /** data-i18n işaretli öğeler (kimlikli olanlar oge(kimlik) ile aynı nesnedir). */
    ceviriOgeleri,
    /** Kimliği olan tüm öğeler ile kimliksiz çevrilebilir öğeler (alt ağaçları bul/children ile gezilir). */
    tumOgeler: () => [...new Set([...ogeler.values(), ...ceviriOgeleri])],
    kapatmaSayisi: () => kapatmaSayisi,
    getirSayisi: () => getirSayisi,
    etkinZamanlayicilar: () => zamanlayicilar.filter((z) => !z.iptal),
    /** Belge düzeyinde klavye olayı (Ctrl+S, Esc, Ctrl +/-/0). */
    belgeTusu: (alanlar) => {
      const olay = tusOlayi(alanlar);
      for (const isleyici of belgeDinleyicileri.keydown ?? []) isleyici(olay);
      return olay;
    },
    /** window olayı (beforeunload). */
    pencereOlayi: (tip, alanlar = {}) => {
      const olay = { type: tip, onlendi: false, returnValue: undefined, preventDefault() { olay.onlendi = true; }, ...alanlar };
      for (const isleyici of pencereDinleyicileri[tip] ?? []) isleyici(olay);
      return olay;
    },
    favoriDegisti: async () => {
      assert.ok(favoriDegistiGeriCagrisi, 'onFavorilerDegisti kaydedilmemiş');
      favoriDegistiGeriCagrisi();
      await akit();
    },
  };
}

const AYAR = {
  yerelAdres: 'http://192.168.1.10:8123',
  disAdres: 'https://ha.example.com',
  kisayol: 'Control+Alt+H',
  kisayolEtkin: true,
  kisayolUyarilari: [],
  varsayilanKisayol: 'Control+Alt+H',
  otomatikBaslat: true,
  otomatikBaslatDurumu: { durum: 'etkin', mesaj: '' },
  pencereBoyutu: 'hizli',
  odakKaybindaGizle: true,
  anaPanoyaDonDk: 5,
  koseBildirimi: true,
  bipSesi: false,
  anahtarVar: true,
  ayarDosyasi: 'C:\\x\\ayarlar.json',
  favoriler: [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
    { entity_id: 'button.pc_ekran_kapat', ad: 'Ekranı Kapat', onay: false },
    { entity_id: 'light.eski_lamba', ad: 'Eski Lamba' },
    { entity_id: 'light.koridor', ad: 'Koridor' },
  ],
};
const CIHAZLAR = {
  ok: true,
  cihazlar: [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light', alanEtiketi: 'Işıklar', durum: 'açık', onayZorunlu: false, varsayilanOnay: false },
    { entity_id: 'script.kendi_scriptim', ad: 'Kendi Scriptim', alan: 'script', alanEtiketi: 'Scriptler', durum: 'kapalı', onayZorunlu: false, varsayilanOnay: true },
    { entity_id: 'button.pc_ekran_kapat', ad: 'Ekranı Kapat', alan: 'button', alanEtiketi: 'Düğmeler', durum: '', onayZorunlu: false, varsayilanOnay: false },
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', alan: 'button', alanEtiketi: 'Düğmeler', durum: '', onayZorunlu: true, varsayilanOnay: true },
  ],
  eksik: [{ entity_id: 'light.eski_lamba', ad: 'Eski Lamba' }],
  engelli: [{ entity_id: 'light.koridor', ad: 'Koridor' }],
};

const AYAR_D3 = {
  ...AYAR,
  paletKisayol: 'Control+Alt+P',
  varsayilanPaletKisayolu: 'Control+Alt+P',
  paletKisayolUyarilari: [],
  tepsiSolTik: 'panel',
  canliBaglanti: true,
  canliDurum: 'canli',
  panolar: [{ ad: 'Enerji', yol: '/energy', kisayol: 'Control+Alt+E' }],
  kisayolDurumlari: [],
  hazirListeGuncel: true,
};
const CIHAZLAR_D3 = {
  ...CIHAZLAR,
  cihazlar: [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light', alanEtiketi: 'Işıklar', durum: 'açık', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
    { entity_id: 'scene.film', ad: 'Film', alan: 'scene', alanEtiketi: 'Sahneler', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false },
    { entity_id: 'button.pc_bilgisayari_kapat', ad: 'Bilgisayarı Kapat', alan: 'button', alanEtiketi: 'Düğmeler', durum: '', onayZorunlu: true, varsayilanOnay: true, kisayolUygun: false, gizli: false },
    { entity_id: 'light.gizli_aday', ad: 'Gizli Aday', alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: true },
    { entity_id: 'light.gizli_ama_secili', ad: 'Seçili Gizli', alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: true },
  ],
  eksik: [],
  engelli: [],
};
const AYAR_D3_FAVORILI = { ...AYAR_D3, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }, { entity_id: 'light.gizli_ama_secili', ad: 'Seçili Gizli' }] };

const satirlar = (sayfa) => sayfa.oge('cihazListesi').bul((o) => o.className.includes('cihaz-satir'));
const satirKimligi = (satir) => satir.bul((o) => o.className === 'cihaz-kimlik')[0].textContent;
const satirBul = (sayfa, kimlik) => satirlar(sayfa).find((s) => satirKimligi(s) === kimlik);
const onayKutusu = (satir) => satir.bul((o) => o.etiket === 'input' && o.type === 'checkbox')[1]; // [0] satır seçimi, [1] onay
const girdiler = (satir) => satir.bul((o) => o.etiket === 'input');
const metinKutulari = (satir) => girdiler(satir).filter((g) => g.type === 'text');
const sira = (sayfa) => sayfa.oge('favoriSirasiListesi').bul((o) => o.className === 'sira-satir');
const siraMetni = (satir) => satir.bul((o) => o.className === 'sira-ad')[0].textContent;

/** Sayfayı kurar, açılış yüklemesini (ve anahtar varsa cihaz listesinin kendiliğinden yüklenmesini) bekler. */
async function acilmisSayfa(secenek) {
  const sayfa = sayfayiKur(secenek);
  await akit();
  return sayfa;
}

/**
 * Sayfadaki GÖRÜNÜR metinler: her öğenin kendi metni ve görünür öznitelikleri (placeholder, title, aria-label, alt), alt ağaçlar dahil.
 * Kullanıcının yazdığı değerler (input.value) ve ayar dosyası yolu kapsam dışıdır. Dönüş: [[öğe tanımı, metin], ...].
 */
function gorunurMetinler(sayfa) {
  const sonuc = [];
  const ziyaret = (o) => {
    const tanim = o.id ?? `${o.etiket}.${o.className}`;
    if (o._metin) sonuc.push([tanim, o._metin]);
    if (o.placeholder) sonuc.push([`${tanim}[placeholder]`, o.placeholder]);
    if (o.title) sonuc.push([`${tanim}[title]`, o.title]);
    for (const ad of ['aria-label', 'placeholder', 'title', 'alt']) {
      if (o.attributes[ad]) sonuc.push([`${tanim}[${ad}]`, o.attributes[ad]]);
    }
    o.children.forEach(ziyaret);
  };
  sayfa.tumOgeler().filter((o) => o.id !== 'ayarDosyasiYolu').forEach(ziyaret);
  return sonuc;
}

module.exports = {
  HTML,
  BETIK,
  gorunurMetinler,
  AYAR,
  CIHAZLAR,
  AYAR_D3,
  CIHAZLAR_D3,
  AYAR_D3_FAVORILI,
  SahteOge,
  akit,
  duzles,
  tusOlayi,
  sayfayiKur,
  acilmisSayfa,
  satirlar,
  satirKimligi,
  satirBul,
  onayKutusu,
  girdiler,
  metinKutulari,
  sira,
  siraMetni,
};
