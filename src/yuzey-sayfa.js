/*
 * Hızlı panel ve komut paletinin betiği (renderer). Köprü: preload-yuzey.js (window.evYuzey). Ana süreç (src/yuzey-yoneticisi.js)
 * güvenli karo modelini gönderir; bu sayfa yalnız onu çizer ve kullanıcının tıklama/tuşlarını ana sürece iletir.
 *
 *  - Tüm metin textContent ile yazılır (HTML olarak yorumlanan atama yok); dinamik stil yok.
 *  - Karolar ana süreçte süzülür: kapı/kilit/alarm bu sayfaya hiç gelmez. Bu sayfa bir eylemi ASLA kendi başına "onaylı"
 *    sayamaz: yıkıcı eylemde yalnız ana sürece "basılı tutma başladı" der; onayı ana sürecin kendi saati verir.
 *  - Arama: lib/arama.js (Türkçe harf katlama, "ışık 40"); kaydırıcı/tekrar/basılı tutma: lib/kaydirici.js.
 *  - Klavye: panelde ok tuşlarıyla ızgara gezintisi; yeniden çizimde odak korunur (h-07, k-09). Palet: combobox/listbox (k-16).
 *  - Yazı boyutu (Ctrl + / Ctrl − / Ctrl 0) ana süreçte yakalanır (yuzey-yoneticisi.js); bu sayfa yalnız yeniden ölçer.
 *  - Arayüz dili: lib/dil.js + lib/ceviri/yuzey.js. HTML'deki Türkçe metin varsayılandır; durumAl yanıtındaki `dil` ve `onDilDegisti`
 *    ile sayfa çevrilir (data-i18n) ve dinamik metinler t() ile yeniden çizilir. Karo adları, grup başlıkları, durum/hata satırları
 *    ana süreçte zaten seçili dilde yazılır; sayfa onları çevirmez.
 */
(function () {
  'use strict';

  const kopru = window.evYuzey;
  const Arama = window.EvArama;
  const Kaydirici = window.EvKaydirici;
  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  const Kartlar = window.EvKartlar; // 1.4.0 cihaz kartları (yuzey-kartlar.js); yoksa kartlar düz karo olarak çizilir
  if (!kopru || !Arama || !Kaydirici || !Dil || !Sozluk) return;
  // 1.4.0 bilgi bölümleri (src/yuzey-bilgi.js; biçimleyici lib/bilgi-bicim.js, grafikler lib/grafik.js). Üçü de yoksa panel yalnız karoları çizer.
  const BilgiModulu = window.EvYuzeyBilgi;
  const BilgiBicim = window.EvBilgiBicim;
  const Grafik = window.EvGrafik;
  const KaroGorunum = window.EvKaroGorunum || null; // 1.4.0 düzen (o-31): simge / renk / boyut doğrulaması
  const DuzenModulu = window.EvYuzeyDuzen || null; // 1.4.0 düzen (o-16, o-24): sayfa sekmeleri, ayrıntı bölmesi, sağ tık; yoksa panel eskisi gibi çalışır
  const KameraModulu = window.EvYuzeyKamera || null; // 1.4.0 cihaz (o-48): kamera anlık görüntüsü bölümü (src/yuzey-kamera.js); yoksa panel kamerasız çalışır
  const EylemModulu = window.EvYuzeyEylem || null; // 1.4.0 eylem grubu (o-12 geri al düğmesi...): src/yuzey-eylem.js; yoksa panel eskisi gibi çalışır

  let t = Dil.cevirmen('tr', Sozluk); // HTML varsayılanı Türkçedir; dil durumAl yanıtıyla ya da onDilDegisti ile gelir

  const el = {
    kok: document.getElementById('kok'),
    baglanti: document.getElementById('baglanti'),
    medya: document.getElementById('medya'),
    eski: document.getElementById('eski'),
    sabitle: document.getElementById('sabitle'),
    serit: document.getElementById('serit'),
    sekmeler: document.getElementById('sekmeler'),
    bildirim: document.getElementById('bildirim'),
    bildirimDugme: document.getElementById('bildirimDugme'),
    bildirimSayi: document.getElementById('bildirimSayi'),
    bildirimOzet: document.getElementById('bildirimOzet'),
    bildirimListe: document.getElementById('bildirimListe'),
    bildirimGizli: document.getElementById('bildirimGizli'),
    arama: document.getElementById('arama'),
    icerik: document.getElementById('icerik'),
    ipucu: document.getElementById('ipucu'),
    haAc: document.getElementById('haAc'),
    ayarlarAc: document.getElementById('ayarlarAc'),
    geriAl: document.getElementById('geriAl'),
    gecikmeli: document.getElementById('gecikmeliSerit'), // 1.4.0 (o-15): bekleyen zamanlı eylemler şeridi
  };

  const SEVIYELER = [10, 20, 50, 100]; // palet: Shift+Enter ışık seviyeleri
  // palet "*" (o-46): favori olmayan güvenli cihazlar; alan adları ana süreçteki ALANLAR ile aynıdır (src/lib/diger-cihazlar.js)
  const DIGER_ALAN_ANAHTARLARI = {
    light: 'yuzey.diger.alan.light',
    switch: 'yuzey.diger.alan.switch',
    fan: 'yuzey.diger.alan.fan',
    input_boolean: 'yuzey.diger.alan.input_boolean',
    humidifier: 'yuzey.diger.alan.humidifier',
    scene: 'yuzey.diger.alan.scene',
  };
  const DIGER_DURUMLARI = ['acik', 'kapali', 'notr'];
  const DIGER_YENIDEN_DENEME_MS = 5000; // liste alınamadıysa sonraki yazışta en erken bu kadar sonra yeniden denenir
  const PANEL_HAZIR = [10, 20, 50, 100]; // panel: ışık karosundaki hazır seviyeler (hiz-09)
  const PANEL_HAZIR_SIK = 20; // en sık kullanılan seviye (~%18 ortanca parlaklık): yalnız silik işaret alır; vurgu ışığın GERÇEK seviyesinindir (g-02)
  const IZGARA_KOLON = 3; // yuzey.css .izgara sütun sayısı (ok tuşu gezintisi mantıksal satırları buna göre keser)
  const PALET_SATIR_SINIRI = 30;
  const PALET_SON_SAYISI = 5; // hiz-08: boş aramada son 5 eylem
  const PANEL_SON_SAYISI = 5;
  const MEDYA_SATIRLARI = ['cikis', 'ses', 'oynat']; // hiz-12: ses çıkışı | ses -/+/sessiz | oynat/duraklat/sonraki
  const IPUCU_MS = 2500;
  const HATA_ISARETI_MS = 3000;
  const BASARI_ISARETI_MS = 1000; // g-08
  const KARO_KILIT_MS = 400; // h-06: aynı karoya ikinci tıklama (çift tık) bu sürede ve yanıt gelene kadar yok sayılır
  const KILIT_YEDEK_MS = 5000; // yanıt hiç gelmezse kilit en çok bu kadar tutulur
  const BAGLANTI_ANAHTARI = {
    canli: 'yuzey.baglanti.canli',
    baglaniyor: 'yuzey.baglanti.baglaniyor',
    yedek: 'yuzey.baglanti.yedek',
    kapali: 'yuzey.baglanti.kapali',
  };
  const OK_TUSLARI = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  // 2.0 karo simgesi (madeni): Ayarlar'da simge seçilmemişse alan adına göre çizgi ikon (lib/karo-gorunum.js IKONLAR; yoksa aşağıdakiler)
  const ALAN_IKONU = {
    light: 'isik',
    switch: 'priz',
    input_boolean: 'priz',
    fan: 'vantilator',
    scene: 'yildiz',
    script: 'sahne',
    media_player: 'muzik',
    climate: 'termometre',
    water_heater: 'termometre',
    cover: 'perde',
    humidifier: 'damla',
    vacuum: 'supurge',
    button: 'guc',
  };
  const EK_IKONLAR = {
    termometre: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v6',
    perde: 'M4 4h16M5 4v12M19 4v12M5 8h14M5 12h14M5 16h14M12 16v4',
    damla: 'M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z',
    supurge: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    nokta: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  };
  // 2.0 hareket (yalnız hareket açıkken; WAAPI): CSS'teki --yay-yumusak ile aynı eğri
  const YAY_YUMUSAK = 'linear(0, 0.09, 0.28, 0.48, 0.66, 0.8, 0.89, 0.95, 0.99, 1.007, 1.014, 1.015, 1.01, 1.005, 1)';
  const RULO_SECICI = '.karo-durum, .kart-deger, .kart-durum, .sensor-deger, .serit-deger, .saat-deger, .hava-sicaklik, .bilgi-deger, .istatistik-deger';
  const RULO_MS = 300;

  let mod = 'panel';
  let model = { gruplar: [], sonlar: [], bilgi: null, kamera: null, sayfalar: [], eylem: null, ust: { canli: false, baglanti: 'kapali', medyaCaliyor: null, aktifCikis: null, hata: null, uyari: null, anahtarYok: false }, bildirim: null };
  let sorgu = '';
  let secili = 0;
  let seviyeAcik = false;
  let seviyeSecili = 0; // palet: seviye seçicisinin ya da "*" cihaz menüsünün seçili öğesi
  let digerListe = { durum: 'bos', liste: [], tur: null, zaman: 0 }; // palet "*": durum 'bos' | 'yukleniyor' | 'hazir' | 'hata'; her gösterimde sıfırlanır
  let digerBekliyor = false; // "*" satırı eylemi yanıt beklerken ikinci istek gönderilmez
  let donuk = 0; // sürüklenen kaydırıcı, basılı tutulan karo ya da basılı fare: bu sürece yeniden çizim ertelenir
  // 1.4.0 etkileşim (o-20, o-23): ana süreç ayarını gönderir (yuzey:goster / yuzey:durum-al `etkilesim`). tekerlek: fare tekerleği ışık/ses değiştirsin mi;
  // sabit: panel sabitli mi (dışarı tıklayınca kapanmaz). Geçersiz/eksik yük varsayılana düşer.
  let etkilesim = { tekerlek: true, sabit: false };
  const tekerlek = Kaydirici.tekerlekKapisi(); // kaydırma ile karo tekerleği çakışmasın (lib/kaydirici.js)
  let bekleyenModel = null;
  let modelImzasi = ''; // çizilen modelin JSON'u: değişmeyen model DOM'u yeniden kurmaz (basış/odak kaybolmasın)
  let imlecBasili = false; // herhangi bir fare/dokunma basışı sürüyor (bırakılana kadar yeniden çizim ertelenir)
  let ipucuZamanlayicisi = null;
  let sonBildirilenYukseklik = 0;
  let paletSatirlari = [];
  let seciliSatirKutusu = null; // palet: seçili satırın öğesi (Enter'a basılı tutma dolum çubuğu burada görünür)
  let seritImzasi = ''; // hata/uyarı şeridinin içeriği: değişmeyen şerit yeniden kurulmaz (ekran okuyucu tekrar okumasın)
  let bildirimAcik = false; // bildirim şeridinin listesi açık mı; pencere her gösterildiğinde kapalı başlar
  let bildirimImzasi = ''; // çizilen bildirim şeridinin içeriği: değişmeyen şerit yeniden kurulmaz (odak ve ekran okuyucu bozulmasın)
  let bildirimDugmeleri = []; // açık listedeki "kapat" düğmeleri (kapatılınca odak sıradaki düğmeye geçer)
  const bildirimBekleyenler = new Set(); // kapatma isteği yanıt bekleyen öğe anahtarları (çift tıklama iki istek göndermesin)
  let gosterimNo = 0; // pencere her gösterildiğinde artar: eski gösterime ait geç yanıt yeni gösterimi kapatmasın
  let odakHaritasi = new Map(); // panel: odak anahtarı -> öğe (yeniden çizimde odak geri verilir)
  let panelSatirlari = []; // panel: ok tuşu gezintisi için mantıksal satırlar [[öğe, ...], ...] (görsel sırayla)
  const karoKilitleri = new Map(); // kimlik -> { basla, bitis, bekliyor } (h-06)
  const etkinTutmalar = new Set(); // { birak() }
  let tekrarlayicilar = []; // bu çizimdeki ses -/+ tekrarlayıcıları (pencere odağını kaybedince durdurulur)
  let dilCizimiBekliyor = false; // dil, sürükleme / basılı tutma sürerken değişti: bitince yeniden çizilir
  let bilgiCizimiBekliyor = false; // bilgi bölümü (okuma yanıtı, düğme) çizim istedi ama sürükleme / basılı tutma sürüyordu
  let odakIstegi = null; // sonraki panel çiziminde odağın verileceği anahtar (ör. geçmiş görünümüne girince "Geri")

  function olustur(etiket, sinif, metin) {
    const oge = document.createElement(etiket);
    if (sinif) oge.className = sinif;
    if (metin !== undefined && metin !== null) oge.textContent = String(metin);
    return oge;
  }

  /** CSS değişkeni yazar (CSSOM; satır içi stil bildirimi değil). Ortam desteklemiyorsa sessizce geçer. */
  function stilYaz(oge, ad, deger) {
    if (oge && oge.style && typeof oge.style.setProperty === 'function') oge.style.setProperty(ad, deger);
  }

  /** 2.0 hareketleri yalnız "hareketi azalt" kapalıyken (ayar ya da sistem: <html data-hareket>) oynar. */
  function hareketAcik() {
    const kok = document.documentElement;
    if (!kok || typeof kok.hasAttribute !== 'function' || kok.hasAttribute('data-hareket')) return false;
    return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 24'lük ızgarada tek yollu çizgi ikon (createElementNS; HTML ataması yok). */
  function cizgiIkon(yol) {
    if (typeof document.createElementNS !== 'function' || !yol) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['focusable', 'false'], ['aria-hidden', 'true']].forEach(function (o) {
      svg.setAttribute(o[0], o[1]);
    });
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', yol);
    svg.appendChild(p);
    return svg;
  }

  /** Simgesi seçilmemiş karonun varsayılan ikonu: medya / PC / yıkıcı önce, sonra alan adı. */
  function varsayilanIkonYolu(karo) {
    let ad;
    if (karo.yikici) ad = 'guc';
    else if (karo.grup === 'medya') ad = karo.altGrup === 'cikis' ? 'kulaklik' : karo.altGrup === 'ses' ? 'hoparlor' : 'muzik';
    else if (karo.grup === 'pc') ad = 'ekran';
    else ad = ALAN_IKONU[karo.alan];
    const ikonlar = KaroGorunum && KaroGorunum.IKONLAR ? KaroGorunum.IKONLAR : {};
    return (ad && ikonlar[ad]) || EK_IKONLAR[ad] || EK_IKONLAR.nokta;
  }

  function sinirliMetin(deger, sinir) {
    return String(deger === undefined || deger === null ? '' : deger).slice(0, sinir || 80);
  }

  function ilkHarfBuyuk(metin) {
    const harfler = Array.from(String(metin));
    if (harfler.length === 0) return '';
    // Türkçede i -> İ, ı -> I; diğer dillerde i -> I olmalı (yoksa "invalid" "İnvalid" olurdu)
    return harfler[0].toLocaleUpperCase(Dil.yerelAdi(t.dil)) + harfler.slice(1).join('');
  }

  // ---------------------------------------------------------------- model

  const BILDIRIM_KAYNAKLARI = ['uyari', 'ha', 'pil', 'guncelleme'];

  /** Bildirim şeridi modeli: { ogeler: [{anahtar, kaynak, baslik, metin, zaman, simge}], sayi, gizlenen } ya da null. Metinler ana süreçte süzülmüştür. */
  function bildirimDuzelt(ham) {
    if (!ham || typeof ham !== 'object' || !Array.isArray(ham.ogeler)) return null;
    const ogeler = ham.ogeler
      .slice(0, 30)
      .map(function (o) {
        if (!o || typeof o.anahtar !== 'string' || o.anahtar === '') return null;
        return {
          anahtar: sinirliMetin(o.anahtar, 40),
          kaynak: BILDIRIM_KAYNAKLARI.indexOf(o.kaynak) >= 0 ? o.kaynak : 'ha',
          baslik: sinirliMetin(o.baslik, 80),
          metin: sinirliMetin(o.metin, 200),
          zaman: typeof o.zaman === 'number' && isFinite(o.zaman) && o.zaman > 0 ? o.zaman : 0,
          simge: sinirliMetin(o.simge, 8),
        };
      })
      .filter(Boolean);
    return {
      ogeler: ogeler,
      sayi: typeof ham.sayi === 'number' && isFinite(ham.sayi) && ham.sayi >= ogeler.length ? Math.min(Math.floor(ham.sayi), 9999) : ogeler.length,
      gizlenen: typeof ham.gizlenen === 'number' && isFinite(ham.gizlenen) && ham.gizlenen > 0 ? Math.min(Math.floor(ham.gizlenen), 999) : 0,
    };
  }

  let karoDuzeltici = null; // son modelDuzelt'in karo doğrulayıcısı: medya üst kartı (bilgi modülü) tam karoyu bununla doğrular

  function modelDuzelt(ham) {
    if (!ham || typeof ham !== 'object' || !Array.isArray(ham.gruplar)) return null;
    const karoDuzelt = function (k) {
      if (!k || typeof k.id !== 'string') return null;
      return {
        id: k.id,
        etiket: sinirliMetin(k.etiket, 60),
        grup: sinirliMetin(k.grup, 20),
        grupEtiketi: sinirliMetin(k.grupEtiketi, 20),
        altGrup: k.altGrup === null || k.altGrup === undefined ? null : sinirliMetin(k.altGrup, 12),
        alan: sinirliMetin(k.alan, 20),
        durum: ['acik', 'kapali', 'yok', 'notr'].indexOf(k.durum) >= 0 ? k.durum : 'yok',
        yuzde: typeof k.yuzde === 'number' ? k.yuzde : null,
        kullanilabilir: k.kullanilabilir === true,
        ulasilamiyor: k.ulasilamiyor === true,
        yikici: k.sinif === 'yikici',
        parlaklikKontrol: k.parlaklikKontrol === true,
        tekrar: k.tekrar === true,
        ozellik: Kartlar ? Kartlar.ozellikDuzelt(k.ozellik) : null, // 1.4.0: güvenli öznitelik alt kümesi (bilinmeyen anahtar atılır)
        varsayilanEylem: k.varsayilanEylem !== false, // false: tek tıklama eylemi yok (iklim, medya...): düz tıklama servis göndermez
        onayliServisler: Kartlar ? Kartlar.servisListesiDuzelt(k.onayliServisler) : [],
        // 1.4.0 düzen (o-31): görünüm alanları ana süreçte doğrulanmıştır; renderer yine de aynı tabloyla doğrular (yoksa varsayılan)
        simge: KaroGorunum ? KaroGorunum.simgeDuzelt(k.simge) || null : null,
        renk: KaroGorunum ? KaroGorunum.renkDuzelt(k.renk) || null : null,
        boyut: KaroGorunum ? KaroGorunum.boyutDuzelt(k.boyut) || 'normal' : 'normal',
      };
    };
    karoDuzeltici = karoDuzelt;
    const gruplar = ham.gruplar
      .map(function (g) {
        const grup = { kod: sinirliMetin(g && g.kod, 20), etiket: sinirliMetin(g && g.etiket, 30), karolar: Array.isArray(g && g.karolar) ? g.karolar.map(karoDuzelt).filter(Boolean) : [] };
        if (g && g.oda === true && /^oda-[0-9a-f]{8}$/.test(grup.kod)) grup.oda = true; // 1.4.0 (o-14): oda grubu; başlığında "Odayı kapat"
        return grup;
      })
      .filter(function (g) {
        return g.karolar.length > 0;
      });
    const sonlar = (Array.isArray(ham.sonlar) ? ham.sonlar : []).map(karoDuzelt).filter(Boolean);
    const u = ham.ust && typeof ham.ust === 'object' ? ham.ust : {};
    return {
      gruplar: gruplar,
      sonlar: sonlar,
      bilgi: BilgiModulu ? BilgiModulu.modelDuzelt(ham.bilgi, karoDuzelt) : null, // medya üst kartı tam karo ister (cihaz kartı alanları)
      kamera: KameraModulu ? KameraModulu.modelDuzelt(ham.kamera) : null,
      sayfalar: DuzenModulu ? DuzenModulu.sayfalariDuzelt(ham.sayfalar) : [],
      eylem: EylemModulu ? EylemModulu.modelDuzelt(ham.eylem) : null,
      bildirim: bildirimDuzelt(ham.bildirim),
      ust: {
        canli: u.canli === true,
        baglanti: Object.prototype.hasOwnProperty.call(BAGLANTI_ANAHTARI, u.baglanti) ? u.baglanti : 'kapali',
        medyaCaliyor: u.medyaCaliyor === true ? true : u.medyaCaliyor === false ? false : null,
        aktifCikis: u.aktifCikis === 'hoparlor' || u.aktifCikis === 'kulaklik' ? u.aktifCikis : null,
        hata: u.hata ? sinirliMetin(u.hata, 100) : null,
        uyari: u.uyari ? sinirliMetin(u.uyari, 100) : null,
        anahtarYok: u.anahtarYok === true,
      },
    };
  }

  function tumKarolar() {
    const sonuc = [];
    model.gruplar.forEach(function (g) {
      g.karolar.forEach(function (k) {
        sonuc.push(k);
      });
    });
    return sonuc;
  }

  function durumMetni(karo) {
    if (karo.ulasilamiyor) return t('yuzey.durum.ulasilamiyor');
    if (karo.varsayilanEylem === false && kartlar) {
      const ozet = kartlar.ozet(karo); // iklim "Isıtma · 22°", medya başlığı, seçici değeri, zamanlayıcı kalanı...
      if (ozet !== '') return ozet;
    }
    if (karo.durum === 'acik') return karo.yuzde !== null ? t('yuzey.yuzde', { n: karo.yuzde }) : t('yuzey.durum.acik');
    if (karo.durum === 'kapali') return t('yuzey.durum.kapali');
    return '';
  }

  // ---------------------------------------------------------------- ortak eylemler

  function ipucuGoster(metin) {
    el.ipucu.textContent = metin || '';
    clearTimeout(ipucuZamanlayicisi);
    if (metin) {
      ipucuZamanlayicisi = setTimeout(function () {
        el.ipucu.textContent = '';
      }, IPUCU_MS);
    }
  }

  /** Hata: karoda kısa süreli kırmızı çerçeve (gorunum-12); yeniden çizim öğeyi zaten yeniler. */
  function hataIsaretle(oge) {
    if (!oge || !oge.classList) return;
    oge.classList.add('hata');
    setTimeout(function () {
      oge.classList.remove('hata');
    }, HATA_ISARETI_MS);
  }

  /**
   * Başarı: karoda 1 sn yeşil çerçeve (g-08). 1.4.1: HA'nın durum yankısı paneli baştan çizer ve eski düğme gider; bu yüzden
   * karonun işaret bitiş zamanı tutulur, yeniden çizilen karo işareti süresi dolana kadar taşır (basariyiSurdur).
   */
  const basariSonu = new Map(); // karo kimliği -> işaretin bitiş zamanı (ms)

  function basariIsaretle(oge, karo) {
    if (!oge || !oge.classList) return;
    oge.classList.add('basari');
    if (karo && karo.id !== undefined && oge.classList.contains('karo')) {
      const simdi = Date.now();
      basariSonu.forEach(function (bitis, kimlik) {
        if (bitis <= simdi) basariSonu.delete(kimlik);
      });
      basariSonu.set(karo.id, simdi + BASARI_ISARETI_MS);
    }
    setTimeout(function () {
      oge.classList.remove('basari');
    }, BASARI_ISARETI_MS);
  }

  /** Yeniden çizilen karoda süren başarı işaretini korur; işaret ikinci kez belirmez (CSS .basari-surer). */
  function basariyiSurdur(karo, dugme) {
    const bitis = basariSonu.get(karo.id);
    if (bitis === undefined) return;
    const kalan = bitis - Date.now();
    if (kalan <= 0) {
      basariSonu.delete(karo.id);
      return;
    }
    dugme.classList.add('basari');
    dugme.classList.add('basari-surer');
    setTimeout(function () {
      dugme.classList.remove('basari');
      dugme.classList.remove('basari-surer');
    }, kalan);
  }

  /** Kaydırıcının ara değerleri ve basılı tutulan ses -/+ her seferinde "başarı" yanıp sönmesin. */
  function basariGosterilmeli(karo, yuk) {
    if (!karo || karo.tekrar) return false;
    if (yuk && yuk.araDeger === true) return false; // 1.4.0: kaydırıcı / ± ara değerleri (ses, sıcaklık, sayı)
    return !(yuk && yuk.parlaklik !== undefined && yuk.sonDeger !== true);
  }

  /** 2.0: yanıttan önce HA'nın durum yankısı karoyu yeniden çizdiyse başarı / hata işareti ekrandaki yeni karoya konur. */
  function ekrandakiOge(karo, oge) {
    if (!karo || !oge || !oge.classList || !oge.classList.contains('karo')) return oge;
    const guncel = odakHaritasi.get('k:' + karo.id);
    return guncel && guncel.classList && guncel.classList.contains('karo') ? guncel : oge;
  }

  function sonucIsle(sonuc, karo, ilkOge, yuk) {
    const oge = ekrandakiOge(karo, ilkOge);
    if (sonuc && sonuc.ok === true) {
      if (basariGosterilmeli(karo, yuk)) basariIsaretle(oge, karo);
      return;
    }
    if (!sonuc || sonuc.ok !== false) return;
    const etiket = karo ? karo.etiket : t('yuzey.eylem');
    if (sonuc.tur === 'onay-gerekli') {
      ipucuGoster(t(mod === 'palet' ? 'yuzey.ipucu.onayPalet' : 'yuzey.ipucu.onayPanel', { etiket: etiket }));
    } else if (sonuc.tur === 'cok-sik') {
      ipucuGoster(t('yuzey.ipucu.cokSik'));
    } else {
      // ayrıntı (neden) köşe bildirimiyle ana süreçten gelir; burada kısa metin ve kırmızı çerçeve
      hataIsaretle(oge);
      ipucuGoster(t('yuzey.ipucu.calistirilamadi', { etiket: etiket }));
    }
  }

  /**
   * 2.0 bekleme: karoya basıldı, yanıt gelene kadar simgenin çevresinde yay döner. Kimliğe bağlıdır: HA'nın durum yankısı karoyu
   * yeniden çizse de yeni düğme bekleme işaretini taşır (karoDugmesi). Kaydırıcı / ses tekrarı / kart düğmeleri bekleme göstermez.
   */
  const bekleyenKarolar = new Map(); // kimlik -> yanıt bekleyen istek sayısı

  function beklemeBasla(karo, oge) {
    if (!karo || karo.tekrar || !oge || !oge.classList || !oge.classList.contains('karo')) return null;
    bekleyenKarolar.set(karo.id, (bekleyenKarolar.get(karo.id) || 0) + 1);
    oge.classList.add('bekliyor');
    return function () {
      const kalan = (bekleyenKarolar.get(karo.id) || 1) - 1;
      if (kalan > 0) {
        bekleyenKarolar.set(karo.id, kalan);
        return;
      }
      bekleyenKarolar.delete(karo.id);
      oge.classList.remove('bekliyor');
      const guncel = odakHaritasi.get('k:' + karo.id);
      if (guncel && guncel !== oge && guncel.classList) guncel.classList.remove('bekliyor');
    };
  }

  function calistir(yuk, karo, oge) {
    const beklemeBitti = beklemeBasla(karo, oge);
    return kopru.calistir(yuk).then(
      function (sonuc) {
        if (beklemeBitti) beklemeBitti();
        sonucIsle(sonuc, karo, oge, yuk);
        return sonuc;
      },
      function () {
        if (beklemeBitti) beklemeBitti();
        hataIsaretle(ekrandakiOge(karo, oge));
        ipucuGoster(t('yuzey.ipucu.gonderilemedi'));
        return { ok: false, tur: 'gonderilemedi' };
      },
    );
  }

  /**
   * Zararsız karoya TEK istek (h-06): aynı karo için yanıt gelmemişse ya da son istekten bu yana 400 ms geçmemişse ikinci
   * tıklama (çift tık) yok sayılır; aksi halde çift tık ışığı açıp hemen kapatırdı. Yok sayılırsa null döner.
   * Kilit çizimden bağımsızdır (karo öğesi yeniden kurulsa da kimliğe bağlıdır).
   */
  function tekIstek(karo, oge, yuk, anahtar) {
    const simdi = Date.now();
    // 1.4.0 kartlarda her düğmenin kilidi ayrıdır (anahtar): bir kartta farklı iki düğmeye art arda basış birbirini yok saymaz.
    const kilitAnahtari = anahtar ? karo.id + '|' + anahtar : karo.id;
    const kilit = karoKilitleri.get(kilitAnahtari);
    if (kilit && (simdi < kilit.bitis || (kilit.bekliyor && simdi - kilit.basla < KILIT_YEDEK_MS))) return null;
    const yeni = { basla: simdi, bitis: simdi + KARO_KILIT_MS, bekliyor: true };
    karoKilitleri.set(kilitAnahtari, yeni);
    const bitir = function () {
      yeni.bekliyor = false;
    };
    const sonuc = calistir(yuk, karo, oge);
    sonuc.then(bitir, bitir);
    return sonuc;
  }

  function donukBaslat() {
    donuk += 1;
  }

  function donukBitir() {
    donuk = Math.max(0, donuk - 1);
    if (donuk === 0 && bekleyenModel) {
      const m = bekleyenModel;
      bekleyenModel = null;
      modelUygula(m);
    }
    if (donuk === 0 && dilCizimiBekliyor) {
      dilCizimiBekliyor = false;
      dilCiz();
    }
    if (donuk === 0 && bilgiCizimiBekliyor) {
      bilgiCizimiBekliyor = false;
      bilgiYenidenCiz();
    }
  }

  // ---------------------------------------------------------------- etkileşim: fare tekerleği (o-20) ve panel sabitleme (o-23)

  function etkilesimAyarla(ham) {
    if (!ham || typeof ham !== 'object') return;
    etkilesim = { tekerlek: ham.tekerlek !== false, sabit: ham.sabit === true };
    sabitGoster();
  }

  /** Başlıktaki iğne düğmesi: yalnız panelde görünür (palet başlıksızdır); basılıysa panel dışarı tıklayınca kapanmaz. */
  function sabitGoster() {
    if (!el.sabitle) return;
    el.sabitle.setAttribute('aria-pressed', etkilesim.sabit ? 'true' : 'false');
    if (etkilesim.sabit) el.sabitle.classList.add('basili');
    else el.sabitle.classList.remove('basili');
    const metin = t(etkilesim.sabit ? 'yuzey.sabit.kapat' : 'yuzey.sabit.ac');
    el.sabitle.title = metin;
    el.sabitle.setAttribute('aria-label', metin);
  }

  /** Panel içeriği kaydırılabiliyor mu (taşan içerik)? Kaydırılabiliyorsa tekerlek karolarda yalnız kaydırıcı üstünde çalışır. */
  function kaydirilabilirMi() {
    return !!el.icerik && el.icerik.scrollHeight > el.icerik.clientHeight + 1;
  }

  /**
   * o-20: fare tekerleğiyle sayı değiştirme (ışık parlaklığı, medya sesi; her çentik ±5). Tekerlek olayları bir "dizi" olarak ele alınır:
   * yeni dizi yalnız tekerlek 400 ms boştaysa başlar (sayfa kaydırılırken karo değer değiştirmez), başladığı karoda kalır; panel
   * kaydırılabiliyorsa yalnız `dar` öğenin (kaydırıcı) üstünde başlar. Ara değerler 200 ms'de bire indirilir (kaydırıcıyla aynı kısıcı),
   * tekerlek 250 ms durunca SON değer gönderilir; sürerken panel yeniden çizilmez.
   * @param {HTMLElement} oge tekerleği dinleyen öğe (karonun tamamı)
   * @param {{dar?: HTMLElement, oku: () => (number|null), enAz: number, enCok: number, goster: (deger:number) => void,
   *   gonder: (deger:number, son:boolean) => void, kullanilabilir?: () => boolean}} secenek
   */
  function tekerlekBagla(oge, secenek) {
    if (mod !== 'panel' || !oge || typeof oge.addEventListener !== 'function') return;
    const sahip = {};
    const kisici = Kaydirici.kisici(function (deger, son) {
      secenek.gonder(deger, son === true);
    });
    let hedef = null;
    let bitisZamanlayicisi = null;
    let donukta = false;
    function bitir() {
      if (bitisZamanlayicisi !== null) clearTimeout(bitisZamanlayicisi);
      bitisZamanlayicisi = null;
      if (hedef !== null) {
        const son = hedef;
        hedef = null;
        kisici.son(son);
      }
      if (donukta) {
        donukta = false;
        donukBitir();
      }
    }
    oge.addEventListener(
      'wheel',
      function (olay) {
        if (!etkilesim.tekerlek || olay.ctrlKey === true || olay.shiftKey === true) return;
        if (typeof secenek.kullanilabilir === 'function' && !secenek.kullanilabilir()) return;
        const dar = secenek.dar;
        const izinli = !kaydirilabilirMi() || (!!dar && typeof dar.contains === 'function' && dar.contains(olay.target));
        const sonuc = tekerlek.dene(sahip, olay.deltaY, olay.deltaMode, izinli);
        if (!sonuc.ele) return;
        olay.preventDefault();
        if (sonuc.adim === 0) return;
        const mevcut = hedef !== null ? hedef : secenek.oku();
        const yeni = Kaydirici.tekerlekDegeri(mevcut, sonuc.adim, secenek.enAz, secenek.enCok);
        if (yeni === null || (hedef === null && yeni === mevcut)) return; // değer bilinmiyor ya da zaten sınırda
        hedef = yeni;
        if (!donukta) {
          donukta = true;
          donukBaslat();
        }
        secenek.goster(yeni);
        kisici.cagir(yeni);
        if (bitisZamanlayicisi !== null) clearTimeout(bitisZamanlayicisi);
        bitisZamanlayicisi = setTimeout(bitir, Kaydirici.TEKERLEK_BITIS_MS);
      },
      { passive: false },
    );
    tekrarlayicilar.push(bitir); // pencere odağını kaybedince / gösterilince yarım kalan dizi bitirilir (son değer gider)
  }

  function tumTutmalariBirak() {
    Array.from(etkinTutmalar).forEach(function (t) {
      t.birak();
    });
    tekrarlayicilar.forEach(function (durdur) {
      durdur();
    });
  }

  /**
   * Fare/dokunma bırakıldı (belgenin HERHANGİ bir yerinde): sürmekte olan tüm basılı tutmalar bırakılır. Öğe-düzeyi
   * dinleyiciler satır yeniden çizilince yeni öğeye bağlı olmadığından "bırakıldı" olayını kaçırabilirdi; bu, onları yedekler.
   * Bekleyen model çizimi click olayından SONRA yapılır (basış sırasında öğe yenilenirse click üretilmez).
   */
  function imlecBirakildi() {
    tumTutmalariBirak();
    if (imlecBasili) {
      imlecBasili = false;
      setTimeout(donukBitir, 0);
    }
  }

  /**
   * Yıkıcı eylem: ~0,8 sn basılı tutma. Yalnız "başladı" bilgisi ana sürece gider; süre dolunca eylem istenir ve onay ana
   * sürecin kendi saatiyle doğrulanır. `gorsel`: ilerleme sınıfının (dolum çubuğu) ve başarı/hata işaretinin ekleneceği öğe.
   * `bitti(sonucSozu)`: eylem istendikten sonra çağrılır (palet, yanıta göre kapanır ya da uyarıyı gösterir).
   * `yukEk` (1.4.0): servis eylemi yükü ({servis, veri?, sonDeger?}) ya da onu üreten işlev; tutma tamamlanınca isteğe eklenir.
   * Onayı yine yalnız ana sürecin saati verir: yük renderer'ın seçtiği servisi taşır, hattın izin listesi ve sınırları geçerlidir.
   */
  function basiliTutmaOlustur(karo, gorsel, bitti, yukEk) {
    let aktif = false;
    const tutma = Kaydirici.basiliTutma({
      sureMs: Kaydirici.BASILI_TUTMA_MS,
      basladi: function () {
        kopru.basiliBasla(karo.id);
        if (gorsel) gorsel.classList.add('basili');
        donukBaslat();
        aktif = true;
        ipucuGoster(t('yuzey.ipucu.basiliDevam', { etiket: karo.etiket }));
      },
      tamam: function () {
        sonlandir();
        // yukEk (kart servisi, yapılacaklarda öğe silme): servis + veri yükü; onay yine yalnız ana sürecin kendi saatindedir
        const ek = typeof yukEk === 'function' ? yukEk() : yukEk;
        const yuk = Object.assign({}, ek && typeof ek === 'object' ? ek : {}, { kimlik: karo.id, basili: true });
        const sonuc = calistir(yuk, karo, gorsel);
        if (bitti) bitti(sonuc);
      },
      iptal: function () {
        sonlandir();
        if (typeof kopru.basiliBirak === 'function') {
          // ana süreçteki başlangıç kaydı silinir (savunma derinliği); sonuç beklenmez
          Promise.resolve(kopru.basiliBirak(karo.id)).catch(function () {});
        }
        ipucuGoster(t('yuzey.ipucu.basiliTutun', { etiket: karo.etiket }));
      },
    });
    function sonlandir() {
      if (gorsel) gorsel.classList.remove('basili');
      if (aktif) {
        aktif = false;
        etkinTutmalar.delete(nesne);
        donukBitir();
      }
    }
    const nesne = {
      basla: function () {
        if (tutma.basla()) etkinTutmalar.add(nesne);
      },
      birak: function () {
        tutma.birak();
      },
    };
    return nesne;
  }

  // ---------------------------------------------------------------- bilgi bölümleri (src/yuzey-bilgi.js)

  /** Bilgi bölümü yeniden çizim istedi (okuma yanıtı geldi, düğmeye basıldı): sürükleme / basılı tutma / yazma sürüyorsa bitince çizilir. */
  function bilgiYenidenCiz() {
    if (mod !== 'panel') return;
    if (donuk > 0) {
      bilgiCizimiBekliyor = true;
      return;
    }
    ciz();
  }

  /** Kamera bölümü yeniden çizim istedi (görüntü geldi): sürükleme / basılı tutma sürüyorsa bitince çizilir (bilgi bölümüyle aynı kural). */
  const kamera =
    KameraModulu && typeof kopru.kamera === 'function'
      ? KameraModulu.olustur({
          t: function (anahtar, degisken) {
            return t(anahtar, degisken);
          },
          olustur: olustur,
          odakKaydet: odakKaydet,
          satirEkle: function (ogeler) {
            if (mod === 'panel' && ogeler.length > 0) panelSatirlari.push(ogeler);
          },
          kamera: function (kimlik) {
            return kopru.kamera(kimlik);
          },
          yenidenCiz: bilgiYenidenCiz,
          simdi: function () {
            return Date.now();
          },
          zamanlayici: {
            setTimeout: function (islev, ms) {
              return setTimeout(islev, ms);
            },
            clearTimeout: function (kimlik) {
              clearTimeout(kimlik);
            },
          },
          acikMi: function () {
            return mod === 'panel' && document.hidden !== true; // gizli pencere kamera istemez (ana süreç zaten reddeder)
          },
        })
      : null;

  const bilgi =
    BilgiModulu && BilgiBicim && Grafik
      ? BilgiModulu.olustur({
          doc: document,
          t: function (anahtar, degisken) {
            return t(anahtar, degisken);
          },
          dil: function () {
            return t.dil;
          },
          olustur: olustur,
          odakKaydet: odakKaydet,
          odakIste: function (anahtar) {
            odakIstegi = anahtar;
          },
          satirEkle: function (ogeler) {
            if (mod === 'panel' && ogeler.length > 0) panelSatirlari.push(ogeler);
          },
          oku: function (istek) {
            return typeof kopru.oku === 'function' ? kopru.oku(istek) : Promise.reject(new Error('oku yok'));
          },
          // Medya üst kartı: oynatıcının cihaz kartı (yuzey-kartlar.js). `kartlar` aşağıda kurulur; çağrı çizim sırasında olduğundan hazırdır.
          medyaKarti: function (karo) {
            return kartlar && kartlar.kartMi(karo) ? kartlar.kartCiz(karo) : null;
          },
          medyaKaroDuzelt: function (karo) {
            return karoDuzeltici ? karoDuzeltici(karo) : null;
          },
          calistir: calistir,
          basiliTutma: function (karo, gorsel, ekYuk, bitti) {
            return basiliTutmaOlustur(karo, gorsel, bitti, ekYuk);
          },
          donukBaslat: donukBaslat,
          donukBitir: donukBitir,
          yenidenCiz: bilgiYenidenCiz,
          ipucu: ipucuGoster,
          simdi: function () {
            return Date.now();
          },
          zamanlayici: {
            setTimeout: function (islev, ms) {
              return setTimeout(islev, ms);
            },
            clearTimeout: function (kimlik) {
              clearTimeout(kimlik);
            },
          },
          acikMi: function () {
            return mod === 'panel' && document.hidden !== true; // gizli pencere okuma istemez (ana süreç zaten reddeder)
          },
          Grafik: Grafik,
          Bicim: BilgiBicim,
          izgaraKolon: IZGARA_KOLON,
        })
      : null;

  // ---------------------------------------------------------------- odak ve klavye gezintisi (panel)

  /** Yeniden çizimde odak geri verilebilsin: odaklanabilir öğeye kararlı bir anahtar bağlanır. */
  function odakKaydet(anahtar, oge) {
    odakHaritasi.set(anahtar, oge);
    return oge;
  }

  /** O an odaktaki öğenin anahtarı (odak panel içeriğinde değilse null). */
  function odakAnahtari() {
    const aktifOge = document.activeElement;
    if (!aktifOge) return null;
    for (const [anahtar, oge] of odakHaritasi) {
      if (oge === aktifOge) return anahtar;
    }
    return null;
  }

  /** Çizimden önce odakta panel öğesi varsa, çizimden sonra aynı karoya/düğmeye/kaydırıcıya döner; öğe kalmadıysa içerik alanına. */
  function odagiGeriVer(anahtar) {
    if (anahtar === null) return;
    const hedef = odakHaritasi.get(anahtar) || el.icerik;
    if (typeof hedef.focus === 'function') hedef.focus();
  }

  function panelKonumuBul(oge) {
    for (let r = 0; r < panelSatirlari.length; r += 1) {
      const c = panelSatirlari[r].indexOf(oge);
      if (c >= 0) return { r: r, c: c };
    }
    return null;
  }

  function yatayMerkez(oge) {
    if (!oge || typeof oge.getBoundingClientRect !== 'function') return null;
    const k = oge.getBoundingClientRect();
    return k.left + k.width / 2;
  }

  /** Hedef satırda, verilen yatay konuma en yakın öğenin sırası (konum yoksa aynı sıra, satır sonuna kırpılır). */
  function enYakinSutun(satir, merkez, sutun) {
    if (merkez === null) return Math.min(sutun, satir.length - 1);
    let en = 0;
    let enUzak = Infinity;
    satir.forEach(function (oge, i) {
      const m = yatayMerkez(oge);
      const uzak = m === null ? Infinity : Math.abs(m - merkez);
      if (uzak < enUzak) {
        en = i;
        enUzak = uzak;
      }
    });
    return enUzak === Infinity ? Math.min(sutun, satir.length - 1) : en;
  }

  /**
   * Panelde ok tuşlarıyla ızgara gezintisi (k-09). Sol/Sağ okuma sırasında bir öğe gider (satır sonunda sonraki/önceki satıra
   * geçer), Yukarı/Aşağı bitişik satırda en yakın sütuna; Home/End satırın ilk/son öğesine, Ctrl+Home/End tüm panelin ilkine/sonuna.
   * Kaydırıcıda (satırlarda yoktur) oklar kaydırıcının kendi işini yapar. @returns {boolean} olay işlendi
   */
  function panelGezin(olay) {
    if (OK_TUSLARI.indexOf(olay.key) < 0 || olay.altKey || olay.metaKey || olay.shiftKey) return false;
    const home = olay.key === 'Home' || olay.key === 'End';
    if (olay.ctrlKey && !home) return false;
    const satirlar = panelSatirlari.filter(function (s) {
      return s.length > 0;
    });
    if (satirlar.length === 0) return false;
    const hedef = olay.target || document.activeElement;
    let konum = null;
    for (let r = 0; r < satirlar.length && konum === null; r += 1) {
      const c = satirlar[r].indexOf(hedef);
      if (c >= 0) konum = { r: r, c: c };
    }
    if (konum === null) {
      if (hedef !== el.icerik) return false;
      // odak içerik alanındayken ilk ok tuşu ilk (Yukarı/End: son) öğeye gider
      const sona = olay.key === 'ArrowUp' || olay.key === 'End';
      const satir = satirlar[sona ? satirlar.length - 1 : 0];
      olay.preventDefault();
      satir[sona ? satir.length - 1 : 0].focus();
      return true;
    }
    let r = konum.r;
    let c = konum.c;
    const merkez = yatayMerkez(hedef);
    switch (olay.key) {
      case 'ArrowRight':
        if (c + 1 < satirlar[r].length) c += 1;
        else if (r + 1 < satirlar.length) {
          r += 1;
          c = 0;
        }
        break;
      case 'ArrowLeft':
        if (c > 0) c -= 1;
        else if (r > 0) {
          r -= 1;
          c = satirlar[r].length - 1;
        }
        break;
      case 'ArrowDown':
        if (r + 1 < satirlar.length) {
          r += 1;
          c = enYakinSutun(satirlar[r], merkez, c);
        }
        break;
      case 'ArrowUp':
        if (r > 0) {
          r -= 1;
          c = enYakinSutun(satirlar[r], merkez, c);
        }
        break;
      case 'Home':
        if (olay.ctrlKey) r = 0;
        c = 0;
        break;
      default: // End
        if (olay.ctrlKey) r = satirlar.length - 1;
        c = satirlar[r].length - 1;
    }
    olay.preventDefault(); // kenarda bile içerik alanı kaymasın
    const yeni = satirlar[r][c];
    if (yeni && yeni !== hedef) yeni.focus();
    return true;
  }

  // ---------------------------------------------------------------- düzen (1.4.0: sayfa sekmeleri, ayrıntı bölmesi, sağ tık, karo görünümü)

  /**
   * src/yuzey-duzen.js yüklenmediyse null kalır ve panel bugünkü gibi çalışır. Yardımcılar işlev olarak geçilir; çevirmen ve kip
   * (dil değişince / kip değişince) her çağrıda güncel değerle okunur.
   */
  const duzen = DuzenModulu
    ? DuzenModulu.kur({
        belge: document,
        kopru: kopru,
        sekmeKabi: el.sekmeler,
        icerik: el.icerik,
        cevir: function (anahtar, degiskenler) {
          return t(anahtar, degiskenler);
        },
        dil: function () {
          return t.dil;
        },
        modAl: function () {
          return mod;
        },
        olustur: olustur,
        durumMetni: durumMetni,
        karoDugmesi: karoDugmesi,
        isikKarosu: isikKarosu,
        odakKaydet: odakKaydet,
        imlecBirakildi: imlecBirakildi,
        yenidenCiz: function () {
          ciz();
        },
        simdi: function () {
          return Date.now();
        },
        zaman: {
          setTimeout: function (islev, ms) {
            return setTimeout(islev, ms);
          },
          clearTimeout: function (sayac) {
            clearTimeout(sayac);
          },
        },
      })
    : null;

  // 1.4.0 eylem grubu (o-12 geri al düğmesi...): src/yuzey-eylem.js. Yüklenmediyse null kalır ve alt şerit bugünkü gibidir.
  const eylemBolumu = EylemModulu
    ? EylemModulu.kur({
        kopru: kopru,
        el: { geriAl: el.geriAl, gecikmeli: el.gecikmeli },
        saatMetni: function (ms) {
          return bildirimZamani(ms);
        },
        cevir: function (anahtar, degiskenler) {
          return t(anahtar, degiskenler);
        },
        simdi: function () {
          return Date.now();
        },
        zaman: {
          setTimeout: function (islev, ms) {
            return setTimeout(islev, ms);
          },
          clearTimeout: function (id) {
            clearTimeout(id);
          },
        },
        ipucu: function (metin) {
          ipucuGoster(metin);
        },
      })
    : null;

  // ---------------------------------------------------------------- panel

  // 1.4.0 cihaz kartları (iklim, medya, süpürge, seçici, sayı, zamanlayıcı, vantilatör, nem alıcı, ışık rengi): yuzey-kartlar.js.
  // Kartlar bu işlevlerle konuşur; köprüye (kopru) doğrudan erişimi yoktur.
  const kartlar = Kartlar
    ? Kartlar.kur({
        olustur: olustur,
        ceviri: function () {
          return t;
        },
        calistir: calistir,
        tekIstek: tekIstek,
        basiliTutmaOlustur: basiliTutmaOlustur,
        odakKaydet: odakKaydet,
        satirEkle: function (ogeler) {
          if (ogeler.length > 0) panelSatirlari.push(ogeler);
        },
        donukBaslat: donukBaslat,
        donukBitir: donukBitir,
        temizlikEkle: function (islev) {
          tekrarlayicilar.push(islev);
        },
        karoDugmesi: karoDugmesi,
        // Albüm kapağı: ana süreç HA'dan çeker, `data:` adresi (ya da null) döner; kapak yoksa/alınamazsa kart kapaksız çizilir.
        kapakIste: function (kimlik) {
          if (typeof kopru.oku !== 'function') return Promise.resolve(null);
          return kopru.oku({ tur: 'kapak', kimlik: kimlik }).then(
            function (yanit) {
              return yanit && yanit.ok === true && typeof yanit.veri === 'string' ? yanit.veri : null;
            },
            function () {
              return null;
            },
          );
        },
        tekerlekBagla: tekerlekBagla,
      })
    : null;

  /**
   * Tek tıklama eylemi olmayan karoya düz tıklamada gösterilen ipucu (örnek komutla: "klima 24"). Komut sözlüğü olmayan
   * (salt okunur) karoda ipucu yoktur: orada yazılacak komut da yoktur.
   */
  function eylemYokIpucusu(karo) {
    if (!kartlar || !kartlar.komutluMu(karo)) return;
    ipucuGoster(t('yuzey.ipucu.eylemYok', { ornek: kartlar.ornek(karo) }));
  }

  function karoDugmesi(karo) {
    const dugme = olustur('button', 'karo durum-' + karo.durum + (karo.yikici ? ' yikici' : '') + (karo.kullanilabilir ? '' : ' yok'));
    dugme.type = 'button';
    // 2.0: simge yuvarlak "madeni" içinde durur (seçilen simge ya da alanın varsayılan ikonu); başarı / hata rozeti ve bekleme yayı onun üstünde
    const madeni = olustur('span', 'karo-madeni');
    madeni.setAttribute('aria-hidden', 'true');
    dugme.appendChild(madeni);
    if (duzen) duzen.gorunumuUygula(karo, dugme, madeni); // 1.4.0 düzen (o-31): renk sınıfı ve simge (etiketten önce)
    if (madeni.children.length === 0) {
      const ikon = cizgiIkon(varsayilanIkonYolu(karo));
      if (ikon) madeni.appendChild(ikon);
    }
    if (bekleyenKarolar.has(karo.id)) dugme.classList.add('bekliyor');
    dugme.appendChild(olustur('span', 'karo-etiket', karo.etiket));
    const durum = durumMetni(karo);
    dugme.appendChild(olustur('span', 'karo-durum', durum));
    const tutmaGerekli = karo.yikici && karo.varsayilanEylem !== false; // eylemi olmayan karoda "basılı tut" demenin anlamı yok
    if (tutmaGerekli) dugme.appendChild(olustur('span', 'karo-ipucu', t('yuzey.karo.basiliTut'))); // g-08: kalıcı alt yazı (title yalnız fareyle görünür)
    dugme.title = tutmaGerekli ? t('yuzey.karo.basiliBaslik', { etiket: karo.etiket }) : karo.etiket;
    // Açık/kapalı karolar ekran okuyucuya düğme durumu olarak duyurulur (k-16); sahne/düğme/yıkıcı karolarda durum yoktur.
    if (!karo.yikici && !karo.tekrar && (karo.durum === 'acik' || karo.durum === 'kapali')) {
      dugme.setAttribute('aria-pressed', karo.durum === 'acik' ? 'true' : 'false');
    }
    odakKaydet('k:' + karo.id, dugme);
    basariyiSurdur(karo, dugme);

    if (karo.varsayilanEylem === false) {
      // Tek tıklama eylemi yok (kart olarak çizilmeyen iklim / medya / sensör...): düz tıklama servis göndermez, ipucu verir.
      dugme.addEventListener('click', function () {
        eylemYokIpucusu(karo);
      });
    } else if (karo.yikici) {
      const tutma = basiliTutmaOlustur(karo, dugme);
      dugme.addEventListener('pointerdown', function (olay) {
        if (olay.button === 0 || olay.button === undefined) tutma.basla();
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ad) {
        dugme.addEventListener(ad, tutma.birak);
      });
      dugme.addEventListener('keydown', function (olay) {
        if ((olay.key === 'Enter' || olay.key === ' ') && !olay.repeat) tutma.basla();
      });
      dugme.addEventListener('keyup', tutma.birak);
      dugme.addEventListener('blur', tutma.birak);
    } else if (karo.tekrar) {
      const tekrar = Kaydirici.tekrarlayici(function () {
        calistir({ kimlik: karo.id }, karo, dugme);
      });
      let basili = false;
      // Basılı tutma sürerken yeniden çizim ertelenir: düğme yok edilirse "bırakıldı" olayı gelmez ve tekrar sürüp giderdi.
      const baslat = function () {
        if (basili) return;
        basili = true;
        donukBaslat();
        tekrar.basla();
      };
      const durdur = function () {
        tekrar.dur();
        if (basili) {
          basili = false;
          donukBitir();
        }
      };
      dugme.addEventListener('pointerdown', function (olay) {
        if (olay.button === 0 || olay.button === undefined) baslat();
      });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ad) {
        dugme.addEventListener(ad, durdur);
      });
      dugme.addEventListener('click', function (olay) {
        if (olay.detail === 0) calistir({ kimlik: karo.id }, karo, dugme); // klavye ile etkinleştirme
      });
      tekrarlayicilar.push(durdur);
    } else {
      dugme.addEventListener('click', function () {
        if (duzen && duzen.tikiYut(karo.id)) return; // 1.4.0 düzen (o-16): uzun basmayla ayrıntı açıldıysa bırakma tıklaması eylem sayılmaz
        tekIstek(karo, dugme, { kimlik: karo.id });
      });
    }
    return dugme;
  }

  /** Işığın o anki seviyesine en yakın hazır seviye (g-02); ışık kapalıysa ya da seviye bilinmiyorsa null. Eşitlikte düşük olan. */
  function enYakinHazir(karo) {
    if (karo.durum !== 'acik' || karo.yuzde === null) return null;
    let en = PANEL_HAZIR[0];
    PANEL_HAZIR.forEach(function (p) {
      if (Math.abs(p - karo.yuzde) < Math.abs(en - karo.yuzde)) en = p;
    });
    return en;
  }

  /**
   * 2.0 ışık seviyesi dolgusu: karonun zemini parlaklık kadar dolar. Son çizilen değer kimliğe göre tutulur; HA yeni seviyeyi
   * bildirip karo yeniden çizilince dolgu eski değerden yenisine yayla kayar (hareket azaltılmışsa doğrudan yeni değerde durur).
   */
  const sonDoluluk = new Map(); // kimlik -> 0..1

  function doluluguYaz(kimlik, dolgu, deger, oynat) {
    stilYaz(dolgu, '--doluluk', String(deger));
    const onceki = sonDoluluk.get(kimlik);
    sonDoluluk.set(kimlik, deger);
    if (!oynat || onceki === undefined || onceki === deger || !hareketAcik() || typeof dolgu.animate !== 'function') return;
    dolgu.animate([{ transform: 'scaleX(' + onceki + ')' }, { transform: 'scaleX(' + deger + ')' }], { duration: 420, easing: YAY_YUMUSAK });
  }

  function isikKarosu(karo, detaydaMi) {
    const kutu = olustur('div', 'isik-karo');
    const ana = karoDugmesi(karo);
    const dolgu = olustur('span', 'karo-dolgu');
    dolgu.setAttribute('aria-hidden', 'true');
    ana.appendChild(dolgu);
    const acik = karo.durum === 'acik';
    if (acik && karo.yuzde !== null && karo.yuzde >= 100) ana.classList.add('tam');
    doluluguYaz(karo.id, dolgu, acik ? (karo.yuzde !== null ? Math.max(0.04, Math.min(1, karo.yuzde / 100)) : 1) : 0, true);
    kutu.appendChild(ana);
    const hazirlar = olustur('div', 'hazirlar');
    const yakin = enYakinHazir(karo);
    const hazirDugmeleri = [];
    PANEL_HAZIR.forEach(function (p) {
      const d = olustur('button', 'hazir' + (p === yakin ? ' vurgu' : '') + (p === PANEL_HAZIR_SIK ? ' sik' : ''), t('yuzey.yuzde', { n: p }));
      d.type = 'button';
      d.title = karo.etiket + ' ' + t('yuzey.yuzde', { n: p });
      odakKaydet('h:' + karo.id + ':' + p, d);
      d.addEventListener('click', function () {
        calistir({ kimlik: karo.id, parlaklik: p, sonDeger: true }, karo, d);
      });
      hazirlar.appendChild(d);
      hazirDugmeleri.push(d);
    });
    kutu.appendChild(hazirlar);
    panelSatirlari.push([ana]);
    panelSatirlari.push(hazirDugmeleri);
    const aralik = document.createElement('input');
    aralik.type = 'range';
    aralik.className = 'kaydirici';
    aralik.min = '1';
    aralik.max = '100';
    aralik.step = '1';
    aralik.value = String(karo.yuzde !== null ? Math.max(1, Math.min(100, karo.yuzde)) : 50);
    aralik.setAttribute('aria-label', t('yuzey.karo.parlaklik', { etiket: karo.etiket }));
    odakKaydet('r:' + karo.id, aralik); // ok gezintisine girmez (oklar kaydırıcının kendi işidir) ama yeniden çizimde odağı korunur
    // 2.0: kaydırıcının dolu kısmı ve karonun dolgusu sürüklerken anında izler (HA yanıtı beklenmez; yanıt gelince model yeniden çizer)
    const seviyeyiGoster = function (deger) {
      stilYaz(aralik, '--deger', deger + '%');
      if (karo.durum === 'acik') doluluguYaz(karo.id, dolgu, Math.max(0.04, Math.min(1, deger / 100)), false);
    };
    stilYaz(aralik, '--deger', aralik.value + '%');
    const kisici = Kaydirici.kisici(function (deger, son) {
      calistir({ kimlik: karo.id, parlaklik: deger, sonDeger: son === true }, karo, aralik);
    });
    let suruklemede = false;
    aralik.addEventListener('input', function () {
      if (!suruklemede) {
        suruklemede = true;
        donukBaslat();
      }
      seviyeyiGoster(Number(aralik.value));
      kisici.cagir(Number(aralik.value));
    });
    aralik.addEventListener('change', function () {
      kisici.son(Number(aralik.value)); // bırakınca son değer HER ZAMAN ve beklemeden gider
      if (suruklemede) {
        suruklemede = false;
        donukBitir();
      }
    });
    tekrarlayicilar.push(function () {
      if (suruklemede) {
        suruklemede = false;
        donukBitir();
      }
    });
    kutu.appendChild(aralik);
    // o-20: fare tekerleği parlaklığı ±5 değiştirir (yalnız açık ve ulaşılabilir ışıkta; kapalı ışığı tekerlek açmaz)
    tekerlekBagla(kutu, {
      dar: aralik,
      kullanilabilir: function () {
        return karo.durum === 'acik' && karo.kullanilabilir === true;
      },
      oku: function () {
        // Gösterilen kaydırıcı değeri esas alınır: model, son gönderimden sonra HA yanıtı gelene dek eski kalabilir (art arda diziler geri sıçramasın).
        const gosterilen = Number(aralik.value);
        return Number.isFinite(gosterilen) ? gosterilen : karo.yuzde;
      },
      enAz: 1,
      enCok: 100,
      goster: function (deger) {
        aralik.value = String(deger);
        seviyeyiGoster(deger);
      },
      gonder: function (deger, son) {
        calistir({ kimlik: karo.id, parlaklik: deger, sonDeger: son === true }, karo, aralik);
      },
    });
    const renkler = kartlar ? kartlar.isikRengi(karo) : null; // 1.4.0 (o-02): beyaz tonu + renk paleti; cihaz renk desteklemiyorsa null
    if (renkler) kutu.appendChild(renkler);
    if (duzen && detaydaMi !== true) duzen.karoyuBagla(karo, ana, kutu); // 1.4.0 düzen (o-16): uzun basma, Shift+Enter, sağ tık, "⋯" (ayrıntı bölmesinde değil)
    return kutu;
  }

  function sonSatiri() {
    // Tek tıklama eylemi olmayan karo (iklim, medya...) "Son" listesinde düz tıklamayla çalışamaz: listeye alınmaz.
    const sonlar = model.sonlar.filter(function (karo) {
      return karo.varsayilanEylem !== false;
    });
    if (sonlar.length === 0) return null;
    const bolum = olustur('section', 'bolum son');
    bolum.appendChild(olustur('h2', 'bolum-baslik', t('yuzey.bolum.son')));
    const sira = olustur('div', 'son-sira');
    const dugmeler = [];
    sonlar.slice(0, PANEL_SON_SAYISI).forEach(function (karo) {
      const d = olustur('button', 'son-oge', karo.etiket);
      d.type = 'button';
      d.title = karo.etiket;
      odakKaydet('s:' + karo.id, d);
      d.addEventListener('click', function () {
        tekIstek(karo, d, { kimlik: karo.id });
      });
      sira.appendChild(d);
      dugmeler.push(d);
    });
    panelSatirlari.push(dugmeler);
    bolum.appendChild(sira);
    return bolum;
  }

  /**
   * Bir grubun karoları satırlara bölünür. Medya grubu (hiz-12) kendi alt gruplarına göre ayrı satırlarda durur:
   * ses çıkışı (hoparlör | kulaklık), ses (-/+/sessiz), oynat/duraklat/sonraki. Diğer gruplar tek satırdır.
   * Satır içi sıra favori sırasıdır; alt grubu bilinmeyen medya karosu son satıra gider.
   */
  function grupSatirlari(g) {
    if (g.kod !== 'medya') return [{ ad: '', karolar: g.karolar }];
    const kovalar = {};
    MEDYA_SATIRLARI.forEach(function (ad) {
      kovalar[ad] = [];
    });
    g.karolar.forEach(function (karo) {
      kovalar[MEDYA_SATIRLARI.indexOf(karo.altGrup) >= 0 ? karo.altGrup : MEDYA_SATIRLARI[MEDYA_SATIRLARI.length - 1]].push(karo);
    });
    return MEDYA_SATIRLARI.filter(function (ad) {
      return kovalar[ad].length > 0;
    }).map(function (ad) {
      return { ad: ad, karolar: kovalar[ad] };
    });
  }

  /**
   * Boş durum (k-03): erişim anahtarı hiç eklenmemişse "anahtar yok", anahtar varsa "favori yok"; ikisinde de Ayarlar'ı açan
   * düğme (palette alt düğmeler görünmediğinden orada başka yol yoktur).
   */
  function bosDurum() {
    const kutu = olustur('div', 'bos');
    const anahtarYok = model.ust.anahtarYok === true;
    kutu.appendChild(olustur('p', 'bos-metin', t(anahtarYok ? 'yuzey.bos.anahtarYok' : 'yuzey.bos.favoriYok')));
    kutu.appendChild(olustur('p', 'bos-alt', t(anahtarYok ? 'yuzey.bos.anahtarYokAlt' : 'yuzey.bos.favoriYokAlt')));
    const dugme = olustur('button', 'bos-dugme', t('yuzey.bos.ayarlariAc'));
    dugme.type = 'button';
    dugme.addEventListener('click', function () {
      kopru.ayarlarAc();
    });
    kutu.appendChild(dugme);
    if (mod === 'panel') {
      odakKaydet('bos', dugme);
      panelSatirlari.push([dugme]);
    }
    return kutu;
  }

  /** Bir ızgara satırının (görsel) durumu: aynı görsel satıra düşecek karolar ve doldurulan sütun sayısı. */
  function izgaraDurumu() {
    const durum = {
      bekleyen: [],
      doluluk: 0,
      bosalt: function () {
        if (durum.bekleyen.length > 0) panelSatirlari.push(durum.bekleyen);
        durum.bekleyen = [];
        durum.doluluk = 0;
      },
    };
    return durum;
  }

  /**
   * Izgaraya TEK karo ekler: yeni bir karo türü ya da kontrolü yalnız burada (ve karoDugmesi / isikKarosu'nda) tanınır; grup görünümü,
   * sayfa görünümü ve ayrıntı bölmesi aynı yolu kullanır. Işık karosu ve cihaz kartları tam genişliktir (satırı böler); diğerleri boyutuna göre
   * 1 / 2 / 3 sütun kaplar (düzen modülü yoksa 1) ve sığmazsa sonraki görsel satıra geçer — ok gezintisi bu satırları izler.
   */
  function izgarayaKaroEkle(izgara, karo, durum) {
    if (karo.alan === 'sensor' || karo.alan === 'binary_sensor') {
      // Favori sensör (salt okunur): özel sayfada da "Tümü"deki sensör karosuyla görünür; eylem düğmesi değildir (src/yuzey-bilgi.js)
      const sensor = bilgi ? bilgi.sayfaSensoru(karo) : null;
      if (sensor) {
        if (durum.doluluk + 1 > IZGARA_KOLON) durum.bosalt();
        izgara.appendChild(sensor);
        durum.bekleyen.push(sensor);
        durum.doluluk += 1;
        if (durum.doluluk >= IZGARA_KOLON) durum.bosalt();
        return;
      }
    }
    if (karo.parlaklikKontrol) {
      durum.bosalt();
      izgara.appendChild(isikKarosu(karo));
      return;
    }
    if (kartlar && kartlar.kartMi(karo)) {
      durum.bosalt(); // 1.4.0 cihaz kartı (iklim, medya, süpürge, seçici...) tam genişliktedir: satırı böler (ışık karosu gibi)
      const kart = kartlar.kartCiz(karo);
      if (kart) {
        if (duzen) duzen.sagTikBagla(karo, kart); // sağ tık menüsü (tepsiye ekle, sayfaya ekle...); kart kontrolleri uzun basmayı kullanır
        izgara.appendChild(kart);
      }
      return;
    }
    const d = karoDugmesi(karo);
    const sar = duzen ? duzen.karoyuSar(karo, d) : { kutu: d, dugme: d };
    const sutun = Math.min(IZGARA_KOLON, duzen ? duzen.sutunSayisi(karo) : 1);
    if (durum.doluluk + sutun > IZGARA_KOLON) durum.bosalt();
    izgara.appendChild(sar.kutu);
    durum.bekleyen.push(sar.dugme);
    durum.doluluk += sutun;
    if (durum.doluluk >= IZGARA_KOLON) durum.bosalt();
  }

  /** Seçili sayfa (o-24): sayfanın karoları SAYFANIN sırasıyla tek ızgarada; karo yoksa kısa bir açıklama. */
  function sayfaBolumu(sayfa) {
    const bolum = olustur('section', 'bolum sayfa');
    if (sayfa.karolar.length === 0) {
      const bos = olustur('div', 'bos');
      bos.appendChild(olustur('p', 'bos-metin', t('yuzey.sayfa.bos')));
      bos.appendChild(olustur('p', 'bos-alt', t('yuzey.sayfa.bosAlt')));
      bolum.appendChild(bos);
      return bolum;
    }
    const izgara = olustur('div', 'izgara');
    const durum = izgaraDurumu();
    sayfa.karolar.forEach(function (karo) {
      izgarayaKaroEkle(izgara, karo, durum);
    });
    durum.bosalt();
    bolum.appendChild(izgara);
    return bolum;
  }

  /** Ayrıntı bölmesi (o-16): ok gezintisi için üst satır (Geri, menü) ve gövdedeki karo bu çizimin satırlarına eklenir. */
  function ayrintiBolumu(karo) {
    const bolum = duzen.ayrintiCiz(karo);
    const ust = [odakHaritasi.get('ayrinti-geri'), odakHaritasi.get('ayrinti-menu')].filter(Boolean);
    panelSatirlari.unshift(ust);
    if (!karo.parlaklikKontrol && karo.varsayilanEylem !== false) {
      const d = odakHaritasi.get('k:' + karo.id);
      if (d) panelSatirlari.push([d]);
    }
    return bolum;
  }

  // ---------------------------------------------------------------- 2.0 dönen rakamlar

  /**
   * Yeniden çizimden önce sayı taşıyan metinler (yüzde, sıcaklık, sensör, saat...) okunur; çizimden sonra aynı sıradaki metin
   * değiştiyse yalnız değişen haneler yuvarlanır (artışta yukarı, azalışta aşağı). Yalnız hareket açıkken ve gerçek DOM'da çalışır;
   * birkaç yüz milisaniye sonra öğe düz metne döner (ekran okuyucu eski haneyi okumaz: giden hane aria-hidden).
   */
  function rakamOkumasi() {
    if (!hareketAcik() || typeof el.icerik.querySelectorAll !== 'function') return null;
    const sayac = {};
    const harita = new Map();
    el.icerik.querySelectorAll(RULO_SECICI).forEach(function (o) {
      sayac[o.className] = (sayac[o.className] || 0) + 1;
      harita.set(o.className + '#' + sayac[o.className], o.textContent);
    });
    return harita;
  }

  function sayiDegeri(metin) {
    const m = /-?\d+(?:[.,]\d+)?/.exec(metin);
    return m ? Number(m[0].replace(',', '.')) : 0;
  }

  function rakamlariYuvarla(onceki) {
    if (!onceki || onceki.size === 0) return;
    const sayac = {};
    el.icerik.querySelectorAll(RULO_SECICI).forEach(function (o) {
      sayac[o.className] = (sayac[o.className] || 0) + 1;
      const eski = onceki.get(o.className + '#' + sayac[o.className]);
      const yeni = o.textContent;
      if (eski === undefined || eski === yeni || eski.length !== yeni.length || !/\d/.test(eski) || !/\d/.test(yeni) || o.children.length > 0) return;
      const yon = sayiDegeri(yeni) >= sayiDegeri(eski) ? 1 : -1;
      o.textContent = '';
      let gecikme = 0;
      for (let i = 0; i < yeni.length; i += 1) {
        if (yeni[i] === eski[i]) {
          o.appendChild(document.createTextNode(yeni[i]));
          continue;
        }
        const hucre = olustur('span', 'rulo-hucre');
        const giden = olustur('span', null, eski[i]);
        giden.setAttribute('aria-hidden', 'true');
        const gelen = olustur('span', 'rulo-gelen', yeni[i]);
        hucre.appendChild(giden);
        hucre.appendChild(gelen);
        o.appendChild(hucre);
        const zaman = { duration: RULO_MS, delay: gecikme, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
        giden.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + -100 * yon + '%)', opacity: 0 }], Object.assign({ fill: 'forwards' }, zaman));
        gelen.animate([{ transform: 'translateY(' + 100 * yon + '%)', opacity: 0 }, { transform: 'none', opacity: 1 }], Object.assign({ fill: 'backwards' }, zaman));
        gecikme += 30;
      }
      setTimeout(function () {
        o.textContent = yeni;
      }, RULO_MS + gecikme + 20);
    });
  }

  function panelCiz() {
    const rakamlar = rakamOkumasi();
    const oncekiOdak = odakIstegi !== null ? odakIstegi : odakAnahtari();
    const kaydirma = el.icerik.scrollTop;
    odakIstegi = null;
    tekrarlayicilar = [];
    odakHaritasi = new Map();
    panelSatirlari = [];
    // Sensör geçmişi görünümü (bilgi) açıksa panelin yerini alır (Geri / Esc ile kapanır).
    const detayParcalari = bilgi && bilgi.detayAcikMi() ? bilgi.detayParcalari() : [];
    if (detayParcalari.length > 0) {
      el.icerik.replaceChildren.apply(el.icerik, detayParcalari);
      if (typeof kaydirma === 'number') el.icerik.scrollTop = kaydirma;
      odagiGeriVer(oncekiOdak);
      return;
    }
    const parcalar = [];
    const ayrinti = duzen ? duzen.ayrintiKaro(tumKarolar()) : null;
    // Sensör favorileri genel gruplardan çıkarılıp bilgi bölümüne taşınır (bilgi-modeli.js bilgiBolumunuEkle); özel sayfa üyeleri arasında
    // yine bulunabilsin diye sayfa karoları sensör karolarıyla birlikte aranır.
    const sayfa = duzen && !ayrinti ? duzen.seciliSayfa(model, tumKarolar().concat(bilgi ? bilgi.sensorKarolari() : [])) : null;
    if (ayrinti) {
      parcalar.push(ayrintiBolumu(ayrinti));
    } else if (sayfa) {
      // Sayfa yalnız seçtiğin denetim karolarını gösterir; üst kartlar ve sensör şeridi (kısa bakış) sayfada da durur.
      if (bilgi) bilgi.ustParcalar().forEach(function (p) { parcalar.push(p); });
      parcalar.push(sayfaBolumu(sayfa));
    } else {
      // "Tümü": üst kartlar ve sensör şeridi, son kullanılanlar, gruplar, sonra sensör karoları, yapılacaklar ve takvim.
      if (bilgi) bilgi.ustParcalar().forEach(function (p) { parcalar.push(p); });
      const son = sonSatiri();
      if (son) parcalar.push(son);
      model.gruplar.forEach(function (g) {
        const bolum = olustur('section', 'bolum grup-' + g.kod);
        const baslik = olustur('h2', 'bolum-baslik', g.etiket);
        const odaUst = g.oda === true && eylemBolumu ? eylemBolumu.odaBasligi(g, baslik, odakKaydet) : null; // 1.4.0 (o-14): oda grubunda "Odayı kapat"
        if (odaUst) {
          bolum.appendChild(odaUst.kap);
          panelSatirlari.push([odaUst.dugme]);
        } else {
          bolum.appendChild(baslik);
        }
        grupSatirlari(g).forEach(function (satir) {
          const izgara = olustur('div', 'izgara' + (satir.ad ? ' alt-' + satir.ad : ''));
          const durum = izgaraDurumu(); // ızgarada aynı görsel satıra düşecek karolar (ışık karosu tam genişlik: satırı böler)
          satir.karolar.forEach(function (karo) {
            izgarayaKaroEkle(izgara, karo, durum);
          });
          durum.bosalt();
          bolum.appendChild(izgara);
        });
        parcalar.push(bolum);
      });
      if (bilgi) bilgi.altParcalar().forEach(function (p) { parcalar.push(p); });
      if (kamera) kamera.parcalar().forEach(function (p) { parcalar.push(p); }); // 1.4.0 (o-48): en altta, yalnız Ayarlar'da onaylı kameralar varsa
    }
    if (parcalar.length === 0) parcalar.push(bosDurum());
    el.icerik.replaceChildren.apply(el.icerik, parcalar);
    rakamlariYuvarla(rakamlar);
    if (typeof kaydirma === 'number') el.icerik.scrollTop = kaydirma;
    const istek = duzen ? duzen.odakIstegiAl() : null; // ayrıntı bölmesi açıldı / kapandı: odak ilgili öğeye
    odagiGeriVer(istek !== null ? istek : oncekiOdak);
  }

  // ---------------------------------------------------------------- palet

  function paletOgeleri() {
    return tumKarolar().map(function (karo) {
      const sonSira = model.sonlar.findIndex(function (s) {
        return s.id === karo.id;
      });
      // alan + ozellik: servis komutları ("klima 24", "masa sicak", "tv ses 30") cihazın kendi listelerine / aralığına göre çözülür (lib/arama.js alanKomutu)
      // yikici + kullanilabilir: gecikmeli eylem satırları ("fan 30dk") onay isteyen ya da kullanılamayan karoyu hiç önermez (lib/arama.js gecikmeCoz)
      return { etiket: karo.etiket, grupEtiketi: karo.grupEtiketi, parlaklikKontrol: karo.parlaklikKontrol, sonSira: sonSira, alan: karo.alan, ozellik: karo.ozellik, yikici: karo.yikici, kullanilabilir: karo.kullanilabilir, karo: karo };
    });
  }

  /** Palet satırının gecikmeli eylemi: { yon: 'ac'|'kapat'|'sureli', dakika: tam sayı } ya da null. Asıl doğrulama ana süreçtedir. */
  function gecikmeDuzelt(g) {
    if (!g || typeof g !== 'object' || ['ac', 'kapat', 'sureli'].indexOf(g.yon) < 0 || !Number.isInteger(g.dakika)) return null;
    return { yon: g.yon, dakika: g.dakika };
  }

  /** Gecikmeli satırın rozeti: "10 dk sonra kapat", "30 dk sonra aç", "Aç, 30 dk sonra kapat". */
  function gecikmeRozeti(g) {
    const sure = EylemModulu ? EylemModulu.sureMetni(g.dakika, t) : String(g.dakika);
    return t(g.yon === 'ac' ? 'yuzey.rozet.gecikmeAc' : g.yon === 'sureli' ? 'yuzey.rozet.gecikmeSureli' : 'yuzey.rozet.gecikmeKapat', { sure: sure });
  }

  /** Palet satırının komutu cihazda geçerli değil mi? Komut tanındı ama aralık dışı ('sinir') ya da cihaz desteklemiyor ('desteklenmiyor'). */
  function satirKomutHatasi(satir) {
    return satir.komutHatasi === 'sinir' || satir.komutHatasi === 'desteklenmiyor' ? satir.komutHatasi : null;
  }

  /** Satırın çalıştıracağı servis komutu (`eylem`), karonun onay isteyen servisleri arasında mı? */
  function servisOnayliMi(karo, servis) {
    return karo.onayliServisler.indexOf(servis) >= 0;
  }

  /**
   * Bu satırın eylemi basılı tutma (onay) ister mi? Servis komutunda yalnız o servis onaylıysa (ör. klima modu, TV kapatma, seçici /
   * sayı / zamanlayıcı); tek tıklama eylemi olmayan karoda (komut yoksa) hiç eylem yoktur; diğerlerinde karonun sınıfı.
   */
  function satirOnayliMi(satir) {
    const karo = satir.karo;
    if (satirKomutHatasi(satir)) return false; // geçersiz komut hiçbir şey göndermez
    if (satir.gecikme) return false; // gecikmeli eylem: planı kurmak zararsızdır; zamanı gelince hat yine kuralları uygular (onay isteyen karo zaten önerilmez)
    if (satir.eylem) return servisOnayliMi(karo, satir.eylem.servis);
    if (karo.varsayilanEylem === false) return false;
    return karo.yikici;
  }

  /** Satırın çalıştıracağı servis yükü (basılı tutma tamamlanınca isteğe eklenir); servis komutu yoksa boş (karonun kendi eylemi). */
  function satirServisYuku(satir) {
    if (!satir.eylem) return {};
    const yuk = { servis: satir.eylem.servis };
    if (satir.eylem.veri) yuk.veri = satir.eylem.veri;
    return yuk;
  }

  const DEGISIM_ANAHTARLARI = { acildi: 'yuzey.degisen.acildi', kapandi: 'yuzey.degisen.kapandi', calisti: 'yuzey.degisen.calisti', degisti: 'yuzey.degisen.degisti' };

  /** Son değişen satırının rozeti: "Açıldı · 3 dk önce". */
  function degisimMetni(d) {
    const once = EylemModulu ? EylemModulu.oncekiMetni(Date.now() - d.zaman, t) : '';
    return t(DEGISIM_ANAHTARLARI[d.tur]) + (once !== '' ? ' · ' + once : '');
  }

  /** Favori olmayan, ama ana süreçte izlenen varlığın salt bilgi karosu (palet "@"): eylemi yoktur, durum metni yazılmaz. */
  function degisenBilgiKarosu(d) {
    return {
      id: d.kimlik,
      etiket: d.ad,
      grup: '',
      grupEtiketi: '',
      altGrup: null,
      alan: d.alan,
      durum: 'notr',
      yuzde: null,
      kullanilabilir: true,
      ulasilamiyor: false,
      yikici: false,
      parlaklikKontrol: false,
      tekrar: false,
      ozellik: null,
      varsayilanEylem: true, // örnek komut rozeti ve ozet çizilmesin; asıl engel satir.salt (paletCalistir)
      onayliServisler: [],
      simge: null,
      renk: null,
      boyut: 'normal',
    };
  }

  /**
   * Palet "@" (o-18): son değişenler, en yeni üstte; "@salon" adı süzer. Favori olan varlık gerçek karosuyla gelir (Enter normal eylem
   * yolundan çalışır); favori olmayan satır yalnız bilgidir. Liste ana süreçten gelir ve kapı kuralından geçmiştir.
   */
  function degisenPaletSatirlari(metin) {
    const bolum = model.eylem;
    const karolar = new Map();
    tumKarolar().forEach(function (k) {
      karolar.set(k.id, k);
    });
    const satirlar = Arama.degisenSatirlari(metin, bolum.degisenler)
      .slice(0, PALET_SATIR_SINIRI)
      .map(function (r) {
        const gercek = karolar.get(r.degisen.kimlik);
        return {
          karo: gercek || degisenBilgiKarosu(r.degisen),
          etiket: r.degisen.ad,
          konumlar: r.konumlar,
          parlaklik: null,
          kapat: false,
          desteklenmiyor: false,
          eylem: null,
          komutHatasi: null,
          gecikme: null,
          degisim: { tur: r.degisen.tur, zaman: r.degisen.zaman },
          salt: !gercek,
        };
      });
    let bos = '';
    if (satirlar.length === 0) bos = t(!bolum.degisenAcik ? 'yuzey.degisen.kapali' : bolum.degisenler.length > 0 ? 'yuzey.palet.eslesmeYok' : 'yuzey.degisen.bos');
    return { baslik: t('yuzey.degisen.baslik'), etiket: t('yuzey.degisen.baslik'), bos: bos, satirlar: satirlar };
  }

  // ---- palet "*" (o-46): favori olmayan güvenli cihazlar. Liste, süzgeç ve eylem ana süreçtedir (kapı kuralı, eylem sınıfı, servis izin listesi);
  // sayfa yalnız gösterir ve { kimlik, islem } ister. Ayar kapalıysa ana süreç 'kapali' döner ve yalnız bilgi satırı görünür.

  /** Ana süreçten gelen satırı biçimce doğrular (asıl süzgeç ana süreçtedir); geçersizse null. */
  function digerSatiriDuzelt(d) {
    if (!d || typeof d.kimlik !== 'string' || typeof d.ad !== 'string' || d.ad === '' || !Object.prototype.hasOwnProperty.call(DIGER_ALAN_ANAHTARLARI, d.alan) || DIGER_DURUMLARI.indexOf(d.durum) < 0) return null;
    return { kimlik: d.kimlik, ad: d.ad, alan: d.alan, durum: d.durum, oda: typeof d.oda === 'string' ? d.oda : '' };
  }

  function digerSorgusuVarMi() {
    return !!Arama.digerSorgusu && !!Arama.digerSorgusu(sorgu);
  }

  /** "*" aranınca liste bir kez istenir (ana süreç 2 dk önbellekler); alınamazsa 5 sn sonraki yazışta yeniden denenir, 'kapali' yeniden denenmez. */
  function digerListesiniIste() {
    if (typeof kopru.digerCihazlar !== 'function') {
      digerListe = { durum: 'hata', liste: [], tur: 'kapali', zaman: Date.now() }; // eski preload: köprü yok, özellik kapalı sayılır
      return;
    }
    if (digerListe.durum === 'yukleniyor' || digerListe.durum === 'hazir') return;
    if (digerListe.durum === 'hata' && (digerListe.tur === 'kapali' || Date.now() - digerListe.zaman < DIGER_YENIDEN_DENEME_MS)) return;
    const no = gosterimNo;
    digerListe = { durum: 'yukleniyor', liste: [], tur: null, zaman: Date.now() };
    const bitti = function (yeni) {
      if (no !== gosterimNo || mod !== 'palet') return; // palet kapanıp yeniden açıldı: eski yanıt yeni gösterime girmez
      digerListe = yeni;
      if (digerSorgusuVarMi()) paletCiz();
    };
    Promise.resolve(kopru.digerCihazlar()).then(
      function (yanit) {
        if (yanit && yanit.ok === true && Array.isArray(yanit.liste)) bitti({ durum: 'hazir', liste: yanit.liste.map(digerSatiriDuzelt).filter(Boolean), tur: null, zaman: Date.now() });
        else bitti({ durum: 'hata', liste: [], tur: yanit && typeof yanit.tur === 'string' ? yanit.tur : 'hata', zaman: Date.now() });
      },
      function () {
        bitti({ durum: 'hata', liste: [], tur: 'hata', zaman: Date.now() });
      },
    );
  }

  /** "*" satırının salt görünüm karosu: eylem yolu yoktur (yikici: false, parlaklik yok); işlem ana sürece { kimlik, islem } olarak gider. */
  function digerKaro(d) {
    const alanAdi = t(DIGER_ALAN_ANAHTARLARI[d.alan]);
    return {
      id: d.kimlik,
      etiket: d.ad,
      grup: '',
      grupEtiketi: d.oda !== '' ? d.oda + ' · ' + alanAdi : alanAdi,
      altGrup: null,
      alan: d.alan,
      durum: d.durum,
      yuzde: null,
      kullanilabilir: true,
      ulasilamiyor: false,
      yikici: false,
      parlaklikKontrol: false,
      tekrar: false,
      ozellik: null,
      varsayilanEylem: true,
      onayliServisler: [],
      simge: null,
      renk: null,
      boyut: 'normal',
    };
  }

  function digerPaletSatirlari(cozum) {
    digerListesiniIste();
    const baslik = t('yuzey.diger.baslik');
    const satirlar =
      digerListe.durum === 'hazir'
        ? Arama.digerSatirlari(cozum, digerListe.liste)
            .slice(0, PALET_SATIR_SINIRI)
            .map(function (r) {
              return { karo: digerKaro(r.diger), etiket: r.diger.ad, konumlar: r.konumlar, parlaklik: null, kapat: false, desteklenmiyor: false, eylem: null, komutHatasi: null, gecikme: null, diger: r.diger };
            })
        : [];
    let bos = '';
    if (satirlar.length === 0) {
      if (digerListe.durum === 'hata') bos = t(digerListe.tur === 'kapali' ? 'yuzey.diger.kapali' : 'yuzey.diger.hata');
      else if (digerListe.durum === 'hazir') bos = t(digerListe.liste.length > 0 ? 'yuzey.diger.eslesmeYok' : 'yuzey.diger.bos');
      else bos = t('yuzey.diger.yukleniyor');
    }
    return { baslik: baslik, etiket: baslik, bos: bos, satirlar: satirlar };
  }

  /** Shift+Enter menüsü: sahne "çalıştır" (kapatma yok); diğerleri "aç / kapat"; her satırda "favoriye ekle" ve "Home Assistant'ta aç". */
  function digerMenuOgeleri(d) {
    const ogeler = d.alan === 'scene' ? [{ ad: 'ac', anahtar: 'yuzey.diger.calistir' }] : [{ ad: 'ac', anahtar: 'yuzey.diger.ac' }, { ad: 'kapat', anahtar: 'yuzey.diger.kapat' }];
    ogeler.push({ ad: 'favori', anahtar: 'yuzey.diger.favori' }, { ad: 'haAc', anahtar: 'yuzey.diger.haAc' });
    return ogeler;
  }

  /** Seçili satırın açık menüsü ya da seviye seçicisindeki öğe sayısı (sol/sağ ok için). */
  function menuUzunlugu(satir) {
    return satir && satir.diger ? digerMenuOgeleri(satir.diger).length : SEVIYELER.length;
  }

  function digerUygunDegilMi(tur) {
    return tur === 'bulunamadi' || tur === 'yasak' || tur === 'kaynak-izinsiz' || tur === 'gecersiz';
  }

  /** Enter / tıklama: sahne çalıştırılır, diğerleri aç-kapa yapılır (toggle). Menüden 'ac' | 'kapat' | 'favori' | 'haAc' gelir. */
  function paletDigerIslem(satir, islem) {
    const d = satir.diger;
    if (islem === 'haAc') {
      kopru.haAc();
      return;
    }
    if (digerBekliyor) return;
    const no = gosterimNo;
    digerBekliyor = true;
    const bitir = function () {
      digerBekliyor = false;
    };
    seviyeAcik = false;
    if (islem === 'favori') {
      if (typeof kopru.digerFavoriEkle !== 'function') return bitir();
      Promise.resolve(kopru.digerFavoriEkle(d.kimlik)).then(
        function (sonuc) {
          bitir();
          if (no !== gosterimNo || mod !== 'palet') return;
          const eklendi = !!sonuc && (sonuc.ok === true || sonuc.tur === 'zaten-var');
          if (eklendi) digerListe = { durum: 'hazir', liste: digerListe.liste.filter(function (x) { return x.kimlik !== d.kimlik; }), tur: null, zaman: digerListe.zaman }; // artık favori: listeden çıkar
          else if (sonuc && sonuc.tur === 'bulunamadi') digerListe = { durum: 'bos', liste: [], tur: null, zaman: 0 };
          ipucuGoster(t(eklendi ? 'yuzey.ipucu.digerFavoriEklendi' : sonuc && sonuc.tur === 'dolu' ? 'yuzey.ipucu.digerFavoriDolu' : 'yuzey.ipucu.digerFavoriOlmadi', { etiket: d.ad }));
          paletCiz();
        },
        function () {
          bitir();
          if (no === gosterimNo && mod === 'palet') ipucuGoster(t('yuzey.ipucu.digerFavoriOlmadi', { etiket: d.ad }));
        },
      );
      return;
    }
    if (typeof kopru.digerCalistir !== 'function') return bitir();
    Promise.resolve(kopru.digerCalistir({ kimlik: d.kimlik, islem: islem })).then(
      function (sonuc) {
        bitir();
        if (no !== gosterimNo || mod !== 'palet') return;
        if (sonuc && sonuc.ok === true) {
          kopru.kapat(); // başarıda palet kapanır; sonucu ana süreç bildirir
          return;
        }
        if (paletAcikKalmali(sonuc)) return; // hız sınırı / onay uyarısı zaten görünür
        if (sonuc && sonuc.tur === 'bulunamadi') digerListe = { durum: 'bos', liste: [], tur: null, zaman: 0 }; // liste bayat: sonraki çizimde yeniden alınır
        ipucuGoster(t(sonuc && digerUygunDegilMi(sonuc.tur) ? 'yuzey.ipucu.digerUygunDegil' : 'yuzey.ipucu.digerOlmadi', { etiket: d.ad }));
      },
      function () {
        bitir();
        if (no === gosterimNo && mod === 'palet') ipucuGoster(t('yuzey.ipucu.digerOlmadi', { etiket: d.ad }));
      },
    );
  }

  /** Boş sorguda son kullanılanlar (en çok 5) ve altında kalan bütün favoriler; her bölümün ilk satırı başlık taşır. Aksi halde arama sonuçları. */
  function paletSatirlariniHesapla() {
    const digerOnek = Arama.digerSorgusu ? Arama.digerSorgusu(sorgu) : null;
    if (digerOnek) return digerPaletSatirlari(digerOnek);
    const degisenOnek = model.eylem && Arama.degisenSorgusu ? Arama.degisenSorgusu(sorgu) : null;
    if (degisenOnek) return degisenPaletSatirlari(degisenOnek.metin);
    if (sorgu.trim() === '') {
      const BOLUM_BASLIGI = { son: t('yuzey.bolum.son'), favori: t('yuzey.bolum.favoriler') };
      let oncekiBolum = null;
      return {
        baslik: null,
        etiket: t('yuzey.palet.sonVeFavoriler'),
        satirlar: Arama.bosSorguListesi(paletOgeleri(), { sonSayisi: PALET_SON_SAYISI }).map(function (r) {
          const bolumBasligi = r.bolum !== oncekiBolum ? BOLUM_BASLIGI[r.bolum] : null;
          oncekiBolum = r.bolum;
          return { karo: r.oge.karo, konumlar: [], parlaklik: null, kapat: false, desteklenmiyor: false, eylem: null, komutHatasi: null, bolumBasligi: bolumBasligi };
        }),
      };
    }
    const s = Arama.paletSorgusu(sorgu, paletOgeleri());
    const satirlar = s.sonuclar.slice(0, PALET_SATIR_SINIRI).map(function (r, i) {
      // Seviye bütün kısılabilir satırlara yazılır (r.parlaklik); kısılamayan satır "desteklenmiyor"dur ve Enter'la çalışmaz (h-13).
      // Üst düzey parlaklikDesteklenmiyor ilk satırı anlatır: satır alanı yoksa (eski arama arayüzü) ilk satır ondan alır.
      return {
        karo: r.oge.karo,
        konumlar: r.konumlar,
        parlaklik: r.parlaklik !== undefined ? r.parlaklik : i === 0 ? s.parlaklik : null,
        kapat: r.kapat === true,
        desteklenmiyor: r.parlaklikDesteklenmiyor === true || (i === 0 && s.parlaklikDesteklenmiyor === true),
        // 1.4.0 servis komutu ("klima 24"): eylem {servis, veri, tur, deger}; tanınıp cihazda geçersizse komutHatasi ('sinir' | 'desteklenmiyor')
        eylem: r.eylem && typeof r.eylem === 'object' ? r.eylem : null,
        komutHatasi: r.komutHatasi === 'sinir' || r.komutHatasi === 'desteklenmiyor' ? r.komutHatasi : null,
        // 1.4.0 (o-15) gecikmeli eylem ("salon 10 dk sonra kapat", "fan 30dk"): { yon: 'ac'|'kapat'|'sureli', dakika }
        gecikme: gecikmeDuzelt(r.gecikme),
      };
    });
    // "liste süt" (o-07): ayarda hızlı liste seçiliyse ilk satır, metni o yapılacaklar listesine ekleyen satırdır. Metin YALNIZ
    // todo.add_item'a gider (başka hiçbir eyleme ya da konuşma API'sine değil); sınırlı serbest metin istisnası budur.
    sayfaSatirlariniKat(satirlar, s.sonuclar.slice(0, PALET_SATIR_SINIRI));
    const hizli = bilgi ? bilgi.hizliEkleSatiri(sorgu) : null;
    if (hizli) satirlar.unshift(hizliEkleSatiri(hizli));
    return { baslik: null, satirlar: satirlar };
  }

  /**
   * Palet sayfa satırları (o-24): sorgu bir panel sayfasının adına ("Akşam") ya da "sayfa" sözcüğüne uyuyorsa o sayfa bir satır olur; Enter paneli o
   * sayfayla açar ve HİÇBİR servis çağrısı yapmaz (yalnız `sayfaSec`). Satır, cihaz sonuçlarının arasına puanına göre girer (eşitte cihaz önde).
   * @param {object[]} satirlar cihaz satırları (yerinde değiştirilir)
   * @param {{puan:number}[]} sonuclar satirlar ile aynı sırada, aramanın puanları
   */
  function sayfaSatirlariniKat(satirlar, sonuclar) {
    const sayfalar = Array.isArray(model.sayfalar) ? model.sayfalar : [];
    if (sayfalar.length === 0 || typeof kopru.sayfaSec !== 'function' || sorgu.trim() === '') return;
    const grup = t('yuzey.palet.sayfa');
    const adaylar = [{ id: 'tumu', etiket: t('yuzey.sekme.tumu'), grupEtiketi: grup }].concat(
      sayfalar.map(function (sayfa) {
        return { id: sayfa.id, etiket: sayfa.ad, grupEtiketi: grup };
      }),
    );
    Arama.ara(sorgu, adaylar).forEach(function (r) {
      const satir = { karo: sayfaKarosu(r.oge), sayfa: { id: r.oge.id }, konumlar: r.konumlar, parlaklik: null, kapat: false, desteklenmiyor: false, eylem: null, komutHatasi: null, gecikme: null };
      let yer = satirlar.length;
      for (let i = 0; i < sonuclar.length && i < satirlar.length; i += 1) {
        if (sonuclar[i].puan < r.puan) {
          yer = i;
          break;
        }
      }
      satirlar.splice(yer, 0, satir);
      sonuclar.splice(yer, 0, { puan: r.puan });
    });
  }

  /** Sayfa satırının sahte karosu: eylemi yoktur (varsayilanEylem true ama satir.sayfa paletCalistir'da önce ele alınır), onay istemez. */
  function sayfaKarosu(aday) {
    return {
      id: 'sayfa:' + aday.id,
      etiket: aday.etiket,
      grup: 'sayfa',
      grupEtiketi: aday.grupEtiketi,
      altGrup: null,
      alan: 'sayfa',
      durum: 'yok',
      yuzde: null,
      kullanilabilir: true,
      ulasilamiyor: false,
      yikici: false,
      parlaklikKontrol: false,
      tekrar: false,
      ozellik: null,
      varsayilanEylem: true,
      onayliServisler: [],
    };
  }

  /** Palet sayfa satırı: paneli o sayfayla açtırır (ana süreç doğrular); başarıda pencere panel kipine geçer, olmazsa nedeni ipucunda söylenir. */
  function paletSayfayaGec(satir) {
    const etiket = satir.karo.etiket;
    const no = gosterimNo;
    if (typeof kopru.sayfaSec !== 'function') return;
    Promise.resolve(kopru.sayfaSec(satir.sayfa.id)).then(
      function (sonuc) {
        if (no !== gosterimNo || mod !== 'palet') return;
        if (!sonuc || sonuc.ok !== true) ipucuGoster(t('yuzey.ipucu.sayfaOlmadi', { etiket: etiket }));
      },
      function () {
        if (no === gosterimNo && mod === 'palet') ipucuGoster(t('yuzey.ipucu.sayfaOlmadi', { etiket: etiket }));
      },
    );
  }

  /** Palet "liste <metin>" satırı: sahte bir karo (kimlik = yapılacaklar listesi) ve eklenecek metin; Enter / tıklama add_item çalıştırır. */
  function hizliEkleSatiri(hizli) {
    return {
      karo: {
        id: hizli.liste.id,
        etiket: hizli.liste.etiket,
        grupEtiketi: t('yuzey.bilgi.palet.hizliEkleGrup'),
        durum: 'notr',
        yuzde: null,
        kullanilabilir: true,
        ulasilamiyor: false,
        yikici: false,
        parlaklikKontrol: false,
        tekrar: false,
      },
      etiket: t('yuzey.bilgi.palet.hizliEkle', { metin: hizli.metin, liste: hizli.liste.etiket }), // satırda görünen metin (karo adı yalnız liste adıdır)
      konumlar: [],
      parlaklik: null,
      kapat: false,
      desteklenmiyor: false,
      eylem: null,
      komutHatasi: null,
      hizli: hizli.metin,
    };
  }

  /** Etiketi eşleşen harfler vurgulu (mark) parçalara böler; yalnız textContent. */
  function vurguluEtiket(etiket, konumlar) {
    const kap = olustur('span', 'palet-etiket');
    const kume = new Set(konumlar);
    let parca = '';
    let vurgulu = false;
    const bosalt = function () {
      if (parca === '') return;
      kap.appendChild(olustur(vurgulu ? 'mark' : 'span', '', parca));
      parca = '';
    };
    Array.from(etiket).forEach(function (harf, i) {
      const v = kume.has(i);
      if (v !== vurgulu) bosalt();
      vurgulu = v;
      parca += harf;
    });
    bosalt();
    return kap;
  }

  /** Palet, yalnız bu yanıtlarda AÇIK kalır ve uyarı görünür; başarıda ve diğer hatalarda kapanır (hata ayrıntısı köşe bildirimindedir). */
  function paletAcikKalmali(sonuc) {
    return !!sonuc && sonuc.ok === false && (sonuc.tur === 'onay-gerekli' || sonuc.tur === 'cok-sik');
  }

  /** Eylemin yanıtını bekler: uyarı yanıtında palet kapanmaz (h-31); başka bir gösterime geçilmişse dokunmaz. */
  function paletYanitiniBekle(sonucSozu) {
    const no = gosterimNo;
    sonucSozu.then(function (sonuc) {
      if (no !== gosterimNo || mod !== 'palet') return;
      if (!paletAcikKalmali(sonuc)) kopru.kapat();
    });
  }

  function paletHizliEkle(satir) {
    const karo = satir.karo;
    const sozu = tekIstek(karo, null, { kimlik: karo.id, servis: 'add_item', veri: { item: satir.hizli } });
    if (!sozu) return;
    sozu.then(function (sonuc) {
      if (sonuc && sonuc.ok === true && bilgi) bilgi.listeyiEskit(karo.id);
    });
    paletYanitiniBekle(sozu); // başarıda palet kapanır; hata ipucu satırında kalır
  }

  /** Gecikmeli eylem kur (o-15): başarıda palet kapanır (kuruldu bildirimini ana süreç verir); olmazsa nedeni ipucunda söylenir, palet açık kalır. */
  function paletGeciktir(satir) {
    const karo = satir.karo;
    if (typeof kopru.geciktir !== 'function') return;
    const no = gosterimNo;
    Promise.resolve(kopru.geciktir({ kimlik: karo.id, yon: satir.gecikme.yon, dakika: satir.gecikme.dakika })).then(
      function (sonuc) {
        if (no !== gosterimNo || mod !== 'palet') return;
        if (sonuc && sonuc.ok === true) {
          kopru.kapat();
          return;
        }
        const tur = sonuc && sonuc.tur;
        const anahtar = tur === 'dolu' ? 'yuzey.ipucu.gecikmeDolu' : tur === 'kapali' ? 'yuzey.ipucu.gecikmeKapali' : tur === 'yasak' || tur === 'kaynak-izinsiz' || tur === 'gecersiz' ? 'yuzey.ipucu.gecikmeUygunDegil' : 'yuzey.ipucu.gecikmeOlmadi';
        ipucuGoster(t(anahtar, { etiket: karo.etiket }));
      },
      function () {
        if (no === gosterimNo && mod === 'palet') ipucuGoster(t('yuzey.ipucu.gecikmeOlmadi', { etiket: karo.etiket }));
      },
    );
  }

  function paletCalistir(satir, seviye) {
    if (satir.hizli !== undefined) return paletHizliEkle(satir);
    if (satir.diger) return paletDigerIslem(satir, satir.diger.alan === 'scene' ? 'ac' : 'degistir'); // "*" (o-46): Enter / tıklama = aç-kapa (sahne: çalıştır)
    if (satir.sayfa) return paletSayfayaGec(satir); // panel sayfası (o-24): servis çağrısı yok
    const karo = satir.karo;
    if (satir.salt === true) {
      // "@" listesinde favori olmayan varlık: yalnız bilgi (eylem yolu yok)
      ipucuGoster(t('yuzey.ipucu.degisenFavoriDegil', { etiket: karo.etiket }));
      return;
    }
    const yuk = { kimlik: karo.id };
    const hata = satirKomutHatasi(satir);
    if (hata && (seviye === undefined || seviye === null)) {
      // Komut tanındı ama bu cihazda geçerli değil: hiçbir şey gönderilmez, nedeni söylenir.
      ipucuGoster(t(hata === 'sinir' ? 'yuzey.ipucu.komutSinirDisi' : 'yuzey.ipucu.komutDesteklenmiyor', { etiket: karo.etiket }));
      return;
    }
    if (satir.gecikme && (seviye === undefined || seviye === null)) return paletGeciktir(satir);
    if (seviye !== undefined && seviye !== null) {
      yuk.parlaklik = seviye;
      yuk.sonDeger = true;
    } else if (satir.eylem) {
      Object.assign(yuk, satirServisYuku(satir)); // "klima 24": servis + veri; sınır / izin denetimi ana süreçte (servis-izinleri.js)
      yuk.sonDeger = true;
    } else if (karo.varsayilanEylem === false) {
      eylemYokIpucusu(karo); // "klima" yazıp Enter: tek tıklama eylemi yok; örnek komut gösterilir
      return;
    } else if (satir.kapat && karo.parlaklikKontrol) {
      yuk.kapat = true; // "ışık 0"
    } else if (satir.parlaklik !== null && karo.parlaklikKontrol) {
      yuk.parlaklik = satir.parlaklik;
      yuk.sonDeger = true;
    }
    const sozu = tekIstek(karo, null, yuk);
    if (sozu) paletYanitiniBekle(sozu); // yanıt gelince palet kapanır; sonuç köşe bildirimiyle gelir
  }

  function paletCiz() {
    // Satırlar yeniden kurulacak: sürmekte olan her basılı tutma (fare ya da Enter) eski öğeye/eski seçime aittir; bırakılır.
    // (Aksi halde bırakma yeni öğeye gider ve eski sayaç dolunca yıkıcı eylem kısa bir tıklamayla çalışırdı.)
    tumTutmalariBirak();
    const h = paletSatirlariniHesapla();
    paletSatirlari = h.satirlar;
    if (secili >= paletSatirlari.length) secili = Math.max(0, paletSatirlari.length - 1);
    const parcalar = [];
    let seciliKutu = null;
    let seciliKimligi = null;
    el.icerik.setAttribute('aria-label', h.etiket || h.baslik || t('yuzey.palet.sonuclar'));
    if (h.baslik) {
      const baslik = olustur('div', 'palet-baslik', h.baslik);
      baslik.setAttribute('aria-hidden', 'true'); // liste adı aria-label'dadır
      parcalar.push(baslik);
    }
    if (paletSatirlari.length === 0) parcalar.push(h.bos ? olustur('p', 'bos', h.bos) : sorgu.trim() === '' ? bosDurum() : olustur('p', 'bos', t('yuzey.palet.eslesmeYok')));
    paletSatirlari.forEach(function (satir, i) {
      const karo = satir.karo;
      if (satir.bolumBasligi) {
        const bolumBasligi = olustur('div', 'palet-baslik', satir.bolumBasligi);
        bolumBasligi.setAttribute('aria-hidden', 'true'); // liste adı aria-label'dadır
        parcalar.push(bolumBasligi);
      }
      const onayli = satirOnayliMi(satir); // bu satırın eylemi ~0,8 sn basılı tutma ister
      const komutHatasi = satirKomutHatasi(satir);
      const kutu = olustur('div', 'palet-satir' + (i === secili ? ' secili' : '') + (onayli ? ' yikici' : ''));
      kutu.id = 'palet-satir-' + i;
      kutu.setAttribute('role', 'option');
      kutu.setAttribute('aria-selected', i === secili ? 'true' : 'false');
      if (i === secili) {
        seciliKutu = kutu;
        seciliKimligi = kutu.id;
      }
      kutu.appendChild(vurguluEtiket(satir.etiket !== undefined ? satir.etiket : karo.etiket, satir.konumlar));
      if (satir.degisim) kutu.appendChild(olustur('span', 'rozet sessiz', degisimMetni(satir.degisim))); // "@" (o-18): "Açıldı · 3 dk önce"
      if (satir.parlaklik !== null && karo.parlaklikKontrol) kutu.appendChild(olustur('span', 'rozet', t('yuzey.yuzde', { n: satir.parlaklik })));
      if (satir.kapat && karo.parlaklikKontrol) kutu.appendChild(olustur('span', 'rozet', t('yuzey.rozet.kapat')));
      // 1.4.0 servis komutu: rozet ne yapılacağını söyler ("24°", "Sıcak beyaz · 2700 K", "Ses %30"); geçersizse nedenini
      const komutRozeti = satir.eylem && kartlar ? kartlar.rozetMetni(satir.eylem) : '';
      if (komutRozeti !== '') kutu.appendChild(olustur('span', 'rozet', komutRozeti));
      if (satir.gecikme && !komutHatasi) kutu.appendChild(olustur('span', 'rozet', gecikmeRozeti(satir.gecikme)));
      if (komutHatasi) kutu.appendChild(olustur('span', 'rozet sessiz', t(komutHatasi === 'sinir' ? 'yuzey.rozet.sinirDisi' : 'yuzey.rozet.desteklenmiyor')));
      else if (satir.desteklenmiyor) kutu.appendChild(olustur('span', 'rozet sessiz', t('yuzey.rozet.desteklenmiyor')));
      if (!satir.eylem && !komutHatasi && karo.varsayilanEylem === false && kartlar && kartlar.komutluMu(karo) && satir.parlaklik === null && !satir.kapat) {
        kutu.appendChild(olustur('span', 'rozet sessiz', kartlar.ornek(karo))); // eylemi olmayan karo: nasıl komut verileceği
      }
      if (onayli) kutu.appendChild(olustur('span', 'rozet uyari', t('yuzey.rozet.basiliTut')));
      kutu.appendChild(olustur('span', 'palet-grup', karo.grupEtiketi));
      kutu.appendChild(olustur('span', 'palet-durum', satir.sayfa ? t('yuzey.palet.sayfayaGec') : durumMetni(karo)));
      kutu.addEventListener('mousemove', function () {
        if (donuk > 0) return; // basılı tutma / basılı fare sürerken satır yeniden çizilmez (basılı öğe yok edilirse bırakma kaybolurdu)
        if (secili !== i) {
          secili = i;
          seviyeAcik = false;
          paletCiz();
        }
      });
      if (onayli && !komutHatasi) {
        const tutma = basiliTutmaOlustur(karo, kutu, paletYanitiniBekle, satirServisYuku(satir));
        kutu.addEventListener('pointerdown', function (olay) {
          if (olay.button === 0 || olay.button === undefined) tutma.basla();
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ad) {
          kutu.addEventListener(ad, tutma.birak);
        });
      } else {
        kutu.addEventListener('click', function () {
          paletCalistir(satir);
        });
      }
      parcalar.push(kutu);
      if (i === secili && seviyeAcik && karo.parlaklikKontrol) {
        const seviye = olustur('div', 'seviye');
        seviye.setAttribute('role', 'group');
        seviye.setAttribute('aria-label', t('yuzey.palet.seviye'));
        SEVIYELER.forEach(function (p, j) {
          const d = olustur('button', 'seviye-oge' + (j === seviyeSecili ? ' secili' : ''), t('yuzey.yuzde', { n: p }));
          d.type = 'button';
          d.id = 'palet-seviye-' + j;
          d.setAttribute('role', 'option');
          d.setAttribute('aria-selected', j === seviyeSecili ? 'true' : 'false');
          d.tabIndex = -1; // klavye gezintisi arama kutusundan sürer
          if (j === seviyeSecili) seciliKimligi = d.id;
          d.addEventListener('click', function () {
            paletCalistir(satir, p);
          });
          seviye.appendChild(d);
        });
        parcalar.push(seviye);
      }
      if (i === secili && seviyeAcik && satir.diger) {
        // "*" (o-46) Shift+Enter menüsü: Aç / Kapat (sahnede Çalıştır) / Favoriye ekle / Home Assistant'ta aç; seviye seçicisiyle aynı klavye gezintisi
        const menu = olustur('div', 'seviye diger-menu');
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-label', t('yuzey.diger.menu'));
        digerMenuOgeleri(satir.diger).forEach(function (oge, j) {
          const d = olustur('button', 'seviye-oge' + (j === seviyeSecili ? ' secili' : ''), t(oge.anahtar));
          d.type = 'button';
          d.id = 'palet-seviye-' + j;
          d.setAttribute('role', 'option');
          d.setAttribute('aria-selected', j === seviyeSecili ? 'true' : 'false');
          d.tabIndex = -1; // klavye gezintisi arama kutusundan sürer
          if (j === seviyeSecili) seciliKimligi = d.id;
          d.addEventListener('click', function () {
            paletDigerIslem(satir, oge.ad);
          });
          menu.appendChild(d);
        });
        parcalar.push(menu);
      }
    });
    seciliSatirKutusu = seciliKutu;
    if (seciliKimligi !== null) el.arama.setAttribute('aria-activedescendant', seciliKimligi);
    else el.arama.removeAttribute('aria-activedescendant');
    el.icerik.replaceChildren.apply(el.icerik, parcalar);
    if (seciliKutu && typeof seciliKutu.scrollIntoView === 'function') seciliKutu.scrollIntoView({ block: 'nearest' });
  }

  let paletTutmasi = null;

  function paletTusu(olay) {
    // IME (Türkçe dışı giriş yöntemleri) yazım aşamasında Enter/oklar/Esc IME'nindir: palet eylemi çalıştırmaz, kapanmaz (h-31).
    if (olay.isComposing === true || olay.keyCode === 229) return;
    const satir = paletSatirlari[secili];
    switch (olay.key) {
      case 'Escape':
        olay.preventDefault();
        if (seviyeAcik) {
          seviyeAcik = false;
          paletCiz();
        } else {
          kopru.kapat();
        }
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        olay.preventDefault();
        if (paletSatirlari.length === 0) return;
        seviyeAcik = false;
        secili = (secili + (olay.key === 'ArrowDown' ? 1 : -1) + paletSatirlari.length) % paletSatirlari.length;
        paletCiz();
        return;
      }
      case 'Home':
      case 'End': {
        // Metin imleci yerine liste başı/sonu (palet sorguları kısadır; Sol/Sağ imleci yine taşır). Shift/Ctrl/Alt ile varsayılan kalır.
        if (olay.shiftKey || olay.ctrlKey || olay.altKey || olay.metaKey) return;
        if (paletSatirlari.length === 0) return;
        olay.preventDefault();
        seviyeAcik = false;
        secili = olay.key === 'Home' ? 0 : paletSatirlari.length - 1;
        paletCiz();
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!seviyeAcik) return;
        olay.preventDefault();
        {
          const uzunluk = menuUzunlugu(satir);
          seviyeSecili = (seviyeSecili + (olay.key === 'ArrowRight' ? 1 : -1) + uzunluk) % uzunluk;
        }
        paletCiz();
        return;
      case 'Enter': {
        olay.preventDefault();
        if (olay.repeat) return;
        if (!satir) {
          // satır yoksa ve boş durum görünüyorsa Enter Ayarlar'ı açar (fareye gerek kalmasın, k-03)
          if (sorgu.trim() === '') kopru.ayarlarAc();
          return;
        }
        if (olay.shiftKey) {
          if (satir.karo.parlaklikKontrol || satir.diger) {
            seviyeAcik = !seviyeAcik;
            seviyeSecili = 0;
            paletCiz();
          }
          return;
        }
        if (satir.diger) {
          // "*" (o-46): menü açıksa seçili öğe, değilse aç-kapa (sahne: çalıştır); basılı tutma yoktur (liste yalnız zararsız cihazlar içerir)
          if (seviyeAcik) return paletDigerIslem(satir, digerMenuOgeleri(satir.diger)[seviyeSecili].ad);
          return paletCalistir(satir);
        }
        // Yazılan sayı bu öğede anlamsız ("ampul 40"): sessizce aç/kapat yapılmasın; sayı silinene kadar Enter bu satırda
        // eylem çalıştırmaz (yıkıcı satır dahil). Satıra fareyle tıklamak bilinçli bir seçimdir ve değişmez (h-13).
        if (satirKomutHatasi(satir)) return paletCalistir(satir); // tanınan ama geçersiz komut: yalnız nedenini söyler
        if (satir.desteklenmiyor) return;
        if (seviyeAcik) return paletCalistir(satir, SEVIYELER[seviyeSecili]);
        if (satirOnayliMi(satir)) {
          // seçili satırda dolum çubuğu görünür (h-31); satır yeniden çizilirse tutma zaten bırakılır
          paletTutmasi = basiliTutmaOlustur(satir.karo, seciliSatirKutusu, paletYanitiniBekle, satirServisYuku(satir));
          paletTutmasi.basla();
          return;
        }
        paletCalistir(satir);
        return;
      }
      default:
    }
  }

  // ---------------------------------------------------------------- çizim

  /** Hata ve uyarılar başlığın altında tam genişlik ayrı şeritte (h-12, g-03): neden HA'ya ulaşılamadığı ya da anahtar uyarısı. */
  function seritiCiz() {
    const u = model.ust;
    const satirlar = [];
    if (u.uyari) satirlar.push({ tur: 'uyari', metin: u.uyari });
    if (u.hata) satirlar.push({ tur: 'hata', metin: t('yuzey.serit.hata', { hata: u.hata }) });
    const imza = JSON.stringify(satirlar);
    if (imza === seritImzasi) return;
    seritImzasi = imza;
    el.serit.hidden = satirlar.length === 0;
    const parcalar = satirlar.map(function (s) {
      const satir = olustur('div', 'serit-satir ' + s.tur);
      const simge = olustur('span', 'serit-simge', '!');
      simge.setAttribute('aria-hidden', 'true'); // renge ek şekil; ekran okuyucu metni okur
      satir.appendChild(simge);
      satir.appendChild(olustur('span', 'serit-metin', ilkHarfBuyuk(s.metin)));
      return satir;
    });
    el.serit.replaceChildren.apply(el.serit, parcalar);
  }

  function ustuCiz() {
    const u = model.ust;
    el.baglanti.textContent = t(BAGLANTI_ANAHTARI[u.baglanti]);
    // Yetki kesici açıkken (anahtar Home Assistant tarafından reddedildi) uyarı şeritte yazar; nokta uyarı renginde kalır.
    el.baglanti.className = 'baglanti ' + (u.uyari ? 'yedek' : u.baglanti);
    // Bağlantı koptuğunda (yedek mod ya da yeniden bağlanıyor) gösterilen durum eskimiş olabilir (gorunum-12, g-04): karolar
    // soluklaşmaz (çalışmaya devam eder); yalnız durum metni hafif solar ve başlıkta "Durumlar eski olabilir" rozeti çıkar.
    // Canlı bağlantı kapalıysa (ayar) REST normal çalışma biçimidir: rozet ve soluklaşma yok.
    const eski = u.baglanti === 'yedek' || u.baglanti === 'baglaniyor';
    el.kok.className = 'kok' + (eski ? ' soluk' : '');
    el.eski.hidden = !eski;
    if (u.medyaCaliyor === true) {
      el.medya.hidden = false;
      const nota = olustur('span', '', '♪ ');
      nota.setAttribute('aria-hidden', 'true'); // süs; "Çalıyor" metni okunur
      const yazi = t(u.aktifCikis === 'kulaklik' ? 'yuzey.medya.kulaklik' : u.aktifCikis === 'hoparlor' ? 'yuzey.medya.hoparlor' : 'yuzey.medya.caliyor');
      el.medya.replaceChildren(nota, olustur('span', '', yazi));
      el.medya.title = '♪ ' + yazi; // başlık dar kalınca kısalan bilgi fareyle okunur
    } else {
      el.medya.hidden = true;
      el.medya.textContent = '';
      el.medya.title = '';
    }
    seritiCiz();
    bildirimiCiz();
  }

  // ---------------------------------------------------------------- bildirim şeridi (1.4.0)

  function bildirimZamani(zaman) {
    if (!zaman) return '';
    try {
      return new Date(zaman).toLocaleTimeString(Dil.yerelAdi(t.dil), { hour: '2-digit', minute: '2-digit' });
    } catch (hata) {
      return '';
    }
  }

  function bildirimKapat(oge, dugme) {
    if (bildirimBekleyenler.has(oge.anahtar)) return;
    bildirimBekleyenler.add(oge.anahtar);
    dugme.disabled = true;
    const birak = function () {
      bildirimBekleyenler.delete(oge.anahtar);
      dugme.disabled = false;
    };
    kopru.bildirimKapat(oge.anahtar).then(
      function (yanit) {
        birak();
        if (yanit && yanit.ok === true) return; // ana süreç yeni modeli gönderir; öğe listeden kalkar
        ipucuGoster(t(yanit && yanit.tur === 'cok-sik' ? 'yuzey.ipucu.cokSik' : 'yuzey.ipucu.bildirimKapatilamadi'));
      },
      function () {
        birak();
        ipucuGoster(t('yuzey.ipucu.bildirimKapatilamadi'));
      },
    );
  }

  /**
   * Panelin üstündeki bildirim şeridi (rozetli): başlık düğmesi sayıyı ve en yeni bildirimi gösterir, tıklayınca liste açılır; her öğe
   * tek tıkla kapatılır. Metinler yalnız textContent ile yazılır. Süzgeçten geçmeyen bildirimler hiç gelmez, yalnız "N gizlendi" yazılır.
   * Palette şerit yoktur (palet yalnız eylem arar).
   */
  function bildirimiCiz() {
    const b = model.bildirim;
    const gorunur = mod === 'panel' && !!b && (b.ogeler.length > 0 || b.gizlenen > 0);
    el.bildirim.hidden = !gorunur;
    if (!gorunur) {
      // Şerit kalkarken odak kapatılan düğmedeyse içerik alanına geçer (gizlenen öğedeki odak gövdeye düşmesin)
      if (bildirimDugmeleri.indexOf(document.activeElement) >= 0) el.icerik.focus();
      bildirimImzasi = '';
      bildirimDugmeleri = [];
      el.bildirimListe.replaceChildren();
      return;
    }
    const acik = bildirimAcik && b.ogeler.length > 0;
    const imza = JSON.stringify([b, acik, t.dil]);
    if (imza === bildirimImzasi) return;
    bildirimImzasi = imza;
    const eskiOdak = bildirimDugmeleri.indexOf(document.activeElement);

    // başlık düğmesi
    el.bildirimDugme.setAttribute('aria-expanded', acik ? 'true' : 'false');
    el.bildirimDugme.disabled = b.ogeler.length === 0;
    el.bildirimSayi.hidden = b.sayi === 0;
    el.bildirimSayi.textContent = String(b.sayi);
    el.bildirimSayi.setAttribute('aria-label', t(b.sayi === 1 ? 'yuzey.bildirim.sayi.bir' : 'yuzey.bildirim.sayi', { n: b.sayi }));
    el.bildirimOzet.textContent = acik || b.ogeler.length === 0 ? '' : b.ogeler[0].metin;

    // liste
    el.bildirimListe.hidden = !acik;
    const dugmeler = [];
    const satirlar = acik
      ? b.ogeler.map(function (o) {
          const satir = olustur('li', 'bildirim-oge ' + o.kaynak);
          const simge = olustur('span', 'bildirim-simge', o.simge);
          simge.setAttribute('aria-hidden', 'true');
          const govde = olustur('div', 'bildirim-govde');
          const baslik = olustur('div', 'bildirim-oge-baslik', o.baslik);
          const zaman = bildirimZamani(o.zaman);
          if (zaman) baslik.appendChild(olustur('span', 'bildirim-zaman', zaman));
          govde.appendChild(baslik);
          govde.appendChild(olustur('div', 'bildirim-metin', o.metin));
          const kapat = olustur('button', 'bildirim-oge-kapat', '×');
          kapat.type = 'button';
          kapat.setAttribute('aria-label', t('yuzey.bildirim.kapat', { metin: o.metin }));
          kapat.title = t('yuzey.bildirim.kapat', { metin: o.metin });
          kapat.disabled = bildirimBekleyenler.has(o.anahtar);
          kapat.addEventListener('click', function () {
            bildirimKapat(o, kapat);
          });
          dugmeler.push(kapat);
          satir.appendChild(simge);
          satir.appendChild(govde);
          satir.appendChild(kapat);
          return satir;
        })
      : [];
    el.bildirimListe.replaceChildren.apply(el.bildirimListe, satirlar);
    bildirimDugmeleri = dugmeler;

    // "N gizlendi" (Kapı Kuralı süzgecine takılan bildirimler; içerikleri hiçbir yerde yazılmaz)
    el.bildirimGizli.hidden = b.gizlenen === 0;
    el.bildirimGizli.textContent = b.gizlenen > 0 ? t(b.gizlenen === 1 ? 'yuzey.bildirim.gizlendi.bir' : 'yuzey.bildirim.gizlendi', { n: b.gizlenen }) : '';

    // Kapatılan öğenin düğmesi kalktıysa odak sıradaki düğmeye (hiç kalmadıysa başlık düğmesine, o da pasifse içeriğe) geçer
    if (eskiOdak >= 0) {
      const hedef = dugmeler.length > 0 ? dugmeler[Math.min(eskiOdak, dugmeler.length - 1)] : b.ogeler.length > 0 ? el.bildirimDugme : el.icerik;
      hedef.focus();
    }
  }

  /**
   * İçeriğin DOĞAL yüksekliği: üst/alt şeritler (kendi yükseklikleri) + içerik alanının TAM yüksekliği (scrollHeight; pencere
   * küçükse kaydırılan kısım dahil). Pencerenin o anki yüksekliğinden bağımsızdır, bu yüzden pencere hem küçülüp hem büyüyebilir;
   * en büyük yüksekliği yalnız ana süreç sınırlar (yuzeyYuksekligiKirp). Düzen: yuzey.css (.kok yüksekliği pencere kadardır,
   * #icerik büyümez, yalnız küçülür). Çocuk ölçüsü alınamıyorsa kök yüksekliğine düşülür.
   */
  function dogalYukseklik() {
    let toplam = 0;
    Array.from(el.kok.children || []).forEach(function (c) {
      toplam += c === el.icerik ? Math.max(c.scrollHeight || 0, c.offsetHeight || 0) : c.offsetHeight || 0;
    });
    return Math.round(toplam > 0 ? toplam : el.kok.offsetHeight || 0);
  }

  function boyutBildir() {
    const h = dogalYukseklik();
    if (h > 0 && h !== sonBildirilenYukseklik) {
      sonBildirilenYukseklik = h;
      kopru.boyut(h);
    }
  }

  function ciz() {
    if (kartlar) kartlar.sifirla(); // önceki çizimin saniyelik sayaçları (zamanlayıcı, medya ilerlemesi) bırakılır
    if (bilgi) bilgi.ayarla(model.bilgi); // bilgi modeli saklanır, gereken okumalar (geçmiş, takvim, yapılacaklar) istenir
    if (kamera) kamera.ayarla(mod === 'panel' ? model.kamera : null); // palette kamera bölümü yoktur
    ustuCiz();
    if (duzen) duzen.sekmeleriCiz(model); // palet kipinde ya da sayfa yokken gizlenir
    if (eylemBolumu) eylemBolumu.ciz(model.eylem); // alt şerit: "Geri al" düğmesi (o-12)
    if (mod === 'palet') paletCiz();
    else panelCiz();
    setTimeout(boyutBildir, 0);
  }

  function modelUygula(ham) {
    const m = modelDuzelt(ham);
    if (!m) return;
    if (donuk > 0) {
      bekleyenModel = ham; // sürükleme / basılı tutma / basılı fare bitince çizilir
      return;
    }
    // Değişmeyen model DOM'u yeniden kurmaz: aksi halde her olayda klavye odağı başa döner ve basış sırasında yenilenen
    // düğme click üretmezdi. Değişen modelde de odak korunur (panelCiz: odakAnahtari/odagiGeriVer).
    const imza = JSON.stringify(m);
    if (imza === modelImzasi) return;
    model = m;
    modelImzasi = imza;
    ciz();
  }

  // ---------------------------------------------------------------- dil

  /** Çevirmeni yeni dile kurar ve sayfadaki sabit metinleri (data-i18n) çevirir; dinamik metinler çizimle yazılır. @returns {boolean} dil geçerliydi */
  function dilKur(yeniDil) {
    if (Dil.DILLER.indexOf(yeniDil) < 0) return false;
    t = Dil.cevirmen(yeniDil, Sozluk);
    Dil.sayfayiCevir(document, t);
    seritImzasi = ''; // şerit metni dile bağlı: aynı içerik olsa da yeniden kurulsun
    if (duzen) duzen.dilDegisti(); // sekme metinleri yeniden yazılsın
    bildirimImzasi = ''; // bildirim şeridinin etiketleri de dile bağlı
    return true;
  }

  function dilCiz() {
    clearTimeout(ipucuZamanlayicisi);
    el.ipucu.textContent = ''; // eski dildeki ipucu satırı kalmasın
    ciz();
  }

  /** Ana süreç dili değiştirdi (Ayarlar): sayfa yeniden çevrilir ve çizilir; sürükleme / basılı tutma sürüyorsa çizim bitince yapılır. */
  function dilDegisti(yeniDil) {
    if (!dilKur(yeniDil)) return;
    if (donuk > 0) {
      dilCizimiBekliyor = true;
      return;
    }
    dilCiz();
  }

  // Windows 11 malzemesi (gorunum-11): ana süreç etkin malzemeyi bildirir ('acrylic' | 'mica' | 'yok'); CSS yarı saydam yüzeyleri
  // yalnız :root[data-malzeme] varken uygular. 'yok'ta öznitelik kalkar ve opak renkler geçerli olur.
  function malzemeAyarla(deger) {
    const kok = document.documentElement;
    if (!kok || !kok.dataset) return;
    if (deger === 'acrylic' || deger === 'mica') kok.dataset.malzeme = deger;
    else delete kok.dataset.malzeme;
  }

  function kipAyarla(yeni) {
    mod = yeni === 'palet' ? 'palet' : 'panel';
    document.body.className = 'mod-' + mod;
    // Palette içerik alanı bir listbox'tır (arama kutusu combobox; seçili satır aria-activedescendant ile duyurulur, k-16)
    if (mod === 'palet') {
      el.icerik.setAttribute('role', 'listbox');
    } else {
      el.icerik.removeAttribute('role');
      el.icerik.removeAttribute('aria-label');
      el.arama.removeAttribute('aria-activedescendant');
    }
    sonBildirilenYukseklik = 0;
  }

  function gosterildi(yuk) {
    tumTutmalariBirak();
    donuk = 0; // pencere gizlenirken yarım kalan sürükleme/basış ertelemeyi kilitlemesin
    imlecBasili = false;
    bekleyenModel = null;
    dilCizimiBekliyor = false; // aşağıdaki ciz() zaten yeni dille çizer
    gosterimNo += 1;
    bildirimAcik = false; // her gösterimde bildirim listesi kapalı başlar
    bildirimImzasi = '';
    karoKilitleri.clear();
    odakHaritasi = new Map(); // yeni gösterimde eski gösterimin odağı geri verilmez
    panelSatirlari = [];
    if (duzen) duzen.sifirla(); // ayrıntı bölmesi kapanır; seçili sayfa korunur
    malzemeAyarla(yuk && yuk.malzeme);
    kipAyarla(yuk && yuk.mod);
    // Palet "sayfa" satırı (o-24): ana süreç paneli istenen sayfayla açtı; sekme çubuğu panel kipinde yeniden kurulur
    if (duzen && mod === 'panel' && yuk && typeof yuk.sayfa === 'string') duzen.sayfayiAyarla(yuk.sayfa.slice(0, 40));
    etkilesimAyarla(yuk && yuk.etkilesim);
    tekerlek.sifirla();
    bilgiCizimiBekliyor = false;
    odakIstegi = null;
    sorgu = '';
    el.arama.value = '';
    secili = 0;
    seviyeAcik = false;
    digerListe = { durum: 'bos', liste: [], tur: null, zaman: 0 }; // "*" listesi her gösterimde yeniden istenir (ana süreç 2 dk önbellekler)
    digerBekliyor = false;
    el.ipucu.textContent = '';
    if (bilgi) bilgi.gosterildi(); // geçmiş görünümü kapanır, başarısız okumalar yeniden denenir
    ciz();
    if (kamera) kamera.gosterildi(); // eski kareler silinir, görüntüler yeniden bulanık başlar; görünürse ilk kare istenir (yalnız panel kipinde)
    if (mod === 'palet') el.arama.focus();
    else el.icerik.focus();
  }

  // ---------------------------------------------------------------- bağlantılar

  el.arama.addEventListener('input', function () {
    sorgu = el.arama.value;
    secili = 0;
    seviyeAcik = false;
    paletCiz();
    setTimeout(boyutBildir, 0);
  });

  el.arama.addEventListener('keydown', function (olay) {
    if (mod === 'palet') paletTusu(olay);
  });

  function paletTutmasiniBirak() {
    if (paletTutmasi) {
      paletTutmasi.birak();
      paletTutmasi = null;
    }
  }

  el.arama.addEventListener('keyup', function (olay) {
    if (olay.key === 'Enter') paletTutmasiniBirak();
  });

  // Odak arama kutusundan kaçarsa Enter'ın "bırakıldı" (keyup) olayı oraya gelmez: tutma sürüp giderdi.
  el.arama.addEventListener('blur', paletTutmasiniBirak);
  document.addEventListener('keyup', function (olay) {
    if (olay.key === 'Enter') paletTutmasiniBirak();
  });

  document.addEventListener('keydown', function (olay) {
    if (olay.key !== 'Escape') {
      if (mod !== 'panel') return;
      if (duzen && duzen.sekmeTusu(olay, model)) return; // Ctrl+PageUp / Ctrl+PageDown: sayfalar arasında geç (o-24)
      panelGezin(olay); // ok tuşlarıyla ızgara gezintisi (k-09)
      return;
    }
    if (mod === 'panel') {
      olay.preventDefault();
      if (bilgi && bilgi.geriGit()) return; // açık geçmiş görünümü önce kapanır, panel açık kalır
      if (duzen && duzen.ayrintiAcikMi()) duzen.ayrintiKapat(); // önce ayrıntı bölmesi kapanır, ikinci Esc paneli kapatır (o-16)
      else kopru.kapat();
    } else if (olay.target !== el.arama) {
      paletTusu(olay); // odak arama kutusundan kaçtıysa da Esc (önce seviye satırını, sonra paleti) kapatır; arama kutusu kendi keydown'ında işler
    }
  });

  // Palette fare basışı odağı arama kutusundan çalmasın (satıra/boş alana/başlığa tıklamak yazmayı ve Esc'i bozmasın).
  document.addEventListener('mousedown', function (olay) {
    if (mod === 'palet' && olay.target !== el.arama && olay.preventDefault) olay.preventDefault();
  });

  // Fare/dokunma basışı sürerken model çizimi ertelenir (basış sırasında düğme yenilenirse click üretilmez); bırakılınca
  // (belgenin herhangi bir yerinde) tüm basılı tutmalar bırakılır ve bekleyen model çizilir.
  document.addEventListener('pointerdown', function () {
    if (!imlecBasili) {
      imlecBasili = true;
      donukBaslat();
    }
  });
  document.addEventListener('pointerup', imlecBirakildi);
  document.addEventListener('pointercancel', imlecBirakildi);

  window.addEventListener('blur', function () {
    imlecBirakildi();
    paletTutmasiniBirak();
  });
  window.addEventListener('focus', function () {
    if (bilgi) bilgi.odakKazandi(); // pencere yeniden odaklandı: bayat okumalar tazelenir
    if (kamera) kamera.gorunurOldu(); // gösterimde pencere henüz görünür değilse ilk kare burada istenir
  });
  document.addEventListener('visibilitychange', function () {
    if (bilgi && document.hidden !== true) bilgi.odakKazandi(); // pencere görünür oldu (gösterim olayı görünürlükten önce gelmiş olabilir)
    if (kamera) {
      if (document.hidden === true) kamera.gizlendi(); // pencere gizlendi: bellekteki kamera kareleri ve DOM'daki görüntüler silinir
      else kamera.gorunurOldu();
    }
  });

  // Yakınlaştırma (Ctrl + / Ctrl − / Ctrl 0, ana süreçte) pencere genişliğini sınırlayabilir: yükseklik yeniden ölçülür (g-13).
  window.addEventListener('resize', function () {
    setTimeout(boyutBildir, 0);
  });

  el.bildirimDugme.addEventListener('click', function () {
    bildirimAcik = !bildirimAcik;
    bildirimiCiz();
    setTimeout(boyutBildir, 0);
  });

  // o-23: iğne düğmesi paneli sabitler / çözer. Ana süreç ayarı (panelSabit) yazar ve yanıtta son durumu döner; başarısızsa düğme eski hâlinde kalır.
  if (el.sabitle) {
    el.sabitle.addEventListener('click', function () {
      if (typeof kopru.sabitle !== 'function') return;
      const istenen = !etkilesim.sabit;
      Promise.resolve(kopru.sabitle(istenen)).then(
        function (yanit) {
          if (yanit && yanit.ok === true && typeof yanit.sabit === 'boolean') {
            etkilesim = { tekerlek: etkilesim.tekerlek, sabit: yanit.sabit };
            sabitGoster();
          } else {
            ipucuGoster(t('yuzey.sabit.hata'));
          }
        },
        function () {
          ipucuGoster(t('yuzey.sabit.hata'));
        },
      );
    });
    sabitGoster();
  }

  el.haAc.addEventListener('click', function () {
    kopru.haAc();
  });
  el.ayarlarAc.addEventListener('click', function () {
    kopru.ayarlarAc();
  });

  kopru.onDurum(modelUygula);
  kopru.onGoster(gosterildi);
  if (typeof kopru.onEtkilesim === 'function') kopru.onEtkilesim(etkilesimAyarla); // Ayarlar'dan tekerlek / sabitleme değişti
  if (typeof kopru.onDilDegisti === 'function') {
    kopru.onDilDegisti(function (yuk) {
      if (yuk && typeof yuk === 'object') dilDegisti(yuk.dil);
    });
  }

  kopru.durumAl().then(function (yanit) {
    if (!yanit || yanit.ok !== true) return;
    dilKur(yanit.dil); // yanıtta dil yoksa ya da geçersizse Türkçe (HTML varsayılanı) kalır
    malzemeAyarla(yanit.malzeme);
    kipAyarla(yanit.mod);
    etkilesimAyarla(yanit.etkilesim);
    const m = modelDuzelt(yanit.model);
    if (m) {
      model = m;
      modelImzasi = JSON.stringify(m);
    }
    ciz();
  }, function () {
    ipucuGoster(t('yuzey.ipucu.yuklenemedi'));
  });
})();
