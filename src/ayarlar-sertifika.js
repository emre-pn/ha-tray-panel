/*
 * Ayarlar sayfasının sertifika güveni bölümü (renderer) — 1.4.0 bağlantı grubu (o-56).
 * ayarlar.js bu dosyayı `window.EvAyarlarSertifika.kur(ortak)` ile bağlar; yüklenmezse Ayarlar bugünkü gibi çalışır.
 *
 *  - Yalnız ayardaki https Home Assistant adresleri için: sunucu sertifikasının SHA-256 parmak izini sabitleme (sunucudan okunur ya da elle
 *    girilir; sabitleme ancak kullanıcı onayıyla yapılır) ve güvenilen özel kök sertifika (CA) ekleme.
 *  - "Sertifika hatalarını yok say" seçeneği YOKTUR. Dosya yolu bu sayfaya gelmez; dosyayı ana süreç seçtirir ve okur.
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  // Sunucunun neden kodları (sertifika-yoneticisi.js, lib/sertifika*.js) -> sözlük anahtarı. Anahtarlar düz dize olarak yazılır
  // (ölü anahtar denetimi bunları görür).
  const SERTIFIKA_HATALARI = {
    'adres-yok': 'ayar.baglanti.sert.hata.adresYok',
    'https-degil': 'ayar.baglanti.sert.hata.adresYok',
    baglanamadi: 'ayar.baglanti.sert.hata.baglanamadi',
    'zaman-asimi': 'ayar.baglanti.sert.hata.zamanAsimi',
    'sertifika-yok': 'ayar.baglanti.sert.hata.sertifikaYok',
    'parmak-gecersiz': 'ayar.baglanti.sert.hata.parmakGecersiz',
    'cok-fazla': 'ayar.baglanti.sert.hata.cokFazla',
    'ozel-anahtar': 'ayar.baglanti.sert.hata.ozelAnahtar',
    'dosyada-yok': 'ayar.baglanti.sert.hata.bulunamadi',
    'pem-gecersiz': 'ayar.baglanti.sert.hata.pemGecersiz',
    'tarih-gecersiz': 'ayar.baglanti.sert.hata.pemGecersiz',
    'ca-degil': 'ayar.baglanti.sert.hata.caDegil',
    'kok-degil': 'ayar.baglanti.sert.hata.kokDegil',
    'suresi-doldu': 'ayar.baglanti.sert.hata.suresiDoldu',
    'henuz-gecerli-degil': 'ayar.baglanti.sert.hata.henuzGecerliDegil',
    'cok-buyuk': 'ayar.baglanti.sert.hata.cokBuyuk',
    okunamadi: 'ayar.baglanti.sert.hata.okunamadi',
    yazilamadi: 'ayar.baglanti.sert.hata.yazilamadi',
    'diyalog-acilamadi': 'ayar.baglanti.sert.hata.diyalog',
  };
  const GENEL_HATA = 'ayar.baglanti.sert.hata.genel';

  function hataAnahtari(neden) {
    return SERTIFIKA_HATALARI[neden] || GENEL_HATA;
  }

  function kur(ortak) {
    const belge = ortak.belge;
    const kopru = ortak.kopru;
    const t = ortak.cevir;
    const onayIste = ortak.onayIste || function () { return true; };
    const $ = function (kimlik) { return belge.getElementById(kimlik); };

    const adresListesi = $('sertifikaAdresListesi');
    const okunanKutu = $('sertifikaOkunan');
    const caListesi = $('sertifikaCaListesi');
    const caEkleDugme = $('btnSertifikaCaEkle');
    const durumSatiri = $('sertifikaDurum');

    let sertifika = { ca: [], sabit: [], adresler: [] };
    let okunan = null; // { tur, ...sunucu yanıtı }: dil değişince aynı veriden yeniden yazılır
    let elleAcik = {}; // ana bilgisayar -> parmak izi girişi açık mı
    let elleDegerleri = {};
    let ileti = null; // { anahtar, degiskenler, tur }
    let mesgul = false;

    function iletiYaz() {
      durumSatiri.className = 'ipucu' + (ileti && ileti.tur === 'hata' ? ' alan-sonuc-sorun' : ileti && ileti.tur === 'tamam' ? ' alan-sonuc-tamam' : '');
      durumSatiri.textContent = ileti ? t(ileti.anahtar, ileti.degiskenler) : '';
    }

    function iletisi(yeni) {
      ileti = yeni;
      iletiYaz();
    }

    function hataIletisi(neden) {
      iletisi({ anahtar: hataAnahtari(neden), tur: 'hata' });
    }

    function tarihKisa(iso) {
      return typeof iso === 'string' ? iso.slice(0, 10) : '';
    }

    function adresAdi(adres) {
      const bilgisayar = adres.kapi && adres.kapi !== 443 ? adres.anaBilgisayar + ':' + adres.kapi : adres.anaBilgisayar;
      return t(adres.tur === 'dis' ? 'ayar.baglanti.sert.adresDis' : 'ayar.baglanti.sert.adresYerel', { ana: bilgisayar });
    }

    function sabitBul(anaBilgisayar) {
      for (let i = 0; i < sertifika.sabit.length; i += 1) {
        if (sertifika.sabit[i].anaBilgisayar === anaBilgisayar) return sertifika.sabit[i];
      }
      return null;
    }

    function dugme(metin, sinif, tiklama, etiket) {
      const d = belge.createElement('button');
      d.type = 'button';
      d.className = 'buton ' + sinif + ' buton-kucuk';
      d.textContent = metin;
      if (etiket) d.setAttribute('aria-label', etiket);
      d.disabled = mesgul;
      d.addEventListener('click', tiklama);
      return d;
    }

    function satir(sinif, metin) {
      const e = belge.createElement('div');
      e.className = sinif;
      e.textContent = metin;
      return e;
    }

    function adresBloguCiz(adres, sabit) {
      const kutu = belge.createElement('div');
      kutu.className = 'baglanti-kutu';
      kutu.setAttribute('role', 'listitem');
      kutu.appendChild(satir('', adres.tur ? adresAdi(adres) : adres.anaBilgisayar));
      const durum = sabit
        ? t('ayar.baglanti.sert.sabitDurum', { parmak: sabit.parmakBicimli })
        : t('ayar.baglanti.sert.sabitYok');
      kutu.appendChild(satir(sabit ? 'baglanti-parmak' : 'ipucu', durum));

      const dugmeler = belge.createElement('div');
      dugmeler.className = 'buton-satiri';
      if (adres.tur) {
        dugmeler.appendChild(dugme(t('ayar.baglanti.sert.oku'), 'buton-ikincil', function () { okuTiklandi(adres.tur); }));
        dugmeler.appendChild(dugme(t('ayar.baglanti.sert.elleGir'), 'buton-ikincil', function () {
          elleAcik[adres.anaBilgisayar] = !elleAcik[adres.anaBilgisayar];
          cizTumu();
        }));
      }
      if (sabit) {
        dugmeler.appendChild(dugme(t('ayar.baglanti.sert.sabitKaldir'), 'buton-ikincil', function () { sabitKaldirTiklandi(adres.anaBilgisayar); }));
      }
      kutu.appendChild(dugmeler);

      if (adres.tur && elleAcik[adres.anaBilgisayar]) {
        const giris = belge.createElement('div');
        giris.className = 'baglanti-satir';
        const alan = belge.createElement('input');
        alan.type = 'text';
        alan.maxLength = 120;
        alan.value = elleDegerleri[adres.anaBilgisayar] || '';
        alan.placeholder = 'AA:BB:CC:…';
        alan.setAttribute('aria-label', t('ayar.baglanti.sert.parmakEtiketi'));
        alan.setAttribute('spellcheck', 'false');
        alan.setAttribute('autocomplete', 'off');
        alan.addEventListener('input', function () { elleDegerleri[adres.anaBilgisayar] = alan.value; });
        giris.appendChild(alan);
        giris.appendChild(dugme(t('ayar.baglanti.sert.sabitle'), 'buton-birincil', function () {
          sabitleTiklandi(adres.tur, elleDegerleri[adres.anaBilgisayar] || '');
        }));
        kutu.appendChild(giris);
      }
      return kutu;
    }

    function adresleriCiz() {
      adresListesi.replaceChildren();
      const adresler = sertifika.adresler || [];
      if (adresler.length === 0) adresListesi.appendChild(satir('ipucu', t('ayar.baglanti.sert.adresYok')));
      const gorunenler = {};
      adresler.forEach(function (adres) {
        gorunenler[adres.anaBilgisayar] = true;
        adresListesi.appendChild(adresBloguCiz(adres, sabitBul(adres.anaBilgisayar)));
      });
      // Ayardaki adreslerle eşleşmeyen (adres sonradan değişmiş) sabitlemeler: kaldırılabilsin diye listelenir.
      sertifika.sabit.forEach(function (s) {
        if (!gorunenler[s.anaBilgisayar]) adresListesi.appendChild(adresBloguCiz({ tur: '', anaBilgisayar: s.anaBilgisayar, kapi: 443 }, s));
      });
    }

    function okunanCiz() {
      okunanKutu.replaceChildren();
      if (!okunan) {
        okunanKutu.style.display = 'none';
        return;
      }
      okunanKutu.style.display = '';
      const baslik = satir('', t('ayar.baglanti.sert.okunanBaslik'));
      baslik.style.fontWeight = '600';
      okunanKutu.appendChild(baslik);
      okunanKutu.appendChild(satir('', adresAdi(okunan)));
      okunanKutu.appendChild(satir('', t('ayar.baglanti.sert.okunanKonu', { ad: okunan.ad })));
      okunanKutu.appendChild(satir('', t('ayar.baglanti.sert.okunanVeren', { ad: okunan.veren })));
      okunanKutu.appendChild(satir('', t('ayar.baglanti.sert.okunanGecerlilik', { bas: tarihKisa(okunan.baslangic), bit: tarihKisa(okunan.bitis) })));
      if (okunan.sanlar && okunan.sanlar.length > 0) {
        okunanKutu.appendChild(satir('', t('ayar.baglanti.sert.okunanAdlar', { adlar: okunan.sanlar.join(', ') })));
      }
      okunanKutu.appendChild(satir('', t('ayar.baglanti.sert.parmakEtiketi')));
      okunanKutu.appendChild(satir('baglanti-parmak', okunan.parmakBicimli));
      okunanKutu.appendChild(satir('ipucu', t(okunan.sistemGuveniyor ? 'ayar.baglanti.sert.okunanSistem1' : 'ayar.baglanti.sert.okunanSistem0')));
      okunanKutu.appendChild(satir('ipucu', t('ayar.baglanti.sert.okunanUyari')));
      const dugmeler = belge.createElement('div');
      dugmeler.className = 'buton-satiri';
      dugmeler.appendChild(dugme(t('ayar.baglanti.sert.okunanSabitle'), 'buton-birincil', function () { sabitleTiklandi(okunan.tur, okunan.parmak); }));
      dugmeler.appendChild(dugme(t('ayar.baglanti.sert.okunanVazgec'), 'buton-ikincil', function () {
        okunan = null;
        okunanCiz();
      }));
      okunanKutu.appendChild(dugmeler);
    }

    function caCiz() {
      caListesi.replaceChildren();
      if (sertifika.ca.length === 0) {
        caListesi.appendChild(satir('ipucu', t('ayar.baglanti.sert.caYok')));
        return;
      }
      sertifika.ca.forEach(function (k) {
        const kutu = belge.createElement('div');
        kutu.className = 'baglanti-kutu';
        kutu.setAttribute('role', 'listitem');
        kutu.appendChild(satir('', t('ayar.baglanti.sert.caSatir', { ad: k.ad, bitis: tarihKisa(k.bitis) })));
        kutu.appendChild(satir('baglanti-parmak', k.parmakBicimli));
        const dugmeler = belge.createElement('div');
        dugmeler.className = 'buton-satiri';
        dugmeler.appendChild(dugme(t('ayar.baglanti.sert.caKaldir'), 'buton-ikincil', function () { caKaldirTiklandi(k.parmak); }, t('ayar.baglanti.sert.caKaldirEtiket', { ad: k.ad })));
        kutu.appendChild(dugmeler);
        caListesi.appendChild(kutu);
      });
    }

    function cizTumu() {
      adresleriCiz();
      okunanCiz();
      caCiz();
      caEkleDugme.disabled = mesgul || sertifika.ca.length >= (sertifika.enCokCa || 4);
      iletiYaz();
    }

    function durumuUygula(durum) {
      if (!durum || !durum.sertifika) return;
      sertifika = {
        ca: Array.isArray(durum.sertifika.ca) ? durum.sertifika.ca : [],
        sabit: Array.isArray(durum.sertifika.sabit) ? durum.sertifika.sabit : [],
        adresler: Array.isArray(durum.sertifika.adresler) ? durum.sertifika.adresler : [],
        enCokCa: durum.sertifika.enCokCa,
      };
      cizTumu();
    }

    async function yenile() {
      if (!kopru || typeof kopru.baglantiDurumuGetir !== 'function') return null;
      let durum = null;
      try {
        durum = await kopru.baglantiDurumuGetir();
      } catch (err) {
        durum = null;
      }
      if (durum && durum.ok) durumuUygula(durum);
      return durum;
    }

    /** Bir işlemi kilitli çalıştırır; iş bitince durum yeniden çekilir ve çizilir. */
    async function calistir(is) {
      if (mesgul) return;
      mesgul = true;
      cizTumu();
      try {
        await is();
      } catch (err) {
        iletisi({ anahtar: GENEL_HATA, tur: 'hata' });
      } finally {
        mesgul = false;
        await yenile();
        cizTumu();
      }
    }

    function okuTiklandi(tur) {
      return calistir(async function () {
        okunan = null;
        iletisi({ anahtar: 'ayar.baglanti.sinaniyor' });
        const yanit = await kopru.sertifikaOku(tur);
        if (yanit && yanit.ok) {
          okunan = yanit;
          ileti = null;
        } else {
          hataIletisi(yanit && yanit.neden);
        }
      });
    }

    function sabitleTiklandi(tur, parmak) {
      return calistir(async function () {
        const yanit = await kopru.parmakIziniSabitle(tur, parmak);
        if (yanit && yanit.ok) {
          okunan = null;
          elleAcik = {};
          elleDegerleri = {};
          iletisi({ anahtar: 'ayar.baglanti.sert.sabitlendi', tur: 'tamam' });
        } else {
          hataIletisi(yanit && yanit.neden);
        }
      });
    }

    function sabitKaldirTiklandi(anaBilgisayar) {
      if (mesgul || !onayIste(t('ayar.baglanti.sert.sabitKaldirOnay'))) return Promise.resolve();
      return calistir(async function () {
        const yanit = await kopru.parmakSabitlemeyiKaldir(anaBilgisayar);
        if (yanit && yanit.ok) iletisi({ anahtar: 'ayar.baglanti.sert.sabitKaldirildi', tur: 'tamam' });
        else hataIletisi(yanit && yanit.neden);
      });
    }

    function caEkleTiklandi() {
      return calistir(async function () {
        const yanit = await kopru.kokSertifikaEkle();
        if (yanit && yanit.ok) {
          iletisi({ anahtar: yanit.atlanan > 0 ? 'ayar.baglanti.sert.caEklendiAtlanan' : 'ayar.baglanti.sert.caEklendi', tur: 'tamam' });
        } else if (yanit && yanit.iptal) {
          ileti = null; // dosya seçimi kapatıldı: hata değil
        } else {
          hataIletisi(yanit && yanit.neden);
        }
      });
    }

    function caKaldirTiklandi(parmak) {
      if (mesgul || !onayIste(t('ayar.baglanti.sert.caKaldirOnay'))) return Promise.resolve();
      return calistir(async function () {
        const yanit = await kopru.kokSertifikayiKaldir(parmak);
        if (yanit && yanit.ok) iletisi({ anahtar: 'ayar.baglanti.sert.caKaldirildi', tur: 'tamam' });
        else hataIletisi(yanit && yanit.neden);
      });
    }

    caEkleDugme.addEventListener('click', function () { caEkleTiklandi(); });

    function yukle() {
      return yenile();
    }

    function metinleriYenile() {
      cizTumu();
    }

    okunanKutu.style.display = 'none';
    cizTumu();

    return {
      yukle: yukle,
      metinleriYenile: metinleriYenile,
    };
  }

  kok.EvAyarlarSertifika = {
    SERTIFIKA_HATALARI: SERTIFIKA_HATALARI,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
