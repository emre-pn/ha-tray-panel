'use strict';

/**
 * Hızlı panelin bilgi bölümleri (src/yuzey-bilgi.js): üst kartlar (saat, hava, varlık), sensör şeridi, sensör karoları (mini grafik +
 * gösterge), yapılacaklar, takvim, geçmiş / karşılaştırma görünümü, palet hızlı ekleme çözümü. Sayfa betiğiyle bütünleşme
 * (Esc, palet, gösterim sıfırlaması, basılı tutma) test/yuzey-sayfa.test.js içindedir.
 *
 * Sahte DOM ve sahte ctx kullanılır: gerçek pencere, Electron, ağ ya da Home Assistant YOK. Okuma / eylem uçları betiklenmiş
 * sahte işlevlerdir; sahte zamanlayıcı süreleri milisaniye milisaniye sınar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Bilgi = require('../src/yuzey-bilgi');
const Grafik = require('../src/lib/grafik');
const Bicim = require('../src/lib/bilgi-bicim');
const Dil = require('../src/lib/dil');
const Sozluk = require('../src/lib/ceviri/yuzey');

const KAYNAK = fs.readFileSync(path.join(__dirname, '..', 'src', 'yuzey-bilgi.js'), 'utf8');

// ---- sahte DOM ------------------------------------------------------------------------------------------------------

class Oge {
  constructor(etiket) {
    this.etiket = etiket;
    this.children = [];
    this.attributes = {};
    this.dinleyiciler = {};
    this.className = '';
    this.hidden = false;
    this.title = '';
    this.type = '';
    this.value = '';
    this.maxLength = 0;
    this._metin = '';
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

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  getAttribute(ad) {
    return this.attributes[ad] ?? null;
  }

  addEventListener(ad, isleyici) {
    (this.dinleyiciler[ad] ??= []).push(isleyici);
  }

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

const siniflar = (o) => `${o.className} ${o.attributes.class ?? ''}`.split(/\s+/).filter(Boolean);
const sinifli = (o, ad) => siniflar(o).includes(ad);
const bulSinif = (kok, ad) => (Array.isArray(kok) ? kok : [kok]).flatMap((k) => (sinifli(k, ad) ? [k] : []).concat(k.bul((o) => sinifli(o, ad))));
const metin = (kok) => (Array.isArray(kok) ? kok : [kok]).map((k) => k.textContent).join('|');

const belge = {
  createElement: (etiket) => new Oge(etiket),
  createElementNS: (ad, etiket) => {
    const o = new Oge(etiket);
    o.adAlani = ad;
    return o;
  },
};

function sahteZaman(baslangic) {
  let t = baslangic;
  let sonId = 0;
  const bekleyenler = new Map();
  return {
    simdi: () => t,
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

const akit = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((coz) => setImmediate(coz));
};

// ---- model ve ortam ---------------------------------------------------------------------------------------------------

const karo = (id, etiket, alan, ozellik, ek = {}) => ({ id, etiket, alan, kullanilabilir: true, ulasilamiyor: false, ozellik, ...ek });
const SICAKLIK = karo('sensor.salon_sicaklik', 'Salon sıcaklık', 'sensor', { deger: '21.4', sayi: 21.4, birim: '°C', sinif: 'temperature', hassasiyet: 1, enAz: null, enCok: null });
const PIL = karo('sensor.kumanda_pil', 'Kumanda pil', 'sensor', { deger: '12', sayi: 12, birim: '%', sinif: 'battery', hassasiyet: null, enAz: null, enCok: null });
const HAREKET = karo('binary_sensor.salon_hareket', 'Salon hareket', 'binary_sensor', { acik: true, sinif: 'motion' });
const HAVA = karo('weather.ev', 'Ev', 'weather', { durum: 'partlycloudy', sicaklik: 24.5, birim: '°C', nem: 40, ruzgar: 12, ruzgarBirim: 'km/h', basinc: 1012 });
const AYAR = { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 };

const modelOlustur = (ek = {}) => ({
  ayar: { ...AYAR },
  kartlar: [{ yuva: 1, tur: 'saat', karo: null, secilmedi: false }, { yuva: 2, tur: 'hava', karo: HAVA, secilmedi: false }],
  serit: [SICAKLIK, HAREKET],
  sensorler: [SICAKLIK, PIL],
  takvimler: [{ id: 'calendar.ev', etiket: 'Ev takvimi', kullanilabilir: true, mesgul: false }],
  listeler: [{ id: 'todo.alisveris', etiket: 'Alışveriş', kullanilabilir: true, acikSayisi: 2 }],
  hizliListe: 'todo.alisveris',
  ...ek,
});

const BASLANGIC = new Date(2026, 9, 16, 12, 0, 0).getTime(); // yerel öğle: gün farkları saat diliminden bağımsız
const SAAT = 3_600_000;

/** Betiklenmiş okuma yanıtı: tur -> (istek) => yanıt | söz. Varsayılan: boş ama başarılı. */
function ortamKur({ okuma = {}, calistir = async () => ({ ok: true }), acik = true, baslangic = BASLANGIC } = {}) {
  const zaman = sahteZaman(baslangic);
  const kayit = { okumalar: [], calistirmalar: [], cizimler: 0, ipuclari: [], satirlar: [], odak: new Map(), odakIstekleri: [], donuk: 0, donukBaslat: 0, donukBitir: 0, basiliKarolar: [] };
  const t = Dil.cevirmen('tr', Sozluk);
  const ctx = {
    doc: belge,
    t,
    dil: () => 'tr',
    olustur: (etiket, sinif, icerik) => {
      const o = new Oge(etiket);
      if (sinif) o.className = sinif;
      if (icerik !== undefined && icerik !== null) o.textContent = String(icerik);
      return o;
    },
    odakKaydet: (anahtar, oge) => {
      kayit.odak.set(anahtar, oge);
      return oge;
    },
    odakIste: (anahtar) => kayit.odakIstekleri.push(anahtar),
    satirEkle: (ogeler) => kayit.satirlar.push(ogeler),
    oku: (istek) => {
      kayit.okumalar.push(JSON.parse(JSON.stringify(istek)));
      const isleyici = okuma[istek.tur] ?? (() => ({ ok: true, veri: istek.tur === 'gecmis' ? {} : [] }));
      return Promise.resolve().then(() => isleyici(istek));
    },
    calistir: (yuk, k, oge) => {
      kayit.calistirmalar.push(JSON.parse(JSON.stringify(yuk)));
      return Promise.resolve().then(() => calistir(yuk, k, oge));
    },
    // sayfanın basiliTutmaOlustur'unun kısa devresi: basla() süre dolmuş gibi eylemi basili:true ile ister
    basiliTutma: (k, gorsel, ekYuk, bitti) => {
      kayit.basiliKarolar.push(k);
      return {
        basla: () => {
          const sonuc = ctx.calistir({ kimlik: k.id, ...(ekYuk ?? {}), basili: true }, k, gorsel);
          if (bitti) bitti(sonuc);
        },
        birak: () => {},
      };
    },
    donukBaslat: () => {
      kayit.donuk += 1;
      kayit.donukBaslat += 1;
    },
    donukBitir: () => {
      kayit.donuk = Math.max(0, kayit.donuk - 1);
      kayit.donukBitir += 1;
    },
    yenidenCiz: () => {
      kayit.cizimler += 1;
    },
    ipucu: (m) => kayit.ipuclari.push(m),
    simdi: zaman.simdi,
    zamanlayici: zaman,
    acikMi: () => acik,
    Grafik,
    Bicim,
    izgaraKolon: 3,
  };
  const modul = Bilgi.olustur(ctx);
  return { modul, ctx, zaman, kayit, t };
}

const nokta = (saatOnce, d) => ({ t: BASLANGIC - saatOnce * SAAT, d });

// ---- modelDuzelt ve hızlı ekleme çözümü -------------------------------------------------------------------------------

test('modelDuzelt: bozuk girdi null; sınırlar uygulanır; bilinmeyen / yasak alanlar (kilit, kapak, kamera, alarm) karoya girmez', () => {
  for (const kotu of [null, undefined, 5, 'x', []]) assert.equal(Bilgi.modelDuzelt(kotu), null, String(kotu));
  const yasak = ['lock.on_kapi', 'cover.garaj', 'camera.salon', 'alarm_control_panel.ev', 'light.salon', 'siren.alarm'].map((id) => karo(id, id, id.split('.')[0], { deger: 'x', sayi: null, birim: null, sinif: null }));
  const m = Bilgi.modelDuzelt({
    ayar: { saatBicimi: 'x', tarihBicimi: 5, takvimGunSayisi: 99, sensorGrafikSaat: 7, pilEsigi: 'a' },
    kartlar: [{ yuva: 1, tur: 'varlik', karo: yasak[0] }, { yuva: 2, tur: 'hava', karo: SICAKLIK }, { yuva: 2, tur: 'saat' }, { yuva: 1, tur: 'saat' }],
    serit: [...yasak, ...Array.from({ length: 10 }, (_, i) => karo(`sensor.s${i}`, `S${i}`, 'sensor', { deger: '1', sayi: 1, birim: null, sinif: null }))],
    sensorler: yasak,
    takvimler: Array.from({ length: 9 }, (_, i) => ({ id: `calendar.c${i}`, etiket: 'C', kullanilabilir: true })),
    listeler: [{ id: 5 }, null, { id: 'todo.a', etiket: 'A', kullanilabilir: true, acikSayisi: 2.5 }],
    hizliListe: 7,
  });
  assert.deepEqual(m.ayar, { saatBicimi: 'sistem', tarihBicimi: 'orta', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20, havaTahmini: 'kapali' });
  assert.deepEqual(m.kartlar.map((k) => k.tur), ['hava', 'saat'], 'kilit varlık kartı düşer (kota harcamaz); hava kartında sensör karo yok sayılır (karo null); en çok 2 kart');
  assert.equal(m.kartlar[0].karo, null);
  assert.equal(Bilgi.modelDuzelt({ kartlar: [{ yuva: 1, tur: 'saat' }, { yuva: 2, tur: 'saat' }, { yuva: 2, tur: 'saat' }] }).kartlar.length, 2, 'en çok 2 yuva');
  assert.deepEqual(m.serit.map((k) => k.id), Array.from({ length: 6 }, (_, i) => `sensor.s${i}`), 'şerit en çok 6, yalnız sensor / binary_sensor');
  assert.deepEqual(m.sensorler, []);
  assert.equal(m.takvimler.length, 4);
  assert.deepEqual(m.listeler.map((l) => [l.id, l.acikSayisi]), [['todo.a', null]]);
  assert.equal(m.hizliListe, '');
});

test('modelDuzelt: uzun metinler kırpılır, ozellik yalnız bilinen alanlarla kalır', () => {
  const uzun = 'x'.repeat(500);
  const m = Bilgi.modelDuzelt({ serit: [karo('sensor.a', uzun, 'sensor', { deger: uzun, sayi: 1, birim: uzun, sinif: uzun, ek: 'gizli', hassasiyet: 2 })] });
  assert.equal(m.serit[0].etiket.length, 60);
  assert.equal(m.serit[0].ozellik.deger.length, 40);
  assert.equal(m.serit[0].ozellik.birim.length, 12);
  assert.equal(Object.hasOwn(m.serit[0].ozellik, 'ek'), false);
  assert.equal(Bilgi.modelDuzelt({ serit: [{ id: 'sensor.a', alan: 'sensor', ozellik: 'metin' }] }).serit[0].ozellik, null);
});

test('hizliEkleSatiri: "liste süt" / "list milk" / "todo ..." ayardaki kullanılabilir listeye çözülür; diğer sorgular ve listesiz ayar null', () => {
  const { modul } = ortamKur();
  modul.ayarla(modelOlustur());
  assert.deepEqual(modul.hizliEkleSatiri('liste süt'), { metin: 'süt', liste: { id: 'todo.alisveris', etiket: 'Alışveriş' } });
  assert.deepEqual(modul.hizliEkleSatiri('  LİSTE   süt   ve   yumurta '), { metin: 'süt ve yumurta', liste: { id: 'todo.alisveris', etiket: 'Alışveriş' } });
  assert.equal(modul.hizliEkleSatiri('list milk').metin, 'milk');
  assert.equal(modul.hizliEkleSatiri('todo a').metin, 'a');
  for (const sorgu of ['liste', 'liste ', 'ışık 40', 'listem süt', 'süt liste', '', 'liste ' + 'a'.repeat(201)]) assert.equal(modul.hizliEkleSatiri(sorgu), null, JSON.stringify(sorgu.slice(0, 20)));
  // hızlı liste seçilmemiş / listede yok / kullanılamıyor
  const { modul: m2 } = ortamKur();
  m2.ayarla(modelOlustur({ hizliListe: '' }));
  assert.equal(m2.hizliEkleSatiri('liste süt'), null);
  m2.ayarla(modelOlustur({ hizliListe: 'todo.baska' }));
  assert.equal(m2.hizliEkleSatiri('liste süt'), null);
  m2.ayarla(modelOlustur({ listeler: [{ id: 'todo.alisveris', etiket: 'Alışveriş', kullanilabilir: false, acikSayisi: null }] }));
  assert.equal(m2.hizliEkleSatiri('liste süt'), null);
  const { modul: m3 } = ortamKur();
  assert.equal(m3.hizliEkleSatiri('liste süt'), null, 'model henüz yok');
});

// ---- üst kartlar ve sensör şeridi -------------------------------------------------------------------------------------

test('saat (1.7.0 hero): saat ve tarih yazılır, her dakika başında kendini günceller; tarih "yok" ise gizlenir', () => {
  const { modul, zaman } = ortamKur();
  modul.ayarla(modelOlustur());
  const ust = modul.heroParcalari();
  const saatDegeri = bulSinif(ust, 'saat-deger')[0];
  const tarih = bulSinif(ust, 'saat-tarih')[0];
  assert.equal(saatDegeri.textContent, Bicim.saatMetni(BASLANGIC, { saatBicimi: '24' }));
  assert.equal(tarih.textContent, Bicim.tarihMetni(BASLANGIC, { tarihBicimi: 'kisa', dil: 'tr' }));
  assert.equal(tarih.hidden, false);
  zaman.ilerle(60_000 + 100);
  assert.equal(saatDegeri.textContent, Bicim.saatMetni(BASLANGIC + 60_100, { saatBicimi: '24' }), 'bir dakika sonra yeni saat');
  // tarih biçimi yok
  const { modul: m2 } = ortamKur();
  m2.ayarla(modelOlustur({ ayar: { ...AYAR, tarihBicimi: 'yok' } }));
  const t2 = bulSinif(m2.heroParcalari(), 'saat-tarih')[0];
  assert.equal(t2.hidden, true);
  assert.equal(t2.textContent, '');
});

test('hava (1.7.0 hero): yuvarlanmış sıcaklık, durum ve nem görünür; tam değer ve rüzgâr erişilebilir adda; seçilmemiş / alınamamış durumlar ayrı söylenir; ham durum adı sızmaz', () => {
  const { modul } = ortamKur();
  modul.ayarla(modelOlustur());
  const kart = bulSinif(modul.heroParcalari(), 'hero-hava')[0];
  assert.match(kart.textContent, /25°/);
  assert.match(kart.textContent, /Parçalı bulutlu · Nem %40/);
  assert.match(kart.attributes['aria-label'], /24,5 °C/);
  assert.match(kart.attributes['aria-label'], /Rüzgâr 12 km\/h/);
  assert.doesNotMatch(kart.textContent + kart.attributes['aria-label'], /partlycloudy|yuzey\.bilgi/);
  const simge = bulSinif(kart, 'hava-ikon')[0];
  assert.equal(simge.attributes['aria-hidden'], 'true', 'simge süstür');
  assert.equal(bulSinif(modul.ustParcalar(), 'hero-hava').length + bulSinif(modul.ustParcalar(), 'saat-deger').length, 0, 'içerikte saat / hava yok');

  const secilmedi = ortamKur();
  secilmedi.modul.ayarla(modelOlustur({ kartlar: [{ yuva: 1, tur: 'hava', karo: null, secilmedi: true }] }));
  assert.match(metin(secilmedi.modul.heroParcalari()), /Hava durumu varlığı seçilmedi/);
  const yok = ortamKur();
  yok.modul.ayarla(modelOlustur({ kartlar: [{ yuva: 1, tur: 'hava', karo: { ...HAVA, ulasilamiyor: true }, secilmedi: false }] }));
  assert.match(metin(yok.modul.heroParcalari()), /Hava durumu alınamadı/);
});

test('hava kartı: yalnız mevcut durum gösterilir (tahmin okuması yok)', () => {
  const { modul, kayit } = ortamKur();
  modul.ayarla(modelOlustur());
  modul.ustParcalar();
  assert.equal(kayit.okumalar.some((o) => o.tur === 'hava'), false);
});

test('varlık kartı ve sensör şeridi: değer + birim, ikili sensör sözcükleri, uyarı metni; tıklayınca geçmiş açılır; kapı kuralı için yasak alan çizilmez', () => {
  const { modul, kayit } = ortamKur();
  modul.ayarla(modelOlustur({
    kartlar: [{ yuva: 1, tur: 'varlik', karo: PIL, secilmedi: false }],
    serit: [SICAKLIK, HAREKET, { ...PIL, id: 'sensor.yok', etiket: 'Kayıp', ulasilamiyor: true }, karo('binary_sensor.su', 'Su', 'binary_sensor', { acik: true, sinif: 'moisture' })],
  }));
  const ust = modul.ustParcalar();
  const kart = bulSinif(ust, 'kart-varlik')[0];
  assert.match(kart.textContent, /Kumanda pil/);
  assert.match(kart.textContent, /%12/);
  assert.match(kart.textContent, /! pil zayıf/, 'uyarı yalnız renkle değil metinle de söylenir');
  assert.ok(sinifli(kart, 'dikkat'));
  assert.match(kart.attributes['aria-label'], /pil zayıf/);

  const oge = bulSinif(ust, 'serit-oge');
  assert.equal(oge.length, 4);
  assert.match(oge[0].textContent, /Salon sıcaklık21,4 °C/);
  assert.match(oge[1].textContent, /Salon hareket.*hareket var/);
  assert.match(oge[2].textContent, /ulaşılamıyor/);
  assert.equal(sinifli(oge[2], 'dikkat'), false, 'ulaşılamayan sensör sürekli alarm sayılmaz');
  assert.match(oge[3].textContent, /ıslak/);
  assert.ok(sinifli(oge[3], 'dikkat'), 'su sensörü açıkken dikkat');
  assert.match(oge[3].attributes['aria-label'], /sorun var/);
  assert.doesNotMatch(metin(ust), /yuzey\.bilgi/, 'eksik sözlük anahtarı yok');

  const satirlar = kayit.satirlar.map((s) => s.length);
  assert.deepEqual(satirlar, [4, 1], 'klavye satırları (1.7.0): şerit, kart');
  oge[0].gonder('click');
  assert.equal(modul.detayAcikMi(), true);
  assert.deepEqual(kayit.odakIstekleri, ['bi:geri']);
});

// ---- sensör karoları, mini grafik, gösterge ---------------------------------------------------------------------------

test('sensör karosu: değer, pil göstergesi (birim %), uyarı metni; aralığı olmayan sensörde gösterge yok; HA nitelikleri min/max gösterge aralığı olur', () => {
  const { modul } = ortamKur();
  const mmSensor = karo('sensor.guc', 'Güç', 'sensor', { deger: '350', sayi: 350, birim: 'W', sinif: 'power', hassasiyet: null, enAz: 0, enCok: 1000 });
  modul.ayarla(modelOlustur({ sensorler: [SICAKLIK, PIL, mmSensor] }));
  const bolum = modul.altParcalar()[0];
  assert.match(bolum.textContent, /Sensörler/);
  const karolar = bulSinif(bolum, 'sensor-karo');
  assert.equal(karolar.length, 3);
  const gosterge = (k) => k.bul((o) => o.etiket === 'svg' && sinifli(o, 'gosterge'));
  assert.equal(gosterge(karolar[0]).length, 0, '°C sensöründe aralık bilinmez: gösterge yok');
  assert.equal(gosterge(karolar[1]).length, 1, 'pil %: 0..100 gösterge');
  assert.equal(gosterge(karolar[2]).length, 1, 'min/max özniteliği: gösterge');
  assert.match(karolar[1].textContent, /! pil zayıf/);
  assert.ok(gosterge(karolar[1])[0].bul((o) => sinifli(o, 'kritik')).length > 0, 'uyarı durumunda gösterge kritik sınıfında');
  assert.equal(gosterge(karolar[2])[0].bul((o) => sinifli(o, 'kritik')).length, 0);
});

test('sensör karosu: favoride seçilen grafik biçimi gösterge / çizgi / yok; "yok"ta geçmiş de istenmez; bilinmeyen değer "otomatik" sayılır', async () => {
  const gec = { gecmis: () => ({ ok: true, veri: { 'sensor.a': [nokta(3, 20), nokta(2, 22), nokta(1, 21)] } }) };
  const dene = async (grafikTuru, ozellik = { deger: '40', sayi: 40, birim: 'W', sinif: null, hassasiyet: null, enAz: 0, enCok: 100 }) => {
    const { modul, kayit, zaman } = ortamKur({ okuma: gec });
    modul.ayarla(modelOlustur({ sensorler: [karo('sensor.a', 'A', 'sensor', ozellik, { grafikTuru })] }));
    await akit();
    zaman.ilerle(50);
    const k = bulSinif(modul.altParcalar()[0], 'sensor-karo')[0];
    return {
      gosterge: k.bul((o) => o.etiket === 'svg' && sinifli(o, 'gosterge')).length,
      cizgi: k.bul((o) => o.etiket === 'svg' && sinifli(o, 'sparkline')).length,
      gecmisIstekleri: kayit.okumalar.filter((o) => o.tur === 'gecmis').length,
    };
  };
  assert.deepEqual(await dene('otomatik'), { gosterge: 1, cizgi: 1, gecmisIstekleri: 1 });
  assert.deepEqual(await dene('gosterge'), { gosterge: 1, cizgi: 0, gecmisIstekleri: 0 }, 'yalnız gösterge: geçmiş de okunmaz');
  assert.deepEqual(await dene('cizgi'), { gosterge: 0, cizgi: 1, gecmisIstekleri: 1 });
  assert.deepEqual(await dene('yok'), { gosterge: 0, cizgi: 0, gecmisIstekleri: 0 });
  assert.deepEqual(await dene('dev'), { gosterge: 1, cizgi: 1, gecmisIstekleri: 1 }, 'bilinmeyen biçim otomatik sayılır');
  assert.deepEqual(await dene(undefined), { gosterge: 1, cizgi: 1, gecmisIstekleri: 1 }, 'eski model: otomatik');
});

test('sensör grafiği kapalıyken ne geçmiş okunur ne gösterge çizilir', async () => {
  const { modul, kayit } = ortamKur();
  modul.ayarla(modelOlustur({ ayar: { ...AYAR, sensorGrafik: false } }));
  await akit();
  assert.equal(kayit.okumalar.some((o) => o.tur === 'gecmis'), false);
  const karolar = bulSinif(modul.altParcalar()[0], 'sensor-karo');
  assert.equal(karolar.every((k) => k.bul((o) => o.etiket === 'svg').length === 0), true);
});

test('mini grafik: sayısal sensörlerin geçmişi tek istekte (en çok 7 kimlik), ayardaki saat penceresiyle istenir; boş dönem hata değildir', async () => {
  const { modul, kayit, zaman } = ortamKur({
    okuma: { gecmis: () => ({ ok: true, veri: { 'sensor.salon_sicaklik': [nokta(3, 20), nokta(2, 22), nokta(1, 21)], 'sensor.kumanda_pil': [] } }) },
  });
  modul.ayarla(modelOlustur({ ayar: { ...AYAR, sensorGrafikSaat: 24 } }));
  await akit();
  const gecmis = kayit.okumalar.filter((o) => o.tur === 'gecmis');
  assert.deepEqual(gecmis, [{ tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik', 'sensor.kumanda_pil'], saat: 24 }]);
  zaman.ilerle(50);
  assert.equal(kayit.cizimler, 1, 'yanıt gelince bir yeniden çizim istenir');
  const karolar = bulSinif(modul.altParcalar()[0], 'sensor-karo');
  const cizgi = (k) => k.bul((o) => o.etiket === 'svg' && sinifli(o, 'sparkline'));
  assert.equal(cizgi(karolar[0]).length, 1, 'veri varsa mini grafik');
  assert.equal(cizgi(karolar[1]).length, 0, 'boş dönemde çizgi yok');
  assert.doesNotMatch(karolar[1].textContent, /alınamadı|hata/i, 'boş dönem hata gibi gösterilmez');
  // ikinci çağrı yeterince tazeyken yeniden okumaz
  modul.ayarla(modelOlustur({ ayar: { ...AYAR, sensorGrafikSaat: 24 } }));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'gecmis').length, 1);
});

test('mini grafik: 7\'den çok sensör parçalara bölünür; ayardaki saat değişince önbellek yenilenir; yalnız sayısal sensörler istenir', async () => {
  const sensorler = Array.from({ length: 9 }, (_, i) => karo(`sensor.s${i}`, `S${i}`, 'sensor', { deger: '1', sayi: i, birim: 'W', sinif: null, hassasiyet: null, enAz: null, enCok: null }));
  const metinSensor = karo('sensor.durum', 'Durum', 'sensor', { deger: 'idle', sayi: null, birim: null, sinif: null, hassasiyet: null, enAz: null, enCok: null });
  const { modul, kayit } = ortamKur();
  modul.ayarla(modelOlustur({ sensorler: [...sensorler, metinSensor, HAREKET], serit: [], listeler: [], takvimler: [] }));
  await akit();
  const gecmis = kayit.okumalar.filter((o) => o.tur === 'gecmis');
  assert.deepEqual(gecmis.map((g) => g.kimlikler.length), [7, 2]);
  assert.equal(gecmis.flatMap((g) => g.kimlikler).includes('sensor.durum'), false, 'metin değerli sensör istenmez');
  assert.equal(gecmis.flatMap((g) => g.kimlikler).includes('binary_sensor.salon_hareket'), false, 'ikili sensör istenmez');
  modul.ayarla(modelOlustur({ ayar: { ...AYAR, sensorGrafikSaat: 1 }, sensorler, serit: [], listeler: [], takvimler: [] }));
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'gecmis' && o.saat === 1).length, 2, 'saat penceresi değişince yeniden okunur');
});

test('mini grafik: hata alınan geçmiş 30 sn dolmadan yeniden denenmez, sonra denenir; pencere yeniden gösterilince hemen denenir', async () => {
  let basarili = false;
  const { modul, kayit, zaman } = ortamKur({
    okuma: { gecmis: () => (basarili ? { ok: true, veri: { 'sensor.salon_sicaklik': [nokta(3, 20), nokta(1, 21)] } } : { ok: false, tur: 'kayitsiz' }) },
  });
  const model = modelOlustur({ sensorler: [SICAKLIK], serit: [], listeler: [], takvimler: [] });
  const say = () => kayit.okumalar.filter((o) => o.tur === 'gecmis').length;
  modul.ayarla(model);
  await akit();
  assert.equal(say(), 1);
  zaman.ilerle(10_000);
  modul.ayarla(model);
  await akit();
  assert.equal(say(), 1, '10 sn: hâlâ bekleme');
  zaman.ilerle(21_000);
  modul.ayarla(model);
  await akit();
  assert.equal(say(), 2, '31 sn: yeniden denendi');
  basarili = true;
  modul.gosterildi();
  await akit();
  assert.equal(say(), 3, 'pencere yeniden gösterilince başarısız okumalar hemen yenilenir');
  assert.equal(bulSinif(modul.altParcalar()[0], 'sensor-karo')[0].bul((o) => sinifli(o, 'sparkline')).length, 1);
});

test('panel kapalıyken (acikMi false) hiçbir okuma istenmez', async () => {
  const { modul, kayit } = ortamKur({ acik: false });
  modul.ayarla(modelOlustur());
  await akit();
  assert.deepEqual(kayit.okumalar, []);
});

// ---- yapılacaklar -----------------------------------------------------------------------------------------------------

const OGELER = [
  { uid: 'u1', baslik: 'Süt', tamamlandi: false },
  { uid: 'u2', baslik: 'Ekmek', tamamlandi: false },
  { uid: 'u3', baslik: 'Yumurta', tamamlandi: true },
];

async function listeHazirla(secenek = {}) {
  const ortam = ortamKur({ okuma: { yapilacak: () => ({ ok: true, veri: OGELER }) }, ...secenek });
  ortam.modul.ayarla(modelOlustur({ sensorler: [], takvimler: [] }));
  await akit();
  ortam.liste = () => ortam.modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste'));
  return ortam;
}

test('yapılacaklar: açık işler listelenir, tamamlananlar katlanır ve sayısı gösterilir; liste adı ve açık sayısı başlıkta', async () => {
  const { liste } = await listeHazirla();
  const bolum = liste();
  assert.match(bolum.textContent, /Yapılacaklar: Alışveriş/);
  assert.match(bolum.textContent, /2 açık/);
  const satirlar = bulSinif(bolum, 'liste-oge');
  assert.deepEqual(satirlar.map((s) => bulSinif(s, 'liste-baslik')[0].textContent), ['Süt', 'Ekmek']);
  assert.match(bolum.textContent, /Tamamlananlar \(1\)/);
  assert.doesNotMatch(bolum.textContent, /Yumurta/, 'tamamlananlar kapalıyken görünmez');
  bulSinif(bolum, 'liste-biten')[0].gonder('click');
});

test('yapılacaklar: tamamlananlar düğmesi listeyi açar ve yeniden çizim ister', async () => {
  const { liste, kayit, modul } = await listeHazirla();
  const dugme = bulSinif(liste(), 'liste-biten')[0];
  assert.equal(dugme.attributes['aria-expanded'], 'false');
  const once = kayit.cizimler;
  dugme.gonder('click');
  assert.equal(kayit.cizimler, once + 1);
  const yeni = bulSinif(liste(), 'liste-biten')[0];
  assert.equal(yeni.attributes['aria-expanded'], 'true');
  assert.match(liste().textContent, /Yumurta/);
  assert.equal(modul.detayAcikMi(), false);
});

test('yapılacaklar: tamamla / geri al update_item ile gider (öğe kimliği ve durum); başarıdan sonra liste önbelleksiz yeniden okunur', async () => {
  const { liste, kayit } = await listeHazirla();
  const onaylar = bulSinif(liste(), 'liste-onay');
  onaylar[0].gonder('click');
  await akit();
  assert.deepEqual(kayit.calistirmalar, [{ kimlik: 'todo.alisveris', servis: 'update_item', veri: { item: 'u1', status: 'completed' } }]);
  const okumalar = kayit.okumalar.filter((o) => o.tur === 'yapilacak');
  assert.deepEqual(okumalar.at(-1), { tur: 'yapilacak', kimlik: 'todo.alisveris', taze: true });
  assert.equal(onaylar[0].attributes['aria-pressed'], 'false');
  assert.match(onaylar[0].attributes['aria-label'], /“Süt” tamamlandı olarak işaretle/);
  // tamamlanmış öğe geri alınır
  bulSinif(liste(), 'liste-biten')[0].gonder('click');
  const geriAl = bulSinif(liste(), 'liste-onay').find((o) => o.attributes['aria-pressed'] === 'true');
  geriAl.gonder('click');
  await akit();
  assert.deepEqual(kayit.calistirmalar.at(-1), { kimlik: 'todo.alisveris', servis: 'update_item', veri: { item: 'u3', status: 'needs_action' } });
});

test('yapılacaklar: işlem başarısızsa kullanıcıya söylenir; çok sık / onay gerekli yanıtında ek ipucu yok', async () => {
  const yanit = { ok: false, tur: 'hata' };
  const { liste, kayit } = await listeHazirla({ calistir: async () => yanit });
  bulSinif(liste(), 'liste-onay')[0].gonder('click');
  await akit();
  assert.deepEqual(kayit.ipuclari, ['“Süt” güncellenemedi.']);
  yanit.tur = 'cok-sik';
  bulSinif(liste(), 'liste-onay')[0].gonder('click');
  await akit();
  assert.equal(kayit.ipuclari.length, 1, 'çok-sik yanıtını sayfa kendi ipucuyla söyler');
});

test('yapılacaklar: öğe silme YALNIZ basılı tutmayla (basili:true, remove_item); düz tıklama hiçbir şey göndermez', async () => {
  const { liste, kayit } = await listeHazirla();
  const sil = bulSinif(liste(), 'liste-sil')[0];
  assert.match(sil.attributes['aria-label'], /“Süt” sil — basılı tutun/);
  sil.gonder('click');
  sil.gonder('keyup');
  assert.deepEqual(kayit.calistirmalar, [], 'tek tıklama silmez');
  sil.gonder('pointerdown', { button: 0 });
  await akit();
  assert.deepEqual(kayit.calistirmalar, [{ kimlik: 'todo.alisveris', servis: 'remove_item', veri: { item: 'u1' }, basili: true }]);
  assert.equal(kayit.basiliKarolar[0].id, 'todo.alisveris');
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'yapilacak').at(-1), { tur: 'yapilacak', kimlik: 'todo.alisveris', taze: true }, 'silme sonrası yenilenir');
});

test('yapılacaklar: ekleme kutusu Enter ile add_item gönderir (boşluklar teke iner, 200 sınırı); boş metin ve IME yazımı gönderilmez; başarıda kutu boşalır', async () => {
  const { liste, kayit } = await listeHazirla();
  const girdi = bulSinif(liste(), 'liste-girdi')[0];
  assert.equal(girdi.maxLength, 200);
  assert.equal(girdi.attributes.autocomplete, 'off');
  girdi.value = '   ';
  girdi.gonder('keydown', { key: 'Enter' });
  girdi.value = 'süt';
  girdi.gonder('keydown', { key: 'Enter', isComposing: true });
  girdi.gonder('keydown', { key: 'Enter', keyCode: 229 });
  girdi.gonder('keydown', { key: 'a' });
  assert.deepEqual(kayit.calistirmalar, []);
  girdi.value = '  süt   al  ';
  const olay = girdi.gonder('keydown', { key: 'Enter' });
  assert.equal(olay.onlendi, true);
  await akit();
  assert.deepEqual(kayit.calistirmalar, [{ kimlik: 'todo.alisveris', servis: 'add_item', veri: { item: 'süt al' } }]);
  assert.equal(girdi.value, '', 'başarıdan sonra kutu boşalır');
  // düğmeyle de eklenir (yeniden çizimde yeni kutu ve düğme gelir)
  const yeniBolum = liste();
  bulSinif(yeniBolum, 'liste-girdi')[0].value = 'ekmek';
  bulSinif(yeniBolum, 'liste-ekle-dugme')[0].gonder('click');
  await akit();
  assert.equal(kayit.calistirmalar.at(-1).veri.item, 'ekmek');
});

test('yapılacaklar: ekleme başarısızsa "Eklenemedi." söylenir ve yazılan metin kutuda kalır', async () => {
  const { liste, kayit } = await listeHazirla({ calistir: async () => ({ ok: false, tur: 'hata' }) });
  const girdi = bulSinif(liste(), 'liste-girdi')[0];
  girdi.value = 'süt';
  girdi.gonder('input');
  girdi.gonder('keydown', { key: 'Enter' });
  await akit();
  assert.deepEqual(kayit.ipuclari, ['Eklenemedi.']);
  assert.equal(girdi.value, 'süt');
});

test('yapılacaklar: yazarken yeniden çizim ertelenir (odak / bırakma dengeli) ve yazılan taslak yeniden çizimde korunur', async () => {
  const { liste, kayit } = await listeHazirla();
  const girdi = bulSinif(liste(), 'liste-girdi')[0];
  girdi.gonder('focus');
  girdi.gonder('focus');
  assert.equal(kayit.donuk, 1, 'iki odak olayı tek erteleme sayılır');
  girdi.value = 'yarı yazılmış';
  girdi.gonder('input');
  girdi.gonder('blur');
  girdi.gonder('blur');
  assert.equal(kayit.donuk, 0);
  assert.equal(kayit.donukBaslat, kayit.donukBitir);
  const yeni = bulSinif(liste(), 'liste-girdi')[0];
  assert.notEqual(yeni, girdi, 'yeniden çizimde yeni öğe');
  assert.equal(yeni.value, 'yarı yazılmış');
});

test('yapılacaklar: liste alınamazsa "alınamadı" yazar (boş liste değil); kullanılamayan liste okunmaz; okuma beklerken "yükleniyor"', async () => {
  const hata = ortamKur({ okuma: { yapilacak: () => ({ ok: false, tur: 'kayitsiz' }) } });
  hata.modul.ayarla(modelOlustur({ sensorler: [], takvimler: [] }));
  assert.match(hata.modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste')).textContent, /Yükleniyor/);
  await akit();
  const bolum = hata.modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste'));
  assert.match(bolum.textContent, /Liste alınamadı/);
  assert.doesNotMatch(bolum.textContent, /Açık iş yok/);

  const bos = ortamKur({ okuma: { yapilacak: () => ({ ok: true, veri: [] }) } });
  bos.modul.ayarla(modelOlustur({ sensorler: [], takvimler: [] }));
  await akit();
  assert.match(bos.modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste')).textContent, /Açık iş yok/);

  const kullanilmaz = ortamKur();
  kullanilmaz.modul.ayarla(modelOlustur({ sensorler: [], takvimler: [], listeler: [{ id: 'todo.alisveris', etiket: 'Alışveriş', kullanilabilir: false, acikSayisi: null }] }));
  await akit();
  assert.equal(kullanilmaz.kayit.okumalar.some((o) => o.tur === 'yapilacak'), false);
  assert.match(kullanilmaz.modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste')).textContent, /Liste alınamadı/);
});

test('yapılacaklar: okuma reddedilirse (ağ hatası) çökmez, "alınamadı" yazar', async () => {
  const { modul } = ortamKur({ okuma: { yapilacak: () => Promise.reject(new Error('ağ')) } });
  modul.ayarla(modelOlustur({ sensorler: [], takvimler: [] }));
  await akit();
  assert.match(modul.altParcalar().find((p) => sinifli(p, 'bilgi-liste')).textContent, /Liste alınamadı/);
});

test('yapılacaklar: palet hızlı eklemesinden sonra liste eskitilir ve sonraki okuma önbelleksizdir', async () => {
  const { modul, kayit } = await listeHazirla();
  modul.listeyiEskit('todo.alisveris');
  modul.ayarla(modelOlustur({ sensorler: [], takvimler: [] }));
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'yapilacak').at(-1), { tur: 'yapilacak', kimlik: 'todo.alisveris', taze: true });
});

// ---- takvim -----------------------------------------------------------------------------------------------------------

const yerel = (gun, saat, dakika = 0) => new Date(2026, 9, gun, saat, dakika).toISOString();

async function takvimHazirla(etkinlikler, yanit) {
  const ortam = ortamKur({ okuma: { takvim: yanit ?? (() => ({ ok: true, veri: etkinlikler })) } });
  ortam.modul.ayarla(modelOlustur({ sensorler: [], listeler: [] }));
  await akit();
  ortam.bolum = () => ortam.modul.altParcalar().find((p) => sinifli(p, 'bilgi-takvim'));
  return ortam;
}

test('takvim: etkinlikler gün gün gruplanır (Bugün / Yarın / tarih), tüm gün önce, sonra başlangıca göre; şu an süren etkinlik işaretlenir', async () => {
  const { bolum, kayit } = await takvimHazirla([
    { baslik: 'Toplantı', baslangic: yerel(16, 9), bitis: yerel(16, 10), tumGun: false },
    { baslik: 'Öğle yemeği', baslangic: yerel(16, 11, 30), bitis: yerel(16, 12, 30), tumGun: false },
    { baslik: 'Doğum günü', baslangic: '2026-10-16', bitis: '2026-10-17', tumGun: true },
    { baslik: 'Diş randevusu', baslangic: yerel(17, 15), bitis: yerel(17, 16), tumGun: false },
    { baslik: 'Konser', baslangic: yerel(19, 20), bitis: yerel(19, 22), tumGun: false },
  ]);
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'takvim'), [{ tur: 'takvim', kimlik: 'calendar.ev', gun: 3 }]);
  const b = bolum();
  assert.match(b.textContent, /Yaklaşan etkinlikler/);
  assert.deepEqual(bulSinif(b, 'takvim-gun').map((g) => g.textContent), ['Bugün', 'Yarın', Bicim.gunMetni(yerel(19, 20), { dil: 'tr' })]);
  const basliklar = bulSinif(b, 'takvim-baslik').map((o) => o.textContent);
  assert.deepEqual(basliklar, ['Doğum günü', 'Toplantı', 'Öğle yemeği', 'Diş randevusu', 'Konser']);
  const saatler = bulSinif(b, 'takvim-saat').map((o) => o.textContent);
  assert.equal(saatler[0], 'Tüm gün');
  assert.equal(saatler[1], Bicim.etkinlikSaati({ baslangic: yerel(16, 9), bitis: yerel(16, 10) }, { saatBicimi: '24' }));
  const simdi = bulSinif(b, 'takvim-simdi');
  assert.equal(simdi.length, 2, 'tüm gün etkinliği ve öğle yemeği şu an sürüyor');
  assert.match(simdi[0].textContent, /şu an/);
});

test('takvim: boş dönem "etkinlik yok", okuma hatası "alınamadı" der (ikisi ayrı); 8\'den çok etkinlik kısaltılır', async () => {
  const bos = await takvimHazirla([]);
  assert.match(bos.bolum().textContent, /Yaklaşan etkinlik yok/);
  assert.doesNotMatch(bos.bolum().textContent, /alınamadı/);
  const hata = await takvimHazirla(null, () => ({ ok: false, tur: 'kayitsiz' }));
  assert.match(hata.bolum().textContent, /Takvim alınamadı/);
  assert.doesNotMatch(hata.bolum().textContent, /Yaklaşan etkinlik yok/);
  const red = await takvimHazirla(null, () => Promise.reject(new Error('ağ')));
  assert.match(red.bolum().textContent, /Takvim alınamadı/);
  const cok = await takvimHazirla(Array.from({ length: 11 }, (_, i) => ({ baslik: `E${i}`, baslangic: yerel(17, 8 + (i % 10)), bitis: yerel(17, 9 + (i % 10)), tumGun: false })));
  assert.equal(bulSinif(cok.bolum(), 'takvim-baslik').length, 8);
  assert.match(cok.bolum().textContent, /\+3 etkinlik daha/);
});

test('takvim: başlıklar yalnız textContent ile yazılır (zararlı metin etiket olmaz); bozuk etkinlikler atılır', async () => {
  const { bolum } = await takvimHazirla([
    { baslik: '<img src=x onerror=alert(1)>', baslangic: yerel(17, 9), bitis: null, tumGun: false },
    { baslik: 5, baslangic: yerel(17, 9) },
    null,
    { baslik: 'Eksik', baslangic: 7 },
  ]);
  const b = bolum();
  assert.deepEqual(bulSinif(b, 'takvim-baslik').map((o) => o.textContent), ['<img src=x onerror=alert(1)>']);
  assert.equal(b.bul((o) => o.etiket === 'img').length, 0);
});

// ---- geçmiş ve karşılaştırma ------------------------------------------------------------------------------------------

const gecmisYaniti = (veri) => () => ({ ok: true, veri });
const SERI_SICAKLIK = [nokta(3, 20), nokta(2, 22), nokta(1, 21)];
const SERI_PIL = [nokta(3, 50), nokta(1, 48)];

async function detayAc(okuma, model = modelOlustur(), secenek = {}) {
  const ortam = ortamKur({ okuma: { gecmis: okuma, takvim: () => ({ ok: true, veri: [] }), yapilacak: () => ({ ok: true, veri: [] }) }, ...secenek });
  ortam.modul.ayarla(model);
  await akit();
  ortam.okumalar24 = () => ortam.kayit.okumalar.filter((o) => o.tur === 'gecmis' && o.saat !== model.ayar.sensorGrafikSaat);
  const oge = bulSinif(ortam.modul.ustParcalar(), 'serit-oge')[0];
  oge.gonder('click');
  await akit();
  ortam.detay = () => ortam.modul.detayParcalari();
  return ortam;
}

test('geçmiş görünümü: sensöre tıklayınca 24 saatlik geçmiş istenir; en az / en çok / ortalama ve zaman eksenli grafik gösterilir', async () => {
  const { detay, kayit } = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': SERI_SICAKLIK, 'sensor.kumanda_pil': SERI_PIL }));
  const istek = kayit.okumalar.filter((o) => o.tur === 'gecmis').at(-1);
  assert.deepEqual(istek, { tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik'], saat: 24 });
  const parcalar = detay();
  assert.equal(parcalar.length, 1);
  const kok = parcalar[0];
  assert.match(kok.textContent, /Salon sıcaklık/);
  assert.match(kok.textContent, /Şimdi: 21,4 °C/);
  assert.match(kok.textContent, /En az20 °C/);
  assert.match(kok.textContent, /En çok22 °C/);
  assert.match(kok.textContent, /Ortalama21,3 °C/);
  const svg = kok.bul((o) => o.etiket === 'svg' && sinifli(o, 'grafik'));
  assert.equal(svg.length, 1);
  assert.match(svg[0].attributes['aria-label'], /Geçmiş grafiği: Salon sıcaklık, son 24 saat/);
  assert.equal(svg[0].bul((o) => o.etiket === 'path' && sinifli(o, 'cizgi')).length, 1);
  assert.ok(svg[0].bul((o) => o.etiket === 'text' && sinifli(o, 'eksen-x')).length >= 2, 'zaman ekseni yazıları');
  assert.equal(svg[0].bul((o) => o.etiket === 'text' && sinifli(o, 'eksen-y')).length > 0, true);
  // aralık düğmeleri 1 / 6 / 24 / 7 gün; 24 seçili
  const dugmeler = bulSinif(kok, 'aralik-dugme');
  assert.deepEqual(dugmeler.map((d) => d.textContent), ['1 sa', '6 sa', '24 sa', '7 gün']);
  assert.deepEqual(dugmeler.map((d) => d.attributes['aria-pressed']), ['false', 'false', 'true', 'false']);
});

test('geçmiş görünümü: aralık düğmesi yeni aralığı ister; geç gelen eski yanıt yenisinin üstüne yazılmaz', async () => {
  const bekleyen = [];
  const { detay, kayit, modul } = await detayAc((istek) => {
    if (istek.kimlikler.length === 1 && istek.saat === 24) return new Promise((coz) => bekleyen.push(() => coz({ ok: true, veri: { 'sensor.salon_sicaklik': SERI_SICAKLIK } })));
    return { ok: true, veri: { 'sensor.salon_sicaklik': [nokta(0.5, 30), nokta(0.2, 31)] } };
  });
  assert.match(metin(detay()), /Geçmiş yükleniyor/);
  const bir = bulSinif(detay(), 'aralik-dugme')[0];
  bir.gonder('click');
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'gecmis').at(-1), { tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik'], saat: 1 });
  assert.match(metin(detay()), /En az30 °C/);
  bekleyen.forEach((coz) => coz()); // 24 saatlik eski yanıt şimdi geliyor
  await akit();
  assert.match(metin(detay()), /En az30 °C/, 'eski aralığın verisi yazılmadı');
  assert.equal(modul.detayAcikMi(), true);
});

test('geçmiş görünümü: boş dönem, okuma hatası ve sayısal olmayan değer üç ayrı mesajdır', async () => {
  const bos = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': [] }));
  assert.match(metin(bos.detay()), /Bu dönemde kayıt yok/);
  assert.doesNotMatch(metin(bos.detay()), /alınamadı/);
  const hata = await detayAc(() => ({ ok: false, tur: 'gecersiz' }));
  assert.match(metin(hata.detay()), /Geçmiş alınamadı/);
  const red = await detayAc(() => Promise.reject(new Error('ağ')));
  assert.match(metin(red.detay()), /Geçmiş alınamadı/);
  const anahtarYok = await detayAc(gecmisYaniti({}));
  assert.match(metin(anahtarYok.detay()), /Geçmiş alınamadı/, 'anahtarı olmayan varlık hata sayılır');
  const metinsel = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': [{ t: BASLANGIC - SAAT, d: 'on' }, { t: BASLANGIC - 2 * SAAT, d: 'off' }] }));
  assert.match(metin(metinsel.detay()), /sayısal değer vermiyor/);
});

test('karşılaştırma: aday sensör eklenince ortak zaman eksenli iki çizgi çizilir; her serinin lejandı ve istatistiği yazılır; birimler farklıysa uyarı', async () => {
  const { detay, kayit } = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': SERI_SICAKLIK, 'sensor.kumanda_pil': SERI_PIL }));
  const adaylar = bulSinif(detay(), 'karsilastir-aday');
  assert.deepEqual(adaylar.map((a) => a.textContent), ['Kumanda pil'], 'yalnız sayısal sensörler, kendisi hariç');
  adaylar[0].gonder('click');
  await akit();
  assert.deepEqual(kayit.okumalar.filter((o) => o.tur === 'gecmis').at(-1), { tur: 'gecmis', kimlikler: ['sensor.salon_sicaklik', 'sensor.kumanda_pil'], saat: 24 });
  const kok = detay()[0];
  const svg = kok.bul((o) => o.etiket === 'svg' && sinifli(o, 'grafik'))[0];
  assert.equal(svg.bul((o) => o.etiket === 'path' && sinifli(o, 'cizgi')).length, 2);
  assert.ok(sinifli(svg, 'grafik-bagimsiz'), '°C ve % ayrı birim: bağımsız ölçek');
  assert.match(kok.textContent, /Birimler farklı/);
  const seriler = bulSinif(kok, 'seri-satir');
  assert.equal(seriler.length, 2);
  assert.match(seriler[0].textContent, /Salon sıcaklık.*En az 20 °C.*En çok 22 °C/);
  assert.match(seriler[1].textContent, /Kumanda pil.*En az 48 %/);
  assert.equal(bulSinif(seriler[1], 'seri-isaret')[0].attributes['aria-hidden'], 'true');
  assert.deepEqual(bulSinif(kok, 'karsilastir-aday').map((a) => a.attributes['aria-pressed']), ['true']);
  // aynı birimde ortak eksen
});

test('karşılaştırma: aynı birimli seriler ortak Y ekseni kullanır; verisi olmayan seri lejantta "veri yok" der', async () => {
  const ikinci = karo('sensor.mutfak_sicaklik', 'Mutfak sıcaklık', 'sensor', { deger: '19', sayi: 19, birim: '°C', sinif: 'temperature', hassasiyet: null, enAz: null, enCok: null });
  const ucuncu = karo('sensor.balkon_sicaklik', 'Balkon sıcaklık', 'sensor', { deger: '12', sayi: 12, birim: '°C', sinif: 'temperature', hassasiyet: null, enAz: null, enCok: null });
  const model = modelOlustur({ serit: [SICAKLIK, ikinci, ucuncu], sensorler: [], listeler: [], takvimler: [] });
  const { detay } = await detayAc(
    (istek) => ({ ok: true, veri: Object.fromEntries(istek.kimlikler.map((k) => [k, k === 'sensor.balkon_sicaklik' ? [] : k === 'sensor.mutfak_sicaklik' ? [nokta(3, 18), nokta(1, 19)] : SERI_SICAKLIK])) }),
    model,
  );
  const adaylar = bulSinif(detay(), 'karsilastir-aday');
  adaylar.forEach((a) => a.gonder('click'));
  await akit();
  const kok = detay()[0];
  const svg = kok.bul((o) => o.etiket === 'svg' && sinifli(o, 'grafik'))[0];
  assert.ok(sinifli(svg, 'grafik-ortak'));
  assert.doesNotMatch(kok.textContent, /Birimler farklı/);
  assert.equal(svg.bul((o) => o.etiket === 'path' && sinifli(o, 'cizgi')).length, 2, 'verisi olmayan seri çizgi üretmez');
  const seriler = bulSinif(kok, 'seri-satir');
  assert.equal(seriler.length, 3);
  assert.match(seriler[2].textContent, /Balkon sıcaklık.*veri yok/);
});

test('karşılaştırma: en çok 7 seri (ana + 6); 7. aday reddedilir ve bilgi verilir; istek 7 kimliği aşmaz', async () => {
  const sensorler = Array.from({ length: 9 }, (_, i) => karo(`sensor.s${i}`, `S${i}`, 'sensor', { deger: '1', sayi: i, birim: '°C', sinif: null, hassasiyet: null, enAz: null, enCok: null }));
  const model = modelOlustur({ serit: sensorler.slice(0, 6), sensorler, listeler: [], takvimler: [] });
  const { detay, kayit } = await detayAc((istek) => ({ ok: true, veri: Object.fromEntries(istek.kimlikler.map((k) => [k, SERI_SICAKLIK])) }), model);
  const adaylar = () => bulSinif(detay(), 'karsilastir-aday');
  assert.equal(adaylar().length, 8);
  for (let i = 0; i < 6; i += 1) {
    adaylar()[i].gonder('click');
    await akit();
  }
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'gecmis').at(-1).kimlikler.length, 7);
  const once = kayit.okumalar.length;
  adaylar()[6].gonder('click');
  await akit();
  assert.deepEqual(kayit.ipuclari, ['En çok 7 sensör karşılaştırılabilir.']);
  assert.equal(kayit.okumalar.length, once, 'reddedilen seçim yeni istek göndermez');
  for (const o of kayit.okumalar.filter((x) => x.tur === 'gecmis')) assert.ok(o.kimlikler.length <= 7);
  // seçilmiş bir aday tekrar tıklanınca çıkar
  adaylar()[0].gonder('click');
  await akit();
  assert.equal(kayit.okumalar.filter((o) => o.tur === 'gecmis').at(-1).kimlikler.length, 6);
});

test('geçmiş görünümü: imleç grafikte zamana en yakın değerleri okur; fare çıkınca temizlenir', async () => {
  const { detay } = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': SERI_SICAKLIK }));
  const kok = detay()[0];
  const svg = kok.bul((o) => o.etiket === 'svg' && sinifli(o, 'grafik'))[0];
  svg.getBoundingClientRect = () => ({ left: 0, width: 320 });
  svg.gonder('pointermove', { clientX: 316 });
  const okuma = bulSinif(kok, 'detay-imlec')[0];
  assert.match(okuma.textContent, /Salon sıcaklık: 21 °C/);
  const cizgi = svg.bul((o) => sinifli(o, 'imlec'))[0];
  assert.equal(cizgi.attributes.visibility, 'visible');
  svg.gonder('pointerleave');
  assert.equal(cizgi.attributes.visibility, 'hidden');
});

test('geçmiş görünümü: Geri / geriGit kapatır; gosterildi geçici durumu sıfırlar; odak, görünümü açan öğeye döner', async () => {
  const { modul, kayit, detay } = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': SERI_SICAKLIK }));
  assert.equal(modul.detayAcikMi(), true);
  bulSinif(detay(), 'detay-geri')[0].gonder('click');
  assert.equal(modul.detayAcikMi(), false);
  assert.equal(kayit.odakIstekleri.at(-1), 'bi:serit:sensor.salon_sicaklik');
  assert.equal(modul.geriGit(), false, 'açık görünüm yokken Esc paneli kapatmaya bırakılır');
  const oge = bulSinif(modul.ustParcalar(), 'serit-oge')[0];
  oge.gonder('click');
  assert.equal(modul.geriGit(), true);
  oge.gonder('click');
  modul.gosterildi();
  assert.equal(modul.detayAcikMi(), false);
});

test('geçmiş görünümü: görünümü açan sensör modelden çıkarsa görünüm kendiliğinden kapanır', async () => {
  const { modul } = await detayAc(gecmisYaniti({ 'sensor.salon_sicaklik': SERI_SICAKLIK }));
  modul.ayarla(modelOlustur({ serit: [HAREKET], sensorler: [], kartlar: [] }));
  assert.deepEqual(modul.detayParcalari(), []);
  assert.equal(modul.detayAcikMi(), false);
});

// ---- güvenlik ve CSP --------------------------------------------------------------------------------------------------

test('yuzey-bilgi.js: innerHTML / satır içi stil / eval / ağ / depolama yok; yalnız todo eylemleri (add_item, update_item, remove_item) çağrılır', () => {
  const kod = KAYNAK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const yasak of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /\.style\b/, /setAttribute\(\s*['"]style/, /\.on[a-z]+\s*=[^=]/, /setAttribute\(\s*['"]on/,/\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /localStorage|sessionStorage|indexedDB/, /\brequire\(/, /\bimport\(/, /href/i, /xlink/i]) {
    assert.doesNotMatch(kod, yasak, String(yasak));
  }
  const servisler = [...kod.matchAll(/servis:\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(servisler)], ['add_item', 'remove_item', 'update_item']);
  // sözlük anahtarları sabit dizelerdir ve hepsi iki dilde tanımlıdır
  const anahtarlar = new Set([...kod.matchAll(/'(yuzey\.bilgi\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
  assert.ok(anahtarlar.size > 80);
  for (const a of anahtarlar) {
    assert.ok(Object.hasOwn(Sozluk.tr, a) && Object.hasOwn(Sozluk.en, a), `${a}: sözlükte yok`);
  }
});

test('Kapı Kuralı: kapı / kilit / alarm / kapak / kamera alanlı karolar şeritte, kartta ve sensör bölümünde hiç çizilmez; hızlı ekleme yalnız ayardaki listeye gider', () => {
  const { modul } = ortamKur();
  const yasak = ['lock.on_kapi', 'cover.garaj_kapisi', 'camera.giris', 'alarm_control_panel.ev', 'siren.ev'].map((id) => karo(id, id, id.split('.')[0], { deger: 'x', sayi: 1, birim: null, sinif: null }));
  modul.ayarla(modelOlustur({
    kartlar: [{ yuva: 1, tur: 'varlik', karo: yasak[0], secilmedi: false }, { yuva: 2, tur: 'varlik', karo: yasak[1], secilmedi: false }],
    serit: yasak,
    sensorler: yasak,
    listeler: [], takvimler: [],
    hizliListe: 'lock.on_kapi',
  }));
  const hepsi = [...modul.ustParcalar(), ...modul.altParcalar()];
  assert.equal(hepsi.length, 0, 'çizilecek hiçbir parça kalmaz');
  assert.equal(modul.hizliEkleSatiri('liste süt'), null);
});
