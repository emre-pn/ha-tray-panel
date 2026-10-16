'use strict';

/**
 * Kimlikli işlem kapısı (saf; 1.1.1 tur 3). Kimlikli (Authorization taşıyan) HER REST isteği ve WebSocket 'auth' iletisi tek bir
 * küresel kapıdan geçer ve aynı anda EN ÇOK 1 işlem yolda olur: Home Assistant'ın ip_ban sayacı 5 hatalı denemede dolar, anahtar
 * uygulama çalışırken iptal edilse bile ilk 401 dönmeden ikinci bir istek yola çıkmaz. Bekleyenler sırayla (FIFO) girer; her biri
 * kapıyı aldıktan sonra yetki kesiciyi YENİDEN denetler (kesici açıldıysa ağa çıkmadan reddedilir): bu denetim çağıranındır.
 *
 * Öncelik (tur 4): kullanıcı eylemi (POST), WS auth ve doğrulama isteği 'yuksek' ile alınır ve bekleyen NORMAL işlemlerin (toplu
 * durum GET'leri) önüne geçer; her sınıfın kendi içinde sıra FIFO'dur. Sınır yine 1: öncelik yalnız sırayı değiştirir, aynı anda
 * ikinci bir işlem yola çıkarmaz. Böylece 25 favorilik yenileme bir eylemi saniyelerce bekletmez (en çok yoldaki TEK işlem beklenir).
 *
 * Kapı her durumda bırakılmalıdır (zaman aşımı, hata, iptal, soket kapanışı). Unutulursa uygulama donardı; bu yüzden her sahip için
 * bekçi süresi vardır: süre dolunca kapı ZORLA bırakılır ve eski sahibin geç gelen bırakması yeni sahibin hakkını etkilemez.
 */

// Bir kimlikli işlemin en uzun makul süresi: doğrulama zaman aşımı (dış adreste 30 sn) + pay. Bundan uzun tutulan kapı unutulmuştur.
const KAPI_TAVAN_MS = 60_000;

function varsayilanZaman() {
  return {
    setTimeout: (fn, ms) => {
      const id = globalThis.setTimeout(fn, ms);
      if (typeof id?.unref === 'function') id.unref(); // bekçi, süreç çıkışını geciktirmesin
      return id;
    },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * @param {object} [bag]
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 * @param {number} [bag.tavanMs]
 * @param {() => void} [bag.zorlaBirakildi] bekçi kapıyı zorla bıraktığında (günlük için)
 */
function kapiOlustur({ zaman = varsayilanZaman(), tavanMs = KAPI_TAVAN_MS, zorlaBirakildi = () => {} } = {}) {
  let sahip = null; // süren işlemin belirteci (nesne); null: kapı boş
  let bekcidekiZamanlayici = null;
  const yuksekBekleyenler = [];
  const bekleyenler = [];

  function girisVer(coz) {
    const belirtec = {};
    sahip = belirtec;
    bekcidekiZamanlayici = zaman.setTimeout(() => {
      bekcidekiZamanlayici = null;
      if (sahip !== belirtec) return;
      try {
        zorlaBirakildi();
      } catch {
        /* günlük hatası kapıyı etkilemesin */
      }
      birak(belirtec);
    }, tavanMs);
    coz(() => birak(belirtec)); // bırakma işlevi: yalnız KENDİ belirtecini bırakabilir (ikinci/geç çağrı etkisiz)
  }

  function birak(belirtec) {
    if (sahip !== belirtec) return;
    zaman.clearTimeout(bekcidekiZamanlayici);
    bekcidekiZamanlayici = null;
    sahip = null;
    const sonraki = yuksekBekleyenler.shift() ?? bekleyenler.shift();
    if (sonraki) girisVer(sonraki);
  }

  return {
    /**
     * @param {{oncelik?: 'yuksek'|'normal'}} [secenek]
     * @returns {Promise<() => void>} kapı alınınca çözülür; dönen işlev kapıyı bırakır (idempotent)
     */
    al({ oncelik = 'normal' } = {}) {
      return new Promise((coz) => {
        if (sahip === null) girisVer(coz);
        else (oncelik === 'yuksek' ? yuksekBekleyenler : bekleyenler).push(coz);
      });
    },
    durum: () => ({ yolda: sahip !== null, bekleyen: bekleyenler.length + yuksekBekleyenler.length }),
  };
}

module.exports = { KAPI_TAVAN_MS, kapiOlustur };
