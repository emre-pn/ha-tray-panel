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
  const Dil = window.EvDil;
  const Sozluk = window.EvCeviriYuzey;
  let solma = null;

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

  function goster(yuk) {
    if (!yuk || typeof yuk !== 'object') return;
    malzemeAyarla(yuk.malzeme);
    gorunumAyarla(yuk.gorunum);
    const hata = yuk.tur === 'hata';
    const bilgi = yuk.tur === 'bilgi';
    const sureMs = Number.isFinite(yuk.sureMs) ? Math.min(Math.max(yuk.sureMs, 500), 10000) : 1500;
    metin.textContent = String(yuk.metin ?? '').slice(0, 200);
    // Renge ek simge (g-09): başarı ✓, hata !. Simge süstür (aria-hidden, html'de); duyurulan şey metindir.
    // Bilgi (bildirim merkezi / uyarı kuralı): ana sürecin verdiği kısa simge (düz metin), yoksa "i".
    isaret.textContent = hata ? '!' : bilgi ? String(yuk.simge || 'i').slice(0, 8) : '✓';
    // Ekran okuyucu (k-16): hata hemen duyurulur (alert), başarı ve bilgi sırasını bekler (status).
    kutu.setAttribute('role', hata ? 'alert' : 'status');
    kutu.setAttribute('aria-live', hata ? 'assertive' : 'polite');
    kutu.classList.toggle('hata', hata);
    kutu.classList.toggle('bilgi', bilgi);
    kutu.classList.add('gorunur');
    clearTimeout(solma);
    solma = setTimeout(function () {
      kutu.classList.remove('gorunur');
    }, sureMs);
  }

  if (window.evKose && typeof window.evKose.onGoster === 'function') {
    window.evKose.onGoster(goster);
  }
  if (window.evKose && typeof window.evKose.onDilDegisti === 'function') {
    window.evKose.onDilDegisti(dilUygula);
  }
})();
