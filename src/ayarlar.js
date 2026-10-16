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
  const AyarArama = window.EvAyarArama || null;
  const Dil = window.EvDil || null;
  const SozlukAyarlar = window.EvCeviriAyarlar || null;
  const SozlukAna = window.EvCeviriAna || null;
  const DuzenModulu = window.EvAyarlarDuzen || null; // 1.4.0 düzen (ayarlar-duzen.js): karo görünümü, sayfalar, geçmiş, onarım; yoksa Ayarlar bugünkü gibi çalışır
  const TemaRenk = window.EvTemaRenk || null; // panel renk önizlemesi (lib/tema-renk.js); yoksa önizleme çizilmez

  // --- Arayüz dili -------------------------------------------------------------------------------------------------------------
  const DIL_ANAHTARI = 'evPaneli.ayarlar.dil'; // son etkin dil ('tr' | 'en' | 'de' | 'fr' | 'es'): sayfa ilk boyamadan önce doğru dilde açılsın diye
  let dil = 'tr'; // etkin dil; kayıtlı seçim (sistem/tr/en/de/fr/es) dilSecimi alanındadır
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
    return Dil ? Dil.DILLER.indexOf(deger) >= 0 : deger === 'tr' || deger === 'en';
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
  const kayitliKisayolEylemi = new Map(); // kısayola basınca kesin yön (o-13): 'ac', 'kapat', 'parlak+10', 'hiz-20'...
  // Bu oturumda kullanıcının DEĞİŞTİRDİĞİ değerler (kayıtlı değere eşitse silinir: geri alınan düzenleme "kirli" sayılmaz)
  const onayDegisiklikleri = new Map();
  const kisayolDegisiklikleri = new Map();
  const parlaklikDegisiklikleri = new Map();
  const etiketDegisiklikleri = new Map();
  const kisayolEylemiDegisiklikleri = new Map();
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
  // Grup "tema": Metin boyutu (%) ve ayar değerleri (src/lib/gorunum.js ile aynı kümeler; renderer ana süreç modülü yüklemez)
  const METIN_OLCEKLERI = [100, 115, 130, 150];
  const PANEL_TEMALARI = ['varsayilan', 'okyanus', 'orman', 'gunbatimi', 'lavanta', 'grafit'];
  const HAVA_EFEKTLERI = ['yok', 'otomatik', 'yagmur', 'kar', 'gunes', 'firtina'];
  const MEVSIM_EFEKTLERI = ['yok', 'otomatik', 'ilkbahar', 'yaz', 'sonbahar', 'kis'];
  const RENK_DESENI = /^#[0-9a-fA-F]{6}$/;
  let metinCarpani = 1; // Ayarlar penceresinin kendi metin boyutu çarpanı (Ctrl +/- yakınlaştırmasının üstüne biner)
  let yakinlastirmaDokunuldu = false; // Ctrl +/-/0, kayıtlı seçim ya da metin boyutu: false iken sayfaya yakınlaştırma hiç yazılmaz

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
  const bildirimKalici = $('bildirimKalici');
  const bildirimPil = $('bildirimPil');
  const bildirimPilEsigi = $('bildirimPilEsigi');
  const bildirimPilEsigiHata = $('bildirimPilEsigiHata');
  const bildirimGuncelleme = $('bildirimGuncelleme');
  const bildirimMasaustu = $('bildirimMasaustu');
  const kuralListesi = $('kuralListesi');
  const kuralBos = $('kuralBos');
  const kuralCihazIpucu = $('kuralCihazIpucu');
  const btnKuralEkle = $('btnKuralEkle');
  const btnKuralCihazlar = $('btnKuralCihazlar');
  const kuralHata = $('kuralHata');
  const kuralVarliklari = $('kuralVarliklari');
  const dilSecimi = $('dilSecimi');
  const yeniPencereMalzemesi = $('yeniPencereMalzemesi');
  const malzemeUyari = $('malzemeUyari');
  const temaZorla = $('temaZorla');
  const vurguRengi = $('vurguRengi');
  const vurguRengiSecici = $('vurguRengiSecici');
  const vurguOnizleme = $('vurguOnizleme');
  const vurguHata = $('vurguHata');
  const btnVurguSifirla = $('btnVurguSifirla');
  const metinOlcegi = $('metinOlcegi');
  const yuksekKarsitlik = $('yuksekKarsitlik');
  const panelTemasi = $('panelTemasi');
  const panelVurguRengi = $('panelVurguRengi');
  const panelVurguSecici = $('panelVurguSecici');
  const panelVurguHata = $('panelVurguHata');
  const btnPanelVurguSifirla = $('btnPanelVurguSifirla');
  const panelArkaPlani = $('panelArkaPlani');
  const panelArkaSecici = $('panelArkaSecici');
  const panelArkaHata = $('panelArkaHata');
  const btnPanelArkaSifirla = $('btnPanelArkaSifirla');
  const temaOnizleme = $('temaOnizleme');
  const temaKontrast = $('temaKontrast');
  const animasyonlar = $('animasyonlar');
  const animasyonGecisleri = $('animasyonGecisleri');
  const havaEfekti = $('havaEfekti');
  const mevsimEfekti = $('mevsimEfekti');
  const hareketiAzalt = $('hareketiAzalt');
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
  const ayarAra = $('ayarAra');
  const ayarAramaDurum = $('ayarAramaDurum');
  const btnAyarAraTemizle = $('btnAyarAraTemizle');

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
  // Sürüm ve yenilikler (o-40)
  const surumDenetimi = $('surumDenetimi');
  const surumCalisan = $('surumCalisan');
  const surumDurum = $('surumDurum');
  const btnSurumDenetle = $('btnSurumDenetle');
  const btnSurumSayfasi = $('btnSurumSayfasi');
  const yenilikMetni = $('yenilikMetni');

  // Odadan başla (o-44)
  const btnOdalariGetir = $('btnOdalariGetir');
  const odaSec = $('odaSec');
  const odaDurum = $('odaDurum');
  const odaOnizleme = $('odaOnizleme');
  const btnOdaEkle = $('btnOdaEkle');

  // Tanılama ve günlük (o-41)
  const tanilamaMetni = $('tanilamaMetni');
  const tanilamaDurum = $('tanilamaDurum');
  const btnTanilamaGoster = $('btnTanilamaGoster');
  const btnTanilamaKopyala = $('btnTanilamaKopyala');
  const btnGunlukAc = $('btnGunlukAc');

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
    panelVurguRengi: { girdi: panelVurguRengi, hata: panelVurguHata },
    panelArkaPlani: { girdi: panelArkaPlani, hata: panelArkaHata },
    anaPanoyaDonDk: { girdi: anaPanoyaDonDk, hata: anaPanoyaDonHata, detay: 'bolumPencere' },
    kisayol: { girdi: kisayol, kutu: kisayolUyarilari },
    paletKisayol: { girdi: paletKisayol, kutu: paletKisayolUyarilari },
    bildirimPilEsigi: { girdi: bildirimPilEsigi, hata: bildirimPilEsigiHata, detay: 'bolumBildirimler' },
    uyariKurallari: { girdi: btnKuralEkle, hata: kuralHata, detay: 'bolumBildirimler' },
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
      bildirimKalici: bildirimKalici.checked,
      bildirimPil: bildirimPil.checked,
      bildirimPilEsigi: String(bildirimPilEsigi.value).trim(),
      bildirimGuncelleme: bildirimGuncelleme.checked,
      bildirimMasaustu: bildirimMasaustu.checked,
      uyariKurallari: kurallariYuku(),
      yeniPencereMalzemesi: yeniPencereMalzemesi.value,
      temaZorla: temaZorla.value,
      vurguRengi: vurguRengi.value.trim().toLowerCase(),
      metinOlcegi: Number(metinOlcegi.value),
      yuksekKarsitlik: yuksekKarsitlik.checked,
      panelTemasi: panelTemasi.value,
      panelVurguRengi: panelVurguRengi.value.trim().toLowerCase(),
      panelArkaPlani: panelArkaPlani.value.trim().toLowerCase(),
      animasyonlar: animasyonlar.checked,
      animasyonGecisleri: animasyonGecisleri.checked,
      havaEfekti: havaEfekti.value,
      mevsimEfekti: mevsimEfekti.value,
      hareketiAzalt: hareketiAzalt.checked,
      surumDenetimi: surumDenetimi.checked,
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
      dil: Dil ? Dil.dilAyariDuzelt(sonuc.dilAyari) : ['sistem', 'tr', 'en'].indexOf(sonuc.dilAyari) >= 0 ? sonuc.dilAyari : 'sistem',
      tepsiSolTik: sonuc.tepsiSolTik === 'pencere' ? 'pencere' : 'panel',
      canliBaglanti: sonuc.canliBaglanti !== false,
      otomatikBaslat: !!sonuc.otomatikBaslat,
      pencereBoyutu: sonuc.pencereBoyutu === 'genis' ? 'genis' : 'hizli',
      odakKaybindaGizle: sonuc.odakKaybindaGizle !== false,
      anaPanoyaDonDk: String(Number.isInteger(sonuc.anaPanoyaDonDk) ? sonuc.anaPanoyaDonDk : 5),
      koseBildirimi: sonuc.koseBildirimi !== false,
      bipSesi: sonuc.bipSesi === true,
      bildirimKalici: sonuc.bildirimKalici !== false,
      bildirimPil: sonuc.bildirimPil !== false,
      bildirimPilEsigi: String(Number.isInteger(sonuc.bildirimPilEsigi) ? sonuc.bildirimPilEsigi : 20),
      bildirimGuncelleme: sonuc.bildirimGuncelleme === true,
      bildirimMasaustu: sonuc.bildirimMasaustu !== false,
      uyariKurallari: kurallariSunucudan(sonuc),
      yeniPencereMalzemesi: ['acrylic', 'mica', 'yok'].indexOf(sonuc.yeniPencereMalzemesi) >= 0 ? sonuc.yeniPencereMalzemesi : 'acrylic',
      temaZorla: sonuc.temaZorla === 'sistem' || sonuc.temaZorla === 'acik' ? sonuc.temaZorla : 'koyu',
      vurguRengi: (typeof sonuc.vurguRengi === 'string' ? sonuc.vurguRengi : '').toLowerCase(),
      metinOlcegi: METIN_OLCEKLERI.indexOf(Number(sonuc.metinOlcegi)) >= 0 ? Number(sonuc.metinOlcegi) : 100,
      yuksekKarsitlik: sonuc.yuksekKarsitlik === true,
      panelTemasi: PANEL_TEMALARI.indexOf(sonuc.panelTemasi) >= 0 ? sonuc.panelTemasi : 'varsayilan',
      panelVurguRengi: typeof sonuc.panelVurguRengi === 'string' && RENK_DESENI.test(sonuc.panelVurguRengi) ? sonuc.panelVurguRengi.toLowerCase() : '',
      panelArkaPlani: typeof sonuc.panelArkaPlani === 'string' && RENK_DESENI.test(sonuc.panelArkaPlani) ? sonuc.panelArkaPlani.toLowerCase() : '',
      animasyonlar: sonuc.animasyonlar === true,
      animasyonGecisleri: sonuc.animasyonGecisleri !== false,
      havaEfekti: HAVA_EFEKTLERI.indexOf(sonuc.havaEfekti) >= 0 ? sonuc.havaEfekti : 'otomatik',
      mevsimEfekti: MEVSIM_EFEKTLERI.indexOf(sonuc.mevsimEfekti) >= 0 ? sonuc.mevsimEfekti : 'yok',
      hareketiAzalt: sonuc.hareketiAzalt === true,
      surumDenetimi: sonuc.surumDenetimi === true,
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
    return [onayDegisiklikleri, kisayolDegisiklikleri, parlaklikDegisiklikleri, etiketDegisiklikleri, kisayolEylemiDegisiklikleri].some(function (harita) {
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

  // --- Ayarlarda arama (o-26) ----------------------------------------------------------------------------------------------
  // Süzme mantığı lib/ayar-arama.js'tedir (sayfadaki .bolum ve .form-grubu öğelerini sınıfla gizler); burada yalnız kutu, durum satırı ve
  // klavye bağlanır. Arama sayfadaki GÖRÜNEN metne bakar: dil değişince ya da metinler yeniden yazılınca aynı sorgu yeniden uygulanır.
  let ayarAramasi = null; // ilk yazışta kurulur
  let aramaSonucu = null; // son sonuç: { aktif, bolumSayisi, ilk }

  function aramaDurumunuYaz() {
    if (!aramaSonucu || !aramaSonucu.aktif) {
      ayarAramaDurum.textContent = '';
      return;
    }
    ayarAramaDurum.textContent = aramaSonucu.bolumSayisi === 0 ? t('ayar.ara.yok') : cogul('ayar.ara.sonuc', aramaSonucu.bolumSayisi);
  }

  function ayarAramasiniUygula() {
    if (!AyarArama || !Arama || typeof document.querySelectorAll !== 'function') return;
    if (!ayarAramasi) ayarAramasi = AyarArama.olustur({ belge: document, katla: Arama.katlaDizi });
    aramaSonucu = ayarAramasi.uygula(ayarAra.value);
    btnAyarAraTemizle.style.display = aramaSonucu.aktif ? 'inline-flex' : 'none';
    aramaDurumunuYaz();
  }

  function ayarAramasiniTemizle() {
    ayarAra.value = '';
    ayarAramasiniUygula();
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
    if (durum && ['windows-kapatmis', 'kayit-yok', 'belirsiz', 'gelistirme', 'tasinabilir'].indexOf(durum.durum) >= 0) {
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

  // --- Grup "tema": okunabilirlik (o-25), panel renkleri (o-29), animasyonlar (o-34) -----------------------------------------------
  const ONIZLEME_DEGISKENLERI = ['--bg', '--karo', '--kenar', '--metin', '--soluk', '--vurgu', '--rozet-metin'];

  const sistemAcikMi = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches === true;

  /**
   * Bu pencerenin kendi görünümü: yüksek karşıtlık <html data-karsitlik> ile, metin boyutu yakınlaştırmaya çarpan olarak uygulanır.
   * Seçim formdan okunur: kutuyu değiştirince hemen görünür (kaydedilmese de); kaydedilmezse sayfa yenilenince eski haline döner.
   */
  function ayarlarGorunumunuUygula() {
    const kok = document.documentElement;
    if (yuksekKarsitlik.checked) kok.setAttribute('data-karsitlik', '1');
    else kok.removeAttribute('data-karsitlik');
    const olcek = Number(metinOlcegi.value);
    metinCarpani = METIN_OLCEKLERI.indexOf(olcek) >= 0 ? olcek / 100 : 1;
    if (metinCarpani !== 1) yakinlastirmaDokunuldu = true;
    yakinlastirmaYaz();
  }

  /** Panel rengi kutusu: "#rrggbb" ya da boş. Geçerliyse seçici eşlenir ve hata temizlenir; geçersizse kutu işaretlenir. true = geçerli. */
  function panelRengiDenetle(ad, girdi, secici) {
    const renk = girdi.value.trim();
    const gecerli = RENK_DESENI.test(renk);
    if (gecerli) secici.value = renk.toLowerCase();
    if (renk !== '' && !gecerli) {
      gecersizIsaretle(girdi, true);
      const hata = ALAN_KUTULARI[ad].hata;
      hata.textContent = t('ayar.vurgu.hata');
      hata.style.display = 'block';
      return false;
    }
    alanTemizle(ad);
    return true;
  }

  function onizlemeKontrastiMetni(oran) {
    const yazi = (Math.floor(oran * 10) / 10).toFixed(1); // aşağı yuvarlanır: "4,5" gösterilip gerçekte 4,46 olmasın
    return t('ayar.panelTema.kontrast', { oran: dil === 'en' ? yazi : yazi.replace('.', ',') });
  }

  /**
   * Panel renkleri önizlemesi: lib/tema-renk.js ana süreçteki aynı paleti üretir; en düşük metin kontrastı yazılır.
   * Geçersiz renk yok sayılır (kutu işaretlenir). Yüksek karşıtlık açıksa özel renkler kullanılmaz ve önizleme varsayılana döner.
   */
  function temaOnizlemeGuncelle() {
    const vurguGecerli = panelRengiDenetle('panelVurguRengi', panelVurguRengi, panelVurguSecici);
    const arkaGecerli = panelRengiDenetle('panelArkaPlani', panelArkaPlani, panelArkaSecici);
    if (!TemaRenk) return;
    if (yuksekKarsitlik.checked) {
      ONIZLEME_DEGISKENLERI.forEach(function (ad) { temaOnizleme.style.removeProperty(ad); });
      temaKontrast.textContent = t('ayar.panelTema.kontrastYuksek');
      return;
    }
    const sema = temaZorla.value === 'acik' || (temaZorla.value === 'sistem' && sistemAcikMi()) ? 'acik' : 'koyu';
    const palet = TemaRenk.paletUret({
      sema: sema,
      tema: panelTemasi.value,
      arkaPlan: arkaGecerli ? panelArkaPlani.value.trim() : '',
      vurgu: vurguGecerli ? panelVurguRengi.value.trim() : '',
    });
    const d = palet.degiskenler;
    ONIZLEME_DEGISKENLERI.forEach(function (ad) { temaOnizleme.style.setProperty(ad, d[ad]); });
    const oran = Math.min(
      TemaRenk.kontrast(d['--metin'], d['--bg']),
      TemaRenk.kontrast(d['--metin'], d['--karo']),
      TemaRenk.kontrast(d['--soluk'], d['--bg']),
      TemaRenk.kontrast(d['--soluk'], d['--karo']),
      TemaRenk.kontrast(d['--rozet-metin'], d['--vurgu']),
    );
    temaKontrast.textContent = onizlemeKontrastiMetni(oran);
  }

  /** Animasyonlar kapalıyken alt seçenekler (geçişler, hava, mevsim) pasif görünür; değerleri korunur. "Hareketi azalt" her zaman açıktır. */
  function animasyonAlanlariniGuncelle() {
    [animasyonGecisleri, havaEfekti, mevsimEfekti].forEach(function (girdi) { girdi.disabled = !animasyonlar.checked; });
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
    otomatikBaslat.disabled = !!sonuc.otomatikBaslatDurumu && sonuc.otomatikBaslatDurumu.durum === 'tasinabilir'; // taşınabilir sürümde Windows ile başlatma yok (o-45)
    pencereBoyutu.value = d.pencereBoyutu;
    odakKaybindaGizle.checked = d.odakKaybindaGizle;
    koseBildirimi.checked = d.koseBildirimi;
    bipSesi.checked = d.bipSesi;
    bildirimKalici.checked = d.bildirimKalici;
    bildirimPil.checked = d.bildirimPil;
    yaz('bildirimPilEsigi', bildirimPilEsigi, d.bildirimPilEsigi);
    bildirimGuncelleme.checked = d.bildirimGuncelleme;
    bildirimMasaustu.checked = d.bildirimMasaustu;
    if (!korunan.has('uyariKurallari')) {
      kurallar = (Array.isArray(sonuc.uyariKurallari) ? sonuc.uyariKurallari : []).map(function (k) { return kuralKur(k); });
      kuralListesiniCiz();
    }
    surumDenetimi.checked = d.surumDenetimi;
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
    metinOlcegi.value = String(d.metinOlcegi);
    yuksekKarsitlik.checked = d.yuksekKarsitlik;
    panelTemasi.value = d.panelTemasi;
    yaz('panelVurguRengi', panelVurguRengi, d.panelVurguRengi);
    yaz('panelArkaPlani', panelArkaPlani, d.panelArkaPlani);
    animasyonlar.checked = d.animasyonlar;
    animasyonGecisleri.checked = d.animasyonGecisleri;
    havaEfekti.value = d.havaEfekti;
    mevsimEfekti.value = d.mevsimEfekti;
    hareketiAzalt.checked = d.hareketiAzalt;
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
    ['yerelAdres', 'disAdres', 'anaPanoyaDonDk', 'bildirimPilEsigi', 'uyariKurallari'].forEach(function (ad) {
      if (!korunan.has(ad)) alanTemizle(ad);
    });
    vurguOnizlemeGuncelle(); // geçerli ya da boş renkte işareti kaldırır, korunan geçersiz değerde işaretli bırakır
    ayarlarGorunumunuUygula();
    temaOnizlemeGuncelle();
    animasyonAlanlariniGuncelle();
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
        odalar = [];
        odaSonucu = null;
        odaListesiniCiz();
        odaDurumunuYaz();
        guncelleSecilenSayisi();
        siraCiz();
        kuralDurumunuGuncelle();
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
    kayitliKisayolEylemi.clear();
    favoriler.forEach(function (f) {
      adHaritasi.set(f.entity_id, f.ad || f.entity_id);
      if (typeof f.onay === 'boolean') kayitliOnay.set(f.entity_id, f.onay);
      if (typeof f.kisayol === 'string' && f.kisayol) kayitliKisayol.set(f.entity_id, f.kisayol);
      if (f.parlaklik === true) kayitliParlaklik.set(f.entity_id, true);
      if (typeof f.etiket === 'string' && f.etiket) kayitliEtiket.set(f.entity_id, f.etiket);
      if (typeof f.kisayolEylemi === 'string' && f.kisayolEylemi) kayitliKisayolEylemi.set(f.entity_id, f.kisayolEylemi);
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
      kisayolEylemiDegisiklikleri.clear();
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

  function etkinKisayolEylemi(kimlik) {
    if (kisayolEylemiDegisiklikleri.has(kimlik)) return kisayolEylemiDegisiklikleri.get(kimlik);
    return kayitliKisayolEylemi.get(kimlik) || '';
  }

  // Kısayol eylemi seçeneğinin görünen adı: 'ac' -> "Aç", 'parlak+10' -> "Parlaklık +%10", 'hiz-20' -> "Hız −%20"; boş değer varsayılan aç-kapadır.
  function kisayolEylemiAdi(deger) {
    if (deger === 'ac') return t('ayar.cihaz.eylem.ac');
    if (deger === 'kapat') return t('ayar.cihaz.eylem.kapat');
    const e = /^(parlak|hiz)([+-])(\d{1,3})$/.exec(deger);
    if (!e) return t('ayar.cihaz.eylem.varsayilan');
    const artis = e[2] === '+';
    if (e[1] === 'parlak') return artis ? t('ayar.cihaz.eylem.parlakArti', { n: e[3] }) : t('ayar.cihaz.eylem.parlakEksi', { n: e[3] });
    return artis ? t('ayar.cihaz.eylem.hizArti', { n: e[3] }) : t('ayar.cihaz.eylem.hizEksi', { n: e[3] });
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
        kuralDurumunuGuncelle();
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
    let eylemSecici = null;
    let eylemSeciciniGuncelle = null;
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
      // Kısayol eylemi (o-13): kapalı listeden; boş = varlığın kendi aç-kapa eylemi. Yalnız kısayol varken seçilir; parlaklık adımları
      // yalnız "Parlaklık ayarı" açıkken.
      if (kisayolGirdisi && Array.isArray(s.cihaz.kisayolEylemleri) && s.cihaz.kisayolEylemleri.length > 0) {
        const eylemEtiket = el('label', 'onay-etiket');
        eylemEtiket.title = t('ayar.cihaz.kisayolEylemiIpucu');
        eylemEtiket.appendChild(el('span', '', t('ayar.cihaz.kisayolEylemi')));
        eylemSecici = document.createElement('select');
        eylemSecici.className = 'kisayol-eylemi';
        eylemSecici.setAttribute('aria-label', t('ayar.cihaz.kisayolEylemiEtiket', { ad: s.ad }));
        const eylemSecenekleri = [''].concat(s.cihaz.kisayolEylemleri);
        eylemSecenekleri.forEach(function (deger) {
          const secenek = document.createElement('option');
          secenek.value = deger;
          secenek.textContent = kisayolEylemiAdi(deger);
          eylemSecici.appendChild(secenek);
        });
        eylemSecici.value = etkinKisayolEylemi(s.kimlik);
        eylemSeciciniGuncelle = function (parlaklikDegisti) {
          const parlaklikAcik = parlaklikCb ? parlaklikCb.checked : false;
          Array.prototype.slice.call(eylemSecici.children).forEach(function (secenek) { // children bir HTMLCollection'dır (forEach yok)
            secenek.disabled = secenek.value.indexOf('parlak') === 0 && !parlaklikAcik;
          });
          eylemSecici.disabled = !cb.checked || kisNorm(kisayolGirdisi.value) === '';
          if (parlaklikDegisti === true && !parlaklikAcik && eylemSecici.value.indexOf('parlak') === 0) {
            eylemSecici.value = ''; // parlaklık ayarı kapandı: parlaklık adımı artık geçerli değil
            degisiklikAyarla(kisayolEylemiDegisiklikleri, s.kimlik, '', kayitliKisayolEylemi.get(s.kimlik) || '');
          }
        };
        eylemSecici.addEventListener('change', function () {
          degisiklikAyarla(kisayolEylemiDegisiklikleri, s.kimlik, eylemSecici.value, kayitliKisayolEylemi.get(s.kimlik) || '');
          kirliGuncelle();
        });
        eylemEtiket.appendChild(eylemSecici);
        ek.appendChild(eylemEtiket);
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
          if (eylemSeciciniGuncelle) eylemSeciciniGuncelle(true);
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
            if (eylemSeciciniGuncelle) eylemSeciciniGuncelle();
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
      if (eylemSeciciniGuncelle) eylemSeciciniGuncelle();
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
      if (eylemSeciciniGuncelle) eylemSeciciniGuncelle();
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
      if (kisayolEylemiDegisiklikleri.has(kimlik)) girdi.kisayolEylemi = kisayolEylemiDegisiklikleri.get(kimlik);
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
    [onayDegisiklikleri, kisayolDegisiklikleri, parlaklikDegisiklikleri, etiketDegisiklikleri, kisayolEylemiDegisiklikleri].forEach(function (harita) {
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

  // --- Sürüm ve yenilikler (o-40) ------------------------------------------------------------------------------------------
  // Denetim ana süreçte yapılır (seçenek kapalıyken ağa çıkılmaz); sayfa yalnız sonucu yazar. Notlar uygulamayla paketlenen CHANGELOG.md'dendir.
  // Sonuç metinleri durumdan türetilir (dil değişince yeniden yazılır).
  let surumKaydi = null; // { surum, acik, yeniSurum }
  let surumSonucu = null; // { tur: 'denetleniyor' | 'kapali' | 'guncel' | 'yeni' | 'cok-sik' | 'hata', surum }
  let yenilikKaydi = null; // { bulundu, baslik, metin }

  function surumDurumunuYaz() {
    surumCalisan.textContent = surumKaydi && surumKaydi.surum ? t('ayar.surum.calisan', { surum: surumKaydi.surum }) : '';
    const s = surumSonucu;
    let metin = '';
    if (s && s.tur === 'denetleniyor') metin = t('ayar.surum.denetleniyor');
    else if (s && s.tur === 'kapali') metin = t('ayar.surum.denetimKapali');
    else if (s && s.tur === 'guncel') metin = t('ayar.surum.guncel', { surum: s.surum });
    else if (s && s.tur === 'yeni') metin = t('ayar.surum.yeni', { surum: s.surum });
    else if (s && s.tur === 'cok-sik') metin = t('ayar.surum.cokSik');
    else if (s) metin = t('ayar.surum.hata');
    else if (surumKaydi && surumKaydi.yeniSurum) metin = t('ayar.surum.yeni', { surum: surumKaydi.yeniSurum });
    surumDurum.textContent = metin;
  }

  function yenilikleriYaz() {
    const notlarVar = yenilikKaydi && yenilikKaydi.bulundu && yenilikKaydi.metin;
    yenilikMetni.textContent = notlarVar ? yenilikKaydi.baslik + '\n\n' + yenilikKaydi.metin : t('ayar.surum.yenilikYok');
  }

  async function surumBolumunuYukle() {
    if (typeof window.evPaneli.surumDurumu === 'function') {
      try {
        const yanit = await window.evPaneli.surumDurumu();
        surumKaydi = yanit && yanit.ok ? yanit : null;
      } catch {
        surumKaydi = null;
      }
    }
    if (typeof window.evPaneli.yenilikleriGetir === 'function') {
      try {
        const yanit = await window.evPaneli.yenilikleriGetir();
        yenilikKaydi = yanit && yanit.ok ? yanit : null;
      } catch {
        yenilikKaydi = null;
      }
    }
    surumDurumunuYaz();
    yenilikleriYaz();
  }

  async function surumuDenetle() {
    if (typeof window.evPaneli.surumuDenetle !== 'function') return;
    btnSurumDenetle.disabled = true;
    surumSonucu = { tur: 'denetleniyor' };
    surumDurumunuYaz();
    try {
      const yanit = await window.evPaneli.surumuDenetle();
      const tur = yanit && yanit.ok ? yanit.sonuc : 'hata';
      surumSonucu = { tur: ['kapali', 'guncel', 'yeni', 'cok-sik'].indexOf(tur) >= 0 ? tur : 'hata', surum: yanit && typeof yanit.surum === 'string' ? yanit.surum : '' };
      if (surumSonucu.tur === 'guncel') surumSonucu.surum = surumKaydi && surumKaydi.surum ? surumKaydi.surum : surumSonucu.surum;
    } catch {
      surumSonucu = { tur: 'hata' };
    } finally {
      btnSurumDenetle.disabled = false;
    }
    surumDurumunuYaz();
  }

  async function surumSayfasiniAc() {
    if (typeof window.evPaneli.surumSayfasiniAc !== 'function') return;
    try {
      await window.evPaneli.surumSayfasiniAc();
    } catch {
      /* tarayıcı açılamadı: sessiz */
    }
  }

  // --- Odadan başla (o-44) ---------------------------------------------------------------------------------------------------
  // Odalar ve her odanın önerilen cihazları ana süreçten gelir (Kapı Kuralı'ndan geçmiş, zararsız, eylem alanındaki varlıklar; yalnız okur).
  // "Seçime ekle" öneriyi favori SEÇİMİNE katar (kimlikler yüklü cihaz listesinde olmalı); kayıt yine tek Kaydet düğmesindedir ve ana süreç
  // favoriler:kaydet'te her kimliği kendi süzgecinden yeniden geçirir. Durum satırı durumdan türetilir (dil değişince yeniden yazılır).
  const EN_COK_FAVORI = 200; // ana süreçteki favoriler:kaydet sınırı
  let odalar = []; // [{ id, ad, toplam, cihazlar: [{ entity_id, ad, alan }] }]
  let odaSonucu = null; // { tur: 'yukleniyor' | 'hazir' | 'bos' | 'canli-yok' | 'yetki' | 'hata' | 'eklendi' | 'sinir' | 'hepsi-secili', n, ad, sinir }

  function odaBul(kimlik) {
    return odalar.find(function (o) { return o.id === kimlik; }) || null;
  }

  function odaDurumunuYaz() {
    const s = odaSonucu;
    let metin = '';
    if (s && s.tur === 'yukleniyor') metin = t('ayar.oda.yukleniyor');
    else if (s && s.tur === 'hazir') metin = t('ayar.oda.hazir', { n: s.n });
    else if (s && s.tur === 'bos') metin = t('ayar.oda.bos');
    else if (s && s.tur === 'canli-yok') metin = t('ayar.oda.canliYok');
    else if (s && s.tur === 'yetki') metin = t('ayar.oda.yetki');
    else if (s && s.tur === 'eklendi') metin = cogul(s.sinir ? 'ayar.oda.eklendiSinir' : 'ayar.oda.eklendi', s.n, { ad: s.ad });
    else if (s && s.tur === 'sinir') metin = t('ayar.oda.sinir');
    else if (s && s.tur === 'hepsi-secili') metin = t('ayar.oda.hepsiSecili', { ad: s.ad });
    else if (s) metin = t('ayar.oda.hata');
    odaDurum.textContent = metin;
  }

  // Seçim kutusu odalarla kurulur; önceki seçim hâlâ varsa korunur.
  function odaListesiniCiz() {
    const onceki = odaSec.value;
    const secenekler = [el('option', '', t('ayar.oda.bosSecim'))];
    secenekler[0].value = '';
    odalar.forEach(function (oda) {
      const secenek = el('option', '', oda.ad + ' (' + oda.toplam + ')');
      secenek.value = oda.id;
      secenekler.push(secenek);
    });
    odaSec.replaceChildren.apply(odaSec, secenekler);
    odaSec.disabled = odalar.length === 0;
    odaSec.value = odaBul(onceki) ? onceki : '';
    odaOnizlemeyiCiz();
  }

  // Seçili odanın önerisi: başlık satırı ve cihaz satırları (yalnız textContent ile).
  function odaOnizlemeyiCiz() {
    const oda = odaBul(odaSec.value);
    odaOnizleme.replaceChildren();
    btnOdaEkle.disabled = !oda || oda.cihazlar.length === 0;
    if (!oda) {
      odaOnizleme.style.display = 'none';
      return;
    }
    odaOnizleme.style.display = '';
    const secili = new Set(seciliSira);
    odaOnizleme.appendChild(el('div', '', oda.cihazlar.length < oda.toplam
      ? t('ayar.oda.onizlemeKirpik', { ad: oda.ad, n: oda.toplam, m: oda.cihazlar.length })
      : t('ayar.oda.onizlemeBaslik', { ad: oda.ad, n: oda.toplam })));
    oda.cihazlar.forEach(function (c) {
      const ek = secili.has(c.entity_id) ? ' · ' + t('ayar.oda.zatenSecili') : '';
      odaOnizleme.appendChild(el('div', '', '• ' + c.ad + ' · ' + t('alan.' + c.alan) + ek));
    });
  }

  // Ana süreçten gelen oda verisi yalnız beklenen biçimde kabul edilir (kimlik, ad ve kimlik listesi); gerisi atılır.
  function odalariTemizle(ham) {
    const sonuc = [];
    (Array.isArray(ham) ? ham : []).forEach(function (o) {
      if (!o || typeof o.id !== 'string' || typeof o.ad !== 'string' || !Array.isArray(o.cihazlar)) return;
      const cihazlar = o.cihazlar.filter(function (c) { return c && typeof c.entity_id === 'string' && typeof c.ad === 'string' && typeof c.alan === 'string'; });
      if (cihazlar.length === 0) return;
      sonuc.push({ id: o.id, ad: o.ad, toplam: Number.isInteger(o.toplam) && o.toplam >= cihazlar.length ? o.toplam : cihazlar.length, cihazlar: cihazlar });
    });
    return sonuc;
  }

  async function odalariGetir() {
    if (typeof window.evPaneli.odalariGetir !== 'function') return;
    btnOdalariGetir.disabled = true;
    odaSonucu = { tur: 'yukleniyor' };
    odaDurumunuYaz();
    try {
      if (!cihazlarYuklendi) await cihazlariYukle(true); // eklenecek kimlikler yüklü cihaz listesinde bulunmalı
      const yanit = await window.evPaneli.odalariGetir();
      if (yanit && yanit.ok) {
        odalar = odalariTemizle(yanit.odalar);
        odaSonucu = odalar.length > 0 ? { tur: 'hazir', n: odalar.length } : { tur: 'bos' };
      } else {
        odalar = [];
        const neden = yanit && yanit.neden;
        odaSonucu = { tur: neden === 'canli-yok' ? 'canli-yok' : neden === 'yetki' ? 'yetki' : 'hata' };
      }
    } catch (err) {
      odalar = [];
      odaSonucu = { tur: 'hata' };
    } finally {
      btnOdalariGetir.disabled = false;
    }
    odaListesiniCiz();
    odaDurumunuYaz();
  }

  async function odayiSecimeEkle() {
    const oda = odaBul(odaSec.value);
    if (!oda) return;
    btnOdaEkle.disabled = true;
    try {
      if (!cihazlarYuklendi) await cihazlariYukle(true);
      if (!cihazlarYuklendi) {
        odaSonucu = { tur: 'hata' };
        return;
      }
      const secili = new Set(seciliSira);
      let eklenen = 0;
      let sinir = false;
      oda.cihazlar.forEach(function (c) {
        if (secili.has(c.entity_id) || !cihazHaritasi.has(c.entity_id)) return; // yalnız yüklü (süzgeçten geçmiş) adaylar
        if (seciliSira.length >= EN_COK_FAVORI) {
          sinir = true;
          return;
        }
        seciliSira.push(c.entity_id);
        secili.add(c.entity_id);
        eklenen += 1;
      });
      if (eklenen > 0) {
        guncelleSecilenSayisi();
        cihazlariCiz();
        siraCiz();
        kirliGuncelle();
        odaSonucu = { tur: 'eklendi', n: eklenen, ad: oda.ad, sinir: sinir };
      } else {
        odaSonucu = sinir ? { tur: 'sinir' } : { tur: 'hepsi-secili', ad: oda.ad };
      }
    } finally {
      odaOnizlemeyiCiz();
      odaDurumunuYaz();
    }
  }

  // --- Tanılama ve günlük (o-41) -------------------------------------------------------------------------------------------
  // Rapor ana süreçte kurulur (erişim anahtarı yok, adres yalnız sınıf olarak, günlük maskeli); sayfa yalnız gösterir. Kopyalamada ana süreç
  // AYNI metni panoya yazıp geri verir, böylece görünen metin kopyalanan metindir. Rapor metni İngilizcedir (sorun kaydı dili); durum
  // satırı arayüz dilindedir ve durumdan türetilir (dil değişince yeniden yazılır).
  let tanilamaSonucu = null; // { tur: 'hazir' | 'kopyalandi' | 'hata' | 'gunluk-acildi' | 'gunluk-yok', n }

  function tanilamaDurumunuYaz() {
    const s = tanilamaSonucu;
    let metin = '';
    if (s && s.tur === 'hazir') metin = t('ayar.arac.hazir', { n: s.n });
    else if (s && s.tur === 'kopyalandi') metin = t('ayar.arac.kopyalandi', { n: s.n });
    else if (s && s.tur === 'gunluk-acildi') metin = t('ayar.arac.gunlukAcildi');
    else if (s && s.tur === 'gunluk-yok') metin = t('ayar.arac.gunlukYok');
    else if (s) metin = t('ayar.arac.hata');
    tanilamaDurum.textContent = metin;
  }

  async function tanilamaIste(kopyala) {
    const islev = kopyala ? window.evPaneli.tanilamaKopyala : window.evPaneli.tanilamaGetir;
    if (typeof islev !== 'function') return;
    btnTanilamaGoster.disabled = true;
    btnTanilamaKopyala.disabled = true;
    try {
      const yanit = await islev();
      if (yanit && yanit.ok && typeof yanit.metin === 'string') {
        tanilamaMetni.textContent = yanit.metin;
        tanilamaSonucu = { tur: kopyala ? 'kopyalandi' : 'hazir', n: Number.isInteger(yanit.gunlukSatiri) ? yanit.gunlukSatiri : 0 };
      } else {
        tanilamaSonucu = { tur: 'hata' };
      }
    } catch {
      tanilamaSonucu = { tur: 'hata' };
    } finally {
      btnTanilamaGoster.disabled = false;
      btnTanilamaKopyala.disabled = false;
    }
    tanilamaDurumunuYaz();
  }

  async function gunlukKlasoruAc() {
    if (typeof window.evPaneli.gunlukKlasoruAc !== 'function') return;
    try {
      const yanit = await window.evPaneli.gunlukKlasoruAc();
      tanilamaSonucu = { tur: yanit && yanit.ok ? 'gunluk-acildi' : 'gunluk-yok' };
    } catch {
      tanilamaSonucu = { tur: 'gunluk-yok' };
    }
    tanilamaDurumunuYaz();
  }

  // Tepsiden "Yenilikler" ya da "Güncellemeleri denetle": ana süreç belirli bir bölümün açılmasını ister (yalnız bilinen kimlikler).
  const ACILABILIR_BOLUMLER = ['bolumSurum', 'bolumAraclar'];
  function bolumuAc(kimlik) {
    if (ACILABILIR_BOLUMLER.indexOf(kimlik) < 0) return;
    if (ayarAra.value !== '') ayarAramasiniTemizle();
    const bolum = $(kimlik);
    bolum.open = true;
    try {
      bolum.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* kaydırma desteklenmiyor */
    }
    const ozet = typeof bolum.querySelector === 'function' ? bolum.querySelector('summary') : null;
    if (ozet) odakla(ozet);
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
      bildirimKalici: a.bildirimKalici,
      bildirimPil: a.bildirimPil,
      bildirimPilEsigi: a.bildirimPilEsigi,
      bildirimGuncelleme: a.bildirimGuncelleme,
      bildirimMasaustu: a.bildirimMasaustu,
      uyariKurallari: a.uyariKurallari,
      yeniPencereMalzemesi: a.yeniPencereMalzemesi,
      temaZorla: a.temaZorla,
      vurguRengi: vurguRengi.value.trim(),
      surumDenetimi: a.surumDenetimi,
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
      // Grup "tema" (ayar-alanlari.js tablosu): sunucu her alanı yeniden doğrular, geçersiz değer mevcut olanı korur
      metinOlcegi: a.metinOlcegi,
      yuksekKarsitlik: a.yuksekKarsitlik,
      panelTemasi: a.panelTemasi,
      panelVurguRengi: panelVurguRengi.value.trim(),
      panelArkaPlani: panelArkaPlani.value.trim(),
      animasyonlar: a.animasyonlar,
      animasyonGecisleri: a.animasyonGecisleri,
      havaEfekti: a.havaEfekti,
      mevsimEfekti: a.mevsimEfekti,
      hareketiAzalt: a.hareketiAzalt,
    };
  }

  const KORUNACAK_ALANLAR = ['kisayol', 'paletKisayol', 'vurguRengi', 'anaPanoyaDonDk', 'pilEsigi', 'takvimGunSayisi', 'panelVurguRengi', 'panelArkaPlani', 'bildirimPilEsigi', 'uyariKurallari'];

  async function hepsiniKaydet() {
    if (kaydediliyor) return;
    kaydediliyor = true;
    btnAyarlariKaydet.disabled = true;
    btnAyarlariKaydet.textContent = t('ayar.kaydet.kaydediliyor');
    tumIsaretleriTemizle();
    try {
      // 0) Bildirim merkezi ayarları ve uyarı kuralları kayıttan önce denetlenir (sunucu geçersiz kuralı sessizce düşürür)
      const bildirimSorunlari = bildirimAyarlariniDenetle();
      if (bildirimSorunlari.length > 0) {
        bildirimGoster(bildirimSorunlari.indexOf('bildirimPilEsigi') >= 0 ? t('ayar.bm.pilEsigiHata') : t('ayar.kural.hata.ozet'), 'hata');
        if (bildirimSorunlari.indexOf('bildirimPilEsigi') >= 0) ilkHataliyaOdaklan(['bildirimPilEsigi']);
        else ilkHataliKuralaOdaklan();
        return;
      }
      const gonderilenKuralSayisi = kurallar.length;
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
      // Sunucu bazı kuralları düşürdüyse (geçersiz değer ya da güvenlik kuralı) yazılanlar silinmez, kullanıcıya söylenir.
      let dusenKural = 0;

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
        dusenKural = Math.max(0, gonderilenKuralSayisi - (Array.isArray(taze.uyariKurallari) ? taze.uyariKurallari.length : 0));
        if (dusenKural > 0 && korunacak.indexOf('uyariKurallari') < 0) korunacak.push('uyariKurallari');
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
      if (dusenKural > 0) {
        parcalar.push(cogul('ayar.kural.dustu', dusenKural));
        tur = 'uyari';
      }
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
        const eylemSayisi = (favoriSonuc.eylemHatalari || []).length;
        if (eylemSayisi > 0) {
          parcalar.push(cogul('ayar.kaydet.eylemRed', eylemSayisi));
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
      return new Date(zaman).toLocaleString(Dil ? Dil.yerelAdi(dil) : dil === 'en' ? 'en-US' : 'tr-TR');
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
  /** Sayfaya yazılan yakınlaştırma: Ctrl +/- adımı x Ayarlar > Görünüm > Metin boyutu çarpanı (o-25). */
  function yakinlastirmaYaz() {
    if (!yakinlastirmaDokunuldu) return;
    document.documentElement.style.zoom = String(Math.round(YAKINLASTIRMA_ADIMLARI[yakinlastirmaSirasi] * metinCarpani * 1000) / 1000);
  }

  function yakinlastirmaUygula() {
    yakinlastirmaDokunuldu = true;
    yakinlastirmaYaz();
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
        yakinlastirmaDokunuldu = true;
        yakinlastirmaYaz();
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
    temaOnizlemeGuncelle();
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
    kuralListesiniCiz();
    if (cihazlarYuklendi) cihazlariCiz();
    else if (listeIletisi) listeMesaji(listeIletisi.anahtar, listeIletisi.hata, listeIletisi.ham);
    if (sonYedekler !== null) yedekleriCiz(sonYedekler);
    if (duzen) duzen.metinleriYenile(); // sayfalar ve düzen geçmişi yeni dilde
    surumDurumunuYaz();
    yenilikleriYaz();
    tanilamaDurumunuYaz();
    odaListesiniCiz();
    odaDurumunuYaz();
    if (ayarAra.value.trim() !== '') ayarAramasiniUygula(); // sayfa metni değişti: aynı sorgu yeni dilde yeniden aranır
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

  // --- Bildirim merkezi ve uyarı kuralları (1.4.0; o-36, o-37, o-39) ---------------------------------------------------------
  // Kural satırları formda dizge olarak tutulur; kaydederken kuralYuku ile sunucunun beklediği biçime (aynı alan sırası) çevrilir:
  // kaydedilmemiş değişiklik denetimi iki tarafı JSON olarak karşılaştırır. Sunucu geçersiz kuralı sessizce düşürdüğü için kayıttan
  // önce burada denetlenir; yine de düşen olursa kayıttan sonra söylenir ve yazılanlar silinmez. Metinler yalnız textContent ile yazılır.
  const EN_COK_KURAL = 20;
  const KOSUL_TURLERI = ['gecis', 'durum', 'esik', 'ulasilamiyor', 'bilinmiyor'];
  const ESIK_YONLERI = ['ustunde', 'altinda'];
  const KOSUL_METINLERI = {
    gecis: 'ayar.kural.tur.gecis',
    durum: 'ayar.kural.tur.durum',
    esik: 'ayar.kural.tur.esik',
    ulasilamiyor: 'ayar.kural.tur.ulasilamiyor',
    bilinmiyor: 'ayar.kural.tur.bilinmiyor',
  };
  const YON_METINLERI = { ustunde: 'ayar.kural.yon.ustunde', altinda: 'ayar.kural.yon.altinda' };
  const VARLIK_DESENI = /^[a-z0-9_]+\.[a-z0-9_]+$/;
  const SAAT_DESENI = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const KURAL_SURE_AZAMI = 86400;
  const KURAL_ESIK_TAVANI = 1e9;
  const KURAL_METIN_SINIRI = 100;
  let kurallar = []; // formdaki kural satırları (dizge alanlı)
  let kuralOgeleri = []; // satır başına DOM parçaları: { ad, oneriler, girdiler, hata, tur, varlik }
  let kuralSayaci = 0;

  /** Sunucudaki kuraldan form satırı. */
  function kuralKur(s) {
    const k = s && typeof s === 'object' ? s : {};
    const kosul = k.kosul && typeof k.kosul === 'object' ? k.kosul : {};
    const sessiz = k.sessizSaatler && typeof k.sessizSaatler === 'object' ? k.sessizSaatler : null;
    const tur = KOSUL_TURLERI.indexOf(kosul.tur) >= 0 ? kosul.tur : 'durum';
    kuralSayaci += 1;
    return {
      anahtar: kuralSayaci,
      id: typeof k.id === 'string' ? k.id : '',
      acik: k.acik !== false,
      varlik: typeof k.varlik === 'string' ? k.varlik : '',
      ilkVarlik: typeof k.varlik === 'string' ? k.varlik : '',
      tur: tur,
      den: tur === 'gecis' && typeof kosul.den === 'string' ? kosul.den : '',
      ye: tur === 'gecis' && typeof kosul.ye === 'string' ? kosul.ye : '',
      deger: tur === 'durum' && typeof kosul.deger === 'string' ? kosul.deger : '',
      yon: ESIK_YONLERI.indexOf(kosul.yon) >= 0 ? kosul.yon : 'ustunde',
      esik: tur === 'esik' && typeof kosul.deger === 'number' ? String(kosul.deger) : '',
      metin: typeof k.metin === 'string' ? k.metin : '',
      sure: String(Number.isInteger(k.sure) ? k.sure : 0),
      bekleme: String(Number.isInteger(k.bekleme) ? k.bekleme : 300),
      sessizAcik: !!sessiz,
      basla: sessiz && typeof sessiz.baslangic === 'string' ? sessiz.baslangic : '22:00',
      bit: sessiz && typeof sessiz.bitis === 'string' ? sessiz.bitis : '07:00',
      windows: k.windows === true,
      hata: {}, // alan -> sözlük anahtarı (denetimden sonra satırda gösterilir)
    };
  }

  function sayiMetni(metin) {
    const s = String(metin).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function tamsayiMetni(metin) {
    const s = String(metin).trim();
    return /^\d{1,6}$/.test(s) ? Number(s) : null;
  }

  /** Form satırı -> sunucunun kural biçimi (alan sırası sunucudakiyle aynı); geçersiz sayı null olur. */
  function kuralYuku(k) {
    let kosul;
    if (k.tur === 'gecis') kosul = { tur: 'gecis', den: k.den.trim(), ye: k.ye.trim() };
    else if (k.tur === 'durum') kosul = { tur: 'durum', deger: k.deger.trim() };
    else if (k.tur === 'esik') kosul = { tur: 'esik', yon: k.yon, deger: sayiMetni(k.esik) };
    else kosul = { tur: k.tur };
    return {
      id: k.id,
      acik: k.acik,
      varlik: k.varlik.trim(),
      kosul: kosul,
      metin: k.metin.trim(),
      sure: tamsayiMetni(k.sure),
      bekleme: tamsayiMetni(k.bekleme),
      sessizSaatler: k.sessizAcik ? { baslangic: k.basla, bitis: k.bit } : null,
      windows: k.windows,
    };
  }

  function kurallariYuku() {
    return kurallar.map(kuralYuku);
  }

  /** Sunucu özetindeki kural listesinin karşılaştırma biçimi (form satırından geçirilir: iki taraf aynı normalleşir). */
  function kurallariSunucudan(sonuc) {
    return (Array.isArray(sonuc.uyariKurallari) ? sonuc.uyariKurallari : []).map(function (s) { return kuralYuku(kuralKur(s)); });
  }

  /** Cihaz listesi yüklüyse ve adı yazılan cihaz tek bir uygun cihazın adıysa kimliğine çevirir. */
  function kuralVarliginiCoz(deger) {
    const v = String(deger).trim();
    if (!cihazlarYuklendi || VARLIK_DESENI.test(v)) return v;
    const kucuk = v.toLowerCase();
    const adaylar = yuklenenCihazlar.filter(function (c) { return c.uyariUygun === true && String(c.ad || '').toLowerCase() === kucuk; });
    return adaylar.length === 1 ? adaylar[0].entity_id : v;
  }

  function kuralAdMetni(varlik) {
    const c = cihazHaritasi.get(varlik);
    if (c) return (c.uyariSimgesi ? c.uyariSimgesi + ' ' : '') + (c.ad || varlik);
    return adHaritasi.get(varlik) || '';
  }

  function kuralOnerileri(varlik) {
    const c = cihazHaritasi.get(varlik);
    return c && Array.isArray(c.durumOnerileri) ? c.durumOnerileri.filter(function (d) { return typeof d === 'string'; }).slice(0, 40) : [];
  }

  /** Bir satırı denetler: alan -> sözlük anahtarı. Boş nesne = geçerli. */
  function kuralDenetle(k) {
    const hata = {};
    const v = k.varlik.trim();
    if (!VARLIK_DESENI.test(v)) {
      hata.varlik = 'ayar.kural.hata.varlik';
    } else if (v !== k.ilkVarlik) {
      // Yeni seçilen cihaz listeden gelmeli (uygun alan, güvenlik süzgecinden geçmiş); kayıtlı kuralın değişmeyen cihazı olduğu gibi kalır.
      const c = cihazHaritasi.get(v);
      if (!cihazlarYuklendi || !c || c.uyariUygun !== true) hata.varlik = 'ayar.kural.hata.varlikBilinmiyor';
    }
    if (k.tur === 'durum' && k.deger.trim() === '') hata.deger = 'ayar.kural.hata.durum';
    if (k.tur === 'gecis' && k.den.trim() !== '' && k.den.trim() === k.ye.trim()) hata.ye = 'ayar.kural.hata.gecis';
    if (k.tur === 'esik') {
      const n = sayiMetni(k.esik);
      if (n === null || Math.abs(n) > KURAL_ESIK_TAVANI) hata.esik = 'ayar.kural.hata.esik';
    }
    if (Array.from(k.metin.trim()).length > KURAL_METIN_SINIRI) hata.metin = 'ayar.kural.hata.metin';
    const sure = tamsayiMetni(k.sure);
    if (sure === null || sure > KURAL_SURE_AZAMI) hata.sure = 'ayar.kural.hata.sure';
    const bekleme = tamsayiMetni(k.bekleme);
    if (bekleme === null || bekleme > KURAL_SURE_AZAMI) hata.bekleme = 'ayar.kural.hata.bekleme';
    if (k.sessizAcik && (!SAAT_DESENI.test(k.basla) || !SAAT_DESENI.test(k.bit) || k.basla === k.bit)) hata.sessiz = 'ayar.kural.hata.sessiz';
    return hata;
  }

  /** Tüm satırları denetler ve hataları satırlarda gösterir. true = hepsi geçerli. */
  function kurallariDenetle() {
    let tamam = true;
    kurallar.forEach(function (k, sira) {
      k.hata = kuralDenetle(k);
      if (Object.keys(k.hata).length > 0) tamam = false;
      if (kuralOgeleri[sira]) kuralHatalariniYaz(k, kuralOgeleri[sira]);
    });
    if (kurallar.length > EN_COK_KURAL) {
      kuralHatasiniYaz(t('ayar.kural.hata.fazla'));
      tamam = false;
    }
    return tamam;
  }

  function kuralHatasiniYaz(metin) {
    kuralHata.textContent = metin || '';
    kuralHata.style.display = metin ? 'block' : 'none';
  }

  function kuralHatalariniYaz(k, oge) {
    Object.keys(oge.girdiler).forEach(function (ad) {
      [].concat(oge.girdiler[ad]).forEach(function (girdi) { gecersizIsaretle(girdi, Object.hasOwn(k.hata, ad)); });
    });
    const mesajlar = Object.keys(k.hata).map(function (ad) { return t(k.hata[ad]); });
    oge.hata.textContent = mesajlar.join(' ');
    oge.hata.style.display = mesajlar.length > 0 ? 'block' : 'none';
  }

  /** İlk hatalı kural alanına odaklanır (bölüm açılır). */
  function ilkHataliKuralaOdaklan() {
    $('bolumBildirimler').open = true;
    for (let i = 0; i < kurallar.length; i += 1) {
      const alanlar = Object.keys(kurallar[i].hata);
      if (alanlar.length === 0 || !kuralOgeleri[i]) continue;
      const girdi = [].concat(kuralOgeleri[i].girdiler[alanlar[0]])[0];
      try {
        girdi.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        /* kaydırma desteklenmiyor */
      }
      odakla(girdi);
      return;
    }
  }

  /** Kural cihazı seçicisi: yüklü listedeki uygun cihazlar (kimlik değer, ad etiket). */
  function kuralVarliklariniDoldur() {
    kuralVarliklari.replaceChildren();
    yuklenenCihazlar
      .filter(function (c) { return c.uyariUygun === true; })
      .slice(0, 3000)
      .forEach(function (c) {
        const secenek = document.createElement('option');
        secenek.value = c.entity_id;
        secenek.textContent = c.ad || c.entity_id;
        kuralVarliklari.appendChild(secenek);
      });
  }

  /** Satırın cihaz adı satırını ve durum önerilerini (liste yüklenince / cihaz değişince) tazeler. */
  function kuralOgeleriniYenile(k, oge) {
    oge.ad.textContent = kuralAdMetni(k.varlik.trim());
    oge.oneriler.replaceChildren();
    kuralOnerileri(k.varlik.trim()).forEach(function (durum) {
      const secenek = document.createElement('option');
      secenek.value = durum;
      oge.oneriler.appendChild(secenek);
    });
  }

  /** Cihaz listesi yüklendi/değişti ya da satır sayısı değişti: ad satırları, öneriler, ipuçları ve düğmeler. */
  function kuralDurumunuGuncelle() {
    kuralVarliklariniDoldur();
    kurallar.forEach(function (k, i) {
      if (kuralOgeleri[i]) kuralOgeleriniYenile(k, kuralOgeleri[i]);
    });
    kuralBos.textContent = kurallar.length === 0 ? t('ayar.kural.bos') : '';
    kuralCihazIpucu.textContent = cihazlarYuklendi ? '' : t('ayar.kural.cihazlarYok');
    btnKuralEkle.disabled = !cihazlarYuklendi || kurallar.length >= EN_COK_KURAL;
    btnKuralCihazlar.style.display = cihazlarYuklendi ? 'none' : 'inline-flex';
  }

  function kuralGirdisi(tip, deger, etiket) {
    const g = document.createElement('input');
    g.type = tip;
    g.value = deger;
    g.setAttribute('aria-label', etiket);
    return g;
  }

  function kuralSecici(secenekler, deger, etiket) {
    const sec = document.createElement('select');
    secenekler.forEach(function (s) {
      const o = document.createElement('option');
      o.value = s[0];
      o.textContent = s[1];
      sec.appendChild(o);
    });
    sec.value = deger;
    sec.setAttribute('aria-label', etiket);
    return sec;
  }

  /** Etiketli alan kutusu (label for = girdi kimliği); kutuyu karta ekler. */
  function kuralAlaniEkle(kart, k, sonek, etiketMetni, girdi) {
    const kutu = el('div', 'kural-alan');
    const etiket = el('label', '', etiketMetni);
    const kimlik = 'kural' + k.anahtar + sonek;
    girdi.id = kimlik;
    etiket.setAttribute('for', kimlik);
    kutu.appendChild(etiket);
    kutu.appendChild(girdi);
    kart.appendChild(kutu);
    return kutu;
  }

  /** Girdiye hem input hem change dinleyicisi bağlar (kullanıcı yazarken ve seçerken). */
  function kuralBagla(girdi, isleyici) {
    girdi.addEventListener('input', isleyici);
    girdi.addEventListener('change', isleyici);
  }

  function kuralSatiriKur(k, sira) {
    const n = sira + 1;
    const oge = { girdiler: {}, ad: el('div', 'kural-ad'), oneriler: document.createElement('datalist'), hata: el('div', 'kural-hata') };
    oge.hata.style.display = 'none';
    oge.oneriler.id = 'kural' + k.anahtar + 'Durumlar';
    const kart = el('div', 'kural');
    kart.setAttribute('role', 'listitem');
    kart.setAttribute('aria-label', t('ayar.kural.grup', { n: n }));

    // üst satır: başlık, etkin kutusu, sil
    const ust = el('div', 'kural-ust');
    ust.appendChild(el('strong', '', t('ayar.kural.grup', { n: n })));
    const sag = el('div', 'kural-ust');
    const acikEtiket = el('label', 'checkbox-etiket');
    const acik = document.createElement('input');
    acik.type = 'checkbox';
    acik.checked = k.acik;
    acik.setAttribute('aria-label', t('ayar.kural.acik') + ': ' + t('ayar.kural.grup', { n: n }));
    kuralBagla(acik, function () {
      k.acik = acik.checked;
      kirliGuncelle();
    });
    acikEtiket.appendChild(acik);
    acikEtiket.appendChild(el('span', '', t('ayar.kural.acik')));
    const sil = el('button', 'buton buton-ikincil', t('ayar.kural.sil'));
    sil.type = 'button';
    sil.setAttribute('aria-label', t('ayar.kural.silEtiket', { n: n }));
    sil.addEventListener('click', function () {
      kurallar.splice(sira, 1);
      kuralListesiniCiz();
      odakla(btnKuralEkle);
      kirliGuncelle();
    });
    sag.appendChild(acikEtiket);
    sag.appendChild(sil);
    ust.appendChild(sag);
    kart.appendChild(ust);

    // cihaz
    const varlik = kuralGirdisi('text', k.varlik, t('ayar.kural.varlikEtiket', { n: n }));
    varlik.setAttribute('list', 'kuralVarliklari');
    varlik.setAttribute('autocomplete', 'off');
    varlik.placeholder = t('ayar.kural.varlikIpucu');
    varlik.maxLength = 80;
    varlik.spellcheck = false;
    oge.girdiler.varlik = varlik;
    oge.varlik = varlik;
    const varlikKutusu = kuralAlaniEkle(kart, k, 'Varlik', t('ayar.kural.varlik'), varlik);
    varlikKutusu.appendChild(oge.ad);
    kuralBagla(varlik, function () {
      k.varlik = varlik.value;
      delete k.hata.varlik;
      kuralOgeleriniYenile(k, oge);
      kuralHatalariniYaz(k, oge);
      kirliGuncelle();
    });
    varlik.addEventListener('change', function () {
      const cozulen = kuralVarliginiCoz(varlik.value);
      if (cozulen !== varlik.value.trim()) {
        varlik.value = cozulen;
        k.varlik = cozulen;
        kuralOgeleriniYenile(k, oge);
        kirliGuncelle();
      }
    });

    // koşul türü
    const tur = kuralSecici(KOSUL_TURLERI.map(function (x) { return [x, t(KOSUL_METINLERI[x])]; }), k.tur, t('ayar.kural.kosulEtiket', { n: n }));
    oge.tur = tur;
    kuralAlaniEkle(kart, k, 'Kosul', t('ayar.kural.kosul'), tur);
    tur.addEventListener('change', function () {
      k.tur = tur.value;
      k.hata = {};
      kuralListesiniCiz();
      odakla(kuralOgeleri[sira].tur);
      kirliGuncelle();
    });

    // koşul alanları
    const durumGirdisi = function (alan, sonek, etiketAnahtari, aramaAnahtari) {
      const g = kuralGirdisi('text', k[alan], t(aramaAnahtari, { n: n }));
      g.setAttribute('list', oge.oneriler.id);
      g.setAttribute('autocomplete', 'off');
      g.maxLength = 64;
      g.spellcheck = false;
      oge.girdiler[alan] = g;
      kuralAlaniEkle(kart, k, sonek, t(etiketAnahtari), g);
      kuralBagla(g, function () {
        k[alan] = g.value;
        delete k.hata[alan];
        kuralHatalariniYaz(k, oge);
        kirliGuncelle();
      });
    };
    if (k.tur === 'gecis') {
      durumGirdisi('den', 'Den', 'ayar.kural.den', 'ayar.kural.denEtiket');
      durumGirdisi('ye', 'Ye', 'ayar.kural.ye', 'ayar.kural.yeEtiket');
    } else if (k.tur === 'durum') {
      durumGirdisi('deger', 'Deger', 'ayar.kural.deger', 'ayar.kural.degerEtiket');
    } else if (k.tur === 'esik') {
      const yon = kuralSecici(ESIK_YONLERI.map(function (x) { return [x, t(YON_METINLERI[x])]; }), k.yon, t('ayar.kural.yonEtiket', { n: n }));
      kuralAlaniEkle(kart, k, 'Yon', t('ayar.kural.yon'), yon);
      kuralBagla(yon, function () {
        k.yon = yon.value;
        kirliGuncelle();
      });
      const esik = kuralGirdisi('text', k.esik, t('ayar.kural.esikEtiket', { n: n }));
      esik.setAttribute('inputmode', 'decimal');
      esik.maxLength = 16;
      oge.girdiler.esik = esik;
      kuralAlaniEkle(kart, k, 'Esik', t('ayar.kural.esik'), esik);
      kuralBagla(esik, function () {
        k.esik = esik.value;
        delete k.hata.esik;
        kuralHatalariniYaz(k, oge);
        kirliGuncelle();
      });
    }

    // cümle
    const metin = kuralGirdisi('text', k.metin, t('ayar.kural.metinEtiket', { n: n }));
    metin.maxLength = KURAL_METIN_SINIRI;
    oge.girdiler.metin = metin;
    const metinKutusu = kuralAlaniEkle(kart, k, 'Metin', t('ayar.kural.metin'), metin);
    metinKutusu.appendChild(el('div', 'ipucu', t('ayar.kural.metinIpucu')));
    kuralBagla(metin, function () {
      k.metin = metin.value;
      delete k.hata.metin;
      kuralHatalariniYaz(k, oge);
      kirliGuncelle();
    });

    // süre ve bekleme
    const sayilar = el('div', 'kural-ikili');
    [['sure', 'Sure', 'ayar.kural.sure', 'ayar.kural.sureEtiket', 'ayar.kural.sureIpucu'], ['bekleme', 'Bekleme', 'ayar.kural.bekleme', 'ayar.kural.beklemeEtiket', 'ayar.kural.beklemeIpucu']].forEach(function (a) {
      const g = kuralGirdisi('number', k[a[0]], t(a[3], { n: n }));
      g.min = '0';
      g.max = String(KURAL_SURE_AZAMI);
      g.step = '1';
      g.setAttribute('inputmode', 'numeric');
      oge.girdiler[a[0]] = g;
      const kutu = kuralAlaniEkle(sayilar, k, a[1], t(a[2]), g);
      kutu.appendChild(el('div', 'ipucu', t(a[4])));
      kuralBagla(g, function () {
        k[a[0]] = g.value;
        delete k.hata[a[0]];
        kuralHatalariniYaz(k, oge);
        kirliGuncelle();
      });
    });
    kart.appendChild(sayilar);

    // sessiz saatler
    const sessizKutusu = el('div', 'kural-alan');
    const sessizEtiket = el('label', 'checkbox-etiket');
    const sessiz = document.createElement('input');
    sessiz.type = 'checkbox';
    sessiz.checked = k.sessizAcik;
    sessiz.setAttribute('aria-label', t('ayar.kural.sessizEtiket', { n: n }));
    sessizEtiket.appendChild(sessiz);
    sessizEtiket.appendChild(el('span', '', t('ayar.kural.sessiz')));
    sessizKutusu.appendChild(sessizEtiket);
    const saatler = el('div', 'kural-ikili');
    const basla = kuralGirdisi('time', k.basla, t('ayar.kural.sessizBas', { n: n }));
    const bit = kuralGirdisi('time', k.bit, t('ayar.kural.sessizBit', { n: n }));
    oge.girdiler.sessiz = [basla, bit];
    saatler.appendChild(basla);
    saatler.appendChild(bit);
    saatler.style.display = k.sessizAcik ? 'grid' : 'none';
    sessizKutusu.appendChild(saatler);
    sessizKutusu.appendChild(el('div', 'ipucu', t('ayar.kural.sessizIpucu')));
    kart.appendChild(sessizKutusu);
    kuralBagla(sessiz, function () {
      k.sessizAcik = sessiz.checked;
      saatler.style.display = k.sessizAcik ? 'grid' : 'none';
      delete k.hata.sessiz;
      kuralHatalariniYaz(k, oge);
      kirliGuncelle();
    });
    [[basla, 'basla'], [bit, 'bit']].forEach(function (c) {
      kuralBagla(c[0], function () {
        k[c[1]] = c[0].value;
        delete k.hata.sessiz;
        kuralHatalariniYaz(k, oge);
        kirliGuncelle();
      });
    });

    // Windows bildirimi
    const windowsKutusu = el('div', 'kural-alan');
    const windowsEtiket = el('label', 'checkbox-etiket');
    const windows = document.createElement('input');
    windows.type = 'checkbox';
    windows.checked = k.windows;
    windows.setAttribute('aria-label', t('ayar.kural.windowsEtiket', { n: n }));
    windowsEtiket.appendChild(windows);
    windowsEtiket.appendChild(el('span', '', t('ayar.kural.windows')));
    windowsKutusu.appendChild(windowsEtiket);
    kart.appendChild(windowsKutusu);
    kuralBagla(windows, function () {
      k.windows = windows.checked;
      kirliGuncelle();
    });

    kart.appendChild(oge.hata);
    kart.appendChild(oge.oneriler);
    kuralOgeleri[sira] = oge;
    kuralOgeleriniYenile(k, oge);
    kuralHatalariniYaz(k, oge);
    return kart;
  }

  function kuralListesiniCiz() {
    kuralListesi.replaceChildren();
    kuralOgeleri = [];
    kurallar.forEach(function (k, sira) {
      kuralListesi.appendChild(kuralSatiriKur(k, sira));
    });
    kuralDurumunuGuncelle();
  }

  /** Bildirim merkezi ayarlarının kayıt öncesi denetimi: sorunlu alan adları (kayıt yapılmaz). */
  function bildirimAyarlariniDenetle() {
    const sorunlu = [];
    const esik = String(bildirimPilEsigi.value).trim();
    if (!/^\d{1,3}$/.test(esik) || Number(esik) < 5 || Number(esik) > 50) {
      alanIsaretle('bildirimPilEsigi', t('ayar.bm.pilEsigiHata'));
      sorunlu.push('bildirimPilEsigi');
    }
    if (!kurallariDenetle()) {
      kuralHatasiniYaz(t('ayar.kural.hata.ozet'));
      sorunlu.push('uyariKurallari');
    }
    return sorunlu;
  }

  // --- Olaylar -------------------------------------------------------------------------------------------------------------
  const kirliAlanlari = [
    yerelAdres, disAdres, canliBaglanti, otomatikBaslat, pencereBoyutu, odakKaybindaGizle, anaPanoyaDonDk,
    koseBildirimi, bipSesi, yeniPencereMalzemesi, temaZorla, tepsiSolTik, dilSecimi, surumDenetimi,
    metinOlcegi, yuksekKarsitlik, panelTemasi, animasyonlar, animasyonGecisleri, havaEfekti, mevsimEfekti, hareketiAzalt,
    bildirimKalici, bildirimPil, bildirimPilEsigi, bildirimGuncelleme, bildirimMasaustu,
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
  // Grup "tema": önizleme ve bu pencerenin kendi görünümü seçimle birlikte güncellenir (kirli gösterge yukarıda bağlıdır)
  [temaZorla, panelTemasi].forEach(function (girdi) {
    girdi.addEventListener('change', temaOnizlemeGuncelle);
  });
  yuksekKarsitlik.addEventListener('change', function () {
    ayarlarGorunumunuUygula();
    temaOnizlemeGuncelle();
  });
  metinOlcegi.addEventListener('change', ayarlarGorunumunuUygula);
  animasyonlar.addEventListener('change', animasyonAlanlariniGuncelle);
  [
    [panelVurguRengi, panelVurguSecici, btnPanelVurguSifirla],
    [panelArkaPlani, panelArkaSecici, btnPanelArkaSifirla],
  ].forEach(function (grup) {
    const metin = grup[0];
    const secici = grup[1];
    const sifirla = grup[2];
    metin.addEventListener('input', function () {
      temaOnizlemeGuncelle();
      kirliGuncelle();
    });
    secici.addEventListener('input', function () {
      metin.value = secici.value;
      temaOnizlemeGuncelle();
      kirliGuncelle();
    });
    sifirla.addEventListener('click', function () {
      metin.value = '';
      temaOnizlemeGuncelle();
      kirliGuncelle();
    });
  });

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

  bildirimPilEsigi.addEventListener('input', function () { alanTemizle('bildirimPilEsigi'); });

  btnKuralEkle.addEventListener('click', function () {
    if (kurallar.length >= EN_COK_KURAL || !cihazlarYuklendi) return;
    kurallar.push(kuralKur({}));
    kuralListesiniCiz();
    odakla(kuralOgeleri[kurallar.length - 1].varlik);
    kirliGuncelle();
  });

  btnKuralCihazlar.addEventListener('click', function () { cihazlariYukle(false); });

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

  // Ayarlarda arama (o-26): yazdıkça süzer; Esc önce aramayı temizler (pencereyi kapatmaz), Enter ilk eşleşmeye gider.
  ayarAra.addEventListener('input', ayarAramasiniUygula);
  ayarAra.addEventListener('keydown', function (olay) {
    if (olay.key === 'Escape' && ayarAra.value !== '') {
      olay.preventDefault();
      olay.stopPropagation();
      ayarAramasiniTemizle();
    } else if (olay.key === 'Enter') {
      olay.preventDefault();
      if (aramaSonucu && aramaSonucu.ilk && typeof aramaSonucu.ilk.scrollIntoView === 'function') aramaSonucu.ilk.scrollIntoView({ block: 'center' });
    }
  });
  btnAyarAraTemizle.addEventListener('click', function () {
    ayarAramasiniTemizle();
    odakla(ayarAra);
  });

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

  btnSurumDenetle.addEventListener('click', surumuDenetle);
  btnSurumSayfasi.addEventListener('click', surumSayfasiniAc);
  odaListesiniCiz(); // başlangıç durumu: oda yok, seçim kutusu kapalı, önizleme gizli
  btnOdalariGetir.addEventListener('click', odalariGetir);
  odaSec.addEventListener('change', odaOnizlemeyiCiz);
  btnOdaEkle.addEventListener('click', odayiSecimeEkle);
  btnTanilamaGoster.addEventListener('click', function () { tanilamaIste(false); });
  btnTanilamaKopyala.addEventListener('click', function () { tanilamaIste(true); });
  btnGunlukAc.addEventListener('click', gunlukKlasoruAc);
  if (typeof window.evPaneli.onBolumAc === 'function') {
    window.evPaneli.onBolumAc(function (yuk) { bolumuAc(yuk && yuk.bolum); });
  }

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
      } else if ((tus === 'f' || tus === 'F') && !olay.shiftKey) {
        olay.preventDefault(); // Ctrl+F: ayar araması (o-26)
        odakla(ayarAra);
        if (typeof ayarAra.select === 'function') ayarAra.select();
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
      surumBolumunuYukle();
    } catch (err) {
      bildirimGoster(t('ayar.yukleme.alinirkenHata'), 'hata');
    }
  }

  // Ana süreçten gelen dil asıl kaynaktır; ama son kullanılan dil önbellekte durur, böylece sayfa ilk boyamadan önce doğru dilde açılır.
  const onbellekDili = sonDiliOku();
  if (onbellekDili !== null && onbellekDili !== dil) dilKur(onbellekDili);
  sayfaYukle();
})();
