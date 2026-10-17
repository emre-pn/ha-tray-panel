/*
 * Ayarlar > Dış tetikler bölümü (1.4.0 dis grubu: o-21 Jump List ve masaüstü kısayolu, o-47 PC olayları, o-52 yerel API, o-53 toplantı
 * ışığı, o-54 evpaneli:// bağlantısı). ayarlar.js bu modülü kurar ve tek kayıt akışına bağlar (anlik / degerler / yuk / uygula); burada
 * yalnız bölümün alanları, kural satırları, durum satırları ve anında çalışan düğmeler (kısayol koy, bağlantı ve jeton kopyala, izin kaldır)
 * vardır. Ayar alanları ana süreçte src/lib/ayar-alanlari.js ile yeniden doğrulanır; hiçbiri dışa aktarılmaz, içe aktarmayla açılmaz.
 *
 * Güvenlik
 *  - Seçilebilen favoriler ana sürecin süzdüğü listedir (evPaneli.disTetikDurumu: dış kapıdan geçen, onaysız ve zararsız favoriler);
 *    kapı, kilit, alarm, perde, vana, otomasyon ve kamera listeye hiç gelmez. Ana süreç her isteği yine kendi kapısında denetler.
 *  - Yerel API jetonu bu sayfaya HİÇ gelmez: yalnız ana süreçte panoya kopyalanır (durumda yalnız jetonVar).
 *  - PC olaylarını ve "açma" iznini açmak ayrıca onay ister. Bütün metin textContent ile yazılır.
 */
(function (kok) {
  'use strict';

  const VARSAYILAN_PORT = 48123;
  const VARSAYILAN_ARALIK = 10;
  const EN_COK_PC_KURALI = 8;
  const PC_OLAYLARI = ['kilit', 'kilitAcildi', 'uyku', 'uyanis'];
  const PC_ISLEMLERI = ['kapat', 'ac', 'calistir', 'geriYukle'];
  const TOPLANTI_KAYNAKLARI = ['ikisi', 'mikrofon', 'kamera'];
  const TOPLANTI_BITISLERI = ['geriYukle', 'kapat', 'favori', 'yok'];
  // Sözlük anahtarları (düz tablolar: kullanılmayan / eksik anahtar testlerle yakalanır)
  const OLAY_ANAHTARLARI = {
    kilit: 'ayar.dis.olay.kilit',
    kilitAcildi: 'ayar.dis.olay.kilitAcildi',
    uyku: 'ayar.dis.olay.uyku',
    uyanis: 'ayar.dis.olay.uyanis',
  };
  const ISLEM_ANAHTARLARI = {
    kapat: 'ayar.dis.islem.kapat',
    ac: 'ayar.dis.islem.ac',
    calistir: 'ayar.dis.islem.calistir',
    geriYukle: 'ayar.dis.islem.geriYukle',
  };
  const KISAYOL_HATALARI = {
    kapali: 'ayar.dis.kaydetGerekli',
    'uygun-degil': 'ayar.dis.favoriUygunDegil',
    yazilamadi: 'ayar.dis.kisayolYazilamadi',
  };
  const API_HATALARI = {
    'port-kullanimda': 'ayar.dis.apiPortKullanimda',
    'port-gecersiz': 'ayar.dis.apiBaslatilamadi',
    baslatilamadi: 'ayar.dis.apiBaslatilamadi',
  };
  // Kimlik biçimini ana süreç doğrular (src/lib/ayar-alanlari.js); sayfa yalnız metin olduğuna bakar.
  const kimlikGecerliMi = (k) => typeof k === 'string' && k !== '' && k.length <= 255;

  /** Sunucudaki (ya da formdaki) kural listesinin karşılaştırılabilir biçimi. */
  function kurallariDuzelt(liste) {
    return (Array.isArray(liste) ? liste : [])
      .filter(function (k) {
        return k && typeof k === 'object' && PC_OLAYLARI.indexOf(k.olay) >= 0 && typeof k.kimlik === 'string';
      })
      .map(function (k) {
        return { olay: k.olay, kimlik: k.kimlik, islem: PC_ISLEMLERI.indexOf(k.islem) >= 0 ? k.islem : 'kapat' };
      });
  }

  /**
   * @param {object} o
   * @param {(kimlik: string) => object} o.$ öğe bulucu (ayarlar.js `$`)
   * @param {(etiket: string, sinif?: string, metin?: string) => object} o.el öğe kurucu
   * @param {(anahtar: string, degiskenler?: object) => string} o.t çevirmen
   * @param {object} o.kopru window.evPaneli
   * @param {() => void} o.kirliGuncelle
   * @param {(oge: object) => void} o.odakla
   * @param {(metin: string) => boolean} o.onayIste confirm()
   */
  function kur(o) {
    const $ = o.$;
    const el = o.el;
    const t = o.t;
    const kopru = o.kopru || {};
    const kirliGuncelle = o.kirliGuncelle;
    const odakla = o.odakla;
    const onayIste = o.onayIste;

    const g = {
      uygunlarIpucu: $('disUygunlarIpucu'),
      jumpList: $('disJumpList'),
      masaustu: $('disMasaustu'),
      kisayolFavori: $('disKisayolFavori'),
      btnKisayol: $('btnDisKisayolOlustur'),
      kisayolDurum: $('disKisayolDurum'),
      protokol: $('disProtokol'),
      baglantiFavori: $('disBaglantiFavori'),
      btnBaglanti: $('btnDisBaglantiKopyala'),
      protokolDurum: $('disProtokolDurum'),
      izinListesi: $('disIzinListesi'),
      izinBos: $('disIzinBos'),
      yerelApi: $('disYerelApi'),
      apiPortu: $('disApiPortu'),
      apiBildirim: $('disApiBildirim'),
      btnJetonKopyala: $('btnDisJetonKopyala'),
      btnJetonYenile: $('btnDisJetonYenile'),
      apiDurum: $('disApiDurum'),
      apiOrnekAdres: $('disApiOrnekAdres'),
      apiOrnekGovde: $('disApiOrnekGovde'),
      pcOlaylari: $('disPcOlaylari'),
      pcAcma: $('disPcAcma'),
      pcKuralListesi: $('disPcKuralListesi'),
      pcKuralBos: $('disPcKuralBos'),
      btnPcKuralEkle: $('btnDisPcKuralEkle'),
      toplanti: $('disToplanti'),
      toplantiKaynak: $('disToplantiKaynak'),
      toplantiFavori: $('disToplantiFavori'),
      toplantiBitis: $('disToplantiBitis'),
      toplantiBitisFavoriGrubu: $('disToplantiBitisFavoriGrubu'),
      toplantiBitisFavori: $('disToplantiBitisFavori'),
      toplantiAralik: $('disToplantiAralik'),
      toplantiDurum: $('disToplantiDurum'),
    };

    let durum = null; // son disTetikDurumu yanıtı (jeton YOK)
    let durumHatasi = false;
    let istekNo = 0;
    let kurallar = [];
    const secim = { kisayol: '', baglanti: '', toplantiFavori: '', toplantiBitisFavori: '' };
    const kayitli = { pcOlaylari: false, pcAcma: false, masaustu: false }; // sunucudaki (kaydedilmiş) değerler
    // Düğme sonuçları anahtar + değişkenle saklanır: dil değişince yeni dilde yeniden yazılır.
    let kisayolIletisi = null;
    let protokolIletisi = null;
    let apiIletisi = null;

    const uygunlar = () => (durum && Array.isArray(durum.uygunlar) ? durum.uygunlar : []);
    const kuralUygunlari = () => (durum && Array.isArray(durum.kuralUygunlari) ? durum.kuralUygunlari : []);

    function adBul(kimlik) {
      const kaynaklar = [kuralUygunlari(), uygunlar(), durum && Array.isArray(durum.izinler) ? durum.izinler : []];
      for (let i = 0; i < kaynaklar.length; i += 1) {
        const bulunan = kaynaklar[i].find(function (f) { return f && f.kimlik === kimlik && typeof f.ad === 'string' && f.ad !== ''; });
        if (bulunan) return bulunan.ad;
      }
      return kimlik;
    }

    function iletiYaz(oge, ileti) {
      oge.textContent = ileti ? ileti.map(function (p) { return t(p[0], p[1]); }).join(' ') : '';
    }

    /** Favori seçicisi: boş seçenek + liste; listede olmayan kayıtlı seçim "uygun değil" olarak korunur (sessizce kaybolmaz). */
    function favoriSeciciKur(secici, secili, liste, bosAnahtar) {
      const ogeler = [];
      const bos = el('option', '', t(bosAnahtar));
      bos.value = '';
      ogeler.push(bos);
      let bulundu = secili === '';
      liste.forEach(function (f) {
        const s = el('option', '', f.ad);
        s.value = f.kimlik;
        ogeler.push(s);
        if (f.kimlik === secili) bulundu = true;
      });
      if (!bulundu) {
        const s = el('option', '', t('ayar.dis.uygunDegil', { ad: adBul(secili) }));
        s.value = secili;
        ogeler.push(s);
      }
      secici.replaceChildren.apply(secici, ogeler);
      secici.value = secili;
    }

    function seciciKur(secenekler, deger, etiket) {
      const sec = document.createElement('select');
      secenekler.forEach(function (s) {
        const secenek = el('option', '', s[1]);
        secenek.value = s[0];
        sec.appendChild(secenek);
      });
      sec.value = deger;
      sec.setAttribute('aria-label', etiket);
      return sec;
    }

    function alanEkle(kap, kimlik, etiketMetni, girdi) {
      const kutu = el('div', 'kural-alan');
      const etiket = el('label', '', etiketMetni);
      girdi.id = kimlik;
      etiket.setAttribute('for', kimlik);
      kutu.appendChild(etiket);
      kutu.appendChild(girdi);
      kap.appendChild(kutu);
      return kutu;
    }

    function acKapaMi(kimlik) {
      const f = kuralUygunlari().find(function (x) { return x.kimlik === kimlik; });
      return f ? f.acKapa === true : true; // bilinmiyorsa (liste yüklenmedi) seçenekler daraltılmaz
    }

    function islemleri(kimlik) {
      return acKapaMi(kimlik) ? PC_ISLEMLERI.slice() : ['calistir'];
    }

    // --- PC kuralları -------------------------------------------------------------------------------------------------

    function kuralSatiriKur(k, sira) {
      const n = sira + 1;
      const grup = t('ayar.dis.kural.grup', { n: n });
      const kart = el('div', 'kural');
      kart.setAttribute('role', 'listitem');
      kart.setAttribute('aria-label', grup);
      const ust = el('div', 'kural-ust');
      ust.appendChild(el('strong', '', grup));
      const sil = el('button', 'buton buton-ikincil', t('ayar.dis.kural.sil'));
      sil.type = 'button';
      sil.setAttribute('aria-label', t('ayar.dis.kural.silEtiket', { n: n }));
      sil.addEventListener('click', function () {
        kurallar.splice(sira, 1);
        kurallariCiz();
        odakla(g.btnPcKuralEkle);
        kirliGuncelle();
      });
      ust.appendChild(sil);
      kart.appendChild(ust);

      const ikili = el('div', 'kural-ikili');
      const olay = seciciKur(PC_OLAYLARI.map(function (x) { return [x, t(OLAY_ANAHTARLARI[x])]; }), k.olay, t('ayar.dis.kural.olay') + ': ' + grup);
      alanEkle(ikili, 'disPcKural' + n + 'Olay', t('ayar.dis.kural.olay'), olay);
      olay.addEventListener('change', function () {
        k.olay = olay.value;
        kirliGuncelle();
      });
      const islem = seciciKur(islemleri(k.kimlik).map(function (x) { return [x, t(ISLEM_ANAHTARLARI[x])]; }), k.islem, t('ayar.dis.kural.islem') + ': ' + grup);
      alanEkle(ikili, 'disPcKural' + n + 'Islem', t('ayar.dis.kural.islem'), islem);
      kart.appendChild(ikili);

      const favori = document.createElement('select');
      favori.setAttribute('aria-label', t('ayar.dis.kural.favori') + ': ' + grup);
      favoriSeciciKur(favori, k.kimlik, kuralUygunlari(), 'ayar.dis.favoriSec');
      alanEkle(kart, 'disPcKural' + n + 'Favori', t('ayar.dis.kural.favori'), favori);

      const uyari = el('div', 'kural-hata');
      kart.appendChild(uyari);
      const uyariYaz = function () {
        const gerekli = k.islem !== 'kapat' && !g.pcAcma.checked;
        uyari.textContent = gerekli ? t('ayar.dis.kural.acmaGerekli') : '';
        uyari.style.display = gerekli ? 'block' : 'none';
      };
      uyariYaz();
      islem.addEventListener('change', function () {
        k.islem = islem.value;
        uyariYaz();
        kirliGuncelle();
      });
      favori.addEventListener('change', function () {
        k.kimlik = favori.value;
        if (islemleri(k.kimlik).indexOf(k.islem) < 0) k.islem = islemleri(k.kimlik)[0];
        kurallariCiz();
        kirliGuncelle();
      });
      return kart;
    }

    function kurallariCiz() {
      g.pcKuralListesi.replaceChildren.apply(g.pcKuralListesi, kurallar.map(kuralSatiriKur));
      g.pcKuralBos.textContent = kurallar.length === 0 ? t('ayar.dis.kural.bos') : '';
      g.btnPcKuralEkle.disabled = kurallar.length >= EN_COK_PC_KURALI || kuralUygunlari().length === 0;
    }

    // --- durum satırları ----------------------------------------------------------------------------------------------

    function ornekCiz() {
      const port = /^\d+$/.test(String(g.apiPortu.value).trim()) ? String(g.apiPortu.value).trim() : String(VARSAYILAN_PORT);
      const ad = uygunlar().length > 0 ? uygunlar()[0].ad : '…';
      // Başlık satırları (jeton yeri "…") ayarlar.html'de sabittir; yalnız adres (port) ve gövde (ilk uygun favorinin adı) yazılır.
      g.apiOrnekAdres.textContent = 'POST http://127.0.0.1:' + port + '/eylem';
      g.apiOrnekGovde.textContent = JSON.stringify({ ad: ad });
    }

    function durumuCiz() {
      if (durumHatasi) g.uygunlarIpucu.textContent = t('ayar.dis.durumAlinamadi');
      else if (!durum) g.uygunlarIpucu.textContent = '';
      else if (uygunlar().length === 0 && kuralUygunlari().length === 0) g.uygunlarIpucu.textContent = t('ayar.dis.uygunYok');
      else {
        const adlar = [];
        uygunlar().concat(kuralUygunlari()).forEach(function (f) {
          if (adlar.indexOf(f.ad) < 0) adlar.push(f.ad);
        });
        g.uygunlarIpucu.textContent = t('ayar.dis.uygunlar', { liste: adlar.join(', ') });
      }

      if (!uygunlar().some(function (f) { return f.kimlik === secim.kisayol; })) secim.kisayol = '';
      if (!uygunlar().some(function (f) { return f.kimlik === secim.baglanti; })) secim.baglanti = '';
      favoriSeciciKur(g.kisayolFavori, secim.kisayol, uygunlar(), 'ayar.dis.favoriSec');
      favoriSeciciKur(g.baglantiFavori, secim.baglanti, uygunlar(), 'ayar.dis.favoriSec');
      favoriSeciciKur(g.toplantiFavori, secim.toplantiFavori, kuralUygunlari(), 'ayar.dis.favoriYok');
      favoriSeciciKur(g.toplantiBitisFavori, secim.toplantiBitisFavori, kuralUygunlari(), 'ayar.dis.favoriYok');
      g.btnKisayol.disabled = uygunlar().length === 0;
      g.btnBaglanti.disabled = uygunlar().length === 0;

      // evpaneli:// kaydı ve "Her zaman" izinleri
      const kayit = [[durum && durum.protokol && durum.protokol.kayitli ? 'ayar.dis.protokolKayitli' : 'ayar.dis.protokolKayitsiz']];
      iletiYaz(g.protokolDurum, protokolIletisi ? protokolIletisi.concat(kayit) : durum ? kayit : null);
      const izinler = durum && Array.isArray(durum.izinler) ? durum.izinler : [];
      g.izinListesi.replaceChildren.apply(
        g.izinListesi,
        izinler.map(function (izin) {
          const satir = el('div', 'dis-izin');
          satir.setAttribute('role', 'listitem');
          const ad = typeof izin.ad === 'string' && izin.ad !== '' ? izin.ad : t('ayar.dis.favoriDegil', { ad: izin.kimlik });
          satir.appendChild(el('span', '', ad));
          const kaldir = el('button', 'buton buton-ikincil', t('ayar.dis.izinKaldir'));
          kaldir.type = 'button';
          kaldir.setAttribute('aria-label', t('ayar.dis.izinKaldirEtiket', { ad: ad }));
          kaldir.addEventListener('click', function () {
            izinKaldir(izin.kimlik);
          });
          satir.appendChild(kaldir);
          return satir;
        }),
      );
      g.izinBos.textContent = izinler.length === 0 ? t('ayar.dis.izinBos') : '';

      // yerel API (jeton yok; yalnız var/yok)
      const api = durum && durum.api ? durum.api : null;
      const apiSatiri = [];
      if (api && api.calisiyor) apiSatiri.push(['ayar.dis.apiCalisiyor', { port: api.port }]);
      else if (api && API_HATALARI[api.hata]) apiSatiri.push([API_HATALARI[api.hata], { port: g.apiPortu.value }]);
      else if (api) apiSatiri.push(['ayar.dis.apiKapali']);
      if (api && api.jetonVar !== true) apiSatiri.push(['ayar.dis.jetonYok']);
      iletiYaz(g.apiDurum, (apiIletisi || []).concat(apiSatiri));
      ornekCiz();

      // toplantı ışığı
      const top = durum && durum.toplanti ? durum.toplanti : null;
      let toplantiAnahtari = '';
      if (top && top.okunabilir === false) toplantiAnahtari = 'ayar.dis.toplantiDurum.okunamaz';
      else if (top && top.calisiyor) toplantiAnahtari = top.toplantida ? 'ayar.dis.toplantiDurum.toplantida' : 'ayar.dis.toplantiDurum.bos';
      else if (top && g.toplanti.checked && secim.toplantiFavori === '') toplantiAnahtari = 'ayar.dis.toplantiDurum.favoriGerekli';
      else if (top) toplantiAnahtari = 'ayar.dis.toplantiDurum.kapali';
      g.toplantiDurum.textContent = toplantiAnahtari ? t(toplantiAnahtari) : '';

      iletiYaz(g.kisayolDurum, kisayolIletisi);
      kurallariCiz();
    }

    function bitisGrubunuGuncelle() {
      g.toplantiBitisFavoriGrubu.style.display = g.toplantiBitis.value === 'favori' ? 'block' : 'none';
    }

    /** Ana süreçten güncel durumu ister (sayfa açılışı, kayıt, ana süreç olayı). Eski yanıt yenisini ezmez. */
    function yenile() {
      if (typeof kopru.disTetikDurumu !== 'function') return Promise.resolve();
      istekNo += 1;
      const no = istekNo;
      return Promise.resolve()
        .then(function () { return kopru.disTetikDurumu(); })
        .then(
          function (yanit) {
            if (no !== istekNo) return;
            durumHatasi = !yanit || yanit.ok !== true;
            durum = durumHatasi ? null : yanit;
            durumuCiz();
          },
          function () {
            if (no !== istekNo) return;
            durumHatasi = true;
            durum = null;
            durumuCiz();
          },
        );
    }

    // --- anında çalışan düğmeler --------------------------------------------------------------------------------------

    async function kisayolKoy() {
      if (!secim.kisayol) {
        kisayolIletisi = [['ayar.dis.secimGerekli']];
        durumuCiz();
        return;
      }
      if (!g.masaustu.checked || !kayitli.masaustu) {
        kisayolIletisi = [['ayar.dis.kaydetGerekli']];
        durumuCiz();
        return;
      }
      let yanit = null;
      try {
        yanit = await kopru.disKisayolOlustur(secim.kisayol);
      } catch {
        yanit = null;
      }
      if (yanit && yanit.ok) kisayolIletisi = [['ayar.dis.kisayolKondu', { dosya: String(yanit.dosya || '') }]];
      else kisayolIletisi = [[KISAYOL_HATALARI[yanit && yanit.hata] || 'ayar.dis.kisayolYazilamadi']];
      durumuCiz();
    }

    async function baglantiKopyala() {
      if (!secim.baglanti) {
        protokolIletisi = [['ayar.dis.secimGerekli']];
        durumuCiz();
        return;
      }
      let yanit = null;
      try {
        yanit = await kopru.disBaglantiKopyala(secim.baglanti);
      } catch {
        yanit = null;
      }
      protokolIletisi = yanit && yanit.ok ? [['ayar.dis.baglantiKopyalandi']] : [['ayar.dis.favoriUygunDegil']];
      if (yanit && yanit.ok && !(durum && durum.protokol && durum.protokol.kayitli)) protokolIletisi.push(['ayar.dis.kaydetGerekli']);
      durumuCiz();
    }

    async function jetonKopyala() {
      let yanit = null;
      try {
        yanit = await kopru.disJetonKopyala();
      } catch {
        yanit = null;
      }
      apiIletisi = [[yanit && yanit.ok ? 'ayar.dis.jetonKopyalandi' : 'ayar.dis.jetonHata']];
      await yenile();
    }

    async function jetonYenile() {
      if (!onayIste(t('ayar.dis.jetonYenileOnay'))) return;
      let yanit = null;
      try {
        yanit = await kopru.disJetonYenile();
      } catch {
        yanit = null;
      }
      apiIletisi = [[yanit && yanit.ok ? 'ayar.dis.jetonYenilendi' : 'ayar.dis.jetonHata']];
      await yenile();
    }

    async function izinKaldir(kimlik) {
      try {
        await kopru.disIzinKaldir(kimlik);
      } catch {
        /* durum yeniden okunur */
      }
      protokolIletisi = null;
      await yenile();
      odakla(g.protokol);
    }

    // --- bağlantılar --------------------------------------------------------------------------------------------------

    [g.jumpList, g.masaustu, g.protokol, g.yerelApi, g.apiBildirim, g.toplanti].forEach(function (kutu) {
      kutu.addEventListener('change', function () {
        if (kutu === g.toplanti) durumuCiz();
        kirliGuncelle();
      });
    });
    g.pcOlaylari.addEventListener('change', function () {
      // İlk açılışta ne olacağı söylenir; kaydedilmiş açık değere dönüşte yeniden sorulmaz.
      if (g.pcOlaylari.checked && !kayitli.pcOlaylari && !onayIste(t('ayar.dis.pcUyari'))) g.pcOlaylari.checked = false;
      kirliGuncelle();
    });
    g.pcAcma.addEventListener('change', function () {
      if (g.pcAcma.checked && !kayitli.pcAcma && !onayIste(t('ayar.dis.pcAcmaOnay'))) g.pcAcma.checked = false;
      kurallariCiz();
      kirliGuncelle();
    });
    [g.apiPortu, g.toplantiAralik].forEach(function (girdi) {
      girdi.addEventListener('input', function () {
        if (girdi === g.apiPortu) ornekCiz();
        kirliGuncelle();
      });
    });
    g.toplantiKaynak.addEventListener('change', kirliGuncelle);
    g.toplantiBitis.addEventListener('change', function () {
      bitisGrubunuGuncelle();
      kirliGuncelle();
    });
    g.toplantiFavori.addEventListener('change', function () {
      secim.toplantiFavori = g.toplantiFavori.value;
      durumuCiz();
      kirliGuncelle();
    });
    g.toplantiBitisFavori.addEventListener('change', function () {
      secim.toplantiBitisFavori = g.toplantiBitisFavori.value;
      kirliGuncelle();
    });
    g.kisayolFavori.addEventListener('change', function () {
      secim.kisayol = g.kisayolFavori.value;
      kisayolIletisi = null;
      iletiYaz(g.kisayolDurum, null);
    });
    g.baglantiFavori.addEventListener('change', function () {
      secim.baglanti = g.baglantiFavori.value;
    });
    g.btnKisayol.addEventListener('click', kisayolKoy);
    g.btnBaglanti.addEventListener('click', baglantiKopyala);
    g.btnJetonKopyala.addEventListener('click', jetonKopyala);
    g.btnJetonYenile.addEventListener('click', jetonYenile);
    g.btnPcKuralEkle.addEventListener('click', function () {
      if (kurallar.length >= EN_COK_PC_KURALI || kuralUygunlari().length === 0) return;
      const ilk = kuralUygunlari()[0];
      kurallar.push({ olay: 'kilit', kimlik: ilk.kimlik, islem: ilk.acKapa === true ? 'kapat' : 'calistir' });
      kurallariCiz();
      kirliGuncelle();
      const son = g.pcKuralListesi.children[g.pcKuralListesi.children.length - 1];
      if (son && typeof son.querySelector === 'function') odakla(son.querySelector('select'));
    });
    if (typeof kopru.onDisDurumDegisti === 'function') {
      kopru.onDisDurumDegisti(function () {
        yenile();
      });
    }

    // --- kayıt akışı (ayarlar.js) -------------------------------------------------------------------------------------

    /** Form değerleri (karşılaştırma için normalleştirilmiş). */
    function anlik() {
      return {
        tetikJumpList: g.jumpList.checked,
        tetikMasaustu: g.masaustu.checked,
        tetikProtokol: g.protokol.checked,
        tetikYerelApi: g.yerelApi.checked,
        tetikApiPortu: String(g.apiPortu.value).trim(),
        tetikApiBildirim: g.apiBildirim.checked,
        tetikPcOlaylari: g.pcOlaylari.checked,
        tetikPcAcma: g.pcAcma.checked,
        tetikPcKurallari: kurallariDuzelt(kurallar),
        tetikToplanti: g.toplanti.checked,
        tetikToplantiKaynak: g.toplantiKaynak.value,
        tetikToplantiFavori: secim.toplantiFavori,
        tetikToplantiBitis: g.toplantiBitis.value,
        tetikToplantiBitisFavori: secim.toplantiBitisFavori,
        tetikToplantiAralik: String(g.toplantiAralik.value).trim(),
      };
    }

    /** Sunucu özetinin aynı biçimdeki karşılığı. */
    function degerler(sonuc) {
      const s = sonuc || {};
      return {
        tetikJumpList: s.tetikJumpList === true,
        tetikMasaustu: s.tetikMasaustu === true,
        tetikProtokol: s.tetikProtokol === true,
        tetikYerelApi: s.tetikYerelApi === true,
        tetikApiPortu: String(Number.isInteger(s.tetikApiPortu) ? s.tetikApiPortu : VARSAYILAN_PORT),
        tetikApiBildirim: s.tetikApiBildirim === true,
        tetikPcOlaylari: s.tetikPcOlaylari === true,
        tetikPcAcma: s.tetikPcAcma === true,
        tetikPcKurallari: kurallariDuzelt(s.tetikPcKurallari).filter(function (k) { return kimlikGecerliMi(k.kimlik); }),
        tetikToplanti: s.tetikToplanti === true,
        tetikToplantiKaynak: TOPLANTI_KAYNAKLARI.indexOf(s.tetikToplantiKaynak) >= 0 ? s.tetikToplantiKaynak : 'ikisi',
        tetikToplantiFavori: kimlikGecerliMi(s.tetikToplantiFavori) ? s.tetikToplantiFavori : '',
        tetikToplantiBitis: TOPLANTI_BITISLERI.indexOf(s.tetikToplantiBitis) >= 0 ? s.tetikToplantiBitis : 'geriYukle',
        tetikToplantiBitisFavori: kimlikGecerliMi(s.tetikToplantiBitisFavori) ? s.tetikToplantiBitisFavori : '',
        tetikToplantiAralik: String(Number.isInteger(s.tetikToplantiAralik) ? s.tetikToplantiAralik : VARSAYILAN_ARALIK),
      };
    }

    /** Kayıt yükü: sayılar metin olarak gider, doğrulama ana süreçtedir (geçersiz değer eskisini korur ve uyarı döner). */
    function yuk(a) {
      const d = a || anlik();
      return {
        tetikJumpList: d.tetikJumpList,
        tetikMasaustu: d.tetikMasaustu,
        tetikProtokol: d.tetikProtokol,
        tetikYerelApi: d.tetikYerelApi,
        tetikApiPortu: d.tetikApiPortu,
        tetikApiBildirim: d.tetikApiBildirim,
        tetikPcOlaylari: d.tetikPcOlaylari,
        tetikPcAcma: d.tetikPcAcma,
        tetikPcKurallari: d.tetikPcKurallari,
        tetikToplanti: d.tetikToplanti,
        tetikToplantiKaynak: d.tetikToplantiKaynak,
        tetikToplantiFavori: d.tetikToplantiFavori,
        tetikToplantiBitis: d.tetikToplantiBitis,
        tetikToplantiBitisFavori: d.tetikToplantiBitisFavori,
        tetikToplantiAralik: d.tetikToplantiAralik,
      };
    }

    /** Bölümü sunucudaki değerlere döndürür (sayfa açılışı, kayıt, içe aktarma); durum yeniden istenir. */
    function uygula(d) {
      g.jumpList.checked = d.tetikJumpList;
      g.masaustu.checked = d.tetikMasaustu;
      g.protokol.checked = d.tetikProtokol;
      g.yerelApi.checked = d.tetikYerelApi;
      g.apiPortu.value = d.tetikApiPortu;
      g.apiBildirim.checked = d.tetikApiBildirim;
      g.pcOlaylari.checked = d.tetikPcOlaylari;
      g.pcAcma.checked = d.tetikPcAcma;
      kayitli.pcOlaylari = d.tetikPcOlaylari;
      kayitli.pcAcma = d.tetikPcAcma;
      kayitli.masaustu = d.tetikMasaustu;
      kurallar = d.tetikPcKurallari.map(function (k) { return { olay: k.olay, kimlik: k.kimlik, islem: k.islem }; });
      g.toplanti.checked = d.tetikToplanti;
      g.toplantiKaynak.value = d.tetikToplantiKaynak;
      secim.toplantiFavori = d.tetikToplantiFavori;
      g.toplantiBitis.value = d.tetikToplantiBitis;
      secim.toplantiBitisFavori = d.tetikToplantiBitisFavori;
      g.toplantiAralik.value = d.tetikToplantiAralik;
      kisayolIletisi = null;
      protokolIletisi = null;
      apiIletisi = null;
      bitisGrubunuGuncelle();
      durumuCiz();
      yenile();
    }

    /** Dil değişti: seçici seçenekleri, kural satırları ve durum satırları yeni dilde yeniden yazılır (seçimler korunur). */
    function metinleriYenile() {
      durumuCiz();
    }

    durumuCiz();
    return { anlik: anlik, degerler: degerler, yuk: yuk, uygula: uygula, metinleriYenile: metinleriYenile, yenile: yenile };
  }

  kok.EvAyarlarDis = { kur: kur, kurallariDuzelt: kurallariDuzelt };
})(typeof window !== 'undefined' ? window : globalThis);
