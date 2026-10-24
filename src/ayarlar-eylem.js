/*
 * Ayarlar sayfasının eylem bölümü (renderer) — 1.4.0 eylem grubu (o-17 etkinlik geçmişi, o-12 geri al, o-15 gecikmeli eylem,
 * o-14 oda grubu, o-46 palette diğer cihazlar). ayarlar.js bu dosyayı `window.EvAyarlarEylem.kur(ortak)` ile bağlar; yüklenmezse
 * Ayarlar bugünkü gibi çalışır.
 *
 *  - Ayar alanları (ALANLAR tablosu): onay kutuları / seçimler / sayılar genel ayarlarla birlikte kaydedilir; doğrulama ana süreçte
 *    (src/lib/ayar-alanlari.js), geçersiz değer mevcut olanı korur.
 *  - Etkinlik geçmişi (o-17): ana süreçten son 200 kayıt okunur, tablo satırları yalnız textContent ile yazılır; "Geçmişi temizle" yerel kaydı siler.
 *
 * Tüm metin textContent ile yazılır (HTML ataması yok); metinler sözlükten (t) gelir. Bu dosya `require` kullanmaz.
 */
(function (kok) {
  'use strict';

  const Dil = kok.EvDil || null;

  /**
   * Ayar alanları: ad = ayar-alanlari.js'teki alan adı = HTML öğe kimliği. tur: 'mantiksal' | 'secenek' | 'sayi' | 'metin'.
   * Sayılar karşılaştırma ve gönderim için metin olarak taşınır (ayarlar.js'teki diğer sayı alanları gibi).
   */
  const ALANLAR = [
    { ad: 'etkinlikGecmisi', tur: 'mantiksal', varsayilan: true },
    // o-12 geri al: geriAlKisayolu bir genel kısayoldur (kisayol: true): ayarlar.js'in kısayol kutusu davranışı (tuşa basarak yakalama, anlık denetim) bağlanır
    { ad: 'geriAl', tur: 'mantiksal', varsayilan: true },
    { ad: 'geriAlSureDk', tur: 'sayi', varsayilan: 10, en_az: 1, en_cok: 60 },
    { ad: 'geriAlKisayolu', tur: 'metin', varsayilan: 'Control+Alt+Z', kisayol: true },
    { ad: 'gecikmeliEylem', tur: 'mantiksal', varsayilan: true }, // o-15 zamanlı eylemler
    { ad: 'sonDegisenler', tur: 'mantiksal', varsayilan: true }, // o-18 palette "@" son değişenler
    { ad: 'panelGruplama', tur: 'secenek', varsayilan: 'tur', secenekler: ['tur', 'oda'] }, // o-14 panel gruplaması: tür / oda
    { ad: 'paletDigerCihazlar', tur: 'mantiksal', varsayilan: false }, // o-46 palette "*" ile favori olmayan güvenli cihazlar (varsayılan KAPALI)
  ];

  // Sözlük anahtarları (düz tablolar: kullanılmayan / eksik anahtar testlerle yakalanır)
  const KAYNAK_ANAHTARLARI = {
    panel: 'ayar.etkinlik.kaynak.panel',
    palet: 'ayar.etkinlik.kaynak.palet',
    'tepsi-menu': 'ayar.etkinlik.kaynak.tepsiMenu',
    kisayol: 'ayar.etkinlik.kaynak.kisayol',
    'komut-satiri': 'ayar.etkinlik.kaynak.komutSatiri',
    masaustu: 'ayar.etkinlik.kaynak.masaustu',
    gecikmeli: 'ayar.etkinlik.kaynak.gecikmeli',
    // 1.4.0 dış tetikler (src/lib/eylem-sinifi.js DIS_KAYNAKLAR) ve bildirim düğmesi (main.js itmeEylemi)
    jumplist: 'ayar.etkinlik.kaynak.jumplist',
    'kisayol-dosyasi': 'ayar.etkinlik.kaynak.kisayolDosyasi',
    'yerel-api': 'ayar.etkinlik.kaynak.yerelApi',
    protokol: 'ayar.etkinlik.kaynak.protokol',
    'pc-olayi': 'ayar.etkinlik.kaynak.pcOlayi',
    toplanti: 'ayar.etkinlik.kaynak.toplanti',
    bildirim: 'ayar.etkinlik.kaynak.bildirim',
  };
  const ISLEM_ANAHTARLARI = {
    toggle: 'ayar.etkinlik.islem.toggle',
    turn_on: 'ayar.etkinlik.islem.turnOn',
    turn_off: 'ayar.etkinlik.islem.turnOff',
    parlaklik: 'ayar.etkinlik.islem.parlaklik',
    set_percentage: 'ayar.etkinlik.islem.hiz',
    press: 'ayar.etkinlik.islem.press',
    'tek-tik': 'ayar.etkinlik.islem.tekTik',
    'geri-al': 'ayar.etkinlik.islem.geriAl',
    'oda-kapat': 'ayar.etkinlik.islem.odaKapat',
    'gecikmeli-kur': 'ayar.etkinlik.islem.gecikmeliKur',
    'gecikmeli-iptal': 'ayar.etkinlik.islem.gecikmeliIptal',
    'dis-tetik': 'ayar.etkinlik.islem.disTetik', // dış tetik kapısında durdurulan istek (main.js disTetikOlayiniGecmiseYaz)
    'bildirim-dugme': 'ayar.etkinlik.islem.bildirimDugme',
  };
  // Kapıda durdurulan dış tetiklerin ve bildirim düğmesinin neden kodları; tabloda olmayan kod (ör. 'ha-hatasi/ag') olduğu gibi yazılır.
  const NEDEN_ANAHTARLARI = {
    kapali: 'ayar.etkinlik.neden.kapali',
    'kaynak-izinsiz': 'ayar.etkinlik.neden.kaynakIzinsiz',
    'onay-bekliyor': 'ayar.etkinlik.neden.onayBekliyor',
    'anlik-yok': 'ayar.etkinlik.neden.anlikYok',
    'anahtar-yok': 'ayar.etkinlik.neden.anahtarYok',
    bulunamadi: 'ayar.etkinlik.neden.bulunamadi',
    belirsiz: 'ayar.etkinlik.neden.belirsiz',
    reddedildi: 'ayar.etkinlik.neden.reddedildi',
    hata: 'ayar.etkinlik.neden.hata',
  };
  const SONUC_ANAHTARLARI = {
    ok: 'ayar.etkinlik.sonuc.ok',
    hata: 'ayar.etkinlik.sonuc.hata',
    iptal: 'ayar.etkinlik.sonuc.iptal',
    atlandi: 'ayar.etkinlik.sonuc.atlandi',
  };

  // ---------------------------------------------------------------- saf yardımcılar

  /** Ham değeri alanın türüne göre düzeltir (geçersizse varsayılan). Sayılar metin olarak döner. */
  function alanDegeri(alan, ham) {
    if (alan.tur === 'mantiksal') return typeof ham === 'boolean' ? ham : alan.varsayilan;
    if (alan.tur === 'secenek') return alan.secenekler.indexOf(ham) >= 0 ? ham : alan.varsayilan;
    if (alan.tur === 'sayi') {
      const n = typeof ham === 'number' ? ham : typeof ham === 'string' && ham.trim() !== '' ? Number(ham) : NaN;
      return String(Number.isInteger(n) && n >= alan.en_az && n <= alan.en_cok ? n : alan.varsayilan);
    }
    return typeof ham === 'string' ? ham.trim() : alan.varsayilan;
  }

  /** Etkinlik zamanı (kullanıcının dilinde, yerel saat). */
  function zamanMetni(zaman, dilKodu) {
    try {
      return new Date(zaman).toLocaleString(Dil ? Dil.yerelAdi(dilKodu) : 'tr-TR', { dateStyle: 'short', timeStyle: 'medium' });
    } catch (hata) {
      return '';
    }
  }

  // ---------------------------------------------------------------- denetleyici

  /**
   * @param {object} ortak ayarlar.js'in verdikleri: belge, kopru (window.evPaneli), cevir(anahtar, değişkenler), cogul(anahtar, n, değişkenler),
   *   dil(), kirliGuncelle(), bildirimGoster(mesaj, tur), onayIste(metin) (confirm); isteğe bağlı kısayol yardımcıları: kisayolBagla(girdi, {bosIzinli, kutu, degisti}),
   *   kisayolNormal(metin), kisayolGoster(metin), uyariKutusu(kutu, mesajlar)
   * @returns {object|null} Gerekli öğeler yoksa null (Ayarlar eylem bölümü olmadan çalışır)
   */
  function kur(ortak) {
    const belge = ortak.belge;
    const kopru = ortak.kopru;
    const t = ortak.cevir;
    const onayIste = ortak.onayIste || function () { return true; };
    const oge = function (kimlik) {
      return belge.getElementById(kimlik);
    };
    for (let i = 0; i < ALANLAR.length; i += 1) {
      if (!oge(ALANLAR[i].ad)) return null;
    }
    const liste = oge('etkinlikListesi');
    const durum = oge('etkinlikDurum');
    const btnYenile = oge('btnEtkinlikYenile');
    const btnTemizle = oge('btnEtkinlikTemizle');
    if (!liste || !durum || !btnYenile || !btnTemizle) return null;

    function olustur(etiket, sinif, metin) {
      const e = belge.createElement(etiket);
      if (sinif) e.className = sinif;
      if (metin !== undefined) e.textContent = metin;
      return e;
    }

    // ============================================================ ayar alanları

    /** Kısayol alanları kaydedilen biçimde ("ctrl alt z" -> "Control+Alt+Z") karşılaştırılır; boş = kısayol yok. */
    function kisayolNormal(metin) {
      const duz = String(metin === undefined || metin === null ? '' : metin).trim();
      if (duz === '') return '';
      return ortak.kisayolNormal ? ortak.kisayolNormal(duz) : duz;
    }

    function anlik() {
      const sonuc = {};
      ALANLAR.forEach(function (alan) {
        const girdi = oge(alan.ad);
        if (alan.tur === 'mantiksal') sonuc[alan.ad] = girdi.checked === true;
        else if (alan.kisayol) sonuc[alan.ad] = kisayolNormal(girdi.value);
        else if (alan.tur === 'sayi') sonuc[alan.ad] = String(girdi.value).trim(); // ham metin: geçersiz değer düzeltilip gizlenmez, kayıt öncesi denetim (ayarlar.js) ve ana süreç karar verir
        else sonuc[alan.ad] = alanDegeri(alan, girdi.value);
      });
      return sonuc;
    }

    /** Sunucu özetinin aynı biçimdeki karşılığı. */
    function degerleri(sonuc) {
      const s = sonuc && typeof sonuc === 'object' ? sonuc : {};
      const d = {};
      ALANLAR.forEach(function (alan) {
        d[alan.ad] = alan.kisayol ? kisayolNormal(typeof s[alan.ad] === 'string' ? s[alan.ad] : alan.varsayilan) : alanDegeri(alan, s[alan.ad]);
      });
      return d;
    }

    function uygula(d) {
      ALANLAR.forEach(function (alan) {
        const girdi = oge(alan.ad);
        if (alan.tur === 'mantiksal') girdi.checked = d[alan.ad] === true;
        else if (alan.kisayol) girdi.value = ortak.kisayolGoster ? ortak.kisayolGoster(d[alan.ad]) : d[alan.ad];
        else girdi.value = d[alan.ad];
      });
    }

    const kisayolUyarilari = oge('geriAlKisayolUyarilari');
    ALANLAR.forEach(function (alan) {
      const girdi = oge(alan.ad);
      if (alan.kisayol && ortak.kisayolBagla) {
        ortak.kisayolBagla(girdi, { bosIzinli: true, kutu: kisayolUyarilari, degisti: ortak.kirliGuncelle });
        return;
      }
      girdi.addEventListener('input', ortak.kirliGuncelle);
      girdi.addEventListener('change', ortak.kirliGuncelle);
    });

    /** Ana sürecin kısayol planından (kisayolDurumlari) geri alma kısayolunun sorunu varsa iletisi gösterilir (çakışma, kayıt edilemedi). */
    function kisayolDurumlari(liste) {
      if (!kisayolUyarilari || !ortak.uyariKutusu) return;
      const oge2 = Array.isArray(liste) ? liste.find(function (k) { return k && k.tur === 'geri-al'; }) : null;
      const mesaj = oge2 && oge2.durum !== 'etkin' ? oge2.mesaj || t('ayar.kisayol.uygulanamadi') : '';
      ortak.uyariKutusu(kisayolUyarilari, mesaj ? [mesaj] : []);
    }

    // ============================================================ etkinlik geçmişi (o-17)

    function etiket(tablo, kod, onek) {
      const anahtar = Object.prototype.hasOwnProperty.call(tablo, kod) ? tablo[kod] : null;
      return anahtar ? t(anahtar) : onek === undefined ? kod : onek + kod;
    }

    function etkinlikSatiri(k) {
      const satir = olustur('div', 'yedek-satir');
      satir.setAttribute('role', 'listitem');
      const bilgi = olustur('div', '', '');
      bilgi.appendChild(olustur('div', '', k.ad || k.kimlik || '—'));
      const parcalar = [zamanMetni(k.zaman, ortak.dil()), etiket(KAYNAK_ANAHTARLARI, k.kaynak), etiket(ISLEM_ANAHTARLARI, k.islem)];
      if (k.neden) parcalar.push(etiket(NEDEN_ANAHTARLARI, k.neden));
      bilgi.appendChild(olustur('div', 'yedek-bilgi', parcalar.join(' · ')));
      const sonuc = olustur('span', 'sira-konum' + (k.sonuc === 'ok' ? ' sira-konum-tepsi' : ''), etiket(SONUC_ANAHTARLARI, k.sonuc));
      satir.appendChild(bilgi);
      satir.appendChild(sonuc);
      return satir;
    }

    let sonKayitlar = [];

    function etkinlikCiz(kayitlar) {
      sonKayitlar = Array.isArray(kayitlar) ? kayitlar : [];
      liste.replaceChildren();
      sonKayitlar.forEach(function (k) {
        liste.appendChild(etkinlikSatiri(k));
      });
      durum.textContent = sonKayitlar.length === 0 ? t('ayar.etkinlik.yok') : ortak.cogul('ayar.etkinlik.sayi', sonKayitlar.length);
      btnTemizle.disabled = sonKayitlar.length === 0;
    }

    function etkinlikYenile() {
      return Promise.resolve()
        .then(function () {
          return kopru.etkinlikListesi();
        })
        .then(
          function (yanit) {
            if (yanit && yanit.ok) etkinlikCiz(yanit.kayitlar);
            else durum.textContent = t('ayar.etkinlik.alinamadi');
          },
          function () {
            durum.textContent = t('ayar.etkinlik.alinamadi');
          },
        );
    }

    function etkinlikTemizle() {
      // Tüm yerel kayıt tek tıkla silinirdi; diğer silme düğmeleri (üstbilgi, sertifika, sayfa...) gibi önce sorulur.
      if (!onayIste(t('ayar.etkinlik.temizleOnay'))) return Promise.resolve();
      btnTemizle.disabled = true;
      return Promise.resolve()
        .then(function () {
          return kopru.etkinlikTemizle();
        })
        .then(
          function (yanit) {
            if (yanit && yanit.ok) {
              etkinlikCiz([]);
              durum.textContent = t('ayar.etkinlik.temizlendi');
            } else {
              durum.textContent = t('ayar.etkinlik.alinamadi');
              btnTemizle.disabled = sonKayitlar.length === 0;
            }
          },
          function () {
            durum.textContent = t('ayar.etkinlik.alinamadi');
            btnTemizle.disabled = sonKayitlar.length === 0;
          },
        );
    }

    btnYenile.addEventListener('click', etkinlikYenile);
    btnTemizle.addEventListener('click', etkinlikTemizle);

    // ============================================================ ortak

    /** Dil değişti: tablo yeni dilde yeniden yazılır. */
    function metinleriYenile() {
      etkinlikCiz(sonKayitlar);
    }

    /** Ayarlar açıldığında / bölüm görünür olduğunda okunacak veriler. */
    function yenile() {
      return etkinlikYenile();
    }

    etkinlikCiz([]);

    return {
      anlik: anlik,
      degerleri: degerleri,
      uygula: uygula,
      kisayolDurumlari: kisayolDurumlari,
      yenile: yenile,
      metinleriYenile: metinleriYenile,
    };
  }

  kok.EvAyarlarEylem = {
    ALANLAR: ALANLAR,
    alanDegeri: alanDegeri,
    zamanMetni: zamanMetni,
    kur: kur,
  };
})(typeof window !== 'undefined' ? window : globalThis);
