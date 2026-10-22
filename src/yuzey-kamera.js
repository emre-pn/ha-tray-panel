/*
 * Hızlı panelin kamera bölümü (renderer) — o-48 kamera anlık görüntüsü (1.4.0 cihaz grubu). yuzey-sayfa.js bu modülü çağırır;
 * model ana süreçten gelir (src/lib/yuzey-modeli.js rendererKamera: yalnız Ayarlar'da TEK TEK onaylanmış, kamera süzgecinden geçmiş
 * kameralar), görüntü kanal yuzey:kamera ile (köprü: evYuzey.kamera) istenir. Bu modül ağa, anahtara, adrese ya da başka bir kanala dokunmaz.
 *
 *  - CANLI YAYIN YOKTUR: yalnız "son anlık görüntü". Ana süreç kamera başına en sık 5 sn'de bir çekim yapar (aynı kare önbellekten döner).
 *  - Görüntü varsayılan olarak BULANIKTIR (model.bulanik; Ayarlar'dan kapatılabilir): görüntüye (ya da "Göster" düğmesine) tıklayınca açılır.
 *    Her gösterimde yeniden bulanık başlar.
 *  - Görüntü yalnız bellekte (data: URL) tutulur, DİSKE YAZILMAZ; pencere gizlenince (gizlendi) ve yeni gösterimde silinir.
 *  - Hata durumunda sahte görüntü ya da eski kare gösterilmez; kısa bir hata metni yazılır.
 *  - "Şimdi yenile" düğmesi o kameranın görüntüsünü hemen ister (hız sınırı yine ana süreçte: 5 sn içinde aynı kare döner); "Büyüt" yalnız kartı
 *    ızgarada tam genişliğe açar (CSS sınıfı kamera-buyuk). İkisi de yeni bir yetki, kanal ya da akış getirmez; bulanıklık büyütmeyle KALKMAZ.
 *  - Tüm metin textContent ile yazılır; bulanıklık CSS sınıfıyla (kamera-bulanik) yapılır (satır içi stil yok, CSP).
 *
 * ctx (yuzey-sayfa.js verir): t(anahtar, degisken), olustur(etiket, sinif, metin), odakKaydet(anahtar, oge), satirEkle(ogeler),
 * kamera(kimlik) -> Promise<{ok, veri?, yas?, tur?}>, yenidenCiz(), boyutDegisti() (isteğe bağlı: Büyüt/Küçült sonrası panel yüksekliğini yeniden ölçer),
 * simdi(), zamanlayici { setTimeout, clearTimeout }, acikMi().
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvYuzeyKamera = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EN_COK_KAMERA = 8;
  const YENILEME_SECENEKLERI = Object.freeze([0, 5, 10, 30, 60]); // saniye; 0 = yalnız elle
  const KAMERA_KIMLIGI = /^camera\.[a-z0-9_]{1,80}$/;
  const GORUNTU_DESENI = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const EN_BUYUK_VERI = 3 * 1024 * 1024; // base64 metni üst sınırı (ana süreç zaten en çok 2 MB görüntü verir)
  // Sözlük anahtarları sabit dizelerle yazılır (test/yuzey-ceviri.test.js kullanılan her anahtarı kaynaktan okur).
  const HATA_ANAHTARI = Object.freeze({
    izinsiz: 'yuzey.kamera.hata.izinsiz',
    yasak: 'yuzey.kamera.hata.yasak',
    ulasilamiyor: 'yuzey.kamera.hata.ulasilamiyor',
    'cok-sik': 'yuzey.kamera.hata.cokSik',
    'ha-hatasi': 'yuzey.kamera.hata.haHatasi',
    'goruntu-yok': 'yuzey.kamera.hata.goruntuYok',
    gecersiz: 'yuzey.kamera.hata.gecersiz',
  });

  const sinirli = (deger, sinir) => String(deger === undefined || deger === null ? '' : deger).slice(0, sinir);

  /**
   * Ana süreçten gelen kamera bölümünü doğrular: { liste: [{id, etiket, kullanilabilir}], bulanik, yenilemeSn } ya da null (bölüm görünmez).
   * Kimliği kamera deseniyle uyuşmayan öğe, tekrar eden kimlik ve sınırdan sonrası atılır.
   */
  function modelDuzelt(ham) {
    if (!ham || typeof ham !== 'object' || !Array.isArray(ham.liste)) return null;
    const liste = [];
    for (const k of ham.liste.slice(0, EN_COK_KAMERA * 2)) {
      if (liste.length >= EN_COK_KAMERA) break;
      if (!k || typeof k.id !== 'string' || !KAMERA_KIMLIGI.test(k.id) || liste.some((o) => o.id === k.id)) continue;
      liste.push({ id: k.id, etiket: sinirli(typeof k.etiket === 'string' && k.etiket.trim() ? k.etiket.trim() : k.id, 60), kullanilabilir: k.kullanilabilir === true });
    }
    if (liste.length === 0) return null;
    return { liste, bulanik: ham.bulanik !== false, yenilemeSn: YENILEME_SECENEKLERI.indexOf(ham.yenilemeSn) >= 0 ? ham.yenilemeSn : 0 };
  }

  function olustur(ctx) {
    const { t, olustur: yap } = ctx;
    let model = null;
    const kameralar = new Map(); // kimlik -> { adim, veri, zaman, hata, bulanik, kart }
    let kuyruk = []; // yüklenecek kimlikler (bir seferde tek istek)
    let suruyor = false;
    let gosterim = 0; // her gösterim/gizlemede artar: eski gösterime ait geç yanıt yok sayılır
    let gorunurBekliyor = false; // gösterim geldi ama pencere henüz görünür değildi: görünür olunca ilk yükleme yapılır
    let yenilemeZamanlayicisi = null;

    const kayit = (kimlik) => kameralar.get(kimlik);

    function zamanlayiciyiDurdur() {
      if (yenilemeZamanlayicisi !== null) {
        ctx.zamanlayici.clearTimeout(yenilemeZamanlayicisi);
        yenilemeZamanlayicisi = null;
      }
    }

    function gorunumuGuncelle(k) {
      const kart = k.kart;
      if (!kart) return;
      const etiket = k.etiket;
      kart.ad.textContent = etiket;
      const goruntuVar = k.adim === 'tamam' && typeof k.veri === 'string';
      // Yenileme sürerken (eski kare bellekte) büyütme korunur: kart her yenilemede küçülüp uzamaz. Görüntü yokken (ilk yükleme, hata, gizleme)
      // büyütülecek bir şey yoktur; yeni görüntü her zaman normal boyutta başlar.
      const yenileniyor = k.adim === 'yukleniyor' && typeof k.veri === 'string';
      if (!goruntuVar && !yenileniyor) k.buyuk = false;
      kart.kok.className = 'kamera-karo' + (k.buyuk ? ' kamera-buyuk' : '');
      kart.buyut.disabled = !goruntuVar;
      kart.buyut.setAttribute('aria-pressed', k.buyuk ? 'true' : 'false');
      kart.buyut.setAttribute('aria-label', k.buyuk ? t('yuzey.kamera.kucultAd', { ad: etiket }) : t('yuzey.kamera.buyutAd', { ad: etiket }));
      kart.buyut.textContent = k.buyuk ? t('yuzey.kamera.kucult') : t('yuzey.kamera.buyut');
      kart.cerceve.hidden = !goruntuVar;
      kart.durum.hidden = goruntuVar;
      if (goruntuVar) {
        if (kart.img.getAttribute('src') !== k.veri) kart.img.setAttribute('src', k.veri);
        kart.img.className = 'kamera-goruntu' + (k.bulanik ? ' kamera-bulanik' : '');
        kart.cerceve.setAttribute('aria-pressed', k.bulanik ? 'false' : 'true');
        kart.cerceve.setAttribute('aria-label', t(k.bulanik ? 'yuzey.kamera.goster' : 'yuzey.kamera.gizle', { ad: etiket }));
        kart.cerceve.title = t(k.bulanik ? 'yuzey.kamera.gosterIpucu' : 'yuzey.kamera.gizleIpucu');
      } else {
        kart.img.removeAttribute('src');
        kart.durum.textContent =
          k.adim === 'yukleniyor' ? t('yuzey.kamera.yukleniyor') : k.adim === 'hata' ? t(HATA_ANAHTARI[k.hata] || HATA_ANAHTARI.gecersiz) : k.kullanilabilir ? t('yuzey.kamera.bos') : t('yuzey.kamera.hata.ulasilamiyor');
        kart.durum.className = 'kamera-durum' + (k.adim === 'hata' ? ' kamera-hata' : '');
      }
      kart.yenile.disabled = k.adim === 'yukleniyor' || !k.kullanilabilir;
      kart.yenile.setAttribute('aria-label', t('yuzey.kamera.yenileAd', { ad: etiket }));
      kart.yenile.textContent = t('yuzey.kamera.yenile');
      const yas = goruntuVar && typeof k.zaman === 'number' ? Math.max(0, Math.round((ctx.simdi() - k.zaman) / 1000)) : null;
      kart.yas.textContent = yas === null ? '' : yas < 3 ? t('yuzey.kamera.azOnce') : t('yuzey.kamera.yas', { sn: yas });
    }

    function kartKur(k) {
      const kok = yap('div', 'kamera-karo');
      const ad = yap('div', 'kamera-ad');
      const cerceve = yap('button', 'kamera-cerceve');
      cerceve.type = 'button';
      const img = yap('img', 'kamera-goruntu kamera-bulanik');
      img.setAttribute('alt', '');
      img.setAttribute('draggable', 'false');
      img.addEventListener('error', function () {
        // Tarayıcı görüntüyü çözemedi: bozuk kare gösterilmez
        const sim = kayit(k.id);
        if (!sim || sim.adim !== 'tamam') return;
        sim.adim = 'hata';
        sim.hata = 'goruntu-yok';
        sim.veri = null;
        gorunumuGuncelle(sim);
        ctx.yenidenCiz();
      });
      cerceve.appendChild(img);
      cerceve.addEventListener('click', function () {
        const sim = kayit(k.id);
        if (!sim || sim.adim !== 'tamam') return;
        sim.bulanik = !sim.bulanik;
        gorunumuGuncelle(sim);
      });
      const durum = yap('div', 'kamera-durum');
      const alt = yap('div', 'kamera-alt');
      const yenile = yap('button', 'kamera-yenile');
      yenile.type = 'button';
      yenile.addEventListener('click', function () {
        yukleSirala(k.id);
      });
      const buyut = yap('button', 'kamera-buyut');
      buyut.type = 'button';
      buyut.addEventListener('click', function () {
        const sim = kayit(k.id);
        if (!sim || sim.adim !== 'tamam') return;
        sim.buyuk = !sim.buyuk;
        gorunumuGuncelle(sim);
        if (typeof ctx.boyutDegisti === 'function') ctx.boyutDegisti(); // tam genişlik / yükseklik değişti: panel yüksekliği yeniden ölçülür
      });
      const yas = yap('span', 'kamera-yas');
      alt.appendChild(yenile);
      alt.appendChild(buyut);
      alt.appendChild(yas);
      kok.appendChild(ad);
      kok.appendChild(cerceve);
      kok.appendChild(durum);
      kok.appendChild(alt);
      k.kart = { kok, ad, cerceve, img, durum, yenile, buyut, yas };
    }

    function kameraKaydi(girdi) {
      let k = kayit(girdi.id);
      if (!k) {
        k = { id: girdi.id, etiket: girdi.etiket, kullanilabilir: girdi.kullanilabilir, adim: 'bos', veri: null, zaman: null, hata: null, bulanik: !model || model.bulanik, buyuk: false, kart: null };
        kameralar.set(k.id, k);
        kartKur(k);
      } else {
        k.etiket = girdi.etiket;
        k.kullanilabilir = girdi.kullanilabilir;
      }
      return k;
    }

    /** Model geldi (her çizimde): kaldırılan kamera bellekten silinir, yeni kamera için kart kurulur. Ağ isteği BAŞLATMAZ. */
    function ayarla(yeni) {
      model = yeni;
      const kimlikler = new Set(yeni ? yeni.liste.map((k) => k.id) : []);
      for (const kimlik of Array.from(kameralar.keys())) {
        if (!kimlikler.has(kimlik)) {
          kameralar.delete(kimlik);
          kuyruk = kuyruk.filter((q) => q !== kimlik);
        }
      }
      if (!yeni) {
        zamanlayiciyiDurdur();
        return;
      }
      yeni.liste.forEach(function (g) {
        const k = kameraKaydi(g);
        if (!k.kullanilabilir && k.adim === 'bos') gorunumuGuncelle(k);
      });
    }

    function sonucuUygula(kimlik, sonuc, baslangicGosterimi) {
      const k = kayit(kimlik);
      if (!k || baslangicGosterimi !== gosterim) return; // pencere gizlendi / yeniden gösterildi ya da kamera kaldırıldı: bu yanıt eskidir
      const gecerli =
        sonuc && sonuc.ok === true && typeof sonuc.veri === 'string' && sonuc.veri.length <= EN_BUYUK_VERI && GORUNTU_DESENI.test(sonuc.veri);
      if (gecerli) {
        const yas = typeof sonuc.yas === 'number' && isFinite(sonuc.yas) && sonuc.yas >= 0 ? sonuc.yas : 0;
        k.adim = 'tamam';
        k.veri = sonuc.veri;
        k.zaman = ctx.simdi() - yas;
        k.hata = null;
      } else {
        k.adim = 'hata';
        k.veri = null; // hata durumunda eski kare gösterilmez
        k.zaman = null;
        k.hata = sonuc && sonuc.ok === false && typeof sonuc.tur === 'string' && Object.prototype.hasOwnProperty.call(HATA_ANAHTARI, sonuc.tur) ? sonuc.tur : 'goruntu-yok';
      }
      gorunumuGuncelle(k);
    }

    function siradakiniIsle() {
      if (suruyor) return;
      const kimlik = kuyruk.shift();
      if (kimlik === undefined) return;
      const k = kayit(kimlik);
      if (!k || !ctx.acikMi()) {
        siradakiniIsle(); // kamera kaldırılmış ya da pencere gizli: bu istek atlanır
        return;
      }
      suruyor = true;
      const baslangic = gosterim;
      k.adim = 'yukleniyor';
      gorunumuGuncelle(k);
      let soz;
      try {
        soz = Promise.resolve(ctx.kamera(kimlik));
      } catch (hata) {
        soz = Promise.reject(hata);
      }
      soz.then(
        function (sonuc) {
          sonucuUygula(kimlik, sonuc, baslangic);
        },
        function () {
          sonucuUygula(kimlik, { ok: false, tur: 'ha-hatasi' }, baslangic);
        },
      ).then(function () {
        if (baslangic !== gosterim) return; // gizlendi / yeniden gösterildi: sıra o gösterimin kendi sayacında yürür
        suruyor = false;
        ctx.yenidenCiz();
        siradakiniIsle();
      });
    }

    function yukleSirala(kimlik) {
      const k = kayit(kimlik);
      if (!k || !k.kullanilabilir || !ctx.acikMi()) return;
      if (k.adim === 'yukleniyor' || kuyruk.indexOf(kimlik) >= 0) return;
      kuyruk.push(kimlik);
      siradakiniIsle();
    }

    function tumunuSirala() {
      if (!model) return;
      model.liste.forEach(function (g) {
        yukleSirala(g.id);
      });
    }

    function yenilemeyiKur() {
      zamanlayiciyiDurdur();
      if (!model || model.yenilemeSn <= 0) return;
      const bu = gosterim;
      yenilemeZamanlayicisi = ctx.zamanlayici.setTimeout(function tik() {
        yenilemeZamanlayicisi = null;
        if (bu !== gosterim || !model || model.yenilemeSn <= 0 || !ctx.acikMi()) return; // gizlendi: zamanlayıcı durur, görünür olunca yeniden kurulur
        tumunuSirala();
        yenilemeZamanlayicisi = ctx.zamanlayici.setTimeout(tik, model.yenilemeSn * 1000);
      }, model.yenilemeSn * 1000);
    }

    /** Pencere (yeniden) gösterildi: eski kareler silinir, her kamera yeniden bulanık başlar; görünürse ilk görüntü istenir. */
    function gosterildi() {
      gosterim += 1;
      kuyruk = [];
      suruyor = false;
      zamanlayiciyiDurdur();
      kameralar.forEach(function (k) {
        k.adim = 'bos';
        k.veri = null;
        k.zaman = null;
        k.hata = null;
        k.bulanik = !model || model.bulanik;
        k.buyuk = false;
        gorunumuGuncelle(k);
      });
      gorunurBekliyor = true;
      gorunurOldu();
    }

    /** Pencere görünür oldu (gösterim olayı görünürlükten önce gelmiş olabilir) ya da odak aldı: bekleyen ilk yükleme yapılır. */
    function gorunurOldu() {
      if (!gorunurBekliyor || !model || !ctx.acikMi()) return;
      gorunurBekliyor = false;
      tumunuSirala();
      yenilemeyiKur();
    }

    /** Pencere gizlendi: bellekteki kareler ve DOM'daki görüntüler silinir, zamanlayıcı durur. */
    function gizlendi() {
      gosterim += 1;
      kuyruk = [];
      suruyor = false;
      gorunurBekliyor = false;
      zamanlayiciyiDurdur();
      kameralar.forEach(function (k) {
        k.adim = 'bos';
        k.veri = null;
        k.zaman = null;
        k.hata = null;
        gorunumuGuncelle(k);
      });
    }

    /** "Tümü" görünümüne eklenecek bölüm; kamera yoksa boş dizi. Kartlar çizimler arasında yeniden kullanılır (görüntü yeniden çözülmez). */
    function parcalar() {
      if (!model) return [];
      const bolum = yap('section', 'bolum grup-kamera');
      bolum.appendChild(yap('h2', 'bolum-baslik', t('yuzey.kamera.baslik')));
      bolum.appendChild(yap('p', 'kamera-not', t(model.bulanik ? 'yuzey.kamera.notBulanik' : 'yuzey.kamera.not')));
      const izgara = yap('div', 'kamera-izgara');
      const satir = [];
      model.liste.forEach(function (g) {
        const k = kameraKaydi(g);
        gorunumuGuncelle(k);
        izgara.appendChild(k.kart.kok);
        ctx.odakKaydet('kamera:' + k.id, k.kart.yenile);
        satir.push(k.kart.yenile);
        if (k.adim === 'tamam') {
          ctx.odakKaydet('kamera-goruntu:' + k.id, k.kart.cerceve);
          satir.push(k.kart.cerceve);
          ctx.odakKaydet('kamera-buyut:' + k.id, k.kart.buyut);
          satir.push(k.kart.buyut);
        }
      });
      ctx.satirEkle(satir);
      bolum.appendChild(izgara);
      return [bolum];
    }

    return {
      ayarla,
      parcalar,
      gosterildi,
      gorunurOldu,
      gizlendi,
      /** Yalnız test/tanı: bellekteki kare sayısı. */
      kareSayisi: () => Array.from(kameralar.values()).filter((k) => k.veri !== null).length,
    };
  }

  return { EN_COK_KAMERA, YENILEME_SECENEKLERI, HATA_ANAHTARI, modelDuzelt, olustur };
});
