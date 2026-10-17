'use strict';

/**
 * Son değişenler (o-18, 1.4.0 eylem grubu; Electron'a bağlı değildir). Palette "@" yazınca listelenen "son neler değişti" kaydı.
 *
 *  - Kaynak durum deposudur (src/lib/durum-deposu.js): depo.dinle ile yalnız DEĞİŞEN kimlikler gelir. Depo yalnız İZLENEN varlıkları
 *    tutar (favoriler, yardımcı varlıklar, bilgi kartları, uyarı kuralları); izlenmeyen bir cihazın değişimi buraya hiç ulaşmaz.
 *  - Yalnız ışık, priz/anahtar, sahne, klima ve medya oynatıcı. Sensör, ikili sensör, hava, takvim vb. girmez (gürültü olur).
 *  - Kapı Kuralı (suzgec.js guvenliVarlikMi) HER girdide yeniden uygulanır: kilit, alarm, kapı, garaj, kapı zili, siren ve kepenk
 *    adı/sınıfı taşıyan varlık hiç kaydedilmez; ad da süzgeçten geçer.
 *  - Yalnız GEÇİŞ kaydedilir: ilk gözlem (açılış dolumu, yeniden bağlanma) yalnız temel çizgidir; "unavailable" / "unknown" geçişleri
 *    ve nitelik değişimleri (parlaklık, ses, sıcaklık) kaydedilmez. Medyada yalnız aç/kapat, klimada mod değişimi sayılır.
 *  - Halka 50 olaydır (en eski düşer); gösterimde varlık başına yalnız en son değişim, en yeni üstte, en çok 20 satır.
 *  - Yalnız bellekte durur; diske, günlüğe, dışa aktarmaya ve dışarıya HİÇBİR şey yazılmaz. Ayar `sonDegisenler` kapanınca temizlenir.
 */

const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');

const ALANLAR = Object.freeze(['light', 'switch', 'scene', 'climate', 'media_player']);
const HALKA_BOYUTU = 50;
const GOSTERILEN = 20;
const AD_SINIRI = 60;
const GELECEK_TOLERANSI_MS = 60_000; // last_changed saat kayması: bundan ileri zaman "şimdi" sayılır

const BILINMEZ = new Set(['unavailable', 'unknown']);
const MEDYA_KAPALI = new Set(['off', 'standby']);

/**
 * Önceki ve şimdiki durumdan değişim türü: 'acildi' | 'kapandi' | 'calisti' | 'degisti' ya da null (kaydedilmez).
 * @param {string} alan
 * @param {string} once
 * @param {string} simdi
 */
function degisimTuru(alan, once, simdi) {
  if (once === simdi) return null;
  if (alan === 'light' || alan === 'switch') {
    if (once === 'off' && simdi === 'on') return 'acildi';
    if (once === 'on' && simdi === 'off') return 'kapandi';
    return null;
  }
  if (alan === 'scene') return 'calisti'; // sahnenin durumu son çalıştırma zamanıdır; her yeni değer bir çalıştırmadır
  if (alan === 'media_player') {
    const oncekiKapali = MEDYA_KAPALI.has(once);
    const simdiKapali = MEDYA_KAPALI.has(simdi);
    if (oncekiKapali === simdiKapali) return null; // oynuyor -> duraklatıldı gibi geçişler kaydedilmez
    return simdiKapali ? 'kapandi' : 'acildi';
  }
  if (alan === 'climate') {
    if (BILINMEZ.has(once)) return null;
    if (simdi === 'off') return 'kapandi';
    return once === 'off' ? 'acildi' : 'degisti';
  }
  return null;
}

/**
 * @param {object} bag
 * @param {{al: Function, kimlikler: Function, dinle: Function}} bag.depo durum deposu
 * @param {() => object} bag.ayarlarAl ayarlar (sonDegisenler)
 * @param {() => number} [bag.simdi]
 * @param {(kimlik: string) => string|undefined} [bag.adAl] kullanıcının verdiği ad (favori etiketi); yoksa HA'daki ad
 */
function sonDegisenlerOlustur({ depo, ayarlarAl, simdi = () => Date.now(), adAl = () => undefined }) {
  const acikMi = () => ayarlarAl()?.sonDegisenler !== false;
  /** kimlik -> son bilinen (kullanılabilir) durum metni: değişim bu temel çizgiye göre hesaplanır */
  const temel = new Map();
  /** Halka: en eskiden en yeniye { kimlik, alan, tur, zaman } */
  let halka = [];

  function zamanOku(varlik) {
    const t = typeof varlik?.last_changed === 'string' ? Date.parse(varlik.last_changed) : NaN;
    const s = simdi();
    return Number.isFinite(t) && t > 0 && t <= s + GELECEK_TOLERANSI_MS ? Math.min(t, s) : s;
  }

  function bak(kimlik) {
    const varlik = depo.al(kimlik);
    const alan = alanAl(kimlik);
    if (!ALANLAR.includes(alan)) return false;
    if (!varlik || typeof varlik !== 'object' || !guvenliVarlikMi(varlik)) {
      temel.delete(kimlik); // yok / bilinmiyor / kapı kuralından geçmiyor: temel çizgi de bırakılır
      return false;
    }
    const durum = typeof varlik.state === 'string' ? varlik.state : '';
    if (BILINMEZ.has(durum) || durum === '') {
      // Ulaşılamayan cihazın temel çizgisi korunur (geri gelince aynı durumdaysa değişim sayılmaz). Hiç çalıştırılmamış sahne 'unknown' tutulur.
      if (alan === 'scene' && durum === 'unknown' && !temel.has(kimlik)) temel.set(kimlik, 'unknown');
      return false;
    }
    const once = temel.get(kimlik);
    temel.set(kimlik, durum);
    if (once === undefined) return false; // ilk gözlem: yalnız temel çizgi
    const tur = degisimTuru(alan, once, durum);
    if (tur === null) return false;
    halka.push({ kimlik, alan, tur, zaman: zamanOku(varlik) });
    if (halka.length > HALKA_BOYUTU) halka = halka.slice(halka.length - HALKA_BOYUTU);
    return true;
  }

  /** Depodaki bütün kimlikleri temel çizgi olarak okur (kayıt YAZMAZ): özellik açılırken boşlukta kalan değişimler geçmiş sayılmaz. */
  function temelOlustur() {
    temel.clear();
    for (const kimlik of depo.kimlikler()) {
      const varlik = depo.al(kimlik);
      const alan = alanAl(kimlik);
      if (!ALANLAR.includes(alan) || !varlik || typeof varlik !== 'object' || !guvenliVarlikMi(varlik)) continue;
      const durum = typeof varlik.state === 'string' ? varlik.state : '';
      if (durum !== '' && (!BILINMEZ.has(durum) || (alan === 'scene' && durum === 'unknown'))) temel.set(kimlik, durum);
    }
  }

  const dinlemeyiBirak = depo.dinle((kimlikler) => {
    if (!acikMi()) return;
    for (const kimlik of kimlikler) {
      try {
        bak(kimlik);
      } catch {
        /* tek bir varlığın bozuk verisi kaydı durdurmasın */
      }
    }
  });
  if (acikMi()) temelOlustur();

  /** Gösterilen ad: kullanıcının verdiği ad > HA'daki ad > kimlik; kapı kuralı süzgecinden geçmeyen ad kimliğe düşer. */
  function adBul(kimlik, varlik) {
    const adaylar = [adAl(kimlik), varlik?.attributes?.friendly_name, kimlik];
    for (const aday of adaylar) {
      const guvenli = typeof aday === 'string' && aday.trim() ? guvenliMetin(aday.trim(), AD_SINIRI) : null;
      if (guvenli) return guvenli;
    }
    return kimlik;
  }

  return {
    /**
     * Gösterilecek liste: varlık başına en son değişim, en yeni üstte, en çok 20. Varlık artık depoda yoksa ya da kapı kuralından
     * geçmiyorsa satır düşer. Ayar kapalıysa boş.
     * @returns {{kimlik: string, ad: string, alan: string, tur: 'acildi'|'kapandi'|'calisti'|'degisti', zaman: number}[]}
     */
    ozet() {
      if (!acikMi()) return [];
      const goruldu = new Set();
      const sonuc = [];
      for (let i = halka.length - 1; i >= 0 && sonuc.length < GOSTERILEN; i -= 1) {
        const o = halka[i];
        if (goruldu.has(o.kimlik)) continue;
        goruldu.add(o.kimlik);
        const varlik = depo.al(o.kimlik);
        if (!varlik || typeof varlik !== 'object' || !guvenliVarlikMi(varlik)) continue;
        sonuc.push({ kimlik: o.kimlik, ad: adBul(o.kimlik, varlik), alan: o.alan, tur: o.tur, zaman: o.zaman });
      }
      return sonuc.sort((a, b) => b.zaman - a.zaman);
    },
    /** Halkadaki olay sayısı (test ve tanılama). */
    sayi: () => halka.length,
    /** Ayar değişti: kapandıysa her şey silinir; açıldıysa temel çizgi şimdiki durumdan kurulur. Dönen: model değişti mi. */
    ayarDegisti() {
      if (!acikMi()) {
        const doluydu = halka.length > 0 || temel.size > 0;
        halka = [];
        temel.clear();
        return doluydu;
      }
      if (temel.size === 0) temelOlustur();
      return false;
    },
    temizle() {
      halka = [];
    },
    /** Çıkış: dinleyici bırakılır, bellek boşaltılır. */
    kapat() {
      dinlemeyiBirak();
      halka = [];
      temel.clear();
    },
  };
}

module.exports = { ALANLAR, HALKA_BOYUTU, GOSTERILEN, degisimTuru, sonDegisenlerOlustur };
