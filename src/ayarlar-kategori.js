'use strict';

/**
 * Ayarlar penceresinin kategorileri (1.6.0): Windows 11 Ayarlar gibi solda kategori menüsü, sağda yalnız seçili kategorinin bölümleri.
 * Bölüm–kategori eşlemesi burada tutulur; ayarlar.html'deki bölümler, kimlikleri ve sırası değişmez (sayfanın mantığı ve testleri onlara
 * bakar). Seçili olmayan kategorinin bölümleri yalnız `kategori-disi` sınıfıyla gizlenir. Ayarlarda arama sürerken bütün kategoriler
 * görünür; arama kendi `arama-gizli` sınıfıyla süzer (lib/ayar-arama.js), arama bitince seçili kategoriye dönülür.
 *
 * Uzun yardım metinleri (1.6.0): bir ayarın altındaki uzun açıklama iki satıra kısaltılır, yanına "Ayrıntı" düğmesi eklenir (aria-expanded).
 * Metnin kendisi sayfada kalır: ekran okuyucu (aria-describedby) ve arama tam metni görür.
 *
 * HTML ataması yok: yalnız sınıf, öznitelik ve textContent değişir. Bu dosya hem Node'da (require, test) hem renderer'da
 * (<script src="ayarlar-kategori.js">, window.EvAyarKategori) çalışır; ayarlar.js modül yoksa sayfayı eskisi gibi tek sayfa gösterir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvAyarKategori = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GIZLI_SINIF = 'kategori-disi';
  const IPUCU_SINIRI = 110; // bundan uzun yardım metni kısaltılır (karakter)

  /** Kategori sırası menüdeki sıradır; her kategorinin ilk bölümü menü bağlantısının hedefidir. */
  const KATEGORILER = Object.freeze([
    { kod: 'baglanti', baglanti: 'gezinBaglanti', bolumler: ['bolumBaglanti', 'bolumAnahtar'] },
    { kod: 'favoriler', baglanti: 'gezinFavoriler', bolumler: ['bolumFavoriler'] },
    { kod: 'gorunum', baglanti: 'gezinGorunum', bolumler: ['bolumGorunum'] },
    { kod: 'pencere', baglanti: 'gezinPencere', bolumler: ['bolumPencere', 'bolumTepsiRozeti', 'bolumMasaustu', 'bolumBaslangic'] },
    { kod: 'kisayollar', baglanti: 'gezinKisayollar', bolumler: ['bolumKisayollar'] },
    { kod: 'bildirimler', baglanti: 'gezinBildirimler', bolumler: ['bolumGeriBildirim', 'bolumBildirimler', 'bolumMobil'] },
    { kod: 'kartlar', baglanti: 'gezinKartlar', bolumler: ['bolumBilgi', 'bolumKamera'] },
    { kod: 'otomasyon', baglanti: 'gezinOtomasyon', bolumler: ['bolumEtkinlik', 'bolumDisTetikler'] },
    { kod: 'yedek', baglanti: 'gezinYedek', bolumler: ['bolumYedek', 'bolumEsitleme'] },
    { kod: 'hakkinda', baglanti: 'gezinHakkinda', bolumler: ['bolumSurum', 'bolumAraclar'] },
  ].map((k) => Object.freeze({ ...k, bolumler: Object.freeze(k.bolumler) })));

  /** Bölüm kimliği -> kategori kodu. */
  const BOLUM_KATEGORISI = new Map();
  for (const k of KATEGORILER) for (const b of k.bolumler) BOLUM_KATEGORISI.set(b, k.kod);

  function sinifAyarla(oge, sinif, var_) {
    if (!oge || !oge.classList) return;
    if (var_) oge.classList.add(sinif);
    else oge.classList.remove(sinif);
  }

  /**
   * @param {object} secenek
   * @param {Document} secenek.belge
   * @param {(anahtar: string) => string} [secenek.t] çevirmen ("Ayrıntı" düğmesi); verilmezse düğme metni sayfa çevrilince yazılır
   */
  function olustur({ belge, t }) {
    const $ = (kimlik) => (typeof belge.getElementById === 'function' ? belge.getElementById(kimlik) : null);
    let secili = KATEGORILER[0].kod;
    let aramaAktif = false;
    const kisaltilanlar = new WeakSet(); // düğmesi eklenmiş yardım metinleri (açık olsalar da)

    /** Öğeyi içeren kategori (üst öğelere bakarak); bulunamazsa null. */
    function kategoriBul(oge) {
      for (let o = oge, adim = 0; o && adim < 60; o = o.parentNode, adim += 1) {
        if (typeof o.id === 'string' && BOLUM_KATEGORISI.has(o.id)) return BOLUM_KATEGORISI.get(o.id);
      }
      return null;
    }

    /** Kategori başlığı (sağ bölmenin üstü): menüdeki bağlantının metni ve çeviri anahtarıyla aynıdır (dil değişince birlikte çevrilir). */
    function basligiYaz(kategori) {
      const baslik = $('kategoriBaslik');
      if (!baslik) return;
      baslik.hidden = aramaAktif;
      const bag = $(kategori.baglanti);
      const etiket = bag && typeof bag.querySelector === 'function' ? bag.querySelector('[data-i18n]') : null;
      if (!etiket) return;
      const anahtar = etiket.getAttribute('data-i18n');
      if (anahtar) baslik.setAttribute('data-i18n', anahtar);
      baslik.textContent = etiket.textContent;
    }

    function uygula() {
      for (const k of KATEGORILER) {
        const gorunur = aramaAktif || k.kod === secili;
        for (const kimlik of k.bolumler) sinifAyarla($(kimlik), GIZLI_SINIF, !gorunur);
        const bag = $(k.baglanti);
        if (bag && typeof bag.setAttribute === 'function') {
          if (!aramaAktif && k.kod === secili) bag.setAttribute('aria-current', 'page');
          else bag.removeAttribute('aria-current');
        }
      }
      const kategori = KATEGORILER.find((k) => k.kod === secili);
      basligiYaz(kategori);
      if (belge.body && belge.body.dataset) belge.body.dataset.kategori = secili;
    }

    /** Uzun yardım metinlerini iki satıra kısaltır ve "Ayrıntı" düğmesi ekler (bir kez; dil değişince metin yeniden ölçülmez). */
    function ipuclariniKisalt() {
      if (typeof belge.querySelectorAll !== 'function' || typeof belge.createElement !== 'function') return;
      let ipuclari;
      try {
        ipuclari = Array.from(belge.querySelectorAll('.form-grubu > .ipucu'));
      } catch {
        return; // seçici desteklenmiyor
      }
      let sira = 0;
      for (const ipucu of ipuclari) {
        if (!ipucu.classList || kisaltilanlar.has(ipucu) || String(ipucu.textContent || '').trim().length <= IPUCU_SINIRI) continue;
        sira += 1;
        kisaltilanlar.add(ipucu);
        if (!ipucu.id) ipucu.id = 'ipucuUzun' + sira;
        ipucu.classList.add('ipucu-kisa');
        const dugme = belge.createElement('button');
        dugme.type = 'button';
        dugme.className = 'ipucu-ac';
        dugme.setAttribute('aria-expanded', 'false');
        dugme.setAttribute('aria-controls', ipucu.id);
        dugme.setAttribute('data-i18n', 'ayar.ipucu.ayrinti');
        dugme.textContent = t ? t('ayar.ipucu.ayrinti') : ''; // metin dil değişince sayfayiCevir ile de yenilenir (data-i18n)
        dugme.addEventListener('click', function () {
          const acik = ipucu.classList.toggle('ipucu-kisa') === false;
          dugme.setAttribute('aria-expanded', String(acik));
        });
        if (typeof ipucu.after === 'function') ipucu.after(dugme);
      }
    }

    return {
      /** Kategoriyi seçer (bilinmeyen kod yok sayılır). @returns {boolean} seçildi */
      sec(kod) {
        if (!KATEGORILER.some((k) => k.kod === kod)) return false;
        secili = kod;
        uygula();
        return true;
      },
      /** Öğe gizli bir kategorideyse o kategoriye geçer (kaydırmadan ve odaklamadan önce çağrılır). */
      ogeyiGoster(oge) {
        const kod = kategoriBul(oge);
        if (kod && kod !== secili) {
          secili = kod;
          uygula();
        }
      },
      /** Arama sürerken bütün kategoriler görünür; bitince seçili kategoriye dönülür. */
      aramaAyarla(aktif) {
        if (aramaAktif === !!aktif) return;
        aramaAktif = !!aktif;
        uygula();
      },
      ipuclariniKisalt,
      secili: () => secili,
      kur() {
        uygula();
        ipuclariniKisalt();
      },
    };
  }

  return { KATEGORILER, BOLUM_KATEGORISI, GIZLI_SINIF, IPUCU_SINIRI, olustur };
});
