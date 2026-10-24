'use strict';

/**
 * Bağımlılıksız küçük grafik kütüphanesi — o-09 (sensör mini grafiği + gösterge) ve o-11 (geçmiş grafiği + karşılaştırma).
 * Hem Node'da (testler) hem renderer'da çalışır (window.EvGrafik); saftır: ağ yok, global durum yok.
 *
 * Çıktı SVG METNİ DEĞİL, düz bir betimdir: { e: etiket, a: {öznitelik}, c: [çocuk], m: metin }. `svgOlustur(doc, betim)` bunu
 * createElementNS + setAttribute + textContent ile DOM'a çevirir. Böylece renderer'ın CSP'siyle (inline stil/betik yok,
 * HTML metni ataması yok) uyumludur: renkler ve kalınlıklar CSS sınıflarından gelir, `style` özniteliği ve `on*` öznitelikleri
 * svgOlustur'da reddedilir. Bu dosyada dile bağlı sözcük yoktur; eksen yazıları çağıranın verdiği işlevlerle üretilir.
 *
 * Veri biçimi (ha-okuma.js gecmis): nokta = { t: ms, d: sayı | metin | null }. Sayı olmayan değer ("unavailable", "on") çizgide
 * KESİNTİ olarak çizilir; en az / en çok / ortalama yalnız sayısal noktalardan hesaplanır.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvGrafik = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SVG_AD_ALANI = 'http://www.w3.org/2000/svg';
  const EN_COK_SERI = 7;
  const EN_COK_NOKTA = 2000;
  const DAKIKA_MS = 60_000;
  const SAAT_PAYI_MS = 3 * 60 * DAKIKA_MS; // saat dilimi kayması yön değiştirirse döngü sınırı için pay
  const ZAMAN_ADIMLARI = Object.freeze([5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880].map((d) => d * DAKIKA_MS));
  const IZINLI_ETIKETLER = new Set(['svg', 'g', 'path', 'line', 'circle', 'rect', 'text', 'title']);
  const SERI_KESIK_DESENLERI = Object.freeze([null, null, null, null, '6 3', '2 3', '8 3 2 3']); // 5. serinin ardından renk körlüğü için desen

  const sonluMu = (n) => typeof n === 'number' && Number.isFinite(n);
  /** Yol/öznitelik sayıları: 1 ondalık yeter (SVG küçük). */
  const s1 = (n) => String(Math.round((sonluMu(n) ? n : 0) * 10) / 10);
  const sinirla = (n, alt, ust) => Math.min(ust, Math.max(alt, n));

  /** Ham seriyi güvenli noktalara çevirir: t sonlu olmalı, sırayla dizilir, değer sayı değilse null (kesinti). */
  function temizle(seri) {
    if (!Array.isArray(seri)) return [];
    const sonuc = [];
    for (const n of seri) {
      if (sonuc.length >= EN_COK_NOKTA) break;
      if (!n || typeof n !== 'object' || !sonluMu(n.t)) continue;
      sonuc.push({ t: n.t, d: sonluMu(n.d) ? n.d : null });
    }
    return sonuc.sort((a, b) => a.t - b.t);
  }

  /** Kesintilerle (null değer) bölünmüş sayısal parçalar. */
  function parcala(noktalar) {
    const parcalar = [];
    let su = [];
    for (const n of noktalar) {
      if (n.d === null) {
        if (su.length > 0) parcalar.push(su);
        su = [];
      } else {
        su.push(n);
      }
    }
    if (su.length > 0) parcalar.push(su);
    return parcalar;
  }

  /**
   * En az / en çok / ortalama / ilk / son. Ortalama ZAMAN AĞIRLIKLIDIR (noktalar arası doğrusal; kesintiler dışarıda):
   * seyrek örneklenmiş seri yoğun örneklenmiş kısım yüzünden yanlış ortalama vermez. Sayısal nokta yoksa null.
   */
  function ozet(seri) {
    const noktalar = temizle(seri);
    const sayisal = noktalar.filter((n) => n.d !== null);
    if (sayisal.length === 0) return null;
    let enAz = Infinity;
    let enCok = -Infinity;
    let toplam = 0;
    for (const n of sayisal) {
      if (n.d < enAz) enAz = n.d;
      if (n.d > enCok) enCok = n.d;
      toplam += n.d;
    }
    let alan = 0;
    let sure = 0;
    for (const p of parcala(noktalar)) {
      for (let i = 1; i < p.length; i += 1) {
        const dt = p[i].t - p[i - 1].t;
        alan += ((p[i].d + p[i - 1].d) / 2) * dt;
        sure += dt;
      }
    }
    return {
      enAz,
      enCok,
      ortalama: sure > 0 ? alan / sure : toplam / sayisal.length,
      ilk: sayisal[0].d,
      son: sayisal.at(-1).d,
      ilkT: sayisal[0].t,
      sonT: sayisal.at(-1).t,
      adet: sayisal.length,
    };
  }

  /** Zamana en yakın SAYISAL nokta ({t, d}); yoksa null. */
  function enYakin(seri, t) {
    if (!sonluMu(t)) return null;
    let en = null;
    for (const n of temizle(seri)) {
      if (n.d === null) continue;
      if (en === null || Math.abs(n.t - t) < Math.abs(en.t - t)) en = n;
    }
    return en;
  }

  function guzelSayi(x, yuvarla) {
    const us = Math.floor(Math.log10(x));
    const f = x / 10 ** us;
    let g;
    if (yuvarla) g = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else g = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return g * 10 ** us;
  }

  /**
   * Düzgün eksen aralığı: { alt, ust, adim, isaretler }. Düz seri (en az = en çok) için değerin etrafında yapay bir pay açılır.
   * Sonlu olmayan girdide null.
   */
  function guzelAralik(enAz, enCok, hedef = 4) {
    if (!sonluMu(enAz) || !sonluMu(enCok)) return null;
    let alt = Math.min(enAz, enCok);
    let ust = Math.max(enAz, enCok);
    if (alt === ust) {
      const pay = alt === 0 ? 1 : Math.abs(alt) * 0.1;
      alt -= pay;
      ust += pay;
    }
    const aralik = guzelSayi(ust - alt, false);
    const adim = guzelSayi(aralik / Math.max(1, hedef - 1), true);
    const a = Math.floor(alt / adim) * adim;
    const u = Math.ceil(ust / adim) * adim;
    const sayi = Math.min(24, Math.round((u - a) / adim));
    const isaretler = [];
    for (let i = 0; i <= sayi; i += 1) isaretler.push(Number((a + i * adim).toFixed(10)));
    return { alt: Number(a.toFixed(10)), ust: Number(u.toFixed(10)), adim, isaretler };
  }

  /**
   * Zaman ekseni işaretleri: [bas, bit] içinde, yerel saat sınırlarına (5 dk ... 2 gün) oturan en çok `en` zaman damgası.
   * `kaymaMs`: yerel saat farkı — sayı (sabit, ms), `(ms) => kayma` işlevi ya da verilmezse çalışma ortamının saat dilimi.
   * Sabit sayı her işarete aynen uygulanır (testler 0 verir); işlev ve varsayılan her işaretin KENDİ anındaki farkı kullanır,
   * böylece yaz/kış saati geçişini kapsayan pencerede geçişten sonraki işaretler de yerel sınıra oturur.
   */
  function zamanIsaretleri(bas, bit, { en = 5, kaymaMs } = {}) {
    if (!sonluMu(bas) || !sonluMu(bit) || bit <= bas) return [];
    const kaymaAl = typeof kaymaMs === 'function' ? kaymaMs : sonluMu(kaymaMs) ? () => kaymaMs : (ms) => -new Date(ms).getTimezoneOffset() * DAKIKA_MS;
    const yerelFark = (ms) => {
      const k = kaymaAl(ms);
      return sonluMu(k) ? k : 0;
    };
    const adim = ZAMAN_ADIMLARI.find((a) => (bit - bas) / a <= en) ?? ZAMAN_ADIMLARI.at(-1);
    const kayma0 = yerelFark(bas);
    const sonuc = [];
    // L: yerel saat sınırı (yerel duvar saati ms'si); işaretin gerçek anı = L - o andaki kayma (iki turda yakınsar)
    for (let L = Math.ceil((bas + kayma0) / adim) * adim; L - kayma0 - SAAT_PAYI_MS <= bit && sonuc.length < 24; L += adim) {
      let t = L - kayma0;
      t = L - yerelFark(t);
      t = L - yerelFark(t);
      // ileri alınan saatte var olmayan yerel sınır ile sonraki sınır aynı ana yakınsar: tekrar eden ya da geriye düşen an atlanır
      if (t >= bas && t <= bit && (sonuc.length === 0 || t > sonuc[sonuc.length - 1])) sonuc.push(t);
    }
    return sonuc;
  }

  // --- DOM'a çevirme ----------------------------------------------------------------------------------------------------

  /**
   * Betimi DOM'a çevirir. Yalnız izinli SVG etiketleri; `style`, `on*`, `href` ve `xlink:*` öznitelikleri atlanır (CSP ve betik
   * enjeksiyonu savunması); metin textContent ile yazılır. En çok 6 derinlik. Geçersiz betimde null.
   */
  function svgOlustur(doc, betim, derinlik = 0) {
    if (!doc || typeof doc.createElementNS !== 'function' || !betim || typeof betim !== 'object' || derinlik > 6 || !IZINLI_ETIKETLER.has(betim.e)) return null;
    const oge = doc.createElementNS(SVG_AD_ALANI, betim.e);
    for (const [ad, deger] of Object.entries(betim.a ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z-]{0,30}$/.test(ad) || /^(on|style$|href$|xlink)/i.test(ad)) continue;
      if (deger === undefined || deger === null || deger === false) continue;
      oge.setAttribute(ad, String(deger));
    }
    if (typeof betim.m === 'string') oge.textContent = betim.m;
    for (const c of Array.isArray(betim.c) ? betim.c : []) {
      const cocuk = svgOlustur(doc, c, derinlik + 1);
      if (cocuk) oge.appendChild(cocuk);
    }
    return oge;
  }

  const dugum = (e, a, c, m) => ({ e, a: a ?? {}, c: c ?? [], ...(m === undefined ? {} : { m }) });

  /** Erişilebilirlik: etiket varsa role="img" + aria-label (+ title), yoksa süs olarak gizlenir. */
  function erisilebilir(ozellikler, etiket) {
    if (typeof etiket === 'string' && etiket !== '') return { ...ozellikler, role: 'img', 'aria-label': etiket };
    return { ...ozellikler, 'aria-hidden': 'true' };
  }

  // --- Mini grafik (sparkline) ------------------------------------------------------------------------------------------

  /**
   * Küçük çizgi grafiği (eksensiz). Genişliğe CSS ile uyar (preserveAspectRatio none + non-scaling-stroke).
   * Sayısal nokta 2'den azsa ya da zaman aralığı sıfırsa null (arayüz yer ayırmaz).
   * @param {{t:number,d:any}[]} seri
   * @param {{genislik?:number, yukseklik?:number, bas?:number, bitis?:number, etiket?:string, alan?:boolean}} [secenek]
   */
  function sparkline(seri, { genislik = 100, yukseklik = 28, bas, bitis, etiket = '', alan = true } = {}) {
    const noktalar = temizle(seri);
    const sayisal = noktalar.filter((n) => n.d !== null);
    if (sayisal.length < 2) return null;
    const t0 = sonluMu(bas) ? bas : sayisal[0].t;
    const t1 = sonluMu(bitis) ? bitis : sayisal.at(-1).t;
    if (!(t1 > t0)) return null;
    let enAz = Math.min(...sayisal.map((n) => n.d));
    let enCok = Math.max(...sayisal.map((n) => n.d));
    if (enAz === enCok) {
      const pay = enAz === 0 ? 1 : Math.abs(enAz) * 0.1;
      enAz -= pay;
      enCok += pay;
    }
    const kenar = 2;
    const x = (t) => sinirla(((t - t0) / (t1 - t0)) * genislik, 0, genislik);
    const y = (d) => yukseklik - kenar - ((d - enAz) / (enCok - enAz)) * (yukseklik - 2 * kenar);
    let cizgi = '';
    let dolgu = '';
    for (const p of parcala(noktalar)) {
      const nokta = p.map((n) => `${s1(x(n.t))} ${s1(y(n.d))}`);
      if (p.length === 1) {
        // tek nokta: kısa yatay çizgi (aksi halde görünmez)
        cizgi += `M${s1(x(p[0].t) - 1)} ${s1(y(p[0].d))}L${s1(x(p[0].t) + 1)} ${s1(y(p[0].d))}`;
        continue;
      }
      cizgi += `M${nokta.join('L')}`;
      dolgu += `M${s1(x(p[0].t))} ${s1(yukseklik)}L${nokta.join('L')}L${s1(x(p.at(-1).t))} ${s1(yukseklik)}Z`;
    }
    const cocuklar = [];
    if (alan && dolgu) cocuklar.push(dugum('path', { class: 'sparkline-alan', d: dolgu }));
    cocuklar.push(dugum('path', { class: 'sparkline-cizgi', d: cizgi, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
    return dugum(
      'svg',
      erisilebilir({ class: 'sparkline', viewBox: `0 0 ${s1(genislik)} ${s1(yukseklik)}`, preserveAspectRatio: 'none', focusable: 'false' }, etiket),
      cocuklar,
    );
  }

  // --- Gösterge (yarım daire) -------------------------------------------------------------------------------------------

  /** Değerin [enAz, enCok] aralığındaki oranı (0..1, aralık dışı kırpılır); girdi sonlu değilse ya da aralık geçersizse null. */
  function gostergeOrani(deger, enAz, enCok) {
    if (!sonluMu(deger) || !sonluMu(enAz) || !sonluMu(enCok) || !(enCok > enAz)) return null;
    return sinirla((deger - enAz) / (enCok - enAz), 0, 1);
  }

  /**
   * Yarım daire gösterge: arka yay + değer yayı. `durum`: 'normal' | 'uyari' | 'kritik' (CSS sınıfı; renk CSS'ten gelir).
   * @returns {object|null} betim; değer ya da aralık geçersizse null
   */
  function gosterge(deger, enAz, enCok, { boyut = 56, kalinlik = 6, durum = 'normal', etiket = '' } = {}) {
    const oran = gostergeOrani(deger, enAz, enCok);
    if (oran === null) return null;
    const r = (boyut - kalinlik) / 2;
    const cx = boyut / 2;
    const cy = r + kalinlik / 2;
    const yukseklik = cy + kalinlik / 2;
    const arka = `M${s1(cx - r)} ${s1(cy)}A${s1(r)} ${s1(r)} 0 0 1 ${s1(cx + r)} ${s1(cy)}`;
    const aci = Math.PI - oran * Math.PI;
    const uc = `${s1(cx + r * Math.cos(aci))} ${s1(cy - r * Math.sin(aci))}`;
    const sinif = ['normal', 'uyari', 'kritik'].includes(durum) ? durum : 'normal';
    const cocuklar = [dugum('path', { class: 'gosterge-arka', d: arka, fill: 'none', 'stroke-width': s1(kalinlik), 'stroke-linecap': 'round' })];
    if (oran > 0) {
      cocuklar.push(
        dugum('path', { class: `gosterge-deger ${sinif}`, d: `M${s1(cx - r)} ${s1(cy)}A${s1(r)} ${s1(r)} 0 0 1 ${uc}`, fill: 'none', 'stroke-width': s1(kalinlik), 'stroke-linecap': 'round' }),
      );
    }
    return dugum('svg', erisilebilir({ class: 'gosterge', viewBox: `0 0 ${s1(boyut)} ${s1(yukseklik)}`, focusable: 'false' }, etiket), cocuklar);
  }

  // --- Karşılaştırma / geçmiş grafiği ----------------------------------------------------------------------------------

  /**
   * Çok serili çizgi grafiği, ORTAK ZAMAN EKSENİ (en çok 7 seri). Birimler aynıysa ortak Y ekseni ('ortak'); birimler farklıysa
   * her seri kendi en az-en çok aralığında ölçeklenir ('bagimsiz'; Y yazısı yok, arayüz bunu söyler).
   * @param {{kimlik:string, noktalar:{t:number,d:any}[], birim?:string}[]} seriler
   * @param {object} [secenek]
   * @param {number} [secenek.genislik] viewBox genişliği
   * @param {number} [secenek.yukseklik] viewBox yüksekliği
   * @param {number} [secenek.bas] zaman ekseninin başı (ms); verilmezse verinin en erken noktası
   * @param {number} [secenek.bitis] zaman ekseninin sonu (ms); verilmezse verinin en geç noktası
   * @param {(t:number)=>string} [secenek.yaziX] zaman işareti yazısı
   * @param {(v:number)=>string} [secenek.yaziY] değer işareti yazısı (yalnız 'ortak' kipte)
   * @param {string} [secenek.etiket] erişilebilirlik etiketi
   * @param {number|((ms:number)=>number)} [secenek.kaymaMs] yerel saat farkı (ms): sabit sayı (testler için) ya da anına göre işlev
   * @returns {null | { betim: object, kip: 'ortak'|'bagimsiz', bas: number, bitis: number, bolge: object,
   *   seriler: {kimlik:string, ozet:object|null, sira:number}[], zamanX: (t:number)=>number, xZaman: (x:number)=>number,
   *   imlec: (x:number)=>{x:number,t:number,degerler:{kimlik:string,t:number|null,d:number|null}[]} }}
   */
  function karsilastirma(seriler, { genislik = 320, yukseklik = 180, bas, bitis, yaziX = String, yaziY = String, etiket = '', kaymaMs } = {}) {
    if (!Array.isArray(seriler)) return null;
    const girdi = seriler
      .slice(0, EN_COK_SERI)
      .map((s, sira) => ({ kimlik: String(s?.kimlik ?? ''), birim: typeof s?.birim === 'string' ? s.birim : '', noktalar: temizle(s?.noktalar), sira }));
    const verili = girdi.filter((s) => s.noktalar.some((n) => n.d !== null));
    if (verili.length === 0) return null;

    const tumT = verili.flatMap((s) => s.noktalar.map((n) => n.t));
    let t0 = sonluMu(bas) ? bas : Math.min(...tumT);
    let t1 = sonluMu(bitis) ? bitis : Math.max(...tumT);
    if (!(t1 > t0)) t1 = t0 + DAKIKA_MS;
    t0 = Math.floor(t0);
    const birimler = new Set(verili.map((s) => s.birim));
    const kip = birimler.size <= 1 ? 'ortak' : 'bagimsiz';

    const sol = kip === 'ortak' ? 38 : 8;
    const ust = 8;
    const sag = 8;
    const alt = 20;
    const en = genislik - sol - sag;
    const boy = yukseklik - ust - alt;
    const zamanX = (t) => sol + sinirla((t - t0) / (t1 - t0), 0, 1) * en;
    const xZaman = (x) => t0 + sinirla((x - sol) / en, 0, 1) * (t1 - t0);

    const ozetler = verili.map((s) => ({ ...s, ozet: ozet(s.noktalar) }));
    // Y ölçeği
    let ortakAralik = null;
    if (kip === 'ortak') {
      ortakAralik = guzelAralik(Math.min(...ozetler.map((s) => s.ozet.enAz)), Math.max(...ozetler.map((s) => s.ozet.enCok)));
    }
    const yOlcek = (s) => {
      if (ortakAralik) return (d) => ust + boy - ((d - ortakAralik.alt) / (ortakAralik.ust - ortakAralik.alt)) * boy;
      let lo = s.ozet.enAz;
      let hi = s.ozet.enCok;
      if (lo === hi) {
        lo -= 1;
        hi += 1;
      }
      return (d) => ust + boy - ((d - lo) / (hi - lo)) * boy;
    };

    const cocuklar = [];
    // ızgara + Y yazıları
    if (ortakAralik) {
      for (const v of ortakAralik.isaretler) {
        const y = ust + boy - ((v - ortakAralik.alt) / (ortakAralik.ust - ortakAralik.alt)) * boy;
        cocuklar.push(dugum('line', { class: 'grafik-izgara', x1: s1(sol), x2: s1(sol + en), y1: s1(y), y2: s1(y) }));
        cocuklar.push(dugum('text', { class: 'eksen eksen-y', x: s1(sol - 4), y: s1(y + 3), 'text-anchor': 'end' }, [], String(yaziY(v))));
      }
    } else {
      for (const oran of [0, 0.5, 1]) {
        const y = ust + boy - oran * boy;
        cocuklar.push(dugum('line', { class: 'grafik-izgara', x1: s1(sol), x2: s1(sol + en), y1: s1(y), y2: s1(y) }));
      }
    }
    // X işaretleri
    const isaretler = zamanIsaretleri(t0, t1, { en: genislik >= 280 ? 5 : 3, kaymaMs });
    for (const t of isaretler) {
      const x = zamanX(t);
      cocuklar.push(dugum('line', { class: 'grafik-izgara dikey', x1: s1(x), x2: s1(x), y1: s1(ust), y2: s1(ust + boy) }));
      cocuklar.push(dugum('text', { class: 'eksen eksen-x', x: s1(x), y: s1(ust + boy + 13), 'text-anchor': 'middle' }, [], String(yaziX(t))));
    }
    // seriler
    for (const s of ozetler) {
      const y = yOlcek(s);
      let d = '';
      const noktalar = [];
      // HA geçmişi, istek anındaki (pencere başından önceki) başlangıç durumunu da döndürür: son sayısal öncül nokta t0'a taşınır
      // (aksi halde pencere boyunca değişmeyen seri boş çizilir, değişen serinin ilk parçası eksik kalır). Kesintiyle (null) biten
      // öncül taşınmaz; özet/imleç/Y ölçeği özgün noktaları kullanır, istatistik değişmez.
      const icNoktalar = s.noktalar.filter((n) => n.t >= t0 && n.t <= t1);
      const oncul = s.noktalar.findLast((n) => n.t < t0);
      const tasindi = oncul !== undefined && oncul.d !== null && icNoktalar[0]?.t !== t0;
      if (tasindi) icNoktalar.unshift({ t: t0, d: oncul.d });
      // pencere boyunca hiç değişmeyen seri: tek daire yerine t0..t1 yatay çizgi
      if (tasindi && icNoktalar.length === 1) icNoktalar.push({ t: t1, d: oncul.d });
      for (const ic of parcala(icNoktalar)) {
        if (ic.length === 1) {
          noktalar.push(dugum('circle', { class: `nokta seri-${s.sira}`, cx: s1(zamanX(ic[0].t)), cy: s1(y(ic[0].d)), r: '2' }));
          continue;
        }
        d += `M${ic.map((n) => `${s1(zamanX(n.t))} ${s1(y(n.d))}`).join('L')}`;
      }
      if (d) {
        const a = { class: `cizgi seri-${s.sira}`, d, fill: 'none', 'data-kimlik': s.kimlik.length <= 120 ? s.kimlik.replace(/[^A-Za-z0-9_.]/g, '') || undefined : undefined };
        if (SERI_KESIK_DESENLERI[s.sira]) a['stroke-dasharray'] = SERI_KESIK_DESENLERI[s.sira];
        cocuklar.push(dugum('path', a));
      }
      cocuklar.push(...noktalar);
    }
    const betim = dugum(
      'svg',
      erisilebilir({ class: `grafik grafik-${kip}`, viewBox: `0 0 ${s1(genislik)} ${s1(yukseklik)}`, focusable: 'false' }, etiket),
      cocuklar,
    );

    const imlec = (x) => {
      const t = xZaman(x);
      return {
        x: zamanX(t),
        t,
        degerler: ozetler.map((s) => {
          const n = enYakin(s.noktalar, t);
          return { kimlik: s.kimlik, t: n ? n.t : null, d: n ? n.d : null };
        }),
      };
    };

    return {
      betim,
      kip,
      bas: t0,
      bitis: t1,
      bolge: { sol, ust, genislik: en, yukseklik: boy },
      seriler: ozetler.map((s) => ({ kimlik: s.kimlik, ozet: s.ozet, sira: s.sira, birim: s.birim })),
      zamanX,
      xZaman,
      imlec,
    };
  }

  return {
    SVG_AD_ALANI,
    EN_COK_SERI,
    temizle,
    parcala,
    ozet,
    enYakin,
    guzelAralik,
    zamanIsaretleri,
    svgOlustur,
    sparkline,
    gostergeOrani,
    gosterge,
    karsilastirma,
  };
});
