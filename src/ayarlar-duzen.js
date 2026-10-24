/*
 * Ayarlar sayfasının düzen bölümü (renderer) — 1.4.0 düzen grubu (o-24, o-28, o-30, o-31, o-16).
 * ayarlar.js bu dosyayı `window.EvAyarlarDuzen.kur(ortak)` ile bağlar; yüklenmezse Ayarlar bugünkü gibi çalışır.
 *
 *  - Karo görünümü (o-31): her favori satırında simge (çizgi ikon ya da tek emoji), renk (hazır palet), boyut ve "tepsiye sabitle" (o-16).
 *    Değerler yalnız kaydedilen favori kaydına girer; ana süreç (favoriler.js) yeniden doğrular, geçersiz olan önceki değeri korur.
 *  - Panel sayfaları (o-24): ekle / adlandır / çoğalt / sil / sırala ve sayfaya favori ekle-çıkar-sırala. Taslak genel ayarlarla birlikte
 *    kaydedilir (`sayfalar` alanı); sayfa HİÇBİR ZAMAN yeni bir eylem yolu açmaz, yalnız favorilerin alt kümesidir.
 *  - Sıralama (o-30): favori sırası satırı sürükleyerek ya da ↑ ↓ düğmesindeyken Alt+↑ / Alt+↓ ile değişir; her taşıma ekran okuyucuya
 *    duyurulur (aria-live).
 *  - Düzen geçmişi (o-30): son 20 favori + sayfa düzeni; "Bu düzene dön" ana sürecin yeniden doğrulayarak geri yüklemesini ister.
 *  - Onarım (o-28): HA'da bulunamayan favoriyi aynı türden yeni bir cihaza bağlar (ana süreç yalnız güvenli cihaz listesinden kabul eder).
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  const Gorunum = kok.EvKaroGorunum || null;
  const Islem = kok.EvDuzenIslemleri || null;
  const Dil = kok.EvDil || null;

  const EN_COK_SAYFA = Islem ? Islem.EN_COK_SAYFA : 12;
  const EN_COK_SAYFA_VARLIGI = Islem ? Islem.EN_COK_SAYFA_VARLIGI : 100;
  const SAYFA_AD_SINIRI = Islem ? Islem.SAYFA_AD_SINIRI : 24;
  const EMOJI_SECIMI = 'emoji';
  const SURUKLEME_TURU = 'application/x-ev-paneli-sira';
  const GORUNUM_ALANLARI = ['simge', 'renk', 'boyut', 'tepsi', 'grafikTuru'];
  const VARSAYILAN_GORUNUM = Object.freeze({ simge: '', renk: '', boyut: 'normal', tepsi: false, grafikTuru: 'otomatik', gostergeMin: null, gostergeMax: null });

  // Emoji seçici önerileri (1.4.0): küçük, ev temalı bir liste; adlar arayüz dilindedir (sözlük). Kapı / kilit / anahtar / siren / bariyer / pencere temalı
  // emojiler listede YOKTUR; seçilen değer yine de karo-gorunum.js simgeDuzelt doğrulamasından geçer (Kapı Kuralı sözlükte değil orada).
  const EMOJI_ONERILERI = Object.freeze([
    ['💡', 'ayar.emoji.ampul'],
    ['🕯️', 'ayar.emoji.mum'],
    ['🛋️', 'ayar.emoji.salon'],
    ['🛏️', 'ayar.emoji.yatakOdasi'],
    ['🚿', 'ayar.emoji.dus'],
    ['🛁', 'ayar.emoji.banyo'],
    ['🚽', 'ayar.emoji.tuvalet'],
    ['🍳', 'ayar.emoji.mutfak'],
    ['☕', 'ayar.emoji.kahve'],
    ['🧺', 'ayar.emoji.camasir'],
    ['🧹', 'ayar.emoji.temizlik'],
    ['🤖', 'ayar.emoji.supurge'],
    ['📺', 'ayar.emoji.televizyon'],
    ['🎵', 'ayar.emoji.muzik'],
    ['🔊', 'ayar.emoji.hoparlor'],
    ['🎮', 'ayar.emoji.oyun'],
    ['💻', 'ayar.emoji.dizustu'],
    ['🖥️', 'ayar.emoji.masaustu'],
    ['📱', 'ayar.emoji.telefon'],
    ['🔌', 'ayar.emoji.priz'],
    ['🔋', 'ayar.emoji.pil'],
    ['⚡', 'ayar.emoji.elektrik'],
    ['🌡️', 'ayar.emoji.sicaklik'],
    ['❄️', 'ayar.emoji.soguk'],
    ['🔥', 'ayar.emoji.isitma'],
    ['☀️', 'ayar.emoji.gunes'],
    ['🌙', 'ayar.emoji.gece'],
    ['⭐', 'ayar.emoji.yildiz'],
    ['🌧️', 'ayar.emoji.yagmur'],
    ['💧', 'ayar.emoji.su'],
    ['🌀', 'ayar.emoji.vantilator'],
    ['🪴', 'ayar.emoji.bitki'],
    ['🌳', 'ayar.emoji.bahce'],
    ['🐶', 'ayar.emoji.kopek'],
    ['🐱', 'ayar.emoji.kedi'],
    ['🚗', 'ayar.emoji.araba'],
    ['🧸', 'ayar.emoji.cocukOdasi'],
    ['🏠', 'ayar.emoji.ev'],
    ['🛒', 'ayar.emoji.alisveris'],
    ['📅', 'ayar.emoji.takvim'],
    ['⏰', 'ayar.emoji.calarSaat'],
    ['🎬', 'ayar.emoji.sinema'],
    ['🍿', 'ayar.emoji.filmGecesi'],
    ['🎉', 'ayar.emoji.parti'],
    ['😴', 'ayar.emoji.uyku'],
    ['🌅', 'ayar.emoji.gunDogumu'],
    ['🌆', 'ayar.emoji.aksam'],
    ['🚰', 'ayar.emoji.musluk'],
    ['🎄', 'ayar.emoji.yilbasi'],
    ['🧊', 'ayar.emoji.buz'],
  ]);

  // Sözlük anahtarları (düz tablolar: kullanılmayan / eksik anahtar testlerle yakalanır)
  const RENK_ANAHTARLARI = {
    kirmizi: 'ayar.gorunum.renk.kirmizi',
    turuncu: 'ayar.gorunum.renk.turuncu',
    sari: 'ayar.gorunum.renk.sari',
    yesil: 'ayar.gorunum.renk.yesil',
    turkuaz: 'ayar.gorunum.renk.turkuaz',
    mavi: 'ayar.gorunum.renk.mavi',
    mor: 'ayar.gorunum.renk.mor',
    pembe: 'ayar.gorunum.renk.pembe',
    gri: 'ayar.gorunum.renk.gri',
  };
  const BOYUT_ANAHTARLARI = {
    kucuk: 'ayar.gorunum.boyut.kucuk',
    normal: 'ayar.gorunum.boyut.normal',
    genis: 'ayar.gorunum.boyut.genis',
    buyuk: 'ayar.gorunum.boyut.buyuk',
  };
  const GRAFIK_ANAHTARLARI = {
    otomatik: 'ayar.gorunum.grafik.otomatik',
    cizgi: 'ayar.gorunum.grafik.cizgi',
    gosterge: 'ayar.gorunum.grafik.gosterge',
    yok: 'ayar.gorunum.grafik.yok',
  };
  const IKON_ANAHTARLARI = {
    isik: 'ayar.gorunum.ikon.isik',
    priz: 'ayar.gorunum.ikon.priz',
    vantilator: 'ayar.gorunum.ikon.vantilator',
    sahne: 'ayar.gorunum.ikon.sahne',
    ekran: 'ayar.gorunum.ikon.ekran',
    hoparlor: 'ayar.gorunum.ikon.hoparlor',
    muzik: 'ayar.gorunum.ikon.muzik',
    kulaklik: 'ayar.gorunum.ikon.kulaklik',
    guc: 'ayar.gorunum.ikon.guc',
    ev: 'ayar.gorunum.ikon.ev',
    yatak: 'ayar.gorunum.ikon.yatak',
    kahve: 'ayar.gorunum.ikon.kahve',
    telefon: 'ayar.gorunum.ikon.telefon',
    yildiz: 'ayar.gorunum.ikon.yildiz',
    ay: 'ayar.gorunum.ikon.ay',
    gunes: 'ayar.gorunum.ikon.gunes',
  };
  const NEDEN_ANAHTARLARI = {
    kaydet: 'ayar.gecmis.neden.kaydet',
    sayfalar: 'ayar.gecmis.neden.sayfalar',
    'menu-kaldir': 'ayar.gecmis.neden.menuKaldir',
    'menu-tepsi': 'ayar.gecmis.neden.menuTepsi',
    'menu-sayfa': 'ayar.gecmis.neden.menuSayfa',
    onar: 'ayar.gecmis.neden.onar',
    don: 'ayar.gecmis.neden.don',
    aktar: 'ayar.gecmis.neden.aktar',
  };

  // ---------------------------------------------------------------- saf yardımcılar

  function adDuzelt(ad) {
    return Array.from(String(ad === undefined || ad === null ? '' : ad).replace(/\s+/g, ' ').trim()).slice(0, SAYFA_AD_SINIRI).join('');
  }

  /** Sayfa listesini karşılaştırılabilir tek biçime getirir: { id, ad (sadeleştirilmiş), varliklar (tekrarsız) }. Sunucu ve taslak aynı işlevden geçer. */
  function sayfalariNormallestir(ham) {
    if (!Array.isArray(ham)) return [];
    return ham
      .filter(function (s) {
        return s && typeof s === 'object' && typeof s.id === 'string';
      })
      .map(function (s) {
        const gorulen = new Set();
        const varliklar = (Array.isArray(s.varliklar) ? s.varliklar : []).filter(function (k) {
          if (typeof k !== 'string' || k === '' || gorulen.has(k)) return false;
          gorulen.add(k);
          return true;
        });
        return { id: s.id, ad: adDuzelt(s.ad), varliklar: varliklar.slice(0, EN_COK_SAYFA_VARLIGI) };
      });
  }

  /**
   * Sürükle-bırakta kaynağın yeni sırası: hedef satırın önüne ya da (sonra) arkasına bırakılır. Kaynak önce çıkarıldığı için kaynak
   * hedefin önündeyse sıra bir azalır. Geçersiz kimlikte -1.
   */
  function suruklemeHedefi(liste, kaynak, hedef, sonra) {
    const k = liste.indexOf(kaynak);
    let h = liste.indexOf(hedef);
    if (k < 0 || h < 0) return -1;
    if (sonra) h += 1;
    if (k < h) h -= 1;
    return Math.max(0, Math.min(liste.length - 1, h));
  }

  /** Geçmiş noktasının zamanı (kullanıcının dilinde, yerel saat). */
  function zamanMetni(zaman, dilKodu) {
    try {
      return new Date(zaman).toLocaleString(dilKodu === 'en' ? 'en-GB' : Dil ? Dil.yerelAdi(dilKodu) : 'tr-TR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (hata) {
      return String(zaman);
    }
  }

  /** Kayıttaki simgeyi açılır liste seçimine çevirir: '' | 'ikon:<ad>' | 'emoji'. */
  function simgeSecimi(simge) {
    if (typeof simge !== 'string' || simge === '') return '';
    if (simge.indexOf('ikon:') === 0 && Gorunum && Gorunum.simgeCoz(simge)) return simge;
    return EMOJI_SECIMI;
  }

  // ---------------------------------------------------------------- denetleyici

  /**
   * @param {object} ortak ayarlar.js'in verdikleri: belge, kopru (window.evPaneli), cevir(anahtar, değişkenler), cogul(anahtar, n, değişkenler),
   *   dil(), sayfalarListesi, btnSayfaEkle, sayfaSayaci, gecmisListesi, duyuru, siraKabi, kirliGuncelle(), kirliMi(), bildirimGoster(),
   *   odakla(), onayIste(metin), gorunenSira(), gorunenAd(kimlik), siraDuzenlenebilir(), favoriyiTasi(kimlik, yon),
   *   favoriyiKonumaTasi(kimlik, hedefSira), tumunuYenile(), favoriOnarildi(eski, yeni), onarmaAdaylari(eski)
   * @returns {object|null} Gerekli yardımcı betikler yüklenmediyse null (Ayarlar düzen bölümü olmadan çalışır)
   */
  function kur(ortak) {
    if (!Gorunum || !Islem || !ortak) return null;
    const belge = ortak.belge;
    const t = function (anahtar, degiskenler) {
      return ortak.cevir(anahtar, degiskenler);
    };

    function el(etiket, sinif, metin) {
      const e = belge.createElement(etiket);
      if (sinif) e.className = sinif;
      if (metin !== undefined) e.textContent = metin;
      return e;
    }

    /** role=list kabındaki boş durum/hata iletisi de liste öğesi olur (listede listitem olmayan çocuk bırakılmaz). */
    function bosSatir(metin) {
      const e = el('div', 'ipucu', metin);
      e.setAttribute('role', 'listitem');
      return e;
    }

    function dugme(metin, sinif, etiket) {
      const d = el('button', 'buton buton-ikincil buton-kucuk' + (sinif ? ' ' + sinif : ''), metin);
      d.type = 'button';
      if (etiket) d.setAttribute('aria-label', etiket);
      return d;
    }

    let sonDuyuru = '';
    /** Ekran okuyucu duyurusu (aria-live). Aynı metin art arda gelirse okunsun diye görünmez bir karakter eklenir. */
    function duyur(metin) {
      if (!ortak.duyuru) return;
      sonDuyuru = metin === sonDuyuru ? metin + '​' : metin;
      ortak.duyuru.textContent = sonDuyuru;
    }

    // ============================================================ karo görünümü (o-31, o-16 tepsi)

    const kayitli = new Map(); // kimlik -> { simge, renk, boyut, tepsi } (sunucudaki kayıt)
    const degisiklik = new Map(); // kimlik -> { alan: değer } (yalnız kayıttan FARKLI olanlar)

    const kayitliGorunum = function (kimlik) {
      return kayitli.get(kimlik) || VARSAYILAN_GORUNUM;
    };
    const etkinGorunum = function (kimlik) {
      return Object.assign({}, kayitliGorunum(kimlik), degisiklik.get(kimlik) || {});
    };

    function alanAyarla(kimlik, alan, deger) {
      const d = degisiklik.get(kimlik) || {};
      if (deger === kayitliGorunum(kimlik)[alan]) delete d[alan];
      else d[alan] = deger;
      if (Object.keys(d).length === 0) degisiklik.delete(kimlik);
      else degisiklik.set(kimlik, d);
      ortak.kirliGuncelle();
    }

    function favorileriYukle(favoriler, birlestir) {
      kayitli.clear();
      (Array.isArray(favoriler) ? favoriler : []).forEach(function (f) {
        kayitli.set(f.entity_id, {
          simge: typeof f.simge === 'string' ? f.simge : '',
          renk: typeof f.renk === 'string' ? f.renk : '',
          boyut: typeof f.boyut === 'string' && f.boyut !== '' ? f.boyut : 'normal',
          tepsi: f.tepsi === true,
          grafikTuru: typeof f.grafikTuru === 'string' && f.grafikTuru !== '' ? f.grafikTuru : 'otomatik',
          gostergeMin: typeof f.gostergeMin === 'number' && isFinite(f.gostergeMin) ? f.gostergeMin : null,
          gostergeMax: typeof f.gostergeMax === 'number' && isFinite(f.gostergeMax) ? f.gostergeMax : null,
        });
      });
      if (!birlestir) {
        degisiklik.clear();
        return;
      }
      Array.from(degisiklik.keys()).forEach(function (kimlik) {
        const d = degisiklik.get(kimlik);
        Object.keys(d).forEach(function (alan) {
          if (d[alan] === kayitliGorunum(kimlik)[alan]) delete d[alan];
        });
        if (Object.keys(d).length === 0) degisiklik.delete(kimlik);
      });
    }

    function favoriGorunumuKirli(kimlikler) {
      return (kimlikler || []).some(function (k) {
        return degisiklik.has(k);
      });
    }

    /** Kayıt yüküne yalnız kullanıcının değiştirdiği görünüm alanları girer (ana süreç doğrular; '' temizler, boyut 'normal' varsayılana döner). */
    function favoriYukunuEkle(kimlik, girdi) {
      const d = degisiklik.get(kimlik);
      if (!d) return;
      GORUNUM_ALANLARI.forEach(function (alan) {
        if (Object.prototype.hasOwnProperty.call(d, alan)) girdi[alan] = d[alan];
      });
      // Sensör gösterge aralığı ÇİFT olarak gider (biri değiştiyse ikisi de; null aralığı temizler)
      if (Object.prototype.hasOwnProperty.call(d, 'gostergeMin') || Object.prototype.hasOwnProperty.call(d, 'gostergeMax')) {
        const g = etkinGorunum(kimlik);
        girdi.gostergeMin = g.gostergeMin;
        girdi.gostergeMax = g.gostergeMax;
      }
    }

    function secimOlustur(secenekler, deger, etiket) {
      const s = el('select');
      s.setAttribute('aria-label', etiket);
      secenekler.forEach(function (c) {
        const o = el('option', '', c[1]);
        o.value = c[0];
        s.appendChild(o);
      });
      s.value = deger;
      return s;
    }

    /**
     * Favori satırının "Karo görünümü" grubu (ek: satırın ikinci çizgisi). secili: favori seçili değilse kontroller kapalıdır.
     * secenek.tepsiYok: "tepsiye sabitle" kutusu çizilmez (tek tıklama eylemi olmayan karo).
     * @returns {{etkinlestir: function(boolean): void}}
     */
    function gorunumKur(ek, kimlik, ad, secili, secenek) {
      const tepsiYok = !!secenek && secenek.tepsiYok === true; // tek tıklama eylemi olmayan karo (klima, medya...) tepsi menüsüne giremez: kutu yok
      const g = etkinGorunum(kimlik);
      const kap = el('div', 'gorunum-grubu');
      kap.setAttribute('role', 'group');
      kap.setAttribute('aria-label', t('ayar.gorunum.grup'));

      const tepsiKutusu = el('label', 'onay-etiket');
      tepsiKutusu.title = t('ayar.gorunum.tepsiIpucu');
      const tepsi = belge.createElement('input');
      tepsi.type = 'checkbox';
      tepsi.checked = g.tepsi === true;
      tepsi.setAttribute('aria-label', t('ayar.gorunum.tepsiEtiket', { ad: ad }));
      tepsi.addEventListener('change', function () {
        alanAyarla(kimlik, 'tepsi', tepsi.checked);
        if (typeof ortak.siraYenile === 'function') ortak.siraYenile(); // "Tepsi menüsünde (n/8)" sayacı tepsiye sabitlenenleri öne alır
      });
      tepsiKutusu.appendChild(tepsi);
      tepsiKutusu.appendChild(el('span', '', t('ayar.gorunum.tepsi')));
      if (!tepsiYok) kap.appendChild(tepsiKutusu);

      const renkler = [['', t('ayar.gorunum.renkYok')]].concat(
        Gorunum.RENKLER.map(function (r) {
          return [r, t(RENK_ANAHTARLARI[r] || 'ayar.gorunum.renkYok')];
        }),
      );
      const renk = secimOlustur(renkler, g.renk, t('ayar.gorunum.renkEtiket', { ad: ad }));
      renk.addEventListener('change', function () {
        alanAyarla(kimlik, 'renk', renk.value);
      });
      kap.appendChild(etiketli(t('ayar.gorunum.renk'), renk));

      const boyutlar = Gorunum.BOYUTLAR.map(function (b) {
        return [b, t(BOYUT_ANAHTARLARI[b] || 'ayar.gorunum.boyut.normal')];
      });
      const boyut = secimOlustur(boyutlar, g.boyut, t('ayar.gorunum.boyutEtiket', { ad: ad }));
      boyut.addEventListener('change', function () {
        alanAyarla(kimlik, 'boyut', boyut.value);
      });
      kap.appendChild(etiketli(t('ayar.gorunum.boyut'), boyut));

      const simgeler = [['', t('ayar.gorunum.simgeYok')]]
        .concat(
          Gorunum.IKON_ADLARI.map(function (a) {
            return [Gorunum.IKON_ONEKI + a, t(IKON_ANAHTARLARI[a] || 'ayar.gorunum.simgeYok')];
          }),
        )
        .concat([[EMOJI_SECIMI, t('ayar.gorunum.simgeEmoji')]]);
      const secim = simgeSecimi(g.simge);
      const simge = secimOlustur(simgeler, secim, t('ayar.gorunum.simgeEtiket', { ad: ad }));
      kap.appendChild(etiketli(t('ayar.gorunum.simge'), simge));

      const emoji = belge.createElement('input');
      emoji.type = 'text';
      emoji.className = 'gorunum-emoji';
      emoji.maxLength = Gorunum.EMOJI_SINIRI;
      emoji.spellcheck = false;
      emoji.placeholder = t('ayar.gorunum.emojiIpucu');
      emoji.value = secim === EMOJI_SECIMI ? g.simge : '';
      emoji.setAttribute('aria-label', t('ayar.gorunum.emojiEtiket', { ad: ad }));
      const emojiHata = el('div', 'cihaz-not', t('ayar.gorunum.emojiGecersiz'));
      emojiHata.style.display = 'none';
      emoji.style.display = secim === EMOJI_SECIMI ? '' : 'none';
      kap.appendChild(emoji);
      const emojiSec = belge.createElement('button');
      emojiSec.type = 'button';
      emojiSec.className = 'buton buton-ikincil buton-kucuk gorunum-emoji-sec';
      emojiSec.textContent = t('ayar.gorunum.emojiSec');
      emojiSec.setAttribute('aria-label', t('ayar.gorunum.emojiSecEtiket', { ad: ad }));
      emojiSec.setAttribute('aria-expanded', 'false');
      emojiSec.style.display = secim === EMOJI_SECIMI ? '' : 'none';
      kap.appendChild(emojiSec);
      kap.appendChild(emojiHata);

      function emojiHatasiniAyarla(hatali) {
        emojiHata.style.display = hatali ? 'block' : 'none';
        if (hatali) {
          emoji.classList.add('gecersiz');
          emoji.setAttribute('aria-invalid', 'true');
        } else {
          emoji.classList.remove('gecersiz');
          emoji.removeAttribute('aria-invalid');
        }
      }

      function emojiUygula() {
        const ham = emoji.value.trim();
        if (ham === '') {
          emojiHatasiniAyarla(false);
          alanAyarla(kimlik, 'simge', '');
          return;
        }
        const duzgun = Gorunum.simgeDuzelt(ham);
        if (duzgun === null || duzgun === '') {
          emojiHatasiniAyarla(true); // geçersiz / yasak: değişiklik kayda alınmaz, önceki değer korunur
          return;
        }
        emojiHatasiniAyarla(false);
        alanAyarla(kimlik, 'simge', duzgun);
      }

      // Emoji seçici: ilk açılışta kurulur (her satırda 50 düğme önceden çizilmesin); seçilen emoji yazılan emoji gibi AYNI doğrulamadan geçer
      let secici = null;

      function seciciKapat() {
        emojiSec.setAttribute('aria-expanded', 'false');
        if (secici) secici.kutu.style.display = 'none';
      }

      function seciciAcikMi() {
        return !!secici && secici.kutu.style.display !== 'none';
      }

      // Esc seçiciyi kapatır, pencereyi değil (ayarlar.js'in belge düzeyindeki Esc işleyicisine ulaşmaz); odak "Emoji seç" düğmesine döner.
      function seciciEscape(olay) {
        olay.preventDefault();
        olay.stopPropagation();
        seciciKapat();
        emojiSec.focus();
      }

      function emojiSeciliyor(deger) {
        emoji.value = deger;
        emojiUygula();
        seciciKapat();
        emojiSec.focus();
      }

      function seciciKur() {
        const kutu = el('div', 'emoji-secici');
        const ara = belge.createElement('input');
        ara.type = 'search';
        ara.className = 'emoji-ara';
        ara.spellcheck = false;
        ara.placeholder = t('ayar.gorunum.emojiAra');
        ara.setAttribute('aria-label', t('ayar.gorunum.emojiAraEtiket', { ad: ad }));
        const izgara = el('div', 'emoji-izgara');
        const bos = el('div', 'cihaz-not', t('ayar.gorunum.emojiBulunamadi'));
        bos.style.display = 'none';
        kutu.appendChild(ara);
        kutu.appendChild(izgara);
        kutu.appendChild(bos);

        function ciz() {
          const sonuc = emojiAra(ara.value);
          izgara.replaceChildren.apply(
            izgara,
            sonuc.map(function (o) {
              const dugme = belge.createElement('button');
              dugme.type = 'button';
              dugme.className = 'emoji-oge';
              dugme.textContent = o.emoji;
              dugme.title = o.ad;
              dugme.setAttribute('aria-label', o.ad);
              dugme.addEventListener('click', function () {
                emojiSeciliyor(o.emoji);
              });
              return dugme;
            }),
          );
          bos.style.display = sonuc.length === 0 ? 'block' : 'none';
        }
        ara.addEventListener('input', ciz);
        // Izgaradaki emoji düğmelerindeki Esc kutuya kabarır; arama kutusu da kendi Esc'ini alır.
        kutu.addEventListener('keydown', function (olay) {
          if (olay.key === 'Escape') seciciEscape(olay);
        });
        ara.addEventListener('keydown', function (olay) {
          if (olay.key === 'Escape') {
            seciciEscape(olay);
          } else if (olay.key === 'Enter') {
            olay.preventDefault();
            const ilk = emojiAra(ara.value)[0];
            if (ilk) emojiSeciliyor(ilk.emoji);
          }
        });
        ciz();
        return { kutu: kutu, ara: ara, ciz: ciz };
      }

      emojiSec.addEventListener('keydown', function (olay) {
        if (olay.key === 'Escape' && seciciAcikMi()) seciciEscape(olay); // seçici kapalıyken Esc olduğu gibi geçer
      });
      emojiSec.addEventListener('click', function () {
        if (seciciAcikMi()) {
          seciciKapat();
          return;
        }
        if (!secici) {
          secici = seciciKur();
          kap.appendChild(secici.kutu);
        }
        secici.kutu.style.display = '';
        secici.ara.value = '';
        secici.ciz();
        emojiSec.setAttribute('aria-expanded', 'true');
        ortak.odakla(secici.ara);
      });

      simge.addEventListener('change', function () {
        if (simge.value === EMOJI_SECIMI) {
          emoji.style.display = '';
          emojiSec.style.display = '';
          emojiUygula();
          ortak.odakla(emoji);
          return;
        }
        emoji.style.display = 'none';
        emojiSec.style.display = 'none';
        seciciKapat();
        emojiHatasiniAyarla(false);
        alanAyarla(kimlik, 'simge', simge.value);
      });
      emoji.addEventListener('input', emojiUygula);

      const kontroller = tepsiYok ? [renk, boyut, simge, emoji, emojiSec] : [tepsi, renk, boyut, simge, emoji, emojiSec];
      if (secenek && secenek.sensor === true) sensorKontrolleriniKur(kap, kimlik, ad, g, kontroller);
      function etkinlestir(acik) {
        kontroller.forEach(function (k) {
          k.disabled = !acik;
        });
        if (!acik) seciciKapat(); // seçilmeyen satırın seçicisi açık kalmaz
      }
      etkinlestir(secili);
      ek.appendChild(kap);
      return { etkinlestir: etkinlestir };
    }

    /** Arama için katlama: küçük harf, aksan ve Türkçe noktasız ı sadeleşir ("isitma", "Isıtma" ve "ısıtma" aynı sözcüğü bulur). */
    function aramaKatla(metin) {
      return String(metin)
        .toLowerCase()
        .replace(/\u0131/g, 'i')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Emoji seçici araması: önerilerde ARAYÜZ DİLİNDEKİ ada göre süzer (boş sorgu = hepsi, liste sırasıyla). Aksan / büyük-küçük harf farkı yoktur.
     * @returns {{emoji: string, ad: string}[]}
     */
    function emojiAra(sorgu) {
      const aranan = aramaKatla(String(sorgu || '').trim());
      const sonuc = [];
      EMOJI_ONERILERI.forEach(function (o) {
        const ad = t(o[1]);
        if (aranan === '' || aramaKatla(ad).indexOf(aranan) >= 0 || o[0] === String(sorgu || '').trim()) sonuc.push({ emoji: o[0], ad: ad });
      });
      return sonuc;
    }

    /** Sensör favorisine özel: grafik biçimi ve gösterge alt / üst değeri (ikisi birden; geçersiz çift kayda alınmaz, önceki değer korunur). */
    function sensorKontrolleriniKur(kap, kimlik, ad, g, kontroller) {
      const grafikler = Gorunum.GRAFIK_TURLERI.map(function (b) {
        return [b, t(GRAFIK_ANAHTARLARI[b] || 'ayar.gorunum.grafik.otomatik')];
      });
      const grafik = secimOlustur(grafikler, g.grafikTuru, t('ayar.gorunum.grafikEtiket', { ad: ad }));
      grafik.addEventListener('change', function () {
        alanAyarla(kimlik, 'grafikTuru', grafik.value);
      });
      kap.appendChild(etiketli(t('ayar.gorunum.grafik'), grafik));

      function sayiKutusu(etiket, deger) {
        const kutu = belge.createElement('input');
        kutu.type = 'number';
        kutu.step = 'any';
        kutu.className = 'gorunum-sayi';
        kutu.title = t('ayar.gorunum.gostergeIpucu');
        kutu.setAttribute('aria-label', etiket);
        kutu.value = typeof deger === 'number' ? String(deger) : '';
        return kutu;
      }
      const alt = sayiKutusu(t('ayar.gorunum.gostergeAltEtiket', { ad: ad }), g.gostergeMin);
      const ust = sayiKutusu(t('ayar.gorunum.gostergeUstEtiket', { ad: ad }), g.gostergeMax);
      kap.appendChild(etiketli(t('ayar.gorunum.gostergeAlt'), alt));
      kap.appendChild(etiketli(t('ayar.gorunum.gostergeUst'), ust));
      const hata = el('div', 'cihaz-not', t('ayar.gorunum.gostergeGecersiz'));
      hata.style.display = 'none';
      kap.appendChild(hata);

      function hataAyarla(hatali) {
        hata.style.display = hatali ? 'block' : 'none';
        [alt, ust].forEach(function (k) {
          if (hatali) {
            k.classList.add('gecersiz');
            k.setAttribute('aria-invalid', 'true');
          } else {
            k.classList.remove('gecersiz');
            k.removeAttribute('aria-invalid');
          }
        });
      }

      function aralikUygula() {
        const a = alt.value.trim();
        const u = ust.value.trim();
        if (a === '' && u === '') {
          hataAyarla(false);
          alanAyarla(kimlik, 'gostergeMin', null);
          alanAyarla(kimlik, 'gostergeMax', null);
          return;
        }
        const aralik = a !== '' && u !== '' ? Gorunum.gostergeAraligiDuzelt(Number(a), Number(u)) : null;
        if (!aralik) {
          hataAyarla(true); // eksik / ters / geçersiz çift: değişiklik kayda alınmaz, önceki değer korunur
          return;
        }
        hataAyarla(false);
        alanAyarla(kimlik, 'gostergeMin', aralik.gostergeMin);
        alanAyarla(kimlik, 'gostergeMax', aralik.gostergeMax);
      }
      alt.addEventListener('input', aralikUygula);
      ust.addEventListener('input', aralikUygula);
      kontroller.push(grafik, alt, ust);
    }

    function etiketli(metin, kontrol) {
      const k = el('label', 'onay-etiket');
      k.appendChild(el('span', '', metin));
      k.appendChild(kontrol);
      return k;
    }

    /** Onarım: eski kimliğin bekleyen görünüm değişiklikleri yeni kimliğe taşınır. */
    function gorunumKimligiDegisti(eski, yeni) {
      if (!degisiklik.has(eski)) return;
      const d = degisiklik.get(eski);
      degisiklik.delete(eski);
      if (!degisiklik.has(yeni)) degisiklik.set(yeni, d);
    }

    // ============================================================ sıra: sürükle-bırak, Alt+ok, duyuru (o-30)

    let surukleKimlik = null;

    function surukleIsaretleriniTemizle() {
      surukleKimlik = null;
      const kabi = ortak.siraKabi;
      if (!kabi) return;
      Array.from(kabi.children).forEach(function (s) {
        s.classList.remove('suruklenen');
        s.classList.remove('sira-hedef-once');
        s.classList.remove('sira-hedef-sonra');
      });
    }

    function siraTutamaciEkle(satir) {
      if (!ortak.siraDuzenlenebilir()) return;
      const tutamac = el('span', 'sira-tutamac', '⋮⋮');
      tutamac.setAttribute('aria-hidden', 'true'); // süs: klavye yolu Alt+↑ / Alt+↓, ekran okuyucu ↑ ↓ düğmelerini kullanır
      tutamac.title = t('ayar.sira.tutamac');
      satir.appendChild(tutamac);
    }

    function dropSonrasi(olay, satir) {
      const kutu = typeof satir.getBoundingClientRect === 'function' ? satir.getBoundingClientRect() : null;
      return !!kutu && typeof olay.clientY === 'number' && olay.clientY > kutu.top + kutu.height / 2;
    }

    function siraSatiriniBagla(satir, kimlik) {
      if (!ortak.siraDuzenlenebilir()) return;
      satir.draggable = true;
      satir.setAttribute('draggable', 'true');
      satir.addEventListener('dragstart', function (olay) {
        surukleKimlik = kimlik;
        satir.classList.add('suruklenen');
        if (olay.dataTransfer) {
          olay.dataTransfer.effectAllowed = 'move';
          try {
            olay.dataTransfer.setData(SURUKLEME_TURU, kimlik); // yalnız bu uygulamanın türü: başka uygulamaya metin olarak bırakılamaz
          } catch (hata) {
            /* sürükleme verisi yazılamadı: sürükleme yine de çalışır */
          }
        }
      });
      satir.addEventListener('dragover', function (olay) {
        if (surukleKimlik === null || surukleKimlik === kimlik) return;
        olay.preventDefault();
        if (olay.dataTransfer) olay.dataTransfer.dropEffect = 'move';
        const sonra = dropSonrasi(olay, satir);
        satir.classList.add(sonra ? 'sira-hedef-sonra' : 'sira-hedef-once');
        satir.classList.remove(sonra ? 'sira-hedef-once' : 'sira-hedef-sonra');
      });
      satir.addEventListener('dragleave', function () {
        satir.classList.remove('sira-hedef-once');
        satir.classList.remove('sira-hedef-sonra');
      });
      satir.addEventListener('drop', function (olay) {
        if (surukleKimlik === null) return;
        olay.preventDefault();
        const kaynak = surukleKimlik;
        const sonra = dropSonrasi(olay, satir);
        surukleIsaretleriniTemizle();
        const liste = ortak.gorunenSira();
        const hedef = suruklemeHedefi(liste, kaynak, kimlik, sonra);
        if (hedef >= 0 && liste.indexOf(kaynak) !== hedef) ortak.favoriyiKonumaTasi(kaynak, hedef);
      });
      satir.addEventListener('dragend', surukleIsaretleriniTemizle);
      satir.addEventListener('keydown', function (olay) {
        if (!olay.altKey || olay.ctrlKey || olay.shiftKey || olay.metaKey) return;
        if (olay.key !== 'ArrowUp' && olay.key !== 'ArrowDown') return;
        olay.preventDefault();
        ortak.favoriyiTasi(kimlik, olay.key === 'ArrowUp' ? -1 : 1);
      });
    }

    function siraDuyur(kimlik, sira, toplam) {
      duyur(t('ayar.sira.tasindi', { ad: ortak.gorunenAd(kimlik), n: sira, toplam: toplam }));
    }

    // ============================================================ panel sayfaları (o-24)

    let taslak = []; // [{ id, ad, varliklar }] — düzenlenen sayfalar
    let kayitliSayfalar = '[]'; // sunucudaki sayfaların normalleştirilmiş JSON'u
    const acikSayfalar = new Set(); // üye listesi açık sayfalar
    const sayfaDugmeleri = new Map(); // sayfa kimliği -> { ad, yukari, asagi, cogalt, sil, uyeler }
    const uyeDugmeleri = new Map(); // sayfa kimliği + '\u0000' + favori kimliği -> { yukari, asagi } (üye satırındaki taşıma düğmeleri)
    let odakIstegi = null; // { id, parca } ya da üye için { id, uye, parca } — bir sonraki çizimde odak
    let sonSecimImzasi = '';

    const sayfaAdi = function (s, sira) {
      return s.ad || t('sayfa.adsiz', { n: sira + 1 });
    };
    const sayfaBul = function (id) {
      return taslak.find(function (s) {
        return s.id === id;
      });
    };

    function sayfalarKirli() {
      return JSON.stringify(sayfalariNormallestir(taslak)) !== kayitliSayfalar;
    }

    function sayfalariYukle(ham) {
      taslak = sayfalariNormallestir(ham);
      kayitliSayfalar = JSON.stringify(taslak);
      Array.from(acikSayfalar).forEach(function (id) {
        if (!sayfaBul(id)) acikSayfalar.delete(id);
      });
      sayfalariCiz();
    }

    function sayfaDegisti(duyuru) {
      sayfalariCiz();
      ortak.kirliGuncelle();
      if (duyuru) duyur(duyuru);
    }

    function secimImzasi() {
      return JSON.stringify(
        ortak.gorunenSira().map(function (k) {
          return [k, ortak.gorunenAd(k)];
        }),
      );
    }

    /** Favori seçimi / adı değişti: üye listeleri yeniden çizilir (seçimde olmayan üye gösterilmez; kayıtta sunucu zaten budar). */
    function sayfalariTazele() {
      const imza = secimImzasi();
      if (imza === sonSecimImzasi) return;
      sayfalariCiz();
    }

    function odakIsteginiUygula() {
      const istek = odakIstegi;
      odakIstegi = null;
      if (!istek) return;
      const d = sayfaDugmeleri.get(istek.id);
      let hedef = d ? d[istek.parca] || d.ad : ortak.btnSayfaEkle;
      if (d && istek.uye !== undefined) {
        // Üye taşındı: odak aynı üyenin düğmesinde kalır; uçtaki üyede o yön kapalıdır, karşı yöne, o da yoksa "Üyeler" düğmesine düşer.
        const u = uyeDugmeleri.get(istek.id + '\u0000' + istek.uye);
        const karsi = istek.parca === 'yukari' ? 'asagi' : 'yukari';
        hedef = u && !u[istek.parca].disabled ? u[istek.parca] : u && !u[karsi].disabled ? u[karsi] : d.uyeler;
      }
      if (hedef) ortak.odakla(hedef);
    }

    function sayfalariCiz() {
      sonSecimImzasi = secimImzasi();
      const kap = ortak.sayfalarListesi;
      kap.setAttribute('aria-label', t('ayar.sayfa.listeEtiket'));
      kap.replaceChildren();
      sayfaDugmeleri.clear();
      uyeDugmeleri.clear();
      if (taslak.length === 0) kap.appendChild(bosSatir(t('ayar.sayfa.bos')));
      taslak.forEach(function (s, i) {
        kap.appendChild(sayfaSatiri(s, i));
      });
      const dolu = taslak.length >= EN_COK_SAYFA;
      ortak.btnSayfaEkle.disabled = dolu;
      ortak.btnSayfaEkle.title = dolu ? t('ayar.sayfa.sinir', { enCok: EN_COK_SAYFA }) : '';
      ortak.sayfaSayaci.textContent = t('ayar.sayfa.sayac', { n: taslak.length, enCok: EN_COK_SAYFA });
      odakIsteginiUygula();
    }

    function sayfayiTasi(id, yon, parca) {
      const eski = taslak.findIndex(function (s) {
        return s.id === id;
      });
      const yeni = Islem.sayfayiTasi(taslak, id, yon);
      const yeniSira = yeni.findIndex(function (s) {
        return s.id === id;
      });
      if (eski < 0 || yeniSira === eski) return;
      taslak = yeni;
      odakIstegi = { id: id, parca: parca };
      sayfaDegisti(t('ayar.sayfa.tasindi', { ad: sayfaAdi(taslak[yeniSira], yeniSira), n: yeniSira + 1, toplam: taslak.length }));
    }

    function sayfaSatiri(s, sira) {
      const id = s.id;
      const ad = sayfaAdi(s, sira);
      const satir = el('div', 'sayfa-satir');
      satir.setAttribute('role', 'listitem');
      satir.setAttribute('data-sayfa-id', id);

      const ust = el('div', 'sayfa-ust');
      const girdi = belge.createElement('input');
      girdi.type = 'text';
      girdi.maxLength = SAYFA_AD_SINIRI;
      girdi.spellcheck = false;
      girdi.value = s.ad;
      girdi.placeholder = t('sayfa.adsiz', { n: sira + 1 });
      girdi.setAttribute('aria-label', t('ayar.sayfa.adEtiket'));
      girdi.addEventListener('input', function () {
        const guncel = sayfaBul(id);
        if (guncel) guncel.ad = girdi.value;
        ortak.kirliGuncelle();
      });
      ust.appendChild(girdi);

      const yukari = dugme('↑', '', t('ayar.sayfa.yukari', { ad: ad }));
      yukari.disabled = sira === 0;
      yukari.addEventListener('click', function () {
        sayfayiTasi(id, -1, 'yukari');
      });
      const asagi = dugme('↓', '', t('ayar.sayfa.asagi', { ad: ad }));
      asagi.disabled = sira === taslak.length - 1;
      asagi.addEventListener('click', function () {
        sayfayiTasi(id, 1, 'asagi');
      });
      const cogalt = dugme(t('ayar.sayfa.cogalt'), '', t('ayar.sayfa.cogaltEtiket', { ad: ad }));
      cogalt.disabled = taslak.length >= EN_COK_SAYFA;
      cogalt.addEventListener('click', function () {
        const yeniId = Islem.sayfaKimligiUret(taslak);
        const sonuc = Islem.sayfayiCogalt(taslak, id, yeniId, t('ayar.sayfa.kopya'));
        if (!sonuc.yeniId) return;
        taslak = sonuc.sayfalar;
        odakIstegi = { id: sonuc.yeniId, parca: 'ad' };
        const yeni = sayfaBul(sonuc.yeniId);
        sayfaDegisti(t('ayar.sayfa.cogaltildi', { ad: sayfaAdi(yeni, taslak.indexOf(yeni)) }));
      });
      const sil = dugme(t('ayar.sayfa.sil'), 'buton-tehlike', t('ayar.sayfa.silEtiket', { ad: ad }));
      sil.addEventListener('click', function () {
        const eskiSira = taslak.findIndex(function (p) {
          return p.id === id;
        });
        // Ad kutusuna yazılan ad taslağa işlenir ama satır yeniden çizilmez: onay ve duyuru çizim anındaki eski adı değil güncel adı söyler.
        const guncelAd = eskiSira < 0 ? ad : sayfaAdi({ ad: adDuzelt(taslak[eskiSira].ad) }, eskiSira);
        if (!ortak.onayIste(t('ayar.sayfa.silOnay', { ad: guncelAd }))) return;
        taslak = Islem.sayfayiSil(taslak, id);
        acikSayfalar.delete(id);
        const komsu = taslak[Math.min(eskiSira, taslak.length - 1)];
        odakIstegi = komsu ? { id: komsu.id, parca: 'ad' } : null;
        if (!komsu) ortak.odakla(ortak.btnSayfaEkle);
        sayfaDegisti(t('ayar.sayfa.silindi', { ad: guncelAd }));
      });

      const acik = acikSayfalar.has(id);
      const gorunenUyeSayisi = uyeKimlikleri(s).length;
      const uyeler = dugme(t('ayar.sayfa.uyeler', { n: gorunenUyeSayisi }), '', t('ayar.sayfa.uyelerEtiket', { ad: ad }));
      uyeler.setAttribute('aria-expanded', acik ? 'true' : 'false');
      uyeler.addEventListener('click', function () {
        if (acikSayfalar.has(id)) acikSayfalar.delete(id);
        else acikSayfalar.add(id);
        odakIstegi = { id: id, parca: 'uyeler' };
        sayfalariCiz();
      });

      [yukari, asagi, cogalt, sil, uyeler].forEach(function (d) {
        ust.appendChild(d);
      });
      // Ad kutusundan çıkınca düğme adları yeni adı söyler (satırı yeniden çizmek odağı düşürürdü).
      girdi.addEventListener('change', function () {
        const i = taslak.findIndex(function (p) {
          return p.id === id;
        });
        const yeniAd = sayfaAdi({ ad: adDuzelt(girdi.value) }, i < 0 ? sira : i);
        yukari.setAttribute('aria-label', t('ayar.sayfa.yukari', { ad: yeniAd }));
        asagi.setAttribute('aria-label', t('ayar.sayfa.asagi', { ad: yeniAd }));
        cogalt.setAttribute('aria-label', t('ayar.sayfa.cogaltEtiket', { ad: yeniAd }));
        sil.setAttribute('aria-label', t('ayar.sayfa.silEtiket', { ad: yeniAd }));
        uyeler.setAttribute('aria-label', t('ayar.sayfa.uyelerEtiket', { ad: yeniAd }));
      });
      const dugmeler = { ad: girdi, yukari: yukari, asagi: asagi, cogalt: cogalt, sil: sil, uyeler: uyeler };
      sayfaDugmeleri.set(id, dugmeler);
      // Alt+↑ / Alt+↓: sayfayı taşır (odak aynı denetimde kalır)
      ust.addEventListener('keydown', function (olay) {
        if (!olay.altKey || olay.ctrlKey || olay.shiftKey || olay.metaKey) return;
        if (olay.key !== 'ArrowUp' && olay.key !== 'ArrowDown') return;
        olay.preventDefault();
        const parca = olay.target === yukari ? 'yukari' : olay.target === asagi ? 'asagi' : 'ad';
        sayfayiTasi(id, olay.key === 'ArrowUp' ? -1 : 1, parca);
      });
      satir.appendChild(ust);
      if (acik) satir.appendChild(uyeKutusu(s, ad));
      return satir;
    }

    /** Sayfanın üyeleri: yalnız şu an SEÇİLİ favoriler, sayfanın kendi sırasıyla. */
    function uyeKimlikleri(s) {
      const secili = new Set(ortak.gorunenSira());
      return s.varliklar.filter(function (k) {
        return secili.has(k);
      });
    }

    function uyeKutusu(s, sayfaAd) {
      const id = s.id;
      const kutu = el('div', 'sayfa-uyeler');
      const secili = ortak.gorunenSira();
      if (secili.length === 0) {
        kutu.appendChild(el('div', 'ipucu', t('ayar.sayfa.favoriYok')));
        return kutu;
      }
      const uyeler = uyeKimlikleri(s);
      if (uyeler.length === 0) kutu.appendChild(el('div', 'ipucu', t('ayar.sayfa.uyeYok')));
      const liste = el('div');
      liste.setAttribute('role', 'list');
      liste.setAttribute('aria-label', t('ayar.sayfa.uyelerEtiket', { ad: sayfaAd }));
      uyeler.forEach(function (kimlik, j) {
        const uAd = ortak.gorunenAd(kimlik);
        const u = el('div', 'sayfa-uye');
        u.setAttribute('role', 'listitem');
        const adOge = el('span', 'sayfa-uye-ad', uAd);
        adOge.title = uAd; // tek satır + üç nokta ile kesilen uzun ad tam okunabilsin
        u.appendChild(adOge);
        const yukari = dugme('↑', '', t('ayar.sayfa.uyeYukari', { ad: uAd }));
        yukari.disabled = j === 0;
        yukari.addEventListener('click', function () {
          uyeyiTasi(id, kimlik, -1, 'yukari');
        });
        const asagi = dugme('↓', '', t('ayar.sayfa.uyeAsagi', { ad: uAd }));
        asagi.disabled = j === uyeler.length - 1;
        asagi.addEventListener('click', function () {
          uyeyiTasi(id, kimlik, 1, 'asagi');
        });
        const cikar = dugme(t('ayar.sayfa.uyeCikar'), '', t('ayar.sayfa.uyeCikarEtiket', { ad: uAd }));
        cikar.addEventListener('click', function () {
          taslak = Islem.varlikCikar(taslak, id, kimlik);
          odakIstegi = { id: id, parca: 'uyeler' };
          sayfaDegisti('');
        });
        u.addEventListener('keydown', function (olay) {
          if (!olay.altKey || olay.ctrlKey || olay.shiftKey || olay.metaKey) return;
          if (olay.key !== 'ArrowUp' && olay.key !== 'ArrowDown') return;
          olay.preventDefault();
          uyeyiTasi(id, kimlik, olay.key === 'ArrowUp' ? -1 : 1, olay.key === 'ArrowUp' ? 'yukari' : 'asagi');
        });
        uyeDugmeleri.set(id + '\u0000' + kimlik, { yukari: yukari, asagi: asagi });
        u.appendChild(yukari);
        u.appendChild(asagi);
        u.appendChild(cikar);
        liste.appendChild(u);
      });
      kutu.appendChild(liste);

      const adaylar = secili.filter(function (k) {
        return s.varliklar.indexOf(k) < 0;
      });
      if (adaylar.length > 0 && s.varliklar.length < EN_COK_SAYFA_VARLIGI) {
        const secenekler = [['', t('ayar.sayfa.uyeEkle')]].concat(
          adaylar.map(function (k) {
            return [k, ortak.gorunenAd(k)];
          }),
        );
        const ekle = secimOlustur(secenekler, '', t('ayar.sayfa.uyeEkleEtiket', { ad: sayfaAd }));
        ekle.addEventListener('change', function () {
          if (ekle.value === '') return;
          taslak = Islem.varlikEkle(taslak, id, ekle.value);
          odakIstegi = { id: id, parca: 'uyeler' };
          sayfaDegisti('');
        });
        kutu.appendChild(ekle);
      }
      return kutu;
    }

    /** Sayfa içinde üyeyi taşır: yalnız görünen (seçili) üyeler arasında; seçili olmayanlar sona kalır (kayıtta budanır). */
    function uyeyiTasi(id, kimlik, yon, parca) {
      const s = sayfaBul(id);
      if (!s) return;
      const gorunen = uyeKimlikleri(s);
      const yeniGorunen = Islem.yondeTasi(gorunen, kimlik, yon);
      if (JSON.stringify(yeniGorunen) === JSON.stringify(gorunen)) return;
      const kalan = s.varliklar.filter(function (k) {
        return gorunen.indexOf(k) < 0;
      });
      s.varliklar = yeniGorunen.concat(kalan);
      odakIstegi = { id: id, uye: kimlik, parca: parca }; // satırlar yeniden kurulur; odak taşınan üyenin düğmesine döner
      sayfalariCiz();
      ortak.kirliGuncelle();
      duyur(t('ayar.sayfa.uyeTasindi', { ad: ortak.gorunenAd(kimlik), n: yeniGorunen.indexOf(kimlik) + 1 }));
    }

    function sayfaEkle() {
      if (taslak.length >= EN_COK_SAYFA) return;
      const id = Islem.sayfaKimligiUret(taslak);
      taslak = Islem.sayfaEkle(taslak, '', id);
      if (!sayfaBul(id)) return;
      acikSayfalar.add(id);
      odakIstegi = { id: id, parca: 'ad' };
      sayfaDegisti(t('ayar.sayfa.eklendi', { ad: sayfaAdi(sayfaBul(id), taslak.length - 1) }));
    }
    ortak.btnSayfaEkle.addEventListener('click', sayfaEkle);

    /** Onarım: sayfa taslağında ve kayıtlı sayfa görüntüsünde eski kimlik yenisiyle değişir (sunucu aynı işlemi yaptı). */
    function sayfaKimligiDegisti(eski, yeni) {
      taslak = Islem.kimlikDegistir(taslak, eski, yeni);
      kayitliSayfalar = JSON.stringify(sayfalariNormallestir(Islem.kimlikDegistir(JSON.parse(kayitliSayfalar), eski, yeni)));
      sayfalariCiz();
    }

    // ============================================================ düzen geçmişi (o-30)

    let noktalar = [];
    let gecmisHatasi = false;
    let odakGecmis = false; // geri dönüşten sonra: tıklanan düğme listeyle birlikte yok olur, odak ilk "Bu düzene dön" düğmesine verilir

    function gecmisiCiz() {
      const kap = ortak.gecmisListesi;
      kap.setAttribute('aria-label', t('ayar.gecmis.listeEtiket'));
      kap.replaceChildren();
      if (gecmisHatasi) {
        kap.appendChild(bosSatir(t('ayar.gecmis.listeHata')));
        return;
      }
      if (noktalar.length === 0) {
        kap.appendChild(bosSatir(t('ayar.gecmis.bos')));
        return;
      }
      let ilkDon = null;
      noktalar.forEach(function (n) {
        const zaman = zamanMetni(n.zaman, ortak.dil());
        const satir = el('div', 'gecmis-satir');
        satir.setAttribute('role', 'listitem');
        satir.appendChild(el('span', 'gecmis-zaman', zaman));
        const neden = t(NEDEN_ANAHTARLARI[n.neden] || NEDEN_ANAHTARLARI.kaydet);
        satir.appendChild(el('span', 'gecmis-metin', neden + ' · ' + t('ayar.gecmis.sayilar', { f: n.favoriSayisi, s: n.sayfaSayisi })));
        const don = dugme(t('ayar.gecmis.don'), '', t('ayar.gecmis.donEtiket', { zaman: zaman }));
        don.addEventListener('click', function () {
          geriDon(n, don);
        });
        satir.appendChild(don);
        kap.appendChild(satir);
        if (!ilkDon) ilkDon = don;
      });
      if (odakGecmis && ilkDon) ortak.odakla(ilkDon);
      odakGecmis = false;
    }

    function noktayiDuzelt(n) {
      return {
        id: n && Number.isInteger(n.id) ? n.id : -1,
        zaman: n && Number.isFinite(n.zaman) ? n.zaman : 0,
        neden: n && typeof n.neden === 'string' ? n.neden : 'kaydet',
        favoriSayisi: n && Number.isInteger(n.favoriSayisi) ? n.favoriSayisi : 0,
        sayfaSayisi: n && Number.isInteger(n.sayfaSayisi) ? n.sayfaSayisi : 0,
      };
    }

    let gecmisIstekNo = 0;

    async function gecmisiYenile() {
      if (!ortak.kopru || typeof ortak.kopru.duzenGecmisiniGetir !== 'function') return;
      const no = (gecmisIstekNo += 1);
      try {
        const sonuc = await ortak.kopru.duzenGecmisiniGetir();
        if (no !== gecmisIstekNo) return; // daha yeni bir istek var (aynı olayda birden çok yenileme): eski yanıt listeyi yeniden çizip odağı düşürmez
        if (sonuc && sonuc.ok && Array.isArray(sonuc.noktalar)) {
          noktalar = sonuc.noktalar.slice(0, 20).map(noktayiDuzelt).filter(function (n) {
            return n.id >= 0;
          });
          gecmisHatasi = false;
        } else {
          gecmisHatasi = true;
        }
      } catch (hata) {
        if (no !== gecmisIstekNo) return;
        gecmisHatasi = true;
      }
      gecmisiCiz();
    }

    async function geriDon(nokta, dugmesi) {
      const kirli = typeof ortak.kirliMi === 'function' && ortak.kirliMi();
      if (!ortak.onayIste(kirli ? t('ayar.gecmis.donOnay') + ' ' + t('ayar.gecmis.donKirli') : t('ayar.gecmis.donOnay'))) return;
      dugmesi.disabled = true;
      let yenilendi = false; // başarıda liste yeniden çizilir: eski düğme DOM'dan çıkar, odağı gecmisiCiz verir
      try {
        const sonuc = await ortak.kopru.duzeneDon(nokta.id);
        if (sonuc && sonuc.ok) {
          await ortak.tumunuYenile();
          const parcalar = [t('ayar.gecmis.donuldu', { f: sonuc.favoriSayisi, s: sonuc.sayfaSayisi })];
          if (sonuc.atilan > 0) parcalar.push(ortak.cogul('ayar.gecmis.atilan', sonuc.atilan));
          ortak.bildirimGoster(parcalar.join(' '), sonuc.atilan > 0 ? 'uyari' : 'basarili');
          yenilendi = true;
          odakGecmis = true;
          await gecmisiYenile();
          odakGecmis = false; // liste çizilmediyse (köprü yok / hata) bayrak bir sonraki çizime kalmasın
        } else {
          ortak.bildirimGoster((sonuc && sonuc.hata) || t('ayar.gecmis.donHata'), 'hata');
        }
      } catch (hata) {
        ortak.bildirimGoster(t('ayar.gecmis.donHata'), 'hata');
      } finally {
        dugmesi.disabled = false;
        if (!yenilendi) ortak.odakla(dugmesi); // devre dışı kalan düğme odağı bırakmıştı; liste çizilmediyse geri verilir
      }
    }

    // ============================================================ kullanılamayan favoriyi onarma (o-28)

    function onarmaKur(satir, kimlik, ad) {
      const kutu = el('div', 'onar-kutusu');
      const ac = dugme(t('ayar.onar.dugme'), '', t('ayar.onar.dugmeEtiket', { ad: ad }));
      ac.setAttribute('aria-expanded', 'false');
      kutu.appendChild(ac);
      const panel = el('div', 'onar-kutusu');
      panel.style.display = 'none';
      kutu.appendChild(panel);

      function paneliDoldur() {
        panel.replaceChildren();
        const adaylar = ortak.onarmaAdaylari(kimlik);
        if (adaylar.length === 0) {
          panel.appendChild(el('div', 'cihaz-not', ortak.cihazlarYuklendi() ? t('ayar.onar.adayYok') : t('ayar.onar.cihazlarYok')));
          return;
        }
        panel.appendChild(el('div', 'cihaz-not', t('ayar.onar.ipucu')));
        const yerel = Dil ? Dil.yerelAdi(ortak.dil()) : 'tr-TR';
        const secenekler = [['', t('ayar.onar.sec')]].concat(
          adaylar
            .slice()
            .sort(function (a, b) {
              // Arayüz dilinin alfabesiyle (Ç Ş Ğ İ Ö Ü Z'den sonraya atılmaz); eşitlikte kimlik belirler.
              return String(a.ad).localeCompare(String(b.ad), yerel) || (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0);
            })
            .map(function (c) {
              return [c.entity_id, c.ad + ' (' + c.entity_id + ')'];
            }),
        );
        const sec = secimOlustur(secenekler, '', t('ayar.onar.secEtiket', { ad: ad }));
        const bagla = dugme(t('ayar.onar.bagla'), '');
        bagla.disabled = true;
        const vazgec = dugme(t('ayar.onar.vazgec'), '');
        sec.addEventListener('change', function () {
          bagla.disabled = sec.value === '';
        });
        vazgec.addEventListener('click', kapat);
        bagla.addEventListener('click', function () {
          const yeni = sec.value;
          const aday = adaylar.find(function (c) {
            return c.entity_id === yeni;
          });
          if (!aday) return;
          onar(kimlik, ad, aday, bagla);
        });
        panel.appendChild(sec);
        panel.appendChild(bagla);
        panel.appendChild(vazgec);
      }

      function kapat() {
        panel.style.display = 'none';
        panel.replaceChildren();
        ac.setAttribute('aria-expanded', 'false');
        ortak.odakla(ac);
      }

      ac.addEventListener('click', function () {
        if (panel.style.display === 'none') {
          paneliDoldur();
          panel.style.display = '';
          ac.setAttribute('aria-expanded', 'true');
        } else {
          kapat();
        }
      });
      // satırın seç / bırak tıklaması buraya taşmasın
      kutu.addEventListener('click', function (olay) {
        if (olay && typeof olay.stopPropagation === 'function') olay.stopPropagation();
      });
      satir.appendChild(kutu);
    }

    async function onar(eski, ad, aday, dugmesi) {
      if (!ortak.onayIste(t('ayar.onar.onay', { ad: ad, yeni: aday.ad }))) return;
      dugmesi.disabled = true;
      try {
        const sonuc = await ortak.kopru.favoriyiOnar(eski, aday.entity_id);
        if (sonuc && sonuc.ok) {
          await ortak.favoriOnarildi(eski, aday.entity_id);
          ortak.bildirimGoster(t('ayar.onar.tamam', { ad: ad }), 'basarili');
          await gecmisiYenile();
        } else {
          ortak.bildirimGoster((sonuc && sonuc.hata) || t('ayar.onar.hata'), 'hata');
          dugmesi.disabled = false;
        }
      } catch (hata) {
        ortak.bildirimGoster(t('ayar.onar.hata'), 'hata');
        dugmesi.disabled = false;
      }
    }

    // ============================================================ ortak

    /** Dil değişti: sayfalar ve geçmiş yeni dilde yeniden yazılır (satırlar cihaz listesiyle birlikte çizilir). */
    function metinleriYenile() {
      sayfalariCiz();
      gecmisiCiz();
    }

    sayfalariCiz();
    gecmisiCiz();

    return {
      // karo görünümü
      favorileriYukle: favorileriYukle,
      favoriGorunumuKirli: favoriGorunumuKirli,
      favoriYukunuEkle: favoriYukunuEkle,
      /** Kayıtlı + henüz kaydedilmemiş değişiklikle "tepsiye sabitle" açık mı? (Sıra ve tepsi sayacı için) */
      tepsideMi: function (kimlik) {
        return etkinGorunum(kimlik).tepsi === true;
      },
      gorunumKur: gorunumKur,
      // sıra
      siraTutamaciEkle: siraTutamaciEkle,
      siraSatiriniBagla: siraSatiriniBagla,
      siraDuyur: siraDuyur,
      // sayfalar
      sayfalariYukle: sayfalariYukle,
      sayfalariTazele: sayfalariTazele,
      sayfalarAnlik: function () {
        return sayfalariNormallestir(taslak);
      },
      sayfalarDegerleri: sayfalariNormallestir,
      sayfalarKirli: sayfalarKirli,
      kayitliSayfalar: function () {
        return JSON.parse(kayitliSayfalar);
      },
      // geçmiş ve onarım
      gecmisiYenile: gecmisiYenile,
      onarmaKur: onarmaKur,
      // favori kimliği değişti (onarım)
      kimlikDegisti: function (eski, yeni) {
        gorunumKimligiDegisti(eski, yeni);
        sayfaKimligiDegisti(eski, yeni);
      },
      metinleriYenile: metinleriYenile,
    };
  }

  kok.EvAyarlarDuzen = {
    EMOJI_SECIMI: EMOJI_SECIMI,
    EMOJI_ONERILERI: EMOJI_ONERILERI,
    sayfalariNormallestir: sayfalariNormallestir,
    suruklemeHedefi: suruklemeHedefi,
    zamanMetni: zamanMetni,
    simgeSecimi: simgeSecimi,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
