/*
 * Bağlantı (çevrimdışı) sayfasının betiği (renderer). Köprü: preload.js (window.evPaneli).
 * Metinler YALNIZ textContent ile yazılır (HTML olarak yorumlanan atama yok); sayfa CSP'li ve satır içi betiksizdir (hata-17).
 *
 * Arayüz dili: lib/dil.js + lib/ceviri/yuzey.js. Ana süreç sayfayı `?dil=tr|en` ile yükler (yoksa Türkçe); açıkken dil değişirse
 * `onDilDegisti` ({ dil }), yerinde güncellemede ise `onBaglantiDurum` yükündeki `dil` gelir. HTML'deki Türkçe metin varsayılandır;
 * sabit metinler data-i18n ile, durumla değişenler (başlık, açıklama, düğme, geri sayım) bu betikte t() ile yazılır.
 */
(function () {
  'use strict';

  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  if (!Dil || !Sozluk) return;

  const params = new URLSearchParams(window.location.search);
  const durum = params.get('durum') || 'cevrimdisi';
  let yerel = params.get('yerel') || '';
  let dis = params.get('dis') || '';
  let hataKodu = params.get('hata') || '';
  let t = Dil.cevirmen(Dil.DILLER.indexOf(params.get('dil')) >= 0 ? params.get('dil') : 'tr', Sozluk);
  let gorunum = durum === 'baglaniyor' ? 'baglaniyor' : 'cevrimdisi'; // şu an gösterilen görünüm (dil değişince yeniden yazılır)

  // Saniye değeri: geçerli bir tamsayıysa (0 dahil) o, değilse varsayılan. 0 = geri sayım yok (otomatik deneme durdu).
  function saniyeCoz(deger, varsayilan) {
    const n = parseInt(deger, 10);
    return Number.isFinite(n) && n >= 0 ? n : varsayilan;
  }

  let kalanSure = saniyeCoz(params.get('sn'), 30);

  const baslik = document.getElementById('baslik');
  const aciklama = document.getElementById('aciklama');
  const hataKoduEl = document.getElementById('hataKodu');
  const ikonKapsayici = document.getElementById('ikonKapsayici');
  const ikonHata = document.getElementById('ikonHata');
  const ikonYukleniyor = document.getElementById('ikonYukleniyor');
  const sayacKutusu = document.getElementById('sayacKutusu');
  const sayacOn = document.getElementById('sayacOn');
  const kalanSaniye = document.getElementById('kalanSaniye');
  const sayacSon = document.getElementById('sayacSon');
  const btnDene = document.getElementById('btnDene');
  const btnDeneMetin = document.getElementById('btnDeneMetin');
  const btnAyarlar = document.getElementById('btnAyarlar');
  const adresKutusu = document.getElementById('adresKutusu');
  const yerelAdresDeger = document.getElementById('yerelAdresDeger');
  const disAdresDeger = document.getElementById('disAdresDeger');

  function adresleriGoster() {
    if (yerel || dis) {
      adresKutusu.style.display = 'block';
      yerelAdresDeger.textContent = yerel || t('offline.adres.tanimsiz');
      disAdresDeger.textContent = dis || t('offline.adres.tanimsiz');
    }
  }

  // Sık Chromium hata kodlarının açıklamaları (g-11): kod -> sözlük anahtarı. Ham kod ayrı, küçük ve seçilebilir bir satırda gösterilir.
  const HATA_ANAHTARLARI = {
    ERR_NAME_NOT_RESOLVED: 'offline.hata.adresBulunamadi',
    ERR_CONNECTION_REFUSED: 'offline.hata.baglantiReddedildi',
    ERR_CONNECTION_TIMED_OUT: 'offline.hata.zamanAsimi',
    ERR_TIMED_OUT: 'offline.hata.zamanAsimi',
    ERR_CONNECTION_RESET: 'offline.hata.baglantiKesildi',
    ERR_INTERNET_DISCONNECTED: 'offline.hata.internetYok',
    ERR_ADDRESS_UNREACHABLE: 'offline.hata.adreseUlasilamiyor',
    ERR_NETWORK_CHANGED: 'offline.hata.agDegisti',
    ERR_CERT_DATE_INVALID: 'offline.hata.sertifikaTarihi',
  };
  // Ana süreçten gelen hata kodu (ör. HTTP_403, HTTP_502, ERR_CONNECTION_REFUSED, HATA_-105, COKME) -> { aciklama, ham }.
  // ham: açıklaması olan kodun küçük, seçilebilir satırda gösterilen hâli. Açıklaması olmayan kod açıklamanın
  // içinde kalır (önceki davranış; metin yalnız textContent ile yazıldığı için güvenli). COKME bir ağ kodu değildir.
  function hataBilgisi(kod) {
    if (!kod) return { aciklama: t('offline.aciklama.varsayilan'), ham: '' };
    if (kod === 'COKME') {
      return { aciklama: t('offline.hata.cokme'), ham: '' };
    }
    if (kod === 'HTTP_403') {
      return { aciklama: t('offline.hata.erisimEngellendi'), ham: kod };
    }
    const sunucu = /^HTTP_(5\d\d)$/.exec(kod);
    if (sunucu) {
      return { aciklama: t('offline.hata.sunucu', { kod: sunucu[1] }), ham: kod };
    }
    if (Object.prototype.hasOwnProperty.call(HATA_ANAHTARLARI, kod)) {
      return { aciklama: t(HATA_ANAHTARLARI[kod]), ham: kod };
    }
    if (/^ERR_CERT_[A-Z_]+$/.test(kod)) {
      return { aciklama: t('offline.hata.sertifika'), ham: kod };
    }
    return { aciklama: t('offline.hata.bilinmeyen', { kod: kod }), ham: '' };
  }

  let zamanlayici = null;

  // Tekrar Dene'ye odak: yalnız odak boşta iken (ör. Ayarlar'a gezinen kullanıcının odağını çalmaz).
  function butonaOdaklan() {
    const etkin = document.activeElement;
    if ((!etkin || etkin === document.body) && typeof btnDene.focus === 'function') btnDene.focus();
  }

  /**
   * Geri sayım cümlesi: sözlük şablonu ("{n} saniye içinde…", "Retrying in {n} seconds…") {n} yerinden ikiye bölünür; sayı kendi
   * (vurgulu) öğesinde kalır. Kalan süre 1 ise tekil şablon kullanılır.
   */
  function sayaciYaz() {
    const sablon = t(kalanSure === 1 ? 'offline.sayac.bir' : 'offline.sayac');
    const yer = sablon.indexOf('{n}');
    sayacOn.textContent = yer < 0 ? sablon : sablon.slice(0, yer);
    kalanSaniye.textContent = kalanSure;
    sayacSon.textContent = yer < 0 ? '' : sablon.slice(yer + 3);
  }

  /** Görünüme göre değişen metinleri seçili dille yazar (durumu, geri sayımı ve odağı değiştirmez). */
  function metinleriYaz() {
    if (gorunum === 'baglaniyor') {
      baslik.textContent = t('offline.baslik.baglaniyor');
      aciklama.textContent = t('offline.aciklama.baglaniyor');
      hataKoduEl.hidden = true;
      btnDeneMetin.textContent = t('offline.baglaniyor');
    } else {
      baslik.textContent = t('offline.baslik.cevrimdisi');
      const bilgi = hataBilgisi(hataKodu);
      aciklama.textContent = bilgi.aciklama;
      hataKoduEl.textContent = bilgi.ham ? t('offline.hataKodu', { kod: bilgi.ham }) : '';
      hataKoduEl.hidden = !bilgi.ham;
      btnDeneMetin.textContent = t('offline.tekrarDene');
      sayaciYaz();
    }
    adresleriGoster();
  }

  /** Dili değiştirir ve sayfadaki sabit metinleri (data-i18n) çevirir; aynı dil ya da geçersiz değer yok sayılır. @returns {boolean} dil değişti */
  function dilKur(yeniDil) {
    if (Dil.DILLER.indexOf(yeniDil) < 0 || yeniDil === t.dil) return false;
    t = Dil.cevirmen(yeniDil, Sozluk);
    Dil.sayfayiCevir(document, t);
    return true;
  }

  function gosterBaglaniyor() {
    if (zamanlayici) clearInterval(zamanlayici);
    gorunum = 'baglaniyor';
    ikonKapsayici.classList.add('baglaniyor');
    ikonHata.style.display = 'none';
    ikonYukleniyor.style.display = 'block';
    metinleriYaz();
    sayacKutusu.style.display = 'none';
    btnDene.disabled = true;
  }

  function gosterCevrimdisi() {
    gorunum = 'cevrimdisi';
    ikonKapsayici.classList.remove('baglaniyor');
    ikonHata.style.display = 'block';
    ikonYukleniyor.style.display = 'none';
    metinleriYaz();
    btnDene.disabled = false;
    butonaOdaklan();
    if (zamanlayici) clearInterval(zamanlayici);
    if (kalanSure > 0) {
      sayacKutusu.style.display = 'inline-block';
      baslatSayac();
    } else {
      sayacKutusu.style.display = 'none'; // otomatik deneme yok (ör. art arda çökme)
    }
  }

  // Geri sayım yalnız bilgi içindir: yeniden denemeyi ana süreçteki zamanlayıcı başlatır. Sayfa kendi
  // başına "tekrar dene" çağırmaz; çağırırsa artan bekleme (2-4-8-15 sn) her seferinde başa dönerdi.
  function baslatSayac() {
    if (zamanlayici) clearInterval(zamanlayici);
    sayaciYaz();
    zamanlayici = setInterval(function () {
      kalanSure--;
      if (kalanSure <= 0) {
        clearInterval(zamanlayici);
        kalanSaniye.textContent = '0';
        gosterBaglaniyor();
      } else {
        sayaciYaz();
      }
    }, 1000);
  }

  Dil.sayfayiCevir(document, t); // sabit metinler ve <html lang>
  adresleriGoster();

  if (durum === 'baglaniyor') {
    gosterBaglaniyor();
  } else {
    gosterCevrimdisi();
  }

  btnDene.addEventListener('click', function () {
    gosterBaglaniyor();
    if (window.evPaneli && window.evPaneli.tekrarDene) window.evPaneli.tekrarDene();
  });

  btnAyarlar.addEventListener('click', function () {
    if (window.evPaneli && window.evPaneli.ayarlariAc) window.evPaneli.ayarlariAc();
  });

  // Ana süreç sayfayı yeniden yüklemeden günceller (titreme olmasın):
  //  'deneniyor'  -> bağlanılıyor görünümü
  //  { durum: 'baglaniyor' | 'cevrimdisi', sn, hata, yerel, dis, dil } -> ilgili görünüm, yeni geri sayım (dil: etkin arayüz dili)
  if (window.evPaneli && window.evPaneli.onBaglantiDurum) {
    window.evPaneli.onBaglantiDurum(function (yuk) {
      if (yuk === 'deneniyor') {
        gosterBaglaniyor();
        return;
      }
      if (!yuk || typeof yuk !== 'object') return;
      dilKur(yuk.dil);
      yerel = String(yuk.yerel !== undefined && yuk.yerel !== null ? yuk.yerel : yerel);
      dis = String(yuk.dis !== undefined && yuk.dis !== null ? yuk.dis : dis);
      adresleriGoster();
      if (yuk.durum === 'baglaniyor') {
        gosterBaglaniyor();
        return;
      }
      hataKodu = String(yuk.hata !== undefined && yuk.hata !== null ? yuk.hata : '');
      kalanSure = saniyeCoz(yuk.sn, 30);
      gosterCevrimdisi();
    });
  }

  // Arayüz dili değişti (Ayarlar): sabit metinler çevrilir, görünüme bağlı metinler yeniden yazılır; geri sayım ve odak bozulmaz.
  if (window.evPaneli && typeof window.evPaneli.onDilDegisti === 'function') {
    window.evPaneli.onDilDegisti(function (yuk) {
      if (!yuk || typeof yuk !== 'object') return;
      if (dilKur(yuk.dil)) metinleriYaz();
    });
  }
})();
