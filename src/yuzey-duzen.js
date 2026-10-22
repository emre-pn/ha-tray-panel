/*
 * Hızlı panel düzeni (renderer) — 1.4.0 düzen grubu (o-16, o-24, o-31). Köprü yok: bu dosya DOM'u yalnız yuzey-sayfa.js'in verdiği
 * yardımcılarla kurar (window.EvYuzeyDuzen.kur). Yüklenmezse panel bugünkü gibi sabit gruplarla çalışır.
 *
 *  - Sayfa sekmeleri (o-24): "Tümü" (bugünkü sabit gruplar) + ayardaki sayfalar. Ok tuşları / Home / End ya da Ctrl+PageUp / PageDown
 *    ile gezilir (rol: tablist / tab / tabpanel). Sayfa, favorilerin kendi sıralı alt kümesidir; yeni bir eylem yolu AÇMAZ.
 *  - Karo ayrıntı bölmesi (o-16): karoyu 500 ms basılı tutmak, Shift+Enter ya da küçük "Kontroller" düğmesi o karonun kontrollerini panel
 *    içinde açar (Esc / Geri ile kapanır). Yıkıcı (800 ms basılı tutma onaylı) ve tekrarlayan (ses -/+) karolarda ayrıntı bölmesi YOKTUR:
 *    basılı tutma orada zaten başka bir iş yapar. Başka gruplar alana özel kontrolleri `detayKaydet(alan, işlev)` ile bölmeye EKLER.
 *  - Sağ tık (o-16): yalnız varlık kimliği ana sürece gider (kopru.sagTik); menüyü ana süreç kurar. Burada menü yoktur.
 *  - Karo görünümü (o-31): simge (satır içi SVG ya da emoji; textContent / setAttribute, HTML ataması yok), renk ve boyut hazır sınıflardır
 *    (.renk-*, .boyut-*); satır içi stil yok (CSP).
 *
 * Tüm metin textContent ile yazılır. Bu dosya `require` kullanmaz; karo-gorunum.js (window.EvKaroGorunum) önce yüklenir.
 */
(function (kok) {
  'use strict';

  const Gorunum = kok.EvKaroGorunum || null;

  const TUMU = 'tumu';
  const SAYFA_KIMLIGI = /^[a-z0-9]{3,12}$/;
  const EN_COK_SAYFA = 12;
  const EN_COK_SAYFA_VARLIGI = 100;
  const SAYFA_AD_SINIRI = 24;
  const UZUN_BASMA_MS = 500;
  const HAREKET_ESIGI_PX = 10;
  const TIK_YUTMA_MS = 800;
  const SVG_AD_ALANI = 'http://www.w3.org/2000/svg';

  /**
   * Alana özel ayrıntı kontrolleri (alan -> işlev). Modül düzeyindedir: yuzey-duzen.js ile yuzey-sayfa.js arasında yüklenen başka bir
   * betik de `window.EvYuzeyDuzen.detayKaydet(alan, işlev)` ile kendi alanının (örn. 'climate', 'media_player') kontrolünü ekleyebilir.
   */
  const detaylar = Object.create(null);

  function detayKaydet(alan, islev) {
    if (typeof alan === 'string' && alan !== '' && typeof islev === 'function') detaylar[alan] = islev;
  }

  // ---------------------------------------------------------------- saf işlevler

  /** Ana süreçten gelen sayfa listesini temizler: { id, ad, kimlikler }. Geçersiz kayıtlar düşer. */
  function sayfalariDuzelt(ham) {
    if (!Array.isArray(ham)) return [];
    const sonuc = [];
    const gorulen = new Set();
    ham.forEach(function (s) {
      if (sonuc.length >= EN_COK_SAYFA || !s || typeof s !== 'object') return;
      if (typeof s.id !== 'string' || !SAYFA_KIMLIGI.test(s.id) || gorulen.has(s.id)) return;
      gorulen.add(s.id);
      const kimlikler = (Array.isArray(s.kimlikler) ? s.kimlikler : [])
        .filter(function (k) {
          return typeof k === 'string' && k.length > 0 && k.length <= 120;
        })
        .slice(0, EN_COK_SAYFA_VARLIGI);
      sonuc.push({ id: s.id, ad: String(s.ad === undefined || s.ad === null ? '' : s.ad).slice(0, SAYFA_AD_SINIRI), kimlikler: kimlikler });
    });
    return sonuc;
  }

  /** Sekme sırası: "Tümü" ve ardından sayfalar. */
  function sekmeKimlikleri(sayfalar) {
    return [TUMU].concat(
      sayfalar.map(function (s) {
        return s.id;
      }),
    );
  }

  /** İstenen sayfa yoksa (silinmiş) "Tümü". */
  function sayfaGecerli(sayfalar, istenen) {
    return istenen !== TUMU &&
      sayfalar.some(function (s) {
        return s.id === istenen;
      })
      ? istenen
      : TUMU;
  }

  /** Klavyeyle sekme gezintisi (sarmalı): ok tuşları, Home, End; ayrıca 'sonraki' / 'onceki'. Tanınmayan tuş için null. */
  function sekmeSec(sayfalar, secili, tus) {
    const sira = sekmeKimlikleri(sayfalar);
    const i = Math.max(0, sira.indexOf(secili));
    switch (tus) {
      case 'ArrowRight':
      case 'sonraki':
        return sira[(i + 1) % sira.length];
      case 'ArrowLeft':
      case 'onceki':
        return sira[(i - 1 + sira.length) % sira.length];
      case 'Home':
        return sira[0];
      case 'End':
        return sira[sira.length - 1];
      default:
        return null;
    }
  }

  /** Sayfanın karoları SAYFANIN sırasıyla; modelde olmayan (süzülmüş ya da artık favori olmayan) kimlikler atlanır. */
  function sayfaKarolari(sayfa, karolar) {
    const harita = new Map();
    karolar.forEach(function (k) {
      harita.set(k.id, k);
    });
    const sonuc = [];
    const gorulen = new Set();
    sayfa.kimlikler.forEach(function (kimlik) {
      const karo = harita.get(kimlik);
      if (karo && !gorulen.has(kimlik)) {
        gorulen.add(kimlik);
        sonuc.push(karo);
      }
    });
    return sonuc;
  }

  /** Karonun ızgarada kapladığı sütun sayısı (1 / 2 / 3). */
  function sutunSayisi(karo) {
    return (Gorunum && Gorunum.BOYUT_SUTUNU[karo.boyut]) || 1;
  }

  /** Ayrıntı bölmesi / uzun basma desteklenir mi: yıkıcı (basılı tutma onayı) ve tekrarlayan karolar hariç. */
  function kontrolDestekliMi(karo) {
    return !karo.yikici && !karo.tekrar;
  }

  /**
   * 500 ms basılı tutma algılayıcısı. basla(olay) sayacı kurar; birak() ya da eşiği aşan hareket iptal eder; süre dolunca `tamam` çağrılır.
   * @param {{sureMs?: number, esikPx?: number, zaman: {setTimeout: Function, clearTimeout: Function}, tamam: Function}} bag
   */
  function uzunBasmaOlustur(bag) {
    const sureMs = bag.sureMs || UZUN_BASMA_MS;
    const esikPx = bag.esikPx || HAREKET_ESIGI_PX;
    let sayac = null;
    let x = 0;
    let y = 0;
    let tetiklendi = false;
    function iptal() {
      if (sayac !== null) {
        bag.zaman.clearTimeout(sayac);
        sayac = null;
      }
    }
    return {
      basla: function (olay) {
        iptal();
        tetiklendi = false;
        x = olay && typeof olay.clientX === 'number' ? olay.clientX : 0;
        y = olay && typeof olay.clientY === 'number' ? olay.clientY : 0;
        sayac = bag.zaman.setTimeout(function () {
          sayac = null;
          tetiklendi = true;
          bag.tamam();
        }, sureMs);
      },
      hareket: function (olay) {
        if (sayac === null || !olay || typeof olay.clientX !== 'number' || typeof olay.clientY !== 'number') return;
        if (Math.hypot(olay.clientX - x, olay.clientY - y) > esikPx) iptal();
      },
      birak: iptal,
      aktifMi: function () {
        return sayac !== null;
      },
      tetiklendiMi: function () {
        return tetiklendi;
      },
    };
  }

  /**
   * Simge düğümü: çizgi ikon satır içi SVG (createElementNS + setAttribute; CSP'ye uygun, HTML ataması yok) ya da emoji metni.
   * Çözülemeyen simge ya da SVG desteklemeyen ortam için null.
   */
  function simgeDugumu(belge, simge) {
    if (!Gorunum || !belge) return null;
    const c = Gorunum.simgeCoz(simge);
    if (!c) return null;
    const kap = belge.createElement('span');
    kap.className = 'karo-simge ' + (c.tur === 'ikon' ? 'ikon' : 'emoji');
    kap.setAttribute('aria-hidden', 'true'); // süs: karonun adı ve durumu okunur
    if (c.tur === 'emoji') {
      kap.textContent = c.metin;
      return kap;
    }
    if (typeof belge.createElementNS !== 'function') return null;
    const svg = belge.createElementNS(SVG_AD_ALANI, 'svg');
    svg.setAttribute('viewBox', Gorunum.SVG_GORUNUM_KUTUSU);
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    const yol = belge.createElementNS(SVG_AD_ALANI, 'path');
    yol.setAttribute('d', c.yol);
    svg.appendChild(yol);
    kap.appendChild(svg);
    return kap;
  }

  // ---------------------------------------------------------------- denetleyici

  /**
   * @param {object} ortak yuzey-sayfa.js'in verdiği yardımcılar:
   *   belge, kopru, sekmeKabi, icerik, cevir(anahtar, değişkenler), dil(), modAl(), olustur(etiket, sinif, metin), durumMetni(karo),
   *   karoDugmesi(karo), isikKarosu(karo, detaydaMi), odakKaydet(anahtar, öge), imlecBirakildi(), yenidenCiz(), simdi(), zaman { setTimeout, clearTimeout }
   *   (cevir ve dil, dil değişince güncel çevirmeni kullanır: değer olarak saklanmaz)
   */
  function kur(ortak) {
    let seciliSayfa = TUMU;
    let ayrintiKimligi = null;
    let tikYutma = null; // { kimlik, bitis }
    let odakIstegi = null; // bir sonraki panel çiziminde odak verilecek anahtar
    let sekmeOdagi = null; // klavyeyle seçilen sekme: yeniden kurulunca odak ona verilir
    let sekmeImzasi = '';
    let sekmeDugmeleri = {}; // sekme kimliği -> düğme
    const t = function (anahtar, degiskenler) {
      return ortak.cevir(anahtar, degiskenler);
    };

    function sekmeleriGizle() {
      ortak.sekmeKabi.hidden = true;
      if (sekmeImzasi !== '') ortak.sekmeKabi.replaceChildren();
      sekmeImzasi = '';
      sekmeDugmeleri = {};
      ortak.icerik.removeAttribute('aria-labelledby');
      if (ortak.icerik.getAttribute('role') === 'tabpanel') ortak.icerik.removeAttribute('role');
    }

    function sayfaSec(id, odakVer) {
      const degisti = id !== seciliSayfa || ayrintiKimligi !== null;
      seciliSayfa = id;
      ayrintiKimligi = null;
      if (odakVer) sekmeOdagi = id;
      if (degisti || odakVer) ortak.yenidenCiz();
    }

    /** Pencere gösterilirken (palet "sayfa" satırından gelen istek): seçili sayfa çizim istemeden ayarlanır; geçersizse çizimde "Tümü"ne döner. */
    function sayfayiAyarla(id) {
      seciliSayfa = typeof id === 'string' ? id : TUMU;
      ayrintiKimligi = null;
    }

    function odakSekmeye() {
      const id = sekmeOdagi;
      sekmeOdagi = null;
      const d = id === null ? null : sekmeDugmeleri[id];
      if (d && typeof d.focus === 'function') d.focus();
    }

    /** Sekme çubuğu: sayfa yoksa ya da palet kipinde gizli. İmza değişmezse yeniden kurulmaz (odak / fare durumu bozulmasın). */
    function sekmeleriCiz(model) {
      const sayfalar = model.sayfalar || [];
      if (ortak.modAl() !== 'panel' || sayfalar.length === 0) {
        sekmeleriGizle();
        return;
      }
      seciliSayfa = sayfaGecerli(sayfalar, seciliSayfa);
      const imza = JSON.stringify([
        ortak.dil(),
        seciliSayfa,
        sayfalar.map(function (s) {
          return [s.id, s.ad];
        }),
      ]);
      ortak.icerik.setAttribute('role', 'tabpanel');
      ortak.icerik.setAttribute('aria-labelledby', 'sekme-' + seciliSayfa);
      ortak.sekmeKabi.hidden = false;
      if (imza === sekmeImzasi) {
        if (sekmeOdagi !== null) odakSekmeye();
        return;
      }
      sekmeImzasi = imza;
      sekmeDugmeleri = {};
      ortak.sekmeKabi.setAttribute('role', 'tablist');
      ortak.sekmeKabi.setAttribute('aria-label', t('yuzey.sekme.etiket'));
      const dugmeler = sekmeKimlikleri(sayfalar).map(function (id, sira) {
        const sayfa = sayfalar.find(function (s) {
          return s.id === id;
        });
        const secili = id === seciliSayfa;
        const ad = id === TUMU ? t('yuzey.sekme.tumu') : sayfa.ad || String(sira); // adsız sayfaya ana süreç "Sayfa N" yazar
        const d = ortak.olustur('button', 'sekme' + (secili ? ' secili' : ''), ad);
        d.type = 'button';
        d.id = 'sekme-' + id;
        d.setAttribute('role', 'tab');
        d.setAttribute('aria-selected', secili ? 'true' : 'false');
        d.setAttribute('aria-controls', 'icerik');
        d.tabIndex = secili ? 0 : -1; // tek durak: sekmeler arasında oklarla gezilir
        d.addEventListener('click', function () {
          sayfaSec(id, false);
        });
        d.addEventListener('keydown', function (olay) {
          if (olay.altKey || olay.ctrlKey || olay.metaKey || olay.shiftKey) return;
          const hedef = sekmeSec(sayfalar, seciliSayfa, olay.key);
          if (hedef === null) return;
          olay.preventDefault();
          sayfaSec(hedef, true);
        });
        sekmeDugmeleri[id] = d;
        return d;
      });
      ortak.sekmeKabi.replaceChildren.apply(ortak.sekmeKabi, dugmeler);
      if (sekmeOdagi !== null) odakSekmeye();
    }

    /** Panel kipinde Ctrl+PageUp / Ctrl+PageDown: sayfalar arasında geç. @returns {boolean} olay işlendi */
    function sekmeTusu(olay, model) {
      const sayfalar = model.sayfalar || [];
      if (ortak.modAl() !== 'panel' || sayfalar.length === 0 || !olay.ctrlKey || olay.altKey || olay.metaKey || olay.shiftKey) return false;
      if (olay.key !== 'PageDown' && olay.key !== 'PageUp') return false;
      olay.preventDefault();
      sayfaSec(sekmeSec(sayfalar, sayfaGecerli(sayfalar, seciliSayfa), olay.key === 'PageDown' ? 'sonraki' : 'onceki'), false);
      return true;
    }

    /** Seçili sayfa: "Tümü" (ya da hiç sayfa yok) için null -> bugünkü sabit gruplar; aksi halde { id, ad, karolar } (sayfanın sırasıyla). */
    function secilenSayfa(model, tumKarolar) {
      const sayfalar = model.sayfalar || [];
      seciliSayfa = sayfaGecerli(sayfalar, seciliSayfa);
      if (ortak.modAl() !== 'panel' || sayfalar.length === 0 || seciliSayfa === TUMU) return null;
      const sayfa = sayfalar.find(function (s) {
        return s.id === seciliSayfa;
      });
      return { id: sayfa.id, ad: sayfa.ad, karolar: sayfaKarolari(sayfa, tumKarolar) };
    }

    // ---- ayrıntı bölmesi

    function ayrintiAc(karo) {
      if (!kontrolDestekliMi(karo)) return;
      ayrintiKimligi = karo.id;
      odakIstegi = 'ayrinti-geri';
      ortak.yenidenCiz();
    }

    function ayrintiKapat() {
      if (ayrintiKimligi === null) return;
      odakIstegi = 'k:' + ayrintiKimligi;
      ayrintiKimligi = null;
      ortak.yenidenCiz();
    }

    /** Açık ayrıntı bölmesinin karosu (modelde yoksa bölme kapanır ve null döner). */
    function ayrintiKaro(tumKarolar) {
      if (ayrintiKimligi === null) return null;
      const karo = tumKarolar.find(function (k) {
        return k.id === ayrintiKimligi;
      });
      if (!karo || !kontrolDestekliMi(karo)) {
        ayrintiKimligi = null;
        return null;
      }
      return karo;
    }

    /**
     * Ayrıntı bölmesi: üstte "← Geri", karo adı ve durumu; altta karonun temel kontrolü (ışıkta parlaklık, tek tıklama eylemi olan karoda
     * ana düğme, yalnız durum karosunda kısa not) ve ardından `detayKaydet(alan, ...)` ile eklenen alana özel kontroller.
     */
    function ayrintiCiz(karo) {
      const bolum = ortak.olustur('section', 'ayrinti');
      bolum.setAttribute('aria-label', t('yuzey.ayrinti.etiket', { etiket: karo.etiket }));
      const ust = ortak.olustur('div', 'ayrinti-ust');
      const geri = ortak.olustur('button', 'ayrinti-geri');
      geri.type = 'button';
      const ok = ortak.olustur('span', '', '←');
      ok.setAttribute('aria-hidden', 'true');
      geri.appendChild(ok);
      geri.appendChild(ortak.olustur('span', '', ' ' + t('yuzey.ayrinti.geri')));
      geri.addEventListener('click', ayrintiKapat);
      ortak.odakKaydet('ayrinti-geri', geri);
      ust.appendChild(geri);
      ust.appendChild(ortak.olustur('span', 'ayrinti-baslik', karo.etiket));
      ust.appendChild(ortak.olustur('span', 'ayrinti-durum', ortak.durumMetni(karo)));
      const menu = ortak.olustur('button', 'ayrinti-menu');
      menu.type = 'button';
      menu.title = t('yuzey.ayrinti.menu');
      menu.setAttribute('aria-label', t('yuzey.ayrinti.menu'));
      const nokta = ortak.olustur('span', '', '⋯');
      nokta.setAttribute('aria-hidden', 'true');
      menu.appendChild(nokta);
      menu.addEventListener('click', function () {
        sagTikIste(karo);
      });
      ortak.odakKaydet('ayrinti-menu', menu);
      ust.appendChild(menu);
      bolum.appendChild(ust);
      const govde = ortak.olustur('div', 'ayrinti-govde');
      if (karo.parlaklikKontrol) {
        govde.appendChild(ortak.isikKarosu(karo, true));
      } else if (karo.varsayilanEylem !== false) {
        govde.appendChild(ortak.karoDugmesi(karo));
      } else {
        govde.appendChild(ortak.olustur('p', 'ayrinti-not', t('yuzey.ayrinti.yalnizDurum')));
      }
      const ozel = detaylar[karo.alan];
      if (typeof ozel === 'function') {
        try {
          ozel(karo, govde, ortak);
        } catch (hata) {
          /* alana özel kontrol çizilemedi: temel kontrol ve geri düğmesi yine çalışır */
        }
      }
      bolum.appendChild(govde);
      return bolum;
    }

    // ---- karo görünümü ve etkileşim

    /** Karo düğmesine renk sınıfı ve simge (etiketten ÖNCE çağrılır: simge ilk çocuk olur). Boyut `karoyuSar` ile verilir. */
    /** `simgeKabi` (2.0): simgenin konacağı öğe (karonun yuvarlak "madeni"si); verilmezse simge düğmeye eklenir. */
    function gorunumuUygula(karo, dugme, simgeKabi) {
      if (karo.renk) dugme.classList.add('renk-' + karo.renk);
      const simge = karo.simge ? simgeDugumu(ortak.belge, karo.simge) : null;
      if (simge) {
        dugme.classList.add('simgeli');
        (simgeKabi || dugme).appendChild(simge);
      }
    }

    function sagTikIste(karo) {
      if (!ortak.kopru || typeof ortak.kopru.sagTik !== 'function') return;
      Promise.resolve(ortak.kopru.sagTik(karo.id)).catch(function () {
        /* menü açılamadı; sessiz */
      });
    }

    /** Uzun basma ayrıntıyı az önce açtıysa (dokunmatikte aynı basış bağlam menüsü olayı da üretir) tıklama / menü olayı yutulur. */
    function yutulmaliMi(kimlik) {
      return !!tikYutma && tikYutma.kimlik === kimlik && ortak.simdi() < tikYutma.bitis;
    }

    function sagTikBagla(karo, oge) {
      oge.addEventListener('contextmenu', function (olay) {
        olay.preventDefault();
        ortak.imlecBirakildi(); // menü fare bırakmasını yutabilir: basılı sayılan durum sıfırlanır
        if (yutulmaliMi(karo.id)) return;
        sagTikIste(karo);
      });
    }

    /** Tıklama, uzun basmadan hemen sonra geldiyse yutulur (ışık uzun basmayla açılıp kapanmasın). */
    function tikiYut(kimlik) {
      if (!tikYutma || tikYutma.kimlik !== kimlik) return false;
      const yut = ortak.simdi() < tikYutma.bitis;
      tikYutma = null;
      return yut;
    }

    function uzunBasmaBagla(karo, dugme) {
      const algilayici = uzunBasmaOlustur({
        zaman: ortak.zaman,
        tamam: function () {
          dugme.classList.remove('uzun-basma');
          tikYutma = { kimlik: karo.id, bitis: ortak.simdi() + TIK_YUTMA_MS };
          ayrintiAc(karo);
        },
      });
      dugme.addEventListener('pointerdown', function (olay) {
        if (olay.button !== 0 && olay.button !== undefined) return;
        dugme.classList.add('uzun-basma'); // sessiz görsel ipucu (CSS 150 ms gecikmeli: kısa tıklamada görünmez)
        algilayici.basla(olay);
      });
      dugme.addEventListener('pointermove', algilayici.hareket);
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ad) {
        dugme.addEventListener(ad, function () {
          dugme.classList.remove('uzun-basma');
          algilayici.birak();
        });
      });
    }

    /** Shift+Enter: klavyeyle ayrıntı bölmesi. */
    function klavyeBagla(karo, dugme) {
      dugme.addEventListener('keydown', function (olay) {
        if (olay.key !== 'Enter' || !olay.shiftKey || olay.ctrlKey || olay.altKey || olay.metaKey || olay.repeat) return;
        olay.preventDefault();
        ayrintiAc(karo);
      });
    }

    /**
     * Sarmasız düğmeyi (ışık karosunun ana düğmesi gibi) ayrıntı etkileşimlerine bağlar: uzun basma, Shift+Enter ve sağ tık
     * (`kapsayici`: menü olayını dinleyen ve "⋯" düğmesini alan öğe). Desteklenmeyen (yıkıcı / tekrarlayan) karoda yalnız sağ tık bağlanır.
     */
    function karoyuBagla(karo, dugme, kapsayici) {
      sagTikBagla(karo, kapsayici || dugme);
      if (!kontrolDestekliMi(karo)) return;
      uzunBasmaBagla(karo, dugme);
      klavyeBagla(karo, dugme);
      if (kapsayici) {
        kapsayici.classList.add('kontrollu');
        kapsayici.appendChild(kontrolDugmesi(karo));
      }
    }

    /** Karonun köşesindeki küçük "⋯" düğmesi: ayrıntı bölmesini açar. Fare ve ekran okuyucu içindir; klavye yolu Shift+Enter'dır (tabIndex -1). */
    function kontrolDugmesi(karo) {
      const k = ortak.olustur('button', 'karo-kontrol');
      k.type = 'button';
      k.tabIndex = -1;
      const ad = t('yuzey.karo.kontrollerAc', { etiket: karo.etiket });
      k.title = ad;
      k.setAttribute('aria-label', ad);
      const nokta = ortak.olustur('span', '', '⋯');
      nokta.setAttribute('aria-hidden', 'true');
      k.appendChild(nokta);
      k.addEventListener('click', function () {
        ayrintiAc(karo);
      });
      return k;
    }

    /**
     * Izgara karosunu sarar: boyut sınıfı (sütun kaplama), "Kontroller" düğmesi, uzun basma, Shift+Enter ve sağ tık.
     * Yıkıcı / tekrarlayan karoda sarma ve ayrıntı yoktur; yalnız boyut ve sağ tık uygulanır.
     * @returns {{kutu: object, dugme: object}} kutu: ızgaraya eklenecek öğe; dugme: odak / ok gezintisi öğesi
     */
    function karoyuSar(karo, dugme) {
      const boyutSinifi = karo.boyut && karo.boyut !== 'normal' ? 'boyut-' + karo.boyut : '';
      if (!kontrolDestekliMi(karo)) {
        if (boyutSinifi) dugme.classList.add(boyutSinifi);
        sagTikBagla(karo, dugme);
        return { kutu: dugme, dugme: dugme };
      }
      const kutu = ortak.olustur('div', 'karo-sarma' + (boyutSinifi ? ' ' + boyutSinifi : ''));
      kutu.appendChild(dugme);
      kutu.appendChild(kontrolDugmesi(karo));
      uzunBasmaBagla(karo, dugme);
      klavyeBagla(karo, dugme);
      sagTikBagla(karo, kutu);
      return { kutu: kutu, dugme: dugme };
    }

    return {
      seciliSayfa: secilenSayfa,
      sayfaSec: sayfaSec,
      sayfayiAyarla: sayfayiAyarla,
      sekmeleriCiz: sekmeleriCiz,
      sekmeTusu: sekmeTusu,
      sutunSayisi: sutunSayisi,
      gorunumuUygula: gorunumuUygula,
      karoyuSar: karoyuSar,
      karoyuBagla: karoyuBagla,
      sagTikBagla: sagTikBagla,
      tikiYut: tikiYut,
      ayrintiAc: ayrintiAc,
      ayrintiKapat: ayrintiKapat,
      ayrintiAcikMi: function () {
        return ayrintiKimligi !== null;
      },
      ayrintiKaro: ayrintiKaro,
      ayrintiCiz: ayrintiCiz,
      /** Panel çiziminden sonra odak verilecek anahtar (bir kez). */
      odakIstegiAl: function () {
        const a = odakIstegi;
        odakIstegi = null;
        return a;
      },
      /** Pencere yeniden gösterildi: ayrıntı kapanır, seçili sayfa korunur. */
      sifirla: function () {
        ayrintiKimligi = null;
        odakIstegi = null;
        tikYutma = null;
      },
      /** Dil değişti: sekme metinleri yeniden yazılsın. */
      dilDegisti: function () {
        sekmeImzasi = '';
      },
      /** Başka gruplar: alana özel ayrıntı kontrolleri. islev(karo, kap, ortak) kap'a öğe ekler (temel kontrolden sonra). Modül kaydıyla aynıdır. */
      detayKaydet: detayKaydet,
    };
  }

  kok.EvYuzeyDuzen = {
    TUMU: TUMU,
    UZUN_BASMA_MS: UZUN_BASMA_MS,
    TIK_YUTMA_MS: TIK_YUTMA_MS,
    sayfalariDuzelt: sayfalariDuzelt,
    sekmeKimlikleri: sekmeKimlikleri,
    sayfaGecerli: sayfaGecerli,
    sekmeSec: sekmeSec,
    sayfaKarolari: sayfaKarolari,
    sutunSayisi: sutunSayisi,
    kontrolDestekliMi: kontrolDestekliMi,
    uzunBasmaOlustur: uzunBasmaOlustur,
    simgeDugumu: simgeDugumu,
    detayKaydet: detayKaydet,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
