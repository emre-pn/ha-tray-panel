'use strict';

/**
 * Bildirim akışı (o-36, o-37, o-39) — merkez, uyarı değerlendiricisi ve masaüstü yansıtmasını ana süreçte birbirine bağlar.
 * Saf; Electron'a bağlı değildir (köşe/Windows gösterimi `goster` geri çağrısıyla main.js'te yapılır).
 *
 *  - HA kalıcı bildirimleri: okuma.bildirimAboneOl (WS persistent_notification/subscribe, YALNIZ OKUMA) -> merkez.haGuncelle.
 *    Ayardaki `bildirimKalici` kapalıyken abonelik hiç kurulmaz.
 *  - Düşük pil / bekleyen güncelleme: 10 dakikada bir tek `GET /api/states` (okuma; yazma yok) -> merkez.taramaGuncelle. Pil ve
 *    güncelleme ayarlarının ikisi de kapalıysa hiç istek yapılmaz.
 *  - Uyarı kuralları: durum deposu değişimleri değerlendiriciye gider (uyari-kurallari.js); olay merkeze eklenir ve (sessiz
 *    saatte değilse) `goster` ile açılır pencere olur.
 *  - Masaüstü yansıtma (`bildirimMasaustu`): ilk yüklemeden sonra çıkan YENİ merkez öğeleri köşe bildirimi olur; dakikada en çok
 *    YANSITMA_SINIRI tane, fazlası tek bir "ve N bildirim daha" özetine birikir (bildirim seli olmaz).
 *  - Bildirim kapatma: yerel öğeler hemen kapanır; HA bildirimi `haKapat` ile (eylem.bildirimKapat: korumalı yol) kapatılır.
 *
 * KAPI KURALI: gösterilen her başlık/metin `goster`den önce bir kez daha süzgeçten geçer; geçmeyen gösterim atılır.
 * Günlüğe yalnız sabit metin yazılır (bildirim metni, varlık kimliği ya da ad yazılmaz).
 */

const { createHash } = require('node:crypto');
const { kurallariDuzelt, uyariDegerlendiriciOlustur } = require('./uyari-kurallari');
const { merkezOlustur } = require('./bildirim-merkezi');
const { birikenMetni } = require('./bildirim-metni');
const { guvenliMetin } = require('./suzgec');
const { TR } = require('./ceviri-varsayilan');

const TARAMA_ARALIGI_MS = 10 * 60 * 1000;
const ILK_TARAMA_MS = 20_000; // açılışta bağlantı otursun
const AYAR_TARAMA_MS = 1_500; // ayar açılınca çabuk tara
const TARAMA_YENIDEN_MS = 60_000; // başarısız taramadan sonra
const YANSITMA_SINIRI = 3; // pencere başına en çok bu kadar masaüstü bildirimi
const YANSITMA_PENCERESI_MS = 60_000;

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * Panele giden öğe anahtarı: ham anahtar (HA bildirim kimliği, varlık kimliği) panele ve DOM'a hiç gitmez; kimlikte kapı sözcüğü
 * olsa bile hiçbir yüzeye sızmaz. Kararlı, tek yönlü özettir; kapatma isteğinde ana süreç yeniden eşler.
 */
function opakAnahtar(anahtar) {
  return `k${createHash('sha256').update(String(anahtar)).digest('hex').slice(0, 16)}`;
}

const AYAR_VARSAYILANLARI = Object.freeze({
  bildirimKalici: true,
  bildirimPil: true,
  bildirimGuncelleme: false,
  bildirimPilEsigi: 20,
  bildirimMasaustu: true,
  uyariKurallari: [],
});

/**
 * @param {object} bag
 * @param {() => ({bildirimAboneOl: Function}|null|undefined)} bag.okumaAl ha-okuma nesnesi (geç bağlanır)
 * @param {(yol: string) => Promise<unknown>} bag.haIstek REST okuma (yalnız GET /api/states)
 * @param {{al: Function}} bag.depo durum deposu
 * @param {() => object} bag.ayarAl geçerli ayarlar (bildirimKalici, bildirimPil, bildirimGuncelleme, bildirimPilEsigi, bildirimMasaustu, uyariKurallari)
 * @param {(g: {kaynak: string, baslik: string, metin: string, simge: string, windows: boolean}) => void} bag.goster açılır pencere (köşe / Windows)
 * @param {() => void} [bag.degisti] merkez modeli değişti (panel yenilensin)
 * @param {(haKimligi: string) => Promise<{ok: boolean}>} [bag.haKapat] HA bildirimini kapat (eylem.bildirimKapat); kapat() çağrısı kendi işlevini de verebilir
 * @param {object} bag.kapatilan kapatilanDeposuOlustur sonucu
 * @param {Function} [bag.t] çevirmen (ana süreçte dil değişince kendiliğinden yeni dili izler)
 * @param {() => number} [bag.simdi]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {(m: string) => void} [bag.gunluk]
 */
function bildirimAkisiOlustur({ okumaAl, haIstek, depo, ayarAl, goster, degisti = () => {}, haKapat, kapatilan, t = TR, simdi = () => Date.now(), zaman = varsayilanZaman(), gunluk = () => {} }) {
  let kurallar = [];
  let kuralImzasi = '[]';
  let aboneBirak = null;
  let taramaZamanlayicisi = null;
  let taramada = false;
  let taramaHatasiYazildi = false;
  let durdu = false;
  let yansitmaZamanlari = [];
  let biriken = 0;
  let birikenZamanlayicisi = null;

  const ayar = () => {
    let a = null;
    try {
      a = ayarAl();
    } catch {
      a = null;
    }
    return { ...AYAR_VARSAYILANLARI, ...(a && typeof a === 'object' ? a : {}) };
  };

  /** Gösterimden önce son süzgeç: başlık ve metin kapı kuralından geçmeli. */
  function guvenliGoster(g) {
    const metin = guvenliMetin(g.metin, 200);
    const baslik = guvenliMetin(g.baslik, 80);
    if (!metin || !baslik) {
      gunluk('Bildirim gösterimi süzgeçten geçmedi.');
      return;
    }
    try {
      goster({ kaynak: g.kaynak, baslik, metin, simge: typeof g.simge === 'string' ? g.simge : '', windows: g.windows === true });
    } catch {
      gunluk('Bildirim gösterilemedi.');
    }
  }

  const merkez = merkezOlustur({ kapatilan, simdi, t, yeniOge: (oge) => yansit(oge) });
  merkez.dinle(() => {
    try {
      degisti();
    } catch {
      /* panel yenileme hatası akışı bozmasın */
    }
  });

  function birikenGoster() {
    birikenZamanlayicisi = null;
    const n = biriken;
    biriken = 0;
    if (n <= 0 || durdu) return;
    yansitmaZamanlari.push(simdi());
    guvenliGoster({ kaynak: 'ha', baslik: t('uygulama.ad'), metin: birikenMetni(n, t), simge: '🔔', windows: false });
  }

  /** Yeni merkez öğesini masaüstüne yansıtır (hız sınırlı). */
  function yansit(oge) {
    if (durdu || ayar().bildirimMasaustu === false) return;
    const an = simdi();
    yansitmaZamanlari = yansitmaZamanlari.filter((z) => an - z < YANSITMA_PENCERESI_MS);
    if (yansitmaZamanlari.length < YANSITMA_SINIRI && biriken === 0) {
      yansitmaZamanlari.push(an);
      guvenliGoster({ kaynak: oge.kaynak, baslik: oge.baslik, metin: oge.metin, simge: oge.simge, windows: false });
      return;
    }
    biriken += 1;
    if (birikenZamanlayicisi === null) birikenZamanlayicisi = zaman.setTimeout(birikenGoster, YANSITMA_PENCERESI_MS);
  }

  const degerlendirici = uyariDegerlendiriciOlustur({
    kurallarAl: () => kurallar,
    durumAl: (kimlik) => depo.al(kimlik),
    uyar: uyariGeldi,
    simdi,
    zaman,
    t,
    gunluk,
  });

  function uyariGeldi(olay) {
    const oge = merkez.uyariEkle(olay);
    if (!oge) {
      gunluk('Uyarı metni süzgeçten geçmedi.');
      return;
    }
    if (olay.sessiz) return; // sessiz saat: yalnız panel şeridi
    guvenliGoster({ kaynak: 'uyari', baslik: oge.baslik, metin: oge.metin, simge: oge.simge, windows: olay.windows === true });
  }

  /** Panelden gelen opak anahtarın karşılığı olan ham merkez anahtarı (panelde görünen öğeler arasından); yoksa null. */
  function gercekAnahtar(opak) {
    if (typeof opak !== 'string') return null;
    return merkez.model().ogeler.find((o) => opakAnahtar(o.anahtar) === opak)?.anahtar ?? null;
  }

  const taramaGerekli = (a = ayar()) => a.bildirimPil === true || a.bildirimGuncelleme === true;

  function taramayiPlanla(ms) {
    if (taramaZamanlayicisi !== null) zaman.clearTimeout(taramaZamanlayicisi);
    taramaZamanlayicisi = durdu ? null : zaman.setTimeout(tara, ms);
  }

  async function tara() {
    taramaZamanlayicisi = null;
    if (durdu || taramada || !taramaGerekli()) return;
    taramada = true;
    let basarili = false;
    try {
      basarili = merkez.taramaGuncelle(await haIstek('/api/states'));
      if (!basarili) gunluk('Bildirim taraması geçersiz yanıt aldı.');
      else taramaHatasiYazildi = false;
    } catch {
      if (!taramaHatasiYazildi) gunluk('Bildirim taraması yapılamadı.');
      taramaHatasiYazildi = true;
    } finally {
      taramada = false;
    }
    if (!durdu && taramaGerekli()) taramayiPlanla(basarili ? TARAMA_ARALIGI_MS : TARAMA_YENIDEN_MS);
  }

  function haDinleyicisi(liste, ek) {
    merkez.haGuncelle(liste, ek);
  }

  /** Ayarları (yeniden) uygular: merkez, abonelik, tarama ve uyarı kuralları. Tekrar çağrılabilir. */
  function ayarUygula() {
    if (durdu) return;
    const a = ayar();
    const taramaOncekiGerekli = taramaZamanlayicisi !== null || taramada;
    merkez.ayarla({ kalici: a.bildirimKalici === true, pil: a.bildirimPil === true, guncelleme: a.bildirimGuncelleme === true, pilEsigi: a.bildirimPilEsigi });
    // HA kalıcı bildirimleri
    if (a.bildirimKalici === true) {
      if (aboneBirak === null) {
        const okuma = okumaAl();
        if (okuma && typeof okuma.bildirimAboneOl === 'function') aboneBirak = okuma.bildirimAboneOl(haDinleyicisi);
      }
    } else if (aboneBirak !== null) {
      aboneBirak();
      aboneBirak = null;
      merkez.haSifirla();
    }
    // Pil / güncelleme taraması
    if (taramaGerekli(a)) {
      if (!taramaOncekiGerekli) taramayiPlanla(AYAR_TARAMA_MS);
    } else {
      if (taramaZamanlayicisi !== null) zaman.clearTimeout(taramaZamanlayicisi);
      taramaZamanlayicisi = null;
      merkez.taramaSifirla();
    }
    // Uyarı kuralları
    const yeniKurallar = kurallariDuzelt(a.uyariKurallari) ?? [];
    const imza = JSON.stringify(yeniKurallar);
    if (imza !== kuralImzasi) {
      kurallar = yeniKurallar;
      kuralImzasi = imza;
      degerlendirici.kurallarDegisti();
    }
  }

  return {
    /** Açılışta bir kez: kapatılanlar dosyadan yüklenir, ayarlar uygulanır, ilk tarama planlanır. */
    baslat() {
      durdu = false;
      kapatilan.yukle?.();
      ayarUygula();
      if (taramaGerekli() && taramaZamanlayicisi !== null) taramayiPlanla(ILK_TARAMA_MS);
    },
    /** Ayarlar kaydedildi (ekAyarDinle). */
    ayarDegisti: ayarUygula,
    /** Durum deposu değişti (depo.dinle). */
    depoDegisti(kimlikler) {
      if (!durdu && kurallar.length > 0) degerlendirici.degisti(kimlikler);
    },
    /** Canlı bağlantı kuruldu / koptu: kısa süre değişimler yalnız tabanı günceller (sahte uyarı olmasın). */
    baglantiDegisti() {
      degerlendirici.isinmaBaslat();
    },
    /** Kuralların izlediği varlık kimlikleri (durum deposunun izlediği kümeye eklenir). */
    izlenenKimlikler: () => degerlendirici.izlenenKimlikler(),
    /** Panel modeli: { ogeler, sayi, gizlenen }; öğe anahtarları opaktır (opakAnahtar), HA kimliği panele gitmez. */
    model() {
      const m = merkez.model();
      return { ...m, ogeler: m.ogeler.map((o) => ({ ...o, anahtar: opakAnahtar(o.anahtar) })) };
    },
    /** Anahtar şu an panelde gösterilen bir HA bildirimine ait mi (eylem.bildirimKapat izni). */
    bildirimKayitliMi: (haKimligi) => merkez.haKimligiVarMi(haKimligi),
    /**
     * Panelden "kapat" (anahtar: model()'deki opak anahtar). Yerel öğeler hemen kapanır; HA bildirimi korumalı yoldan kapatılır
     * (haKapatma: bu çağrıya özel işlev; verilmezse kurulumdaki haKapat), başarıda listeden çıkar.
     * @param {string} anahtar
     * @param {(haKimligi: string) => Promise<{ok: boolean, tur?: string}>} [haKapatma]
     * @returns {Promise<{ok: boolean, tur?: string}>}
     */
    async kapat(anahtar, haKapatma = haKapat) {
      const gercek = gercekAnahtar(anahtar);
      const sonuc = gercek === null ? null : merkez.kapat(gercek);
      if (!sonuc) return { ok: false, tur: 'yok' };
      if (sonuc.tur === 'yerel') return { ok: true };
      let yanit;
      try {
        yanit = typeof haKapatma === 'function' ? await haKapatma(sonuc.haKimligi) : { ok: false };
      } catch {
        yanit = { ok: false };
      }
      if (yanit?.ok === true) {
        merkez.haKapandi(sonuc.haKimligi);
        return { ok: true };
      }
      return { ok: false, tur: yanit?.tur ?? 'hata' };
    },
    /** Dil değişti: başlıklar yeni dille yeniden kurulur. */
    dilDegisti() {
      merkez.dilDegisti(t);
    },
    /** Hemen tara (test / tanı). */
    taraSimdi: tara,
    durum: () => ({ ...merkez.durum(), kural: kurallar.length, gizlenenUyari: degerlendirici.gizlenen(), tarama: taramaZamanlayicisi !== null, abone: aboneBirak !== null, biriken }),
    durdur() {
      durdu = true;
      if (aboneBirak !== null) aboneBirak();
      aboneBirak = null;
      if (taramaZamanlayicisi !== null) zaman.clearTimeout(taramaZamanlayicisi);
      taramaZamanlayicisi = null;
      if (birikenZamanlayicisi !== null) zaman.clearTimeout(birikenZamanlayicisi);
      birikenZamanlayicisi = null;
      degerlendirici.durdur();
      kapatilan.bosalt?.();
    },
  };
}

module.exports = { opakAnahtar, TARAMA_ARALIGI_MS, ILK_TARAMA_MS, AYAR_TARAMA_MS, TARAMA_YENIDEN_MS, YANSITMA_SINIRI, YANSITMA_PENCERESI_MS, AYAR_VARSAYILANLARI, bildirimAkisiOlustur };
