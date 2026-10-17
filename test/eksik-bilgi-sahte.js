'use strict';

/**
 * src/yuzey-bilgi.js için ortak sahte ortam (eksik grubu testleri): sahte DOM, sahte zaman ve betiklenmiş ctx. Gerçek pencere,
 * Electron, ağ ya da Home Assistant YOK. Bu dosyada test yoktur (node --test onu da çalıştırır; boş geçer).
 */

const Bilgi = require('../src/yuzey-bilgi');
const Grafik = require('../src/lib/grafik');
const Bicim = require('../src/lib/bilgi-bicim');
const Dil = require('../src/lib/dil');
const Sozluk = require('../src/lib/ceviri/yuzey');

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

const karo = (id, etiket, alan, ozellik, ek = {}) => ({ id, etiket, alan, kullanilabilir: true, ulasilamiyor: false, ozellik, ...ek });
const HAVA = karo('weather.ev', 'Ev', 'weather', { durum: 'partlycloudy', sicaklik: 24.5, birim: '°C', nem: 40, ruzgar: 12, ruzgarBirim: 'km/h', basinc: 1012 });
const AYAR = { saatBicimi: '24', tarihBicimi: 'kisa', takvimGunSayisi: 3, sensorGrafik: true, sensorGrafikSaat: 6, pilEsigi: 20 };

const modelOlustur = (ek = {}) => ({
  ayar: { ...AYAR },
  kartlar: [{ yuva: 1, tur: 'saat', karo: null, secilmedi: false }, { yuva: 2, tur: 'hava', karo: HAVA, secilmedi: false }],
  serit: [],
  sensorler: [],
  takvimler: [],
  listeler: [],
  hizliListe: '',
  ...ek,
});

const BASLANGIC = new Date(2026, 9, 16, 12, 0, 0).getTime(); // yerel öğle: gün farkları saat diliminden bağımsız
const SAAT = 3_600_000;

/**
 * Betiklenmiş ortam. okuma: tur -> (istek) => yanıt | söz (varsayılan: boş ama başarılı). ek: ctx'e eklenen/ezilen alanlar (ör. medyaKarti).
 */
function ortamKur({ okuma = {}, calistir = async () => ({ ok: true }), acik = true, baslangic = BASLANGIC, dil = 'tr', ek = {} } = {}) {
  const zaman = sahteZaman(baslangic);
  const kayit = { okumalar: [], calistirmalar: [], cizimler: 0, ipuclari: [], satirlar: [], odak: new Map(), odakIstekleri: [] };
  const t = Dil.cevirmen(dil, Sozluk);
  const ctx = {
    doc: belge,
    t,
    dil: () => dil,
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
    basiliTutma: () => ({ basla: () => {}, birak: () => {} }),
    donukBaslat: () => {},
    donukBitir: () => {},
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
    ...ek,
  };
  const modul = Bilgi.olustur(ctx);
  return { modul, ctx, zaman, kayit, t };
}

module.exports = { Oge, belge, sahteZaman, akit, karo, HAVA, AYAR, modelOlustur, ortamKur, siniflar, sinifli, bulSinif, metin, BASLANGIC, SAAT };
