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
const { baglantiKopruSahtesi } = require('./baglanti-sahte');
const SOZLUK_ANA = require('../src/lib/ceviri/ana');

const KOK = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(KOK, 'src', 'ayarlar.html'), 'utf8');
const BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar.js'), 'utf8');
const DUZEN_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-duzen.js'), 'utf8'); // 1.4.0 düzen: karo görünümü, sayfalar, geçmiş, onarım
const DIS_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-dis.js'), 'utf8'); // 1.4.0 dis grubu: Dış tetikler bölümü
const EYLEM_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-eylem.js'), 'utf8'); // 1.4.0 eylem grubu: etkinlik geçmişi, geri al, gecikmeli eylem...
const BAGLANTI_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-baglanti.js'), 'utf8'); // 1.4.0 bağlantı katmanı: özel üstbilgiler, sertifika, giriş, eşitleme
const SERTIFIKA_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-sertifika.js'), 'utf8'); // 1.4.0 sertifika güveni (o-56)
const OTURUM_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-oturum.js'), 'utf8'); // 1.4.0 tarayıcıyla giriş (o-57)
const ESITLEME_BETIK = fs.readFileSync(path.join(KOK, 'src', 'ayarlar-esitleme.js'), 'utf8'); // 1.4.0 klasörle eşitleme (o-58)
const KARO_GORUNUM_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'karo-gorunum.js'), 'utf8');
const DUZEN_ISLEMLERI_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'duzen-islemleri.js'), 'utf8');
const KISAYOL_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'kisayol.js'), 'utf8');
const ARAMA_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'arama.js'), 'utf8');
const AYAR_ARAMA_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ayar-arama.js'), 'utf8'); // yalnız aramaModulu: true ile yüklenir
const DIL_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'dil.js'), 'utf8');
const TEMA_RENK_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'tema-renk.js'), 'utf8');
const SOZLUK_ANA_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ceviri', 'ana.js'), 'utf8');
const SOZLUK_AYARLAR_BETIGI = fs.readFileSync(path.join(KOK, 'src', 'lib', 'ceviri', 'ayarlar.js'), 'utf8');
const DIL_AYARLARI = ['sistem', 'tr', 'en', 'de', 'fr', 'es'];

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
    this._pasif = false;
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

  // Gerçek tarayıcıda odaktaki öğe pasifleşince odak belgenin gövdesine düşer (document.activeElement === body).
  get disabled() {
    return this._pasif;
  }

  set disabled(deger) {
    this._pasif = Boolean(deger);
    if (this._pasif && this.sahne && this.sahne.sonOdak === this) this.sahne.sonOdak = null;
  }

  get textContent() {
    return this._metin + this.children.map((c) => c.textContent).join('');
  }

  set textContent(deger) {
    this._metin = String(deger);
    this._cocuklariBirak();
  }

  /** Alt ağaç DOM'dan çıkarken odak içindeyse odak gövdeye düşer (gerçek tarayıcı davranışı). */
  _cocuklariBirak() {
    const odak = this.sahne && this.sahne.sonOdak;
    if (odak && this.bul((o) => o === odak).length > 0) this.sahne.sonOdak = null;
    this.children = [];
  }

  appendChild(cocuk) {
    this.children.push(cocuk);
    return cocuk;
  }

  replaceChildren(...cocuklar) {
    this._metin = '';
    this._cocuklariBirak();
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
    this.click();
  }

  /** HTMLElement.click(): etkin işaret kutusu çevrilir ve change gider; sonra click olayı (tarayıcının kendi olayları, dispatchEvent değil). */
  click() {
    if (this.etiket === 'input' && this.type === 'checkbox' && !this.disabled) {
      this.checked = !this.checked;
      this._olayVer({ type: 'change', target: this });
    }
    this._olayVer({ type: 'click', target: this, stopPropagation() {}, preventDefault() {} });
  }

  /** Olayı dispatchEvent'e uğramadan (tarayıcının kendi olayı gibi) dinleyicilere iletir. */
  _olayVer(olay) {
    olay.target ??= this;
    for (const isleyici of this.dinleyiciler[olay.type] ?? []) isleyici(olay);
  }

  /** Gerçek EventTarget gibi: bu öğenin dispatchEvent'i düz nesneyle TypeError verir (yalnız Event kabul edilir). */
  katiOlayKipi() {
    this.dispatchEvent = () => {
      throw new TypeError("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.");
    };
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
  // 1.4.0 bilgi grubu (src/lib/ayar-alanlari.js): sahte ana süreç yükteki değeri olduğu gibi saklar (doğrulama ana süreçte ve kendi testinde)
  'sensorSeridi', 'sensorGrafik', 'sensorGrafikSaat', 'pilEsigi', 'sensorTepsiIpucu', 'ustKart1', 'ustKart2', 'havaVarligi',
  'saatBicimi', 'tarihBicimi', 'takvimler', 'takvimGunSayisi', 'yapilacakListeleri', 'hizliListe',
  // 1.4.0 cihaz grubu (o-48): kamera izin listesi ve görüntü tercihleri
  'kameraIzinleri', 'kameraBulanik', 'kameraYenilemeSn',
  // eksik grubu: hava tahmini şeridi, birincil medya oynatıcı (üst kart), albüm kapağı
  'havaTahmini', 'birincilMedya', 'medyaKapagi',
  // 1.4.0 düzen grubu: panel sayfaları
  'sayfalar',
  // grup "tema" (ayar-alanlari.js tablosu)
  'metinOlcegi', 'yuksekKarsitlik', 'panelTemasi', 'panelVurguRengi', 'panelArkaPlani', 'animasyonlar', 'animasyonGecisleri', 'havaEfekti',
  'mevsimEfekti', 'hareketiAzalt',
  'surumDenetimi',
  // 1.4.0 etkileşim grubu (o-20, o-23, o-60, o-38)
  'kisayolBasiliTut', 'panelSabit', 'karoTekerlegi', 'tepsiOrtaTik', 'baglantiBildirimi', 'baglantiBildirimSn',
  // 1.4.0 dis grubu: Dış tetikler (ana süreçte aktarilir: false; doğrulama src/lib/ayar-alanlari.js)
  'tetikJumpList', 'tetikMasaustu', 'tetikProtokol', 'tetikYerelApi', 'tetikApiPortu', 'tetikApiBildirim', 'tetikPcOlaylari', 'tetikPcAcma',
  'tetikPcKurallari', 'tetikToplanti', 'tetikToplantiKaynak', 'tetikToplantiFavori', 'tetikToplantiBitis', 'tetikToplantiBitisFavori',
  'tetikToplantiAralik',
  // guncelleme grubu (o-51)
  'uygulamaGuncelleme', 'onSurumler',
  // guncel grubu (o-61): mobil bildirimler
  'mobilBildirimler', 'mobilCihazAdi',
  // 1.4.0 eylem grubu (ayar-alanlari.js): etkinlik geçmişi, geri al, gecikmeli eylem, oda, diğer cihazlar
  'etkinlikGecmisi', 'geriAl', 'geriAlSureDk', 'geriAlKisayolu', 'gecikmeliEylem', 'sonDegisenler', 'panelGruplama', 'paletDigerCihazlar',
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

const ORNEK_RAPOR = ['Ev Paneli / Home Panel diagnostics report', 'App version: 1.3.0 (installed build)', 'Home address: private IP, http', ''].join('\n');

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
  yedekleriGetirHata = false, // true: yedekleriGetir reddedilir (IPC hatası)
  aracYaniti = null, // arac grubu (o-40, o-41, o-44) köprü yanıtları: { surumDurumu, surumuDenetle, yenilikleriGetir, tanilamaGetir, tanilamaKopyala, gunlukKlasoruAc, odalariGetir } (işlev ya da nesne)
  depo = null,
  dilOlayi = true,
  gecmis = [],
  donYaniti = null,
  onarYaniti = null,
  gecmisYaniti = null,
  disYaniti = null, // 1.4.0 dis grubu köprü yanıtları: { disTetikDurumu, disKisayolOlustur, disBaglantiKopyala, disJetonKopyala, disJetonYenile, disIzinKaldir } (işlev ya da nesne)
  eylemYaniti = null, // eylem grubu köprü yanıtları: { etkinlikListesi, etkinlikTemizle, ... } (işlev ya da nesne)
  cihazlariGetirBekle = null, // (sıra) => Promise | null: n. cihazlariGetir çağrısının yanıtını (çağrı anındaki verisiyle) söz çözülene dek geciktirir (yarış sınaması)
  baglantiYaniti = null, // bağlantı katmanı (o-55..o-58) köprü yanıtları (test/baglanti-sahte.js)
  koprudenKaldir = [], // köprüden (window.evPaneli) çıkarılacak işlev adları: eski bir preload'u taklit eder (sayfa typeof denetimleriyle çökmeden çalışmalı)
  aramaModulu = false, // true: src/lib/ayar-arama.js (window.EvAyarArama) yüklenir; belge.querySelectorAll('.bolum' vb.) GERÇEK ayarlar.html ağacından (test/mini-dom.js, dönen `aramaAgaci`) yanıtlanır.
  //   Varsayılan kapalı: modül yoktur ve arama kutusu etkisizdir (ayarlar.js modülsüz çalışmalı); ayarlar-kategori.js bu düzeneğe HİÇ yüklenmez (ayarlar.js onsuz da çalışmalı).
}) {
  const sunucu = duzles(ayar);
  const durum = { yedekler, sonOdak: null, gecmis };
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
  let favoriyeGitGeriCagrisi = null;
  let anahtarYoneticiGeriCagrisi = null;
  let disDurumGeriCagrisi = null;
  let bolumAcGeriCagrisi = null;
  let guncellemeGeriCagrisi = null; // o-51: ana süreç 'guncelleme:degisti' itti
  let mobilGeriCagrisi = null; // o-61: ana süreç 'mobil:degisti' itti
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
    if ('baglantiBildirimSn' in yuk) sunucu.baglantiBildirimSn = Number(yuk.baglantiBildirimSn); // ana süreç sayıya çevirir
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
        // Karo görünümü (o-31): ana süreç gibi '' / 'normal' / false değerleri kaydı temizler, gelmeyen alan eskisini korur.
        const simge = 'simge' in g ? g.simge : eski?.simge;
        if (simge) f.simge = simge;
        const renk = 'renk' in g ? g.renk : eski?.renk;
        if (renk) f.renk = renk;
        const boyut = 'boyut' in g ? g.boyut : eski?.boyut;
        if (boyut && boyut !== 'normal') f.boyut = boyut;
        const tepsi = 'tepsi' in g ? g.tepsi : eski?.tepsi;
        if (tepsi === true) f.tepsi = true;
        const kisayolEylemi = 'kisayolEylemi' in g ? g.kisayolEylemi : eski?.kisayolEylemi;
        if (kisayolEylemi && f.kisayol) f.kisayolEylemi = kisayolEylemi;
        // Sensör gösterge aralığı (ana süreçteki gibi çift güncellenir; null temizler) ve grafik biçimi ('otomatik' kayda yazılmaz)
        const aralikGeldi = 'gostergeMin' in g || 'gostergeMax' in g;
        const gMin = aralikGeldi ? g.gostergeMin : eski?.gostergeMin;
        const gMax = aralikGeldi ? g.gostergeMax : eski?.gostergeMax;
        if (g.entity_id.startsWith('sensor.') && typeof gMin === 'number' && typeof gMax === 'number' && gMin < gMax) {
          f.gostergeMin = gMin;
          f.gostergeMax = gMax;
        }
        const grafik = 'grafikTuru' in g ? g.grafikTuru : eski?.grafikTuru;
        if (g.entity_id.startsWith('sensor.') && grafik && grafik !== 'otomatik') f.grafikTuru = grafik;
        return f;
      });
  }

  const baglantiSahtesi = baglantiKopruSahtesi({ cagrilar, secenek: baglantiYaniti ?? {} });
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
      return { ok: true, mesaj: Object.hasOwn(SOZLUK_ANA, sunucu.dil) && sunucu.dil !== 'tr' ? SOZLUK_ANA[sunucu.dil]['bildirim.anahtarSilindi'] : ANAHTAR_SILINDI_METNI };
    },
    yetkiYenidenDene: async (secenek) => {
      cagrilar.push(['yetkiYenidenDene']);
      secenekler.push(['yetkiYenidenDene', secenek]);
      return yenidenDeneYaniti ? yenidenDeneYaniti(secenek, sunucu) : { ok: true };
    },
    cihazlariGetir: async () => {
      cagrilar.push(['cihazlariGetir']);
      const bekle = cihazlariGetirBekle ? cihazlariGetirBekle(cagrilar.filter((c) => c[0] === 'cihazlariGetir').length) : null;
      const kayitli = new Set((sunucu.favoriler ?? []).map((f) => f.entity_id));
      const yanit = cihazlar.ok
        ? {
            ...cihazlar,
            eksik: (cihazlar.eksik ?? []).filter((e) => kayitli.has(e.entity_id)),
            engelli: (cihazlar.engelli ?? []).filter((e) => kayitli.has(e.entity_id)),
          }
        : cihazlar;
      if (bekle) await bekle;
      return yanit;
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
    // İçe aktarma önizlemesi (1.4.0): aktarimYaniti.onizle verilmezse, başarısız bir `ice` yanıtı (iptal / hata) önizlemede de aynen döner
    ayarlariIceAktarOnizle: async () => {
      cagrilar.push(['ayarlariIceAktarOnizle']);
      if (aktarimYaniti?.onizle) return aktarimYaniti.onizle;
      const ice = aktarimYaniti?.ice;
      if (ice && !ice.ok) return ice;
      return { ok: true, ad: ice?.ad ?? 'yedek.json', onizlemeNo: 'onizleme-1', bolumler: ['kisayollar', 'gorunum'], alanSayisi: 12, favoriSayisi: 3, eksikFavoriSayisi: null, atilanSayisi: 0 };
    },
    ayarlariIceAktar: async (onizlemeNo) => {
      cagrilar.push(['ayarlariIceAktar', onizlemeNo]);
      const yanit = aktarimYaniti?.ice ?? { ok: true, ad: 'yedek.json', alanSayisi: 12, favoriSayisi: 3, atilanSayisi: 0, notlar: [], uyarilar: [] };
      if (yanit.ok && aktarimYaniti?.icesonrasi) aktarimYaniti.icesonrasi(sunucu);
      return yanit;
    },
    yedekleriGetir: async () => {
      cagrilar.push(['yedekleriGetir']);
      if (yedekleriGetirHata) throw new Error('ipc');
      return { ok: true, yedekler: durum.yedekler };
    },
    yedektenDon: async (ad) => {
      cagrilar.push(['yedektenDon', ad]);
      const yanit = yedektenDonYaniti ?? { ok: true, ad, alanSayisi: 10, favoriSayisi: 2, atilanSayisi: 0, notlar: [], uyarilar: [] };
      if (yanit.ok && aktarimYaniti?.icesonrasi) aktarimYaniti.icesonrasi(sunucu);
      return yanit;
    },
    // arac grubu (o-40): açılışta çağrılan okumalar `cagrilar`a yazılmaz (mevcut testlerin tam çağrı listeleri bozulmasın); kullanıcı eylemleri yazılır.
    surumDurumu: async () => {
      const y = aracYaniti?.surumDurumu;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, surum: '1.3.0', acik: sunucu.surumDenetimi === true, sonDenetim: null, yeniSurum: null };
    },
    surumuDenetle: async () => {
      cagrilar.push(['surumuDenetle']);
      const y = aracYaniti?.surumuDenetle;
      if (typeof y === 'function') return y(sunucu);
      if (y) return y;
      return sunucu.surumDenetimi === true ? { ok: true, sonuc: 'guncel', surum: '1.3.0' } : { ok: true, sonuc: 'kapali' };
    },
    yenilikleriGetir: async () => {
      const y = aracYaniti?.yenilikleriGetir;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, surum: '1.3.0', bulundu: true, baslik: '1.3.0 — 2026-10-16', metin: 'First public release.\n\n• Interface language.' };
    },
    surumSayfasiniAc: async () => {
      cagrilar.push(['surumSayfasiniAc']);
      return { ok: true };
    },
    // guncelleme grubu (o-51): durum okuması `cagrilar`a yazılmaz; kullanıcı eylemleri (indir, kur) yazılır.
    guncellemeDurumu: async () => {
      const y = aracYaniti?.guncellemeDurumu;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, acik: sunucu.uygulamaGuncelleme === true, destek: 'tamam', durum: 'bosta', surum: null, onSurum: false, boyut: null, ilerleme: 0, hata: null, sonDenetim: null };
    },
    guncellemeyiIndir: async () => {
      cagrilar.push(['guncellemeyiIndir']);
      const y = aracYaniti?.guncellemeyiIndir;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, sonuc: 'indirildi', surum: '1.4.0' };
    },
    guncellemeyiKur: async () => {
      cagrilar.push(['guncellemeyiKur']);
      const y = aracYaniti?.guncellemeyiKur;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, sonuc: 'kuruluyor', surum: '1.4.0' };
    },
    onGuncellemeDegisti: (geriCagri) => {
      guncellemeGeriCagrisi = geriCagri;
      return () => {};
    },
    // guncel grubu (o-61): mobil bildirimler; durum okuması `cagrilar`a yazılmaz, kullanıcı eylemleri (kaydol, kaydı sil) yazılır.
    mobilDurumu: async () => {
      const y = aracYaniti?.mobilDurumu;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, kayitli: false, etkin: sunucu.mobilBildirimler === true, kanal: 'kayitsiz', kayitSuruyor: false, sonBildirim: null, dusenBildirim: 0, canliAcik: true, sifrelemeVar: true, cihazAdi: '' };
    },
    mobilKaydol: async (cihazAdi) => {
      cagrilar.push(['mobilKaydol', cihazAdi]);
      const y = aracYaniti?.mobilKaydol;
      return typeof y === 'function' ? y(sunucu, cihazAdi) : y ?? { ok: true, sonuc: 'kaydoldu', kayitli: true, etkin: true, kanal: 'dinliyor', kayitSuruyor: false, sonBildirim: null, dusenBildirim: 0, canliAcik: true, mobilBildirimler: true, mobilCihazAdi: cihazAdi };
    },
    mobilKaydiSil: async () => {
      cagrilar.push(['mobilKaydiSil']);
      const y = aracYaniti?.mobilKaydiSil;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, sonuc: 'silindi', kayitli: false, etkin: false, kanal: 'kayitsiz', kayitSuruyor: false, sonBildirim: null, dusenBildirim: 0, canliAcik: true, mobilBildirimler: false };
    },
    onMobilDegisti: (geriCagri) => {
      mobilGeriCagrisi = geriCagri;
      return () => {};
    },
    // arac grubu (o-41): tanılama raporu ve günlük klasörü; kullanıcı eylemleri `cagrilar`a yazılır
    tanilamaGetir: async () => {
      cagrilar.push(['tanilamaGetir']);
      const y = aracYaniti?.tanilamaGetir;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, metin: ORNEK_RAPOR, gunlukSatiri: 3 };
    },
    tanilamaKopyala: async () => {
      cagrilar.push(['tanilamaKopyala']);
      const y = aracYaniti?.tanilamaKopyala;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, metin: ORNEK_RAPOR, gunlukSatiri: 3 };
    },
    gunlukKlasoruAc: async () => {
      cagrilar.push(['gunlukKlasoruAc']);
      const y = aracYaniti?.gunlukKlasoruAc;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true };
    },
    // arac grubu (o-44): odalar ve önerilen cihazlar (yalnız okur); varsayılan yanıt: Salon (yüklü cihazlar) ve Mutfak (cihazı yüklü listede yok)
    odalariGetir: async () => {
      cagrilar.push(['odalariGetir']);
      const y = aracYaniti?.odalariGetir;
      if (typeof y === 'function') return y(sunucu);
      if (y) return y;
      return {
        ok: true,
        alanSayisi: 2,
        odalar: [
          { id: 'salon', ad: 'Salon', toplam: 2, cihazlar: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', alan: 'light' }, { entity_id: 'scene.film', ad: 'Film', alan: 'scene' }] },
          { id: 'mutfak', ad: 'Mutfak', toplam: 1, cihazlar: [{ entity_id: 'light.mutfak_lambasi', ad: 'Mutfak Lambası', alan: 'light' }] }, // yüklü cihaz listesinde YOK
        ],
      };
    },
    onBolumAc: (geriCagri) => {
      bolumAcGeriCagrisi = geriCagri;
      return () => {};
    },
    onFavorilerDegisti: (geriCagri) => {
      favoriDegistiGeriCagrisi = geriCagri;
      return () => {};
    },
    onDilDegisti: (geriCagri) => {
      dilGeriCagrisi = geriCagri;
      return () => {};
    },
    // 1.4.0 düzen (o-16, o-28, o-30)
    duzenGecmisiniGetir: async () => {
      cagrilar.push(['duzenGecmisiniGetir']);
      return gecmisYaniti ? gecmisYaniti(durum.gecmis) : { ok: true, noktalar: duzles(durum.gecmis) };
    },
    duzeneDon: async (id) => {
      cagrilar.push(['duzeneDon', id]);
      if (donYaniti) return donYaniti(id, sunucu);
      return { ok: true, favoriSayisi: (sunucu.favoriler ?? []).length, sayfaSayisi: (sunucu.sayfalar ?? []).length, atilan: 0 };
    },
    favoriyiOnar: async (eski, yeni) => {
      cagrilar.push(['favoriyiOnar', eski, yeni]);
      if (onarYaniti) return onarYaniti(eski, yeni, sunucu);
      // Ana süreç gibi: favori yerinde yeni kimliğe bağlanır, sayfalardaki kimlik de değişir.
      const bilinenAd = new Map((cihazlar?.cihazlar ?? []).map((c) => [c.entity_id, c.ad]));
      sunucu.favoriler = (sunucu.favoriler ?? []).map((f) => (f.entity_id === eski ? { ...f, entity_id: yeni, ad: bilinenAd.get(yeni) ?? yeni } : f));
      sunucu.sayfalar = (sunucu.sayfalar ?? []).map((s) => ({ ...s, varliklar: s.varliklar.map((k) => (k === eski ? yeni : k)) }));
      return { ok: true, favoriSayisi: sunucu.favoriler.length };
    },
    onFavoriyeGit: (geriCagri) => {
      favoriyeGitGeriCagrisi = geriCagri;
      return () => {};
    },
    // 1.4.0 etkileşim (o-43): anahtarın kullanıcı türü ölçüldü ya da unutuldu ('ayarlar:anahtar-yonetici')
    onAnahtarYonetici: (geriCagri) => {
      anahtarYoneticiGeriCagrisi = geriCagri;
    },
    // 1.4.0 dis grubu: durum okuması açılışta çağrılır ve `cagrilar`a yazılmaz; kullanıcı eylemleri yazılır. Varsayılan durum boş (uygun favori yok).
    disTetikDurumu: async () => {
      const y = disYaniti?.disTetikDurumu;
      if (typeof y === 'function') return y(sunucu);
      return y ?? { ok: true, uygunlar: [], kuralUygunlari: [], izinler: [], api: { calisiyor: false, port: null, hata: null, jetonVar: false }, protokol: { kayitli: false }, toplanti: { calisiyor: false, toplantida: false, okunabilir: true } };
    },
    disKisayolOlustur: async (kimlik) => {
      cagrilar.push(['disKisayolOlustur', kimlik]);
      const y = disYaniti?.disKisayolOlustur;
      return typeof y === 'function' ? y(kimlik, sunucu) : y ?? { ok: true, dosya: 'Salon.lnk' };
    },
    disBaglantiKopyala: async (kimlik) => {
      cagrilar.push(['disBaglantiKopyala', kimlik]);
      const y = disYaniti?.disBaglantiKopyala;
      return typeof y === 'function' ? y(kimlik, sunucu) : y ?? { ok: true };
    },
    disJetonKopyala: async () => {
      cagrilar.push(['disJetonKopyala']);
      const y = disYaniti?.disJetonKopyala;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true };
    },
    disJetonYenile: async () => {
      cagrilar.push(['disJetonYenile']);
      const y = disYaniti?.disJetonYenile;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true };
    },
    disIzinKaldir: async (kimlik) => {
      cagrilar.push(['disIzinKaldir', kimlik]);
      const y = disYaniti?.disIzinKaldir;
      return typeof y === 'function' ? y(kimlik, sunucu) : y ?? { ok: true };
    },
    onDisDurumDegisti: (geriCagri) => {
      disDurumGeriCagrisi = geriCagri;
      return () => {};
    },
    // 1.4.0 eylem grubu: okumalar `cagrilar`a yazılmaz (mevcut testlerin tam çağrı listeleri bozulmasın); kullanıcı eylemleri yazılır.
    etkinlikListesi: async () => {
      const y = eylemYaniti?.etkinlikListesi;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true, acik: sunucu.etkinlikGecmisi !== false, kayitlar: [] };
    },
    etkinlikTemizle: async () => {
      cagrilar.push(['etkinlikTemizle']);
      const y = eylemYaniti?.etkinlikTemizle;
      return typeof y === 'function' ? y(sunucu) : y ?? { ok: true };
    },
    // 1.4.0 bağlantı katmanı (o-55..o-58)
    ...baglantiSahtesi.kopru,
  };
  for (const ad of koprudenKaldir) delete evPaneli[ad];
  const aramaAgaci = aramaModulu ? require('./mini-dom').htmlAgaci(HTML) : null;

  const belge = {
    getElementById(kimlik) {
      const oge = ogeler.get(kimlik);
      assert.ok(oge, `ayarlar.html içinde #${kimlik} yok`);
      return oge;
    },
    createElement: (etiket) => new SahteOge(etiket, null, durum),
    body: { etiket: 'body' },
    // Odak kayıtlıysa o öğe; yoksa (hiçbir öğe odaklanmadı ya da odaklı öğe DOM'dan çıktı/pasifleşti) gövde.
    get activeElement() {
      return durum.sonOdak || this.body;
    },
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
      // Arama modülü açıkken yalnız çeviri seçicileri sahte öğelere gider; .bolum / .form-grubu / .grup-baslik gibi yapı seçicileri gerçek HTML ağacına.
      if (aramaAgaci && secici !== '[data-i18n]' && secici !== '[data-i18n-attr]') return aramaAgaci.querySelectorAll(secici);
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
  if (aramaModulu) vm.runInContext(AYAR_ARAMA_BETIGI, sandbox, { filename: 'ayar-arama.js' });
  vm.runInContext(TEMA_RENK_BETIGI, sandbox, { filename: 'tema-renk.js' });
  vm.runInContext(KARO_GORUNUM_BETIGI, sandbox, { filename: 'karo-gorunum.js' });
  vm.runInContext(DUZEN_ISLEMLERI_BETIGI, sandbox, { filename: 'duzen-islemleri.js' });
  vm.runInContext(DUZEN_BETIK, sandbox, { filename: 'ayarlar-duzen.js' });
  vm.runInContext(DIS_BETIK, sandbox, { filename: 'ayarlar-dis.js' });
  vm.runInContext(EYLEM_BETIK, sandbox, { filename: 'ayarlar-eylem.js' });
  vm.runInContext(BAGLANTI_BETIK, sandbox, { filename: 'ayarlar-baglanti.js' });
  vm.runInContext(SERTIFIKA_BETIK, sandbox, { filename: 'ayarlar-sertifika.js' });
  vm.runInContext(OTURUM_BETIK, sandbox, { filename: 'ayarlar-oturum.js' });
  vm.runInContext(ESITLEME_BETIK, sandbox, { filename: 'ayarlar-esitleme.js' });
  vm.runInContext(BETIK, sandbox, { filename: 'ayarlar.js' });
  return {
    oge: (kimlik) => ogeler.get(kimlik),
    /** aramaModulu: true ise arama modülünün gezdiği gerçek ayarlar.html ağacı (test/mini-dom.js); değilse null. */
    aramaAgaci,
    /** Sayfa bağlamında window.<ad> tanımlı mı (örn. 'EvAyarArama', 'EvAyarKategori'). */
    modulYuklu: (ad) => sandbox[ad] !== undefined,
    baglantiDeposu: baglantiSahtesi.baglantiDeposu,
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
    /** Ana süreç 'dis:durum-degisti' gönderdi (1.4.0 dis grubu). */
    disDurumDegisti: async () => {
      assert.ok(disDurumGeriCagrisi, 'onDisDurumDegisti kaydedilmemiş');
      disDurumGeriCagrisi();
      await akit();
    },
    /** Ana süreç 'ayarlar:bolum-ac' gönderdi (tepsi "Yenilikler" gibi). */
    bolumIste: async (bolum) => {
      assert.ok(bolumAcGeriCagrisi, 'onBolumAc kaydedilmemiş');
      bolumAcGeriCagrisi({ bolum });
      await akit();
    },
    /** Ana süreç 'guncelleme:degisti' gönderdi (denetim, indirme ilerlemesi, kurulum). */
    guncellemeDegisti: async (yuk) => {
      assert.ok(guncellemeGeriCagrisi, 'onGuncellemeDegisti kaydedilmemiş');
      guncellemeGeriCagrisi(yuk);
      await akit();
    },
    /** Ana süreç 'mobil:degisti' gönderdi (yeni bildirim, kanal kapandı, kayıt düştü). */
    mobilDegisti: async (yuk) => {
      assert.ok(mobilGeriCagrisi, 'onMobilDegisti kaydedilmemiş');
      mobilGeriCagrisi(yuk);
      await akit();
    },
    favoriDegisti: async () => {
      assert.ok(favoriDegistiGeriCagrisi, 'onFavorilerDegisti kaydedilmemiş');
      favoriDegistiGeriCagrisi();
      await akit();
    },
    /** Panel karo menüsünden "Düzenle…" (ana süreç 'ayarlar:favoriye-git' gönderdi). */
    favoriyeGit: async (kimlik) => {
      assert.ok(favoriyeGitGeriCagrisi, 'onFavoriyeGit kaydedilmemiş');
      favoriyeGitGeriCagrisi(kimlik);
      await akit();
    },
    gecmisiDegistir: (liste) => {
      durum.gecmis = liste;
    },
    /** Ana süreç 'ayarlar:anahtar-yonetici' gönderdi (yük olduğu gibi iletilir). */
    anahtarYoneticiOlayi: async (yuk) => {
      assert.ok(anahtarYoneticiGeriCagrisi, 'onAnahtarYonetici kaydedilmemiş');
      anahtarYoneticiGeriCagrisi(yuk);
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
  DUZEN_BETIK,
  DIS_BETIK,
  EYLEM_BETIK,
  BAGLANTI_BETIK,
  SERTIFIKA_BETIK,
  OTURUM_BETIK,
  ESITLEME_BETIK,
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
