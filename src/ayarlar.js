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
      panolar: panoYuku(),
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
      bildirimKalici: sonuc.bildirimKalici !== false,
      bildirimPil: sonuc.bildirimPil !== false,
      bildirimPilEsigi: String(Number.isInteger(sonuc.bildirimPilEsigi) ? sonuc.bildirimPilEsigi : 20),
      bildirimGuncelleme: sonuc.bildirimGuncelleme === true,
      bildirimMasaustu: sonuc.bildirimMasaustu !== false,
      uyariKurallari: kurallariSunucudan(sonuc),
      yeniPencereMalzemesi: ['acrylic', 'mica', 'yok'].indexOf(sonuc.yeniPencereMalzemesi) >= 0 ? sonuc.yeniPencereMalzemesi : 'acrylic',
      temaZorla: sonuc.temaZorla === 'sistem' ? 'sistem' : 'koyu',
      vurguRengi: (typeof sonuc.vurguRengi === 'string' ? sonuc.vurguRengi : '').toLowerCase(),
      panolar: (Array.isArray(sonuc.panolar) ? sonuc.panolar : []).map(function (p) {
        return { ad: String(p.ad || '').trim(), yol: String(p.yol || '').trim(), kisayol: kisNorm(p.kisayol) };
      }),
    };
  }

  function favoriKirli() {
    if (seciliSira.length !== kayitliSira.length) return true;
    if (seciliSira.some(function (kimlik, i) { return kimlik !== kayitliSira[i]; })) return true;
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
    bildirimKalici.checked = d.bildirimKalici;
    bildirimPil.checked = d.bildirimPil;
    yaz('bildirimPilEsigi', bildirimPilEsigi, d.bildirimPilEsigi);
    bildirimGuncelleme.checked = d.bildirimGuncelleme;
    bildirimMasaustu.checked = d.bildirimMasaustu;
    if (!korunan.has('uyariKurallari')) {
      kurallar = (Array.isArray(sonuc.uyariKurallari) ? sonuc.uyariKurallari : []).map(function (k) { return kuralKur(k); });
      kuralListesiniCiz();
    }
    yeniPencereMalzemesi.value = d.yeniPencereMalzemesi;
    temaZorla.value = d.temaZorla;
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
    uyariKutusuDoldur(panoUyarilari, []);
    hazirListeDurumunuGoster(sonuc.hazirListeGuncel);
    otomatikBaslatDurumunuGoster(sonuc.otomatikBaslatDurumu);
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
    favoriler.forEach(function (f) {
      adHaritasi.set(f.entity_id, f.ad || f.entity_id);
      if (typeof f.onay === 'boolean') kayitliOnay.set(f.entity_id, f.onay);
      if (typeof f.kisayol === 'string' && f.kisayol) kayitliKisayol.set(f.entity_id, f.kisayol);
      if (f.parlaklik === true) kayitliParlaklik.set(f.entity_id, true);
      if (typeof f.etiket === 'string' && f.etiket) kayitliEtiket.set(f.entity_id, f.etiket);
    });
    kayitliSira = favoriler.map(function (f) { return f.entity_id; });
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
      satir.appendChild(el('span', 'sira-no', String(sira + 1) + '.'));
      satir.appendChild(el('span', 'sira-ad', gorunenAd(kimlik)));
      let konum;
      let tepside = false;
      if (onayliMi(kimlik)) {
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
      favoriSirasiListesi.appendChild(satir);
    });
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
    // Taşıma sonrası odak, taşınan satırın aynı yöndeki düğmesinde kalsın (klavyeyle art arda taşımak için).
    const dugmeler = siraDugmeleri.get(kimlik);
    if (dugmeler) odakla(yon < 0 && !dugmeler.yukari.disabled ? dugmeler.yukari : !dugmeler.asagi.disabled ? dugmeler.asagi : dugmeler.yukari);
  }

  /** Cihaz listesinin yerine bir ileti yazar. anahtar: sözlük anahtarı; ham: sunucudan gelen hazır metin (varsa anahtarın yerine geçer). */
  function listeMesaji(anahtar, hata, ham) {
    listeIletisi = { anahtar: anahtar, ham: ham, hata: hata === true };
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
        gosterilenCihazSayisi = CIHAZ_SAYFA_BOYUTU;
        guncelleSecilenSayisi();
        cihazlariCiz();
        siraCiz();
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
      guncelleSecilenSayisi();
      siraCiz();
      kirliGuncelle();
    });

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
          notMetni: cihaz.alan === 'script' || cihaz.alan === 'scene' ? t('ayar.cihaz.scriptSahneUyari') : '',
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
      return girdi;
    });
  }

  // Arka planda favori listesi değişti (hazır karoların yeniden denemesi, düğme): kaydedilmemiş düzenlemeler korunarak liste tazelenir (h-27).
  async function favorileriYenile() {
    const sonuc = await window.evPaneli.ayarlariGetir();
    if (!sonuc || !sonuc.ok) return false;
    mevcutAyarlar = sonuc;
    favoriUygula(sonuc, true);
    hazirListeDurumunuGoster(sonuc.hazirListeGuncel);
    if (cihazlarYuklendi) await cihazlariYukle(true);
    else cihazlariCiz();
    kurulumGuncelle();
    kirliGuncelle();
    return true;
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
      tepsiSolTik: a.tepsiSolTik,
      paletKisayol: a.paletKisayol,
      canliBaglanti: a.canliBaglanti,
      panolar: a.panolar,
    };
  }

  const KORUNACAK_ALANLAR = ['kisayol', 'paletKisayol', 'vurguRengi', 'anaPanoyaDonDk', 'bildirimPilEsigi', 'uyariKurallari'];

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
    kuralListesiniCiz();
    if (cihazlarYuklendi) cihazlariCiz();
    else if (listeIletisi) listeMesaji(listeIletisi.anahtar, listeIletisi.hata, listeIletisi.ham);
    if (sonYedekler !== null) yedekleriCiz(sonYedekler);
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
    koseBildirimi, bipSesi, yeniPencereMalzemesi, temaZorla, tepsiSolTik, dilSecimi,
    bildirimKalici, bildirimPil, bildirimPilEsigi, bildirimGuncelleme, bildirimMasaustu,
  ];
  kirliAlanlari.forEach(function (girdi) {
    girdi.addEventListener('input', kirliGuncelle);
    girdi.addEventListener('change', kirliGuncelle);
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
    } catch (err) {
      bildirimGoster(t('ayar.yukleme.alinirkenHata'), 'hata');
    }
  }

  // Ana süreçten gelen dil asıl kaynaktır; ama son kullanılan dil önbellekte durur, böylece sayfa ilk boyamadan önce doğru dilde açılır.
  const onbellekDili = sonDiliOku();
  if (onbellekDili !== null && onbellekDili !== dil) dilKur(onbellekDili);
  sayfaYukle();
})();
