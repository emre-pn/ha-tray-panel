'use strict';

/**
 * Palet araması (saf; Electron'a bağlı değildir) — detay-19.
 *
 * Türkçe harf katlama: Işık, IŞIK, işık, isik hepsi "isik" olur. Katlama KOD NOKTASI başına TEK karakter üretir
 * (vekil çiftleri ve birleştirici işaretler konumu kaydırmasın): vurgu konumları özgün metindeki karakter dizinleridir.
 * Eşleştirici harflerin SIRAYLA geçmesini arar ("flm" -> "Film"); boşlukla ayrılan her sözcük eşleşmelidir (VE).
 * Kısa söz dizimi: "ışık 40", "ışık %40", "ışık 40%" = yüzde 40 parlaklık (yalnız parlaklık kontrollü ışıkta, 1-100);
 * "ışık 0" = kapat. Sondaki sayı, tam adı o olan bir öğe varsa ("Salon 2") ad parçası sayılır.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/arama.js">) çalışır: `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvArama = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // NFKD'nin çözmediği yaygın Latin harfleri (ASCII karşılığı; çok harfliyse ilk harfi).
  const LATIN = { ı: 'i', ß: 's', æ: 'a', œ: 'o', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 't' };
  // Tire benzeri işaretler (eksi işareti U+2212, kısa/uzun tire, U+2010-2012) tek tireye iner: "Ses −" etiketi "ses -" yazınca bulunur (h-21).
  const TIRELER = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212].map((kod) => String.fromCodePoint(kod));
  // Tek başına duran işaretin söz karşılığı: "ses arti" -> "Ses +", "ses eksi" -> "Ses −"; İngilizce arayüz için "volume plus" / "volume minus".
  // Arama dilden bağımsızdır: iki dilin sözcükleri de her zaman geçerlidir (arayüz dili değişse de favori etiketleri yazıldığı dilde kalır).
  const ISARET_SOZLERI = new Map([
    ['arti', '+'],
    ['eksi', '-'],
    ['plus', '+'],
    ['minus', '-'],
  ]);
  const ALAKA_ORANI = 0.25; // en iyi puanın bu oranının altındaki sonuçlar alakasızdır (k-07)
  const PARLAKLIK_YAKINLIGI = 0.8; // parlaklıklı aday en az en iyi puanın bu oranı kadar iyi olmalı (h-02)
  const SON_SAYISI = 5; // boş aramada "son kullanılanlar" bölümünün uzunluğu

  /** Tek bir karakteri katlar; her zaman TEK karakter döner (boş sonuçta özgün karakter kalır). */
  function katlaKarakter(karakter) {
    let s = String(karakter).toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const ilk = Array.from(s)[0];
    if (ilk === undefined) return karakter;
    s = Object.prototype.hasOwnProperty.call(LATIN, ilk) ? LATIN[ilk] : ilk;
    return TIRELER.includes(s) ? '-' : s;
  }

  /** Metni kod noktası başına bir katlanmış karakter dizisine çevirir. */
  function katlaDizi(metin) {
    return Array.from(String(metin ?? '')).map(katlaKarakter);
  }

  const bosluk = (k) => /\s/.test(k);
  const sozcukBasi = (dizi, i) => i === 0 || bosluk(dizi[i - 1]) || /[-_./:]/.test(dizi[i - 1]);

  /** Katlanmış dizide `parca`nın (dizi) ardışık geçtiği en iyi yeri bulur (sözcük başı tercih, sonra en erken). */
  function ardisikBul(hedef, parca) {
    let en = -1;
    let enPuan = -1;
    for (let i = 0; i + parca.length <= hedef.length; i += 1) {
      let tamam = true;
      for (let j = 0; j < parca.length; j += 1) {
        if (hedef[i + j] !== parca[j]) {
          tamam = false;
          break;
        }
      }
      if (!tamam) continue;
      const puan = (i === 0 ? 40 : 0) + (sozcukBasi(hedef, i) ? 30 : 0);
      if (puan > enPuan) {
        en = i;
        enPuan = puan;
      }
    }
    return en < 0 ? null : { bas: en, puan: enPuan };
  }

  /** Harflerin sırayla geçtiği (ardışık olmak zorunda değil) en soldaki konumlar; yoksa null. */
  function altDiziEsles(sorguDizi, hedefDizi) {
    const konumlar = [];
    let h = 0;
    for (const harf of sorguDizi) {
      while (h < hedefDizi.length && hedefDizi[h] !== harf) h += 1;
      if (h >= hedefDizi.length) return null;
      konumlar.push(h);
      h += 1;
    }
    return konumlar;
  }

  /**
   * Sorguyu hedefle eşleştirir. Her sözcük ya ardışık ya da harf sırasıyla geçmeli (VE).
   * @param {string} sorgu
   * @param {string} hedef aranan metin (vurgu konumları bu metnin dizinleridir)
   * @returns {{puan:number, konumlar:number[]}|null}
   */
  function eslestir(sorgu, hedef) {
    const hedefDizi = katlaDizi(hedef);
    const sozcukler = String(sorgu ?? '')
      .split(/\s+/)
      .map(katlaDizi)
      .filter((d) => d.length > 0);
    if (sozcukler.length === 0) return { puan: 0, konumlar: [] };
    const konumlar = new Set();
    let puan = 0;
    for (const sozcuk of sozcukler) {
      const e = sozcukEsles(sozcuk, hedefDizi) ?? isaretSozuEsles(sozcuk, hedefDizi);
      if (!e) return null;
      puan += e.puan;
      for (const k of e.konumlar) konumlar.add(k);
    }
    return { puan, konumlar: [...konumlar].sort((a, b) => a - b) };
  }

  /** Tek sözcüğün puanı ve konumları: önce ardışık, olmazsa harf sırasıyla; yoksa null. */
  function sozcukEsles(sozcuk, hedefDizi) {
    const ardisik = ardisikBul(hedefDizi, sozcuk);
    if (ardisik) return { puan: 100 + ardisik.puan, konumlar: sozcuk.map((_h, i) => ardisik.bas + i) };
    const dagilik = altDiziEsles(sozcuk, hedefDizi);
    if (!dagilik) return null;
    return { puan: 20 - (dagilik[dagilik.length - 1] - dagilik[0] - (sozcuk.length - 1)) * 0.5, konumlar: dagilik };
  }

  /** "arti" / "eksi" sözcüğü hedefte yoksa, tek başına duran "+" / "−" işaretini arar (h-21: "ses arti" -> "Ses +"). */
  function isaretSozuEsles(sozcuk, hedefDizi) {
    const isaret = ISARET_SOZLERI.get(sozcuk.join(''));
    return isaret === undefined ? null : sozcukEsles([isaret], hedefDizi);
  }

  const karsilastir = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

  /** Eşit puanda son kullanılan öne geçer: `oge.sonSira` = "Son kullanılanlar" listesindeki dizin (0 = en yeni); yoksa sonda. */
  function sonSirasi(oge) {
    return Number.isInteger(oge?.sonSira) && oge.sonSira >= 0 ? oge.sonSira : Infinity;
  }

  /**
   * Öğeleri sorguya göre süzüp sıralar. `etiket` vurgu için; `grupEtiketi` yalnız aramada kullanılır (konumlar etikete sığar).
   * Eşit puanda önce son kullanılan (`sonSira`), sonra parlaklık kontrollü öğe, sonra kısa etiket, sonra özgün sıra.
   * En iyi puanın `alakaOrani` (varsayılan %25) altında kalan sonuçlar alakasız sayılıp atılır (k-07: "led" yazınca
   * Hoparlör çıkmaz); 0 verilirse süzme kapanır.
   * @param {string} sorgu
   * @param {{etiket:string, grupEtiketi?:string, parlaklikKontrol?:boolean, sonSira?:number}[]} ogeler
   * @param {{alakaOrani?: number}} [secenek]
   * @returns {{oge:object, puan:number, konumlar:number[]}[]}
   */
  function ara(sorgu, ogeler, { alakaOrani = ALAKA_ORANI } = {}) {
    if (String(sorgu ?? '').trim() === '') return ogeler.map((oge) => ({ oge, puan: 0, konumlar: [] })); // boş sorgu: özgün sıra
    const sonuc = [];
    ogeler.forEach((oge, sira) => {
      const etiket = String(oge.etiket ?? '');
      const saman = oge.grupEtiketi ? `${etiket} ${oge.grupEtiketi}` : etiket;
      const e = eslestir(sorgu, saman);
      if (!e) return;
      const etiketUzunlugu = Array.from(etiket).length;
      sonuc.push({ oge, sira, puan: e.puan, konumlar: e.konumlar.filter((k) => k < etiketUzunlugu) });
    });
    sonuc.sort(
      (a, b) =>
        b.puan - a.puan ||
        karsilastir(sonSirasi(a.oge), sonSirasi(b.oge)) ||
        Number(!!b.oge.parlaklikKontrol) - Number(!!a.oge.parlaklikKontrol) ||
        Array.from(String(a.oge.etiket ?? '')).length - Array.from(String(b.oge.etiket ?? '')).length ||
        a.sira - b.sira,
    );
    const enIyi = sonuc.length > 0 ? sonuc[0].puan : 0;
    const esik = enIyi > 0 ? enIyi * alakaOrani : -Infinity; // puanlar eksiye düşebilir (çok dağınık eşleşme): o durumda süzme yok
    return sonuc.filter((r) => r.puan >= esik).map(({ oge, puan, konumlar }) => ({ oge, puan, konumlar }));
  }

  // "ışık 40", "ışık %40", "ışık 40%", "ışık % 40": sondaki sayı (yüzde işareti isteğe bağlı).
  const SAYI_SONEKI = /^(.*?\S)\s+(?:%\s*(\d{1,3})|(\d{1,3})\s*%|(\d{1,3}))$/;

  /**
   * "ışık 40": sondaki tek tam sayı 1-100 ise parlaklıktır; "%40" ve "40%" de aynıdır. Sondaki 0 "kapat" demektir
   * (`kapat: true`, parlaklik null). "4x", 101, "40.5" metin kalır; yalnız sayıda da metin kalır. Sonuç, kapat yalnız
   * doğruyken `kapat` alanını taşır (eski şekil bozulmaz).
   * @returns {{metin:string, parlaklik:number|null, kapat?:true}}
   */
  function sorguCoz(sorgu) {
    const duz = String(sorgu ?? '').trim();
    const e = SAYI_SONEKI.exec(duz);
    if (e) {
      const n = Number(e[2] ?? e[3] ?? e[4]);
      if (Number.isInteger(n) && n >= 1 && n <= 100) return { metin: e[1].trim(), parlaklik: n };
      if (n === 0) return { metin: e[1].trim(), parlaklik: null, kapat: true };
    }
    return { metin: duz, parlaklik: null };
  }

  /** Etiket karşılaştırma özeti: katlanmış, boşlukları teke inmiş ("Salon  2" == "salon 2"). */
  const adOzeti = (metin) => katlaDizi(String(metin ?? '').trim().replace(/\s+/g, ' ')).join('');

  /**
   * Boş sorguda liste: önce son kullanılanlar (`sonSira`'ya göre, en çok `sonSayisi`), altında KALAN BÜTÜN öğeler özgün
   * sırayla. Her satıra `bolum` yazılır: 'son' ya da 'favori'. `sonSira`sız öğelerde hepsi 'favori' ve özgün sıradadır.
   * @param {{sonSira?:number}[]} ogeler
   * @param {{sonSayisi?: number}} [secenek]
   * @returns {{oge:object, puan:0, konumlar:[], bolum:'son'|'favori'}[]}
   */
  function bosSorguListesi(ogeler, { sonSayisi = SON_SAYISI } = {}) {
    const liste = Array.isArray(ogeler) ? ogeler : [];
    const sonlar = liste
      .map((oge, sira) => ({ oge, sira, son: sonSirasi(oge) }))
      .filter((o) => o.son !== Infinity)
      .sort((a, b) => a.son - b.son || a.sira - b.sira)
      .slice(0, sonSayisi);
    const secilen = new Set(sonlar.map((o) => o.sira));
    return [
      ...sonlar.map(({ oge }) => ({ oge, puan: 0, konumlar: [], bolum: 'son' })),
      ...liste.flatMap((oge, sira) => (secilen.has(sira) ? [] : [{ oge, puan: 0, konumlar: [], bolum: 'favori' }])),
    ];
  }

  /**
   * Palet sorgusu.
   *  - Boş sorgu: son kullanılanlar + bütün öğeler (bosSorguListesi).
   *  - "ışık 40" / "%40" / "40%": sayı seviye olur. Parlaklık kontrollü aday, YALNIZ en iyi puanın en az %80'i kadar
   *    iyiyse öne alınır (h-02: "ses 40" LED şeridi %40 yapmaz). Seviye bütün kısılabilir satırlara yazılır (`parlaklik`);
   *    kısılamayan satırlar `parlaklikDesteklenmiyor: true` taşır ve arayüz o satırda eylem çalıştırmamalıdır (h-13).
   *  - "ışık 0": aynı akış, satırlara `kapat: true` yazılır (`parlaklik` null).
   *  - Tam adı sorgunun kendisi olan öğe varsa ("Salon 2") sayı ad parçasıdır; seviye aranmaz (h-23).
   *  - Sayı tam metin olarak bir adla eşleşiyorsa ("oda 2" -> "Oda 2 Lambası") yine ad parçasıdır.
   * Üst düzey `parlaklik`, `kapat` ve `parlaklikDesteklenmiyor` İLK satırı anlatır (eski arayüz yalnız ilk satıra uygular).
   * @returns {{sonuclar: {oge:object, puan:number, konumlar:number[], parlaklik?:number|null, kapat?:boolean,
   *   parlaklikDesteklenmiyor?:boolean, bolum?:string}[], parlaklik:number|null, kapat:boolean, parlaklikDesteklenmiyor:boolean}}
   */
  function paletSorgusu(sorgu, ogeler) {
    const duz = String(sorgu ?? '').trim();
    const duzSonuc = (sonuclar) => ({ sonuclar, parlaklik: null, kapat: false, parlaklikDesteklenmiyor: false });
    if (duz === '') return duzSonuc(bosSorguListesi(ogeler));
    const { metin, parlaklik, kapat } = sorguCoz(duz);
    if (parlaklik === null && kapat !== true) return duzSonuc(ara(duz, ogeler));

    // Önce tam ad: "salon 2" adlı bir öğe varsa sayı ad parçasıdır.
    const hedef = adOzeti(duz);
    if (ogeler.some((oge) => adOzeti(oge?.etiket) === hedef)) return duzSonuc(ara(duz, ogeler));

    // Seviye: satırlara yazılır; kısılamayan satır "desteklenmiyor" olur.
    const seviyeIsle = (sonuclar) => {
      const satirlar = sonuclar.map((r) => {
        const kisilabilir = r.oge?.parlaklikKontrol === true;
        return { ...r, parlaklik: kisilabilir && kapat !== true ? parlaklik : null, kapat: kisilabilir && kapat === true, parlaklikDesteklenmiyor: !kisilabilir };
      });
      const ilk = satirlar[0];
      return {
        sonuclar: satirlar,
        parlaklik: ilk ? ilk.parlaklik : null,
        kapat: ilk ? ilk.kapat : false,
        parlaklikDesteklenmiyor: ilk ? ilk.parlaklikDesteklenmiyor : false,
      };
    };

    const adaylar = ara(metin, ogeler);
    const enIyi = adaylar.length > 0 ? adaylar[0].puan : 0;
    const esik = enIyi > 0 ? enIyi * PARLAKLIK_YAKINLIGI : enIyi;
    const yakin = adaylar.findIndex((a) => a.oge?.parlaklikKontrol === true && a.puan >= esik);
    if (yakin !== -1) {
      if (yakin > 0) {
        const [secilen] = adaylar.splice(yakin, 1);
        adaylar.unshift(secilen);
      }
      return seviyeIsle(adaylar);
    }
    // Yakın bir parlaklıklı aday yok: sayı ad parçası olarak eşleşiyorsa öyle ("oda 2"); değilse sayı sessizce atılıp
    // aç/kapat yapılmasın: satırlar "parlaklık desteklenmiyor" olarak gösterilir (h-13).
    const tamArama = ara(duz, ogeler);
    if (tamArama.length > 0) return duzSonuc(tamArama);
    return adaylar.length > 0 ? seviyeIsle(adaylar) : duzSonuc([]);
  }

  return { katlaKarakter, katlaDizi, altDiziEsles, eslestir, ara, sorguCoz, bosSorguListesi, paletSorgusu, ALAKA_ORANI, PARLAKLIK_YAKINLIGI, SON_SAYISI };
});
