/*
 * Hızlı panelin cihaz kartları (renderer; 1.4.0): klima / termostat (o-01), ışık rengi (o-02), medya oynatıcı (o-03), vantilatör hızı,
 * nem alıcı hedefi ve süpürge (o-05), seçici / sayı / zamanlayıcı (o-06). Köprü yok: bu betik yalnız yuzey-sayfa.js'in verdiği
 * `baglam` işlevleriyle konuşur (calistir, basili tutma, odak, çizim dondurma); ana sürece kendisi hiçbir şey göndermez.
 *  - 1.4.0 cihaz grubu: perde / jaluzi (cover; aç, dur, kapat, konum kaydırıcısı: tek tıklama), vana (valve) ve otomasyon (automation):
 *    ikisinin de HER servisi ana süreçte ZORUNLU onaylıdır (onayliServisler), bu yüzden düğmeleri ~0,8 sn BASILI TUTMAYLA çalışır.
 *
 *  - Tüm metin textContent ile yazılır (HTML olarak yorumlanan atama yok); dinamik stil yok (renk düğmeleri CSS sınıfıdır).
 *  - Karo verisi `karo.ozellik` (src/lib/varlik-ozellik.js güvenli alt kümesi) ve `karo.onayliServisler`dir. Bu sayfa bir eylemi
 *    ASLA kendi başına "onaylı" sayamaz: onay isteyen her servis (`onayliServisler`) ~0,8 sn BASILI TUTMAYLA istenir; onayı
 *    ana sürecin kendi saati verir. Sınır / adım / izin listesi denetimi ana süreçteki eylem hattındadır (servis-izinleri.js);
 *    buradaki sınırlar yalnız düğmeleri anlamlı tutar.
 *  - Sözlük: lib/arama.js alanKomutu (palet ve komut satırıyla AYNI komut sözlüğü). Beyaz tonu ve renk paleti buradan gelir.
 *  - Kaydırıcı / adım düğmeleri: lib/kaydirici.js kisici (en çok 200 ms'de bir ara değer, bırakınca son değer).
 *  - yuzey-sayfa.js bu dosya yoksa da çalışır (kartlar o zaman düz karo olarak çizilir).
 */
(function () {
  'use strict';

  const Arama = window.EvArama;
  const Kaydirici = window.EvKaydirici;
  const Dil = window.EvDil || null;
  if (!Arama || !Kaydirici) return;

  // Her zaman kart olarak çizilen alanlar (tek tıklama eylemi yok). Vantilatör, nem alıcı ve ışık yalnız kendi denetimi varsa kart olur.
  const KART_ALANLARI = ['climate', 'media_player', 'vacuum', 'input_select', 'select', 'input_number', 'number', 'timer', 'cover', 'valve', 'automation'];
  const KAPAK_DURUMLARI = ['open', 'closed', 'opening', 'closing']; // cover / valve durumu
  const KAPAK_ACIK_DURUMLARI = ['open', 'opening'];
  // supported_features bitleri (cover ve valve aynı): 1 aç, 2 kapat, 4 konum, 8 dur. Bilinmiyorsa (destek null) bütün düğmeler görünür.
  const DESTEK_AC = 1;
  const DESTEK_KAPAT = 2;
  const DESTEK_KONUM = 4;
  const DESTEK_DUR = 8;
  const ARTIM_BEKLEME_MS = 400; // ± düğmelerine art arda basış tek gönderimde birleşir
  const UYGULA_OMRU_MS = 15000; // onay bekleyen yerel değer (basılı tutup uygulanmazsa geri alınır)
  const SAYAC_MS = 1000;
  const SES_ADIMI = 5;
  const DESTEK_ATLA = 2; // media_player supported_features: konum atlama (SEEK)
  const ATLAMA_SANIYE = 10;
  // vacuum supported_features bitleri (cihaz bit alanını bildirmiyorsa eski üç düğme görünür; durdur yalnız AÇIKÇA desteklenirse)
  const SUPURGE_ACIK = 1;
  const SUPURGE_DURAKLAT = 4;
  const SUPURGE_DURDUR = 8;
  const SUPURGE_SARJ = 16;
  const SUPURGE_BASLAT = 8192;
  const BEYAZ_SIRASI = ['sicak', 'dogal', 'soguk'];
  const RENK_SIRASI = ['kirmizi', 'turuncu', 'sari', 'yesil', 'turkuaz', 'mavi', 'mor', 'pembe'];
  const ISIK_RENK_MODLARI = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
  const BEYAZ_YAKINLIGI_K = 500; // mevcut renk sıcaklığı bir ön ayara bu kadar yakınsa o düğme vurgulanır
  const HVAC_EYLEMLERI = ['heating', 'cooling', 'drying', 'idle', 'fan'];
  const MEDYA_DURUMLARI = ['off', 'on', 'idle', 'playing', 'paused', 'standby', 'buffering'];
  const SUPURGE_DURUMLARI = ['cleaning', 'docked', 'returning', 'paused', 'idle', 'error'];
  const ZAMANLAYICI_DURUMLARI = ['idle', 'active', 'paused'];
  const HVAC_MODLARI = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
  const ORNEK_ALANLARI = ['media_player', 'fan', 'humidifier', 'vacuum', 'timer', 'light', 'cover', 'valve']; // yuzey.ornek.<alan> sözlük satırı olan alanlar

  // ---------------------------------------------------------------- model ve ortak yardımcılar (bağlamdan bağımsız)

  // Karo özniteliklerinin renderer'daki tür tablosu (src/lib/varlik-ozellik.js modelleri). n: sayı, s: kısa metin, b: mantıksal,
  // l: metin listesi, x: sayı ya da metin, r: [r, g, b]. Tabloda olmayan anahtar atılır; tür tutmayan değer null olur.
  const OZELLIK_TURLERI = Object.freeze({
    renkSicakligi: 'n', enAzKelvin: 'n', enCokKelvin: 'n', rgb: 'r', renkModlari: 'l',
    yuzde: 'n', adimYuzde: 'n', salinim: 'b', onAyar: 's', onAyarlar: 'l',
    mevcutSicaklik: 'n', hedefSicaklik: 'n', hedefAlt: 'n', hedefUst: 'n', enAz: 'n', enCok: 'n', adim: 'n', mod: 's', modlar: 'l', hvacEylemi: 's', mevcutNem: 'n', fanModu: 's', fanModlari: 'l',
    durum: 's', baslik: 's', sanatci: 's', album: 's', ses: 'n', sessiz: 'b', kaynak: 's', kaynaklar: 'l', sure: 'x', konum: 'n', konumZamani: 's', kapak: 'b', kapakAnahtari: 's',
    hedefNem: 'n', pil: 'n', secenek: 's', secenekler: 'l', deger: 'x', birim: 's', kip: 's', kalan: 's', bitis: 's',
    acikSayisi: 'n', sayi: 'n', sinif: 's', durumSinifi: 's', hassasiyet: 'n', acik: 'b',
    sicaklik: 'n', nem: 'n', ruzgar: 'n', ruzgarBirim: 's', basinc: 'n', mesgul: 'b',
    destek: 'n', sonTetik: 's', // 1.4.0 cihaz grubu: supported_features bit alanı, otomasyonun son çalışma zamanı (ISO)
  });
  const METIN_SINIRI = 120;
  const LISTE_SINIRI = 100;
  const KAPAK_ADRESI = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const KAPAK_EN_UZUN = 900000; // 600 KB resmin base64 hâli ~800 KB
  const KAPAK_YENIDEN_MS = 60000; // alınamayan kapak bu sürede yeniden istenmez
  const KAPAK_EN_COK = 6;

  function ozellikDegeri(tur, ham) {
    switch (tur) {
      case 'n':
        return typeof ham === 'number' && isFinite(ham) ? ham : null;
      case 's':
        return typeof ham === 'string' ? ham.slice(0, METIN_SINIRI) : null;
      case 'b':
        return typeof ham === 'boolean' ? ham : null;
      case 'x':
        return typeof ham === 'number' && isFinite(ham) ? ham : typeof ham === 'string' ? ham.slice(0, METIN_SINIRI) : null;
      case 'l':
        return Array.isArray(ham)
          ? ham
              .filter(function (d) {
                return typeof d === 'string';
              })
              .slice(0, LISTE_SINIRI)
              .map(function (d) {
                return d.slice(0, METIN_SINIRI);
              })
          : [];
      case 'r':
        return Array.isArray(ham) && ham.length === 3 && ham.every(function (d) { return typeof d === 'number' && d >= 0 && d <= 255; }) ? ham.slice() : null;
      default:
        return null;
    }
  }

  /** Ana süreçten gelen `ozellik` savunmacı kopyalanır (bilinen anahtarlar, doğru türde); yoksa ya da nesne değilse null. */
  function ozellikDuzelt(ham) {
    if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
    const sonuc = {};
    Object.keys(OZELLIK_TURLERI).forEach(function (anahtar) {
      if (Object.prototype.hasOwnProperty.call(ham, anahtar)) sonuc[anahtar] = ozellikDegeri(OZELLIK_TURLERI[anahtar], ham[anahtar]);
    });
    return sonuc;
  }

  /** `onayliServisler`: yalnız kısa servis adları. */
  function servisListesiDuzelt(ham) {
    return Array.isArray(ham)
      ? ham
          .filter(function (d) {
            return typeof d === 'string' && /^[a-z_]{1,40}$/.test(d);
          })
          .slice(0, 40)
      : [];
  }

  function ozellikAl(karo) {
    return karo && karo.ozellik && typeof karo.ozellik === 'object' ? karo.ozellik : {};
  }

  const listeAl = function (d) {
    return Array.isArray(d) ? d : [];
  };
  const sayiMi = function (d) {
    return typeof d === 'number' && isFinite(d);
  };
  /** supported_features biti var mı? Bit alanı bilinmiyorsa (null) düğme görünür; cihaz reddederse hata kutusu çıkar. */
  const destekVar = function (oz, bit) {
    return !Number.isInteger(oz.destek) || (oz.destek & bit) !== 0;
  };

  /** Bu karo, panelde kendi denetim kartıyla çizilir mi? */
  function kartMi(karo) {
    if (!karo) return false;
    if (KART_ALANLARI.indexOf(karo.alan) >= 0) return true;
    const oz = ozellikAl(karo);
    if (karo.alan === 'fan') return sayiMi(oz.adimYuzde) || listeAl(oz.onAyarlar).length > 0;
    if (karo.alan === 'humidifier') return sayiMi(oz.enAz) && sayiMi(oz.enCok);
    return false;
  }

  /** Işık karosunun renk bölümü var mı (beyaz tonu ya da renk paleti)? */
  function isikRengiVarMi(karo) {
    const modlar = listeAl(ozellikAl(karo).renkModlari);
    return karo.alan === 'light' && (modlar.indexOf('color_temp') >= 0 || modlar.some(function (m) { return ISIK_RENK_MODLARI.indexOf(m) >= 0; }));
  }

  function yerelAdi(dil) {
    return Dil ? Dil.yerelAdi(dil) : dil === 'en' ? 'en-US' : 'tr-TR';
  }

  function sayiYaz(n, t) {
    return Number(n).toLocaleString(yerelAdi(t.dil), { maximumFractionDigits: 1 });
  }

  function sinirla(d, alt, ust) {
    return Math.min(ust, Math.max(alt, d));
  }

  /** Düğme artımı: cihazın adımı ≥ 1 ise o, 1'in tam böleni ise 1, değilse adımın kendisi; adım yoksa 1. */
  function artimBul(adim) {
    if (!sayiMi(adim) || adim <= 0) return 1;
    if (adim >= 1) return adim;
    const ters = 1 / adim;
    return Math.abs(ters - Math.round(ters)) < 1e-6 ? 1 : adim;
  }

  /**
   * Cihazın adım ızgarasına hizalar (sıfırdan sayılan katlar; ana süreç yalnız adımın katını kabul eder): 22,5 + 1 ve adım 1 ->
   * 24 (artışta yukarı, azalışta aşağı yuvarlanır). Adım bilinmiyorsa değer aynen kalır.
   */
  function hizala(deger, yon, adim) {
    if (!sayiMi(adim) || adim <= 0) return deger;
    const k = deger / adim;
    if (Math.abs(k - Math.round(k)) < 1e-6) return deger;
    return temizSayi((yon > 0 ? Math.ceil(k) : Math.floor(k)) * adim);
  }

  /** Kayan nokta artığı olmadan: 22 + 0,1 -> 22,1. */
  const temizSayi = function (d) {
    return Number(d.toFixed(4));
  };

  /** "0:05:00" / "1:02:03.5" -> saniye; geçersizse null. */
  function sureSaniye(metin) {
    const e = /^(-?\d{1,4}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(typeof metin === 'string' ? metin : '');
    return e ? Number(e[1]) * 3600 + Number(e[2]) * 60 + Number(e[3]) : null;
  }

  function sureYaz(saniye) {
    const s = Math.max(0, Math.round(saniye));
    const sa = Math.floor(s / 3600);
    const dk = Math.floor((s % 3600) / 60);
    const sn = s % 60;
    const iki = function (n) {
      return n < 10 ? '0' + n : String(n);
    };
    return sa > 0 ? sa + ':' + iki(dk) + ':' + iki(sn) : dk + ':' + iki(sn);
  }

  function zamanMs(metin) {
    const d = typeof metin === 'string' ? Date.parse(metin) : NaN;
    return isFinite(d) ? d : null;
  }

  // ---------------------------------------------------------------- bağlama bağlı kısım

  /**
   * @param {object} b yuzey-sayfa.js'in verdiği işlevler:
   *   olustur(etiket, sinif, metin), ceviri() -> t, calistir(yuk, karo, oge) -> söz, tekIstek(karo, oge, yuk, anahtar),
   *   basiliTutmaOlustur(karo, gorsel, bitti, yukEk) -> { basla, birak } (yukEk işlev olabilir), odakKaydet(anahtar, oge),
   *   satirEkle(ogeler) (ok tuşu gezintisi satırı), donukBaslat(), donukBitir(), temizlikEkle(fn), karoDugmesi(karo),
   *   kapakIste(kimlik) -> Promise<string|null> (isteğe bağlı: medya albüm kapağı `data:` adresi; resmi ana süreç çeker, HA adresi/anahtarı burada yok)
   *   tekerlekBagla(oge, secenek) (o-20, isteğe bağlı: fare tekerleği ±5; yoksa tekerlek özelliği yoktur)
   */
  function kur(b) {
    const olustur = b.olustur;
    const t = function (anahtar, yer) {
      return b.ceviri()(anahtar, yer);
    };
    const dilAl = function () {
      return b.ceviri();
    };
    const bekleyenler = new Map(); // 'kimlik|ad' -> { deger, bitis }: onay bekleyen yerel değer (çizimler arasında korunur)
    const sayaclar = []; // { guncelle() }: saniyede bir tazelenen geri sayım / ilerleme
    const kapaklar = new Map(); // 'kimlik|kapakAnahtari' -> { t, adres }: albüm kapağı önbelleği (adres null: alınamadı, 60 sn sonra yeniden denenir)
    const kapakIstekleri = new Map(); // süren kapak istekleri (aynı kapak için tek istek)
    let sayacZamanlayicisi = null;

    // -- yerel (onay bekleyen) değer

    function bekleyenOku(karo, ad) {
      const anahtar = karo.id + '|' + ad;
      const kayit = bekleyenler.get(anahtar);
      if (!kayit) return null;
      if (kayit.bitis <= Date.now()) {
        bekleyenler.delete(anahtar);
        return null;
      }
      return kayit.deger;
    }
    function bekleyenAyarla(karo, ad, deger) {
      bekleyenler.set(karo.id + '|' + ad, { deger: deger, bitis: Date.now() + UYGULA_OMRU_MS });
    }
    function bekleyenSil(karo, ad) {
      bekleyenler.delete(karo.id + '|' + ad);
    }

    // -- saniyelik sayaç

    function sayacTik() {
      sayacZamanlayicisi = null;
      if (!document.hidden) {
        sayaclar.forEach(function (s) {
          s.guncelle();
        });
      }
      sayacBaslat();
    }
    function sayacBaslat() {
      if (sayacZamanlayicisi === null && sayaclar.length > 0) sayacZamanlayicisi = setTimeout(sayacTik, SAYAC_MS);
    }
    function sayacEkle(guncelle) {
      sayaclar.push({ guncelle: guncelle });
      sayacBaslat();
    }

    /** Her çizimden önce çağrılır: eski çizimin sayaçları bırakılır. */
    function sifirla() {
      sayaclar.length = 0;
      if (sayacZamanlayicisi !== null) clearTimeout(sayacZamanlayicisi);
      sayacZamanlayicisi = null;
    }

    // -- ortak parçalar

    let kartOnayli = false; // bu kartta basılı tutmayla çalışan düğme var mı (kart sonunda tek satır hatırlatma yazılır)
    const onayliMi = function (karo, servis) {
      const evet = listeAl(karo.onayliServisler).indexOf(servis) >= 0;
      if (evet) kartOnayli = true;
      return evet;
    };

    /** Kartta onay isteyen düğme varsa kesikli kenarlı düğmelerin basılı tutulduğunu söyleyen tek satır eklenir. */
    function hatirlatmaEkle(kutu) {
      if (kartOnayli && kutu) kutu.appendChild(olustur('div', 'kart-bilgi', t('yuzey.kart.basiliHatirlat')));
      return kutu;
    }

    function kartKutusu(karo, tur) {
      const kutu = olustur('div', 'kart kart-' + tur + (karo.kullanilabilir ? '' : ' yok'));
      kutu.setAttribute('role', 'group');
      kutu.setAttribute('aria-label', karo.etiket);
      return kutu;
    }

    function baslikSatiri(karo, durum, ek) {
      const satir = olustur('div', 'kart-baslik');
      satir.appendChild(olustur('span', 'kart-etiket', karo.etiket));
      const durumOgesi = olustur('span', 'kart-durum', durum);
      satir.appendChild(durumOgesi);
      if (ek) satir.appendChild(ek);
      return { satir: satir, durum: durumOgesi };
    }

    function satirKutusu(sinif) {
      return olustur('div', 'kart-satir' + (sinif ? ' ' + sinif : ''));
    }

    /** Basılı tutma ile onay (~0,8 sn): düğmeye bağlanır; renderer onayı bildirmez, yalnız "başladı" der (yuzey-sayfa.js). */
    function basiliBagla(dugme, tutma) {
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
    }

    /**
     * Tek servisli düğme. Servis `onayliServisler`deyse basılı tutmayla, değilse tek tıklamayla çalışır.
     * @param {string} ad kararlı anahtar (odak ve çift tıklama kilidi)
     * @param {{metin: string, aria: string, servis: string, veri?: object, vurgu?: boolean, basili?: boolean, pasif?: boolean, sinif?: string}} s
     */
    function eylemDugmesi(karo, ad, s) {
      const onayli = onayliMi(karo, s.servis);
      const dugme = olustur('button', 'kart-dugme' + (s.sinif ? ' ' + s.sinif : '') + (s.vurgu ? ' vurgu' : '') + (onayli ? ' onayli' : ''), s.metin);
      dugme.type = 'button';
      dugme.setAttribute('aria-label', s.aria);
      dugme.title = onayli ? t('yuzey.karo.basiliBaslik', { etiket: s.aria }) : s.aria;
      if (typeof s.basili === 'boolean') dugme.setAttribute('aria-pressed', s.basili ? 'true' : 'false');
      dugme.disabled = s.pasif === true || !karo.kullanilabilir;
      b.odakKaydet('c:' + karo.id + ':' + ad, dugme);
      // s.veriYap verilmişse veri tıklama (ya da basılı tutma) anında hesaplanır (ör. canlı konuma göre atlama)
      const yukAl = function () {
        const yuk = { kimlik: karo.id, servis: s.servis };
        const veri = typeof s.veriYap === 'function' ? s.veriYap() : s.veri;
        if (veri !== undefined) yuk.veri = veri;
        return yuk;
      };
      if (onayli) {
        basiliBagla(dugme, b.basiliTutmaOlustur(karo, dugme, null, typeof s.veriYap === 'function' ? yukAl : yukAl()));
      } else {
        dugme.addEventListener('click', function () {
          b.tekIstek(karo, dugme, yukAl(), ad);
        });
      }
      return dugme;
    }

    /** Birkaç seçenekten biri (ya da hiçbiri) vurgulu düğme satırı. @returns {{satir, dugmeler}} */
    function secenekSatiri(karo, ad, etiket, secenekler) {
      const satir = satirKutusu('kart-secenekler');
      satir.setAttribute('role', 'group');
      satir.setAttribute('aria-label', etiket);
      const dugmeler = secenekler.map(function (s, i) {
        const d = eylemDugmesi(karo, ad + '-' + i, s);
        satir.appendChild(d);
        return d;
      });
      return { satir: satir, dugmeler: dugmeler };
    }

    /**
     * Sayısal denetim: [−] değer [+] ve/veya kaydırıcı. Onay istemeyen serviste ± düğmeleri 400 ms'de birleşip tek gönderim
     * yapar, kaydırıcı sürüklenirken kısılır (araDeger), bırakınca son değer gider. Onay isteyen serviste değişiklik YEREL kalır ve
     * "Uygula" düğmesi ~0,8 sn basılı tutulunca gönderilir (kaydırıcıda basılı tutma uygulanamaz).
     * @param {{servis: string, veriYap: Function, deger: number|null, min: number, max: number, adim: number, artim?: number, hizaAdimi?: number,
     *   adimDugmeleri?: boolean, kaydirici?: boolean, yalnizSon?: boolean, goster: Function, azaltAria: string, artirAria: string, kaydiriciAria?: string, gostergeSinifi?: string}} s
     *   yalnizSon: kaydırıcı sürüklenirken ara değer gönderilmez, yalnız bırakınca son değer gider (perde gibi fiziksel hareket eden cihazlar)
     * @returns {{kok: HTMLElement, dugmeler: HTMLElement[], gosterge: HTMLElement}}
     */
    function sayisalDenetim(karo, ad, s) {
      const onayli = onayliMi(karo, s.servis);
      const kok = satirKutusu('kart-sayisal');
      const dugmeler = [];
      const aralikGecerli = sayiMi(s.min) && sayiMi(s.max) && s.max > s.min;
      const bekleyen = onayli ? bekleyenOku(karo, ad) : null;
      let guncel = bekleyen !== null ? bekleyen : s.deger;
      const kullanilabilir = karo.kullanilabilir && aralikGecerli && sayiMi(s.deger);
      const gosterge = olustur('span', 'kart-deger ' + (s.gostergeSinifi || ''), sayiMi(guncel) ? s.goster(guncel) : '—');
      gosterge.setAttribute('role', 'status');
      let aralik = null;
      let uygula = null;

      const goster = function () {
        gosterge.textContent = sayiMi(guncel) ? s.goster(guncel) : '—';
        if (aralik && sayiMi(guncel)) aralik.value = String(guncel);
      };
      const gonder = function (deger, son, ara) {
        const yuk = { kimlik: karo.id, servis: s.servis, veri: s.veriYap(deger) };
        if (ara) yuk.araDeger = true;
        else if (son) yuk.sonDeger = true;
        return b.calistir(yuk, karo, gosterge).then(function (sonuc) {
          if (!sonuc || sonuc.ok !== true) {
            guncel = s.deger;
            goster();
          }
          return sonuc;
        });
      };
      // ± düğmelerinin birleşik gönderimi
      let zamanlayici = null;
      let donukta = false;
      const planla = function (deger) {
        if (zamanlayici !== null) clearTimeout(zamanlayici);
        if (!donukta) {
          donukta = true;
          b.donukBaslat();
        }
        zamanlayici = setTimeout(function () {
          zamanlayici = null;
          gonder(deger, true, false).then(
            function () {
              donukta = false;
              b.donukBitir();
            },
            function () {
              donukta = false;
              b.donukBitir();
            },
          );
        }, ARTIM_BEKLEME_MS);
      };
      const degistir = function (yeni, kaynak) {
        guncel = yeni;
        goster();
        if (onayli) {
          bekleyenAyarla(karo, ad, yeni);
          if (uygula) uygula.disabled = false;
        } else if (kaynak === 'adim') {
          planla(yeni);
        }
      };

      if (s.adimDugmeleri !== false) {
        const artim = s.artim || artimBul(s.adim);
        const azalt = olustur('button', 'kart-dugme adim', '−');
        const artir = olustur('button', 'kart-dugme adim', '+');
        [[azalt, -1, s.azaltAria, 'azalt'], [artir, 1, s.artirAria, 'artir']].forEach(function (d) {
          const dugme = d[0];
          dugme.type = 'button';
          dugme.setAttribute('aria-label', d[2]);
          dugme.title = d[2];
          dugme.disabled = !kullanilabilir;
          b.odakKaydet('c:' + karo.id + ':' + ad + '-' + d[3], dugme);
          dugme.addEventListener('click', function () {
            if (!sayiMi(guncel)) return;
            const yeni = sinirla(hizala(temizSayi(guncel + d[1] * artim), d[1], s.hizaAdimi), s.min, s.max);
            if (yeni !== guncel) degistir(yeni, 'adim');
          });
          dugmeler.push(dugme);
        });
        kok.appendChild(azalt);
        kok.appendChild(gosterge);
        kok.appendChild(artir);
      } else {
        kok.appendChild(gosterge);
      }

      if (s.kaydirici === true) {
        aralik = document.createElement('input');
        aralik.type = 'range';
        aralik.className = 'kaydirici kart-kaydirici';
        aralik.min = String(s.min);
        aralik.max = String(s.max);
        aralik.step = String(s.adim);
        aralik.value = String(sayiMi(guncel) ? sinirla(guncel, s.min, s.max) : s.min);
        aralik.disabled = !kullanilabilir;
        aralik.setAttribute('aria-label', s.kaydiriciAria || s.azaltAria);
        b.odakKaydet('c:' + karo.id + ':' + ad + '-kaydirici', aralik);
        // Sürüklerken panel yeniden çizilmez (öğe yok olursa sürükleme kopar); bırakınca / odak gidince çözülür.
        let suruklemede = false;
        const suruklemeyiAc = function () {
          if (!suruklemede) {
            suruklemede = true;
            b.donukBaslat();
          }
        };
        const suruklemeyiBitir = function () {
          if (suruklemede) {
            suruklemede = false;
            b.donukBitir();
          }
        };
        if (onayli) {
          // Onay isteyen serviste kaydırıcı yalnız yerel değeri değiştirir; gönderim "Uygula" basılı tutulunca olur.
          aralik.addEventListener('input', function () {
            suruklemeyiAc();
            degistir(Number(aralik.value), 'kaydirici');
          });
          aralik.addEventListener('change', suruklemeyiBitir);
        } else if (s.yalnizSon === true) {
          // Fiziksel hareket eden cihaz (perde): sürüklerken ara değer GÖNDERİLMEZ (motor her ara konuma gitmesin); bırakınca yalnız son değer gider.
          aralik.addEventListener('input', function () {
            guncel = Number(aralik.value);
            goster();
            suruklemeyiAc();
          });
          aralik.addEventListener('change', function () {
            guncel = Number(aralik.value);
            goster();
            gonder(guncel, true, false);
            suruklemeyiBitir();
          });
        } else {
          const kisici = Kaydirici.kisici(function (deger, son) {
            gonder(deger, son === true, son !== true);
          });
          aralik.addEventListener('input', function () {
            guncel = Number(aralik.value);
            goster();
            suruklemeyiAc();
            kisici.cagir(guncel);
          });
          aralik.addEventListener('change', function () {
            kisici.son(Number(aralik.value)); // bırakınca son değer HER ZAMAN ve beklemeden gider
            suruklemeyiBitir();
          });
        }
        b.temizlikEkle(suruklemeyiBitir);
        kok.appendChild(aralik);
      }

      if (onayli) {
        uygula = olustur('button', 'kart-dugme onayli uygula', t('yuzey.kart.uygula'));
        uygula.type = 'button';
        uygula.title = t('yuzey.karo.basiliBaslik', { etiket: karo.etiket });
        uygula.disabled = !kullanilabilir || bekleyen === null;
        b.odakKaydet('c:' + karo.id + ':' + ad + '-uygula', uygula);
        basiliBagla(
          uygula,
          b.basiliTutmaOlustur(
            karo,
            uygula,
            function (sozu) {
              sozu.then(function (sonuc) {
                if (sonuc && sonuc.ok === true) {
                  bekleyenSil(karo, ad);
                  uygula.disabled = true;
                }
              });
            },
            function () {
              return { kimlik: karo.id, servis: s.servis, veri: s.veriYap(guncel), sonDeger: true };
            },
          ),
        );
        kok.appendChild(uygula);
        dugmeler.push(uygula);
      }
      // o-20: fare tekerleği (±5). Yalnız spec tekerlek:true, onay istemeyen servis ve geçerli aralıkta; tekerlek denetimini yuzey-sayfa.js bağlar.
      const tekerlek =
        s.tekerlek === true && !onayli && aralikGecerli
          ? {
              dar: kok,
              kullanilabilir: function () {
                return kullanilabilir && sayiMi(guncel);
              },
              oku: function () {
                return sayiMi(guncel) ? guncel : null;
              },
              enAz: s.min,
              enCok: s.max,
              goster: function (deger) {
                guncel = deger;
                goster();
              },
              gonder: function (deger, son) {
                gonder(deger, son === true, son !== true);
              },
            }
          : null;
      return { kok: kok, dugmeler: dugmeler, gosterge: gosterge, tekerlek: tekerlek };
    }

    /**
     * Açılır liste (<select>): onay istemeyen serviste seçince gider; isteyen serviste seçim YEREL kalır ve "Uygula" basılı tutulunca gider.
     * Liste açıkken (odaktayken) panel yeniden çizilmez (açık liste kapanmasın).
     * @param {{secenekler: string[], secili: string|null, aria: string, servis: string, veriYap: Function, etiketYap?: Function}} s
     */
    function secici(karo, ad, s) {
      const onayli = onayliMi(karo, s.servis);
      const kok = satirKutusu('kart-secici');
      const bekleyen = onayli ? bekleyenOku(karo, ad) : null;
      const secenekler = s.secenekler.slice();
      const gorunen = bekleyen !== null ? bekleyen : s.secili;
      if (gorunen !== null && secenekler.indexOf(gorunen) < 0) secenekler.unshift(gorunen); // listede olmayan geçerli değer de görünsün
      const liste = document.createElement('select');
      liste.className = 'kart-liste';
      liste.setAttribute('aria-label', s.aria);
      secenekler.forEach(function (secenek) {
        const oge = document.createElement('option');
        oge.value = secenek;
        oge.textContent = s.etiketYap ? s.etiketYap(secenek) : secenek;
        liste.appendChild(oge);
      });
      if (gorunen !== null) liste.value = gorunen;
      liste.disabled = !karo.kullanilabilir || s.secenekler.length === 0;
      b.odakKaydet('c:' + karo.id + ':' + ad, liste);
      let donukta = false;
      const donukAc = function () {
        if (!donukta) {
          donukta = true;
          b.donukBaslat();
        }
      };
      const donukKapat = function () {
        if (donukta) {
          donukta = false;
          b.donukBitir();
        }
      };
      liste.addEventListener('focus', donukAc);
      liste.addEventListener('blur', donukKapat);
      b.temizlikEkle(donukKapat);
      let uygula = null;
      liste.addEventListener('change', function () {
        const deger = liste.value;
        if (onayli) {
          bekleyenAyarla(karo, ad, deger);
          if (uygula) uygula.disabled = false;
          return;
        }
        if (deger === s.secili) return;
        donukAc();
        b.calistir({ kimlik: karo.id, servis: s.servis, veri: s.veriYap(deger), sonDeger: true }, karo, liste).then(function (sonuc) {
          if (!sonuc || sonuc.ok !== true) liste.value = s.secili === null ? '' : s.secili;
          donukKapat();
        });
      });
      kok.appendChild(liste);
      const dugmeler = [];
      if (onayli) {
        uygula = olustur('button', 'kart-dugme onayli uygula', t('yuzey.kart.uygula'));
        uygula.type = 'button';
        uygula.title = t('yuzey.karo.basiliBaslik', { etiket: karo.etiket });
        uygula.disabled = !karo.kullanilabilir || bekleyen === null;
        b.odakKaydet('c:' + karo.id + ':' + ad + '-uygula', uygula);
        basiliBagla(
          uygula,
          b.basiliTutmaOlustur(
            karo,
            uygula,
            function (sozu) {
              sozu.then(function (sonuc) {
                if (sonuc && sonuc.ok === true) {
                  bekleyenSil(karo, ad);
                  uygula.disabled = true;
                }
              });
            },
            function () {
              return { kimlik: karo.id, servis: s.servis, veri: s.veriYap(liste.value), sonDeger: true };
            },
          ),
        );
        kok.appendChild(uygula);
        dugmeler.push(uygula);
      }
      return { kok: kok, dugmeler: dugmeler };
    }

    // -- kartlar

    function iklimKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'iklim');
      const acik = oz.mod !== null && oz.mod !== undefined && oz.mod !== 'off';
      const parcalar = [];
      if (oz.mod && HVAC_MODLARI.indexOf(oz.mod) >= 0) parcalar.push(t('yuzey.klima.mod.' + oz.mod));
      if (oz.hvacEylemi && HVAC_EYLEMLERI.indexOf(oz.hvacEylemi) >= 0) parcalar.push(t('yuzey.klima.eylem.' + oz.hvacEylemi));
      const guc = eylemDugmesi(karo, 'guc', {
        metin: '⏻',
        aria: t('yuzey.klima.guc', { etiket: karo.etiket }),
        servis: acik ? 'turn_off' : 'turn_on',
        basili: acik,
        sinif: 'guc',
      });
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : parcalar.join(' · '), guc).satir);

      const hedefVar = sayiMi(oz.hedefSicaklik);
      // Isıt/soğut aralığı (cihaz TARGET_TEMPERATURE_RANGE bildiriyor, tek hedef yok): iki ± denetimi; her gönderim ikisini birlikte yollar.
      const aralikVar = !hedefVar && sayiMi(oz.hedefAlt) && sayiMi(oz.hedefUst) && sayiMi(oz.enAz) && sayiMi(oz.enCok) && destekVar(oz, 2);
      const aralik = aralikVar ? klimaAraligi(karo, oz) : null;
      const denetim = aralik || sayisalDenetim(karo, 'hedef', {
        servis: 'set_temperature',
        veriYap: function (d) {
          return { temperature: d };
        },
        deger: hedefVar ? oz.hedefSicaklik : null,
        min: sayiMi(oz.enAz) ? oz.enAz : 7,
        max: sayiMi(oz.enCok) ? oz.enCok : 35,
        adim: sayiMi(oz.adim) ? oz.adim : 1,
        hizaAdimi: sayiMi(oz.adim) ? oz.adim : 0, // cihaz adım bildiriyorsa düğme artışı o ızgaraya oturur (bildirmiyorsa 0,1'dir)
        goster: function (d) {
          return sayiYaz(d, dilAl()) + '°';
        },
        azaltAria: t('yuzey.klima.azalt', { etiket: karo.etiket }),
        artirAria: t('yuzey.klima.artir', { etiket: karo.etiket }),
        gostergeSinifi: 'buyuk',
      });
      if (!aralik && !hedefVar && sayiMi(oz.hedefAlt) && sayiMi(oz.hedefUst)) {
        denetim.gosterge.textContent = t('yuzey.klima.aralik', { alt: sayiYaz(oz.hedefAlt, dilAl()), ust: sayiYaz(oz.hedefUst, dilAl()) });
      }
      kutu.appendChild(denetim.kok);
      if (sayiMi(oz.mevcutSicaklik)) {
        const ek = t('yuzey.klima.simdi', { n: sayiYaz(oz.mevcutSicaklik, dilAl()) }) + (sayiMi(oz.mevcutNem) ? ' · ' + t('yuzey.klima.nem', { n: Math.round(oz.mevcutNem) }) : '');
        kutu.appendChild(olustur('div', 'kart-bilgi', ek));
      }
      b.satirEkle([guc].concat(denetim.dugmeler));

      const modlar = listeAl(oz.modlar).filter(function (m) {
        return HVAC_MODLARI.indexOf(m) >= 0;
      });
      if (modlar.length > 0) {
        const sira = secenekSatiri(
          karo,
          'mod',
          t('yuzey.klima.modlar', { etiket: karo.etiket }),
          modlar.map(function (m) {
            return {
              metin: t('yuzey.klima.mod.' + m),
              aria: t('yuzey.klima.modAra', { etiket: karo.etiket, mod: t('yuzey.klima.mod.' + m) }),
              servis: 'set_hvac_mode',
              veri: { hvac_mode: m },
              vurgu: m === oz.mod,
              basili: m === oz.mod,
            };
          }),
        );
        kutu.appendChild(sira.satir);
        b.satirEkle(sira.dugmeler);
      }
      // Fan modu ve ön ayar: cihazın kendi listesi (ana süreçte kapı süzgecinden geçmiş); onay istemeyen serviste seçince gider.
      [
        ['fanmodu', oz.fanModlari, oz.fanModu, 8, 'set_fan_mode', 'fan_mode', 'yuzey.klima.fanModu'],
        ['onayar', oz.onAyarlar, oz.onAyar, 16, 'set_preset_mode', 'preset_mode', 'yuzey.klima.onAyar'],
      ].forEach(function (d) {
        const secenekler = listeAl(d[1]);
        if (secenekler.length === 0 || !destekVar(oz, d[3])) return;
        const liste = secici(karo, d[0], {
          secenekler: secenekler,
          secili: typeof d[2] === 'string' && d[2] !== '' ? d[2] : null,
          aria: t(d[6], { etiket: karo.etiket }),
          servis: d[4],
          veriYap: function (deger) {
            const veri = {};
            veri[d[5]] = deger;
            return veri;
          },
        });
        kutu.appendChild(liste.kok);
        if (liste.dugmeler.length > 0) b.satirEkle(liste.dugmeler);
      });
      return kutu;
    }

    /**
     * Isıt/soğut aralığı denetimi: "Isıt 20°" ve "Soğut 24°" için iki ± satırı. Her gönderim iki sınırı BİRLİKTE yollar (HA tek sınır kabul etmez);
     * alt sınır üst sınırın bir adım altına, üst sınır alt sınırın bir adım üstüne çıkamaz (ana süreç de alt < üst kuralını ayrıca uygular).
     * @returns {{kok: HTMLElement, dugmeler: HTMLElement[], gosterge: HTMLElement}}
     */
    function klimaAraligi(karo, oz) {
      const adim = sayiMi(oz.adim) ? oz.adim : 1;
      const simdiki = { alt: oz.hedefAlt, ust: oz.hedefUst };
      const satir = function (ad, anahtar, etiketAnahtar, azaltAnahtar, artirAnahtar, enAz, enCok) {
        return sayisalDenetim(karo, ad, {
          servis: 'set_temperature',
          veriYap: function (d) {
            simdiki[anahtar] = d;
            return { target_temp_low: simdiki.alt, target_temp_high: simdiki.ust };
          },
          deger: simdiki[anahtar],
          min: enAz,
          max: enCok,
          adim: adim,
          hizaAdimi: sayiMi(oz.adim) ? oz.adim : 0,
          goster: function (d) {
            simdiki[anahtar] = d;
            return t(etiketAnahtar, { n: sayiYaz(d, dilAl()) });
          },
          azaltAria: t(azaltAnahtar, { etiket: karo.etiket }),
          artirAria: t(artirAnahtar, { etiket: karo.etiket }),
        });
      };
      const alt = satir('hedef-alt', 'alt', 'yuzey.klima.altDeger', 'yuzey.klima.altAzalt', 'yuzey.klima.altArtir', oz.enAz, Math.min(oz.enCok, oz.hedefUst - adim));
      const ust = satir('hedef-ust', 'ust', 'yuzey.klima.ustDeger', 'yuzey.klima.ustAzalt', 'yuzey.klima.ustArtir', Math.max(oz.enAz, oz.hedefAlt + adim), oz.enCok);
      const kok = olustur('div', 'kart-aralik');
      kok.appendChild(alt.kok);
      kok.appendChild(ust.kok);
      return { kok: kok, dugmeler: alt.dugmeler.concat(ust.dugmeler), gosterge: alt.gosterge };
    }

    function ilerlemeKur(karo, oz) {
      const sure = oz.sure;
      if (!sayiMi(sure) || sure <= 0 || !sayiMi(oz.konum) || (oz.durum !== 'playing' && oz.durum !== 'paused')) return null;
      const cubuk = document.createElement('progress');
      cubuk.className = 'kart-ilerleme';
      cubuk.max = sure;
      cubuk.setAttribute('aria-label', t('yuzey.medya.ilerleme', { etiket: karo.etiket }));
      const baslangic = zamanMs(oz.konumZamani) !== null ? zamanMs(oz.konumZamani) : Date.now();
      const hesapla = function () {
        const gecen = oz.durum === 'playing' ? Math.max(0, (Date.now() - baslangic) / 1000) : 0;
        return sinirla(oz.konum + gecen, 0, sure);
      };
      cubuk.value = hesapla();
      if (oz.durum === 'playing') {
        sayacEkle(function () {
          cubuk.value = hesapla();
        });
      }
      return cubuk;
    }

    /**
     * Albüm kapağı: ana süreç `kapak: true` dediyse küçük bir <img> kurulur, resim gelene kadar gizlidir. Adres yalnız `data:image/(jpeg|png|webp)`
     * olabilir (başka şema ya da büyük metin reddedilir); resim ağdan değil ana süreçten gelen veridir (CSP img-src 'self' data:).
     * Önbellek kapak anahtarına bağlıdır: parça değişince anahtar değişir, yeniden çizimde aynı kapak yeniden istenmez.
     */
    function kapakOgesi(karo, oz) {
      if (oz.kapak !== true || typeof oz.kapakAnahtari !== 'string' || typeof b.kapakIste !== 'function') return null;
      const anahtar = karo.id + '|' + oz.kapakAnahtari;
      const resim = olustur('img', 'kart-kapak');
      resim.alt = '';
      resim.setAttribute('aria-hidden', 'true'); // süs: parça adı yazıyla zaten var
      resim.draggable = false;
      resim.hidden = true;
      const goster = function (adres) {
        if (!adres) return;
        resim.src = adres;
        resim.hidden = false;
      };
      const kayit = kapaklar.get(anahtar);
      if (kayit && (kayit.adres || Date.now() - kayit.t < KAPAK_YENIDEN_MS)) {
        goster(kayit.adres);
        return resim;
      }
      if (!kapakIstekleri.has(anahtar)) {
        const soz = Promise.resolve()
          .then(function () {
            return b.kapakIste(karo.id);
          })
          .then(
            function (adres) {
              return typeof adres === 'string' && adres.length <= KAPAK_EN_UZUN && KAPAK_ADRESI.test(adres) ? adres : null;
            },
            function () {
              return null;
            },
          )
          .then(function (adres) {
            kapakIstekleri.delete(anahtar);
            if (kapaklar.size >= KAPAK_EN_COK && !kapaklar.has(anahtar)) kapaklar.delete(kapaklar.keys().next().value);
            kapaklar.set(anahtar, { t: Date.now(), adres: adres });
            return adres;
          });
        kapakIstekleri.set(anahtar, soz);
      }
      kapakIstekleri.get(anahtar).then(goster);
      return resim;
    }

    function medyaKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'medya');
      const kapali = oz.durum === 'off' || oz.durum === 'standby';
      const durumMetni = karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : MEDYA_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.medya.durum.' + oz.durum) : '';
      const guc = eylemDugmesi(karo, 'guc', {
        metin: '⏻',
        aria: t('yuzey.medya.guc', { etiket: karo.etiket }),
        servis: kapali ? 'turn_on' : 'turn_off',
        basili: !kapali,
        sinif: 'guc',
      });
      kutu.appendChild(baslikSatiri(karo, durumMetni, guc).satir);
      const calan = [oz.baslik, oz.sanatci].filter(function (d) {
        return typeof d === 'string' && d !== '';
      });
      const calanOge = calan.length > 0 ? olustur('div', 'kart-bilgi kart-calan', calan.join(' — ')) : null;
      const kapak = kapakOgesi(karo, oz);
      if (kapak) {
        const ust = olustur('div', 'kart-medya-ust');
        ust.appendChild(kapak);
        if (calanOge) ust.appendChild(calanOge);
        kutu.appendChild(ust);
      } else if (calanOge) {
        kutu.appendChild(calanOge);
      }
      const cubuk = ilerlemeKur(karo, oz);
      if (cubuk) kutu.appendChild(cubuk);
      // Konum atlama: cihaz SEEK bitini AÇIKÇA bildirmeli (bilinmiyorsa düğme çizilmez); hedef canlı konumdan hesaplanır, 0..süre aralığına kırpılır.
      if (cubuk && Number.isInteger(oz.destek) && (oz.destek & DESTEK_ATLA) !== 0) {
        const atla = function (fark) {
          return function () {
            return { seek_position: sinirla(Math.round(Number(cubuk.value) + fark), 0, oz.sure) };
          };
        };
        const atlama = satirKutusu('kart-tasima');
        const geri = eylemDugmesi(karo, 'geri10', { metin: '⏪ 10', aria: t('yuzey.medya.geriAtla', { etiket: karo.etiket }), servis: 'media_seek', veriYap: atla(-ATLAMA_SANIYE) });
        const ileri = eylemDugmesi(karo, 'ileri10', { metin: '10 ⏩', aria: t('yuzey.medya.ileriAtla', { etiket: karo.etiket }), servis: 'media_seek', veriYap: atla(ATLAMA_SANIYE) });
        atlama.appendChild(geri);
        atlama.appendChild(ileri);
        kutu.appendChild(atlama);
        b.satirEkle([geri, ileri]);
      }

      const sessizVar = typeof oz.sessiz === 'boolean';
      const tasima = [
        guc,
        eylemDugmesi(karo, 'onceki', { metin: '⏮', aria: t('yuzey.medya.onceki', { etiket: karo.etiket }), servis: 'media_previous_track' }),
        eylemDugmesi(karo, 'oynat', { metin: '⏯', aria: t('yuzey.medya.oynat', { etiket: karo.etiket }), servis: 'media_play_pause', vurgu: oz.durum === 'playing' }),
        eylemDugmesi(karo, 'sonraki', { metin: '⏭', aria: t('yuzey.medya.sonraki', { etiket: karo.etiket }), servis: 'media_next_track' }),
      ];
      if (sessizVar) {
        tasima.push(
          eylemDugmesi(karo, 'sessiz', {
            metin: oz.sessiz ? '🔇' : '🔊',
            aria: t(oz.sessiz ? 'yuzey.medya.sesiAc' : 'yuzey.medya.sessizAl', { etiket: karo.etiket }),
            servis: 'volume_mute',
            veri: { is_volume_muted: !oz.sessiz },
            basili: oz.sessiz,
          }),
        );
      }
      const sira = satirKutusu('kart-tasima');
      tasima.slice(1).forEach(function (d) {
        sira.appendChild(d);
      });
      kutu.appendChild(sira);
      b.satirEkle(tasima);

      if (sayiMi(oz.ses)) {
        const ses = sayisalDenetim(karo, 'ses', {
          servis: 'volume_set',
          veriYap: function (d) {
            return { volume_level: Number((d / 100).toFixed(2)) };
          },
          deger: Math.round(oz.ses * 100),
          min: 0,
          max: 100,
          adim: SES_ADIMI,
          adimDugmeleri: false,
          kaydirici: true,
          tekerlek: true,
          goster: function (d) {
            return t('yuzey.yuzde', { n: Math.round(d) });
          },
          azaltAria: t('yuzey.medya.ses', { etiket: karo.etiket }),
          artirAria: t('yuzey.medya.ses', { etiket: karo.etiket }),
          kaydiriciAria: t('yuzey.medya.ses', { etiket: karo.etiket }),
        });
        kutu.appendChild(ses.kok);
        if (ses.dugmeler.length > 0) b.satirEkle(ses.dugmeler);
        if (ses.tekerlek && typeof b.tekerlekBagla === 'function') b.tekerlekBagla(kutu, ses.tekerlek); // o-20: kartın üstünde tekerlek sesi ±5 değiştirir
      }
      const kaynaklar = listeAl(oz.kaynaklar);
      if (kaynaklar.length > 0) {
        const kaynak = secici(karo, 'kaynak', {
          secenekler: kaynaklar,
          secili: typeof oz.kaynak === 'string' && oz.kaynak !== '' ? oz.kaynak : null,
          aria: t('yuzey.medya.kaynak', { etiket: karo.etiket }),
          servis: 'select_source',
          veriYap: function (d) {
            return { source: d };
          },
        });
        kutu.appendChild(kaynak.kok);
        if (kaynak.dugmeler.length > 0) b.satirEkle(kaynak.dugmeler);
      }
      return kutu;
    }

    function supurgeKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'supurge');
      const parcalar = [];
      if (SUPURGE_DURUMLARI.indexOf(oz.durum) >= 0) parcalar.push(t('yuzey.supurge.durum.' + oz.durum));
      if (sayiMi(oz.pil)) parcalar.push(t('yuzey.supurge.pil', { n: Math.round(oz.pil) }));
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : parcalar.join(' · ')).satir);
      // Yalnız cihazın desteklediği işlemler çizilir (supported_features); bit alanı bilinmiyorsa eski üç düğme kalır.
      const bilinen = Number.isInteger(oz.destek);
      const destekli = function (bit) {
        return bilinen && (oz.destek & bit) !== 0;
      };
      const islemler = [];
      if (!bilinen || destekli(SUPURGE_BASLAT)) islemler.push({ metin: t('yuzey.supurge.basla'), aria: t('yuzey.supurge.baslaAra', { etiket: karo.etiket }), servis: 'start', vurgu: oz.durum === 'cleaning' });
      else if (destekli(SUPURGE_ACIK)) islemler.push({ metin: t('yuzey.supurge.basla'), aria: t('yuzey.supurge.baslaAra', { etiket: karo.etiket }), servis: 'turn_on', vurgu: oz.durum === 'cleaning' });
      if (!bilinen || destekli(SUPURGE_DURAKLAT)) islemler.push({ metin: t('yuzey.supurge.duraklat'), aria: t('yuzey.supurge.duraklatAra', { etiket: karo.etiket }), servis: 'pause', vurgu: oz.durum === 'paused' });
      if (destekli(SUPURGE_DURDUR)) islemler.push({ metin: t('yuzey.supurge.durdur'), aria: t('yuzey.supurge.durdurAra', { etiket: karo.etiket }), servis: 'stop' });
      if (!bilinen || destekli(SUPURGE_SARJ)) islemler.push({ metin: t('yuzey.supurge.sarj'), aria: t('yuzey.supurge.sarjAra', { etiket: karo.etiket }), servis: 'return_to_base', vurgu: oz.durum === 'returning' });
      if (islemler.length > 0) {
        const sira = secenekSatiri(karo, 'islem', t('yuzey.supurge.islemler', { etiket: karo.etiket }), islemler);
        kutu.appendChild(sira.satir);
        b.satirEkle(sira.dugmeler);
      }
      return kutu;
    }

    function secimKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'secim');
      const secenekler = listeAl(oz.secenekler);
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : typeof oz.secenek === 'string' ? oz.secenek : '').satir);
      if (secenekler.length === 0) {
        kutu.appendChild(olustur('div', 'kart-bilgi', t('yuzey.secim.bos')));
        return kutu;
      }
      const s = secici(karo, 'secim', {
        secenekler: secenekler,
        secili: typeof oz.secenek === 'string' && oz.secenek !== '' ? oz.secenek : null,
        aria: t('yuzey.secim.etiket', { etiket: karo.etiket }),
        servis: 'select_option',
        veriYap: function (d) {
          return { option: d };
        },
      });
      kutu.appendChild(s.kok);
      if (s.dugmeler.length > 0) b.satirEkle(s.dugmeler);
      return kutu;
    }

    function sayiKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'sayi');
      const birim = typeof oz.birim === 'string' && oz.birim !== '' ? ' ' + oz.birim : '';
      const goster = function (d) {
        return sayiYaz(d, dilAl()) + birim;
      };
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : sayiMi(oz.deger) ? goster(oz.deger) : '').satir);
      if (!sayiMi(oz.enAz) || !sayiMi(oz.enCok)) {
        kutu.appendChild(olustur('div', 'kart-bilgi', t('yuzey.sayi.sinirYok'))); // sınırı bilinmeyen sayı ayarlanmaz
        return kutu;
      }
      const adim = sayiMi(oz.adim) && oz.adim > 0 ? oz.adim : 1;
      const denetim = sayisalDenetim(karo, 'deger', {
        servis: 'set_value',
        veriYap: function (d) {
          return { value: d };
        },
        deger: sayiMi(oz.deger) ? oz.deger : null,
        min: oz.enAz,
        max: oz.enCok,
        adim: adim,
        artim: adim,
        kaydirici: (oz.enCok - oz.enAz) / adim <= 10000,
        goster: goster,
        azaltAria: t('yuzey.sayi.azalt', { etiket: karo.etiket }),
        artirAria: t('yuzey.sayi.artir', { etiket: karo.etiket }),
        kaydiriciAria: t('yuzey.sayi.deger', { etiket: karo.etiket }),
      });
      kutu.appendChild(denetim.kok);
      b.satirEkle(denetim.dugmeler);
      return kutu;
    }

    /** Zamanlayıcının kalan süresi (saniye): çalışırken bitişe göre, duraklayınca kalana göre, boştayken süreye göre. */
    function zamanlayiciKalan(oz) {
      if (oz.durum === 'active') {
        const bitis = zamanMs(oz.bitis);
        if (bitis !== null) return Math.max(0, (bitis - Date.now()) / 1000);
      }
      const kalan = sureSaniye(oz.kalan);
      if (kalan !== null && oz.durum !== 'idle') return kalan;
      return sureSaniye(oz.sure);
    }

    function zamanlayiciKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'zamanlayici');
      const durumAdi = ZAMANLAYICI_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.zamanlayici.durum.' + oz.durum) : '';
      const metinYap = function () {
        if (karo.ulasilamiyor) return t('yuzey.durum.ulasilamiyor');
        const kalan = zamanlayiciKalan(oz);
        return kalan === null ? durumAdi : durumAdi + ' · ' + sureYaz(kalan);
      };
      const baslik = baslikSatiri(karo, metinYap());
      kutu.appendChild(baslik.satir);
      if (oz.durum === 'active' && zamanMs(oz.bitis) !== null) {
        sayacEkle(function () {
          baslik.durum.textContent = metinYap();
        });
      }
      const sira = secenekSatiri(karo, 'islem', t('yuzey.zamanlayici.islemler', { etiket: karo.etiket }), [
        { metin: t(oz.durum === 'paused' ? 'yuzey.zamanlayici.surdur' : 'yuzey.zamanlayici.basla'), aria: t('yuzey.zamanlayici.baslaAra', { etiket: karo.etiket }), servis: 'start', vurgu: oz.durum === 'active' },
        { metin: t('yuzey.zamanlayici.duraklat'), aria: t('yuzey.zamanlayici.duraklatAra', { etiket: karo.etiket }), servis: 'pause', vurgu: oz.durum === 'paused' },
        { metin: t('yuzey.zamanlayici.iptal'), aria: t('yuzey.zamanlayici.iptalAra', { etiket: karo.etiket }), servis: 'cancel' },
      ]);
      kutu.appendChild(sira.satir);
      b.satirEkle(sira.dugmeler);
      return kutu;
    }

    /** Vantilatör: standart aç/kapat karosu + hız kaydırıcısı + ön ayarlar + salınım. */
    function fanKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'fan');
      const ana = b.karoDugmesi(karo);
      kutu.appendChild(ana);
      b.satirEkle([ana]);
      if (sayiMi(oz.adimYuzde)) {
        const hiz = sayisalDenetim(karo, 'hiz', {
          servis: 'set_percentage',
          veriYap: function (d) {
            return { percentage: Math.round(d) };
          },
          deger: sayiMi(oz.yuzde) ? oz.yuzde : 0,
          min: 0,
          max: 100,
          adim: oz.adimYuzde >= 1 ? Math.round(oz.adimYuzde) : 1,
          adimDugmeleri: false,
          kaydirici: true,
          goster: function (d) {
            return t('yuzey.yuzde', { n: Math.round(d) });
          },
          azaltAria: t('yuzey.fan.hiz', { etiket: karo.etiket }),
          artirAria: t('yuzey.fan.hiz', { etiket: karo.etiket }),
          kaydiriciAria: t('yuzey.fan.hiz', { etiket: karo.etiket }),
        });
        kutu.appendChild(hiz.kok);
        if (hiz.dugmeler.length > 0) b.satirEkle(hiz.dugmeler);
      }
      const secenekler = listeAl(oz.onAyarlar).map(function (a, i) {
        return { metin: a, aria: t('yuzey.fan.onAyarAra', { etiket: karo.etiket, ad: a }), servis: 'set_preset_mode', veri: { preset_mode: a }, vurgu: a === oz.onAyar, basili: a === oz.onAyar, ad: 'onayar-' + i };
      });
      if (typeof oz.salinim === 'boolean') {
        secenekler.push({ metin: t('yuzey.fan.salinim'), aria: t('yuzey.fan.salinimAra', { etiket: karo.etiket }), servis: 'oscillate', veri: { oscillating: !oz.salinim }, vurgu: oz.salinim, basili: oz.salinim });
      }
      if (secenekler.length > 0) {
        const sira = secenekSatiri(karo, 'secenek', t('yuzey.fan.onAyar', { etiket: karo.etiket }), secenekler);
        kutu.appendChild(sira.satir);
        b.satirEkle(sira.dugmeler);
      }
      return kutu;
    }

    /** Nem alıcı: standart aç/kapat karosu + hedef nem kaydırıcısı (cihazın aralığında). */
    function nemKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'nem');
      const ana = b.karoDugmesi(karo);
      kutu.appendChild(ana);
      b.satirEkle([ana]);
      const hedef = sayisalDenetim(karo, 'hedef', {
        servis: 'set_humidity',
        veriYap: function (d) {
          return { humidity: Math.round(d) };
        },
        deger: sayiMi(oz.hedefNem) ? oz.hedefNem : null,
        min: oz.enAz,
        max: oz.enCok,
        adim: 1,
        adimDugmeleri: false,
        kaydirici: true,
        goster: function (d) {
          return t('yuzey.yuzde', { n: Math.round(d) });
        },
        azaltAria: t('yuzey.nem.hedef', { etiket: karo.etiket }),
        artirAria: t('yuzey.nem.hedef', { etiket: karo.etiket }),
        kaydiriciAria: t('yuzey.nem.hedef', { etiket: karo.etiket }),
      });
      kutu.appendChild(hedef.kok);
      if (hedef.dugmeler.length > 0) b.satirEkle(hedef.dugmeler);
      return kutu;
    }

    // -- 1.4.0 cihaz grubu: perde (o-50), vana (o-59), otomasyon (o-49)

    function kapakDurumu(oz) {
      return KAPAK_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.kapak.durum.' + oz.durum) : '';
    }

    /** Perde / jaluzi: aç, dur, kapat (tek tıklama) ve cihaz konum bildiriyorsa kaydırıcı (yalnız bırakınca gider). */
    function perdeKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'perde');
      const parcalar = [kapakDurumu(oz)];
      if (sayiMi(oz.konum)) parcalar.push(t('yuzey.yuzde', { n: Math.round(oz.konum) }));
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : parcalar.filter(Boolean).join(' · ')).satir);
      const dugmeler = [];
      if (destekVar(oz, DESTEK_AC)) dugmeler.push({ metin: t('yuzey.perde.ac'), aria: t('yuzey.perde.acAra', { etiket: karo.etiket }), servis: 'open_cover', vurgu: oz.durum === 'open' || oz.durum === 'opening' });
      if (destekVar(oz, DESTEK_DUR)) dugmeler.push({ metin: t('yuzey.perde.dur'), aria: t('yuzey.perde.durAra', { etiket: karo.etiket }), servis: 'stop_cover' });
      if (destekVar(oz, DESTEK_KAPAT)) dugmeler.push({ metin: t('yuzey.perde.kapat'), aria: t('yuzey.perde.kapatAra', { etiket: karo.etiket }), servis: 'close_cover', vurgu: oz.durum === 'closed' || oz.durum === 'closing' });
      if (dugmeler.length > 0) {
        const sira = secenekSatiri(karo, 'islem', t('yuzey.perde.islemler', { etiket: karo.etiket }), dugmeler);
        kutu.appendChild(sira.satir);
        b.satirEkle(sira.dugmeler);
      }
      if (destekVar(oz, DESTEK_KONUM) && sayiMi(oz.konum)) {
        const konum = sayisalDenetim(karo, 'konum', {
          servis: 'set_cover_position',
          veriYap: function (d) {
            return { position: Math.round(d) };
          },
          deger: oz.konum,
          min: 0,
          max: 100,
          adim: 1,
          adimDugmeleri: false,
          kaydirici: true,
          yalnizSon: true,
          goster: function (d) {
            return t('yuzey.yuzde', { n: Math.round(d) });
          },
          azaltAria: t('yuzey.perde.konum', { etiket: karo.etiket }),
          artirAria: t('yuzey.perde.konum', { etiket: karo.etiket }),
          kaydiriciAria: t('yuzey.perde.konum', { etiket: karo.etiket }),
        });
        kutu.appendChild(konum.kok);
        if (konum.dugmeler.length > 0) b.satirEkle(konum.dugmeler);
      }
      return kutu;
    }

    /** Vana (su / gaz): aç ve kapat; ikisi de ana süreçte zorunlu onaylıdır, yani düğmeler ~0,8 sn basılı tutulur (kart sonunda hatırlatma yazılır). */
    function vanaKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'vana');
      const parcalar = [kapakDurumu(oz)];
      if (sayiMi(oz.konum)) parcalar.push(t('yuzey.yuzde', { n: Math.round(oz.konum) }));
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : parcalar.filter(Boolean).join(' · ')).satir);
      const dugmeler = [];
      if (destekVar(oz, DESTEK_AC)) dugmeler.push({ metin: t('yuzey.vana.ac'), aria: t('yuzey.vana.acAra', { etiket: karo.etiket }), servis: 'open_valve', vurgu: KAPAK_ACIK_DURUMLARI.indexOf(oz.durum) >= 0 });
      if (destekVar(oz, DESTEK_KAPAT)) dugmeler.push({ metin: t('yuzey.vana.kapat'), aria: t('yuzey.vana.kapatAra', { etiket: karo.etiket }), servis: 'close_valve', vurgu: oz.durum === 'closed' || oz.durum === 'closing' });
      if (dugmeler.length > 0) {
        const sira = secenekSatiri(karo, 'islem', t('yuzey.vana.islemler', { etiket: karo.etiket }), dugmeler);
        kutu.appendChild(sira.satir);
        b.satirEkle(sira.dugmeler);
      }
      return kutu;
    }

    /** "3 saat önce" gibi göreli zaman (Intl.RelativeTimeFormat; arayüz diline göre); çözülemezse boş. */
    function goreceZaman(iso) {
      const ms = zamanMs(iso);
      if (ms === null) return '';
      const saniye = Math.round((ms - Date.now()) / 1000);
      const mutlak = Math.abs(saniye);
      const birim = mutlak < 60 ? 'second' : mutlak < 3600 ? 'minute' : mutlak < 86400 ? 'hour' : 'day';
      const bolen = { second: 1, minute: 60, hour: 3600, day: 86400 }[birim];
      try {
        return new Intl.RelativeTimeFormat(yerelAdi(dilAl().dil), { numeric: 'auto' }).format(Math.round(saniye / bolen), birim);
      } catch (e) {
        return '';
      }
    }

    function otomasyonDurumu(oz) {
      const parcalar = [];
      if (oz.acik === true) parcalar.push(t('yuzey.durum.acik'));
      else if (oz.acik === false) parcalar.push(t('yuzey.durum.kapali'));
      if (typeof oz.sonTetik === 'string' && oz.sonTetik !== '') {
        const zaman = goreceZaman(oz.sonTetik);
        if (zaman !== '') parcalar.push(t('yuzey.otomasyon.son', { zaman: zaman }));
      } else if (oz.sonTetik === null) {
        parcalar.push(t('yuzey.otomasyon.hicCalismadi'));
      }
      return parcalar.join(' · ');
    }

    /** Otomasyon: çalıştır (trigger), aç, kapat (turn_on / turn_off). Üçü de zorunlu onaylıdır: düğmeler ~0,8 sn basılı tutulur. */
    function otomasyonKarti(karo) {
      const oz = ozellikAl(karo);
      const kutu = kartKutusu(karo, 'otomasyon');
      kutu.appendChild(baslikSatiri(karo, karo.ulasilamiyor ? t('yuzey.durum.ulasilamiyor') : otomasyonDurumu(oz)).satir);
      const sira = secenekSatiri(karo, 'islem', t('yuzey.otomasyon.islemler', { etiket: karo.etiket }), [
        { metin: t('yuzey.otomasyon.calistir'), aria: t('yuzey.otomasyon.calistirAra', { etiket: karo.etiket }), servis: 'trigger' },
        { metin: t('yuzey.otomasyon.ac'), aria: t('yuzey.otomasyon.acAra', { etiket: karo.etiket }), servis: 'turn_on', vurgu: oz.acik === true },
        { metin: t('yuzey.otomasyon.kapat'), aria: t('yuzey.otomasyon.kapatAra', { etiket: karo.etiket }), servis: 'turn_off', vurgu: oz.acik === false },
      ]);
      kutu.appendChild(sira.satir);
      b.satirEkle(sira.dugmeler);
      return kutu;
    }

    function kartCiz(karo) {
      kartOnayli = false;
      return hatirlatmaEkle(kartYap(karo));
    }

    function kartYap(karo) {
      switch (karo.alan) {
        case 'climate':
          return iklimKarti(karo);
        case 'media_player':
          return medyaKarti(karo);
        case 'vacuum':
          return supurgeKarti(karo);
        case 'input_select':
        case 'select':
          return secimKarti(karo);
        case 'input_number':
        case 'number':
          return sayiKarti(karo);
        case 'timer':
          return zamanlayiciKarti(karo);
        case 'fan':
          return fanKarti(karo);
        case 'humidifier':
          return nemKarti(karo);
        case 'cover':
          return perdeKarti(karo);
        case 'valve':
          return vanaKarti(karo);
        case 'automation':
          return otomasyonKarti(karo);
        default:
          return null;
      }
    }

    /**
     * Işık karosunun renk bölümü: beyaz tonu (sıcak / doğal / soğuk) ve renk paleti. Cihaz rengi desteklemiyorsa null (bölüm gizli).
     * Servis yükleri palet/komut satırıyla AYNI sözlükten gelir (arama.js alanKomutu): kelvin cihazın aralığına kırpılmış gider.
     */
    function isikRengi(karo) {
      if (!isikRengiVarMi(karo)) return null;
      kartOnayli = false;
      const oz = ozellikAl(karo);
      const modlar = listeAl(oz.renkModlari);
      const kutu = olustur('div', 'kart-renkler');
      if (modlar.indexOf('color_temp') >= 0) {
        const tonlar = BEYAZ_SIRASI.map(function (ton) {
          const k = Arama.alanKomutu(karo, ton);
          const yakin = k && !k.hata && sayiMi(oz.renkSicakligi) && Math.abs(oz.renkSicakligi - k.kelvin) <= BEYAZ_YAKINLIGI_K && karo.durum === 'acik';
          return k && !k.hata
            ? { metin: t('yuzey.isik.' + ton), aria: t('yuzey.isik.tonAra', { etiket: karo.etiket, ad: t('yuzey.isik.' + ton), n: k.kelvin }), servis: k.servis, veri: k.veri, vurgu: !!yakin, ad: 'ton-' + ton }
            : null;
        }).filter(Boolean);
        if (tonlar.length > 0) {
          const sira = secenekSatiri(karo, 'ton', t('yuzey.isik.tonlar', { etiket: karo.etiket }), tonlar);
          sira.satir.className += ' kart-tonlar';
          kutu.appendChild(sira.satir);
          b.satirEkle(sira.dugmeler);
        }
      }
      if (modlar.some(function (m) { return ISIK_RENK_MODLARI.indexOf(m) >= 0; })) {
        const renkler = RENK_SIRASI.map(function (renk) {
          const k = Arama.alanKomutu(karo, renk);
          return k && !k.hata ? { metin: '', aria: t('yuzey.isik.renkAra', { etiket: karo.etiket, ad: t('yuzey.renk.' + renk) }), servis: k.servis, veri: k.veri, sinif: 'kart-renk kart-renk-' + renk, ad: 'renk-' + renk } : null;
        }).filter(Boolean);
        if (renkler.length > 0) {
          const sira = secenekSatiri(karo, 'renk', t('yuzey.isik.renkler', { etiket: karo.etiket }), renkler);
          sira.satir.className += ' kart-palet';
          kutu.appendChild(sira.satir);
          b.satirEkle(sira.dugmeler);
        }
      }
      return kutu.children.length > 0 ? hatirlatmaEkle(kutu) : null;
    }

    // -- palet ve metinler

    /** Karonun kısa durum özeti (palet satırı ve kart); özet yoksa boş metin. */
    function ozet(karo) {
      const oz = karo && karo.ozellik && typeof karo.ozellik === 'object' ? karo.ozellik : null;
      if (!oz) return '';
      const modEtiketi = function (m) {
        return HVAC_MODLARI.indexOf(m) >= 0 ? t('yuzey.klima.mod.' + m) : '';
      };
      switch (karo.alan) {
        case 'climate': {
          if (oz.mod === 'off') return t('yuzey.durum.kapali');
          const hedef = sayiMi(oz.hedefSicaklik) ? sayiYaz(oz.hedefSicaklik, dilAl()) + '°' : '';
          return [modEtiketi(oz.mod), hedef].filter(Boolean).join(' · ');
        }
        case 'media_player':
          if (typeof oz.baslik === 'string' && oz.baslik !== '') return oz.baslik;
          return MEDYA_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.medya.durum.' + oz.durum) : '';
        case 'vacuum':
          return SUPURGE_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.supurge.durum.' + oz.durum) : '';
        case 'input_select':
        case 'select':
          return typeof oz.secenek === 'string' ? oz.secenek : '';
        case 'input_number':
        case 'number':
          return sayiMi(oz.deger) ? sayiYaz(oz.deger, dilAl()) + (typeof oz.birim === 'string' && oz.birim !== '' ? ' ' + oz.birim : '') : '';
        case 'timer': {
          const durum = ZAMANLAYICI_DURUMLARI.indexOf(oz.durum) >= 0 ? t('yuzey.zamanlayici.durum.' + oz.durum) : '';
          const kalan = oz.durum === 'idle' ? null : zamanlayiciKalan(oz);
          return kalan === null ? durum : durum + ' · ' + sureYaz(kalan);
        }
        case 'fan':
          return sayiMi(oz.yuzde) && karo.durum === 'acik' ? t('yuzey.yuzde', { n: Math.round(oz.yuzde) }) : '';
        case 'humidifier':
          return sayiMi(oz.hedefNem) && karo.durum === 'acik' ? t('yuzey.yuzde', { n: Math.round(oz.hedefNem) }) : '';
        case 'cover':
        case 'valve':
          return [kapakDurumu(oz), sayiMi(oz.konum) ? t('yuzey.yuzde', { n: Math.round(oz.konum) }) : ''].filter(Boolean).join(' · ');
        case 'automation':
          return oz.acik === true ? t('yuzey.durum.acik') : oz.acik === false ? t('yuzey.durum.kapali') : '';
        default:
          return '';
      }
    }

    /** Palet satırındaki komut rozeti ("24°", "Sıcak beyaz · 2700 K", "Ses %30"...). */
    function rozetMetni(e) {
      if (!e || typeof e !== 'object') return '';
      switch (e.tur) {
        case 'sicaklik':
          return t('yuzey.rozet.sicaklik', { n: sayiYaz(e.deger, dilAl()) });
        case 'mod':
          return HVAC_MODLARI.indexOf(e.deger) >= 0 ? t('yuzey.klima.mod.' + e.deger) : '';
        case 'kapat':
          return t('yuzey.rozet.kapat');
        case 'ac':
          return t('yuzey.rozet.ac');
        case 'ton':
          return BEYAZ_SIRASI.indexOf(e.deger) >= 0 ? t('yuzey.rozet.ton', { ad: t('yuzey.isik.' + e.deger), n: e.kelvin }) : '';
        case 'kelvin':
          return t('yuzey.rozet.kelvin', { n: e.deger });
        case 'renk':
          return RENK_SIRASI.indexOf(e.deger) >= 0 ? t('yuzey.renk.' + e.deger) : '';
        case 'ses':
          return t('yuzey.rozet.ses', { n: e.deger });
        case 'sessiz':
          return t('yuzey.rozet.sessiz');
        case 'sesli':
          return t('yuzey.rozet.sesli');
        case 'oynat':
          return t('yuzey.rozet.oynat');
        case 'sonraki':
          return t('yuzey.rozet.sonraki');
        case 'onceki':
          return t('yuzey.rozet.onceki');
        case 'kaynak':
          return t('yuzey.rozet.kaynak', { ad: String(e.deger) });
        case 'yuzde':
          return t('yuzey.yuzde', { n: e.deger });
        case 'nem':
          return t('yuzey.rozet.nem', { n: e.deger });
        case 'onAyar':
        case 'secenek':
          return String(e.deger);
        case 'sayi':
          return sayiYaz(e.deger, dilAl());
        case 'basla':
          return t('yuzey.supurge.basla');
        case 'duraklat':
          return t('yuzey.zamanlayici.duraklat');
        case 'sarj':
          return t('yuzey.supurge.sarj');
        case 'iptal':
          return t('yuzey.zamanlayici.iptal');
        case 'dur':
          return t('yuzey.rozet.dur');
        case 'konum':
          return t('yuzey.rozet.konum', { n: e.deger });
        case 'kapak-ac':
          return t('yuzey.rozet.kapakAc');
        case 'kapak-kapat':
          return t('yuzey.rozet.kapakKapat');
        case 'calistir':
          return t('yuzey.rozet.calistir');
        default:
          return '';
      }
    }

    /** Tek tıklama eylemi olmayan karoda palet ipucu için örnek komut ("klima 24"). */
    function ornek(karo) {
      const oz = ozellikAl(karo);
      let ek;
      switch (karo.alan) {
        case 'climate':
          ek = sayiMi(oz.hedefSicaklik) ? sayiYaz(oz.hedefSicaklik, dilAl()) : t('yuzey.ornek.climate');
          break;
        case 'input_select':
        case 'select':
          ek = listeAl(oz.secenekler)[0] || '';
          break;
        case 'input_number':
        case 'number':
          ek = sayiMi(oz.enAz) && sayiMi(oz.enCok) ? sayiYaz((oz.enAz + oz.enCok) / 2, dilAl()) : '';
          break;
        default:
          ek = ORNEK_ALANLARI.indexOf(karo.alan) >= 0 ? t('yuzey.ornek.' + karo.alan) : '';
      }
      return (karo.etiket + ' ' + ek).trim();
    }

    /** Alanın palet / komut satırı komut sözlüğü var mı? (salt okunur sensör, hava durumu... için "komut yazın" ipucu anlamsızdır) */
    function komutluMu(karo) {
      return !!karo && Arama.komutluAlanMi(karo.alan);
    }

    return {
      kartMi: kartMi,
      komutluMu: komutluMu,
      kartCiz: kartCiz,
      isikRengi: isikRengi,
      ozet: ozet,
      rozetMetni: rozetMetni,
      ornek: ornek,
      sifirla: sifirla,
    };
  }

  window.EvKartlar = { kur: kur, ozellikDuzelt: ozellikDuzelt, servisListesiDuzelt: servisListesiDuzelt, kartMi: kartMi, isikRengiVarMi: isikRengiVarMi };
})();
