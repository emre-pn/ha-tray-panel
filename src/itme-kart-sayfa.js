/*
 * Düğmeli itme bildirimi kartının betiği (renderer, o-61). Ana süreç `itme:goster` ile { kartNo, baslik, mesaj, dugmeler: [başlık...], sureMs }
 * gönderir; metinler YALNIZ textContent ile yazılır (HTML olarak yorumlanan atama yok). Düğme basınca ana sürece kartın numarası ve düğme
 * SIRASI gider; eylem kimliği bu sayfada yoktur. Köprü: preload-itme.js (window.evItme). (Ana süreç tarafı: itme-kart.js.)
 *
 * Arayüz dili: bildirim metni HA'dan gelir (olduğu gibi); sayfa yalnız kendi sabit metinlerini (başlık, × düğmesi) `dil:degisti` iletisiyle
 * çevirir (lib/dil.js + lib/ceviri/yuzey.js). Çeviri betikleri yüklenemese bile kart görünür.
 */
(function () {
  'use strict';

  const kart = document.getElementById('kart');
  const baslik = document.getElementById('kartBaslik');
  const mesaj = document.getElementById('kartMesaj');
  const dugmeler = document.getElementById('kartDugmeler');
  const btnKapat = document.getElementById('btnKartKapat');
  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  const EN_COK_DUGME = 3;
  let kartNo = null;
  let solma = null;

  function dilUygula(yuk) {
    if (!Dil || !Sozluk || !yuk || typeof yuk !== 'object' || Dil.DILLER.indexOf(yuk.dil) < 0) return;
    Dil.sayfayiCevir(document, Dil.cevirmen(yuk.dil, Sozluk));
  }

  function malzemeAyarla(deger) {
    const kok = document.documentElement;
    if (!kok || !kok.dataset) return;
    if (deger === 'acrylic' || deger === 'mica') kok.dataset.malzeme = deger;
    else delete kok.dataset.malzeme;
  }

  function gorunumAyarla(model) {
    const Tema = window.EvTemaRenk;
    if (!Tema || typeof Tema.gorunumUygula !== 'function') return;
    const azalt = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    Tema.gorunumUygula(document.documentElement, model, { hareketAzalt: azalt });
  }

  function dugmeleriKapat() {
    Array.prototype.forEach.call(dugmeler.children, function (d) {
      d.disabled = true;
    });
  }

  function dugmeKur(metin, sira, no) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'dugme';
    d.textContent = String(metin).slice(0, 40);
    d.addEventListener('click', function () {
      dugmeleriKapat();
      if (window.evItme && typeof window.evItme.eylem === 'function') window.evItme.eylem(no, sira);
    });
    return d;
  }

  function goster(yuk) {
    if (!yuk || typeof yuk !== 'object' || !Number.isInteger(yuk.kartNo)) return;
    malzemeAyarla(yuk.malzeme);
    gorunumAyarla(yuk.gorunum);
    kartNo = yuk.kartNo;
    baslik.textContent = String(yuk.baslik == null ? '' : yuk.baslik).slice(0, 80);
    mesaj.textContent = String(yuk.mesaj == null ? '' : yuk.mesaj).slice(0, 300);
    while (dugmeler.firstChild) dugmeler.removeChild(dugmeler.firstChild);
    const liste = Array.isArray(yuk.dugmeler) ? yuk.dugmeler.slice(0, EN_COK_DUGME) : [];
    liste.forEach(function (metin, sira) {
      dugmeler.appendChild(dugmeKur(metin, sira, kartNo));
    });
    kart.classList.add('gorunur');
    clearTimeout(solma);
    const sureMs = Number.isFinite(yuk.sureMs) ? Math.min(Math.max(yuk.sureMs, 1000), 120000) : 45000;
    solma = setTimeout(function () {
      kart.classList.remove('gorunur');
    }, sureMs);
  }

  btnKapat.addEventListener('click', function () {
    if (kartNo !== null && window.evItme && typeof window.evItme.kapat === 'function') window.evItme.kapat(kartNo);
  });
  document.addEventListener('keydown', function (olay) {
    if (olay.key === 'Escape' && kartNo !== null && window.evItme && typeof window.evItme.kapat === 'function') window.evItme.kapat(kartNo);
  });

  if (window.evItme && typeof window.evItme.onGoster === 'function') {
    window.evItme.onGoster(goster);
  }
  if (window.evItme && typeof window.evItme.onDilDegisti === 'function') {
    window.evItme.onDilDegisti(dilUygula);
  }
})();
