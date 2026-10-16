/*
 * Masaüstü karosu sayfasının betiği (renderer, o-33). Ana süreç `karo:durum` ile karo modelini gönderir (src/lib/masaustu-karo.js
 * masaustuKaroModeli: kimlik, etiket, durum, değer, tıklanabilirlik, parlaklık ön ayarları, bağlantı); tüm metin YALNIZ textContent
 * ile yazılır (HTML olarak yorumlanan atama yok). Köprü: preload-karo.js (window.evKaro). Karonun kimliği sayfadan gitmez: ana
 * süreç hangi pencerenin hangi karoya ait olduğunu kendisi bilir; sayfa yalnız "tıkla" ya da bir parlaklık ön ayarı yollar.
 * (Ana süreç tarafı: masaustu-karolari.js.)
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
  let model = null;
  let bekliyor = false; // bir eylem sürerken ikinci tıklama yok sayılır
  let hataZamanlayicisi = null;

  function degerMetni(m) {
    if (m.ulasilamiyor) return t('yuzey.durum.ulasilamiyor');
    const o = m.ozellik;
    if (m.alan === 'sensor') {
      if (!o || o.deger === null || o.deger === undefined || o.deger === '') return '—';
      return o.birim ? o.deger + ' ' + o.birim : String(o.deger);
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

  function onayarlariCiz(m) {
    onayarKutusu.textContent = '';
    const liste = Array.isArray(m.parlaklikOnAyarlari) ? m.parlaklikOnAyarlari : [];
    onayarKutusu.hidden = liste.length === 0;
    const secili = secilenOnayar(m);
    for (const p of liste) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'onayar' + (p === secili ? ' secili' : '');
      d.textContent = t('yuzey.yuzde', { n: p });
      d.setAttribute('aria-label', t('yuzey.karo.parlaklik', { etiket: m.etiket }) + ' ' + t('yuzey.yuzde', { n: p }));
      d.setAttribute('aria-pressed', p === secili ? 'true' : 'false');
      d.disabled = !m.kullanilabilir;
      d.addEventListener('click', function () {
        calistir({ parlaklik: p });
      });
      onayarKutusu.appendChild(d);
    }
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
    if (yuk.model && typeof yuk.model === 'object') {
      model = yuk.model;
      ciz();
    }
  }

  /** Ana süreç etkin dili bildirdi: sayfa metinleri çevrilir, karo yeniden çizilir. Geçersiz dil yok sayılır. */
  function dilUygula(yuk) {
    if (!Dil || !Sozluk || !yuk || typeof yuk !== 'object' || Dil.DILLER.indexOf(yuk.dil) < 0) return;
    t = Dil.cevirmen(yuk.dil, Sozluk);
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
        modelAl({ model: yanit.model, malzeme: yanit.malzeme });
      }).catch(function () {
        /* ana süreç yanıt vermedi: karo boş kalır, sonraki karo:durum iletisiyle dolar */
      });
    }
  }
})();
