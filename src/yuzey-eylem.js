/*
 * Hızlı panel eylem bölümü (renderer) — 1.4.0 eylem grubu (o-12 geri al, o-15 bekleyen gecikmeli eylemler, o-14 odalar, o-18/o-46 palet).
 * Köprü yok: bu dosya DOM'u yalnız yuzey-sayfa.js'in verdiği öğelerle ve köprü işleviyle (window.evYuzey) kurar. Yüklenmezse panel
 * bugünkü gibi çalışır.
 *
 *  - Model (model.eylem): ana süreç beyaz listeli bölümü gönderir (src/lib/eylem-modeli.js); burada yine doğrulanır (modelDuzelt).
 *  - Geri al (o-12): alt şeritteki "Geri al" düğmesi yalnız geri alınacak bir girdi varken görünür. Tıklama ana sürece yük OLMADAN
 *    "geri al" der; neyin geri alınacağını ana süreç bilir. Süresi dolan girdi (model güncellenmese bile) düğmeyi gizler.
 *  - Zamanlı eylemler (o-15): bekleyenler ("Salon lambası · 14:32 kapanır") alt şeridin üstünde küçük bir şeritte durur; her birinin ×
 *    düğmesi eylemi iptal eder. Yük yalnız modeldeki opak kimliktir (g<n>); varlık kimliği sayfaya hiç gelmez.
 *  - Son değişenler (o-18): model.eylem.degisenler palette "@" yazınca listelenir (yuzey-sayfa.js); burada yalnız doğrulanır ve "3 dk önce" metni üretilir.
 *  - Odayı kapat (o-14): odaya göre gruplamada her oda grubunun başlığında bir düğme çıkar. İki adımlıdır (ilk tıklama "Emin misin?" der, 4 sn içinde
 *    ikinci tıklama gönderir); yük yalnız grup kodudur (oda-<8 onaltılık>). Açık cihaz sayısı yalnız gösterimdir: üyeleri ana süreç yeniden hesaplar.
 *
 * Tüm metin textContent / setAttribute ile yazılır (HTML ataması yok). Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  const EN_COK_GERI_AL = 5;
  const EN_COK_GECIKMELI = 10;
  const AD_SINIRI = 60;
  const GECIKMELI_KIMLIK_DESENI = /^g\d{1,9}$/;
  const EN_COK_DEGISEN = 20;
  const DEGISEN_ALANLARI = ['light', 'switch', 'scene', 'climate', 'media_player'];
  const DEGISEN_TURLERI = ['acildi', 'kapandi', 'calisti', 'degisti'];
  const VARLIK_DESENI = /^[a-z_]{1,30}\.[a-z0-9_]{1,100}$/;
  const ODA_KODU_DESENI = /^oda-[0-9a-f]{8}$/;
  const ODA_KAPAT_ALANLARI = ['light', 'switch', 'fan', 'input_boolean', 'humidifier']; // ana süreçteki oda-gruplari.js listesiyle aynı
  const ODA_ONAY_MS = 4000;

  const sonluSayi = function (d) {
    return typeof d === 'number' && isFinite(d);
  };

  // ---------------------------------------------------------------- saf işlevler

  /** Geri al özeti: { adet: 1..5, ad, bitis (ms, mutlak) } ya da null. */
  function geriAlDuzelt(ham) {
    if (!ham || typeof ham !== 'object') return null;
    if (!Number.isInteger(ham.adet) || ham.adet < 1 || !sonluSayi(ham.bitis) || ham.bitis <= 0) return null;
    return { adet: Math.min(ham.adet, EN_COK_GERI_AL), ad: String(ham.ad === undefined || ham.ad === null ? '' : ham.ad).slice(0, AD_SINIRI), bitis: Math.floor(ham.bitis) };
  }

  /** Bekleyen zamanlı eylemler: [{ id: 'g<n>', ad, yon: 'ac'|'kapat', bitis }], en çok 10, en yakın önde. */
  function gecikmeliDuzelt(ham) {
    if (!Array.isArray(ham)) return [];
    const sonuc = [];
    for (let i = 0; i < ham.length && sonuc.length < EN_COK_GECIKMELI; i += 1) {
      const o = ham[i];
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !GECIKMELI_KIMLIK_DESENI.test(o.id)) continue;
      if ((o.yon !== 'ac' && o.yon !== 'kapat') || !sonluSayi(o.bitis) || o.bitis <= 0) continue;
      sonuc.push({ id: o.id, ad: String(o.ad === undefined || o.ad === null ? '' : o.ad).slice(0, AD_SINIRI), yon: o.yon, bitis: Math.floor(o.bitis) });
    }
    return sonuc.sort(function (a, b) {
      return a.bitis - b.bitis;
    });
  }

  /** Son değişenler (o-18): [{ kimlik, ad, alan, tur, zaman }], en yeni üstte, en çok 20. */
  function degisenDuzelt(ham) {
    if (!Array.isArray(ham)) return [];
    const sonuc = [];
    for (let i = 0; i < ham.length && sonuc.length < EN_COK_DEGISEN; i += 1) {
      const o = ham[i];
      if (!o || typeof o !== 'object' || typeof o.kimlik !== 'string' || !VARLIK_DESENI.test(o.kimlik)) continue;
      if (DEGISEN_ALANLARI.indexOf(o.alan) < 0 || o.kimlik.indexOf(o.alan + '.') !== 0 || DEGISEN_TURLERI.indexOf(o.tur) < 0 || !sonluSayi(o.zaman) || o.zaman <= 0) continue;
      sonuc.push({ kimlik: o.kimlik, ad: String(o.ad === undefined || o.ad === null ? '' : o.ad).slice(0, AD_SINIRI), alan: o.alan, tur: o.tur, zaman: Math.floor(o.zaman) });
    }
    return sonuc.sort(function (a, b) {
      return b.zaman - a.zaman;
    });
  }

  /** Ana süreçten gelen eylem bölümünü temizler. Bozuk ya da eksik bölüm: hiçbir özellik gösterilmez. */
  function modelDuzelt(ham) {
    const m = ham && typeof ham === 'object' ? ham : {};
    return { geriAl: geriAlDuzelt(m.geriAl), gecikmeli: gecikmeliDuzelt(m.gecikmeli), degisenler: degisenDuzelt(m.degisenler), degisenAcik: m.degisenAcik === true };
  }

  /** Dakikayı kısa süre metnine çevirir ("10 dk", "2 sa", "1 sa 30 dk"); cevir: (anahtar, değişkenler) => metin. */
  function sureMetni(dakika, cevir) {
    const d = Math.max(0, Math.floor(Number(dakika) || 0));
    if (d < 60) return cevir('yuzey.sure.dk', { n: d });
    const sa = Math.floor(d / 60);
    const dk = d % 60;
    return dk === 0 ? cevir('yuzey.sure.sa', { n: sa }) : cevir('yuzey.sure.saDk', { sa: sa, dk: dk });
  }

  /** Geçen süreyi "az önce", "3 dk önce", "2 sa önce", "1 gün önce" metnine çevirir (cevir: (anahtar, değişkenler) => metin). */
  function oncekiMetni(farkMs, cevir) {
    const dk = Math.floor(Math.max(0, Number(farkMs) || 0) / 60000);
    if (dk < 1) return cevir('yuzey.degisen.azOnce', {});
    if (dk < 60) return cevir('yuzey.degisen.dkOnce', { n: dk });
    if (dk < 1440) return cevir('yuzey.degisen.saOnce', { n: Math.floor(dk / 60) });
    return cevir('yuzey.degisen.gunOnce', { n: Math.min(99, Math.floor(dk / 1440)) });
  }

  /** Oda grubunda şu an AÇIK olan, "odayı kapat"ın kapsayabileceği karo sayısı (yalnız gösterim; kesin üyeleri ana süreç hesaplar). */
  function odaAcikSayisi(grup) {
    if (!grup || !Array.isArray(grup.karolar)) return 0;
    return grup.karolar.filter(function (k) {
      return k && k.durum === 'acik' && ODA_KAPAT_ALANLARI.indexOf(k.alan) >= 0 && k.yikici !== true && k.ulasilamiyor !== true;
    }).length;
  }

  // ---------------------------------------------------------------- denetleyici

  /**
   * @param {object} bag
   * @param {object} bag.kopru window.evYuzey (geriAl işlevi isteğe bağlı: yoksa düğme hiç görünmez)
   * @param {{geriAl: HTMLElement, gecikmeli?: HTMLElement}} bag.el alt şerit düğmesi ve (isteğe bağlı) zamanlı eylemler şeridi
   * @param {(ms: number) => string} [bag.saatMetni] bitiş saatinin metni (kullanıcının dili / biçimi)
   * @param {(anahtar: string, degiskenler?: object) => string} bag.cevir çevirmen (dil değişince güncel olanı döner)
   * @param {() => number} bag.simdi
   * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman] "Odayı kapat" onay süresi için
   * @param {(metin: string) => void} [bag.ipucu] kısa ipucu satırı (odayı kapat hatası)
   * @param {() => void} [bag.odakYedek] odaktaki "Geri al" / zamanlı eylem × düğmesi kalkınca odağı sayfaya geri verir (gövdeye düşmesin)
   */
  function kur(bag) {
    const kopru = bag.kopru;
    const el = bag.el;
    const t = bag.cevir;
    const simdi = bag.simdi || function () { return Date.now(); };
    const saatMetni = bag.saatMetni || function (ms) {
      try {
        return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (hata) {
        return '';
      }
    };
    if (!kopru || !el || !el.geriAl) return null;
    let eylem = modelDuzelt(null);
    let bekliyor = false;
    let seritImzasi = null;
    let seritDugmeleri = []; // şeritteki güncel × düğmeleri (odak kurtarma için)

    /** Odak, kalkmak üzere olan bir düğmedeyken çağrılır: değişiklikten sonra odak hâlâ eski düğmede (ya da gövdede) ise yedek hedefe geçer. */
    function odagiKurtar(odakliydi, hala) {
      if (odakliydi && !hala() && typeof bag.odakYedek === 'function') bag.odakYedek();
    }

    /** Zamanlı eylemler şeridi: bekleyen yoksa gizli; her öğede iptal düğmesi. Değişmeyen şerit yeniden kurulmaz (odak kaybolmasın). */
    function seritCiz() {
      const kap = el.gecikmeli;
      if (!kap) return;
      const simdiMs = simdi();
      const liste = typeof kopru.gecikmeliIptal === 'function' ? eylem.gecikmeli.filter(function (o) { return o.bitis > simdiMs; }) : [];
      const imza = t('yuzey.gecikmeli.baslik') + '|' + JSON.stringify(liste);
      if (imza === seritImzasi) return;
      seritImzasi = imza;
      const belge = kap.ownerDocument || kok.document;
      const odakliydi = seritDugmeleri.indexOf(belge.activeElement) >= 0;
      kap.hidden = liste.length === 0;
      const yeniDugmeler = [];
      const parcalar = liste.map(function (o) {
        const oge = belge.createElement('span');
        oge.className = 'gecikmeli-oge';
        const metin = belge.createElement('span');
        metin.className = 'gecikmeli-metin';
        metin.textContent = t(o.yon === 'ac' ? 'yuzey.gecikmeli.ac' : 'yuzey.gecikmeli.kapat', { ad: o.ad, saat: saatMetni(o.bitis) });
        const iptal = belge.createElement('button');
        iptal.className = 'gecikmeli-iptal';
        iptal.type = 'button';
        iptal.textContent = '×';
        const aciklama = t('yuzey.gecikmeli.iptal', { ad: o.ad });
        iptal.title = aciklama;
        iptal.setAttribute('aria-label', aciklama);
        iptal.addEventListener('click', function () {
          iptal.disabled = true;
          Promise.resolve()
            .then(function () {
              return kopru.gecikmeliIptal(o.id);
            })
            .then(
              function () {
                iptal.disabled = false; // başarıda model güncellemesi öğeyi kaldırır
              },
              function () {
                iptal.disabled = false;
              },
            );
        });
        oge.appendChild(metin);
        oge.appendChild(iptal);
        yeniDugmeler.push(iptal);
        return oge;
      });
      seritDugmeleri = yeniDugmeler;
      kap.replaceChildren.apply(kap, parcalar);
      odagiKurtar(odakliydi, function () {
        return seritDugmeleri.indexOf(belge.activeElement) >= 0;
      });
    }

    /** Alt şerit düğmesi: görünürlük, etiket ve ipucu. Palet kipinde alt şerit zaten gizlidir (CSS). */
    function ciz(yeni) {
      if (yeni !== undefined) eylem = yeni || modelDuzelt(null);
      seritCiz();
      const g = eylem.geriAl;
      const gorunur = typeof kopru.geriAl === 'function' && g !== null && g.bitis > simdi();
      const geriAlBelge = el.geriAl.ownerDocument || kok.document;
      const geriAlOdakta = geriAlBelge.activeElement === el.geriAl;
      el.geriAl.hidden = !gorunur;
      if (!gorunur) {
        el.geriAl.title = '';
        odagiKurtar(geriAlOdakta, function () {
          return false;
        });
        return;
      }
      const ipucu = t('yuzey.alt.geriAlIpucu', { ad: g.ad });
      el.geriAl.title = ipucu;
      el.geriAl.setAttribute('aria-label', ipucu);
      el.geriAl.disabled = bekliyor;
    }

    function tikla() {
      if (bekliyor || typeof kopru.geriAl !== 'function') return;
      bekliyor = true;
      ciz();
      Promise.resolve()
        .then(function () {
          return kopru.geriAl();
        })
        .then(
          function () {
            bekliyor = false; // sonucu (geri alındı / alınamadı / alınacak bir şey yok) ana süreç bildirir; model güncellemesi düğmeyi gizler
            ciz();
          },
          function () {
            bekliyor = false;
            ciz();
          },
        );
    }

    el.geriAl.addEventListener('click', tikla);

    // --- Odayı kapat (o-14) ---
    let odaOnayKodu = null; // ilk tıklaması yapılmış, ikinci tıklamayı bekleyen oda grubu
    let odaZamanlayici = null;
    let odaBekliyor = false;
    // Ekrandaki GÜNCEL düğme (oda kodu -> { dugme, grup: { kod, etiket }, n }): panel yeniden çizilince yeni düğme kurulur; onay süresi dolunca ya da
    // yanıt gelince yazılacak olan eski (ekrandan kalkmış) düğme değil bu kayıttaki düğmedir. Her çizimde aynı kodun kaydı yenisiyle değişir.
    const odaDugmeleri = new Map();
    const zaman = bag.zaman || {
      setTimeout: function (f, ms) {
        return setTimeout(f, ms);
      },
      clearTimeout: function (id) {
        clearTimeout(id);
      },
    };

    function odaOnayiniBirak() {
      if (odaZamanlayici !== null) zaman.clearTimeout(odaZamanlayici);
      odaZamanlayici = null;
      const onceki = odaOnayKodu;
      odaOnayKodu = null;
      const kayit = onceki === null ? undefined : odaDugmeleri.get(onceki);
      if (kayit) odaDugmesiniYaz(kayit.dugme, kayit.grup, kayit.n); // "Emin misin?" yazısı ekrandaki güncel düğmede kalmasın
    }

    /** Düğmenin metni ve ipucu: onay beklerken "Emin misin? Kapat (n)". */
    function odaDugmesiniYaz(dugme, grup, n) {
      const onayda = odaOnayKodu === grup.kod;
      const aciklama = t(onayda ? 'yuzey.oda.onayAria' : 'yuzey.oda.kapatAria', { oda: grup.etiket, n: n });
      dugme.textContent = t(onayda ? 'yuzey.oda.onay' : 'yuzey.oda.kapat', { n: n });
      dugme.title = aciklama;
      dugme.setAttribute('aria-label', aciklama);
      dugme.className = 'oda-kapat' + (onayda ? ' onay' : '');
    }

    /**
     * Oda grubunun başlığı: etiket ve (köprü varsa, açık cihaz varsa) "Odayı kapat" düğmesi yan yana. Köprü yoksa ya da açık cihaz
     * yoksa null döner (başlık tek başına eklenir).
     * @param {{kod: string, etiket: string, karolar: object[], oda?: boolean}} grup
     * @param {HTMLElement} baslik zaten kurulmuş başlık öğesi
     * @param {(anahtar: string, oge: HTMLElement) => void} [odakKaydet]
     * @returns {{kap: HTMLElement, dugme: HTMLElement}|null}
     */
    function odaBasligi(grup, baslik, odakKaydet) {
      if (typeof kopru.odaKapat !== 'function' || !grup || grup.oda !== true || !ODA_KODU_DESENI.test(String(grup.kod))) return null;
      const n = odaAcikSayisi(grup);
      if (n === 0) return null;
      const belge = baslik.ownerDocument || kok.document;
      const kap = belge.createElement('div');
      kap.className = 'bolum-ust';
      const dugme = belge.createElement('button');
      dugme.type = 'button';
      odaDugmesiniYaz(dugme, grup, n);
      dugme.disabled = odaBekliyor;
      odaDugmeleri.set(grup.kod, { dugme: dugme, grup: { kod: grup.kod, etiket: grup.etiket }, n: n });
      dugme.addEventListener('click', function () {
        if (odaBekliyor) return;
        if (odaOnayKodu !== grup.kod) {
          odaOnayiniBirak();
          odaOnayKodu = grup.kod;
          odaZamanlayici = zaman.setTimeout(function () {
            odaZamanlayici = null;
            odaOnayiniBirak(); // tıklanan düğme panel yeniden çizilince değişmiş olabilir: güncel düğme sıfırlanır
          }, ODA_ONAY_MS);
          odaDugmesiniYaz(dugme, grup, n);
          return;
        }
        odaOnayiniBirak();
        odaDugmesiniYaz(dugme, grup, n);
        odaBekliyor = true;
        dugme.disabled = true;
        const bitir = function (yanit) {
          odaBekliyor = false;
          dugme.disabled = false;
          odaDugmeleri.forEach(function (kayit) {
            kayit.dugme.disabled = false; // istek sürerken panel yeniden çizildiyse yeni düğmeler pasif kurulmuştur
          });
          if ((!yanit || yanit.ok !== true) && typeof bag.ipucu === 'function') bag.ipucu(t('yuzey.ipucu.odaOlmadi'));
        };
        Promise.resolve()
          .then(function () {
            return kopru.odaKapat(grup.kod);
          })
          .then(bitir, function () {
            bitir(null);
          });
      });
      kap.appendChild(baslik);
      kap.appendChild(dugme);
      if (typeof odakKaydet === 'function') odakKaydet('o:' + grup.kod, dugme);
      return { kap: kap, dugme: dugme };
    }

    return {
      ciz: ciz,
      odaBasligi: odaBasligi,
      model: function () {
        return eylem;
      },
    };
  }

  kok.EvYuzeyEylem = {
    EN_COK_GERI_AL: EN_COK_GERI_AL,
    EN_COK_GECIKMELI: EN_COK_GECIKMELI,
    EN_COK_DEGISEN: EN_COK_DEGISEN,
    ODA_ONAY_MS: ODA_ONAY_MS,
    geriAlDuzelt: geriAlDuzelt,
    gecikmeliDuzelt: gecikmeliDuzelt,
    degisenDuzelt: degisenDuzelt,
    odaAcikSayisi: odaAcikSayisi,
    oncekiMetni: oncekiMetni,
    sureMetni: sureMetni,
    modelDuzelt: modelDuzelt,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
