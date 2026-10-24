'use strict';

/**
 * Bilgi kartlarının biçimleyicileri (saf; hem Node'da hem renderer'da çalışır: window.EvBilgiBicim) — o-04, o-08, o-10.
 *
 * Sayı, saat, tarih ve gün farkı Intl ile yazılır; metin sözcükleri ("Bugün", "Yarın", "Tüm gün") çağıranın sözlüğündedir
 * (bu dosya sözcük içermez). Intl hata verirse (geçersiz saat dilimi vb.) sessizce yalın bir yedeğe düşülür; fırlatmaz.
 * Tüm işlevler `saatDilimi` (IANA adı) alabilir: üretimde verilmez (yerel saat dilimi), testlerde 'UTC' verilir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvBilgiBicim = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SAAT_BICIMLERI = Object.freeze(['sistem', '24', '12']);
  const TARIH_BICIMLERI = Object.freeze(['orta', 'kisa', 'uzun', 'yok']);
  const GUN_MS = 86_400_000;

  // Dil -> Intl yerel adı (lib/dil.js YEREL_ADLARI ile aynı; bu dosya dil.js'e bağlı olmadan çalışır, test/dil.test.js eşliği denetler).
  const YEREL_ADLARI = Object.freeze({ tr: 'tr-TR', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' });
  const yerelAdi = (dil) => (Object.hasOwn(YEREL_ADLARI, dil) ? YEREL_ADLARI[dil] : YEREL_ADLARI.tr);
  const sonluMu = (n) => typeof n === 'number' && Number.isFinite(n);

  // Biçimleyici önbelleği (her çağrıda yeni Intl nesnesi kurmak takvim / tahmin çiziminde milisaniyelere çıkıyordu). Tarih biçimleyicisi
  // YALNIZ saat dilimi açıkça verildiğinde önbelleğe girer: verilmezse çalışma ortamının (Windows) saat dilimi kullanılır ve tepside
  // uzun yaşayan uygulamada bu dilim değişebilir; önbellekteki nesne eski dilimi taşırdı. Sayı biçimleyicisi saat diliminden bağımsızdır.
  const ONBELLEK_SINIRI = 64;
  const tarihBicimleyicileri = new Map();
  const sayiBicimleyicileri = new Map();

  function onbellegeYaz(harita, anahtar, bicim) {
    if (harita.size >= ONBELLEK_SINIRI) harita.clear();
    harita.set(anahtar, bicim);
    return bicim;
  }

  function bicimleyici(yerel, secenek, saatDilimi) {
    const tam = saatDilimi ? { ...secenek, timeZone: saatDilimi } : secenek;
    const anahtar = saatDilimi ? `${yerel}|${saatDilimi}|${JSON.stringify(secenek)}` : null;
    if (anahtar !== null && tarihBicimleyicileri.has(anahtar)) return tarihBicimleyicileri.get(anahtar);
    try {
      const yeni = new Intl.DateTimeFormat(yerel, tam);
      return anahtar === null ? yeni : onbellegeYaz(tarihBicimleyicileri, anahtar, yeni);
    } catch {
      try {
        return new Intl.DateTimeFormat(yerel, secenek);
      } catch {
        return null;
      }
    }
  }

  function yuvarla(n, basamak) {
    const k = 10 ** basamak;
    return Math.round(n * k) / k || 0; // Math.round(-0.4) = -0: Intl '-0' yazardı; sıfıra yuvarlanan negatif değer '0' olur
  }

  /**
   * Sayıyı dilin ondalık ayracıyla yazar. `hassasiyet` (suggested_display_precision) verilirse tam o kadar basamak; verilmezse
   * büyüklüğe göre en çok 0/1/2 basamak (sondaki sıfırlar atılır). Sonlu değilse boş metin.
   */
  function sayiBicimle(sayi, { hassasiyet = null, dil = 'tr' } = {}) {
    if (!sonluMu(sayi)) return '';
    const ham = Math.abs(sayi);
    const enCok = sonluMu(hassasiyet) ? Math.max(0, Math.min(10, Math.round(hassasiyet))) : ham >= 100 ? 0 : ham >= 10 ? 1 : 2;
    const enAz = sonluMu(hassasiyet) ? enCok : 0;
    try {
      const yerel = yerelAdi(dil);
      const anahtar = `${yerel}|${enAz}|${enCok}`;
      const bicim = sayiBicimleyicileri.get(anahtar) ?? onbellegeYaz(sayiBicimleyicileri, anahtar, new Intl.NumberFormat(yerel, { minimumFractionDigits: enAz, maximumFractionDigits: enCok }));
      return bicim.format(yuvarla(sayi, enCok));
    } catch {
      return String(yuvarla(sayi, enCok));
    }
  }

  /** Saat metni: 'sistem' (Windows bölge ayarı), '24' ya da '12'. Geçersiz zaman: boş metin. */
  function saatMetni(ms, { saatBicimi = 'sistem', saatDilimi } = {}) {
    if (!sonluMu(ms)) return '';
    const secenek =
      saatBicimi === '24'
        ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : saatBicimi === '12'
          ? { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }
          : { hour: '2-digit', minute: '2-digit' };
    // '12' ve '24' dilden bağımsız sabit yerelle yazılır (en-US: "9:05 PM", en-GB: "21:05"); 'sistem' çalışma ortamının yerelini kullanır.
    const yerel = saatBicimi === '12' ? 'en-US' : saatBicimi === '24' ? 'en-GB' : undefined;
    const b = bicimleyici(yerel, secenek, saatDilimi);
    return b ? b.format(ms) : '';
  }

  /** Tarih metni: 'kisa' (14.10.2026), 'orta' (Çar, 14 Eki), 'uzun' (14 Ekim 2026 Çarşamba), 'yok' (boş). */
  function tarihMetni(ms, { tarihBicimi = 'orta', dil = 'tr', saatDilimi } = {}) {
    if (!sonluMu(ms) || tarihBicimi === 'yok') return '';
    const secenek =
      tarihBicimi === 'kisa'
        ? { day: '2-digit', month: '2-digit', year: 'numeric' }
        : tarihBicimi === 'uzun'
          ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
          : { weekday: 'short', day: 'numeric', month: 'short' };
    const b = bicimleyici(yerelAdi(dil), secenek, saatDilimi);
    return b ? b.format(ms) : '';
  }

  /** Gün numarası (UTC günü) — yalnız fark almak için. */
  const gunNumarasi = (y, a, g) => Math.floor(Date.UTC(y, a - 1, g) / GUN_MS);

  /**
   * Bir zamanın verilen saat dilimindeki takvim günü numarası; çözülemezse null. Saat dilimi verilmezse (üretim) yerel Date alıcıları
   * kullanılır: Intl nesnesi kurmaz ve çalışma ortamının saat dilimi değişirse (tepside uzun yaşar) bir sonraki çağrıda yeni dilimi izler.
   */
  function gunNumarasiMs(ms, saatDilimi) {
    if (!sonluMu(ms)) return null;
    if (!saatDilimi) {
      const d = new Date(ms);
      return sonluMu(d.getTime()) ? gunNumarasi(d.getFullYear(), d.getMonth() + 1, d.getDate()) : null;
    }
    const b = bicimleyici('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }, saatDilimi);
    if (!b) return null;
    const parca = Object.fromEntries(b.formatToParts(ms).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    return sonluMu(parca.year) && sonluMu(parca.month) && sonluMu(parca.day) ? gunNumarasi(parca.year, parca.month, parca.day) : null;
  }

  /**
   * Etkinlik başlangıcının bugüne göre gün farkı (0: bugün, 1: yarın, ...; geçmiş günler negatif). `baslangic`: ISO tarih-saat
   * ('2026-10-17T09:00:00+03:00') ya da tüm gün tarihi ('2026-10-20'). Çözülemezse null.
   */
  function gunFarki(baslangic, simdiMs, saatDilimi) {
    const bugun = gunNumarasiMs(simdiMs, saatDilimi);
    if (bugun === null || typeof baslangic !== 'string') return null;
    const tarihOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baslangic);
    const gun = tarihOnly ? gunNumarasi(Number(tarihOnly[1]), Number(tarihOnly[2]), Number(tarihOnly[3])) : gunNumarasiMs(Date.parse(baslangic), saatDilimi);
    return gun === null ? null : gun - bugun;
  }

  /** Kısa gün adı + gün + ay ("Per 16 Eki"); tüm gün tarihi ('2026-10-20') yerel gün olarak yazılır. */
  function gunMetni(baslangic, { dil = 'tr', saatDilimi } = {}) {
    const tarihOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baslangic ?? '');
    const ms = tarihOnly ? Date.UTC(Number(tarihOnly[1]), Number(tarihOnly[2]) - 1, Number(tarihOnly[3]), 12) : Date.parse(baslangic);
    return tarihMetni(ms, { tarihBicimi: 'orta', dil, saatDilimi: tarihOnly ? 'UTC' : saatDilimi });
  }

  /**
   * Hava tahmini satırının TAKVİM GÜNÜ ('YYYY-MM-DD'): ISO tarih-saatin tarih kısmı alınır (hava varlığı kendi saat diliminde gün başı
   * verir; "2026-10-17T00:00:00-07:00" yerel saat diliminde 16'sına kaysa da gün 17'sidir). Geçersiz girdide null.
   */
  function tahminGunKismi(zaman) {
    const e = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(typeof zaman === 'string' ? zaman : '');
    if (!e) return null;
    const ay = Number(e[2]);
    const gun = Number(e[3]);
    return ay >= 1 && ay <= 12 && gun >= 1 && gun <= 31 ? `${e[1]}-${e[2]}-${e[3]}` : null;
  }

  /** Tahmin gününün kısa haftaiçi adı ("Cmt", "Sat"); tarih kısmından (tahminGunKismi) hesaplanır, saat dilimine bağlı değildir. */
  function tahminGunu(zaman, { dil = 'tr' } = {}) {
    const gun = tahminGunKismi(zaman);
    if (gun === null) return '';
    const b = bicimleyici(yerelAdi(dil), { weekday: 'short' }, 'UTC');
    return b ? b.format(Date.parse(`${gun}T12:00:00Z`)) : '';
  }

  /**
   * Etkinliğin saat metni: tüm gün etkinliğinde null (çağıran "Tüm gün" yazar), değilse saat. Bitiş varsa "09:00–10:00".
   */
  function etkinlikSaati(etkinlik, { saatBicimi = 'sistem', saatDilimi } = {}) {
    if (!etkinlik || etkinlik.tumGun === true || typeof etkinlik.baslangic !== 'string') return null;
    const bas = Date.parse(etkinlik.baslangic);
    if (!sonluMu(bas)) return null;
    const baslangic = saatMetni(bas, { saatBicimi, saatDilimi });
    const bit = typeof etkinlik.bitis === 'string' ? Date.parse(etkinlik.bitis) : NaN;
    if (!sonluMu(bit) || bit <= bas) return baslangic;
    return `${baslangic}–${saatMetni(bit, { saatBicimi, saatDilimi })}`;
  }

  /** İkili sensör sınıfları: "açık" = dikkat gerektirir (pil zayıf, sorun, duman, gaz, CO, su baskını). Kapı/kilit/pencere sınıfları Kapı Kuralı'yla zaten modelde yoktur. */
  const DIKKAT_IKILI_SINIFLAR = Object.freeze(['battery', 'problem', 'smoke', 'gas', 'carbon_monoxide', 'moisture']);

  /**
   * Sensör karosu dikkat gerektiriyor mu? 'pil' (yüzdesi eşiğin altında olan pil sensörü ya da "pil zayıf" ikili sensörü),
   * 'sorun' (problem/duman/gaz/CO/nem ikili sensörü açık) ya da null. Karo, yuzey-modeli.js karosudur (alan + ozellik).
   * Ulaşılamayan sensör ve sayı olmayan değer uyarı SAYILMAZ (sürekli yanlış alarm olmasın).
   */
  function dikkatNedeni(karo, pilEsigi = 20) {
    const o = karo?.ozellik;
    if (!o || typeof o !== 'object') return null;
    if (karo.alan === 'sensor') {
      const yuzde = o.birim === '%' || o.birim === null || o.birim === '';
      return o.sinif === 'battery' && yuzde && sonluMu(o.sayi) && o.sayi >= 0 && o.sayi < pilEsigi ? 'pil' : null;
    }
    if (karo.alan === 'binary_sensor') {
      if (o.acik !== true || !DIKKAT_IKILI_SINIFLAR.includes(o.sinif)) return null;
      return o.sinif === 'battery' ? 'pil' : 'sorun';
    }
    return null;
  }

  /** Sayıyı yüzde işaretiyle yazar: Türkçede "%45", İngilizcede "45%", Almanca / Fransızca / İspanyolcada "45 %". */
  function yuzdeMetni(sayi, { hassasiyet = null, dil = 'tr' } = {}) {
    const n = sayiBicimle(sayi, { hassasiyet, dil });
    if (n === '') return '';
    if (dil === 'en') return `${n}%`;
    return dil === 'de' || dil === 'fr' || dil === 'es' ? `${n} %` : `%${n}`;
  }

  /**
   * Sensör değeri + birim ("21,4 °C", "%45", "1 250 W"). Birimsiz sayı yalın yazılır. Sayı yoksa boş metin (çağıran metin değerini
   * ya da "bilinmiyor"u yazar). `ozellik`: varlik-ozellik.js sensor modeli ({sayi, birim, hassasiyet}).
   */
  function sensorSayisiMetni(ozellik, { dil = 'tr' } = {}) {
    if (!ozellik || !sonluMu(ozellik.sayi)) return '';
    const hassasiyet = sonluMu(ozellik.hassasiyet) ? ozellik.hassasiyet : null;
    if (ozellik.birim === '%') return yuzdeMetni(ozellik.sayi, { hassasiyet, dil });
    const n = sayiBicimle(ozellik.sayi, { hassasiyet, dil });
    return typeof ozellik.birim === 'string' && ozellik.birim !== '' ? `${n} ${ozellik.birim}` : n;
  }

  /** Zaman ekseni yazısı: günlük (7 gün gibi uzun aralık) ise "14 Eki", değilse saat ("14:30"). */
  function eksenZamani(ms, { gunluk = false, saatBicimi = 'sistem', dil = 'tr', saatDilimi } = {}) {
    if (!sonluMu(ms)) return '';
    if (!gunluk) return saatMetni(ms, { saatBicimi, saatDilimi });
    const b = bicimleyici(yerelAdi(dil), { day: 'numeric', month: 'short' }, saatDilimi);
    return b ? b.format(ms) : '';
  }

  /** Aralığı başka veriden türetilemeyen yüzde benzeri sınıflar: 0..100 gösterge. */
  const YUZDE_SINIFLARI = Object.freeze(['battery', 'humidity', 'moisture', 'power_factor']);

  /**
   * Gösterge (gauge) aralığı: önce sensörün kendi alt/üst sınırı (min_value/max_value), yoksa yüzde birimi ya da pil/nem sınıfı
   * için 0..100; başka türlü null (çağıran son geçmişin aralığına düşebilir). Alt >= üst ise geçersizdir.
   * @param {{enAz?: number|null, enCok?: number|null, birim?: string|null, sinif?: string|null}} ozellik
   * @returns {{enAz: number, enCok: number, kaynak: 'oznitelik'|'yuzde'}|null}
   */
  function gostergeAraligi(ozellik) {
    if (!ozellik || typeof ozellik !== 'object') return null;
    if (sonluMu(ozellik.enAz) && sonluMu(ozellik.enCok) && ozellik.enCok > ozellik.enAz) return { enAz: ozellik.enAz, enCok: ozellik.enCok, kaynak: 'oznitelik' };
    if (ozellik.birim === '%' || YUZDE_SINIFLARI.includes(ozellik.sinif)) return { enAz: 0, enCok: 100, kaynak: 'yuzde' };
    return null;
  }

  // Palet hızlı ekleme (o-07): "liste süt", "list milk", "todo süt". Anahtar sözcük dilden bağımsızdır (arama gibi).
  const HIZLI_SOZCUKLER = Object.freeze(['liste', 'list', 'todo']);
  const HIZLI_EN_UZUN = 200; // todo.add_item metin sınırı (servis-izinleri.js)

  /**
   * Palet sorgusu "liste <metin>" biçimindeyse eklenecek metni verir; değilse null. Sözcük büyük/küçük harf ve Türkçe harf
   * duyarsızdır; metin boşluklarıyla teke indirilir ve en çok 200 karakterdir (fazlası null: eksik ekleme yapılmaz).
   * Metin yalnız todo.add_item'a gider (konuşma API'sine ya da başka servise gitmez).
   */
  function hizliEkleCoz(sorgu) {
    const e = /^\s*(\S+)\s+([\s\S]+?)\s*$/.exec(typeof sorgu === 'string' ? sorgu : '');
    if (!e) return null;
    const sozcuk = e[1].toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
    if (!HIZLI_SOZCUKLER.includes(sozcuk)) return null;
    const metin = e[2].replace(/\s+/g, ' ').trim();
    if (metin === '' || Array.from(metin).length > HIZLI_EN_UZUN) return null;
    return { metin };
  }

  // Hava durumu simgeleri: süs (aria-hidden); durum adı yazıyla da gösterilir.
  const HAVA_SIMGELERI = Object.freeze({
    sunny: '☀',
    'clear-night': '☾',
    cloudy: '☁',
    partlycloudy: '⛅',
    rainy: '🌧',
    pouring: '🌧',
    snowy: '❄',
    'snowy-rainy': '🌨',
    fog: '🌫',
    hail: '🌨',
    lightning: '⚡',
    'lightning-rainy': '⛈',
    windy: '💨',
    'windy-variant': '💨',
    exceptional: '⚠',
  });

  return {
    YEREL_ADLARI,
    SAAT_BICIMLERI,
    TARIH_BICIMLERI,
    DIKKAT_IKILI_SINIFLAR,
    YUZDE_SINIFLARI,
    HIZLI_SOZCUKLER,
    HAVA_SIMGELERI,
    sayiBicimle,
    yuzdeMetni,
    sensorSayisiMetni,
    saatMetni,
    tarihMetni,
    eksenZamani,
    gunFarki,
    gunMetni,
    tahminGunKismi,
    tahminGunu,
    etkinlikSaati,
    dikkatNedeni,
    gostergeAraligi,
    hizliEkleCoz,
  };
});
