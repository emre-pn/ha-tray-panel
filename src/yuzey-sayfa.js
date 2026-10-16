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

  let t = Dil.cevirmen('tr', Sozluk); // HTML varsayılanı Türkçedir; dil durumAl yanıtıyla ya da onDilDegisti ile gelir

  const el = {
    kok: document.getElementById('kok'),
    baglanti: document.getElementById('baglanti'),
    medya: document.getElementById('medya'),
    eski: document.getElementById('eski'),
    serit: document.getElementById('serit'),
    arama: document.getElementById('arama'),
    icerik: document.getElementById('icerik'),
    ipucu: document.getElementById('ipucu'),
    haAc: document.getElementById('haAc'),
    ayarlarAc: document.getElementById('ayarlarAc'),
  };

  const SEVIYELER = [10, 20, 50, 100]; // palet: Shift+Enter ışık seviyeleri
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

  let mod = 'panel';
  let model = { gruplar: [], sonlar: [], ust: { canli: false, baglanti: 'kapali', medyaCaliyor: null, aktifCikis: null, hata: null, uyari: null, anahtarYok: false } };
  let sorgu = '';
  let secili = 0;
  let seviyeAcik = false;
  let seviyeSecili = 0;
  let donuk = 0; // sürüklenen kaydırıcı, basılı tutulan karo ya da basılı fare: bu sürece yeniden çizim ertelenir
  let bekleyenModel = null;
  let modelImzasi = ''; // çizilen modelin JSON'u: değişmeyen model DOM'u yeniden kurmaz (basış/odak kaybolmasın)
  let imlecBasili = false; // herhangi bir fare/dokunma basışı sürüyor (bırakılana kadar yeniden çizim ertelenir)
  let ipucuZamanlayicisi = null;
  let sonBildirilenYukseklik = 0;
  let paletSatirlari = [];
  let seciliSatirKutusu = null; // palet: seçili satırın öğesi (Enter'a basılı tutma dolum çubuğu burada görünür)
  let seritImzasi = ''; // hata/uyarı şeridinin içeriği: değişmeyen şerit yeniden kurulmaz (ekran okuyucu tekrar okumasın)
  let gosterimNo = 0; // pencere her gösterildiğinde artar: eski gösterime ait geç yanıt yeni gösterimi kapatmasın
  let odakHaritasi = new Map(); // panel: odak anahtarı -> öğe (yeniden çizimde odak geri verilir)
  let panelSatirlari = []; // panel: ok tuşu gezintisi için mantıksal satırlar [[öğe, ...], ...] (görsel sırayla)
  const karoKilitleri = new Map(); // kimlik -> { basla, bitis, bekliyor } (h-06)
  const etkinTutmalar = new Set(); // { birak() }
  let tekrarlayicilar = []; // bu çizimdeki ses -/+ tekrarlayıcıları (pencere odağını kaybedince durdurulur)
  let dilCizimiBekliyor = false; // dil, sürükleme / basılı tutma sürerken değişti: bitince yeniden çizilir

  function olustur(etiket, sinif, metin) {
    const oge = document.createElement(etiket);
    if (sinif) oge.className = sinif;
    if (metin !== undefined && metin !== null) oge.textContent = String(metin);
    return oge;
  }

  function sinirliMetin(deger, sinir) {
    return String(deger === undefined || deger === null ? '' : deger).slice(0, sinir || 80);
  }

  function ilkHarfBuyuk(metin) {
    const harfler = Array.from(String(metin));
    if (harfler.length === 0) return '';
    // Türkçede i -> İ, ı -> I; İngilizcede i -> I olmalı (yoksa "invalid" "İnvalid" olurdu)
    return harfler[0].toLocaleUpperCase(t.dil === 'en' ? 'en-US' : 'tr-TR') + harfler.slice(1).join('');
  }

  // ---------------------------------------------------------------- model

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
      };
    };
    const gruplar = ham.gruplar
      .map(function (g) {
        return { kod: sinirliMetin(g && g.kod, 20), etiket: sinirliMetin(g && g.etiket, 30), karolar: Array.isArray(g && g.karolar) ? g.karolar.map(karoDuzelt).filter(Boolean) : [] };
      })
      .filter(function (g) {
        return g.karolar.length > 0;
      });
    const sonlar = (Array.isArray(ham.sonlar) ? ham.sonlar : []).map(karoDuzelt).filter(Boolean);
    const u = ham.ust && typeof ham.ust === 'object' ? ham.ust : {};
    return {
      gruplar: gruplar,
      sonlar: sonlar,
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

  /** Başarı: karoda 1 sn yeşil çerçeve (g-08). */
  function basariIsaretle(oge) {
    if (!oge || !oge.classList) return;
    oge.classList.add('basari');
    setTimeout(function () {
      oge.classList.remove('basari');
    }, BASARI_ISARETI_MS);
  }

  /** Kaydırıcının ara değerleri ve basılı tutulan ses -/+ her seferinde "başarı" yanıp sönmesin. */
  function basariGosterilmeli(karo, yuk) {
    if (!karo || karo.tekrar) return false;
    if (yuk && yuk.araDeger === true) return false; // 1.4.0: kaydırıcı / ± ara değerleri (ses, sıcaklık, sayı)
    return !(yuk && yuk.parlaklik !== undefined && yuk.sonDeger !== true);
  }

  function sonucIsle(sonuc, karo, oge, yuk) {
    if (sonuc && sonuc.ok === true) {
      if (basariGosterilmeli(karo, yuk)) basariIsaretle(oge);
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

  function calistir(yuk, karo, oge) {
    return kopru.calistir(yuk).then(
      function (sonuc) {
        sonucIsle(sonuc, karo, oge, yuk);
        return sonuc;
      },
      function () {
        hataIsaretle(oge);
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

  function isikKarosu(karo) {
    const kutu = olustur('div', 'isik-karo');
    const ana = karoDugmesi(karo);
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
    const kisici = Kaydirici.kisici(function (deger, son) {
      calistir({ kimlik: karo.id, parlaklik: deger, sonDeger: son === true }, karo, aralik);
    });
    let suruklemede = false;
    aralik.addEventListener('input', function () {
      if (!suruklemede) {
        suruklemede = true;
        donukBaslat();
      }
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
    const renkler = kartlar ? kartlar.isikRengi(karo) : null; // 1.4.0 (o-02): beyaz tonu + renk paleti; cihaz renk desteklemiyorsa null
    if (renkler) kutu.appendChild(renkler);
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

  function panelCiz() {
    const oncekiOdak = odakAnahtari();
    const kaydirma = el.icerik.scrollTop;
    tekrarlayicilar = [];
    odakHaritasi = new Map();
    panelSatirlari = [];
    const parcalar = [];
    const son = sonSatiri();
    if (son) parcalar.push(son);
    model.gruplar.forEach(function (g) {
      const bolum = olustur('section', 'bolum grup-' + g.kod);
      bolum.appendChild(olustur('h2', 'bolum-baslik', g.etiket));
      grupSatirlari(g).forEach(function (satir) {
        const izgara = olustur('div', 'izgara' + (satir.ad ? ' alt-' + satir.ad : ''));
        let bekleyen = []; // ızgarada aynı görsel satıra düşecek karolar (ışık karosu tam genişlik: satırı böler)
        const bosalt = function () {
          if (bekleyen.length > 0) panelSatirlari.push(bekleyen);
          bekleyen = [];
        };
        satir.karolar.forEach(function (karo) {
          if (karo.parlaklikKontrol) {
            bosalt();
            izgara.appendChild(isikKarosu(karo));
          } else if (kartlar && kartlar.kartMi(karo)) {
            bosalt(); // kart tam genişliktedir: satırı böler (ışık karosu gibi)
            const kart = kartlar.kartCiz(karo);
            if (kart) izgara.appendChild(kart);
          } else {
            const d = karoDugmesi(karo);
            izgara.appendChild(d);
            bekleyen.push(d);
            if (bekleyen.length === IZGARA_KOLON) bosalt();
          }
        });
        bosalt();
        bolum.appendChild(izgara);
      });
      parcalar.push(bolum);
    });
    if (parcalar.length === 0) parcalar.push(bosDurum());
    el.icerik.replaceChildren.apply(el.icerik, parcalar);
    if (typeof kaydirma === 'number') el.icerik.scrollTop = kaydirma;
    odagiGeriVer(oncekiOdak);
  }

  // ---------------------------------------------------------------- palet

  function paletOgeleri() {
    return tumKarolar().map(function (karo) {
      const sonSira = model.sonlar.findIndex(function (s) {
        return s.id === karo.id;
      });
      // alan + ozellik: servis komutları ("klima 24", "masa sicak", "tv ses 30") cihazın kendi listelerine / aralığına göre çözülür (lib/arama.js alanKomutu)
      return { etiket: karo.etiket, grupEtiketi: karo.grupEtiketi, parlaklikKontrol: karo.parlaklikKontrol, sonSira: sonSira, alan: karo.alan, ozellik: karo.ozellik, karo: karo };
    });
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

  /** Boş sorguda son kullanılanlar (en çok 5) ve altında kalan bütün favoriler; her bölümün ilk satırı başlık taşır. Aksi halde arama sonuçları. */
  function paletSatirlariniHesapla() {
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
    return {
      baslik: null,
      satirlar: s.sonuclar.slice(0, PALET_SATIR_SINIRI).map(function (r, i) {
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
        };
      }),
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

  function paletCalistir(satir, seviye) {
    const karo = satir.karo;
    const yuk = { kimlik: karo.id };
    const hata = satirKomutHatasi(satir);
    if (hata && (seviye === undefined || seviye === null)) {
      // Komut tanındı ama bu cihazda geçerli değil: hiçbir şey gönderilmez, nedeni söylenir.
      ipucuGoster(t(hata === 'sinir' ? 'yuzey.ipucu.komutSinirDisi' : 'yuzey.ipucu.komutDesteklenmiyor', { etiket: karo.etiket }));
      return;
    }
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
    if (paletSatirlari.length === 0) parcalar.push(sorgu.trim() === '' ? bosDurum() : olustur('p', 'bos', t('yuzey.palet.eslesmeYok')));
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
      kutu.appendChild(vurguluEtiket(karo.etiket, satir.konumlar));
      if (satir.parlaklik !== null && karo.parlaklikKontrol) kutu.appendChild(olustur('span', 'rozet', t('yuzey.yuzde', { n: satir.parlaklik })));
      if (satir.kapat && karo.parlaklikKontrol) kutu.appendChild(olustur('span', 'rozet', t('yuzey.rozet.kapat')));
      // 1.4.0 servis komutu: rozet ne yapılacağını söyler ("24°", "Sıcak beyaz · 2700 K", "Ses %30"); geçersizse nedenini
      const komutRozeti = satir.eylem && kartlar ? kartlar.rozetMetni(satir.eylem) : '';
      if (komutRozeti !== '') kutu.appendChild(olustur('span', 'rozet', komutRozeti));
      if (komutHatasi) kutu.appendChild(olustur('span', 'rozet sessiz', t(komutHatasi === 'sinir' ? 'yuzey.rozet.sinirDisi' : 'yuzey.rozet.desteklenmiyor')));
      else if (satir.desteklenmiyor) kutu.appendChild(olustur('span', 'rozet sessiz', t('yuzey.rozet.desteklenmiyor')));
      if (!satir.eylem && !komutHatasi && karo.varsayilanEylem === false && kartlar && kartlar.komutluMu(karo) && satir.parlaklik === null && !satir.kapat) {
        kutu.appendChild(olustur('span', 'rozet sessiz', kartlar.ornek(karo))); // eylemi olmayan karo: nasıl komut verileceği
      }
      if (onayli) kutu.appendChild(olustur('span', 'rozet uyari', t('yuzey.rozet.basiliTut')));
      kutu.appendChild(olustur('span', 'palet-grup', karo.grupEtiketi));
      kutu.appendChild(olustur('span', 'palet-durum', durumMetni(karo)));
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
        seviyeSecili = (seviyeSecili + (olay.key === 'ArrowRight' ? 1 : -1) + SEVIYELER.length) % SEVIYELER.length;
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
          if (satir.karo.parlaklikKontrol) {
            seviyeAcik = !seviyeAcik;
            seviyeSecili = 0;
            paletCiz();
          }
          return;
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
    ustuCiz();
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
    karoKilitleri.clear();
    odakHaritasi = new Map(); // yeni gösterimde eski gösterimin odağı geri verilmez
    panelSatirlari = [];
    malzemeAyarla(yuk && yuk.malzeme);
    kipAyarla(yuk && yuk.mod);
    sorgu = '';
    el.arama.value = '';
    secili = 0;
    seviyeAcik = false;
    el.ipucu.textContent = '';
    ciz();
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
      if (mod === 'panel') panelGezin(olay); // ok tuşlarıyla ızgara gezintisi (k-09)
      return;
    }
    if (mod === 'panel') {
      olay.preventDefault();
      kopru.kapat();
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

  // Yakınlaştırma (Ctrl + / Ctrl − / Ctrl 0, ana süreçte) pencere genişliğini sınırlayabilir: yükseklik yeniden ölçülür (g-13).
  window.addEventListener('resize', function () {
    setTimeout(boyutBildir, 0);
  });

  el.haAc.addEventListener('click', function () {
    kopru.haAc();
  });
  el.ayarlarAc.addEventListener('click', function () {
    kopru.ayarlarAc();
  });

  kopru.onDurum(modelUygula);
  kopru.onGoster(gosterildi);
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
