'use strict';

/**
 * Panel teması: renk matematiği, hazır temalar ve palet üretimi (saf; Electron'a bağlı değildir) — o-29.
 *
 * Amaç: kullanıcı bir hazır tema ya da özel vurgu / arka plan rengi seçince hızlı panel, komut paleti ve köşe bildiriminin TÜM
 * renk değişkenleri (yuzey.css :root) bu dosyadan üretilir ve metin renkleri her zaman zeminlerinde en az 4,5:1 (WCAG AA)
 * kontrastta kalır. Üretim şöyle çalışır:
 *   1. Arka plan rengi koyu ya da açık uca çekilir (çok açık/koyu olmayan "ölü bölge" renkleri okunur metin bırakmaz):
 *      koyu temada göreli parlaklık <= 0,035, açık temada >= 0,70. Bu yüzden önizleme, seçilen rengin AYNISI değil, okunur halidir.
 *   2. Yüzeyler (bg, bg-ust, karo, karo-uzerinde, kenar) tabandan türetilir.
 *   3. Metin benzeri her renk (metin, soluk, vurgu-metin...) dört yüzeyin HEPSİNDE >= 4,5 olana dek beyaza/siyaha çekilir.
 *   4. Vurgu rengi de aynı ilkeyle (koyu temada >= 0,30, açık temada <= 0,12 parlaklık) sınırlanır; rozet metni ona göre seçilir.
 * Yüksek karşıtlık paleti BURADA değil CSS'tedir (yuzey.css, kose-bildirim.css: :root[data-karsitlik]) ve özel renkleri yok sayar.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/tema-renk.js">, window.EvTemaRenk) çalışır: `require` kullanmaz.
 * Renderer tarafı yalnız gorunumUygula'yı (ana sürecin gönderdiği görünüm modelini <html> üzerine yazar) ve Ayarlar önizlemesini kullanır.
 * Ana süreç tarafı (hangi ayardan hangi model çıkar) src/lib/gorunum.js'tedir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvTemaRenk = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const HEX_DESENI = /^#[0-9a-f]{6}$/;
  const RGBA_DESENI = /^rgba\((?:\d{1,3}, ){3}(?:0|1|0?\.\d{1,3})\)$/;
  const BEYAZ = '#ffffff';
  const SIYAH = '#000000';
  const HEDEF_KONTRAST = 4.5;

  // Özel arka planın koyu/açık sayılma eşiği ve üretimin istediği parlaklık sınırları (yukarıdaki açıklama, madde 1 ve 4).
  const SEMA_ESIGI = 0.18;
  const TABAN_EN_COK_KOYU = 0.035;
  const TABAN_EN_AZ_ACIK = 0.7;
  const VURGU_EN_AZ_KOYU = 0.3;
  const VURGU_EN_COK_ACIK = 0.12;

  const VARSAYILAN_TABAN = Object.freeze({ koyu: '#1b1f27', acik: '#f3f5f9' }); // yuzey.css --bg ile aynı
  const VARSAYILAN_VURGU = Object.freeze({ koyu: '#60a5fa', acik: '#1d4ed8' }); // yuzey.css --vurgu ile aynı

  /** Hazır temalar: her biri iki tema için { arkaPlan, vurgu }. 'varsayilan' CSS'in kendi paletidir (hiçbir değişken yazılmaz). */
  const HAZIR_TEMALAR = Object.freeze({
    varsayilan: null,
    okyanus: Object.freeze({ koyu: Object.freeze({ arkaPlan: '#0e1c2b', vurgu: '#38bdf8' }), acik: Object.freeze({ arkaPlan: '#eaf3fb', vurgu: '#0369a1' }) }),
    orman: Object.freeze({ koyu: Object.freeze({ arkaPlan: '#111f17', vurgu: '#4ade80' }), acik: Object.freeze({ arkaPlan: '#ecf5ee', vurgu: '#15803d' }) }),
    gunbatimi: Object.freeze({ koyu: Object.freeze({ arkaPlan: '#241612', vurgu: '#fb923c' }), acik: Object.freeze({ arkaPlan: '#fbf0e8', vurgu: '#c2410c' }) }),
    lavanta: Object.freeze({ koyu: Object.freeze({ arkaPlan: '#1a1630', vurgu: '#a78bfa' }), acik: Object.freeze({ arkaPlan: '#f2eefb', vurgu: '#6d28d9' }) }),
    grafit: Object.freeze({ koyu: Object.freeze({ arkaPlan: '#161616', vurgu: '#d4d4d8' }), acik: Object.freeze({ arkaPlan: '#f1f1f1', vurgu: '#3f3f46' }) }),
  });
  const HAZIR_TEMA_ADLARI = Object.freeze(Object.keys(HAZIR_TEMALAR));

  // Sayfaya yazılabilen CSS değişkenleri (yuzey.css ve kose-bildirim.css :root). Renderer bunların dışındakini yazmaz.
  const DEGISKEN_ADLARI = Object.freeze([
    '--bg', '--bg-ust', '--karo', '--karo-uzerinde', '--kenar', '--metin', '--soluk', '--soluk-eski', '--soluk-secili',
    '--acik', '--acik-eski', '--canli', '--yedek', '--hata', '--vurgu', '--yikici', '--vurgu-metin', '--yikici-metin',
    '--rozet-metin', '--basari', '--isaret-metin',
  ]);

  // Tema başına sabit durum renkleri (yuzey.css ile aynı değerler). Metin gibi kullanılanlar yine de kontrasta uydurulur.
  const DURUM_RENKLERI = Object.freeze({
    koyu: Object.freeze({ canli: '#10b981', yedek: '#f59e0b', hata: '#ef4444', yikici: '#f87171', rozetMetin: '#0b1220' }),
    acik: Object.freeze({ canli: '#047857', yedek: '#9a4a06', hata: '#b91c1c', yikici: '#b91c1c', rozetMetin: '#ffffff' }),
  });
  const METIN_TABANLARI = Object.freeze({
    koyu: Object.freeze({ metin: '#f1f5f9', soluk: '#94a3b8', solukEski: '#8d9bb1', solukSecili: '#a3b1c6', acik: '#fbbf24', acikEski: '#e0b038', yikiciMetin: '#fca5a5' }),
    acik: Object.freeze({ metin: '#0f172a', soluk: '#475569', solukEski: '#58677d', solukSecili: '#475569', acik: '#9a4a06', acikEski: '#a35006', yikiciMetin: '#b91c1c' }),
  });
  // Yarı saydam malzeme (acrylic / mica) açıkken yüzeylerin alfa değerleri (yuzey.css :root[data-malzeme] ile aynı).
  const SAYDAMLIK = Object.freeze({
    koyu: Object.freeze({ '--bg': 0.6, '--bg-ust': 0.5, '--karo': 0.6, '--karo-uzerinde': 0.75, kenar: 'rgba(255, 255, 255, 0.14)' }),
    acik: Object.freeze({ '--bg': 0.62, '--bg-ust': 0.55, '--karo': 0.7, '--karo-uzerinde': 0.85, kenar: 'rgba(15, 23, 42, 0.16)' }),
  });

  // ---------------------------------------------------------------- renk matematiği

  /** "#rrggbb" (büyük/küçük harf, kenar boşluğu serbest) -> küçük harfli "#rrggbb"; başka her şey null. */
  function hexDuzelt(deger) {
    if (typeof deger !== 'string') return null;
    const m = deger.trim().toLowerCase();
    return HEX_DESENI.test(m) ? m : null;
  }

  function rgbAl(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexYap(r, g, b) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  }

  /** WCAG göreli parlaklık (0..1). */
  function parlaklik(hex) {
    const [r, g, b] = rgbAl(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** WCAG kontrast oranı (1..21). */
  function kontrast(a, b) {
    const [acik, koyu] = [parlaklik(a), parlaklik(b)].sort((x, y) => y - x);
    return (acik + 0.05) / (koyu + 0.05);
  }

  /** a rengini b rengine `oran` (0..1) kadar yaklaştırır (sRGB karışımı). */
  function karistir(a, b, oran) {
    const x = rgbAl(a);
    const y = rgbAl(b);
    return hexYap(x[0] + (y[0] - x[0]) * oran, x[1] + (y[1] - x[1]) * oran, x[2] + (y[2] - x[2]) * oran);
  }

  const enAzKontrast = (renk, zeminler) => Math.min(...zeminler.map((z) => kontrast(renk, z)));

  /**
   * `renk`i `yon` ('acik': beyaza, 'koyu': siyaha) doğru EN AZ gerektiği kadar çeker; `zeminler`in hepsinde kontrast >= hedef olunca durur.
   * Zaten yeterliyse aynısı döner; hiçbir karışım yetmezse uç renk (beyaz/siyah) döner.
   */
  function kontrastaUydur(renk, zeminler, hedef, yon) {
    if (enAzKontrast(renk, zeminler) >= hedef) return renk;
    const uc = yon === 'koyu' ? SIYAH : BEYAZ;
    for (let i = 1; i <= 50; i += 1) {
      const aday = karistir(renk, uc, i / 50);
      if (enAzKontrast(aday, zeminler) >= hedef) return aday;
    }
    return uc;
  }

  /** Göreli parlaklığı [enAz, enCok] aralığına getirir (aralık dışındaysa beyaza ya da siyaha en az gerektiği kadar çekilir). */
  function parlakligiSinirla(renk, enAz, enCok) {
    const p = parlaklik(renk);
    if (p < enAz) {
      for (let i = 1; i <= 50; i += 1) {
        const aday = karistir(renk, BEYAZ, i / 50);
        if (parlaklik(aday) >= enAz) return aday;
      }
      return BEYAZ;
    }
    if (p > enCok) {
      for (let i = 1; i <= 50; i += 1) {
        const aday = karistir(renk, SIYAH, i / 50);
        if (parlaklik(aday) <= enCok) return aday;
      }
      return SIYAH;
    }
    return renk;
  }

  function rgbaYap(hex, alfa) {
    const [r, g, b] = rgbAl(hex);
    return `rgba(${r}, ${g}, ${b}, ${alfa})`;
  }

  // ---------------------------------------------------------------- palet üretimi

  /** Seçimden bağımsız yardımcı: özel renk ya da hazır tema gerekiyor mu? (false: CSS'in kendi paleti geçerli, hiçbir değişken yazılmaz) */
  function ozelPaletGerekli(girdi) {
    const { tema, arkaPlan, vurgu } = girdi && typeof girdi === 'object' ? girdi : {};
    return (typeof tema === 'string' && tema !== 'varsayilan' && Object.prototype.hasOwnProperty.call(HAZIR_TEMALAR, tema)) || !!hexDuzelt(arkaPlan) || !!hexDuzelt(vurgu);
  }

  /**
   * Seçimden CSS değişkenleri üretir.
   * @param {object} secim
   * @param {'koyu'|'acik'} secim.sema Windows/ayar temasının sonucu (özel arka plan verilirse onun parlaklığı belirler)
   * @param {string} [secim.tema] hazır tema adı (HAZIR_TEMA_ADLARI)
   * @param {string} [secim.arkaPlan] "#rrggbb" ya da boş
   * @param {string} [secim.vurgu] "#rrggbb" ya da boş
   * @param {boolean} [secim.saydam] malzeme (acrylic/mica) açık: yüzeyler yarı saydam yazılır
   * @returns {{ sema: 'koyu'|'acik', arkaPlan: string, vurgu: string, degiskenler: Record<string, string> }}
   */
  function paletUret(girdi) {
    const { sema, tema = 'varsayilan', arkaPlan = '', vurgu = '', saydam = false } = girdi && typeof girdi === 'object' ? girdi : {};
    const hazir = Object.prototype.hasOwnProperty.call(HAZIR_TEMALAR, tema) ? HAZIR_TEMALAR[tema] : null;
    const ozelTaban = hexDuzelt(arkaPlan);
    const ozelVurgu = hexDuzelt(vurgu);
    let s = sema === 'acik' ? 'acik' : 'koyu';
    if (ozelTaban) s = parlaklik(ozelTaban) < SEMA_ESIGI ? 'koyu' : 'acik'; // açıkça seçilen renk temanın koyu/açık seçimini geçersiz kılar
    const secilen = hazir ? hazir[s] : null;
    const ham = ozelTaban || (secilen && secilen.arkaPlan) || VARSAYILAN_TABAN[s];
    const hamVurgu = ozelVurgu || (secilen && secilen.vurgu) || VARSAYILAN_VURGU[s];
    const koyu = s === 'koyu';
    const yon = koyu ? 'acik' : 'koyu'; // metin zeminden uzağa çekilir

    const taban = koyu ? parlakligiSinirla(ham, 0, TABAN_EN_COK_KOYU) : parlakligiSinirla(ham, TABAN_EN_AZ_ACIK, 1);
    const bg = taban;
    const bgUst = koyu ? karistir(taban, BEYAZ, 0.04) : karistir(taban, SIYAH, 0.05);
    const karo = koyu ? karistir(taban, BEYAZ, 0.07) : karistir(taban, BEYAZ, 0.85);
    const karoUzerinde = koyu ? karistir(taban, BEYAZ, 0.11) : karistir(taban, SIYAH, 0.07);
    const kenar = koyu ? karistir(taban, BEYAZ, 0.17) : karistir(taban, SIYAH, 0.2);
    const zeminler = [bg, bgUst, karo, karoUzerinde];
    const vurguRengi = koyu ? parlakligiSinirla(hamVurgu, VURGU_EN_AZ_KOYU, 1) : parlakligiSinirla(hamVurgu, 0, VURGU_EN_COK_ACIK);

    const d = DURUM_RENKLERI[s];
    const m = METIN_TABANLARI[s];
    const uydur = (renk) => kontrastaUydur(renk, zeminler, HEDEF_KONTRAST, yon);
    const doluZeminler = [vurguRengi, d.yikici, d.hata, d.yedek, d.canli];
    let rozetMetin = d.rozetMetin;
    if (enAzKontrast(rozetMetin, doluZeminler) < HEDEF_KONTRAST) rozetMetin = koyu ? SIYAH : BEYAZ;

    const degiskenler = {
      '--bg': bg,
      '--bg-ust': bgUst,
      '--karo': karo,
      '--karo-uzerinde': karoUzerinde,
      '--kenar': kenar,
      '--metin': uydur(m.metin),
      '--soluk': uydur(m.soluk),
      '--soluk-eski': uydur(m.solukEski),
      '--soluk-secili': uydur(m.solukSecili),
      '--acik': uydur(m.acik),
      '--acik-eski': uydur(m.acikEski),
      '--canli': d.canli,
      '--yedek': d.yedek,
      '--hata': d.hata,
      '--vurgu': vurguRengi,
      '--yikici': d.yikici,
      '--vurgu-metin': uydur(vurguRengi),
      '--yikici-metin': uydur(m.yikiciMetin),
      '--rozet-metin': rozetMetin,
      '--basari': d.canli, // köşe bildirimi
      '--isaret-metin': rozetMetin, // köşe bildirimi
    };
    if (saydam) {
      const alfa = SAYDAMLIK[s];
      for (const ad of ['--bg', '--bg-ust', '--karo', '--karo-uzerinde']) degiskenler[ad] = rgbaYap(degiskenler[ad], alfa[ad]);
      degiskenler['--kenar'] = alfa.kenar;
    }
    return Object.freeze({ sema: s, arkaPlan: taban, vurgu: vurguRengi, degiskenler: Object.freeze(degiskenler) });
  }

  /** Bir değişken değeri sayfaya yazılabilir mi? ("#rrggbb" ya da "rgba(r, g, b, a)") */
  function degiskenDegeriGecerli(deger) {
    return typeof deger === 'string' && (HEX_DESENI.test(deger) || RGBA_DESENI.test(deger));
  }

  // ---------------------------------------------------------------- sayfa tarafı

  const OZNITELIKLER = Object.freeze(['data-sema', 'data-karsitlik', 'data-hareket', 'data-gecis']);

  /**
   * Ana sürecin gönderdiği görünüm modelini <html> öğesine yazar (renderer; satır içi stil/HTML YOK, yalnız CSSOM değişkenleri ve öznitelikler):
   *   gorunum.degiskenler -> kok.style.setProperty (yalnız DEGISKEN_ADLARI ve geçerli renk değerleri), data-sema
   *   gorunum.karsitlik   -> data-karsitlik
   *   gorunum.hareketiAzalt ya da sistemde "hareketi azalt" -> data-hareket="azalt"
   *   gorunum.animasyon.gecis (hareket azaltılmamışsa) -> data-gecis
   * `gorunum` null/undefined ise (varsayılan görünüm) önceki her şey temizlenir.
   * @param {object} kok document.documentElement
   * @param {object|null} gorunum
   * @param {{ hareketAzalt?: boolean }} [sistem] sistemin "hareketi azalt" tercihi (matchMedia sonucu)
   * @returns {{ hareketAzalt: boolean, gecis: boolean, animasyon: object|null }}
   */
  function gorunumUygula(kok, gorunum, sistem) {
    const g = gorunum && typeof gorunum === 'object' ? gorunum : {};
    const stil = kok && kok.style;
    for (const ad of DEGISKEN_ADLARI) if (stil && typeof stil.removeProperty === 'function') stil.removeProperty(ad);
    for (const ad of OZNITELIKLER) if (kok && typeof kok.removeAttribute === 'function') kok.removeAttribute(ad);
    const yaz = (ad, deger) => {
      if (kok && typeof kok.setAttribute === 'function') kok.setAttribute(ad, deger);
    };
    let degiskenSayisi = 0;
    if (g.degiskenler && typeof g.degiskenler === 'object' && stil && typeof stil.setProperty === 'function') {
      for (const ad of DEGISKEN_ADLARI) {
        const deger = g.degiskenler[ad];
        if (degiskenDegeriGecerli(deger)) {
          stil.setProperty(ad, deger);
          degiskenSayisi += 1;
        }
      }
    }
    if (degiskenSayisi > 0 && (g.sema === 'koyu' || g.sema === 'acik')) yaz('data-sema', g.sema);
    if (g.karsitlik === true) yaz('data-karsitlik', '1');
    const hareketAzalt = g.hareketiAzalt === true || !!(sistem && sistem.hareketAzalt === true);
    if (hareketAzalt) yaz('data-hareket', 'azalt');
    const animasyon = g.animasyon && typeof g.animasyon === 'object' ? g.animasyon : null;
    const gecis = !!animasyon && animasyon.gecis === true && !hareketAzalt;
    if (gecis) yaz('data-gecis', '1');
    return { hareketAzalt, gecis, animasyon: hareketAzalt ? null : animasyon };
  }

  return {
    HEX_DESENI,
    HEDEF_KONTRAST,
    HAZIR_TEMALAR,
    HAZIR_TEMA_ADLARI,
    DEGISKEN_ADLARI,
    VARSAYILAN_TABAN,
    VARSAYILAN_VURGU,
    hexDuzelt,
    parlaklik,
    kontrast,
    karistir,
    kontrastaUydur,
    parlakligiSinirla,
    ozelPaletGerekli,
    paletUret,
    degiskenDegeriGecerli,
    gorunumUygula,
  };
});
