'use strict';

/**
 * Genel kısayol doğrulama ve normalleştirme (saf; Electron'a bağlı değildir).
 * Saklanan biçim: "Control+Alt+H" — değiştiriciler + tek tuş, Electron Accelerator sözdizimi.
 * Girişte "Ctrl + Alt + k", "win+h", "ctrl alt k" gibi yazımlar da kabul edilir ve bu biçime çevrilir (h-24).
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/kisayol.js">, Ayarlar sayfası) çalışır: `require`
 * kullanmaz. Karar yine ana süreçtedir (ayar-kaydet.js bu işlevlerle doğrular); renderer yalnız anında geri bildirim verir.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvKisayol = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VARSAYILAN_KISAYOL = 'Control+Alt+H';
  const VARSAYILAN_PALET_KISAYOLU = 'Control+Alt+P';
  const EN_COK_FAVORI_KISAYOLU = 5; // eylem kısayolu olan favori sayısı (hiz-05)
  const EN_COK_PANO = 6; // pano kısayolları (pencere-02)
  const KISAYOL_DEGISTIRICILERI = ['Control', 'Alt', 'Shift', 'Super']; // normal sıra
  const KISAYOL_TUSU_DESENI =
    /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/;

  // Yazımda kabul edilen değiştirici adları (küçük harfe çevrilmiş) -> normal ad.
  const DEGISTIRICI_TAKMA_ADLARI = Object.freeze({
    control: 'Control',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
    super: 'Super',
    win: 'Super',
    windows: 'Super',
  });
  // Yazımda kabul edilen adlı tuşlar (küçük harfe çevrilmiş) -> normal ad.
  const ADLI_TUS_TAKMA_ADLARI = Object.freeze({
    space: 'Space',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pgup: 'PageUp',
    pagedown: 'PageDown',
    pgdn: 'PageDown',
    insert: 'Insert',
    ins: 'Insert',
    delete: 'Delete',
    del: 'Delete',
  });

  // Windows'a ve neredeyse her uygulamaya ayrılmış birleşimler (normalleştirilmiş biçim -> ne işe yaradığı). Genel kısayol olarak
  // alınırsa bütün uygulamalarda kopyala/yapıştır ya da pencere kapatma bozulur (h-25); kayıt reddedilir.
  const AYRILMIS_KISAYOLLAR = Object.freeze({
    'Control+C': 'kopyalama',
    'Control+V': 'yapıştırma',
    'Control+X': 'kesme',
    'Control+A': 'tümünü seçme',
    'Control+Z': 'geri alma',
    'Control+Y': 'yinele',
    'Control+W': 'pencere ya da sekmeyi kapatma',
    'Control+F4': 'pencere ya da sekmeyi kapatma',
    'Control+Space': 'yazı giriş yöntemi',
    'Alt+Space': 'pencere menüsü',
    'Alt+F4': 'pencereyi kapatma',
    'Control+Alt+Delete': 'Windows güvenlik ekranı',
  });
  const KISAYOL_KARA_LISTESI = Object.keys(AYRILMIS_KISAYOLLAR);

  // Türkçe Q klavyede AltGr (= Control+Alt) ile karakter üreten harf/rakam tuşları: bu birleşimler karakter yazmayı bozar (h-25).
  const ALTGR_TUSLARI = Object.freeze({ Q: '@', E: '€', T: '₺', 7: '{', 8: '[', 9: ']', 0: '}' });
  const ALTGR_TUS_LISTESI = ['Q', 'E', 'T', '7', '8', '9', '0'].map((t) => `${t} (${ALTGR_TUSLARI[t]})`).join(', ');

  // Türkçe varsayılan iletiler (bu dosya `require` kullanmaz: renderer'da da çalışır). Çeviri için işlevlere çevirmen `t` verilir
  // (src/lib/dil.js; anahtarlar src/lib/ceviri/ana.js 'kisayol.*'); t verilmezse bu Türkçe metinler kullanılır. test/dil.test.js ikisinin
  // aynı olduğunu denetler.
  const NEDEN_MESAJLARI = {
    bos: 'Kısayol boş.',
    bicim: 'Kısayol biçimi geçersiz. Örnek: Ctrl+Alt+H',
    'degistirici-yok':
      'Kısayolda en az bir Ctrl, Alt veya Windows (Win) tuşu olmalı; yalnız Shift veya tek bir F tuşu kabul edilmez.',
  };
  const NEDEN_ANAHTARLARI = { bos: 'kisayol.bos', bicim: 'kisayol.bicim', 'degistirici-yok': 'kisayol.degistiriciYok' };

  /** t verilmişse sözlükten, değilse Türkçe varsayılandan ileti üretir ({ad} yer tutucuları doldurulur). */
  function ileti(t, anahtar, varsayilan, degiskenler) {
    if (typeof t === 'function') return t(anahtar, degiskenler);
    if (!degiskenler) return varsayilan;
    return varsayilan.replace(/\{(\w+)\}/g, (eslesme, ad) => (Object.hasOwn(degiskenler, ad) ? String(degiskenler[ad]) : eslesme));
  }

  /**
   * Yazımı değiştiriciler ve tuş olarak çözer; ad takma adları ve büyük/küçük harf farkı giderilir. Geçersizse null.
   * Ayırıcı: artı (+) ve çevresindeki boşluklar ya da yalnız boşluk. Sıra korunur.
   */
  function kisayolAyristir(kisayol) {
    if (typeof kisayol !== 'string') return null;
    const duz = kisayol.trim();
    if (duz.length === 0 || duz.length > 60) return null;
    const parcalar = duz.split(/\s*\+\s*|\s+/);
    if (parcalar.some((p) => p === '')) return null;
    const tusHam = parcalar.pop();
    const lower = tusHam.toLowerCase();
    let tus = null;
    if (/^[a-z0-9]$/.test(lower)) tus = lower.toUpperCase();
    else if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(lower)) tus = lower.toUpperCase();
    else if (Object.hasOwn(ADLI_TUS_TAKMA_ADLARI, lower)) tus = ADLI_TUS_TAKMA_ADLARI[lower];
    if (tus === null || !KISAYOL_TUSU_DESENI.test(tus)) return null;
    const degistiriciler = [];
    for (const parca of parcalar) {
      const kucuk = parca.toLowerCase();
      // Object.hasOwn: 'constructor' / '__proto__' gibi prototip anahtarları sahte değiştirici sayılıp çıplak tuşa (ör. 'H') normalleşmesin
      const ad = Object.hasOwn(DEGISTIRICI_TAKMA_ADLARI, kucuk) ? DEGISTIRICI_TAKMA_ADLARI[kucuk] : undefined;
      if (!ad || degistiriciler.includes(ad)) return null; // bilinmeyen ad ya da yinelenen değiştirici
      degistiriciler.push(ad);
    }
    return { degistiriciler, tus };
  }

  /** Değiştirici sırası Control, Alt, Shift, Super olacak biçimde yazar; geçersizse null. */
  function kisayolNormallestir(kisayol) {
    const cozum = kisayolAyristir(kisayol);
    if (!cozum) return null;
    const sirali = KISAYOL_DEGISTIRICILERI.filter((d) => cozum.degistiriciler.includes(d));
    return [...sirali, cozum.tus].join('+');
  }

  /** "Control+Alt+H" -> "Ctrl+Alt+H" (arayüzde gösterilen biçim). */
  function kisayolGoster(kisayol) {
    return String(kisayol || '')
      .replace(/Control/g, 'Ctrl')
      .replace(/Super/g, 'Win');
  }

  /** { gecerli, neden, mesaj } — neden: 'bos' | 'bicim' | 'degistirici-yok' | 'kara-liste'. t: çevirmen (isteğe bağlı; yoksa Türkçe ileti). */
  function kisayolDogrula(kisayol, t) {
    const red = (neden) => ({ gecerli: false, neden, mesaj: ileti(t, NEDEN_ANAHTARLARI[neden], NEDEN_MESAJLARI[neden]) });
    if (typeof kisayol !== 'string' || kisayol.trim() === '') return red('bos');
    const cozum = kisayolAyristir(kisayol);
    if (!cozum) return red('bicim');
    // Shift tek başına yetmez: Shift+harf büyük harf yazmayı, tek F tuşu (F5 gibi) her uygulamada o tuşu bozar.
    if (!cozum.degistiriciler.some((d) => d !== 'Shift')) return red('degistirici-yok');
    const normal = kisayolNormallestir(kisayol);
    if (Object.hasOwn(AYRILMIS_KISAYOLLAR, normal)) {
      const ne = typeof t === 'function' ? t(`kisayol.ayrilmis.${normal}`) : AYRILMIS_KISAYOLLAR[normal];
      return {
        gecerli: false,
        neden: 'kara-liste',
        mesaj: ileti(t, 'kisayol.karaListe', '{kisayol} Windows’a ayrılmış ({ne}); başka bir birleşim seç.', { kisayol: kisayolGoster(normal), ne }),
      };
    }
    return { gecerli: true, neden: null, mesaj: '' };
  }

  function kisayolGecerliMi(kisayol) {
    return kisayolDogrula(kisayol).gecerli;
  }

  /** Engellemeyen uyarılar (kayıt yine yapılır). Geçersiz kısayol için boş dizi. t: çevirmen (isteğe bağlı; yoksa Türkçe). */
  function kisayolUyarilari(kisayol, t) {
    const cozum = kisayolAyristir(kisayol);
    if (!cozum || !kisayolGecerliMi(kisayol)) return [];
    const { degistiriciler: d, tus } = cozum;
    const uyarilar = [];
    const harfRakam = /^[A-Z0-9]$/.test(tus);
    if (d.includes('Control') && d.includes('Alt') && harfRakam) {
      // Windows'ta AltGr = Control+Alt; Türkçe Q düzeninde bazı harf/rakamlarla karakter üretir.
      if (Object.hasOwn(ALTGR_TUSLARI, tus)) {
        uyarilar.push(
          ileti(t, 'kisayol.altgrCakisma', '{kisayol} Türkçe Q klavyede AltGr+{tus} ({karakter}) ile çakışıyor: bu karakter yazılamayabilir. Çakışan tuşlar: {liste}.', {
            kisayol: kisayolGoster(kisayolNormallestir(kisayol)),
            tus,
            karakter: ALTGR_TUSLARI[tus],
            liste: ALTGR_TUS_LISTESI,
          }),
        );
      } else {
        uyarilar.push(
          ileti(t, 'kisayol.altgrGenel', 'Ctrl+Alt+harf/rakam, AltGr ile karakter yazmayı etkileyebilir. Türkçe Q klavyede çakışan tuşlar: {liste}.', { liste: ALTGR_TUS_LISTESI }),
        );
      }
    }
    if (d.includes('Super')) {
      uyarilar.push(ileti(t, 'kisayol.windowsTusu', 'Windows tuşlu birleşimlerin bir kısmı Windows’a ayrılmıştır; kayıt başarısız olabilir.'));
    }
    if (d.length === 1 && (d[0] === 'Control' || d[0] === 'Alt') && harfRakam) {
      uyarilar.push(ileti(t, 'kisayol.tekDegistirici', 'Tek değiştirici + harf/rakam, diğer uygulamaların kendi kısayollarını bozabilir.'));
    }
    return uyarilar;
  }

  // KeyboardEvent.code -> kısayol tuşu (harf ve rakamlar ayrıca ele alınır).
  const KOD_TUSLARI = Object.freeze({
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
  });

  /**
   * Bir tuş basışını (KeyboardEvent alanları) kısayola çevirir: tuşa basarak kısayol yakalama kutusu için (k-01).
   * Fiziksel tuş (`code`) esas alınır, böylece Shift/AltGr karakteri ya da klavye düzeni sonucu bozmaz.
   * @param {{code?: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} olay
   * @returns {string|null} normalleştirilmiş kısayol; değiştirici tek başına/desteklenmeyen tuş için null
   */
  function tusOlayindanKisayol(olay) {
    const kod = String(olay?.code ?? '');
    let tus = null;
    let e;
    if ((e = /^Key([A-Z])$/.exec(kod))) tus = e[1];
    else if ((e = /^Digit([0-9])$/.exec(kod))) tus = e[1];
    else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(kod)) tus = kod;
    else if (Object.hasOwn(KOD_TUSLARI, kod)) tus = KOD_TUSLARI[kod];
    if (tus === null) return null;
    const degistiriciler = [];
    if (olay.ctrlKey) degistiriciler.push('Control');
    if (olay.altKey) degistiriciler.push('Alt');
    if (olay.shiftKey) degistiriciler.push('Shift');
    if (olay.metaKey) degistiriciler.push('Super');
    return [...degistiriciler, tus].join('+');
  }

  /**
   * Tüm genel kısayolların tek planı (ana pencere, palet, favori eylemleri, panolar): geçerlilik, çakışma ve sınırlar
   * satır satır raporlanır (hata-12). Çakışmada ÖNCE gelen kazanır (sıra: ana, palet, favoriler, panolar); sonrakine
   * `cakisma` yazılır ve o kısayol kaydedilmez. Eylem kısayolu yalnız ZARARSIZ sınıfa atanabilir (yıkıcı/yasak atanamaz).
   * @param {{ana?:string, palet?:string, favoriler?:{entity_id:string, kisayol?:string}[], panolar?:{kisayol?:string}[],
   *          siniflandir?:(kimlik:string, favori:object)=>string, t?:Function, geriAl?:string}} girdi t: çevirmen (isteğe bağlı; yoksa Türkçe iletiler)
   *   geriAl (1.4.0, o-12): "son eylemi geri al" genel kısayolu; çakışmada EN SONA kalır (mevcut kısayollar kazanır)
   * @returns {{ id:string, tur:'ana'|'palet'|'geri-al'|'favori'|'pano', kisayol:string, kimlik?:string, sira?:number,
   *             gecerli:boolean, neden:null|'gecersiz'|'cakisma'|'sinif'|'sinir', mesaj:string }[]}
   *   Yalnız kısayolu OLAN öğeler döner. Kayıt edilecekler: gecerli === true.
   */
  function kisayolPlani({ ana, palet, favoriler = [], panolar = [], siniflandir = () => 'zararsiz', t, geriAl }) {
    const ogeler = [];
    const gorulen = new Set();
    let favoriSayisi = 0;
    let panoSayisi = 0;

    function ekle(id, tur, ham, ekstra, sinirNedeni) {
      if (typeof ham !== 'string' || ham.trim() === '') return;
      const dogrulama = kisayolDogrula(ham.trim(), t);
      const normal = kisayolNormallestir(ham.trim());
      const oge = { id, tur, kisayol: normal ?? ham.trim(), ...ekstra, gecerli: true, neden: null, mesaj: '' };
      const reddet = (neden, mesaj) => {
        oge.gecerli = false;
        oge.neden = neden;
        oge.mesaj = mesaj;
      };
      if (!dogrulama.gecerli) reddet('gecersiz', dogrulama.mesaj);
      else if (ekstra?.siniflama && ekstra.siniflama !== 'zararsiz') reddet('sinif', ileti(t, 'kisayol.sinif', 'Onay isteyen ya da güvenlik kuralına takılan eylem kısayola atanamaz.'));
      else if (sinirNedeni) reddet('sinir', sinirNedeni);
      else if (gorulen.has(normal)) reddet('cakisma', ileti(t, 'kisayol.cakisma', '{kisayol} başka bir kısayolla çakışıyor.', { kisayol: kisayolGoster(normal) }));
      if (oge.gecerli) gorulen.add(normal);
      delete oge.siniflama;
      ogeler.push(oge);
    }

    ekle('ana', 'ana', ana, {});
    ekle('palet', 'palet', palet, {});
    (Array.isArray(favoriler) ? favoriler : []).forEach((f, sira) => {
      if (typeof f?.kisayol !== 'string' || f.kisayol.trim() === '') return;
      favoriSayisi += 1;
      ekle(`favori:${f.entity_id}`, 'favori', f.kisayol, { kimlik: f.entity_id, sira, siniflama: siniflandir(f.entity_id, f) },
        favoriSayisi > EN_COK_FAVORI_KISAYOLU ? ileti(t, 'kisayol.favoriSiniri', 'En çok {n} favoriye kısayol atanabilir.', { n: EN_COK_FAVORI_KISAYOLU }) : null);
    });
    (Array.isArray(panolar) ? panolar : []).forEach((p, sira) => {
      if (typeof p?.kisayol !== 'string' || p.kisayol.trim() === '') return;
      panoSayisi += 1;
      ekle(`pano:${sira}`, 'pano', p.kisayol, { sira }, panoSayisi > EN_COK_PANO ? ileti(t, 'kisayol.panoSiniri', 'En çok {n} HA panosu tanımlanabilir.', { n: EN_COK_PANO }) : null);
    });
    ekle('geri-al', 'geri-al', geriAl, {}); // 1.4.0 (o-12): en sonda; varsayılan kısayol, kullanıcının önceden atadığı bir kısayolu ASLA ezmez
    return ogeler;
  }

  return {
    VARSAYILAN_KISAYOL,
    VARSAYILAN_PALET_KISAYOLU,
    EN_COK_FAVORI_KISAYOLU,
    EN_COK_PANO,
    kisayolPlani,
    KISAYOL_DEGISTIRICILERI,
    KISAYOL_TUSU_DESENI,
    KISAYOL_KARA_LISTESI,
    AYRILMIS_KISAYOLLAR,
    ALTGR_TUSLARI,
    kisayolAyristir,
    kisayolNormallestir,
    kisayolDogrula,
    kisayolGecerliMi,
    kisayolUyarilari,
    kisayolGoster,
    tusOlayindanKisayol,
  };
});
