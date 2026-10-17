'use strict';

/**
 * Ayarlar'ı dışa/içe aktarma ve mevcut yedeklerden geri dönme (k-13) için ana süreç tarafı: pencere diyalogları ve dosya
 * işleri burada, kurallar ayar-yedegi.js'de. Electron'a doğrudan bağlı değildir (dialog, fs ve uygulama işlevleri dışarıdan
 * verilir), bu yüzden gerçek pencere açmadan sınanır.
 *
 * Güvenceler
 *  - Dosya yolunu HER ZAMAN ana süreç seçtirir (kullanıcı diyaloğu); renderer yol veremez. Geri dönülen yedek yalnız
 *    ayar klasöründeki beklenen adlardan (ayar-yedegi.js YEDEK_DOSYA_DESENI) biri olabilir.
 *  - Erişim anahtarı/token hiçbir yönde dosyaya girmez; içe aktarılan içerik ayar şemasından ve kapı/kilit süzgecinden geçer.
 *  - Uygulama adımı (uygula) ayarları kaydetmedeki doğrulamayla aynı yoldan yapar; adres geçersizse hiçbir şey değişmez.
 *  - Anahtar sızdırma önlemi: kayıtlı bir erişim anahtarı varken içe aktarılan/yedekten dönülen dosya ev içi ya da dış adresin ANA MAKİNESİNİ
 *    (ana bilgisayar adı) değiştiriyorsa, ayarlar uygulanmadan ÖNCE ana süreçte yerel bir onay iletişim kutusu çıkar (varsayılan: Vazgeç);
 *    onaylanmazsa hiçbir ayar uygulanmaz. Yalnız yol/kapı numarası/https-http değişimi onay istemez.
 *  - Renderer'a yalnız dosya ADI (klasörsüz) ve sayılar döner; günlüğe yalnız sabit metin yazılır.
 *  - İçe aktarma önizlemesi (1.4.0): dosyayı yine ANA SÜREÇ seçtirir ve okur; renderer'a yalnız dosya adı, kapalı listeden bölüm adları ve sayılar gider
 *    (anahtar, adres, değer YOK). Uygulama, önizlemenin verdiği tek kullanımlık numarayla ve kısa süre içinde istenir; numara tutmazsa hiçbir şey uygulanmaz.
 *    Numarasız eski çağrı (doğrudan içe aktar) aynı hattan geçer.
 */

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { ayarlariDisaAktar, ayarYedeginiCoz, yedekAdiGecerliMi, jsonDosyasiniOku, yedekleriListele } = require('./ayar-yedegi');
const { BOLUMLER, BOLUM_ADLARI } = require('./esitleme-bolumleri');
const { TR } = require('./ceviri-varsayilan');

const ADRES_ALANLARI = Object.freeze(['yerelAdres', 'disAdres']);
/** Önizlemede gösterilen bölümler: eşitleme bölümleri + bağlantı adresleri + kalanlar. KAPALI LİSTE: renderer yalnız bu adları çevirir. */
const ONIZLEME_BOLUMLERI = Object.freeze([...BOLUM_ADLARI, 'baglanti', 'diger']);
const ONIZLEME_OMRU_MS = 10 * 60 * 1000;

/** Ayar alanının önizleme bölümü. */
function bolumAdi(alan) {
  if (ADRES_ALANLARI.includes(alan)) return 'baglanti';
  return BOLUM_ADLARI.find((ad) => BOLUMLER[ad].includes(alan)) ?? 'diger';
}

/** Anahtar sırasından bağımsız karşılaştırma metni (yalnız fark denetimi için; dışarı verilmez). */
function kararliMetin(deger) {
  return JSON.stringify(deger, (_anahtar, d) => (d && typeof d === 'object' && !Array.isArray(d) ? Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]])) : d));
}

/** Adresin ana makine adı (küçük harf); ayrıştırılamazsa null. */
function anaMakine(adres) {
  if (typeof adres !== 'string' || adres.trim() === '') return null;
  try {
    return new URL(adres).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Dosyadaki adreslerden ana makinesi ŞU ANKİNDEN farklı olanlar (boş/silinen adres sayılmaz: anahtar gidecek yeni bir yer yok).
 * @returns {{alan: 'yerelAdres'|'disAdres', eski: string|null, yeni: string}[]}
 */
function anaMakineDegisenler(yeniAyarlar, mevcut) {
  const sonuc = [];
  for (const alan of ADRES_ALANLARI) {
    const yeniAdres = yeniAyarlar?.[alan];
    if (typeof yeniAdres !== 'string' || yeniAdres.trim() === '') continue;
    const yeni = anaMakine(yeniAdres);
    const eski = anaMakine(mevcut?.[alan]);
    if (yeni === null || yeni !== eski) sonuc.push({ alan, eski, yeni: yeni ?? yeniAdres });
  }
  return sonuc;
}

const iptal = () => ({ ok: false, iptal: true });
const hata = (metin) => ({ ok: false, hata: metin });

/**
 * @param {object} bag
 * @param {{showSaveDialog: Function, showOpenDialog: Function}} bag.dialog
 * @param {{writeFileSync: Function, readdirSync: Function, statSync: Function, readFileSync: Function}} [bag.fs]
 * @param {string} bag.ayarDizini ayarlar.json'ın klasörü (yedekler burada)
 * @param {string} bag.varsayilanKlasor diyalogun açılacağı klasör (Belgeler)
 * @param {() => object} bag.ayarlarAl şu anki ayarlar (yalnız okunur)
 * @param {() => object} bag.varsayilanAl varsayilan-ayarlar.json içeriği
 * @param {(cozum: object) => Promise<{ok: boolean, hata?: string, uyarilar?: string[], favoriSayisi?: number}>} bag.uygula doğrulanmış ayarları uygular
 * @param {(mesaj: string) => void} [bag.gunluk]
 * @param {() => Date} [bag.simdi]
 * @param {Function} [bag.t] çevirmen (src/lib/dil.js; ana süreçte dil değişince kendiliğinden yeni dili izler). Verilmezse Türkçe.
 * @param {() => (boolean|Promise<boolean>)} [bag.anahtarVarMi] kayıtlı erişim anahtarı var mı (yoksa ya da verilmezse adres onayı sorulmaz)
 * @param {() => (Set<string>|null)} [bag.bilinenKimlikler] Home Assistant'ta o an bilinen varlık kimlikleri (önizleme "bulunamayan favori" sayısı için; null = bilinmiyor, sayı verilmez)
 */
function ayarAktariciOlustur({ dialog, fs = require('node:fs'), ayarDizini, varsayilanKlasor, ayarlarAl, varsayilanAl, uygula, gunluk = () => {}, simdi = () => new Date(), t = TR, anahtarVarMi = () => false, bilinenKimlikler = () => null }) {
  const jsonSuzgeci = () => [{ name: t('aktar.suzgecAdi'), extensions: ['json'] }];
  const gunlugeYaz = (mesaj) => {
    try {
      gunluk(mesaj);
    } catch {
      /* günlük hatası işi durdurmaz */
    }
  };

  /**
   * Kayıtlı erişim anahtarı varken dosya adreslerin ana makinesini değiştiriyorsa yerel onay ister. Kutu açılamazsa ya da hata verirse
   * onaylanmamış sayılır (güvenli yön). Anahtar yoksa ya da ana makine değişmiyorsa sormaz.
   * @returns {Promise<boolean>} true = devam edilebilir
   */
  async function adresDegisimiOnaylandiMi(yeniAyarlar, pencere) {
    const degisenler = anaMakineDegisenler(yeniAyarlar, ayarlarAl());
    if (degisenler.length === 0) return true;
    let anahtarVar = true; // anahtarın varlığı denetlenemezse var say
    try {
      anahtarVar = !!(await anahtarVarMi());
    } catch {
      anahtarVar = true;
    }
    if (!anahtarVar) return true;
    const yok = t('aktar.adresOnay.yok');
    const satirlar = degisenler.map((d) => t(d.alan === 'yerelAdres' ? 'aktar.adresOnay.yerel' : 'aktar.adresOnay.dis', { eski: d.eski ?? yok, yeni: d.yeni }));
    const secenekler = {
      type: 'warning',
      buttons: [t('aktar.adresOnay.iceAktar'), t('diyalog.vazgec')],
      defaultId: 1, // Enter'a yanlışlıkla basmak içe aktarmasın
      cancelId: 1,
      noLink: true,
      title: t('uygulama.ad'),
      message: t('aktar.adresOnay.mesaj'),
      detail: t('aktar.adresOnay.ayrinti', { adresler: satirlar.join('\n') }),
    };
    try {
      const secim = await (pencere ? dialog.showMessageBox(pencere, secenekler) : dialog.showMessageBox(secenekler));
      return secim?.response === 0;
    } catch {
      return false;
    }
  }

  /** Önizlemeden sonra uygulanmayı bekleyen dosya: { no, ham, ad, bitis }. Tek kullanımlık; yeni önizleme ya da uygulama denemesi onu tüketir. */
  let bekleyen = null;

  /**
   * Doğrulanmış içeriğin ÖNİZLEMESİ: hangi bölümlerin şu anki ayardan farklı olduğu (kapalı liste adları) ve sayılar. Adres, anahtar ya da değer içermez.
   * @returns {{bolumler: string[], alanSayisi: number, favoriSayisi: number|null, eksikFavoriSayisi: number|null, atilanSayisi: number}}
   */
  function onizlemeOlustur(cozum) {
    const mevcut = ayarlarAl() ?? {};
    const degisen = new Set();
    for (const alan of cozum.alanlar) {
      if (kararliMetin(cozum.ayarlar[alan]) !== kararliMetin(mevcut[alan])) degisen.add(bolumAdi(alan));
    }
    const favoriler = Array.isArray(cozum.ayarlar.favoriler) ? cozum.ayarlar.favoriler : null;
    let bilinen = null;
    try {
      bilinen = bilinenKimlikler();
    } catch {
      bilinen = null; // bilinmiyor: sayı verilmez
    }
    return {
      bolumler: ONIZLEME_BOLUMLERI.filter((ad) => degisen.has(ad)),
      alanSayisi: cozum.alanlar.length,
      favoriSayisi: favoriler ? favoriler.length : null,
      eksikFavoriSayisi: favoriler && bilinen instanceof Set ? favoriler.filter((f) => !bilinen.has(f?.entity_id)).length : null,
      atilanSayisi: cozum.atilanlar.length,
    };
  }

  /** Kullanıcıya dosyayı SEÇTİRİR ve okur. @returns {{ok: true, ham: unknown, ad: string} | {ok: false, sonuc: object}} */
  async function dosyaSecVeOku(pencere) {
    let secim;
    try {
      secim = await dialog.showOpenDialog(pencere, { title: t('aktar.iceBaslik'), defaultPath: varsayilanKlasor, properties: ['openFile'], filters: jsonSuzgeci() });
    } catch {
      return { ok: false, sonuc: hata(t('aktar.diyalogAcilamadi')) };
    }
    if (!secim || secim.canceled || !Array.isArray(secim.filePaths) || typeof secim.filePaths[0] !== 'string') return { ok: false, sonuc: iptal() };
    const dosya = secim.filePaths[0];
    const okunan = jsonDosyasiniOku(dosya, fs, t);
    if (!okunan.ok) return { ok: false, sonuc: hata(okunan.hata) };
    return { ok: true, ham: okunan.ham, ad: path.basename(dosya) };
  }

  /** Doğrulanmış içeriği uygular; sonuç Ayarlar sayfasına gösterilecek özettir. */
  async function cozumuUygula(ham, ad, pencere) {
    let cozum;
    try {
      cozum = ayarYedeginiCoz(ham, { varsayilan: varsayilanAl(), t });
    } catch {
      return hata(t('aktar.dosyaIslenemedi'));
    }
    if (!cozum.ok) return hata(cozum.hata);
    if (!(await adresDegisimiOnaylandiMi(cozum.ayarlar, pencere))) {
      gunlugeYaz('Ayar yedeği uygulanmadı: ana makine değişikliği onaylanmadı.');
      return hata(t('aktar.adresOnay.onaylanmadi'));
    }
    let sonuc;
    try {
      sonuc = await uygula(cozum);
    } catch {
      gunlugeYaz('Ayar yedeği uygulanamadı (beklenmeyen hata).');
      return hata(t('aktar.uygulanirkenHata'));
    }
    if (!sonuc?.ok) return hata(sonuc?.hata || t('aktar.uygulanamadi'));
    gunlugeYaz('Ayarlar yedekten uygulandı.');
    const notlar = [];
    if (cozum.notlar.includes('kisayol-varsayilana-donduruldu')) notlar.push(t('aktar.notKisayol'));
    if (cozum.notlar.includes('palet-kisayol-varsayilana-donduruldu')) notlar.push(t('aktar.notPalet'));
    return {
      ok: true,
      ad,
      alanSayisi: cozum.alanlar.length,
      favoriSayisi: Number.isInteger(sonuc.favoriSayisi) ? sonuc.favoriSayisi : null,
      atilanSayisi: cozum.atilanlar.length,
      notlar,
      uyarilar: Array.isArray(sonuc.uyarilar) ? sonuc.uyarilar : [],
    };
  }

  return {
    /** Ayarları kullanıcının seçtiği dosyaya yazar (anahtar YOK). */
    async disaAktar(pencere) {
      const aktarim = ayarlariDisaAktar(ayarlarAl(), { simdi: simdi(), t });
      if (!aktarim.ok) return hata(aktarim.hata);
      const tarih = simdi().toISOString().slice(0, 10);
      let secim;
      try {
        secim = await dialog.showSaveDialog(pencere, {
          title: t('aktar.disaBaslik'),
          defaultPath: path.join(varsayilanKlasor || ayarDizini, `ev-paneli-ayarlar-${tarih}.json`),
          filters: jsonSuzgeci(),
        });
      } catch {
        return hata(t('aktar.diyalogAcilamadi'));
      }
      if (!secim || secim.canceled || typeof secim.filePath !== 'string' || secim.filePath === '') return iptal();
      const hedef = path.extname(secim.filePath).toLowerCase() === '.json' ? secim.filePath : `${secim.filePath}.json`;
      try {
        fs.writeFileSync(hedef, aktarim.metin, 'utf8');
      } catch {
        gunlugeYaz('Ayarlar dışa aktarılamadı (dosya yazılamadı).');
        return hata(t('aktar.dosyaYazilamadi'));
      }
      gunlugeYaz('Ayarlar dışa aktarıldı.');
      return { ok: true, ad: path.basename(hedef), favoriSayisi: aktarim.favoriSayisi };
    },

    /**
     * Önizleme adımı: dosyayı seçtirir, doğrular ve ne değişeceğini söyler; HİÇBİR ayar uygulanmaz. Dosya (ham içerik) bellekte tek kullanımlık
     * bir numarayla bekler; uygulama `iceAktar(pencere, onizlemeNo)` ile istenir.
     */
    async iceAktarOnizle(pencere) {
      bekleyen = null;
      const secilen = await dosyaSecVeOku(pencere);
      if (!secilen.ok) return secilen.sonuc;
      let cozum;
      try {
        cozum = ayarYedeginiCoz(secilen.ham, { varsayilan: varsayilanAl(), t });
      } catch {
        return hata(t('aktar.dosyaIslenemedi'));
      }
      if (!cozum.ok) return hata(cozum.hata);
      const no = randomBytes(8).toString('hex');
      bekleyen = { no, ham: secilen.ham, ad: secilen.ad, bitis: simdi().getTime() + ONIZLEME_OMRU_MS };
      return { ok: true, ad: secilen.ad, onizlemeNo: no, ...onizlemeOlustur(cozum) };
    },

    /**
     * Ayarları doğrulayıp uygular. `onizlemeNo` verilmişse ÖNİZLENEN dosya uygulanır (numara tutmuyor ya da süre dolmuşsa hiçbir şey olmaz);
     * verilmezse kullanıcının seçtiği dosya doğrudan doğrulanıp uygulanır.
     */
    async iceAktar(pencere, onizlemeNo) {
      if (onizlemeNo !== undefined && onizlemeNo !== null) {
        const b = bekleyen;
        bekleyen = null; // tek kullanım
        if (!b || typeof onizlemeNo !== 'string' || b.no !== onizlemeNo || simdi().getTime() > b.bitis) return hata(t('aktar.onizlemeGecersiz'));
        return cozumuUygula(b.ham, b.ad, pencere);
      }
      const secilen = await dosyaSecVeOku(pencere);
      if (!secilen.ok) return secilen.sonuc;
      return cozumuUygula(secilen.ham, secilen.ad, pencere);
    },

    /** Ayar klasöründeki geri dönülebilir yedekler (renderer'a yol gitmez: ad, tür, zaman, boyut). */
    yedekler() {
      return { ok: true, yedekler: yedekleriListele({ dizin: ayarDizini, fs }) };
    },

    /** Listedeki bir yedeğe geri döner. Ad yalnız beklenen yedek adlarından biri ve klasörde var olan bir dosya olabilir. */
    async yedektenDon(ad, pencere) {
      if (!yedekAdiGecerliMi(ad)) return hata(t('aktar.gecersizYedekAdi'));
      if (!yedekleriListele({ dizin: ayarDizini, fs }).some((y) => y.ad === ad)) return hata(t('aktar.yedekYok'));
      const okunan = jsonDosyasiniOku(path.join(ayarDizini, ad), fs, t);
      if (!okunan.ok) return hata(okunan.hata);
      return cozumuUygula(okunan.ham, ad, pencere);
    },
  };
}

module.exports = { ayarAktariciOlustur, anaMakineDegisenler, ONIZLEME_BOLUMLERI };
