'use strict';

/**
 * Ayarlar penceresinden gelen "Ayarları Kaydet" girdisini doğrular (saf).
 *
 * Ayrım (hata-12): ADRES hataları kaydı durdurur (`hatalar`); KISAYOL sorunları yalnız uyarıdır
 * (`uyarilar`) — diğer ayarlar yine kaydedilir. Kısayolun gerçekten kaydedilip kaydedilemediğini
 * (başka uygulama kullanıyor olabilir) ana süreç Electron ile dener ve uyarıya ekler.
 */

const { adresNormallestir, anahtarIcinGuvenliAdresMi, tamsayi } = require('./dogrulama');
const { kisayolDogrula, kisayolNormallestir, kisayolUyarilari } = require('./kisayol');
const { PENCERE_BOYUTLARI } = require('./pencere-yerlesim');
const { panolariDuzelt } = require('./panolar');
const { MALZEME_DEGERLERI } = require('./malzeme');
const { TEMA_DEGERLERI, vurguRengiDuzelt } = require('./gorunum');
const { DIL_AYARLARI, cogul } = require('./dil');
const { TR } = require('./ceviri-varsayilan');
const { ekGirdiDogrula } = require('./ayar-alanlari');

const TEPSI_SOL_TIK_DEGERLERI = ['panel', 'pencere'];

/**
 * @param {unknown} girdi ayarlar:kaydet yükü
 * @param {object} mevcut şu anki ayarlar (kisayol, pencereBoyutu, ...)
 * @param {{t?: Function}} [secenek] t: çevirmen (src/lib/dil.js); hata ve uyarı iletileri o dilde yazılır, verilmezse Türkçe
 * @returns {{ hatalar: string[], hataAlanlari: string[], uyarilar: {alan:string, mesaj:string}[], yeni: object }}
 *   yeni: uygulanacak değerler (hata varsa anlamsızdır); hataAlanlari: hatanın hangi alanda olduğu ('yerelAdres' | 'disAdres'),
 *   Ayarlar sayfası o alanı işaretler (h-01)
 */
function ayarGirdisiniDogrula(girdi, mevcut, { t = TR } = {}) {
  const hatalar = [];
  const hataAlanlari = [];
  const uyarilar = [];
  const yeni = {};
  if (!girdi || typeof girdi !== 'object') {
    return { hatalar: [t('kaydet.gecersizVeri')], hataAlanlari, uyarilar, yeni };
  }

  // --- Adresler: hata = hiçbir şey kaydedilmez ---
  const yerel = adresNormallestir(girdi.yerelAdres); // http: ve https: kabul; sertifika doğrulaması normal kalır
  if (!yerel) {
    hatalar.push(t('kaydet.yerelGecersiz'));
    hataAlanlari.push('yerelAdres');
  } else if (!anahtarIcinGuvenliAdresMi(yerel)) {
    // http:// yalnız ev/yerel ağ adresinde kabul edilir: herkese açık bir ada düz http ile erişim anahtarı gitmesin (hata-01).
    hatalar.push(t('kaydet.yerelHttp'));
    hataAlanlari.push('yerelAdres');
  } else {
    yeni.yerelAdres = yerel;
  }
  let dis = '';
  if (typeof girdi.disAdres === 'string' && girdi.disAdres.trim() !== '') {
    dis = adresNormallestir(girdi.disAdres, true);
    if (!dis) {
      hatalar.push(t('kaydet.disGecersiz'));
      hataAlanlari.push('disAdres');
    }
  }
  if (dis !== null) yeni.disAdres = dis;

  // --- Kısayol: sorun = uyarı; mevcut kısayol korunur, diğer ayarlar kaydedilir ---
  const kisayol = typeof girdi.kisayol === 'string' ? girdi.kisayol.trim() : '';
  const dogrulama = kisayolDogrula(kisayol, t);
  if (!dogrulama.gecerli) {
    yeni.kisayol = mevcut.kisayol;
    uyarilar.push({ alan: 'kisayol', mesaj: t('kaydet.kisayolKorundu', { mesaj: dogrulama.mesaj }) });
  } else {
    yeni.kisayol = kisayolNormallestir(kisayol);
    if (yeni.kisayol !== mevcut.kisayol) {
      // Bu uyarılar kısayolun uygulandığını varsayar; Electron'da kaydedilemezse atılır (kisayolKaydiSonrasiUyarilar).
      for (const mesaj of kisayolUyarilari(yeni.kisayol, t)) uyarilar.push({ alan: 'kisayol', mesaj, yalnizKayitBasarili: true });
    }
  }

  // --- Palet kısayolu: boş = kapalı; sorun = uyarı, mevcut kısayol korunur ---
  if (girdi.paletKisayol !== undefined) {
    const palet = typeof girdi.paletKisayol === 'string' ? girdi.paletKisayol.trim() : null;
    if (palet === null) {
      uyarilar.push({ alan: 'paletKisayol', mesaj: t('kaydet.paletMetin') });
    } else if (palet === '') {
      yeni.paletKisayol = '';
    } else {
      const paletDogrulama = kisayolDogrula(palet, t);
      if (!paletDogrulama.gecerli) {
        uyarilar.push({ alan: 'paletKisayol', mesaj: t('kaydet.paletKorundu', { mesaj: paletDogrulama.mesaj }) });
      } else {
        yeni.paletKisayol = kisayolNormallestir(palet);
        if (yeni.paletKisayol !== mevcut.paletKisayol) {
          for (const mesaj of kisayolUyarilari(yeni.paletKisayol, t)) uyarilar.push({ alan: 'paletKisayol', mesaj, yalnizKayitBasarili: true });
        }
      }
    }
  }

  // --- Diğer ayarlar: geçersiz değer mevcut olanı korur ---
  if (typeof girdi.otomatikBaslat === 'boolean') yeni.otomatikBaslat = girdi.otomatikBaslat;
  if (PENCERE_BOYUTLARI.includes(girdi.pencereBoyutu)) yeni.pencereBoyutu = girdi.pencereBoyutu;
  if (typeof girdi.odakKaybindaGizle === 'boolean') yeni.odakKaybindaGizle = girdi.odakKaybindaGizle;
  if (typeof girdi.koseBildirimi === 'boolean') yeni.koseBildirimi = girdi.koseBildirimi;
  if (typeof girdi.bipSesi === 'boolean') yeni.bipSesi = girdi.bipSesi;
  if (TEPSI_SOL_TIK_DEGERLERI.includes(girdi.tepsiSolTik)) yeni.tepsiSolTik = girdi.tepsiSolTik;
  // Arayüz dili ('sistem' | 'tr' | 'en'): geçersiz değer mevcut olanı korur.
  if (DIL_AYARLARI.includes(girdi.dil)) yeni.dil = girdi.dil;
  // Görünüm (Dalga 4): geçersiz tema/malzeme mevcut olanı korur; geçersiz vurgu rengi uyarıdır (kayıt devam eder).
  if (TEMA_DEGERLERI.includes(girdi.temaZorla)) yeni.temaZorla = girdi.temaZorla;
  if (MALZEME_DEGERLERI.includes(girdi.yeniPencereMalzemesi)) yeni.yeniPencereMalzemesi = girdi.yeniPencereMalzemesi;
  if (girdi.vurguRengi !== undefined) {
    const renk = vurguRengiDuzelt(girdi.vurguRengi);
    if (renk === null) uyarilar.push({ alan: 'vurguRengi', mesaj: t('kaydet.vurguRengi') });
    else yeni.vurguRengi = renk;
  }
  if (typeof girdi.canliBaglanti === 'boolean') yeni.canliBaglanti = girdi.canliBaglanti;
  if (girdi.panolar !== undefined) {
    if (!Array.isArray(girdi.panolar)) {
      uyarilar.push({ alan: 'panolar', mesaj: t('kaydet.panoListesi') });
    } else {
      const { panolar, atilanlar, kisayolAtilanlar, fazla } = panolariDuzelt(girdi.panolar);
      yeni.panolar = panolar;
      if (atilanlar > 0) uyarilar.push({ alan: 'panolar', mesaj: cogul(t, 'kaydet.panoGecersiz', atilanlar) });
      if (kisayolAtilanlar > 0) uyarilar.push({ alan: 'panolar', mesaj: cogul(t, 'kaydet.panoKisayol', kisayolAtilanlar) });
      if (fazla > 0) uyarilar.push({ alan: 'panolar', mesaj: cogul(t, 'kaydet.panoFazla', fazla) });
    }
  }
  if (girdi.anaPanoyaDonDk !== undefined) {
    const dk = typeof girdi.anaPanoyaDonDk === 'string' && girdi.anaPanoyaDonDk.trim() === '' ? NaN : girdi.anaPanoyaDonDk;
    const gecerli = tamsayi(typeof dk === 'number' || typeof dk === 'string' ? dk : NaN, 0, 1440, null);
    if (gecerli === null) {
      uyarilar.push({ alan: 'anaPanoyaDonDk', mesaj: t('kaydet.anaPanoSure') });
    } else {
      yeni.anaPanoyaDonDk = gecerli;
    }
  }
  // 1.4.0: ayar-alanlari.js tablosundaki alanlar (geçersiz değer mevcut olanı korur, uyarı verir).
  const ek = ekGirdiDogrula(girdi, t);
  Object.assign(yeni, ek.yeni);
  uyarilar.push(...ek.uyarilar);
  return { hatalar, hataAlanlari, uyarilar, yeni };
}

/**
 * Kısayol Electron'da gerçekten kaydedildi mi sonucuna göre uyarıları süzer: kaydedilemeyen kısayol için
 * AltGr / Windows tuşu / tek değiştirici uyarıları yanıltıcıdır (uygulanmamış kısayol hakkında konuşur) ve
 * "kaydedilemedi" mesajının yanında gösterilmez. Geçersiz kısayol uyarısı gibi diğerleri korunur.
 * @param {{alan:string, mesaj:string, yalnizKayitBasarili?:boolean}[]} uyarilar
 * @param {boolean} kisayolKaydedildi
 */
function kisayolKaydiSonrasiUyarilar(uyarilar, kisayolKaydedildi) {
  if (kisayolKaydedildi) return uyarilar;
  return uyarilar.filter((u) => !u.yalnizKayitBasarili);
}

module.exports = { ayarGirdisiniDogrula, kisayolKaydiSonrasiUyarilar };
