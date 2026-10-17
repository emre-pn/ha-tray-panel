'use strict';

/**
 * Dış tetik kapısı — 1.4.0 dis grubu (o-21 Jump List ve masaüstü kısayolu, o-47 PC olayları, o-52 yerel API, o-53 toplantı ışığı,
 * o-54 evpaneli:// bağlantısı). Saf; Electron'a bağlı değildir.
 *
 * Uygulamanın penceresi DIŞINDAN gelen her eylem YALNIZ buradan geçer ve sonra eylem.distenCalistir ile her zamanki tek güvenli
 * hatta (src/lib/eylem-hatti.js: Kapı Kuralı canlı durumla, sınıf, kaynak izni + 4b dış kaynak izni, servis izin listesi, hız
 * sınırı, tek POST) girer. Kapının adımları:
 *   1. kaynak DIS_KAYNAKLAR'dan biri ve Ayarlar'daki seçeneği AÇIK olmalı (hepsi varsayılan kapalı)           -> 'kapali'
 *   2. kaynak başına ve genel hız sınırı                                                                     -> 'cok-sik'
 *   3. ad biçimi (kısa metin, denetim karakteri yok) ve Kapı Kuralı metin süzgeci                             -> 'gecersiz' / 'yasak'
 *   4. çözüm: ad YALNIZ güvenli favori karoları arasında (komut-satiri.js eylemAdiniCoz; belirsizse hiçbiri), Ayarlar'da seçilen
 *      kural kimliği yalnız karo listesinde aranır                                                              -> 'bulunamadi' / 'belirsiz' ...
 *   5. zararsızlık: karo zararsız, istenen servis onay istemiyor, valf/otomasyon/kamera/perde ve klima modu değil -> 'kaynak-izinsiz'
 *      PC olayında kapatma dışındaki işlemler ayrıca "açma eylemlerine izin ver" seçeneğini ister
 *   6. (yalnız evpaneli://) favori için izin: panelde "İzin ver / Her zaman / Reddet"; aynı anda tek soru       -> 'reddedildi' / 'onay-bekliyor'
 *      izin sonrası 1-5 yeniden denetlenir (bu arada seçenek kapanmış ya da favori değişmiş olabilir)
 *   7. eylem.distenCalistir; sonuç etkinlik geçmişi için `olay` ile bildirilir (sır, adres, anahtar taşımaz)
 * Kural tabanlı tetikler (PC olayı, toplantı ışığı) için ayrıca "geri yükle": aç/kapat öncesi karonun durumu (açık/kapalı, parlaklık)
 * bellekte saklanır, geriYukle onu geri kurar (diske yazılmaz, ANLIK_OMRU_MS sonra unutulur).
 */

const { DIS_KAYNAKLAR, disKaynakIzni } = require('./eylem-sinifi');
const { EN_COK_AD, eylemAdiniCoz, komutSatiriAdi, kimlikBicimindeMi } = require('./komut-satiri');
const { varsayilanServis } = require('./alan-kaydi');
const { yonDestekleniyorMu } = require('./yonlu-eylem');
const { metinGuvenliMi } = require('./suzgec');

/** Kaynak -> onu açan ayar alanı (src/lib/ayar-alanlari.js dis grubu). */
const KAYNAK_AYARI = Object.freeze({
  jumplist: 'tetikJumpList',
  'kisayol-dosyasi': 'tetikMasaustu',
  'yerel-api': 'tetikYerelApi',
  protokol: 'tetikProtokol',
  'pc-olayi': 'tetikPcOlaylari',
  toplanti: 'tetikToplanti',
});
/** Kaynak başına hız sınırı (kayan pencere). PC olayında en çok 8 kural iki olayda (kilit + uyku) arka arkaya çalışabilir. */
const HIZ_SINIRLARI = Object.freeze({
  jumplist: Object.freeze({ enCok: 6, pencereMs: 10_000 }),
  'kisayol-dosyasi': Object.freeze({ enCok: 6, pencereMs: 10_000 }),
  protokol: Object.freeze({ enCok: 6, pencereMs: 10_000 }),
  'yerel-api': Object.freeze({ enCok: 20, pencereMs: 10_000 }),
  'pc-olayi': Object.freeze({ enCok: 16, pencereMs: 10_000 }),
  toplanti: Object.freeze({ enCok: 4, pencereMs: 10_000 }),
});
const GENEL_HIZ_SINIRI = Object.freeze({ enCok: 60, pencereMs: 60_000 });
/** Kural tabanlı işlemler (PC olayı, toplantı ışığı). */
const KURAL_ISLEMLERI = Object.freeze(['calistir', 'ac', 'kapat', 'baslat', 'geriYukle']);
const AD_ISLEMLERI = Object.freeze(['ac', 'kapat', 'degistir']);
const KURAL_KAYNAKLARI = Object.freeze(['pc-olayi', 'toplanti']);
const KULLANICI_KAYNAKLARI = Object.freeze(['jumplist', 'kisayol-dosyasi', 'protokol']);
const ONAY_KARARLARI = Object.freeze(['izin', 'herZaman', 'reddet']);
const ANLIK_OMRU_MS = 24 * 60 * 60 * 1000;
const EN_COK_ANLIK = 50;

/** Gate sonucunun hata türü -> kullanıcıya gösterilen metin anahtarı (src/lib/ceviri/ana.js). Listede olmayan tür bildirilmez. */
const HATA_ANAHTARLARI = Object.freeze({
  kapali: 'dis.kapali',
  'cok-sik': 'dis.cokSik',
  yasak: 'dis.izinsiz',
  'kaynak-izinsiz': 'dis.izinsiz',
  'onay-bekliyor': 'dis.onayBekliyor',
  bulunamadi: 'sonuc.komutBulunamadi',
  belirsiz: 'sonuc.komutBelirsiz',
  sinir: 'sonuc.komutSinirDisi',
  desteklenmiyor: 'sonuc.komutDesteklenmiyor',
  komutGerekli: 'sonuc.komutGerekli',
  gecersiz: 'sonuc.gecersizIstek',
});

const hata = (tur) => ({ hata: tur });

/** Dış kaynaktan gelen ad: kısa metin, denetim karakteri yok, varlık kimliği biçiminde değil (dış tetikler favori ADI taşır). */
function adBicimiGecerliMi(ad) {
  return typeof ad === 'string' && ad.trim() !== '' && ad.length <= EN_COK_AD && !/[\u0000-\u001F\u007F-\u009F]/.test(ad) && !kimlikBicimindeMi(ad);
}

/** İstenen işlem için HA servisinin adı (zararsızlık denetimi; asıl servis hatta kurulur). */
function istenenServis(karo, is) {
  if (is.yon) {
    if (is.yon.tur === 'ac') return 'turn_on';
    if (is.yon.tur === 'kapat') return 'turn_off';
    if (is.yon.tur === 'goreli') return karo.alan === 'fan' ? 'set_percentage' : 'turn_on';
    return varsayilanServis(karo.alan) ?? undefined;
  }
  if (is.parlaklik !== undefined) return is.parlaklik === 0 ? 'turn_off' : 'turn_on';
  if (typeof is.servis === 'string') return is.servis;
  return varsayilanServis(karo.alan) ?? undefined;
}

/**
 * Karo bu işlemle bir dış tetikten çalıştırılabilir mi? Karo zararsız (yıkıcı değil), servis onay istemez ve dış kaynak izni vardır.
 * @param {{alan: string, sinif: string, onayliServisler?: string[]}} karo
 * @param {object} [is] { yon?, parlaklik?, servis? } (verilmezse tek tıklama eylemi)
 */
function disaUygunMu(karo, is = {}) {
  if (!karo || typeof karo !== 'object' || karo.sinif !== 'zararsiz') return false;
  const servis = istenenServis(karo, is);
  if (typeof servis !== 'string') return false;
  if (Array.isArray(karo.onayliServisler) && karo.onayliServisler.includes(servis)) return false;
  return disKaynakIzni(karo.alan, servis);
}

/** Ad değiştiricisi (islem / parlaklik / adim) -> distenCalistir yükü; desteklenmezse hata. */
function degistiriciUygula(karo, { islem, parlaklik, adim }) {
  const sayi = [islem, parlaklik, adim].filter((d) => d !== undefined).length;
  if (sayi === 0) return {};
  if (sayi > 1) return hata('gecersiz');
  if (islem !== undefined) {
    if (!AD_ISLEMLERI.includes(islem)) return hata('gecersiz');
    if (!yonDestekleniyorMu({ tur: islem }, karo)) return hata('desteklenmiyor');
    return { yon: { tur: islem } };
  }
  if (parlaklik !== undefined) {
    if (!Number.isInteger(parlaklik) || parlaklik < 0 || parlaklik > 100) return hata('sinir');
    if (karo.parlaklikKontrol !== true) return hata('desteklenmiyor');
    return { parlaklik };
  }
  if (!Number.isInteger(adim) || adim === 0 || Math.abs(adim) > 100) return hata('sinir');
  if (!yonDestekleniyorMu({ tur: 'goreli' }, karo)) return hata('desteklenmiyor');
  return { yon: { tur: 'goreli', delta: adim } };
}

/** eylemAdiniCoz sonucunu distenCalistir yüküne çevirir. */
function cozumYuku(cozum) {
  if (cozum.yon) return { yon: cozum.yon };
  if (cozum.parlaklik !== undefined) return { parlaklik: cozum.parlaklik };
  if (cozum.kapat === true) return { yon: { tur: 'kapat' } };
  if (typeof cozum.servis === 'string') return cozum.veri === undefined ? { servis: cozum.servis } : { servis: cozum.servis, veri: cozum.veri };
  return {};
}

/**
 * @param {object} bag
 * @param {() => object} bag.ayarlarAl güncel ayarlar
 * @param {() => object[]} bag.karolarAl güvenli favori karoları (src/lib/yuzey-modeli.js; Kapı Kuralı'ndan geçmiş)
 * @param {{distenCalistir: Function}} bag.eylem src/eylem.js
 * @param {(soru: {ad: string, islem: string, deger?: number}) => Promise<'izin'|'herZaman'|'reddet'>} [bag.onaySor] evpaneli:// izni
 * @param {(kimlik: string) => void} [bag.izinEkle] "Her zaman" kararını ayara yazar (tetikProtokolIzinleri)
 * @param {(b: {tur: 'hata', metin: string, baslik?: string}) => void} [bag.bildir] hata bildirimi (geriBildirim)
 * @param {Function} [bag.t] çevirmen
 * @param {(kayit: {zaman: number, kaynak: string, kimlik: string|null, ad: string|null, sonuc: string}) => void} [bag.olay]
 *   etkinlik geçmişi kancası (eylem grubu bağlar)
 * @param {(m: string) => void} [bag.gunluk]
 * @param {() => number} [bag.simdi]
 */
function disTetikKapisiOlustur({ ayarlarAl, karolarAl, eylem, onaySor = null, izinEkle = () => {}, bildir = () => {}, t = (k) => k, olay = () => {}, gunluk = () => {}, simdi = () => Date.now() }) {
  const zamanlar = new Map(); // kaynak -> [zaman]
  const genelZamanlar = [];
  const anliklar = new Map(); // `${kaynak}|${kimlik}` -> { durum, yuzde, zaman }
  let onayBekliyor = false;

  const ayarlar = () => {
    try {
      const a = ayarlarAl();
      return a && typeof a === 'object' ? a : {};
    } catch {
      return {};
    }
  };
  const karolar = () => {
    try {
      const k = karolarAl();
      return Array.isArray(k) ? k.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : [];
    } catch {
      return [];
    }
  };
  const acikMi = (kaynak, a) => a[KAYNAK_AYARI[kaynak]] === true;

  function pencereyeSigar(liste, { enCok, pencereMs }, an) {
    while (liste.length > 0 && an - liste[0] >= pencereMs) liste.shift();
    return liste.length < enCok;
  }

  function hizIzni(kaynak) {
    const an = simdi();
    if (!zamanlar.has(kaynak)) zamanlar.set(kaynak, []);
    const liste = zamanlar.get(kaynak);
    if (!pencereyeSigar(liste, HIZ_SINIRLARI[kaynak], an) || !pencereyeSigar(genelZamanlar, GENEL_HIZ_SINIRI, an)) return false;
    liste.push(an);
    genelZamanlar.push(an);
    return true;
  }

  function bildirimKipi(kaynak, a) {
    if (kaynak === 'yerel-api') return a.tetikApiBildirim === true ? 'hepsi' : 'yok';
    return KURAL_KAYNAKLARI.includes(kaynak) ? 'hata' : 'hepsi';
  }

  function anlikAl(anahtar) {
    const k = anliklar.get(anahtar);
    if (!k) return null;
    if (simdi() - k.zaman > ANLIK_OMRU_MS) {
      anliklar.delete(anahtar);
      return null;
    }
    return k;
  }

  function anlikKaydet(anahtar, karo) {
    if (anlikAl(anahtar)) return; // kilit + uyku arka arkaya: ilk (asıl) durum korunur
    if (karo.durum !== 'acik' && karo.durum !== 'kapali') return;
    if (anliklar.size >= EN_COK_ANLIK) anliklar.delete(anliklar.keys().next().value);
    anliklar.set(anahtar, { durum: karo.durum, yuzde: Number.isInteger(karo.yuzde) ? karo.yuzde : null, zaman: simdi() });
  }

  /** Kural tabanlı istek (kimlik + işlem) -> { karo, is } ya da hata. geriYukle burada anlığa çevrilir (tüketilmez). */
  function kuralHazirla(istek, liste, a) {
    if (typeof istek.kimlik !== 'string' || !KURAL_ISLEMLERI.includes(istek.islem ?? 'calistir')) return hata('gecersiz');
    const karo = liste.find((k) => k.id === istek.kimlik);
    if (!karo) return hata('bulunamadi');
    const islem = istek.islem ?? 'calistir';
    if (istek.kaynak === 'pc-olayi' && islem !== 'kapat' && a.tetikPcAcma !== true) return hata('kaynak-izinsiz');
    const acKapa = yonDestekleniyorMu({ tur: 'ac' }, karo);
    let is;
    if (islem === 'kapat' || islem === 'ac') {
      if (!acKapa) return hata('desteklenmiyor');
      is = { yon: { tur: islem } };
    } else if (islem === 'baslat') {
      if (!acKapa && karo.varsayilanEylem === false) return hata('komutGerekli');
      is = acKapa ? { yon: { tur: 'ac' } } : {}; // ışık/priz açılır; sahne, betik, düğme tek tıklama eylemiyle başlar
    } else if (islem === 'geriYukle') {
      if (!acKapa) return hata('desteklenmiyor');
      const anlik = anlikAl(`${istek.kaynak}|${karo.id}`);
      if (!anlik) return hata('anlik-yok');
      if (anlik.durum === 'kapali') is = { yon: { tur: 'kapat' } };
      else if (karo.parlaklikKontrol === true && Number.isInteger(anlik.yuzde) && anlik.yuzde > 0) is = { parlaklik: anlik.yuzde };
      else is = { yon: { tur: 'ac' } };
    } else {
      if (karo.varsayilanEylem === false) return hata('komutGerekli');
      is = {};
    }
    return { karo, is, islem };
  }

  /** Ad tabanlı istek (Jump List, kısayol, bağlantı, API) -> { karo, is } ya da hata. */
  function adHazirla(istek, liste) {
    if (!adBicimiGecerliMi(istek.ad)) return hata('gecersiz');
    if (!metinGuvenliMi(istek.ad)) return hata('yasak');
    const cozum = eylemAdiniCoz(istek.ad.trim(), liste);
    if (cozum.hata) return hata(cozum.hata);
    const karo = liste.find((k) => k.id === cozum.id);
    if (!karo) return hata('bulunamadi');
    const degistirici = { islem: istek.islem, parlaklik: istek.parlaklik, adim: istek.adim };
    const degistiriciVar = Object.values(degistirici).some((d) => d !== undefined);
    if (!degistiriciVar) return { karo, is: cozumYuku(cozum), islem: 'ad' };
    if (Object.keys(cozum).length !== 1) return hata('gecersiz'); // "led 40" + parlaklik=10 gibi çift değer
    const is = degistiriciUygula(karo, degistirici);
    if (is.hata) return is;
    return { karo, is, islem: 'ad' };
  }

  /** 1-5. adımlar (izin sonrası yeniden de çağrılır). */
  function hazirla(istek, a) {
    if (!acikMi(istek.kaynak, a)) return hata('kapali');
    const liste = karolar();
    const h = KURAL_KAYNAKLARI.includes(istek.kaynak) ? kuralHazirla(istek, liste, a) : adHazirla(istek, liste);
    if (h.hata) return h;
    if (!disaUygunMu(h.karo, h.is)) return hata('kaynak-izinsiz');
    return h;
  }

  function olayYay(kaynak, karo, sonuc) {
    try {
      olay({ zaman: simdi(), kaynak, kimlik: karo?.id ?? null, ad: karo?.etiket ?? null, sonuc });
    } catch {
      /* geçmiş kancası eylemi bozamaz */
    }
  }

  function reddet(kaynak, tur, a, karo = null) {
    gunluk(`Dış tetik reddedildi: ${kaynak}/${tur}`);
    olayYay(kaynak, karo, tur);
    const anahtar = HATA_ANAHTARLARI[tur];
    if (anahtar && bildirimKipi(kaynak, a) !== 'yok' && (KULLANICI_KAYNAKLARI.includes(kaynak) || KURAL_KAYNAKLARI.includes(kaynak))) {
      try {
        bildir({ tur: 'hata', metin: t(anahtar), baslik: t('uygulama.ad') });
      } catch {
        /* bildirim hatası eylemi bozmaz */
      }
    }
    return { ok: false, tur, ...(karo ? { ad: karo.etiket } : {}) };
  }

  /** Bağlantı izni: aynı anda tek soru; 'izin' | 'herZaman' | 'reddet'. */
  async function izinAl(karo, is) {
    if (typeof onaySor !== 'function') return 'reddet';
    onayBekliyor = true;
    try {
      const soru = { ad: karo.etiket, islem: is.yon ? is.yon.tur : is.parlaklik !== undefined ? 'parlaklik' : is.servis ? 'komut' : 'calistir' };
      if (is.parlaklik !== undefined) soru.deger = is.parlaklik;
      if (is.yon?.tur === 'goreli') soru.deger = is.yon.delta;
      const karar = await onaySor(soru);
      return ONAY_KARARLARI.includes(karar) ? karar : 'reddet';
    } catch {
      return 'reddet';
    } finally {
      onayBekliyor = false;
    }
  }

  async function sonucla(kaynak, karo, cagri) {
    let sonuc;
    try {
      sonuc = await cagri;
    } catch {
      sonuc = { ok: false, tur: 'ha-hatasi' };
    }
    const ozet = sonuc && typeof sonuc === 'object' ? sonuc : { ok: false, tur: 'gecersiz' };
    olayYay(kaynak, karo, ozet.ok ? 'ok' : String(ozet.tur ?? 'hata'));
    return ozet.ok ? { ok: true, ad: karo.etiket, ...(ozet.degismedi ? { degismedi: true } : {}) } : { ok: false, tur: ozet.tur ?? 'hata', ad: karo.etiket };
  }

  /**
   * Dış tetik isteği. kaynak DIS_KAYNAKLAR'dan biridir; ad tabanlı kaynaklar { ad, islem?, parlaklik?, adim? }, kural tabanlılar
   * { kimlik, islem } verir. PC olayı ve toplantı için çağrı, distenCalistir'e kadar beklemeden (aynı tikte) ilerler: uykuya geçerken
   * istek işletim sistemi askıya almadan gönderilebilsin.
   * @returns {Promise<{ok: boolean, tur?: string, ad?: string}>}
   */
  async function calistir(istek) {
    const kaynak = istek?.kaynak;
    if (!DIS_KAYNAKLAR.includes(kaynak)) return { ok: false, tur: 'gecersiz' };
    let a = ayarlar();
    if (!acikMi(kaynak, a)) return reddet(kaynak, 'kapali', a);
    if (!hizIzni(kaynak)) return reddet(kaynak, 'cok-sik', a);
    let h = hazirla(istek, a);
    if (h.hata === 'anlik-yok') {
      olayYay(kaynak, null, 'anlik-yok');
      return { ok: false, tur: 'anlik-yok' };
    }
    if (h.hata) return reddet(kaynak, h.hata, a);
    if (kaynak === 'protokol') {
      const izinli = Array.isArray(a.tetikProtokolIzinleri) && a.tetikProtokolIzinleri.includes(h.karo.id);
      if (!izinli) {
        if (onayBekliyor) return reddet(kaynak, 'onay-bekliyor', a, h.karo);
        const karar = await izinAl(h.karo, h.is);
        if (karar === 'reddet') {
          olayYay(kaynak, h.karo, 'reddedildi');
          return { ok: false, tur: 'reddedildi', ad: h.karo.etiket };
        }
        const kimlik = h.karo.id;
        a = ayarlar();
        h = hazirla(istek, a); // bu arada seçenek kapanmış, favori silinmiş ya da ad başka karoya kaymış olabilir
        if (h.hata) return reddet(kaynak, h.hata, a);
        if (h.karo.id !== kimlik) return reddet(kaynak, 'belirsiz', a);
        if (karar === 'herZaman') {
          try {
            izinEkle(kimlik);
          } catch {
            /* izin yazılamasa da bu seferlik izin verildi */
          }
        }
      }
    }
    if (KURAL_KAYNAKLARI.includes(kaynak)) {
      const anahtar = `${kaynak}|${h.karo.id}`;
      if (h.islem === 'geriYukle') anliklar.delete(anahtar);
      else if (h.islem === 'ac' || h.islem === 'kapat' || h.islem === 'baslat') anlikKaydet(anahtar, h.karo);
    }
    const yuk = { kimlik: h.karo.id, kaynak, bildirim: bildirimKipi(kaynak, a), ...h.is };
    return sonucla(kaynak, h.karo, eylem.distenCalistir(yuk));
  }

  /** Dış tetiklere konabilen favoriler: tek tıklama eylemi zararsız ve komut satırında geri bulunan adı olanlar (sıra: favori sırası). */
  function uygunlar() {
    const liste = karolar();
    const sonuc = [];
    for (const karo of liste) {
      if (karo.varsayilanEylem === false || !disaUygunMu(karo)) continue;
      const ad = komutSatiriAdi(karo, liste);
      if (ad) sonuc.push({ karo, ad });
    }
    return sonuc;
  }

  /** Kural tabanlı tetiklere (PC olayı, toplantı) seçilebilen favoriler: aç-kapa ya da tek tıklama eylemi zararsız olanlar. */
  function kuralUygunlari() {
    return karolar().filter((karo) => {
      if (yonDestekleniyorMu({ tur: 'ac' }, karo)) return disaUygunMu(karo, { yon: { tur: 'kapat' } }) && disaUygunMu(karo, { yon: { tur: 'ac' } });
      return karo.varsayilanEylem !== false && disaUygunMu(karo);
    });
  }

  /** Yerel API /liste: uygun favorilerin adı ve kısa durumu (kimlik, adres, öznitelik yok). */
  function listeAl() {
    return uygunlar().map(({ karo, ad }) => ({ ad, alan: karo.alan, durum: karo.durum ?? 'yok', yuzde: Number.isInteger(karo.yuzde) ? karo.yuzde : null }));
  }

  /** Yerel API /durum: ad çözülür (eylem çalışmaz); yalnız uygun favoriler. */
  function durumAl(ad) {
    if (!adBicimiGecerliMi(ad)) return { ok: false, tur: 'gecersiz' };
    if (!metinGuvenliMi(ad)) return { ok: false, tur: 'yasak' };
    const liste = karolar();
    const cozum = eylemAdiniCoz(ad.trim(), liste);
    if (cozum.hata) return { ok: false, tur: cozum.hata };
    if (Object.keys(cozum).length !== 1) return { ok: false, tur: 'gecersiz' };
    const karo = liste.find((k) => k.id === cozum.id);
    if (!karo || karo.varsayilanEylem === false || !disaUygunMu(karo)) return { ok: false, tur: 'kaynak-izinsiz' };
    return { ok: true, ad: komutSatiriAdi(karo, liste) ?? karo.etiket, alan: karo.alan, durum: karo.durum ?? 'yok', yuzde: Number.isInteger(karo.yuzde) ? karo.yuzde : null };
  }

  return {
    calistir,
    uygunlar,
    kuralUygunlari,
    listeAl,
    durumAl,
    onayBekliyorMu: () => onayBekliyor,
    anliklariTemizle: () => anliklar.clear(),
  };
}

module.exports = {
  KAYNAK_AYARI,
  HIZ_SINIRLARI,
  GENEL_HIZ_SINIRI,
  KURAL_ISLEMLERI,
  ANLIK_OMRU_MS,
  HATA_ANAHTARLARI,
  disaUygunMu,
  disTetikKapisiOlustur,
};
