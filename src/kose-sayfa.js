/*
 * Köşe bildirimi sayfasının betiği (renderer). Ana süreç `kose:goster` ile { tur, metin, sureMs } gönderir;
 * metin YALNIZ textContent ile yazılır (HTML olarak yorumlanan atama yok). Köprü: preload-kose.js (window.evKose).
 * (Ana süreç tarafı: kose-bildirim.js.)
 *
 * Arayüz dili: bildirim metni ana süreçte zaten seçili dilde yazılır; sayfa yalnız kendi sabit metnini (sayfa başlığı, <html lang>)
 * `dil:degisti` iletisiyle çevirir (lib/dil.js + lib/ceviri/yuzey.js). Çeviri betikleri yüklenemese bile bildirim yine görünür.
 */
(function () {
  'use strict';

  const kutu = document.getElementById('bildirim');
  const isaret = document.getElementById('isaret');
  const metin = document.getElementById('metin');
  const altSatir = document.getElementById('alt');
  const sure = document.getElementById('sure');
  const Dil = window.EvDil;
  // 1.6.0: eylem sonucunda cihazın kendi simgesi (24'lük ızgara, çizgi). Tablo panelin simgeleriyle aynıdır (lib/karo-gorunum.js ve
  // yuzey-sayfa.js EK_IKONLAR); bilinmeyen alan simgesiz kalır (✓ / !). Kilit, kapı, alarm gibi alanlar eylem sonucuna hiç ulaşmaz.
  const AMPUL = 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z';
  const PRIZ = 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5';
  const GUC = 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0';
  const TERMOMETRE = 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v6';
  const DAMLA = 'M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z';
  const ALAN_SIMGELERI = {
    light: AMPUL,
    switch: PRIZ,
    input_boolean: PRIZ,
    fan: 'M12 12v-8a3 3 0 0 1 3 3M12 12h8a3 3 0 0 1-3 3M12 12v8a3 3 0 0 1-3-3M12 12h-8a3 3 0 0 1 3-3',
    scene: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    script: 'M4 8h16v12H4zM4 8l2-4h4l-2 4M10 8l2-4h4l-2 4M16 8l2-4h2v4',
    automation: 'M13 3L5 13h6l-1 8 8-10h-6z',
    media_player: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
    climate: TERMOMETRE,
    water_heater: TERMOMETRE,
    cover: 'M4 4h16M5 4v12M19 4v12M5 8h14M5 12h14M5 16h14M12 16v4',
    humidifier: DAMLA,
    valve: DAMLA,
    vacuum: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    button: GUC,
    input_button: GUC,
  };
  const Sozluk = window.EvCeviriYuzey;

  /** Ana süreç etkin dili bildirdi ('dil:degisti'): sayfa başlığı ve <html lang> çevrilir. Geçersiz dil yok sayılır. */
  function dilUygula(yuk) {
    if (!Dil || !Sozluk || !yuk || typeof yuk !== 'object' || Dil.DILLER.indexOf(yuk.dil) < 0) return;
    Dil.sayfayiCevir(document, Dil.cevirmen(yuk.dil, Sozluk));
  }

  // Windows 11 malzemesi (gorunum-11): 'acrylic' | 'mica' ise CSS yarı saydam yüzey uygular; 'yok'ta öznitelik kalkar (opak).
  function malzemeAyarla(deger) {
    const kok = document.documentElement;
    if (!kok || !kok.dataset) return;
    if (deger === 'acrylic' || deger === 'mica') kok.dataset.malzeme = deger;
    else delete kok.dataset.malzeme;
  }

  // Görünüm ayarları (1.4.0 grup "tema"): özel/hazır palet, yüksek karşıtlık, hareketi azalt, geçiş animasyonu. Model ana süreçten gelir; yoksa
  // (varsayılan görünüm) önceki özel görünüm temizlenir. lib/tema-renk.js yüklenemezse bildirim yine varsayılan görünümle çıkar.
  function gorunumAyarla(model) {
    const Tema = window.EvTemaRenk;
    if (!Tema || typeof Tema.gorunumUygula !== 'function') return;
    const azalt = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    Tema.gorunumUygula(document.documentElement, model, { hareketAzalt: azalt });
  }

  /** Çizgi simge (svg, yalnız createElementNS; HTML ataması yok). Belge svg oluşturamıyorsa null. */
  function cizgiSimge(yol) {
    if (typeof document.createElementNS !== 'function') return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const cizgi = document.createElementNS(ns, 'path');
    cizgi.setAttribute('d', yol);
    svg.appendChild(cizgi);
    return svg;
  }

  /** 1.6.0 eylem özeti: { baslik, alt, alan, acik }; ikisi de doluysa iki satırlı görünüm. Geçersizse null. */
  function ozetAl(yuk) {
    const o = yuk.ozet;
    if (!o || typeof o !== 'object' || yuk.tur === 'bilgi') return null;
    const baslik = String(o.baslik ?? '').slice(0, 60);
    const alt = String(o.alt ?? '').slice(0, 100);
    if (baslik === '' || alt === '') return null;
    return { baslik, alt, yol: Object.hasOwn(ALAN_SIMGELERI, o.alan) ? ALAN_SIMGELERI[o.alan] : null, acik: o.acik === true };
  }

  function goster(yuk) {
    if (!yuk || typeof yuk !== 'object') return;
    malzemeAyarla(yuk.malzeme);
    gorunumAyarla(yuk.gorunum);
    const hata = yuk.tur === 'hata';
    const bilgi = yuk.tur === 'bilgi';
    const sureMs = Number.isFinite(yuk.sureMs) ? Math.min(Math.max(yuk.sureMs, 500), 10000) : 1500;
    const ozet = ozetAl(yuk);
    // 1.6.0: eylem sonucu iki satırdır (cihaz adı + ne oldu); diğer bildirimler (bilgi, genel ileti) tek satır metin
    metin.textContent = ozet ? ozet.baslik : String(yuk.metin ?? '').slice(0, 200);
    if (altSatir) {
      altSatir.textContent = ozet ? ozet.alt : '';
      altSatir.hidden = !ozet;
    }
    // Renge ek simge (g-09): başarı ✓, hata !. Simge süstür (aria-hidden, html'de); duyurulan şey metindir.
    // Bilgi (bildirim merkezi / uyarı kuralı): ana sürecin verdiği kısa simge (düz metin), yoksa "i".
    // 1.6.0: cihazın simgesi biliniyorsa dairede o çizilir; ✓ / ! köşedeki küçük rozete geçer.
    const simge = ozet && ozet.yol ? cizgiSimge(ozet.yol) : null;
    if (simge) {
      const rozet = document.createElement('span');
      rozet.className = 'rozet';
      rozet.textContent = hata ? '!' : '✓';
      isaret.replaceChildren(simge, rozet);
    } else {
      isaret.textContent = hata ? '!' : bilgi ? String(yuk.simge || 'i').slice(0, 8) : '✓';
    }
    // Ekran okuyucu (k-16): hata hemen duyurulur (alert), başarı ve bilgi sırasını bekler (status).
    kutu.setAttribute('role', hata ? 'alert' : 'status');
    kutu.setAttribute('aria-live', hata ? 'assertive' : 'polite');
    kutu.classList.toggle('hata', hata);
    kutu.classList.toggle('bilgi', bilgi);
    kutu.classList.toggle('ikili', !!ozet);
    kutu.classList.toggle('simgeli', !!simge);
    kutu.classList.toggle('acik', !!ozet && ozet.acik && !hata);
    // Kalan süre çizgisi bu bildirimin süresince erir; art arda gelen bildirimde giriş hareketi baştan oynar (sınıf kaldırılıp yeniden eklenir).
    // 1.6.1: sayfa süre sonunda içeriği SOLDURMAZ: pencereyi ana süreç zeminiyle birlikte soldurup gizler (kose-bildirim.js). Sayfa
    // soldursaydı akrilik zemin bir an boş kutu olarak kalırdı.
    if (sure && sure.style && typeof sure.style.setProperty === 'function') sure.style.setProperty('--sure', sureMs + 'ms');
    kutu.classList.remove('gorunur');
    void kutu.offsetWidth;
    kutu.classList.add('gorunur');
  }

  if (window.evKose && typeof window.evKose.onGoster === 'function') {
    window.evKose.onGoster(goster);
  }
  if (window.evKose && typeof window.evKose.onDilDegisti === 'function') {
    window.evKose.onDilDegisti(dilUygula);
  }
})();
