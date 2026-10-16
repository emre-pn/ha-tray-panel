/*
 * Ayarlar sayfasının betiği (renderer). Köprü: preload.js (window.evPaneli); kısayol ve arama yardımcıları: lib/kisayol.js, lib/arama.js.
 * Tüm metinler YALNIZ textContent ile yazılır (HTML olarak yorumlanan atama yok); sayfa CSP'li ve satır içi betiksizdir (hata-17).
 * Erişim anahtarı yalnız "yeni anahtar" alanından ana sürece gider; geri dönmez.
 *
 * Kaydetme modeli: tek "Kaydet" çubuğu genel ayarları ve favorileri birlikte kaydeder; erişim anahtarı ayrı doğrulanır ve kaydedilir.
 * Yenileme bölüm bölümdür: bir bölüm kaydedilince YALNIZ o bölüm sunucudaki değerlere döner, başka bölümlerdeki kaydedilmemiş
 * düzenlemeler (örn. anahtar kaydı sırasında favori seçimi) kaybolmaz. Kaydedilmemiş değişiklik göstergesi ve kapatma onayı bu
 * karşılaştırmadan beslenir.
 *
 * Arayüz dili (Türkçe / English): HTML'deki Türkçe metinler varsayılandır; İngilizce seçiliyse data-i18n işaretli öğeler çalışma anında
 * değiştirilir (lib/dil.js sayfayiCevir). JS'in yazdığı metinler `t('anahtar')` ile alınır (sözlük: lib/ceviri/ayarlar.js, ortak iletiler
 * lib/ceviri/ana.js). Metin bir durumdan türüyorsa (rozetler, uyarılar, satırlar) durum saklanır ve dil değişince `metinleriYenile`
 * aynı durumdan yeniden yazar; sunucudan hazır gelen iletiler (ana süreç kendi dilinde yazar) dil değişince yeniden istenir.
 */
(function () {
  'use strict';

  const Kisayol = window.EvKisayol || null;
  const Arama = window.EvArama || null;
  const Dil = window.EvDil || null;
  const SozlukAyarlar = window.EvCeviriAyarlar || null;
  const SozlukAna = window.EvCeviriAna || null;
  const DuzenModulu = window.EvAyarlarDuzen || null; // 1.4.0 düzen (ayarlar-duzen.js): karo görünümü, sayfalar, geçmiş, onarım; yoksa Ayarlar bugünkü gibi çalışır

  // --- Arayüz dili -------------------------------------------------------------------------------------------------------------
  const DIL_ANAHTARI = 'evPaneli.ayarlar.dil'; // son etkin dil ('tr' | 'en'): sayfa ilk boyamadan önce doğru dilde açılsın diye
  let dil = 'tr'; // etkin dil; kayıtlı seçim (sistem/tr/en) dilSecimi alanındadır
  let t = cevirmenKur('tr');

  function cevirmenKur(hedef) {
    if (Dil) return Dil.cevirmen(hedef, SozlukAyarlar, SozlukAna);
    const yedek = function (anahtar) { return anahtar; };
    yedek.dil = hedef;
    yedek.var = function () { return false; };
    return yedek;
  }

  /** Sayıya bağlı metin: n === 1 ise `anahtar.bir`, değilse `anahtar`; {n} otomatik doldurulur. */
  function cogul(anahtar, n, degiskenler) {
    return Dil ? Dil.cogul(t, anahtar, n, degiskenler) : t(anahtar, Object.assign({ n: n }, degiskenler));
  }

  function dilTemizMi(deger) {
    return deger === 'tr' || deger === 'en';
  }

  // --- Durum ---------------------------------------------------------------------------------------------------------------
  let mevcutAyarlar = null; // son alınan ayar özeti
  let yuklenenCihazlar = [];
  let eksikFavoriler = [];
  let engelliFavoriler = [];
  let cihazlarYuklendi = false;
  const cihazHaritasi = new Map(); // kimlik -> cihaz (yüklenen listeden)
  const siraDugmeleri = new Map(); // kimlik -> { yukari, asagi } (sıra panelindeki düğmeler; taşımadan sonra odak için)
  const satirOgeleri = new Map(); // kimlik -> cihaz listesindeki satırın seçim kutusu ("Düzenle…" ile gelindiğinde odak için)
  let bekleyenOdak = ''; // cihaz listesi yüklenince odaklanılacak favori (panel menüsü "Düzenle…")
  const adHaritasi = new Map(); // kimlik -> bilinen ad (kayıtlı favori adı ya da cihaz adı)
  let seciliSira = []; // seçili kimlikler, tepsi sırasıyla (k-05)
  let kayitliSira = []; // sunucudaki favori sırası
  const kayitliOnay = new Map(); // ayardaki favorinin açık onay değeri (boolean)
  const kayitliKisayol = new Map();
  const kayitliParlaklik = new Map();
  const kayitliEtiket = new Map();
  // Bu oturumda kullanıcının DEĞİŞTİRDİĞİ değerler (kayıtlı değere eşitse silinir: geri alınan düzenleme "kirli" sayılmaz)
  const onayDegisiklikleri = new Map();
  const kisayolDegisiklikleri = new Map();
  const parlaklikDegisiklikleri = new Map();
  const etiketDegisiklikleri = new Map();
  const kisayolHatali = new Set(); // sunucunun reddettiği favori kısayolları / karo adları (satır işaretli kalır)
  const etiketHatali = new Set();
  let varsayilanKisayolMetni = 'Control+Alt+H';
  let varsayilanPaletKisayolMetni = 'Control+Alt+P';
  let kisayolDurumlari = [];
  let panolar = []; // { ad, yol, kisayol, kayitli, sunucuSira, hata } (hata: '' | 'kaydedilmedi' | 'kisayol'; metni dile göre yazılır)
  let bazGenel = null; // sunucudaki genel ayarların karşılaştırma metni (null: henüz yüklenmedi)
  let gosterilenCihazSayisi = 50;
  let bildirimZamanlayicisi = null;
  let kaydediliyor = false;
  let yuklemeSozu = null;
  let sonYedekler = null; // son alınan yedek listesi (null: henüz alınmadı); dil değişince yeniden çizilir
  let listeIletisi = null; // cihaz listesi yerine gösterilen ileti: { anahtar, ham, hata } (dil değişince yeniden yazılır)

  const EN_COK_PANO = (Kisayol && Kisayol.EN_COK_PANO) || 6;
  const CIHAZ_SAYFA_BOYUTU = 50;
  const TEPSI_UST_SAYISI = 8; // lib/tepsi-menu.js UST_SAYISI ile aynı: tepsinin üst düzeyindeki zararsız favori sayısı
  const YENIDEN_DENE_YOKLAMA_SAYISI = 6;
  const YENIDEN_DENE_ARALIK_MS = 1500;
  const YAKINLASTIRMA_ADIMLARI = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const YAKINLASTIRMA_ANAHTARI = 'evPaneli.ayarlar.yakinlastirma';
  let yakinlastirmaSirasi = 2;

  // --- Öğeler --------------------------------------------------------------------------------------------------------------
  const $ = (kimlik) => document.getElementById(kimlik);

  const bildirimSeridi = $('bildirimSeridi');
  const genelBildirim = $('genelBildirim');
  const btnBildirimKapat = $('btnBildirimKapat');
  const kurulumListesi = $('kurulumListesi');
  const yerelAdres = $('yerelAdres');
  const yerelAdresHata = $('yerelAdresHata');
  const yerelAdresSonuc = $('yerelAdresSonuc');
  const yerelAdresUyari = $('yerelAdresUyari');
  const btnYerelSina = $('btnYerelSina');
  const disAdres = $('disAdres');
  const disAdresHata = $('disAdresHata');
  const disAdresSonuc = $('disAdresSonuc');
  const btnDisSina = $('btnDisSina');
  const kisayol = $('kisayol');
  const kisayolUyarilari = $('kisayolUyarilari');
  const btnKisayolVarsayilan = $('btnKisayolVarsayilan');
  const otomatikBaslat = $('otomatikBaslat');
  const otomatikBaslatDurum = $('otomatikBaslatDurum');
  const btnOtomatikBaslatEtkinlestir = $('btnOtomatikBaslatEtkinlestir');
  const pencereBoyutu = $('pencereBoyutu');
  const odakKaybindaGizle = $('odakKaybindaGizle');
  const anaPanoyaDonDk = $('anaPanoyaDonDk');
  const anaPanoyaDonHata = $('anaPanoyaDonHata');
  const koseBildirimi = $('koseBildirimi');
  const bipSesi = $('bipSesi');
  const dilSecimi = $('dilSecimi');
  const yeniPencereMalzemesi = $('yeniPencereMalzemesi');
  const malzemeUyari = $('malzemeUyari');
  const temaZorla = $('temaZorla');
  const vurguRengi = $('vurguRengi');
  const vurguRengiSecici = $('vurguRengiSecici');
  const vurguOnizleme = $('vurguOnizleme');
  const vurguHata = $('vurguHata');
  const btnVurguSifirla = $('btnVurguSifirla');
  const btnAyarlariKaydet = $('btnAyarlariKaydet');
  const kirliGosterge = $('kirliGosterge');
  const tepsiSolTik = $('tepsiSolTik');
  const paletKisayol = $('paletKisayol');
  const paletKisayolUyarilari = $('paletKisayolUyarilari');
  const btnPaletKisayolVarsayilan = $('btnPaletKisayolVarsayilan');
  const canliBaglanti = $('canliBaglanti');
  const canliDurumMetni = $('canliDurumMetni');
  const panolarListesi = $('panolarListesi');
  const btnPanoEkle = $('btnPanoEkle');
  const btnAcikSayfaEkle = $('btnAcikSayfaEkle');
  const panoUyarilari = $('panoUyarilari');
  const btnHazirListe = $('btnHazirListe');
  const hazirListeDurum = $('hazirListeDurum');
  const gizlileriGoster = $('gizlileriGoster');
  const gizlileriGosterMetin = $('gizlileriGosterMetin');
  const favoriSirasi = $('favoriSirasi');
  const favoriSirasiListesi = $('favoriSirasiListesi');

  // 1.4.0 düzen (o-16, o-24, o-28, o-30, o-31): ayarlar-duzen.js. Kur başarısız olursa ya da dosya yoksa Ayarlar düzen bölümü olmadan çalışır.
  const duzen = (function () {
    if (!DuzenModulu) return null;
    try {
      return DuzenModulu.kur({
        belge: document,
        kopru: window.evPaneli,
        cevir: function (anahtar, degiskenler) { return t(anahtar, degiskenler); },
        cogul: function (anahtar, n, degiskenler) { return cogul(anahtar, n, degiskenler); },
        dil: function () { return dil; },
        sayfalarListesi: $('sayfalarListesi'),
        btnSayfaEkle: $('btnSayfaEkle'),
        sayfaSayaci: $('sayfaSayaci'),
        gecmisListesi: $('duzenGecmisiListesi'),
        duyuru: $('duzenDuyuru'),
        siraKabi: favoriSirasiListesi,
        kirliGuncelle: function () { kirliGuncelle(); },
        kirliMi: function () { return kirliMi(); },
        bildirimGoster: function (mesaj, tur) { bildirimGoster(mesaj, tur); },
        odakla: function (oge) { odakla(oge); },
        onayIste: function (metin) { return confirm(metin); },
        gorunenSira: function () { return gorunenSira(); },
        gorunenAd: function (kimlik) { return gorunenAd(kimlik); },
        siraDuzenlenebilir: function () { return cihazlarYuklendi; },
        favoriyiTasi: function (kimlik, yon) { favoriyiTasi(kimlik, yon); },
        favoriyiKonumaTasi: function (kimlik, hedef) { favoriyiKonumaTasi(kimlik, hedef); },
        tumunuYenile: function () { return aktarimSonrasiYenile(); },
        favoriOnarildi: function (eski, yeni) { return favoriOnarildi(eski, yeni); },
        onarmaAdaylari: function (eski) { return onarmaAdaylari(eski); },
        cihazlarYuklendi: function () { return cihazlarYuklendi; },
      });
    } catch (err) {
      return null;
    }
  })();

  const anahtarRozet = $('anahtarRozet');
  const anahtarReddedildiUyari = $('anahtarReddedildiUyari');
  const yetkiKaydiUyari = $('yetkiKaydiUyari');
  const yetkiDurumUyari = $('yetkiDurumUyari');
  const anahtarKarantinaUyari = $('anahtarKarantinaUyari');
  const btnYetkiYenidenDene = $('btnYetkiYenidenDene');
  const ikinciOnayKutusu = $('ikinciOnayKutusu');
  const ikinciOnayMetni = $('ikinciOnayMetni');
  const chkIkinciOnay = $('chkIkinciOnay');
  const anahtarGirdisi = $('anahtarGirdisi');
  const btnAnahtarGoster = $('btnAnahtarGoster');
  const anahtarUzunluk = $('anahtarUzunluk');
  const btnAnahtarKaydet = $('btnAnahtarKaydet');
  const btnAnahtarSil = $('btnAnahtarSil');

  const btnCihazlariYukle = $('btnCihazlariYukle');
  const cihazAra = $('cihazAra');
  const cihazListesi = $('cihazListesi');
  const secilenSayisi = $('secilenSayisi');
  const btnDahaFazla = $('btnDahaFazla');
  const ayarDosyasiYolu = $('ayarDosyasiYolu');

  const btnDisaAktar = $('btnDisaAktar');
  const btnIceAktar = $('btnIceAktar');
  const yedekListesi = $('yedekListesi');
  const yedekDurum = $('yedekDurum');

  // --- Pencere grubu (1.4.0: o-22 üstte tutma, o-32 konum/ekran/opaklık, o-27 tepsi rozeti, o-33 masaüstü karoları) ----------
  const panelHerZamanUstte = $('panelHerZamanUstte');
  const pencereKonumu = $('pencereKonumu');
  const tercihEkran = $('tercihEkran');
  const panelOpaklik = $('panelOpaklik');
  const panelOpaklikDegeri = $('panelOpaklikDegeri');
  const tepsiRozeti = $('tepsiRozeti');
  const tepsiRozetSensoru = $('tepsiRozetSensoru');
  const masaustuKaroListesi = $('masaustuKaroListesi');
  const masaustuKaroUstte = $('masaustuKaroUstte');
  // Masaüstüne sabitlenebilen alanlar: src/lib/masaustu-karo.js SABITLENEBILIR_ALANLAR ile aynı (ana süreç yine süzer).
  const MASAUSTU_ALANLARI = ['light', 'switch', 'fan', 'input_boolean', 'scene', 'sensor', 'binary_sensor'];
  const EN_COK_MASAUSTU_KARO = 6;
  let masaustuSecili = []; // ayardaki ve işaretlenen karo kimlikleri (ham liste; kayıtta yalnız seçili, sabitlenebilir favoriler gider)
  let tercihEkranKaydi = {}; // ayardaki tercih edilen ekran ({} = yok)
  let bagliEkranlar = []; // ayar özetindeki bağlı ekranlar: { id, etiket, x, y, genislik, yukseklik }

  // Yetki kesici (1.1.1) durumları: Home Assistant'a istek gitmiyor; kullanıcı "Yeniden dene" (TEK yeni deneme) ya da yeni anahtar seçer.
  // Değerler sözlük anahtarlarıdır (lib/ceviri/ayarlar.js); metin yazılırken t ile çözülür.
  const YETKI_DURUM_METINLERI = {
    dogrulanamadi: { rozet: 'ayar.yetki.dogrulanamadi.rozet', metin: 'ayar.yetki.dogrulanamadi.metin' },
    'kayit-onayi': { rozet: 'ayar.yetki.kayitOnayi.rozet', metin: 'ayar.yetki.kayitOnayi.metin' },
    'yerel-yasak': { rozet: 'ayar.yetki.yerelYasak.rozet', metin: 'ayar.yetki.yerelYasak.metin' },
  };
  const YETKI_KAYDI_METINLERI = {
    yazilamadi: 'ayar.yetkiKaydi.yazilamadi',
    okunamadi: 'ayar.yetkiKaydi.okunamadi',
  };
  const yetkiDurumunuBul = function (ad) { return Object.hasOwn(YETKI_DURUM_METINLERI, ad) ? YETKI_DURUM_METINLERI[ad] : undefined; };
  const yetkiKaydiniBul = function (ad) { return Object.hasOwn(YETKI_KAYDI_METINLERI, ad) ? YETKI_KAYDI_METINLERI[ad] : undefined; };

  // Hatalı alanı işaretlemek için: alan adı (sunucudaki ad) -> { girdi, hata kutusu, kapsayan <details> }
  const ALAN_KUTULARI = {
    yerelAdres: { girdi: yerelAdres, hata: yerelAdresHata },
    disAdres: { girdi: disAdres, hata: disAdresHata },
    vurguRengi: { girdi: vurguRengi, hata: vurguHata },
    anaPanoyaDonDk: { girdi: anaPanoyaDonDk, hata: anaPanoyaDonHata, detay: 'bolumPencere' },
    kisayol: { girdi: kisayol, kutu: kisayolUyarilari },
    paletKisayol: { girdi: paletKisayol, kutu: paletKisayolUyarilari },
  };

  // Bölüm bağlantıları: [bağlantı, bölüm, odaklanacak başlık]
  const BOLUM_BAGLARI = [
    ['gezinBaglanti', 'bolumBaglanti', 'baglantiBaslik'],
    ['gezinFavoriler', 'bolumFavoriler', 'favorilerBaslik'],
    ['gezinKisayollar', 'bolumKisayollar', 'kisayollarBaslik'],
    ['gezinGorunum', 'bolumGorunum', 'gorunumBaslik'],
    ['gezinAnahtar', 'bolumAnahtar', 'anahtarBaslik'],
    ['gezinDiger', 'bolumDiger', 'bolumDiger'],
    ['kurulumAdresLink', 'bolumBaglanti', 'baglantiBaslik'],
    ['kurulumAnahtarLink', 'bolumAnahtar', 'anahtarBaslik'],
    ['kurulumFavoriLink', 'bolumFavoriler', 'favorilerBaslik'],
  ];

  // --- Yardımcılar ---------------------------------------------------------------------------------------------------------
  function el(etiket, sinif, metin) {
    const e = document.createElement(etiket);
    if (sinif) e.className = sinif;
    if (metin !== undefined) e.textContent = metin;
    return e;
  }

  const bekle = (ms) => new Promise((coz) => setTimeout(coz, ms));
  const kisGoster = (deger) => (Kisayol ? Kisayol.kisayolGoster(deger) : String(deger || ''));

  /** Kaydedilen biçim: "ctrl alt k" -> "Control+Alt+K". Geçersizse yazılan metin (kırpılmış) olduğu gibi kalır; karar sunucudadır. */
  function kisNorm(deger) {
    const duz = String(deger || '').trim();
    if (duz === '') return '';
    return (Kisayol && Kisayol.kisayolNormallestir(duz)) || duz;
  }

  function odakla(oge) {
    try {
      oge.focus();
    } catch {
      /* odaklanamayan öğe */
    }
  }

  // tur: 'basarili' | 'hata' | 'uyari'. Hata ve uyarılar kapatılana dek ekranın üstünde kalır (h-01); başarı kendiliğinden kaybolur.
  function bildirimGoster(mesaj, tur, sureMs) {
    const gecerliTur = tur || 'basarili';
    genelBildirim.textContent = mesaj;
    genelBildirim.className = 'bildirim-kutusu bildirim-' + gecerliTur;
    genelBildirim.setAttribute('role', gecerliTur === 'hata' ? 'alert' : 'status');
    bildirimSeridi.style.display = 'flex';
    clearTimeout(bildirimZamanlayicisi);
    bildirimZamanlayicisi = null;
    const kalici = gecerliTur === 'hata' || (gecerliTur === 'uyari' && !sureMs);
    if (!kalici) bildirimZamanlayicisi = setTimeout(bildirimGizle, sureMs || 6000);
  }

  function bildirimGizle() {
    clearTimeout(bildirimZamanlayicisi);
    bildirimZamanlayicisi = null;
    bildirimSeridi.style.display = 'none';
    genelBildirim.textContent = '';
  }

  // Uyarı satırlarını (metin) bir kutuya yazar; boşsa kutuyu gizler.
  function uyariKutusuDoldur(kutu, mesajlar) {
    kutu.replaceChildren();
    mesajlar.forEach(function (mesaj) {
      kutu.appendChild(el('div', '', mesaj));
    });
    kutu.style.display = mesajlar.length > 0 ? 'block' : 'none';
  }

  function gecersizIsaretle(girdi, gecersiz) {
    if (gecersiz) {
      girdi.classList.add('gecersiz');
      girdi.setAttribute('aria-invalid', 'true');
    } else {
      girdi.classList.remove('gecersiz');
      girdi.removeAttribute('aria-invalid');
    }
  }

  function bolumeGit(bolumKimligi, baslikKimligi) {
    const bolum = $(bolumKimligi);
    try {
      bolum.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* kaydırma desteklenmiyor */
    }
    const baslik = $(baslikKimligi || bolumKimligi);
    try {
      baslik.focus({ preventScroll: true });
    } catch {
      /* başlık odaklanamıyor */
    }
  }

  // --- Alan işaretleme (h-01) ----------------------------------------------------------------------------------------------
  function alanIsaretle(ad, mesaj) {
    const kutu = ALAN_KUTULARI[ad];
    if (!kutu) return false;
    gecersizIsaretle(kutu.girdi, true);
    if (kutu.hata) {
      kutu.hata.textContent = mesaj || '';
      kutu.hata.style.display = mesaj ? 'block' : 'none';
    } else if (kutu.kutu && mesaj) {
      uyariKutusuDoldur(kutu.kutu, [mesaj]);
    }
    if (kutu.detay) $(kutu.detay).open = true; // katlanmış bölümdeki hatalı alan görünür olsun
    return true;
  }

  function alanTemizle(ad) {
    const kutu = ALAN_KUTULARI[ad];
    if (!kutu) return;
    gecersizIsaretle(kutu.girdi, false);
    if (kutu.hata) {
      kutu.hata.textContent = '';
      kutu.hata.style.display = 'none';
    }
  }

  function tumIsaretleriTemizle() {
    Object.keys(ALAN_KUTULARI).forEach(function (ad) {
      const kutu = ALAN_KUTULARI[ad];
      if (kutu.hata) alanTemizle(ad);
    });
  }

  function ilkHataliyaOdaklan(adlar) {
    const ad = adlar.find(function (a) { return ALAN_KUTULARI[a]; });
    if (!ad) return;
    const girdi = ALAN_KUTULARI[ad].girdi;
    try {
      girdi.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      /* kaydırma desteklenmiyor */
    }
    odakla(girdi);
  }

  // --- Bilgi kartları (o-04, o-07, o-08, o-09, o-10, o-11) ------------------------------------------------------------------
  // Hızlı panelin sensör şeridi, üst kartları, takvimi ve yapılacaklar listeleri. Alan adları src/lib/ayar-alanlari.js tablosundakilerle
  // aynıdır; değerler genelYuku içinde diğer genel ayarlarla birlikte gider, doğrulama ana süreçtedir (geçersiz değer reddedilir ve
  // alan işaretlenir). Varlık seçenekleri ana sürecin Kapı Kuralı'ndan geçirdiği listeden (cihazlar:getir: cihazlar + bilgiVarliklari)
  // gelir: kilit, alarm, kapı gibi varlıklar bu sayfaya hiç ulaşmaz. Seçili kimlikler seçenekler yüklenmemiş olsa da (HA'ya ulaşılamıyor)
  // korunur ve kaydedilir. Tüm metinler sözlükten gelir; dil değişince bilgiMetinleriniYenile seçenekleri yeniden yazar.
  const sensorGrafik = $('sensorGrafik');
  const sensorGrafikSaat = $('sensorGrafikSaat');
  const pilEsigi = $('pilEsigi');
  const pilEsigiHata = $('pilEsigiHata');
  const sensorTepsiIpucu = $('sensorTepsiIpucu');
  const ustKart1 = $('ustKart1');
  const ustKart2 = $('ustKart2');
  const havaVarligi = $('havaVarligi');
  const saatBicimi = $('saatBicimi');
  const tarihBicimi = $('tarihBicimi');
  const takvimGunSayisi = $('takvimGunSayisi');
  const takvimGunHata = $('takvimGunHata');
  const hizliListe = $('hizliListe');
  const bilgiYuklemeIpucu = $('bilgiYuklemeIpucu');

  const BILGI_SINIRLARI = { sensorSeridi: 6, takvimler: 4, yapilacakListeleri: 4 }; // src/lib/ayar-alanlari.js enCok değerleriyle aynı
  const BILGI_LISTELERI = {
    sensorSeridi: { kap: $('sensorSeridiListesi'), sec: $('sensorSeridiEkle'), dugme: $('btnSensorSeridiEkle'), ilkKaldir: null },
    takvimler: { kap: $('takvimlerListesi'), sec: $('takvimlerEkle'), dugme: $('btnTakvimlerEkle'), ilkKaldir: null },
    yapilacakListeleri: { kap: $('yapilacakListeleriListesi'), sec: $('yapilacakListeleriEkle'), dugme: $('btnYapilacakListeleriEkle'), ilkKaldir: null },
  };
  const KART_SABITLERI = [['yok', 'ayar.bilgi.kart.yok'], ['saat', 'ayar.bilgi.kart.saat'], ['hava', 'ayar.bilgi.kart.hava']];
  const bilgiSecim = { sensorSeridi: [], takvimler: [], yapilacakListeleri: [] }; // seçili kimlikler (şeritte sıra önemli)
  const bilgiAdlari = new Map(); // kimlik -> ad (yüklenen cihaz ve bilgi varlıkları)
  let bilgiAdaylari = null; // null: seçenekler henüz yüklenmedi; sonra { sensorSeridi, havalar, takvimler, yapilacakListeleri }

  Object.assign(ALAN_KUTULARI, {
    pilEsigi: { girdi: pilEsigi, hata: pilEsigiHata, detay: 'bolumBilgi' },
    takvimGunSayisi: { girdi: takvimGunSayisi, hata: takvimGunHata, detay: 'bolumBilgi' },
  });

  function bilgiDizisi(ham, enCok) {
    const sonuc = [];
    (Array.isArray(ham) ? ham : []).forEach(function (kimlik) {
      if (typeof kimlik === 'string' && kimlik !== '' && sonuc.indexOf(kimlik) < 0 && sonuc.length < enCok) sonuc.push(kimlik);
    });
    return sonuc;
  }

  function bilgiSecenektenBiri(liste, deger, varsayilan) {
    return liste.indexOf(deger) >= 0 ? deger : varsayilan;
  }

  function bilgiMetni(ham, varsayilan) {
    return typeof ham === 'string' && ham.trim() !== '' ? ham.trim() : varsayilan;
  }

  /** Form alanlarındaki bilgi değerleri (genelAnlik ile birlikte karşılaştırılır; anahtar sırası bilgiDegerleri ile aynıdır). */
  function bilgiAnlik() {
    return {
      sensorSeridi: bilgiSecim.sensorSeridi.slice(),
      sensorGrafik: sensorGrafik.checked,
      sensorGrafikSaat: String(sensorGrafikSaat.value),
      pilEsigi: String(pilEsigi.value).trim(),
      sensorTepsiIpucu: sensorTepsiIpucu.checked,
      ustKart1: bilgiMetni(ustKart1.value, 'yok'),
      ustKart2: bilgiMetni(ustKart2.value, 'yok'),
      havaVarligi: bilgiMetni(havaVarligi.value, ''),
      saatBicimi: String(saatBicimi.value),
      tarihBicimi: String(tarihBicimi.value),
      takvimler: bilgiSecim.takvimler.slice(),
      takvimGunSayisi: String(takvimGunSayisi.value).trim(),
      yapilacakListeleri: bilgiSecim.yapilacakListeleri.slice(),
      hizliListe: bilgiMetni(hizliListe.value, ''),
    };
  }

  /** Sunucu özetinin aynı biçimdeki karşılığı. */
  function bilgiDegerleri(sonuc) {
    return {
      sensorSeridi: bilgiDizisi(sonuc.sensorSeridi, BILGI_SINIRLARI.sensorSeridi),
      sensorGrafik: sonuc.sensorGrafik !== false,
      sensorGrafikSaat: String(bilgiSecenektenBiri([1, 6, 24], sonuc.sensorGrafikSaat, 6)),
      pilEsigi: String(Number.isInteger(sonuc.pilEsigi) ? sonuc.pilEsigi : 20),
      sensorTepsiIpucu: sonuc.sensorTepsiIpucu === true,
      ustKart1: bilgiMetni(sonuc.ustKart1, 'yok'),
      ustKart2: bilgiMetni(sonuc.ustKart2, 'yok'),
      havaVarligi: bilgiMetni(sonuc.havaVarligi, ''),
      saatBicimi: bilgiSecenektenBiri(['sistem', '24', '12'], sonuc.saatBicimi, 'sistem'),
      tarihBicimi: bilgiSecenektenBiri(['orta', 'kisa', 'uzun', 'yok'], sonuc.tarihBicimi, 'orta'),
      takvimler: bilgiDizisi(sonuc.takvimler, BILGI_SINIRLARI.takvimler),
      takvimGunSayisi: String(Number.isInteger(sonuc.takvimGunSayisi) ? sonuc.takvimGunSayisi : 3),
      yapilacakListeleri: bilgiDizisi(sonuc.yapilacakListeleri, BILGI_SINIRLARI.yapilacakListeleri),
      hizliListe: bilgiMetni(sonuc.hizliListe, ''),
    };
  }

  /** Kayıt yükü: sayısal alanlar sayı olarak gider (sayıya benzemeyen metin olduğu gibi gider ve ana süreçte reddedilir). */
  function bilgiYuku(a) {
    const sayi = function (metin) { return /^\d{1,4}$/.test(metin) ? Number(metin) : metin; };
    return {
      sensorSeridi: a.sensorSeridi,
      sensorGrafik: a.sensorGrafik,
      sensorGrafikSaat: Number(a.sensorGrafikSaat),
      pilEsigi: sayi(a.pilEsigi),
      sensorTepsiIpucu: a.sensorTepsiIpucu,
      ustKart1: a.ustKart1,
      ustKart2: a.ustKart2,
      havaVarligi: a.havaVarligi,
      saatBicimi: a.saatBicimi,
      tarihBicimi: a.tarihBicimi,
      takvimler: a.takvimler,
      takvimGunSayisi: sayi(a.takvimGunSayisi),
      yapilacakListeleri: a.yapilacakListeleri,
      hizliListe: a.hizliListe,
    };
  }

  /** Varlığın görünen adı: bilinen ad + kimlik ("Salon sıcaklık (sensor.salon_sicaklik)"), ad bilinmiyorsa kimliğin kendisi. */
  function bilgiAdiMetni(kimlik) {
    const ad = bilgiAdlari.get(kimlik);
    return ad && ad !== kimlik ? ad + ' (' + kimlik + ')' : kimlik;
  }

  /** Seçim kutusunu yeniden kurar; seçili değer listede yoksa (varlıklar yüklenmemiş) kimliğiyle eklenir, böylece kayıtlı değer korunur. */
  function bilgiSecimKutusunuKur(kutu, ogeler, deger) {
    const liste = ogeler.slice();
    if (!liste.some(function (o) { return o.deger === deger; })) liste.push({ deger: deger, metin: bilgiAdiMetni(deger) });
    kutu.replaceChildren();
    liste.forEach(function (o) {
      const secenek = document.createElement('option');
      secenek.value = o.deger;
      secenek.textContent = o.metin;
      kutu.appendChild(secenek);
    });
    kutu.value = deger;
  }

  /** Üst kart, hava ve hızlı liste kutularını kurar. degerler verilmezse kutulardaki şimdiki seçimler korunur. */
  function bilgiSecenekleriniCiz(degerler) {
    const simdi = degerler || { ustKart1: ustKart1.value, ustKart2: ustKart2.value, havaVarligi: havaVarligi.value, hizliListe: hizliListe.value };
    const adaylar = bilgiAdaylari || { sensorSeridi: [], havalar: [], takvimler: [], yapilacakListeleri: [] };
    const ogeler = function (liste) {
      return liste.map(function (c) { return { deger: c.entity_id, metin: bilgiAdiMetni(c.entity_id) }; });
    };
    const kartlar = KART_SABITLERI.map(function (s) { return { deger: s[0], metin: t(s[1]) }; }).concat(ogeler(adaylar.sensorSeridi));
    bilgiSecimKutusunuKur(ustKart1, kartlar, bilgiMetni(simdi.ustKart1, 'yok'));
    bilgiSecimKutusunuKur(ustKart2, kartlar, bilgiMetni(simdi.ustKart2, 'yok'));
    bilgiSecimKutusunuKur(havaVarligi, [{ deger: '', metin: t('ayar.bilgi.hava.yok') }].concat(ogeler(adaylar.havalar)), bilgiMetni(simdi.havaVarligi, ''));
    bilgiSecimKutusunuKur(hizliListe, [{ deger: '', metin: t('ayar.bilgi.hizli.ilk') }].concat(ogeler(adaylar.yapilacakListeleri)), bilgiMetni(simdi.hizliListe, ''));
    bilgiYuklemeIpucu.style.display = bilgiAdaylari === null ? 'block' : 'none';
  }

  /** Seçili varlıkların satırları ve "ekle" kutusu (henüz seçilmemiş adaylar; sınır dolunca kapanır). */
  function bilgiListesiCiz(ad) {
    const oge = BILGI_LISTELERI[ad];
    const secili = bilgiSecim[ad];
    const enCok = BILGI_SINIRLARI[ad];
    oge.kap.replaceChildren();
    oge.ilkKaldir = null;
    if (secili.length === 0) oge.kap.appendChild(el('div', 'ipucu', t('ayar.bilgi.listeBos')));
    secili.forEach(function (kimlik) {
      const gorunenAd = bilgiAdlari.get(kimlik) || kimlik;
      const satir = el('div', 'bilgi-satir');
      const metin = el('div', 'bilgi-satir-metin');
      metin.appendChild(el('span', 'bilgi-satir-ad', gorunenAd));
      if (gorunenAd !== kimlik) metin.appendChild(el('span', 'bilgi-satir-kimlik', kimlik));
      const kaldir = el('button', 'buton buton-ikincil', t('ayar.bilgi.kaldir'));
      kaldir.type = 'button';
      kaldir.setAttribute('aria-label', t('ayar.bilgi.kaldirEtiket', { ad: gorunenAd }));
      kaldir.addEventListener('click', function () {
        const sira = bilgiSecim[ad].indexOf(kimlik);
        if (sira < 0) return;
        bilgiSecim[ad].splice(sira, 1);
        bilgiListesiCiz(ad);
        kirliGuncelle();
        odakla(oge.sec.disabled ? oge.ilkKaldir : oge.sec);
      });
      if (oge.ilkKaldir === null) oge.ilkKaldir = kaldir;
      satir.appendChild(metin);
      satir.appendChild(kaldir);
      oge.kap.appendChild(satir);
    });
    const aday = bilgiAdaylari ? bilgiAdaylari[ad] : [];
    const kalan = aday.filter(function (c) { return secili.indexOf(c.entity_id) < 0; });
    const dolu = secili.length >= enCok;
    oge.sec.replaceChildren();
    const ilk = document.createElement('option');
    ilk.value = '';
    ilk.textContent = dolu ? t('ayar.bilgi.limitDolu', { n: enCok }) : bilgiAdaylari !== null && kalan.length === 0 ? t('ayar.bilgi.adayYok') : t('ayar.bilgi.secenekSec');
    oge.sec.appendChild(ilk);
    if (!dolu) {
      kalan.forEach(function (c) {
        const secenek = document.createElement('option');
        secenek.value = c.entity_id;
        secenek.textContent = bilgiAdiMetni(c.entity_id);
        oge.sec.appendChild(secenek);
      });
    }
    oge.sec.value = '';
    oge.sec.disabled = dolu || kalan.length === 0;
    oge.dugme.disabled = true;
  }

  /** Cihaz listesi alındığında seçenekleri kurar (cihazlar:getir yanıtı: sensör ve hava cihazlar içinde, takvim ve yapılacaklar bilgiVarliklari içinde). */
  function bilgiAdaylariniKur(sonuc) {
    const cihazlar = Array.isArray(sonuc.cihazlar) ? sonuc.cihazlar : [];
    const bilgiVarliklari = Array.isArray(sonuc.bilgiVarliklari) ? sonuc.bilgiVarliklari : [];
    const gecerli = function (c) { return !!c && typeof c.entity_id === 'string'; };
    cihazlar.concat(bilgiVarliklari).forEach(function (c) {
      if (gecerli(c)) bilgiAdlari.set(c.entity_id, typeof c.ad === 'string' && c.ad !== '' ? c.ad : c.entity_id);
    });
    const sec = function (liste, alanlar) {
      return liste.filter(function (c) { return gecerli(c) && alanlar.indexOf(c.alan) >= 0 && c.gizli !== true; });
    };
    bilgiAdaylari = {
      sensorSeridi: sec(cihazlar, ['sensor', 'binary_sensor']),
      havalar: sec(cihazlar, ['weather']),
      takvimler: sec(bilgiVarliklari, ['calendar']),
      yapilacakListeleri: sec(bilgiVarliklari, ['todo']),
    };
    bilgiMetinleriniYenile();
  }

  /** Metinleri (seçenek adları, satırlar, ipuçları) etkin dilde yeniden yazar; seçili değerlere dokunmaz. */
  function bilgiMetinleriniYenile() {
    bilgiSecenekleriniCiz();
    Object.keys(BILGI_LISTELERI).forEach(bilgiListesiCiz);
  }

  /** Sunucudaki değerleri (bilgiDegerleri çıktısı) alanlara yazar. korunan: sunucunun reddettiği, yazılan değerle kalan alanlar. */
  function bilgiUygula(d, korunan) {
    Object.keys(BILGI_SINIRLARI).forEach(function (ad) { bilgiSecim[ad] = d[ad].slice(); });
    sensorGrafik.checked = d.sensorGrafik;
    sensorGrafikSaat.value = d.sensorGrafikSaat;
    sensorTepsiIpucu.checked = d.sensorTepsiIpucu;
    saatBicimi.value = d.saatBicimi;
    tarihBicimi.value = d.tarihBicimi;
    if (!korunan.has('pilEsigi')) {
      pilEsigi.value = d.pilEsigi;
      alanTemizle('pilEsigi');
    }
    if (!korunan.has('takvimGunSayisi')) {
      takvimGunSayisi.value = d.takvimGunSayisi;
      alanTemizle('takvimGunSayisi');
    }
    bilgiSecenekleriniCiz({ ustKart1: d.ustKart1, ustKart2: d.ustKart2, havaVarligi: d.havaVarligi, hizliListe: d.hizliListe });
    Object.keys(BILGI_LISTELERI).forEach(bilgiListesiCiz);
  }

  [
    sensorGrafik, sensorGrafikSaat, pilEsigi, sensorTepsiIpucu, ustKart1, ustKart2, havaVarligi, saatBicimi, tarihBicimi,
    takvimGunSayisi, hizliListe,
  ].forEach(function (girdi) {
    girdi.addEventListener('input', kirliGuncelle);
    girdi.addEventListener('change', kirliGuncelle);
  });
  pilEsigi.addEventListener('input', function () { alanTemizle('pilEsigi'); });
  takvimGunSayisi.addEventListener('input', function () { alanTemizle('takvimGunSayisi'); });

  Object.keys(BILGI_LISTELERI).forEach(function (ad) {
    const oge = BILGI_LISTELERI[ad];
    oge.sec.addEventListener('change', function () {
      oge.dugme.disabled = oge.sec.value === '' || bilgiSecim[ad].length >= BILGI_SINIRLARI[ad];
    });
    oge.dugme.addEventListener('click', function () {
      const kimlik = oge.sec.value;
      if (kimlik === '' || bilgiSecim[ad].indexOf(kimlik) >= 0 || bilgiSecim[ad].length >= BILGI_SINIRLARI[ad]) return;
      bilgiSecim[ad].push(kimlik);
      bilgiListesiCiz(ad);
      kirliGuncelle();
      odakla(oge.sec.disabled ? oge.ilkKaldir : oge.sec);
    });
  });

  // --- Kısayol yakalama ve anlık denetim (h-24, k-01, h-25) ------------------------------------------------------------------
  /** Kutudaki kısayolu anında denetler: geçersizse neden (Windows’a ayrılmış dahil), geçerliyse AltGr gibi uyarılar. true = geçersiz. */
  function kisayolAnlikDenetle(girdi, kutu, bosIzinli) {
    const deger = girdi.value.trim();
    let mesajlar = [];
    let gecersiz = false;
    if (deger === '') {
      if (!bosIzinli) {
        mesajlar = [t('ayar.kisayol.bosOlamaz')];
        gecersiz = true;
      }
    } else if (Kisayol) {
      const sonuc = Kisayol.kisayolDogrula(deger, t);
      if (!sonuc.gecerli) {
        mesajlar = [sonuc.mesaj];
        gecersiz = true;
      } else {
        mesajlar = Kisayol.kisayolUyarilari(deger, t);
      }
    }
    gecersizIsaretle(girdi, gecersiz);
    if (kutu) uyariKutusuDoldur(kutu, mesajlar);
    return gecersiz;
  }

  // Ctrl+C/V/X/A/Z/Y yazı düzenleme tuşlarıdır: kutuya kısayol yazarken yapıştırabilmek için yakalanmaz (zaten Windows’a ayrılmıştır).
  const DUZENLEME_KODLARI = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyY', 'KeyZ']);

  /**
   * Kısayol kutusu hem tuşa basılarak (Ctrl/Alt/Win ile bir tuş) hem yazarak doldurulur. Yazma serbesttir: "ctrl alt k", "Win+H" gibi
   * yazımlar kabul edilir ve kutudan çıkınca "Ctrl+Alt+K" biçimine çevrilir. Esc kutudan çıkar (pencereyi kapatmaz).
   * secenek: { bosIzinli, kutu (ileti öğesi), degisti() }
   */
  function kisayolKutusunuBagla(girdi, secenek) {
    function guncelle() {
      kisayolAnlikDenetle(girdi, secenek.kutu, secenek.bosIzinli === true);
      if (secenek.degisti) secenek.degisti();
    }
    girdi.addEventListener('keydown', function (olay) {
      if (olay.key === 'Escape') {
        olay.preventDefault();
        if (olay.stopPropagation) olay.stopPropagation();
        girdi.blur();
        return;
      }
      if (olay.key === 'Tab' || !Kisayol) return;
      if (!(olay.ctrlKey || olay.altKey || olay.metaKey)) return; // düz tuşlar yazı yazmaktır
      if (olay.ctrlKey && !olay.altKey && !olay.metaKey && DUZENLEME_KODLARI.has(olay.code)) return;
      const yakalanan = Kisayol.tusOlayindanKisayol(olay);
      if (!yakalanan) return;
      olay.preventDefault();
      if (olay.stopPropagation) olay.stopPropagation();
      girdi.value = kisGoster(yakalanan);
      guncelle();
    });
    girdi.addEventListener('input', guncelle);
    girdi.addEventListener('change', function () {
      const normal = Kisayol ? Kisayol.kisayolNormallestir(girdi.value) : null;
      if (normal) girdi.value = kisGoster(normal);
      guncelle();
    });
  }

  // --- Pencere grubu: konum, ekran, opaklık, rozet, masaüstü karoları (1.4.0) ------------------------------------------------
  const alanKodu = function (kimlik) { return String(kimlik).split('.')[0]; };

  function opaklikDegeri(ham) {
    return Number.isInteger(ham) && ham >= 50 && ham <= 100 ? ham : 100;
  }

  function opaklikYazisiniGuncelle() {
    panelOpaklikDegeri.textContent = t('ayar.pencere.opaklikDegeri', { n: panelOpaklik.value });
  }

  /** Tercih edilen ekran kaydı: yok = {} (alan sırası sabit: baz ile anlık karşılaştırma metni aynı çıksın). */
  function tercihEkranKaydiDuzelt(ham) {
    if (!ham || typeof ham !== 'object' || !Number.isInteger(ham.id)) return {};
    return { id: ham.id, x: ham.x, y: ham.y, genislik: ham.genislik, yukseklik: ham.yukseklik };
  }

  /** Ayar özetindeki bağlı ekranlar (ana süreç etiketi o dilde yazar). */
  function ekranListesiniAl(sonuc) {
    const liste = sonuc && Array.isArray(sonuc.ekranlar) ? sonuc.ekranlar : [];
    return liste.filter(function (e) {
      return e && Number.isInteger(e.id) && typeof e.etiket === 'string' && Number.isFinite(e.x) && Number.isFinite(e.y);
    });
  }

  /** Ekran seçicisinin seçenekleri: tercih yok, bağlı ekranlar ve (bağlı değilse) kayıtlı ekran. */
  function ekranSecenekleriniKur(secilecek) {
    tercihEkran.replaceChildren();
    const ekle = function (deger, metin) {
      const secenek = document.createElement('option');
      secenek.value = deger;
      secenek.textContent = metin;
      tercihEkran.appendChild(secenek);
    };
    ekle('', t('ayar.pencere.ekranYok'));
    bagliEkranlar.forEach(function (e) { ekle(String(e.id), e.etiket); });
    const bagli = bagliEkranlar.some(function (e) { return e.id === tercihEkranKaydi.id; });
    if (tercihEkranKaydi.id !== undefined && !bagli) ekle('kayitli', t('ayar.pencere.ekranBagliDegil'));
    tercihEkran.value = secilecek;
    if (tercihEkran.value !== secilecek) tercihEkran.value = '';
  }

  /** Ayardaki kayda göre seçicide işaretlenecek değer. */
  function kayitliEkranSecimi() {
    if (tercihEkranKaydi.id === undefined) return '';
    return bagliEkranlar.some(function (e) { return e.id === tercihEkranKaydi.id; }) ? String(tercihEkranKaydi.id) : 'kayitli';
  }

  /** Seçicideki değerin ayara yazılacak karşılığı. */
  function tercihEkranDegeri() {
    const v = tercihEkran.value;
    if (v === '') return {};
    if (v === 'kayitli') return tercihEkranKaydi;
    const id = Number(v);
    if (tercihEkranKaydi.id === id) return tercihEkranKaydi; // değişmedi: kayıtlı sınırlar aynen kalır
    const ekran = bagliEkranlar.find(function (e) { return e.id === id; });
    return ekran ? tercihEkranKaydiDuzelt(ekran) : tercihEkranKaydi;
  }

  /** Rozet sensörü seçicisi: cihaz listesi yüklüyse sensörler, ayardaki seçim her zaman (liste yoksa kimliğiyle) yer alır. */
  function rozetSensorSecenekleriniKur(secilecek) {
    tepsiRozetSensoru.replaceChildren();
    const goruldu = new Set(['']);
    const ekle = function (deger, metin) {
      const secenek = document.createElement('option');
      secenek.value = deger;
      secenek.textContent = metin;
      tepsiRozetSensoru.appendChild(secenek);
    };
    ekle('', t('ayar.rozet.sensorSec'));
    yuklenenCihazlar.forEach(function (c) {
      if (c.alan !== 'sensor' || goruldu.has(c.entity_id)) return;
      goruldu.add(c.entity_id);
      ekle(c.entity_id, c.ad || c.entity_id);
    });
    if (secilecek && !goruldu.has(secilecek)) ekle(secilecek, adHaritasi.get(secilecek) || secilecek);
    tepsiRozetSensoru.value = secilecek;
    if (tepsiRozetSensoru.value !== secilecek) tepsiRozetSensoru.value = '';
  }

  function rozetSensorDurumunuGuncelle() {
    tepsiRozetSensoru.disabled = tepsiRozeti.value !== 'sensor';
  }

  /** Sabitlenebilir adaylar: seçili (kaydedilecek) favorilerden uygun alandakiler, seçim sırasıyla. */
  function masaustuAdaylari() {
    const engelli = engelliKimlikleri();
    return seciliSira.filter(function (kimlik) { return MASAUSTU_ALANLARI.indexOf(alanKodu(kimlik)) >= 0 && !engelli.has(kimlik); });
  }

  /** Kayıtta giden masaüstü karoları: hâlâ seçili favori olanlar, onay istemeyenler, en çok EN_COK_MASAUSTU_KARO. */
  function masaustuKaroSecimi() {
    const adaylar = masaustuAdaylari();
    return masaustuSecili.filter(function (kimlik) { return adaylar.indexOf(kimlik) >= 0 && !onayliMi(kimlik); }).slice(0, EN_COK_MASAUSTU_KARO);
  }

  function masaustuKaroListesiniCiz(odaklanacak) {
    masaustuKaroListesi.replaceChildren();
    const adaylar = masaustuAdaylari();
    if (adaylar.length === 0) {
      masaustuKaroListesi.appendChild(el('div', 'ipucu', t('ayar.masaustu.bos')));
      return;
    }
    const sayi = masaustuKaroSecimi().length;
    adaylar.forEach(function (kimlik) {
      const secili = masaustuSecili.indexOf(kimlik) >= 0;
      const onayli = onayliMi(kimlik);
      const dolu = !secili && sayi >= EN_COK_MASAUSTU_KARO;
      const satir = el('label', 'checkbox-etiket');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = secili && !onayli;
      cb.disabled = onayli || dolu;
      const not = onayli ? ' — ' + t('ayar.masaustu.onayli') : dolu ? ' — ' + t('ayar.masaustu.dolu') : '';
      satir.appendChild(cb);
      satir.appendChild(el('span', '', gorunenAd(kimlik) + not));
      cb.addEventListener('change', function () {
        const sira = masaustuSecili.indexOf(kimlik);
        if (cb.checked && sira < 0) masaustuSecili.push(kimlik);
        else if (!cb.checked && sira >= 0) masaustuSecili.splice(sira, 1);
        masaustuKaroListesiniCiz(kimlik);
        kirliGuncelle();
      });
      masaustuKaroListesi.appendChild(satir);
      if (odaklanacak === kimlik) odakla(cb);
    });
  }

  /** Ana süreç masaüstü karo listesini kendisi değiştirdi (karonun × düğmesi): düzenlenmemiş liste sunucudakini alır. */
  function masaustuListesiniSunucudanYenile(sonuc) {
    const yeni = (Array.isArray(sonuc.masaustuKarolari) ? sonuc.masaustuKarolari : []).filter(function (k) { return typeof k === 'string'; });
    if (bazGenel !== null) {
      const baz = JSON.parse(bazGenel);
      if (JSON.stringify(baz.masaustuKarolari) !== JSON.stringify(yeni)) {
        const duzenlenmedi = JSON.stringify(masaustuSecili) === JSON.stringify(baz.masaustuKarolari);
        baz.masaustuKarolari = yeni;
        bazGenel = JSON.stringify(baz);
        if (duzenlenmedi) masaustuSecili = yeni.slice();
      }
    }
    masaustuKaroListesiniCiz();
  }

  /** Dil değişince ve cihaz listesi yenilenince: seçici seçenekleri yeniden kurulur (seçili değerler korunur). */
  function pencereSecenekleriniYenile() {
    if (mevcutAyarlar) bagliEkranlar = ekranListesiniAl(mevcutAyarlar);
    ekranSecenekleriniKur(tercihEkran.value);
    rozetSensorSecenekleriniKur(tepsiRozetSensoru.value);
    opaklikYazisiniGuncelle();
  }

  // --- Kirli durum (k-02) --------------------------------------------------------------------------------------------------
  const sirali = (harita) => Array.from(harita.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });

  function panoYuku() {
    return panolar
      .filter(function (p) { return p.ad.trim() !== '' || p.yol.trim() !== ''; })
      .map(function (p) {
        return { ad: p.ad.trim(), yol: p.yol.trim(), kisayol: kisNorm(p.kisayol) };
      });
  }

  /** Form alanlarındaki değerler (karşılaştırma için normalleştirilmiş). */
  function genelAnlik() {
    return {
      yerelAdres: yerelAdres.value.trim(),
      disAdres: disAdres.value.trim(),
      kisayol: kisNorm(kisayol.value),
      paletKisayol: kisNorm(paletKisayol.value),
      dil: dilSecimi.value,
      tepsiSolTik: tepsiSolTik.value,
      canliBaglanti: canliBaglanti.checked,
      otomatikBaslat: otomatikBaslat.checked,
      pencereBoyutu: pencereBoyutu.value,
      odakKaybindaGizle: odakKaybindaGizle.checked,
      anaPanoyaDonDk: String(anaPanoyaDonDk.value).trim(),
      koseBildirimi: koseBildirimi.checked,
      bipSesi: bipSesi.checked,
      yeniPencereMalzemesi: yeniPencereMalzemesi.value,
      temaZorla: temaZorla.value,
      vurguRengi: vurguRengi.value.trim().toLowerCase(),
      panolar: panoYuku(),
      ...bilgiAnlik(),
      sayfalar: duzen ? duzen.sayfalarAnlik() : [],
      // Pencere grubu (1.4.0)
      panelHerZamanUstte: panelHerZamanUstte.checked,
      pencereKonumu: pencereKonumu.value,
      tercihEkran: tercihEkranDegeri(),
      panelOpaklik: Number(panelOpaklik.value),
      tepsiRozeti: tepsiRozeti.value,
      tepsiRozetSensoru: tepsiRozetSensoru.value,
      masaustuKarolari: masaustuSecili.slice(),
      masaustuKaroUstte: masaustuKaroUstte.checked,
    };
  }

  /** Sunucu özetinin aynı biçimdeki karşılığı (alanlara yazılan ve temel alınan değerler). */
  function genelDegerleri(sonuc) {
    return {
      yerelAdres: sonuc.yerelAdres || '',
      disAdres: sonuc.disAdres || '',
      kisayol: kisNorm(sonuc.kisayol || varsayilanKisayolMetni),
      paletKisayol: kisNorm(typeof sonuc.paletKisayol === 'string' ? sonuc.paletKisayol : varsayilanPaletKisayolMetni),
      dil: ['sistem', 'tr', 'en'].indexOf(sonuc.dilAyari) >= 0 ? sonuc.dilAyari : 'sistem',
      tepsiSolTik: sonuc.tepsiSolTik === 'pencere' ? 'pencere' : 'panel',
      canliBaglanti: sonuc.canliBaglanti !== false,
      otomatikBaslat: !!sonuc.otomatikBaslat,
      pencereBoyutu: sonuc.pencereBoyutu === 'genis' ? 'genis' : 'hizli',
      odakKaybindaGizle: sonuc.odakKaybindaGizle !== false,
      anaPanoyaDonDk: String(Number.isInteger(sonuc.anaPanoyaDonDk) ? sonuc.anaPanoyaDonDk : 5),
      koseBildirimi: sonuc.koseBildirimi !== false,
      bipSesi: sonuc.bipSesi === true,
      yeniPencereMalzemesi: ['acrylic', 'mica', 'yok'].indexOf(sonuc.yeniPencereMalzemesi) >= 0 ? sonuc.yeniPencereMalzemesi : 'acrylic',
      temaZorla: sonuc.temaZorla === 'sistem' ? 'sistem' : 'koyu',
      vurguRengi: (typeof sonuc.vurguRengi === 'string' ? sonuc.vurguRengi : '').toLowerCase(),
      panolar: (Array.isArray(sonuc.panolar) ? sonuc.panolar : []).map(function (p) {
        return { ad: String(p.ad || '').trim(), yol: String(p.yol || '').trim(), kisayol: kisNorm(p.kisayol) };
      }),
      ...bilgiDegerleri(sonuc),
      sayfalar: duzen ? duzen.sayfalarDegerleri(sonuc.sayfalar) : [],
      // Pencere grubu (1.4.0)
      panelHerZamanUstte: sonuc.panelHerZamanUstte === true,
      pencereKonumu: sonuc.pencereKonumu === 'hatirla' ? 'hatirla' : 'imlec',
      tercihEkran: tercihEkranKaydiDuzelt(sonuc.tercihEkran),
      panelOpaklik: opaklikDegeri(sonuc.panelOpaklik),
      tepsiRozeti: sonuc.tepsiRozeti === 'isik' || sonuc.tepsiRozeti === 'sensor' ? sonuc.tepsiRozeti : 'kapali',
      tepsiRozetSensoru: typeof sonuc.tepsiRozetSensoru === 'string' ? sonuc.tepsiRozetSensoru : '',
      masaustuKarolari: (Array.isArray(sonuc.masaustuKarolari) ? sonuc.masaustuKarolari : []).filter(function (k) { return typeof k === 'string'; }),
      masaustuKaroUstte: sonuc.masaustuKaroUstte === true,
    };
  }

  function favoriKirli() {
    if (seciliSira.length !== kayitliSira.length) return true;
    if (seciliSira.some(function (kimlik, i) { return kimlik !== kayitliSira[i]; })) return true;
    if (duzen && duzen.favoriGorunumuKirli(seciliSira)) return true;
    return [onayDegisiklikleri, kisayolDegisiklikleri, parlaklikDegisiklikleri, etiketDegisiklikleri].some(function (harita) {
      return Array.from(harita.keys()).some(function (kimlik) { return seciliSira.indexOf(kimlik) >= 0; });
    });
  }

  function kirliMi() {
    if (bazGenel === null) return false;
    return JSON.stringify(genelAnlik()) !== bazGenel || favoriKirli();
  }

  function kirliGuncelle() {
    kirliGosterge.style.display = kirliMi() ? 'inline' : 'none';
  }

  // Kapatırken sor: kaydedilmemiş ayar ya da yazılmış ama kaydedilmemiş anahtar (anahtar kirli göstergesine girmez, ayrı kaydedilir).
  function kapatmaOnayiGerekli() {
    return kirliMi() || anahtarGirdisi.value !== '';
  }

  /** Değişiklik haritasını kayıtlı değere göre günceller: eşitse kayıt silinir (geri alınan düzenleme kirli sayılmaz). */
  function degisiklikAyarla(harita, kimlik, deger, temel) {
    if (deger === temel) harita.delete(kimlik);
    else harita.set(kimlik, deger);
  }

  // --- Kurulum listesi (k-03) ----------------------------------------------------------------------------------------------
  function kurulumGuncelle() {
    if (!mevcutAyarlar) return;
    const adim = function (satir, durum, tamam) {
      $(durum).textContent = tamam ? t('ayar.kurulum.tamam') : t('ayar.kurulum.bekliyor');
      $(satir).className = tamam ? 'adim-tamam' : '';
    };
    const adresTamam = (mevcutAyarlar.yerelAdres || '') !== '';
    const anahtarTamam = mevcutAyarlar.anahtarVar === true;
    const favoriTamam = kayitliSira.length > 0;
    adim('adimAdres', 'adimAdresDurum', adresTamam);
    adim('adimAnahtar', 'adimAnahtarDurum', anahtarTamam);
    adim('adimFavori', 'adimFavoriDurum', favoriTamam);
    kurulumListesi.style.display = !anahtarTamam || !favoriTamam ? 'block' : 'none';
  }

  // --- Genel ayarlar bölümü ------------------------------------------------------------------------------------------------
  // Ev içi adres http:// iken ve anahtar kayıtlıysa anahtarın ağda şifresiz gideceği söylenir (hata-01).
  function yerelAdresUyarisiniGuncelle() {
    const mesajlar = [];
    if (yerelAdres.value.trim().toLowerCase().indexOf('http:') === 0 && mevcutAyarlar && mevcutAyarlar.anahtarVar) {
      mesajlar.push(t('ayar.baglanti.yerelHttpUyari'));
    }
    uyariKutusuDoldur(yerelAdresUyari, mesajlar);
  }

  // Windows başlangıç durumu: kapatılmışsa uyarı + "Yeniden etkinleştir" düğmesi.
  function otomatikBaslatDurumunuGoster(durum) {
    const mesajlar = [];
    if (durum && ['windows-kapatmis', 'kayit-yok', 'belirsiz', 'gelistirme'].indexOf(durum.durum) >= 0) {
      mesajlar.push(durum.mesaj);
    }
    uyariKutusuDoldur(otomatikBaslatDurum, mesajlar);
    btnOtomatikBaslatEtkinlestir.style.display = durum && durum.durum === 'windows-kapatmis' ? 'inline-flex' : 'none';
  }

  // Canlı bağlantı durumu (ana süreçteki ws.durum().baglanti): kapali | baglaniyor | canli | yedek.
  function canliDurumAciklamasi(acik, durum) {
    if (!acik) return t('ayar.canli.kapali');
    if (durum === 'canli') return t('ayar.canli.canli');
    if (durum === 'yedek') return t('ayar.canli.yedek');
    if (durum === 'baglaniyor') return t('ayar.canli.baglaniyor');
    return t('ayar.canli.etkinDegil');
  }

  // Ana sürecin kısayol planı satırı (kisayolDurumlari): yalnız sorunlu olanların iletisi gösterilir (ileti ana süreçte seçili dilde yazılır).
  function kisayolSorunMesaji(oge) {
    if (!oge || oge.durum === 'etkin') return '';
    return oge.mesaj || t('ayar.kisayol.uygulanamadi');
  }

  function hazirListeDurumunuGoster(guncel) {
    hazirListeDurum.textContent = guncel === false ? t('ayar.hazir.durumEski') : t('ayar.hazir.durumGuncel');
  }

  function vurguOnizlemeGuncelle() {
    const renk = vurguRengi.value.trim();
    const gecerli = /^#[0-9a-fA-F]{6}$/.test(renk);
    vurguOnizleme.style.borderColor = gecerli ? renk : '';
    if (gecerli) vurguRengiSecici.value = renk.toLowerCase();
    vurguOnizleme.textContent = gecerli ? renk.toLowerCase() : renk === '' ? t('ayar.vurgu.sistem') : t('ayar.vurgu.onizleme');
    if (renk !== '' && !gecerli) {
      gecersizIsaretle(vurguRengi, true);
      vurguHata.textContent = t('ayar.vurgu.hata');
      vurguHata.style.display = 'block';
    } else {
      alanTemizle('vurguRengi');
    }
  }

  /** Ana kısayol ve palet kısayolu kutularının sunucu kaynaklı iletileri (kisayolDurumlari güncel olmalı). */
  function kisayolSunucuIletileri(sonuc) {
    const ana = (sonuc.kisayolUyarilari || []).slice();
    if (sonuc.kisayolEtkin === false) ana.unshift(t('ayar.kisayol.etkinDegil'));
    const palet = (sonuc.paletKisayolUyarilari || []).slice();
    const paletDurumu = kisayolDurumlari.find(function (k) { return k.tur === 'palet'; });
    if (paletDurumu && kisayolSorunMesaji(paletDurumu)) palet.unshift(kisayolSorunMesaji(paletDurumu));
    return { ana: ana, palet: palet };
  }

  /**
   * Dil değişince: genel ayarlardaki durum ve sunucu iletileri yeni dille yeniden yazılır (sonuc yeni dilde alınmış ayar özetidir).
   * Alan değerlerine, kirli durumuna ve hata işaretlerine dokunulmaz; kullanıcının değiştirdiği (ya da geçersiz) kısayol kutusunun iletisi
   * sunucunun kayıtlı değere ait iletisi yerine anlık denetimle yeni dilde yeniden üretilir.
   */
  function genelIletileriniYenile(sonuc) {
    kisayolDurumlari = Array.isArray(sonuc.kisayolDurumlari) ? sonuc.kisayolDurumlari : [];
    const d = genelDegerleri(sonuc);
    canliDurumMetni.textContent = canliDurumAciklamasi(d.canliBaglanti, sonuc.canliDurum);
    uyariKutusuDoldur(malzemeUyari, sonuc.malzemeDestekleniyor === false ? [t('ayar.malzeme.desteklenmiyor')] : []);
    const sunucuIletileri = kisayolSunucuIletileri(sonuc);
    [
      [kisayol, kisayolUyarilari, false, d.kisayol, sunucuIletileri.ana],
      [paletKisayol, paletKisayolUyarilari, true, d.paletKisayol, sunucuIletileri.palet],
    ].forEach(function (s) {
      const duzenlendi = kisNorm(s[0].value) !== s[3] || s[0].classList.contains('gecersiz');
      if (duzenlendi) kisayolAnlikDenetle(s[0], s[1], s[2]);
      else uyariKutusuDoldur(s[1], s[4]);
    });
    hazirListeDurumunuGoster(sonuc.hazirListeGuncel);
    otomatikBaslatDurumunuGoster(sonuc.otomatikBaslatDurumu);
  }

  /** Genel ayarlar bölümünü sunucudaki değerlere döndürür. koru: sunucunun reddettiği alanlar (yazılan değer ve işaret kalır). */
  function genelUygula(sonuc, koru) {
    const korunan = new Set(koru || []);
    varsayilanKisayolMetni = sonuc.varsayilanKisayol || 'Control+Alt+H';
    varsayilanPaletKisayolMetni = sonuc.varsayilanPaletKisayolu || 'Control+Alt+P';
    kisayolDurumlari = Array.isArray(sonuc.kisayolDurumlari) ? sonuc.kisayolDurumlari : [];
    const d = genelDegerleri(sonuc);
    const yaz = function (ad, girdi, deger) {
      if (korunan.has(ad)) return;
      girdi.value = deger;
    };
    yaz('yerelAdres', yerelAdres, d.yerelAdres);
    yaz('disAdres', disAdres, d.disAdres);
    yaz('kisayol', kisayol, kisGoster(d.kisayol));
    yaz('paletKisayol', paletKisayol, kisGoster(d.paletKisayol));
    yaz('anaPanoyaDonDk', anaPanoyaDonDk, d.anaPanoyaDonDk);
    yaz('vurguRengi', vurguRengi, typeof sonuc.vurguRengi === 'string' ? sonuc.vurguRengi : '');
    dilSecimi.value = d.dil;
    tepsiSolTik.value = d.tepsiSolTik;
    canliBaglanti.checked = d.canliBaglanti;
    canliDurumMetni.textContent = canliDurumAciklamasi(d.canliBaglanti, sonuc.canliDurum);
    otomatikBaslat.checked = d.otomatikBaslat;
    pencereBoyutu.value = d.pencereBoyutu;
    odakKaybindaGizle.checked = d.odakKaybindaGizle;
    koseBildirimi.checked = d.koseBildirimi;
    bipSesi.checked = d.bipSesi;
    yeniPencereMalzemesi.value = d.yeniPencereMalzemesi;
    temaZorla.value = d.temaZorla;
    // Pencere grubu (1.4.0)
    panelHerZamanUstte.checked = d.panelHerZamanUstte;
    pencereKonumu.value = d.pencereKonumu;
    tercihEkranKaydi = d.tercihEkran;
    bagliEkranlar = ekranListesiniAl(sonuc);
    ekranSecenekleriniKur(kayitliEkranSecimi());
    panelOpaklik.value = String(d.panelOpaklik);
    opaklikYazisiniGuncelle();
    tepsiRozeti.value = d.tepsiRozeti;
    rozetSensorSecenekleriniKur(d.tepsiRozetSensoru);
    rozetSensorDurumunuGuncelle();
    masaustuKaroUstte.checked = d.masaustuKaroUstte;
    masaustuSecili = d.masaustuKarolari.slice();
    masaustuKaroListesiniCiz();
    uyariKutusuDoldur(malzemeUyari, sonuc.malzemeDestekleniyor === false ? [t('ayar.malzeme.desteklenmiyor')] : []);
    ayarDosyasiYolu.textContent = sonuc.ayarDosyasi || '%APPDATA%\\Ev Paneli\\ayarlar.json';

    // Kısayol iletileri: sunucunun kısayol planı (çakışma, etkin değil) ve uyarıları
    const sunucuIletileri = kisayolSunucuIletileri(sonuc);
    if (!korunan.has('kisayol')) {
      uyariKutusuDoldur(kisayolUyarilari, sunucuIletileri.ana);
      gecersizIsaretle(kisayol, false);
    }
    if (!korunan.has('paletKisayol')) {
      uyariKutusuDoldur(paletKisayolUyarilari, sunucuIletileri.palet);
      gecersizIsaretle(paletKisayol, false);
    }
    ['yerelAdres', 'disAdres', 'anaPanoyaDonDk'].forEach(function (ad) {
      if (!korunan.has(ad)) alanTemizle(ad);
    });
    vurguOnizlemeGuncelle(); // geçerli ya da boş renkte işareti kaldırır, korunan geçersiz değerde işaretli bırakır
    uyariKutusuDoldur(panoUyarilari, []);
    hazirListeDurumunuGoster(sonuc.hazirListeGuncel);
    otomatikBaslatDurumunuGoster(sonuc.otomatikBaslatDurumu);
    bilgiUygula(d, korunan);
    if (duzen) duzen.sayfalariYukle(sonuc.sayfalar); // panel sayfaları (o-24): taslak sunucudaki değerlere döner
    bazGenel = JSON.stringify(d);
  }

  function panoSatirKur(p, sunucuSira) {
    return { ad: String(p.ad || ''), yol: String(p.yol || ''), kisayol: kisGoster(p.kisayol || ''), kayitli: true, sunucuSira: sunucuSira, hata: '' };
  }

  function panolariSunucudanKur(sonuc) {
    panolar = (Array.isArray(sonuc.panolar) ? sonuc.panolar : []).map(panoSatirKur);
    panolariCiz();
  }

  // Sunucu kayıtta reddettiği (geçersiz ad/yol, geçersiz kısayol) HA panolarını SİLMEZ: satır yazılan değerlerle kalır ve nedeni yazar (h-05).
  function panolariKaydaGoreBirlestir(gonderilen, sunucu) {
    const temizAd = function (ad) { return String(ad).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 30); };
    const sonuc = [];
    let j = 0;
    gonderilen.forEach(function (g) {
      const s = sunucu[j];
      if (s && String(s.ad) === temizAd(g.ad) && String(s.yol) === g.yol) {
        const satir = panoSatirKur(s, j);
        if (g.kisayol && !(s.kisayol || '')) {
          satir.kisayol = kisGoster(g.kisayol); // sunucu bu kısayolu atladı: yazılan değer kalır, neden yazılır
          satir.hata = 'kisayol';
        }
        sonuc.push(satir);
        j += 1;
      } else {
        sonuc.push({ ad: g.ad, yol: g.yol, kisayol: kisGoster(g.kisayol), kayitli: false, sunucuSira: -1, hata: 'kaydedilmedi' });
      }
    });
    for (; j < sunucu.length; j += 1) sonuc.push(panoSatirKur(sunucu[j], j));
    return sonuc;
  }

  /** Reddedilen HA panosu satırının nedeni, o anki dilde (satırda yalnız kod saklanır: 'kaydedilmedi' | 'kisayol'). */
  function panoHataMetni(pano) {
    if (pano.hata === 'kaydedilmedi') return t('ayar.pano.kaydedilmedi');
    if (pano.hata === 'kisayol') {
      const neden = Kisayol ? Kisayol.kisayolDogrula(pano.kisayol, t).mesaj : '';
      return t('ayar.pano.kisayolKaydedilmedi', { neden: neden || t('ayar.kisayol.gecersiz') });
    }
    return '';
  }

  function panoSorunMesaji(pano) {
    if (!pano.kayitli || pano.sunucuSira < 0) return '';
    const oge = kisayolDurumlari.find(function (k) { return k.tur === 'pano' && k.sira === pano.sunucuSira; });
    return kisayolSorunMesaji(oge);
  }

  function panolariCiz() {
    panolarListesi.replaceChildren();
    panolar.forEach(function (pano, sira) {
      const satir = el('div', 'pano-satir');
      satir.setAttribute('role', 'group');
      satir.setAttribute('aria-label', t('ayar.pano.etiket', { n: sira + 1 }));
      const ad = document.createElement('input');
      ad.type = 'text';
      ad.placeholder = t('ayar.pano.adIpucu');
      ad.value = pano.ad;
      ad.maxLength = 30;
      ad.setAttribute('aria-label', t('ayar.pano.adEtiket', { n: sira + 1 }));
      // Reddedilen satırın nedeni, kullanıcı satırı düzenlemeye başlayınca kalkar (kısayol iletisi varsa yeniden hesaplanır).
      const hatayiTemizle = function () {
        if (!pano.hata) return;
        pano.hata = '';
        kisayolAnlikDenetle(kisayolGirdisi, ileti, true);
      };
      ad.addEventListener('input', function () {
        pano.ad = ad.value;
        hatayiTemizle();
        kirliGuncelle();
      });
      const yol = document.createElement('input');
      yol.type = 'text';
      yol.placeholder = t('ayar.pano.yolIpucu');
      yol.value = pano.yol;
      yol.setAttribute('aria-label', t('ayar.pano.yolEtiket', { n: sira + 1 }));
      yol.spellcheck = false;
      yol.addEventListener('input', function () {
        pano.yol = yol.value;
        hatayiTemizle();
        kirliGuncelle();
      });
      const kisayolGirdisi = document.createElement('input');
      kisayolGirdisi.type = 'text';
      kisayolGirdisi.className = 'kisayol-girdisi';
      kisayolGirdisi.placeholder = t('ayar.pano.kisayolIpucu');
      kisayolGirdisi.value = pano.kisayol;
      kisayolGirdisi.setAttribute('aria-label', t('ayar.pano.kisayolEtiket', { n: sira + 1 }));
      kisayolGirdisi.spellcheck = false;
      const ileti = el('div', 'pano-hata', panoHataMetni(pano));
      ileti.style.display = pano.hata ? 'block' : 'none';
      const sil = el('button', 'buton buton-ikincil', t('ayar.pano.sil'));
      sil.type = 'button';
      sil.setAttribute('aria-label', t('ayar.pano.silEtiket', { n: sira + 1 }));
      sil.addEventListener('click', function () {
        panolar.splice(sira, 1);
        panolariCiz();
        kirliGuncelle();
      });
      kisayolKutusunuBagla(kisayolGirdisi, {
        bosIzinli: true,
        kutu: ileti,
        degisti: function () {
          pano.kisayol = kisayolGirdisi.value;
          pano.hata = '';
          kirliGuncelle();
        },
      });
      satir.appendChild(ad);
      satir.appendChild(yol);
      satir.appendChild(kisayolGirdisi);
      satir.appendChild(sil);
      const sorun = panoSorunMesaji(pano);
      if (sorun) satir.appendChild(el('div', 'pano-not', sorun));
      satir.appendChild(ileti);
      panolarListesi.appendChild(satir);
    });
    btnPanoEkle.disabled = panolar.length >= EN_COK_PANO;
    btnAcikSayfaEkle.disabled = panolar.length >= EN_COK_PANO;
  }

  // --- Erişim anahtarı bölümü ----------------------------------------------------------------------------------------------
  function anahtarSaglikli(sonuc) {
    return sonuc.anahtarVar === true && sonuc.anahtarReddedildi !== true && !yetkiDurumunuBul(sonuc.yetkiDurumu);
  }

  function anahtarUygula(sonuc) {
    // Yetki kesici (1.1.1): Home Assistant kayıtlı anahtarı reddettiyse rozet ve uyarı gösterilir, istek gönderilmez.
    const reddedildi = sonuc.anahtarVar && sonuc.anahtarReddedildi === true;
    anahtarReddedildiUyari.style.display = reddedildi ? 'block' : 'none';
    const yetkiDurum = sonuc.anahtarVar ? yetkiDurumunuBul(sonuc.yetkiDurumu) : undefined;
    yetkiDurumUyari.textContent = yetkiDurum ? t(yetkiDurum.metin) : '';
    yetkiDurumUyari.style.display = yetkiDurum ? 'block' : 'none';
    btnYetkiYenidenDene.style.display = yetkiDurum ? 'inline-flex' : 'none';
    anahtarKarantinaUyari.style.display = !sonuc.anahtarVar && sonuc.anahtarKarantinada === true ? 'block' : 'none';
    const kayitSorunu = yetkiKaydiniBul(sonuc.yetkiKaydiSorunu);
    yetkiKaydiUyari.textContent = kayitSorunu ? t(kayitSorunu) : '';
    yetkiKaydiUyari.style.display = kayitSorunu ? 'block' : 'none';
    if (reddedildi) {
      anahtarRozet.textContent = t('ayar.rozet.reddetti');
      anahtarRozet.className = 'rozet rozet-uyari';
      btnAnahtarSil.style.display = 'inline-flex';
    } else if (yetkiDurum) {
      anahtarRozet.textContent = t(yetkiDurum.rozet);
      anahtarRozet.className = 'rozet rozet-uyari';
      btnAnahtarSil.style.display = 'inline-flex';
    } else if (sonuc.anahtarVar) {
      anahtarRozet.textContent = t('ayar.rozet.saklaniyor');
      anahtarRozet.className = 'rozet rozet-basarili';
      btnAnahtarSil.style.display = 'inline-flex';
    } else {
      anahtarRozet.textContent = t('ayar.rozet.eklenmedi');
      anahtarRozet.className = 'rozet rozet-uyari';
      btnAnahtarSil.style.display = 'none';
    }
  }

  // Doğrulama sürerken rozet “Doğrulanıyor…” der (h-29); sonuç gelince anahtarUygula gerçek durumu yazar.
  function rozetDogrulaniyor() {
    anahtarRozet.textContent = t('ayar.anahtar.dogrulaniyor');
    anahtarRozet.className = 'rozet rozet-uyari';
  }

  function anahtarUzunluguGuncelle() {
    const sayi = anahtarGirdisi.value.trim().length;
    if (sayi === 0) {
      anahtarUzunluk.textContent = '';
    } else if (sayi < 100) {
      anahtarUzunluk.textContent = cogul('ayar.anahtar.uzunlukKisa', sayi);
    } else {
      anahtarUzunluk.textContent = cogul('ayar.anahtar.uzunluk', sayi);
    }
  }

  function anahtarGorunurlugunuAyarla(gorunur) {
    anahtarGirdisi.type = gorunur ? 'text' : 'password';
    btnAnahtarGoster.textContent = gorunur ? t('ayar.anahtar.gizle') : t('ayar.anahtar.goster');
    btnAnahtarGoster.setAttribute('aria-pressed', gorunur ? 'true' : 'false');
  }

  // Açık ikinci onay kutusu: sunucu onayGerekli: true dönerse uyarı metni ve onay kutusu görünür; kullanıcı işaretleyip yeniden dener.
  // Onay TEK DENEME içindir (tur 5, K7): sunucu her onayGerekli yanıtıyla tek kullanımlık bir bilet verir; kutu işaretliyse o bilet
  // gönderilir. onayGerekli DIŞINDAKİ her yanıttan (hata dahil) ve anahtar girdisi değişince kutu temizlenir ve gizlenir:
  // işaret sonraki adaya taşınmaz.
  let ikinciOnayBileti = null;

  function ikinciOnayiGoster(metin, bilet) {
    ikinciOnayMetni.textContent = metin || '';
    ikinciOnayBileti = typeof bilet === 'string' ? bilet : null;
    ikinciOnayKutusu.style.display = 'block';
    chkIkinciOnay.checked = false;
  }

  function ikinciOnayiGizle() {
    ikinciOnayKutusu.style.display = 'none';
    ikinciOnayBileti = null;
    chkIkinciOnay.checked = false;
  }

  function onaylananBilet() {
    return chkIkinciOnay.checked ? ikinciOnayBileti : null;
  }

  async function anahtariYenile() {
    const sonuc = await window.evPaneli.ayarlariGetir();
    if (!sonuc || !sonuc.ok) return null;
    mevcutAyarlar = sonuc;
    anahtarUygula(sonuc);
    yerelAdresUyarisiniGuncelle();
    kurulumGuncelle();
    return sonuc;
  }

  async function anahtarKaydet() {
    const val = anahtarGirdisi.value.trim();
    if (!val) {
      bildirimGoster(t('ayar.anahtar.yapistir'), 'hata');
      gecersizIsaretle(anahtarGirdisi, true);
      odakla(anahtarGirdisi);
      return;
    }
    if (btnAnahtarKaydet.disabled) return;
    btnAnahtarKaydet.disabled = true;
    btnAnahtarKaydet.textContent = t('ayar.anahtar.dogrulaniyor');
    rozetDogrulaniyor();
    let yenilendi = false;
    try {
      const sonuc = await window.evPaneli.anahtarKaydet(val, { bilet: onaylananBilet() });
      if (sonuc.onayGerekli) {
        ikinciOnayiGoster(sonuc.hata, sonuc.bilet);
        bildirimGoster(t('ayar.anahtar.ikinciOnayBildirim'), 'uyari', 8000);
      } else if (sonuc.ok) {
        ikinciOnayiGizle();
        anahtarGirdisi.value = '';
        anahtarGorunurlugunuAyarla(false);
        anahtarUzunluguGuncelle();
        bildirimGoster(sonuc.uyari || t('ayar.anahtar.dogrulandi'));
        // Yalnız anahtar bölümü tazelenir: form alanlarındaki ve favori listesindeki kaydedilmemiş düzenlemeler korunur (h-05).
        yenilendi = (await anahtariYenile()) !== null;
        await cihazlariYukle(false);
      } else {
        ikinciOnayiGizle(); // 401 / hata: onay harcandı, sonraki aday yeniden onay ister
        bildirimGoster(sonuc.hata || t('ayar.anahtar.kaydedilemedi'), 'hata');
      }
    } catch (err) {
      ikinciOnayiGizle();
      bildirimGoster(t('ayar.anahtar.kaydedilirkenHata'), 'hata');
    } finally {
      btnAnahtarKaydet.disabled = false;
      btnAnahtarKaydet.textContent = t('ayar.anahtar.dogrulaKaydet');
      if (!yenilendi && mevcutAyarlar) anahtarUygula(mevcutAyarlar); // “Doğrulanıyor…” gerçek duruma dönsün
    }
  }

  /** Yeniden Dene sonrası: ana süreçteki tek deneme birkaç saniyede biter; rozet sonuç gelene dek yoklanarak tazelenir (h-29). */
  async function anahtarSonucunuBekle(ilk) {
    let son = ilk;
    for (let i = 0; i < YENIDEN_DENE_YOKLAMA_SAYISI; i += 1) {
      rozetDogrulaniyor();
      await bekle(YENIDEN_DENE_ARALIK_MS);
      const sonuc = await window.evPaneli.ayarlariGetir();
      if (!sonuc || !sonuc.ok) break;
      son = sonuc;
      mevcutAyarlar = sonuc;
      if (!anahtarSaglikli(sonuc)) break; // reddedildi / yine doğrulanamadı: sonuç belli
    }
    if (son) {
      mevcutAyarlar = son;
      anahtarUygula(son);
      kurulumGuncelle();
    }
    return son;
  }

  async function yenidenDene() {
    btnYetkiYenidenDene.disabled = true;
    btnYetkiYenidenDene.textContent = t('ayar.anahtar.dogrulaniyor');
    rozetDogrulaniyor();
    let ilk = null;
    try {
      const sonuc = await window.evPaneli.yetkiYenidenDene({ bilet: onaylananBilet() });
      if (sonuc && sonuc.onayGerekli) {
        ikinciOnayiGoster(sonuc.hata, sonuc.bilet);
        bildirimGoster(t('ayar.anahtar.ikinciOnayBildirim'), 'uyari', 8000);
      } else if (sonuc && sonuc.ok) {
        ikinciOnayiGizle();
        bildirimGoster(t('ayar.anahtar.yenidenDeneniyor'), 'uyari', 8000);
        ilk = sonuc;
      } else {
        ikinciOnayiGizle();
        bildirimGoster((sonuc && sonuc.hata) || t('ayar.anahtar.yenidenDenenemedi'), 'hata');
      }
    } catch (err) {
      ikinciOnayiGizle();
      bildirimGoster(t('ayar.anahtar.yenidenDenerkenHata'), 'hata');
    }
    try {
      if (ilk) {
        const son = await anahtarSonucunuBekle(ilk);
        if (son && anahtarSaglikli(son)) {
          bildirimGoster(t('ayar.anahtar.yenidenDogrulandi'));
        } else if (son) {
          bildirimGoster(t('ayar.anahtar.yineYanitYok'), 'uyari');
        }
      } else if (mevcutAyarlar) {
        anahtarUygula(mevcutAyarlar);
      }
    } catch (err) {
      if (mevcutAyarlar) anahtarUygula(mevcutAyarlar);
    } finally {
      btnYetkiYenidenDene.disabled = false;
      btnYetkiYenidenDene.textContent = t('ayar.anahtar.yenidenDene');
    }
  }

  async function anahtarSil() {
    if (!confirm(t('bildirim.anahtarSilmeOnay'))) return;
    btnAnahtarSil.disabled = true;
    try {
      const sonuc = await window.evPaneli.anahtarSil();
      if (sonuc.ok) {
        // Yalnız yerel dosya silindi; HA'daki anahtar duruyor — kullanıcıya açıkça söylenir (hata-07).
        bildirimGoster(sonuc.mesaj || t('ayar.anahtar.silindi'), 'uyari', 12000);
        await anahtariYenile();
        cihazlarYuklendi = false;
        yuklenenCihazlar = [];
        eksikFavoriler = [];
        engelliFavoriler = [];
        cihazHaritasi.clear();
        guncelleSecilenSayisi();
        siraCiz();
        listeMesaji('ayar.anahtar.silindiListe', false);
      } else {
        bildirimGoster(sonuc.hata || t('ayar.anahtar.silinemedi'), 'hata');
      }
    } catch (err) {
      bildirimGoster(t('ayar.anahtar.silerkenHata'), 'hata');
    } finally {
      btnAnahtarSil.disabled = false;
    }
  }

  // --- Favoriler bölümü ----------------------------------------------------------------------------------------------------
  function engelliKimlikleri() {
    return new Set(engelliFavoriler.map(function (e) { return e.entity_id; }));
  }

  function guncelleSecilenSayisi() {
    // Güvenlik kuralına takılan ("engelli") favoriler kaydedince çıkarılır; sayıya katılmaz.
    const engelli = engelliKimlikleri();
    const sayi = seciliSira.filter(function (kimlik) { return !engelli.has(kimlik); }).length;
    secilenSayisi.textContent = cogul('ayar.favori.secili', sayi);
  }

  /**
   * Favori bölümünü sunucudaki kayıtlara döndürür. birlestir: arka planda eklenen favoriler (örn. hazır karolar) alınır, kullanıcının
   * kaydedilmemiş seçim/sıra/düzenlemeleri korunur (h-27); aksi halde tüm düzenlemeler sunucuya döner.
   */
  function favoriUygula(sonuc, birlestir) {
    const favoriler = Array.isArray(sonuc.favoriler) ? sonuc.favoriler : [];
    const temizdi = !favoriKirli();
    const eskiKayitli = new Set(kayitliSira);
    kayitliOnay.clear();
    kayitliKisayol.clear();
    kayitliParlaklik.clear();
    kayitliEtiket.clear();
    favoriler.forEach(function (f) {
      adHaritasi.set(f.entity_id, f.ad || f.entity_id);
      if (typeof f.onay === 'boolean') kayitliOnay.set(f.entity_id, f.onay);
      if (typeof f.kisayol === 'string' && f.kisayol) kayitliKisayol.set(f.entity_id, f.kisayol);
      if (f.parlaklik === true) kayitliParlaklik.set(f.entity_id, true);
      if (typeof f.etiket === 'string' && f.etiket) kayitliEtiket.set(f.entity_id, f.etiket);
    });
    kayitliSira = favoriler.map(function (f) { return f.entity_id; });
    if (duzen) duzen.favorileriYukle(favoriler, birlestir && !temizdi); // karo görünümü (o-31): simge, renk, boyut, tepsi
    if (birlestir && !temizdi) {
      kayitliSira.forEach(function (kimlik) {
        if (!eskiKayitli.has(kimlik) && seciliSira.indexOf(kimlik) < 0) seciliSira.push(kimlik);
      });
    } else {
      seciliSira = kayitliSira.slice();
      onayDegisiklikleri.clear();
      kisayolDegisiklikleri.clear();
      parlaklikDegisiklikleri.clear();
      etiketDegisiklikleri.clear();
      kisayolHatali.clear();
      etiketHatali.clear();
    }
    guncelleSecilenSayisi();
    siraCiz();
  }

  // 1.4.0: yardımcı değişkenler HA tarafında otomasyon tetikleyebilir ve uygulama bunu göremez (o-06); bu alanlar varsayılan onaylıdır.
  const YARDIMCI_ALANLAR = ['input_select', 'select', 'input_number', 'number', 'timer'];

  /** Cihaz satırının altındaki kalıcı not (uyarı ya da nerede görüneceği). */
  function cihazNotu(cihaz) {
    if (cihaz.alan === 'script' || cihaz.alan === 'scene') return t('ayar.cihaz.scriptSahneUyari');
    if (YARDIMCI_ALANLAR.indexOf(cihaz.alan) >= 0) return t('ayar.cihaz.yardimciUyari');
    if (cihaz.tekTiklama === false) return t('ayar.cihaz.yalnizPanelNotu');
    return '';
  }

  // Onay kutusunun görünen değeri: zorunluysa işaretli; sonra bu oturumdaki değişiklik, ayardaki değer, varsayılan.
  function etkinOnay(kimlik, cihaz) {
    if (cihaz && cihaz.onayZorunlu) return true;
    if (onayDegisiklikleri.has(kimlik)) return onayDegisiklikleri.get(kimlik);
    if (kayitliOnay.has(kimlik)) return kayitliOnay.get(kimlik);
    return !!(cihaz && cihaz.varsayilanOnay);
  }

  function onayTemeli(kimlik, cihaz) {
    if (kayitliOnay.has(kimlik)) return kayitliOnay.get(kimlik);
    return !!(cihaz && cihaz.varsayilanOnay);
  }

  function etkinKisayol(kimlik) {
    if (kisayolDegisiklikleri.has(kimlik)) return kisayolDegisiklikleri.get(kimlik);
    return kayitliKisayol.get(kimlik) || '';
  }

  function etkinParlaklik(kimlik) {
    if (parlaklikDegisiklikleri.has(kimlik)) return parlaklikDegisiklikleri.get(kimlik);
    return kayitliParlaklik.get(kimlik) === true;
  }

  function etkinEtiket(kimlik) {
    if (etiketDegisiklikleri.has(kimlik)) return etiketDegisiklikleri.get(kimlik);
    return kayitliEtiket.get(kimlik) || '';
  }

  function favoriKisayolDurumu(kimlik) {
    return kisayolDurumlari.find(function (k) { return k.tur === 'favori' && k.kimlik === kimlik; });
  }

  function gorunenAd(kimlik) {
    return etkinEtiket(kimlik) || adHaritasi.get(kimlik) || kimlik;
  }

  function onayliMi(kimlik) {
    return etkinOnay(kimlik, cihazHaritasi.get(kimlik));
  }

  // Seçili favorilerin sırası ve tepsideki yeri (k-05): ilk 8 zararsız favori tepsi menüsünün üstündedir.
  function siraCiz() {
    favoriSirasiListesi.replaceChildren();
    siraDugmeleri.clear();
    const engelli = engelliKimlikleri();
    const gorunen = seciliSira.filter(function (kimlik) { return !engelli.has(kimlik); });
    favoriSirasi.style.display = gorunen.length > 0 ? 'block' : 'none';
    let zararsiz = 0;
    gorunen.forEach(function (kimlik, sira) {
      const satir = el('div', 'sira-satir');
      satir.setAttribute('role', 'listitem');
      if (duzen) duzen.siraTutamaciEkle(satir); // sürükleme tutamacı (o-30); klavye yolu Alt+↑ / Alt+↓
      satir.appendChild(el('span', 'sira-no', String(sira + 1) + '.'));
      satir.appendChild(el('span', 'sira-ad', gorunenAd(kimlik)));
      let konum;
      let tepside = false;
      const satirCihazi = cihazHaritasi.get(kimlik);
      if (satirCihazi && satirCihazi.tekTiklama === false) {
        konum = t('ayar.sira.yalnizPanel'); // 1.4.0: tek tıklama eylemi olmayan karo (klima, medya, seçici...) tepsi menüsüne girmez
      } else if (onayliMi(kimlik)) {
        konum = t('ayar.sira.onayli');
      } else {
        zararsiz += 1;
        tepside = zararsiz <= TEPSI_UST_SAYISI;
        konum = tepside ? t('ayar.sira.tepside', { n: zararsiz, toplam: TEPSI_UST_SAYISI }) : t('ayar.sira.diger');
      }
      satir.appendChild(el('span', 'sira-konum' + (tepside ? ' sira-konum-tepsi' : ''), konum));
      const yukari = el('button', 'buton buton-ikincil buton-kucuk', '↑');
      yukari.type = 'button';
      yukari.setAttribute('aria-label', t('ayar.sira.yukari', { ad: gorunenAd(kimlik) }));
      yukari.disabled = sira === 0 || !cihazlarYuklendi;
      yukari.addEventListener('click', function () { favoriyiTasi(kimlik, -1); });
      const asagi = el('button', 'buton buton-ikincil buton-kucuk', '↓');
      asagi.type = 'button';
      asagi.setAttribute('aria-label', t('ayar.sira.asagi', { ad: gorunenAd(kimlik) }));
      asagi.disabled = sira === gorunen.length - 1 || !cihazlarYuklendi;
      asagi.addEventListener('click', function () { favoriyiTasi(kimlik, 1); });
      satir.appendChild(yukari);
      satir.appendChild(asagi);
      siraDugmeleri.set(kimlik, { yukari: yukari, asagi: asagi });
      if (duzen) duzen.siraSatiriniBagla(satir, kimlik);
      favoriSirasiListesi.appendChild(satir);
    });
    if (duzen) duzen.sayfalariTazele(); // sayfa üyeleri seçili favorilere ve görünen adlara göre
    masaustuKaroListesiniCiz(); // masaüstü karosu adayları seçili favorilerden türer (1.4.0)
  }

  /** Seçili (engelli olmayan) favorilerin görünen sırası. */
  function gorunenSira() {
    const engelli = engelliKimlikleri();
    return seciliSira.filter(function (k) { return !engelli.has(k); });
  }

  /** Sürükle-bırak: favoriyi görünen sıradaki `hedef` konumuna taşır (engelli kayıtlar kendi yuvalarında kalır). */
  function favoriyiKonumaTasi(kimlik, hedef) {
    const engelli = engelliKimlikleri();
    const gorunen = gorunenSira();
    const konum = gorunen.indexOf(kimlik);
    if (konum < 0 || !Number.isInteger(hedef)) return;
    const varis = Math.max(0, Math.min(gorunen.length - 1, hedef));
    if (varis === konum) return;
    const yeni = gorunen.slice();
    yeni.splice(konum, 1);
    yeni.splice(varis, 0, kimlik);
    let j = 0;
    seciliSira = seciliSira.map(function (k) { return engelli.has(k) ? k : yeni[j++]; });
    siraCiz();
    kirliGuncelle();
    if (duzen) duzen.siraDuyur(kimlik, varis + 1, gorunen.length);
    const dugmeler = siraDugmeleri.get(kimlik);
    if (dugmeler) odakla(!dugmeler.yukari.disabled ? dugmeler.yukari : dugmeler.asagi);
  }

  function favoriyiTasi(kimlik, yon) {
    const engelli = engelliKimlikleri();
    const gorunen = seciliSira.filter(function (k) { return !engelli.has(k); });
    const konum = gorunen.indexOf(kimlik);
    const komsu = gorunen[konum + yon];
    if (konum < 0 || komsu === undefined) return;
    const a = seciliSira.indexOf(kimlik);
    const b = seciliSira.indexOf(komsu);
    seciliSira[a] = komsu;
    seciliSira[b] = kimlik;
    siraCiz();
    kirliGuncelle();
    if (duzen) duzen.siraDuyur(kimlik, konum + yon + 1, gorunen.length);
    // Taşıma sonrası odak, taşınan satırın aynı yöndeki düğmesinde kalsın (klavyeyle art arda taşımak için).
    const dugmeler = siraDugmeleri.get(kimlik);
    if (dugmeler) odakla(yon < 0 && !dugmeler.yukari.disabled ? dugmeler.yukari : !dugmeler.asagi.disabled ? dugmeler.asagi : dugmeler.yukari);
  }

  /** Cihaz listesinin yerine bir ileti yazar. anahtar: sözlük anahtarı; ham: sunucudan gelen hazır metin (varsa anahtarın yerine geçer). */
  function listeMesaji(anahtar, hata, ham) {
    listeIletisi = { anahtar: anahtar, ham: ham, hata: hata === true };
    satirOgeleri.clear();
    cihazListesi.replaceChildren();
    const kutu = el('div', 'liste-bos', typeof ham === 'string' && ham !== '' ? ham : t(anahtar));
    if (hata) kutu.classList.add('liste-hata');
    cihazListesi.appendChild(kutu);
    btnDahaFazla.style.display = 'none';
  }

  function cihazlariYukle(sessiz) {
    if (yuklemeSozu) return yuklemeSozu;
    yuklemeSozu = cihazlariYukleIsle(sessiz === true).then(
      function () { yuklemeSozu = null; },
      function () { yuklemeSozu = null; },
    );
    return yuklemeSozu;
  }

  async function cihazlariYukleIsle(sessiz) {
    btnCihazlariYukle.disabled = true;
    btnCihazlariYukle.textContent = t('ayar.favori.yukleniyor');
    if (!sessiz) listeMesaji('ayar.favori.cihazlarCekiliyor', false);
    try {
      const sonuc = await window.evPaneli.cihazlariGetir();
      if (sonuc.ok) {
        yuklenenCihazlar = sonuc.cihazlar || [];
        eksikFavoriler = sonuc.eksik || [];
        engelliFavoriler = sonuc.engelli || [];
        cihazHaritasi.clear();
        yuklenenCihazlar.forEach(function (c) {
          cihazHaritasi.set(c.entity_id, c);
          adHaritasi.set(c.entity_id, c.ad || c.entity_id);
        });
        eksikFavoriler.concat(engelliFavoriler).forEach(function (e) {
          if (e.ad) adHaritasi.set(e.entity_id, e.ad);
        });
        cihazlarYuklendi = true;
        bilgiAdaylariniKur(sonuc);
        gosterilenCihazSayisi = CIHAZ_SAYFA_BOYUTU;
        guncelleSecilenSayisi();
        cihazlariCiz();
        siraCiz();
        if (bekleyenOdak) favoriyeOdaklan(bekleyenOdak);
        rozetSensorSecenekleriniKur(tepsiRozetSensoru.value); // cihaz listesi geldi: rozet sensörü seçenekleri dolar
      } else {
        listeMesaji('ayar.favori.listeAlinamadi', true, sonuc.hata);
      }
    } catch (err) {
      listeMesaji('ayar.favori.baglantiHatasi', true);
    } finally {
      btnCihazlariYukle.disabled = false;
      btnCihazlariYukle.textContent = t('ayar.favori.cihazlariListele');
    }
  }

  /**
   * Tek satır. s: { kimlik, ad, turEtiketi, durum, secili, secilebilir, sinifAdi, notMetni, cihaz }
   * cihaz verilirse "Onay iste" kutusu, kısayol, karo adı ve parlaklık ayarı eklenir (hata-04).
   */
  function satirOlustur(s) {
    const satir = el('div', 'cihaz-satir' + (s.sinifAdi ? ' ' + s.sinifAdi : ''));
    const sol = el('div', 'cihaz-sol');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.secili;
    cb.disabled = !s.secilebilir;
    cb.setAttribute('aria-label', s.ad);
    satirOgeleri.set(s.kimlik, cb);

    const metinKapsayici = el('div', 'cihaz-metin');
    metinKapsayici.appendChild(el('div', 'cihaz-ad', s.ad));
    metinKapsayici.appendChild(el('div', 'cihaz-kimlik', s.kimlik));
    if (s.notMetni) metinKapsayici.appendChild(el('div', 'cihaz-not', s.notMetni));
    sol.appendChild(cb);
    sol.appendChild(metinKapsayici);

    const sag = el('div', 'cihaz-sag');
    let onayCb = null;
    if (s.cihaz) {
      const onayEtiket = el('label', 'onay-etiket');
      onayCb = document.createElement('input');
      onayCb.type = 'checkbox';
      onayCb.checked = etkinOnay(s.kimlik, s.cihaz);
      onayCb.disabled = s.cihaz.onayZorunlu || !cb.checked;
      onayEtiket.title = s.cihaz.onayZorunlu ? t('ayar.cihaz.onayZorunluIpucu') : t('ayar.cihaz.onayIpucu');
      onayEtiket.appendChild(onayCb);
      onayEtiket.appendChild(el('span', '', s.cihaz.onayZorunlu ? t('ayar.cihaz.onayZorunlu') : t('ayar.cihaz.onayIste')));
      onayCb.addEventListener('change', function () {
        degisiklikAyarla(onayDegisiklikleri, s.kimlik, onayCb.checked, onayTemeli(s.kimlik, s.cihaz));
        siraCiz();
        kirliGuncelle();
      });
      onayEtiket.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      sag.appendChild(onayEtiket);
    }
    sag.appendChild(el('span', 'cihaz-turu', s.turEtiketi));
    sag.appendChild(el('span', 'cihaz-durum', s.durum));

    satir.appendChild(sol);
    satir.appendChild(sag);

    // İkinci çizgi (yalnız normal cihaz satırlarında): genel kısayol (yalnız zararsız eylemlerde), karo adı ve ışıkta parlaklık ayarı.
    let kisayolGirdisi = null;
    let etiketGirdisi = null;
    let parlaklikCb = null;
    let gorunumDenetimi = null;
    if (s.cihaz) {
      const ek = el('div', 'cihaz-ek');
      if (s.cihaz.kisayolUygun === true) {
        const etiket = el('label', 'onay-etiket');
        etiket.appendChild(el('span', '', t('ayar.cihaz.kisayol')));
        kisayolGirdisi = document.createElement('input');
        kisayolGirdisi.type = 'text';
        kisayolGirdisi.className = 'kisayol-girdisi';
        kisayolGirdisi.placeholder = 'Ctrl+Alt+L';
        kisayolGirdisi.spellcheck = false;
        kisayolGirdisi.value = kisGoster(etkinKisayol(s.kimlik));
        kisayolGirdisi.disabled = !cb.checked;
        kisayolGirdisi.setAttribute('aria-label', t('ayar.cihaz.kisayolEtiket', { ad: s.ad }));
        etiket.appendChild(kisayolGirdisi);
        ek.appendChild(etiket);
      }
      const etiketKutusu = el('label', 'onay-etiket');
      etiketKutusu.appendChild(el('span', '', t('ayar.cihaz.karoAdi')));
      etiketGirdisi = document.createElement('input');
      etiketGirdisi.type = 'text';
      etiketGirdisi.placeholder = t('ayar.cihaz.karoAdiIpucu');
      etiketGirdisi.maxLength = 40;
      etiketGirdisi.spellcheck = false;
      etiketGirdisi.value = etkinEtiket(s.kimlik);
      etiketGirdisi.disabled = !cb.checked;
      etiketGirdisi.setAttribute('aria-label', t('ayar.cihaz.karoAdiEtiket', { ad: s.ad }));
      if (etiketHatali.has(s.kimlik)) gecersizIsaretle(etiketGirdisi, true);
      etiketGirdisi.addEventListener('input', function () {
        degisiklikAyarla(etiketDegisiklikleri, s.kimlik, etiketGirdisi.value.trim(), kayitliEtiket.get(s.kimlik) || '');
        etiketHatali.delete(s.kimlik);
        gecersizIsaretle(etiketGirdisi, false);
        siraCiz();
        kirliGuncelle();
      });
      etiketKutusu.appendChild(etiketGirdisi);
      ek.appendChild(etiketKutusu);
      if (s.cihaz.alan === 'light') {
        const etiket = el('label', 'onay-etiket');
        parlaklikCb = document.createElement('input');
        parlaklikCb.type = 'checkbox';
        parlaklikCb.checked = etkinParlaklik(s.kimlik);
        parlaklikCb.disabled = !cb.checked;
        etiket.title = t('ayar.cihaz.parlaklikIpucu');
        etiket.appendChild(parlaklikCb);
        etiket.appendChild(el('span', '', t('ayar.cihaz.parlaklik')));
        parlaklikCb.addEventListener('change', function () {
          degisiklikAyarla(parlaklikDegisiklikleri, s.kimlik, parlaklikCb.checked, kayitliParlaklik.get(s.kimlik) === true);
          kirliGuncelle();
        });
        ek.appendChild(etiket);
      }
      const ileti = el('div', 'cihaz-not', '');
      ileti.style.display = 'none';
      const sunucuSorunu = kisayolSorunMesaji(favoriKisayolDurumu(s.kimlik));
      if (sunucuSorunu && !kisayolDegisiklikleri.has(s.kimlik)) uyariKutusuDoldur(ileti, [sunucuSorunu]);
      if (kisayolGirdisi) {
        if (kisayolHatali.has(s.kimlik)) kisayolAnlikDenetle(kisayolGirdisi, ileti, true);
        kisayolKutusunuBagla(kisayolGirdisi, {
          bosIzinli: true,
          kutu: ileti,
          degisti: function () {
            kisayolHatali.delete(s.kimlik);
            degisiklikAyarla(kisayolDegisiklikleri, s.kimlik, kisNorm(kisayolGirdisi.value), kisNorm(kayitliKisayol.get(s.kimlik) || ''));
            kirliGuncelle();
          },
        });
      }
      if (etiketHatali.has(s.kimlik)) {
        ileti.style.display = 'block';
        ileti.appendChild(el('div', '', t('ayar.cihaz.karoAdiEngelli')));
      }
      ek.appendChild(ileti);
      if (duzen) gorunumDenetimi = duzen.gorunumKur(ek, s.kimlik, s.ad, cb.checked, { tepsiYok: s.cihaz.tekTiklama === false }); // karo görünümü (o-31) ve tepsiye sabitle (o-16); tek tıklama eylemi olmayan karo tepside olmaz
      if (ek.children.length > 0) {
        ek.addEventListener('click', function (e) {
          e.stopPropagation(); // satırın seç/bırak tıklaması buraya taşmasın
        });
        satir.appendChild(ek);
      }
    }

    cb.addEventListener('change', function () {
      const sira = seciliSira.indexOf(s.kimlik);
      if (cb.checked && sira < 0) seciliSira.push(s.kimlik);
      else if (!cb.checked && sira >= 0) seciliSira.splice(sira, 1);
      if (onayCb) onayCb.disabled = s.cihaz.onayZorunlu || !cb.checked;
      if (kisayolGirdisi) kisayolGirdisi.disabled = !cb.checked;
      if (etiketGirdisi) etiketGirdisi.disabled = !cb.checked;
      if (parlaklikCb) parlaklikCb.disabled = !cb.checked;
      if (gorunumDenetimi) gorunumDenetimi.etkinlestir(cb.checked);
      guncelleSecilenSayisi();
      siraCiz();
      kirliGuncelle();
    });

    // HA'da bulunamayan favori (o-28): aynı türden yeni bir cihaza bağlanabilir.
    if (duzen && !s.cihaz && s.sinifAdi === 'satir-bulunamadi') duzen.onarmaKur(satir, s.kimlik, s.ad);

    // Satıra tıklayınca da işaret kutusu değişsin
    if (s.secilebilir) {
      satir.addEventListener('click', function (e) {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent({ type: 'change', target: cb });
        }
      });
    }
    return satir;
  }

  // Cihaz süzgeci Türkçe harf katlamalıdır ("isik" -> Işık, "SERIT" -> şerit): palet aramasıyla (lib/arama.js) aynı katlama kullanılır,
  // eşleşme ise düz alt metindir (liste süzgecinde dağınık harf eşleşmesi gürültü yapar). Her sözcük eşleşmelidir.
  function katla(metin) {
    return Arama ? Arama.katlaDizi(metin).join('') : String(metin).toLocaleLowerCase('tr-TR');
  }

  function filtreyeUyar(filtre, parcalar) {
    const sozcukler = String(filtre || '').split(/\s+/).filter(function (s) { return s !== ''; });
    if (sozcukler.length === 0) return true;
    const hedef = katla(parcalar.join(' '));
    return sozcukler.every(function (sozcuk) { return hedef.indexOf(katla(sozcuk)) >= 0; });
  }

  function baslikSatiri(metin) {
    return el('div', 'liste-baslik', metin);
  }

  function cihazlariCiz() {
    listeIletisi = null; // satırlar çiziliyor: "ileti yerine" durumu bitti
    const filtre = cihazAra.value.trim();
    const gorunenEksik = eksikFavoriler.filter(function (e) {
      return filtreyeUyar(filtre, [e.ad, e.entity_id]);
    });
    const gorunenEngelli = engelliFavoriler.filter(function (e) {
      return filtreyeUyar(filtre, [e.ad, e.entity_id]);
    });
    // detay-20: gizli adaylar (güvenlik kuralından bağımsız öneri) varsayılan gizli; seçili olanlar her zaman görünür.
    const secili = new Set(seciliSira);
    const gizliSayisi = yuklenenCihazlar.filter(function (c) { return c.gizli === true && !secili.has(c.entity_id); }).length;
    gizlileriGosterMetin.textContent = t('ayar.favori.gizlileriGosterSayili', { n: gizliSayisi });
    const eslesen = yuklenenCihazlar.filter(function (c) {
      if (c.gizli === true && !gizlileriGoster.checked && !secili.has(c.entity_id)) return false;
      return filtreyeUyar(filtre, [c.ad, c.entity_id, c.alanEtiketi]);
    });
    const gorunen = eslesen.slice(0, gosterilenCihazSayisi);

    satirOgeleri.clear();
    cihazListesi.replaceChildren();
    btnDahaFazla.style.display = eslesen.length > gorunen.length ? 'inline-flex' : 'none';
    btnDahaFazla.textContent = t('ayar.favori.dahaFazlaSayili', { n: eslesen.length - gorunen.length });
    if (gorunen.length === 0 && gorunenEksik.length === 0 && gorunenEngelli.length === 0) {
      cihazListesi.appendChild(el('div', 'liste-bos', t('ayar.favori.eslesenYok')));
      return;
    }

    // hata-14: HA'da şu an görünmeyen favoriler korunur; silme kararı kullanıcıya aittir.
    if (gorunenEksik.length > 0) {
      cihazListesi.appendChild(baslikSatiri(t('ayar.favori.bulunamayanBaslik')));
      gorunenEksik.forEach(function (e) {
        cihazListesi.appendChild(
          satirOlustur({
            kimlik: e.entity_id,
            ad: e.ad,
            turEtiketi: t('ayar.favori.bulunamadiTur'),
            durum: '',
            secili: secili.has(e.entity_id),
            secilebilir: true,
            sinifAdi: 'satir-bulunamadi',
            notMetni: t('ayar.favori.bulunamadiNot'),
          }),
        );
      });
    }
    if (gorunenEngelli.length > 0) {
      cihazListesi.appendChild(baslikSatiri(t('ayar.favori.engelliBaslik')));
      gorunenEngelli.forEach(function (e) {
        cihazListesi.appendChild(
          satirOlustur({
            kimlik: e.entity_id,
            ad: e.ad,
            turEtiketi: t('ayar.favori.engelliTur'),
            durum: '',
            secili: false,
            secilebilir: false,
            sinifAdi: 'satir-engelli',
            notMetni: t('ayar.favori.engelliNot'),
          }),
        );
      });
    }
    if ((gorunenEksik.length > 0 || gorunenEngelli.length > 0) && gorunen.length > 0) {
      cihazListesi.appendChild(baslikSatiri(t('ayar.favori.cihazlarBaslik')));
    }
    gorunen.forEach(function (cihaz) {
      cihazListesi.appendChild(
        satirOlustur({
          kimlik: cihaz.entity_id,
          ad: cihaz.ad,
          turEtiketi: cihaz.alanEtiketi,
          durum: cihaz.durum || '',
          secili: secili.has(cihaz.entity_id),
          secilebilir: true,
          notMetni: cihazNotu(cihaz),
          cihaz: cihaz,
        }),
      );
    });
  }

  // Ana sürece yalnız kimlik + (kullanıcının değiştirdiyse) onay/kısayol/parlaklık/karo adı gider; ad ve güvenlik denetimi ana süreçte yapılır.
  // Sıra, seçili listenin sırasıdır (tepsi menüsü bu sırayı kullanır).
  function favoriYuku() {
    const zorunlu = new Set(
      yuklenenCihazlar.filter(function (c) { return c.onayZorunlu; }).map(function (c) { return c.entity_id; }),
    );
    return seciliSira.map(function (kimlik) {
      const girdi = { entity_id: kimlik };
      if (onayDegisiklikleri.has(kimlik) && !zorunlu.has(kimlik)) girdi.onay = onayDegisiklikleri.get(kimlik);
      if (kisayolDegisiklikleri.has(kimlik)) girdi.kisayol = kisayolDegisiklikleri.get(kimlik);
      if (parlaklikDegisiklikleri.has(kimlik)) girdi.parlaklik = parlaklikDegisiklikleri.get(kimlik);
      if (etiketDegisiklikleri.has(kimlik)) girdi.etiket = etiketDegisiklikleri.get(kimlik);
      if (duzen) duzen.favoriYukunuEkle(kimlik, girdi); // yalnız değiştirilen görünüm alanları (ana süreç yeniden doğrular)
      return girdi;
    });
  }

  // Arka planda favori listesi değişti (hazır karoların yeniden denemesi, düğme): kaydedilmemiş düzenlemeler korunarak liste tazelenir (h-27).
  async function favorileriYenile() {
    const sonuc = await window.evPaneli.ayarlariGetir();
    if (!sonuc || !sonuc.ok) return false;
    mevcutAyarlar = sonuc;
    if (duzen && !duzen.sayfalarKirli()) duzen.sayfalariYukle(sonuc.sayfalar); // panel menüsünden de sayfa değişir (o-16): düzenlenmemişse taslak tazelenir
    bazSayfalariEsitle();
    favoriUygula(sonuc, true);
    masaustuListesiniSunucudanYenile(sonuc);
    hazirListeDurumunuGoster(sonuc.hazirListeGuncel);
    if (cihazlarYuklendi) await cihazlariYukle(true);
    else cihazlariCiz();
    kurulumGuncelle();
    kirliGuncelle();
    if (duzen) duzen.gecmisiYenile();
    return true;
  }

  /** Genel ayarların karşılaştırma metnindeki sayfa listesini düzen bölümünün kayıtlı sayfalarıyla eşitler. */
  function bazSayfalariEsitle() {
    if (!duzen || bazGenel === null) return;
    const temel = JSON.parse(bazGenel);
    temel.sayfalar = duzen.kayitliSayfalar();
    bazGenel = JSON.stringify(temel);
  }

  // --- Düzen: onarım ve "Düzenle…" odağı (o-28, o-16) ----------------------------------------------------------------------
  /** HA'da bulunamayan favori için aday cihazlar: ana sürecin güvenli listesinden, aynı alandan (alan değişmez) ve henüz favori olmayanlar. */
  function onarmaAdaylari(eski) {
    const alan = String(eski).split('.')[0];
    const alinmis = new Set(seciliSira.concat(kayitliSira));
    return yuklenenCihazlar.filter(function (c) {
      return String(c.entity_id).split('.')[0] === alan && !alinmis.has(c.entity_id);
    });
  }

  /** Onarım sunucuda yapıldı: yerel seçim, sıra ve bekleyen düzenlemeler yeni kimliğe taşınır (yoksa sonraki kayıt onarımı geri alırdı). */
  function favoriKimliginiDegistir(eski, yeni) {
    const degistir = function (k) { return k === eski ? yeni : k; };
    seciliSira = seciliSira.indexOf(yeni) >= 0 ? seciliSira.filter(function (k) { return k !== eski; }) : seciliSira.map(degistir);
    kayitliSira = kayitliSira.map(degistir);
    [onayDegisiklikleri, kisayolDegisiklikleri, parlaklikDegisiklikleri, etiketDegisiklikleri].forEach(function (harita) {
      if (!harita.has(eski)) return;
      const deger = harita.get(eski);
      harita.delete(eski);
      if (!harita.has(yeni)) harita.set(yeni, deger);
    });
    kisayolHatali.delete(eski);
    etiketHatali.delete(eski);
    if (duzen) duzen.kimlikDegisti(eski, yeni);
    bazSayfalariEsitle();
  }

  async function favoriOnarildi(eski, yeni) {
    favoriKimliginiDegistir(eski, yeni);
    await favorileriYenile();
  }

  /** Panel menüsündeki "Düzenle…": Favoriler bölümüne gider ve favorinin satırına odaklanır (liste henüz yüklü değilse yüklenince). */
  function favoriyeOdaklan(kimlik) {
    if (typeof kimlik !== 'string' || kimlik === '') return;
    bolumeGit('bolumFavoriler', 'favorilerBaslik');
    if (!cihazlarYuklendi) {
      bekleyenOdak = kimlik;
      return;
    }
    bekleyenOdak = '';
    let kutu = satirOgeleri.get(kimlik);
    if (!kutu && seciliSira.indexOf(kimlik) >= 0) {
      // süzgeç ya da "daha fazla göster" satırı gizliyor: süzgeç bu favoriye daraltılır
      cihazAra.value = kimlik;
      gosterilenCihazSayisi = CIHAZ_SAYFA_BOYUTU;
      cihazlariCiz();
      kutu = satirOgeleri.get(kimlik);
    }
    if (kutu) odakla(kutu);
  }

  // --- Kaydet (tek çubuk) --------------------------------------------------------------------------------------------------
  function genelYuku() {
    const a = genelAnlik();
    return {
      yerelAdres: a.yerelAdres,
      disAdres: a.disAdres,
      kisayol: a.kisayol,
      dil: a.dil,
      otomatikBaslat: a.otomatikBaslat,
      pencereBoyutu: a.pencereBoyutu,
      odakKaybindaGizle: a.odakKaybindaGizle,
      anaPanoyaDonDk: a.anaPanoyaDonDk,
      koseBildirimi: a.koseBildirimi,
      bipSesi: a.bipSesi,
      yeniPencereMalzemesi: a.yeniPencereMalzemesi,
      temaZorla: a.temaZorla,
      vurguRengi: vurguRengi.value.trim(),
      tepsiSolTik: a.tepsiSolTik,
      paletKisayol: a.paletKisayol,
      canliBaglanti: a.canliBaglanti,
      panolar: a.panolar,
      ...bilgiYuku(a),
      ...(duzen && duzen.sayfalarKirli() ? { sayfalar: a.sayfalar } : {}), // yalnız düzenlendiyse (o-24); ana süreç doğrular ve kapı kuralına takılan adı boşaltır
      // Pencere grubu (1.4.0): doğrulama ana süreçte (src/lib/ayar-alanlari.js); karolarda yalnız seçili, sabitlenebilir favoriler gider
      panelHerZamanUstte: a.panelHerZamanUstte,
      pencereKonumu: a.pencereKonumu,
      tercihEkran: a.tercihEkran,
      panelOpaklik: a.panelOpaklik,
      tepsiRozeti: a.tepsiRozeti,
      tepsiRozetSensoru: a.tepsiRozetSensoru,
      masaustuKarolari: masaustuKaroSecimi(),
      masaustuKaroUstte: a.masaustuKaroUstte,
    };
  }

  const KORUNACAK_ALANLAR = ['kisayol', 'paletKisayol', 'vurguRengi', 'anaPanoyaDonDk', 'pilEsigi', 'takvimGunSayisi'];

  async function hepsiniKaydet() {
    if (kaydediliyor) return;
    kaydediliyor = true;
    btnAyarlariKaydet.disabled = true;
    btnAyarlariKaydet.textContent = t('ayar.kaydet.kaydediliyor');
    tumIsaretleriTemizle();
    try {
      // 1) Genel ayarlar
      const gonderilenPanolar = panoYuku();
      const genel = await window.evPaneli.ayarlariKaydet(genelYuku());
      if (!genel.ok) {
        const alanlar = Array.isArray(genel.alanlar) ? genel.alanlar : [];
        const mesajlar = genel.alanMesajlari && typeof genel.alanMesajlari === 'object' ? genel.alanMesajlari : {};
        alanlar.forEach(function (ad) { alanIsaretle(ad, mesajlar[ad] || genel.hata); });
        bildirimGoster(genel.hata || t('ayar.kaydet.kaydedilemedi'), 'hata');
        ilkHataliyaOdaklan(alanlar);
        return;
      }
      const uyarilar = Array.isArray(genel.uyarilar) ? genel.uyarilar : [];
      // Reddedilen alanlar yazılan değerle kalır ve işaretlenir; yalnız bilgi veren (kayıt başarılı) uyarılar işaretlemez.
      const reddedilenler = [];
      uyarilar.forEach(function (u) {
        if (u && !u.yalnizKayitBasarili && u.alan) reddedilenler.push(u.alan);
      });
      const korunacak = reddedilenler.filter(function (a) { return KORUNACAK_ALANLAR.indexOf(a) >= 0; });

      // 2) Favoriler: liste yüklüyse ve değişiklik varsa (ya da güvenlik kuralına takılan eski kayıtlar çıkarılacaksa)
      let favoriSonuc = null;
      let favoriHatasi = '';
      const redKisayollar = new Map();
      const redEtiketler = new Map();
      if (cihazlarYuklendi && (favoriKirli() || engelliFavoriler.length > 0)) {
        const yuk = favoriYuku();
        const yazilanKisayollar = new Map(yuk.filter(function (g) { return typeof g.kisayol === 'string'; }).map(function (g) { return [g.entity_id, g.kisayol]; }));
        const yazilanEtiketler = new Map(yuk.filter(function (g) { return typeof g.etiket === 'string'; }).map(function (g) { return [g.entity_id, g.etiket]; }));
        const sonuc = await window.evPaneli.favorileriKaydet(yuk);
        if (sonuc.ok) {
          favoriSonuc = sonuc;
          (sonuc.kisayolHatalari || []).forEach(function (k) {
            if (yazilanKisayollar.has(k.entity_id)) redKisayollar.set(k.entity_id, yazilanKisayollar.get(k.entity_id));
          });
          (sonuc.etiketHatalari || []).forEach(function (k) {
            if (yazilanEtiketler.has(k.entity_id)) redEtiketler.set(k.entity_id, yazilanEtiketler.get(k.entity_id));
          });
        } else {
          favoriHatasi = sonuc.hata || t('ayar.kaydet.favoriKaydedilemedi');
        }
      }

      // 3) Yalnız kaydedilen bölümler sunucudaki değerlere döner; kaydedilemeyen bölümdeki düzenlemeler yerinde kalır.
      const taze = await window.evPaneli.ayarlariGetir();
      let dilDegisti = false;
      if (taze && taze.ok) {
        mevcutAyarlar = taze;
        dilDegisti = sunucuDiliniKabulEt(taze); // dil bu kayıtla değiştiyse sayfa yeni dilde yeniden yazılır, aşağıdaki iletiler de yeni dilde olur
        genelUygula(taze, korunacak);
        panolar = panolariKaydaGoreBirlestir(gonderilenPanolar, Array.isArray(taze.panolar) ? taze.panolar : []);
        panolariCiz();
        if (favoriSonuc) {
          favoriUygula(taze, false);
          redKisayollar.forEach(function (deger, kimlik) {
            kisayolDegisiklikleri.set(kimlik, deger);
            kisayolHatali.add(kimlik);
          });
          redEtiketler.forEach(function (deger, kimlik) {
            etiketDegisiklikleri.set(kimlik, deger);
            etiketHatali.add(kimlik);
          });
        }
        anahtarUygula(taze);
        yerelAdresUyarisiniGuncelle();
        kurulumGuncelle();
      }
      // Reddedilen alanları işaretle
      uyarilar.forEach(function (u) {
        if (u && !u.yalnizKayitBasarili && ALAN_KUTULARI[u.alan]) alanIsaretle(u.alan, u.mesaj);
      });
      // eksik / engelli listeleri ve onay değerleri güncellensin; dil değiştiyse cihaz türü ve durum adları da yeni dille gelsin
      if (favoriSonuc || (dilDegisti && cihazlarYuklendi)) await cihazlariYukle(true);
      else cihazlariCiz();
      siraCiz();
      kirliGuncelle();
      if (duzen) duzen.gecmisiYenile(); // kayıt düzen geçmişine yeni bir nokta eklemiş olabilir

      // 4) Sonuç iletisi (hata ve uyarılar kapatılana dek kalır)
      const parcalar = [];
      let tur = uyarilar.length > 0 ? 'uyari' : 'basarili';
      const reddedilenMesajlari = uyarilar.filter(function (u) { return u && !u.yalnizKayitBasarili && u.mesaj; }).map(function (u) { return u.mesaj; });
      const bilgiMesajlari = uyarilar.filter(function (u) { return u && u.yalnizKayitBasarili && u.mesaj; }).map(function (u) { return u.mesaj; });
      if (reddedilenMesajlari.length > 0) {
        parcalar.push(t('ayar.kaydet.bazilariUygulanamadi'));
        reddedilenMesajlari.forEach(function (m) { parcalar.push(m); });
      } else {
        parcalar.push(t('ayar.kaydet.kaydedildi'));
      }
      bilgiMesajlari.forEach(function (m) { parcalar.push(m); });
      if (favoriSonuc) {
        parcalar.push(cogul('ayar.kaydet.sayi', favoriSonuc.sayi));
        if (favoriSonuc.eksik > 0) parcalar.push(cogul('ayar.kaydet.eksik', favoriSonuc.eksik));
        if (favoriSonuc.engelli > 0) {
          parcalar.push(cogul('ayar.kaydet.engelli', favoriSonuc.engelli));
          tur = 'uyari';
        }
        // Kısayol sorunları (geçersiz, çakışan, yıkıcı eyleme atanmış, sınır aşıldı) favori kaydını durdurmaz; açıkça söylenir.
        const kisayolMesajlari = (favoriSonuc.kisayolSorunlari || [])
          .map(function (k) { return k.mesaj; })
          .filter(function (m) { return !!m; });
        const reddedilenSayisi = (favoriSonuc.kisayolHatalari || []).length;
        if (reddedilenSayisi > 0 && kisayolMesajlari.length === 0) {
          kisayolMesajlari.push(cogul('ayar.kaydet.kisayolRed', reddedilenSayisi));
        }
        if (kisayolMesajlari.length > 0) {
          parcalar.push(kisayolMesajlari.join(' '));
          tur = 'uyari';
        }
        const etiketSayisi = (favoriSonuc.etiketHatalari || []).length;
        if (etiketSayisi > 0) {
          parcalar.push(cogul('ayar.kaydet.etiketRed', etiketSayisi));
          tur = 'uyari';
        }
        const gorunumSayisi = (favoriSonuc.gorunumHatalari || []).length;
        if (gorunumSayisi > 0) {
          parcalar.push(cogul('ayar.kaydet.gorunumRed', gorunumSayisi)); // simge / renk / boyut kabul edilmedi (o-31): önceki değer korundu
          tur = 'uyari';
        }
      }
      if (favoriHatasi) {
        parcalar.push(t('ayar.kaydet.favoriHatasi', { hata: favoriHatasi }));
        tur = 'hata';
      }
      bildirimGoster(parcalar.join(' '), tur);
      if (reddedilenler.length > 0) ilkHataliyaOdaklan(reddedilenler);
    } catch (err) {
      bildirimGoster(t('ayar.kaydet.hata'), 'hata');
    } finally {
      kaydediliyor = false;
      btnAyarlariKaydet.disabled = false;
      btnAyarlariKaydet.textContent = t('ayar.kaydet.dugme');
    }
  }

  // --- Bağlantıyı sına (k-14) ----------------------------------------------------------------------------------------------
  function sonucYaz(kutu, metin, tamam) {
    kutu.textContent = metin;
    kutu.className = 'alan-sonuc ' + (tamam ? 'alan-sonuc-tamam' : 'alan-sonuc-sorun');
    kutu.style.display = metin ? 'block' : 'none';
  }

  async function adresiSina(tur) {
    const girdi = tur === 'dis' ? disAdres : yerelAdres;
    const kutu = tur === 'dis' ? disAdresSonuc : yerelAdresSonuc;
    const dugme = tur === 'dis' ? btnDisSina : btnYerelSina;
    const adres = girdi.value.trim();
    sonucYaz(kutu, '', false);
    if (adres === '') {
      sonucYaz(kutu, t('ayar.baglanti.sinaAdresYok'), false);
      return;
    }
    dugme.disabled = true;
    dugme.textContent = t('ayar.baglanti.sinaniyor');
    try {
      const sonuc = await window.evPaneli.adresSina(adres, tur);
      if (sonuc && sonuc.ok) {
        sonucYaz(kutu, sonuc.mesaj || (sonuc.ulasilabilir ? t('ayar.baglanti.adresCalisiyor') : t('ayar.baglanti.adresUlasilamadi')), sonuc.ulasilabilir === true);
      } else {
        sonucYaz(kutu, (sonuc && sonuc.hata) || t('ayar.baglanti.sinanamadi'), false);
      }
    } catch (err) {
      sonucYaz(kutu, t('ayar.baglanti.sinaHata'), false);
    } finally {
      dugme.disabled = false;
      dugme.textContent = t('ayar.baglanti.sina');
    }
  }

  // --- Dışa / içe aktarma, yedekten dönme (k-13) -----------------------------------------------------------------------------
  function yedekZamani(zaman) {
    try {
      return new Date(zaman).toLocaleString(dil === 'en' ? 'en-US' : 'tr-TR');
    } catch {
      return '';
    }
  }

  function yedekleriCiz(yedekler) {
    yedekListesi.replaceChildren();
    const liste = Array.isArray(yedekler) ? yedekler : [];
    sonYedekler = liste;
    yedekDurum.textContent = liste.length === 0 ? t('ayar.yedek.yok') : '';
    liste.forEach(function (yedek) {
      const satir = el('div', 'yedek-satir');
      satir.setAttribute('role', 'listitem');
      const bilgi = el('div', '', '');
      bilgi.appendChild(el('div', '', yedek.tur === 'goc' ? t('ayar.yedek.goc', { surum: yedek.surum }) : t('ayar.yedek.bozuk')));
      const kb = Math.max(1, Math.round((Number(yedek.bayt) || 0) / 1024));
      bilgi.appendChild(el('div', 'yedek-bilgi', yedekZamani(yedek.zaman) + ' · ' + kb + ' KB' + (yedek.okunabilir ? '' : t('ayar.yedek.okunamiyor'))));
      const dugme = el('button', 'buton buton-ikincil buton-kucuk', t('ayar.yedek.don'));
      dugme.type = 'button';
      dugme.disabled = !yedek.okunabilir;
      dugme.setAttribute('aria-label', t('ayar.yedek.donEtiket', { zaman: yedekZamani(yedek.zaman) }));
      dugme.addEventListener('click', function () { yedegeDon(yedek.ad, dugme); });
      satir.appendChild(bilgi);
      satir.appendChild(dugme);
      yedekListesi.appendChild(satir);
    });
  }

  async function yedekleriYukle() {
    try {
      const sonuc = await window.evPaneli.yedekleriGetir();
      if (sonuc && sonuc.ok) yedekleriCiz(sonuc.yedekler);
    } catch (err) {
      yedekDurum.textContent = t('ayar.yedek.listeAlinamadi');
    }
  }

  /** İçe aktarma / yedekten dönme sonrası: tüm bölümler sunucudaki (artık değişmiş) değerlere döner. */
  async function aktarimSonrasiYenile() {
    const sonuc = await window.evPaneli.ayarlariGetir();
    if (!sonuc || !sonuc.ok) return;
    mevcutAyarlar = sonuc;
    sunucuDiliniKabulEt(sonuc); // içe aktarılan / dönülen ayarda dil farklıysa sayfa yeni dilde yeniden yazılır
    tumIsaretleriTemizle();
    genelUygula(sonuc, []);
    panolariSunucudanKur(sonuc);
    favoriUygula(sonuc, false);
    anahtarUygula(sonuc);
    yerelAdresUyarisiniGuncelle();
    kurulumGuncelle();
    if (cihazlarYuklendi) await cihazlariYukle(true);
    kirliGuncelle();
    if (duzen) duzen.gecmisiYenile();
  }

  async function aktarimSonucunuGoster(sonuc, ozetAnahtari) {
    if (sonuc && sonuc.iptal) return;
    if (!sonuc || !sonuc.ok) {
      bildirimGoster((sonuc && sonuc.hata) || t('ayar.aktar.islemYapilamadi'), 'hata');
      return;
    }
    await aktarimSonrasiYenile(); // dil de değişmiş olabilir (yedekteki ayar): sonuç iletisi güncel dilde yazılsın
    const parcalar = [t('ayar.aktar.ozet', { ozet: t(ozetAnahtari), ad: sonuc.ad })];
    if (Number.isInteger(sonuc.alanSayisi)) parcalar.push(cogul('ayar.aktar.alanSayisi', sonuc.alanSayisi));
    if (Number.isInteger(sonuc.favoriSayisi)) parcalar.push(cogul('ayar.aktar.favoriSayisi', sonuc.favoriSayisi));
    if (sonuc.atilanSayisi > 0) parcalar.push(cogul('ayar.aktar.atilan', sonuc.atilanSayisi));
    (sonuc.notlar || []).forEach(function (n) { parcalar.push(n); });
    (sonuc.uyarilar || []).forEach(function (u) { parcalar.push(u); });
    parcalar.push(t('ayar.aktar.anahtarDegismedi'));
    const uyari = sonuc.atilanSayisi > 0 || (sonuc.notlar || []).length > 0 || (sonuc.uyarilar || []).length > 0;
    bildirimGoster(parcalar.join(' '), uyari ? 'uyari' : 'basarili');
    yedekleriYukle();
  }

  async function disaAktar() {
    btnDisaAktar.disabled = true;
    try {
      const sonuc = await window.evPaneli.ayarlariDisaAktar();
      if (sonuc && sonuc.iptal) return;
      if (sonuc && sonuc.ok) {
        bildirimGoster(t('ayar.aktar.disaAktarildi', { ad: sonuc.ad }));
      } else {
        bildirimGoster((sonuc && sonuc.hata) || t('ayar.aktar.disaAktarilamadi'), 'hata');
      }
    } catch (err) {
      bildirimGoster(t('ayar.aktar.disaAktarirkenHata'), 'hata');
    } finally {
      btnDisaAktar.disabled = false;
    }
  }

  async function iceAktar() {
    if (kirliMi() && !confirm(t('ayar.aktar.kirliOnayi'))) return;
    btnIceAktar.disabled = true;
    try {
      const sonuc = await window.evPaneli.ayarlariIceAktar();
      await aktarimSonucunuGoster(sonuc, 'ayar.aktar.iceAktarildi');
    } catch (err) {
      bildirimGoster(t('ayar.aktar.iceAktarirkenHata'), 'hata');
    } finally {
      btnIceAktar.disabled = false;
    }
  }

  async function yedegeDon(ad, dugme) {
    if (!confirm(t('ayar.aktar.geriDonmeOnayi'))) return;
    dugme.disabled = true;
    try {
      const sonuc = await window.evPaneli.yedektenDon(ad);
      await aktarimSonucunuGoster(sonuc, 'ayar.aktar.geriDonuldu');
    } catch (err) {
      bildirimGoster(t('ayar.aktar.geriDonerkenHata'), 'hata');
    } finally {
      dugme.disabled = false;
    }
  }

  // --- Yakınlaştırma (g-13) ------------------------------------------------------------------------------------------------
  function yakinlastirmaUygula() {
    document.documentElement.style.zoom = String(YAKINLASTIRMA_ADIMLARI[yakinlastirmaSirasi]);
    try {
      window.localStorage.setItem(YAKINLASTIRMA_ANAHTARI, String(yakinlastirmaSirasi));
    } catch {
      /* yerel depolama yok: yakınlaştırma yalnız bu oturumda kalır */
    }
  }

  function yakinlastir(yon) {
    // yon: +1 büyüt, -1 küçült, 0 sıfırla
    yakinlastirmaSirasi = yon === 0 ? 2 : Math.max(0, Math.min(YAKINLASTIRMA_ADIMLARI.length - 1, yakinlastirmaSirasi + yon));
    yakinlastirmaUygula();
  }

  function yakinlastirmayiGeriYukle() {
    try {
      const ham = window.localStorage.getItem(YAKINLASTIRMA_ANAHTARI);
      const kayit = ham === null || ham === '' ? NaN : Number(ham);
      if (Number.isInteger(kayit) && kayit >= 0 && kayit < YAKINLASTIRMA_ADIMLARI.length) {
        yakinlastirmaSirasi = kayit;
        document.documentElement.style.zoom = String(YAKINLASTIRMA_ADIMLARI[kayit]);
      }
    } catch {
      /* yerel depolama yok */
    }
  }

  // --- Arayüz dili: değiştirme ve yeniden yazma ----------------------------------------------------------------------------
  function sonDiliOku() {
    try {
      const ham = window.localStorage.getItem(DIL_ANAHTARI);
      return dilTemizMi(ham) ? ham : null;
    } catch {
      return null; // yerel depolama yok
    }
  }

  function sonDiliYaz() {
    try {
      window.localStorage.setItem(DIL_ANAHTARI, dil);
    } catch {
      /* yerel depolama yok: dil yalnız ana süreçten gelir */
    }
  }

  /**
   * Etkin dili değiştirir: çevirmen yenilenir, HTML'deki data-i18n işaretli metinler yeni dile çevrilir. JS'in yazdığı metinler
   * (rozetler, uyarılar, satırlar) için ayrıca metinleriYenile çağrılır.
   */
  function dilKur(hedef) {
    dil = dilTemizMi(hedef) ? hedef : 'tr';
    t = cevirmenKur(dil);
    if (Dil) Dil.sayfayiCevir(document, t);
    // sayfayiCevir meşgul düğmelerin etiketini boştaki haline çevirir: süren işlemlerin etiketi geri yazılır
    [
      [btnAyarlariKaydet, 'ayar.kaydet.kaydediliyor'],
      [btnAnahtarKaydet, 'ayar.anahtar.dogrulaniyor'],
      [btnYetkiYenidenDene, 'ayar.anahtar.dogrulaniyor'],
      [btnCihazlariYukle, 'ayar.favori.yukleniyor'],
      [btnYerelSina, 'ayar.baglanti.sinaniyor'],
      [btnDisSina, 'ayar.baglanti.sinaniyor'],
    ].forEach(function (c) {
      if (c[0].disabled) c[0].textContent = t(c[1]);
    });
    sonDiliYaz();
  }

  /**
   * JS'in durumdan yazdığı metinleri (sayfayiCevir'in dokunmadığı ya da boşta haline çevirdiği her şeyi) yeni dilde yeniden yazar.
   * Hiçbir kullanıcı düzenlemesine, kirli duruma ya da hata işaretine dokunulmaz. genelHaric: genel ayar iletileri sonradan
   * genelUygula ile yazılacaksa atlanır.
   */
  function metinleriYenile(genelHaric) {
    kurulumGuncelle();
    anahtarGorunurlugunuAyarla(anahtarGirdisi.type !== 'password');
    anahtarUzunluguGuncelle();
    vurguOnizlemeGuncelle();
    guncelleSecilenSayisi();
    // Adres sınama sonucu o anki dilde yazılmış tek seferlik bir iletidir: eski dilde kalmasın diye kaldırılır.
    sonucYaz(yerelAdresSonuc, '', false);
    sonucYaz(disAdresSonuc, '', false);
    if (mevcutAyarlar) {
      anahtarUygula(mevcutAyarlar);
      yerelAdresUyarisiniGuncelle();
      if (!genelHaric) genelIletileriniYenile(mevcutAyarlar);
    }
    panolariCiz();
    siraCiz();
    bilgiMetinleriniYenile();
    pencereSecenekleriniYenile();
    if (cihazlarYuklendi) cihazlariCiz();
    else if (listeIletisi) listeMesaji(listeIletisi.anahtar, listeIletisi.hata, listeIletisi.ham);
    if (sonYedekler !== null) yedekleriCiz(sonYedekler);
    if (duzen) duzen.metinleriYenile(); // sayfalar ve düzen geçmişi yeni dilde
  }

  /** Ayar özetindeki etkin dil şimdikinden farklıysa dili değiştirir ve sayfayı yeniden yazar. true: dil değişti. */
  function sunucuDiliniKabulEt(sonuc) {
    if (!sonuc || !dilTemizMi(sonuc.dil) || sonuc.dil === dil) return false;
    dilKur(sonuc.dil);
    metinleriYenile(true);
    return true;
  }

  // Dil ana süreçte değişti (Ayarlar'dan kayıt): sayfa kendini yeniden çevirir. Ana süreç iletileri (cihaz türleri, durum adları, uyarılar)
  // yeni dilde hazır geldiği için ayar özeti ve cihaz listesi yeniden alınır; kaydedilmemiş düzenlemeler korunur.
  if (window.evPaneli && typeof window.evPaneli.onDilDegisti === 'function') {
    window.evPaneli.onDilDegisti(function (yuk) {
      const hedef = yuk && yuk.dil;
      if (!dilTemizMi(hedef) || hedef === dil) return;
      dilKur(hedef);
      window.evPaneli.ayarlariGetir()
        .then(function (sonuc) { if (sonuc && sonuc.ok) mevcutAyarlar = sonuc; })
        .catch(function () { /* önceki özetle devam edilir */ })
        .then(function () {
          metinleriYenile(false);
          if (cihazlarYuklendi) return cihazlariYukle(true);
          return undefined;
        })
        .catch(function () { /* sonraki kaydetmede yeniden denenir */ });
    });
  }

  // --- Olaylar -------------------------------------------------------------------------------------------------------------
  const kirliAlanlari = [
    yerelAdres, disAdres, canliBaglanti, otomatikBaslat, pencereBoyutu, odakKaybindaGizle, anaPanoyaDonDk,
    koseBildirimi, bipSesi, yeniPencereMalzemesi, temaZorla, tepsiSolTik, dilSecimi,
  ];
  kirliAlanlari.forEach(function (girdi) {
    girdi.addEventListener('input', kirliGuncelle);
    girdi.addEventListener('change', kirliGuncelle);
  });

  // Pencere grubu (1.4.0) denetimleri
  [panelHerZamanUstte, pencereKonumu, tercihEkran, panelOpaklik, tepsiRozeti, tepsiRozetSensoru, masaustuKaroUstte].forEach(function (girdi) {
    girdi.addEventListener('input', kirliGuncelle);
    girdi.addEventListener('change', kirliGuncelle);
  });
  panelOpaklik.addEventListener('input', opaklikYazisiniGuncelle);
  tepsiRozeti.addEventListener('change', rozetSensorDurumunuGuncelle);

  [yerelAdres, disAdres, vurguRengi, anaPanoyaDonDk].forEach(function (girdi) {
    const ad = girdi === yerelAdres ? 'yerelAdres' : girdi === disAdres ? 'disAdres' : girdi === vurguRengi ? 'vurguRengi' : 'anaPanoyaDonDk';
    girdi.addEventListener('input', function () {
      if (ad !== 'vurguRengi') alanTemizle(ad);
    });
  });

  kisayolKutusunuBagla(kisayol, { bosIzinli: false, kutu: kisayolUyarilari, degisti: kirliGuncelle });
  kisayolKutusunuBagla(paletKisayol, { bosIzinli: true, kutu: paletKisayolUyarilari, degisti: kirliGuncelle });

  btnKisayolVarsayilan.addEventListener('click', function () {
    kisayol.value = kisGoster(varsayilanKisayolMetni);
    kisayolAnlikDenetle(kisayol, kisayolUyarilari, false);
    kirliGuncelle();
  });

  btnPaletKisayolVarsayilan.addEventListener('click', function () {
    paletKisayol.value = kisGoster(varsayilanPaletKisayolMetni);
    kisayolAnlikDenetle(paletKisayol, paletKisayolUyarilari, true);
    kirliGuncelle();
  });

  vurguRengi.addEventListener('input', function () {
    vurguOnizlemeGuncelle();
    kirliGuncelle();
  });

  vurguRengiSecici.addEventListener('input', function () {
    vurguRengi.value = vurguRengiSecici.value;
    vurguOnizlemeGuncelle();
    kirliGuncelle();
  });

  btnVurguSifirla.addEventListener('click', function () {
    vurguRengi.value = '';
    vurguOnizlemeGuncelle();
    kirliGuncelle();
  });

  yerelAdres.addEventListener('input', yerelAdresUyarisiniGuncelle);
  btnYerelSina.addEventListener('click', function () { adresiSina('yerel'); });
  btnDisSina.addEventListener('click', function () { adresiSina('dis'); });

  btnPanoEkle.addEventListener('click', function () {
    if (panolar.length >= EN_COK_PANO) return;
    panolar.push({ ad: '', yol: '', kisayol: '', kayitli: false, sunucuSira: -1, hata: '' });
    panolariCiz();
    kirliGuncelle();
  });

  btnAcikSayfaEkle.addEventListener('click', async function () {
    if (panolar.length >= EN_COK_PANO) return;
    btnAcikSayfaEkle.disabled = true;
    try {
      const sonuc = await window.evPaneli.acikSayfa();
      if (!sonuc || !sonuc.ok) {
        bildirimGoster((sonuc && sonuc.hata) || t('ayar.pano.acikSayfaYok'), 'hata');
      } else if (panolar.some(function (p) { return p.yol.trim() === sonuc.yol; })) {
        bildirimGoster(t('ayar.pano.zatenVar', { yol: sonuc.yol }), 'uyari', 6000);
      } else {
        panolar.push({ ad: String(sonuc.ad || ''), yol: String(sonuc.yol), kisayol: '', kayitli: false, sunucuSira: -1, hata: '' });
        panolariCiz();
        kirliGuncelle();
        bildirimGoster(t('ayar.pano.eklendi'), 'basarili', 6000);
      }
    } catch (err) {
      bildirimGoster(t('ayar.pano.acikSayfaHata'), 'hata');
    } finally {
      btnAcikSayfaEkle.disabled = panolar.length >= EN_COK_PANO;
    }
  });

  btnHazirListe.addEventListener('click', async function () {
    btnHazirListe.disabled = true;
    try {
      const sonuc = await window.evPaneli.hazirListeyiUygula();
      if (sonuc.ok) {
        bildirimGoster(
          sonuc.atlanan > 0 ? cogul('ayar.hazir.eklendiAtlanan', sonuc.eklenen, { m: sonuc.atlanan }) : cogul('ayar.hazir.eklendi', sonuc.eklenen),
          'basarili',
          7000,
        );
        await favorileriYenile();
      } else {
        bildirimGoster(sonuc.hata || t('ayar.hazir.uygulanamadi'), 'hata');
      }
    } catch (err) {
      bildirimGoster(t('ayar.hazir.hata'), 'hata');
    } finally {
      btnHazirListe.disabled = false;
    }
  });

  if (typeof window.evPaneli.onFavorilerDegisti === 'function') {
    window.evPaneli.onFavorilerDegisti(function () {
      favorileriYenile()
        .then(function (tamam) {
          if (tamam) bildirimGoster(t('ayar.favori.guncellendi'), 'basarili', 6000);
        })
        .catch(function () { /* sonraki kaydetmede yeniden denenir */ });
    });
  }

  // Panelde karo menüsünden "Düzenle…" (o-16): ilgili favorinin satırına gidilir.
  if (typeof window.evPaneli.onFavoriyeGit === 'function') {
    window.evPaneli.onFavoriyeGit(function (kimlik) {
      favoriyeOdaklan(kimlik);
    });
  }

  gizlileriGoster.addEventListener('change', function () {
    if (cihazlarYuklendi) cihazlariCiz();
  });

  cihazAra.addEventListener('input', function () {
    gosterilenCihazSayisi = CIHAZ_SAYFA_BOYUTU;
    cihazlariCiz();
  });

  btnDahaFazla.addEventListener('click', function () {
    gosterilenCihazSayisi += CIHAZ_SAYFA_BOYUTU;
    cihazlariCiz();
  });

  btnCihazlariYukle.addEventListener('click', function () { cihazlariYukle(false); });

  btnOtomatikBaslatEtkinlestir.addEventListener('click', async function () {
    btnOtomatikBaslatEtkinlestir.disabled = true;
    try {
      const sonuc = await window.evPaneli.otomatikBaslatEtkinlestir();
      if (sonuc.ok) {
        otomatikBaslat.checked = !!sonuc.otomatikBaslat;
        otomatikBaslatDurumunuGoster(sonuc.otomatikBaslatDurumu);
        if (bazGenel !== null) {
          // Etkinleştirme kendi başına kaydedilmiş bir değişikliktir: karşılaştırma metni bu alanda güncellenir.
          const temel = JSON.parse(bazGenel);
          temel.otomatikBaslat = otomatikBaslat.checked;
          bazGenel = JSON.stringify(temel);
          kirliGuncelle();
        }
        bildirimGoster(t('ayar.baslangic.etkinlestirildi'));
      } else {
        bildirimGoster(sonuc.hata || t('ayar.baslangic.etkinlestirilemedi'), 'hata');
      }
    } catch (err) {
      bildirimGoster(t('ayar.baslangic.hata'), 'hata');
    } finally {
      btnOtomatikBaslatEtkinlestir.disabled = false;
    }
  });

  btnAyarlariKaydet.addEventListener('click', hepsiniKaydet);
  btnBildirimKapat.addEventListener('click', bildirimGizle);

  // Anahtar bölümü
  anahtarGirdisi.addEventListener('input', function () {
    ikinciOnayiGizle();
    gecersizIsaretle(anahtarGirdisi, false);
    anahtarUzunluguGuncelle();
  });
  anahtarGirdisi.addEventListener('keydown', function (olay) {
    if (olay.key === 'Enter') {
      olay.preventDefault();
      anahtarKaydet();
    }
  });
  btnAnahtarGoster.addEventListener('click', function () {
    anahtarGorunurlugunuAyarla(anahtarGirdisi.type === 'password');
  });
  btnAnahtarKaydet.addEventListener('click', anahtarKaydet);
  btnYetkiYenidenDene.addEventListener('click', yenidenDene);
  btnAnahtarSil.addEventListener('click', anahtarSil);

  btnDisaAktar.addEventListener('click', disaAktar);
  btnIceAktar.addEventListener('click', iceAktar);

  // Bölüm bağlantıları (g-10)
  BOLUM_BAGLARI.forEach(function (bag) {
    $(bag[0]).addEventListener('click', function (olay) {
      olay.preventDefault();
      bolumeGit(bag[1], bag[2]);
    });
  });

  // Klavye: Ctrl+S kaydeder, Esc kapatır (kaydedilmemiş değişiklik varsa pencere sorar), Ctrl +/-/0 yakınlaştırır.
  document.addEventListener('keydown', function (olay) {
    const ctrl = olay.ctrlKey || olay.metaKey;
    const tus = String(olay.key || '');
    if (ctrl && !olay.altKey) {
      if ((tus === 's' || tus === 'S') && !olay.shiftKey) {
        olay.preventDefault();
        hepsiniKaydet();
      } else if (tus === '+' || tus === '=' || tus === 'Add') {
        olay.preventDefault();
        yakinlastir(1);
      } else if (tus === '-' || tus === '_' || tus === 'Subtract') {
        olay.preventDefault();
        yakinlastir(-1);
      } else if (tus === '0') {
        olay.preventDefault();
        yakinlastir(0);
      }
      return;
    }
    if (tus === 'Escape' && !olay.ctrlKey && !olay.altKey && !olay.shiftKey && !olay.metaKey) {
      olay.preventDefault();
      window.close();
    }
  });

  // Kaydedilmemiş değişiklikle kapatma: ana süreç “Kapat / Vazgeç” sorar (will-prevent-unload).
  window.addEventListener('beforeunload', function (olay) {
    if (!kapatmaOnayiGerekli()) return;
    olay.preventDefault();
    olay.returnValue = '';
  });

  // --- Açılış --------------------------------------------------------------------------------------------------------------
  async function sayfaYukle() {
    try {
      yakinlastirmayiGeriYukle();
      const sonuc = await window.evPaneli.ayarlariGetir();
      if (!sonuc.ok) {
        bildirimGoster(sonuc.hata || t('ayar.yukleme.hata'), 'hata');
        return;
      }
      mevcutAyarlar = sonuc;
      sunucuDiliniKabulEt(sonuc); // ana sürecin etkin dili önbellekteki dilden farklıysa düzeltilir
      genelUygula(sonuc, []);
      panolariSunucudanKur(sonuc);
      favoriUygula(sonuc, false);
      anahtarUygula(sonuc);
      yerelAdresUyarisiniGuncelle();
      kurulumGuncelle();
      kirliGuncelle();
      if (!sonuc.anahtarVar) {
        // k-03: anahtar yoksa sayfa anahtar bölümünde açılır ve üç adımlık liste görünür.
        bolumeGit('bolumAnahtar', 'anahtarBaslik');
      } else if (anahtarSaglikli(sonuc)) {
        // k-04: anahtar var ve yetki kesici açık değilse cihaz listesi kendiliğinden yüklenir.
        cihazlariYukle(false);
      }
      yedekleriYukle();
      if (duzen) duzen.gecmisiYenile();
      if (typeof sonuc.odakFavori === 'string' && sonuc.odakFavori !== '') favoriyeOdaklan(sonuc.odakFavori); // panel menüsü "Düzenle…" ile açıldıysa
    } catch (err) {
      bildirimGoster(t('ayar.yukleme.alinirkenHata'), 'hata');
    }
  }

  // Ana süreçten gelen dil asıl kaynaktır; ama son kullanılan dil önbellekte durur, böylece sayfa ilk boyamadan önce doğru dilde açılır.
  const onbellekDili = sonDiliOku();
  if (onbellekDili !== null && onbellekDili !== dil) dilKur(onbellekDili);
  sayfaYukle();
})();
