'use strict';

/**
 * Düzen işlemleri (saf, bağımlılıksız): sayfa (sekme) listesi ve sıralama işlemleri — 1.4.0 düzen grubu (o-24, o-30).
 *
 * Sayfa kaydı: { id, ad, varliklar: [varlık kimliği, ...] }. `varliklar` sayfanın KENDİ sırasıdır; sayfa yalnız favorilerin bir
 * alt kümesini gösterir (kimliklerin favori olup olmadığı, kapı kuralı ve alan denetimi ana süreçte src/lib/sayfalar.js'de yapılır;
 * bu dosya yalnız dizi işlemidir). Hiçbir işlev girdiyi DEĞİŞTİRMEZ; yeni dizi döner. Geçersiz istek (olmayan sayfa, sınır aşımı)
 * girdinin aynısını döner.
 *
 * Bu dosya hem Node'da (require) hem renderer'da (<script src="lib/duzen-islemleri.js">, window.EvDuzenIslemleri) çalışır:
 * Ayarlar sayfası taslağı bu işlevlerle düzenler, ana süreç bağlam menüsü işlemlerinde aynılarını kullanır. `require` kullanmaz.
 */
(function (kok, fabrika) {
  const modul = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = modul;
  else kok.EvDuzenIslemleri = modul;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EN_COK_SAYFA = 12;
  const EN_COK_SAYFA_VARLIGI = 100;
  const SAYFA_AD_SINIRI = 24;
  const SAYFA_KIMLIGI_DESENI = /^[a-z0-9]{3,12}$/;
  const KIMLIK_ALFABESI = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const diziMi = (d) => Array.isArray(d);
  const kopya = (sayfalar) => (diziMi(sayfalar) ? sayfalar.map((s) => ({ ...s, varliklar: diziMi(s?.varliklar) ? [...s.varliklar] : [] })) : []);

  function adKisalt(ad) {
    return Array.from(String(ad ?? '').replace(/\s+/g, ' ').trim()).slice(0, SAYFA_AD_SINIRI).join('');
  }

  /** Kullanılmayan yeni sayfa kimliği ('s' + 5 karakter). `rastgele`: () => [0,1) sayı (testte sabitlenebilir). */
  function sayfaKimligiUret(mevcutlar, rastgele = Math.random) {
    const kullanilan = new Set((diziMi(mevcutlar) ? mevcutlar : []).map((s) => (typeof s === 'string' ? s : s?.id)));
    for (let deneme = 0; deneme < 200; deneme += 1) {
      let kimlik = 's';
      for (let i = 0; i < 5; i += 1) kimlik += KIMLIK_ALFABESI[Math.floor(rastgele() * KIMLIK_ALFABESI.length) % KIMLIK_ALFABESI.length];
      if (!kullanilan.has(kimlik)) return kimlik;
    }
    return `s${Date.now().toString(36).slice(-6)}`; // olasılık dışı: rastgelelik tükendi
  }

  const sayfaBul = (sayfalar, id) => sayfalar.findIndex((s) => s.id === id);

  /** Yeni boş sayfa ekler (sınırı aşarsa ya da kimlik kullanımdaysa girdi aynen döner). */
  function sayfaEkle(sayfalar, ad, id) {
    const liste = kopya(sayfalar);
    if (liste.length >= EN_COK_SAYFA || typeof id !== 'string' || !SAYFA_KIMLIGI_DESENI.test(id) || sayfaBul(liste, id) >= 0) return liste;
    liste.push({ id, ad: adKisalt(ad), varliklar: [] });
    return liste;
  }

  function sayfayiAdlandir(sayfalar, id, ad) {
    const liste = kopya(sayfalar);
    const sira = sayfaBul(liste, id);
    if (sira >= 0) liste[sira].ad = adKisalt(ad);
    return liste;
  }

  /**
   * Sayfayı çoğaltır (dizi kopyası): kopya, özgün sayfanın hemen arkasına girer ve adı `ad + ' ' + ek` olur (ek: çevrilmiş "kopya" eki).
   * @returns {{ sayfalar: object[], yeniId: string|null }}
   */
  function sayfayiCogalt(sayfalar, id, yeniId, ek) {
    const liste = kopya(sayfalar);
    const sira = sayfaBul(liste, id);
    if (sira < 0 || liste.length >= EN_COK_SAYFA || typeof yeniId !== 'string' || !SAYFA_KIMLIGI_DESENI.test(yeniId) || sayfaBul(liste, yeniId) >= 0) {
      return { sayfalar: liste, yeniId: null };
    }
    const kaynak = liste[sira];
    const eksiz = adKisalt(kaynak.ad);
    const ekMetni = adKisalt(ek);
    const yeniAd = ekMetni ? adKisalt(`${Array.from(eksiz).slice(0, Math.max(0, SAYFA_AD_SINIRI - Array.from(ekMetni).length - 1)).join('')} ${ekMetni}`) : eksiz;
    liste.splice(sira + 1, 0, { id: yeniId, ad: yeniAd, varliklar: [...kaynak.varliklar] });
    return { sayfalar: liste, yeniId };
  }

  function sayfayiSil(sayfalar, id) {
    return kopya(sayfalar).filter((s) => s.id !== id);
  }

  /** Dizideki bir öğeyi `hedef` sırasına taşır (sınırlara kırpılır). Öğe yoksa kopya döner. */
  function konumaTasi(liste, oge, hedef) {
    const yeni = diziMi(liste) ? [...liste] : [];
    const kaynak = yeni.indexOf(oge);
    if (kaynak < 0 || !Number.isInteger(hedef)) return yeni;
    const varis = Math.max(0, Math.min(yeni.length - 1, hedef));
    if (varis === kaynak) return yeni;
    yeni.splice(kaynak, 1);
    yeni.splice(varis, 0, oge);
    return yeni;
  }

  /** Öğeyi bir adım yukarı (yon < 0) ya da aşağı (yon > 0) alır. */
  function yondeTasi(liste, oge, yon) {
    const sira = diziMi(liste) ? liste.indexOf(oge) : -1;
    if (sira < 0 || !yon) return diziMi(liste) ? [...liste] : [];
    return konumaTasi(liste, oge, sira + (yon < 0 ? -1 : 1));
  }

  function sayfayiTasi(sayfalar, id, yon) {
    const liste = kopya(sayfalar);
    const sira = sayfaBul(liste, id);
    if (sira < 0 || !yon) return liste;
    const hedef = Math.max(0, Math.min(liste.length - 1, sira + (yon < 0 ? -1 : 1)));
    if (hedef === sira) return liste;
    const [sayfa] = liste.splice(sira, 1);
    liste.splice(hedef, 0, sayfa);
    return liste;
  }

  /** Sayfayı `hedef` sırasına taşır (sürükle-bırak). */
  function sayfayiKonumaTasi(sayfalar, id, hedef) {
    const liste = kopya(sayfalar);
    const sira = sayfaBul(liste, id);
    if (sira < 0 || !Number.isInteger(hedef)) return liste;
    const varis = Math.max(0, Math.min(liste.length - 1, hedef));
    if (varis === sira) return liste;
    const [sayfa] = liste.splice(sira, 1);
    liste.splice(varis, 0, sayfa);
    return liste;
  }

  /** Sayfaya varlık ekler (sonuna; zaten varsa ya da sınır aşılırsa değişmez). */
  function varlikEkle(sayfalar, id, kimlik) {
    const liste = kopya(sayfalar);
    const sayfa = liste[sayfaBul(liste, id)];
    if (sayfa && typeof kimlik === 'string' && !sayfa.varliklar.includes(kimlik) && sayfa.varliklar.length < EN_COK_SAYFA_VARLIGI) sayfa.varliklar.push(kimlik);
    return liste;
  }

  function varlikCikar(sayfalar, id, kimlik) {
    const liste = kopya(sayfalar);
    const sayfa = liste[sayfaBul(liste, id)];
    if (sayfa) sayfa.varliklar = sayfa.varliklar.filter((k) => k !== kimlik);
    return liste;
  }

  /** Sayfadaki varlığı sıra içinde taşır: `yon` (-1/+1) ya da `hedef` sırası (sürükle-bırak). */
  function varlikTasi(sayfalar, id, kimlik, { yon = 0, hedef = null } = {}) {
    const liste = kopya(sayfalar);
    const sayfa = liste[sayfaBul(liste, id)];
    if (!sayfa) return liste;
    sayfa.varliklar = Number.isInteger(hedef) ? konumaTasi(sayfa.varliklar, kimlik, hedef) : yondeTasi(sayfa.varliklar, kimlik, yon);
    return liste;
  }

  /** Favori kimliği değişti (onarım): her sayfada aynı sırada yenisiyle değişir; yenisi zaten sayfadaysa eskisi yalnız çıkar. */
  function kimlikDegistir(sayfalar, eski, yeni) {
    return kopya(sayfalar).map((s) => {
      if (!s.varliklar.includes(eski)) return s;
      const varliklar = s.varliklar.includes(yeni) ? s.varliklar.filter((k) => k !== eski) : s.varliklar.map((k) => (k === eski ? yeni : k));
      return { ...s, varliklar };
    });
  }

  /** Kimliği bütün sayfalardan çıkarır (favori kaldırıldı). */
  function tumundenCikar(sayfalar, kimlik) {
    return kopya(sayfalar).map((s) => ({ ...s, varliklar: s.varliklar.filter((k) => k !== kimlik) }));
  }

  /** Kimliği taşıyan sayfaların kimlikleri. */
  function varlikSayfalari(sayfalar, kimlik) {
    return kopya(sayfalar).filter((s) => s.varliklar.includes(kimlik)).map((s) => s.id);
  }

  return {
    EN_COK_SAYFA,
    EN_COK_SAYFA_VARLIGI,
    SAYFA_AD_SINIRI,
    SAYFA_KIMLIGI_DESENI,
    sayfaKimligiUret,
    sayfaEkle,
    sayfayiAdlandir,
    sayfayiCogalt,
    sayfayiSil,
    sayfayiTasi,
    sayfayiKonumaTasi,
    konumaTasi,
    yondeTasi,
    varlikEkle,
    varlikCikar,
    varlikTasi,
    kimlikDegistir,
    tumundenCikar,
    varlikSayfalari,
  };
});
