/*
 * Ayarlar sayfasının bağlantı katmanı bölümü (renderer) — 1.4.0 bağlantı grubu (o-55, o-56, o-57, o-58).
 * ayarlar.js bu dosyayı `window.EvAyarlarBaglanti.kur(ortak)` ile bağlar; yüklenmezse Ayarlar bugünkü gibi çalışır.
 *
 *  - Özel üstbilgiler (o-55): Cloudflare Access gibi katmanlar için ad + değer çiftleri. DEĞERLER ana sürece gider ve geri DÖNMEZ: sayfa kayıtlı
 *    üstbilgilerin yalnız ADLARINI görür; kayıtlı satırın değeri boş bırakılırsa "mevcut değer korunur" (deger: null) olarak gönderilir.
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  // Sunucunun neden kodları (ozel-ustbilgi.js) -> sözlük anahtarı. Anahtarlar düz dize olarak yazılır (ölü anahtar denetimi bunları görür).
  const USTBILGI_HATALARI = {
    'ad-gecersiz': 'ayar.baglanti.ust.hata.adGecersiz',
    'ad-yasak': 'ayar.baglanti.ust.hata.adYasak',
    'deger-gecersiz': 'ayar.baglanti.ust.hata.degerGecersiz',
    'deger-yok': 'ayar.baglanti.ust.hata.degerYok',
    tekrar: 'ayar.baglanti.ust.hata.tekrar',
    'cok-fazla': 'ayar.baglanti.ust.hata.cokFazla',
  };
  const VARSAYILAN_EN_COK_USTBILGI = 8;

  function kur(ortak) {
    const belge = ortak.belge;
    const kopru = ortak.kopru;
    const t = ortak.cevir;
    const cogul = ortak.cogul;
    const onayIste = ortak.onayIste || function () { return true; };
    const $ = function (kimlik) { return belge.getElementById(kimlik); };

    // ---- Özel üstbilgiler (o-55) -------------------------------------------------------------------------------------------------
    const ustListe = $('ustbilgiListesi');
    const ustEkle = $('btnUstbilgiEkle');
    const ustKaydet = $('btnUstbilgiKaydet');
    const ustDene = $('btnUstbilgiDene');
    const ustSil = $('btnUstbilgiSil');
    const ustDurum = $('ustbilgiDurum');
    const ustDeneSonuc = $('ustbilgiDeneSonuc');

    let ustSatirlari = []; // { ad, deger, mevcut, hata: { anahtar, degiskenler, neden } | null }
    let ustEnCok = VARSAYILAN_EN_COK_USTBILGI;
    let ustKayitliSayi = 0;
    let ustKirli = false;
    let ustIleti = null; // { anahtar, degiskenler, tur: 'hata' | 'tamam' | 'bilgi' } | { ham, tur }: dil değişince aynı durumdan yeniden yazılır
    let ustMesgul = false;

    function ustIletiYaz() {
      const hata = !!ustIleti && ustIleti.tur === 'hata';
      // Hata iletisi düzenleme sırasında, "Sınanıyor…" (tur: 'bilgi') da sınama sürerken görünür kalır; kirli uyarısı bunları ezmez.
      const kirliGoster = ustKirli && !hata && !(ustIleti && ustIleti.tur === 'bilgi');
      // "Kaydedilmemiş değişiklik var" uyarısı başarı rengi taşımaz: sınıf, gösterilen metne göre seçilir.
      ustDurum.className = 'ipucu' + (hata ? ' alan-sonuc-sorun' : !kirliGoster && ustIleti && ustIleti.tur === 'tamam' ? ' alan-sonuc-tamam' : '');
      if (kirliGoster) {
        ustDurum.textContent = t('ayar.baglanti.ust.kirli');
        return;
      }
      if (ustIleti) ustDurum.textContent = ustIleti.ham !== undefined ? ustIleti.ham : t(ustIleti.anahtar, ustIleti.degiskenler);
      else ustDurum.textContent = ustKayitliSayi === 0 ? t('ayar.baglanti.ust.yok') : cogul('ayar.baglanti.ust.sayac', ustKayitliSayi);
    }

    function ustIletisi(ileti) {
      ustIleti = ileti;
      ustIletiYaz();
    }

    function ustButonlariGuncelle() {
      ustSil.style.display = ustKayitliSayi > 0 ? '' : 'none';
      ustEkle.disabled = ustMesgul || ustSatirlari.length >= ustEnCok;
      ustKaydet.disabled = ustMesgul;
      ustDene.disabled = ustMesgul;
      ustSil.disabled = ustMesgul;
    }

    function ustKirletti() {
      ustKirli = true;
      ustIletiYaz();
    }

    /**
     * Odaktaki öğe DOM'dan çıkınca ya da pasifleşince odak gövdeye düşer: odak başka yere gitmediyse önceki öğeye (görünür ve etkinse),
     * değilse yedeğe verilir. Klavye kullanıcısı sayfanın başına dönmek zorunda kalmasın.
     */
    function odagiGeriVer(onceki, yedek) {
      const aktif = belge.activeElement;
      if (aktif && aktif !== belge.body) return;
      const kullanilabilir = function (oge) { return !!oge && oge !== belge.body && !oge.disabled && !(oge.style && oge.style.display === 'none'); };
      const hedef = kullanilabilir(onceki) ? onceki : yedek;
      if (hedef && typeof hedef.focus === 'function') hedef.focus();
    }

    function ustSatirlariCiz() {
      ustListe.replaceChildren();
      ustSatirlari.forEach(function (satir, sira) {
        const kap = belge.createElement('div');
        kap.className = 'baglanti-satir';
        kap.setAttribute('role', 'listitem');

        const hata = belge.createElement('div');
        hata.className = 'alan-hata baglanti-satir-hata';

        const ad = belge.createElement('input');
        ad.type = 'text';
        ad.maxLength = 64;
        ad.value = satir.ad;
        ad.placeholder = 'CF-Access-Client-Id';
        ad.readOnly = satir.mevcut; // kayıtlı satırın adı değişmez: kaldırıp yeniden eklenir (değer eşleşmesi ada bağlıdır)
        if (satir.mevcut) ad.title = t('ayar.baglanti.ust.adSabit'); // neden yazılamadığı fare üstünde ve ekran okuyucuda söylenir
        ad.setAttribute('aria-label', t('ayar.baglanti.ust.adEtiketi'));
        ad.setAttribute('spellcheck', 'false');
        ad.setAttribute('autocomplete', 'off');
        ad.addEventListener('input', function () {
          satir.ad = ad.value;
          hataIsaretiniKaldir();
          ustKirletti();
        });

        /** Girdi düzenlenince satırın hata işareti (modeldeki hata, kırmızı çerçeve, aria-invalid, hata kutusu) yeniden çizim beklenmeden kalkar; üstteki durum satırı kalır. */
        function hataIsaretiniKaldir() {
          satir.hata = null;
          [ad, deger].forEach(function (g) {
            g.classList.remove('gecersiz');
            g.removeAttribute('aria-invalid');
            g.removeAttribute('aria-describedby');
          });
          hata.style.display = 'none';
        }

        const deger = belge.createElement('input');
        deger.type = 'password';
        deger.maxLength = 2048;
        deger.value = satir.deger;
        deger.placeholder = satir.mevcut ? t('ayar.baglanti.ust.degerKorunur') : t('ayar.baglanti.ust.degerYerTutucu');
        deger.setAttribute('aria-label', t('ayar.baglanti.ust.degerEtiketi'));
        deger.setAttribute('spellcheck', 'false');
        deger.setAttribute('autocomplete', 'off');
        deger.addEventListener('input', function () {
          satir.deger = deger.value;
          hataIsaretiniKaldir();
          ustKirletti();
        });

        const kaldir = belge.createElement('button');
        kaldir.type = 'button';
        kaldir.className = 'buton buton-ikincil buton-kucuk';
        kaldir.textContent = t('ayar.baglanti.ust.satirSil');
        kaldir.setAttribute('aria-label', t('ayar.baglanti.ust.satirSilEtiket', { ad: satir.ad || '…' }));
        kaldir.addEventListener('click', function () {
          ustSatirlari.splice(sira, 1);
          ustKirletti();
          ustSatirlariCiz();
          // Tıklanan düğme listeyle birlikte silindi: odak aynı sıradaki (yoksa sondaki) satıra, satır kalmadıysa "Üstbilgi ekle"ye geçer.
          const komsu = ustListe.children[Math.min(sira, ustListe.children.length - 1)];
          const hedef = komsu && komsu.children[0] ? komsu.children[0] : ustEkle;
          if (typeof hedef.focus === 'function') hedef.focus();
        });

        if (satir.hata) {
          hata.id = 'ustHata' + sira;
          hata.textContent = t(satir.hata.anahtar, satir.hata.degiskenler);
          // Değer sorunlarında değer girdisi, adla ilgili sorunlarda ad girdisi işaretlenir; ekran okuyucu hata kutusunu girdiyle birlikte okur.
          const isaretli = satir.hata.neden === 'deger-yok' || satir.hata.neden === 'deger-gecersiz' ? deger : ad;
          isaretli.classList.add('gecersiz');
          isaretli.setAttribute('aria-invalid', 'true');
          isaretli.setAttribute('aria-describedby', hata.id);
        } else {
          hata.style.display = 'none';
        }

        kap.appendChild(ad);
        kap.appendChild(deger);
        kap.appendChild(kaldir);
        kap.appendChild(hata);
        ustListe.appendChild(kap);
      });
      ustButonlariGuncelle();
    }

    /** Sunucudaki adları satırlara döker (kaydedilmemiş değişiklik varken ve zorlanmadıkça dokunmaz). */
    function ustDurumunuUygula(durum, zorla) {
      if (!durum || !durum.ustbilgi) return;
      ustKayitliSayi = durum.ustbilgi.adlar.length;
      if (Number.isInteger(durum.ustbilgi.enCok) && durum.ustbilgi.enCok > 0) ustEnCok = durum.ustbilgi.enCok;
      if (!ustKirli || zorla) {
        ustSatirlari = durum.ustbilgi.adlar.map(function (ad) { return { ad: ad, deger: '', mevcut: true, hata: null }; });
        ustKirli = false;
        ustSatirlariCiz();
      }
      ustIletiYaz();
      ustButonlariGuncelle();
    }

    function ustHataKonumla(hatalar) {
      let ilk = null;
      hatalar.forEach(function (h) {
        const anahtar = USTBILGI_HATALARI[h.neden] || 'ayar.baglanti.ust.hataGenel';
        const satir = ustSatirlari[h.sira];
        const hata = { anahtar: anahtar, degiskenler: h.neden === 'cok-fazla' ? { n: ustEnCok } : undefined, neden: h.neden };
        if (satir) satir.hata = hata;
        if (!ilk) ilk = hata;
      });
      ustSatirlariCiz();
      ustIletisi(ilk ? { anahtar: ilk.anahtar, degiskenler: ilk.degiskenler, tur: 'hata' } : { anahtar: 'ayar.baglanti.ust.hataGenel', tur: 'hata' });
    }

    async function ustKaydetTiklandi() {
      if (ustMesgul) return;
      ustMesgul = true;
      ustButonlariGuncelle();
      try {
        const yuk = ustSatirlari.map(function (s) {
          return { ad: s.ad.trim(), deger: s.mevcut && s.deger === '' ? null : s.deger };
        });
        const yanit = await kopru.ustbilgileriKaydet(yuk);
        if (yanit && yanit.ok) {
          ustKirli = false;
          await ustYukle(true);
          ustIletisi({ anahtar: 'ayar.baglanti.ust.kaydedildi', tur: 'tamam' });
        } else if (yanit && Array.isArray(yanit.hatalar)) {
          ustHataKonumla(yanit.hatalar);
        } else {
          ustIletisi(yanit && yanit.hata ? { ham: yanit.hata, tur: 'hata' } : { anahtar: 'ayar.baglanti.ust.hataGenel', tur: 'hata' });
        }
      } catch (err) {
        ustIletisi({ anahtar: 'ayar.baglanti.ust.hataGenel', tur: 'hata' });
      } finally {
        ustMesgul = false;
        ustButonlariGuncelle();
      }
    }

    async function ustSilTiklandi() {
      const onceki = belge.activeElement;
      if (ustMesgul || !onayIste(t('ayar.baglanti.ust.silOnay'))) return;
      ustMesgul = true;
      ustButonlariGuncelle();
      try {
        const yanit = await kopru.ustbilgileriSil();
        if (yanit && yanit.ok) {
          ustKirli = false;
          await ustYukle(true);
          ustIletisi({ anahtar: 'ayar.baglanti.ust.silindi', tur: 'tamam' });
        } else {
          ustIletisi(yanit && yanit.hata ? { ham: yanit.hata, tur: 'hata' } : { anahtar: 'ayar.baglanti.ust.hataGenel', tur: 'hata' });
        }
      } catch (err) {
        ustIletisi({ anahtar: 'ayar.baglanti.ust.hataGenel', tur: 'hata' });
      } finally {
        ustMesgul = false;
        ustButonlariGuncelle();
        odagiGeriVer(onceki, ustEkle); // "Tümünü sil" mesgulken pasifleşti; başarıda da gizlendi
      }
    }

    async function ustDeneTiklandi() {
      if (ustMesgul) return;
      ustMesgul = true;
      ustButonlariGuncelle();
      ustDeneSonuc.replaceChildren();
      ustIletisi({ anahtar: 'ayar.baglanti.sinaniyor', tur: 'bilgi' });
      try {
        const yanit = await kopru.ustbilgileriDene();
        ustIleti = null;
        ustIletiYaz();
        if (!yanit || !yanit.ok) {
          ustIletisi({ anahtar: 'ayar.baglanti.ust.deneHata', tur: 'hata' });
        } else if (!yanit.sonuclar || yanit.sonuclar.length === 0) {
          ustIletisi({ anahtar: 'ayar.baglanti.ust.deneYok', tur: 'hata' });
        } else {
          let ipucuGerek = false;
          yanit.sonuclar.forEach(function (s) {
            const satir = belge.createElement('div');
            satir.className = 'alan-sonuc ' + (s.ulasilabilir ? 'alan-sonuc-tamam' : 'alan-sonuc-sorun');
            satir.textContent = s.tur === 'dis' ? t('ayar.baglanti.ust.deneDis', { mesaj: s.mesaj }) : t('ayar.baglanti.ust.deneYerel', { mesaj: s.mesaj });
            ustDeneSonuc.appendChild(satir);
            if (!s.ulasilabilir && (s.neden === 'erisim-engelli' || s.neden === 'yonlendirme')) ipucuGerek = true;
          });
          if (ipucuGerek) {
            const ipucu = belge.createElement('div');
            ipucu.className = 'ipucu';
            ipucu.textContent = t('ayar.baglanti.ust.deneIpucu');
            ustDeneSonuc.appendChild(ipucu);
          }
        }
      } catch (err) {
        ustIletisi({ anahtar: 'ayar.baglanti.ust.deneHata', tur: 'hata' });
      } finally {
        ustMesgul = false;
        ustButonlariGuncelle();
      }
    }

    ustEkle.addEventListener('click', function () {
      if (ustSatirlari.length >= ustEnCok) {
        ustIletisi({ anahtar: 'ayar.baglanti.ust.hata.cokFazla', degiskenler: { n: ustEnCok }, tur: 'hata' });
        return;
      }
      ustSatirlari.push({ ad: '', deger: '', mevcut: false, hata: null });
      ustKirletti();
      ustSatirlariCiz();
      const girdiler = ustListe.children[ustListe.children.length - 1];
      if (girdiler && girdiler.children[0] && typeof girdiler.children[0].focus === 'function') girdiler.children[0].focus();
    });
    ustKaydet.addEventListener('click', function () { ustKaydetTiklandi(); });
    ustSil.addEventListener('click', function () { ustSilTiklandi(); });
    ustDene.addEventListener('click', function () { ustDeneTiklandi(); });

    // ---- Ortak ------------------------------------------------------------------------------------------------------------------

    function durumuAl() {
      if (!kopru || typeof kopru.baglantiDurumuGetir !== 'function') return Promise.resolve(null);
      return kopru.baglantiDurumuGetir().catch(function () { return null; });
    }

    async function ustYukle(zorla) {
      const durum = await durumuAl();
      if (durum && durum.ok) ustDurumunuUygula(durum, zorla === true);
      return durum;
    }

    async function yukle() {
      const durum = await ustYukle(false);
      return durum;
    }

    function metinleriYenile() {
      ustDeneSonuc.replaceChildren(); // sınama sonucu o anki dilde yazılmış tek seferlik bir iletidir
      ustSatirlariCiz();
      ustIletiYaz();
    }

    ustSatirlariCiz();
    ustIletiYaz();

    return {
      yukle: yukle,
      metinleriYenile: metinleriYenile,
      kirliMi: function () { return ustKirli; },
    };
  }

  kok.EvAyarlarBaglanti = {
    USTBILGI_HATALARI: USTBILGI_HATALARI,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
