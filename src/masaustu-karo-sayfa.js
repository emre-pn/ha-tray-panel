/*
 * Masaüstü karosu sayfasının betiği (renderer, o-33). Ana süreç `karo:durum` ile karo modelini gönderir (src/lib/masaustu-karo.js
 * masaustuKaroModeli: kimlik, etiket, durum, değer, tıklanabilirlik, parlaklık ön ayarları, bağlantı); tüm metin YALNIZ textContent
 * ile yazılır (HTML olarak yorumlanan atama yok). Köprü: preload-karo.js (window.evKaro). Karonun kimliği sayfadan gitmez: ana
 * süreç hangi pencerenin hangi karoya ait olduğunu kendisi bilir; sayfa yalnız "tıkla" ya da bir parlaklık ön ayarı yollar.
 * (Ana süreç tarafı: masaustu-karolari.js.)
 *
 * Görünüm (o-25 / o-29 / o-34): `karo:durum` ve durumAl yanıtındaki `gorunum` (ana süreçte üretilen model: yüksek karşıtlık, hazır/özel palet,
 * "Hareketi azalt") lib/tema-renk.js gorunumUygula ile <html> üzerine yazılır; yüklenemezse karo varsayılan görünümle çizilir.
 *
 * Arayüz dili: HTML'deki Türkçe varsayılandır; durumAl yanıtındaki `dil` ve `dil:degisti` iletisiyle çevrilir (lib/dil.js +
 * lib/ceviri/yuzey.js). Betikteki görünür metinlerin hepsi sözlükten gelir (t('anahtar')); çeviri betikleri yüklenemese bile karo
 * yine çizilir (etiket ve değer; metin anahtarları yerine boş bırakılır).
 */
(function () {
  'use strict';

  const HATA_GOSTERIM_MS = 1200;
  const kok = document.getElementById('karo');
  const baglantiOgesi = document.getElementById('baglanti');
  const kaldirDugmesi = document.getElementById('kaldir');
  const anaDugme = document.getElementById('ana');
  const etiketOgesi = document.getElementById('etiket');
  const degerOgesi = document.getElementById('deger');
  const onayarKutusu = document.getElementById('onayarlar');
  const kopru = window.evKaro;
  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  // Çeviri betikleri yüklenemezse (paketleme hatası) metin yerine boş döner; karo etiket ve değeriyle yine de çizilir.
  let t = Dil && Sozluk ? Dil.cevirmen('tr', Sozluk) : function () { return ''; };
  let dil = 'tr'; // etkin arayüz dili (sayı ayracı için); dilUygula günceller
  let model = null;
  let bekliyor = false; // bir eylem sürerken ikinci tıklama yok sayılır
  let hataZamanlayicisi = null;

  function degerMetni(m) {
    if (m.ulasilamiyor) return t('yuzey.durum.ulasilamiyor');
    const o = m.ozellik;
    if (m.alan === 'sensor') {
      if (!o || o.deger === null || o.deger === undefined || o.deger === '') return '—';
      // Panelle (yuzey-bilgi.js degerMetni) aynı mantık: sayı hassasiyet ve dil ayracıyla birimiyle yazılır; HA'nın 'unknown' / 'unavailable'
      // durumları çevrilmiş metin olur; sayı olmayan metin değerine (ör. saat, 'abc') birim eklenmez.
      const Bicim = window.EvBilgiBicim;
      const sayi = Bicim && typeof Bicim.sensorSayisiMetni === 'function' ? Bicim.sensorSayisiMetni(o, { dil: dil }) : '';
      if (sayi !== '') return sayi;
      if (o.deger === 'unknown') return t('yuzey.bilgi.sensor.bilinmiyor');
      if (o.deger === 'unavailable') return t('yuzey.durum.ulasilamiyor');
      // Biçimleyici yüklenemediyse: sayısal değer eskisi gibi ham değer + birim
      if (!Bicim && Number.isFinite(o.sayi) && o.birim) return o.deger + ' ' + o.birim;
      return String(o.deger);
    }
    if (m.alan === 'binary_sensor') {
      if (!o || (o.acik !== true && o.acik !== false)) return '—';
      return o.acik ? t('yuzey.durum.acik') : t('yuzey.durum.kapali');
    }
    if (m.durum === 'acik') return m.yuzde !== null && m.yuzde !== undefined ? t('yuzey.yuzde', { n: m.yuzde }) : t('yuzey.durum.acik');
    if (m.durum === 'kapali') return t('yuzey.durum.kapali');
    return '—';
  }

  function baglantiMetni(b) {
    if (!b || typeof b !== 'object') return { sinif: '', metin: '' };
    if (b.canli === true) return { sinif: 'canli', metin: t('yuzey.baglanti.canli') };
    if (b.baglanti === 'yedek') return { sinif: 'yedek', metin: t('masaustu.baglanti.yedek') };
    if (b.baglanti === 'baglaniyor') return { sinif: '', metin: t('yuzey.baglanti.baglaniyor') };
    return { sinif: '', metin: t('yuzey.baglanti.kapali') };
  }

  /** Karoya en yakın parlaklık ön ayarı (yalnız vurgu için): ışık açıksa %yuzde değerine en yakın ön ayar. */
  function secilenOnayar(m) {
    if (m.durum !== 'acik' || m.yuzde === null || m.yuzde === undefined) return null;
    let en = null;
    let fark = Infinity;
    for (const p of m.parlaklikOnAyarlari) {
      const f = Math.abs(p - m.yuzde);
      if (f < fark) {
        en = p;
        fark = f;
      }
    }
    return fark <= 12 ? en : null; // ön ayarlardan hiçbirine yakın değilse (örn. %40 ile %50 arası) yakın olan; uzaksa hiçbiri
  }

  /** Bir ön ayar düğmesinin görünür durumunu (metin, seçili sınıfı, aria, devre dışı) modele göre yazar; düğmeyi yeniden yaratmaz. */
  function onayarDugmesiniGuncelle(d, p, secili, m) {
    d.className = 'onayar' + (p === secili ? ' secili' : '');
    d.textContent = t('yuzey.yuzde', { n: p });
    d.setAttribute('aria-label', t('yuzey.karo.parlaklik', { etiket: m.etiket }) + ' ' + t('yuzey.yuzde', { n: p }));
    d.setAttribute('aria-pressed', p === secili ? 'true' : 'false');
    d.disabled = !m.kullanilabilir;
  }

  function onayarlariCiz(m) {
    const liste = Array.isArray(m.parlaklikOnAyarlari) ? m.parlaklikOnAyarlari : [];
    const gizli = liste.length === 0;
    if (onayarKutusu.hidden !== gizli) onayarKutusu.hidden = gizli;
    const secili = secilenOnayar(m);
    const mevcut = onayarKutusu.children;
    // Ön ayar listesi değişmediyse düğmeler yerinde güncellenir: her model güncellemesinde (ışık yüzdesi, bağlantı durumu) düğmeleri silip
    // yeniden kurmak odaktaki düğmeyi DOM'dan çıkarır, klavye odağı ve ekran okuyucu konumu kaybolurdu (yuzey-sayfa.js modelUygula 'odak korunur').
    const ayni = mevcut.length === liste.length && liste.every(function (p, i) {
      return mevcut[i].getAttribute('data-deger') === String(p);
    });
    if (ayni) {
      liste.forEach(function (p, i) {
        onayarDugmesiniGuncelle(mevcut[i], p, secili, m);
      });
      return;
    }
    // Liste değişti (parlaklık kontrolü açıldı/kapandı): yeniden kur; odak bir ön ayar düğmesindeyse aynı değerli yeni düğmeye taşınır.
    const aktif = typeof document.activeElement === 'object' ? document.activeElement : null;
    const odakDegeri = aktif && Array.prototype.indexOf.call(mevcut, aktif) >= 0 ? aktif.getAttribute('data-deger') : null;
    onayarKutusu.textContent = '';
    let odaklanacak = null;
    for (const p of liste) {
      const d = document.createElement('button');
      d.type = 'button';
      d.setAttribute('data-deger', String(p));
      onayarDugmesiniGuncelle(d, p, secili, m);
      d.addEventListener('click', function () {
        calistir({ parlaklik: p });
      });
      onayarKutusu.appendChild(d);
      if (odakDegeri !== null && String(p) === odakDegeri) odaklanacak = d;
    }
    if (odaklanacak && typeof odaklanacak.focus === 'function') odaklanacak.focus();
  }

  function ciz() {
    if (!model) return;
    const m = model;
    etiketOgesi.textContent = String(m.etiket || '');
    degerOgesi.textContent = degerMetni(m);
    kok.classList.toggle('acik', m.durum === 'acik' && !m.ulasilamiyor);
    kok.setAttribute('aria-label', String(m.etiket || ''));
    anaDugme.disabled = m.tiklanabilir !== true;
    anaDugme.setAttribute('aria-label', String(m.etiket || '') + ': ' + degerMetni(m));
    if (m.tiklanabilir === true) {
      const anahtar = m.alan === 'scene' ? 'masaustu.tiklaCalistir' : 'masaustu.tiklaDegistir';
      anaDugme.title = t(anahtar, { etiket: m.etiket });
    } else {
      anaDugme.title = String(m.etiket || '');
    }
    const b = baglantiMetni(m.baglanti);
    baglantiOgesi.textContent = b.metin;
    baglantiOgesi.className = 'baglanti' + (b.sinif ? ' ' + b.sinif : '');
    onayarlariCiz(m);
  }

  function malzemeAyarla(deger) {
    const k = document.documentElement;
    if (!k || !k.dataset) return;
    if (deger === 'acrylic' || deger === 'mica') k.dataset.malzeme = deger;
    else delete k.dataset.malzeme;
  }

  // Görünüm modeli: yoksa (varsayılan görünüm) önceki özel görünüm temizlenir. Sistemin "animasyonları azalt" tercihi de hareketi azaltır.
  function gorunumAyarla(gorunum) {
    const Tema = window.EvTemaRenk;
    if (!Tema || typeof Tema.gorunumUygula !== 'function') return;
    const azalt = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    Tema.gorunumUygula(document.documentElement, gorunum, { hareketAzalt: azalt });
  }

  function hataGoster() {
    kok.classList.add('hata');
    clearTimeout(hataZamanlayicisi);
    hataZamanlayicisi = setTimeout(function () {
      kok.classList.remove('hata');
    }, HATA_GOSTERIM_MS);
  }

  /** Ana sürece tıklama / ön ayar yükü gönderir. Sonuç bildirimi ana süreçtedir (köşe bildirimi); sayfa yalnız hata çerçevesi çizer. */
  async function calistir(yuk) {
    if (!kopru || typeof kopru.calistir !== 'function' || bekliyor || !model) return;
    bekliyor = true;
    try {
      const yanit = await kopru.calistir(yuk);
      if (!yanit || yanit.ok !== true) hataGoster();
    } catch {
      hataGoster();
    } finally {
      bekliyor = false;
    }
  }

  function modelAl(yuk) {
    if (!yuk || typeof yuk !== 'object') return;
    if (yuk.malzeme !== undefined) malzemeAyarla(yuk.malzeme);
    gorunumAyarla(yuk.gorunum);
    if (yuk.model && typeof yuk.model === 'object') {
      model = yuk.model;
      ciz();
    }
  }

  /** Ana süreç etkin dili bildirdi: sayfa metinleri çevrilir, karo yeniden çizilir. Geçersiz dil yok sayılır. */
  function dilUygula(yuk) {
    if (!Dil || !Sozluk || !yuk || typeof yuk !== 'object' || Dil.DILLER.indexOf(yuk.dil) < 0) return;
    t = Dil.cevirmen(yuk.dil, Sozluk);
    dil = yuk.dil;
    Dil.sayfayiCevir(document, t);
    ciz();
  }

  anaDugme.addEventListener('click', function () {
    calistir({ tur: 'tikla' });
  });
  kaldirDugmesi.addEventListener('click', function () {
    if (kopru && typeof kopru.kaldir === 'function') kopru.kaldir();
  });

  if (kopru) {
    if (typeof kopru.onDurum === 'function') kopru.onDurum(modelAl);
    if (typeof kopru.onDilDegisti === 'function') kopru.onDilDegisti(dilUygula);
    if (typeof kopru.durumAl === 'function') {
      Promise.resolve(kopru.durumAl()).then(function (yanit) {
        if (!yanit || yanit.ok !== true) return;
        if (yanit.dil !== undefined) dilUygula({ dil: yanit.dil });
        modelAl({ model: yanit.model, malzeme: yanit.malzeme, gorunum: yanit.gorunum });
      }).catch(function () {
        /* ana süreç yanıt vermedi: karo boş kalır, sonraki karo:durum iletisiyle dolar */
      });
    }
  }
})();
