'use strict';

/**
 * Basılı tutunca göster (1.4.0, o-60; src/lib/basili-tut.js): tuş dinleyicisi YOK; tek bilgi genel kısayolun kendi tekrar olaylarıdır.
 * Sahte zamanla sınanır: ilk basış açar, tekrarlar tutuluyor demektir, tekrarlar kesilince (bırakma) gizlenir; tekrar hiç gelmezse
 * pencere açık kalır ve davranış sıradan geçişe döner. Gerçek Windows tuş tekrarı bu ortamda DENENMEDİ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ILK_PENCERE_MS, ILK_BIRAKMA_MS, EN_AZ_BIRAKMA_MS, EN_COK_BIRAKMA_MS, SUSTURMA_MS, birakmaSuresi, basiliTutOlustur } = require('../src/lib/basili-tut');

function ortam({ baslangicAcik = false } = {}) {
  let t = 10_000;
  let sonId = 0;
  const bekleyen = new Map();
  const durum = { acik: baslangicAcik, olaylar: [] };
  const zaman = {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyen.set(sonId, { fn, bitis: t + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyen.delete(id);
    },
    simdi: () => t,
  };
  const basili = basiliTutOlustur({
    ac: () => {
      durum.acik = true;
      durum.olaylar.push('ac');
    },
    kapat: () => {
      durum.acik = false;
      durum.olaylar.push('kapat');
    },
    acikMi: () => durum.acik,
    zaman,
  });
  function ilerle(ms) {
    const hedef = t + ms;
    for (;;) {
      const sira = [...bekleyen.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, b) => a[1].bitis - b[1].bitis)[0];
      if (!sira) break;
      t = sira[1].bitis;
      bekleyen.delete(sira[0]);
      sira[1].fn();
    }
    t = hedef;
  }
  return { basili, durum, ilerle, zamanlayici: () => bekleyen.size };
}

/** Tuş `sure` ms basılı tutulur: ilk basış, `gecikme` sonra ilk tekrar, sonra `aralik` aralıkla tekrarlar. */
function tut(o, { gecikme = 500, aralik = 33, sure = 2000 }) {
  const sonuclar = [o.basili.tus()];
  o.ilerle(gecikme);
  let gecen = gecikme;
  while (gecen <= sure) {
    sonuclar.push(o.basili.tus());
    o.ilerle(aralik);
    gecen += aralik;
  }
  return sonuclar;
}

test('bırakma süresi: aralık yoksa ilk bekleme; aralığın 2,5 katı, en az ve en çok sınırlar içinde', () => {
  assert.equal(birakmaSuresi([]), ILK_BIRAKMA_MS);
  assert.equal(birakmaSuresi([33, 33, 33]), EN_AZ_BIRAKMA_MS, '2,5 x 33 = 83 ms: en az sınırına çıkar');
  assert.equal(birakmaSuresi([100]), 250);
  assert.equal(birakmaSuresi([40, 120, 60]), 300, 'son aralıkların en büyüğü esas alınır');
  assert.equal(birakmaSuresi([2000]), EN_COK_BIRAKMA_MS);
  assert.equal(birakmaSuresi([NaN, -5, Infinity]), ILK_BIRAKMA_MS, 'geçersiz aralıklar yok sayılır');
});

test('basılı tutma: ilk basış açar, tuş tutulduğu sürece açık kalır, bırakılınca (tekrarlar kesilince) gizlenir', () => {
  const o = ortam();
  const sonuclar = tut(o, { sure: 2000 });
  assert.equal(sonuclar[0], 'acildi');
  assert.ok(sonuclar.slice(1).every((s) => s === 'tutuyor'));
  assert.equal(o.durum.acik, true, 'tuş hâlâ basılıyken pencere açık');
  assert.deepEqual(o.durum.olaylar, ['ac']);
  assert.equal(o.basili.durum(), 'tutuyor');
  o.ilerle(EN_AZ_BIRAKMA_MS + 10); // tekrarlar durdu: tuş bırakıldı
  assert.equal(o.durum.acik, false, 'bırakınca gizlenir');
  assert.deepEqual(o.durum.olaylar, ['ac', 'kapat']);
  assert.equal(o.basili.durum(), 'bos');
  assert.equal(o.zamanlayici(), 0, 'bekleyen zamanlayıcı kalmaz');
});

test('yavaş tekrar hızı (400 ms): tutarken pencere kapanmaz, bırakınca yine kapanır', () => {
  const o = ortam();
  o.basili.tus();
  o.ilerle(900); // ilk tekrar gecikmesi
  for (let i = 0; i < 6; i += 1) {
    assert.equal(o.basili.tus(), 'tutuyor');
    o.ilerle(400);
  }
  assert.equal(o.durum.acik, true);
  o.ilerle(1000);
  assert.equal(o.durum.acik, false);
});

test('kısa basış (tekrar hiç gelmez): pencere AÇIK kalır ve sıradan geçişe dönülür — ikinci basış kapatır', () => {
  const o = ortam();
  assert.equal(o.basili.tus(), 'acildi');
  o.ilerle(ILK_PENCERE_MS + 50);
  assert.equal(o.durum.acik, true, 'tuş tutulduğu anlaşılamadı: pencere kilitlenmez, açık kalır');
  assert.equal(o.basili.durum(), 'bos');
  o.ilerle(500); // susturma yok: tutulamadı yolunda susturma uygulanmaz
  assert.equal(o.basili.tus(), 'kapandi', 'ikinci basış pencereyi kapatır (eski davranış)');
  assert.equal(o.durum.acik, false);
  assert.deepEqual(o.durum.olaylar, ['ac', 'kapat']);
});

test('pencere zaten açıkken basış kapatır; tutulsa da bırakınca ikinci bir işlem yapılmaz', () => {
  const o = ortam({ baslangicAcik: true });
  assert.equal(o.basili.tus(), 'kapandi');
  assert.equal(o.durum.acik, false);
  o.ilerle(100);
  o.basili.tus(); // tuş basılı: tekrar
  o.ilerle(100);
  o.basili.tus();
  o.ilerle(2000); // bırakıldı
  assert.deepEqual(o.durum.olaylar, ['kapat'], 'kapatma basışı bırakınca pencereyi yeniden açmaz ya da tekrar kapatmaz');
});

test('bırakma sonrası kısa süre gelen tetiklemeler susturulur (titreme yok); süre dolunca yeni basış açar', () => {
  const o = ortam();
  tut(o, { sure: 1200 });
  o.ilerle(EN_AZ_BIRAKMA_MS + 10); // bırakıldı ve gizlendi
  assert.equal(o.durum.acik, false);
  assert.equal(o.basili.tus(), 'susturuldu', 'araya giren geç tekrar pencereyi yeniden açmaz');
  assert.equal(o.durum.acik, false);
  o.ilerle(SUSTURMA_MS + 50);
  assert.equal(o.basili.tus(), 'acildi', 'susturma süresi dolunca yeni basış normal çalışır');
  assert.equal(o.durum.acik, true);
});

test('pencere bırakmadan önce başka yolla gizlendiyse (Esc, tepsi) bırakma ikinci bir kapatma yapmaz', () => {
  const o = ortam();
  tut(o, { sure: 1000 });
  o.durum.acik = false; // kullanıcı Esc ile kapattı
  o.durum.olaylar.push('baska-yol');
  o.ilerle(EN_AZ_BIRAKMA_MS + 10);
  assert.deepEqual(o.durum.olaylar, ['ac', 'baska-yol'], 'görünür olmayan pencere için kapat çağrılmaz');
});

test('sifirla: bekleyen her şey bırakılır, pencereye dokunulmaz, sonraki basış taze başlar', () => {
  const o = ortam();
  tut(o, { sure: 800 });
  o.basili.sifirla();
  assert.equal(o.basili.durum(), 'bos');
  assert.equal(o.zamanlayici(), 0);
  o.ilerle(5000);
  assert.equal(o.durum.acik, true, 'sıfırlama pencereyi kapatmaz');
  assert.deepEqual(o.durum.olaylar, ['ac']);
  assert.equal(o.basili.tus(), 'kapandi', 'açık pencerede yeni basış kapatır');
});

test('gorunurMu verilirse bırakma onu kullanır (ör. odak dışında gizlenmiş pencere)', () => {
  const olaylar = [];
  let acik = false;
  let gorunur = true;
  let t = 0;
  const bekleyen = [];
  const b = basiliTutOlustur({
    ac: () => {
      acik = true;
      olaylar.push('ac');
    },
    kapat: () => olaylar.push('kapat'),
    acikMi: () => acik,
    gorunurMu: () => gorunur,
    zaman: { setTimeout: (fn, ms) => (bekleyen.push({ fn, bitis: t + ms }), bekleyen.length), clearTimeout: (id) => (bekleyen[id - 1] = { fn() {}, bitis: -1 }), simdi: () => t },
  });
  b.tus();
  t += 400;
  b.tus();
  gorunur = false;
  t += 5000;
  bekleyen.filter((x) => x.bitis <= t && x.bitis >= 0).forEach((x) => x.fn());
  assert.deepEqual(olaylar, ['ac'], 'pencere görünür değilse kapat çağrılmaz');
});
