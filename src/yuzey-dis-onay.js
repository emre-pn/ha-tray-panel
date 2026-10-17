/*
 * Hızlı panelde evpaneli:// bağlantı izni (1.4.0 dis grubu, o-54). Köprü: preload-yuzey.js (window.evYuzey: disOnayAl,
 * disOnayYanitla, onDisOnay). Bir bağlantı daha önce izin verilmemiş bir favoriyi çalıştırmak isteyince ana süreç
 * (src/dis-tetikler.js, src/yuzey-yoneticisi.js) paneli açar; bu betik soruyu okur ve panelin üstünde "İzin ver / Her zaman /
 * Reddet" gösterir.
 *
 *  - Karar yalnız soruyla gelen biletle gönderilir; bileti, kararı ve süreyi ana süreç yeniden denetler (renderer'ın beyanı yetmez).
 *  - "İzin ver" ve "Her zaman" soru açıldıktan kısa süre sonra (bekleMs) etkinleşir: bağlantıya çift tıklama izne dönüşmesin.
 *    Odak Reddet'tedir; Esc reddeder. Panel soru açıkken kapanırsa ana süreç reddedilmiş sayar.
 *  - Bölümün tuşları ızgara gezintisine gitmez (keydown burada durur).
 *  - Metin textContent ile yazılır; favori adı ana süreçteki favori etiketidir. Dil: lib/dil.js sayfayiCevir'in yazdığı <html lang>.
 */
(function () {
  'use strict';

  const kopru = window.evYuzey;
  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  if (!kopru || !Dil || !Sozluk || typeof kopru.disOnayAl !== 'function' || typeof kopru.disOnayYanitla !== 'function') return;

  const el = {
    kutu: document.getElementById('disOnay'),
    soru: document.getElementById('disOnaySoru'),
    islem: document.getElementById('disOnayIslem'),
    izin: document.getElementById('disOnayIzin'),
    herZaman: document.getElementById('disOnayHerZaman'),
    reddet: document.getElementById('disOnayReddet'),
  };
  if (!el.kutu || !el.soru || !el.islem || !el.izin || !el.herZaman || !el.reddet) return;

  const ISLEM_ANAHTARLARI = {
    ac: 'yuzey.disOnay.islemAc',
    kapat: 'yuzey.disOnay.islemKapat',
    degistir: 'yuzey.disOnay.islemDegistir',
    goreli: 'yuzey.disOnay.islemGoreli',
    parlaklik: 'yuzey.disOnay.islemParlaklik',
    komut: 'yuzey.disOnay.islemKomut',
    calistir: 'yuzey.disOnay.islemCalistir',
  };
  const EN_COK_BEKLEME_MS = 2000;
  const DUGMELER = [el.izin, el.herZaman, el.reddet];

  let soru = null;
  let istekNo = 0;
  let acmaZamanlayicisi = null;
  let gonderiliyor = false;

  function cevirmen() {
    const dil = document.documentElement && typeof document.documentElement.getAttribute === 'function' ? document.documentElement.getAttribute('lang') : null;
    return Dil.cevirmen(Dil.DILLER.indexOf(dil) >= 0 ? dil : 'tr', Sozluk);
  }

  /** Panel yüksekliği yuzey-sayfa.js'in 'resize' dinleyicisiyle yeniden ölçülür ve ana sürece bildirilir. */
  function boyutDegisti() {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (_hata) {
      /* ölçüm bir sonraki çizimde yapılır */
    }
  }

  function soruGecerliMi(s) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.bilet !== 'string' || s.bilet.length === 0 || s.bilet.length > 100) return false;
    if (typeof s.ad !== 'string' || s.ad.length === 0 || s.ad.length > 200) return false;
    if (!Object.prototype.hasOwnProperty.call(ISLEM_ANAHTARLARI, s.islem)) return false;
    if ((s.islem === 'goreli' || s.islem === 'parlaklik') && !Number.isInteger(s.deger)) return false;
    return true;
  }

  function islemMetni(t, s) {
    if (s.islem === 'goreli') return t(ISLEM_ANAHTARLARI.goreli, { deger: (s.deger > 0 ? '+' : '') + String(s.deger) });
    if (s.islem === 'parlaklik') return t(ISLEM_ANAHTARLARI.parlaklik, { deger: String(s.deger) });
    return t(ISLEM_ANAHTARLARI[s.islem]);
  }

  function ciz() {
    if (!soru) return;
    const t = cevirmen();
    el.soru.textContent = t('yuzey.disOnay.soru', { ad: soru.ad });
    el.islem.textContent = islemMetni(t, soru);
  }

  function izinDugmeleri(etkin) {
    el.izin.disabled = !etkin;
    el.herZaman.disabled = !etkin;
  }

  function gizle() {
    clearTimeout(acmaZamanlayicisi);
    acmaZamanlayicisi = null;
    const acikti = el.kutu.hidden !== true;
    soru = null;
    gonderiliyor = false;
    izinDugmeleri(false);
    el.kutu.hidden = true;
    el.soru.textContent = '';
    el.islem.textContent = '';
    if (acikti) boyutDegisti();
  }

  function goster(s) {
    const yeni = !soru || soru.bilet !== s.bilet;
    soru = s;
    ciz();
    if (yeni) {
      gonderiliyor = false;
      clearTimeout(acmaZamanlayicisi);
      izinDugmeleri(false);
      const bekle = Math.min(EN_COK_BEKLEME_MS, Math.max(0, Number(s.bekleMs) || 0));
      acmaZamanlayicisi = setTimeout(function () {
        acmaZamanlayicisi = null;
        if (soru === s) izinDugmeleri(true);
      }, bekle);
    }
    el.kutu.hidden = false;
    el.reddet.focus();
    boyutDegisti();
  }

  /** Güncel soruyu ana süreçten okur (gösterim, yeni soru, soru bitti). Eski istek yanıtı yenisini ezmez. */
  function yenile() {
    istekNo += 1;
    const no = istekNo;
    Promise.resolve()
      .then(function () {
        return kopru.disOnayAl();
      })
      .then(
        function (yanit) {
          if (no !== istekNo) return;
          const s = yanit && yanit.ok === true ? yanit.soru : null;
          if (soruGecerliMi(s)) goster(s);
          else gizle();
        },
        function () {
          if (no === istekNo) gizle();
        },
      );
  }

  function yanitla(karar) {
    if (!soru || gonderiliyor) return;
    if (karar !== 'reddet' && el.izin.disabled) return;
    const s = soru;
    gonderiliyor = true;
    istekNo += 1; // bekleyen okuma bu kararı ezmesin
    Promise.resolve()
      .then(function () {
        return kopru.disOnayYanitla(s.bilet, karar);
      })
      .then(
        function (yanit) {
          if (soru !== s) return;
          if (yanit && yanit.ok === true) gizle();
          else {
            gonderiliyor = false;
            yenile(); // süre dolmuş ya da soru değişmiş: güncel durum okunur
          }
        },
        function () {
          if (soru !== s) return;
          gonderiliyor = false;
          yenile();
        },
      );
  }

  /** Sol/sağ ok etkin düğmeler arasında gezer. */
  function dugmeGezin(olay) {
    const etkinler = DUGMELER.filter(function (d) {
      return d.disabled !== true;
    });
    const sira = etkinler.indexOf(document.activeElement);
    if (etkinler.length === 0) return;
    const yon = olay.key === 'ArrowRight' ? 1 : -1;
    const hedef = etkinler[(Math.max(0, sira) + yon + etkinler.length) % etkinler.length];
    if (olay.preventDefault) olay.preventDefault();
    hedef.focus();
  }

  el.izin.addEventListener('click', function () {
    yanitla('izin');
  });
  el.herZaman.addEventListener('click', function () {
    yanitla('herZaman');
  });
  el.reddet.addEventListener('click', function () {
    yanitla('reddet');
  });
  el.kutu.addEventListener('keydown', function (olay) {
    if (olay.key === 'Escape') {
      if (olay.preventDefault) olay.preventDefault();
      yanitla('reddet');
    } else if (olay.key === 'ArrowLeft' || olay.key === 'ArrowRight') {
      dugmeGezin(olay);
    }
    if (olay.stopPropagation) olay.stopPropagation(); // ok tuşları ızgaraya, Esc paneli kapatmaya gitmesin
  });

  kopru.onGoster(function (yuk) {
    if (yuk && yuk.mod === 'panel') yenile();
    else gizle();
  });
  if (typeof kopru.onDisOnay === 'function') kopru.onDisOnay(yenile);
  if (typeof kopru.onDilDegisti === 'function') kopru.onDilDegisti(ciz);
})();
