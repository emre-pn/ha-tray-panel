/*
 * Hızlı panel ve komut paletinin GÖRÜNÜM betiği (renderer; 1.4.0 grup "tema"). Köprü: preload-yuzey.js (window.evYuzey); yeni köprü işlevi YOK.
 * Ana süreç (src/yuzey-yoneticisi.js) görünüm modelini `yuzey:durum-al` yanıtında ve her `yuzey:goster` iletisinde `gorunum` olarak gönderir
 * (yoksa varsayılan görünüm). Bu betik:
 *   - modeli <html> öğesine yazar (lib/tema-renk.js gorunumUygula: özel renk değişkenleri CSSOM ile, öznitelikler; satır içi stil bildirimi ve
 *     HTML ataması YOK, CSP korunur);
 *   - kozmetik animasyonları yönetir (o-34): hava/mevsim efekti (tuval, lib/efekt.js), karo içeri kayması (<html data-giris>) ve palette kayan vurgu.
 * Hepsi varsayılan KAPALIDIR ve "hareketi azalt" (ayar ya da sistemin prefers-reduced-motion tercihi) açıkken hiçbiri çalışmaz.
 * 1.4.1: işlevsel panel açılış hareketini (<html data-acilis>) de yönetir; o varsayılan AÇIKTIR, hareketi azalt yine kapatır.
 * Efekt yalnız karo modelindeki beyaz listeli hava durumunu okur (lib/efekt.js havaDurumuBul); hiçbir eylem ya da istek yapmaz.
 * Ana sayfa betiğine (yuzey-sayfa.js) dokunmaz: kendi dinleyicilerini ekler.
 */
(function () {
  'use strict';

  const kopru = window.evYuzey;
  const Tema = window.EvTemaRenk;
  const Efekt = window.EvEfekt;
  if (!kopru || !Tema || !Efekt) return;

  const kok = document.documentElement;
  const KARE_ARALIGI_MS = 33; // ~30 kare/sn
  const GIRIS_SURESI_MS = 700;
  const ACILIS_SURESI_MS = 400; // CSS'teki 167 ms'lik açılıştan uzun; sonra öznitelik kalkar
  const YENIDEN_BOYUT_BEKLEME_MS = 120;

  const sorgu = function (metin) {
    return typeof window.matchMedia === 'function' ? window.matchMedia(metin) : null;
  };
  const azaltSorgusu = sorgu('(prefers-reduced-motion: reduce)');
  const acikSorgusu = sorgu('(prefers-color-scheme: light)');

  let gorunum = null; // ana sürecin son görünüm modeli
  let sonuc = { hareketAzalt: false, gecis: false, animasyon: null };
  let model = null; // son karo modeli (hava durumu için)
  let girisZamanlayicisi = null;
  let acilisZamanlayicisi = null;
  let boyutZamanlayicisi = null;

  const sistemHareketiAzalt = function () {
    return !!(azaltSorgusu && azaltSorgusu.matches === true);
  };

  /** Efekt renk takımı: özel palet varsa onun teması, yoksa Windows'un teması. */
  function sema() {
    if (gorunum && (gorunum.sema === 'koyu' || gorunum.sema === 'acik')) return gorunum.sema;
    return acikSorgusu && acikSorgusu.matches === true ? 'acik' : 'koyu';
  }

  // ---------------------------------------------------------------- karo içeri kayması

  function girisiOynat() {
    window.clearTimeout(girisZamanlayicisi);
    kok.removeAttribute('data-giris');
    if (!sonuc.gecis) return;
    void kok.offsetWidth; // animasyon her gösterimde baştan başlasın
    kok.setAttribute('data-giris', '1'); // yuzey-sayfa.js .kok sınıfını her çizimde yeniden yazar; bu yüzden öznitelik <html>'dedir
    girisZamanlayicisi = window.setTimeout(function () {
      kok.removeAttribute('data-giris'); // sonraki çizimler (model güncellemesi) yeniden oynatmasın
    }, GIRIS_SURESI_MS);
  }

  // ---------------------------------------------------------------- panel açılışı (1.4.1, işlevsel hareket)

  /**
   * Gizli panel açılırken içerik kısa bir yukarı kaymayla gelir (CSS: :root[data-acilis] .kok, 167 ms). Yalnız panel kipinde ve
   * pencere gizliyken gelen gösterimde oynar: palet anında açılır, zaten açık panel yeniden gösterilince oynamaz. Hareketi azalt
   * (ayar ya da sistem) açıkken hiç oynamaz.
   */
  function acilisiOynat(yuk, gizliydi) {
    window.clearTimeout(acilisZamanlayicisi);
    kok.removeAttribute('data-acilis');
    if (gizliydi !== true || sonuc.hareketAzalt || !yuk || yuk.mod !== 'panel') return;
    void kok.offsetWidth; // animasyon her açılışta baştan başlasın
    kok.setAttribute('data-acilis', '1');
    acilisZamanlayicisi = window.setTimeout(function () {
      kok.removeAttribute('data-acilis');
    }, ACILIS_SURESI_MS);
  }

  // ---------------------------------------------------------------- kayan vurgu (palet)

  const icerik = document.getElementById('icerik');
  let vurguOgesi = null;
  let sonVurguUstu = null;
  let gozlemci = null;
  let vurguGuncelleniyor = false;

  function vurguOgesiniKur() {
    if (vurguOgesi || !icerik || typeof document.createElement !== 'function') return;
    vurguOgesi = document.createElement('div');
    vurguOgesi.className = 'kayan-vurgu';
    vurguOgesi.setAttribute('aria-hidden', 'true');
    vurguOgesi.setAttribute('role', 'presentation');
  }

  function vurguyuKonumla() {
    if (!vurguOgesi || !icerik || !sonuc.gecis || vurguGuncelleniyor) return;
    if (typeof icerik.querySelector !== 'function') return;
    vurguGuncelleniyor = true;
    try {
      const secili = icerik.querySelector('.palet-satir.secili');
      if (!secili) {
        vurguOgesi.hidden = true;
        sonVurguUstu = null;
        return;
      }
      vurguOgesi.hidden = false;
      const ust = secili.offsetTop;
      if (vurguOgesi.parentNode !== icerik) {
        // İçerik yeniden kurulunca öğe sayfadan düşer: önceki konumdan (geçişsiz) yeniden eklenir, sonra yeni konuma kayar.
        icerik.insertBefore(vurguOgesi, icerik.firstChild);
        if (sonVurguUstu !== null) {
          vurguOgesi.classList.add('kayma-yok');
          vurguOgesi.style.transform = 'translateY(' + sonVurguUstu + 'px)';
          void vurguOgesi.offsetHeight;
          vurguOgesi.classList.remove('kayma-yok');
        }
      }
      vurguOgesi.style.transform = 'translateY(' + ust + 'px)';
      vurguOgesi.style.left = secili.offsetLeft + 'px';
      vurguOgesi.style.width = secili.offsetWidth + 'px';
      vurguOgesi.style.height = secili.offsetHeight + 'px';
      sonVurguUstu = ust;
    } finally {
      vurguGuncelleniyor = false;
    }
  }

  function kayanVurguyuAyarla() {
    if (sonuc.gecis && icerik && typeof window.MutationObserver === 'function') {
      vurguOgesiniKur();
      if (!gozlemci) {
        gozlemci = new window.MutationObserver(function () {
          vurguyuKonumla();
        });
        gozlemci.observe(icerik, { childList: true });
      }
      kok.setAttribute('data-kayan', '1'); // CSS bunu görünce satırın kendi zeminini bırakır (öğe hazır)
      vurguyuKonumla();
      return;
    }
    kok.removeAttribute('data-kayan');
    if (gozlemci) {
      gozlemci.disconnect();
      gozlemci = null;
    }
    if (vurguOgesi && vurguOgesi.parentNode && typeof vurguOgesi.parentNode.removeChild === 'function') vurguOgesi.parentNode.removeChild(vurguOgesi);
    sonVurguUstu = null;
  }

  // ---------------------------------------------------------------- hava / mevsim efekti

  const tuval = document.getElementById('efekt');
  let baglam = null;
  let durum = null;
  let etkinTur = null;
  let kareKimligi = null;
  let sonKare = 0;

  function tuvaliBoyutla() {
    if (!tuval || !baglam) return { w: 0, h: 0 };
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    const oran = Math.min(2, window.devicePixelRatio || 1);
    tuval.width = Math.round(w * oran);
    tuval.height = Math.round(h * oran);
    if (typeof baglam.setTransform === 'function') baglam.setTransform(oran, 0, 0, oran, 0, 0);
    return { w: w, h: h };
  }

  function kareIste() {
    if (kareKimligi === null && durum && typeof window.requestAnimationFrame === 'function') kareKimligi = window.requestAnimationFrame(kare);
  }

  function kare(zaman) {
    kareKimligi = null;
    if (!durum || !baglam) return;
    if (document.hidden === true) return; // pencere gizli: döngü durur, görünür olunca devam eder (visibilitychange)
    if (sonKare === 0) sonKare = zaman;
    const gecen = zaman - sonKare;
    if (gecen >= KARE_ARALIGI_MS) {
      Efekt.adim(durum, gecen);
      Efekt.ciz(baglam, durum, sema());
      sonKare = zaman;
    }
    kareIste();
  }

  function efektiDurdur() {
    if (kareKimligi !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(kareKimligi);
    kareKimligi = null;
    durum = null;
    etkinTur = null;
    sonKare = 0;
    if (tuval) {
      if (baglam && typeof baglam.clearRect === 'function') baglam.clearRect(0, 0, tuval.width || 0, tuval.height || 0);
      tuval.hidden = true;
    }
  }

  function efektiBaslat(tur) {
    efektiDurdur();
    if (!tuval || typeof tuval.getContext !== 'function') return;
    baglam = baglam || tuval.getContext('2d');
    if (!baglam) return;
    const boyut = tuvaliBoyutla();
    durum = Efekt.olustur(tur, boyut.w, boyut.h);
    etkinTur = tur;
    tuval.hidden = false;
    Efekt.ciz(baglam, durum, sema()); // ilk kare hemen görünsün
    kareIste();
  }

  function efektiGuncelle() {
    const tur = Efekt.efektSec({
      animasyon: sonuc.animasyon,
      hareketAzalt: sonuc.hareketAzalt,
      havaDurumu: Efekt.havaDurumuBul(model),
      ay: new Date().getMonth(),
    });
    if (tur === null) {
      if (etkinTur !== null || (tuval && tuval.hidden === false)) efektiDurdur();
      return;
    }
    if (tur !== etkinTur) efektiBaslat(tur);
  }

  // ---------------------------------------------------------------- uygulama

  function uygula(yeni) {
    gorunum = yeni && typeof yeni === 'object' ? yeni : null;
    sonuc = Tema.gorunumUygula(kok, gorunum, { hareketAzalt: sistemHareketiAzalt() });
    kayanVurguyuAyarla();
    efektiGuncelle();
    if (!sonuc.gecis) girisiOynat(); // kapalıysa kalan sınıf temizlenir
  }

  kopru.durumAl().then(
    function (yanit) {
      if (!yanit || yanit.ok !== true) return;
      if (yanit.model) model = yanit.model;
      uygula(yanit.gorunum);
    },
    function () {
      /* görünüm uygulanamazsa CSS'in varsayılan görünümü kalır */
    },
  );

  kopru.onGoster(function (yuk) {
    const gizliydi = document.hidden === true; // ana süreç iletiyi pencereyi göstermeden önce yollar
    uygula(yuk && yuk.gorunum);
    girisiOynat();
    acilisiOynat(yuk, gizliydi);
  });

  kopru.onDurum(function (yeniModel) {
    model = yeniModel;
    efektiGuncelle(); // hava karosunun durumu değişmiş olabilir
  });

  // Sistem "hareketi azalt" tercihi çalışırken değişirse
  if (azaltSorgusu && typeof azaltSorgusu.addEventListener === 'function') {
    azaltSorgusu.addEventListener('change', function () {
      uygula(gorunum);
    });
  }

  // Pencere gizlenip yeniden görününce döngü devam eder; gizliyken tuval çizilmez
  document.addEventListener('visibilitychange', function () {
    if (document.hidden !== true && durum) {
      sonKare = 0;
      kareIste();
    }
  });

  // Yeniden boyutlanınca (yakınlaştırma, yükseklik değişimi) tuval ve parçacıklar yeni boyuta göre kurulur
  window.addEventListener('resize', function () {
    if (!durum) return;
    window.clearTimeout(boyutZamanlayicisi);
    boyutZamanlayicisi = window.setTimeout(function () {
      if (etkinTur) efektiBaslat(etkinTur);
    }, YENIDEN_BOYUT_BEKLEME_MS);
  });
})();
