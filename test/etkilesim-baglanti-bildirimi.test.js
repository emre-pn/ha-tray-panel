'use strict';

/**
 * "Home Assistant koptu / geri geldi" kararı (1.4.0, o-38; src/lib/baglanti-bildirimi.js): kısa kesintiler sessizdir, "geri geldi"
 * yalnız "koptu" gösterildiyse gelir; uyku, anahtar sorunu ve ilk bağlantının kurulamaması kesinti sayılmaz. Sahte zamanla sınanır;
 * ağ ya da bildirim yoktur (bildirimler çağıranın işlevleridir).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { GECIKME_SINIRI, KESINTI_NEDENLERI, gecikmeSn, kesintiMi, baglantiBildirimiOlustur } = require('../src/lib/baglanti-bildirimi');

const CANLI = { baglanti: 'canli', canli: true, neden: null };
const kopuk = (neden = 'kapandi', baglanti = 'baglaniyor') => ({ baglanti, canli: false, neden });
const DENEME = { baglanti: 'baglaniyor', canli: false, neden: null };

function ortam({ etkin = true, sn = 60 } = {}) {
  let t = 1_000_000;
  let sonId = 0;
  const bekleyen = new Map();
  const ayar = { etkin, sn };
  const olaylar = [];
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
  const b = baglantiBildirimiOlustur({
    koptu: (bilgi) => olaylar.push(['koptu', bilgi.sureSn]),
    geldi: (bilgi) => olaylar.push(['geldi', bilgi.sureSn]),
    etkinMi: () => ayar.etkin,
    gecikmeSnAl: () => ayar.sn,
    zaman,
  });
  function ilerle(sn2) {
    const hedef = t + sn2 * 1000;
    for (;;) {
      const sira = [...bekleyen.entries()].filter(([, v]) => v.bitis <= hedef).sort((a, c) => a[1].bitis - c[1].bitis)[0];
      if (!sira) break;
      t = sira[1].bitis;
      bekleyen.delete(sira[0]);
      sira[1].fn();
    }
    t = hedef;
  }
  return { b, ayar, olaylar, ilerle, bekleyenSayisi: () => bekleyen.size };
}

test('gecikme: sınırlar içinde tam sayı, geçersiz değer varsayılan (60)', () => {
  assert.deepEqual({ ...GECIKME_SINIRI }, { en_az: 15, en_cok: 600, varsayilan: 60 });
  assert.equal(gecikmeSn(90), 90);
  assert.equal(gecikmeSn('45'), 45);
  assert.equal(gecikmeSn(2), 15);
  assert.equal(gecikmeSn(99999), 600);
  assert.equal(gecikmeSn(30.4), 30);
  for (const gecersiz of [undefined, null, NaN, 'abc', {}]) assert.equal(gecikmeSn(gecersiz), 60, String(gecersiz));
});

test('kesinti ayrımı: yalnız bağlanıyor/yedek + gerçek kopma nedeni; canlı, kapalı, uyku ve yapılandırma durumları kesinti değil', () => {
  for (const neden of KESINTI_NEDENLERI) {
    assert.equal(kesintiMi(kopuk(neden)), true, neden);
    assert.equal(kesintiMi(kopuk(neden, 'yedek')), true, `yedek ${neden}`);
  }
  assert.equal(kesintiMi(CANLI), false);
  assert.equal(kesintiMi(DENEME), false, 'yeniden bağlanma denemesi (neden yok) tek başına kesinti başlatmaz');
  assert.equal(kesintiMi(kopuk('askida')), false, 'uyku');
  for (const neden of ['yetki', 'dogrulanamadi', 'yerel-yasak', 'abonelik-yok', 'izlenen-yok', 'adres-guvenli-degil', 'ileti-cok-buyuk', 'ws-yok', 'anahtar-yok']) {
    assert.equal(kesintiMi(kopuk(neden)), false, neden);
  }
  assert.equal(kesintiMi({ baglanti: 'kapali', canli: false, neden: 'kapandi' }), false, 'kapalı durum');
  for (const bozuk of [null, undefined, 5, 'canli', {}, { baglanti: 'baglaniyor', canli: true, neden: 'kapandi' }]) assert.equal(kesintiMi(bozuk), false, String(bozuk));
});

test('kısa kesinti sessiz: süre dolmadan geri gelirse ne "koptu" ne "geri geldi" gösterilir', () => {
  const o = ortam({ sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(30);
  o.b.durum(CANLI);
  o.ilerle(120);
  assert.deepEqual(o.olaylar, []);
  assert.equal(o.bekleyenSayisi(), 0, 'zamanlayıcı kalmaz');
});

test('uzun kesinti: süre dolunca BİR kez "koptu", dönünce BİR kez "geri geldi" (süre ile)', () => {
  const o = ortam({ sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('pong-yok'));
  o.ilerle(59);
  assert.deepEqual(o.olaylar, [], 'süre dolmadı');
  o.ilerle(2);
  assert.deepEqual(o.olaylar, [['koptu', 60]]);
  o.ilerle(500);
  o.b.durum(kopuk('zaman-asimi', 'yedek')); // yedek kipinde süren kesinti
  o.b.durum(DENEME);
  o.b.durum(kopuk('kapandi'));
  assert.equal(o.olaylar.length, 1, 'kesinti sürerken tekrar "koptu" gelmez');
  o.ilerle(100);
  o.b.durum(CANLI);
  assert.deepEqual(o.olaylar.map((x) => x[0]), ['koptu', 'geldi']);
  assert.equal(o.olaylar[1][1], 661, 'geri geldi süresi: kesintinin başından bu yana');
  o.b.durum(CANLI);
  assert.equal(o.olaylar.length, 2, 'tekrarlanan canlı durumu ikinci bildirim üretmez');
});

test('yeniden bağlanma denemeleri (neden yok) kesinti süresini sıfırlamaz', () => {
  const o = ortam({ sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(30);
  o.b.durum(DENEME); // baglan() her denemede "baglaniyor" yayınlar
  o.ilerle(20);
  o.b.durum(kopuk('zaman-asimi'));
  o.ilerle(11);
  assert.deepEqual(o.olaylar.map((x) => x[0]), ['koptu'], '30 + 20 + 11 sn kesintisiz kopuk');
});

test('ilk bağlantı hiç kurulamadıysa "koptu" gelmez; kopan bir şey yoktu', () => {
  const o = ortam({ sn: 15 });
  o.b.durum(kopuk('zaman-asimi'));
  o.b.durum(kopuk('kapandi', 'yedek'));
  o.ilerle(600);
  o.b.durum(CANLI);
  assert.deepEqual(o.olaylar, []);
});

test('uyku (askida) kesinti sayılmaz: bekleyen "koptu" iptal olur; gösterilmiş "koptu" için "geri geldi" korunur', () => {
  const o = ortam({ sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(30);
  o.b.durum(kopuk('askida')); // bilgisayar uykuya girdi
  o.ilerle(3600);
  assert.deepEqual(o.olaylar, [], 'uykuda geçen süre kesinti sayılmaz');
  o.b.durum(CANLI);
  assert.deepEqual(o.olaylar, []);

  const p = ortam({ sn: 60 });
  p.b.durum(CANLI);
  p.b.durum(kopuk('kapandi'));
  p.ilerle(61);
  assert.deepEqual(p.olaylar.map((x) => x[0]), ['koptu']);
  p.b.durum(kopuk('askida'));
  p.b.durum(CANLI);
  assert.deepEqual(p.olaylar.map((x) => x[0]), ['koptu', 'geldi'], 'gösterilmiş "koptu" için dönüş bildirilir');
});

test('anahtar sorunu ve canlı bağlantının kapatılması kesintiyi bitirir: "geri geldi" sahte yere gelmez', () => {
  for (const son of [kopuk('yetki'), kopuk('dogrulanamadi'), { baglanti: 'kapali', canli: false, neden: 'anahtar-yok' }, { baglanti: 'kapali', canli: false, neden: null }]) {
    const o = ortam({ sn: 60 });
    o.b.durum(CANLI);
    o.b.durum(kopuk('kapandi'));
    o.ilerle(61);
    assert.deepEqual(o.olaylar.map((x) => x[0]), ['koptu']);
    o.b.durum(son);
    o.b.durum(CANLI);
    assert.deepEqual(o.olaylar.map((x) => x[0]), ['koptu'], `${JSON.stringify(son)} sonrası canlı: "geri geldi" yok`);
  }
  const o = ortam({ sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(20);
  o.b.durum({ baglanti: 'kapali', canli: false, neden: 'anahtar-yok' });
  assert.equal(o.bekleyenSayisi(), 0, 'bekleyen "koptu" iptal');
  o.ilerle(600);
  assert.deepEqual(o.olaylar, []);
});

test('ayar kapalıyken hiçbir bildirim gelmez; açıkken süre dolmadan kapatılırsa "koptu" iptal olur', () => {
  const o = ortam({ etkin: false, sn: 60 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(120);
  o.b.durum(CANLI);
  assert.deepEqual(o.olaylar, []);

  const p = ortam({ etkin: true, sn: 60 });
  p.b.durum(CANLI);
  p.b.durum(kopuk('kapandi'));
  p.ilerle(30);
  p.ayar.etkin = false; // kullanıcı bildirimi kapattı
  p.b.ayarDegisti();
  p.ilerle(60);
  assert.deepEqual(p.olaylar, [], 'kapatılınca "koptu" gelmez');

  const q = ortam({ etkin: true, sn: 60 });
  q.b.durum(CANLI);
  q.b.durum(kopuk('kapandi'));
  q.ilerle(70);
  assert.deepEqual(q.olaylar.map((x) => x[0]), ['koptu']);
  q.ayar.etkin = false; // "koptu" gösterildikten sonra kapatıldı: dönüş de bildirilmez
  q.b.durum(CANLI);
  assert.deepEqual(q.olaylar.map((x) => x[0]), ['koptu']);
});

test('süre ayarı değişince bekleyen zamanlayıcı kalan süreye göre yeniden kurulur', () => {
  const o = ortam({ sn: 120 });
  o.b.durum(CANLI);
  o.b.durum(kopuk('kapandi'));
  o.ilerle(50);
  o.ayar.sn = 60; // 120 -> 60: 10 sn sonra dolmalı
  o.b.ayarDegisti();
  o.ilerle(9);
  assert.deepEqual(o.olaylar, []);
  o.ilerle(2);
  assert.deepEqual(o.olaylar.map((x) => x[0]), ['koptu']);

  const p = ortam({ sn: 30 });
  p.b.durum(CANLI);
  p.b.durum(kopuk('kapandi'));
  p.ilerle(20);
  p.ayar.sn = 300;
  p.b.ayarDegisti();
  p.ilerle(200);
  assert.deepEqual(p.olaylar, [], 'süre uzatıldı: erken bildirim yok');
  p.ilerle(100);
  assert.deepEqual(p.olaylar.map((x) => x[0]), ['koptu']);
});

test('bildirim işlevi fırlatsa da izleme bozulmaz; geçersiz girdiler yok sayılır; sifirla her şeyi unutur', () => {
  let t = 5000;
  const bekleyen = [];
  const b = baglantiBildirimiOlustur({
    koptu: () => {
      throw new Error('bildirim yok');
    },
    geldi: () => {
      throw new Error('bildirim yok');
    },
    zaman: { setTimeout: (fn, ms) => (bekleyen.push({ fn, bitis: t + ms }), bekleyen.length), clearTimeout: (id) => (bekleyen[id - 1] = { fn() {}, bitis: Infinity }), simdi: () => t },
  });
  b.durum(CANLI);
  b.durum(kopuk('kapandi'));
  t += 61_000;
  assert.doesNotThrow(() => bekleyen.filter((x) => x.bitis <= t).forEach((x) => x.fn()));
  assert.doesNotThrow(() => b.durum(CANLI));
  for (const bozuk of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => b.durum(bozuk));
  b.durum(CANLI);
  b.durum(kopuk('kapandi'));
  b.sifirla();
  assert.deepEqual(b.durumBilgisi(), { canliydi: false, kesintiBasi: null, bildirildi: false, bekliyor: false });
});
