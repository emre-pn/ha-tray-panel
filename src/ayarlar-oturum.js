/*
 * Ayarlar sayfasının "Tarayıcıyla giriş" bölümü (renderer) — 1.4.0 bağlantı grubu (o-57).
 * ayarlar.js bu dosyayı `window.EvAyarlarOturum.kur(ortak)` ile bağlar; yüklenmezse Ayarlar bugünkü gibi çalışır.
 *
 *  - Tarayıcıyı açan, dinleyiciyi başlatan ve jetonu alan her şey ANA SÜREÇTE yapılır. Bu sayfa yalnız düğmeye basıldığında istek gönderir ve
 *    durumu gösterir; kod, state, erişim ya da yenileme anahtarı bu sayfaya HİÇ gelmez (yanıtlarda yoktur).
 *  - Durum değişimi iki yoldan öğrenilir: ana süreç `onOturumDegisti` olayı gönderir; olay bir sebeple gelmezse bekleme sürerken kısa aralıkla
 *    yeniden sorulur.
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  // Ana sürecin neden kodları (oauth-yoneticisi.js nedenKodu/girisBaslat) -> sözlük anahtarı. Anahtarlar düz dize olarak yazılır
  // (ölü anahtar denetimi bunları görür).
  const GIRIS_HATALARI = {
    suruyor: 'ayar.baglanti.oturum.hata.suruyor',
    'sifreleme-yok': 'ayar.baglanti.oturum.hata.sifrelemeYok',
    'adres-yok': 'ayar.baglanti.oturum.hata.adresYok',
    dinleyici: 'ayar.baglanti.oturum.hata.dinleyici',
    tarayici: 'ayar.baglanti.oturum.hata.tarayici',
    'kod-reddedildi': 'ayar.baglanti.oturum.hata.kodReddedildi',
    'yanit-gecersiz': 'ayar.baglanti.oturum.hata.yanitGecersiz',
    saklanamadi: 'ayar.baglanti.oturum.hata.saklanamadi',
    'cok-fazla-deneme': 'ayar.baglanti.oturum.hata.cokFazlaDeneme',
    baglanti: 'ayar.baglanti.oturum.hata.baglanti',
    yasak: 'ayar.baglanti.oturum.hata.yasak',
    sunucu: 'ayar.baglanti.oturum.hata.sunucu',
    adres: 'ayar.baglanti.oturum.hata.adres',
    engelli: 'ayar.baglanti.oturum.hata.engelli',
  };
  const GENEL_HATA = 'ayar.baglanti.oturum.hata.genel';
  const YOKLAMA_ARALIGI_MS = 2500;

  function hataAnahtari(neden) {
    return Object.prototype.hasOwnProperty.call(GIRIS_HATALARI, neden) ? GIRIS_HATALARI[neden] : GENEL_HATA;
  }

  function kur(ortak) {
    const belge = ortak.belge;
    const kopru = ortak.kopru;
    const t = ortak.cevir;
    const onayIste = ortak.onayIste || function () { return true; };
    const elleAnahtarVarMi = ortak.elleAnahtarVarMi || function () { return false; };
    const degistiHaberi = ortak.degisti || function () {};
    const zamanlayici = ortak.zamanlayici || { setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (id) { clearTimeout(id); } };
    const $ = function (kimlik) { return belge.getElementById(kimlik); };

    const durumKutusu = $('oturumDurum');
    const girisDugmesi = $('btnOturumGiris');
    const iptalDugmesi = $('btnOturumIptal');
    const cikisDugmesi = $('btnOturumCikis');
    const sonucSatiri = $('oturumSonuc');

    let oturum = null; // ana sürecin son durum yanıtı (jeton içermez)
    let ileti = null; // { anahtar, degiskenler, tur }: dil değişince aynı durumdan yeniden yazılır
    let mesgul = false;
    let girisGoruldu = false; // bu sayfa oturumunda bir giriş başladı/sürerken görüldü (eski sonuç ilk yüklemede gösterilmez)
    let yoklamaId = null;

    function iletiYaz() {
      sonucSatiri.className = 'ipucu' + (ileti && ileti.tur === 'hata' ? ' alan-sonuc-sorun' : ileti && ileti.tur === 'tamam' ? ' alan-sonuc-tamam' : '');
      sonucSatiri.textContent = ileti ? t(ileti.anahtar, ileti.degiskenler) : '';
    }

    function iletisi(yeni) {
      ileti = yeni;
      iletiYaz();
    }

    function durumMetni() {
      if (!oturum) return '';
      if (oturum.asama === 'bekliyor') return t('ayar.baglanti.oturum.durum.bekliyor', { dk: Math.max(1, Math.ceil((oturum.kalanSn || 0) / 60)) });
      if (oturum.asama === 'tamamlaniyor') return t('ayar.baglanti.oturum.durum.tamamlaniyor');
      if (!oturum.var) return t('ayar.baglanti.oturum.durum.yok');
      if (!oturum.cozuldu) return t('ayar.baglanti.oturum.durum.cozulemedi');
      if (oturum.erisim === 'yenilenemedi') return t('ayar.baglanti.oturum.durum.yenilenemedi');
      return t('ayar.baglanti.oturum.durum.var', { ana: oturum.anaBilgisayar || '' });
    }

    function ciz() {
      const asama = oturum ? oturum.asama : 'yok';
      durumKutusu.textContent = durumMetni();
      girisDugmesi.disabled = mesgul || asama !== 'yok';
      iptalDugmesi.style.display = asama === 'bekliyor' ? 'inline-flex' : 'none';
      iptalDugmesi.disabled = mesgul;
      cikisDugmesi.style.display = oturum && oturum.var && asama === 'yok' ? 'inline-flex' : 'none';
      cikisDugmesi.disabled = mesgul;
      iletiYaz();
    }

    /** Giriş sonucunu (ana süreçteki `son`) bir iletiye çevirir; yalnız bu sayfa bir girişi başlatmış/izlemişse. */
    function sonucuIsle(onceki, yeni) {
      const surerken = yeni && (yeni.asama === 'bekliyor' || yeni.asama === 'tamamlaniyor');
      if (surerken) {
        girisGoruldu = true;
        return;
      }
      if (!girisGoruldu || !yeni || !yeni.son) return;
      girisGoruldu = false;
      const son = yeni.son;
      if (son.sonuc === 'tamam') iletisi({ anahtar: 'ayar.baglanti.oturum.sonuc.tamam', tur: 'tamam' });
      else if (son.sonuc === 'iptal') iletisi({ anahtar: 'ayar.baglanti.oturum.sonuc.iptal' });
      else if (son.sonuc === 'zaman-asimi') iletisi({ anahtar: 'ayar.baglanti.oturum.sonuc.zamanAsimi', tur: 'hata' });
      else iletisi({ anahtar: hataAnahtari(son.neden), tur: 'hata' });
      degistiHaberi(son.sonuc);
    }

    function yoklamayiPlanla() {
      zamanlayici.clearTimeout(yoklamaId);
      yoklamaId = null;
      if (oturum && (oturum.asama === 'bekliyor' || oturum.asama === 'tamamlaniyor')) {
        yoklamaId = zamanlayici.setTimeout(function () { yoklamaId = null; yenile(); }, YOKLAMA_ARALIGI_MS);
      }
    }

    async function yenile() {
      if (!kopru || typeof kopru.oturumDurumuGetir !== 'function') return null;
      let yanit = null;
      try {
        yanit = await kopru.oturumDurumuGetir();
      } catch (err) {
        yanit = null;
      }
      if (!yanit || !yanit.ok || !yanit.oturum) return null;
      const onceki = oturum;
      oturum = yanit.oturum;
      // Oturum arka planda sona erdiyse (HA yenileme anahtarını reddetti) anahtar bölümü de tazelenir
      const sonlandi = onceki && onceki.var && !oturum.var && oturum.asama === 'yok' && !mesgul;
      sonucuIsle(onceki, oturum);
      ciz();
      yoklamayiPlanla();
      if (sonlandi && !ileti) degistiHaberi('sonlandi');
      return oturum;
    }

    async function girisTiklandi() {
      if (mesgul) return;
      if (!onayIste(t(elleAnahtarVarMi() ? 'ayar.baglanti.oturum.girisOnayAnahtar' : 'ayar.baglanti.oturum.girisOnay'))) return;
      mesgul = true;
      iletisi(null);
      ciz();
      try {
        const yanit = await kopru.tarayiciGirisiBaslat();
        if (yanit && yanit.ok) {
          girisGoruldu = true;
        } else {
          iletisi({ anahtar: hataAnahtari(yanit && yanit.neden), tur: 'hata' });
        }
      } catch (err) {
        iletisi({ anahtar: GENEL_HATA, tur: 'hata' });
      } finally {
        mesgul = false;
        await yenile();
      }
    }

    async function iptalTiklandi() {
      if (mesgul) return;
      mesgul = true;
      ciz();
      try {
        await kopru.tarayiciGirisiniIptalEt();
        girisGoruldu = false;
        iletisi({ anahtar: 'ayar.baglanti.oturum.sonuc.iptal' });
      } catch (err) {
        iletisi({ anahtar: GENEL_HATA, tur: 'hata' });
      } finally {
        mesgul = false;
        await yenile();
      }
    }

    async function cikisTiklandi() {
      if (mesgul || !onayIste(t('ayar.baglanti.oturum.cikisOnay'))) return;
      mesgul = true;
      ciz();
      let tamam = false;
      try {
        const yanit = await kopru.tarayiciOturumunuKapat();
        if (yanit && yanit.ok) {
          tamam = true;
          iletisi({ anahtar: yanit.iptalEdildi ? 'ayar.baglanti.oturum.sonuc.cikti' : 'ayar.baglanti.oturum.sonuc.ciktiYerel', tur: yanit.iptalEdildi ? 'tamam' : undefined });
        } else {
          iletisi({ anahtar: GENEL_HATA, tur: 'hata' });
        }
      } catch (err) {
        iletisi({ anahtar: GENEL_HATA, tur: 'hata' });
      } finally {
        mesgul = false;
        await yenile();
        if (tamam) degistiHaberi('cikti');
      }
    }

    girisDugmesi.addEventListener('click', function () { girisTiklandi(); });
    iptalDugmesi.addEventListener('click', function () { iptalTiklandi(); });
    cikisDugmesi.addEventListener('click', function () { cikisTiklandi(); });

    if (kopru && typeof kopru.onOturumDegisti === 'function') {
      kopru.onOturumDegisti(function () { yenile(); });
    }

    ciz();

    return {
      yukle: yenile,
      metinleriYenile: ciz,
    };
  }

  kok.EvAyarlarOturum = {
    GIRIS_HATALARI: GIRIS_HATALARI,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
