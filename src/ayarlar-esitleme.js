/*
 * Ayarlar sayfasının "Klasörle eşitleme" bölümü (renderer) — 1.4.0 bağlantı grubu (o-58).
 * ayarlar.js bu dosyayı `window.EvAyarlarEsitleme.kur(ortak)` ile bağlar; yüklenmezse Ayarlar bugünkü gibi çalışır.
 *
 *  - Klasörü yalnız ANA SÜREÇ diyaloğu seçer; bu sayfa yol yazamaz ve yol göndermez. Dosyayı okuyan/yazan, bölümleri doğrulayan, güvenlik
 *    süzgecinden geçiren ve parolayı saklayan her şey ana süreçtedir. Parola yalnız "Parolayı kaydet" ile bir kez gönderilir, alan hemen
 *    temizlenir ve hiçbir yanıtta geri dönmez (yalnız "parola var mı" bilgisi gelir).
 *  - Durum iki yoldan öğrenilir: ana süreç `onEsitlemeDegisti` olayını gönderir; eşitleme sürerken olay gelmezse kısa aralıkla yeniden sorulur.
 *  - Klasörden bölüm alındığında (son.uygulanan > 0) `ortak.degisti('uygulandi', sayi)` çağrılır; sayfa kaydedilmemiş değişikliği olmadığında
 *    ayarları yeniler (ayarlar.js).
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  // Ana sürecin neden kodları (esitleme-yoneticisi.js) -> sözlük anahtarı. Anahtarlar düz dize olarak yazılır (ölü anahtar denetimi bunları görür).
  const HATALAR = {
    'klasor-yok': 'ayar.esitleme.hata.klasorYok',
    okunamadi: 'ayar.esitleme.hata.okunamadi',
    yazilamadi: 'ayar.esitleme.hata.yazilamadi',
    'parola-gerekli': 'ayar.esitleme.hata.parolaGerekli',
    'parola-yanlis': 'ayar.esitleme.hata.parolaYanlis',
    'parola-okunamadi': 'ayar.esitleme.hata.parolaOkunamadi',
    'daha-yeni': 'ayar.esitleme.hata.dahaYeni',
    'gizli-deger': 'ayar.esitleme.hata.gizliDeger',
    'cok-buyuk': 'ayar.esitleme.hata.cokBuyuk',
    bozuk: 'ayar.esitleme.hata.bozuk',
    'bolum-uygulanamadi': 'ayar.esitleme.hata.bolumUygulanamadi',
    'bolum-yok': 'ayar.esitleme.hata.bolumYok',
    'yol-gecersiz': 'ayar.esitleme.hata.yolGecersiz',
    'yasak-klasor': 'ayar.esitleme.hata.yasakKlasor',
    'sifreleme-yok': 'ayar.esitleme.parola.sifrelemeYok',
    saklanamadi: 'ayar.esitleme.hata.saklanamadi',
    'parola-gecersiz': 'ayar.esitleme.hata.parolaGecersiz',
    'ayar-yazilamadi': 'ayar.kaydet.kaydedilemedi',
    kapali: 'ayar.esitleme.durum.kapali',
  };
  const GENEL_HATA = 'ayar.esitleme.hata.genel';
  const YOKLAMA_ARALIGI_MS = 2000;
  const BOLUM_SIRASI = ['favoriler', 'kisayollar', 'gorunum', 'bilgi', 'bildirim'];

  function hataAnahtari(neden) {
    return Object.prototype.hasOwnProperty.call(HATALAR, neden) ? HATALAR[neden] : GENEL_HATA;
  }

  function kur(ortak) {
    const belge = ortak.belge;
    const kopru = ortak.kopru;
    const t = ortak.cevir;
    const onayIste = ortak.onayIste || function () { return true; };
    const degistiHaberi = ortak.degisti || function () {};
    const zamanBicimle = ortak.zamanBicimle || function (ms) {
      try {
        return new Date(ms).toLocaleString();
      } catch (err) {
        return '';
      }
    };
    const zamanlayici = ortak.zamanlayici || { setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (id) { clearTimeout(id); } };
    const $ = function (kimlik) { return belge.getElementById(kimlik); };

    const klasorKutusu = $('esitlemeKlasor');
    const klasorDugmesi = $('btnEsitlemeKlasor');
    const acikKutusu = $('esitlemeAcik');
    const bolumKutulari = {
      favoriler: $('esitlemeBolumFavoriler'),
      kisayollar: $('esitlemeBolumKisayollar'),
      gorunum: $('esitlemeBolumGorunum'),
      bilgi: $('esitlemeBolumBilgi'),
      bildirim: $('esitlemeBolumBildirim'),
    };
    const parolaGirdisi = $('esitlemeParola');
    const parolaKaydetDugmesi = $('btnEsitlemeParolaKaydet');
    const parolaSilDugmesi = $('btnEsitlemeParolaSil');
    const parolaDurumu = $('esitlemeParolaDurum');
    const simdiDugmesi = $('btnEsitlemeSimdi');
    const durumSatiri = $('esitlemeDurum');
    const sonucSatiri = $('esitlemeSonuc');

    let esitleme = null; // ana sürecin son durum yanıtı (parola içermez)
    let ileti = null; // { anahtar, degiskenler, tur }: dil değişince aynı durumdan yeniden yazılır
    let mesgul = false;
    let gorulenSon; // en son işlenen `son.zaman` (undefined: henüz hiç okunmadı; ilk okumada "yeni alındı" sayılmaz)
    let yoklamaId = null;

    function iletiYaz() {
      sonucSatiri.className = 'ipucu' + (ileti && ileti.tur === 'hata' ? ' alan-sonuc-sorun' : ileti && ileti.tur === 'tamam' ? ' alan-sonuc-tamam' : '');
      sonucSatiri.textContent = ileti ? t(ileti.anahtar, ileti.degiskenler) : '';
    }

    function iletisi(yeni) {
      ileti = yeni;
      iletiYaz();
    }

    function hataIletisi(neden) {
      iletisi({ anahtar: hataAnahtari(neden), tur: 'hata' });
    }

    function acikMi() {
      return !!(esitleme && esitleme.acik);
    }

    function durumMetni() {
      if (!esitleme) return '';
      if (!esitleme.acik) return t('ayar.esitleme.durum.kapali');
      if (esitleme.asama === 'esitleniyor') return t('ayar.esitleme.durum.esitleniyor');
      if (esitleme.asama === 'hata') return t(hataAnahtari(esitleme.neden));
      if (esitleme.asama === 'tamam' && esitleme.son) {
        return t('ayar.esitleme.durum.tamam', { zaman: zamanBicimle(esitleme.son.zaman), alinan: esitleme.son.uygulanan || 0, yazilan: esitleme.son.yazilan || 0 });
      }
      if (esitleme.asama === 'tamam') return t('ayar.esitleme.durum.guncel');
      return t('ayar.esitleme.durum.bekliyor');
    }

    function parolaMetni() {
      if (!esitleme) return '';
      if (esitleme.parolaVar) return t('ayar.esitleme.parola.var');
      if (!esitleme.sifrelemeVar) return t('ayar.esitleme.parola.sifrelemeYok');
      return t('ayar.esitleme.parola.yok');
    }

    function ciz() {
      const klasor = esitleme && esitleme.klasor ? esitleme.klasor : '';
      klasorKutusu.textContent = klasor || t('ayar.esitleme.klasorYok');
      klasorDugmesi.disabled = mesgul;

      acikKutusu.checked = acikMi();
      acikKutusu.disabled = mesgul || !klasor;

      const secili = esitleme && Array.isArray(esitleme.bolumler) ? esitleme.bolumler : [];
      BOLUM_SIRASI.forEach(function (ad) {
        bolumKutulari[ad].checked = secili.indexOf(ad) >= 0;
        bolumKutulari[ad].disabled = mesgul || !esitleme;
      });

      parolaDurumu.textContent = parolaMetni();
      parolaKaydetDugmesi.disabled = mesgul || !esitleme || !esitleme.sifrelemeVar;
      parolaGirdisi.disabled = mesgul || !esitleme || !esitleme.sifrelemeVar;
      parolaSilDugmesi.style.display = esitleme && esitleme.parolaVar ? 'inline-flex' : 'none';
      parolaSilDugmesi.disabled = mesgul;

      simdiDugmesi.disabled = mesgul || !acikMi() || (esitleme && esitleme.asama === 'esitleniyor');
      durumSatiri.textContent = durumMetni();
      iletiYaz();
    }

    function yoklamayiPlanla() {
      zamanlayici.clearTimeout(yoklamaId);
      yoklamaId = null;
      if (esitleme && esitleme.acik && esitleme.asama === 'esitleniyor') {
        yoklamaId = zamanlayici.setTimeout(function () { yoklamaId = null; yenile(); }, YOKLAMA_ARALIGI_MS);
      }
    }

    /** Ana sürecin yanıtındaki durumu alır; klasörden yeni bölüm alındıysa üst katmana haber verir. */
    function durumuAl(yeni) {
      esitleme = yeni;
      const son = yeni && yeni.son ? yeni.son : null;
      if (gorulenSon === undefined) {
        gorulenSon = son ? son.zaman : null;
      } else if (son && son.zaman !== gorulenSon) {
        gorulenSon = son.zaman;
        if (son.uygulanan > 0) degistiHaberi('uygulandi', son.uygulanan);
      }
      ciz();
      yoklamayiPlanla();
    }

    async function yenile() {
      if (!kopru || typeof kopru.esitlemeDurumuGetir !== 'function') return null;
      let yanit = null;
      try {
        yanit = await kopru.esitlemeDurumuGetir();
      } catch (err) {
        yanit = null;
      }
      if (!yanit || !yanit.ok || !yanit.esitleme) {
        yoklamayiPlanla(); // tek bir başarısız istek yoklama zincirini koparmasın (olay da gelmezse arayüz 'eşitleniyor'da takılırdı)
        return null;
      }
      durumuAl(yanit.esitleme);
      return esitleme;
    }

    /**
     * Eylem sürerken odaktaki anahtar/düğme pasifleşir ve odak gövdeye düşer: odak başka yere gitmediyse eylem bitince önceki öğeye
     * (görünür ve etkinse; gizlenen "Parolayı kaldır" için parola alanına) geri verilir. Klavye kullanıcısı Tab'a baştan başlamak zorunda kalmasın.
     */
    function odagiGeriVer(onceki) {
      const aktif = belge.activeElement;
      if (aktif && aktif !== belge.body) return;
      const kullanilabilir = function (oge) { return !!oge && oge !== belge.body && !oge.disabled && oge.style.display !== 'none'; };
      const hedef = kullanilabilir(onceki) ? onceki : onceki === parolaSilDugmesi ? parolaGirdisi : null;
      if (kullanilabilir(hedef) && typeof hedef.focus === 'function') hedef.focus();
    }

    /** Bir eylemi çalıştırır: işlem sürerken düğmeler kilitlenir; yanıttaki durum alınır. Başarıda `tamamIletisi`, hatada neden yazılır. */
    async function eylem(cagri, tamamIletisi) {
      if (mesgul) return null;
      const onceki = belge.activeElement;
      mesgul = true;
      iletisi(null);
      ciz();
      let yanit = null;
      try {
        yanit = await cagri();
        const yeniDurum = yanit && yanit.esitleme ? yanit.esitleme : null;
        if (yeniDurum) durumuAl(yeniDurum);
        const durumHatada = !!(yeniDurum && yeniDurum.acik && yeniDurum.asama === 'hata'); // hata durum satırında zaten yazılı
        if (yanit && yanit.ok) {
          if (tamamIletisi && !durumHatada) iletisi({ anahtar: tamamIletisi, tur: 'tamam' });
        } else if (!(yanit && yanit.iptal) && !durumHatada) {
          hataIletisi(yanit && yanit.neden);
        }
      } catch (err) {
        hataIletisi('');
      } finally {
        mesgul = false;
        await yenile();
        ciz();
        odagiGeriVer(onceki);
      }
      return yanit;
    }

    function seciliBolumler() {
      return BOLUM_SIRASI.filter(function (ad) { return bolumKutulari[ad].checked; });
    }

    async function klasorTiklandi() {
      if (mesgul || typeof kopru.esitlemeKlasoruSec !== 'function') return;
      await eylem(function () { return kopru.esitlemeKlasoruSec(); }, 'ayar.esitleme.sonuc.klasorSecildi');
    }

    async function acikDegisti() {
      const ac = acikKutusu.checked;
      if (mesgul) {
        acikKutusu.checked = acikMi();
        return;
      }
      // Klasörde zaten eşitlenmiş bir dosya varken açmak yerel bölümleri klasördekiyle değiştirir: önce sorulur.
      if (ac && esitleme && esitleme.dosyaVar && !onayIste(t('ayar.esitleme.acOnay'))) {
        acikKutusu.checked = false;
        return;
      }
      await eylem(function () { return kopru.esitlemeyiAyarla({ acik: ac }); }, ac ? 'ayar.esitleme.sonuc.acildi' : 'ayar.esitleme.sonuc.kapandi');
    }

    async function bolumDegisti() {
      if (mesgul) {
        ciz();
        return;
      }
      const liste = seciliBolumler(); // eylem() başlarken kutuları kayıtlı duruma göre yeniden çizer: seçim önce okunur
      await eylem(function () { return kopru.esitlemeyiAyarla({ bolumler: liste }); }, 'ayar.esitleme.sonuc.bolumler');
    }

    async function simdiTiklandi() {
      await eylem(function () { return kopru.simdiEsitle(); }, null);
    }

    async function parolaKaydetTiklandi() {
      if (mesgul) return;
      const deger = parolaGirdisi.value;
      parolaGirdisi.value = ''; // alan hemen temizlenir; değer yalnız bu çağrıda ana sürece gider
      if (deger === '') {
        hataIletisi('parola-gecersiz');
        return;
      }
      await eylem(function () { return kopru.esitlemeParolasiniKaydet(deger); }, 'ayar.esitleme.sonuc.parolaKaydedildi');
    }

    async function parolaSilTiklandi() {
      if (mesgul || !onayIste(t('ayar.esitleme.parolaSilOnay'))) return;
      await eylem(function () { return kopru.esitlemeParolasiniSil(); }, 'ayar.esitleme.sonuc.parolaKaldirildi');
    }

    klasorDugmesi.addEventListener('click', function () { klasorTiklandi(); });
    acikKutusu.addEventListener('change', function () { acikDegisti(); });
    BOLUM_SIRASI.forEach(function (ad) {
      bolumKutulari[ad].addEventListener('change', function () { bolumDegisti(); });
    });
    parolaKaydetDugmesi.addEventListener('click', function () { parolaKaydetTiklandi(); });
    parolaSilDugmesi.addEventListener('click', function () { parolaSilTiklandi(); });
    simdiDugmesi.addEventListener('click', function () { simdiTiklandi(); });

    if (kopru && typeof kopru.onEsitlemeDegisti === 'function') {
      kopru.onEsitlemeDegisti(function () { yenile(); });
    }

    ciz();

    return {
      yukle: yenile,
      metinleriYenile: ciz,
    };
  }

  kok.EvAyarlarEsitleme = {
    HATALAR: HATALAR,
    BOLUM_SIRASI: BOLUM_SIRASI,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
