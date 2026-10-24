/*
 * Hızlı panelin bilgi bölümleri (renderer) — o-04 sensör şeridi ve karoları, o-07 yapılacaklar, o-08 üst kartlar (saat, hava,
 * varlık), o-09 mini grafik ve gösterge, o-10 takvim, o-11 sensör geçmişi ve karşılaştırma. yuzey-sayfa.js bu modülü çağırır;
 * model ana süreçten gelir (src/lib/bilgi-modeli.js rendererBilgi), geçmiş / takvim / yapılacaklar verisi yuzey:oku ile,
 * liste eylemleri (ekle, tamamla, sil) yuzey:calistir ile istenir. Bu modül ağa, anahtara, adrese ya da başka bir kanala dokunmaz.
 *
 *  - Tüm metin textContent ile yazılır; grafikler lib/grafik.js betimlerinden createElementNS ile kurulur (satır içi stil yok, CSP).
 *  - Kapı Kuralı ana süreçtedir: kapı/kilit sözcüklü ya da kapı sınıflı hiçbir sensör, takvim başlığı ya da liste öğesi bu modüle
 *    hiç gelmez. Bu modül kendi başına varlık seçmez; yalnız modeldeki kimlikleri okutur.
 *  - Okumalar yalnız panel açıkken istenir, önbellekli ve hız sınırlıdır; hata ya da boş dönem kullanıcıya ayrı söylenir.
 *  - Yapılacaklar: ekleme ve tamamlama zararsızdır; silme ana süreçte zorunlu onaylıdır (basılı tutma). Palet hızlı eklemesi
 *    ("liste süt") yalnız todo.add_item'a gider: serbest metin başka hiçbir eyleme gönderilmez.
 *
 * ctx (yuzey-sayfa.js verir): doc, t(anahtar, degisken), dil(), olustur(etiket, sinif, metin), odakKaydet(anahtar, oge),
 * odakIste(anahtar) (sonraki çizimde odak bu anahtara), satirEkle(ogeler), oku(istek) -> Promise, calistir(yuk, karo, oge) ->
 * Promise<sonuc>, basiliTutma(karo, gorsel, ekYuk, bitti) -> { basla, birak }, donukBaslat(), donukBitir(), yenidenCiz(),
 * ipucu(metin), simdi(), zamanlayici { setTimeout, clearTimeout }, acikMi(), Grafik (lib/grafik.js), Bicim (lib/bilgi-bicim.js),
 * izgaraKolon.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvYuzeyBilgi = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAAT_MS = 3_600_000;
  const GECMIS_YENILEME_MS = 60_000;
  const TAKVIM_YENILEME_MS = 120_000;
  const LISTE_YENILEME_MS = 15_000;
  const HATA_YENIDEN_MS = 30_000;
  const CIZIM_GECIKME_MS = 40;
  const GIRDI_SINIRI = 100; // bozuk / şişirilmiş dizi işlenmeden önce kesilir; geçerli kalemler asıl sınıra göre ayrıca kırpılır
  const EN_COK_SERIT = 6;
  const GRAFIK_TURLERI = ['otomatik', 'cizgi', 'gosterge', 'yok']; // sensör favorisinin grafik biçimi (src/lib/karo-gorunum.js ile aynı küme)
  const EN_COK_SENSOR = 40;
  const EN_COK_TAKVIM = 4;
  const EN_COK_LISTE = 4;
  const EN_COK_GRAFIKLI = 14;
  const GECMIS_PARCA = 7; // yuzey:oku geçmiş isteği en çok 7 varlık
  const EN_COK_ETKINLIK = 8;
  const EN_COK_ACIK_OGE = 8;
  const EN_COK_BITEN_OGE = 6;
  const EN_COK_SERI = 7;
  const TAHMIN_YENILEME_MS = 600_000; // ana süreç önbelleği de 10 dk
  const TAHMIN_ISTEK = { gunluk: 'daily', saatlik: 'hourly' }; // yuzey:oku { tur: 'hava', tahmin }
  const EN_COK_TAHMIN = { gunluk: 5, saatlik: 8 };
  const TAHMIN_GIRDI_SINIRI = 48;
  const ARALIKLAR = Object.freeze([1, 6, 24, 168]);
  const VARSAYILAN_DETAY_SAATI = 24;
  const GRAFIK_GENISLIK = 320;
  const GRAFIK_YUKSEKLIK = 170;

  // Sözlük anahtarları sabit dizelerle yazılır (test/yuzey-ceviri.test.js kullanılan her anahtarı kaynaktan okur).
  const ARALIK_KISA = { 1: 'yuzey.bilgi.aralik.1', 6: 'yuzey.bilgi.aralik.6', 24: 'yuzey.bilgi.aralik.24', 168: 'yuzey.bilgi.aralik.168' };
  const ARALIK_ADI = { 1: 'yuzey.bilgi.aralik.adi.1', 6: 'yuzey.bilgi.aralik.adi.6', 24: 'yuzey.bilgi.aralik.adi.24', 168: 'yuzey.bilgi.aralik.adi.168' };
  const IKILI_METIN = {
    motion: ['yuzey.bilgi.ikili.motion.acik', 'yuzey.bilgi.ikili.motion.kapali'],
    occupancy: ['yuzey.bilgi.ikili.occupancy.acik', 'yuzey.bilgi.ikili.occupancy.kapali'],
    presence: ['yuzey.bilgi.ikili.presence.acik', 'yuzey.bilgi.ikili.presence.kapali'],
    moisture: ['yuzey.bilgi.ikili.moisture.acik', 'yuzey.bilgi.ikili.moisture.kapali'],
    smoke: ['yuzey.bilgi.ikili.smoke.acik', 'yuzey.bilgi.ikili.smoke.kapali'],
    gas: ['yuzey.bilgi.ikili.gas.acik', 'yuzey.bilgi.ikili.gas.kapali'],
    carbon_monoxide: ['yuzey.bilgi.ikili.carbon_monoxide.acik', 'yuzey.bilgi.ikili.carbon_monoxide.kapali'],
    battery: ['yuzey.bilgi.ikili.battery.acik', 'yuzey.bilgi.ikili.battery.kapali'],
    problem: ['yuzey.bilgi.ikili.problem.acik', 'yuzey.bilgi.ikili.problem.kapali'],
    connectivity: ['yuzey.bilgi.ikili.connectivity.acik', 'yuzey.bilgi.ikili.connectivity.kapali'],
  };
  const HAVA_METIN = {
    sunny: 'yuzey.bilgi.hava.durum.sunny',
    'clear-night': 'yuzey.bilgi.hava.durum.clearNight',
    cloudy: 'yuzey.bilgi.hava.durum.cloudy',
    partlycloudy: 'yuzey.bilgi.hava.durum.partlycloudy',
    rainy: 'yuzey.bilgi.hava.durum.rainy',
    pouring: 'yuzey.bilgi.hava.durum.pouring',
    snowy: 'yuzey.bilgi.hava.durum.snowy',
    'snowy-rainy': 'yuzey.bilgi.hava.durum.snowyRainy',
    fog: 'yuzey.bilgi.hava.durum.fog',
    hail: 'yuzey.bilgi.hava.durum.hail',
    lightning: 'yuzey.bilgi.hava.durum.lightning',
    'lightning-rainy': 'yuzey.bilgi.hava.durum.lightningRainy',
    windy: 'yuzey.bilgi.hava.durum.windy',
    'windy-variant': 'yuzey.bilgi.hava.durum.windyVariant',
    exceptional: 'yuzey.bilgi.hava.durum.exceptional',
  };

  const sonluMu = (n) => typeof n === 'number' && Number.isFinite(n);
  const sayiVeyaNull = (n) => (sonluMu(n) ? n : null);
  const metinVeyaNull = (m, sinir) => (typeof m === 'string' ? m.slice(0, sinir) : null);
  const dizi = (d) => (Array.isArray(d) ? d : []);
  const sinirliMetin = (d, sinir) => String(d === undefined || d === null ? '' : d).slice(0, sinir);

  // ---------------------------------------------------------------- model (renderer tarafı savunma)

  function ozellikDuzelt(alan, o) {
    if (!o || typeof o !== 'object') return null;
    if (alan === 'sensor') {
      return {
        deger: metinVeyaNull(o.deger, 40),
        sayi: sayiVeyaNull(o.sayi),
        birim: metinVeyaNull(o.birim, 12),
        sinif: metinVeyaNull(o.sinif, 30),
        hassasiyet: sayiVeyaNull(o.hassasiyet),
        enAz: sayiVeyaNull(o.enAz),
        enCok: sayiVeyaNull(o.enCok),
      };
    }
    if (alan === 'binary_sensor') return { acik: typeof o.acik === 'boolean' ? o.acik : null, sinif: metinVeyaNull(o.sinif, 30) };
    if (alan === 'weather') {
      return {
        durum: metinVeyaNull(o.durum, 30),
        sicaklik: sayiVeyaNull(o.sicaklik),
        birim: metinVeyaNull(o.birim, 6),
        nem: sayiVeyaNull(o.nem),
        ruzgar: sayiVeyaNull(o.ruzgar),
        ruzgarBirim: metinVeyaNull(o.ruzgarBirim, 8),
        basinc: sayiVeyaNull(o.basinc),
      };
    }
    return null;
  }

  function karoDuzelt(k, izinliAlanlar) {
    if (!k || typeof k.id !== 'string' || k.id.length > 120) return null;
    const alan = sinirliMetin(k.alan, 20);
    if (izinliAlanlar.indexOf(alan) < 0) return null;
    return {
      id: k.id,
      etiket: sinirliMetin(k.etiket, 60),
      alan: alan,
      kullanilabilir: k.kullanilabilir === true,
      ulasilamiyor: k.ulasilamiyor === true,
      ozellik: ozellikDuzelt(alan, k.ozellik),
      grafikTuru: GRAFIK_TURLERI.indexOf(k.grafikTuru) >= 0 ? k.grafikTuru : 'otomatik', // sensör grafik biçimi (favori ayarı)
    };
  }

  /**
   * Ana süreçten gelen bilgi modelini (rendererBilgi) sınırlı ve türü doğrulanmış hâle getirir; bozuk girdide null.
   * medyaKaroDuzelt (isteğe bağlı): 'medya' üst kartının tam karosunu (cihaz kartı alanlarıyla) doğrulayan işlev; verilmezse medya kartı
   * oynatıcısız sayılır ("kullanılamıyor" notu).
   */
  function modelDuzelt(ham, medyaKaroDuzelt) {
    if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
    const a = ham.ayar && typeof ham.ayar === 'object' ? ham.ayar : {};
    const SENSORLER = ['sensor', 'binary_sensor'];
    const kartlar = [];
    dizi(ham.kartlar).slice(0, GIRDI_SINIRI).forEach(function (k) {
      if (!k || typeof k !== 'object') return;
      const tur = k.tur === 'hava' || k.tur === 'varlik' || k.tur === 'medya' ? k.tur : 'saat';
      let karo = null;
      if (tur === 'medya') {
        karo = k.karo && typeof medyaKaroDuzelt === 'function' ? medyaKaroDuzelt(k.karo) : null;
        if (karo && karo.alan !== 'media_player') karo = null; // medya yuvası yalnız oynatıcı gösterir
      } else if (k.karo) {
        karo = karoDuzelt(k.karo, tur === 'hava' ? ['weather'] : SENSORLER);
      }
      if (tur === 'varlik' && !karo) return;
      if (kartlar.length < 2) kartlar.push({ yuva: k.yuva === 2 ? 2 : 1, tur: tur, karo: karo, secilmedi: k.secilmedi === true });
    });
    const satir = function (d, sayiAlani) {
      if (!d || typeof d.id !== 'string' || d.id.length > 120) return null;
      const s = { id: d.id, etiket: sinirliMetin(d.etiket, 60), kullanilabilir: d.kullanilabilir === true };
      s[sayiAlani] = typeof d[sayiAlani] === 'boolean' ? d[sayiAlani] : Number.isInteger(d[sayiAlani]) ? d[sayiAlani] : null;
      return s;
    };
    return {
      ayar: {
        saatBicimi: ['sistem', '24', '12'].indexOf(a.saatBicimi) >= 0 ? a.saatBicimi : 'sistem',
        tarihBicimi: ['orta', 'kisa', 'uzun', 'yok'].indexOf(a.tarihBicimi) >= 0 ? a.tarihBicimi : 'orta',
        takvimGunSayisi: Number.isInteger(a.takvimGunSayisi) && a.takvimGunSayisi >= 1 && a.takvimGunSayisi <= 14 ? a.takvimGunSayisi : 3,
        sensorGrafik: a.sensorGrafik !== false,
        sensorGrafikSaat: [1, 6, 24].indexOf(a.sensorGrafikSaat) >= 0 ? a.sensorGrafikSaat : 6,
        pilEsigi: Number.isInteger(a.pilEsigi) && a.pilEsigi >= 1 && a.pilEsigi <= 100 ? a.pilEsigi : 20,
        havaTahmini: ['kapali', 'gunluk', 'saatlik'].indexOf(a.havaTahmini) >= 0 ? a.havaTahmini : 'kapali', // alan hiç gelmediyse (eski model) tahmin şeridi çizilmez
      },
      kartlar: kartlar,
      serit: dizi(ham.serit).slice(0, GIRDI_SINIRI).map(function (k) { return karoDuzelt(k, SENSORLER); }).filter(Boolean).slice(0, EN_COK_SERIT),
      sensorler: dizi(ham.sensorler).slice(0, GIRDI_SINIRI).map(function (k) { return karoDuzelt(k, SENSORLER); }).filter(Boolean).slice(0, EN_COK_SENSOR),
      takvimler: dizi(ham.takvimler).slice(0, GIRDI_SINIRI).map(function (d) { return satir(d, 'mesgul'); }).filter(Boolean).slice(0, EN_COK_TAKVIM),
      listeler: dizi(ham.listeler).slice(0, GIRDI_SINIRI).map(function (d) { return satir(d, 'acikSayisi'); }).filter(Boolean).slice(0, EN_COK_LISTE),
      hizliListe: typeof ham.hizliListe === 'string' ? ham.hizliListe.slice(0, 120) : '',
    };
  }

  /**
   * Palet hızlı ekleme (o-07): sorgu "liste <metin>" biçimindeyse ve hızlı liste seçiliyse { metin, liste: { id, etiket } }; yoksa null.
   * Çözme kuralı lib/bilgi-bicim.js hizliEkleCoz'dadır; hedef yalnız ayardaki (kayıtlı) liste olabilir.
   */
  function hizliEkleSatiri(bilgi, sorgu, Bicim) {
    if (!bilgi || !Bicim || typeof Bicim.hizliEkleCoz !== 'function' || !bilgi.hizliListe) return null;
    const cozum = Bicim.hizliEkleCoz(sorgu);
    if (!cozum) return null;
    const liste = dizi(bilgi.listeler).find(function (l) { return l.id === bilgi.hizliListe && l.kullanilabilir; });
    return liste ? { metin: cozum.metin, liste: { id: liste.id, etiket: liste.etiket } } : null;
  }

  // ---------------------------------------------------------------- modül

  function olustur(ctx) {
    const doc = ctx.doc;
    const Grafik = ctx.Grafik;
    const Bicim = ctx.Bicim;
    const Ikon = ctx.Ikon || null; // 1.7.0 arayüz ikonları (lib/ikon-seti.js); yoksa metin simgeleri
    const t = function (anahtar, degisken) { return ctx.t(anahtar, degisken); };
    const el = ctx.olustur;

    let bilgi = null;
    let cizimZamanlayicisi = null;
    let saatZamanlayicisi = null;
    let saatOgeleri = null; // { deger, tarih } son çizilen saat kartı
    let yazim = 0; // liste ekleme kutusunda yazılıyor (yeniden çizim ertelenir)
    const gecmis = new Map(); // kimlik -> { t, durum: 'tamam' | 'hata', noktalar }   (mini grafik, ayardaki saat)
    const takvim = new Map(); // kimlik -> { t, durum, etkinlikler }
    const listeler = new Map(); // kimlik -> { t, durum, ogeler }
    const ucta = new Set(); // süren istekler ('g:kimlik', 't:kimlik', 'l:kimlik', 'h:kimlik|tur')
    const tahminler = new Map(); // 'kimlik|tur' -> { t, durum: 'tamam' | 'hata', ogeler }   (hava tahmini)
    let tahminTuru = null; // paneldeki "Günlük / Saatlik" seçimi (null: ayardaki değer); ayar değişince bırakılır
    let tahminAyari = ''; // en son görülen havaTahmini ayarı
    let tahminAcik = false; // 1.7.0: tahmin, hero'daki havaya tıklayınca açılır (panel her açılışta kapalı başlar)
    let medyaAcik = false; // 1.7.0: medya hapının gövdesine tıklayınca tam medya kartı içeriğin başında açılır
    const taslak = new Map(); // liste kimliği -> yazılmakta olan metin
    const ekleniyor = new Set(); // yanıt bekleyen add_item isteği olan listeler (yeniden çizimde kutu / düğme yenilense de kilit kalır)
    const aktifGirdiler = new Map(); // liste kimliği -> en son kurulan ekleme kutusu
    const aktifDugmeler = new Map(); // liste kimliği -> en son kurulan Ekle düğmesi
    const tazeIstenen = new Set(); // sonraki okumada önbelleği atlanacak listeler (palet hızlı eklemesinden sonra)
    const bitenAcik = new Set(); // "Tamamlananlar" açılmış listeler
    let detay = null; // { kimlik, saat, secili: [], durum: 'bekliyor' | 'tamam' | 'hata', veri: {}, no }
    let istekNo = 0;
    let gecmisSaati = 0; // mini grafik önbelleğinin kapsadığı saat (ayar değişirse sıfırlanır)
    let takvimGunu = null; // takvim önbelleğinin kapsadığı gün sayısı (ayar değişirse sıfırlanır)

    const dil = function () { return typeof ctx.dil === 'function' ? ctx.dil() : 'tr'; };
    const simdi = function () { return ctx.simdi(); };

    // ------------------------------------------------------------ yardımcılar

    function cizimIste() {
      if (cizimZamanlayicisi !== null) return;
      cizimZamanlayicisi = ctx.zamanlayici.setTimeout(function () {
        cizimZamanlayicisi = null;
        ctx.yenidenCiz();
      }, CIZIM_GECIKME_MS);
    }

    function haritadaBul(kimlik) {
      if (!bilgi) return null;
      const hepsi = bilgi.serit.concat(bilgi.sensorler, bilgi.kartlar.map(function (k) { return k.karo; }).filter(Boolean));
      return hepsi.find(function (k) { return k.id === kimlik; }) || null;
    }

    /** Karonun değer metni: sayı + birim, ikili sensör için sınıfa uygun sözcük, değer yoksa "—". */
    function degerMetni(karo) {
      if (karo.ulasilamiyor) return t('yuzey.bilgi.sensor.ulasilamiyor');
      const o = karo.ozellik;
      if (!o) return t('yuzey.bilgi.bosDeger');
      if (karo.alan === 'binary_sensor') {
        if (o.acik === null) return t('yuzey.bilgi.bosDeger');
        const ozel = o.sinif && Object.prototype.hasOwnProperty.call(IKILI_METIN, o.sinif) ? IKILI_METIN[o.sinif] : null;
        if (ozel) return t(ozel[o.acik ? 0 : 1]);
        return t(o.acik ? 'yuzey.bilgi.ikili.acik' : 'yuzey.bilgi.ikili.kapali');
      }
      const sayi = Bicim.sensorSayisiMetni(o, { dil: dil() });
      if (sayi !== '') return sayi;
      if (o.deger === 'unknown') return t('yuzey.bilgi.sensor.bilinmiyor');
      if (o.deger === 'unavailable') return t('yuzey.bilgi.sensor.ulasilamiyor');
      return o.deger ? o.deger : t('yuzey.bilgi.bosDeger');
    }

    function dikkat(karo) {
      if (karo.ulasilamiyor || !bilgi) return null;
      return Bicim.dikkatNedeni(karo, bilgi.ayar.pilEsigi);
    }

    function dikkatMetni(neden) {
      return neden === 'pil' ? t('yuzey.bilgi.uyari.pil') : t('yuzey.bilgi.uyari.sorun');
    }

    function betimEkle(kap, betim) {
      const svg = betim ? Grafik.svgOlustur(doc, betim) : null;
      if (svg) kap.appendChild(svg);
      return svg;
    }

    // ------------------------------------------------------------ veri okuma

    function eskidiMi(kayit, sure) {
      if (!kayit) return true;
      return simdi() - kayit.t >= (kayit.durum === 'tamam' ? sure : HATA_YENIDEN_MS);
    }

    function noktalariDuzelt(ham) {
      return dizi(ham).slice(0, 500).filter(function (n) { return n && sonluMu(n.t); }).map(function (n) {
        return { t: n.t, d: sonluMu(n.d) ? n.d : typeof n.d === 'string' ? n.d.slice(0, 40) : null };
      });
    }

    /** Geçmiş yanıtını işler: { ok, veri } -> { kimlik: noktalar }; anahtarı olmayan varlık "alınamadı" demektir. */
    function gecmisYaniti(yanit, kimlikler) {
      const sonuc = {};
      const veri = yanit && yanit.ok === true && yanit.veri && typeof yanit.veri === 'object' ? yanit.veri : null;
      kimlikler.forEach(function (k) {
        sonuc[k] = veri && Object.prototype.hasOwnProperty.call(veri, k) && Array.isArray(veri[k]) ? { durum: 'tamam', noktalar: noktalariDuzelt(veri[k]) } : { durum: 'hata', noktalar: [] };
      });
      return sonuc;
    }

    function gecmisIste(kimlikler, saat) {
      return Promise.resolve()
        .then(function () { return ctx.oku({ tur: 'gecmis', kimlikler: kimlikler, saat: saat }); })
        .then(function (y) { return gecmisYaniti(y, kimlikler); }, function () { return gecmisYaniti(null, kimlikler); });
    }

    /** Sensör favorisinin grafik biçimi çizgi (geçmiş grafiği) gösterir mi? */
    function cizgiIstenir(karo) {
      return karo.grafikTuru === 'otomatik' || karo.grafikTuru === 'cizgi' || karo.grafikTuru === undefined;
    }

    /** Sensör favorisinin grafik biçimi gösterge (gauge) çizer mi? */
    function gostergeIstenir(karo) {
      return karo.grafikTuru === 'otomatik' || karo.grafikTuru === 'gosterge' || karo.grafikTuru === undefined;
    }

    function grafikliKimlikler() {
      if (!bilgi || !bilgi.ayar.sensorGrafik) return [];
      return bilgi.sensorler
        .filter(function (k) { return k.alan === 'sensor' && !k.ulasilamiyor && k.ozellik && sonluMu(k.ozellik.sayi) && cizgiIstenir(k); })
        .map(function (k) { return k.id; })
        .slice(0, EN_COK_GRAFIKLI);
    }

    function miniGrafikleriIste() {
      const saat = bilgi.ayar.sensorGrafikSaat;
      if (gecmisSaati !== saat) {
        gecmis.clear();
        gecmisSaati = saat;
      }
      const istenen = grafikliKimlikler().filter(function (k) { return eskidiMi(gecmis.get(k), GECMIS_YENILEME_MS) && !ucta.has('g:' + k); });
      for (let i = 0; i < istenen.length; i += GECMIS_PARCA) {
        const parca = istenen.slice(i, i + GECMIS_PARCA);
        parca.forEach(function (k) { ucta.add('g:' + k); });
        gecmisIste(parca, saat).then(function (sonuc) {
          parca.forEach(function (k) { ucta.delete('g:' + k); }); // uçuş bayrağı saat denetiminden ÖNCE kalkar (yoksa sensör bir daha istenmez)
          if (gecmisSaati !== saat) {
            // ayar değişti: eski saat penceresinin verisi yazılmaz; yeni saat için istek bekletilmeden yeniden tetiklenir
            if (bilgi && ctx.acikMi()) miniGrafikleriIste();
            return;
          }
          parca.forEach(function (k) {
            gecmis.set(k, { t: simdi(), durum: sonuc[k].durum, noktalar: sonuc[k].noktalar });
          });
          cizimIste();
        });
      }
    }

    function etkinlikDuzelt(ham) {
      return dizi(ham).slice(0, 50).map(function (e) {
        if (!e || typeof e.baslik !== 'string' || typeof e.baslangic !== 'string') return null;
        return { baslik: e.baslik.slice(0, 100), baslangic: e.baslangic.slice(0, 40), bitis: typeof e.bitis === 'string' ? e.bitis.slice(0, 40) : null, tumGun: e.tumGun === true };
      }).filter(Boolean);
    }

    function takvimleriIste() {
      const gun = bilgi.ayar.takvimGunSayisi;
      if (takvimGunu !== gun) {
        takvim.clear();
        takvimGunu = gun;
      }
      bilgi.takvimler.forEach(function (c) {
        if (!c.kullanilabilir || ucta.has('t:' + c.id) || !eskidiMi(takvim.get(c.id), TAKVIM_YENILEME_MS)) return;
        ucta.add('t:' + c.id);
        Promise.resolve()
          .then(function () { return ctx.oku({ tur: 'takvim', kimlik: c.id, gun: gun }); })
          .then(function (y) { return y && y.ok === true && Array.isArray(y.veri) ? { durum: 'tamam', etkinlikler: etkinlikDuzelt(y.veri) } : { durum: 'hata', etkinlikler: [] }; }, function () { return { durum: 'hata', etkinlikler: [] }; })
          .then(function (s) {
            ucta.delete('t:' + c.id);
            if (takvimGunu !== gun) {
              // ayar uçuşta değişti: eski gün penceresinin etkinlikleri yazılmaz; yeni pencere için istek bekletilmeden yeniden tetiklenir
              if (bilgi && ctx.acikMi()) takvimleriIste();
              return;
            }
            takvim.set(c.id, { t: simdi(), durum: s.durum, etkinlikler: s.etkinlikler });
            cizimIste();
          });
      });
    }

    function ogeDuzelt(ham) {
      return dizi(ham).slice(0, 100).map(function (o) {
        if (!o || typeof o.uid !== 'string' || typeof o.baslik !== 'string' || o.uid.length > 200) return null;
        return { uid: o.uid, baslik: o.baslik.slice(0, 200), tamamlandi: o.tamamlandi === true };
      }).filter(Boolean);
    }

    function listeyiOku(liste, taze) {
      const anahtar = 'l:' + liste.id;
      if (ucta.has(anahtar) && !taze) return;
      const tazeIste = taze === true || tazeIstenen.has(liste.id);
      tazeIstenen.delete(liste.id);
      ucta.add(anahtar);
      Promise.resolve()
        .then(function () { return ctx.oku(tazeIste ? { tur: 'yapilacak', kimlik: liste.id, taze: true } : { tur: 'yapilacak', kimlik: liste.id }); })
        .then(function (y) { return y && y.ok === true && Array.isArray(y.veri) ? { durum: 'tamam', ogeler: ogeDuzelt(y.veri) } : { durum: 'hata', ogeler: [] }; }, function () { return { durum: 'hata', ogeler: [] }; })
        .then(function (s) {
          ucta.delete(anahtar);
          listeler.set(liste.id, { t: simdi(), durum: s.durum, ogeler: s.ogeler });
          cizimIste();
        });
    }

    function listeleriIste() {
      bilgi.listeler.forEach(function (l) {
        if (l.kullanilabilir && !ucta.has('l:' + l.id) && eskidiMi(listeler.get(l.id), LISTE_YENILEME_MS)) listeyiOku(l, false);
      });
    }

    // Hava tahmini: hava kartı gösteriliyorsa ve ayar kapalı değilse seçili türün (günlük / saatlik) tahmini ana süreçten istenir
    // (yuzey:oku { tur: 'hava' }: kimlik kayıtlı olmalı, Kapı Kuralı ve hız sınırı ana süreçtedir). Boş ya da hatalı yanıt "alınamadı" demektir.

    /** Tahmin şeridinin gösterileceği hava karosu (ilk kullanılabilir hava kartı); ayar kapalıysa ya da kart yoksa null. */
    function tahminHedefi() {
      if (!bilgi || bilgi.ayar.havaTahmini === 'kapali') return null;
      const kart = bilgi.kartlar.find(function (k) { return k.tur === 'hava' && !k.secilmedi && k.karo && k.karo.kullanilabilir && !k.karo.ulasilamiyor; });
      return kart ? kart.karo : null;
    }

    function aktifTahminTuru() {
      return tahminTuru || (bilgi && bilgi.ayar.havaTahmini === 'saatlik' ? 'saatlik' : 'gunluk');
    }

    /** Ana süreçten gelen tahmin satırları: yalnız bilinen alanlar, sınırlı sayıda, zamanı çözülebilenler. */
    function tahminDuzelt(ham) {
      return dizi(ham).slice(0, TAHMIN_GIRDI_SINIRI).map(function (f) {
        if (!f || typeof f.zaman !== 'string' || !Number.isFinite(Date.parse(f.zaman))) return null;
        return {
          zaman: f.zaman.slice(0, 40),
          durum: typeof f.durum === 'string' && Object.prototype.hasOwnProperty.call(HAVA_METIN, f.durum) ? f.durum : null,
          sicaklik: sayiVeyaNull(f.sicaklik),
          enDusuk: sayiVeyaNull(f.enDusuk),
          yagisOlasiligi: sayiVeyaNull(f.yagisOlasiligi),
        };
      }).filter(Boolean);
    }

    function tahminIste() {
      const hedef = tahminHedefi();
      if (!hedef) return;
      const tur = aktifTahminTuru();
      const anahtar = hedef.id + '|' + tur;
      if (ucta.has('h:' + anahtar) || !eskidiMi(tahminler.get(anahtar), TAHMIN_YENILEME_MS)) return;
      ucta.add('h:' + anahtar);
      Promise.resolve()
        .then(function () { return ctx.oku({ tur: 'hava', kimlik: hedef.id, tahmin: TAHMIN_ISTEK[tur] }); })
        .then(function (y) { return y && y.ok === true && Array.isArray(y.veri) ? tahminDuzelt(y.veri) : []; }, function () { return []; })
        .then(function (ogeler) {
          ucta.delete('h:' + anahtar);
          if (tahminler.size >= 8) tahminler.clear();
          tahminler.set(anahtar, { t: simdi(), durum: ogeler.length > 0 ? 'tamam' : 'hata', ogeler: ogeler });
          cizimIste();
        });
    }

    /** Panel açıkken gereken okumaları ister (yeterince taze olanlar atlanır; hatalar 30 sn sonra yeniden denenir). */
    function veriIste() {
      if (!bilgi || !ctx.acikMi()) return;
      miniGrafikleriIste();
      takvimleriIste();
      listeleriIste();
      tahminIste();
    }

    // ------------------------------------------------------------ saat kartı

    function saatiGuncelle() {
      if (!saatOgeleri) return;
      const a = bilgi ? bilgi.ayar : { saatBicimi: 'sistem', tarihBicimi: 'orta' };
      const simdiMs = simdi();
      saatOgeleri.deger.textContent = Bicim.saatMetni(simdiMs, { saatBicimi: a.saatBicimi });
      saatOgeleri.tarih.textContent = Bicim.tarihMetni(simdiMs, { tarihBicimi: a.tarihBicimi, dil: dil() });
      saatOgeleri.tarih.hidden = a.tarihBicimi === 'yok';
    }

    function saatSurucusunuKur() {
      if (saatZamanlayicisi !== null) {
        ctx.zamanlayici.clearTimeout(saatZamanlayicisi);
        saatZamanlayicisi = null;
      }
      if (!saatOgeleri) return;
      const kalan = 60_000 - (simdi() % 60_000);
      saatZamanlayicisi = ctx.zamanlayici.setTimeout(function () {
        saatZamanlayicisi = null;
        saatiGuncelle();
        saatSurucusunuKur();
      }, kalan + 50);
    }

    // ------------------------------------------------------------ hava tahmini şeridi

    function tahminSayisi(n, ek) {
      return Bicim.sayiBicimle(n, { hassasiyet: 0, dil: dil() }) + (ek || '');
    }

    /** Günlük görünümde bugünden başlayan, saatlik görünümde şu andan (yarım saat tolerans) başlayan satırlar. */
    function gorunenTahminler(kayit, tur) {
      const simdiMs = simdi();
      const secilen = kayit.ogeler.filter(function (o) {
        if (tur === 'saatlik') return Date.parse(o.zaman) >= simdiMs - 1_800_000;
        const fark = Bicim.gunFarki(Bicim.tahminGunKismi(o.zaman), simdiMs);
        return fark !== null && fark >= 0;
      });
      return secilen.slice(0, EN_COK_TAHMIN[tur]);
    }

    function tahminOgesi(o, tur) {
      const hucre = el('div', 'tahmin-oge');
      const ms = Date.parse(o.zaman);
      let zaman;
      if (tur === 'saatlik') zaman = Bicim.saatMetni(ms, { saatBicimi: bilgi.ayar.saatBicimi });
      else zaman = Bicim.gunFarki(Bicim.tahminGunKismi(o.zaman), simdi()) === 0 ? t('yuzey.bilgi.takvim.bugun') : Bicim.tahminGunu(o.zaman, { dil: dil() });
      hucre.appendChild(el('span', 'tahmin-zaman', zaman));
      const simge = el('span', 'tahmin-simge', (o.durum && Bicim.HAVA_SIMGELERI[o.durum]) || '');
      simge.setAttribute('aria-hidden', 'true');
      hucre.appendChild(simge);
      const parcalar = [];
      const durum = o.durum ? t(HAVA_METIN[o.durum]) : '';
      if (sonluMu(o.sicaklik)) {
        hucre.appendChild(el('span', 'tahmin-sicaklik', tahminSayisi(o.sicaklik, '°')));
        parcalar.push(t('yuzey.bilgi.hava.tahmin.sicaklik', { n: tahminSayisi(o.sicaklik, '°') }));
      }
      if (sonluMu(o.enDusuk)) {
        hucre.appendChild(el('span', 'tahmin-dusuk', tahminSayisi(o.enDusuk, '°')));
        parcalar.push(t('yuzey.bilgi.hava.tahmin.enDusuk', { n: tahminSayisi(o.enDusuk, '°') }));
      }
      if (sonluMu(o.yagisOlasiligi) && o.yagisOlasiligi >= 1) {
        const yagis = Bicim.yuzdeMetni(o.yagisOlasiligi, { hassasiyet: 0, dil: dil() });
        hucre.appendChild(el('span', 'tahmin-yagis', '☂ ' + yagis));
        parcalar.push(t('yuzey.bilgi.hava.tahmin.yagis', { n: yagis }));
      }
      hucre.setAttribute('role', 'group');
      hucre.setAttribute('aria-label', [zaman, durum].filter(Boolean).join(' · ') + (parcalar.length > 0 ? ', ' + parcalar.join(', ') : ''));
      return hucre;
    }

    function tahminTuruDugmeleri() {
      const grup = el('div', 'aralik-sira tahmin-tur');
      grup.setAttribute('role', 'group');
      grup.setAttribute('aria-label', t('yuzey.bilgi.hava.tahmin.turEtiket'));
      const aktif = aktifTahminTuru();
      const dugmeler = [];
      [['gunluk', 'yuzey.bilgi.hava.tahmin.gunluk'], ['saatlik', 'yuzey.bilgi.hava.tahmin.saatlik']].forEach(function (c) {
        const d = el('button', 'aralik-dugme' + (aktif === c[0] ? ' secili' : ''), t(c[1]));
        d.type = 'button';
        d.setAttribute('aria-pressed', aktif === c[0] ? 'true' : 'false');
        ctx.odakKaydet('bi:tahmin:' + c[0], d);
        d.addEventListener('click', function () {
          if (aktifTahminTuru() === c[0]) return;
          tahminTuru = c[0];
          tahminIste();
          ctx.odakIste('bi:tahmin:' + c[0]);
          ctx.yenidenCiz();
        });
        grup.appendChild(d);
        dugmeler.push(d);
      });
      ctx.satirEkle(dugmeler);
      return grup;
    }

    function tahminBolumu() {
      const hedef = tahminHedefi();
      if (!hedef) return null;
      const tur = aktifTahminTuru();
      const bolum = el('section', 'bilgi-tahmin');
      bolum.setAttribute('aria-label', t('yuzey.bilgi.hava.tahmin.baslik'));
      const ust = el('div', 'tahmin-ust');
      ust.appendChild(el('span', 'tahmin-baslik', t('yuzey.bilgi.hava.tahmin.baslik')));
      ust.appendChild(tahminTuruDugmeleri());
      bolum.appendChild(ust);
      const kayit = tahminler.get(hedef.id + '|' + tur);
      if (!kayit) {
        bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.hava.tahmin.yukleniyor')));
        return bolum;
      }
      const ogeler = kayit.durum === 'tamam' ? gorunenTahminler(kayit, tur) : [];
      if (ogeler.length === 0) {
        bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.hava.tahmin.alinamadi')));
        return bolum;
      }
      const liste = el('div', 'tahmin-liste ' + tur);
      ogeler.forEach(function (o) { liste.appendChild(tahminOgesi(o, tur)); });
      bolum.appendChild(liste);
      return bolum;
    }

    // ------------------------------------------------------------ üst kartlar ve şerit

    /** Sensör düğmesi (kart ve şerit ortak): tıklayınca geçmiş açılır. */
    function sensorDugmesi(karo, sinif, anahtar) {
      const neden = dikkat(karo);
      const d = el('button', sinif + (neden ? ' dikkat' : '') + (karo.ulasilamiyor || !karo.kullanilabilir ? ' yok' : ''));
      d.type = 'button';
      const deger = degerMetni(karo);
      const baslik = t('yuzey.bilgi.sensor.baslik', { etiket: karo.etiket });
      d.title = baslik;
      d.setAttribute('aria-label', t('yuzey.bilgi.sensor.etiket', { etiket: karo.etiket, deger: deger }) + (neden ? ' — ' + dikkatMetni(neden) : ''));
      d.addEventListener('click', function () { detayAc(karo.id, anahtar + karo.id); });
      ctx.odakKaydet(anahtar + karo.id, d);
      return { dugme: d, neden: neden, deger: deger };
    }

    function varlikKarti(karo) {
      const s = sensorDugmesi(karo, 'bilgi-kart kart-varlik', 'bi:kart:');
      s.dugme.appendChild(el('span', 'bilgi-etiket', karo.etiket));
      s.dugme.appendChild(el('span', 'bilgi-deger', s.deger));
      if (s.neden) s.dugme.appendChild(el('span', 'kart-uyari', '! ' + dikkatMetni(s.neden)));
      return s.dugme;
    }

    /**
     * Medya üst kartı: oynatıcının kendi cihaz kartı (albüm kapağı, çal / duraklat, ses, kaynak). Kart yuzey-kartlar.js'te çizilir
     * (ctx.medyaKarti); oynatıcı seçilmemişse ya da alınamıyorsa kısa bir not gösterilir.
     */
    function medyaUstKarti(k) {
      const kart = el('div', 'bilgi-kart bilgi-medya');
      if (k.secilmedi) {
        kart.appendChild(el('span', 'kart-not', t('yuzey.bilgi.medya.secilmedi')));
        return kart;
      }
      const ic = k.karo && !k.karo.ulasilamiyor && typeof ctx.medyaKarti === 'function' ? ctx.medyaKarti(k.karo) : null;
      if (!ic) {
        kart.appendChild(el('span', 'kart-not', t('yuzey.bilgi.medya.yok')));
        return kart;
      }
      kart.appendChild(ic);
      return kart;
    }

    /**
     * Üst kartlar (1.7.0): saat, hava ve medya panelin başındaki hero bölümündedir (heroParcalari); burada yalnız sensör (varlık) kartları
     * ve medya hapından açılan tam medya kartı kalır. Gösterilecek kart yoksa null.
     */
    function kartBolumu() {
      const kartlar = bilgi.kartlar.filter(function (k) { return k.tur === 'varlik' || (k.tur === 'medya' && medyaAcik); });
      if (kartlar.length === 0) return null;
      const bolum = el('section', 'bilgi-kartlar');
      bolum.setAttribute('aria-label', t('yuzey.bilgi.kartlar.etiket'));
      const dugmeler = [];
      kartlar.forEach(function (k) {
        let kart;
        if (k.tur === 'medya') kart = medyaUstKarti(k);
        else {
          kart = varlikKarti(k.karo);
          dugmeler.push(kart);
        }
        bolum.appendChild(kart);
      });
      if (dugmeler.length > 0) ctx.satirEkle(dugmeler);
      return bolum;
    }

    // ------------------------------------------------------------ 1.7.0 hero: saat + hava (+ açılır tahmin) ve medya hapı

    function ikonOgesi(ad, boyut, sinif) {
      return Ikon && ad ? Ikon.ikon(doc, ad, boyut, sinif) : null;
    }

    function heroSaat() {
      const kutu = el('div', 'hero-saat');
      const deger = el('div', 'saat-deger', '');
      const tarih = el('div', 'saat-tarih', '');
      kutu.appendChild(deger);
      kutu.appendChild(tarih);
      saatOgeleri = { deger: deger, tarih: tarih };
      saatiGuncelle();
      return kutu;
    }

    /** Hero'nun hava tarafı: ikon, sıcaklık, "Durum · Nem %n". Tahmin açıksa düğmedir (tıklayınca tahmin açılır / kapanır). */
    function heroHava(k) {
      const o = !k.secilmedi && k.karo && !k.karo.ulasilamiyor && k.karo.kullanilabilir ? k.karo.ozellik : null;
      if (!o) return el('div', 'hero-hava bos', t(k.secilmedi ? 'yuzey.bilgi.hava.secilmedi' : 'yuzey.bilgi.hava.yok'));
      const tahminVar = !!tahminHedefi();
      const kutu = el(tahminVar ? 'button' : 'div', 'hero-hava');
      const durumMetni = o.durum && Object.prototype.hasOwnProperty.call(HAVA_METIN, o.durum) ? t(HAVA_METIN[o.durum]) : '';
      const sicaklik = sonluMu(o.sicaklik) ? Bicim.sayiBicimle(Math.round(o.sicaklik), { hassasiyet: 0, dil: dil() }) + '°' : t('yuzey.bilgi.bosDeger');
      const simge = ikonOgesi(Ikon ? Ikon.havaIkonAdi(o.durum) : null, 30, 'hava-ikon');
      if (simge) kutu.appendChild(simge);
      else if (o.durum && Bicim.HAVA_SIMGELERI[o.durum]) {
        const yedek = el('span', 'hava-ikon', Bicim.HAVA_SIMGELERI[o.durum]);
        yedek.setAttribute('aria-hidden', 'true');
        kutu.appendChild(yedek);
      }
      kutu.appendChild(el('span', 'hava-sicaklik', sicaklik));
      const alt = [];
      if (durumMetni) alt.push(durumMetni);
      if (sonluMu(o.nem)) alt.push(t('yuzey.bilgi.hava.nem', { n: Bicim.yuzdeMetni(o.nem, { hassasiyet: 0, dil: dil() }) }));
      if (alt.length > 0) kutu.appendChild(el('span', 'hava-durum', alt.join(' · ')));
      const tamSicaklik = sonluMu(o.sicaklik) ? Bicim.sayiBicimle(o.sicaklik, { dil: dil() }) + (o.birim ? ' ' + o.birim : '') : '';
      // Rüzgâr hero'da yer kaplamaz; erişilebilir adda ve ipucunda söylenir
      const ruzgar = sonluMu(o.ruzgar) ? t('yuzey.bilgi.hava.ruzgar', { n: Bicim.sayiBicimle(o.ruzgar, { hassasiyet: 0, dil: dil() }), birim: o.ruzgarBirim || '' }).trim() : '';
      const betim = [durumMetni, tamSicaklik].concat(alt.slice(durumMetni ? 1 : 0), [ruzgar]).filter(Boolean).join(', ');
      if (tahminVar) {
        kutu.type = 'button';
        kutu.setAttribute('aria-expanded', tahminAcik ? 'true' : 'false');
        kutu.setAttribute('aria-label', betim + ' — ' + t('yuzey.bilgi.hava.tahmin.baslik'));
        kutu.title = kutu.getAttribute('aria-label'); // .hava-durum dar sütunda '…' ile kesilebilir: ipucu tam metni taşır
        ctx.odakKaydet('bi:hero:hava', kutu);
        kutu.addEventListener('click', function () {
          tahminAcik = !tahminAcik;
          if (tahminAcik) tahminIste();
          ctx.odakIste('bi:hero:hava');
          ctx.yenidenCiz();
        });
        ctx.satirEkle([kutu]);
      } else {
        kutu.setAttribute('role', 'group');
        kutu.setAttribute('aria-label', betim);
        kutu.title = betim;
      }
      return kutu;
    }

    function medyaHapi(k) {
      const ac = function () {
        medyaAcik = !medyaAcik;
        ctx.odakIste('c:' + (k.karo ? k.karo.id : '') + ':hap');
        ctx.yenidenCiz();
      };
      const hap = k.karo && !k.karo.ulasilamiyor && typeof ctx.medyaHapi === 'function' ? ctx.medyaHapi(k.karo, { acik: medyaAcik, ac: ac }) : null;
      if (hap) return hap;
      return el('div', 'hap-bos', t(k.secilmedi ? 'yuzey.bilgi.medya.secilmedi' : 'yuzey.bilgi.medya.yok'));
    }

    /**
     * Panelin başındaki hero bölümü (1.7.0, yalnız panel): saat her zaman solda (taslaktaki gibi hero'nun sabit parçası; varlık ya da
     * istek gerektirmez), üst kart yuvasında hava seçiliyse sağda hava; altında tahmin (açıksa) ve medya yuvası seçiliyse medya hapı.
     * Bilgi modeli yoksa boş dizi. Sensör (varlık) kartları içerikte kalır (kartBolumu).
     */
    function heroParcalari() {
      saatOgeleri = null;
      if (!bilgi) {
        saatSurucusunuKur();
        return [];
      }
      const bul = function (tur) { return bilgi.kartlar.find(function (k) { return k.tur === tur; }) || null; };
      const havaK = bul('hava');
      const medyaK = bul('medya');
      const ust = el('div', 'hero-ust');
      ust.appendChild(heroSaat());
      if (havaK) ust.appendChild(heroHava(havaK));
      const parcalar = [ust];
      if (havaK && tahminAcik) {
        const tahmin = tahminBolumu();
        if (tahmin) parcalar.push(tahmin);
      }
      if (medyaK) parcalar.push(medyaHapi(medyaK));
      saatSurucusunuKur();
      return parcalar;
    }

    function seritBolumu() {
      const bolum = el('section', 'sensor-serit');
      bolum.setAttribute('aria-label', t('yuzey.bilgi.serit.etiket'));
      const dugmeler = [];
      bilgi.serit.forEach(function (karo) {
        const s = sensorDugmesi(karo, 'serit-oge', 'bi:serit:');
        if (s.neden) {
          const isaret = el('span', 'serit-uyari', '!');
          isaret.setAttribute('aria-hidden', 'true'); // renge ek şekil; uyarı metni aria-label'dadır
          s.dugme.appendChild(isaret);
        }
        // 1.7.0 çip: ikon + değer; tam ad title / aria-label'dadır (sensorDugmesi)
        const simge = ikonOgesi(Ikon ? Ikon.sensorIkonAdi(karo.ozellik) : null, 14, 'serit-ikon');
        if (simge) s.dugme.appendChild(simge);
        else s.dugme.appendChild(el('span', 'serit-etiket', karo.etiket));
        s.dugme.appendChild(el('span', 'serit-deger', s.deger));
        bolum.appendChild(s.dugme);
        dugmeler.push(s.dugme);
      });
      ctx.satirEkle(dugmeler);
      return bolum;
    }

    /** İçeriğin başı: sensör çipleri, sensör (varlık) kartları ve açılmış tam medya kartı. Saat, hava ve tahmin hero'dadır. */
    function ustParcalar() {
      if (!bilgi) return [];
      const parcalar = [];
      if (bilgi.serit.length > 0) parcalar.push(seritBolumu());
      const kartlar = kartBolumu();
      if (kartlar) parcalar.push(kartlar);
      return parcalar;
    }

    // ------------------------------------------------------------ sensör karoları

    function sensorKarosu(karo) {
      const s = sensorDugmesi(karo, 'karo sensor-karo', 'bi:sensor:');
      const d = s.dugme;
      d.appendChild(el('span', 'karo-etiket', karo.etiket));
      const satir = el('span', 'sensor-satir');
      satir.appendChild(el('span', 'sensor-deger', s.deger));
      const o = karo.ozellik;
      const grafikAcik = bilgi.ayar.sensorGrafik && karo.alan === 'sensor' && o && sonluMu(o.sayi) && !karo.ulasilamiyor && karo.grafikTuru !== 'yok';
      if (grafikAcik && gostergeIstenir(karo)) {
        const aralik = Bicim.gostergeAraligi(o);
        const gosterge = aralik ? Grafik.gosterge(o.sayi, aralik.enAz, aralik.enCok, { boyut: 44, kalinlik: 5, durum: s.neden ? 'kritik' : 'normal', etiket: '' }) : null;
        if (gosterge) {
          const kap = el('span', 'sensor-gosterge');
          betimEkle(kap, gosterge);
          satir.appendChild(kap);
        }
      }
      d.appendChild(satir);
      if (s.neden) d.appendChild(el('span', 'karo-ipucu sensor-uyari', '! ' + dikkatMetni(s.neden)));
      if (grafikAcik && cizgiIstenir(karo)) {
        const kayit = gecmis.get(karo.id);
        if (kayit && kayit.durum === 'tamam') {
          const simdiMs = simdi();
          const saat = bilgi.ayar.sensorGrafikSaat;
          const cizgi = Grafik.sparkline(kayit.noktalar, { genislik: 100, yukseklik: 22, bas: simdiMs - saat * SAAT_MS, bitis: simdiMs, etiket: '' });
          if (cizgi) {
            const kap = el('span', 'sensor-cizgi');
            betimEkle(kap, cizgi);
            d.appendChild(kap);
          }
        }
      }
      return d;
    }

    function sensorBolumu() {
      if (bilgi.sensorler.length === 0) return null;
      const bolum = el('section', 'bolum grup-sensor');
      bolum.appendChild(el('h2', 'bolum-baslik', t('yuzey.bilgi.bolum.sensor')));
      const izgara = el('div', 'izgara');
      let satir = [];
      bilgi.sensorler.forEach(function (karo) {
        const d = sensorKarosu(karo);
        izgara.appendChild(d);
        satir.push(d);
        if (satir.length === ctx.izgaraKolon) {
          ctx.satirEkle(satir);
          satir = [];
        }
      });
      if (satir.length > 0) ctx.satirEkle(satir);
      bolum.appendChild(izgara);
      return bolum;
    }

    // ------------------------------------------------------------ yapılacaklar

    function sahteKaro(liste, etiket) {
      return { id: liste.id, etiket: etiket, tekrar: false };
    }

    function listeEylemi(liste, yuk, etiket, oge) {
      return ctx.calistir(Object.assign({ kimlik: liste.id }, yuk), sahteKaro(liste, etiket), oge).then(function (sonuc) {
        if (sonuc && sonuc.ok === true) listeyiOku(liste, true);
        return sonuc;
      });
    }

    function ogeSatiri(liste, o) {
      const satir = el('div', 'liste-oge' + (o.tamamlandi ? ' bitti' : ''));
      const onay = el('button', 'liste-onay', o.tamamlandi ? '☑' : '☐');
      onay.type = 'button';
      onay.setAttribute('aria-pressed', o.tamamlandi ? 'true' : 'false');
      const onayMetni = t(o.tamamlandi ? 'yuzey.bilgi.liste.geriAl' : 'yuzey.bilgi.liste.tamamla', { baslik: o.baslik });
      onay.setAttribute('aria-label', onayMetni);
      onay.title = onayMetni;
      ctx.odakKaydet('bi:onay:' + liste.id + ':' + o.uid, onay);
      onay.addEventListener('click', function () {
        listeEylemi(liste, { servis: 'update_item', veri: { item: o.uid, status: o.tamamlandi ? 'needs_action' : 'completed' } }, o.baslik, onay).then(function (s) {
          if (s && s.ok === false && s.tur !== 'cok-sik') ctx.ipucu(t('yuzey.bilgi.liste.islemYapilamadi', { baslik: o.baslik }));
        });
      });
      satir.appendChild(onay);
      satir.appendChild(el('span', 'liste-baslik', o.baslik));
      const sil = el('button', 'liste-sil', '×');
      sil.type = 'button';
      const silMetni = t('yuzey.bilgi.liste.silBaslik', { baslik: o.baslik });
      sil.setAttribute('aria-label', silMetni);
      sil.title = silMetni;
      ctx.odakKaydet('bi:sil:' + liste.id + ':' + o.uid, sil);
      // Silme zorunlu onaylıdır: ~0,8 sn basılı tutma (onayı ana sürecin kendi saati verir; yuzey-sayfa.js basiliTutmaOlustur).
      const tutma = ctx.basiliTutma(sahteKaro(liste, o.baslik), sil, { servis: 'remove_item', veri: { item: o.uid } }, function (sonucSozu) {
        Promise.resolve(sonucSozu).then(function (s) {
          if (s && s.ok === true) listeyiOku(liste, true);
        });
      });
      sil.addEventListener('pointerdown', function (olay) {
        if (olay.button === 0 || olay.button === undefined) tutma.basla();
      });
      ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach(function (ad) { sil.addEventListener(ad, tutma.birak); });
      sil.addEventListener('keydown', function (olay) {
        if ((olay.key === 'Enter' || olay.key === ' ') && !olay.repeat) tutma.basla();
      });
      satir.appendChild(sil);
      ctx.satirEkle([onay, sil]);
      return satir;
    }

    function eklemeSatiri(liste) {
      const satir = el('div', 'liste-ekle');
      const girdi = doc.createElement('input');
      girdi.type = 'text';
      girdi.className = 'liste-girdi';
      girdi.maxLength = 200;
      girdi.autocomplete = 'off';
      girdi.setAttribute('autocomplete', 'off');
      girdi.setAttribute('spellcheck', 'false');
      girdi.setAttribute('placeholder', t('yuzey.bilgi.liste.ekleIpucu'));
      girdi.setAttribute('aria-label', t('yuzey.bilgi.liste.ekleEtiket', { liste: liste.etiket }));
      girdi.value = taslak.get(liste.id) || '';
      ctx.odakKaydet('bi:girdi:' + liste.id, girdi);
      aktifGirdiler.set(liste.id, girdi);
      const dugme = el('button', 'liste-ekle-dugme', t('yuzey.bilgi.liste.ekleDugme'));
      dugme.type = 'button';
      dugme.setAttribute('aria-busy', ekleniyor.has(liste.id) ? 'true' : 'false');
      ctx.odakKaydet('bi:ekle:' + liste.id, dugme);
      aktifDugmeler.set(liste.id, dugme);

      let yazimda = false;
      girdi.addEventListener('focus', function () {
        if (yazimda) return;
        yazimda = true;
        yazim += 1;
        ctx.donukBaslat(); // yazarken canlı güncelleme kutuyu yok etmesin
      });
      girdi.addEventListener('blur', function () {
        if (!yazimda) return;
        yazimda = false;
        yazim = Math.max(0, yazim - 1);
        ctx.donukBitir();
      });
      girdi.addEventListener('input', function () {
        taslak.set(liste.id, girdi.value);
      });
      const ekle = function () {
        if (ekleniyor.has(liste.id)) return; // yanıt gelmeden ikinci Enter / tık aynı öğeyi ikinci kez eklemesin
        const gonderilen = String(girdi.value);
        const metin = gonderilen.replace(/\s+/g, ' ').trim();
        if (metin === '') return;
        ekleniyor.add(liste.id);
        dugme.setAttribute('aria-busy', 'true');
        const bitti = function () {
          ekleniyor.delete(liste.id);
          dugme.setAttribute('aria-busy', 'false');
          const guncelDugme = aktifDugmeler.get(liste.id);
          if (guncelDugme) guncelDugme.setAttribute('aria-busy', 'false');
        };
        listeEylemi(liste, { servis: 'add_item', veri: { item: metin } }, metin, dugme).then(function (s) {
          bitti();
          if (s && s.ok === true) {
            // araya giren yeniden çizim kutuyu yeniden kurmuş olabilir: görünen (güncel) kutu da temizlenir; kullanıcı bu arada
            // başka metin yazdıysa ona dokunulmaz
            const gorunen = aktifGirdiler.get(liste.id) || girdi;
            if (gorunen.value === gonderilen) {
              gorunen.value = '';
              taslak.delete(liste.id);
            }
            if (girdi.value === gonderilen) girdi.value = '';
          } else if (s && s.ok === false && s.tur !== 'cok-sik' && s.tur !== 'onay-gerekli') {
            ctx.ipucu(t('yuzey.bilgi.liste.eklenemedi'));
          }
        }, bitti);
      };
      girdi.addEventListener('keydown', function (olay) {
        if (olay.isComposing === true || olay.keyCode === 229) return; // IME yazımı Enter'ı kullanır
        if (olay.key === 'Enter') {
          olay.preventDefault();
          if (olay.repeat) return; // Enter basılı tutulursa tuş tekrarı ekleme sayılmaz
          ekle();
        }
      });
      dugme.addEventListener('click', ekle);
      satir.appendChild(girdi);
      satir.appendChild(dugme);
      ctx.satirEkle([dugme]); // girdi ok tuşu gezintisine alınmaz (imleç hareketi girdinindir)
      return satir;
    }

    function listeBolumu(liste) {
      const bolum = el('section', 'bolum bilgi-liste');
      const baslik = el('h2', 'bolum-baslik', t('yuzey.bilgi.liste.baslik', { liste: liste.etiket }));
      if (Number.isInteger(liste.acikSayisi)) baslik.appendChild(el('span', 'liste-sayi', ' · ' + t('yuzey.bilgi.liste.acikSayisi', { n: liste.acikSayisi })));
      bolum.appendChild(baslik);
      const kayit = listeler.get(liste.id);
      if (!liste.kullanilabilir || (kayit && kayit.durum === 'hata')) {
        bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.liste.alinamadi')));
      } else if (!kayit) {
        bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.liste.yukleniyor')));
      } else {
        const acik = kayit.ogeler.filter(function (o) { return !o.tamamlandi; });
        const biten = kayit.ogeler.filter(function (o) { return o.tamamlandi; });
        if (acik.length === 0) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.liste.bos')));
        acik.slice(0, EN_COK_ACIK_OGE).forEach(function (o) { bolum.appendChild(ogeSatiri(liste, o)); });
        if (acik.length > EN_COK_ACIK_OGE) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.liste.dahaFazla', { n: acik.length - EN_COK_ACIK_OGE })));
        if (biten.length > 0) {
          const acikMi = bitenAcik.has(liste.id);
          const dugme = el('button', 'liste-biten', (acikMi ? '▾ ' : '▸ ') + t('yuzey.bilgi.liste.tamamlananlar', { n: biten.length }));
          dugme.type = 'button';
          dugme.setAttribute('aria-expanded', acikMi ? 'true' : 'false');
          ctx.odakKaydet('bi:biten:' + liste.id, dugme);
          dugme.addEventListener('click', function () {
            if (bitenAcik.has(liste.id)) bitenAcik.delete(liste.id);
            else bitenAcik.add(liste.id);
            ctx.yenidenCiz();
          });
          ctx.satirEkle([dugme]);
          bolum.appendChild(dugme);
          if (acikMi) biten.slice(0, EN_COK_BITEN_OGE).forEach(function (o) { bolum.appendChild(ogeSatiri(liste, o)); });
        }
      }
      bolum.appendChild(eklemeSatiri(liste));
      return bolum;
    }

    // ------------------------------------------------------------ takvim

    function etkinlikSirasi(a, b) {
      return a.gun - b.gun || Number(b.e.tumGun) - Number(a.e.tumGun) || Date.parse(a.e.baslangic) - Date.parse(b.e.baslangic);
    }

    /** Takvimlerin etkinlikleri birleştirilir: gün farkına, sonra tüm gün öne, sonra başlangıca göre sıralı. */
    function etkinlikleriBirlestir() {
      const simdiMs = simdi();
      const hepsi = [];
      bilgi.takvimler.forEach(function (c) {
        const kayit = takvim.get(c.id);
        if (!kayit || kayit.durum !== 'tamam') return;
        kayit.etkinlikler.forEach(function (e) {
          const gun = Bicim.gunFarki(e.baslangic, simdiMs);
          // dünden başlayıp süren etkinlik (gun < 0) bugün grubuna girer; yoksa 'Bugün' başlığı iki kez çıkardı
          hepsi.push({ e: e, gun: gun === null ? 0 : Math.max(0, gun), takvim: c.etiket });
        });
      });
      return hepsi.sort(etkinlikSirasi);
    }

    function gunEtiketi(g, e) {
      if (g <= 0) return t('yuzey.bilgi.takvim.bugun');
      if (g === 1) return t('yuzey.bilgi.takvim.yarin');
      return Bicim.gunMetni(e.baslangic, { dil: dil() });
    }

    function suAnMi(e, simdiMs) {
      const bas = Date.parse(e.baslangic);
      const bit = e.bitis ? Date.parse(e.bitis) : NaN;
      if (e.tumGun) {
        const gun = Bicim.gunFarki(e.baslangic, simdiMs);
        const bitisGun = e.bitis ? Bicim.gunFarki(e.bitis, simdiMs) : null;
        return gun !== null && gun <= 0 && (bitisGun === null ? gun === 0 : bitisGun > 0);
      }
      return Number.isFinite(bas) && Number.isFinite(bit) && bas <= simdiMs && simdiMs < bit;
    }

    function takvimBolumu() {
      if (bilgi.takvimler.length === 0) return null;
      const bolum = el('section', 'bolum bilgi-takvim');
      bolum.appendChild(el('h2', 'bolum-baslik', t('yuzey.bilgi.bolum.takvim')));
      const tamam = bilgi.takvimler.filter(function (c) { var k = takvim.get(c.id); return k && k.durum === 'tamam'; });
      const hatali = bilgi.takvimler.some(function (c) { var k = takvim.get(c.id); return !c.kullanilabilir || (k && k.durum === 'hata'); });
      const bekleyen = bilgi.takvimler.some(function (c) { return c.kullanilabilir && !takvim.get(c.id); });
      const etkinlikler = etkinlikleriBirlestir();
      if (etkinlikler.length === 0) {
        if (tamam.length === 0 && bekleyen) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.takvim.yukleniyor')));
        else if (tamam.length === 0 && hatali) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.takvim.alinamadi')));
        else bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.takvim.bos')));
        return bolum;
      }
      const simdiMs = simdi();
      let oncekiGun = null;
      etkinlikler.slice(0, EN_COK_ETKINLIK).forEach(function (x) {
        if (x.gun !== oncekiGun) {
          bolum.appendChild(el('div', 'takvim-gun', gunEtiketi(x.gun, x.e)));
          oncekiGun = x.gun;
        }
        const satir = el('div', 'takvim-satir');
        const saat = x.e.tumGun ? t('yuzey.bilgi.takvim.tumGun') : Bicim.etkinlikSaati(x.e, { saatBicimi: bilgi.ayar.saatBicimi });
        satir.appendChild(el('span', 'takvim-saat', saat || ''));
        satir.appendChild(el('span', 'takvim-baslik', x.e.baslik));
        if (suAnMi(x.e, simdiMs)) satir.appendChild(el('span', 'rozet takvim-simdi', t('yuzey.bilgi.takvim.suAn')));
        bolum.appendChild(satir);
      });
      if (etkinlikler.length > EN_COK_ETKINLIK) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.takvim.dahaFazla', { n: etkinlikler.length - EN_COK_ETKINLIK })));
      if (hatali) bolum.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.takvim.alinamadi')));
      return bolum;
    }

    function altParcalar() {
      if (!bilgi) return [];
      const parcalar = [];
      const s = sensorBolumu();
      if (s) parcalar.push(s);
      bilgi.listeler.forEach(function (l) { parcalar.push(listeBolumu(l)); });
      const tk = takvimBolumu();
      if (tk) parcalar.push(tk);
      return parcalar;
    }

    // ------------------------------------------------------------ sensör geçmişi ve karşılaştırma (o-11)

    function detayAc(kimlik, donusAnahtari) {
      if (!haritadaBul(kimlik)) return;
      detay = { kimlik: kimlik, saat: VARSAYILAN_DETAY_SAATI, secili: [], durum: 'bekliyor', veri: {}, no: 0, donus: donusAnahtari || '' };
      detayVerisiIste();
      ctx.odakIste('bi:geri');
      ctx.yenidenCiz();
    }

    function detayKapat() {
      if (!detay) return false;
      if (detay.donus) ctx.odakIste(detay.donus); // odak, detayı açan sensöre geri döner
      detay = null;
      ctx.yenidenCiz();
      return true;
    }

    function detayVerisiIste() {
      if (!detay) return;
      istekNo += 1;
      const no = istekNo;
      const d = detay;
      d.no = no;
      d.durum = 'bekliyor';
      const kimlikler = [d.kimlik].concat(d.secili);
      gecmisIste(kimlikler, d.saat).then(function (sonuc) {
        if (detay !== d || d.no !== no) return; // başka aralık / seçim istendi ya da detay kapandı
        d.veri = {};
        kimlikler.forEach(function (k) {
          d.veri[k] = sonuc[k];
        });
        d.durum = d.veri[d.kimlik].durum === 'tamam' ? 'tamam' : 'hata';
        ctx.yenidenCiz();
      });
    }

    /** Karşılaştırmaya eklenebilecek sayısal sensörler (şerit, sensör karoları, varlık kartları; kendisi ve ikili sensörler hariç). */
    function adaylar() {
      if (!detay) return [];
      const goruldu = {};
      const sonuc = [];
      bilgi.serit.concat(bilgi.sensorler, bilgi.kartlar.map(function (k) { return k.karo; }).filter(Boolean)).forEach(function (k) {
        if (k.alan !== 'sensor' || k.id === detay.kimlik || goruldu[k.id] || !k.ozellik || !sonluMu(k.ozellik.sayi)) return;
        goruldu[k.id] = true;
        sonuc.push(k);
      });
      return sonuc;
    }

    function aralikDugmeleri() {
      const grup = el('div', 'aralik-sira');
      grup.setAttribute('role', 'group');
      grup.setAttribute('aria-label', t('yuzey.bilgi.aralik.etiket'));
      const dugmeler = [];
      ARALIKLAR.forEach(function (saat) {
        const d = el('button', 'aralik-dugme' + (detay.saat === saat ? ' secili' : ''), t(ARALIK_KISA[saat]));
        d.type = 'button';
        d.setAttribute('aria-pressed', detay.saat === saat ? 'true' : 'false');
        ctx.odakKaydet('bi:aralik:' + saat, d);
        d.addEventListener('click', function () {
          if (!detay || detay.saat === saat) return;
          detay.saat = saat;
          detayVerisiIste();
          ctx.yenidenCiz();
        });
        grup.appendChild(d);
        dugmeler.push(d);
      });
      ctx.satirEkle(dugmeler);
      return grup;
    }

    function seriBirimi(karo) {
      return karo && karo.ozellik && karo.ozellik.birim ? karo.ozellik.birim : '';
    }

    function istatistikMetni(ozet, birim) {
      const bicim = function (n) { return Bicim.sayiBicimle(n, { dil: dil() }); };
      const ek = birim ? ' ' + birim : '';
      return {
        enAz: bicim(ozet.enAz) + ek,
        enCok: bicim(ozet.enCok) + ek,
        ortalama: bicim(ozet.ortalama) + ek,
      };
    }

    function istatistikKutulari(ozet, birim) {
      const m = istatistikMetni(ozet, birim);
      const kap = el('div', 'istatistik-sira');
      [['yuzey.bilgi.istatistik.enAz', m.enAz], ['yuzey.bilgi.istatistik.enCok', m.enCok], ['yuzey.bilgi.istatistik.ortalama', m.ortalama]].forEach(function (c) {
        const kutu = el('div', 'istatistik');
        kutu.appendChild(el('span', 'istatistik-etiket', t(c[0])));
        kutu.appendChild(el('span', 'istatistik-deger', c[1]));
        kap.appendChild(kutu);
      });
      return kap;
    }

    function seriSatiri(sira, etiket, ozet, birim) {
      const satir = el('div', 'seri-satir');
      const isaret = el('span', 'seri-isaret seri-' + sira, '');
      isaret.setAttribute('aria-hidden', 'true');
      satir.appendChild(isaret);
      satir.appendChild(el('span', 'seri-ad', etiket));
      if (ozet) {
        const m = istatistikMetni(ozet, birim);
        satir.appendChild(el('span', 'seri-istatistik', t('yuzey.bilgi.istatistik.enAz') + ' ' + m.enAz + ' · ' + t('yuzey.bilgi.istatistik.enCok') + ' ' + m.enCok + ' · ' + t('yuzey.bilgi.istatistik.ortalama') + ' ' + m.ortalama));
      } else {
        satir.appendChild(el('span', 'seri-istatistik', t('yuzey.bilgi.karsilastir.veriYok')));
      }
      return satir;
    }

    function imleciBagla(svg, sonuc, okuma, seriler) {
      const cizgi = Grafik.svgOlustur(doc, { e: 'line', a: { class: 'imlec', x1: 0, x2: 0, y1: sonuc.bolge.ust, y2: sonuc.bolge.ust + sonuc.bolge.yukseklik, visibility: 'hidden' }, c: [] });
      if (!cizgi) return;
      svg.appendChild(cizgi);
      const gizle = function () {
        cizgi.setAttribute('visibility', 'hidden');
        okuma.textContent = '';
      };
      svg.addEventListener('pointermove', function (olay) {
        const kutu = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
        if (!kutu || !(kutu.width > 0)) return;
        const x = ((olay.clientX - kutu.left) / kutu.width) * GRAFIK_GENISLIK;
        const im = sonuc.imlec(x);
        cizgi.setAttribute('x1', String(im.x));
        cizgi.setAttribute('x2', String(im.x));
        cizgi.setAttribute('visibility', 'visible');
        const parcalar = [];
        im.degerler.forEach(function (d) {
          // imlec yalnız verisi olan serileri döndürür (sıra seriler dizisiyle aynı olmayabilir): kimlikle eşleştirilir
          const seri = seriler.find(function (s) { return s.kimlik === d.kimlik; });
          if (d.d === null || !seri) return;
          parcalar.push(t('yuzey.bilgi.grafik.imlec', { etiket: seri.etiket, deger: Bicim.sayiBicimle(d.d, { dil: dil() }) + (seri.birim ? ' ' + seri.birim : ''), zaman: zamanEtiketi(d.t) }));
        });
        okuma.textContent = parcalar.join(' · ');
      });
      svg.addEventListener('pointerleave', gizle);
    }

    function zamanEtiketi(ms) {
      const saatMetni = Bicim.saatMetni(ms, { saatBicimi: bilgi.ayar.saatBicimi });
      return detay && detay.saat > 24 ? Bicim.eksenZamani(ms, { gunluk: true, dil: dil() }) + ' ' + saatMetni : saatMetni;
    }

    function grafikAlani() {
      const kap = el('div', 'detay-grafik');
      const ana = haritadaBul(detay.kimlik);
      const aralikAdi = t(ARALIK_ADI[detay.saat]);
      if (detay.durum === 'bekliyor') {
        kap.className = 'detay-grafik bekliyor'; // yükleme sırasında yer tutar (CSS min-height): alttaki karşılaştırma çipleri zıplamaz
        kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.detay.yukleniyor')));
        return kap;
      }
      if (detay.durum === 'hata') {
        kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.detay.alinamadi')));
        return kap;
      }
      const anaNoktalar = detay.veri[detay.kimlik].noktalar;
      if (anaNoktalar.length === 0) {
        kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.detay.bosDonem')));
        return kap;
      }
      const anaOzet = Grafik.ozet(anaNoktalar);
      if (!anaOzet) {
        kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.detay.sayisalDegil')));
        return kap;
      }
      // seriler: ana sensör + seçilen karşılaştırmalar (veri gelmemiş / sayısal olmayan seri legend'de "veri yok" der)
      const seriler = [{ kimlik: detay.kimlik, etiket: ana ? ana.etiket : detay.kimlik, birim: seriBirimi(ana), noktalar: anaNoktalar }];
      detay.secili.forEach(function (k) {
        const karo = haritadaBul(k);
        const kayit = detay.veri[k];
        seriler.push({ kimlik: k, etiket: karo ? karo.etiket : k, birim: seriBirimi(karo), noktalar: kayit && kayit.durum === 'tamam' ? kayit.noktalar : [] });
      });
      const simdiMs = simdi();
      const gunluk = detay.saat > 24;
      const sonuc = Grafik.karsilastirma(
        seriler.map(function (s) { return { kimlik: s.kimlik, noktalar: s.noktalar, birim: s.birim }; }),
        {
          genislik: GRAFIK_GENISLIK,
          yukseklik: GRAFIK_YUKSEKLIK,
          bas: simdiMs - detay.saat * SAAT_MS,
          bitis: simdiMs,
          yaziX: function (ms) { return Bicim.eksenZamani(ms, { gunluk: gunluk, saatBicimi: bilgi.ayar.saatBicimi, dil: dil() }); },
          yaziY: function (v) { return Bicim.sayiBicimle(v, { dil: dil() }); },
          etiket: t('yuzey.bilgi.grafik.etiket', { etiket: seriler.map(function (s) { return s.etiket; }).join(', '), aralik: aralikAdi }),
        },
      );
      if (!sonuc) {
        kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.detay.sayisalDegil')));
        return kap;
      }
      const birimler = seriler.map(function (s) { return s.birim; }).filter(function (b, i, a) { return b && a.indexOf(b) === i; });
      if (sonuc.kip === 'ortak' && birimler.length === 1) kap.appendChild(el('p', 'detay-birim', birimler[0]));
      if (sonuc.kip === 'bagimsiz') kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.karsilastir.bagimsiz')));
      const svg = betimEkle(kap, sonuc.betim);
      const okuma = el('p', 'detay-imlec', '');
      if (svg) imleciBagla(svg, sonuc, okuma, seriler);
      kap.appendChild(okuma);
      if (seriler.length === 1) {
        kap.appendChild(istatistikKutulari(anaOzet, seriler[0].birim));
      } else {
        const liste = el('div', 'seri-liste');
        seriler.forEach(function (s, i) {
          liste.appendChild(seriSatiri(i, s.etiket, Grafik.ozet(s.noktalar), s.birim));
        });
        kap.appendChild(liste);
      }
      return kap;
    }

    function karsilastirmaBolumu() {
      const adayListesi = adaylar();
      if (adayListesi.length === 0) return null;
      const kap = el('div', 'karsilastir');
      kap.appendChild(el('h3', 'karsilastir-baslik', t('yuzey.bilgi.karsilastir.baslik')));
      kap.appendChild(el('p', 'bilgi-not', t('yuzey.bilgi.karsilastir.aciklama', { n: EN_COK_SERI })));
      const sira = el('div', 'karsilastir-sira');
      const dugmeler = [];
      adayListesi.forEach(function (k) {
        const secili = detay.secili.indexOf(k.id) >= 0;
        const d = el('button', 'karsilastir-aday' + (secili ? ' secili' : ''), k.etiket);
        d.type = 'button';
        d.setAttribute('aria-pressed', secili ? 'true' : 'false');
        d.title = t('yuzey.bilgi.karsilastir.aday', { etiket: k.etiket });
        ctx.odakKaydet('bi:aday:' + k.id, d);
        d.addEventListener('click', function () {
          if (!detay) return;
          const i = detay.secili.indexOf(k.id);
          if (i >= 0) detay.secili.splice(i, 1);
          else if (detay.secili.length + 1 >= EN_COK_SERI) {
            ctx.ipucu(t('yuzey.bilgi.karsilastir.sinir', { n: EN_COK_SERI }));
            return;
          } else detay.secili.push(k.id);
          detayVerisiIste();
          ctx.yenidenCiz();
        });
        sira.appendChild(d);
        dugmeler.push(d);
      });
      ctx.satirEkle(dugmeler);
      kap.appendChild(sira);
      return kap;
    }

    function detayParcalari() {
      if (!detay || !bilgi) return [];
      const ana = haritadaBul(detay.kimlik);
      if (!ana) {
        detay = null;
        return [];
      }
      const kok = el('section', 'bilgi-detay');
      const ust = el('div', 'detay-ust');
      const geri = el('button', 'detay-geri', '‹ ' + t('yuzey.bilgi.detay.geri'));
      geri.type = 'button';
      ctx.odakKaydet('bi:geri', geri);
      geri.addEventListener('click', detayKapat);
      ctx.satirEkle([geri]);
      ust.appendChild(geri);
      ust.appendChild(el('h2', 'detay-baslik', ana.etiket));
      kok.appendChild(ust);
      kok.appendChild(el('p', 'detay-simdi', t('yuzey.bilgi.detay.simdi', { deger: degerMetni(ana) })));
      kok.appendChild(aralikDugmeleri());
      kok.appendChild(grafikAlani());
      const karsilastirma = karsilastirmaBolumu();
      if (karsilastirma) kok.appendChild(karsilastirma);
      return [kok];
    }

    // ------------------------------------------------------------ dış arayüz

    return {
      /** Yeni model geldi (ya da dil/çizim yenilendi): model saklanır, gereken okumalar istenir. */
      ayarla(ham) {
        bilgi = ham ? modelDuzelt(ham, ctx.medyaKaroDuzelt) : null; // medya üst kartının tam karosu sayfanın doğrulayıcısından geçer
        if (!bilgi) {
          saatOgeleri = null;
          saatSurucusunuKur();
        } else if (bilgi.ayar.havaTahmini !== tahminAyari) {
          tahminAyari = bilgi.ayar.havaTahmini;
          tahminTuru = null; // ayar değişti: paneldeki geçici seçim bırakılır
        }
        veriIste();
        return bilgi;
      },
      /** yuzey-sayfa.js modelDuzelt içinde çağırır; sınırlı model ya da null. */
      modelDuzelt: modelDuzelt,
      heroParcalari,
      ustParcalar,
      altParcalar,
      detayParcalari,
      /** Favori sensör karoları ("Sensör" grubu); özel sayfalar (o-24) sensör üyelerini bunlardan bulur. */
      sensorKarolari() {
        return bilgi ? bilgi.sensorler.slice() : [];
      },
      /**
       * Özel sayfada (o-24) bir sensör favorisinin karosu: "Tümü" görünümündeki sensör karosunun aynısı (değer, mini grafik, gösterge,
       * dikkat vurgusu; tıklayınca geçmiş açılır). Karo bilgi modelindeki favori sensörlerden biri değilse null (başka kimlik çizilmez).
       */
      sayfaSensoru(karo) {
        if (!bilgi || !karo || typeof karo.id !== 'string') return null;
        const kayit = bilgi.sensorler.find(function (k) { return k.id === karo.id; });
        return kayit ? sensorKarosu(kayit) : null;
      },
      detayAcikMi() {
        return detay !== null;
      },
      /** Esc: açık geçmiş görünümünü kapatır; tüketildiyse true (panel kapanmaz). */
      geriGit: detayKapat,
      /** Pencere (yeniden) gösterildi: geçici durum sıfırlanır, başarısız okumalar yeniden denenir. */
      gosterildi() {
        detay = null;
        yazim = 0;
        tahminAcik = false;
        medyaAcik = false;
        [gecmis, takvim, listeler, tahminler].forEach(function (harita) {
          Array.from(harita.keys()).forEach(function (k) {
            if (harita.get(k).durum === 'hata') harita.delete(k);
          });
        });
        veriIste();
      },
      /** Pencere odak kazandı (açık kaldıysa okumalar tazelenir). */
      odakKazandi: veriIste,
      hizliEkleSatiri(sorgu) {
        return hizliEkleSatiri(bilgi, sorgu, Bicim);
      },
      /** Liste başka yerden değişti (palet hızlı ekleme): önbellek eskitilir, sonraki panel açılışında taze okunur. */
      listeyiEskit(kimlik) {
        listeler.delete(kimlik);
        tazeIstenen.add(kimlik);
      },
    };
  }

  return { olustur, modelDuzelt, hizliEkleSatiri, ARALIKLAR, EN_COK_SERIT, EN_COK_SERI };
});
