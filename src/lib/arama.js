'use strict';

/**
 * Palet araması (saf; Electron'a bağlı değildir) — detay-19.
 *
 * Türkçe harf katlama: Işık, IŞIK, işık, isik hepsi "isik" olur. Katlama KOD NOKTASI başına TEK karakter üretir
 * (vekil çiftleri ve birleştirici işaretler konumu kaydırmasın): vurgu konumları özgün metindeki karakter dizinleridir.
 * Eşleştirici harflerin SIRAYLA geçmesini arar ("flm" -> "Film"); boşlukla ayrılan her sözcük eşleşmelidir (VE).
 * Kısa söz dizimi: "ışık 40", "ışık %40", "ışık 40%" = yüzde 40 parlaklık (yalnız parlaklık kontrollü ışıkta, 1-100);
 * "ışık 0" = kapat. Sondaki sayı, tam adı o olan bir öğe varsa ("Salon 2") ad parçası sayılır.
 * 1.4.0 servis komutları: "klima 24" (sıcaklık), "masa sicak" (beyaz tonu), "tv ses 30", "ev modu uyku"... öğenin alanına göre
 * (alanKomutu); aşağıdaki "servis komutları" bölümüne bakın. Komut yalnız bir öneridir, doğrulama ana süreçtedir.
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
    ['moins', '-'], // Fransızca (plus ortak)
    ['mas', '+'], // İspanyolca
    ['menos', '-'],
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

  // ---------------------------------------------------------------- servis komutları (1.4.0, o-01/o-02/o-03/o-05/o-06)
  //
  // "klima 24", "masa sicak", "tv ses 30", "ev modu uyku": sorgunun SONUNDAKİ 1-4 sözcük, eşleşen öğenin KENDİ alanının komut
  // sözlüğünde aranır; kalan baş kısım öğenin adıyla eşleşmelidir. Sözlük alana göre değişir (klimada sayı sıcaklıktır, medyada
  // "ses 30" sestir, seçicide son sözcük seçenektir). Çıkan komut yalnız bir SERVİS ÖNERİSİDİR ({servis, veri}); çalıştırmadan önce
  // ana süreçteki eylem hattı (src/lib/servis-izinleri.js) izin listesi, sınır ve adım denetimini yeniden yapar. Burada sınır
  // dışı değerler yalnız arayüzün satırı "aralık dışı" göstermesi içindir. Hiçbir sözlükte kilit/kapı/kepenk/garaj/alarm yoktur
  // (1.4.0 cihaz grubu: perde, vana ve otomasyon sözlükleri aşağıdadır; yalnız perde/jaluzi/gölgelik sınıfı perde olabilir, vana ve otomasyon
  // komutları ana süreçte ZORUNLU onaylıdır: palette Enter basılı tutulur).

  const KOMUT_KUYRUK_SINIRI = 4;
  const KOMUTLU_ALANLAR = new Set(['climate', 'light', 'media_player', 'fan', 'humidifier', 'vacuum', 'input_select', 'select', 'input_number', 'number', 'timer']);
  // Dil sözcükleri (DE/FR/ES): katlanmış (ASCII, küçük harf; ü->u, é->e, ñ->n, ß->s) ve yalnız "aç/kapat/mod/medya" düzeyinde.
  // Kapı Kuralı: "aç/kapat" ZATEN kilit/kapı/kepenk/alarm öğelerine uygulanamaz (palette öğe olarak yoktur); yine de buraya
  // "öffnen/schließen/ouvrir/fermer/abrir/cerrar/verrouiller/bloquear" gibi KAPI fiilleri hiçbir sözlüğe EKLENMEZ (test/arama-dil.test.js).
  const KAPAT_SOZLERI = new Set(['kapat', 'kapali', 'off', 'aus', 'ausschalten', 'abschalten', 'eteins', 'eteindre', 'eteint', 'apaga', 'apagar', 'apagado']);
  const AC_SOZLERI = new Set(['ac', 'acik', 'on', 'an', 'ein', 'einschalten', 'anschalten', 'allume', 'allumer', 'allumee', 'enciende', 'encender', 'prende', 'prender', 'encendido']);
  // 1.4.0 cihaz grubu (o-49, o-50, o-59): perde (cover), vana (valve), otomasyon (automation).
  ['cover', 'valve', 'automation'].forEach((alan) => KOMUTLU_ALANLAR.add(alan));
  const PERDE_AC_SOZLERI = new Set([...AC_SOZLERI, 'open', 'yukari', 'up', 'kaldir']);
  const PERDE_KAPAT_SOZLERI = new Set([...KAPAT_SOZLERI, 'close', 'asagi', 'down', 'indir']);
  const PERDE_DUR_SOZLERI = new Set(['dur', 'durdur', 'stop']);
  const VANA_AC_SOZLERI = new Set([...AC_SOZLERI, 'open']);
  const VANA_KAPAT_SOZLERI = new Set([...KAPAT_SOZLERI, 'close']);
  const OTOMASYON_CALISTIR_SOZLERI = new Set(['calistir', 'tetikle', 'run', 'trigger']);
  // supported_features bitleri (cover ve valve aynı): 1 aç, 2 kapat, 4 konum, 8 dur.
  const DESTEK_AC = 1;
  const DESTEK_KAPAT = 2;
  const DESTEK_KONUM = 4;
  const DESTEK_DUR = 8;
  // Beyaz tonları (kelvin) ve küçük renk paleti; panelin düğmeleri de bunlardan çizilir (yuzey-kartlar.js).
  const BEYAZ_TONLAR = Object.freeze({ sicak: 2700, dogal: 4000, soguk: 6500 });
  const BEYAZ_SOZLERI = new Map([
    ['sicak', 'sicak'], ['warm', 'sicak'], ['dogal', 'dogal'], ['natural', 'dogal'], ['neutral', 'dogal'], ['soguk', 'soguk'], ['cool', 'soguk'], ['cold', 'soguk'],
    ['warmweis', 'sicak'], ['warmweiss', 'sicak'], ['neutralweis', 'dogal'], ['neutralweiss', 'dogal'], ['kalt', 'soguk'], ['kaltweis', 'soguk'], ['kaltweiss', 'soguk'], // Almanca (ß->s, ss yazımı da)
    ['chaud', 'sicak'], ['chaude', 'sicak'], ['blanc chaud', 'sicak'], ['naturel', 'dogal'], ['blanc naturel', 'dogal'], ['froid', 'soguk'], ['froide', 'soguk'], ['blanc froid', 'soguk'], // Fransızca
    ['calido', 'sicak'], ['calida', 'sicak'], ['neutro', 'dogal'], ['frio', 'soguk'], ['fria', 'soguk'], // İspanyolca (natural ortak)
  ]);
  const RENK_PALETI = Object.freeze({
    kirmizi: Object.freeze([255, 0, 0]),
    turuncu: Object.freeze([255, 140, 0]),
    sari: Object.freeze([255, 215, 0]),
    yesil: Object.freeze([0, 200, 60]),
    turkuaz: Object.freeze([0, 210, 210]),
    mavi: Object.freeze([30, 90, 255]),
    mor: Object.freeze([150, 60, 255]),
    pembe: Object.freeze([255, 105, 180]),
  });
  const RENK_SOZLERI = new Map([
    ['kirmizi', 'kirmizi'], ['red', 'kirmizi'], ['turuncu', 'turuncu'], ['orange', 'turuncu'], ['sari', 'sari'], ['yellow', 'sari'],
    ['yesil', 'yesil'], ['green', 'yesil'], ['turkuaz', 'turkuaz'], ['cyan', 'turkuaz'], ['mavi', 'mavi'], ['blue', 'mavi'],
    ['mor', 'mor'], ['purple', 'mor'], ['violet', 'mor'], ['pembe', 'pembe'], ['pink', 'pembe'],
    // Almanca: ü->u, ä->a (ae/ue yazımları da kabul)
    ['rot', 'kirmizi'], ['gelb', 'sari'], ['grun', 'yesil'], ['gruen', 'yesil'], ['turkis', 'turkuaz'], ['tuerkis', 'turkuaz'], ['blau', 'mavi'], ['lila', 'mor'], ['violett', 'mor'], ['rosa', 'pembe'],
    // Fransızca
    ['rouge', 'kirmizi'], ['jaune', 'sari'], ['vert', 'yesil'], ['turquoise', 'turkuaz'], ['bleu', 'mavi'], ['mauve', 'mor'], ['violette', 'mor'], ['rose', 'pembe'],
    // İspanyolca (rosa ortak)
    ['rojo', 'kirmizi'], ['naranja', 'turuncu'], ['amarillo', 'sari'], ['verde', 'yesil'], ['turquesa', 'turkuaz'], ['azul', 'mavi'], ['morado', 'mor'], ['violeta', 'mor'], ['rosado', 'pembe'],
  ]);
  const ISIK_RENK_MODLARI = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
  // Klima modu sözcükleri -> HA hvac_mode adayları (cihazın listesindeki ilk aday seçilir).
  const IKLIM_MOD_SOZLERI = new Map([
    ['isit', ['heat']], ['isitma', ['heat']], ['heat', ['heat']],
    ['sogut', ['cool']], ['sogutma', ['cool']], ['cool', ['cool']],
    ['oto', ['auto', 'heat_cool']], ['otomatik', ['auto', 'heat_cool']], ['auto', ['auto', 'heat_cool']],
    ['fan', ['fan_only']], ['vantilator', ['fan_only']],
    ['kuru', ['dry']], ['kurutma', ['dry']], ['dry', ['dry']],
    // Almanca
    ['heizen', ['heat']], ['heizung', ['heat']], ['kuhlen', ['cool']], ['kuehlen', ['cool']], ['kuhlung', ['cool']], ['automatik', ['auto', 'heat_cool']], ['automatisch', ['auto', 'heat_cool']],
    ['luefter', ['fan_only']], ['lufter', ['fan_only']], ['trocknen', ['dry']], ['entfeuchten', ['dry']], ['trocken', ['dry']],
    // Fransızca
    ['chauffage', ['heat']], ['chauffer', ['heat']], ['refroidir', ['cool']], ['refroidissement', ['cool']], ['froid', ['cool']], ['automatique', ['auto', 'heat_cool']],
    ['ventilateur', ['fan_only']], ['ventilation', ['fan_only']], ['sec', ['dry']], ['deshumidifier', ['dry']],
    // İspanyolca
    ['calefaccion', ['heat']], ['calentar', ['heat']], ['calor', ['heat']], ['frio', ['cool']], ['enfriar', ['cool']], ['refrigerar', ['cool']], ['refrigeracion', ['cool']],
    ['automatico', ['auto', 'heat_cool']], ['ventilador', ['fan_only']], ['ventilacion', ['fan_only']], ['seco', ['dry']], ['deshumidificar', ['dry']],
  ]);
  const MEDYA_SOZLERI = new Map([
    ['sessiz', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['mute', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['sustur', ['volume_mute', { is_volume_muted: true }, 'sessiz']],
    ['sesli', ['volume_mute', { is_volume_muted: false }, 'sesli']], ['unmute', ['volume_mute', { is_volume_muted: false }, 'sesli']],
    ['oynat', ['media_play_pause', undefined, 'oynat']], ['duraklat', ['media_play_pause', undefined, 'oynat']], ['play', ['media_play_pause', undefined, 'oynat']], ['pause', ['media_play_pause', undefined, 'oynat']],
    ['sonraki', ['media_next_track', undefined, 'sonraki']], ['ileri', ['media_next_track', undefined, 'sonraki']], ['next', ['media_next_track', undefined, 'sonraki']],
    ['onceki', ['media_previous_track', undefined, 'onceki']], ['geri', ['media_previous_track', undefined, 'onceki']], ['prev', ['media_previous_track', undefined, 'onceki']], ['previous', ['media_previous_track', undefined, 'onceki']],
    // Almanca
    ['stumm', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['stummschalten', ['volume_mute', { is_volume_muted: true }, 'sessiz']],
    ['ton an', ['volume_mute', { is_volume_muted: false }, 'sesli']], ['stumm aus', ['volume_mute', { is_volume_muted: false }, 'sesli']],
    ['abspielen', ['media_play_pause', undefined, 'oynat']], ['wiedergabe', ['media_play_pause', undefined, 'oynat']], ['pausieren', ['media_play_pause', undefined, 'oynat']], ['fortsetzen', ['media_play_pause', undefined, 'oynat']],
    ['weiter', ['media_next_track', undefined, 'sonraki']], ['nachster', ['media_next_track', undefined, 'sonraki']], ['naechster', ['media_next_track', undefined, 'sonraki']],
    ['zuruck', ['media_previous_track', undefined, 'onceki']], ['zurueck', ['media_previous_track', undefined, 'onceki']], ['vorheriger', ['media_previous_track', undefined, 'onceki']],
    // Fransızca
    ['muet', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['silence', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['sourdine', ['volume_mute', { is_volume_muted: true }, 'sessiz']],
    ['activer le son', ['volume_mute', { is_volume_muted: false }, 'sesli']], ['reactiver le son', ['volume_mute', { is_volume_muted: false }, 'sesli']],
    ['lecture', ['media_play_pause', undefined, 'oynat']], ['jouer', ['media_play_pause', undefined, 'oynat']], ['mettre en pause', ['media_play_pause', undefined, 'oynat']],
    ['suivant', ['media_next_track', undefined, 'sonraki']], ['suivante', ['media_next_track', undefined, 'sonraki']], ['prochain', ['media_next_track', undefined, 'sonraki']],
    ['precedent', ['media_previous_track', undefined, 'onceki']], ['precedente', ['media_previous_track', undefined, 'onceki']],
    // İspanyolca
    ['silenciar', ['volume_mute', { is_volume_muted: true }, 'sessiz']], ['mudo', ['volume_mute', { is_volume_muted: true }, 'sessiz']],
    ['activar sonido', ['volume_mute', { is_volume_muted: false }, 'sesli']], ['quitar silencio', ['volume_mute', { is_volume_muted: false }, 'sesli']], ['desilenciar', ['volume_mute', { is_volume_muted: false }, 'sesli']],
    ['reproducir', ['media_play_pause', undefined, 'oynat']], ['pausa', ['media_play_pause', undefined, 'oynat']], ['pausar', ['media_play_pause', undefined, 'oynat']], ['reanudar', ['media_play_pause', undefined, 'oynat']],
    ['siguiente', ['media_next_track', undefined, 'sonraki']], ['proximo', ['media_next_track', undefined, 'sonraki']], ['proxima', ['media_next_track', undefined, 'sonraki']],
    ['anterior', ['media_previous_track', undefined, 'onceki']], ['atras', ['media_previous_track', undefined, 'onceki']],
  ]);
  const SUPURGE_SOZLERI = new Map([
    ['basla', ['start', 'basla']], ['baslat', ['start', 'basla']], ['start', ['start', 'basla']], ['temizle', ['start', 'basla']], ['clean', ['start', 'basla']],
    ['duraklat', ['pause', 'duraklat']], ['pause', ['pause', 'duraklat']],
    ['don', ['return_to_base', 'sarj']], ['sarj', ['return_to_base', 'sarj']], ['sarja don', ['return_to_base', 'sarj']], ['dock', ['return_to_base', 'sarj']], ['home', ['return_to_base', 'sarj']], ['return', ['return_to_base', 'sarj']],
    // Almanca
    ['starten', ['start', 'basla']], ['reinigen', ['start', 'basla']], ['saugen', ['start', 'basla']], ['pausieren', ['pause', 'duraklat']],
    ['zuruck', ['return_to_base', 'sarj']], ['zurueck', ['return_to_base', 'sarj']], ['laden', ['return_to_base', 'sarj']], ['ladestation', ['return_to_base', 'sarj']],
    // Fransızca
    ['demarrer', ['start', 'basla']], ['lancer', ['start', 'basla']], ['nettoyer', ['start', 'basla']], ['pauser', ['pause', 'duraklat']], ['mettre en pause', ['pause', 'duraklat']],
    ['retour', ['return_to_base', 'sarj']], ['recharge', ['return_to_base', 'sarj']], ['recharger', ['return_to_base', 'sarj']],
    // İspanyolca
    ['iniciar', ['start', 'basla']], ['empezar', ['start', 'basla']], ['comenzar', ['start', 'basla']], ['limpiar', ['start', 'basla']], ['pausar', ['pause', 'duraklat']], ['pausa', ['pause', 'duraklat']],
    ['volver', ['return_to_base', 'sarj']], ['regresar', ['return_to_base', 'sarj']], ['recargar', ['return_to_base', 'sarj']], ['cargar', ['return_to_base', 'sarj']], ['base', ['return_to_base', 'sarj']],
  ]);
  const ZAMANLAYICI_SOZLERI = new Map([
    ['basla', ['start', 'basla']], ['baslat', ['start', 'basla']], ['start', ['start', 'basla']], ['devam', ['start', 'basla']],
    ['duraklat', ['pause', 'duraklat']], ['pause', ['pause', 'duraklat']],
    ['iptal', ['cancel', 'iptal']], ['cancel', ['cancel', 'iptal']], ['durdur', ['cancel', 'iptal']], ['stop', ['cancel', 'iptal']],
    // Almanca
    ['starten', ['start', 'basla']], ['fortsetzen', ['start', 'basla']], ['pausieren', ['pause', 'duraklat']], ['abbrechen', ['cancel', 'iptal']], ['stoppen', ['cancel', 'iptal']], ['beenden', ['cancel', 'iptal']],
    // Fransızca
    ['demarrer', ['start', 'basla']], ['lancer', ['start', 'basla']], ['reprendre', ['start', 'basla']], ['pauser', ['pause', 'duraklat']], ['mettre en pause', ['pause', 'duraklat']], ['annuler', ['cancel', 'iptal']], ['arreter', ['cancel', 'iptal']],
    // İspanyolca
    ['iniciar', ['start', 'basla']], ['empezar', ['start', 'basla']], ['continuar', ['start', 'basla']], ['reanudar', ['start', 'basla']], ['pausar', ['pause', 'duraklat']], ['pausa', ['pause', 'duraklat']],
    ['cancelar', ['cancel', 'iptal']], ['detener', ['cancel', 'iptal']], ['parar', ['cancel', 'iptal']],
  ]);

  const katla = (metin) => katlaDizi(metin).join('');
  const sonluSayi = (d) => (typeof d === 'number' && Number.isFinite(d) ? d : null);
  const komut = (servis, veri, tur, deger, ek) => {
    const k = { servis, tur, deger };
    if (veri !== undefined) k.veri = veri;
    return ek ? { ...k, ...ek } : k;
  };

  /** "24", "24,5", "-3", "%40", "40%": sonlu sayı (ondalık ayracı . ya da ,); yoksa null. */
  function sayiOku(kuyruk) {
    const e = /^(%\s*)?(-?\d{1,6}(?:[.,]\d{1,3})?)\s*(%)?$/.exec(kuyruk);
    if (!e || (e[1] && e[3])) return null;
    const n = Number(e[2].replace(',', '.'));
    return Number.isFinite(n) ? { n, yuzde: !!(e[1] || e[3]), tam: Number.isInteger(n) } : null;
  }

  /** Cihazın listesinde katlanmış tam eşleşme; yoksa TEK ön ek (en az 2 harf) ya da TEK içerme eşleşmesi. Dönen: listedeki özgün metin. */
  function listedenBul(liste, kuyruk) {
    const kaynak = Array.isArray(liste) ? liste.filter((s) => typeof s === 'string' && s !== '') : [];
    const katli = kaynak.map(katla);
    const tam = katli.indexOf(kuyruk);
    if (tam >= 0) return kaynak[tam];
    if (Array.from(kuyruk).length < 2) return null;
    for (const uygun of [(s) => s.startsWith(kuyruk), (s) => s.includes(kuyruk)]) {
      const bulunan = katli.map((s, i) => (uygun(s) ? i : -1)).filter((i) => i >= 0);
      if (bulunan.length === 1) return kaynak[bulunan[0]];
    }
    return null;
  }

  function acKapatKomutu(k) {
    if (KAPAT_SOZLERI.has(k)) return komut('turn_off', undefined, 'kapat');
    if (AC_SOZLERI.has(k)) return komut('turn_on', undefined, 'ac');
    return null;
  }

  function isikKomutu(oz, k) {
    const modlar = Array.isArray(oz.renkModlari) ? oz.renkModlari : [];
    const sicaklikVar = modlar.includes('color_temp');
    const renkVar = modlar.some((m) => ISIK_RENK_MODLARI.includes(m));
    const kelvinKomutu = (kelvin, tur, deger) => {
      const alt = sonluSayi(oz.enAzKelvin);
      const ust = sonluSayi(oz.enCokKelvin);
      const kirpik = Math.round(Math.min(ust ?? kelvin, Math.max(alt ?? kelvin, kelvin))); // cihazın kendi aralığına kırpılır
      return komut('turn_on', { color_temp_kelvin: kirpik }, tur, deger ?? kirpik, { kelvin: kirpik });
    };
    const kelvin = /^(\d{4,5})\s*k$/.exec(k);
    if (kelvin) {
      const n = Number(kelvin[1]);
      if (n < 1000 || n > 20000) return { hata: 'sinir' };
      return sicaklikVar ? kelvinKomutu(n, 'kelvin') : { hata: 'desteklenmiyor' };
    }
    const ton = BEYAZ_SOZLERI.get(k);
    if (ton) return sicaklikVar ? kelvinKomutu(BEYAZ_TONLAR[ton], 'ton', ton) : { hata: 'desteklenmiyor' };
    const renk = RENK_SOZLERI.get(k);
    if (renk) return renkVar ? komut('turn_on', { rgb_color: [...RENK_PALETI[renk]] }, 'renk', renk) : { hata: 'desteklenmiyor' };
    return acKapatKomutu(k);
  }

  function iklimKomutu(oz, k) {
    const s = sayiOku(k);
    if (s) {
      if (s.yuzde) return null;
      const alt = sonluSayi(oz.enAz) ?? -50;
      const ust = sonluSayi(oz.enCok) ?? 100;
      if (s.n < alt || s.n > ust) return { hata: 'sinir', alt, ust };
      return komut('set_temperature', { temperature: s.n }, 'sicaklik', s.n);
    }
    const ack = acKapatKomutu(k);
    if (ack) return ack;
    const adaylar = IKLIM_MOD_SOZLERI.get(k);
    if (!adaylar) return null;
    const modlar = Array.isArray(oz.modlar) ? oz.modlar : [];
    const mod = adaylar.find((m) => modlar.includes(m));
    return mod ? komut('set_hvac_mode', { hvac_mode: mod }, 'mod', mod) : { hata: 'desteklenmiyor' };
  }

  function medyaKomutu(oz, k) {
    const ses = /^(?:ses|sesi|volume|vol|lautstarke|lautstaerke|volumen|sonido)\s+(?:%\s*)?(\d{1,3})\s*%?$/.exec(k);
    if (ses) {
      const n = Number(ses[1]);
      return n > 100 ? { hata: 'sinir', alt: 0, ust: 100 } : komut('volume_set', { volume_level: Number((n / 100).toFixed(2)) }, 'ses', n);
    }
    const sabit = MEDYA_SOZLERI.get(k);
    if (sabit) return komut(sabit[0], sabit[1], sabit[2]);
    const ack = acKapatKomutu(k);
    if (ack) return ack;
    const kaynakSozu = /^(?:kaynak|source|giris|input|quelle|eingang|entree|fuente|entrada)\s+(.+)$/.exec(k);
    const kaynak = listedenBul(oz.kaynaklar, kaynakSozu ? kaynakSozu[1] : k);
    if (kaynakSozu) return kaynak ? komut('select_source', { source: kaynak }, 'kaynak', kaynak) : { hata: 'desteklenmiyor' };
    // Çıplak kaynak adı yalnız TAM eşleşmede komuttur ("tv hdmi 2"); ön ek/içerme eşleşmesi adın parçası olabilir.
    const tamKaynak = Array.isArray(oz.kaynaklar) ? oz.kaynaklar.find((s) => typeof s === 'string' && katla(s) === k) : undefined;
    return tamKaynak ? komut('select_source', { source: tamKaynak }, 'kaynak', tamKaynak) : null;
  }

  function fanKomutu(oz, k) {
    const s = sayiOku(k);
    if (s) {
      if (!s.tam) return null;
      return s.n < 0 || s.n > 100 ? { hata: 'sinir', alt: 0, ust: 100 } : komut('set_percentage', { percentage: s.n }, 'yuzde', s.n);
    }
    const ack = acKapatKomutu(k);
    if (ack) return ack;
    const onAyar = Array.isArray(oz.onAyarlar) ? oz.onAyarlar.find((a) => typeof a === 'string' && katla(a) === k) : undefined;
    return onAyar ? komut('set_preset_mode', { preset_mode: onAyar }, 'onAyar', onAyar) : null;
  }

  function nemKomutu(oz, k) {
    const s = sayiOku(k);
    if (s) {
      if (!s.tam) return null;
      const alt = sonluSayi(oz.enAz) ?? 0;
      const ust = sonluSayi(oz.enCok) ?? 100;
      return s.n < alt || s.n > ust ? { hata: 'sinir', alt, ust } : komut('set_humidity', { humidity: s.n }, 'nem', s.n);
    }
    return acKapatKomutu(k);
  }

  function sozlukKomutu(sozluk, k) {
    const e = sozluk.get(k);
    return e ? komut(e[0], undefined, e[1]) : null;
  }

  function secimKomutu(oz, k) {
    const secenek = listedenBul(oz.secenekler, k);
    return secenek ? komut('select_option', { option: secenek }, 'secenek', secenek) : null;
  }

  function sayiKomutu(oz, k) {
    const s = sayiOku(k);
    if (!s || s.yuzde) return null;
    const alt = sonluSayi(oz.enAz);
    const ust = sonluSayi(oz.enCok);
    if (alt === null || ust === null) return { hata: 'desteklenmiyor' }; // sınırı bilinmeyen sayı ayarlanmaz
    return s.n < alt || s.n > ust ? { hata: 'sinir', alt, ust } : komut('set_value', { value: s.n }, 'sayi', s.n);
  }

  /** `destek` bilinmiyorsa (null) komut denenir (HA reddederse hata görünür); biliniyorsa bit yoksa "desteklenmiyor". */
  const destekVarMi = (oz, bit) => !Number.isInteger(oz.destek) || (oz.destek & bit) !== 0;

  function perdeKomutu(oz, k) {
    const s = sayiOku(k);
    if (s) {
      if (!s.tam) return null;
      if (s.n < 0 || s.n > 100) return { hata: 'sinir', alt: 0, ust: 100 };
      const konumVar = Number.isInteger(oz.destek) ? (oz.destek & DESTEK_KONUM) !== 0 : sonluSayi(oz.konum) !== null;
      return konumVar ? komut('set_cover_position', { position: s.n }, 'konum', s.n) : { hata: 'desteklenmiyor' };
    }
    if (PERDE_DUR_SOZLERI.has(k)) return destekVarMi(oz, DESTEK_DUR) ? komut('stop_cover', undefined, 'dur') : { hata: 'desteklenmiyor' };
    if (PERDE_KAPAT_SOZLERI.has(k)) return destekVarMi(oz, DESTEK_KAPAT) ? komut('close_cover', undefined, 'kapak-kapat') : { hata: 'desteklenmiyor' };
    if (PERDE_AC_SOZLERI.has(k)) return destekVarMi(oz, DESTEK_AC) ? komut('open_cover', undefined, 'kapak-ac') : { hata: 'desteklenmiyor' };
    return null;
  }

  function vanaKomutu(oz, k) {
    if (VANA_KAPAT_SOZLERI.has(k)) return destekVarMi(oz, DESTEK_KAPAT) ? komut('close_valve', undefined, 'kapak-kapat') : { hata: 'desteklenmiyor' };
    if (VANA_AC_SOZLERI.has(k)) return destekVarMi(oz, DESTEK_AC) ? komut('open_valve', undefined, 'kapak-ac') : { hata: 'desteklenmiyor' };
    return null;
  }

  function otomasyonKomutu(_oz, k) {
    if (OTOMASYON_CALISTIR_SOZLERI.has(k)) return komut('trigger', undefined, 'calistir');
    if (AC_SOZLERI.has(k)) return komut('turn_on', undefined, 'ac');
    if (KAPAT_SOZLERI.has(k)) return komut('turn_off', undefined, 'kapat');
    return null;
  }

  /**
   * Öğenin alanına göre komut sözlüğünden TEK komut çözer. `kuyruk` katlanmış (katla) komut metnidir ("24", "ses 30", "sicak").
   * @param {{alan?: string, ozellik?: object|null}} oge palet öğesi ya da yüzey karosu (alan + varlik-ozellik alt kümesi)
   * @returns {{servis:string, veri?:object, tur:string, deger:*, kelvin?:number}|{hata:'sinir'|'desteklenmiyor', alt?:number, ust?:number}|null}
   */
  function alanKomutu(oge, kuyruk) {
    if (typeof kuyruk !== 'string' || kuyruk === '' || !KOMUTLU_ALANLAR.has(oge?.alan)) return null;
    const oz = oge.ozellik && typeof oge.ozellik === 'object' ? oge.ozellik : {};
    switch (oge.alan) {
      case 'light':
        return isikKomutu(oz, kuyruk);
      case 'climate':
        return iklimKomutu(oz, kuyruk);
      case 'media_player':
        return medyaKomutu(oz, kuyruk);
      case 'fan':
        return fanKomutu(oz, kuyruk);
      case 'humidifier':
        return nemKomutu(oz, kuyruk);
      case 'vacuum':
        return sozlukKomutu(SUPURGE_SOZLERI, kuyruk);
      case 'timer':
        return sozlukKomutu(ZAMANLAYICI_SOZLERI, kuyruk);
      case 'cover':
        return perdeKomutu(oz, kuyruk);
      case 'valve':
        return vanaKomutu(oz, kuyruk);
      case 'automation':
        return otomasyonKomutu(oz, kuyruk);
      case 'input_select':
      case 'select':
        return secimKomutu(oz, kuyruk);
      default:
        return sayiKomutu(oz, kuyruk); // input_number, number
    }
  }

  /** Alan komut sözlüğü olan bir alan mı? */
  const komutluAlanMi = (alan) => KOMUTLU_ALANLAR.has(alan);

  /**
   * Sorguyu ("baş" + "kuyruk") çiftlerine böler: kuyruk 1..4 sözcük, EN KISA kuyruk önce. baş en az bir sözcüktür.
   * @returns {{bas: string, kuyruk: string}[]} kuyruk katlanmıştır; baş özgün yazımdadır
   */
  function kuyrukBolumleri(sorgu) {
    const sozcukler = String(sorgu ?? '').trim().split(/\s+/).filter((s) => s !== '');
    const sonuc = [];
    for (let i = sozcukler.length - 1; i >= Math.max(1, sozcukler.length - KOMUT_KUYRUK_SINIRI); i -= 1) {
      sonuc.push({ bas: sozcukler.slice(0, i).join(' '), kuyruk: katla(sozcukler.slice(i).join(' ')) });
    }
    return sonuc;
  }

  /** Palet için: komut sözlüğü olan öğelerden, baş kısmı adıyla eşleşip kuyruğu komut olanlar (puan sırasıyla). */
  function komutAdaylari(sorgu, ogeler) {
    const bolumler = kuyrukBolumleri(sorgu);
    if (bolumler.length === 0) return [];
    const adaylar = [];
    (Array.isArray(ogeler) ? ogeler : []).forEach((oge, sira) => {
      if (!komutluAlanMi(oge?.alan)) return;
      for (const { bas, kuyruk } of bolumler) {
        const k = alanKomutu(oge, kuyruk);
        if (!k) continue;
        const etiket = String(oge.etiket ?? '');
        const saman = oge.grupEtiketi ? `${etiket} ${oge.grupEtiketi}` : etiket;
        const e = eslestir(bas, saman);
        if (!e) continue;
        const etiketUzunlugu = Array.from(etiket).length;
        adaylar.push({ oge, sira, puan: e.puan, konumlar: e.konumlar.filter((p) => p < etiketUzunlugu), k });
        return;
      }
    });
    adaylar.sort(
      (a, b) =>
        b.puan - a.puan ||
        karsilastir(sonSirasi(a.oge), sonSirasi(b.oge)) ||
        Array.from(String(a.oge.etiket ?? '')).length - Array.from(String(b.oge.etiket ?? '')).length ||
        a.sira - b.sira,
    );
    const enIyi = adaylar.length > 0 ? adaylar[0].puan : 0;
    const esik = enIyi > 0 ? enIyi * ALAKA_ORANI : -Infinity;
    return adaylar.filter((a) => a.puan >= esik);
  }

  /**
   * Palet sorgusu.
   *  - Boş sorgu: son kullanılanlar + bütün öğeler (bosSorguListesi).
   *  - 1.4.0 servis komutu: "klima 24", "masa sicak", "tv ses 30", "ev modu uyku" (alanKomutu). Eşleşen satıra `eylem`
   *    ({servis, veri, tur, deger}) yazılır; komut tanınıp cihaz desteklemiyorsa ya da değer aralık dışındaysa satırda
   *    `komutHatasi: 'desteklenmiyor' | 'sinir'` olur ve `eylem` null kalır (arayüz o satırda eylem çalıştırmaz).
   *  - "ışık 40" / "%40" / "40%": sayı seviye olur. Parlaklık kontrollü aday, YALNIZ en iyi puanın en az %80'i kadar
   *    iyiyse öne alınır (h-02: "ses 40" LED şeridi %40 yapmaz). Seviye bütün kısılabilir satırlara yazılır (`parlaklik`);
   *    kısılamayan satırlar `parlaklikDesteklenmiyor: true` taşır ve arayüz o satırda eylem çalıştırmamalıdır (h-13).
   *  - "ışık 0": aynı akış, satırlara `kapat: true` yazılır (`parlaklik` null).
   *  - Tam adı sorgunun kendisi olan öğe varsa ("Salon 2") sayı ad parçasıdır; seviye aranmaz (h-23).
   *  - Sayı tam metin olarak bir adla eşleşiyorsa ("oda 2" -> "Oda 2 Lambası") yine ad parçasıdır.
   * Üst düzey `parlaklik`, `kapat` ve `parlaklikDesteklenmiyor` İLK satırı anlatır (eski arayüz yalnız ilk satıra uygular).
   * @returns {{sonuclar: {oge:object, puan:number, konumlar:number[], parlaklik?:number|null, kapat?:boolean,
   *   parlaklikDesteklenmiyor?:boolean, bolum?:string, eylem?:object|null, komutHatasi?:string}[], parlaklik:number|null,
   *   kapat:boolean, parlaklikDesteklenmiyor:boolean}}
   */
  function paletSorgusu(sorgu, ogeler) {
    const duz = String(sorgu ?? '').trim();
    if (duz === '') return parlaklikSorgusu(duz, ogeler);
    const hedef = adOzeti(duz);
    const tamAd = (Array.isArray(ogeler) ? ogeler : []).some((oge) => adOzeti(oge?.etiket) === hedef);
    const gecikmeli = tamAd ? null : gecikmeSatirlari(duz, ogeler); // 1.4.0 (o-15): "salon 10 dk sonra kapat", "fan 30dk"
    if (gecikmeli) return gecikmeli;
    const komutlar = tamAd ? [] : komutAdaylari(duz, ogeler);
    if (komutlar.length === 0) return parlaklikSorgusu(duz, ogeler);
    const komutSatirlari = komutlar.map(({ oge, puan, konumlar, k }) => ({
      oge,
      puan,
      konumlar,
      parlaklik: null,
      kapat: false,
      parlaklikDesteklenmiyor: false,
      eylem: k.hata ? null : k,
      ...(k.hata ? { komutHatasi: k.hata } : {}),
    }));
    // Aynı sorguda parlaklık komutu da çalışabilir ("ışık 40"): komutu olmayan, gerçek bir seviye taşıyan satırlar puan sırasıyla araya girer.
    const komutluOgeler = new Set(komutlar.map((a) => a.oge));
    const parlaklikSatirlari = parlaklikSorgusu(duz, ogeler).sonuclar.filter(
      (r) => !komutluOgeler.has(r.oge) && ((r.parlaklik !== null && r.parlaklik !== undefined) || r.kapat === true),
    );
    const sonuclar = [...komutSatirlari, ...parlaklikSatirlari].sort((a, b) => b.puan - a.puan);
    const ilk = sonuclar[0];
    return {
      sonuclar,
      parlaklik: ilk?.parlaklik ?? null,
      kapat: ilk?.kapat === true,
      parlaklikDesteklenmiyor: ilk?.parlaklikDesteklenmiyor === true,
    };
  }

  /** Parlaklık söz dizimi ("ışık 40", "ışık 0") ve düz arama: 1.3.0'dan gelen davranış (paletSorgusu'nun komut dışı yolu). */
  function parlaklikSorgusu(duz, ogeler) {
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

  // --- Gecikmeli eylem sözdizimi (o-15): "salon 10 dk sonra kapat", "salon off in 10 min", "fan 30dk", "fan 2sa" ---------------------
  // Süre HER ZAMAN bir birimle yazılır ("30dk", "2 sa", "1sa30dk"): birimsiz sayı parlaklıktır ("ışık 40"), süre değildir. Üç biçim:
  //   "<ad> <süre> sonra <fiil>"   fiil aç/kapat: o kadar sonra aç ya da kapat
  //   "<ad> <fiil> in <süre>"      İngilizce karşılığı
  //   "<ad> <süre>"                süreli: HEMEN aç, süre dolunca kapat ("fan 30dk")
  // Çözümleme yalnız ayrıştırır; adın hangi öğeye ait olduğunu ve öğenin ertelenebilir olup olmadığını çağıran belirler. Doğrulama ana
  // süreçtedir (src/lib/gecikmeli-eylem.js): alan, eylem sınıfı, Kapı Kuralı, süre sınırı ve bekleyen sayısı orada yeniden denetlenir.
  const GECIKME_BIRIMLERI = new Map([
    ['dk', 1], ['dak', 1], ['dakika', 1], ['min', 1], ['mins', 1], ['minute', 1], ['minutes', 1],
    ['sa', 60], ['saat', 60], ['h', 60], ['hr', 60], ['hrs', 60], ['hour', 60], ['hours', 60],
  ]);
  const GECIKME_SOZLERI = new Set(['sonra', 'later']); // "10 dk sonra kapat"
  const GECIKME_ONCULERI = new Set(['in']); // "off in 10 min"
  const GECIKME_ALANLARI = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier']); // ertelenebilen alanlar (ana süreç aynı listeyi yeniden uygular)
  const EN_AZ_GECIKME_DK = 1;
  const EN_COK_GECIKME_DK = 1440; // 24 saat
  const SAYI_PARCASI = /^\d{1,4}(?:[.,]\d{1,2})?$/;
  const BIRLESIK_SURE = /^(\d{1,3})(sa|saat|h|hr|hrs)(\d{1,3})(dk|dak|dakika|min|mins)$/;
  const TEK_SURE = /^(\d{1,4}(?:[.,]\d{1,2})?)([a-z]+)$/;

  /** Katlanmış parça dizisinde `bas`tan `uzunluk` parçalık süreyi okur: dakika (yuvarlanmış, sınırsız) ya da null. */
  function gecikmeSuresiOku(parcalar, bas, uzunluk) {
    const metin = parcalar.slice(bas, bas + uzunluk);
    if (metin.length !== uzunluk || uzunluk < 1 || uzunluk > 2) return null;
    if (uzunluk === 1) {
      const birlesik = BIRLESIK_SURE.exec(metin[0]);
      if (birlesik) return Number(birlesik[1]) * 60 + Number(birlesik[3]);
      const tek = TEK_SURE.exec(metin[0]);
      if (!tek || !GECIKME_BIRIMLERI.has(tek[2])) return null;
      return Math.round(Number(tek[1].replace(',', '.')) * GECIKME_BIRIMLERI.get(tek[2]));
    }
    if (!SAYI_PARCASI.test(metin[0]) || !GECIKME_BIRIMLERI.has(metin[1])) return null;
    return Math.round(Number(metin[0].replace(',', '.')) * GECIKME_BIRIMLERI.get(metin[1]));
  }

  const gecikmeYonu = (fiil) => (YON_ACMA.includes(fiil) ? 'ac' : YON_KAPATMA.includes(fiil) ? 'kapat' : null);

  /**
   * @param {string} sorgu
   * @returns {{metin: string, dakika: number, yon: 'ac'|'kapat'|'sureli', hata?: 'sinir'}|null}
   *   yon 'sureli': hemen aç, süre sonra kapat. dakika 1..1440 dışındaysa `hata: 'sinir'` taşır (çağıran satırı "aralık dışı" gösterir).
   */
  function gecikmeCoz(sorgu) {
    const parcalar = String(sorgu ?? '').trim().split(/\s+/).filter((p) => p !== '');
    if (parcalar.length < 2 || parcalar.length > 12) return null;
    const katli = parcalar.map(katla);
    const son = katli.length;
    const sonuc = (adParcalari, dakika, yon) => {
      const metin = adParcalari.join(' ').trim();
      if (metin === '') return null;
      const r = { metin, dakika, yon };
      if (dakika < EN_AZ_GECIKME_DK || dakika > EN_COK_GECIKME_DK) r.hata = 'sinir';
      return r;
    };
    const sonYon = gecikmeYonu(katli[son - 1]);
    if (sonYon && son >= 4 && GECIKME_SOZLERI.has(katli[son - 2])) {
      for (const uzunluk of [1, 2]) {
        const bas = son - 2 - uzunluk;
        const dakika = bas >= 1 ? gecikmeSuresiOku(katli, bas, uzunluk) : null;
        if (dakika !== null) return sonuc(parcalar.slice(0, bas), dakika, sonYon);
      }
    }
    for (let i = 1; i + 2 < son; i += 1) {
      const yon = gecikmeYonu(katli[i]);
      if (!yon || !GECIKME_ONCULERI.has(katli[i + 1])) continue;
      const dakika = gecikmeSuresiOku(katli, i + 2, son - (i + 2));
      if (dakika !== null) return sonuc(parcalar.slice(0, i), dakika, yon);
    }
    for (const uzunluk of [1, 2]) {
      const bas = son - uzunluk;
      const dakika = bas >= 1 ? gecikmeSuresiOku(katli, bas, uzunluk) : null;
      if (dakika !== null) return sonuc(parcalar.slice(0, bas), dakika, 'sureli');
    }
    return null;
  }

  /**
   * Palet için gecikmeli eylem satırları: ad kısmı ertelenebilir alandaki (ışık, priz, vantilatör, input_boolean, nem alıcı) ve yıkıcı
   * olmayan, kullanılabilir öğelerle eşleşir. Eşleşen öğe yoksa null (normal arama sürer). Sınır dışı süre satırı `komutHatasi: 'sinir'` ile döner.
   */
  function gecikmeSatirlari(duz, ogeler) {
    const g = gecikmeCoz(duz);
    if (!g) return null;
    const uygun = (Array.isArray(ogeler) ? ogeler : []).filter((oge) => GECIKME_ALANLARI.has(oge?.alan) && oge.yikici !== true && oge.kullanilabilir !== false);
    // Yan etkili eylem: dağınık harf eşleşmesi ("ses" -> "LED şerit Işık") yeterli değildir; her sözcük adın (ya da grubun) içinde AYNEN geçmeli.
    const sozcukler = katla(g.metin).split(/\s+/).filter((s) => s !== '');
    const bulunan = ara(g.metin, uygun).filter((r) => {
      const saman = katla(`${r.oge.etiket ?? ''} ${r.oge.grupEtiketi ?? ''}`);
      return sozcukler.every((s) => saman.includes(s));
    });
    if (bulunan.length === 0) return null;
    const sonuclar = bulunan.map((r) => ({
      ...r,
      parlaklik: null,
      kapat: false,
      parlaklikDesteklenmiyor: false,
      eylem: null,
      gecikme: { dakika: g.dakika, yon: g.yon },
      ...(g.hata ? { komutHatasi: g.hata } : {}),
    }));
    return { sonuclar, parlaklik: null, kapat: false, parlaklikDesteklenmiyor: false };
  }

  // --- Son değişenler (o-18): "@" ile başlayan sorgu ------------------------------------------------------------------------------
  // "@" tek başına son değişenlerin hepsini (en yeni üstte) listeler; "@salon" adı süzer. Liste ana süreçten gelir (model.eylem.degisenler);
  // burası yalnız önek çözümlemesi ve süzmedir.

  /**
   * @param {string} sorgu
   * @returns {{metin: string}|null} "@" ile başlıyorsa süzgeç metni (boş olabilir); değilse null
   */
  function degisenSorgusu(sorgu) {
    const duz = String(sorgu ?? '').trimStart();
    return duz.startsWith('@') ? { metin: duz.slice(1).trim() } : null;
  }

  /**
   * @param {string} metin süzgeç metni (boşsa hepsi, listenin kendi sırasıyla)
   * @param {{ad: string}[]} degisenler
   * @returns {{degisen: object, puan: number, konumlar: number[]}[]}
   */
  function degisenSatirlari(metin, degisenler) {
    const liste = (Array.isArray(degisenler) ? degisenler : []).filter((d) => d && typeof d === 'object' && typeof d.ad === 'string');
    return ara(metin, liste.map((d) => ({ etiket: d.ad, d }))).map((r) => ({ degisen: r.oge.d, puan: r.puan, konumlar: r.konumlar }));
  }

  // --- Favori dışı cihazlar (o-46): "*" ile başlayan sorgu ---------------------------------------------------------------------
  // "*" tek başına listeyi (ada göre) gösterir; "*salon" adı (ve varsa oda adını) süzer; ilk ya da son sözcük bir alan sözcüğüyse
  // ("*ışık salon", "*salon priz", "*sahne") alan süzgeci olur. Liste ana süreçten gelir (src/lib/diger-cihazlar.js: yalnız Kapı Kuralı'ndan
  // geçmiş, zararsız, favori olmayan cihazlar); burası yalnız önek çözümlemesi ve süzmedir.
  const DIGER_ALAN_SOZLERI = new Map([
    ['isik', 'light'], ['light', 'light'], ['lights', 'light'],
    ['priz', 'switch'], ['prize', 'switch'], ['switch', 'switch'], ['plug', 'switch'],
    ['sahne', 'scene'], ['scene', 'scene'],
    ['fan', 'fan'], ['vantilator', 'fan'],
    ['yardimci', 'input_boolean'], ['sanal', 'input_boolean'], ['helper', 'input_boolean'],
    ['nem', 'humidifier'], ['humidifier', 'humidifier'],
  ]);
  const DIGER_ALANLARI = Object.freeze(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'scene']);

  /**
   * @param {string} sorgu
   * @returns {{alan: string|null, metin: string}|null} "*" ile başlıyorsa alan süzgeci (yoksa null) ve süzgeç metni (boş olabilir); değilse null
   */
  function digerSorgusu(sorgu) {
    const duz = String(sorgu ?? '').trimStart();
    if (!duz.startsWith('*')) return null;
    const parcalar = duz.slice(1).trim().split(/\s+/).filter((p) => p !== '');
    let alan = null;
    if (parcalar.length > 0 && DIGER_ALAN_SOZLERI.has(katla(parcalar[0]))) alan = DIGER_ALAN_SOZLERI.get(katla(parcalar.shift()));
    else if (parcalar.length > 1 && DIGER_ALAN_SOZLERI.has(katla(parcalar[parcalar.length - 1]))) alan = DIGER_ALAN_SOZLERI.get(katla(parcalar.pop()));
    return { alan, metin: parcalar.join(' ') };
  }

  /**
   * @param {{alan: string|null, metin: string}} cozum digerSorgusu sonucu
   * @param {{ad: string, alan: string, oda?: string}[]} liste ana süreçten gelen favori dışı cihazlar
   * @returns {{diger: object, puan: number, konumlar: number[]}[]} metin boşsa listenin kendi sırasıyla
   */
  function digerSatirlari(cozum, liste) {
    const alan = cozum && typeof cozum.alan === 'string' ? cozum.alan : null;
    const girdi = (Array.isArray(liste) ? liste : []).filter((d) => d && typeof d === 'object' && typeof d.ad === 'string' && (alan === null || d.alan === alan));
    return ara(typeof cozum?.metin === 'string' ? cozum.metin : '', girdi.map((d) => ({ etiket: d.ad, grupEtiketi: typeof d.oda === 'string' ? d.oda : '', d }))).map((r) => ({ diger: r.oge.d, puan: r.puan, konumlar: r.konumlar }));
  }

  // --- Yön sözdizimi (o-13): "led +10", "led -10", "salon ac", "salon kapat" ---------------------------------------------------
  // Sondaki sözcük ya işaretli bir adımdır (+10, -10, +10%, +%10, −5) ya da bir fiildir. İşaret ve rakam bitişik olmalıdır: "Ses +" ve
  // "Salon - Işık" gibi adlar bundan etkilenmez ("led - 10" yön değildir). Çözümleme yalnız ayrıştırır; adın hangi öğeye ait olduğunu
  // ve öğenin bu yönü destekleyip desteklemediğini çağıran belirler. Tam adı bu metin olan bir öğe varsa çağıran yönü hiç aramalıdır.
  const YON_ACMA = ['ac', 'yak', 'on', 'an', 'ein', 'einschalten', 'anschalten', 'allume', 'allumer', 'marche', 'enciende', 'encender', 'prende', 'prender'];
  const YON_KAPATMA = ['kapat', 'sondur', 'off', 'aus', 'ausschalten', 'abschalten', 'eteins', 'eteindre', 'arret', 'apaga', 'apagar'];
  const YON_DEGISTIRME = ['degistir', 'toggle', 'umschalten', 'wechseln', 'basculer', 'inverser', 'alterner', 'alternar', 'conmutar', 'cambiar'];
  const GORELI_SONEKI = /^(.*\S)\s+([+\-−–])%?(\d{1,3})%?$/;
  const EN_BUYUK_GORELI_ADIM = 100;

  /**
   * @param {string} sorgu
   * @returns {{metin: string, yon: {tur: 'goreli', delta: number} | {tur: 'ac'|'kapat'|'degistir'}}|null}
   *   goreli: 1-100 arası artı/eksi adım (delta işaretlidir); ac/kapat/degistir fiillerinin karşılıkları: aç/yak/on, kapat/söndür/off, değiştir/toggle
   */
  function yonCoz(sorgu) {
    const duz = String(sorgu ?? '').trim().replace(/\s+/g, ' ');
    const goreli = GORELI_SONEKI.exec(duz);
    if (goreli) {
      const n = Number(goreli[3]);
      if (!Number.isInteger(n) || n < 1 || n > EN_BUYUK_GORELI_ADIM) return null;
      return { metin: goreli[1].trim(), yon: { tur: 'goreli', delta: goreli[2] === '+' ? n : -n } };
    }
    const bosluk = duz.lastIndexOf(' ');
    if (bosluk <= 0) return null;
    const fiil = katlaDizi(duz.slice(bosluk + 1)).join('');
    const metin = duz.slice(0, bosluk).trim();
    if (metin === '') return null;
    if (YON_ACMA.includes(fiil)) return { metin, yon: { tur: 'ac' } };
    if (YON_KAPATMA.includes(fiil)) return { metin, yon: { tur: 'kapat' } };
    if (YON_DEGISTIRME.includes(fiil)) return { metin, yon: { tur: 'degistir' } };
    return null;
  }

  return {
    katlaKarakter,
    katlaDizi,
    altDiziEsles,
    eslestir,
    ara,
    sorguCoz,
    yonCoz,
    gecikmeCoz,
    degisenSorgusu,
    degisenSatirlari,
    digerSorgusu,
    digerSatirlari,
    bosSorguListesi,
    paletSorgusu,
    alanKomutu,
    komutluAlanMi,
    kuyrukBolumleri,
    BEYAZ_TONLAR,
    RENK_PALETI,
    GECIKME_ALANLARI,
    DIGER_ALANLARI,
    EN_AZ_GECIKME_DK,
    EN_COK_GECIKME_DK,
    ALAKA_ORANI,
    PARLAKLIK_YAKINLIGI,
    SON_SAYISI,
  };
});
